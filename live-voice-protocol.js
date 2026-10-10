"use strict";

const HEADER_BYTES = 20;
const MAX_PCM_PACKET_BYTES = 96 * 1024;

function normalizeRecorderMimeType(value) {
  const mime = String(value || "").trim().toLowerCase();
  if (!mime || mime.length > 120 || /[\r\n\0]/.test(mime)) return null;
  if (mime.startsWith("audio/webm")) return "webm";
  if (mime.startsWith("audio/ogg")) return "ogg";
  if (mime.startsWith("audio/mp4")) return "mov";
  return null;
}

function extractOneTimeTicketFromProtocols(header) {
  const protocols = String(header || "").split(",").map(item => item.trim()).filter(Boolean);
  if (!protocols.includes("rkbackles-live-v1")) return null;
  const value = protocols.find(item => item.startsWith("rkbackles-ticket."));
  const ticket = value ? value.slice("rkbackles-ticket.".length) : "";
  return /^[A-Za-z0-9_-]{40,60}$/.test(ticket) ? ticket : null;
}

function packRemotePcmFrame(userId, pcm) {
  const id = String(userId || "");
  if (!/^\d{15,20}$/.test(id)) throw new TypeError("Invalid Discord user ID");
  if (!Buffer.isBuffer(pcm) || pcm.length === 0 || pcm.length > MAX_PCM_PACKET_BYTES || pcm.length % 4 !== 0) {
    throw new TypeError("Invalid stereo PCM packet");
  }
  const frame = Buffer.allocUnsafe(HEADER_BYTES + pcm.length);
  frame.fill(0, 0, HEADER_BYTES);
  frame.write(id, 0, HEADER_BYTES, "ascii");
  pcm.copy(frame, HEADER_BYTES);
  return frame;
}

function unpackRemotePcmFrame(value) {
  const frame = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (frame.length <= HEADER_BYTES || frame.length > HEADER_BYTES + MAX_PCM_PACKET_BYTES || (frame.length - HEADER_BYTES) % 4 !== 0) return null;
  const userId = frame.subarray(0, HEADER_BYTES).toString("ascii").replace(/\0.*$/, "");
  if (!/^\d{15,20}$/.test(userId)) return null;
  return { userId, pcm: frame.subarray(HEADER_BYTES) };
}

module.exports = { HEADER_BYTES, MAX_PCM_PACKET_BYTES, normalizeRecorderMimeType, extractOneTimeTicketFromProtocols, packRemotePcmFrame, unpackRemotePcmFrame };
