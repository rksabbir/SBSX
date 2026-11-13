"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.js"), "utf8");

// index.js বুট হলে Discord login-এ চলে যায়, তাই helper-গুলো এখানে আলাদা করে রিভিউ করা হয়।
function extractFunction(name) {
  const start = index.indexOf(`function ${name}(`);
  assert.ok(start > 0, `missing ${name}`);
  // brute force: ফাংশনের balanced braces বের করা
  const braceStart = index.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < index.length; i++) {
    if (index[i] === "{") depth++;
    else if (index[i] === "}") {
      depth--;
      if (depth === 0) return index.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${name}`);
}

const normalizeSrc = extractFunction("normalizePanelOptions");
const normalizePanelOptions = new Function(`${normalizeSrc}; return normalizePanelOptions;`)();

test("normalizePanelOptions accepts the Admin Panel array form", () => {
  const options = normalizePanelOptions([
    { label: "General Support", value: "general_support", description: "Open a ticket" },
    { label: "Billing", value: "billing" }
  ]);
  assert.equal(options.length, 2);
  assert.equal(options[0].value, "general_support");
  assert.equal(options[0].description, "Open a ticket");
  assert.equal(options[1].description, undefined);
});

test("normalizePanelOptions still understands the legacy object map", () => {
  const options = normalizePanelOptions({ weekly: "Weekly Plan", monthly: { label: "Monthly", value: "month" } });
  assert.deepEqual(options.map(o => o.value), ["weekly", "month"]);
  assert.equal(options[0].label, "Weekly Plan");
});

test("normalizePanelOptions drops empty, duplicate and over-long entries", () => {
  const options = normalizePanelOptions([
    { label: "", value: "empty" },
    { label: "A", value: "same" },
    { label: "B", value: "same" },
    { label: "C", value: "c".repeat(200) }
  ]);
  // ২০০ অক্ষরের value কেটে ৮০ করা হয়, তাই সেটি বৈধ হিসেবেই থাকে
  assert.deepEqual(options.map(o => o.value), ["same", "c".repeat(80)]);
});

test("normalizePanelOptions caps the list at Discord's 25 option limit", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ label: `Option ${i}`, value: `v${i}` }));
  assert.equal(normalizePanelOptions(many).length, 25);
});

test("normalizePanelOptions is a no-op on empty input", () => {
  assert.deepEqual(normalizePanelOptions(undefined), []);
  assert.deepEqual(normalizePanelOptions([]), []);
  assert.deepEqual(normalizePanelOptions(""), []);
});

test("bot marks payment options that its checkout cannot sell", () => {
  assert.match(index, /const SHOP_PACKAGE_ALIASES = new Set\(/);
  const analyzeSrc = extractFunction("analyzePanelConfig");
  assert.match(analyzeSrc, /unusablePaymentValues/);
  assert.match(analyzeSrc, /SHOP_PACKAGE_ALIASES/);
  // payment panel is normalised by the bot, the others keep the admin's options
  assert.match(index, /const overridden = \["payment", "ticket", "onetime_key"\]\.includes\(panelType\);|optionsIgnoredByBot/);
});

test("panel preview and save endpoints sit behind admin auth and origin allowlist", () => {
  for (const route of ["/api/admin/panels/preview", "/api/admin/panels/save"]) {
    const pos = index.indexOf(`app.post("${route}"`);
    assert.ok(pos > 0, `missing ${route}`);
    const slice = index.slice(pos, pos + 900);
    assert.match(slice, /ADMIN_PANEL_ORIGINS/);
    assert.match(slice, /verifyAdminApiRequest/);
  }
});

test("panel save validates the same fields the Admin Panel validates", () => {
  const pos = index.indexOf('app.post("/api/admin/panels/save"');
  assert.ok(pos > 0);
  // সেভ handler-এর শেষ পর্যন্ত পড়া হয় (পরের route শুরু পর্যন্ত)
  const nextRoute = index.indexOf('app.post("/api/admin/offline-payment/sweep"', pos);
  const body = index.slice(pos, nextRoute > pos ? nextRoute : pos + 6000);
  for (const code of ["title_too_long", "description_too_long", "footer_too_long", "placeholder_too_long", "invalid_color", "image_url_must_be_https"]) {
    assert.ok(body.includes(code), `missing validation ${code}`);
  }
  assert.match(body, /syncAllManagedPanels\(\)/);
  assert.match(body, /discord_panel_update/);
});

test("panel impact copy tells admins which options the bot replaces", () => {
  assert.match(index, /botOptions: describeBotPanelOptions\(panelType\)/);
  const fn = index.slice(index.indexOf("function describeBotPanelOptions("), index.indexOf("function describeBotPanelOptions(") + 900);
  assert.match(fn, /weekly/);
  assert.match(fn, /general_support/);
  assert.match(fn, /generate_1time_key/);
});
