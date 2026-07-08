// ========================================================
// 🚀 PART 1 - Setup + Express + Firebase + Realtime Config
// ========================================================

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
app.get("/", (req, res) => { res.send("Bot is running perfectly with Realtime DB Auto-Edit System!"); });
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🌐 Web server running on port ${PORT}`); });

// ========================================================
// ⚙️ Static Constants Configuration
// ========================================================

const TOKEN = process.env.TOKEN;
const ALLOWED_GUILD_ID = "1488101970425155584";
const VERIFIED_ROLE_ID = "1488333841402691664";

const WELCOME_CHANNEL_ID = "1488339169821593731";
const LOG_CHANNEL_ID = "1488340400673656973";
const VOICE_CHANNEL_ID = "1523230098193383595"; // 🕋 আল কোরআন তিলাওয়াত চ্যানেল আইডি

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

const STATS_VC_CHANNEL_ID = "1524321192079786005"; // 👥 মেম্বার কাউন্টার চ্যানেল আইডি
const LEVEL_ROLE_ID = "1524322087295127552";
const GIVEAWAY_CHANNEL_ID = "1488341249739198585";
const EMBED_NOTICE_CHANNEL_ID = "1488338739850772641";
const SOCIAL_FEED_CHANNEL_ID = "1488338739850772641";
const STAFF_ADMIN_LOG_ID = "1524324771502882877";
const WEEKLY_REPORT_CHANNEL_ID = "1524326280923709550";
const TRANSCRIPT_LOG_CHANNEL_ID = "1524326928268660807";

// 🕋 গ্লোবাল স্ট্রিম ভেরিয়েবল (ফায়ারবেস থেকে লাইভ সিঙ্ক হবে)
let AUDIO_STREAM_URL = "https://stream.radiojar.com/0v9n06vcc9duv"; 

// 📁 Local JSON Storage
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

// 라이브 ক্যাш থেকে প্যানেলের ডেটা প্রসেস করার ফাংশন
function fetchFirebasePanelData(panelType) {
    const panels = globalFirebaseCache.panels || {};
    const data = panels[panelType] || {};
    
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
}

// ========================================================
// 🔄 100% Realtime Database Data Auto-Updater & Synchronizer
// ========================================================
let globalFirebaseCache = {};
let isFirstSync = true;

db.ref().on("value", async (snapshot) => {
    if (snapshot.exists()) {
        globalFirebaseCache = snapshot.val();
        console.log("⚡ [Realtime Database Sync]: ফায়ারবেসের নতুন ডেটা বোটে লাইভ আপডেট হয়েছে!");
        
        if (globalFirebaseCache.settings && globalFirebaseCache.settings.quran_stream_url) {
            AUDIO_STREAM_URL = globalFirebaseCache.settings.quran_stream_url;
        }

        // প্রথমবার বুট হওয়ার সময় মেসেজ এডিট স্কিপ করবে, শুধুমাত্র রিয়েল-টাইমে কেউ চেঞ্জ করলেই এডিট ট্রিগার হবে
        if (isFirstSync) {
            isFirstSync = false;
            return;
        }

        // 🛠️ ফায়ারবেস চেঞ্জ হলে অটোমেটিক ডিসকর্ডের পাঠানো প্যানেল মেসেজগুলো এডিট করার লজিক
        try {
            const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
            if (!guild) return;

            // ১. টিকেট প্যানেল অটো-এডিট
            const ticketChan = guild.channels.cache.get(CHANNELS.TICKET_PANEL);
            if (ticketChan) {
                const fetched = await ticketChan.messages.fetch({ limit: 20 }).catch(() => null);
                const botMsg = fetched?.find(m => m.author.id === client.user.id && m.components.length > 0);
                if (botMsg) {
                    const { options, customDescription, customImage, fullData } = fetchFirebasePanelData("ticket");
                    const embed = new EmbedBuilder()
                        .setTitle(fullData.title || "🎫 PREMIUM SUPPORT TICKET PANEL")
                        .setDescription(customDescription || "নিচের ড্রপডাউন থেকে আপনার ক্যাটাগরি সিলেক্ট করুন।")
                        .setColor("#5865F2")
                        .setImage(customImage || COVER_IMAGES.TICKET);
                    const row = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder().setCustomId("select_product_ticket").setPlaceholder("Choose a support category...").addOptions(options)
                    );
                    await botMsg.edit({ embeds: [embed], components: [row] }).catch(() => {});
                    console.log("✅ Ticket Panel Message Auto-Edited!");
                }
            }

            // ২. রিপোর্ট প্যানেল অটো-এডিট
            const reportChan = guild.channels.cache.get(CHANNELS.REPORT_PANEL);
            if (reportChan) {
                const fetched = await reportChan.messages.fetch({ limit: 20 }).catch(() => null);
                const botMsg = fetched?.find(m => m.author.id === client.user.id && m.components.length > 0);
                if (botMsg) {
                    const { options, customDescription, customImage, fullData } = fetchFirebasePanelData("report");
                    const embed = new EmbedBuilder()
                        .setTitle(fullData.title || "🚨 SERVER COMPLAINT & REPORT PANEL")
                        .setDescription(customDescription || "কাউকে রিপোর্ট করতে নিচের অপশন সিলেক্ট করুন।")
                        .setColor("#ED4245")
                        .setImage(customImage || COVER_IMAGES.REPORT);
                    const row = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder().setCustomId("select_report_category").setPlaceholder("Choose a report category...").addOptions(options)
                    );
                    await botMsg.edit({ embeds: [embed], components: [row] }).catch(() => {});
                    console.log("✅ Report Panel Message Auto-Edited!");
                }
            }

            // ৩. কাস্টমার প্যানেল অটো-এডিট
            const customerChan = guild.channels.cache.get(CHANNELS.CUSTOMER_PANEL);
            if (customerChan) {
                const fetched = await customerChan.messages.fetch({ limit: 20 }).catch(() => null);
                const botMsg = fetched?.find(m => m.author.id === client.user.id && m.components.length > 0);
                if (botMsg) {
                    const { options, customDescription, customImage, fullData } = fetchFirebasePanelData("customer");
                    const embed = new EmbedBuilder()
                        .setTitle(fullData.title || "💬 GENERAL CUSTOMER SUPPORT CENTER")
                        .setDescription(customDescription || "যেকোনো সাধারণ সাহায্যের জন্য ড্রপডাউনটি ব্যবহার করুন।")
                        .setColor("#57F287")
                        .setImage(customImage || COVER_IMAGES.CUSTOMER);
                    const row = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder().setCustomId("select_customer_category").setPlaceholder("Choose an inquiry type...").addOptions(options)
                    );
                    await botMsg.edit({ embeds: [embed], components: [row] }).catch(() => {});
                    console.log("✅ Customer Panel Message Auto-Edited!");
                }
            }

            // ৪. পেমেন্ট/শপ প্যানেল অটো-এডিট
            const buyChan = guild.channels.cache.get(CHANNELS.BUY_PANEL) || guild.channels.cache.get(CHANNELS.PAYMENT_PANEL);
            if (buyChan) {
                const fetched = await buyChan.messages.fetch({ limit: 20 }).catch(() => null);
                const botMsg = fetched?.find(m => m.author.id === client.user.id && m.components.length > 0);
                if (botMsg) {
                    const { options, customDescription, customImage, fullData } = fetchFirebasePanelData("payment");
                    const embed = new EmbedBuilder()
                        .setTitle(fullData.title || "🛍️ AUTOMATED SHOP & PAYMENT PANELS")
                        .setDescription(customDescription || "আমাদের সার্ভিস বা প্যাকেজ কিনতে নিচের ড্রপডাউন ব্যবহার করুন।")
                        .setColor("#9B59B6")
                        .setImage(customImage || COVER_IMAGES.PAYMENT);
                    const row = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder().setCustomId("select_buy_category").setPlaceholder("Select a service to order...").addOptions(options)
                    );
                    await botMsg.edit({ embeds: [embed], components: [row] }).catch(() => {});
                    console.log("✅ Shop/Payment Panel Message Auto-Edited!");
                }
            }

            // ৫. অর্ডার গাইড অটো-এডিট
            const guideChan = guild.channels.cache.get(ORDER_GUIDE_CHANNEL_ID);
            if (guideChan) {
                const fetched = await guideChan.messages.fetch({ limit: 20 }).catch(() => null);
                const botMsg = fetched?.find(m => m.author.id === client.user.id);
                if (botMsg) {
                    const panels = globalFirebaseCache.panels || {};
                    const guideData = panels["order_guide"] || {};
                    const embed = new EmbedBuilder()
                        .setTitle(guideData.title || "📦 HOW TO ORDER & SYSTEM GUIDE")
                        .setDescription(guideData.description || "আমাদের সার্ভার থেকে অর্ডার করার নিয়মাবলী।")
                        .setColor("#FFFF00")
                        .setImage(guideData.image || COVER_IMAGES.PAYMENT);
                    await botMsg.edit({ embeds: [embed] }).catch(() => {});
                    console.log("✅ Order Guide Message Auto-Edited!");
                }
            }

        } catch (editError) {
            console.error("❌ Auto-Edit Failed:", editError);
        }
    }
}, (error) => {
    console.error("❌ Realtime Sync Error:", error);
});

// ========================================================
// 📂 Database Helper Functions
// ========================================================

function getSavedMembers() { if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([]), "utf8"); return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
function saveMembers(memberIds) { fs.writeFileSync(DATA_FILE, JSON.stringify(memberIds, null, 2), "utf8"); }
function getWelcomeLogs() { if (!fs.existsSync(WELCOME_LOG_FILE)) fs.writeFileSync(WELCOME_LOG_FILE, JSON.stringify({}), "utf8"); return JSON.parse(fs.readFileSync(WELCOME_LOG_FILE, "utf8")); }
function saveWelcomeLog(userId, messageId, data = {}) { const logs = getWelcomeLogs(); logs[userId] = { messageId, ...data }; fs.writeFileSync(WELCOME_LOG_FILE, JSON.stringify(logs, null, 2), "utf8"); }
function getPunishments() { if (!fs.existsSync(PUNISH_FILE)) fs.writeFileSync(PUNISH_FILE, JSON.stringify({}), "utf8"); return JSON.parse(fs.readFileSync(PUNISH_FILE, "utf8")); }
function savePunishment(userId, status, durationMs = null) { const punishments = getPunishments(); if (status === null) { delete punishments[userId]; } else { punishments[userId] = { status: status, time: Date.now(), expiresAt: durationMs ? Date.now() + durationMs : null }; } fs.writeFileSync(PUNISH_FILE, JSON.stringify(punishments, null, 2), "utf8"); }
function getOrderLogs() { if (!fs.existsSync(ORDER_LOG_FILE)) fs.writeFileSync(ORDER_LOG_FILE, JSON.stringify({}), "utf8"); return JSON.parse(fs.readFileSync(ORDER_LOG_FILE, "utf8")); }
function saveOrderLog(channelId, trackingMessageId, orderDetails) { const logs = getOrderLogs(); logs[channelId] = { trackingMessageId, ...orderDetails }; fs.writeFileSync(ORDER_LOG_FILE, JSON.stringify(logs, null, 2), "utf8"); }

// ========================================================
// 🎉 Dynamic Welcome Embed Builder
// ========================================================

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

// ========================================================
// 🛒 Order Status Embed Builder
// ========================================================
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
    
    if (staff) embed.addFields({ name: "🛟 দায়িত্বপ্রাপ্তスタッフ", value: `${staff}`, inline: true });
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

// Automod + Activity XP System + ALL COMMANDS
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild || message.guild.id !== ALLOWED_GUILD_ID) return;
    
    const userId = message.author.id; 
    const contentLower = message.content.toLowerCase();

    // ==========================================
    // ⚙️ ORIGINAL PANEL SETUPS & TEXT COMMANDS
    // ==========================================
    if (message.member.permissions.has(PermissionFlagsBits.Administrator) || message.member.roles.cache.has(ROLES.ADMIN)) {
        
        // ১. মেম্বার সিঙ্ক ব্যাকআপ কমান্ড
        if (contentLower === "!syncmembers") {
            try {
                await message.guild.members.fetch();
                const finalIds = [...message.guild.members.cache.filter(m => !m.user.bot).keys()];
                saveMembers(finalIds);
                await message.reply("✅ মেম্বার ডাটাবেজ সফলভাবে সিঙ্ক করা হয়েছে!");
            } catch (err) { console.error(err); }
            return;
        }

        // ২. ভেরিফিকেশন প্যানেল (!setup)
        if (contentLower === "!setup") {
            await message.delete().catch(() => {});
            const embed = createVerificationEmbed();
            await message.channel.send({ embeds: [embed], components: [verificationRow] });
            return;
        }

        // ৩. টিকিট প্যানেল (!ticket)
        if (contentLower === "!ticket") {
            await message.delete().catch(() => {});
            const { options, customDescription, customImage, fullData } = fetchFirebasePanelData("ticket");
            const embed = new EmbedBuilder()
                .setTitle(fullData.title || "🎫 PREMIUM SUPPORT TICKET PANEL")
                .setDescription(customDescription || "নিচের ড্রপডাউন থেকে আপনার ক্যাটাগরি সিলেক্ট করুন।")
                .setColor("#5865F2")
                .setImage(customImage || COVER_IMAGES.TICKET);
            
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId("select_product_ticket").setPlaceholder("Choose a support category...").addOptions(options)
            );
            await message.channel.send({ embeds: [embed], components: [row] });
            return;
        }

        // ৪. রিপোর্ট প্যানেল (!report)
        if (contentLower === "!report") {
            await message.delete().catch(() => {});
            const { options, customDescription, customImage, fullData } = fetchFirebasePanelData("report");
            const embed = new EmbedBuilder()
                .setTitle(fullData.title || "🚨 SERVER COMPLAINT & REPORT PANEL")
                .setDescription(customDescription || "কাউকে রিপোর্ট করতে নিচের অপশন সিলেক্ট করুন।")
                .setColor("#ED4245")
                .setImage(customImage || COVER_IMAGES.REPORT);
            
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId("select_report_category").setPlaceholder("Choose a report category...").addOptions(options)
            );
            await message.channel.send({ embeds: [embed], components: [row] });
            return;
        }

        // ৫. কাস্টমার প্যানেল (!customer)
        if (contentLower === "!customer") {
            await message.delete().catch(() => {});
            const { options, customDescription, customImage, fullData } = fetchFirebasePanelData("customer");
            const embed = new EmbedBuilder()
                .setTitle(fullData.title || "💬 GENERAL CUSTOMER SUPPORT CENTER")
                .setDescription(customDescription || "যেকোনো সাধারণ সাহায্যের জন্য ড্রপডাউনটি ব্যবহার করুন।")
                .setColor("#57F287")
                .setImage(customImage || COVER_IMAGES.CUSTOMER);
            
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId("select_customer_category").setPlaceholder("Choose an inquiry type...").addOptions(options)
            );
            await message.channel.send({ embeds: [embed], components: [row] });
            return;
        }

        // ৬. শপ ও পেমেন্ট প্যানেল (!payment / !buy)
        if (contentLower === "!payment" || contentLower === "!buy") {
            await message.delete().catch(() => {});
            const { options, customDescription, customImage, fullData } = fetchFirebasePanelData("payment");
            const embed = new EmbedBuilder()
                .setTitle(fullData.title || "🛍️ AUTOMATED SHOP & PAYMENT PANELS")
                .setDescription(customDescription || "আমাদের সার্ভিস বা প্যাকেজ কিনতে নিচের ড্রপডাউন ব্যবহার করুন।")
                .setColor("#9B59B6")
                .setImage(customImage || COVER_IMAGES.PAYMENT);
            
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId("select_buy_category").setPlaceholder("Select a service to order...").addOptions(options)
            );
            await message.channel.send({ embeds: [embed], components: [row] });
            return;
        }

        // ৭. অর্ডার গাইড প্যানেল (!guide)
        if (contentLower === "!guide") {
            await message.delete().catch(() => {});
            const panels = globalFirebaseCache.panels || {};
            const guideData = panels["order_guide"] || {};
            
            const embed = new EmbedBuilder()
                .setTitle(guideData.title || "📦 HOW TO ORDER & SYSTEM GUIDE")
                .setDescription(guideData.description || "আমাদের সার্ভার থেকে অর্ডার করার নিয়মাবলী।")
                .setColor("#FFFF00")
                .setImage(guideData.image || COVER_IMAGES.PAYMENT);
                
            await message.channel.send({ embeds: [embed] });
            return;
        }
    }

    // হোয়াইটলিস্ট চেক (এডমিনদের জন্য অটোমড বাইপাস)
    if (message.member.permissions.has(PermissionFlagsBits.Administrator) || message.member.roles.cache.has(ROLES.ADMIN)) return;

    // ==========================================
    // 🚨 AUTOMOD SYSTEM
    // ==========================================
    let triggerAutomod = false; 
    let reason = "";

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
        const dbLink = (globalFirebaseCache.settings && globalFirebaseCache.settings.verification_link) || "কোনো লিংক ফায়ারবেসে পাওয়া যায়নি।";
        return message.reply(`👋 আপনি কি সার্ভার বা ভেরিফিকেশন লিংক খুঁজছেন? এই নিন আমাদের লাইভ লিংক:\n\`${dbLink}\``);
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

// ========================================================
// ⚡ PART 3 - Interaction Handling
// ========================================================

const verificationRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("universal_verify_button").setLabel("Verify Me").setStyle(ButtonStyle.Success)
);
function createVerificationEmbed() { return new EmbedBuilder().setTitle("🚨 Verification Required").setDescription("👇 নিচের বাটনে ক্লিক করে ভেরিফাই করুন").setColor("Blue").setImage(COVER_IMAGES.VERIFY).setTimestamp(); }

client.on("interactionCreate", async (interaction) => {
    if (!interaction.guild || interaction.guild.id !== ALLOWED_GUILD_ID) return;

    // রেটিং বাটনের ইন্টারঅ্যাকশন হ্যান্ডেলিং
    if (interaction.isButton() && interaction.customId.startsWith("rate_staff_")) {
        try {
            await interaction.deferUpdate().catch(() => {}); 
            const rating = interaction.customId.split("_")[2];
            return await interaction.editReply({ 
                content: `❤️ রেটিং দেওয়ার জন্য আপনাকে ধন্যবাদ! আপনি আমাদের সাপোর্ট টিমকে **${rating} স্টার** দিয়েছেন।`, 
                components: [] 
            });
        } catch (err) { console.error(err); }
        return;
    }

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

    // Giveaway জয়েন লজিক
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

    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_coupon_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const category = interaction.customId.split("_")[2]; 
        const couponEntered = interaction.fields.getTextInputValue("coupon_code_input").trim().toUpperCase();
        
        let discountText = "কোনো ডিসকাউন্ট কুপন ব্যবহার করা হয়নি।";
        if (couponEntered !== "SKIP") {
            const coupons = globalFirebaseCache.coupons || {};
            if (coupons[couponEntered]) {
                discountText = `🎉 কুপন কোড \`${couponEntered}\` সফলভাবে অ্যাপ্লাই হয়েছে! আপনি পাচ্ছেন **${coupons[couponEntered]}** স্পেশাল ছাড়!`;
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
                    content: `📜 **Ticket Channel Closed Transcript Backup**\n**Channel Name:** #${interaction.channel.name}\n**Closed By:** ${interaction.user}`,
                    files: [attachment]
                });
            }
        } catch (transErr) { console.error("Transcript Error:", transErr); }

        await interaction.reply("🔒 চ্যানেলটি ৫ সেকেন্ডের মধ্যে ডিলিট হবে।");
        const orderLogs = getOrderLogs(); const currentOrder = orderLogs[interaction.channel.id];
        const trackingChannel = interaction.guild.channels.cache.get(ORDER_TRACKING_CHANNEL_ID);
        
        if (currentOrder) {
            try {
                const snapshot = await db.ref(`rating_history/${currentOrder.userId}`).once("value");
                const alreadyRated = snapshot.val();

                if (!alreadyRated) {
                    const targetUserInstance = await client.users.fetch(currentOrder.userId).catch(() => null);
                    if (targetUserInstance) {
                        const ratingRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId("rate_staff_5").setLabel("⭐⭐⭐⭐⭐ ৫ স্টার").setStyle(ButtonStyle.Success),
                            new ButtonBuilder().setCustomId("rate_staff_3").setLabel("⭐⭐⭐ ৩ স্টার").setStyle(ButtonStyle.Primary),
                            new ButtonBuilder().setCustomId("rate_staff_1").setLabel("⭐ ১ স্টার").setStyle(ButtonStyle.Danger)
                        );
                        await targetUserInstance.send({
                            content: `👋 **AFIA YTAPP**\nআমাদের সাপোর্ট টিম আপনাকে কেমন সাহায্য করলো? নিচে ক্লিক করে রেটিং দিন।`,
                            components: [ratingRow]
                        }).catch(() => {});
                        await db.ref(`rating_history/${currentOrder.userId}`).set(true);
                    }
                }
            } catch (dmErr) { console.error(dmErr); }
        }

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
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("ban_panel_")) {
        const type = interaction.customId.split("_")[2];
        let reqRole = (type === "customer" || type === "order") ? ROLES.SUPPORT_CUSTOMER : ROLES.SUPPORT_TICKET_REPORT;
        if (!interaction.member.roles.cache.has(reqRole) && !interaction.member.roles.cache.has(ROLES.ADMIN)) return interaction.reply({ content: "❌ পারমিশন নেই!", flags: [MessageFlags.Ephemeral] });

        const orderLogs = getOrderLogs(); const currentOrder = orderLogs[interaction.channel.id];
        if (!currentOrder) return interaction.reply({ content: "❌ অর্ডার ট্র্যাক ফাইলে পাওয়া যায়নি!", flags: [MessageFlags.Ephemeral] });

        const modal = new ModalBuilder().setCustomId(`modal_ban_reason_${currentOrder.userId}`).setTitle("🚫 Fake Ticket Ban Reason");
        const reasonInput = new TextInputBuilder().setCustomId("ban_reason_input").setLabel("ব্যান করার সঠিক কারণটি সংক্ষেপে লিখুন").setStyle(TextInputStyle.Paragraph).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_ban_reason_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const targetUserId = interaction.customId.split("_")[3];
        const banReason = interaction.fields.getTextInputValue("ban_reason_input");

        savePunishment(targetUserId, "Banned", null); 
        const orderLogs = getOrderLogs(); const currentOrder = orderLogs[interaction.channel.id];
        const trackingChannel = interaction.guild.channels.cache.get(ORDER_TRACKING_CHANNEL_ID);
        
        if (currentOrder && trackingChannel) {
            try {
                const msg = await trackingChannel.messages.fetch(currentOrder.trackingMessageId);
                if (msg) {
                    const targetUser = await client.users.fetch(currentOrder.userId).catch(() => "Unknown");
                    const updatedEmbed = buildOrderStatusEmbed(targetUser, currentOrder.category, `#${interaction.channel.name} (Banned/Deleted)`, "banned", interaction.user, banReason, currentOrder.txnId || null);
                    await msg.edit({ embeds: [updatedEmbed] });
                    const logs = getOrderLogs(); delete logs[interaction.channel.id]; fs.writeFileSync(ORDER_LOG_FILE, JSON.stringify(logs, null, 2), "utf8");
                }
            } catch(e) {}
        }

        await interaction.editReply(`🚫 মেম্বারকে প্যানেল থেকে সফলভাবে ব্যান করা হয়েছে। ৫ সেকেন্ডে চ্যানেলটি বন্ধ হবে।`);
        setTimeout(async () => { await interaction.channel.delete().catch(() => {}); }, 5000);
        return;
    }
});

// ========================================================
// 👥 রিয়েল-টাইম ভয়েস স্টেট মেম্বার কাউন্টার (লক-ফ্রি বাফার লজিক)
// ========================================================
let lastMemberCount = 0;
let lastVcCount = 0;
let lastUpdateTIme = 0; 

client.on("voiceStateUpdate", async (oldState, newState) => {
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID); 
    if (!guild) return; 

    if (guild.members.me && !guild.members.me.voice.channel) {
        await connectVoice(guild); 
    }

    try {
        const totalMembers = guild.memberCount; 
        let totalVoiceUsers = 0;
        guild.voiceStates.cache.forEach((state) => {
            if (state.channelId && !state.member?.user.bot) { totalVoiceUsers++; }
        });

        if (totalMembers === lastMemberCount && totalVoiceUsers === lastVcCount) return;

        const statsChannel = guild.channels.cache.get(STATS_VC_CHANNEL_ID); 
        if (statsChannel) {
            const now = Date.now();
            if (now - lastUpdateTIme > 5 * 60 * 1000) {
                lastMemberCount = totalMembers; lastVcCount = totalVoiceUsers; lastUpdateTIme = now;
                await statsChannel.setName(`👥 Members: ${totalMembers} | 🎙️ VC: ${totalVoiceUsers}`);
            } else {
                lastMemberCount = totalMembers; lastVcCount = totalVoiceUsers;
            }
        }
    } catch (error) { console.error(error); }
});

// ========================================================
// 📡 PART 4 - Core Bot Events & Setup
// ========================================================

client.once("ready", async () => {
    console.log(`🚀 ${client.user.tag} হিসাবে সফলভাবে লগইন করা হয়েছে!`);
    client.user.setPresence({ activities: [{ name: "Security & Verification", type: ActivityType.Watching }], status: "online" });

    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID); 
    if (guild) {
        await connectVoice(guild); 
        
        // অফলাইন রিকভারি এবং মেম্বার সিঙ্ক হুক (ডাবল মেসেজ লক)
        try {
            await guild.members.fetch();
            const savedIds = getSavedMembers();
            const currentMembers = guild.members.cache.filter(m => !m.user.bot);
            const currentIds = [...currentMembers.keys()];

            const newJoins = currentIds.filter(id => !savedIds.includes(id));
            for (const newId of newJoins) {
                const member = currentMembers.get(newId);
                const logs = getWelcomeLogs();
                if (member && !member.roles.cache.has(VERIFIED_ROLE_ID) && !logs[newId]) {
                    const welcomeChannel = guild.channels.cache.get(WELCOME_CHANNEL_ID);
                    if (welcomeChannel) {
                        const embed = buildDynamicWelcomeEmbed(member, "unverified", true);
                        const msg = await welcomeChannel.send({ embeds: [embed] }).catch(() => null);
                        if (msg) saveWelcomeLog(newId, msg.id, { isOffline: true });
                    }
                }
            }

            const leftUsers = savedIds.filter(id => !currentIds.includes(id));
            for (const leftId of leftUsers) {
                const logs = getWelcomeLogs(); const userLog = logs[leftId];
                const welcomeChannel = guild.channels.cache.get(WELCOME_CHANNEL_ID);
                if (userLog && welcomeChannel) {
                    try {
                        const msg = await welcomeChannel.messages.fetch(userLog.messageId);
                        if (msg) {
                            const updatedEmbed = buildDynamicWelcomeEmbed({ id: leftId, userId: leftId }, "left", userLog.isOffline);
                            await msg.edit({ embeds: [updatedEmbed] });
                        }
                    } catch (e) {}
                }
            }

            const finalIds = [...guild.members.cache.filter(m => !m.user.bot).keys()];
            saveMembers(finalIds);
        } catch (err) { console.error(err); }
    }
});

client.on("guildMemberAdd", async (member) => {
    if (member.guild.id !== ALLOWED_GUILD_ID || member.user.bot) return;
    const saved = getSavedMembers(); if (!saved.includes(member.id)) { saved.push(member.id); saveMembers(saved); }

    const punishments = getPunishments();
    if (punishments[member.id] && punishments[member.id].status === "Muted") {
        const remaining = punishments[member.id].expiresAt - Date.now();
        if (remaining > 0) { 
            const safeRemaining = remaining < 1000 ? 1000 : remaining;
            await member.timeout(safeRemaining, "Muted status persistent across rejoin").catch(() => {}); 
            return; 
        } else { savePunishment(member.id, null); }
    }

    const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (welcomeChannel) {
        const embed = buildDynamicWelcomeEmbed(member, "unverified");
        const msg = await welcomeChannel.send({ embeds: [embed] }).catch(() => null);
        if (msg) saveWelcomeLog(member.id, msg.id, { isOffline: false });
    }
});

client.on("guildMemberRemove", async (member) => {
    if (member.guild.id !== ALLOWED_GUILD_ID || member.user.bot) return;
    const saved = getSavedMembers(); const index = saved.indexOf(member.id);
    if (index > -1) { saved.splice(index, 1); saveMembers(saved); }

    const logs = getWelcomeLogs(); const userLog = logs[member.id];
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

// 🕋 24/7 Quran Play Connection
async function connectVoice(guild) { 
    try { 
        const channel = guild.channels.cache.get(VOICE_CHANNEL_ID); 
        if (!channel) return; 
        
        const connection = joinVoiceChannel({ 
            channelId: channel.id, guildId: guild.id, 
            adapterCreator: guild.voiceAdapterCreator, 
            selfDeaf: true, selfMute: false 
        }); 
        
        const player = createAudioPlayer(); 
        const resource = createAudioResource(AUDIO_STREAM_URL, { inlineVolume: true });
        resource.volume?.setVolume(0.8);

        player.play(resource); 
        connection.subscribe(player); 

        player.on(AudioPlayerStatus.Idle, async () => { 
            if (globalFirebaseCache.settings && globalFirebaseCache.settings.quran_stream_url) {
                AUDIO_STREAM_URL = globalFirebaseCache.settings.quran_stream_url;
            }
            const nextResource = createAudioResource(AUDIO_STREAM_URL, { inlineVolume: true });
            nextResource.volume?.setVolume(0.8);
            player.play(nextResource); 
        });

        player.on('error', () => { setTimeout(() => connectVoice(guild), 5000); });
    } catch (e) { console.error(e); } 
}

if (!TOKEN) { console.error("❌ TOKEN missing!"); process.exit(1); }
client.login(TOKEN);
