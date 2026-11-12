const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OFFLINE_FRAUD_REASONS,
  normalizeFraudReason,
  buildSessionRevokePatch,
  buildTxnFlagPatch,
  buildBanPlan,
  buildUnbanPlan,
  describeRevokeOutcome
} = require("../offline-payment-fraud");

const NOW = 1_700_000_000_000;

test("normalizeFraudReason falls back to other for unknown codes", () => {
  assert.equal(normalizeFraudReason("txn_not_found").reasonCode, "txn_not_found");
  const fallback = normalizeFraudReason("nonsense");
  assert.equal(fallback.reasonCode, "other");
  assert.equal(fallback.note, "");
});

test("normalizeFraudReason trims the note to 300 characters", () => {
  const result = normalizeFraudReason("other", "x".repeat(500));
  assert.equal(result.note.length, 300);
});

test("OFFLINE_FRAUD_REASONS exposes unique reason codes", () => {
  const codes = OFFLINE_FRAUD_REASONS.map(r => r.value);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(codes.includes("txn_not_found"));
});

test("buildSessionRevokePatch zeroes the credit and strips approval markers", () => {
  const session = {
    status: "offline_payment_approved",
    totalPaid: 299,
    offlinePaymentRequestId: "req1",
    usedTxns: ["OFFLINE_ADMIN_APPROVED:req1", "OFFLINE_AUTO_APPROVED:req1", "SOMETHING_ELSE"]
  };
  const patch = buildSessionRevokePatch(session, { requestId: "req1", actorId: "admin1", now: NOW });
  assert.equal(patch.totalPaid, 0);
  assert.equal(patch.status, "offline_payment_revoked");
  assert.deepEqual(patch.usedTxns, ["SOMETHING_ELSE"]);
  assert.equal(patch.offlineRevokedBy, "admin1");
});

test("buildSessionRevokePatch refuses a session that belongs to another request", () => {
  const patch = buildSessionRevokePatch({ offlinePaymentRequestId: "other" }, { requestId: "req1", actorId: "a", now: NOW });
  assert.equal(patch, undefined);
});

test("buildTxnFlagPatch keeps the record but marks it unused and flagged", () => {
  const patch = buildTxnFlagPatch({ transactionId: "A1B2C3D4E5", used: true, usedBy: "u1" },
    { txnId: "A1B2C3D4E5", userId: "u1", requestId: "req1", actorId: "admin1", now: NOW });
  assert.equal(patch.used, false);
  assert.equal(patch.usedBy, "");
  assert.equal(patch.flagged, true);
  assert.equal(patch.verificationStatus, "fake");
  assert.equal(patch.flaggedReason, "offline_payment_revoked_fake");
});

test("buildBanPlan disables every account and remembers the previous status", () => {
  const plan = buildBanPlan({
    accounts: [
      { username: "alpha", record: { status: "active", activeSessionId: "s1" } },
      { username: "beta", record: { status: "disabled" } }
    ],
    now: NOW,
    reason: "offline_payment_fraud"
  });
  assert.equal(plan.disabled, 2);
  assert.equal(plan.patches[0].patch.status, "disabled");
  assert.equal(plan.patches[0].patch.statusBeforeBan, "active");
  assert.equal(plan.patches[0].patch.activeSessionId, null);
  // already-disabled account keeps its original status so unban can restore it
  assert.equal(plan.patches[1].alreadyDisabled, true);
  assert.equal(plan.patches[1].patch.statusBeforeBan, "active");
});

test("buildBanPlan skips empty account records", () => {
  const plan = buildBanPlan({ accounts: [{ username: "empty", record: null }], now: NOW });
  assert.equal(plan.disabled, 0);
});

test("buildUnbanPlan restores the status captured before the ban", () => {
  const plan = buildUnbanPlan({
    accounts: [
      { username: "alpha", record: { status: "disabled", statusBeforeBan: "suspended" } },
      { username: "beta", record: { status: "disabled", statusBeforeBan: null } }
    ],
    now: NOW
  });
  assert.equal(plan.patches[0].patch.status, "suspended");
  assert.equal(plan.patches[1].patch.status, "active");
});

test("describeRevokeOutcome reports credit reversal, bans and strikes", () => {
  const text = describeRevokeOutcome({
    request: { id: "req1" }, creditReversed: true, accountsDisabled: 2, strikes: 1, strikeLimit: 3
  });
  assert.match(text, /req1/);
  assert.match(text, /2 টি C\+\+ account disable/);
  assert.match(text, /1\/3/);
});
