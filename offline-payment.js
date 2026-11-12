// Offline payment request: validation + review rules.
// Side-effect free so index.js wiring and the Admin Panel stay testable.

const OFFLINE_REVIEW_OPEN_STATUSES = ["pending", "needs_staff_channel"];

const OFFLINE_REJECT_REASONS = [
  { value: "txn_not_found", label: "TxnID provider history-তে পাওয়া যায়নি" },
  { value: "amount_mismatch", label: "পাঠানো টাকার পরিমাণ মেলেনি" },
  { value: "duplicate_txn", label: "এই TxnID আগেই ব্যবহার হয়েছে" },
  { value: "old_transaction", label: "Transaction পুরোনো (checkout শুরুর আগের)" },
  { value: "wrong_provider", label: "ভুল bKash/Nagad অ্যাকাউন্টে পাঠানো হয়েছে" },
  { value: "other", label: "অন্যান্য (নোট দেখুন)" }
];

function isOpenOfflineReviewStatus(status) {
  return OFFLINE_REVIEW_OPEN_STATUSES.includes(String(status || ""));
}

// TxnID: unify case/whitespace. Accept 6-40 alphanumerics with _ or -.
function normalizeTxnId(value) {
  const text = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!text) return null;
  if (!/^[A-Z0-9_-]{6,40}$/.test(text)) return null;
  return text;
}

// Bangladeshi mobile number: 01XXXXXXXXX (11 digits) or +8801XXXXXXXXX.
function normalizeSenderNumber(value) {
  const raw = String(value || "").trim().replace(/[\s()-]/g, "");
  if (!raw) return null;
  let digits = raw.replace(/^\+?88/, "");
  if (!/^01\d{9}$/.test(digits)) return null;
  return `+88${digits}`;
}

function parseAmount(value) {
  const n = Number(String(value || "").replace(/[,\s৳]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 10_000_000) return null;
  return Math.round(n * 100) / 100;
}

// ইউজার নতুন request দিতে পারবে কি না — একসাথে সর্বোচ্চ N open, আর cooldown।
function canUserCreateOfflineRequest({ existingRequests = [], category, now, cooldownMs = 10 * 60 * 1000, maxOpen = 2 }) {
  const mine = existingRequests.filter(r => r && isOpenOfflineReviewStatus(r.status));
  const sameCategory = mine.find(r => String(r.category || "") === String(category || ""));
  if (sameCategory) return { allowed: false, reason: "duplicate_category", requestId: sameCategory.id || null };
  if (mine.length >= maxOpen) return { allowed: false, reason: "too_many_open" };
  const lastCreatedAt = mine.reduce((max, r) => Math.max(max, Number(r.createdAt) || 0), 0);
  if (lastCreatedAt > 0 && Number(now) - lastCreatedAt < cooldownMs) {
    return { allowed: false, reason: "cooldown", retryAfterMs: cooldownMs - (Number(now) - lastCreatedAt) };
  }
  return { allowed: true, reason: "ok" };
}

// চার্জ করা হবে কত — admin যত টাকা পেয়েছেন বলে approve করলেন, তার বেশি নয়।
function computeOfflineCreditAmount({ targetPrice, amountReceived, claimedAmount, allowPartialPayments = true }) {
  const target = Math.max(0, Number(targetPrice) || 0);
  const received = Number(amountReceived);
  const claimed = Number(claimedAmount);
  const basis = Number.isFinite(received) && received > 0 ? received : (Number.isFinite(claimed) && claimed > 0 ? claimed : target);
  const credit = Math.min(basis, target);
  if (credit <= 0) return { ok: false, reason: "invalid_amount" };
  if (!allowPartialPayments && credit < target) return { ok: false, reason: "partial_not_allowed", credit, target };
  return { ok: true, credit, target, fullyPaid: credit >= target };
}

function validateOfflineApproval({ request, targetPrice, amountReceived, allowPartialPayments = true, txnAlreadyUsed = false }) {
  if (!request) return { ok: false, reason: "not_found" };
  if (!isOpenOfflineReviewStatus(request.status)) return { ok: false, reason: "not_open", status: request.status };
  if (txnAlreadyUsed) return { ok: false, reason: "duplicate_txn" };
  const amount = computeOfflineCreditAmount({ targetPrice, amountReceived, claimedAmount: request.claimedAmount, allowPartialPayments });
  if (!amount.ok) return { ok: false, reason: amount.reason, target: amount.target, credit: amount.credit };
  return { ok: true, credit: amount.credit, target: amount.target, fullyPaid: amount.fullyPaid };
}

function normalizeRejectReason(code, note) {
  const known = OFFLINE_REJECT_REASONS.find(r => r.value === String(code || ""));
  const reasonCode = known ? known.value : "other";
  const reasonLabel = (known || OFFLINE_REJECT_REASONS[OFFLINE_REJECT_REASONS.length - 1]).label;
  const cleanNote = String(note || "").trim().slice(0, 300);
  return { reasonCode, reasonLabel, note: cleanNote };
}

// ইউজারকে দেখানোর জন্য reject/expire ব্যাখ্যা।
function describeOfflineOutcome(record) {
  const status = String(record?.status || "");
  if (status === "rejected") {
    const label = String(record?.rejectReasonLabel || "Admin reject করেছেন");
    const note = String(record?.reviewNote || "").trim();
    return note ? `❌ ${label} — ${note}` : `❌ ${label}`;
  }
  if (status === "expired") {
    return "⌛ Review দেওয়ার নির্ধারিত সময়ের মধ্যে request টি নিষ্পত্তি হয়নি, তাই মেয়াদ শেষ হয়েছে।";
  }
  return "";
}

module.exports = {
  OFFLINE_REVIEW_OPEN_STATUSES,
  OFFLINE_REJECT_REASONS,
  isOpenOfflineReviewStatus,
  normalizeTxnId,
  normalizeSenderNumber,
  parseAmount,
  canUserCreateOfflineRequest,
  computeOfflineCreditAmount,
  validateOfflineApproval,
  normalizeRejectReason,
  describeOfflineOutcome
};
