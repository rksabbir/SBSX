const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const router = require("../ai-router");
const { AiRouter } = router;

const ORIGINAL = {};
for (const name of ["GEMINI_API_KEY", "GROQ_API_KEY", "CEREBRAS_API_KEY"]) {
  ORIGINAL[name] = process.env[name];
  delete process.env[name];
}
test.after(() => {
  for (const [name, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

function buildRouter(secrets, callProvider) {
  return new AiRouter({
    secretsProvider: () => secrets,
    callProvider: callProvider || (async ({ providerId }) => ({ text: "ঠিক আছে", providerId })),
    saveState: async () => {},
    providerAttempts: 1,
    wait: async () => {},
    log: () => {}
  });
}

test("v1.5.71 root cause: a key saved only in Firebase is used by the router (env empty)", async () => {
  assert.equal(process.env.GEMINI_API_KEY, undefined);
  let usedKey = "";
  const ai = buildRouter({ gemini: "panel-saved-key" }, async ({ providerId, apiKey }) => {
    usedKey = apiKey;
    return { text: "প্যানেলের key দিয়ে উত্তর", providerId };
  });
  ai.setEnabled("gemini", true);
  for (const id of ["groq", "cerebras", "openrouter", "cloudflare", "nvidia", "cohere", "huggingface"]) ai.setEnabled(id, false);
  const result = await ai.ask({ system: "s", history: [], userText: "হ্যালো", timeoutMs: 6_000, giveUpMs: 20_000 });
  assert.equal(result.providerId, "gemini");
  assert.equal(usedKey, "panel-saved-key");
  const snap = ai.snapshot();
  assert.equal(snap.providers.find(p => p.id === "gemini").configured, true);
});

test("v1.5.71: with no key anywhere the router reports not_configured instead of silence", async () => {
  const ai = buildRouter({});
  for (const id of ["gemini", "groq", "cerebras", "openrouter", "cloudflare", "nvidia", "cohere", "huggingface"]) ai.setEnabled(id, true);
  await assert.rejects(
    () => ai.ask({ system: "s", history: [], userText: "হ্যালো" }),
    err => err.kind === "not_configured"
  );
});

test("v1.5.71: cloudflare needs both account id and token, from either source", () => {
  const ai = buildRouter({ cloudflare: "token-only" });
  const spec = require("../ai-providers").getProviderSpec("cloudflare");
  assert.equal(ai.keyFor(spec, { cloudflare: "token-only" }), "");
  assert.equal(ai.keyFor(spec, { cloudflare: "token-only", cloudflareAccountId: "023e105f4ecef8ad9ca31a8372d0c353" }), "token-only");
});

test("v1.5.71: panel-saved keys reach the running chat instance without a restart", () => {
  const { AiChat } = require("../ai-chat");
  const chat = new AiChat({ channels: ["1488339288289448006"], guildId: "123456789012345678", log: () => {} });
  const before = chat.router.secretsProvider();
  assert.deepEqual(before, {});
  chat.setSecretsProvider(() => ({ gemini: "live-key" }));
  assert.equal(chat.router.secretsProvider().gemini, "live-key");
});

test("wiring: startup hydrates secrets from Firebase and the panel save updates them live", () => {
  const index = fs.readFileSync(path.join(root, "index.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "live-studio-server.js"), "utf8");
  assert.match(index, /global\.__aiProviderSecrets/);
  assert.match(index, /secretsProvider: \(\) => \(\{ \.\.\.\(\(global\.__aiProviderSecrets\) \|\| \{\}\) \}\)/);
  assert.match(index, /aiSecretKeys\s*=\s*\{/);
  assert.match(server, /aiChat\.setSecretsProvider\(/);
  assert.match(server, /providerOfField/);
});

test("wiring: typing indicator is kept alive so slow providers still look alive", () => {
  const chat = fs.readFileSync(path.join(root, "ai-chat.js"), "utf8");
  assert.match(chat, /typingTimers/);
  assert.match(chat, /setInterval\(\(\) => channel\.sendTyping\?\.\(\)\.catch\(\(\) => \{\}\), 8_000\)/);
  assert.match(chat, /AI replied via \$\{result\.providerId/);
});

test("wiring: buy-panel no longer hangs — parallel reads, deferUpdate and reset button", () => {
  const index = fs.readFileSync(path.join(root, "index.js"), "utf8");
  assert.match(index, /await interaction\.deferUpdate\(\)/);
  assert.match(index, /const \[existingSessionSnap, autoCouponEnabled\] = await Promise\.all\(\[/);
  assert.match(index, /async function replyAfterDefer\(interaction, usedDeferUpdate, payload\)/);
  assert.match(index, /reset_checkout_\$\{category\}/);
  const pos = index.indexOf('interaction.customId.startsWith("reset_checkout_")');
  assert.ok(pos > 0, "reset handler must exist");
  const slice = index.slice(pos, pos + 900);
  assert.match(slice, /transaction/);
  assert.match(slice, /offline_payment_approved/);
});

test("package version is consistent with the API version strings", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  // ভার্সন-অজ্ঞেয়: যেকোনো নতুন রিলিজে টেস্ট ভাঙবে না, কিন্তু প্যানেল/সার্ভার আলাদা হলে ধরবে।
  assert.match(pkg.version, /^1\.5\.\d+$/);
  const server = fs.readFileSync(path.join(root, "live-studio-server.js"), "utf8");
  // কিছু পুরোনো route এখনো নিজের verson string ফেরত দেয় (1.5.56) — তাই সর্বোচ্চ verson-ই
  // বর্তমান রিলিজ, এবং সেটাই package.json-এর সাথে মিলতে হবে।
  const versions = [...server.matchAll(/version: "(1\.5\.(\d+))"/g)].map(m => ({ full: m[1], patch: Number(m[2]) }));
  assert.ok(versions.length > 0, "live-studio-server.js must report its version");
  const newest = versions.reduce((a, b) => (b.patch > a.patch ? b : a));
  assert.equal(newest.full, pkg.version, `newest API version must be ${pkg.version}, saw ${newest.full}`);
});
