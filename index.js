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
    TextInputStyle,
    REST,
    Routes,
    SlashCommandBuilder
} = require("discord.js");

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus
} = require("@discordjs/voice");

const discordTranscripts = require("discord-html-transcripts");

// 🔑 Firebase Service Account Load
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

// 🔥 Firebase Initialization
const firebaseURL = process.env.FIREBASE_DB_URL || "YOUR_FIREBASE_DATABASE_URL";
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: firebaseURL
});
const db = admin.database();

// 🌐 Express Server Setup
const app = express();
app.get("/", (req, res) => { res.send("Bot is running!"); });
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🌐 Web server running on port ${PORT}`); });

// ================================================
// ⚙️ Bot Config & Automod Rules
// ================================================

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || "YOUR_BOT_CLIENT_ID";
const ALLOWED_GUILD_ID = "1488101970425155584";
const VERIFIED_ROLE_ID = "1488333841402691664";
const WELCOME_CHANNEL_ID = "1488339169821593731";
const LOG_CHANNEL_ID = "1488340400673656973";
const VOICE_CHANNEL_ID = "1523230098193383595";

const ORDER_TRACKING_CHANNEL_ID = "1488340262827855983";
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

const STATS_VC_CHANNEL_ID = "1524321192079786005";
const LEVEL_ROLE_ID = "1524322087295127552";
const GIVEAWAY_CHANNEL_ID = "1488341249739198585";
const EMBED_NOTICE_CHANNEL_ID = "1488338739850772641";
const SOCIAL_FEED_CHANNEL_ID = "1488338739850772641";
const STAFF_ADMIN_LOG_ID = "1524324771502882877";
const WEEKLY_REPORT_CHANNEL_ID = "1524326280923709550";
const TRANSCRIPT_LOG_CHANNEL_ID = "1524326928268660807";
const AUDIO_STREAM_URL = "https://server11.fmlistening.com/8056_time"; 

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
// 🔑 Credentials & Helpers
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

// 📦 Firebase Panel Data Fetcher
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
// 📂 Database Helpers (Firebase Fully Integrated)
// ================================================
async function getSavedMembers() {
    const snap = await db.ref("bot_data/members").once("value");
    return snap.val() || [];
}
async function saveMembers(memberIds) {
    await db.ref("bot_data/members").set(memberIds);
}
async function getWelcomeLogs() {
    const snap = await db.ref("bot_data/welcome_logs").once("value");
    return snap.val() || {};
}
async function saveWelcomeLog(userId, messageId, data = {}) {
    await db.ref(`bot_data/welcome_logs/${userId}`).set({ messageId, ...data });
}
async function getPunishments() {
    const snap = await db.ref("bot_data/punishments").once("value");
    return snap.val() || {};
}
async function savePunishment(userId, status, durationMs = null) {
    if (status === null) {
        await db.ref(`bot_data/punishments/${userId}`).remove();
    } else {
        await db.ref(`bot_data/punishments/${userId}`).set({
            status: status,
            time: Date.now(),
            expiresAt: durationMs ? Date.now() + durationMs : null
        });
    }
}
async function saveOrderLog(trackingMessageId, orderDetails) {
    await db.ref(`bot_data/order_logs/${trackingMessageId}`).set(orderDetails);
}

// ================================================
// 🎉 Dynamic Embed Builders
// ================================================
function buildDynamicWelcomeEmbed(member, status, isOfflineHook = false, verifyTime = null) {
    let statusText = "❌ Unverified";
    let color = "#FFA500"; 
    let thumbnail = member.user ? member.user.displayAvatarURL({ dynamic: true }) : null;
    let tag = member.user ? member.user.tag : member.userId || "Unknown Member";
    let id = member.id || member.userId;
    let joinedTime = member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "Unknown";

    if (status === "verified") { statusText = "✅ Verified"; color = "#00FF00"; }
    else if (status === "left") { statusText = "🚫 Left Server"; color = "#FF0000"; }

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle("🎉 নতুন সদস্য ট্র্যাকিং সিস্টেম")
        .setDescription(`✨ স্বাগতম <@${id}> আমাদের সার্ভারে!\n📜 আমাদের নিয়মগুলো মেনে চলার অনুরোধ রইল। ❤️`)
        .addFields(
            { name: "👤 Username", value: `${tag}`, inline: true },
            { name: "🆔 User ID", value: `${id}`, inline: true },
            { name: "⏰ Joined Server", value: joinedTime, inline: true },
            { name: "🛡️ Verification Status", value: `**${statusText}**`, inline: true }
        )
        .setTimestamp();

    if (thumbnail) embed.setThumbnail(thumbnail);
    if (member.guild) embed.addFields({ name: "👥 Total Members", value: `${member.guild.memberCount}`, inline: true });
    if (verifyTime) embed.addFields({ name: "⚡ Verified At", value: `<t:${Math.floor(verifyTime / 1000)}:R>`, inline: true });
    if (isOfflineHook) embed.setFooter({ text: "⚠️ বট অফলাইন থাকার সময় এই অ্যাকশনটি ঘটেছিল।" });
    else embed.setFooter({ text: "Professional Security Management System" });
    
    return embed;
}

function buildOrderStatusEmbed(user, category, status, txnId = null) {
    let color = "#00FF00";
    let statusString = "✅ COMPLETED & INSTANT DELIVERED";

    const embed = new EmbedBuilder()
        .setTitle("📦 ORDER INSTANT DELIVERY LOG")
        .setColor(color)
        .addFields(
            { name: "👤 কাস্টমার", value: `${user}`, inline: true },
            { name: "🛒 প্রোডাক্ট/ক্যাটাগরি", value: `\`${category.toUpperCase().replace("_", " ")}\``, inline: true },
            { name: "📊 বর্তমান স্ট্যাটাস", value: `**${statusString}**`, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: "Automated Instant Delivery System" });

    if (txnId) {
        let maskedTxnId = txnId.length > 4 ? txnId.substring(0, 2) + "****" + txnId.substring(txnId.length - 2) : "****";
        embed.addFields({ name: "💳 Transaction ID", value: `\`${maskedTxnId}\``, inline: true });
    }
    
    return embed;
}

// ================================================
// 🤖 Ghost Ping & Automod System
// ================================================
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

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild || message.guild.id !== ALLOWED_GUILD_ID) return;
    if (message.member.permissions.has(PermissionFlagsBits.Administrator) || message.member.roles.cache.has(ROLES.ADMIN)) return;
    
    const userId = message.author.id; 
    let triggerAutomod = false; 
    let reason = "";
    const contentLower = message.content.toLowerCase();

    // Caps-Lock Check
    const upperCount = message.content.replace(/[^A-Z]/g, "").length;
    const totalLetters = message.content.replace(/[^a-zA-Z]/g, "").length;
    if (totalLetters > 5 && (upperCount / totalLetters) > 0.7) {
        try { await message.delete().catch(() => {}); } catch(e){}
        const capsWarn = await message.channel.send(`⚠️ <@${userId}>, মেসেজে অতিরিক্ত বড় হাতের অক্ষর (Caps Lock) ব্যবহার করবেন না।`);
        setTimeout(() => capsWarn.delete().catch(() => {}), 5000);
        return;
    }

    // Activity XP System (Firebase)
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

    // Live DB Link Response
    if (contentLower.includes("link") || contentLower.includes("লিংক") || contentLower.includes("লিঙ্ক")) {
        try {
            const snapshot = await db.ref("settings/verification_link").once("value");
            const dbLink = snapshot.val() || "কোনো লিংক ফায়ারবেসে পাওয়া যায়নি।";
            return message.reply(`👋 আপনি কি সার্ভার বা ভেরিফিকেশন লিংক খুঁজছেন? এই নিন আমাদের লাইভ লিংক:\n\`${dbLink}\``);
        } catch (err) {}
    }

    if (BAD_WORDS.some(word => contentLower.includes(word))) { 
        triggerAutomod = true; 
        reason = "গালিগালাজ / নিষিদ্ধ শব্দ ব্যবহার"; 
    }

    if (!triggerAutomod) {
        const now = Date.now();
        if (!userMsgCounter.has(userId)) userMsgCounter.set(userId, []);
        const timestamps = userMsgCounter.get(userId); 
        timestamps.push(now);
        const activeTimestamps = timestamps.filter(time => time > now - 5000);
        userMsgCounter.set(userId, activeTimestamps);
        if (activeTimestamps.length >= 5) { 
            triggerAutomod = true; 
            reason = "অতিরিক্ত স্প্যামিং করা"; 
        }
    }

    if (triggerAutomod) {
        try { await message.delete().catch(() => {}); } catch(e){}
        let warns = (userWarns.get(userId) || 0) + 1; 
        userWarns.set(userId, warns);
        if (warns < 3) {
            const warnEmbed = new EmbedBuilder().setColor("Yellow").setDescription(`⚠️ <@${userId}>, সার্ভারে **${reason}** নিষিদ্ধ! আপনি এটি **${warns}/৩** বার করেছেন।`);
            const warnMsg = await message.channel.send({ embeds: [warnEmbed] }); 
            setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
        } else {
            userWarns.set(userId, 0);
            await savePunishment(userId, "Muted", 10 * 60 * 1000); 
            try { 
                await message.member.timeout(10 * 60 * 1000, "Automod: Limit Exceeded");
                const muteEmbed = new EmbedBuilder().setColor("Red").setTitle("🚫 মেম্বার মিউটেড").setDescription(`<@${userId}> কে ১০ মিনিটের জন্য মিউট করা হয়েছে।`); 
                await message.channel.send({ embeds: [muteEmbed] });
            } catch (err) {}
        }
    }
});

// ================================================
// ⚡ PART 3 - Interaction Handling & Buy Command
// ================================================

// 🔘 Slash Commands Registering
const commands = [
    new SlashCommandBuilder()
        .setName("buy")
        .setDescription("অটোমেটিক ট্রানজেকশন আইডি দিয়ে পণ্য কিনুন")
        .addStringOption(option => 
            option.setName("transaction_id")
                .setDescription("আপনার পেমেন্টের Transaction ID লিখুন")
                .setRequired(true)
        )
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log("Started refreshing application (/) commands.");
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands },
        );
        console.log("Successfully reloaded application (/) commands.");
    } catch (error) {
        console.error(error);
    }
})();

client.on("interactionCreate", async (interaction) => {
    if (!interaction.guild || interaction.guild.id !== ALLOWED_GUILD_ID) return;

    // ⚡ Slash Command /buy Processing
    if (interaction.isChatInputCommand() && interaction.commandName === "buy") {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const txnId = interaction.options.getString("transaction_id").trim();

        try {
            // 🔥 ১. Firebase Validation
            const txnRef = db.ref(`transactions/${txnId}`);
            const txnSnap = await txnRef.once("value");

            if (!txnSnap.exists()) {
                return interaction.editReply("❌ **অকার্যকর Transaction ID!** এই Transaction ID-টি আমাদের সিস্টেমে পাওয়া যায়নি।");
            }

            const txnData = txnSnap.val();
            const isUsed = txnData.used === true || txnData["used "] === true;
            const isStatusActive = txnData.status !== false;

            if (!isStatusActive) {
                return interaction.editReply("❌ **Transaction বাতিল করা হয়েছে!** এই পেমেন্টটি বর্তমানে সক্রিয় নয়।");
            }

            if (isUsed) {
                return interaction.editReply("❌ **Transaction ID ইতোমধ্যে ব্যবহৃত হয়েছে!** এটি দিয়ে পূর্বে একটি অ্যাকাউন্ট তৈরি করা হয়েছে।");
            }

            // 🔑 ২. Credentials Generation
            const creds = generateCredentials(interaction.user);
            const subDays = txnData.days || 30;
            const expiryTimestamp = Date.now() + (subDays * 24 * 60 * 60 * 1000);

            // 💾 ৩. Save to Firebase
            await db.ref(`users/${creds.username}`).set({
                username: creds.username,
                password: creds.password,
                discordId: interaction.user.id,
                product: txnData.product || "General Service",
                amount: txnData.amount || 0,
                status: "active",
                createdAt: Date.now(),
                expiresAt: expiryTimestamp,
                hwid: ""
            });

            // 🔥 ৪. Burn Transaction ID
            await txnRef.update({
                used: true,
                "used ": true,
                usedBy: interaction.user.id,
                usedAt: Date.now(),
                assignedUser: creds.username
            });

            // 📩 ৫. Directly Send Details to Direct Message (DM) & Reply Slash Message
            const accountEmbed = new EmbedBuilder()
                .setTitle(`🎉 Verification Success & Account Created!`)
                .setDescription(`স্বাগতম ${interaction.user}!\nআপনার পেমেন্ট ভেরিফাই করা হয়েছে। কোনো অর্ডার চ্যানেল খোলা হয়নি, আপনার অ্যাকাউন্টের বিবরণ নিচে দেওয়া হলো:\n\n**🛒 প্রোডাক্ট:** \`${txnData.product || "General"}\`\n**💳 Transaction ID:** \`${txnId}\`

🔑 **Software / App Login Credentials:**
> 👤 **Username:** \`${creds.username}\`
> 🔑 **Password:** \`${creds.password}\`
> 📅 **মেয়াদ:** <t:${Math.floor(expiryTimestamp / 1000)}:R>

⚠️ *নিরাপত্তার স্বার্থে আপনার ইউজারনেম ও পাসওয়ার্ড কারো সাথে শেয়ার করবেন না।*`)
                .setColor("Green")
                .setTimestamp();

            // DM-তে সেন্ড করা
            let dmSuccess = true;
            try {
                await interaction.user.send({ embeds: [accountEmbed] });
            } catch (dmErr) {
                dmSuccess = false;
            }

            // Slash Command response-এ সেন্ড করা (কোনো চ্যানেল তৈরি ছাড়া)
            await interaction.editReply({ 
                content: dmSuccess ? "✅ **পেমেন্ট ভেরিফাই হয়েছে!** আপনার ইনবক্সে (DM) এবং নিচে অ্যাকাউন্ট ল্যান্স ও পাসওয়ার্ড সেন্ড করা হলো:" : "✅ **পেমেন্ট ভেরিফাই হয়েছে!** (আপনার DM বন্ধ থাকায় নিচে ক্রেডেনশিয়াল দেওয়া হলো):", 
                embeds: [accountEmbed] 
            });

            // 📊 . Tracking Channel Update
            const trackingChannel = interaction.guild.channels.cache.get(ORDER_TRACKING_CHANNEL_ID);
            if (trackingChannel) {
                const trackingEmbed = buildOrderStatusEmbed(interaction.user, txnData.product || "General", "completed", txnId);
                const trackingMsg = await trackingChannel.send({ embeds: [trackingEmbed] }).catch(() => {});
                if (trackingMsg) {
                    await saveOrderLog(trackingMsg.id, { 
                        userId: interaction.user.id, 
                        product: txnData.product || "General", 
                        status: "completed", 
                        txnId: txnId,
                        username: creds.username 
                    });
                }
            }

        } catch (err) {
            console.error("❌ Slash Buy Error:", err);
            return interaction.editReply("❌ **প্রসেসিংয়ে ত্রুটি ঘটেছে!** অনুগ্রহ করে অ্যাডমিনের সাথে যোগাযোগ করুন।");
        }
        return;
    }

    // Buttons and Select Menus Handler
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
        const cooldownKey = `${interaction.user.id}-${interaction.customId}`;
        if (cooldowns.has(cooldownKey) && interaction.customId !== "universal_verify_button" && !interaction.customId.startsWith("pay_") && !interaction.customId.startsWith("giveaway_join_") && !interaction.customId.startsWith("star_rating_")) return interaction.reply({ content: "⚠️ আপনি খুব দ্রুত ক্লিক করছেন!", flags: [MessageFlags.Ephemeral] });
        cooldowns.set(cooldownKey, true); setTimeout(() => cooldowns.delete(cooldownKey), 3000);
    }

    // Member Verification Button
    if (interaction.isButton() && interaction.customId === "universal_verify_button") {
        try {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            const role = interaction.guild.roles.cache.get(VERIFIED_ROLE_ID);
            if (!role) return interaction.editReply("❌ Role not found!");
            if (interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) return interaction.editReply("⚠️ আপনি ইতোমধ্যে ভেরিফাই হয়েছেন।");
            await interaction.member.roles.add(role);
            await interaction.editReply("✅ সফলভাবে ভেরিফাই সম্পন্ন হয়েছে!");
            
            db.ref(`analytics/joins/${Date.now()}`).set(interaction.user.id);

            const logs = await getWelcomeLogs(); 
            const userLog = logs[interaction.user.id]; 
            const welcomeChannel = interaction.guild.channels.cache.get(WELCOME_CHANNEL_ID);
            if (userLog && welcomeChannel) { 
                try { 
                    const msg = await welcomeChannel.messages.fetch(userLog.messageId);
                    if (msg) { 
                        const updatedEmbed = buildDynamicWelcomeEmbed(interaction.member, "verified", userLog.isOffline, Date.now()); 
                        await msg.edit({ embeds: [updatedEmbed] });
                    } 
                } catch (e) {} 
            }
        } catch (err) { console.error(err); }
        return;
    }

    // Giveaway Participant Tracking
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

    // Feedback & Rating Modal Trigger
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

    // Panel Select Menus
    if (interaction.isStringSelectMenu() && (interaction.customId.startsWith("select_product_") || interaction.customId.startsWith("select_report_") || interaction.customId.startsWith("select_customer_") || interaction.customId.startsWith("select_buy_"))) {
        const value = interaction.values[0];
        if (value === "none" || value === "error") return interaction.reply({ content: "❌ অবৈধ অপশন!", flags: [MessageFlags.Ephemeral] });

        if (interaction.customId === "select_buy_category") {
            const modal = new ModalBuilder().setCustomId(`modal_payment_${value}`).setTitle("💳 Direct Payment Verification");
            const txnInput = new TextInputBuilder()
                .setCustomId("txn_id_input")
                .setLabel("আপনার Transaction ID টি সঠিক ভাবে লিখুন")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(txnInput));
            return interaction.showModal(modal);
        }
    }

    // Modal Direct Account Verification (Panel-ভিত্তিক কোনো অর্ডার চ্যানেল খোলা ছাড়া)
    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_payment_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const category = interaction.customId.split("_")[2];
        const txnId = interaction.fields.getTextInputValue("txn_id_input").trim();

        try {
            const txnRef = db.ref(`transactions/${txnId}`);
            const txnSnap = await txnRef.once("value");

            if (!txnSnap.exists()) {
                return interaction.editReply("❌ **অকার্যকর Transaction ID!** এই Transaction ID-টি আমাদের সিস্টেমে পাওয়া যায়নি।");
            }

            const txnData = txnSnap.val();
            const isUsed = txnData.used === true || txnData["used "] === true;

            if (isUsed) {
                return interaction.editReply("❌ **Transaction ID ইতোমধ্যে ব্যবহৃত হয়েছে!** এটি দিয়ে পূর্বে অ্যাকাউন্ট তৈরি হয়েছে।");
            }

            const creds = generateCredentials(interaction.user);
            const subDays = txnData.days || 30;
            const expiryTimestamp = Date.now() + (subDays * 24 * 60 * 60 * 1000);

            await db.ref(`users/${creds.username}`).set({
                username: creds.username,
                password: creds.password,
                discordId: interaction.user.id,
                product: txnData.product || category,
                amount: txnData.amount || 0,
                status: "active",
                createdAt: Date.now(),
                expiresAt: expiryTimestamp,
                hwid: ""
            });

            await txnRef.update({
                used: true,
                "used ": true,
                usedBy: interaction.user.id,
                usedAt: Date.now(),
                assignedUser: creds.username
            });

            const accountEmbed = new EmbedBuilder()
                .setTitle(`🎉 Account Created & Delivered!`)
                .setDescription(`স্বাগতম ${interaction.user}!\nআপনার অ্যাকাউন্ট পেমেন্ট ভ্যালিডেট হয়ে তৈরি সম্পন্ন হয়েছে:\n\n**🛒 প্রোডাক্ট:** \`${txnData.product || category.toUpperCase()}\`\n**💳 Transaction ID:** \`${txnId}\`

🔑 **Software Login Credentials:**
> 👤 **Username:** \`${creds.username}\`
> 🔑 **Password:** \`${creds.password}\`
> 📅 **মেয়াদ:** <t:${Math.floor(expiryTimestamp / 1000)}:R>`)
                .setColor("Green")
                .setTimestamp();

            try { await interaction.user.send({ embeds: [accountEmbed] }); } catch (dmErr) {}

            const trackingChannel = interaction.guild.channels.cache.get(ORDER_TRACKING_CHANNEL_ID);
            if (trackingChannel) {
                const trackingEmbed = buildOrderStatusEmbed(interaction.user, category, "completed", txnId);
                const trackingMsg = await trackingChannel.send({ embeds: [trackingEmbed] }).catch(() => {});
                if (trackingMsg) {
                    await saveOrderLog(trackingMsg.id, { 
                        userId: interaction.user.id, 
                        category: category, 
                        status: "completed", 
                        txnId: txnId,
                        username: creds.username 
                    });
                }
            }

            return interaction.editReply({
                content: "✅ **আপনার পেমেন্ট ভেরিফাই সম্পন্ন হয়েছে!** নিচে এবং আপনার ইনবক্সে অ্যাকাউন্ট ডিটেইলস পাঠানো হয়েছে:",
                embeds: [accountEmbed]
            });

        } catch (err) {
            console.error("❌ Payment Modal Error:", err);
            return interaction.editReply("❌ **প্রসেসিংয়ে ত্রুটি ঘটেছে!**");
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
