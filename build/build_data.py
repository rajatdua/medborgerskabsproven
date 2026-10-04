"""Build content/data.json from parsed exams, Anki cards and translations.

Usage: python build/build_data.py [--allow-missing-en]
"""
import hashlib
import json
import os
import re
import sys
from collections import defaultdict

from strings import load_translations, needed_strings

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXAMS_JSON = os.path.join(ROOT, "content", "exams.json")
CARDS_TXT = os.path.join(ROOT, "medborgerskabsproeven.txt")
DATA_JSON = os.path.join(ROOT, "content", "data.json")

DRONNING_W = "Fra før 2024 – i dag er det Kongen (Frederik 10.), der fx holder nytårstalen."
REGERING_W = "Aktuelt spørgsmål – svaret afhænger af regeringen på prøvetidspunktet."


def norm(s):
    return re.sub(r"[^a-zæøå0-9]", "", s.lower())


def item_id(prefix, *parts):
    key = "|".join(norm(p) for p in parts)
    return prefix + hashlib.sha1(key.encode("utf-8")).hexdigest()[:10]


def _exam_id(q, opts):
    return item_id("e", q, *sorted(opts, key=norm))


def _warning(q, opts, last_exam):
    text = (q + " " + " ".join(opts)).lower()
    if "nuværende regering" in text:
        return REGERING_W
    if "dronning" in text and last_exam < "2024":
        return DRONNING_W
    return None


def unquote_field(field):
    """Undo Anki's CSV quoting: "a ""b"" c" -> a "b" c."""
    if len(field) >= 2 and field[0] == field[-1] == '"':
        return field[1:-1].replace('""', '"')
    return field


def _parse_cards(cards_txt):
    cards = []
    for line in cards_txt.splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        q, a, tag = (unquote_field(f) for f in line.split("\t"))
        cards.append({"id": item_id("c", q), "q": q, "a": a, "t": tag})
    return cards


def _topic_name(tag):
    return tag.split("_", 1)[1].replace("_", " ")


def build(exams, cards_txt, en):
    groups = defaultdict(list)
    for x in exams:
        groups[_exam_id(x["q"], x["opts"])].append(x)

    exams_per_text = defaultdict(set)
    for x in exams:
        exams_per_text[norm(x["q"])].add(x["exam"])

    items = []
    for item_id_, versions in groups.items():
        versions.sort(key=lambda v: v["exam"])
        newest = versions[-1]
        seen_in = sorted({v["exam"] for v in versions})
        item = {
            "id": item_id_,
            "q": newest["q"],
            "o": newest["opts"],
            "a": newest["a"],
            "e": seen_in,
            "f": len(exams_per_text[norm(newest["q"])]),
        }
        warning = _warning(newest["q"], newest["opts"], seen_in[-1])
        if warning:
            item["w"] = warning
        if newest.get("note"):
            item["n"] = newest["note"]
        items.append(item)

    papers = defaultdict(list)
    for x in sorted(exams, key=lambda x: (x["exam"], x["n"])):
        papers[x["exam"]].append(_exam_id(x["q"], x["opts"]))

    cards = _parse_cards(cards_txt)
    tags = sorted({c["t"] for c in cards})
    topics = [{"t": t, "da": _topic_name(t)} for t in tags]

    data = {"exam": items, "papers": dict(papers), "cards": cards, "topics": topics}
    needed = needed_strings(data)
    data["en"] = {k: v for k, v in en.items() if k in needed}
    return data


def load_sources():
    with open(EXAMS_JSON, encoding="utf-8") as f:
        exams = json.load(f)
    with open(CARDS_TXT, encoding="utf-8") as f:
        cards_txt = f.read()
    return exams, cards_txt


def main(argv):
    exams, cards_txt = load_sources()
    data = build(exams, cards_txt, load_translations())
    missing = needed_strings(data) - set(data["en"])
    print(f"{len(data['exam'])} exam items, {len(data['cards'])} cards, {len(missing)} missing translations")
    if missing and "--allow-missing-en" not in argv:
        print("Missing translations:", *sorted(missing)[:20], sep="\n  ")
        return 1
    with open(DATA_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
