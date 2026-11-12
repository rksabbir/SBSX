const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isOpenOfflineReviewStatus,
  normalizeTxnId,
  normalizeSenderNumber,
  parseAmount,
  canUserCreateOfflineRequest,
  computeOfflineCreditAmount,
  validateOfflineApproval,
  normalizeRejectReason,
  describeOfflineOutcome
} = require("../offline-payment");

test("TxnID is normalised to upper case and whitespace is stripped", () => {
  assert.equal(normalizeTxnId("  ab12cd34ef "), "AB12CD34EF");
  assert.equal(normalizeTxnId("AB 12 CD 34 EF"), "AB12CD34EF");
});

test("invalid or too short TxnIDs are rejected", () => {
  assert.equal(normalizeTxnId(""), null);
  assert.equal(normalizeTxnId("AB1"), null);
  assert.equal(normalizeTxnId("ab12cd!@#"), null);
  assert.equal(normalizeTxnId("A".repeat(41)), null);
});

test("sender numbers accept local and +880 formats, one canonical form out", () => {
  assert.equal(normalizeSenderNumber("01712345678"), "+8801712345678");
  assert.equal(normalizeSenderNumber("+8801712345678"), "+8801712345678");
  assert.equal(normalizeSenderNumber("880 1712-345678"), "+8801712345678");
});

test("non-Bangladeshi or malformed sender numbers are rejected", () => {
  assert.equal(normalizeSenderNumber("0171234567"), null);
  assert.equal(normalizeSenderNumber("12345"), null);
  assert.equal(normalizeSenderNumber(""), null);
});

test("amount parsing accepts taka and rejects nonsense", () => {
  assert.equal(parseAmount("1,500"), 1500);
  assert.equal(parseAmount("৳299.5"), 299.5);
  assert.equal(parseAmount("0"), null);
  assert.equal(parseAmount("-5"), null);
  assert.equal(parseAmount("abc"), null);
});

test("a user cannot open two requests for the same package", () => {
  const result = canUserCreateOfflineRequest({
    existingRequests: [{ id: "r1", category: "weekly", status: "pending", createdAt: 1000 }],
    category: "weekly", now: 1000 + 60 * 60 * 1000
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "duplicate_category");
  assert.equal(result.requestId, "r1");
});

test("a user with too many open requests is blocked", () => {
  const result = canUserCreateOfflineRequest({
    existingRequests: [
      { id: "r1", category: "weekly", status: "pending", createdAt: 1 },
      { id: "r2", category: "monthly", status: "needs_staff_channel", createdAt: 2 }
    ],
    category: "two_months", now: 10 * 60 * 60 * 1000
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "too_many_open");
});

test("cooldown blocks rapid re-requests", () => {
  const result = canUserCreateOfflineRequest({
    existingRequests: [{ id: "r1", category: "weekly", status: "rejected", createdAt: 1000 }],
    category: "monthly", now: 1000 + 60_000, cooldownMs: 10 * 60_000
  });
  // rejected requests are not open, so only cooldown between open ones applies -> allowed
  assert.equal(result.allowed, true);
});

test("an unrelated paid/cancelled request never blocks a new request", () => {
  const result = canUserCreateOfflineRequest({
    existingRequests: [{ id: "r1", category: "weekly", status: "approved", createdAt: 1 }],
    category: "weekly", now: 999999
  });
  assert.equal(result.allowed, true);
});

test("credit uses the amount the admin actually verified", () => {
  const r = computeOfflineCreditAmount({ targetPrice: 1000, amountReceived: 400, claimedAmount: 1000 });
  assert.equal(r.ok, true);
  assert.equal(r.credit, 400);
  assert.equal(r.fullyPaid, false);
});

test("credit is capped at the package price", () => {
  const r = computeOfflineCreditAmount({ targetPrice: 500, amountReceived: 900 });
  assert.equal(r.credit, 500);
  assert.equal(r.fullyPaid, true);
});

test("credit falls back to the user's claimed amount when admin leaves it blank", () => {
  const r = computeOfflineCreditAmount({ targetPrice: 500, amountReceived: null, claimedAmount: 300 });
  assert.equal(r.credit, 300);
});

test("partial payment is refused when the admin disabled it", () => {
  const r = computeOfflineCreditAmount({ targetPrice: 1000, amountReceived: 400, allowPartialPayments: false });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "partial_not_allowed");
  assert.equal(r.credit, 400);
});

test("approval validation reports duplicate TxnID instead of crediting twice", () => {
  const r = validateOfflineApproval({
    request: { status: "pending", claimedAmount: 500 },
    targetPrice: 500, amountReceived: 500, txnAlreadyUsed: true
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "duplicate_txn");
});

test("approval validation refuses an already reviewed request", () => {
  const r = validateOfflineApproval({ request: { status: "approved" }, targetPrice: 500, amountReceived: 500 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_open");
});

test("approval validation allows a fresh pending request", () => {
  const r = validateOfflineApproval({ request: { status: "pending", claimedAmount: 500 }, targetPrice: 500, amountReceived: 500 });
  assert.equal(r.ok, true);
  assert.equal(r.credit, 500);
  assert.equal(r.fullyPaid, true);
});

test("reject reasons map to known codes with a Bengali label", () => {
  const known = normalizeRejectReason("duplicate_txn", "used before");
  assert.equal(known.reasonCode, "duplicate_txn");
  assert.match(known.reasonLabel, /আগেই ব্যবহার/);
  assert.equal(known.note, "used before");
  const unknown = normalizeRejectReason("something_else", "x".repeat(400));
  assert.equal(unknown.reasonCode, "other");
  assert.equal(unknown.note.length, 300);
});

test("user-facing outcome text explains rejection and expiry", () => {
  assert.match(describeOfflineOutcome({ status: "rejected", rejectReasonLabel: "TxnID পাওয়া যায়নি", reviewNote: "আবার চেষ্টা করুন" }), /আবার চেষ্টা করুন/);
  assert.match(describeOfflineOutcome({ status: "expired" }), /মেয়াদ শেষ/);
  assert.equal(describeOfflineOutcome({ status: "pending" }), "");
});

test("open statuses are exactly pending and needs_staff_channel", () => {
  assert.equal(isOpenOfflineReviewStatus("pending"), true);
  assert.equal(isOpenOfflineReviewStatus("needs_staff_channel"), true);
  assert.equal(isOpenOfflineReviewStatus("approved"), false);
});
