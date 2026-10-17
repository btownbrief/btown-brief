"""build_time_machine.py: the shelves read off an archived front page in each
of its three markups (2021 tiles, 2023 tiles, 2025-26 text lists), the
exact-title TMDB match, the TMDB fallback for a month with no usable copy,
the months kept from the last file, and the fail-soft posture.

The pages below are written for this test in the shape of the real ones;
every title in them is invented. Nothing here touches the network.

Run: python3 -m unittest tests.test_build_time_machine
"""

import argparse
import json
import os
import re
import sys
import tempfile
import unittest
import urllib.parse
from datetime import date
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import build_time_machine as tm  # noqa: E402
from build_films import Tmdb  # noqa: E402

PAGE_2021 = """
<h2>News &amp; features</h2><a href="/m/not_this_one">Not This One</a>
<h2>Popular in Theaters</h2>
<tile-poster-video><button data-media-url="/m/lake_house_heist" data-title="Lake House Heist"></button>
<a href="/m/lake_house_heist" class="unset" slot="link"><tile-poster-meta>
<score-icon-critic percentage="61"></score-icon-critic><span slot="title" class="p--small">Lake House Heist</span>
</tile-poster-meta></a></tile-poster-video>
<a href="/m/the_long_ferry_2021" slot="link"><span>The Long Ferry</span> 88%</a>
<a href="/m/lake_house_heist" slot="link"><span>Lake House Heist</span></a>
<h2>Popular Streaming Movies</h2>
<a href="https://www.rottentomatoes.com/m/quiet_orchard"><span>Quiet Orchard</span></a>
<h2>Most Popular TV on RT</h2>
<a href="/tv/harbor_town/s02"><span>Harbor Town: S02</span></a>
<a href="/tv/harbor_town/s02"><span>Harbor Town: S02</span></a>
<h2>Past January Box Office Winners</h2><a href="/m/old_winner">Old Winner</a>
"""

PAGE_2023 = """
<h2 data-qa="title">Popular In Theaters</h2>
<tile-dynamic><img alt="Moss Road poster"/><a slot="caption" href="/m/moss_road" data-track="scores">
<score-pairs-deprecated criticsscore="52"></score-pairs-deprecated><span class="p--small">Moss Road</span></a></tile-dynamic>
<h2 data-qa="title">Popular Streaming Movies</h2>
<a slot="caption" href="/m/salt_and_cedar"><span class="p--small">Salt &amp; Cedar</span></a>
<h2>Most Popular TV on RT</h2><a href="/tv/north_wind"><span>North Wind</span></a>
"""

PAGE_2026 = """
<h2 class="unset" data-qa="title"><rt-text context="heading">Movies in Theaters</rt-text></h2>
<a slot="meta-data" href="/m/moss_road"><rt-text>Moss Road</rt-text></a>
<a slot="meta-data" href="/m/brand_new_thing"><rt-text>Brand New Thing</rt-text></a>
<h2 class="unset" slot="header"><rt-text context="heading" size="1.25">Popular TV </rt-text></h2>
<ul><li><a href="/tv/north_wind/s03"><span class="dynamic-text-list__item-title">North Wind</span></a>
<a href="/tv/north_wind/s03" class="dynamic-text-list__tomatometer-group"><score-icon-critics></score-icon-critics>
<rt-text context="label"> 92% </rt-text></a></li></ul>
<h2 class="unset" slot="header"><rt-text context="heading" size="1.25">Top 10 Box Office</rt-text></h2>
<ul><li><a href="/m/avengers_style_rerun"><span class="dynamic-text-list__item-title">Old Big Hit</span></a></li>
<li><a href="/m/moss_road"><span class="dynamic-text-list__item-title">Moss Road</span></a></li></ul>
"""

WALL = "<h2>Log in or sign up</h2><h2>Let's keep in touch!</h2>"


class Extract(unittest.TestCase):
    def test_2021_tiles_titles_in_order_once_each_and_only_the_three_shelves(self):
        got = tm.extract(PAGE_2021)
        self.assertEqual(got["theaters"], [("movie", "lake_house_heist", "Lake House Heist"),
                                           ("movie", "the_long_ferry_2021", "The Long Ferry")])
        self.assertEqual(got["streaming"], [("movie", "quiet_orchard", "Quiet Orchard")])
        self.assertEqual(got["tv"], [("tv", "harbor_town", "Harbor Town")])   # ": S02" and the repeat gone

    def test_2023_tiles_and_entities(self):
        got = tm.extract(PAGE_2023)
        self.assertEqual(got["theaters"], [("movie", "moss_road", "Moss Road")])
        self.assertEqual(got["streaming"], [("movie", "salt_and_cedar", "Salt & Cedar")])

    def test_2026_box_office_comes_first_and_scores_are_not_titles(self):
        got = tm.extract(PAGE_2026)
        self.assertEqual([t for _, _, t in got["theaters"]], ["Old Big Hit", "Moss Road", "Brand New Thing"])
        self.assertEqual(got["tv"], [("tv", "north_wind", "North Wind")])

    def test_a_login_wall_has_no_shelves(self):
        self.assertEqual(sum(len(v) for v in tm.extract(WALL).values()), 0)
        self.assertEqual(sum(len(v) for v in tm.extract("").values()), 0)

    def test_months_newest_first_across_a_new_year(self):
        self.assertEqual(tm.month_list(date(2026, 2, 3), 4), ["2026-02", "2026-01", "2025-12", "2025-11"])


# ----------------------------------------------------------- a fake TMDB
SEARCH = {
    ("movie", "Lake House Heist"): [{"id": 11, "title": "Lake House Heist", "release_date": "2020-12-25", "popularity": 50, "poster_path": "/a.jpg", "genre_ids": [28]},
                                    {"id": 12, "title": "Lake House Heist", "release_date": "1988-01-01", "popularity": 90}],
    ("movie", "The Long Ferry"): [{"id": 21, "title": "The Long Ferry", "release_date": "2019-01-01", "popularity": 99},
                                  {"id": 22, "title": "The Long Ferry", "release_date": "2021-01-08", "popularity": 5, "overview": "word " * 80}],
    ("movie", "Quiet Orchard"): [{"id": 31, "title": "Quiet Orchards", "release_date": "2020-01-01", "popularity": 9}],
    ("movie", "Moss Road"): [{"id": 41, "title": "Moss Road", "release_date": "2099-01-01", "popularity": 9}],
    ("tv", "Harbor Town"): [{"id": 51, "name": "Harbor Town", "first_air_date": "2001-01-01", "popularity": 3},
                            {"id": 52, "name": "Harbor Town", "first_air_date": "2019-01-01", "popularity": 30, "poster_path": "/h.jpg", "genre_ids": [18]}],
}
GENRES = {"movie": [{"id": 28, "name": "Action"}], "tv": [{"id": 18, "name": "Drama"}]}


def fake_tmdb(calls):
    def opener(url, headers):
        u = urllib.parse.urlparse(url)
        q = dict(urllib.parse.parse_qsl(u.query))
        path = u.path.replace("/3", "", 1)
        calls.append((path, q))
        m = re.match(r"^/genre/(movie|tv)/list$", path)
        if m:
            return {"genres": GENRES[m.group(1)]}
        m = re.match(r"^/search/(movie|tv)$", path)
        if m:
            return {"results": SEARCH.get((m.group(1), q.get("query")), [])}
        m = re.match(r"^/discover/(movie|tv)$", path)
        if m:
            kind = m.group(1)
            name = "title" if kind == "movie" else "name"
            when = "release_date" if kind == "movie" else "first_air_date"
            return {"results": [{"id": 900 + i + (50 if kind == "tv" else 0), name: f"Found {kind} {i}", when: q.get(when + ".gte"),
                                 "popularity": 10 - i} for i in range(3)]}
        raise AssertionError("unexpected TMDB call " + url)
    return Tmdb("0123456789abcdef0123456789abcdef", opener)


class Match(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.m = tm.Matcher(fake_tmdb(self.calls))

    def test_closest_release_to_the_month_wins_over_popularity(self):
        got = self.m.match("movie", "lake_house_heist", "Lake House Heist", "2021-01")
        self.assertEqual((got["id"], got["k"], got["y"], got["p"], got["g"]), (11, "movie", 2020, "/a.jpg", ["Action"]))

    def test_a_year_in_the_slug_must_agree(self):
        got = self.m.match("movie", "the_long_ferry_2021", "The Long Ferry", "2021-01")
        self.assertEqual(got["id"], 22)
        self.assertLessEqual(len(got["o"]), tm.OVERVIEW_MAX)

    def test_no_exact_title_no_match(self):
        self.assertIsNone(self.m.match("movie", "quiet_orchard", "Quiet Orchard", "2021-01"))

    def test_a_film_from_after_the_month_is_not_it(self):
        self.assertIsNone(self.m.match("movie", "moss_road", "Moss Road", "2023-10"))

    def test_a_show_by_popularity_and_searches_are_cached(self):
        a = self.m.match("tv", "harbor_town", "Harbor Town", "2021-01")
        b = self.m.match("tv", "harbor_town", "Harbor Town", "2021-02")
        self.assertEqual((a["id"], a["k"], a["g"]), (52, "tv", ["Drama"]))
        self.assertEqual(b, a)
        self.assertEqual(sum(1 for p, _ in self.calls if p == "/search/tv"), 1)


class FakeWayback:
    def __init__(self, pages):
        self.pages = pages   # month -> html (or None for no copy)
        self.calls = 0
        self.asked = []

    def month(self, month):
        self.calls += 2
        self.asked.append(month)
        doc = self.pages.get(month)
        if doc is None:
            return None, None
        shelves = tm.extract(doc)
        return (month.replace("-", "") + "15000000", shelves) if sum(len(v) for v in shelves.values()) >= 1 else (None, None)


class Build(unittest.TestCase):
    def test_months_from_the_page_from_tmdb_when_there_is_none_and_kept_from_last_time(self):
        calls = []
        months = ["2021-03", "2021-02", "2021-01"]
        way = FakeWayback({"2021-03": None, "2021-02": WALL, "2021-01": PAGE_2021})
        with mock.patch.object(tm, "MIN_TITLES", 1):
            titles, out = tm.build(months, way, tm.Matcher(fake_tmdb(calls)))
        by = {m["m"]: m for m in out}
        self.assertEqual(by["2021-01"]["src"], "rt")
        self.assertEqual(by["2021-01"]["theaters"], ["m11", "m22"])
        self.assertEqual(by["2021-01"]["streaming"], [])          # "Quiet Orchard" had no exact match
        self.assertEqual(by["2021-01"]["tv"], ["t52"])
        self.assertEqual(by["2021-02"]["src"], "tmdb")            # a login wall falls back to TMDB
        self.assertEqual(by["2021-03"]["src"], "tmdb")
        self.assertEqual(by["2021-03"]["theaters"], ["m900", "m901", "m902"])
        self.assertEqual(by["2021-03"]["tv"], ["t950", "t951", "t952"])
        disc = [q for p, q in calls if p == "/discover/movie" and q["release_date.gte"] == "2021-03-01"]
        self.assertEqual(disc[0]["release_date.lt"], "2021-04-01")
        self.assertTrue(all(k in titles for m in out for s in tm.CAP for k in m[s]))
        self.assertEqual(titles["m11"]["t"], "Lake House Heist")

        # the next run keeps a finished month and asks again for the newest two
        prev = tm.payload(titles, out, tm.utcnow())
        way2 = FakeWayback({"2021-04": PAGE_2021, "2021-03": PAGE_2021, "2021-02": PAGE_2021, "2021-01": None})
        with mock.patch.object(tm, "MIN_TITLES", 1):
            titles2, out2 = tm.build(["2021-04"] + months, way2, tm.Matcher(fake_tmdb([])), prev)
        self.assertEqual(way2.asked, ["2021-04", "2021-03", "2021-02"])   # 2021-02 was tmdb last time: asked again
        self.assertEqual({m["m"]: m["src"] for m in out2}["2021-01"], "rt")
        self.assertEqual({m["m"]: m for m in out2}["2021-01"]["theaters"], ["m11", "m22"])
        self.assertIn("m22", titles2)

    def test_december_allows_next_years_release(self):
        m = tm.Matcher(fake_tmdb([]))
        with mock.patch.dict(SEARCH, {("movie", "Snow Day"): [{"id": 61, "title": "Snow Day", "release_date": "2025-01-03", "popularity": 1}]}):
            self.assertEqual(m.match("movie", "snow_day", "Snow Day", "2024-12")["id"], 61)
            self.assertIsNone(m.match("movie", "snow_day", "Snow Day", "2024-11"))


class Run(unittest.TestCase):
    def test_no_key_writes_nothing_and_passes(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(os.environ, {}, clear=True):
            out = os.path.join(d, "tm.json")
            self.assertEqual(tm.run(argparse.Namespace(out=out, prev="", months=3)), 0)
            self.assertFalse(os.path.exists(out))

    def test_too_few_usable_months_fails_and_keeps_the_last_file(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "tm.json")
            empty = Tmdb("k", lambda url, h: {"results": [], "genres": []})
            self.assertEqual(tm.run(argparse.Namespace(out=out, prev="", months=3), empty, FakeWayback({})), 1)
            self.assertFalse(os.path.exists(out))

    def test_a_run_writes_the_file_with_nothing_from_rotten_tomatoes_but_titles(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "tm.json")
            this = tm.month_list(tm.utcnow().date(), 1)[0]
            way = FakeWayback({this: PAGE_2021})
            with mock.patch.object(tm, "MIN_TITLES", 1), mock.patch.object(tm, "MIN_MONTHS", 2):
                self.assertEqual(tm.run(argparse.Namespace(out=out, prev="", months=2), fake_tmdb([]), way), 0)
            with open(out, encoding="utf-8") as src:
                doc = json.load(src)
            self.assertEqual(set(doc), {"v", "built", "source", "notice", "images", "titles", "months"})
            self.assertEqual([m["m"] for m in doc["months"]], tm.month_list(tm.utcnow().date(), 2))
            for item in doc["titles"].values():
                self.assertEqual(set(item), {"id", "k", "t", "y", "d", "g", "o", "p"})
            blob = json.dumps({"titles": doc["titles"], "months": doc["months"]})
            self.assertNotIn("http", blob)
            self.assertNotIn("_2021", blob)            # no Rotten Tomatoes slug
            self.assertNotRegex(blob, r"\d+%")         # no score


if __name__ == "__main__":
    unittest.main()
