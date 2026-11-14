// Ticket lock rules: এক ইউজারের একই ক্যাটাগরিতে একটির বেশি খোলা টিকিট নয়।
// Side-effect free — index.js শুধু এখানকার সিদ্ধান্ত অনুযায়ী Firebase/Discord-এ কাজ করে।

const TICKET_TYPES = ["ticket", "report", "customer"];

// লকের key: ধরন + ক্যাটাগরি। যেমন `ticket:general_support`
function normalizeTicketCategory(category) {
  return String(category || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 60) || "general";
}

function normalizeTicketType(type) {
  const value = String(type || "").trim().toLowerCase();
  return TICKET_TYPES.includes(value) ? value : "ticket";
}

function ticketLockKey(type, category) {
  return `${normalizeTicketType(type)}:${normalizeTicketCategory(category)}`;
}

function describeTicketType(type) {
  const value = normalizeTicketType(type);
  if (value === "report") return "Report";
  if (value === "customer") return "Customer";
  return "Ticket";
}

// ইউজারকে দেখানোর জন্য ক্যাটাগরির নাম
function describeTicketCategory(category) {
  const value = normalizeTicketCategory(category);
  return value.split("_").filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || "General";
}

function buildTicketLockRecord({ channelId, category, type, ownerId, now }) {
  return {
    channelId: String(channelId || ""),
    category: normalizeTicketCategory(category),
    type: normalizeTicketType(type),
    ownerId: String(ownerId || ""),
    status: "open",
    openedAt: Number(now) || Date.now(),
    updatedAt: Number(now) || Date.now()
  };
}

// নতুন টিকিট খোলা যাবে কি না।
// lock: open_tickets/{guild}/{user}/{key} — না থাকলে undefined/null
// cooldownMs: টিকিট বন্ধ হওয়ার পর কতক্ষণ অপেক্ষা করতে হবে
function evaluateTicketOpenGate({ lock, now, cooldownMs = 5 * 60 * 1000 }) {
  if (!lock || typeof lock !== "object") return { allowed: true, reason: "no_lock" };
  const status = String(lock.status || "open");
  const channelId = String(lock.channelId || "");
  if (status === "open") {
    return {
      allowed: false,
      reason: "same_category_open",
      channelId,
      openedAt: Number(lock.openedAt) || 0,
      category: String(lock.category || "")
    };
  }
  const releasedAt = Number(lock.releasedAt) || 0;
  const remaining = releasedAt > 0 ? Number(cooldownMs) - (Number(now) - releasedAt) : 0;
  if (remaining > 0) {
    return {
      allowed: false,
      reason: "reopen_cooldown",
      channelId,
      releasedAt,
      retryAfterMs: remaining,
      category: String(lock.category || "")
    };
  }
  return { allowed: true, reason: "cooldown_elapsed", channelId };
}

// লক ছাড়ার রেকর্ড — status closed রাখা হয় যাতে cooldown হিসাব করা যায়।
function buildTicketReleasePatch(current, { now, reason, closedBy }) {
  if (!current || typeof current !== "object") return null;
  return {
    ...current,
    status: "closed",
    releasedAt: Number(now) || Date.now(),
    releasedReason: String(reason || "closed").slice(0, 60),
    closedBy: String(closedBy || "").slice(0, 40),
    updatedAt: Number(now) || Date.now()
  };
}

// পুরোনো/মৃত লক — চ্যানেল আর নেই অথবা অনেক পুরোনো। এগুলো bot নিজে ছেড়ে দেয়।
function shouldReleaseStaleLock({ lock, channelExists, now, maxAgeMs = 7 * 24 * 60 * 60 * 1000 }) {
  if (!lock || typeof lock !== "object") return false;
  if (String(lock.status || "open") !== "open") return false;
  if (channelExists === false) return true;
  const openedAt = Number(lock.openedAt) || 0;
  if (openedAt > 0 && Number(now) - openedAt > Number(maxAgeMs)) return true;
  return false;
}

// ইউজারকে দেখানোর বার্তা
function describeTicketLockBlock(gate) {
  if (!gate || gate.allowed) return "";
  const label = `${describeTicketType(gate.type || "ticket")} · ${describeTicketCategory(gate.category)}`;
  if (gate.reason === "same_category_open") {
    const channel = gate.channelId ? `<#${gate.channelId}>` : "একটি টিকিট";
    return `🎫 আপনার ইতিমধ্যে একটি **${label}** খোলা আছে: ${channel}।\n` +
      `একই ক্যাটাগরিতে একাধিক টিকিট খোলা যায় না। ওই টিকিট বন্ধ হলে আবার খুলতে পারবেন।\n` +
      `টিকিটে সরাসরি মেসেজ দিলেই আমাদের স্টাফ দেখতে পাবেন।`;
  }
  if (gate.reason === "channel_missing" || gate.reason === "channel_never_created") {
    return `🎫 ওই ক্যাটাগরির পুরোনো টিকিটটি ডিলিট হয়েই গেছে — লক ছেড়ে দেওয়া হচ্ছে। আবার বাটনে চাপ দিন, নতুন টিকিট তৈরি হবে।`;
  }
  if (gate.reason === "reopen_cooldown") {
    const minutes = Math.max(1, Math.ceil((Number(gate.retryAfterMs) || 0) / 60000));
    return `⏳ আপনার **${label}** টিকিট কিছুক্ষণ আগেই বন্ধ হয়েছে।\n` +
      `বারবার টিকিট খোলা ঠেকাতে ${minutes} মিনিট পর আবার চেষ্টা করুন।`;
  }
  return "";
}

module.exports = {
  TICKET_TYPES,
  normalizeTicketType,
  normalizeTicketCategory,
  ticketLockKey,
  describeTicketType,
  describeTicketCategory,
  buildTicketLockRecord,
  evaluateTicketOpenGate,
  buildTicketReleasePatch,
  shouldReleaseStaleLock,
  describeTicketLockBlock
};
