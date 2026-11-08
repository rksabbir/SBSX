"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { findFaqAnswer, matchKeywordRule, classifyTicketIntent, normalizeEvents, dueReminderMinutes, getDailyKey, calculateRankProgress, normalizeAutomationConfig } = require("../community-automation");

test("FAQ matching normalizes question/keywords and ignores disabled or unsafe empty entries", () => {
  const hit = findFaqAnswer("payment issue help please", [
    { question: "How to pay?", answer: "Open a ticket", keywords: ["payment", "txn"] },
    { question: "Disabled", answer: "Do not use", enabled: false },
    { question: "No answer", answer: "" }
  ]);
  assert.equal(hit.answer, "Open a ticket");
});

test("keyword rule matcher respects enabled flag and channel restrictions", () => {
  const rules = [
    { id: "one", keywords: ["price"], reply: "Price details", channelIds: ["111111111111111"] },
    { id: "two", keywords: ["price"], reply: "General pricing" }
  ];
  assert.equal(matchKeywordRule("What is the price?", rules, "222222222222222").id, "two");
  assert.equal(matchKeywordRule("What is the price?", rules, "111111111111111").id, "one");
});

test("ticket router chooses the route with the strongest keyword overlap", () => {
  const route = classifyTicketIntent("payment refund transaction failed", [
    { name: "Technical", keywords: ["crash", "error"] },
    { name: "Billing", keywords: ["payment", "transaction", "refund"] }
  ]);
  assert.equal(route.name, "Billing");
});

test("event normalizer clamps reminder configuration and returns due windows only once ready", () => {
  const [event] = normalizeEvents({ eventABC: { title: "Community Live", startsAt: 1_000_000, reminderMinutes: [15, 5, -1, 20000], enabled: true } });
  assert.equal(event.id, "eventABC");
  assert.deepEqual(dueReminderMinutes(event, 1_000_000 - 5 * 60_000), [5]);
  assert.deepEqual(dueReminderMinutes(event, 1_000_000 + 1), []);
});

test("daily analytics key uses stable UTC dates", () => {
  assert.equal(getDailyKey(Date.UTC(2026, 9, 15, 23, 59)), "2026-10-15");
});

test("rank progress computes threshold and percentage safely", () => {
  assert.deepEqual(calculateRankProgress({ xp: 25, level: 2 }, 100), { xp: 25, level: 2, needed: 200, percent: 12 });
});

test("automation config validates channel IDs and bounds lists", () => {
  const cfg = normalizeAutomationConfig({
    faq: { enabled: true, channelId: "not-an-id", entries: [{ question: "help", answer: "answer" }] },
    rules: [{ keywords: ["a", "hello"], reply: "hi" }, { type: "arbitrary-code", keywords: ["x"], reply: "unsafe" }],
    onboarding: { autoRoleIds: ["123", "123456789012345"] }
  });
  assert.equal(cfg.faq.channelId, "");
  assert.equal(cfg.faq.entries.length, 1);
  assert.equal(cfg.rules.length, 1);
  assert.deepEqual(cfg.onboarding.autoRoleIds, ["123456789012345"]);
});
