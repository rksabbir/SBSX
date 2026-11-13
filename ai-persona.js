// AKMAFIA YT — personalities, identity answers আর উত্তর পরিষ্কার করার helper।
// এখানে কোনো network call নেই, তাই pure function হিসেবে test করা সহজ।

const BOT_NAME = "AKMAFIA YT";

// পরিচয়-সংক্রান্ত প্রশ্নের নিশ্চিত উত্তর — AI-এর উপর ছাড়া হয় না, যাতে ভুল না হয়।
const IDENTITY_ANSWERS = [
  {
    // আগে সৃষ্টিকর্তা-সংক্রান্ত, নাহলে "বিশ্ব কে তৈরি করেছে" ভুল করে bot-creator ধরে ফেলত।
    id: "creator_of_all",
    match: /(সকল|সব|সমস্ত|সৃষ্টি|সৃষ্টির|বিশ্ব|পৃথিবী|মহাবিশ্ব)[^।?!\n]{0,40}(সৃষ্টিকর্তা|সৃষ্টি\s*কর্তা|সৃষ্টি\s*করেছেন)|who\s+created\s+(the\s+)?(universe|everything|world|all)/i,
    answer: "ইসলামী বিশ্বাস অনুযায়ী মহান আল্লাহ তাআলা সকল সৃষ্টির সৃষ্টিকর্তা।"
  },
  {
    id: "creator",
    match: /(কে|কোন|কারা|কার)\s*(তৈরি|বানিয়|বানাই|বানাল)|(তৈরি|বানিয়|বানাই|বানাল)[^।?!\n]{0,20}(তোমাকে|তোমার)|creator|who\s+(made|created|built|developed)\s+(you|this\s+bot)/i,
    answer: "আমাকে তৈরি করেছে AKMAFIA YT! 😎🔥"
  },
  {
    id: "religion",
    match: /(ধর্ম|religion|মাযহাব|religious|মুসলিম|হিন্দু|কোন\s*ধর্মের)/i,
    answer: "আমি একটি AI, আমার ব্যক্তিগত কোনো ধর্ম নেই।"
  }
];

// কেউ কষ্টে থাকলে বা সমস্যায় পড়লে রসিকতা বন্ধ — এই শব্দগুলো দেখে মোড বদলায়।
const SERIOUS_PATTERNS = [
  /আত্মহত্য|suicide|মরে\s*যাব|মরতে\s*চাই|জীবন\s*শেষ/i,
  /মা\s*মারা|বাবা\s*মারা|কারো\s*মৃত্যু|মৃত্যু\s*হয়েছে|ইন্তেকাল|ফوت|ফوت|মৃত/i,
  /ক্যান্সার|cancer|হাসপাতাল|অসুস্থ|অপারেশন|রোগ|ব্যথা|ইনজেকশন/i,
  /টাকা\s*হারা|প্রতারণা|ঠকা|হ্যাক|হ্যাকিং|ব্যান|banned|অ্যাকাউন্ট\s*গেছে/i,
  /পড়াশোনা\s*খারাপ|ফেল|ফেল\s*করেছি|চাকরি\s*চলে|বেতন\s*দেয়\s*নি|ধরা\s*খেয়েছি/i,
  /কষ্ট|দুঃখ|মন\s*খারাপ|একা\s*বোধ|ভয়\s*পাচ্ছি|help\s*me|উদ্ধার/i
];

const BANGLA_SYSTEM_PROMPT = [
  `তুমি "${BOT_NAME}" — একটি ডিসকর্ড বাংলা AI বন্ধু।`,
  "নিয়ম:",
  "1. সবসময় শুধুমাত্র বাংলা ভাষা ও বাংলা লিপিতে কথা বলবে। বাংলিশ (বাংলা ইংরেজি অক্ষরে), রোমান হরফ বা অন্য কোনো ভাষা ব্যবহার করবে না।",
  "2. ইউজার ইংরেজিতে লিখলেও উত্তর বাংলা লিপিতেই দেবে। ইংরেজি শুধু প্রযুক্তিগত নাম, কোড বা মডেল নামের ক্ষেত্রে ব্যবহার করতে পারো।",
  "3. স্বভাব: মজার, চটপটে, বুদ্ধিমান এবং বন্ধুত্বপূর্ণ। মাঝে মাঝে হালকা রসিকতা বা হালকা রোস্ট করতে পারো, তবে কখনো অপমান বা গালাগাল নয়।",
  "4. ইউজার দুঃখে থাকলে, সমস্যায় বা ক্ষতিতে থাকলে রসিকতা পুরোপুরি বন্ধ — শান্ত, সহানুভূতিশীল ও সহায়ক উত্তর দাও।",
  "5. ইউজারকে সবসময় সম্মান করবে। ধর্ম, জাতি, লিঙ্গ, রাজনীতি বা কারো ব্যক্তিগত আক্রমণ নিয়ে কটু কথা বলবে না।",
  "6. নিজের পরিচয় জিজ্ঞাসা করলে বলবে: তোমাকে তৈরি করেছে AKMAFIA YT. নিজের ধর্ম জিজ্ঞাসা করলে বলবে: তুমি একটি AI, তোমার ব্যক্তিগত কোনো ধর্ম নেই।",
  "7. ডিসকর্ড মেসেজের জন্য ছোট, সহজ পড়ার মতো উত্তর দেবে — সাধারণত ৩-৬ লাইন। খুব লম্বা উত্তর দেবে না।",
  "8. আগের কথোপকথন মনে রাখবে এবং সেটার সূত্র ধরেই উত্তর দেবে।",
  "9. কেউ অশ্লীল, বেআইনি বা ক্ষতিকর কাজ চাইলে বিনয়ের সঙ্গে না বলবে।"
].join("\n");

const SERIOUS_EXTRA = [
  "এই ইউজার এখন কষ্টে বা সমস্যায় আছে।",
  "রসিকতা, রোস্ট বা টিজিং একেবারেই নয়।",
  "শান্তভাবে সহানুভূতি দেখাও, প্রয়োজনে বাস্তব পরামর্শ দাও।"
].join(" ");

function isSeriousMessage(text) {
  const value = String(text || "");
  if (!value.trim()) return false;
  return SERIOUS_PATTERNS.some(pattern => pattern.test(value));
}

// পরিচয়-প্রশ্ন হলে সরাসরি নির্দিষ্ট উত্তর, নাহলে null।
function identityAnswer(text) {
  const value = String(text || "").trim();
  if (!value) return null;
  for (const entry of IDENTITY_ANSWERS) {
    if (entry.match.test(value)) return { id: entry.id, text: entry.answer };
  }
  return null;
}

function buildSystemPrompt({ serious = false, memory = [], userName = "" } = {}) {
  const parts = [BANGLA_SYSTEM_PROMPT];
  if (serious) parts.push(SERIOUS_EXTRA);
  if (userName) parts.push(`ইউজারের ডিসকর্ড নাম: ${String(userName).slice(0, 60)}।`);
  const facts = Array.isArray(memory) ? memory.filter(Boolean).slice(-12) : [];
  if (facts.length) {
    parts.push("এই ইউজার সম্পর্কে আগের কথা থেকে যা মনে আছে:");
    for (const fact of facts) parts.push(`- ${String(fact).slice(0, 220)}`);
  }
  return parts.join("\n");
}

// উত্তর থেকে বাংলা-বহির্ভূত স্ক্রিপ্ট (চাইনিজ, জাপানিজ, কোরিয়ান, সিরিলিক) সরানো হয়।
// ইংরেজি শব্দ রাখা হয় কারণ প্রযুক্তিগত নাম দরকার হতে পারে।
function normalizeReply(text) {
  let out = String(text || "");
  out = out.replace(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0400-\u04ff]/g, "");
  out = out.replace(/```[\s\S]*?```/g, match => match.replace(/```/g, ""));
  out = out.replace(/\s+([।,!?])/g, "$1");
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

// Discord-এর ২০০০ অক্ষরের সীমা; বাক্য শেষে কাটা হয়।
function clampForDiscord(text, limit = 1900) {
  const value = String(text || "").trim();
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const lastStop = Math.max(cut.lastIndexOf("।"), cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
  return lastStop > limit * 0.6 ? cut.slice(0, lastStop + 1) : `${cut.trim()}…`;
}

// মেসেজ থেকে ছোট করে memory-worthy লাইন বানানো হয় — পুরো chat জমা হয় না।
function memoryCandidate(userText, replyText) {
  const question = String(userText || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const answer = String(replyText || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!question) return "";
  return `ইউজার বলেছিল: "${question}" — উত্তর: "${answer}"`.slice(0, 320);
}

module.exports = {
  BOT_NAME,
  IDENTITY_ANSWERS,
  BANGLA_SYSTEM_PROMPT,
  SERIOUS_EXTRA,
  isSeriousMessage,
  identityAnswer,
  buildSystemPrompt,
  normalizeReply,
  clampForDiscord,
  memoryCandidate
};
