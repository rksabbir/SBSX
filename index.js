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
    ActivityType
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

// Database
const DATA_FILE = "./database.json";

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

        await entersState(
            connection,
            VoiceConnectionStatus.Ready,
            30000
        );

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

        const verifyChannel = member.guild.channels.cache.find(
            ch => ch.name === VERIFY_CHANNEL_NAME
        );

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

// Verification Button Click
client.on("interactionCreate", async (interaction) => {

    if (!interaction.isButton()) return;

    if (!interaction.guild) return;

    if (interaction.guild.id !== ALLOWED_GUILD_ID) return;

    if (interaction.customId !== "universal_verify_button") return;

    try {

        await interaction.deferReply({
            ephemeral: true
        });

        const role = interaction.guild.roles.cache.get(
            VERIFIED_ROLE_ID
        );

        if (!role) {
            return interaction.editReply("❌ Role not found!");
        }

        if (interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
            return interaction.editReply("⚠️ আপনি ইতোমধ্যে ভেরিফাই হয়েছেন।");
        }

        await interaction.member.roles.add(role);

        await interaction.editReply("✅ সফলভাবে ভেরিফাই সম্পন্ন হয়েছে!");

        const welcomeChannel =
            interaction.guild.channels.cache.find(
                ch => ch.name === WELCOME_CHANNEL_NAME
            );

        if (welcomeChannel) {
            welcomeChannel
                .send(`🎉 Welcome ${interaction.user}!`)
                .catch(() => {});
        }

    } catch (err) {

        console.error(err);

        if (interaction.deferred) {
            interaction.editReply(
                "❌ Error! Bot Permission চেক করুন।"
            ).catch(() => {});
        }

    }

});

// Manual Setup Command
client.on("messageCreate", async (message) => {

    if (message.author.bot) return;

    if (!message.guild) return;

    if (message.guild.id !== ALLOWED_GUILD_ID) return;

    if (message.content !== "!setup") return;

    await message.channel.send({
        embeds: [createVerificationEmbed()],
        components: [verificationRow]
    });

});
// ================================
// 🚀 PART 3 - Welcome Embed + Database System
// ================================

// Welcome Embed
function createWelcomeEmbed(member) {

    return new EmbedBuilder()
        .setColor("#00AAFF")
        .setTitle("🎉 নতুন সদস্য Join করেছে!")
        .setThumbnail(
            member.user.displayAvatarURL({
                dynamic: true
            })
        )
        .setDescription(
            `✨ স্বাগতম ${member} আমাদের সার্ভারে!\n\n📜 আমাদের নিয়মগুলো মেনে চলার অনুরোধ রইল। ❤️`
        )
        .addFields(
            {
                name: "👤 Username",
                value: member.user.tag,
                inline: true
            },
            {
                name: "🆔 User ID",
                value: member.user.id,
                inline: true
            },
            {
                name: "⏰ Joined Server",
                value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`,
                inline: true
            },
            {
                name: "👥 Total Members",
                value: `${member.guild.memberCount}`,
                inline: true
            }
        )
        .setTimestamp();

}

// ================================
// 📂 Database Functions
// ================================

function getSavedMembers() {

    try {

        if (!fs.existsSync(DATA_FILE)) {

            fs.writeFileSync(
                DATA_FILE,
                JSON.stringify([]),
                "utf8"
            );

            return [];
        }

        const data = fs.readFileSync(
            DATA_FILE,
            "utf8"
        );

        return JSON.parse(data);

    } catch (err) {

        console.error(
            "Database Read Error:",
            err
        );

        return [];

    }

}

function saveMembers(memberIds) {

    try {

        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(memberIds, null, 2),
            "utf8"
        );

    } catch (err) {

        console.error(
            "Database Save Error:",
            err
        );

    }

}

// ================================
// ➕ Member Save Function
// ================================

function addMember(memberId) {

    const members = getSavedMembers();

    if (!members.includes(memberId)) {

        members.push(memberId);

        saveMembers(members);

    }

}

// ================================
// ➖ Member Remove Function
// ================================

function removeMember(memberId) {

    const members = getSavedMembers();

    const filtered = members.filter(
        id => id !== memberId
    );

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

    // Presence
    setBotPresence();

    // Guild
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);

    if (!guild) {
        console.log("⚠️ Guild not found!");
        return;
    }

    // Voice Auto Join
    await connectVoice(guild);

    // Welcome Channel
    const welcomeChannel =
        guild.channels.cache.get(WELCOME_CHANNEL_ID);

    // ===========================
    // Startup Recovery
    // ===========================

    try {

        console.log(
            "🔍 Checking for missed members while offline..."
        );

        const currentMembers =
            await guild.members.fetch();

        const savedMembers =
            getSavedMembers();

        if (savedMembers.length > 0) {

            const missedMembers =
                currentMembers.filter(member =>
                    !savedMembers.includes(member.id) &&
                    !member.user.bot
                );

            if (
                missedMembers.size > 0 &&
                welcomeChannel
            ) {

                console.log(
                    `📡 Found ${missedMembers.size} missed members.`
                );

                for (const [, member] of missedMembers) {

                    await welcomeChannel.send({

                        content:
                            `🎉 স্বাগতম ${member}\n\n` +
                            `🤖 বট অফলাইনে থাকার সময় আপনি সার্ভারে Join করেছিলেন।`,

                        embeds: [
                            createWelcomeEmbed(member)
                        ]

                    }).catch(() => {});

                }

            }

        }

        // ===========================
        // Database Sync
        // ===========================

        const memberIds =
            currentMembers
                .filter(member => !member.user.bot)
                .map(member => member.id);

        saveMembers(memberIds);

        console.log(
            "✅ Database synced successfully."
        );

        console.log(
            `👥 Total Members: ${memberIds.length}`
        );

    } catch (err) {

        console.error(
            "Recovery Error:",
            err
        );

    }

});

// ================================
// Voice Reconnect
// ================================

client.on("voiceStateUpdate", async () => {

    const guild =
        client.guilds.cache.get(ALLOWED_GUILD_ID);

    if (!guild) return;

    const me = guild.members.me;

    if (!me) return;

    if (!me.voice.channel) {

        console.log(
            "🔄 Reconnecting to Voice Channel..."
        );

        await connectVoice(guild);

    }

});
// ================================
// 🚀 PART 5 - Member Join + Auto Login
// ================================

// Welcome Message + Database Save
client.on("guildMemberAdd", async (member) => {

    if (member.guild.id !== ALLOWED_GUILD_ID) return;

    // Database Update
    addMember(member.id);

    // Welcome Channel
    const welcomeChannel =
        member.guild.channels.cache.get(
            WELCOME_CHANNEL_ID
        );

    if (welcomeChannel) {

        await welcomeChannel.send({

            content: `🎉 স্বাগতম ${member}!`,

            embeds: [
                createWelcomeEmbed(member)
            ]

        }).catch(() => {});

    }

});

// ================================
// Auto Login
// ================================

function startBot() {

    client.login(TOKEN).catch(err => {

        console.error(
            "❌ Login Failed!"
        );

        console.error(err);

        console.log(
            "🔄 Retrying in 5 seconds..."
        );

        setTimeout(startBot, 5000);

    });

}

startBot();
