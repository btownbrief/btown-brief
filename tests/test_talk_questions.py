"""Talk's news questions (Stephen, 2026-10-30): one question per story, three
times a day, on the wire-data branch. Offline; the model is a fake.

Run: python3 -m unittest tests.test_talk_questions
"""

import argparse
import json
import os
import re
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import talk_questions as tq  # noqa: E402
import wire_common as wc  # noqa: E402

# 12:30 pm in Burlington on October 16, 2026
NOON = datetime(2026, 10, 16, 16, 30, tzinfo=timezone.utc)
TODAY = "2026-10-16"
USAGE = {"in": 900, "out": 300, "cache_read": 0, "cache_write": 0, "calls": 1}
ENGINE = {"provider": "anthropic", "model": "claude-opus-5-5"}


def item(n, title=None, **extra):
    return {"id": f"i{n}", "ch": "local", "local": True, "src": "s", "name": "Seven Days",
            "title": title or f"Town hall story number {n}",
            "url": f"https://x.example/{n}", "posted_at": NOON.isoformat(), **extra}


def paper(picks=None, sports=None, date=TODAY):
    picks = [item(n, rank=n) for n in range(1, 16)] if picks is None else picks
    return {"date": date, "picks": picks, "updates": [],
            "sources": {}, "sports": {"local": sports or []}}


def fake_model(system, user, schema, **kwargs):
    numbers = [int(line.split(".")[0]) for line in user.splitlines()]
    return {"questions": [{"i": i, "q": f"What would you change about place {i}?"} for i in numbers]}


def ask(engine, system, user, schema, max_tokens, log_prefix):
    return fake_model(system, user, schema), dict(USAGE)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = self.tmp.name
        self.path = os.path.join(self.dir, "talk-today.json")
        env = {k: v for k, v in os.environ.items() if k != "GITHUB_STEP_SUMMARY"}
        env["ANTHROPIC_API_KEY"] = "test"
        patcher = mock.patch.dict(os.environ, env, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def write(self, name, value):
        wc.write_json(os.path.join(self.dir, name), value)

    def run_at(self, moment=NOON, force=False, model=ask, prompt="the prompt"):
        args = argparse.Namespace(data_dir=self.dir, as_of=moment.isoformat(), force=force)
        with mock.patch.object(wc, "read_prompt", side_effect=lambda name: prompt(name) if callable(prompt) else prompt), \
                mock.patch.object(wc, "ask_json", side_effect=model) as called:
            self.assertEqual(tq.run(args), 0)
        return called.call_count

    def read(self):
        return wc.load_json(self.path, None)


class Guard(unittest.TestCase):
    """The port stays the page's guard."""

    def source(self, rel):
        with open(os.path.join(HERE, "..", rel), encoding="utf-8") as src:
            return src.read()

    def test_the_patterns_are_the_pages(self):
        lib = self.source("all-day/js/reddit-lib.js")
        core = self.source("all-day/js/talk-core.js")
        for name, text in (("HEAVY", core), ("BARE_NAME", core), ("PUBLIC", lib), ("NAMED", lib),
                           ("INITIAL", lib), ("ROLE", lib), ("CRIME", lib), ("MINOR", lib),
                           ("CONTACT", lib)):
            pattern = re.search(rf"^const {name} = /(.*)/[gi]*;$", text, re.M).group(1)
            self.assertEqual(getattr(tq, name).pattern, pattern, name)
        for name in ("FIRST", "NOT_SURNAME"):
            words = re.search(rf"^const {name} = new Set\(\('([^']*)'\)", lib, re.M).group(1)
            self.assertEqual(getattr(tq, name), set(words.split()), name)
        for name, value in (("MAX_TITLE", tq.MAX_TITLE),):
            self.assertIn(f"const {name} = {value};", core)

    def test_the_dinner_guard(self):
        for title in ("Jennifer Whitlock opens up about her neighbor", "Man dies in Route 7 crash",
                      "Barn fires spread", "Maria Lopez", "Sato Kenji is back",
                      "Town pays tribute to a beloved teacher"):
            self.assertFalse(tq.fit(title), title)
        self.assertFalse(tq.fit("Fine story", "public-safety"))
        self.assertTrue(tq.fit("Church Street keeps outdoor dining"))
        self.assertTrue(tq.fit("Phil Scott signs the housing bill"))

    def test_stories_are_the_ones_the_page_would_deal(self):
        day = paper(picks=[
            item(1, "Church Street keeps outdoor dining", rank=2),
            item(2, "Man dies in Route 7 crash", rank=1),
            item(3, "Remembering a neighbor", rank=3, url="https://x.example/obituaries/a"),
            item(4, "A post from a Facebook group", rank=4, ch="facebook"),
            item(5, "Our own newsletter", rank=5, own=True),
            item(6, "Catamounts win in overtime", rank=6, topic="sports"),
        ], sports=[item(7, "Catamounts open the season at home")])
        head, sports = tq.stories(day)
        self.assertEqual([one["id"] for one in head], ["i1"])
        self.assertEqual([one["id"] for one in sports], ["i7"])
        self.assertTrue(sports[0]["local"])


class Questions(unittest.TestCase):
    TITLE = "Burlington raises downtown parking meter rates"

    def test_the_good_ones_pass(self):
        for q in ("What is the longest line you have waited in for lunch?",
                  "Who in your life would you trust with your house keys?",
                  "How far would you drive for a better grocery store?",
                  "If rent doubled tomorrow, where would you go?"):
            self.assertEqual(tq.good_question(q, self.TITLE), q)

    def test_what_stephen_disliked_does_not(self):
        for q in ("Should parking cost more downtown?",                       # yes or no
                  "Would you pay more for parking?",
                  "If bike lanes replaced your street parking, would you be okay with it?",
                  "Why did Burlington raise downtown parking meter rates?",   # the headline again
                  "What will the new downtown parking meter rates be?",
                  "What do you think about all of the things that happened downtown this week now?",
                  "What is it? Who knows?",
                  "A statement, not a question.",
                  "What would Jennifer Whitlock say about it?",               # a private person
                  "Who do you know that has been arrested?"):                 # the guard
            self.assertIsNone(tq.good_question(q, self.TITLE), q)

    def test_an_answer_maps_back_by_index_only(self):
        asks = [dict(id="a", title="One"), dict(id="b", title="Two")]
        out = tq.take_answer({"questions": [
            {"i": 0, "q": "What would you do differently next time?"},
            {"i": 0, "q": "What else would you change about it?"},
            {"i": 9, "q": "What would you do with an extra hour?"},
            {"i": True, "q": "What would you do with an extra day?"},
            {"i": 1, "q": "Should we?"},
        ]}, asks)
        self.assertEqual(out, {"a": "What would you do differently next time?"})
        self.assertEqual(tq.take_answer({"nope": 1}, asks), {})


class Runs(Base):
    def test_a_run_writes_about_twelve_pairs_and_logs_its_cost(self):
        self.write("wire-today.json", paper(sports=[item(n, f"Catamounts game {n}") for n in range(30, 36)]))
        self.assertEqual(self.run_at(), 1)
        out = self.read()
        self.assertEqual((out["date"], out["slot"]), (TODAY, "midday"))
        self.assertEqual(len(out["items"]), 12)
        self.assertEqual(sum(one["b"] == "sports" for one in out["items"]), 3)
        first = out["items"][0]
        self.assertEqual(first["title"], "Town hall story number 1")
        self.assertTrue(first["q"].endswith("?"))
        self.assertEqual(set(first), {"id", "b", "title", "name", "src", "url", "local", "posted_at", "q"})
        ledger = wc.load_json(os.path.join(self.dir, "wire-cost.json"), {})
        self.assertEqual(ledger["runs"][-1]["script"], "talk_questions")
        self.assertLess(ledger["runs"][-1]["usd"], 0.03)

    def test_three_times_a_day_not_every_hour(self):
        self.write("wire-today.json", paper())
        hour = lambda h, m=7: datetime(2026, 10, 16, h + 4, m, tzinfo=timezone.utc)  # ET is UTC-4
        calls = [self.run_at(hour(h, m)) for h, m in
                 ((5, 7), (7, 7), (7, 27), (8, 7), (11, 47), (12, 7), (12, 47), (17, 7), (18, 7), (18, 27), (19, 47))]
        self.assertEqual(calls, [0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0])

    def test_a_story_keeps_its_question_and_is_not_paid_for_twice(self):
        self.write("wire-today.json", paper())
        self.run_at(datetime(2026, 10, 16, 11, 30, tzinfo=timezone.utc))
        first = {one["id"]: one["q"] for one in self.read()["items"]}
        self.write("wire-today.json", paper(picks=[item(99, "A brand new farmers market", rank=1)]
                                            + [item(n, rank=n) for n in range(1, 16)]))
        seen = []

        def spy(engine, system, user, schema, max_tokens, log_prefix):
            seen.append(user)
            return ask(engine, system, user, schema, max_tokens, log_prefix)

        self.assertEqual(self.run_at(model=spy), 1)
        self.assertEqual(len(seen[0].splitlines()), 4, "i99, and the three the last run did not keep")
        out = {one["id"]: one["q"] for one in self.read()["items"]}
        self.assertIn("i99", out)
        self.assertTrue(all(first[key] == out[key] for key in out if key in first))

    def test_a_failure_carries_the_last_file_and_waits(self):
        self.write("wire-today.json", paper())
        self.run_at(datetime(2026, 10, 16, 11, 30, tzinfo=timezone.utc))
        before = self.read()

        def broken(*args, **kwargs):
            error = wc.ModelError("down")
            error.usage = dict(USAGE)
            raise error

        self.assertEqual(self.run_at(model=broken), 1)
        after = self.read()
        self.assertEqual(after["items"], before["items"])
        self.assertEqual(after["slot"], "morning")
        self.assertEqual(self.run_at(model=broken), 0, "it waits before trying again")
        self.assertEqual(self.run_at(datetime(2026, 10, 16, 17, 30, tzinfo=timezone.utc)), 1)
        self.assertEqual(self.read()["slot"], "midday")

    def test_answers_that_all_fail_keep_the_last_file(self):
        self.write("wire-today.json", paper())
        self.run_at(datetime(2026, 10, 16, 11, 30, tzinfo=timezone.utc))
        before = self.read()["items"]
        self.write("wire-today.json", paper(picks=[item(n, rank=n) for n in range(50, 60)]))
        useless = lambda *a, **k: ({"questions": [{"i": 0, "q": "Should it?"}]}, dict(USAGE))
        self.run_at(model=useless)
        self.assertEqual(self.read()["items"], before)

    def test_a_thin_paper_waits_and_keeps_last_nights_file(self):
        self.write("talk-today.json", {"v": 1, "date": "2026-10-15", "slot": "evening", "items": [{"id": "old", "q": "What?"}]})
        self.write("wire-today.json", paper(picks=[item(n, rank=n) for n in range(1, 4)]))
        self.assertEqual(self.run_at(), 0)
        self.assertEqual(self.read()["slot"], "evening")

    def test_no_key_no_paper_or_the_cap_call_nothing(self):
        self.assertEqual(self.run_at(), 0, "no paper")
        self.write("wire-today.json", paper(date="2026-10-15"))
        self.assertEqual(self.run_at(), 0, "yesterday's paper")
        self.write("wire-today.json", paper())
        self.write("wire-cost.json", {"v": 1, "month": "2026-10", "usd": wc.MONTH_CAP_USD, "runs": []})
        self.assertEqual(self.run_at(), 0, "the month cap")
        os.remove(os.path.join(self.dir, "wire-cost.json"))
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "", "OPENROUTER_API_KEY": ""}):
            self.assertEqual(self.run_at(), 0, "no key")
        self.assertFalse(os.path.exists(self.path))

    def test_a_missing_prompt_keeps_the_last_file(self):
        self.write("wire-today.json", paper())
        self.run_at(datetime(2026, 10, 16, 11, 30, tzinfo=timezone.utc))
        before = self.read()["items"]

        def missing(name):
            raise RuntimeError("no prompt")

        self.assertEqual(self.run_at(prompt=missing), 0)
        self.assertEqual(self.read()["items"], before)

    def test_the_schema_is_plain_json(self):
        self.assertEqual(json.loads(json.dumps(tq.SCHEMA)), tq.SCHEMA)


if __name__ == "__main__":
    unittest.main()
