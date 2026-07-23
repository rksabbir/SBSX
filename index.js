// ================================================
// 🚀 PART 1 - Setup + Express + Firebase + Config
// ================================================

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

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus
} = require("@discordjs/voice");

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

// ================================================
// ⚙️ Bot Config & Automod Rules
// ================================================

const TOKEN = process.env.TOKEN;
const ALLOWED_GUILD_ID = "1488101970425155584";
const VERIFIED_ROLE_ID = "1488333841402691664";

const WELCOME_CHANNEL_ID = "1488339169821593731";
const LOG_CHANNEL_ID = "1488340400673656973";
const VOICE_CHANNEL_ID = "1523230098193383595";

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

// New Configs from User Requirements
const STATS_VC_CHANNEL_ID = "1524321192079786005";
const LEVEL_ROLE_ID = "1524322087295127552";
const GIVEAWAY_CHANNEL_ID = "1488341249739198585";
const EMBED_NOTICE_CHANNEL_ID = "1488338739850772641";
const SOCIAL_FEED_CHANNEL_ID = "1488338739850772641";
const STAFF_ADMIN_LOG_ID = "1524324771502882877";
const WEEKLY_REPORT_CHANNEL_ID = "1524326280923709550";
const TRANSCRIPT_LOG_CHANNEL_ID = "1524326928268660807";
const AUDIO_STREAM_URL = "https://server11.fmlistening.com/8056_time"; // Quran Audio Stream

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

// ================================================
// 🔑 NEW FEATURE: Credentials Generator
// ================================================
function generateCredentials(discordUser) {
    const cleanName = discordUser.username.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const randomPass = Math.random().toString(36).slice(-8);

    return {
        username: `${cleanName || 'user'}_${randomNum}`,
        password: `pass_${randomPass}`
    };
}

// Firebase থেকে ডেটা নিয়ে আসার ফাংশন
async function fetchFirebasePanelData(panelType) {
    try {
        const snapshot = await db.ref(`panels/${panelType}`).once("value");
        const data = snapshot.val() || {};
        
        const customDescription = data.description || null;
        const customImage = data.image || null;

        const options = Object.keys(data)
            .filter(key => key !== "description" && key !== "image" && key !== "title")
            .map(key => ({
                label: data[key],
                value: key
            }));

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

// ================================================
// 📂 Database Helper Functions
// ================================================

function getSavedMembers() { if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([]), "utf8"); return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
function saveMembers(memberIds) { fs.writeFileSync(DATA_FILE, JSON.stringify(memberIds, null, 2), "utf8"); }
function getWelcomeLogs() { if (!fs.existsSync(WELCOME_LOG_FILE)) fs.writeFileSync(WELCOME_LOG_FILE, JSON.stringify({}), "utf8"); return JSON.parse(fs.readFileSync(WELCOME_LOG_FILE, "utf8")); }
function saveWelcomeLog(userId, messageId, data = {}) { const logs = getWelcomeLogs(); logs[userId] = { messageId, ...data }; fs.writeFileSync(WELCOME_LOG_FILE, JSON.stringify(logs, null, 2), "utf8"); }
function getPunishments() { if (!fs.existsSync(PUNISH_FILE)) fs.writeFileSync(PUNISH_FILE, JSON.stringify({}), "utf8"); return JSON.parse(fs.readFileSync(PUNISH_FILE, "utf8")); }
function savePunishment(userId, status, durationMs = null) { const punishments = getPunishments(); if (status === null) { delete punishments[userId]; } else { punishments[userId] = { status: status, time: Date.now(), expiresAt: durationMs ? Date.now() + durationMs : null }; } fs.writeFileSync(PUNISH_FILE, JSON.stringify(punishments, null, 2), "utf8"); }
function getOrderLogs() { if (!fs.existsSync(ORDER_LOG_FILE)) fs.writeFileSync(ORDER_LOG_FILE, JSON.stringify({}), "utf8"); return JSON.parse(fs.readFileSync(ORDER_LOG_FILE, "utf8")); }
function saveOrderLog(channelId, trackingMessageId, orderDetails) { const logs = getOrderLogs(); logs[channelId] = { trackingMessageId, ...orderDetails }; fs.writeFileSync(ORDER_LOG_FILE, JSON.stringify(logs, null, 2), "utf8"); }

// ================================================
// 🎉 Dynamic Welcome Embed Builder
// ================================================

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

// ================================================
// 🛒 Order Status Embed Builder
// ================================================
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

// ================================================
// ⚡ PART 3 - Interaction Handling
// ================================================

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

    // ড্রপডাউন সিলেকশন এবং কুপন মোডাল ট্রিগার
    if (interaction.isStringSelectMenu() && (interaction.customId.startsWith("select_product_") || interaction.customId.startsWith("select_report_") || interaction.customId.startsWith("select_customer_") || interaction.customId.startsWith("select_buy_"))) {
        const value = interaction.values[0];
        if (value === "none" || value === "error") return interaction.reply({ content: "❌ অবৈধ অপশন!", flags: [MessageFlags.Ephemeral] });

        let type = "";
        let embedColor = "";
        let buttonId = "";

        if (interaction.customId === "select_product_ticket") {
            type = "ticket"; embedColor = "#5865F2"; buttonId = `create_ticket_${value}`;
        } else if (interaction.customId === "select_report_category") {
            type = "report"; embedColor = "#ED4245"; buttonId = `create_report_${value}`;
        } else if (interaction.customId === "select_customer_category") {
            type = "customer"; embedColor = "#57F287"; buttonId = `create_customer_${value}`;
        } else if (interaction.customId === "select_buy_category") {
            type = "order"; embedColor = "#9B59B6"; buttonId = `pay_gateway_${value}`;
        }

        if (type === "order") {
            const modal = new ModalBuilder().setCustomId(`modal_coupon_${value}`).setTitle("🎟️ Coupon / Discount Code");
            const couponInput = new TextInputBuilder()
                .setCustomId("coupon_code_input") .setLabel("কুপন কোড দিন (না থাকলে ফাঁকা রাখুন)")
                .setStyle(TextInputStyle.Short)
                .setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(couponInput));
            return interaction.showModal(modal);
        }
    }

    // কুপন মোডাল সাবমিট
    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_coupon_")) {
        const category = interaction.customId.split("_")[2];
        const couponCode = interaction.fields.getTextInputValue("coupon_code_input").trim();

        const modal = new ModalBuilder().setCustomId(`modal_payment_${category}_${couponCode || "NONE"}`).setTitle("💳 Payment Details Submission");
        const txnInput = new TextInputBuilder()
            .setCustomId("txn_id_input")
            .setLabel("আপনার Transaction ID টি সঠিক ভাবে লিখুন")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(txnInput));
        return interaction.showModal(modal);
    }

    // ================================================
    // 💳 NEW FEATURE: Automated Payment -> Account Creation System
    // ================================================
    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_payment_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const parts = interaction.customId.split("_");
        const category = parts[2];
        const coupon = parts[3] || "NONE";
        const txnId = interaction.fields.getTextInputValue("txn_id_input").trim();

        try {
            // 🔍 ১. Firebase Database থেকে Transaction ID ভ্যালিডেশন চেক
            const txnRef = db.ref(`transactions/${txnId}`);
            const txnSnap = await txnRef.once("value");

            if (!txnSnap.exists()) {
                return interaction.editReply("❌ **অকার্যকর Transaction ID!** এই Transaction ID-টি আমাদের সিস্টেমে পাওয়া যায়নি।");
            }

            const txnData = txnSnap.val();

            // ট্রানজেকশনের used ফ্লাগ চেক
            const isUsed = txnData.used === true || txnData["used "] === true;
            const isStatusActive = txnData.status !== false;

            if (!isStatusActive) {
                return interaction.editReply("❌ **Transaction বাতিল করা হয়েছে!** এই পেমেন্টটি বর্তমানে সক্রিয় নয়।");
            }

            if (isUsed) {
                return interaction.editReply("❌ **Transaction ID ইতোমধ্যে ব্যবহৃত হয়েছে!** এটি দিয়ে পূর্বে একটি অ্যাকাউন্ট তৈরি করা হয়েছে।");
            }

            // 🔑 ২. অটোমেটিক ইউনিক ইউজারনেম ও পাসওয়ার্ড জেনারেট
            const creds = generateCredentials(interaction.user);
            const subDays = txnData.days || 30; // ডিফল্ট ৩০ দিন
            const expiryTimestamp = Date.now() + (subDays * 24 * 60 * 60 * 1000);

            // 💾 ৩. C++ Loader / App-এর জন্য Firebase-এ ইউজার ডাটা সংরক্ষণ
            await db.ref(`users/${creds.username}`).set({
                username: creds.username,
                password: creds.password,
                discordId: interaction.user.id,
                product: txnData.product || category,
                amount: txnData.amount || 0,
                status: "active",
                createdAt: Date.now(),
                expiresAt: expiryTimestamp,
                hwid: "" // C++ Loader প্রথম লগইনে অটো HWID বাইন্ড করবে
            });

            // 🔥 ৪. Transaction ID Burn / Used মার্ক করা
            await txnRef.update({
                used: true,
                "used ": true,
                usedBy: interaction.user.id,
                usedAt: Date.now(),
                assignedUser: creds.username
            });

            // 📁 ৫. প্রাইভেট অর্ডার চ্যানেল তৈরি
            const randomCode = Math.floor(1000 + Math.random() * 9000); 
            let supportRoleId = ROLES.SUPPORT_CUSTOMER;
            let channelPrefix = `order-${randomCode}`; 

            const permissionOverwrites = [
                { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: VERIFIED_ROLE_ID, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
            ];

            if (interaction.guild.roles.cache.has(supportRoleId)) permissionOverwrites.push({ id: supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
            if (interaction.guild.roles.cache.has(ROLES.ADMIN)) permissionOverwrites.push({ id: ROLES.ADMIN, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] });

            const privateChannel = await interaction.guild.channels.create({
                name: channelPrefix,
                type: 0,
                permissionOverwrites: permissionOverwrites
            });

            // 📩 ৬. প্রাইভেট চ্যানেলে ক্রেডেনশিয়াল এমবেড পাঠানো
            const insideEmbed = new EmbedBuilder()
                .setTitle(`🎉 Payment Verified & Account Created!`)
                .setDescription(`স্বাগতম ${interaction.user}!\nআপনার পেমেন্ট ভেরিফাই করা হয়েছে এবং অ্যাকাউন্ট তৈরি সম্পন্ন হয়েছে।\n\n**🛒 প্রোডাক্ট:** \`${txnData.product || category.toUpperCase()}\`\n**💳 Transaction ID:** \`${txnId}\`

🔑 **Software / App Login Credentials:**
> 👤 **Username:** \`${creds.username}\`
> 🔑 **Password:** \`${creds.password}\`
> 📅 **মেয়াদ:** <t:${Math.floor(expiryTimestamp / 1000)}:R>

⚠️ *নিরাপত্তার স্বার্থে আপনার ইউজারনেম ও পাসওয়ার্ড কারো সাথে শেয়ার করবেন না।*`)
                .setColor("Green")
                .setTimestamp();

            const staffButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`claim_order`).setLabel("🛟 Claim Staff").setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`approve_order`).setLabel("✅ Approve").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`close_order`).setLabel("🔒 Close").setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`ban_panel_order`).setLabel("🚫 Ban/Timeout").setStyle(ButtonStyle.Danger)
            );

            await privateChannel.send({ content: `${interaction.user}`, embeds: [insideEmbed], components: [staffButtons] });

            // 📬 ৭. ইউজারের ইনবক্সে (DM) লগইন পাসওয়ার্ড পাঠানো
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle("🔑 Your Software Login Credentials")
                    .setDescription(`ধন্যবাদ আপনার ক্রয়ের জন্য! আপনার প্রোডাক্ট ব্যবহারের জন্য লগইন তথ্য নিচে দেওয়া হলো:\n\n👤 **Username:** \`${creds.username}\`\n🔑 **Password:** \`${creds.password}\`\n⏳ **Status:** Active`)
                    .setColor("Blue")
                    .setTimestamp();
                await interaction.user.send({ embeds: [dmEmbed] });
            } catch (dmErr) {
                console.log("❌ DM Closed:", dmErr);
            }

            // 📊 ৮. ট্র্যাকিং চ্যানেল আপডেট
            const trackingChannel = interaction.guild.channels.cache.get(ORDER_TRACKING_CHANNEL_ID);
            if (trackingChannel) {
                const trackingEmbed = buildOrderStatusEmbed(interaction.user, category, privateChannel, "pending", null, null, txnId);
                const trackingMsg = await trackingChannel.send({ embeds: [trackingEmbed] }).catch(() => {});
                if (trackingMsg) {
                    saveOrderLog(privateChannel.id, trackingMsg.id, { 
                        userId: interaction.user.id, 
                        category: category, 
                        status: "pending", 
                        txnId: txnId,
                        username: creds.username 
                    });
                }
            }

            return interaction.editReply(`✅ **পেমেন্ট ভেরিফাই হয়েছে!** আপনার অ্যাকাউন্ট তৈরি সম্পূর্ণ হয়েছে এবং অর্ডার চ্যানেল তৈরি করা হয়েছে: ${privateChannel}`);

        } catch (err) {
            console.error("❌ Payment Processing Error:", err);
            return interaction.editReply("❌ **প্রসেসিংয়ে ত্রুটি ঘটেছে!** অনুগ্রহ করে অ্যাডমিনের সাথে যোগাযোগ করুন।");
        }
    }
});

// ================================================
// 🔊 VOICE & PRESENCE FUNCTIONS
// ================================================

function setBotPresence() {
    client.user.setPresence({
        activities: [{ name: "Security & Verification", type: ActivityType.Watching }],
        status: "online"
    });
}

// 24/7 Quran Play Connection
async function connectVoice(guild) {
    try {
        const channel = guild.channels.cache.get(VOICE_CHANNEL_ID);
        if (!channel) return;
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: true,
            selfMute: false
        });

        const player = createAudioPlayer();
        const resource = createAudioResource(AUDIO_STREAM_URL);
        player.play(resource);
        connection.subscribe(player);

        player.on(AudioPlayerStatus.Idle, () => {
            const nextResource = createAudioResource(AUDIO_STREAM_URL);
            player.play(nextResource);
        });

    } catch (e) {
        console.error("❌ Voice Connect Error:", e);
    }
}

client.once("ready", () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    setBotPresence();
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (guild) connectVoice(guild);
});

client.on("voiceStateUpdate", async () => {
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (guild && guild.members.me && !guild.members.me.voice.channel) await connectVoice(guild);
});

// ================================================
// 🚀 BOT STARTUP
// ================================================

client.login(TOKEN);
