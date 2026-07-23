// ================================
// 🚀 PART 1 - Setup + Express + Firebase + Config
// ================================

const express = require("express");
const fs = require("fs");
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
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require("discord.js");

// html-transcripts ইম্পোর্ট
const discordTranscripts = require("discord-html-transcripts");

// রেনডার Environment Variable থেকে অবজেক্ট লোড করার লজিক
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

// ফায়ারবেস ইনিশিয়ালাইজেশন
const firebaseURL = process.env.FIREBASE_DB_URL || "YOUR_FIREBASE_DATABASE_URL";
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: firebaseURL
});
const db = admin.database();

const app = express();
app.get("/", (req, res) => { res.send("Bot is running!"); });
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🌐 Web server running on port ${PORT}`); });

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

const ROLES = {
    ADMIN: "1488332568372973568", 
    SUPPORT_TICKET_REPORT: "1488333580705861765", 
    SUPPORT_CUSTOMER: "1488335064873046086" 
};

const CHANNELS = {
    TICKET_PANEL: "1488339982627115118",
    REPORT_PANEL: "1488340441115004999",
    CUSTOMER_PANEL: "1488340017938960484",
    BUY_PANEL: "1488339666368462858", 
    PAYMENT_PANEL: "1488333503761219746" 
};

const COVER_IMAGES = {
    VERIFY: "https://cdn.discordapp.com/attachments/1488338142607184055/1488761437550678056/5cfd1fe4-d12c-4439-b374-f386f7595184.png",
    TICKET: "https://cdn.discordapp.com/attachments/1488338142607184055/1488761437550678056/5cfd1fe4-d12c-4439-b374-f386f7595184.png", 
    REPORT: "https://cdn.discordapp.com/attachments/1488338142607184055/1488761437550678056/5cfd1fe4-d12c-4439-b374-f386f7595184.png",
    CUSTOMER: "https://cdn.discordapp.com/attachments/1488338142607184055/1488761437550678056/5cfd1fe4-d12c-4439-b374-f386f7595184.png",
    PAYMENT: "https://cdn.discordapp.com/attachments/1488338142607184055/1488761437550678056/5cfd1fe4-d12c-4439-b374-f386f7595184.png"
};

const BAD_WORDS = ["gali1", "gali2", "gali3", "khanki", "magi", "baimon"]; 

// Package Base Prices
const PACKAGE_PRICES = {
    weekly: 510,
    monthly: 1510,
    "2_months": 2410
};

const PAYMENT_NUMBER = "01404548951";

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

process.on("unhandledRejection", (err) => { console.error("[Unhandled Rejection]", err); });
process.on("uncaughtException", (err) => { console.error("[Uncaught Exception]", err); });

// 🎲 ইউনিক কুপন কোড জেনারেটর (e.g., AK-A1B2C3)
function generateUniqueCouponCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "AK-";
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Firebase থেকে ডেটা নিয়ে আসার ফিক্সড ফাংশন
async function fetchFirebasePanelData(panelType) {
    try {
        const snapshot = await db.ref(`panels/${panelType}`).once("value");
        const data = snapshot.val() || {};
        
        const customDescription = data.description || null;
        const customImage = data.image || null;

        let options = [];

        // যদি অপশন অবজেক্ট ম্যাপ করা থাকে
        if (data.options && typeof data.options === "object") {
            options = Object.keys(data.options).map(key => ({
                label: String(data.options[key]),
                value: String(key)
            }));
        } else {
            // ফ্ল্যাট কি-ভ্যালু পেয়ার সঠিক কি (Key) এবং লেবেল ধরে ফেচ করা
            options = Object.keys(data)
                .filter(key => !["description", "image", "title", "options"].includes(key))
                .map(key => ({
                    label: String(data[key]),
                    value: String(key)
                }));
        }

        if (options.length === 0) {
            options.push({ label: "No Options Found in DB", value: "none" });
        }

        return { options, customDescription, customImage, fullData: data };
    } catch (error) {
        console.error(`❌ Firebase Panel Data Fetch Error (${panelType}):`, error);
        return { 
            options: [{ label: "Error Loading from Database", value: "error" }], 
            customDescription: null, 
            customImage: null,
            fullData: {}
        };
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

// Ghost Ping ট্র্যাকিং
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
    const xpRef = db.ref(`leveling/${userId}`);
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

    // লাইভ লিংক রেসপন্স
    if (contentLower.includes("link") || contentLower.includes("লিংক") || contentLower.includes("লিঙ্ক")) {
        try {
            const snapshot = await db.ref("settings/verification_link").once("value");
            const dbLink = snapshot.val() || "কোনো লিংক ফায়ারবেসে পাওয়া যায়নি।";
            return message.reply(`👋 আপনি কি সার্ভার বা ভেরিফিকেশন লিংক খুঁজছেন? এই নিন আমাদের লাইভ লিংক:\n\`${dbLink}\``);
        } catch (err) {}
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
        let warns = (userWarns.get(userId) || 0) + 1; userWarns.set(userId, warns);
        if (warns < 3) {
            const warnEmbed = new EmbedBuilder().setColor("Yellow").setDescription(`⚠️ <@${userId}>, সার্ভারে **${reason}** নিষিদ্ধ! আপনি এটি **${warns}/৩** বার করেছেন।`);
            const warnMsg = await message.channel.send({ embeds: [warnEmbed] }); setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
        } else {
            userWarns.set(userId, 0); savePunishment(userId, "Muted", 10 * 60 * 1000); 
            try { await message.member.timeout(10 * 60 * 1000, "Automod: Limit Exceeded"); const muteEmbed = new EmbedBuilder().setColor("Red").setTitle("🚫 মেম্বার মিউটেড").setDescription(`<@${userId}> কে ১০ মিনিটের জন্য মিউট করা হয়েছে।`); await message.channel.send({ embeds: [muteEmbed] }); } catch (err) {}
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

            const logs = getWelcomeLogs(); const userLog = logs[interaction.user.id]; const welcomeChannel = interaction.guild.channels.cache.get(WELCOME_CHANNEL_ID);
            if (userLog && welcomeChannel) { try { const msg = await welcomeChannel.messages.fetch(userLog.messageId); if (msg) { const updatedEmbed = buildDynamicWelcomeEmbed(interaction.member, "verified", userLog.isOffline, Date.now()); await msg.edit({ embeds: [updatedEmbed] }); } } catch (e) {} }
        } catch (err) { console.error(err); }
        return;
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

    // ড্রপডাউন সিলেকশন হ্যান্ডলার (ফিক্সড Value Reading)
    if (interaction.isStringSelectMenu() && (interaction.customId.startsWith("select_product_") || interaction.customId.startsWith("select_report_") || interaction.customId.startsWith("select_customer_") || interaction.customId.startsWith("select_buy_"))) {
        const value = interaction.values[0].toLowerCase();
        if (value === "none" || value === "error") return interaction.reply({ content: "❌ অবৈধ অপশন!", flags: [MessageFlags.Ephemeral] });

        let type = ""; let embedColor = ""; let buttonId = "";
        if (interaction.customId === "select_product_ticket") { type = "ticket"; embedColor = "#5865F2"; buttonId = `create_ticket_${value}`; }
        else if (interaction.customId === "select_report_category") { type = "report"; embedColor = "#ED4245"; buttonId = `create_report_${value}`; }
        else if (interaction.customId === "select_customer_category") { type = "customer"; embedColor = "#57F287"; buttonId = `create_customer_${value}`; }
        else if (interaction.customId === "select_buy_category") { type = "order"; embedColor = "#9B59B6"; buttonId = `pay_gateway_${value}`; } 

        if (type === "order") {
            const modal = new ModalBuilder().setCustomId(`modal_coupon_${value}`).setTitle("🎟️ Coupon / Discount Code");
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

    // ================================
    // 📩 1. Coupon Modal Submit & Validation Logic
    // ================================
    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_coupon_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const category = interaction.customId.split("_")[2].toLowerCase();
        const couponEntered = interaction.fields.getTextInputValue("coupon_code_input").trim().toUpperCase();
        const userId = interaction.user.id;
        
        let basePrice = PACKAGE_PRICES[category] || 510;
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

                if (couponData.status === "used") {
                    discountText = "❌ **কুপন কোডটি ইতোমধ্যে ব্যবহার করা হয়েছে!** মূল মূল্য প্রযোজ্য হবে।";
                } else if (couponData.expiresAt && couponData.expiresAt < now) {
                    await couponRef.update({ status: "expired" });
                    discountText = "❌ **কুপন কোডটির মেয়াদ শেষ হয়ে গেছে!** মূল মূল্য প্রযোজ্য হবে।";
                } else if (couponData.status === "active") {
                    appliedDiscountValue = Number(couponData.couponValue || couponData.discountValue || 0);
                    finalPrice = Math.max(0, basePrice - appliedDiscountValue);
                    appliedCouponCode = couponEntered;

                    discountText = `🎉 **কুপন কোড \`${couponEntered}\` সফলভাবে অ্যাপ্লাই হয়েছে!**\n` +
                                   `💸 **ছাড়ের পরিমাণ:** \`${appliedDiscountValue}\` ৳\n` +
                                   `🏷️ **নতুন পরিশোধযোগ্য মূল্য:** \`${finalPrice}\` ৳`;
                }
            } else {
                discountText = "⚠️ **অবৈধ কুপন কোড!** সিস্টেমের ডেটাবেজে এই কুপন পাওয়া যায়নি। মূল মূল্য প্রযোজ্য হবে।";
            }
        }

        // পেন্ডিং সেশনে ট্র্যাকিং সেভ করা
        await db.ref(`pending_payments/${userId}_${category}`).set({
            targetPrice: finalPrice,
            basePrice: basePrice,
            appliedCoupon: appliedCouponCode,
            appliedDiscount: appliedDiscountValue,
            totalPaid: 0,
            usedTxns: []
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

    // ================================
    // 🔘 2. Submit TxnID Button Click
    // ================================
    if (interaction.isButton() && interaction.customId.startsWith("submit_txn_")) {
        const category = interaction.customId.split("_")[2].toLowerCase();
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

    // ================================
    // 🔄 3. Process TxnID & Auto Extra Payment Coupon
    // ================================
    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_txn_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        
        const category = interaction.customId.split("_")[2].toLowerCase();
        const txnId = interaction.fields.getTextInputValue("txn_id_input").trim();
        const userId = interaction.user.id;
        const sessionRef = db.ref(`pending_payments/${userId}_${category}`);

        try {
            // 🔍 ১. Transaction ID যাচাইকরণ
            const txnRef = db.ref(`transactions/${txnId}`);
            const txnSnap = await txnRef.once("value");

            if (!txnSnap.exists()) {
                return interaction.editReply("❌ **অকার্যকর Transaction ID!** সিস্টেমের ডেটাবেজে এই Transaction ID পাওয়া যায়নি।");
            }

            const txnData = txnSnap.val();

            if (txnData.used === true) {
                return interaction.editReply("🚫 **Duplicate Transaction!** এই Transaction ID-টি ইতোমধ্যে ব্যবহার করা হয়েছে।");
            }

            const sessionSnap = await sessionRef.once("value");
            let sessionData = sessionSnap.val() || {};

            let targetPrice = sessionData.targetPrice !== undefined ? sessionData.targetPrice : (PACKAGE_PRICES[category] || 510);
            let currentTotalPaid = sessionData.totalPaid || 0;
            let usedTxns = sessionData.usedTxns || [];

            if (usedTxns.includes(txnId)) {
                return interaction.editReply("⚠️ এই Transaction ID-টি আপনি ইতোমধ্যে সাবমিট করেছেন।");
            }

            const newTxnAmount = Number(txnData.amount) || 0;
            currentTotalPaid += newTxnAmount;
            usedTxns.push(txnId);

            // TxnID used হিসেবে আপডেট
            await txnRef.update({
                used: true,
                usedBy: userId,
                usedAt: Date.now()
            });

            // পেন্ডিং সেশনে আপডেট
            await sessionRef.update({
                category: category,
                targetPrice: targetPrice,
                totalPaid: currentTotalPaid,
                usedTxns: usedTxns,
                lastUpdated: Date.now()
            });

            // ❌ আংশিক পেমেন্ট হলে
            if (currentTotalPaid < targetPrice) {
                const remainingDue = targetPrice - currentTotalPaid;

                const pendingEmbed = new EmbedBuilder()
                    .setTitle("❌ Payment Verification Pending (আংশিক পেমেন্ট)")
                    .setDescription(
                        `আপনি **${category.toUpperCase()}** প্যাকেজ নির্বাচন করেছেন।\n\n` +
                        `📌 **প্রয়োজনীয় মূল্য:** \`${targetPrice}\` BDT\n` +
                        `💳 **প্রাপ্ত মোট টাকা:** \`${currentTotalPaid}\` BDT\n` +
                        `📉 **বকেয়া টাকা:** \`${remainingDue}\` BDT\n\n` +
                        `⚠️ অবশিষ্ট **${remainingDue} BDT** নিচের নম্বরে পাঠিয়ে নতুন Transaction ID সাবমিট করুন:\n` +
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

            // 🎁 ২. অতিরিক্ত টাকা দিলে Auto Coupon Generation
            let extraPayment = currentTotalPaid - targetPrice;
            let createdCouponCode = null;

            if (extraPayment > 0) {
                let isUnique = false;
                while (!isUnique) {
                    createdCouponCode = generateUniqueCouponCode();
                    const checkCouponSnap = await db.ref(`coupons/${createdCouponCode}`).once("value");
                    if (!checkCouponSnap.exists()) {
                        isUnique = true;
                    }
                }

                const newCouponObj = {
                    couponCode: createdCouponCode,
                    userId: userId,
                    username: interaction.user.username,
                    couponValue: extraPayment,
                    extraPaymentAmount: extraPayment,
                    createdAt: Date.now(),
                    expiresAt: Date.now() + (90 * 24 * 60 * 60 * 1000), // ৯০ দিনের মেয়াদ
                    status: "active"
                };

                await db.ref(`coupons/${createdCouponCode}`).set(newCouponObj);
            }

            // 🏷️ কুপন ব্যবহৃত হয়ে থাকলে status = used করা
            if (sessionData.appliedCoupon) {
                await db.ref(`coupons/${sessionData.appliedCoupon}`).update({
                    status: "used",
                    usedBy: userId,
                    usedAt: Date.now()
                });
            }

            // ✅ পেমেন্ট সম্পূর্ণ হওয়ার সাফল্য সম্বলিত Embed
            let extraInfoText = "";
            if (extraPayment > 0 && createdCouponCode) {
                extraInfoText = `\n\n🎁 **Extra Payment Reward Coupon Generated!**\n` +
                                `আপনি প্যাকেজের মূল্যের চেয়ে **${extraPayment} ৳** বেশি পরিশোধ করেছেন।\n` +
                                `আপনার জন্য একটি ডিসকাউন্ট কুপন তৈরি করা হয়েছে:\n` +
                                `🎟️ **Coupon Code:** \`${createdCouponCode}\`\n` +
                                `💸 **Discount Balance:** \`${extraPayment}\` ৳\n` +
                                `📌 **Status:** Active (পরবর্তী যেকোনো ক্রয়ে ব্যবহার করতে পারবেন)`;
            }

            const successPayEmbed = new EmbedBuilder()
                .setTitle("✅ Payment Successfully Verified!")
                .setDescription(
                    `আপনার পেমেন্ট সফলভাবে ভেরিফাই করা হয়েছে।\n\n` +
                    `💰 **মোট পরিশোধিত:** \`${currentTotalPaid}\` BDT\n` +
                    `📦 **প্যাকেজ:** \`${category.toUpperCase()}\`${extraInfoText}\n\n` +
                    `👉 অ্যাকাউন্ট তৈরির জন্য নিচের **"Create Account Credentials"** বাটনে ক্লিক করে আপনার পছন্দমতো Username ও Password দিন।`
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
            return interaction.editReply("❌ **পেমেন্ট প্রক্রিয়াকরণে সমস্যা হয়েছে!** অনুগ্রহ করে অ্যাডমিনের সাথে যোগাযোগ করুন।");
        }
    }

    // ================================
    // 🔑 4. Open Account Creation Modal Trigger
    // ================================
    if (interaction.isButton() && interaction.customId.startsWith("open_cred_modal_")) {
        const category = interaction.customId.split("_")[3].toLowerCase();

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

    // ================================
    // 💾 5. Save Custom Account to Firebase & Setup Channel
    // ================================
    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_create_account_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const category = interaction.customId.split("_")[3].toLowerCase();
        const customUser = interaction.fields.getTextInputValue("custom_username").trim().toLowerCase();
        const customPass = interaction.fields.getTextInputValue("custom_password").trim();
        const userId = interaction.user.id;

        const sessionRef = db.ref(`pending_payments/${userId}_${category}`);
        const sessionSnap = await sessionRef.once("value");
        const sessionData = sessionSnap.val();

        if (!sessionData || sessionData.totalPaid < sessionData.targetPrice) {
            return interaction.editReply("❌ **পেমেন্ট অসম্পূর্ণ!** অ্যাকাউন্ট তৈরি করতে সম্পূর্ণ টাকা পরিশোধ করুন।");
        }

        try {
            // 🔍 Active Username Duplication Check
            const existingUserSnap = await db.ref(`users/${customUser}`).once("value");
            if (existingUserSnap.exists()) {
                const userData = existingUserSnap.val();
                if (userData.expiresAt && userData.expiresAt > Date.now()) {
                    return interaction.editReply(`❌ **Username Already Exists!** \`${customUser}\` নামটির একটি সচল অ্যাকাউন্ট রয়েছে। অন্য কোনো Username বাছুন।`);
                }
            }

            let days = 7;
            if (category === "monthly") days = 30;
            else if (category === "2_months") days = 60;

            const expiryTimestamp = Date.now() + (days * 24 * 60 * 60 * 1000);

            // 💾 ফায়ারবেসে ইউজার সেভ
            await db.ref(`users/${customUser}`).set({
                username: customUser,
                password: customPass,
                discordId: userId,
                category: category,
                paidAmount: sessionData.totalPaid,
                usedTxns: sessionData.usedTxns,
                createdAt: Date.now(),
                expiresAt: expiryTimestamp,
                status: "active"
            });

            // 📁 প্রাইভেট অর্ডার চ্যানেল তৈরি
            const randomCode = Math.floor(1000 + Math.random() * 9000);
            let supportRoleId = ROLES.SUPPORT_CUSTOMER;
            let channelPrefix = `order-${randomCode}`;

            const permissionOverwrites = [
                { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: VERIFIED_ROLE_ID, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
            ];

            if (interaction.guild.roles.cache.has(supportRoleId)) permissionOverwrites.push({ id: supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
            if (interaction.guild.roles.cache.has(ROLES.ADMIN)) permissionOverwrites.push({ id: ROLES.ADMIN, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

            const privateChannel = await interaction.guild.channels.create({
                name: channelPrefix,
                type: 0,
                permissionOverwrites
            });

            // চ্যানেলে স্বাগতম মেসেজ পাঠানো
            const orderEmbed = new EmbedBuilder()
                .setTitle(`🛍️ NEW MEMBERSHIP ORDER CONFIRMED`)
                .setColor("#00FF00")
                .addFields(
                    { name: "👤 কাস্টমার", value: `${interaction.user}`, inline: true },
                    { name: "📦 প্যাকেজ", value: `\`${category.toUpperCase()}\``, inline: true },
                    { name: "👤 Username", value: `\`${customUser}\``, inline: true },
                    { name: "🔑 Password", value: `\`${customPass}\``, inline: true },
                    { name: "💳 Total Paid", value: `\`${sessionData.totalPaid}\` BDT`, inline: true },
                    { name: "📅 এক্সপায়ার ডেট", value: `<t:${Math.floor(expiryTimestamp / 1000)}:R>`, inline: true }
                )
                .setTimestamp();

            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`claim_order`).setLabel("🛟 Claim").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`close_order`).setLabel("🔒 Close").setStyle(ButtonStyle.Secondary)
            );

            await privateChannel.send({ content: `${interaction.user} <@&${supportRoleId}>`, embeds: [orderEmbed], components: [actionRow] });

            // 📩 কাস্টমারের ডাইরেক্ট মেসেজে (DM) অ্যাক্সেস পাঠানো
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle("🎉 Your Membership Account is Ready!")
                    .setDescription(
                        `আপনার অর্ডার করা সার্ভিসের অ্যাক্সেস ক্রেডিট নিচে দেওয়া হলো:\n\n` +
                        `👤 **Username:** \`${customUser}\`\n` +
                        `🔑 **Password:** \`${customPass}\`\n` +
                        `📦 **Package:** \`${category.toUpperCase()}\`\n` +
                        `📅 **মেয়াদ:** <t:${Math.floor(expiryTimestamp / 1000)}:R>`
                    )
                    .setColor("Green")
                    .setFooter({ text: `Payment Number: ${PAYMENT_NUMBER}` })
                    .setTimestamp();

                await interaction.user.send({ embeds: [dmEmbed] });
            } catch (dmErr) {
                console.log("❌ User DM Closed:", dmErr);
            }

            // 📊 ট্র্যাকিং চ্যানেলে আপডেট
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
                         `আপনার কাস্টম অ্যাকাউন্ট তৈরি সম্পন্ন হয়েছে এবং প্রাইভেট চ্যানেল তৈরি করা হয়েছে: ${privateChannel}\n\n` +
                         `👤 **Username:** \`${customUser}\`\n` +
                         `🔑 **Password:** \`${customPass}\`\n` +
                         `📦 **Package:** \`${category.toUpperCase()}\`\n` +
                         `📅 **মেয়াদ:** <t:${Math.floor(expiryTimestamp / 1000)}:R>`
            });

        } catch (err) {
            console.error("❌ Account Creation Error:", err);
            return interaction.editReply("❌ **অ্যাকাউন্ট তৈরিতে ত্রুটি ঘটেছে!** অনুগ্রহ করে অ্যাডমিনের সাথে যোগাযোগ করুন।");
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith("create_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const parts = interaction.customId.split("_");
        const type = parts[1]; const category = parts.slice(2).join("_");

        const randomCode = Math.floor(1000 + Math.random() * 9000);
        let supportRoleId = ROLES.SUPPORT_TICKET_REPORT;
        let channelPrefix = `${type}-${randomCode}`;

        if (type === "customer") supportRoleId = ROLES.SUPPORT_CUSTOMER;

        const permissionOverwrites = [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: VERIFIED_ROLE_ID, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
        ];

        if (interaction.guild.roles.cache.has(supportRoleId)) permissionOverwrites.push({ id: supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
        if (interaction.guild.roles.cache.has(ROLES.ADMIN)) permissionOverwrites.push({ id: ROLES.ADMIN, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

        const privateChannel = await interaction.guild.channels.create({
            name: channelPrefix,
            type: 0,
            permissionOverwrites
        });

        const panelEmbed = new EmbedBuilder().setTitle(`🛠️ ${type.toUpperCase()} REQUEST - ${category.toUpperCase().replace("_", " ")}`).setDescription(`স্বাগতম ${interaction.user}!\nআমাদের সাপোর্ট স্টাফ খুব শীঘ্রই আপনাকে সহায়তা করবে।`).setColor("Green").setTimestamp();
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

        return interaction.editReply(`✅ সফলভাবে তৈরি হয়েছে: ${privateChannel}`);
    }

    if (interaction.isButton() && interaction.customId.startsWith("claim_")) {
        const type = interaction.customId.split("_")[1];
        let reqRole = (type === "customer" || type === "order") ? ROLES.SUPPORT_CUSTOMER : ROLES.SUPPORT_TICKET_REPORT;
        if (!interaction.member.roles.cache.has(reqRole) && !interaction.member.roles.cache.has(ROLES.ADMIN)) return interaction.reply({ content: "❌ পারমিশন নেই!", flags: [MessageFlags.Ephemeral] });
        
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true }).catch(() => {});
        await interaction.reply({ content: `🛟 এই চ্যানেলটি এখন থেকে স্টাফ ${interaction.user} হ্যান্ডেল করছেন।` });

        db.ref(`staff_duty/${interaction.user.id}/claims`).transaction(c => (c || 0) + 1);
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("approve_")) {
        const type = interaction.customId.split("_")[1];
        let reqRole = (type === "customer" || type === "order") ? ROLES.SUPPORT_CUSTOMER : ROLES.SUPPORT_TICKET_REPORT;
        if (!interaction.member.roles.cache.has(reqRole) && !interaction.member.roles.cache.has(ROLES.ADMIN)) return interaction.reply({ content: "❌ এই অর্ডারটি অ্যাপ্রুভ করার পারমিশন আপনার নেই!", flags: [MessageFlags.Ephemeral] });

        await interaction.reply({ content: `✅ **অর্ডারটি সফলভাবে কনফার্ম করা হয়েছে!**` });

        const orderLogs = getOrderLogs();
        const currentOrder = orderLogs[interaction.channel.id];
        const trackingChannel = interaction.guild.channels.cache.get(ORDER_TRACKING_CHANNEL_ID);

        if (currentOrder && trackingChannel) {
            try {
                const msg = await trackingChannel.messages.fetch(currentOrder.trackingMessageId);
                if (msg) {
                    const targetUser = await client.users.fetch(currentOrder.userId).catch(() => "Unknown");
                    const updatedEmbed = buildOrderStatusEmbed(targetUser, currentOrder.category, interaction.channel, "approved", interaction.user, null, currentOrder.txnId || null);
                    await msg.edit({ embeds: [updatedEmbed] });

                    currentOrder.status = "approved";
                    currentOrder.staffId = interaction.user.id;
                    saveOrderLog(interaction.channel.id, currentOrder.trackingMessageId, currentOrder);
                }
            } catch (e) { console.error(e); }
        }
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("close_")) {
        const orderLogs = getOrderLogs();
        const currentOrder = orderLogs[interaction.channel.id];

        // 📜 HTML Transcript তৈরি ও পাঠানো
        try {
            const transcript = await discordTranscripts.createTranscript(interaction.channel, {
                limit: -1, returnType: 'attachment', filename: `${interaction.channel.name}-transcript.html`, saveImages: true, poweredBy: false
            });

            const transcriptLogChan = interaction.guild.channels.cache.get(TRANSCRIPT_LOG_CHANNEL_ID);
            if (transcriptLogChan) {
                await transcriptLogChan.send({
                    content: `📜 **Transcript Log for Channel:** \`#${interaction.channel.name}\` | Closed by ${interaction.user}`,
                    files: [transcript]
                });
            }
        } catch (tErr) { console.error("Transcript Error:", tErr); }

        // 🌟 টিকেট বন্ধ হলে রেটিং ফিডব্যাক পাঠানো
        if (currentOrder && currentOrder.userId) {
            const targetUser = await client.users.fetch(currentOrder.userId).catch(() => null);
            if (targetUser) {
                const feedbackRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`star_rating_1_${interaction.user.id}`).setLabel("⭐ 1").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`star_rating_2_${interaction.user.id}`).setLabel("⭐ 2").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`star_rating_3_${interaction.user.id}`).setLabel("⭐ 3").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`star_rating_4_${interaction.user.id}`).setLabel("⭐ 4").setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`star_rating_5_${interaction.user.id}`).setLabel("⭐ 5").setStyle(ButtonStyle.Success)
                );

                targetUser.send({ content: `👋 আপনার সাম্প্রতিক **${currentOrder.category}** সাপোর্ট টিকিটটি বন্ধ করা হয়েছে। আমাদের সাপোর্ট সার্ভিসের অভিজ্ঞতা কেমন ছিল তা জানাতে নিচে ক্লিক করে রেটিং দিন:`, components: [feedbackRow] }).catch(() => {});
            }
        }

        await interaction.reply("🔒 চ্যানেলটি ৫ সেকেন্ডের মধ্যে ডিলিট হবে।");

        const trackingChannel = interaction.guild.channels.cache.get(ORDER_TRACKING_CHANNEL_ID);
        if (currentOrder && trackingChannel) {
            try {
                const msg = await trackingChannel.messages.fetch(currentOrder.trackingMessageId);
                if (msg) {
                    const targetUser = await client.users.fetch(currentOrder.userId).catch(() => "Unknown");
                    const currentStaff = currentOrder.staffId ? await client.users.fetch(currentOrder.staffId).catch(() => null) : null;
                    const updatedEmbed = buildOrderStatusEmbed(targetUser, currentOrder.category, `#${interaction.channel.name} (Deleted)`, "closed", currentStaff, null, currentOrder.txnId || null);
                    await msg.edit({ embeds: [updatedEmbed] });

                    const logs = getOrderLogs();
                    delete logs[interaction.channel.id];
                    fs.writeFileSync(ORDER_LOG_FILE, JSON.stringify(logs, null, 2), "utf8");
                }
            } catch(e) {}
        }

        setTimeout(async () => {
            await interaction.channel.delete().catch(() => {});
        }, 5000);
    }

    if (interaction.isButton() && interaction.customId.startsWith("ban_panel_")) {
        const type = interaction.customId.split("_")[2];
        let reqRole = (type === "customer" || type === "order") ? ROLES.SUPPORT_CUSTOMER : ROLES.SUPPORT_TICKET_REPORT;
        if (!interaction.member.roles.cache.has(reqRole) && !interaction.member.roles.cache.has(ROLES.ADMIN)) return interaction.reply({ content: "❌ পারমিশন নেই!", flags: [MessageFlags.Ephemeral] });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId("execute_ticket_ban")
            .setPlaceholder("🚫 টাইমআউট/ব্যান এর সময় সিলেক্ট করুন...")
            .addOptions([
                { label: "১ দিন টাইমআউট (24 Hours Mute)", value: "1_day" },
                { label: "৩ দিন টাইমআউট (3 Days Mute)", value: "3_days" },
                { label: "৭ দিন টাইমআউট (7 Days Mute)", value: "7_days" }
            ]);

        return interaction.reply({ content: "⚠️ ফানি/ফেক টিকেট বা রিপোর্টের কারণে মেম্বারকে কতদিনের জন্য ব্যান করতে চান?", components: [new ActionRowBuilder().addComponents(selectMenu)], flags: [MessageFlags.Ephemeral] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "execute_ticket_ban") {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const choice = interaction.values[0];

        const orderLogs = getOrderLogs();
        const currentOrder = orderLogs[interaction.channel.id];
        if (!currentOrder || !currentOrder.userId) return interaction.editReply("❌ অর্ডারের তথ্য পাওয়া যায়নি!");

        const targetId = currentOrder.userId;
        let durationMs = 24 * 60 * 60 * 1000;
        let durationText = "১ দিন";

        if (choice === "3_days") { durationMs = 3 * 24 * 60 * 60 * 1000; durationText = "৩ দিন"; }
        else if (choice === "7_days") { durationMs = 7 * 24 * 60 * 60 * 1000; durationText = "৭ দিন"; }

        savePunishment(targetId, "Muted", durationMs);
        const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
        if (targetMember) {
            await targetMember.timeout(durationMs, `Fake/Funny Support Request by ${interaction.user.tag}`).catch(() => {});
        }

        const trackingChannel = interaction.guild.channels.cache.get(ORDER_TRACKING_CHANNEL_ID);
        if (trackingChannel) {
            try {
                const msg = await trackingChannel.messages.fetch(currentOrder.trackingMessageId);
                if (msg) {
                    const targetUser = await client.users.fetch(targetId).catch(() => "Unknown Member");
                    const updatedEmbed = buildOrderStatusEmbed(targetUser, currentOrder.category, `#${interaction.channel.name} (Banned)`, "banned", interaction.user, `ফেক/ফানি সাপোর্ট (${durationText} মিউট)`, currentOrder.txnId || null);
                    await msg.edit({ embeds: [updatedEmbed] });
                }
            } catch(e) {}
        }

        const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
            logChannel.send({ embeds: [new EmbedBuilder().setColor("Red").setTitle("🚫 Support Ban Imposed").setDescription(`**User:** <@${targetId}>\n**Punished By:** ${interaction.user}\n**Duration:** ${durationText}`)] });
        }

        await interaction.editReply(`✅ সফলভাবে ব্যবহারকারীকে ${durationText} এর জন্য ব্যান করা হয়েছে।`);
        setTimeout(async () => {
            await interaction.channel.delete().catch(() => {});
        }, 2000);
    }
});

// ================================
// ⚡ PART 4 - Live UI Panels Templates
// ================================

async function getDynamicOrderGuidePanel() {
    const { customDescription, customImage, fullData } = await fetchFirebasePanelData("order_guide");
    const defaultTitle = "📦 HOW TO ORDER & SYSTEM GUIDE";
    const defaultDesc = `🛒 **আমাদের সার্ভার থেকে অর্ডার করার নিয়মাবলী** 🛒\n\n📌 **ধাপসমূহ:**\n১. পেমেন্ট প্যানেল থেকে প্যাকেজ নির্বাচন করুন।\n২. টাকা পাঠিয়ে **Transaction ID** সংগ্রহ করুন।`;

    const embed = new EmbedBuilder()
        .setTitle(fullData.title || defaultTitle)
        .setDescription(customDescription || defaultDesc)
        .setColor("#FFAA00")
        .setTimestamp()
        .setFooter({ text: "Order Guide System", iconURL: client.user.displayAvatarURL() });

    if (customImage) embed.setImage(customImage);
    return { embeds: [embed] };
}

async function getDynamicTicketPanel() {
    const { options, customDescription, customImage } = await fetchFirebasePanelData("ticket");
    const defaultDesc = `🎟️ **আমাদের অফিসিয়াল সাপোর্ট টিকিটে স্বাগতম!** 🎟️`;

    const embed = new EmbedBuilder()
        .setTitle("🎫 OFFICIAL SUPPORT TICKET CENTER")
        .setDescription(customDescription || defaultDesc)
        .setImage(customImage || COVER_IMAGES.TICKET)
        .setColor("#5865F2")
        .setFooter({ text: "Official Support Panel", iconURL: client.user.displayAvatarURL() });

    const menu = new StringSelectMenuBuilder().setCustomId("select_product_ticket").setPlaceholder("❓ আপনার প্রয়োজনীয় অপশন সিলেক্ট করুন...").addOptions(options);
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

async function getDynamicReportPanel() {
    const { options, customDescription, customImage } = await fetchFirebasePanelData("report");
    const defaultDesc = `🚨 **মেম্বার বা স্টাফ রিপোর্ট করার স্থান** 🚨`;

    const embed = new EmbedBuilder()
        .setTitle("🚨 MEMBER & STAFF REPORT CENTER")
        .setDescription(customDescription || defaultDesc)
        .setImage(customImage || COVER_IMAGES.REPORT)
        .setColor("#ED4245")
        .setFooter({ text: "Report Center", iconURL: client.user.displayAvatarURL() });

    const menu = new StringSelectMenuBuilder().setCustomId("select_report_category").setPlaceholder("❓ রিপোর্ট করার কারণ সিলেক্ট করুন...").addOptions(options);
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

async function getDynamicCustomerPanel() {
    const { options, customDescription, customImage } = await fetchFirebasePanelData("customer");
    const defaultDesc = `💬 **কাস্টমার সাপোর্ট অ্যান্ড কুয়েরি** 💬`;

    const embed = new EmbedBuilder()
        .setTitle("💬 VIP CUSTOMER SUPPORT CENTER")
        .setDescription(customDescription || defaultDesc)
        .setImage(customImage || COVER_IMAGES.CUSTOMER)
        .setColor("#57F287")
        .setFooter({ text: "Customer Support", iconURL: client.user.displayAvatarURL() });

    const menu = new StringSelectMenuBuilder().setCustomId("select_customer_category").setPlaceholder("❓ আপনার প্রয়োজনীয় অপশন সিলেক্ট করুন...").addOptions(options);
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

async function getDynamicPaymentPanel() {
    const { options, customDescription, customImage } = await fetchFirebasePanelData("payment");
    const defaultDesc = `💳 **Premium Store & Automatic Payment Gateway** 💳`;

    const embed = new EmbedBuilder()
        .setTitle("🛍️ AUTOMATED SHOP & PAYMENT PANELS")
        .setDescription(customDescription || defaultDesc)
        .setImage(customImage || COVER_IMAGES.PAYMENT)
        .setColor("#3498DB")
        .setFooter({ text: "Automated Payment Bot", iconURL: client.user.displayAvatarURL() });

    const menu = new StringSelectMenuBuilder().setCustomId("select_buy_category").setPlaceholder("🛍️ আপনার কাঙ্ক্ষিত মেম্বারশিপ/সার্ভিস সিলেক্ট করুন...").addOptions(options);
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

// Commands
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild || message.guild.id !== ALLOWED_GUILD_ID) return;

    // Duty commands
    if (message.content === "!duty on") {
        if (!message.member.roles.cache.has(ROLES.SUPPORT_CUSTOMER) && !message.member.roles.cache.has(ROLES.SUPPORT_TICKET_REPORT) && !message.member.roles.cache.has(ROLES.ADMIN)) return;
        await db.ref(`staff_duty/${message.author.id}/status`).set({ startTime: Date.now(), state: "ON" });
        return message.reply("🟢 আপনি এখন সাকসেসফুলি অন-ডিউটিতে আছেন।");
    }

    if (message.content === "!duty off") {
        if (!message.member.roles.cache.has(ROLES.SUPPORT_CUSTOMER) && !message.member.roles.cache.has(ROLES.SUPPORT_TICKET_REPORT) && !message.member.roles.cache.has(ROLES.ADMIN)) return;
        
        const ref = db.ref(`staff_duty/${message.author.id}`);
        const snap = await ref.once("value");
        const val = snap.val() || {};
        
        if (val.status && val.status.state === "ON") {
            const timeSpent = Math.floor((Date.now() - val.status.startTime) / (1000 * 60));
            const totalPrev = val.totalMinutes || 0;
            await ref.update({ totalMinutes: totalPrev + timeSpent, "status/state": "OFF" });
            return message.reply(`🔴 অফ-ডিউটি সম্পন্ন। আজকের সেশনে ডিউটি সময়: **${timeSpent} মিনিট**।`);
        }
        return message.reply("⚠️ আপনি অন-ডিউটিতে ছিলেন না।");
    }

    // 🎁 Manual Giveaway Command (!gstart <time_min> <winners> <prize>)
    if (message.content.startsWith("!gstart ")) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator) && !message.member.roles.cache.has(ROLES.ADMIN)) return;
        const args = message.content.split(" ").slice(1);
        const duration = parseInt(args[0]);
        const winnersCount = parseInt(args[1]);
        const prize = args.slice(2).join(" ");

        if (!duration || !winnersCount || !prize) return message.reply("⚠️ সঠিক নিয়ম: `!gstart <সময় মিনিটে> <উইনার সংখ্যা> <পুরস্কারের নাম>`");

        const gwId = `gw_${Date.now()}`;
        const endAt = Date.now() + (duration * 60 * 1000);

        const gwEmbed = new EmbedBuilder()
            .setTitle(`🎁 GIVEAWAY STARTED: ${prize}`)
            .setDescription(`**সময়সীমা:** <t:${Math.floor(endAt / 1000)}:R>\n**উইনার সংখ্যা:** \`${winnersCount}\` জন\n\n👇 নিচের বাটনে ক্লিক করে জয়েন করুন!`)
            .setColor("Purple")
            .setFields({ name: "🎉 এন্ট্রি সংখ্যা", value: "`0` জন মেম্বার", inline: true })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`giveaway_join_${gwId}`).setLabel("🎉 Join Giveaway").setStyle(ButtonStyle.Primary)
        );

        const gwChan = message.guild.channels.cache.get(GIVEAWAY_CHANNEL_ID);
        if (gwChan) {
            const gwMsg = await gwChan.send({ embeds: [gwEmbed], components: [row] });
            await db.ref(`giveaways/${gwId}`).set({
                msgId: gwMsg.id,
                endAt: endAt,
                winnersCount: winnersCount,
                prize: prize,
                ended: false
            });
            message.reply(`✅ গিভঅ্যাওয়েটি সফলভাবে স্টার্ট করা হয়েছে।`);
        }
        return;
    }

    const isServerAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator) || message.member.roles.cache.has(ROLES.ADMIN);
    if (!isServerAdmin) return;

    if (message.content === "!setup") return message.channel.send({ embeds: [createVerificationEmbed()], components: [verificationRow] });
    if (message.content === "!ticket" && message.channelId === CHANNELS.TICKET_PANEL) return message.channel.send(await getDynamicTicketPanel());
    if (message.content === "!report" && message.channelId === CHANNELS.REPORT_PANEL) return message.channel.send(await getDynamicReportPanel());
    if (message.content === "!customer" && message.channelId === CHANNELS.CUSTOMER_PANEL) return message.channel.send(await getDynamicCustomerPanel());
    if (message.content === "!payment" && message.channelId === CHANNELS.PAYMENT_PANEL) return message.channel.send(await getDynamicPaymentPanel());
    if (message.content === "!orderguide" && message.channelId === ORDER_GUIDE_CHANNEL_ID) return message.channel.send(await getDynamicOrderGuidePanel());
});

// Realtime DB Panel Auto Updater (Fix Payment Panel Syncing)
client.on("ready", async () => {
    console.log(`🤖 Logged in as ${client.user.tag}!`);
    setBotPresence();

    // Firebase DB Live Sync for Panel Announcements & Dynamic Panel Updating
    db.ref("panels/giveaway_live").on("value", async (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        const gwChan = client.channels.cache.get(GIVEAWAY_CHANNEL_ID);
        if (!gwChan) return;

        const messages = await gwChan.messages.fetch({ limit: 10 }).catch(() => null);
        const hasBotMsg = messages?.some(m => m.author.id === client.user.id);
        if (!hasBotMsg && data.active === true) {
            const endAt = Date.now() + (parseInt(data.durationMinutes || 60) * 60 * 1000);
            const gwEmbed = new EmbedBuilder()
                .setTitle(`🎁 LIVE GIVEAWAY: ${data.prize || "Premium Gift"}`)
                .setDescription(`**সময়সীমা:** <t:${Math.floor(endAt / 1000)}:R>\n**উইনার সংখ্যা:** \`${data.winnersCount || 1}\` জন\n\n👇 নিচের বাটনে ক্লিক করে ফ্রিতে জয়েন করুন!`)
                .setColor("Purple")
                .setFields({ name: "🎉 এন্ট্রি সংখ্যা", value: "`0` জন মেম্বার", inline: true })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`giveaway_join_dbpanel`).setLabel("🎉 Join Giveaway").setStyle(ButtonStyle.Primary)
            );

            const sent = await gwChan.send({ embeds: [gwEmbed], components: [row] });
            await db.ref(`giveaways/dbpanel`).set({
                msgId: sent.id,
                endAt: endAt,
                winnersCount: parseInt(data.winnersCount || 1),
                prize: data.prize || "Premium Gift",
                ended: false
            });
        }
    });

    db.ref("panels").on("value", async (snapshot) => {
        const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
        if (!guild) return;

        // Panel Auto-Updates
        const ticketChan = guild.channels.cache.get(CHANNELS.TICKET_PANEL);
        if (ticketChan) {
            const messages = await ticketChan.messages.fetch({ limit: 5 }).catch(() => null);
            const botMsg = messages?.find(m => m.author.id === client.user.id);
            if (botMsg) {
                const updatedData = await getDynamicTicketPanel();
                await botMsg.edit(updatedData).catch(() => {});
            }
        }

        const reportChan = guild.channels.cache.get(CHANNELS.REPORT_PANEL);
        if (reportChan) {
            const messages = await reportChan.messages.fetch({ limit: 5 }).catch(() => null);
            const botMsg = messages?.find(m => m.author.id === client.user.id);
            if (botMsg) {
                const updatedData = await getDynamicReportPanel();
                await botMsg.edit(updatedData).catch(() => {});
            }
        }

        const custChan = guild.channels.cache.get(CHANNELS.CUSTOMER_PANEL);
        if (custChan) {
            const messages = await custChan.messages.fetch({ limit: 5 }).catch(() => null);
            const botMsg = messages?.find(m => m.author.id === client.user.id);
            if (botMsg) {
                const updatedData = await getDynamicCustomerPanel();
                await botMsg.edit(updatedData).catch(() => {});
            }
        }

        const payChan = guild.channels.cache.get(CHANNELS.PAYMENT_PANEL);
        if (payChan) {
            const messages = await payChan.messages.fetch({ limit: 5 }).catch(() => null);
            const botMsg = messages?.find(m => m.author.id === client.user.id);
            if (botMsg) {
                const updatedData = await getDynamicPaymentPanel();
                await botMsg.edit(updatedData).catch(() => {});
            }
        }
    });
});

// 🕒 প্রতি ৫ মিনিট পর পর ইন্টারভাল রান
setInterval(async () => {
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (!guild) return;

    // Live Stats Voice Counter Update
    const statsChannel = guild.channels.cache.get(STATS_VC_CHANNEL_ID);
    if (statsChannel) {
        const totalMembers = guild.memberCount;
        const activeInVc = guild.members.cache.filter(m => m.voice.channel).size;
        await statsChannel.setName(`👥 Members: ${totalMembers} | 🎙️ VC: ${activeInVc}`).catch(() => {});
    }

    // Giveaway Checker
    const now = Date.now();
    const gwsSnap = await db.ref("giveaways").once("value");
    const giveaways = gwsSnap.val() || {};

    for (const [gwId, gw] of Object.entries(giveaways)) {
        if (!gw.ended && now >= gw.endAt) {
            const gwChan = guild.channels.cache.get(GIVEAWAY_CHANNEL_ID);
            if (gwChan) {
                const participants = gw.participants ? Object.keys(gw.participants) : [];
                let winners = [];
                if (participants.length > 0) {
                    const count = Math.min(gw.winnersCount, participants.length);
                    for (let i = 0; i < count; i++) {
                        const randIndex = Math.floor(Math.random() * participants.length);
                        winners.push(`<@${participants.splice(randIndex, 1)[0]}>`);
                    }
                }
                const winText = winners.length > 0 ? winners.join(", ") : "কেউ জয়েন করেনি ❌";
                const endEmbed = new EmbedBuilder()
                    .setTitle(`🎁 GIVEAWAY CONCLUDED / WINNERS!`)
                    .setDescription(`**পুরস্কার:** ${gw.prize}\n\n🏆 **বিজয়ীগণ:**\n${winText}`)
                    .setColor("Gold")
                    .setTimestamp();

                await gwChan.send({ content: `🎉 **গিভঅ্যাওয়ে সমাপ্তি!** ${winText}`, embeds: [endEmbed] });
                await db.ref(`giveaways/${gwId}/ended`).set(true);
            }
        }
    }
}, 5 * 60 * 1000);

// ================================
// 🚀 PART 5 - Live Member Events & Smart Sync Recovery
// ================================

client.on("guildMemberAdd", async (member) => {
    if (member.guild.id !== ALLOWED_GUILD_ID) return;

    const saved = getSavedMembers();
    if (!saved.includes(member.id)) {
        saved.push(member.id);
        saveMembers(saved);
    }

    const punishments = getPunishments();
    if (punishments[member.id] && punishments[member.id].status === "Muted") {
        const record = punishments[member.id];
        const now = Date.now();
        if (!record.expiresAt || record.expiresAt > now) {
            const remainingTime = record.expiresAt ? record.expiresAt - now : 10 * 60 * 1000;
            try {
                await member.timeout(remainingTime, "Automod Bypass Block");
                const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
                if (welcomeChannel) {
                    welcomeChannel.send(`⚠️ মেম্বার <@${member.id}> তার আগের মিউট শাস্তি ফাঁকি দেওয়ার জন্য লিভ নিয়ে পুনরায় জয়েন করায় তাকে আবার মিউট করা হয়েছে।`);
                }
            } catch(e) {}
        } else {
            savePunishment(member.id, null);
        }
    }

    const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (welcomeChannel) {
        const embed = buildDynamicWelcomeEmbed(member, "unverified", false);
        const sentMsg = await welcomeChannel.send({ content: `🎉 স্বাগতম ${member}!`, embeds: [embed] }).catch(() => {});
        if (sentMsg) {
            saveWelcomeLog(member.id, sentMsg.id, { isOffline: false });
        }
    }
});

client.on("guildMemberRemove", async (member) => {
    if (member.guild.id !== ALLOWED_GUILD_ID) return;

    const saved = getSavedMembers();
    const updated = saved.filter(id => id !== member.id);
    saveMembers(updated);

    const logs = getWelcomeLogs();
    const userLog = logs[member.id];
    const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);

    if (userLog && welcomeChannel) {
        try {
            const msg = await welcomeChannel.messages.fetch(userLog.messageId);
            if (msg) {
                const updatedEmbed = buildDynamicWelcomeEmbed(member, "left", userLog.isOffline);
                await msg.edit({ embeds: [updatedEmbed] });
            }
        } catch (e) {}
    }
});

// Offline Recovery Sync System
client.on("ready", async () => {
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (!guild) return;

    try {
        const currentMembers = await guild.members.fetch();
        const savedMembers = getSavedMembers();
        const logs = getWelcomeLogs();
        const welcomeChannel = guild.channels.cache.get(WELCOME_CHANNEL_ID);

        const missedJoins = currentMembers.filter(m => !savedMembers.includes(m.id) && !m.user.bot);

        for (const [, member] of missedJoins) {
            savedMembers.push(member.id);
            if (welcomeChannel) {
                const status = member.roles.cache.has(VERIFIED_ROLE_ID) ? "verified" : "unverified";
                const embed = buildDynamicWelcomeEmbed(member, status, true);
                const msg = await welcomeChannel.send({ content: `🎉 স্বাগতম ${member}!`, embeds: [embed] }).catch(() => {});
                if (msg) saveWelcomeLog(member.id, msg.id, { isOffline: true });
            }
        }

        const currentMemberIds = currentMembers.map(m => m.id);
        const missedLeaves = savedMembers.filter(id => !currentMemberIds.includes(id));

        if (missedLeaves.length > 0 && welcomeChannel) {
            for (const leftId of missedLeaves) {
                const userLog = logs[leftId];
                if (userLog) {
                    try {
                        const msg = await welcomeChannel.messages.fetch(userLog.messageId);
                        if (msg) {
                            const updatedEmbed = buildDynamicWelcomeEmbed({ id: leftId, userId: leftId }, "left", true);
                            await msg.edit({ embeds: [updatedEmbed] });
                        }
                    } catch (e) {}
                }
            }
        }

        const finalIds = currentMembers.map(m => m.id);
        saveMembers(finalIds);
    } catch (err) {
        console.error("Sync Recovery Error:", err);
    }
});

function setBotPresence() {
    client.user.setPresence({
        activities: [{ name: "Security & Verification", type: ActivityType.Watching }],
        status: "online"
    });
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
