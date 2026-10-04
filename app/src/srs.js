// Spaced repetition: Leitner boxes 0–5 per item.
// Entry shape: {b: box, d: due ms, t: last review ms, s: correct streak, p: in mistake pile}
(function (root) {
  const DAY = 86400000;
  const INTERVALS = [0, 1, 3, 7, 16, 35];

  function review(entry, correct, now) {
    const prev = entry || { b: 0, s: 0, p: false };
    if (!correct) return { b: 0, d: now, t: now, s: 0, p: true };
    const b = Math.min(5, prev.b + 1);
    const s = prev.s + 1;
    return { b, d: now + INTERVALS[b] * DAY, t: now, s, p: prev.p && s < 2 };
  }

  function isDue(entry, now) {
    return !!entry && entry.d <= now;
  }

  function isMastered(entry) {
    return !!entry && entry.b >= 4;
  }

  function weight(item, entry, now) {
    const b = entry ? entry.b : 0;
    let w = (6 - b) * (6 - b);
    if (!entry) w *= 1.5;
    if (isDue(entry, now)) w *= 2;
    if (item.f) w *= 1 + 0.4 * (item.f - 1);
    return w;
  }

  // Weighted sampling without replacement (Efraimidis–Spirakis).
  function pickWeighted(items, n, weightFn, rng) {
    return items
      .map((item) => ({ item, w: weightFn(item) }))
      .filter((x) => x.w > 0)
      .map((x) => ({ item: x.item, key: Math.pow(rng(), 1 / x.w) }))
      .sort((a, b) => b.key - a.key)
      .slice(0, n)
      .map((x) => x.item);
  }

  function topicStars(entries) {
    if (!entries.length) return 0;
    const avg = entries.reduce((sum, e) => sum + (e ? e.b : 0), 0) / (5 * entries.length);
    if (avg >= 0.8) return 3;
    if (avg >= 0.5) return 2;
    if (avg >= 0.2) return 1;
    return 0;
  }

  const api = { DAY, INTERVALS, review, isDue, isMastered, weight, pickWeighted, topicStars };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SRS = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
