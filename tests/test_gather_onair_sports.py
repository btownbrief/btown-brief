"""gather_onair_sports.py: the title rules against titles the NBA and NFL
channels really posted (2026-10-18 to 10-22), the clip-to-game match, ESPN's
scoreboard shape, Reddit's top list, the Starting 5 edition, and Local hoops
from the repo's own files. Nothing here touches the network.

Run: python3 -m unittest tests.test_gather_onair_sports
"""

import argparse
import json
import os
import sys
import tempfile
import unittest
from datetime import date, datetime
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import gather_onair_sports as s  # noqa: E402


def et(stamp):
    return int(datetime.fromisoformat(stamp + ":00-04:00").timestamp())


def espn_event(gid, when, away, home, state="post", scores=("100", "90"), national=("ESPN",)):
    def side(team, ha, score, win):
        nick = team.split()[-1] if team != "Portland Trail Blazers" else "Trail Blazers"
        return {"homeAway": ha, "score": score, "winner": win,
                "team": {"displayName": team, "name": nick, "abbreviation": nick[:3].upper(), "color": "1d428a"}}
    return {"id": gid, "date": when, "status": {"type": {"state": state, "shortDetail": "Final" if state == "post" else "7:00 PM"}},
            "links": [{"href": "https://www.espn.com/nba/game/_/gameId/" + gid}],
            "competitions": [{"competitors": [side(away, "away", scores[0], True), side(home, "home", scores[1], False)],
                              "broadcasts": [{"market": "national", "names": list(national)}, {"market": "home", "names": ["NBA League Pass"]}]}]}


class Titles(unittest.TestCase):
    def test_nba_keeps_full_games_recap_and_top_ten(self):
        keep = ["KINGS at CLIPPERS | FULL GAME HIGHLIGHTS | October 21, 2026",
                "SUNS at TRAIL BLAZERS | FULL GAME HIGHLIGHTS | October 21, 2026",
                "NBA's Nightly Recap | October 21, 2026",
                "NBA's Top 10 Plays of the Night | October 21, 2026"]
        drop = ["KEVIN DURANT MAKES THE RIM FEEL THAT ONE 💣💥",
                "Dame Lillard Was ON TARGET in his Return to Portland | October 21, 2026",
                "Final 4:11 ELECTRIC Ending Pelicans vs Pacers | October 21, 2026",
                "DAME LILLARD OPENS UP ABOUT THE EMOTIONS OF OPENING NIGHT 🎙️🏀"]
        self.assertEqual([s.classify("nba", t)[0] for t in keep], ["game", "game", "recap", "top"])
        self.assertEqual([s.classify("nba", t)[0] for t in drop], [None] * 4)

    def test_nfl_keeps_game_highlights_and_top_plays(self):
        self.assertEqual(s.classify("nfl", "Chicago Bears vs Atlanta Falcons Game Highlights | 2026 NFL Season Week 6")[0], "game")
        self.assertEqual(s.classify("nfl", "Buffalo Bills vs. Las Vegas Raiders Game Highlights | NFL 2026 Season Week 6")[0], "game")
        self.assertEqual(s.classify("nfl", "Top 15 Plays of Week 6! | 2026 NFL Season")[0], "top")
        for t in ["Tampa Bay Buccaneers vs Carolina Panthers | 2026 Week 7 Game Preview", "Top 5 Plays of Week 6! #shorts",
                  "The NFL Report: J.J McCarthy will lead the Giants", "Week 6 Mic'd Up! | Game Day All Access"]:
            self.assertIsNone(s.classify("nfl", t)[0], t)

    def test_card_titles(self):
        k, m = s.classify("nba", "PORTLAND TRAIL BLAZERS at PHILADELPHIA 76ERS | FULL GAME HIGHLIGHTS | October 21, 2026")
        self.assertEqual(s.clip_title("nba", k, m, "2026-10-21"), "Portland Trail Blazers at Philadelphia 76ers")
        k, m = s.classify("nba", "NBA's Nightly Recap | October 21, 2026")
        self.assertEqual(s.clip_title("nba", k, m, "2026-10-21"), "Nightly recap · Oct. 21")
        k, m = s.classify("nfl", "Chicago Bears vs Atlanta Falcons Game Highlights | 2026 NFL Season Week 6")
        self.assertEqual(s.clip_title("nfl", k, m, "2026-10-18"), "Chicago Bears vs. Atlanta Falcons")


class Games(unittest.TestCase):
    def test_scoreboard_shape_and_national_tv(self):
        g = s.parse_scoreboard({"events": [espn_event("1", "2026-10-22T02:00Z", "Phoenix Suns", "Portland Trail Blazers", national=("ESPN", "NBA League Pass"))]})[0]
        self.assertEqual((g["day"], g["away"]["nick"], g["home"]["nick"], g["tv"], g["state"]), ("2026-10-21", "Suns", "Trail Blazers", ["ESPN"], "post"))
        self.assertEqual(g["away"]["color"], "1d428a")
        self.assertTrue(g["away"]["win"] and not g["home"]["win"])

    def test_a_clip_finds_its_game_by_nicknames(self):
        games = s.parse_scoreboard({"events": [
            espn_event("1", "2026-10-22T02:00Z", "Phoenix Suns", "Portland Trail Blazers"),
            espn_event("2", "2026-10-22T02:30Z", "Sacramento Kings", "LA Clippers"),
            espn_event("3", "2026-10-24T02:30Z", "Sacramento Kings", "LA Clippers", state="pre")]})
        clip = {"id": "x" * 11, "kind": "game", "raw": "SUNS at TRAIL BLAZERS | FULL GAME HIGHLIGHTS | October 21, 2026", "d": et("2026-10-22 00:45")}
        clips = s.link_games([clip], games)
        self.assertEqual(clips[0]["game"], "1")
        self.assertEqual(next(g for g in games if g["id"] == "1")["hl"], "x" * 11)
        # a game not yet played never takes a highlight
        other = {"id": "y" * 11, "kind": "game", "raw": "KINGS at CLIPPERS | FULL GAME HIGHLIGHTS | October 21, 2026", "d": et("2026-10-22 01:20")}
        self.assertEqual(s.link_games([other], games)[0]["game"], "2")

    def test_months_cover_the_window(self):
        self.assertEqual(s.months_between(date(2026, 10, 28), date(2026, 11, 4)), ["202610", "202611"])
        self.assertEqual(s.months_between(date(2026, 12, 30), date(2027, 1, 2)), ["202612", "202701"])


class Gate(unittest.TestCase):
    def test_lengths_and_embeds(self):
        cand = {"id": "a" * 11, "title": "KINGS at CLIPPERS | FULL GAME HIGHLIGHTS | October 21, 2026", "d": et("2026-10-22 01:23")}
        ok = {"ok": True, "live": False, "sec": 944, "kids": False, "t": cand["title"], "ch": "NBA"}
        clip, why = s.gate("nba", cand, ok)
        self.assertIsNone(why)
        self.assertEqual((clip["t"], clip["day"], clip["dur"]), ("Kings at Clippers", "2026-10-21", "15:44"))
        self.assertEqual(s.gate("nba", cand, dict(ok, sec=58))[1], "too short")
        self.assertEqual(s.gate("nba", cand, dict(ok, ok=False))[1], "not embeddable")
        self.assertEqual(s.gate("nba", cand, dict(ok, sec=0)), (None, None))


class Reddit(unittest.TestCase):
    def test_top_list_drops_threads_and_nsfw_and_reads_the_tag(self):
        posts = [
            {"id": "a", "title": "[Highlight] Damian Lillard hits from Dame Distance", "url": "https://www.reddit.com/r/nba/comments/a/x/", "out": "https://streamable.com/abc"},
            {"id": "b", "title": "GAME THREAD: Cavaliers @ 76ers", "url": "https://www.reddit.com/r/nba/comments/b/x/"},
            {"id": "c", "title": "Barkley on Shaq", "url": "https://www.reddit.com/r/nba/comments/c/x/", "nsfw": True},
            {"id": "d", "title": "Lamelo Ball travels a few steps", "url": "https://www.reddit.com/r/nba/comments/d/x/", "flair": "Highlight", "score": 9000, "comments": 800},
        ]
        out = s.shape_reddit(posts)
        self.assertEqual([p["id"] for p in out], ["a", "d"])
        self.assertEqual((out[0]["flair"], out[0]["t"], out[0]["out"]), ("Highlight", "Damian Lillard hits from Dame Distance", "https://streamable.com/abc"))
        self.assertEqual((out[1]["score"], out[1]["comments"]), (9000, 800))


ARCHIVE = """<html><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"category":{"latest":{"items":[
{"title":"Keep up with the Cup","permalink":"https://www.nba.com/news/cup"},
{"title":"Starting 5: Season openers deliver standout performances","permalink":"https://www.nba.com/news/starting-5-october-22-2026","date":"2026-10-22T14:20:17Z","excerpt":"Wednesday's 11-game slate."}]}}}}}</script></html>"""
EDITION = """<article><h3>Starting 5 Daily Newsletter</h3><h3>5 STORIES IN TODAY’S EDITION 🏀</h3><h3>BUT FIRST … ⏰</h3>
<h3>1. OPENING ACTS: ANT GOES OFF, HALI COMES UP CLUTCH</h3><h3>2. HOT HANDS AND DEBUT DUBS</h3>
<h3>3. ROUNDUP: KD LIFTS ROCKETS</h3><h3>4. Q&amp;A: DR. J REFLECTS</h3><h3>5. TONIGHT ON ESPN: CAVS VISIT SIXERS (7 ET)</h3><h3>Related</h3></article>"""


class StartingFive(unittest.TestCase):
    def test_latest_edition_and_its_five_stories(self):
        ed = s.s5_latest(ARCHIVE)
        self.assertEqual(ed["url"], "https://www.nba.com/news/starting-5-october-22-2026")
        self.assertEqual(s.s5_stories(EDITION), ["Opening Acts: Ant Goes Off, Hali Comes Up Clutch", "Hot Hands And Debut Dubs",
                                                 "Roundup: KD Lifts Rockets", "Q&A: Dr. J Reflects", "Tonight On ESPN: Cavs Visit Sixers (7 ET)"])


class Local(unittest.TestCase):
    def test_uvm_basketball_only_and_unescaped(self):
        sports = {"games": [
            {"org": "UVM", "sport": "Men's Basketball", "title": "Men's Basketball vs Stonehill (exhibition)", "date": "2026-10-24",
             "start": "2026-10-24T18:00:00+00:00", "home": True, "url": "https://uvmathletics.com/calendar.aspx?game_id=6981&amp;sport_id=3"},
            {"org": "UVM", "sport": "Men's Hockey", "title": "Men's Hockey vs Maine", "date": "2026-10-24"},
            {"org": "UVM", "sport": "Women's Basketball", "title": "Women's Basketball at Maine", "date": "2027-03-30"}]}
        out = s.uvm_games(sports, date(2026, 10, 22))
        self.assertEqual(len(out), 1)
        self.assertEqual((out[0]["side"], out[0]["t"], out[0]["url"]), ("m", "vs Stonehill (exhibition)", "https://uvmathletics.com/calendar.aspx?game_id=6981&sport_id=3"))

    def test_play_list_from_clubs_and_groups(self):
        clubs = {"clubs": [
            {"id": "ejrp-barcomb-basketball-league", "kind": "league", "name": "Barcomb Basketball League", "what": "adult basketball", "when": "Mondays 6pm (Fall)", "url": "https://www.ejrp.org"},
            {"id": "btown-brief-pickup-basketball", "kind": "pickup", "name": "Btown Brief IRL Pickup Basketball", "what": "", "when": "Wednesdays", "url": "https://www.meetup.com/x/"},
            {"id": "vermont-dodgeball", "kind": "pickup", "name": "Vermont Dodgeball", "what": "dodgeball", "when": "Mondays", "url": "http://www.vtdodgeball.com"}]}
        groups = {"groups": [{"id": "ejrp-barcomb-basketball-league", "town": "Essex Junction", "cost": "$70"}]}
        out = s.play_list(clubs, groups, [{"id": "uvm", "name": "UVM Campus Rec", "url": "https://uvmcampusrec.com/x", "cost": "$12 a day"}])
        self.assertEqual([p["name"] for p in out], ["Barcomb Basketball League", "UVM Campus Rec"])
        self.assertEqual((out[0]["when"], out[0]["where"], out[0]["cost"]), ("Mondays 6pm", "Essex Junction", "$70"))

    def test_a_long_week_of_times_reads_short(self):
        self.assertEqual(s.compact_when("Mondays 6:45pm · Mondays 7:15pm · Tuesdays 6:45pm · Tuesdays 7:15pm"), "Mon, Tue 6:45pm & 7:15pm")
        self.assertEqual(s.compact_when("Mondays 6pm · Wednesdays 6pm"), "Mondays 6pm · Wednesdays 6pm")

    def test_next_pickup_from_meetup_page(self):
        page = ('"title":"Pick-up Basketball","dateTime":"2026-10-21T17:30:00-04:00","eventUrl":"https://www.meetup.com/burlington-social-activites-group/events/316803943/"'
                ' "title":"Pick-up Basketball","dateTime":"2026-10-28T17:30:00-04:00","eventUrl":"https://www.meetup.com/burlington-social-activites-group/events/316902566/"')
        nxt = s.next_pickup(page, et("2026-10-22 10:00"))
        self.assertEqual(nxt["url"], "https://www.meetup.com/burlington-social-activites-group/events/316902566/")


class Run(unittest.TestCase):
    def test_a_run_with_every_source_down_keeps_the_file_and_exits(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "onair-sports.json")
            prev = {"leagues": {"nba": {"games": [], "clips": [], "reddit": [{"id": "a"}], "reddit_at": 1}}}
            with open(out, "w") as fh:
                json.dump(prev, fh)

            def boom(*a, **k):
                raise OSError("offline")
            with mock.patch.object(s.finds, "fetch", boom), mock.patch.object(s.finds, "youtube_auth", lambda: (None, None)), \
                    mock.patch.object(s, "espn_games", boom), mock.patch.object(s.reddit, "http_fetch", boom), \
                    mock.patch.object(s, "reddit_top", lambda *a, **k: boom()):
                p = s.run(argparse.Namespace(out=out, dry_run=True), env={"ONAIR_SPORTS_NO_SLEEP": "1"})
            self.assertEqual(p["leagues"]["nba"]["reddit"], [])     # a day and a half old: dropped
            self.assertTrue(all(v.startswith("failed") or v == "ok" for v in p["stats"]["sources"].values()))
            self.assertIn("play", p["local"])


if __name__ == "__main__":
    unittest.main()
