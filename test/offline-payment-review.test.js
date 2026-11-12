const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isOpenOfflineReviewStatus,
  getOfflineReviewDecision,
  shouldExpireOfflineRequest,
  describeReviewer,
  describeReviewedAt
} = require("../offline-payment-review");

const HOUR = 60 * 60 * 1000;
const DEADLINE = 24 * HOUR;
const NOW = 100 * HOUR;

test("pending and needs_staff_channel requests stay reviewable", () => {
  assert.equal(isOpenOfflineReviewStatus("pending"), true);
  assert.equal(isOpenOfflineReviewStatus("needs_staff_channel"), true);
  assert.equal(isOpenOfflineReviewStatus("approved"), false);
  assert.equal(isOpenOfflineReviewStatus("expired"), false);
});

test("any admin can approve a pending request", () => {
  const decision = getOfflineReviewDecision({ action: "approve", request: { status: "pending" } });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "review_now");
});

test("any admin can reject a pending request", () => {
  const decision = getOfflineReviewDecision({ action: "reject", request: { status: "needs_staff_channel" } });
  assert.equal(decision.allowed, true);
});

test("re-approving an already approved request self-heals instead of erroring", () => {
  const decision = getOfflineReviewDecision({ action: "approve", request: { status: "approved" } });
  assert.equal(decision.allowed, true);
  assert.equal(decision.idempotent, true);
  assert.equal(decision.reason, "already_approved_self_heal");
});

test("a second admin cannot reject something another admin already approved", () => {
  const decision = getOfflineReviewDecision({ action: "reject", request: { status: "approved" } });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "already_approved");
});

test("approve is blocked when the request was already rejected", () => {
  const decision = getOfflineReviewDecision({ action: "approve", request: { status: "rejected" } });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "already_rejected_blocks_approve");
});

test("expired requests cannot be reviewed in either direction", () => {
  assert.equal(getOfflineReviewDecision({ action: "approve", request: { status: "expired" } }).reason, "expired");
  assert.equal(getOfflineReviewDecision({ action: "reject", request: { status: "expired" } }).allowed, false);
});

test("a missing request reports not_found instead of a generic race message", () => {
  assert.equal(getOfflineReviewDecision({ action: "approve", request: null }).reason, "not_found");
});

test("unexpected statuses are surfaced verbatim", () => {
  const decision = getOfflineReviewDecision({ action: "approve", request: { status: "weird_state" } });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "unexpected_status");
  assert.equal(decision.status, "weird_state");
});

test("an expired session expires the linked pending request", () => {
  const request = { status: "pending", createdAt: NOW - HOUR };
  assert.equal(shouldExpireOfflineRequest({ request, session: { status: "expired" }, now: NOW, deadlineMs: DEADLINE }), true);
});

test("a pending request inside the deadline with a live session is kept", () => {
  const request = { status: "pending", createdAt: NOW - HOUR };
  const session = { status: "offline_payment_requested", totalPaid: 0 };
  assert.equal(shouldExpireOfflineRequest({ request, session, now: NOW, deadlineMs: DEADLINE }), false);
});

test("a pending request past the deadline with no session expires", () => {
  const request = { status: "pending", createdAt: NOW - 25 * HOUR };
  assert.equal(shouldExpireOfflineRequest({ request, session: null, now: NOW, deadlineMs: DEADLINE }), true);
});

test("an already approved request is never auto expired", () => {
  const request = { status: "approved", createdAt: NOW - 48 * HOUR };
  assert.equal(shouldExpireOfflineRequest({ request, session: { status: "expired" }, now: NOW, deadlineMs: DEADLINE }), false);
});

test("reviewer name and timestamp are rendered for other admins", () => {
  const record = { reviewedBy: "111", reviewedAt: 1700000000000 };
  assert.equal(describeReviewer(record), "<@111>");
  assert.equal(describeReviewedAt(record), " (<t:1700000000:R>)");
  assert.equal(describeReviewer({}), "অন্য একজন Admin/Staff");
});
