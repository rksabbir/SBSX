const test = require("node:test");
const assert = require("node:assert/strict");
const {
  claimReaderCheckState,
  finishReaderCheckState,
  releaseReaderCheckState
} = require("../reader-check-state");

test("only one fresh select_provider session can be claimed", () => {
  const base = { status: "select_provider", createdAt: 1000 };
  const claimed = claimReaderCheckState(base, "bkash", "token-a", 5000, 60000);
  assert.equal(claimed.status, "checking_reader");
  assert.equal(claimed.readerCheckToken, "token-a");
  assert.equal(claimReaderCheckState(claimed, "nagad", "token-b", 6001, 60000), undefined);
});

test("stale or tokenless legacy checking_reader status can be recovered", () => {
  const stale = { status: "checking_reader", lastReaderCheckAt: 1000, provider: "bkash" };
  const recovered = claimReaderCheckState(stale, "nagad", "token-new", 70001, 60000);
  assert.equal(recovered.status, "checking_reader");
  assert.equal(recovered.provider, "nagad");
  assert.equal(recovered.readerCheckToken, "token-new");
});

test("fresh concurrent check cannot be reclaimed", () => {
  const fresh = { status: "checking_reader", readerCheckStartedAt: 9000, readerCheckToken: "owner", provider: "bkash" };
  assert.equal(claimReaderCheckState(fresh, "nagad", "intruder", 10000, 60000), undefined);
});

test("only the owner token can commit the result", () => {
  const current = { status: "checking_reader", readerCheckToken: "owner", readerCheckStartedAt: 1000, provider: "bkash" };
  assert.equal(finishReaderCheckState(current, "other", { status: "awaiting_txn" }), undefined);
  const done = finishReaderCheckState(current, "owner", { status: "reader_offline" });
  assert.equal(done.status, "reader_offline");
  assert.equal("readerCheckToken" in done, false);
  assert.equal("readerCheckStartedAt" in done, false);
});

test("failed owner releases the session to select_provider", () => {
  const current = { status: "checking_reader", readerCheckToken: "owner", readerCheckStartedAt: 1000, provider: "bkash" };
  const released = releaseReaderCheckState(current, "owner", 2000);
  assert.equal(released.status, "select_provider");
  assert.equal(released.provider, null);
  assert.equal(released.lastReaderCheckErrorAt, 2000);
  assert.equal("readerCheckToken" in released, false);
  assert.equal("readerCheckStartedAt" in released, false);
  assert.equal(releaseReaderCheckState(current, "other", 2000), undefined);
});
