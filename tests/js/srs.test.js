const test = require("node:test");
const assert = require("node:assert/strict");
const SRS = require("../../app/src/srs.js");

const NOW = Date.UTC(2026, 9, 4, 12);
const DAY = 86400000;

test("review climbs boxes and caps at 5", () => {
  let e;
  const boxes = [];
  for (let i = 0; i < 6; i++) {
    e = SRS.review(e, true, NOW + i);
    boxes.push(e.b);
  }
  assert.deepEqual(boxes, [1, 2, 3, 4, 5, 5]);
});

test("wrong resets box and enters pile", () => {
  const e = SRS.review({ b: 3, d: 0, t: 0, s: 3, p: false }, false, NOW);
  assert.deepEqual(e, { b: 0, d: NOW, t: NOW, s: 0, p: true });
});

test("pile clears after two correct in a row", () => {
  let e = SRS.review(undefined, false, NOW);
  e = SRS.review(e, true, NOW + 1);
  assert.equal(e.p, true);
  e = SRS.review(e, true, NOW + 2);
  assert.equal(e.p, false);
});

test("due uses intervals", () => {
  const e = SRS.review({ b: 1, d: 0, t: 0, s: 1, p: false }, true, NOW);
  assert.equal(e.b, 2);
  assert.equal(e.d, NOW + 3 * DAY);
  assert.deepEqual(SRS.INTERVALS, [0, 1, 3, 7, 16, 35]);
});

test("isDue and isMastered", () => {
  assert.equal(SRS.isDue(undefined, NOW), false);
  assert.equal(SRS.isDue({ b: 1, d: NOW }, NOW), true);
  assert.equal(SRS.isDue({ b: 1, d: NOW + 1 }, NOW), false);
  assert.equal(SRS.isMastered({ b: 4 }), true);
  assert.equal(SRS.isMastered({ b: 3 }), false);
  assert.equal(SRS.isMastered(undefined), false);
});

test("weight favours low boxes, unseen, due and frequent items", () => {
  const unseen = SRS.weight({}, undefined, NOW);
  const fresh = SRS.weight({}, { b: 0, d: NOW + DAY }, NOW);
  const due = SRS.weight({}, { b: 0, d: NOW }, NOW);
  const strong = SRS.weight({}, { b: 5, d: NOW + DAY }, NOW);
  assert.equal(fresh, 36);
  assert.equal(unseen, 54);
  assert.equal(due, 72);
  assert.equal(strong, 1);
  assert.equal(SRS.weight({ f: 6 }, { b: 0, d: NOW + DAY }, NOW), 36 * 3);
});

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("pickWeighted returns n distinct items", () => {
  const items = Array.from({ length: 50 }, (_, i) => i);
  const picked = SRS.pickWeighted(items, 25, () => 1, seeded(1));
  assert.equal(picked.length, 25);
  assert.equal(new Set(picked).size, 25);
});

test("pickWeighted never picks zero-weight items", () => {
  const items = Array.from({ length: 10 }, (_, i) => i);
  const picked = SRS.pickWeighted(items, 10, (x) => (x < 3 ? 1 : 0), seeded(2));
  assert.deepEqual([...picked].sort(), [0, 1, 2]);
});

test("topicStars thresholds", () => {
  assert.equal(SRS.topicStars([{ b: 4 }, { b: 4 }]), 3);
  assert.equal(SRS.topicStars([{ b: 3 }, { b: 2 }]), 2);
  assert.equal(SRS.topicStars([{ b: 2 }, undefined]), 1);
  assert.equal(SRS.topicStars([undefined, undefined]), 0);
  assert.equal(SRS.topicStars([]), 0);
});
