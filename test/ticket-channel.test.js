"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { planTicketChannel, channelName, describeChannelCreateError, configurePermissions } = require("../ticket-channel");

const ROOT = path.join(__dirname, "..");
const VIEW = 1024n;
const SEND = 2048n;
const HISTORY = 65536n;

function plan(overrides = {}) {
  return planTicketChannel({
    type: "ticket",
    category: "general_support",
    code: 4321,
    guildId: "guild-1",
    userId: "user-1",
    parentId: "cat-1",
    configuredRole: key => ({ supportCustomer: "role-support", verified: "role-verified", admin: "role-admin" }[key] || ""),
    moderatorRoles: () => ["role-moderator"],
    roleExists: () => true,
    ...overrides
  });
}

test("a ticket plan always has a real name — the v1.5.66 ReferenceError cannot come back", () => {
  const result = plan();
  assert.equal(result.name, "ticket-4321");
  assert.ok(Array.isArray(result.permissionOverwrites) && result.permissionOverwrites.length > 0);
  assert.equal(result.parentId, "cat-1");
  // index.js-এ আর কোনো undefined channelPrefix/permissionOverwrites ব্যবহার নেই
  const source = fs.readFileSync(path.join(ROOT, "index.js"), "utf8");
  const handler = source.slice(source.indexOf('customId.startsWith("create_")'));
  const body = handler.slice(0, handler.indexOf("isButton()", 10));
  assert.ok(!/\bname:\s*channelPrefix\b/.test(body), "channelPrefix must not be used directly");
  assert.ok(/ticketChannelTools\.planTicketChannel\(/.test(body), "the shared planner must be used");
});

test("every permission overwrite points at a role that actually exists", () => {
  const result = plan({ roleExists: roleId => roleId !== "role-verified" });
  const ids = result.permissionOverwrites.map(entry => entry.id);
  assert.ok(!ids.includes("role-verified"), "a deleted role must be skipped, not sent to Discord");
  assert.ok(ids.includes("role-moderator"));
  assert.ok(ids.includes("role-admin"));
  assert.ok(ids.includes("user-1"));
});

test("the guild is denied by default and the ticket owner is allowed", () => {
  const result = plan();
  const everyone = result.permissionOverwrites.find(entry => entry.id === "guild-1");
  const owner = result.permissionOverwrites.find(entry => entry.id === "user-1");
  assert.deepEqual(everyone.deny, [VIEW]);
  assert.deepEqual(owner.allow, [VIEW, SEND, HISTORY]);
});

test("verified role stays hidden while staff roles can see the ticket", () => {
  const result = plan();
  const verified = result.permissionOverwrites.find(entry => entry.id === "role-verified");
  const staff = result.permissionOverwrites.find(entry => entry.id === "role-moderator");
  assert.deepEqual(verified.deny, [VIEW]);
  assert.deepEqual(staff.allow, [VIEW, SEND, HISTORY]);
});

test("the same role is never added twice", () => {
  const result = plan({ configuredRole: key => (key === "supportCustomer" ? "role-admin" : key === "admin" ? "role-admin" : ""), moderatorRoles: () => [] });
  const ids = result.permissionOverwrites.map(entry => entry.id);
  assert.equal(ids.filter(id => id === "role-admin").length, 1);
});

test("order tickets are named order-<code> and use the orders moderator list", () => {
  const seen = [];
  const result = plan({ order: true, type: "order", moderatorRoles: (key, fallback) => { seen.push(key); return fallback; } });
  assert.equal(result.name, "order-4321");
  assert.deepEqual(seen, ["orders"]);
});

test("a missing parent category is omitted instead of sending undefined to Discord", () => {
  assert.equal(plan({ parentId: "" }).parentId, undefined);
});

test("channel names stay inside Discord's 100-character limit", () => {
  const name = channelName({ type: "a".repeat(80), code: 1234 });
  assert.ok(name.length <= 100, name);
  assert.match(name, /^a+-1234$/);
});

test("permission flags follow Discord's real values at runtime", () => {
  configurePermissions({ ViewChannel: 1n, SendMessages: 2n, ReadMessageHistory: 4n });
  try {
    const result = plan();
    assert.deepEqual(result.permissionOverwrites.find(entry => entry.id === "user-1").allow, [1n, 2n, 4n]);
  } finally {
    configurePermissions({ ViewChannel: VIEW, SendMessages: SEND, ReadMessageHistory: HISTORY });
  }
});

test("the error message names the real cause instead of always blaming permissions", () => {
  const cases = [
    [Object.assign(new Error("Missing Permissions"), { code: 50013 }), /Manage Channels/],
    [Object.assign(new Error("Missing Access"), { code: 50001 }), /View Channels/],
    [new Error("Maximum number of channels reached (500)"), /সীমা/],
    [Object.assign(new Error("Unknown Channel"), { code: 10003 }), /ক্যাটাগরি/],
    [new Error("Some brand new Discord failure"), /Some brand new Discord failure/]
  ];
  for (const [error, expected] of cases) {
    assert.match(describeChannelCreateError(error), expected);
  }
  // সব ক্ষেত্রেই বট যা করবে সেটা স্পষ্টভাবে লেখা থাকবে
  assert.match(describeChannelCreateError(new Error("boom")), /^❌ টিকিট চ্যানেল তৈরি হয়নি/);
});

test("the order path and the ticket path share one implementation", () => {
  const source = fs.readFileSync(path.join(ROOT, "index.js"), "utf8");
  const calls = source.match(/ticketChannelTools\.planTicketChannel\(/g) || [];
  assert.equal(calls.length, 2, "both order and support tickets must use the planner");
  const leftover = /name:\s*channelPrefix|permissionOverwrites\s*=\s*\[/.test(source);
  assert.equal(leftover, false, "no hand-built overwrite list may remain");
});
