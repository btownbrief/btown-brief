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
        self.assertEqual(set(inbox), {"x", "facebook", "recaps"})
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
        self.assertIn("1 to 8", " ".join(wi.check_recaps(data, now)[1][3]))
        self.assertEqual(wi.RECAP_KINDS["pictures"], "Pictures of the day")

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


@unittest.skipUnless(os.path.exists(VALIDATOR), "wire-inbox checkout not on this machine")
class ValidatorParityTests(unittest.TestCase):
    """The port must flag exactly what the inbox's own validator flags."""

    def test_same_problems_as_the_inbox_validator(self):
        spec = importlib.util.spec_from_file_location("validate_inbox", VALIDATOR)
        validator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(validator)
        from pathlib import Path
        now = datetime.now(timezone.utc)
        for name in sorted(os.listdir(FIXTURES)):
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

    def tmp_dir(self):
        import tempfile
        if not hasattr(self, "_tmp"):
            self._tmp = tempfile.TemporaryDirectory()
            self.addCleanup(self._tmp.cleanup)
        return self._tmp.name


if __name__ == "__main__":
    unittest.main()
