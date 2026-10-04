// XP, levels, daily streak with freezes, and achievements.
// Rules are fixed and identical for all players (a future leaderboard compares them).
(function (root) {
  const DAILY_XP = 50;
  const RANKS = [
    "Turist", "Nytilflytter", "Sprogskoleelev", "Foreningsmedlem", "Skolebestyrelsesmedlem",
    "Vælger", "Byrådsmedlem", "Borgmester", "Folketingsmedlem", "Minister", "Statsminister", "Medborger",
  ];

  function comboMultiplier(combo) {
    if (combo >= 12) return 4;
    if (combo >= 8) return 3;
    if (combo >= 4) return 2;
    return 1;
  }

  function answerXP(combo) {
    return 10 * comboMultiplier(combo);
  }

  function examXP(correct) {
    return 10 * correct + (correct >= 20 ? 100 : 0) + (correct === 25 ? 150 : 0);
  }

  function xpForLevel(level) {
    return 75 * (level - 1) * level;
  }

  function levelForXP(xp) {
    let level = 1;
    while (xpForLevel(level + 1) <= xp) level++;
    return level;
  }

  function rankIndex(level) {
    return Math.min(level - 1, RANKS.length - 1);
  }

  function localDay(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  // Calendar-day difference from date strings, so DST shifts never matter.
  function daysBetween(a, b) {
    const utc = (s) => {
      const [y, m, d] = s.split("-").map(Number);
      return Date.UTC(y, m - 1, d);
    };
    return Math.round((utc(b) - utc(a)) / 86400000);
  }

  function emptySummary() {
    return {
      xp: 0, streak: 0, freezes: 0, lastDay: null, bestBlitz: 0, bestSurvival: 0, bestMock: 0,
      papersBest: {}, achievements: [], answered: 0, correct: 0, maxCombo: 0, pilePeak: 0, updatedAt: 0,
    };
  }

  function completeDay(summary, today) {
    if (summary.lastDay === today) return summary;
    let { streak, freezes } = summary;
    const gap = summary.lastDay ? daysBetween(summary.lastDay, today) : Infinity;
    if (gap === 1) {
      streak += 1;
    } else if (gap > 1 && gap !== Infinity && freezes >= gap - 1) {
      freezes -= gap - 1;
      streak += 1;
    } else {
      streak = 1;
    }
    if (streak % 7 === 0) freezes = Math.min(3, freezes + 1);
    return { ...summary, streak, freezes, lastDay: today };
  }

  const isExamResult = (r) => r && (r.mode === "mock" || r.mode === "paper");
  const stars = (ctx) => Object.values(ctx.topicStars || {});

  const ACHIEVEMENTS = [
    { id: "first", test: (s) => s.answered >= 1 },
    { id: "passed", test: (s, c) => isExamResult(c.lastResult) && c.lastResult.passed },
    { id: "perfect", test: (s, c) => isExamResult(c.lastResult) && c.lastResult.score === 25 },
    { id: "combo15", test: (s) => s.maxCombo >= 15 },
    { id: "blitz20", test: (s) => s.bestBlitz >= 20 },
    { id: "survival30", test: (s) => s.bestSurvival >= 30 },
    { id: "archivist", test: (s) => Object.keys(s.papersBest).length >= 20 },
    { id: "allTopics", test: (s, c) => stars(c).length > 0 && stars(c).every((n) => n >= 1) },
    { id: "topicMaster", test: (s, c) => stars(c).some((n) => n >= 3) },
    { id: "streak7", test: (s) => s.streak >= 7 },
    { id: "streak30", test: (s) => s.streak >= 30 },
    { id: "streak100", test: (s) => s.streak >= 100 },
    { id: "mastered100", test: (s, c) => c.masteredCount >= 100 },
    { id: "pileCleared", test: (s, c) => s.pilePeak >= 10 && c.pileSize === 0 },
    { id: "nightOwl", test: (s, c) => s.answered >= 1 && c.hour < 5 },
  ];

  function newAchievements(summary, ctx) {
    const held = new Set(summary.achievements);
    return ACHIEVEMENTS.filter((a) => !held.has(a.id) && a.test(summary, ctx)).map((a) => a.id);
  }

  const api = {
    DAILY_XP, RANKS, comboMultiplier, answerXP, examXP, xpForLevel, levelForXP, rankIndex,
    localDay, daysBetween, emptySummary, completeDay, ACHIEVEMENTS, newAchievements,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Rewards = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
