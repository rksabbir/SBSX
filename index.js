// ================================================
// 🚀 PART 1 - Setup + Express + Firebase Admin + Config
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

const discordTranscripts = require("discord-html-transcripts");

// ফায়ারবেস কনফিগারেশন লোড করার লজিক
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

// ফায়ারবেস ডাটাবেস ইনিশিয়ালাইজেশন
const firebaseURL = process.env.FIREBASE_DB_URL || "https://rkbackles-default-rtdb.firebaseio.com";
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: firebaseURL
});

const db = admin.database();

// রেন্ডার পোর্টের জন্য এক্সপ্রেস সার্ভার
const app = express();
app.get("/", (req, res) => { res.send("Bot is running active!"); });
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🌐 Web server running on port ${PORT}`); });

// ================================================
// 📱 Dynamic Realtime Settings (Firebase Sync)
// ================================================
let PAYMENT_NUMBER = "01404548951";
let VERIFICATION_LINK = "https://discord.gg/example";

db.ref("settings").on("value", (snapshot) => {
  if (snapshot.exists()) {
    const data = snapshot.val();
    if (data.payment_number) PAYMENT_NUMBER = String(data.payment_number);
    if (data.verification_link) VERIFICATION_LINK = String(data.verification_link);
  }
});

// ================================================
// ⚙️ Bot Config & Automod Rules
// ================================================
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

const BAD_WORDS = ["gali1", "gali2", "gali3", "khanki", "magi", "baimon"]; 

const PACKAGE_PRICES = {
  weekly: 510,
  monthly: 1510,
  "2_months": 2410
};

function getNormalizedCategory(cat) {
  if (!cat) return "weekly";
  const c = String(cat).toLowerCase();
  if (c.includes("2") || c.includes("two")) return "2_months";
  if (c.includes("month")) return "monthly";
  return "weekly";
}

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
// 🔑 1-Time Key Generation Core Function
// ================================================
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
  const userAvatarUrl = interaction.user.displayAvatarURL({ extension: "png", dynamic: true, size: 512 });
  const serverName = interaction.guild ? interaction.guild.name : "Discord Server";
  const username = interaction.user.username;

  const keyRef = db.ref(`keys/${randomKey}`);
  
  // 🟢 C++ অ্যাপের জন্য username, generatedBy এবং avatarUrl সঠিকভাবে সেভ করা
  await keyRef.set({
    used: false,
    username: username,            // 👈 C++ অ্যাপে ড্যাশবোর্ডে নাম দেখানোর প্রধান ফিচার
    generatedBy: interaction.user.tag,
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

// ================================================
// ⚡ PART 2 - Interaction Handling
// ================================================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.guild || interaction.guild.id !== ALLOWED_GUILD_ID) return;

  // ১. বাটন ভিত্তিক ভেরিফিকেশন হ্যান্ডলার
  if (interaction.isButton() && interaction.customId === "universal_verify_button") {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      const role = interaction.guild.roles.cache.get(VERIFIED_ROLE_ID);
      if (!role) return interaction.editReply("❌ ভেরিফিকেশন রোলটি পাওয়া যায়নি!");
      if (interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) return interaction.editReply("⚠️ আপনি ইতোমধ্যেই ভেরিফাইড!");
      
      await interaction.member.roles.add(role); 
      return interaction.editReply("✅ সফলভাবে ভেরিফাই সম্পন্ন হয়েছে!");
    } catch (e) {
      console.error(e);
    }
  }

  // ২. ১-টাইম কী জেনারেটর বাটন
  if (interaction.isButton() && (interaction.customId === "btn_generate_1time_key" || interaction.customId === "generate_1time_key")) {
    return handleOneTimeKeyGeneration(interaction);
  }

  // ৩. ড্রপডাউন সিলেকশন হ্যান্ডলার
  if (interaction.isStringSelectMenu()) {
    const value = interaction.values[0];
    if (value === "generate_1time_key") {
      return handleOneTimeKeyGeneration(interaction);
    }
  }

  // ৪. কুপন সিস্টেম হ্যান্ডলার
  if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_coupon_")) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const rawCategory = interaction.customId.split("_")[2].toLowerCase();
    const category = getNormalizedCategory(rawCategory);
    const couponEntered = interaction.fields.getTextInputValue("coupon_code_input").trim().toUpperCase();
    const userId = interaction.user.id;

    let basePrice = PACKAGE_PRICES[category] || 510;
    let finalPrice = basePrice;
    let discountText = "কোনো ডিসকাউন্ট কুপন ব্যবহার করা হয়নি।";

    if (couponEntered !== "SKIP") {
      const couponRef = db.ref(`coupons/${couponEntered}`);
      const couponSnap = await couponRef.once("value");

      if (couponSnap.exists()) {
        const couponData = couponSnap.val();
        if (couponData.status === "active") {
          let appliedDiscountValue = Number(couponData.couponValue || couponData.discountValue || 0);
          finalPrice = Math.max(0, basePrice - appliedDiscountValue);
          discountText = `🎉 কুপন কোড \`${couponEntered}\` অ্যাপ্লাই করা হয়েছে! পরিশোধযোগ্য মূল্য: \`${finalPrice}\` BDT`;
        }
      }
    }

    await db.ref(`pending_payments/${userId}_${category}`).set({
      targetPrice: finalPrice,
      basePrice: basePrice,
      totalPaid: 0,
      usedTxns: []
    });

    const payEmbed = new EmbedBuilder()
      .setTitle(`💳 Payment Gateway: ${category.toUpperCase()}`)
      .setDescription(`💰 **পেমেন্ট অ্যামাউন্ট:** \`${finalPrice}\` BDT\n📱 **বিকাশ/নগদ:** \`${PAYMENT_NUMBER}\`\n\n${discountText}`)
      .setColor("#9B59B6");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`submit_txn_${category}`)
        .setLabel("Submit TxnID")
        .setStyle(ButtonStyle.Primary)
    );

    return interaction.editReply({ embeds: [payEmbed], components: [row] });
  }

  // ৫. TxnID সাবমিট করা
  if (interaction.isButton() && interaction.customId.startsWith("submit_txn_")) {
    const rawCategory = interaction.customId.split("_")[2].toLowerCase();
    const category = getNormalizedCategory(rawCategory);

    const modal = new ModalBuilder()
      .setCustomId(`modal_txn_${category}`)
      .setTitle("🔒 Submit Transaction ID");

    const txnInput = new TextInputBuilder()
      .setCustomId("txn_id_input")
      .setLabel("Transaction ID (TxnID) লিখুন")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(txnInput));
    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_txn_")) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const rawCategory = interaction.customId.split("_")[2].toLowerCase();
    const category = getNormalizedCategory(rawCategory);
    const txnId = interaction.fields.getTextInputValue("txn_id_input").trim().toUpperCase();

    const successEmbed = new EmbedBuilder()
      .setTitle(`✅ Payment Verified! (${category.toUpperCase()})`)
      .setDescription(`আপনার TxnID: \`${txnId}\` সফলভাবে গ্রহণ করা হয়েছে।\n\n👉 C++ অ্যাপের অ্যাকাউন্ট তৈরি করতে নিচের **"Create Account Credentials"** বাটনে চাপুন।`)
      .setColor("#00FF00");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`open_cred_modal_${category}`)
        .setLabel("🔑 Create Account Credentials")
        .setStyle(ButtonStyle.Success)
    );

    return interaction.editReply({ embeds: [successEmbed], components: [row] });
  }

  // ৬. C++ অ্যাপ ব্যবহারের জন্য ইউজারনেম ও পাসওয়ার্ড তৈরি করার ক্রুশিয়াল মোডাল
  if (interaction.isButton() && interaction.customId.startsWith("open_cred_modal_")) {
    const rawCategory = interaction.customId.split("_")[3].toLowerCase();
    const category = getNormalizedCategory(rawCategory);

    const modal = new ModalBuilder()
      .setCustomId(`modal_create_account_${category}`)
      .setTitle("🔑 Create Your Login Credentials");

    const userValInput = new TextInputBuilder()
      .setCustomId("acc_username")
      .setLabel("ইউজারনেম (Username) লিখুন")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const passValInput = new TextInputBuilder()
      .setCustomId("acc_password")
      .setLabel("পাসওয়ার্ড (Password) লিখুন")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(userValInput),
      new ActionRowBuilder().addComponents(passValInput)
    );

    return interaction.showModal(modal);
  }

  // 🟢 🎯 ৭. ফায়ারবেসে ইউজার অ্যাকাউন্ট তৈরির সময় "username" ফিল্ড অন্তর্ভুক্ত করার মূল সমাধান
  if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_create_account_")) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const rawCategory = interaction.customId.split("_")[3].toLowerCase();
    const category = getNormalizedCategory(rawCategory);
    const usernameInput = interaction.fields.getTextInputValue("acc_username").trim();
    const passwordInput = interaction.fields.getTextInputValue("acc_password").trim();
    const userId = interaction.user.id;

    const userRef = db.ref(`users/${usernameInput}`);
    const userSnap = await userRef.once("value");

    if (userSnap.exists()) {
      return interaction.editReply("❌ **এই ইউজারনেমটি ইতোমধ্যে ব্যবহৃত হয়েছে!** অনুগ্রহ করে অন্য একটি ইউজারনেম ব্যবহার করুন।");
    }

    let daysToAdd = 7;
    if (category === "monthly") daysToAdd = 30;
    else if (category === "2_months") daysToAdd = 60;

    const expiresAtMs = Date.now() + (daysToAdd * 24 * 60 * 60 * 1000);

    // 🎯 প্রধান পরিবর্তন: C++ অ্যাপ্লিকেশনে Username যেন খালি না থাকে, তার জন্য username সেভ করা
    await userRef.set({
      username: usernameInput,    // 👈 এই ফিল্ড থাকার কারণে C++ অ্যাপ ড্যাশবোর্ডে ইউজারনেম সঠিকভাবে ডিসপ্লে করতে পারবে
      password: passwordInput,
      status: "active",
      category: category,
      discordId: userId,
      createdAt: Date.now(),
      expiresAt: expiresAtMs,
      hwid: ""                   // C++ অ্যাপে প্রথমবার লগইন করলে স্বয়ংক্রিয়ভাবে HWID বসে যাবে
    });

    await db.ref(`pending_payments/${userId}_${category}`).remove();

    const createdEmbed = new EmbedBuilder()
      .setTitle("🎉 Account Created Successfully!")
      .setDescription(
        `আপনার C++ অ্যাপ্লিকেশন অ্যাকাউন্টটি সফলভাবে তৈরি করা হয়েছে।\n\n` +
        `👤 **Username:** \`${usernameInput}\`\n` +
        `🔒 **Password:** \`${passwordInput}\`\n` +
        `⏳ **Validity:** \`${daysToAdd}\` দিন\n\n` +
        `⚠️ **সতর্কতা:** এই লগইন তথ্যাদি অন্য কারো সাথে শেয়ার করবেন না।`
      )
      .setColor("#00FF00")
      .setTimestamp();

    return interaction.editReply({ embeds: [createdEmbed] });
  }
});

// ================================================
// 🚀 Bot Startup Logic
// ================================================
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: "Security & Verification", type: ActivityType.Watching }],
    status: "online"
  });
});

if (TOKEN) {
  client.login(TOKEN).catch(err => console.error("❌ Discord Login Failed:", err));
} else {
  console.error("❌ TOKEN Environment Variable is missing!");
}
