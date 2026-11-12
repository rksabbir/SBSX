// Reader-assisted auto approval rules for offline payments.
// Side-effect free: index.js wiring, the Admin Panel and the unit tests all share these.

const AUTO_APPROVE_BLOCKED_STATUSES = [
  "approved", "approved_but_session_changed", "approved_but_txn_duplicate",
  "auto_approved", "rejected", "expired", "revoked_fake"
];

// Reader event টা "প্রমাণ" হিসেবে ব্যবহারযোগ্য কি না।
// Reader app `verificationStatus` হিসেবে "pending_review" বা "needs_manual_review" লেখে।
const READER_EVENT_TRUSTED_STATUSES = ["pending_review", "verified"];
const READER_EVENT_MANUAL_STATUSES = ["needs_manual_review"];

function normalizeReaderEventKey(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

// reader_events/{uid}/{eventKey} পুরোটা স্ক্যান করে TxnID খোঁজে।
// index.js-এর findTrustedReaderEvent()-এর মতোই, কিন্তু এখানে side-effect ছাড়া pure রাখা হয়েছে
// যাতে auto-approve সিদ্ধান্তটা টেস্ট করা যায়।
function findReaderEventByTxnId({ readerSnapshots = [], txnId }) {
  const wanted = normalizeReaderEventKey(txnId);
  if (!wanted) return { found: false, reason: "missing_txnid" };
  const candidates = [];
  for (const snapshot of readerSnapshots) {
    const uid = String(snapshot?.uid || "");
    const events = snapshot?.events || {};
    for (const [eventKey, event] of Object.entries(events)) {
      if (!event || typeof event !== "object") continue;
      const eventTxn = normalizeReaderEventKey(event.transactionId || eventKey);
      if (eventTxn !== wanted) continue;
      candidates.push({ uid, eventKey, event });
    }
  }
  if (!candidates.length) return { found: false, reason: "reader_event_not_found" };
  // সবচেয়ে নতুন event টা বেছে নেওয়া হয় (একই TxnID দুইবার এলে)।
  candidates.sort((a, b) => Number(b.event.capturedAt || b.event.notificationPostedAt || 0)
    - Number(a.event.capturedAt || a.event.notificationPostedAt || 0));
  return { found: true, match: candidates[0], duplicates: Math.max(0, candidates.length - 1) };
}

// TxnID + provider + amount + সময় — চারটাই মিলতে হবে, নাহলে auto approve হবে না।
function evaluateReaderMatch({
  request,
  readerMatch,
  session,
  now,
  allowPartialPayments = true
}) {
  if (!request) return { ok: false, reason: "not_found" };
  const status = String(request.status || "");
  if (AUTO_APPROVE_BLOCKED_STATUSES.includes(status)) {
    return { ok: false, reason: "not_open", status };
  }
  if (status !== "pending" && status !== "needs_staff_channel") {
    return { ok: false, reason: "unexpected_status", status };
  }
  if (!readerMatch || !readerMatch.found) {
    return { ok: false, reason: "reader_event_not_found" };
  }
  const event = readerMatch.match.event || {};
  const requestProvider = String(request.provider || "").toLowerCase();
  const eventProvider = String(event.provider || "").toLowerCase();
  if (!eventProvider) return { ok: false, reason: "reader_provider_missing" };
  if (eventProvider !== requestProvider) return { ok: false, reason: "provider_mismatch", expected: requestProvider, got: eventProvider };

  const verificationStatus = String(event.verificationStatus || "");
  if (READER_EVENT_MANUAL_STATUSES.includes(verificationStatus)) {
    return { ok: false, reason: "reader_needs_manual_review", verificationStatus };
  }
  if (!READER_EVENT_TRUSTED_STATUSES.includes(verificationStatus)) {
    return { ok: false, reason: "reader_event_untrusted", verificationStatus };
  }

  const eventAmount = Number(event.amount);
  if (!Number.isFinite(eventAmount) || eventAmount <= 0) return { ok: false, reason: "reader_amount_missing" };

  // Transaction checkout শুরুর পরে (বা সবচেয়ে বেশি ৬ ঘণ্টা আগে) আসতে হবে — পুরোনো TxnID দিয়ে ফাঁকি বন্ধ।
  const capturedAt = Number(event.capturedAt || event.notificationPostedAt || 0);
  const checkoutStartedAt = Number(request.createdAt || session?.createdAt || 0);
  if (capturedAt > 0 && checkoutStartedAt > 0) {
    const lookbackMs = 6 * 60 * 60 * 1000;
    if (capturedAt < checkoutStartedAt - lookbackMs) {
      return { ok: false, reason: "reader_event_too_old" };
    }
    if (capturedAt > Number(now) + 5 * 60 * 1000) {
      return { ok: false, reason: "reader_event_clock_skew" };
    }
  }

  const target = Math.max(0, Number(request.amount) || Number(session?.targetPrice) || 0);
  const claimed = Number(request.claimedAmount);
  if (!Number.isFinite(claimed) || claimed <= 0) return { ok: false, reason: "claimed_amount_missing" };

  // ইউজার যত টাকা "পাঠিয়েছি" বলেছে আর Reader যত দেখেছে — দুইটাই মিলতে হবে।
  const tolerance = Math.max(1, Math.round(target * 0.01));
  if (Math.abs(claimed - eventAmount) > tolerance) {
    return { ok: false, reason: "claimed_vs_reader_mismatch", claimed, readerAmount: eventAmount, tolerance };
  }
  if (eventAmount + tolerance < target && allowPartialPayments === false) {
    return { ok: false, reason: "partial_not_allowed", readerAmount: eventAmount, target };
  }
  // Reader যা দেখেছে তার বেশি credit নয়, আর প্যাকেজের দামের বেশি নয়।
  const credit = Math.min(eventAmount, target);
  if (credit <= 0) return { ok: false, reason: "invalid_amount", credit, target };
  return {
    ok: true,
    reason: "reader_verified",
    credit,
    target,
    fullyPaid: credit + tolerance >= target,
    readerUid: String(readerMatch.match.uid || ""),
    readerEventKey: String(readerMatch.match.eventKey || ""),
    readerAmount: eventAmount,
    capturedAt
  };
}

// strike সংখ্যা থেকে ইউজারের নতুন offline request দেওয়ার অধিকার।
function evaluateStrikeGate({ strikes, maxStrikes = 3 } = {}) {
  const count = Math.max(0, Number(strikes?.count) || 0);
  const limit = Math.max(1, Number(maxStrikes) || 3);
  if (count >= limit) return { blocked: true, count, limit, reason: "strike_limit_reached" };
  return { blocked: false, count, limit, remaining: limit - count };
}

function nextStrikeState(current, { reason, requestId, actorId, now }) {
  const count = Math.max(0, Number(current?.count) || 0) + 1;
  const history = Array.isArray(current?.history) ? current.history.slice(-19) : [];
  history.push({
    at: Number(now) || Date.now(),
    reason: String(reason || "fake_payment").slice(0, 120),
    requestId: String(requestId || ""),
    actorId: String(actorId || "")
  });
  return {
    count,
    updatedAt: Number(now) || Date.now(),
    lastReason: String(reason || "fake_payment").slice(0, 120),
    lastRequestId: String(requestId || ""),
    history
  };
}

function describeAutoApproval(record) {
  const credit = Number(record?.approvedAmount) || 0;
  const readerAmount = Number(record?.readerVerifiedAmount) || 0;
  return `🤖 Reader-verified auto approval — credit **${credit} BDT**` +
    (readerAmount > 0 ? ` (Reader দেখেছে ${readerAmount} BDT)` : "");
}

module.exports = {
  AUTO_APPROVE_BLOCKED_STATUSES,
  READER_EVENT_TRUSTED_STATUSES,
  READER_EVENT_MANUAL_STATUSES,
  normalizeReaderEventKey,
  findReaderEventByTxnId,
  evaluateReaderMatch,
  evaluateStrikeGate,
  nextStrikeState,
  describeAutoApproval
};
