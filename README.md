# Kryds & Bestå

A game-like quiz for learning the material for the Danish **Medborgerskabsprøven** (citizenship test). It uses 20 real past exams (Dec 2016 – Jun 2026) and 526 study cards. Questions are in Danish, and each one has an English translation you can reveal.

The exam has 25 multiple-choice questions, a 30-minute limit, and needs 20 correct answers to pass.

- **Play:** https://claude.ai/artifact/UndYwwogEbbBDke7dxBXL4 (a private claude.ai page; progress syncs between your devices)
- **Design spec:** [`docs/superpowers/specs/2026-10-04-medborgerskab-quiz-design.md`](docs/superpowers/specs/2026-10-04-medborgerskab-quiz-design.md)
- **Implementation plan:** [`docs/superpowers/plans/2026-10-04-kryds-og-besta.md`](docs/superpowers/plans/2026-10-04-kryds-og-besta.md)

## Modes

| Mode | What it is |
|---|---|
| Dagens runde | 15 spaced-repetition questions a day; keeps your streak |
| Prøveeksamen | 25 past-exam questions, 30 minutes, pass at 20 |
| Rigtige prøver | Replay any of the 20 real exams in their original order |
| Lynrunde | 60 seconds; combos multiply XP |
| Overlevelse | 3 lives, endless questions |
| Emnekort | The 26 study topics, each with 0–3 mastery stars |
| Fejlbunken | Questions you answered wrong recently |

## Requirements

- Python 3.13 or newer (build scripts and Python tests)
- Node 22 or newer (JavaScript tests)
- PyMuPDF, needed only if you re-parse the exam PDFs

## Setup

```bash
git clone git@github.com:rajatdua/medborgerskabsproven.git
cd medborgerskabsproven
python3 -m venv .venv
.venv/bin/pip install pymupdf    # only needed to re-parse PDFs
```

The generated content (`content/exams.json`, `content/data.json` and the translations) is committed. So for a normal build you can skip the PDF step.

## Build

```bash
python3 build/build_data.py      # content/ + Anki txt + translations -> content/data.json
python3 build/assemble.py        # app/ + data.json -> dist/index.html
```

`dist/index.html` is a single self-contained page. You can open it straight from disk. Progress is then saved only in that browser and the header shows "Ikke synkroniseret". Cloud sync works only when it is published as a claude.ai Artifact with the `db` and `user` capabilities.

## Test

```bash
npm test
```

This runs the JavaScript tests (`tests/js/*.test.js`, via `node --test`) and the Python tests (`tests/test_*.py`, via `unittest`). No npm packages are needed.

## Adding a new exam

When a new exam is published (e.g. November 2026):

1. Download `medborgerskabsproeven-YYYY-MM.pdf` and `medborgerskabsproeven-YYYY-MM-retteark.pdf` into your exams folder.
2. Re-parse all the PDFs. The parser stops with an error if any exam does not come out as exactly 25 questions with 25 answers.
   ```bash
   .venv/bin/python build/parse_exams.py "<path to exams folder>" content/exams.json
   ```
3. Find the strings that still need English:
   ```bash
   python3 build/strings.py --missing
   ```
4. Add the translations. Write the Danish strings as a JSON list in `content/translations/src/NN.da.json`, and their English in the same order in `NN.en.json`. Then merge:
   ```bash
   python3 build/strings.py --merge-src
   ```
5. Rebuild, test and assemble:
   ```bash
   python3 build/build_data.py && npm test && python3 build/assemble.py
   ```

Item ids are hashes of the question content, so existing progress carries over to the rebuilt data.

## Project layout

```
build/      parse_exams.py, build_data.py, strings.py, assemble.py
content/    exams.json, data.json, translations/ (generated, committed)
app/        template.html, styles.css, src/*.js (the game)
tests/      Python and JS tests
medborgerskabsproeven.txt   the original Anki export (tab-separated)
```

`app/src/` contains these modules:

| File | Role |
|---|---|
| `srs.js` | Spaced repetition |
| `rewards.js` | XP, levels, streaks, achievements |
| `merge.js` | Merging progress from two devices |
| `engine.js` | Question queues and sessions |
| `i18n.js` | Interface text in Danish and English |
| `store.js` | Local and cloud storage |
| `fx.js` | Sound, confetti, toasts |
| `ui.js` | Screens |
| `main.js` | Startup |

The first six are pure functions with unit tests.
