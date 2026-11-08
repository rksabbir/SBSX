"use strict";

const cacheByGuild = new Map();
const CACHE_MS = 5 * 60_000;
const MAX_MESSAGES = 100;
const MAX_RULE_TEXT = 12_000;

function messageRuleText(message) {
  const parts = [];
  const content = String(message.content || "").trim();
  if (content) parts.push(content);
  for (const embed of message.embeds || []) {
    const lines = [embed.title, embed.description].filter(Boolean).map(value => String(value).trim());
    for (const field of embed.fields || []) {
      if (field?.name || field?.value) lines.push(`${String(field.name || "").trim()}: ${String(field.value || "").trim()}`);
    }
    if (lines.length) parts.push(lines.join("\n"));
  }
  return parts.join("\n").trim().slice(0, 3_000);
}

function emptySnapshot(reason, channelId = "", channelName = "") {
  return { configured: Boolean(channelId), available: false, channelId, channelName, content: "", messageCount: 0, syncedAt: Date.now(), reason };
}

async function readDiscordServerRules(guild, { force = false } = {}) {
  const channelId = String(guild?.rulesChannelId || "");
  if (!guild || !/^\d{15,25}$/.test(channelId)) return emptySnapshot("rules_channel_not_configured");
  const cached = cacheByGuild.get(guild.id);
  if (!force && cached && cached.channelId === channelId && Date.now() - cached.syncedAt < CACHE_MS) return cached;

  let channel;
  try {
    channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId);
  } catch (_) {
    const snapshot = emptySnapshot("rules_channel_unavailable", channelId);
    cacheByGuild.set(guild.id, snapshot);
    return snapshot;
  }
  if (!channel?.isTextBased?.() || !channel.messages?.fetch) {
    const snapshot = emptySnapshot("rules_channel_not_readable", channelId, String(channel?.name || ""));
    cacheByGuild.set(guild.id, snapshot);
    return snapshot;
  }

  let fetched, pinned;
  try {
    [fetched, pinned] = await Promise.all([
      channel.messages.fetch({ limit: MAX_MESSAGES }),
      typeof channel.messages.fetchPinned === "function" ? channel.messages.fetchPinned().catch(() => new Map()) : Promise.resolve(new Map())
    ]);
  }
  catch (_) {
    const snapshot = emptySnapshot("missing_view_or_read_history_permission", channelId, String(channel.name || ""));
    cacheByGuild.set(guild.id, snapshot);
    return snapshot;
  }

  const byId = new Map([...fetched.values(), ...pinned.values()].map(message => [message.id, message]));
  const messages = [...byId.values()]
    .filter(message => message.guild?.id === guild.id)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const content = messages.map(messageRuleText).filter(Boolean).join("\n\n---\n\n").slice(-MAX_RULE_TEXT);
  const snapshot = {
    configured: true,
    available: Boolean(content),
    channelId,
    channelName: String(channel.name || "Rules").slice(0, 100),
    content,
    messageCount: messages.filter(message => messageRuleText(message)).length,
    syncedAt: Date.now(),
    reason: content ? "synced" : "no_rules_messages_found"
  };
  cacheByGuild.set(guild.id, snapshot);
  return snapshot;
}

module.exports = { readDiscordServerRules };
