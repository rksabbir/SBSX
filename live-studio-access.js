"use strict";

function parseCookieHeader(header) {
  const cookies = Object.create(null);
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try { cookies[name] = decodeURIComponent(value); }
    catch (_) { cookies[name] = value; }
  }
  return cookies;
}

function parseDiscordIdSet(value) {
  return new Set(String(value || "").split(/[\s,;]+/).map(value => value.trim())
    .filter(value => /^\d{17,20}$/.test(value)));
}

function isLiveStudioModerator({ userId, guildOwnerId, isAdministrator, roleIds, adminUserIds, adminRoleIds } = {}) {
  const id = String(userId || "");
  if (!/^\d{17,20}$/.test(id)) return false;
  if (id === String(guildOwnerId || "")) return true;
  if (isAdministrator === true) return true;
  const users = adminUserIds instanceof Set ? adminUserIds : parseDiscordIdSet(adminUserIds);
  if (users.has(id)) return true;
  const allowedRoles = adminRoleIds instanceof Set ? adminRoleIds : parseDiscordIdSet(adminRoleIds);
  const assignedRoles = Array.isArray(roleIds) ? roleIds.map(String) : [];
  return assignedRoles.some(roleId => allowedRoles.has(roleId));
}

function buildDiscordOAuthAuthorizeUrl({ clientId, redirectUri, state } = {}) {
  if (!String(clientId || "").trim() || !String(redirectUri || "").trim() || !/^[A-Za-z0-9_-]{32,80}$/.test(String(state || ""))) {
    throw new TypeError("Discord OAuth requires clientId, redirectUri and a valid state value");
  }
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", String(clientId).trim());
  url.searchParams.set("redirect_uri", String(redirectUri).trim());
  url.searchParams.set("scope", "identify guilds.members.read");
  url.searchParams.set("state", String(state));
  return url.toString();
}

function isDiscordOAuthConfigured(env = process.env) {
  return Boolean(String(env.LIVE_STUDIO_OAUTH_CLIENT_ID || "").trim()
    && String(env.LIVE_STUDIO_OAUTH_CLIENT_SECRET || "").trim()
    && /^https:\/\//i.test(String(env.LIVE_STUDIO_OAUTH_REDIRECT_URI || "").trim()));
}

module.exports = { parseCookieHeader, parseDiscordIdSet, isLiveStudioModerator, buildDiscordOAuthAuthorizeUrl, isDiscordOAuthConfigured };
