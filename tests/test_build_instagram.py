"""build_instagram.py: reels keep a playable video, food handles are tagged.

The fixture is a real ScrapeCreators answer for @foambrewers (2026-10-16),
trimmed to the fields the builder reads: a reel, a photo and a carousel.
Nothing here touches the network; the clock is pinned to the fetch.

Run: python3 -m unittest tests.test_build_instagram
"""

import io
import json
import os
import re
import signal
from contextlib import redirect_stderr
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

    def test_national_accounts_stay_off_the_local_tabs(self):
        """National is its own category and never food, so Food, Vintage,
        People and Town, which read categories, handles and `f`, cannot get it."""
        national = [a for a in bi.load_roster() if a["national"]]
        self.assertGreaterEqual(len(national), 20)
        for h in ("newyorkercartoons", "theonion", "nytcooking", "thedogist", "nasa", "nprmusic", "planetmoney"):
            self.assertIn(h, {a["h"] for a in national})
        for a in national:
            self.assertEqual(a["category"], "national", a)
            self.assertFalse(a["food"], a)
        raw = {a["h"]: a for a in json.loads(bi.ROSTER.read_text(encoding="utf-8"))["accounts"]}
        for a in national:   # what food.js reads off the roster itself
            self.assertNotEqual(raw[a["h"]]["category"], "food")
            self.assertNotIn("food", raw[a["h"]])
        shops = (bi.ROOT / "data" / "vintage-shops.json").read_text(encoding="utf-8").lower()
        for a in national:
            self.assertIsNone(re.search(r"instagram\.com/" + re.escape(a["h"]) + r"\b", shops), a)

    def test_a_national_flag_wins_over_its_food_category(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "r.json"
            p.write_text(json.dumps({"accounts": [{"h": "a", "tier": 2, "category": "food", "national": True, "food": True}]}))
            a = bi.load_roster(p)[0]
        self.assertEqual((a["category"], a["food"], a["national"]), ("national", False, True))

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

    def test_a_capped_month_reaches_every_tier(self):
        """Two capped runs a day through a 30-day month: tier 2 daily, and the
        whole of tier 3 turned over, not starved behind tier 2."""
        accounts = bi.load_roster()
        led = {"month": "2026-11", "spent": 0, "last": {}}
        tier = {a["h"]: a["tier"] for a in accounts}
        hits = {a["h"]: 0 for a in accounts}
        for day in range(1, 31):
            for hour in (9, 19):
                now = datetime(2026, 11, day, hour, tzinfo=bi.TZ).timestamp()
                credits = min(bi.allowance(led, now, bi.MONTHLY_CREDIT_BUDGET), bi.RUN_MAX)
                picked, tagged, _ = bi.plan(accounts, led["last"], now, credits)
                led["spent"] += len(picked) + (1 if tagged else 0)
                for a in picked:
                    led["last"][a["h"]] = int(now)
                    hits[a["h"]] += 1
        self.assertLessEqual(led["spent"], bi.MONTHLY_CREDIT_BUDGET)
        self.assertGreaterEqual(min(n for h, n in hits.items() if tier[h] == 2), 28, led["spent"])
        self.assertGreaterEqual(min(n for h, n in hits.items() if tier[h] == 3), 3, led["spent"])


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

    def test_a_national_post_carries_its_flag(self):
        doc = answer()
        now = doc["fetched_at"]
        roster = [{"h": "away", "tier": 1, "category": "national", "national": True},
                  {"h": "here", "tier": 1, "category": "food"}]
        with tempfile.TemporaryDirectory() as tmp:
            fetch = lambda h, k: [{**it, "code": h + str(i)} for i, it in enumerate(doc["items"])]
            _, _, led = self.run_main(tmp, roster, ["--reserve", "--no-tagged"], fetch, now,
                                      {"month": bi.month_key(bi.local_day(now)), "spent": 0, "last": {}})
            code, got, _ = self.run_main(tmp, roster, ["--execute", "--no-carry"], fetch, now + 60, led)
        self.assertEqual(code, 0)
        away = [p for p in got["posts"] if p["h"] == "away"]
        here = [p for p in got["posts"] if p["h"] == "here"]
        self.assertTrue(away and here)
        self.assertTrue(all(p["n"] == 1 and p["category"] == "national" and "f" not in p for p in away))
        self.assertTrue(all("n" not in p and p["f"] == 1 for p in here))
        self.assertEqual(got["national"], len(away))

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

    def test_a_run_reserves_no_more_than_it_can_fetch(self):
        now = at(2026, 10, 17)
        accounts = [{"h": f"h{i}", "tier": 2, "category": "food"} for i in range(bi.RUN_MAX + 20)]
        with tempfile.TemporaryDirectory() as tmp:
            code, _, led = self.run_main(tmp, accounts, ["--reserve"],
                                         lambda h, k: self.fail("fetched while reserving"), now,
                                         {"month": "2026-10", "spent": 100, "last": {}})
        self.assertEqual(code, 0)
        self.assertEqual(led["spent"], 100 + bi.RUN_MAX)
        self.assertEqual(len(led["pending"]["handles"]), bi.RUN_MAX - 1)     # the tagged shelf is one

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


    def test_national_is_not_cut_below_what_the_roster_can_post(self):
        accounts = [a for a in bi.load_roster() if a["national"]]
        self.assertLessEqual(len(accounts) * bi.POSTS_PER_HANDLE, bi.CAP["national"])


class Names(unittest.TestCase):
    """`nm` is the account's own, one per handle, for the price of the read."""

    NOW = 1792183834

    def own(self, code, h, name, ts=None):
        return {"code": code, "taken_at": ts or self.NOW - 3600, "media_type": 1, "caption": {"text": "A post"},
                "user": {"username": h, "full_name": name},
                "image_versions2": {"candidates": [{"url": "https://x.test/p480x480/a.jpg?oe=7AD477AC",
                                                    "width": 480, "height": 480}]}}

    def build(self, tmp, roster, fetch, ledger=None, now=None):
        now = now or self.NOW
        b = Build()
        b.setUp()
        led = {"month": bi.month_key(bi.local_day(now)), "spent": 0, "last": {}, **(ledger or {})}
        handles = ",".join(a["h"] for a in roster if a.get("tier") == 1)
        return b.run_main(tmp, roster, ["--only", handles, "--no-tagged"], fetch, now, led)

    def test_a_name_comes_only_from_a_post_the_account_owns(self):
        items = [self.own("a", "stranger", "Michelle Kolbeck"), self.own("b", "ikeahack", "IKEA Hack")]
        self.assertEqual(bi.own_name("ikeahack", items, True), "IKEA Hack")
        self.assertEqual(bi.own_name("ikeahack", items[:1], True), "")

    def test_a_handle_compares_however_the_api_cases_it(self):
        self.assertEqual(bi.own_name("uvmmbb", [self.own("a", "@UVMmbb", "UVM Men's Basketball")], False),
                         "UVM Men's Basketball")

    def test_a_local_account_s_personal_name_stays_off_the_page(self):
        self.assertEqual(bi.own_name("tinafriml", [self.own("a", "tinafriml", "Tina Friml")], False), "")
        self.assertEqual(bi.own_name("tinafriml", [self.own("a", "tinafriml", "Tina Friml")], True), "Tina Friml")

    def test_a_collab_never_renames_the_account(self):
        items = [self.own("a", "stranger", "Magdalena Wockinger"), self.own("b", "ikeahack", "IKEA Hack"),
                 self.own("c", "other", "Michelle Kolbeck")]
        roster = [{"h": "ikeahack", "tier": 1, "category": "national", "national": True}]
        with tempfile.TemporaryDirectory() as tmp:
            code, got, led = self.build(tmp, roster, lambda h, k: items)
        self.assertEqual(code, 0)
        self.assertEqual({p["nm"] for p in got["posts"]}, {"IKEA Hack"})
        self.assertEqual(led["names"], {"ikeahack": "IKEA Hack"})

    def test_a_read_that_is_all_collabs_keeps_the_known_name(self):
        roster = [{"h": "ikeahack", "tier": 1, "category": "national", "national": True}]
        with tempfile.TemporaryDirectory() as tmp:
            _, got, led = self.build(tmp, roster, lambda h, k: [self.own("a", "stranger", "Somebody Else")],
                                     {"names": {"ikeahack": "IKEA Hack"}})
        self.assertEqual(got["posts"][0]["nm"], "IKEA Hack")
        self.assertEqual(led["names"], {"ikeahack": "IKEA Hack"})

    def test_a_carried_post_takes_the_account_s_name_and_loses_a_collab_s(self):
        roster = [{"h": "reader", "tier": 1, "category": "food"},
                  {"h": "uvmmbb", "tier": 3, "category": "events", "name": "UVM Men's Basketball"},
                  {"h": "ikeahack", "tier": 3, "category": "national", "national": True}]
        prev = {"posts": [post("uvmmbb", self.NOW - 3600, cat="events"),
                          {**post("ikeahack", self.NOW - 3600, cat="national"), "nm": "MAGDALENA WOCKINGER"}]}
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "instagram.json").write_text(json.dumps(prev))
            code, got, _ = self.build(tmp, roster, lambda h, k: [self.own("a", "reader", "The Reader")])
        self.assertEqual(code, 0)
        by_h = {p["h"]: p for p in got["posts"]}
        self.assertEqual(by_h["uvmmbb"]["nm"], "UVM Men's Basketball")
        self.assertNotIn("nm", by_h["ikeahack"])                     # the handle until a read finds the name
        self.assertEqual(by_h["reader"]["nm"], "The Reader")

    def test_a_roster_name_wins_over_the_profile(self):
        roster = [{"h": "epicgardening", "tier": 1, "category": "national", "national": True, "name": "Epic Gardening"}]
        with tempfile.TemporaryDirectory() as tmp:
            _, got, _ = self.build(tmp, roster, lambda h, k: [self.own("a", "epicgardening", "We help you grow.")])
        self.assertEqual(got["posts"][0]["nm"], "Epic Gardening")

    def test_names_survive_a_reservation_and_leave_with_the_roster(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ledger.json"
            month = bi.month_key(bi.local_day(self.NOW))
            path.write_text(json.dumps({"month": month, "spent": 0, "last": {}, "names": {"a": "Name", "b": 3}}))
            led, ok = bi.load_ledger(path, self.NOW, 5280)
            self.assertTrue(ok)
            self.assertEqual(led["names"], {"a": "Name"})
            bi.save_ledger(path, led)
            self.assertEqual(json.loads(path.read_text())["names"], {"a": "Name"})

    def test_opaque_handles_have_a_name_in_the_real_roster(self):
        names = {a["h"]: a["name"] for a in bi.load_roster()}
        self.assertEqual(names["uvmmbb"], "UVM Men's Basketball")
        self.assertIsNone(names["btvcityarts"])


class Feeds(unittest.TestCase):
    """The accounts under the Wire's pill: read on their own clock, kept for
    longer, and stamped with their feed."""

    NOW = 1792183834

    def fed(self, n):
        return [{"h": f"fed{i:02d}", "tier": 3, "category": "national", "s": "see", "food": False,
                 "national": True, "interest": "wild"} for i in range(n)]

    def test_a_tier_3_account_in_a_feed_is_read_every_three_days(self):
        roster = self.fed(30) + accts(0, 0, 70)
        last, days = {}, {a["h"]: [] for a in roster}
        for day in range(21):
            for hour in (6, 17):
                now = at(2026, 11, 1, hour) + day * 86400
                picked, _, _ = bi.plan(roster, last, now, 1000)
                for a in picked:
                    last[a["h"]] = int(now)
                    days[a["h"]].append(day)
        for a in self.fed(30):
            gaps = {y - x for x, y in zip(days[a["h"]], days[a["h"]][1:])}
            self.assertEqual(gaps, {bi.INTEREST_PERIOD_DAYS}, a["h"])
        self.assertEqual({y - x for x, y in zip(days["t3_000"], days["t3_000"][1:])}, {bi.TIER3_PERIOD_DAYS})

    def test_feeds_are_served_before_the_rest_of_tier_3(self):
        roster = accts(0, 0, 70) + self.fed(30)
        picked, _, _ = bi.plan(roster, {}, at(2026, 11, 1), 10)
        self.assertEqual({a["h"][:3] for a in picked}, {"fed"})

    def test_the_projection_matches_what_plan_spends(self):
        roster = self.fed(30) + accts(0, 0, 70)
        last, spent = {}, 0
        days = 42                                        # both rotations' whole multiple
        for day in range(days):
            for hour in (6, 17):
                now = at(2026, 11, 1, hour) + day * 86400
                picked, _, _ = bi.plan(roster, last, now, 1000, tagged=False)
                spent += len(picked)
                for a in picked:
                    last[a["h"]] = int(now)
        per_day = bi.projection(roster, tagged=False)["per_day"]
        self.assertLessEqual(abs(spent / days - per_day), 1, (spent / days, per_day))

    def test_a_feed_s_account_keeps_a_monthly_poster_and_a_local_one_does_not(self):
        doc = answer()
        now = doc["fetched_at"]
        old = {**doc["items"][1], "taken_at": now - 60 * 86400}
        fetch = lambda h, k: [old]
        roster = [{"h": "away", "tier": 1, "category": "national", "national": True, "interest": "wild"},
                  {"h": "here", "tier": 1, "category": "food"}]
        b = Build()
        b.setUp()
        with tempfile.TemporaryDirectory() as tmp:
            code, got, _ = b.run_main(tmp, roster, ["--only", "away,here", "--no-tagged"], fetch, now,
                                      {"month": bi.month_key(bi.local_day(now)), "spent": 0, "last": {}})
        self.assertEqual(code, 0)
        self.assertEqual({p["h"] for p in got["posts"]}, {"away"})

    def test_a_carried_post_follows_the_roster_s_feed_and_breed(self):
        doc = answer()
        now = doc["fetched_at"]
        prev = {"posts": [{**post("moved", now - 3600, cat="national"), "t": "dogs", "br": "beagle"},
                          post("snoop", now - 3600, cat="national")]}
        roster = [{"h": "reader", "tier": 1, "category": "food"},
                  {"h": "moved", "tier": 3, "category": "national", "national": True, "interest": "laughs"},
                  {"h": "snoop", "tier": 3, "category": "national", "national": True, "interest": "dogs", "breed": "lab"}]
        b = Build()
        b.setUp()
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "instagram.json").write_text(json.dumps(prev))
            _, got, _ = b.run_main(tmp, roster, ["--only", "reader", "--no-tagged"], lambda h, k: doc["items"], now,
                                   {"month": bi.month_key(bi.local_day(now)), "spent": 0, "last": {}})
        by_h = {p["h"]: p for p in got["posts"]}
        self.assertEqual(by_h["moved"]["t"], "laughs")
        self.assertNotIn("br", by_h["moved"])
        self.assertEqual((by_h["snoop"]["t"], by_h["snoop"]["br"]), ("dogs", "lab"))

    def test_a_breed_page_s_merch_stays_out_and_a_big_account_s_links_do_not(self):
        doc = answer()
        now = doc["fetched_at"]
        ad = lambda h, k: [{**doc["items"][1], "code": h, "caption": {"text": "Every Beagle parent needs this tee! Link in bio!"}}]
        roster = [{"h": "beagles", "tier": 1, "category": "national", "national": True, "interest": "dogs", "breed": "beagle"},
                  {"h": "natgeo", "tier": 1, "category": "national", "national": True, "interest": "wild"}]
        b = Build()
        b.setUp()
        with tempfile.TemporaryDirectory() as tmp:
            _, got, _ = b.run_main(tmp, roster, ["--only", "beagles,natgeo", "--no-tagged"], ad, now,
                                   {"month": bi.month_key(bi.local_day(now)), "spent": 0, "last": {}})
        self.assertEqual({p["h"] for p in got["posts"]}, {"natgeo"})

    def test_snoopy_is_a_cartoon_not_a_beagle(self):
        snoopy = next(a for a in bi.load_roster() if a["h"] == "snoopygrams")
        self.assertEqual((snoopy["interest"], snoopy["breed"]), ("laughs", None))

    def test_likes_ride_on_the_post(self):
        doc = answer()
        it = {**doc["items"][1], "like_count": 42}
        rec = bi.post_record("foambrewers", it, doc["fetched_at"] - 30 * 86400, doc["fetched_at"])
        self.assertEqual(rec["l"], 42)


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
        self.assertEqual(got, {0: ("food", True, False, False), 2: ("pets", False, False, False)})

    def test_thumbnails_are_sniffed_not_trusted(self):
        self.assertEqual(bi.sniff_image(b"\xff\xd8\xff\xe0rest"), "image/jpeg")
        self.assertEqual(bi.sniff_image(b"RIFF\x00\x00\x00\x00WEBPVP8 "), "image/webp")
        self.assertIsNone(bi.sniff_image(b"<html>"))


class Titles(unittest.TestCase):
    """The line under a tile: the model is never called for real here."""

    NOW = at(2026, 11, 1)
    ENGINE = {"provider": "anthropic", "model": "claude-haiku-5-5", "effort": "low"}

    def run_titles(self, posts, answers, prev=None, ledger=None, engine=ENGINE):
        calls = []

        def ask(engine, system, user, schema, max_tokens, **kw):
            self.assertTrue(any(b["type"] == "image" for b in user))     # no title without its picture
            calls.append("\n".join(b["text"] for b in user if b["type"] == "text"))
            ans = answers.pop(0)
            if isinstance(ans, Exception):
                raise ans
            return ans, {"in": 1000, "out": 100, "calls": 1}

        with mock.patch.object(wc, "pick_engine", return_value=engine), mock.patch.object(wc, "ask_json", ask), \
                mock.patch.object(bi, "fetch_thumb", return_value=("image/jpeg", "AAAA")), mock.patch.object(bi, "log"):
            rep = bi.assign_titles(posts, prev or {}, ledger, self.NOW)
        return rep, calls

    @staticmethod
    def say(rec, title="", ad=False):
        return {"code": bi.hd_code(rec), "title": title, "ad": ad}

    def test_a_post_gets_its_title_an_ad_flag_or_a_note_that_it_has_neither(self):
        posts = [post("a", 1, c="Beagle steals a sandwich"), post("b", 2, c="50% off with code DOG", n=1),
                 post("c", 3, c="so good")]
        rep, calls = self.run_titles(posts, [{"items": [
            self.say(posts[0], "Beagle steals a sandwich"), self.say(posts[1], "", True),
            self.say(posts[2])]}])
        self.assertEqual(posts[0]["hd"], "Beagle steals a sandwich")
        self.assertEqual((posts[1]["ad"], "hd" in posts[1]), (1, False))     # an ad never needs a title
        self.assertEqual((posts[2]["hx"], "hd" in posts[2]), (1, False))
        self.assertEqual(rep["decided"], 3)

    def test_a_misaligned_answer_is_dropped_not_mislabelled(self):
        one, two = post("a", 1, c="A beagle on a couch"), post("b", 2, c="A kitchen makeover")
        away = post("z", 9, c="From another batch")
        # Under no code, under an old index, under a post from elsewhere: none
        # of these says which post it means, so neither post takes it.
        for wrong in ({"title": "Kitchen gets a makeover", "ad": False},
                      {"i": 0, "title": "Kitchen gets a makeover", "ad": False},
                      {"code": 0, "title": "Kitchen gets a makeover", "ad": False},
                      self.say(away, "Kitchen gets a makeover")):
            self.run_titles([one, two], [{"items": [wrong]}])
            for rec in (one, two):
                self.assertFalse({"hd", "ad", "hx"} & set(rec), wrong)

    def test_a_code_given_twice_is_trusted_for_neither_answer(self):
        one, two = post("a", 1, c="A beagle on a couch"), post("b", 2, c="A kitchen makeover")
        self.run_titles([one, two], [{"items": [
            self.say(one, "Beagle naps on the couch"), self.say(one, "Kitchen gets a makeover"),
            self.say(two, "Kitchen gets a makeover")]}])
        self.assertNotIn("hd", one)
        self.assertEqual(two["hd"], "Kitchen gets a makeover")

    def test_a_dropped_post_is_asked_again_next_run(self):
        rec = post("a", 1, c="A beagle on a couch")
        _, first = self.run_titles([rec], [{"items": []}])
        _, second = self.run_titles([rec], [{"items": [self.say(rec, "Beagle naps on the couch")]}])
        self.assertEqual((len(first), len(second), rec["hd"]), (1, 1, "Beagle naps on the couch"))

    def test_a_code_belongs_to_the_post_not_its_place_in_the_batch(self):
        one, two = post("a", 1), post("b", 2)
        self.assertNotEqual(bi.hd_code(one), bi.hd_code(two))
        self.assertEqual(bi.hd_code(one), bi.hd_code(dict(one, ts=1, c="edited", kind="vibe")))
        _, calls = self.run_titles([post("a", 1, c="caption"), post("b", 2, c="caption")], [{"items": []}])
        self.assertIn(bi.hd_code(one), calls[0])

    def test_a_decided_post_is_never_asked_again(self):
        posts = [post("a", 1, c="words", hd="Beagle naps on the couch"), post("b", 2, c="words", ad=1),
                 post("c", 3, c="words", hx=1), post("d", 4, c="words"), post("e", 5, c="words")]
        prev = {bi.post_key(posts[3]): {"hd": "Lab swims in the lake"}, bi.post_key(posts[4]): {"ad": 1}}
        rep, calls = self.run_titles(posts, [], prev)
        self.assertEqual(calls, [])
        self.assertEqual((posts[3]["hd"], posts[4]["ad"]), ("Lab swims in the lake", 1))

    def test_a_post_with_no_words_goes_out_with_its_picture_and_nothing_clear_gets_no_line(self):
        posts = [post("a", 1), post("b", 2, c="\U0001F436\U0001F525")]
        rep, calls = self.run_titles(posts, [{"items": [self.say(posts[0], "Bluebird on a snowy branch"), self.say(posts[1])]}])
        self.assertIn("(no caption)", calls[0])
        self.assertEqual((posts[0]["hd"], posts[1]["hx"], "hd" in posts[1]), ("Bluebird on a snowy branch", 1, False))

    def test_the_prompt_says_never_guess_and_no_relative_days(self):
        self.assertIn("Never guess", bi.HD_RULES)
        self.assertIn("No relative days", bi.HD_RULES)

    def test_a_post_whose_picture_will_not_download_waits(self):
        rec = post("a", 1, c="nap")
        with mock.patch.object(wc, "pick_engine", return_value=self.ENGINE), mock.patch.object(wc, "ask_json") as ask, \
                mock.patch.object(bi, "fetch_thumb", return_value=None), mock.patch.object(bi, "log"):
            rep = bi.assign_titles([rec], {}, None, self.NOW)
        ask.assert_not_called()
        self.assertEqual((rep["no_picture"], {"hd", "ad", "hx"} & set(rec)), (1, set()))

    def test_each_post_s_picture_follows_its_own_line(self):
        rec = post("a", 1, c="A beagle")
        code = bi.hd_code(rec)
        got = bi.title_content({code: rec}, {code: ("image/jpeg", "AAAA")}, "")
        self.assertEqual([b["type"] for b in got], ["text", "image", "text"])
        self.assertIn(code, got[0]["text"])
        self.assertEqual(got[1]["source"]["data"], "AAAA")

    def test_a_carried_title_the_rules_now_refuse_is_asked_about_again(self):
        rec = post("a", 1, c="so good")
        _, calls = self.run_titles([rec], [{"items": [self.say(rec, "Trio plays Radio Bean")]}],
                                   {bi.post_key(rec): {"hd": "Trio plays Radio Bean tonight"}})
        self.assertEqual((len(calls), rec["hd"]), (1, "Trio plays Radio Bean"))

    def test_a_post_with_its_own_line_or_an_ad_never_reaches_a_model(self):
        posts = [post("a", 1, c="words", cp="Beagle naps on the couch"), post("b", 2, c="words", ad=1)]
        rep, calls = self.run_titles(posts, [])
        self.assertEqual((calls, rep["asked"]), ([], 0))

    def test_a_handle_never_goes_out_and_the_name_does(self):
        named = post("barkeatersvt", 1, c="Soup of the day", nm="Barkeaters Restaurant")
        _, calls = self.run_titles([named, post("barkeatersvt", 2, c="Soup again")], [{"items": []}])
        self.assertIn("Barkeaters Restaurant", calls[0])
        self.assertIn("unnamed", calls[0])
        self.assertNotIn("barkeatersvt", calls[0])

    def test_a_model_s_ad_counts_only_on_a_national_post(self):
        local, away = post("a", 1, c="Soup of the day"), post("b", 2, c="New tee in the shop", n=1)
        hedged = post("c", 3, c="Potato appreciation post", n=1)
        self.run_titles([local, away, hedged], [{"items": [
            self.say(local, "Soup of the day special", True), self.say(away, "", True),
            self.say(hedged, "Potatoes get their due", True)]}])
        self.assertEqual((local.get("hd"), "ad" in local, away.get("ad")), ("Soup of the day special", False, 1))
        self.assertEqual((hedged.get("hd"), "ad" in hedged), ("Potatoes get their due", False))     # an ad has no title

    def test_a_batch_with_a_bad_answer_is_split_and_only_the_bad_post_gets_hx(self):
        posts = [post(f"p{i}", i, c=f"caption {i}") for i in range(4)]
        bad = bi.hd_code(posts[2])
        calls = []

        def ask(engine, system, user, schema, max_tokens, **kw):
            lines = [b["text"] for b in user if b["type"] == "text"][:-1]
            calls.append(lines)
            if any(ln.startswith(bad) for ln in lines):
                err = wc.ModelError("response truncated at max_tokens")
                err.usage = {"in": 10, "out": 10, "calls": 1}
                raise err
            return {"items": [{"code": ln.split(" ")[0], "title": "Beagle naps on the couch", "ad": False}
                              for ln in lines]}, {"in": 10, "out": 10, "calls": 1}

        with mock.patch.object(wc, "pick_engine", return_value=self.ENGINE), mock.patch.object(wc, "ask_json", ask), \
                mock.patch.object(bi, "fetch_thumb", return_value=("image/jpeg", "AAAA")), mock.patch.object(bi, "log"):
            rep = bi.assign_titles(posts, {}, None, self.NOW)
        self.assertEqual([("hd" in r, "hx" in r) for r in posts],
                         [(True, False), (True, False), (False, True), (True, False)])
        self.assertEqual(rep["decided"], 4)
        self.assertEqual(len(calls), 5)      # all four, two, two, then the bad one alone and its neighbor

    def test_an_outage_is_not_a_bad_answer_and_stops_the_run(self):
        posts = [post(f"p{i}", i, c=f"caption {i}") for i in range(bi.HD_BATCH + 1)]
        err = wc.ModelError("timed out")
        err.usage = {"in": 0, "out": 0, "calls": 0}
        rep, calls = self.run_titles(posts, [err])
        self.assertEqual(len(calls), 1)
        self.assertFalse(any({"hd", "ad", "hx"} & set(r) for r in posts))

    def test_every_model_call_carries_a_short_timeout(self):
        seen = []

        def ask(engine, system, user, schema, max_tokens, **kw):
            seen.append(kw.get("timeout"))
            return {"items": []}, {"in": 1, "out": 1, "calls": 1}

        with mock.patch.object(wc, "pick_engine", return_value=self.ENGINE), mock.patch.object(wc, "ask_json", ask), \
                mock.patch.object(bi, "fetch_thumb", return_value=("image/jpeg", "AAAA")), mock.patch.object(bi, "log"):
            bi.assign_titles([post("a", 1, c="words")], {}, None, self.NOW)
            bi.assign_kinds([post("b", 2, c="words")], {}, {}, None, self.NOW, look=False)
        self.assertEqual(seen, [bi.MODEL_TIMEOUT_S] * 2)
        self.assertLess(bi.MODEL_TIMEOUT_S, 60)

    def test_a_timeout_turns_off_the_sdk_s_own_retries(self):
        client = mock.MagicMock()
        client.messages.create.side_effect = OSError("down")
        anthropic = mock.MagicMock()
        anthropic.Anthropic.return_value = client
        with mock.patch.dict(sys.modules, {"anthropic": anthropic}), mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "k"}), \
                self.assertRaises(wc.ModelError) as got, redirect_stderr(io.StringIO()):
            wc.ask_json(self.ENGINE, "s", "u", {"type": "object"}, 10, timeout=5)
        kw = anthropic.Anthropic.call_args.kwargs
        self.assertEqual((kw["timeout"], kw["max_retries"]), (5, 0))
        self.assertEqual(got.exception.usage["calls"], 0)

    def test_a_post_shipped_twice_is_asked_about_once(self):
        u = "https://www.instagram.com/p/same/"
        rostered, tagged = post("a", 1, u=u, c="Beagle on a boat"), post("a", 1, u=u, c="Beagle on a boat", s="tagged")
        rep, calls = self.run_titles([rostered, tagged], [{"items": [self.say(rostered, "Beagle rides a boat")]}])
        self.assertEqual((rostered["hd"], tagged["hd"], rep["asked"]), ("Beagle rides a boat",) * 2 + (1,))

    def test_every_post_goes_out_national_and_local_in_batches(self):
        posts = [post(f"p{i}", i, c="words", **({"n": 1} if i % 2 else {})) for i in range(bi.HD_BATCH + 1)]
        rep, calls = self.run_titles(posts, [{"items": []}, {"items": []}])
        self.assertEqual((len(calls), rep["asked"]), (2, len(posts)))
        self.assertIn("national", calls[0])
        self.assertIn("Burlington", calls[0])

    def test_no_key_or_a_failed_call_leaves_the_post_waiting(self):
        rec = post("a", 1, c="words")
        self.run_titles([rec], [], engine=None)
        self.assertFalse({"hd", "ad", "hx"} & set(rec))
        err = wc.ModelError("bad")
        err.usage = {"in": 500, "out": 0, "calls": 0}
        ledger = {}
        self.run_titles([rec], [err], ledger=ledger)
        self.assertFalse({"hd", "ad", "hx"} & set(rec))
        self.assertGreater(ledger["ai"]["usd"], 0)                    # a failed call is still billed

    def test_the_spend_lands_in_the_ledger_under_the_cap_and_kinds_keep_room(self):
        ledger = {"ai": {"month": "2026-11", "usd": 0.1, "runs": []}}
        self.run_titles([post("a", 1, c="words")], [{"items": []}], ledger=ledger)
        self.assertGreater(ledger["ai"]["usd"], 0.1)
        self.assertEqual(ledger["ai"]["runs"][-1]["model"], "claude-haiku-5-5")
        stop = bi.AI_MONTH_CAP_USD - bi.HD_LEAVES_USD
        self.assertGreater(bi.AI_MONTH_CAP_USD, stop)
        ledger = {"ai": {"month": "2026-11", "usd": stop, "runs": []}}
        rep, calls = self.run_titles([post("a", 1, c="words")], [], ledger=ledger)
        self.assertEqual(calls, [])

    def test_the_cap_and_the_clock_are_checked_before_every_call(self):
        posts = [post(f"p{i}", i, c="words") for i in range(bi.HD_BATCH + 1)]
        ledger = {"ai": {"month": "2026-11", "usd": bi.AI_MONTH_CAP_USD - bi.HD_LEAVES_USD - 0.0001, "runs": []}}
        rep, calls = self.run_titles(posts, [{"items": []}, {"items": []}], ledger=ledger)
        self.assertEqual(len(calls), 1)
        with mock.patch.object(bi, "HD_TIME_S", -1):
            rep, calls = self.run_titles(posts, [])
        self.assertEqual(calls, [])

    def test_the_rules_hold_even_if_the_model_forgets_them(self):
        for bad in ("", "Too short", "One two three four five six seven eight nine", "Beagle on a boat #dogs",
                    "Beagle tags @someone on a boat", "Beagle on a boat \U0001F436", "lowercase beagle on a boat",
                    "BEAGLE ON A BOAT TODAY", "\"Beagle on a boat\" says owner", None):
            self.assertIsNone(bi.clean_hd(bad, True), bad)
        self.assertEqual(bi.clean_hd("Beagle rides on a boat.", True), "Beagle rides on a boat")
        self.assertEqual(bi.clean_hd("  Three  good words ", True), "Three good words")

    def test_a_private_name_stays_off_a_local_tile_and_a_national_one_may_stand(self):
        self.assertIsNone(bi.clean_hd("Sarah Jones joins the kitchen", False))
        self.assertEqual(bi.clean_hd("Taylor Swift adopts a beagle", True), "Taylor Swift adopts a beagle")

    def test_a_title_that_breaks_the_rules_gets_one_more_try_then_no_more(self):
        rec = post("a", 1, c="words")
        _, calls = self.run_titles([rec], [{"items": [self.say(rec, "Sarah Jones joins the kitchen")]},
                                           {"items": [self.say(rec, "New chef joins the kitchen")]}])
        self.assertEqual((rec["hd"], len(calls)), ("New chef joins the kitchen", 2))
        self.assertIn("job or group", calls[1])
        rec = post("b", 2, c="words")
        wordy = "One two three four five six seven eight nine"
        _, calls = self.run_titles([rec], [{"items": [self.say(rec, wordy)]}, {"items": [self.say(rec, wordy)]}])
        self.assertEqual((rec["hx"], "hd" in rec, len(calls)), (1, False, 2))  # an answer all the same: not paid for again

    def test_an_empty_title_is_taken_at_its_word(self):
        rec = post("a", 1, c="words")
        _, calls = self.run_titles([rec], [{"items": [self.say(rec)]}])
        self.assertEqual((rec["hx"], len(calls)), (1, 1))

    def test_a_title_survives_the_account_being_read_again(self):
        doc = answer()
        now = doc["fetched_at"]
        b = Build()
        b.setUp()
        roster = [{"h": "foambrewers", "tier": 1, "category": "venue"}]
        with tempfile.TemporaryDirectory() as tmp:
            _, got, led = b.run_main(tmp, roster, ["--only", "foambrewers", "--no-carry"], lambda h, k: doc["items"], now,
                                     {"month": bi.month_key(bi.local_day(now)), "spent": 0, "last": {}})
            got["posts"][0].update(hd="Foam pours a new beer", c="so good")
            got["posts"][1]["ad"] = 1
            (Path(tmp) / "instagram.json").write_text(json.dumps(got))
            _, again, _ = b.run_main(tmp, roster, ["--only", "foambrewers"], lambda h, k: [dict(it, caption={"text": "so good"}) for it in doc["items"]], now + 60, led)
        by_u = {p["u"]: p for p in again["posts"]}
        self.assertEqual(by_u[got["posts"][0]["u"]]["hd"], "Foam pours a new beer")
        self.assertEqual(by_u[got["posts"][1]["u"]]["ad"], 1)
        self.assertEqual((again["titled"], again["ads"]), (1, 1))

    def test_a_title_crash_still_writes_the_payload(self):
        doc = answer()
        now = doc["fetched_at"]
        b = Build()
        b.setUp()
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(bi, "assign_titles", side_effect=RuntimeError("boom")):
            code, got, _ = b.run_main(tmp, [{"h": "foambrewers", "tier": 1, "category": "venue"}],
                                      ["--only", "foambrewers", "--no-carry"], lambda h, k: doc["items"], now,
                                      {"month": bi.month_key(bi.local_day(now)), "spent": 0, "last": {}})
        self.assertEqual((code, bool(got["posts"])), (0, True))

    def test_a_title_and_a_headline_verdict_are_sonnet(self):
        self.assertAlmostEqual(wc.cost_usd("claude-sonnet-5-5", {"in": 1_000_000, "out": 1_000_000, "cache_read": 1_000_000}),
                               12.20)
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "k", "OPENROUTER_API_KEY": ""}):
            self.assertEqual(wc.pick_engine("title")["model"], "claude-sonnet-5-5")
            self.assertEqual(wc.pick_engine("judge")["model"], "claude-sonnet-5-5")
            self.assertEqual(wc.pick_engine("tag")["model"], "claude-haiku-5-5")
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "", "OPENROUTER_API_KEY": "k"}):
            self.assertIsNone(wc.pick_engine("title"))
            self.assertIsNone(wc.pick_engine("judge"))

    def test_sonnet_is_called_without_the_opus_beta_or_a_thinking_switch(self):
        client = mock.MagicMock()
        wc._create(client, dict(self.ENGINE, model="claude-sonnet-5-5"), "sys", "user", {"type": "object"}, 100, 1)
        kw = client.messages.create.call_args.kwargs
        client.beta.messages.create.assert_not_called()
        self.assertNotIn("thinking", kw)
        self.assertEqual(kw["output_config"]["effort"], "low")


class Captions(unittest.TestCase):
    """The free step: a caption's own first sentence, or a gap."""

    def test_tags_and_emoji_come_off_and_the_first_sentence_stays(self):
        for raw, want in (
                ("Beagle steals a sandwich. Then he naps.", "Beagle steals a sandwich"),
                ("Best day ever on the lake #vermont #fall", "Best day ever on the lake"),
                ("#tinydesk \u2022 Rocky Horror plays the Desk", "Rocky Horror plays the Desk"),
                ("\U0001F6A8New exhibition alert for all! Relive the party", "New exhibition alert for all!"),
                ("Happy Halloween from the shop \U0001F383 We close at 5", "Happy Halloween from the shop"),
                ("It is fall at last! We think so.", "It is fall at last!"),
                ("  Lots   of   room  here  ", "Lots of room here")):
            self.assertEqual(bi.clean_caption(raw), want, raw)

    def test_a_full_stop_in_a_name_or_a_price_does_not_end_the_sentence(self):
        self.assertEqual(bi.clean_caption("St. Patrick came to Mt. Mansfield today. Next week"),
                         "St. Patrick came to Mt. Mansfield today")
        self.assertEqual(bi.clean_caption("Pints are $2.50 all week long. Come by"), "Pints are $2.50 all week long")

    def test_styled_letters_become_plain_and_a_number_sign_is_not_a_hashtag(self):
        self.assertEqual(bi.clean_caption("\U0001D405\U0001D42B\U0001D41A\U0001D426\U0001D41E\U0001D42C "
                                          "\U0001D42D\U0001D428\U0001D42D\U0001D41A\U0001D425 up today"), "Frames total up today")
        self.assertEqual(bi.clean_caption("#1 Hit Jam is back by popular demand."), "#1 Hit Jam is back by popular demand")

    def test_a_keycap_keeps_its_digit(self):
        self.assertEqual(bi.clean_caption("Game 7\ufe0f\u20e3 tonight at the Gut"), "Game 7 tonight at the Gut")

    def test_gaps(self):
        for raw in ("", None, "so good", "#sunset #lake", "\U0001F436\U0001F525", "O k",
                    "We had a blast at @pipeline's event last Friday!",   # no sentence once the handle goes
                    "Thanks @x for coming out", "@alwaysfull is a gem downtown",
                    "Come see #burlington from the top of the hill",
                    "Great night of music on stage with #friends",
                    "A long night of music with @band",
                    "word " * 40):
            self.assertEqual(bi.clean_caption(raw), "", raw)

    def test_a_line_that_asks_or_orders_says_nothing_about_the_post(self):
        for raw in ("Which is your favorite?", "Who remembers this one?!", "Not near our Middlebury cafe?",
                    "Comment \u2018dad\u2019 on this post for an extra dad joke straight to your DMs",
                    "check caption for LOTS MORE And save this for your next coffee outing!",
                    "Edmond Spence Concave Dresser DM us!", "Shop the new rack in store now"):
            self.assertEqual(bi.clean_caption(raw), "", raw)

    def test_a_venue_saying_what_is_on_is_not_an_order(self):
        self.assertEqual(bi.clean_caption("Join us for a screening at Shelburne Farms!"),
                         "Join us for a screening at Shelburne Farms!")

    def test_three_words_or_fewer_is_a_gap(self):
        for raw in ("Two scientists arrive", "For consultations please", "LIMITED TIME ONLY\u203c", "10/26/26, 5:45pm 2026 today"):
            self.assertEqual(bi.clean_caption(raw), "", raw)

    def test_a_cut_off_sentence_is_a_gap(self):
        for raw in ("KIDS EAT FREE at Waterworks, Sunday through Thursday starting \U0001F35F at 4pm",
                    "Message received: the winners of the Local Motion seasonal raffle are \U0001F389 here",
                    "[pyramidz] out now on soundcloud (Never done a cover before",
                    "[EDIT: fully funded in 39 minutes!"):
            self.assertEqual(bi.clean_caption(raw), "", raw)

    def test_a_line_that_lost_its_object_to_a_tag_is_a_gap(self):
        for raw in ("Best coffee in #Burlington!", "Proud to support #VermontFoodbank", "#Burlington is the best place to live!"):
            self.assertEqual(bi.clean_caption(raw), "", raw)

    def test_a_line_that_ends_before_its_tags_stays(self):
        self.assertEqual(bi.clean_caption("Fall colors over Stowe today #vermont #foliage"), "Fall colors over Stowe today")
        self.assertEqual(bi.clean_caption("#vermont Fall colors over Stowe today"), "Fall colors over Stowe today")

    def test_another_script_or_a_short_foreign_line_is_a_gap(self):
        for raw in ("hi I\u2019m a moth \U0001098D a little demonstration", "Feliz Navidad a todos nuestros amigos",
                    "Joyeux No\u00ebl \u00e0 tous nos amis", "Frohe Weihnachten an alle unsere Freunde",
                    "Feliz Natal a todos os nossos amigos", "Hum do humare do bhai"):
            self.assertEqual(bi.clean_caption(raw), "", raw)

    def test_anything_that_is_not_a_string_is_a_gap(self):
        for raw in (None, 7, b"Beagle steals a sandwich", ["Beagle steals a sandwich"]):
            self.assertEqual(bi.clean_caption(raw), "", raw)

    def test_a_relative_day_is_fine_for_a_day_and_a_gap_after(self):
        now = at(2026, 11, 1)
        new, old = post("a", now - 3600, c="Tonight at 5pm the gallery opens late"), \
            post("b", now - 2 * 86400, c="Tonight at 5pm the gallery opens late")
        bi.mark_captions([new, old], None, now)
        self.assertEqual(("cp" in new, "cp" in old), (True, False))
        for line in ("Tonight the gallery opens late", "POSSESSED is back this Saturday", "The sale ends tomorrow at noon",
                     "Trivia comes back next week", "We open at noon today", "Regatta on the lake this weekend"):
            rec = post("c", now - 2 * 86400, c=line)
            bi.mark_captions([rec], None, now)
            self.assertNotIn("cp", rec, line)

    def test_a_day_of_the_week_alone_is_the_account_s_own_words(self):
        now = at(2026, 11, 1)
        rec = post("a", now - 5 * 86400, c="Top reasons to join us every Wednesday at Skiff")
        bi.mark_captions([rec], None, now)
        self.assertEqual(rec["cp"], "Top reasons to join us every Wednesday at Skiff")

    def test_a_line_that_goes_stale_gives_way_to_a_title_and_a_carried_title_comes_back(self):
        now = at(2026, 11, 1)
        rec = post("a", now - 2 * 86400, c="Tonight the gallery opens late", cp="Tonight the gallery opens late")
        bi.mark_captions([rec], {bi.post_key(rec): {"hd": "Gallery opens late for the show", "hs": 1}}, now)
        self.assertEqual((rec["hd"], rec["hs"], "cp" in rec), ("Gallery opens late for the show", 1, False))

    def test_a_title_from_before_the_caption_s_day_went_by_is_asked_about_once_more(self):
        now = at(2026, 11, 1)
        rec = post("a", now - 1.3 * 86400, kind="vibe", nm="Martha", c="last market of the summer! 9:00 to 2:00 today",
                   hd="Last Burlington farmers market of the season")
        bi.mark_captions([rec], {}, now)
        self.assertNotIn("hd", rec)
        said = bi.read_hd([{"code": "x", "title": "Pet costumes at the farmers market", "ad": False}], {"x": rec}, True, now)
        self.assertEqual(said["x"], {"hd": "Pet costumes at the farmers market", "hs": 1})
        rec.update(said["x"])
        bi.mark_captions([rec], {}, now)
        self.assertEqual((rec["hd"], rec["hs"]), ("Pet costumes at the farmers market", 1))

    def test_a_caption_s_day_going_by_only_touches_local_posts_on_their_own_day(self):
        now = at(2026, 11, 1)
        self.assertFalse(bi.caption_passed(post("a", now - 2 * 86400, n=1, c="Today we ate well"), now))
        self.assertFalse(bi.caption_passed(post("a", now - 2 * 86400, c="Back on Oct 3 we opened"), now))
        self.assertFalse(bi.caption_passed(post("a", now - 3600, c="Open today til 5"), now))
        self.assertFalse(bi.caption_passed(post("a", now - 2 * 86400, c="Today we said it, and see you Nov 14"), now))
        self.assertTrue(bi.caption_passed(post("a", now - 2 * 86400, c="Open today til 5"), now))
        self.assertTrue(bi.caption_passed(post("a", now - 2 * 86400, c="See you on Oct 31"), now))

    def test_the_title_call_is_told_the_day_a_post_went_up(self):
        rec = post("a", at(2026, 10, 31), nm="Martha", c="9 to 2 today")
        self.assertIn("posted Oct 31 · 9 to 2 today", bi.hd_line("x", rec))

    def test_a_poster_s_line_has_to_say_when(self):
        now = at(2026, 11, 1)
        rec = post("a", now - 86400, kind="poster",
                   c="Unconventional pairings tend to hit the palate just right… so we host a rap night November 21st")
        bi.mark_captions([rec], None, now)
        self.assertNotIn("cp", rec)
        rec = post("a", now - 86400, kind="poster", c="Jazz trio plays the bar on November 21. Doors at 7")
        bi.mark_captions([rec], None, now)
        self.assertEqual(rec["cp"], "Jazz trio plays the bar on November 21")
        rec = post("a", now - 86400, kind="food", c="A new soup is on the menu today. Back Nov 21")
        bi.mark_captions([rec], None, now)
        self.assertEqual(rec["cp"], "A new soup is on the menu today")

    def test_a_carried_gap_keeps_its_title_or_its_note(self):
        one, two = post("a", 1, c="so good"), post("b", 2, c="so good")
        bi.mark_captions([one, two], {bi.post_key(one): {"hd": "Beagle naps on the couch"}, bi.post_key(two): {"hx": 1}})
        self.assertEqual((one["hd"], two["hx"]), ("Beagle naps on the couch", 1))

    def test_a_line_that_stops_on_a_small_word_is_a_gap(self):
        self.assertEqual(bi.clean_caption("Tonight we are playing a show with #friends"), "")

    def test_language_is_measured_on_the_accounts_that_post_in_other_ones(self):
        for raw in ("pas du tout excessif quand il dit bonjour \U0001F602 beagle beaglelife",
                    "Maalik hai ghar ka \U0001FAF6 (Dog, dog mom, funny, relatable)",
                    "Heute zeige ich euch den wohl einfachsten und schnellsten IKEA Hack",
                    "Designerlampe aus einem alten Kaffeeglas?",
                    "\u0928\u092e\u0938\u094d\u0924\u0947 \u0926\u094b\u0938\u094d\u0924\u094b\u0902 \u0915\u0948\u0938\u0947 \u0939\u094b"):
            self.assertEqual(bi.clean_caption(raw), "", raw)
        for raw in ("Fresh pour on Main Street tonight", "Du Nord lands at the bar", "Le Bon Vivant opens on Pine Street",
                    "Big Sur sunsets from the road"):
            self.assertEqual(bi.clean_caption(raw), raw, raw)

    def test_mark_captions_sorts_every_post_for_nothing(self):
        posts = [post("a", 1, c="Beagle steals a sandwich. Yes."), post("b", 2, c="so good"),
                 post("c", 3, c="New rack is in! #ad"), post("d", 4)]
        keep = dict(posts[0])
        bi.mark_captions(posts)
        self.assertEqual(posts[0]["cp"], "Beagle steals a sandwich")
        self.assertEqual(posts[0]["c"], keep["c"])
        self.assertFalse({"cp", "ad"} & set(posts[1]))
        self.assertEqual((posts[2]["ad"], "cp" in posts[2]), (1, False))
        self.assertFalse({"cp", "ad"} & set(posts[3]))

    def test_a_clean_line_replaces_an_older_title_and_a_gap_keeps_its_own(self):
        posts = [post("a", 1, c="Beagle steals a sandwich", hd="Old title here"), post("b", 2, c="so good", hd="Kept title here")]
        bi.mark_captions(posts)
        self.assertEqual(("hd" in posts[0], posts[1]["hd"]), (False, "Kept title here"))

    def test_a_local_line_that_names_someone_or_gives_a_number_is_a_gap_and_a_national_one_is_not(self):
        cap = "Congrats to Sarah Jones on her retirement"
        posts = [post("a", 1, c=cap), post("b", 2, c=cap, n=1), post("c", 3, c="Text 802 245 3485 for your next tattoo")]
        bi.mark_captions(posts)
        self.assertEqual(["cp" in r for r in posts], [False, True, False])

    def test_an_ad_stays_an_ad_when_the_account_is_read_again(self):
        rec = post("a", 1, c="Beagle steals a sandwich")
        bi.mark_captions([rec], {bi.post_key(rec): {"ad": 1}})
        self.assertEqual((rec["ad"], "cp" in rec), (1, False))


class TitleRules(unittest.TestCase):
    def test_no_relative_day_and_no_day_of_the_week(self):
        for t in ("Trio plays Radio Bean tonight", "Sale ends this Saturday", "Musician plays Monkey House next Wednesday",
                  "Told Slant plays the Monkey House Thursday", "Market opens tomorrow at nine"):
            self.assertIsNone(bi.clean_hd(t, True), t)

    def test_a_date_a_habit_and_a_name_are_not_relative(self):
        for t in ("Told Slant plays the Monkey House Oct 23", "Trivia at the pub every Thursday",
                  "Black Friday deals at the mall", "Saturday Night Live cold open airs",
                  "Tattoo flash event on Friday the 13th"):
            self.assertEqual(bi.clean_hd(t, True), t)

    def test_contact_details_a_question_and_a_broken_end_are_refused(self):
        for t in ("Call 802-555-1212 to book tickets", "Jane lives at 12 Oak Street now",
                  "Is this the best pizza around?", "Anderson .Paak and Cordae premiere set for next",
                  "Comic about a strange planet and a"):
            self.assertIsNone(bi.clean_hd(t, True), t)

    def test_an_order_is_not_a_title_and_a_shop_is_not_an_order(self):
        self.assertIsNone(bi.clean_hd("DM us for the dresser", True))
        self.assertEqual(bi.clean_hd("Shop buys used clothing all week", True), "Shop buys used clothing all week")


class SadPosts(unittest.TestCase):
    NOW = at(2026, 11, 1)

    def run_kinds(self, posts, said):
        with mock.patch.object(wc, "pick_engine", return_value={"provider": "anthropic", "model": "claude-haiku-5-5"}), \
                mock.patch.object(wc, "ask_json", lambda *a, **k: (said, {"in": 1, "out": 1, "calls": 1})), \
                mock.patch.object(bi, "log"):
            bi.assign_kinds(posts, {}, {}, None, self.NOW)

    def test_a_national_post_takes_the_flag_only_in_a_feed_and_a_local_one_from_its_own_rule(self):
        posts = [post("a", 1, c="A sad story", n=1, t="dogs", category="national"),
                 post("b", 2, c="A sad story", n=1, category="national"), post("c", 3, c="A sad story", category="pets")]
        self.run_kinds(posts, {"kinds": [{"i": i, "kind": "pets", "sure": True, "ad": False, "sad": True} for i in range(3)]})
        self.assertEqual([r.get("sad") for r in posts], [1, None, 1])
        self.assertIn("A Burlington post: true only for an", bi.KIND_RULES)

    def test_the_schema_asks_it_and_the_rules_say_what_it_is(self):
        self.assertIn("sad", bi.kind_schema(True)["properties"]["kinds"]["items"]["properties"])
        self.assertIn("sad, for a national post", bi.KIND_RULES)
        for word in ("death", "grief", "injury", "abuse", "politics"):
            self.assertIn(word, bi.KIND_RULES)

    def test_what_the_call_can_miss_a_word_list_catches_for_nothing(self):
        for cap in ("ICE Agent, 7-Year-Old Both Wearing Same Costume", "poof! #comic #maga #bots"):
            rec = post("a", 1, c=cap, n=1, t="laughs")
            bi.mark_captions([rec])
            self.assertEqual(rec.get("sad"), 1, cap)
        rec = post("a", 1, c="The ice agents of change", n=0, t="laughs")
        bi.mark_captions([rec])
        self.assertNotIn("sad", rec)

    def test_a_sad_post_keeps_its_line(self):
        rec = post("a", 1, c="We mourn the passing of a great captain", n=1, t="wild", sad=1)
        bi.mark_captions([rec])
        self.assertEqual((rec["cp"], rec["sad"]), ("We mourn the passing of a great captain", 1))


    def test_a_local_election_post_takes_the_flag_for_nothing(self):
        rec = post("a", 1, c="How we can protect this election: a training")
        bi.mark_captions([rec])
        self.assertEqual(rec["sad"], 1)

    def test_a_visit_to_the_oval_office_and_a_tribute_are_caught(self):
        for cap in ("Welcome to the Oval Office, Artemis III Crew!", "Rest easy, Captain."):
            rec = post("a", 1, c=cap, n=1, t="wild")
            bi.mark_captions([rec])
            self.assertEqual(rec.get("sad"), 1, cap)

    def test_a_local_town_meeting_is_not_politics_here(self):
        rec = post("a", 1, c="The mayor spoke to the City Council on Monday night")
        bi.mark_captions([rec])
        self.assertNotIn("sad", rec)


class Dates(unittest.TestCase):
    NOW = at(2026, 11, 1)
    OCT = at(2026, 10, 20)

    def last(self, text, ts=None):
        got = bi.last_date(text, ts or self.OCT)
        return got.isoformat() if got else None

    def test_every_way_a_date_gets_written(self):
        for text, want in (("Told Slant plays Oct 23", "2026-10-23"), ("Comedy shows Oct 28-31", "2026-10-31"),
                           ("Tour dates Oct 21 to 25", "2026-10-25"), ("Shows Oct 26 to Nov 1", "2026-11-01"),
                           ("Zombio plays Oct 29 and 30", "2026-10-30"), ("Thursday, October 29, 2026, 6-9pm", "2026-10-29"),
                           ("closes Nov. 1 for winter", "2026-11-01"), ("the 15th of October 22nd", "2026-10-22"),
                           ("we are closed on friday (10/16)!", "2026-10-16"), ("Saturday 10/17 at noon", "2026-10-17"),
                           ("today only 10/30", "2026-10-30"), ("10-31-2026 at the barn", "2026-10-31"),
                           ("10/29/26, 5:35-5:42", "2026-10-29")):
            self.assertEqual(self.last(text), want, text)

    def test_what_only_looks_like_a_date(self):
        for text in ("Add 3/4 cup of flour", "this dog is 10/10", "Open 24/7", "May 5pm work", "Doors at 7"):
            self.assertIsNone(self.last(text), text)

    def test_a_date_long_before_its_post_is_next_year(self):
        self.assertEqual(self.last("New Year show Jan 3", at(2026, 12, 20)), "2027-01-03")

    def test_a_line_whose_date_has_passed_is_a_gap_and_a_day_of_grace_is_given(self):
        rec = post("a", self.OCT, c="Jazz night at the Cider House on Oct 31", kind="vibe")
        bi.mark_captions([rec], now=self.NOW)
        self.assertNotIn("cp", rec)
        rec = post("a", self.OCT, c="Jazz night at the Cider House on Nov 1", kind="vibe")
        bi.mark_captions([rec], now=self.NOW)
        self.assertIn("cp", rec)

    def test_a_named_day_lasts_a_week(self):
        for ago, there in ((3, True), (9, False)):
            rec = post("a", self.NOW - ago * 86400, c="The band plays here on Friday at nine", kind="vibe")
            bi.mark_captions([rec], now=self.NOW)
            self.assertEqual("cp" in rec, there, ago)

    def test_a_title_with_a_passed_date_is_asked_for_again(self):
        rec = post("a", self.OCT, c="", kind="scenic", n=1)
        self.assertIsNone(bi.clean_hd("Orange sunset over a lake on Oct 29", True, rec, self.NOW))
        self.assertEqual(bi.clean_hd("Orange sunset over a lake", True, rec, self.NOW), "Orange sunset over a lake")
        got = post("a", self.OCT, c="sunset", kind="scenic", n=1)
        self.assertEqual(bi.carried_line(got, {"hd": "Orange sunset over a lake on Oct 29"}, self.NOW), {})

    def test_a_poster_for_a_show_that_has_happened_is_gone_and_stays_gone(self):
        rec = post("a", self.OCT, c="Come out!", kind="poster", hd="Told Slant plays The Monkey House Oct 23")
        bi.mark_captions([rec], now=self.NOW)
        self.assertEqual((rec.get("gone"), rec.get("hd"), rec.get("cp")), (1, None, None))
        again = post("a", self.OCT, c="Come out!", kind="poster")
        bi.mark_captions([again], {bi.post_key(again): {"gone": 1}}, self.NOW)
        self.assertEqual(again.get("gone"), 1)

    def test_a_poster_is_over_by_its_caption_and_only_by_its_last_date(self):
        done = post("a", self.OCT, c="Fresh art on October 31st", kind="poster")
        coming = post("b", self.OCT, c="Round one Oct 23, the final Nov 6", kind="poster")
        bi.mark_captions([done, coming], now=self.NOW)
        self.assertEqual((done.get("gone"), coming.get("gone")), (1, None))

    def test_a_week_old_poster_with_only_a_day_is_over(self):
        rec = post("a", self.NOW - 9 * 86400, c="Who is ready to rock this Friday?", kind="poster")
        bi.mark_captions([rec], now=self.NOW)
        self.assertEqual(rec.get("gone"), 1)
        rec = post("a", self.NOW - 9 * 86400, c="Trivia every Friday", kind="poster")
        bi.mark_captions([rec], now=self.NOW)
        self.assertIsNone(rec.get("gone"))

    def test_only_a_poster_goes(self):
        rec = post("a", self.OCT, c="Thanks for coming on Oct 23, it was great", kind="vibe")
        bi.mark_captions([rec], now=self.NOW)
        self.assertNotIn("gone", rec)

    def test_a_gone_post_never_reaches_a_title_call(self):
        rec = post("a", self.OCT, c="Show Oct 23", kind="poster", gone=1)
        with mock.patch.object(wc, "pick_engine", side_effect=AssertionError("no call")):
            self.assertEqual(bi.assign_titles([rec], {}, None, self.NOW)["asked"], 0)

    def test_the_model_is_told_the_date(self):
        rec = post("a", self.OCT, c="so good", n=1)
        seen = []

        def ask(engine, rules, content, *a, **k):
            seen.append(content[-1]["text"])
            return {"items": []}, {"in": 1, "out": 1, "calls": 1}

        with mock.patch.object(wc, "pick_engine", return_value={"provider": "anthropic", "model": "claude-sonnet-5-5"}), \
                mock.patch.object(wc, "ask_json", ask), mock.patch.object(bi, "fetch_thumb", return_value=("image/jpeg", "x")), \
                mock.patch.object(bi, "log"):
            bi.assign_titles([rec], {}, None, self.NOW)
        self.assertIn("Today is Nov 1, 2026.", seen[0])


class Held(unittest.TestCase):
    def test_a_sad_or_gone_post_is_held_back_from_the_page(self):
        posts = [post("a", 1, n=1, s="do", sad=1, hd="Line goes here"), post("b", 2, s="see", gone=1),
                 post("c", 3, s="see", cp="Line goes here")]
        got = bi.payload(posts)
        self.assertEqual(([p["h"] for p in got["posts"]], [p["h"] for p in got["held"]]), (["c"], ["a", "b"]))
        self.assertEqual((got["sad"], got["gone"], got["captioned"], got["handles"]), (1, 1, 1, ["c"]))

    def test_a_post_with_no_line_ships_no_caption(self):
        posts = [post("a", 1, s="see", c="Text 802 245 3485 for your next tattoo", hx=1),
                 post("b", 2, s="see", c="so good", cp="so good")]
        got = bi.payload(posts)
        self.assertNotIn("c", got["posts"][0])
        self.assertEqual(got["posts"][1]["c"], "so good")

    def test_a_post_that_lost_its_caption_keeps_its_verdict(self):
        rec = post("a", 1, hx=1)
        bi.mark_captions([rec], {bi.post_key(rec): {"hx": 1}})
        self.assertEqual(rec.get("hx"), 1)


class Filler(unittest.TestCase):
    def test_a_filler_account_gets_no_line_from_its_caption(self):
        rec = post("dadsaysjokes", 1, c="Star Wars became hugely popular because it was a great adventure story")
        bi.mark_captions([rec])
        self.assertNotIn("cp", rec)

    def test_bait_is_a_gap(self):
        for cap in ("DROP YOUR GUESSES IN THE COMMENTS", "WARNING: Scroll if you dare!"):
            self.assertEqual(bi.clean_caption(cap), "", cap)

    def test_comment_a_word_for_the_link_is_selling_off_a_local_account(self):
        cap = "A bench. For everything we used, just comment SHOP and I'll send the link"
        self.assertTrue(bi.is_ad({"c": cap, "n": 1}))
        self.assertFalse(bi.is_ad({"c": cap}))
        self.assertFalse(bi.is_ad({"c": "Beagles comment on everything", "n": 1}))

    def test_a_press_office_label_comes_off(self):
        self.assertEqual(bi.clean_caption("(News Release) Most park roads will close for winter."),
                         "Most park roads will close for winter")


class Counts(unittest.TestCase):
    def test_every_top_level_number_comes_from_the_posts(self):
        posts = [post("a", 1, n=1, s="do", category="national", kind="pets", sad=1, hd="Title goes here"),
                 post("b", 2, s="see", category="food", kind="food", f=1, cp="Line goes here", vu="v", kd=1),
                 post("b", 3, s="tagged", category="food", kind="food", ad=1)]
        got = bi.payload_counts(posts)
        self.assertEqual((got["national"], got["sad"], got["titled"], got["captioned"], got["ads"], got["videos"],
                          got["food"], got["kinds_defaulted"], got["handles"]), (1, 1, 1, 1, 1, 1, 1, 1, ["a", "b"]))
        self.assertEqual((got["categories"]["food"], got["kinds"]["food"], got["segments"]["see"]),
                         (2, 2, {"posts": 1, "accounts": 1}))


class ProfileNames(unittest.TestCase):
    def test_a_name_comes_clean(self):
        for raw, want in (("Michelle Kolbeck | DIY \u2022 IKEAHACK \u2022 INTE", "Michelle Kolbeck"),
                          ("\U0001D405\U0001D42E\U0001D425\U0001D41D\U0001D41E\U0001D427 \u00d6\U0001D424\U0001D42C\u00fc\U0001D433 | \U0001D409\U0001D41A\U0001D429\U0001D41A\U0001D427\U0001D41D\U0001D422", "Fulden \u00d6ks\u00fcz"),
                          ("MLB \u26be", "MLB"), ("\U0001F33FJungalow\u00ae", "Jungalow"), ("Hanne | DIY & Renovation", "Hanne"),
                          ("Penny Cluse Cafe", "Penny Cluse Cafe"), ("Stranger Things - On Broadway", "Stranger Things"),
                          ("The Very Long Name Of A Place That Goes On And On Forever", "The Very Long Name Of A Place That Goes"),
                          ("\U0001F436\U0001F525", ""), ("", ""), (None, "")):
            self.assertEqual(bi.clean_name(raw), want, raw)
            self.assertLessEqual(len(want), 40)

    def test_own_name_uses_it(self):
        item = {"user": {"username": "mlb", "full_name": "MLB \u26be"}}
        self.assertEqual(bi.own_name("mlb", [item], True), "MLB")


class Ads(unittest.TestCase):
    def test_every_form_of_a_declared_ad(self):
        for cap in ("Dinner is served #paidpartnership", "New chair #sponsoredpost", "Love this #gifted", "#paidad a good one",
                    "Ad: the best new chair", "Sponsored: a word on chairs"):
            self.assertTrue(bi.is_ad(post("a", 1, c=cap)), cap)

    def test_a_national_presenter_or_a_shouted_sale_is_a_plug_and_a_local_one_is_news(self):
        for cap in ("The Internet Invitational. Season 2. Presented by @dunkin", "KO of the Year! Buy #CaneloMbilli NOW at DAZN.com"):
            self.assertTrue(bi.is_ad(post("a", 1, c=cap, n=1)), cap)
            self.assertFalse(bi.is_ad(post("a", 1, c=cap)), cap)
        self.assertFalse(bi.is_ad(post("a", 1, c="We buy a lot of beans and now we roast them", n=1)))

    def test_a_partner_who_is_not_a_brand_is_not_an_ad(self):
        for cap in ("Me and my #lifepartner", "My #dancepartner is the best", "#businesspartner goals", "Added to the menu: chairs"):
            self.assertFalse(bi.is_ad(post("a", 1, c=cap)), cap)

    def test_the_rules_read_past_the_1000_character_cut(self):
        doc = answer()
        now = doc["fetched_at"]
        tail = dict(doc["items"][0], is_paid_partnership=False, caption={"text": "word " * 300 + "#ad"})
        rec = bi.post_record("a", tail, now - 10 ** 8, now)
        self.assertEqual((rec["ad"], len(rec["c"])), (1, 1000))
        coded = dict(doc["items"][0], is_paid_partnership=False, caption={"text": "word " * 300 + "use code DOG"})
        self.assertNotIn("ad", bi.post_record("a", coded, now - 10 ** 8, now))
        self.assertEqual(bi.post_record("a", coded, now - 10 ** 8, now, national=True)["ad"], 1)

    def test_the_kind_call_sees_a_national_caption_s_end(self):
        c = "word " * 100 + "Presented by Dunkin"
        self.assertIn("Presented by Dunkin", bi.kind_line(0, post("a", 1, c=c, n=1), {}))
        self.assertNotIn("Presented by Dunkin", bi.kind_line(0, post("a", 1, c=c), {}))

    def test_the_rules_name_the_plugs_the_rules_cannot_see(self):
        for words in ("Presented by", "Buy ... NOW", "clothing label"):
            self.assertIn(words, bi.KIND_RULES)
            self.assertIn(words, bi.HD_RULES)

    def test_what_a_caption_declares_counts_on_any_account(self):
        for cap in ("Bright holiday #ad", "#ScotchBritePartner Planning a party", "#violifepartner dairy free",
                    "#sponsored by nobody", "In paid partnership with Foam", "Fall trip [A D] to Vermont"):
            self.assertTrue(bi.is_ad(post("a", 1, c=cap)), cap)

    def test_a_local_shop_selling_its_own_goods_is_not_an_ad(self):
        for cap in ("Use code FALL20 for 20% off the rack", "The Devil Makes Three presale: use code DM3HG",
                    "New merch in the taproom", "Our partners at the market are here", "Trivia sponsored by Foam"):
            self.assertFalse(bi.is_ad(post("a", 1, c=cap)), cap)

    def test_off_a_local_account_a_code_counts(self):
        self.assertTrue(bi.is_ad(post("a", 1, c="Use my code BEAGLE for 10% off", n=1)))
        self.assertTrue(bi.is_ad(post("a", 1, c="A series sponsored by @speed", n=1)))

    def test_the_api_s_flag_lands_on_the_post(self):
        doc = answer()
        now = doc["fetched_at"]
        paid = dict(doc["items"][0], is_paid_partnership=True)
        plain = dict(doc["items"][0], is_paid_partnership=False)
        self.assertEqual(bi.post_record("a", paid, now - 10 ** 8, now)["ad"], 1)
        self.assertNotIn("ad", bi.post_record("a", plain, now - 10 ** 8, now))

    def test_a_national_post_takes_the_kind_call_s_ad_and_a_local_one_does_not(self):
        posts = [post("a", 1, c="Prints on sale", n=1, category="national"), post("b", 2, c="New merch", category="shop")]
        said = {"kinds": [{"i": 0, "kind": "other", "sure": True, "ad": True}, {"i": 1, "kind": "other", "sure": True, "ad": True}]}
        with mock.patch.object(wc, "pick_engine", return_value={"provider": "anthropic", "model": "claude-haiku-5-5"}), \
                mock.patch.object(wc, "ask_json", lambda *a, **k: (said, {"in": 1, "out": 1, "calls": 1})), \
                mock.patch.object(bi, "log"):
            bi.assign_kinds(posts, {}, {}, None, at(2026, 11, 1))
        self.assertEqual((posts[0].get("ad"), "ad" in posts[1]), (1, False))


class SampleOfNovemberFirst(unittest.TestCase):
    """What the sample of 2026-11-01 found, by cause."""

    def test_a_date_before_a_colon_is_a_date_and_a_time_is_not(self):
        cap = "Halloween skating! Friday, Oct 30:\u2060 Spooky Skate: 8-10PM"
        self.assertEqual(bi.last_date(cap, at(2026, 10, 28)).isoformat(), "2026-10-30")
        self.assertIsNone(bi.last_date("Doors Oct 3:30", at(2026, 10, 1)))
        now = at(2026, 11, 1)
        rec = post("a", now - 4 * 86400, kind="poster", c=cap)
        bi.mark_captions([rec], None, now)
        self.assertEqual((rec.get("gone"), rec.get("cp")), (1, None))

    def test_a_holiday_is_the_date_only_when_nothing_else_gives_one(self):
        posted = at(2026, 10, 20)
        self.assertEqual(bi.last_date("Happy HallZOOween from Rico", posted).isoformat(), "2026-10-31")
        self.assertEqual(bi.last_date("Halloween party Oct 24", posted).isoformat(), "2026-10-24")
        self.assertEqual(bi.last_date("Thanksgiving pies", posted).isoformat(), "2026-11-26")
        self.assertEqual(bi.last_date("Christmas is coming", at(2026, 1, 3)).isoformat(), "2026-12-25")
        now = at(2026, 11, 1)
        self.assertTrue(bi.stale("Happy Halloween from Rico", post("a", now - 86400, n=1), now))
        self.assertFalse(bi.stale("Thanksgiving pies are ready", post("a", now - 86400, n=1), now))
        self.assertIsNone(bi.clean_hd("Jax says happy Halloween", True, post("a", now - 86400), now))
        self.assertIsNotNone(bi.clean_hd("Jax says happy Halloween", True, post("a", at(2026, 10, 30)), at(2026, 10, 31)))

    def test_an_abbreviation_does_not_end_a_sentence_or_a_line(self):
        self.assertEqual(bi.first_sentence("Pack the Gut pres. by Windjammer! Friday"), "Pack the Gut pres. by Windjammer!")
        self.assertEqual(bi.first_sentence("The monsters of Washington, D.C. Cartoon by us."),
                         "The monsters of Washington, D.C. Cartoon by us.")
        for raw in ("Just under one week away from Pack the Gut pres. by @windjammervt!",
                    "Behold, a true Halloween fright: the monsters of Washington, D.C. Cartoon by @citycyclops.",
                    "A long weekend in Washington, D.C."):
            self.assertEqual(bi.clean_caption(raw), "", raw)

    def test_a_short_line_has_to_show_some_english(self):
        self.assertEqual(bi.clean_caption("Ek se bhale do \U0001F605 (Dog and baby, funny , relatable, cute)"), "")
        self.assertEqual(bi.clean_caption("Golden hour over Stowe"), "")
        self.assertEqual(bi.clean_caption("Fall colors over Stowe today"), "Fall colors over Stowe today")

    def test_a_line_that_fits_any_picture_is_a_gap(self):
        for raw in ("It's that time of year...", "Came for the funny animal stories. Stayed for the lessons."):
            self.assertEqual(bi.clean_caption(raw), "", raw)

    def test_a_customer_s_first_name_is_a_neighbor(self):
        for t in ("Flying fish for Oliver", "First tattoo for Teddy!", "Barred Owl as first tattoo for Stephanie!",
                  "Cake for Emma's birthday"):
            self.assertTrue(bi.names_private(t), t)
        for t in ("Costumes for Halloween", "Soup for Burlington", "Open for the season", "Coat drive for Vermont"):
            self.assertFalse(bi.names_private(t), t)

    def test_a_fun_feed_holds_a_sick_stomach_and_washington(self):
        now = at(2026, 11, 1)
        for words in ({"hd": "Puppy eats boiled chicken and rice with diarrhea"},
                      {"c": "The monsters of Washington, D.C."}, {"c": "Congress is back"}):
            rec = post("a", now - 86400, n=1, t="dogs", **words)
            bi.mark_captions([rec], None, now)
            self.assertEqual(rec.get("sad"), 1, words)
        rec = post("a", now - 86400, n=1, t="wild", c="Whale migration past Monterey is on")
        bi.mark_captions([rec], None, now)
        self.assertNotIn("sad", rec)

    def test_a_date_after_a_shouted_weekday_is_read(self):
        self.assertEqual(bi.last_date("Next Friday! 11/6 - Shadow Monster", at(2026, 10, 30)).isoformat(), "2026-11-06")

    def test_a_job_in_front_of_a_full_name_is_a_neighbor(self):
        self.assertTrue(bi.names_private("UVM runner Zoey McNabb on Catamount Insider"))

    def test_an_event_still_to_come_never_settles_for_no_title(self):
        now = at(2026, 11, 1)
        rec = post("a", now - 86400, c="Women's hockey, Friday, November 6th")
        said = {"code": "x", "title": "", "ad": False}
        self.assertEqual(bi.read_hd([said], {"x": rec}, False, now), {"x": {}})
        self.assertEqual(bi.read_hd([said], {"x": rec}, True, now), {"x": {}})
        over = post("a", now - 3 * 86400, c="Market day Oct 30")
        self.assertEqual(bi.read_hd([said], {"x": over}, False, now), {"x": {"hx": 1}})

    def test_a_feed_stops_at_sixty_days(self):
        self.assertEqual(bi.INTEREST_KEEP_DAYS, 60)


class NameGuard(unittest.TestCase):
    def test_a_full_name_is_read_from_how_a_line_uses_it(self):
        for t in ("Zoey McNabb discusses her UVM running career", "Khalil Badru levels up at practice",
                  "Catalyst with Mildred Beltr\u00e9, Misoo Bang and Erika White", "thanks to sarah jones for today",
                  "Meet Emily Carter Bar Manager", "Congrats to Zoey McNabb", "Art by Misoo Bang"):
            self.assertTrue(bi.names_private(t), t)

    def test_a_shop_a_band_bill_and_a_first_name_are_not(self):
        with mock.patch.object(bi, "ROSTER_TEXT", "staygoldvintage foambrewers"):
            for t in ("Meet Teddy at the shop", "Thank you LN Consulting for your support", "Thanks to Stay Gold Vintage",
                      "Thanks to Foam Brewers for the beer", "Meet The Franks of Frank & Stein", "Radio Bean hosts a jazz night",
                      "Thank you Burlington City Arts", "Coy Dogs and Told Slant play Radio Bean", "Meet our new chef"):
                self.assertFalse(bi.names_private(t), t)

    def test_clean_hd_holds_a_name_on_a_local_post_and_not_a_national_one(self):
        self.assertIsNone(bi.clean_hd("Zoey McNabb discusses her running career", False))
        self.assertIsNotNone(bi.clean_hd("Zoey McNabb discusses her running career", True))

    def test_a_name_on_a_place_or_a_business_is_not_a_person(self):
        for t in ("Ethan Allen Park stone tower", "Seth Yacovone Band plays tonight", "Penny Cluse Cafe opens early",
                  "Deputy Mayor brings the latest update", "Elijah Craig hosts Old Fashioned week"):
            self.assertFalse(bi.names_private(t), t)

    def test_a_person_is_still_a_person(self):
        for t in ("Sarah Jones joins the kitchen", "Pam McDonald Day proclaimed", "Coach Mike wins again"):
            self.assertTrue(bi.names_private(t), t)

    def test_an_account_s_own_name_is_not_a_private_person(self):
        rec = {"nm": "Maggie Rose Bakeshop"}
        self.assertIsNotNone(bi.clean_hd("Maggie Rose Bakeshop opens at dawn", False, rec))
        self.assertIsNone(bi.clean_hd("Maggie Rose Bakeshop opens at dawn", False))

    def test_a_business_keeps_its_profile_name(self):
        item = {"user": {"username": "pennycluse", "full_name": "Penny Cluse Cafe"}}
        self.assertEqual(bi.own_name("pennycluse", [item], False), "Penny Cluse Cafe")


class StepTimeout(unittest.TestCase):
    """SIGTERM during the model calls must not cost the payload."""

    def run_it(self, step):
        doc = answer()
        now = doc["fetched_at"]
        b = Build()
        b.setUp()
        roster = [{"h": "foambrewers", "tier": 1, "category": "venue"}]

        def killed(*a, **k):
            raise bi.Stopped()

        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(bi, step, side_effect=killed):
            return b.run_main(tmp, roster, ["--only", "foambrewers", "--no-carry"], lambda h, k: doc["items"], now,
                              {"month": bi.month_key(bi.local_day(now)), "spent": 0, "last": {}})

    def test_during_the_kinds_every_post_still_has_a_kind_and_a_line_if_it_can(self):
        code, got, _ = self.run_it("assign_kinds")
        self.assertEqual(code, 0)
        self.assertTrue(got["posts"])
        self.assertTrue(all(p["kind"] in bi.KINDS and p["kd"] == 1 for p in got["posts"]))
        self.assertTrue(any(p.get("cp") for p in got["posts"]))

    def test_during_the_titles_the_payload_is_written(self):
        code, got, _ = self.run_it("assign_titles")
        self.assertEqual((code, bool(got["posts"])), (0, True))

    def test_a_stop_keeps_the_title_and_the_flag_the_last_payload_paid_for(self):
        doc = answer()
        now = doc["fetched_at"]
        items = [dict(it, caption={"text": "so good"}) for it in doc["items"]]
        was = bi.post_record("foambrewers", items[0], now - 10 ** 8, now)
        b = Build()
        b.setUp()

        def killed(*a, **k):
            raise bi.Stopped()

        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(bi, "assign_kinds", side_effect=killed):
            (Path(tmp) / "instagram.json").write_text(json.dumps({"posts": [dict(
                was, hd="Beagle naps on the couch", sad=1, kind="vibe")]}))
            _, got, _ = b.run_main(tmp, [{"h": "foambrewers", "tier": 1, "category": "venue"}], ["--only", "foambrewers"],
                                   lambda h, k: items, now, {"month": bi.month_key(bi.local_day(now)), "spent": 0, "last": {}})
        rec = next(p for p in got["held"] if p["u"] == was["u"])
        self.assertEqual((rec["hd"], rec["sad"]), ("Beagle naps on the couch", 1))

    def test_what_was_held_last_run_is_read_back_and_stays_held(self):
        doc = answer()
        now = doc["fetched_at"]
        items = [dict(it, caption={"text": "so good"}) for it in doc["items"]]
        was = bi.post_record("foambrewers", items[0], now - 10 ** 8, now)
        b = Build()
        b.setUp()
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(bi, "assign_kinds"), \
                mock.patch.object(bi, "assign_titles"):
            (Path(tmp) / "instagram.json").write_text(json.dumps({"posts": [], "held": [dict(was, gone=1, kind="poster")]}))
            _, got, _ = b.run_main(tmp, [{"h": "foambrewers", "tier": 1, "category": "venue"}], ["--only", "foambrewers"],
                                   lambda h, k: items, now, {"month": bi.month_key(bi.local_day(now)), "spent": 0, "last": {}})
        self.assertIn(was["u"], [p["u"] for p in got["held"]])
        self.assertNotIn(was["u"], [p["u"] for p in got["posts"]])

    def test_a_stop_during_the_titles_still_records_the_spend(self):
        ledger = {"month": bi.month_key(bi.local_day(at(2026, 11, 1))), "spent": 0, "last": {}, "runs": []}
        posts = [post(f"p{i}", i, c="so good") for i in range(bi.HD_BATCH + 1)]
        answers = [({"items": []}, {"in": 1000, "out": 100, "calls": 1}), bi.Stopped()]

        def ask(*a, **k):
            got = answers.pop(0)
            if isinstance(got, BaseException):
                raise got
            return got

        with mock.patch.object(wc, "pick_engine", return_value=Titles.ENGINE), mock.patch.object(wc, "ask_json", ask), \
                mock.patch.object(bi, "fetch_thumb", return_value=("image/jpeg", "AAAA")), mock.patch.object(bi, "log"), \
                self.assertRaises(bi.Stopped):
            bi.assign_titles(posts, {}, ledger, at(2026, 11, 1))
        self.assertGreater(ledger["ai"]["usd"], 0)

    def test_a_stop_during_the_kinds_still_records_the_spend(self):
        ledger = {"month": bi.month_key(bi.local_day(at(2026, 11, 1))), "spent": 0, "last": {}, "runs": []}
        posts = [post(f"p{i}", i, c="so good") for i in range(bi.KIND_BATCH + 1)]
        answers = [({"kinds": []}, {"in": 1000, "out": 100, "calls": 1}), bi.Stopped()]

        def ask(*a, **k):
            got = answers.pop(0)
            if isinstance(got, BaseException):
                raise got
            return got

        with mock.patch.object(wc, "pick_engine", return_value=Titles.ENGINE), mock.patch.object(wc, "ask_json", ask), \
                mock.patch.object(bi, "log"), self.assertRaises(bi.Stopped):
            bi.assign_kinds(posts, {}, {}, ledger, at(2026, 11, 1))
        self.assertGreater(ledger["ai"]["usd"], 0)

    def test_the_stop_is_nothing_a_caught_exception_can_swallow(self):
        self.assertFalse(issubclass(bi.Stopped, Exception))

    def test_the_handler_is_in_place_during_the_model_calls_and_gone_after(self):
        seen = []
        before = signal.getsignal(signal.SIGTERM)
        doc = answer()
        now = doc["fetched_at"]
        b = Build()
        b.setUp()
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(bi, "assign_titles", side_effect=lambda *a: seen.append(signal.getsignal(signal.SIGTERM))):
            b.run_main(tmp, [{"h": "foambrewers", "tier": 1, "category": "venue"}], ["--only", "foambrewers", "--no-carry"],
                       lambda h, k: doc["items"], now, {"month": bi.month_key(bi.local_day(now)), "spent": 0, "last": {}})
        self.assertNotEqual(seen[0], before)
        self.assertEqual(signal.getsignal(signal.SIGTERM), before)


class Roster(unittest.TestCase):
    def test_a_feed_with_grief_in_it_is_off_the_roster(self):
        self.assertNotIn("beaglelando", {a["h"] for a in bi.load_roster()})

    def test_the_cap_fits_the_new_cost(self):
        self.assertLessEqual(bi.AI_MONTH_CAP_USD, 7.0)
        self.assertGreater(bi.AI_MONTH_CAP_USD - bi.HD_LEAVES_USD, 4.5)      # a month of Sonnet on the gaps


if __name__ == "__main__":
    unittest.main()
