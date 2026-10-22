"""Offline tests for the logged-out shreddit route, the Mac mirror, the
route order, the back-off, and the Mac runner (scripts/reddit_mac_runner.py).
The live-shreddit-*.html fixtures are real responses from 2026-10-22, trimmed
to the post tags and with author names scrubbed. urlopen is patched to fail
loudly, so any accidental network call breaks the test.

Run: python3 -m unittest tests.test_reddit_shreddit
"""

import io
import json
import os
import sys
import tempfile
import unittest
import urllib.error
from datetime import date, datetime, timedelta, timezone
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
sys.path.insert(0, ROOT)

import reddit_client as rc  # noqa: E402
import reddit_intake as ri  # noqa: E402
import reddit_mac_runner as runner  # noqa: E402

FIXTURES = os.path.join(HERE, "fixtures", "reddit")
NOW = datetime(2026, 10, 22, 17, 0, tzinfo=timezone.utc)


def page(name):
    with open(os.path.join(FIXTURES, f"live-shreddit-{name}.html"), "rb") as src:
        return src.read()


def no_network(*_args, **_kwargs):
    raise AssertionError("a test tried to reach the network")


def http_error(url, code, headers=None):
    return urllib.error.HTTPError(url, code, "nope", headers or {}, io.BytesIO())


REMOVED_PAGE = b"""
<shreddit-post id="t3_aaa111" permalink="/r/burlington/comments/aaa111/x/" post-title="[ Removed by Reddit ]"
  post-type="text" created-timestamp="2026-10-22T10:00:00.000000+0000" score="1" comment-count="0"></shreddit-post>
<shreddit-post id="t3_bbb222" permalink="/r/burlington/comments/bbb222/y/" post-title="[deleted by user]"
  post-type="text" created-timestamp="2026-10-22T10:00:00.000000+0000"></shreddit-post>
<shreddit-post id="t3_ccc333" permalink="/r/burlington/comments/ccc333/z/" post-title="Still here"
  post-type="link" content-href="https://vtdigger.org/a" nsfw
  created-timestamp="2026-10-22T11:00:00.000000+0000" score="3" comment-count="2"></shreddit-post>
"""


class FakeWeb:
    """Serves shreddit pages by (sub, sort), a mirror document, and records
    every call. `fail` maps a substring of the URL to an exception."""

    def __init__(self, pages=None, mirror=None, fail=None):
        self.pages = pages or {}
        self.mirror = mirror
        self.fail = dict(fail or {})
        self.calls = []

    def __call__(self, url, headers=None, data=None):
        self.calls.append({"url": url, "headers": dict(headers or {})})
        for needle, exc in self.fail.items():
            if needle in url:
                raise exc
        if url.startswith(rc.SHREDDIT_BASE):
            sort = url[len(rc.SHREDDIT_BASE) + 1:].split("/")[0]
            name = url.split("name=")[1].split("&")[0].lower()
            body = self.pages.get((name, sort))
            if body is None:
                raise http_error(url, 404)
            return body
        if url == rc.MIRROR_URL and self.mirror is not None:
            return json.dumps(self.mirror).encode()
        if "inoreader.com" in url:
            raise http_error(url, 503)
        if url.startswith(rc.RSS_BASE) and ".rss" in url:
            raise http_error(url, 403)
        raise AssertionError("unexpected URL " + url)

    def urls(self, needle=""):
        return [c["url"] for c in self.calls if needle in c["url"]]


class Offline(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("urllib.request.urlopen", side_effect=no_network)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.slept = []
        self.now = [NOW.timestamp()]

    def client(self, fetch, env=None, state=None):
        def sleep(seconds):
            self.slept.append(seconds)
            self.now[0] += seconds
        return rc.Client(env={} if env is None else env, fetch=fetch, sleep=sleep,
                         clock=lambda: self.now[0], state_path=state)


class ParserTests(Offline):
    def test_real_new_page_parses_to_the_oauth_listing_shape(self):
        listing = rc.parse_shreddit(page("burlington-new"))
        rows = [c["data"] for c in listing["data"]["children"]]
        self.assertEqual(len(rows), 24)
        first = rows[0]
        self.assertEqual(first["id"], "1xckmpt")
        self.assertEqual(first["title"], "Free Haircuts at Burlington Barber Shop 10/23 and 10/24")
        self.assertEqual(first["permalink"],
                         "/r/burlington/comments/1xckmpt/free_haircuts_at_burlington_barber_shop_1023_and/")
        self.assertEqual(datetime.fromtimestamp(first["created_utc"], timezone.utc).isoformat(timespec="seconds"),
                         "2026-10-22T14:48:29+00:00")
        self.assertEqual((first["score"], first["num_comments"], first["is_self"]), (5, 0, True))
        self.assertNotIn("url_overridden_by_dest", first)
        self.assertEqual(listing["data"]["after"], "dDNfMXhiYXhtcw==")
        # entities in titles come back as text
        self.assertIn("Flora & fauna on church st", [r["title"] for r in rows])

    def test_only_outside_links_count_as_outbound(self):
        rows = [c["data"] for c in rc.parse_shreddit(page("vermont-new"))["data"]["children"]]
        outs = [r["url_overridden_by_dest"] for r in rows if "url_overridden_by_dest" in r]
        self.assertEqual(len(outs), 5)  # the five link posts on that page
        self.assertTrue(any(o.startswith("https://vtdigger.org/2026/10/21/") for o in outs))
        self.assertTrue(any(o.startswith("https://www.wcax.com/") for o in outs))
        self.assertFalse([o for o in outs if "redd.it" in o or "reddit.com" in o])  # images, galleries, threads

    def test_flair_and_crosspost_parent(self):
        nba = [c["data"] for c in rc.parse_shreddit(page("nba-top-day"))["data"]["children"]]
        self.assertEqual([r["link_flair_text"] for r in nba if r["link_flair_text"]][:2], ["Highlight", "Highlight"])
        bur = {c["data"]["id"]: c["data"] for c in rc.parse_shreddit(page("burlington-new"))["data"]["children"]}
        cross = bur["1xch8ww"]
        self.assertEqual(cross["crosspost_parent_list"], [{"id": "1xch8d5"}])
        self.assertEqual(cross["url"], "https://www.reddit.com/r/vermont/comments/1xch8d5/"
                                       "phil_scott_defended_brutal_assault_of_march_11th/")

    def test_nothing_but_allowed_fields_and_no_author(self):
        allowed = {"id", "name", "title", "permalink", "url", "url_overridden_by_dest", "is_self",
                   "created_utc", "score", "num_comments", "link_flair_text", "over_18", "stickied",
                   "subreddit", "post_type", "crosspost_parent_list"}
        for name in ("burlington-new", "vermont-new", "nba-top-day"):
            listing = rc.parse_shreddit(page(name))
            for child in listing["data"]["children"]:
                self.assertLessEqual(set(child["data"]), allowed)
            self.assertNotIn("fixture-user", json.dumps(listing))

    def test_removed_and_deleted_posts_are_dropped(self):
        listing = rc.parse_shreddit(REMOVED_PAGE)
        self.assertEqual([c["data"]["id"] for c in listing["data"]["children"]], ["ccc333"])
        self.assertEqual(listing["data"]["removed_ids"], ["aaa111", "bbb222"])
        self.assertTrue(listing["data"]["children"][0]["data"]["over_18"])
        posts, removed = ri.parse_listing(listing, "r/burlington")
        self.assertEqual(removed, {"aaa111", "bbb222"})
        self.assertEqual(posts[0]["out"], "https://vtdigger.org/a")


class ShredditRouteTests(Offline):
    def test_url_headers_and_no_cookies(self):
        fake = FakeWeb(pages={("nba", "top"): page("nba-top-day")})
        data = self.client(fake).shreddit_json("r/nba/top", t="day", limit=30)
        self.assertEqual(len(data["data"]["children"]), 10)
        call = fake.calls[0]
        self.assertEqual(call["url"], "https://www.reddit.com/svc/shreddit/community-more-posts/top/?name=nba&t=day")
        self.assertEqual(call["headers"]["User-Agent"], rc.DEFAULT_UA)
        self.assertFalse({"Cookie", "Authorization"} & set(call["headers"]))

    def test_challenge_or_empty_page_is_a_failure(self):
        fake = FakeWeb(pages={("burlington", "new"): b"<html><body>Please wait for verification</body></html>"})
        with self.assertRaises(rc.RedditError):
            self.client(fake).shreddit_json("r/burlington/new")

    def test_search_never_reaches_the_network(self):
        fake = FakeWeb()
        with self.assertRaises(rc.RedditError):
            self.client(fake).shreddit_json("search", q="x")
        self.assertEqual(fake.calls, [])

    def test_requests_are_spaced(self):
        fake = FakeWeb(pages={("burlington", "new"): page("burlington-new"),
                              ("vermont", "new"): page("vermont-new")})
        client = self.client(fake)
        client.shreddit_json("r/burlington/new")
        client.shreddit_json("r/vermont/new")
        self.assertEqual(self.slept, [rc.MIN_GAP])


class BackoffTests(Offline):
    def test_403_stops_the_route_for_the_run(self):
        fake = FakeWeb(fail={"/svc/shreddit/": http_error("x", 403)})
        client = self.client(fake)
        with self.assertRaises(rc.RedditError):
            client.shreddit_json("r/burlington/new")
        with self.assertRaises(rc.RedditError):
            client.shreddit_json("r/vermont/new")
        self.assertEqual(len(fake.urls("/svc/shreddit/")), 1)

    def test_429_is_not_retried_and_stops_both_reddit_routes(self):
        fake = FakeWeb(fail={"/svc/shreddit/": http_error("x", 429, {"Retry-After": "5"})})
        client = self.client(fake)
        with self.assertRaises(rc.RateLimited):
            client.shreddit_json("r/burlington/new")
        with self.assertRaises(rc.RedditError):
            client.rss("r/burlington/new")
        self.assertEqual(len(fake.calls), 1)
        self.assertEqual(self.slept, [])

    def test_cooldown_persists_doubles_and_clears(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = os.path.join(tmp, "state.json")
            blocked = FakeWeb(fail={"/svc/shreddit/": http_error("x", 403)})
            with self.assertRaises(rc.RedditError):
                self.client(blocked, state=state).shreddit_json("r/burlington/new")
            with open(state) as fh:
                saved = json.load(fh)["cooldown"]["shreddit"]
            self.assertEqual(saved["strikes"], 1)
            self.assertAlmostEqual(saved["until"] - self.now[0], rc.COOLDOWN_FIRST)

            # next run, still cooling down: no request at all
            quiet = FakeWeb(pages={("burlington", "new"): page("burlington-new")})
            self.now[0] += 10 * 60
            with self.assertRaises(rc.RedditError) as caught:
                self.client(quiet, state=state).shreddit_json("r/burlington/new")
            self.assertIn("backing off", str(caught.exception))
            self.assertEqual(quiet.calls, [])

            # after the cooldown, blocked again: twice as long
            self.now[0] += rc.COOLDOWN_FIRST
            with self.assertRaises(rc.RedditError):
                self.client(blocked, state=state).shreddit_json("r/burlington/new")
            with open(state) as fh:
                saved = json.load(fh)["cooldown"]["shreddit"]
            self.assertEqual(saved["strikes"], 2)
            self.assertAlmostEqual(saved["until"] - self.now[0], 2 * rc.COOLDOWN_FIRST)

            # a success clears it
            self.now[0] += 2 * rc.COOLDOWN_FIRST
            self.client(quiet, state=state).shreddit_json("r/burlington/new")
            with open(state) as fh:
                self.assertNotIn("shreddit", json.load(fh).get("cooldown", {}))

    def test_rss_failure_streak_moves_shreddit_first(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = os.path.join(tmp, "state.json")
            for _ in range(rc.RSS_STREAK_LIMIT):
                self.client(FakeWeb(), state=state).note_rss_run(False)
            client = self.client(FakeWeb(), state=state)
            self.assertEqual(client.order(date(2026, 10, 22)), ["oauth", "shreddit", "rss", "mirror"])
            client.note_rss_run(True)
            self.assertEqual(client.order(date(2026, 10, 22)), ["oauth", "rss", "shreddit", "mirror"])


class OrderTests(Offline):
    def test_default_order_and_the_rss_end(self):
        self.assertEqual(rc.route_order({}, date(2026, 10, 22)), ["oauth", "rss", "shreddit", "mirror"])
        self.assertEqual(rc.route_order({}, date(2026, 11, 13)), ["oauth", "shreddit", "mirror"])
        self.assertEqual(rc.route_order({}, date(2026, 10, 22), rss_streak=3),
                         ["oauth", "shreddit", "rss", "mirror"])
        self.assertEqual(rc.route_order({"REDDIT_ROUTES": "shreddit, bogus,rss,shreddit"}, date(2026, 10, 22)),
                         ["shreddit", "rss"])

    def test_read_falls_through_rss_to_shreddit(self):
        fake = FakeWeb(pages={("nba", "top"): page("nba-top-day")})
        route, data = self.client(fake).read("r/nba/top", t="day", limit=30)
        self.assertEqual(route, "shreddit")
        self.assertEqual(len(data["data"]["children"]), 10)
        self.assertEqual(len(fake.urls(".rss")), 1)

    def test_two_rss_failures_in_a_run_put_shreddit_first(self):
        fake = FakeWeb(pages={("nba", "top"): page("nba-top-day"), ("nfl", "top"): page("nba-top-day")},
                       fail={".rss": urllib.error.URLError("timed out")})
        client = self.client(fake)
        client.read("r/nba/top", t="day")
        client.read("r/nfl/top", t="day")
        client.read("r/nba/top", t="day")
        self.assertEqual(len(fake.urls(".rss")), 2)  # the third read skipped straight to shreddit

    def test_listing_never_uses_rss(self):
        fake = FakeWeb(pages={("goodburlington", "hot"): page("burlington-new")})
        route, _ = self.client(fake).listing("r/GoodBurlington/hot", limit=25)
        self.assertEqual(route, "shreddit")
        self.assertEqual(fake.urls(".rss"), [])


class MirrorTests(Offline):
    def mirror(self, age_minutes=20, key="r/goodburlington/hot"):
        fetched = (NOW - timedelta(minutes=age_minutes)).isoformat()
        return {"v": 1, "listings": {key: {"fetched": fetched, "data": rc.parse_shreddit(page("burlington-new"))}}}

    def test_github_gets_the_mac_copy_when_reddit_blocks_it(self):
        fake = FakeWeb(mirror=self.mirror(), fail={"/svc/shreddit/": http_error("x", 403)})
        route, data = self.client(fake).listing("r/GoodBurlington/hot", limit=25)
        self.assertEqual(route, "mirror")
        self.assertEqual(len(data["data"]["children"]), 24)

    def test_stale_or_missing_copy_is_an_error_not_data(self):
        for doc in (self.mirror(age_minutes=60 * 7), self.mirror(key="r/other/hot"), {"nope": 1}):
            fake = FakeWeb(mirror=doc, fail={"/svc/shreddit/": http_error("x", 403)})
            with self.assertRaises(rc.RedditError):
                self.client(fake).listing("r/GoodBurlington/hot")

    def test_mirror_from_a_file_and_switched_off(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "listings.json")
            with open(path, "w") as fh:
                json.dump(self.mirror(), fh)
            route, _ = self.client(FakeWeb(), env={"REDDIT_ROUTES": "mirror", "REDDIT_MIRROR": path}).listing(
                "r/GoodBurlington/hot")
            self.assertEqual(route, "mirror")
        with self.assertRaises(rc.RedditError):
            self.client(FakeWeb(), env={"REDDIT_ROUTES": "mirror", "REDDIT_MIRROR": "off"}).listing("r/x/hot")

    def test_onair_reads_the_mirror_like_oauth(self):
        import gather_onair_sports as sports
        doc = self.mirror(key="r/nba/top?t=day")
        doc["listings"]["r/nba/top?t=day"]["data"] = rc.parse_shreddit(page("nba-top-day"))
        fake = FakeWeb(mirror=doc, fail={"/svc/shreddit/": http_error("x", 403)})
        posts = sports.reddit_top("nba", self.client(fake))
        self.assertTrue(posts)
        self.assertEqual(posts[0]["id"], "1xc4883")
        self.assertIsNotNone(posts[0]["score"])


class IntakeShredditTests(Offline):
    def test_shreddit_route_feeds_the_intake_with_counts(self):
        fake = FakeWeb(pages={("burlington", "new"): page("burlington-new"),
                              ("vermont", "new"): page("vermont-new")})
        payload = ri.refresh({}, fetch=fake, env={}, routes=("shreddit",), now=NOW,
                             client=self.client(fake), by="mac")
        self.assertEqual(payload["by"], "mac")
        self.assertEqual(payload["routes"]["shreddit"]["r/burlington"]["status"], "ok")
        post = next(p for p in payload["posts"] if p["id"] == "1xckmpt")
        self.assertEqual((post["score"], post["comments"], post["created_exact"]), (5, 0, True))
        self.assertEqual(post["routes"], ["shreddit"])
        links = [p for p in payload["posts"] if p["sub"] == "r/vermont" and p["kind"] == "link"]
        self.assertTrue(any(p["out"].startswith("https://www.wcax.com/") for p in links))

    def test_national_subs_read_hot_and_never_rss(self):
        fake = FakeWeb(pages={("news", "hot"): page("burlington-new")})
        ri.refresh({}, fetch=fake, env={}, subs=("r/news",), routes=("rss", "shreddit"), now=NOW,
                   client=self.client(fake))
        self.assertEqual(fake.urls(".rss"), [])
        self.assertEqual(fake.urls("/svc/shreddit/"),
                         ["https://www.reddit.com/svc/shreddit/community-more-posts/hot/?name=news"])

    def test_blocked_shreddit_never_wipes_the_store(self):
        fake = FakeWeb(pages={("burlington", "new"): page("burlington-new")})
        good = ri.refresh({}, fetch=fake, env={}, routes=("shreddit",), subs=("r/burlington",), now=NOW,
                          client=self.client(fake))
        blocked = FakeWeb(fail={"/svc/shreddit/": http_error("x", 403)})
        later = ri.refresh(good, fetch=blocked, env={}, routes=("shreddit",), subs=("r/burlington",),
                           now=NOW + timedelta(hours=1), client=self.client(blocked))
        self.assertEqual(later["routes"]["shreddit"]["r/burlington"]["status"], "error")
        self.assertEqual({p["id"] for p in later["posts"]}, {p["id"] for p in good["posts"]})


class RunnerTests(Offline):
    def setUp(self):
        super().setUp()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.prev = os.path.join(self.tmp.name, "prev")
        self.out = os.path.join(self.tmp.name, "out")
        os.makedirs(os.path.join(self.prev, "data"))
        pages = {}
        for path, params, _every in runner.TARGETS:
            sub, sort = rc.split_listing_path(path)
            pages[(sub.lower(), sort)] = page("nba-top-day" if sub in ("nba", "nfl") else "burlington-new")
        self.pages = pages

    def run_once(self, fake, now=NOW, state=None):
        self.slept.clear()
        code, text = runner.run(self.prev, self.out, state=state, env={}, now=now, fetch=fake,
                                sleep=self.slept.append)
        return code, text

    def written(self, name):
        with open(os.path.join(self.out, "data", name)) as fh:
            return json.load(fh)

    def promote(self):
        """The pushed files become the next run's previous files."""
        for name in ("reddit-intake.json", "reddit-listings.json"):
            os.replace(os.path.join(self.out, "data", name), os.path.join(self.prev, "data", name))

    def test_first_run_fetches_everything_politely_and_writes_four_files(self):
        fake = FakeWeb(pages=self.pages)
        code, text = self.run_once(fake)
        self.assertEqual(code, 0, text)
        shreddit = fake.urls("/svc/shreddit/")
        self.assertEqual(len(shreddit), len(runner.TARGETS))
        self.assertLessEqual(len(shreddit), 16)
        self.assertEqual(sorted(os.listdir(os.path.join(self.out, "data"))),
                         ["reddit-intake.json", "reddit-listings.json", "reddit-report.json", "reddit-report.md"])
        listings = self.written("reddit-listings.json")["listings"]
        self.assertIn("r/nba/top?t=day", listings)
        self.assertIn("r/goodburlington/new", listings)
        intake = self.written("reddit-intake.json")
        self.assertEqual(intake["by"], "mac")
        self.assertEqual(set(intake["subs"]), set(ri.LOCAL_SUBS + ri.NATIONAL_SUBS))
        self.assertNotIn("fixture-user", json.dumps(listings) + json.dumps(intake))
        # every Reddit request after the first waited its turn
        self.assertGreaterEqual(len([s for s in self.slept if s > 0]), len(shreddit) - 1)

    def test_next_run_only_asks_for_what_is_due(self):
        self.run_once(FakeWeb(pages=self.pages))
        self.promote()
        fake = FakeWeb(pages=self.pages)
        code, _ = self.run_once(fake, now=NOW + timedelta(minutes=30))
        self.assertEqual(code, 0)
        self.assertEqual(sorted(u.split("community-more-posts/")[1] for u in fake.urls("/svc/shreddit/")),
                         ["new/?name=burlington", "new/?name=vermont"])

    def test_a_failed_listing_keeps_its_last_good_copy(self):
        self.run_once(FakeWeb(pages=self.pages))
        before = self.written("reddit-listings.json")["listings"]["r/burlington/new"]
        self.promote()
        flaky = FakeWeb(pages=self.pages, fail={"name=vermont": urllib.error.URLError("timed out")})
        code, text = self.run_once(flaky, now=NOW + timedelta(minutes=30))
        self.assertEqual(code, 0)
        self.assertIn("r/vermont/new: FAILED", text)
        listings = self.written("reddit-listings.json")["listings"]
        self.assertEqual(listings["r/vermont/new"]["fetched"], NOW.isoformat(timespec="seconds"))
        self.assertNotEqual(listings["r/burlington/new"]["fetched"], before["fetched"])

    def test_blocked_run_writes_nothing(self):
        self.run_once(FakeWeb(pages=self.pages))
        self.promote()
        blocked = FakeWeb(fail={"/svc/shreddit/": http_error("x", 403)})
        os.makedirs(os.path.join(self.tmp.name, "out2"))
        self.out = os.path.join(self.tmp.name, "out2")
        code, text = self.run_once(blocked, now=NOW + timedelta(minutes=30))
        self.assertEqual(code, 3, text)
        self.assertEqual(os.listdir(self.out), [])
        self.assertEqual(len(blocked.urls("/svc/shreddit/")), 1)  # the 403 stopped the run's other reads


if __name__ == "__main__":
    unittest.main()
