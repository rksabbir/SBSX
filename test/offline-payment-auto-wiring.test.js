"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.js"), "utf8");

test("offline payment modules are actually required by index.js", () => {
  // v1.5.58 shipped helper calls without the require — a Reader-offline request crashed.
  assert.match(index, /require\("\.\/offline-payment"\)/);
  assert.match(index, /normalizeTxnId[,\s].*= require\("\.\/offline-payment"\)|const \{[^}]*normalizeTxnId[^}]*\} = require\("\.\/offline-payment"\)/);
  assert.match(index, /require\("\.\/offline-payment-auto"\)/);
  assert.match(index, /require\("\.\/offline-payment-fraud"\)/);
});

test("Reader-assisted auto approval is wired into the bot lifecycle", () => {
  assert.match(index, /async function tryAutoApproveOfflineRequest\(/);
  assert.match(index, /evaluateReaderMatch\(/);
  assert.match(index, /findReaderEventByTxnId\(/);
  assert.match(index, /startOfflineAutoVerifyTimer\(\)/);
  assert.match(index, /registerReaderEventAutoVerifyListeners\(\)/);
  assert.match(index, /scheduleOfflineAutoVerifyAfterCreate\(/);
  // auto approval must claim the TxnID exactly once
  assert.match(index, /OFFLINE_AUTO_APPROVED:\$\{requestId\}/);
  assert.match(index, /verificationSource: "reader_auto_verify"/);
});

test("a new request no longer dead-ends in the review queue", () => {
  assert.match(index, /Reader ফিরে এলে bot নিজেই transaction মিলিয়ে approve করার চেষ্টা করবে/);
  assert.match(index, /setOfflineVerifyStage\(requestId, "awaiting_reader"\)/);
  assert.match(index, /status: "auto_approved"/);
});

test("fake payments can be revoked and banned from Discord and the Admin Panel", () => {
  assert.match(index, /async function handleOfflineFraudRevoke\(/);
  assert.match(index, /async function handleOfflineFraudUnban\(/);
  assert.match(index, /offlinepay_fake_/);
  assert.match(index, /offlinepay_markok_/);
  assert.match(index, /offlinepay_unban_/);
  assert.match(index, /modal_offlinefraud_/);
  assert.match(index, /status: "revoked_fake"/);
  assert.match(index, /buildBanPlan\(/);
  assert.match(index, /db\.ref\(`users\/\$\{entry\.username\}`\)\.update\(entry\.patch\)/);
});

test("admin API exposes revoke, unban, auto-verify and overview routes behind admin auth", () => {
  for (const route of [
    "/api/admin/offline-payment/revoke",
    "/api/admin/offline-payment/unban",
    "/api/admin/offline-payment/auto-verify",
    "/api/admin/offline-payment/overview",
    "/api/admin/offline-payment/sweep"
  ]) {
    const pos = index.indexOf(`app.post("${route}"`) >= 0 ? index.indexOf(`app.post("${route}"`) : index.indexOf(`app.get("${route}"`);
    assert.ok(pos >= 0, `missing ${route}`);
    const slice = index.slice(pos, pos + 900);
    assert.ok(slice.includes("verifyAdminApiRequest") || slice.includes("runOfflineAutoVerifyPass"), `auth missing for ${route}`);
    assert.match(slice, /ADMIN_PANEL_ORIGINS/);
  }
});

test("strike ledger blocks repeat offenders before a new request is created", () => {
  assert.match(index, /offline_payment_strikes/);
  assert.match(index, /evaluateStrikeGate\(/);
  assert.match(index, /OFFLINE_MAX_STRIKES/);
  assert.match(index, /nextStrikeState\(/);
});

test("auto-approve limits are configurable through env", () => {
  assert.match(index, /OFFLINE_AUTO_APPROVE_ENABLED/);
  assert.match(index, /OFFLINE_AUTO_APPROVE_MAX_BDT/);
  assert.match(index, /OFFLINE_AUTO_VERIFY_INTERVAL_MS/);
  assert.match(index, /OFFLINE_FRAUD_BAN_ENABLED/);
});

test("auto-verify timer is declared before the ready handler uses it (no TDZ crash)", () => {
  const decl = index.indexOf("let offlineSweepTimer = null;");
  const ready = index.indexOf('client.on("ready"');
  assert.ok(decl > 0 && ready > 0);
  assert.ok(decl < ready, "offlineSweepTimer must be declared before the ready handler");
  const autoDecl = index.indexOf("let offlineAutoVerifyTimer = null;");
  assert.ok(autoDecl > 0 && autoDecl < ready, "offlineAutoVerifyTimer must be declared before the ready handler");
});
