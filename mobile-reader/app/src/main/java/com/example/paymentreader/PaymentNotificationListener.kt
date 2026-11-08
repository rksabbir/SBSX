package com.example.paymentreader

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.DatabaseReference
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ServerValue
import com.google.firebase.database.ValueEventListener
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Reads only official provider app notifications or SMS notifications whose sender title
 * exactly matches an allowed provider sender ID. It does not read arbitrary phone-number SMS.
 * If the Reader/Firebase connection is offline when a notification arrives, the event is
 * dropped; REST requests are used so writes are not queued by the Firebase SDK for later upload.
 * A captured notification is not equivalent to provider-side payment verification.
 */
class PaymentNotificationListener : NotificationListenerService() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val ioExecutor = Executors.newSingleThreadExecutor()
    @Volatile private var firebaseConnected = false
    @Volatile private var listenerActive = false
    @Volatile private var onlineSessionStartedAt = 0L

    private lateinit var connectionRef: DatabaseReference
    private val connectionListener = object : ValueEventListener {
        override fun onDataChange(snapshot: DataSnapshot) {
            firebaseConnected = snapshot.getValue(Boolean::class.java) == true
            if (!firebaseConnected) {
                onlineSessionStartedAt = 0L
                return
            }
            if (listenerActive && onlineSessionStartedAt == 0L) {
                // Start a fresh online session. Any notification posted before this time is dropped,
                // even if Android happens to report it again after reconnecting.
                onlineSessionStartedAt = System.currentTimeMillis()
                publishHeartbeat()
            }
        }
        override fun onCancelled(error: DatabaseError) {
            firebaseConnected = false
            onlineSessionStartedAt = 0L
            android.util.Log.w(TAG, "Firebase connection state listener cancelled: ${error.message}")
        }
    }

    private val heartbeatTask = object : Runnable {
        override fun run() {
            publishHeartbeat()
            mainHandler.postDelayed(this, HEARTBEAT_INTERVAL_MS)
        }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        listenerActive = true
        if (::connectionRef.isInitialized) connectionRef.removeEventListener(connectionListener)
        connectionRef = FirebaseDatabase.getInstance().getReference(".info/connected")
        connectionRef.addValueEventListener(connectionListener)
        mainHandler.removeCallbacks(heartbeatTask)
        mainHandler.postDelayed(heartbeatTask, HEARTBEAT_INTERVAL_MS)
    }

    override fun onListenerDisconnected() {
        listenerActive = false
        onlineSessionStartedAt = 0L
        mainHandler.removeCallbacks(heartbeatTask)
        // Best-effort immediate disable via REST (no offline queue). Otherwise heartbeat ages out.
        val uid = FirebaseAuth.getInstance().currentUser?.uid
        if (!uid.isNullOrBlank() && hasValidatedInternet()) {
            FirebaseAuth.getInstance().currentUser?.getIdToken(false)
                ?.addOnSuccessListener { result ->
                    val token = result.token ?: return@addOnSuccessListener
                    ioExecutor.execute {
                        if (!hasValidatedInternet()) return@execute
                        val offline = JSONObject()
                            .put("enabled", false)
                            .put("lastSeenAt", JSONObject().put(".sv", "timestamp"))
                            .put("appVersion", BuildConfig.VERSION_NAME)
                            .put("deviceModel", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
                        restPut(uid, "reader_devices/$uid.json", token, offline, ifMatch = null, requireFirebaseConnection = false)
                    }
                }
        }
        // firebaseConnected tracks Firebase only; the separate listenerActive flag tracks this service.
        super.onListenerDisconnected()
        requestRebind(ComponentName(this, PaymentNotificationListener::class.java))
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val now = System.currentTimeMillis()
        val postedAt = sbn.postTime
        // Drop notifications that were already present before the Reader came online.
        if (postedAt <= 0L || postedAt > now + 60_000L || now - postedAt > MAX_NOTIFICATION_AGE_MS) return
        val sessionStartedAt = onlineSessionStartedAt
        if (sessionStartedAt <= 0L || postedAt < sessionStartedAt) return
        if (!canUploadImmediately()) return

        val extras: Bundle = sbn.notification.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty().trim()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString().orEmpty()
        val textLines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
            ?.joinToString(" ") { it.toString() }.orEmpty()
        val combined = listOf(text, bigText, textLines).filter { it.isNotBlank() }.joinToString(" ")

        // Require the official app package ID, or an exact sender label inside an SMS app.
        // A phone-number sender, contact name, other messaging app, or a message merely
        // containing the word "Nagad"/"bKash" is intentionally rejected.
        val provider = detectProvider(sbn.packageName, title) ?: return
        if (isOutgoingTransactionNotification(combined)) return
        if (!isIncomingTransactionNotification(combined)) return
        val txnId = parseTransactionId(combined) ?: return
        val amount = parseAmount(combined)
        if (!canUploadImmediately()) return

        ensureSignedIn { uid ->
            if (!canUploadImmediately()) return@ensureSignedIn
            val event = JSONObject()
                .put("transactionId", txnId)
                .put("provider", provider)
                .put("currency", "BDT")
                .put("verificationStatus", "pending_review")
                .put("sourcePackage", sbn.packageName.take(160))
                .put("capturedAt", now)
                .put("notificationPostedAt", postedAt)
                .put("source", if (isMessagingPackage(sbn.packageName)) "android_sms_sender_id" else "official_provider_app")
                .put("appVersion", BuildConfig.VERSION_NAME)
            if (amount != null && amount > 0.0) event.put("amount", amount)

            FirebaseAuth.getInstance().currentUser?.getIdToken(false)
                ?.addOnSuccessListener { result ->
                    val token = result.token ?: return@addOnSuccessListener
                    ioExecutor.execute {
                        // Recheck immediately before network I/O. Nothing is locally queued on failure.
                        if (!canUploadImmediately()) return@execute
                        putEventIfAbsent(uid, txnId, event, token)
                    }
                }
                ?.addOnFailureListener { error ->
                    android.util.Log.w(TAG, "Could not get Firebase token; event was dropped: ${error.message}")
                }
        }
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(heartbeatTask)
        listenerActive = false
        firebaseConnected = false
        onlineSessionStartedAt = 0L
        if (::connectionRef.isInitialized) connectionRef.removeEventListener(connectionListener)
        ioExecutor.shutdownNow()
        super.onDestroy()
    }

    private fun ensureSignedIn(onReady: (String) -> Unit) {
        val auth = FirebaseAuth.getInstance()
        val current = auth.currentUser
        if (current != null) {
            onReady(current.uid)
            return
        }
        if (!canUploadImmediately()) return
        auth.signInAnonymously()
            .addOnSuccessListener { result -> result.user?.uid?.let(onReady) }
            .addOnFailureListener { error -> android.util.Log.e(TAG, "Firebase anonymous sign-in failed; event dropped", error) }
    }

    private fun publishHeartbeat() {
        if (!canUploadImmediately()) return
        ensureSignedIn { uid ->
            if (!canUploadImmediately()) return@ensureSignedIn
            FirebaseAuth.getInstance().currentUser?.getIdToken(false)
                ?.addOnSuccessListener { result ->
                    val token = result.token ?: return@addOnSuccessListener
                    ioExecutor.execute {
                        if (!canUploadImmediately()) return@execute
                        val heartbeat = JSONObject()
                            .put("enabled", true)
                            .put("lastSeenAt", JSONObject().put(".sv", "timestamp"))
                            .put("appVersion", BuildConfig.VERSION_NAME)
                            .put("deviceModel", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
                        restPut(uid, "reader_devices/$uid.json", token, heartbeat, ifMatch = null)
                    }
                }
                ?.addOnFailureListener { error -> android.util.Log.w(TAG, "Heartbeat token request failed: ${error.message}") }
        }
    }

    private fun canUploadImmediately(): Boolean =
        listenerActive && firebaseConnected && onlineSessionStartedAt > 0L && hasValidatedInternet()

    private fun hasValidatedInternet(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val active = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(active) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun putEventIfAbsent(uid: String, txnId: String, event: JSONObject, token: String) {
        if (!canUploadImmediately()) return
        // null_etag creates the event only if the path is currently empty. Existing events,
        // including already reviewed ones, cannot be overwritten by another notification.
        val result = restPut(uid, "reader_events/$uid/$txnId.json", token, event, ifMatch = "null_etag")
        when (result) {
            200 -> android.util.Log.i(TAG, "Online provider notification uploaded: $txnId")
            412 -> android.util.Log.i(TAG, "Duplicate TxnID ignored: $txnId")
            -1 -> android.util.Log.w(TAG, "Offline/disconnected at upload time; payment event dropped: $txnId")
            else -> android.util.Log.w(TAG, "Reader event upload failed with HTTP $result; no offline queue created")
        }
    }

    private fun restPut(
        uid: String,
        path: String,
        token: String,
        body: JSONObject,
        ifMatch: String?,
        requireFirebaseConnection: Boolean = true
    ): Int {
        var connection: HttpURLConnection? = null
        return try {
            if (!hasValidatedInternet() || (requireFirebaseConnection && !canUploadImmediately())) return -1
            val base = FirebaseDatabase.getInstance().reference.toString().trimEnd('/')
            val encodedToken = URLEncoder.encode(token, "UTF-8")
            connection = (URL("$base/$path?auth=$encodedToken").openConnection() as HttpURLConnection).apply {
                requestMethod = "PUT"
                connectTimeout = HTTP_TIMEOUT_MS
                readTimeout = HTTP_TIMEOUT_MS
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                if (ifMatch != null) setRequestProperty("if-match", ifMatch)
            }
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            connection.responseCode
        } catch (error: Exception) {
            android.util.Log.w(TAG, "REST write did not complete; nothing is queued for later: ${error.message}")
            -1
        } finally {
            connection?.disconnect()
        }
    }

    private fun detectProvider(packageName: String, notificationTitle: String): String? {
        val sourcePackage = packageName.trim()
        if (sourcePackage.equals(OFFICIAL_NAGAD_PACKAGE, ignoreCase = true)) return "nagad"
        if (sourcePackage.equals(OFFICIAL_BKASH_PACKAGE, ignoreCase = true)) return "bkash"

        if (isMessagingPackage(sourcePackage)) {
            // Strict sender-ID allowlist: numeric senders, contact names, and all other IDs are ignored.
            return when (notificationTitle.trim().uppercase(Locale.ROOT)) {
                "NAGAD" -> "nagad"
                "BKASH" -> "bkash"
                else -> null
            }
        }
        return null
    }

    private fun isMessagingPackage(packageName: String): Boolean {
        val sourcePackage = packageName.lowercase(Locale.ROOT)
        return sourcePackage.contains("messag") || sourcePackage.contains("mms") || sourcePackage.contains("sms")
    }

    private fun isOutgoingTransactionNotification(text: String): Boolean {
        val value = text.lowercase(Locale.ROOT)
        val outgoingMarkers = listOf(
            "you have sent", "you sent", "sent tk", "cash out", "send money", "payment to", "paid to", "you paid", "transfer to",
            "আপনি পাঠিয়েছেন", "আপনি পাঠিয়েছেন", "টাকা পাঠিয়েছেন", "টাকা পাঠিয়েছেন", "টাকা পাঠানো হয়েছে", "টাকা পাঠানো হয়েছে"
        )
        return outgoingMarkers.any { value.contains(it) }
    }

    private fun isIncomingTransactionNotification(text: String): Boolean {
        val value = text.lowercase(Locale.ROOT)
        val incomingMarkers = listOf(
            "you have received", "you received", "received tk", "received ৳", "cash in", "money received", "payment received", "amount received", "credited", "account credited", "deposit received",
            "টাকা পেয়েছেন", "টাকা পেয়েছেন", "পেয়েছেন", "পেয়েছেন", "টাকা জমা", "জমা হয়েছে", "জমা হয়েছে", "ক্রেডিট হয়েছে", "ক্রেডিট হয়েছে"
        )
        return incomingMarkers.any { value.contains(it) }
    }

    private fun parseTransactionId(text: String): String? {
        val match = TXN_REGEX.find(text) ?: return null
        val value = match.groupValues.getOrNull(1)?.trim().orEmpty().uppercase(Locale.ROOT)
        return value.takeIf { it.matches(Regex("^[A-Z0-9_-]{3,64}$")) }
    }

    private fun parseAmount(text: String): Double? {
        val match = AMOUNT_REGEX.find(text) ?: return null
        val raw = listOf(match.groupValues.getOrNull(1), match.groupValues.getOrNull(2))
            .filterNotNull().firstOrNull { it.isNotBlank() } ?: return null
        return raw.replace(",", "").toDoubleOrNull()
    }

    companion object {
        private const val TAG = "PaymentReader"
        private const val HEARTBEAT_INTERVAL_MS = 60_000L
        private const val MAX_NOTIFICATION_AGE_MS = 120_000L
        private const val HTTP_TIMEOUT_MS = 5_000
        // Official Play Store package IDs, exact match only.
        private const val OFFICIAL_NAGAD_PACKAGE = "com.konasl.nagad"
        private const val OFFICIAL_BKASH_PACKAGE = "com.bKash.customerapp"
        private val TXN_REGEX = Regex(
            "(?i)\\b(?:trx\\s*(?:id)?|txn\\s*(?:id)?|transaction\\s*id)\\s*(?:is\\s*)?[:#-]?\\s*([A-Z0-9_-]{3,64})\\b"
        )
        private val AMOUNT_REGEX = Regex(
            "(?i)(?:৳|tk\\.?|bdt)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)|([0-9][0-9,]*(?:\\.[0-9]{1,2})?)\\s*(?:৳|tk\\.?|bdt)"
        )
    }
}
