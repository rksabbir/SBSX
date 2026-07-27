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
    TextInputStyle,
    ChannelType
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

let PAYMENT_NUMBER = "01404548951"; 
let VERIFICATION_LINK = "https://discord.gg/example"; 

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

const ROLES = {
    ADMIN: "1488332568372973568", 
    SUPPORT_TICKET_REPORT: "1488333580705861765", 
    SUPPORT_CUSTOMER: "1488335064873046086",
    DEVELOPER: "1523955414612578354"
};

const PACKAGE_PRICES = {
    weekly: 510,
    weekly_plan: 510,
    monthly: 1510,
    monthly_plan: 1510,
    "2_months": 2410,
    two_months_plan: 2410,
    two: 2410,
    "2months": 2410,
    "2month": 2410,
    two_months: 2410
};

function getNormalizedCategory(cat) {
    if (!cat) return "weekly";
    const c = String(cat).toLowerCase();
    if (c.includes("2") || c.includes("two")) return "2_months";
    if (c.includes("month")) return "monthly";
    return "weekly";
}

const cooldowns = new Map();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.Reaction]
});

process.on("unhandledRejection", (err) => { console.error("[Unhandled Rejection]", err); });
process.on("uncaughtException", (err) => { console.error("[Uncaught Exception]", err); });

// ================================
// 🔑 Key Generation Core Function
// ================================
async function handleOneTimeKeyGeneration(interaction) {
    try {
        const hasDevRole = interaction.member.roles.cache.has(ROLES.DEVELOPER);
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        if (!hasDevRole && !isAdmin) {
            return interaction.reply({
                content: "❌ **অনুমতি নেই!** শুধুমাত্র **Developer** রোলধারীরা C++ অ্যাপের জন্য 1TIME KEY তৈরি করতে পারবেন।",
                flags: [MessageFlags.Ephemeral]
            });
        }

        const randomKey = "KEY-" + Math.random().toString(36).substring(2, 8).toUpperCase() + "-" + Date.now().toString().slice(-4);
        const userAvatarUrl = interaction.user.displayAvatarURL({ extension: "png", size: 512 });
        const serverName = interaction.guild ? interaction.guild.name : "Discord Server";

        await db.ref(`keys/${randomKey}`).set({
            used: false,
            generatedBy: interaction.user.tag,
            username: interaction.user.username,
            userId: interaction.user.id,
            avatarUrl: userAvatarUrl,
            serverName: serverName,
            createdAt: Date.now()
        });

        const keyEmbed = new EmbedBuilder()
            .setTitle("🔑 1TIME KEY Generated Successfully!")
            .setDescription(`আপনার ১-টাইম কী সফলভাবে তৈরি হয়েছে। C++ অ্যাপে লগইন করতে নিচের কী-টি ব্যবহার করুন:\n\n**KEY:** \`${randomKey}\``)
            .setThumbnail(userAvatarUrl)
            .setColor("#57F287")
            .setFooter({ text: "নোট: এই কী-টি C++ অ্যাপে কেবল একবারই ব্যবহার করা যাবে।" });

        return interaction.reply({ embeds: [keyEmbed], flags: [MessageFlags.Ephemeral] });
    } catch (e) {
        console.error("1Time Key Gen Error:", e);
        if (!interaction.replied) {
            return interaction.reply({ content: "❌ Key তৈরির সময় এরর হয়েছে!", flags: [MessageFlags.Ephemeral] });
        }
    }
}

// ================================
// ⚡ PART 3 - Interaction Handling
// ================================

client.on("interactionCreate", async (interaction) => {
    if (!interaction.guild || interaction.guild.id !== ALLOWED_GUILD_ID) return;

    try {
        // 🔒 1. Universal Verify Button
        if (interaction.isButton() && interaction.customId === "universal_verify_button") {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            const role = interaction.guild.roles.cache.get(VERIFIED_ROLE_ID);
            if (!role) return interaction.editReply("❌ ভেরিফাইড রোলটি পাওয়া যায়নি!");

            if (interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
                return interaction.editReply("⚠️ আপনি ইতোমধ্যে ভেরিফাই হয়ে আছেন।");
            }

            await interaction.member.roles.add(role);
            return interaction.editReply("✅ আপনি সফলভাবে ভেরিফাই সম্পন্ন করেছেন!");
        }

        // 🔒 2. Digital / HWID Lock Selection Menu
        if (interaction.isStringSelectMenu() && interaction.customId === "select_lock_type") {
            await interaction.deferUpdate();
            const selectedLock = interaction.values[0]; 
            const userId = interaction.user.id;

            await db.ref(`pending_locks/${userId}`).set({
                lockType: selectedLock,
                updatedAt: Date.now()
            });

            return interaction.followUp({
                content: `✅ আপনি সফলভাবে **${selectedLock === "HWID" ? "Hardware Lock (HWID)" : "Digital Session Lock"}** বেছে নিয়েছেন!`,
                flags: [MessageFlags.Ephemeral]
            });
        }

        // 🔑 3. 1Time Key Generation
        if (interaction.isButton() && (interaction.customId === "btn_generate_1time_key" || interaction.customId === "generate_1time_key")) {
            return handleOneTimeKeyGeneration(interaction);
        }

        // 🎟️ 4. Dropdown Panel Selection (Ticket/Report/Customer/Order)
        if (interaction.isStringSelectMenu() && (interaction.customId.startsWith("select_product_") || interaction.customId.startsWith("select_report_") || interaction.customId.startsWith("select_customer_") || interaction.customId.startsWith("select_buy_") || interaction.customId.startsWith("select_key_"))) {
            const value = interaction.values[0];
            if (value === "none" || value === "error") return interaction.reply({ content: "❌ অবৈধ অপশন!", flags: [MessageFlags.Ephemeral] });

            if (value === "generate_1time_key") {
                return handleOneTimeKeyGeneration(interaction);
            }

            let type = ""; let embedColor = ""; let buttonId = "";
            const lowerVal = value.toLowerCase();

            if (interaction.customId === "select_product_ticket") { type = "ticket"; embedColor = "#5865F2"; buttonId = `create_ticket_${lowerVal}`; }
            else if (interaction.customId === "select_report_category") { type = "report"; embedColor = "#ED4245"; buttonId = `create_report_${lowerVal}`; }
            else if (interaction.customId === "select_customer_category") { type = "customer"; embedColor = "#57F287"; buttonId = `create_customer_${lowerVal}`; }
            else if (interaction.customId === "select_buy_category") { type = "order"; } 

            if (type === "order") {
                const modal = new ModalBuilder().setCustomId(`modal_coupon_${lowerVal}`).setTitle("🎟️ Coupon / Discount Code");
                const couponInput = new TextInputBuilder()
                    .setCustomId("coupon_code_input")
                    .setLabel("কুপন কোড দিন (না থাকলে SKIP লিখুন)")
                    .setStyle(TextInputStyle.Short)
                    .setValue("SKIP")
                    .setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(couponInput));
                return interaction.showModal(modal);
            } else if (type) {
                const ephemeralEmbed = new EmbedBuilder()
                    .setTitle(`📌 Selected Category: ${value.toUpperCase().replace(/_/g, " ")}`)
                    .setDescription(`চ্যানেল তৈরি করতে নিচের **Create ${type.toUpperCase()}** বাটনে চাপ দিন।`)
                    .setColor(embedColor);

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(buttonId)
                        .setLabel(`Create ${type.toUpperCase()}`)
                        .setStyle(ButtonStyle.Success)
                );
                return interaction.reply({ embeds: [ephemeralEmbed], components: [row], flags: [MessageFlags.Ephemeral] });
            }
        }

        // 🎟️ 5. CREATE TICKET / REPORT / CUSTOMER BUTTON CLICK HANDLER (FIXED DIDN'T RESPOND)
        if (interaction.isButton() && (interaction.customId.startsWith("create_ticket_") || interaction.customId.startsWith("create_report_") || interaction.customId.startsWith("create_customer_"))) {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            const customId = interaction.customId;
            let ticketType = "ticket";
            let categoryName = customId.replace("create_ticket_", "").replace("create_report_", "").replace("create_customer_", "");

            if (customId.startsWith("create_report_")) ticketType = "report";
            if (customId.startsWith("create_customer_")) ticketType = "customer";

            const channelName = `${ticketType}-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

            // Check if ticket already exists
            const existingChannel = interaction.guild.channels.cache.find(c => c.name === channelName);
            if (existingChannel) {
                return interaction.editReply(`⚠️ আপনার একটি টিকিট ইতোমধ্যেই খোলা রয়েছে: ${existingChannel}`);
            }

            // Create Ticket Channel
            const ticketChannel = await interaction.guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: interaction.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles]
                    },
                    {
                        id: ROLES.ADMIN,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles]
                    },
                    {
                        id: ROLES.SUPPORT_TICKET_REPORT,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles]
                    }
                ]
            });

            const embed = new EmbedBuilder()
                .setTitle(`🎟️ ${ticketType.toUpperCase()} SUPPORT CHANNEL`)
                .setDescription(`হ্যালো ${interaction.user}, আমাদের সাপোর্ট টিম শীঘ্রই আপনার সমস্যার সমাধান করবে।\n\n📌 **ক্যাটাগরি:** \`${categoryName.toUpperCase()}\``)
                .setColor("#5865F2")
                .setTimestamp();

            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("btn_close_ticket")
                    .setLabel("🔒 Close Ticket")
                    .setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({ content: `${interaction.user} <@&${ROLES.SUPPORT_TICKET_REPORT}>`, embeds: [embed], components: [closeRow] });

            return interaction.editReply(`✅ আপনার সাপোর্ট চ্যানেল সফলভাবে তৈরি হয়েছে: ${ticketChannel}`);
        }

        // 🔒 6. Close Ticket Button
        if (interaction.isButton() && interaction.customId === "btn_close_ticket") {
            await interaction.reply({ content: "🔒 টিকিটটি ৫ সেকেন্ডের মধ্যে বন্ধ করে দেওয়া হচ্ছে..." });
            setTimeout(() => {
                interaction.channel.delete().catch(() => {});
            }, 5000);
            return;
        }

        // 🎟️ 7. Coupon Modal Submit
        if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_coupon_")) {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            const rawCategory = interaction.customId.replace("modal_coupon_", "").toLowerCase();
            const category = getNormalizedCategory(rawCategory);
            
            const couponInput = interaction.fields.getTextInputValue("coupon_code_input");
            const couponEntered = couponInput ? couponInput.trim().toUpperCase() : "SKIP";
            const userId = interaction.user.id;

            let basePrice = PACKAGE_PRICES[category] || 510;
            let finalPrice = basePrice;
            let discountText = "কোনো ডিসকাউন্ট কুপন ব্যবহার করা হয়নি।";
            let appliedCouponCode = null;
            let appliedDiscountValue = 0;

            if (couponEntered !== "SKIP") {
                const couponRef = db.ref(`coupons/${couponEntered}`);
                const couponSnap = await couponRef.once("value");

                if (couponSnap.exists()) {
                    const couponData = couponSnap.val();
                    const now = Date.now();

                    if (couponData.status === "used") {
                        discountText = "❌ **কুপন কোডটি ইতোমধ্যে ব্যবহার করা হয়েছে!** মূল মূল্য প্রযোজ্য হবে।";
                    } else if (couponData.expiresAt && couponData.expiresAt < now) {
                        await couponRef.update({ status: "expired" });
                        discountText = "❌ **কুপন কোডটির মেয়াদ শেষ হয়ে গেছে!** মূল মূল্য প্রযোজ্য হবে।";
                    } else if (couponData.status === "active") {
                        appliedDiscountValue = Number(couponData.couponValue || couponData.discountValue || 0);
                        finalPrice = Math.max(0, basePrice - appliedDiscountValue);
                        appliedCouponCode = couponEntered;

                        discountText = `🎉 **কুপন কোড \`${couponEntered}\` সফলভাবে অ্যাপ্লাই হয়েছে!**\n` +
                                       `💸 **ছাড়ের পরিমাণ:** \`${appliedDiscountValue}\` ৳\n` +
                                       `🏷️ **নতুন মূল্য:** \`${finalPrice}\` ৳`;
                    }
                } else {
                    discountText = "⚠️ **অবৈধ কুপন কোড!** মূল মূল্য প্রযোজ্য হবে।";
                }
            }

            await db.ref(`pending_payments/${userId}_${category}`).set({
                targetPrice: finalPrice,
                basePrice: basePrice,
                appliedCoupon: appliedCouponCode,
                appliedDiscount: appliedDiscountValue,
                totalPaid: 0,
                usedTxns: []
            });

            const lockTypeRow = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("select_lock_type")
                    .setPlaceholder("🔒 আপনার পছন্দের Lock System বেছে নিন...")
                    .addOptions([
                        { label: "🖥️ Hardware Lock (HWID)", description: "শুধুমাত্র ১টি নির্দিষ্ট PC-তে স্থায়ীভাবে লক থাকবে।", value: "HWID" },
                        { label: "🌐 Digital Session Lock", description: "যেকোনো PC-তে চালানো যাবে, তবে একাধিক PC-তে একসাথে ব্যবহার করা যাবে না।", value: "DIGITAL" }
                    ])
            );

            const payEmbed = new EmbedBuilder()
                .setTitle(`💳 Payment Gateway: ${category.toUpperCase().replace(/_/g, " ")}`)
                .setDescription(
                    `📦 **প্যাকেজের রেগুলার মূল্য:** \`${basePrice}\` BDT\n` +
                    `💰 **আপনাকে পেমেন্ট করতে হবে:** \`${finalPrice}\` BDT\n\n` +
                    `📱 **বিকাশ / নগদ (Personal):** \`${PAYMENT_NUMBER}\`\n\n` +
                    `টাকা পাঠানোর পর প্রাপ্ত Transaction ID (TxnID) দিয়ে নিচের **"Submit TxnID"** বাটনে ক্লিক করুন।\n\n` +
                    `🎁 **কুপন ও ডিসকাউন্ট স্ট্যাটাস:**\n${discountText}`
                )
                .setColor("#9B59B6");

            const btnRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`submit_txn_${category}`)
                    .setLabel("Submit TxnID")
                    .setStyle(ButtonStyle.Primary)
            );

            return interaction.editReply({ embeds: [payEmbed], components: [lockTypeRow, btnRow] });
        }

    } catch (err) {
        console.error("❌ Interaction Handling Error:", err);
        if (!interaction.replied && !interaction.deferred) {
            return interaction.reply({ content: "❌ এটি সম্পূর্ণ করার সময় একটি এরর হয়েছে!", flags: [MessageFlags.Ephemeral] }).catch(() => {});
        } else {
            return interaction.editReply("❌ এটি সম্পূর্ণ করার সময় একটি এরর হয়েছে!").catch(() => {});
        }
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
    client.login(TOKEN).then(() => {
        console.log(`🤖 Bot logged in successfully as ${client.user.tag}`);
        setBotPresence();
    }).catch(err => {
        console.error("❌ Discord Login Failed:", err);
    });
}

startBot();
