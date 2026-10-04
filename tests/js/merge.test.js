const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../../app/src/merge.js");
const R = require("../../app/src/rewards.js");

test("newer review wins even when the stale side has a higher box", () => {
  const phone = { e1: { b: 5, d: 9, t: 100, s: 5, p: false }, e2: { b: 1, d: 1, t: 50, s: 1, p: false } };
  const laptop = { e1: { b: 0, d: 200, t: 200, s: 0, p: true } };
  const merged = M.mergeSrs(phone, laptop);
  assert.deepEqual(merged.e1, laptop.e1);
  assert.deepEqual(merged.e2, phone.e2);
});

test("summary takes max xp and unions achievements", () => {
  const a = { ...R.emptySummary(), xp: 500, bestBlitz: 12, achievements: ["first"], papersBest: { "2026-06": 18 } };
  const b = { ...R.emptySummary(), xp: 300, bestBlitz: 15, achievements: ["passed"], papersBest: { "2026-06": 21, "2025-11": 19 } };
  const m = M.mergeSummary(a, b);
  assert.equal(m.xp, 500);
  assert.equal(m.bestBlitz, 15);
  assert.deepEqual([...m.achievements].sort(), ["first", "passed"]);
  assert.deepEqual(m.papersBest, { "2026-06": 21, "2025-11": 19 });
});

test("streak follows the later lastDay", () => {
  const a = { ...R.emptySummary(), streak: 10, freezes: 2, lastDay: "2026-10-01" };
  const b = { ...R.emptySummary(), streak: 1, freezes: 0, lastDay: "2026-10-04" };
  const m = M.mergeSummary(a, b);
  assert.deepEqual([m.streak, m.freezes, m.lastDay], [1, 0, "2026-10-04"]);
  const tie = M.mergeSummary({ ...a, lastDay: "2026-10-04" }, b);
  assert.equal(tie.streak, 10);
});

test("streak handles a never-played side", () => {
  const played = { ...R.emptySummary(), streak: 3, lastDay: "2026-10-04" };
  assert.equal(M.mergeSummary(R.emptySummary(), played).streak, 3);
  assert.equal(M.mergeSummary(played, R.emptySummary()).streak, 3);
});

test("history dedupes and keeps 50 newest", () => {
  const mk = (n, paper) => ({ date: 1000 + n, score: n % 26, paper });
  const a = Array.from({ length: 40 }, (_, i) => mk(i));
  const b = [...Array.from({ length: 30 }, (_, i) => mk(i + 20)), mk(5, "2026-06")];
  const m = M.mergeHistory(a, b);
  assert.equal(m.length, 50);
  assert.equal(m[0].date, 1049);
  assert.ok(m.every((x, i) => i === 0 || m[i - 1].date >= x.date));
});

const state = (over = {}) => ({
  srs: {}, summary: R.emptySummary(), history: [], settings: { lang: "da", sound: true, updatedAt: 0 }, ...over,
});

test("remoteStale lists only changed docs", () => {
  const remote = state({ srs: { e1: { b: 1, d: 1, t: 10, s: 1, p: false } } });
  const local = state({ srs: { e1: { b: 2, d: 2, t: 20, s: 2, p: false } } });
  const { state: merged, remoteStale } = M.mergeState(local, remote);
  assert.deepEqual(remoteStale, ["srs"]);
  assert.equal(merged.srs.e1.b, 2);
});

test("settings follow the later updatedAt", () => {
  const local = state({ settings: { lang: "en", sound: true, updatedAt: 5 } });
  const remote = state({ settings: { lang: "da", sound: false, updatedAt: 9 } });
  assert.deepEqual(M.mergeState(local, remote).state.settings, remote.settings);
});

test("merging with empty remote returns local and marks all docs stale", () => {
  const local = state({ srs: { e1: { b: 1, d: 1, t: 1, s: 1, p: false } }, history: [{ date: 1, score: 3 }] });
  const { state: merged, remoteStale } = M.mergeState(local, null);
  assert.deepEqual(merged, local);
  assert.deepEqual(remoteStale, ["srs", "summary", "history", "settings"]);
});

test("mergeDoc dispatches per document", () => {
  assert.deepEqual(M.mergeDoc("srs", { a: { t: 1, b: 1 } }, { a: { t: 2, b: 0 }, b: { t: 1, b: 3 } }), { a: { t: 2, b: 0 }, b: { t: 1, b: 3 } });
  assert.equal(M.mergeDoc("summary", { ...R.emptySummary(), xp: 5 }, { ...R.emptySummary(), xp: 9 }).xp, 9);
  assert.equal(M.mergeDoc("history", [{ date: 1, score: 1 }], [{ date: 2, score: 2 }]).length, 2);
  assert.equal(M.mergeDoc("settings", { lang: "da", updatedAt: 1 }, { lang: "en", updatedAt: 2 }).lang, "en");
});
