// Quiz sessions: builds question queues for each mode and runs a session.
// Pure: time and randomness come in through ctx.now / now arguments and ctx.rng.
(function (root) {
  const SRS = root.SRS || require("./srs.js");
  const Rewards = root.Rewards || require("./rewards.js");

  const MIN = 60000;
  const MODES = {
    daily: { count: 15, feedback: true },
    mock: { count: 25, timeLimit: 30 * MIN, feedback: false, pass: 20 },
    paper: { timeLimit: 30 * MIN, feedback: false, pass: 20, ordered: true },
    blitz: { timeLimit: MIN, feedback: true, endless: true, auto: { right: 700, wrong: 1600 } },
    survival: { lives: 3, feedback: true, endless: true },
    topic: { count: 10, feedback: true },
    pile: { count: 15, feedback: true },
  };
  const DUE_FIRST = 10;
  const EXAM_SHARE = 0.7;

  const norm = (s) => s.toLowerCase().replace(/[^a-zæøå0-9]/g, "");

  function shuffle(list, rng) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const indexCache = new WeakMap();
  function index(data) {
    if (!indexCache.has(data)) {
      const cardsByTag = {};
      for (const c of data.cards) (cardsByTag[c.t] = cardsByTag[c.t] || []).push(c);
      const byId = {};
      for (const x of data.exam) byId[x.id] = { kind: "exam", src: x };
      for (const c of data.cards) byId[c.id] = { kind: "card", src: c };
      indexCache.set(data, { cardsByTag, byId });
    }
    return indexCache.get(data);
  }

  function examToMCQ(item) {
    const mcq = { id: item.id, kind: "exam", q: item.q, o: item.o, a: item.a, e: item.e, f: item.f };
    if (item.w) mcq.w = item.w;
    if (item.n) mcq.n = item.n;
    return mcq;
  }

  // Distractors: other answers from the same topic, nearest in length; fall back to all cards.
  function cardToMCQ(card, data, rng) {
    const { cardsByTag } = index(data);
    const taken = new Set([norm(card.a)]);
    const distinct = (cards) => {
      const out = [];
      for (const c of cards) {
        const key = norm(c.a);
        if (!taken.has(key) && !out.some((x) => norm(x) === key)) out.push(c.a);
      }
      return out;
    };
    const near = distinct(cardsByTag[card.t] || [])
      .sort((x, y) => Math.abs(x.length - card.a.length) - Math.abs(y.length - card.a.length))
      .slice(0, 6);
    const picks = shuffle(near, rng).slice(0, 2);
    if (picks.length < 2) {
      picks.forEach((p) => taken.add(norm(p)));
      picks.push(...shuffle(distinct(data.cards), rng).slice(0, 2 - picks.length));
    }
    const o = shuffle([card.a, ...picks], rng);
    return { id: card.id, kind: "card", q: card.q, o, a: o.indexOf(card.a), full: card.a, tag: card.t };
  }

  function toMCQ(ref, data, rng) {
    return ref.kind === "exam" ? examToMCQ(ref.src) : cardToMCQ(ref.src, data, rng);
  }

  function refs(data) {
    return Object.values(index(data).byId);
  }

  function pick(pool, n, ctx) {
    return SRS.pickWeighted(pool, n, (r) => SRS.weight(r.src, ctx.srs[r.src.id], ctx.now), ctx.rng);
  }

  function buildQueue(mode, opts, ctx) {
    const { data, srs, now, rng } = ctx;
    const all = refs(data);
    let chosen;
    if (mode === "paper") {
      const { byId } = index(data);
      chosen = data.papers[opts.paper].map((id) => byId[id]);
    } else if (mode === "mock") {
      chosen = pick(all.filter((r) => r.kind === "exam"), MODES.mock.count, ctx);
    } else if (mode === "topic") {
      chosen = pick(all.filter((r) => r.kind === "card" && r.src.t === opts.tag), MODES.topic.count, ctx);
    } else if (mode === "pile") {
      chosen = pick(all.filter((r) => srs[r.src.id] && srs[r.src.id].p), MODES.pile.count, ctx);
    } else if (mode === "daily") {
      const due = all
        .filter((r) => SRS.isDue(srs[r.src.id], now))
        .sort((x, y) => srs[x.src.id].d - srs[y.src.id].d)
        .slice(0, DUE_FIRST);
      const dueIds = new Set(due.map((r) => r.src.id));
      const rest = pick(all.filter((r) => !dueIds.has(r.src.id)), MODES.daily.count - due.length, ctx);
      chosen = [...due, ...rest];
    } else {
      throw new Error(`No fixed queue for mode ${mode}`);
    }
    return chosen.map((r) => toMCQ(r, data, rng));
  }

  function createSession(mode, opts, ctx) {
    const cfg = MODES[mode];
    const queue = cfg.endless ? [] : buildQueue(mode, opts, ctx);
    const used = new Set();
    const answers = [];
    const deadline = cfg.timeLimit ? ctx.now + cfg.timeLimit : null;
    let pos = 0;
    let combo = 0;
    let maxCombo = 0;
    let xp = 0;
    let lives = cfg.lives || null;
    let ended = false;

    function drawEndless() {
      const all = refs(ctx.data).filter((r) => !used.has(r.src.id));
      const wantExam = ctx.rng() < EXAM_SHARE;
      let pool = all.filter((r) => (r.kind === "exam") === wantExam);
      if (!pool.length) pool = all;
      const [ref] = pick(pool, 1, ctx);
      return ref ? toMCQ(ref, ctx.data, ctx.rng) : null;
    }

    function current() {
      if (ended) return null;
      if (cfg.endless && !queue[pos]) {
        const next = drawEndless();
        if (!next) return null;
        queue.push(next);
      }
      return queue[pos] || null;
    }

    function finish() {
      ended = true;
    }

    function answer(choice, now) {
      const item = current();
      if (!item || (deadline && now > deadline)) {
        finish();
        return { correct: false, xp: 0, combo, mult: 1, ended: true, review: null };
      }
      used.add(item.id);
      const correct = choice === item.a;
      answers.push({ item, pick: choice, correct });
      let gained = 0;
      if (cfg.feedback) {
        combo = correct ? combo + 1 : 0;
        maxCombo = Math.max(maxCombo, combo);
        gained = correct ? Rewards.answerXP(combo) : 0;
        xp += gained;
      }
      if (lives !== null && !correct) lives -= 1;
      pos += 1;
      if (lives === 0 || (!cfg.endless && pos >= queue.length)) finish();
      return {
        correct, xp: gained, combo, mult: Rewards.comboMultiplier(combo), ended,
        review: { id: item.id, correct },
      };
    }

    function skip() {
      if (current()) {
        answers.push({ item: queue[pos], pick: null, correct: false });
        pos += 1;
        if (!cfg.endless && pos >= queue.length) finish();
      }
    }

    function remaining(now) {
      return deadline === null ? null : Math.max(0, deadline - now);
    }

    function result() {
      const all = [...answers];
      if (!cfg.endless) {
        const answered = new Set(answers.map((a) => a.item.id));
        for (const item of queue) {
          if (!answered.has(item.id)) all.push({ item, pick: null, correct: false });
        }
      }
      const score = all.filter((a) => a.correct).length;
      const out = { mode, score, total: all.length, maxCombo, xp, answers: all };
      if (cfg.pass) {
        out.passed = score >= cfg.pass;
        out.xp = Rewards.examXP(score);
      }
      return out;
    }

    return {
      mode, cfg, current, answer, skip, remaining, result,
      lives: () => lives, combo: () => combo, index: () => pos, size: () => (cfg.endless ? null : queue.length),
    };
  }

  const api = { MODES, examToMCQ, cardToMCQ, buildQueue, createSession };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
