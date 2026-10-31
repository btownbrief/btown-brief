"""The Wire's inbox reader against hand-written good, bad and stale files.

Offline: every fetch is a stub, and `now` is pinned to the fixtures' day.
Run: python3 -m unittest discover -s tests -p 'test_wire*.py'
"""

import importlib.util
import json
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import wire_inbox as wi  # noqa: E402

FIXTURES = os.path.join(HERE, "fixtures", "wire")
NOW = datetime(2026, 10, 16, 18, 0, tzinfo=timezone.utc)
# WIRE_INBOX_VALIDATOR points the parity tests at another checkout (a branch
# worktree of the inbox repo) when both sides change together
VALIDATOR = os.environ.get("WIRE_INBOX_VALIDATOR") or \
    os.path.expanduser("~/btownbrief/wire-inbox/scripts/validate_inbox.py")


def raw(name):
    with open(os.path.join(FIXTURES, name), "rb") as src:
        return src.read()


def fetcher(files):
    """files: {inbox path: fixture name or None (404) or an error string}."""
    def fetch(path, token):
        name = files.get(path)
        if name is None:
            return "missing", None
        if name.startswith("error"):
            return name, None
        return "ok", raw(name)
    return fetch


class ReadOneTests(unittest.TestCase):
    def test_good_file_merges_every_post(self):
        state, fresh = wi.read_one("x", raw("x-good.json"), NOW)
        self.assertFalse(state["paused"])
        self.assertIsNone(state["reason"])
        self.assertEqual(len(fresh), 3)
        first = fresh[0]
        self.assertEqual(first["ch"], "x")
        self.assertEqual(first["from"], "@wcax")
        self.assertEqual(first["name"], "WCAX Channel 3")
        self.assertEqual(first["u"], "https://x.com/wcax/status/2110974024322838998")
        self.assertTrue(first["summary"].startswith("Northbound I-89"))   # verbatim
        # X is a guess from the text until tag_wire.py decides: only the
        # post that names a place here (Chittenden County) starts out local
        self.assertEqual([item["local"] for item in fresh], [False, False, True])

    def test_stale_file_pauses_and_merges_nothing(self):
        state, fresh = wi.read_one("x", raw("x-stale.json"), NOW)
        self.assertTrue(state["paused"])
        self.assertIn("22h ago", state["reason"])
        self.assertEqual(fresh, [])
        self.assertEqual(state["updated_at"], "2026-10-15T20:00:00+00:00")

    def test_eighteen_hours_is_the_line(self):
        data = json.loads(raw("x-good.json"))
        data["updated_at"] = (NOW - timedelta(hours=17, minutes=59)).isoformat()
        state, _ = wi.read_one("x", json.dumps(data).encode(), NOW)
        self.assertFalse(state["paused"])
        data["updated_at"] = (NOW - timedelta(hours=18, minutes=1)).isoformat()
        state, _ = wi.read_one("x", json.dumps(data).encode(), NOW)
        self.assertTrue(state["paused"])

    def test_a_write_stamped_in_the_future_pauses(self):
        data = json.loads(raw("x-good.json"))
        data["updated_at"] = (NOW + timedelta(days=3)).isoformat()
        state, fresh = wi.read_one("x", json.dumps(data).encode(), NOW)
        self.assertTrue(state["paused"])
        self.assertIn("in the future", state["reason"])
        data["updated_at"] = (NOW + timedelta(minutes=5)).isoformat()   # ordinary clock skew
        state, _ = wi.read_one("x", json.dumps(data).encode(), NOW)
        self.assertFalse(state["paused"])

    def test_bad_posts_are_dropped_not_the_source(self):
        state, fresh = wi.read_one("facebook", raw("facebook-bad-items.json"), NOW)
        self.assertFalse(state["paused"])
        self.assertEqual(state["dropped"], 2)        # the http link and the phone number
        self.assertEqual([item["u"][-4:] for item in fresh], ["1001", "2004"])
        self.assertTrue(all(item["ch"] == "facebook" for item in fresh))
        self.assertTrue(all(item["local"] is True for item in fresh))   # every group is local

    def test_mostly_bad_file_pauses(self):
        state, fresh = wi.read_one("facebook", raw("facebook-mostly-bad.json"), NOW)
        self.assertTrue(state["paused"])
        self.assertIn("3 of 4 posts", state["reason"])
        self.assertEqual(fresh, [])

    def test_wrong_shape_pauses(self):
        state, fresh = wi.read_one("facebook", raw("facebook-wrong-shape.json"), NOW)
        self.assertTrue(state["paused"])
        self.assertIn("fails the contract", state["reason"])
        self.assertEqual(fresh, [])

    def test_not_json_pauses(self):
        state, _ = wi.read_one("x", b"<html>rate limited</html>", NOW)
        self.assertTrue(state["paused"])
        self.assertIn("not valid JSON", state["reason"])

    def test_file_in_the_wrong_slot_pauses(self):
        state, _ = wi.read_one("facebook", raw("x-good.json"), NOW)
        self.assertTrue(state["paused"])
        self.assertIn("expected 'muse-facebook'", state["reason"])

    def test_future_and_ancient_posts_drop(self):
        data = json.loads(raw("x-good.json"))
        data["items"][0]["posted_at"] = (NOW + timedelta(hours=2)).isoformat()
        state, fresh = wi.read_one("x", json.dumps(data).encode(), NOW)
        self.assertFalse(state["paused"])
        self.assertEqual(state["dropped"], 1)
        self.assertEqual(len(fresh), 2)
        data["items"][1]["posted_at"] = (NOW - timedelta(days=8)).isoformat()
        data["items"][2]["posted_at"] = (NOW - timedelta(days=9)).isoformat()
        state, fresh = wi.read_one("x", json.dumps(data).encode(), NOW)
        self.assertTrue(state["paused"])    # three of three bad is a bad file
        self.assertEqual(fresh, [])

    def test_order_slip_does_not_pause(self):
        data = json.loads(raw("x-good.json"))
        data["items"].reverse()
        state, fresh = wi.read_one("x", json.dumps(data).encode(), NOW)
        self.assertFalse(state["paused"])
        self.assertEqual(len(fresh), 3)


class ReadInboxTests(unittest.TestCase):
    def test_no_token_pauses_both_and_fetches_nothing(self):
        def never(path, token):
            raise AssertionError("must not fetch without a token")
        inbox, added, changed = wi.read_inbox(None, NOW, token="", fetch=never)
        self.assertEqual(set(inbox), {"x", "facebook", "voices", "recaps", "free"})
        for state in inbox.values():
            self.assertTrue(state["paused"])
            self.assertEqual(state["reason"], "no WIRE_INBOX_TOKEN secret")
            self.assertEqual(state["items"], [])
        self.assertEqual(added, 0)
        self.assertTrue(changed)          # first run: the key appears
        again, _, changed = wi.read_inbox(inbox, NOW, token="", fetch=never)
        self.assertFalse(changed)         # still paused: nothing to publish

    def test_missing_file_pauses_that_source_only(self):
        inbox, added, _ = wi.read_inbox(None, NOW, token="t", fetch=fetcher({
            "grok/x.json": "x-good.json"}))
        self.assertFalse(inbox["x"]["paused"])
        self.assertEqual(inbox["x"]["n"], 3)
        self.assertTrue(inbox["facebook"]["paused"])
        self.assertEqual(inbox["facebook"]["reason"], "muse/facebook.json is missing")
        self.assertEqual(added, 3)

    def test_fetch_error_is_a_state(self):
        inbox, _, _ = wi.read_inbox(None, NOW, token="t", fetch=fetcher({
            "grok/x.json": "error: HTTP 401", "muse/facebook.json": "facebook-bad-items.json"}))
        self.assertTrue(inbox["x"]["paused"])
        self.assertIn("HTTP 401", inbox["x"]["reason"])
        self.assertFalse(inbox["facebook"]["paused"])

    def test_rolling_store_keeps_held_posts_through_a_pause(self):
        first, _, _ = wi.read_inbox(None, NOW, token="t", fetch=fetcher({"grok/x.json": "x-good.json"}))
        later = NOW + timedelta(hours=30)
        second, added, changed = wi.read_inbox(first, later, token="t",
                                               fetch=fetcher({"grok/x.json": "x-good.json"}))
        self.assertTrue(second["x"]["paused"])            # the file is 30h old by then
        self.assertEqual(second["x"]["n"], 3)             # the posts it brought stay
        self.assertEqual(added, 0)
        self.assertTrue(changed)                          # the pause flipped on
        week = NOW + timedelta(days=8)
        third, _, _ = wi.read_inbox(second, week, token="")
        self.assertEqual(third["x"]["n"], 0)              # and age out after 7 days

    def test_seen_post_is_not_new_twice(self):
        first, added, _ = wi.read_inbox(None, NOW, token="t", fetch=fetcher({"grok/x.json": "x-good.json"}))
        second, added2, _ = wi.read_inbox(first, NOW, token="t", fetch=fetcher({"grok/x.json": "x-good.json"}))
        self.assertEqual((added, added2), (3, 0))
        self.assertEqual(second["x"]["n"], 3)

    def test_summary_line(self):
        inbox, _, _ = wi.read_inbox(None, NOW, token="t", fetch=fetcher({"grok/x.json": "x-good.json"}))
        line = wi.summary_line(inbox)
        self.assertIn("x ok (3 held)", line)
        self.assertIn("facebook paused", line)

    def test_missing_voices_file_leaves_the_rest_alone(self):
        inbox, added, _ = wi.read_inbox(None, NOW, token="t", fetch=fetcher({
            "grok/x.json": "x-good.json"}))
        self.assertTrue(inbox["voices"]["paused"])
        self.assertEqual(inbox["voices"]["reason"], "grok/voices.json is missing")
        self.assertEqual(inbox["voices"]["items"], [])
        self.assertFalse(inbox["x"]["paused"])
        self.assertEqual(added, 3)


class VoicesTests(unittest.TestCase):
    PIC = "https://pbs.twimg.com/media/HV3T8GnWcAAsOCS"

    def voices(self):
        return json.loads(raw("voices-good.json"))

    def read(self, data):
        return wi.read_one("voices", json.dumps(data).encode(), NOW)

    def test_good_file(self):
        state, fresh = wi.read_one("voices", raw("voices-good.json"), NOW)
        self.assertFalse(state["paused"])
        self.assertEqual(state.get("dropped"), None)
        self.assertEqual(len(fresh), 4)
        self.assertEqual({item["ch"] for item in fresh}, {"voices"})

    def test_own_words_keep_their_hashtags_and_emoji(self):
        _, fresh = wi.read_one("voices", raw("voices-good.json"), NOW)
        self.assertIn("#Vermont", fresh[0]["summary"])
        self.assertTrue(fresh[1]["summary"].startswith("BREAKING"))

    def test_the_x_file_still_refuses_them(self):
        data = self.voices()
        data["source"] = "grok-x"
        _, per_item = wi.check(data, NOW)
        self.assertIn("summary has a hashtag, emoji or BREAKING", per_item[0])

    def test_a_phone_number_still_drops_a_voice(self):
        data = self.voices()
        data["items"][0]["summary"] = "Call the office at 802-555-0142 today"
        state, fresh = self.read(data)
        self.assertEqual(state["dropped"], 1)
        self.assertEqual(len(fresh), 3)

    def test_vermont_voices_are_local_and_the_rest_are_not(self):
        _, fresh = wi.read_one("voices", raw("voices-good.json"), NOW)
        self.assertEqual([item["local"] for item in fresh], [True, False, False, True])

    def test_the_vermont_list_is_for_voices_only(self):
        data = json.loads(raw("x-good.json"))
        data["items"][0]["from"] = "@WVNYWFFF"
        _, fresh = wi.read_one("x", json.dumps(data).encode(), NOW)
        self.assertFalse(fresh[0]["local"])

    def test_a_voices_file_in_the_x_slot_pauses(self):
        state, _ = wi.read_one("x", raw("voices-good.json"), NOW)
        self.assertTrue(state["paused"])
        self.assertIn("expected 'grok-x'", state["reason"])

    def test_a_picture_comes_down_to_the_feed_size(self):
        for given, want in (
                (self.PIC + ".jpg?name=orig", self.PIC + ".jpg?name=small"),
                (self.PIC + "?format=jpg&name=orig", self.PIC + "?format=jpg&name=small"),
                (self.PIC + "?name=orig&format=png", self.PIC + "?name=small&format=png"),
                (self.PIC + ".jpg", self.PIC + ".jpg"),
                ("https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/a.jpg?name=orig",
                 "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/a.jpg?name=orig")):
            self.assertEqual(wi.small_picture(given), want)

    def test_a_bad_picture_loses_the_field_not_the_post(self):
        data = self.voices()
        bad = ["http://pbs.twimg.com/media/a.jpg", "https://example.com/a.jpg",
               "https://pbs.twimg.com.evil.example/a.jpg", "https://pbs.twimg.com/a b",
               "https://pbs.twimg.com/a\n", "https://pbs.twimg.com/" + "a" * 251, 7, {"url": "x"}, ""]
        for value in bad:
            data["items"][0]["media"] = value
            state, fresh = self.read(data)
            self.assertFalse(state["paused"], value)
            self.assertEqual(len(fresh), 4, value)
            self.assertNotIn("media", fresh[0], value)

    def test_no_picture_means_no_key(self):
        _, fresh = wi.read_one("voices", raw("voices-good.json"), NOW)
        self.assertEqual(["media" in item for item in fresh], [True, False, False, False])

    def test_x_posts_carry_pictures_too_and_counts_are_ignored(self):
        data = json.loads(raw("x-good.json"))
        data["counts"] = {"@MyNBC5": {"seen": 16, "saved": 0}}
        data["items"][0]["media"] = self.PIC + "?format=jpg&name=orig"
        state, fresh = wi.read_one("x", json.dumps(data).encode(), NOW)
        self.assertFalse(state["paused"])
        self.assertEqual(fresh[0]["media"], self.PIC + "?format=jpg&name=small")
        self.assertNotIn("counts", state)

    def test_an_account_keeps_four_and_a_rare_poster_keeps_its_place(self):
        data = {"source": "grok-voices", "updated_at": (NOW - timedelta(hours=1)).isoformat(), "items": []}
        for i in range(8):
            data["items"].append({
                "url": f"https://x.com/MikeReiss/status/{i}", "from": "@MikeReiss", "name": "Mike Reiss",
                "summary": f"Practice note {i}", "kind": "post",
                "posted_at": (NOW - timedelta(hours=2 + i)).isoformat(),
                "found_at": (NOW - timedelta(hours=1)).isoformat()})
        data["items"].append({
            "url": "https://x.com/GovPhilScott/status/1", "from": "@GovPhilScott", "name": "Gov. Phil Scott",
            "summary": "A statement on the budget", "kind": "post",
            "posted_at": (NOW - timedelta(days=6)).isoformat(),
            "found_at": (NOW - timedelta(hours=1)).isoformat()})
        files = {"grok/voices.json": json.dumps(data).encode()}
        fetch = lambda path, token: ("ok", files[path]) if path in files else ("missing", None)  # noqa: E731
        inbox, _, _ = wi.read_inbox(None, NOW, token="t", fetch=fetch)
        held = inbox["voices"]["items"]
        self.assertEqual(sum(item["from"] == "@MikeReiss" for item in held), wi.VOICE_KEEP)
        self.assertEqual(held[0]["u"], "https://x.com/MikeReiss/status/0")     # the newest four
        self.assertEqual(held[-1]["from"], "@GovPhilScott")

    def test_a_file_over_the_limit_is_not_new_on_the_next_read(self):
        data = {"source": "grok-voices", "updated_at": (NOW - timedelta(hours=1)).isoformat(), "items": []}
        for i in range(8):
            data["items"].append({
                "url": f"https://x.com/MikeReiss/status/{i + 1}", "from": "@MikeReiss", "name": "Mike Reiss",
                "summary": f"Practice note {i}", "kind": "post",
                "posted_at": (NOW - timedelta(hours=2 + i)).isoformat(),
                "found_at": (NOW - timedelta(hours=1)).isoformat()})
        files = {"grok/voices.json": json.dumps(data).encode()}
        fetch = lambda path, token: ("ok", files[path]) if path in files else ("missing", None)  # noqa: E731
        first, added, _ = wi.read_inbox(None, NOW, token="t", fetch=fetch)
        self.assertEqual(added, wi.VOICE_KEEP)
        second, added, changed = wi.read_inbox(first, NOW + timedelta(minutes=10), token="t", fetch=fetch)
        self.assertEqual(added, 0)
        self.assertFalse(changed)
        data["items"].append(dict(data["items"][0], url="https://x.com/MikeReiss/status/99",
                                  posted_at=(NOW - timedelta(hours=1)).isoformat()))
        files["grok/voices.json"] = json.dumps(data).encode()
        _, added, changed = wi.read_inbox(second, NOW + timedelta(minutes=20), token="t", fetch=fetch)
        self.assertEqual(added, 1)
        self.assertTrue(changed)

    def test_the_x_channel_has_no_per_account_limit(self):
        data = json.loads(raw("x-good.json"))
        for item in data["items"]:
            item["from"] = "@wcax"
        files = {"grok/x.json": json.dumps(data).encode()}
        fetch = lambda path, token: ("ok", files[path]) if path in files else ("missing", None)  # noqa: E731
        inbox, _, _ = wi.read_inbox(None, NOW, token="t", fetch=fetch)
        self.assertEqual(inbox["x"]["n"], 3)

    def test_held_voices_stay_through_a_pause(self):
        files = {"grok/voices.json": "voices-good.json"}
        first, _, _ = wi.read_inbox(None, NOW, token="t", fetch=fetcher(files))
        self.assertEqual(first["voices"]["n"], 4)
        second, _, _ = wi.read_inbox(first, NOW + timedelta(hours=30), token="t", fetch=fetcher(files))
        self.assertTrue(second["voices"]["paused"])
        self.assertEqual(second["voices"]["n"], 4)
        self.assertEqual(second["voices"]["items"][0].get("media"), first["voices"]["items"][0].get("media"))


RECAP_FIXTURES = os.path.join(HERE, "fixtures", "wire-recaps")


def recaps_raw(**over):
    with open(os.path.join(RECAP_FIXTURES, "recaps-good.json"), encoding="utf-8") as src:
        data = json.load(src)
    data.update(over)
    return data


class RecapTests(unittest.TestCase):
    """grok/recaps.json: Grok's packed recaps (2026-10-19)."""

    def read(self, data, now=NOW + timedelta(hours=6)):
        return wi.read_recaps(json.dumps(data).encode(), now)

    def test_good_file_reads_every_good_recap(self):
        state, fresh = self.read(recaps_raw())
        self.assertFalse(state["paused"])
        self.assertEqual([rc["id"] for rc in fresh],
                         ["2026-10-16-evening", "2026-10-16-sports", "2026-10-16-pictures"])
        self.assertEqual(state["dropped"], 1)          # "AI and tech" is not the fixed title
        sports = fresh[1]
        self.assertEqual(sports["title"], "Sports")
        # tennis is a sport now; soccer, from a bot on the older brief, reads as other
        self.assertEqual([bl["sport"] for bl in sports["bullets"]],
                         ["nba", "nfl", "local", "tennis", "other"])
        self.assertEqual(fresh[2]["title"], "Pictures of the day")
        self.assertEqual(sports["bullets"][0]["text"], "Lakers trade for a backup center")  # verbatim
        self.assertEqual(sports["basis"], "accounts")
        self.assertNotIn("sport", fresh[0]["bullets"][0])

    def bad_bullet(self, **bullet):
        data = recaps_raw()
        data["recaps"][0]["bullets"][0].update(bullet)
        _, per = wi.check_recaps(data, NOW + timedelta(hours=6))
        return " ".join(per.get(0, []))

    def test_bullet_rules(self):
        self.assertIn("never a search page", self.bad_bullet(url="https://x.com/search?q=senate"))
        self.assertIn("at most 300", self.bad_bullet(url="https://x.com/a/" + "b" * 300))
        self.assertIn("email or phone", self.bad_bullet(note="Call 802-555-0100 to ask."))
        self.assertIn("hashtag", self.bad_bullet(text="Senate passes #budget"))
        data = recaps_raw()
        data["recaps"][1]["bullets"][0].pop("sport")      # a Sports bullet names its league
        self.assertIn("in a Sports recap", " ".join(wi.check_recaps(data, NOW + timedelta(hours=6))[1][1]))
        self.assertEqual(self.bad_bullet(), "")
        data = recaps_raw()
        data["recaps"][0]["id"] = "2026-10-16-morning"         # an evening recap named morning
        self.assertIn("names another kind", " ".join(wi.check_recaps(data, NOW)[1][0]))
        data["recaps"][0]["id"] = "evening"
        self.assertIn("YYYY-MM-DD", " ".join(wi.check_recaps(data, NOW)[1][0]))
        for rid, want in (("2026-10-15-evening", "Burlington date"), ("2026-10-16-evening-2", "only Breaking"),
                          ("2026-10-16-evening-1", "YYYY-MM-DD")):
            data["recaps"][0]["id"] = rid
            self.assertIn(want, " ".join(wi.check_recaps(data, NOW)[1][0]), rid)
        data = recaps_raw()
        data["recaps"][0].update(id="2026-10-16-breaking-2", kind="breaking", title="Breaking")
        self.assertNotIn(0, wi.check_recaps(data, NOW + timedelta(hours=6))[1])
        data["recaps"][0]["bullets"] *= 3                     # six bullets: Breaking is short
        self.assertIn("1 to 5", " ".join(wi.check_recaps(data, NOW + timedelta(hours=6))[1][0]))

    def test_pictures_are_x_posts_and_few(self):
        now = NOW + timedelta(hours=6)
        data = recaps_raw()
        data["recaps"][3]["bullets"][0]["url"] = "https://www.nasa.gov/image-of-the-day/"
        self.assertIn("the X post itself", " ".join(wi.check_recaps(data, now)[1][3]))
        data = recaps_raw()
        data["recaps"][3]["bullets"][0]["url"] = "https://twitter.com/NWSBurlington/status/1"
        self.assertNotIn(3, wi.check_recaps(data, now)[1])          # twitter.com links are X posts too
        base = data["recaps"][3]["bullets"][0]
        data["recaps"][3]["bullets"] = [dict(base, url=f"https://x.com/a/status/{n}") for n in range(9)]
        self.assertIn("3 to 8", " ".join(wi.check_recaps(data, now)[1][3]))
        data["recaps"][3]["bullets"] = data["recaps"][3]["bullets"][:2]     # two is too few
        self.assertIn("3 to 8", " ".join(wi.check_recaps(data, now)[1][3]))
        self.assertEqual(wi.RECAP_KINDS["pictures"], "Pictures of the day")

    def test_market_recaps(self):
        data = recaps_raw()
        data["recaps"][0].update(id="2026-10-16-market-close", kind="market-close", title="Market close")
        self.assertNotIn(0, wi.check_recaps(data, NOW + timedelta(hours=6))[1])
        data["recaps"][0]["title"] = "Markets & money"
        self.assertIn("must be 'Market close'", " ".join(wi.check_recaps(data, NOW)[1][0]))
        self.assertEqual(wi.RECAP_KINDS["market-open"], "Market open")

    def test_a_stale_or_mostly_bad_file_pauses(self):
        state, fresh = self.read(recaps_raw(), now=NOW + timedelta(hours=24))
        self.assertTrue(state["paused"])
        self.assertIn("19h ago", state["reason"])
        data = recaps_raw()
        for rc in data["recaps"]:
            rc["basis"] = "vibes"
        state, fresh = self.read(data)
        self.assertTrue(state["paused"])
        self.assertEqual(fresh, [])
        state, _ = self.read(recaps_raw(source="grok-x"))
        self.assertIn("fails the contract", state["reason"])

    def test_store_merges_by_id_and_keeps_three_days(self):
        def fetch(path, token):
            if path == wi.RECAP_PATH:
                return "ok", json.dumps(recaps_raw()).encode()
            return "missing", None
        now = NOW + timedelta(hours=6)
        first, added, changed = wi.read_inbox(None, now, token="t", fetch=fetch)
        self.assertEqual((first["recaps"]["n"], added, changed), (3, 3, True))
        second, added, changed = wi.read_inbox(first, now, token="t", fetch=fetch)
        self.assertEqual((second["recaps"]["n"], added, changed), (3, 0, False))
        later, _, _ = wi.read_inbox(second, NOW + timedelta(days=4), token="")
        self.assertEqual(later["recaps"]["n"], 0)       # three days, then gone
        self.assertIn("recaps", wi.summary_line(first))

    def test_store_has_a_byte_ceiling(self):
        big = []
        for n in range(wi.RECAP_MAX):
            posted = NOW - timedelta(minutes=n)
            big.append({"id": f"r-{n:03d}", "kind": "ai", "title": "AI & tech", "d": int(posted.timestamp()),
                        "posted_at": posted.isoformat(), "intro": "x" * 400, "basis": "trending",
                        "bullets": [{"text": "t" * 160, "url": "https://x.com/" + "u" * 280,
                                     "note": "n" * 200}] * 20})
        kept, _ = wi.merge_recaps([], big, NOW)
        self.assertLessEqual(len(json.dumps(kept).encode()), wi.RECAP_STORE_BYTES)
        self.assertEqual(kept[0]["id"], "r-000")          # the newest stay
        again, added = wi.merge_recaps(kept, big, NOW)
        self.assertEqual((again, added), (kept, 0))      # the capped-out ones are not "new" each run


def offer(**over):
    item = {"u": "https://www.facebook.com/groups/123/posts/456/", "title": "Oak dresser, three drawers",
            "where": "Old North End", "group": "Buy Nothing", "kind": "offer",
            "posted_at": (NOW - timedelta(hours=2)).isoformat()}
    item.update(over)
    return item


def free_file(*items, **over):
    data = {"source": "muse-free", "updated_at": (NOW - timedelta(hours=1)).isoformat(),
            "run_note": "2 new", "items": list(items)}
    data.update(over)
    return json.dumps(data).encode()


class FreeTests(unittest.TestCase):
    def fresh(self, *items):
        keep = offer(u="https://www.facebook.com/marketplace/item/1/", title="Box of canning jars")
        pad = offer(u="https://www.facebook.com/marketplace/item/2/", title="Two porch chairs")
        return wi.read_free(free_file(keep, pad, *items), NOW)

    def test_a_good_offer_reads_through(self):
        state, fresh = wi.read_free(free_file(offer(group="Gifting")), NOW)
        self.assertFalse(state["paused"])
        self.assertEqual(state["pause_after_hours"], wi.PAUSE_HOURS)
        self.assertEqual(fresh, [{"u": "https://www.facebook.com/groups/123/posts/456/",
                                  "d": int((NOW - timedelta(hours=2)).timestamp()),
                                  "title": "Oak dresser, three drawers", "where": "Old North End",
                                  "group": "Gifting", "kind": "offer"}])

    def test_only_a_post_of_facebooks_own_is_a_link(self):
        for url in ("http://www.facebook.com/groups/1/posts/2/", "https://www.facebook.com/groups/123/",
                    "https://www.facebook.com/marketplace/burlington/free/", "https://facebook.com.evil.example/groups/1/posts/2/",
                    "https://example.com/groups/1/posts/2/", "https://www.facebook.com/search/top?q=free",
                    "https://www.facebook.com/groups/1/posts/2/ x", "https://www.facebook.com/share/g/abc/",
                    "https://www.facebook.com/share/p/1Ab2/", 7, None):
            state, fresh = self.fresh(offer(u=url))
            self.assertEqual((state.get("dropped"), len(fresh)), (1, 2), url)
        for url in ("https://www.facebook.com/groups/burlingtonfree/permalink/99/", "https://m.facebook.com/marketplace/item/5/",
                    "https://facebook.com/groups/1/posts/2"):
            state, fresh = self.fresh(offer(u=url))
            self.assertEqual(len(fresh), 3, url)

    def test_requests_are_not_offers(self):
        for title in ("ISO a crib", "In search of moving boxes", "Wanted: snow tires", "Looking for a couch",
                      "WTB bike", "Anyone have a spare ladder?", "Does anyone have boxes?", "Need a crib",
                      "In need of a stroller", "Anyone got a bike", "Anybody have a crib?", "Would love a crib",
                      "Request: crib", "Hoping to find a crib"):
            state, fresh = self.fresh(offer(title=title))
            self.assertEqual(state.get("dropped"), 1, title)
        for title in ("Couch looking for a new home", "Couch in need of a new home", "Dresser needs a home",
                      "Couch would love a good home", "Need this gone by Friday"):
            _, fresh = self.fresh(offer(title=title))
            self.assertEqual(len(fresh), 3, title)
        state, _ = self.fresh(offer(kind="post"))
        self.assertEqual(state.get("dropped"), 1)

    def test_people_and_contacts_never_get_through(self):
        for title in ("Crib from Sarah Jones", "Text Mike for the couch", "Sarah's bookshelf", "Couch at 12 Main St",
                      "Couch, call 802-555-0134", "Couch, hello@example.com", "Coach Miller's old skis",
                      "Crib from Charlotte Smith", "Ask for Charlotte", "Charlotte's crib", "Ethan Allen Jones",
                      "Ralph Lauren Smith", "couch from sarah", "text sarah", "Smith family crib", "Curb at 12 Pine",
                      "Apt 3, 90 College", "jane at gmail dot com"):
            state, fresh = self.fresh(offer(title=title))
            self.assertEqual(state.get("dropped"), 1, title)
        for where in ("44 Elm Street", "Pearl Street", "North Avenue", "Church St."):
            state, _ = self.fresh(offer(where=where))
            self.assertEqual(state.get("dropped"), 1, where)

    def test_a_brand_or_a_town_is_not_a_person(self):
        for title in ("Ethan Allen dresser", "Ashley Furniture recliner", "Harry Potter books", "Mr Coffee maker",
                      "Jack Daniels sign", "Tommy Hilfiger coat", "Mark Twain books", "Kelly Moore paint", "Tiffany Lamp",
                      "Mason Jars, about 40", "Couch in Charlotte", "Large family tent", "Pickup at 5 Monday"):
            _, fresh = self.fresh(offer(title=title))
            self.assertEqual(len(fresh), 3, title)
        for where in ("Charlotte", "Charlotte VT", "Ethan Allen Park", "South Burlington", "Saint Michael's", "Old North End"):
            _, fresh = self.fresh(offer(where=where))
            self.assertEqual(len(fresh), 3, where)

    def test_lines_stay_short_and_plain(self):
        for bad in (offer(title="x" * 71), offer(title="Free couch #free"), offer(where="x" * 41),
                    offer(where=""), offer(group="Free Stuff")):
            state, _ = self.fresh(bad)
            self.assertEqual(state.get("dropped"), 1, bad)

    def test_five_days_and_no_later(self):
        state, fresh = self.fresh(offer(posted_at=(NOW - timedelta(days=5, minutes=1)).isoformat()))
        self.assertEqual((state.get("dropped"), len(fresh)), (1, 2))
        _, fresh = self.fresh(offer(posted_at=(NOW - timedelta(days=4, hours=23)).isoformat()))
        self.assertEqual(len(fresh), 3)
        state, _ = self.fresh(offer(posted_at=(NOW + timedelta(hours=1)).isoformat()))
        self.assertEqual(state.get("dropped"), 1)

    def test_a_photo_is_facebooks_or_it_goes(self):
        good = "https://scontent-bos5-1.xx.fbcdn.net/v/t45/1.jpg?oe=abc"
        _, fresh = wi.read_free(free_file(offer(photo=good)), NOW)
        self.assertEqual(fresh[0]["photo"], good)
        for bad in ("http://scontent.xx.fbcdn.net/a.jpg", "https://example.com/a.jpg", "https://fbcdn.net.evil.example/a.jpg", 7, ""):
            state, fresh = wi.read_free(free_file(offer(photo=bad)), NOW)
            self.assertFalse(state["paused"])
            self.assertEqual(len(fresh), 1)
            self.assertNotIn("photo", fresh[0])

    def test_tracking_is_cut_and_a_repeat_is_one_offer(self):
        url = "https://www.facebook.com/marketplace/item/77/"
        _, fresh = wi.read_free(free_file(offer(u=url + "?ref=search"), offer(u=url + "?ref=feed")), NOW)
        kept, added = wi.merge_free(None, fresh, NOW, True)
        self.assertEqual(([item["u"] for item in kept], added), ([url], 1))

    def test_one_listing_is_one_offer_however_facebook_spells_it(self):
        url = "https://www.facebook.com/marketplace/item/77/"
        _, fresh = wi.read_free(free_file(*[offer(u=u) for u in (
            url, "https://m.facebook.com/marketplace/item/77", "https://web.facebook.com/marketplace/item/77/?ref=x",
            "https://facebook.com/marketplace/item/77")]), NOW)
        kept, added = wi.merge_free(None, fresh, NOW, True)
        self.assertEqual(([item["u"] for item in kept], added), ([url], 1))

    def test_a_stale_or_broken_file_pauses_and_keeps_what_is_held(self):
        stale = free_file(offer(), updated_at=(NOW - timedelta(hours=19)).isoformat())
        state, fresh = wi.read_free(stale, NOW)
        self.assertTrue(state["paused"])
        self.assertIn("19h ago", state["reason"])
        self.assertEqual(fresh, [])
        for raw_file in (b"{not json", free_file(source="muse-facebook"), free_file(items="none"),
                         free_file(offer(group="x"), offer(group="y"), offer())):
            state, fresh = wi.read_free(raw_file, NOW)
            self.assertTrue(state["paused"], raw_file)
            self.assertEqual(fresh, [])
        held = [{"u": "a", "d": int((NOW - timedelta(hours=3)).timestamp())},
                {"u": "b", "d": int((NOW - timedelta(days=6)).timestamp())}]
        kept, added = wi.merge_free(held, [], NOW, False)
        self.assertEqual(([item["u"] for item in kept], added), (["a"], 0))

    def test_while_muse_writes_its_file_is_the_truth(self):
        _, fresh = wi.read_free(free_file(offer()), NOW)
        held = [{"u": "taken", "d": int((NOW - timedelta(hours=3)).timestamp())}]
        kept, added = wi.merge_free(held, fresh, NOW, True)
        self.assertEqual((len(kept), added), (1, 1))
        self.assertNotEqual(kept[0]["u"], "taken")

    def test_the_store_is_newest_first_and_capped(self):
        offers = [{"u": str(i), "d": int((NOW - timedelta(minutes=i)).timestamp())} for i in range(wi.FREE_CAP + 5)]
        kept, _ = wi.merge_free(None, list(reversed(offers)), NOW, True)
        self.assertEqual(len(kept), wi.FREE_CAP)
        self.assertEqual(kept[0]["u"], "0")

    def test_read_inbox_carries_it_and_a_missing_file_changes_nothing(self):
        files = {"muse/free.json": free_file(offer())}
        fetch = lambda path, token: ("ok", files[path]) if path in files else ("missing", None)  # noqa: E731
        inbox, added, changed = wi.read_inbox(None, NOW, token="t", fetch=fetch)
        self.assertEqual((inbox["free"]["n"], added, inbox["free"]["paused"]), (1, 1, False))
        self.assertTrue(changed)
        again, added, changed = wi.read_inbox(inbox, NOW + timedelta(minutes=10), token="t", fetch=fetch)
        self.assertEqual((added, changed), (0, False))
        files["muse/free.json"] = free_file()      # taken: its leaving is worth a publish
        _, added, changed = wi.read_inbox(again, NOW + timedelta(minutes=20), token="t", fetch=fetch)
        self.assertEqual((added, changed), (0, True))
        files.clear()
        inbox, _, _ = wi.read_inbox(None, NOW, token="t", fetch=fetch)
        self.assertEqual(inbox["free"]["reason"], "muse/free.json is missing")
        self.assertEqual(inbox["free"]["items"], [])
        settled, _, changed = wi.read_inbox(inbox, NOW + timedelta(minutes=10), token="t", fetch=fetch)
        self.assertFalse(changed)

    def test_no_token_pauses_it(self):
        inbox, _, _ = wi.read_inbox(None, NOW, token="")
        self.assertIn("no WIRE_INBOX_TOKEN", inbox["free"]["reason"])

    def test_the_summary_line_says_how_it_stands(self):
        inbox, _, _ = wi.read_inbox(None, NOW, token="")
        self.assertIn("free paused", wi.summary_line(inbox))


@unittest.skipUnless(os.path.exists(VALIDATOR), "wire-inbox checkout not on this machine")
class ValidatorParityTests(unittest.TestCase):
    """The port must flag exactly what the inbox's own validator flags."""

    def test_same_problems_as_the_inbox_validator(self):
        spec = importlib.util.spec_from_file_location("validate_inbox", VALIDATOR)
        validator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(validator)
        from pathlib import Path
        now = datetime.now(timezone.utc)
        with open(VALIDATOR, encoding="utf-8") as src:
            knows_voices = "grok-voices" in src.read()
        for name in sorted(os.listdir(FIXTURES)):
            if name.startswith("voices") and not knows_voices:
                continue        # this wire-inbox checkout predates grok/voices.json
            theirs = set(validator.check(Path(FIXTURES, name)))
            file_level, per_item = wi.check(json.loads(raw(name)), now)
            ours = set(file_level)
            for index, problems in per_item.items():
                ours.update(f"items[{index}]: {problem}" for problem in problems)
            # wording of two file-level messages differs; compare the rule hit
            norm = lambda s: s.split(",")[0].split(" like ")[0]  # noqa: E731
            self.assertEqual({norm(p) for p in ours}, {norm(p) for p in theirs}, name)


    def test_recaps_same_problems_as_the_inbox_validator(self):
        with open(VALIDATOR, encoding="utf-8") as src:
            if "grok-recaps" not in src.read():
                self.skipTest("this wire-inbox checkout predates grok/recaps.json")
        spec = importlib.util.spec_from_file_location("validate_inbox", VALIDATOR)
        validator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(validator)
        from pathlib import Path
        now = datetime.now(timezone.utc)
        for name in sorted(os.listdir(RECAP_FIXTURES)):
            data = json.loads(Path(RECAP_FIXTURES, name).read_text(encoding="utf-8"))
            # re-date the fixture to now, so age never decides the comparison
            for rc in data["recaps"]:
                rc["posted_at"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
            data["updated_at"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
            path = Path(self.tmp_dir(), name)
            path.write_text(json.dumps(data), encoding="utf-8")
            theirs = set(validator.check(path))
            file_level, per = wi.check_recaps(data, now)
            ours = set(file_level) | {f"recaps[{i}]: {p}" for i, ps in per.items() for p in ps}
            self.assertEqual(ours, theirs, name)

    def test_free_same_problems_as_the_inbox_validator(self):
        with open(VALIDATOR, encoding="utf-8") as src:
            if "muse-free" not in src.read():
                self.skipTest("this wire-inbox checkout predates muse/free.json")
        spec = importlib.util.spec_from_file_location("validate_inbox", VALIDATOR)
        validator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(validator)
        from pathlib import Path
        now = datetime.now(timezone.utc)
        stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
        offers = [offer(posted_at=stamp, u=f"https://www.facebook.com/marketplace/item/{i}/", title=title, where=where)
                  for i, (title, where) in enumerate((
                      ("Oak dresser", "Winooski"), ("ISO a crib", "Essex"), ("Crib from Sarah Jones", "Essex"),
                      ("Ethan Allen sofa", "Charlotte"), ("Sarah's desk", "Essex"), ("Couch at 12 Main St", "Essex"),
                      ("Couch, call 802-555-0134", "Essex"), ("Text Mike for the couch", "Essex"),
                      ("Couch looking for a new home", "Ethan Allen Park"), ("Skis", "44 Elm Street"),
                      ("Coach Miller's old skis", "Essex"), ("Free couch #free", "Essex"), ("x" * 71, "Essex"),
                      ("Crib from Charlotte Smith", "Essex"), ("Ask for Charlotte", "Essex"), ("Charlotte's crib", "Essex"),
                      ("Ethan Allen Jones", "Essex"), ("Ralph Lauren Smith", "Essex"), ("Curb at 12 Pine", "Essex"),
                      ("Apt 3, 90 College", "Essex"), ("jane at gmail dot com", "Essex"), ("couch from sarah", "Essex"),
                      ("text sarah", "Essex"), ("Smith family crib", "Essex"), ("Need a crib", "Essex"),
                      ("In need of a stroller", "Essex"), ("Anybody have a crib?", "Essex"), ("Request: crib", "Essex"),
                      ("Would love a crib", "Essex"), ("Hoping to find a crib", "Essex"), ("Need this gone", "Essex"),
                      ("Tiffany Lamp", "Saint Michael's"), ("Mason Jars, about 40", "Charlotte VT"), ("Skis", "Pearl Street"),
                      ("Jack Daniels sign", "North Avenue"), ("Tommy Hilfiger coat", "Essex")))]
        offers += [offer(posted_at=stamp, group="Other"), offer(posted_at=stamp, kind="post", u=offers[0]["u"]),
                   offer(posted_at=stamp, u="https://www.facebook.com/groups/123/"),
                   offer(posted_at=stamp, u="https://www.facebook.com/share/g/abc/"),
                   offer(posted_at=(now - timedelta(days=6)).strftime("%Y-%m-%dT%H:%M:%SZ"))]
        for data in (json.loads(free_file(*offers, updated_at=stamp)), json.loads(free_file(updated_at="soon", items="x")),
                     json.loads(free_file(updated_at=stamp, run_note="a\nb"))):
            path = Path(self.tmp_dir(), "free.json")
            path.write_text(json.dumps(data), encoding="utf-8")
            theirs = set(validator.check(path))
            file_level, per = wi.check_free(data, now)
            ours = set(file_level) | {f"items[{i}]: {p}" for i, ps in per.items() for p in ps}
            self.assertEqual(ours, theirs)

    def tmp_dir(self):
        import tempfile
        if not hasattr(self, "_tmp"):
            self._tmp = tempfile.TemporaryDirectory()
            self.addCleanup(self._tmp.cleanup)
        return self._tmp.name


if __name__ == "__main__":
    unittest.main()
