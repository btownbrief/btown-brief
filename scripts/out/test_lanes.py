#!/usr/bin/env python3
"""Regression cases for scripts/out/lanes.py. Every case is a listing from the
2026-10-29 events.json that a rule once got wrong (or a rule that must keep holding).
Run: python3 scripts/out/test_lanes.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lanes import tag_event  # noqa: E402


def ev(title, venue="", cat="other", start="2026-11-03T19:00:00-05:00", **kw):
    base = {"title": title, "venue": venue, "category": cat, "start": start, "allDay": False,
            "description": "", "tags": [], "price": None, "free": None, "minPrice": None,
            "indoorOutdoor": None, "source": "sevendays"}
    base.update(kw)
    return base


def lanes(**kw):
    return tag_event(ev(**kw))[0]


class Lanes(unittest.TestCase):
    def test_tour_is_not_music(self):
        self.assertNotIn("live-music", lanes(title="Dads & Kids Fire Station Tour", cat="family",
                                             start="2026-11-07T10:00:00-05:00"))

    def test_trivia_at_cidery_is_nightlife_not_family(self):
        got = lanes(title="Citizen Cider Trivia Night", venue="Citizen Cider", cat="family",
                    start="2026-11-04T18:30:00-05:00")
        self.assertIn("nightlife", got)
        self.assertNotIn("family", got)

    def test_election_watch_party_is_civic_not_sports(self):
        got = lanes(title="Midterm Election Watch Party", venue="UVM Davis Center", cat="games")
        self.assertIn("civic", got)
        self.assertNotIn("sports-watch", got)

    def test_home_hockey_is_sports_watch(self):
        self.assertIn("sports-watch", lanes(title="Men's Ice Hockey vs Dartmouth",
                                            venue="Gutterson Fieldhouse", cat="sports"))

    def test_public_skate_is_not_sports_watch(self):
        self.assertNotIn("sports-watch", lanes(title="Public Skate", venue="Leddy Park", cat="sports"))

    def test_paid_price_beats_free_flag(self):
        self.assertNotIn("free", lanes(title="Requiem For A King", price="Adults $40-$80", free=True))

    def test_library_is_free(self):
        self.assertIn("free", lanes(title="Spanish Conversation", venue="Fletcher Free Library",
                                    source="fletcherfree"))

    def test_open_mic_not_live_music(self):
        got = lanes(title="Monday Night Open Mic", venue="Pearl Street Pub", cat="music")
        self.assertIn("open-mic", got)
        self.assertNotIn("live-music", got)

    def test_child_labor_exhibit_is_not_family(self):
        got = lanes(title="'Investigating Child Labor'", venue="Heritage Winooski Mill Museum", cat="art",
                    start="2026-11-03", allDay=True, tags=["ongoing"])
        self.assertNotIn("family", got)
        self.assertIn("gallery", got)

    def test_civic_symphony_is_music_not_civic(self):
        got = lanes(title="Burlington Civic Symphony Concert", cat="music")
        self.assertIn("live-music", got)
        self.assertNotIn("civic", got)

    def test_weekly_chorus_rehearsal_is_not_a_show(self):
        self.assertNotIn("live-music", lanes(title="Vermont's Freedom & Unity Chorus", cat="music",
                                             description="Singers come together for a weekly rehearsal."))

    def test_martini_tuesday_is_happy_hour(self):
        self.assertIn("nightlife", lanes(title="$10 Martini Tuesday", venue="Doma Bar",
                                         start="2026-11-03T17:00:00-05:00"))

    def test_veteran_families_desk_is_not_family(self):
        self.assertNotIn("family", lanes(title="Supportive Services for Veteran Families: Community Partners Desk",
                                         cat="words", start="2026-11-03T14:00:00-05:00"))


if __name__ == "__main__":
    unittest.main()
