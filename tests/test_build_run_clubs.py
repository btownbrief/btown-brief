"""build_run_clubs.py: the checks that keep data/run-clubs.json honest, and the
week grid. Pure functions only; nothing touches the network or the real file.

Run: python3 -m unittest tests/test_build_run_clubs.py
"""

import datetime as dt
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import build_run_clubs as brc  # noqa: E402

TODAY = dt.date(2026, 10, 17)


def club(cid="test-club", **kw):
    base = {
        "id": cid, "name": cid.title(), "kind": "run", "what": "A weekly run.",
        "meets": [{"day": "tue", "time": "18:00", "where": "Skirack", "address": "85 Main St, Burlington",
                   "lat": 44.4756, "lng": -73.2159, "note": ""}],
        "url": "https://example.org/",
        "checked": {"date": "2026-10-17", "source": "https://example.org/runs", "note": "Says Tuesdays 6pm."},
    }
    base.update(kw)
    return base


def errors_for(*clubs):
    return brc.validate({"clubs": list(clubs)}, today=TODAY)[0]


class Validate(unittest.TestCase):
    def test_good_club_passes(self):
        self.assertEqual(errors_for(club()), [])

    def test_duplicate_id(self):
        self.assertTrue(any("duplicate id" in e for e in errors_for(club("a"), club("a"))))

    def test_missing_checked_source(self):
        bad = club(checked={"date": "2026-10-17", "source": "", "note": "x"})
        self.assertTrue(any("checked.source" in e for e in errors_for(bad)))

    def test_future_or_bad_date(self):
        self.assertTrue(any("future" in e for e in errors_for(
            club(checked={"date": "2026-12-01", "source": "https://x.org", "note": "x"}))))
        self.assertTrue(any("YYYY-MM-DD" in e for e in errors_for(
            club(checked={"date": "Oct 17", "source": "https://x.org", "note": "x"}))))

    def test_bad_day_time_and_coordinates(self):
        meet = {"day": "tues", "time": "6pm", "where": "Somewhere", "lat": 40.7, "lng": -74.0}
        errs = errors_for(club(meets=[meet]))
        self.assertTrue(any("day" in e for e in errs))
        self.assertTrue(any("HH:MM" in e for e in errs))
        self.assertTrue(any("outside the Burlington area" in e for e in errs))

    def test_moving_start_needs_varies(self):
        meet = {"day": "thu", "time": "18:15", "where": "A brewery", "lat": None, "lng": None}
        self.assertTrue(any("Varies" in e for e in errors_for(club(meets=[meet]))))
        meet["where"] = "Varies week to week"
        self.assertEqual(errors_for(club(meets=[meet])), [])

    def test_no_meets_needs_schedule_note(self):
        self.assertTrue(any("schedule_note" in e for e in errors_for(club(meets=[]))))
        self.assertEqual(errors_for(club(meets=[], schedule_note="See the Meetup page.")), [])

    def test_unknown_field_is_caught(self):
        self.assertTrue(any("unknown field 'meet'" in e for e in errors_for(club(meet=[]))))

    def test_wrong_types_are_errors_not_crashes(self):
        bad = club(checked={"date": "2026-10-17", "source": "https://x.org", "note": "x", "also": 5})
        self.assertTrue(any("checked.also" in e for e in errors_for(bad)))
        meet = {"day": "tue", "time": "18:00", "where": "Gym", "address": 12, "lat": 44.48, "lng": -73.2}
        self.assertTrue(any("address must be text" in e for e in errors_for(club(meets=[meet]))))

    def test_season_fields(self):
        self.assertEqual(errors_for(club(months=[12, 1, 2], **{"from": "2026-11-06", "until": "2027-03-10"})), [])
        self.assertTrue(any("months" in e for e in errors_for(club(months=[0, 13]))))
        self.assertTrue(any("months" in e for e in errors_for(club(months=[]))))
        self.assertTrue(any("twice" in e for e in errors_for(club(months=[5, 5]))))
        self.assertTrue(any("months" in e for e in errors_for(club(months="May-September"))))
        self.assertTrue(any("YYYY-MM-DD" in e for e in errors_for(club(until="Oct 28"))))
        self.assertTrue(any("after until" in e for e in errors_for(club(**{"from": "2026-12-01", "until": "2026-11-01"}))))
        meet = dict(club()["meets"][0], months=[6, 7, 8], until="2026-02-30")
        errs = errors_for(club(meets=[meet]))
        self.assertTrue(any("meets[0]: until" in e for e in errs), errs)

    def test_season_text_without_months_warns(self):
        warns = brc.validate({"clubs": [club(season="May-September")]}, today=TODAY)[1]
        self.assertTrue(any("no months/from/until" in w for w in warns), warns)
        for quiet in (club(season="year-round"), club(season="May-September", months=[5, 6, 7, 8, 9]), club(season="")):
            self.assertFalse(any("no months" in w for w in brc.validate({"clubs": [quiet]}, today=TODAY)[1]))

    def test_same_name_twice(self):
        self.assertTrue(any("same name" in e for e in errors_for(club("a", name="Run Club"),
                                                                  club("b", name="Run club"))))

    def test_shared_slot_warns(self):
        errs, warns = brc.validate({"clubs": [club("a"), club("b")]}, today=TODAY)
        self.assertEqual(errs, [])
        self.assertTrue(any("listed twice" in w for w in warns))

    def test_stale_check_only_warns(self):
        old = club(checked={"date": "2026-01-02", "source": "https://x.org", "note": "x"})
        errs, warns = brc.validate({"clubs": [old]}, today=TODAY)
        self.assertEqual(errs, [])
        self.assertTrue(warns)


class Grid(unittest.TestCase):
    def test_days_in_order_times_sorted(self):
        late = club("late", meets=[{"day": "tue", "time": "19:00", "where": "Gym", "lat": 44.48, "lng": -73.2}])
        early = club("early", meets=[{"day": "tue", "time": "07:30", "where": "Path", "lat": 44.5, "lng": -73.26}])
        loose = club("loose", meets=[], schedule_note="See Instagram.")
        lines = brc.week_grid({"clubs": [late, early, loose]})
        self.assertEqual(lines[0], "Monday (0)")
        tue = lines.index("Tuesday (2)")
        self.assertIn("7:30am", lines[tue + 1])
        self.assertIn("7:00pm", lines[tue + 2])
        self.assertIn("Loose: See Instagram.", lines[-1])


if __name__ == "__main__":
    unittest.main()
