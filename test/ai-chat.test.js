"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { AiChat, DEFAULT_CHANNEL_ID, normalizeChannelId } = require("../ai-chat");
const { AiRouter } = require("../ai-router");

const CHANNEL = "1488339288289448006";
const GUILD = "123456789012345678";

// টেস্টে provider-গুলো configured দেখাতে হবে, নাহলে router কাউকে ডাকবে না।
const KEY_ENVS = ["GEMINI_API_KEY", "GROQ_API_KEY", "CEREBRAS_API_KEY", "OPENROUTER_API_KEY", "NVIDIA_API_KEY", "COHERE_API_KEY", "HF_TOKEN"];
const ORIGINAL_KEYS = {};
for (const name of KEY_ENVS) { ORIGINAL_KEYS[name] = process.env[name]; process.env[name] = "test-key"; }
test.after(() => {
  for (const name of KEY_ENVS) {
    if (ORIGINAL_KEYS[name] === undefined) delete process.env[name]; else process.env[name] = ORIGINAL_KEYS[name];
  }
});

function fakeMessage(overrides = {}) {
  const replies = [];
  return {
    id: overrides.id || "m1",
    content: overrides.content ?? "হ্যালো, কেমন আছো?",
    channelId: overrides.channelId || CHANNEL,
    guild: overrides.guild === null ? null : { id: overrides.guildId || GUILD },
    author: overrides.author || { id: "user1", bot: false, username: "rafi" },
    member: { displayName: "Rafi" },
    system: false,
    replies,
    reply(payload) { replies.push(payload); return Promise.resolve({ id: "bot-msg" }); },
    channel: { send: payload => { replies.push(payload); return Promise.resolve({}); }, sendTyping: () => Promise.resolve(), id: overrides.channelId || CHANNEL }
  };
}

function buildChat(overrides = {}) {
  const router = new AiRouter({
    now: overrides.now || (() => 1_000_000),
    callProvider: overrides.callProvider || (async ({ providerId }) => ({ text: "ভালো আছি, তুমি কেমন?", providerId })),
    saveState: async () => {},
    providerAttempts: 1, // retry আলাদা টেস্টে যাচাই করা হয়
    wait: async () => {},
    log: () => {}
  });
  const savedTurns = [];
  const memory = {
    config: { enabled: true, maxTurns: 8, maxFacts: 8, retentionDays: 30 },
    load: async () => ({ name: "", history: [], facts: [], updatedAt: 0 }),
    appendTurn: async (...args) => { savedTurns.push(args); return true; },
    addFact: async () => true,
    forget: async () => true,
    stats: async () => ({ users: 1, enabled: true }),
    prune: async () => ({ removed: 0 })
  };
  const chat = new AiChat({
    router,
    memory,
    now: overrides.now || (() => 1_000_000),
    channels: overrides.channels || [CHANNEL],
    guildId: GUILD,
    enabled: overrides.enabled !== false,
    log: () => {}
  });
  return { chat, router, savedTurns };
}

test("default auto-reply channel is exactly 1488339288289448006", () => {
  assert.equal(DEFAULT_CHANNEL_ID, "1488339288289448006");
  assert.equal(normalizeChannelId("<#1488339288289448006>"), CHANNEL);
});

test("a plain message in the enabled channel gets an AI reply with no command", async () => {
  const { chat, savedTurns } = buildChat();
  const message = fakeMessage({ content: "আজকের দিনটা কেমন যাচ্ছে?" });
  const result = await chat.handleMessage(message);
  assert.equal(result.handled, true);
  assert.equal(message.replies.length, 1);
  assert.match(message.replies[0].content, /ভালো আছি/);
  assert.deepEqual(message.replies[0].allowedMentions, { repliedUser: false, parse: [] });
  assert.equal(savedTurns.length, 1, "memory must store the turn");
});

test("other channels, bots, DMs, prefixes and self messages are ignored", async () => {
  const { chat } = buildChat();
  const cases = [
    [fakeMessage({ channelId: "999999999999999999" }), "channel_off"],
    [fakeMessage({ author: { id: "b2", bot: true } }), "bot_author"],
    [fakeMessage({ guild: null }), "dm"],
    [fakeMessage({ content: "!help" }), "prefix"],
    [fakeMessage({ content: "?" }), "too_short"],
    [fakeMessage({ content: "   " }), "empty"],
    [fakeMessage({ guildId: "999999999999999998" }), "other_guild"]
  ];
  for (const [message, reason] of cases) {
    const result = await chat.handleMessage(message);
    assert.equal(result.handled, false, reason);
    assert.equal(result.reason, reason);
    assert.equal(message.replies.length, 0);
  }
});

test("the same message is never answered twice", async () => {
  const { chat } = buildChat();
  const message = fakeMessage({ id: "dup-1" });
  const first = await chat.handleMessage(message);
  const second = await chat.handleMessage(fakeMessage({ id: "dup-1" }));
  assert.equal(first.handled, true);
  assert.equal(second.handled, false);
  assert.equal(second.reason, "duplicate");
});

test("a per-user cooldown prevents reply spam", async () => {
  let now = 5_000_000;
  const { chat } = buildChat({ now: () => now });
  assert.equal((await chat.handleMessage(fakeMessage({ id: "a" }))).handled, true);
  const blocked = await chat.handleMessage(fakeMessage({ id: "b" }));
  assert.equal(blocked.reason, "user_cooldown");
  now += 10_000;
  assert.equal((await chat.handleMessage(fakeMessage({ id: "c" }))).handled, true);
});

test("two messages from the same user are processed one at a time", async () => {
  let active = 0;
  let maxActive = 0;
  let now = 0;
  const { chat } = buildChat({
    now: () => (now += 60_000),
    callProvider: async ({ providerId }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 20));
      active -= 1;
      return { text: "উত্তর", providerId };
    }
  });
  await Promise.all([
    chat.handleMessage(fakeMessage({ id: "q1" })),
    chat.handleMessage(fakeMessage({ id: "q2" }))
  ]);
  assert.equal(maxActive, 1, "same-user answers must be serialized");
});

test("identity questions are answered without calling any provider", async () => {
  let called = 0;
  let now = 2_000_000;
  const { chat } = buildChat({ now: () => now, callProvider: async () => { called += 1; return { text: "x" }; } });
  const message = fakeMessage({ content: "তোমাকে কে তৈরি করেছে?" });
  const result = await chat.handleMessage(message);
  assert.equal(called, 0);
  assert.equal(message.replies[0].content, "আমাকে তৈরি করেছে AKMAFIA YT! 😎🔥");
  assert.equal(result.provider, "identity");

  const religion = fakeMessage({ id: "m2", content: "তোমার ধর্ম কী?" });
  now += 10_000; // একই ইউজারের cooldown শেষ হওয়ার অপেক্ষা
  await chat.handleMessage(religion);
  assert.equal(religion.replies[0].content, "আমি একটি AI, আমার ব্যক্তিগত কোনো ধর্ম নেই।");
});

test("when every provider fails the user sees nothing and no crash happens", async () => {
  const { chat } = buildChat({
    callProvider: async () => { throw Object.assign(new Error("down"), { kind: "server", status: 500 }); }
  });
  const message = fakeMessage({ content: "প্রশ্ন" });
  const result = await chat.handleMessage(message);
  assert.equal(result.handled, true);
  assert.ok(result.error);
  assert.equal(message.replies.length, 0);
  assert.equal(chat.stats.failed, 1);
});

test("auto-reply channel config can be changed at runtime", async () => {
  const { chat } = buildChat();
  assert.equal(chat.isEnabledChannel(CHANNEL), true);
  assert.equal(chat.addChannel("111111111111111111"), true);
  assert.equal(chat.isEnabledChannel("111111111111111111"), true);
  assert.equal(chat.removeChannel(CHANNEL), true);
  assert.equal(chat.isEnabledChannel(CHANNEL), false);
  const result = await chat.handleMessage(fakeMessage());
  assert.equal(result.reason, "channel_off");
});

test("disabling auto chat stops every reply", async () => {
  const { chat } = buildChat({ enabled: false });
  const result = await chat.handleMessage(fakeMessage());
  assert.equal(result.handled, false);
  assert.equal(result.reason, "disabled");
});

test("long AI answers are clipped below the Discord limit", async () => {
  const { chat } = buildChat({
    callProvider: async ({ providerId }) => ({ text: "খুব লম্বা উত্তর। ".repeat(400), providerId })
  });
  const message = fakeMessage({ content: "বলো তো" });
  await chat.handleMessage(message);
  assert.ok(message.replies[0].content.length <= 1900);
});

test("snapshot exposes panel-friendly state", async () => {
  const { chat } = buildChat();
  await chat.handleMessage(fakeMessage());
  const snap = chat.snapshot();
  assert.equal(snap.enabled, true);
  assert.deepEqual(snap.channels, [CHANNEL]);
  assert.equal(snap.stats.handled, 1);
  assert.equal(snap.stats.replied, 1);
  assert.ok(snap.router.providers.length === 8);
});

test("index.js wires the listener, config and shutdown around the AI chat", () => {
  const index = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.match(index, /require\("\.\/ai-chat"\)/);
  assert.match(index, /new AiChat\(/);
  assert.match(index, /aiChat\.handleMessage\(message\)/);
  assert.match(index, /aiChat\.router\.restore\(\)/);
  assert.match(index, /aiChat\.shutdown\(\)/);
  assert.match(index, /aiChat,/);
  assert.match(index, /GeminiApiKey|geminiApiKey/);
  // Message Content Intent থাকতেই হবে
  assert.match(index, /GatewayIntentBits\.MessageContent/);
});

test("live-studio-server exposes the AI Management endpoints", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "live-studio-server.js"), "utf8");
  for (const route of ["/api/admin/ai/status", "/api/admin/ai/provider", "/api/admin/ai/channels", "/api/admin/ai/test", "/api/admin/ai/memory", "/api/admin/ai/keys"]) {
    assert.ok(server.includes(route), `${route} must exist`);
  }
  assert.match(server, /AI_SECRET_SECTIONS/);
  assert.match(server, /geminiApiKey: "GEMINI_API_KEY"/);
  assert.match(server, /huggingfaceApiKey: "HF_TOKEN"/);
  // key কখনো প্লেইন টেক্সটে ফেরত যাবে না
  const keysRoute = server.slice(server.indexOf('app.get("/api/admin/ai/keys"'), server.indexOf('app.post("/api/admin/ai/keys"'));
  assert.doesNotMatch(keysRoute, /saved\[field\.key\]\s*\?\s*saved/);
  assert.match(keysRoute, /configured: Boolean/);
});

// ── v1.5.70: diagnosis — "কেন উত্তর আসছে না" ─────────────────────────────
test("diagnose() reports a ready state when a key exists and nothing is cooling", () => {
  const { chat } = buildChat();
  const report = chat.diagnose();
  assert.equal(report.enabled, true);
  assert.equal(report.channels.length, 1);
  assert.ok(report.usableCount >= 1, "test keys are injected so at least one provider is usable");
  assert.ok(report.readyCount >= 1);
  assert.deepEqual(report.issues.map(i => i.code), []);
  assert.equal(report.ok, true);
  assert.ok(report.timeoutMs >= 6_000);
  assert.ok(report.totalBudgetMs >= 10_000);
});

test("diagnose() flags a disabled AI chat and empty channel list", () => {
  const { chat } = buildChat({ enabled: false, channels: [] });
  const codes = chat.diagnose().issues.map(i => i.code);
  assert.ok(codes.includes("ai_disabled"));
  assert.ok(codes.includes("no_channel"));
});

test("diagnose() explains that no provider key is configured", () => {
  const saved = {};
  for (const name of KEY_ENVS) { saved[name] = process.env[name]; delete process.env[name]; }
  try {
    const { chat } = buildChat();
    const report = chat.diagnose();
    assert.equal(report.usableCount, 0);
    assert.ok(report.issues.some(i => i.code === "no_key"));
    assert.match(report.issues.find(i => i.code === "no_key").message, /API key/);
  } finally {
    for (const name of KEY_ENVS) if (saved[name] !== undefined) process.env[name] = saved[name];
  }
});

test("describeDiagnosis() renders Bangla guidance with channels and providers", () => {
  const { chat } = buildChat();
  const text = chat.describeDiagnosis();
  assert.match(text, /AI ডায়াগনস্টিক/);
  assert.match(text, new RegExp(`<#${CHANNEL}>`));
  assert.match(text, /Provider:/);
  assert.ok(text.length <= 1900, "Discord message limit respected");
});

test("channel mismatches are logged once instead of failing silently", async () => {
  const logs = [];
  const { chat } = buildChat();
  chat.log = message => logs.push(message);
  const message = fakeMessage({ channelId: "999888777666555444", id: "off-channel" });
  const result = await chat.handleMessage(message);
  assert.equal(result.handled, false);
  assert.equal(result.reason, "channel_off");
  assert.ok(logs.some(line => line.includes("is not in the auto-reply list")));
});
