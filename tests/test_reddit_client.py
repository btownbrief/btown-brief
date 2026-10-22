"""Offline tests for scripts/reddit_client.py, the one door every script uses
to read Reddit. urlopen is patched to fail loudly, so any accidental network
call breaks the test.

Run: python3 -m unittest tests.test_reddit_client
"""

import io
import json
import os
import sys
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
sys.path.insert(0, ROOT)

import reddit_client as rc  # noqa: E402
import reddit_intake as ri  # noqa: E402

FIXTURES = os.path.join(HERE, "fixtures", "reddit")
NOW = datetime(2026, 10, 4, 20, 0, tzinfo=timezone.utc)
SECRET_ID = "cid-SEEKRIT-9f8e7d"
SECRET = "sec-SEEKRIT-0a1b2c3d"
TOKEN = "tok-SEEKRIT-445566"
CREDS = {"REDDIT_CLIENT_ID": SECRET_ID, "REDDIT_CLIENT_SECRET": SECRET}
LISTING = {"kind": "Listing", "data": {"children": [
    {"kind": "t3", "data": {"id": "abc12", "title": "Snow on Mansfield", "permalink": "/r/vermont/comments/abc12/snow/",
                            "created_utc": 1791000000, "score": 40, "num_comments": 7, "is_self": True}}]}}
ATOM = (b'<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>'
        b'<title>Snow on Mansfield</title><link href="https://www.reddit.com/r/vermont/comments/abc12/snow/"/>'
        b'<published>2026-10-04T18:00:00+00:00</published></entry></feed>')


def no_network(*_args, **_kwargs):
    raise AssertionError("a test tried to reach the network")


def http_error(url, code, headers=None):
    return urllib.error.HTTPError(url, code, "nope", headers or {}, io.BytesIO())


class FakeReddit:
    """Answers the token, OAuth and RSS URLs; records every call. `script`
    maps a route ("token", "oauth", "rss") to a list of canned answers (an
    Exception is raised, anything else returned), consumed in order."""

    def __init__(self, script=None, token_reply=None):
        self.calls = []
        self.script = {k: list(v) for k, v in (script or {}).items()}
        self.token_reply = token_reply or {"access_token": TOKEN, "token_type": "bearer", "expires_in": 86400}

    def __call__(self, url, headers=None, data=None):
        self.calls.append({"url": url, "headers": dict(headers or {}), "data": data})
        route = ("token" if url == rc.TOKEN_URL else "oauth" if url.startswith(rc.OAUTH_BASE + "/")
                 else "rss" if url.startswith(rc.RSS_BASE + "/") and ".rss" in url else None)
        if route is None:
            raise AssertionError("unexpected URL " + url)
        answers = self.script.get(route)
        if answers:
            answer = answers.pop(0)
            if isinstance(answer, Exception):
                raise answer
            return answer
        if route == "token":
            return json.dumps(self.token_reply).encode()
        if route == "oauth":
            return json.dumps(LISTING).encode(), {"x-ratelimit-remaining": "99", "x-ratelimit-reset": "300"}
        return ATOM

    def urls(self):
        return [c["url"] for c in self.calls]


class Offline(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("urllib.request.urlopen", side_effect=no_network)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.slept = []

    def client(self, env=None, fetch=None, clock=None, max_wait=rc.MAX_WAIT):
        return rc.Client(env=CREDS if env is None else env, fetch=fetch or FakeReddit(),
                         sleep=self.slept.append, clock=clock or (lambda: 1000.0), max_wait=max_wait)


class TokenTests(Offline):
    def test_token_is_app_only_client_credentials_with_basic_auth(self):
        fake = FakeReddit()
        client = self.client(fetch=fake)
        self.assertEqual(client.token(), TOKEN)
        call = fake.calls[0]
        self.assertEqual(call["url"], "https://www.reddit.com/api/v1/access_token")
        self.assertEqual(call["data"], b"grant_type=client_credentials")
        self.assertTrue(call["headers"]["Authorization"].startswith("Basic "))
        self.assertEqual(call["headers"]["User-Agent"], rc.DEFAULT_UA)

    def test_token_cached_until_it_nearly_expires(self):
        now = [1000.0]
        fake = FakeReddit(token_reply={"access_token": TOKEN, "expires_in": 3600})
        client = self.client(fetch=fake, clock=lambda: now[0])
        client.oauth_json("r/vermont/new", limit=5)
        client.oauth_json("r/burlington/new", limit=5)
        self.assertEqual(fake.urls().count(rc.TOKEN_URL), 1)
        now[0] += 3600 - rc.TOKEN_SLACK + 1
        client.oauth_json("r/vermont/new", limit=5)
        self.assertEqual(fake.urls().count(rc.TOKEN_URL), 2)

    def test_oauth_call_carries_bearer_token_and_raw_json(self):
        fake = FakeReddit()
        route, data = self.client(fetch=fake).read("r/nba/top", t="day", limit=30)
        self.assertEqual(route, "oauth")
        self.assertEqual(data, LISTING)
        call = fake.calls[-1]
        self.assertEqual(call["url"], "https://oauth.reddit.com/r/nba/top?t=day&limit=30&raw_json=1")
        self.assertEqual(call["headers"]["Authorization"], "bearer " + TOKEN)

    def test_user_agent_override(self):
        fake = FakeReddit()
        ua = "script:btownbrief-allday:1.1 (by /u/example)"
        self.client(env=dict(CREDS, REDDIT_USER_AGENT=ua), fetch=fake).read("r/vermont/new")
        self.assertEqual({c["headers"]["User-Agent"] for c in fake.calls}, {ua})

    def test_token_reply_without_access_token_is_an_error(self):
        client = self.client(fetch=FakeReddit(token_reply={"error": "invalid_grant"}))
        with self.assertRaises(rc.RedditError) as caught:
            client.token()
        self.assertIn("invalid_grant", str(caught.exception))


class FallbackTests(Offline):
    def test_no_keys_means_rss_and_no_token_request(self):
        fake = FakeReddit()
        client = self.client(env={}, fetch=fake)
        self.assertFalse(client.oauth)
        route, data = client.read("r/burlington/new", limit=100)
        self.assertEqual((route, data), ("rss", ATOM))
        self.assertEqual(fake.urls(), ["https://www.reddit.com/r/burlington/new/.rss?limit=100"])
        self.assertEqual(fake.calls[0]["headers"]["User-Agent"], rc.DEFAULT_UA)

    def test_blank_secrets_from_actions_count_as_absent(self):
        # ${{ secrets.X }} is an empty string when the secret doesn't exist
        client = self.client(env={"REDDIT_CLIENT_ID": "", "REDDIT_CLIENT_SECRET": " ", "REDDIT_USER_AGENT": ""})
        self.assertFalse(client.oauth)
        self.assertIsNone(client.token())
        self.assertEqual(client.ua, rc.DEFAULT_UA)

    def test_oauth_failure_falls_back_to_rss(self):
        fake = FakeReddit(script={"oauth": [http_error("x", 503)]})
        route, data = self.client(fetch=fake).read("r/vermont/new", limit=10)
        self.assertEqual((route, data), ("rss", ATOM))

    def test_token_failure_falls_back_to_rss(self):
        fake = FakeReddit(script={"token": [http_error(rc.TOKEN_URL, 401)]})
        route, _ = self.client(fetch=fake).read("r/vermont/new")
        self.assertEqual(route, "rss")

    def test_both_routes_down_raises_the_oauth_error(self):
        fake = FakeReddit(script={"oauth": [http_error("x", 503)], "rss": [http_error("y", 403)]})
        with self.assertRaises(rc.RedditError) as caught:
            self.client(fetch=fake).read("r/vermont/new")
        self.assertEqual(str(caught.exception), "HTTP 503")

    def test_search_uses_the_search_feed(self):
        fake = FakeReddit()
        self.client(env={}, fetch=fake).read("search", q="lake champlain", sort="top", t="month", limit=8)
        self.assertEqual(fake.urls(), ["https://www.reddit.com/search.rss?q=lake+champlain&sort=top&t=month&limit=8"])


class RateLimitTests(Offline):
    def test_short_429_is_retried_once_after_waiting(self):
        fake = FakeReddit(script={"rss": [http_error("x", 429, {"Retry-After": "7"})]})
        route, data = self.client(env={}, fetch=fake).read("r/vermont/new")
        self.assertEqual((route, data), ("rss", ATOM))
        self.assertEqual(self.slept, [8])
        self.assertEqual(len(fake.calls), 2)

    def test_long_429_raises_without_sleeping(self):
        fake = FakeReddit(script={"rss": [http_error("x", 429, {"x-ratelimit-reset": "600"})]})
        with self.assertRaises(rc.RateLimited) as caught:
            self.client(env={}, fetch=fake).read("r/vermont/new")
        self.assertEqual(caught.exception.retry_after, 600)
        self.assertEqual(self.slept, [])

    def test_second_429_gives_up(self):
        fake = FakeReddit(script={"rss": [http_error("x", 429, {"Retry-After": "2"})] * 2})
        with self.assertRaises(rc.RateLimited):
            self.client(env={}, fetch=fake).read("r/vermont/new")
        self.assertEqual(len([u for u in fake.urls() if ".rss" in u]), 2)
        self.assertFalse([u for u in fake.urls() if "/svc/shreddit/" in u])  # a 429 stops www.reddit.com

    def test_spent_window_is_waited_out_before_the_next_call(self):
        spent = (ATOM, {"x-ratelimit-remaining": "0.0", "x-ratelimit-reset": "28"})
        fake = FakeReddit(script={"rss": [spent]})
        client = self.client(env={}, fetch=fake)
        client.rss("r/burlington/new")
        client.rss("r/vermont/new")
        self.assertEqual(self.slept, [29.0])

    def test_spent_window_too_long_to_wait_raises_without_calling(self):
        spent = (json.dumps(LISTING).encode(), {"x-ratelimit-remaining": "0", "x-ratelimit-reset": "500"})
        fake = FakeReddit(script={"oauth": [spent]})
        client = self.client(fetch=fake)
        client.oauth_json("r/burlington/new")
        calls = len(fake.calls)
        with self.assertRaises(rc.RateLimited):
            client.oauth_json("r/vermont/new")
        self.assertEqual(len(fake.calls), calls)


class KeepsLastGoodTests(Offline):
    def test_intake_keeps_its_store_through_a_429(self):
        good = ri.refresh({}, fetch=ri.fixture_fetch(FIXTURES), env={"REDDIT_CLIENT_ID": "x", "REDDIT_CLIENT_SECRET": "y"},
                          now=NOW, sleep=lambda _s: None)
        self.assertTrue(good["posts"])

        def limited(url, headers=None, data=None):
            raise http_error(url, 429, {"Retry-After": "900"})
        later = ri.refresh(good, fetch=limited, env={"REDDIT_CLIENT_ID": "x", "REDDIT_CLIENT_SECRET": "y"},
                           now=NOW.replace(hour=21), sleep=lambda _s: None)
        self.assertEqual({p["id"] for p in later["posts"]}, {p["id"] for p in good["posts"]})
        self.assertEqual(later["routes"]["rss"]["r/burlington"]["status"], "error")
        self.assertTrue(later["routes"]["oauth"]["r/burlington"]["error"].startswith("token: HTTP 429"))

    def test_chatter_falls_back_to_inoreader_on_429(self):
        from scripts.changes.sources import chatter
        fake = FakeReddit(script={"oauth": [http_error("x", 429, {"Retry-After": "900"})]})
        inoreader = ('<rss><channel><item><title>Lost cat on North Ave</title>'
                     '<link>https://www.reddit.com/r/burlington/comments/zz9/lost_cat/</link>'
                     '<pubDate>Sun, 04 Oct 2026 18:00:00 GMT</pubDate></item></channel></rss>').encode()
        with mock.patch.object(chatter, "get", return_value=inoreader):
            snap = chatter.snapshot(client=self.client(fetch=fake))
        self.assertEqual([p["id"] for p in snap["posts"]], ["zz9"])
        self.assertIsNone(snap["posts"][0]["score"])

    def test_chatter_uses_oauth_scores_when_keys_exist(self):
        from scripts.changes.sources import chatter
        fake = FakeReddit()
        with mock.patch.object(chatter, "get", side_effect=AssertionError("Inoreader not needed")):
            snap = chatter.snapshot(client=self.client(fetch=fake))
        self.assertEqual(snap["posts"][0]["score"], 40)
        self.assertIn("https://oauth.reddit.com/r/burlington/hot?limit=25&raw_json=1", fake.urls())

    def test_goodburlington_refresh_keeps_file_when_every_route_fails(self):
        import refresh_goodburlington as rg
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "reddit.json")
            with open(out, "w") as fh:
                json.dump({"updated": "before", "posts": [{"title": "kept"}]}, fh)
            limited = FakeReddit(script={"token": [http_error(rc.TOKEN_URL, 429, {"Retry-After": "900"})]})
            client = self.client(fetch=limited)
            with mock.patch.object(rg, "OUT", out), mock.patch.object(rg, "fetch_bytes", side_effect=OSError("down")), \
                    mock.patch.object(rg.reddit_client, "Client", return_value=client), redirect_stdout(io.StringIO()), \
                    redirect_stderr(io.StringIO()):
                rg.run()
            with open(out) as fh:
                self.assertEqual(json.load(fh)["updated"], "before")


class SecretsNeverLeakTests(Offline):
    def assert_clean(self, text):
        for secret in (SECRET_ID, SECRET, TOKEN):
            self.assertNotIn(secret, text)

    def test_error_text_echoing_secrets_is_redacted(self):
        boom = urllib.error.URLError(f"proxy said no to {SECRET_ID}:{SECRET} and {TOKEN}")
        fake = FakeReddit(script={"oauth": [boom], "rss": [http_error("y", 403)]})
        with self.assertRaises(rc.RedditError) as caught:
            self.client(fetch=fake).read("r/vermont/new")
        self.assert_clean(str(caught.exception))
        self.assertIn("[redacted]", str(caught.exception))

    def test_intake_cli_output_and_file_hold_no_secret(self):
        def leaky(url, headers=None, data=None):
            if url == rc.TOKEN_URL:
                return json.dumps({"access_token": TOKEN, "expires_in": 3600}).encode()
            # a hostile proxy that echoes back the headers it was sent
            raise urllib.error.URLError(f"bad gateway, sent {headers} for {url}")
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "intake.json")
            stdout, stderr = io.StringIO(), io.StringIO()
            with mock.patch.dict(os.environ, CREDS), mock.patch.object(ri, "http_fetch", leaky), \
                    mock.patch.object(rc, "http_fetch", leaky), redirect_stdout(stdout), redirect_stderr(stderr):
                ri.main(["--store", os.path.join(tmp, "none.json"), "--out", out, "--routes", "rss,oauth"])
            with open(out) as fh:
                written = fh.read()
        self.assert_clean(stdout.getvalue() + stderr.getvalue() + written)
        self.assertIn("[redacted]", written)


if __name__ == "__main__":
    unittest.main()
