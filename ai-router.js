// AKMAFIA YT — AI router: priority, failover, cooldown, recovery, stats.
// ডিজাইন নিয়ম:
//  * কোনো provider কখনো স্থায়ীভাবে বন্ধ হয় না — শুধু admin disable করতে পারে।
//  * cooldown শেষ হলে provider আবার নিজের আগের priority-তেই ফিরে আসে।
//  * cooldown + counters + history সব Firebase-এ যায়, তাই restart-এও টেকে।
//  * cooldown-এ থাকা provider-কে একবারও ডাকা হয় না (wasteful retry নেই)।

const { AI_PROVIDERS, getProviderSpec, callProvider, parseRetryAfterMs } = require("./ai-providers");

const STATUS = {
  ACTIVE: "active",
  AVAILABLE: "available",
  RATE_LIMITED: "rate_limited",
  COOLDOWN: "cooldown",
  UNCONFIGURED: "unconfigured",
  DISABLED: "disabled"
};

const BASE_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 60 * 60 * 1000;
const AUTH_COOLDOWN_MS = 30 * 60 * 1000;
const QUOTA_COOLDOWN_MS = 60 * 60 * 1000;
const STATE_SAVE_DEBOUNCE_MS = 4_000;
const MAX_HISTORY = 60;
const MAX_ERROR_LOG = 40;
const MAX_ATTEMPTS = 4;

// প্রতিটি provider-এর free tier-এর আনুমানিক দৈনিক সীমা (শুধুই estimation, বিলিং নয়)।
const FREE_DAILY_LIMITS = {
  gemini: 1500,
  groq: 1000,
  cerebras: 900,
  openrouter: 50,
  cloudflare: 300,
  nvidia: 1000,
  cohere: 33, // 1000/মাস ≈ 33/দিন
  huggingface: 200
};

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function freshProviderState(spec, index) {
  return {
    id: spec.id,
    enabled: true,
    priority: (index + 1) * 10,
    model: spec.defaultModel,
    status: STATUS.UNCONFIGURED,
    cooldownUntil: 0,
    consecutiveFailures: 0,
    requests: 0,
    successes: 0,
    failures: 0,
    lastError: "",
    lastErrorAt: 0,
    lastUsedAt: 0,
    lastSwitchAt: 0,
    dailyDate: dayKey(),
    dailyRequests: 0
  };
}

class AiRouter {
  constructor(options = {}) {
    this.now = options.now || (() => Date.now());
    this.call = options.callProvider || callProvider;
    this.secretsProvider = options.secretsProvider || (() => ({}));
    this.onEvent = options.onEvent || (() => {});
    this.saveState = options.saveState || (async () => {});
    this.loadState = options.loadState || (async () => null);
    this.log = options.log || (() => {});
    this.timeoutMs = options.timeoutMs;

    this.providers = {};
    for (const [index, spec] of AI_PROVIDERS.entries()) {
      this.providers[spec.id] = freshProviderState(spec, index);
    }
    this.totals = { requests: 0, successes: 0, failures: 0, switches: 0 };
    this.history = [];
    this.errors = [];
    this.activeProviderId = "";
    this.lastSwitch = null;
    this.saveTimer = null;
    this.pendingSave = false;
  }

  // ---- state -------------------------------------------------------------

  applyState(state) {
    if (!state || typeof state !== "object") return;
    const providers = state.providers && typeof state.providers === "object" ? state.providers : {};
    for (const [id, saved] of Object.entries(providers)) {
      const current = this.providers[id];
      if (!current || !saved || typeof saved !== "object") continue;
      current.enabled = saved.enabled !== false;
      current.priority = clampNumber(saved.priority, 1, 9999, current.priority);
      if (typeof saved.model === "string" && saved.model.trim()) current.model = saved.model.trim().slice(0, 120);
      current.consecutiveFailures = clampNumber(saved.consecutiveFailures, 0, 100, 0);
      current.cooldownUntil = clampNumber(saved.cooldownUntil, 0, Number.MAX_SAFE_INTEGER, 0);
      current.requests = clampNumber(saved.requests, 0, 10_000_000, 0);
      current.successes = clampNumber(saved.successes, 0, 10_000_000, 0);
      current.failures = clampNumber(saved.failures, 0, 10_000_000, 0);
      current.lastError = typeof saved.lastError === "string" ? saved.lastError.slice(0, 300) : "";
      current.lastErrorAt = clampNumber(saved.lastErrorAt, 0, Number.MAX_SAFE_INTEGER, 0);
      current.lastUsedAt = clampNumber(saved.lastUsedAt, 0, Number.MAX_SAFE_INTEGER, 0);
      current.lastSwitchAt = clampNumber(saved.lastSwitchAt, 0, Number.MAX_SAFE_INTEGER, 0);
      current.dailyDate = typeof saved.dailyDate === "string" ? saved.dailyDate.slice(0, 10) : dayKey();
      current.dailyRequests = clampNumber(saved.dailyRequests, 0, 1_000_000, 0);
    }
    const totals = state.totals && typeof state.totals === "object" ? state.totals : {};
    this.totals = {
      requests: clampNumber(totals.requests, 0, 100_000_000, 0),
      successes: clampNumber(totals.successes, 0, 100_000_000, 0),
      failures: clampNumber(totals.failures, 0, 100_000_000, 0),
      switches: clampNumber(totals.switches, 0, 100_000_000, 0)
    };
    this.history = Array.isArray(state.history) ? state.history.filter(Boolean).slice(-MAX_HISTORY) : [];
    this.errors = Array.isArray(state.errors) ? state.errors.filter(Boolean).slice(-MAX_ERROR_LOG) : [];
    this.activeProviderId = typeof state.activeProviderId === "string" ? state.activeProviderId.slice(0, 40) : "";
    this.lastSwitch = state.lastSwitch && typeof state.lastSwitch === "object" ? state.lastSwitch : null;
    for (const id of Object.keys(this.providers)) {
      this.providers[id].status = this.computeStatus(id);
    }
  }

  serializeState() {
    const providers = {};
    for (const [id, p] of Object.entries(this.providers)) {
      providers[id] = {
        enabled: p.enabled,
        priority: p.priority,
        model: p.model,
        consecutiveFailures: p.consecutiveFailures,
        cooldownUntil: p.cooldownUntil,
        requests: p.requests,
        successes: p.successes,
        failures: p.failures,
        lastError: p.lastError,
        lastErrorAt: p.lastErrorAt,
        lastUsedAt: p.lastUsedAt,
        lastSwitchAt: p.lastSwitchAt,
        dailyDate: p.dailyDate,
        dailyRequests: p.dailyRequests
      };
    }
    return {
      providers,
      totals: this.totals,
      history: this.history.slice(-MAX_HISTORY),
      errors: this.errors.slice(-MAX_ERROR_LOG),
      activeProviderId: this.activeProviderId,
      lastSwitch: this.lastSwitch,
      updatedAt: this.now()
    };
  }

  async restore() {
    try {
      const state = await this.loadState();
      this.applyState(state);
      return true;
    } catch (err) {
      this.log(`AI router restore failed: ${err?.message || err}`);
      return false;
    }
  }

  // debounce করা save — বারবার Firebase write হয় না।
  queueSave() {
    this.pendingSave = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (!this.pendingSave) return;
      this.pendingSave = false;
      Promise.resolve(this.saveState(this.serializeState())).catch(err => {
        this.log(`AI router save failed: ${err?.message || err}`);
      });
    }, STATE_SAVE_DEBOUNCE_MS);
    if (typeof this.saveTimer.unref === "function") this.saveTimer.unref();
  }

  async flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.pendingSave) return;
    this.pendingSave = false;
    try {
      await this.saveState(this.serializeState());
    } catch (err) {
      this.log(`AI router flush failed: ${err?.message || err}`);
    }
  }

  // ---- status ------------------------------------------------------------

  cooldownRemaining(id) {
    const p = this.providers[id];
    if (!p) return 0;
    return Math.max(0, p.cooldownUntil - this.now());
  }

  // cooldown শেষ হলে provider স্বয়ংক্রিয়ভাবে আবার eligible — কোনো admin action লাগে না।
  // কোনো side effect ছাড়া শুধু status হিসাব — restore-এর সময় ব্যবহার হয়।
  computeStatus(id) {
    const p = this.providers[id];
    if (!p) return null;
    const spec = getProviderSpec(id);
    if (!p.enabled) return STATUS.DISABLED;
    const key = spec ? this.keyFor(spec, this.secretsProvider() || {}) : "";
    if (!key) return STATUS.UNCONFIGURED;
    if (p.cooldownUntil > this.now()) {
      return p.lastErrorKind === "rate_limit" || p.lastErrorKind === "quota" ? STATUS.RATE_LIMITED : STATUS.COOLDOWN;
    }
    return this.activeProviderId === id ? STATUS.ACTIVE : STATUS.AVAILABLE;
  }

  refresh(id) {
    const p = this.providers[id];
    if (!p) return null;
    const spec = getProviderSpec(id);
    if (!p.enabled) { p.status = STATUS.DISABLED; return p; }
    const secrets = this.secretsProvider() || {};
    const key = spec ? this.keyFor(spec, secrets) : "";
    if (!key) { p.status = STATUS.UNCONFIGURED; return p; }
    if (p.cooldownUntil > this.now()) {
      p.status = p.lastErrorKind === "rate_limit" || p.lastErrorKind === "quota" ? STATUS.RATE_LIMITED : STATUS.COOLDOWN;
      return p;
    }
    if (p.cooldownUntil && p.cooldownUntil <= this.now()) {
      // cooldown থেকে সেরে উঠেছে — failure streak ধীরে ধীরে রিসেট, priority অপরিবর্তিত।
      p.cooldownUntil = 0;
      p.consecutiveFailures = 0;
      p.lastErrorKind = "";
      this.onEvent({ type: "recovered", providerId: id, at: this.now() });
      this.pushHistory({ providerId: id, reason: "recovered" });
      this.queueSave();
    }
    p.status = this.activeProviderId === id ? STATUS.ACTIVE : STATUS.AVAILABLE;
    return p;
  }

  keyFor(spec, secrets) {
    const fromEnv = String(process.env[spec.env] || "").trim();
    if (!fromEnv) return "";
    if (spec.accountEnv && !String(process.env[spec.accountEnv] || "").trim()) {
      const fromStore = String(secrets?.[`${spec.id}AccountId`] || "").trim();
      if (!fromStore) return "";
    }
    return fromEnv;
  }

  refreshAll() {
    for (const id of Object.keys(this.providers)) this.refresh(id);
    return this.providers;
  }

  // request যাওয়ার আগে ডাকা হয় — priority অনুযায়ী সাজানো enabled list।
  order() {
    this.refreshAll();
    const usable = Object.values(this.providers).filter(p => p.enabled && p.status !== STATUS.UNCONFIGURED);
    const ready = usable.filter(p => this.cooldownRemaining(p.id) === 0);
    const cooling = usable.filter(p => this.cooldownRemaining(p.id) > 0);
    ready.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    cooling.sort((a, b) => a.cooldownUntil - b.cooldownUntil || a.priority - b.priority);
    // সবাই cooldown-এ থাকলে সবচেয়ে কম অপেক্ষার জনকে শেষ চেষ্টা হিসেবে দেওয়া হয়।
    return [...ready, ...(ready.length ? [] : cooling)];
  }

  recordFailure(provider, error) {
    const p = this.providers[provider];
    if (!p) return;
    const kind = String(error?.kind || "unknown");
    p.failures += 1;
    p.consecutiveFailures += 1;
    p.lastError = String(error?.message || error || "unknown error").slice(0, 300);
    p.lastErrorAt = this.now();
    p.lastErrorKind = kind;
    p.status = STATUS.COOLDOWN;

    let cooldown = BASE_COOLDOWN_MS * Math.pow(2, Math.min(p.consecutiveFailures - 1, 5));
    if (kind === "auth") cooldown = AUTH_COOLDOWN_MS;
    if (kind === "quota") cooldown = QUOTA_COOLDOWN_MS;
    if (kind === "rate_limit") cooldown = Math.max(cooldown, 90_000);
    const headerWait = parseRetryAfterMs(error?.headers, this.now());
    if (headerWait && headerWait > 0) cooldown = Math.max(cooldown, headerWait);
    cooldown = clampNumber(cooldown, 30_000, MAX_COOLDOWN_MS, BASE_COOLDOWN_MS);

    p.cooldownUntil = this.now() + cooldown;
    p.status = kind === "rate_limit" || kind === "quota" ? STATUS.RATE_LIMITED : STATUS.COOLDOWN;
    if (this.activeProviderId === provider) this.activeProviderId = "";

    this.errors.unshift({
      at: this.now(),
      providerId: provider,
      kind,
      status: Number(error?.status) || 0,
      message: p.lastError,
      cooldownMs: cooldown
    });
    if (this.errors.length > MAX_ERROR_LOG) this.errors.length = MAX_ERROR_LOG;

    this.onEvent({ type: "failure", providerId: provider, kind, cooldownMs: cooldown, at: this.now() });
    this.queueSave();
    return { cooldownMs: cooldown, kind };
  }

  recordSuccess(provider, usage) {
    const p = this.providers[provider];
    if (!p) return;
    const today = dayKey(this.now());
    if (p.dailyDate !== today) { p.dailyDate = today; p.dailyRequests = 0; }
    p.successes += 1;
    p.lastUsedAt = this.now();
    p.consecutiveFailures = 0;
    p.cooldownUntil = 0;
    p.lastErrorKind = "";
    if (this.activeProviderId && this.activeProviderId !== provider) {
      this.providers[this.activeProviderId].lastSwitchAt = this.now();
    }
    this.activeProviderId = provider;
    p.status = STATUS.ACTIVE;
    this.totals.successes += 1;
    if (usage && Number(usage.totalTokens) > 0) p.lastTokens = Number(usage.totalTokens);
    this.queueSave();
  }

  pushHistory(entry) {
    this.history.unshift({ at: this.now(), ...entry });
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY;
  }

  // ---- public controls ---------------------------------------------------

  setEnabled(id, enabled) {
    const p = this.providers[id];
    if (!p) return false;
    p.enabled = Boolean(enabled);
    if (!enabled && this.activeProviderId === id) this.activeProviderId = "";
    this.refresh(id);
    this.queueSave();
    return true;
  }

  setPriority(id, priority) {
    const p = this.providers[id];
    if (!p) return false;
    p.priority = clampNumber(priority, 1, 9999, p.priority);
    this.queueSave();
    return true;
  }

  setModel(id, model) {
    const p = this.providers[id];
    if (!p) return false;
    const spec = getProviderSpec(id);
    p.model = String(model || "").trim().slice(0, 120) || spec?.defaultModel || p.model;
    this.queueSave();
    return true;
  }

  // admin-এর "এখনই retry" — cooldown জোর করে শেষ করা হয়।
  clearCooldown(id) {
    const p = this.providers[id];
    if (!p) return false;
    p.cooldownUntil = 0;
    p.consecutiveFailures = 0;
    p.lastErrorKind = "";
    this.refresh(id);
    this.pushHistory({ providerId: id, reason: "admin_reset" });
    this.queueSave();
    return true;
  }

  // ---- the actual ask ----------------------------------------------------

  // একাধিক provider চেষ্টা করে প্রথম সফল উত্তর দেয়। প্রতিটি switch history-তে যায়।
  async ask({ system, history = [], userText, attempts = MAX_ATTEMPTS, timeoutMs }) {
    const order = this.order();
    if (!order.length) {
      const anyConfigured = Object.values(this.providers).some(p => p.enabled && p.status !== STATUS.UNCONFIGURED);
      const err = new Error(anyConfigured ? "সব AI provider এখন cooldown-এ আছে" : "কোনো AI provider configured নেই");
      err.kind = anyConfigured ? "all_cooling" : "not_configured";
      throw err;
    }

    const secrets = this.secretsProvider() || {};
    let previous = "";
    let lastError = null;
    const tried = [];

    for (const p of order.slice(0, Math.max(1, Math.min(attempts, order.length)))) {
      const spec = getProviderSpec(p.id);
      if (!spec) continue;
      const apiKey = String(process.env[spec.env] || "").trim();
      if (!apiKey) { p.status = STATUS.UNCONFIGURED; continue; }
      const accountId = spec.accountEnv ? String(process.env[spec.accountEnv] || secrets?.[`${spec.id}AccountId`] || "").trim() : "";

      if (previous) {
        this.totals.switches += 1;
        this.lastSwitch = {
          at: this.now(), from: previous, to: p.id,
          reason: lastError?.kind || "failover",
          message: String(lastError?.message || "").slice(0, 200)
        };
        this.pushHistory({ from: previous, to: p.id, reason: lastError?.kind || "failover", message: this.lastSwitch.message });
        this.onEvent({ type: "switch", from: previous, to: p.id, reason: this.lastSwitch.reason, at: this.now() });
      }

      p.requests += 1;
      this.totals.requests += 1;
      const today = dayKey(this.now());
      if (p.dailyDate !== today) { p.dailyDate = today; p.dailyRequests = 0; }
      p.dailyRequests += 1;

      try {
        const result = await this.call({
          providerId: p.id,
          apiKey,
          accountId,
          model: p.model || spec.defaultModel,
          system,
          history,
          userText,
          timeoutMs: timeoutMs || this.timeoutMs
        });
        this.recordSuccess(p.id, result?.usage);
        return { ...result, attempted: tried.concat(p.id), switched: tried.length > 0 };
      } catch (err) {
        lastError = err;
        this.recordFailure(p.id, err);
        this.totals.failures += 1;
        tried.push(p.id);
        this.log(`AI provider ${p.id} failed (${err?.kind || "unknown"}): ${err?.message || err}`);
        // auth/bad_request হলে ওই provider পরের বারও ব্যর্থ হবে, তবু বাকিরা চেষ্টা পাবে।
        previous = p.id;
        if (err?.kind === "bad_request" && /empty response/i.test(String(err?.message))) continue;
      }
    }

    const err = new Error(lastError ? `সব provider ব্যর্থ: ${lastError.message}` : "কোনো provider উত্তর দিতে পারেনি");
    err.kind = "all_failed";
    err.attempted = tried;
    throw err;
  }

  // ---- admin panel snapshot ---------------------------------------------

  snapshot() {
    this.refreshAll();
    const now = this.now();
    const providers = AI_PROVIDERS.map(spec => {
      const p = this.providers[spec.id];
      const cooldownMs = Math.max(0, p.cooldownUntil - now);
      const limit = FREE_DAILY_LIMITS[spec.id] || 0;
      const today = dayKey(now);
      const dailyRequests = p.dailyDate === today ? p.dailyRequests : 0;
      return {
        id: spec.id,
        label: spec.label,
        docs: spec.docs,
        env: spec.env,
        accountEnv: spec.accountEnv || "",
        configured: Boolean(String(process.env[spec.env] || "").trim()),
        enabled: p.enabled,
        priority: p.priority,
        model: p.model || spec.defaultModel,
        defaultModel: spec.defaultModel,
        status: p.status,
        active: this.activeProviderId === spec.id,
        cooldownMs,
        cooldownUntil: p.cooldownUntil || 0,
        consecutiveFailures: p.consecutiveFailures,
        requests: p.requests,
        successes: p.successes,
        failures: p.failures,
        successRate: p.requests ? Math.round((p.successes / p.requests) * 100) : 0,
        lastError: p.lastError,
        lastErrorAt: p.lastErrorAt,
        lastUsedAt: p.lastUsedAt,
        dailyRequests,
        dailyLimit: limit,
        dailyPercent: limit ? Math.min(100, Math.round((dailyRequests / limit) * 100)) : 0
      };
    });
    return {
      ok: true,
      activeProvider: this.activeProviderId || null,
      totals: this.totals,
      history: this.history.slice(0, 30),
      errors: this.errors.slice(0, 20),
      lastSwitch: this.lastSwitch,
      providers,
      updatedAt: now
    };
  }
}

module.exports = {
  AiRouter,
  STATUS,
  FREE_DAILY_LIMITS,
  BASE_COOLDOWN_MS,
  MAX_COOLDOWN_MS,
  MAX_HISTORY,
  MAX_ATTEMPTS,
  dayKey,
  freshProviderState
};
