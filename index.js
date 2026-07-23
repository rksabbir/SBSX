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
app.use(express.json());

const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot is Alive & Running 24/7!"));
app.listen(PORT, () => console.log(`🌐 Web server running on port ${PORT}`));

// ================================================
// 🔧 CONFIGURATION & CONSTANTS
// ================================================

const TOKEN = process.env.DISCORD_TOKEN;
const ALLOWED_GUILD_ID = process.env.ALLOWED_GUILD_ID;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const UNVERIFIED_ROLE_ID = process.env.UNVERIFIED_ROLE_ID;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const AUDIO_STREAM_URL = process.env.AUDIO_STREAM_URL || "https://stream.radiojar.com/0v9n06vcc9duv";
const ORDER_TRACKING_CHANNEL_ID = process.env.ORDER_TRACKING_CHANNEL_ID;

const ROLES = {
    ADMIN: process.env.ADMIN_ROLE_ID,
    SUPPORT_CUSTOMER: process.env.SUPPORT_CUSTOMER_ROLE_ID,
    SUPPORT_TICKET: process.env.SUPPORT_TICKET_ROLE_ID,
    SUPPORT_REPORT: process.env.SUPPORT_REPORT_ROLE_ID
};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

// ================================================
// 🔑 HELPER FUNCTIONS
// ================================================

// ইউজার ও পাসওয়ার্ড জেনারেটর
function generateCredentials(discordUser) {
    const cleanName = discordUser.username.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const randomPass = Math.random().toString(36).slice(-8);

    return {
        username: `${cleanName || 'user'}_${randomNum}`,
        password: `pass_${randomPass}`
    };
}

// ট্র্যাকিং এমবেড বিল্ডার
function buildOrderStatusEmbed(user, category, channel, status = "pending", claimedBy = null, approvedBy = null, txnId = "N/A") {
    let color = "Yellow";
    let statusText = "⏳ Pending Staff Claim";

    if (status === "claimed") {
        color = "Blue";
        statusText = `🛟 Claimed by ${claimedBy}`;
    } else if (status === "approved") {
        color = "Green";
        statusText = `✅ Approved by ${approvedBy}`;
    } else if (status === "closed") {
        color = "Red";
        statusText = "🔒 Order Channel Closed";
    }

    return new EmbedBuilder()
        .setTitle(`📦 Order Tracking Log`)
        .addFields(
            { name: "👤 Customer", value: `${user}`, inline: true },
            { name: "🛒 Category", value: `\`${category.toUpperCase()}\``, inline: true },
            { name: "💳 TxnID", value: `\`${txnId}\``, inline: true },
            { name: "📌 Status", value: statusText, inline: false },
            { name: "📍 Channel", value: `${channel}`, inline: true }
        )
        .setColor(color)
        .setTimestamp();
}

async function saveOrderLog(channelId, trackingMsgId, data) {
    try {
        await db.ref(`order_logs/${channelId}`).set({
            trackingMsgId,
            ...data
        });
    } catch (e) { console.error("Error saving order log:", e); }
}

// ================================================
// 🤖 DISCORD BOT EVENTS & INTERACTIONS
// ================================================

client.once("ready", () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    setBotPresence();
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (guild) connectVoice(guild);
});

// 📌 Interaction Handler (Modals, Buttons, Select Menus)
client.on("interactionCreate", async (interaction) => {
    if (!interaction.guild || interaction.guild.id !== ALLOWED_GUILD_ID) return;

    // --------------------------------------------
    // 💳 PAYMENT MODAL SUBMISSION HANDLER
    // --------------------------------------------
    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_payment_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const category = interaction.customId.split("_")[2];
        const txnId = interaction.fields.getTextInputValue("txn_id_input").trim();

        try {
            // 🔍 ১. Firebase Database থেকে Transaction ID চেক করা
            const txnRef = db.ref(`transactions/${txnId}`);
            const txnSnap = await txnRef.once("value");

            if (!txnSnap.exists()) {
                return interaction.editReply("❌ **অকার্যকর Transaction ID!** এই Transaction ID-টি আমাদের সিস্টেমে পাওয়া যায়নি।");
            }

            const txnData = txnSnap.val();

            // ট্রানজেকশনের used চেক (স্পেস বা নরমাল কী দুটোই সামলানোর জন্য)
            const isUsed = txnData.used === true || txnData["used "] === true;
            const isStatusActive = txnData.status !== false;

            if (!isStatusActive) {
                return interaction.editReply("❌ **Transaction বাতিল করা হয়েছে!** এই পেমেন্টটি সক্রিয় নয়।");
            }

            if (isUsed) {
                return interaction.editReply("❌ **Transaction ID ইতোমধ্যে ব্যবহৃত হয়েছে!** এটি দিয়ে পূর্বে একটি অ্যাকাউন্ট তৈরি করা হয়েছে।");
            }

            // 🔑 ২. অটোমেটিক ইউজারনেম ও পাসওয়ার্ড তৈরি
            const creds = generateCredentials(interaction.user);
            const subDays = txnData.days || 30; 
            const expiryTimestamp = Date.now() + (subDays * 24 * 60 * 60 * 1000);

            // 💾 ৩. C++ Loader / App-এর জন্য Firebase-এ ইউজার তথ্য সংরক্ষণ
            await db.ref(`users/${creds.username}`).set({
                username: creds.username,
                password: creds.password,
                discordId: interaction.user.id,
                product: txnData.product || category,
                amount: txnData.amount || 0,
                status: "active",
                createdAt: Date.now(),
                expiresAt: expiryTimestamp,
                hwid: "" // C++ Loader প্রথম লগইনে অটো বাইন্ড করবে
            });

            // 🔥 ৪. Transaction ID Burn / Used আপডেট করা
            await txnRef.update({
                used: true,
                "used ": true,
                usedBy: interaction.user.id,
                usedAt: Date.now(),
                assignedUser: creds.username
            });

            // 📁 ৫. প্রাইভেট অর্ডার চ্যানেল ক্রিয়েট
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

            // 📩 ৬. অর্ডার চ্যানেলে লগইন ক্রেডেনশিয়াল পাঠানো
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

            // 📬 ৭. ইউজারের ডিরেক্ট ইনবক্সে (DM) লগইন পাসওয়ার্ড পাঠানো
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

client.on("voiceStateUpdate", async () => {
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (guild && guild.members.me && !guild.members.me.voice.channel) await connectVoice(guild);
});

// ================================================
// 🚀 BOT STARTUP
// ================================================

client.login(TOKEN);
