"""Offline tests for the Reddit bridge inside scripts/refresh_pulse.py: the
shared intake as a second route for the subreddit sources, removed threads
leaving, and the "Reddit is paused" flag the Pulse and All Day read.

Run: python3 -m unittest discover -s tests -p 'test_reddit*.py'
"""

import os
import sys
import unittest
from datetime import datetime, timezone
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import reddit_intake as ri  # noqa: E402
import refresh_pulse as rp  # noqa: E402

FIXTURES = os.path.join(HERE, "fixtures", "reddit")
NOW = datetime(2026, 10, 4, 20, 0, tzinfo=timezone.utc)
NOW_TS = int(NOW.timestamp())
SOURCES = [
    {"id": "r-burlington", "name": "r/burlington", "site": "https://www.reddit.com/r/burlington/",
     "topic": "local", "local": True, "podcast": False},
    {"id": "r-vermont", "name": "r/Vermont", "site": "https://www.reddit.com/r/vermont/",
     "topic": "local", "local": True, "podcast": False},
    {"id": "science", "name": "r/Science", "site": "https://www.reddit.com/r/science/",
     "topic": "science", "local": False, "podcast": False},
    {"id": "wcax", "name": "WCAX", "site": "https://www.wcax.com/", "topic": "local",
     "local": True, "podcast": False},
]


def no_network(*_args, **_kwargs):
    raise AssertionError("a test tried to reach the network")


def fixture_intake():
    env = {"REDDIT_CLIENT_ID": "x", "REDDIT_CLIENT_SECRET": "y"}
    return ri.refresh({}, fetch=ri.fixture_fetch(FIXTURES), env=env, now=NOW, sleep=lambda _s: None)


class PulseBridgeTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("urllib.request.urlopen", side_effect=no_network)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_intake_posts_feed_only_the_local_subreddits(self):
        fed = rp.intake_items(fixture_intake(), SOURCES, {})
        self.assertEqual(sorted(fed), ["r-burlington", "r-vermont"])
        urls = {item["url"] for item in fed["r-burlington"]}
        self.assertIn("https://www.reddit.com/r/burlington/comments/ddd444/late_night_food/", urls)
        link = next(i for i in fed["r-burlington"] if "bbb222" in i["url"])
        self.assertEqual(link["out"], "https://vtdigger.org/2026/10/04/bike-lane-plan/")
        self.assertTrue(all(i["when"].tzinfo for items in fed.values() for i in items))

    def test_one_thread_one_headline_across_routes(self):
        # the store already holds the thread from Inoreader, crawl-stamped later
        held = {"t": "Late night food?", "d": NOW_TS - 600,
                "u": "https://www.reddit.com/r/burlington/comments/ddd444/late_night_food/"}
        fed = rp.intake_items(fixture_intake(), SOURCES, {"r-burlington": [held]})
        merged, added = rp.merge_source([held], fed["r-burlington"], NOW_TS, cap=rp.REDDIT_ITEM_CAP)
        same = [i for i in merged if "ddd444" in i["u"]]
        self.assertEqual(len(same), 1)
        # the exact Reddit time (18:43:14) beats the later crawl stamp
        self.assertEqual(same[0]["d"], int(datetime(2026, 10, 4, 18, 43, 14, tzinfo=timezone.utc).timestamp()))
        self.assertEqual(added, len(fed["r-burlington"]) - 1)

    def test_removed_threads_leave_the_pulse(self):
        intake = fixture_intake()
        per_source = {"r-burlington": [
            {"t": "A post the moderators later removed", "d": NOW_TS - 7200,
             "u": "https://www.reddit.com/r/burlington/comments/rem999/a_post_the_moderators_later_removed/"},
            {"t": "Late night food?", "d": NOW_TS - 3600,
             "u": "https://www.reddit.com/r/burlington/comments/ddd444/late_night_food/"}],
            "wcax": [{"t": "x", "u": "https://www.wcax.com/comments/rem999/", "d": NOW_TS}]}
        rp.drop_removed(per_source, SOURCES, set(intake["removed"]))
        self.assertEqual([i["t"] for i in per_source["r-burlington"]], ["Late night food?"])
        self.assertEqual(len(per_source["wcax"]), 1)  # only subreddit lists are touched

    def test_paused_flag(self):
        fresh = {"science": [{"u": "https://www.reddit.com/r/science/comments/s1/x/", "d": NOW_TS - 3600}]}
        state = rp.reddit_state(SOURCES, fresh, NOW_TS)
        self.assertEqual(state["paused"], False)
        self.assertEqual(state["last_post"], "2026-10-04T19:00:00+00:00")
        stale = {"r-burlington": [{"u": "https://www.reddit.com/r/burlington/comments/b1/x/",
                                   "d": NOW_TS - (rp.REDDIT_PAUSE_HOURS + 1) * 3600}]}
        self.assertTrue(rp.reddit_state(SOURCES, stale, NOW_TS)["paused"])
        self.assertTrue(rp.reddit_state(SOURCES, {}, NOW_TS)["paused"])
        self.assertIsNone(rp.reddit_state([SOURCES[3]], {}, NOW_TS))
        self.assertEqual(rp.REDDIT_PAUSE_HOURS, ri.PAUSE_AFTER_HOURS)

    def test_payload_without_the_flag_is_unchanged(self):
        per_source = {"r-burlington": [{"t": "x", "u": "https://www.reddit.com/r/burlington/comments/b1/x/",
                                        "d": NOW_TS}]}
        payload = rp.build_payload(SOURCES, per_source, NOW)
        self.assertEqual(sorted(payload), ["generated", "items", "sources", "v"])

    def test_bad_intake_rows_are_skipped(self):
        junk = {"posts": [None, "x", {"sub": "r/burlington"},
                          {"sub": "r/burlington", "title": "t", "created": "not a time",
                           "url": "https://www.reddit.com/r/burlington/comments/q1/t/"}]}
        self.assertEqual(rp.intake_items(junk, SOURCES, {}), {})
        self.assertEqual(rp.intake_items({}, SOURCES, {}), {})


if __name__ == "__main__":
    unittest.main()
