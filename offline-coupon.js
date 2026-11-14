// অফলাইন (bKash/Nagad manual) পেমেন্টেও কুপন — অর্ডারের পরিমাণ থেকে ছাড় বাদ দিয়ে
// ঠিক কত টাকা পাঠাতে হবে তা হিসাব করা হয়, আর approve করার সময় কুপন ব্যালেন্স খরচ হয়।

const MAX_COUPON_PERCENT = 100;

/** অফলাইন পেমেন্টের জন্য কুপন যাচাই। */
function evaluateOfflineCoupon({ coupon = null, userId = "", basePrice = 0, now = Date.now() } = {}) {
  const price = Number(basePrice) || 0;
  if (price <= 0) return { ok: false, reason: "invalid_price" };
  if (!coupon) return { ok: false, reason: "not_found" };
  if (String(coupon.userId || "") !== String(userId || "")) return { ok: false, reason: "not_owner" };
  const status = String(coupon.status || "");
  if (status === "used") return { ok: false, reason: "used" };
  if (status === "expired") return { ok: false, reason: "expired" };
  if (status !== "active") return { ok: false, reason: "inactive" };
  if (coupon.expiresAt && Number(coupon.expiresAt) < Number(now)) return { ok: false, reason: "expired" };
  const balance = Number(coupon.remainingValue ?? coupon.couponValue ?? coupon.discountValue ?? 0);
  if (!Number.isFinite(balance) || balance <= 0) return { ok: false, reason: "empty" };

  const discount = Math.min(price, Math.round(balance * 100) / 100);
  const payable = Math.max(0, Math.round((price - discount) * 100) / 100);
  return {
    ok: true,
    code: String(coupon.couponCode || coupon.code || ""),
    discount,
    payable,
    fullyCovered: payable <= 0,
    percentOff: price > 0 ? Math.min(MAX_COUPON_PERCENT, Math.round((discount / price) * 100)) : 0
  };
}

const OFFLINE_COUPON_MESSAGES = {
  not_found: "⚠️ এই কুপন কোড পাওয়া যায়নি।",
  not_owner: "❌ এই কুপন আপনার অ্যাকাউন্টের নয়।",
  used: "❌ কুপনটি আগেই ব্যবহার করা হয়েছে।",
  expired: "⌛ কুপনের মেয়াদ শেষ।",
  inactive: "⚠️ কুপনটি এখন সক্রিয় নয়।",
  empty: "⚠️ কুপনে আর ছাড়ের টাকা নেই।",
  invalid_price: "⚠️ প্যাকেজের দাম ঠিক নেই।"
};

function describeOfflineCoupon(result) {
  if (!result?.ok) return OFFLINE_COUPON_MESSAGES[result?.reason] || "⚠️ কুপন প্রয়োগ করা যায়নি।";
  if (result.fullyCovered) {
    return `🎉 কুপন \`${result.code}\` পুরো ${result.discount} ৳ ঢেকে দিয়েছে — **এই প্যাকেজে আর টাকা পাঠাতে হবে না।**`;
  }
  return `🎟️ কুপন \`${result.code}\` প্রয়োগ হয়েছে — **${result.discount} ৳ ছাড় (${result.percentOff}%)**।\n` +
    `💳 এখন offline-এ পাঠাতে হবে: **${result.payable} ৳**`;
}

/** offline request-এর টাকা যাচাই: ব্যবহারকারী যত বলেছে, প্যাকেজের দাম, আর কুপনের ছাড়। */
function reconcileOfflineAmount({ claimedAmount = 0, packagePrice = 0, couponDiscount = 0, allowPartial = true } = {}) {
  const price = Math.max(0, Number(packagePrice) || 0);
  const claimed = Math.max(0, Number(claimedAmount) || 0);
  const discount = Math.max(0, Math.min(price, Number(couponDiscount) || 0));
  const payable = Math.max(0, Math.round((price - discount) * 100) / 100);
  const covered = claimed >= payable - 0.009;
  const shortfall = Math.max(0, Math.round((payable - claimed) * 100) / 100);
  return {
    payable,
    claimed,
    covered: covered || payable === 0,
    excess: Math.max(0, Math.round((claimed - payable) * 100) / 100),
    shortfall,
    // আংশিক পেমেন্ট অনুমোদিত হলে approve করা যাবে, নাহলে পুরো টাকা লাগবে।
    action: payable === 0 || covered ? "approve_full" : (allowPartial ? "approve_partial" : "reject_short")
  };
}

/** approve করার সময় কুপন থেকে কত খরচ হবে — চেকআউটে যে ছাড় ধরা হয়েছিল সেটাই খরচ হয়
 *  (অনলাইন checkout-ও ঠিক এভাবেই appliedDiscount consume করে)। */
function couponConsumptionFor({ packagePrice = 0, claimedAmount = 0, couponDiscount = 0 } = {}) {
  const price = Math.max(0, Number(packagePrice) || 0);
  const claimed = Math.max(0, Number(claimedAmount) || 0);
  const discount = Math.max(0, Math.min(price, Number(couponDiscount) || 0));
  const payable = Math.max(0, Math.round((price - discount) * 100) / 100);
  return {
    spend: Math.round(discount * 100) / 100,
    payable,
    paid: Math.min(claimed, payable),
    fullyCovered: payable <= 0
  };
}

function couponPatchForConsumption(previous, spend, at = Date.now()) {
  const balance = Number(previous?.remainingValue ?? previous?.couponValue ?? previous?.discountValue ?? 0) || 0;
  const remaining = Math.max(0, Math.round((balance - Math.max(0, Number(spend) || 0)) * 100) / 100);
  return {
    remainingValue: remaining,
    status: remaining <= 0 ? "used" : "active",
    consumedValue: Math.round(((Number(previous?.consumedValue) || 0) + Math.max(0, Number(spend) || 0)) * 100) / 100,
    lastUsedAt: Number(at) || Date.now()
  };
}

module.exports = {
  evaluateOfflineCoupon,
  describeOfflineCoupon,
  reconcileOfflineAmount,
  couponConsumptionFor,
  couponPatchForConsumption,
  OFFLINE_COUPON_MESSAGES
};
