"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeAiPlan, buildOverwriteEdit, bitfieldToRestorePayload, overwriteState } = require("../role-permissions");

test("normalizes AI output to the allowlisted permission names and defaults omissions to keep", () => {
  const plan = normalizeAiPlan({ summary: "Support role", changes: [
    { permission: "ViewChannel", state: "allow", reason: "Can see the channel" },
    { permission: "Administrator", state: "allow", reason: "unsafe" },
    { permission: "SendMessages", state: "deny", reason: "Read only" },
    { permission: "SendMessages", state: "allow", reason: "duplicate ignored" },
    { permission: "AttachFiles", state: "random", reason: "invalid state" }
  ] }, ["ViewChannel", "SendMessages", "AttachFiles"]);
  assert.equal(plan.changes.length, 3);
  assert.deepEqual(plan.changes.map(x => [x.permission, x.state]), [
    ["ViewChannel", "allow"], ["SendMessages", "deny"], ["AttachFiles", "keep"]
  ]);
});

test("only explicit allow/deny changes are sent to Discord; keep leaves prior values alone", () => {
  assert.deepEqual(buildOverwriteEdit([
    { permission: "ViewChannel", state: "allow" },
    { permission: "SendMessages", state: "deny" },
    { permission: "AttachFiles", state: "keep" }
  ]), { ViewChannel: true, SendMessages: false });
});

test("restore payload reconstructs prior allow, deny, and unset states", () => {
  const flags = { ViewChannel: 1n, SendMessages: 2n, ReadMessageHistory: 4n };
  assert.deepEqual(bitfieldToRestorePayload("1", "2", flags), {
    ViewChannel: true, SendMessages: false, ReadMessageHistory: null
  });
});

test("overwrite state reports inherit when there is no explicit role overwrite", () => {
  assert.equal(overwriteState(null, "ViewChannel", { ViewChannel: 1n }), "inherit");
  assert.equal(overwriteState({ allow: { bitfield: 1n }, deny: { bitfield: 0n } }, "ViewChannel", { ViewChannel: 1n }), "allow");
  assert.equal(overwriteState({ allow: { bitfield: 0n }, deny: { bitfield: 2n } }, "SendMessages", { SendMessages: 2n }), "deny");
});
