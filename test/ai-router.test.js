"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { AiRouter, STATUS, MAX_ATTEMPTS, dayKey } = require("../ai-router");

function configuredRouter(overrides = {}) {
  const saves = [];
  const router = new AiRouter({
    now: overrides.now || (() => 1_000_000),
    callProvider: overrides.callProvider,
    saveState: async state => { saves.push(state); },
    loadState: async () => overrides.state || null,
    log: () => {}
  });
  return { router, saves };
}

function setKeys(ids = ["gemini", "groq", "cerebras"]) {
  const env = { gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY", cerebras: "CEREBRAS_API_KEY", openrouter: "OPENROUTER_API_KEY", nvidia: "NVIDIA_API_KEY", cohere: "COHERE_API_KEY", huggingface: "HF_TOKEN" };
  const previous = {};
  for (const [id, name] of Object.entries(env)) {
    previous[name] = process.env[name];
    if (ids.includes(id)) process.env[name] = "test-key";
    else delete process.env[name];
  }
  return () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  };
}

test("unconfigured providers are reported, never called", async () => {
  const restore = setKeys([]);
  try {
    const calls = [];
    const { router } = configuredRouter({ callProvider: async args => { calls.push(args.providerId); return { text: "ok" }; } });
    await assert.rejects(() => router.ask({ userText: "হ্যালো" }), /configured/);
    assert.equal(calls.length, 0);
    const snap = router.snapshot();
    assert.ok(snap.providers.every(p => p.status === STATUS.UNCONFIGURED || p.enabled === true));
    assert.equal(snap.providers.find(p => p.id === "gemini").configured, false);
  } finally { restore(); }
});

test("a 429 provider is cooled down and the next priority answers", async () => {
  const restore = setKeys();
  try {
    const calls = [];
    const { router } = configuredRouter({
      callProvider: async ({ providerId }) => {
        calls.push(providerId);
        if (providerId === "gemini") throw Object.assign(new Error("rate limited"), { kind: "rate_limit", status: 429 });
        return { text: "উত্তর", providerId, usage: { totalTokens: 10 } };
      }
    });
    const result = await router.ask({ userText: "প্রশ্ন" });
    assert.equal(result.providerId, "groq");
    assert.equal(result.switched, true);
    assert.deepEqual(calls, ["gemini", "groq"]);
    const gemini = router.providers.gemini;
    assert.equal(gemini.status, STATUS.RATE_LIMITED);
    assert.ok(gemini.cooldownUntil > router.now());
    // history-তে switch রেকর্ড আছে
    assert.equal(router.history[0].to, "groq");
    assert.equal(router.totals.switches, 1);
  } finally { restore(); }
});

test("a provider in cooldown is not retried until the cooldown ends", async () => {
  const restore = setKeys();
  try {
    let now = 5_000_000;
    const calls = [];
    const { router } = configuredRouter({
      now: () => now,
      callProvider: async ({ providerId }) => {
        calls.push(providerId);
        if (providerId === "gemini") throw Object.assign(new Error("boom"), { kind: "server", status: 500 });
        return { text: "ঠিক আছে", providerId };
      }
    });
    await router.ask({ userText: "১" });
    assert.deepEqual(calls, ["gemini", "groq"]);
    now += 5_000; // cooldown শেষ হয়নি
    await router.ask({ userText: "২" });
    assert.deepEqual(calls, ["gemini", "groq", "groq"], "cooled provider must be skipped");
  } finally { restore(); }
});

test("after cooldown the provider recovers to its original priority", async () => {
  const restore = setKeys();
  try {
    let now = 9_000_000;
    const calls = [];
    const events = [];
    const { router, saves } = configuredRouter({
      now: () => now,
      callProvider: async ({ providerId }) => {
        calls.push(providerId);
        if (providerId === "gemini" && calls.filter(id => id === "gemini").length === 1) {
          throw Object.assign(new Error("timeout"), { kind: "timeout" });
        }
        return { text: "ঠিক", providerId };
      }
    });
    router.onEvent = event => events.push(event);
    await router.ask({ userText: "১" });
    assert.deepEqual(calls, ["gemini", "groq"]);
    const priorityBefore = router.providers.gemini.priority;
    now += 10 * 60_000;
    router.refreshAll();
    assert.equal(router.providers.gemini.status, STATUS.ACTIVE === router.providers.gemini.status ? STATUS.ACTIVE : STATUS.AVAILABLE);
    assert.equal(router.providers.gemini.priority, priorityBefore);
    await router.ask({ userText: "২" });
    assert.equal(calls[calls.length - 1], "gemini", "original priority must be restored");
    assert.ok(events.some(event => event.type === "recovered"));
    await router.flush();
    assert.ok(saves.length >= 1);
    assert.ok(saves.at(-1).providers.gemini);
  } finally { restore(); }
});

test("Retry-After header extends the cooldown", async () => {
  const restore = setKeys();
  try {
    const { router } = configuredRouter({
      callProvider: async ({ providerId }) => {
        if (providerId === "gemini") throw Object.assign(new Error("slow down"), { kind: "rate_limit", status: 429, headers: new Map([["retry-after", "600"]]) });
        return { text: "ok", providerId };
      }
    });
    await router.ask({ userText: "প্রশ্ন" });
    const remaining = router.providers.gemini.cooldownUntil - router.now();
    assert.equal(remaining, 600_000);
  } finally { restore(); }
});

test("state survives a restart", async () => {
  const restore = setKeys();
  try {
    const now = 2_000_000;
    const { router } = configuredRouter({
      now: () => now,
      callProvider: async ({ providerId }) => {
        if (providerId === "gemini") throw Object.assign(new Error("down"), { kind: "server", status: 503 });
        return { text: "ok", providerId };
      }
    });
    await router.ask({ userText: "প্রশ্ন" });
    const state = router.serializeState();

    const rebuilt = new AiRouter({ now: () => now, saveState: async () => {}, log: () => {} });
    rebuilt.applyState(state);
    assert.equal(rebuilt.providers.gemini.status, STATUS.COOLDOWN);
    assert.ok(rebuilt.cooldownRemaining("gemini") > 0);
    assert.equal(rebuilt.providers.groq.successes, 1);
    assert.equal(rebuilt.totals.switches, 1);
  } finally { restore(); }
});

test("admin disable and enable are respected, and never permanent by failure alone", async () => {
  const restore = setKeys();
  try {
    const calls = [];
    const { router } = configuredRouter({ callProvider: async ({ providerId }) => { calls.push(providerId); return { text: "ok", providerId }; } });
    router.setEnabled("gemini", false);
    assert.equal(router.providers.gemini.enabled, false);
    assert.equal(router.refresh("gemini").status, STATUS.DISABLED);
    await router.ask({ userText: "প্রশ্ন" });
    assert.ok(!calls.includes("gemini"));
    router.setEnabled("gemini", true);
    assert.notEqual(router.providers.gemini.status, STATUS.DISABLED);
  } finally { restore(); }
});

test("priority order controls which provider is tried first", () => {
  const restore = setKeys(["gemini", "groq"]);
  try {
    const { router } = configuredRouter();
    router.setPriority("groq", 1);
    router.setPriority("gemini", 500);
    const order = router.order().map(p => p.id);
    assert.equal(order[0], "groq");
    assert.equal(order[1], "gemini");
  } finally { restore(); }
});

test("all providers failing throws a clear error and records every error", async () => {
  const restore = setKeys(["gemini", "groq"]);
  try {
    const { router } = configuredRouter({
      callProvider: async ({ providerId }) => { throw Object.assign(new Error(`${providerId} down`), { kind: "server", status: 500 }); }
    });
    await assert.rejects(() => router.ask({ userText: "প্রশ্ন" }), err => err.kind === "all_failed" && err.attempted.length === 2);
    assert.equal(router.errors.length, 2);
    assert.equal(router.totals.failures, 2);
    assert.ok(router.providers.gemini.cooldownUntil > 0);
  } finally { restore(); }
});

test("failover attempts are capped so one message cannot burn the whole quota", async () => {
  const restore = setKeys(["gemini", "groq", "cerebras", "openrouter", "nvidia", "cohere", "huggingface"]);
  try {
    let calls = 0;
    const { router } = configuredRouter({ callProvider: async () => { calls += 1; throw Object.assign(new Error("no"), { kind: "server", status: 500 }); } });
    await assert.rejects(() => router.ask({ userText: "প্রশ্ন" }));
    assert.equal(calls, MAX_ATTEMPTS);
  } finally { restore(); }
});

test("snapshot exposes per-provider counters, quota estimate and switch history", async () => {
  const restore = setKeys(["gemini"]);
  try {
    const { router } = configuredRouter({ callProvider: async ({ providerId }) => ({ text: "ok", providerId, usage: { totalTokens: 42 } }) });
    await router.ask({ userText: "প্রশ্ন" });
    const snap = router.snapshot();
    const gemini = snap.providers.find(p => p.id === "gemini");
    assert.equal(gemini.successes, 1);
    assert.equal(gemini.requests, 1);
    assert.equal(gemini.successRate, 100);
    assert.equal(gemini.dailyRequests, 1);
    assert.ok(gemini.dailyLimit > 0);
    assert.equal(gemini.active, true);
    assert.ok(Array.isArray(snap.history));
    assert.ok(snap.totals.successes >= 1);
    assert.equal(snap.lastSwitch, null);
  } finally { restore(); }
});

test("empty provider responses fail over instead of posting a blank message", async () => {
  const restore = setKeys(["gemini", "groq"]);
  try {
    const { router } = configuredRouter({
      callProvider: async ({ providerId }) => {
        if (providerId === "gemini") throw Object.assign(new Error("empty response"), { kind: "empty" });
        return { text: "আসল উত্তর", providerId };
      }
    });
    const result = await router.ask({ userText: "প্রশ্ন" });
    assert.equal(result.text, "আসল উত্তর");
  } finally { restore(); }
});

test("dayKey gives a stable daily bucket for quota estimates", () => {
  assert.match(dayKey(Date.UTC(2026, 0, 2, 3)), /^2026-01-02$/);
});
