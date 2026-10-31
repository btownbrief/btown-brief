"""The Wire's mix (Stephen, 2026-10-30): newsletters as readable editions, a
lane for national culture and science, and politics held down at the top of
the paper. Offline; the model is never called.

Run: python3 -m unittest discover -s tests -p 'test_wire*.py'
"""

import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import curate_wire as cw  # noqa: E402
import refresh_pulse as rp  # noqa: E402
import tag_wire as tw  # noqa: E402
import wire_common as wc  # noqa: E402

NOW = datetime(2026, 10, 16, 18, 10, tzinfo=timezone.utc)
NOW_TS = int(NOW.timestamp())
ET = wc.et_now(NOW)


def story(n, topic=None, local=False, ch=None, src=None, score=5):
    out = {"id": f"i{n}", "ch": ch or ("local" if local else "world"), "local": local,
           "src": src or f"s{n}", "name": f"S{n}", "title": f"Headline {n}",
           "url": f"https://x.example/{n}", "posted_at": NOW.isoformat(),
           "d": NOW_TS - n, "_score": score}
    if topic:
        out["topic"] = topic
    return out


def day_with(items):
    day = cw.empty_day("2026-10-16")
    if items:
        day["updates"] = [{"key": "morning", "label": "Morning", "time": "9:00 am",
                           "lead": None, "items": list(items)}]
    return day


def email(body, title="Today's edition", link="https://mailchi.mp/sevendaysvt/today"):
    item = ('<item><title><![CDATA[%s]]></title><link>https://www.inoreader.com/x</link>'
            '<pubDate>Fri, 16 Oct 2026 12:00:00 GMT</pubDate>'
            '<source url="https://www.inoreader.com/feed/x">7Days</source>'
            '<description><![CDATA[<a href="%s">View in browser</a>%s]]></description></item>')
    return ('<rss><channel>' + item % (title, link, body) + '</channel></rss>').encode()


HIDDEN = '<span style="display: none; font-size: 0px">%s</span><p>The whole body of the email.</p>'


class PreheaderTests(unittest.TestCase):
    def parsed(self, body, **kw):
        return rp.parse_stream(email(body, **kw))[0]

    def test_the_hidden_preheader_is_the_line_and_the_body_never_is(self):
        got = self.parsed(HIDDEN % "As of 9 a.m., 139,566 voters had turned in ballots.")
        self.assertEqual(got["line"], "As of 9 a.m., 139,566 voters had turned in ballots.")
        self.assertNotIn("whole body", str(got))

    def test_filler_and_a_pixel_block_are_passed_over(self):
        pixel = '<div style="display: none"><img src="https://t.example/p.gif"></div>'
        filler = " ‌" * 40
        got = self.parsed(pixel + HIDDEN % ("Plus, the lake froze early. " + filler))
        self.assertEqual(got["line"], "Plus, the lake froze early.")

    def test_a_table_cell_preheader(self):
        got = self.parsed('<table style="display: none"><tbody><tr><td>Plus, Big Oil gets gritty.'
                          '</td></tr></tbody></table>')
        self.assertEqual(got["line"], "Plus, Big Oil gets gritty.")

    def test_no_hidden_block_means_no_line(self):
        self.assertNotIn("line", self.parsed("<h3>Good morning!</h3><p>Weather today.</p>"))

    def test_clamped_at_a_word(self):
        line = rp.preheader(HIDDEN % ("word " * 60), "A title")
        self.assertLessEqual(len(line), wc.LINE_MAX)
        self.assertTrue(line.endswith("word…"), line)

    def test_a_line_the_sender_cut_mid_word_ends_on_a_whole_word(self):
        cut = "France, the US, and Brazil all face debt challenges, China's Communists expand their purge, and an i"
        self.assertTrue(wc.clean_line(cut).endswith("and an…"))

    def test_a_line_the_sender_cut_at_a_comma_ends_on_an_ellipsis(self):
        cut = "Brazil's markets tumble after Lula's win, the Fed holds steady, and Xi kicks-off China plenum,"
        self.assertEqual(wc.clean_line(cut), cut[:-1] + "…")
        self.assertEqual(wc.clean_line("A short one cut here:"), "A short one cut here…")
        self.assertEqual(wc.clean_line("A line that ends well."), "A line that ends well.")

    def test_the_posts_opening_is_never_the_line(self):
        opening = "Another precinct has been heard from. The national pollster has come out with its final poll on"
        body = ('<span style="display: none">' + opening + '…</span><h1>The VPO</h1>'
                '<p>' + opening.replace("national", "<b>national</b>") + ' the race for governor, and it runs on.</p>')
        self.assertEqual(rp.preheader(body), "")
        self.assertNotIn("line", self.parsed(body))

    def test_an_opening_that_runs_across_blocks_is_not_a_line_either(self):
        body = ('<span style="display: none">Catch up on the latest stories. Liz Sauchelli Community Editor</span>'
                '<p>Catch up on the latest stories.</p><p>Liz Sauchelli</p><p>Community Editor</p>')
        self.assertEqual(rp.preheader(body), "")

    def test_a_wordpress_email_keeps_no_line_even_when_its_opening_stands_alone(self):
        link = '<a href="https://public-api.wordpress.com/bar/?redirect_to=http%3A%2F%2Fthevpo.org%2F2026%2F10%2F17%2Fa-post%2F">Read on blog</a>'
        line = "A one-sentence post that is whole in the preheader."
        got = rp.parse_stream(email(link + HIDDEN % line + "<p>" + line + "</p>"))[0]
        self.assertTrue(rp.preheader(HIDDEN % line + "<p>" + line + "</p>"))
        self.assertNotIn("line", got)

    def test_a_dek_repeated_in_the_body_stays_the_line(self):
        for dek, block in (("State, federal and private data find few big corporate home buyers in Vermont.", "h3"),
                           ("Your participation has tangible and intangible effects.", "p")):
            got = self.parsed(HIDDEN % dek + "<%s style='margin: 0'> %s </%s>" % (block, dek, block))
            self.assertEqual(got["line"], dek)

    def test_a_long_dek_repeated_in_the_body_is_cut_and_stays(self):
        dek = "word " * 60
        line = rp.preheader(HIDDEN % dek + "<h3>" + dek + "</h3>")
        self.assertTrue(line.endswith("word…"), line)

    def test_a_line_naming_him_or_an_address_is_refused(self):
        for bad in ("Stephen, here is your morning briefing", "Sent to someone@example.com today",
                    "Good morning, stephen davis, and welcome", "View this email in your browser",
                    "Read it at https://example.com/today", "Too short"):
            self.assertEqual(wc.clean_line(bad), "", bad)
            self.assertEqual(rp.preheader(HIDDEN % bad), "", bad)

    def test_a_line_that_is_the_title_says_nothing(self):
        self.assertEqual(wc.clean_line("Bluebird Barbecue to Close!", "Bluebird Barbecue to close"), "")


class StoreTests(unittest.TestCase):
    def edition(self, n, line, when=None):
        return {"title": f"Edition {n}", "url": f"https://www.inoreader.com/{n}",
                "webcopy": f"https://mailchi.mp/x/{n}", "email": True, "line": line,
                "when": datetime.fromtimestamp((when or NOW_TS) - n * 3600, timezone.utc)}

    def test_a_senders_repeated_tagline_leaves_every_edition(self):
        kept, _ = rp.merge_source([], [self.edition(1, "News for the insatiably curious."),
                                       self.edition(2, "News for the insatiably curious."),
                                       self.edition(3, "Plus, a moose on Church Street.")], NOW_TS)
        self.assertEqual([item.get("l") for item in kept], [None, None, "Plus, a moose on Church Street."])

    def test_a_tagline_is_caught_against_the_stored_editions(self):
        held = [{"t": "Old", "u": "https://mailchi.mp/x/old", "d": NOW_TS - 90000, "l": "and more recent news..."}]
        kept, _ = rp.merge_source(held, [self.edition(1, "and more recent news...")], NOW_TS)
        self.assertFalse(any("l" in item for item in kept))

    def test_a_linked_edition_replaces_its_unlinked_row(self):
        held = [{"t": "Edition 1", "u": "https://www.inoreader.com/1", "d": NOW_TS, "x": 1}]
        kept, _ = rp.merge_source(held, [self.edition(1, "Plus, a moose on Church Street.")], NOW_TS)
        self.assertEqual([item["u"] for item in kept], ["https://mailchi.mp/x/1"])

    def test_an_unlinkable_edition_keeps_no_line(self):
        edition = self.edition(1, "Plus, a moose on Church Street.")
        del edition["webcopy"]
        kept, _ = rp.merge_source([], [edition], NOW_TS)
        self.assertEqual((kept[0].get("x"), "l" in kept[0]), (1, False))

    def test_compass_links_lose_his_token(self):
        body = ('<a href="https://open.substack.com/pub/compassvermont/p/a-post?r=abc&amp;token=eyJ'
                + "x" * 80 + '&amp;action=restack-comment">Restack</a>')
        raw = email(body).replace(b'<a href="https://mailchi.mp/sevendaysvt/today">View in browser</a>', b"")
        got = rp.parse_stream(raw)[0]
        self.assertEqual(got["webcopy"], "https://open.substack.com/pub/compassvermont/p/a-post")

    def test_promos_are_plumbing(self):
        for title in ("Our $1 offer turns into a pumpkin soon", "20% off everything",
                      "Saratoga Outdoors Friends & Family Sale: Thursday!", "new template test"):
            self.assertTrue(rp.NEWSLETTER_NOISE_RE.search(title), title)
        self.assertFalse(rp.NEWSLETTER_NOISE_RE.search("Money Stuff: Not Your Keys"))


class WireItemTests(unittest.TestCase):
    def pulse(self, line):
        return {"sources": [{"id": "7days", "name": "7Days", "short": "Seven Days", "topic": "newsletters"}],
                "items": [{"t": "Bluebird to close", "u": "https://mailchi.mp/x/1", "d": NOW_TS - 60,
                           "s": "7days", "l": line}]}

    def test_the_line_reaches_the_item(self):
        got = wc.wire_items(self.pulse("Plus, a moose on Church Street."), NOW_TS, 26)[0]
        self.assertEqual((got["name"], got["line"]), ("Seven Days", "Plus, a moose on Church Street."))
        self.assertIn("line", cw.ITEM_KEYS)

    def test_a_bad_stored_line_stops_here_too(self):
        self.assertNotIn("line", wc.wire_items(self.pulse("Hi Stephen, today's edition"), NOW_TS, 26)[0])

    def test_a_junked_edition_survives_apply_tags(self):
        edition = dict(story(1, ch="newsletters"), title="Daybreak Thursday")
        news = story(2)
        tags = {"i1": {"junk": "noise", "ch": "newsletters", "local": True, "topic": "other", "score": 1},
                "i2": {"junk": "noise", "ch": "world", "local": False, "topic": "other", "score": 1}}
        self.assertEqual([item["id"] for item in cw.apply_tags([edition, news], tags)], ["i1"])

    def test_river_titles_skip_newsletters(self):
        today = {"date": wc.et_now().date().isoformat(), "updates": [{"items": [
            {"id": "a", "title": "State Sen. Arrested", "ch": "newsletters"},
            {"id": "b", "title": "Bridge closes", "ch": "local"}]}]}
        with tempfile.TemporaryDirectory() as folder:
            wc.write_json(os.path.join(folder, "wire-today.json"), today)
            self.assertEqual(tw.river_titles(folder), [("b", "Bridge closes")])


class LightLaneTests(unittest.TestCase):
    def test_a_light_story_clears_a_lower_bar(self):
        pool = [story(1, "science", score=1), story(2, "arts-culture", score=1),
                story(3, "tech", score=1), story(4, "science", score=0)]
        new, auto = cw.select_new(pool, set(), set(), set(), set())
        self.assertEqual({item["id"] for item in new}, {"i1", "i2"})
        self.assertEqual(set(auto), {"i3", "i4"})

    def test_a_local_or_sports_story_is_not_light(self):
        self.assertFalse(cw.is_light(story(1, "arts-culture", local=True)))
        self.assertFalse(cw.is_light(story(2, "sports")))
        self.assertFalse(cw.is_light(story(3, "arts-culture", ch="newsletters")))

    def test_the_top_up_leaves_sports_under_their_cap(self):
        held = [dict(story(n, "sports"), sport="nfl") for n in range(cw.SPORTS_RIVER_MAX)]
        new = [dict(story(100, "media", score=2), sport="nfl"),
               dict(story(101, "arts-culture", score=2), sport="nba")]
        result = cw.apply_answer(day_with(held), {}, held, new, False, ET, NOW)
        self.assertEqual(result["added"], [])

    def test_the_lane_has_its_own_ceiling(self):
        pool = [story(n, "music", score=2) for n in range(cw.NEW_MAX_SOFT + 5)]
        pool += [story(100 + n, "world", score=4) for n in range(3)]
        new, _ = cw.select_new(pool, set(), set(), set(), set())
        self.assertEqual(sum(cw.is_light(item) for item in new), cw.NEW_MAX_SOFT)
        self.assertEqual(sum(item.get("topic") == "world" for item in new), 3)

    def test_the_top_up_takes_the_three_best_the_editor_passed(self):
        new = [story(n, "science", score=n % 5 + 1) for n in range(6)] + [story(10, "world")]
        day = day_with([])
        result = cw.apply_answer(day, {"add": [6]}, [], new, False, ET, NOW)
        self.assertEqual(len(result["added"]), 1 + cw.LIGHT_TOPUP_HOURLY)
        scores = sorted((item["_score"] for item in new if item["id"] in result["added"][1:]), reverse=True)
        self.assertEqual(scores, [5, 4, 3])

    def test_the_top_up_stops_at_the_days_want(self):
        river = [story(n, "music") for n in range(cw.LIGHT_RIVER_WANT - 1)]
        new = [story(100 + n, "science") for n in range(5)]
        result = cw.apply_answer(day_with(river), {}, river, new, False, ET, NOW)
        self.assertEqual(len(result["added"]), 1)
        river = [story(n, "music") for n in range(cw.LIGHT_RIVER_WANT)]
        result = cw.apply_answer(day_with(river), {}, river, new, False, ET, NOW)
        self.assertEqual(result["added"], [])

    def test_an_editors_light_add_counts_toward_the_three(self):
        new = [story(n, "science") for n in range(6)]
        result = cw.apply_answer(day_with([]), {"add": [0]}, [], new, False, ET, NOW)
        self.assertEqual(result["added"][0], "i0")
        self.assertEqual(len(result["added"]), 1 + cw.LIGHT_TOPUP_HOURLY)


class PoliticsCapTests(unittest.TestCase):
    def test_the_river_stops_at_the_cap(self):
        held = [story(n, "national-politics") for n in range(cw.NATIONAL_POLITICS_RIVER_MAX - 2)]
        new = [story(100 + n, "national-politics") for n in range(5)] + [story(200, "world")]
        result = cw.apply_answer(day_with(held), {"add": [len(held) + k for k in range(6)]}, held, new,
                                 False, ET, NOW)
        self.assertEqual(result["added"], ["i100", "i101", "i200"])

    def test_it_counts_national_only(self):
        held = [story(n, "national-politics") for n in range(cw.NATIONAL_POLITICS_RIVER_MAX)]
        new = [story(100, "national-politics", local=True), story(101, "state-politics", local=True),
               story(102, "national-politics")]
        result = cw.apply_answer(day_with(held), {"add": [len(held), len(held) + 1, len(held) + 2]}, held, new,
                                 False, ET, NOW)
        self.assertEqual(result["added"], ["i100", "i101"])

    def test_a_pick_past_the_cap_still_runs(self):
        held = [story(n, "national-politics") for n in range(cw.NATIONAL_POLITICS_RIVER_MAX)]
        new = [story(100, "national-politics"), story(101, "national-politics")]
        answer = {"add": [len(held) + 1], "picks": [{"i": len(held), "why": "The whole country is watching."}]}
        result = cw.apply_answer(day_with(held), answer, held, new, True, ET, NOW)
        self.assertEqual(result["added"], ["i100"])


    def edition(self, n, **fields):
        return dict(story(n, "national-politics", ch="newsletters"), **fields)

    def test_an_edition_past_the_cap_still_runs(self):
        held = [story(n, "national-politics") for n in range(cw.NATIONAL_POLITICS_RIVER_MAX)]
        result = cw.apply_answer(day_with(held), {}, held, [self.edition(100)], False, ET, NOW)
        self.assertEqual(result["added"], ["i100"])

    def test_the_brief_past_the_cap_still_runs(self):
        held = [story(n, "national-politics") for n in range(cw.NATIONAL_POLITICS_RIVER_MAX)]
        result = cw.apply_answer(day_with(held), {}, held, [self.edition(100, own=True)], False, ET, NOW)
        self.assertEqual(result["added"], ["i100"])

    def test_an_edition_uses_up_none_of_the_cap(self):
        held = [story(n, "national-politics") for n in range(cw.NATIONAL_POLITICS_RIVER_MAX - 1)]
        held += [self.edition(50)]
        new = [story(100, "national-politics")]
        result = cw.apply_answer(day_with(held), {"add": [len(held)]}, held, new, False, ET, NOW)
        self.assertEqual(result["added"], ["i100"])


class PickRuleTests(unittest.TestCase):
    def picks(self, topics, **kw):
        return [story(n, topic, src=f"o{n}", **kw) for n, topic in enumerate(topics)]

    def politics(self, ranked, n):
        return sum(pick.get("topic") in cw.PICK_POLITICS for pick in ranked[:n])

    def test_at_most_two_in_five_and_three_in_ten(self):
        topics = ["national-politics"] * 8 + ["world"] * 4 + ["housing"] * 4
        ranked = cw.order_picks(self.picks(topics))
        self.assertEqual((self.politics(ranked, 5), self.politics(ranked, 10)), (2, 3))
        self.assertEqual(len(ranked), len(topics))

    def test_a_list_within_the_limits_is_left_alone(self):
        picks = self.picks(["national-politics", "world", "state-politics", "housing", "arts-culture",
                            "world", "city-government", "economy", "world", "health"])
        self.assertEqual([p["id"] for p in cw.order_picks(picks)], [p["id"] for p in picks])

    def test_the_local_list_gets_its_own_limit(self):
        topics = ["city-government"] * 6 + ["housing", "schools", "business", "courts", "health", "housing", "events"]
        picks = [dict(pick) for pick in self.picks(topics, local=True)]
        for pick in picks:
            pick["region"] = "btv"
        ranked = [pick for pick in cw.order_picks(picks) if pick["local"]]
        self.assertEqual((self.politics(ranked, 5), self.politics(ranked, 10)), (2, 3))

    def test_a_light_story_takes_slot_three_when_the_top_five_has_none(self):
        topics = ["world", "economy", "health", "business", "tech", "world", "world", "science", "world"]
        ranked = cw.order_picks(self.picks(topics))
        self.assertEqual(ranked[cw.PICK_LIGHT_SLOT - 1]["topic"], "science")

    def test_a_top_five_with_a_light_story_keeps_its_order(self):
        topics = ["world", "economy", "health", "business", "music", "world", "science"]
        picks = self.picks(topics)
        self.assertEqual([p["id"] for p in cw.order_picks(picks)], [p["id"] for p in picks])

    def test_no_outlet_twice_in_a_row_and_threads_stay_down(self):
        picks = self.picks(["national-politics"] * 7 + ["world"] * 6)
        for pick in picks[7:]:
            pick["src"] = "ap" if int(pick["id"][1:]) % 2 else "reuters"
        picks[-1].update(ch="reddit", src="r-burlington", local=True, comments=40)
        ranked = cw.order_picks(picks)
        self.assertTrue(all(a["src"] != b["src"] for a, b in zip(ranked, ranked[1:])))
        at = [k for k, pick in enumerate(ranked) if pick["ch"] == "reddit"]
        self.assertTrue(all(k >= wc.THREAD_TOP_RANK - 1 for k in at), at)


if __name__ == "__main__":
    unittest.main()
