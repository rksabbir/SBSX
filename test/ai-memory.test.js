"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { AiMemory } = require("../ai-memory");

// অত্যন্ত ছোট in-memory Firebase stub — শুধু get/set/update/remove + ref path।
function fakeDb(seed = {}) {
  const store = new Map(Object.entries(seed));
  const read = path => {
    if (store.has(path)) return JSON.parse(JSON.stringify(store.get(path)));
    const prefix = `${path}/`;
    const children = {};
    for (const [key, value] of store) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest.includes("/")) continue;
      children[rest] = value;
    }
    return Object.keys(children).length ? JSON.parse(JSON.stringify(children)) : null;
  };
  const write = (path, value) => store.set(path, value === null ? null : JSON.parse(JSON.stringify(value)));
  const ref = path => ({
    async get() { return { val: () => read(path) }; },
    async set(value) { write(path, value); },
    async update(patch) {
      const current = read(path) || {};
      const next = { ...current };
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete next[key]; else next[key] = value;
      }
      write(path, next);
    },
    async remove() { store.delete(path); }
  });
  return { ref, store, read };
}

test("memory keeps only the configured number of turns", async () => {
  const db = fakeDb();
  const memory = new AiMemory({ db, now: () => 1_000 });
  for (let index = 0; index < 20; index += 1) {
    await memory.appendTurn("u1", `প্রশ্ন ${index}`, `উত্তর ${index}`, { channelId: "123" });
  }
  const record = await memory.load("u1");
  assert.equal(record.history.length, memory.config.maxTurns * 2);
  assert.match(record.history.at(-2).content, /১৯|19/);
  assert.equal(record.history.at(-1).role, "assistant");
});

test("memory is stored per user and never mixes users", async () => {
  const db = fakeDb();
  const memory = new AiMemory({ db, now: () => 1_000 });
  await memory.appendTurn("u1", "আমার নাম রাফি", "ঠিক আছে রাফি");
  await memory.appendTurn("u2", "আমার নাম সাকিব", "ঠিক আছে সাকিব");
  const one = await memory.load("u1");
  const two = await memory.load("u2");
  assert.match(one.history[0].content, /রাফি/);
  assert.match(two.history[0].content, /সাকিব/);
  assert.doesNotMatch(JSON.stringify(one), /সাকিব/);
});

test("memory ignores blank messages and long text is trimmed", async () => {
  const db = fakeDb();
  const memory = new AiMemory({ db });
  assert.equal(await memory.appendTurn("u1", "   ", "উত্তর"), false);
  await memory.appendTurn("u1", "ক".repeat(3000), "খ".repeat(3000));
  const record = await memory.load("u1");
  assert.ok(record.history[0].content.length <= 600);
  assert.ok(record.history[1].content.length <= 600);
});

test("facts are bounded and the newest fact is last", async () => {
  const db = fakeDb();
  const memory = new AiMemory({ db });
  for (let index = 0; index < 20; index += 1) await memory.addFact("u1", `তথ্য ${index}`);
  const record = await memory.load("u1");
  assert.equal(record.facts.length, memory.config.maxFacts);
  assert.match(record.facts.at(-1), /তথ্য 19/);
});

test("forget removes every trace of that user", async () => {
  const db = fakeDb();
  const memory = new AiMemory({ db });
  await memory.appendTurn("u1", "হ্যালো", "হাই");
  assert.equal(await memory.forget("u1"), true);
  const record = await memory.load("u1");
  assert.deepEqual(record.history, []);
  assert.deepEqual(record.facts, []);
});

test("disabled memory never writes to the database", async () => {
  const db = fakeDb();
  const memory = new AiMemory({ db, enabled: false });
  assert.equal(await memory.appendTurn("u1", "হ্যালো", "হাই"), false);
  assert.equal(db.store.size, 0);
});

test("config is loaded from Firebase and clamped to safe ranges", async () => {
  const db = fakeDb({ "ai_memory/config": { enabled: false, maxTurns: 500, maxFacts: -5, retentionDays: 9999 } });
  const memory = new AiMemory({ db });
  const config = await memory.loadConfig();
  assert.equal(config.enabled, false);
  assert.equal(config.maxTurns, 20);
  assert.equal(config.maxFacts, 0);
  assert.equal(config.retentionDays, 365);
});

test("prune drops only records older than the retention window", async () => {
  const now = 10_000_000_000;
  const db = fakeDb({
    "ai_memory/users/old": { history: [], updatedAt: now - 60 * 24 * 60 * 60 * 1000 },
    "ai_memory/users/fresh": { history: [], updatedAt: now - 1_000 }
  });
  const memory = new AiMemory({ db, now: () => now });
  const result = await memory.prune();
  assert.equal(result.removed, 1);
  assert.equal(db.store.has("ai_memory/users/old"), false);
  assert.equal(db.store.has("ai_memory/users/fresh"), true);
});

test("a broken database never crashes the chat", async () => {
  const memory = new AiMemory({ db: { ref: () => { throw new Error("offline"); } }, log: () => {} });
  assert.equal(await memory.appendTurn("u1", "হ্যালো", "হাই"), false);
  const record = await memory.load("u1");
  assert.deepEqual(record.history, []);
});
