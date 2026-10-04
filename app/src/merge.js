// Merge progress from two devices (local cache and cloud copy).
(function (root) {
  const Rewards = root.Rewards || require("./rewards.js");

  const DOCS = ["srs", "summary", "history", "settings"];
  const MAX_FIELDS = [
    "xp", "bestBlitz", "bestSurvival", "bestMock", "answered", "correct", "maxCombo", "pilePeak", "updatedAt",
  ];
  const HISTORY_LIMIT = 50;

  function mergeSrs(a, b) {
    const out = { ...a };
    for (const [id, entry] of Object.entries(b || {})) {
      if (!out[id] || entry.t > out[id].t) out[id] = entry;
    }
    return out;
  }

  function mergeSummary(a, b) {
    a = { ...Rewards.emptySummary(), ...a };
    b = { ...Rewards.emptySummary(), ...b };
    const out = { ...a };
    for (const f of MAX_FIELDS) out[f] = Math.max(a[f], b[f]);
    out.papersBest = { ...a.papersBest };
    for (const [paper, score] of Object.entries(b.papersBest)) {
      out.papersBest[paper] = Math.max(out.papersBest[paper] || 0, score);
    }
    out.achievements = [...new Set([...a.achievements, ...b.achievements])];
    const later = (b.lastDay || "") > (a.lastDay || "") ||
      ((b.lastDay || "") === (a.lastDay || "") && b.streak > a.streak) ? b : a;
    out.streak = later.streak;
    out.freezes = later.freezes;
    out.lastDay = later.lastDay;
    return out;
  }

  function mergeHistory(a, b) {
    const byKey = new Map();
    for (const r of [...(a || []), ...(b || [])]) byKey.set(`${r.date}|${r.paper || ""}`, r);
    return [...byKey.values()].sort((x, y) => y.date - x.date).slice(0, HISTORY_LIMIT);
  }

  function mergeSettings(a, b) {
    if (!b) return a;
    return (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
  }

  function mergeState(local, remote) {
    if (!remote) return { state: local, remoteStale: [...DOCS] };
    const state = {
      srs: mergeSrs(local.srs, remote.srs),
      summary: mergeSummary(local.summary, remote.summary),
      history: mergeHistory(local.history, remote.history),
      settings: mergeSettings(local.settings, remote.settings),
    };
    const remoteStale = DOCS.filter((d) => JSON.stringify(state[d]) !== JSON.stringify(remote[d]));
    return { state, remoteStale };
  }

  const api = { DOCS, mergeSrs, mergeSummary, mergeHistory, mergeState };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Merge = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
