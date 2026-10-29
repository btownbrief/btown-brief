"""build_instagram.py: reels keep a playable video, food handles are tagged.

The fixture is a real ScrapeCreators answer for @foambrewers (2026-10-16),
trimmed to the fields the builder reads: a reel, a photo and a carousel.
Nothing here touches the network; the clock is pinned to the fetch.

Run: python3 -m unittest tests.test_build_instagram
"""

import json
import os
from datetime import datetime
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import build_instagram as bi  # noqa: E402
import wire_common as wc  # noqa: E402

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


def roster_file(tmp, accounts, **extra):
    p = Path(tmp) / "roster.json"
    p.write_text(json.dumps(dict(extra, accounts=accounts)))
    return p


def at(y, m, d, hour=7):
    """An epoch second at a Burlington wall-clock time."""
    return datetime(y, m, d, hour, tzinfo=bi.TZ).timestamp()


class Roster(unittest.TestCase):
    def test_the_real_roster_is_clean(self):
        doc = json.loads(bi.ROSTER.read_text(encoding="utf-8"))
        raw = doc["accounts"]
        with mock.patch.object(bi, "log") as log:
            accts = bi.load_roster()
        log.assert_not_called()                       # no dupes, no bad tier or category
        self.assertEqual(len(accts), len(raw))
        for a in raw:
            self.assertIn(a["tier"], bi.TIERS, a)
            self.assertIn(a["category"], bi.CATEGORIES, a)

    def test_food_tab_handles_keep_their_food_flag(self):
        """The 23 handles the old `food` tag carried still post with f: 1
        (the Vermont politics podcast with a creemee in its name does not)."""
        food = {a["h"] for a in bi.load_roster() if a["food"]}
        for h in ("foambrewers", "maydayvt", "waterworksvt", "queencitybrewery", "burlingtonbeerco",
                  "peopleskitchenvt", "bar_renee_vt", "frankiesvt", "haymakerbunsbtv", "augustfirstvt",
                  "twobrotherstavern", "sisters_of_anarchy_ice_cream", "spotonthedock", "btvwinefood",
                  "onecommunitydinner", "winooskifarmersmarket", "shelburnefarmersmarket",
                  "vergennesfarmersmarketvt", "eatvermont", "sippinfoodie", "vtcreemeepassport",
                  "creemeechronicles", "802vegan"):
            self.assertIn(h, food)
        self.assertNotIn("theresnoaincreemee", food)

    def test_vintage_shops_are_rostered_as_shops(self):
        cat = {a["h"]: a["category"] for a in bi.load_roster()}
        shops = json.loads((bi.ROOT / "data" / "vintage-shops.json").read_text(encoding="utf-8"))
        for h in ("burlingtonvintagemarket", "shakursvintage", "stay.gold.vintage", "theexchangevt"):
            self.assertEqual(cat.get(h), "shop", h)
        self.assertTrue(shops)

    def test_every_vintage_shop_is_checked_daily(self):
        shops = [a for a in bi.load_roster() if a["category"] == "shop"]
        self.assertGreaterEqual(len(shops), 20)
        self.assertEqual({a["tier"] for a in shops}, {2}, [a["h"] for a in shops if a["tier"] != 2])

    def test_the_busiest_restaurants_are_checked_daily(self):
        tier = {a["h"]: a["tier"] for a in bi.load_roster()}
        for h in ("shelburnefarmersmarket", "windjammervt", "haymakerbunsbtv", "sippinfoodie",
                  "eatvermont", "skinnypancake", "poppy.cafe", "burlsdowntown"):
            self.assertEqual(tier[h], 2, h)
        self.assertEqual(sum(1 for a in bi.load_roster() if a["category"] == "food" and a["tier"] == 2), 20)

    def test_bad_values_fail_cheap(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = roster_file(tmp, [
                {"h": "@A", "tier": 1, "category": "food"},
                {"h": "a", "tier": 1, "category": "venue"},        # duplicate: first wins
                {"h": "b", "tier": 0, "category": "food"},         # bad tier -> 3
                {"h": "c", "tier": True, "category": "food"},      # a bool is not a tier
                {"h": "d", "tier": "1", "category": "nope"},       # string tier -> 3, bad category -> other
                {"h": "bad handle!", "tier": 1, "category": "food"},
                {"h": "e", "tier": 2, "category": "venue", "food": True, "s": "see"},
            ])
            with mock.patch.object(bi, "log"):
                got = {a["h"]: a for a in bi.load_roster(p)}
        self.assertEqual(sorted(got), ["a", "b", "c", "d", "e"])
        self.assertEqual((got["a"]["tier"], got["a"]["category"], got["a"]["food"]), (1, "food", True))
        self.assertEqual([got[h]["tier"] for h in "bcd"], [3, 3, 3])
        self.assertEqual(got["d"]["category"], "other")
        self.assertEqual((got["e"]["food"], got["e"]["s"]), (True, "see"))


def accts(n1, n2, n3):
    out = []
    for tier, n in ((1, n1), (2, n2), (3, n3)):
        out += [{"h": f"t{tier}_{i:03d}", "tier": tier, "category": "other", "s": "do", "food": False}
                for i in range(n)]
    return out


class Budget(unittest.TestCase):
    def test_daily_shares_never_add_past_the_budget(self):
        for month in range(1, 13):
            day = datetime(2026, month, 1).date()
            n = bi.days_in_month(day)
            self.assertLessEqual(bi.share_through(day, 5280, n), 5280)
            self.assertEqual(bi.share_through(day, 5280, n), 5280)
            self.assertEqual(bi.share_through(day, 5280, 0), 0)
        self.assertEqual(bi.days_in_month(datetime(2028, 2, 10).date()), 29)

    def test_a_missing_ledger_fails_closed_for_the_day(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(bi, "log"):
            now = at(2026, 10, 17)
            led, ok = bi.load_ledger(Path(tmp) / "none.json", now, 5280)
            self.assertFalse(ok)
            self.assertEqual(bi.allowance(led, now, 5280), 0)
            self.assertEqual(bi.allowance(led, at(2026, 10, 18), 5280), (5280 * 18) // 31 - (5280 * 17) // 31)
            bad = Path(tmp) / "bad.json"
            for body in ("{not json", json.dumps({"month": "2026-10", "spent": -5}),
                         json.dumps({"month": "2026-10", "spent": "0"}),
                         json.dumps({"month": "2027-01", "spent": 0}), json.dumps([1])):
                bad.write_text(body)
                led, ok = bi.load_ledger(bad, now, 5280)
                self.assertFalse(ok, body)
                self.assertEqual(led["spent"], (5280 * 17) // 31, body)

    def test_last_month_s_ledger_starts_at_zero_and_keeps_the_rotation(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "l.json"
            p.write_text(json.dumps({"month": "2026-09", "spent": 5000, "last": {"x": at(2026, 9, 30)}}))
            led, ok = bi.load_ledger(p, at(2026, 10, 1), 5280)
        self.assertTrue(ok)
        self.assertEqual(led["spent"], 0)
        self.assertIn("x", led["last"])

    def test_plan_never_exceeds_the_credits_it_is_given(self):
        roster = accts(25, 60, 300)
        now = at(2026, 10, 17)
        for credits in (0, 1, 10, 25, 26, 27, 85, 86, 87, 129, 500):
            picked, tagged, skipped = bi.plan(roster, {}, now, credits)
            self.assertLessEqual(len(picked) + tagged, credits, credits)
        picked, tagged, skipped = bi.plan(roster, {}, now, -4)
        self.assertEqual((picked, tagged), ([], False))

    def test_plan_claims_tier_1_then_tagged_then_tier_2_then_tier_3(self):
        roster = accts(3, 3, 14)          # tier 3 quota: 2 a day
        now = at(2026, 10, 17)
        picked, tagged, _ = bi.plan(roster, {}, now, 3)
        self.assertEqual([a["tier"] for a in picked], [1, 1, 1])
        self.assertFalse(tagged)
        picked, tagged, _ = bi.plan(roster, {}, now, 4)
        self.assertTrue(tagged)
        picked, tagged, _ = bi.plan(roster, {}, now, 100)
        self.assertEqual([a["tier"] for a in picked], [1, 1, 1, 2, 2, 2, 3, 3])

    def test_tier_2_is_once_a_burlington_day(self):
        roster = accts(1, 2, 0)
        last = {"t2_000": at(2026, 10, 17, 6)}                 # this morning
        picked, _, _ = bi.plan(roster, last, at(2026, 10, 17, 17), 100)
        self.assertEqual([a["h"] for a in picked], ["t1_000", "t2_001"])
        last = {"t2_000": at(2026, 10, 16, 23, )}              # 11pm yesterday, Burlington time
        picked, _, _ = bi.plan(roster, last, at(2026, 10, 17, 0) + 1800, 100)
        self.assertIn("t2_000", [a["h"] for a in picked])

    def test_short_credits_rotate_through_tier_2_instead_of_starving_it(self):
        roster = accts(0, 2, 0)
        last, got = {}, []
        for day in range(1, 7):
            now = at(2026, 10, day)
            picked, _, _ = bi.plan(roster, last, now, 1, tagged=False)
            for a in picked:
                last[a["h"]] = int(now)
                got.append(a["h"])
        self.assertEqual(sorted(set(got)), ["t2_000", "t2_001"])
        self.assertEqual(got.count("t2_000"), 3)

    def test_tier_3_turns_over_once_a_week_in_even_slices(self):
        """Two runs a day for four weeks: every tier 3 account is fetched
        every seven days, never twice in a week, and a day's slice is the
        tier divided by seven."""
        roster = accts(2, 3, 50)
        last, fetched = {}, {a["h"]: [] for a in roster if a["tier"] == 3}
        per_day = []
        for day in range(28):
            n_today = 0
            for hour in (6, 17):
                now = at(2026, 11, 1, hour) + day * 86400
                picked, _, _ = bi.plan(roster, last, now, 1000)
                for a in picked:
                    last[a["h"]] = int(now)
                    if a["tier"] == 3:
                        fetched[a["h"]].append(day)
                        n_today += 1
            per_day.append(n_today)
        self.assertTrue(all(n <= 8 for n in per_day), per_day)          # ceil(50 / 7) = 8
        for h, days in fetched.items():
            self.assertEqual(len(days), 4, (h, days))
            self.assertTrue(all(b - a == 7 for a, b in zip(days, days[1:])), (h, days))

    def test_a_month_of_runs_stays_inside_the_budget(self):
        """Simulate the ledger the way main() keeps it, two runs a day for
        a 31-day month, with a roster far too big for the budget, an extra
        manual run on some days, and a lost ledger once."""
        roster = accts(40, 120, 400)
        budget = 3000
        led = {"month": "2026-10", "spent": 0, "last": {}, "runs": []}
        for day in range(1, 32):
            for hour in (6, 12, 17) if day % 5 == 0 else (6, 17):
                now = at(2026, 10, day, hour)
                credits = bi.allowance(led, now, budget)
                picked, tagged, _ = bi.plan(roster, led["last"], now, credits)
                spend = len(picked) + tagged
                self.assertLessEqual(spend, credits)
                led["spent"] += spend
                for a in picked:
                    led["last"][a["h"]] = int(now)
                self.assertLessEqual(led["spent"], bi.share_through(datetime(2026, 10, day).date(), budget))
        self.assertLessEqual(led["spent"], budget)

    def test_the_real_roster_fits_the_budget(self):
        proj = bi.projection(bi.load_roster())
        self.assertLessEqual(proj["per_month"], bi.MONTHLY_CREDIT_BUDGET, proj)


class Build(unittest.TestCase):
    """main() end to end on the fixture: the payload carries video, food and
    a category on every post; the ledger counts every request."""

    def setUp(self):
        self.tagged_calls = []

    def run_main(self, tmp, accounts, argv, fetch, now, ledger=None):
        roster = roster_file(tmp, accounts)
        out = Path(tmp) / "instagram.json"
        led = Path(tmp) / "ledger.json"
        if ledger is not None:
            led.write_text(json.dumps(ledger))
        with mock.patch.object(bi, "ROSTER", roster), mock.patch.object(bi, "OUT", out), \
                mock.patch.object(bi, "LEDGER", led), mock.patch.object(bi, "ROOT", Path(tmp)), \
                mock.patch.object(bi, "api_key", return_value="k"), mock.patch.object(bi, "fetch_handle", fetch), \
                mock.patch.object(bi, "fetch_tagged", lambda k: self.tagged_calls.append(k) or []), \
                mock.patch.object(bi.time, "time", return_value=now), mock.patch.object(bi.time, "sleep"), \
                mock.patch.object(bi, "log"), mock.patch.object(sys, "argv", ["x"] + argv), \
                mock.patch.object(wc, "pick_engine", return_value=None):    # never a real model call
            code = bi.main()
        return code, (json.loads(out.read_text()) if out.exists() else None), \
            (json.loads(led.read_text()) if led.exists() else None)

    def test_payload(self):
        doc = answer()
        now = doc["fetched_at"]
        month = bi.month_key(bi.local_day(now))
        roster = [{"h": "foambrewers", "tier": 1, "category": "venue", "food": True},
                  {"h": "eatvermont", "tier": 1, "category": "food", "s": "see"},
                  {"h": "broken", "tier": 1, "category": "pets"}]
        fetch = lambda h, k: doc["items"] if h == "foambrewers" else ([] if h == "eatvermont" else 1 / 0)
        with tempfile.TemporaryDirectory() as tmp:
            code, got, led = self.run_main(tmp, roster, ["--reserve", "--no-tagged"], fetch, now,
                                           {"month": month, "spent": 10, "last": {}})
            self.assertEqual((code, got), (0, None))
            code, got, led = self.run_main(tmp, roster, ["--execute", "--no-carry"], fetch, now + 60, led)
        self.assertEqual(code, 0)
        self.assertEqual(got["videos"], 1)
        self.assertEqual(got["food"], 3)
        self.assertTrue(all(p.get("category") in bi.CATEGORIES for p in got["posts"]))
        reel = next(p for p in got["posts"] if p.get("vu"))
        self.assertEqual((reel["h"], reel["f"], reel["s"], reel["category"]), ("foambrewers", 1, "do", "venue"))
        self.assertEqual(got["categories"]["venue"], 3)
        # no model key here: every post still has a kind, its category's, marked to retry
        self.assertTrue(all(p["kind"] in bi.KINDS and p["kd"] == 1 for p in got["posts"]))
        self.assertEqual(got["kinds"]["vibe"], 3)
        self.assertEqual(got["kinds_defaulted"], 3)
        self.assertEqual(led["spent"], 13)                    # the failed request is charged too
        self.assertEqual(set(led["last"]), {"foambrewers", "eatvermont", "broken"})
        self.assertEqual(led["runs"][-1]["credits"], 3)

    def test_a_plain_run_refuses(self):
        """Reserve-and-spend in one go would count the credits only in this
        checkout, so it is not allowed without --only."""
        with tempfile.TemporaryDirectory() as tmp:
            code, got, led = self.run_main(
                tmp, [{"h": "a", "tier": 1, "category": "food"}], [],
                lambda h, k: self.fail("fetched"), at(2026, 10, 17), {"month": "2026-10", "spent": 0, "last": {}})
        self.assertEqual(code, 2)
        self.assertEqual(led["spent"], 0)
        self.assertEqual(self.tagged_calls, [])

    def test_an_exhausted_budget_makes_no_request(self):
        now = at(2026, 10, 17)
        with tempfile.TemporaryDirectory() as tmp:
            code, got, led = self.run_main(
                tmp, [{"h": "a", "tier": 1, "category": "food"}], ["--reserve"],
                lambda h, k: self.fail("fetched over budget"), now,
                {"month": "2026-10", "spent": bi.share_through(bi.local_day(now), bi.MONTHLY_CREDIT_BUDGET)})
        self.assertEqual(code, 0)
        self.assertIsNone(got)

    def test_dry_run_makes_no_request_and_needs_no_key(self):
        now = at(2026, 10, 17)
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(bi, "fetch_tagged", lambda k: self.fail("tagged")), \
                mock.patch("builtins.print"):
            with mock.patch.object(bi, "api_key", side_effect=AssertionError("key read")):
                roster = roster_file(tmp, [{"h": "a", "tier": 1, "category": "food"}])
                with mock.patch.object(bi, "ROSTER", roster), mock.patch.object(bi, "LEDGER", Path(tmp) / "l.json"), \
                        mock.patch.object(bi, "OUT", Path(tmp) / "o.json"), \
                        mock.patch.object(bi, "fetch_handle", lambda h, k: self.fail("fetched")), \
                        mock.patch.object(bi.time, "time", return_value=now), mock.patch.object(bi, "log"), \
                        mock.patch.object(sys, "argv", ["x", "--dry-run"]):
                    self.assertEqual(bi.main(), 0)
            self.assertFalse((Path(tmp) / "l.json").exists())
            self.assertFalse((Path(tmp) / "o.json").exists())

    def test_a_run_cut_off_partway_keeps_its_credits_and_gives_back_the_rest(self):
        """Killed on the second request: the whole run stays counted, the
        reservation is gone (it can never be spent twice), and the accounts
        never asked for get their rotation places back."""
        now = at(2026, 10, 17)
        seen = []
        roster = [{"h": h, "tier": 1, "category": "food"} for h in "abc"]
        with tempfile.TemporaryDirectory() as tmp:
            led_path = Path(tmp) / "ledger.json"

            def fetch(h, k):
                seen.append((h, json.loads(led_path.read_text())["spent"]))
                if len(seen) == 2:
                    raise KeyboardInterrupt
                return []

            _, _, led = self.run_main(tmp, roster, ["--reserve"], fetch, now,
                                      {"month": "2026-10", "spent": 100, "last": {"c": 5}})
            order = led["pending"]["handles"]
            with self.assertRaises(KeyboardInterrupt):
                self.run_main(tmp, roster, ["--execute"], fetch, now + 60, led)
            led = json.loads(led_path.read_text())
        self.assertEqual([x[1] for x in seen], [104, 104])   # three accounts + the tagged shelf
        self.assertEqual(led["spent"], 104)
        self.assertNotIn("pending", led)
        self.assertEqual(led["last"].get(order[0]), int(now))  # answered
        self.assertEqual(led["last"].get(order[1]), int(now))  # in flight when it stopped
        restored = order[2]
        self.assertEqual(led["last"].get(restored), 5 if restored == "c" else None)

    def test_a_run_out_of_time_writes_what_it_has_and_gives_back_the_rest(self):
        """Past FETCH_BUDGET_S the run stops asking, still writes a payload
        from the accounts that answered (the 30-minute step kill used to lose
        all of them), and gives the unasked accounts their rotation places."""
        doc = answer()
        now = doc["fetched_at"]
        month = bi.month_key(bi.local_day(now))
        roster = [{"h": h, "tier": 1, "category": "venue"} for h in ("foambrewers", "b", "c")]
        calls = []
        fetch = lambda h, k: calls.append(h) or doc["items"]
        clock = iter([0.0, 0.0, bi.FETCH_BUDGET_S + 1.0])   # start, before #1, before #2
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(bi.time, "monotonic", lambda: next(clock, bi.FETCH_BUDGET_S + 2.0)):
            code, got, led = self.run_main(
                tmp, roster, ["--execute", "--no-carry"], fetch, now,
                {"month": month, "spent": 50, "last": {"c": 7},
                 "pending": {"handles": ["foambrewers", "b", "c"], "tagged": False,
                             "at": int(now) - 600, "month": month,
                             "prev": {"foambrewers": 0, "b": 0, "c": 7}}})
        self.assertEqual(code, 0)
        self.assertEqual(calls, ["foambrewers"])
        self.assertTrue(got["posts"])
        self.assertEqual({p["h"] for p in got["posts"]}, {"foambrewers"})
        self.assertEqual(led["spent"], 50)                     # counted when reserved
        self.assertNotIn("pending", led)
        self.assertEqual(led["last"].get("c"), 7)              # place restored
        self.assertIsNone(led["last"].get("b"))

    def test_reserve_counts_and_names_the_run_without_a_request(self):
        now = at(2026, 10, 17)
        with tempfile.TemporaryDirectory() as tmp:
            code, got, led = self.run_main(
                tmp, [{"h": "a", "tier": 1, "category": "food"}, {"h": "b", "tier": 2, "category": "pets"}],
                ["--reserve"], lambda h, k: self.fail("fetched while reserving"), now,
                {"month": "2026-10", "spent": 100, "last": {}})
        self.assertEqual(code, 0)
        self.assertIsNone(got)
        self.assertEqual(self.tagged_calls, [])
        self.assertEqual(led["spent"], 103)
        self.assertEqual(led["pending"], {"handles": ["a", "b"], "tagged": True, "at": int(now),
                                          "month": "2026-10", "prev": {"a": 0, "b": 0}})

    def test_execute_spends_exactly_the_reservation_once(self):
        doc = answer()
        now = doc["fetched_at"]
        month = bi.month_key(bi.local_day(now))
        roster = [{"h": "foambrewers", "tier": 1, "category": "venue"}, {"h": "b", "tier": 1, "category": "pets"},
                  {"h": "c", "tier": 2, "category": "pets"}]
        calls = []
        fetch = lambda h, k: calls.append(h) or (doc["items"] if h == "foambrewers" else [])
        with tempfile.TemporaryDirectory() as tmp:
            code, got, led = self.run_main(
                tmp, roster, ["--execute", "--no-carry"], fetch, now,
                {"month": month, "spent": 50, "last": {},
                 "pending": {"handles": ["foambrewers", "gone"], "tagged": False, "at": int(now) - 600,
                             "month": month}})
            self.assertEqual(code, 0)
            self.assertEqual(calls, ["foambrewers"])           # not b, not c, not a handle since dropped
            self.assertEqual(self.tagged_calls, [])
            self.assertEqual(led["spent"], 50)                  # counted when it was reserved
            self.assertNotIn("pending", led)
            self.assertTrue(got["posts"])
            code, _, led = self.run_main(tmp, roster, ["--execute"], fetch, now + 60, led)
        self.assertEqual(code, 0)
        self.assertEqual(calls, ["foambrewers"])                # a second --execute spends nothing

    def test_a_stale_reservation_is_not_executed(self):
        now = at(2026, 10, 17, 18)
        with tempfile.TemporaryDirectory() as tmp:
            code, got, led = self.run_main(
                tmp, [{"h": "a", "tier": 1, "category": "food"}], ["--execute"],
                lambda h, k: self.fail("ran a stale reservation"), now,
                {"month": "2026-10", "spent": 10, "last": {},
                 "pending": {"handles": ["a"], "tagged": True, "at": int(now) - (bi.PENDING_MAX_H + 1) * 3600,
                             "month": "2026-10"}})
        self.assertEqual(code, 0)
        self.assertIsNone(got)
        self.assertEqual(self.tagged_calls, [])

    def test_last_month_s_reservation_is_not_spent_in_this_one(self):
        now = at(2026, 11, 1, 0) + 60
        with tempfile.TemporaryDirectory() as tmp:
            code, got, led = self.run_main(
                tmp, [{"h": "a", "tier": 1, "category": "food"}], ["--execute"],
                lambda h, k: self.fail("spent October's reservation in November"), now,
                {"month": "2026-10", "spent": 5000, "last": {},
                 "pending": {"handles": ["a"], "tagged": True, "at": int(now) - 300, "month": "2026-10"}})
        self.assertEqual(code, 0)
        self.assertEqual(self.tagged_calls, [])

    def test_an_unexecuted_reservation_gives_back_its_rotation_places(self):
        now = at(2026, 10, 17, 17)
        morning = at(2026, 10, 17, 6)
        last_week = at(2026, 10, 9, 6)
        with tempfile.TemporaryDirectory() as tmp:
            code, _, led = self.run_main(
                tmp, [{"h": "t2", "tier": 2, "category": "pets"}, {"h": "t3", "tier": 3, "category": "pets"}],
                ["--reserve", "--no-tagged"], lambda h, k: self.fail("fetched while reserving"), now,
                {"month": "2026-10", "spent": 200, "last": {"t2": int(morning), "t3": int(morning)},
                 "pending": {"handles": ["t2", "t3"], "tagged": True, "at": int(morning), "month": "2026-10",
                             "prev": {"t2": 0, "t3": int(last_week)}}})
        self.assertEqual(code, 0)
        self.assertEqual(led["pending"]["handles"], ["t2", "t3"])   # both due again, not skipped
        self.assertEqual(led["spent"], 202)                         # the morning's credits stay counted
        self.assertEqual(led["pending"]["prev"], {"t2": 0, "t3": int(last_week)})

    def test_only_is_a_small_test(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, got, led = self.run_main(
                tmp, [{"h": h, "tier": 3, "category": "food"} for h in "abcdef"], ["--only", "a,b,c,d,e,f"],
                lambda h, k: self.fail("fetched"), at(2026, 10, 17), {"month": "2026-10", "spent": 0, "last": {}})
        self.assertEqual(code, 2)
        self.assertEqual(led["spent"], 0)

    def test_the_steps_are_exclusive(self):
        for argv in (["--dry-run", "--execute"], ["--reserve", "--execute"], ["--dry-run", "--reserve"]):
            with mock.patch.object(sys, "argv", ["x"] + argv), mock.patch("sys.stderr"), \
                    mock.patch.object(bi, "fetch_handle", lambda h, k: self.fail("fetched")):
                with self.assertRaises(SystemExit):
                    bi.main()

    def test_a_missing_ledger_fetches_nothing_and_writes_one(self):
        now = at(2026, 10, 17)
        with tempfile.TemporaryDirectory() as tmp:
            code, got, led = self.run_main(
                tmp, [{"h": "a", "tier": 1, "category": "food"}], ["--reserve"],
                lambda h, k: self.fail("fetched without a ledger"), now)
        self.assertEqual(code, 0)
        self.assertIsNone(got)
        self.assertEqual((led["month"], led["spent"]), ("2026-10", bi.share_through(bi.local_day(now), bi.MONTHLY_CREDIT_BUDGET)))

    def test_only_stays_inside_the_budget(self):
        now = at(2026, 10, 17)
        calls = []
        doc = answer()
        with tempfile.TemporaryDirectory() as tmp:
            code, got, led = self.run_main(
                tmp, [{"h": h, "tier": 3, "category": "food"} for h in "abcd"],
                ["--only", "a,b,c,zz", "--no-carry"],
                lambda h, k: calls.append(h) or doc["items"], doc["fetched_at"],
                {"month": bi.month_key(bi.local_day(doc["fetched_at"])),
                 "spent": bi.share_through(bi.local_day(doc["fetched_at"]), bi.MONTHLY_CREDIT_BUDGET) - 2})
        self.assertEqual(calls, ["a", "b"])
        self.assertEqual(self.tagged_calls, [])     # --only never spends the tagged credit
        self.assertEqual(led["runs"][-1]["credits"], 2)


def post(h, ts, cat="venue", u=None, **kw):
    return dict({"h": h, "ts": ts, "i": f"https://cdn.test/{h}{ts}.jpg?oe=7AD477AC",
                 "u": u or f"https://www.instagram.com/p/{h}{ts}/", "category": cat}, **kw)


class Caps(unittest.TestCase):
    def test_every_account_gets_a_post_before_any_gets_a_second(self):
        recs = [post("daily", 100 + i) for i in range(10)] + [post("weekly", 5), post("weekly", 4)]
        got = bi.fair_cap(recs, 3)
        self.assertEqual([(r["h"], r["ts"]) for r in got], [("daily", 109), ("weekly", 5), ("daily", 108)])
        self.assertEqual(len(bi.fair_cap(recs, 50)), 12)

    def test_a_weekly_account_s_carried_posts_survive_a_full_category(self):
        doc = answer()
        now = doc["fetched_at"]
        prev = {"posts": [post("weekly", now - 5 * 86400, cat="shop")]}   # older than both of foam's newest
        roster = [{"h": "foambrewers", "tier": 1, "category": "shop"},
                  {"h": "weekly", "tier": 3, "category": "shop"}]
        b = Build()
        b.setUp()
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(bi.CAP, {"shop": 2}):
            (Path(tmp) / "instagram.json").write_text(json.dumps(prev))
            code, got, _ = b.run_main(tmp, roster, ["--only", "foambrewers"], lambda h, k: doc["items"], now,
                                      {"month": bi.month_key(bi.local_day(now)), "spent": 0, "last": {}})
        self.assertEqual(code, 0)
        self.assertEqual(sorted(p["h"] for p in got["posts"]), ["foambrewers", "weekly"])


class Kinds(unittest.TestCase):
    """The per-post kind: the model is never called for real here."""

    NOW = at(2026, 10, 18)
    ENGINE = {"provider": "anthropic", "model": "claude-haiku-5-5"}

    def run_kinds(self, posts, answers, prev=None, ledger=None, engine=ENGINE, thumb=("image/jpeg", "AAAA")):
        calls = []

        def ask(engine, system, user, schema, max_tokens, **kw):
            calls.append(user)
            ans = answers.pop(0)
            if isinstance(ans, Exception):
                raise ans
            return ans, {"in": 1000, "out": 100, "calls": 1}

        with mock.patch.object(wc, "pick_engine", return_value=engine), \
                mock.patch.object(wc, "ask_json", ask), mock.patch.object(bi, "log"), \
                mock.patch.object(bi, "fetch_thumb", return_value=thumb):
            rep = bi.assign_kinds(posts, prev or {}, {"cat": {"pets", "vibe"}}, ledger, self.NOW)
        return rep, calls

    def test_no_key_gives_the_category_s_kind_and_marks_it(self):
        posts = [post("a", 1, "events"), post("b", 2, "shop"), post("c", 3, "food")]
        with mock.patch.object(wc, "pick_engine", return_value=None), mock.patch.object(bi, "log"):
            bi.assign_kinds(posts, {}, {}, None, self.NOW)
        self.assertEqual([(p["kind"], p["kd"]) for p in posts], [("poster", 1), ("other", 1), ("food", 1)])

    def test_a_judged_post_is_never_asked_again(self):
        posts = [post("a", 1, kind="food"), post("b", 2, u="https://www.instagram.com/p/X/"),
                 post("c", 3, u="https://www.instagram.com/c/")]       # no shortcode: known by handle and time
        prev = {bi.post_key(posts[1]): "poster", "t:c:3": "scenic"}
        rep, calls = self.run_kinds(posts, [], prev=prev)
        self.assertEqual(calls, [])
        self.assertEqual([p["kind"] for p in posts], ["food", "poster", "scenic"])
        self.assertTrue(all("kd" not in p for p in posts))

    def test_the_caption_decides_and_the_picture_settles_the_unsure(self):
        posts = [post("cat", 3, "venue", c="our new oat latte"), post("b", 2, "food", c="trivia tuesday 7pm"),
                 post("c", 1, "events", c="what a night")]
        caption = {"kinds": [{"i": 0, "kind": "food", "sure": True}, {"i": 1, "kind": "poster", "sure": True},
                             {"i": 2, "kind": "poster", "sure": False}, {"i": 9, "kind": "food", "sure": True},
                             {"i": 0, "kind": "pets", "sure": True}]}       # out of range and a repeat: dropped
        look = {"kinds": [{"i": 0, "kind": "vibe"}]}
        ledger = {"month": "2026-10"}
        rep, calls = self.run_kinds(posts, [caption, look], ledger=ledger)
        self.assertEqual([p["kind"] for p in posts], ["food", "poster", "vibe"])
        self.assertTrue(all("kd" not in p for p in posts))
        self.assertIn("@cat · venue (also pets, vibe) · photo · our new oat latte", calls[0])
        self.assertEqual([b["type"] for b in calls[1]], ["text", "image", "text"])    # only the unsure one is shown
        self.assertEqual((rep["asked"], rep["looked"], rep["decided"]), (3, 1, 3))
        self.assertEqual(ledger["ai"]["month"], "2026-10")
        self.assertAlmostEqual(ledger["ai"]["usd"], 2 * wc.cost_usd("claude-haiku-5-5", {"in": 1000, "out": 100}))

    def test_an_unsure_post_nobody_could_look_at_is_asked_again_next_run(self):
        posts = [post("c", 1, "events", c="what a night")]
        caption = {"kinds": [{"i": 0, "kind": "vibe", "sure": False}]}
        rep, calls = self.run_kinds(posts, [caption], thumb=None)     # the thumbnail would not download
        self.assertEqual((posts[0]["kind"], posts[0]["kd"]), ("vibe", 1))
        self.assertEqual(len(calls), 1)

    def test_a_post_shipped_twice_is_asked_about_once(self):
        roster, tagged = post("a", 1, "venue"), post("a", 1, "other", s="tagged")
        rep, calls = self.run_kinds([roster, tagged], [{"kinds": [{"i": 0, "kind": "food", "sure": True}]}])
        self.assertEqual(calls[0].count("@a"), 1)
        self.assertEqual([(p["kind"], "kd" in p) for p in (roster, tagged)], [("food", False), ("food", False)])

    def test_thumbnail_downloads_are_capped_even_when_they_all_fail(self):
        posts = [post(f"p{i}", i, "events") for i in range(bi.IMAGE_LOOK_MAX + 40)]
        caption = {"kinds": [{"i": i, "kind": "vibe", "sure": False} for i in range(len(posts))]}
        tries = []
        with mock.patch.object(wc, "pick_engine", return_value=self.ENGINE), mock.patch.object(bi, "log"), \
                mock.patch.object(wc, "ask_json", lambda *a, **k: (caption, {"in": 1, "calls": 1})), \
                mock.patch.object(bi, "fetch_thumb", lambda u: tries.append(u)):
            bi.assign_kinds(posts, {}, {}, None, self.NOW)
        self.assertEqual(len(tries), bi.IMAGE_LOOK_MAX)
        self.assertTrue(all(p["kd"] == 1 for p in posts))

    def test_an_answer_that_is_not_an_object_changes_nothing(self):
        posts = [post("a", 1, "pets")]
        rep, calls = self.run_kinds(posts, [[{"i": 0, "kind": "food", "sure": True}]])
        self.assertEqual((posts[0]["kind"], posts[0]["kd"]), ("pets", 1))

    def test_the_cap_is_checked_before_every_call(self):
        posts = [post(f"p{i}", i, "pets") for i in range(bi.KIND_BATCH + 1)]       # two caption batches
        ledger = {"ai": {"month": "2026-10", "usd": bi.AI_MONTH_CAP_USD - 0.0001, "runs": []}}
        rep, calls = self.run_kinds(posts, [{"kinds": []}, {"kinds": []}], ledger=ledger)
        self.assertEqual(len(calls), 1)                         # the first call's cost reaches the cap

    def test_a_classifier_crash_still_writes_the_payload(self):
        doc = answer()
        now = doc["fetched_at"]
        b = Build()
        b.setUp()
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(bi, "assign_kinds", side_effect=RuntimeError("boom")):
            code, got, _ = b.run_main(tmp, [{"h": "foambrewers", "tier": 1, "category": "venue"}],
                                      ["--only", "foambrewers", "--no-carry"], lambda h, k: doc["items"], now,
                                      {"month": bi.month_key(bi.local_day(now)), "spent": 0, "last": {}})
        self.assertEqual(code, 0)
        self.assertTrue(got["posts"] and all((p["kind"], p["kd"]) == ("vibe", 1) for p in got["posts"]))

    def test_text_only_engine_takes_the_caption_s_guess(self):
        posts = [post("c", 1, "events", c="what a night")]
        caption = {"kinds": [{"i": 0, "kind": "vibe", "sure": False}]}
        rep, calls = self.run_kinds(posts, [caption], engine={"provider": "openrouter", "model": wc.GLM})
        self.assertEqual(posts[0]["kind"], "vibe")
        self.assertNotIn("kd", posts[0])
        self.assertEqual(len(calls), 1)

    def test_a_failed_call_keeps_the_defaults(self):
        posts = [post("a", 1, "pets")]
        err = wc.ModelError("bad")
        err.usage = {"in": 500, "out": 0, "calls": 1}
        ledger = {}
        rep, calls = self.run_kinds(posts, [err], ledger=ledger)
        self.assertEqual((posts[0]["kind"], posts[0]["kd"]), ("pets", 1))
        self.assertGreater(ledger["ai"]["usd"], 0)                    # a failed call is still billed

    def test_the_monthly_cap_stops_the_calls(self):
        posts = [post("a", 1, "pets")]
        ledger = {"ai": {"month": "2026-10", "usd": bi.AI_MONTH_CAP_USD, "runs": []}}
        rep, calls = self.run_kinds(posts, [], ledger=ledger)
        self.assertEqual(calls, [])
        self.assertEqual(posts[0]["kd"], 1)

    def test_the_spend_survives_the_ledger_and_resets_each_month(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "l.json"
            led = {"month": "2026-10", "spent": 3, "last": {}, "runs": [],
                   "ai": {"month": "2026-10", "usd": 0.25, "runs": [{"usd": 0.25}]}}
            bi.save_ledger(p, led)
            got, ok = bi.load_ledger(p, self.NOW, 5280)
            self.assertTrue(ok)
            self.assertEqual(got["ai"]["usd"], 0.25)
            nov, ok = bi.load_ledger(p, at(2026, 11, 2), 5280)
            self.assertNotIn("ai", nov)
            self.assertEqual(bi.ai_spent(nov, at(2026, 11, 2)), 0.0)

    def test_answers_are_checked(self):
        got = bi.read_kinds([{"i": 0, "kind": "food", "sure": True}, {"i": True, "kind": "food"},
                             {"i": 1, "kind": "poem", "sure": True}, "x", {"i": 2, "kind": "pets", "sure": "yes"}],
                            3, True)
        self.assertEqual(got, {0: ("food", True), 2: ("pets", False)})

    def test_thumbnails_are_sniffed_not_trusted(self):
        self.assertEqual(bi.sniff_image(b"\xff\xd8\xff\xe0rest"), "image/jpeg")
        self.assertEqual(bi.sniff_image(b"RIFF\x00\x00\x00\x00WEBPVP8 "), "image/webp")
        self.assertIsNone(bi.sniff_image(b"<html>"))


if __name__ == "__main__":
    unittest.main()
