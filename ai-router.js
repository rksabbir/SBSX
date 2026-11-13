// AKMAFIA YT — AI router: priority, failover, cooldown, recovery, stats.
// ডিজাইন নিয়ম:
//  * কোনো provider কখনো স্থায়ীভাবে বন্ধ হয় না — শুধু admin disable করতে পারে।
//  * cooldown শেষ হলে provider আবার নিজের আগের priority-তেই ফিরে আসে।
//  * cooldown + counters + history সব Firebase-এ যায়, তাই restart-এও টেকে।
//  * cooldown-এ থাকা provider-কে একবারও ডাকা হয় না (wasteful retry নেই)।

const { AI_PROVIDERS, getProviderSpec, callProvider, parseRetryAfterMs, providerModelChain, isModelGoneError } = require("./ai-providers");

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
// 5xx / "high demand" কয়েক সেকেন্ডেই ঠিক হয়ে যায়, তাই লম্বা cooldown নয়।
const OVERLOAD_COOLDOWN_MS = 15_000;
const MODEL_GONE_COOLDOWN_MS = 10 * 60 * 1000;
// এই সময় কোনো ব্যর্থতা না হলে failure streak ক্ষমা করা হয় (cooldown-এ গোনা হয় না)।
const STREAK_FORGIVE_MS = 10 * 60 * 1000;
// টাইমআউট: একবার হলে দ্রুত আবার চেষ্টা, বারবার হলে ক্রমবর্ধমান।
const TIMEOUT_COOLDOWN_MS = 20_000;
const DEFAULT_PROVIDER_TIMEOUT_MS = 20_000;
const STATE_SAVE_DEBOUNCE_MS = 4_000;
const MAX_HISTORY = 60;
const MAX_ERROR_LOG = 40;
const MAX_ATTEMPTS = 4;

// প্রতিটি provider-এর free tier-এর আনুমানিক দৈনিক সীমা (শুধুই estimation, বিলিং নয়)।
const FREE_DAILY_LIMITS = {
  gemini: 500,     // Flash-Lite ~৫০০/দিন; Flash ~২০/দিন
  groq: 1000,
  cerebras: 900,
  openrouter: 50,
  cloudflare: 300,
  nvidia: 1000,
  cohere: 33,      // 1000/মাস ≈ 33/দিন
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
    dailyRequests: 0,
    autoFallback: true,
    modelMigratedAt: 0
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
    // প্রতি provider-এ কতবার চেষ্টা (১–২)। 기본 ২ — একবার timeout হলে দ্বিতীয় সুযোগ।
    this.providerAttempts = clampNumber(options.providerAttempts ?? 2, 1, 2, 2);
    this.wait = options.wait || null;

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
      // পুরোনো (এখন বন্ধ) ডিফল্ট মডেল সেভ করা থাকলে নতুন ডিফল্টে মাইগ্রেট করা হয় —
      // নাহলে restart-এর পরেও বট মরা মডেলেই আটকে থাকবে।
      if (this.isStaleModel(id, current.model)) {
        current.model = getProviderSpec(id).defaultModel;
        current.modelMigratedAt = this.now();
      }
      current.autoFallback = saved.autoFallback !== false;
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
        dailyRequests: p.dailyRequests,
        autoFallback: p.autoFallback !== false,
        modelMigratedAt: p.modelMigratedAt || 0
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

  // সেভ করা মডেলটি কি এই provider-এর আর কোনো ব্যবহারযোগ্য মডেলের তালিকায় নেই?
  // (অর্থাৎ provider সেটি বন্ধ করে দিয়েছে) — হলে নতুন ডিফল্টে মাইগ্রেট করা হয়।
  isStaleModel(id, model) {
    const spec = getProviderSpec(id);
    const value = String(model || "").trim();
    if (!spec || !value) return false;
    return !providerModelChain(spec, "", 10).includes(value);
  }

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

  // cooldown শেষ হলে provider স্বয়ংক্রিয়ভাবে আবার eligible — কোনো admin action লাগে না।
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
      // cooldown শেষ। streak ইচ্ছাকৃতভাবে রাখা হয় (শূন্য নয়), যাতে সত্যিই বারবার ব্যর্থ provider-এর
      // cooldown ধাপে ধাপে বাড়ে — একবার সফল হলেই streak পুরো শূন্য হয়।
      // ৩০ মিনিট কোনো ব্যর্থতা না থাকলে streak ক্ষমা করা হয়, যাতে পুরোনো ভুল চিরকাল বহন না করে।
      p.cooldownUntil = 0;
      if (p.lastErrorAt && this.now() - p.lastErrorAt > STREAK_FORGIVE_MS) p.consecutiveFailures = 0;
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

    // ধরন অনুযায়ী cooldown: সার্ভার ব্যস্ত হলে ছোট, কোটা/মডেল বন্ধ হলে বড়।
    let cooldown;
    if (kind === "overloaded") cooldown = OVERLOAD_COOLDOWN_MS;
    else if (kind === "timeout") cooldown = TIMEOUT_COOLDOWN_MS * Math.pow(2, Math.min(Math.max(p.consecutiveFailures, 1) - 1, 3));
    else if (kind === "server") cooldown = Math.min(BASE_COOLDOWN_MS, OVERLOAD_COOLDOWN_MS * 2);
    else if (kind === "auth") cooldown = AUTH_COOLDOWN_MS;
    else if (kind === "quota") cooldown = QUOTA_COOLDOWN_MS;
    else if (kind === "model_unavailable") cooldown = MODEL_GONE_COOLDOWN_MS;
    else if (kind === "rate_limit") cooldown = Math.max(BASE_COOLDOWN_MS * Math.pow(2, Math.min(Math.max(p.consecutiveFailures, 1) - 1, 4)), 90_000);
    else cooldown = BASE_COOLDOWN_MS * Math.pow(2, Math.min(Math.max(p.consecutiveFailures, 1) - 1, 5));
    const headerWait = parseRetryAfterMs(error?.headers, this.now());
    if (headerWait && headerWait > 0) cooldown = Math.max(cooldown, headerWait);
    cooldown = clampNumber(cooldown, OVERLOAD_COOLDOWN_MS, MAX_COOLDOWN_MS, BASE_COOLDOWN_MS);

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
    p.autoFallback = p.autoFallback !== false;
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

  // একই provider-এর ভেতরে ছোট retry সিঁড়ি।
  // হালকা provider (Gemini) একবার ব্যস্ত থাকলে বা সময় শেষ হলে সাথে সাথে পুরো provider
  // বাদ দেওয়া wasteful — তাই maxAttempts-এর মধ্যে ছোট বিরতি দিয়ে আবার চেষ্টা করা হয়।
  // ধীর provider-এর জন্য বেশি retry নয়; timeout-ও ক্রমবর্ধমান।
  async callWithRetry(args, options = {}) {
    const maxAttempts = clampNumber(options.maxAttempts ?? this.providerAttempts, 1, 2, 1);
    const delays = options.delays || [300, 900];
    let lastError = null;
    let timeoutMs = Number(args.timeoutMs) || DEFAULT_PROVIDER_TIMEOUT_MS;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await this.call({ ...args, timeoutMs });
      } catch (err) {
        lastError = err;
        const retryable = ["overloaded", "server", "timeout", "network"].includes(String(err?.kind || ""));
        if (!retryable || attempt === maxAttempts - 1) break;
        // পরে আসা model-gone/auth/quota ভুলগুলো retry করে লাভ নেই।
        await this.sleep(delays[Math.min(attempt, delays.length - 1)]);
        timeoutMs = Math.round(timeoutMs * 1.5);
      }
    }
    throw lastError;
  }

  sleep(ms) {
    if (!ms || ms <= 0) return Promise.resolve();
    if (this.wait) return this.wait(ms);
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      if (typeof timer.unref === "function") timer.unref();
    });
  }

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

      // একই provider-এর মডেল চেইন: প্রাথমিক মডেল বন্ধ/404 হলে স্বয়ংক্রিয়ভাবে পরের মডেল।
      const chain = p.autoFallback === false
        ? [p.model || spec.defaultModel]
        : providerModelChain(spec, p.model, 3);

      let providerError = null;
      let modelSwitched = false;
      for (const [index, model] of chain.entries()) {
        try {
          const result = await this.callWithRetry({
            providerId: p.id,
            apiKey,
            accountId,
            model,
            system,
            history,
            userText,
            timeoutMs: timeoutMs || this.timeoutMs
          });
          if (model !== p.model) {
            // মডেল বদলেছে — admin প্যানেলে দেখা যাবে, আর পরের বার সরাসরি এটাই ব্যবহার হবে।
            const previousModel = p.model;
            p.model = model;
            modelSwitched = true;
            this.pushHistory({ providerId: p.id, reason: "model_fallback", message: `${previousModel} → ${model}` });
            this.errors.unshift({ at: this.now(), providerId: p.id, kind: "model_fallback", status: 404, message: `${previousModel} বন্ধ, এখন ${model} ব্যবহার হচ্ছে`, cooldownMs: 0 });
            if (this.errors.length > MAX_ERROR_LOG) this.errors.length = MAX_ERROR_LOG;
            this.log(`AI ${p.id} model switched ${previousModel} → ${model}`);
          }
          this.recordSuccess(p.id, result?.usage);
          return { ...result, attempted: tried.concat(p.id), switched: tried.length > 0 };
        } catch (err) {
          providerError = err;
          // মডেলটাই বন্ধ হলে পরের মডেল চেষ্টা করা হয়; অন্য error হলে provider ছেড়ে দেওয়া হয়।
          const hasNextModel = index < chain.length - 1;
          if (p.autoFallback !== false && isModelGoneError(err) && hasNextModel) {
            this.pushHistory({ providerId: p.id, reason: "model_gone", message: `${model}: ${String(err?.message || "").slice(0, 120)}` });
            continue;
          }
          break;
        }
      }

      const err = providerError || Object.assign(new Error(`${spec.label} failed`), { kind: "unknown" });
      // সব মডেলই অচল হলে এটা provider-level সমস্যা, কেবল মডেল বদলে ঠিক হবে না।
      if (isModelGoneError(err)) err.kind = "model_unavailable";
      if (modelSwitched) err.modelSwitched = true;
      lastError = err;
      this.recordFailure(p.id, err);
      this.totals.failures += 1;
      tried.push(p.id);
      this.log(`AI provider ${p.id} failed (${err?.kind || "unknown"}): ${err?.message || err}`);
      previous = p.id;
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
        autoFallback: p.autoFallback !== false,
        fallbackModels: Array.isArray(spec.fallbackModels) ? spec.fallbackModels : [],
        modelMigratedAt: p.modelMigratedAt || 0,
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
  STREAK_FORGIVE_MS,
  TIMEOUT_COOLDOWN_MS,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  dayKey,
  freshProviderState
};
