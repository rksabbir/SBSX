const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ticketLockKey,
  normalizeTicketCategory,
  normalizeTicketType,
  describeTicketType,
  describeTicketCategory,
  buildTicketLockRecord,
  evaluateTicketOpenGate,
  buildTicketReleasePatch,
  shouldReleaseStaleLock,
  describeTicketLockBlock
} = require("../ticket-lock");

const NOW = 1_700_000_000_000;

test("lock key separates type and category", () => {
  assert.equal(ticketLockKey("ticket", "general_support"), "ticket:general_support");
  // একই ক্যাটাগরির ভিন্ন ধরন আলাদা lock
  assert.notEqual(ticketLockKey("ticket", "billing"), ticketLockKey("report", "billing"));
});

test("category and type inputs are normalized", () => {
  assert.equal(normalizeTicketCategory("General Support"), "general_support");
  assert.equal(normalizeTicketCategory(""), "general");
  assert.equal(normalizeTicketType("TICKET"), "ticket");
  assert.equal(normalizeTicketType("weird"), "ticket");
  assert.equal(normalizeTicketType("report"), "report");
});

test("labels are readable in Bengali-facing messages", () => {
  assert.equal(describeTicketType("report"), "Report");
  assert.equal(describeTicketCategory("general_support"), "General Support");
  assert.equal(describeTicketCategory("2_months"), "2 Months");
});

test("buildTicketLockRecord stamps an open lock", () => {
  const lock = buildTicketLockRecord({ channelId: "123", category: "Billing", type: "ticket", ownerId: "u1", now: NOW });
  assert.equal(lock.status, "open");
  assert.equal(lock.channelId, "123");
  assert.equal(lock.category, "billing");
  assert.equal(lock.openedAt, NOW);
});

test("no lock means the user may open a ticket", () => {
  assert.deepEqual(evaluateTicketOpenGate({ lock: null, now: NOW }), { allowed: true, reason: "no_lock" });
});

test("an open lock blocks a second ticket in the same category", () => {
  const gate = evaluateTicketOpenGate({
    lock: { status: "open", channelId: "999", category: "general_support", type: "ticket", openedAt: NOW - 1000 },
    now: NOW
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, "same_category_open");
  assert.equal(gate.channelId, "999");
});

test("a closed lock allows a new ticket once the cooldown elapsed", () => {
  const gate = evaluateTicketOpenGate({
    lock: { status: "closed", releasedAt: NOW - 10 * 60 * 1000, category: "billing" },
    now: NOW,
    cooldownMs: 5 * 60 * 1000
  });
  assert.equal(gate.allowed, true);
  assert.equal(gate.reason, "cooldown_elapsed");
});

test("a closed lock keeps the user waiting during the cooldown", () => {
  const gate = evaluateTicketOpenGate({
    lock: { status: "closed", releasedAt: NOW - 60 * 1000, category: "billing" },
    now: NOW,
    cooldownMs: 5 * 60 * 1000
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, "reopen_cooldown");
  assert.equal(gate.retryAfterMs, 4 * 60 * 1000);
});

test("release patch closes the lock and records the reason", () => {
  const patch = buildTicketReleasePatch({ status: "open", channelId: "1" }, { now: NOW, reason: "channel_deleted", closedBy: "u9" });
  assert.equal(patch.status, "closed");
  assert.equal(patch.releasedAt, NOW);
  assert.equal(patch.releasedReason, "channel_deleted");
  assert.equal(patch.closedBy, "u9");
  assert.equal(buildTicketReleasePatch(null, { now: NOW }), null);
});

test("stale locks are detected when the channel is gone or too old", () => {
  const base = { status: "open", openedAt: NOW - 1000 };
  assert.equal(shouldReleaseStaleLock({ lock: base, channelExists: false, now: NOW }), true);
  assert.equal(shouldReleaseStaleLock({ lock: base, channelExists: true, now: NOW }), false);
  assert.equal(shouldReleaseStaleLock({
    lock: { status: "open", openedAt: NOW - 30 * 24 * 60 * 60 * 1000 }, channelExists: true, now: NOW
  }), true);
  assert.equal(shouldReleaseStaleLock({ lock: { status: "closed", openedAt: NOW - 1000 }, channelExists: false, now: NOW }), false);
});

test("block copy names the open ticket and the category", () => {
  const text = describeTicketLockBlock({
    allowed: false, reason: "same_category_open", channelId: "555", type: "ticket", category: "general_support"
  });
  assert.match(text, /<#555>/);
  assert.match(text, /General Support/);
  assert.match(text, /একই ক্যাটাগরিতে একাধিক টিকিট খোলা যায় না/);
});

test("cooldown copy rounds the wait up to whole minutes", () => {
  const text = describeTicketLockBlock({
    allowed: false, reason: "reopen_cooldown", retryAfterMs: 90 * 1000, type: "report", category: "spam"
  });
  assert.match(text, /2 মিনিট/);
  assert.equal(describeTicketLockBlock({ allowed: true }), "");
});
