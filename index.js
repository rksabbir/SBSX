// ================================
// 🚀 PART 1 - Setup, Dependencies & Firebase Config
// ================================
require('dotenv').config();
const express = require("express");
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
    PermissionFlagsBits
} = require("discord.js");

const {
    joinVoiceChannel,
    entersState,
    VoiceConnectionStatus
} = require("@discordjs/voice");

// Firebase Initialization
admin.initializeApp({
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
});
const db = admin.firestore();

// Express Keep Alive
const app = express();
app.get("/", (req, res) => res.send("Bot is running perfectly with Firebase!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Web server running on port ${PORT}`));

// ================================
// ⚙️ Bot Configuration Constants
// ================================
const CONFIG = {
    TOKEN: process.env.TOKEN,
    ALLOWED_GUILD_ID: "1488101970425155584",
    VERIFIED_ROLE_ID: "1488333841402691664",
    VERIFY_CHANNEL_NAME: "verify",
    WELCOME_CHANNEL_NAME: "welcome",
    WELCOME_CHANNEL_ID: "1488339169821593731",
    LOG_CHANNEL_ID: "1488340400673656973",
    VOICE_CHANNEL_ID: "1523230098193383595",
    
    // Roles for Panels
    ROLES: {
        ADMIN: "148832568372973568",
        SUPPORT_TICKET_REPORT: "1488333580705861765",
        SUPPORT_CUSTOMER: "1488335064873046086"
    },
    // Channels for Panels
    CHANNELS: {
        TICKET_PANEL: "1488339982627115118",
        REPORT_PANEL: "1488340441115004999",
        CUSTOMER_PANEL: "1488340017938960484"
    }
};

// Cooldown Map for Anti-Spam
const cooldowns = new Map();

// Discord Client Setup
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

// Anti-Crash Handler
process.on("unhandledRejection", (err) => console.error("[Unhandled Rejection]", err));
process.on("uncaughtException", (err) => console.error("[Uncaught Exception]", err));

// ================================
// 🔊 Voice Auto Join & Presence
// ================================
function setBotPresence() {
    client.user.setPresence({
        activities: [{ name: "Security & Management", type: ActivityType.Watching }],
        status: "online"
    });
}

async function connectVoice(guild) {
    try {
        const channel = guild.channels.cache.get(CONFIG.VOICE_CHANNEL_ID);
        if (!channel) return console.log("Voice channel not found.");

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: true,
            selfMute: false
        });
        await entersState(connection, VoiceConnectionStatus.Ready, 30000);
        console.log("✅ Voice channel connected.");
    } catch (err) {
        console.error("Voice connection error:", err);
    }
}

// ================================
// 📂 Firebase Sync Functions (Replacement for JSON DB)
// ================================
async function addMemberToFirebase(memberId) {
    await db.collection("members").doc(memberId).set({ joined: true });
}

async function removeMemberFromFirebase(memberId) {
    await db.collection("members").doc(memberId).delete();
}

async function getSavedMembersFromFirebase() {
    const snapshot = await db.collection("members").get();
    return snapshot.docs.map(doc => doc.id);
}

// Check Active Panels Count for User (Anti-Spam)
async function hasActivePanelChannel(userId, type) {
    const snapshot = await db.collection("panels")
        .where("ownerId", "==", userId)
        .where("type", "==", type)
        .where("status", "in", ["Open", "Claimed"])
        .get();
    return !snapshot.empty;
}

// ================================
// 🚨 PART 2 - Verification & Welcome System (Preserved)
// ================================
const verificationRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("universal_verify_button").setLabel("Verify Me").setStyle(ButtonStyle.Success)
);

function createVerificationEmbed() {
    return new EmbedBuilder()
        .setTitle("🚨 Verification Required")
        .setDescription("👇 নিচের বাটনে ক্লিক করে ভেরিফাই করুন")
        .setColor("Blue")
        .setImage("https://cdn.discordapp.com/attachments/1488338142607184055/1488761437550678056/5cfd1fe4-d12c-4439-b374-f386f7595184.png")
        .setTimestamp();
}

function createWelcomeEmbed(member) {
    return new EmbedBuilder()
        .setColor("#00AAFF")
        .setTitle("🎉 নতুন সদস্য Join করেছে!")
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setDescription(`✨ স্বাগতম ${member} আমাদের সার্ভারে!\n\n📜 আমাদের নিয়মগুলো মেনে চলার অনুরোধ রইল। ❤️`)
        .addFields(
            { name: "👤 Username", value: member.user.tag, inline: true },
            { name: "🆔 User ID", value: member.user.id, inline: true },
            { name: "⏰ Joined Server", value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
            { name: "👥 Total Members", value: `${member.guild.memberCount}`, inline: true }
        )
        .setTimestamp();
}

// Member Join Event
client.on("guildMemberAdd", async (member) => {
    if (member.guild.id !== CONFIG.ALLOWED_GUILD_ID) return;
    try {
        await addMemberToFirebase(member.id);
        const verifyChannel = member.guild.channels.cache.find(ch => ch.name === CONFIG.VERIFY_CHANNEL_NAME);
        if (verifyChannel) {
            await verifyChannel.send({
                content: `স্বাগতম <@${member.id}>!`,
                embeds: [createVerificationEmbed()],
                components: [verificationRow]
            });
        }
        const welcomeChannel = member.guild.channels.cache.get(CONFIG.WELCOME_CHANNEL_ID);
        if (welcomeChannel) {
            await welcomeChannel.send({ content: `🎉 স্বাগতম ${member}!`, embeds: [createWelcomeEmbed(member)] });
        }
    } catch (err) { console.error(err); }
});

// Member Remove Event
client.on("guildMemberRemove", async (member) => {
    if (member.guild.id !== CONFIG.ALLOWED_GUILD_ID) return;
    await removeMemberFromFirebase(member.id);
});

// ================================
// 🎫 PART 3 - Ticket, Report, & Support UI Builders
// ================================

// Shared Footer Helper
const uiFooter = (embed) => embed.setFooter({ text: "Professional Management System", iconURL: client.user?.displayAvatarURL() }).setTimestamp();

// 1. Ticket UI
function getTicketPanel() {
    const embed = new EmbedBuilder()
        .setTitle("🎫 Premium Support Ticket")
        .setDescription("আমাদের সাপোর্ট টিমের সাথে কথা বলতে বা কোনো সার্ভিস পারচেজ করতে নিচের ড্রপডাউন থেকে প্রোডাক্ট সিলেক্ট করুন।")
        .setColor("#5865F2");
    
    const menu = new StringSelectMenuBuilder()
        .setCustomId("select_product_ticket")
        .setPlaceholder("🛒 একটি প্রোডাক্ট/সার্ভিস সিলেক্ট করুন...")
        .addOptions([
            { label: "Discord Bot Development", description: "কাস্টম বট তৈরি বা বাগ ফিক্সিং", value: "bot_dev" },
            { label: "Server Design & Setup", description: "প্রফেশনাল সার্ভার সেটআপ", value: "server_design" },
            { label: "Graphics & UI Design", description: "ব্যানার, লোগো বা ইউআই ডিজাইন", value: "graphics_design" }
        ]);
    return { embeds: [uiFooter(embed)], components: [new ActionRowBuilder().addComponents(menu)] };
}

// 2. Report Center UI
function getReportPanel() {
    const embed = new EmbedBuilder()
        .setTitle("🚨 Report Center")
        .setDescription("সার্ভারের কোনো মেম্বার, স্টাফ কিংবা কোনো বাগ বা স্ক্যাম রিপোর্ট করতে নিচের মেনু ব্যবহার করুন।")
        .setColor("#ED4245");

    const menu = new StringSelectMenuBuilder()
        .setCustomId("select_report_category")
        .setPlaceholder("⚠️ রিপোর্টের ক্যাটাগরি সিলেক্ট করুন...")
        .addOptions([
            { label: "Member Report", value: "member_report" },
            { label: "Staff Report", value: "staff_report" },
            { label: "Scam Report", value: "scam_report" },
            { label: "Bug Report", value: "bug_report" },
            { label: "Abuse Report", value: "abuse_report" },
            { label: "Other Report", value: "other_report" }
        ]);
    return { embeds: [uiFooter(embed)], components: [new ActionRowBuilder().addComponents(menu)] };
}

// 3. Customer Support UI
function getCustomerPanel() {
    const embed = new EmbedBuilder()
        .setTitle("💬 𝗖𝗨𝗦𝗧𝗢𝗠𝗘𝗥-𝗦𝗨𝗣𝗣𝗢𝗥𝗧")
        .setDescription("আপনার পেমেন্ট, অর্ডার সংক্রান্ত জটিলতা বা যেকোনো সাধারণ সাহায্যের জন্য ক্যাটাগরি সিলেক্ট করুন।")
        .setColor("#57F287");

    const menu = new StringSelectMenuBuilder()
        .setCustomId("select_customer_category")
        .setPlaceholder("❓ হেল্প ক্যাটাগরি সিলেক্ট করুন...")
        .addOptions([
            { label: "General Support", value: "general_support" },
            { label: "Payment Help", value: "payment_help" },
            { label: "Order Help", value: "order_help" },
            { label: "Account Help", value: "account_help" },
            { label: "Partnership", value: "partnership" },
            { label: "Other Help", value: "other_help" }
        ]);
    return { embeds: [uiFooter(embed)], components: [new ActionRowBuilder().addComponents(menu)] };
}

// Control Action Row inside individual channels
function getChannelControlRow(type) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`claim_${type}`).setLabel("🛟 Claim Staff").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`close_${type}`).setLabel("🔒 Close").setStyle(ButtonStyle.Danger)
    );
}

// ================================
// ⚡ PART 4 - Interaction Handling & Core System Logic
// ================================
client.on("interactionCreate", async (interaction) => {
    if (!interaction.guild || interaction.guild.id !== CONFIG.ALLOWED_GUILD_ID) return;

    // --- Anti-Spam Rate Limit ---
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
        const cooldownKey = `${interaction.user.id}-${interaction.customId}`;
        if (cooldowns.has(cooldownKey)) {
            return interaction.reply({ content: "⚠️ আপনি খুব দ্রুত ক্লিক করছেন! অনুগ্রহ করে একটু অপেক্ষা করুন।", ephemeral: true });
        }
        cooldowns.set(cooldownKey, true);
        setTimeout(() => cooldowns.delete(cooldownKey), 3000); // 3 Second Cooldown
    }

    // --- 🟢 Verification Button ---
    if (interaction.isButton() && interaction.customId === "universal_verify_button") {
        await interaction.deferReply({ ephemeral: true });
        const role = interaction.guild.roles.cache.get(CONFIG.VERIFIED_ROLE_ID);
        if (!role) return interaction.editReply("❌ Verification role পাওয়া যায়নি।");
        if (interaction.member.roles.cache.has(CONFIG.VERIFIED_ROLE_ID)) {
            return interaction.editReply("⚠️ আপনি ইতোমধ্যে ভেরিফাই হয়েছেন।");
        }
        await interaction.member.roles.add(role);
        await interaction.editReply("✅ সফলভাবে ভেরিফাই সম্পন্ন হয়েছে!");
        
        const welcomeChannel = interaction.guild.channels.cache.find(ch => ch.name === CONFIG.WELCOME_CHANNEL_NAME);
        if (welcomeChannel) welcomeChannel.send(`🎉 Welcome ${interaction.user}!`).catch(() => {});
        return;
    }

    // --- 🔵 Dropdown Selection Handlers (Ephemeral UI Response) ---
    if (interaction.isStringSelectMenu()) {
        const value = interaction.values[0];
        let type = "";
        let embedColor = "";
        let buttonId = "";

        if (interaction.customId === "select_product_ticket") { type = "ticket"; embedColor = "#5865F2"; buttonId = `create_ticket_${value}`; }
        else if (interaction.customId === "select_report_category") { type = "report"; embedColor = "#ED4245"; buttonId = `create_report_${value}`; }
        else if (interaction.customId === "select_customer_category") { type = "customer"; embedColor = "#57F287"; buttonId = `create_customer_${value}`; }

        if (type) {
            const hasActive = await hasActivePanelChannel(interaction.user.id, type);
            if (hasActive) {
                return interaction.reply({ content: `⚠️ আপনার ইতিমধ্যে একটি ওপেন ${type} চ্যানেল রয়েছে। সেটি বন্ধ না করা পর্যন্ত নতুন চ্যানেল তৈরি করতে পারবেন না।`, ephemeral: true });
            }

            const ephemeralEmbed = new EmbedBuilder()
                .setTitle(`📌 Selected Category: ${value.toUpperCase().replace("_", " ")}`)
                .setDescription(`আপনার নির্বাচনটি সফল হয়েছে। চ্যানেল তৈরি করতে নিচের বাটনে চাপ দিন।`)
                .setColor(embedColor);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(buttonId).setLabel(`Create ${type.toUpperCase()}`).setStyle(ButtonStyle.Success)
            );
            return interaction.reply({ embeds: [ephemeralEmbed], components: [row], ephemeral: true });
        }
    }

    // --- 🟣 Channel Creation Handlers ---
    if (interaction.isButton() && interaction.customId.startsWith("create_")) {
        await interaction.deferReply({ ephemeral: true });
        const dataArr = interaction.customId.split("_"); // ex: ['create', 'ticket', 'bot', 'dev']
        const type = dataArr[1];
        const category = dataArr.slice(2).join("_");

        const hasActive = await hasActivePanelChannel(interaction.user.id, type);
        if (hasActive) return interaction.editReply(`⚠️ ডুপ্লিকেট রিকোয়েস্ট ব্লকেড! আপনার অলরেডি একটি অ্যাক্টিভ ${type} চ্যানেল আছে।`);

        let supportRole = CONFIG.ROLES.SUPPORT_TICKET_REPORT;
        let channelPrefix = "";

        if (type === "ticket") { channelPrefix = `ticket-${interaction.user.username}`; }
        else if (type === "report") { channelPrefix = `report-${interaction.user.username}`; }
        else if (type === "customer") { channelPrefix = `support-${interaction.user.username}`; supportRole = CONFIG.ROLES.SUPPORT_CUSTOMER; }

        // Generate ID
        const panelId = `${type}-${Date.now()}`;

        // Permissions Array
        const permissionOverwrites = [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.ManageChannels] },
            { id: supportRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: CONFIG.ROLES.ADMIN, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
        ];

        const privateChannel = await interaction.guild.channels.create({
            name: channelPrefix,
            type: 0, // GuildText
            permissionOverwrites: permissionOverwrites
        });

        // Save metadata to Firebase
        await db.collection("panels").doc(privateChannel.id).set({
            panelId: panelId,
            channelId: privateChannel.id,
            ownerId: interaction.user.id,
            type: type,
            category: category,
            claimedStaff: null,
            status: "Open",
            createdTime: admin.firestore.FieldValue.serverTimestamp()
        });

        // Send Control Panel Into Inside Channel
        const insideEmbed = new EmbedBuilder()
            .setTitle(`Welcome to your ${type.toUpperCase()}`)
            .setDescription(`স্বাগতম ${interaction.user}! আমাদের সাপোর্ট টিম খুব শীঘ্রই আপনার সাথে যোগাযোগ করবে।\n\n**ক্যাটাগরি:** ${category.toUpperCase().replace("_", " ")}`)
            .setColor("Random");

        await privateChannel.send({
            content: `${interaction.user} | <@&${supportRole}>`,
            embeds: [uiFooter(insideEmbed)],
            components: [getChannelControlRow(type)]
        });

        return interaction.editReply(`✅ সফলভাবে তৈরি হয়েছে! প্রবেশ করুন এখানে: ${privateChannel}`);
    }

    // --- 🛟 Claim Button Logic ---
    if (interaction.isButton() && interaction.customId.startsWith("claim_")) {
        const type = interaction.customId.split("_")[1];
        let reqRole = (type === "customer") ? CONFIG.ROLES.SUPPORT_CUSTOMER : CONFIG.ROLES.SUPPORT_TICKET_REPORT;

        if (!interaction.member.roles.cache.has(reqRole) && !interaction.member.roles.cache.has(CONFIG.ROLES.ADMIN)) {
            return interaction.reply({ content: "❌ এটি ক্লেইম করার পারমিশন আপনার নেই!", ephemeral: true });
        }

        const docRef = db.collection("panels").doc(interaction.channelId);
        const doc = await docRef.get();
        if (!doc.exists) return interaction.reply({ content: "কোথাও একটা ভুল হয়েছে! তথ্য পাওয়া যায়নি।", ephemeral: true });

        if (doc.data().claimedStaff) {
            return interaction.reply({ content: `⚠️ এটি ইতিমধ্যে <@${doc.data().claimedStaff}> ক্লেইম করেছেন।`, ephemeral: true });
        }

        await docRef.update({ claimedStaff: interaction.user.id, status: "Claimed" });
        await interaction.reply({ content: `🛟 এই চ্যানেলটি এখন থেকে স্টাফ ${interaction.user} হ্যান্ডেল করছেন।` });
        return;
    }

    // --- 🔒 Close Button Logic ---
    if (interaction.isButton() && interaction.customId.startsWith("close_")) {
        const type = interaction.customId.split("_")[1];
        const docRef = db.collection("panels").doc(interaction.channelId);
        const doc = await docRef.get();
        if (!doc.exists) return interaction.reply({ content: "ডাটাবেজে কোনো রেকর্ড পাওয়া যায়নি। চ্যানেলটি ডিলিট করে দিন।", ephemeral: true });

        const data = doc.data();
        let reqRole = (type === "customer") ? CONFIG.ROLES.SUPPORT_CUSTOMER : CONFIG.ROLES.SUPPORT_TICKET_REPORT;

        // Validation (Owner or Staff can close)
        if (interaction.user.id !== data.ownerId && !interaction.member.roles.cache.has(reqRole) && !interaction.member.roles.cache.has(CONFIG.ROLES.ADMIN)) {
            return interaction.reply({ content: "❌ আপনি এই চ্যানেলটি বন্ধ করতে পারবেন না।", ephemeral: true });
        }

        await interaction.reply("🔒 চ্যানেলটি বন্ধ করা হচ্ছে এবং ট্রান্সক্রিপ্ট নেওয়া হচ্ছে... ৫ সেকেন্ডের মধ্যে চ্যানেল ডিলিট হবে।");

        // Simple Transcript Collector Logic
        let transcriptText = `--- Transcript for ${data.panelId} ---\n`;
        const fetchedMessages = await interaction.channel.messages.fetch({ limit: 100 });
        fetchedMessages.reverse().forEach(m => {
            transcriptText += `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}\n`;
        });

        // Log to Transcript Channel
        const logChannel = interaction.guild.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle(`📑 Channel Closed: ${data.panelId}`)
                .addFields(
                    { name: "Owner", value: `<@${data.ownerId}>`, inline: true },
                    { name: "Type", value: data.type.toUpperCase(), inline: true },
                    { name: "Category", value: data.category, inline: true },
                    { name: "Closed By", value: `${interaction.user.tag}`, inline: true }
                )
                .setColor("Orange");

            // Attach transcript text as file buffer
            await logChannel.send({
                embeds: [logEmbed],
                files: [{ attachment: Buffer.from(transcriptText, "utf-8"), name: `transcript-${data.panelId}.txt` }]
            });
        }

        // Final Update and Delete
        await docRef.update({ status: "Closed", closeTime: admin.firestore.FieldValue.serverTimestamp() });
        setTimeout(async () => {
            await interaction.channel.delete().catch(() => {});
        }, 5000);
    }
});

// ================================
// 🛠️ PART 5 - Prefix Setup Commands & Sync Recovery
// ================================
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild || message.guild.id !== CONFIG.ALLOWED_GUILD_ID) return;

    // !setup Command (For Verification Panel)
    if (message.content === "!setup") {
        if (!message.member.roles.cache.has(CONFIG.ROLES.ADMIN)) return;
        return message.channel.send({ embeds: [createVerificationEmbed()], components: [verificationRow] });
    }

    // !ticket panel command
    if (message.content === "!ticket") {
        if (!message.member.roles.cache.has(CONFIG.ROLES.ADMIN)) return;
        return message.channel.send(getTicketPanel());
    }

    // !report panel command
    if (message.content === "!report") {
        if (!message.member.roles.cache.has(CONFIG.ROLES.ADMIN)) return;
        return message.channel.send(getReportPanel());
    }

    // !customer panel command
    if (message.content === "!customer") {
        if (!message.member.roles.cache.has(CONFIG.ROLES.ADMIN)) return;
        return message.channel.send(getCustomerPanel());
    }
});

// Voice Auto Reconnect Interceptor
client.on("voiceStateUpdate", async () => {
    const guild = client.guilds.cache.get(CONFIG.ALLOWED_GUILD_ID);
    if (!guild || !guild.members.me) return;
    if (!guild.members.me.voice.channel) {
        console.log("🔄 Reconnecting to Voice Channel...");
        await connectVoice(guild);
    }
});

// Ready Event & Offline Recovery System
client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    setBotPresence();

    const guild = client.guilds.cache.get(CONFIG.ALLOWED_GUILD_ID);
    if (!guild) return console.log("⚠️ Guild not found!");

    await connectVoice(guild);
    const welcomeChannel = guild.channels.cache.get(CONFIG.WELCOME_CHANNEL_ID);

    // Offline Member Join Recovery Engine
    try {
        console.log("🔍 Firebase & Offline Sync checking initiated...");
        const currentMembers = await guild.members.fetch();
        const savedMembers = await getSavedMembersFromFirebase();

        if (savedMembers.length > 0 && welcomeChannel) {
            const missedMembers = currentMembers.filter(member => !savedMembers.includes(member.id) && !member.user.bot);
            if (missedMembers.size > 0) {
                console.log(`📡 Found ${missedMembers.size} missed members.`);
                for (const [, member] of missedMembers) {
                    await welcomeChannel.send({
                        content: `🎉 স্বাগতম ${member}\n\n🤖 বট অফলাইনে থাকার সময় আপনি সার্ভারে Join করেছিলেন।`,
                        embeds: [createWelcomeEmbed(member)]
                    }).catch(() => {});
                }
            }
        }

        // Batch Save Current Server State to Firebase
        for (const [id, member] of currentMembers) {
            if (!member.user.bot) await addMemberToFirebase(id);
        }
        console.log("✅ Firebase Database synced successfully.");
    } catch (err) {
        console.error("Recovery Error:", err);
    }
});

// Auto Login with Retries
function startBot() {
    client.login(CONFIG.TOKEN).catch(err => {
        console.error("❌ Login Failed! Retrying in 5 seconds...", err);
        setTimeout(startBot, 5000);
    });
}
startBot();
