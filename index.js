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

// অর্ডার ট্র্যাকিং ও গাইড চ্যানেল আইডি
const ORDER_TRACKING_CHANNEL_ID = "1488340262827855983"; 
const ORDER_GUIDE_CHANNEL_ID = "1488339045602951199";

// ১-টাইম কী জেনারেটর চ্যানেল আইডি
const ONETIME_KEY_CHANNEL_IDS = ["1488340757160005683"];

const ROLES = {
    ADMIN: "1488332568372973568", 
    SUPPORT_TICKET_REPORT: "1488333580705861765", 
    SUPPORT_CUSTOMER: "1488335064873046086",
    DEVELOPER: "1523955414612578354"
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

const BAD_WORDS = ["gali1", "gali2", "gali3", "khanki", "magi", "baimon"]; 

// 💰 প্যাকেজের মূল্য তালিকা
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

const LEVEL_ROLE_ID = "1524322087295127552";

const DATA_FILE = "./database.json";
const WELCOME_LOG_FILE = "./welcome_messages.json";
const PUNISH_FILE = "./punishments.json"; 
const ORDER_LOG_FILE = "./order_tracking.json"; 

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
    
    const keyRef = db.ref(`keys/${randomKey}`);
    
    await keyRef.set({
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

    return interaction.reply({ 
        embeds: [keyEmbed], 
        flags: [MessageFlags.Ephemeral] 
    });
}

// Helper Functions
function getWelcomeLogs() { if (!fs.existsSync(WELCOME_LOG_FILE)) fs.writeFileSync(WELCOME_LOG_FILE, JSON.stringify({}), "utf8"); return JSON.parse(fs.readFileSync(WELCOME_LOG_FILE, "utf8")); }
function getPunishments() { if (!fs.existsSync(PUNISH_FILE)) fs.writeFileSync(PUNISH_FILE, JSON.stringify({}), "utf8"); return JSON.parse(fs.readFileSync(PUNISH_FILE, "utf8")); }
function savePunishment(userId, status, durationMs = null) { const punishments = getPunishments(); if (status === null) { delete punishments[userId]; } else { punishments[userId] = { status: status, time: Date.now(), expiresAt: durationMs ? Date.now() + durationMs : null }; } fs.writeFileSync(PUNISH_FILE, JSON.stringify(punishments, null, 2), "utf8"); }

function buildDynamicWelcomeEmbed(member, status, isOfflineHook = false, verifyTime = null) {
    let statusText = "❌ Unverified"; let color = "#FFA500"; 
    let thumbnail = member.user ? member.user.displayAvatarURL({ extension: "png", size: 512 }) : null;
    let tag = member.user ? member.user.tag : member.userId || "Unknown Member";
    let id = member.id || member.userId;
    let joinedTime = member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "Unknown";

    if (status === "verified") { statusText = "✅ Verified"; color = "#00FF00"; }
    else if (status === "left") { statusText = "🚫 Left Server"; color = "#FF0000"; }

    const embed = new EmbedBuilder().setColor(color).setTitle("🎉 নতুন সদস্য ট্র্যাকিং সিস্টেম").setDescription(`✨ স্বাগতম <@${id}> আমাদের সার্ভারে!\n📜 আমাদের নিয়মগুলো মেনে চলার অনুরোধ রইল। ❤️`).addFields({ name: "👤 Username", value: `${tag}`, inline: true }, { name: "🆔 User ID", value: `${id}`, inline: true }, { name: "⏰ Joined Server", value: joinedTime, inline: true }, { name: "🛡️ Verification Status", value: `**${statusText}**`, inline: true }).setTimestamp();
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (member.guild) embed.addFields({ name: "👥 Total Members", value: `${member.guild.memberCount}`, inline: true });
    if (verifyTime) embed.addFields({ name: "⚡ Verified At", value: `<t:${Math.floor(verifyTime / 1000)}:R>`, inline: true });
    if (isOfflineHook) embed.setFooter({ text: "⚠️ বট অফলাইন থাকার সময় এই অ্যাকশনটি ঘটেছিল।" });
    else embed.setFooter({ text: "Professional Security Management System" });
    return embed;
}

// Ghost Ping Track
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

// Automod
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild || message.guild.id !== ALLOWED_GUILD_ID) return;
    if (message.member.permissions.has(PermissionFlagsBits.Administrator) || message.member.roles.cache.has(ROLES.ADMIN)) return;
    
    const userId = message.author.id; 
    let triggerAutomod = false; 
    let reason = "";
    const contentLower = message.content.toLowerCase();

    // Caps-Lock Protection
    const upperCount = message.content.replace(/[^A-Z]/g, "").length;
    const totalLetters = message.content.replace(/[^a-zA-Z]/g, "").length;
    if (totalLetters > 5 && (upperCount / totalLetters) > 0.7) {
        try { await message.delete().catch(() => {}); } catch(e){}
        const capsWarn = await message.channel.send(`⚠️ <@${userId}>, মেসেজে অতিরিক্ত বড় হাতের অক্ষর ব্যবহার করবেন না।`);
        setTimeout(() => capsWarn.delete().catch(() => {}), 5000);
        return;
    }

    // Anti-Link Spam
    const linkRegex = /(https?:\/\/[^\s]+)/g;
    if (linkRegex.test(message.content)) {
        try { await message.delete().catch(() => {}); } catch(e){}
        const linkWarn = await message.channel.send(`⚠️ <@${userId}>, সার্ভারে কোনো প্রকার বাইরের লিংক ছড়ানো সম্পূর্ণ নিষিদ্ধ!`);
        setTimeout(() => linkWarn.delete().catch(() => {}), 5000);
        return;
    }

    if (contentLower.includes("link") || contentLower.includes("লিংক") || contentLower.includes("লিঙ্ক")) {
        return message.reply(`👋 আমাদের ভেরিফিকেশন লাইভ লিংক:\n\`${VERIFICATION_LINK}\``);
    }

    if (BAD_WORDS.some(word => contentLower.includes(word))) { triggerAutomod = true; reason = "গালিগালাজ / নিষিদ্ধ শব্দ ব্যবহার"; }
    if (!triggerAutomod) {
        const now = Date.now(); if (!userMsgCounter.has(userId)) userMsgCounter.set(userId, []);
        const timestamps = userMsgCounter.get(userId); timestamps.push(now);
        const expirationTime = now - 5000; const activeTimestamps = timestamps.filter(time => time > expirationTime);
        userMsgCounter.set(userId, activeTimestamps);
        if (activeTimestamps.length >= 5) { triggerAutomod = true; reason = "অতিরিক্ত স্প্যামিং করা"; }
    }
    if (triggerAutomod) {
        try { await message.delete().catch(() => {}); } catch(e){}
        let warns = (userWarns.get(userId) || 0) + 1; userWarns.set(userId, warns);
        if (warns < 3) {
            const warnEmbed = new EmbedBuilder().setColor("Yellow").setDescription(`⚠️ <@${userId}>, সার্ভারে **${reason}** নিষিদ্ধ! আপনি এটি **${warns}/৩** বার করেছেন।`);
            const warnMsg = await message.channel.send({ embeds: [warnEmbed] }); setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
        } else {
            userWarns.set(userId, 0); savePunishment(userId, "Muted", 10 * 60 * 1000); 
            try { await message.member.timeout(10 * 60 * 1000, "Automod: Limit Exceeded"); const muteEmbed = new EmbedBuilder().setColor("Red").setTitle("🚫 মেম্বার মিউটেড").setDescription(`<@${userId}> কে ১০ মিনিটের জন্য মিউট করা হয়েছে।`); await message.channel.send({ embeds: [muteEmbed] }); } catch (err) {}
        }
    }
});

// ================================
// ⚡ PART 3 - Interaction Handling
// ================================

client.on("interactionCreate", async (interaction) => {
    if (!interaction.guild || interaction.guild.id !== ALLOWED_GUILD_ID) return;

    if (interaction.isButton() || interaction.isStringSelectMenu()) {
        const cooldownKey = `${interaction.user.id}-${interaction.customId}`;
        if (cooldowns.has(cooldownKey) && interaction.customId !== "universal_verify_button" && !interaction.customId.startsWith("pay_") && !interaction.customId.startsWith("modal_coupon_") && interaction.customId !== "select_lock_type") {
            return interaction.reply({ content: "⚠️ আপনি খুব দ্রুত ক্লিক করছেন!", flags: [MessageFlags.Ephemeral] });
        }
        cooldowns.set(cooldownKey, true); setTimeout(() => cooldowns.delete(cooldownKey), 3000);
    }

    // ------------------ 🔒 lockType Select Menu ------------------
    if (interaction.isStringSelectMenu() && interaction.customId === "select_lock_type") {
        try {
            await interaction.deferUpdate();
            const selectedLock = interaction.values[0]; // "HWID" or "DIGITAL"
            const userId = interaction.user.id;

            await db.ref(`pending_locks/${userId}`).set({
                lockType: selectedLock
            });

            await interaction.followUp({
                content: `✅ আপনি সফলভাবে **${selectedLock === "HWID" ? "Hardware (HWID)" : "Digital Session"} Lock** বেছে নিয়েছেন!`,
                flags: [MessageFlags.Ephemeral]
            });
        } catch (err) {
            console.error("Lock select menu error:", err);
        }
        return;
    }

    // Verify Button
    if (interaction.isButton() && interaction.customId === "universal_verify_button") {
        try {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            const role = interaction.guild.roles.cache.get(VERIFIED_ROLE_ID);
            if (!role) return interaction.editReply("❌ Role not found!");
            if (interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) return interaction.editReply("⚠️ আপনি ইতোমধ্যে ভেরিফাই হয়েছেন।");
            await interaction.member.roles.add(role); await interaction.editReply("✅ সফলভাবে ভেরিফাই সম্পন্ন হয়েছে!");
            
            db.ref(`analytics/joins/${Date.now()}`).set(interaction.user.id);
        } catch (err) { console.error(err); }
        return;
    }

    // 🔑 Button 1Time Key Handler
    if (interaction.isButton() && (interaction.customId === "btn_generate_1time_key" || interaction.customId === "generate_1time_key")) {
        return handleOneTimeKeyGeneration(interaction);
    }

    // 🎟️ BUY / PAYMENT PANEL SELECTION (Dropdown)
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

        // 🛒 Buy Panel modal trigger
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
            const ephemeralEmbed = new EmbedBuilder().setTitle(`📌 Selected Category: ${value.toUpperCase().replace("_", " ")}`).setDescription(`চ্যানেল তৈরি করতে নিচের বাটনে চাপ দিন।`).setColor(embedColor);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(buttonId).setLabel(`Create ${type.toUpperCase()}`).setStyle(ButtonStyle.Success));
            return interaction.reply({ embeds: [ephemeralEmbed], components: [row], flags: [MessageFlags.Ephemeral] });
        }
    }

    // 🎟️ MODAL SUBMIT HANDLER FOR BUY PANEL (FIXED NO RESPONSE ISSUE)
    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_coupon_")) {
        try {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            // customId থেকে ক্যাটাগরি এক্সট্রাক্ট করা
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

            // ফায়ারবেসে পেন্ডিং পেমেন্ট আপডেট
            await db.ref(`pending_payments/${userId}_${category}`).set({
                targetPrice: finalPrice,
                basePrice: basePrice,
                appliedCoupon: appliedCouponCode,
                appliedDiscount: appliedDiscountValue,
                totalPaid: 0,
                usedTxns: []
            });

            // Lock Type Select Menu Component
            const lockTypeRow = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("select_lock_type")
                    .setPlaceholder("🔒 আপনার লকিং সিস্টেম সিলেক্ট করুন...")
                    .addOptions([
                        { label: "🖥️ Hardware Lock (HWID)", description: "শুধুমাত্র ১টি নির্ধারিত PC-তে ব্যাকগ্রাউন্ডে লক থাকবে।", value: "HWID" },
                        { label: "🌐 Digital Lock (Session Lock)", description: "যেকোনো PC-তে লগইন করা যাবে, তবে একসাথে ২টিতে নয়।", value: "DIGITAL" }
                    ])
            );

            const payEmbed = new EmbedBuilder()
                .setTitle(`💳 Payment Gateway: ${category.toUpperCase().replace("_", " ")}`)
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

        } catch (err) {
            console.error("❌ Buy Panel Handler Error:", err);
            return interaction.editReply("❌ পেমেন্ট প্রসেস করার সময় ইন্টারনাল এরর হয়েছে!");
        }
    }
});

// Member Profile Avatar Update
client.on("guildMemberUpdate", (oldMember, newMember) => {
    const userId = newMember.id;
    const rawAvatar = newMember.user.displayAvatarURL({ extension: "png", size: 512 });
    const newAvatar = `${rawAvatar}?t=${Date.now()}`;
    const newUsername = newMember.user.username;

    db.ref(`users/${userId}`).once("value", (snapshot) => {
        if (snapshot.exists()) {
            db.ref(`users/${userId}`).update({
                avatarUrl: newAvatar,
                username: newUsername
            });
        }
    });
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
