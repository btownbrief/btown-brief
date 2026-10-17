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
                mock.patch.object(bi, "log"), mock.patch.object(sys, "argv", ["x"] + argv):
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


if __name__ == "__main__":
    unittest.main()
