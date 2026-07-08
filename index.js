// ================================
// 🚀 PART 1 - Setup + Express + Firebase + Config + Imports
// ================================

const express = require("express");
const fs = require("fs");
const admin = require("firebase-admin");

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

const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require("@discordjs/voice");

// Firebase Configuration Setup via Environment Variables Only
let serviceAccount;
try {
    if (process.env.FIREBASE_CONFIG) {
        serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
    } else {
        throw new Error("FIREBASE_CONFIG Environment Variable is missing!");
    }
} catch (e) {
    console.error("❌ Firebase Config Load Error:", e.message);
    process.exit(1);
}

const firebaseURL = process.env.FIREBASE_DB_URL;
if (!firebaseURL) {
    console.error("❌ FIREBASE_DB_URL Environment Variable is missing!");
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: firebaseURL
});
const db = admin.database();

const app = express();
app.get("/", (req, res) => { res.send("15-Feature Bot Running Successfully!"); });
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🌐 Web server running on port ${PORT}`); });

// ================================
// ⚙️ Core Configuration & IDs
// ================================

const TOKEN = process.env.TOKEN;
const ALLOWED_GUILD_ID = "1488101970425155584";
const VERIFIED_ROLE_ID = "1488333841402691664";

const WELCOME_CHANNEL_ID = "1488339169821593731";
const LOG_CHANNEL_ID = "1488340400673656973";
const VOICE_CHANNEL_ID = "1523230098193383595";
const ORDER_TRACKING_CHANNEL_ID = "1488340262827855983"; 
const ORDER_GUIDE_CHANNEL_ID = "1488339045602951199";
const REVIEW_CHANNEL_ID = "1488340441115004999"; 
const ANNOUNCEMENT_CHANNEL_ID = "1488339169821593731"; 

let STATS_TOTAL_MEMBERS_VC = "1523230098193383596"; 
let STATS_ACTIVE_VC_CH = "1523230098193383597";
const JOIN_TO_CREATE_VC_ID = "1523230098193383598"; 

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
    VERIFY: "https://cdn.discordapp.com/attachments/1488338142607184055/1488761437550678056/5cfd1fe4-d12c-4439-b374-f386f7595184.png"
};

const BAD_WORDS = ["gali1", "gali2", "gali3", "khanki", "magi", "baimon"]; 

const DATA_FILE = "./database.json";
const WELCOME_LOG_FILE = "./welcome_messages.json";
const PUNISH_FILE = "./punishments.json"; 
const ORDER_LOG_FILE = "./order_tracking.json"; 

const userMsgCounter = new Map(); 
const userWarns = new Map(); 
const temporaryVoiceChannels = new Map(); 

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

function savePunishment(userId, status, durationMs = null) { 
    if (!fs.existsSync(PUNISH_FILE)) fs.writeFileSync(PUNISH_FILE, JSON.stringify({}), "utf8");
    const punishments = JSON.parse(fs.readFileSync(PUNISH_FILE, "utf8")); 
    if (status === null) { delete punishments[userId]; } 
    else { punishments[userId] = { status: status, time: Date.now(), expiresAt: durationMs ? Date.now() + durationMs : null }; } 
    fs.writeFileSync(PUNISH_FILE, JSON.stringify(punishments, null, 2), "utf8"); 
}

async function updateServerStats(guild) {
    if (!guild) return;
    try {
        const totalMembers = guild.memberCount;
        const activeVcCount = guild.members.cache.filter(m => m.voice.channel).size;
        const ch1 = guild.channels.cache.get(STATS_TOTAL_MEMBERS_VC);
        if (ch1) await ch1.setName(`👥 Total Members: ${totalMembers}`).catch(() => {});
        const ch2 = guild.channels.cache.get(STATS_ACTIVE_VC_CH);
        if (ch2) await ch2.setName(`🎙️ Active in VC: ${activeVcCount}`).catch(() => {});
    } catch (e) { console.error("Stats update error:", e); }
}

async function handleUserLeveling(message) {
    const userId = message.author.id;
    const userRef = db.ref(`leveling/${userId}`);
    const snapshot = await userRef.once("value");
    let userData = snapshot.val() || { xp: 0, level: 1 };

    userData.xp += Math.floor(Math.random() * 10) + 5; 
    let nextLevelXp = userData.level * 100;

    if (userData.xp >= nextLevelXp) {
        userData.level += 1;
        userData.xp = 0;
        message.reply(`🎉 **অভিনন্দন <@${userId}>!** আপনি লেভেল **${userData.level}** এ পৌঁছে গেছেন! 🚀`).then(msg => setTimeout(() => msg.delete().catch(()=>{}), 5000));
        
        if (userData.level >= 5) {
            const activeRole = message.guild.roles.cache.get("YOUR_REWARD_ROLE_ID");
            if (activeRole) await message.member.roles.add(activeRole).catch(()=>{});
        }
    }
    await userRef.set(userData);
}

async function sendWeeklyReport(guild) {
    if (!guild) return;
    const chan = guild.channels.cache.get(ANNOUNCEMENT_CHANNEL_ID);
    if (!chan) return;
    const total = guild.memberCount;
    const embed = new EmbedBuilder()
        .setTitle("📈 WEEKLY SERVER GROWTH REPORT")
        .setDescription(`👥 **সর্বমোট মেম্বার:** \`${total}\`\n🛡️ **সিকিউরিটি স্ট্যাটাস:** \`100% SECURE\``)
        .setColor("Purple")
        .setTimestamp();
    await chan.send({ embeds: [embed] });
}

// ================================
// 🚨 Message Event: Automods
// ================================
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild || message.guild.id !== ALLOWED_GUILD_ID) return;
    
    await handleUserLeveling(message);

    const raidSnapshot = await db.ref("settings/raid_mode").once("value");
    if (raidSnapshot.val() === "on" && !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await message.delete().catch(()=>{});
        return;
    }

    const contentLower = message.content.toLowerCase();
    const responderSnapshot = await db.ref("auto_responder").once("value");
    if (responderSnapshot.exists()) {
        const triggers = responderSnapshot.val();
        for (const trigger in triggers) {
            if (contentLower.includes(trigger.toLowerCase())) {
                return message.reply(triggers[trigger]);
            }
        }
    }

    if (message.member.permissions.has(PermissionFlagsBits.Administrator) || message.member.roles.cache.has(ROLES.ADMIN)) return;

    const uppercaseCount = message.content.replace(/[^A-Z]/g, "").length;
    if (message.content.length > 10 && (uppercaseCount / message.content.length) > 0.7) {
        await message.delete().catch(()=>{});
        return message.channel.send(`⚠️ <@${message.author.id}>, অতিরিক্ত বড় হাতের অক্ষর ব্যবহার করা নিষিদ্ধ!`).then(m => setTimeout(() => m.delete().catch(()=>{}), 5000));
    }

    const linkRegex = /(https?:\/\/[^\s]+)/g;
    if (linkRegex.test(message.content)) {
        await message.delete().catch(() => {});
        return message.channel.send(`⚠️ <@${message.author.id}>, সার্ভারে লিংক শেয়ার করা নিষিদ্ধ!`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
    }

    let triggerAutomod = false; let reason = "";
    if (BAD_WORDS.some(word => contentLower.includes(word))) { triggerAutomod = true; reason = "গালিগালাজ / নিষিদ্ধ শব্দ ব্যবহার"; }
    
    if (!triggerAutomod) {
        const now = Date.now(); if (!userMsgCounter.has(message.author.id)) userMsgCounter.set(message.author.id, []);
        const timestamps = userMsgCounter.get(message.author.id); timestamps.push(now);
        const activeTimestamps = timestamps.filter(time => time > now - 5000);
        userMsgCounter.set(message.author.id, activeTimestamps);
        if (activeTimestamps.length >= 5) { triggerAutomod = true; reason = "অতিরিক্ত স্প্যামিং করা"; }
    }

    if (triggerAutomod) {
        await message.delete().catch(() => {});
        let warns = (userWarns.get(message.author.id) || 0) + 1; userWarns.set(message.author.id, warns);
        if (warns < 3) {
            message.channel.send(`⚠️ <@${message.author.id}>, **${reason}** নিষিদ্ধ! সতর্কতা: **${warns}/৩**`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        } else {
            userWarns.set(message.author.id, 0); savePunishment(message.author.id, "Muted", 10 * 60 * 1000); 
            await message.member.timeout(10 * 60 * 1000, "Automod Limit Exceeded").catch(()=>{});
            message.channel.send({ embeds: [new EmbedBuilder().setColor("Red").setDescription(`<@${message.author.id}> কে ১০ মিনিটের জন্য মিউট করা হয়েছে।`)] });
        }
    }
});

// Ghost Ping Detector
client.on("messageDelete", async (message) => {
    if (!message.guild || message.author?.bot) return;
    if (message.mentions.members.size > 0 || message.mentions.roles.size > 0) {
        const ghostPingEmbed = new EmbedBuilder()
            .setTitle("🛑 Ghost Ping Detected")
            .setColor("Red")
            .setDescription(`**ইউজার:** ${message.author}\n**মেসেজ:** ${message.content || "*শুধু ফাইল/এম্বেড*"}`)
            .setTimestamp();
        const logChan = message.guild.channels.cache.get(LOG_CHANNEL_ID);
        if (logChan) logChan.send({ embeds: [ghostPingEmbed] });
    }
});

// ================================
// 🎮 Interaction Handler (FIXED)
// ================================
client.on("interactionCreate", async (interaction) => {
    if (!interaction.guild || interaction.guild.id !== ALLOWED_GUILD_ID) return;

    // 1️⃣ FIX: Universal Verification Button Handler
    if (interaction.isButton() && interaction.customId === "universal_verify_button") {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const role = interaction.guild.roles.cache.get(VERIFIED_ROLE_ID);
        if (!role) return interaction.editReply("❌ ভেরিফিকেশন রোলটি সার্ভারে খুঁজে পাওয়া যায়নি!");
        
        if (interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
            return interaction.editReply("ℹ️ আপনি ইতিমধ্যে ভেরিফাইড মেম্বার!");
        }
        
        await interaction.member.roles.add(role).catch(() => {});
        return interaction.editReply("✅ আপনি সফলভাবে ভেরিফাই হয়েছেন! সার্ভারে আপনাকে স্বাগতম।");
    }

    // 2️⃣ FIX: Order Channel Staff Button Handlers
    if (interaction.isButton() && interaction.customId === "claim_order") {
        await interaction.deferReply();
        return interaction.editReply(`🛟 এই অর্ডারটি এখন <@${interaction.user.id}> হ্যান্ডেল করছেন।`);
    }

    if (interaction.isButton() && interaction.customId === "approve_order") {
        await interaction.deferReply();
        return interaction.editReply("✅ **অর্ডারটি সফলভাবে অ্যাপ্রুভ (Approve) করা হয়েছে!**");
    }

    if (interaction.isButton() && interaction.customId === "close_order") {
        const ratingRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId(`submit_feedback_order`).setPlaceholder("⭐ আমাদের সার্ভিস রেটিং দিন...").addOptions([
                { label: "⭐⭐⭐⭐⭐ Excellent", value: "5_stars" },
                { label: "⭐⭐⭐⭐ Good", value: "4_stars" },
                { label: "⭐⭐⭐ Average", value: "3_stars" }
            ])
        );
        return interaction.reply({ content: "🔒 **এই অর্ডার চ্যানেলটি বন্ধ করা হচ্ছে।** চ্যানেল ডিলিট হওয়ার আগে অনুগ্রহ করে রেটিং দিন:", components: [ratingRow] });
    }

    // Modal Opening Trigger
    if (interaction.isButton() && interaction.customId.startsWith("submit_txn_")) {
        const category = interaction.customId.split("_")[2];
        const modal = new ModalBuilder().setCustomId(`modal_payment_${category}`).setTitle("🔒 Payment Verification");
        const txnInput = new TextInputBuilder().setCustomId("txn_id_input").setLabel("Enter Transaction ID (TxnID)").setPlaceholder("bKash/Nagad TxnID").setStyle(TextInputStyle.Short).setRequired(true);
        const voucherInput = new TextInputBuilder().setCustomId("voucher_input").setLabel("Discount Code? (Optional)").setStyle(TextInputStyle.Short).setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(txnInput), new ActionRowBuilder().addComponents(voucherInput));
        return interaction.showModal(modal);
    }

    // Modal Submission Handler
    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_payment_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const category = interaction.customId.split("_")[2];
        const txnId = interaction.fields.getTextInputValue("txn_id_input").trim();
        const voucherCode = interaction.fields.getTextInputValue("voucher_input").trim();

        const txnRegex = /^[A-Z0-9]{8,12}$/i;
        if (!txnRegex.test(txnId)) {
            return interaction.editReply("❌ **ভুল Transaction ID ফরম্যাট!**");
        }

        let discountText = "None";
        if (voucherCode) {
            const vRef = db.ref(`vouchers/${voucherCode}`);
            const vSnapshot = await vRef.once("value");
            discountText = vSnapshot.exists() ? `${vSnapshot.val()}% DISCOUNT!` : "Invalid Voucher";
        }

        const randomCode = Math.floor(1000 + Math.random() * 9000); 
        const privateChannel = await interaction.guild.channels.create({
            name: `order-${randomCode}`,
            type: 0,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: ROLES.SUPPORT_CUSTOMER, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
            ]
        });

        const insideEmbed = new EmbedBuilder()
            .setTitle(`🛍️ Paid Order Created`)
            .setDescription(`**কাস্টমার:** ${interaction.user}\n**প্রোডাক্ট:** ${category.toUpperCase()}\n**TxnID:** \`${txnId}\`\n**কুপন:** \`${discountText}\``)
            .setColor("Green");

        const staffButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`claim_order`).setLabel("🛟 Claim Staff").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`approve_order`).setLabel("✅ Approve").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`close_order`).setLabel("🔒 Close & Feedback").setStyle(ButtonStyle.Danger) 
        );

        await privateChannel.send({ content: `${interaction.user}`, embeds: [insideEmbed], components: [staffButtons] });
        return interaction.editReply(`✅ অর্ডার চ্যানেল তৈরি হয়েছে: ${privateChannel}`);
    }

    // Close & Feedback Logic
    if (interaction.isButton() && interaction.customId.startsWith("close_")) {
        const type = interaction.customId.split("_")[1];
        if (type === "order") return; // হ্যান্ডেলড ওপরের সেকশনে
        
        const ratingRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId(`submit_feedback_${type}`).setPlaceholder("⭐ রেটিং দিন...").addOptions([
                { label: "⭐⭐⭐⭐⭐ Excellent", value: "5_stars" },
                { label: "⭐⭐⭐⭐ Good", value: "4_stars" }
            ])
        );
        await interaction.reply({ content: "🔒 চ্যানেলটি বন্ধ করা হচ্ছে...", components: [ratingRow] });
        setTimeout(async () => { await interaction.channel.delete().catch(()=>{}); }, 15000);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("submit_feedback_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const rating = interaction.values[0].replace("_", " ");
        const reviewEmbed = new EmbedBuilder()
            .setTitle("🎫 NEW CUSTOMER REVIEW")
            .setDescription(`**কাস্টমার:** ${interaction.user}\n**রেটিং:** \`${rating.toUpperCase()}\``)
            .setColor("Gold")
            .setTimestamp();
        
        const revChan = interaction.guild.channels.cache.get(REVIEW_CHANNEL_ID);
        if (revChan) await revChan.send({ embeds: [reviewEmbed] });
        return interaction.editReply("❤️ রেটিং দেওয়ার জন্য ধন্যবাদ!");
    }

    if (interaction.isButton() && interaction.customId.startsWith("join_giveaway_")) {
        const giveawayId = interaction.customId.split("_")[2];
        const gRef = db.ref(`giveaways/${giveawayId}/participants`);
        const snapshot = await gRef.once("value");
        let list = snapshot.val() || [];
        if (list.includes(interaction.user.id)) {
            return interaction.reply({ content: "⚠️ আপনি ইতিমধ্যে জয়েন করেছেন!", flags: [MessageFlags.Ephemeral] });
        }
        list.push(interaction.user.id);
        await gRef.set(list);
        return interaction.reply({ content: "🎉 গিভঅ্যাওয়েতে নাম এন্ট্রি হয়েছে!", flags: [MessageFlags.Ephemeral] });
    }

    if (interaction.isStringSelectMenu() && (interaction.customId.startsWith("select_product_") || interaction.customId.startsWith("select_buy_"))) {
        const value = interaction.values[0];
        const payEmbed = new EmbedBuilder().setTitle(`💳 Payment Gateway: ${value.toUpperCase()}`).setDescription(`অর্ডার কনফার্ম করতে নিচে বাটনে চাপ দিয়ে পেমেন্ট আইডি দিন।`).setColor("Blue");
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`submit_txn_${value}`).setLabel("Pay & Submit TxnID").setStyle(ButtonStyle.Primary));
        return interaction.reply({ embeds: [payEmbed], components: [row], flags: [MessageFlags.Ephemeral] });
    }
});

// ================================
// 🎙️ Voice Events
// ================================
client.on("voiceStateUpdate", async (oldState, newState) => {
    const guild = newState.guild;
    if (guild.id !== ALLOWED_GUILD_ID) return;
    await updateServerStats(guild);

    if (newState.channelId === JOIN_TO_CREATE_VC_ID) {
        const member = newState.member;
        const tempChannel = await guild.channels.create({
            name: `🔒 ${member.user.username}'s Room`,
            type: 2, 
            parent: newState.channel.parentId
        });
        await member.voice.setChannel(tempChannel).catch(()=>{});
        temporaryVoiceChannels.set(tempChannel.id, true);
    }

    if (oldState.channelId && temporaryVoiceChannels.has(oldState.channelId)) {
        const ch = guild.channels.cache.get(oldState.channelId);
        if (ch && ch.members.size === 0) {
            await ch.delete().catch(()=>{});
            temporaryVoiceChannels.delete(oldState.channelId);
        }
    }

    if (guild.members.me && !guild.members.me.voice.channel) {
        await connectVoiceAndPlayStream(guild);
    }
});

async function connectVoiceAndPlayStream(guild) {
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
        const resource = createAudioResource("https://stream.zeno.fm/0r0xa792kwzuv"); 
        player.play(resource);
        connection.subscribe(player);
        player.on(AudioPlayerStatus.Idle, () => {
            player.play(createAudioResource("https://stream.zeno.fm/0r0xa792kwzuv"));
        });
    } catch (e) { console.error("❌ Audio Player VC Error:", e); }
}

// ================================
// 🕒 Text Commands Setup
// ================================
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild || message.guild.id !== ALLOWED_GUILD_ID) return;
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);
    
    if (!isAdmin) {
        if (message.content === "!duty on") {
            await db.ref(`staff_duty/${message.author.id}`).set({ status: "ON DUTY", startTime: Date.now() });
            return message.reply("🟢 **আপনি এখন ডিউটিতে আছেন।**");
        }
        if (message.content === "!duty off") {
            await db.ref(`staff_duty/${message.author.id}/status`).set("OFF DUTY");
            return message.reply("🔴 **ডিউটি শেষ!**");
        }
        return;
    }

    if (message.content.startsWith("!giveaway")) {
        const giveawayId = Math.floor(1000 + Math.random() * 9000);
        const gEmbed = new EmbedBuilder().setTitle("🎁 LIVE GIVEAWAY HOSTED!").setDescription("বাটনে ক্লিক করে জয়েন করুন!").setColor("Gold");
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`join_giveaway_${giveawayId}`).setLabel("🎉 Join").setStyle(ButtonStyle.Primary));
        await db.ref(`giveaways/${giveawayId}`).set({ prize: "Premium Package", participants: [] });
        return message.channel.send({ embeds: [gEmbed], components: [row] });
    }

    if (message.content === "!raidmode on") {
        await db.ref("settings/raid_mode").set("on");
        return message.reply("🛑 **Raid Mode Activated!**");
    }
    if (message.content === "!raidmode off") {
        await db.ref("settings/raid_mode").set("off");
        return message.reply("🟢 **Raid Mode Deactivated!**");
    }

    if (message.content === "!setup") {
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("universal_verify_button").setLabel("Verify Me").setStyle(ButtonStyle.Success));
        const embed = new EmbedBuilder().setTitle("🚨 Verification System").setDescription("ভেরিফাই করতে নিচের বাটনে ক্লিক করুন।").setImage(COVER_IMAGES.VERIFY).setColor("Blue");
        return message.channel.send({ embeds: [embed], components: [row] });
    }
});

client.once("ready", async () => {
    console.log(`🚀 ${client.user.tag} active without errors!`);
    client.user.setPresence({ activities: [{ name: "Systems Fixed & Active", type: ActivityType.Competing }], status: "online" });
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (guild) {
        await connectVoiceAndPlayStream(guild);
        await updateServerStats(guild);
    }
    setInterval(() => { if (guild) sendWeeklyReport(guild); }, 1000 * 60 * 60 * 24 * 7);
});

client.login(TOKEN).catch((e) => console.error("❌ Login Failure:", e));
