"""build_instagram.py: reels keep a playable video, food handles are tagged.

The fixture is a real ScrapeCreators answer for @foambrewers (2026-10-16),
trimmed to the fields the builder reads: a reel, a photo and a carousel.
Nothing here touches the network; the clock is pinned to the fetch.

Run: python3 -m unittest tests.test_build_instagram
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import build_instagram as bi  # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "instagram", "foambrewers-posts.json")


def answer():
    with open(FIXTURE, encoding="utf-8") as src:
        return json.load(src)


class Records(unittest.TestCase):
    def setUp(self):
        doc = answer()
        self.now = doc["fetched_at"]
        self.items = {it["code"]: it for it in doc["items"]}
        self.cutoff = self.now - bi.KEEP_DAYS * 86400

    def test_reel_carries_the_smallest_video_its_expiry_and_length(self):
        it = self.items["DeAW5ciSB3L"]
        rec = bi.post_record("foambrewers", it, self.cutoff, self.now)
        self.assertEqual(rec["v"], 1)
        self.assertTrue(rec["vu"].startswith("https://") and ".mp4" in rec["vu"])
        self.assertEqual(rec["vu"], it["video_versions"][0]["url"])   # three equal copies: the first wins the tie
        self.assertEqual(rec["ve"], bi.signature_expiry(rec["vu"]))
        hours = (rec["ve"] - self.now) / 3600
        self.assertTrue(24 < hours < 48, hours)                      # a video lives about 35 hours, not 4 days
        self.assertEqual(rec["vd"], 10.4)
        self.assertEqual(rec["u"], "https://www.instagram.com/p/DeAW5ciSB3L/")

    def test_reel_poster_is_the_reel_shape_not_the_square_crop(self):
        it = self.items["DeAW5ciSB3L"]
        rec = bi.post_record("foambrewers", it, self.cutoff, self.now)
        chosen = next(c for c in it["image_versions2"]["candidates"] if c["url"] == rec["i"])
        self.assertEqual((chosen["width"], chosen["height"]), (480, 853))

    def test_photo_and_carousel_carry_no_video(self):
        for code in ("Decvek2gbKz", "DefTsFYGSGP"):
            rec = bi.post_record("foambrewers", self.items[code], self.cutoff, self.now)
            self.assertNotIn("vu", rec, code)
            self.assertNotIn("v", rec, code)

    def test_unsized_candidates_are_sized_from_their_url(self):
        """The photo came back with no widths at all; it used to be dropped."""
        it = self.items["Decvek2gbKz"]
        self.assertFalse(any(c.get("width") for c in it["image_versions2"]["candidates"]))
        rec = bi.post_record("foambrewers", it, self.cutoff, self.now)
        self.assertEqual(rec["w"], 480)
        self.assertIn("p480x480", rec["i"])             # the uncropped 480, not the square crop

    def test_smallest_sized_candidate_wins(self):
        item = {"video_versions": [
            {"url": "https://x.test/big.mp4?oe=7AD477AC", "width": 720, "height": 1280},
            {"url": "https://x.test/small.mp4?oe=7AD477AC", "width": 480, "height": 854},
            {"url": "https://x.test/nosize.mp4?oe=7AD477AC"},
            {"url": "javascript:alert(1)", "width": 10, "height": 10},
        ]}
        self.assertEqual(bi.pick_video(item), "https://x.test/small.mp4?oe=7AD477AC")

    def test_unreadable_expiry_leaves_the_video_off(self):
        rec = {"v": 1}
        bi.add_video(rec, {"video_versions": [{"url": "https://x.test/a.mp4"}]}, 0)
        self.assertNotIn("vu", rec)

    def test_a_fresh_video_already_near_its_expiry_is_left_off(self):
        it = self.items["DeAW5ciSB3L"]
        exp = bi.signature_expiry(it["video_versions"][0]["url"])
        rec = bi.post_record("foambrewers", it, self.cutoff, exp - 3600)
        self.assertEqual(rec["v"], 1)
        self.assertNotIn("vu", rec)

    def test_a_video_about_to_lapse_is_dropped_but_the_post_stays(self):
        rec = bi.post_record("foambrewers", self.items["DeAW5ciSB3L"], self.cutoff, self.now)
        self.assertTrue(bi.video_ok(rec, self.now))
        late = rec["ve"] - (bi.CARRY_MARGIN_H * 3600) + 60
        self.assertFalse(bi.video_ok(rec, late))
        kept = bi.drop_video(dict(rec))
        self.assertEqual(kept["i"], rec["i"])
        self.assertNotIn("vu", kept)
        self.assertNotIn("ve", kept)
        self.assertEqual(kept["v"], 1)


class Roster(unittest.TestCase):
    def test_the_food_tag_names_only_rostered_handles(self):
        doc = json.loads(bi.ROSTER.read_text(encoding="utf-8"))
        _, segment = bi.load_roster()
        self.assertTrue(doc.get("food"))
        self.assertEqual(set(doc["food"]) - set(segment), set())
        self.assertIn("foambrewers", bi.load_food(segment))

    def test_a_stray_food_handle_is_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "roster.json"
            p.write_text(json.dumps({"tier1": ["a"], "tier2": [], "see1": ["b"], "see2": [], "food": ["a", "zz"]}))
            with mock.patch.object(bi, "ROSTER", p), mock.patch.object(bi, "log"):
                _, segment = bi.load_roster()
                self.assertEqual(bi.load_food(segment), {"a"})


class Build(unittest.TestCase):
    """main() end to end on the fixture: the payload carries video and food."""

    def test_payload(self):
        doc = answer()
        now = doc["fetched_at"]
        with tempfile.TemporaryDirectory() as tmp:
            roster = Path(tmp) / "roster.json"
            roster.write_text(json.dumps({"tier1": ["foambrewers"], "tier2": [], "see1": ["eatvermont"], "see2": [],
                                          "food": ["foambrewers"]}))
            out = Path(tmp) / "instagram.json"

            def fetch(handle, key):
                return doc["items"] if handle == "foambrewers" else []

            with mock.patch.object(bi, "ROSTER", roster), mock.patch.object(bi, "OUT", out), mock.patch.object(bi, "ROOT", Path(tmp)), \
                    mock.patch.object(bi, "api_key", return_value="k"), mock.patch.object(bi, "fetch_handle", fetch), \
                    mock.patch.object(bi.time, "time", return_value=now), mock.patch.object(bi.time, "sleep"), \
                    mock.patch.object(bi, "log"), mock.patch.object(sys, "argv", ["x", "--no-tagged", "--no-carry"]):
                self.assertEqual(bi.main(), 0)
            got = json.loads(out.read_text())
        self.assertEqual(got["videos"], 1)
        self.assertEqual(got["food"], 3)
        reel = next(p for p in got["posts"] if p.get("vu"))
        self.assertEqual((reel["h"], reel["f"], reel["s"]), ("foambrewers", 1, "do"))


if __name__ == "__main__":
    unittest.main()
