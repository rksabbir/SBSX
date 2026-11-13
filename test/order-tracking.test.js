"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  isOrderTicket,
  orderCategoryHint,
  resolveTrackingChannelId,
  findTrackingChannelByName,
  describeTrackingProblem,
  nextTrackingRecord
} = require("../order-tracking");

const ROOT = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "index.js"), "utf8");

test("only orders go to the tracking channel — plain tickets do not", () => {
  assert.equal(isOrderTicket({ type: "order", category: "premium" }), true);
  assert.equal(isOrderTicket({ type: "ticket", category: "general_support" }), false);
  assert.equal(isOrderTicket({ type: "report", category: "scam_report" }), false);
  assert.equal(isOrderTicket({ type: "customer", category: "help" }), false);
  assert.equal(isOrderTicket({ type: "", category: "general_support" }), false);
  // অর্ডার/পেমেন্ট সংক্রান্ত ক্যাটাগরি অর্ডার হিসেবেই গোনা হয়
  assert.equal(isOrderTicket({ type: "ticket", category: "payment_issue" }), true);
  assert.equal(isOrderTicket({ type: "ticket", category: "premium_order" }), true);
  assert.equal(isOrderTicket({ type: "ticket", category: "report_scam" }), false);
});

test("category hints do not fire on unrelated words", () => {
  assert.equal(orderCategoryHint("report_scam"), false);
  assert.equal(orderCategoryHint("order_checkout"), true);
  assert.equal(orderCategoryHint("preorder"), false);
});

test("a configured channel wins, the default is the fallback, and a dead id is reported", () => {
  const exists = id => id === "111111111111111111";
  assert.deepEqual(resolveTrackingChannelId({ configuredId: "", fallbackId: "111111111111111111", exists }), { channelId: "111111111111111111", source: "default" });
  // কনফিগ করা ID মৃত হলে ডিফল্টেই ফেরা হয়
  assert.deepEqual(resolveTrackingChannelId({ configuredId: "222222222222222222", fallbackId: "111111111111111111", exists }), { channelId: "111111111111111111", source: "default" });
  // দুটোই মৃত হলে স্পষ্টভাবে "missing" — তখন নাম দিয়ে খোঁজা হয়
  assert.equal(resolveTrackingChannelId({ configuredId: "222222222222222222", fallbackId: "333333333333333333", exists }).source, "missing");
  assert.equal(resolveTrackingChannelId({ configuredId: "", fallbackId: "", exists }).source, "none");
  // ডিসকর্ডের বাইরের অক্ষর বাদ পড়ে
  assert.equal(resolveTrackingChannelId({ configuredId: "<#111111111111111111>", fallbackId: "", exists }).channelId, "111111111111111111");
});

test("when the configured id is stale the channel is found by name", () => {
  const channels = [{ name: "general" }, { name: "order-tracking" }];
  assert.equal(findTrackingChannelByName(channels).name, "order-tracking");
  assert.equal(findTrackingChannelByName([{ name: "Order Tracking" }]).name, "Order Tracking");
  assert.equal(findTrackingChannelByName([{ name: "general" }]), null);
});

test("the reason a post failed is explained instead of swallowed", () => {
  assert.match(describeTrackingProblem("no_channel"), /ট্র্যাকিং চ্যানেল পাওয়া যায়নি/);
  assert.match(describeTrackingProblem("Missing Permissions"), /Send Messages/);
  assert.match(describeTrackingProblem("Missing Access"), /View Channel/);
  assert.match(describeTrackingProblem("Cannot send embeds"), /Embed Links/);
  assert.match(describeTrackingProblem("weird boom"), /weird boom/);
});

test("a tracking record keeps the newest message and a short history", () => {
  let record = nextTrackingRecord({ channelId: "c1", messageId: "m1", status: "pending", at: 1000 });
  record = nextTrackingRecord({ previous: record, channelId: "c1", messageId: "m2", status: "approved", at: 2000 });
  assert.equal(record.messageId, "m2");
  assert.equal(record.status, "approved");
  assert.deepEqual(record.messageIds, ["m1", "m2"]);
  assert.equal(record.history.length, 2);
  assert.equal(nextTrackingRecord({ previous: record, messageId: "" }), record);
});

test("index.js posts tracking through one helper, never silently", () => {
  assert.equal((source.match(/await publishOrderTracking\(/g) || []).length, 3, "approved, pending and close all use the helper");
  // ট্র্যাকিং পোস্টে আর `.catch(() => {})` দিয়ে এরর গেলা হয় না
  assert.ok(!/trackingEmbed[\s\S]{0,200}\.catch\(\(\) => \{\}\)/.test(source));
  assert.match(source, /\[order-tracking\] publish failed/);
});

test("plain tickets no longer create a tracking message", () => {
  const pendingBlock = source.slice(source.indexOf("// ⚠️ শুধু অর্ডারই ট্র্যাকিং চ্যানেলে যায়"));
  assert.match(pendingBlock.slice(0, 600), /if \(orderTracking\.isOrderTicket\(\{ type, category \}\)\)/);
});

test("the tracking channel id can be overridden from the environment", () => {
  assert.match(source, /process\.env\.ORDER_TRACKING_CHANNEL_ID/);
  const env = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  assert.match(env, /ORDER_TRACKING_CHANNEL_ID=/);
});

test("closing a ticket updates the remembered message even without a local log", () => {
  assert.match(source, /lookupOrderTrackingRecord\(interaction\.channel\.id\)/);
  assert.match(source, /existingMessageId: trackingMessageId/);
});
