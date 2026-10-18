"""Events pipeline rules from the 2026-10-17 research audit. Each case is a
listing that reached the calendar in the wrong place:

- UVM hockey at Gutterson Fieldhouse shown at Virtue Field, outdoors, because
  97 Spear St is shared by several campus venues;
- Burlington Beer Co.'s pour at Jay Peak shown as a Burlington event;
- a Brisbane radiology conference shown at the BCA Center;
- one Flynn show listed twice under two titles (UVM and the Flynn);
- "South Burlington" and "Essex Junction" addresses read as Burlington and
  Essex.

Run: python3 -m unittest tests/test_events_rules.py
"""

import os
import sys
import unittest
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
EVENTS = os.path.join(HERE, "..", "scripts", "events")
sys.path.insert(0, EVENTS)
sys.path.insert(0, os.path.join(EVENTS, "sources"))

import common  # noqa: E402
import update  # noqa: E402
import breweries  # noqa: E402
import loveburlington  # noqa: E402


class VenueRules(unittest.TestCase):
    def test_uvm_hockey_keeps_gutterson_and_is_indoor(self):
        ev = common.make_event(
            source="uvm", title="Men's Ice Hockey vs Clarkson",
            url="https://events.uvm.edu/event/mens-ice-hockey-vs-clarkson",
            start=datetime(2026, 10, 23, 19, 0, tzinfo=common.TZ),
            venue="Gutterson Fieldhouse", address="97 Spear St, Burlington, VT 05405",
            town="Burlington")
        self.assertEqual(ev["venue"], "Gutterson Fieldhouse")
        self.assertEqual(ev["indoorOutdoor"], "indoor")

    def test_shared_campus_address_alone_names_no_venue(self):
        name, info = common.resolve_venue("Forbush Natatorium", "97 Spear Street, Burlington, VT 05405")
        self.assertEqual(name, "Forbush Natatorium")
        self.assertEqual(info, {})

    def test_virtue_field_by_name_still_resolves(self):
        name, info = common.resolve_venue("Virtue Field", "97 Spear Street, Burlington, VT 05405")
        self.assertEqual(name, "Virtue Field")
        self.assertEqual(info["indoor_outdoor"], "outdoor")

    def test_town_prefers_the_longer_name(self):
        self.assertEqual(common.town_from_address("1214 Williston Rd, South Burlington, VT"), "South Burlington")
        self.assertEqual(common.town_from_address("38 Park St., Essex Junction"), "Essex Junction")
        self.assertEqual(common.town_from_address("180 Flynn Ave, Burlington, VT"), "Burlington")


class BreweryPlaces(unittest.TestCase):
    BBCO = ("Burlington Beer Company", "Burlington")

    def test_offsite_out_of_area_is_dropped(self):
        loc = {"addressTitle": "Stateside Base Lodge, Jay Peak Resort",
               "addressLine1": "830 Jay Peak Road", "addressLine2": "Jay, VT 05859"}
        self.assertIsNone(breweries._own_place(loc, *self.BBCO))

    def test_offsite_in_area_takes_its_own_venue_and_town(self):
        loc = {"addressTitle": "Grazers, Maple Tree Place", "addressLine1": "192 Boxwood Street",
               "addressLine2": "Williston, Vermont, 05495"}
        self.assertEqual(breweries._own_place(loc, *self.BBCO), ("Grazers, Maple Tree Place", "Williston"))

    def test_home_listing_keeps_the_brewery(self):
        loc = {"addressTitle": "Burlington Beer Co., Lumière Hall", "addressLine1": "180 Flynn Avenue",
               "addressLine2": "Burlington, VT 05401"}
        self.assertEqual(breweries._own_place(loc, *self.BBCO), self.BBCO)
        self.assertEqual(breweries._own_place({}, *self.BBCO), self.BBCO)

    def test_closure_notice_is_not_an_event(self):
        self.assertTrue(breweries._NOTICE_RE.search("No Thursday Trivia: Taproom Closed All Day"))
        self.assertFalse(breweries._NOTICE_RE.search("Thursday Trivia at Burlington Beer Co."))
        self.assertFalse(breweries._NOTICE_RE.search("No Kings Rally Afterparty"))
        for real in ("No Cover Live Music", "No Cover Show", "No Strings Attached Show",
                     "Main Street Closed for Festival"):
            self.assertFalse(breweries._NOTICE_RE.search(real), real)

    def test_offsite_same_town_keeps_its_own_venue(self):
        loc = {"addressTitle": "Waterfront Park", "addressLine1": "20 Lake St",
               "addressLine2": "Burlington, VT 05401"}
        self.assertEqual(breweries._own_place(loc, *self.BBCO), ("Waterfront Park", "Burlington"))


class LoveBurlingtonElsewhere(unittest.TestCase):
    def test_overseas_time_zone(self):
        self.assertTrue(loveburlington._elsewhere({"title": "Anything", "timezone": "Australia/Brisbane"}))

    def test_conference_placed_abroad_by_its_own_text(self):
        item = {"title": "2026 World Radiology and Medical Imaging Conference", "timezone": "",
                "description_short": "accredited with CPD credits during October 22-23, 2026, in Brisbane, Australia"}
        self.assertTrue(loveburlington._elsewhere(item))

    def test_utc_says_nothing_about_place(self):
        self.assertFalse(loveburlington._elsewhere({"title": "Open studio", "timezone": "UTC"}))
        self.assertFalse(loveburlington._elsewhere({"title": "Open studio", "timezone": "Etc/GMT+5"}))

    def test_local_event_mentioning_abroad_stays(self):
        item = {"title": "Jazz night", "timezone": "America/New_York",
                "description_short": "Songs she wrote while living in Paris, France."}
        self.assertFalse(loveburlington._elsewhere(item))


class SameShowDedupe(unittest.TestCase):
    def ev(self, source, title, start="2026-10-17T18:00:00-04:00", venue="The Flynn"):
        return {"source": source, "title": title, "start": start, "date": start[:10], "allDay": False,
                "venue": venue, "town": "Burlington", "url": f"https://{source}.example/x", "tags": [],
                "signals": {}, "category": "music"}

    def test_two_titles_one_show_merge(self):
        merged, _ = update.dedupe([
            self.ev("uvm", "Bob The Drag Queen @ Flynn Theater"),
            self.ev("flynn", "Now Clap! Bob The Drag Queen's"),
        ])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["source"], "flynn")
        self.assertEqual({s["source"] for s in merged[0]["sources"]}, {"uvm", "flynn"})

    def test_different_start_stays_apart(self):
        merged, _ = update.dedupe([
            self.ev("uvm", "Bob The Drag Queen @ Flynn Theater"),
            self.ev("flynn", "Now Clap! Bob The Drag Queen's", start="2026-10-17T20:00:00-04:00"),
        ])
        self.assertEqual(len(merged), 2)

    def test_same_slot_related_but_distinct_titles_stay_apart(self):
        for a, b in (("Vermont Film Festival Opening Night: Casablanca", "Vermont Film Festival Opening Night: Vertigo"),
                     ("Burlington Book Festival Author Alice Walker", "Burlington Book Festival Author Bob Dylan")):
            merged, _ = update.dedupe([self.ev("uvm", a), self.ev("flynn", b)])
            self.assertEqual(len(merged), 2, (a, b))

    def test_same_slot_unrelated_titles_stay_apart(self):
        merged, _ = update.dedupe([
            self.ev("uvm", "Student Jazz Ensemble"),
            self.ev("flynn", "Bob The Drag Queen"),
        ])
        self.assertEqual(len(merged), 2)


if __name__ == "__main__":
    unittest.main()
