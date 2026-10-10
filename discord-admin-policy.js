"use strict";

const SAFE_DISCORD_ACTION_ROLES = Object.freeze([
  "developer",
  "supportTicketReport",
  "supportCustomer",
  "verified",
  "level"
]);

function isValidDiscordSnowflake(value) {
  return /^\d{15,22}$/.test(String(value || "").trim());
}

function isSafeDiscordActionRole(roleKey) {
  return SAFE_DISCORD_ACTION_ROLES.includes(String(roleKey || ""));
}

function isProtectedDiscordTarget({ targetId, ownerId, isAdministrator, targetHighestRolePosition, botHighestRolePosition } = {}) {
  if (!targetId || !ownerId || String(targetId) === String(ownerId)) return true;
  if (isAdministrator === true) return true;
  const targetPosition = Number(targetHighestRolePosition);
  const botPosition = Number(botHighestRolePosition);
  if (!Number.isFinite(targetPosition) || !Number.isFinite(botPosition)) return true;
  return targetPosition >= botPosition;
}

function isAssignableDiscordRole({ exists, managed, hasAdministratorPermission, rolePosition, botHighestRolePosition, roleId, adminRoleId } = {}) {
  if (exists !== true || managed === true || hasAdministratorPermission === true) return false;
  if (roleId && adminRoleId && String(roleId) === String(adminRoleId)) return false;
  const position = Number(rolePosition);
  const botPosition = Number(botHighestRolePosition);
  if (!Number.isFinite(position) || !Number.isFinite(botPosition)) return false;
  return position < botPosition;
}

module.exports = {
  SAFE_DISCORD_ACTION_ROLES,
  isValidDiscordSnowflake,
  isSafeDiscordActionRole,
  isProtectedDiscordTarget,
  isAssignableDiscordRole
};
