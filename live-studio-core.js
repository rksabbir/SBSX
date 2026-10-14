"use strict";
const crypto = require("crypto");

const TRACK_SOURCE = Object.freeze({ MICROPHONE: 2, SCREEN_SHARE: 3, SCREEN_SHARE_AUDIO: 4 });
function isValidInviteCode(code) { return typeof code === "string" && /^[A-Za-z0-9_-]{32,80}$/.test(code); }
function inviteDigest(code) { return crypto.createHash("sha256").update(String(code || "")).digest("hex"); }
function cleanName(value, fallback = "Live guest") {
  const s = String(value || "").replace(/[\r\n\0]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 48);
  return s || fallback;
}
function safeTrackSource(source) {
  // LiveKit TrackSource is a numeric protobuf enum; never call String() on an enum object.
  if (typeof source === "number" && Number.isFinite(source)) return source;
  if (typeof source === "string") {
    const s = source.trim().toLowerCase();
    if (s === "microphone") return TRACK_SOURCE.MICROPHONE;
    if (s === "screen_share" || s === "screenshare") return TRACK_SOURCE.SCREEN_SHARE;
    if (s === "screen_share_audio" || s === "screenshareaudio") return TRACK_SOURCE.SCREEN_SHARE_AUDIO;
    const n = Number(s); return Number.isFinite(n) ? n : 0;
  }
  if (source && typeof source === "object") {
    for (const key of ["value", "number", "source", "kind", "name"]) {
      const value = source[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string") return safeTrackSource(value);
    }
  }
  return 0;
}
function trackFlags(tracks = []) {
  const sourceList = Array.isArray(tracks) ? tracks.map(t => safeTrackSource(t?.source)) : [];
  return {
    microphonePublished: sourceList.includes(TRACK_SOURCE.MICROPHONE),
    screenSharing: sourceList.includes(TRACK_SOURCE.SCREEN_SHARE),
    screenShareAudio: sourceList.includes(TRACK_SOURCE.SCREEN_SHARE_AUDIO)
  };
}
function normalizeDurationMinutes(value, fallback = 60) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(5, Math.min(480, Math.round(num)));
}
function safeOrigin(value, allowedOrigins, fallback) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return fallback;
    return allowedOrigins.has(url.origin) ? url.origin : fallback;
  } catch (_) { return fallback; }
}
function shouldUseTextChannel(channel, ChannelType) {
  if (!channel || channel.isThread?.() || typeof channel.send !== "function" || typeof channel.isTextBased !== "function" || !channel.isTextBased()) return false;
  return channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
}
function buildRadarMessage({ guildName = "Discord server", inviteUrl = "", active = false, durationMinutes = 0, endsAt = 0, participantCount = 0, screenShareCount = 0, voiceMemberCount = 0, updatedAt = Date.now(), latestActivity = "Waiting for live activity" } = {}) {
  const guild = String(guildName || "Discord server").replace(/[\r\n\0]+/g, " ").slice(0, 90);
  const state = active ? "🟢 LIVE NOW" : "⚫ LIVE OFFLINE";
  const liveLine = active && inviteUrl ? `\n🔗 **Join Live:** ${inviteUrl}\n⏱️ Duration: **${Math.max(5, Number(durationMinutes) || 60)} minutes** · Screen shares: **${Math.max(0, Number(screenShareCount) || 0)}**` : "\nThis live session has ended. The invite is no longer valid.";
  const stamp = Math.floor((Number(updatedAt) || Date.now()) / 1000);
  const endLine = active && endsAt ? `\n⏳ Scheduled end: <t:${Math.floor(Number(endsAt) / 1000)}:R>` : "";
  return `📡 **LIVE STREAM RADAR · ${guild}**\nStatus: **${state}**\nLive participants: **${Math.max(0, Number(participantCount) || 0)}** · Screen sharing: **${Math.max(0, Number(screenShareCount) || 0)}**\nDiscord voice members: **${Math.max(0, Number(voiceMemberCount) || 0)}**\nLatest activity: ${String(latestActivity || "Waiting").replace(/[\r\n\0]+/g, " ").slice(0, 140)}${endLine}${liveLine}\nLast synced: <t:${stamp}:R>`.slice(0, 1900);
}
module.exports = { TRACK_SOURCE, isValidInviteCode, inviteDigest, cleanName, safeTrackSource, trackFlags, normalizeDurationMinutes, safeOrigin, shouldUseTextChannel, buildRadarMessage };
