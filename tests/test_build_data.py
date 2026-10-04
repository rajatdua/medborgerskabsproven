import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "build"))

from build_data import build, item_id  # noqa: E402

CARDS_TXT = open(os.path.join(ROOT, "medborgerskabsproeven.txt"), encoding="utf-8").read()
EXAMS = json.load(open(os.path.join(ROOT, "content", "exams.json"), encoding="utf-8"))

DRONNING_W = "Fra før 2024 – i dag er det Kongen (Frederik 10.), der fx holder nytårstalen."
REGERING_W = "Aktuelt spørgsmål – svaret afhænger af regeringen på prøvetidspunktet."


def ex(exam, n, q, opts, a=0, note=""):
    return {"exam": exam, "n": n, "q": q, "opts": opts, "a": a, "note": note}


SMALL_CARDS = "#separator:tab\nHvad er 1+1?\tTo.\tFA01_Skole\n"


class BuildData(unittest.TestCase):
    def test_dedupe_keeps_newest_wording(self):
        data = build(
            [
                ex("2018-06", 1, "Hvad er værnepligt ?", ["Ja", "Nej"]),
                ex("2022-06", 2, "Hvad er værnepligt?", ["Ja", "Nej"]),
            ],
            SMALL_CARDS,
            {},
        )
        [item] = data["exam"]
        self.assertEqual(item["e"], ["2018-06", "2022-06"])
        self.assertEqual(item["q"], "Hvad er værnepligt?")

    def test_frequency_by_question_text(self):
        data = build(
            [
                ex("2023-05", 1, "Hvilken by har flest indbyggere?", ["Esbjerg", "Thisted"]),
                ex("2024-11", 1, "Hvilken by har flest indbyggere?", ["Odense", "Aarhus"], 1),
            ],
            SMALL_CARDS,
            {},
        )
        self.assertEqual(len(data["exam"]), 2)
        self.assertEqual([x["f"] for x in data["exam"]], [2, 2])

    def test_dronning_flag(self):
        q = "Hvem holder sin nytårstale den 31. december?"
        old = build([ex("2022-11", 1, q, ["Dronningen", "Statsministeren"])], SMALL_CARDS, {})
        self.assertEqual(old["exam"][0]["w"], DRONNING_W)
        new = build([ex("2024-05", 1, "Hvem er dronning?", ["Dronningen", "Ingen"])], SMALL_CARDS, {})
        self.assertNotIn("w", new["exam"][0])

    def test_regering_flag(self):
        data = build(
            [ex("2025-05", 3, "Er Det Konservative Folkeparti med i den nuværende regering?", ["Ja", "Nej"], 1)],
            SMALL_CARDS,
            {},
        )
        self.assertEqual(data["exam"][0]["w"], REGERING_W)

    def test_note_kept(self):
        data = build([ex("2024-11", 3, "Hvor gammel?", ["Mindst 18 år", "Mindst 20 år"], 0, "Mindst 18 år")], SMALL_CARDS, {})
        self.assertEqual(data["exam"][0]["n"], "Mindst 18 år")

    def test_ids_stable_when_new_exam_added(self):
        a = build(EXAMS, CARDS_TXT, {})
        extra = [ex("2026-11", n, f"Nyt spørgsmål {n}?", ["Ja", "Nej"]) for n in range(1, 26)]
        b = build(EXAMS + extra, CARDS_TXT, {})
        b_by_id = {x["id"]: x for x in b["exam"]}
        for x in a["exam"]:
            self.assertEqual(b_by_id[x["id"]]["q"], x["q"])
        self.assertEqual({c["id"] for c in a["cards"]}, {c["id"] for c in b["cards"]})

    def test_id_format(self):
        self.assertRegex(item_id("e", "Hvad?", "Ja", "Nej"), r"^e[0-9a-f]{10}$")
        self.assertEqual(item_id("c", "Hvad er DK?"), item_id("c", "hvad er dk"))

    def test_papers_complete(self):
        data = build(EXAMS, CARDS_TXT, {})
        ids = {x["id"] for x in data["exam"]}
        self.assertEqual(len(data["papers"]), 20)
        for paper in data["papers"].values():
            self.assertEqual(len(paper), 25)
            self.assertTrue(set(paper) <= ids)

    def test_cards_and_topics(self):
        data = build(EXAMS, CARDS_TXT, {})
        self.assertEqual(len(data["cards"]), 526)
        self.assertEqual(len(data["topics"]), 26)
        self.assertIn({"t": "FA13_Folketing_og_regering", "da": "Folketing og regering"}, data["topics"])
        self.assertEqual(set(data["cards"][0]), {"id", "q", "a", "t"})

    def test_en_only_keeps_needed_strings(self):
        data = build([ex("2024-05", 1, "Hvad?", ["Ja", "Nej"])], SMALL_CARDS, {"Ja": "Yes", "Ubrugt": "Unused"})
        self.assertEqual(data["en"], {"Ja": "Yes"})


if __name__ == "__main__":
    unittest.main()
