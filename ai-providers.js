// AKMAFIA YT — multi-provider AI adapters.
// প্রতিটি provider-এর নিজের endpoint/body/parse আছে, কিন্তু বাইরে সবাই একই
// `{ text, usage }` shape ফেরত দেয়। সব endpoint official documentation অনুযায়ী,
// এবং কোনো network call module load হওয়ার সময় হয় না।

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_TOKENS = 400;

// provider id → কীভাবে ডাকা হবে। `env` হলো API key-এর environment variable নাম।
const AI_PROVIDERS = [
  {
    id: "gemini", label: "Google Gemini", env: "GEMINI_API_KEY",
    defaultModel: "gemini-2.5-flash", kind: "gemini",
    docs: "https://ai.google.dev/gemini-api/docs"
  },
  {
    id: "groq", label: "Groq", env: "GROQ_API_KEY",
    defaultModel: "llama-3.3-70b-versatile", kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1", docs: "https://console.groq.com/docs"
  },
  {
    id: "cerebras", label: "Cerebras", env: "CEREBRAS_API_KEY",
    defaultModel: "llama3.1-8b", kind: "openai",
    baseUrl: "https://api.cerebras.ai/v1", docs: "https://inference-docs.cerebras.ai"
  },
  {
    id: "openrouter", label: "OpenRouter", env: "OPENROUTER_API_KEY",
    defaultModel: "openrouter/free", kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1", docs: "https://openrouter.ai/docs",
    extraHeaders: { "HTTP-Referer": "https://discord.com", "X-Title": "AKMAFIA YT" }
  },
  {
    id: "cloudflare", label: "Cloudflare Workers AI", env: "CLOUDFLARE_API_TOKEN",
    accountEnv: "CLOUDFLARE_ACCOUNT_ID",
    defaultModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", kind: "cloudflare",
    docs: "https://developers.cloudflare.com/workers-ai/"
  },
  {
    id: "nvidia", label: "NVIDIA NIM", env: "NVIDIA_API_KEY",
    defaultModel: "meta/llama-3.3-70b-instruct", kind: "openai",
    baseUrl: "https://integrate.api.nvidia.com/v1", docs: "https://build.nvidia.com"
  },
  {
    id: "cohere", label: "Cohere", env: "COHERE_API_KEY",
    defaultModel: "command-a-03-2025", kind: "openai",
    baseUrl: "https://api.cohere.ai/compatibility/v1", docs: "https://docs.cohere.com/docs/compatibility-api"
  },
  {
    id: "huggingface", label: "Hugging Face", env: "HF_TOKEN",
    defaultModel: "openai/gpt-oss-20b", kind: "openai",
    baseUrl: "https://router.huggingface.co/v1", docs: "https://huggingface.co/docs/inference-providers"
  }
];

const PROVIDER_IDS = AI_PROVIDERS.map(provider => provider.id);

function getProviderSpec(id) {
  return AI_PROVIDERS.find(provider => provider.id === String(id || "")) || null;
}

function providerModel(spec, overrides = {}) {
  const custom = String(overrides?.[spec.id] || "").trim();
  return (custom || spec.defaultModel).slice(0, 120);
}

// API key কোথা থেকে আসবে: প্রথমে env, তারপর Firebase-এ admin-সেভ করা secret।
function resolveProviderKey(spec, secrets = {}) {
  const fromEnv = String(process.env[spec.env] || "").trim();
  if (fromEnv) return fromEnv;
  const fromStore = String(secrets?.[spec.id] || "").trim();
  return fromStore;
}

function resolveProviderAccount(spec, secrets = {}) {
  if (!spec.accountEnv) return "";
  const fromEnv = String(process.env[spec.accountEnv] || "").trim();
  if (fromEnv) return fromEnv;
  return String(secrets?.[`${spec.id}AccountId`] || "").trim();
}

function providerConfigured(spec, secrets = {}) {
  const key = resolveProviderKey(spec, secrets);
  if (!key) return false;
  if (spec.accountEnv && !resolveProviderAccount(spec, secrets)) return false;
  return true;
}

// system + history + user message → প্রতিটি provider-এর নিজের message ফরম্যাট।
function buildChatMessages({ system, history = [], userText }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: String(system).slice(0, 6000) });
  for (const turn of history) {
    const content = String(turn?.content || "").trim().slice(0, 1200);
    if (!content) continue;
    const role = turn?.role === "assistant" ? "assistant" : "user";
    messages.push({ role, content });
  }
  messages.push({ role: "user", content: String(userText || "").slice(0, 2000) });
  return messages;
}

function geminiBody({ system, history, userText }) {
  const contents = [];
  for (const turn of history) {
    const text = String(turn?.content || "").trim().slice(0, 1200);
    if (!text) continue;
    contents.push({ role: turn?.role === "assistant" ? "model" : "user", parts: [{ text }] });
  }
  contents.push({ role: "user", parts: [{ text: String(userText || "").slice(0, 2000) }] });
  const body = { contents, generationConfig: { temperature: 0.85, maxOutputTokens: MAX_OUTPUT_TOKENS } };
  if (system) body.systemInstruction = { parts: [{ text: String(system).slice(0, 6000) }] };
  return body;
}

function geminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map(part => part?.text || "").join("").trim();
}

function openAiText(data) {
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map(part => (typeof part === "string" ? part : part?.text || "")).join("").trim();
  return "";
}

function cloudflareText(data) {
  const result = data?.result;
  if (typeof result === "string") return result.trim();
  if (typeof result?.response === "string") return result.response.trim();
  if (Array.isArray(result?.choices)) return openAiText(result);
  return "";
}

function providerUsage(providerId, data) {
  const usage = data?.usage || data?.usageMetadata || data?.result?.usage || {};
  const prompt = Number(usage.prompt_tokens ?? usage.promptTokenCount ?? usage.input_tokens) || 0;
  const completion = Number(usage.completion_tokens ?? usage.candidatesTokenCount ?? usage.output_tokens) || 0;
  return { providerId, promptTokens: prompt, completionTokens: completion, totalTokens: prompt + completion };
}

// এক request তৈরি করে POST করে। network/HTTP ব্যর্থতা throw করে `classifyProviderError` দিয়ে।
async function callProvider({ providerId, apiKey, accountId, model, system, history, userText, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const spec = getProviderSpec(providerId);
  if (!spec) throw Object.assign(new Error(`Unknown AI provider: ${providerId}`), { kind: "bad_request" });
  if (!apiKey) throw Object.assign(new Error(`${spec.label} API key missing`), { kind: "auth" });

  let url; let headers; let body;
  const messages = buildChatMessages({ system, history, userText });

  if (spec.kind === "gemini") {
    const modelId = String(model || spec.defaultModel).replace(/^models\//, "");
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
    headers = { "Content-Type": "application/json", "x-goog-api-key": apiKey };
    body = geminiBody({ system, history, userText });
  } else if (spec.kind === "cloudflare") {
    if (!accountId) throw Object.assign(new Error("Cloudflare account id missing"), { kind: "auth" });
    const modelId = String(model || spec.defaultModel);
    url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${modelId}`;
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
    body = { messages, max_tokens: MAX_OUTPUT_TOKENS };
  } else {
    url = `${spec.baseUrl}/chat/completions`;
    headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(spec.extraHeaders || {})
    };
    body = { model: model || spec.defaultModel, messages, max_tokens: MAX_OUTPUT_TOKENS, temperature: 0.85 };
  }

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    const timeout = err?.name === "TimeoutError" || err?.name === "AbortError";
    throw Object.assign(new Error(`${spec.label} ${timeout ? "timeout" : "network error"}: ${err?.message || err}`), {
      kind: timeout ? "timeout" : "network",
      providerId
    });
  }

  const raw = await response.text().catch(() => "");
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = null; }

  if (!response.ok) {
    const detail = String(data?.error?.message || data?.message || data?.errors?.[0]?.message || raw || "").slice(0, 300);
    throw Object.assign(new Error(`${spec.label} HTTP ${response.status}: ${detail}`), {
      kind: classifyHttpStatus(response.status),
      status: response.status,
      providerId,
      headers: response.headers,
      detail
    });
  }

  const text = spec.kind === "gemini" ? geminiText(data) : spec.kind === "cloudflare" ? cloudflareText(data) : openAiText(data);
  if (!text) {
    throw Object.assign(new Error(`${spec.label} returned an empty response`), { kind: "empty", providerId });
  }
  return { providerId, model: model || spec.defaultModel, text, usage: providerUsage(providerId, data) };
}

function classifyHttpStatus(status) {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota";
  if (status === 400 || status === 404 || status === 413 || status === 422) return "bad_request";
  if (status >= 500) return "server";
  return "http_error";
}

// Retry-After (seconds বা HTTP date) আর X-RateLimit-Reset পড়া হয়।
function parseRetryAfterMs(headers, now = Date.now()) {
  if (!headers) return null;
  const read = name => {
    if (typeof headers.get === "function") return headers.get(name);
    const key = Object.keys(headers).find(entry => entry.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : null;
  };
  const retryAfter = read("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 24 * 60 * 60 * 1000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date) && date > now) return Math.min(date - now, 24 * 60 * 60 * 1000);
  }
  const reset = Number(read("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    // কেউ epoch seconds, কেউ delta seconds পাঠায় — দুটোই সামলানো হয়।
    const asEpoch = reset > 1_000_000_000 ? reset * 1000 - now : reset * 1000;
    if (asEpoch > 0) return Math.min(asEpoch, 24 * 60 * 60 * 1000);
  }
  return null;
}

module.exports = {
  AI_PROVIDERS,
  PROVIDER_IDS,
  DEFAULT_TIMEOUT_MS,
  MAX_OUTPUT_TOKENS,
  getProviderSpec,
  providerModel,
  resolveProviderKey,
  resolveProviderAccount,
  providerConfigured,
  buildChatMessages,
  geminiBody,
  geminiText,
  openAiText,
  cloudflareText,
  providerUsage,
  callProvider,
  classifyHttpStatus,
  parseRetryAfterMs
};
