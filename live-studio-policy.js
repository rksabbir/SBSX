"use strict";

const crypto = require("crypto");

function normalizeStudioName(value, fallback = "Guest") {
  const name = String(value || "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return name || fallback;
}

function studioInviteDigest(code) {
  return crypto.createHash("sha256").update(String(code || "")).digest("hex");
}

function isValidStudioInviteCode(code) {
  return /^[A-Za-z0-9_-]{40,60}$/.test(String(code || ""));
}

function isGuestStudioIdentity(identity) {
  return /^guest_[a-f0-9]{24}$/.test(String(identity || ""));
}

function buildStudioVideoGrant(role, TrackSource) {
  if (!TrackSource || TrackSource.MICROPHONE === undefined) throw new TypeError("LiveKit TrackSource enum is unavailable");
  const host = role === "host";
  // An invited guest may share their own app/window/tab after the browser's native user-consent prompt.
  // Screen capture is never started automatically, and guest grants still cannot manage the room.
  const sources = [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];
  return {
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: host,
    canPublishSources: sources
  };
}

function isLiveStudioVoiceBound({ sessionChannelId, voiceChannelId, voiceStatus, readyStatus, expiresAt, now = Date.now() } = {}) {
  return Boolean(sessionChannelId && voiceChannelId
    && String(sessionChannelId) === String(voiceChannelId)
    && String(voiceStatus || "") === String(readyStatus || "READY")
    && Number(expiresAt) > Number(now));
}

module.exports = {
  normalizeStudioName,
  studioInviteDigest,
  isValidStudioInviteCode,
  isGuestStudioIdentity,
  buildStudioVideoGrant,
  isLiveStudioVoiceBound
};
