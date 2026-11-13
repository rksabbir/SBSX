// অর্ডার ট্র্যাকিং — কোন টিকিট ট্র্যাকিং চ্যানেলে যাবে, কোন চ্যানেলে পোস্ট হবে,
// আর ব্যর্থ হলে কী বলবে; সব এক জায়গায় (Discord ছাড়াই টেস্ট করা যায়)।

// শুধু অর্ডারই ট্র্যাকিং চ্যানেলে যায় — সাধারণ ticket/report/customer নয়।
// (v1.5.67 পর্যন্ত সব ধরনের টিকিটই যেত, তাই ট্র্যাকিং চ্যানেল অপ্রয়োজনীয় মেসেজে ভরে যেত।)
const ORDER_TYPES = ["order"];

function isOrderTicket({ type = "", category = "", order = false } = {}) {
  if (order) return true;
  const kind = String(type || "").trim().toLowerCase();
  if (ORDER_TYPES.includes(kind)) return true;
  const label = String(category || "").trim().toLowerCase();
  // পেমেন্ট/মেম্বারশিপ সংক্রান্ত ক্যাটাগরি (order_checkout, premium_order ইত্যাদি)
  if (kind.startsWith("order")) return true;
  return Boolean(label) && orderCategoryHint(label);
}

function orderCategoryHint(label) {
  return /(^|[_\-\s])(order|orders|payment|payments|checkout|purchase|premium)([_\-\s]|$)/.test(String(label || ""));
}

/** ট্র্যাকিং চ্যানেল কোনটা — কনফিগ > হার্ডকোড > নাম খোঁজা > none */
function resolveTrackingChannelId({ configuredId = "", fallbackId = "", exists = () => true } = {}) {
  const clean = value => String(value || "").replace(/\D/g, "");
  const candidates = [configuredId, fallbackId].map(clean).filter(Boolean);
  for (const id of candidates) {
    if (exists(id)) return { channelId: id, source: id === clean(configuredId) ? "config" : "default" };
  }
  return { channelId: "", source: candidates.length ? "missing" : "none" };
}

/** নাম দিয়ে চ্যানেল খোঁজা — কনফিগের ID ভুল হলে ফলব্যাক। */
function findTrackingChannelByName(channels = [], names = ["order-tracking", "order tracking", "order-tracking-logs", "orderlogs"]) {
  const wanted = names.map(name => String(name || "").toLowerCase());
  for (const channel of channels || []) {
    const name = String(channel?.name || "").toLowerCase();
    if (!name) continue;
    if (wanted.includes(name)) return channel;
  }
  return null;
}

/** ট্র্যাকিং চ্যানেল নেই/পাঠানো যায়নি — ছোট বাংলা নোট (টিকিটেই দেখানো হয়) */
function describeTrackingProblem(reason = "") {
  const text = String(reason || "");
  if (!text || text === "no_channel") return "⚠️ ট্র্যাকিং চ্যানেল পাওয়া যায়নি — অ্যাডমিনকে জানান (order-tracking চ্যানেল/ID দেখুন)।";
  if (/missing permissions|50013/i.test(text)) return "⚠️ ট্র্যাকিং চ্যানেলে পাঠানো যায়নি — Bot-এর **Send Messages** অনুমতি নেই।";
  if (/missing access|50001/i.test(text)) return "⚠️ ট্র্যাকিং চ্যানেলে ঢোকার অনুমতি নেই — Bot-কে **View Channel** দিন।";
  if (/embed/i.test(text)) return "⚠️ ট্র্যাকিং চ্যানেলে পাঠানো যায়নি — Bot-এর **Embed Links** অনুমতি নেই।";
  return `⚠️ ট্র্যাকিং চ্যানেলে পোস্ট করা যায়নি (${text.slice(0, 120)})।`;
}

/** একই অর্ডার বারবার পোস্ট না হওয়ার জন্য মেসেজ আইডি রাখা */
function nextTrackingRecord({ previous = null, channelId = "", messageId = "", status = "pending", at = Date.now() } = {}) {
  if (!messageId) return previous || null;
  const history = Array.isArray(previous?.history) ? previous.history.slice(-9) : [];
  history.push({ status: String(status || "pending"), messageId: String(messageId), at: Number(at) || Date.now() });
  return {
    channelId: String(channelId || previous?.channelId || ""),
    messageId: String(messageId),
    status: String(status || previous?.status || "pending"),
    updatedAt: Number(at) || Date.now(),
    // আগের মেসেজগুলোও মনে রাখা হয়, যাতে একই অর্ডারের পুরোনো পোস্ট আপডেট করা যায়।
    messageIds: [...new Set([...(previous?.messageIds || []), String(messageId)])].slice(-10),
    history: history.slice(-10)
  };
}

module.exports = {
  isOrderTicket,
  orderCategoryHint,
  resolveTrackingChannelId,
  findTrackingChannelByName,
  describeTrackingProblem,
  nextTrackingRecord
};
