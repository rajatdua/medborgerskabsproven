"""Content strings that need an English translation.

Usage: python build/strings.py --missing   (prints untranslated strings as JSON)
"""
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRANSLATIONS_GLOB = os.path.join(ROOT, "content", "translations", "*.json")


def needed_strings(data):
    out = set()
    for x in data["exam"]:
        out.add(x["q"])
        out.update(x["o"])
        for key in ("w", "n"):
            if key in x:
                out.add(x[key])
    for c in data["cards"]:
        out.add(c["q"])
        out.add(c["a"])
    for t in data["topics"]:
        out.add(t["da"])
    return out


def load_translations():
    en = {}
    for path in sorted(glob.glob(TRANSLATIONS_GLOB)):
        with open(path, encoding="utf-8") as f:
            en.update(json.load(f))
    return en


def main(argv):
    from build_data import load_sources, build

    exams, cards_txt = load_sources()
    en = load_translations()
    data = build(exams, cards_txt, en)
    missing = sorted(needed_strings(data) - set(en))
    if "--missing" in argv:
        json.dump(missing, sys.stdout, ensure_ascii=False, indent=0)
        print()
    else:
        print(f"{len(missing)} missing of {len(needed_strings(data))}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
