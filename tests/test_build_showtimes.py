"""build_showtimes.py: each theater's page in the shape it really has
(Partizanfilm's homepage notice and Veezi sessions, Majestic 10's date bar
and nowplaying fragment, Essex Cinemas' ScreeningEvent JSON-LD), times to
24-hour, ALL CAPS titles cased, a closed theater's reopening, one theater's
failure not sinking the others, and the TMDB match.

The pages are written for this test; the films are invented. Nothing here
touches the network.

Run: python3 -m unittest tests.test_build_showtimes
"""

import argparse
import json
import os
import sys
import tempfile
import unittest
import urllib.parse
from datetime import date, datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import build_showtimes as bs  # noqa: E402
from build_films import Tmdb  # noqa: E402

TODAY = date(2026, 10, 17)
NOW = datetime(2026, 10, 17, 14, 0, tzinfo=timezone.utc)   # 10 am in Burlington

PZ_HOME_CLOSED = """<div class="sqs-block-content"><p>Partizanfilm is temporarily closed. We will return on
Friday, Oct. 30, with improved heating and cooling systems.</p>
<a href="https://ticketing.useast.veezi.com/sessions/?siteToken=abc123tok">Tickets</a></div>"""

VEEZI_PAGE = """<div id="sessionsByDateConent" role="tabpanel">
<div class="date"><h3 class="date-title highlight-foreground">Friday 30, October</h3>
<div class="film " id=""><div><h3 class="title">
  Lantern Season
</h3><ul class="session-times"><li><a href="/purchase/1"><time>1:55 PM</time></a></li>
<li><a href="/purchase/2"><time>11:59 PM</time></a></li></ul></div></div>
<div class="film "><h3 class="title">Small Hours &amp; Co.</h3><ul class="session-times"><li><time>12:05 PM</time></li></ul></div>
</div>
<div class="date"><h3 class="date-title">Saturday 2, January</h3>
<div class="film "><h3 class="title">New Year Film</h3><time>7:00 PM</time></div></div>
</div>
<div id="sessionsByFilmConent"><div class="date"><h3 class="date-title">Friday 30, October</h3>
<div class="film "><h3 class="title">Lantern Season</h3><time>1:55 PM</time></div></div></div>"""

MJ_HOME_PAGE = """<div class="dates__item active " data-date="10/17/2026" role="listitem"></div>
<div class="dates__item  " data-date="10/18/2026" role="listitem"></div>
<div class="dates__item  dates__item--disabled" data-date="10/19/2026" role="listitem"></div>"""


def mj_fragment(films):
    out = ['<script>ttk.screenData.nowPlayingInstanceName = ""</script>']
    for title, times in films:
        out.append('<div class="nowPlaying__item " id="x"><h3 class="nowPlaying__movieTitle" title="%s" role="heading">'
                   '<a>%s</a></h3><div class="nowPlaying__showtimes">' % (title, title))
        for t in times:
            out.append('<div class="performance__item"><a class="button button--showtime" href="#" onclick="x">\n'
                       '            <span>%s</span></a></div>' % t)
        out.append('</div></div>')
    return "\n".join(out)


ESSEX_PAGE = """<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
{"@type":"BreadcrumbList","itemListElement":[]},
{"@type":"ScreeningEvent","name":"Harbor Lights at Essex Cinemas","startDate":"2026-10-17T20:45:00-04:00",
 "workPresented":{"@type":"Movie","name":"Harbor Lights"}},
{"@type":"ScreeningEvent","name":"Harbor Lights at Essex Cinemas","startDate":"2026-10-17T12:15:00-04:00",
 "workPresented":{"@type":"Movie","name":"Harbor Lights"}},
{"@type":"ScreeningEvent","name":"QUIET LAKE at Essex Cinemas","startDate":"2026-10-18T19:00:00-04:00"}
]}</script><script type="application/ld+json">not json</script>"""


def web_for(pages, fail=()):
    asked = []

    def opener(url):
        asked.append(url)
        if any(f in url for f in fail):
            raise OSError("down")
        for key, body in pages.items():
            if key in url:
                return body
        raise OSError("no page for " + url)
    w = bs.Web(opener, pause=0)
    w.asked = asked
    return w


PAGES = {
    "partizanfilm.org": PZ_HOME_CLOSED,
    "veezi.com/sessions/?siteToken=abc123tok": VEEZI_PAGE,
    "theater/nowplaying": None,   # filled per date below
    "majestic10.com/": MJ_HOME_PAGE,
    "essexcinemas.com": ESSEX_PAGE,
}


def all_pages():
    p = dict(PAGES)
    del p["theater/nowplaying"]
    day17 = mj_fragment([("STREET FIGHTER II: THE MOVIE", ["11:00 AM", "1:40 PM", "11:00 AM"]), ("THE LONG WAY HOME", ["7:00 PM"])])
    day18 = mj_fragment([("THE LONG WAY HOME", ["12:00 PM"])])
    return {"date=10%2F17%2F2026": day17, "date=10%2F18%2F2026": day18, **p}


class Parsers(unittest.TestCase):
    def test_clock(self):
        self.assertEqual([bs.clock(x) for x in ["1:55 PM", "11:59 pm", "12:05 PM", "12:30 AM", "9:05AM", "25:00 PM", "soon"]],
                         ["13:55", "23:59", "12:05", "00:30", "09:05", None, None])

    def test_title_case_only_touches_all_caps(self):
        self.assertEqual(bs.title_case("STREET FIGHTER II: THE MOVIE"), "Street Fighter II: The Movie")
        self.assertEqual(bs.title_case("THE LORD OF THE RINGS"), "The Lord of the Rings")
        self.assertEqual(bs.title_case("mother!"), "mother!")
        self.assertEqual(bs.title_case("Sense and Sensibility"), "Sense and Sensibility")

    def test_partizanfilm_closed_and_back_on_the_30th(self):
        self.assertEqual(bs.pz_closed(PZ_HOME_CLOSED, TODAY), (True, "2026-10-30"))
        self.assertEqual(bs.pz_closed("<p>Now showing</p>", TODAY), (False, ""))
        self.assertEqual(bs.pz_closed("<p>We are temporarily closed.</p>", TODAY), (True, ""))
        self.assertEqual(bs.pz_token(PZ_HOME_CLOSED), "abc123tok")

    def test_veezi_by_date_only_with_the_year_worked_out(self):
        got = bs.veezi(VEEZI_PAGE, TODAY)
        self.assertEqual(got, {"2026-10-30": [("Lantern Season", "13:55"), ("Lantern Season", "23:59"), ("Small Hours & Co.", "12:05")],
                               "2027-01-02": [("New Year Film", "19:00")]})

    def test_majestic_dates_skip_disabled_days(self):
        self.assertEqual(bs.mj_dates(MJ_HOME_PAGE), ["10/17/2026", "10/18/2026"])
        got = bs.mj_day(mj_fragment([("CRAWLERS", ["4:45 PM"])]))
        self.assertEqual(got, [("Crawlers", "16:45")])

    def test_essex_json_ld(self):
        self.assertEqual(bs.essex(ESSEX_PAGE), {"2026-10-17": [("Harbor Lights", "20:45"), ("Harbor Lights", "12:15")],
                                                "2026-10-18": [("Quiet Lake", "19:00")]})


class Run(unittest.TestCase):
    def go(self, web, api=None, days=7):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "s.json")
            code = bs.run(argparse.Namespace(out=out, days=days), web, api, NOW)
            doc = json.load(open(out, encoding="utf-8")) if os.path.exists(out) else None
        return code, doc

    def test_a_whole_run(self):
        code, doc = self.go(web_for(all_pages()), days=7)
        self.assertEqual(code, 0)
        self.assertEqual(doc["days"][0], "2026-10-17")
        self.assertEqual(len(doc["days"]), 7)
        th = {t["id"]: t for t in doc["theaters"]}
        self.assertEqual([t["id"] for t in doc["theaters"]], ["partizanfilm", "majestic10", "essex"])
        # closed for the fortnight: its first day back is kept, past the window
        self.assertEqual((th["partizanfilm"]["closed"], th["partizanfilm"]["back"]), (True, "2026-10-30"))
        self.assertEqual(list(th["partizanfilm"]["days"]), ["2026-10-30"])
        self.assertEqual(th["partizanfilm"]["days"]["2026-10-30"][0], {"t": "Small Hours & Co.", "times": ["12:05"]})
        self.assertEqual(th["majestic10"]["days"]["2026-10-17"],
                         [{"t": "Street Fighter II: The Movie", "times": ["11:00", "13:40"]}, {"t": "The Long Way Home", "times": ["19:00"]}])
        self.assertEqual(list(th["majestic10"]["days"]), ["2026-10-17", "2026-10-18"])
        self.assertEqual(th["essex"]["days"]["2026-10-17"], [{"t": "Harbor Lights", "times": ["12:15", "20:45"]}])
        self.assertTrue(all(t["ok"] for t in doc["theaters"]))
        for t in doc["theaters"]:
            self.assertEqual(set(t), {"id", "name", "town", "url", "ok", "closed", "back", "days"})
            self.assertTrue(t["url"].startswith("https://"))

    def test_one_theater_down_is_marked_and_the_rest_ship(self):
        code, doc = self.go(web_for(all_pages(), fail=("essexcinemas.com",)))
        self.assertEqual(code, 0)
        th = {t["id"]: t for t in doc["theaters"]}
        self.assertEqual((th["essex"]["ok"], th["essex"]["days"]), (False, {}))
        self.assertTrue(th["majestic10"]["ok"])

    def test_a_page_that_changed_shape_is_a_failure_not_an_empty_schedule(self):
        pages = all_pages()
        pages["essexcinemas.com"] = "<html><div id='app'></div></html>"           # a JavaScript shell
        pages["majestic10.com/"] = "<html>Coming soon: a new website</html>"     # no date bar
        pages["veezi.com/sessions/?siteToken=abc123tok"] = "<html>Maintenance</html>"
        code, doc = self.go(web_for(pages))
        self.assertEqual(code, 1)                                                # nothing left to publish
        self.assertIsNone(doc)
        pages = all_pages()
        pages["date=10%2F18%2F2026"] = "<html>error</html>"
        code, doc = self.go(web_for(pages))
        th = {t["id"]: t for t in doc["theaters"]}
        self.assertEqual((th["majestic10"]["ok"], th["majestic10"]["days"]), (False, {}))
        self.assertTrue(th["essex"]["ok"])

    def go_with(self, web, prev=None, relay=None, days=7):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "s.json")
            pp = rp = None
            if prev is not None:
                pp = os.path.join(d, "prev.json")
                with open(pp, "w", encoding="utf-8") as fh:
                    json.dump(prev, fh)
            if relay is not None:
                rp = os.path.join(d, "essex.json")
                with open(rp, "w", encoding="utf-8") as fh:
                    fh.write(relay if isinstance(relay, str) else json.dumps(relay))
            code = bs.run(argparse.Namespace(out=out, days=days, prev=pp, essex_json=rp), web, None, NOW)
            doc = json.load(open(out, encoding="utf-8")) if os.path.exists(out) else None
        return code, doc

    def test_essex_turned_away_uses_the_macs_read(self):
        # 2026-10-17 on: Essex's firewall answers GitHub's runners 405; the Mac reads it
        relay = {"v": 1, "read": "2026-10-17T10:30:00Z", "days": {
            "2026-10-16": [["Yesterday's Film", "19:00"]],                    # past: dropped
            "2026-10-17": [["HARBOR LIGHTS", "20:45"], ["Harbor Lights", "12:15"], ["Bad", "25:00"], ["<b>x</b>"]],
            "not-a-day": [["Nope", "10:00"]]}}
        code, doc = self.go_with(web_for(all_pages(), fail=("essexcinemas.com",)), relay=relay)
        th = {t["id"]: t for t in doc["theaters"]}
        self.assertTrue(th["essex"]["ok"])
        self.assertEqual(th["essex"]["days"], {"2026-10-17": [{"t": "Harbor Lights", "times": ["12:15", "20:45"]}]})
        self.assertEqual((th["essex"]["read"], th["essex"]["via"]), ("2026-10-17T10:30:00Z", "mac"))
        self.assertNotIn("carried", th["essex"])

    def test_a_relay_in_the_wrong_shape_is_ignored(self):
        for bad in ("not json", {"v": 2, "read": "2026-10-17T10:30:00Z", "days": {}}, {"v": 1, "read": "today", "days": {"2026-10-17": [["A", "10:00"]]}},
                    {"v": 1, "read": "2026-10-17T10:30:00Z", "days": []}, {"v": True, "read": "2026-10-17T10:30:00Z", "days": {"2026-10-17": [["A", "10:00"]]}},
                    {"v": 1, "read": "2026-99-99T99:99:99Z", "days": {"2026-10-17": [["A", "10:00"]]}},
                    {"v": 1, "read": "2026-10-10T10:30:00Z", "days": {"2026-10-17": [["A", "10:00"]]}},      # a week old
                    {"v": 1, "read": "2026-10-17T10:30:00Z", "days": {"2026-99-99": [["A", "10:00"]], "2027-01-30": [["Far", "10:00"]]}}):
            code, doc = self.go_with(web_for(all_pages(), fail=("essexcinemas.com",)), relay=bad)
            th = {t["id"]: t for t in doc["theaters"]}
            self.assertEqual((th["essex"]["ok"], th["essex"]["days"]), (False, {}), bad)

    def test_the_page_wins_over_the_relay(self):
        relay = {"v": 1, "read": "2026-10-17T10:30:00Z", "days": {"2026-10-17": [["Other", "10:00"]]}}
        code, doc = self.go_with(web_for(all_pages()), relay=relay)
        th = {t["id"]: t for t in doc["theaters"]}
        self.assertEqual(th["essex"]["days"]["2026-10-17"], [{"t": "Harbor Lights", "times": ["12:15", "20:45"]}])
        self.assertNotIn("read", th["essex"])

    def test_a_failed_theater_keeps_its_days_still_ahead(self):
        prev = {"v": 1, "built": "2026-10-16T13:00:00Z", "theaters": [
            {"id": "essex", "ok": True, "days": {"2026-10-16": [{"t": "Gone", "times": ["19:00"]}],
                                                 "2026-99-99": [{"t": "Not a day", "times": ["19:00"]}],
                                                 "2026-10-18": [{"t": "Quiet Lake", "id": 7, "times": ["19:00", "99:00"], "x": "<b>"}, {"t": 5, "times": "19:00"}]}},
            {"id": "majestic10", "ok": False, "days": {"2026-10-18": [{"t": "Not trusted", "times": ["19:00"]}]}}]}
        pages = all_pages()
        pages["majestic10.com/"] = "<html>Coming soon</html>"
        code, doc = self.go_with(web_for(pages, fail=("essexcinemas.com",)), prev=prev)
        th = {t["id"]: t for t in doc["theaters"]}
        self.assertEqual((th["essex"]["ok"], th["essex"]["days"], th["essex"]["read"], th["essex"]["carried"]),
                         (True, {"2026-10-18": [{"t": "Quiet Lake", "id": 7, "times": ["19:00"]}]}, "2026-10-16T13:00:00Z", True))
        self.assertEqual((th["majestic10"]["ok"], th["majestic10"]["days"]), (False, {}))   # a row that was itself failing is not carried

    def test_every_theater_down_writes_nothing(self):
        code, doc = self.go(web_for({}, fail=("http",)))
        self.assertEqual(code, 1)
        self.assertIsNone(doc)

    def test_titles_match_tmdb_exactly_newest_first(self):
        def opener(url, headers):
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))
            return {"results": {
                "Harbor Lights": [{"id": 1, "title": "Harbor Lights", "release_date": "1990-01-01", "popularity": 90, "poster_path": "/old.jpg"},
                                  {"id": 2, "title": "Harbor Lights", "release_date": "2026-10-01", "popularity": 5, "poster_path": "/new.jpg"}],
                "Quiet Lake": [{"id": 3, "title": "Quiet Lake Two", "release_date": "2026-01-01"}],
            }.get(q.get("query"), [])}
        api = Tmdb("0123456789abcdef0123456789abcdef", opener)
        code, doc = self.go(web_for(all_pages()), api)
        essex = {t["id"]: t for t in doc["theaters"]}["essex"]["days"]
        self.assertEqual(essex["2026-10-17"][0], {"t": "Harbor Lights", "times": ["12:15", "20:45"], "id": 2, "p": "/new.jpg"})
        self.assertEqual(essex["2026-10-18"][0], {"t": "Quiet Lake", "times": ["19:00"]})


if __name__ == "__main__":
    unittest.main()
