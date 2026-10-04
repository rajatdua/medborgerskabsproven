// Screens and interaction: hub, topic map, past exams, play and result.
(function (root) {
  const { SRS, Rewards, Engine, I18n, FX } = root;

  const EXAM_MODES = new Set(["mock", "paper"]);
  const FLASH_MS = 220;
  const TICK_MS = 250;

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const FLAG = `<svg class="flag" viewBox="0 0 37 28" aria-hidden="true"><rect width="37" height="28" fill="#c8102e"/><rect x="12" width="4" height="28" fill="#fff"/><rect y="12" width="37" height="4" fill="#fff"/></svg>`;
  const SPEAKER_ON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>`;
  const SPEAKER_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>`;

  function createUI({ el, data, store, clock = Date.now }) {
    let view = { screen: "hub" };
    let session = null;
    let play = null; // per-session UI state
    let ticker = null;
    let confirmReset = false;

    const lang = () => store.state.settings.lang;
    const t = (key, vars) => I18n.t(key, lang(), vars);
    const en = (s) => (s && data.en[s]) || "";
    const today = () => Rewards.localDay(new Date(clock()));
    const topicName = (tag) => {
      const topic = data.topics.find((x) => x.t === tag);
      const da = topic ? topic.da : tag;
      return lang() === "en" ? en(da) || da : da;
    };
    const monthLabel = (code) => {
      const [y, m] = code.split("-");
      const name = t(`month.${m}`);
      return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
    };

    // ---------- derived stats ----------
    function derive() {
      const now = clock();
      const srs = store.state.srs;
      const entries = Object.values(srs);
      const topicStars = {};
      for (const topic of data.topics) {
        topicStars[topic.t] = SRS.topicStars(data.cards.filter((c) => c.t === topic.t).map((c) => srs[c.id]));
      }
      const exams = store.state.history.filter((h) => EXAM_MODES.has(h.mode));
      return {
        examMastered: data.exam.filter((x) => SRS.isMastered(srs[x.id])).length,
        masteredCount: entries.filter(SRS.isMastered).length,
        dueCount: [...data.exam, ...data.cards].filter((x) => SRS.isDue(srs[x.id], now)).length,
        pileSize: entries.filter((e) => e.p).length,
        topicStars,
        starTotal: Object.values(topicStars).reduce((a, b) => a + b, 0),
        lastExams: exams.slice(0, 5).reverse(),
        avg3: exams.length ? exams.slice(0, 3).reduce((a, h) => a + h.score, 0) / Math.min(3, exams.length) : null,
      };
    }

    // ---------- progress bookkeeping ----------
    function achievementCtx(lastResult) {
      const d = derive();
      return { masteredCount: d.masteredCount, topicStars: d.topicStars, pileSize: d.pileSize, lastResult, hour: new Date(clock()).getHours() };
    }

    function updateSummary(fn, lastResult) {
      const before = store.state.summary;
      store.update("summary", (s) => ({ ...fn(s), updatedAt: Date.now() }));
      const after = store.state.summary;
      const oldLevel = Rewards.levelForXP(before.xp);
      const newLevel = Rewards.levelForXP(after.xp);
      if (newLevel > oldLevel) {
        FX.toast(esc(t("toast.levelUp", { rank: t(`rank.${Rewards.rankIndex(newLevel)}`) })));
        FX.sound("level");
        FX.confetti();
      }
      const fresh = Rewards.newAchievements(after, achievementCtx(lastResult));
      if (fresh.length) {
        store.update("summary", (s) => ({ ...s, achievements: [...s.achievements, ...fresh] }));
        fresh.forEach((id) => FX.toast(`${esc(t("toast.achievement", { name: "" }))}<b>${esc(t(`ach.${id}.name`))}</b>`));
      }
    }

    function recordAnswer(item, res) {
      const now = clock();
      store.update("srs", (srs) => ({ ...srs, [item.id]: SRS.review(srs[item.id], res.correct, now) }));
      const pileSize = Object.values(store.state.srs).filter((e) => e.p).length;
      updateSummary((s) => ({
        ...s,
        answered: s.answered + 1,
        correct: s.correct + (res.correct ? 1 : 0),
        xp: s.xp + res.xp,
        maxCombo: Math.max(s.maxCombo, res.combo),
        pilePeak: Math.max(s.pilePeak, pileSize),
      }));
    }

    // ---------- session control ----------
    function startSession(mode, opts = {}) {
      const ctx = { data, srs: store.state.srs, now: clock(), rng: Math.random };
      const s = Engine.createSession(mode, opts, ctx);
      if (!s.current()) {
        FX.toast(esc(t("play.empty")));
        return;
      }
      session = s;
      play = { mode, opts, feedback: null, flash: null, showEn: false, floatXp: 0, pending: null };
      view = { screen: "play" };
      clearInterval(ticker);
      if (s.cfg.timeLimit) ticker = setInterval(tick, TICK_MS);
      render();
    }

    function tick() {
      if (!session || view.screen !== "play") return;
      const rem = session.remaining(clock());
      const timer = el.querySelector("[data-timer]");
      const bar = el.querySelector("[data-timebar]");
      if (timer) {
        timer.textContent = formatTime(rem);
        timer.classList.toggle("low", rem < (session.cfg.timeLimit > 60000 ? 300000 : 10000));
      }
      if (bar) bar.style.width = `${(100 * rem) / session.cfg.timeLimit}%`;
      if (rem === 0 && !play.feedback && !play.flash) finishSession();
    }

    function formatTime(ms) {
      const total = Math.ceil(ms / 1000);
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
    }

    function answer(choice) {
      if (!session || play.feedback || play.flash) return;
      const item = session.current();
      if (!item || choice >= item.o.length) return;
      const res = session.answer(choice, clock());
      if (!res.review) return finishSession();
      recordAnswer(item, res);
      if (session.cfg.feedback) {
        play.feedback = { item, pick: choice, res };
        play.floatXp = res.xp;
        FX.sound(res.correct ? "right" : "wrong");
        render();
        const auto = session.cfg.auto;
        if (auto) play.pending = setTimeout(next, res.correct ? auto.right : auto.wrong);
        else focusNext();
      } else {
        play.flash = { item, pick: choice };
        render();
        const owner = session;
        play.pending = setTimeout(() => {
          if (session !== owner) return; // quit or finished meanwhile
          play.flash = null;
          if (res.ended) finishSession();
          else render();
        }, FLASH_MS);
      }
    }

    function focusNext() {
      const btn = el.querySelector("[data-act='next']");
      if (btn) btn.focus({ preventScroll: true });
    }

    function next() {
      if (!session || !play.feedback) return;
      clearTimeout(play.pending);
      const ended = play.feedback.res.ended || (session.cfg.timeLimit && session.remaining(clock()) === 0);
      play.feedback = null;
      play.showEn = false;
      play.floatXp = 0;
      if (ended) finishSession();
      else render();
    }

    function quit() {
      clearInterval(ticker);
      if (play) clearTimeout(play.pending);
      session = null;
      play = null;
      view = { screen: "hub" };
      render();
    }

    function finishSession() {
      if (!session) return;
      clearInterval(ticker);
      clearTimeout(play.pending);
      const r = session.result(clock());
      const { mode, opts } = play;
      const extra = { newRecord: false, dailyXp: 0 };
      const lastResult = { mode, score: r.score, passed: r.passed };

      if (EXAM_MODES.has(mode)) {
        updateSummary((s) => {
          const papersBest = { ...s.papersBest };
          if (opts.paper) papersBest[opts.paper] = Math.max(papersBest[opts.paper] || 0, r.score);
          return { ...s, xp: s.xp + r.xp, bestMock: Math.max(s.bestMock, r.score), papersBest };
        }, lastResult);
        store.update("history", (h) => [{ date: Date.now(), score: r.score, mode, paper: opts.paper || null }, ...h].slice(0, 50));
        FX.sound(r.passed ? "pass" : "fail");
        if (r.passed) FX.confetti();
      } else if (mode === "blitz" || mode === "survival") {
        const field = mode === "blitz" ? "bestBlitz" : "bestSurvival";
        extra.newRecord = r.score > 0 && r.score > store.state.summary[field];
        updateSummary((s) => ({ ...s, [field]: Math.max(s[field], r.score) }), lastResult);
        if (extra.newRecord) FX.confetti();
      } else if (mode === "daily" && r.total === session.size()) {
        const before = store.state.summary;
        if (before.lastDay !== today()) {
          extra.dailyXp = Rewards.DAILY_XP;
          updateSummary((s) => ({ ...Rewards.completeDay(s, today()), xp: s.xp + Rewards.DAILY_XP }), lastResult);
          if (store.state.summary.freezes < before.freezes) FX.toast(esc(t("toast.freezeUsed")));
        }
      } else {
        updateSummary((s) => s, lastResult);
      }
      view = { screen: "result", result: r, extra, mode, opts };
      session = null;
      play = null;
      render();
      window.scrollTo(0, 0);
    }

    // ---------- rendering ----------
    function header() {
      const { summary, settings } = store.state;
      const level = Rewards.levelForXP(summary.xp);
      const from = Rewards.xpForLevel(level);
      const to = Rewards.xpForLevel(level + 1);
      const pct = Math.round((100 * (summary.xp - from)) / (to - from));
      const rank = t(`rank.${Rewards.rankIndex(level)}`);
      const streak = summary.streak === 1 ? t("header.streakOne") : t("header.streak", { n: summary.streak });
      const freezes = summary.freezes ? ` · ${t("header.freezes", { n: summary.freezes })}` : "";
      const syncLabel = t(`sync.${store.status}`);
      return `
        <header class="top">
          <button class="brand" data-act="home">${FLAG}<span>${esc(t("app.name"))}</span></button>
          <div class="top-meta">
            <div class="level" title="${summary.xp} XP">
              <div class="level-row"><b>${esc(rank)}</b><span class="muted">${esc(t("header.level", { n: level }))}</span></div>
              <div class="xpbar"><i style="width:${pct}%"></i></div>
            </div>
            <span class="chip streak"><span class="dot"></span>${esc(streak + freezes)}</span>
            <div class="seg" role="group" aria-label="${esc(t("header.lang"))}">
              <button data-act="lang" data-v="da" aria-pressed="${settings.lang === "da"}">DA</button>
              <button data-act="lang" data-v="en" aria-pressed="${settings.lang === "en"}">EN</button>
            </div>
            <button class="icon-btn" data-act="sound" aria-label="${esc(settings.sound ? t("header.soundOn") : t("header.soundOff"))}" title="${esc(settings.sound ? t("header.soundOn") : t("header.soundOff"))}">${settings.sound ? SPEAKER_ON : SPEAKER_OFF}</button>
            <span class="sync-dot" data-s="${store.status}" title="${esc(syncLabel)}" aria-label="${esc(syncLabel)}" role="img"></span>
          </div>
        </header>`;
    }

    function hub() {
      const d = derive();
      const { summary } = store.state;
      const pct = Math.round((100 * d.examMastered) / data.exam.length);
      const doneToday = summary.lastDay === today();
      const bars = d.lastExams.length
        ? `<div class="bars-plot">${d.lastExams
            .map((h) => `<div class="bar ${h.score >= 20 ? "pass" : ""}" style="height:${(100 * h.score) / 25}%"><span>${h.score}</span></div>`)
            .join("")}${Array.from({ length: 5 - d.lastExams.length }, () => "<div></div>").join("")}<div class="line"><b>${esc(t("hub.passLine"))}</b></div></div>
           <div class="row"><span class="eyebrow">${esc(t("hub.lastResults"))}</span><span class="spacer"></span><span class="muted" style="font-size:var(--step--1)">${esc(t("hub.avg"))}: <b>${d.avg3.toFixed(1)}</b></span></div>`
        : `<p class="bars-empty">${esc(t("hub.noExams"))}</p>`;
      const papersPassed = Object.values(summary.papersBest).filter((s) => s >= 20).length;
      const tile = (mode, stat, extraAttr = "") => `
        <button class="tile" data-act="${extraAttr || "start"}" data-mode="${mode}">
          <h3>${esc(t(`mode.${mode}.name`))}</h3>
          <p>${esc(t(`mode.${mode}.blurb`))}</p>
          <span class="stat">${esc(stat)}</span>
        </button>`;
      const badges = Rewards.ACHIEVEMENTS.map(({ id }) => {
        const on = summary.achievements.includes(id);
        return `<div class="badge ${on ? "on" : ""}" title="${esc(t(`ach.${id}.desc`))}"><span class="mark">${on ? "✓" : ""}</span><span>${esc(t(`ach.${id}.name`))}</span></div>`;
      }).join("");
      const pctCorrect = summary.answered ? Math.round((100 * summary.correct) / summary.answered) : 0;
      return `
        <section class="sheet readiness">
          <div>
            <div class="eyebrow">${esc(t("hub.readiness"))}</div>
            <div class="big-num">${pct}<small>%</small></div>
            <p class="muted" style="font-size:var(--step--1)">${esc(t("hub.mastered", { n: d.examMastered, total: data.exam.length }))}</p>
          </div>
          <div class="bars">${bars}</div>
        </section>

        <section class="sheet daily">
          <div class="text">
            <span class="eyebrow">${esc(t("header.streak", { n: summary.streak }))}</span>
            <h2>${esc(t("mode.daily.name"))}</h2>
            <p class="muted">${esc(doneToday ? t("hub.dailyDone") : `${t("mode.daily.blurb")} ${t("hub.dueCount", { n: d.dueCount })}.`)}</p>
          </div>
          <button class="btn ${doneToday ? "ghost" : "red"}" data-act="start" data-mode="daily">${esc(doneToday ? t("hub.again") : t("hub.startDaily"))}</button>
        </section>

        <section class="row" style="gap:8px"><span class="eyebrow">${esc(t("hub.more"))}</span></section>
        <section class="tiles">
          ${tile("mock", summary.bestMock ? t("tile.bestMock", { n: summary.bestMock }) : t("tile.noRecord"))}
          ${tile("paper", t("tile.papersPassed", { n: papersPassed }), "papers")}
          ${tile("blitz", summary.bestBlitz ? t("tile.record", { n: summary.bestBlitz }) : t("tile.noRecord"))}
          ${tile("survival", summary.bestSurvival ? t("tile.record", { n: summary.bestSurvival }) : t("tile.noRecord"))}
          ${tile("topic", t("tile.topicStars", { n: d.starTotal }), "topics")}
          ${tile("pile", d.pileSize ? t("tile.pileCount", { n: d.pileSize }) : t("tile.pileEmpty"))}
        </section>

        <section style="display:flex;flex-direction:column;gap:10px">
          <span class="eyebrow">${esc(t("hub.achievements"))} · ${summary.achievements.length}/${Rewards.ACHIEVEMENTS.length}</span>
          <div class="badges">${badges}</div>
        </section>

        <footer class="foot">
          <span>${esc(t("hub.stats", { answered: summary.answered, pct: pctCorrect }))}</span>
          <span class="spacer"></span>
          ${confirmReset
            ? `<div class="confirm"><span>${esc(t("hub.resetAsk"))}</span><button class="btn small red" data-act="reset-yes">${esc(t("hub.resetConfirm"))}</button><button class="btn small ghost" data-act="reset-no">${esc(t("hub.cancel"))}</button></div>`
            : `<button class="btn small ghost" data-act="reset">${esc(t("hub.reset"))}</button>`}
        </footer>`;
    }

    function backBar() {
      return `<div class="row"><button class="btn small ghost" data-act="home">← ${esc(t("nav.back"))}</button></div>`;
    }

    function topics() {
      const d = derive();
      const srs = store.state.srs;
      const rows = data.topics.map((topic) => {
        const cards = data.cards.filter((c) => c.t === topic.t);
        const stars = d.topicStars[topic.t];
        const mastery = cards.reduce((a, c) => a + (srs[c.id] ? srs[c.id].b : 0), 0) / (5 * cards.length);
        const starHtml = [0, 1, 2].map((i) => (i < stars ? "★" : `<span class="off">★</span>`)).join("");
        return `
          <button class="list-row" data-act="start" data-mode="topic" data-tag="${esc(topic.t)}">
            <span class="name">${esc(topicName(topic.t))}</span>
            <span class="right"><span class="stars" aria-label="${stars}/3">${starHtml}</span></span>
            <span class="sub">${esc(t("topics.cards", { n: cards.length }))}</span>
            <span class="meter"><i style="width:${Math.round(100 * mastery)}%"></i></span>
          </button>`;
      }).join("");
      return `${backBar()}
        <div class="screen-head"><h1>${esc(t("topics.title"))}</h1><p class="muted">${esc(t("topics.blurb"))}</p></div>
        <div class="sheet list">${rows}</div>`;
    }

    function papers() {
      const best = store.state.summary.papersBest;
      const rows = Object.keys(data.papers).sort().reverse().map((code) => {
        const score = best[code];
        const pill = score === undefined
          ? `<span class="pill none">${esc(t("papers.notTaken"))}</span>`
          : `<span class="pill ${score >= 20 ? "pass" : "fail"}">${esc(score >= 20 ? t("papers.passed") : `${score}/25`)}</span>`;
        return `
          <button class="list-row" data-act="start" data-mode="paper" data-paper="${code}">
            <span class="name">${esc(monthLabel(code))}</span>
            <span class="right">${pill}</span>
            <span class="sub">${esc(score === undefined ? "25" : t("papers.best", { n: score }))}</span>
          </button>`;
      }).join("");
      return `${backBar()}
        <div class="screen-head"><h1>${esc(t("papers.title"))}</h1><p class="muted">${esc(t("papers.blurb"))}</p></div>
        <div class="sheet list">${rows}</div>`;
    }

    function sourceChip(item) {
      if (item.kind === "card") return t("play.fact", { topic: topicName(item.tag) });
      const last = monthLabel(item.e[item.e.length - 1]);
      return item.e.length === 1 ? t("play.seenOnce", { last }) : t("play.seenIn", { n: item.e.length, last });
    }

    function playScreen() {
      const cfg = session.cfg;
      const fb = play.feedback;
      const item = fb ? fb.item : play.flash ? play.flash.item : session.current();
      const shownIndex = fb || play.flash ? session.index() : session.index() + 1;
      const now = clock();
      let status = "";
      if (cfg.timeLimit) status += `<span class="timer" data-timer>${formatTime(session.remaining(now))}</span>`;
      if (cfg.lives) status += `<span class="hearts" aria-label="${esc(t("play.lives"))}: ${session.lives()}">${"♥".repeat(session.lives())}${"♡".repeat(cfg.lives - session.lives())}</span>`;
      if (cfg.feedback && session.combo() >= 4) status += `<span class="combo">${esc(t("play.combo", { m: Rewards.comboMultiplier(session.combo()) }))}</span>`;
      const counter = session.size() ? t("play.questionOf", { i: shownIndex, n: session.size() }) : t("play.question", { i: shownIndex });
      const progress = cfg.timeLimit && !session.size()
        ? `<div class="progress time"><i data-timebar style="width:${(100 * session.remaining(now)) / cfg.timeLimit}%"></i></div>`
        : session.size()
          ? `<div class="progress"><i style="width:${(100 * (shownIndex - 1)) / session.size()}%"></i></div>`
          : "";

      const options = item.o.map((text, i) => {
        let cls = "";
        if (fb) {
          if (i === item.a) cls = "right";
          else if (i === fb.pick) cls = "wrong";
          if (i === fb.pick) cls += " picked";
        } else if (play.flash && play.flash.pick === i) {
          cls = "picked";
        }
        const tr = play.showEn && en(text) ? `<span class="txt-en">${esc(en(text))}</span>` : "";
        return `<button class="opt ${cls}" data-act="answer" data-i="${i}" ${fb || play.flash ? "disabled" : ""}>
            <span class="box" aria-hidden="true"></span><span class="letter">${"ABC"[i]}:</span><span class="txt">${esc(text)}</span>${tr}
          </button>`;
      }).join("");

      let feedback = "";
      if (fb) {
        const ok = fb.res.correct;
        const parts = [];
        if (item.kind === "card") {
          parts.push(`<p class="full">${esc(item.full)}</p>`);
          if (play.showEn && en(item.full)) parts.push(`<p class="translation">${esc(en(item.full))}</p>`);
        } else if (!ok) {
          parts.push(`<p class="full"><b>${esc(t("play.answer"))}:</b> ${esc(item.o[item.a])}</p>`);
        }
        if (item.n) parts.push(`<p class="warn"><b>${esc(t("play.note"))}:</b> ${esc(item.n)}</p>`);
        if (item.w) parts.push(`<p class="warn">${esc(item.w)}${play.showEn && en(item.w) ? `<br><i class="muted">${esc(en(item.w))}</i>` : ""}</p>`);
        const ended = fb.res.ended;
        feedback = `
          <section class="feedback ${ok ? "ok" : "no"}" aria-live="polite">
            <div class="row"><span class="verdict">${esc(ok ? t("play.correct") : t("play.wrong"))}</span>${fb.res.xp ? `<span class="spacer"></span><b style="color:var(--gold)">${esc(t("result.xp", { xp: fb.res.xp }))}</b>` : ""}</div>
            ${parts.join("")}
            ${cfg.auto ? "" : `<div><button class="btn" data-act="next">${esc(ended ? t("play.seeResult") : t("play.next"))} →</button></div>`}
          </section>`;
      }

      const hint = cfg.feedback ? t("play.keysHint") : `${t("play.examHint")} ${t("play.keysHint")}.`;
      return `
        <div class="playbar">
          <button class="btn small ghost" data-act="quit">${esc(t("play.quit"))}</button>
          <span class="mode">${esc(t(`mode.${play.mode}.name`))}${play.opts.paper ? ` · ${esc(monthLabel(play.opts.paper))}` : ""}</span>
          <span class="spacer"></span>
          ${status}
        </div>
        ${progress}
        <article class="sheet qcard">
          <div class="qmeta"><span class="qnum">${esc(counter)}</span><span class="spacer"></span><span class="source">${esc(sourceChip(item))}</span></div>
          <h2 class="question">${esc(item.q)}</h2>
          ${play.showEn && en(item.q) ? `<p class="translation">${esc(en(item.q))}</p>` : ""}
          <button class="tr-btn" data-act="translate" aria-pressed="${play.showEn}">${esc(play.showEn ? t("play.hideTranslation") : t("play.translate"))}</button>
          <div class="options">${options}</div>
          ${play.floatXp ? `<span class="float-xp">+${play.floatXp}</span>` : ""}
        </article>
        ${feedback}
        ${fb ? "" : `<p class="hint">${esc(hint)}</p>`}`;
    }

    function resultScreen() {
      const { result: r, extra, mode, opts } = view;
      let head;
      if (EXAM_MODES.has(mode)) {
        const cells = r.answers
          .slice()
          .sort((a, b) => Number(b.correct) - Number(a.correct))
          .map((a) => `<i class="${a.correct ? "ok" : ""}"></i>`)
          .join("");
        head = `
          <div class="stamp ${r.passed ? "pass" : "fail"}">${esc(r.passed ? t("result.passed") : t("result.failed"))}</div>
          <div class="score-line">${esc(t("result.scoreOf", { score: r.score, total: r.total }))}</div>
          <div class="grid25" role="img" aria-label="${esc(t("result.scoreOf", { score: r.score, total: r.total }))}">${cells}<span class="mark20"><b>20</b></span></div>
          ${r.passed ? "" : `<p class="muted">${esc(t("result.needed"))}</p>`}
          <b style="color:var(--gold)">${esc(t("result.xp", { xp: r.xp }))}</b>`;
      } else {
        const line = mode === "blitz" ? t("result.blitz", { n: r.score })
          : mode === "survival" ? t("result.survival", { n: r.score })
          : t("result.session", { score: r.score, total: r.total });
        const xp = r.xp + extra.dailyXp;
        head = `
          <div class="eyebrow">${esc(t(`mode.${mode}.name`))}</div>
          <div class="big-num">${r.score}</div>
          <div class="score-line" style="font-size:var(--step-2)">${esc(line)}</div>
          ${extra.newRecord ? `<b style="color:var(--red)">${esc(t("result.newRecord"))}</b>` : ""}
          <p class="muted">${esc(t("result.bestCombo", { n: r.maxCombo }))}</p>
          ${extra.dailyXp ? `<b style="color:var(--gold)">${esc(t("result.dailyDone", { xp: extra.dailyXp }))}</b>` : ""}
          ${xp ? `<b style="color:var(--gold)">${esc(t("result.xp", { xp }))}</b>` : ""}`;
      }
      const notes = (item) =>
        [item.n ? `<span class="warn"><b>${esc(t("play.note"))}:</b> ${esc(item.n)}</span>` : "",
         item.w ? `<span class="warn">${esc(item.w)}${lang() === "en" && en(item.w) ? `<br><i class="muted">${esc(en(item.w))}</i>` : ""}</span>` : ""].join("");
      const mistakes = r.answers.filter((a) => !a.correct);
      const flaggedRight = r.answers.filter((a) => a.correct && (a.item.w || a.item.n));
      const list = mistakes.length
        ? mistakes.map(({ item, pick }) => `
            <div class="sheet mistake">
              <span class="q">${esc(item.q)}</span>
              ${lang() === "en" && en(item.q) ? `<span class="translation">${esc(en(item.q))}</span>` : ""}
              <span class="lab">${esc(t("result.yourAnswer"))}</span>
              <span class="yours">${esc(pick === null ? t("result.noAnswer") : item.o[pick])}</span>
              <span class="lab">${esc(t("result.rightAnswer"))}</span>
              <span class="right-a">${esc(item.kind === "card" ? item.full : item.o[item.a])}</span>
              ${notes(item)}
            </div>`).join("")
        : `<p class="muted">${esc(t("result.noMistakes"))}</p>`;
      const flagged = flaggedRight.length
        ? `<span class="eyebrow">${esc(t("result.notes"))}</span>${flaggedRight.map(({ item }) => `
            <div class="sheet mistake">
              <span class="q">${esc(item.q)}</span>
              <span class="right-a">${esc(item.o[item.a])}</span>
              ${notes(item)}
            </div>`).join("")}`
        : "";
      const again = `data-act="start" data-mode="${mode}"${opts.paper ? ` data-paper="${esc(opts.paper)}"` : ""}${opts.tag ? ` data-tag="${esc(opts.tag)}"` : ""}`;
      return `
        <section class="sheet result-head">${head}
          <div class="row" style="justify-content:center">
            <button class="btn red" ${again}>${esc(t("result.tryAgain"))}</button>
            <button class="btn ghost" data-act="home">${esc(t("result.home"))}</button>
          </div>
        </section>
        <section class="mistakes">
          <span class="eyebrow">${esc(t("result.mistakes"))} · ${mistakes.length}</span>
          ${list}
          ${flagged}
        </section>`;
    }

    function render() {
      document.documentElement.lang = lang();
      const body =
        view.screen === "play" ? playScreen()
        : view.screen === "result" ? resultScreen()
        : view.screen === "topics" ? topics()
        : view.screen === "papers" ? papers()
        : hub();
      el.innerHTML = header() + body;
    }

    // ---------- events ----------
    el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "home") return quit();
      if (act === "lang") {
        store.update("settings", (s) => ({ ...s, lang: btn.dataset.v, updatedAt: Date.now() }));
        return render();
      }
      if (act === "sound") {
        store.update("settings", (s) => ({ ...s, sound: !s.sound, updatedAt: Date.now() }));
        FX.setMuted(!store.state.settings.sound);
        return render();
      }
      if (act === "topics" || act === "papers") {
        view = { screen: act };
        render();
        return window.scrollTo(0, 0);
      }
      if (act === "start") {
        return startSession(btn.dataset.mode, { paper: btn.dataset.paper, tag: btn.dataset.tag });
      }
      if (act === "answer") return answer(Number(btn.dataset.i));
      if (act === "next") return next();
      if (act === "quit") return quit();
      if (act === "translate") {
        play.showEn = !play.showEn;
        return render();
      }
      if (act === "reset") {
        confirmReset = true;
        return render();
      }
      if (act === "reset-no") {
        confirmReset = false;
        return render();
      }
      if (act === "reset-yes") {
        confirmReset = false;
        store.reset();
        return render();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (view.screen !== "play" || !play || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const idx = { 1: 0, 2: 1, 3: 2, a: 0, b: 1, c: 2 }[key];
      if (idx !== undefined && !play.feedback) {
        e.preventDefault();
        answer(idx);
      } else if ((key === "enter" || key === " ") && play.feedback && !session.cfg.auto) {
        e.preventDefault();
        next();
      }
    });

    store.onChange(() => {
      // Re-render on sync/status changes only when it cannot disturb an answer in progress.
      if (view.screen === "hub" || view.screen === "topics" || view.screen === "papers") render();
      else {
        const dot = el.querySelector(".sync-dot");
        if (dot) dot.dataset.s = store.status;
      }
    });

    FX.setMuted(!store.state.settings.sound);
    return { render };
  }

  const api = { createUI };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UI = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
