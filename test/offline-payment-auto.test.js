const test = require("node:test");
const assert = require("node:assert/strict");
const {
  findReaderEventByTxnId,
  evaluateReaderMatch,
  evaluateStrikeGate,
  nextStrikeState,
  describeAutoApproval
} = require("../offline-payment-auto");

const NOW = 1_700_000_000_000;

function baseRequest(overrides = {}) {
  return {
    id: "req1",
    discordUserId: "111222333444555666",
    category: "weekly",
    provider: "bkash",
    amount: 299,
    claimedAmount: 299,
    txnId: "A1B2C3D4E5",
    status: "pending",
    createdAt: NOW - 5 * 60 * 1000,
    checkoutKey: "111222333444555666_weekly",
    ...overrides
  };
}

function readerEvent(overrides = {}) {
  return {
    transactionId: "A1B2C3D4E5",
    provider: "bkash",
    amount: 299,
    verificationStatus: "pending_review",
    capturedAt: NOW - 4 * 60 * 1000,
    ...overrides
  };
}

function snapshots(event = readerEvent()) {
  return [{ uid: "reader1", events: { [event.transactionId || "k1"]: event } }];
}

test("findReaderEventByTxnId finds a matching event case-insensitively", () => {
  const found = findReaderEventByTxnId({ readerSnapshots: snapshots(readerEvent({ transactionId: "a1b2c3d4e5" })), txnId: "A1B2C3D4E5" });
  assert.equal(found.found, true);
  assert.equal(found.match.uid, "reader1");
});

test("findReaderEventByTxnId reports missing txnid and missing event", () => {
  assert.equal(findReaderEventByTxnId({ readerSnapshots: [], txnId: "" }).reason, "missing_txnid");
  assert.equal(findReaderEventByTxnId({ readerSnapshots: snapshots(), txnId: "ZZZZZZ99" }).reason, "reader_event_not_found");
});

test("evaluateReaderMatch approves when txn, provider and amount all line up", () => {
  const request = baseRequest();
  const match = findReaderEventByTxnId({ readerSnapshots: snapshots(), txnId: request.txnId });
  const result = evaluateReaderMatch({ request, readerMatch: match, session: { targetPrice: 299 }, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "reader_verified");
  assert.equal(result.credit, 299);
  assert.equal(result.fullyPaid, true);
});

test("evaluateReaderMatch refuses when reader saw a different amount than the user claimed", () => {
  const request = baseRequest({ claimedAmount: 500 });
  const match = findReaderEventByTxnId({ readerSnapshots: snapshots(readerEvent({ amount: 200 })), txnId: request.txnId });
  const result = evaluateReaderMatch({ request, readerMatch: match, session: {}, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "claimed_vs_reader_mismatch");
});

test("evaluateReaderMatch refuses provider mismatch", () => {
  const request = baseRequest({ provider: "nagad" });
  const match = findReaderEventByTxnId({ readerSnapshots: snapshots(readerEvent({ provider: "bkash" })), txnId: request.txnId });
  const result = evaluateReaderMatch({ request, readerMatch: match, session: {}, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "provider_mismatch");
});

test("evaluateReaderMatch refuses reader events flagged needs_manual_review", () => {
  const request = baseRequest();
  const event = readerEvent({ verificationStatus: "needs_manual_review" });
  const match = findReaderEventByTxnId({ readerSnapshots: snapshots(event), txnId: request.txnId });
  const result = evaluateReaderMatch({ request, readerMatch: match, session: {}, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "reader_needs_manual_review");
});

test("evaluateReaderMatch refuses an old transaction reused as a fresh payment", () => {
  const request = baseRequest();
  const event = readerEvent({ capturedAt: NOW - 48 * 60 * 60 * 1000 });
  const match = findReaderEventByTxnId({ readerSnapshots: snapshots(event), txnId: request.txnId });
  const result = evaluateReaderMatch({ request, readerMatch: match, session: {}, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "reader_event_too_old");
});

test("evaluateReaderMatch caps credit at the package price on overpayment", () => {
  const request = baseRequest({ amount: 299, claimedAmount: 500 });
  const match = findReaderEventByTxnId({ readerSnapshots: snapshots(readerEvent({ amount: 500 })), txnId: request.txnId });
  const result = evaluateReaderMatch({ request, readerMatch: match, session: { targetPrice: 299 }, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.credit, 299);
});

test("evaluateReaderMatch refuses partial payment when partials are disabled", () => {
  const request = baseRequest({ amount: 500, claimedAmount: 200 });
  const match = findReaderEventByTxnId({ readerSnapshots: snapshots(readerEvent({ amount: 200 })), txnId: request.txnId });
  const result = evaluateReaderMatch({ request, readerMatch: match, session: { targetPrice: 500 }, now: NOW, allowPartialPayments: false });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "partial_not_allowed");
});

test("evaluateReaderMatch never re-approves an already settled request", () => {
  for (const status of ["approved", "auto_approved", "rejected", "expired", "revoked_fake"]) {
    const request = baseRequest({ status });
    const match = findReaderEventByTxnId({ readerSnapshots: snapshots(), txnId: request.txnId });
    const result = evaluateReaderMatch({ request, readerMatch: match, session: {}, now: NOW });
    assert.equal(result.ok, false, `status ${status} must not auto approve`);
  }
});

test("evaluateStrikeGate blocks at the limit and reports remaining strikes", () => {
  assert.deepEqual(evaluateStrikeGate({ strikes: { count: 1 }, maxStrikes: 3 }),
    { blocked: false, count: 1, limit: 3, remaining: 2 });
  const blocked = evaluateStrikeGate({ strikes: { count: 3 }, maxStrikes: 3 });
  assert.equal(blocked.blocked, true);
  assert.equal(evaluateStrikeGate({}).blocked, false);
});

test("nextStrikeState increments and keeps a bounded history", () => {
  const next = nextStrikeState({ count: 2, history: [] }, { reason: "txn_not_found", requestId: "req9", actorId: "admin1", now: NOW });
  assert.equal(next.count, 3);
  assert.equal(next.lastReason, "txn_not_found");
  assert.equal(next.history.length, 1);
  assert.equal(next.history[0].requestId, "req9");
});

test("describeAutoApproval mentions credit and reader amount", () => {
  const text = describeAutoApproval({ approvedAmount: 299, readerVerifiedAmount: 299 });
  assert.match(text, /299/);
  assert.match(text, /Reader/);
});
