const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  AI_SLASH_COMMANDS,
  AI_CONTEXT_COMMANDS,
  AI_THINKING_TEXT,
  AI_HELP_TEXT,
  parseAiCommand,
  parseContextTarget,
  parseTextCommand
} = require("../ai-commands");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.js"), "utf8");

function slash(prompt, extra = {}) {
  return {
    options: {
      getString: name => {
        if (name === "prompt") return prompt;
        if (name === "reply_private") return extra.replyPrivate ?? null;
        return null;
      }
    }
  };
}

test("ai commands: slash definitions are valid Discord payloads", () => {
  assert.equal(AI_SLASH_COMMANDS.length, 3);
  for (const command of AI_SLASH_COMMANDS) {
    assert.match(command.name, /^[a-z0-9-]{1,32}$/);
    assert.ok(command.description.length > 0 && command.description.length <= 100);
    assert.ok(Array.isArray(command.options));
  }
  const ai = AI_SLASH_COMMANDS.find(c => c.name === "ai");
  assert.equal(ai.options[0].name, "prompt");
  assert.equal(ai.options[0].required, true);
  assert.equal(ai.options[1].choices.length, 2);
  assert.equal(AI_CONTEXT_COMMANDS[0].type, 3);
});

test("ai commands: /ai parsing rejects empty and over-long prompts", () => {
  assert.equal(parseAiCommand(slash("")).reason, "empty");
  assert.equal(parseAiCommand(slash("   ")).reason, "empty");
  assert.equal(parseAiCommand(slash("ক".repeat(1201))).reason, "too_long");
  const ok = parseAiCommand(slash("তুমি কে?"));
  assert.equal(ok.ok, true);
  assert.equal(ok.text, "তুমি কে?");
  assert.equal(ok.ephemeral, false);
  assert.equal(parseAiCommand(slash("তুমি কে?", { replyPrivate: "yes" })).ephemeral, true);
});

test("ai commands: context menu target validation", () => {
  assert.equal(parseContextTarget({ content: "" }).reason, "empty");
  assert.equal(parseContextTarget({ content: "ক".repeat(1501) }).reason, "too_long");
  const ok = parseContextTarget({ content: "এই বিষয়টা বুঝিয়ে দাও" });
  assert.equal(ok.ok, true);
  assert.equal(ok.text, "এই বিষয়টা বুঝিয়ে দাও");
});

test("ai commands: !ai / !aistatus / !aihelp text parsing", () => {
  assert.equal(parseTextCommand("হ্যালো").reason, "not_ai");
  assert.equal(parseTextCommand("!help").reason, "not_ai");
  const ask = parseTextCommand("!ai তুমি কে?");
  assert.equal(ask.ok, true);
  assert.equal(ask.command, "ask");
  assert.equal(ask.text, "তুমি কে?");
  assert.equal(parseTextCommand("!AI   আজ কী খবর").text, "আজ কী খবর");
  assert.equal(parseTextCommand("!ai").reason, "empty");
  assert.equal(parseTextCommand("!ai " + "ক".repeat(1300)).reason, "too_long");
  assert.equal(parseTextCommand("!aistatus").command, "status");
  assert.equal(parseTextCommand("!aihelp").command, "help");
});

test("ai commands: thinking placeholder is Bangla, not Discord's English", () => {
  assert.match(AI_THINKING_TEXT, /উত্তর সাজাচ্ছে/);
  assert.doesNotMatch(AI_THINKING_TEXT, /thinking/i);
  assert.match(AI_HELP_TEXT, /\/ai prompt/);
  assert.match(AI_HELP_TEXT, /!aistatus/);
});

test("ai commands: index.js registers commands and handles interactions", () => {
  assert.match(index, /require\("\.\/ai-commands"\)/);
  assert.match(index, /guild\.commands\.set\(\[\.\.\.AI_SLASH_COMMANDS, \.\.\.AI_CONTEXT_COMMANDS\]\)/);
  assert.match(index, /registerAiCommands\(\)/);
  assert.match(index, /isChatInputCommand\?\.\(\) === true/);
  assert.match(index, /isMessageContextMenuCommand\?\.\(\) === true/);
  assert.match(index, /AI_THINKING_TEXT/);
});

test("ai commands: root cause fix — aiChat.loadConfig is actually called on ready", () => {
  assert.match(index, /\.then\(\(\) => aiChat\.loadConfig\(\)\)/);
  // v1.5.69 পর্যন্ত ভুল করে শুধু memory.loadConfig() ডাকা হতো — আসল কল এখন ঠিক একবার।
  const loadCalls = index.match(/\.then\(\(\) => aiChat\.loadConfig\(\)\)/g) || [];
  assert.equal(loadCalls.length, 1);
  // আর memory-এর config আলাদা করে লোড হয় (দুটোই দরকার)
  assert.match(index, /\.then\(\(\) => aiChat\.memory\.loadConfig\(\)\)/);
});

test("ai commands: interaction watchdog prevents a stuck \"is thinking\" state", () => {
  assert.match(index, /async function interactionWatchdog/);
  assert.match(index, /setTimeout\(resolve, 2800\)/);
  assert.match(index, /interactionWatchdog\(interaction\)\.catch/);
  assert.match(index, /markInteractionAnswered/);
});

test("ai commands: !ai text command is wired with typing keep-alive", () => {
  assert.match(index, /parseTextCommand\(message\.content\)/);
  assert.match(index, /sendTyping/);
  assert.match(index, /!aistatus` শুধু Admin\/Staff/);
});

test("ai commands: failures are explained instead of staying silent", () => {
  assert.match(index, /function errorPayload/);
  assert.match(index, /API key সেট করা হয়নি/);
  assert.match(index, /cooldown-এ আছে/);
  assert.match(index, /notifyAiDiagnostic/);
});
