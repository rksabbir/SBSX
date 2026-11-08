package com.example.paymentreader

import android.app.Activity
import android.content.Intent
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.FirebaseDatabase

class MainActivity : Activity() {
    private lateinit var statusText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1001)
        }
        signInAndShowStatus()
    }

    override fun onResume() {
        super.onResume()
        if (::statusText.isInitialized) updateListenerStatus()
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(32, 48, 32, 48)
        }
        val heading = TextView(this).apply {
            text = "Payment Reader"
            textSize = 28f
            gravity = Gravity.CENTER
        }
        statusText = TextView(this).apply {
            textSize = 16f
            gravity = Gravity.CENTER
            setPadding(0, 24, 0, 24)
        }
        val enableButton = Button(this).apply {
            text = "Enable notification access"
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
        }
        val refreshButton = Button(this).apply {
            text = "Refresh status"
            setOnClickListener { signInAndShowStatus() }
        }
        val copyUidButton = Button(this).apply {
            text = "Copy trusted Reader UID"
            setOnClickListener {
                val uid = FirebaseAuth.getInstance().currentUser?.uid
                if (uid.isNullOrBlank()) {
                    Toast.makeText(this@MainActivity, "Firebase এখনো connected নয়", Toast.LENGTH_SHORT).show()
                } else {
                    val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("Payment Reader UID", uid))
                    Toast.makeText(this@MainActivity, "UID copied. Bot server-এর PAYMENT_READER_UIDS-এ বসান।", Toast.LENGTH_LONG).show()
                }
            }
        }
        root.addView(heading)
        root.addView(statusText)
        root.addView(enableButton)
        root.addView(refreshButton)
        root.addView(copyUidButton)
        setContentView(root)
    }

    private fun signInAndShowStatus() {
        statusText.text = "Connecting to Firebase…"
        val auth = FirebaseAuth.getInstance()
        if (auth.currentUser != null) {
            reportStartup(auth.currentUser!!.uid)
            updateListenerStatus()
            return
        }
        auth.signInAnonymously()
            .addOnSuccessListener { result ->
                val uid = result.user?.uid ?: ""
                if (uid.isNotBlank()) reportStartup(uid)
                updateListenerStatus()
            }
            .addOnFailureListener { error ->
                statusText.text = "Firebase sign-in failed: ${error.localizedMessage ?: "unknown error"}\nCheck google-services.json and enable Anonymous Authentication."
            }
    }

    private fun reportStartup(uid: String) {
        // Store only device metadata here. The notification listener service alone publishes
        // the online heartbeat; opening the UI must not make a disconnected listener look online.
        val ref = FirebaseDatabase.getInstance().reference.child("reader_devices").child(uid)
        ref.updateChildren(mapOf(
            "appVersion" to BuildConfig.VERSION_NAME,
            "deviceModel" to "${Build.MANUFACTURER} ${Build.MODEL}"
        ))
    }

    private fun updateListenerStatus() {
        val listenerOn = notificationListenerEnabled()
        val signedIn = FirebaseAuth.getInstance().currentUser != null
        val readerUid = FirebaseAuth.getInstance().currentUser?.uid
        statusText.text = buildString {
            append(if (signedIn) "Firebase: connected\n" else "Firebase: disconnected\n")
            append(if (listenerOn) "Notification access: enabled\n" else "Notification access: NOT enabled\n")
            append("Trusted Reader UID: ${readerUid ?: "not signed in"}\n\n")
            append("Online uploads only: notifications arriving while offline are dropped and are not synced later.")
        }
    }

    private fun notificationListenerEnabled(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        return enabled.contains(packageName + "/" + PaymentNotificationListener::class.java.name)
    }
}
