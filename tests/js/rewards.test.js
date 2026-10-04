const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../../app/src/rewards.js");

test("combo multiplier bands", () => {
  assert.deepEqual([1, 3, 4, 7, 8, 11, 12, 30].map(R.comboMultiplier), [1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(R.answerXP(4), 20);
  assert.equal(R.answerXP(12), 40);
});

test("exam XP", () => {
  assert.equal(R.examXP(19), 190);
  assert.equal(R.examXP(20), 300);
  assert.equal(R.examXP(25), 500);
  assert.equal(R.DAILY_XP, 50);
});

test("levels", () => {
  assert.deepEqual([0, 149, 150, 449, 450, 6750].map(R.levelForXP), [1, 1, 2, 2, 3, 10]);
  assert.equal(R.xpForLevel(2), 150);
  assert.equal(R.RANKS.length, 12);
  assert.equal(R.RANKS[0], "Turist");
  assert.equal(R.RANKS[11], "Medborger");
  assert.equal(R.rankIndex(1), 0);
  assert.equal(R.rankIndex(40), 11);
});

test("localDay formats local date", () => {
  assert.equal(R.localDay(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("streak counts 2026-10-24 → 2026-10-25 as one day across DST", () => {
  assert.equal(R.daysBetween("2026-10-24", "2026-10-25"), 1);
  const s = R.completeDay({ ...R.emptySummary(), streak: 4, lastDay: "2026-10-24" }, "2026-10-25");
  assert.equal(s.streak, 5);
  assert.equal(s.lastDay, "2026-10-25");
});

test("streak crosses year 2026-12-31 → 2027-01-01", () => {
  const s = R.completeDay({ ...R.emptySummary(), streak: 2, lastDay: "2026-12-31" }, "2027-01-01");
  assert.equal(s.streak, 3);
});

test("same day does not change streak", () => {
  const before = { ...R.emptySummary(), streak: 2, lastDay: "2026-10-04" };
  assert.deepEqual(R.completeDay(before, "2026-10-04"), before);
});

test("first day starts streak at 1", () => {
  assert.equal(R.completeDay(R.emptySummary(), "2026-10-04").streak, 1);
});

test("freeze covers one missed day", () => {
  const s = R.completeDay({ ...R.emptySummary(), streak: 3, freezes: 1, lastDay: "2026-10-01" }, "2026-10-03");
  assert.equal(s.streak, 4);
  assert.equal(s.freezes, 0);
});

test("missed days without freezes reset streak", () => {
  const s = R.completeDay({ ...R.emptySummary(), streak: 9, freezes: 1, lastDay: "2026-10-01" }, "2026-10-04");
  assert.equal(s.streak, 1);
  assert.equal(s.freezes, 1);
});

test("freeze earned every 7 days, capped at 3", () => {
  const s = R.completeDay({ ...R.emptySummary(), streak: 6, freezes: 0, lastDay: "2026-10-03" }, "2026-10-04");
  assert.equal(s.freezes, 1);
  const capped = R.completeDay({ ...R.emptySummary(), streak: 13, freezes: 3, lastDay: "2026-10-03" }, "2026-10-04");
  assert.equal(capped.freezes, 3);
});

const ctx = (over = {}) => ({ masteredCount: 0, topicStars: {}, pileSize: 0, hour: 12, ...over });

test("pileCleared needs a peak of 10", () => {
  const ids = (s, c) => R.newAchievements(s, c);
  assert.ok(!ids({ ...R.emptySummary(), pilePeak: 9 }, ctx()).includes("pileCleared"));
  assert.ok(ids({ ...R.emptySummary(), pilePeak: 10 }, ctx()).includes("pileCleared"));
  assert.ok(!ids({ ...R.emptySummary(), pilePeak: 10 }, ctx({ pileSize: 1 })).includes("pileCleared"));
});

test("archivist needs 20 papers", () => {
  const papers = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, 10]));
  assert.ok(!R.newAchievements({ ...R.emptySummary(), papersBest: papers(19) }, ctx()).includes("archivist"));
  assert.ok(R.newAchievements({ ...R.emptySummary(), papersBest: papers(20) }, ctx()).includes("archivist"));
});

test("newAchievements skips ones already held", () => {
  const s = { ...R.emptySummary(), answered: 1, achievements: ["first"] };
  assert.ok(!R.newAchievements(s, ctx()).includes("first"));
  assert.ok(R.newAchievements({ ...s, achievements: [] }, ctx()).includes("first"));
});

test("achievement ids are the 15 from the plan", () => {
  assert.deepEqual(
    R.ACHIEVEMENTS.map((a) => a.id),
    ["first", "passed", "perfect", "combo15", "blitz20", "survival30", "archivist", "allTopics",
     "topicMaster", "streak7", "streak30", "streak100", "mastered100", "pileCleared", "nightOwl"],
  );
});

test("result-based achievements", () => {
  const s = R.emptySummary();
  assert.ok(R.newAchievements(s, ctx({ lastResult: { mode: "mock", score: 25, passed: true } })).includes("perfect"));
  assert.ok(R.newAchievements(s, ctx({ lastResult: { mode: "paper", score: 20, passed: true } })).includes("passed"));
  assert.ok(R.newAchievements({ ...s, bestBlitz: 20 }, ctx()).includes("blitz20"));
  assert.ok(R.newAchievements({ ...s, answered: 1 }, ctx({ hour: 1 })).includes("nightOwl"));
  assert.ok(R.newAchievements(s, ctx({ topicStars: { a: 1, b: 1 } })).includes("allTopics"));
  assert.ok(!R.newAchievements(s, ctx({ topicStars: { a: 1, b: 0 } })).includes("allTopics"));
});
