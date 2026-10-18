"""build_edition_audio.py on a trimmed copy of the real newsletter feed
(Friday Oct 16, Monday Oct 12 and Wednesday Oct 7, 2026, with each edition's
events calendar cut off). The voice and ffmpeg are always stubs; nothing
touches the network.

Run: python3 -m unittest tests.test_edition_audio
"""

import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import build_edition_audio as ea  # noqa: E402

FEED = os.path.join(HERE, "fixtures", "edition-audio", "feed.xml")
NOW = datetime(2026, 10, 16, 16, 0, tzinfo=timezone.utc)   # Friday noon in Burlington
FRIDAY = "https://www.btownbrief.com/p/friday-october-16th"


def eds():
    with open(FEED, encoding="utf-8") as src:
        return ea.editions(src.read())


def args(out_dir, **kw):
    base = {"out_dir": out_dir, "feed_file": FEED, "edition": None, "force": False, "dry_run": False, "sample": None}
    base.update(kw)
    return SimpleNamespace(**base)


class Script(unittest.TestCase):
    def setUp(self):
        self.eds = {e["url"]: e for e in eds()}
        self.fri, stats = ea.script_of(self.eds[FRIDAY])
        self.stats = stats

    def test_feed_newest_first_with_burlington_dates(self):
        got = [(e["date"], e["title"]) for e in eds()]
        self.assertEqual(got, [("2026-10-16", "Friday, October 16th"), ("2026-10-12", "Monday, October 12th"),
                               ("2026-10-07", "Wednesday, October 7th")])

    def test_intro_is_read_word_for_word(self):
        self.assertTrue(self.fri.startswith("This is the Btown Brief for Friday, October 16th.\n\nFind the warm coat, because this weekend"))
        self.assertIn("[pause] Friday.\n\nChamplain Valley Craft Show & Antique Expo – Fri through Sun from 10:", self.fri)
        self.assertIn("[pause] Saturday.", self.fri)
        self.assertIn("[pause] Sunday.", self.fri)
        self.assertIn("\n\nAlso Friday, DBVI and VABVI lead a quarter mile White Cane Awareness Day walk", self.fri)
        self.assertTrue(self.stats["intro"])

    def test_news_is_read_word_for_word(self):
        self.assertEqual(self.stats["stories"], 11)
        self.assertEqual(self.stats["quick"], 5)
        self.assertIn("[long pause] Now, the local news.\n\n[pause] New plans could bring Burlington’s Nectar’s back to life.\n\n"
                      "\"It’s very exciting news.", self.fri)
        self.assertIn("for a while,\" per WCAX.\n\nThe Main Street club has been closed since last year", self.fri)
        self.assertIn("[pause] Quick hits.\n\nOffer extended to finalist in Burlington police chief search — Burlington has made an offer", self.fri)
        self.assertTrue(self.fri.rstrip().endswith(ea.SIGN_OFF))
        # every word of the edition's own is in order: the news follows the intro
        self.assertLess(self.fri.index("Fright by Flashlight"), self.fri.index("Now, the local news."))

    def test_nothing_else_is_read(self):
        for gone in ("Scroll down to Events Section", "best viewing experience", "Gang’s all here",   # the pointer, the banner, a photo caption
                     "Join the Meetup", "Every game, every app", "Why support?",                          # IRL, the projects plug, the support block
                     "News Quiz", "Upcoming Home Games", "Men's hockey hosts",                          # the quiz and sports
                     "8:00 AM: Women Rising Summit", "Table of Contents", "[MEETUP]"):                  # the calendar, the contents, a bracket
            self.assertNotIn(gone, self.fri, gone)
        self.assertIn("BTown Coffee Club – 10 AM:", self.fri)   # "[MEETUP]" dropped, the rest kept
        self.assertNotIn("AI", self.fri.split())

    def test_the_only_brackets_are_the_voice_marks(self):
        import re
        self.assertEqual(set(re.findall(r"\[[^\]]*\]", self.fri)), {"[pause]", "[long pause]"})

    def test_monday_reads_too(self):
        script, stats = ea.script_of(self.eds["https://www.btownbrief.com/p/monday-october-12th"])
        self.assertTrue(script and stats["intro"] and stats["stories"] >= 10)
        self.assertIn("This is the Btown Brief for Monday, October 12th.", script)

    def test_wednesday_has_nothing_to_read(self):
        script, why = ea.script_of(self.eds["https://www.btownbrief.com/p/wednesday-october-7th"])
        self.assertIsNone(script)
        self.assertIn("no Local News", why)

    def test_voice_copy_respells_and_says_and(self):
        v = ea.for_voice(self.fri)
        self.assertIn("sham-PLANE Valley Craft Show and Antique Expo", v)
        self.assertNotIn("Champlain", v)
        self.assertIn("Champlain Valley", self.fri)   # the published script keeps the real spelling

    def test_chunks_are_paragraph_aligned_and_lose_nothing(self):
        v = ea.for_voice(self.fri)
        parts = ea.chunks(v)
        self.assertTrue(len(parts) >= 4 and all(len(p) <= ea.CHUNK_CHARS for p in parts))
        self.assertEqual("\n\n".join(parts), v.strip())
        long = "One sentence here. " * 400
        self.assertTrue(all(len(p) <= ea.CHUNK_CHARS for p in ea.chunks(long)))
        self.assertEqual(" ".join(ea.chunks(long)).split(), long.split())

    def test_size_is_inside_the_guards(self):
        self.assertTrue(ea.MIN_EDITION_CHARS < self.stats["chars"] < ea.MAX_EDITION_CHARS, self.stats["chars"])


class Run(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = self.tmp.name
        self.calls = []
        env = {"ELEVENLABS_API_KEY": "test-key", "ELEVENLABS_VOICE_ID": ""}
        self.patches = [mock.patch.dict(os.environ, env), mock.patch.object(ea, "load_secrets", lambda: None),
                        mock.patch.object(ea, "tts", side_effect=self.fake_tts),
                        mock.patch.object(ea, "join_and_normalize", side_effect=lambda parts, title: (b"".join(parts), 1234.5))]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def fake_tts(self, key, voice, text):
        self.calls.append(text)
        return b"MP3"

    def index(self):
        with open(os.path.join(self.out, "index.json"), encoding="utf-8") as src:
            return json.load(src)

    def test_voices_the_newest_edition_and_publishes_it(self):
        self.assertEqual(ea.run(args(self.out), now=NOW), 0)
        idx = self.index()
        self.assertEqual(idx["v"], 2)
        clip = idx["clips"][0]
        self.assertEqual((clip["kind"], clip["date"], clip["file"], clip["script"], clip["url"], clip["title"]),
                         ("edition", "2026-10-16", "2026-10-16.mp3", "2026-10-16.txt", FRIDAY, "Friday, October 16th"))
        self.assertEqual((clip["duration"], clip["stories"], clip["model"], clip["voice"]), (1234.5, 11, "eleven_v4", ea.DEFAULT_VOICE))
        self.assertEqual(clip["chars"], sum(len(c) for c in self.calls))
        self.assertTrue(all(len(c) <= ea.CHUNK_CHARS for c in self.calls) and len(self.calls) >= 4)
        with open(os.path.join(self.out, "2026-10-16.txt"), encoding="utf-8") as src:
            self.assertTrue(src.read().startswith("This is the Btown Brief for Friday"))
        with open(os.path.join(self.out, "cost.json"), encoding="utf-8") as src:
            cost = json.load(src)
        self.assertEqual(cost["tts_chars"], clip["chars"])
        self.assertAlmostEqual(cost["tts_usd"], clip["chars"] / 1000 * 0.08, places=3)

    def test_second_run_voices_nothing(self):
        ea.run(args(self.out), now=NOW)
        n = len(self.calls)
        self.assertEqual(ea.run(args(self.out), now=NOW), 0)
        self.assertEqual(len(self.calls), n)

    def test_a_wednesday_on_top_is_skipped_and_never_voiced(self):
        later = datetime(2026, 10, 17, 16, 0, tzinfo=timezone.utc)
        with open(FEED, encoding="utf-8") as src:
            feed = src.read().replace("Wed, 07 Oct 2026 22:20:02 +0000", "Sat, 17 Oct 2026 12:00:00 +0000")
        path = os.path.join(self.out, "feed.xml")
        with open(path, "w", encoding="utf-8") as dst:
            dst.write(feed)
        self.assertEqual(ea.run(args(self.out, feed_file=path), now=later), 0)
        self.assertEqual(self.index()["clips"][0]["date"], "2026-10-16")   # the Friday under it

    def test_too_old_is_left_alone(self):
        self.assertEqual(ea.run(args(self.out), now=datetime(2026, 10, 25, 16, 0, tzinfo=timezone.utc)), 0)
        self.assertFalse(self.calls)
        self.assertFalse(os.path.exists(os.path.join(self.out, "index.json")))

    def test_a_named_edition_and_force(self):
        ea.run(args(self.out, edition="https://www.btownbrief.com/p/monday-october-12th"), now=NOW)
        self.assertEqual([c["date"] for c in self.index()["clips"]], ["2026-10-12"])
        n = len(self.calls)
        ea.run(args(self.out, edition="https://www.btownbrief.com/p/monday-october-12th"), now=NOW)
        self.assertEqual(len(self.calls), n)
        ea.run(args(self.out, edition="https://www.btownbrief.com/p/monday-october-12th", force=True), now=NOW)
        self.assertGreater(len(self.calls), n)

    def test_the_old_recap_is_pruned(self):
        os.makedirs(self.out, exist_ok=True)
        for name in ("2026-10-15.mp3", "2026-10-15.txt", "2026-10-16.mp3", "pending.json"):
            with open(os.path.join(self.out, name), "w") as f:
                f.write("x")
        with open(os.path.join(self.out, "index.json"), "w") as f:
            json.dump({"v": 1, "clips": [{"date": "2026-10-15", "file": "2026-10-15.mp3", "script": "2026-10-15.txt", "edition": "2026-10-14"}]}, f)
        ea.run(args(self.out), now=NOW)
        self.assertEqual(sorted(os.listdir(self.out)), ["2026-10-16.mp3", "2026-10-16.txt", "cost.json", "index.json"])
        self.assertEqual([c["date"] for c in self.index()["clips"]], ["2026-10-16"])

    def test_the_month_cap_stops_it(self):
        with open(os.path.join(self.out, "cost.json"), "w") as f:
            json.dump({"month": "2026-10", "tts_chars": 300000, "tts_usd": 24.0, "runs": []}, f)
        self.assertEqual(ea.run(args(self.out), now=NOW), 0)
        self.assertFalse(self.calls)

    def test_no_key_no_clip(self):
        with mock.patch.dict(os.environ, {"ELEVENLABS_API_KEY": ""}):
            self.assertEqual(ea.run(args(self.out), now=NOW), 0)
        self.assertFalse(self.calls)

    def test_a_voice_failure_publishes_nothing_records_the_spend_and_fails_loud(self):
        def flaky(key, voice, text):
            self.calls.append(text)
            if len(self.calls) == 2:
                raise OSError("boom")
            return b"MP3"
        with mock.patch.object(ea, "tts", side_effect=flaky):
            self.assertEqual(ea.run(args(self.out), now=NOW), 1)
        self.assertFalse(os.path.exists(os.path.join(self.out, "index.json")))
        with open(os.path.join(self.out, "cost.json"), encoding="utf-8") as src:
            self.assertEqual(json.load(src)["tts_chars"], len(self.calls[0]))

    def test_a_cut_gone_wrong_is_refused(self):
        with mock.patch.object(ea, "MAX_EDITION_CHARS", 5000):
            self.assertEqual(ea.run(args(self.out), now=NOW), 1)
        self.assertFalse(self.calls)


if __name__ == "__main__":
    unittest.main()
