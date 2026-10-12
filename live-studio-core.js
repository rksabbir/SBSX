"use strict";
const crypto = require("crypto");

function isValidInviteCode(code) {
  return typeof code === "string" && /^[A-Za-z0-9_-]{32,80}$/.test(code);
}
function inviteDigest(code) {
  return crypto.createHash("sha256").update(String(code || "")).digest("hex");
}
function participantName(value, fallback = "Live guest") {
  const cleaned = String(value || "").replace(/[\r\n\0]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 48);
  return cleaned || String(fallback || "Live guest").replace(/[\r\n\0]+/g, " ").slice(0, 48);
}
function normalizeTrackSource(source) {
  // LiveKit TrackSource may be an enum-like object in some SDK/API responses.
  // Never coerce unknown objects with String(), which can throw for custom enums.
  if (typeof source === "number") return source;
  if (typeof source === "string") return source.trim().toLowerCase();
  if (source && typeof source === "object") {
    for (const key of ["value", "name", "source", "kind"]) {
      const v = source[key];
      if (typeof v === "number" || typeof v === "string") return typeof v === "string" ? v.trim().toLowerCase() : v;
    }
    try { return JSON.stringify(source).toLowerCase(); } catch (_) { return "unknown"; }
  }
  return "";
}
function isMicrophoneTrack(track) {
  const source = normalizeTrackSource(track?.source);
  return source === 2 || source === "microphone" || (typeof source === "string" && source.includes("microphone"));
}
function screenShareQuality(value) {
  const presets = {
    "480p": { width: 854, height: 480, frameRate: 30, maxBitrate: 900_000 },
    "720p": { width: 1280, height: 720, frameRate: 30, maxBitrate: 2_000_000 },
    "1080p": { width: 1920, height: 1080, frameRate: 30, maxBitrate: 5_000_000 },
    "1440p": { width: 2560, height: 1440, frameRate: 30, maxBitrate: 7_000_000 },
    "2160p": { width: 3840, height: 2160, frameRate: 30, maxBitrate: 10_000_000 }
  };
  return presets[String(value || "1080p")] || presets["1080p"];
}
function shouldShowInRadar(channel) {
  if (!channel || channel.isThread?.() || typeof channel.send !== "function" || typeof channel.isTextBased !== "function") return false;
  if (!channel.isTextBased()) return false;
  const type = String(channel.type || "");
  if (/Category|category/i.test(type)) return false;
  return true;
}
function buildRadarMessage({ guildName, active, inviteUrl, participantCount = 0, voiceMemberCount = 0, updatedAt = Date.now(), latestActivity = "No recent activity" } = {}) {
  const title = String(guildName || "Discord server").replace(/[\r\n\0]+/g, " ").slice(0, 100);
  const stamp = Math.floor((Number(updatedAt) || Date.now()) / 1000);
  const state = active ? "🟢 LIVE NOW" : "⚫ OFFLINE";
  const line = active && inviteUrl ? `\n🎥 **Join Live Room:** ${inviteUrl}\n🎙️ Voice + screen share + fullscreen; HD quality selectable.` : "\nNo active Live Studio. Admin can start a session from the LIVE STREAM RADAR tab.";
  return `📡 **LIVE STREAM RADAR · ${title}**\nStatus: **${state}**\nRoom participants: **${Math.max(0, Number(participantCount) || 0)}** · Discord voice members: **${Math.max(0, Number(voiceMemberCount) || 0)}**\nLatest activity: ${String(latestActivity || "No recent activity").replace(/[\r\n\0]+/g, " ").slice(0, 160)}\nLast updated: <t:${stamp}:R>${line}\n\n_এই pinned message স্বয়ংক্রিয়ভাবে update হয়; duplicate message তৈরি করে না।_`.slice(0, 1900);
}
module.exports = { isValidInviteCode, inviteDigest, participantName, isMicrophoneTrack, screenShareQuality, shouldShowInRadar, buildRadarMessage };
