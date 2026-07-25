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
// 📱 Dynamic Realtime Settings (Firebase Sync)
// ================================

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

const BAD_WORDS = ["gali1", "gali2", "gali3", "khanki", "magi", "baimon"]; 

// 💰 প্যাকেজের মূল্য তালিকা
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
    const c = String(cat).toLowerCase();
    if (c.includes("2") || c.includes("two")) return "2_months";
    if (c.includes("month")) return "monthly";
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

// 📌 Firebase থেকে ডেটা নিয়ে আসার ফাংশন
async function fetchFirebasePanelData(panelType) {
    try {
        const snapshot = await db.ref(`panels/${panelType}`).once("value");
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

    const randomKey = "KEY-" + Math.random().toString(36).substring(2, 8).toUpperCase() + "-" + Date.now().toString().slice(-4);
    const userAvatarUrl = interaction.user.displayAvatarURL({ extension: "png", dynamic: true, size: 512 });
    const serverName = interaction.guild ? interaction.guild.name : "Discord Server";
    
    const keyRef = db.ref(`keys/${randomKey}`);
    
    // C++ অ্যাপ্লিকেশনের সহজ রিডের জন্য avatarUrl এবং serverName অন্তর্ভুক্ত
    await keyRef.set({
        used: false,
        generatedBy: interaction.user.tag,
        username: interaction.user.username,
        userId: interaction.user.id,
        avatarUrl: userAvatarUrl,
        serverName: serverName,
        createdAt: Date.now()
    });

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

    // লাইভ লিঙ্ক রেসপন্স
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

    // 🌟 ড্রপডাউন সিলেকশন হ্যান্ডলার (1TIME KEY + TICKET HANDLING)
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

    // Modal Submit & Payment Handlers
    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_coupon_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        
        const rawCategory = interaction.customId.split("_")[2].toLowerCase();
        const category = getNormalizedCategory(rawCategory);
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

        if (finalPrice <= 0) {
            await db.ref(`pending_payments/${userId}_${category}`).set({
                targetPrice: 0,
                basePrice: basePrice,
                appliedCoupon: appliedCouponCode,
                appliedDiscount: appliedDiscountValue,
                totalPaid: 0,
                usedTxns: ["COUPON_100_PERCENT_OFF"]
            });

            if (appliedCouponCode) {
                await db.ref(`coupons/${appliedCouponCode}`).update({
                    status: "used",
                    usedBy: userId,
                    usedAt: Date.now()
                });
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

    if (interaction.isButton() && interaction.customId.startsWith("submit_txn_")) {
        const rawCategory = interaction.customId.split("_")[2].toLowerCase();
        const category = getNormalizedCategory(rawCategory);

        const modal = new ModalBuilder()
            .setCustomId(`modal_txn_${category}`)
            .setTitle("🔒 Submit Transaction ID");

        const txnInput = new TextInputBuilder()
            .setCustomId("txn_id_input")
            .setLabel("Transaction ID (TxnID) লিখুন")
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

        const txnRef = db.ref(`transactions/${txnId}`);
        const txnSnap = await txnRef.once("value");

        if (!txnSnap.exists()) {
            return interaction.editReply("❌ **ভুল বা অকার্যকর Transaction ID!** সঠিক Transaction ID দিন।");
        }

        const txnData = txnSnap.val();
        if (txnData.used) {
            return interaction.editReply("⚠️ **এই Transaction ID টি ইতোমধ্যে ব্যবহার করা হয়েছে!**");
        }

        const paymentRef = db.ref(`pending_payments/${userId}_${category}`);
        const paymentSnap = await paymentRef.once("value");

        let paymentData = paymentSnap.val() || {
            targetPrice: PACKAGE_PRICES[category] || 510,
            basePrice: PACKAGE_PRICES[category] || 510,
            appliedCoupon: null,
            appliedDiscount: 0,
            totalPaid: 0,
            usedTxns: []
        };

        const txnAmount = Number(txnData.amount || 0);
        paymentData.totalPaid += txnAmount;

        if (!paymentData.usedTxns) paymentData.usedTxns = [];
        paymentData.usedTxns.push(txnId);

        await txnRef.update({
            used: true,
            usedBy: userId,
            usedAt: Date.now()
        });

        if (paymentData.appliedCoupon) {
            await db.ref(`coupons/${paymentData.appliedCoupon}`).update({
                status: "used",
                usedBy: userId,
                usedAt: Date.now()
            });
        }

        if (paymentData.totalPaid >= paymentData.targetPrice) {
            await paymentRef.set({
                ...paymentData,
                lastUpdated: Date.now()
            });

            const successEmbed = new EmbedBuilder()
                .setTitle(`✅ Payment Successful! (${category.toUpperCase().replace("_", " ")})`)
                .setDescription(
                    `🎉 **অভিনন্দন! আপনার পেমেন্ট সফলভাবে ভেরিফাই করা হয়েছে।**\n\n` +
                    `💰 **মোট পরিশোধিত মূল্য:** \`${paymentData.totalPaid}\` BDT\n` +
                    `💳 **ব্যবহৃত TxnID:** \`${txnId}\`\n\n` +
                    `👉 আপনার অ্যাকাউন্ট ব্যবহারের তথ্যাদি (Username & Password) তৈরি করতে নিচের **"Create Account Credentials"** বাটনে চাপ দিন।`
                )
                .setColor("#00FF00");

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`open_cred_modal_${category}`)
                    .setLabel("🔑 Create Account Credentials")
                    .setStyle(ButtonStyle.Success)
            );

            return interaction.editReply({ embeds: [successEmbed], components: [row] });
        } else {
            const dueAmount = paymentData.targetPrice - paymentData.totalPaid;
            await paymentRef.set(paymentData);

            const partialEmbed = new EmbedBuilder()
                .setTitle(`⚠️ Partial Payment Received!`)
                .setDescription(
                    `💵 **পরিশোধ করা হয়েছে:** \`${paymentData.totalPaid}\` BDT\n` +
                    `🏷️ **টার্গেট মূল্য:** \`${paymentData.targetPrice}\` BDT\n` +
                    `❗ **বকেয়া (Due):** \`${dueAmount}\` BDT\n\n` +
                    `বাকি টাকা পরিশোধ করতে পুনরায় **Submit TxnID** বাটনে ক্লিক করুন।`
                )
                .setColor("#FFA500");

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`submit_txn_${category}`)
                    .setLabel("Submit TxnID")
                    .setStyle(ButtonStyle.Primary)
            );

            return interaction.editReply({ embeds: [partialEmbed], components: [row] });
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith("open_cred_modal_")) {
        const rawCategory = interaction.customId.split("_")[3].toLowerCase();
        const category = getNormalizedCategory(rawCategory);

        const modal = new ModalBuilder()
            .setCustomId(`modal_create_account_${category}`)
            .setTitle("🔑 Create Your Login Credentials");

        const userValInput = new TextInputBuilder()
            .setCustomId("acc_username")
            .setLabel("ইউজারনেম (Username) লিখুন")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const passValInput = new TextInputBuilder()
            .setCustomId("acc_password")
            .setLabel("পাসওয়ার্ড (Password) লিখুন")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(userValInput),
            new ActionRowBuilder().addComponents(passValInput)
        );

        return interaction.showModal(modal);
    }

    // 🟢 FIXED: Create User Account in Firebase (With username field)
    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_create_account_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const rawCategory = interaction.customId.split("_")[3].toLowerCase();
        const category = getNormalizedCategory(rawCategory);
        const usernameInput = interaction.fields.getTextInputValue("acc_username").trim();
        const passwordInput = interaction.fields.getTextInputValue("acc_password").trim();
        const userId = interaction.user.id;

        const userRef = db.ref(`users/${usernameInput}`);
        const userSnap = await userRef.once("value");

        if (userSnap.exists()) {
            return interaction.editReply("❌ **এই ইউজারনেমটি ইতোমধ্যে ব্যবহৃত হয়েছে!** অনুগ্রহ করে অন্য একটি ইউজারনেম চেষ্টা করুন।");
        }

        let daysToAdd = 7;
        if (category === "monthly") daysToAdd = 30;
        else if (category === "2_months") daysToAdd = 60;

        const expiresAtMs = Date.now() + (daysToAdd * 24 * 60 * 60 * 1000);

        // 🎯 FIXED: username ফিল্ডটি ডেটাবেজে সঠিকভাবে সেভ হচ্ছে
        await userRef.set({
            username: usernameInput, // 👈 C++ অ্যাপ্লিকেশনে প্রদর্শন সহজ করার জন্য এটি আবশ্যক
            password: passwordInput,
            status: "active",
            category: category,
            discordId: userId,
            createdAt: Date.now(),
            expiresAt: expiresAtMs,
            hwid: "" // প্রথমবার C++ থেকে লগইন করলে অটোমেটিক HWID সেট হয়ে যাবে
        });

        await db.ref(`pending_payments/${userId}_${category}`).remove();

        const createdEmbed = new EmbedBuilder()
            .setTitle("🎉 Account Created Successfully!")
            .setDescription(
                `আপনার C++ অ্যাপ্লিকেশন অ্যাকাউন্টটি সফলভাবে তৈরি করা হয়েছে।\n\n` +
                `👤 **Username:** \`${usernameInput}\`\n` +
                `🔒 **Password:** \`${passwordInput}\`\n` +
                `⏳ **Validity:** \`${daysToAdd}\` দিন\n\n` +
                `⚠️ **সতর্কতা:** এই লগইন তথ্যাদি অন্য কারো সাথে শেয়ার করবেন না।`
            )
            .setColor("#00FF00")
            .setTimestamp();

        return interaction.editReply({ embeds: [createdEmbed] });
    }
});

// ================================
// 🚀 Bot Startup Logic
// ================================

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

client.once("ready", () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    setBotPresence();
});

startBot();
