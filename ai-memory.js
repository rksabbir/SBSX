// AKMAFIA YT — per-user memory.
// ডেটা আলাদা রাখা হয়:
//   ai_memory/users/{userId}/...  → শুধুই ইউজার ডেটা (name, short history, facts)
//   ai_memory/config              → সার্ভারের সেটিং (turn limit, retention)
// ইউজার ডেটায় কখনো API key বা সিস্টেম ইনফরমেশন যায় না।

const DB_ROOT = "ai_memory";
const DEFAULT_MAX_TURNS = 8;
const DEFAULT_MAX_FACTS = 8;
const DEFAULT_RETENTION_DAYS = 30;

function cleanText(value, max = 400) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

class AiMemory {
  constructor(options = {}) {
    this.db = options.db || null;
    this.now = options.now || (() => Date.now());
    this.log = options.log || (() => {});
    this.config = {
      enabled: options.enabled !== false,
      maxTurns: DEFAULT_MAX_TURNS,
      maxFacts: DEFAULT_MAX_FACTS,
      retentionDays: DEFAULT_RETENTION_DAYS
    };
  }

  setDb(db) {
    this.db = db || null;
  }

  path(userId) {
    return `${DB_ROOT}/users/${String(userId || "").replace(/[^\w-]/g, "")}`;
  }

  async loadConfig() {
    if (!this.db) return this.config;
    try {
      const snap = await this.db.ref(`${DB_ROOT}/config`).get();
      const value = snap.val() || {};
      if (typeof value.enabled === "boolean") this.config.enabled = value.enabled;
      const turns = Number(value.maxTurns);
      if (Number.isFinite(turns)) this.config.maxTurns = Math.min(20, Math.max(2, Math.round(turns)));
      const facts = Number(value.maxFacts);
      if (Number.isFinite(facts)) this.config.maxFacts = Math.min(30, Math.max(0, Math.round(facts)));
      const days = Number(value.retentionDays);
      if (Number.isFinite(days)) this.config.retentionDays = Math.min(365, Math.max(1, Math.round(days)));
      return this.config;
    } catch (err) {
      this.log(`AI memory config load failed: ${err?.message || err}`);
      return this.config;
    }
  }

  async load(userId) {
    if (!this.config.enabled || !this.db || !userId) {
      return { name: "", history: [], facts: [], updatedAt: 0 };
    }
    try {
      const snap = await this.db.ref(this.path(userId)).get();
      const value = snap.val() || {};
      const history = Array.isArray(value.history)
        ? value.history
            .filter(turn => turn && typeof turn.content === "string")
            .map(turn => ({ role: turn.role === "assistant" ? "assistant" : "user", content: cleanText(turn.content, 600), at: Number(turn.at) || 0 }))
            .slice(-this.config.maxTurns * 2)
        : [];
      const facts = Array.isArray(value.facts)
        ? value.facts.map(fact => cleanText(fact?.text || fact, 220)).filter(Boolean).slice(-this.config.maxFacts)
        : [];
      return { name: cleanText(value.name, 60), history, facts, updatedAt: Number(value.updatedAt) || 0 };
    } catch (err) {
      this.log(`AI memory load failed for ${userId}: ${err?.message || err}`);
      return { name: "", history: [], facts: [], updatedAt: 0 };
    }
  }

  // এক turn যোগ করা হয়; পুরোনো turn গড়িয়ে বাদ যায় যাতে DB ফুলে না যায়।
  async appendTurn(userId, userText, replyText, options = {}) {
    if (!this.config.enabled || !this.db || !userId) return false;
    const question = cleanText(userText, 600);
    if (!question) return false;
    try {
      const current = await this.load(userId);
      const history = current.history.concat([
        { role: "user", content: question, at: this.now() },
        { role: "assistant", content: cleanText(replyText, 600), at: this.now() }
      ]).slice(-this.config.maxTurns * 2);
      const facts = current.facts.slice(-this.config.maxFacts);
      const update = {
        history,
        updatedAt: this.now(),
        lastChannelId: options.channelId ? String(options.channelId) : ""
      };
      if (current.name) update.name = current.name;
      await this.db.ref(this.path(userId)).update(update);
      return true;
    } catch (err) {
      this.log(`AI memory write failed for ${userId}: ${err?.message || err}`);
      return false;
    }
  }

  async addFact(userId, fact) {
    const value = cleanText(fact, 220);
    if (!this.config.enabled || !this.db || !userId || !value) return false;
    try {
      const current = await this.load(userId);
      const facts = current.facts.concat([value]).slice(-this.config.maxFacts);
      await this.db.ref(this.path(userId)).update({ facts, updatedAt: this.now() });
      return true;
    } catch (err) {
      this.log(`AI memory fact write failed: ${err?.message || err}`);
      return false;
    }
  }

  // ইউজার চাইলে তার সব মেমোরি মুছে ফেলা যায়।
  async forget(userId) {
    if (!this.db || !userId) return false;
    try {
      await this.db.ref(this.path(userId)).remove();
      return true;
    } catch (err) {
      this.log(`AI memory delete failed: ${err?.message || err}`);
      return false;
    }
  }

  async stats() {
    if (!this.db) return { users: 0, enabled: this.config.enabled };
    try {
      const snap = await this.db.ref(`${DB_ROOT}/users`).get();
      return { users: Object.keys(snap.val() || {}).length, enabled: this.config.enabled };
    } catch (err) {
      this.log(`AI memory stats failed: ${err?.message || err}`);
      return { users: 0, enabled: this.config.enabled };
    }
  }

  // retention পার হয়ে যাওয়া ইউজার রেকর্ড ছেঁটে ফেলা হয় (কোনো history রাখা হয় না)।
  async prune() {
    if (!this.db) return { removed: 0 };
    const cutoff = this.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    const snap = await this.db.ref(`${DB_ROOT}/users`).get();
    const users = snap.val() || {};
    let removed = 0;
    for (const [userId, value] of Object.entries(users)) {
      const updatedAt = Number(value?.updatedAt) || 0;
      if (updatedAt && updatedAt < cutoff) {
        await this.forget(userId);
        removed += 1;
      }
    }
    return { removed };
  }
}

module.exports = {
  AiMemory,
  DB_ROOT,
  DEFAULT_MAX_TURNS,
  DEFAULT_MAX_FACTS,
  DEFAULT_RETENTION_DAYS
};
