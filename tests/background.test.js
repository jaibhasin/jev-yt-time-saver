const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "background", "background.js"),
  "utf8"
);

const context = vm.createContext({
  chrome: {
    runtime: { onMessage: { addListener() {} } },
    storage: {
      local: { get: async () => ({}) },
      session: {
        get: async () => ({}),
        set: async () => {},
      },
    },
  },
  console,
  fetch: async () => {
    throw new Error("Unexpected network request in unit test");
  },
});

vm.runInContext(source, context);

function computeWaste(answers) {
  context.answers = answers;
  return vm.runInContext("computeWaste(answers)", context);
}

test("classifier asks directly about usefulness and distraction signals", () => {
  const questions = vm.runInContext("buildQuestions()", context);

  assert.deepEqual(Object.keys(questions), [
    "usefulness",
    "entertainment",
    "attentionTrap",
    "spam",
  ]);
  assert.equal(questions.usefulness.type, "score");
  assert.equal(questions.usefulness.criteria.length, 4);
});

test("productive learning content remains below the waste threshold", () => {
  const result = computeWaste({
    usefulness: { score: 3, confidence: 0.92 },
    entertainment: { noul: 0.1 },
    attentionTrap: { noul: 0.1 },
    spam: { noul: 0.05 },
  });

  assert.ok(result.waste < 0.6);
  assert.equal(result.confidence, 0.92);
});

test("pure entertainment exceeds the waste threshold", () => {
  const result = computeWaste({
    usefulness: { score: 0, confidence: 0.9 },
    entertainment: { noul: 0.98 },
    attentionTrap: { noul: 0.4 },
    spam: { noul: 0.1 },
  });

  assert.ok(result.waste >= 0.6);
});

test("shallow addictive content exceeds the waste threshold", () => {
  const result = computeWaste({
    usefulness: { score: 1, confidence: 0.85 },
    entertainment: { noul: 0.8 },
    attentionTrap: { noul: 0.95 },
    spam: { noul: 0.6 },
  });

  assert.ok(result.waste >= 0.6);
});

test("useful content is not blocked only because its title is catchy", () => {
  const result = computeWaste({
    usefulness: { score: 2.5, confidence: 0.88 },
    entertainment: { noul: 0.1 },
    attentionTrap: { noul: 1 },
    spam: { noul: 0.05 },
  });

  assert.ok(result.waste < 0.6);
});
