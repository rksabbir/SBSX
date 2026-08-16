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
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences // 👈 এটি যুক্ত করা হলো
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

    // 🟢 ফিক্সড: C++ অ্যাপের সঠিক রিডের জন্য avatarUrl ও অন্যান্য ফিল্ড নিশ্চিত করা হয়েছে
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

        const txnId = interaction.fields.getTextInputValue("txn_id_input").trim();
        const userId = interaction.user.id;
        const sessionRef = db.ref(`pending_payments/${userId}_${category}`);

        try {
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

            await txnRef.update({
                used: true,
                usedBy: userId,
                usedAt: Date.now()
            });

            await sessionRef.update({
                category: category,
                targetPrice: targetPrice,
                totalPaid: currentTotalPaid,
                usedTxns: usedTxns,
                lastUpdated: Date.now()
            });

            if (currentTotalPaid < targetPrice) {
                const remainingDue = targetPrice - currentTotalPaid;

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
                    expiresAt: Date.now() + (90 * 24 * 60 * 60 * 1000),
                    status: "active"
                };

                await db.ref(`coupons/${createdCouponCode}`).set(newCouponObj);
            }

            if (sessionData.appliedCoupon) {
                await db.ref(`coupons/${sessionData.appliedCoupon}`).update({
                    status: "used",
                    usedBy: userId,
                    usedAt: Date.now()
                });
            }

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

    // 🌟 FULL AUTOMATED ACCOUNT CREATION & SYNC FOR C++ APP
    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_create_account_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const rawCategory = interaction.customId.split("_")[3].toLowerCase();
        const category = getNormalizedCategory(rawCategory);

        const customUser = interaction.fields.getTextInputValue("custom_username").trim().toLowerCase();
        const customPass = interaction.fields.getTextInputValue("custom_password").trim();
        const userId = interaction.user.id;
        const userAvatarUrl = interaction.user.displayAvatarURL({ extension: "png", dynamic: true, size: 512 });
        const serverName = interaction.guild ? interaction.guild.name : "Discord Server";

        const sessionRef = db.ref(`pending_payments/${userId}_${category}`);
        const sessionSnap = await sessionRef.once("value");
        const sessionData = sessionSnap.val();

        if (!sessionData || sessionData.totalPaid < sessionData.targetPrice) {
            return interaction.editReply("❌ **পেমেন্ট অসম্পূর্ণ!** সম্পূর্ণ টাকা পরিশোধ করুন।");
        }

        try {
            const existingUserSnap = await db.ref(`users/${customUser}`).once("value");
            if (existingUserSnap.exists()) {
                const userData = existingUserSnap.val();
                if (userData.expiresAt && userData.expiresAt > Date.now()) {
                    return interaction.editReply(`❌ **Username Already Exists!** \`${customUser}\` নামটি অন্য কারো ব্যবহৃত।`);
                }
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

            // 🔥 ফিক্সড: C++ অ্যাপের সাথে সিঙ্ক রাখার জন্য এখানে avatarUrl ও username সঠিকভাবে সেভ করা হলো
            await db.ref(`users/${customUser}`).set({
                username: customUser,         
                password: customPass,
                discordId: userId,
                avatarUrl: userAvatarUrl,    
                serverName: serverName,      
                category: category,          
                package: packageName,        
                paidAmount: sessionData.totalPaid,
                usedTxns: sessionData.usedTxns,
                createdAt: Date.now(),
                expiresAt: expiryTimestamp,  
                status: "active"             
            });

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

            const orderEmbed = new EmbedBuilder()
                .setTitle(`🛍️ NEW MEMBERSHIP ORDER CONFIRMED`)
                .setColor("#00FF00")
                .setThumbnail(userAvatarUrl)
                .addFields(
                    { name: "👤 কাস্টমার", value: `${interaction.user}`, inline: true },
                    { name: "📦 প্যাকেজ", value: `\`${packageName.toUpperCase()}\``, inline: true },
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
            return interaction.editReply("❌ **অ্যাকাউন্ট তৈরিতে ত্রুটি ঘটেছে!**");
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

    if (interaction.isButton() && interaction.customId.startsWith("close_")) {
        const orderLogs = getOrderLogs();
        const currentOrder = orderLogs[interaction.channel.id];

        try {
            const transcript = await discordTranscripts.createTranscript(interaction.channel, {
                limit: -1, returnType: 'attachment', filename: `${interaction.channel.name}-transcript.html`, saveImages: true, poweredBy: false
            });

            const transcriptLogChan = interaction.guild.channels.cache.get(TRANSCRIPT_LOG_CHANNEL_ID);
            if (transcriptLogChan) {
                await transcriptLogChan.send({
                    content: `📜 **Transcript Log:** \`#${interaction.channel.name}\` | Closed by ${interaction.user}`,
                    files: [transcript]
                });
            }
        } catch (tErr) {}

        await interaction.reply("🔒 চ্যানেলটি ৫ সেকেন্ডের মধ্যে ডিলিট হবে।");

        setTimeout(async () => {
            await interaction.channel.delete().catch(() => {});
        }, 5000);
    }
});

// ================================
// ⚡ PART 4 - Live UI Panels Templates
// ================================

async function getDynamicOrderGuidePanel() {
    const { customDescription, customImage, fullData } = await fetchFirebasePanelData("order_guide");
    const defaultTitle = "📦 HOW TO ORDER & SYSTEM GUIDE";
    const defaultDesc = `🛒 **আমাদের সার্ভার থেকে অর্ডার করার নিয়মাবলী** 🛒`;

    const embed = new EmbedBuilder()
        .setTitle(fullData.title || defaultTitle)
        .setDescription(customDescription || defaultDesc)
        .setColor("#FFAA00")
        .setTimestamp()
        .setFooter({ text: "Order Guide System", iconURL: client.user.displayAvatarURL() });

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
        .setColor("#5865F2")
        .setFooter({ text: "Official Support Panel", iconURL: client.user.displayAvatarURL() });

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
        .setPlaceholder("👇 ড্রপডাউন মেনু থেকে সহায়তার ক্যাটাগরি সিলেক্ট করুন...")
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
        .setColor("#F1C40F")
        .setFooter({ text: "Developer Portal System", iconURL: client.user.displayAvatarURL() });

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
        .setPlaceholder("👇 কী জেনারেট করতে নিচের ড্রপডাউন সিলেক্ট করুন...")
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

// Admin Commands
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild || message.guild.id !== ALLOWED_GUILD_ID) return;

    const isServerAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator) || message.member.roles.cache.has(ROLES.ADMIN);
    if (!isServerAdmin) return;

    if (message.content === "!setup") return message.channel.send({ embeds: [createVerificationEmbed()], components: [verificationRow] });
    if (message.content === "!ticket" && message.channelId === CHANNELS.TICKET_PANEL) return message.channel.send(await getDynamicTicketPanel());
    if (message.content === "!report" && message.channelId === CHANNELS.REPORT_PANEL) return message.channel.send(await getDynamicReportPanel());
    if (message.content === "!customer" && message.channelId === CHANNELS.CUSTOMER_PANEL) return message.channel.send(await getDynamicCustomerPanel());
    if (message.content === "!payment" && message.channelId === CHANNELS.PAYMENT_PANEL) return message.channel.send(await getDynamicPaymentPanel());
    if (message.content === "!orderguide" && message.channelId === ORDER_GUIDE_CHANNEL_ID) return message.channel.send(await getDynamicOrderGuidePanel());

    // ১-টাইম কী জেনারেটর প্যানেল পাঠানোর কমান্ড (!onetime key বা !onetimekey)
    if (message.content === "!onetime key" || message.content === "!onetimekey") {
        if (ONETIME_KEY_CHANNEL_IDS.includes(message.channelId) || isServerAdmin) {
            return message.channel.send(await getDynamicOneTimeKeyPanel());
        }
    }
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
                snapshot.forEach((childSnapshot) => {
                    childSnapshot.ref.update({
                        avatarUrl: newAvatar,
                        discordUsername: newUsername,
                        lastUpdated: Date.now()
                    });
                });
                console.log(`⚡ [Queue Sync] Updated user node for Discord ID: ${userId}`);
            }

            // 2️⃣ keys (1TIME Key) নোড আপডেট (ফায়ারবেস)
            const keysRef = db.ref("keys");
            const keySnap = await keysRef.orderByChild("userId").equalTo(userId).once("value");

            if (keySnap.exists()) {
                keySnap.forEach((childSnapshot) => {
                    childSnapshot.ref.update({
                        avatarUrl: newAvatar,
                        username: newUsername,
                        lastUpdated: Date.now()
                    });
                });
                console.log(`⚡ [Queue Sync] Updated keys node for Discord ID: ${userId}`);
            }

        } catch (err) {
            console.error(`❌ Queue Update Error for User ${userId}:`, err);
        } finally {
            // প্রসেস হওয়া ইউজারকে কিউ থেকে সরিয়ে ফেলা
            updateQueue.delete(userId);
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
    const userId = newMember.id;
    const newAvatar = newMember.user.displayAvatarURL({ extension: "png", dynamic: true, size: 512 });
    const newUsername = newMember.user.username;

    // কিউতে তথ্য যোগ করা
    updateQueue.set(userId, { newAvatar, newUsername });
    processUpdateQueue();
});

// ২. মেম্বার গ্লোবাল ডিসকর্ড অবতার চেঞ্জ করলে
client.on("userUpdate", (oldUser, newUser) => {
    const userId = newUser.id;
    const newAvatar = newUser.displayAvatarURL({ extension: "png", dynamic: true, size: 512 });
    const newUsername = newUser.username;

    updateQueue.set(userId, { newAvatar, newUsername });
    processUpdateQueue();
});
client.on("ready", async () => {
    console.log(`🤖 Logged in as ${client.user.tag}!`);
    setBotPresence();

    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (!guild) return;

    db.ref("panels/payment").on("value", async () => {
        try {
            const payChan = guild.channels.cache.get(CHANNELS.PAYMENT_PANEL);
            if (!payChan) return;

            const messages = await payChan.messages.fetch({ limit: 10 }).catch(() => null);
            const botMsg = messages?.find(m => m.author.id === client.user.id);

            const updatedData = await getDynamicPaymentPanel();

            if (botMsg) {
                await botMsg.edit(updatedData).catch(err => console.error("❌ Payment Panel Edit Fail:", err));
                console.log("✅ Payment Panel Auto-Updated from Firebase!");
            }
        } catch (err) {
            console.error("❌ Realtime Sync Error on Payment Panel:", err);
        }
    });

    db.ref("panels/onetime_key").on("value", async () => {
        try {
            for (const keyChanId of ONETIME_KEY_CHANNEL_IDS) {
                const keyChan = guild.channels.cache.get(keyChanId);
                if (!keyChan) continue;

                const messages = await keyChan.messages.fetch({ limit: 5 }).catch(() => null);
                const botMsg = messages?.find(m => m.author.id === client.user.id);

                const updatedData = await getDynamicOneTimeKeyPanel();

                if (botMsg) {
                    await botMsg.edit(updatedData).catch(err => console.error("❌ OneTime Key Panel Edit Fail:", err));
                    console.log(`✅ OneTime Key Panel Auto-Updated from Firebase for channel: ${keyChanId}`);
                }
            }
        } catch (err) {
            console.error("❌ Realtime Sync Error on OneTime Key Panel:", err);
        }
    });

    db.ref("panels").on("value", async (snapshot) => {
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
    });
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
