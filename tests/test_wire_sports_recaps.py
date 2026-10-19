"""curate_wire.py: the sports lane, the sports cap and chips, Grok's recaps and
the Photos tab's world pictures in the day's payload (2026-10-19). Offline;
the model is never called.

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
        # a tag from before soccer left the list reads as other (2026-10-19)
        self.assertEqual([i["sport"] for i in out], ["other", "mlb"])
        self.assertEqual(cw.public(out[0])["sport"], "other")
        self.assertIn("sports/other", cw.line(0, out[0], NOW_TS))

    def test_sport_counts(self):
        day = cw.empty_day("2026-10-19")
        items = [item(1, 3, sport="nba"), item(2, 3, sport="nba", local=True), item(3, 3)]
        counts = cw.sport_counts(cw.sports_of(day, items), "2026-10-19")
        self.assertEqual((counts["everything"]["nba"], counts["local"]["nba"]), (2, 1))
        self.assertEqual(set(counts["everything"]), set(wc.sport_chips("2026-10-19")) | {"other"})


def filed(n, sport, local=False):
    return cw.public(item(n, 3, local=local, sport=sport))


class SportsCapTests(unittest.TestCase):
    """Stephen, 2026-10-19: "Main feed shows only the biggest moments (cap
    ~3-5/day); everything else lives behind sport chips + the daily Sports
    recap." """

    def setUp(self):
        self.et = wc.et_now(NOW)
        self.day = cw.empty_day("2026-10-19")

    def answer(self, new, add, sports=(), picks=None, scores=None, markets=()):
        """add, sports, markets and picks are indices into `new`."""
        off = len(cw.river(self.day))
        answer = {"add": [off + i for i in add], "lead": -1, "lead_why": "", "drop": [],
                  "sports": [off + i for i in sports], "markets": [off + i for i in markets]}
        if picks is not None:
            answer["picks"] = [{"i": off + i, "why": "Big news today."} for i in picks]
        return cw.apply_answer(self.day, answer, cw.river(self.day), new, picks is not None,
                               self.et, NOW, scores=scores)

    def test_the_main_river_takes_four_sports_a_day_and_the_rest_go_to_the_chips(self):
        new = [item(n, 4, sport="nba") for n in range(1, 7)] + [item(7, 5), item(8, 3, sport="nhl")]
        result = self.answer(new, add=[0, 1, 2, 3, 4, 5, 6], sports=[7])
        in_river = [i["id"] for i in cw.river(self.day)]
        self.assertEqual(sorted(in_river), ["id1", "id2", "id3", "id4", "id7"])   # the editor's first four
        self.assertEqual(sorted(result["shelved"]), ["id5", "id6", "id8"])
        cw.finish(self.day, {}, NOW, changed=True)
        sports = self.day["sports"]
        self.assertEqual(len(sports["nba"]), 6)
        self.assertEqual(sum(1 for i in sports["nba"] if i.get("river")), 4)
        self.assertEqual([i["id"] for i in sports["nhl"]], ["id8"])
        self.assertEqual(self.day["sport_counts"]["everything"]["nba"], 6)
        self.assertNotIn("id5", [i["id"] for i in cw.river(self.day)])

        # the next hour: the four are spent, so a new sports add goes to the chips
        later = [item(20, 4, sport="nfl"), item(21, 6)]
        result = self.answer(later, add=[0, 1])
        self.assertEqual(result["shelved"], ["id20"])
        self.assertIn("id21", [i["id"] for i in cw.river(self.day)])

    def test_a_vermont_story_big_here_runs_outside_the_cap(self):
        self.day["updates"] = [{"key": "morning", "label": "Morning", "items":
                                [filed(n, "nba") for n in range(1, 5)]}]
        new = [item(10, cw.LOCAL_SPORTS_BIG, local=True, sport="local"),
               item(11, 5, local=True, sport="local")]
        result = self.answer(new, add=[0, 1])
        self.assertIn("id10", [i["id"] for i in cw.river(self.day)])   # a UVM title run
        self.assertEqual(result["shelved"], ["id11"])                    # an ordinary result
        self.assertEqual(len(cw.counted(cw.river(self.day), "sports", {"id10": cw.LOCAL_SPORTS_BIG})), 4)

    def test_a_sports_pick_always_runs_and_counts(self):
        new = [item(n, 4, sport="nfl") for n in range(1, 7)]
        result = self.answer(new, add=[0, 1, 2, 3, 4], picks=[5])
        in_river = {i["id"] for i in cw.river(self.day)}
        self.assertIn("id6", in_river)                                    # the pick
        self.assertEqual(len(in_river), cw.SPORTS_RIVER_MAX)
        self.assertEqual(sorted(result["shelved"]), ["id4", "id5"])

    def test_five_sports_picks_never_pass_the_cap(self):
        new = [item(n, 6, sport="nba") for n in range(1, 6)] + [item(9, 6)]
        result = self.answer(new, add=[], picks=[0, 1, 2, 3, 4, 5])
        self.assertEqual([p["id"] for p in self.day["picks"]], ["id1", "id2", "id3", "id4", "id9"])
        self.assertEqual(result["shelved"], ["id5"])                     # the chip, not the picks
        self.assertEqual(len(cw.counted(cw.river(self.day), "sports")), cw.SPORTS_RIVER_MAX)
        # a later re-rank that names a fifth sports story from NEW: the chip again
        later = [item(20, 7, sport="nfl")]
        result = self.answer(later, add=[], picks=[0])
        self.assertEqual(result["shelved"], ["id20"])
        self.assertNotIn("id20", [p["id"] for p in self.day["picks"]])

    def test_migration_holds_the_cap_even_over_protected_stories(self):
        items = [filed(n, "nhl") for n in range(1, 7)]
        self.day["updates"] = [{"key": "morning", "label": "Morning",
                                "lead": {"id": "id6", "why": "Lead."}, "items": items}]
        self.day["picks"] = [dict(filed(n, "nhl"), rank=n, why="Big.") for n in (1, 2, 3)]
        self.day["picks_earlier"] = [dict(filed(n, "nhl"), rank=1, why="Was big.") for n in (4, 5)]
        moved = cw.cap_river_lanes(self.day, {})
        self.assertEqual(moved, ["id4", "id5"])            # the earlier picks give way first
        self.assertEqual([i["id"] for i in cw.river(self.day)], ["id1", "id2", "id3", "id6"])
        self.assertEqual(self.day["picks_earlier"], [])
        self.assertEqual(self.day["updates"][0]["lead"]["id"], "id6")

    def test_market_stories_get_three_a_day_and_a_chip(self):
        new = [dict(item(n, 4), topic="markets") for n in range(1, 6)] + [dict(item(6, 3), topic="markets")]
        result = self.answer(new, add=[0, 1, 2, 3], markets=[4, 5])
        in_river = [i["id"] for i in cw.river(self.day)]
        self.assertEqual(sorted(in_river), ["id1", "id2", "id3"])
        self.assertEqual(sorted(result["shelved"]), ["id4", "id5", "id6"])
        cw.finish(self.day, {}, NOW, changed=True)
        self.assertEqual(len(self.day["markets"]), 6)
        self.assertEqual(sum(1 for i in self.day["markets"] if i.get("river")), 3)
        self.assertEqual(self.day["markets_count"], {"local": 0, "everything": 6})
        self.assertNotIn("markets", [k for k in self.day["sports"]])
        self.assertIn("`markets`", cw.TASK)
        self.assertIn("never investment advice", cw.TASK)

    def test_a_markets_desk_files_under_markets(self):
        a = dict(item(1, 3), src="cnbc-market-insider")
        tags = {"id1": {"ch": "world", "local": False, "junk": "none", "topic": "business", "score": 3}}
        self.assertEqual(cw.apply_tags([a], tags)[0]["topic"], "markets")
        b = dict(item(2, 3), src="marketwatch-bulletins")         # not tagged yet
        self.assertEqual(cw.apply_tags([b], {})[0]["topic"], "markets")
        # a river story filed before its tag said markets gets it, and the cap sees it
        self.day["updates"] = [{"key": "morning", "label": "Morning", "items": [filed(3, None)]}]
        self.assertEqual(cw.hydrate_sports(self.day, {"id3": {"topic": "markets"}}), 1)
        self.assertEqual(len(cw.counted(cw.river(self.day), "markets")), 1)

    def test_mixed_picks_adds_and_lanes(self):
        self.day["updates"] = [{"key": "morning", "label": "Morning",
                                "items": [filed(1, "nba"), dict(filed(2, None), topic="markets")]}]
        new = [item(10, 6, sport="nba"), dict(item(11, 5), topic="markets"), item(12, 5, sport="nfl"),
               item(13, 4, sport="nhl"), item(14, 4, sport="tennis")]
        # river pick (0 is id1), a NEW pick also in add and in `sports`, two lanes at once
        off = len(cw.river(self.day))
        answer = {"add": [off + 0, off + 1, off + 2, off + 3, off + 4], "lead": -1, "lead_why": "",
                  "drop": [], "sports": [off + 0, off + 4], "markets": [off + 1],
                  "picks": [{"i": 0, "why": "Big."}, {"i": off + 0, "why": "Bigger."}]}
        result = cw.apply_answer(self.day, answer, cw.river(self.day), new, True, self.et, NOW)
        in_river = {i["id"] for i in cw.river(self.day)}
        self.assertEqual(in_river, {"id1", "id2", "id10", "id11", "id12", "id13"})
        self.assertEqual(result["shelved"], ["id14"])               # sports full at four
        self.assertEqual([p["id"] for p in self.day["picks"]], ["id1", "id10"])
        self.assertEqual(len(cw.counted(cw.river(self.day), "sports")), 4)
        self.assertEqual(len(cw.counted(cw.river(self.day), "markets")), 2)

    def test_the_river_cap_keeps_a_dropped_lane_story_on_its_chip(self):
        self.day["updates"] = [{"key": "morning", "label": "Morning",
                                "items": [filed(n, None, local=True) for n in range(1, cw.RIVER_MAX + 1)]}]
        new = [dict(item(900, 3), topic="markets")]
        result = self.answer(new, add=[0])
        self.assertNotIn("id900", {i["id"] for i in cw.river(self.day)})   # the oldest national goes
        self.assertIn("id900", result["shelved"])
        self.assertIn("id900", {i["id"] for i in cw.shelf_items(self.day, "markets")})

    def test_a_day_frozen_over_the_cap_is_capped_first(self):
        import tempfile
        self.day["date"] = "2026-10-18"
        self.day["updates"] = [{"key": "morning", "label": "Morning",
                                "items": [filed(n, "nba") for n in range(1, 8)]}]
        with tempfile.TemporaryDirectory() as data:
            cw.freeze(self.day, data)
            final = wc.load_json(os.path.join(data, "wire", "2026-10-18.json"), {})
        self.assertEqual(len(cw.counted(cw.river(final), "sports")), cw.SPORTS_RIVER_MAX)
        self.assertEqual(len(final["sports"]["nba"]), 7)

    def test_a_river_from_before_the_cap_is_trimmed_keeping_picks_and_the_biggest(self):
        self.day["updates"] = [{"key": "morning", "label": "Morning",
                                "lead": {"id": "id1", "why": "Lead."},
                                "items": [filed(n, "nba") for n in range(1, 9)] + [filed(9, None)]}]
        self.day["picks"] = [dict(filed(2, "nba"), rank=1, why="Big.")]
        scores = {"id1": 2, "id2": 2, "id3": 5, "id4": 3, "id5": 6, "id6": 1, "id7": 2, "id8": 4}
        moved = cw.cap_river_lanes(self.day, scores)
        kept = [i["id"] for i in cw.river(self.day)]
        self.assertEqual(kept, ["id1", "id2", "id3", "id5", "id9"])     # lead, pick, then 6 and 5
        self.assertEqual(moved, ["id4", "id6", "id7", "id8"])
        self.assertEqual(cw.cap_river_lanes(self.day, scores), [])      # settled
        cw.finish(self.day, {}, NOW, changed=False)
        self.assertEqual(len(self.day["sports"]["nba"]), 8)
        self.assertIn("id4", {i["id"] for i in cw.shelf_items(self.day)})

    def test_mlb_is_a_chip_only_in_its_postseason(self):
        for date, chip in (("2026-10-19", "mlb"), ("2026-07-04", "other")):
            day = cw.empty_day(date)
            cw.finish(day, {}, NOW, changed=True)
            cw.shelve(day, [item(1, 3, sport="mlb")])
            cw.finish(day, {}, NOW, changed=True)
            self.assertEqual(list(day["sports"]), [chip], date)
            self.assertEqual(day["sport_chips"], wc.sport_chips(date))
            self.assertEqual("mlb" in day["sport_chips"], chip == "mlb")

    def test_shelved_stories_are_never_offered_again_or_re_served(self):
        cw.shelve(self.day, [item(1, 3, sport="nba"), dict(item(2, 3), topic="markets")])
        self.assertEqual([i["id"] for i in cw.shelf_items(self.day)], ["id1", "id2"])
        import tempfile
        with tempfile.TemporaryDirectory() as data:
            wc.write_json(os.path.join(data, "wire", "2026-10-18.json"), self.day)
            ids, urls, _ = cw.reserved(data, "2026-10-19")
        self.assertIn("id1", ids)
        self.assertIn("id2", ids)

    def test_the_prompt_says_how_many_sports_have_run(self):
        new = [item(1, 3, sport="tennis")]
        user = cw.build_prompt([], new + [dict(item(2, 3), topic="markets")], [], [], False, self.et,
                               "Midday", NOW_TS, lanes_in_river={"sports": 3, "markets": 1})
        self.assertIn("Sports in today's main river: 3 of 4.", user)
        self.assertIn("Market stories in today's main river: 1 of 3.", user)
        self.assertIn("`sports`", cw.TASK)
        self.assertIn("sports", cw.schema(False)["properties"])


def recap(rid, kind, hours_ago, bullets=None):
    posted = NOW - timedelta(hours=hours_ago)
    return {"id": rid, "kind": kind, "title": "whatever the store held",
            "posted_at": posted.replace(microsecond=0).isoformat(), "d": int(posted.timestamp()),
            "intro": "Intro.", "basis": "trending",
            "bullets": bullets or [{"text": "A headline", "url": f"https://x.com/a/status/{rid}",
                                    "note": "Why it matters."}]}


class PhotosWorldTests(unittest.TestCase):
    """Stephen, 2026-10-19: "Photos 'Everything': no generic headline photos,
    only images that are the story." """

    def pulse(self):
        def photo(n, src, hours_ago):
            d = NOW_TS - hours_ago * 3600
            return {"id": f"p{n}", "src": src, "name": src.title(), "title": f"Picture {n}",
                    "url": f"https://pics.example/{n}", "image": f"https://cdn.example/{n}.jpg",
                    "credit": "AP", "posted_at": wc.iso_ts(d), "d": d}
        return {
            "photos": {"checked": NOW.isoformat(), "sources": {
                "nasa-apod": {"name": "NASA APOD", "ok": True},
                "nasa-earth-observatory": {"name": "NASA Earth Observatory", "ok": False}},
                "items": [photo(1, "nasa-apod", 2), photo(2, "atlantic-in-focus", 30),
                          photo(3, "nasa-apod", 24 * 8), dict(photo(4, "x", 1), image="")]},
            "inbox": {"recaps": {"items": [recap("2026-10-19-pictures", "pictures", 0.5, bullets=[
                {"text": "Aurora over the lake", "url": "https://x.com/NWSBurlington/status/123",
                 "note": "Rare this far south."},
                {"text": "Not a post", "url": "https://www.nasa.gov/x", "note": "Skipped."}])]}},
            "items": [{"s": "ap", "t": "A news story", "u": "https://ap.example/1", "d": NOW_TS,
                       "i": "https://ap.example/thumb.jpg"}],
        }

    def test_feeds_and_pictures_recap_newest_first_and_no_news_thumbnails(self):
        out = cw.photos_world(self.pulse(), NOW)
        self.assertEqual([p["id"] for p in out], [wc.item_id("https://x.com/NWSBurlington/status/123"),
                                                  "p1", "p2"])     # p3 is 8 days old; p4 has no picture
        x = out[0]
        self.assertEqual((x["kind"], x["embed"], x["name"], x["why"]),
                         ("x", "x", "@NWSBurlington", "Rare this far south."))
        self.assertNotIn("image", x)                                 # nothing re-hosted
        self.assertEqual((out[1]["kind"], out[1]["image"], out[1]["credit"]),
                         ("photo", "https://cdn.example/1.jpg", "AP"))
        self.assertNotIn("https://ap.example/thumb.jpg", str(out))

    def test_finish_writes_photos_world_and_its_status(self):
        day = cw.empty_day("2026-10-19")
        pulse = self.pulse()
        cw.finish(day, pulse, NOW, changed=True)
        self.assertEqual(len(day["photos_world"]), 3)
        self.assertEqual(day["status"]["photos"]["down"], ["NASA Earth Observatory"])
        cw.finish(day, pulse, NOW + timedelta(minutes=10), changed=False)
        self.assertEqual(day["updated"], NOW.isoformat())
        pulse["photos"]["items"].insert(0, dict(pulse["photos"]["items"][0], id="p9",
                                                url="https://pics.example/9"))
        later = NOW + timedelta(minutes=20)
        cw.finish(day, pulse, later, changed=False)
        self.assertEqual(day["updated"], later.isoformat())          # a new picture is news


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
        self.assertEqual(day["sports"]["nba"][0]["river"], True)

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
