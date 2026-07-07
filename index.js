// ================================
// 🚀 PART 1 - Setup & Packages Configuration
// ================================

const express = require("express");
const fs = require("fs");
const admin = require("firebase-admin");
const bcrypt = require("bcryptjs");

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

const { joinVoiceChannel } = require("@discordjs/voice");

// Firebase Configuration Logic from Environment or Local File
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

const firebaseURL = process.env.FIREBASE_DB_URL || "YOUR_FIREBASE_DATABASE_URL";
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: firebaseURL
    });
}
const db = admin.database();

const app = express();
app.get("/", (req, res) => { res.send("Bot System is Live!"); });
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🌐 Web server active on port ${PORT}`); });

// ================================
// ⚙️ Core Configuration & Channel Mapping
// ================================

const TOKEN = process.env.TOKEN;
const ALLOWED_GUILD_ID = "1488101970425155584";
const VERIFIED_ROLE_ID = "1488333841402691664";

// রোলের তালিকা
const ROLES = {
    ADMIN: "1488332568372973568", 
    DEVELOPER: "1523955414612578354", // ডেভেলপার রোল আইডি (ওয়ান-টাইম কি এর ক্ষমতা প্রাপ্ত)
    SUPPORT_TICKET_REPORT: "1488333580705861765", 
    SUPPORT_CUSTOMER: "1488335064873046086" 
};

// চ্যানেলের তালিকা
const CHANNELS = {
    WELCOME: "1488339169821593731",
    LOGS: "1488340400673656973",
    VOICE: "1523230098193383595",
    TICKET_PANEL: "1488339982627115118",
    REPORT_PANEL: "1488340441115004999",
    CUSTOMER_PANEL: "1488340017938960484",
    BUY_PANEL: "1488339666368462858", 
    PAYMENT_PANEL: "1488333503761219746",
    ORDER_TRACKING: "1488340262827855983",
    REGISTRATION_PORTAL: "1488340790844330139", // কাস্টমার ক্লেম পোর্টাল
    ADMIN_DEV_PANEL: "1523955414612578354"      // অ্যাডমিন/ডেভেলপার প্যানেল চ্যানেল
};

const COVER_IMAGES = {
    VERIFY: "https://cdn.discordapp.com/attachments/1488338142607184055/1488761437550678056/5cfd1fe4-d12c-4439-b374-f386f7595184.png",
    TICKET: "https://cdn.discordapp.com/attachments/1488338142607184055/1488761437550678056/5cfd1fe4-d12c-4439-b374-f386f7595184.png"
};

const BAD_WORDS = ["gali1", "gali2", "gali3"]; 
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

// ================================
// 📂 Database & Helper Utilities
// ================================

function getSavedMembers() { if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([]), "utf8"); return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
function saveMembers(memberIds) { fs.writeFileSync(DATA_FILE, JSON.stringify(memberIds, null, 2), "utf8"); }
function getWelcomeLogs() { if (!fs.existsSync(WELCOME_LOG_FILE)) fs.writeFileSync(WELCOME_LOG_FILE, JSON.stringify({}), "utf8"); return JSON.parse(fs.readFileSync(WELCOME_LOG_FILE, "utf8")); }
function saveWelcomeLog(userId, messageId, data = {}) { const logs = getWelcomeLogs(); logs[userId] = { messageId, ...data }; fs.writeFileSync(WELCOME_LOG_FILE, JSON.stringify(logs, null, 2), "utf8"); }
function getPunishments() { if (!fs.existsSync(PUNISH_FILE)) fs.writeFileSync(PUNISH_FILE, JSON.stringify({}), "utf8"); return JSON.parse(fs.readFileSync(PUNISH_FILE, "utf8")); }
function savePunishment(userId, status, durationMs = null) { const punishments = getPunishments(); if (status === null) { delete punishments[userId]; } else { punishments[userId] = { status: status, time: Date.now(), expiresAt: durationMs ? Date.now() + durationMs : null }; } fs.writeFileSync(PUNISH_FILE, JSON.stringify(punishments, null, 2), "utf8"); }
function getOrderLogs() { if (!fs.existsSync(ORDER_LOG_FILE)) fs.writeFileSync(ORDER_LOG_FILE, JSON.stringify({}), "utf8"); return JSON.parse(fs.readFileSync(ORDER_LOG_FILE, "utf8")); }
function saveOrderLog(channelId, trackingMessageId, orderDetails) { const logs = getOrderLogs(); logs[channelId] = { trackingMessageId, ...orderDetails }; fs.writeFileSync(ORDER_LOG_FILE, JSON.stringify(logs, null, 2), "utf8"); }

function generateLicenseKey(isOneTime = false) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const part = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    const prefix = isOneTime ? "1TIME" : "KEY";
    return `${prefix}-${part()}-${part()}-${part()}-${part()}`;
}

async function fetchFirebasePanelData(panelType) {
    try {
        const snapshot = await db.ref(`panels/${panelType}`).once("value");
        const data = snapshot.val() || {};
        const customDescription = data.description || null;
        const customImage = data.image || null;
        const options = Object.keys(data)
            .filter(key => key !== "description" && key !== "image")
            .map(key => ({ label: data[key], value: key }));
        if (options.length === 0) options.push({ label: "No Options Found", value: "none" });
        return { options, customDescription, customImage };
    } catch (error) {
        return { options: [{ label: "Error Connection", value: "error" }], customDescription: null, customImage: null };
    }
}

function buildOrderStatusEmbed(user, category, ticketChannel, status, staff = null, reason = null, txnId = null) {
    let color = "#FFFF00"; let statusString = "⏳ PENDING";
    if (status === "approved") color = "#00FF00", statusString = "✅ APPROVED & RUNNING";
    if (status === "closed") color = "#FF0000", statusString = "🔒 CLOSED";
    if (status === "banned") color = "#2F3136", statusString = `🚫 BANNED (${reason})`;

    const embed = new EmbedBuilder()
        .setTitle("📦 ORDER TRACKING SYSTEM")
        .setColor(color)
        .addFields(
            { name: "👤 কাস্টমার", value: `${user}`, inline: true },
            { name: "🛒 ক্যাটাগরি", value: `\`${category.toUpperCase()}\``, inline: true },
            { name: "📁 চ্যানেল", value: `${ticketChannel}`, inline: true },
            { name: "📊 স্ট্যাটাস", value: `**${statusString}**`, inline: false }
        ).setTimestamp();

    if (txnId) {
        let masked = txnId.length > 4 ? txnId.substring(0, 2) + "****" + txnId.substring(txnId.length - 2) : "****";
        embed.addFields({ name: "💳 Transaction ID", value: `\`${masked}\``, inline: true });
    }
    if (staff) embed.addFields({ name: "🛟 দায়িত্বপ্রাপ্ত স্টাফ", value: `${staff}`, inline: true });
    return embed;
}

// ================================
// ⚡ PART 2 - Event Interaction Handling (Core Logic)
// ================================

client.on("interactionCreate", async (interaction) => {
    if (!interaction.guild || interaction.guild.id !== ALLOWED_GUILD_ID) return;

    // ১. ইউনিভার্সাল ভেরিফিকেশন বাটন হ্যান্ডলার
    if (interaction.isButton() && interaction.customId === "universal_verify_button") {
        try {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            const role = interaction.guild.roles.cache.get(VERIFIED_ROLE_ID);
            if (!role) return interaction.editReply("❌ রুল পাওয়া যায়নি।");
            if (interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) return interaction.editReply("⚠️ আপনি অলরেডি ভেরিফাইড।");
            await interaction.member.roles.add(role); await interaction.editReply("✅ ভেরিফিকেশন সফল হয়েছে!");
            const logs = getWelcomeLogs(); const userLog = logs[interaction.user.id];
            const welcomeChannel = interaction.guild.channels.cache.get(CHANNELS.WELCOME);
            if (userLog && welcomeChannel) {
                try {
                    const msg = await welcomeChannel.messages.fetch(userLog.messageId);
                    if (msg) {
                        const updatedEmbed = new EmbedBuilder().setColor("#00FF00").setTitle("🎉 মেম্বার ভেরিফাইড").setDescription(`✨ <@${interaction.user.id}> সফলভাবে সার্ভারে যুক্ত ও ভেরিফাই হয়েছেন।`).setTimestamp();
                        await msg.edit({ embeds: [updatedEmbed] });
                    }
                } catch(e){}
            }
        } catch (err) { console.error(err); }
        return;
    }

    // ২. পেমেন্ট ড্রপডাউন সিলেক্ট মেনু লজিক
    if (interaction.isStringSelectMenu() && (interaction.customId.startsWith("select_product_") || interaction.customId.startsWith("select_buy_"))) {
        const value = interaction.values[0];
        if (value === "none" || value === "error") return interaction.reply({ content: "❌ ইনভ্যালিড অপশন!", flags: [MessageFlags.Ephemeral] });

        const payEmbed = new EmbedBuilder()
            .setTitle(`💳 Payment Gateway: ${value.toUpperCase().replace("_", " ")}`)
            .setDescription(`অর্ডারটি সম্পন্ন করতে নিচের বাটনে প্রেস করে সঠিক Transaction ID (TxnID) সাবমিট করুন।`)
            .setColor("#3498DB");
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`submit_txn_${value}`).setLabel("Pay & Submit TxnID").setStyle(ButtonStyle.Primary));
        return interaction.reply({ embeds: [payEmbed], components: [row], flags: [MessageFlags.Ephemeral] });
    }

    // ৩. ট্রানজেকশন আইডি সাবমিশন মোডাল ওপেনিং
    if (interaction.isButton() && interaction.customId.startsWith("submit_txn_")) {
        const category = interaction.customId.split("_")[2];
        const modal = new ModalBuilder().setCustomId(`modal_payment_${category}`).setTitle("🔒 পেমেন্ট গেটওয়ে ভেরিফিকেশন");
        const txnInput = new TextInputBuilder().setCustomId("txn_id_input").setLabel("Enter Transaction ID (TxnID)").setPlaceholder("Ex: BK490X7Z9").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(txnInput));
        return interaction.showModal(modal);
    }

    // ৪. ট্রানজেকশন আইডি প্রসেসিং এবং প্রাইভেট স্টাফ চ্যানেল তৈরি
    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_payment_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const category = interaction.customId.split("_")[2];
        const txnId = interaction.fields.getTextInputValue("txn_id_input").trim();
        const randomCode = Math.floor(1000 + Math.random() * 9000); 

        const permissionOverwrites = [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: ROLES.SUPPORT_CUSTOMER, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            { id: ROLES.ADMIN, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] }
        ];

        const privateChannel = await interaction.guild.channels.create({ name: `order-${randomCode}`, type: 0, permissionOverwrites });
        
        const insideEmbed = new EmbedBuilder()
            .setTitle(`🛍️ New Pending Order Process`)
            .setDescription(`স্বাগতম ${interaction.user}!\n**প্রোডাক্ট:** ${category.toUpperCase()}\n**TxnID:** \`${txnId}\`\n\nস্টাফরা ডাটা চেক করে খুব শীঘ্রই এটি অ্যাপ্রুভ করবেন।`)
            .setColor("Yellow");
        
        const staffButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`claim_order`).setLabel("🛟 Claim Staff").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`approve_order`).setLabel("✅ Approve Order").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`close_order`).setLabel("🔒 Close Ticket").setStyle(ButtonStyle.Danger)
        );

        await privateChannel.send({ content: `${interaction.user}`, embeds: [insideEmbed], components: [staffButtons] });

        const trackingChannel = interaction.guild.channels.cache.get(CHANNELS.ORDER_TRACKING);
        if (trackingChannel) {
            const trackingEmbed = buildOrderStatusEmbed(interaction.user, category, privateChannel, "pending", null, null, txnId);
            const trackingMsg = await trackingChannel.send({ embeds: [trackingEmbed] }).catch(() => {});
            if (trackingMsg) {
                saveOrderLog(privateChannel.id, trackingMsg.id, { userId: interaction.user.id, category, status: "pending", txnId });
            }
        }
        return interaction.editReply(`✅ আপনার রিকোয়েস্ট সাবমিট করা হয়েছে। চ্যানেল তৈরি হয়েছে: ${privateChannel}`);
    }

    // ৫. স্টাফ দ্বারা অর্ডার APPROVE করা এবং অটো লাইসেন্স কি ও পোর্টাল মেসেজ জেনারেশন
    if (interaction.isButton() && interaction.customId === "approve_order") {
        if (!interaction.member.roles.cache.has(ROLES.SUPPORT_CUSTOMER) && !interaction.member.roles.cache.has(ROLES.ADMIN)) {
            return interaction.reply({ content: "❌ এটি অ্যাপ্রুভ করার পারমিশন আপনার নেই।", flags: [MessageFlags.Ephemeral] });
        }

        await interaction.deferUpdate();
        const orderLogs = getOrderLogs();
        const currentOrder = orderLogs[interaction.channel.id];
        const regPortalChannel = interaction.guild.channels.cache.get(CHANNELS.REGISTRATION_PORTAL);
        const trackingChannel = interaction.guild.channels.cache.get(CHANNELS.ORDER_TRACKING);

        if (currentOrder) {
            const generatedKey = generateLicenseKey(false); // স্ট্যান্ডার্ড ৩টি ফিল্ডের লাইসেন্স কি
            const durationDays = currentOrder.category.includes("lifetime") ? 99999 : 30;

            // ফায়ারবেস রিয়েলটাইম ডেটাবেজে লাইসেন্স নোড লাইভ পুশ করা হচ্ছে
            await db.ref(`licenses/${generatedKey}`).set({
                key: generatedKey,
                app_id: "app_001",
                tier: currentOrder.category,
                duration_days: durationDays,
                is_used: false,
                used_by: "",
                expires_at: Date.now() + (durationDays * 24 * 60 * 60 * 1000),
                created_at: Date.now()
            });

            // পেন্ডিং ক্লেইম রেজিস্ট্রি আপডেট
            if (currentOrder.txnId) {
                await db.ref(`discord_pending_claims/tx_${currentOrder.txnId}`).set({
                    transaction_id: currentOrder.txnId,
                    discord_user_id: currentOrder.userId,
                    category: currentOrder.category,
                    status: "approved",
                    license_generated: generatedKey,
                    account_created: false
                });
            }

            // ট্র্যাকিং এম্বেড আপডেট
            if (trackingChannel && currentOrder.trackingMessageId) {
                try {
                    const msg = await trackingChannel.messages.fetch(currentOrder.trackingMessageId);
                    if (msg) {
                        const targetUser = await client.users.fetch(currentOrder.userId).catch(() => "User");
                        const updated = buildOrderStatusEmbed(targetUser, currentOrder.category, interaction.channel, "approved", interaction.user, null, currentOrder.txnId);
                        await msg.edit({ embeds: [updated] });
                    }
                } catch(e){}
            }

            // ক্লায়েন্ট রেজিস্ট্রেশন পোর্টালে (`1488340790844330139`) অটো প্যানেল জেনারেট করা
            if (regPortalChannel) {
                const claimEmbed = new EmbedBuilder()
                    .setTitle("🔑 ডিজিটাল অ্যাকাউন্ট ও লাইসেন্স ডেলিভারি")
                    .setDescription(`অভিনন্দন <@${currentOrder.userId}>!\nআপনার ট্রানজেকশন আইডি সফলভাবে যাচাই করা হয়েছে।\n\n**প্রোডাক্ট টাইপ:** \`${currentOrder.category.toUpperCase()}\`\n**জেনারেটেড লাইসেন্স কি:** \`${generatedKey}\`\n\nডেস্কটপ অ্যাপ্লিকেশনে লগইন অ্যাকাউন্ট তৈরি করতে নিচের **"Setup My Account"** বাটনে ক্লিক করুন।`)
                    .setColor("Green")
                    .setFooter({ text: "Secure Automated Licensing Framework" });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`setup_client_acc_${generatedKey}_${currentOrder.userId}`)
                        .setLabel("Setup My Account")
                        .setStyle(ButtonStyle.Success)
                );

                await regPortalChannel.send({ content: `<@${currentOrder.userId}>`, embeds: [claimEmbed], components: [row] });
            }

            await interaction.channel.send(`✅ অর্ডারটি সফলভাবে অ্যাপ্রুভ হয়েছে এবং লাইসেন্স কি তৈরি করা হয়েছে। ৫ সেকেন্ডে চ্যানেল বন্ধ হবে।`);
            setTimeout(async () => { await interaction.channel.delete().catch(() => {}); }, 5000);
        }
        return;
    }

    // ৬. ক্লোজ টিকেট বাটন
    if (interaction.isButton() && interaction.customId === "close_order") {
        await interaction.reply("🔒 টিকেট বন্ধ করা হচ্ছে...");
        setTimeout(async () => { await interaction.channel.delete().catch(() => {}); }, 3000);
        return;
    }

    // ৭. কাস্টমার ক্লেইম বাটন ক্লিক (মোডাল পপআপ)
    if (interaction.isButton() && interaction.customId.startsWith("setup_client_acc_")) {
        const parts = interaction.customId.split("_");
        const licenseKey = parts[3];
        const ownerId = parts[4];

        if (interaction.user.id !== ownerId) {
            return interaction.reply({ content: "❌ এটি শুধুমাত্র পেমেন্ট প্রদানকারী নির্দিষ্ট কাস্টমারের জন্য অ্যাক্সেসযোগ্য।", flags: [MessageFlags.Ephemeral] });
        }

        const snapshot = await db.ref(`licenses/${licenseKey}`).once("value");
        if (snapshot.exists() && snapshot.val().is_used) {
            return interaction.reply({ content: "❌ এই লাইসেন্স কি দ্বারা ইতিমধ্যে একটি অ্যাকাউন্ট তৈরি করা হয়েছে!", flags: [MessageFlags.Ephemeral] });
        }

        const modal = new ModalBuilder().setCustomId(`modal_cust_register_${licenseKey}`).setTitle("📝 উইনফর্ম ক্লায়েন্ট অ্যাকাউন্ট তৈরি");
        const uInput = new TextInputBuilder().setCustomId("client_user").setLabel("প্রছন্দের ইউজারনেম দিন (Lowercase)").setPlaceholder("ex: neon99").setStyle(TextInputStyle.Short).setRequired(true);
        const pInput = new TextInputBuilder().setCustomId("client_pass").setLabel("নিরাপদ পাসওয়ার্ড সেট করুন").setPlaceholder("******").setStyle(TextInputStyle.Short).setRequired(true);
        
        modal.addComponents(new ActionRowBuilder().addComponents(uInput), new ActionRowBuilder().addComponents(pInput));
        return interaction.showModal(modal);
    }

    // ৮. কাস্টমার মোডাল সাবমিশন প্রসেসিং (BCrypt পাসওয়ার্ড হ্যাশ সহ ফায়ারবেসে রাইট)
    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_cust_register_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const licenseKey = interaction.customId.split("_")[3];
        const username = interaction.fields.getTextInputValue("client_user").trim().toLowerCase();
        const password = interaction.fields.getTextInputValue("client_pass").trim();

        const userCheck = await db.ref("users").orderByChild("username").equalTo(username).once("value");
        if (userCheck.exists()) {
            return interaction.editReply("❌ দুঃখিত, এই ইউজারনেমটি দিয়ে অলরেডি অ্যাকাউন্ট রয়েছে। অন্য ইউজারনেম ট্রাই করুন।");
        }

        const salt = await bcrypt.genSalt(11);
        const hashedPass = await bcrypt.hash(password, salt);
        const newUid = "user_" + Math.random().toString(36).substring(2, 11);

        // ফায়ারবেস ব্যবহারকারী ডাটা তৈরি
        await db.ref(`users/${newUid}`).set({
            username: username,
            password_hash: hashedPass,
            email: `${username}@discord.auth`,
            hwid: "", // ক্লায়েন্ট প্রথম ওপেনিং এ পিসি হার্ডওয়্যার আইডি লক করবে
            role: "User",
            is_banned: false,
            ban_reason: "",
            created_at: Date.now()
        });

        // লাইসেন্স লক ও ব্যবহৃত স্ট্যাটাস আপডেট
        await db.ref(`licenses/${licenseKey}`).update({
            is_used: true,
            used_by: newUid
        });

        await interaction.message.edit({ components: [] }).catch(() => {});
        return interaction.editReply(`🎉 চমৎকার! আপনার অ্যাকাউন্ট সফলভাবে সেটআপ হয়েছে।\n👤 **ইউজারনেম:** \`${username}\`\nআপনি এখন অরিজিনাল WinForms এক্সিকিউটর ওপেন করে সরাসরি লগইন করতে পারবেন।`);
    }

    // ==========================================================
    // ⚙️ PART 2.1 - ADMIN / DEVELOPER PANEL LOGIC (Channel: 1523955414612578354)
    // ==========================================================

    // ৯. অ্যাডমিন প্যানেল বাটন ক্লিক ইভেন্ট প্রসেস
    if (interaction.isButton() && (interaction.customId === "admin_create_full_acc" || interaction.customId === "admin_create_onetime_key")) {
        const isDev = interaction.member.roles.cache.has(ROLES.DEVELOPER);
        const isAdmin = interaction.member.roles.cache.has(ROLES.ADMIN);
        
        if (!isDev && !isAdmin) {
            return interaction.reply({ content: "❌ আপনার এই ডেভলপার কমান্ড অ্যাক্সেস করার অনুমতি নেই।", flags: [MessageFlags.Ephemeral] });
        }

        if (interaction.customId === "admin_create_full_acc") {
            const modal = new ModalBuilder().setCustomId("modal_admin_full_acc").setTitle("👑 ক্রিয়েট ফুল সিস্টেম অ্যাকাউন্ট (Admin)");
            const uInput = new TextInputBuilder().setCustomId("adm_user").setLabel("Username").setStyle(TextInputStyle.Short).setRequired(true);
            const pInput = new TextInputBuilder().setCustomId("adm_pass").setLabel("Password").setStyle(TextInputStyle.Short).setRequired(true);
            const lInput = new TextInputBuilder().setCustomId("adm_tier").setLabel("Tier (Premium/Trial/Lifetime)").setValue("Premium").setStyle(TextInputStyle.Short).setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(uInput), new ActionRowBuilder().addComponents(pInput), new ActionRowBuilder().addComponents(lInput));
            return interaction.showModal(modal);
        }

        if (interaction.customId === "admin_create_onetime_key") {
            const modal = new ModalBuilder().setCustomId("modal_admin_onetime").setTitle("⚡ জেনারেট ওয়ান-টাইম ইউজ কি (1-Time Use)");
            const tierInput = new TextInputBuilder().setCustomId("one_tier").setLabel("Product Tier").setValue("Trial").setStyle(TextInputStyle.Short).setRequired(true);
            const dayInput = new TextInputBuilder().setCustomId("one_days").setLabel("Duration Days").setValue("1").setStyle(TextInputStyle.Short).setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(tierInput), new ActionRowBuilder().addComponents(dayInput));
            return interaction.showModal(modal);
        }
    }

    // ১০. অ্যাডমিন দ্বারা সরাসরি ফুল ইউজার পাসওয়ার্ড + লাইসেন্স তৈরি সাবমিশন মোডাল
    if (interaction.isModalSubmit() && interaction.customId === "modal_admin_full_acc") {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const username = interaction.fields.getTextInputValue("adm_user").trim().toLowerCase();
        const password = interaction.fields.getTextInputValue("adm_pass").trim();
        const tier = interaction.fields.getTextInputValue("adm_tier").trim();

        const userCheck = await db.ref("users").orderByChild("username").equalTo(username).once("value");
        if (userCheck.exists()) return interaction.editReply("❌ এই ইউজারনেমটি ইতিমধ্যে বিদ্যমান।");

        const salt = await bcrypt.genSalt(11);
        const hashedPass = await bcrypt.hash(password, salt);
        const newUid = "admin_usr_" + Math.random().toString(36).substring(2, 11);
        const generatedKey = generateLicenseKey(false);

        await db.ref(`users/${newUid}`).set({
            username, password_hash: hashedPass, email: "admin_manual@system.local", hwid: "", role: "User", is_banned: false, ban_reason: "", created_at: Date.now()
        });

        await db.ref(`licenses/${generatedKey}`).set({
            key: generatedKey, app_id: "app_001", tier, duration_days: 30, is_used: true, used_by: newUid, expires_at: Date.now() + (30 * 24 * 60 * 60 * 1000), created_at: Date.now()
        });

        return interaction.editReply(`✅ **অ্যাডমিন ক্রিয়েশন সফল!**\n👤 User: \`${username}\`\n🔑 Key: \`${generatedKey}\`\nঅ্যাকাউন্ট সরাসরি অ্যাক্টিভেট ও ডেটাবেজে যুক্ত করা হয়েছে।`);
    }

    // ১১. ওয়ান-টাইম কি (Once Used Key) প্রসেস মোডাল সাবমিশন
    if (interaction.isModalSubmit() && interaction.customId === "modal_admin_onetime") {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const tier = interaction.fields.getTextInputValue("one_tier").trim();
        const days = parseInt(interaction.fields.getTextInputValue("one_days").trim()) || 1;

        const oneTimeKey = generateLicenseKey(true); // '1TIME-' প্রিফিক্স দিয়ে কি তৈরি হবে

        // ডেটাবেজে ওয়ান-টাইম রুলস ফ্ল্যাগ দিয়ে কি ইনসার্ট
        await db.ref(`licenses/${oneTimeKey}`).set({
            key: oneTimeKey,
            app_id: "app_001",
            tier: tier,
            duration_days: days,
            is_used: false, // কাস্টমার একবার সাবমিট করলেই এটি ট্রু হয়ে ব্লক হয়ে যাবে
            used_by: "",
            expires_at: Date.now() + (days * 24 * 60 * 60 * 1000),
            created_at: Date.now(),
            one_time_restriction: true // স্পেশাল ওয়ান টাইম চেক প্যারামিটার
        });

        return interaction.editReply(`⚡ **One-Time Use Key সফলভাবে জেনারেট হয়েছে!**\n🔑 Key: \`${oneTimeKey}\`\n\n*নোট: এই কিটি শুধুমাত্র একজন মেম্বার তার অ্যাকাউন্ট তৈরিতে একবারই ব্যবহার করতে পারবে। ব্যবহারের সাথে সাথে কিটি চিরতরে লক হয়ে যাবে।*`);
    }
});

// ================================
// 🎨 PART 3 - Admin Control Panel Layout Setup
// ================================

async function sendDeveloperAdminControlPanel(guild) {
    const channel = guild.channels.cache.get(CHANNELS.ADMIN_DEV_PANEL);
    if (!channel) return;

    // ক্লিয়ারিং ও নতুন প্যানেল রেন্ডারিং লজিক
    const messages = await channel.messages.fetch({ limit: 10 });
    const oldPanel = messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title.includes("SYSTEM CONTROL CENTER"));
    if (oldPanel) return; // প্যানেল অলরেডি থাকলে নতুন করে পাঠাবে না

    const embed = new EmbedBuilder()
        .setTitle("👑 DEVELOPER & ADMIN SYSTEM CONTROL CENTER")
        .setDescription(`স্বাগতম টিম অ্যাডমিনিস্ট্রেশন এবং ডেভেলপার অথোরিটি!\nএই ড্যাশবোর্ড থেকে আপনি সরাসরি লাইসেন্স সিস্টেম ম্যানেজ ও ওয়ান-টাইম কি কন্ট্রোল করতে পারবেন।\n\n⚙️ **অ্যাভেলেবল অপশনস:**\n⚡ **Create Account & Key:** সরাসরি ম্যানুয়াল ইউজার আইডি ও একটি নতুন ৩-ফিল্ড লাইসেন্স কি তৈরি করুন।\n🔑 **Generate One-Time Key:** ওয়ান টাইম ইউজ কি তৈরি করুন যা কাস্টমার ১ বারের বেশি ইউজ করতে পারবে না।`)
        .setColor("#9B59B6")
        .setThumbnail(COVER_IMAGES.TICKET)
        .setFooter({ text: "Internal Management Protocol v1.2.0" });

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("admin_create_full_acc").setLabel("Create Full Account + Key").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("admin_create_onetime_key").setLabel("Generate One-Time Key").setStyle(ButtonStyle.Danger)
    );

    await channel.send({ embeds: [embed], components: [buttons] });
}

// ================================
// 🚀 PART 4 - Live Core Setup Bot Events
// ================================

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild || message.guild.id !== ALLOWED_GUILD_ID) return;
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator) || message.member.roles.cache.has(ROLES.ADMIN);
    if (!isAdmin) return;

    // ম্যানুয়াল ডিপ্লয়মেন্ট কমান্ড
    if (message.content === "!setup-admin-panel" && message.channelId === CHANNELS.ADMIN_DEV_PANEL) {
        await sendDeveloperAdminControlPanel(message.guild);
        await message.delete().catch(() => {});
    }
});

client.once("clientReady", async () => {
    console.log(`🤖 C# Licensing Integration Bot Online as ${client.user.tag}`);
    client.user.setPresence({ activities: [{ name: "Firebase Secure Logs", type: ActivityType.Watching }], status: "online" });
    
    const guild = client.getGuilds.cache.get(ALLOWED_GUILD_ID);
    if (guild) {
        // অটোমেটিক্যালি অ্যাডমিন প্যানেল চ্যানেল ইনিশিয়ালাইজ করা
        await sendDeveloperAdminControlPanel(guild);
    }
});

client.login(TOKEN);
