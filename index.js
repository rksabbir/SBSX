// ================================
// 🚀 PART 1 - Setup + Express + Firebase + Config
// ================================

const express = require("express");
const fs = require("fs");
const admin = require("firebase-admin"); // Firebase Admin SDK
const crypto = require("crypto");

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
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require("discord.js");

// html-transcripts import
const discordTranscripts = require("discord-html-transcripts");

// Load logic from Render Environment Variable or local json
let serviceAccount;
try {
    if (process.env.FIREBASE_CONFIG) {
        serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
    } else {
        serviceAccount = require("./firebase-service-account.json");
    }
} catch (e) {
    console.error("❌ Firebase Config Load Error:", e);
}

// Firebase Initialization
const firebaseURL = process.env.FIREBASE_DB_URL || "YOUR_FIREBASE_DATABASE_URL";
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: firebaseURL
    });
}
const db = admin.database();

const app = express();
app.get("/", (req, res) => { res.send("Bot is running!"); });
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🌐 Web server running on port ${PORT}`); });

// ================================
// 🛡️ PHASE 1 - CORE SAFE HELPER UTILITIES
// ================================

/**
 * Clean & Sanitize user inputs for Firebase Path keys
 */
function sanitizeFirebaseKey(key) {
    if (!key || typeof key !== "string") return "invalid_key";
    return key.replace(/[.#$\/[\]]/g, "_").trim();
}

/**
 * Password Hashing Helper
 */
function hashPassword(password) {
    return crypto.createHash("sha256").update(String(password)).digest("hex");
}

/**
 * Firebase Atomic Transaction Wrapper
 */
async function runAtomicTransaction(path, updateFunction) {
    const ref = db.ref(path);
    try {
        const result = await ref.transaction(updateFunction);
        return result;
    } catch (err) {
        console.error(`❌ Atomic Transaction Error at path [${path}]:`, err);
        return { committed: false, snapshot: null, error: err };
    }
}

/**
 * Unique Safe Atomic Counter Generator with Retry (e.g., ORD-000001)
 */
async function getNextAtomicCounter(counterName, prefix = "ORD", maxRetries = 3) {
    const safeCounterName = sanitizeFirebaseKey(counterName);
    const counterRef = db.ref(`counters/${safeCounterName}`);
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const result = await counterRef.transaction((currentValue) => {
            return (currentValue || 0) + 1;
        });

        if (result.committed && result.snapshot.exists()) {
            const num = result.snapshot.val();
            const padded = String(num).padStart(6, "0");
            return `${prefix}-${padded}`;
        }
    }
    
    throw new Error(`Failed to generate atomic counter [${counterName}] after ${maxRetries} attempts.`);
}

/**
 * Idempotency Check & Set Protection
 */
async function checkAndSetIdempotency(requestId, ttlSeconds = 10) {
    const safeReqId = sanitizeFirebaseKey(requestId);
    const reqRef = db.ref(`idempotency/${safeReqId}`);
    const now = Date.now();
    const expiry = now + (ttlSeconds * 1000);

    const result = await reqRef.transaction((currentData) => {
        if (currentData && currentData.expiresAt > now) {
            return; // Abort: already processed / processing
        }
        return { status: "PROCESSING", createdAt: now, expiresAt: expiry };
    });

    return result.committed;
}

/**
 * Audit Logger Helper Engine (Sanitizes Sensitive Fields)
 */
async function safeLogAudit(action, actorId, targetId, details = {}) {
    try {
        const logId = db.ref("audit_logs").push().key;
        const cleanDetails = { ...details };
        
        // Ensure sensitive parameters are never printed into Audit Logs
        delete cleanDetails.password;
        delete cleanDetails.customPass;
        delete cleanDetails.token;
        delete cleanDetails.secret;
        if (cleanDetails.key) {
            cleanDetails.key = cleanDetails.key.substring(0, 4) + "****";
        }

        await db.ref(`audit_logs/${logId}`).set({
            action: String(action),
            actorId: String(actorId),
            targetId: String(targetId || "N/A"),
            details: cleanDetails,
            timestamp: Date.now()
        });
    } catch (err) {
        console.error("❌ safeLogAudit Error:", err);
    }
}

// ================================
// 📱 Dynamic Realtime Settings (Firebase Sync)
// ================================

let PAYMENT_NUMBER = "01404548951"; 
let VERIFICATION_LINK = "https://discord.gg/example"; 

db.ref("settings").on("value", (snapshot) => {
    if (snapshot.exists()) {
        const data = snapshot.val();
        if (data.payment_number) {
            PAYMENT_NUMBER = String(data.payment_number);
            console.log("✅ Realtime Payment Number Updated:", PAYMENT_NUMBER);
        }
        if (data.verification_link) {
            VERIFICATION_LINK = String(data.verification_link);
            console.log("✅ Realtime Verification Link Updated:", VERIFICATION_LINK);
        }
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

const ORDER_TRACKING_CHANNEL_ID = "1488340262827855983"; 
const ORDER_GUIDE_CHANNEL_ID = "1488339045602951199";

const ONETIME_KEY_CHANNEL_IDS = ["1488340757160005683"];

const ROLES = {
    ADMIN: "1488332568372973568", 
    SUPPORT_TICKET_REPORT: "1488333580705861765", 
    SUPPORT_CUSTOMER: "1488335064873046086",
    DEVELOPER: "1523955414612578354"
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

const BAD_WORDS = ["gali1", "gali2", "gali3", "khanki", "magi", "baimon"]; 

const PACKAGE_PRICES = {
    weekly: 510,
    weekly_plan: 510,
    monthly: 1510,
    monthly_plan: 1510,
    "2_months": 2410,
    two_months_plan: 2410,
    two: 2410,
    "2months": 2410,
    "2month": 2410,
    two_months: 2410
};

function getNormalizedCategory(cat) {
    if (!cat) return "weekly";
    const c = String(cat).toLowerCase().trim();
    const map = {
        "weekly": "weekly",
        "weekly_plan": "weekly",
        "monthly": "monthly",
        "monthly_plan": "monthly",
        "2_months": "2_months",
        "two_months_plan": "2_months",
        "two": "2_months",
        "2months": "2_months",
        "2month": "2_months",
        "two_months": "2_months"
    };
    return map[c] || "weekly";
}

const STATS_VC_CHANNEL_ID = "1524321192079786005";
const LEVEL_ROLE_ID = "1524322087295127552";
const GIVEAWAY_CHANNEL_ID = "1488341249739198585";
const EMBED_NOTICE_CHANNEL_ID = "1488338739850772641";
const SOCIAL_FEED_CHANNEL_ID = "1488338739850772641";
const STAFF_ADMIN_LOG_ID = "1524324771502882877";
const WEEKLY_REPORT_CHANNEL_ID = "1524326280923709550";
const TRANSCRIPT_LOG_CHANNEL_ID = "1524326928268660807";

const DATA_FILE = "./database.json";
const WELCOME_LOG_FILE = "./welcome_messages.json";
const PUNISH_FILE = "./punishments.json"; 
const ORDER_LOG_FILE = "./order_tracking.json"; 

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
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.Reaction]
});

process.on("unhandledRejection", (err) => { console.error("[Unhandled Rejection]", err); });
process.on("uncaughtException", (err) => { console.error("[Uncaught Exception]", err); });

function generateUniqueCouponCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "AK-";
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(bytes[i] % chars.length);
    }
    return code;
}

function setBotPresence() {
    if (client.user) {
        client.user.setActivity("Security & Orders", { type: ActivityType.Watching });
    }
}

// Startup Recovery Mechanism
async function runStartupStateRecovery() {
    console.log("🔄 Starting System Recovery Check...");
    try {
        const now = Date.now();
        const RESERVATION_TTL_MS = 15 * 60 * 1000;

        // 1. Recover Stale Reserved Coupons (Safely Preserve USED Coupons)
        const couponsSnap = await db.ref("coupons").once("value");
        if (couponsSnap.exists()) {
            const coupons = couponsSnap.val();
            for (const key in coupons) {
                const c = coupons[key];
                if (c.status === "RESERVED" && c.reservedAt && (now - c.reservedAt > RESERVATION_TTL_MS)) {
                    await db.ref(`coupons/${key}`).transaction((curr) => {
                        if (!curr || curr.status === "used" || curr.status === "USED") return curr;
                        return {
                            ...curr,
                            status: "active",
                            reservedBy: null,
                            reservedAt: null,
                            reservationExpiresAt: null,
                            reservedOrderId: null,
                            reservedSessionId: null
                        };
                    });
                    console.log(`✅ Recovered Stale Coupon Lease: ${key}`);
                }
            }
        }

        // 2. Recover Abandoned Stale Transaction Locks
        const txnsSnap = await db.ref("transactions").once("value");
        if (txnsSnap.exists()) {
            const txns = txnsSnap.val();
            for (const key in txns) {
                const t = txns[key];
                if (t.status === "CLAIMING" && t.claimedAt && (now - t.claimedAt > 30000)) {
                    await db.ref(`transactions/${key}`).transaction((curr) => {
                        if (!curr || curr.status === "COMMITTED" || curr.used === true) return curr;
                        return {
                            ...curr,
                            status: "AVAILABLE",
                            claimedBy: null,
                            claimedAt: null
                        };
                    });
                    console.log(`✅ Released Stale Transaction Lock: ${key}`);
                }
            }
        }

        // 3. Recover Unfinished Operations Idempotently
        const opsSnap = await db.ref("payment_operations").once("value");
        if (opsSnap.exists()) {
            const ops = opsSnap.val();
            for (const opId in ops) {
                const op = ops[opId];
                
                // State: SESSION_COMMITTED & !txnCommitted
                if (op.state === "SESSION_COMMITTED" && !op.txnCommitted) {
                    if (op.txnId && op.paymentMethod !== "COUPON") {
                        await db.ref(`transactions/${op.txnId}`).update({
                            used: true,
                            status: "COMMITTED",
                            usedBy: op.userId,
                            usedAt: Date.now()
                        });
                        await db.ref(`payment_operations/${opId}`).update({
                            state: "TXN_COMMITTED",
                            txnCommitted: true,
                            updatedAt: Date.now()
                        });
                    } else if (op.paymentMethod === "COUPON") {
                        await db.ref(`payment_operations/${opId}`).update({
                            state: "COUPON_COMMITTED",
                            couponCommitted: true,
                            updatedAt: Date.now()
                        });
                    }
                    console.log(`✅ Recovered Payment Operation (SESSION_COMMITTED): ${opId}`);
                }
                
                // State: TXN_COMMITTED or COUPON_COMMITTED & !finalized
                if ((op.state === "TXN_COMMITTED" || op.state === "COUPON_COMMITTED") && !op.finalized) {
                    await db.ref(`payment_operations/${opId}`).update({
                        state: "FINALIZED",
                        finalized: true,
                        updatedAt: Date.now()
                    });
                    console.log(`✅ Finalized Payment Operation (${op.state}): ${opId}`);
                }

                // Stale STARTED state
                if (op.state === "STARTED" && op.createdAt && (now - op.createdAt > 60000)) {
                    await db.ref(`payment_operations/${opId}`).update({
                        state: "FAILED",
                        reason: "OPERATION_TIMEOUT",
                        updatedAt: Date.now()
                    });
                    console.log(`✅ Cleaned Stale Started Operation: ${opId}`);
                }
            }
        }

        // 4. Clean Stale Username Reservations
        const usersSnap = await db.ref("users").once("value");
        if (usersSnap.exists()) {
            const users = usersSnap.val();
            for (const uKey in users) {
                const u = users[uKey];
                if (u.reserved === true && u.reservedAt && (now - u.reservedAt > 300000) && !u.createdAt) {
                    await db.ref(`users/${uKey}`).remove();
                    console.log(`✅ Released Expired Username Reservation: ${uKey}`);
                }
            }
        }

        // 5. Recover Abandoned Ticket Reservations
        const activeTicketsSnap = await db.ref("tickets_active").once("value");
        if (activeTicketsSnap.exists()) {
            const activeTickets = activeTicketsSnap.val();
            for (const tKey in activeTickets) {
                const act = activeTickets[tKey];
                if (act.status === "RESERVED" && act.createdAt && (now - act.createdAt > 60000)) {
                    await db.ref(`tickets_active/${tKey}`).remove();
                    console.log(`✅ Cleaned Stale Ticket Reservation: ${tKey}`);
                }
            }
        }

    } catch (err) {
        console.error("❌ Startup Recovery Error:", err);
    }
}

client.once("ready", () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);
    setBotPresence();
    runStartupStateRecovery();
});

async function fetchFirebasePanelData(panelType) {
    try {
        const safePanelType = sanitizeFirebaseKey(panelType);
        const snapshot = await db.ref(`panels/${safePanelType}`).once("value");
        const data = snapshot.val() || {};
        
        const customDescription = data.description || null;
        const customImage = data.image || null;

        let options = [];

        if (data.options && typeof data.options === "object") {
            options = Object.keys(data.options).map(key => ({
                label: String(data.options[key].label || data.options[key]),
                value: String(data.options[key].value || key)
            }));
        } else {
            options = Object.keys(data)
                .filter(key => !["description", "image", "title", "options"].includes(key))
                .map(key => ({
                    label: String(data[key]),
                    value: String(key)
                }));
        }

        if (options.length === 0) {
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
    const hasDevRole = interaction.member.roles.cache.has(ROLES.DEVELOPER);
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!hasDevRole && !isAdmin) {
        return interaction.reply({
            content: "❌ **অনুমতি নেই!** শুধুমাত্র **Developer** রোলধারীরা C++ অ্যাপের জন্য 1TIME KEY তৈরি করতে পারবেন।",
            flags: [MessageFlags.Ephemeral]
        });
    }

    const randomBytesStr = crypto.randomBytes(3).toString("hex").toUpperCase();
    const randomKey = `KEY-${randomBytesStr}-${Date.now().toString().slice(-4)}`;
    const userAvatarUrl = interaction.user.displayAvatarURL({ extension: "png", dynamic: true, size: 512 });
    const serverName = interaction.guild ? interaction.guild.name : "Discord Server";
    
    const safeKey = sanitizeFirebaseKey(randomKey);
    const keyRef = db.ref(`keys/${safeKey}`);
    
    await keyRef.set({
        used: false,
        generatedBy: interaction.user.tag,
        username: interaction.user.username,
        userId: interaction.user.id,
        avatarUrl: userAvatarUrl,
        serverName: serverName,
        createdAt: Date.now()
    });

    await safeLogAudit("ONE_TIME_KEY_GENERATE", interaction.user.id, null, { key: randomKey });

    const keyEmbed = new EmbedBuilder()
        .setTitle("🔑 1TIME KEY Generated Successfully!")
        .setDescription(`আপনার ১-টাইম কী সফলভাবে তৈরি হয়েছে। C++ অ্যাপে লগইন করতে নিচের কী-টি ব্যবহার করুন:\n\n**KEY:** \`${randomKey}\``)
        .setThumbnail(userAvatarUrl)
        .setColor("#57F287")
        .setFooter({ text: "নোট: এই কী-টি C++ অ্যাপে কেবল একবারই ব্যবহার করা যাবে।" });

    return interaction.reply({ 
        embeds: [keyEmbed], 
        flags: [MessageFlags.Ephemeral] 
    });
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

    const embed = new EmbedBuilder().setColor(color).setTitle("🎉 নতুন সদস্য ট্র্যাকিং সিস্টেম").setDescription(`✨ স্বাগতম <@${id}> আমাদের সার্ভারে!\n📜 আমাদের নিয়মগুলো মেনে চলার অনুরোধ রইল। ❤️`).addFields({ name: "👤 Username", value: `${tag}`, inline: true }, { name: "🆔 User ID", value: `${id}`, inline: true }, { name: "⏰ Joined Server", value: joinedTime, inline: true }, { name: "🛡️ Verification Status", value: `**${statusText}**`, inline: true }).setTimestamp();
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (member.guild) embed.addFields({ name: "👥 Total Members", value: `${member.guild.memberCount}`, inline: true });
    if (verifyTime) embed.addFields({ name: "⚡ Verified At", value: `<t:${Math.floor(verifyTime / 1000)}:R>`, inline: true });
    if (isOfflineHook) embed.setFooter({ text: "⚠️ বট অফলাইন থাকার সময় এই অ্যাকশনটি ঘটেছিল।" });
    else embed.setFooter({ text: "Professional Security Management System" });
    return embed;
}

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

// Ghost Ping Tracking
client.on("messageDelete", async (message) => {
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
    if (message.member.permissions.has(PermissionFlagsBits.Administrator) || message.member.roles.cache.has(ROLES.ADMIN)) return;
    
    const userId = message.author.id; 
    let triggerAutomod = false; 
    let reason = "";
    const contentLower = message.content.toLowerCase();

    // 🛑 Caps-Lock Protection
    const upperCount = message.content.replace(/[^A-Z]/g, "").length;
    const totalLetters = message.content.replace(/[^a-zA-Z]/g, "").length;
    if (totalLetters > 5 && (upperCount / totalLetters) > 0.7) {
        try { await message.delete().catch(() => {}); } catch(e){}
        const capsWarn = await message.channel.send(`⚠️ <@${userId}>, মেসেজে অতিরিক্ত বড় হাতের অক্ষর (Caps Lock) ব্যবহার করবেন না।`);
        setTimeout(() => capsWarn.delete().catch(() => {}), 5000);
        return;
    }

    // 🎮 Activity Leveling (Firebase XP System)
    const safeUserId = sanitizeFirebaseKey(userId);
    const xpRef = db.ref(`leveling/${safeUserId}`);
    xpRef.transaction((current) => {
        if (!current) {
            return { xp: 10, level: 1 };
        } else {
            let nextXp = (current.xp || 0) + Math.floor(Math.random() * 5) + 5;
            let nextLevel = current.level || 1;
            let neededXp = nextLevel * 100;
            if (nextXp >= neededXp) {
                nextXp -= neededXp;
                nextLevel += 1;
                
                message.channel.send(`🎉 অভিনন্দন <@${userId}>! আপনি লেভেল **${nextLevel}** এ উন্নীত হয়েছেন।`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
                message.member.roles.add(LEVEL_ROLE_ID).catch(() => {});
            }
            return { xp: nextXp, level: nextLevel };
        }
    });

    // Anti-Link Spam
    const linkRegex = /(https?:\/\/[^\s]+)/g;
    if (linkRegex.test(message.content)) {
        try { await message.delete().catch(() => {}); } catch(e){}
        const linkWarn = await message.channel.send(`⚠️ <@${userId}>, সার্ভারে কোনো প্রকার বাইরের লিংক ছড়ানো সম্পূর্ণ নিষিদ্ধ!`);
        setTimeout(() => linkWarn.delete().catch(() => {}), 5000);
        return;
    }

    // Live link response
    if (contentLower.includes("link") || contentLower.includes("লিংক") || contentLower.includes("লিঙ্ক")) {
        return message.reply(`👋 আপনি কি সার্ভার বা ভেরিফিকেশন লিংক খুঁজছেন? এই নিন আমাদের লাইভ লিংক:\n\`${VERIFICATION_LINK}\``);
    }

    if (BAD_WORDS.some(word => contentLower.includes(word))) { triggerAutomod = true; reason = "গালিগালাজ / নিষিদ্ধ শব্দ ব্যবহার"; }
    if (!triggerAutomod) {
        const now = Date.now(); if (!userMsgCounter.has(userId)) userMsgCounter.set(userId, []);
        const timestamps = userMsgCounter.get(userId); timestamps.push(now);
        const expirationTime = now - 5000; const activeTimestamps = timestamps.filter(time => time > expirationTime);
        userMsgCounter.set(userId, activeTimestamps);
        if (activeTimestamps.length >= 5) { triggerAutomod = true; reason = "অতিরিক্ত স্প্যামিং করা"; }
    }
    if (triggerAutomod) {
        try { await message.delete().catch(() => {}); } catch(e){}
        
        // Persistent Automod Warns via Firebase
        const warnRef = db.ref(`automod/warnings/${safeUserId}`);
        let currentWarns = 0;
        await warnRef.transaction((val) => {
            currentWarns = (val || 0) + 1;
            return currentWarns;
        });

        if (currentWarns < 3) {
            const warnEmbed = new EmbedBuilder().setColor("Yellow").setDescription(`⚠️ <@${userId}>, সার্ভারে **${reason}** নিষিদ্ধ! আপনি এটি **${currentWarns}/৩** বার করেছেন।`);
            const warnMsg = await message.channel.send({ embeds: [warnEmbed] }); setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
        } else {
            await warnRef.set(0); 
            savePunishment(userId, "Muted", 10 * 60 * 1000); 
            try { 
                await message.member.timeout(10 * 60 * 1000, "Automod: Limit Exceeded"); 
                const muteEmbed = new EmbedBuilder().setColor("Red").setTitle("🚫 মেম্বার মিউটেড").setDescription(`<@${userId}> কে ১০ মিনিটের জন্য মিউট করা হয়েছে।`); 
                await message.channel.send({ embeds: [muteEmbed] }); 
            } catch (err) {}
        }
    }
});

// ================================
// ⚡ PART 3 - Interaction Handling
// ================================

const verificationRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("universal_verify_button").setLabel("Verify Me").setStyle(ButtonStyle.Success)
);
function createVerificationEmbed() { return new EmbedBuilder().setTitle("🚨 Verification Required").setDescription("👇 নিচের বাটনে ক্লিক করে ভেরিফাই করুন").setColor("Blue").setImage(COVER_IMAGES.VERIFY).setTimestamp(); }

// Specialized Claim Handler Routine
async function handleClaimAction(interaction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const safeChannelId = sanitizeFirebaseKey(interaction.channel.id);
    const ticketRef = db.ref(`tickets/${safeChannelId}`);

    const ticketSnap = await ticketRef.once("value");
    if (!ticketSnap.exists()) {
        return interaction.editReply("❌ **টিকিট রেজিস্ট্রি ডাটা পাওয়া যায়নি!**");
    }

    const ticket = ticketSnap.val();
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || interaction.member.roles.cache.has(ROLES.ADMIN);
    let isAuthorized = isAdmin;

    if (!isAuthorized) {
        if ((ticket.type === "ticket" || ticket.type === "report") && interaction.member.roles.cache.has(ROLES.SUPPORT_TICKET_REPORT)) {
            isAuthorized = true;
        } else if ((ticket.type === "customer" || ticket.type === "order") && interaction.member.roles.cache.has(ROLES.SUPPORT_CUSTOMER)) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        return interaction.editReply("❌ **আপনার এই টিকিট Claim করার অনুমতি নেই।**");
    }

    // Atomic Status Transition: OPEN -> CLAIMED
    const claimResult = await ticketRef.transaction((currentTicket) => {
        if (!currentTicket) return currentTicket;
        if (currentTicket.status !== "OPEN") {
            return; // Abort if already claimed or closed
        }
        return {
            ...currentTicket,
            status: "CLAIMED",
            claimedBy: interaction.user.id,
            claimedAt: Date.now()
        };
    });

    if (!claimResult.committed) {
        return interaction.editReply("⚠️ **এই টিকিটটি ইতোমধ্যে অন্য একজন স্টাফ Claim করে ফেলেছেন!**");
    }

    let channelPermSuccess = false;
    try {
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            ManageChannels: true
        });
        channelPermSuccess = true;
    } catch (permErr) {
        console.error("❌ Permission Update Error during Claim:", permErr);
        await ticketRef.update({
            recoveryRequired: true,
            recoveryReason: "CLAIM_PERMISSION_FAILED"
        });
    }

    await safeLogAudit("TICKET_CLAIMED", interaction.user.id, ticket.ticketId, {
        channelId: interaction.channel.id,
        type: ticket.type
    });

    // Update Staff Duty Analytics Count
    const safeStaffId = sanitizeFirebaseKey(interaction.user.id);
    await db.ref(`staff_duty/${safeStaffId}/claimedCount`).transaction((cnt) => (cnt || 0) + 1);

    const claimEmbed = new EmbedBuilder()
        .setTitle("🛟 Ticket Claimed")
        .setDescription(`এই টিকিটটি সফলভাবে <@${interaction.user.id}> দ্বারা **Claimed** করা হয়েছে।`)
        .setColor("Green")
        .setTimestamp();

    await interaction.channel.send({ embeds: [claimEmbed] });
    return interaction.editReply("✅ টিকিট সফলভাবে Claim করা হয়েছে!");
}

// Specialized Close Handler Routine
async function handleCloseAction(interaction) {
    await interaction.deferReply();
    const safeChannelId = sanitizeFirebaseKey(interaction.channel.id);
    const ticketRef = db.ref(`tickets/${safeChannelId}`);

    const ticketSnap = await ticketRef.once("value");
    if (!ticketSnap.exists()) {
        return interaction.followUp("❌ **টিকিট রেজিস্ট্রি ডাটা পাওয়া যায়নি!**");
    }

    const ticket = ticketSnap.val();
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || interaction.member.roles.cache.has(ROLES.ADMIN);
    let isAuthorized = isAdmin;

    if (!isAuthorized) {
        if ((ticket.type === "ticket" || ticket.type === "report") && interaction.member.roles.cache.has(ROLES.SUPPORT_TICKET_REPORT)) {
            isAuthorized = true;
        } else if ((ticket.type === "customer" || ticket.type === "order") && interaction.member.roles.cache.has(ROLES.SUPPORT_CUSTOMER)) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        return interaction.followUp("❌ **আপনার এই টিকিট Close করার অনুমতি নেই।**");
    }

    // Atomic State Transition Guard
    const closeLock = await ticketRef.transaction((curr) => {
        if (!curr) return curr;
        if (["CLOSING", "TRANSCRIPT_CREATING", "TRANSCRIPT_SAVED", "CLOSED"].includes(curr.status)) {
            return; // Reject Duplicate Request
        }
        return {
            ...curr,
            status: "CLOSING",
            closingStartedAt: Date.now()
        };
    });

    if (!closeLock.committed) {
        return interaction.followUp("⚠️ **এই টিকিটটি ইতোমধ্যে বন্ধ করার প্রক্রিয়ায় রয়েছে।**");
    }

    await interaction.followUp("⏳ **টিকিট ট্রান্সক্রিপ্ট তৈরি এবং চ্যানেল বন্ধ করার কাজ চলছে...**");

    // Lifecycle Step 1: TRANSCRIPT_CREATING
    await ticketRef.update({ status: "TRANSCRIPT_CREATING" });

    let transcriptChannel = interaction.guild.channels.cache.get(TRANSCRIPT_LOG_CHANNEL_ID);
    let transcriptSaved = false;

    try {
        const attachment = await discordTranscripts.createTemplate(interaction.channel, {
            limit: -1,
            returnNode: false,
            fileName: `transcript-${ticket.ticketId}.html`
        });

        if (transcriptChannel) {
            const transcriptEmbed = new EmbedBuilder()
                .setTitle(`📜 TICKET TRANSCRIPT [${ticket.ticketId}]`)
                .addFields(
                    { name: "👤 টিকিট ইউজার", value: `<@${ticket.userId}>`, inline: true },
                    { name: "🛟 ಕ್ಲೇম করেছেন", value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : "কেউ না", inline: true },
                    { name: "🔒 বন্ধ করেছেন", value: `${interaction.user}`, inline: true },
                    { name: "🏷️ ক্যাটাগরি", value: `\`${ticket.category || ticket.type}\``, inline: true }
                )
                .setColor("Blue")
                .setTimestamp();

            await transcriptChannel.send({ embeds: [transcriptEmbed], files: [attachment] });
            transcriptSaved = true;
        }
    } catch (tErr) {
        console.error("❌ Transcript Generation/Upload Error:", tErr);
    }

    if (!transcriptSaved) {
        await ticketRef.update({
            status: "TRANSCRIPT_FAILED",
            recoveryRequired: true,
            recoveryReason: "TRANSCRIPT_CREATION_FAILED"
        });
        return interaction.followUp("⚠️ **Transcript তৈরি ব্যর্থ হয়েছে। ডাটা সুরক্ষার জন্য টিকিট চ্যানেল রাখা হয়েছে।**");
    }

    // Lifecycle Step 2: TRANSCRIPT_SAVED -> CLOSED -> ACTIVE CLEARANCE -> DELETE
    await ticketRef.update({ status: "TRANSCRIPT_SAVED" });
    await ticketRef.update({ status: "CLOSED", closedAt: Date.now() });

    const safeUserId = sanitizeFirebaseKey(ticket.userId);
    await db.ref(`tickets_active/${safeUserId}_${ticket.type}`).remove();

    await safeLogAudit("TICKET_CLOSED", interaction.user.id, ticket.ticketId, {
        channelId: interaction.channel.id
    });

    setTimeout(async () => {
        try {
            await interaction.channel.delete();
        } catch (e) {
            console.error("❌ Channel Deletion Error:", e);
        }
    }, 3000);
}

client.on("interactionCreate", async (interaction) => {
    if (!interaction.guild || interaction.guild.id !== ALLOWED_GUILD_ID) return;

    if (interaction.isButton() || interaction.isStringSelectMenu()) {
        const cooldownKey = `${interaction.user.id}-${interaction.customId}`;
        if (cooldowns.has(cooldownKey) && interaction.customId !== "universal_verify_button" && !interaction.customId.startsWith("pay_") && !interaction.customId.startsWith("giveaway_join_") && !interaction.customId.startsWith("star_rating_")) return interaction.reply({ content: "⚠️ আপনি খুব দ্রুত ক্লিক করছেন!", flags: [MessageFlags.Ephemeral] });
        cooldowns.set(cooldownKey, true); setTimeout(() => cooldowns.delete(cooldownKey), 3000);
    }

    if (interaction.isButton() && interaction.customId === "universal_verify_button") {
        try {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            const role = interaction.guild.roles.cache.get(VERIFIED_ROLE_ID);
            if (!role) return interaction.editReply("❌ Role not found!");
            if (interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) return interaction.editReply("⚠️ আপনি ইতোমধ্যে ভেরিফাই হয়েছেন।");
            await interaction.member.roles.add(role); await interaction.editReply("✅ সফলভাবে ভেরিফাই সম্পন্ন হয়েছে!");
            
            db.ref(`analytics/joins/${Date.now()}`).set(interaction.user.id);
            await safeLogAudit("USER_VERIFIED", interaction.user.id, interaction.user.id);

            const logs = getWelcomeLogs(); const userLog = logs[interaction.user.id]; const welcomeChannel = interaction.guild.channels.cache.get(WELCOME_CHANNEL_ID);
            if (userLog && welcomeChannel) { try { const msg = await welcomeChannel.messages.fetch(userLog.messageId); if (msg) { const updatedEmbed = buildDynamicWelcomeEmbed(interaction.member, "verified", userLog.isOffline, Date.now()); await msg.edit({ embeds: [updatedEmbed] }); } } catch (e) {} }
        } catch (err) { console.error(err); }
        return;
    }

    // 🔑 OneTime Key Handler
    if (interaction.isButton() && (interaction.customId === "btn_generate_1time_key" || interaction.customId === "generate_1time_key")) {
        return handleOneTimeKeyGeneration(interaction);
    }

    // Giveaway Handler
    if (interaction.isButton() && interaction.customId.startsWith("giveaway_join_")) {
        const gwId = sanitizeFirebaseKey(interaction.customId.split("_")[2]);
        const safeUserId = sanitizeFirebaseKey(interaction.user.id);
        const participantRef = db.ref(`giveaways/${gwId}/participants/${safeUserId}`);
        
        const result = await participantRef.transaction((currentData) => {
            if (currentData) return; // Already entered
            return interaction.user.tag;
        });

        if (!result.committed) {
            return interaction.reply({ content: "❌ আপনি অলরেডি এই গিভঅ্যাওয়েতে জয়েন করেছেন!", flags: [MessageFlags.Ephemeral] });
        }
        
        const fullSnap = await db.ref(`giveaways/${gwId}`).once("value");
        const gwData = fullSnap.val();
        const count = Object.keys(gwData.participants || {}).length;
        
        const embed = EmbedBuilder.from(interaction.message.embeds[0]);
        embed.setFields({ name: "🎉 এন্ট্রি সংখ্যা", value: `\`${count}\` জন মেম্বার`, inline: true });
        await interaction.message.edit({ embeds: [embed] });

        return interaction.reply({ content: "✅ আপনি সফলভাবে গিভঅ্যাওয়েতে নাম এন্ট্রি করেছেন!", flags: [MessageFlags.Ephemeral] });
    }

    // Ticket Rating System
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
        
        const reviewChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
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

    // Dropdown Handlers
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
            const modal = new ModalBuilder().setCustomId(`modal_coupon_${lowerVal}`).setTitle("🎟️ Coupon / Discount Code");
            const couponInput = new TextInputBuilder()
                .setCustomId("coupon_code_input")
                .setLabel("কুপন কোড দিন (না থাকলে SKIP লিখুন)")
                .setStyle(TextInputStyle.Short)
                .setValue("SKIP")
                .setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(couponInput));
            return interaction.showModal(modal);
        } else if (type) {
            const ephemeralEmbed = new EmbedBuilder().setTitle(`📌 Selected Category: ${value.toUpperCase().replace("_", " ")}`).setDescription(`চ্যানেল তৈরি করতে নিচের বাটনে চাপ দিন।`).setColor(embedColor);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(buttonId).setLabel(`Create ${type.toUpperCase()}`).setStyle(ButtonStyle.Success));
            return interaction.reply({ embeds: [ephemeralEmbed], components: [row], flags: [MessageFlags.Ephemeral] });
        }
    }

    // Modal Submit & Coupon Handling
    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_coupon_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        
        const idempotencyKey = `coupon_${interaction.user.id}_${interaction.customId}`;
        const isFirst = await checkAndSetIdempotency(idempotencyKey, 10);
        if (!isFirst) {
            return interaction.editReply("⚠️ **Duplicate Submission!** আপনার অনুরোধটি ইতোমধ্যে প্রসেস করা হচ্ছে।");
        }

        const rawCategory = interaction.customId.split("_")[2].toLowerCase();
        const category = getNormalizedCategory(rawCategory);
        const rawCoupon = interaction.fields.getTextInputValue("coupon_code_input").trim().toUpperCase();
        const couponEntered = sanitizeFirebaseKey(rawCoupon);
        const userId = interaction.user.id;
        const safeUserId = sanitizeFirebaseKey(userId);
        
        // 🔒 ACTIVE PAYMENT SESSION OVERWRITE PROTECTION (ATOMIC MUTEX)
        const sessionRef = db.ref(`pending_payments/${safeUserId}_${category}`);
        const sessionLock = await sessionRef.transaction((currentSess) => {
            if (currentSess) {
                const activeStates = ["STARTED", "COUPON_RESERVED", "PAYMENT_PENDING", "PARTIALLY_PAID", "PAID", "ACCOUNT_PENDING", "ACCOUNT_CREATING"];
                if (activeStates.includes(currentSess.status)) {
                    const isStale = currentSess.createdAt && (Date.now() - currentSess.createdAt > 15 * 60 * 1000);
                    if (!isStale) return; // Abort overwrite if active session exists and is not stale
                }
            }
            return {
                sessionId: `sess_${safeUserId}_${category}_${Date.now()}`,
                userId: userId,
                category: category,
                status: "STARTED",
                createdAt: Date.now()
            };
        });

        if (!sessionLock.committed) {
            return interaction.editReply("⚠️ **অ্যাক্টিভ পেমেন্ট সেশন রয়েছে!** আপনার ইতোমধ্যে একটি পেন্ডিং বা কমপ্লিট পেমেন্ট প্রসেস চালু রয়েছে।");
        }

        let basePrice = PACKAGE_PRICES[category] || 510;
        let finalPrice = basePrice;
        let discountText = "কোনো ডিসকাউন্ট কুপন ব্যবহার করা হয়নি।";
        let appliedCouponCode = null;
        let appliedDiscountValue = 0;

        if (couponEntered !== "SKIP") {
            const couponRef = db.ref(`coupons/${couponEntered}`);
            const RESERVATION_TTL_MS = 15 * 60 * 1000;
            
            // Atomic check & reserve coupon with auto-lease expiry check
            const claimCouponResult = await couponRef.transaction((currentCoupon) => {
                if (!currentCoupon) return currentCoupon;
                const now = Date.now();
                
                if (currentCoupon.status === "used" || currentCoupon.status === "USED") return; 

                const isExpired = currentCoupon.reservedAt && (now - currentCoupon.reservedAt > RESERVATION_TTL_MS);
                if (currentCoupon.status !== "active" && !isExpired) return; 
                if (currentCoupon.expiresAt && currentCoupon.expiresAt < now) return; 

                return {
                    ...currentCoupon,
                    status: "RESERVED",
                    reservedBy: userId,
                    reservedAt: now,
                    reservationExpiresAt: now + RESERVATION_TTL_MS,
                    reservedSessionId: `${safeUserId}_${category}`
                };
            });

            if (claimCouponResult.committed && claimCouponResult.snapshot.exists()) {
                const couponData = claimCouponResult.snapshot.val();
                appliedDiscountValue = Number(couponData.couponValue || couponData.discountValue || 0);
                finalPrice = Math.max(0, basePrice - appliedDiscountValue);
                appliedCouponCode = couponEntered;

                discountText = `🎉 **কুপন কোড \`${couponEntered}\` সফলভাবে অ্যাপ্লাই হয়েছে!**\n` +
                               `💸 **ছাড়ের পরিমাণ:** \`${appliedDiscountValue}\` ৳\n` +
                               `🏷️ **নতুন পরিশোধযোগ্য মূল্য:** \`${finalPrice}\` ৳`;
            } else {
                discountText = "⚠️ **অবৈধ, ব্যবহৃত বা মেয়াদোত্তীর্ণ কুপন কোড!** মূল মূল্য প্রযোজ্য হবে।";
            }
        }

        if (finalPrice <= 0) {
            const opId = `op_coupon100_${userId}_${Date.now()}`;
            await db.ref(`payment_operations/${opId}`).set({
                operationId: opId,
                userId: userId,
                category: category,
                paymentMethod: "COUPON",
                state: "COUPON_RESERVED",
                sessionCommitted: true,
                couponCommitted: true,
                txnCommitted: false,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });

            await db.ref(`pending_payments/${safeUserId}_${category}`).update({
                targetPrice: 0,
                basePrice: basePrice,
                appliedCoupon: appliedCouponCode,
                appliedDiscount: appliedDiscountValue,
                totalPaid: 0,
                status: "PAID",
                paymentMethod: "COUPON",
                usedTxns: [],
                updatedAt: Date.now()
            });

            if (appliedCouponCode) {
                const safeAppCoupon = sanitizeFirebaseKey(appliedCouponCode);
                await db.ref(`coupons/${safeAppCoupon}`).transaction((coupon) => {
                    if (!coupon || coupon.status === "used" || coupon.status === "USED") return coupon;
                    return {
                        ...coupon,
                        status: "used",
                        usedBy: userId,
                        usedAt: Date.now()
                    };
                });
            }

            await db.ref(`payment_operations/${opId}`).update({ state: "FINALIZED", finalized: true, updatedAt: Date.now() });

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

        await db.ref(`pending_payments/${safeUserId}_${category}`).update({
            targetPrice: finalPrice,
            basePrice: basePrice,
            appliedCoupon: appliedCouponCode,
            appliedDiscount: appliedDiscountValue,
            totalPaid: 0,
            status: "PAYMENT_PENDING",
            usedTxns: [],
            updatedAt: Date.now()
        });

        const payEmbed = new EmbedBuilder()
            .setTitle(`💳 Payment Gateway: ${category.toUpperCase().replace("_", " ")}`)
            .setDescription(
                `📦 **প্যাকেজের রেগুলার মূল্য:** \`${basePrice}\` BDT\n` +
                `💰 **আপনাকে পেমেন্ট করতে হবে:** \`${finalPrice}\` BDT\n\n` +
                `📱 **বিকাশ / নগদ (Personal):** \`${PAYMENT_NUMBER}\`\n\n` +
                `টাকা পাঠানোর পর প্রাপ্ত Transaction ID (TxnID) দিয়ে নিচের **"Submit TxnID"** বাটনে ক্লিক করুন।\n\n` +
                `🎁 **কুপন ও ডিসকাউন্ট স্ট্যাটাস:**\n${discountText}`
            )
            .setColor("#9B59B6");

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`submit_txn_${category}`)
                .setLabel("Submit TxnID")
                .setStyle(ButtonStyle.Primary)
        );

        return interaction.editReply({ embeds: [payEmbed], components: [row] });
    }

    if (interaction.isButton() && interaction.customId.startsWith("submit_txn_")) {
        const rawCategory = interaction.customId.split("_")[2].toLowerCase();
        const category = getNormalizedCategory(rawCategory);
        
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
        
        const rawTxnInput = interaction.fields.getTextInputValue("txn_id_input").trim();
        const txnId = sanitizeFirebaseKey(rawTxnInput);
        const userId = interaction.user.id;
        const safeUserId = sanitizeFirebaseKey(userId);

        const idempotencyKey = `txn_${userId}_${txnId}`;
        const isFirstRequest = await checkAndSetIdempotency(idempotencyKey, 10);
        if (!isFirstRequest) {
            return interaction.editReply("⚠️ **Duplicate Submission!** আপনার পেমেন্ট ভেরিফিকেশন অনুরোধটি ইতোমধ্যে প্রক্রিয়াধীন আছে।");
        }

        const sessionRef = db.ref(`pending_payments/${safeUserId}_${category}`);
        const txnRef = db.ref(`transactions/${txnId}`);
        const opId = `op_${userId}_${txnId}_${Date.now()}`;
        const opRef = db.ref(`payment_operations/${opId}`);

        try {
            // 🔒 ATOMIC TRANSACTION LIFECYCLE MUTEX (AVAILABLE -> CLAIMING -> COMMITTED)
            const claimResult = await txnRef.transaction((currentData) => {
                const now = Date.now();
                if (currentData === null) return currentData; 
                if (currentData.used === true || currentData.status === "CLAIMED" || currentData.status === "COMMITTED") {
                    return; 
                }
                if (currentData.status === "CLAIMING" && currentData.claimedAt && (now - currentData.claimedAt < 30000)) {
                    return; 
                }
                return {
                    ...currentData,
                    status: "CLAIMING",
                    claimedBy: userId,
                    claimedAt: now
                };
            });

            if (!claimResult.committed || !claimResult.snapshot.exists()) {
                return interaction.editReply("❌ **অকার্যকর বা ব্যবহৃত Transaction ID!** এই Transaction ID-টি সিস্টেমে নেই বা ইতোমধ্যে ব্যবহার করা হয়েছে।");
            }

            const txnData = claimResult.snapshot.val();
            const newTxnAmount = Number(txnData.amount) || 0;

            if (isNaN(newTxnAmount) || newTxnAmount <= 0) {
                await txnRef.update({ status: "AVAILABLE", claimedBy: null, claimedAt: null });
                return interaction.editReply("❌ **অবৈধ Transaction Amount!** সেশনে পেমেন্টের সঠিক তথ্য পাওয়া যায়নি।");
            }

            await opRef.set({
                operationId: opId,
                userId: userId,
                txnId: txnId,
                amount: newTxnAmount,
                category: category,
                paymentMethod: "TRANSACTION",
                state: "STARTED",
                sessionCommitted: false,
                txnCommitted: false,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });

            let processFailed = false;

            try {
                // ATOMIC UPDATE FOR PAYMENT SESSION
                const sessionTxnResult = await sessionRef.transaction((currentSession) => {
                    const sess = currentSession || {
                        category: category,
                        targetPrice: PACKAGE_PRICES[category] || 510,
                        totalPaid: 0,
                        status: "PAYMENT_PENDING",
                        usedTxns: []
                    };

                    const used = sess.usedTxns || [];
                    if (used.includes(txnId)) {
                        return; // Already added
                    }

                    used.push(txnId);
                    const updatedTotalPaid = (Number(sess.totalPaid) || 0) + newTxnAmount;
                    const target = sess.targetPrice || PACKAGE_PRICES[category] || 510;

                    return {
                        ...sess,
                        totalPaid: updatedTotalPaid,
                        usedTxns: used,
                        status: updatedTotalPaid >= target ? "PAID" : "PARTIALLY_PAID",
                        lastUpdated: Date.now()
                    };
                });

                if (!sessionTxnResult.committed) {
                    await txnRef.update({ status: "AVAILABLE", claimedBy: null, claimedAt: null });
                    await opRef.update({ state: "FAILED", updatedAt: Date.now() });
                    return interaction.editReply("⚠️ এই Transaction ID-টি ইতোমধ্যে আপনার পেমেন্ট সেশনে ব্যবহার করা হয়েছে।");
                }

                await opRef.update({ state: "SESSION_COMMITTED", sessionCommitted: true, updatedAt: Date.now() });

                const updatedSession = sessionTxnResult.snapshot.val();
                const targetPrice = updatedSession.targetPrice;
                const currentTotalPaid = updatedSession.totalPaid;

                await txnRef.update({
                    used: true,
                    status: "COMMITTED",
                    usedBy: userId,
                    usedAt: Date.now()
                });

                await opRef.update({ state: "TXN_COMMITTED", txnCommitted: true, updatedAt: Date.now() });

                await safeLogAudit("PAYMENT_TXN_CLAIMED", userId, txnId, { amount: newTxnAmount, category });

                if (currentTotalPaid < targetPrice) {
                    const remainingDue = targetPrice - currentTotalPaid;
                    await opRef.update({ state: "FINALIZED", updatedAt: Date.now() });

                    const pendingEmbed = new EmbedBuilder()
                        .setTitle("❌ Payment Verification Pending (আংশিক পেমেন্ট)")
                        .setDescription(
                            `আপনি **${category.toUpperCase()}** প্যাকেজ নির্বাচন করেছেন।\n\n` +
                            `📌 **প্রয়োজনীয় মূল্য:** \`${targetPrice}\` BDT\n` +
                            `💳 **প্রাপ্ত মোট টাকা:** \`${currentTotalPaid}\` BDT\n` +
                            `📉 **বকেয়া টাকা:** \`${remainingDue}\` BDT\n\n` +
                            `⚠️ অবশিষ্ট **${remainingDue} BDT** নিচের নম্বরে বানিয়ে নতুন Transaction ID সাবমিট করুন:\n` +
                            `📱 **বিকাশ / নগদ (Personal):** \`${PAYMENT_NUMBER}\``
                        )
                        .setColor("Orange")
                        .setTimestamp();

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`submit_txn_${category}`)
                            .setLabel("➕ Submit Additional TxnID")
                            .setStyle(ButtonStyle.Secondary)
                    );

                    return interaction.editReply({ embeds: [pendingEmbed], components: [row] });
                }

                let extraPayment = currentTotalPaid - targetPrice;
                let createdCouponCode = null;

                if (extraPayment > 0) {
                    let isUnique = false;
                    while (!isUnique) {
                        createdCouponCode = generateUniqueCouponCode();
                        const safeCouponCode = sanitizeFirebaseKey(createdCouponCode);
                        const couponRef = db.ref(`coupons/${safeCouponCode}`);
                        
                        const couponResult = await couponRef.transaction((current) => {
                            if (current !== null) return; 
                            return {
                                couponCode: createdCouponCode,
                                userId: userId,
                                username: interaction.user.username,
                                couponValue: extraPayment,
                                extraPaymentAmount: extraPayment,
                                createdAt: Date.now(),
                                expiresAt: Date.now() + (90 * 24 * 60 * 60 * 1000),
                                status: "active"
                            };
                        });
                        if (couponResult.committed) {
                            isUnique = true;
                        }
                    }
                }

                if (updatedSession.appliedCoupon) {
                    const safeAppCoupon = sanitizeFirebaseKey(updatedSession.appliedCoupon);
                    await db.ref(`coupons/${safeAppCoupon}`).transaction((coupon) => {
                        if (!coupon || coupon.status === "used" || coupon.status === "USED") return coupon;
                        return {
                            ...coupon,
                            status: "used",
                            usedBy: userId,
                            usedAt: Date.now()
                        };
                    });
                }

                await opRef.update({ state: "FINALIZED", updatedAt: Date.now() });

                let extraInfoText = "";
                if (extraPayment > 0 && createdCouponCode) {
                    extraInfoText = `\n\n🎁 **Extra Payment Reward Coupon Generated!**\n` +
                                    `আপনি প্যাকেজের মূল্যের চেয়ে **${extraPayment} ৳** বেশি পরিশোধ করেছেন।\n` +
                                    `আপনার জন্য একটি ডিসকাউন্ট কুপন তৈরি করা হয়েছে:\n` +
                                    `🎟️ **Coupon Code:** \`${createdCouponCode}\`\n` +
                                    `💸 **Discount Balance:** \`${extraPayment}\` ৳\n` +
                                    `📌 **Status:** Active`;
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

            } catch (innerErr) {
                processFailed = true;
                console.error("❌ Inner Txn Process Error:", innerErr);
                
                const snap = await txnRef.once("value");
                const currentTxn = snap.val();
                if (currentTxn && (currentTxn.status === "COMMITTED" || currentTxn.status === "CLAIMED")) {
                    await sessionRef.update({ paymentState: "RECOVERY_REQUIRED", recoveryReason: "TXN_COMMITTED_SESSION_ERROR" });
                    await opRef.update({ state: "RECOVERY_REQUIRED", recoveryRequired: true, updatedAt: Date.now() });
                } else {
                    await txnRef.update({ status: "AVAILABLE", claimedBy: null, claimedAt: null });
                    await opRef.update({ state: "FAILED", updatedAt: Date.now() });
                }
                throw innerErr;
            }

        } catch (err) {
            console.error("❌ Txn Verification Error:", err);
            return interaction.editReply("❌ **পেমেন্ট প্রক্রিয়াকরণে সমস্যা হয়েছে!** অনুগ্রহ করে অ্যাডমিনের সাথে যোগাযোগ করুন।");
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
            .setLabel("পছন্দমতো Username (ইংরেজিতে)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const passInput = new TextInputBuilder()
            .setCustomId("custom_password")
            .setLabel("পছন্দমতো Password")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(userInput),
            new ActionRowBuilder().addComponents(passInput)
        );

        return interaction.showModal(modal);
    }

    // 🌟 AUTOMATED ACCOUNT CREATION & SYNC FOR C++ APP
    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_create_account_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const idempotencyKey = `create_acc_${interaction.user.id}_${interaction.customId}`;
        const isFirst = await checkAndSetIdempotency(idempotencyKey, 15);
        if (!isFirst) {
            return interaction.editReply("⚠️ **Duplicate Submission!** আপনার অ্যাকাউন্ট তৈরি করার অনুরোধটি ইতোমধ্যে প্রসেস হচ্ছে।");
        }

        const rawCategory = interaction.customId.split("_")[3].toLowerCase();
        const category = getNormalizedCategory(rawCategory);

        const rawUserInput = interaction.fields.getTextInputValue("custom_username").trim();
        const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/;
        if (!usernameRegex.test(rawUserInput)) {
            return interaction.editReply("❌ **Invalid Username!** শুধুমাত্র বর্ণ (a-z, A-Z), সংখ্যা (0-9), হাইফেন (-) এবং আন্ডারস্কোর (_) ব্যবহার করা যাবে (৩-২০ অক্ষর)।");
        }

        const customUser = sanitizeFirebaseKey(rawUserInput.toLowerCase());
        const customPass = interaction.fields.getTextInputValue("custom_password").trim();
        const hashedPassword = hashPassword(customPass);

        const userId = interaction.user.id;
        const safeUserId = sanitizeFirebaseKey(userId);
        
        const userAvatarUrl = interaction.user.displayAvatarURL({ extension: "png", dynamic: true, size: 512 });
        const serverName = interaction.guild ? interaction.guild.name : "Discord Server";

        const sessionRef = db.ref(`pending_payments/${safeUserId}_${category}`);
        
        // Lock Account Creation State
        const lockResult = await sessionRef.transaction((session) => {
            if (!session) return session;
            if (session.accountState === "ACCOUNT_CREATING" || session.accountState === "ACCOUNT_CREATED") {
                return; 
            }
            return {
                ...session,
                accountState: "ACCOUNT_CREATING"
            };
        });

        if (!lockResult.committed) {
            return interaction.editReply("⚠️ **অ্যাকাউন্ট তৈরি হচ্ছে বা ইতোমধ্যে তৈরি করা হয়েছে!**");
        }

        const sessionData = lockResult.snapshot.val();

        if (!sessionData || sessionData.totalPaid < sessionData.targetPrice) {
            await sessionRef.update({ accountState: null });
            return interaction.editReply("❌ **পেমেন্ট অসম্পূর্ণ!** সম্পূর্ণ টাকা পরিশোধ করুন।");
        }

        try {
            const usernameRes = await db.ref(`users/${customUser}`).transaction((current) => {
                if (current !== null && (!current.reserved || (current.reservedAt && Date.now() - current.reservedAt < 300000))) {
                    return; 
                }
                return { reserved: true, reservedBy: userId, reservedAt: Date.now() };
            });

            if (!usernameRes.committed) {
                await sessionRef.update({ accountState: null });
                return interaction.editReply(`❌ **Username Already Exists!** \`${customUser}\` নামটি অন্য কারো ব্যবহৃত।`);
            }

            let days = 7;
            let packageName = "Weekly";
            if (category === "monthly") {
                days = 30;
                packageName = "Monthly";
            } else if (category === "2_months") {
                days = 60;
                packageName = "2 Months";
            }

            const expiryTimestamp = Date.now() + (days * 24 * 60 * 60 * 1000);

            await db.ref(`users/${customUser}`).set({
                username: customUser,         
                passwordHash: hashedPassword,
                discordId: userId,
                avatarUrl: userAvatarUrl,    
                serverName: serverName,      
                category: category,          
                package: packageName,        
                paidAmount: sessionData.totalPaid,
                usedTxns: sessionData.usedTxns || [],
                createdAt: Date.now(),
                expiresAt: expiryTimestamp,  
                status: "active"             
            });

            await sessionRef.update({ accountState: "ACCOUNT_CREATED", accountCreatedUsername: customUser });

            let orderId;
            try {
                orderId = await getNextAtomicCounter("orders", "ORD", 3);
            } catch (cntErr) {
                console.error("❌ Atomic Counter Error on Order Creation:", cntErr);
                await sessionRef.update({ accountState: "ACCOUNT_CREATED", recoveryRequired: true, recoveryReason: "ORDER_COUNTER_FAILED" });
                return interaction.editReply("⚠️ **অ্যাকাউন্ট তৈরি হয়েছে কিন্তু অর্ডার ট্র্যাকিং আইডি জেনারেট করা যায়নি!** অ্যাডমিনকে জানান।");
            }

            await db.ref(`orders/${orderId}`).set({
                orderId: orderId,
                userId: userId,
                category: category,
                package: packageName,
                basePrice: sessionData.basePrice || sessionData.targetPrice,
                discount: sessionData.appliedDiscount || 0,
                finalPrice: sessionData.targetPrice,
                payment: {
                    requiredAmount: sessionData.targetPrice,
                    totalPaid: sessionData.totalPaid,
                    status: "PAID",
                    transactions: sessionData.usedTxns || []
                },
                status: "ACCOUNT_CREATED",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                paidAt: Date.now()
            });

            await safeLogAudit("ACCOUNT_CREATED", userId, customUser, { orderId: orderId, package: packageName });

            let supportRoleId = ROLES.SUPPORT_CUSTOMER;
            let channelPrefix = `order-${orderId.toLowerCase()}`;

            const permissionOverwrites = [
                { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: VERIFIED_ROLE_ID, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
            ];

            if (interaction.guild.roles.cache.has(supportRoleId)) permissionOverwrites.push({ id: supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
            if (interaction.guild.roles.cache.has(ROLES.ADMIN)) permissionOverwrites.push({ id: ROLES.ADMIN, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

            let privateChannel;
            try {
                privateChannel = await interaction.guild.channels.create({
                    name: channelPrefix,
                    type: 0,
                    permissionOverwrites
                });
            } catch (chanErr) {
                console.error("❌ Order Channel Creation Failure:", chanErr);
                await db.ref(`orders/${orderId}`).update({ status: "CHANNEL_FAILED", recoveryRequired: true });
                return interaction.editReply("⚠️ **অ্যাকাউন্ট তৈরি সফল হয়েছে, কিন্তু ডিসকর্ড চ্যানেল তৈরি করা যায়নি!** আপনার অ্যাকাউন্ট ক্রেডেনশিয়ালস ডিএমে পাঠানোর চেষ্টা করা হচ্ছে।");
            }

            // Register Order Channel Registry Link
            const safeOrderChanId = sanitizeFirebaseKey(privateChannel.id);
            await db.ref(`tickets/${safeOrderChanId}`).set({
                ticketId: orderId,
                type: "order",
                category: category,
                userId: userId,
                channelId: privateChannel.id,
                status: "OPEN",
                claimedBy: null,
                createdAt: Date.now()
            });

            const orderEmbed = new EmbedBuilder()
                .setTitle(`🛍️ NEW MEMBERSHIP ORDER CONFIRMED [${orderId}]`)
                .setColor("#00FF00")
                .setThumbnail(userAvatarUrl)
                .addFields(
                    { name: "👤 কাস্টমার", value: `${interaction.user}`, inline: true },
                    { name: "📦 প্যাকেজ", value: `\`${packageName.toUpperCase()}\``, inline: true },
                    { name: "👤 Username", value: `\`${customUser}\``, inline: true },
                    { name: "🔑 Password", value: `\`[PROTECTED - DELIVERED VIA PRIVATE DM]\``, inline: true },
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
            } catch (dmErr) {
                console.warn("⚠️ Could not send DM to user:", dmErr);
                await db.ref(`orders/${orderId}`).update({ credentialDeliveryStatus: "CREDENTIAL_DELIVERY_FAILED" });
            }

            const trackingChannel = interaction.guild.channels.cache.get(ORDER_TRACKING_CHANNEL_ID);
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
            
            // Username Cleanup on complete failure
            const checkUserSnap = await db.ref(`users/${customUser}`).once("value");
            if (checkUserSnap.exists() && checkUserSnap.val().reserved && !checkUserSnap.val().createdAt) {
                await db.ref(`users/${customUser}`).remove();
            }

            if (checkUserSnap.exists() && checkUserSnap.val().createdAt) {
                await sessionRef.update({ accountState: "ACCOUNT_CREATED", recoveryRequired: true, recoveryReason: "DISCORD_DISPATCH_FAILED" });
            } else {
                await sessionRef.update({ accountState: "ACCOUNT_FAILED" });
            }
            return interaction.editReply("❌ **অ্যাকাউন্ট তৈরিতে ত্রুটি ঘটেছে!**");
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith("create_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const parts = interaction.customId.split("_");
        const type = parts[1]; const category = parts.slice(2).join("_");

        const safeUserId = sanitizeFirebaseKey(interaction.user.id);
        const activeTicketRef = db.ref(`tickets_active/${safeUserId}_${type}`);

        // ATOMIC TICKET RESERVATION LOCK
        const activeLockResult = await activeTicketRef.transaction((current) => {
            if (current && (current.status === "OPEN" || current.status === "RESERVED")) {
                return; // Abort: active ticket exists
            }
            return {
                status: "RESERVED",
                createdAt: Date.now()
            };
        });

        if (!activeLockResult.committed) {
            return interaction.editReply("⚠️ **Duplicate Ticket!** আপনার ইতোমধ্যে এই ক্যাটাগরিতে একটি ওপেন টিকিট রয়েছে।");
        }

        const prefixCode = type.toUpperCase().slice(0, 3);
        let sequenceId;
        try {
            sequenceId = await getNextAtomicCounter(`counter_${type}`, prefixCode, 3);
        } catch (cntErr) {
            console.error("❌ Ticket Counter Error:", cntErr);
            await activeTicketRef.remove();
            return interaction.editReply("❌ **টিকিট কাউন্টার জেনারেট করা সম্ভব হয়নি!** পুনরায় চেষ্টা করুন।");
        }

        let supportRoleId = ROLES.SUPPORT_TICKET_REPORT;
        let channelPrefix = `${type}-${sequenceId.toLowerCase()}`;

        if (type === "customer") supportRoleId = ROLES.SUPPORT_CUSTOMER;

        const permissionOverwrites = [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: VERIFIED_ROLE_ID, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
        ];

        if (interaction.guild.roles.cache.has(supportRoleId)) permissionOverwrites.push({ id: supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
        if (interaction.guild.roles.cache.has(ROLES.ADMIN)) permissionOverwrites.push({ id: ROLES.ADMIN, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

        let privateChannel;
        try {
            privateChannel = await interaction.guild.channels.create({
                name: channelPrefix,
                type: 0,
                permissionOverwrites
            });
        } catch (cErr) {
            console.error("❌ Ticket Channel Creation Error:", cErr);
            await activeTicketRef.remove();
            return interaction.editReply("❌ **টিকিট চ্যানেল তৈরি করা সম্ভব হয়নি!** পারমিশন পরীক্ষা করুন।");
        }

        const safeChannelId = sanitizeFirebaseKey(privateChannel.id);
        await db.ref(`tickets/${safeChannelId}`).set({
            ticketId: sequenceId,
            type: type,
            category: category,
            userId: interaction.user.id,
            channelId: privateChannel.id,
            status: "OPEN",
            claimedBy: null,
            createdAt: Date.now()
        });

        await activeTicketRef.update({
            channelId: privateChannel.id,
            status: "OPEN"
        });

        const panelEmbed = new EmbedBuilder().setTitle(`🛠️ ${type.toUpperCase()} REQUEST - ${category.toUpperCase().replace("_", " ")} [${sequenceId}]`).setDescription(`স্বাগতম ${interaction.user}!\nআমাদের সাপোর্ট স্টাফ খুব শীঘ্রই আপনাকে সহায়তা করবে।`).setColor("Green").setTimestamp();
        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`claim_${type}`).setLabel("🛟 Claim").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`close_${type}`).setLabel("🔒 Close").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`ban_panel_${type}`).setLabel("🚫 Support Ban").setStyle(ButtonStyle.Danger)
        );

        await privateChannel.send({ content: `${interaction.user} <@&${supportRoleId}>`, embeds: [panelEmbed], components: [actionRow] });

        const trackingChannel = interaction.guild.channels.cache.get(ORDER_TRACKING_CHANNEL_ID);
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

        return interaction.editReply({ content: `✅ আপনার **${type.toUpperCase()}** টিকিট তৈরি হয়েছে: ${privateChannel}` });
    }

    // 🛟 CLAIM ACTION HANDLER
    if (interaction.isButton() && (interaction.customId.startsWith("claim_"))) {
        return handleClaimAction(interaction);
    }

    // 🔒 CLOSE ACTION HANDLER
    if (interaction.isButton() && (interaction.customId.startsWith("close_"))) {
        return handleCloseAction(interaction);
    }
});

// Bot Login
client.login(TOKEN);
