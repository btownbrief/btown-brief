"""Offline tests for scripts/reddit_report.py (the daily route comparison).

Run: python3 -m unittest discover -s tests -p 'test_reddit*.py'
"""

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import reddit_intake as ri  # noqa: E402
import reddit_report as rr  # noqa: E402

FIXTURES = os.path.join(HERE, "fixtures", "reddit")
NOW = datetime(2026, 10, 4, 20, 0, tzinfo=timezone.utc)


def no_network(*_args, **_kwargs):
    raise AssertionError("a test tried to reach the network")


def stamp(hours_ago):
    return ri.iso(NOW - timedelta(hours=hours_ago))


def post(pid, sub, created_h, seen):
    """seen: {route: hours_ago}"""
    first = max(seen.values())
    return {"id": pid, "sub": sub, "title": f"Post {pid}", "created": stamp(created_h),
            "created_exact": True, "routes": [r for r in ri.ROUTES if r in seen],
            "seen": {r: stamp(h) for r, h in seen.items()}, "first_seen": stamp(first),
            "last_seen": stamp(0)}


def run(hours_ago, statuses):
    """statuses: {route: {sub: (status, error)}}"""
    return {"ts": stamp(hours_ago),
            "routes": {route: {sub: {"status": st, "fetched": 0, "new": 0, "error": err}
                               for sub, (st, err) in by_sub.items()}
                       for route, by_sub in statuses.items()}}


def intake(posts, runs, generated_h=0, paused=False):
    return {"v": 1, "generated": stamp(generated_h), "subs": ["r/burlington", "r/vermont"],
            "state": {"paused": paused, "since": stamp(40) if paused else None},
            "runs": runs, "posts": posts}


HEALTHY_RUNS = [run(h, {"inoreader": {"r/burlington": ("ok", None), "r/vermont": ("ok", None)},
                        "rss": {"r/burlington": ("error", "HTTP 403"), "r/vermont": ("error", "HTTP 403")},
                        "oauth": {"r/burlington": ("skipped", "REDDIT_CLIENT_ID/SECRET not set"),
                                  "r/vermont": ("skipped", "REDDIT_CLIENT_ID/SECRET not set")}})
                for h in (20, 10, 1)]


class ReportTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("urllib.request.urlopen", side_effect=no_network)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_green_with_blocked_and_unconfigured_routes(self):
        posts = [post("a1", "r/burlington", 5, {"inoreader": 4}),
                 post("v1", "r/vermont", 6, {"inoreader": 5})]
        report = rr.build_report(intake(posts, HEALTHY_RUNS), now=NOW)
        self.assertEqual(report["level"], "green")
        self.assertEqual(report["alarms"], [])
        self.assertEqual(report["brief_line"],
                         "Reddit: green, 2 new posts in 24h "
                         "(Inoreader 2, RSS blocked (HTTP 403), OAuth not set up)")

    def test_route_dropping_to_zero_is_amber(self):
        posts = [post("old", "r/vermont", 60, {"inoreader": 60}),      # Inoreader worked 2.5 days ago
                 post("new", "r/vermont", 3, {"oauth": 2}),              # OAuth still delivering
                 post("b1", "r/burlington", 3, {"inoreader": 2, "oauth": 2})]
        report = rr.build_report(intake(posts, HEALTHY_RUNS), now=NOW)
        self.assertEqual(report["level"], "amber")
        self.assertEqual([a["text"] for a in report["alarms"]],
                         ["Inoreader dropped to zero for r/vermont (last new Oct 2)"])
        self.assertTrue(report["brief_line"].startswith(
            "Reddit: AMBER: Inoreader dropped to zero for r/vermont (last new Oct 2) (2 new posts"))

    def test_zero_routes_for_a_sub_is_red(self):
        posts = [post("old", "r/vermont", 60, {"inoreader": 60}),
                 post("b1", "r/burlington", 3, {"inoreader": 2})]
        report = rr.build_report(intake(posts, HEALTHY_RUNS), now=NOW)
        self.assertEqual(report["level"], "red")
        self.assertIn("no route delivered a new r/vermont post in 24h", report["brief_line"])
        # the red sub doesn't also produce a per-route amber
        self.assertFalse([a for a in report["alarms"] if a["level"] == "amber"])

    def test_paused_and_stale_intake_are_red(self):
        report = rr.build_report(intake([], HEALTHY_RUNS, generated_h=8, paused=True), now=NOW)
        texts = [a["text"] for a in report["alarms"]]
        self.assertTrue(texts[0].startswith("Reddit is paused on the site"))
        self.assertTrue(any(t.startswith("the intake hasn't run since Oct 4 12:00 UTC") for t in texts))
        self.assertTrue(report["brief_line"].startswith("Reddit: RED: Reddit is paused on the site"))
        self.assertIn("and 2 more", report["brief_line"])

    def test_overlap_only_and_lag(self):
        backfill_run = run(30, {"inoreader": {"r/burlington": ("ok", None)}})
        posts = [post("p1", "r/burlington", 10, {"rss": 9, "inoreader": 4}),   # Inoreader 5h behind
                 post("p2", "r/burlington", 8, {"rss": 7, "inoreader": 2}),
                 post("p3", "r/burlington", 6, {"rss": 5}),
                 post("p4", "r/burlington", 30, {"rss": 30, "inoreader": 30})]  # backfill: no lag
        report = rr.build_report(intake(posts, [backfill_run] + HEALTHY_RUNS), now=NOW)
        stats = report["subs"]["r/burlington"]
        self.assertEqual(stats["overlap"], {"inoreader+rss": 2, "rss": 1})
        self.assertEqual(stats["routes"]["rss"]["only_route"], 1)
        self.assertEqual(stats["routes"]["inoreader"]["found_of_made_24h"], 2)
        self.assertEqual(stats["routes"]["inoreader"]["median_lag_minutes"], 300)
        self.assertEqual(stats["routes"]["rss"]["median_lag_minutes"], 0)

    def test_report_from_a_real_fixture_intake(self):
        env = {"REDDIT_CLIENT_ID": "x", "REDDIT_CLIENT_SECRET": "y"}
        payload = ri.refresh({}, fetch=ri.fixture_fetch(FIXTURES), env=env, now=NOW, sleep=lambda _s: None)
        report = rr.build_report(payload, now=NOW)
        self.assertEqual(report["routes"]["oauth"]["status"], "live")
        self.assertEqual(report["routes"]["rss"]["status"], "live")  # r/burlington answered
        self.assertIn("r/vermont", report["subs"])
        text = rr.markdown(report)
        self.assertIn("| Route | New in window |", text)
        self.assertIn(report["brief_line"], text)

    def test_cli_writes_json_and_markdown(self):
        payload = intake([post("a1", "r/burlington", 5, {"inoreader": 4})], HEALTHY_RUNS)
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "intake.json")
            with open(path, "w", encoding="utf-8") as dst:
                json.dump(payload, dst)
            out_json = os.path.join(directory, "report.json")
            out_md = os.path.join(directory, "report.md")
            with redirect_stdout(io.StringIO()) as printed:
                code = rr.main(["--intake", path, "--json-out", out_json, "--md-out", out_md])
            self.assertEqual(code, 0)
            self.assertTrue(printed.getvalue().startswith("Reddit: "))
            with open(out_json, encoding="utf-8") as src:
                self.assertIn("brief_line", json.load(src))
            self.assertTrue(os.path.getsize(out_md) > 0)

    def test_cli_unreadable_intake(self):
        with redirect_stdout(io.StringIO()) as printed:
            code = rr.main(["--intake", "/nonexistent/reddit-intake.json"])
        self.assertEqual(code, 1)
        self.assertTrue(printed.getvalue().startswith("Reddit: RED: couldn't read the intake file"))


if __name__ == "__main__":
    unittest.main()
