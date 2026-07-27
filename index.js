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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

// ================================
// 🛠️ Helper Functions & Order Tracking
// ================================

function buildOrderStatusEmbed(user, category, ticketChannel, status, staff = null, reason = null, txnId = null, lockType = "digital") {
    let color = "#FFFF00"; 
    let statusString = "⏳ PENDING (অপেক্ষমাণ)";
    
    if (status === "approved") { color = "#00FF00"; statusString = `✅ APPROVED & RUNNING (কাজ চলছে)`; }
    else if (status === "closed") { color = "#FF0000"; statusString = "🔒 CLOSED (টিকিট বন্ধ করা হয়েছে)"; }
    else if (status === "banned") { color = "#2F3136"; statusString = `🚫 FAKE TICKET BAN (${reason || "ফানি টিকিট"})`; }

    const lockString = lockType === "hwid" ? "🔒 HWID Lock (1 PC Only)" : "🔑 Digital Lock (Any PC, Active Session)";

    const embed = new EmbedBuilder()
        .setTitle("📦 ORDER TRACKING SYSTEM")
        .setColor(color)
        .addFields(
            { name: "👤 কাস্টমার", value: `${user}`, inline: true },
            { name: "🛒 প্রোডাক্ট/ক্যাটাগরি", value: `\`${category.toUpperCase().replace("_", " ")}\``, inline: true },
            { name: "🛡️ সিকিউরিটি টাইপ", value: `\`${lockString}\``, inline: true },
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

async function saveOrderLog(channelId, trackingMsgId, data) {
    await db.ref(`order_logs/${channelId}`).set({
        trackingMsgId: trackingMsgId,
        ...data
    });
}

async function getOrderLog(channelId) {
    const snap = await db.ref(`order_logs/${channelId}`).once("value");
    return snap.exists() ? snap.val() : null;
}

async function getDynamicTicketPanel() {
    const embed = new EmbedBuilder()
        .setTitle("🎫 SUPPORT TICKET SYSTEM")
        .setDescription("আপনার যেকোনো সাহায্য বা প্রশ্নের জন্য নিচের বাটন চেপে টিকিট খুলুন।")
        .setColor("Blue")
        .setImage(COVER_IMAGES.TICKET);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("open_ticket").setLabel("Create Ticket").setStyle(ButtonStyle.Primary).setEmoji("🎫")
    );

    return { embeds: [embed], components: [row] };
}

async function getDynamicReportPanel() {
    const embed = new EmbedBuilder()
        .setTitle("🚨 REPORT & COMPLAINT PANEL")
        .setDescription("কোনো সদস্য বা স্টাফের বিরুদ্ধে রিপোর্ট করতে নিচের বাটনটি ব্যবহার করুন।")
        .setColor("Red")
        .setImage(COVER_IMAGES.REPORT);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("open_report").setLabel("Submit Report").setStyle(ButtonStyle.Danger).setEmoji("🚨")
    );

    return { embeds: [embed], components: [row] };
}

async function getDynamicCustomerPanel() {
    const embed = new EmbedBuilder()
        .setTitle("👑 CUSTOMER SUPPORT PANEL")
        .setDescription("শুধুমাত্র প্রিমিয়াম ক্লায়েন্ট ও কাস্টমারদের সহযোগিতার জন্য।")
        .setColor("Gold")
        .setImage(COVER_IMAGES.CUSTOMER);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("open_customer").setLabel("Customer Support").setStyle(ButtonStyle.Success).setEmoji("👑")
    );

    return { embeds: [embed], components: [row] };
}

// ================================
// 🎮 Client Event Listeners
// ================================

client.once("ready", () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);
    setBotPresence();

    // প্যানেল অটো-আপডেট লিসেনার
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (!guild) return;

    setInterval(async () => {
        try {
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
        } catch (e) {
            console.error("Error updating panels:", e);
        }
    }, 60000);
});

// 📩 Interaction Handlers
client.on("interactionCreate", async (interaction) => {
    try {
        // 🛒 Panel Buy Selection Menu Handler
        if (interaction.isStringSelectMenu() && (interaction.customId === "buy_panel_menu" || interaction.customId === "select_buy_option")) {
            const selectedCategory = interaction.values[0];

            // লক টাইপ চয়েস ড্রপডাউন
            const lockTypeMenu = new StringSelectMenuBuilder()
                .setCustomId(`select_lock_type_${selectedCategory}`)
                .setPlaceholder("🔐 সিকিউরিটি / লক টাইপ সিলেক্ট করুন")
                .addOptions([
                    {
                        label: "🔒 HWID Lock (1 PC Only)",
                        description: "একটি নির্দিষ্ট পিসির সাথে লক হয়ে যাবে।",
                        value: "hwid"
                    },
                    {
                        label: "🔑 Digital Lock (Any PC, Active Session)",
                        description: "যেকোনো পিসিতে চালানো যাবে, তবে এক সাথে ১ পিসিতেই লগইন থাকবে।",
                        value: "digital"
                    }
                ]);

            const row = new ActionRowBuilder().addComponents(lockTypeMenu);

            const lockEmbed = new EmbedBuilder()
                .setTitle("🔐 Select Security Locking System")
                .setColor("Blurple")
                .setDescription(`আপনি **${selectedCategory.toUpperCase()}** প্যাকেজটি নির্বাচন করেছেন।

অনুগ্রহ করে নিচে থেকে আপনার সুবিধাজনক **Lock Type** সিলেক্ট করুন:`)
                .addFields(
                    { name: "🔒 HWID Lock", value: "আপনার অ্যাকাউন্ট বা কিটি একটি নির্দিষ্ট পিসির সাথে আবদ্ধ থাকবে।" },
                    { name: "🔑 Digital Lock (Active Session)", value: "আপনি যেকোনো পিসিতে লগইন করতে পারবেন। প্যানেল বন্ধ করলে অন্য পিসিতে সাথে সাথেই লগইন করতে পারবেন।" }
                );

            return interaction.reply({ embeds: [lockEmbed], components: [row], flags: [MessageFlags.Ephemeral] });
        }

        // 🔒 Lock Type Selected -> Modal Open Handler
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith("select_lock_type_")) {
            const category = interaction.customId.replace("select_lock_type_", "");
            const lockType = interaction.values[0];

            const modal = new ModalBuilder()
                .setCustomId(`buy_panel_modal_${category}_${lockType}`)
                .setTitle(`🛒 ${category.toUpperCase()} - Payment Info`);

            const trxInput = new TextInputBuilder()
                .setCustomId("trx_id")
                .setLabel("bKash / Nagad Transaction ID (TrxID)")
                .setStyle(TextInputStyle.Short)
                .setPlaceholder("Ex: BKA1234567")
                .setRequired(true);

            const phoneInput = new TextInputBuilder()
                .setCustomId("sender_number")
                .setLabel("আপনার বিকাশ / নগদ নম্বর")
                .setStyle(TextInputStyle.Short)
                .setPlaceholder("017xxxxxxxx")
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(trxInput),
                new ActionRowBuilder().addComponents(phoneInput)
            );

            return interaction.showModal(modal);
        }

        // 📥 Payment Modal Submission Handler
        if (interaction.isModalSubmit() && interaction.customId.startsWith("buy_panel_modal_")) {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            const parts = interaction.customId.split("_");
            const category = parts[3];
            const lockType = parts[4] || "digital";

            const trxId = interaction.fields.getTextInputValue("trx_id").trim();
            const senderNumber = interaction.fields.getTextInputValue("sender_number").trim();

            const orderId = "ORD-" + Date.now().toString().slice(-6);
            const orderRef = db.ref(`orders/${orderId}`);

            await orderRef.set({
                orderId: orderId,
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                category: category,
                lockType: lockType,
                trxId: trxId,
                senderNumber: senderNumber,
                status: "pending",
                isOnline: false,
                createdAt: Date.now()
            });

            const channelName = `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
            const ticketChannel = await interaction.guild.channels.create({
                name: channelName,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    { id: ROLES.ADMIN, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ]
            });

            const trackingEmbed = buildOrderStatusEmbed(interaction.user, category, ticketChannel, "pending", null, null, trxId, lockType);

            const trackingChan = interaction.guild.channels.cache.get(ORDER_TRACKING_CHANNEL_ID);
            if (trackingChan) {
                const trackingMsg = await trackingChan.send({ embeds: [trackingEmbed] });
                saveOrderLog(ticketChannel.id, trackingMsg.id, {
                    userId: interaction.user.id,
                    category: category,
                    lockType: lockType,
                    trxId: trxId
                });
            }

            const successEmbed = new EmbedBuilder()
                .setTitle("🎉 Order Ticket Created!")
                .setColor("Green")
                .setDescription(`আপনার অর্ডারটি পেন্ডিং হিসেবে গ্রহণ করা হয়েছে।\n\n📌 **টিকিট চ্যানেল:** ${ticketChannel}\n🛡️ **Lock Type:** \`${lockType.toUpperCase()}\`\n💳 **TrxID:** \`${trxId}\``)
                .setFooter({ text: "আমাদের টিম অতি শীঘ্রই এটি অনুমোদন করবে।" });

            await interaction.editReply({ embeds: [successEmbed] });
        }

    } catch (err) {
        console.error("Interaction Error:", err);
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
