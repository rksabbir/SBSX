"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const server = fs.readFileSync(path.join(__dirname, "..", "live-studio-server.js"), "utf8");
const panel = fs.readFileSync(path.join(__dirname, "..", "..", "admin-panel", "blogger-admin-panel.html"), "utf8");
const env = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");

test("role permission catalog, planning, apply and revert API routes require Firebase admin verification", () => {
  for (const route of ["/api/admin/role-permissions/catalog", "/api/admin/role-permissions/plan", "/api/admin/role-permissions/apply", "/api/admin/role-permissions/revert"]) {
    const i = server.indexOf(route);
    assert.notEqual(i, -1, `missing route ${route}`);
    const next = server.indexOf("});", i);
    const block = server.slice(i, next === -1 ? i + 1500 : next + 3);
    assert.match(block, /verifyAdminApiRequest\(req\)/, `${route} should authenticate Firebase admin`);
  }
});

test("AI output is limited to channel permission allowlist and cannot immediately mutate Discord", () => {
  assert.match(server, /ROLE_PERMISSION_TEXT_NAMES/);
  assert.match(server, /ROLE_PERMISSION_VOICE_NAMES/);
  assert.match(server, /Never propose Administrator, ManageRoles, ManageGuild, ManageWebhooks/);
  assert.match(server, /pendingRolePermissionPlans\.set/);
  assert.match(server, /Only the admin who generated this plan can apply it/);
  assert.match(server, /Persist the exact role overwrite state before making any Discord change/);
  assert.match(server, /channel\.permissionOverwrites\.edit\(role\.id, editPayload/);
});

test("Admin Panel exposes role/channel selectors, preview approval, and backup revert", () => {
  for (const item of ["AI Role Permissions", "rolePermissionRole", "rolePermissionChannel", "rolePermissionGoal", "rolePermissionReviewed", "rolePermissionApply", "rolePermissionBackups", "/api/admin/role-permissions/plan", "/api/admin/role-permissions/revert"]) {
    assert.ok(panel.includes(item), `missing panel item ${item}`);
  }
});

test("OpenAI API key is documented as private Bot-host configuration, not browser configuration", () => {
  assert.match(env, /OPENAI_API_KEY=/);
  assert.match(env, /OPENAI_ROLE_PERMISSIONS_MODEL=/);
  assert.match(panel, /AI কখনো সরাসরি permission বদলাবে না/);
});
