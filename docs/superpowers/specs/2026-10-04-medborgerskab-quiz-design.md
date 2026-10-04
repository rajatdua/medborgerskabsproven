# Medborgerskabsprøven quiz game — design spec

Date: 2026-10-04
Status: Draft, awaiting review
Working title: **Kryds & Bestå** (refers to the exam's ☐/☒ answer boxes)

## 1. Goal

Replace Anki with a fun, game-like quiz for learning the material for the Danish
Medborgerskabsprøven (citizenship test). The exam is in 2027, so the tool is for
**long-term retention and a daily habit**, not cramming.

Success criteria:
- Mock exams reliably score at or above the pass mark (20/25).
- The game is engaging enough to play daily for months.
- Progress syncs between phone and laptop with no manual steps.

Single user for now. A multiplayer leaderboard is planned as **future scope**
(see §8). The data model has to make adding it easy, but no leaderboard is built now.

## 2. Content sources

| Source | Location | Contents |
|---|---|---|
| Anki export | `medborgerskabsproeven.txt` (this folder) | 526 Danish Q&A cards, tab-separated, 26 topic tags `FA01_Skole` … `FA26_Klima` |
| Past exams | `~/Library/Mobile Documents/com~apple~CloudDocs/Downloads/medborgerskab/medborgerskabsproeven-YYYY-MM.pdf` | 20 exams, Dec 2016 → Jun 2026, 25 MCQ each (2–3 options) |
| Answer keys | same folder, `…-retteark.pdf` | Correct letter per question, sometimes with a short note |

Facts about the exam format (from the PDFs): 25 questions, 30 minutes, 2–3 options each,
pass at **20 correct**.

### 2.1 Content build pipeline (one-time, local, Python)

1. Extract text from all PDFs (PyMuPDF, in a scratch venv).
2. Parse the questions: number `N.`, options `A:`/`B:`/`C:`, tolerant of out-of-order
   text, empty `8.` lines, and options merged onto one line.
3. Parse the answer keys into a number → letter (+ optional note) map.
4. **Validate:** every exam has exactly 25 questions and 25 answers, and every
   question has 2–3 options and a valid answer index. The build fails otherwise.
5. Deduplicate by normalised question text + normalised option set, which gives
   ~384 unique questions. Keep the newest wording, and record which exams each
   question appeared in, plus a frequency count by question text.
6. Flag outdated items:
   - Questions from before 2024 that mention "dronning": note that since 2024 it is
     Kongen (Frederik 10.).
   - "nuværende regering": note that the answer depends on the government at the time.
7. Record `papers`: each exam's original 25-question order (as indices into the
   unique list) for the Real Exams mode.
8. Load the cards from the Anki txt.
9. **Translations:** Claude writes English translations for every exam question,
   option, card question, card answer and topic name, generated during the build
   and stored in a JSON file. Validate that no string is missing a translation.
10. Emit one `data.json` that is embedded in the page.

Expected size of the embedded data: ~300–400 KB.

## 3. Language

- **Questions and answers are always in Danish**, as on the real exam.
- An **"Oversæt" chip** on each question reveals the English for the question and
  all options. After answering, the explanation also shows its English when revealed.
- **Interface text** (menus, buttons, labels, achievements, toasts) is in Danish
  by default, with a **DA / EN switch in the header**. The same control is used on
  phone and laptop; no hover or key-hold behaviour. The choice is saved in settings.
- EN mode does **not** translate the questions; the Oversæt chip still applies.

## 4. Game modes

All modes run on one session engine, configured per mode. Every answer updates
the shared spaced-repetition (SRS) state, except where noted.

| Mode | DA name | Rules |
|---|---|---|
| Daily round | **Dagens runde** | ~15 questions: due reviews first, then a few new items, weighted towards frequent past-exam questions. Completing it counts the day for the streak. Instant feedback. |
| Mock exam | **Prøveeksamen** | 25 past-exam questions picked by SRS weighting, 30-minute timer, no feedback until the end, pass at ≥ 20. Result screen with a BESTÅET / IKKE BESTÅET stamp, a 25-cell result grid with the pass line, and a mistake review. |
| Real past exams | **Rigtige prøver** | Choose any of the 20 exams and replay its 25 questions in the original order. Otherwise the same rules as the mock exam. Best score saved per exam. |
| Blitz | **Lynrunde** | 60 seconds, as many as possible, combo multiplier, auto-advance. High score. |
| Survival | **Overlevelse** | 3 lives, endless mixed questions, ends at 0 lives. High score. |
| Topic map | **Emnekort** | Grid of the 26 topics with 0–3 mastery stars each. Tap a topic for a 10-card session from that topic. |
| Mistake pile | **Fejlbunken** | Items answered wrong recently. An item leaves the pile after 2 correct answers in a row. |

### 4.1 Question types

- **Exam questions:** shown with their original options in their original order,
  labelled A/B/C.
- **Cards:** turned into MCQ with the correct answer plus 2 distractors, chosen at
  random from the answers of other cards **in the same topic**, preferring
  similar length. Options are shuffled. After answering, the full card answer is
  shown as the explanation.
- Each exam question shows a chip such as "Stillet i 6 prøver · senest 2026-06".
  Outdated items show their warning note after answering.

### 4.2 Answer interaction

- Options use the exam's checkbox style: an empty box, which shows ☒ when picked.
- Instant-feedback modes: the correct option turns green and a wrong pick turns red
  with strike-through. An explanation panel appears with a "Næste" button
  (Blitz auto-advances).
- Keyboard on laptop: `1/2/3` or `A/B/C` answers, `Enter` goes to the next question.

## 5. Progression and rewards

### 5.1 SRS (Leitner-style)

- Each item (exam question or card) has a box 0–5 and a due date.
- Correct answer: box + 1 (max 5). Wrong answer: box = 0, and the item is added
  to Fejlbunken.
- Review intervals by box: 0 → same session/next day, 1 → 1 d, 2 → 3 d,
  3 → 7 d, 4 → 16 d, 5 → 35 d.
- "Mestret" (mastered) = box ≥ 4.
- Selection weight for non-scheduled modes favours low boxes, items that are due,
  and high past-exam frequency.

### 5.2 XP and levels

- Correct answer: 10 XP × combo multiplier. Combo 1–3 → ×1, 4–7 → ×2,
  8–11 → ×3, 12+ → ×4. A wrong answer resets the combo.
- Mock and real exams give 10 XP per correct answer at the end, +100 for a pass and
  +150 more for 25/25 (no combo, since there is no feedback during the exam).
- Completing the daily round: +50.
- Level threshold: reaching level L needs `75 × (L−1) × L` XP in total.
- Rank titles by level: Turist, Nytilflytter, Sprogskoleelev, Foreningsmedlem,
  Skolebestyrelsesmedlem, Vælger, Byrådsmedlem, Borgmester, Folketingsmedlem,
  Minister, Statsminister, Medborger (level 12+ keeps "Medborger" and shows the number).
- **Scoring rules are fixed and the same for all players** (no difficulty settings),
  so that a future leaderboard is fair.

### 5.3 Streak

- A day counts when the Dagens runde is completed (by local date).
- Streak freeze ("fridag"): earn 1 for every 7 streak days (max 3 held). A missed
  day uses one up automatically.

### 5.4 Hub readiness panel

- **Prøveparathed:** % of exam-bank questions mastered.
- Average of the last 3 mock/real exams, shown against the 20/25 line, plus the
  last 5 results as small bars.

### 5.5 Achievements (~15)

Første kryds, Bestået!, Fejlfri (25/25), Combo 15, Lynhurtig (20+ in Blitz),
Overlever (30+ in Survival), Arkivar (all 20 real exams completed), Hele Danmark
(every topic ≥ 1 star), Emnemester (one topic at 3 stars), Ugens medborger
(7-day streak), Månedens medborger (30), 100 dage, Mester (100 mastered),
Tømt bunke (Fejlbunken emptied after having ≥ 10 items), Natteravn (answers after
midnight). Achievements show as a badge strip on the hub, with locked badges dimmed.
Each unlock shows a toast.

### 5.6 Feel

- Short WebAudio sound effects for correct, wrong, level-up and pass, with a
  mute toggle saved in settings.
- Confetti in Dannebrog red and white on a pass and on level-up. It is disabled
  under `prefers-reduced-motion`.
- Floating "+XP" text and a combo meter.

## 6. Technical design

### 6.1 Delivery

- One self-contained HTML page (plain HTML, CSS and JS, no framework or build
  tooling at runtime), published as a **private claude.ai Artifact**.
- Declared capabilities: `db` and `user`.
- Works at phone width (~400 px) and on desktop, in light and dark themes.
- The source of truth for the page lives in this folder (`app/`), along with the
  build scripts (`build/`) that generate `data.json` and inject it.

### 6.2 Modules (sections of the single file)

| Module | Responsibility |
|---|---|
| `data` | Embedded content; lookups by id, topic and exam |
| `i18n` | DA/EN interface strings and `t(key)` |
| `srs` | Box/due updates, selection weighting, mastery |
| `engine` | Session runner; one engine, with mode configs for the 7 modes |
| `rewards` | XP, levels, combos, streak/freeze, achievements |
| `store` | Local cache + cloud sync, merge rules |
| `ui` | Screens: hub, play, result, topic map, past-exam list, settings |
| `fx` | Sound, confetti, toasts |

The `srs`, `rewards` and `store` merge functions are pure (no DOM), so they can be unit-tested.

### 6.3 Item ids

Stable ids derived from content, not from list position, so that rebuilding the
data (e.g. adding the Nov 2026 exam) does not orphan existing progress:
- Exam question: a short hash of the normalised question + option set.
- Card: a short hash of the normalised card question.

### 6.4 Storage and sync

Cloud (private to the user):
- `data/users/<id>/srs` — map of item id → `{b: box, d: due, t: lastReviewedAt, s: streakCorrect}`
- `data/users/<id>/summary` — `{xp, level, streak, freezes, lastDay, bestBlitz,
  bestSurvival, bestMock, papersBest: {exam: score}, achievements: [...],
  answered, correct, updatedAt}`
- `data/users/<id>/history` — the last 50 mock/real exam results `{date, score, paper?}`
- `data/users/<id>/settings` — `{lang, sound}`

Local: a copy of the same docs in `localStorage` (wrapped in try/catch) for instant
load and short offline periods.

Sync behaviour:
- On load: render from local immediately, then fetch the cloud copy, merge, re-render
  and write back if the merge changed anything.
- On change: update local at once and debounce cloud writes (~3 s, plus on
  `visibilitychange` → hidden). Write only the docs that changed.
- Merge rules:
  - SRS: per item, the entry with the newer `t` wins.
  - Summary: `max` for xp, best scores, answered/correct, per-paper bests; union
    for achievements; streak/lastDay come from the side with the later `lastDay`.
  - History: union by (date, paper), newest 50 kept.
- If `db` is unavailable (signed out or offline): the page keeps working on local
  storage and shows a small "Ikke synkroniseret" indicator.

## 7. Testing

Local, before publishing:
- Content validation (§2.1 step 4): all 20 exams parse to 25/25 and match their
  answer keys, and every question has 2–3 options.
- Translation completeness: every content string and every UI key has an EN value.
- Unit tests (Node, plain asserts) for the pure functions: SRS box/due transitions,
  combo multiplier and XP, level thresholds, streak + freeze over date gaps
  (including month/year boundaries), and merge rules for conflicting device states.
- A syntax check of the page script.

After publishing:
- One visual preview at phone and desktop widths in light and dark.
- One sync check: read back the user's `summary` doc after a probe write.

## 8. Future scope (not built now)

- **Multiplayer leaderboard.** Publish each player's `summary` (or a subset of it:
  display name id, xp, level, streak, best scores) to a shared `leaderboard/{self}`
  collection with the rule "everyone reads, each writes their own". Because XP rules
  are fixed and the summary already exists, this needs only an access rule, a publish
  step and a leaderboard screen.
  Known limitation: scores are computed client-side, so a determined player could
  inflate their own. That's acceptable for a friends leaderboard.
- Adding new exams as they are published (re-run the build; stable ids keep progress).

## 9. Out of scope

- Free-text answers or typing practice.
- Audio pronunciation.
- Native app / PWA install.
- Editing cards inside the app (edit the txt and rebuild instead).
