"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.js"), "utf8");
const server = fs.readFileSync(path.join(root, "live-studio-server.js"), "utf8");
const panel = fs.readFileSync(path.join(root, "..", "admin-panel", "blogger-admin-panel.html"), "utf8");
const util = require(path.join(root, "community-automation.js"));

test("community automation validates self-select role allowlist and descriptive labels", () => {
  const config = util.normalizeAutomationConfig({ selfRoles: [
    { roleId: "123456789012345678", label: "Game Updates", description: "Get gaming notices" },
    { roleId: "not-a-discord-id", label: "Unsafe" },
    { roleId: "223456789012345678", label: "Music" }
  ] });
  assert.equal(config.selfRoles.length, 2);
  assert.equal(config.selfRoles[0].roleId, "123456789012345678");
  assert.equal(config.selfRoles[0].label, "Game Updates");
});

test("self-role interaction only changes configured roles and refuses Administrator or hierarchy conflicts", () => {
  const start = index.indexOf('interaction.customId === "community_self_roles"');
  const end = index.indexOf("// 🔑 Button ভিত্তিক OneTime Key Handler", start);
  assert.ok(start >= 0 && end > start);
  const handler = index.slice(start, end);
  assert.match(handler, /const allowlist = new Set\(configured\.map/);
  assert.match(handler, /role\.permissions\.has\(PermissionFlagsBits\.Administrator\)/);
  assert.match(handler, /role\.position >= botMember\.roles\.highest\.position/);
  assert.match(handler, /member\.roles\.remove/);
});

test("AI automation builder requires admin auth and keeps generated actions limited to keyword replies", () => {
  const start = server.indexOf('app.post("/api/admin/community-automation/plan"');
  const apply = server.indexOf('app.post("/api/admin/community-automation/apply"');
  const end = server.indexOf('app.post("/api/admin/role-permissions/revert"', apply);
  assert.ok(start >= 0 && apply > start && end > apply);
  const routes = server.slice(start, end);
  assert.equal((routes.match(/verifyAdminApiRequest\(req\)/g) || []).length, 3);
  assert.match(routes, /keyword_reply/);
  assert.match(routes, /plan\.actorUid !== actor\.uid/);
  assert.match(routes, /pendingCommunityAutomationPlans/);
  assert.match(routes, /community_automation_applied/);
  assert.doesNotMatch(routes, /interaction\.guild\.roles\.create/);
});

test("Admin Panel exposes configuration for onboarding, FAQ, ticket routing, events, self-roles, alerts and analytics", () => {
  for (const item of [
    'id="view-community-automation"', 'id="communityOnboardingRoleIds"', 'id="communitySelfRolesJson"',
    'id="communityFaqEntriesJson"', 'id="communityFaqKnowledgeBase"', 'id="communityTicketRoutesJson"',
    'id="communityEventTitle"', 'id="communityRulesList"', 'id="communityAlertsList"',
    'data-feature="communityFaqEnabled"', 'data-feature="raidAlertEnabled"', 'id="communityStatMessages"'
  ]) assert.ok(panel.includes(item), `missing UI field ${item}`);
  assert.match(panel, /selfRoles:cleanSelfRoles/);
  assert.match(panel, /community-automation\/plan/);
  assert.match(panel, /community-automation\/apply/);
});

test("suggestion status API is authenticated, validates status, updates Firebase and audits the action", () => {
  const start = server.indexOf('app.post("/api/admin/community-automation/suggestion-status"');
  const end = server.indexOf('app.post("/api/admin/role-permissions/revert"', start);
  assert.ok(start >= 0 && end > start);
  const route = server.slice(start, end);
  assert.match(route, /verifyAdminApiRequest\(req\)/);
  assert.match(route, /pending:.*approved:.*rejected:.*completed:/s);
  assert.match(route, /runtime\/community\/suggestions/);
  assert.match(route, /community_suggestion_status_update/);
  assert.match(route, /message\.edit\(/);
  assert.match(panel, /data-community-suggestion-status/);
  assert.match(panel, /updateCommunitySuggestionStatus/);
});
