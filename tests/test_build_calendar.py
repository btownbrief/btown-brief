"""The Calendar's file: it must count what events.html lists, and pick well."""

import datetime as dt
import unittest

from scripts.build_whatnow import calendar_payload, ends_at, TZ


NOW = dt.datetime(2026, 10, 31, 12, 0, tzinfo=TZ)


def ev(day, hour=19, **x):
    start = f"{day}T{hour:02d}:00:00-04:00"
    base = {"id": f"{day}-{hour}-{x.get('title', 'e')}", "title": "Show", "start": start, "end": None, "date": day,
            "allDay": False, "status": "active", "category": "music", "tags": [], "url": "https://example.com/e",
            "venue": "The Room", "town": "Burlington", "signals": {}, "source": "sevendays"}
    base.update(x)
    return base


class CalendarPayload(unittest.TestCase):
    def test_counts_what_the_page_lists(self):
        got = calendar_payload([
            ev("2026-10-31"),
            ev("2026-10-31", category="art"),
            ev("2026-10-31", status="unconfirmed"),
            ev("2026-10-31", tags=["ongoing"]),
            ev("2026-11-01", category="art"),
            ev("2026-10-30"),
            ev("2026-12-25"),
        ], NOW)
        self.assertEqual(len(got["days"]), 21)
        self.assertEqual(got["days"][0]["date"], "2026-10-31")
        self.assertEqual(got["days"][0]["cats"], {"music": 1, "art": 1})
        self.assertEqual(got["days"][1]["cats"], {"art": 1})
        self.assertEqual(sum(sum(d["cats"].values()) for d in got["days"]), 3)

    def test_an_empty_day_still_has_its_place(self):
        got = calendar_payload([ev("2026-11-02")], NOW)
        self.assertEqual([d["cats"] for d in got["days"][:3]], [{}, {}, {"music": 1}])

    def test_end_times_ride_with_the_near_days_only(self):
        got = calendar_payload([ev("2026-10-31"), ev("2026-11-10")], NOW)
        want = int(dt.datetime(2026, 10, 31, 21, 0, tzinfo=dt.timezone(dt.timedelta(hours=-4))).timestamp())
        self.assertEqual(got["days"][0]["ends"], {"music": [want]})
        self.assertNotIn("ends", got["days"][10])

    def test_no_end_means_two_hours_and_all_day_never_ends(self):
        self.assertEqual(ends_at(ev("2026-10-31", allDay=True)), None)
        e = ev("2026-10-31", end="2026-10-31T19:00:00-04:00")
        self.assertEqual(ends_at(e) - dt.datetime.fromisoformat(e["start"]).timestamp(), 7200)

    def test_all_day_counts_but_is_never_a_pick(self):
        got = calendar_payload([ev("2026-10-31", allDay=True)], NOW)
        self.assertEqual(got["days"][0]["cats"], {"music": 1})
        self.assertEqual(got["picks"], [])

    def test_picks_lead_with_his_own_then_seven_days(self):
        got = calendar_payload([
            ev("2026-10-31", 18, title="A regular", tags=["series"], venue="A"),
            ev("2026-10-31", 20, title="Picked", venue="B", signals={"staff_pick": True}),
            ev("2026-10-31", 21, title="His", venue="C", signals={"own_group": True}),
        ], NOW)
        self.assertEqual([p["title"] for p in got["picks"]], ["His", "Picked", "A regular"])
        self.assertTrue(got["picks"][0]["own"])
        self.assertTrue(got["picks"][1]["pick"])

    def test_photo_rides_along_and_cancelled_does_not_pick(self):
        got = calendar_payload([
            ev("2026-10-31", 20, title="Poster", signals={"image": "https://example.com/a.jpg"}),
            ev("2026-10-31", 21, title="Cancelled: Big Night", venue="Elsewhere"),
        ], NOW)
        self.assertEqual([p["title"] for p in got["picks"]], ["Poster"])
        self.assertEqual(got["picks"][0]["image"], "https://example.com/a.jpg")

    def test_one_show_listed_twice_at_one_door(self):
        got = calendar_payload([ev("2026-10-31", 20, title="One"), ev("2026-10-31", 20, title="Two")], NOW)
        self.assertEqual(len(got["picks"]), 1)
        self.assertEqual(got["days"][0]["cats"], {"music": 2})


if __name__ == "__main__":
    unittest.main()
