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
    joinVoiceChannel
} = require("@discordjs/voice");

// ✅ আপনার আগের রেনডার Environment Variable থেকে সরাসরি অবজেক্ট লোড করার পারফেক্ট লজিক
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
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Channel, Partials.GuildMember]
});

process.on("unhandledRejection", (err) => { console.error("[Unhandled Rejection]", err); });
process.on("uncaughtException", (err) => { console.error("[Uncaught Exception]", err); });

// Firebase থেকে অপশন, কাস্টম ডেসক্রিপশন এবং ইমেজ একসাথে নিয়ে আসার ফাংশন
async function fetchFirebasePanelData(panelType) {
    try {
        const snapshot = await db.ref(`panels/${panelType}`).once("value");
        const data = snapshot.val() || {};
        
        // ডেসক্রিপশন এবং ইমেজ ফায়ারবেস থেকে ফিল্টার করা হচ্ছে
        const customDescription = data.description || null;
        const customImage = data.image || null;

        const options = Object.keys(data)
            .filter(key => key !== "description" && key !== "image")
            .map(key => ({
                label: data[key],
                value: key
            }));

        if (options.length === 0) {
            options.push({ label: "No Options Found in DB", value: "none" });
        }

        return { options, customDescription, customImage };
    } catch (error) {
        console.error(`❌ Firebase Panel Data Fetch Error (${panelType}):`, error);
        return { 
            options: [{ label: "Error Loading from Database", value: "error" }], 
            customDescription: null, 
            customImage: null 
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

    if (txnId) embed.addFields({ name: "💳 Transaction ID", value: `\`${txnId}\``, inline: true });
    if (staff) embed.addFields({ name: "🛟 দায়িত্বপ্রাপ্ত স্টাফ", value: `${staff}`, inline: true });
    return embed;
}

// ================================
// 🚨 Automod Rules
// ================================

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild || message.guild.id !== ALLOWED_GUILD_ID) return;
    if (message.member.permissions.has(PermissionFlagsBits.Administrator) || message.member.roles.cache.has(ROLES.ADMIN)) return;
    const userId = message.author.id; let triggerAutomod = false; let reason = "";
    const contentLower = message.content.toLowerCase();
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
        if (cooldowns.has(cooldownKey) && interaction.customId !== "universal_verify_button" && !interaction.customId.startsWith("pay_")) return interaction.reply({ content: "⚠️ আপনি খুব দ্রুত ক্লিক করছেন!", flags: [MessageFlags.Ephemeral] });
        cooldowns.set(cooldownKey, true); setTimeout(() => cooldowns.delete(cooldownKey), 3000);
    }

    if (interaction.isButton() && interaction.customId === "universal_verify_button") {
        try {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            const role = interaction.guild.roles.cache.get(VERIFIED_ROLE_ID);
            if (!role) return interaction.editReply("❌ Role not found!");
            if (interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) return interaction.editReply("⚠️ আপনি ইতোমধ্যে ভেরিফাই হয়েছেন।");
            await interaction.member.roles.add(role); await interaction.editReply("✅ সফলভাবে ভেরিফাই সম্পন্ন হয়েছে!");
            const logs = getWelcomeLogs(); const userLog = logs[interaction.user.id]; const welcomeChannel = interaction.guild.channels.cache.get(WELCOME_CHANNEL_ID);
            if (userLog && welcomeChannel) { try { const msg = await welcomeChannel.messages.fetch(userLog.messageId); if (msg) { const updatedEmbed = buildDynamicWelcomeEmbed(interaction.member, "verified", userLog.isOffline, Date.now()); await msg.edit({ embeds: [updatedEmbed] }); } } catch (e) {} }
        } catch (err) { console.error(err); }
        return;
    }

    if (interaction.isStringSelectMenu() && (interaction.customId.startsWith("select_product_") || interaction.customId.startsWith("select_report_") || interaction.customId.startsWith("select_customer_") || interaction.customId.startsWith("select_buy_"))) {
        const value = interaction.values[0];
        if (value === "none" || value === "error") return interaction.reply({ content: "❌ অবৈধ অপশন!", flags: [MessageFlags.Ephemeral] });

        let type = ""; let embedColor = ""; let buttonId = "";
        if (interaction.customId === "select_product_ticket") { type = "ticket"; embedColor = "#5865F2"; buttonId = `create_ticket_${value}`; }
        else if (interaction.customId === "select_report_category") { type = "report"; embedColor = "#ED4245"; buttonId = `create_report_${value}`; }
        else if (interaction.customId === "select_customer_category") { type = "customer"; embedColor = "#57F287"; buttonId = `create_customer_${value}`; }
        else if (interaction.customId === "select_buy_category") { type = "order"; embedColor = "#9B59B6"; buttonId = `pay_gateway_${value}`; } 

        if (type === "order") {
            const payEmbed = new EmbedBuilder().setTitle(`💳 Payment Gateway: ${value.toUpperCase().replace("_", " ")}`).setDescription(`আপনার অর্ডারটি প্রসেস করতে নিচে দেওয়া **"Pay via Gateway"** বাটনে ক্লিক করে অটোমেটিক পেমেন্ট সম্পন্ন করুন এবং প্রাপ্ত Transaction ID সাবমিট করুন।`).setColor(embedColor);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`submit_txn_${value}`).setLabel("Pay via Gateway & Submit TxnID").setStyle(ButtonStyle.Primary));
            return interaction.reply({ embeds: [payEmbed], components: [row], flags: [MessageFlags.Ephemeral] });
        } else if (type) {
            const ephemeralEmbed = new EmbedBuilder().setTitle(`📌 Selected Category: ${value.toUpperCase().replace("_", " ")}`).setDescription(`চ্যানেল তৈরি করতে নিচের বাটনে চাপ দিন।`).setColor(embedColor);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(buttonId).setLabel(`Create ${type.toUpperCase()}`).setStyle(ButtonStyle.Success));
            return interaction.reply({ embeds: [ephemeralEmbed], components: [row], flags: [MessageFlags.Ephemeral] });
        }
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
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("approve_")) {
        const type = interaction.customId.split("_")[1];
        let reqRole = (type === "customer" || type === "order") ? ROLES.SUPPORT_CUSTOMER : ROLES.SUPPORT_TICKET_REPORT;
        if (!interaction.member.roles.cache.has(reqRole) && !interaction.member.roles.cache.has(ROLES.ADMIN)) return interaction.reply({ content: "❌ এই অর্ডারটি অ্যাপ্রুভ করার পারমিশন আপনার নেই!", flags: [MessageFlags.Ephemeral] });

        await interaction.reply({ content: `✅ **অর্ডারটি সফলভাবে কনফার্ম করা হয়েছে!** ট্র্যাকিং চ্যানেলে স্ট্যাটাস লাইভ আপডেট করা হলো।` });

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

        await interaction.reply("🔒 চ্যানেলটি ৫ সেকেন্ডের মধ্যে ডিলিট হবে।");
        const orderLogs = getOrderLogs(); const currentOrder = orderLogs[interaction.channel.id];
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
        return interaction.reply({ content: "⚠️ ফানি উদ্দেশ্যে এটি ওপেন করার কারণে মেম্বারকে কতদিনের জন্য ব্যান/টাইমআউট করতে চান তা নিচে থেকে সিলেক্ট করুন।", components: [new ActionRowBuilder().addComponents(selectMenu)], flags: [MessageFlags.Ephemeral] });
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
        if (logChannel) { logChannel.send({ embeds: [new EmbedBuilder().setColor("Red").setTitle("🚫 Support Ban Imposed").setDescription(`**User:** <@${targetId}>\n**Punished By:** ${interaction.user}\n**Duration:** ${durationText}\n**Reason:** Funny/Fake Panel Opening.`)] }); }
        await interaction.editReply(`✅ সফলভাবে ব্যবহারকারীকে ${durationText} এর জন্য ব্যান করা হয়েছে এবং চ্যানেলটি বন্ধ করা হচ্ছে।`);
        setTimeout(async () => { await interaction.channel.delete().catch(() => {}); }, 2000);
    }
});

// ================================
// ⚡ PART 4 - Live UI Panels Templates (বড় ও লম্বালম্বি প্রফেশনাল ডিজাইন)
// ================================

async function getDynamicTicketPanel() { 
    const { options, customDescription, customImage } = await fetchFirebasePanelData("ticket");
    
    const defaultDesc = `🛑 **Premium Support & Development Center** 🛑\n\n` +
                        `> আমাদের অফিসিয়াল মেম্বারদের জন্য ডেভেলপমেন্ট এবং কাস্টম প্রিমিয়াম সাপোর্ট প্যানেল।\n\n` +
                        `✨ **পরিষেবাসমূহ:**\n` +
                        `┌ 🛠️ কাস্টম বট এবং সিস্টেম ডেভেলপমেন্ট\n` +
                        `├ ⚡ হাই-স্পিড সার্ভার কনফিগারেশন সাপোর্ট\n` +
                        `└ 🛡️ অ্যাডভান্সড সিকিউরিটি অ্যান্ড MANAGEMENT\n\n` +
                        `📌 **নির্দেশনা:**\n` +
                        `নিচের ড্রপডাউন মেনু থেকে আপনার কাঙ্ক্ষিত সাপোর্টের ধরন সিলেক্ট করুন। একটি সম্পূর্ণ আলাদা প্রাইভেট চ্যানেল তৈরি হবে যেখানে আমাদের ডেডিকেটেড স্টাফ টিম আপনাকে সাহায্য করবে।`;

    const embed = new EmbedBuilder()
        .setTitle("🎫 PREMIUM SUPPORT TICKET PANEL")
        .setDescription(customDescription || defaultDesc)
        .setImage(customImage || COVER_IMAGES.TICKET)
        .setColor("#5865F2")
        .addFields(
            { name: "⏰ কাজের সময়", value: "⏱️ ২৪/৭ ঘন্টা অনলাইন সাপোর্ট ব্যবস্থা", inline: false },
            { name: "⚠️ সতর্কবার্তা", value: "ফানি বা ফেক কোনো টিকিট ওপেন করলে আইডি সরাসরি মিউট বা প্যানেল ব্যান হবে।", inline: false }
        )
        .setFooter({ text: "Premium Ticket System • Live Sync Active", iconURL: client.user.displayAvatarURL() });

    const menu = new StringSelectMenuBuilder().setCustomId("select_product_ticket").setPlaceholder("🛒 আপনার সাপোর্ট ক্যাটাগরি সিলেক্ট করুন...").addOptions(options); 
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] }; 
}

async function getDynamicReportPanel() { 
    const { options, customDescription, customImage } = await fetchFirebasePanelData("report");
    
    const defaultDesc = `🚨 **Server Automated Report & Complaint Center** 🚨\n\n` +
                        `> সার্ভারের সুশৃঙ্খল পরিবেশ বজায় রাখার জন্য আমাদের এই সিকিউরিটি জোন।\n\n` +
                        `🛡️ **রিপোর্ট ক্যাটাগরি:**\n` +
                        `┌ 🐛 সার্ভার বাগ (Server Bug Reports)\n` +
                        `├ 👤 মেম্বার কমপ্লেন (User Violations)\n` +
                        `└ 💼 স্টাফ অপব্যবহার (Staff Abuse Reports)\n\n` +
                        `📌 **নিয়মাবলী:**\n` +
                        `যেকোনো অন্যায়ের বিরুদ্ধে অভিযোগ করতে ড্রপডাউন ব্যবহার করুন। আপনার দেওয়া স্ক্রিনশট বা প্রুফ গোপন রাখা হবে এবং এডমিন প্যানেল সরাসরি একশন নিবেন।`;

    const embed = new EmbedBuilder()
        .setTitle("🚨 SERVER COMPLAINT & REPORT PANEL")
        .setDescription(customDescription || defaultDesc)
        .setImage(customImage || COVER_IMAGES.REPORT)
        .setColor("#ED4245")
        .addFields(
            { name: "⚖️ বিচার প্রক্রিয়া", value: "রিপোর্ট সাবমিট করার পর সর্বোচ্চ ১২ ঘন্টার মধ্যে একশন নেওয়া হবে।", inline: false },
            { name: "🔒 গোপনীয়তা", value: "আপনার পরিচয় সম্পূর্ণ গোপন রাখা সুনিশ্চিত করা হবে।", inline: false }
        )
        .setFooter({ text: "Security System • Live Sync Active", iconURL: client.user.displayAvatarURL() });

    const menu = new StringSelectMenuBuilder().setCustomId("select_report_category").setPlaceholder("⚠️ আপনার রিপোর্টের ধরন সিলেক্ট করুন...").addOptions(options); 
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] }; 
}

async function getDynamicCustomerPanel() { 
    const { options, customDescription, customImage } = await fetchFirebasePanelData("customer");
    
    const defaultDesc = `💬 **General Customer Care & Help Counter** 💬\n\n` +
                        `> সার্ভারের সাধারণ মেম্বারদের যেকোনো সমস্যা বা জিজ্ঞাসার জন্য ওয়ান-স্টপ সলিউশন।\n\n` +
                        `❓ **আমাদের সাহায্য ক্ষেত্র:**\n` +
                        `┌ ℹ️ সার্ভার ফিচার সম্পর্কিত যেকোনো সাধারণ তথ্য\n` +
                        `├ 🤝 পার্টনারশিপ বা কোলাবোরেশন আবেদন\n` +
                        `└ 📢 প্রমোশন বা কাস্টম প্রপোজাল ইনফো\n\n` +
                        `📌 **কিভাবে সাহায্য পাবেন?**\n` +
                        `ড্রপডাউন থেকে আপনার প্রশ্নের বিষয়বস্তুটি সিলেক্ট করুন। আমাদের কাস্টমার কেয়ার প্রতিনিধি খুব দ্রুত আপনার সাথে যোগাযোগ করবে।`;

    const embed = new EmbedBuilder()
        .setTitle("💬 GENERAL CUSTOMER SUPPORT CENTER")
        .setDescription(customDescription || defaultDesc)
        .setImage(customImage || COVER_IMAGES.CUSTOMER)
        .setColor("#57F287")
        .addFields(
            { name: "👥 দায়িত্বপ্রাপ্ত টিম", value: "🛟 কাস্টমার কেয়ার এক্সিকিউটিভ", inline: true },
            { name: "⚡ রেসপন্স টাইম", value: "⏱️ ৫ থেকে ১৫ মিনিট", inline: true }
        )
        .setFooter({ text: "Customer Support • Live Sync Active", iconURL: client.user.displayAvatarURL() });

    const menu = new StringSelectMenuBuilder().setCustomId("select_customer_category").setPlaceholder("❓ আপনার প্রয়োজনীয় অপশন সিলেক্ট করুন...").addOptions(options); 
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] }; 
}

async function getDynamicPaymentPanel() { 
    const { options, customDescription, customImage } = await fetchFirebasePanelData("payment");
    
    const defaultDesc = `💳 **Premium Store & Automatic Payment Gateway** 💳\n\n` +
                        `> আমাদের যেকোনো প্রিমিয়াম সার্ভিস, লাইসেন্স বা মেম্বারশিপ নেওয়ার ডিজিটাল শপ।\n\n` +
                        `🛍️ **অর্ডার করার নিয়ম:**\n` +
                        `┌ 1️⃣ নিচে দেওয়া ড্রপডাউন মেনু থেকে আপনার প্রোডাক্ট বেছে নিন।\n` +
                        `├ 2️⃣ বট আপনাকে একটি ইনস্ট্যান্ট গেটওয়ে লিঙ্ক ও পেমেন্ট ডিটেইলস দেবে।\n` +
                        `├ 3️⃣ পেমেন্ট শেষে ট্রানজেকশন আইডি (TxnID) কোডটি সাবমিট করুন।\n` +
                        `└ 4️⃣ সিস্টেম অটোমেটিক আপনার নামে একটি প্রিমিয়াম অর্ডার চ্যানেল খুলে দেবে।\n\n` +
                        `🔥 **নিরাপত্তা নিশ্চয়তা:**\n` +
                        `এটি সম্পূর্ণ সুরক্ষিত ও অটোমেটেড ট্র্যাকিং সিস্টেম, যা সরাসরি ডাটাবেজের সাথে সিঙ্ক করা।`;

    const embed = new EmbedBuilder()
        .setTitle("🛍️ AUTOMATED SHOP & PAYMENT PANELS")
        .setDescription(customDescription || defaultDesc)
        .setImage(customImage || COVER_IMAGES.PAYMENT)
        .setColor("#3498DB")
        .addFields(
            { name: "💳 সাপোর্টেড পেমেন্ট", value: "🚀 বিকাশ, রকেট, নগদ এবং ইনস্ট্যান্ট গেটওয়ে সিস্টেম", inline: false },
            { name: "🛡️ সেফটি নোট", value: "পেমেন্ট স্লিপ অথবা TxnID কারও সাথে শেয়ার করবেন না।", inline: false }
        )
        .setFooter({ text: "Automated Payment Bot • Live Sync Active", iconURL: client.user.displayAvatarURL() });

    const menu = new StringSelectMenuBuilder().setCustomId("select_buy_category").setPlaceholder("🛍️ আপনার কাঙ্ক্ষিত মেম্বারশিপ/সার্ভিস সিলেক্ট করুন...").addOptions(options); 
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] }; 
}

// Manual Setup Commands
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild || message.guild.id !== ALLOWED_GUILD_ID) return;
    const isServerAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator) || message.member.roles.cache.has(ROLES.ADMIN);
    if (!isServerAdmin) return;

    if (message.content === "!setup") return message.channel.send({ embeds: [createVerificationEmbed()], components: [verificationRow] });
    
    if (message.content === "!ticket" && message.channelId === CHANNELS.TICKET_PANEL) return message.channel.send(await getDynamicTicketPanel());
    if (message.content === "!report" && message.channelId === CHANNELS.REPORT_PANEL) return message.channel.send(await getDynamicReportPanel());
    if (message.content === "!customer" && message.channelId === CHANNELS.CUSTOMER_PANEL) return message.channel.send(await getDynamicCustomerPanel());
    
    if ((message.content === "!payment" || message.content.toLowerCase() === "!payment") && 
        (message.channelId === CHANNELS.PAYMENT_PANEL || message.channelId === CHANNELS.BUY_PANEL)) {
        return message.channel.send(await getDynamicPaymentPanel());
    }
});

// ================================
// 🔥 REALTIME FIREBASE SYNC TO DISCORD (AUTO UPDATE ON LIVE CHANGES)
// ================================

function listenToFirebaseUpdates() {
    db.ref("panels").on("value", async (snapshot) => {
        const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
        if (!guild) return;

        console.log("🔄 Firebase Realtime Data changed! Updating panels in Discord channels...");

        // 1. Ticket Panel Auto-Update
        const ticketChan = guild.channels.cache.get(CHANNELS.TICKET_PANEL);
        if (ticketChan) {
            const messages = await ticketChan.messages.fetch({ limit: 20 });
            const botMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0 && m.components[0].components[0].customId === "select_product_ticket");
            if (botMsg) {
                const updatedData = await getDynamicTicketPanel();
                await botMsg.edit(updatedData).catch(() => {});
            }
        }

        // 2. Report Panel Auto-Update
        const reportChan = guild.channels.cache.get(CHANNELS.REPORT_PANEL);
        if (reportChan) {
            const messages = await reportChan.messages.fetch({ limit: 20 });
            const botMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0 && m.components[0].components[0].customId === "select_report_category");
            if (botMsg) {
                const updatedData = await getDynamicReportPanel();
                await botMsg.edit(updatedData).catch(() => {});
            }
        }

        // 3. Customer Panel Auto-Update
        const custChan = guild.channels.cache.get(CHANNELS.CUSTOMER_PANEL);
        if (custChan) {
            const messages = await custChan.messages.fetch({ limit: 20 });
            const botMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0 && m.components[0].components[0].customId === "select_customer_category");
            if (botMsg) {
                const updatedData = await getDynamicCustomerPanel();
                await botMsg.edit(updatedData).catch(() => {});
            }
        }

        // 4. Payment Panel Auto-Update (BUY_PANEL এবং PAYMENT_PANEL দুই জায়গাই চেক করবে)
        const checkPaymentChannels = [CHANNELS.PAYMENT_PANEL, CHANNELS.BUY_PANEL];
        for (const chanId of checkPaymentChannels) {
            const payChan = guild.channels.cache.get(chanId);
            if (payChan) {
                const messages = await payChan.messages.fetch({ limit: 20 });
                const botMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0 && m.components[0].components[0].customId === "select_buy_category");
                if (botMsg) {
                    const updatedData = await getDynamicPaymentPanel();
                    await botMsg.edit(updatedData).catch(() => {});
                }
            }
        }
    });
}

// ================================
// 🚀 PART 5 - Live Member Events & Smart Sync Recovery
// ================================

client.on("guildMemberAdd", async (member) => {
    if (member.guild.id !== ALLOWED_GUILD_ID) return; const saved = getSavedMembers(); if (!saved.includes(member.id)) { saved.push(member.id); saveMembers(saved); }
    const punishments = getPunishments(); if (punishments[member.id] && punishments[member.id].status === "Muted") { const record = punishments[member.id]; const now = Date.now(); if (!record.expiresAt || record.expiresAt > now) { const remainingTime = record.expiresAt ? record.expiresAt - now : 10 * 60 * 1000; try { await member.timeout(remainingTime, "Automod/Panel Bypass Block"); const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID); if (welcomeChannel) { welcomeChannel.send(`⚠️ মেম্বার <@${member.id}> তার আগের প্যানেল ব্যান/টাইমআউট শাস্তি ফাঁকি দেওয়ার জন্য লিভ নিয়ে পুনরায় জয়েন করায় তাকে পুনরায় মিউট করা হয়েছে।`); } } catch(e) {} } else { savePunishment(member.id, null); } }
    const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID); if (welcomeChannel) { const embed = buildDynamicWelcomeEmbed(member, "unverified", false); const msg = await welcomeChannel.send({ content: `🎉 স্বাগতম ${member}!`, embeds: [embed] }).catch(() => {}); if (msg) saveWelcomeLog(member.id, msg.id, { isOffline: false }); }
});

client.on("guildMemberRemove", async (member) => {
    if (member.guild.id !== ALLOWED_GUILD_ID) return; const saved = getSavedMembers(); saveMembers(saved.filter(id => id !== member.id));
    const logs = getWelcomeLogs(); const userLog = logs[member.id]; const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (userLog && welcomeChannel) { try { const msg = await welcomeChannel.messages.fetch(userLog.messageId); if (msg) { const updatedEmbed = buildDynamicWelcomeEmbed(member, "left", userLog.isOffline); await msg.edit({ content: `🚫 **${member.user.tag}** সার্ভার থেকে বিদায় নিয়েছেন।`, embeds: [updatedEmbed] }); } } catch (e) {} }
});

client.once("clientReady", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`); 
    setBotPresence();
    
    // লাইভ রিয়েল-টাইম ফায়ারবেস লিসেনার চালু করা হলো
    listenToFirebaseUpdates();

    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID); 
    if (!guild) return;
    await connectVoice(guild); 
    const welcomeChannel = guild.channels.cache.get(WELCOME_CHANNEL_ID);
    
    try {
        console.log("🔍 Checking for offline actions..."); 
        const currentMembers = await guild.members.fetch(); 
        const savedMembers = getSavedMembers(); 
        const logs = getWelcomeLogs(); 
        const punishments = getPunishments(); 
        const now = Date.now();
        
        if (savedMembers.length === 0) {
            const initialIds = currentMembers.filter(m => !m.user.bot).map(m => m.id);
            saveMembers(initialIds);
            console.log("✅ Initialized clean database with current guild members.");
            return;
        }

        const missedJoins = currentMembers.filter(m => !savedMembers.includes(m.id) && !m.user.bot);
        if (missedJoins.size > 0 && welcomeChannel) { 
            for (const [, member] of missedJoins) { 
                if (punishments[member.id] && punishments[member.id].status === "Muted") { 
                    const record = punishments[member.id]; 
                    if (!record.expiresAt || record.expiresAt > now) { 
                        const remaining = record.expiresAt ? record.expiresAt - now : 10 * 60 * 1000; 
                        await member.timeout(remaining, "Offline Sync Bypass Guard").catch(()=>{}); 
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
        console.log("✅ Offline sync completed successfully.");
    } catch (err) { 
        console.error("Sync Recovery Error:", err); 
    }
});

client.on("voiceStateUpdate", async () => { 
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID); 
    if (guild && guild.members.me && !guild.members.me.voice.channel) await connectVoice(guild); 
});

// ================================
// 🛠️ প্রয়োজনীয় ইউটিলিটি ফাংশনসমূহ
// ================================

function setBotPresence() { 
    client.user.setPresence({ 
        activities: [{ name: "Security & Verification", type: ActivityType.Watching }], 
        status: "online" 
    }); 
}

async function connectVoice(guild) { 
    try { 
        const channel = guild.channels.cache.get(VOICE_CHANNEL_ID); 
        if (!channel) return; 
        joinVoiceChannel({ 
            channelId: channel.id, 
            guildId: guild.id, 
            adapterCreator: guild.voiceAdapterCreator, 
            selfDeaf: true, 
            selfMute: false 
        }); 
    } catch (e) {
        console.error("❌ Voice Connect Error:", e);
    } 
}

function startBot() { 
    client.login(TOKEN).catch((err) => { 
        console.error("❌ Login Failed, retrying in 5s...", err);
        setTimeout(startBot, 5000); 
    }); 
}

startBot();
