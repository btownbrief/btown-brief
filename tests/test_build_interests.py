import json
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
import build_interests as bi
import wire_common as wc

NOW = 1793550000
RSS = """<rss xmlns:media="http://search.yahoo.com/mrss/"><channel>
<item><title>A turtle comes home</title><link>https://a.example/1</link><pubDate>Sun, 01 Nov 2026 10:00:00 GMT</pubDate>
<media:content url="https://a.example/1.jpg" medium="image"/></item>
<item><title>No link here</title><pubDate>Sun, 01 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title>Too old a turtle</title><link>https://a.example/2</link><pubDate>Sun, 01 Mar 2026 10:00:00 GMT</pubDate></item>
<item><title>Senate fights over a turtle</title><link>https://a.example/3</link><pubDate>Sun, 01 Nov 2026 09:00:00 GMT</pubDate></item>
</channel></rss>"""
ATOM = """<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Webb sees a star</title>
<link rel="alternate" href="https://b.example/1"/><published>2026-11-01T09:00:00Z</published>
<summary>&lt;img src="https://b.example/1.png"&gt;</summary></entry></feed>"""


def yes(feed, fresh):
    return {x["u"]: True for x in fresh}


def no(feed, fresh):
    return {x["u"]: False for x in fresh}


def down(feed, fresh):
    raise OSError("model down")


def item(t, u, s="Turtles", ts=NOW - 3600, **rest):
    return {"t": t, "u": u, "s": s, "ts": ts, **rest}


class ParseFeed(unittest.TestCase):
    def test_rss_keeps_title_link_time_and_picture(self):
        got = bi.parse_feed(RSS)
        self.assertEqual(got[0]["t"], "A turtle comes home")
        self.assertEqual(got[0]["i"], "https://a.example/1.jpg")
        self.assertEqual(len(got), 3)

    def test_atom_finds_its_link_and_a_picture_in_the_summary(self):
        got = bi.parse_feed(ATOM)
        self.assertEqual(got[0]["u"], "https://b.example/1")
        self.assertEqual(got[0]["i"], "https://b.example/1.png")

    def test_a_picture_in_html_comes_out_unescaped(self):
        got = bi.parse_feed("""<rss><channel><item><title>A moon in many colors tonight</title><link>https://a.example/1</link>
        <pubDate>Sun, 01 Nov 2026 10:00:00 GMT</pubDate><description><![CDATA[<img src="https://a.example/m.jpg?w=960&#038;h=991">]]></description>
        </item></channel></rss>""")
        self.assertEqual(got[0]["i"], "https://a.example/m.jpg?w=960&h=991")

    def test_a_google_news_item_wears_its_outlet(self):
        got = bi.parse_feed("""<rss><channel><item><title>ATM stolen - then found - in a field - WCAX</title>
        <link>https://news.google.com/rss/articles/abc</link><pubDate>Sun, 01 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>""")
        self.assertEqual((got[0]["t"], got[0]["s"]), ("ATM stolen - then found - in a field", "WCAX"))
        built = bi.build({}, NOW, {"nosy": [("Google News", "u", None)]}, read=lambda url: """<rss><channel><item>
        <title>Man steals a very large ATM - WCAX</title><link>https://news.google.com/rss/articles/abc</link>
        <pubDate>Sun, 01 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>""", ask=yes)
        self.assertEqual(built["nosy"][0]["s"], "WCAX")

    def test_a_feed_s_own_label_comes_off_the_headline(self):
        self.assertEqual(bi.clean("Gates stolen from a cemetery [Weird]"), "Gates stolen from a cemetery")
        self.assertEqual(bi.clean("Look: Mystery sheep leads police on a chase"), "Mystery sheep leads police on a chase")


class Keeps(unittest.TestCase):
    def test_politics_and_the_grim_stay_out_of_good_news(self):
        self.assertFalse(bi.keeps("good", "Governor signs a bill"))
        self.assertFalse(bi.keeps("good", "Man dies at the fair"))
        self.assertTrue(bi.keeps("good", "Kids find a fossil on a field trip"))

    def test_nosy_never_names_a_private_person_or_a_minor(self):
        self.assertFalse(bi.keeps("nosy", "John Smith tries to pay with a chicken"))
        self.assertFalse(bi.keeps("nosy", "16-year-old steals a golf cart"))
        self.assertFalse(bi.keeps("nosy", "Man shot outside a bar"))
        self.assertTrue(bi.keeps("nosy", "Man tries to pay for a burrito with a live chicken"))

    def test_nosy_catches_a_name_any_surname_can_make(self):
        for title in ("Tyrone Washington arrested after stealing a goat",
                      "Deshawn Lopez tries to pay with a chicken",
                      "Burlington's Hernandez stole a golf cart"):
            self.assertFalse(bi.keeps("nosy", title), title)
        for title in ("Burlington Police arrest a man on Church Street", "Florida Man steals an alligator",
                      "South Burlington police clear up a false alarm"):
            self.assertTrue(bi.keeps("nosy", title), title)

    def test_nosy_drops_a_minor_however_the_headline_says_it(self):
        for title in ("9-year-old caught stealing a golf cart", "Boy, 12, caught breaking into a zoo",
                      "Teens steal ATM in Pittsford", "Nine-year-old drives off in a stolen car",
                      "Student arrested after a prank at the mall", "Teenager (15) caught with a stolen goat",
                      "Laxative given out to trick-or-treaters, police warn"):
            self.assertFalse(bi.keeps("nosy", title), title)

    def test_grim_catches_what_the_live_feeds_slipped_past_it(self):
        for title in ("Nantucket school volunteer charged with raping a child", "Rapist caught at gas station",
                      "Deadly crash on I-89", "Man Who Mutilated Self Is Judged Competent",
                      "Fire traps people, three injured", "Arson suspect caught at a gas station",
                      "Man assaulted at the fair", "Dog attack closes the park"):
            self.assertFalse(bi.keeps("good", title), title)

    def test_good_news_and_tech_take_the_name_and_minor_rule(self):
        self.assertFalse(bi.keeps("good", "Stowe 11-year-old Lily Tremblay finds a fossil on a field trip"))
        self.assertFalse(bi.keeps("good", "Emma Roy, 9, wins the state spelling bee"))
        self.assertFalse(bi.keeps("good", "15-year-old develops QR codes for lost pets"))
        self.assertFalse(bi.keeps("tech", "Burlington programmer Jessica Tran's home address leaked"))
        self.assertFalse(bi.keeps("tech", "Teen, 15, builds a chatbot in her garage"))
        self.assertTrue(bi.keeps("good", "Kids find a fossil on a field trip"))
        self.assertTrue(bi.keeps("tech", "Sam Altman says the next model ships in spring"))

    def test_tech_takes_the_self_harm_rule_but_not_the_whole_grim_list(self):
        self.assertFalse(bi.keeps("tech", "Teen kills himself after chatbot chats"))
        self.assertFalse(bi.keeps("tech", "Chatbot lawsuit turns on a suicide"))
        self.assertTrue(bi.keeps("tech", "New attack breaks the password manager"))

    def test_filler_that_means_nothing_alone_stays_out(self):
        for feed, title in (("nosy", "Great Scot!"), ("nosy", "Friday Photo Fun Match Game"),
                            ("nosy", "Match the arrestee with their alleged crime"),
                            ("tech", "Quoting Ted Sanders on the new model"), ("tech", "dbreunig/nesformer"),
                            ("tech", "datasette-llm 0.1a9"), ("good", "Town by Town: Panton is lovely"),
                            ("tech", "UK Green party drops longstanding opposition to nuclear power")):
            self.assertFalse(bi.keeps(feed, title), title)

    def test_caught_on_camera_is_not_a_crime_word(self):
        self.assertFalse(bi.keeps("nosy", "Capybara caught on camera 7 months after zoo escape", bi.CRIME_WORD))
        self.assertTrue(bi.keeps("nosy", "Goat thief caught behind the feed store", bi.CRIME_WORD))

    def test_good_news_is_not_a_budget_or_a_lottery_or_a_place_page(self):
        for title in ("Vermont's school consolidation process is off to a rocky start",
                      "Netherlands pledges $500 million for the rainforest",
                      "Lottery winner buys a llama", "Durham Pump Station in Durham, North Carolina"):
            self.assertFalse(bi.keeps("good", title), title)
        self.assertTrue(bi.keeps("good", "Inside a haunted barn in East Montpelier"))

    def test_a_phone_number_never_lands(self):
        self.assertFalse(bi.keeps("tech", "Call 802-555-1212 for the launch"))

    def test_only_narrows_a_mixed_feed(self):
        self.assertTrue(bi.keeps("good", "Poetry from Stowe students", r"poet"))
        self.assertFalse(bi.keeps("good", "Road work on Main Street", r"poet"))


class Judge(unittest.TestCase):
    ITEMS = [item("One", "https://a.example/1"), item("Two", "https://a.example/2")]

    def test_a_rejection_is_remembered_and_never_asked_again(self):
        calls = []
        def ask(feed, fresh):
            calls.append(len(fresh))
            return no(feed, fresh) if len(calls) == 1 else yes(feed, fresh)
        memory = {}
        runs = [bi.judge("nosy", self.ITEMS, memory, ask) for _ in range(3)]
        self.assertEqual(runs, [[], [], []])
        self.assertEqual(calls, [2])                    # the third answer would have flipped it

    def test_a_yes_is_remembered_and_only_new_headlines_are_asked(self):
        memory = {"https://a.example/1": [1, NOW]}
        asked = []
        got = bi.judge("good", self.ITEMS, memory, lambda f, x: asked.extend(i["u"] for i in x) or no(f, x))
        self.assertEqual([x["u"] for x in got], ["https://a.example/1"])
        self.assertEqual(asked, ["https://a.example/2"])

    def test_nothing_but_a_model_s_yes_is_approved(self):
        prev = {"good": [item("Unjudged turtle comes home", "https://a.example/9")]}
        sources = {"good": [("Turtles", "u", None)]}
        got = bi.build(prev, NOW, sources, read=lambda u: "<rss/>", ask=no)
        self.assertEqual(got["good"], [])               # being in the last file proves nothing

    def test_an_outage_records_nothing_on_any_feed(self):
        for feed in ("good", "nosy", "tech"):
            memory = {}
            bi.judge(feed, self.ITEMS, memory, down)
            self.assertEqual(memory, {}, feed)

    def test_an_outage_shows_nosy_and_good_only_what_was_approved(self):
        memory = {"https://a.example/1": [1, NOW]}
        for feed in ("nosy", "good"):
            got = bi.judge(feed, self.ITEMS, dict(memory), down)
            self.assertEqual([x["u"] for x in got], ["https://a.example/1"], feed)

    def test_an_outage_never_shows_a_rejection(self):
        memory = {"https://a.example/1": [0, NOW]}
        self.assertEqual([x["u"] for x in bi.judge("tech", self.ITEMS, memory, down)], ["https://a.example/2"])

    def test_tech_goes_on_through_an_outage_and_is_judged_when_the_model_is_back(self):
        memory = {}
        self.assertEqual(len(bi.judge("tech", self.ITEMS, memory, down)), 2)
        self.assertEqual(bi.judge("tech", self.ITEMS, memory, no), [])

    def test_a_run_past_the_limit_shows_only_what_was_judged(self):
        items = [item(f"Headline number {i}", f"https://a.example/{i}") for i in range(bi.JUDGE_MAX + 5)]
        memory = {}
        self.assertEqual(len(bi.judge("good", items, memory, yes)), bi.JUDGE_MAX)
        self.assertEqual(len(bi.judge("good", items, memory, yes)), bi.JUDGE_MAX + 5)

    def test_no_key_is_an_outage(self):
        memory = {}
        with mock.patch.object(wc, "pick_engine", return_value=None):
            self.assertEqual(bi.judge("nosy", self.ITEMS, memory, bi.ask_model), [])
        self.assertEqual(memory, {})

    def test_the_model_s_numbers_become_urls(self):
        answer = ({"keep": [1, 7, "x"]}, {})
        with mock.patch.object(wc, "pick_engine", return_value={"provider": "anthropic", "model": "m"}), \
                mock.patch.object(wc, "ask_json", return_value=answer) as ask:
            got = bi.ask_model("tech", self.ITEMS)
        self.assertEqual(got, {"https://a.example/1": False, "https://a.example/2": True})
        self.assertIn("1. Two (Turtles)", ask.call_args[0][2])

    def test_good_news_and_nosy_ask_sonnet_one_headline_a_call(self):
        calls = []

        def ask(engine, system, user, schema, max_tokens, **kw):
            calls.append((engine["model"], user, max_tokens, kw))
            return {"keep": [0] if "Two" in user else []}, {}

        for feed in ("good", "nosy"):
            calls.clear()
            with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "k"}), mock.patch.object(wc, "ask_json", ask):
                got = bi.ask_model(feed, self.ITEMS)
            self.assertEqual(got, {"https://a.example/1": False, "https://a.example/2": True})
            self.assertEqual({c[0] for c in calls}, {"claude-sonnet-5-5"})
            self.assertEqual(sorted(c[1].count("(Turtles)") for c in calls), [1, 1])
            self.assertGreaterEqual(min(c[2] for c in calls), 2000)      # room for thinking it cannot turn off
            self.assertEqual(calls[0][3]["attempts"], 1)
            self.assertLess(calls[0][3]["timeout"], 60)

    def test_tech_stays_one_list_on_haiku(self):
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "k"}), \
                mock.patch.object(wc, "ask_json", return_value=({"keep": [0]}, {})) as ask:
            bi.ask_model("tech", self.ITEMS)
        self.assertEqual(ask.call_count, 1)
        self.assertEqual(ask.call_args[0][0]["model"], "claude-haiku-5-5")

    def test_one_failed_headline_records_no_verdict_and_costs_the_others_nothing(self):
        def ask(engine, system, user, schema, max_tokens, **kw):
            if "One" in user:
                raise wc.ModelError("bad answer")
            return {"keep": [0]}, {}

        memory = {}
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "k"}), mock.patch.object(wc, "ask_json", ask):
            got = bi.judge("nosy", self.ITEMS, memory, bi.ask_model)
        self.assertEqual([x["u"] for x in got], ["https://a.example/2"])
        self.assertEqual(list(memory), ["https://a.example/2"])

    def test_past_the_clock_a_headline_waits_for_the_next_run(self):
        memory = {}
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "k"}), mock.patch.object(bi, "ONE_TIME_S", -1), \
                mock.patch.object(wc, "ask_json") as ask:
            self.assertEqual(bi.judge("good", self.ITEMS, memory, bi.ask_model), [])
        ask.assert_not_called()
        self.assertEqual(memory, {})

    def test_the_worst_case_fits_the_workflow_step(self):
        self.assertLess(2 * (bi.ONE_TIME_S + bi.ONE_TIMEOUT_S), 4 * 60)

    def test_an_answer_with_no_verdict_is_an_outage_not_a_rejection(self):
        memory = {}
        with mock.patch.object(wc, "pick_engine", return_value={"provider": "anthropic", "model": "m"}), \
                mock.patch.object(wc, "ask_json", return_value=({}, {})):
            self.assertEqual(bi.judge("nosy", self.ITEMS, memory, bi.ask_model), [])
            self.assertEqual(bi.judge("tech", self.ITEMS, memory, bi.ask_model) and memory, {})

    def test_every_feed_tells_the_model_the_name_and_minor_rule(self):
        for feed, prompt in bi.JUDGE.items():
            self.assertIn("private person", prompt, feed)
            self.assertIn("child", prompt, feed)
        self.assertIn("about a minor", bi.JUDGE["nosy"])
        self.assertIn("lotter", bi.JUDGE["good"])


class Spend(unittest.TestCase):
    ITEMS = Judge.ITEMS

    def test_a_month_past_its_cap_asks_nothing_and_records_nothing(self):
        asked, memory = [], {}
        got = bi.judge("nosy", self.ITEMS, memory, lambda f, x: asked.extend(x) or yes(f, x), room=0)
        self.assertEqual((got, asked, memory), ([], [], {}))

    def test_past_the_cap_tech_still_shows_what_the_rules_passed(self):
        self.assertEqual(len(bi.judge("tech", self.ITEMS, {}, down, room=0)), 2)

    def test_the_month_pays_for_only_what_it_has_left(self):
        memory = {}
        self.assertEqual(len(bi.judge("good", self.ITEMS, memory, yes, room=1)), 1)
        self.assertEqual(len(memory), 1)

    def test_the_build_stops_asking_at_the_cap(self):
        month = bi.month_of(NOW)
        sources = {"good": [("Turtles", "u", None)]}
        asked = []
        memory = {"ai": {"month": month, "usd": bi.JUDGE_MONTH_CAP_USD, "runs": []}}
        bi.build({}, NOW, sources, read=lambda u: RSS, ask=lambda f, x: asked.extend(x) or yes(f, x), memory=memory)
        self.assertEqual(asked, [])

    def test_last_month_s_spend_does_not_count(self):
        sources = {"good": [("Turtles", "u", None)]}
        memory = {"ai": {"month": "2026-10", "usd": 99.0, "runs": []}}
        got = bi.build({}, NOW, sources, read=lambda u: RSS, ask=yes, memory=memory)
        self.assertTrue(got["good"])

    def test_every_call_is_logged_with_its_cost_failed_ones_included(self):
        bi.SPENT.clear()
        calls = [wc.ModelError("bad"), ({"keep": [0]}, {"in": 1000, "out": 500, "calls": 1})]

        def ask(*a, **k):
            got = calls.pop(0)
            if isinstance(got, Exception):
                got.usage = {"in": 1000, "out": 0, "calls": 1}
                raise got
            return got

        memory = {}
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "k"}), mock.patch.object(wc, "ask_json", ask), \
                mock.patch.object(bi, "ONE_WORKERS", 1):
            bi.judge("nosy", self.ITEMS, memory.setdefault("nosy", {}), bi.ask_model)
        bi.log_cost(memory, NOW, "nosy")
        want = wc.cost_usd("claude-sonnet-5-5", {"in": 2000, "out": 500})
        self.assertAlmostEqual(memory["ai"]["usd"], want)
        self.assertEqual((memory["ai"]["month"], memory["ai"]["runs"][0]["calls"], bi.SPENT), (bi.month_of(NOW), 2, []))

    def test_a_new_month_starts_at_nothing(self):
        bi.SPENT[:] = [("claude-sonnet-5-5", {"in": 1000, "out": 0})]
        memory = {"ai": {"month": "2026-10", "usd": 2.0, "runs": []}}
        bi.log_cost(memory, NOW, "good")
        self.assertEqual((memory["ai"]["month"], memory["ai"]["usd"]), (bi.month_of(NOW), 0.002))

    def test_the_cost_is_read_back_and_survives_the_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "judged.json"
            path.write_text(json.dumps({"good": {}, "ai": {"month": "2026-11", "usd": 1.5, "runs": []}}))
            self.assertEqual(bi.month_spent(bi.load_judged(path), NOW), 1.5)

    def test_one_headline_under_two_urls_is_asked_about_once(self):
        items = [item("A turtle comes home at last", "https://a.example/1"),
                 item("A turtle comes home at last", "https://news.google.com/x", "Other")]
        asked, memory = [], {}
        bi.judge("good", items, memory, lambda f, x: asked.extend(x) or yes(f, x))
        self.assertEqual((len(asked), len(memory)), (1, 2))

    def test_a_known_headline_under_a_new_url_is_never_asked_about(self):
        items = [item("A turtle comes home at last", "https://a.example/1"),
                 item("A turtle comes home at last", "https://a.example/2")]
        memory = {"https://a.example/1": [0, NOW]}
        self.assertEqual(bi.judge("good", items, memory, down), [])
        self.assertEqual(memory["https://a.example/2"][0], 0)


class Build(unittest.TestCase):
    SOURCES = {"good": [("Turtles", "https://a.example/rss", None)]}

    def test_a_good_read_is_filtered_dated_and_named(self):
        got = bi.build({}, NOW, self.SOURCES, read=lambda url: RSS, ask=yes)
        self.assertEqual([x["t"] for x in got["good"]], ["A turtle comes home"])
        self.assertEqual(got["good"][0]["s"], "Turtles")

    def test_a_failed_feed_keeps_its_last_good_items(self):
        def fail(url):
            raise OSError("down")
        prev = {"good": [item("Old turtle comes home", "https://a.example/9")]}
        got = bi.build(prev, NOW, self.SOURCES, read=fail, ask=yes)
        self.assertEqual(got["good"][0]["t"], "Old turtle comes home")

    def test_a_clean_empty_read_keeps_the_last_good_items(self):
        prev = {"good": [item("Old turtle comes home", "https://a.example/9")]}
        got = bi.build(prev, NOW, self.SOURCES, read=lambda url: "<rss><channel/></rss>", ask=yes)
        self.assertEqual([x["t"] for x in got["good"]], ["Old turtle comes home"])

    def test_items_stay_after_their_source_has_moved_on(self):
        prev = {"good": [item("Old turtle comes home", "https://a.example/9")]}
        got = bi.build(prev, NOW, self.SOURCES, read=lambda url: RSS, ask=yes)
        self.assertEqual(len(got["good"]), 2)

    def test_a_last_good_item_past_its_window_or_the_rules_goes(self):
        prev = {"good": [item("Old turtle comes home", "https://a.example/9", ts=NOW - 15 * 86400),
                         item("Rapist caught at gas station", "https://a.example/8")]}
        got = bi.build(prev, NOW, self.SOURCES, read=lambda url: "<rss/>", ask=yes)
        self.assertEqual(got["good"], [])

    def test_nosy_never_carries_a_picture_new_or_kept(self):
        prev = {"nosy": [item("Man tries to pay with a live chicken", "https://a.example/9", i="https://a.example/m.jpg")]}
        sources = {"nosy": [("Turtles", "https://a.example/rss", None)]}
        got = bi.build(prev, NOW, sources, read=lambda url: RSS, ask=yes)
        self.assertEqual(len(got["nosy"]), 2)
        self.assertTrue(all("i" not in x for x in got["nosy"]))

    def test_good_news_keeps_its_picture(self):
        got = bi.build({}, NOW, self.SOURCES, read=lambda url: RSS, ask=yes)
        self.assertEqual(got["good"][0]["i"], "https://a.example/1.jpg")

    def test_the_same_headline_from_two_sources_shows_once(self):
        sources = {"good": [("A", "u1", None), ("B", "u2", None)]}
        got = bi.build({}, NOW, sources, read=lambda url: RSS, ask=yes)
        self.assertEqual(len(got["good"]), 1)

    def test_one_story_in_two_outlets_words_shows_once(self):
        a = item("State police looking for two suspects in ATM theft at Pittsford gas station", "u1", "WCAX", NOW - 60)
        b = item("VSP asking for public's help in identifying suspects who stole ATM in Pittsford Sunday", "u2", "NBC5")
        got = bi.tidy("nosy", [a, b])
        self.assertEqual([x["s"] for x in got], ["WCAX"])

    def test_two_shared_words_are_one_story_when_one_is_rare(self):
        a = item("Bugatti CEO chases down car thief - then offers him lift home", "u1", "Sky News", NOW - 60)
        b = item("How Bugatti CEO recovered his stolen Chiron", "u2", "NewsBytes")
        self.assertEqual([x["s"] for x in bi.tidy("nosy", [a, b])], ["Sky News"])
        c = item("Six baby dolphins were born in Cambodia this year", "u3", "Good Good Good", NOW - 60)
        d = item("Numbers of Endangered and Sacred River Dolphin Grow by 6 After Successful Breeding Season", "u4", "GNN")
        self.assertEqual(len(bi.tidy("good", [c, d])), 1)

    def test_two_words_a_lot_of_headlines_share_are_not_one_story(self):
        items = [item(f"Scientists {w} in the Pacific", f"u{i}", f"S{i}", NOW - i) for i, w in enumerate((
            "film a squid", "tag a whale", "name a reef", "chart a current"))]
        self.assertEqual(len(bi.tidy("good", items)), 4)

    def test_one_shared_rare_word_is_not_enough(self):
        a = item("Rutland goat wins the county fair ribbon", "u1", "WCAX", NOW - 60)
        b = item("Goat escapes a petting zoo in Maine", "u2", "NBC5")
        self.assertEqual(len(bi.tidy("nosy", [a, b])), 2)

    def test_an_outlet_or_a_headline_in_another_script_stays_out(self):
        self.assertTrue(bi.foreign_script("\uc2a4\ud3ec\uce20\uc870\uc120"))
        self.assertFalse(bi.foreign_script("Caf\u00e9 Press \u2013 News"))
        self.assertFalse(bi.keeps("nosy", "\uc2a4\ud3ec\uce20\uc870\uc120 headline about a stolen thing"))
        xml = RSS.replace("A turtle comes home", "A turtle comes home - \uc2a4\ud3ec\uce20\uc870\uc120").replace(
            "https://a.example/1<", "https://news.google.com/1<")
        got = bi.build({"good": [item("A turtle comes home again", "https://a.example/9", "\uc2a4\ud3ec\uce20\uc870\uc120")]},
                       NOW, {"good": [("Google News", "u", None)]}, read=lambda u: xml, ask=yes)
        self.assertEqual(got["good"], [])

    def test_two_stories_from_one_town_both_show(self):
        a = item("Rutland man caught stealing a goat from a farm", "u1", "WCAX", NOW - 60)
        b = item("Rutland police clear up a false alarm downtown", "u2", "NBC5")
        self.assertEqual(len(bi.tidy("nosy", [a, b])), 2)

    def test_one_outlet_s_pages_are_not_one_story(self):
        a = item("A stone tower in Durham, North Carolina", "u1", "Atlas")
        b = item("A brick tower in Durham, North Carolina", "u2", "Atlas", NOW - 60)
        self.assertEqual(len(bi.tidy("good", [a, b])), 2)

    def test_a_noisy_source_stops_at_its_cap(self):
        items = [item(f"Odd place number {i}", f"u{i}", "Atlas Obscura", NOW - i) for i in range(6)]
        items += [item(f"Smithsonian piece number {i}", f"v{i}", "Smithsonian", NOW - i) for i in range(20)]
        got = bi.tidy("good", items)
        self.assertEqual(sum(x["s"] == "Atlas Obscura" for x in got), 3)
        self.assertEqual(sum(x["s"] == "Smithsonian" for x in got), bi.PER_SOURCE)

    def test_a_verdict_is_dropped_once_its_item_has_aged_out(self):
        memory = {"good": {"https://a.example/old": [1, NOW - 15 * 86400], "https://a.example/new": [0, NOW]}}
        bi.build({}, NOW, self.SOURCES, read=lambda url: "<rss/>", ask=yes, memory=memory)
        self.assertEqual(list(memory["good"]), ["https://a.example/new"])


class Main(unittest.TestCase):
    def run_main(self, tmp, feeds):
        out, judged = pathlib.Path(tmp) / "interests.json", pathlib.Path(tmp) / "judged.json"
        def build(prev, now, memory):
            memory["good"] = {"https://a.example/1": [1, now], "https://a.example/2": [0, now]}
            return feeds
        with mock.patch.object(bi, "build", build), \
                mock.patch.object(sys, "argv", ["x", "--out", str(out), "--judged", str(judged)]):
            self.assertEqual(bi.main(), 0)
        return out, judged

    def test_verdicts_go_to_their_own_file_never_the_public_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, judged = self.run_main(tmp, {"good": [item("Turtle comes home", "https://a.example/1")]})
            public = out.read_text(encoding="utf-8")
            self.assertEqual(json.loads(judged.read_text())["good"]["https://a.example/2"][0], 0)
        self.assertNotIn("https://a.example/2", public)

    def test_nothing_read_leaves_the_file_but_keeps_the_verdicts(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, judged = self.run_main(tmp, {"good": []})
            self.assertFalse(out.exists())
            self.assertTrue(judged.exists())

    def test_an_unreadable_verdict_file_means_asking_again(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "judged.json"
            for text in ("not json", "[1]", '{"good": 3}'):
                path.write_text(text)
                self.assertFalse(any(bi.load_judged(path).values()), text)


class Workflow(unittest.TestCase):
    TEXT = (pathlib.Path(__file__).resolve().parents[1] / ".github" / "workflows" / "refresh-allday.yml").read_text()

    def step(self, name):
        return self.TEXT[self.TEXT.index(f"- name: {name}"):].split("\n      - name:")[0]

    def test_interests_runs_after_the_paid_step_and_cannot_fail_the_job(self):
        self.assertLess(self.TEXT.index("- name: Build Instagram"), self.TEXT.index("- name: Build interests"))
        self.assertIn("continue-on-error: true", self.step("Build interests"))

    def test_every_step_has_a_limit_and_they_fit_the_job(self):
        names = ("Reserve Instagram credits", "Build What Now", "Build sports", "Build Instagram",
                 "Build interests", "Commit if changed")
        limits = [int(self.step(n).split("timeout-minutes: ")[1].split()[0]) for n in names]
        job = int(self.TEXT.split("timeout-minutes: ")[1].split()[0])
        self.assertLess(sum(limits), job)

    def test_a_missing_file_cannot_stop_the_commit(self):
        commit = self.step("Commit if changed")
        self.assertIn('git add "$f"', commit)
        self.assertNotIn("git add all-day", commit)
        self.assertIn("data/interests-judged.json", commit)


class Stories(unittest.TestCase):
    PAGE = "<script>var x = '<p>" + "n" * 90 + "</p>';</script><p>Short.</p><p>" + "Police say a prank was reported in town. " * 3 + "</p>"

    def test_the_story_is_the_page_s_paragraphs(self):
        got = bi.story_of("https://a.example/1", read=lambda u: self.PAGE)
        self.assertTrue(got.startswith("Police say a prank"))
        self.assertNotIn("nnn", got)
        self.assertLessEqual(len(bi.story_of("https://a.example/1", read=lambda u: self.PAGE * 40)), bi.STORY_CHARS)

    def test_a_page_that_will_not_open_leaves_the_headline(self):
        def broken(url):
            raise OSError("403")
        with mock.patch.object(bi, "log"):
            self.assertEqual(bi.story_of("https://a.example/1", read=broken), "")

    def test_a_google_link_goes_to_the_story(self):
        signed = '<div data-n-a-sg="sig" data-n-a-ts="123">'
        target = 'garturlres\\\\",\\\\"https://paper.example/story'.replace("\\\\", "\\")
        read = lambda u: signed if "news.google" in u else self.PAGE
        sent = []

        def send(url, form):
            sent.append(form["f.req"])
            return target

        got = bi.story_of("https://news.google.com/rss/articles/CODE?oc=5", read=read, send=send)
        self.assertTrue(got.startswith("Police say"))
        self.assertIn("CODE", sent[0])
        self.assertIn("sig", sent[0])
        self.assertEqual(bi.story_of("https://news.google.com/rss/articles/CODE", read=lambda u: "<p>nothing</p>", send=send), "")

    def test_a_fark_link_goes_to_what_it_links(self):
        link = '<a href="https://www.fark.com/goto/1/www.paper.example/x">a</a>'
        read = lambda u: link if "comments" in u else self.PAGE
        self.assertTrue(bi.story_of("https://www.fark.com/comments/1?utm=x", read=read).startswith("Police say"))
        self.assertEqual(bi.story_of("https://www.fark.com/comments/1", read=lambda u: self.PAGE), "")

    def test_nosy_reads_the_story_and_good_news_does_not(self):
        seen = []

        def ask(engine, rules, text, *a, **k):
            seen.append(text)
            return {"keep": [0]}, {}

        x = {"t": "Police clear up a false report", "s": "NBC5", "u": "https://a.example/1"}
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "k"}), mock.patch.object(wc, "ask_json", ask), \
                mock.patch.object(bi, "story_of", return_value="It was a prank.") as story:
            self.assertEqual(bi.ask_each("nosy", [x]), {x["u"]: True})
            bi.ask_each("good", [x])
        self.assertIn("Story: It was a prank.", seen[0])
        self.assertNotIn("Story:", seen[1])
        self.assertEqual(story.call_count, 1)

    def test_a_story_about_a_minor_is_a_no_without_asking(self):
        x = {"t": "Police clear up a false report", "s": "NBC5", "u": "https://a.example/1"}
        for story in ("A minor who claimed to have found the blade admitted it was a prank.",
                      "A 14-year-old was cited.", "Two teens ran off."):
            with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "k"}), mock.patch.object(bi, "story_of", return_value=story), \
                    mock.patch.object(wc, "ask_json", side_effect=AssertionError("no call")):
                self.assertEqual(bi.ask_each("nosy", [x]), {x["u"]: False}, story)

    def test_the_story_never_ships(self):
        x = {"t": "Police clear up a false report in town", "s": "NBC5", "u": "https://a.example/1", "ts": NOW}
        self.assertEqual(set(bi.tidy("nosy", [dict(x)])[0]), {"t", "s", "u", "ts"})


if __name__ == "__main__":
    unittest.main()
