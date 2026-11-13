// AKMAFIA YT — Discord-facing auto chat.
// কোনো command নেই: নির্দিষ্ট channel-এ যেকোনো সাধারণ মেসেজ পেলেই AI নিজে উত্তর দেয়।

const { AiRouter } = require("./ai-router");
const { AiMemory } = require("./ai-memory");
const { buildSystemPrompt, identityAnswer, isSeriousMessage, normalizeReply, clampForDiscord } = require("./ai-persona");
const { MAX_OUTPUT_TOKENS } = require("./ai-providers");

const DEFAULT_CHANNEL_ID = process.env.AI_CHAT_CHANNEL_ID || "1488339288289448006";
const USER_COOLDOWN_MS = Math.max(0, Number(process.env.AI_CHAT_USER_COOLDOWN_MS) || 4000);
const FAILURE_NOTICE_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_DEDUPE = 400;
const MIN_LENGTH = 2;
// প্রতি AI কলে সর্বোচ্চ এত সময়। ছোট রাখায় এক provider আটকে গেলেও দ্রুত পরেরটি উত্তর দেয়।
const AI_REPLY_TIMEOUT_MS = Math.max(8_000, Math.min(60_000, Number(process.env.AI_REPLY_TIMEOUT_MS) || 15_000));

function normalizeChannelId(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

class AiChat {
  constructor(options = {}) {
    this.db = options.db || null;
    this.log = options.log || (() => {});
    this.client = options.client || null;
    this.router = options.router || new AiRouter({ log: this.log });
    this.memory = options.memory || new AiMemory({ db: this.db, log: this.log });
    this.now = options.now || (() => Date.now());
    this.guildId = normalizeChannelId(options.guildId || "");

    this.enabled = options.enabled !== false;
    this.channels = new Set();
    const initial = options.channels || [DEFAULT_CHANNEL_ID];
    for (const id of initial) {
      const clean = normalizeChannelId(id);
      if (clean) this.channels.add(clean);
    }

    this.seenMessages = [];
    this.seenSet = new Set();
    this.userCooldowns = new Map();
    this.userQueues = new Map();
    this.lastFailureNotice = 0;
    this.noticeChannelId = "";
    this.stats = { handled: 0, replied: 0, failed: 0, skipped: 0 };
  }

  setDb(db) {
    this.db = db || null;
    this.memory.setDb(db);
    if (db) this.router.loadState = async () => {
      const snap = await db.ref("ai_router/state").get();
      return snap.val() || null;
    };
    if (db) this.router.saveState = async state => {
      await db.ref("ai_router/state").set(state);
    };
  }

  // Firebase-এ রাখা config (channel list, on/off) লোড করা হয়; না পেলে env default।
  async loadConfig() {
    if (!this.db) return { enabled: this.enabled, channels: [...this.channels] };
    try {
      const snap = await this.db.ref("ai_router/config").get();
      const value = snap.val() || {};
      if (typeof value.enabled === "boolean") this.enabled = value.enabled;
      const channels = value.autoReplyChannels;
      if (channels && typeof channels === "object") {
        const list = Object.entries(channels).filter(([, on]) => on !== false).map(([id]) => normalizeChannelId(id));
        if (list.length) {
          this.channels = new Set(list.filter(Boolean));
        }
      }
      const notice = normalizeChannelId(value.noticeChannelId);
      if (notice) this.noticeChannelId = notice;
      return { enabled: this.enabled, channels: [...this.channels] };
    } catch (err) {
      this.log(`AI chat config load failed: ${err?.message || err}`);
      return { enabled: this.enabled, channels: [...this.channels] };
    }
  }

  async saveConfig(patch = {}) {
    if (!this.db) return false;
    try {
      const update = { updatedAt: this.now() };
      if (typeof patch.enabled === "boolean") update.enabled = patch.enabled;
      if (Array.isArray(patch.channels)) {
        const map = {};
        for (const id of patch.channels) {
          const clean = normalizeChannelId(id);
          if (clean) map[clean] = true;
        }
        update.autoReplyChannels = map;
        this.channels = new Set(Object.keys(map));
      }
      if (patch.noticeChannelId !== undefined) {
        const notice = normalizeChannelId(patch.noticeChannelId);
        update.noticeChannelId = notice;
        this.noticeChannelId = notice;
      }
      if (typeof patch.enabled === "boolean") this.enabled = patch.enabled;
      await this.db.ref("ai_router/config").update(update);
      return true;
    } catch (err) {
      this.log(`AI chat config save failed: ${err?.message || err}`);
      return false;
    }
  }

  addChannel(id) {
    const clean = normalizeChannelId(id);
    if (!clean) return false;
    this.channels.add(clean);
    return true;
  }

  removeChannel(id) {
    const clean = normalizeChannelId(id);
    if (!clean) return false;
    return this.channels.delete(clean);
  }

  isEnabledChannel(channelId) {
    return this.channels.has(normalizeChannelId(channelId));
  }

  // একই মেসেজে দুইবার উত্তর যাবে না (event replay বা reconnect হলেও)।
  markSeen(messageId) {
    const id = String(messageId || "");
    if (!id) return false;
    if (this.seenSet.has(id)) return false;
    this.seenSet.add(id);
    this.seenMessages.push(id);
    if (this.seenMessages.length > MAX_DEDUPE) {
      const old = this.seenMessages.shift();
      this.seenSet.delete(old);
    }
    return true;
  }

  shouldAnswer(message, botUserId) {
    if (!this.enabled) return { ok: false, reason: "disabled" };
    if (!message || !message.author) return { ok: false, reason: "no_message" };
    if (message.author.bot) return { ok: false, reason: "bot_author" };
    if (botUserId && message.author.id === botUserId) return { ok: false, reason: "self" };
    if (message.system) return { ok: false, reason: "system" };
    if (!message.guild) return { ok: false, reason: "dm" };
    if (this.guildId && String(message.guild.id) !== this.guildId) return { ok: false, reason: "other_guild" };
    if (!this.isEnabledChannel(message.channelId)) return { ok: false, reason: "channel_off" };

    const content = String(message.content || "").trim();
    if (!content) return { ok: false, reason: "empty" };
    if (content.length < MIN_LENGTH) return { ok: false, reason: "too_short" };
    if (AiChat.looksUnsafe(content)) return { ok: false, reason: "unsafe_content" };
    // কমান্ড নেই, তবু অন্য bot-এর prefix-এ হাত দেওয়া হয় না।
    if (/^[!/.\-?]/.test(content)) return { ok: false, reason: "prefix" };

    const last = this.userCooldowns.get(message.author.id) || 0;
    if (this.now() - last < USER_COOLDOWN_MS) return { ok: false, reason: "user_cooldown" };

    return { ok: true };
  }

  // এক ইউজারের মেসেজগুলো একটার পর একটা প্রসেস হয় — একসাথে উত্তর মিশে যায় না।
  enqueue(userId, task) {
    const key = String(userId || "unknown");
    const previous = this.userQueues.get(key) || Promise.resolve();
    const next = previous.then(task, task).catch(err => {
      this.log(`AI chat queue error for ${key}: ${err?.message || err}`);
    });
    this.userQueues.set(key, next);
    next.finally(() => {
      if (this.userQueues.get(key) === next) this.userQueues.delete(key);
    });
    return next;
  }

  // মেসেজের ভেতরে থাকা data URL বা অতিরিক্ত লম্বা সংযুক্তি হলে AI-কে পাঠানো হয় না।
  static looksUnsafe(text) {
    const value = String(text || "");
    return /data:[a-z]+\/[a-z0-9.+-]+;base64/i.test(value) || value.length > 2000;
  }

  async handleMessage(message) {
    const botUserId = this.client?.user?.id || "";
    // dedupe আগে — একই মেসেজের দ্বিতীয় event যেন cooldown-এর অজুহাতে ভিন্ন কিছু না করে।
    if (this.seenSet.has(String(message?.id || ""))) return { handled: false, reason: "duplicate" };
    const decision = this.shouldAnswer(message, botUserId);
    if (!decision.ok) {
      if (decision.reason !== "channel_off" && decision.reason !== "bot_author") this.stats.skipped += 1;
      return { handled: false, reason: decision.reason };
    }
    if (!this.markSeen(message.id)) return { handled: false, reason: "duplicate" };

    this.stats.handled += 1;
    this.userCooldowns.set(message.author.id, this.now());
    const text = String(message.content || "").trim();

    return this.enqueue(message.author.id, async () => {
      const channel = message.channel;
      try {
        if (typeof channel?.sendTyping === "function") channel.sendTyping().catch(() => {});

        // পরিচয়-প্রশ্ন হলে AI-কে জিজ্ঞেস না করেই নিশ্চিত উত্তর।
        const fixed = identityAnswer(text);
        if (fixed) {
          await this.sendReply(message, fixed.text);
          this.stats.replied += 1;
          await this.memory.appendTurn(message.author.id, text, fixed.text, { channelId: message.channelId });
          return { handled: true, provider: "identity", identity: fixed.id };
        }

        const serious = isSeriousMessage(text);
        const recall = await this.memory.load(message.author.id);
        const system = buildSystemPrompt({
          serious,
          memory: recall.facts,
          userName: message.member?.displayName || message.author.username || ""
        });

        // মোট সময়সীমা: একক provider-এর timeout ছোট রাখা হয়, যাতে একজন ব্যর্থ provider
        // পুরো উত্তরের জন্য ২০+ সেকেন্ড আটকে না রাখে। ধীর উত্তর দরকার হলে দীর্ঘ timeout।
        const result = await this.router.ask({
          system,
          history: recall.history.slice(-8),
          userText: text,
          timeoutMs: AI_REPLY_TIMEOUT_MS
        });

        const reply = clampForDiscord(normalizeReply(result.text));
        if (!reply) throw Object.assign(new Error("empty reply after normalize"), { kind: "empty" });

        await this.sendReply(message, reply);
        this.stats.replied += 1;
        await this.memory.appendTurn(message.author.id, text, reply, { channelId: message.channelId });
        return { handled: true, provider: result.providerId, switched: Boolean(result.switched) };
      } catch (err) {
        this.stats.failed += 1;
        this.log(`AI chat reply failed: ${err?.message || err}`);
        await this.notifyFailure(err);
        return { handled: true, error: String(err?.message || err) };
      }
    });
  }

  async sendReply(message, text) {
    const payload = { content: text, allowedMentions: { repliedUser: false, parse: [] } };
    try {
      await message.reply(payload);
    } catch (err) {
      this.log(`AI reply send failed, trying channel.send: ${err?.message || err}`);
      await message.channel.send(payload);
    }
  }

  // সব provider ডাউন হলে চ্যানেলে বারবার দুঃখ প্রকাশ নয় — ৫ মিনিটে একবার।
  async notifyFailure(err) {
    if (this.now() - this.lastFailureNotice < FAILURE_NOTICE_COOLDOWN_MS) return;
    this.lastFailureNotice = this.now();
    const channelId = this.noticeChannelId || [...this.channels][0];
    if (!channelId || !this.client?.channels?.cache) return;
    const channel = this.client.channels.cache.get(channelId);
    if (!channel?.send) return;
    const text = err?.kind === "not_configured"
      ? "⚙️ এখনো কোনো AI provider-এর API key সেট করা হয়নি। অ্যাডমিন প্যানেলের AI Management থেকে key দিন।"
      : "😅 এই মুহূর্তে সব AI একসাথে ব্যস্ত/কুলডাউনে আছে। কয়েক মিনিট পরে আবার চেষ্টা করো।";
    channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
  }

  // panel-এর জন্য সংক্ষিপ্ত অবস্থা
  snapshot() {
    return {
      enabled: this.enabled,
      channels: [...this.channels],
      noticeChannelId: this.noticeChannelId,
      stats: this.stats,
      pendingQueues: this.userQueues.size,
      router: this.router.snapshot()
    };
  }

  async shutdown() {
    await Promise.allSettled([...this.userQueues.values()]);
    await this.router.flush();
  }
}

module.exports = {
  AiChat,
  DEFAULT_CHANNEL_ID,
  USER_COOLDOWN_MS,
  MAX_DEDUPE,
  normalizeChannelId,
  MIN_LENGTH,
  AI_REPLY_TIMEOUT_MS,
  MAX_OUTPUT_TOKENS
};
