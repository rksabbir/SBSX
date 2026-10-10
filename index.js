require("dotenv").config();
// ================================
// 🚀 PART 1 - Setup + Express + Firebase + Config
// ================================

const express = require("express");
const http = require("http");
const { spawn } = require("child_process");
const { WebSocketServer, WebSocket } = require("ws");
const fs = require("fs");
const crypto = require("crypto");
const { promisify } = require("util");
const os = require("os");
const { Readable } = require("stream");
const admin = require("firebase-admin"); // Firebase Admin SDK

const {
    Client,
    GatewayIntentBits,
    Partials,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ActivityType,
    StringSelectMenuBuilder,
    PermissionFlagsBits,
    ChannelType,
    Routes,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require("discord.js");

// html-transcripts ইম্পোর্ট
const discordTranscripts = require("discord-html-transcripts");
const {
    isValidDiscordSnowflake,
    isSafeDiscordActionRole,
    isProtectedDiscordTarget,
    isAssignableDiscordRole
} = require("./discord-admin-policy");
const { sanitizeVoiceSpeech, formatVerifiedAnnouncement, formatRoleChangeAnnouncement, formatLevelUpAnnouncement } = require("./discord-bengali-automation");
const { normalizeRecorderMimeType, extractOneTimeTicketFromProtocols, packRemotePcmFrame } = require("./live-voice-protocol");
const { createLivePcmAudioProcess } = require("./live-voice-pcm-stream");
const { normalizeStudioName, studioInviteDigest, isValidStudioInviteCode, isGuestStudioIdentity, buildStudioVideoGrant, isLiveStudioVoiceBound } = require("./live-studio-policy");

// রেনডার Environment Variable থেকে অবজেক্ট লোড করার লজিক
let serviceAccount;
try {
    if (process.env.FIREBASE_CONFIG) {
        serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
    } else {
        serviceAccount = require("./firebase-service-account.json");
    }
} catch (e) {
    console.error("❌ Firebase config load failed. Set FIREBASE_CONFIG or add firebase-service-account.json.", e.message);
    process.exit(1);
}

const firebaseURL = process.env.FIREBASE_DB_URL;
if (!serviceAccount || !firebaseURL || !/^https?:\/\//i.test(firebaseURL)) {
    console.error("❌ Firebase configuration is incomplete. FIREBASE_CONFIG (or firebase-service-account.json) and a valid FIREBASE_DB_URL are required.");
    process.exit(1);
}

// ফায়ারবেস ইনিশিয়ালাইজেশন
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: firebaseURL
});
const db = admin.database();
const scryptAsync = promisify(crypto.scrypt);

// C++ app account passwords are stored as scrypt hashes after first successful login.
// Existing plaintext records are verified once and migrated automatically.
async function hashCppPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const derived = await scryptAsync(String(password), salt, 64);
    return `scrypt$${salt}$${Buffer.from(derived).toString("hex")}`;
}
async function verifyCppPassword(password, record) {
    if (record && typeof record.passwordHash === "string") {
        const parts = record.passwordHash.split("$");
        if (parts.length !== 3 || parts[0] !== "scrypt" || !/^[a-f0-9]{32}$/i.test(parts[1]) || !/^[a-f0-9]{128}$/i.test(parts[2])) return false;
        const derived = Buffer.from(await scryptAsync(String(password), parts[1], 64));
        const stored = Buffer.from(parts[2], "hex");
        return derived.length === stored.length && crypto.timingSafeEqual(derived, stored);
    }
    if (!record || typeof record.password !== "string") return false;
    const supplied = Buffer.from(String(password), "utf8");
    const stored = Buffer.from(record.password, "utf8");
    return supplied.length === stored.length && crypto.timingSafeEqual(supplied, stored);
}
function validRtdbSegment(value, max = 128) {
    return typeof value === "string" && value.length > 0 && value.length <= max && !/[.#$\[\]\/]/.test(value);
}
function makeCppUid(kind, identifier) {
    return `cpp${kind}_${crypto.createHash("sha256").update(`${kind}:${identifier}`).digest("hex").slice(0, 48)}`;
}
function getSafeCppProfile(uid, record, kind = "user", extra = {}) {
    const source = record && typeof record === "object" ? record : {};
    const now = Date.now();
    const expiresAt = Number(source.expiresAt) || 0;
    const rawStatus = String(source.status || (kind === "key" ? "VIP Access" : "active")).slice(0, 60);
    const expired = expiresAt > 0 && expiresAt <= now;
    const active = !!record && (kind === "key"
        ? isCppKeyUsable(source, now) && !!source.used
        : rawStatus.toLowerCase() === "active" && !expired);
    return {
        uid,
        username: String(source.username || source.discordUsername || source.generatedBy || (kind === "key" ? "VIP User" : "")).slice(0, 80),
        discordUsername: String(source.discordUsername || source.username || source.generatedBy || "").slice(0, 80),
        status: !record ? "revoked" : (expired ? "expired" : (active ? rawStatus : (kind === "key" ? "revoked" : rawStatus))),
        category: String(source.category || (kind === "key" ? "1-Time Key" : "Standard")).slice(0, 80),
        avatarUrl: String(source.avatarUrl || "").slice(0, 1000),
        serverName: String(source.serverName || "").slice(0, 160),
        usedKey: String(extra.usedKey || "").slice(0, 100),
        isDevKeyUser: kind === "key",
        expiresAt,
        remainingDays: expiresAt > now ? Math.floor((expiresAt - now) / 86400000) : 0,
        accessRevoked: !active,
        updatedAt: now
    };
}
const cppProfileWatchers = new Map();
const cppProfileFingerprints = new Map();
async function publishCppProfile(uid, profile) {
    const comparable = { ...profile };
    delete comparable.updatedAt; // Heartbeats change lastActive, not the visible profile; avoid noisy writes/events.
    const fingerprint = JSON.stringify(comparable);
    if (cppProfileFingerprints.get(uid) === fingerprint) return;
    const next = { ...profile, updatedAt: Date.now() };
    await db.ref(`cppProfiles/${uid}`).set(next);
    cppProfileFingerprints.set(uid, fingerprint);
}
function watchCppUserProfile(username, uid) {
    const watcherKey = `user:${username}`;
    if (cppProfileWatchers.has(watcherKey)) {
        cppProfileWatchers.get(watcherKey).lastActiveAt = Date.now();
        return;
    }
    const ref = db.ref(`users/${username}`);
    const handler = snapshot => {
        const record = snapshot.val();
        const profile = getSafeCppProfile(uid, record, "user");
        publishCppProfile(uid, profile).catch(err => console.error("C++ profile mirror failed:", err.message));
    };
    ref.on("value", handler, err => console.error("C++ profile mirror listener failed:", err.message));
    cppProfileWatchers.set(watcherKey, { ref, handler, uid, lastActiveAt: Date.now() });
}
function watchCppKeyProfile(key, uid) {
    const watcherKey = `key:${key}`;
    if (cppProfileWatchers.has(watcherKey)) {
        cppProfileWatchers.get(watcherKey).lastActiveAt = Date.now();
        return;
    }
    const ref = db.ref(`keys/${key}`);
    const handler = snapshot => {
        const record = snapshot.val();
        const profile = getSafeCppProfile(uid, record, "key", { usedKey: key });
        publishCppProfile(uid, profile).catch(err => console.error("C++ key profile mirror failed:", err.message));
    };
    ref.on("value", handler, err => console.error("C++ key profile mirror listener failed:", err.message));
    cppProfileWatchers.set(watcherKey, { ref, handler, uid, lastActiveAt: Date.now() });
}
function stopCppProfileWatcher(watcherKey, uid) {
    const watcher = cppProfileWatchers.get(watcherKey);
    if (watcher) {
        watcher.ref.off("value", watcher.handler);
        cppProfileWatchers.delete(watcherKey);
    }
    if (uid) {
        cppProfileFingerprints.delete(uid);
        db.ref(`cppProfiles/${uid}`).remove().catch(err => console.error("C++ profile cleanup failed:", err.message));
    }
}
const cppProfilePruneTimer = setInterval(() => {
    const staleBefore = Date.now() - 120000;
    for (const [key, watcher] of cppProfileWatchers) {
        if (watcher.lastActiveAt < staleBefore) {
            watcher.ref.off("value", watcher.handler);
            cppProfileWatchers.delete(key);
        }
    }
}, 60000);
if (typeof cppProfilePruneTimer.unref === "function") cppProfilePruneTimer.unref();

// Only explicitly trusted Reader device UIDs can make checkout show a payment number.
// Set PAYMENT_READER_UIDS on the bot server to the UID displayed by the Android Reader app.
const TRUSTED_READER_UIDS = new Set(
    String(process.env.PAYMENT_READER_UIDS || "").split(",").map(value => value.trim()).filter(Boolean)
);
const READER_ONLINE_WINDOW_MS = Math.max(30_000, Number(process.env.READER_ONLINE_WINDOW_MS || 90_000));
const READER_RECHECK_COOLDOWN_MS = Math.max(10_000, Number(process.env.READER_RECHECK_COOLDOWN_MS || 15_000));
const READER_AUTO_WATCH_INTERVAL_MS = Math.max(10_000, Number(process.env.READER_AUTO_WATCH_INTERVAL_MS || 15_000));
const READER_AUTO_WATCH_TIMEOUT_MS = Math.max(60_000, Number(process.env.READER_AUTO_WATCH_TIMEOUT_MS || 300_000));
const readerWatchLocks = new Set();
const readerCheckLocks = new Set();
const readerCheckLastAt = new Map();
// Firebase-backed lease prevents a crashed/stale checkout from remaining "checking_reader" forever.
const READER_CHECK_LEASE_MS = Math.max(30_000, Number(process.env.READER_CHECK_LEASE_MS || 60_000));

const { claimReaderCheckState, finishReaderCheckState, releaseReaderCheckState } = require("./reader-check-state");
const { isCppKeyUsable } = require("./cpp-key-state");
const { getPaymentTxnSubmitCooldownMs } = require("./runtime-limits");
const { paymentTxnLocks, paymentTxnLastAt } = require("./payment-txn-state");
const PAYMENT_TXN_SUBMIT_COOLDOWN_MS = getPaymentTxnSubmitCooldownMs(process.env.PAYMENT_TXN_SUBMIT_COOLDOWN_MS);

async function getPaymentReaderState() {
    if (TRUSTED_READER_UIDS.size === 0) {
        return { online: false, lastSeenAt: null, deviceUid: null, reason: "trusted_reader_not_configured" };
    }
    try {
        const checks = await Promise.all([...TRUSTED_READER_UIDS].map(async uid => {
            const snap = await db.ref(`reader_devices/${uid}`).once("value");
            return { uid, record: snap.val() || null };
        }));
        const now = Date.now();
        const onlineRecords = checks.filter(({ record }) => {
            const lastSeenAt = Number(record && record.lastSeenAt);
            return !!record && record.enabled === true && Number.isFinite(lastSeenAt) &&
                lastSeenAt > 0 && (now - lastSeenAt) >= 0 && (now - lastSeenAt) <= READER_ONLINE_WINDOW_MS;
        }).sort((a, b) => Number(b.record.lastSeenAt) - Number(a.record.lastSeenAt));
        if (!onlineRecords.length) return { online: false, lastSeenAt: null, deviceUid: null, reason: "heartbeat_missing_or_stale" };
        return { online: true, lastSeenAt: Number(onlineRecords[0].record.lastSeenAt), deviceUid: onlineRecords[0].uid, reason: null };
    } catch (err) {
        console.error("Payment Reader status lookup failed:", err.message);
        return { online: false, lastSeenAt: null, deviceUid: null, reason: "firebase_error" };
    }
}

function normalizeBangladeshPaymentNumber(value) {
    const raw = String(value || "").trim();
    if (!raw || /x{3,}|your|paste|placeholder/i.test(raw)) return "";
    const digits = raw.replace(/\D/g, "");
    if (/^01[3-9]\d{8}$/.test(digits)) return digits;
    if (/^8801[3-9]\d{8}$/.test(digits)) return `+${digits}`;
    return "";
}
let PAYMENT_NUMBERS = {
    bkash: normalizeBangladeshPaymentNumber(process.env.BKASH_PAYMENT_NUMBER),
    nagad: normalizeBangladeshPaymentNumber(process.env.NAGAD_PAYMENT_NUMBER)
};
let LEGACY_PAYMENT_NUMBERS = { ...PAYMENT_NUMBERS };
let PAYMENT_INSTRUCTIONS = "";
const DEFAULT_PACKAGE_PRICES = { weekly: 510, monthly: 1510, "2_months": 2410 };
let PACKAGE_PRICES = { ...DEFAULT_PACKAGE_PRICES };
let PACKAGE_ENABLED = { weekly: true, monthly: true, "2_months": true };
let ADMIN_BOT_CONFIG = {
    features: {
        paymentBotEnabled: true, checkoutEnabled: true, maintenanceMode: false,
        autoCouponEnabled: true, giveawayEnabled: true, ticketPanelEnabled: true,
        verificationEnabled: true, automodEnabled: true, levelingEnabled: true,
        weeklyReportEnabled: true, voiceStatsEnabled: true,
        capsProtectionEnabled: true, antiLinkEnabled: true, badWordsFilterEnabled: true,
        spamProtectionEnabled: true, linkResponseEnabled: true, ghostPingEnabled: true,
        welcomeSystemEnabled: true, leaveTrackingEnabled: true, oneTimeKeyEnabled: true,
        profileSyncEnabled: true, orderTrackingEnabled: true, transcriptLogsEnabled: true
    },
    checkout: { readerRequired: true, allowPartialPayments: true, sessionExpiryHours: 24 },
    coupons: { enabled: true, overpaymentMode: "auto", expiryDays: 90 },
    automod: { maxUppercaseRatio: 0.7, minCapsLetters: 6, spamCount: 5, spamWindowSeconds: 5, warningLimit: 3, timeoutMinutes: 10, blockedWords: ["gali1", "gali2", "gali3", "khanki", "magi", "baimon"] },
    leveling: { xpMin: 5, xpMax: 9, xpPerLevelBase: 100 },
    links: { verificationLink: "" },
    presence: { status: "online", activityType: "Watching", activityText: "Security & Verification" },
    messages: {
        welcomeTitle: "🎉 নতুন সদস্য ট্র্যাকিং সিস্টেম",
        welcomeDescription: "✨ স্বাগতম {user} আমাদের সার্ভারে!\n📜 আমাদের নিয়মগুলো মেনে চলার অনুরোধ রইল। ❤️",
        verifyTitle: "🚨 Verification Required",
        verifyDescription: "👇 নিচের বাটনে ক্লিক করে ভেরিফাই করুন",
        verificationSuccess: "✅ সফলভাবে ভেরিফাই সম্পন্ন হয়েছে!",
        capsWarning: "⚠️ <@{user}>, মেসেজে অতিরিক্ত বড় হাতের অক্ষর (Caps Lock) ব্যবহার করবেন না।",
        linkWarning: "⚠️ <@{user}>, সার্ভারে বাইরের লিংক পোস্ট করা নিষিদ্ধ!",
        automodWarning: "⚠️ <@{user}>, সার্ভারে **{reason}** নিষিদ্ধ! আপনি এটি **{warns}/{limit}** বার করেছেন।",
        timeoutTitle: "🚫 মেম্বার মিউটেড",
        timeoutDescription: "<@{user}> কে {minutes} মিনিটের জন্য মিউট করা হয়েছে।",
        levelUp: "🎉 অভিনন্দন <@{user}>! আপনি লেভেল **{level}** এ উন্নীত হয়েছেন।",
        checkoutUnavailable: "🛠️ Shop checkout বর্তমানে বন্ধ অথবা maintenance mode চালু আছে। পরে আবার চেষ্টা করুন।"
    },
    discord: { channels: {}, roles: {} }
};
let adminConfigLoaded = false;
function isFeatureEnabled(name) {
    const features = ADMIN_BOT_CONFIG.features || {};
    if (name === "maintenanceMode") return features.maintenanceMode === true;
    return features[name] !== false;
}
function isCheckoutAllowed() {
    return isFeatureEnabled("paymentBotEnabled") && isFeatureEnabled("checkoutEnabled") && !isFeatureEnabled("maintenanceMode");
}
function getCheckoutSettings() {
    const cfg = ADMIN_BOT_CONFIG.checkout || {};
    const sessionExpiryHours = Number(cfg.sessionExpiryHours);
    return {
        readerRequired: true, // Fail-closed is intentionally enforced until an alternate trusted verification source exists.
        allowPartialPayments: cfg.allowPartialPayments !== false,
        sessionExpiryHours: Number.isFinite(sessionExpiryHours) ? Math.max(1, Math.min(720, sessionExpiryHours)) : 24
    };
}
function formatBotMessage(key, fallback, values = {}) {
    let template = String(ADMIN_BOT_CONFIG.messages?.[key] || fallback || "").slice(0, 4000);
    for (const [name, value] of Object.entries(values)) {
        template = template.split(`{${name}}`).join(String(value ?? ""));
    }
    return template;
}
function isPackageEnabled(category) {
    const normalized = getNormalizedCategory(category);
    return PACKAGE_ENABLED[normalized] !== false;
}
function getPaymentNumber(provider) {
    return PAYMENT_NUMBERS[String(provider || "").toLowerCase()] || "";
}
function getProviderLabel(provider) {
    return provider === "bkash" ? "bKash" : provider === "nagad" ? "Nagad" : "Unknown";
}

async function findTrustedReaderEvent(txnId) {
    const normalizedTxnId = String(txnId || "").trim().toUpperCase();
    if (!normalizedTxnId || TRUSTED_READER_UIDS.size === 0) return null;
    const snapshots = await Promise.all([...TRUSTED_READER_UIDS].map(async uid => {
        const snap = await db.ref(`reader_events/${uid}`).once("value");
        return { uid, events: snap.val() || {} };
    }));
    for (const { uid, events } of snapshots) {
        for (const [eventKey, event] of Object.entries(events)) {
            const id = String((event && event.transactionId) || eventKey).trim().toUpperCase();
            if (event && id === normalizedTxnId) return { uid, eventKey, event };
        }
    }
    return null;
}

async function waitForTrustedReaderEvent(txnId, waitMs = 12_000, intervalMs = 1_500) {
    const stopAt = Date.now() + waitMs;
    do {
        const match = await findTrustedReaderEvent(txnId);
        if (match) return match;
        if (Date.now() < stopAt) await new Promise(resolve => setTimeout(resolve, intervalMs));
    } while (Date.now() < stopAt);
    return null;
}

async function autoWatchReaderOnline(interaction, category, sessionRef, provider) {
    const sessionKey = `${interaction.user.id}:${category}`;
    if (readerWatchLocks.has(sessionKey)) return;
    readerWatchLocks.add(sessionKey);
    const initialSnap = await sessionRef.once("value").catch(() => null);
    const initialSession = initialSnap?.val() || null;
    const initialCreatedAt = Number(initialSession?.createdAt) || 0;
    const deadline = Date.now() + READER_AUTO_WATCH_TIMEOUT_MS;
    try {
        if (!initialCreatedAt || String(initialSession?.provider || "") !== provider) return;
        while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, READER_AUTO_WATCH_INTERVAL_MS));
            const snap = await sessionRef.once("value");
            const current = snap.val();
            if (!current || Number(current.createdAt) !== initialCreatedAt || String(current.provider || "") !== provider) return;
            if (["creating", "completed"].includes(String(current.status || ""))) return;
            if (current.status === "awaiting_txn" && Number(current.numberShownAt) > 0) return;

            const readerState = await getPaymentReaderState();
            if (!readerState.online) continue;

            const paymentNumber = getPaymentNumber(provider);
            const updatedSession = {
                ...current,
                lastReaderCheckAt: Date.now(),
                readerCheckedAt: Date.now()
            };
            if (paymentNumber) {
                updatedSession.status = "awaiting_txn";
                updatedSession.readerDeviceUid = readerState.deviceUid;
                updatedSession.numberShownAt = Date.now();
            } else {
                updatedSession.status = "number_not_configured";
            }
            await sessionRef.update(updatedSession);
            await interaction.editReply({ content: "", ...buildPaymentPage(category, updatedSession, readerState, paymentNumber) });
            return;
        }

        const finalSnap = await sessionRef.once("value").catch(() => null);
        const finalSession = finalSnap?.val() || null;
        if (!finalSession || Number(finalSession.createdAt) !== initialCreatedAt || String(finalSession.provider || "") !== provider || ["creating", "completed"].includes(String(finalSession.status || ""))) return;
        const providerLabel = getProviderLabel(provider);
        const timeoutEmbed = new EmbedBuilder()
            .setTitle("🟠 ONLINE CHECK — Reader এখনও offline")
            .setDescription(
                `📦 **প্যাকেজ:** \`${String(category).toUpperCase()}\`\n` +
                `💳 **পেমেন্ট:** ${providerLabel}\n\n` +
                `${Math.round(READER_AUTO_WATCH_TIMEOUT_MS / 60000)} মিনিটের মধ্যে trusted Reader online পাওয়া যায়নি। নিরাপত্তার জন্য নম্বর দেখানো হয়নি। Reader online হওয়ার পর Shop থেকে package নির্বাচন করে নতুন checkout শুরু করুন। এই page-এ বারবার click করার দরকার নেই।`
            )
            .setColor("Orange").setTimestamp();
        await interaction.editReply({ content: "", embeds: [timeoutEmbed], components: [] });
    } catch (err) {
        console.error("Automatic Reader online watch failed:", err.message);
        // Keep the last fail-closed ONLINE CHECK page visible; never reveal a number on an error.
    } finally {
        readerWatchLocks.delete(sessionKey);
    }
}

function buildPaymentPage(category, session, readerState, providerNumber) {
    const provider = String(session.provider || "").toLowerCase();
    const providerLabel = getProviderLabel(provider);
    const totalPaid = Number(session.totalPaid) || 0;
    const targetPrice = Math.max(0, Number(session.targetPrice) || 0);
    const basePrice = Math.max(0, Number(session.basePrice) || targetPrice);
    const appliedDiscount = Math.max(0, Number(session.appliedDiscount) || 0);
    const remainingDue = Math.max(0, targetPrice - totalPaid);

    if (!readerState.online) {
        const unconfigured = TRUSTED_READER_UIDS.size === 0;
        const reason = unconfigured
            ? "Payment Reader-এর trusted device UID server config-এ সেট করা নেই।"
            : "Payment Reader offline, অথবা heartbeat পুরোনো।";
        const autoCheckText = unconfigured
            ? "Server config-এ trusted Reader UID যোগ হলে auto-check কাজ করবে। এই অবস্থায় পেমেন্ট নম্বর লুকানো থাকবে।"
            : `Bot নিজে প্রতি ${Math.round(READER_AUTO_WATCH_INTERVAL_MS / 1000)} সেকেন্ডে ONLINE CHECK করবে (সর্বোচ্চ ${Math.round(READER_AUTO_WATCH_TIMEOUT_MS / 60000)} মিনিট)। আবার button click বা command করার দরকার নেই।`;
        const embed = new EmbedBuilder()
            .setTitle("🟠 ONLINE CHECK")
            .setDescription(
                `📦 **প্যাকেজ:** \`${String(category).toUpperCase()}\`\n` +
                `💳 **পেমেন্ট:** ${providerLabel}\n` +
                `💰 **বকেয়া:** \`${remainingDue}\` BDT\n\n` +
                `🔒 **পেমেন্ট নম্বর লুকানো আছে।** ${reason}\n` +
                autoCheckText
            )
            .setColor("Orange").setTimestamp();
        const offlineRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`offlinepay_request_${category}_${provider}`).setLabel("🧾 Offline payment request করুন").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`offlinepay_status_${category}`).setLabel("🔄 Request status দেখুন").setStyle(ButtonStyle.Primary)
        );
        return { embeds: [embed], components: [offlineRow] };

    }

    if (!providerNumber) {
        const embed = new EmbedBuilder()
            .setTitle("⚠️ ONLINE CHECK — নম্বর সেট করা নেই")
            .setDescription(`Reader অনলাইন, কিন্তু ${providerLabel}-এর payment number server environment-এ সেট করা নেই। নিরাপত্তার জন্য কোনো নম্বর দেখানো হয়নি।`)
            .setColor("Orange").setTimestamp();
        return { embeds: [embed], components: [] };
    }

    const isPartial = totalPaid > 0;
    const discountText = session.appliedCoupon
        ? `\n🎟️ **Coupon:** \`${String(session.appliedCoupon)}\` (ছাড়: ${Number(session.appliedDiscount) || 0} BDT)`
        : "";
    const embed = new EmbedBuilder()
        .setTitle(`💳 ${providerLabel} Payment — ${String(category).toUpperCase()}`)
        .setDescription(
            `🟢 **ONLINE CHECK: সফল** — Reader এখন অনলাইন।\n\n` +
            `📦 **প্যাকেজ:** \`${String(category).toUpperCase()}\`\n` +
            `💰 **প্যাকেজের মূল্য:** \`${basePrice}\` BDT\n` +
            (appliedDiscount > 0 ? `🎟️ **কুপন ছাড়:** \`${appliedDiscount}\` BDT\n` : "") +
            `💳 **ছাড়ের পর পরিশোধযোগ্য:** \`${targetPrice}\` BDT\n` +
            (isPartial ? `✅ **আগে পাওয়া পেমেন্ট:** \`${totalPaid}\` BDT\n📉 **এখন বকেয়া:** \`${remainingDue}\` BDT\n` : "") +
            `📱 **${providerLabel} নম্বর:** \`${providerNumber}\`\n` +
            (PAYMENT_INSTRUCTIONS ? `\n📝 **Payment Instructions:** ${PAYMENT_INSTRUCTIONS}\n` : "") +
            `\nটাকা পাঠানোর পর payment notification-এ পাওয়া Transaction ID নিচের বাটনে জমা দিন।` +
            discountText +
            `\n\n⚠️ TxnID trusted Reader notification-এর সঙ্গে স্বয়ংক্রিয়ভাবে মিলিয়ে দেখা হবে।`
        )
        .setColor("Green").setTimestamp();
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`submit_txn_${category}`).setLabel(isPartial ? "➕ Submit Additional TxnID" : "TxnID জমা দিন").setStyle(ButtonStyle.Primary)
    );
    return { embeds: [embed], components: [row] };
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "32kb", type: "application/json" }));
const ADMIN_PANEL_ORIGINS = new Set(String(process.env.ADMIN_PANEL_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean));
app.use((req, res, next) => {
    const origin = String(req.get("origin") || "");
    // Public, non-sensitive health probe: allow the panel to read it even when its origin
    // is misconfigured, so the UI can display the exact origin that must be allowlisted.
    // Authenticated account endpoints below still require an exact ADMIN_PANEL_ORIGINS match.
    if (req.path === "/api/cpp/health" && req.method === "GET") {
        res.set("Access-Control-Allow-Origin", "*");
        return next();
    }
    if (origin && ADMIN_PANEL_ORIGINS.has(origin)) {
        res.set("Access-Control-Allow-Origin", origin);
        res.set("Vary", "Origin");
        res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
        res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") return origin && ADMIN_PANEL_ORIGINS.has(origin) ? res.sendStatus(204) : res.sendStatus(403);
    return next();
});
app.get("/", (req, res) => { res.send("Bot is running!"); });
app.get("/api/cpp/health", (req, res) => {
    const origin = String(req.get("origin") || "");
    return res.json({ ok: true, service: "rkbackles-cpp-bridge", version: require("./package.json").version,
        panelOrigin: origin, corsAllowed: origin ? ADMIN_PANEL_ORIGINS.has(origin) : null });
});

// Small in-memory per-IP limiter for the C++ credential endpoints. Do not log request bodies.
const cppRateLimits = new Map();
function checkCppRateLimit(req, res, bucket, maximum = 8, windowMs = 10 * 60 * 1000) {
    const key = `${bucket}:${String(req.ip || req.socket.remoteAddress || "unknown")}`;
    const now = Date.now();
    let state = cppRateLimits.get(key);
    if (!state || state.resetAt <= now) state = { count: 0, resetAt: now + windowMs };
    state.count += 1;
    cppRateLimits.set(key, state);
    if (cppRateLimits.size > 5000) {
        for (const [storedKey, storedValue] of cppRateLimits) if (storedValue.resetAt <= now) cppRateLimits.delete(storedKey);
    }
    if (state.count > maximum) {
        res.set("Retry-After", String(Math.max(1, Math.ceil((state.resetAt - now) / 1000))));
        res.status(429).json({ ok: false, error: "rate_limited", message: "অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।" });
        return false;
    }
    return true;
}
function cppApiError(res, status, error, message) {
    return res.status(status).json({ ok: false, error, message });
}
async function createCppTokenReply(res, uid, customClaims, profile, sessionId) {
    const customToken = await admin.auth().createCustomToken(uid, customClaims);
    return res.json({ ok: true, uid, sessionId, customToken, profile });
}
function readBearerToken(req) {
    const header = String(req.get("authorization") || "");
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : "";
}
async function verifyAdminApiRequest(req) {
    const token = readBearerToken(req);
    if (!token) throw Object.assign(new Error("Missing admin bearer token"), { statusCode: 401 });
    let decoded;
    try {
        decoded = await admin.auth().verifyIdToken(token, true);
    } catch (_) {
        throw Object.assign(new Error("Invalid or expired admin bearer token"), { statusCode: 401 });
    }
    let adminSnap;
    try {
        adminSnap = await db.ref(`adminUids/${decoded.uid}`).once("value");
    } catch (_) {
        throw Object.assign(new Error("Admin authorization lookup unavailable"), { statusCode: 503 });
    }
    if (adminSnap.val() !== true) throw Object.assign(new Error("Admin access denied"), { statusCode: 403 });
    return decoded;
}
// ===== Admin Discord member directory / moderation API =====
// Actions are authenticated against Firebase adminUids, rate limited, auditable,
// and deliberately cannot grant the configured Discord Admin role.
const DISCORD_ADMIN_ACTION_ROLES = Object.freeze({
    developer: { configKey: "developer", label: "Developer" },
    supportTicketReport: { configKey: "supportTicketReport", label: "Ticket moderator" },
    supportCustomer: { configKey: "supportCustomer", label: "Customer support" },
    verified: { configKey: "verified", label: "Verified" },
    level: { configKey: "level", label: "Level reward" }
});
let adminDiscordDirectoryCache = { fetchedAt: 0, members: [], bans: [], membersTruncated: false, bansTruncated: false, guildId: "" };
const DISCORD_DIRECTORY_CACHE_MS = 30_000;
const DISCORD_DIRECTORY_MAX_PAGES = 10;
const DISCORD_PAGE_SIZE = 1000;
function adminApiError(res, err, fallback = "discord_action_failed") {
    const status = Number(err?.statusCode) || 502;
    const error = String(err?.apiError || (status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status === 503 ? "server_unavailable" : fallback));
    return res.status(status).json({ ok: false, error });
}
async function getReadyAdminGuild() {
    if (!client.isReady()) throw Object.assign(new Error("Discord bot not ready"), { statusCode: 503, apiError: "bot_not_ready" });
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID) || await client.guilds.fetch(ALLOWED_GUILD_ID).catch(() => null);
    if (!guild) throw Object.assign(new Error("Configured Discord guild not found"), { statusCode: 503, apiError: "guild_not_found" });
    return guild;
}
function compareSnowflakes(a, b) {
    try { const aa = BigInt(String(a || "0")), bb = BigInt(String(b || "0")); return aa < bb ? -1 : aa > bb ? 1 : 0; }
    catch (_) { return String(a).localeCompare(String(b)); }
}
async function fetchAdminDiscordPages(guild, kind) {
    const out = [];
    let after = undefined;
    let truncated = false;
    for (let pageNo = 0; pageNo < DISCORD_DIRECTORY_MAX_PAGES; pageNo += 1) {
        const query = new URLSearchParams({ limit: String(DISCORD_PAGE_SIZE) });
        if (after) query.set("after", String(after));
        const route = kind === "bans" ? Routes.guildBans(guild.id) : Routes.guildMembers(guild.id);
        const batch = await client.rest.get(route, { query });
        const values = Array.isArray(batch) ? batch : [];
        if (!values.length) break;
        out.push(...values);
        const ids = values.map(value => value.user?.id).filter(Boolean).sort(compareSnowflakes);
        const nextAfter = ids[ids.length - 1];
        if (!nextAfter || nextAfter === after) break;
        after = nextAfter;
        if (values.length < DISCORD_PAGE_SIZE) break;
        if (pageNo === DISCORD_DIRECTORY_MAX_PAGES - 1) truncated = true;
    }
    return { values: out, truncated };
}
async function getAdminDiscordDirectory(force = false) {
    const now = Date.now();
    if (!force && adminDiscordDirectoryCache.guildId === ALLOWED_GUILD_ID && now - adminDiscordDirectoryCache.fetchedAt < DISCORD_DIRECTORY_CACHE_MS) return adminDiscordDirectoryCache;
    const guild = await getReadyAdminGuild();
    const [memberResult, banResult] = await Promise.all([
        fetchAdminDiscordPages(guild, "members"),
        fetchAdminDiscordPages(guild, "bans")
    ]);
    adminDiscordDirectoryCache = {
        fetchedAt: now,
        guildId: guild.id,
        members: memberResult.values,
        bans: banResult.values,
        membersTruncated: memberResult.truncated,
        bansTruncated: banResult.truncated
    };
    return adminDiscordDirectoryCache;
}
function getAdminRoleBindingMap() {
    return {
        admin: getConfiguredRoleId("admin"),
        developer: getConfiguredRoleId("developer"),
        supportTicketReport: getConfiguredRoleId("supportTicketReport"),
        supportCustomer: getConfiguredRoleId("supportCustomer"),
        verified: getConfiguredRoleId("verified"),
        level: getConfiguredRoleId("level")
    };
}
function serializeAdminDiscordMember(member, guild, roleBindings) {
    const user = member.user || member;
    const roleIds = Array.isArray(member.roles) ? member.roles : (member.roles?.cache ? [...member.roles.cache.keys()] : []);
    const filteredRoleIds = roleIds.filter(id => id !== guild.id);
    const roles = filteredRoleIds.map(id => {
        const role = guild.roles.cache.get(id);
        if (!role) return { id, name: "Unknown role", key: "" };
        const key = Object.keys(roleBindings).find(k => roleBindings[k] && roleBindings[k] === id) || "";
        return { id: role.id, name: role.name, key };
    }).sort((a, b) => (guild.roles.cache.get(b.id)?.position || 0) - (guild.roles.cache.get(a.id)?.position || 0));
    const isAdminRole = roles.some(role => role.key === "admin");
    const isDeveloper = roles.some(role => role.key === "developer");
    const isModerator = roles.some(role => ["supportTicketReport", "supportCustomer"].includes(role.key));
    const hasAdminPermission = filteredRoleIds.some(id => guild.roles.cache.get(id)?.permissions?.has(PermissionFlagsBits.Administrator));
    const isAdministrator = Boolean(member.permissions?.has?.(PermissionFlagsBits.Administrator)) || Boolean(hasAdminPermission) || isAdminRole;
    let avatarUrl = "";
    try {
        avatarUrl = user.displayAvatarURL ? user.displayAvatarURL({ extension: "png", size: 64 })
            : (user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : "");
    } catch (_) {}
    return {
        id: String(user.id || member.id || ""), username: String(user.username || "unknown").slice(0, 100),
        globalName: String(user.globalName || user.global_name || "").slice(0, 100),
        displayName: String(member.displayName || member.nick || user.globalName || user.global_name || user.username || "unknown").slice(0, 100),
        avatarUrl, bot: Boolean(user.bot), joinedAt: member.joinedTimestamp || (member.joined_at ? Date.parse(member.joined_at) : 0),
        roles, isDeveloper, isModerator, isAdminRole, isAdministrator,
        isOwner: String(user.id || member.id || "") === String(guild.ownerId || "")
    };
}
async function beginDiscordAdminAudit(actor, actionType, summary) {
    const ref = db.ref("auditLog").push();
    await ref.set({ adminUid: actor.uid, actionType, timestamp: Date.now(), summary: `PENDING — ${summary}`, result: "pending" });
    return ref;
}
async function runDiscordAdminAction(actor, actionType, summary, actionFn) {
    const auditRef = await beginDiscordAdminAudit(actor, actionType, summary);
    let result;
    try {
        result = await actionFn();
    } catch (err) {
        await auditRef.update({ result: "failed", summary: `${summary} — failed (${String(err.apiError || err.message || "discord_error").slice(0, 100)})`, completedAt: Date.now() }).catch(auditErr => console.error("Discord admin audit update failed:", auditErr.message));
        throw err;
    }
    let auditLogged = true;
    await auditRef.update({ result: "success", summary, completedAt: Date.now() }).catch(err => { auditLogged = false; console.error("Discord admin audit finalization failed:", err.message); });
    return { ...(result || {}), auditLogged };
}
function validateDiscordSnowflake(value) {
    const id = String(value || "").trim();
    if (!isValidDiscordSnowflake(id)) throw Object.assign(new Error("Invalid Discord ID"), { statusCode: 400, apiError: "invalid_member_id" });
    return id;
}
function getBotGuildMember(guild) {
    const bot = guild.members.me;
    if (!bot) throw Object.assign(new Error("Bot member is not cached"), { statusCode: 503, apiError: "bot_not_ready" });
    return bot;
}
app.get("/api/admin/discord/members", async (req, res) => {
    try {
        const actor = await verifyAdminApiRequest(req);
        if (!checkCppRateLimit(req, res, "admin-discord-directory", 20, 60_000)) return;
        const refresh = String(req.query?.refresh || "") === "1";
        const snapshot = await getAdminDiscordDirectory(refresh);
        const guild = await getReadyAdminGuild();
        const roleBindings = getAdminRoleBindingMap();
        const members = snapshot.members.map(member => serializeAdminDiscordMember(member, guild, roleBindings));
        const developers = members.filter(member => member.isDeveloper);
        const moderators = members.filter(member => member.isModerator || member.isAdminRole);
        const banned = snapshot.bans.map(entry => ({
            id: String(entry.user?.id || ""), username: String(entry.user?.username || "Unknown user").slice(0, 100),
            globalName: String(entry.user?.globalName || entry.user?.global_name || "").slice(0, 100),
            reason: String(entry.reason || "No reason provided").slice(0, 400)
        }));
        const roleLabels = { developer: "Developer", supportTicketReport: "Ticket moderator", supportCustomer: "Customer support", verified: "Verified", level: "Level reward" };
        const roleOptions = Object.entries(DISCORD_ADMIN_ACTION_ROLES).map(([key, item]) => {
            const id = roleBindings[key];
            const role = id ? guild.roles.cache.get(id) : null;
            const botMember = guild.members.me;
            if (!isAssignableDiscordRole({ exists: Boolean(role), managed: role?.managed, hasAdministratorPermission: role?.permissions?.has(PermissionFlagsBits.Administrator), rolePosition: role?.position, botHighestRolePosition: botMember?.roles?.highest?.position, roleId: role?.id, adminRoleId: roleBindings.admin })) return null;
            return { key, name: roleLabels[key] || item.label };
        }).filter(Boolean);
        return res.json({ ok: true, guild: { id: guild.id, name: guild.name, memberCount: guild.memberCount }, members, developers, moderators, banned,
            roleOptions, truncated: snapshot.membersTruncated || snapshot.bansTruncated, fetchedAt: snapshot.fetchedAt, adminUid: actor.uid });
    } catch (err) { return adminApiError(res, err, "discord_directory_failed"); }
});
app.post("/api/admin/discord/ban", async (req, res) => {
    try {
        const actor = await verifyAdminApiRequest(req);
        if (!checkCppRateLimit(req, res, "admin-discord-ban", 8, 60_000)) return;
        const memberId = validateDiscordSnowflake(req.body?.memberId);
        const reason = String(req.body?.reason || "Admin panel moderation action").trim().slice(0, 400) || "Admin panel moderation action";
        const guild = await getReadyAdminGuild();
        const botMember = getBotGuildMember(guild);
        if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) throw Object.assign(new Error("Bot missing Ban Members permission"), { statusCode: 403, apiError: "missing_permission" });
        const member = await guild.members.fetch(memberId).catch(() => null);
        if (!member) throw Object.assign(new Error("Member not found"), { statusCode: 404, apiError: "member_not_found" });
        const configuredAdminRole = getConfiguredRoleId("admin");
        if (isProtectedDiscordTarget({ targetId: member.id, ownerId: guild.ownerId, isAdministrator: member.permissions.has(PermissionFlagsBits.Administrator) || (configuredAdminRole && member.roles.cache.has(configuredAdminRole)), targetHighestRolePosition: member.roles.highest.position, botHighestRolePosition: botMember.roles.highest.position })) {
            throw Object.assign(new Error("Protected target"), { statusCode: 403, apiError: "protected_target" });
        }
        const summary = `Banned Discord member ${member.user.tag || member.id} (${member.id}); reason=${reason}`;
        const result = await runDiscordAdminAction(actor, "discord_member_ban", summary, async () => {
            await member.ban({ reason: `Admin panel by Firebase UID ${actor.uid}: ${reason}` });
            return { memberId, action: "ban" };
        });
        return res.json({ ok: true, ...result });
    } catch (err) { return adminApiError(res, err); }
});
app.post("/api/admin/discord/unban", async (req, res) => {
    try {
        const actor = await verifyAdminApiRequest(req);
        if (!checkCppRateLimit(req, res, "admin-discord-unban", 8, 60_000)) return;
        const memberId = validateDiscordSnowflake(req.body?.memberId);
        const reason = String(req.body?.reason || "Admin panel unban").trim().slice(0, 400) || "Admin panel unban";
        const guild = await getReadyAdminGuild();
        const botMember = getBotGuildMember(guild);
        if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) throw Object.assign(new Error("Bot missing Ban Members permission"), { statusCode: 403, apiError: "missing_permission" });
        const ban = await guild.bans.fetch(memberId).catch(() => null);
        if (!ban) throw Object.assign(new Error("Not banned"), { statusCode: 404, apiError: "not_banned" });
        const summary = `Unbanned Discord user ${ban.user.tag || memberId} (${memberId}); reason=${reason}`;
        const result = await runDiscordAdminAction(actor, "discord_member_unban", summary, async () => {
            await guild.bans.remove(memberId, `Admin panel by Firebase UID ${actor.uid}: ${reason}`);
            return { memberId, action: "unban" };
        });
        return res.json({ ok: true, ...result });
    } catch (err) { return adminApiError(res, err); }
});
app.post("/api/admin/discord/role", async (req, res) => {
    try {
        const actor = await verifyAdminApiRequest(req);
        if (!checkCppRateLimit(req, res, "admin-discord-role", 15, 60_000)) return;
        const memberId = validateDiscordSnowflake(req.body?.memberId);
        const roleKey = String(req.body?.roleKey || "");
        const action = String(req.body?.action || "").toLowerCase();
        if (!isSafeDiscordActionRole(roleKey) || !Object.prototype.hasOwnProperty.call(DISCORD_ADMIN_ACTION_ROLES, roleKey) || !["add", "remove"].includes(action)) throw Object.assign(new Error("Role is not allowlisted"), { statusCode: 400, apiError: "invalid_role" });
        const guild = await getReadyAdminGuild();
        const botMember = getBotGuildMember(guild);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) throw Object.assign(new Error("Bot missing Manage Roles permission"), { statusCode: 403, apiError: "missing_permission" });
        const roleId = getConfiguredRoleId(DISCORD_ADMIN_ACTION_ROLES[roleKey].configKey);
        const role = roleId ? guild.roles.cache.get(roleId) : null;
        if (!isAssignableDiscordRole({ exists: Boolean(role), managed: role?.managed, hasAdministratorPermission: role?.permissions?.has(PermissionFlagsBits.Administrator), rolePosition: role?.position, botHighestRolePosition: botMember.roles.highest.position, roleId: role?.id, adminRoleId: getConfiguredRoleId("admin") })) {
            throw Object.assign(new Error("Role is not eligible for assignment"), { statusCode: 400, apiError: "invalid_role" });
        }
        const member = await guild.members.fetch(memberId).catch(() => null);
        if (!member) throw Object.assign(new Error("Member not found"), { statusCode: 404, apiError: "member_not_found" });
        const configuredAdminRole = getConfiguredRoleId("admin");
        if (isProtectedDiscordTarget({ targetId: member.id, ownerId: guild.ownerId, isAdministrator: member.permissions.has(PermissionFlagsBits.Administrator) || (configuredAdminRole && member.roles.cache.has(configuredAdminRole)), targetHighestRolePosition: member.roles.highest.position, botHighestRolePosition: botMember.roles.highest.position })) throw Object.assign(new Error("Protected target"), { statusCode: 403, apiError: "protected_target" });
        if (action === "add" && member.roles.cache.has(role.id)) return res.json({ ok: true, memberId, roleKey, action, alreadyApplied: true, auditLogged: true });
        if (action === "remove" && !member.roles.cache.has(role.id)) return res.json({ ok: true, memberId, roleKey, action, alreadyApplied: true, auditLogged: true });
        const summary = `${action === "add" ? "Granted" : "Removed"} Discord role ${role.name} (${role.id}) ${action === "add" ? "to" : "from"} ${member.user.tag || member.id} (${member.id})`;
        const result = await runDiscordAdminAction(actor, "discord_member_role_" + action, summary, async () => {
            if (action === "add") await member.roles.add(role, `Admin panel by Firebase UID ${actor.uid}`);
            else await member.roles.remove(role, `Admin panel by Firebase UID ${actor.uid}`);
            return { memberId, roleKey, roleName: role.name, action };
        });
        return res.json({ ok: true, ...result });
    } catch (err) { return adminApiError(res, err); }
});

// Admin-only voice controls. Live microphone PCM is kept in memory and never written to disk.
const adminVoiceSessions = new Map();
const liveVoiceTickets = new Map();
const LIVE_VOICE_TICKET_TTL_MS = 30_000;
const LIVE_VOICE_MAX_BYTES_PER_SECOND = 300 * 1024;
const LIVE_VOICE_MAX_DURATION_MS = Math.min(2 * 60 * 60 * 1000, Math.max(60_000, Number(process.env.LIVE_VOICE_MAX_DURATION_MS || 30 * 60 * 1000)));
const LIVE_STUDIO_MAX_DURATION_MS = Math.min(12 * 60 * 60 * 1000, Math.max(60_000, Number(process.env.LIVE_STUDIO_MAX_DURATION_MS || 4 * 60 * 60 * 1000)));
const LIVE_STUDIO_INVITE_TTL_MS = Math.min(30 * 60 * 1000, Math.max(60_000, Number(process.env.LIVE_STUDIO_INVITE_TTL_MS || 10 * 60 * 1000)));
const LIVE_STUDIO_MAX_PARTICIPANTS = Math.min(50, Math.max(2, Number(process.env.LIVE_STUDIO_MAX_PARTICIPANTS || 20)));
const liveStudioSessions = new Map(); // one LiveKit Studio room per configured Discord guild; memory only
const liveStudioInvites = new Map(); // SHA-256(inviteCode) -> single-use, short-lived session-bound invite
let liveKitSdkCache = null;
function getLiveKitRuntime() {
    const rawUrl = String(process.env.LIVEKIT_URL || "").trim();
    const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
    const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();
    if (!rawUrl || !apiKey || !apiSecret) throw Object.assign(new Error("LiveKit is not configured"), { statusCode: 503, apiError: "live_studio_not_configured" });
    let parsed;
    try { parsed = new URL(rawUrl); } catch (_) { throw Object.assign(new Error("LIVEKIT_URL invalid"), { statusCode: 503, apiError: "live_studio_not_configured" }); }
    let protocol = parsed.protocol;
    if (protocol === "wss:") protocol = "https:";
    else if (protocol === "ws:") protocol = "http:";
    if (!(["https:", "http:"].includes(protocol)) || (protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname))) {
        throw Object.assign(new Error("LiveKit URL must use HTTPS/WSS outside localhost"), { statusCode: 503, apiError: "live_studio_not_configured" });
    }
    const apiUrl = `${protocol}//${parsed.host}`;
    const clientUrl = `${protocol === "https:" ? "wss:" : "ws:"}//${parsed.host}`;
    if (!liveKitSdkCache) {
        let sdk;
        try { sdk = require("livekit-server-sdk"); }
        catch (_) { throw Object.assign(new Error("Install livekit-server-sdk on the Bot host"), { statusCode: 503, apiError: "live_studio_dependency_missing" }); }
        liveKitSdkCache = { sdk, roomService: new sdk.RoomServiceClient(apiUrl, apiKey, apiSecret), apiUrl, clientUrl, apiKey, apiSecret };
    }
    // If a deploy changes credentials/URL, recreate the runtime client rather than retaining stale config.
    if (liveKitSdkCache.apiUrl !== apiUrl || liveKitSdkCache.apiKey !== apiKey || liveKitSdkCache.apiSecret !== apiSecret) {
        const sdk = liveKitSdkCache.sdk;
        liveKitSdkCache = { sdk, roomService: new sdk.RoomServiceClient(apiUrl, apiKey, apiSecret), apiUrl, clientUrl, apiKey, apiSecret };
    }
    return liveKitSdkCache;
}
function studioSessionForGuild(guildId) {
    const session = liveStudioSessions.get(String(guildId));
    if (!session || session.endedAt || session.expiresAt <= Date.now()) return null;
    const voiceSession = adminVoiceSessions.get(String(guildId));
    let readyStatus = "Ready";
    try { readyStatus = getVoiceDependencies().voice.VoiceConnectionStatus.Ready; } catch (_) {}
    if (!isLiveStudioVoiceBound({ sessionChannelId: session.discordChannelId, voiceChannelId: voiceSession?.channelId,
        voiceStatus: voiceSession?.connection?.state?.status, readyStatus, expiresAt: session.expiresAt })) return null;
    return session;
}
function studioAccessToken(session, identity, name, role) {
    const runtime = getLiveKitRuntime();
    const { AccessToken } = runtime.sdk;
    // A participant token stays valid until the Studio session expires (capped by the session's own lifetime).
    // This avoids unexpectedly dropping invited guests after the previous fixed 1-hour token TTL.
    const tokenTtlSeconds = Math.max(60, Math.ceil((Number(session.expiresAt) - Date.now()) / 1000));
    const token = new AccessToken(runtime.apiKey, runtime.apiSecret, {
        identity,
        name: normalizeStudioName(name, role === "host" ? "RKBACKLES Admin" : "Guest"),
        ttl: tokenTtlSeconds,
        metadata: JSON.stringify({ app: "RKBACKLES", sessionId: session.sessionId, role })
    });
    token.addGrant({ ...buildStudioVideoGrant(role, runtime.sdk.TrackSource), room: session.roomName });
    return token.toJwt().then(jwt => ({ token: jwt, serverUrl: runtime.clientUrl }));
}
async function endLiveStudioForGuild(guildId, reason = "session ended", actorUid = "system") {
    const key = String(guildId || "");
    const session = liveStudioSessions.get(key);
    if (!session) return false;
    session.endedAt = Date.now();
    liveStudioSessions.delete(key);
    if (session.timer) clearTimeout(session.timer);
    if (session.moderationTimer) clearInterval(session.moderationTimer);
    for (const [digest, invite] of liveStudioInvites) if (invite.sessionId === session.sessionId) liveStudioInvites.delete(digest);
    try { await session.roomService.deleteRoom(session.roomName); }
    catch (err) { console.warn("Live Studio room cleanup failed:", String(err?.message || err).slice(0, 300)); }
    await db.ref("auditLog").push({ adminUid: actorUid, actionType: "live_studio_end", timestamp: Date.now(), summary: `Live Studio ended (${String(reason).slice(0, 180)}); room ${session.roomName} removed` }).catch(err => console.error("Live Studio audit write failed:", err.message));
    console.log(`Live Studio ended: guild=${key}, session=${session.sessionId}, reason=${String(reason).slice(0, 180)}`);
    return true;
}
async function enforceLiveStudioDeniedParticipants(session) {
    if (!session || liveStudioSessions.get(session.guildId) !== session) return;
    const voiceSession = adminVoiceSessions.get(session.guildId);
    let readyStatus = "Ready";
    try { readyStatus = getVoiceDependencies().voice.VoiceConnectionStatus.Ready; } catch (_) {}
    const voiceReady = isLiveStudioVoiceBound({ sessionChannelId: session.discordChannelId, voiceChannelId: voiceSession?.channelId,
        voiceStatus: voiceSession?.connection?.state?.status, readyStatus, expiresAt: session.expiresAt });
    if (!voiceReady) {
        session.voiceDisconnectedAt ||= Date.now();
        // Give Discord voice transport a brief reconnection grace period before ending the invite room.
        if (Date.now() - session.voiceDisconnectedAt > 15_000) {
            await endLiveStudioForGuild(session.guildId, "Discord Bot voice connection stayed disconnected", "system");
            return;
        }
    } else {
        session.voiceDisconnectedAt = 0;
    }
    if (!session.deniedIdentities.size) return;
    try {
        const participants = await session.roomService.listParticipants(session.roomName);
        const runtime = session.mutedIdentities.size ? getLiveKitRuntime() : null;
        for (const participant of participants || []) {
            const identity = String(participant.identity || "");
            if (session.deniedIdentities.has(identity)) {
                await session.roomService.removeParticipant(session.roomName, identity).catch(() => {});
                continue;
            }
            // Preserve Admin mute across a reconnect: revoke publishing rights while the mute is active.
            if (session.mutedIdentities.has(identity) && runtime) {
                for (const track of participant.tracks || []) {
                    const source = String(track.source ?? "").toLowerCase();
                    if (source.includes("microphone") || source === "2" || track.source === runtime.sdk.TrackSource?.MICROPHONE) {
                        await session.roomService.mutePublishedTrack(session.roomName, identity, track.sid, true).catch(() => {});
                    }
                }
                await session.roomService.updateParticipant(session.roomName, identity, { permission: {
                    canPublish: true, canPublishSources: [runtime.sdk.TrackSource.SCREEN_SHARE, runtime.sdk.TrackSource.SCREEN_SHARE_AUDIO],
                    canPublishData: false, canSubscribe: true
                } }).catch(() => {});
            }
        }
    } catch (err) { console.warn("Live Studio moderation watchdog failed:", String(err?.message || err).slice(0, 300)); }
}
function safeStudioParticipant(participant, session) {
    const metadata = (() => { try { return JSON.parse(participant.metadata || "{}"); } catch (_) { return {}; } })();
    return {
        identity: String(participant.identity || "").slice(0, 128),
        name: normalizeStudioName(participant.name, "Guest"),
        role: String(metadata.role || "guest") === "host" ? "host" : "guest",
        adminMuted: Boolean(session?.mutedIdentities?.has(String(participant.identity || ""))),
        tracks: (Array.isArray(participant.tracks) ? participant.tracks : []).slice(0, 10).map(track => ({
            sid: String(track.sid || "").slice(0, 128), source: String(track.source ?? "").slice(0, 40),
            type: String(track.type ?? "").slice(0, 40), muted: Boolean(track.muted)
        }))
    };
}
function getVoiceDependencies() {
    return { voice: require("@discordjs/voice"), googleTts: require("google-tts-api"), OpusScript: require("opusscript") };
}
function sendLiveVoiceJson(socket, data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        try { socket.send(JSON.stringify(data)); } catch (_) {}
    }
}
function stopLiveMicProcess(session) {
    if (session?.liveInputWatchdog) {
        clearInterval(session.liveInputWatchdog);
        session.liveInputWatchdog = null;
    }
    const proc = session?.liveProcess;
    if (!proc) return;
    session.liveProcess = null;
    try { if (proc.stdin && !proc.stdin.destroyed && !proc.stdin.writableEnded) proc.stdin.end(); } catch (_) {}
    const killer = setTimeout(() => { if (proc.exitCode === null && !proc.killed) { try { proc.kill("SIGKILL"); } catch (_) {} } }, 2500);
    if (typeof killer.unref === "function") killer.unref();
}
function closeLiveVoiceSocket(session, code = 1001, reason = "voice session ended") {
    if (!session) return;
    const socket = session.liveSocket;
    session.liveSocket = null;
    stopLiveMicProcess(session);
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        try { socket.close(code, String(reason).slice(0, 120)); } catch (_) { try { socket.terminate(); } catch (_) {} }
    }
}
async function beginLiveMicStream(socket, session, actorUid, mimeType) {
    const format = normalizeRecorderMimeType(mimeType);
    if (!format) throw Object.assign(new Error("Unsupported microphone recording format"), { apiError: "live_voice_unsupported_audio", statusCode: 415 });
    const { voice } = getVoiceDependencies();
    if (!session?.connection || session.connection.state.status !== voice.VoiceConnectionStatus.Ready) throw Object.assign(new Error("Voice connection is not ready"), { apiError: "voice_not_connected", statusCode: 409 });
    if (session.liveProcess || session.player?.state.status !== voice.AudioPlayerStatus.Idle) throw Object.assign(new Error("Voice player is busy"), { apiError: "voice_busy", statusCode: 409 });
    if (session.liveStartedAt && Date.now() - session.liveStartedAt > LIVE_VOICE_MAX_DURATION_MS) throw Object.assign(new Error("Live voice duration limit reached"), { apiError: "live_voice_duration_limit", statusCode: 429 });

    let proc;
    let ffmpegStderrTail = "";
    if (format === "s16le") {
        // Browser AudioWorklet sends headerless 48 kHz stereo PCM frames directly. Passing these
        // through avoids FFmpeg dying on fragmented WebM/MediaRecorder input or host codec quirks.
        proc = createLivePcmAudioProcess();
    } else {
        let ffmpegPath = String(process.env.FFMPEG_PATH || "");
        if (!ffmpegPath) { try { ffmpegPath = require("ffmpeg-static") || ""; } catch (_) {} }
        if (!ffmpegPath) throw Object.assign(new Error("FFmpeg is not installed"), { apiError: "ffmpeg_unavailable", statusCode: 503 });
        proc = spawn(ffmpegPath, [
            "-hide_banner", "-loglevel", "error", "-probesize", "1048576", "-analyzeduration", "1000000",
            "-f", format, "-i", "pipe:0", "-vn", "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "2", "-f", "s16le", "pipe:1"
        ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
        proc.stderr?.on("data", chunk => { ffmpegStderrTail = (ffmpegStderrTail + chunk.toString("utf8")).slice(-3000); });
        proc.stdin?.on("error", err => { if (err?.code !== "EPIPE") console.error("Live voice FFmpeg stdin error:", err?.message || err); });
    }

    session.liveProcess = proc;
    session.liveStartedAt = Date.now();
    session.liveActorUid = actorUid;
    if (proc.rawPcm) {
        // The browser must keep sending PCM packets even during silence. The clocked PCM
        // source pads transient jitter with silence; if packets stop entirely, end the
        // session with a distinct error rather than leaving a silent voice session open.
        session.liveInputWatchdog = setInterval(() => {
            if (session.liveProcess !== proc || !socket.liveStarted || session.liveSocket !== socket || socket.readyState !== WebSocket.OPEN) return;
            const lastInputAt = Number(proc.lastInputAt || proc.startedAt || session.liveStartedAt || Date.now());
            const inputIdleMs = Math.max(0, Date.now() - lastInputAt);
            if (inputIdleMs < 5000) return;
            const reason = `No microphone PCM packets received for ${inputIdleMs}ms; outputFrames=${proc.outputFrames || 0},underrunFrames=${proc.underrunFrames || 0},droppedInputBytes=${proc.droppedInputBytes || 0}`;
            proc.failureReason = reason.slice(0, 300);
            socket.liveFailureNotified = true;
            console.error("Live voice microphone input stalled:", proc.failureReason, `inputBytes=${proc.liveInputBytes || 0}`);
            sendLiveVoiceJson(socket, {
                type: "error",
                error: "live_voice_input_stalled",
                diagnostic: { inputBytes: proc.liveInputBytes || 0, inputIdleMs, outputFrames: proc.outputFrames || 0, underrunFrames: proc.underrunFrames || 0, reason: proc.failureReason }
            });
            closeLiveVoiceSocket(session, 1011, "microphone PCM input stalled");
        }, 1000);
        if (typeof session.liveInputWatchdog.unref === "function") session.liveInputWatchdog.unref();
    }
    const resource = voice.createAudioResource(proc.stdout, { inputType: voice.StreamType.Raw, metadata: { adminUid: actorUid, source: "live-admin-microphone" } });
    session.liveResource = resource;
    // A live microphone is an unbuffered network source, unlike a local file. The voice
    // player's default maxMissedFrames=5 can stop/destroy the resource after ~100 ms of
    // packet jitter, which in turn closes the PCM stream. Give live audio a bounded 1 s
    // underrun tolerance, while still letting the player's stream-error path fail closed.
    let playerStateListener = null;
    const removePlayerStateListener = () => {
        if (playerStateListener) {
            session.player.off("stateChange", playerStateListener);
            playerStateListener = null;
        }
    };
    playerStateListener = (oldState, newState) => {
        if (oldState.resource !== resource || newState.status !== voice.AudioPlayerStatus.Idle) return;
        if (!socket.liveStarted || session.liveSocket !== socket) return;
        const inputIdleMs = Math.max(0, Date.now() - Number(proc.lastInputAt || proc.startedAt || Date.now()));
        const connectionState = session.connection?.state?.status || "unknown";
        const playStream = resource.playStream;
        const reason = `AudioPlayer ${oldState.status}->idle; connection=${connectionState},playStreamDestroyed=${Boolean(playStream?.destroyed)},playStreamEnded=${Boolean(playStream?.readableEnded)},inputIdleMs=${inputIdleMs},outputFrames=${proc.outputFrames || 0},underrunFrames=${proc.underrunFrames || 0},queuedBytes=${proc.stdout?.queuedBytes || 0}`;
        console.error(`Live voice player stopped (${reason}); inputBytes=${proc.liveInputBytes || 0}`);
        socket.liveFailureNotified = true;
        sendLiveVoiceJson(socket, {
            type: "error",
            error: "live_voice_player_stopped",
            diagnostic: { inputBytes: proc.liveInputBytes || 0, inputIdleMs, outputFrames: proc.outputFrames || 0, underrunFrames: proc.underrunFrames || 0, reason }
        });
        closeLiveVoiceSocket(session, 1011, "Discord audio player stopped live microphone");
    };
    session.player.on("stateChange", playerStateListener);
    proc.once("close", removePlayerStateListener);
    proc.once("error", removePlayerStateListener);
    proc.once("spawn", () => {
        if (socket.readyState !== WebSocket.OPEN || session.liveSocket !== socket) { stopLiveMicProcess(session); return; }
        if (!proc.stdin || proc.stdin.destroyed || !proc.stdin.writable || proc.exitCode !== null) {
            sendLiveVoiceJson(socket, { type: "error", error: proc.rawPcm ? "live_voice_audio_pipeline_failed" : "live_voice_transcode_failed" });
            closeLiveVoiceSocket(session, 1011, "microphone audio input is not writable");
            return;
        }
        try {
            session.player.play(resource);
            sendLiveVoiceJson(socket, { type: "mic-ready", sampleRate: 48000, channels: 2, mode: proc.rawPcm ? "pcm" : "ffmpeg" });
        } catch (err) {
            console.error("Live voice player start failed:", err?.message || err);
            sendLiveVoiceJson(socket, { type: "error", error: "live_voice_player_failed" });
            closeLiveVoiceSocket(session, 1011, "microphone player start failed");
        }
    });
    if (proc.rawPcm && proc.stdout && typeof proc.stdout.once === "function") {
        proc.stdout.once("close", () => {
            if (!socket.liveStarted || session.liveSocket !== socket) return;
            const playerState = session.player?.state?.status || "unknown";
            const connectionState = session.connection?.state?.status || "unknown";
            const playbackStream = resource.playStream;
            const resourceState = `playStreamDestroyed=${Boolean(playbackStream?.destroyed)},playStreamEnded=${Boolean(playbackStream?.readableEnded)}`;
            const ageMs = session.liveStartedAt ? Math.max(0, Date.now() - session.liveStartedAt) : 0;
            const inputIdleMs = Math.max(0, Date.now() - Number(proc.lastInputAt || proc.startedAt || Date.now()));
            const context = `player=${playerState},connection=${connectionState},${resourceState},ageMs=${ageMs},inputIdleMs=${inputIdleMs},outputFrames=${proc.outputFrames || 0},underrunFrames=${proc.underrunFrames || 0},queuedBytes=${proc.stdout?.queuedBytes || 0},inputBytes=${proc.liveInputBytes || 0}`;
            const baseReason = proc.failureReason || "Discord audio output closed before microphone input ended";
            proc.failureReason = `${baseReason}; ${context}`.slice(0, 300);
            console.error("Live voice PCM output closed while the session was active:", proc.failureReason);
        });
    }
    proc.once("error", err => {
        const detail = proc.failureReason || err?.message || "unknown error";
        console.error(proc.rawPcm ? "Live voice PCM pipeline failed:" : "Live voice FFmpeg spawn failed:", detail);
        if (session.liveProcess === proc) session.liveProcess = null;
        socket.liveFailureNotified = true;
        sendLiveVoiceJson(socket, {
            type: "error",
            error: proc.rawPcm ? "live_voice_audio_pipeline_failed" : "ffmpeg_unavailable",
            ...(proc.rawPcm ? { diagnostic: { inputBytes: proc.liveInputBytes || 0, reason: String(proc.failureReason || err?.code || err?.message || "audio pipeline error").slice(0, 200) } } : {})
        });
        closeLiveVoiceSocket(session, 1011, proc.rawPcm ? "microphone PCM pipeline failed" : "microphone transcoder unavailable");
    });
    proc.once("close", code => {
        const endedUnexpectedly = socket.liveStarted && session.liveSocket === socket;
        if (session.liveProcess === proc) session.liveProcess = null;
        if (session.liveResource === resource) session.liveResource = null;
        if (endedUnexpectedly) {
            socket.liveStarted = false;
            socket.liveFailureNotified = true;
            const errorCode = proc.rawPcm
                ? (code === 0 ? "live_voice_stream_ended" : "live_voice_audio_pipeline_failed")
                : (code === 0 ? "live_voice_stream_ended" : "live_voice_transcode_failed");
            const inputBytes = proc.liveInputBytes || 0;
            const diagnostic = proc.rawPcm ? (proc.failureReason || "direct PCM stream ended without a captured reason") : (ffmpegStderrTail || "no stderr output").replace(/[\r\n]+/g, " ").slice(-1600);
            console.error(`Live voice ${proc.rawPcm ? "PCM stream" : "FFmpeg"} exited unexpectedly (code=${code}, inputBytes=${inputBytes}): ${diagnostic}`);
            if (socket.readyState === WebSocket.OPEN) {
                sendLiveVoiceJson(socket, {
                    type: "error",
                    error: errorCode,
                    ...(proc.rawPcm ? { diagnostic: { inputBytes, reason: String(proc.failureReason || "PCM output stream ended unexpectedly").slice(0, 200) } } : {})
                });
                try { socket.close(1011, proc.rawPcm ? "microphone PCM stream ended" : "microphone transcoder exited"); } catch (_) { try { socket.terminate(); } catch (_) {} }
            }
        } else if (code && code !== 0 && socket.readyState === WebSocket.OPEN && !socket.liveStopping) {
            console.error(`Live voice ${proc.rawPcm ? "PCM stream" : "FFmpeg"} exited (code=${code}, inputBytes=${proc.liveInputBytes || 0}): ${(proc.rawPcm ? (proc.failureReason || "no internal failure reason captured") : (ffmpegStderrTail || "no stderr output")).replace(/[\r\n]+/g, " ").slice(-1200)}`);
        }
    });
    proc.on("exit", code => {
        if (code !== null && code !== 0 && session.liveProcess === proc) {
            console.error(`Live voice ${proc.rawPcm ? "PCM" : "FFmpeg"} process exit code ${code}: ${(ffmpegStderrTail || "no stderr output").replace(/[\r\n]+/g, " ").slice(-1200)}`);
        }
    });
}
function startLiveDiscordAudioRelay(socket, session, guild) {
    const { voice, OpusScript } = getVoiceDependencies();
    const subscriptions = new Map();
    const connection = session.connection;
    const onSpeakingStart = userId => {
        if (socket.readyState !== WebSocket.OPEN || session.liveSocket !== socket || subscriptions.has(userId)) return;
        const member = guild.members.cache.get(userId);
        if (!member || member.user?.bot || userId === client.user?.id) return;
        let stream;
        let decoder;
        try {
            stream = connection.receiver.subscribe(userId, { end: { behavior: voice.EndBehaviorType.AfterSilence, duration: 650 } });
            decoder = new OpusScript(48000, 2, OpusScript.Application.VOIP);
        } catch (err) {
            console.error("Live voice receive setup failed:", err.message);
            return;
        }
        subscriptions.set(userId, { stream, decoder });
        sendLiveVoiceJson(socket, { type: "remote-speaking", userId, username: String(member.displayName || member.user.username || "Discord member").slice(0, 80) });
        stream.on("data", packet => {
            if (socket.readyState !== WebSocket.OPEN || session.liveSocket !== socket || socket.bufferedAmount > 768 * 1024) return;
            try {
                const pcm = decoder.decode(Buffer.from(packet));
                if (pcm?.length) socket.send(packRemotePcmFrame(userId, Buffer.from(pcm)), { binary: true });
            } catch (_) { /* An undecodable Discord frame is dropped; no audio is persisted. */ }
        });
        let streamCleaned = false;
        const cleanup = () => {
            if (streamCleaned) return;
            streamCleaned = true;
            if (subscriptions.get(userId)?.stream === stream) subscriptions.delete(userId);
            try { if (typeof decoder.delete === "function") decoder.delete(); } catch (_) {}
            sendLiveVoiceJson(socket, { type: "remote-stopped", userId });
        };
        stream.once("end", cleanup);
        stream.once("close", cleanup);
        stream.once("error", cleanup);
    };
    connection.receiver.speaking.on("start", onSpeakingStart);
    return () => {
        connection.receiver.speaking.off("start", onSpeakingStart);
        for (const [userId, item] of subscriptions) {
            try { item.stream.destroy(); } catch (_) {}
            try { if (typeof item.decoder.delete === "function") item.decoder.delete(); } catch (_) {}
            sendLiveVoiceJson(socket, { type: "remote-stopped", userId });
        }
        subscriptions.clear();
    };
}
app.post("/api/admin/discord/voice/live-ticket", async (req, res) => {
    try {
        const actor = await verifyAdminApiRequest(req);
        if (!checkCppRateLimit(req, res, "admin-discord-live-ticket", 5, 60_000)) return;
        const guild = await getReadyAdminGuild();
        const session = adminVoiceSessions.get(guild.id);
        const { voice } = getVoiceDependencies();
        if (!session?.connection || session.connection.state.status !== voice.VoiceConnectionStatus.Ready) throw Object.assign(new Error("Bot is not connected to voice"), { statusCode: 409, apiError: "voice_not_connected" });
        if (session.liveSocket && [WebSocket.OPEN, WebSocket.CONNECTING, WebSocket.CLOSING].includes(session.liveSocket.readyState)) throw Object.assign(new Error("A live browser voice session is already active"), { statusCode: 409, apiError: "live_voice_already_active" });
        const now = Date.now();
        for (const [key, value] of liveVoiceTickets) if (value.expiresAt <= now) liveVoiceTickets.delete(key);
        const ticket = crypto.randomBytes(32).toString("base64url");
        const digest = crypto.createHash("sha256").update(ticket).digest("hex");
        liveVoiceTickets.set(digest, { uid: actor.uid, guildId: guild.id, expiresAt: now + LIVE_VOICE_TICKET_TTL_MS });
        return res.json({ ok: true, ticket, expiresInMs: LIVE_VOICE_TICKET_TTL_MS, channelName: session.channelName || "voice channel" });
    } catch (err) { return adminApiError(res, err, "live_voice_ticket_failed"); }
});
app.get("/api/admin/discord/voice/channels", async (req, res) => {
    try {
        await verifyAdminApiRequest(req);
        if (!checkCppRateLimit(req, res, "admin-discord-voice-channels", 20, 60000)) return;
        const guild = await getReadyAdminGuild();
        const botMember = getBotGuildMember(guild);
        const channels = [...guild.channels.cache.values()].filter(channel => channel.type === ChannelType.GuildVoice).map(channel => {
            const permissions = channel.permissionsFor(botMember);
            const missingPermissions = [];
            for (const [name, flag] of [["ViewChannel",PermissionFlagsBits.ViewChannel],["Connect",PermissionFlagsBits.Connect],["Speak",PermissionFlagsBits.Speak]]) {
                if (!permissions?.has(flag)) missingPermissions.push(name);
            }
            return { id: channel.id, name: String(channel.name || "Voice channel").slice(0,100), userLimit: channel.userLimit || 0,
                canJoin: missingPermissions.length === 0, missingPermissions };
        }).sort((a,b) => a.name.localeCompare(b.name));
        const active = adminVoiceSessions.get(guild.id);
        return res.json({ ok: true, channels, connected: Boolean(active?.connection), channelId: active?.channelId || "",
            speaking: Boolean(active?.player && active.player.state.status !== "idle") });
    } catch (err) { return adminApiError(res, err, "voice_directory_failed"); }
});
app.post("/api/admin/discord/voice/join", async (req, res) => {
    try {
        const actor = await verifyAdminApiRequest(req);
        if (!checkCppRateLimit(req, res, "admin-discord-voice-join", 6, 60000)) return;
        const channelId = validateDiscordSnowflake(req.body?.channelId);
        const guild = await getReadyAdminGuild();
        const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || channel.guildId !== guild.id || channel.type !== ChannelType.GuildVoice) throw Object.assign(new Error("Voice channel not found"), {statusCode:404,apiError:"voice_channel_not_found"});
        const botMember = getBotGuildMember(guild);
        const permissions = channel.permissionsFor(botMember);
        if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.Connect) || !permissions?.has(PermissionFlagsBits.Speak)) throw Object.assign(new Error("Bot needs View Channel, Connect and Speak"), {statusCode:403,apiError:"missing_voice_permission"});
        const { voice } = getVoiceDependencies();
        const existing = adminVoiceSessions.get(guild.id);
        if (existing?.connection && existing.channelId === channel.id && existing.connection.state.status === voice.VoiceConnectionStatus.Ready) return res.json({ok:true,connected:true,channelId,channelName:channel.name,alreadyConnected:true});
        if (existing?.connection) { await endLiveStudioForGuild(guild.id, "Discord voice channel changed", actor.uid); closeLiveVoiceSocket(existing, 1001, "voice channel changed"); existing.player?.stop(true); existing.connection.destroy(); }
        const player = voice.createAudioPlayer({behaviors:{noSubscriber:voice.NoSubscriberBehavior.Pause,maxMissedFrames:50}});
        player.on("error", err => console.error("Admin voice player error:", err.message));
        const connection = voice.joinVoiceChannel({channelId:channel.id,guildId:guild.id,adapterCreator:guild.voiceAdapterCreator,selfDeaf:false,selfMute:false});
        connection.on("stateChange", (_oldState, newState) => {
            if (newState.status === voice.VoiceConnectionStatus.Destroyed && adminVoiceSessions.get(guild.id)?.connection === connection) {
                const ended = adminVoiceSessions.get(guild.id);
                closeLiveVoiceSocket(ended, 1001, "Discord voice connection ended");
                ended?.player?.stop(true);
                adminVoiceSessions.delete(guild.id);
                endLiveStudioForGuild(guild.id, "Discord bot voice connection destroyed", ended?.connectedBy || "system").catch(err => console.error("Live Studio shutdown after Discord voice disconnect failed:", err.message));
            }
        });
        connection.subscribe(player);
        try { await voice.entersState(connection,voice.VoiceConnectionStatus.Ready,15000); }
        catch (_) { connection.destroy(); throw Object.assign(new Error("Voice connection timed out"), {statusCode:502,apiError:"voice_connection_failed"}); }
        adminVoiceSessions.set(guild.id,{connection,player,channelId:channel.id,channelName:channel.name,connectedAt:Date.now(),connectedBy:actor.uid});
        await db.ref("auditLog").push({adminUid:actor.uid,actionType:"discord_voice_join",timestamp:Date.now(),summary:`Bot joined voice channel ${channel.name} (${channel.id})`}).catch(err=>console.error("Voice audit write failed:",err.message));
        return res.json({ok:true,connected:true,channelId,channelName:channel.name});
    } catch (err) { return adminApiError(res,err,"voice_join_failed"); }
});
app.post("/api/admin/discord/voice/leave", async (req, res) => {
    try {
        const actor = await verifyAdminApiRequest(req);
        if (!checkCppRateLimit(req,res,"admin-discord-voice-leave",10,60000)) return;
        const guild = await getReadyAdminGuild();
        const current = adminVoiceSessions.get(guild.id);
        if (!current?.connection) return res.json({ok:true,connected:false,alreadyDisconnected:true});
        await endLiveStudioForGuild(guild.id, "Admin ended Discord voice session", actor.uid);
        closeLiveVoiceSocket(current, 1001, "Admin ended voice session");
        current.player?.stop(true); current.connection.destroy(); adminVoiceSessions.delete(guild.id);
        await db.ref("auditLog").push({adminUid:actor.uid,actionType:"discord_voice_leave",timestamp:Date.now(),summary:`Bot left voice channel ${current.channelName || current.channelId}`}).catch(err=>console.error("Voice audit write failed:",err.message));
        return res.json({ok:true,connected:false});
    } catch (err) { return adminApiError(res,err,"voice_leave_failed"); }
});
app.post("/api/admin/discord/voice/speak", async (req, res) => {
    try {
        const actor = await verifyAdminApiRequest(req);
        if (!checkCppRateLimit(req,res,"admin-discord-voice-speak",8,60000)) return;
        const text = sanitizeVoiceSpeech(req.body?.text);
        if (!text) throw Object.assign(new Error("Speech text is empty"),{statusCode:400,apiError:"invalid_speech_text"});
        const guild = await getReadyAdminGuild();
        const session = adminVoiceSessions.get(guild.id);
        if (!session?.connection || !session?.player) throw Object.assign(new Error("Bot not in voice"),{statusCode:409,apiError:"voice_not_connected"});
        const { voice, googleTts } = getVoiceDependencies();
        if (session.player.state.status !== voice.AudioPlayerStatus.Idle) throw Object.assign(new Error("Voice player busy"),{statusCode:409,apiError:"voice_busy"});
        const audioUrl = googleTts.getAudioUrl(text,{lang:"bn",slow:false,host:"https://translate.google.com"});
        const response = await fetch(audioUrl,{signal:AbortSignal.timeout(12000),headers:{"User-Agent":"RKBACKLES-AdminVoice/1.5.13"}});
        if (!response.ok || !response.body) throw Object.assign(new Error("TTS provider failed"),{statusCode:502,apiError:"tts_provider_failed"});
        const resource = voice.createAudioResource(Readable.fromWeb(response.body),{inputType:voice.StreamType.Arbitrary,metadata:{adminUid:actor.uid,queuedAt:Date.now()}});
        session.player.play(resource);
        await db.ref("auditLog").push({adminUid:actor.uid,actionType:"discord_voice_speak",timestamp:Date.now(),summary:`Admin requested Bengali voice message (${text.length} characters) in ${session.channelName || session.channelId}`}).catch(err=>console.error("Voice audit write failed:",err.message));
        return res.json({ok:true,speaking:true,characterCount:text.length,channelName:session.channelName || session.channelId});
    } catch (err) { return adminApiError(res,err,"voice_speak_failed"); }
});

// Discord voice-member moderation. This never bypasses Discord permissions: the Bot needs Mute Members / Move Members.
app.post("/api/admin/discord/voice/members", async (req, res) => {
    try {
        await verifyAdminApiRequest(req);
        const guild = await getReadyAdminGuild();
        const session = adminVoiceSessions.get(guild.id);
        const { voice } = getVoiceDependencies();
        const connected = Boolean(session?.connection && session.connection.state.status === voice.VoiceConnectionStatus.Ready);
        if (!connected) return res.json({ ok: true, connected: false, channelName: "", members: [] });
        const botMember = getBotGuildMember(guild);
        const canMute = Boolean(botMember?.permissions?.has(PermissionFlagsBits.MuteMembers));
        const canDisconnect = Boolean(botMember?.permissions?.has(PermissionFlagsBits.MoveMembers));
        const members = [...guild.voiceStates.cache.values()].filter(state => state.channelId === session.channelId && state.member).map(state => {
            const member = state.member;
            const protectedTarget = isProtectedDiscordTarget({ targetId: member.id, ownerId: guild.ownerId,
                isAdministrator: member.permissions?.has(PermissionFlagsBits.Administrator) || Boolean(getConfiguredRoleId("admin") && member.roles?.cache?.has(getConfiguredRoleId("admin"))),
                targetHighestRolePosition: member.roles?.highest?.position, botHighestRolePosition: botMember?.roles?.highest?.position });
            return { id: member.id, name: normalizeStudioName(member.displayName || member.user?.username || member.id), username: String(member.user?.username || "").slice(0, 80),
                muted: Boolean(state.serverMute), deafened: Boolean(state.serverDeaf), isBot: Boolean(member.user?.bot), protectedTarget,
                canMute: canMute && !protectedTarget && !member.user?.bot, canDisconnect: canDisconnect && !protectedTarget && !member.user?.bot };
        }).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,200);
        return res.json({ ok: true, connected: true, channelId: session.channelId, channelName: session.channelName || "Voice channel", canMute, canDisconnect, members });
    } catch (err) { return adminApiError(res, err, "voice_members_failed"); }
});
app.post("/api/admin/discord/voice/member-action", async (req, res) => {
    try {
        const actor = await verifyAdminApiRequest(req);
        if (!checkCppRateLimit(req, res, "admin-discord-voice-member-action", 20, 60_000)) return;
        const userId = validateDiscordSnowflake(req.body?.userId);
        const action = String(req.body?.action || "").toLowerCase();
        if (!userId || !["mute", "unmute", "disconnect"].includes(action)) throw Object.assign(new Error("Invalid member action"), { statusCode: 400, apiError: "invalid_voice_member_action" });
        const guild = await getReadyAdminGuild();
        const session = adminVoiceSessions.get(guild.id);
        const { voice } = getVoiceDependencies();
        if (!session?.connection || session.connection.state.status !== voice.VoiceConnectionStatus.Ready) throw Object.assign(new Error("Bot not in voice"), { statusCode: 409, apiError: "voice_not_connected" });
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member || member.voice?.channelId !== session.channelId) throw Object.assign(new Error("Member is not in the Bot's current voice channel"), { statusCode: 404, apiError: "voice_member_not_found" });
        if (isProtectedDiscordTarget({ targetId: member.id, ownerId: guild.ownerId,
            isAdministrator: member.permissions.has(PermissionFlagsBits.Administrator) || Boolean(getConfiguredRoleId("admin") && member.roles.cache.has(getConfiguredRoleId("admin"))),
            targetHighestRolePosition: member.roles.highest.position, botHighestRolePosition: getBotGuildMember(guild).roles.highest.position }) || member.user.bot) {
            throw Object.assign(new Error("Protected voice moderation target"), { statusCode: 403, apiError: "protected_voice_target" });
        }
        const botMember = getBotGuildMember(guild);
        if (["mute", "unmute"].includes(action) && !botMember.permissions.has(PermissionFlagsBits.MuteMembers)) throw Object.assign(new Error("Bot needs Mute Members"), { statusCode: 403, apiError: "missing_mute_members_permission" });
        if (action === "disconnect" && !botMember.permissions.has(PermissionFlagsBits.MoveMembers)) throw Object.assign(new Error("Bot needs Move Members"), { statusCode: 403, apiError: "missing_move_members_permission" });
        const description = action === "disconnect" ? "disconnect from voice" : `${action} in voice`;
        if (action === "disconnect") await member.voice.disconnect(`Admin panel by Firebase UID ${actor.uid}: ${description}`);
        else await member.voice.setMute(action === "mute", `Admin panel by Firebase UID ${actor.uid}: ${description}`);
        await db.ref("auditLog").push({ adminUid: actor.uid, actionType: `discord_voice_member_${action}`, timestamp: Date.now(), summary: `${action} voice member ${member.user?.tag || member.id} (${member.id}) in ${session.channelName || session.channelId}` }).catch(err => console.error("Voice member audit write failed:", err.message));
        return res.json({ ok: true, userId, action, name: normalizeStudioName(member.displayName || member.user?.username || member.id) });
    } catch (err) { return adminApiError(res, err, "voice_member_action_failed"); }
});

// Browser-based Live Studio is a separate WebRTC room (LiveKit), because the official Discord Bot API does not provide bot screen-sharing.
// Start/invite/moderation routes are Admin-only. Guest invite codes are random, hashed, single-use, and session-bound.
app.get("/live-room", (req, res) => res.sendFile(require("path").join(__dirname, "public", "live-room.html")));
app.post("/api/admin/live-studio/status", async (req, res) => {
    try {
        await verifyAdminApiRequest(req);
        const guild = await getReadyAdminGuild();
        const { voice } = getVoiceDependencies();
        const botVoice = adminVoiceSessions.get(guild.id);
        const botConnected = Boolean(botVoice?.connection && botVoice.connection.state.status === voice.VoiceConnectionStatus.Ready);
        let session = liveStudioSessions.get(guild.id);
        if (session && (!botConnected || session.discordChannelId !== botVoice.channelId || session.expiresAt <= Date.now())) {
            await endLiveStudioForGuild(guild.id, "Bot voice disconnected or session expired", "system");
            session = null;
        }
        if (!session) return res.json({ ok: true, configured: Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET), active: false, botConnected, botChannelName: botVoice?.channelName || "" });
        const participants = await session.roomService.listParticipants(session.roomName).catch(() => []);
        return res.json({ ok: true, configured: true, active: true, sessionId: session.sessionId, roomName: session.roomName, channelName: session.discordChannelName,
            discordChannelName: session.discordChannelName, startedAt: session.startedAt, expiresAt: session.expiresAt, participantCount: participants.length, botConnected: true });
    } catch (err) { return adminApiError(res, err, "live_studio_status_failed"); }
});
app.post("/api/admin/live-studio/start", async (req, res) => {
    try {
        const actor = await verifyAdminApiRequest(req);
        if (!checkCppRateLimit(req, res, "admin-live-studio-start", 6, 60_000)) return;
        const guild = await getReadyAdminGuild();
        const voiceSession = adminVoiceSessions.get(guild.id);
        const { voice } = getVoiceDependencies();
        if (!voiceSession?.connection || voiceSession.connection.state.status !== voice.VoiceConnectionStatus.Ready) throw Object.assign(new Error("Bot must be connected to Discord voice first"), { statusCode: 409, apiError: "voice_not_connected" });
        const runtime = getLiveKitRuntime();
        let session = liveStudioSessions.get(guild.id);
        if (session && (session.discordChannelId !== voiceSession.channelId || session.expiresAt <= Date.now())) { await endLiveStudioForGuild(guild.id, "replaced stale session", actor.uid); session = null; }
        if (session && session.ownerUid !== actor.uid) throw Object.assign(new Error("A Live Studio is already active"), { statusCode: 409, apiError: "live_studio_already_active" });
        if (!session) {
            const sessionId = crypto.randomBytes(12).toString("base64url");
            const roomName = `rkbs_${guild.id}_${crypto.randomBytes(7).toString("hex")}`;
            await runtime.roomService.createRoom({ name: roomName, emptyTimeout: 60, maxParticipants: LIVE_STUDIO_MAX_PARTICIPANTS, metadata: JSON.stringify({ app: "RKBACKLES", sessionId }) });
            session = { sessionId, guildId: guild.id, roomName, roomService: runtime.roomService, ownerUid: actor.uid, discordChannelId: voiceSession.channelId,
                discordChannelName: voiceSession.channelName || "Discord voice", startedAt: Date.now(), expiresAt: Date.now() + LIVE_STUDIO_MAX_DURATION_MS,
                hostIdentity: `host_${crypto.createHash("sha256").update(actor.uid).digest("hex").slice(0, 12)}`, deniedIdentities: new Set(), mutedIdentities: new Set(), endedAt: 0 };
            liveStudioSessions.set(guild.id, session);
            session.timer = setTimeout(() => endLiveStudioForGuild(guild.id, "maximum session duration reached", "system").catch(() => {}), LIVE_STUDIO_MAX_DURATION_MS);
            if (typeof session.timer.unref === "function") session.timer.unref();
            session.moderationTimer = setInterval(() => enforceLiveStudioDeniedParticipants(session).catch(() => {}), 2500);
            if (typeof session.moderationTimer.unref === "function") session.moderationTimer.unref();
            await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "live_studio_start", timestamp: Date.now(), summary: `Live Studio started for Discord voice channel ${session.discordChannelName}; browser media is relayed live and not stored` }).catch(err => console.error("Live Studio audit write failed:", err.message));
        }
        const access = await studioAccessToken(session, session.hostIdentity, "RKBACKLES Host", "host");
        return res.json({ ok: true, active: true, sessionId: session.sessionId, roomName: session.roomName, channelName: session.discordChannelName,
            expiresAt: session.expiresAt, identity: session.hostIdentity, role: "host", ...access });
    } catch (err) { return adminApiError(res, err, "live_studio_start_failed"); }
});
app.post("/api/admin/live-studio/invite", async (req, res) => {
    try {
        const actor = await verifyAdminApiRequest(req);
        if (!checkCppRateLimit(req, res, "admin-live-studio-invite", 30, 60_000)) return;
        const guild = await getReadyAdminGuild();
        const session = studioSessionForGuild(guild.id);
        if (!session) throw Object.assign(new Error("Start Live Studio while Bot is joined to voice"), { statusCode: 409, apiError: "live_studio_not_active" });
        if (session.ownerUid !== actor.uid) throw Object.assign(new Error("Only the session owner can invite participants"), { statusCode: 403, apiError: "forbidden" });
        const now = Date.now();
        for (const [digest, item] of liveStudioInvites) if (item.expiresAt <= now || !liveStudioSessions.has(item.guildId)) liveStudioInvites.delete(digest);
        if (liveStudioInvites.size >= 2000) throw Object.assign(new Error("Too many pending invitations"), { statusCode: 429, apiError: "live_studio_invite_limit" });
        const code = crypto.randomBytes(32).toString("base64url");
        const digest = studioInviteDigest(code);
        liveStudioInvites.set(digest, { sessionId: session.sessionId, guildId: guild.id, expiresAt: Math.min(Date.now() + LIVE_STUDIO_INVITE_TTL_MS, session.expiresAt), createdBy: actor.uid });
        await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "live_studio_invite", timestamp: Date.now(), summary: `Single-use Live Studio invitation issued; room ${session.roomName}; expires in ${Math.floor(LIVE_STUDIO_INVITE_TTL_MS / 60000)} minutes` }).catch(err => console.error("Live Studio audit write failed:", err.message));
        return res.json({ ok: true, inviteCode: code, expiresAt: Math.min(Date.now() + LIVE_STUDIO_INVITE_TTL_MS, session.expiresAt), sessionId: session.sessionId });
    } catch (err) { return adminApiError(res, err, "live_studio_invite_failed"); }
});
app.post("/api/live-studio/redeem", async (req, res) => {
    try {
        if (!checkCppRateLimit(req, res, "live-studio-redeem", 12, 60_000)) return;
        const code = String(req.body?.inviteCode || "");
        if (!isValidStudioInviteCode(code)) throw Object.assign(new Error("Invalid invite code"), { statusCode: 400, apiError: "live_studio_invite_invalid" });
        const digest = studioInviteDigest(code);
        const invite = liveStudioInvites.get(digest);
        if (!invite || invite.expiresAt <= Date.now()) { liveStudioInvites.delete(digest); throw Object.assign(new Error("Invite expired or already used"), { statusCode: 410, apiError: "live_studio_invite_expired" }); }
        const session = studioSessionForGuild(invite.guildId);
        if (!session || session.sessionId !== invite.sessionId) { liveStudioInvites.delete(digest); throw Object.assign(new Error("Live Studio is no longer active"), { statusCode: 410, apiError: "live_studio_not_active" }); }
        liveStudioInvites.delete(digest); // consume single-use invitation before signing any token
        const name = normalizeStudioName(req.body?.displayName, "Live guest");
        const identity = `guest_${crypto.randomBytes(12).toString("hex")}`;
        const access = await studioAccessToken(session, identity, name, "guest");
        return res.json({ ok: true, sessionId: session.sessionId, roomName: session.roomName, identity, name, role: "guest", ...access });
    } catch (err) { return adminApiError(res, err, "live_studio_join_failed"); }
});
app.post("/api/admin/live-studio/participants", async (req, res) => {
    try {
        const actor = await verifyAdminApiRequest(req);
        const guild = await getReadyAdminGuild();
        const session = studioSessionForGuild(guild.id);
        if (!session || session.ownerUid !== actor.uid) throw Object.assign(new Error("Live Studio is not active for this Admin"), { statusCode: 409, apiError: "live_studio_not_active" });
        const participants = await session.roomService.listParticipants(session.roomName);
        return res.json({ ok: true, participants: (participants || []).map(participant => ({ ...safeStudioParticipant(participant, session), isHost: String(participant.identity || "") === session.hostIdentity })) });
    } catch (err) { return adminApiError(res, err, "live_studio_participants_failed"); }
});
app.post("/api/admin/live-studio/mute", async (req, res) => {
    try {
        const actor = await verifyAdminApiRequest(req);
        if (!checkCppRateLimit(req, res, "admin-live-studio-mute", 30, 60_000)) return;
        const guild = await getReadyAdminGuild();
        const session = studioSessionForGuild(guild.id);
        const identity = String(req.body?.identity || "");
        if (!session || session.ownerUid !== actor.uid) throw Object.assign(new Error("Live Studio is not active"), { statusCode: 409, apiError: "live_studio_not_active" });
        if (!isGuestStudioIdentity(identity)) throw Object.assign(new Error("Only invited guests can be moderated from this panel"), { statusCode: 400, apiError: "invalid_studio_target" });
        const participant = (await session.roomService.listParticipants(session.roomName)).find(item => String(item.identity) === identity);
        if (!participant) throw Object.assign(new Error("Participant is no longer in the room"), { statusCode: 404, apiError: "studio_participant_not_found" });
        const runtime = getLiveKitRuntime();
        const micTracks = (participant.tracks || []).filter(track => {
            const source = String(track.source ?? "").toLowerCase();
            return source.includes("microphone") || source === "2" || track.source === runtime.sdk.TrackSource?.MICROPHONE;
        });
        // Mark first so reconnects are also muted by the watchdog. If the API fails, rollback the state.
        session.mutedIdentities.add(identity);
        try {
            for (const track of micTracks) await session.roomService.mutePublishedTrack(session.roomName, identity, track.sid, true);
            await session.roomService.updateParticipant(session.roomName, identity, { permission: {
                canPublish: true, canPublishSources: [runtime.sdk.TrackSource.SCREEN_SHARE, runtime.sdk.TrackSource.SCREEN_SHARE_AUDIO],
                canPublishData: false, canSubscribe: true
            } });
        } catch (err) {
            session.mutedIdentities.delete(identity);
            throw err;
        }
        await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "live_studio_mute", timestamp: Date.now(), summary: `Muted and revoked microphone publishing for Live Studio participant ${identity}` }).catch(err => console.error("Live Studio audit write failed:", err.message));
        return res.json({ ok: true, identity, muted: true, adminMuted: true });
    } catch (err) { return adminApiError(res, err, "live_studio_mute_failed"); }
});
app.post("/api/admin/live-studio/unmute", async (req, res) => {
    try {
        const actor = await verifyAdminApiRequest(req);
        if (!checkCppRateLimit(req, res, "admin-live-studio-unmute", 30, 60_000)) return;
        const guild = await getReadyAdminGuild();
        const session = studioSessionForGuild(guild.id);
        const identity = String(req.body?.identity || "");
        if (!session || session.ownerUid !== actor.uid) throw Object.assign(new Error("Live Studio is not active"), { statusCode: 409, apiError: "live_studio_not_active" });
        if (!isGuestStudioIdentity(identity)) throw Object.assign(new Error("Only invited guests can be moderated from this panel"), { statusCode: 400, apiError: "invalid_studio_target" });
        const participant = (await session.roomService.listParticipants(session.roomName)).find(item => String(item.identity) === identity);
        if (!participant) throw Object.assign(new Error("Participant is no longer in the room"), { statusCode: 404, apiError: "studio_participant_not_found" });
        const runtime = getLiveKitRuntime();
        await session.roomService.updateParticipant(session.roomName, identity, { permission: {
            canPublish: true, canPublishSources: [runtime.sdk.TrackSource.MICROPHONE, runtime.sdk.TrackSource.SCREEN_SHARE, runtime.sdk.TrackSource.SCREEN_SHARE_AUDIO], canPublishData: false, canSubscribe: true
        }});
        session.mutedIdentities.delete(identity);
        // Remote unmute is disabled in some LiveKit configurations; allow publishing and let the guest toggle mic if needed.
        let remotelyUnmuted = false;
        const micTrack = (participant.tracks || []).find(track => {
            const source = String(track.source ?? "").toLowerCase();
            return source.includes("microphone") || source === "2" || track.source === runtime.sdk.TrackSource?.MICROPHONE;
        });
        if (micTrack) {
            try { await session.roomService.mutePublishedTrack(session.roomName, identity, micTrack.sid, false); remotelyUnmuted = true; }
            catch (_) { /* permission restored; participant may need to toggle mic locally */ }
        }
        await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "live_studio_unmute", timestamp: Date.now(), summary: `Restored microphone publishing permission for Live Studio participant ${identity}` }).catch(err => console.error("Live Studio audit write failed:", err.message));
        return res.json({ ok: true, identity, muted: false, remotelyUnmuted, mayNeedMicToggle: !remotelyUnmuted });
    } catch (err) { return adminApiError(res, err, "live_studio_unmute_failed"); }
});
app.post("/api/admin/live-studio/kick", async (req, res) => {
    try {
        const actor = await verifyAdminApiRequest(req);
        if (!checkCppRateLimit(req, res, "admin-live-studio-kick", 20, 60_000)) return;
        const guild = await getReadyAdminGuild();
        const session = studioSessionForGuild(guild.id);
        const identity = String(req.body?.identity || "");
        if (!session || session.ownerUid !== actor.uid) throw Object.assign(new Error("Live Studio is not active"), { statusCode: 409, apiError: "live_studio_not_active" });
        if (!isGuestStudioIdentity(identity)) throw Object.assign(new Error("Only invited guests can be removed from the panel"), { statusCode: 400, apiError: "invalid_studio_target" });
        session.deniedIdentities.add(identity);
        try { await session.roomService.removeParticipant(session.roomName, identity, { revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)) }); }
        catch (err) { session.deniedIdentities.delete(identity); throw err; }
        await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "live_studio_kick", timestamp: Date.now(), summary: `Removed Live Studio participant ${identity}; denied for remaining session` }).catch(err => console.error("Live Studio audit write failed:", err.message));
        return res.json({ ok: true, identity, removed: true });
    } catch (err) { return adminApiError(res, err, "live_studio_kick_failed"); }
});
app.post("/api/admin/live-studio/end", async (req, res) => {
    try {
        const actor = await verifyAdminApiRequest(req);
        const guild = await getReadyAdminGuild();
        const session = liveStudioSessions.get(guild.id);
        if (session && session.ownerUid !== actor.uid) throw Object.assign(new Error("Only the session owner can end Live Studio"), { statusCode: 403, apiError: "forbidden" });
        await endLiveStudioForGuild(guild.id, "Admin ended Live Studio", actor.uid);
        return res.json({ ok: true, active: false });
    } catch (err) { return adminApiError(res, err, "live_studio_end_failed"); }
});

app.post("/api/admin/accounts/lookup", async (req, res) => {
    try {
        const actor = await verifyAdminApiRequest(req);
        const username = String(req.body?.username || "").trim().toLowerCase();
        if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ ok: false, error: "invalid_username" });
        const snap = await db.ref(`users/${username}`).once("value");
        const record = snap.val();
        if (!record) return res.status(404).json({ ok: false, error: "not_found" });
        const safe = { username, status: String(record.status || "active"), category: String(record.category || ""), package: String(record.package || ""),
            lockType: String(record.lockType || "HWID").toUpperCase(), hwid: String(record.hwid || ""), expiresAt: Number(record.expiresAt) || 0,
            activeSession: !!record.activeSessionId, lastActive: Number(record.lastActive) || 0, discordId: String(record.discordId || "") };
        await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "account_lookup", timestamp: Date.now(), summary: `Looked up C++ account ${username}` });
        return res.json({ ok: true, account: safe });
    } catch (err) {
        const status = Number(err.statusCode) || 500;
        const error = status === 403 ? "forbidden" : status === 401 ? "unauthorized" : status === 503 ? "server_unavailable" : "lookup_failed";
        return res.status(status).json({ ok: false, error });
    }
});
app.post("/api/admin/accounts/create", async (req, res) => {
    if (!checkCppRateLimit(req, res, "admin-account-create", 20, 10 * 60 * 1000)) return;
    try {
        const actor = await verifyAdminApiRequest(req);
        const username = String(req.body?.username || "").trim().toLowerCase();
        const password = String(req.body?.password || "");
        const hwid = String(req.body?.hwid || "").trim();
        const lockType = String(req.body?.lockType || "HWID").toUpperCase();
        const status = String(req.body?.status || "active").toLowerCase();
        const category = String(req.body?.category || "weekly").toLowerCase();
        const days = Number(req.body?.expiresDays);
        if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ ok: false, error: "invalid_username" });
        if (password.length < 8 || password.length > 128) return res.status(400).json({ ok: false, error: "invalid_password" });
        if (hwid && !/^[A-Za-z0-9_-]{1,80}$/.test(hwid)) return res.status(400).json({ ok: false, error: "invalid_hwid" });
        if (!["HWID", "ONLINE"].includes(lockType) || !["active", "suspended", "disabled"].includes(status)) return res.status(400).json({ ok: false, error: "invalid_settings" });
        if (!["weekly", "monthly", "2_months"].includes(category)) return res.status(400).json({ ok: false, error: "invalid_package" });
        if (!Number.isInteger(days) || days < 1 || days > 3650) return res.status(400).json({ ok: false, error: "invalid_expiry" });

        const now = Date.now();
        const packageName = category === "weekly" ? "Weekly" : category === "monthly" ? "Monthly" : "2 Months";
        const passwordHash = await hashCppPassword(password);
        const account = {
            username,
            passwordHash,
            category,
            package: packageName,
            status,
            lockType,
            createdAt: now,
            expiresAt: now + days * 24 * 60 * 60 * 1000,
            paidAmount: 0,
            usedTxns: [],
            adminCreated: true,
            source: "admin_panel",
            createdByAdmin: actor.uid,
            adminUpdatedAt: now,
            adminUpdatedBy: actor.uid,
            activeSessionId: null,
            isLoggedIn: false,
            lastActive: 0
        };
        if (hwid) account.hwid = hwid;

        // Atomic creation: never overwrite an existing record, even if it is expired.
        const userRef = db.ref(`users/${username}`);
        const claim = await userRef.transaction(current => current ? undefined : account, undefined, false);
        if (!claim.committed) return res.status(409).json({ ok: false, error: "username_conflict" });
        await db.ref("auditLog").push({
            adminUid: actor.uid,
            actionType: "cpp_account_create",
            timestamp: now,
            summary: `Created admin-managed C++ account ${username}; package=${packageName}; days=${days}; lock=${lockType}; status=${status}; hwid=${hwid ? "set" : "unbound"}; payment=not_recorded`
        });
        return res.status(201).json({ ok: true, username, package: packageName, category, status, lockType, expiresAt: account.expiresAt, paidAmount: 0, source: "admin_panel" });
    } catch (err) {
        console.error("Admin account create failed:", err.message);
        const status = Number(err.statusCode) || 500;
        const error = status === 403 ? "forbidden" : status === 401 ? "unauthorized" : status === 503 ? "server_unavailable" : "create_failed";
        return res.status(status).json({ ok: false, error });
    }
});

app.post("/api/admin/accounts/update", async (req, res) => {
    try {
        const actor = await verifyAdminApiRequest(req);
        const username = String(req.body?.username || "").trim().toLowerCase();
        const newUsername = String(req.body?.newUsername || username).trim().toLowerCase();
        const newPassword = String(req.body?.newPassword || "");
        const hwid = String(req.body?.hwid || "").trim();
        const lockType = String(req.body?.lockType || "HWID").toUpperCase();
        const status = String(req.body?.status || "active").toLowerCase();
        if (!/^[a-z0-9_]{3,20}$/.test(username) || !/^[a-z0-9_]{3,20}$/.test(newUsername)) return res.status(400).json({ ok: false, error: "invalid_username" });
        if (newPassword && (newPassword.length < 8 || newPassword.length > 128)) return res.status(400).json({ ok: false, error: "invalid_password" });
        if (hwid && !/^[A-Za-z0-9_-]{1,80}$/.test(hwid)) return res.status(400).json({ ok: false, error: "invalid_hwid" });
        if (!["HWID", "ONLINE"].includes(lockType) || !["active", "suspended", "disabled"].includes(status)) return res.status(400).json({ ok: false, error: "invalid_settings" });
        const usersRef = db.ref("users");
        const existing = await usersRef.child(username).once("value");
        if (!existing.exists()) return res.status(404).json({ ok: false, error: "not_found" });
        const passwordHash = newPassword ? await hashCppPassword(newPassword) : null;
        const tx = await usersRef.transaction(allUsers => {
            if (!allUsers || !allUsers[username]) return;
            if (newUsername !== username && allUsers[newUsername]) return;
            const current = { ...allUsers[username] };
            const next = { ...current, username: newUsername, lockType, status, activeSessionId: null, isLoggedIn: false,
                adminUpdatedAt: Date.now(), adminUpdatedBy: actor.uid };
            if (hwid) next.hwid = hwid; else delete next.hwid;
            if (passwordHash) { next.passwordHash = passwordHash; delete next.password; }
            allUsers[newUsername] = next;
            if (newUsername !== username) delete allUsers[username];
            return allUsers;
        }, undefined, false);
        if (!tx.committed) return res.status(409).json({ ok: false, error: "username_conflict_or_changed" });
        await db.ref("auditLog").push({ adminUid: actor.uid, actionType: "cpp_account_update", timestamp: Date.now(), summary: `Updated C++ account ${username} -> ${newUsername}; lock=${lockType}; status=${status}; hwid=${hwid ? "set" : "reset"}; password=${newPassword ? "changed" : "unchanged"}` });
        return res.json({ ok: true, username: newUsername, sessionInvalidated: true });
    } catch (err) {
        console.error("Admin account update failed:", err.message);
        const status = Number(err.statusCode) || 500;
        const error = status === 403 ? "forbidden" : status === 401 ? "unauthorized" : status === 503 ? "server_unavailable" : "update_failed";
        return res.status(status).json({ ok: false, error });
    }
});
async function verifyCppRequest(req) {
    const token = readBearerToken(req);
    if (!token) throw Object.assign(new Error("Missing bearer token"), { statusCode: 401 });
    const decoded = await admin.auth().verifyIdToken(token, true);
    if (!decoded || !["user", "key"].includes(String(decoded.appType || "")) || !decoded.sessionId) {
        throw Object.assign(new Error("Invalid C++ session"), { statusCode: 403 });
    }
    return decoded;
}

app.post("/api/cpp/login", async (req, res) => {
    if (!checkCppRateLimit(req, res, "cpp-login", 8, 10 * 60 * 1000)) return;
    try {
        const username = String(req.body?.username || "").trim().toLowerCase();
        const password = String(req.body?.password || "");
        const hwid = String(req.body?.hwid || "").trim();
        if (!/^[a-z0-9_]{3,20}$/.test(username) || password.length < 1 || password.length > 128 || !/^[A-Za-z0-9_-]{1,80}$/.test(hwid)) {
            return cppApiError(res, 400, "invalid_input", "Username, password অথবা device ID সঠিক নয়।");
        }
        const userRef = db.ref(`users/${username}`);
        const snapshot = await userRef.once("value");
        const initial = snapshot.val();
        if (!initial) return cppApiError(res, 401, "invalid_credentials", "Username অথবা password ভুল।");
        if (initial.status && initial.status !== "active") return cppApiError(res, 403, "account_inactive", "অ্যাকাউন্ট inactive বা suspended।");
        const oldExpiry = Number(initial.expiresAt) || 0;
        if (oldExpiry > 0 && oldExpiry <= Date.now()) return cppApiError(res, 403, "account_expired", "অ্যাকাউন্টের মেয়াদ শেষ।");
        const passwordOk = await verifyCppPassword(password, initial);
        if (!passwordOk) return cppApiError(res, 401, "invalid_credentials", "Username অথবা password ভুল।");

        // Migrate old plaintext-only accounts to scrypt after a successful credential check.
        let verifiedPasswordHash = String(initial.passwordHash || "");
        if (!verifiedPasswordHash && typeof initial.password === "string") {
            const migratedHash = await hashCppPassword(password);
            await userRef.transaction(current => {
                if (!current || current.passwordHash || current.password !== password) return;
                return { ...current, passwordHash: migratedHash, password: null, passwordMigratedAt: Date.now() };
            }, undefined, false);
            const migratedSnapshot = await userRef.once("value");
            const migratedAccount = migratedSnapshot.val();
            if (!migratedAccount || !(await verifyCppPassword(password, migratedAccount)) || !migratedAccount.passwordHash) {
                return cppApiError(res, 401, "invalid_credentials", "Login details changed; please sign in again.");
            }
            verifiedPasswordHash = String(migratedAccount.passwordHash);
        }

        const sessionId = crypto.randomUUID();
        const claim = await userRef.transaction(current => {
            if (!current || current.passwordHash !== verifiedPasswordHash || (current.status && current.status !== "active")) return;
            const expiry = Number(current.expiresAt) || 0;
            if (expiry > 0 && expiry <= Date.now()) return;
            const lockType = String(current.lockType || "HWID").toUpperCase();
            const savedHwid = String(current.hwid || "");
            const activeSessionId = String(current.activeSessionId || "");
            const lastActive = Number(current.lastActive) || 0;
            const sessionTimeoutMs = Math.max(60_000, Number(process.env.CPP_SESSION_STALE_MS || 120_000));
            const priorSessionFresh = !!activeSessionId && (Date.now() - lastActive) < sessionTimeoutMs;
            // Both lock modes permit only one active session. HWID additionally pins the account to one PC.
            if (activeSessionId && activeSessionId !== sessionId && priorSessionFresh) return;
            if (lockType === "HWID" && savedHwid && savedHwid !== hwid) return;
            if (! ["HWID", "ONLINE", "DIGITAL"].includes(lockType)) return;
            return {
                ...current,
                lockType: lockType === "DIGITAL" ? "ONLINE" : lockType,
                hwid: savedHwid || hwid,
                activeSessionId: sessionId,
                lastActive: Date.now(),
                isLoggedIn: true,
                lastAuthAt: Date.now()
            };
        }, undefined, false);
        if (!claim.committed) return cppApiError(res, 409, "device_or_session_conflict", "অ্যাকাউন্ট অন্য ডিভাইসে active অথবা device lock mismatch।");
        const account = claim.snapshot.val() || {};
        const uid = makeCppUid("u", username);
        watchCppUserProfile(username, uid);
        const profile = getSafeCppProfile(uid, account, "user");
        return await createCppTokenReply(res, uid, { appType: "user", appUser: username, sessionId, lockType: String(account.lockType || "HWID").toUpperCase() }, profile, sessionId);
    } catch (err) {
        console.error("C++ login bridge error:", err.message);
        return cppApiError(res, 500, "server_error", "Login service-এ সমস্যা হয়েছে। পরে আবার চেষ্টা করুন।");
    }
});

app.post("/api/cpp/key-login", async (req, res) => {
    if (!checkCppRateLimit(req, res, "cpp-key-login", 6, 10 * 60 * 1000)) return;
    try {
        const key = String(req.body?.key || "").trim();
        const hwid = String(req.body?.hwid || "").trim();
        if (!/^KEY-[A-Z0-9]{6}-[0-9]{4}$/i.test(key) || !/^[A-Za-z0-9_-]{1,80}$/.test(hwid)) {
            return cppApiError(res, 400, "invalid_input", "Developer key অথবা device ID সঠিক নয়।");
        }
        const keyRef = db.ref(`keys/${key}`);
        const sessionId = crypto.randomUUID();
        const claim = await keyRef.transaction(current => {
            if (!isCppKeyUsable(current)) return;
            const savedHwid = String(current.hwid || "");
            if (current.used === true && savedHwid && savedHwid !== hwid) return;
            const expiry = Number(current.expiresAt) || 0;
            if (expiry > 0 && expiry <= Date.now()) return;
            return { ...current, used: true, hwid: savedHwid || hwid, activeSessionId: sessionId, lastUsedAt: Date.now() };
        }, undefined, false);
        if (!claim.committed) return cppApiError(res, 409, "key_claimed", "এই key অন্য device-এ ব্যবহার হয়েছে অথবা বাতিল/expired।");
        const uid = makeCppUid("k", key);
        await db.ref(`cppKeySessions/${uid}`).set({ key, hwid, sessionId, updatedAt: Date.now() });
        watchCppKeyProfile(key, uid);
        const profile = getSafeCppProfile(uid, claim.snapshot.val(), "key", { usedKey: key });
        return await createCppTokenReply(res, uid, { appType: "key", sessionId }, profile, sessionId);
    } catch (err) {
        console.error("C++ key login bridge error:", err.message);
        return cppApiError(res, 500, "server_error", "Developer key service-এ সমস্যা হয়েছে। পরে চেষ্টা করুন।");
    }
});

app.post("/api/cpp/heartbeat", async (req, res) => {
    try {
        const decoded = await verifyCppRequest(req);
        const now = Date.now();
        if (decoded.appType === "user") {
            const username = String(decoded.appUser || "");
            if (!/^[a-z0-9_]{3,20}$/.test(username)) return cppApiError(res, 403, "invalid_session", "Session account mapping invalid।");
            const ref = db.ref(`users/${username}`);
            const snap = await ref.once("value");
            const account = snap.val();
            if (!account || account.activeSessionId !== decoded.sessionId) return cppApiError(res, 409, "session_replaced", "এই session অন্য login দিয়ে প্রতিস্থাপিত হয়েছে।");
            const expiry = Number(account.expiresAt) || 0;
            if ((account.status && account.status !== "active") || (expiry > 0 && expiry <= now)) {
                await db.ref(`cppProfiles/${decoded.uid}`).set(getSafeCppProfile(decoded.uid, account, "user"));
                watchCppUserProfile(username, decoded.uid);
                return cppApiError(res, 403, "account_revoked", "অ্যাকাউন্ট inactive অথবা মেয়াদ শেষ।");
            }
            const updates = { lastActive: now };
            if (["ONLINE", "DIGITAL", "HWID"].includes(String(account.lockType || "HWID").toUpperCase())) updates.isLoggedIn = true;
            await ref.update(updates);
            watchCppUserProfile(username, decoded.uid);
        } else {
            const sessionSnap = await db.ref(`cppKeySessions/${decoded.uid}`).once("value");
            const session = sessionSnap.val();
            if (!session || session.sessionId !== decoded.sessionId || !session.key) return cppApiError(res, 409, "session_replaced", "Developer key session শেষ হয়েছে।");
            const keySnap = await db.ref(`keys/${session.key}`).once("value");
            const keyData = keySnap.val();
            if (!isCppKeyUsable(keyData, now) || String(keyData.hwid || "") !== String(session.hwid || "") || String(keyData.activeSessionId || "") !== decoded.sessionId) {
                await db.ref(`cppProfiles/${decoded.uid}`).set(getSafeCppProfile(decoded.uid, keyData, "key", { usedKey: session.key }));
                watchCppKeyProfile(session.key, decoded.uid);
                return cppApiError(res, 403, "key_revoked", "Developer key বাতিল অথবা session invalid।");
            }
            await db.ref(`cppKeySessions/${decoded.uid}/updatedAt`).set(now);
            watchCppKeyProfile(session.key, decoded.uid);
        }
        return res.json({ ok: true, serverTime: now });
    } catch (err) {
        const status = Number(err.statusCode) || 401;
        return cppApiError(res, status, status === 401 ? "unauthorized" : "invalid_session", "Session যাচাই করা যায়নি। আবার login করুন।");
    }
});

app.post("/api/cpp/logout", async (req, res) => {
    try {
        const decoded = await verifyCppRequest(req);
        if (decoded.appType === "user") {
            const username = String(decoded.appUser || "");
            const ref = db.ref(`users/${username}`);
            const cleared = await ref.transaction(current => {
                if (!current || current.activeSessionId !== decoded.sessionId) return;
                const next = { ...current, activeSessionId: null, lastActive: Date.now() };
                next.isLoggedIn = false;
                return next;
            }, undefined, false);
            if (cleared.committed) stopCppProfileWatcher(`user:${username}`, decoded.uid);
        } else {
            const sessionRef = db.ref(`cppKeySessions/${decoded.uid}`);
            const sessionSnap = await sessionRef.once("value");
            const session = sessionSnap.val();
            if (session?.sessionId === decoded.sessionId) {
                await sessionRef.remove();
                if (session.key) {
                    const cleared = await db.ref(`keys/${session.key}`).transaction(current => current?.activeSessionId === decoded.sessionId ? { ...current, activeSessionId: null } : undefined, undefined, false);
                    if (cleared.committed) stopCppProfileWatcher(`key:${session.key}`, decoded.uid);
                }
            }
        }
        return res.json({ ok: true });
    } catch (_) {
        return res.status(401).json({ ok: false, error: "unauthorized" });
    }
});

app.post("/api/cpp/log", async (req, res) => {
    try {
        const decoded = await verifyCppRequest(req);
        const type = String(req.body?.type || "APP_EVENT").replace(/[^A-Z0-9_]/gi, "").slice(0, 40) || "APP_EVENT";
        const details = String(req.body?.details || "").slice(0, 240);
        await db.ref("app_logs").push({ type, username: String(decoded.appUser || (decoded.appType === "key" ? "VIP User" : "unknown")).slice(0, 80), details, timestamp: Date.now(), createdAt: Date.now() });
        return res.json({ ok: true });
    } catch (_) { return res.status(401).json({ ok: false, error: "unauthorized" }); }
});

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
const liveVoiceWss = new WebSocketServer({
    noServer: true,
    maxPayload: 256 * 1024,
    perMessageDeflate: false,
    handleProtocols: protocols => protocols.has("rkbackles-live-v1") ? "rkbackles-live-v1" : false
});
server.on("upgrade", (request, socket, head) => {
    let parsed;
    try { parsed = new URL(request.url || "/", "http://localhost"); } catch (_) { socket.destroy(); return; }
    if (parsed.pathname !== "/api/admin/discord/voice/live") { socket.destroy(); return; }
    const origin = String(request.headers.origin || "");
    if (!origin || !ADMIN_PANEL_ORIGINS.has(origin)) { socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
    const ticket = extractOneTimeTicketFromProtocols(request.headers["sec-websocket-protocol"]);
    if (!ticket) { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
    const digest = crypto.createHash("sha256").update(ticket).digest("hex");
    const record = liveVoiceTickets.get(digest);
    if (!record || record.expiresAt <= Date.now()) { liveVoiceTickets.delete(digest); socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
    liveVoiceTickets.delete(digest); // consume before any further checks so rejected tickets cannot be replayed
    const session = adminVoiceSessions.get(record.guildId);
    if (!session?.connection || (session.liveSocket && [WebSocket.OPEN, WebSocket.CONNECTING, WebSocket.CLOSING].includes(session.liveSocket.readyState))) {
        socket.write("HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n"); socket.destroy(); return;
    }
    liveVoiceWss.handleUpgrade(request, socket, head, ws => liveVoiceWss.emit("connection", ws, request, record, session));
});
liveVoiceWss.on("connection", (socket, request, ticketRecord, session) => {
    const guild = client.guilds.cache.get(ticketRecord.guildId);
    if (!guild || session.connection?.state?.status !== require("@discordjs/voice").VoiceConnectionStatus.Ready) {
        socket.close(1011, "Discord voice connection unavailable");
        return;
    }
    session.liveSocket = socket;
    socket.liveStarted = false;
    socket.liveByteWindowStartedAt = Date.now();
    socket.liveBytesInWindow = 0;
    const stopReceiver = startLiveDiscordAudioRelay(socket, session, guild);
    const maxTimer = setTimeout(() => {
        sendLiveVoiceJson(socket, { type: "error", error: "live_voice_duration_limit" });
        closeLiveVoiceSocket(session, 1000, "live voice maximum duration reached");
    }, LIVE_VOICE_MAX_DURATION_MS);
    if (typeof maxTimer.unref === "function") maxTimer.unref();
    const authCheckTimer = setInterval(async () => {
        try {
            const authSnapshot = await db.ref(`adminUids/${ticketRecord.uid}`).once("value");
            if (authSnapshot.val() !== true) closeLiveVoiceSocket(session, 1008, "Admin permission revoked");
        } catch (_) {
            // Fail closed on repeated auth lookup errors rather than leaving a microphone open indefinitely.
            closeLiveVoiceSocket(session, 1011, "Admin authorization could not be revalidated");
        }
    }, 30_000);
    if (typeof authCheckTimer.unref === "function") authCheckTimer.unref();
    socket.on("message", (data, isBinary) => {
        if (isBinary) {
            if (!socket.liveStarted || session.liveSocket !== socket || !session.liveProcess || !session.liveProcess.stdin || session.liveProcess.stdin.destroyed || !session.liveProcess.stdin.writable) {
                // An inactive/dead audio pipeline must not leave the browser sending audio forever.
                // Close once instead of replying for every subsequent PCM packet.
                if (socket.readyState === WebSocket.OPEN) {
                    if (!socket.liveFailureNotified) {
                        socket.liveFailureNotified = true;
                        sendLiveVoiceJson(socket, { type: "error", error: session.liveProcess?.rawPcm ? "live_voice_audio_pipeline_failed" : (session.liveProcess ? "live_voice_transcode_failed" : "live_voice_stream_ended") });
                    }
                    try { socket.close(1011, "microphone stream is not writable"); } catch (_) { try { socket.terminate(); } catch (_) {} }
                }
                return;
            }
            const activeProcess = session.liveProcess;
            if (activeProcess.rawPcm && (data.length === 0 || data.length > 96 * 1024 || data.length % 4 !== 0)) {
                sendLiveVoiceJson(socket, { type: "error", error: "live_voice_invalid_pcm_frame" });
                try { socket.close(1003, "invalid PCM frame"); } catch (_) {}
                return;
            }
            const now = Date.now();
            if (now - socket.liveByteWindowStartedAt >= 1000) { socket.liveByteWindowStartedAt = now; socket.liveBytesInWindow = 0; }
            socket.liveBytesInWindow += data.length;
            if (socket.liveBytesInWindow > LIVE_VOICE_MAX_BYTES_PER_SECOND) { socket.close(1008, "microphone bitrate limit exceeded"); return; }
            try {
                // The in-process PCM adapter counts its own writes. Count here only for the
                // legacy child-process transcoder so diagnostic inputBytes is never doubled.
                if (!session.liveProcess.rawPcm) session.liveProcess.liveInputBytes = (session.liveProcess.liveInputBytes || 0) + data.length;
                session.liveProcess.stdin.write(data);
            }
            catch (err) {
                console.error("Live voice audio write failed:", err?.message || err);
                sendLiveVoiceJson(socket, { type: "error", error: "live_voice_transcode_failed" });
                try { socket.close(1011, "microphone stream write failed"); } catch (_) { try { socket.terminate(); } catch (_) {} }
            }
            return;
        }
        let payload;
        try { payload = JSON.parse(Buffer.from(data).toString("utf8")); } catch (_) { socket.close(1003, "invalid control message"); return; }
        if (!payload || typeof payload !== "object") { socket.close(1003, "invalid control message"); return; }
        if (payload.type === "start") {
            if (socket.liveStarted) { sendLiveVoiceJson(socket, { type: "error", error: "live_voice_already_started" }); return; }
            socket.liveStarted = true;
            beginLiveMicStream(socket, session, ticketRecord.uid, payload.mimeType).catch(err => {
                socket.liveStarted = false;
                sendLiveVoiceJson(socket, { type: "error", error: String(err.apiError || "live_voice_start_failed") });
            });
        } else if (payload.type === "stop") {
            socket.liveStarted = false;
            stopLiveMicProcess(session);
        } else {
            socket.close(1003, "unknown control message");
        }
    });
    socket.once("close", () => {
        clearTimeout(maxTimer);
        clearInterval(authCheckTimer);
        stopReceiver();
        if (session.liveSocket === socket) session.liveSocket = null;
        stopLiveMicProcess(session);
        if (session.liveResource && session.player?.state?.resource === session.liveResource) session.player.stop(true);
        session.liveResource = null;
        session.liveStartedAt = 0;
        db.ref("auditLog").push({ adminUid: ticketRecord.uid, actionType: "discord_live_voice_end", timestamp: Date.now(), summary: `Admin live microphone session ended in ${session.channelName || session.channelId}; audio not stored` }).catch(err => console.error("Live voice audit write failed:", err.message));
    });
    socket.once("error", err => console.error("Admin live voice websocket error:", err.message));
    db.ref("auditLog").push({ adminUid: ticketRecord.uid, actionType: "discord_live_voice_start", timestamp: Date.now(), summary: `Admin opened two-way live voice relay in ${session.channelName || session.channelId}; audio not stored` }).catch(err => console.error("Live voice audit write failed:", err.message));
    sendLiveVoiceJson(socket, { type: "connected", channelName: session.channelName || "voice channel", audioIsNotStored: true });
});
client.once("ready", () => {
    if (!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET)) return;
    try {
        const runtime = getLiveKitRuntime();
        runtime.roomService.listRooms().then(rooms => Promise.all((rooms || []).filter(room => String(room.name || "").startsWith(`rkbs_${ALLOWED_GUILD_ID}_`)).map(room =>
            runtime.roomService.deleteRoom(room.name).then(() => console.log(`Removed stale Live Studio room after Bot restart: ${room.name}`)).catch(err => console.warn("Stale Live Studio room cleanup failed:", err.message))
        ))).catch(err => console.warn("Live Studio startup cleanup failed:", err.message));
    } catch (err) { console.warn("Live Studio disabled until credentials are configured:", err.apiError || err.message); }
});
server.listen(PORT, () => { console.log(`🌐 Web server running on port ${PORT}`); });

// ================================
// 📱 Dynamic Realtime Settings (Firebase Sync)
// ================================

let VERIFICATION_LINK = "https://discord.gg/example"; // existing non-payment setting

// Legacy settings path is still supported for older projects. Once adminConfig/bot exists,
// its values take precedence so old settings cannot silently overwrite the Admin Panel.
db.ref("settings").on("value", (snapshot) => {
    const data = snapshot.val() || {};
    const numbers = data.payment_numbers || {};
    LEGACY_PAYMENT_NUMBERS = {
        bkash: normalizeBangladeshPaymentNumber(numbers.bkash || data.bkash_payment_number || process.env.BKASH_PAYMENT_NUMBER),
        nagad: normalizeBangladeshPaymentNumber(numbers.nagad || data.nagad_payment_number || process.env.NAGAD_PAYMENT_NUMBER)
    };
    if (!adminConfigLoaded) {
        PAYMENT_NUMBERS = { ...LEGACY_PAYMENT_NUMBERS };
    } else {
        const payment = ADMIN_BOT_CONFIG.payment || {};
        if (!Object.prototype.hasOwnProperty.call(payment, "bkashNumber")) PAYMENT_NUMBERS.bkash = LEGACY_PAYMENT_NUMBERS.bkash;
        if (!Object.prototype.hasOwnProperty.call(payment, "nagadNumber")) PAYMENT_NUMBERS.nagad = LEGACY_PAYMENT_NUMBERS.nagad;
    }
    if (data.verification_link && !String(ADMIN_BOT_CONFIG.links?.verificationLink || "").trim()) VERIFICATION_LINK = String(data.verification_link).slice(0, 300);
});

// Live Admin Panel configuration. Missing keys keep the historical defaults for compatibility.
db.ref("adminConfig/bot").on("value", (snapshot) => {
    const root = snapshot.val();
    if (!root || typeof root !== "object") return;
    adminConfigLoaded = true;
    ADMIN_BOT_CONFIG = {
        ...ADMIN_BOT_CONFIG,
        ...root,
        features: { ...ADMIN_BOT_CONFIG.features, ...(root.features || {}) },
        checkout: { ...ADMIN_BOT_CONFIG.checkout, ...(root.checkout || {}) },
        coupons: { ...ADMIN_BOT_CONFIG.coupons, ...(root.coupons || {}) },
        automod: { ...ADMIN_BOT_CONFIG.automod, ...(root.automod || {}) },
        leveling: { ...ADMIN_BOT_CONFIG.leveling, ...(root.leveling || {}) },
        links: { ...ADMIN_BOT_CONFIG.links, ...(root.links || {}) },
        presence: { ...ADMIN_BOT_CONFIG.presence, ...(root.presence || {}) },
        messages: { ...ADMIN_BOT_CONFIG.messages, ...(root.messages || {}) },
        discord: {
            ...(ADMIN_BOT_CONFIG.discord || {}), ...(root.discord || {}),
            channels: { ...(ADMIN_BOT_CONFIG.discord?.channels || {}), ...((root.discord || {}).channels || {}) },
            roles: { ...(ADMIN_BOT_CONFIG.discord?.roles || {}), ...((root.discord || {}).roles || {}) }
        }
    };
    if (Object.prototype.hasOwnProperty.call(ADMIN_BOT_CONFIG.links || {}, "verificationLink")) {
        const configuredLink = String(ADMIN_BOT_CONFIG.links.verificationLink || "").trim();
        if (configuredLink) VERIFICATION_LINK = configuredLink.slice(0, 300);
    }
    const payment = root.payment || {};
    const hasBkash = Object.prototype.hasOwnProperty.call(payment, "bkashNumber");
    const hasNagad = Object.prototype.hasOwnProperty.call(payment, "nagadNumber");
    PAYMENT_NUMBERS = {
        bkash: normalizeBangladeshPaymentNumber(hasBkash ? payment.bkashNumber : LEGACY_PAYMENT_NUMBERS.bkash || process.env.BKASH_PAYMENT_NUMBER),
        nagad: normalizeBangladeshPaymentNumber(hasNagad ? payment.nagadNumber : LEGACY_PAYMENT_NUMBERS.nagad || process.env.NAGAD_PAYMENT_NUMBER)
    };
    PAYMENT_INSTRUCTIONS = String(payment.instructions || "").slice(0, 1000);

    const packageConfig = root.packages || {};
    const weekly = packageConfig.weekly || {};
    const monthly = packageConfig.monthly || {};
    const twoMonths = packageConfig.twoMonths || packageConfig["2_months"] || {};
    const priceCandidate = {
        weekly: Number(weekly.price), monthly: Number(monthly.price), "2_months": Number(twoMonths.price)
    };
    PACKAGE_PRICES = {
        weekly: Number.isFinite(priceCandidate.weekly) && priceCandidate.weekly >= 0 ? priceCandidate.weekly : DEFAULT_PACKAGE_PRICES.weekly,
        monthly: Number.isFinite(priceCandidate.monthly) && priceCandidate.monthly >= 0 ? priceCandidate.monthly : DEFAULT_PACKAGE_PRICES.monthly,
        "2_months": Number.isFinite(priceCandidate["2_months"]) && priceCandidate["2_months"] >= 0 ? priceCandidate["2_months"] : DEFAULT_PACKAGE_PRICES["2_months"]
    };
    PACKAGE_ENABLED = {
        weekly: weekly.enabled !== false,
        monthly: monthly.enabled !== false,
        "2_months": twoMonths.enabled !== false
    };
    // Refresh the shop panel after prices, package availability or controls change.
    if (client.isReady()) {
        setBotPresence();
        syncAllManagedPanels().catch(err => console.error("Real-time Discord panel sync failed:", err.message));
    }
});

// ================================
// ⚙️ Bot Config & Automod Rules
// ================================

const TOKEN = process.env.TOKEN;
const ALLOWED_GUILD_ID = "1488101970425155584";
const VERIFIED_ROLE_ID = "1488333841402691664";

const WELCOME_CHANNEL_ID = "1488339169821593731";
const LOG_CHANNEL_ID = "1488340400673656973";

// অর্ডার ট্র্যাকিং চ্যানেল আইডি
const ORDER_TRACKING_CHANNEL_ID = "1488340262827855983"; 
// নতুন অর্ডার গাইড চ্যানেল আইডি
const ORDER_GUIDE_CHANNEL_ID = "1488339045602951199";

// ১-টাইম কী জেনারেটর চ্যানেল আইডি
const ONETIME_KEY_CHANNEL_IDS = ["1488340757160005683"];

const ROLES = {
    ADMIN: "1488332568372973568", 
    SUPPORT_TICKET_REPORT: "1488333580705861765", 
    SUPPORT_CUSTOMER: "1488335064873046086",
    DEVELOPER: "1523955414612578354" // Developer রোলের ID
};

const CHANNELS = {
    TICKET_PANEL: "1488339982627115118",
    REPORT_PANEL: "1488340441115004999",
    CUSTOMER_PANEL: "1488340017938960484",
    BUY_PANEL: "1488339666368462858", 
    PAYMENT_PANEL: "1488339666368462858" 
};

const COVER_IMAGES = {
    VERIFY: "https://cdn.discordapp.com/attachments/1488338142607184055/1488761437550678056/5cfd1fe4-d12c-4439-b374-f386f7595184.png",
    TICKET: "https://cdn.discordapp.com/attachments/1488338142607184055/1488761437550678056/5cfd1fe4-d12c-4439-b374-f386f7595184.png", 
    REPORT: "https://cdn.discordapp.com/attachments/1488338142607184055/1488761437550678056/5cfd1fe4-d12c-4439-b374-f386f7595184.png",
    CUSTOMER: "https://cdn.discordapp.com/attachments/1488338142607184055/1488761437550678056/5cfd1fe4-d12c-4439-b374-f386f7595184.png",
    PAYMENT: "https://cdn.discordapp.com/attachments/1488338142607184055/1488761437550678056/5cfd1fe4-d12c-4439-b374-f386f7595184.png"
};

const DEFAULT_BAD_WORDS = ["gali1", "gali2", "gali3", "khanki", "magi", "baimon"]; 

// 💰 Package price keys normalise to the live Admin Panel price map above.
function getPackagePrice(category) {
    return Number(PACKAGE_PRICES[getNormalizedCategory(category)] ?? DEFAULT_PACKAGE_PRICES.weekly);
}

function getNormalizedCategory(cat) {
    const c = String(cat || "weekly").toLowerCase().trim();
    if (["2_months", "two_months", "two_months_plan", "two", "2months", "2month"].includes(c) || c.includes("two") || c.includes("2")) return "2_months";
    if (["monthly", "monthly_plan", "month"].includes(c) || c.includes("month")) return "monthly";
    if (["weekly", "weekly_plan", "week"].includes(c) || c.includes("week")) return "weekly";
    return "weekly";
}

// New Configs
const STATS_VC_CHANNEL_ID = "1524321192079786005";
const LEVEL_ROLE_ID = "1524322087295127552";
const GIVEAWAY_CHANNEL_ID = "1488341249739198585";
const EMBED_NOTICE_CHANNEL_ID = "1488338739850772641";
const SOCIAL_FEED_CHANNEL_ID = "1488338739850772641";
const STAFF_ADMIN_LOG_ID = "1524324771502882877";
const WEEKLY_REPORT_CHANNEL_ID = "1524326280923709550";
const TRANSCRIPT_LOG_CHANNEL_ID = "1524326928268660807";

// Databases
const DATA_FILE = "./database.json";
const WELCOME_LOG_FILE = "./welcome_messages.json";
const PUNISH_FILE = "./punishments.json"; 
const ORDER_LOG_FILE = "./order_tracking.json";

// Config helpers: dashboard values override existing IDs; blank/missing values keep current IDs.
function getConfiguredChannelId(key) {
    const configured = String(ADMIN_BOT_CONFIG.discord?.channels?.[key] || "").trim();
    if (/^\d{15,25}$/.test(configured)) return configured;
    const fallback = {
        welcome: WELCOME_CHANNEL_ID, log: LOG_CHANNEL_ID, orderTracking: ORDER_TRACKING_CHANNEL_ID,
        orderGuide: ORDER_GUIDE_CHANNEL_ID, ticketPanel: CHANNELS.TICKET_PANEL,
        reportPanel: CHANNELS.REPORT_PANEL, customerPanel: CHANNELS.CUSTOMER_PANEL,
        paymentPanel: CHANNELS.PAYMENT_PANEL, giveaway: GIVEAWAY_CHANNEL_ID,
        weeklyReport: WEEKLY_REPORT_CHANNEL_ID, voiceStats: STATS_VC_CHANNEL_ID,
        transcriptLog: TRANSCRIPT_LOG_CHANNEL_ID, staffAdminLog: STAFF_ADMIN_LOG_ID,
        embedNotice: EMBED_NOTICE_CHANNEL_ID, socialFeed: SOCIAL_FEED_CHANNEL_ID,
        announcement: String(process.env.ANNOUNCEMENT_CHANNEL_ID || "").trim()
    };
    return fallback[key] || "";
}
function getConfiguredChannelIds(key) {
    const configured = ADMIN_BOT_CONFIG.discord?.channels?.[key];
    const source = Array.isArray(configured) ? configured : (typeof configured === "string" ? configured.split(/[\s,;]+/) : []);
    const ids = source.map(value => String(value || "").trim()).filter(value => /^\d{15,25}$/.test(value));
    if (ids.length) return [...new Set(ids)].slice(0, 10);
    if (key === "oneTimeKey") return ONETIME_KEY_CHANNEL_IDS;
    return [];
}
function getConfiguredRoleId(key) {
    const configured = String(ADMIN_BOT_CONFIG.discord?.roles?.[key] || "").trim();
    if (/^\d{15,25}$/.test(configured)) return configured;
    const fallback = {
        admin: ROLES.ADMIN, supportTicketReport: ROLES.SUPPORT_TICKET_REPORT,
        supportCustomer: ROLES.SUPPORT_CUSTOMER, developer: ROLES.DEVELOPER,
        verified: VERIFIED_ROLE_ID, level: LEVEL_ROLE_ID
    };
    return fallback[key] || "";
}
// Automatic Bengali announcements use an explicit channel configured in Automation & routing.
const suppressedDiscordRoleAnnouncements = new Map();
const recentDiscordRoleAnnouncements = new Map();
function discordRoleAnnouncementKey(memberId, roleId, action) { return `${memberId}:${roleId}:${action}`; }
function suppressNextDiscordRoleAnnouncement(memberId, roleId, action, ttlMs = 10000) {
    suppressedDiscordRoleAnnouncements.set(discordRoleAnnouncementKey(memberId, roleId, action), Date.now() + ttlMs);
}
function consumeSuppressedDiscordRoleAnnouncement(memberId, roleId, action) {
    const key = discordRoleAnnouncementKey(memberId, roleId, action);
    const expiresAt = suppressedDiscordRoleAnnouncements.get(key) || 0;
    suppressedDiscordRoleAnnouncements.delete(key);
    return expiresAt >= Date.now();
}
async function sendBengaliAnnouncement(guild, content, userId = "") {
    const channelId = getConfiguredChannelId("announcement");
    if (!channelId || !guild) return { sent: false, reason: "announcement_channel_not_configured" };
    let channel = guild.channels.cache.get(channelId);
    if (!channel) channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
        console.warn("Bengali announcement skipped: configured channel is missing or not text-based.");
        return { sent: false, reason: "invalid_announcement_channel" };
    }
    try {
        await channel.send({ content: String(content || "").slice(0, 1900), allowedMentions: userId ? { parse: [], users: [String(userId)] } : { parse: [] } });
        return { sent: true };
    } catch (err) {
        console.error("Bengali announcement send failed:", err.message);
        return { sent: false, reason: "send_failed" };
    }
}

function getAutomodSettings() {
    const cfg = ADMIN_BOT_CONFIG.automod || {};
    const num = (value, fallback, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
    const words = Array.isArray(cfg.blockedWords) ? cfg.blockedWords : DEFAULT_BAD_WORDS;
    return {
        maxUppercaseRatio: num(cfg.maxUppercaseRatio, 0.7, 0.5, 1),
        minCapsLetters: Math.round(num(cfg.minCapsLetters, 6, 1, 100)),
        spamCount: Math.round(num(cfg.spamCount, 5, 2, 100)),
        spamWindowSeconds: Math.round(num(cfg.spamWindowSeconds, 5, 1, 120)),
        warningLimit: Math.round(num(cfg.warningLimit, 3, 1, 20)),
        timeoutMinutes: Math.round(num(cfg.timeoutMinutes, 10, 1, 1440)),
        blockedWords: words.map(word => String(word || "").trim().toLowerCase()).filter(Boolean).slice(0, 100)
    };
}
function getLevelingSettings() {
    const cfg = ADMIN_BOT_CONFIG.leveling || {};
    const number = (value, fallback, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
    const xpMin = Math.round(number(cfg.xpMin, 5, 1, 100));
    const xpMax = Math.round(number(cfg.xpMax, 9, xpMin, 100));
    return { xpMin, xpMax: Math.max(xpMin, xpMax), xpPerLevelBase: Math.round(number(cfg.xpPerLevelBase, 100, 10, 10000)) };
}

const cooldowns = new Map();
const userMsgCounter = new Map(); 
const userWarns = new Map(); 

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.Reaction]
});

process.on("unhandledRejection", (err) => {
    console.error("[Unhandled Rejection]", err);
});
process.on("uncaughtException", (err) => {
    console.error("[Uncaught Exception] Fatal error; shutting down so the process manager can restart the bot.", err);
    process.exit(1);
});

// 🎲 ইউনিক কুপন কোড জেনারেটর (e.g., AK-A1B2C3)
function generateSecureBase36(length) {
    const range = 36n ** BigInt(length);
    return (crypto.randomBytes(8).readBigUInt64BE(0) % range)
        .toString(36)
        .toUpperCase()
        .padStart(length, "0");
}

function generateUniqueCouponCode() {
    // Keep the existing AK-XXXXXX format so existing panels/users remain compatible.
    return `AK-${generateSecureBase36(6)}`;
}


// Auto coupon defaults ON for users who have not saved a preference yet.
async function isAutoCouponEnabled(userId) {
    if (ADMIN_BOT_CONFIG.coupons?.enabled === false || ADMIN_BOT_CONFIG.features?.autoCouponEnabled === false) return false;
    const snap = await db.ref(`user_settings/${userId}/autoCouponEnabled`).once("value");
    return snap.exists() ? snap.val() === true : true;
}

function getCouponBalance(coupon) {
    const balance = Number(coupon?.remainingValue ?? coupon?.couponValue ?? coupon?.discountValue ?? 0);
    return Number.isFinite(balance) && balance > 0 ? balance : 0;
}

async function reserveBestAutoCoupon(userId, category, basePrice) {
    const snap = await db.ref("coupons").once("value");
    const allCoupons = snap.val() || {};
    const now = Date.now();
    const candidates = Object.entries(allCoupons)
        .map(([code, data]) => ({ code, data: data || {} }))
        .filter(({ data }) => data.userId === userId && data.status === "active" &&
            (!data.expiresAt || Number(data.expiresAt) > now) && getCouponBalance(data) > 0)
        .sort((a, b) => {
            const aExpiry = Number(a.data.expiresAt) || Number.MAX_SAFE_INTEGER;
            const bExpiry = Number(b.data.expiresAt) || Number.MAX_SAFE_INTEGER;
            return aExpiry - bExpiry || getCouponBalance(b.data) - getCouponBalance(a.data);
        });

    for (const candidate of candidates) {
        const couponRef = db.ref(`coupons/${candidate.code}`);
        const reservation = await couponRef.transaction((current) => {
            const time = Date.now();
            if (!current || current.status !== "active" || current.userId !== userId ||
                (current.expiresAt && Number(current.expiresAt) <= time) || getCouponBalance(current) <= 0) return;
            const heldByOtherCheckout = current.reservedBy &&
                !(current.reservedBy === userId && current.reservedCategory === category) &&
                (time - (Number(current.reservedAt) || 0) < 30 * 60 * 1000);
            if (heldByOtherCheckout) return;
            return { ...current, reservedBy: userId, reservedCategory: category, reservedAt: time };
        }, undefined, false);
        if (!reservation.committed) continue;
        const coupon = reservation.snapshot.val() || {};
        const balance = getCouponBalance(coupon);
        const discount = Math.min(Math.max(0, Number(basePrice) || 0), balance);
        if (discount <= 0) continue;
        return { code: candidate.code, balance, discount, coupon };
    }
    return null;
}

async function consumeCouponBalance(code, userId, category, requestedAmount) {
    if (!code) return { committed: false, remainingValue: 0 };
    const amountToConsume = Math.max(0, Number(requestedAmount) || 0);
    const couponRef = db.ref(`coupons/${code}`);
    return couponRef.transaction((current) => {
        if (!current || current.status !== "active" || current.userId !== userId) return;
        if (current.reservedBy && (current.reservedBy !== userId || current.reservedCategory !== category)) return;
        const balance = getCouponBalance(current);
        if (balance <= 0 || amountToConsume <= 0) return;
        const consumed = Math.min(balance, amountToConsume);
        const remainingValue = Math.max(0, Math.round((balance - consumed) * 100) / 100);
        return {
            ...current,
            remainingValue,
            status: remainingValue > 0 ? "active" : "used",
            lastUsedBy: userId,
            lastUsedAt: Date.now(),
            lastConsumedValue: consumed,
            ...(remainingValue > 0 ? { reservedBy: null, reservedCategory: null, reservedAt: null } : {
                usedBy: userId, usedAt: Date.now(), reservedBy: null, reservedCategory: null, reservedAt: null
            })
        };
    }, undefined, false);
}

async function releaseCouponReservation(code, userId, category) {
    if (!code) return;
    await db.ref(`coupons/${code}`).transaction((current) => {
        if (!current || current.status !== "active" || current.reservedBy !== userId || current.reservedCategory !== category) return;
        return { ...current, reservedBy: null, reservedCategory: null, reservedAt: null };
    }, undefined, false).catch(() => {});
}

// 📌 Firebase থেকে ডেটা নিয়ে আসার ফাংশন
async function fetchFirebasePanelData(panelType) {
    try {
        const snapshot = await db.ref(`panels/${panelType}`).once("value");
        const data = snapshot.val() || {};
        
        const customDescription = data.description || null;
        const customImage = data.image || null;

        let rawOptions = [];
        if (data.options && typeof data.options === "object") {
            rawOptions = Object.keys(data.options).map(key => {
                const item = data.options[key];
                const isObject = item !== null && typeof item === "object";
                return {
                    label: String(isObject ? (item.label ?? key) : (item ?? key)).trim().slice(0, 100),
                    value: String(isObject ? (item.value ?? key) : key).trim().slice(0, 80),
                    ...(isObject && item.description ? { description: String(item.description).trim().slice(0, 100) } : {})
                };
            });
        } else {
            rawOptions = Object.keys(data)
                .filter(key => !["description", "image", "title", "options"].includes(key))
                .map(key => ({ label: String(data[key] ?? key).trim().slice(0, 100), value: String(key).trim().slice(0, 80) }));
        }

        const usedValues = new Set();
        const options = rawOptions
            .filter(option => option.label && option.value && !usedValues.has(option.value) && usedValues.add(option.value))
            .slice(0, 25);

        const paymentPackageAliases = new Set(["weekly", "weekly_plan", "week", "monthly", "monthly_plan", "month", "2_months", "two_months", "two_months_plan", "two", "2months", "2month"]);
        if (panelType === "payment") {
            // Always normalize the shop dropdown to the three supported canonical package keys.
            // A stale/custom label or value must never route a click to the wrong package (e.g. weekly fallback).
            const customLabels = new Map();
            for (const option of rawOptions) {
                const rawValue = String(option.value || "").trim().toLowerCase();
                if (!paymentPackageAliases.has(rawValue)) continue;
                const normalized = getNormalizedCategory(rawValue);
                if (!customLabels.has(normalized) && option.label) customLabels.set(normalized, String(option.label).trim());
            }
            options.length = 0;
            if (isPackageEnabled("weekly")) options.push({ label: `${customLabels.get("weekly") || "Weekly"} — ${getPackagePrice("weekly")} BDT`, value: "weekly" });
            if (isPackageEnabled("monthly")) options.push({ label: `${customLabels.get("monthly") || "Monthly"} — ${getPackagePrice("monthly")} BDT`, value: "monthly" });
            if (isPackageEnabled("2_months")) options.push({ label: `${customLabels.get("2_months") || "2 Months"} — ${getPackagePrice("2_months")} BDT`, value: "2_months" });
            if (options.length === 0) options.push({ label: "Temporarily Unavailable", value: "none" });
        } else if (options.length === 0) {
            options.push({ label: "No Options Found", value: "none" });
        }

        return { options, customDescription, customImage, fullData: data };
    } catch (error) {
        console.error(`❌ Firebase Panel Data Fetch Error (${panelType}):`, error);
        return { 
            options: [{ label: "Error Loading Data", value: "error" }], 
            customDescription: null, 
            customImage: null,
            fullData: {}
        };
    }
}

// ================================
// 🔑 Key Generation Core Function
// ================================
async function handleOneTimeKeyGeneration(interaction) {
    if (!isFeatureEnabled("oneTimeKeyEnabled")) {
        return interaction.reply({ content: "🔑 One-Time Key Generator বর্তমানে Admin Panel থেকে বন্ধ আছে।", flags: [MessageFlags.Ephemeral] });
    }
    const member = interaction.member;
    const hasDevRole = Boolean(member?.roles?.cache?.has(getConfiguredRoleId("developer")));
    const isAdmin = Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));

    if (!hasDevRole && !isAdmin) {
        return interaction.reply({
            content: "❌ **অনুমতি নেই!** শুধুমাত্র **Developer** রোলধারীরা C++ অ্যাপের জন্য 1TIME KEY তৈরি করতে পারবেন।",
            flags: [MessageFlags.Ephemeral]
        });
    }

    try {
        const userAvatarUrl = interaction.user.displayAvatarURL({ extension: "png", size: 512 });
        const serverName = interaction.guild?.name || "Discord Server";
        let randomKey = null;

        // Collision হলে পুরোনো key overwrite না করে নতুন key তৈরি করে।
        for (let attempt = 0; attempt < 5 && !randomKey; attempt++) {
            // Keep the original KEY-XXXXXX-1234 format for C++ client compatibility.
            const candidate = `KEY-${generateSecureBase36(6)}-${Date.now().toString().slice(-4)}`;
            const keyRef = db.ref(`keys/${candidate}`);
            const result = await keyRef.transaction((current) => current === null ? {
                used: false,
                generatedBy: interaction.user.tag,
                username: interaction.user.username,
                userId: interaction.user.id,
                avatarUrl: userAvatarUrl,
                serverName,
                createdAt: Date.now()
            } : undefined, undefined, false);
            if (result.committed) randomKey = candidate;
        }

        if (!randomKey) throw new Error("Could not allocate a unique one-time key after several attempts.");

        const keyEmbed = new EmbedBuilder()
            .setTitle("🔑 1TIME KEY Generated Successfully!")
            .setDescription(`আপনার ১-টাইম কী সফলভাবে তৈরি হয়েছে। C++ অ্যাপে লগইন করতে নিচের কী-টি ব্যবহার করুন:\n\n**KEY:** \`${randomKey}\``)
            .setThumbnail(userAvatarUrl)
            .setColor("#57F287")
            .setFooter({ text: "নোট: এই কী-টি C++ অ্যাপে কেবল একবারই ব্যবহার করা যাবে।" });

        return interaction.reply({ embeds: [keyEmbed], flags: [MessageFlags.Ephemeral] });
    } catch (err) {
        console.error("❌ One-time key generation failed:", err);
        const payload = { content: "❌ কী তৈরি করা যায়নি। Firebase configuration/permission পরীক্ষা করে আবার চেষ্টা করুন।", flags: [MessageFlags.Ephemeral] };
        if (interaction.replied || interaction.deferred) return interaction.followUp(payload).catch(() => {});
        return interaction.reply(payload).catch(() => {});
    }
}

// ================================
// 📂 Database Helper Functions
// ================================

function getSavedMembers() { if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([]), "utf8"); return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
function saveMembers(memberIds) { fs.writeFileSync(DATA_FILE, JSON.stringify(memberIds, null, 2), "utf8"); }
function getWelcomeLogs() { if (!fs.existsSync(WELCOME_LOG_FILE)) fs.writeFileSync(WELCOME_LOG_FILE, JSON.stringify({}), "utf8"); return JSON.parse(fs.readFileSync(WELCOME_LOG_FILE, "utf8")); }
function saveWelcomeLog(userId, messageId, data = {}) { const logs = getWelcomeLogs(); logs[userId] = { messageId, ...data }; fs.writeFileSync(WELCOME_LOG_FILE, JSON.stringify(logs, null, 2), "utf8"); }
function getPunishments() { if (!fs.existsSync(PUNISH_FILE)) fs.writeFileSync(PUNISH_FILE, JSON.stringify({}), "utf8"); return JSON.parse(fs.readFileSync(PUNISH_FILE, "utf8")); }
function savePunishment(userId, status, durationMs = null) { const punishments = getPunishments(); if (status === null) { delete punishments[userId]; } else { punishments[userId] = { status: status, time: Date.now(), expiresAt: durationMs ? Date.now() + durationMs : null }; } fs.writeFileSync(PUNISH_FILE, JSON.stringify(punishments, null, 2), "utf8"); }
function getOrderLogs() { if (!fs.existsSync(ORDER_LOG_FILE)) fs.writeFileSync(ORDER_LOG_FILE, JSON.stringify({}), "utf8"); return JSON.parse(fs.readFileSync(ORDER_LOG_FILE, "utf8")); }
function saveOrderLog(channelId, trackingMessageId, orderDetails) { const logs = getOrderLogs(); logs[channelId] = { trackingMessageId, ...orderDetails }; fs.writeFileSync(ORDER_LOG_FILE, JSON.stringify(logs, null, 2), "utf8"); }

// ================================
// 🎉 Dynamic Welcome Embed Builder
// ================================

function buildDynamicWelcomeEmbed(member, status, isOfflineHook = false, verifyTime = null) {
    let statusText = "❌ Unverified"; let color = "#FFA500"; 
    let thumbnail = member.user ? member.user.displayAvatarURL({ dynamic: true }) : null;
    let tag = member.user ? member.user.tag : member.userId || "Unknown Member";
    let id = member.id || member.userId;
    let joinedTime = member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "Unknown";

    if (status === "verified") { statusText = "✅ Verified"; color = "#00FF00"; }
    else if (status === "left") { statusText = "🚫 Left Server"; color = "#FF0000"; }

    const defaultWelcomeDescription = "✨ স্বাগতম {user} আমাদের সার্ভারে!\n📜 আমাদের নিয়মগুলো মেনে চলার অনুরোধ রইল। ❤️";
    const welcomeTitle = formatBotMessage("welcomeTitle", "🎉 নতুন সদস্য ট্র্যাকিং সিস্টেম", { user: `<@${id}>`, server: member.guild?.name || "our server" }).slice(0, 256);
    const welcomeDescription = formatBotMessage("welcomeDescription", defaultWelcomeDescription, { user: `<@${id}>`, server: member.guild?.name || "our server" }).slice(0, 4000);
    const embed = new EmbedBuilder().setColor(color).setTitle(welcomeTitle).setDescription(welcomeDescription).addFields({ name: "👤 Username", value: `${tag}`.slice(0, 256), inline: true }, { name: "🆔 User ID", value: `${id}`, inline: true }, { name: "⏰ Joined Server", value: joinedTime, inline: true }, { name: "🛡️ Verification Status", value: `**${statusText}**`, inline: true }).setTimestamp();
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (member.guild) embed.addFields({ name: "👥 Total Members", value: `${member.guild.memberCount}`, inline: true });
    if (verifyTime) embed.addFields({ name: "⚡ Verified At", value: `<t:${Math.floor(verifyTime / 1000)}:R>`, inline: true });
    if (isOfflineHook) embed.setFooter({ text: "⚠️ বট অফলাইন থাকার সময় এই অ্যাকশনটি ঘটেছিল।" });
    else embed.setFooter({ text: "Professional Security Management System" });
    return embed;
}

// New member welcome tracking (required for the verification handler to update its welcome embed).
client.on("guildMemberAdd", async (member) => {
    if (!isFeatureEnabled("welcomeSystemEnabled")) return;
    if (member.guild.id !== ALLOWED_GUILD_ID) return;
    try {
        const welcomeChannel = member.guild.channels.cache.get(getConfiguredChannelId("welcome"));
        if (!welcomeChannel) {
            console.error("❌ Welcome channel not found:", getConfiguredChannelId("welcome"));
            return;
        }
        const welcomeMessage = await welcomeChannel.send({ embeds: [buildDynamicWelcomeEmbed(member, "unverified")] });
        saveWelcomeLog(member.id, welcomeMessage.id, { isOffline: false, status: "unverified", joinedAt: Date.now() });
    } catch (error) {
        console.error("❌ Failed to post welcome message:", error.message);
    }
});

client.on("guildMemberRemove", async (member) => {
    if (!isFeatureEnabled("leaveTrackingEnabled")) return;
    if (member.guild.id !== ALLOWED_GUILD_ID) return;
    try {
        const logs = getWelcomeLogs();
        const userLog = logs[member.id];
        if (!userLog?.messageId) return;
        const welcomeChannel = member.guild.channels.cache.get(getConfiguredChannelId("welcome"));
        if (!welcomeChannel) return;
        const welcomeMessage = await welcomeChannel.messages.fetch(userLog.messageId);
        await welcomeMessage.edit({ embeds: [buildDynamicWelcomeEmbed(member, "left", Boolean(userLog.isOffline))] });
        saveWelcomeLog(member.id, userLog.messageId, { ...userLog, status: "left", leftAt: Date.now() });
    } catch (error) {
        console.error("❌ Failed to update leave tracking:", error.message);
    }
});

// ================================
// 🛒 Order Status Embed Builder
// ================================
function buildOrderStatusEmbed(user, category, ticketChannel, status, staff = null, reason = null, txnId = null) {
    let color = "#FFFF00"; let statusString = "⏳ PENDING (অপেক্ষমাণ)";
    
    if (status === "approved") { color = "#00FF00"; statusString = `✅ APPROVED & RUNNING (কাজ চলছে)`; }
    else if (status === "closed") { color = "#FF0000"; statusString = "🔒 CLOSED (টিকিট বন্ধ করা হয়েছে)"; }
    else if (status === "banned") { color = "#2F3136"; statusString = `🚫 FAKE TICKET BAN (${reason || "ফানি টিকিট"})`; }

    const embed = new EmbedBuilder()
        .setTitle("📦 ORDER TRACKING SYSTEM")
        .setColor(color)
        .addFields(
            { name: "👤 কাস্টমার", value: `${user}`, inline: true },
            { name: "🛒 প্রোডাক্ট/ক্যাটাগরি", value: `\`${category.toUpperCase().replace("_", " ")}\``, inline: true },
            { name: "📁 টিকিট চ্যানেল", value: `${ticketChannel}`, inline: true },
            { name: "📊 বর্তমান স্ট্যাটাস", value: `**${statusString}**`, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: "Order Update System" });

    if (txnId) {
        let maskedTxnId = txnId;
        if (txnId.length > 4) {
            maskedTxnId = txnId.substring(0, 2) + "****" + txnId.substring(txnId.length - 2);
        } else {
            maskedTxnId = "****";
        }
        embed.addFields({ name: "💳 Transaction ID", value: `\`${maskedTxnId}\``, inline: true });
    }
    
    if (staff) embed.addFields({ name: "🛟 দায়িত্বপ্রাপ্ত স্টাফ", value: `${staff}`, inline: true });
    return embed;
}

// XP transaction callback must remain side-effect free: Firebase may retry it.
async function awardMessageXp(message) {
    const xpRef = db.ref(`leveling/${message.author.id}`);
    const levelSettings = getLevelingSettings();
    let previousLevel = 1;
    const result = await xpRef.transaction((current) => {
        const old = current && typeof current === "object" ? current : { xp: 0, level: 1 };
        const level = Math.max(1, Number.parseInt(old.level, 10) || 1);
        const gainedXp = crypto.randomInt(levelSettings.xpMin, levelSettings.xpMax + 1);
        let xp = Math.max(0, Number(old.xp) || 0) + gainedXp;
        let nextLevel = level;
        previousLevel = level;
        while (xp >= nextLevel * levelSettings.xpPerLevelBase) {
            xp -= nextLevel * levelSettings.xpPerLevelBase;
            nextLevel += 1;
        }
        return { xp, level: nextLevel };
    }, undefined, false);

    if (!result.committed) return;
    const finalData = result.snapshot.val() || {};
    const finalLevel = Number(finalData.level) || 1;
    if (finalLevel > previousLevel) {
        await message.channel.send(formatBotMessage("levelUp", "🎉 অভিনন্দন <@{user}>! আপনি লেভেল **{level}** এ উন্নীত হয়েছেন।", { user: message.author.id, level: finalLevel }).slice(0, 1900))
            .then(m => setTimeout(() => m.delete().catch(() => {}), 5000))
            .catch(() => {});
        await sendBengaliAnnouncement(message.guild, formatLevelUpAnnouncement(message.author.id, finalLevel), message.author.id);
        const levelRoleId = getConfiguredRoleId("level");
        const levelRole = levelRoleId ? message.guild.roles.cache.get(levelRoleId) : null;
        if (levelRole && !message.member.roles.cache.has(levelRole.id)) {
            suppressNextDiscordRoleAnnouncement(message.author.id, levelRole.id, "add");
            await message.member.roles.add(levelRole).catch(err => console.error("Level reward role assignment failed:", err.message));
        }
    }
}

// Ghost Ping ট্র্যাকিং
client.on("messageDelete", async (message) => {
    if (!isFeatureEnabled("ghostPingEnabled")) return;
    if (!message.guild || message.author?.bot) return;
    if (message.mentions.users.size > 0 || message.mentions.roles.size > 0) {
        const targets = [...message.mentions.users.values()].map(u => u.toString()).join(" ") || [...message.mentions.roles.values()].map(r => r.toString()).join(" ");
        const ghostEmbed = new EmbedBuilder()
            .setColor("Red")
            .setTitle("🛑 Ghost Ping Detected")
            .setDescription(`**কারা করেছে:** ${message.author}\n**চ্যানেল:** ${message.channel}\n**যাকে ট্যাগ করা হয়েছিল:** ${targets}\n**মেসেজ:** ${message.content || "*কোনো লেখা নেই*"}`)
            .setTimestamp();
        message.channel.send({ embeds: [ghostEmbed] }).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
    }
});

// Automod + Activity XP System
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild || message.guild.id !== ALLOWED_GUILD_ID) return;
    if (message.member.permissions.has(PermissionFlagsBits.Administrator) || message.member.roles.cache.has(getConfiguredRoleId("admin"))) return;
    if (!isFeatureEnabled("automodEnabled")) {
        if (isFeatureEnabled("levelingEnabled")) await awardMessageXp(message).catch(err => console.error("Leveling XP failed:", err.message));
        return;
    }
    
    const userId = message.author.id; 
    let triggerAutomod = false; 
    let reason = "";
    const contentLower = message.content.toLowerCase();

    const automodSettings = getAutomodSettings();

    // Caps-lock protection can be independently enabled/disabled.
    const upperCount = message.content.replace(/[^A-Z]/g, "").length;
    const totalLetters = message.content.replace(/[^a-zA-Z]/g, "").length;
    if (isFeatureEnabled("capsProtectionEnabled") && totalLetters >= automodSettings.minCapsLetters && (upperCount / Math.max(1, totalLetters)) > automodSettings.maxUppercaseRatio) {
        try { await message.delete().catch(() => {}); } catch(e){}
        const capsWarn = await message.channel.send(formatBotMessage("capsWarning", "⚠️ <@{user}>, মেসেজে অতিরিক্ত বড় হাতের অক্ষর (Caps Lock) ব্যবহার করবেন না।", { user: userId }).slice(0, 1900));
        setTimeout(() => capsWarn.delete().catch(() => {}), 5000);
        return;
    }

    // Anti-link protection is an independently controlled feature.
    const linkRegex = /(https?:\/\/[^\s]+)/g;
    if (isFeatureEnabled("antiLinkEnabled") && linkRegex.test(message.content)) {
        try { await message.delete().catch(() => {}); } catch(e){}
        const linkWarn = await message.channel.send(formatBotMessage("linkWarning", "⚠️ <@{user}>, সার্ভারে বাইরের লিংক পোস্ট করা নিষিদ্ধ!", { user: userId }).slice(0, 1900));
        setTimeout(() => linkWarn.delete().catch(() => {}), 5000);
        return;
    }

    // Dynamic invite/verification-link response.
    if (isFeatureEnabled("linkResponseEnabled") && VERIFICATION_LINK && (contentLower.includes("link") || contentLower.includes("লিংক") || contentLower.includes("লিঙ্ক"))) {
        return message.reply(`👋 আপনি কি সার্ভার বা ভেরিফিকেশন লিংক খুঁজছেন? এই নিন আমাদের লাইভ লিংক:\n\`${VERIFICATION_LINK}\``);
    }

    const blockedWords = automodSettings.blockedWords;
    if (isFeatureEnabled("badWordsFilterEnabled") && blockedWords.some(word => contentLower.includes(word))) { triggerAutomod = true; reason = "গালিগালাজ / নিষিদ্ধ শব্দ ব্যবহার"; }
    if (!triggerAutomod && isFeatureEnabled("spamProtectionEnabled")) {
        const now = Date.now(); if (!userMsgCounter.has(userId)) userMsgCounter.set(userId, []);
        const timestamps = userMsgCounter.get(userId); timestamps.push(now);
        const expirationTime = now - automodSettings.spamWindowSeconds * 1000; const activeTimestamps = timestamps.filter(time => time > expirationTime);
        userMsgCounter.set(userId, activeTimestamps);
        if (activeTimestamps.length >= automodSettings.spamCount) { triggerAutomod = true; reason = "অতিরিক্ত স্প্যামিং করা"; }
    }
    if (triggerAutomod) {
        try { await message.delete().catch(() => {}); } catch(e){}
        const currentAutomodSettings = getAutomodSettings();
        let warns = (userWarns.get(userId) || 0) + 1; userWarns.set(userId, warns);
        if (warns < currentAutomodSettings.warningLimit) {
            const warnEmbed = new EmbedBuilder().setColor("Yellow").setDescription(formatBotMessage("automodWarning", "⚠️ <@{user}>, সার্ভারে **{reason}** নিষিদ্ধ! আপনি এটি **{warns}/{limit}** বার করেছেন।", { user: userId, reason, warns, limit: currentAutomodSettings.warningLimit }).slice(0, 4000));
            const warnMsg = await message.channel.send({ embeds: [warnEmbed] }); setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
        } else {
            userWarns.set(userId, 0);
            const timeoutMs = currentAutomodSettings.timeoutMinutes * 60 * 1000;
            savePunishment(userId, "Muted", timeoutMs);
            try {
                await message.member.timeout(timeoutMs, "Automod: Limit Exceeded");
                const muteEmbed = new EmbedBuilder().setColor("Red")
                    .setTitle(formatBotMessage("timeoutTitle", "🚫 মেম্বার মিউটেড", { user: userId }).slice(0, 256))
                    .setDescription(formatBotMessage("timeoutDescription", "<@{user}> কে {minutes} মিনিটের জন্য মিউট করা হয়েছে।", { user: userId, minutes: currentAutomodSettings.timeoutMinutes }).slice(0, 4000));
                await message.channel.send({ embeds: [muteEmbed] });
            } catch (err) {
                console.error("❌ Automod timeout failed:", err.message);
            }
        }
        return; // Deleted/flagged messages must not earn XP.
    }

    if (isFeatureEnabled("levelingEnabled")) {
        try {
            await awardMessageXp(message);
        } catch (err) {
            console.error("❌ XP transaction failed:", err.message);
        }
    }
});

// ================================
// ⚡ PART 3 - Interaction Handling
// ================================

const verificationRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("universal_verify_button").setLabel("Verify Me").setStyle(ButtonStyle.Success)
);
function createVerificationEmbed() {
    return new EmbedBuilder()
        .setTitle(formatBotMessage("verifyTitle", "🚨 Verification Required").slice(0, 256))
        .setDescription(formatBotMessage("verifyDescription", "👇 নিচের বাটনে ক্লিক করে ভেরিফাই করুন").slice(0, 4000))
        .setColor("Blue").setImage(COVER_IMAGES.VERIFY).setTimestamp();
}
function getDisabledFeatureMessage(interaction) {
    const id = String(interaction.customId || "");
    if (["select_buy_category"].includes(id) || /^(pay_gateway_|pay_provider_|check_reader_|submit_txn_|modal_txn_|open_cred_modal_|modal_create_account_|apply_coupon_|modal_coupon_)/.test(id)) {
        if (!isCheckoutAllowed()) return formatBotMessage("checkoutUnavailable", "🛠️ Shop checkout বর্তমানে বন্ধ অথবা maintenance mode চালু আছে। পরে আবার চেষ্টা করুন।").slice(0, 1800);
        if (/^(apply_coupon_|modal_coupon_)/.test(id) && ADMIN_BOT_CONFIG.coupons?.enabled === false) return "🎟️ Coupon system বর্তমানে বন্ধ আছে।";
        if (/^(create_ticket_|create_report_|create_customer_|select_product_ticket)/.test(id) && !isFeatureEnabled("ticketPanelEnabled")) return "🎫 Ticket/Support panel বর্তমানে বন্ধ আছে।";
    }
    if (/^(create_ticket_|create_report_|create_customer_|select_product_ticket)/.test(id) && !isFeatureEnabled("ticketPanelEnabled")) return "🎫 Ticket/Support panel বর্তমানে বন্ধ আছে।";
    if (id === "universal_verify_button" && !isFeatureEnabled("verificationEnabled")) return "🛡️ Verification system সাময়িকভাবে বন্ধ আছে।";
    if (id.startsWith("giveaway_join_") && !isFeatureEnabled("giveawayEnabled")) return "🎉 Giveaway বর্তমানে বন্ধ আছে।";
    return null;
}

client.on("interactionCreate", async (interaction) => {
    if (!interaction.guild || interaction.guild.id !== ALLOWED_GUILD_ID) return;

    try {
    const disabledFeatureMessage = getDisabledFeatureMessage(interaction);
    if (disabledFeatureMessage) {
        const payload = { content: disabledFeatureMessage, flags: [MessageFlags.Ephemeral] };
        if (interaction.deferred) await interaction.editReply({ content: disabledFeatureMessage });
        else await interaction.reply(payload);
        return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId === "select_buy_category" && !isCheckoutAllowed()) {
        return interaction.reply({ content: "🛠️ Shop checkout বন্ধ আছে।", flags: [MessageFlags.Ephemeral] });
    }
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
        const cooldownKey = `${interaction.user.id}-${interaction.customId}`;
        const paymentOnlineControl = interaction.customId.startsWith("pay_provider_") || interaction.customId.startsWith("check_reader_");
        if (cooldowns.has(cooldownKey) && !paymentOnlineControl && interaction.customId !== "universal_verify_button" && !interaction.customId.startsWith("giveaway_join_") && !interaction.customId.startsWith("star_rating_")) {
            return interaction.reply({ content: "⚠️ অনুরোধটি ইতোমধ্যে নেওয়া হয়েছে। কয়েক সেকেন্ড অপেক্ষা করুন।", flags: [MessageFlags.Ephemeral] });
        }
        if (!paymentOnlineControl) {
            cooldowns.set(cooldownKey, true);
            setTimeout(() => cooldowns.delete(cooldownKey), 3000);
        }
    }

    if (interaction.isButton() && interaction.customId === "toggle_auto_coupon") {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        try {
            const prefRef = db.ref(`user_settings/${interaction.user.id}/autoCouponEnabled`);
            const result = await prefRef.transaction(current => current === false ? true : false, undefined, false);
            const enabled = result.committed ? result.snapshot.val() === true : await isAutoCouponEnabled(interaction.user.id);
            const settingText = enabled
                ? "🟢 **Auto Coupon: ON** — পরের নতুন checkout-এ আপনার active coupon-এর উপযুক্ত অংশ নিজে থেকে ব্যবহার হবে।"
                : "⚪ **Auto Coupon: OFF** — পরের নতুন checkout-এ স্বয়ংক্রিয়ভাবে coupon ব্যবহার হবে না; চাইলে coupon code হাতে দিতে পারবেন।";
            return interaction.editReply(`${settingText}\nএই পরিবর্তন পরের নতুন checkout থেকে কার্যকর হবে।`);
        } catch (err) {
            console.error("Auto coupon preference toggle failed:", err.message);
            return interaction.editReply("❌ Auto Coupon সেটিং পরিবর্তন করা যায়নি। পরে আবার চেষ্টা করুন.");
        }
    }

    if (interaction.isButton() && interaction.customId === "universal_verify_button") {
        try {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            const role = interaction.guild.roles.cache.get(getConfiguredRoleId("verified"));
            if (!role) return interaction.editReply("❌ Role not found!");
            if (interaction.member.roles.cache.has(getConfiguredRoleId("verified"))) return interaction.editReply("⚠️ আপনি ইতোমধ্যে ভেরিফাই হয়েছেন।");
            suppressNextDiscordRoleAnnouncement(interaction.user.id, role.id, "add");
            await interaction.member.roles.add(role);
            await interaction.editReply(formatBotMessage("verificationSuccess", "✅ সফলভাবে ভেরিফাই সম্পন্ন হয়েছে!", { user: interaction.user.id }).slice(0, 1800));
            await sendBengaliAnnouncement(interaction.guild, formatVerifiedAnnouncement(interaction.user.id), interaction.user.id);
            db.ref(`analytics/joins/${Date.now()}`).set(interaction.user.id);

            const logs = getWelcomeLogs(); const userLog = logs[interaction.user.id]; const welcomeChannel = interaction.guild.channels.cache.get(getConfiguredChannelId("welcome"));
            if (userLog && welcomeChannel) { try { const msg = await welcomeChannel.messages.fetch(userLog.messageId); if (msg) { const updatedEmbed = buildDynamicWelcomeEmbed(interaction.member, "verified", userLog.isOffline, Date.now()); await msg.edit({ embeds: [updatedEmbed] }); } } catch (e) {} }
        } catch (err) { console.error(err); }
        return;
    }

    // 🔑 Button ভিত্তিক OneTime Key Handler
    if (interaction.isButton() && (interaction.customId === "btn_generate_1time_key" || interaction.customId === "generate_1time_key")) {
        return handleOneTimeKeyGeneration(interaction);
    }

    // Giveaway বাটনে ক্লিক ট্র্যাকিং
    if (interaction.isButton() && interaction.customId.startsWith("giveaway_join_")) {
        const gwId = interaction.customId.split("_")[2];
        const participantRef = db.ref(`giveaways/${gwId}/participants/${interaction.user.id}`);
        const snap = await participantRef.once("value");
        if (snap.exists()) {
            return interaction.reply({ content: "❌ আপনি অলরেডি এই গিভঅ্যাওয়েতে জয়েন করেছেন!", flags: [MessageFlags.Ephemeral] });
        }
        await participantRef.set(interaction.user.tag);
        
        const fullSnap = await db.ref(`giveaways/${gwId}`).once("value");
        const gwData = fullSnap.val();
        const count = Object.keys(gwData.participants || {}).length;
        
        const embed = EmbedBuilder.from(interaction.message.embeds[0]);
        embed.setFields({ name: "🎉 এন্ট্রি সংখ্যা", value: `\`${count}\` জন মেম্বার`, inline: true });
        await interaction.message.edit({ embeds: [embed] });

        return interaction.reply({ content: "✅ আপনি সফলভাবে গিভঅ্যাওয়েতে নাম এন্ট্রি করেছেন!", flags: [MessageFlags.Ephemeral] });
    }

    // এডভান্সড টিকেট রেটিং ফিডব্যাক সিস্টেম
    if (interaction.isButton() && interaction.customId.startsWith("star_rating_")) {
        const [, , stars, staffId] = interaction.customId.split("_");
        
        const modal = new ModalBuilder().setCustomId(`modal_feedback_${stars}_${staffId}`).setTitle("📝 Ticket Support Feedback");
        const commentInput = new TextInputBuilder().setCustomId("feedback_comment").setLabel("আপনার মূল্যবান মতামতটি লিখুন (ঐচ্ছিক)").setStyle(TextInputStyle.Paragraph).setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(commentInput));
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_feedback_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const [, , stars, staffId] = interaction.customId.split("_");
        const comment = interaction.fields.getTextInputValue("feedback_comment") || "কোনো কমেন্ট নেই।";
        
        const reviewChannel = interaction.guild.channels.cache.get(getConfiguredChannelId("log"));
        if (reviewChannel) {
            const reviewEmbed = new EmbedBuilder()
                .setTitle("⭐ NEW SUPPORT FEEDBACK")
                .setColor("Gold")
                .addFields(
                    { name: "👤 কাস্টমার", value: `${interaction.user}`, inline: true },
                    { name: "🛟 দায়িত্বপ্রাপ্ত স্টাফ", value: `<@${staffId}>`, inline: true },
                    { name: "📊 রেটিং স্কোর", value: `${"⭐".repeat(parseInt(stars))}`, inline: false },
                    { name: "💬 কাস্টমার কমেন্ট", value: `\`\`\`${comment}\`\`\``, inline: false }
                )
                .setTimestamp();
            await reviewChannel.send({ embeds: [reviewEmbed] });
        }
        return interaction.editReply("❤️ আপনার সুন্দর ফিডব্যাকটি দেওয়ার জন্য অসংখ্য ধন্যবাদ!");
    }

    // 🌟 ড্রপডাউন সিলেকশন হ্যান্ডলার (1TIME KEY + TICKET HANDLING + BUY/PAYMENT PANEL)
    if (interaction.isStringSelectMenu() && (interaction.customId.startsWith("select_product_") || interaction.customId.startsWith("select_report_") || interaction.customId.startsWith("select_customer_") || interaction.customId.startsWith("select_buy_") || interaction.customId.startsWith("select_key_"))) {
        const value = interaction.values[0];
        if (value === "none" || value === "error") return interaction.reply({ content: "❌ অবৈধ অপশন!", flags: [MessageFlags.Ephemeral] });

        if (value === "generate_1time_key") {
            return handleOneTimeKeyGeneration(interaction);
        }

        let type = ""; let embedColor = ""; let buttonId = "";
        const lowerVal = value.toLowerCase();

        if (interaction.customId === "select_product_ticket") { type = "ticket"; embedColor = "#5865F2"; buttonId = `create_ticket_${lowerVal}`; }
        else if (interaction.customId === "select_report_category") { type = "report"; embedColor = "#ED4245"; buttonId = `create_report_${lowerVal}`; }
        else if (interaction.customId === "select_customer_category") { type = "customer"; embedColor = "#57F287"; buttonId = `create_customer_${lowerVal}`; }
        else if (interaction.customId === "select_buy_category") { type = "order"; embedColor = "#9B59B6"; buttonId = `pay_gateway_${lowerVal}`; } 

        if (type === "order") {
            const supportedPackageValues = new Set(["weekly", "weekly_plan", "week", "monthly", "monthly_plan", "month", "2_months", "two_months", "two_months_plan", "two", "2months", "2month"]);
            if (!supportedPackageValues.has(lowerVal)) {
                return interaction.reply({ content: "⚠️ Shop dropdown-এর package value পুরোনো বা ভুল। Bot নতুন version-এ restart করুন; panel automatic canonical package options sync করবে।", flags: [MessageFlags.Ephemeral] });
            }
            const category = getNormalizedCategory(lowerVal);
            const userId = interaction.user.id;
            if (!isPackageEnabled(category)) return interaction.reply({ content: "এই প্যাকেজটি Admin Panel থেকে সাময়িকভাবে বন্ধ করা হয়েছে।", flags: [MessageFlags.Ephemeral] });
            const basePrice = getPackagePrice(category);
            const sessionRef = db.ref(`pending_payments/${userId}_${category}`);
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            const existingSessionSnap = await sessionRef.once("value");
            const existingSession = existingSessionSnap.val();
            if (existingSession?.status === "offline_payment_approved") {
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`open_cred_modal_${category}`).setLabel("🔑 Create Account Credentials").setStyle(ButtonStyle.Success));
                return interaction.editReply({ content: "✅ Admin/Staff আপনার offline payment approve করেছেন। এখন account credentials তৈরি করতে পারবেন।", components: [row] });
            }
            if (existingSession?.status === "offline_payment_requested") {
                return interaction.editReply("🕓 আপনার offline payment request Admin/Staff review-এর অপেক্ষায় আছে। একই request আবার পাঠানোর প্রয়োজন নেই।");
            }
            if (existingSession?.status === "offline_payment_rejected") {
                return interaction.editReply("❌ আপনার offline payment request reject হয়েছে। নতুন payment করতে বা staff-এর সঙ্গে যোগাযোগ করতে পারেন।");
            }
            const newSession = {
                targetPrice: basePrice,
                basePrice,
                appliedCoupon: null,
                appliedDiscount: 0,
                totalPaid: 0,
                usedTxns: [],
                provider: null,
                status: "select_provider",
                createdAt: Date.now(),
                createdByDiscordId: userId
            };
            const sessionResult = await sessionRef.transaction(current => {
                if (current && current.status === "creating") return;
                if (current && current.status !== "completed" && ((Number(current.totalPaid) || 0) > 0 || (Array.isArray(current.usedTxns) && current.usedTxns.length > 0))) return;
                return newSession;
            }, undefined, false);
            if (!sessionResult.committed) {
                return interaction.editReply("⚠️ এই প্যাকেজের একটি পেমেন্ট ইতোমধ্যে প্রক্রিয়াধীন। পুরোনো TxnID/অ্যাকাউন্ট প্রক্রিয়া শেষ না হওয়া পর্যন্ত নতুন checkout শুরু করা যাবে না।");
            }

            let checkoutSession = sessionResult.snapshot.val() || newSession;
            const autoCouponEnabled = await isAutoCouponEnabled(userId).catch(() => true);
            if (autoCouponEnabled) {
                const autoCoupon = await reserveBestAutoCoupon(userId, category, basePrice).catch(err => {
                    console.error("Automatic coupon lookup failed:", err.message);
                    return null;
                });
                if (autoCoupon) {
                    checkoutSession = {
                        ...checkoutSession,
                        targetPrice: Math.max(0, basePrice - autoCoupon.discount),
                        appliedCoupon: autoCoupon.code,
                        appliedDiscount: autoCoupon.discount,
                        autoCouponApplied: true,
                        autoCouponBalanceBefore: autoCoupon.balance,
                        couponAppliedAt: Date.now()
                    };
                    await sessionRef.update(checkoutSession);

                    if (checkoutSession.targetPrice <= 0) {
                        await consumeCouponBalance(autoCoupon.code, userId, category, autoCoupon.discount);
                        checkoutSession = { ...checkoutSession, status: "pending", totalPaid: 0, usedTxns: ["AUTO_COUPON_100_PERCENT_OFF"] };
                        await sessionRef.update(checkoutSession);
                        const freeEmbed = new EmbedBuilder()
                            .setTitle(`🎉 Auto Coupon Applied — ${category.toUpperCase()}`)
                            .setDescription(
                                `🎟️ **কুপন:** \`${autoCoupon.code}\`\n` +
                                `💸 **ব্যবহৃত কুপন ব্যালেন্স:** \`${autoCoupon.discount}\` BDT\n` +
                                `💰 **এখন পরিশোধযোগ্য:** \`0 BDT\`\n\n` +
                                `আপনার কুপন দিয়ে প্যাকেজের পুরো মূল্য কভার হয়েছে। অ্যাকাউন্ট তৈরি করতে নিচের বাটনে চাপ দিন।`
                            ).setColor("Green");
                        const credentialRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`open_cred_modal_${category}`).setLabel("🔑 Create Account Credentials").setStyle(ButtonStyle.Success)
                        );
                        return interaction.editReply({ embeds: [freeEmbed], components: [credentialRow] });
                    }
                }
            }

            const appliedCouponText = checkoutSession.appliedCoupon
                ? `\n🎟️ **Auto Coupon:** \`${checkoutSession.appliedCoupon}\` — \`${checkoutSession.appliedDiscount} BDT\` ছাড়\n💰 **কুপনের পর পরিশোধযোগ্য:** \`${checkoutSession.targetPrice} BDT\``
                : `\n🎟️ **Auto Coupon:** ${autoCouponEnabled ? "ON (যোগ্য কুপন থাকলে নিজে থেকে ব্যবহার হবে)" : "OFF (ম্যানুয়াল কুপন ব্যবহার করা যাবে)"}`;
            const pickerEmbed = new EmbedBuilder()
                .setTitle(`🛍️ ${category.toUpperCase()} — পেমেন্ট মাধ্যম নির্বাচন করুন`)
                .setDescription(
                    `📦 **প্যাকেজ:** \`${category.toUpperCase()}\`\n` +
                    `💰 **প্যাকেজের মূল্য:** \`${basePrice} BDT\`\n` +
                    (checkoutSession.appliedCoupon ? appliedCouponText : `${appliedCouponText}`) + `\n\n` +
                    `bKash অথবা Nagad নির্বাচন করুন। নম্বর দেখানোর আগে bot স্বয়ংক্রিয়ভাবে **ONLINE CHECK** করবে। Reader offline থাকলে কোনো নম্বর দেখানো হবে না।`
                )
                .setColor("Blue");
            const providerRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`pay_provider_bkash_${category}`).setLabel("bKash নির্বাচন করুন").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`pay_provider_nagad_${category}`).setLabel("Nagad নির্বাচন করুন").setStyle(ButtonStyle.Success)
            );
            const components = [providerRow];
            if (!autoCouponEnabled && ADMIN_BOT_CONFIG.coupons?.enabled !== false) {
                components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`apply_coupon_${category}`).setLabel("🎟️ Coupon Code ব্যবহার করুন").setStyle(ButtonStyle.Secondary)
                ));
            }
            return interaction.editReply({ embeds: [pickerEmbed], components });
        } else if (type) {
            const ephemeralEmbed = new EmbedBuilder().setTitle(`📌 Selected Category: ${value.toUpperCase().replace("_", " ")}`).setDescription(`চ্যানেল তৈরি করতে নিচের বাটনে চাপ দিন।`).setColor(embedColor);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(buttonId).setLabel(`Create ${type.toUpperCase()}`).setStyle(ButtonStyle.Success));
            return interaction.reply({ embeds: [ephemeralEmbed], components: [row], flags: [MessageFlags.Ephemeral] });
        }
    }

    // Modal Submit & Payment Handlers
    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_coupon_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        
        const rawCategory = interaction.customId.split("_")[2].toLowerCase();
        const category = getNormalizedCategory(rawCategory);
        const couponEntered = interaction.fields.getTextInputValue("coupon_code_input").trim().toUpperCase();
        const userId = interaction.user.id;
        
        if (!isPackageEnabled(category)) return interaction.editReply("এই প্যাকেজটি বর্তমানে বন্ধ আছে। Shop থেকে অন্য প্যাকেজ নির্বাচন করুন।");
        if (ADMIN_BOT_CONFIG.coupons?.enabled === false) return interaction.editReply("Coupon system বর্তমানে Admin Panel থেকে বন্ধ আছে।");
        let basePrice = getPackagePrice(category);
        let finalPrice = basePrice;
        let discountText = "কোনো ডিসকাউন্ট কুপন ব্যবহার করা হয়নি।";
        let appliedCouponCode = null;
        let appliedDiscountValue = 0;

        if (couponEntered !== "SKIP") {
            const couponRef = db.ref(`coupons/${couponEntered}`);
            const couponSnap = await couponRef.once("value");

            if (couponSnap.exists()) {
                const couponData = couponSnap.val();
                const now = Date.now();

                if (couponData.userId !== userId) {
                    discountText = "❌ **এই কুপনটি আপনার অ্যাকাউন্টের নয়।** নিজের কুপন কোড ব্যবহার করুন।";
                } else if (couponData.status === "used") {
                    discountText = "❌ **কুপন কোডটি ইতোমধ্যে ব্যবহার করা হয়েছে!** মূল মূল্য প্রযোজ্য হবে।";
                } else if (couponData.expiresAt && couponData.expiresAt < now) {
                    await couponRef.update({ status: "expired" });
                    discountText = "❌ **কুপন কোডটির মেয়াদ শেষ হয়ে গেছে!** মূল মূল্য প্রযোজ্য হবে।";
                } else if (couponData.status === "active") {
                    const reservation = await couponRef.transaction((current) => {
                        const reserveNow = Date.now();
                        if (!current || current.status !== "active" || (current.expiresAt && current.expiresAt < reserveNow)) return;
                        const sameCheckout = current.reservedBy === userId && current.reservedCategory === category;
                        const staleReservation = current.reservedBy && (reserveNow - (Number(current.reservedAt) || 0) >= 30 * 60 * 1000);
                        if (current.reservedBy && !sameCheckout && !staleReservation) return;
                        return {
                            ...current,
                            reservedBy: userId,
                            reservedCategory: category,
                            reservedAt: reserveNow
                        };
                    }, undefined, false);

                    if (!reservation.committed) {
                        discountText = "⚠️ **কুপনটি অন্য একটি চেকআউটে সংরক্ষিত আছে বা আর ব্যবহারযোগ্য নয়।** মূল মূল্য প্রযোজ্য হবে।";
                    } else {
                        const reservedCoupon = reservation.snapshot.val();
                        const couponBalance = getCouponBalance(reservedCoupon);
                        const discount = Math.min(basePrice, couponBalance);
                        if (!Number.isFinite(discount) || discount <= 0) {
                            await couponRef.update({ reservedBy: null, reservedCategory: null, reservedAt: null }).catch(() => {});
                            discountText = "⚠️ **কুপনটির ডিসকাউন্ট ভ্যালু ভুল।** মূল মূল্য প্রযোজ্য হবে।";
                        } else {
                            appliedDiscountValue = discount;
                            finalPrice = Math.max(0, basePrice - appliedDiscountValue);
                            appliedCouponCode = couponEntered;
                            discountText = `🎉 **কুপন কোড \`${couponEntered}\` সফলভাবে অ্যাপ্লাই হয়েছে!**\n` +
                                           `💸 **ছাড়ের পরিমাণ:** \`${appliedDiscountValue}\` ৳\n` +
                                           `🏷️ **নতুন পরিশোধযোগ্য মূল্য:** \`${finalPrice}\` ৳`;
                        }
                    }
                }
            } else {
                discountText = "⚠️ **অবৈধ কুপন কোড!** সিস্টেমের ডেটাবেজে এই কুপন পাওয়া যায়নি। মূল মূল্য প্রযোজ্য হবে।";
            }
        }

        if (finalPrice <= 0) {
            await db.ref(`pending_payments/${userId}_${category}`).set({
                targetPrice: 0,
                basePrice: basePrice,
                appliedCoupon: appliedCouponCode,
                appliedDiscount: appliedDiscountValue,
                totalPaid: 0,
                usedTxns: ["COUPON_100_PERCENT_OFF"],
                status: "pending"
            });

            if (appliedCouponCode) {
                await consumeCouponBalance(appliedCouponCode, userId, category, appliedDiscountValue);
            }

            const zeroPriceEmbed = new EmbedBuilder()
                .setTitle(`🎉 100% Discount Applied! (${category.toUpperCase()})`)
                .setDescription(
                    `📦 **প্যাকেজের রেগুলার মূল্য:** \`${basePrice}\` BDT\n` +
                    `🎁 **কুপন ডিসকাউন্ট:** \`${appliedDiscountValue}\` BDT\n` +
                    `💰 **আপনাকে পেমেন্ট করতে হবে:** \`0\` BDT (সম্পূর্ণ ফ্রি!)\n\n` +
                    `✨ আপনার কুপনের মাধ্যমে পুরো পেমেন্ট সম্পূর্ণ হয়েছে।\n\n` +
                    `👉 অ্যাকাউন্ট তৈরির জন্য নিচের **"Create Account Credentials"** বাটনে ক্লিক করুন।`
                )
                .setColor("#00FF00");

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`open_cred_modal_${category}`)
                    .setLabel("🔑 Create Account Credentials")
                    .setStyle(ButtonStyle.Success)
            );

            return interaction.editReply({ embeds: [zeroPriceEmbed], components: [row] });
        }

        await db.ref(`pending_payments/${userId}_${category}`).set({
            targetPrice: finalPrice,
            basePrice,
            appliedCoupon: appliedCouponCode,
            appliedDiscount: appliedDiscountValue,
            totalPaid: 0,
            usedTxns: [],
            provider: null,
            status: "select_provider",
            createdAt: Date.now(),
            createdByDiscordId: userId
        });

        const pickerEmbed = new EmbedBuilder()
            .setTitle(`🛍️ ${category.toUpperCase()} — পেমেন্ট মাধ্যম নির্বাচন করুন`)
            .setDescription(
                `📦 **প্যাকেজের রেগুলার মূল্য:** \`${basePrice}\` BDT\n` +
                `💰 **ছাড়ের পর পরিশোধযোগ্য:** \`${finalPrice}\` BDT\n\n` +
                `📱 bKash অথবা Nagad নির্বাচন করুন। নম্বর দেখানোর আগে bot স্বয়ংক্রিয়ভাবে **ONLINE CHECK** করবে। Reader offline থাকলে নম্বর দেখানো হবে না।\n\n` +
                `🎁 **কুপন স্ট্যাটাস:**\n${discountText}`
            )
            .setColor("Blue");
        const providerRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`pay_provider_bkash_${category}`).setLabel("bKash নির্বাচন করুন").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`pay_provider_nagad_${category}`).setLabel("Nagad নির্বাচন করুন").setStyle(ButtonStyle.Success)
        );
        return interaction.editReply({ embeds: [pickerEmbed], components: [providerRow] });
    }

    if (interaction.isButton() && interaction.customId.startsWith("apply_coupon_")) {
        const category = getNormalizedCategory(interaction.customId.slice("apply_coupon_".length));
        const modal = new ModalBuilder().setCustomId(`modal_coupon_${category}`).setTitle("🎟️ Coupon / Discount Code");
        const couponInput = new TextInputBuilder()
            .setCustomId("coupon_code_input")
            .setLabel("কুপন কোড দিন (না থাকলে SKIP লিখুন)")
            .setStyle(TextInputStyle.Short)
            .setValue("SKIP")
            .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(couponInput));
        return interaction.showModal(modal);
    }

    // Offline payment requires explicit staff/admin approval after they verify the provider transaction manually.
    if (interaction.isButton() && interaction.customId.startsWith("offlinepay_request_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const match = /^offlinepay_request_(.+)_(bkash|nagad)$/.exec(interaction.customId);
        if (!match) return interaction.editReply("❌ Offline payment request invalid.");
        const category = getNormalizedCategory(match[1]);
        const provider = match[2];
        const sessionRef = db.ref(`pending_payments/${interaction.user.id}_${category}`);
        const sessionSnap = await sessionRef.once("value");
        const session = sessionSnap.val();
        if (!session || session.provider !== provider || session.status !== "reader_offline") {
            return interaction.editReply("⚠️ এই checkout এখন offline-payment request-এর জন্য প্রস্তুত নয়। Payment option আবার নির্বাচন করুন।");
        }
        const existingSnap = await db.ref("offline_payment_requests").orderByChild("discordUserId").equalTo(interaction.user.id).once("value");
        const existing = Object.entries(existingSnap.val() || {}).find(([, r]) => r && r.category === category && r.status === "pending");
        if (existing) return interaction.editReply(`🕓 আপনার offline payment request ইতোমধ্যে pending আছে। Request ID: \`${existing[0]}\``);
        const reqRef = db.ref("offline_payment_requests").push();
        const requestData = {
            id: reqRef.key, discordUserId: interaction.user.id, discordUsername: interaction.user.username,
            category, provider, amount: Number(session.targetPrice) || 0, status: "pending",
            createdAt: Date.now(), checkoutKey: `${interaction.user.id}_${category}`, guildId: interaction.guild.id
        };
        await reqRef.set(requestData);
        await sessionRef.update({ status: "offline_payment_requested", offlinePaymentRequestId: reqRef.key, offlinePaymentRequestedAt: Date.now() });
        const staffChannel = interaction.guild.channels.cache.get(STAFF_ADMIN_LOG_ID);
        if (!staffChannel || !staffChannel.isTextBased()) {
            await reqRef.update({ status: "needs_staff_channel", updatedAt: Date.now() });
            return interaction.editReply("⚠️ Offline request সংরক্ষিত হয়েছে, কিন্তু staff review channel পাওয়া যায়নি। Admin-কে STAFF_ADMIN_LOG_ID channel সেট করতে বলুন।");
        }
        const approvalRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`offlinepay_approve_${reqRef.key}`).setLabel("Approve (manual verify) ").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`offlinepay_reject_${reqRef.key}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
        );
        const reviewEmbed = new EmbedBuilder().setTitle("🧾 Offline Payment Approval Required")
            .setDescription(`**User:** <@${interaction.user.id}> (\`${interaction.user.id}\`)
**Package:** ${category}
**Provider:** ${provider.toUpperCase()}
**Amount:** ${requestData.amount} BDT
**Request ID:** \`${reqRef.key}\`

Approve করার আগে official bKash/Nagad transaction history নিজে যাচাই করুন। Reader evidence না থাকলে bot payment verify করেছে বলে গণ্য হবে না।`)
            .setColor("Orange").setTimestamp();
        await staffChannel.send({ embeds: [reviewEmbed], components: [approvalRow] });
        return interaction.editReply("🕓 Offline payment request Admin/Staff-এর কাছে পাঠানো হয়েছে। Official transaction যাচাই করে approve না করা পর্যন্ত account তৈরি করা যাবে না।");
    }

    if (interaction.isButton() && interaction.customId.startsWith("offlinepay_status_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const category = getNormalizedCategory(interaction.customId.slice("offlinepay_status_".length));
        const sessionSnap = await db.ref(`pending_payments/${interaction.user.id}_${category}`).once("value");
        const session = sessionSnap.val();
        if (!session) return interaction.editReply("কোনো checkout session পাওয়া যায়নি। Shop থেকে package নির্বাচন করুন।");
        if (session.status === "offline_payment_approved") {
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`open_cred_modal_${category}`).setLabel("🔑 Create Account Credentials").setStyle(ButtonStyle.Success));
            return interaction.editReply({ content: "✅ Admin/Staff offline payment approve করেছেন। নিচের বাটনে username/password তৈরি করুন।", components: [row] });
        }
        if (session.status === "offline_payment_requested") return interaction.editReply("🕓 Offline payment request এখনও Admin/Staff review-এর অপেক্ষায় আছে।");
        if (session.status === "offline_payment_rejected") return interaction.editReply("❌ Offline payment request reject করা হয়েছে। সঠিক payment proof থাকলে staff-এর সঙ্গে যোগাযোগ করুন।");
        return interaction.editReply("ℹ️ কোনো pending offline payment request নেই। Reader offline হলে payment option থেকে Offline payment request বেছে নিন।");
    }

    if (interaction.isButton() && /^offlinepay_(approve|reject)_/.test(interaction.customId)) {
        const isApprover = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)
            || interaction.member?.roles?.cache?.has(getConfiguredRoleId("admin"))
            || interaction.member?.roles?.cache?.has(getConfiguredRoleId("staff"));
        if (!isApprover) return interaction.reply({ content: "❌ শুধু অনুমোদিত Admin/Staff offline payment request review করতে পারবেন।", flags: [MessageFlags.Ephemeral] });
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const match = /^offlinepay_(approve|reject)_(.+)$/.exec(interaction.customId);
        const action = match[1]; const requestId = match[2];
        const reqRef = db.ref(`offline_payment_requests/${requestId}`);
        const claim = await reqRef.transaction(current => {
            if (!current || current.status !== "pending") return;
            return { ...current, status: action === "approve" ? "approved" : "rejected", reviewedBy: interaction.user.id, reviewedAt: Date.now() };
        }, undefined, false);
        if (!claim.committed) return interaction.editReply("⚠️ এই request আগেই review হয়েছে অথবা আর পাওয়া যাচ্ছে না।");
        const request = claim.snapshot.val();
        const sessionRef = db.ref(`pending_payments/${request.checkoutKey}`);
        if (action === "approve") {
            const approved = await sessionRef.transaction(current => {
                if (!current || current.status !== "offline_payment_requested" || current.offlinePaymentRequestId !== requestId) return;
                const amount = Math.max(0, Number(current.targetPrice) || 0);
                return { ...current, status: "offline_payment_approved", totalPaid: amount,
                    usedTxns: [...(Array.isArray(current.usedTxns) ? current.usedTxns : []), `OFFLINE_ADMIN_APPROVED:${requestId}`],
                    offlineApprovedBy: interaction.user.id, offlineApprovedAt: Date.now(), offlinePaymentRequestId: requestId };
            }, undefined, false);
            if (!approved.committed) {
                await reqRef.update({ status: "approved_but_session_changed", updatedAt: Date.now() });
                return interaction.editReply("⚠️ Request approve হয়েছে, কিন্তু checkout session আর মেলেনি। Account credit করা হয়নি; Admin-কে session যাচাই করতে হবে।");
            }
            await interaction.editReply("✅ Offline payment request approve করা হয়েছে। User এখন Shop-এ একই package পুনরায় select করে অথবা request status button দিয়ে account creation চালু করতে পারবেন।");
        } else {
            await sessionRef.transaction(current => current?.offlinePaymentRequestId === requestId && current.status === "offline_payment_requested"
                ? { ...current, status: "offline_payment_rejected", offlineRejectedBy: interaction.user.id, offlineRejectedAt: Date.now() } : undefined, undefined, false);
            await interaction.editReply("❌ Offline payment request reject করা হয়েছে।");
        }
        await interaction.message.edit({ components: [] }).catch(() => {});
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("pay_provider_")) {
        const match = /^pay_provider_(bkash|nagad)_(.+)$/.exec(interaction.customId);
        if (!match) return interaction.reply({ content: "❌ Payment option invalid.", flags: [MessageFlags.Ephemeral] });
        const provider = match[1];
        const category = getNormalizedCategory(match[2]);
        const lockKey = `${interaction.user.id}:${category}`;

        // Acknowledge first. Duplicate button presses should not edit the message being handled by the owner.
        if (readerCheckLocks.has(lockKey)) {
            await interaction.deferUpdate().catch(() => {});
            return;
        }
        readerCheckLocks.add(lockKey);
        const checkToken = crypto.randomUUID();
        const sessionRef = db.ref(`pending_payments/${interaction.user.id}_${category}`);
        let ownsCheck = false;
        try {
            await interaction.deferUpdate();
            const sessionSnap = await sessionRef.once("value");
            const session = sessionSnap.val();
            if (!session) {
                return interaction.editReply({ content: "⚠️ এই checkout পাওয়া যায়নি। Shop থেকে আবার package নির্বাচন করুন।", embeds: [], components: [] });
            }

            const claimTime = Date.now();
            const selected = await sessionRef.transaction(current =>
                claimReaderCheckState(current, provider, checkToken, claimTime), undefined, false);
            if (!selected.committed) {
                // Another handler owns the current lease, or checkout moved to another state. Do not clobber its UI.
                return;
            }
            ownsCheck = true;
            readerCheckLastAt.set(interaction.user.id, claimTime);
            await interaction.editReply({ content: "🟠 **ONLINE CHECK চলছে...** Reader online না হওয়া পর্যন্ত পেমেন্ট নম্বর দেখানো হবে না।", embeds: [], components: [] });

            const readerState = await getPaymentReaderState();
            const paymentNumber = getPaymentNumber(provider);
            const now = Date.now();
            const patch = readerState.online && paymentNumber
                ? {
                    status: "awaiting_txn",
                    readerCheckedAt: now,
                    readerDeviceUid: readerState.deviceUid,
                    numberShownAt: now,
                    lastReaderCheckAt: now
                }
                : {
                    status: readerState.online ? "number_not_configured" : "reader_offline",
                    lastReaderCheckAt: now
                };

            // Only the interaction holding the token can publish its result. This prevents an expired worker
            // from overwriting a newer check after a process restart or stale lease recovery.
            const finished = await sessionRef.transaction(current =>
                finishReaderCheckState(current, checkToken, patch), undefined, false);
            if (!finished.committed) return;
            ownsCheck = false; // The lease was atomically removed by finishReaderCheckState.
            const updatedSession = finished.snapshot.val() || {};
            const reply = await interaction.editReply({ content: "", ...buildPaymentPage(category, updatedSession, readerState, paymentNumber) });
            if (!readerState.online && TRUSTED_READER_UIDS.size > 0) {
                void autoWatchReaderOnline(interaction, category, sessionRef, provider);
            }
            return reply;
        } catch (err) {
            console.error("Payment provider selection/online check failed:", err);
            let released = false;
            let releaseResultKnown = false;
            if (ownsCheck) {
                try {
                    const result = await sessionRef.transaction(current =>
                        releaseReaderCheckState(current, checkToken), undefined, false);
                    released = result.committed;
                    releaseResultKnown = true;
                } catch (releaseErr) {
                    console.error("Unable to release failed Reader check lease:", releaseErr.message);
                }
            }
            // If this worker no longer owns the lease, never overwrite the newer worker's Discord message.
            if (ownsCheck && releaseResultKnown && !released) return;
            if (released) {
                const retryRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`pay_provider_bkash_${category}`).setLabel("bKash আবার চেষ্টা করুন").setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`pay_provider_nagad_${category}`).setLabel("Nagad আবার চেষ্টা করুন").setStyle(ButtonStyle.Success)
                );
                return interaction.editReply({
                    content: "❌ ONLINE CHECK ব্যর্থ হয়েছে। নিরাপত্তার জন্য payment number দেখানো হয়নি। নিচের বাটন দিয়ে আবার চেষ্টা করুন।",
                    embeds: [], components: [retryRow]
                }).catch(() => {});
            }
            return interaction.editReply({
                content: "❌ ONLINE CHECK ব্যর্থ হয়েছে। Payment number লুকানো আছে। Shop থেকে package নির্বাচন করে আবার চেষ্টা করুন।",
                embeds: [], components: []
            }).catch(() => {});
        } finally {
            readerCheckLocks.delete(lockKey);
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith("check_reader_")) {
        const category = getNormalizedCategory(interaction.customId.slice("check_reader_".length));
        const lockKey = `${interaction.user.id}:${category}`;
        const now = Date.now();
        const lastCheck = readerCheckLastAt.get(interaction.user.id) || 0;
        if (readerCheckLocks.has(lockKey) || (now - lastCheck) < READER_RECHECK_COOLDOWN_MS) {
            // Acknowledge quietly; repeated clicks do not create extra chat messages or backend checks.
            await interaction.deferUpdate().catch(() => {});
            return;
        }
        readerCheckLocks.add(lockKey);
        try {
            await interaction.deferUpdate();
            const sessionRef = db.ref(`pending_payments/${interaction.user.id}_${category}`);
            const snap = await sessionRef.once("value");
            const session = snap.val();
            if (!session || !["reader_offline", "number_not_configured", "awaiting_txn", "pending"].includes(session.status) || !["bkash", "nagad"].includes(String(session.provider || ""))) {
                return interaction.editReply({ content: "❌ সক্রিয় payment session পাওয়া যায়নি। Shop থেকে package নির্বাচন করুন।", embeds: [], components: [] });
            }
            const storedCheckAt = Number(session.lastReaderCheckAt) || 0;
            if (storedCheckAt > 0 && (now - storedCheckAt) < READER_RECHECK_COOLDOWN_MS) {
                // Persisted cooldown also survives a bot restart; do not message-spam the user.
                readerCheckLastAt.set(interaction.user.id, storedCheckAt);
                return;
            }
            readerCheckLastAt.set(interaction.user.id, now);
            await interaction.editReply({ content: "🟠 **ONLINE CHECK চলছে...** একই সময়ে আরেকটি check request প্রয়োজন নেই।", embeds: [], components: [] });
            const readerState = await getPaymentReaderState();
            const paymentNumber = getPaymentNumber(session.provider);
            const updatedSession = { ...session, lastReaderCheckAt: Date.now() };
            if (readerState.online && paymentNumber) {
                updatedSession.status = "awaiting_txn";
                updatedSession.readerCheckedAt = Date.now();
                updatedSession.readerDeviceUid = readerState.deviceUid;
                updatedSession.numberShownAt = updatedSession.numberShownAt || Date.now();
            } else {
                updatedSession.status = readerState.online ? "number_not_configured" : "reader_offline";
            }
            await sessionRef.update(updatedSession);
            return interaction.editReply({ content: "", ...buildPaymentPage(category, updatedSession, readerState, paymentNumber) });
        } catch (err) {
            console.error("Reader recheck failed:", err);
            return interaction.editReply({ content: "❌ ONLINE CHECK আপাতত ব্যর্থ হয়েছে। নম্বর দেখানো হয়নি।", embeds: [], components: [] }).catch(() => {});
        } finally {
            readerCheckLocks.delete(lockKey);
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith("submit_txn_")) {
        const rawCategory = interaction.customId.slice("submit_txn_".length).toLowerCase();
        const category = getNormalizedCategory(rawCategory);
        // Session/provider/numberShownAt is checked after modal submit, avoiding a slow pre-modal DB call.
        const modal = new ModalBuilder()
            .setCustomId(`modal_txn_${category}`)
            .setTitle("🔒 Submit Transaction ID");

        const txnInput = new TextInputBuilder()
            .setCustomId("txn_id_input")
            .setLabel("Transaction ID (TxnID)")
            .setPlaceholder("e.g. A1B2C3D4E5")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(txnInput));
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_txn_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const rawCategory = interaction.customId.split("_")[2].toLowerCase();
        const category = getNormalizedCategory(rawCategory);
        const txnId = interaction.fields.getTextInputValue("txn_id_input").trim().toUpperCase();
        const userId = interaction.user.id;
        if (!/^[A-Z0-9_-]{3,64}$/.test(txnId)) {
            return interaction.editReply("❌ Transaction ID-তে অবৈধ অক্ষর আছে। শুধু ইংরেজি অক্ষর, সংখ্যা, _ বা - ব্যবহার করুন (৩–৬৪ অক্ষর)।");
        }
        const txnLockKey = `${userId}:${category}`;
        if (paymentTxnLastAt.size > 5000) {
            const staleBefore = Date.now() - PAYMENT_TXN_SUBMIT_COOLDOWN_MS;
            for (const [key, timestamp] of paymentTxnLastAt) {
                if (timestamp <= staleBefore) paymentTxnLastAt.delete(key);
            }
        }
        if (paymentTxnLocks.has(txnLockKey)) {
            return interaction.editReply("⏳ আপনার TxnID ইতোমধ্যে যাচাই হচ্ছে। একই সময়ে আবার submit করার প্রয়োজন নেই।");
        }
        const previousTxnSubmitAt = paymentTxnLastAt.get(txnLockKey) || 0;
        const cooldownRemaining = PAYMENT_TXN_SUBMIT_COOLDOWN_MS - (Date.now() - previousTxnSubmitAt);
        if (cooldownRemaining > 0) {
            return interaction.editReply(`🛡️ Spam protection: আবার TxnID submit করার আগে ${Math.ceil(cooldownRemaining / 1000)} সেকেন্ড অপেক্ষা করুন।`);
        }
        paymentTxnLocks.add(txnLockKey);
        paymentTxnLastAt.set(txnLockKey, Date.now());

        const sessionRef = db.ref(`pending_payments/${userId}_${category}`);
        let txnRef = null;
        let claimedTxnAt = null;
        let paymentRecorded = false;

        try {
            const sessionSnap = await sessionRef.once("value");
            if (!sessionSnap.exists()) return interaction.editReply("❌ কোনো payment session পাওয়া যায়নি। Shop থেকে package নির্বাচন করুন।");
            const initialSession = sessionSnap.val() || {};
            if (["creating", "completed"].includes(initialSession.status)) {
                return interaction.editReply("⚠️ এই payment session ইতোমধ্যে ব্যবহার হচ্ছে বা সম্পন্ন হয়েছে।");
            }
            const checkoutSettings = getCheckoutSettings();
            const createdAt = Number(initialSession.createdAt) || 0;
            if (createdAt > 0 && (Number(initialSession.totalPaid) || 0) <= 0 && Date.now() - createdAt > checkoutSettings.sessionExpiryHours * 60 * 60 * 1000) {
                await sessionRef.update({ status: "expired", expiredAt: Date.now(), lastUpdated: Date.now() }).catch(() => {});
                return interaction.editReply(`⌛ এই checkout session-এর মেয়াদ শেষ (${checkoutSettings.sessionExpiryHours} ঘণ্টা)। Shop থেকে নতুন checkout শুরু করুন।`);
            }
            if (!initialSession.provider || !initialSession.numberShownAt || !["bkash", "nagad"].includes(String(initialSession.provider))) {
                return interaction.editReply("🟠 ONLINE CHECK সম্পন্ন নয়। নম্বর দেখানোর আগে Reader status যাচাই করতে হবে।");
            }
            if (TRUSTED_READER_UIDS.size === 0) {
                return interaction.editReply("🔴 Payment Reader trusted device configure করা হয়নি। তাই TxnID স্বয়ংক্রিয়ভাবে verify করা যাচ্ছে না।");
            }

            const readerMatch = await waitForTrustedReaderEvent(txnId);
            if (!readerMatch) {
                return interaction.editReply("⏳ এই TxnID trusted Payment Reader-এ এখনো পাওয়া যায়নি। bKash/Nagad notification আসা ও upload হওয়া পর্যন্ত অপেক্ষা করে একই TxnID আবার submit করুন।");
            }
            const event = readerMatch.event || {};
            const selectedProvider = String(initialSession.provider).toLowerCase();
            const eventProvider = String(event.provider || "").toLowerCase();
            if (eventProvider !== selectedProvider) {
                return interaction.editReply(`❌ Provider mismatch: আপনি ${getProviderLabel(selectedProvider)} নির্বাচন করেছেন, কিন্তু Reader event ${getProviderLabel(eventProvider)} থেকে এসেছে। সঠিক payment মাধ্যম নির্বাচন করুন।`);
            }
            const eventAmount = Number(event.amount);
            if (!Number.isFinite(eventAmount) || eventAmount <= 0) {
                return interaction.editReply("⏳ Reader TxnID পেয়েছে, কিন্তু notification থেকে amount পড়তে পারেনি। স্বয়ংক্রিয়ভাবে credit করা যাবে না।");
            }
            const capturedAt = Number(event.capturedAt);
            const notificationPostedAt = Number(event.notificationPostedAt) || capturedAt;
            if (!Number.isFinite(capturedAt) || !Number.isFinite(notificationPostedAt) ||
                notificationPostedAt < (Number(initialSession.createdAt) || 0)) {
                return interaction.editReply("❌ এই TxnID checkout শুরু হওয়ার আগের notification। পুরোনো transaction দিয়ে নতুন package কেনা যাবে না।");
            }

            txnRef = db.ref(`transactions/${txnId}`);
            let txnSnap = await txnRef.once("value");
            if (!txnSnap.exists()) {
                await txnRef.transaction(current => {
                    if (current !== null) return;
                    return {
                        transactionId: txnId,
                        provider: selectedProvider,
                        amount: eventAmount,
                        currency: "BDT",
                        used: false,
                        verificationStatus: "evidence_matched",
                        verificationSource: "reader_notification_evidence",
                        verifiedByReaderUid: readerMatch.uid,
                        readerEventKey: readerMatch.eventKey,
                        eventCapturedAt: capturedAt,
                        notificationPostedAt,
                        evidenceMatchedAt: Date.now()
                    };
                }, undefined, false);
                txnSnap = await txnRef.once("value");
            }
            const txnData = txnSnap.val() || {};
            const txnStatus = String(txnData.verificationStatus || "").toLowerCase();
            const verificationSource = String(txnData.verificationSource || "").toLowerCase();
            if (txnStatus === "rejected") {
                return interaction.editReply("❌ Admin এই TxnID evidence reject করেছেন। এই TxnID দিয়ে payment credit হবে না। সঠিক TxnID দিন অথবা payment history নিয়ে Support-এর সঙ্গে যোগাযোগ করুন।");
            }
            if (txnStatus !== "verified" ||
                !["official_api", "manual_admin_review"].includes(verificationSource)) {
                const retryRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`submit_txn_${category}`).setLabel("Admin review-এর পর TxnID আবার দিন").setStyle(ButtonStyle.Primary)
                );
                return interaction.editReply({
                    content: "⏳ Reader notification-এর TxnID evidence পাওয়া গেছে, কিন্তু এটি payment proof নয়। Admin-কে provider transaction history দেখে Admin Panel থেকে manually approve করতে হবে; ততক্ষণ payment credit/account creation হবে না। অনুমোদনের পরে একই TxnID আবার submit করুন।",
                    components: [retryRow]
                });
            }
            if (String(txnData.provider || "").toLowerCase() !== selectedProvider) {
                return interaction.editReply("❌ এই TxnID-র provider checkout-এর সঙ্গে মেলেনি। Payment credit করা হয়নি।");
            }
            if (txnData.used === true) return interaction.editReply("🚫 **Duplicate Transaction!** এই Transaction ID আগেই ব্যবহার করা হয়েছে।");
            const listedAmount = Number(txnData.amount);
            if (!Number.isFinite(listedAmount) || listedAmount <= 0 || Math.abs(listedAmount - eventAmount) > 0.009) {
                return interaction.editReply("❌ Transaction amount validation ব্যর্থ হয়েছে। Payment credit করা হয়নি।");
            }
            if (!checkoutSettings.allowPartialPayments) {
                const target = Number(initialSession.targetPrice) || 0;
                const alreadyPaid = Number(initialSession.totalPaid) || 0;
                if (target > 0 && alreadyPaid + eventAmount < target) {
                    return interaction.editReply(`⚠️ Admin partial payment বন্ধ রেখেছেন। এই payment যোগ করলে মোট ${alreadyPaid + eventAmount} BDT হবে, কিন্তু প্রয়োজন ${target} BDT। এই TxnID claim করা হয়নি; সম্পূর্ণ প্রয়োজনীয় পরিমাণের payment করুন বা Admin-এর সঙ্গে যোগাযোগ করুন।`);
                }
            }

            const now = Date.now();
            claimedTxnAt = now;
            // A transaction prevents two users from claiming the same TxnID at once.
            const claimResult = await txnRef.transaction((current) => {
                if (!current || current.used === true) return;
                const amount = Number(current.amount);
                if (!Number.isFinite(amount) || amount <= 0) return;
                return { ...current, used: true, usedBy: userId, usedAt: claimedTxnAt };
            }, undefined, false);
            if (!claimResult.committed) {
                return interaction.editReply("🚫 **Duplicate Transaction!** এই Transaction ID ইতোমধ্যে অন্য একটি রিকোয়েস্ট ব্যবহার করেছে।");
            }

            const newTxnAmount = Number(claimResult.snapshot.val()?.amount);
            if (!Number.isFinite(newTxnAmount) || newTxnAmount <= 0) {
                await txnRef.transaction(current => current?.usedBy === userId && current?.usedAt === claimedTxnAt ? { ...current, used: false, usedBy: null, usedAt: null } : undefined, undefined, false);
                return interaction.editReply("❌ Transaction amount invalid. অ্যাডমিনের সাহায্য নিন।");
            }

            let sessionResult;
            sessionResult = await sessionRef.transaction((current) => {
                if (!current || ["creating", "completed"].includes(current.status)) return;
                const target = Number(current.targetPrice);
                const alreadyPaid = Number(current.totalPaid) || 0;
                if (!Number.isFinite(target) || target < 0 || alreadyPaid >= target) return;
                const used = Array.isArray(current.usedTxns) ? current.usedTxns : [];
                if (used.includes(txnId)) return;
                return {
                    ...current,
                    category,
                    targetPrice: target,
                    totalPaid: alreadyPaid + newTxnAmount,
                    usedTxns: [...used, txnId],
                    status: "pending",
                    lastUpdated: Date.now()
                };
            }, undefined, false);

            if (!sessionResult.committed) {
                // The session changed before the TxnID could be applied; release this claim safely.
                await txnRef.transaction(current => current?.usedBy === userId && current?.usedAt === claimedTxnAt ? { ...current, used: false, usedBy: null, usedAt: null } : undefined, undefined, false);
                return interaction.editReply("⚠️ পেমেন্ট সেশনটি ইতোমধ্যে আপডেট হয়েছে। সেশনটি রিফ্রেশ করে আবার চেষ্টা করুন।");
            }

            const sessionData = sessionResult.snapshot.val() || {};
            const targetPrice = Number(sessionData.targetPrice);
            const currentTotalPaid = Number(sessionData.totalPaid) || 0;
            const usedTxns = Array.isArray(sessionData.usedTxns) ? sessionData.usedTxns : [];
            paymentRecorded = currentTotalPaid >= targetPrice;
            if (currentTotalPaid < targetPrice) {
                const remainingDue = targetPrice - currentTotalPaid;
                const readerState = await getPaymentReaderState();
                const paymentNumber = getPaymentNumber(sessionData.provider);
                const nextPage = buildPaymentPage(category, sessionData, readerState, paymentNumber);
                return interaction.editReply({
                    content: `⏳ আংশিক পেমেন্ট পাওয়া গেছে। প্রয়োজনীয় মূল্য: ${targetPrice} BDT; মোট পাওয়া: ${currentTotalPaid} BDT; বকেয়া: ${remainingDue} BDT.`,
                    ...nextPage
                });
            }

            let extraPayment = currentTotalPaid - targetPrice;
            let createdCouponCode = null;
            let couponRequestId = null;

            if (extraPayment > 0 && ADMIN_BOT_CONFIG.coupons?.enabled !== false) {
                const expiryDays = Math.max(1, Math.min(3650, Number(ADMIN_BOT_CONFIG.coupons?.expiryDays) || 90));
                const overpaymentMode = String(ADMIN_BOT_CONFIG.coupons?.overpaymentMode || "auto").toLowerCase();
                if (overpaymentMode === "manual") {
                    // The payment has been credited only after an explicit verification step; coupon approval is separate.
                    couponRequestId = crypto.createHash("sha256").update([...usedTxns].sort().join("|")).digest("hex").slice(0, 24);
                    const requestRef = db.ref(`couponRequests/${couponRequestId}`);
                    const requestResult = await requestRef.transaction(current => current || {
                        requestId: couponRequestId,
                        userId,
                        username: interaction.user.username,
                        couponValue: extraPayment,
                        remainingValue: extraPayment,
                        extraPaymentAmount: extraPayment,
                        transactionIds: usedTxns.filter(txn => txn !== "AUTO_COUPON_100_PERCENT_OFF" && txn !== "COUPON_100_PERCENT_OFF"),
                        category,
                        createdAt: Date.now(),
                        expiresAt: Date.now() + expiryDays * 24 * 60 * 60 * 1000,
                        status: "pending",
                        requestedBy: "overpayment_reward"
                    }, undefined, false);
                    if (!requestResult.committed) console.warn("Overpayment coupon request was not newly created; preserving existing request.");
                } else if (overpaymentMode === "auto") {
                    const newCouponObj = {
                        userId,
                        username: interaction.user.username,
                        couponValue: extraPayment,
                        remainingValue: extraPayment,
                        extraPaymentAmount: extraPayment,
                        createdAt: Date.now(),
                        expiresAt: Date.now() + expiryDays * 24 * 60 * 60 * 1000,
                        status: "active",
                        source: "verified_overpayment",
                        sourceRequestId: null
                    };
                    // Bounded, atomic allocation prevents an infinite collision loop or accidental overwrite.
                    for (let attempt = 0; attempt < 10 && !createdCouponCode; attempt++) {
                        const candidate = generateUniqueCouponCode();
                        const couponCreate = await db.ref(`coupons/${candidate}`).transaction(
                            current => current === null ? { ...newCouponObj, couponCode: candidate } : undefined,
                            undefined,
                            false
                        );
                        if (couponCreate.committed) createdCouponCode = candidate;
                    }
                    if (!createdCouponCode) console.error("❌ Could not allocate a unique extra-payment coupon.");
                }
            }

            if (sessionData.appliedCoupon) {
                const couponConsumption = await consumeCouponBalance(
                    sessionData.appliedCoupon,
                    userId,
                    category,
                    Number(sessionData.appliedDiscount) || 0
                );
                if (!couponConsumption.committed) {
                    console.warn("Coupon balance could not be consumed after successful payment:", sessionData.appliedCoupon);
                }
            }

            let extraInfoText = "";
            if (extraPayment > 0 && createdCouponCode) {
                extraInfoText = `\n\n🎁 **Extra Payment Reward Coupon Generated!**\n` +
                                `আপনি প্যাকেজের মূল্যের চেয়ে **${extraPayment} ৳** বেশি পরিশোধ করেছেন।\n` +
                                `আপনার জন্য একটি ডিসকাউন্ট কুপন তৈরি করা হয়েছে:\n` +
                                `🎟️ **Coupon Code:** \`${createdCouponCode}\`\n` +
                                `💸 **Discount Balance:** \`${extraPayment}\` ৳\n` +
                                `📌 **Status:** Active`;
            } else if (extraPayment > 0 && couponRequestId) {
                extraInfoText = `\n\n🎁 **Overpayment Coupon Request Submitted**\n` +
                                `অতিরিক্ত **${extraPayment} ৳** কুপন হিসেবে পাওয়ার অনুরোধ Admin-এর অনুমোদনের অপেক্ষায় আছে।\n` +
                                `📌 **Request ID:** \`${couponRequestId}\`\nStatus: Pending Approval`;
            } else if (extraPayment > 0 && ADMIN_BOT_CONFIG.coupons?.enabled === false) {
                extraInfoText = `\n\nAdmin settings অনুযায়ী coupon reward বর্তমানে বন্ধ আছে; অতিরিক্ত ${extraPayment} ৳-এর বিষয়টি support/admin-এর সঙ্গে নিশ্চিত করুন।`;
            }

            const successPayEmbed = new EmbedBuilder()
                .setTitle("✅ Payment Successfully Verified!")
                .setDescription(
                    `আপনার পেমেন্ট সফলভাবে ভেরিফাই করা হয়েছে।\n\n` +
                    `💰 **মোট পরিশোধিত:** \`${currentTotalPaid}\` BDT\n` +
                    `📦 **প্যাকেজ:** \`${category.toUpperCase()}\`${extraInfoText}\n\n` +
                    `👉 অ্যাকাউন্ট তৈরির জন্য নিচের **"Create Account Credentials"** বাটনে ক্লিক করুন।`
                )
                .setColor("Green");

            const createAccRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`open_cred_modal_${category}`)
                    .setLabel("🔑 Create Account Credentials")
                    .setStyle(ButtonStyle.Success)
            );

            return interaction.editReply({ embeds: [successPayEmbed], components: [createAccRow] });

        } catch (err) {
            console.error("❌ Txn Verification Error:", err);
            if (paymentRecorded) {
                const createAccRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`open_cred_modal_${category}`)
                        .setLabel("🔑 Create Account Credentials")
                        .setStyle(ButtonStyle.Success)
                );
                return interaction.editReply({
                    content: "✅ পেমেন্ট রেকর্ড হয়েছে। অতিরিক্ত কুপন/নোটিফিকেশন তৈরি করতে সমস্যা হয়েছে, তবে অ্যাকাউন্ট তৈরি করতে নিচের বাটন ব্যবহার করুন।",
                    components: [createAccRow]
                });
            }
            return interaction.editReply("❌ **পেমেন্ট প্রক্রিয়াকরণে সমস্যা হয়েছে!** অনুগ্রহ করে পরে আবার চেষ্টা করুন।");
        } finally {
            paymentTxnLocks.delete(txnLockKey);
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith("open_cred_modal_")) {
        const rawCategory = interaction.customId.split("_")[3].toLowerCase();
        const category = getNormalizedCategory(rawCategory);

        const modal = new ModalBuilder()
            .setCustomId(`modal_create_account_${category}`)
            .setTitle("👤 Create Your Custom Account");

        const userInput = new TextInputBuilder()
            .setCustomId("custom_username")
            .setLabel("Username (৩–২০ অক্ষর, ইংরেজি/সংখ্যা/_)")
            .setStyle(TextInputStyle.Short)
            .setMinLength(3)
            .setMaxLength(20)
            .setRequired(true);

        const passInput = new TextInputBuilder()
            .setCustomId("custom_password")
            .setLabel("Password (৮–১২৮ অক্ষর)")
            .setStyle(TextInputStyle.Short)
            .setMinLength(8)
            .setMaxLength(128)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(userInput),
            new ActionRowBuilder().addComponents(passInput)
        );

        return interaction.showModal(modal);
    }

    // 🌟 FULL AUTOMATED ACCOUNT CREATION & SYNC FOR C++ APP
    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_create_account_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const rawCategory = interaction.customId.split("_")[3].toLowerCase();
        const category = getNormalizedCategory(rawCategory);

        const customUser = interaction.fields.getTextInputValue("custom_username").trim().toLowerCase();
        const customPass = interaction.fields.getTextInputValue("custom_password");
        const userId = interaction.user.id;
        const userAvatarUrl = interaction.user.displayAvatarURL({ extension: "png", size: 512 });
        const serverName = interaction.guild?.name || "Discord Server";
        const sessionRef = db.ref(`pending_payments/${userId}_${category}`);
        let sessionClaimed = false;
        let accountSaved = false;

        if (!/^[a-z0-9_]{3,20}$/.test(customUser)) {
            return interaction.editReply("❌ Username ৩–২০ অক্ষরের হতে হবে এবং শুধু a-z, 0-9 ও underscore (_) ব্যবহার করা যাবে।");
        }
        if (customPass.length < 8 || customPass.length > 128 || !customPass.trim()) {
            return interaction.editReply("❌ Password ৮–১২৮ অক্ষরের হতে হবে।");
        }

        try {
            const sessionSnap = await sessionRef.once("value");
            const initialSession = sessionSnap.val();
            const manuallyApprovedOffline = initialSession?.status === "offline_payment_approved"
                && !!initialSession.offlineApprovedBy && !!initialSession.offlinePaymentRequestId;
            if (!initialSession || (!manuallyApprovedOffline && Number(initialSession.totalPaid) < Number(initialSession.targetPrice))) {
                return interaction.editReply("❌ **পেমেন্ট অসম্পূর্ণ!** সম্পূর্ণ টাকা পরিশোধ করুন অথবা Admin/Staff-এর offline payment approval-এর অপেক্ষা করুন।");
            }
            if (["creating", "completed"].includes(initialSession.status)) {
                return interaction.editReply("⚠️ এই পেমেন্ট সেশন ইতোমধ্যে ব্যবহার করা হচ্ছে বা অ্যাকাউন্ট তৈরি হয়ে গেছে। একই পেমেন্ট দিয়ে দ্বিতীয় অ্যাকাউন্ট তৈরি করা যাবে না।");
            }

            // Atomically reserve this paid checkout so repeated button/modal submissions cannot create multiple accounts.
            const claimResult = await sessionRef.transaction((current) => {
                if (!current || ["creating", "completed"].includes(current.status)) return;
                const paid = Number(current.totalPaid) || 0;
                const target = Number(current.targetPrice);
                const approvedOffline = current.status === "offline_payment_approved" && !!current.offlineApprovedBy && !!current.offlinePaymentRequestId;
                if (!Number.isFinite(target) || target < 0 || (!approvedOffline && paid < target)) return;
                return { ...current, status: "creating", creationOwner: userId, creationStartedAt: Date.now() };
            }, undefined, false);

            if (!claimResult.committed) {
                return interaction.editReply("⚠️ এই পেমেন্ট সেশনটি ইতোমধ্যে ব্যবহার করা হয়েছে বা আপডেট হয়েছে।");
            }
            sessionClaimed = true;
            const sessionData = claimResult.snapshot.val() || {};

            let days = 7;
            let packageName = "Weekly";
            if (category === "monthly") {
                days = 30;
                packageName = "Monthly";
            } else if (category === "2_months") {
                days = 60;
                packageName = "2 Months";
            }

            const now = Date.now();
            const expiryTimestamp = now + (days * 24 * 60 * 60 * 1000);
            const userRef = db.ref(`users/${customUser}`);
            const passwordHash = await hashCppPassword(customPass);
            const newAccountData = {
                username: customUser,
                passwordHash,
                discordId: userId,
                avatarUrl: userAvatarUrl,
                serverName,
                category,
                package: packageName,
                paidAmount: Number(sessionData.totalPaid) || 0,
                usedTxns: Array.isArray(sessionData.usedTxns) ? sessionData.usedTxns : [],
                createdAt: now,
                expiresAt: expiryTimestamp,
                status: "active"
            };

            // Username creation is atomic; an active username cannot be overwritten by a simultaneous request.
            const userClaim = await userRef.transaction((current) => {
                if (!current) return newAccountData;
                const currentExpiry = Number(current.expiresAt);
                if (Number.isFinite(currentExpiry) && currentExpiry <= Date.now()) return newAccountData;
                return;
            }, undefined, false);

            if (!userClaim.committed) {
                await sessionRef.transaction((current) => current?.status === "creating" && current?.creationOwner === userId
                    ? { ...current, status: "pending", creationOwner: null, creationStartedAt: null }
                    : undefined, undefined, false);
                sessionClaimed = false;
                return interaction.editReply(`❌ **Username Already Exists!** \`${customUser}\` নামটি অন্য কারো ব্যবহৃত।`);
            }

            accountSaved = true;
            await sessionRef.update({
                status: "completed",
                accountUsername: customUser,
                completedAt: Date.now(),
                creationOwner: null,
                creationStartedAt: null
            });

            const randomCode = Math.floor(1000 + Math.random() * 9000);
            let supportRoleId = getConfiguredRoleId("supportCustomer");
            let channelPrefix = `order-${randomCode}`;

            const permissionOverwrites = [
                { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: getConfiguredRoleId("verified"), deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
            ];

            if (interaction.guild.roles.cache.has(supportRoleId)) permissionOverwrites.push({ id: supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
            if (interaction.guild.roles.cache.has(getConfiguredRoleId("admin"))) permissionOverwrites.push({ id: getConfiguredRoleId("admin"), allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

            const privateChannel = await interaction.guild.channels.create({
                name: channelPrefix,
                type: 0,
                permissionOverwrites
            });

            const orderEmbed = new EmbedBuilder()
                .setTitle(`🛍️ NEW MEMBERSHIP ORDER CONFIRMED`)
                .setColor("#00FF00")
                .setThumbnail(userAvatarUrl)
                .addFields(
                    { name: "👤 কাস্টমার", value: `${interaction.user}`, inline: true },
                    { name: "📦 প্যাকেজ", value: `\`${packageName.toUpperCase()}\``, inline: true },
                    { name: "👤 Username", value: `\`${customUser}\``, inline: true },
                    { name: "💳 Total Paid", value: `\`${sessionData.totalPaid}\` BDT`, inline: true },
                    { name: "📅 এক্সপায়ার ডেট", value: `<t:${Math.floor(expiryTimestamp / 1000)}:R>`, inline: true }
                )
                .setTimestamp();

            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`claim_order`).setLabel("🛟 Claim").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`close_order`).setLabel("🔒 Close").setStyle(ButtonStyle.Secondary)
            );

            await privateChannel.send({ content: `${interaction.user} <@&${supportRoleId}>`, embeds: [orderEmbed], components: [actionRow] });

            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle("🎉 Your Membership Account is Ready!")
                    .setDescription(
                        `👤 **Username:** \`${customUser}\`\n` +
                        `🔑 **Password:** \`${customPass}\`\n` +
                        `📦 **Package:** \`${packageName}\`\n` +
                        `📅 **মেয়াদ:** <t:${Math.floor(expiryTimestamp / 1000)}:R>`
                    )
                    .setThumbnail(userAvatarUrl)
                    .setColor("Green")
                    .setTimestamp();

                await interaction.user.send({ embeds: [dmEmbed] });
            } catch (dmErr) {}

            const trackingChannel = isFeatureEnabled("orderTrackingEnabled") ? interaction.guild.channels.cache.get(getConfiguredChannelId("orderTracking")) : null;
            if (trackingChannel) {
                const trackingEmbed = buildOrderStatusEmbed(interaction.user, category, privateChannel, "approved", null, null, sessionData.usedTxns ? sessionData.usedTxns.join(", ") : null);
                trackingEmbed.addFields(
                    { name: "👤 Registered Username", value: `\`${customUser}\``, inline: true },
                    { name: "💰 Total Paid Amount", value: `\`${sessionData.totalPaid}\` BDT`, inline: true }
                );

                const trackingMsg = await trackingChannel.send({ embeds: [trackingEmbed] }).catch(() => {});
                if (trackingMsg) {
                    saveOrderLog(privateChannel.id, trackingMsg.id, {
                        userId: interaction.user.id,
                        category: category,
                        status: "approved",
                        txnId: sessionData.usedTxns ? sessionData.usedTxns.join(", ") : "",
                        username: customUser
                    });
                }
            }

            return interaction.editReply({
                content: `✅ **পেমেন্ট সফলভাবে ভেরিফাই হয়েছে!**\n` +
                         `আপনার কাস্টম অ্যাকাউন্ট তৈরি সম্পন্ন হয়েছে: ${privateChannel}`
            });

        } catch (err) {
            console.error("❌ Account Creation Error:", err);
            if (sessionClaimed) {
                try {
                    if (accountSaved) {
                        await sessionRef.update({ status: "completed", accountUsername: customUser, completedAt: Date.now(), creationOwner: null, creationStartedAt: null });
                    } else {
                        await sessionRef.transaction((current) => current?.status === "creating" && current?.creationOwner === userId
                            ? { ...current, status: "pending", creationOwner: null, creationStartedAt: null }
                            : undefined, undefined, false);
                    }
                } catch (reservationErr) {
                    console.error("❌ Could not finalize/release account-creation reservation:", reservationErr.message);
                }
            }
            const message = accountSaved
                ? "⚠️ অ্যাকাউন্টটি Firebase-এ তৈরি হয়েছে, কিন্তু Discord order channel তৈরি/আপডেট করতে সমস্যা হয়েছে। নতুন করে পেমেন্ট বা অ্যাকাউন্ট তৈরি করবেন না; অ্যাডমিনকে জানান।"
                : "❌ **অ্যাকাউন্ট তৈরিতে ত্রুটি ঘটেছে!** সেশন রিলিজ করা হয়েছে; কিছুক্ষণ পর আবার চেষ্টা করুন।";
            return interaction.editReply(message);
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith("create_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const parts = interaction.customId.split("_");
        const type = parts[1]; const category = parts.slice(2).join("_");

        const randomCode = Math.floor(1000 + Math.random() * 9000);
        let supportRoleId = getConfiguredRoleId("supportTicketReport");
        let channelPrefix = `${type}-${randomCode}`;

        if (type === "customer") supportRoleId = getConfiguredRoleId("supportCustomer");

        const permissionOverwrites = [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: getConfiguredRoleId("verified"), deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
        ];

        if (interaction.guild.roles.cache.has(supportRoleId)) permissionOverwrites.push({ id: supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
        if (interaction.guild.roles.cache.has(getConfiguredRoleId("admin"))) permissionOverwrites.push({ id: getConfiguredRoleId("admin"), allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

        const privateChannel = await interaction.guild.channels.create({
            name: channelPrefix,
            type: 0,
            permissionOverwrites
        });

        const panelEmbed = new EmbedBuilder().setTitle(`🛠️ ${type.toUpperCase()} REQUEST - ${category.toUpperCase().replace("_", " ")}`).setDescription(`স্বাগতম ${interaction.user}!\nআমাদের সাপোর্ট স্টাফ খুব শীঘ্রই আপনাকে সহায়তা করবে।`).setColor("Green").setTimestamp();
        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`claim_${type}`).setLabel("🛟 Claim").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`close_${type}`).setLabel("🔒 Close").setStyle(ButtonStyle.Secondary)
        );

        await privateChannel.send({ content: `${interaction.user} <@&${supportRoleId}>`, embeds: [panelEmbed], components: [actionRow] });

        const trackingChannel = isFeatureEnabled("orderTrackingEnabled") ? interaction.guild.channels.cache.get(getConfiguredChannelId("orderTracking")) : null;
        if (trackingChannel) {
            const trackingEmbed = buildOrderStatusEmbed(interaction.user, category, privateChannel, "pending");
            const trackingMsg = await trackingChannel.send({ embeds: [trackingEmbed] }).catch(() => {});
            if (trackingMsg) {
                saveOrderLog(privateChannel.id, trackingMsg.id, {
                    userId: interaction.user.id,
                    category: category,
                    status: "pending"
                });
            }
        }

        return interaction.editReply(`✅ সফলভাবে তৈরি হয়েছে: ${privateChannel}`);
    }

    if (interaction.isButton() && interaction.customId.startsWith("claim_")) {
        const type = interaction.customId.split("_")[1];
        let reqRole = (type === "customer" || type === "order") ? getConfiguredRoleId("supportCustomer") : getConfiguredRoleId("supportTicketReport");
        if (!interaction.member.roles.cache.has(reqRole) && !interaction.member.roles.cache.has(getConfiguredRoleId("admin"))) return interaction.reply({ content: "❌ পারমিশন নেই!", flags: [MessageFlags.Ephemeral] });
        
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true }).catch(() => {});
        await interaction.reply({ content: `🛟 এই চ্যানেলটি এখন থেকে স্টাফ ${interaction.user} হ্যান্ডেল করছেন।` });

        db.ref(`staff_duty/${interaction.user.id}/claims`).transaction(c => (c || 0) + 1);
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("close_")) {
        const orderLogs = getOrderLogs();
        const currentOrder = orderLogs[interaction.channel.id];
        const member = interaction.member;
        const isAdmin = Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator) || member?.roles?.cache?.has(getConfiguredRoleId("admin")));
        const isSupport = Boolean(member?.roles?.cache?.has(getConfiguredRoleId("supportTicketReport")) || member?.roles?.cache?.has(getConfiguredRoleId("supportCustomer")));
        const isTicketOwner = Boolean(
            (currentOrder?.userId && currentOrder.userId === interaction.user.id) ||
            interaction.channel.permissionOverwrites?.cache?.has(interaction.user.id)
        );

        if (!isAdmin && !isSupport && !isTicketOwner) {
            return interaction.reply({ content: "❌ এই টিকিট বন্ধ করার অনুমতি আপনার নেই।", flags: [MessageFlags.Ephemeral] });
        }

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        let transcriptSaved = false;
        try {
            const transcript = await discordTranscripts.createTranscript(interaction.channel, {
                limit: -1,
                returnType: "attachment",
                filename: `${interaction.channel.name}-transcript.html`,
                saveImages: true,
                poweredBy: false
            });
            const transcriptLogChan = isFeatureEnabled("transcriptLogsEnabled") ? interaction.guild.channels.cache.get(getConfiguredChannelId("transcriptLog")) : null;
            if (transcriptLogChan) {
                await transcriptLogChan.send({
                    content: `📜 **Transcript Log:** #${interaction.channel.name} | Closed by ${interaction.user}`,
                    files: [transcript]
                });
                transcriptSaved = true;
            }
        } catch (tErr) {
            console.error("❌ Transcript creation/upload failed:", tErr.message);
        }

        if (currentOrder?.trackingMessageId) {
            try {
                const trackingChannel = isFeatureEnabled("orderTrackingEnabled") ? interaction.guild.channels.cache.get(getConfiguredChannelId("orderTracking")) : null;
                const trackingMessage = trackingChannel ? await trackingChannel.messages.fetch(currentOrder.trackingMessageId) : null;
                if (trackingMessage) {
                    const statusEmbed = buildOrderStatusEmbed(
                        `<@${currentOrder.userId || interaction.user.id}>`,
                        currentOrder.category || "unknown",
                        interaction.channel,
                        "closed",
                        interaction.user,
                        null,
                        currentOrder.txnId || null
                    );
                    await trackingMessage.edit({ embeds: [statusEmbed] });
                }
                saveOrderLog(interaction.channel.id, currentOrder.trackingMessageId, {
                    ...currentOrder,
                    status: "closed",
                    closedBy: interaction.user.id,
                    closedAt: Date.now(),
                    transcriptSaved
                });
            } catch (trackingErr) {
                console.error("❌ Order tracking close update failed:", trackingErr.message);
            }
        }

        await interaction.editReply("🔒 চ্যানেলটি ৫ সেকেন্ডের মধ্যে ডিলিট হবে।");
        setTimeout(async () => {
            await interaction.channel.delete().catch(() => {});
        }, 5000);
    }
    } catch (error) {
        console.error("❌ Interaction handler failed:", error);
        const payload = { content: "❌ অনুরোধটি সম্পন্ন করা যায়নি। আবার চেষ্টা করুন বা অ্যাডমিনকে জানান।", flags: [MessageFlags.Ephemeral] };
        try {
            if (interaction.deferred) await interaction.editReply({ content: payload.content });
            else if (interaction.replied) await interaction.followUp(payload);
            else await interaction.reply(payload);
        } catch (replyError) {
            console.error("❌ Could not send interaction error response:", replyError.message);
        }
    }
});

// ================================
// ⚡ PART 4 - Live UI Panels Templates
// ================================

function getPanelColor(fullData, fallback) {
    const candidate = String(fullData?.color || "").trim();
    return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
}
function getPanelFooter(fullData, fallback) {
    return String(fullData?.footer || fallback || "").trim().slice(0, 2048);
}
function getPanelPlaceholder(fullData, fallback) {
    return String(fullData?.placeholder || fallback || "Select an option...").trim().slice(0, 150) || fallback || "Select an option...";
}

async function getDynamicOrderGuidePanel() {
    const { customDescription, customImage, fullData } = await fetchFirebasePanelData("order_guide");
    const defaultTitle = "📦 HOW TO ORDER & SYSTEM GUIDE";
    const defaultDesc = `🛒 **আমাদের সার্ভার থেকে অর্ডার করার নিয়মাবলী** 🛒`;

    const embed = new EmbedBuilder()
         .setTitle(fullData.title || defaultTitle)
        .setDescription(customDescription || defaultDesc)
        .setColor(getPanelColor(fullData, "#FFAA00"))
        .setTimestamp()
        .setFooter({ text: getPanelFooter(fullData, "Order Guide System"), iconURL: client.user.displayAvatarURL() });

    if (customImage) embed.setImage(customImage);
    return { embeds: [embed] };
}

// 🌟 সাধারণ টিকিট সাপোর্ট প্যানেল
async function getDynamicTicketPanel() {
    const { options, customDescription, customImage, fullData } = await fetchFirebasePanelData("ticket");
    const defaultDesc = `🎟️ **আমাদের অফিসিয়াল সাপোর্ট প্যানেল** 🎟️\n\nযে কোনো সমস্যা বা অনুসন্ধানের জন্য নিচের ড্রপডাউন সিলেক্ট করুন।`;

    const embed = new EmbedBuilder()
         .setTitle(fullData.title || "🎫 OFFICIAL SUPPORT PANEL")
        .setDescription(customDescription || defaultDesc)
        .setImage(customImage || COVER_IMAGES.TICKET)
        .setColor(getPanelColor(fullData, "#5865F2"))
        .setFooter({ text: getPanelFooter(fullData, "Official Support Panel"), iconURL: client.user.displayAvatarURL() });

    let finalOptions = options;
    if (options.length === 0 || (options.length === 1 && options[0].value === "none")) {
        finalOptions = [
            {
                label: "💬 General Support Ticket",
                description: "সাধারণ সহায়তার জন্য টিকেট খুলুন",
                value: "general_support"
            }
        ];
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId("select_product_ticket")
        .setPlaceholder(getPanelPlaceholder(fullData, "👇 ড্রপডাউন মেনু থেকে সহায়তার ক্যাটাগরি সিলেক্ট করুন..."))
        .addOptions(finalOptions);

    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

// 🔑 ১-টাইম কী জেনারেটর প্যানেল
async function getDynamicOneTimeKeyPanel() {
    const { options, customDescription, customImage, fullData } = await fetchFirebasePanelData("onetime_key");
    const defaultDesc = `🔐 **DEVELOPER ONE-TIME KEY GENERATOR** 🔐\n\nC++ অ্যাপে ব্যবহারের জন্য ১-টাইম কী জেনারেট করতে ড্রপডাউন বা বাটনে চাপ দিন।\n*(শুধুমাত্র ডেভেলপারদের জন্য নির্দিষ্ট)*`;

    const embed = new EmbedBuilder()
         .setTitle(fullData.title || "🔑 1TIME KEY GENERATOR PANEL")
        .setDescription(customDescription || defaultDesc)
        .setImage(customImage || COVER_IMAGES.TICKET)
        .setColor(getPanelColor(fullData, "#F1C40F"))
        .setFooter({ text: getPanelFooter(fullData, "Developer Portal System"), iconURL: client.user.displayAvatarURL() });

    let finalOptions = options;
    if (options.length === 0 || (options.length === 1 && options[0].value === "none")) {
        finalOptions = [
            {
                label: "🔑 Generate 1TIME KEY (Dev Only)",
                description: "C++ অ্যাপের জন্য ১-টাইম কী জেনারেট করুন",
                value: "generate_1time_key"
            }
        ];
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId("select_key_category")
        .setPlaceholder(getPanelPlaceholder(fullData, "👇 কী জেনারেট করতে নিচের ড্রপডাউন সিলেক্ট করুন..."))
        .addOptions(finalOptions);

    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("btn_generate_1time_key")
            .setLabel("⚡ Generate OneTime Key")
            .setStyle(ButtonStyle.Success)
    );

    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), buttonRow] };
}

async function getDynamicReportPanel() {
    const { options, customDescription, customImage, fullData } = await fetchFirebasePanelData("report");
    const defaultDesc = `🚨 **মেম্বার বা স্টাফ রিপোর্ট করার স্থান** 🚨`;

    const embed = new EmbedBuilder()
         .setTitle(fullData.title || "🚨 MEMBER & STAFF REPORT CENTER")
        .setDescription(customDescription || defaultDesc)
        .setImage(customImage || COVER_IMAGES.REPORT)
        .setColor(getPanelColor(fullData, "#ED4245"))
        .setFooter({ text: getPanelFooter(fullData, "Report Center"), iconURL: client.user.displayAvatarURL() });

    const menu = new StringSelectMenuBuilder().setCustomId("select_report_category").setPlaceholder(getPanelPlaceholder(fullData, "❓ রিপোর্ট করার কারণ সিলেক্ট করুন...")).addOptions(options);
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

async function getDynamicCustomerPanel() {
    const { options, customDescription, customImage, fullData } = await fetchFirebasePanelData("customer");
    const defaultDesc = `💬 **কাস্টমার সাপোর্ট অ্যান্ড কুয়েরি** 💬`;

    const embed = new EmbedBuilder()
         .setTitle(fullData.title || "💬 VIP CUSTOMER SUPPORT CENTER")
        .setDescription(customDescription || defaultDesc)
        .setImage(customImage || COVER_IMAGES.CUSTOMER)
        .setColor(getPanelColor(fullData, "#57F287"))
        .setFooter({ text: getPanelFooter(fullData, "Customer Support"), iconURL: client.user.displayAvatarURL() });

    const menu = new StringSelectMenuBuilder().setCustomId("select_customer_category").setPlaceholder(getPanelPlaceholder(fullData, "❓ আপনার প্রয়োজনীয় অপশন সিলেক্ট করুন...")).addOptions(options);
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

async function getDynamicPaymentPanel() {
    const { options, customDescription, customImage, fullData } = await fetchFirebasePanelData("payment");
    const defaultDesc = `💳 **Premium Store & Automatic Payment Gateway** 💳`;

    const readerStatusText = "\n\n🟠 **ONLINE CHECK:** Package ও bKash/Nagad নির্বাচন করার পর Reader-এর live status যাচাই হবে। Online check সফল না হলে payment number দেখানো হবে না।\n🎟️ **Auto Coupon:** default ON — overpayment থেকে তৈরি আপনার active coupon পরের checkout-এ নিজে থেকে প্রযোজ্য হবে। নিচের ON/OFF বোতাম দিয়ে বন্ধ করলে পরের checkout-এ coupon code manually দেওয়া যাবে।";
    let panelDescription = customDescription || defaultDesc;
    // Always hide payment numbers on the shop panel; reveal a provider-specific number only after live check.
    for (const number of Object.values(PAYMENT_NUMBERS).filter(Boolean)) {
        panelDescription = panelDescription.split(number).join("[পেমেন্ট ধাপে দেখানো হবে]");
    }
    panelDescription = panelDescription.replace(/(?:\+?880)?0?1[3-9](?:[\s-]?\d){8}|01[3-9]X{8}/gi, "[পেমেন্ট ধাপে দেখানো হবে]");
    const embed = new EmbedBuilder()
         .setTitle(fullData.title || "🛍️ AUTOMATED SHOP & PAYMENT PANELS")
        .setDescription(panelDescription + readerStatusText)
        .setImage(customImage || COVER_IMAGES.PAYMENT)
        .setColor(getPanelColor(fullData, "#3498DB"))
        .setFooter({ text: getPanelFooter(fullData, "Automated Payment Bot"), iconURL: client.user.displayAvatarURL() });

    const menu = new StringSelectMenuBuilder().setCustomId("select_buy_category").setPlaceholder(getPanelPlaceholder(fullData, "🛍️ আপনার কাঙ্ক্ষিত মেম্বারশিপ/সার্ভিস সিলেক্ট করুন...")).addOptions(options);
    const autoCouponToggle = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("toggle_auto_coupon").setLabel("🎟️ Auto Coupon ON/OFF (নিজের সেটিং)").setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), autoCouponToggle] };
}

// Admin Commands
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild || message.guild.id !== ALLOWED_GUILD_ID) return;

    const isServerAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator) || message.member.roles.cache.has(getConfiguredRoleId("admin"));

    // Developer/admin access to the one-time-key panel is checked independently of general admin commands.
    if (message.content === "!onetime key" || message.content === "!onetimekey") {
        if (!isFeatureEnabled("oneTimeKeyEnabled")) return message.reply("🔑 One-Time Key Generator বর্তমানে বন্ধ আছে।");
        const canOpenKeyPanel = isServerAdmin || message.member.roles.cache.has(getConfiguredRoleId("developer"));
        if (canOpenKeyPanel && (getConfiguredChannelIds("oneTimeKey").includes(message.channelId) || isServerAdmin)) {
            return message.channel.send(await getDynamicOneTimeKeyPanel());
        }
        return;
    }

    if (!isServerAdmin) return;

    if (message.content === "!setup") return message.channel.send({ embeds: [createVerificationEmbed()], components: [verificationRow] });
    if (message.content === "!ticket" && message.channelId === getConfiguredChannelId("ticketPanel")) return message.channel.send(await getDynamicTicketPanel());
    if (message.content === "!report" && message.channelId === getConfiguredChannelId("reportPanel")) return message.channel.send(await getDynamicReportPanel());
    if (message.content === "!customer" && message.channelId === getConfiguredChannelId("customerPanel")) return message.channel.send(await getDynamicCustomerPanel());
    if (message.content === "!orderguide" && message.channelId === getConfiguredChannelId("orderGuide")) return message.channel.send(await getDynamicOrderGuidePanel());
    
});

// ================================
// 🔄 REALTIME FIREBASE SYNC LISTENER
// ================================
// ================================
// ⚡ QUEUE SYSTEM FOR SAFE BULK AVATAR & USERNAME UPDATES
// ================================

const updateQueue = new Map(); 
let isProcessingQueue = false;

// 📥 ২০টি ২০টি করে ব্যাচ প্রসেস করার ফাংশন
async function processUpdateQueue() {
    if (isProcessingQueue || updateQueue.size === 0) return;
    isProcessingQueue = true;

    // কিউ থেকে একসাথে প্রথম ২০ জন ইউজারকে বের করা
    const queueEntries = Array.from(updateQueue.entries()).slice(0, 20);

    for (const [userId, data] of queueEntries) {
        try {
            const { newAvatar, newUsername } = data;

            // 1️⃣ users নোড আপডেট (ফায়ারবেস)
            const usersRef = db.ref("users");
            const snapshot = await usersRef.orderByChild("discordId").equalTo(userId).once("value");

            if (snapshot.exists()) {
                const updates = [];
                snapshot.forEach((childSnapshot) => {
                    updates.push(childSnapshot.ref.update({
                        avatarUrl: newAvatar,
                        discordUsername: newUsername,
                        lastUpdated: Date.now()
                    }));
                });
                await Promise.all(updates);
                console.log(`⚡ [Queue Sync] Updated user node for Discord ID: ${userId}`);
            }

            // 2️⃣ keys (1TIME Key) নোড আপডেট (ফায়ারবেস)
            const keysRef = db.ref("keys");
            const keySnap = await keysRef.orderByChild("userId").equalTo(userId).once("value");

            if (keySnap.exists()) {
                const updates = [];
                keySnap.forEach((childSnapshot) => {
                    updates.push(childSnapshot.ref.update({
                        avatarUrl: newAvatar,
                        username: newUsername,
                        lastUpdated: Date.now()
                    }));
                });
                await Promise.all(updates);
                console.log(`⚡ [Queue Sync] Updated keys node for Discord ID: ${userId}`);
            }

        } catch (err) {
            console.error(`❌ Queue Update Error for User ${userId}:`, err);
        } finally {
            // নতুন profile change while processing হলে সেটিকে কিউতে রেখে দিন।
            if (updateQueue.get(userId) === data) updateQueue.delete(userId);
        }
    }

    isProcessingQueue = false;

    // যদি ২০ জনের বেশি ইউজার থাকে, তবে ২ সেকেন্ড বিরতি দিয়ে পরবর্তী ২০ জন প্রসেস করবে
    if (updateQueue.size > 0) {
        setTimeout(processUpdateQueue, 2000); // ২ সেকেন্ড বিরতি
    }
}

// --------------------------------
// ⚡ DISCORD PROFILE CHANGE LISTENERS
// --------------------------------

// ১. মেম্বার সার্ভার প্রোফাইল বা অবতার চেঞ্জ করলে
client.on("guildMemberUpdate", (oldMember, newMember) => {
    if (!isFeatureEnabled("profileSyncEnabled")) return;
    const userId = newMember.id;
    const newAvatar = newMember.user.displayAvatarURL({ extension: "png", dynamic: true, size: 512 });
    const newUsername = newMember.user.username;

    // কিউতে তথ্য যোগ করা
    updateQueue.set(userId, { newAvatar, newUsername });
    processUpdateQueue();
});

// ২. মেম্বার গ্লোবাল ডিসকর্ড অবতার চেঞ্জ করলে
client.on("userUpdate", (oldUser, newUser) => {
    if (!isFeatureEnabled("profileSyncEnabled")) return;
    const userId = newUser.id;
    const newAvatar = newUser.displayAvatarURL({ extension: "png", dynamic: true, size: 512 });
    const newUsername = newUser.username;

    updateQueue.set(userId, { newAvatar, newUsername });
    processUpdateQueue();
});
function findPanelMessage(messages, expectedCustomId) {
    return messages?.find(message =>
        message.author.id === client.user.id &&
        message.components?.some(row => row.components?.some(component => component.customId === expectedCustomId))
    ) || null;
}

const WEEKLY_STATS_PATH = "runtime/botStats/weekly";
async function countWeeklyMessage(message) {
    if (!isFeatureEnabled("weeklyReportEnabled") || !message.guild || message.guild.id !== ALLOWED_GUILD_ID || message.author.bot) return;
    try {
        await db.ref(`${WEEKLY_STATS_PATH}/messageCount`).transaction(current => (Number(current) || 0) + 1, undefined, false);
        await db.ref(`${WEEKLY_STATS_PATH}/updatedAt`).set(Date.now());
    } catch (err) { console.error("Weekly message stats update failed:", err.message); }
}
client.on("messageCreate", message => { countWeeklyMessage(message).catch(err => console.error(err.message)); });

client.on("guildMemberUpdate", async (oldMember, newMember) => {
    try {
        if (!newMember.guild || newMember.guild.id !== ALLOWED_GUILD_ID || newMember.user?.bot) return;
        const before = oldMember.roles.cache, after = newMember.roles.cache, changes = [];
        for (const [roleId, role] of after) {
            if (roleId === newMember.guild.id || before.has(roleId)) continue;
            if (consumeSuppressedDiscordRoleAnnouncement(newMember.id, roleId, "add")) continue;
            changes.push({roleId,roleName:role.name,action:"add"});
        }
        for (const [roleId, role] of before) {
            if (roleId === newMember.guild.id || after.has(roleId)) continue;
            if (consumeSuppressedDiscordRoleAnnouncement(newMember.id, roleId, "remove")) continue;
            changes.push({roleId,roleName:role.name,action:"remove"});
        }
        for (const change of changes.slice(0,10)) {
            const key = discordRoleAnnouncementKey(newMember.id,change.roleId,change.action), now = Date.now();
            if (now - (recentDiscordRoleAnnouncements.get(key)||0) < 8000) continue;
            recentDiscordRoleAnnouncements.set(key,now);
            await sendBengaliAnnouncement(newMember.guild,formatRoleChangeAnnouncement({memberId:newMember.id,displayName:newMember.displayName||newMember.user.username,roleName:change.roleName,action:change.action}),newMember.id);
        }
        if (suppressedDiscordRoleAnnouncements.size > 1000 || recentDiscordRoleAnnouncements.size > 2000) {
            for (const [key, expiry] of suppressedDiscordRoleAnnouncements) if (expiry < Date.now()) suppressedDiscordRoleAnnouncements.delete(key);
            const cutoff=Date.now()-60000;
            for (const [key, seenAt] of recentDiscordRoleAnnouncements) if (seenAt < cutoff) recentDiscordRoleAnnouncements.delete(key);
        }
    } catch (err) { console.error("Automatic Bengali role announcement failed:",err.message); }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
    if (!isFeatureEnabled("voiceStatsEnabled")) return;
    if (!newState.guild || newState.guild.id !== ALLOWED_GUILD_ID || newState.member?.user?.bot) return;
    const userId = newState.id || oldState.id;
    if (!userId) return;
    const ref = db.ref(`runtime/botStats/voice/${userId}`);
    const now = Date.now();
    const nextChannelId = newState.channelId || null;
    try {
        let elapsedToAdd = 0;
        const result = await ref.transaction(current => {
            const value = current && typeof current === "object" ? current : { totalMs: 0, channelId: null, joinedAt: null };
            let totalMs = Math.max(0, Number(value.totalMs) || 0);
            let channelId = value.channelId || null;
            let joinedAt = Number(value.joinedAt) || null;
            elapsedToAdd = 0;
            if (channelId && joinedAt && (!nextChannelId || nextChannelId !== channelId)) {
                elapsedToAdd = Math.max(0, now - joinedAt);
                totalMs += elapsedToAdd;
                channelId = null; joinedAt = null;
            }
            if (nextChannelId && (!channelId || nextChannelId !== channelId)) {
                channelId = nextChannelId; joinedAt = now;
            }
            return { totalMs, channelId, joinedAt, updatedAt: now };
        }, undefined, false);
        if (result.committed && elapsedToAdd > 0) {
            await db.ref(`${WEEKLY_STATS_PATH}/voiceMs`).transaction(currentMs => (Number(currentMs) || 0) + elapsedToAdd, undefined, false);
        }
    } catch (err) { console.error("Voice statistics update failed:", err.message); }
});

async function maybePublishWeeklyReport() {
    if (!isFeatureEnabled("weeklyReportEnabled") || !client.isReady()) return;
    const stateRef = db.ref("runtime/botStats/reportState");
    const stateSnap = await stateRef.once("value");
    const state = stateSnap.val() || {};
    const now = Date.now();
    if (!state.lastSentAt) {
        await stateRef.update({ lastSentAt: now, note: "Weekly report timer initialized" });
        return;
    }
    if (now - Number(state.lastSentAt) < 7 * 24 * 60 * 60 * 1000) return;
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    const reportChannel = guild?.channels.cache.get(getConfiguredChannelId("weeklyReport"));
    if (!reportChannel || !reportChannel.isTextBased()) {
        console.warn("Weekly report skipped: configured report channel is missing or not text-based.");
        return;
    }
    const statsRef = db.ref(WEEKLY_STATS_PATH);
    const statsSnap = await statsRef.once("value");
    const stats = statsSnap.val() || {};
    const messageCount = Math.max(0, Number(stats.messageCount) || 0);
    const voiceMinutes = Math.floor(Math.max(0, Number(stats.voiceMs) || 0) / 60000);
    const reportEmbed = new EmbedBuilder()
        .setTitle("📊 RKBACKLES Weekly Activity Report")
        .setColor("Blue")
        .addFields(
            { name: "Guild", value: guild.name.slice(0, 100), inline: true },
            { name: "Messages counted", value: String(messageCount), inline: true },
            { name: "Voice session minutes", value: String(voiceMinutes), inline: true }
        )
        .setFooter({ text: "Voice minutes are accumulated when members leave/change voice channels; sessions crossing a report boundary may be counted at end." })
        .setTimestamp(new Date(now));
    await reportChannel.send({ embeds: [reportEmbed] });
    await statsRef.set({ messageCount: 0, voiceMs: 0, updatedAt: now });
    await stateRef.update({ lastSentAt: now, lastReportMessageId: "sent" });
}

let weeklyReportTimer = null;
let realtimeListenersRegistered = false;
let panelSyncRunning = false;
let panelSyncPending = false;

async function syncManagedPanelType(guild, spec) {
    let desiredChannelIds = spec.channelList ? getConfiguredChannelIds(spec.channelList) : [getConfiguredChannelId(spec.channelKey)].filter(Boolean);
    desiredChannelIds = [...new Set(desiredChannelIds.map(String).filter(id => /^\d{15,25}$/.test(id)))].slice(0, 10);
    if (!desiredChannelIds.length) return;

    const stateRef = db.ref(`runtime/panels/managed/${spec.type}`);
    const stateSnap = await stateRef.once("value").catch(() => null);
    const prevState = stateSnap?.val() || {};
    const oldChannels = prevState.channels && typeof prevState.channels === "object" ? prevState.channels : {};
    const newChannels = {};

    // Remove this Bot's old managed panel when an Admin routes it to a different channel.
    for (const oldChannelId of Object.keys(oldChannels)) {
        if (desiredChannelIds.includes(oldChannelId)) continue;
        const previous = oldChannels[oldChannelId] || {};
        try {
            const oldChannel = guild.channels.cache.get(oldChannelId) || await guild.channels.fetch(oldChannelId).catch(() => null);
            if (oldChannel?.messages && previous.messageId) {
                const oldMessage = await oldChannel.messages.fetch(String(previous.messageId)).catch(() => null);
                if (oldMessage && oldMessage.author?.id === client.user.id) await oldMessage.delete().catch(() => {});
            }
        } catch (err) {
            console.warn(`Could not clean old ${spec.type} panel in ${oldChannelId}:`, err.message);
        }
    }

    for (const channelId of desiredChannelIds) {
        const previous = oldChannels[channelId] || {};
        try {
            const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
            if (!channel || !channel.isTextBased() || !channel.messages) {
                console.warn(`Panel ${spec.type} destination ${channelId} is missing or not text-based.`);
                if (previous.messageId) newChannels[channelId] = previous;
                continue;
            }

            let message = null;
            if (previous.messageId) {
                message = await channel.messages.fetch(String(previous.messageId)).catch(() => null);
                if (message && message.author?.id !== client.user.id) message = null;
            }
            // Preserve messages created by older releases and the original payment panel pointer.
            if (!message && spec.type === "payment") {
                const legacyId = (await db.ref("runtime/panels/paymentMessageId").once("value").catch(() => null))?.val();
                if (legacyId) {
                    const legacyMessage = await channel.messages.fetch(String(legacyId)).catch(() => null);
                    if (legacyMessage?.author?.id === client.user.id) message = legacyMessage;
                }
            }
            if (!message) {
                const history = await channel.messages.fetch({ limit: 100 }).catch(() => null);
                if (spec.customId) message = findPanelMessage(history, spec.customId);
                if (!message && spec.footerText) {
                    message = history?.find(item => item.author?.id === client.user.id && item.embeds?.some(embed => embed.footer?.text === spec.footerText)) || null;
                }
            }

            const payload = await spec.builder();
            if (message) await message.edit(payload);
            else message = await channel.send(payload);
            newChannels[channelId] = { messageId: message.id, channelId, updatedAt: Date.now() };
            console.log(`✅ ${spec.type} Discord panel live-synced in channel ${channelId}.`);
        } catch (err) {
            console.error(`❌ Failed to sync ${spec.type} panel in ${channelId}:`, err.message);
            if (previous.messageId) newChannels[channelId] = previous;
        }
    }

    await stateRef.set({ channelIds: desiredChannelIds, channels: newChannels, updatedAt: Date.now() });
    if (spec.type === "payment") {
        const primary = desiredChannelIds.map(id => newChannels[id]?.messageId).find(Boolean);
        if (primary) await db.ref("runtime/panels/paymentMessageId").set(primary).catch(() => {});
    }
}

async function runManagedPanelSyncOnce() {
    if (!client.isReady()) return;
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (!guild) {
        console.error("❌ Configured Discord guild not found:", ALLOWED_GUILD_ID);
        return;
    }
    const specs = [
        { type: "payment", channelKey: "paymentPanel", customId: "select_buy_category", builder: getDynamicPaymentPanel },
        { type: "ticket", channelKey: "ticketPanel", customId: "select_product_ticket", builder: getDynamicTicketPanel },
        { type: "report", channelKey: "reportPanel", customId: "select_report_category", builder: getDynamicReportPanel },
        { type: "customer", channelKey: "customerPanel", customId: "select_customer_category", builder: getDynamicCustomerPanel },
        { type: "onetime_key", channelList: "oneTimeKey", customId: "select_key_category", builder: getDynamicOneTimeKeyPanel },
        { type: "order_guide", channelKey: "orderGuide", footerText: "Order Guide System", builder: getDynamicOrderGuidePanel }
    ];
    for (const spec of specs) await syncManagedPanelType(guild, spec);
}

async function syncAllManagedPanels() {
    if (!client.isReady()) return;
    if (panelSyncRunning) { panelSyncPending = true; return; }
    panelSyncRunning = true;
    try {
        do {
            panelSyncPending = false;
            await runManagedPanelSyncOnce();
        } while (panelSyncPending && client.isReady());
    } finally {
        panelSyncRunning = false;
    }
}

async function refreshPaymentPanel() {
    // Backward-compatible entry point used by the original checkout code.
    return syncAllManagedPanels();
}

client.on("ready", async () => {
    console.log(`🤖 Logged in as ${client.user.tag}!`);
    setBotPresence();
    registerCouponRequestListener();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    publishBotHeartbeat().catch(err => console.error("Bot heartbeat failed:", err.message));
    heartbeatTimer = setInterval(() => publishBotHeartbeat().catch(err => console.error("Bot heartbeat failed:", err.message)), 30_000);
    if (weeklyReportTimer) clearInterval(weeklyReportTimer);
    maybePublishWeeklyReport().catch(err => console.error("Weekly report check failed:", err.message));
    weeklyReportTimer = setInterval(() => maybePublishWeeklyReport().catch(err => console.error("Weekly report check failed:", err.message)), 60 * 60 * 1000);

    if (realtimeListenersRegistered) return;
    realtimeListenersRegistered = true;
    db.ref("panels").on("value", () => {
        syncAllManagedPanels().catch(err => console.error("Realtime panel sync failed:", err.message));
    }, err => console.error("Firebase panels listener failed:", err.message));
    await syncAllManagedPanels().catch(err => console.error("Initial Discord panel sync failed:", err.message));
});

// Approved manual coupon requests are processed idempotently. A deterministic couponCode is
// allocated by the Admin Panel before approval; a retry cannot create a second coupon.
const couponRequestLocks = new Set();
async function processCouponRequest(requestId, request) {
    if (!requestId || !request || !["approved", "processing"].includes(String(request.status || ""))) return;
    if (couponRequestLocks.has(requestId)) return;
    couponRequestLocks.add(requestId);
    try {
        const requestRef = db.ref(`couponRequests/${requestId}`);
        const currentSnap = await requestRef.once("value");
        const current = currentSnap.val() || {};
        if (!["approved", "processing"].includes(String(current.status || ""))) return;
        const code = String(current.couponCode || "").toUpperCase();
        if (!/^[A-Z0-9_-]{5,32}$/.test(code) || !current.userId || !(Number(current.couponValue) > 0)) {
            await requestRef.update({ status: "error", errorCode: "invalid_request_data", updatedAt: Date.now() });
            return;
        }
        const couponRef = db.ref(`coupons/${code}`);
        const createResult = await couponRef.transaction(existing => {
            if (existing && existing.sourceRequestId === requestId) return existing;
            if (existing !== null) return;
            return {
                couponCode: code,
                userId: String(current.userId),
                username: String(current.username || "unknown").slice(0, 100),
                couponValue: Number(current.couponValue),
                remainingValue: Number(current.couponValue),
                extraPaymentAmount: Number(current.extraPaymentAmount || current.couponValue),
                createdAt: Date.now(),
                expiresAt: Number(current.expiresAt) || (Date.now() + 90 * 86400000),
                status: "active",
                source: "manual_overpayment_approval",
                sourceRequestId: requestId,
                approvedBy: String(current.approvedBy || "admin_panel")
            };
        }, undefined, false);
        if (!createResult.committed || createResult.snapshot.val()?.sourceRequestId !== requestId) {
            await requestRef.update({ status: "error", errorCode: "coupon_code_conflict", updatedAt: Date.now() });
            return;
        }
        await requestRef.update({ status: "fulfilled", couponCode: code, fulfilledAt: Date.now(), updatedAt: Date.now(), errorCode: null });
    } catch (err) {
        console.error("Manual coupon request processing failed:", requestId, err.message);
    } finally {
        couponRequestLocks.delete(requestId);
    }
}

let couponRequestListenerRegistered = false;
function registerCouponRequestListener() {
    if (couponRequestListenerRegistered) return;
    couponRequestListenerRegistered = true;
    db.ref("couponRequests").on("child_added", snap => processCouponRequest(snap.key, snap.val()).catch(err => console.error(err.message)));
    db.ref("couponRequests").on("child_changed", snap => processCouponRequest(snap.key, snap.val()).catch(err => console.error(err.message)));
}

let heartbeatTimer = null;
async function publishBotHeartbeat() {
    const host = String(process.env.RENDER_SERVICE_NAME || process.env.RAILWAY_SERVICE_NAME || os.hostname()).slice(0, 120);
    await db.ref("runtime/bot").update({
        online: true,
        lastHeartbeatAt: Date.now(),
        host,
        nodeVersion: process.version,
        botVersion: require("./package.json").version
    });
}

function setBotPresence() {
    if (!client.user) return;
    const cfg = ADMIN_BOT_CONFIG.presence || {};
    const statusCandidate = String(cfg.status || "online").toLowerCase();
    const status = ["online", "idle", "dnd", "invisible"].includes(statusCandidate) ? statusCandidate : "online";
    const typeCandidate = String(cfg.activityType || "Watching");
    const activityType = Object.prototype.hasOwnProperty.call(ActivityType, typeCandidate) ? ActivityType[typeCandidate] : ActivityType.Watching;
    const activityText = String(cfg.activityText || "Security & Verification").trim().slice(0, 128) || "Security & Verification";
    client.user.setPresence({ activities: [{ name: activityText, type: activityType }], status });
}

function startBot() {
    if (!TOKEN) {
        console.error("❌ TOKEN Environment Variable is missing!");
        return;
    }
    client.login(TOKEN).catch(err => {
        console.error("❌ Discord Login Failed:", err);
    });
}

startBot();


for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (weeklyReportTimer) clearInterval(weeklyReportTimer);
        try { await db.ref("runtime/bot").update({ online: false, lastHeartbeatAt: Date.now(), offlineReason: signal }); } catch (_) {}
        try { client.destroy(); } catch (_) {}
        process.exit(0);
    });
}
