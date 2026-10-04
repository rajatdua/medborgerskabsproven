"""Parse past Medborgerskabsprøven PDFs and answer keys into content/exams.json.

Usage: python build/parse_exams.py <pdf_dir> <out.json>
"""
import glob
import json
import os
import re
import sys

QUESTION_RE = re.compile(r"^(\d{1,2})\.(?:\s+(.*)|$)")
OPTION_RE = re.compile(r"^([ABC])[:.)]\s*(.*)")
INLINE_OPTION_RE = re.compile(r"\s+[BC]:\s+")


def extract_pdf_text(path):
    import pymupdf

    with pymupdf.open(path) as doc:
        return "\n".join(page.get_text() for page in doc)


def _clean(line):
    return line.replace(" ", " ").strip().strip("☐☒").strip()


def _squash(s):
    return re.sub(r"\s+", " ", s).strip()


def _is_noise(line):
    return "Medborgerskabsprøven" in line or re.fullmatch(r"\d+", line) is not None


def parse_exam_text(text):
    questions = {}
    current = None
    field = None
    for raw in text.split("\n"):
        line = _clean(raw)
        if not line or _is_noise(line):
            continue
        m = QUESTION_RE.match(line)
        # Before question 1, numbered lines are headers (e.g. "3. juni 2026").
        if m and 1 <= int(m.group(1)) <= 25 and int(m.group(1)) not in questions and (questions or int(m.group(1)) == 1):
            n = int(m.group(1))
            current = {"n": n, "q": m.group(2) or "", "opts": {}}
            questions[n] = current
            field = "q"
            continue
        if current is None:
            continue
        m = OPTION_RE.match(line)
        if m and m.group(1) not in current["opts"]:
            field = m.group(1)
            current["opts"][field] = m.group(2)
            continue
        if field == "q":
            current["q"] += " " + line
        elif field:
            current["opts"][field] += " " + line

    out = []
    for n in sorted(questions):
        q = questions[n]
        opts = []
        for key in sorted(q["opts"]):
            opts += [_squash(p).rstrip(".").strip() for p in INLINE_OPTION_RE.split(q["opts"][key])]
        out.append({"n": n, "q": _squash(q["q"]), "opts": opts})
    return out


def parse_answer_key(text):
    text = text.replace(" ", " ")
    if "Retteark" in text:
        text = text.split("Retteark", 1)[1]
    answers = {}
    for m in re.finditer(r"(?m)^\s*(\d{1,2})\s*\n\s*([ABC])\b([^\n]*)", text):
        answers[int(m.group(1))] = (m.group(2), m.group(3).strip(" –-"))
    return answers


def parse_dir(pdf_dir):
    entries, problems = [], []
    for path in sorted(glob.glob(os.path.join(pdf_dir, "medborgerskabsproeven-20??-??.pdf"))):
        exam = os.path.basename(path)[len("medborgerskabsproeven-"):-len(".pdf")]
        questions = parse_exam_text(extract_pdf_text(path))
        key = parse_answer_key(extract_pdf_text(path[:-4] + "-retteark.pdf"))
        if len(questions) != 25 or len(key) != 25:
            problems.append(f"{exam}: {len(questions)} questions, {len(key)} answers")
            continue
        for q in questions:
            letter, note = key[q["n"]]
            a = "ABC".index(letter)
            if not (2 <= len(q["opts"]) <= 3) or a >= len(q["opts"]) or not q["q"]:
                problems.append(f"{exam} #{q['n']}: {q}")
                continue
            entries.append({"exam": exam, "n": q["n"], "q": q["q"], "opts": q["opts"], "a": a, "note": note})
    return entries, problems


def main(argv):
    pdf_dir, out = argv[1], argv[2]
    entries, problems = parse_dir(pdf_dir)
    if problems:
        print("Parse problems:", *problems, sep="\n  ")
        return 1
    with open(out, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=1)
    print(f"{len(entries)} questions from {len({e['exam'] for e in entries})} exams -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
