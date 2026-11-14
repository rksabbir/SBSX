const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.js"), "utf8");
const server = fs.readFileSync(path.join(root, "live-studio-server.js"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const env = fs.readFileSync(path.join(root, ".env.example"), "utf8");

test("v1.5.70 version is consistent across package.json and admin API responses", () => {
  assert.equal(pkg.version, "1.5.70");
  assert.match(server, /version: "1\.5\.70"/);
  assert.doesNotMatch(server, /version: "1\.5\.66"/);
});

test("admin AI status API exposes the same diagnosis the Discord command shows", () => {
  const pos = server.indexOf('app.get("/api/admin/ai/status"');
  assert.ok(pos > 0);
  const slice = server.slice(pos, pos + 1600);
  assert.match(slice, /diagnosis: chat\?\.diagnose \? chat\.diagnose\(\) : null/);
});

test("AI chat config values reach the bot from .env.example", () => {
  assert.match(env, /AI_CHAT_CHANNEL_ID=1488339288289448006/);
  assert.match(env, /AI_REPLY_TIMEOUT_MS=9000/);
  assert.match(env, /AI_TOTAL_BUDGET_MS=22000/);
});

test("timeout defaults favour fast failover over long waits", () => {
  const chat = fs.readFileSync(path.join(root, "ai-chat.js"), "utf8");
  assert.match(chat, /Number\(process\.env\.AI_REPLY_TIMEOUT_MS\) \|\| 9_000/);
  assert.match(chat, /Number\(process\.env\.AI_TOTAL_BUDGET_MS\) \|\| 22_000/);
});

test("diagnosis is surfaced to humans — log, staff channel and command", () => {
  assert.match(index, /console\.warn\(`\[AI\] সমস্যা/);
  assert.match(index, /notifyAiDiagnostic\(report\)/);
  assert.match(index, /aiChat\.describeDiagnosis\(aiChat\.diagnose\(\)\)/);
});

test("AI failures explain the reason instead of going quiet", () => {
  assert.match(index, /if \(kind === "not_configured"/);
  assert.match(index, /if \(kind === "all_cooling"/);
  assert.match(index, /timeout\|timed out/);
});

test("app commands are registered on ready with the AI command set", () => {
  const ready = index.indexOf('client.on("ready"');
  // declaration (1786) নয় — ready handler-এর ভেতরের কলটাই ধরতে হবে
  const register = index.indexOf("registerAiCommands().catch(");
  assert.ok(ready > 0 && register > ready, "registration must happen after the client is ready");
  assert.match(index, /guild\.commands\.set\(\[\.\.\.AI_SLASH_COMMANDS, \.\.\.AI_CONTEXT_COMMANDS\]\)/);
});

test("interaction errors are logged with their customId so stuck clicks are traceable", () => {
  assert.match(index, /Interaction handler failed \(\$\{interaction\.customId \|\| interaction\.commandName \|\| "unknown"\}\)/);
});
