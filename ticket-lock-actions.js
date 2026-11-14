// টিকিট লক — অ্যাডমিন প্যানেল থেকে আনলক, আর টিকিট বন্ধ/মুছে গেলে অটো আনলক।
// ভিত্তি ticket-lock.js-এ, এখানে শুধু "কোন লক আনলক হবে" আর "কী রিপোর্ট হবে" ঠিক হয়।

/** লকের তালিকা থেকে একটি ইউজারের সব লক খুঁজে বের করা (userId দিয়ে বা channelId দিয়ে)। */
function findTicketLocks({ locks = {}, userId = "", channelId = "" } = {}) {
  const found = [];
  const byUser = userId ? { [String(userId)]: locks[String(userId)] || {} } : locks;
  for (const [ownerId, entries] of Object.entries(byUser || {})) {
    for (const [key, lock] of Object.entries(entries || {})) {
      if (!lock || String(lock.status || "open") !== "open") continue;
      if (channelId && String(lock.channelId || "") !== String(channelId)) continue;
      found.push({ userId: String(ownerId), key: String(key), channelId: String(lock.channelId || ""), lock });
    }
  }
  return found;
}

/** অ্যাডমিন প্যানেল থেকে আনলক করার অনুরোধ যাচাই — userId বা channelId লাগবে। */
function parseUnlockRequest(body = {}) {
  const userId = String(body.userId || "").replace(/\D/g, "");
  const channelId = String(body.channelId || "").replace(/\D/g, "");
  const reason = String(body.reason || "admin_panel_unlock").slice(0, 120);
  if (!userId && !channelId) return { ok: false, reason: "missing_target" };
  if (userId && !/^\d{15,25}$/.test(userId)) return { ok: false, reason: "invalid_user_id" };
  if (channelId && !/^\d{15,25}$/.test(channelId)) return { ok: false, reason: "invalid_channel_id" };
  return { ok: true, userId, channelId, reason };
}

/** আনলকের ফল — প্যানেলে দেখানোর জন্য। */
function describeUnlockResult({ released = 0, checked = 0, reason = "" } = {}) {
  if (released > 0) return `🔓 ${released}টি টিকিট লক আনলক হয়েছে${checked > released ? ` (${checked}টি পরীক্ষা)` : ""}।`;
  if (checked > 0) return "ℹ️ কোনো খোলা লক পাওয়া যায়নি — ইউজার ইতিমধ্যে নতুন টিকিট খুলতে পারবেন।";
  if (reason === "missing_target") return "⚠️ userId অথবা channelId দিন।";
  return "ℹ️ এই ইউজারের কোনো খোলা টিকিট লক নেই।";
}

/** টিকিট বন্ধ/মুছে যাওয়ার পর লক ছাড়ার সিদ্ধান্ত — একটাই জায়গা থেকে। */
function shouldAutoRelease({ closed = false, channelDeleted = false, reason = "" } = {}) {
  if (channelDeleted) return { release: true, reason: "channel_deleted" };
  if (closed) return { release: true, reason: reason || "closed" };
  return { release: false, reason: "" };
}

/** অ্যাডমিন প্যানেলে দেখানোর জন্য খোলা লকের সারি। */
function summarizeLocks(found = [], now = Date.now()) {
  return (found || []).map(item => ({
    userId: item.userId,
    key: item.key,
    channelId: item.channelId,
    type: String(item.key).split(":")[0] || "ticket",
    category: String(item.key).split(":").slice(1).join(":") || "",
    openedAt: Number(item.lock?.openedAt) || 0,
    ageMinutes: item.lock?.openedAt ? Math.max(0, Math.floor((now - Number(item.lock.openedAt)) / 60_000)) : 0
  }));
}

module.exports = { findTicketLocks, parseUnlockRequest, describeUnlockResult, shouldAutoRelease, summarizeLocks };
