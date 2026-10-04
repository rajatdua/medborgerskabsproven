# Kryds & Bestå Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a game-like quiz for the Medborgerskabsprøven, using the user's 526 Anki cards and 20 past exams. It ships as one private claude.ai Artifact page with cloud-synced progress.

**Architecture:** A Python build pipeline turns the PDFs and the Anki txt into one `data.json` (deduplicated questions, stable ids, English translations). The page is plain HTML/CSS/JS, written as small source files under `app/` and inlined by `build/assemble.py` into `dist/index.html`. The game logic (SRS, rewards, merge, session engine, i18n) is pure JS and tested with `node --test`. The impure parts (store/sync, UI, effects) sit on top of it.

**Tech Stack:** Python 3.13 + PyMuPDF (build only, in `.venv`), `unittest`; Node 22 `node:test` for JS tests; Artifact capabilities `db` + `user`; Google Fonts.

**Spec:** `docs/superpowers/specs/2026-10-04-medborgerskab-quiz-design.md`

## Global Constraints

- Exam format: 25 questions, 30 minutes, 2–3 options, pass at **20** correct.
- Questions and answers are always shown in Danish. English appears only through the "Oversæt" chip. The interface language is DA by default, with a DA/EN switch in the header, the same on phone and desktop. No hover or key-hold behaviour.
- XP: 10 × combo multiplier; multiplier 1–3 → ×1, 4–7 → ×2, 8–11 → ×3, 12+ → ×4. Exam modes: 10/correct, +100 for a pass, +150 more for 25/25. Daily round complete: +50.
- Level L needs `75 × (L−1) × L` total XP. Ranks: Turist, Nytilflytter, Sprogskoleelev, Foreningsmedlem, Skolebestyrelsesmedlem, Vælger, Byrådsmedlem, Borgmester, Folketingsmedlem, Minister, Statsminister, Medborger (12+).
- SRS intervals by box 0–5: 0, 1, 3, 7, 16, 35 days. Mastered = box ≥ 4.
- Streak freeze: +1 per 7 streak days, max 3 held.
- Scoring rules are fixed and identical for all players (no difficulty settings), for the future leaderboard.
- Item ids come from content hashes, never from list position.
- Commits: **never** add a `Co-Authored-By` trailer.
- The page must work at ~400 px width, in light and dark themes, under `prefers-reduced-motion`, and with `localStorage` throwing.
- `.venv/`, `dist/` and `.DS_Store` are git-ignored.

## Review Focus

1. **Two devices with stale state.** An old phone cache must not overwrite newer reviews from the laptop. The merge test in Task 6 pins this (`newer review wins even when the stale side has a higher box`).
2. **Mock exam timer while the app is in the background.** Time comes from the deadline timestamp, not a ticking counter. When it expires, unanswered questions count as wrong. Pinned in Task 7 (`mock exam expires with unanswered counted wrong`).
3. **Streak across DST and month/year boundaries.** Day gaps are computed from date strings, not milliseconds. Pinned in Task 5 (`streak counts 2026-10-24 → 2026-10-25 as one day across DST`, `2026-12-31 → 2027-01-01`).
4. **Topics with few distinct card answers.** Distractors must be distinct, never equal to the correct answer, and fall back to other topics. Pinned in Task 7 (`cardToMCQ falls back when topic has <3 distinct answers`).
5. **Rebuilding with a new exam (e.g. Nov 2026)** must keep existing ids. Pinned in Task 2 (`ids stable when a new exam is added`).

---

## File Structure

```
build/
  parse_exams.py        PDF → per-exam questions + answer keys (exams.json)
  build_data.py         dedupe, ids, flags, papers, cards, translations → data.json
  strings.py            lists every content string that needs English; checks coverage
  assemble.py           inlines app/ + data.json into dist/index.html
content/
  exams.json            output of parse_exams.py (committed)
  translations/*.json   Danish → English maps, written in batches (committed)
  data.json             output of build_data.py (committed)
app/
  template.html         page skeleton with placeholders
  styles.css            tokens + components
  src/srs.js            SRS (pure)
  src/rewards.js        XP, levels, streak, achievements (pure)
  src/merge.js          device-state merge (pure)
  src/engine.js         MCQ building, queues, sessions (pure, rng injected)
  src/i18n.js           UI strings DA/EN + t() (pure)
  src/store.js          local + cloud persistence
  src/fx.js             sound, confetti, toasts
  src/ui.js             screens + rendering
  src/main.js           boot + wiring
tests/
  test_parse_exams.py, test_build_data.py
  js/*.test.js
```

**JS module pattern** (every `app/src/*.js` file): wrap the file in an IIFE taking `root`. Dependencies come from `root.X || require("./x.js")`. End with `if (typeof module === "object" && module.exports) module.exports = api; else root.<Name> = api;`. Global names: `SRS`, `Rewards`, `Merge`, `Engine`, `I18n`, `Store`, `FX`, `UI`.

---

### Task 1: Exam PDF parser

**Files:**
- Create: `build/parse_exams.py`, `tests/test_parse_exams.py`, `content/exams.json` (generated)
- Modify: `.gitignore` (add `.venv/`, `dist/`)

**Interfaces:**
- Produces: `content/exams.json` — a list of `{"exam": "YYYY-MM", "n": int, "q": str, "opts": [str], "a": int (0-based), "note": str}`; 500 entries.
- Functions: `extract_pdf_text(path: str) -> str`, `parse_exam_text(text: str) -> list[dict]` (each `{"n","q","opts"}`), `parse_answer_key(text: str) -> dict[int, tuple[str, str]]` (letter, note).

- [ ] **Step 1: Write failing tests** in `tests/test_parse_exams.py` (unittest), using inline text fixtures:
  - `test_basic_question`: `"1. Hvor mange medlemmer har Folketinget? \n☐ A: 87 \n☐ B: 179 \n☐ C: 265"` → `[{"n":1,"q":"Hvor mange medlemmer har Folketinget?","opts":["87","179","265"]}]`
  - `test_number_on_own_line`: `"8. \nHvad er en kollektiv overenskomst? \nA: En aftale…\nB: …"` → q equals `"Hvad er en kollektiv overenskomst?"`
  - `test_out_of_order_numbers`: text with questions 5, 7, 8, 6 → 4 questions, sorted by `n`
  - `test_merged_options_line`: `"A: Mindst 18 år B: Mindst 20 år"` → opts `["Mindst 18 år","Mindst 20 år"]`
  - `test_skips_page_headers`: lines containing `Medborgerskabsprøven` and bare page numbers are ignored
  - `test_answer_key_with_note`: `"Retteark\n1 \nA \n3 \n B – Mindst 18 år"` → `{1:("A",""),3:("B","Mindst 18 år")}`
  - `test_full_corpus` (skipped when `content/exams.json` is missing): 20 distinct exams, each with exactly 25 entries; every `a` < `len(opts)`; every `len(opts)` is 2 or 3.
- [ ] **Step 2:** Run `python3 -m unittest tests/test_parse_exams.py -v` → FAIL (module missing).
- [ ] **Step 3: Implement** the parser. Strip `☐☒`, NBSP and whitespace from each line. A question starts on `^(\d{1,2})\.(\s+.*|$)` when the number is 1–25 and not yet seen. Options are `^([ABC])[:.)]\s*`. Other lines continue the current field. Text is only taken from the answer key after `Retteark`. The CLI is `python build/parse_exams.py <pdf_dir> content/exams.json`. It exits non-zero and prints the offending exam when any exam does not have 25 questions and 25 answers.
- [ ] **Step 4:** `python3 -m venv .venv && .venv/bin/pip install pymupdf`, then run the CLI against `~/Library/Mobile Documents/com~apple~CloudDocs/Downloads/medborgerskab`. Run the tests → all PASS, including `test_full_corpus`.
- [ ] **Step 5: Commit** `feat: parse past exam PDFs and answer keys`.

### Task 2: Content data builder

**Files:**
- Create: `build/build_data.py`, `tests/test_build_data.py`, `content/data.json` (generated)

**Interfaces:**
- Consumes: `content/exams.json` (Task 1), `medborgerskabsproeven.txt`, `content/translations/*.json` (Task 3; optional at this task — missing translations are allowed until Task 3 when run with `--allow-missing-en`).
- Produces: `content/data.json`:
  ```
  { "exam":   [{"id","q","o":[str],"a":int,"e":["YYYY-MM"],"f":int,"w"?:str,"n"?:str}],
    "papers": {"YYYY-MM": [exam ids in original order, length 25]},
    "cards":  [{"id","q","a","t"}],
    "topics": [{"t":"FA01_Skole","da":"Skole"}],
    "en":     {danish_string: english_string} }
  ```
- Functions: `norm(s) -> str` (lowercase, keep `[a-zæøå0-9]`); `item_id(prefix, *parts) -> str` = `prefix + sha1("|".join(norm(p) for p in parts))[:10]`. Exam id = `item_id("e", q, *sorted(opts))`; card id = `item_id("c", q)`. `build(exams, cards_txt, en) -> dict`.

- [ ] **Step 1: Write failing tests:**
  - `test_dedupe_keeps_newest_wording`: two entries with the same normalised q+opts from 2018-06 and 2022-06 → one item, `e == ["2018-06","2022-06"]`, wording from 2022-06.
  - `test_frequency_by_question_text`: the same q with different option sets → two items, both with `f == 2`.
  - `test_dronning_flag`: a pre-2024 item mentioning "Dronningen" gets `w == "Fra før 2024 – i dag er det Kongen (Frederik 10.), der fx holder nytårstalen."`. The same item last seen in 2024-05 or later gets no `w`.
  - `test_regering_flag`: "nuværende regering" → `w == "Aktuelt spørgsmål – svaret afhænger af regeringen på prøvetidspunktet."`
  - `test_ids_stable_when_new_exam_added`: build A from exams X, build B from X plus a new exam → every id in A exists in B with the same q.
  - `test_papers_complete`: on the real corpus, 20 papers, each with 25 ids that all exist in `exam`.
  - `test_cards_and_topics`: 526 cards, 26 topics, `"FA13_Folketing_og_regering"` → da `"Folketing og regering"`.
- [ ] **Step 2:** Run `python3 -m unittest tests/test_build_data.py -v` → FAIL.
- [ ] **Step 3: Implement** `build()` and the CLI `python build/build_data.py [--allow-missing-en]`. Without the flag, it exits non-zero and lists any content string missing from `en` (via `build/strings.py: needed_strings(data) -> set[str]`, covering every exam q/o/w/n, card q/a and topic da).
- [ ] **Step 4:** Run the tests → PASS. Run the CLI with `--allow-missing-en`. Expect ~384 exam items.
- [ ] **Step 5: Commit** `feat: build deduplicated quiz data with stable ids`.

### Task 3: English translations

**Files:**
- Create: `content/translations/01.json` … `NN.json` (≤ 200 strings each), `build/strings.py` CLI mode

**Interfaces:**
- Consumes: `needed_strings` (Task 2).
- Produces: maps of Danish to English, merged into `data.json["en"]`.

- [ ] **Step 1:** `python build/strings.py --missing > /tmp/missing.json` lists the untranslated strings (expect ~2,000 unique).
- [ ] **Step 2:** Translate in batches of ≤ 200 into `content/translations/NN.json`. The rules:
  - Natural, plain English. Keep Danish proper nouns (Folketinget → "the Folketing (Parliament)" the first time it appears in a string, otherwise "the Folketing").
  - Keep numbers and years exactly.
  - Translate "Ja"/"Nej" as "Yes"/"No".
- [ ] **Step 3:** Run `python build/build_data.py` (no flag) → exits 0, "0 missing".
- [ ] **Step 4:** Spot-check 20 random pairs by printing them. Fix any wrong meanings.
- [ ] **Step 5: Commit** `feat: add English translations for all content`.

### Task 4: SRS module

**Files:** Create `app/src/srs.js`, `tests/js/srs.test.js`

**Interfaces:**
- Produces (`SRS`):
  - `DAY = 86400000`, `INTERVALS = [0,1,3,7,16,35]`
  - `review(entry | undefined, correct: boolean, now: number) -> {b,d,t,s,p}`. `b` = box; `d` = due ms = `now + INTERVALS[b]*DAY`; `t` = now; `s` = consecutive correct count; `p` = in mistake pile.
  - `isDue(entry, now) -> boolean` (an undefined entry → false)
  - `isMastered(entry) -> boolean` (b ≥ 4)
  - `weight(item, entry, now) -> number` = `(6-b)²` × 1.5 if unseen × 2 if due × `(1 + 0.4*(item.f-1))` when `item.f` is set
  - `pickWeighted(items, n, weightFn, rng) -> items` (weighted sampling without replacement; Efraimidis–Spirakis `rng()^(1/w)`)
  - `topicStars(entries: (entry|undefined)[]) -> 0..3`: average `b/5` over all cards in the topic; ≥ 0.8 → 3, ≥ 0.5 → 2, ≥ 0.2 → 1

- [ ] **Step 1: Failing tests:**
  - `review climbs boxes and caps at 5` (6 correct answers → b 1,2,3,4,5,5)
  - `wrong resets box and enters pile` (b=3 + wrong → b 0, p true, s 0, d == now)
  - `pile clears after two correct in a row` (wrong, correct → p true; correct again → p false)
  - `due uses intervals` (b becomes 2 → d == now + 3*DAY)
  - `pickWeighted returns n distinct items` and `never picks zero-weight items`
  - `topicStars thresholds` (all b=4 → 0.8 → 3; all undefined → 0)
- [ ] **Step 2:** `node --test tests/js` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `node --test tests/js` → PASS.
- [ ] **Step 5: Commit** `feat: add spaced repetition module`.

### Task 5: Rewards module

**Files:** Create `app/src/rewards.js`, `tests/js/rewards.test.js`

**Interfaces:**
- Produces (`Rewards`):
  - `comboMultiplier(combo) -> 1|2|3|4`; `answerXP(combo) -> number`; `examXP(correct) -> number`; `DAILY_XP = 50`
  - `levelForXP(xp) -> L`; `xpForLevel(L) -> 75*(L-1)*L`; `RANKS` (12 Danish titles, in order); `rankIndex(L) -> min(L-1, 11)`
  - `localDay(date: Date) -> "YYYY-MM-DD"` (local time); `daysBetween(a, b) -> int` (from `Date.UTC` on the string parts)
  - `emptySummary() -> {xp:0, streak:0, freezes:0, lastDay:null, bestBlitz:0, bestSurvival:0, bestMock:0, papersBest:{}, achievements:[], answered:0, correct:0, maxCombo:0, pilePeak:0, updatedAt:0}`
  - `completeDay(summary, today) -> summary` (returns a new object): same day → unchanged; gap 1 → streak+1; gap g>1 with freezes ≥ g−1 → spend g−1 freezes, streak+1; otherwise streak=1. When the new streak % 7 === 0 → freezes = min(3, freezes+1).
  - `ACHIEVEMENTS: [{id, test(summary, ctx) -> boolean}]` with ids `first, passed, perfect, combo15, blitz20, survival30, archivist, allTopics, topicMaster, streak7, streak30, streak100, mastered100, pileCleared, nightOwl`. ctx = `{masteredCount, topicStars: {tag: n}, pileSize, lastResult?: {mode, score, passed}, hour}`. `pileCleared` = `pilePeak ≥ 10 && pileSize === 0`. `archivist` = 20 keys in `papersBest`.
  - `newAchievements(summary, ctx) -> string[]` (ids that pass and are not already held)

- [ ] **Step 1: Failing tests:**
  - `combo multiplier bands` (3→1, 4→2, 7→2, 8→3, 12→4, 30→4)
  - `exam XP` (19→190, 20→300, 25→500)
  - `levels` (0→1, 149→1, 150→2, 450→3, 6750→10)
  - `streak counts 2026-10-24 → 2026-10-25 as one day across DST`
  - `streak crosses year 2026-12-31 → 2027-01-01`
  - `freeze covers one missed day` (freezes 1, gap 2 → streak+1, freezes 0)
  - `freeze earned every 7 days, capped at 3`
  - `pileCleared needs a peak of 10`, `archivist needs 20 papers`
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: add XP, levels, streaks and achievements`.

### Task 6: Device-state merge

**Files:** Create `app/src/merge.js`, `tests/js/merge.test.js`

**Interfaces:**
- Produces (`Merge`):
  - `mergeSrs(a, b) -> map`: per id, the entry with the larger `t` wins
  - `mergeSummary(a, b) -> summary`: `max` of xp, bestBlitz, bestSurvival, bestMock, answered, correct, maxCombo, pilePeak, updatedAt, and per-key `papersBest`; union of achievements; streak/freezes/lastDay taken from the side with the later `lastDay` (tie → larger streak)
  - `mergeHistory(a, b) -> list`: union by `date + "|" + (paper || "")`, newest first, max 50
  - `mergeState(local, remote) -> {state, remoteStale: string[]}`: state = `{srs, summary, history, settings}`; settings come from whichever side has the later `settings.updatedAt`; `remoteStale` lists the doc names whose merged value differs from remote

- [ ] **Step 1: Failing tests:**
  - `newer review wins even when the stale side has a higher box`
  - `summary takes max xp and unions achievements`
  - `streak follows the later lastDay`
  - `history dedupes and keeps 50 newest`
  - `remoteStale lists only changed docs`
  - `merging with empty remote returns local and marks all docs stale`
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: add merge rules for multi-device progress`.

### Task 7: Session engine

**Files:** Create `app/src/engine.js`, `tests/js/engine.test.js`, `tests/js/fixtures.js` (a small fake dataset: 3 papers × 25 exam items, 3 topics with 2–12 cards, including a topic where every card has the same answer)

**Interfaces:**
- Consumes: `SRS.review/isDue/weight/pickWeighted`, `Rewards.answerXP/examXP`.
- Produces (`Engine`):
  - `MODES`: `daily {count:15, feedback:true}`, `mock {count:25, timeLimit:1800000, feedback:false, pass:20}`, `paper {timeLimit:1800000, feedback:false, pass:20, ordered:true}`, `blitz {timeLimit:60000, feedback:true, endless:true, auto:{right:700, wrong:1600}}`, `survival {lives:3, feedback:true, endless:true}`, `topic {count:10, feedback:true}`, `pile {count:15, feedback:true}`
  - `examToMCQ(item) -> {id, kind:"exam", q, o, a, e, f, w?, n?}` (original option order)
  - `cardToMCQ(card, cardsByTag, allCards, rng) -> {id, kind:"card", q, o:[3], a, full, tag}`: distractors are distinct by `norm` and not equal to the correct answer. Pick 2 at random from the 6 same-topic answers nearest in length; if fewer than 2 are available, fill from `allCards`. Options are shuffled.
  - `buildQueue(mode, opts, ctx) -> MCQ[]`. ctx = `{data, srs, now, rng}`. opts = `{paper?, tag?}`.
    - daily: due items (exam and card) by earliest `d`, up to 10, then weighted-new to 15
    - mock: 25 exam items by weight
    - paper: `data.papers[opts.paper]` in order
    - topic: 10 cards from `opts.tag` by weight
    - pile: items with `p` true, by weight, up to 15
  - `createSession(mode, opts, ctx) -> Session`, with:
    - `current() -> MCQ | null`
    - `answer(i, now) -> {correct, xp, combo, mult, ended, review:{id, correct}}`. Answers after the deadline are ignored and return `ended:true`. Endless modes draw the next item with a 70/30 exam/card mix and no repeats within the session.
    - `skip()`
    - `remaining(now) -> ms | null`
    - `result(now) -> {mode, score, total, passed?, maxCombo, xp, answers:[{item, pick, correct}]}`

- [ ] **Step 1: Failing tests:**
  - `mock queue has 25 distinct exam items`
  - `paper keeps original order`
  - `mock exam expires with unanswered counted wrong` (answer 10 correctly, then call `result(start+1800001)` → total 25, score 10, passed false)
  - `mock gives no per-answer xp and examXP at the end`
  - `survival ends after 3 wrong`
  - `blitz combo multiplies xp` (4th correct in a row → xp 20)
  - `cardToMCQ includes correct answer once with 2 distinct distractors`
  - `cardToMCQ falls back when topic has <3 distinct answers`
  - `daily puts due items first`
- [ ] **Step 2–4:** FAIL → implement → PASS (inject `rng` as a seeded mulberry32 in tests).
- [ ] **Step 5: Commit** `feat: add quiz session engine for all modes`.

### Task 8: i18n strings

**Files:** Create `app/src/i18n.js`, `tests/js/i18n.test.js`

**Interfaces:**
- Produces (`I18n`): `STRINGS = {da:{…}, en:{…}}`; `t(key, lang, vars?) -> string` with `{name}` interpolation; it falls back to `da`, then to the key.
  - Keys cover: the hub, the 7 mode names and blurbs, the play screen (Næste, Oversæt, Skjul oversættelse, Afslut, lives, timer), results (BESTÅET, IKKE BESTÅET, "{score} ud af 25", "Du skal have mindst 20 rigtige"), the topic map, past exams, settings, sync status ("Synkroniseret" / "Ikke synkroniseret"), 12 rank titles, and 15 achievement names and descriptions.

- [ ] **Step 1: Failing tests:** `da and en have identical key sets`, `no empty strings`, `interpolates vars`, `falls back to da`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: add Danish and English interface strings`.

### Task 9: Store and sync

**Files:** Create `app/src/store.js`, `tests/js/store.test.js`

**Interfaces:**
- Consumes: `Merge.mergeState`, `Rewards.emptySummary`.
- Produces (`Store`): `createStore({storage, getDb, getUser, debounceMs = 3000, now = Date.now}) -> store`, with:
  - `store.state` = `{srs, summary, history, settings:{lang:"da", sound:true, updatedAt:0}}`
  - `load() -> Promise<void>`: reads local, then remote, merges, writes back stale docs
  - `update(doc, fn)`: mutates, saves locally at once, schedules a cloud write
  - `flush() -> Promise`
  - `status` = `"local" | "syncing" | "synced" | "offline"`
  - `onChange(fn)`
- Local keys: `kob:v1:<doc>`. Every storage access is wrapped in try/catch.
- Cloud: collection `data/users/<user.id()>`, docs `srs`, `summary`, `history`, `settings`. **Before writing, read `artifact-capabilities/0.2.67/db.d.ts`** for the exact `doc().get/set` shapes and the document size limit. If the srs map can exceed the limit (~910 entries × ~60 B), shard it into `srs-e` (exam) and `srs-c` (cards).

- [ ] **Step 1: Failing tests** (fake storage + fake db):
  - `works when localStorage throws`
  - `status local when db is null`
  - `load merges remote and writes back only stale docs`
  - `debounces cloud writes` (3 updates within 3 s → 1 write per doc)
  - `flush writes immediately`
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: add local and cloud progress store`.

### Task 10: Page shell, styles and hub screens

**Files:** Create `app/template.html`, `app/styles.css`, `app/src/fx.js`, `app/src/ui.js` (hub, topic map, past exams, settings), `app/src/main.js`, `build/assemble.py`

**Interfaces:**
- Consumes: all modules above; data from `<script id="data" type="application/json">`.
- Produces: `UI.render(screen, params)` with screens `hub | topics | papers | play | result`; `FX.sound(name)` with names `right | wrong | level | pass`; `FX.confetti()`; `FX.toast(text)`. Assembly: `python build/assemble.py` → `dist/index.html` (template placeholders `/*STYLES*/`, `<!--DATA-->`, `<!--SCRIPTS-->`; script order srs, rewards, merge, engine, i18n, store, fx, ui, main).

Design (from the spec's look and feel; write these as the `:root` tokens):
- Ink navy text on a cool pale ground, Dannebrog red accent, gold for XP. Semantic green for correct and orange-red for wrong. Full light and dark token sets.
- Fonts: Big Shoulders Display (display/numbers), Figtree (body), JetBrains Mono (labels, A:/B:/C:).
- A small Dannebrog cross mark in the header. Answer options as ☐ boxes that show ☒ when picked.
- Header: brand, level chip with rank, XP bar, streak + freezes, DA/EN switch, mute, sync dot.
- Hub:
  - Readiness panel (% mastered, avg of last 3 exams against the 20 line, last 5 results as bars)
  - Primary "Dagens runde" button showing the due count
  - A tile grid for the other 6 modes, each showing its best score or count
  - Achievement strip
  - Footer stats and a two-step "Nulstil" (reset) with an in-page confirm
- Topic map: 26 topics with stars and mastery bars. Past exams: 20 rows with the Danish month label, best score and a pass chip.

- [ ] **Step 1:** Write the template, the styles and the hub, topic and past-exam screens. `main.js` boots by rendering from local state immediately, then calls `store.load()` and re-renders.
- [ ] **Step 2:** Write `assemble.py`. Run it, then run `node --check` on each `app/src/*.js` → exit 0.
- [ ] **Step 3:** Open `dist/index.html` locally in a browser and confirm the hub renders with zero progress and the DA/EN switch flips the interface text (one manual check).
- [ ] **Step 4: Commit** `feat: add page shell, styles and hub screens`.

### Task 11: Play and result screens, effects

**Files:** Modify `app/src/ui.js`, `app/src/fx.js`, `app/styles.css`, `app/src/main.js`

**Interfaces:**
- Consumes: `Engine.createSession`, `Store.update`, `Rewards.*`, `FX.*`.

Behaviour:
- **Play screen:**
  - Progress (n/25, a timer bar, or hearts), the combo meter and the question card.
  - The source chip: "Stillet i N prøver · senest YYYY-MM", or "Fakta · <topic>".
  - The **Oversæt** chip toggles the English for the question and options.
  - Feedback modes: green/red marking, a floating +XP, and an explanation panel (card full answer, `n` note, `w` warning, each with its English under Oversæt) with **Næste**.
  - Keys: `1/2/3`, `A/B/C`, `Enter`.
- After each answer: `store.update("srs", …)` with `SRS.review`, and update the summary counters, `maxCombo` and `pilePeak`. Check `newAchievements` and level-up (toast + confetti + sound).
- **Result screen:**
  - Exam modes: a rotated red rubber-stamp BESTÅET / IKKE BESTÅET, "score ud af 25", and a 25-cell grid with a marker after cell 20.
  - All modes: the mistake review (question, your pick struck through, the correct answer), "Prøv igen" and "Til forsiden".
  - Record history, best scores and `papersBest`; daily completion calls `completeDay` + `DAILY_XP`.
- Confetti and the stamp animation are skipped under `prefers-reduced-motion`. Sound is created on the first user gesture and respects the mute setting.

- [ ] **Step 1:** Implement the play and result screens and the effects.
- [ ] **Step 2:** Run `node --test tests/js` (all still PASS) and `node --check` on the sources; re-run `assemble.py`.
- [ ] **Step 3:** Play one full mock exam locally (an answer-all-A run → score shown, grid, review list) and one Blitz round → manual check.
- [ ] **Step 4: Commit** `feat: add play and result screens with effects`.

### Task 12: Publish and verify

**Files:** none new (publishes `dist/index.html`)

- [ ] **Step 1:** Publish `dist/index.html` with the Artifact tool: `icon: "quiz"`, `capabilities: {db: {}, user: {}}`, description "Gamified practice for the Danish Medborgerskabsprøven with synced progress."
- [ ] **Step 2:** Run one preview (phone and desktop, light and dark). Fix what it reports in one pass, then republish.
- [ ] **Step 3: Sync check:** write one probe doc to `data/users/me/probe` with `write_db`, read it back with `read_db`, then delete it.
- [ ] **Step 4:** Commit `chore: publish v1` with the artifact URL in the message body. Give the user the link.
