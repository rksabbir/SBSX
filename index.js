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

// ================================
// ⚙️ Bot Config & Automod Rules
// ================================

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

    // 🛑 Caps-Lock Protection (৭০% এর বেশি বড় হাতের অক্ষর)
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

    // ড্রপডাউন সিলেকশন এবং ফিক্সড কুপন মোডাল ট্রিগার
    if (interaction.isStringSelectMenu() && (interaction.customId.startsWith("select_product_") || interaction.customId.startsWith("select_report_") || interaction.customId.startsWith("select_customer_") || interaction.customId.startsWith("select_buy_"))) {
        const value = interaction.values[0];
        if (value === "none" || value === "error") return interaction.reply({ content: "❌ অবৈধ অপশন!", flags: [MessageFlags.Ephemeral] });

        let type = ""; let embedColor = ""; let buttonId = "";
        if (interaction.customId === "select_product_ticket") { type = "ticket"; embedColor = "#5865F2"; buttonId = `create_ticket_${value}`; }
        else if (interaction.customId === "select_report_category") { type = "report"; embedColor = "#ED4245"; buttonId = `create_report_${value}`; }
        else if (interaction.customId === "select_customer_category") { type = "customer"; embedColor = "#57F287"; buttonId = `create_customer_${value}`; }
        else if (interaction.customId === "select_buy_category") { type = "order"; embedColor = "#9B59B6"; buttonId = `pay_gateway_${value}`; } 

        if (type === "order") {
            // [FIX 1 & FIX 2]: কাস্টম আইডি ছোট করা এবং লেবেল টেক্সট ৪৫ অক্ষরের নিচে নামিয়ে আনা
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

    // কুপন মোডাল সাবমিট সফল হ্যান্ডলিং (Interaction Failed ফিক্সড)
    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_coupon_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const category = interaction.customId.split("_")[2]; // সঠিক ইনডেক্স ২ নির্বাচন করা হয়েছে
        const couponEntered = interaction.fields.getTextInputValue("coupon_code_input").trim();
        
        let discountText = "কোনো ডিসকাউন্ট কুপন ব্যবহার করা হয়নি।";
        if (couponEntered.toUpperCase() !== "SKIP") {
            const couponSnap = await db.ref(`coupons/${couponEntered.toUpperCase()}`).once("value");
            if (couponSnap.exists()) {
                discountText = `🎉 কুপন কোড \`${couponEntered.toUpperCase()}\` সফলভাবে অ্যাপ্লাই হয়েছে! আপনি পাচ্ছেন **${couponSnap.val()}** স্পেশাল ছাড়!`;
            } else {
                discountText = "⚠️ আপনি যে কুপন কোডটি দিয়েছেন তা ভ্যালিড নয় বা এক্সপায়ার হয়েছে। রেগুলার প্রাইস প্রযোজ্য।";
            }
        }

        const payEmbed = new EmbedBuilder()
            .setTitle(`💳 Payment Gateway: ${category.toUpperCase().replace("_", " ")}`)
            .setDescription(`আপনার অর্ডারটি প্রসেস করতে নিচে দেওয়া **"Pay via Gateway"** বাটনে ক্লিক করে অটোমেটিক পেমেন্ট সম্পন্ন করুন এবং প্রাপ্ত Transaction ID সাবমিট করুন।\n\n🎁 **ডিসকাউন্ট স্ট্যাটাস:** ${discountText}`)
            .setColor("#9B59B6");
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`submit_txn_${category}`).setLabel("Pay via Gateway & Submit TxnID").setStyle(ButtonStyle.Primary));
        return interaction.editReply({ embeds: [payEmbed], components: [row] });
    }

    if (interaction.isButton() && interaction.customId.startsWith("submit_txn_")) {
        const category = interaction.customId.split("_")[2];
        const modal = new ModalBuilder().setCustomId(`modal_payment_${category}`).setTitle("🔒 Payment TxnID Verification");
        const txnInput = new TextInputBuilder().setCustomId("txn_id_input").setLabel("Enter Your Transaction ID (TxnID)").setPlaceholder("e.g. A1B2C3D4E5").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(txnInput));
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_payment_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const category = interaction.customId.split("_")[2];
        const txnId = interaction.fields.getTextInputValue("txn_id_input");
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

        const privateChannel = await interaction.guild.channels.create({ name: channelPrefix, type: 0, permissionOverwrites: permissionOverwrites });
        const insideEmbed = new EmbedBuilder().setTitle(`🛍️ Welcome to your Paid Order Channel`).setDescription(`স্বাগতম ${interaction.user}!\n**ক্যাটাগরি:** ${category.toUpperCase()}\n**Transaction ID:** \`${txnId}\``).setColor("Green");
        
        const staffButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`claim_order`).setLabel("🛟 Claim Staff").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`approve_order`).setLabel("✅ Approve").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`close_order`).setLabel("🔒 Close").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`ban_panel_order`).setLabel("🚫 Ban/Timeout").setStyle(ButtonStyle.Danger)
        );

        await privateChannel.send({ content: `${interaction.user}`, embeds: [insideEmbed], components: [staffButtons] });

        const trackingChannel = interaction.guild.channels.cache.get(ORDER_TRACKING_CHANNEL_ID);
        if (trackingChannel) {
            const trackingEmbed = buildOrderStatusEmbed(interaction.user, category, privateChannel, "pending", null, null, txnId);
            const trackingMsg = await trackingChannel.send({ embeds: [trackingEmbed] }).catch(() => {});
            if (trackingMsg) {
                saveOrderLog(privateChannel.id, trackingMsg.id, { userId: interaction.user.id, category: category, status: "pending", txnId: txnId });
            }
        }
        return interaction.editReply(`✅ পেমেন্ট সাবমিট হয়েছে এবং অর্ডার চ্যানেল তৈরি হয়েছে: ${privateChannel}`);
    }

    if (interaction.isButton() && interaction.customId.startsWith("create_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const dataArr = interaction.customId.split("_");
        const type = dataArr[1]; const category = dataArr.slice(2).join("_");
        const randomCode = Math.floor(1000 + Math.random() * 9000); 
        
        let supportRoleId = (type === "customer") ? ROLES.SUPPORT_CUSTOMER : ROLES.SUPPORT_TICKET_REPORT;
        let channelPrefix = `tikt-${randomCode}`; 

        const permissionOverwrites = [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: VERIFIED_ROLE_ID, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
        ];
        if (interaction.guild.roles.cache.has(supportRoleId)) permissionOverwrites.push({ id: supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
        if (interaction.guild.roles.cache.has(ROLES.ADMIN)) permissionOverwrites.push({ id: ROLES.ADMIN, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] });

        const privateChannel = await interaction.guild.channels.create({ name: channelPrefix, type: 0, permissionOverwrites: permissionOverwrites });
        const insideEmbed = new EmbedBuilder().setTitle(`Welcome to your ${type.toUpperCase()}`).setDescription(`স্বাগতম ${interaction.user}! ক্যাটাগরি: ${category.toUpperCase()}`).setColor("Random");
        
        const staffButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`claim_${type}`).setLabel("🛟 Claim Staff").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`approve_${type}`).setLabel("✅ Approve").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`close_${type}`).setLabel("🔒 Close").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`ban_panel_${type}`).setLabel("🚫 Ban/Timeout").setStyle(ButtonStyle.Danger)
        );

        await privateChannel.send({ content: `${interaction.user}`, embeds: [insideEmbed], components: [staffButtons] });

        const trackingChannel = interaction.guild.channels.cache.get(ORDER_TRACKING_CHANNEL_ID);
        if (trackingChannel && (type === "ticket" || type === "customer" || type === "report")) {
            const trackingEmbed = buildOrderStatusEmbed(interaction.user, category, privateChannel, "pending");
            const trackingMsg = await trackingChannel.send({ embeds: [trackingEmbed] }).catch(() => {});
            if (trackingMsg) {
                saveOrderLog(privateChannel.id, trackingMsg.id, { userId: interaction.user.id, category: category, status: "pending" });
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

        const orderLogs = getOrderLogs(); const currentOrder = orderLogs[interaction.channel.id];
        const trackingChannel = interaction.guild.channels.cache.get(ORDER_TRACKING_CHANNEL_ID);

        if (currentOrder && trackingChannel) {
            try {
                const msg = await trackingChannel.messages.fetch(currentOrder.trackingMessageId);
                if (msg) {
                    const targetUser = await client.users.fetch(currentOrder.userId).catch(() => "Unknown");
                    const updatedEmbed = buildOrderStatusEmbed(targetUser, currentOrder.category, interaction.channel, "approved", interaction.user, null, currentOrder.txnId || null);
                    await msg.edit({ embeds: [updatedEmbed] });
                    saveOrderLog(interaction.channel.id, msg.id, { ...currentOrder, status: "approved", staffId: interaction.user.id });
                }
            } catch(e) {}
        }
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("close_")) {
        const type = interaction.customId.split("_")[1];
        let reqRole = (type === "customer" || type === "order") ? ROLES.SUPPORT_CUSTOMER : ROLES.SUPPORT_TICKET_REPORT;
        if (!interaction.member.roles.cache.has(reqRole) && !interaction.member.roles.cache.has(ROLES.ADMIN)) return interaction.reply({ content: "❌ পারমিশন নেই!", flags: [MessageFlags.Ephemeral] });

        // HTML Transcript Backup
        try {
            const transcriptLogChan = interaction.guild.channels.cache.get(TRANSCRIPT_LOG_CHANNEL_ID);
            if (transcriptLogChan) {
                const attachment = await discordTranscripts.createTranscript(interaction.channel, {
                    limit: -1,
                    fileName: `transcript-${interaction.channel.name}.html`,
                    returnType: 'attachment',
                    poweredBy: false
                });
                await transcriptLogChan.send({
                    content: `📜 **টিকিট ব্যাকআপ লগ:** চ্যানেল \`#${interaction.channel.name}\` বন্ধ করেছেন ${interaction.user}.`,
                    files: [attachment]
                });
            }
        } catch (transErr) {
            console.error(transErr);
        }

        const orderLogs = getOrderLogs(); const currentOrder = orderLogs[interaction.channel.id];
        const staffOwnerId = currentOrder?.staffId || interaction.user.id;
        
        const feedbackRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`star_rating_1_${staffOwnerId}`).setLabel("⭐ 1").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`star_rating_2_${staffOwnerId}`).setLabel("⭐ 2").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`star_rating_3_${staffOwnerId}`).setLabel("⭐ 3").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`star_rating_4_${staffOwnerId}`).setLabel("⭐ 4").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`star_rating_5_${staffOwnerId}`).setLabel("⭐ 5").setStyle(ButtonStyle.Primary)
        );

        if (currentOrder) {
            const targetUserObj = await interaction.guild.members.fetch(currentOrder.userId).catch(() => null);
            if (targetUserObj) {
                await targetUserObj.send({ content: "👋 আমাদের সাপোর্ট টিম আপনাকে কেমন সাহায্য করলো? নিচে ক্লিক করে রেটিং দিন:", components: [feedbackRow] }).catch(() => {});
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
                    const logs = getOrderLogs(); delete logs[interaction.channel.id]; fs.writeFileSync(ORDER_LOG_FILE, JSON.stringify(logs, null, 2), "utf8");
                }
            } catch(e) {}
        }
        setTimeout(async () => { await interaction.channel.delete().catch(() => {}); }, 5000);
    }

    if (interaction.isButton() && interaction.customId.startsWith("ban_panel_")) {
        const type = interaction.customId.split("_")[2];
        let reqRole = (type === "customer" || type === "order") ? ROLES.SUPPORT_CUSTOMER : ROLES.SUPPORT_TICKET_REPORT;
        if (!interaction.member.roles.cache.has(reqRole) && !interaction.member.roles.cache.has(ROLES.ADMIN)) return interaction.reply({ content: "❌ পারমিশন নেই!", flags: [MessageFlags.Ephemeral] });
        const selectMenu = new StringSelectMenuBuilder().setCustomId("execute_ticket_ban").setPlaceholder("🚫 টাইমআউট/ব্যান এর সময় সিলেক্ট করুন...").addOptions([{ label: "১ দিন টাইমআউট (24 Hours Mute)", value: "1_day" }, { label: "৩ দিন টাইমআউট (72 Hours Mute)", value: "3_days" }, { label: "৭ দিন টাইমআউট (1 Week Mute)", value: "7_days" }, { label: "৩০ দিন টাইমআউট (1 Month Mute)", value: "30_days" }]);
        return interaction.reply({ content: "⚠️ ফানি উদ্দেশ্যে এটি ওপেন করার কারণে মেম্বারকে টাইমআউট করতে নিচের অপশন সিলেক্ট করুন।", components: [new ActionRowBuilder().addComponents(selectMenu)], flags: [MessageFlags.Ephemeral] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "execute_ticket_ban") {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }); const choice = interaction.values[0];
        const orderLogs = getOrderLogs(); const currentOrder = orderLogs[interaction.channel.id];
        if (!currentOrder) return interaction.editReply("❌ এই চ্যানেলের ট্র্যাকিং রেকর্ড পাওয়া যায়নি।");
        let durationMs = 0; let durationText = "";
        if (choice === "1_day") { durationMs = 1 * 24 * 60 * 60 * 1000; durationText = "১ দিন"; }
        else if (choice === "3_days") { durationMs = 3 * 24 * 60 * 60 * 1000; durationText = "৩ দিন"; }
        else if (choice === "7_days") { durationMs = 7 * 24 * 60 * 60 * 1000; durationText = "৭ দিন"; }
        else if (choice === "30_days") { durationMs = 30 * 24 * 60 * 60 * 1000; durationText = "৩০ দিন"; }
        const targetId = currentOrder.userId; savePunishment(targetId, "Muted", durationMs); 
        const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
        if (targetMember) { await targetMember.timeout(durationMs, `Fake/Funny Support Request by ${interaction.user.tag}`).catch(() => {}); }
        const trackingChannel = interaction.guild.channels.cache.get(ORDER_TRACKING_CHANNEL_ID);
        if (trackingChannel) { try { const msg = await trackingChannel.messages.fetch(currentOrder.trackingMessageId); if (msg) { const targetUser = await client.users.fetch(targetId).catch(() => "Unknown Member"); const updatedEmbed = buildOrderStatusEmbed(targetUser, currentOrder.category, `#${interaction.channel.name} (Banned)`, "banned", interaction.user, `ফেক/ফানি সাপোর্ট (${durationText} মিউট)`, currentOrder.txnId || null); await msg.edit({ embeds: [updatedEmbed] }); } } catch(e) {} }
        const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) { logChannel.send({ embeds: [new EmbedBuilder().setColor("Red").setTitle("🚫 Support Ban Imposed").setDescription(`**User:** <@${targetId}>\n**Punished By:** ${interaction.user}\n**Duration:** ${durationText}`)] }); }
        await interaction.editReply(`✅ সফলভাবে ব্যবহারকারীকে ${durationText} এর জন্য ব্যান করা হয়েছে।`);
        setTimeout(async () => { await interaction.channel.delete().catch(() => {}); }, 2000);
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
    const defaultDesc = `🛑 **Premium Support & Development Center** 🛑`;

    const embed = new EmbedBuilder()
        .setTitle("🎫 PREMIUM SUPPORT TICKET PANEL")
        .setDescription(customDescription || defaultDesc)
        .setImage(customImage || COVER_IMAGES.TICKET)
        .setColor("#5865F2")
        .setFooter({ text: "Premium Ticket System", iconURL: client.user.displayAvatarURL() });

    const menu = new StringSelectMenuBuilder().setCustomId("select_product_ticket").setPlaceholder("🛒 আপনার সাপোর্ট ক্যাটাগরি সিলেক্ট করুন...").addOptions(options); 
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] }; 
}

async function getDynamicReportPanel() { 
    const { options, customDescription, customImage } = await fetchFirebasePanelData("report");
    const defaultDesc = `🚨 **Server Automated Report & Complaint Center** 🚨`;

    const embed = new EmbedBuilder()
        .setTitle("🚨 SERVER COMPLAINT & REPORT PANEL")
        .setDescription(customDescription || defaultDesc)
        .setImage(customImage || COVER_IMAGES.REPORT)
        .setColor("#ED4245")
        .setFooter({ text: "Security System", iconURL: client.user.displayAvatarURL() });

    const menu = new StringSelectMenuBuilder().setCustomId("select_report_category").setPlaceholder("⚠️ আপনার রিপোর্টের ধরন সিলেক্ট করুন...").addOptions(options); 
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] }; 
}

async function getDynamicCustomerPanel() { 
    const { options, customDescription, customImage } = await fetchFirebasePanelData("customer");
    const defaultDesc = `💬 **General Customer Care & Help Counter** 💬`;

    const embed = new EmbedBuilder()
        .setTitle("💬 GENERAL CUSTOMER SUPPORT CENTER")
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
        const dutyRef = db.ref(`staff_duty/${message.author.id}`);
        const snap = await dutyRef.once("value");
        const data = snap.val();
        if (!data || data.status?.state !== "ON") return message.reply("⚠️ আপনি তো ডিউটিতে অন ছিলেন না!");

        const elapsedMs = Date.now() - data.status.startTime;
        const totalMinutes = Math.floor(elapsedMs / (1000 * 60));
        
        await dutyRef.child("totalMinutes").transaction(m => (m || 0) + totalMinutes);
        await dutyRef.child("status").set({ state: "OFF" });

        const staffLogChan = message.guild.channels.cache.get(STAFF_ADMIN_LOG_ID);
        if (staffLogChan) {
            const finalSnap = await dutyRef.once("value");
            const totalClaims = finalSnap.val().claims || 0;
            const updatedMinutes = finalSnap.val().totalMinutes || 0;

            const logEmbed = new EmbedBuilder()
                .setTitle("🕒 STAFF DUTY REPORT")
                .setColor("Orange")
                .addFields(
                    { name: "👤 স্টাফ", value: `${message.author}`, inline: true },
                    { name: "⏱️ এই সেশনের সময়", value: `\`${totalMinutes}\` মিনিট`, inline: true },
                    { name: "📊 মোট ডিউটি টাইম", value: `\`${updatedMinutes}\` মিনিট`, inline: true },
                    { name: "🎫 মোট হ্যান্ডেলড টিকেট", value: `\`${totalClaims}\` টি`, inline: true }
                )
                .setTimestamp();
            await staffLogChan.send({ embeds: [logEmbed] });
        }
        return message.reply(`🔴 ডিউটি অফ করা হয়েছে। সেশনে মোট \`${totalMinutes}\` মিনিট কাজ করেছেন।`);
    }

    // Giveaway command
    if (message.content.startsWith("!giveaway")) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator) && !message.member.roles.cache.has(ROLES.ADMIN)) return;
        const args = message.content.split(" ");
        const duration = parseInt(args[1]);
        const winnersCount = parseInt(args[2]);
        const prize = args.slice(3).join(" ");

        if (!duration || !winnersCount || !prize) return message.reply("⚠️ সঠিক ফরম্যাট: `!giveaway <সময় মিনিটে> <উইনার সংখ্যা> <পুরস্কারের নাম>`");

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
    if (message.content === "!guide" && message.channelId === ORDER_GUIDE_CHANNEL_ID) return message.channel.send(await getDynamicOrderGuidePanel());

    if ((message.content === "!payment" || message.content.toLowerCase() === "!payment") && 
        (message.channelId === CHANNELS.PAYMENT_PANEL || message.channelId === CHANNELS.BUY_PANEL)) {
        return message.channel.send(await getDynamicPaymentPanel());
    }
});

// ================================
// 🔥 REALTIME FIREBASE SYNC TO DISCORD
// ================================

function listenToFirebaseUpdates() {
    db.ref("embed_notices").on("child_added", async (snapshot) => {
        const data = snapshot.val();
        if (!data || data.posted) return;
        
        const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
        if (!guild) return;
        
        const noticeChan = guild.channels.cache.get(EMBED_NOTICE_CHANNEL_ID);
        if (noticeChan) {
            const embed = new EmbedBuilder()
                .setTitle(data.title || "📢 SERVER ANNOUNCEMENT")
                .setDescription(data.description || "")
                .setColor(data.color || "Blue")
                .setTimestamp();
            if (data.image) embed.setImage(data.image);
            await noticeChan.send({ embeds: [embed] });
            await snapshot.ref.update({ posted: true });
        }
    });

    db.ref("social_feeds").on("child_added", async (snapshot) => {
        const data = snapshot.val();
        if (!data || data.notified) return;

        const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
        if (!guild) return;

        const feedChan = guild.channels.cache.get(SOCIAL_FEED_CHANNEL_ID);
        if (feedChan) {
            const feedEmbed = new EmbedBuilder()
                .setTitle("🔔 NEW SOCIAL MEDIA UPDATE!")
                .setDescription(`🚀 আমাদের সোশ্যাল মিডিয়ায় একটি নতুন পোস্ট আপলোড করা হয়েছে!\n\n🔗 **লিংক:** [এখানে ক্লিক করুন](${data.link})`)
                .setColor("Red")
                .setTimestamp();
            await feedChan.send({ content: `@everyone`, embeds: [feedEmbed] });
            await snapshot.ref.update({ notified: true });
        }
    });

    db.ref("giveaway_panels").on("value", async (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
        if (!guild) return;

        const gwChan = guild.channels.cache.get(GIVEAWAY_CHANNEL_ID);
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
            const messages = await ticketChan.messages.fetch({ limit: 20 });
            const botMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0 && m.components[0].components[0].customId === "select_product_ticket");
            if (botMsg) { const updatedData = await getDynamicTicketPanel(); await botMsg.edit(updatedData).catch(() => {}); }
        }

        const reportChan = guild.channels.cache.get(CHANNELS.REPORT_PANEL);
        if (reportChan) {
            const messages = await reportChan.messages.fetch({ limit: 20 });
            const botMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0 && m.components[0].components[0].customId === "select_report_category");
            if (botMsg) { const updatedData = await getDynamicReportPanel(); await botMsg.edit(updatedData).catch(() => {}); }
        }

        const custChan = guild.channels.cache.get(CHANNELS.CUSTOMER_PANEL);
        if (custChan) {
            const messages = await custChan.messages.fetch({ limit: 20 });
            const botMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0 && m.components[0].components[0].customId === "select_customer_category");
            if (botMsg) { const updatedData = await getDynamicCustomerPanel(); await botMsg.edit(updatedData).catch(() => {}); }
        }

        const guideChan = guild.channels.cache.get(ORDER_GUIDE_CHANNEL_ID);
        if (guideChan) {
            const messages = await guideChan.messages.fetch({ limit: 20 });
            const botMsg = messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.components.length === 0);
            if (botMsg) { const updatedData = await getDynamicOrderGuidePanel(); await botMsg.edit(updatedData).catch(() => {}); }
        }

        const checkPaymentChannels = [CHANNELS.PAYMENT_PANEL, CHANNELS.BUY_PANEL];
        for (const chanId of checkPaymentChannels) {
            const payChan = guild.channels.cache.get(chanId);
            if (payChan) {
                const messages = await payChan.messages.fetch({ limit: 20 });
                const botMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0 && m.components[0].components[0].customId === "select_buy_category");
                if (botMsg) { const updatedData = await getDynamicPaymentPanel(); await botMsg.edit(updatedData).catch(() => {}); }
            }
        }
    });
}

// 🕒 প্রতি ৫ মিনিট পর পর লাইভ ইন্টারভাল রান
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
                    .setDescription(`**পুরস্কার:** \`${gw.prize}\`\n🎉 **উইনারগণ:** ${winText}`)
                    .setColor("Green")
                    .setTimestamp();
                
                await gwChan.send({ content: `🎊 অভিনন্দন উইনারদের! ${winText}`, embeds: [endEmbed] });
                await db.ref(`giveaways/${gwId}/ended`).set(true);
            }
        }
    }
}, 5 * 60 * 1000);

// উইকলি গ্রোথ অ্যানালিটিক্স রিপোর্ট (প্রতি রবিবার রাত ১২ টায়)
setInterval(async () => {
    const d = new Date();
    if (d.getDay() === 0 && d.getHours() === 0 && d.getMinutes() === 0) {
        const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
        if (!guild) return;

        const reportChan = guild.channels.cache.get(WEEKLY_REPORT_CHANNEL_ID);
        if (reportChan) {
            const joinsSnap = await db.ref("analytics/joins").once("value");
            const leavesSnap = await db.ref("analytics/leaves").once("value");

            const totalJoins = joinsSnap.exists() ? Object.keys(joinsSnap.val()).length : 0;
            const totalLeaves = leavesSnap.exists() ? Object.keys(leavesSnap.val()).length : 0;
            const statusRatio = totalJoins - totalLeaves;

            const weeklyEmbed = new EmbedBuilder()
                .setTitle("📈 WEEKLY SERVER GROWTH & STATS REPORT")
                .setColor("Green")
                .setDescription(`সার্ভারের গত সপ্তাহের মেম্বার জয়েন ও লিভের ডাটা অ্যানালাইসিস:`)
                .addFields(
                    { name: "📥 মোট জয়েন মেম্বার", value: `\`${totalJoins}\` জন`, inline: true },
                    { name: "📤 মোট লিভ মেম্বার", value: `\`${totalLeaves}\` জন`, inline: true },
                    { name: "📊 নেট গ্রোথ রেশিও", value: `\`${statusRatio >= 0 ? "+" + statusRatio : statusRatio}\` মেম্বার`, inline: false }
                )
                .setTimestamp();

            await reportChan.send({ embeds: [weeklyEmbed] });

            await db.ref("analytics/joins").remove();
            await db.ref("analytics/leaves").remove();
        }
    }
}, 60000);

// ================================
// 🚀 PART 5 - Live Member Events & Smart Sync Recovery
// ================================

client.on("guildMemberAdd", async (member) => {
    if (member.guild.id !== ALLOWED_GUILD_ID) return; const saved = getSavedMembers(); if (!saved.includes(member.id)) { saved.push(member.id); saveMembers(saved); }
    const punishments = getPunishments(); if (punishments[member.id] && punishments[member.id].status === "Muted") { const record = punishments[member.id]; const now = Date.now(); if (!record.expiresAt || record.expiresAt > now) { const remainingTime = record.expiresAt ? record.expiresAt - now : 10 * 60 * 1000; try { await member.timeout(remainingTime, "Automod Bypass Block"); const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID); if (welcomeChannel) { welcomeChannel.send(`⚠️ মেম্বার <@${member.id}> তার আগের মিউট শাস্তি ফাঁকি দেওয়ার জন্য লিভ নিয়ে পুনরায় জয়েন করায় তাকে আবার মিউট করা হয়েছে।`); } } catch(e) {} } else { savePunishment(member.id, null); } }
    const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID); if (welcomeChannel) { const embed = buildDynamicWelcomeEmbed(member, "unverified", false); const msg = await welcomeChannel.send({ content: `🎉 স্বাগতম ${member}!`, embeds: [embed] }).catch(() => {}); if (msg) saveWelcomeLog(member.id, msg.id, { isOffline: false }); }
});

client.on("guildMemberRemove", async (member) => {
    if (member.guild.id !== ALLOWED_GUILD_ID) return; const saved = getSavedMembers(); saveMembers(saved.filter(id => id !== member.id));
    
    db.ref(`analytics/leaves/${Date.now()}`).set(member.id);

    const logs = getWelcomeLogs(); const userLog = logs[member.id]; const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (userLog && welcomeChannel) { try { const msg = await welcomeChannel.messages.fetch(userLog.messageId); if (msg) { const updatedEmbed = buildDynamicWelcomeEmbed(member, "left", userLog.isOffline); await msg.edit({ content: `🚫 **${member.user.tag}** সার্ভার থেকে বিদায় নিয়েছেন।`, embeds: [updatedEmbed] }); } } catch (e) {} }
});

client.once("clientReady", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`); 
    setBotPresence();
    listenToFirebaseUpdates();

    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID); 
    if (!guild) return;
    await connectVoice(guild); 
    const welcomeChannel = guild.channels.cache.get(WELCOME_CHANNEL_ID);
    
    try {
        const currentMembers = await guild.members.fetch(); 
        const savedMembers = getSavedMembers(); 
        const logs = getWelcomeLogs(); 
        const punishments = getPunishments(); 
        const now = Date.now();
        
        if (savedMembers.length === 0) {
            const initialIds = currentMembers.filter(m => !m.user.bot).map(m => m.id);
            saveMembers(initialIds);
            return;
        }

        const missedJoins = currentMembers.filter(m => !savedMembers.includes(m.id) && !m.user.bot);
        if (missedJoins.size > 0 && welcomeChannel) { 
            for (const [, member] of missedJoins) { 
                if (punishments[member.id] && punishments[member.id].status === "Muted") { 
                    const record = punishments[member.id]; 
                    if (!record.expiresAt || record.expiresAt > now) { 
                        const remaining = record.expiresAt ? record.expiresAt - now : 10 * 60 * 1000; 
                        await member.timeout(remaining, "Offline Sync Guard").catch(()=>{}); 
                    } 
                } 
                const embed = buildDynamicWelcomeEmbed(member, "unverified", true); 
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
                            const mockMember = { id: leftId, userId: leftId, user: { tag: "Offline Left Member" } }; 
                            const updatedEmbed = buildDynamicWelcomeEmbed(mockMember, "left", true); 
                            await msg.edit({ content: `🚫 একটি ইউজার বট অফলাইনে থাকা অবস্থায় সার্ভার ত্যাগ করেছেন।`, embeds: [updatedEmbed] }); 
                        } 
                    } catch (e) {} 
                } 
            } 
        }
        
        const finalIds = currentMembers.filter(m => !m.user.bot).map(m => m.id); 
        saveMembers(finalIds); 
    } catch (err) { 
        console.error("Sync Recovery Error:", err); 
    }
});

client.on("voiceStateUpdate", async () => { 
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID); 
    if (guild && guild.members.me && !guild.members.me.voice.channel) await connectVoice(guild); 
});

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
        const connection = joinVoiceChannel({ channelId: channel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true, selfMute: false }); 
        
        const player = createAudioPlayer();
        const resource = createAudioResource(AUDIO_STREAM_URL);
        player.play(resource);
        connection.subscribe(player);

        player.on(AudioPlayerStatus.Idle, () => {
            const nextResource = createAudioResource(AUDIO_STREAM_URL);
            player.play(nextResource);
        });

    } catch (e) { console.error("❌ Voice Connect Error:", e); } 
}

function startBot() { 
    client.login(TOKEN).catch((err) => { 
        console.error("❌ Login Failed, retrying in 5s...", err);
        setTimeout(startBot, 5000); 
    }); 
}

startBot();
