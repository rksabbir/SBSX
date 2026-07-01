const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder, 
    ActivityType 
} = require('discord.js');

// 🔐 IMPORTANT: Use Environment Variable
const BOT_TOKEN = process.env.TOKEN;

const ALLOWED_GUILD_ID = '1488101970425155584'; 
const VERIFIED_ROLE_ID = '1488333841402691664';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel, Partials.GuildMember]
});

// --- Crash Protection ---
process.on('unhandledRejection', (err) => console.log('Error:', err));
process.on('uncaughtException', (err) => console.log('Error:', err));

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    client.user.setPresence({
        activities: [{ name: 'Security & Verification', type: ActivityType.Watching }],
        status: 'online',
    });
});

// Button
const verificationRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
        .setCustomId('universal_verify_button')
        .setLabel('Verify Me')
        .setStyle(ButtonStyle.Success)
);

// Welcome on join
client.on('guildMemberAdd', async member => {
    if (member.guild.id !== ALLOWED_GUILD_ID) return;

    try {
        const verifyChannel = member.guild.channels.cache.find(ch => ch.name === 'verify');
        if (!verifyChannel) return;

        const embed = new EmbedBuilder()
            .setTitle('🚨 Verification Required')
            .setDescription('👇 নিচের বাটনে ক্লিক করে ভেরিফাই হোন')
            .setColor('Blue')
            .setImage('https://cdn.discordapp.com/attachments/1488338142607184055/1488761437550678056/5cfd1fe4-d12c-4439-b374-f386f7595184.png');

        await verifyChannel.send({
            content: `স্বাগতম <@${member.id}>!`,
            embeds: [embed],
            components: [verificationRow]
        });

    } catch (err) {
        console.log(err);
    }
});

// Button interaction
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (!interaction.guild || interaction.guild.id !== ALLOWED_GUILD_ID) return;

    if (interaction.customId === 'universal_verify_button') {
        try {
            await interaction.deferReply({ ephemeral: true });

            const role = interaction.guild.roles.cache.get(VERIFIED_ROLE_ID);
            if (!role) return interaction.editReply('❌ Role not found!');

            if (interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
                return interaction.editReply('⚠️ Already verified!');
            }

            await interaction.member.roles.add(role);
            await interaction.editReply('✅ Verified successfully!');

            const welcomeChannel = interaction.guild.channels.cache.find(ch => ch.name === 'welcome');
            if (welcomeChannel) {
                welcomeChannel.send(`🎉 Welcome ${interaction.user}!`).catch(() => {});
            }

        } catch (err) {
            console.error(err);
            if (interaction.deferred) {
                interaction.editReply('❌ Error! Check bot permissions.');
            }
        }
    }
});

// Manual setup command
client.on('messageCreate', async message => {
    if (message.author.bot || message.guild?.id !== ALLOWED_GUILD_ID) return;

    if (message.content === '!setup') {
        const embed = new EmbedBuilder()
            .setTitle('🚨 Verification System')
            .setDescription('👇 Click button to verify')
            .setColor('Blue')
            .setImage('https://cdn.discordapp.com/attachments/1488338142607184055/1488761437550678056/5cfd1fe4-d12c-4439-b374-f386f7595184.png');

        message.channel.send({
            embeds: [embed],
            components: [verificationRow]
        });
    }
});

client.login(BOT_TOKEN);
