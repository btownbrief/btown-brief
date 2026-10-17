"""Offline tests for scripts/reddit_intake.py. Fixtures only: urlopen is
patched to fail loudly, so any accidental network call breaks the test.

Run: python3 -m unittest discover -s tests -p 'test_reddit*.py'
"""

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from datetime import datetime, timedelta, timezone
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import reddit_intake as ri  # noqa: E402

FIXTURES = os.path.join(HERE, "fixtures", "reddit")
NOW = datetime(2026, 10, 4, 20, 0, tzinfo=timezone.utc)
CREDS = {"REDDIT_CLIENT_ID": "fixture-id", "REDDIT_CLIENT_SECRET": "fixture-secret"}


def read(name):
    with open(os.path.join(FIXTURES, name), "rb") as src:
        return src.read()


def no_network(*_args, **_kwargs):
    raise AssertionError("a test tried to reach the network")


class Recorder:
    """fixture_fetch wrapper that remembers every URL asked for."""

    def __init__(self, directory=FIXTURES):
        self.inner = ri.fixture_fetch(directory)
        self.urls = []

    def __call__(self, url, headers=None, data=None):
        self.urls.append(url)
        return self.inner(url, headers, data)


def failing_fetch(url, headers=None, data=None):
    raise ri.urllib.error.HTTPError(url, 403, "Forbidden", {}, io.BytesIO())


class OfflineTestCase(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("urllib.request.urlopen", side_effect=no_network)
        patcher.start()
        self.addCleanup(patcher.stop)


class ParserTests(OfflineTestCase):
    def test_inoreader_items(self):
        posts = {p["id"]: p for p in ri.parse_inoreader(read("inoreader-burlington.xml"), "r/burlington")}
        self.assertEqual(sorted(posts), ["aaa111", "bbb222", "ccc333", "rem999"])  # non-thread link skipped
        self.assertEqual(posts["aaa111"]["title"], "Anyone know what’s happening on the green?")
        self.assertEqual(posts["aaa111"]["kind"], "self")
        self.assertFalse(posts["aaa111"]["created_exact"])  # crawl time, not post time
        # the LAST [link] anchor wins over a crafted one in the body
        self.assertEqual(posts["bbb222"]["out"], "https://vtdigger.org/2026/10/04/bike-lane-plan/")
        self.assertEqual(posts["bbb222"]["kind"], "link")
        self.assertIsNone(posts["ccc333"]["out"])  # i.redd.it image is not an article
        self.assertEqual(posts["bbb222"]["url"],
                         "https://www.reddit.com/r/burlington/comments/bbb222/city_council_approves_new_bike_lane_plan/")

    def test_atom_entries(self):
        posts = {p["id"]: p for p in ri.parse_atom(read("rss-burlington.xml"), "r/burlington")}
        self.assertEqual(sorted(posts), ["aaa111", "bbb222", "ddd444"])
        self.assertTrue(posts["aaa111"]["created_exact"])
        self.assertEqual(posts["aaa111"]["created"], datetime(2026, 10, 4, 8, 15, tzinfo=timezone.utc))
        self.assertEqual(posts["bbb222"]["out"], "https://vtdigger.org/2026/10/04/bike-lane-plan/")
        self.assertIsNone(posts["ddd444"]["out"])

    def test_oauth_listing(self):
        posts, removed = ri.parse_listing(json.loads(read("oauth-burlington.json")), "r/burlington")
        by_id = {p["id"]: p for p in posts}
        self.assertEqual(removed, {"rem999"})
        self.assertNotIn("rem999", by_id)
        self.assertEqual((by_id["ddd444"]["score"], by_id["ddd444"]["comments"], by_id["ddd444"]["flair"]),
                         (9, 14, "Question"))
        self.assertEqual(by_id["bbb222"]["out"], "https://vtdigger.org/2026/10/04/bike-lane-plan/")
        self.assertIsNone(by_id["ccc333"]["out"])  # reddit-hosted image
        self.assertFalse(by_id["ddd444"]["nsfw"])

    def test_deleted_account_is_not_a_deleted_post(self):
        listing = {"data": {"children": [
            {"data": {"id": "acc1", "title": "Still up", "author": "[deleted]", "selftext": "still visible",
                      "permalink": "/r/burlington/comments/acc1/still_up/", "created_utc": 1791139394,
                      "is_self": True}},
            {"data": {"id": "gone1", "title": "[deleted by user]", "author": "[deleted]", "selftext": "",
                      "permalink": "/r/burlington/comments/gone1/x/", "created_utc": 1791139394,
                      "is_self": True}}]}}
        posts, removed = ri.parse_listing(listing, "r/burlington")
        self.assertEqual([p["id"] for p in posts], ["acc1"])
        self.assertEqual(removed, {"gone1"})

    def test_url_helpers(self):
        self.assertEqual(ri.post_url("https://old.reddit.com/r/burlington/comments/AbC12/slug/?utm_source=x"),
                         "https://www.reddit.com/r/burlington/comments/abc12/slug/")
        self.assertIsNone(ri.post_url("https://www.reddit.com/r/burlington/"))
        self.assertTrue(ri.is_reddit_host("https://v.redd.it/x"))
        self.assertFalse(ri.is_reddit_host("https://notreddit.com.example/x"))

    def test_fixture_fetch_refuses_unknown_urls(self):
        with self.assertRaises(RuntimeError):
            ri.fixture_fetch(FIXTURES)("https://example.com/")


class RefreshTests(OfflineTestCase):
    def refresh(self, previous=None, env=CREDS, fetch=None, now=NOW, routes=ri.ROUTES):
        return ri.refresh(previous or {}, fetch=fetch or Recorder(), env=env, routes=routes,
                          now=now, sleep=lambda _s: None)

    def test_every_route_tagged_and_merged(self):
        payload = self.refresh()
        posts = {p["id"]: p for p in payload["posts"]}
        self.assertEqual(posts["aaa111"]["routes"], ["inoreader", "rss", "oauth"])
        self.assertEqual(posts["ddd444"]["routes"], ["rss", "oauth"])
        self.assertEqual(posts["eee555"]["routes"], ["oauth"])
        self.assertEqual(posts["vvv111"]["routes"], ["inoreader", "oauth"])
        # Reddit's exact timestamp beats Inoreader's crawl time
        self.assertEqual(posts["aaa111"]["created"], "2026-10-04T08:15:00+00:00")
        self.assertTrue(posts["aaa111"]["created_exact"])
        # counts come from OAuth only
        self.assertEqual((posts["bbb222"]["score"], posts["bbb222"]["comments"]), (40, 55))
        self.assertEqual(posts["bbb222"]["kind"], "link")
        # newest first, every post seen by at least one route
        created = [p["created"] for p in payload["posts"]]
        self.assertEqual(created, sorted(created, reverse=True))
        self.assertTrue(all(p["routes"] and set(p["seen"]) == set(p["routes"]) for p in payload["posts"]))

    def test_no_bodies_or_authors_stored(self):
        payload = self.refresh()
        for post in payload["posts"]:
            self.assertFalse({"body", "author", "selftext"} & set(post))
        self.assertNotIn("example_one", json.dumps(payload))

    def test_removed_posts_leave_and_stay_gone(self):
        payload = self.refresh()
        self.assertNotIn("rem999", {p["id"] for p in payload["posts"]})  # Inoreader still carries it
        self.assertIn("rem999", payload["removed"])
        again = self.refresh(previous=payload, env={}, now=NOW + timedelta(hours=1))
        self.assertNotIn("rem999", {p["id"] for p in again["posts"]})

    def test_missing_from_oauth_listing_means_removed(self):
        previous = self.refresh(env={})
        gone = {"id": "fff666", "sub": "r/burlington", "title": "Deleted later", "created_exact": True,
                "url": "https://www.reddit.com/r/burlington/comments/fff666/deleted_later/",
                "kind": "self", "out": None, "score": None, "comments": None, "flair": None, "nsfw": None,
                "created": "2026-10-03T12:00:00+00:00", "routes": ["rss"],
                "seen": {"rss": "2026-10-03T13:00:00+00:00"},
                "first_seen": "2026-10-03T13:00:00+00:00", "last_seen": "2026-10-03T13:00:00+00:00"}
        previous["posts"].append(gone)
        payload = self.refresh(previous=previous, now=NOW + timedelta(hours=1))
        self.assertNotIn("fff666", {p["id"] for p in payload["posts"]})
        self.assertIn("fff666", payload["removed"])

    def test_old_stickied_post_does_not_widen_the_removal_span(self):
        # 105 live posts stored; the listing returns a 30-day-old sticky plus
        # the newest 99. The 6 older live posts fell off the page, not off Reddit.
        store, removed = {}, {}
        def make(n, minutes):
            return ri.blank_post(f"p{n}", "r/burlington", f"P{n}",
                                 f"https://www.reddit.com/r/burlington/comments/p{n}/x/",
                                 NOW - timedelta(minutes=minutes), True)
        for n in range(105):
            ri.upsert(store, make(n, n), "oauth", NOW - timedelta(hours=1))
        sticky = ri.blank_post("st1", "r/burlington", "Rules", "https://www.reddit.com/r/burlington/comments/st1/rules/",
                               NOW - timedelta(days=30), True)
        sticky["stickied"] = True
        listing = [sticky] + [make(n, n) for n in range(99)]
        ri.merge(store, removed, {"oauth": {"r/burlington": {"status": "ok", "posts": listing,
                                                             "removed": set(), "error": None}}}, NOW)
        self.assertEqual(removed, {})
        self.assertTrue(all(f"p{n}" in store for n in range(105)))

    def test_oauth_skipped_without_secrets(self):
        fetch = Recorder()
        payload = self.refresh(env={}, fetch=fetch)
        self.assertNotIn(ri.TOKEN_URL, fetch.urls)
        for sub in ri.SUBS:
            entry = payload["routes"]["oauth"][sub]
            self.assertEqual(entry["status"], "skipped")
            self.assertIn("REDDIT_CLIENT_ID", entry["error"])
        self.assertEqual(payload["state"]["routes_live"], ["inoreader", "rss"])

    def test_route_errors_are_recorded_not_raised(self):
        payload = self.refresh()
        self.assertEqual(payload["routes"]["rss"]["r/vermont"]["status"], "error")  # no fixture: 404
        self.assertEqual(payload["routes"]["rss"]["r/vermont"]["error"], "HTTP 404")
        self.assertEqual(payload["routes"]["inoreader"]["r/burlington"]["status"], "ok")
        self.assertEqual(payload["routes"]["oauth"]["r/burlington"]["new"], 6)

    def test_token_failure_marks_oauth_error(self):
        with tempfile.TemporaryDirectory() as directory:
            for name in os.listdir(FIXTURES):
                if name != "oauth-token.json":
                    with open(os.path.join(directory, name), "wb") as dst:
                        dst.write(read(name))
            payload = self.refresh(fetch=Recorder(directory))
        self.assertEqual(payload["routes"]["oauth"]["r/burlington"]["status"], "error")
        self.assertTrue(payload["routes"]["oauth"]["r/burlington"]["error"].startswith("token:"))

    def test_new_counts_per_route(self):
        first = self.refresh(env={})
        self.assertEqual(first["routes"]["inoreader"]["r/burlington"]["new"], 4)
        second = self.refresh(previous=first, env={}, now=NOW + timedelta(hours=1))
        self.assertEqual(second["routes"]["inoreader"]["r/burlington"]["new"], 0)
        self.assertEqual(second["routes"]["inoreader"]["r/burlington"]["fetched"], 4)
        self.assertEqual(len(second["runs"]), 2)

    def test_paused_when_no_route_delivers_for_36_hours(self):
        first = self.refresh(env={})
        self.assertFalse(first["state"]["paused"])
        later = NOW + timedelta(hours=ri.PAUSE_AFTER_HOURS + 1)
        quiet = self.refresh(previous=first, env={}, fetch=failing_fetch, now=later)
        self.assertTrue(quiet["state"]["paused"])
        self.assertEqual(quiet["state"]["since"], first["generated"])
        self.assertEqual(quiet["state"]["routes_live"], [])
        self.assertTrue(quiet["posts"])  # the last posts stay; consumers decide what to show
        # stale repeats from a route don't count as "new"
        repeat = self.refresh(previous=first, env={}, now=later)
        self.assertTrue(repeat["state"]["paused"])

    def test_removing_the_newest_post_does_not_fake_a_pause(self):
        first = self.refresh(env={})
        # every stored post disappears (removed), yet a route delivered an hour ago
        emptied = dict(first, posts=[])
        later = self.refresh(previous=emptied, env={}, fetch=failing_fetch, now=NOW + timedelta(hours=1))
        self.assertFalse(later["state"]["paused"])
        self.assertEqual(later["state"]["newest_first_seen"], first["generated"])

    def test_empty_store_is_paused(self):
        payload = self.refresh(env={}, fetch=failing_fetch)
        self.assertTrue(payload["state"]["paused"])
        self.assertEqual(payload["posts"], [])

    def test_window_and_run_history_pruned(self):
        first = self.refresh(env={})
        much_later = NOW + timedelta(days=ri.WINDOW_DAYS + 1)
        payload = self.refresh(previous=first, env={}, fetch=failing_fetch, now=much_later)
        self.assertEqual(payload["posts"], [])
        self.assertEqual(len(payload["runs"]), 1)  # the old receipt aged out

    def test_routes_flag_limits_collection(self):
        fetch = Recorder()
        payload = self.refresh(fetch=fetch, routes=("inoreader",))
        self.assertEqual(set(payload["routes"]), {"inoreader"})
        self.assertTrue(all("inoreader.com" in url for url in fetch.urls))


class CliTests(OfflineTestCase):
    def test_cli_fixture_run_writes_file(self):
        with tempfile.TemporaryDirectory() as directory:
            out = os.path.join(directory, "data", "reddit-intake.json")
            # Pin the clock to the fixtures' week: on the real clock the
            # fixture posts age out of WINDOW_DAYS and the run writes none.
            with redirect_stdout(io.StringIO()) as printed, mock.patch.dict(os.environ, CREDS), \
                    mock.patch.object(ri, "utcnow", return_value=NOW):
                code = ri.main(["--fixtures", FIXTURES, "--store", os.path.join(directory, "none.json"),
                                "--out", out])
            self.assertEqual(code, 0)
            with open(out, encoding="utf-8") as src:
                payload = json.load(src)
            self.assertEqual(payload["v"], 1)
            self.assertIn("state", printed.getvalue())
            self.assertTrue(payload["posts"])

    def test_cli_rejects_unknown_route(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            ri.main(["--routes", "carrier-pigeon", "--dry-run"])


if __name__ == "__main__":
    unittest.main()
