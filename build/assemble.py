"""Inline app/ sources and content/data.json into dist/index.html.

Usage: python build/assemble.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app")
SCRIPTS = ["srs", "rewards", "merge", "engine", "i18n", "store", "fx", "ui", "main"]
OUT = os.path.join(ROOT, "dist", "index.html")


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as f:
        return f.read()


def safe_json(data):
    # "<" escaped so the payload can never close its <script> tag.
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")


def main():
    template = read(APP, "template.html")
    data = json.loads(read(ROOT, "content", "data.json"))
    scripts = []
    for name in SCRIPTS:
        src = read(APP, "src", f"{name}.js")
        if "</script" in src.lower():
            sys.exit(f"{name}.js contains </script")
        scripts.append(f"<script>\n{src}</script>")
    html = (
        template.replace("/*STYLES*/", read(APP, "styles.css"))
        .replace("<!--DATA-->", safe_json(data))
        .replace("<!--SCRIPTS-->", "\n".join(scripts))
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"{OUT}: {len(html.encode('utf-8')) // 1024} KB")


if __name__ == "__main__":
    main()
