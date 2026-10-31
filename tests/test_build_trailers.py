"""build_trailers.py: the title gate on real titles from the channels' feeds,
reading a feed in the shape YouTube serves it, the no-key path end to end with
a faked network, keeping the last file when reading fails, and the channel
list.

Nothing here touches the network.

Run: python3 -m unittest tests.test_build_trailers
"""

import argparse
import json
import os
import sys
import tempfile
import unittest
import urllib.error
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import build_trailers as bt  # noqa: E402

NOW = bt.SELFTEST_NOW
FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <title>Videos</title>
 <published>2021-10-13T07:10:08+00:00</published>
 <entry>
  <yt:videoId>nIw1O3zvOfE</yt:videoId>
  <title>JUMANJI: OPEN WORLD - New Trailer (4K)</title>
  <published>2026-10-28T14:00:00+00:00</published>
  <media:group>
   <media:title>JUMANJI: OPEN WORLD - New Trailer (4K)</media:title>
   <media:description>Watch the new trailer - exclusively in theatres Christmas Day.</media:description>
   <media:community><media:statistics views="10954941"/></media:community>
  </media:group>
 </entry>
 <entry>
  <yt:videoId>abcdefghijk</yt:videoId>
  <title>Behind the wheel with the cast</title>
  <published>2026-10-27T14:00:00+00:00</published>
  <media:group><media:description>A clip.</media:description><media:community><media:statistics views="10"/></media:community></media:group>
 </entry>
</feed>"""
SONY = "UULFz97F7dMxBNOfGYu3rx8aCw"
PAGE_OK = '"playabilityStatus":{"status":"OK"},"lengthSeconds":"171","playableInEmbed":true'


def net(pages):
    def fetch(url):
        for part, body in pages.items():
            if part in url:
                if isinstance(body, Exception):
                    raise body
                return body if isinstance(body, bytes) else body.encode()
        raise urllib.error.URLError("not faked: " + url)
    return fetch


def args(folder):
    return argparse.Namespace(out=os.path.join(folder, "trailers.json"), seen="", films="", rss=False)


class Titles(unittest.TestCase):
    def test_selftest(self):
        bt.selftest()

    def test_the_trailer_rule_is_the_word_and_not_the_channel(self):
        self.assertTrue(bt.is_trailer("Dune: Part Three | Final Trailer", 2026))
        self.assertTrue(bt.is_trailer("Slayground | Official Teaser HD | A24", 2026))
        self.assertFalse(bt.is_trailer("The Mosquito Bowl Exclusive Spot - Get Tickets Now (2026)", 2026))
        self.assertFalse(bt.is_trailer("BEHEMOTH! | World Premiere | Searchlight Pictures", 2026))

    def test_last_years_tag_passes_and_older_does_not(self):
        self.assertTrue(bt.is_trailer("Some Film Official Trailer (2025)", 2026))
        self.assertFalse(bt.is_trailer("Some Film Official Trailer (2024)", 2026))

    def test_a_series_on_a_streamer_needs_corroboration(self):
        today = bt.datetime(2026, 10, 30).date()
        alone = [bt.upload("prideNflxxx", "Pride and Prejudice | Official Trailer | Netflix", 2, "Netflix", bt.MIXED)]
        self.assertIsNone(bt.local_gate("prideandprejudice", alone, {}, today))
        backed = alone + [bt.upload("prideRTrrrr", "Pride and Prejudice Trailer #1 (2026)", 2, "Rotten Tomatoes Trailers", bt.HOUSE)]
        self.assertEqual(bt.local_gate("prideandprejudice", backed, {}, today)["where"], "streaming")

    def test_a_studio_and_a_streamer_together_are_a_theatrical_film(self):
        today = bt.datetime(2026, 10, 30).date()
        both = [bt.upload("aaaaaaaaaaa", "Way Out | Official Trailer", 2, "Sony"), bt.upload("bbbbbbbbbbb", "Way Out | Official Trailer | Netflix", 2, "Netflix", bt.MIXED)]
        self.assertEqual(bt.local_gate("wayout", both, {}, today)["where"], "theaters")

    def test_the_list_of_the_best_ever_is_no_corroboration(self):
        today = bt.datetime(2026, 10, 30).date()
        films = {"top": [{"id": 4348, "t": "Pride and Prejudice", "d": "2005-09-16"}], "trend": [{"id": 4348, "t": "Pride and Prejudice", "d": "2005-09-16"}]}
        self.assertEqual(bt.new_shelves(films, today), {})


class Reading(unittest.TestCase):
    def test_a_feed_in_youtubes_shape(self):
        rows = bt.parse_feed(FEED, ("Sony", "UCz97F7dMxBNOfGYu3rx8aCw", bt.STUDIO))
        self.assertEqual([r["yt"] for r in rows], ["nIw1O3zvOfE", "abcdefghijk"])
        self.assertEqual(rows[0]["views"], 10954941)
        self.assertIn("Christmas Day", rows[0]["desc"])

    def test_the_long_form_playlist_is_the_channel_with_its_prefix_swapped(self):
        seen = []
        bt.read_rss(lambda url: seen.append(url) or FEED)
        self.assertTrue(seen[0].endswith("playlist_id=UULFi8e0iOVk1fEOogdfu4YgfA"), seen[0])

    def test_api_falls_back_from_uulf_to_the_plain_playlist(self):
        def fetch(url):
            if "playlistId=UULF" in url:
                raise urllib.error.HTTPError(url, 404, "no", {}, None)
            return json.dumps({"items": [{"contentDetails": {"videoId": "nIw1O3zvOfE", "videoPublishedAt": "2026-10-28T14:00:00Z"}, "snippet": {"title": "A | Official Trailer", "description": ""}}]}).encode()
        rows, read = bt.read_api(fetch, "k")
        self.assertEqual(read, len(bt.CHANNELS))
        self.assertEqual(rows[0]["yt"], "nIw1O3zvOfE")

    def test_api_facts_read_embeddable_age_and_region(self):
        rows = {"items": [
            {"id": "aaaaaaaaaaa", "contentDetails": {"duration": "PT2M"}, "status": {"embeddable": True}, "statistics": {"viewCount": "5"}},
            {"id": "bbbbbbbbbbb", "contentDetails": {"duration": "PT2M", "contentRating": {"ytRating": "ytAgeRestricted"}}, "status": {"embeddable": True}},
            {"id": "ccccccccccc", "contentDetails": {"duration": "PT2M", "regionRestriction": {"blocked": ["US"]}}, "status": {"embeddable": True}},
            {"id": "ddddddddddd", "contentDetails": {"duration": "PT2M"}, "status": {"embeddable": False}},
        ]}
        out = bt.api_facts(lambda url: json.dumps(rows).encode(), "k", ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd", "eeeeeeeeeee"])
        self.assertEqual([out[k]["plays"] for k in sorted(out)], [True, False, False, False, False])
        self.assertEqual(out["aaaaaaaaaaa"]["secs"], 120)

    def test_a_429_stops_asking(self):
        asked = []

        def fetch(url):
            asked.append(url)
            raise urllib.error.HTTPError(url, 429, "slow down", {}, None)
        self.assertEqual(bt.page_facts(fetch, [f"k{i:010d}" for i in range(40)]), {})
        self.assertLessEqual(len(asked), bt.PAGE_WORKERS)


class Runs(unittest.TestCase):
    def setUp(self):
        self.keep = {k: os.environ.pop(k, None) for k in ("YOUTUBE_API_KEY", "TMDB_API_KEY")}

    def tearDown(self):
        for k, v in self.keep.items():
            if v is not None:
                os.environ[k] = v

    def test_no_keys_at_all_writes_a_real_file_from_rss(self):
        with tempfile.TemporaryDirectory() as d:
            a = args(d)
            bt.run(a, fetch=net({SONY: FEED, "watch?v=": PAGE_OK}), now=NOW)
            got = json.load(open(a.out))
            self.assertEqual(got["source"], "YouTube RSS")
            self.assertEqual([e["yt"] for e in got["fresh"]], ["nIw1O3zvOfE"])
            first = got["fresh"][0]
            self.assertEqual((first["t"], first["d"], first["dur"], first["where"], first["ch"]), ("Jumanji: Open World", "2026-12-25", "2:51", "theaters", "Sony"))
            self.assertTrue(os.path.exists(os.path.join(d, "trailers-seen.json")))

    def test_every_feed_failing_keeps_the_last_file(self):
        with tempfile.TemporaryDirectory() as d:
            a = args(d)
            with open(a.out, "w") as f:
                f.write('{"v":1,"fresh":[{"id":1,"t":"Kept","yt":"nIw1O3zvOfE","at":1}],"past":[]}')
            bt.run(a, fetch=net({}), now=NOW)
            self.assertEqual(json.load(open(a.out))["fresh"][0]["t"], "Kept")

    def test_a_film_list_that_will_not_load_costs_only_the_corroboration(self):
        with tempfile.TemporaryDirectory() as d:
            a = args(d)
            a.films = "https://example.test/films.json"
            bt.run(a, fetch=net({SONY: FEED, "watch?v=": PAGE_OK, "example.test": urllib.error.URLError("down")}), now=NOW)
            self.assertEqual(len(json.load(open(a.out))["fresh"]), 1)

    def test_a_broken_last_file_is_no_memory_at_all(self):
        with tempfile.TemporaryDirectory() as d:
            a = args(d)
            open(a.out, "w").close()      # git show of a branch without it
            bt.run(a, fetch=net({SONY: FEED, "watch?v=": PAGE_OK}), now=NOW)
            self.assertEqual(len(json.load(open(a.out))["fresh"]), 1)


    def uploads_api(self, videos):
        """The Data API with one trailer in every channel's playlist."""
        items = {"items": [{"contentDetails": {"videoId": "nIw1O3zvOfE", "videoPublishedAt": "2026-10-28T14:00:00Z"}, "snippet": {"title": "Jumanji: Open World | Official Trailer", "description": ""}}]}
        return net({"playlistItems": json.dumps(items), "/videos?": videos})

    def test_a_videos_call_that_fails_keeps_the_last_file(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(os.environ, {"YOUTUBE_API_KEY": "k"}):
            a = args(d)
            with open(a.out, "w") as f:
                f.write('{"v":1,"fresh":[{"id":1,"t":"Kept","yt":"nIw1O3zvOfE","at":1}],"past":[]}')
            self.assertEqual(bt.run(a, fetch=self.uploads_api(urllib.error.HTTPError("u", 400, "bad", {}, None)), now=NOW), 0)
            self.assertEqual(json.load(open(a.out))["fresh"][0]["t"], "Kept")

    def test_videos_list_is_not_sent_maxresults(self):
        asked = []

        def fetch(url):
            asked.append(url)
            return b'{"items": []}'
        bt.api_facts(fetch, "k", ["nIw1O3zvOfE"])
        self.assertNotIn("maxResults", asked[0])

    def carried(self, d, page):
        a = args(d)
        with open(a.out, "w") as f:
            json.dump({"v": 1, "fresh": [{"id": 1, "t": "Kept", "yt": "nIw1O3zvOfE", "at": NOW - 86400}], "past": []}, f)
        bt.run(a, fetch=net({"watch?v=nIw1O3zvOfE": page, "watch?v=": PAGE_OK, "feeds": FEED.replace("nIw1O3zvOfE", "aaaaaaaaaaa")}), now=NOW)
        return json.load(open(a.out))

    def test_a_carried_trailer_that_stopped_playing_leaves_the_file(self):
        with tempfile.TemporaryDirectory() as d:
            got = self.carried(d, PAGE_OK.replace('"playableInEmbed":true', '"playableInEmbed":false'))
            self.assertNotIn("nIw1O3zvOfE", [e["yt"] for e in got["fresh"] + got["past"]])

    def test_a_carried_trailer_that_still_plays_stays(self):
        with tempfile.TemporaryDirectory() as d:
            got = self.carried(d, PAGE_OK)
            self.assertIn("nIw1O3zvOfE", [e["yt"] for e in got["fresh"] + got["past"]])

    def test_a_film_list_that_will_not_load_keeps_skip_and_checked(self):
        with tempfile.TemporaryDirectory() as d:
            a = args(d)
            a.films = "https://example.test/films.json"
            with open(a.out, "w") as f:
                json.dump({"v": 1, "fresh": [], "past": [], "skip": ["B6Z9MM1LhEA"]}, f)
            seen = os.path.join(d, "trailers-seen.json")
            with open(seen, "w") as f:
                json.dump({"checked": {"B6Z9MM1LhEA": [NOW, 0], "dQw4w9WgXcQ": [NOW, 1]}}, f)
            bt.run(a, fetch=net({SONY: FEED, "watch?v=": PAGE_OK, "example.test": urllib.error.URLError("down")}), now=NOW)
            self.assertEqual(json.load(open(a.out))["skip"], ["B6Z9MM1LhEA"])
            self.assertEqual(set(json.load(open(seen))["checked"]), {"B6Z9MM1LhEA", "dQw4w9WgXcQ"})


class BackCatalogue(unittest.TestCase):
    OLD = {"id": 278, "t": "The Shawshank Redemption", "y": 1994, "d": "1994-09-23", "g": ["Drama"], "o": "Long overview.", "rt": 142, "p": "/a.jpg", "yt": "PLl99DlL6b4"}

    def row(self, n, **extra):
        return {"id": 1000 + n, "t": f"Film {n}", "y": 2001, "d": "2001-05-01", "g": [], "yt": f"k{n:010d}", **extra}

    def test_a_film_with_a_key_joins_past_after_the_channels_with_no_upload_date(self):
        uploaded = {"id": 5, "t": "River", "yt": "riverUniver", "at": NOW - 86400}
        out = bt.back_catalogue([], [uploaded], {"top": [self.OLD]}, {}, set())
        self.assertEqual([e["t"] for e in out], ["River", "The Shawshank Redemption"])
        self.assertNotIn("at", out[1])
        self.assertNotIn("o", out[1])
        self.assertEqual(out[1]["g"], ["Drama"])

    def test_one_row_a_film_across_shelves_and_against_the_channels(self):
        films = {"now": [self.OLD], "top": [self.OLD, {**self.OLD, "id": 9, "yt": "PLl99DlL6b5"}, {**self.row(1), "t": "Fresh"}]}
        fresh = [{"id": 40000001, "t": "fresh", "yt": "freshKey001", "at": NOW}]
        out = bt.back_catalogue(fresh, [], films, {}, set())
        self.assertEqual([e["id"] for e in out], [278])

    def test_a_key_that_will_not_play_stays_out(self):
        self.assertEqual(bt.back_catalogue([], [], {"top": [self.OLD]}, {}, {"PLl99DlL6b4"}), [])

    def test_tv_never_joins(self):
        self.assertEqual(bt.back_catalogue([], [], {"tv_top": [self.OLD], "tv_air": [self.OLD]}, {}, set()), [])

    def test_past_stops_at_the_cap_and_the_channels_stay(self):
        uploaded = [{"id": i, "t": f"Up {i}", "yt": f"u{i:010d}", "at": NOW - i} for i in range(1, 11)]
        out = bt.back_catalogue([], uploaded, {"top": [self.row(n) for n in range(400)]}, {}, set())
        self.assertEqual(len(out), bt.PAST_MAX)
        self.assertEqual(out[:10], uploaded)
        self.assertEqual(out[10]["t"], "Film 0")

    def test_a_film_list_that_will_not_load_carries_the_last_back_catalogue(self):
        prev = {"past": [self.row(1), self.row(2, at=NOW - 86400)]}
        self.assertEqual([e["id"] for e in bt.back_catalogue([], [], {}, prev, set())], [1001])

    def test_a_run_writes_it_and_the_next_run_does_not_lose_or_double_it(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("YOUTUBE_API_KEY", None)
            os.environ.pop("TMDB_API_KEY", None)
            a = args(d)
            a.films = os.path.join(d, "films.json")
            with open(a.films, "w") as f:
                json.dump({"top": [self.OLD]}, f)
            for tick in (0, 86400):
                bt.run(a, fetch=net({SONY: FEED, "watch?v=": PAGE_OK}), now=NOW + tick)
                got = json.load(open(a.out))
                self.assertEqual([e["t"] for e in got["past"] if "at" not in e], ["The Shawshank Redemption"])
                self.assertEqual(len(got["fresh"]), 1)


class Channels(unittest.TestCase):
    def test_every_id_is_a_channel_id_and_unique(self):
        ids = [c[1] for c in bt.CHANNELS]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(i.startswith("UC") and len(i) == 24 for i in ids))

    def test_the_roster_points_at_the_real_rotten_tomatoes_trailers(self):
        with open(os.path.join(HERE, "..", "data", "youtube-channels.json"), encoding="utf-8") as src:
            roster = json.load(src)["channels"]
        film = [c for c in roster if c.get("g") == "trailer"]
        self.assertEqual(next(c["id"] for c in film if c["name"] == "Rotten Tomatoes Trailers"), bt.CHANNELS[0][1])
        self.assertTrue(all(c.get("must") for c in film))


if __name__ == "__main__":
    unittest.main()
