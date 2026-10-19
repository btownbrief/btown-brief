"""gather_onair_finds.py: each source's page in the shape it really had on
2026-10-19 (Stephen's Inoreader tag, 13GB's cards, a Clipsboard board, Short
of the Week's feed and film page), the quality bar, the length buckets, the
caps, and a whole run that carries yesterday's file forward without asking
any source twice.

The pages are trimmed copies written for this test; nothing here touches
the network.

Run: python3 -m unittest tests.test_gather_onair_finds
"""

import argparse
import json
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import gather_onair_finds as g  # noqa: E402

TAG = """<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>Curated Youtube</title>
<item><title>Inside The Country Where It&#039;s Illegal To Be Ugly</title>
<link>https://shahniva.com/video/inside-the-country-where-its-illegal-to-be-ugly-xk8RLMwWHak</link>
<description><![CDATA[<div><p>x</p></div>]]></description>
<enclosure url="https://i.ytimg.com/vi/xk8RLMwWHak/hqdefault.jpg" type="image/jpg" length="1"/>
<source url="https://shahniva.com/">Shahniva</source></item>
<item><title>Stopping freezing water from expanding?</title>
<link>https://www.wimp.com/stopping-freezing-water-from-expanding-2/</link>
<description><![CDATA[<p><iframe src="https://www.youtube.com/embed/_bcfxty39Cw"></iframe></p>]]></description>
<source url="https://www.wimp.com/">Wimp.com</source></item>
<item><title>Sigur Rós, at home: the Heima tour</title>
<link>https://clipsboard.com/grid/sigur-ros-heima</link>
<description><![CDATA[<img src="https://i.ytimg.com/vi/N79l3x_ZtLY/mqdefault.jpg">]]></description>
<source url="https://clipsboard.com/">https://clipsboard.com/</source></item>
<item><title>Joker: Folie à Deux</title><link>https://uncrate.com/video/joker-folie-a-deux/</link>
<description><![CDATA[x]]></description><source url="https://uncrate.com/tv/">Uncrate</source></item>
<item><title>Street Fighter Gets the ’90s Anime Touch | 13GB</title><link>https://13gb.com/street-fighter</link>
<description><![CDATA[x]]></description><source url="https://13gb.com/">13GB</source></item>
</channel></rss>"""

GB_HOME = """
<div class="video-card" data-batch="3" data-upload-date="2026-08-26" data-duration="2:43" data-subcategory="short films">
  <a class="card-link" href="/the-kill-2">
    <div class="thumb-wrap"><img src="/assets/thumbnails/the-kill-2.jpg" alt=""></div>
    <div class="card-body">
      <h2>The Kill 2</h2>
      <p class="excerpt">Two friends succumb to scrolling fever.</p>
    </div>
  </a>
</div>
<div class="video-card" data-batch="0" data-upload-date="2026-10-09" data-duration="0:43" data-subcategory="commercials">
  <a class="card-link" href="/liquid-death">
    <div class="card-body"><h2>Liquid Death Goes Fang First</h2><p class="excerpt">Vampires.</p></div>
  </a>
</div>
<div class="video-card" data-batch="0" data-upload-date="2026-10-01" data-duration="1:12" data-subcategory="trailers">
  <a class="card-link" href="/werwulf-movie-trailer">
    <div class="card-body"><h2>Werwulf</h2></div>
  </a>
</div>
<div class="video-card" data-batch="0" data-upload-date="2026-09-01" data-duration="26.49" data-subcategory="">
  <a class="card-link" href="/too-short">
    <div class="card-body"><h2>Too short</h2></div>
  </a>
</div>
"""

BOARD = ('<html><head><meta property="og:title" content="Sigur Rós, at home: the Heima tour — Clipsboard"></head>'
         '<script>self.__next_f.push([1,"{\\"category\\":\\"music\\",'
         + ",".join('\\"videoId\\":\\"' + vid + '\\",\\"start\\":0,\\"end\\":null'
                    for vid in ["Hq8tVny15rk", "dtTJBEi3RIM", "bi2Y7Qb-fg0", "Hq8tVny15rk"])
         + '}"])</script></html>')

SOTW_FEED = """<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Flock</title><link>https://www.shortoftheweek.com/2026/10/15/flock/</link></item>
<item><title>Shorts Weekly Has Moved</title><link>https://www.shortoftheweek.com/news/moved/</link></item>
</channel></rss>"""

SOTW_PAGE = ('{"filmmaker":"Mac Nixon","duration":"20","genre":{"slug":"horror"},'
             '"play_link":"https:\\/\\/www.youtube.com\\/embed\\/rwkzBitVEJY?si=x","post_excerpt":"When the sheep vanish, a Shepherd is blamed."}')


def detail(title, sec, **kw):
    out = {"t": title, "ch": kw.get("ch", "A Channel"), "cid": "c", "sec": sec, "live": kw.get("live", False),
           "ok": kw.get("ok", True), "kids": kw.get("kids", False), "pub": ""}
    return out


class Parsers(unittest.TestCase):
    def test_tag(self):
        found, boards = g.parse_tag(TAG)
        self.assertEqual([(f["via"], f["id"]) for f in found], [("shahniva", "xk8RLMwWHak"), ("wimp", "_bcfxty39Cw")])
        self.assertEqual(boards, ["sigur-ros-heima"])   # a board is a playlist, not a find

    def test_13gb_home(self):
        cards = g.parse_13gb_home(GB_HOME)
        self.assertEqual([c["slug"] for c in cards], ["the-kill-2", "liquid-death", "werwulf-movie-trailer", "too-short"])
        self.assertEqual(cards[0]["sec"], 163)
        self.assertEqual(cards[3]["sec"], 26)
        # a page read only where a video could pass: no ads, no under-two-minutes unless a trailer
        self.assertEqual([g.worth_13gb(c) for c in cards], [True, False, True, False])

    def test_board(self):
        b = g.parse_board(BOARD, "sigur-ros-heima")
        self.assertEqual(b["t"], "Sigur Rós, at home: the Heima tour")
        self.assertEqual(b["cat"], "music")
        self.assertEqual(b["ids"], ["Hq8tVny15rk", "dtTJBEi3RIM", "bi2Y7Qb-fg0"])

    def test_sotw(self):
        self.assertEqual([f["slug"] for f in g.parse_sotw_feed(SOTW_FEED)], ["2026/10/15/flock"])
        info = g.parse_sotw_page(SOTW_PAGE)
        self.assertEqual((info["min"], info["id"], info["vimeo"]), (20, "rwkzBitVEJY", None))
        self.assertIn("Shepherd", info["why"])

    def test_clock(self):
        self.assertEqual(g.clock_seconds("2:43"), 163)
        self.assertEqual(g.clock_seconds("1:02:03"), 3723)
        self.assertIsNone(g.clock_seconds(""))


class Bar(unittest.TestCase):
    def cand(self, **kw):
        return dict({"via": "wimp", "id": "abcdefghijk", "url": "https://www.wimp.com/x/"}, **kw)

    def test_buckets(self):
        self.assertEqual(g.bucket(8 * 60, False), "snack")
        self.assertEqual(g.bucket(15 * 60, False), "commute")
        self.assertEqual(g.bucket(29 * 60, False), "commute")
        self.assertEqual(g.bucket(30 * 60, False), "sit")
        self.assertEqual(g.bucket(70, True), "trailer")

    def test_topic_is_the_curators_own_category(self):
        self.assertEqual(g.topic_of({"via": "13gb", "cat": "Satirical Content"}), "comedy")
        self.assertEqual(g.topic_of({"via": "13gb", "cat": "short films"}), "film")
        self.assertEqual(g.topic_of({"via": "13gb", "cat": ""}), "")
        self.assertEqual(g.topic_of({"via": "sotw"}), "film")
        self.assertEqual(g.topic_of({"via": "wimp", "cat": "music"}), "")
        ok, _ = g.gate(self.cand(via="13gb", cat="music"), detail("A song, live", 300))
        self.assertEqual(ok["topic"], "music")
        ok, _ = g.gate(self.cand(), detail("How a pencil is made", 600))
        self.assertNotIn("topic", ok)

    def test_gate(self):
        ok, why = g.gate(self.cand(), detail("How a pencil is made", 600))
        self.assertEqual((ok["b"], ok["dur"], why), ("snack", "10:00", None))
        cases = [
            (detail("Short thing", 95), "under two minutes"),
            (detail("A thing #shorts", 50), "short"),
            (detail("Pretty Privilege Is KILLING Cinema...", 900), "clickbait"),
            (detail("You won't believe this bridge", 900), "clickbait"),
            (detail("Fine title", 900, ok=False), "not embeddable"),
            (detail("Fine title", 900, live=True), "live"),
            (detail("Fine title", 900, kids=True), "for kids"),
            (detail("サインペンを大量生産するプロセス", 900), "not in English"),
            (None, "gone"),
        ]
        for d, reason in cases:
            self.assertEqual(g.gate(self.cand(), d), (None, reason), reason)
        trailer, _ = g.gate(self.cand(), detail("Night Train | Official Trailer", 80))
        self.assertEqual(trailer["b"], "trailer")   # the one place under two minutes is allowed
        self.assertEqual(g.gate(self.cand(), detail("A sting trailer", 12)), (None, "short"))

    def test_names_are_not_shouting(self):
        for t in ["NASA explains Mars", "I Thought I Was Lazy | Lindsay Scola | TED", "How This Chair Proves We're In A Recession | FIXATED",
                  "BLACKPINK at Coachella"]:
            self.assertFalse(g.clickbait(t), t)

    def test_caps(self):
        items = [{"via": "shahniva", "ch": "c%d" % (i % 5)} for i in range(14)] + [{"via": "wimp", "ch": "w"}]
        capped = g.cap_curators(items)
        self.assertEqual(sum(1 for i in capped if i["via"] == "shahniva"), g.PER_CURATOR_RUN)
        self.assertEqual(len(g.cap_channels(capped)), 2 * 5 + 1)   # three a channel, at most


class Run(unittest.TestCase):
    """A whole run against canned pages: what is fetched, what is kept, and
    that a second run asks nothing it already asked."""

    def pages(self):
        return {
            g.TAG_URL: TAG, g.GB_HOME: GB_HOME, g.GB_HOME + "the-kill-2": '<iframe src="https://www.youtube.com/embed/K1ll2K1ll2K"></iframe>',
            g.GB_HOME + "werwulf-movie-trailer": '<iframe src="https://www.youtube.com/embed/WerwulfTr01"></iframe>',
            "https://clipsboard.com/grid/sigur-ros-heima": BOARD, g.SOTW_FEED: SOTW_FEED,
            "https://www.shortoftheweek.com/2026/10/15/flock/": SOTW_PAGE,
        }

    def details(self):
        return {
            "xk8RLMwWHak": detail("Inside the country where looks are law", 25 * 60, ch="josie"),
            "_bcfxty39Cw": detail("Freezing water expands. What if you don't let it?", 194, ch="minutephysics"),
            "K1ll2K1ll2K": detail("The Kill 2", 163, ch="Short Films"),
            "WerwulfTr01": detail("Werwulf | Official Trailer", 72, ch="Focus"),
            "rwkzBitVEJY": detail("Flock", 20 * 60, ch="Mac Nixon"),
            "Hq8tVny15rk": detail("Sigur Rós - Glósóli", 380, ch="Sigur Rós"),
            "dtTJBEi3RIM": detail("Sigur Rós - Vaka", 300, ch="Sigur Rós"),
            "bi2Y7Qb-fg0": detail("Sigur Rós - Ágætis byrjun", 410, ch="Sigur Rós"),
        }

    def go(self, out, asked, prev_checked=None):
        pages = self.pages()

        def fetch(url, **kw):
            asked.append(url)
            if url in pages:
                return pages[url]
            raise OSError("not canned: " + url)

        def fetch_json(url, **kw):
            asked.append(url)
            if url.startswith(g.BITETUBE_QUERY):
                return {"result": [{"_id": "u1", "title": "A realistic weekend", "youtubeId": "jMlU733SW3g", "whyWatch": "Grounded."}]}
            raise OSError("not canned: " + url)

        details = dict(self.details(), jMlU733SW3g=detail("A realistic weekend of a single woman living in China", 13 * 60, ch="Ch"))
        with mock.patch.object(g, "fetch", fetch), mock.patch.object(g, "fetch_json", fetch_json), \
                mock.patch.object(g, "youtube_auth", lambda: ({"key": "k"}, {})), \
                mock.patch.object(g, "youtube_details", lambda ids, auth: (asked.append("youtube:" + ",".join(sorted(ids))), {i: details[i] for i in ids if i in details})[1]), \
                redirect_stdout():
            return g.run(argparse.Namespace(out=out, pages=4, dry_run=False))

    def test_run_and_carry_forward(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "finds.json")
            asked = []
            p = self.go(out, asked)
            got = {it["id"]: (it["b"], it["via"]) for it in p["items"]}
            self.assertEqual(got, {
                "xk8RLMwWHak": ("commute", "shahniva"), "_bcfxty39Cw": ("snack", "wimp"), "K1ll2K1ll2K": ("snack", "13gb"),
                "WerwulfTr01": ("trailer", "13gb"), "rwkzBitVEJY": ("commute", "sotw"), "jMlU733SW3g": ("snack", "bitetube")})
            self.assertTrue(all(it["via_url"].startswith("https://") for it in p["items"]))
            self.assertEqual([(b["slug"], len(b["clips"])) for b in p["boards"]], [("sigur-ros-heima", 3)])
            self.assertNotIn(g.GB_HOME + "liquid-death", asked)   # an ad is never opened
            self.assertNotIn("https://www.shortoftheweek.com/news/moved/", asked)
            with open(out, encoding="utf-8") as fh:
                self.assertEqual(len(json.load(fh)["items"]), 6)

            again = []
            p2 = self.go(out, again)
            self.assertEqual(len(p2["items"]), 6)
            pages_again = [u for u in again if u not in (g.TAG_URL, g.GB_HOME, g.SOTW_FEED)]
            self.assertEqual(pages_again, [])   # nothing asked twice, not even YouTube; BiteTube waits a week
            self.assertEqual(sum(1 for u in asked if u.startswith("youtube:")), 1)
            self.assertEqual(len(p2["boards"]), 1)

    def test_a_failed_or_broken_page_fails_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "finds.json")
            pages = self.pages()
            pages.pop(g.GB_HOME + "the-kill-2")                     # a 503 today
            pages["https://www.shortoftheweek.com/2026/10/15/flock/"] = '{"duration":"20","post_excerpt":"\\x"}'   # bad escape: the parser raises

            def fetch(url, **kw):
                if url in pages:
                    return pages[url]
                raise OSError("503")
            with mock.patch.object(g, "fetch", fetch), mock.patch.object(g, "fetch_json", lambda url, **kw: {"result": []}), \
                    mock.patch.object(g, "youtube_auth", lambda: ({"key": "k"}, {})), \
                    mock.patch.object(g, "youtube_details", lambda ids, auth: {i: d for i, d in self.details().items() if i in ids}), redirect_stdout():
                p = g.run(argparse.Namespace(out=out, pages=4, dry_run=False))
            ids = [it["id"] for it in p["items"]]
            self.assertIn("xk8RLMwWHak", ids)                      # the other sources still land
            self.assertNotIn("13gb:the-kill-2", p["seen"])          # tried again tomorrow
            self.assertNotIn("sotw:2026/10/15/flock", p["seen"])
            self.assertIn("13gb:werwulf-movie-trailer", p["seen"])

    def test_old_finds_age_out(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "finds.json")
            old = {"items": [{"id": "OldOldOld01", "t": "Old", "b": "snack", "via": "wimp", "d": int(time.time()) - 60 * 86400}],
                   "seen": {"yt:OldOldOld01": int(time.time()) - 60 * 86400}}
            with open(out, "w", encoding="utf-8") as fh:
                json.dump(old, fh)
            p = self.go(out, [])
            self.assertNotIn("OldOldOld01", [it["id"] for it in p["items"]])

    def test_youtube_down_keeps_candidates_for_tomorrow(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "finds.json")
            prev = {"items": [{"id": "KeepMe00001", "t": "Kept", "b": "snack", "via": "wimp", "d": int(time.time())}]}
            with open(out, "w", encoding="utf-8") as fh:
                json.dump(prev, fh)
            down = lambda ids, auth: (_ for _ in ()).throw(OSError("quota"))  # noqa: E731
            with mock.patch.object(g, "fetch", lambda url, **kw: self.pages().get(url, "")), \
                    mock.patch.object(g, "fetch_json", lambda url, **kw: {"result": []}), \
                    mock.patch.object(g, "youtube_auth", lambda: ({"key": "k"}, {})), \
                    mock.patch.object(g, "youtube_details", down), redirect_stdout():
                p = g.run(argparse.Namespace(out=out, pages=4, dry_run=False))
            self.assertIn("K1ll2K1ll2K", [c["id"] for c in p["pending"]])   # 13GB's page is not read again
            asked = []
            p2 = self.go(out, asked)
            self.assertIn("K1ll2K1ll2K", [it["id"] for it in p2["items"]])
            self.assertNotIn(g.GB_HOME + "the-kill-2", asked)
            self.assertEqual(p2["pending"], [])

    def test_no_credentials_adds_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "finds.json")
            with mock.patch.object(g, "fetch", lambda url, **kw: self.pages().get(url, "")), \
                    mock.patch.object(g, "fetch_json", lambda url, **kw: {"result": []}), \
                    mock.patch.object(g, "youtube_auth", lambda: (None, None)), redirect_stdout():
                p = g.run(argparse.Namespace(out=out, pages=4, dry_run=False))
            self.assertEqual(p["items"], [])
            self.assertFalse(os.path.exists(out))   # nothing to write: the last good file stays


class redirect_stdout:
    def __enter__(self):
        self.old = sys.stdout
        sys.stdout = open(os.devnull, "w")

    def __exit__(self, *a):
        sys.stdout.close()
        sys.stdout = self.old


if __name__ == "__main__":
    unittest.main()
