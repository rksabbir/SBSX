"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.js"), "utf8");

test("ticket lock module is wired into index.js", () => {
  assert.match(index, /require\("\.\/ticket-lock"\)/);
  assert.match(index, /claimTicketSlot\(/);
  assert.match(index, /releaseTicketLock\(/);
  assert.match(index, /finalizeTicketLock\(/);
  assert.match(index, /sweepTicketLocks\(/);
  assert.match(index, /backfillTicketLocks\(/);
});

test("the gate runs before the Discord channel is created", () => {
  const gate = index.indexOf("const ticketLockSlot");
  const create = index.indexOf("interaction.guild.channels.create({", gate);
  assert.ok(gate > 0 && create > gate, "lock must be claimed before creating the channel");
  // চ্যানেল তৈরি ব্যর্থ হলে লক ফেরত যায়
  const slice = index.slice(gate, create + 1500);
  assert.match(slice, /ticketLockSlot\.ref\.remove\(\)/);
});

test("channel creation failure releases the lock instead of trapping the user", () => {
  const pos = index.indexOf("let privateChannel = null;");
  const slice = index.slice(pos, pos + 1400);
  assert.match(slice, /Ticket channel creation failed/);
  assert.match(slice, /ticketLockSlot\.ref\.remove/);
});

test("closing and deleting a ticket releases the lock", () => {
  // v1.5.69: বন্ধ/ডিলিট দুটোই releaseLocksForChannel দিয়ে যায়, যেটা ভেতরে releaseTicketLock ডাকে।
  assert.match(index, /releaseLocksForChannel\(interaction\.channel\.id, \{ reason: "closed"/);
  assert.match(index, /reason: closeDecision\.reason|reason: decision\.reason/);
  assert.match(index, /client\.on\("channelDelete"/);
  assert.match(index, /onTicketChannelDeleted\(channel\)/);
});

test("stale locks are swept on ready and on an interval", () => {
  assert.match(index, /startTicketLockSweepTimer\(\)/);
  assert.match(index, /backfillTicketLocks\(\)\.catch/);
  assert.match(index, /if \(ticketLockSweepTimer\) clearInterval\(ticketLockSweepTimer\)/);
});

test("lock decisions are made inside a transaction (no double ticket from double click)", () => {
  const fn = index.slice(index.indexOf("async function claimTicketSlot("), index.indexOf("async function claimTicketSlot(") + 1200);
  assert.match(fn, /\.transaction\(/);
  assert.match(fn, /evaluateTicketOpenGate\(/);
  assert.match(fn, /open_tickets/);
});

test("admin API exposes lock listing and release behind admin auth", () => {
  for (const route of ["/api/admin/tickets/locks", "/api/admin/tickets/release"]) {
    const pos = index.indexOf(`app.${route.endsWith("locks") ? "get" : "post"}("${route}"`);
    assert.ok(pos > 0, `missing ${route}`);
    const slice = index.slice(pos, pos + 900);
    assert.match(slice, /ADMIN_PANEL_ORIGINS/);
    assert.match(slice, /verifyAdminApiRequest/);
  }
  assert.match(index, /ticket_lock_release/);
});

test("cooldown and sweep windows are configurable", () => {
  assert.match(index, /TICKET_REOPEN_COOLDOWN_MS/);
  assert.match(index, /TICKET_LOCK_SWEEP_INTERVAL_MS/);
  assert.match(index, /TICKET_LOCK_MAX_AGE_MS/);
});

test("the gate only guards ticket-like channel types", () => {
  assert.match(index, /\["ticket", "report", "customer"\]\.includes\(type\)/);
  // order checkout must not be blocked by the ticket lock
  const gateLine = index.slice(index.indexOf('const ticketLockSlot'), index.indexOf('const ticketLockSlot') + 300);
  assert.doesNotMatch(gateLine, /"order"/);
});
