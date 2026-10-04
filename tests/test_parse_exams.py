import json
import os
import sys
import unittest
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "build"))

from parse_exams import parse_answer_key, parse_exam_text  # noqa: E402

EXAMS_JSON = os.path.join(ROOT, "content", "exams.json")


class ParseExamText(unittest.TestCase):
    def test_basic_question(self):
        text = "1. Hvor mange medlemmer har Folketinget? \n☐ A: 87 \n☐ B: 179 \n☐ C: 265"
        self.assertEqual(
            parse_exam_text(text),
            [{"n": 1, "q": "Hvor mange medlemmer har Folketinget?", "opts": ["87", "179", "265"]}],
        )

    def test_number_on_own_line(self):
        text = (
            "1. Første? \nA: Ja \nB: Nej \n"
            "8. \nHvad er en kollektiv overenskomst? \n"
            "A: En aftale mellem fagforeninger og arbejdsgivere \n"
            "B: En aftale mellem staten og kommunerne"
        )
        q = parse_exam_text(text)[1]
        self.assertEqual(q["n"], 8)
        self.assertEqual(q["q"], "Hvad er en kollektiv overenskomst?")
        self.assertEqual(len(q["opts"]), 2)

    def test_out_of_order_numbers(self):
        text = "\n".join(
            f"{n}. Spørgsmål {n}? \nA: Ja \nB: Nej" for n in (1, 3, 4, 2)
        )
        qs = parse_exam_text(text)
        self.assertEqual([q["n"] for q in qs], [1, 2, 3, 4])
        self.assertEqual(qs[1]["q"], "Spørgsmål 2?")

    def test_merged_options_line(self):
        text = "1. Hvor gammel skal man være for at blive gift? \nA: Mindst 18 år B: Mindst 20 år"
        [q] = parse_exam_text(text)
        self.assertEqual(q["opts"], ["Mindst 18 år", "Mindst 20 år"])

    def test_skips_page_headers(self):
        text = (
            "1. Hvad hedder Danmarks hovedstad? \nA: Odense \n"
            "Medborgerskabsprøven – 3. juni 2026, kl. 11:00-11:30 \n4 \n"
            "B: København"
        )
        [q] = parse_exam_text(text)
        self.assertEqual(q["opts"], ["Odense", "København"])

    def test_ignores_numbered_lines_before_question_one(self):
        text = (
            "Medborgerskabsprøven \n3. juni 2026, kl. 11:00-11:30 \nVejledning \n"
            "1. Hvor går de fleste børn i skole? \nA: Kommunale folkeskoler \nB: Private grundskoler \n"
            "3. Hvilket område har kommunerne ansvaret for? \nA: Sygehuse \nB: Børnehaver"
        )
        qs = parse_exam_text(text)
        self.assertEqual([q["n"] for q in qs], [1, 3])
        self.assertEqual(qs[1]["q"], "Hvilket område har kommunerne ansvaret for?")

    def test_continuation_lines_join(self):
        text = "1. Hvad er en lang \nquestion? \nA: Første del \naf svaret \nB: Nej"
        [q] = parse_exam_text(text)
        self.assertEqual(q["q"], "Hvad er en lang question?")
        self.assertEqual(q["opts"][0], "Første del af svaret")


class ParseAnswerKey(unittest.TestCase):
    def test_answer_key_with_note(self):
        text = "Medborgerskabsprøven den 27. november 2024 \nRetteark \n1 \nA \n3 \n B – Mindst 18 år"
        self.assertEqual(parse_answer_key(text), {1: ("A", ""), 3: ("B", "Mindst 18 år")})


@unittest.skipUnless(os.path.exists(EXAMS_JSON), "content/exams.json not generated")
class FullCorpus(unittest.TestCase):
    def test_full_corpus(self):
        data = json.load(open(EXAMS_JSON, encoding="utf-8"))
        counts = Counter(x["exam"] for x in data)
        self.assertEqual(len(counts), 20)
        self.assertTrue(all(c == 25 for c in counts.values()), counts)
        for x in data:
            self.assertIn(len(x["opts"]), (2, 3), x)
            self.assertLess(x["a"], len(x["opts"]), x)
            self.assertTrue(x["q"] and all(x["opts"]), x)


if __name__ == "__main__":
    unittest.main()
