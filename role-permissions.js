"use strict";

const VALID_STATES = new Set(["allow", "deny", "keep"]);

function normalizeAiPlan(value, allowedPermissions) {
  const allowed = Array.isArray(allowedPermissions) ? [...new Set(allowedPermissions.map(String))] : [];
  const allowedSet = new Set(allowed);
  const source = value && typeof value === "object" ? value : {};
  const seen = new Map();
  for (const item of Array.isArray(source.changes) ? source.changes : []) {
    const permission = String(item?.permission || "");
    const state = String(item?.state || "keep").toLowerCase();
    if (!allowedSet.has(permission) || !VALID_STATES.has(state) || seen.has(permission)) continue;
    seen.set(permission, {
      permission,
      state,
      reason: String(item?.reason || "No change explanation supplied.").replace(/[\r\n\0]+/g, " ").slice(0, 220)
    });
  }
  const changes = allowed.map(permission => seen.get(permission) || {
    permission, state: "keep", reason: "AI did not request a change to this permission."
  });
  return {
    summary: String(source.summary || "Permission plan ready for review.").replace(/[\r\n\0]+/g, " ").slice(0, 240),
    rationale: String(source.rationale || "Review the proposed changes before applying.").replace(/[\0]+/g, " ").slice(0, 1000),
    changes
  };
}

function buildOverwriteEdit(changes) {
  const payload = {};
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || typeof change.permission !== "string") continue;
    if (change.state === "allow") payload[change.permission] = true;
    else if (change.state === "deny") payload[change.permission] = false;
  }
  return payload;
}

function bitfieldToRestorePayload(allowValue, denyValue, permissionFlags) {
  const allow = BigInt(String(allowValue || "0"));
  const deny = BigInt(String(denyValue || "0"));
  const payload = {};
  for (const [name, rawBit] of Object.entries(permissionFlags || {})) {
    let bit;
    try { bit = BigInt(rawBit); } catch (_) { continue; }
    if (bit <= 0n) continue;
    if ((allow & bit) === bit) payload[name] = true;
    else if ((deny & bit) === bit) payload[name] = false;
    else payload[name] = null;
  }
  return payload;
}

function overwriteState(overwrite, permission, permissionFlags) {
  if (!overwrite) return "inherit";
  const bit = BigInt(permissionFlags[permission]);
  if ((BigInt(overwrite.allow?.bitfield ?? overwrite.allow ?? 0) & bit) === bit) return "allow";
  if ((BigInt(overwrite.deny?.bitfield ?? overwrite.deny ?? 0) & bit) === bit) return "deny";
  return "inherit";
}

module.exports = {
  normalizeAiPlan,
  buildOverwriteEdit,
  bitfieldToRestorePayload,
  overwriteState,
  VALID_STATES
};
