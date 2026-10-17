"""Channel tagging without a model: the folder, the site, the inbox file.

Run: python3 -m unittest discover -s tests -p 'test_wire*.py'
"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import refresh_pulse as rp  # noqa: E402
import tag_wire as tw  # noqa: E402
import wire_common as wc  # noqa: E402

NOW_TS = 1_792_180_000

PULSE = {
    "v": 1,
    "sources": [
        {"id": "wcax", "name": "WCAX", "short": "WCAX", "site": "https://www.wcax.com/",
         "topic": "local", "local": 1},
        {"id": "ap", "name": "AP", "short": "AP", "site": "https://apnews.com/", "topic": "news"},
        {"id": "r-burlington", "name": "r/burlington", "short": "r/burlington",
         "site": "https://www.reddit.com/r/burlington/", "topic": "local", "local": 1},
        {"id": "nba", "name": "NBA", "site": "https://www.reddit.com/r/nba/", "topic": "sports"},
        {"id": "7days", "name": "7Days", "site": "https://www.sevendaysvt.com/", "topic": "newsletters"},
        {"id": "semafor", "name": "Semafor", "site": "https://www.semafor.com/newsletters",
         "topic": "newsletters"},
        {"id": "vpr-yt", "name": "Vermont Public on YouTube", "site": "https://www.youtube.com/@vtpublic",
         "topic": "local", "local": 1},
    ],
    "items": [
        {"t": "Council votes 9 to 3", "u": "https://www.wcax.com/a", "d": NOW_TS - 600, "s": "wcax",
         "i": "https://img/a.jpg"},
        {"t": "Fed holds rates", "u": "https://apnews.com/b", "d": NOW_TS - 1200, "s": "ap"},
        {"t": "Where to park for the Flynn?", "u": "https://www.reddit.com/r/burlington/comments/c1/x/",
         "d": NOW_TS - 1800, "s": "r-burlington"},
        {"t": "Trade rumors", "u": "https://www.reddit.com/r/nba/comments/d1/x/", "d": NOW_TS - 60, "s": "nba"},
        {"t": "Seven Days Thursday", "u": "https://mailchi.mp/7days/e", "d": NOW_TS - 2400, "s": "7days"},
        {"t": "Semafor Flagship", "u": "https://semafor.com/e", "d": NOW_TS - 2500, "s": "semafor"},
        {"t": "Unlinkable edition", "u": "https://www.inoreader.com/x", "d": NOW_TS - 2600,
         "s": "semafor", "x": 1},
        {"t": "How the Winooski made Burlington", "u": "https://www.youtube.com/watch?v=abc",
         "d": NOW_TS - 3000, "s": "vpr-yt"},
        {"t": "Too old", "u": "https://www.wcax.com/old", "d": NOW_TS - 40 * 3600, "s": "wcax"},
        {"t": "Orphan", "u": "https://gone.example/o", "d": NOW_TS - 100, "s": "gone"},
    ],
    "inbox": {
        "x": {"paused": False, "items": [
            {"u": "https://x.com/wcax/status/1", "d": NOW_TS - 300, "fd": NOW_TS - 200,
             "from": "@wcax", "name": "WCAX Channel 3", "summary": "I-89 closed at exit 14.",
             "kind": "post", "ch": "x", "local": True}]},
        "facebook": {"paused": True, "reason": "no WIRE_INBOX_TOKEN secret", "items": []},
    },
}


class MechanicalChannelTests(unittest.TestCase):
    def test_every_rule(self):
        by_id = {source["id"]: source for source in PULSE["sources"]}
        self.assertEqual(wc.mechanical_channel(by_id["wcax"]), ("local", True))
        self.assertEqual(wc.mechanical_channel(by_id["ap"]), ("world", False))
        self.assertEqual(wc.mechanical_channel(by_id["r-burlington"]), ("reddit", True))
        self.assertEqual(wc.mechanical_channel(by_id["nba"]), ("reddit", False))
        self.assertEqual(wc.mechanical_channel(by_id["7days"]), ("newsletters", True))
        self.assertEqual(wc.mechanical_channel(by_id["semafor"]), ("newsletters", False))
        self.assertEqual(wc.mechanical_channel(by_id["vpr-yt"]), ("video", True))
        # a local outlet's YouTube link is video, by URL alone
        self.assertEqual(wc.mechanical_channel(by_id["wcax"], "https://youtu.be/x"), ("video", True))

    def test_channels_are_the_seven(self):
        self.assertEqual(set(wc.CHANNELS),
                         {"local", "world", "x", "facebook", "reddit", "newsletters", "video"})


class WireItemsTests(unittest.TestCase):
    def setUp(self):
        self.items = wc.wire_items(PULSE, NOW_TS, 26)
        self.by_title = {item["title"]: item for item in self.items}

    def test_window_unlinkable_orphans_and_national_reddit_drop(self):
        self.assertNotIn("Too old", self.by_title)
        self.assertNotIn("Unlinkable edition", self.by_title)
        self.assertNotIn("Orphan", self.by_title)
        self.assertNotIn("Trade rumors", self.by_title)     # r/nba never reaches the Wire

    def test_shape_of_every_item(self):
        for item in self.items:
            for key in ("id", "ch", "local", "src", "name", "title", "url", "posted_at"):
                self.assertIn(key, item, item)
            self.assertIn(item["ch"], wc.CHANNELS)
            self.assertIsInstance(item["local"], bool)

    def test_channels_land(self):
        got = {title: (item["ch"], item["local"]) for title, item in self.by_title.items()}
        self.assertEqual(got["Council votes 9 to 3"], ("local", True))
        self.assertEqual(got["Fed holds rates"], ("world", False))
        self.assertEqual(got["Where to park for the Flynn?"], ("reddit", True))
        self.assertEqual(got["Seven Days Thursday"], ("newsletters", True))
        self.assertEqual(got["Semafor Flagship"], ("newsletters", False))
        self.assertEqual(got["How the Winooski made Burlington"], ("video", True))
        self.assertEqual(got["I-89 closed at exit 14."], ("x", True))

    def test_inbox_post_carries_its_account(self):
        post = self.by_title["I-89 closed at exit 14."]
        self.assertEqual(post["src"], "x:@wcax")
        self.assertEqual(post["handle"], "@wcax")
        self.assertEqual(post["name"], "WCAX Channel 3")
        self.assertEqual(post["site"], "https://x.com/wcax")

    def test_media_and_thumbs(self):
        self.assertEqual(self.by_title["Council votes 9 to 3"]["thumb"], "https://img/a.jpg")
        self.assertEqual(self.by_title["How the Winooski made Burlington"]["media"]["type"], "video")

    def test_newest_first_and_ids_stable(self):
        stamps = [item["d"] for item in self.items]
        self.assertEqual(stamps, sorted(stamps, reverse=True))
        again = wc.wire_items(PULSE, NOW_TS, 26)
        self.assertEqual([i["id"] for i in self.items], [i["id"] for i in again])


class PulsePayloadTests(unittest.TestCase):
    def test_build_payload_stamps_ch_and_local(self):
        sources = [
            {"id": "wcax", "name": "WCAX", "site": "https://www.wcax.com/", "topic": "local",
             "local": True, "podcast": False},
            {"id": "r-burlington", "name": "r/burlington", "site": "https://www.reddit.com/r/burlington/",
             "topic": "local", "local": True, "podcast": False},
            {"id": "semafor", "name": "Semafor", "site": "", "topic": "newsletters",
             "local": False, "podcast": False},
        ]
        payload = rp.build_payload(sources, {
            "wcax": [{"t": "a", "u": "https://www.wcax.com/a", "d": 3}],
            "r-burlington": [{"t": "b", "u": "https://www.reddit.com/r/burlington/comments/x/b/", "d": 2}],
            "semafor": [{"t": "c", "u": "https://semafor.com/c", "d": 1}],
        }, rp.utcnow())
        got = [(item["s"], item["ch"], item["local"]) for item in payload["items"]]
        self.assertEqual(got, [("wcax", "local", True), ("r-burlington", "reddit", True),
                               ("semafor", "newsletters", False)])


class TagValidationTests(unittest.TestCase):
    def test_model_cannot_move_fixed_channels(self):
        batch = [{"id": "r", "ch": "reddit", "local": True, "name": "r/burlington", "title": "t", "d": 1}]
        tags = tw.validate_tags([{"i": 0, "junk": "none", "local": True, "ch": "local",
                                  "topic": "community", "score": 6}], batch, 1)
        self.assertEqual(tags["r"]["ch"], "reddit")

    def test_geography_flip(self):
        batch = [{"id": "w", "ch": "world", "local": False, "name": "AP", "title": "Winooski floods", "d": 1}]
        tags = tw.validate_tags([{"i": 0, "junk": "none", "local": True, "ch": "world",
                                  "topic": "weather", "score": 8}], batch, 1)
        self.assertEqual((tags["w"]["ch"], tags["w"]["local"]), ("local", True))

    def test_tunein_needs_a_tunein_headline(self):
        batch = [{"id": "a", "ch": "local", "local": True, "name": "Seven Days", "d": 1,
                  "title": "Digital Forensics Expert Hany Farid Vets Deepfakes at Vermont Tech Jam"},
                 {"id": "b", "ch": "local", "local": True, "name": "WCAX", "d": 1,
                  "title": "Watch live: the governor's debate at 7"}]
        tags = tw.validate_tags([{"i": 0, "junk": "tunein", "local": True, "ch": "local",
                                  "topic": "tech", "score": 3},
                                 {"i": 1, "junk": "tunein", "local": True, "ch": "local",
                                  "topic": "state-politics", "score": 3}], batch, 1)
        self.assertEqual((tags["a"]["junk"], tags["b"]["junk"]), ("none", "tunein"))

    def test_garbage_answers_leave_items_untagged(self):
        batch = [{"id": "a", "ch": "local", "local": True, "name": "WCAX", "title": "t", "d": 1}]
        for raw in (None, [], [{"i": True}], [{"i": 0, "junk": "spam", "score": 3}],
                    [{"i": 0, "junk": "none", "score": "high"}], "not a list"):
            self.assertEqual(tw.validate_tags(raw if isinstance(raw, list) else None, batch, 1), {}, raw)


# Real posts from 2026-10-17, copied as the tagger saw them (Facebook lines are
# the inbox bot's one-line summaries; Reddit lines are thread titles). The old
# rules junked 14 of 16 Facebook group posts and 22 of 30 r/burlington posts.
NEIGHBORS = {
    "facebook": [
        # events, posted by a band, a venue, a group or a neighbor
        "Someone is promoting the JonBoy and Lefty Band playing blues, rock, country and "
        "Americana tonight at The 828 taproom.",
        "Someone is playing live music at High Ground Brewing this afternoon from 4 to 6.",
        "Someone is promoting a Moonbird show at The Old Post tonight starting at 8.",
        "Someone is promoting an all-ages metal show tomorrow night at the Oddfellows hall in "
        "Burlington with Executive Disorder and Psychomanteum.",
        "Someone is announcing the 5th annual Northern Nosh Jewish food festival at Ohavi "
        "Zedek in Burlington on Nov 15 from 11:15 AM to 3 PM.",
        "Someone is announcing the 12th annual Orchard food drive starting Nov 7 and ending "
        "with a New Year's Eve glow parade on Dec 31.",
        "A member is promoting a Halloween movie night after mall trick-or-treating and "
        "asking people to register.",
        "Someone is promoting a Cabot community dinner tomorrow from 4:30 to 6:30 with "
        "chicken and biscuits and live music.",
        # questions and sharing
        "Someone new to the group is asking for things-to-do recommendations for their "
        "daughter visiting Burlington from California on Nov 7.",
        "Someone is sharing the history of the Lake Champlain Yacht Club, founded in 1887, "
        "and its move off the Burlington waterfront.",
    ],
    "reddit": [
        "Vintage Clothing Market today! 377 Pine St till 2pm",
        "Repair Cafe Saturday!",
        "Now playing: \"Spirits of Rokeby: The Impending Crisis\"",
        "Sci-fi author Annalee Newitz at Phoenix Books tonight!",
        "anyone have a spare ticket for judge at higher ground tonight?",
        "best deli style chicken salad?",
        "Where do the crows go during the day??",
        "Is 108 open today? Getting mixed information.",
        "Anyone local that repairs Dyson hair dryers?",
        "Sewing machine repair",
        "Cars on bike path",
        "ICE spotted",
        "New friend for Bob the Drag Queen show tonight? Free ticket!",
        "Giving away Woodstock VT Restaurant Reservation, 10/16",
    ],
}
# ... and the business ads among them, which stay junk
BUSINESS_ADS = {
    "facebook": [
        "Someone is advertising tonight's fall specials at Sweet Basil, including Maine "
        "lobster bisque, French onion soup and pumpkin gingersnap bread pudding.",
        "Someone is advertising the weekend hot bar at The Porch in Fairfax, open 8 to 6 "
        "today and tomorrow.",
        "Someone is advertising fresh bagels, brownies, cookies, cinnamon rolls and coffee "
        "cake at Melinda's Creations in Georgia, open 6 AM to 9:30 PM Thursday through Sunday.",
        "Someone is announcing a Burton gear trade-in event next weekend, Oct 23-25, at the "
        "Burlington flagship store.",
    ],
    "reddit": ["Last Chance for a Free Haircut This Week at Burlington Barbershop!"],
}


def posts(table):
    return [{"id": f"{ch}{k}", "ch": ch, "local": True, "name": "group", "title": title, "d": 1}
            for ch, titles in table.items() for k, title in enumerate(titles)]


class NeighborPostTests(unittest.TestCase):
    """2026-10-17: a neighbor announcing an event, asking, reporting or giving
    something away is not junk; a business ad, an engagement contest, spam and
    empty chatter are."""

    def verdicts(self, batch, junk):
        answer = [{"i": k, "junk": junk, "local": True, "ch": item["ch"], "topic": "events",
                   "score": 3} for k, item in enumerate(batch)]
        tags = tw.validate_tags(answer, batch, 1)
        self.assertEqual(len(tags), len(batch))
        return {item["title"]: tags[item["id"]]["junk"] for item in batch}

    def test_a_neighbors_show_is_never_a_tunein(self):
        # the old run's commonest mistake: band and venue posts junked as "tunein"
        got = self.verdicts(posts(NEIGHBORS), "tunein")
        self.assertEqual(set(got.values()), {"none"}, got)

    def test_a_real_livestream_notice_still_is(self):
        batch = posts({"facebook": ["Someone is inviting people to watch live as the band "
                                    "streams its rehearsal at 7."],
                       "reddit": ["Join us tonight at 7 for our livestream"]})
        self.assertEqual(set(self.verdicts(batch, "tunein").values()), {"tunein"})
        # "LIVE:" in capitals is a broadcast; "live music" is a show
        heads = [{"id": "a", "ch": "local", "local": True, "name": "WCAX", "d": 1,
                  "title": "LIVE: Gov. Scott's weekly press conference"},
                 {"id": "b", "ch": "local", "local": True, "name": "Seven Days", "d": 1,
                  "title": "Live music returns to the Church Street Marketplace"}]
        self.assertEqual(list(self.verdicts(heads, "tunein").values()), ["tunein", "none"])

    def test_business_ads_stay_promo(self):
        # no code path softens promo: the model's verdict on an ad stands
        got = self.verdicts(posts(BUSINESS_ADS), "promo")
        self.assertEqual(set(got.values()), {"promo"}, got)

    def test_the_junk_words_are_the_prompts_words(self):
        rules = wc.read_prompt("wire-tags.md")
        for word in tw.JUNK[1:]:
            self.assertIn(f"`{word}`", rules, word)
        # "giveaway" pulled a neighbor's free ticket into junk; the word is "contest"
        self.assertNotIn("`giveaway`", rules)
        self.assertEqual(tw.validate_tags([{"i": 0, "junk": "giveaway", "local": True,
                                            "ch": "reddit", "topic": "events", "score": 0}],
                                          posts({"reddit": ["Free ticket!"]}), 1), {})

    def test_the_prompt_carries_the_neighbor_rules(self):
        rules = " ".join(wc.read_prompt("wire-tags.md").split())   # unwrapped
        for phrase in ("Announces an event", "Asks a question", "Reports something",
                       "Gives something away", "the bot's words, not a verdict",
                       "a business advertising what it sells"):
            self.assertIn(phrase, rules)
        # the examples it quotes are real posts from the fixtures above, on the right side
        for quote in ("Vintage Clothing Market today! 377 Pine St till 2pm", "Repair Cafe Saturday!",
                      "Is 108 open today? Getting mixed information.",
                      "New friend for Bob the Drag Queen show tonight? Free ticket!"):
            self.assertIn(quote, NEIGHBORS["reddit"])
            self.assertIn(quote, rules)
        self.assertIn(BUSINESS_ADS["reddit"][0], rules)


if __name__ == "__main__":
    unittest.main()
