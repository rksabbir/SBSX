const test = require("node:test");
const assert = require("node:assert");

const {
  findTicketLocks,
  parseUnlockRequest,
  describeUnlockResult,
  shouldAutoRelease,
  summarizeLocks
} = require("../ticket-lock-actions");

const NOW = 1_800_000_000_000;
const locks = {
  "111111111111111111": {
    "ticket:order": { channelId: "222222222222222222", status: "open", openedAt: NOW - 30 * 60_000, type: "ticket", category: "order" },
    "report:bug": { channelId: "333333333333333333", status: "open", openedAt: NOW - 5 * 60_000, type: "report", category: "bug" }
  },
  "444444444444444444": {
    "ticket:order": { channelId: "555555555555555555", status: "closed", openedAt: NOW - 60 * 60_000 }
  }
};

test("ticket locks: find by user returns only that user's open locks", () => {
  const found = findTicketLocks({ locks, userId: "111111111111111111" });
  assert.equal(found.length, 2);
  assert.deepEqual(found.map(item => item.key).sort(), ["report:bug", "ticket:order"]);
  assert.equal(findTicketLocks({ locks, userId: "444444444444444444" }).length, 0);
});

test("ticket locks: find by channel returns exactly one lock", () => {
  const found = findTicketLocks({ locks, channelId: "333333333333333333" });
  assert.equal(found.length, 1);
  assert.equal(found[0].userId, "111111111111111111");
  assert.equal(found[0].key, "report:bug");
  assert.equal(findTicketLocks({ locks, channelId: "999999999999999999" }).length, 0);
});

test("ticket locks: all open locks are found when no filter is given", () => {
  assert.equal(findTicketLocks({ locks }).length, 2);
  assert.equal(findTicketLocks({ locks: {} }).length, 0);
});

test("ticket locks: unlock request parsing validates targets", () => {
  assert.equal(parseUnlockRequest({}).reason, "missing_target");
  assert.equal(parseUnlockRequest({ userId: "abc" }).reason, "missing_target");
  assert.equal(parseUnlockRequest({ userId: "123" }).reason, "invalid_user_id");
  assert.equal(parseUnlockRequest({ channelId: "123" }).reason, "invalid_channel_id");
  const ok = parseUnlockRequest({ userId: "111111111111111111", reason: "user_asked" });
  assert.equal(ok.ok, true);
  assert.equal(ok.userId, "111111111111111111");
  assert.equal(ok.reason, "user_asked");
  assert.equal(parseUnlockRequest({ channelId: "222222222222222222" }).ok, true);
});

test("ticket locks: unlock result messages differ for released / none-found", () => {
  assert.match(describeUnlockResult({ released: 2, checked: 2 }), /2টি টিকিট লক আনলক/);
  assert.match(describeUnlockResult({ released: 0, checked: 1 }), /কোনো খোলা লক পাওয়া যায়নি/);
  assert.match(describeUnlockResult({ released: 0, checked: 0 }), /কোনো খোলা টিকিট লক নেই/);
  assert.match(describeUnlockResult({ released: 0, checked: 0, reason: "missing_target" }), /userId অথবা channelId/);
});

test("ticket locks: closing a ticket auto-releases the lock", () => {
  assert.deepEqual(shouldAutoRelease({ closed: true }), { release: true, reason: "closed" });
  assert.deepEqual(shouldAutoRelease({ closed: true, reason: "solved" }), { release: true, reason: "solved" });
  assert.deepEqual(shouldAutoRelease({ channelDeleted: true }), { release: true, reason: "channel_deleted" });
  assert.equal(shouldAutoRelease({ closed: false }).release, false);
  assert.equal(shouldAutoRelease({}).release, false);
});

test("ticket locks: summary rows expose category and age in minutes", () => {
  const found = findTicketLocks({ locks, userId: "111111111111111111" });
  const rows = summarizeLocks(found, NOW);
  const orderRow = rows.find(row => row.key === "ticket:order");
  assert.equal(orderRow.type, "ticket");
  assert.equal(orderRow.category, "order");
  assert.equal(orderRow.ageMinutes, 30);
  assert.equal(rows.find(row => row.key === "report:bug").ageMinutes, 5);
  assert.equal(summarizeLocks([], NOW).length, 0);
});

test("ticket locks: unlock flow releases every matching lock", () => {
  const parsed = parseUnlockRequest({ userId: "111111111111111111" });
  const found = findTicketLocks({ locks, userId: parsed.userId });
  const released = found.filter(item => item.lock.status === "open").length;
  assert.equal(released, 2);
  assert.match(describeUnlockResult({ released, checked: found.length }), /2/);
});
