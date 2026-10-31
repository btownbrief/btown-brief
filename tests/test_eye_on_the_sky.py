"""Eye on the Sky, the Fairbanks Museum's daily forecast (heard on Vermont
Public), as the read's third forecaster voice beside WCAX and NBC5.

Stephen, 2026-10-29: add the forecast locals say they trust most. The text
is for the read model to compare against, never shown on the page; the
page only links to it. Like every outlet, a failed fetch never breaks the
read, and a stale post never passes for today's call.

The fixture is a trimmed sample of the museum's WordPress post (real
markup and section headings, prose cut short) so this public repo does not
republish their forecast.

Run: python3 -m unittest tests.test_eye_on_the_sky
"""

import json
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import draft_read as dr  # noqa: E402
import outlets  # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "eye-on-the-sky", "weather-forecast-post.json")
ISSUED = datetime(2026, 10, 29, 21, 39, 21, tzinfo=timezone.utc)


def sample_post():
    with open(FIXTURE) as f:
        return json.load(f)[0]


class ParseTest(unittest.TestCase):
    def setUp(self):
        self.eye = outlets.parse_eye_on_the_sky(sample_post())

    def test_issue_time_is_the_latest_update(self):
        self.assertEqual(self.eye["issued"], "2026-10-29T21:39:21+00:00")
        self.assertEqual(datetime.fromisoformat(self.eye["issued"]), ISSUED)

    def test_periods_in_order_detailed_then_extended(self):
        names = [p["name"] for p in self.eye["periods"]]
        self.assertEqual(names, ["Thursday Night", "Friday", "Friday Night",
                                 "Saturday", "Saturday Night"])
        self.assertTrue(self.eye["periods"][0]["text"].startswith("Partly to mostly cloudy."))
        for p in self.eye["periods"]:
            self.assertNotIn("<", p["text"])

    def test_summary_discussion_and_no_hazards(self):
        self.assertTrue(self.eye["summary"].startswith("Breezy and mild this evening"))
        self.assertTrue(self.eye["discussion"].startswith("Although a warm front"))
        self.assertNotIn("Back to the top", self.eye["discussion"])
        self.assertIsNone(self.eye["hazards"])  # the post says "None."

    def test_attribution(self):
        self.assertEqual(self.eye["url"], "https://fairbanksmuseum.org/eye-on-the-sky/")
        self.assertIn("Fairbanks Museum", self.eye["outlet"])

    def test_hazards_kept_when_present(self):
        post = sample_post()
        post["content"]["rendered"] = post["content"]["rendered"].replace(
            "<p>None.</p>", "<p>A Wind Advisory is in effect Friday afternoon.</p>")
        eye = outlets.parse_eye_on_the_sky(post)
        self.assertEqual(eye["hazards"], "A Wind Advisory is in effect Friday afternoon.")

    def test_empty_post_is_none(self):
        self.assertIsNone(outlets.parse_eye_on_the_sky({"content": {"rendered": "<p>Hi</p>"}}))


class FetchTest(unittest.TestCase):
    def setUp(self):
        self._get = outlets._get

    def tearDown(self):
        outlets._get = self._get

    def test_fetch_reads_the_rest_record(self):
        with open(FIXTURE) as f:
            body = f.read()
        seen = []
        outlets._get = lambda url, timeout=30: seen.append(url) or body
        eye = outlets.fetch_eye_on_the_sky()
        self.assertIn("wp-json/wp/v2/posts?slug=weather-forecast-2", seen[0])
        self.assertEqual(len(eye["periods"]), 5)

    def test_a_failed_fetch_never_breaks_the_others(self):
        def boom(url, timeout=30):
            raise OSError("network down")
        outlets._get = boom
        out = outlets.fetch_all()
        self.assertIn("eye", out)
        self.assertIsNone(out["eye"])

    def test_no_posts_is_none(self):
        outlets._get = lambda url, timeout=30: "[]"
        self.assertIsNone(outlets.fetch_eye_on_the_sky())


class PacketTest(unittest.TestCase):
    def setUp(self):
        self.eye = outlets.parse_eye_on_the_sky(sample_post())

    def test_fresh_post_goes_in_the_packet(self):
        lines = dr.eye_lines(self.eye, now=ISSUED + timedelta(hours=2))
        self.assertTrue(lines[0].startswith("EYE ON THE SKY"))
        self.assertIn("Thu 5:39 PM", lines[0])  # issue time, Burlington clock
        self.assertIn("never their place names or branding", lines[0])
        self.assertTrue(any(line.startswith("  Friday:") for line in lines))
        self.assertTrue(lines[-1].startswith("  discussion: Although"))

    def test_stale_post_is_left_out(self):
        self.assertEqual(dr.eye_lines(self.eye, now=ISSUED + timedelta(hours=31)), [])

    def test_missing_or_broken_is_left_out(self):
        self.assertEqual(dr.eye_lines(None), [])
        self.assertEqual(dr.eye_lines({"periods": [{"name": "x", "text": "y"}]}), [])

    def test_build_packet_carries_it_beside_the_tv_voices(self):
        fresh = dict(self.eye, issued=datetime.now(timezone.utc).isoformat())
        packet = dr.build_packet({}, {"wcax": {"discussion": "Sunny today, 60s."},
                                      "nbc5": None, "eye": fresh})
        self.assertIn("WCAX METEOROLOGIST", packet)
        self.assertIn("EYE ON THE SKY", packet)
        self.assertLess(packet.index("WCAX"), packet.index("EYE ON THE SKY"))
        self.assertNotIn("EYE ON THE SKY", dr.build_packet({}, {"eye": None}))

    def test_week_packet_stays_burlington_scoped(self):
        week, _ = dr.build_week_packet({}, {"eye": self.eye})
        self.assertNotIn("EYE ON THE SKY", week)

    def test_sources_name_who_was_compared(self):
        sources = dr.forecaster_sources({"wcax": {"discussion": "x"}, "nbc5": None,
                                         "eye": self.eye})
        self.assertEqual([s["name"] for s in sources],
                         ["WCAX", "Eye on the Sky, Fairbanks Museum"])
        self.assertEqual(sources[1]["issued"], "2026-10-29T21:39:21+00:00")
        self.assertEqual(sources[1]["url"], "https://fairbanksmuseum.org/eye-on-the-sky/")

    def test_their_branding_and_places_never_reach_the_read(self):
        for bad in ("Eye on the Sky says", "the Fairbanks crew", "the Northeast Kingdom",
                    "St. Johnsbury", "near Route 2"):
            self.assertTrue(dr.REGIONAL_RE.search(bad), bad)
        for ok in ("Burlington stays dry", "Route 22A", "a sky full of stars"):
            self.assertFalse(dr.REGIONAL_RE.search(ok), ok)


if __name__ == "__main__":
    unittest.main()
