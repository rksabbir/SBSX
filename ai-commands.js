// AKMAFIA YT — Discord app commands (slash + message context menu)।
// v1.5.70: আগে কোনো app command রেজিস্টার করা ছিল না, তাই Discord-এ "AKMAFIA YT is
// thinking…" দেখানোর পর কিছুই হতো না। এই মডিউল কমান্ডের সংজ্ঞা, ইনপুট যাচাই আর
// বাংলা হেল্প টেক্সট রাখে — সব pure data/function, তাই Discord ছাড়াই টেস্ট করা যায়।

const AI_COMMAND_NAME = "ai";
const AI_STATUS_COMMAND_NAME = "ai-status";
const AI_HELP_COMMAND_NAME = "help";
const AI_CONTEXT_COMMAND_NAME = "AI-কে জিজ্ঞাসা করুন";

// Discord-এ রেজিস্টার করার সময় এগুলোই ব্যবহার হয় (guild-scoped, তাই সাথে সাথে দেখা যায়)।
const AI_SLASH_COMMANDS = [
  {
    name: AI_COMMAND_NAME,
    description: "AKMAFIA YT AI-কে বাংলায় একটা প্রশ্ন করুন",
    options: [
      {
        type: 3, // STRING
        name: "prompt",
        description: "আপনার প্রশ্ন বা কথা (বাংলায় লিখুন)",
        required: true,
        max_length: 1200
      },
      {
        type: 3,
        name: "reply_private",
        description: "উত্তর শুধু আপনি দেখবেন কিনা (হ্যাঁ/না)",
        required: false,
        choices: [
          { name: "শুধু আমি (private)", value: "yes" },
          { name: "সবাই দেখবে (public)", value: "no" }
        ]
      }
    ]
  },
  {
    name: AI_STATUS_COMMAND_NAME,
    description: "AI কেন উত্তর দিচ্ছে না — সম্পূর্ণ ডায়াগনস্টিক দেখুন (staff)",
    options: []
  },
  {
    name: AI_HELP_COMMAND_NAME,
    description: "সব কমান্ড ও AI ব্যবহারের নিয়ম দেখুন",
    options: []
  }
];

// মেসেজে right-click → Apps → এই কমান্ড, যেটা ওই মেসেজের বিষয়ে AI-কে জিজ্ঞেস করে।
const AI_CONTEXT_COMMANDS = [
  {
    name: AI_CONTEXT_COMMAND_NAME,
    type: 3 // MESSAGE
  }
];

// Discord-এর নিজের "is thinking…" ইংরেজি লেখার বদলে সাথে সাথে এই বাংলা লেখাটা দেখানো হয়।
const AI_THINKING_TEXT = "🤖 AKMAFIA YT উত্তর সাজাচ্ছে… একটু অপেক্ষা করুন।";

const AI_HELP_TEXT = [
  "🤖 **AKMAFIA YT — কমান্ড ও ব্যবহার**",
  "",
  "**AI (কোনো প্রিফিক্স লাগে না):**",
  "• `/ai prompt:তোমার প্রশ্ন` — সরাসরি AI-কে জিজ্ঞাসা",
  "• যেকোনো মেসেজে right-click → Apps → **AI-কে জিজ্ঞাসা করুন**",
  "• AI চ্যানেলে সাধারণ মেসেজ লিখলেও নিজে থেকে উত্তর দেয়",
  "",
  "**সাধারণ কমান্ড:**",
  "`!help` — এই তালিকা · `!ai <প্রশ্ন>` — দ্রুত AI উত্তর",
  "`!aistatus` — AI কেন উত্তর দিচ্ছে না (staff)",
  "`!faq <প্রশ্ন>` · `!tickethelp <সমস্যা>` · `!suggest <আইডিয়া>`",
  "`!rank` · `!leaderboard` · `!profile` · `!roles` · `!notify on|off`",
  "",
  "**টিপস:** `/` চেপে কমান্ড খুঁজুন। AI সবসময় বাংলা লিপিতে উত্তর দেয়।"
].join("\n");

/** `/ai` কমান্ডের ইনপুট যাচাই — খালি বা অতিরিক্ত লম্বা হলে বাংলা কারণ ফেরে। */
function parseAiCommand(interaction) {
  const raw = interaction?.options?.getString?.("prompt");
  const text = String(raw || "").trim();
  if (!text) return { ok: false, reason: "empty", message: "❌ প্রশ্ন লিখুন — যেমন: `/ai prompt: আজকের দিনটা কেমন যাচ্ছে?`" };
  if (text.length > 1200) return { ok: false, reason: "too_long", message: "❌ প্রশ্নটি খুব বড় (সর্বোচ্চ ১২০০ অক্ষর)। ছোট করে আবার চেষ্টা করুন।" };
  const privateChoice = String(interaction?.options?.getString?.("reply_private") || "no").toLowerCase();
  return { ok: true, text, ephemeral: privateChoice === "yes" };
}

/** মেসেজ context-menu থেকে যে টেক্সট পাওয়া যায় সেটা যাচাই। */
function parseContextTarget(messageLike = {}) {
  const text = String(messageLike?.content || "").trim();
  if (!text) return { ok: false, reason: "empty", message: "❌ এই মেসেজে কোনো লেখা নেই — AI উত্তর দিতে পারবে না।" };
  if (text.length > 1500) return { ok: false, reason: "too_long", message: "❌ মেসেজটি খুব বড় — ছোট অংশে জিজ্ঞাসা করুন।" };
  return { ok: true, text };
}

/** টেক্সট কমান্ড: `!ai <প্রশ্ন>` এবং `!aistatus` — interface ছাড়াও কাজ করে। */
function parseTextCommand(content) {
  const value = String(content || "").trim();
  const match = /^!(ai|aistatus|aihelp)\b\s*([\s\S]*)$/i.exec(value);
  if (!match) return { ok: false, reason: "not_ai" };
  const command = match[1].toLowerCase();
  const rest = match[2].trim();
  if (command === "aistatus") return { ok: true, command: "status", text: "" };
  if (command === "aihelp") return { ok: true, command: "help", text: "" };
  if (!rest) return { ok: false, reason: "empty", command };
  if (rest.length > 1200) return { ok: false, reason: "too_long", command };
  return { ok: true, command: "ask", text: rest };
}

module.exports = {
  AI_COMMAND_NAME,
  AI_STATUS_COMMAND_NAME,
  AI_HELP_COMMAND_NAME,
  AI_CONTEXT_COMMAND_NAME,
  AI_SLASH_COMMANDS,
  AI_CONTEXT_COMMANDS,
  AI_THINKING_TEXT,
  AI_HELP_TEXT,
  parseAiCommand,
  parseContextTarget,
  parseTextCommand
};
