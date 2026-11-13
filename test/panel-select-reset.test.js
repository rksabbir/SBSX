"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.js"), "utf8");

test("panel dropdown selection is reset after a pick so it never stays selected", () => {
  assert.match(index, /async function resetPanelSelectMenu\(/);
  // panel message is re-rendered with the same builder that produced it
  for (const builder of ["getDynamicTicketPanel", "getDynamicReportPanel", "getDynamicCustomerPanel", "getDynamicPaymentPanel"]) {
    assert.ok(index.includes(builder), `missing ${builder}`);
  }
  const fn = index.slice(index.indexOf("async function resetPanelSelectMenu("), index.indexOf("async function resetPanelSelectMenu(") + 1600);
  assert.match(fn, /interaction\.message\.edit\(payload\)/);
  assert.match(fn, /select_product_ticket: getDynamicTicketPanel/);
  assert.match(fn, /select_buy_category: getDynamicPaymentPanel/);
});

test("resetting the dropdown also clears the 1TIME KEY panel message", () => {
  const fn = index.slice(index.indexOf("async function resetPanelSelectMenu("), index.indexOf("async function resetPanelSelectMenu(") + 2000);
  assert.match(fn, /select_key_category/);
});

test("reset is throttled per panel message so heavy traffic does not spam edits", () => {
  const fn = index.slice(index.indexOf("async function resetPanelSelectMenu("), index.indexOf("async function resetPanelSelectMenu(") + 2000);
  assert.match(fn, /panelMenuResetAt/);
  assert.match(fn, /now - last < 2000/);
  assert.match(fn, /panelMenuResetAt\.delete/);
});

test("the reset hook only targets panel dropdowns and runs before the main handler", () => {
  assert.match(index, /\/\^select_\(buy\|product\|report\|customer\|key\)_\/\.test\(interaction\.customId\)/);
  const reset = index.indexOf("resetPanelSelectMenu(interaction)");
  const mainHandler = index.indexOf("// 🌟 ড্রপডাউন সিলেকশন হ্যান্ডলার");
  assert.ok(reset > 0 && mainHandler > reset, "reset must run before the selection handler");
  // it must not block the ephemeral reply — no await on the reset call
  assert.doesNotMatch(index.slice(reset - 80, reset + 20), /await resetPanelSelectMenu/);
});

test("cooldown replies are awaited, so Discord does not time the component out", () => {
  const pos = index.indexOf("if (cooldowns.has(cooldownKey)");
  assert.ok(pos > 0);
  const slice = index.slice(pos, pos + 600);
  assert.match(slice, /await interaction\.reply/);
  assert.doesNotMatch(slice, /return interaction\.reply\(\{ content: "⚠️ অনুরোধটি ইতোমধ্যে/);
});

test("misleading cooldown copy is replaced with a clear message", () => {
  assert.ok(!index.includes("অনুরোধটি ইতোমধ্যে নেওয়া হয়েছে। কয়েক সেকেন্ড অপেক্ষা করুন।"));
  assert.match(index, /আপনার আগের ক্লিকটি এখনো প্রক্রিয়া হচ্ছে/);
});
