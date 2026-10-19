"""curate_wire.py: the sports lane and Grok's recaps in the day's payload
(2026-10-19). Offline; the model is never called.

Run: python3 -m unittest discover -s tests -p 'test_wire*.py'
"""

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import curate_wire as cw  # noqa: E402
import wire_common as wc  # noqa: E402

NOW = datetime(2026, 10, 19, 16, 7, tzinfo=timezone.utc)      # 12:07 pm Eastern, Monday
NOW_TS = int(NOW.timestamp())


def item(n, score, local=False, sport=None, ch=None):
    out = {"id": f"id{n}", "ch": ch or ("local" if local else "world"), "local": local,
           "src": "espn", "name": "ESPN", "title": f"Headline {n}", "url": f"https://a.com/{n}",
           "posted_at": NOW.isoformat(), "d": NOW_TS - n, "_score": score}
    if sport:
        out["sport"] = sport
    return out


class SportsLaneTests(unittest.TestCase):
    def test_national_sports_reach_the_editor_from_a_lower_score(self):
        pool = [item(1, 2, sport="nba"), item(2, 2), item(3, 1, sport="nfl"),
                item(4, 2, sport="mlb", ch="x")]
        new, auto = cw.select_new(pool, set(), set(), set(), set())
        self.assertEqual([i["id"] for i in new], ["id1", "id4"])
        self.assertEqual(sorted(auto), ["id2", "id3"])

    def test_sports_have_their_own_lane(self):
        world = [item(n, 5) for n in range(1, cw.NEW_MAX_WORLD + 5)]
        sports = [item(100 + n, 2, sport="nhl") for n in range(cw.NEW_MAX_SPORTS + 5)]
        new, _ = cw.select_new(world + sports, set(), set(), set(), set())
        self.assertEqual(sum(1 for i in new if i.get("sport")), cw.NEW_MAX_SPORTS)
        self.assertEqual(sum(1 for i in new if not i.get("sport")), cw.NEW_MAX_WORLD)

    def test_the_tag_carries_the_sport_and_a_source_sport_wins(self):
        a = dict(item(1, 3), _score=None)
        b = dict(item(2, 3, sport="mlb"))
        tags = {"id1": {"ch": "world", "local": False, "junk": "none", "topic": "sports",
                        "sport": "soccer", "score": 4},
                "id2": {"ch": "world", "local": False, "junk": "none", "topic": "sports",
                        "sport": "nba", "score": 4}}
        out = cw.apply_tags([a, b], tags)
        self.assertEqual([i["sport"] for i in out], ["soccer", "mlb"])
        self.assertEqual(cw.public(out[0])["sport"], "soccer")
        self.assertIn("sports/soccer", cw.line(0, out[0], NOW_TS))

    def test_sport_counts(self):
        items = [item(1, 3, sport="nba"), item(2, 3, sport="nba", local=True), item(3, 3)]
        counts = cw.sport_counts(items)
        self.assertEqual((counts["everything"]["nba"], counts["local"]["nba"]), (2, 1))
        self.assertEqual(set(counts["everything"]), set(wc.SPORTS))


def recap(rid, kind, hours_ago, bullets=None):
    posted = NOW - timedelta(hours=hours_ago)
    return {"id": rid, "kind": kind, "title": "whatever the store held",
            "posted_at": posted.replace(microsecond=0).isoformat(), "d": int(posted.timestamp()),
            "intro": "Intro.", "basis": "trending",
            "bullets": bullets or [{"text": "A headline", "url": f"https://x.com/a/status/{rid}",
                                    "note": "Why it matters."}]}


class RecapPayloadTests(unittest.TestCase):
    def pulse(self, recaps):
        return {"inbox": {"recaps": {"paused": False, "items": recaps}}}

    def test_todays_recaps_newest_first_and_latest_of_each_kind(self):
        recaps = [recap("mon-ai", "ai", 1), recap("mon-morning", "morning", 5),
                  recap("mon-breaking-1", "breaking", 2), recap("mon-breaking-2", "breaking", 0.5),
                  recap("sun-evening", "evening", 17)]     # 7 pm Sunday: yesterday's
        out = cw.recaps_of(self.pulse(recaps), "2026-10-19")
        self.assertEqual([rc["id"] for rc in out["recaps"]],
                         ["mon-breaking-2", "mon-ai", "mon-breaking-1", "mon-morning"])
        self.assertEqual(out["recaps_latest"], ["mon-breaking-2", "mon-ai", "mon-morning"])
        first = out["recaps"][1]
        self.assertEqual((first["title"], first["label"]), ("AI & tech", "From X trending summaries"))
        bullet = first["bullets"][0]
        self.assertEqual(bullet["id"], wc.item_id(bullet["url"]))   # matches a river item's id
        self.assertEqual(out["recap_kinds"][0], {"kind": "morning", "title": "Morning briefing"})

    def test_no_recaps_is_an_empty_list(self):
        out = cw.recaps_of({}, "2026-10-19")
        self.assertEqual((out["recaps"], out["recaps_latest"]), ([], []))

    def test_finish_writes_recaps_and_status(self):
        day = cw.empty_day("2026-10-19")
        day["updates"] = [{"key": "midday", "label": "Midday", "items": [cw.public(item(1, 3, sport="nba"))]}]
        pulse = self.pulse([recap("mon-sports", "sports", 1)])
        pulse["inbox"]["recaps"].update(reason=None, updated_at=NOW.isoformat())
        cw.finish(day, pulse, NOW, changed=True)
        self.assertEqual([rc["id"] for rc in day["recaps"]], ["mon-sports"])
        self.assertFalse(day["status"]["recaps"]["paused"])
        self.assertEqual(day["sport_counts"]["everything"]["nba"], 1)

    def test_a_rewritten_recap_moves_updated(self):
        day = cw.empty_day("2026-10-19")
        pulse = self.pulse([recap("mon-sports", "sports", 1)])
        cw.finish(day, pulse, NOW, changed=True)
        cw.finish(day, pulse, NOW + timedelta(minutes=10), changed=False)
        self.assertEqual(day["updated"], NOW.isoformat())               # nothing new
        pulse["inbox"]["recaps"]["items"][0]["intro"] = "Rewritten."
        later = NOW + timedelta(minutes=20)
        cw.finish(day, pulse, later, changed=False)
        self.assertEqual(day["updated"], later.isoformat())


if __name__ == "__main__":
    unittest.main()
