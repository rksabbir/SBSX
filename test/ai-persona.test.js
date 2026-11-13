"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { identityAnswer, isSeriousMessage, buildSystemPrompt, normalizeReply, clampForDiscord, memoryCandidate, BANGLA_SYSTEM_PROMPT } = require("../ai-persona");

test("the three identity answers are exactly what AKMAFIA YT asked for", () => {
  assert.equal(identityAnswer("তোমাকে কে তৈরি করেছে?").text, "আমাকে তৈরি করেছে AKMAFIA YT! 😎🔥");
  assert.equal(identityAnswer("who made you?").text, "আমাকে তৈরি করেছে AKMAFIA YT! 😎🔥");
  assert.equal(identityAnswer("তোমার ধর্ম কী?").text, "আমি একটি AI, আমার ব্যক্তিগত কোনো ধর্ম নেই।");
  assert.equal(identityAnswer("what is your religion?").text, "আমি একটি AI, আমার ব্যক্তিগত কোনো ধর্ম নেই।");
  assert.equal(identityAnswer("সকল সৃষ্টির সৃষ্টিকর্তা কে?").text, "ইসলামী বিশ্বাস অনুযায়ী মহান আল্লাহ তাআলা সকল সৃষ্টির সৃষ্টিকর্তা।");
});

test("identity answers include the exact requested wording", () => {
  assert.equal(identityAnswer("কে বানিয়েছে তোমাকে").text, "আমাকে তৈরি করেছে AKMAFIA YT! 😎🔥");
  assert.equal(identityAnswer("আমার ধর্ম কি").id, "religion");
});

test("normal questions are not hijacked by identity matching", () => {
  assert.equal(identityAnswer("আজকের আবহাওয়া কেমন?"), null);
  assert.equal(identityAnswer(""), null);
});

test("sad or troubled messages switch the bot into serious mode", () => {
  for (const text of ["আমার মা মারা গেছে", "আমি অনেক কষ্টে আছি", "আমার অ্যাকাউন্ট হ্যাক হয়েছে", "i want to suicide"]) {
    assert.equal(isSeriousMessage(text), true, text);
  }
  assert.equal(isSeriousMessage("আজ মজা করছি ভাই"), false);
});

test("system prompt forces Bangla-only, a funny personality and serious-mode rules", () => {
  assert.match(BANGLA_SYSTEM_PROMPT, /বাংলা/);
  assert.match(BANGLA_SYSTEM_PROMPT, /বাংলিশ/);
  assert.match(BANGLA_SYSTEM_PROMPT, /রসিকতা/);
  const serious = buildSystemPrompt({ serious: true, memory: ["ইউজারের নাম রাফি"], userName: "Rafi" });
  assert.match(serious, /রসিকতা, রোস্ট বা টিজিং একেবারেই নয়/);
  assert.match(serious, /রাফি/);
  assert.match(serious, /ইউজারের নাম রাফি/);
  assert.doesNotMatch(buildSystemPrompt({ serious: false }), /রোস্ট বা টিজিং/);
});

test("memory facts are capped so the prompt cannot grow without limit", () => {
  const prompt = buildSystemPrompt({ memory: Array.from({ length: 40 }, (_, index) => `তথ্য ${index}`) });
  const lines = prompt.split("\n").filter(line => line.startsWith("- "));
  assert.ok(lines.length <= 12);
  assert.match(lines.at(-1), /তথ্য 39/);
});

test("foreign scripts are stripped from replies but Bangla and tech names stay", () => {
  assert.match(normalizeReply("হ্যালো 你好 \u3042 Gemini ভালো"), /^হ্যালো\s+Gemini ভালো$/);
  const out = normalizeReply("ভালো আছো 你好？");
  assert.doesNotMatch(out, /[\u4e00-\u9fff]/);
  assert.match(out, /ভালো আছো/);
});

test("long replies are cut at a full Bangla sentence", () => {
  const sentence = "এটি একটি বাংলা বাক্য যা বেশ লম্বা। ";
  const long = sentence.repeat(120);
  const cut = clampForDiscord(long, 300);
  assert.ok(cut.length <= 300);
  assert.match(cut, /।$/);
});

test("memory candidates stay short and never dump the whole message", () => {
  const value = memoryCandidate("প্রশ্ন ".repeat(200), "উত্তর ".repeat(200));
  assert.ok(value.length <= 340);
});
