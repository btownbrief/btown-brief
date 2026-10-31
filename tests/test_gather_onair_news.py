"""gather_onair_news.py: every show's title rule against titles those channels
really posted the week of 2026-10-12 (the full recap and the clips around
it), the length bar, the wait for a premiere, and a whole run that carries
the file forward, measures only what is new and leaves an unchanged file
alone. Nothing here touches the network.

Run: python3 -m unittest tests.test_gather_onair_news
"""

import argparse
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import gather_onair_news as n  # noqa: E402


def et(stamp):
    """'2026-10-15 23:45' Eastern (EDT) -> epoch seconds"""
    return int(datetime.fromisoformat(stamp + ":00-04:00").timestamp())


def recap(key, title, when):
    return n.is_recap(n.SHOW[key], title, et(when))


FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <title>Jimmy Kimmel Live</title>
 <entry><yt:videoId>4K1Cz42AYxY</yt:videoId>
  <title>The White House is Mad at Jimmy Kimmel AGAIN, Trump&#8217;s Press Secretary Mess &amp; Fox News Betrays Him</title>
  <published>2026-10-16T03:45:00+00:00</published></entry>
 <entry><yt:videoId>MMaOs74_bzs</yt:videoId>
  <title>Judd Apatow on Mushrooms with Wife Leslie Mann</title>
  <published>2026-10-16T06:00:00+00:00</published></entry>
 <entry><yt:videoId>bad</yt:videoId><title>not an id</title><published>2026-10-16T06:00:00+00:00</published></entry>
</feed>"""


def detail(title, sec, ok=True, live=False, kids=False, ch="Jimmy Kimmel Live"):
    return {"t": title, "ch": ch, "cid": "", "sec": sec, "live": live, "ok": ok, "kids": kids, "pub": ""}


class TitleRules(unittest.TestCase):
    def test_newscasts(self):
        self.assertTrue(recap("abc", "ABC World News Tonight with David Muir Full Broadcast - Oct. 18, 2026", "2026-10-18 22:00"))
        self.assertTrue(recap("nbc", "NBC Nightly News Full Episode - Oct. 18", "2026-10-18 19:36"))
        self.assertTrue(recap("nbc", "Oct 17: Oregon shooter details, FlyDubai pilot speaks out", "2026-10-17 22:43"))
        self.assertFalse(recap("nbc", "This Morning’s Top Headlines – Oct. 19 | Morning News NOW", "2026-10-19 08:49"))
        self.assertFalse(recap("nbc", "4th-grade student recounts Oregon school shooting", "2026-10-18 22:57"))
        self.assertTrue(recap("cbs", "CBS Evening News Full Broadcast | October 16, 2026", "2026-10-16 22:24"))
        self.assertTrue(recap("cbs", "CBS Weekend News Full Broadcast | October 18, 2026", "2026-10-18 23:03"))
        self.assertTrue(recap("pbs", "PBS News Hour full episode, Oct. 16, 2026", "2026-10-16 19:12"))
        self.assertFalse(recap("pbs", "WATCH LIVE: Vance speaks at GOP rally in Michigan", "2026-10-15 17:20"))
        self.assertTrue(recap("reuters", "Ukraine intelligence, Alberta referendum, France unrest | Reuters World News", "2026-10-19 08:01"))
        self.assertFalse(recap("reuters", "Big Tech earnings face a crucial AI reality check | Reuters Morning Bid", "2026-10-19 05:22"))

    def test_daily_show_headlines_not_the_interview(self):
        self.assertTrue(recap("dailyshow", "Ramaswamy Nearly Drops a Kid, Paxton's Ad Backfires & Trump Wants to Fix Your Clock | The Daily Show", "2026-10-06 22:00"))
        self.assertFalse(recap("dailyshow", "Sebastian Stan On the Complexities of “Fjord” | The Daily Show", "2026-10-07 23:30"))
        self.assertTrue(recap("dailyshow", "Jon Stewart Unpacks AI’s Dubious Promise of a \"Better Future\" | The Daily Show", "2026-10-05 23:00"))
        self.assertTrue(recap("dailyshow", "Jon Stewart & The News Team Recap the Endless War in Iran Pt. 2 | The Daily Show", "2026-10-16 09:00"))
        self.assertFalse(recap("dailyshow", "Someone get this Trumper a calculator #DailyShow #JordanKlepper #MAGA", "2026-10-17 14:00"))

    def test_last_week_tonight_full_episode(self):
        self.assertTrue(recap("lwt", "S13 E26: Kimberly Guilfoyle & Generic Drugs: 10/11/26: Last Week Tonight with John Oliver", "2026-10-11 23:00"))
        self.assertFalse(recap("lwt", "Generic Drugs: Last Week Tonight with John Oliver (HBO)", "2026-10-12 02:30"))
        self.assertFalse(recap("lwt", "Generic Drugs #lastweektonight", "2026-10-13 10:00"))

    def test_monologues_by_the_hour(self):
        self.assertTrue(recap("kimmel", "Trump is Laser Focused on the Midterms & Our Hero Guillermo Returns After Dancing with the Stars", "2026-10-14 23:45"))
        self.assertTrue(recap("kimmel", "Trump Won’t Win the Nobel Peace Prize, Keeps Talking About Iran Bombing LA & More Broken Promises", "2026-10-09 00:12"))
        self.assertFalse(recap("kimmel", "Judd Apatow on Mushrooms with Wife Leslie Mann & Documentaries About Norm Macdonald & Maria Bamford", "2026-10-16 02:00"))
        self.assertTrue(recap("fallon", "Trump Rages Over Fox News Rally Coverage, U.S. Passport Features \"Non-Negotiable\" Trump Image", "2026-10-08 23:35"))
        self.assertFalse(recap("fallon", "Charades with ROSALÍA, Linda Cardellini and Tate McRae | The Tonight Show Starring Jimmy Fallon", "2026-10-07 23:50"))
        self.assertFalse(recap("fallon", "Keri Russell Got Sick on Her 50th Birthday, Shares Why She Doesn't Like Winning Awards (Extended)", "2026-10-09 00:02"))
        self.assertFalse(recap("fallon", "Hailee Steinfeld Talks Avengers Rumors and Hexed Role as a New Mom", "2026-10-17 09:00"))

    def test_cnn_10_is_a_dated_daily(self):
        self.assertTrue(recap("cnn10", "America welcomes its 64th National Park in Arizona | October 27, 2026", "2026-10-27 00:00"))
        self.assertFalse(recap("cnn10", "A quick explainer on the park", "2026-10-27 12:00"))

    def test_league_lists_not_the_rest(self):
        self.assertTrue(recap("nhl", "Best NHL Goals of Week 4 | 2026-27 Season", "2026-10-27 14:00"))
        self.assertFalse(recap("nhl", "Senators vs. Kings | NHL Highlights | Oct 29, 2026", "2026-10-30 01:00"))
        self.assertFalse(recap("nhl", "Hardest NHL Hits: Week 3 & Week 4", "2026-10-29 14:00"))
        self.assertTrue(recap("mlb", "The Top 10 BEST PLAYS from the 2026 World Series! 🔥 (Brewers win it all & MORE!)", "2026-10-29 17:00"))
        self.assertTrue(recap("mlb", "TOP 20 fielding plays from the 2026 Postseason 😲 (Mitchell's home run robbery & MORE!)", "2026-10-30 12:00"))
        self.assertFalse(recap("mlb", "Brewers vs. Rays World Series Game 5 Shorts Recap", "2026-10-29 01:00"))

    def test_seth_and_snl(self):
        self.assertTrue(recap("seth", "Trump Meets with Election Denier Tina Peters, Allies Plot Midterm \"Plan,\" Martial Law: A Closer Look", "2026-10-07 21:00"))
        self.assertTrue(recap("seth", "Trump's \"Dumocrat\" Obsession and Gas Price Excuses: Late Night News of the Week", "2026-10-09 13:46"))
        self.assertFalse(recap("seth", "A Closer Look Back: Trump's Unfulfilled Campaign Promises", "2026-10-14 14:41"))
        self.assertFalse(recap("seth", "Seth has some questions about Trump’s midterm rally “studs”  #ACloserLook", "2026-10-09 15:08"))
        self.assertTrue(recap("snl", "Weekend Update ft. James Austin Johnson and Ashley Padilla - SNL", "2026-10-12 09:00"))
        self.assertFalse(recap("snl", "Hegseth USS Lincoln Cold Open - SNL", "2026-10-11 00:13"))


class EpisodeTitle(unittest.TestCase):
    def ep(self, key, title, when):
        return n.episode_title(n.SHOW[key], title, et(when))

    def test_a_newscast_is_its_date(self):
        # uploaded after midnight: the date in the title wins
        self.assertEqual(self.ep("abc", "ABC World News Tonight with David Muir Full Broadcast - Oct. 14, 2026", "2026-10-15 00:05"),
                         "Full broadcast · Wednesday, Oct. 14")
        self.assertEqual(self.ep("cbs", "CBS Weekend News Full Broadcast | October 18, 2026", "2026-10-18 23:03"),
                         "Full broadcast · Sunday, Oct. 18")
        self.assertEqual(self.ep("pbs", "PBS News Hour full episode, Sept. 30, 2026", "2026-09-30 19:12"),
                         "Full broadcast · Wednesday, Sept. 30")

    def test_no_date_in_the_title_goes_by_the_upload(self):
        self.assertEqual(self.ep("abc", "ABC World News Tonight Full Broadcast", "2026-10-15 19:00"), "Full broadcast · Thursday, Oct. 15")
        self.assertEqual(self.ep("abc", "ABC World News Tonight Full Broadcast", "2026-10-15 00:05"), "Full broadcast · Wednesday, Oct. 14")

    def test_recap_lane_titles_are_clean(self):
        self.assertEqual(self.ep("cnn10", "America welcomes its 64th National Park in Arizona | October 27, 2026", "2026-10-27 00:00"),
                         "America welcomes its 64th National Park in Arizona")
        self.assertEqual(self.ep("nhl", "Best NHL Goals of Week 3 | 2026-27 Season", "2026-10-20 14:00"), "Best NHL Goals of Week 3")
        self.assertEqual(self.ep("mlb", "The Top 10 BEST PLAYS from the 2026 World Series! 🔥 (Brewers win it all & MORE!)", "2026-10-29 17:00"),
                         "The Top 10 BEST PLAYS from the 2026 World Series!")

    def test_the_show_name_comes_off(self):
        self.assertEqual(self.ep("lwt", "S13 E26: Kimberly Guilfoyle & Generic Drugs: 10/11/26: Last Week Tonight with John Oliver", "2026-10-11 23:00"),
                         "Kimberly Guilfoyle & Generic Drugs")
        self.assertEqual(self.ep("dailyshow", "Jon Stewart & The News Team Recap the Endless War in Iran Pt. 2 | The Daily Show", "2026-10-16 09:00"),
                         "Jon Stewart & The News Team Recap the Endless War in Iran Pt. 2")
        self.assertEqual(self.ep("seth", "Trump's Shrinking Crowds, GOP Backlash Over LA & San Diego Comments, El-Sayed's Dare: A Closer Look", "2026-10-08 21:00"),
                         "Trump's Shrinking Crowds, GOP Backlash Over LA & San Diego Comments, El-Sayed's Dare")
        self.assertEqual(self.ep("snl", "Weekend Update ft. James Austin Johnson and Ashley Padilla - SNL", "2026-10-12 09:00"),
                         "Weekend Update ft. James Austin Johnson and Ashley Padilla")
        self.assertEqual(self.ep("nbc", "Oct 17: Oregon shooter details, FlyDubai pilot speaks out", "2026-10-17 22:43"),
                         "Oregon shooter details, FlyDubai pilot speaks out")


class Gate(unittest.TestCase):
    cand = {"id": "4K1Cz42AYxY", "title": "x", "d": 1760000000, "sk": "kimmel"}

    def test_keeps_a_full_monologue(self):
        item, why = n.gate(n.SHOW["kimmel"], self.cand, detail("Mad at Jimmy Kimmel AGAIN", 853))
        self.assertIsNone(why)
        self.assertEqual((item["show"], item["kind"], item["topic"], item["dur"], item["d"]),
                         ("Jimmy Kimmel Live", "comedy", "news", "14:13", 1760000000))

    def test_short_or_unplayable_is_forgotten(self):
        self.assertEqual(n.gate(n.SHOW["kimmel"], self.cand, detail("x", 300))[1], "too short")
        self.assertEqual(n.gate(n.SHOW["kimmel"], self.cand, detail("x", 900, ok=False))[1], "not embeddable")
        self.assertEqual(n.gate(n.SHOW["kimmel"], self.cand, None)[1], "gone")

    def test_a_premiere_waits(self):
        self.assertEqual(n.gate(n.SHOW["kimmel"], self.cand, detail("x", 0, live=True)), (None, None))
        self.assertEqual(n.gate(n.SHOW["kimmel"], self.cand, detail("x", 0)), (None, None))

    def test_parse_feed(self):
        got = n.parse_feed(FEED)
        self.assertEqual([e["id"] for e in got], ["4K1Cz42AYxY", "MMaOs74_bzs"])
        self.assertIn("Trump’s Press Secretary Mess & Fox News", got[0]["title"])
        self.assertEqual(got[0]["d"], et("2026-10-15 23:45"))

    def test_cap_per_show(self):
        items = [{"sk": "abc", "id": str(i)} for i in range(12)] + [{"sk": "nbc", "id": "x"}]
        self.assertEqual(len(n.cap_shows(items)), n.PER_SHOW + 1)


class Run(unittest.TestCase):
    NOW = et("2026-10-16 09:00")

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.out = os.path.join(self.dir, "onair-news.json")
        self.calls = []

    def args(self, dry=False):
        return argparse.Namespace(out=self.out, dry_run=dry)

    def fake_fetch(self, url, **kw):
        self.calls.append(url)
        if "UCa6vGFO9ty8v5KZJXQxdhaw" in url:
            return FEED
        return '<feed xmlns="http://www.w3.org/2005/Atom"></feed>'

    def go(self, details, auth=({"key": "k"}, {})):
        asked = []

        def fake_details(ids, _auth):
            asked.append(list(ids))
            return {i: details[i] for i in ids if i in details}
        with mock.patch.object(n.finds, "fetch", self.fake_fetch), \
                mock.patch.object(n.finds, "now_ts", lambda: self.NOW), \
                mock.patch.object(n.finds, "youtube_auth", lambda: auth), \
                mock.patch.object(n.finds, "youtube_details", fake_details), \
                mock.patch("sys.stdout"), mock.patch("sys.stderr"):
            n.run(self.args())
        with open(self.out, encoding="utf-8") as fh:
            return json.load(fh), asked

    def test_a_run_measures_only_the_monologue_then_carries_it(self):
        d, asked = self.go({"4K1Cz42AYxY": detail("Mad at Jimmy Kimmel AGAIN", 853)})
        self.assertEqual(asked, [["4K1Cz42AYxY"]])          # the 2 am interview is never measured
        self.assertEqual([it["id"] for it in d["items"]], ["4K1Cz42AYxY"])
        self.assertEqual(len(self.calls), len(n.SHOWS))     # one feed request a show
        before = os.path.getmtime(self.out)
        os.utime(self.out, (before - 100, before - 100))
        d2, asked2 = self.go({})
        self.assertEqual(asked2, [])                         # nothing new: no API call
        self.assertEqual(d2["items"], d["items"])
        self.assertEqual(os.path.getmtime(self.out), before - 100)   # unchanged file not rewritten

    def test_no_credentials_waits_in_pending(self):
        d, asked = self.go({}, auth=(None, None))
        self.assertEqual(asked, [])
        self.assertEqual(d["items"], [])
        self.assertEqual([c["id"] for c in d["pending"]], ["4K1Cz42AYxY"])
        d2, asked = self.go({"4K1Cz42AYxY": detail("Mad at Jimmy Kimmel AGAIN", 853)})
        self.assertEqual(asked, [["4K1Cz42AYxY"]])
        self.assertEqual([it["id"] for it in d2["items"]], ["4K1Cz42AYxY"])
        self.assertEqual(d2["pending"], [])

    def test_one_the_cap_pushes_out_is_not_measured_again(self):
        mine = [{"id": "KEEP%07d" % i, "t": "x", "ep": "x", "show": "Jimmy Kimmel Live", "sk": "kimmel", "ch": "Jimmy Kimmel Live",
                 "kind": "comedy", "topic": "news", "sec": 900, "dur": "15:00", "d": self.NOW - 3600 * (i + 1)} for i in range(n.PER_SHOW)]
        with open(self.out, "w", encoding="utf-8") as fh:
            json.dump({"items": mine}, fh)
        # the feed's monologue is older than all eight on the shelf, so the cap drops it
        d, asked = self.go({"4K1Cz42AYxY": detail("Mad at Jimmy Kimmel AGAIN", 853)})
        self.assertEqual(asked, [["4K1Cz42AYxY"]])
        self.assertNotIn("4K1Cz42AYxY", [it["id"] for it in d["items"]])
        self.assertIn("4K1Cz42AYxY", d["seen"])
        _, asked2 = self.go({"4K1Cz42AYxY": detail("Mad at Jimmy Kimmel AGAIN", 853)})
        self.assertEqual(asked2, [])

    def test_a_rejected_video_is_never_asked_again_and_old_ones_drop(self):
        old = {"id": "OLDOLDOLD01", "t": "x", "show": "ABC World News Tonight", "sk": "abc", "ch": "ABC News",
               "kind": "newscast", "topic": "news", "sec": 1200, "dur": "20:00", "d": self.NOW - 8 * 86400}
        with open(self.out, "w", encoding="utf-8") as fh:
            json.dump({"items": [old]}, fh)
        d, asked = self.go({"4K1Cz42AYxY": detail("x", 200)})
        self.assertEqual(d["items"], [])                     # eight days old: gone
        self.assertIn("4K1Cz42AYxY", d["seen"])
        _, asked2 = self.go({})
        self.assertEqual(asked2, [])


if __name__ == "__main__":
    unittest.main()
