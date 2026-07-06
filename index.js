// ================================
// 🚀 PART 1 - Setup + Express + Config + Voice Setup
// ================================

const express = require("express");
const fs = require("fs");

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
    MessageFlags
} = require("discord.js");

const {
    joinVoiceChannel,
    entersState,
    VoiceConnectionStatus
} = require("@discordjs/voice");

// ================================
// 🌐 Express Keep Alive
// ================================

const app = express();

app.get("/", (req, res) => {
    res.send("Bot is running!");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
});

// ================================
// ⚙️ Bot Config
// ================================

const TOKEN = process.env.TOKEN;

// Guild
const ALLOWED_GUILD_ID = "1488101970425155584";

// Verification
const VERIFIED_ROLE_ID = "1488333841402691664";

// Channels
const VERIFY_CHANNEL_NAME = "verify";
const WELCOME_CHANNEL_NAME = "welcome";

const WELCOME_CHANNEL_ID = "1488339169821593731";
const LOG_CHANNEL_ID = "1488340400673656973";

// Voice Channel
const VOICE_CHANNEL_ID = "1523230098193383595";

// 👑 Roles Configuration (এখানে অ্যাডমিন ও সাপোর্ট রোলের আইডিগুলো দেওয়া হয়েছে)
const ROLES = {
    ADMIN: "148832568372973568", // অ্যাডমিন রোল আইডি
    SUPPORT_TICKET_REPORT: "1488333580705861765", // টিকিট ও রিপোর্ট সাপোর্ট রোল
    SUPPORT_CUSTOMER: "1488335064873046086" // কাস্টমার সাপোর্ট রোল
};

// Target Setup Panels Channels
const CHANNELS = {
    TICKET_PANEL: "1488339982627115118",
    REPORT_PANEL: "1488340441115004999",
    CUSTOMER_PANEL: "1488340017938960484"
};

// Database
const DATA_FILE = "./database.json";
const cooldowns = new Map();

// ================================
// 🤖 Discord Client
// ================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [
        Partials.Channel,
        Partials.GuildMember
    ]
});

// ================================
// 🛡️ Anti Crash
// ================================

process.on("unhandledRejection", (err) => {
    console.error("[Unhandled Rejection]", err);
});

process.on("uncaughtException", (err) => {
    console.error("[Uncaught Exception]", err);
});

// ================================
// 🎮 Presence
// ================================

function setBotPresence() {
    client.user.setPresence({
        activities: [
            {
                name: "Security & Verification",
                type: ActivityType.Watching
            }
        ],
        status: "online"
    });
}

// ================================
// 🔊 Voice Auto Join
// ================================

async function connectVoice(guild) {
    try {
        const channel = guild.channels.cache.get(VOICE_CHANNEL_ID);
        if (!channel) {
            console.log("Voice channel not found.");
            return;
        }

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
// 🚨 PART 2 - Verification System
// ================================

// Verification Button
const verificationRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
        .setCustomId("universal_verify_button")
        .setLabel("Verify Me")
        .setStyle(ButtonStyle.Success)
);

// Verification Embed
function createVerificationEmbed() {
    return new EmbedBuilder()
        .setTitle("🚨 Verification Required")
        .setDescription("👇 নিচের বাটনে ক্লিক করে ভেরিফাই করুন")
        .setColor("Blue")
        .setImage("https://cdn.discordapp.com/attachments/1488338142607184055/1488761437550678056/5cfd1fe4-d12c-4439-b374-f386f7595184.png")
        .setTimestamp();
}

// Send Verification Panel When Member Joins
client.on("guildMemberAdd", async (member) => {
    if (member.guild.id !== ALLOWED_GUILD_ID) return;
    try {
        const verifyChannel = member.guild.channels.cache.find(ch => ch.name === VERIFY_CHANNEL_NAME);
        if (!verifyChannel) return;

        await verifyChannel.send({
            content: `স্বাগতম <@${member.id}>!`,
            embeds: [createVerificationEmbed()],
            components: [verificationRow]
        });
    } catch (err) {
        console.error(err);
    }
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
// ⚡ PART 4 - Interaction Handling (Buttons & Menus)
// ================================

client.on("interactionCreate", async (interaction) => {
    if (!interaction.guild || interaction.guild.id !== ALLOWED_GUILD_ID) return;

    // Cooldown Logic
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
        const cooldownKey = `${interaction.user.id}-${interaction.customId}`;
        if (cooldowns.has(cooldownKey)) {
            return interaction.reply({ content: "⚠️ আপনি খুব দ্রুত ক্লিক করছেন! অনুগ্রহ করে একটু অপেক্ষা করুন।", flags: [MessageFlags.Ephemeral] });
        }
        cooldowns.set(cooldownKey, true);
        setTimeout(() => cooldowns.delete(cooldownKey), 3000);
    }

    // Verification Button Click
    if (interaction.isButton() && interaction.customId === "universal_verify_button") {
        try {
            await interaction.deferReply({ ephemeral: true });
            const role = interaction.guild.roles.cache.get(VERIFIED_ROLE_ID);
            if (!role) return interaction.editReply("❌ Role not found!");

            if (interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
                return interaction.editReply("⚠️ আপনি ইতোমধ্যে ভেরিফাই হয়েছেন।");
            }

            await interaction.member.roles.add(role);
            await interaction.editReply("✅ সফলভাবে ভেরিফাই সম্পন্ন হয়েছে!");

            const welcomeChannel = interaction.guild.channels.cache.find(ch => ch.name === WELCOME_CHANNEL_NAME);
            if (welcomeChannel) {
                welcomeChannel.send(`🎉 Welcome ${interaction.user}!`).catch(() => {});
            }
        } catch (err) {
            console.error(err);
            if (interaction.deferred) {
                interaction.editReply("❌ Error! Bot Permission চেক করুন।").catch(() => {});
            }
        }
        return;
    }

    // Dropdown Select Menu Handling
    if (interaction.isStringSelectMenu()) {
        const value = interaction.values[0];
        let type = "";
        let embedColor = "";
        let buttonId = "";

        if (interaction.customId === "select_product_ticket") { type = "ticket"; embedColor = "#5865F2"; buttonId = `create_ticket_${value}`; }
        else if (interaction.customId === "select_report_category") { type = "report"; embedColor = "#ED4245"; buttonId = `create_report_${value}`; }
        else if (interaction.customId === "select_customer_category") { type = "customer"; embedColor = "#57F287"; buttonId = `create_customer_${value}`; }

        if (type) {
            const ephemeralEmbed = new EmbedBuilder()
                .setTitle(`📌 Selected Category: ${value.toUpperCase().replace("_", " ")}`)
                .setDescription(`আপনার নির্বাচনটি সফল হয়েছে। চ্যানেল তৈরি করতে নিচের বাটনে চাপ দিন।`)
                .setColor(embedColor);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(buttonId).setLabel(`Create ${type.toUpperCase()}`).setStyle(ButtonStyle.Success)
            );
            return interaction.reply({ embeds: [ephemeralEmbed], components: [row], flags: [MessageFlags.Ephemeral] });
        }
    }

    // Create Channel Button Handling (🛡️ পারমিশন ফিক্স করা হয়েছে যেন অ্যাডমিনরা দেখতে পান)
    if (interaction.isButton() && interaction.customId.startsWith("create_")) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const dataArr = interaction.customId.split("_");
        const type = dataArr[1];
        const category = dataArr.slice(2).join("_");

        let supportRoleId = (type === "customer") ? ROLES.SUPPORT_CUSTOMER : ROLES.SUPPORT_TICKET_REPORT;
        let channelPrefix = `${type}-${interaction.user.username}`;

        // 🛡️ পারমিশন ফিল্টার: সাধারণ মেম্বারদের থেকে টিকিট সম্পূর্ণ বন্ধ ও হাইড থাকবে
        const permissionOverwrites = [
            { 
                id: interaction.guild.id, 
                deny: [PermissionFlagsBits.ViewChannel] 
            },
            { 
                id: VERIFIED_ROLE_ID, 
                deny: [PermissionFlagsBits.ViewChannel] 
            }, 
            // টিকিট ওনার দেখতে ও লিখতে পারবে
            { 
                id: interaction.user.id, 
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory], 
                deny: [PermissionFlagsBits.ManageChannels] 
            }
        ];

        // 🎯 নির্দিষ্ট সাপোর্ট রোল থাকলে তাকে পারমিশন দেওয়া হবে
        if (interaction.guild.roles.cache.has(supportRoleId)) {
            permissionOverwrites.push({ 
                id: supportRoleId, 
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] 
            });
        }
        
        // 🎯 অ্যাডমিন রোলকে এখানে এক্সপ্লিসিটলি (Explicitly) দেখার ও লেখার ফুল অনুমতি দেওয়া হলো
        if (interaction.guild.roles.cache.has(ROLES.ADMIN)) {
            permissionOverwrites.push({ 
                id: ROLES.ADMIN, 
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] 
            });
        }

        const privateChannel = await interaction.guild.channels.create({
            name: channelPrefix,
            type: 0,
            permissionOverwrites: permissionOverwrites
        });

        const insideEmbed = new EmbedBuilder()
            .setTitle(`Welcome to your ${type.toUpperCase()}`)
            .setDescription(`স্বাগতম ${interaction.user}! আমাদের সাপোর্ট টিম খুব শীঘ্রই আপনার সাথে যোগাযোগ করবে।\n\n**ক্যাটাগরি:** ${category.toUpperCase().replace("_", " ")}`)
            .setColor("Random");

        let mentionContent = `${interaction.user}`;
        if (interaction.guild.roles.cache.has(supportRoleId)) {
            mentionContent += ` | <@&${supportRoleId}>`;
        }
        if (interaction.guild.roles.cache.has(ROLES.ADMIN)) {
            mentionContent += ` | <@&${ROLES.ADMIN}>`;
        }

        await privateChannel.send({
            content: mentionContent,
            embeds: [uiFooter(insideEmbed)],
            components: [getChannelControlRow(type)]
        });

        return interaction.editReply(`✅ সফলভাবে তৈরি হয়েছে! প্রবেশ করুন এখানে: ${privateChannel}`);
    }

    // Claim Staff Handling
    if (interaction.isButton() && interaction.customId.startsWith("claim_")) {
        const type = interaction.customId.split("_")[1];
        let reqRole = (type === "customer") ? ROLES.SUPPORT_CUSTOMER : ROLES.SUPPORT_TICKET_REPORT;

        if (!interaction.member.roles.cache.has(reqRole) && !interaction.member.roles.cache.has(ROLES.ADMIN) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: "❌ এটি ক্লেইম করার পারমিশন আপনার নেই!", flags: [MessageFlags.Ephemeral] });
        }

        await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
        }).catch(err => console.error(err));

        await interaction.reply({ content: `🛟 এই চ্যানেলটি এখন থেকে স্টাফ ${interaction.user} হ্যান্ডেল করছেন।` });
        return;
    }

    // Close Ticket Handling
    if (interaction.isButton() && interaction.customId.startsWith("close_")) {
        const type = interaction.customId.split("_")[1];
        let reqRole = (type === "customer") ? ROLES.SUPPORT_CUSTOMER : ROLES.SUPPORT_TICKET_REPORT;

        if (!interaction.member.roles.cache.has(reqRole) && !interaction.member.roles.cache.has(ROLES.ADMIN) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: "❌ আপনি এই চ্যানেলটি বন্ধ করতে পারবেন না।", flags: [MessageFlags.Ephemeral] });
        }

        await interaction.reply("🔒 চ্যানেলটি বন্ধ করা হচ্ছে... ৫ সেকেন্ডের মধ্যে চ্যানেল ডিলিট হবে।");

        let transcriptText = `--- Transcript for Channel ---\n`;
        const fetchedMessages = await interaction.channel.messages.fetch({ limit: 100 });
        fetchedMessages.reverse().forEach(m => {
            transcriptText += `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}\n`;
        });

        const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
            const logEmbed = new EmbedBuilder().setTitle(`📑 Channel Closed: ${interaction.channel.name}`).setColor("Orange");
            await logChannel.send({
                embeds: [logEmbed],
                files: [{ attachment: Buffer.from(transcriptText, "utf-8"), name: `transcript-${interaction.channel.name}.txt` }]
            });
        }

        setTimeout(async () => {
            await interaction.channel.delete().catch(() => {});
        }, 5000);
    }
});

// Manual Setup Commands
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;
    if (message.guild.id !== ALLOWED_GUILD_ID) return;

    const isServerAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator) || message.guild.ownerId === message.author.id || message.member.roles.cache.has(ROLES.ADMIN);
    if (!isServerAdmin) return;

    if (message.content === "!setup") {
        return message.channel.send({
            embeds: [createVerificationEmbed()],
            components: [verificationRow]
        });
    }
    if (message.content === "!ticket" && message.channelId === CHANNELS.TICKET_PANEL) {
        return message.channel.send(getTicketPanel());
    }
    if (message.content === "!report" && message.channelId === CHANNELS.REPORT_PANEL) {
        return message.channel.send(getReportPanel());
    }
    if (message.content === "!customer" && message.channelId === CHANNELS.CUSTOMER_PANEL) {
        return message.channel.send(getCustomerPanel());
    }
});

// ================================
// 🚀 PART 3 - Welcome Embed + Database System
// ================================

// Welcome Embed
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

// ================================
// 📂 Database Functions
// ================================

function getSavedMembers() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(DATA_FILE, JSON.stringify([]), "utf8");
            return [];
        }
        const data = fs.readFileSync(DATA_FILE, "utf8");
        return JSON.parse(data);
    } catch (err) {
        console.error("Database Read Error:", err);
        return [];
    }
}

function saveMembers(memberIds) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(memberIds, null, 2), "utf8");
    } catch (err) {
        console.error("Database Save Error:", err);
    }
}

function addMember(memberId) {
    const members = getSavedMembers();
    if (!members.includes(memberId)) {
        members.push(memberId);
        saveMembers(members);
    }
}

function removeMember(memberId) {
    const members = getSavedMembers();
    const filtered = members.filter(id => id !== memberId);
    saveMembers(filtered);
}

// Member Leave হলে Database Update
client.on("guildMemberRemove", (member) => {
    if (member.guild.id !== ALLOWED_GUILD_ID) return;
    removeMember(member.id);
});

// ================================
// 🚀 PART 4 - Ready Event + Recovery + Voice Join
// ================================

client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    setBotPresence();

    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (!guild) {
        console.log("⚠️ Guild not found!");
        return;
    }

    await connectVoice(guild);
    const welcomeChannel = guild.channels.cache.get(WELCOME_CHANNEL_ID);

    try {
        console.log("🔍 Checking for missed members while offline...");
        const currentMembers = await guild.members.fetch();
        const savedMembers = getSavedMembers();

        if (savedMembers.length > 0) {
            const missedMembers = currentMembers.filter(member =>
                !savedMembers.includes(member.id) && !member.user.bot
            );

            if (missedMembers.size > 0 && welcomeChannel) {
                console.log(`📡 Found ${missedMembers.size} missed members.`);
                for (const [, member] of missedMembers) {
                    await welcomeChannel.send({
                        content: `🎉 স্বাগতম ${member}\n\n🤖 বট অফলাইনে থাকার সময় আপনি সার্ভারে Join করেছিলেন।`,
                        embeds: [createWelcomeEmbed(member)]
                    }).catch(() => {});
                }
            }
        }

        const memberIds = currentMembers.filter(member => !member.user.bot).map(member => member.id);
        saveMembers(memberIds);
        console.log("✅ Database synced successfully.");
        console.log(`👥 Total Members: ${memberIds.length}`);
    } catch (err) {
        console.error("Recovery Error:", err);
    }
});

// Voice Reconnect
client.on("voiceStateUpdate", async () => {
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (!guild) return;
    const me = guild.members.me;
    if (!me) return;

    if (!me.voice.channel) {
        console.log("🔄 Reconnecting to Voice Channel...");
        await connectVoice(guild);
    }
});

// ================================
// 🚀 PART 5 - Member Join + Auto Login
// ================================

client.on("guildMemberAdd", async (member) => {
    if (member.guild.id !== ALLOWED_GUILD_ID) return;
    addMember(member.id);

    const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (welcomeChannel) {
        await welcomeChannel.send({
            content: `🎉 স্বাগতম ${member}!`,
            embeds: [createWelcomeEmbed(member)]
        }).catch(() => {});
    }
});

function startBot() {
    client.login(TOKEN).catch(err => {
        console.error("❌ Login Failed!");
        console.error(err);
        console.log("🔄 Retrying in 5 seconds...");
        setTimeout(startBot, 5000);
    });
}

startBot();
