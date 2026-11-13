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
    // টেস্টে আসল অপেক্ষা নয় — retry আলাদা টেস্টে যাচাই করা হয়।
    providerAttempts: overrides.providerAttempts ?? 1,
    wait: async () => {},
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

// ---- v1.5.63: বন্ধ মডেল, সৎ cooldown, restart-safe migration ----

test("a retired model is replaced by the next model of the same provider, no provider switch", async () => {
  const restore = setKeys(["gemini", "groq"]);
  try {
    const calls = [];
    const { router } = configuredRouter({
      callProvider: async ({ providerId, model }) => {
        calls.push(`${providerId}:${model}`);
        if (model === "gemini-3.8-flash") {
          throw Object.assign(new Error("Google Gemini HTTP 404: This model models/gemini-3.8-flash is no longer available to new users"), { kind: "model_unavailable", status: 404 });
        }
        return { text: "বাংলা উত্তর", providerId, model };
      }
    });
    const result = await router.ask({ userText: "প্রশ্ন" });
    assert.equal(result.providerId, "gemini");
    assert.deepEqual(calls, ["gemini:gemini-3.8-flash", "gemini:gemini-3.5-flash-lite"]);
    assert.equal(result.model, "gemini-3.5-flash-lite");
    // মডেল বদল মনে রাখা হয় যাতে পরের বার সরাসরি নতুন মডেলেই যায়
    assert.equal(router.providers.gemini.model, "gemini-3.5-flash-lite");
    assert.ok(router.history.some(entry => entry.reason === "model_fallback"));
    assert.equal(router.providers.gemini.cooldownUntil, 0, "model fallback must not punish the provider");
  } finally { restore(); }
});

test("the next message reuses the switched model directly", async () => {
  const restore = setKeys(["gemini"]);
  try {
    const models = [];
    const { router } = configuredRouter({
      callProvider: async ({ model }) => {
        models.push(model);
        if (model === "gemini-3.8-flash") throw Object.assign(new Error("Google Gemini HTTP 404: model no longer available"), { kind: "model_unavailable", status: 404 });
        return { text: "উত্তর", providerId: "gemini", model };
      }
    });
    await router.ask({ userText: "১" });
    await router.ask({ userText: "২" });
    assert.deepEqual(models, ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash-lite"]);
  } finally { restore(); }
});

test("when every model of a provider is retired, the router moves to the next provider", async () => {
  const restore = setKeys(["gemini", "groq"]);
  try {
    const calls = [];
    const { router } = configuredRouter({
      callProvider: async ({ providerId }) => {
        calls.push(providerId);
        if (providerId === "gemini") throw Object.assign(new Error("HTTP 404: model has been retired"), { kind: "model_unavailable", status: 404 });
        return { text: "ok", providerId };
      }
    });
    const result = await router.ask({ userText: "প্রশ্ন" });
    assert.equal(result.providerId, "groq");
    assert.ok(calls.filter(id => id === "gemini").length >= 2, "at least two gemini models were tried");
    assert.equal(router.providers.gemini.cooldownUntil > router.now(), true);
  } finally { restore(); }
});

test("503 high demand cools a provider for 15s, not a full minute", async () => {
  const restore = setKeys(["gemini", "groq"]);
  try {
    const { router } = configuredRouter({
      callProvider: async ({ providerId }) => {
        if (providerId === "gemini") throw Object.assign(new Error("Google Gemini HTTP 503: This model is currently experiencing high demand."), { kind: "overloaded", status: 503 });
        return { text: "ok", providerId };
      }
    });
    await router.ask({ userText: "প্রশ্ন" });
    const remaining = router.providers.gemini.cooldownUntil - router.now();
    assert.equal(remaining, 15_000);
  } finally { restore(); }
});

test("repeated rate limits keep growing, but a success resets the streak", async () => {
  const restore = setKeys(["gemini", "groq"]);
  try {
    let now = 1_000_000;
    let mode = "fail";
    const { router } = configuredRouter({
      now: () => now,
      callProvider: async ({ providerId }) => {
        if (providerId === "gemini") {
          if (mode === "fail") throw Object.assign(new Error("limited"), { kind: "rate_limit", status: 429 });
          return { text: "ok", providerId };
        }
        return { text: "ok", providerId };
      }
    });
    await router.ask({ userText: "১" });
    const first = router.providers.gemini.cooldownUntil - now;
    now = router.providers.gemini.cooldownUntil + 1;
    router.refresh("gemini");
    assert.ok(router.providers.gemini.consecutiveFailures > 0, "streak must survive the cooldown");
    await router.ask({ userText: "২" });
    const second = router.providers.gemini.cooldownUntil - now;
    assert.ok(second >= first, `cooldown must not shrink (${first} → ${second})`);
    // সফল হলে streak পুরো শূন্য
    mode = "ok";
    now = router.providers.gemini.cooldownUntil + 1;
    await router.ask({ userText: "৩" });
    assert.equal(router.providers.gemini.consecutiveFailures, 0);
    assert.equal(router.activeProviderId, "gemini");
  } finally { restore(); }
});

test("a saved retired model is migrated to a live model on restore", async () => {
  const restore = setKeys(["gemini"]);
  try {
    const state = {
      providers: { gemini: { model: "gemini-2.5-flash", enabled: true, priority: 10, requests: 5, successes: 5 } },
      totals: { requests: 5, successes: 5, failures: 0, switches: 0 }
    };
    const { router } = configuredRouter({ state });
    await router.restore();
    assert.notEqual(router.providers.gemini.model, "gemini-2.5-flash");
    assert.equal(router.providers.gemini.model, "gemini-3.8-flash");
    assert.ok(router.providers.gemini.modelMigratedAt > 0);
    // আসল聘用 ডেটা হারায় না
    assert.equal(router.providers.gemini.successes, 5);
  } finally { restore(); }
});

test("an admin-entered custom model is never overwritten on restore", async () => {
  const restore = setKeys(["groq"]);
  try {
    const state = { providers: { groq: { model: "openai/gpt-oss-20b", priority: 5 } }, totals: {} };
    const { router } = configuredRouter({ state });
    router.applyState(state);
    assert.equal(router.providers.groq.model, "openai/gpt-oss-20b");
  } finally { restore(); }
});

test("autoFallback can be turned off by an admin", async () => {
  const restore = setKeys(["gemini", "groq"]);
  try {
    const calls = [];
    const { router } = configuredRouter({
      callProvider: async ({ providerId, model }) => {
        calls.push(`${providerId}:${model}`);
        if (providerId === "gemini") throw Object.assign(new Error("HTTP 404: no longer available"), { kind: "model_unavailable", status: 404 });
        return { text: "ok", providerId, model };
      }
    });
    router.providers.gemini.autoFallback = false;
    await router.ask({ userText: "প্রশ্ন" });
    assert.equal(calls.filter(call => call.startsWith("gemini:")).length, 1, "only the configured model may be tried");
    assert.equal(router.providers.gemini.model, "gemini-3.8-flash");
  } finally { restore(); }
});

test("snapshot reports the live model plus whether auto fallback is on", async () => {
  const restore = setKeys(["gemini"]);
  try {
    const { router } = configuredRouter({ callProvider: async ({ providerId }) => ({ text: "ok", providerId }) });
    const gemini = router.snapshot().providers.find(p => p.id === "gemini");
    assert.equal(gemini.defaultModel, "gemini-3.8-flash");
    assert.equal(gemini.autoFallback, true);
    assert.ok(Array.isArray(gemini.fallbackModels) && gemini.fallbackModels.length >= 1);
  } finally { restore(); }
});

// ---- v1.5.64: টাইমআউট ও থিংকিং ----

test("a timeout is retried inside the same provider before giving up", async () => {
  const restore = setKeys(["gemini", "groq"]);
  try {
    let geminiCalls = 0;
    const waits = [];
    const calls = [];
    const router = new AiRouter({
      now: () => 1_000_000,
      providerAttempts: 2,
      wait: async ms => { waits.push(ms); },
      saveState: async () => {},
      log: () => {},
      callProvider: async ({ providerId }) => {
        calls.push(providerId);
        if (providerId === "gemini") {
          geminiCalls += 1;
          if (geminiCalls === 1) throw Object.assign(new Error("Google Gemini timeout: aborted"), { kind: "timeout" });
          return { text: "দ্বিতীয় চেষ্টায় উত্তর", providerId };
        }
        return { text: "অন্য provider", providerId };
      }
    });
    const result = await router.ask({ userText: "প্রশ্ন" });
    assert.equal(result.providerId, "gemini");
    assert.deepEqual(calls, ["gemini", "gemini"], "same provider is retried, no switch needed");
    assert.equal(waits.length, 1);
  } finally { restore(); }
});

test("only timeouts and overloads are retried, never auth or quota errors", async () => {
  const restore = setKeys(["gemini", "groq"]);
  try {
    for (const [kind, expectedCalls] of [["auth", 1], ["quota", 1], ["bad_request", 1], ["overloaded", 2], ["server", 2], ["network", 2]]) {
      let geminiCalls = 0;
      const router = new AiRouter({
        now: () => 1_000_000, providerAttempts: 2, wait: async () => {}, saveState: async () => {}, log: () => {},
        callProvider: async ({ providerId }) => {
          if (providerId === "gemini") {
            geminiCalls += 1;
            throw Object.assign(new Error(kind), { kind, status: kind === "auth" ? 401 : kind === "quota" ? 402 : 503 });
          }
          return { text: "ok", providerId };
        }
      });
      await router.ask({ userText: "প্রশ্ন" });
      assert.equal(geminiCalls, expectedCalls, `${kind} retry count`);
    }
  } finally { restore(); }
});

test("repeated timeouts grow the cooldown, a single one stays short", async () => {
  const restore = setKeys(["gemini", "groq"]);
  try {
    let now = 1_000_000;
    const router = new AiRouter({
      now: () => now, providerAttempts: 1, wait: async () => {}, saveState: async () => {}, log: () => {},
      callProvider: async ({ providerId }) => {
        if (providerId === "gemini") throw Object.assign(new Error("timeout"), { kind: "timeout" });
        return { text: "ok", providerId };
      }
    });
    await router.ask({ userText: "১" });
    const first = router.providers.gemini.cooldownUntil - now;
    assert.ok(first >= 20_000 && first <= 21_000, `first timeout cooldown ${first}`);
  } finally { restore(); }
});

test("the provider timeout never becomes a dead end: 2 attempts then the next provider answers", async () => {
  const restore = setKeys(["gemini", "groq"]);
  try {
    const calls = [];
    const router = new AiRouter({
      now: () => 1_000_000, providerAttempts: 2, wait: async () => {}, saveState: async () => {}, log: () => {},
      callProvider: async ({ providerId }) => {
        calls.push(providerId);
        if (providerId === "gemini") throw Object.assign(new Error("timeout"), { kind: "timeout" });
        return { text: "উত্তর", providerId };
      }
    });
    const result = await router.ask({ userText: "প্রশ্ন" });
    assert.equal(result.providerId, "groq");
    assert.deepEqual(calls, ["gemini", "gemini", "groq"]);
  } finally { restore(); }
});

// ---- v1.5.66: সময়ের বাজেট, পরিসংখ্যান আর ঢাকার তারিখ ----

test("a permanently slow provider cannot eat the whole budget", async () => {
  const restore = setKeys(["gemini", "groq"]);
  try {
    let clock = 0;
    const calls = [];
    const router = new AiRouter({
      now: () => clock, providerAttempts: 2, giveUpMs: 35_000,
      wait: async () => {}, saveState: async () => {}, log: () => {},
      callProvider: async ({ providerId, timeoutMs }) => {
        calls.push(`${providerId}:${timeoutMs}`);
        if (providerId === "gemini") {
          clock += timeoutMs;
          throw Object.assign(new Error("Gemini timeout"), { kind: "timeout" });
        }
        clock += 700;
        return { text: "উত্তর", providerId };
      }
    });
    const result = await router.ask({ userText: "প্রশ্ন", timeoutMs: 15_000 });
    assert.equal(result.providerId, "groq", "a healthy provider must still answer");
    const geminiSpent = calls.filter(c => c.startsWith("gemini:")).reduce((sum, c) => sum + Number(c.split(":")[1]), 0);
    assert.ok(geminiSpent <= 18_000, `gemini consumed ${geminiSpent}ms of a 35s budget`);
  } finally { restore(); }
});

test("success can never exceed requests", () => {
  const router = new AiRouter({ now: () => 1_000_000, wait: async () => {}, saveState: async () => {}, log: () => {} });
  router.providers.cerebras.successes = 5;
  router.providers.cerebras.requests = 4;
  const row = router.snapshot().providers.find(p => p.id === "cerebras");
  assert.ok(row.successRate <= 100, `successRate was ${row.successRate}%`);
  assert.equal(row.statsPending, 1);
});

test("the admin test button does not inflate the chat success counter", () => {
  const router = new AiRouter({ now: () => 1_000_000, wait: async () => {}, saveState: async () => {}, log: () => {} });
  router.providers.cerebras.requests = 4;
  router.providers.cerebras.successes = 4;
  router.recordSuccess("cerebras", null, { source: "test", countRequest: false, countDaily: false });
  const row = router.snapshot().providers.find(p => p.id === "cerebras");
  assert.equal(row.successes, 4);
  assert.equal(row.requests, 4);
  assert.equal(row.successRate, 100);
});

test("the daily counter follows the Dhaka date, not the UTC date", () => {
  const beforeMidnightDhaka = Date.UTC(2026, 10, 12, 18, 30, 0); // ঢাকা ১৩ তারিখ ০০:৩০
  const nextMorningDhaka = Date.UTC(2026, 10, 13, 1, 0, 0);      // ঢাকা ১৩ তারিখ ০৭:০০
  assert.equal(dayKey(beforeMidnightDhaka), dayKey(nextMorningDhaka));
  const router = new AiRouter({ now: () => nextMorningDhaka, wait: async () => {}, saveState: async () => {}, log: () => {} });
  router.applyState({ providers: { cerebras: { dailyDate: dayKey(beforeMidnightDhaka), dailyRequests: 7 } }, totals: {} });
  assert.equal(router.snapshot().providers.find(p => p.id === "cerebras").dailyRequests, 7);
});
