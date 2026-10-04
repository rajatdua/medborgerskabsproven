const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../../app/src/engine.js");
const { seeded, makeData } = require("./fixtures.js");

const NOW = Date.UTC(2026, 9, 4, 12);
const ctx = (over = {}) => ({ data: makeData(), srs: {}, now: NOW, rng: seeded(7), ...over });

test("mock queue has 25 distinct exam items", () => {
  const q = E.buildQueue("mock", {}, ctx());
  assert.equal(q.length, 25);
  assert.equal(new Set(q.map((x) => x.id)).size, 25);
  assert.ok(q.every((x) => x.kind === "exam"));
});

test("paper keeps original order", () => {
  const c = ctx();
  const q = E.buildQueue("paper", { paper: "2025-11" }, c);
  assert.deepEqual(q.map((x) => x.id), c.data.papers["2025-11"]);
  assert.deepEqual(q[0].o, ["A-svar", "B-svar", "C-svar"]);
});

test("mock exam expires with unanswered counted wrong", () => {
  const s = E.createSession("mock", {}, ctx());
  for (let i = 0; i < 10; i++) s.answer(s.current().a, NOW + 1000 * i);
  const late = s.answer(0, NOW + 1800001);
  assert.equal(late.ended, true);
  const r = s.result(NOW + 1800001);
  assert.equal(r.total, 25);
  assert.equal(r.score, 10);
  assert.equal(r.passed, false);
  assert.equal(r.answers.length, 25);
  assert.equal(r.answers.filter((a) => a.pick === null).length, 15);
});

test("remaining counts down from the deadline", () => {
  const s = E.createSession("mock", {}, ctx());
  assert.equal(s.remaining(NOW + 1000), 1799000);
  assert.equal(s.remaining(NOW + 9e9), 0);
  assert.equal(E.createSession("topic", { tag: "FA01_Big" }, ctx()).remaining(NOW), null);
});

test("mock gives no per-answer xp and examXP at the end", () => {
  const s = E.createSession("mock", {}, ctx());
  let perAnswer = 0;
  while (s.current()) perAnswer += s.answer(s.current().a, NOW + 1).xp;
  assert.equal(perAnswer, 0);
  const r = s.result(NOW + 2);
  assert.deepEqual([r.score, r.passed, r.xp], [25, true, 500]);
});

test("survival ends after 3 wrong", () => {
  const s = E.createSession("survival", {}, ctx());
  let last;
  for (let i = 0; i < 3; i++) {
    const item = s.current();
    last = s.answer((item.a + 1) % item.o.length, NOW + i);
  }
  assert.equal(last.ended, true);
  assert.equal(s.current(), null);
  assert.equal(s.result(NOW).total, 3);
});

test("blitz combo multiplies xp", () => {
  const s = E.createSession("blitz", {}, ctx());
  const xps = [];
  for (let i = 0; i < 4; i++) xps.push(s.answer(s.current().a, NOW + i).xp);
  assert.deepEqual(xps, [10, 10, 10, 20]);
  const wrong = s.answer((s.current().a + 1) % s.current().o.length, NOW + 5);
  assert.deepEqual([wrong.xp, wrong.combo], [0, 0]);
  assert.equal(s.result(NOW + 6).maxCombo, 4);
});

test("blitz ends at 60 seconds", () => {
  const s = E.createSession("blitz", {}, ctx());
  s.answer(s.current().a, NOW + 1);
  assert.equal(s.answer(s.current().a, NOW + 60001).ended, true);
  assert.equal(s.result(NOW + 60001).score, 1);
});

test("endless modes do not repeat items", () => {
  const s = E.createSession("survival", { }, ctx());
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const item = s.current();
    assert.ok(!seen.has(item.id), `repeat ${item.id}`);
    seen.add(item.id);
    s.answer(item.a, NOW + i);
  }
});

test("cardToMCQ includes correct answer once with 2 distinct distractors", () => {
  const data = makeData();
  const card = data.cards[5];
  const mcq = E.cardToMCQ(card, data, seeded(3));
  assert.equal(mcq.o.length, 3);
  assert.equal(new Set(mcq.o).size, 3);
  assert.equal(mcq.o[mcq.a], card.a);
  assert.equal(mcq.o.filter((o) => o === card.a).length, 1);
  assert.equal(mcq.full, card.a);
  assert.equal(mcq.kind, "card");
});

test("cardToMCQ falls back when topic has <3 distinct answers", () => {
  const data = makeData();
  for (const card of data.cards.filter((c) => c.t !== "FA01_Big")) {
    const mcq = E.cardToMCQ(card, data, seeded(4));
    assert.equal(new Set(mcq.o.map((o) => o.toLowerCase())).size, 3, card.id);
    assert.equal(mcq.o[mcq.a], card.a);
  }
});

test("daily puts due items first", () => {
  const due = { b: 1, d: NOW - 1000, t: NOW - 86400000, s: 1, p: false };
  const later = { ...due, d: NOW - 500 };
  const srs = { "c-big-3": later, "e-2025-05-7": due };
  const q = E.buildQueue("daily", {}, ctx({ srs }));
  assert.equal(q.length, 15);
  assert.deepEqual(q.slice(0, 2).map((x) => x.id), ["e-2025-05-7", "c-big-3"]);
});

test("topic queue draws only from the tag", () => {
  const q = E.buildQueue("topic", { tag: "FA01_Big" }, ctx());
  assert.equal(q.length, 10);
  assert.ok(q.every((x) => x.tag === "FA01_Big"));
});

test("pile queue holds only items in the mistake pile", () => {
  const srs = { "c-big-1": { b: 0, d: NOW, t: NOW, s: 0, p: true }, "e-2026-06-3": { b: 0, d: NOW, t: NOW, s: 0, p: true }, "c-big-2": { b: 2, d: NOW, t: NOW, s: 2, p: false } };
  const q = E.buildQueue("pile", {}, ctx({ srs }));
  assert.deepEqual(q.map((x) => x.id).sort(), ["c-big-1", "e-2026-06-3"]);
});

test("answer returns a review for the item", () => {
  const s = E.createSession("topic", { tag: "FA01_Big" }, ctx());
  const item = s.current();
  const r = s.answer(item.a, NOW);
  assert.deepEqual(r.review, { id: item.id, correct: true });
});
