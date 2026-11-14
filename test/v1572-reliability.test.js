"use strict";
// v1.5.72 — "টিকিট/অর্ডার খুললে AI রিপ্লাই আসে না" + "checkout আটকে থাকে"
// এই ফাইলটি তিনটি জিনিস যাচাই করে:
//   ১. সাপোর্ট/অর্ডার টিকিট চ্যানেলে AI উত্তর দেয় (প্যানেলের চ্যানেল লিস্টে না থাকলেও)
//   ২. মৃত টিকিট লক সাথে সাথে ছাড়া হয় (চ্যানেল মুছে গেলে ইউজার আর আটকে থাকে না)
//   ৩. payment panel-এর critical read-এ সময়সীমা আছে (ঝুলে গিয়ে "লোডিং" হয় না)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { AiChat, DEFAULT_CHANNEL_ID } = require("../ai-chat");
const { AiRouter } = require("../ai-router");
const { describeTicketLockBlock } = require("../ticket-lock");

const root = path.join(__dirname, "..");
const indexSource = fs.readFileSync(path.join(root, "index.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "live-studio-server.js"), "utf8");

const GUILD = "123456789012345678";
const PANEL_CHANNEL = DEFAULT_CHANNEL_ID;
const KEY_ENVS = ["GEMINI_API_KEY", "GROQ_API_KEY", "CEREBRAS_API_KEY", "OPENROUTER_API_KEY", "NVIDIA_API_KEY", "COHERE_API_KEY", "HF_TOKEN"];
const ORIGINAL_KEYS = {};
for (const name of KEY_ENVS) { ORIGINAL_KEYS[name] = process.env[name]; process.env[name] = "test-key"; }
test.after(() => {
  for (const name of KEY_ENVS) {
    if (ORIGINAL_KEYS[name] === undefined) delete process.env[name]; else process.env[name] = ORIGINAL_KEYS[name];
  }
});

function fakeMessage({ channelId = PANEL_CHANNEL, channelName = "general", content = "ভাই আমার অর্ডারটা কই?", id = "m1" } = {}) {
  const replies = [];
  return {
    id,
    content,
    channelId,
    guild: { id: GUILD },
    author: { id: "user1", bot: false, username: "rafi" },
    member: { displayName: "Rafi" },
    system: false,
    replies,
    reply(payload) { replies.push(payload); return Promise.resolve({ id: "bot-msg" }); },
    channel: {
      id: channelId,
      name: channelName,
      send: payload => { replies.push(payload); return Promise.resolve({}); },
      sendTyping: () => Promise.resolve()
    }
  };
}

function buildChat(options = {}) {
  const router = new AiRouter({
    now: () => 1_000_000,
    callProvider: async ({ providerId }) => ({ text: "ভাই, অর্ডারটা প্রসেস হচ্ছে।", providerId }),
    saveState: async () => {},
    providerAttempts: 1,
    wait: async () => {},
    log: () => {}
  });
  const memory = {
    config: { enabled: true, maxTurns: 8, maxFacts: 8, retentionDays: 30 },
    load: async () => ({ name: "", history: [], facts: [], updatedAt: 0 }),
    appendTurn: async () => true,
    addFact: async () => true,
    forget: async () => true,
    stats: async () => ({ users: 1 }),
    prune: async () => ({ removed: 0 }),
    setDb: () => {}
  };
  const chat = new AiChat({
    router,
    memory,
    now: () => 1_000_000,
    channels: [PANEL_CHANNEL],
    guildId: GUILD,
    enabled: true,
    autoReplyTickets: options.autoReplyTickets,
    log: () => {}
  });
  return { chat, router };
}

test("a support ticket channel gets an AI reply without being in the panel channel list", async () => {
  const { chat } = buildChat();
  const message = fakeMessage({ channelId: "999999999999999001", channelName: "ticket-1234" });
  const result = await chat.handleMessage(message);
  assert.equal(result.handled, true);
  assert.equal(message.replies.length, 1);
  assert.match(message.replies[0].content, /অর্ডার/);
});

test("order channels get the same treatment (order-5678)", async () => {
  const { chat } = buildChat();
  const message = fakeMessage({ channelId: "999999999999999002", channelName: "order-5678" });
  const result = await chat.handleMessage(message);
  assert.equal(result.handled, true);
  assert.equal(message.replies.length, 1);
});

test("report- and customer- channels also work", async () => {
  for (const [suffix, name] of [["3", "report-0042"], ["4", "customer-7777"]]) {
    const { chat } = buildChat();
    const message = fakeMessage({ channelId: `99999999999999900${suffix}`, channelName: name, id: `m-${suffix}` });
    const result = await chat.handleMessage(message);
    assert.equal(result.handled, true, name);
  }
});

test("unrelated channels stay silent (no blanket AI in every channel)", async () => {
  const { chat } = buildChat();
  for (const name of ["general", "ticket-help", "tickets", "order", "ticket-12345", "off-topic"]) {
    const message = fakeMessage({ channelId: "88888888888888888" + name.length, channelName: name, id: `x-${name}` });
    const result = await chat.handleMessage(message);
    assert.equal(result.handled, false, name);
    assert.equal(result.reason, "channel_off", name);
  }
});

test("the ticket auto-reply can be switched off from the panel", async () => {
  const { chat } = buildChat({ autoReplyTickets: false });
  const message = fakeMessage({ channelId: "999999999999999005", channelName: "ticket-4321" });
  const result = await chat.handleMessage(message);
  assert.equal(result.handled, false);
  assert.equal(result.reason, "channel_off");
});

test("ticket auto-reply setting is read from Firebase and saved back", async () => {
  const stored = { enabled: true, autoReplyChannels: { [PANEL_CHANNEL]: true }, autoReplyTickets: false };
  const writes = {};
  const db = {
    ref(dbPath) {
      assert.equal(dbPath, "ai_router/config");
      return {
        get: async () => ({ val: () => stored }),
        update: async patch => { Object.assign(writes, patch); }
      };
    }
  };
  const { chat } = buildChat();
  chat.setDb(db);
  await chat.loadConfig();
  assert.equal(chat.autoReplyTickets, false, "Firebase value must win over the default");
  await chat.saveConfig({ autoReplyTickets: true });
  assert.equal(writes.autoReplyTickets, true);
  assert.equal(chat.autoReplyTickets, true);
});

test("the diagnosis shows whether ticket channels get AI replies", () => {
  const { chat } = buildChat();
  const report = chat.diagnose();
  assert.equal(report.autoReplyTickets, true);
  assert.match(chat.describeDiagnosis(report), /সাপোর্ট\/অর্ডার টিকিটে AI/);
  const off = buildChat({ autoReplyTickets: false }).chat.diagnose();
  assert.equal(off.autoReplyTickets, false);
});

test("a deleted ticket channel produces a readable explain-message, not a dead end", () => {
  const text = describeTicketLockBlock({ allowed: false, reason: "channel_missing", type: "ticket", category: "general_support" });
  assert.match(text, /ডিলিট হয়েই গেছে/);
  assert.match(text, /আবার বাটনে চাপ দিন/);
});

test("stale ticket locks are reclaimed before telling the user their ticket is open", () => {
  const fn = indexSource.slice(indexSource.indexOf("async function claimTicketSlot("), indexSource.indexOf("async function describeStaleTicketLock("));
  assert.match(fn, /describeStaleTicketLock\(/, "claim must check whether the locked channel still exists");
  assert.match(fn, /releaseTicketLock\(/, "a stale lock must be released");
  assert.match(fn, /result = await attempt\(\)/, "the lock must be retried after reclaiming");
  const helper = indexSource.slice(indexSource.indexOf("async function describeStaleTicketLock("), indexSource.indexOf("async function describeStaleTicketLock(") + 1200);
  assert.match(helper, /channels\.fetch\(channelId\)/, "the channel must really be fetched, not just read from cache");
  assert.match(helper, /channel_never_created/, "a lock that never got a channel is also stale");
});

test("dead locks expire in a day instead of trapping users for a week", () => {
  assert.doesNotMatch(indexSource, /TICKET_LOCK_MAX_AGE_MS \|\| 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(indexSource, /TICKET_LOCK_MAX_AGE_MS \|\| 24 \* 60 \* 60 \* 1000/);
});

test("payment reads have a hard deadline so the panel can never hang", () => {
  assert.match(indexSource, /function withDeadline\(/, "shared deadline helper is required");
  const payStart = indexSource.indexOf('const match = /^pay_provider_(bkash|nagad)_(.+)$/.exec(interaction.customId);');
  const payProvider = indexSource.slice(payStart);
  const block = payProvider.slice(0, 4000);
  assert.match(block, /withDeadline\(sessionRef\.once\("value"\)/, "checkout session read must be bounded");
  assert.match(block, /withDeadline\(getPaymentReaderState\(\)/, "reader check must be bounded");
  const checkStart = indexSource.indexOf('const category = getNormalizedCategory(interaction.customId.slice("check_reader_".length));');
  assert.match(indexSource.slice(checkStart, checkStart + 3000), /withDeadline\(/, "reader re-check must be bounded too");
});

test("the reset button explains which state is stuck instead of a generic refusal", () => {
  const block = indexSource.slice(indexSource.indexOf('interaction.customId.startsWith("reset_checkout_")'), indexSource.indexOf('interaction.customId === "toggle_auto_coupon"'));
  assert.match(block, /stuckStatus === "creating"/);
  assert.match(block, /account তৈরি হচ্ছে/);
  assert.match(block, /stuckStatus === "completed"/);
  assert.match(block, /ইতিমধ্যেই account তৈরি হয়ে গেছে/);
});

test("the AI provider Test button uses panel-saved keys, not only process.env", () => {
  const route = serverSource.slice(serverSource.indexOf('app.post("/api/admin/ai/test"'), serverSource.indexOf('app.get("/api/admin/ai/memory"'));
  assert.match(route, /resolveProviderKey\(spec, resolvedSecrets\)/);
  assert.match(route, /resolveProviderAccount\(spec, resolvedSecrets\)/);
  assert.doesNotMatch(route, /String\(process\.env\[spec\.env\] \|\| ""\)/);
});

test("the panel can toggle ticket auto-reply through the channels API", () => {
  const route = serverSource.slice(serverSource.indexOf('app.post("/api/admin/ai/channels"'), serverSource.indexOf('app.post("/api/admin/ai/test"'));
  assert.match(route, /autoReplyTickets/);
  assert.match(route, /saveConfig\(\{ channels, enabled, noticeChannelId, autoReplyTickets \}\)/);
});
