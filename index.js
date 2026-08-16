// ================================================
// 🚀 PART 1 - Dependencies & Essential Imports
// ================================================

// 1. Core Web Server & File System Modules
const express = require("express");
const fs = require("fs");

// 2. Firebase Admin SDK Integration
const admin = require("firebase-admin");

// 3. Discord.js Core Components & Builders
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

// 4. HTML Transcripts Module (For Ticket Logs)
const discordTranscripts = require("discord-html-transcripts");

// Exporting modules if used in a multi-file architecture
module.exports = {
    express,
    fs,
    admin,
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
    TextInputStyle,
    discordTranscripts
};

// ================================================
// 🚀 PART 2 - Environment Variable & Service Account Loader
// ================================================

let serviceAccount;

try {
    // 1. Render/Cloud Environment Variable থেকে JSON পার্সিং
    if (process.env.FIREBASE_CONFIG) {
        serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        console.log("✅ Loaded Firebase Config from Environment Variable.");
    } else {
        // 2. Local Environment fallback (লোকাল ফাইল থেকে লোড)
        serviceAccount = require("./firebase-service-account.json");
        console.log("✅ Loaded Firebase Config from Local JSON file.");
    }
} catch (e) {
    console.error("❌ Firebase Config Load Error:", e);
}

module.exports = {
    serviceAccount
};

// ================================================
// 🚀 PART 3 - Firebase Admin SDK Initialization
// ================================================

// Firebase Admin initialization with fallback database URL
const firebaseURL = process.env.FIREBASE_DB_URL || "YOUR_FIREBASE_DATABASE_URL";

try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: firebaseURL
    });
    console.log("✅ Firebase Admin SDK Initialized Successfully.");
} catch (error) {
    console.error("❌ Firebase Initialization Error:", error);
}

// Global Realtime Database Reference Instance
const db = admin.database();

module.exports = {
    db,
    admin
};

// ================================================
// 🚀 PART 4 - Web Server Setup (Express Keep-Alive)
// ================================================

const app = express();

// Base health-check route to keep the bot alive on cloud hosts
app.get("/", (req, res) => {
    res.send("Bot is running!");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
});

module.exports = {
    app,
    PORT
};


// ================================================
// 📱 PART 5 - Dynamic Settings Sync (Firebase Listener)
// ================================================

let PAYMENT_NUMBER = "01404548951"; // ডিফল্ট মোবাইল নম্বর
let VERIFICATION_LINK = "https://discord.gg/example"; // ডিফল্ট লিঙ্ক

// 🔄 ফায়ারবেস Realtime Database থেকে settings এর তথ্য লাইভ আপডেট রাখার লিসেনার
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

module.exports = {
    getPaymentNumber: () => PAYMENT_NUMBER,
    getVerificationLink: () => VERIFICATION_LINK
};



// ================================================
// ⚙️ PART 6 - Bot Credentials & Server IDs Config
// ================================================

const TOKEN = process.env.TOKEN;

// 🏰 Target Guild (Server) & Core Role Configs
const ALLOWED_GUILD_ID = "1488101970425155584";
const VERIFIED_ROLE_ID = "1488333841402691664";

module.exports = {
    TOKEN,
    ALLOWED_GUILD_ID,
    VERIFIED_ROLE_ID
};

// ================================================
// 📌 PART 7 - Core System Channels Mapping
// ================================================

// 📢 সিস্টেম নোটিফিকেশন ও ট্র্যাকিং চ্যানেল আইডি
const WELCOME_CHANNEL_ID = "1488339169821593731";
const LOG_CHANNEL_ID = "1488340400673656973";

// 📦 অর্ডার ট্র্যাকিং ও কাস্টমার গাইড চ্যানেল আইডি
const ORDER_TRACKING_CHANNEL_ID = "1488340262827855983"; 
const ORDER_GUIDE_CHANNEL_ID = "1488339045602951199";

// 🔑 ১-টাইম কী জেনারেটর চ্যানেল আইডি তালিকা
const ONETIME_KEY_CHANNEL_IDS = ["1488340757160005683"];

module.exports = {
    WELCOME_CHANNEL_ID,
    LOG_CHANNEL_ID,
    ORDER_TRACKING_CHANNEL_ID,
    ORDER_GUIDE_CHANNEL_ID,
    ONETIME_KEY_CHANNEL_IDS
};

// ================================================
// 🎫 PART 8 - Ticket Channel IDs Config
// ================================================

// 🎟️ টিকিট সিস্টেমের নির্দিষ্ট চ্যানেল আইডির তালিকা
const TICKET_CHANNEL_IDS = [
    "1488339801261391962", // জেনারেল সাপোর্ট টিকিট
    "1488339893418512536", // পেমেন্ট ইস্যু টিকিট
    "1488339967204704386"  // অ্যাকাউন্ট ও মেম্বারশিপ টিকিট
];

module.exports = {
    TICKET_CHANNEL_IDS
};

// ================================================
// 📋 PART 9 - Ticket & Key Setup Panel Definitions
// ================================================

// 🎟️ টিকিট সিস্টেমের ড্রপডাউন ক্যাটাগরি কনফিগারেশন
const TICKET_PANEL_OPTIONS = [
    {
        label: "General Support",
        description: "সাধারণ যেকোনো সহায়তার জন্য টিকিট খুলুন",
        value: "ticket_general",
        emoji: "💬"
    },
    {
        label: "Payment Issue",
        description: "পেমেন্ট সম্পর্কিত সমস্যার জন্য যোগাযোগ করুন",
        value: "ticket_payment",
        emoji: "💳"
    },
    {
        label: "Account & Access",
        description: "অ্যাকাউন্ট ভেরিফিকেশন বা অ্যাক্সেস সংক্রান্ত সমস্যা",
        value: "ticket_account",
        emoji: "🔑"
    }
];

// 🔑 ১-টাইম কী তৈরির জন্য এম্বেদ ডিটেইলস
const KEY_PANEL_CONFIG = {
    title: "⚡ Generate 1-Time Access Key",
    description: "নিচের বাটনে ক্লিক করে আপনার ১-টাইম ব্যবহারের ইউনিক সিকিউরিটি কী (Key) জেনারেট করুন।",
    buttonLabel: "Generate Key",
    buttonCustomId: "btn_generate_onetime_key",
    color: 0x00FF7F
};

module.exports = {
    TICKET_PANEL_OPTIONS,
    KEY_PANEL_CONFIG
};

// ================================================
// 🎨 PART 10 - Standard Embed & Response UI Helpers
// ================================================

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

/**
 * তৈরি করে এক নজরকাড়া সাকসেস বা ইনফো এম্বেদ (Success/Info Embed Builder)
 */
function createStandardEmbed(title, description, color = 0x2F3136) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp()
        .setFooter({ text: "Secure Auth & Ticket System" });
}

/**
 * তৈরি করে কাস্টম এরর বা ওয়ার্নিং এম্বেদ (Error Embed Builder)
 */
function createErrorEmbed(description) {
    return new EmbedBuilder()
        .setTitle("⚠️ Error / সতর্কতা")
        .setDescription(description)
        .setColor(0xFF4757)
        .setTimestamp();
}

/**
 * প্রাইভেট বা সিকিউর মেসেজের জন্য কাস্টম একশন রো জেনারেটর
 */
function createDismissButton() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("btn_dismiss_msg")
            .setLabel("Close")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("🗑️")
    );
}

module.exports = {
    createStandardEmbed,
    createErrorEmbed,
    createDismissButton
};

// ================================================
// 🛠️ PART 11 - General Utility Functions & Helpers
// ================================================

/**
 * ইনপুট টেক্সট থেকে ক্ষতিকর ক্যারেক্টার ও স্পেস ক্লিন করে sanitization করার জন্য
 */
function sanitizeInput(input) {
    if (typeof input !== "string") return "";
    return input.trim().replace(/[<>'"/]/g, "");
}

/**
 * সিস্টেম নোটিফিকেশনের জন্য বর্তমান সময় ফরম্যাট করে নেওয়ার হেলপার
 */
function getFormattedTimestamp() {
    return new Date().toLocaleString("en-US", {
        timeZone: "Asia/Dhaka",
        dateStyle: "medium",
        timeStyle: "short"
    });
}

/**
 * নির্দিষ্ট সময় ওয়েট করার জন্য অ্যাসিঙ্ক স্লিপ ফাংশন (Delay Helper)
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
    sanitizeInput,
    getFormattedTimestamp,
    sleep
};

// ================================================
// 🔑 PART 12 - Security & Cryptographic Generators
// ================================================

const crypto = require("crypto");

/**
 * র্যান্ডম সিকিউর ট্রানজেকশন / সেশন আইডি জেনারেটর
 * 16 বাইটের র্যান্ডম হেক্স স্ট্রিং যা পেমেন্ট সেশন ট্র্যাকিংয়ে ব্যবহৃত হয়
 */
function generateSessionId() {
    return crypto.randomBytes(16).toString("hex");
}

/**
 * 1-টাইম সিকিউর ব্যবহারের জন্য ক্রিপ্টোগ্রাফিক অ্যালফানিউমেরিক কী (Key) জেনারেটর
 * ফরম্যাট: XXXX-XXXX-XXXX-XXXX
 */
function generateOnetimeKey() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const segmentLength = 4;
    const segments = 4;
    let keySegments = [];

    for (let i = 0; i < segments; i++) {
        let segment = "";
        const randomBytes = crypto.randomBytes(segmentLength);
        for (let j = 0; j < segmentLength; j++) {
            segment += chars[randomBytes[j] % chars.length];
        }
        keySegments.push(segment);
    }

    return keySegments.join("-");
}

/**
 * নির্দিষ্ট লেনদেনের ডেটা ভ্যালিডেশনের জন্য HMAC-SHA256 হাশ জেনারেটর
 */
function generateHmacHash(data, secretKey) {
    return crypto.createHmac("sha256", secretKey).update(data).digest("hex");
}

module.exports = {
    generateSessionId,
    generateOnetimeKey,
    generateHmacHash
};

// ================================================
// 💳 PART 13 - Payment Session Generator & DB Schema
// ================================================

const { db } = require("./part-3-firebase-init"); // Adjust path as needed
const { generateSessionId } = require("./part-12-crypto-generators");

/**
 * Creates a unique payment session in Firebase DB.
 * Stores Discord User ID, amount, coupon info, and status.
 * Standard expiration set to 15 minutes to avoid stale sessions.
 */
async function createPaymentSession(userId, amount, couponCode = null) {
    const sessionId = generateSessionId();
    const sessionRef = db.ref(`payment_sessions/${sessionId}`);
    
    const sessionData = {
        sessionId: sessionId,
        userId: userId,
        amount: Number(amount),
        couponCode: couponCode || null,
        status: "PENDING", // PENDING, COMPLETED, EXPIRED
        createdAt: Date.now(),
        expiresAt: Date.now() + (15 * 60 * 1000) // 15 Minutes Lifetime
    };

    await sessionRef.set(sessionData);
    console.log(`✅ Payment Session Created: ${sessionId} for User: ${userId}`);
    
    return sessionData;
}

/**
 * Validates whether a payment session exists and is active.
 */
async function getPaymentSession(sessionId) {
    const snapshot = await db.ref(`payment_sessions/${sessionId}`).once("value");
    if (!snapshot.exists()) return null;
    
    const session = snapshot.val();
    
    // Check expiration
    if (Date.now() > session.expiresAt && session.status === "PENDING") {
        await db.ref(`payment_sessions/${sessionId}`).update({ status: "EXPIRED" });
        session.status = "EXPIRED";
    }

    return session;
}

module.exports = {
    createPaymentSession,
    getPaymentSession
};

// ================================================
// 🔒 PART 14 - Secure Payment Finalizer (Replay Protection)
// ================================================

const { db } = require("./part-3-firebase-init");
const { getPaymentSession } = require("./part-13-payment-session");

/**
 * Validates and finalizes a payment session securely.
 * CRITICAL SECURITY: Immediately removes the session from Firebase upon 
 * verification to enforce single-use tokens and strictly eliminate replay attacks.
 */
async function finalizePaymentSession(sessionId, transactionId, expectedUserId) {
    const sessionRef = db.ref(`payment_sessions/${sessionId}`);
    const session = await getPaymentSession(sessionId);

    // 1. Validate session existence and ownership
    if (!session) {
        return { success: false, reason: "INVALID_SESSION" };
    }

    if (session.userId !== expectedUserId) {
        return { success: false, reason: "UNAUTHORIZED_USER" };
    }

    // 2. Prevent replay attacks or reuse of expired sessions
    if (session.status !== "PENDING") {
        return { success: false, reason: `SESSION_${session.status}` };
    }

    // 3. Record transaction audit log before deleting active session
    const logRef = db.ref(`completed_transactions/${transactionId}`);
    await logRef.set({
        sessionId: sessionId,
        userId: session.userId,
        amount: session.amount,
        couponCode: session.couponCode,
        completedAt: Date.now()
    });

    // 🔒 4. CORE SECURITY STEP: Destroy active session to prevent bypass/reuse
    await sessionRef.remove();
    console.log(`🔒 Session ${sessionId} successfully consumed and removed from DB.`);

    return {
        success: true,
        sessionData: session
    };
}

module.exports = {
    finalizePaymentSession
};

// ================================================
// 🎟️ PART 15 - Coupon Code Validation & Management
// ================================================

const { db } = require("./part-3-firebase-init");

/**
 * Validates a coupon code, checks expiration, usage limits, and calculates discount.
 * 
 * @param {string} couponCode - The coupon code to check.
 * @param {number} originalAmount - Base amount before discount.
 * @returns {Promise<Object>} Verification result with discounted price.
 */
async function validateCoupon(couponCode, originalAmount) {
    if (!couponCode) {
        return { valid: false, finalAmount: originalAmount, reason: "NO_CODE_PROVIDED" };
    }

    const cleanCode = String(couponCode).trim().toUpperCase();
    const couponRef = db.ref(`coupons/${cleanCode}`);
    const snapshot = await couponRef.once("value");

    if (!snapshot.exists()) {
        return { valid: false, finalAmount: originalAmount, reason: "INVALID_COUPON" };
    }

    const coupon = snapshot.val();

    // 1. Check if active
    if (!coupon.active) {
        return { valid: false, finalAmount: originalAmount, reason: "COUPON_INACTIVE" };
    }

    // 2. Check expiration date
    if (coupon.expiresAt && Date.now() > coupon.expiresAt) {
        return { valid: false, finalAmount: originalAmount, reason: "COUPON_EXPIRED" };
    }

    // 3. Check usage limit
    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
        return { valid: false, finalAmount: originalAmount, reason: "USAGE_LIMIT_REACHED" };
    }

    // 4. Calculate discount (Percentage or Flat Amount)
    let discountAmount = 0;

    if (coupon.type === "PERCENTAGE") {
        discountAmount = (originalAmount * Number(coupon.value)) / 100;
    } else if (coupon.type === "FLAT") {
        discountAmount = Number(coupon.value);
    }

    const finalAmount = Math.max(0, originalAmount - discountAmount);

    return {
        valid: true,
        couponCode: cleanCode,
        discountAmount: Math.round(discountAmount),
        finalAmount: Math.round(finalAmount),
        type: coupon.type,
        value: coupon.value
    };
}

/**
 * Increments usage count of a validated coupon code.
 */
async function consumeCoupon(couponCode) {
    if (!couponCode) return;
    const cleanCode = String(couponCode).trim().toUpperCase();
    const couponRef = db.ref(`coupons/${cleanCode}`);

    await couponRef.transaction((currentData) => {
        if (currentData) {
            currentData.usedCount = (currentData.usedCount || 0) + 1;
        }
        return currentData;
    });
}

module.exports = {
    validateCoupon,
    consumeCoupon
};

// ================================================
// 🔑 PART 16 - C++ License Key Generator & Storage
// ================================================

const { db } = require("./part-3-firebase-init");
const { generateOnetimeKey } = require("./part-12-crypto-generators");

/**
 * Generates a single C++ compatible software key, links it to a user,
 * and saves it directly to Firebase database.
 * 
 * @param {string} userId - Discord user ID receiving the key
 * @param {string} productTag - Product identifier (e.g., "PREMIUM_VIP")
 * @param {number} validityDays - Number of days the key remains active
 */
async function generateAndStoreKey(userId, productTag = "GENERAL", validityDays = 30) {
    const rawKey = generateOnetimeKey();
    const formattedKey = `CPP-${productTag}-${rawKey}`;
    
    const keyRef = db.ref(`license_keys/${formattedKey}`);

    const keyPayload = {
        key: formattedKey,
        assignedTo: userId,
        productTag: productTag,
        isActivated: false,
        activatedAt: null,
        createdAt: Date.now(),
        expiresAt: Date.now() + (validityDays * 24 * 60 * 60 * 1000)
    };

    await keyRef.set(keyPayload);
    console.log(`🔑 Key Generated: ${formattedKey} for User: ${userId}`);

    return keyPayload;
}

/**
 * Validates a C++ software key against Firebase database.
 */
async function validateSoftwareKey(keyString) {
    const keyRef = db.ref(`license_keys/${keyString}`);
    const snapshot = await keyRef.once("value");

    if (!snapshot.exists()) {
        return { valid: false, reason: "KEY_NOT_FOUND" };
    }

    const keyData = snapshot.val();

    if (Date.now() > keyData.expiresAt) {
        return { valid: false, reason: "KEY_EXPIRED" };
    }

    return { valid: true, keyData: keyData };
}

module.exports = {
    generateAndStoreKey,
    validateSoftwareKey
};

// ================================================
// 🤖 PART 17 - Discord Client Setup & Core Event Handlers
// ================================================

const { Client, GatewayIntentBits, Partials, Collection } = require("discord.js");

/**
 * Initializes the Discord Client with required Intents and Partials
 * for ticket handling, direct messages, and guild interactions.
 */
function createDiscordClient() {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages
        ],
        partials: [
            Partials.Channel,
            Partials.Message,
            Partials.User,
            Partials.GuildMember
        ]
    });

    // Attach dynamic command/cooldown collections to the client instance
    client.commands = new Collection();
    client.cooldowns = new Collection();

    // Event: Bot Ready
    client.once("ready", (readyClient) => {
        console.log(`🤖 Discord Bot online as: ${readyClient.user.tag}`);
        readyClient.user.setActivity("Secure Transactions", { type: 3 }); // Watching
    });

    // Event: Error Handling
    client.on("error", (error) => {
        console.error("❌ Discord Client Error:", error);
    });

    client.on("warn", (warning) => {
        console.warn("⚠️ Discord Client Warning:", warning);
    });

    return client;
}

module.exports = {
    createDiscordClient
};

// ================================================
// 🎫 PART 18 - Ticket Creation & Channel Provisioning
// ================================================

const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { buildEmbed } = require("./part-10-embed-builder"); // Path adjusted to UI Helpers

/**
 * Creates a private payment ticket channel for a user within the specified category.
 * 
 * @param {import('discord.js').Guild} guild - Target Discord Guild
 * @param {import('discord.js').User} user - User requesting the ticket
 * @param {string} categoryId - Target category channel ID
 * @returns {Promise<import('discord.js').TextChannel>} Created channel instance
 */
async function createPaymentTicket(guild, user, categoryId) {
    const channelName = `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

    // Prevent duplicate open tickets for the same user
    const existingChannel = guild.channels.cache.find(
        (c) => c.name === channelName && c.parentId === categoryId
    );
    if (existingChannel) {
        return existingChannel;
    }

    // Provision new channel with strict access controls
    const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: categoryId,
        permissionOverwrites: [
            {
                id: guild.roles.everyone.id,
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AttachFiles
                ]
            },
            {
                id: guild.members.me.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.EmbedLinks,
                    PermissionFlagsBits.ManageChannels
                ]
            }
        ]
    });

    const welcomeEmbed = buildEmbed({
        title: "🎫 Secure Transaction Ticket",
        description: `Welcome ${user}, your private payment session has been initialized. Please follow the instructions below to proceed with your membership key activation.`,
        color: 0x3498db,
        fields: [
            { name: "User ID", value: user.id, inline: true },
            { name: "Status", value: "Waiting for selection", inline: true }
        ]
    });

    await ticketChannel.send({ embeds: [welcomeEmbed] });
    console.log(`🎟️ Ticket channel provisioned: #${ticketChannel.name} (${ticketChannel.id})`);

    return ticketChannel;
}

module.exports = {
    createPaymentTicket
};

// ================================================
// 🔘 PART 19 - Interactive Button Component Registry
// ================================================

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

/**
 * Builds standard action row containing primary payment trigger buttons.
 * Used inside ticket channels to prompt users for payment processing or cancellation.
 * 
 * @param {string} sessionId - Associated payment session identifier
 * @returns {ActionRowBuilder<ButtonBuilder>}
 */
function buildPaymentActionRow(sessionId) {
    const payButton = new ButtonBuilder()
        .setCustomId(`btn_pay_${sessionId}`)
        .setLabel("Pay Now")
        .setStyle(ButtonStyle.Success)
        .setEmoji("💳");

    const applyCouponButton = new ButtonBuilder()
        .setCustomId(`btn_coupon_${sessionId}`)
        .setLabel("Apply Coupon")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🎟️");

    const cancelButton = new ButtonBuilder()
        .setCustomId(`btn_cancel_${sessionId}`)
        .setLabel("Cancel Ticket")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("✖️");

    return new ActionRowBuilder().addComponents(payButton, applyCouponButton, cancelButton);
}

/**
 * Builds confirmation action row for destroying session/ticket safely.
 * 
 * @param {string} sessionId - Associated payment session identifier
 * @returns {ActionRowBuilder<ButtonBuilder>}
 */
function buildCancelConfirmRow(sessionId) {
    const confirmCancel = new ButtonBuilder()
        .setCustomId(`btn_confirm_cancel_${sessionId}`)
        .setLabel("Confirm Close")
        .setStyle(ButtonStyle.Danger);

    const abortCancel = new ButtonBuilder()
        .setCustomId(`btn_abort_cancel_${sessionId}`)
        .setLabel("Go Back")
        .setStyle(ButtonStyle.Secondary);

    return new ActionRowBuilder().addComponents(confirmCancel, abortCancel);
}

module.exports = {
    buildPaymentActionRow,
    buildCancelConfirmRow
};

// ================================================
// 📝 PART 20 - Modal Window Registry (Coupon & Input Forms)
// ================================================

const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");

/**
 * Builds a modal window for users to enter a coupon code during a payment session.
 * 
 * @param {string} sessionId - Associated payment session identifier
 * @returns {ModalBuilder} Constructed modal instance
 */
function buildCouponModal(sessionId) {
    const modal = new ModalBuilder()
        .setCustomId(`modal_coupon_${sessionId}`)
        .setTitle("Apply Discount Coupon");

    const couponInput = new TextInputBuilder()
        .setCustomId("coupon_code_input")
        .setLabel("ENTER YOUR COUPON CODE")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. SUMMER2026")
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(20);

    const firstActionRow = new ActionRowBuilder().addComponents(couponInput);
    modal.addComponents(firstActionRow);

    return modal;
}

/**
 * Builds a modal window to collect user details or custom transaction notes if required.
 * 
 * @param {string} sessionId - Associated payment session identifier
 * @returns {ModalBuilder} Constructed modal instance
 */
function buildTransactionNoteModal(sessionId) {
    const modal = new ModalBuilder()
        .setCustomId(`modal_note_${sessionId}`)
        .setTitle("Transaction Details");

    const noteInput = new TextInputBuilder()
        .setCustomId("transaction_note_input")
        .setLabel("ADDITIONAL NOTES / ACCOUNT ID")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Enter any relevant information for this transaction...")
        .setRequired(false)
        .setMaxLength(250);

    const actionRow = new ActionRowBuilder().addComponents(noteInput);
    modal.addComponents(actionRow);

    return modal;
}

module.exports = {
    buildCouponModal,
    buildTransactionNoteModal
};

// ================================================
// 🔀 PART 21 - Interaction Create Event Router
// ================================================

/**
 * Main interaction handler that routes Slash Commands, Button Clicks,
 * and Modal Submissions to their respective controllers.
 * 
 * @param {import('discord.js').Interaction} interaction 
 * @param {import('discord.js').Client} client 
 */
async function handleInteraction(interaction, client) {
    try {
        // 1. Handle Slash Commands
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) {
                console.warn(`⚠️ Command not found: ${interaction.commandName}`);
                return interaction.reply({ content: "Unknown command.", flags: 64 }); // 64 = Ephemeral
            }

            await command.execute(interaction, client);
            return;
        }

        // 2. Handle Button Component Interactions
        if (interaction.isButton()) {
            const { handleButtonInteraction } = require("./part-22-button-handler");
            await handleButtonInteraction(interaction, client);
            return;
        }

        // 3. Handle Modal Submissions
        if (interaction.isModalSubmit()) {
            const { handleModalSubmit } = require("./part-23-modal-handler");
            await handleModalSubmit(interaction, client);
            return;
        }

    } catch (error) {
        console.error(`❌ Error routing interaction [${interaction.id}]:`, error);
        
        const errorMessage = {
            content: "An error occurred while processing your request.",
            flags: 64
        };

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage).catch(() => {});
        } else {
            await interaction.reply(errorMessage).catch(() => {});
        }
    }
}

module.exports = {
    handleInteraction
};

// ================================================
// 🔘 PART 22 - Button Interaction Controller
// ================================================

const { buildCouponModal } = require("./part-20-modal-registry");
const { buildCancelConfirmRow, buildPaymentActionRow } = require("./part-19-button-registry");
const { getPaymentSession } = require("./part-13-payment-session");
const { buildEmbed } = require("./part-10-embed-builder");

/**
 * Handles all button interactions dynamically based on customId prefix.
 * 
 * @param {import('discord.js').ButtonInteraction} interaction 
 * @param {import('discord.js').Client} client 
 */
async function handleButtonInteraction(interaction, client) {
    const { customId } = interaction;

    // Parse button custom ID format: btn_<action>_<sessionId>
    const match = customId.match(/^btn_([a_z_]+)_(.+)$/);
    if (!match) return;

    const [, action, sessionId] = match;

    switch (action) {
        case "pay": {
            await interaction.deferReply({ flags: 64 });
            const session = await getPaymentSession(sessionId);

            if (!session || session.status !== "PENDING") {
                return interaction.editReply({
                    content: "❌ This payment session is invalid or has expired."
                });
            }

            const paymentEmbed = buildEmbed({
                title: "💳 Complete Your Payment",
                description: `Click the link below to process your payment securely.\n\n**Amount Due:** $${session.amount}`,
                color: 0x2ecc71,
                fields: [
                    { name: "Session ID", value: session.sessionId, inline: true },
                    { name: "Status", value: session.status, inline: true }
                ]
            });

            return interaction.editReply({ embeds: [paymentEmbed] });
        }

        case "coupon": {
            const modal = buildCouponModal(sessionId);
            return interaction.showModal(modal);
        }

        case "cancel": {
            const confirmEmbed = buildEmbed({
                title: "⚠️ Cancel Ticket",
                description: "Are you sure you want to cancel this ticket and invalidate the active payment session?",
                color: 0xe74c3c
            });

            return interaction.reply({
                embeds: [confirmEmbed],
                components: [buildCancelConfirmRow(sessionId)],
                flags: 64
            });
        }

        case "confirm_cancel": {
            await interaction.reply({ content: "🔒 Closing ticket and cleaning session data..." });
            
            // Channel deletion after brief delay
            setTimeout(() => {
                interaction.channel?.delete().catch(console.error);
            }, 3000);
            return;
        }

        case "abort_cancel": {
            return interaction.update({
                content: "✅ Ticket cancellation aborted.",
                embeds: [],
                components: []
            });
        }

        default:
            console.warn(`⚠️ Unhandled button action: ${action}`);
    }
}

module.exports = {
    handleButtonInteraction
};

// ================================================
// 📝 PART 23 - Modal Submission Handler
// ================================================

const { getPaymentSession } = require("./part-13-payment-session");
const { validateCoupon } = require("./part-15-coupon-validator");
const { buildEmbed } = require("./part-10-embed-builder");
const { buildPaymentActionRow } = require("./part-19-button-registry");
const { db } = require("./part-3-firebase-init");

/**
 * Handles all Modal Submission interactions.
 * 
 * @param {import('discord.js').ModalSubmitInteraction} interaction 
 * @param {import('discord.js').Client} client 
 */
async function handleModalSubmit(interaction, client) {
    const { customId } = interaction;

    // Parse modal custom ID format: modal_<type>_<sessionId>
    const match = customId.match(/^modal_([a_z_]+)_(.+)$/);
    if (!match) return;

    const [, type, sessionId] = match;

    if (type === "coupon") {
        await interaction.deferReply({ flags: 64 });

        const rawCouponInput = interaction.fields.getTextInputValue("coupon_code_input");
        const session = await getPaymentSession(sessionId);

        if (!session || session.status !== "PENDING") {
            return interaction.editReply({
                content: "❌ Invalid or expired payment session."
            });
        }

        // Validate coupon against Firebase records
        const result = await validateCoupon(rawCouponInput, session.amount);

        if (!result.valid) {
            const errorMessages = {
                INVALID_COUPON: "❌ The entered coupon code does not exist.",
                COUPON_INACTIVE: "⚠️ This coupon is currently disabled.",
                COUPON_EXPIRED: "⏳ This coupon code has expired.",
                USAGE_LIMIT_REACHED: "🚫 This coupon has reached its maximum redemptions."
            };

            return interaction.editReply({
                content: errorMessages[result.reason] || "❌ Failed to apply coupon."
            });
        }

        // Update active session with discounted total
        await db.ref(`payment_sessions/${sessionId}`).update({
            amount: result.finalAmount,
            couponCode: result.couponCode,
            discountApplied: result.discountAmount
        });

        const updatedEmbed = buildEmbed({
            title: "🎟️ Discount Applied Successfully!",
            description: `Coupon **${result.couponCode}** applied to session.`,
            color: 0x2ecc71,
            fields: [
                { name: "Original Price", value: `$${session.amount}`, inline: true },
                { name: "Discount", value: `-$${result.discountAmount}`, inline: true },
                { name: "New Total", value: `$${result.finalAmount}`, inline: true }
            ]
        });

        return interaction.editReply({ embeds: [updatedEmbed] });
    }

    if (type === "note") {
        await interaction.deferReply({ flags: 64 });

        const noteText = interaction.fields.getTextInputValue("transaction_note_input");
        
        await db.ref(`payment_sessions/${sessionId}`).update({
            userNote: noteText || null,
            updatedAt: Date.now()
        });

        return interaction.editReply({
            content: "✅ Transaction note saved to session records."
        });
    }

    console.warn(`⚠️ Unhandled modal submission type: ${type}`);
}

module.exports = {
    handleModalSubmit
};

// ================================================
// 📜 PART 24 - Slash Command Builders & Definitions
// ================================================

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

/**
 * Registry of Application Commands (Slash Commands)
 * Defines the structural schema for client deployment.
 */
const commands = [
    // 1. Core User Command: Open Payment Ticket
    new SlashCommandBuilder()
        .setName("buy")
        .setDescription("Initialize a secure private payment ticket for key activation")
        .addStringOption((option) =>
            option
                .setName("tier")
                .setDescription("Select membership tier")
                .setRequired(true)
                .addChoices(
                    { name: "VIP Monthly - $15", value: "TIER_VIP_MONTHLY" },
                    { name: "VIP Lifetime - $50", value: "TIER_VIP_LIFETIME" }
                )
        ),

    // 2. Admin Command: Manual Key Generation
    new SlashCommandBuilder()
        .setName("genkey")
        .setDescription("Admin: Generate a 1-time C++ activation key for a user")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) =>
            option
                .setName("target")
                .setDescription("The user who will receive the key")
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName("product")
                .setDescription("Product identification tag")
                .setRequired(false)
        )
        .addIntegerOption((option) =>
            option
                .setName("days")
                .setDescription("Key validity duration in days")
                .setRequired(false)
        ),

    // 3. Admin Command: Create Coupon Code
    new SlashCommandBuilder()
        .setName("createcoupon")
        .setDescription("Admin: Register a new discount coupon in Firebase")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
            option
                .setName("code")
                .setDescription("Coupon code (e.g. PROMO2026)")
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName("type")
                .setDescription("Discount type")
                .setRequired(true)
                .addChoices(
                    { name: "Percentage (%)", value: "PERCENTAGE" },
                    { name: "Flat Amount ($)", value: "FLAT" }
                )
        )
        .addNumberOption((option) =>
            option
                .setName("value")
                .setDescription("Discount value (e.g., 20 for 20% or $20)")
                .setRequired(true)
        )
        .addIntegerOption((option) =>
            option
                .setName("max_uses")
                .setDescription("Maximum allowable redemptions")
                .setRequired(false)
        )
];

module.exports = {
    commandsData: commands.map((cmd) => cmd.toJSON()),
    commands
};

// ================================================
// 🛒 PART 25 - Buy Command Execution Logic
// ================================================

const { createPaymentTicket } = require("./part-18-ticket-creation");
const { createPaymentSession } = require("./part-13-payment-session");
const { buildPaymentActionRow } = require("./part-19-button-registry");
const { buildEmbed } = require("./part-10-embed-builder");
const { CATEGORY_IDS } = require("./part-7-channel-mapping");

// Tier price and tag mapping
const TIER_CONFIG = {
    TIER_VIP_MONTHLY: { name: "VIP Monthly Pass", price: 15, tag: "VIP_1M" },
    TIER_VIP_LIFETIME: { name: "VIP Lifetime Access", price: 50, tag: "VIP_LIFE" }
};

/**
 * Executes the /buy slash command logic.
 * Initializes private channel and payment session in Firebase.
 * 
 * @param {import('discord.js').ChatInputCommandInteraction} interaction 
 * @param {import('discord.js').Client} client 
 */
async function executeBuyCommand(interaction, client) {
    await interaction.deferReply({ flags: 64 });

    const selectedTierKey = interaction.options.getString("tier");
    const tierConfig = TIER_CONFIG[selectedTierKey];

    if (!tierConfig) {
        return interaction.editReply({ content: "❌ Invalid tier selection." });
    }

    try {
        // 1. Provision private ticket channel in designated category
        const ticketCategoryId = CATEGORY_IDS.PAYMENT_TICKETS;
        const ticketChannel = await createPaymentTicket(
            interaction.guild,
            interaction.user,
            ticketCategoryId
        );

        // 2. Initialize active payment session in Firebase Realtime DB
        const session = await createPaymentSession(interaction.user.id, tierConfig.price);

        // 3. Construct checkout interface
        const actionRow = buildPaymentActionRow(session.sessionId);
        const checkoutEmbed = buildEmbed({
            title: `🛒 ${tierConfig.name} Checkout`,
            description: `Active checkout session initialized for ${interaction.user}.\n\n` +
                         `**Item:** ${tierConfig.name}\n` +
                         `**Amount Due:** $${tierConfig.price}\n` +
                         `**Session ID:** \`${session.sessionId}\`\n\n` +
                         `*Use the controls below to complete payment or redeem a discount coupon.*`,
            color: 0x3498db
        });

        // 4. Dispatch transaction portal into ticket channel
        await ticketChannel.send({
            content: `<@${interaction.user.id}>`,
            embeds: [checkoutEmbed],
            components: [actionRow]
        });

        // 5. Notify user with direct channel link
        return interaction.editReply({
            content: `✅ Ticket initialized successfully! Proceed to ${ticketChannel} to complete purchase.`
        });

    } catch (error) {
        console.error("❌ Error executing /buy command:", error);
        return interaction.editReply({
            content: "❌ An error occurred while creating your ticket. Please contact support."
        });
    }
}

module.exports = {
    executeBuyCommand
};

// ================================================
// ⚙️ PART 26 - Admin Command Controller Handlers
// ================================================

const { generateLicenseKey } = require("./part-16-license-generator");
const { buildEmbed } = require("./part-10-embed-builder");
const { db } = require("./part-3-firebase-init");

/**
 * Handles execution of the `/genkey` admin slash command.
 * Generates an HMAC-signed license key for a target user.
 * 
 * @param {import('discord.js').ChatInputCommandInteraction} interaction 
 */
async function executeGenKeyCommand(interaction) {
    await interaction.deferReply({ flags: 64 });

    const targetUser = interaction.options.getUser("target", true);
    const productTag = interaction.options.getString("product") || "VIP_GENERAL";
    const durationDays = interaction.options.getInteger("days") || 30;

    try {
        // Generate single-use key with HMAC signature
        const keyData = await generateLicenseKey(targetUser.id, productTag, durationDays);

        const responseEmbed = buildEmbed({
            title: "🔑 License Key Generated",
            description: `Successfully generated license key for ${targetUser}.`,
            color: 0x2ecc71,
            fields: [
                { name: "Target User", value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true },
                { name: "Product Tag", value: productTag, inline: true },
                { name: "Validity", value: `${durationDays} Days`, inline: true },
                { name: "Generated Key", value: `\`\`\`${keyData.key}\`\`\``, inline: false }
            ]
        });

        return interaction.editReply({ embeds: [responseEmbed] });
    } catch (error) {
        console.error("❌ Error generating manual license key:", error);
        return interaction.editReply({ content: "❌ Failed to generate key due to database error." });
    }
}

/**
 * Handles execution of the `/createcoupon` admin slash command.
 * Registers a new discount coupon inside Firebase Realtime Database.
 * 
 * @param {import('discord.js').ChatInputCommandInteraction} interaction 
 */
async function executeCreateCouponCommand(interaction) {
    await interaction.deferReply({ flags: 64 });

    const code = interaction.options.getString("code", true).toUpperCase().trim();
    const type = interaction.options.getString("type", true);
    const value = interaction.options.getNumber("value", true);
    const maxUses = interaction.options.getInteger("max_uses") || -1; // -1 = Unlimited

    try {
        const couponRef = db.ref(`coupons/${code}`);
        const snapshot = await couponRef.once("value");

        if (snapshot.exists()) {
            return interaction.editReply({ content: `❌ Coupon code **${code}** already exists.` });
        }

        const couponData = {
            code,
            type,
            value,
            maxUses,
            usedCount: 0,
            active: true,
            createdAt: Date.now(),
            createdBy: interaction.user.id
        };

        await couponRef.set(couponData);

        const responseEmbed = buildEmbed({
            title: "🎟️ Coupon Created Successfully",
            description: `New coupon code **${code}** registered in DB.`,
            color: 0x9b59b6,
            fields: [
                { name: "Code", value: `\`${code}\``, inline: true },
                { name: "Type", value: type, inline: true },
                { name: "Value", value: type === "PERCENTAGE" ? `${value}%` : `$${value}`, inline: true },
                { name: "Max Uses", value: maxUses === -1 ? "Unlimited" : `${maxUses}`, inline: true }
            ]
        });

        return interaction.editReply({ embeds: [responseEmbed] });
    } catch (error) {
        console.error("❌ Error creating coupon:", error);
        return interaction.editReply({ content: "❌ Failed to create coupon." });
    }
}

module.exports = {
    executeGenKeyCommand,
    executeCreateCouponCommand
};

// ================================================
// 💳 PART 27 - Webhook Payment Receiver & Verification
// ================================================

const crypto = require("crypto");
const { getPaymentSession } = require("./part-13-payment-session");
const { fulfillPaymentTransaction } = require("./part-28-fulfill-transaction");

const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || "default_webhook_secret_key";

/**
 * Verifies the HMAC-SHA256 signature of incoming payment gateway webhooks.
 * 
 * @param {string} payloadRaw - Raw body string received in the HTTP request
 * @param {string} signature - Header signature string from payment provider
 * @returns {boolean} True if signature matches
 */
function verifyWebhookSignature(payloadRaw, signature) {
    if (!signature) return false;

    try {
        const expectedSignature = crypto
            .createHmac("sha256", WEBHOOK_SECRET)
            .update(payloadRaw)
            .digest("hex");

        const sigBuffer = Buffer.from(signature, "hex");
        const expectedBuffer = Buffer.from(expectedSignature, "hex");

        if (sigBuffer.length !== expectedBuffer.length) return false;

        return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    } catch (error) {
        console.error("❌ Error calculating signature comparison:", error);
        return false;
    }
}

/**
 * Express middleware route handler for processing external payment webhooks.
 * 
 * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 */
async function handlePaymentWebhook(req, res) {
    const signature = req.headers["x-signature"] || req.headers["x-hub-signature-256"];
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);

    // 1. Verify HMAC Signature payload integrity
    if (!verifyWebhookSignature(rawBody, signature)) {
        console.warn("⚠️ Invalid payment webhook signature attempt.");
        return res.status(401).json({ error: "Unauthorized: HMAC Signature mismatch" });
    }

    const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { event, sessionId, transactionId, status } = payload;

    if (event !== "payment.success" || status !== "COMPLETED") {
        return res.status(200).json({ status: "ignored", message: "Event ignored - status not completed" });
    }

    try {
        // 2. Fetch active session record from Firebase Realtime DB
        const session = await getPaymentSession(sessionId);

        if (!session) {
            console.error(`❌ Webhook error: Session ${sessionId} non-existent or expired.`);
            return res.status(404).json({ error: "Session non-existent or expired" });
        }

        if (session.status !== "PENDING") {
            console.warn(`⚠️ Duplicate webhook ignored: Session ${sessionId} status is ${session.status}`);
            return res.status(400).json({ error: "Session already fulfilled or invalidated" });
        }

        // 3. Delegate to Destroy-on-Use fulfillment controller
        const client = req.app.get("discordClient");
        const result = await fulfillPaymentTransaction(sessionId, transactionId, client);

        return res.status(200).json({
            success: true,
            message: "Fulfillment executed successfully. Session destroyed.",
            transactionId: result.transactionId
        });

    } catch (error) {
        console.error(`❌ Processing error on session [${sessionId}]:`, error);
        return res.status(500).json({ error: "Internal server error during fulfillment processing" });
    }
}

module.exports = {
    verifyWebhookSignature,
    handlePaymentWebhook
};


// ================================================
// 💣 PART 28 - Destroy-On-Use Core Execution & DM Delivery
// ================================================

const { db } = require("./part-3-firebase-init");
const { generateLicenseKey } = require("./part-16-license-generator");
const { buildEmbed } = require("./part-10-embed-builder");

/**
 * Fulfills a completed transaction:
 * 1. Generates license key
 * 2. Delivers key securely via Discord Direct Message
 * 3. Immediately purges active payment session data from DB (Destroy-on-Use)
 * 4. Logs historical transaction audit record
 * 
 * @param {string} sessionId - Active payment session ID
 * @param {string} transactionId - External gateway transaction reference
 * @param {import('discord.js').Client} client - Discord client instance
 * @returns {Promise<{ success: boolean, transactionId: string }>}
 */
async function fulfillPaymentTransaction(sessionId, transactionId, client) {
    const sessionRef = db.ref(`payment_sessions/${sessionId}`);
    const snapshot = await sessionRef.once("value");

    if (!snapshot.exists()) {
        throw new Error(`Session ${sessionId} not found during fulfillment execution.`);
    }

    const session = snapshot.val();
    const { userId, amount, couponCode } = session;

    // 1. Generate license key for target user
    const keyData = await generateLicenseKey(userId, "VIP_ACCESS", 30);

    // 2. Archive completed transaction to audit log
    const auditRecord = {
        sessionId,
        transactionId,
        userId,
        amount,
        couponCode: couponCode || null,
        licenseKey: keyData.key,
        completedAt: Date.now()
    };

    await db.ref(`completed_transactions/${transactionId}`).set(auditRecord);

    // 3. Update coupon usage count if applied
    if (couponCode) {
        const couponRef = db.ref(`coupons/${couponCode}`);
        await couponRef.child("usedCount").transaction((count) => (count || 0) + 1);
    }

    // 4. 🔥 DESTROY ON USE: Immediately purge active session to prevent replay attacks
    await sessionRef.remove();

    // 5. Send license key via Direct Message
    try {
        const user = await client.users.fetch(userId);
        const dmEmbed = buildEmbed({
            title: "🎉 Payment Successful - License Delivery",
            description: `Thank you for your purchase! Here is your activation key.\n\n` +
                         `**License Key:**\n\`\`\`${keyData.key}\`\`\`\n` +
                         `*Keep this key safe. Do not share it with anyone.*`,
            color: 0x2ecc71,
            fields: [
                { name: "Transaction ID", value: `\`${transactionId}\``, inline: true },
                { name: "Amount Paid", value: `$${amount}`, inline: true },
                { name: "Expires In", value: "30 Days", inline: true }
            ]
        });

        await user.send({ embeds: [dmEmbed] });
    } catch (error) {
        console.error(`⚠️ Could not send DM to user ${userId}:`, error);
    }

    return {
        success: true,
        transactionId
    };
}

module.exports = {
    fulfillPaymentTransaction
};

// ================================================
// 🔗 PART 29 - Express Webhook Route Binding & Integration
// ================================================

const express = require("express");
const { handlePaymentWebhook } = require("./part-27-payment-webhook");

/**
 * Mounts payment webhook routes and required raw body parsing middleware 
 * to the provided Express application instance.
 * 
 * @param {import('express').Application} app - Express application instance
 * @param {import('discord.js').Client} client - Discord client instance
 */
function setupPaymentRoutes(app, client) {
    // Store Discord client in Express app context for access in route controllers
    app.set("discordClient", client);

    // 1. Raw body parser specifically for signature verification on webhook endpoints
    const rawBodyParser = express.raw({ type: "application/json" });

    // 2. Webhook receiver endpoint
    app.post(
        "/api/v1/payments/webhook",
        rawBodyParser,
        (req, res, next) => {
            // Convert Buffer to UTF-8 string if raw body parser was executed
            if (Buffer.isBuffer(req.body)) {
                req.body = req.body.toString("utf8");
            }
            next();
        },
        handlePaymentWebhook
    );

    // 3. Health check route for gateway monitoring
    app.get("/api/v1/health", (req, res) => {
        res.status(200).json({ status: "healthy", timestamp: Date.now() });
    });
}

module.exports = {
    setupPaymentRoutes
};

// ================================================
// 🚀 PART 30 - Main Application Entrypoint & Initialization
// ================================================

require("dotenv").config();
const express = require("express");
const { Client, GatewayIntentBits, Collection, REST, Routes } = require("discord.js");
const { handleInteraction } = require("./part-21-interaction-router");
const { executeBuyCommand } = require("./part-25-buy-command");
const { executeGenKeyCommand, executeCreateCouponCommand } = require("./part-26-admin-commands");
const { commandsData } = require("./part-24-command-builder");
const { setupPaymentRoutes } = require("./part-29-route-binding");
const { initSessionCleanupCron } = require("./part-32-session-cleanup");

// 1. Initialize Express Web Server
const app = express();
const PORT = process.env.PORT || 3000;

// 2. Initialize Discord Client Instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages
    ]
});

// Command Collection Registry
client.commands = new Collection();

// Register Slash Command Handlers
client.commands.set("buy", { execute: executeBuyCommand });
client.commands.set("genkey", { execute: executeGenKeyCommand });
client.commands.set("createcoupon", { execute: executeCreateCouponCommand });

// 3. Register Slash Commands with Discord REST API
async function registerSlashCommands() {
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);
    try {
        console.log("⏳ Deploying application (slash) commands...");
        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commandsData }
        );
        console.log("✅ Slash commands successfully registered globally!");
    } catch (error) {
        console.error("❌ Failed to register slash commands:", error);
    }
}

// 4. Client Ready Event Listener
client.once("ready", async () => {
    console.log(`🤖 Bot online as ${client.user.tag}`);
    await registerSlashCommands();
    initSessionCleanupCron();
});

// 5. Interaction Router Gateway Listener
client.on("interactionCreate", async (interaction) => {
    await handleInteraction(interaction, client);
});

// 6. Mount Express Payment Routes
setupPaymentRoutes(app, client);

// 7. Start Express Server & Connect Discord Client
app.listen(PORT, () => {
    console.log(`🌐 Express webhook server running on port ${PORT}`);
});

client.login(process.env.DISCORD_BOT_TOKEN).catch((err) => {
    console.error("❌ Error authenticating Discord client:", err);
});

