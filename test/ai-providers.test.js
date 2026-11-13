"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AI_PROVIDERS, PROVIDER_IDS, getProviderSpec, providerModel, providerModelChain, isModelGoneError,
  resolveProviderKey, providerConfigured, buildChatMessages, geminiBody, geminiText, openAiText,
  cloudflareText, classifyHttpStatus, classifyError, parseRetryAfterMs
} = require("../ai-providers");

test("all eight requested providers exist with their own key + endpoint", () => {
  assert.deepEqual(PROVIDER_IDS, ["gemini", "groq", "cerebras", "openrouter", "cloudflare", "nvidia", "cohere", "huggingface"]);
  for (const spec of AI_PROVIDERS) {
    assert.ok(spec.label, `${spec.id} needs a label`);
    assert.match(spec.env, /^[A-Z0-9_]+$/, `${spec.id} needs its own env var`);
    assert.ok(spec.defaultModel, `${spec.id} needs a real default model`);
    assert.match(spec.docs, /^https:\/\//);
  }
  // প্রতি provider আলাদা key — কেউ OPENAI_API_KEY শেয়ার করে না
  const envs = AI_PROVIDERS.map(spec => spec.env);
  assert.equal(new Set(envs).size, envs.length);
  assert.ok(!envs.includes("OPENAI_API_KEY"));
});

test("cloudflare needs both account id and token", () => {
  const spec = getProviderSpec("cloudflare");
  assert.equal(spec.accountEnv, "CLOUDFLARE_ACCOUNT_ID");
  const saved = process.env.CLOUDFLARE_API_TOKEN, savedAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  try {
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    assert.equal(providerConfigured(spec, {}), false);
    assert.equal(providerConfigured(spec, { cloudflare: "tok" }), false);
    assert.equal(providerConfigured(spec, { cloudflare: "tok", cloudflareAccountId: "abc" }), true);
    process.env.CLOUDFLARE_API_TOKEN = "tok";
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    assert.equal(providerConfigured(spec, {}), true);
  } finally {
    if (saved === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = saved;
    if (savedAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID; else process.env.CLOUDFLARE_ACCOUNT_ID = savedAccount;
  }
});

test("env key wins and stored secret is only a fallback", () => {
  const spec = getProviderSpec("groq");
  const saved = process.env.GROQ_API_KEY;
  try {
    process.env.GROQ_API_KEY = "env-key";
    assert.equal(resolveProviderKey(spec, { groq: "stored" }), "env-key");
    delete process.env.GROQ_API_KEY;
    assert.equal(resolveProviderKey(spec, { groq: "stored" }), "stored");
  } finally {
    if (saved === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = saved;
  }
});

test("provider model override falls back to the real default", () => {
  const spec = getProviderSpec("gemini");
  assert.equal(providerModel(spec, {}), "gemini-3.8-flash");
  assert.equal(providerModel(spec, { gemini: "  gemini-3.5-flash-lite " }), "gemini-3.5-flash-lite");
});

test("chat messages keep the system prompt first and cap long turns", () => {
  const messages = buildChatMessages({
    system: "system",
    history: [{ role: "user", content: "হ্যালো" }, { role: "assistant", content: "কেমন আছো" }, { role: "user", content: "" }],
    userText: "নতুন প্রশ্ন"
  });
  assert.equal(messages[0].role, "system");
  assert.equal(messages.length, 4);
  assert.deepEqual(messages.map(m => m.role), ["system", "user", "assistant", "user"]);
  assert.equal(messages[3].content, "নতুন প্রশ্ন");
  assert.ok(buildChatMessages({ userText: "x".repeat(5000) })[0].content.length <= 2000);
});

test("gemini uses its own native request shape", () => {
  const body = geminiBody({ system: "নিয়ম", history: [{ role: "assistant", content: "আগের উত্তর" }], userText: "প্রশ্ন" });
  assert.equal(body.systemInstruction.parts[0].text, "নিয়ম");
  assert.equal(body.contents[0].role, "model");
  assert.equal(body.contents[1].role, "user");
  assert.equal(body.contents[1].parts[0].text, "প্রশ্ন");
  assert.ok(body.generationConfig.maxOutputTokens > 0);
});

test("response parsers read each provider's real payload", () => {
  assert.equal(geminiText({ candidates: [{ content: { parts: [{ text: "ক" }, { text: "খ" }] } }] }), "কখ");
  assert.equal(openAiText({ choices: [{ message: { content: "উত্তর" } }] }), "উত্তর");
  assert.equal(openAiText({ choices: [{ message: { content: [{ type: "text", text: "খণ্ড" }] } }] }), "খণ্ড");
  assert.equal(cloudflareText({ success: true, result: { response: "মেঘ" } }), "মেঘ");
  assert.equal(cloudflareText({ result: "সরাসরি" }), "সরাসরি");
  assert.equal(openAiText({}), "");
});

test("http status classification drives failover decisions", () => {
  assert.equal(classifyHttpStatus(429), "rate_limit");
  assert.equal(classifyHttpStatus(401), "auth");
  assert.equal(classifyHttpStatus(403), "auth");
  assert.equal(classifyHttpStatus(402), "quota");
  assert.equal(classifyHttpStatus(404), "bad_request");
  assert.equal(classifyHttpStatus(400), "bad_request");
  assert.equal(classifyHttpStatus(500), "server");
  assert.equal(classifyHttpStatus(503), "server");
  assert.equal(classifyHttpStatus(418), "http_error");
});

test("Retry-After and X-RateLimit-Reset headers are understood", () => {
  const now = 1_700_000_000_000;
  assert.equal(parseRetryAfterMs({ headers: new Map() }, now), null);
  const map = new Map([["retry-after", "12"]]);
  assert.equal(parseRetryAfterMs(new Map([["retry-after", "12"]]), now), 12_000);
  const plain = { get: name => (name.toLowerCase() === "retry-after" ? "5" : null) };
  assert.equal(parseRetryAfterMs(plain, now), 5_000);
  const dateHeader = { get: () => new Date(now + 30_000).toUTCString() };
  assert.equal(parseRetryAfterMs(dateHeader, now), 30_000);
  const resetHeader = new Map([["x-ratelimit-reset", String(Math.floor(now / 1000) + 40)]]);
  assert.equal(parseRetryAfterMs(resetHeader, now), 40_000);
  assert.equal(parseRetryAfterMs(new Map([["retry-after", "999999999"]]), now), 24 * 60 * 60 * 1000);
});

// ---- v1.5.63: বন্ধ হয়ে যাওয়া মডেলের বিরুদ্ধে সুরক্ষা ----

test("no default model is one the provider already retired", () => {
  // ২০২৬-১১-এ যাচাই করা মৃত্যুতালিকা — এগুলো আর কোনো free key-তে চলে না।
  const retired = [
    "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro",
    "llama-3.3-70b-versatile", "llama-3.1-8b-instant",
    "meta-llama/llama-4-scout-17b-16e-instruct", "qwen/qwen3-32b",
    "llama3.1-70b", "llama-4-scout-17b-16e-instruct", "qwen-3-32b",
    "meta/llama-3.1-70b-instruct", "@cf/meta/llama-3.2-3b-instruct"
  ];
  for (const spec of AI_PROVIDERS) {
    const chain = providerModelChain(spec, "", 10);
    for (const model of chain) {
      assert.ok(!retired.includes(model), `${spec.id} must not default to retired model ${model}`);
    }
    assert.ok(chain.length >= 1);
  }
});

test("every provider ships at least one fallback model", () => {
  for (const spec of AI_PROVIDERS) {
    assert.ok(Array.isArray(spec.fallbackModels) && spec.fallbackModels.length >= 1, `${spec.id} needs a fallback model`);
    const chain = providerModelChain(spec);
    assert.ok(chain.length >= 2, `${spec.id} chain must have a spare model`);
    assert.equal(new Set(chain).size, chain.length, `${spec.id} chain must not repeat`);
  }
});

test("an admin-chosen model is tried first, then the provider fallbacks", () => {
  const spec = getProviderSpec("groq");
  assert.deepEqual(providerModelChain(spec, "openai/gpt-oss-20b"), ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]);
  assert.deepEqual(providerModelChain(spec, "openai/gpt-oss-20b", 1), ["openai/gpt-oss-20b"]);
  assert.equal(providerModelChain(spec, "").length, 2);
});

test("'model gone' errors are recognised from both status and message", () => {
  assert.equal(isModelGoneError({ status: 404, message: "models/gemini-2.5-flash is no longer available to new users" }), true);
  assert.equal(isModelGoneError({ status: 404, message: "model_not_found" }), true);
  assert.equal(isModelGoneError({ status: 400, message: "The model `x` has been deprecated" }), true);
  assert.equal(isModelGoneError({ status: 404, message: "provider returned error" }), false);
  assert.equal(isModelGoneError({ status: 429, message: "rate limited" }), false);
  assert.equal(isModelGoneError({ status: 503, message: "high demand" }), false);
});

test("503 high demand is an overload, not a rate limit", () => {
  assert.equal(classifyError(503, "This model is currently experiencing high demand. Spikes in demand are usually temporary."), "overloaded");
  assert.equal(classifyError(529, "overloaded"), "overloaded");
  assert.equal(classifyError(500, "internal server error"), "server");
  assert.equal(classifyError(429, "Too many requests"), "rate_limit");
  assert.equal(classifyError(402, "quota exceeded"), "quota");
  assert.equal(classifyError(404, "model x has been retired"), "model_unavailable");
});
