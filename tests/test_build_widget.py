"""build_widget.py: the home-screen widget's widget.json. Each case pins a
rule: the weather page's 90-minute rule for "right now", the brief's rain
line and high and low, the Wire's Local top three in rank order, What Now's
Tonight list ranked so a big-room show beats weekly trivia, the next UVM or
local game, and a failed source keeping its last good section.

Nothing touches the network.

Run: python3 -m unittest tests/test_build_widget.py
"""

import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import build_widget as bw  # noqa: E402

ET = ZoneInfo("America/New_York")


def at(day, hh, mm=0):
    return datetime(2026, 10, day, hh, mm, tzinfo=ET)


def period(name, start, is_day, temp, short="Sunny", pop=0):
    return {"name": name, "start": start.isoformat(), "is_day": is_day, "temp_f": temp,
            "pop": pop, "wind": "S 5 mph", "short": short, "detailed": short}


def hours(start, n, temp=50, wet=()):
    rows = []
    for i in range(n):
        t = start + timedelta(hours=i)
        rows.append({"t": t.isoformat(), "temp_f": temp + i, "feels_f": temp + i, "pop": 80 if i in wet else 0,
                     "wind_mph": 5, "short": "Rain" if i in wet else "Sunny", "qpf_in": 0.1 if i in wet else 0.0,
                     "snow_in": 0.0, "gust_mph": 8})
    return rows


def weather_payload(obs_at, obs_temp=37, wet=()):
    return {
        "now": {"observed_at": obs_at.astimezone(timezone.utc).isoformat(), "description": "Clear", "temp_f": obs_temp},
        "forecast": {"periods": [
            period("Today", at(22, 6), True, 55),
            period("Tonight", at(22, 18), False, 31, "Rain" if wet else "Mostly Clear", 80 if wet else 0),
            period("Friday", at(23, 6), True, 50),
            period("Friday Night", at(23, 18), False, 30, "Mostly Clear"),
        ]},
        "hourly": {"hours": hours(at(22, 6), 40, wet=wet)},
        "alerts": {"active": []},
    }


class Weather(unittest.TestCase):
    def test_a_fresh_airport_reading_is_right_now(self):
        now = at(22, 12, 30)
        w = bw.weather(weather_payload(now - timedelta(minutes=89)), now)
        self.assertEqual((w["temp"], w["sky"], w["from"]), (37, "Clear", "airport"))

    def test_past_ninety_minutes_this_hours_forecast_stands_in(self):
        now = at(22, 12, 30)
        w = bw.weather(weather_payload(now - timedelta(minutes=91)), now)
        # the 12:00 row is hour six of the run: 50 + 6
        self.assertEqual((w["temp"], w["sky"], w["from"]), (56, "Sunny", "forecast"))
        # and the reading travels along so the phone can redo the rule later
        self.assertEqual(w["obs"]["temp"], 37)
        self.assertEqual(w["hours"][0]["t"], at(22, 12).isoformat())

    def test_no_reading_at_all_is_the_forecast(self):
        d = weather_payload(at(22, 12))
        d["now"] = {}
        w = bw.weather(d, at(22, 12, 30))
        self.assertEqual(w["from"], "forecast")
        self.assertIsNone(w["obs"])

    def test_high_low_and_a_dry_line(self):
        now = at(22, 9)
        w = bw.weather(weather_payload(now), now)
        self.assertEqual((w["hi"], w["lo"]), (55, 31))
        self.assertEqual(w["rain"], "Dry through tonight")
        self.assertEqual(w["link"], "https://guide.btownbrief.com/weather.html")

    def test_the_rain_line_says_when(self):
        now = at(22, 9)
        # hours 15 to 19 of a run from 6 am: 9 pm to 2 am
        w = bw.weather(weather_payload(now, wet=range(15, 20)), now)
        self.assertTrue(w["rain"].startswith("Rain tonight from 9pm"), w["rain"])

    def test_evening_is_tonights_low_and_tomorrows_high(self):
        now = at(22, 20)
        w = bw.weather(weather_payload(now), now)
        self.assertEqual((w["hi"], w["lo"]), (50, 31))
        self.assertEqual(w["rain"], "Dry through Friday")

    def test_nothing_usable(self):
        self.assertIsNone(bw.weather(None, at(22, 9)))
        self.assertIsNone(bw.weather({"now": {}, "hourly": {"hours": []}}, at(22, 9)))


def item(i, local=True, **kw):
    return {"id": "id%d" % i, "title": "Story  %d" % i, "name": "Outlet %d" % i, "url": "https://x.test/%d" % i,
            "local": local, **kw}


class Wire(unittest.TestCase):
    def test_local_picks_in_rank_order_three_at_most(self):
        p = {"updates": [], "picks": [item(3, rank=3), item(1, local=False, rank=1), item(2, rank=2),
                                       item(4, rank=4), item(5, rank=5)]}
        out = bw.wire(p)
        self.assertEqual([x["title"] for x in out], ["Story 2", "Story 3", "Story 4"])
        self.assertEqual(out[0]["link"], "https://guide.btownbrief.com/all-day/#wire/id2")
        self.assertEqual(out[0]["src"], "Outlet 2")

    def test_short_picks_are_made_up_from_earlier_then_the_newest_update(self):
        p = {"picks": [item(1, rank=1)], "picks_earlier": [item(1, rank=1), item(2, rank=4)],
             "updates": [{"items": [item(9)]}, {"items": [item(8, own=True), item(7)]}]}
        self.assertEqual([x["title"] for x in bw.wire(p)], ["Story 1", "Story 2", "Story 7"])

    def test_not_a_paper(self):
        self.assertIsNone(bw.wire(None))
        self.assertIsNone(bw.wire({"picks": []}))


def ev(i, start, title=None, **kw):
    e = {"id": "e%d" % i, "title": title or "Show %d" % i, "start": start.isoformat(), "url": "https://e.test/%d" % i,
         "category": "other", "allDay": False, "venue": "Somewhere", "town": "Burlington"}
    e.update(kw)
    return e


class Tonight(unittest.TestCase):
    MUSIC = {"bigrooms": [{"name": "Higher Ground"}, {"name": "The Flynn"}],
             "artists": [{"name": "Dead Gowns"}]}

    def test_the_tonight_filter(self):
        now = at(22, 18, 30)
        evs = [
            ev(1, at(22, 14)),                                   # afternoon
            ev(2, at(22, 19), allDay=True),                      # all day
            ev(3, at(22, 19), title="CANCELLED: Show"),          # cancelled
            ev(4, at(22, 17), end=at(22, 18).isoformat()),       # over
            ev(5, at(22, 16, 15)),                               # started before 5 pm
            ev(6, at(23, 19)),                                   # tomorrow
            ev(7, at(22, 19)),                                   # in
            ev(8, at(22, 17)),                                   # started 90 minutes ago, no end: still on
            ev(9, at(22, 20), status="cancelled"),
        ]
        self.assertEqual({e["id"] for e in bw.tonight_list(evs, now)}, {"e7", "e8"})

    def test_a_big_room_one_off_beats_weekly_trivia(self):
        now = at(22, 12)
        evs = [
            ev(1, at(22, 18), "Trivia", category="games", tags=["series"], recurring="Thursdays, 6 p.m."),
            ev(2, at(22, 19), "Gaelic Storm at Higher Ground", category="music", venue="Higher Ground",
               town="South Burlington"),
            ev(3, at(22, 19, 30), "Dead Gowns, Helenor", category="music", venue="Monkey House", town="Winooski"),
            ev(4, at(22, 18), "Book club", category="words"),
        ]
        out = bw.tonight({"events": evs}, self.MUSIC, now)
        self.assertEqual([x["title"] for x in out], ["Gaelic Storm", "Dead Gowns, Helenor", "Book club", "Trivia"])
        self.assertEqual(out[0]["time"], "7 pm")
        self.assertEqual(out[1]["time"], "7:30 pm")
        self.assertEqual(out[0]["venue"], "Higher Ground")
        self.assertEqual(out[0]["link"], "https://guide.btownbrief.com/all-day/#whatnow/tonight")

    def test_the_same_show_from_two_calendars_runs_once(self):
        now = at(22, 12)
        evs = [ev(1, at(22, 19), "Dana and Alden at Higher Ground", venue="Higher Ground"),
               ev(2, at(22, 19, 30), "Dana and Alden, Alex Amen", venue="Higher Ground"),
               ev(3, at(22, 19), "Gaelic Storm at Higher Ground", venue="Higher Ground")]
        self.assertEqual([x["title"] for x in bw.tonight({"events": evs}, {}, now)], ["Dana and Alden", "Gaelic Storm"])

    def test_not_a_payload(self):
        self.assertIsNone(bw.tonight({"nope": 1}, {}, at(22, 12)))


def game(org, title, start, level="college", **kw):
    return {"org": org, "title": title, "start": start.astimezone(timezone.utc).isoformat(), "level": level,
            "sport": kw.pop("sport", "Soccer"), "allDay": False, **kw}


class Game(unittest.TestCase):
    def test_the_next_uvm_or_local_game(self):
        now = at(22, 12)
        g = bw.next_game({"games": [
            game("Bruins", "Bruins vs Mammoth", at(22, 13), level="national"),
            game("UVM", "Field Hockey vs Bryant", at(23, 15)),
            game("UVM", "Women's Soccer vs UAlbany", at(22, 18), home=True, tv="ESPN+",
                 url="https://uvmathletics.com/calendar.aspx?game_id=1&amp;sport_id=15"),
            game("UVM", "Soccer at Maine", at(21, 18), state="post"),
        ]}, now)
        self.assertEqual(g["title"], "UVM Women's Soccer vs UAlbany")
        self.assertEqual(g["when"], "Today 6 pm")
        self.assertEqual(g["url"], "https://uvmathletics.com/calendar.aspx?game_id=1&sport_id=15")
        self.assertEqual(g["link"], "https://guide.btownbrief.com/sports.html")
        self.assertTrue(g["home"])

    def test_basketball_opens_on_airs_hoops_and_a_weekday_reads_short(self):
        now = at(22, 12)
        g = bw.next_game({"games": [game("UVM", "Men's Basketball vs Stonehill", at(24, 14), sport="Men's Basketball")]}, now)
        self.assertEqual((g["when"], g["link"]), ("Sat 2 pm", "https://guide.btownbrief.com/all-day/#onair/hoops"))

    def test_a_game_under_way_still_counts(self):
        now = at(22, 19)
        g = bw.next_game({"games": [game("UVM", "Hockey vs Clarkson", at(22, 18), state="in"),
                                    game("UVM", "Hockey vs Union", at(23, 19))]}, now)
        self.assertEqual(g["title"], "UVM Hockey vs Clarkson")

    def test_no_game_is_empty_not_missing(self):
        self.assertEqual(bw.next_game({"games": []}, at(22, 12)), {})
        self.assertIsNone(bw.next_game(None, at(22, 12)))


class Build(unittest.TestCase):
    def test_a_failed_source_keeps_its_last_good_section(self):
        now = at(22, 12)
        prev = {"wire": [{"title": "Kept"}], "tonight": [{"title": "Kept too"}], "weather": {"temp": 1}, "game": None}
        out = bw.build({"weather": weather_payload(now), "wire": None, "whatnow": None, "music": None,
                        "sports": {"games": []}}, now=now, previous=prev)
        self.assertEqual(out["wire"], [{"title": "Kept"}])
        self.assertEqual(out["tonight"], [{"title": "Kept too"}])
        self.assertEqual(out["weather"]["temp"], 37)       # fresh beats kept
        self.assertIsNone(out["game"])
        self.assertEqual(out["updated"], "2026-10-22T16:00:00+00:00")
        self.assertEqual(out["v"], 1)

    def test_nothing_to_keep_is_empty(self):
        out = bw.build({}, now=at(22, 12))
        self.assertEqual((out["weather"], out["wire"], out["tonight"], out["game"]), (None, [], [], None))

    def test_main_writes_the_file_and_survives_a_dead_wire(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "widget.json")
            with open(out, "w") as f:
                json.dump({"wire": [{"title": "Last good"}]}, f)
            with mock.patch.object(bw, "fetch_wire", side_effect=OSError("offline")):
                self.assertEqual(bw.main(["--out", out]), 0)
            with open(out) as f:
                d = json.load(f)
            self.assertEqual(d["wire"], [{"title": "Last good"}])
            self.assertEqual(set(d), {"v", "updated", "app", "weather", "wire", "tonight", "game"})

    def test_the_committed_data_builds(self):
        """The repo's own files, as the workflow runs it: every section has
        its shape, nothing is a stray type."""
        inputs = {k: bw.read_json(bw.PATHS[k]) for k in ("weather", "whatnow", "music", "sports")}
        inputs["wire"] = None
        out = bw.build(inputs)
        self.assertIsInstance(out["wire"], list)
        self.assertIsInstance(out["tonight"], list)
        if out["weather"]:
            self.assertIn(out["weather"]["from"], ("airport", "forecast"))
            self.assertIsInstance(out["weather"]["temp"], (int, float))
        json.dumps(out)


if __name__ == "__main__":
    unittest.main()
