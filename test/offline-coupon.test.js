const test = require("node:test");
const assert = require("node:assert");

const {
  evaluateOfflineCoupon,
  describeOfflineCoupon,
  reconcileOfflineAmount,
  couponConsumptionFor,
  couponPatchForConsumption,
  OFFLINE_COUPON_MESSAGES
} = require("../offline-coupon");

const NOW = 1_800_000_000_000;
const activeCoupon = { couponCode: "RK50OFF", userId: "u1", status: "active", remainingValue: 100, expiresAt: NOW + 86_400_000 };

test("offline coupon: valid coupon computes discount and payable", () => {
  const result = evaluateOfflineCoupon({ coupon: activeCoupon, userId: "u1", basePrice: 300, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.discount, 100);
  assert.equal(result.payable, 200);
  assert.equal(result.fullyCovered, false);
  assert.equal(result.code, "RK50OFF");
  assert.equal(result.percentOff, 33);
});

test("offline coupon: full-value coupon marks fullyCovered", () => {
  const result = evaluateOfflineCoupon({
    coupon: { ...activeCoupon, remainingValue: 300 }, userId: "u1", basePrice: 300, now: NOW
  });
  assert.equal(result.ok, true);
  assert.equal(result.payable, 0);
  assert.equal(result.fullyCovered, true);
});

test("offline coupon: rejects other owner / used / expired / inactive / empty", () => {
  const base = { basePrice: 300, now: NOW };
  assert.equal(evaluateOfflineCoupon({ coupon: activeCoupon, userId: "u2", ...base }).reason, "not_owner");
  assert.equal(evaluateOfflineCoupon({ coupon: { ...activeCoupon, status: "used" }, userId: "u1", ...base }).reason, "used");
  assert.equal(evaluateOfflineCoupon({ coupon: { ...activeCoupon, expiresAt: NOW - 1 }, userId: "u1", ...base }).reason, "expired");
  assert.equal(evaluateOfflineCoupon({ coupon: { ...activeCoupon, status: "reserved" }, userId: "u1", ...base }).reason, "inactive");
  assert.equal(evaluateOfflineCoupon({ coupon: { ...activeCoupon, remainingValue: 0 }, userId: "u1", ...base }).reason, "empty");
  assert.equal(evaluateOfflineCoupon({ coupon: null, userId: "u1", ...base }).reason, "not_found");
  assert.equal(evaluateOfflineCoupon({ coupon: activeCoupon, userId: "u1", basePrice: 0, now: NOW }).reason, "invalid_price");
});

test("offline coupon: describeOfflineCoupon covers success and failures in Bangla", () => {
  const ok = evaluateOfflineCoupon({ coupon: activeCoupon, userId: "u1", basePrice: 300, now: NOW });
  const text = describeOfflineCoupon(ok);
  assert.match(text, /100/);
  assert.match(text, /200/);
  assert.match(describeOfflineCoupon({ ok: false, reason: "not_owner" }), /আপনার অ্যাকাউন্টের নয়/);
  assert.equal(OFFLINE_COUPON_MESSAGES.used.includes("ব্যবহার"), true);
});

test("offline coupon: amount reconciliation approves full / partial / short", () => {
  const full = reconcileOfflineAmount({ claimedAmount: 200, packagePrice: 300, couponDiscount: 100 });
  assert.equal(full.payable, 200);
  assert.equal(full.covered, true);
  assert.equal(full.action, "approve_full");

  const partial = reconcileOfflineAmount({ claimedAmount: 120, packagePrice: 300, couponDiscount: 100 });
  assert.equal(partial.shortfall, 80);
  assert.equal(partial.action, "approve_partial");

  const strict = reconcileOfflineAmount({ claimedAmount: 120, packagePrice: 300, couponDiscount: 100, allowPartial: false });
  assert.equal(strict.action, "reject_short");
});

test("offline coupon: excess amount is reported, zero payable always approves", () => {
  const excess = reconcileOfflineAmount({ claimedAmount: 250, packagePrice: 300, couponDiscount: 100 });
  assert.equal(excess.excess, 50);
  const free = reconcileOfflineAmount({ claimedAmount: 0, packagePrice: 300, couponDiscount: 300 });
  assert.equal(free.payable, 0);
  assert.equal(free.covered, true);
  assert.equal(free.action, "approve_full");
});

test("offline coupon: consumption math matches checkout discount", () => {
  const consume = couponConsumptionFor({ packagePrice: 300, claimedAmount: 200, couponDiscount: 100 });
  assert.equal(consume.spend, 100);
  assert.equal(consume.payable, 200);
  assert.equal(consume.paid, 200);
  assert.equal(consume.fullyCovered, false);
});

test("offline coupon: patch marks coupon used once balance reaches zero", () => {
  const patch = couponPatchForConsumption({ remainingValue: 100, consumedValue: 0 }, 100, NOW);
  assert.equal(patch.remainingValue, 0);
  assert.equal(patch.status, "used");
  assert.equal(patch.consumedValue, 100);
  const partialPatch = couponPatchForConsumption({ remainingValue: 500, consumedValue: 0 }, 200, NOW);
  assert.equal(partialPatch.remainingValue, 300);
  assert.equal(partialPatch.status, "active");
});
