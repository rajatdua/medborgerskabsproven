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


SRC_DIR = os.path.join(ROOT, "content", "translations", "src")


def merge_src():
    """Zip src/NN.da.json with src/NN.en.json into translations/NN.json."""
    from build_data import unquote_field

    for da_path in sorted(glob.glob(os.path.join(SRC_DIR, "*.da.json"))):
        en_path = da_path.replace(".da.json", ".en.json")
        with open(da_path, encoding="utf-8") as f:
            da = json.load(f)
        with open(en_path, encoding="utf-8") as f:
            en = json.load(f)
        if len(da) != len(en):
            raise SystemExit(f"{os.path.basename(en_path)}: {len(en)} entries, expected {len(da)}")
        out = os.path.join(os.path.dirname(SRC_DIR), os.path.basename(da_path).replace(".da", ""))
        with open(out, "w", encoding="utf-8") as f:
            json.dump({unquote_field(d): e for d, e in zip(da, en)}, f, ensure_ascii=False, indent=0)


def main(argv):
    from build_data import load_sources, build

    if "--merge-src" in argv:
        merge_src()

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
