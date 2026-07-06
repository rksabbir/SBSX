// ================================
// 🚀 PART 1 - Setup, Dependencies & Firebase Config
// ================================
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

// Render Environment Variables থেকে ডেটা রিড করা
const TOKEN = process.env.TOKEN;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;

// Base64 এনকোডেড প্রাইভেট কি ডিকোড করার মেকানিজম (Render-এর জন্য সবচেয়ে নিরাপদ)
let decryptedPrivateKey;
if (process.env.FIREBASE_PRIVATE_KEY_B64) {
    decryptedPrivateKey = Buffer.from(process.env.FIREBASE_PRIVATE_KEY_B64, 'base64').toString('utf8');
} else {
    console.error("❌ Render Environment-এ FIREBASE_PRIVATE_KEY_B64 পাওয়া যায়নি!");
    process.exit(1);
}

// Firebase Initialization
admin.initializeApp({
    credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: decryptedPrivateKey.replace(/\\n/g, '\n')
    })
});
const db = admin.firestore();

// Express Keep Alive (Render-এর জন্য বাধ্যতামূলক)
const app = express();
app.get("/", (req, res) => res.send("Bot is running perfectly on Render!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Web server running on port ${PORT}`));

// ================================
// ⚙️ Bot Configuration Constants
// ================================
const CONFIG = {
    ALLOWED_GUILD_ID: "1488101970425155584",
    VERIFIED_ROLE_ID: "1488333841402691664",
    VERIFY_CHANNEL_NAME: "verify",
    WELCOME_CHANNEL_NAME: "welcome",
    WELCOME_CHANNEL_ID: "1488339169821593731",
    LOG_CHANNEL_ID: "1488340400673656973",
    VOICE_CHANNEL_ID: "1523230098193383595",
    
    ROLES: {
        ADMIN: "148832568372973568",
        SUPPORT_TICKET_REPORT: "1488333580705861765",
        SUPPORT_CUSTOMER: "1488335064873046086"
    }
};

const cooldowns = new Map();

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
// 📂 Firebase Sync Functions
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

async function hasActivePanelChannel(userId, type) {
    const snapshot = await db.collection("panels")
        .where("ownerId", "==", userId)
        .where("type", "==", type)
        .where("status", "in", ["Open", "Claimed"])
        .get();
    return !snapshot.empty;
}

// ================================
// 🚨 PART 2 - Verification & Welcome System
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

client.on("guildMemberRemove", async (member) => {
    if (member.guild.id !== CONFIG.ALLOWED_GUILD_ID) return;
    await removeMemberFromFirebase(member.id);
});

// ================================
// 🎫 PART 3 - Ticket, Report, & Support UI Builders
// ================================
const uiFooter = (embed) => embed.setFooter({ text: "Professional Management System", iconURL: client.user?.displayAvatarURL() }).setTimestamp();

function getTicketPanel() {
    const embed = new EmbedBuilder()
        .setTitle("🎫 Premium Support Ticket")
        .setDescription("আমাদের সাপোর্ট টিমের সাথে কথা বলতে বা কোনো সার্ভিস পারচেজ করতে নিচের ড্রপডাউন থেকে প্রোডাক্ট সিলেক্ট করুন।")
        .setColor("#5865F2");
    
    const menu = new StringSelectMenuBuilder()
        .setCustomId("select_product_ticket")
        .setPlaceholder("🛒 একটি প্রোডাক্ট/সার্ভিস সিলেক্ট করুন...")
        .addOptions([
            { label: "Discord Bot Development", value: "bot_dev" },
            { label: "Server Design & Setup", value: "server_design" },
            { label: "Graphics & UI Design", value: "graphics_design" }
        ]);
    return { embeds: [uiFooter(embed)], components: [new ActionRowBuilder().addComponents(menu)] };
}

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

    if (interaction.isButton() || interaction.isStringSelectMenu()) {
        const cooldownKey = `${interaction.user.id}-${interaction.customId}`;
        if (cooldowns.has(cooldownKey)) {
            return interaction.reply({ content: "⚠️ আপনি খুব দ্রুত ক্লিক করছেন! অনুগ্রহ করে একটু অপেক্ষা করুন।", ephemeral: true });
        }
        cooldowns.set(cooldownKey, true);
        setTimeout(() => cooldowns.delete(cooldownKey), 3000);
    }

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
                return interaction.reply({ content: `⚠️ আপনার ইতিমধ্যে একটি ওপেন ${type} চ্যানেল রয়েছে।`, ephemeral: true });
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

    if (interaction.isButton() && interaction.customId.startsWith("create_")) {
        await interaction.deferReply({ ephemeral: true });
        const dataArr = interaction.customId.split("_");
        const type = dataArr[1];
        const category = dataArr.slice(2).join("_");

        const hasActive = await hasActivePanelChannel(interaction.user.id, type);
        if (hasActive) return interaction.editReply(`⚠️ আপনার অলরেডি একটি অ্যাক্টিভ ${type} চ্যানেল আছে।`);

        let supportRole = CONFIG.ROLES.SUPPORT_TICKET_REPORT;
        let channelPrefix = "";

        if (type === "ticket") channelPrefix = `ticket-${interaction.user.username}`;
        else if (type === "report") channelPrefix = `report-${interaction.user.username}`;
        else if (type === "customer") { channelPrefix = `support-${interaction.user.username}`; supportRole = CONFIG.ROLES.SUPPORT_CUSTOMER; }

        const panelId = `${type}-${Date.now()}`;

        const permissionOverwrites = [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.ManageChannels] },
            { id: supportRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: CONFIG.ROLES.ADMIN, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
        ];

        const privateChannel = await interaction.guild.channels.create({
            name: channelPrefix,
            type: 0,
            permissionOverwrites: permissionOverwrites
        });

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

    if (interaction.isButton() && interaction.customId.startsWith("claim_")) {
        const type = interaction.customId.split("_")[1];
        let reqRole = (type === "customer") ? CONFIG.ROLES.SUPPORT_CUSTOMER : CONFIG.ROLES.SUPPORT_TICKET_REPORT;

        if (!interaction.member.roles.cache.has(reqRole) && !interaction.member.roles.cache.has(CONFIG.ROLES.ADMIN)) {
            return interaction.reply({ content: "❌ এটি ক্লেইম করার পারমিশন আপনার নেই!", ephemeral: true });
        }

        const docRef = db.collection("panels").doc(interaction.channelId);
        const doc = await docRef.get();
        if (!doc.exists) return interaction.reply({ content: "তথ্য পাওয়া যায়নি।", ephemeral: true });

        if (doc.data().claimedStaff) {
            return interaction.reply({ content: `⚠️ এটি ইতিমধ্যে <@${doc.data().claimedStaff}> ক্লেইম করেছেন।`, ephemeral: true });
        }

        await docRef.update({ claimedStaff: interaction.user.id, status: "Claimed" });
        await interaction.reply({ content: `🛟 এই চ্যানেলটি এখন থেকে স্টাফ ${interaction.user} হ্যান্ডেল করছেন।` });
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("close_")) {
        const type = interaction.customId.split("_")[1];
        const docRef = db.collection("panels").doc(interaction.channelId);
        const doc = await docRef.get();
        if (!doc.exists) return interaction.reply({ content: "ডাটাবেজে কোনো রেকর্ড পাওয়া যায়নি।", ephemeral: true });

        const data = doc.data();
        let reqRole = (type === "customer") ? CONFIG.ROLES.SUPPORT_CUSTOMER : CONFIG.ROLES.SUPPORT_TICKET_REPORT;

        if (interaction.user.id !== data.ownerId && !interaction.member.roles.cache.has(reqRole) && !interaction.member.roles.cache.has(CONFIG.ROLES.ADMIN)) {
            return interaction.reply({ content: "❌ আপনি এই চ্যানেলটি বন্ধ করতে পারবেন না।", ephemeral: true });
        }

        await interaction.reply("🔒 চ্যানেলটি বন্ধ করা হচ্ছে এবং ট্রান্সক্রিপ্ট নেওয়া হচ্ছে... ৫ সেকেন্ডের মধ্যে চ্যানেল ডিলিট হবে।");

        let transcriptText = `--- Transcript for ${data.panelId} ---\n`;
        const fetchedMessages = await interaction.channel.messages.fetch({ limit: 100 });
        fetchedMessages.reverse().forEach(m => {
            transcriptText += `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}\n`;
        });

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

            await logChannel.send({
                embeds: [logEmbed],
                files: [{ attachment: Buffer.from(transcriptText, "utf-8"), name: `transcript-${data.panelId}.txt` }]
            });
        }

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

    if (message.content === "!setup") {
        if (!message.member.roles.cache.has(CONFIG.ROLES.ADMIN)) return;
        return message.channel.send({ embeds: [createVerificationEmbed()], components: [verificationRow] });
    }
    if (message.content === "!ticket") {
        if (!message.member.roles.cache.has(CONFIG.ROLES.ADMIN)) return;
        return message.channel.send(getTicketPanel());
    }
    if (message.content === "!report") {
        if (!message.member.roles.cache.has(CONFIG.ROLES.ADMIN)) return;
        return message.channel.send(getReportPanel());
    }
    if (message.content === "!customer") {
        if (!message.member.roles.cache.has(CONFIG.ROLES.ADMIN)) return;
        return message.channel.send(getCustomerPanel());
    }
});

client.on("voiceStateUpdate", async () => {
    const guild = client.guilds.cache.get(CONFIG.ALLOWED_GUILD_ID);
    if (!guild || !guild.members.me) return;
    if (!guild.members.me.voice.channel) {
        await connectVoice(guild);
    }
});

client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    setBotPresence();

    const guild = client.guilds.cache.get(CONFIG.ALLOWED_GUILD_ID);
    if (!guild) return console.log("⚠️ Guild not found!");

    await connectVoice(guild);
    const welcomeChannel = guild.channels.cache.get(CONFIG.WELCOME_CHANNEL_ID);

    try {
        console.log("🔍 Firebase & Offline Sync checking initiated...");
        const currentMembers = await guild.members.fetch();
        const savedMembers = await getSavedMembersFromFirebase();

        if (savedMembers.length > 0 && welcomeChannel) {
            const missedMembers = currentMembers.filter(member => !savedMembers.includes(member.id) && !member.user.bot);
            if (missedMembers.size > 0) {
                for (const [, member] of missedMembers) {
                    await welcomeChannel.send({
                        content: `🎉 স্বাগতম ${member}\n\n🤖 বট অফলাইনে থাকার সময় আপনি সার্ভারে Join করেছিলেন।`,
                        embeds: [createWelcomeEmbed(member)]
                    }).catch(() => {});
                }
            }
        }

        for (const [id, member] of currentMembers) {
            if (!member.user.bot) await addMemberToFirebase(id);
        }
        console.log("✅ Firebase Database synced successfully.");
    } catch (err) {
        console.error("Recovery Error:", err);
    }
});

function startBot() {
    client.login(TOKEN).catch(err => {
        console.error("❌ Login Failed! Retrying in 5 seconds...", err);
        setTimeout(startBot, 5000);
    });
}
startBot();
