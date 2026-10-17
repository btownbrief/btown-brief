"""curate_wire.py: index mapping, the river's merge, the midnight freeze, and
the failure posture. The model is always a stub; nothing touches the network.

Run: python3 -m unittest discover -s tests -p 'test_wire*.py'
"""

import io
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from contextlib import redirect_stderr, redirect_stdout
from types import SimpleNamespace
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import curate_wire as cw  # noqa: E402
import tag_wire as tw  # noqa: E402
import wire_common as wc  # noqa: E402

# 2:10 pm Eastern on Friday, October 16, 2026
NOW = datetime(2026, 10, 16, 18, 10, tzinfo=timezone.utc)
NOW_TS = int(NOW.timestamp())


def pulse(n_local=12, n_world=6, start=0):
    sources = [
        {"id": "wcax", "name": "WCAX", "short": "WCAX", "site": "https://www.wcax.com/",
         "topic": "local", "local": 1},
        {"id": "vtd", "name": "VTDigger", "short": "VTDigger", "site": "https://vtdigger.org/",
         "topic": "local", "local": 1},
        {"id": "ap", "name": "AP", "short": "AP", "site": "https://apnews.com/", "topic": "news"},
    ]
    items = []
    for k in range(start, start + n_local):
        items.append({"t": f"Local headline {k}", "u": f"https://local.example/{k}",
                      "d": NOW_TS - (k + 1) * 300, "s": "wcax" if k % 2 else "vtd"})
    for k in range(start, start + n_world):
        items.append({"t": f"National headline {k}", "u": f"https://world.example/{k}",
                      "d": NOW_TS - (k + 1) * 400, "s": "ap"})
    return {"v": 1, "generated": NOW.isoformat(), "sources": sources, "items": items,
            "inbox": {"x": {"paused": True, "reason": "no WIRE_INBOX_TOKEN secret", "items": []}},
            "reddit": {"paused": False, "last_post": NOW.isoformat()}}


class Stub:
    """Stands in for wire_common.ask_json. `plan(numbers)` builds an answer
    from the numbered lines the prompt actually showed."""

    def __init__(self, plan=None, error=None, rewrite=None):
        self.plan, self.error, self.prompts = plan, error, []
        self.rewrite, self.reason_prompts = rewrite, []

    def __call__(self, engine, system, user, schema, max_tokens, attempts=2, log_prefix=""):
        if "rewrites" in schema["properties"]:      # the reasons pass
            self.reason_prompts.append(user)
            rows = [line for line in user.splitlines() if line[:1].isdigit()]
            return {"rewrites": self.rewrite(rows) if self.rewrite else []}, {"in": 300, "out": 50, "calls": 1}
        self.prompts.append((system, user, schema))
        if self.error:
            exc = wc.ModelError(self.error)
            exc.usage = {"in": 500, "out": 0, "calls": 1}
            raise exc
        numbers = [int(line.split(".")[0]) for line in user.splitlines() if line[:1].isdigit()]
        river_n = int(user.split("TODAY'S RIVER (")[1].split(" ")[0])
        answer = self.plan(numbers, river_n, schema) if self.plan else {}
        return answer, {"in": 4000, "out": 900, "calls": 1}


def take_all(numbers, river_n, schema):
    new = [n for n in numbers if n >= river_n]
    answer = {"add": new[:cw.ADD_MAX], "lead": new[0] if new else -1,
              "lead_why": "The one to read first." if new else "", "drop": []}
    if "picks" in schema["properties"]:
        answer["picks"] = [{"i": n, "why": f"Reason {n}."} for n in numbers[:cw.PICK_COUNT]]
    return answer


class Workdir(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = self.tmp.name
        self.pulse_path = os.path.join(self.data, "pulse.json")
        self.write_pulse(pulse())
        self.env = mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "test"}, clear=False)
        self.env.start()
        os.environ.pop("ANTHROPIC_API_KEY", None)
        # never write a test's fake costs into a real Actions run's summary
        os.environ.pop("GITHUB_STEP_SUMMARY", None)
        self.quiet = (redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()))
        for stream in self.quiet:
            stream.__enter__()

    def tearDown(self):
        for stream in reversed(self.quiet):
            stream.__exit__(None, None, None)
        self.env.stop()
        self.tmp.cleanup()

    def write_pulse(self, payload):
        wc.write_json(self.pulse_path, payload)

    def run_curate(self, stub, now=NOW):
        args = SimpleNamespace(data_dir=self.data, pulse=self.pulse_path)
        with mock.patch.object(wc, "ask_json", stub), mock.patch.object(wc, "utcnow", return_value=now):
            return cw.run(args)

    def today(self):
        return wc.load_json(os.path.join(self.data, "wire-today.json"), None)


class IndexMappingTests(Workdir):
    def test_first_run_builds_the_paper(self):
        stub = Stub(take_all)
        self.assertEqual(self.run_curate(stub), 0)
        day = self.today()
        self.assertEqual(day["date"], "2026-10-16")
        self.assertFalse(day["final"])
        self.assertEqual(len(day["updates"]), 1)
        update = day["updates"][0]
        self.assertEqual((update["key"], update["label"], update["time"]), ("afternoon", "Afternoon", "2:10 pm"))
        # the lead is also pick #1 here, so it carries that pick's reason
        self.assertEqual(update["lead"]["why"], day["picks"][0]["why"])
        self.assertEqual(update["items"][0]["id"], update["lead"]["id"])     # the lead leads
        self.assertEqual(day["count"], 18)                                  # picks joined the river
        self.assertEqual(len(day["picks"]), 18)
        self.assertEqual(day["counts"]["everything"]["all"], 18)
        self.assertEqual(day["counts"]["local"]["all"], 12)
        self.assertEqual(day["status"]["x"]["reason"], "no WIRE_INBOX_TOKEN secret")
        self.assertEqual(day["status"]["facebook"]["reason"], "the inbox reader is not live yet")
        self.assertEqual(set(day["status"]), {"x", "facebook", "reddit"})
        self.assertEqual(day["sources"]["wcax"], {"name": "WCAX", "ch": "local",
                                                  "site": "https://www.wcax.com/"})
        self.assertEqual(set(day["sources"]), {"wcax", "vtd", "ap"})
        self.assertNotIn("model", json.dumps(day))

    def test_every_output_item_is_a_real_item_verbatim(self):
        self.run_curate(Stub(take_all))
        day = self.today()
        real = {item["u"]: item["t"] for item in pulse()["items"]}
        for item in cw.river(day) + day["picks"]:
            self.assertEqual(real[item["url"]], item["title"])
            for key in ("id", "ch", "local", "src", "name", "title", "url", "posted_at"):
                self.assertIn(key, item)
            self.assertFalse(any(key.startswith("_") or key == "d" for key in item), item)

    def test_bad_indices_are_dropped(self):
        def plan(numbers, river_n, schema):
            return {"add": [999, -1, "3", True, numbers[0], numbers[0]], "lead": 999,
                    "lead_why": "x", "drop": [5000],
                    "picks": [{"i": 999, "why": "no"}, {"i": numbers[1], "why": "z" * 300},
                              {"i": numbers[1], "why": "again"}, {"i": numbers[2], "why": ""}]}
        self.run_curate(Stub(plan))
        day = self.today()
        self.assertEqual(day["count"], 2)                    # numbers[0] once, plus the pick
        self.assertIsNone(day["updates"][0]["lead"])         # 999 is not an item
        self.assertEqual(len(day["picks"]), 1)
        self.assertLessEqual(len(day["picks"][0]["why"]), cw.WHY_MAX)
        self.assertTrue(day["picks"][0]["why"].endswith("…"))

    def test_ten_local_picks_are_possible(self):
        self.run_curate(Stub(take_all))
        local = [pick for pick in self.today()["picks"] if pick["local"]]
        self.assertGreaterEqual(len(local), 10)

    def test_prompt_numbers_and_verbatim_headlines(self):
        stub = Stub(take_all)
        self.run_curate(stub)
        system, user, schema = stub.prompts[0]
        self.assertIn("What matters today", system)      # the doctrine
        self.assertIn("never write, shorten or", system)
        self.assertIn("· Local headline 0", user)
        self.assertIn("NATIONAL · world · AP", user)
        self.assertIn("picks", schema["properties"])


class RiverMergeTests(Workdir):
    def test_second_hour_adds_a_new_update_and_keeps_picks(self):
        self.run_curate(Stub(take_all))
        first = self.today()
        later = NOW + timedelta(hours=4)                 # 6:10 pm: Evening
        self.write_pulse(pulse(n_local=3, n_world=0, start=50))
        stub = Stub(take_all)
        self.run_curate(stub, now=later)
        day = self.today()
        self.assertEqual([u["key"] for u in day["updates"]], ["evening", "afternoon"])
        self.assertEqual(day["count"], first["count"] + 3)
        # picks stand between re-ranks (4h < PICKS_EVERY_HOURS)
        self.assertEqual([p["id"] for p in day["picks"]], [p["id"] for p in first["picks"]])
        self.assertNotIn("picks", stub.prompts[0][2]["properties"])

    def test_passed_items_are_not_offered_again(self):
        def add_none(numbers, river_n, schema):
            return {"add": [], "lead": -1, "lead_why": "", "drop": [],
                    "picks": [{"i": n, "why": "R."} for n in numbers[:8]]}
        self.run_curate(Stub(add_none))
        stub = Stub(take_all)
        self.run_curate(stub, now=NOW + timedelta(minutes=60))
        # everything was shown once already: a quiet hour, no call
        self.assertEqual(stub.prompts, [])
        self.assertEqual(self.today()["count"], 8)

    def test_river_never_passes_the_cap_and_protects_picks_and_leads(self):
        self.write_pulse(pulse(n_local=60, n_world=40))
        with mock.patch.object(cw, "ADD_MAX", 100):
            self.run_curate(Stub(take_all))
            day = self.today()
            self.assertLessEqual(day["count"], cw.RIVER_MAX)
            ids = {item["id"] for item in cw.river(day)}
            self.assertTrue({pick["id"] for pick in day["picks"]} <= ids)
            self.assertTrue(all(u["lead"]["id"] in ids for u in day["updates"] if u["lead"]))


class HouseRuleTests(Workdir):
    def test_the_briefs_own_edition_always_runs(self):
        payload = pulse()
        payload["sources"].append({"id": "btown-brief", "name": "Btown Brief", "short": "Btown Brief",
                                   "site": "https://www.btownbrief.com/", "topic": "local", "local": 1})
        payload["items"].append({"t": "Friday, October 16th", "u": "https://www.btownbrief.com/p/friday",
                                 "d": NOW_TS - 7 * 3600, "s": "btown-brief"})
        self.write_pulse(payload)

        def skip_it(numbers, river_n, schema):
            answer = take_all(numbers, river_n, schema)
            answer["add"] = answer["add"][:3]
            answer["picks"] = answer["picks"][:8]
            return answer
        self.run_curate(Stub(skip_it))
        own = [item for item in cw.river(self.today()) if item.get("own")]
        self.assertEqual(len(own), 1)
        self.assertEqual((own[0]["ch"], own[0]["title"]), ("newsletters", "Friday, October 16th"))

    def test_the_briefs_own_edition_is_never_a_pick(self):
        payload = pulse()
        payload["sources"].append({"id": "btown-brief", "name": "Btown Brief", "short": "Btown Brief",
                                   "site": "https://www.btownbrief.com/", "topic": "local", "local": 1})
        payload["items"] += [
            {"t": "Friday, the early edition", "u": "https://www.btownbrief.com/p/friday-early",
             "d": NOW_TS - 9 * 3600, "s": "btown-brief"},
            {"t": "Friday, October 16th", "u": "https://www.btownbrief.com/p/friday",
             "d": NOW_TS - 7 * 3600, "s": "btown-brief"},
        ]
        self.write_pulse(payload)

        def rank_own_first(numbers, river_n, schema):
            answer = take_all(numbers, river_n, schema)
            own = [n for n in numbers if "Btown Brief" in lines[n]]
            answer["picks"] = [{"i": n, "why": "The Brief, first."} for n in own] + answer["picks"]
            return answer
        lines = {}

        class Peek(Stub):
            def __call__(self, engine, system, user, schema, *a, **k):
                for row in user.splitlines():
                    if row[:1].isdigit():
                        lines[int(row.split(".")[0])] = row
                return super().__call__(engine, system, user, schema, *a, **k)
        stub = Peek(rank_own_first)
        self.run_curate(stub)
        day = self.today()
        # the editor was told, and its answer was overruled anyway
        self.assertIn("river only (the Brief's own edition", stub.prompts[0][1])
        self.assertTrue(day["picks"])
        self.assertFalse([pick for pick in day["picks"] if pick.get("own")])
        self.assertEqual([pick["rank"] for pick in day["picks"]], list(range(1, len(day["picks"]) + 1)))
        # the newest own edition rides on top; both stay in the river
        self.assertEqual(day["brief"]["title"], "Friday, October 16th")
        self.assertTrue(day["brief"]["own"])
        self.assertEqual(len([item for item in cw.river(day) if item.get("own")]), 2)

    def test_standing_picks_lose_an_own_edition_and_close_ranks(self):
        day = cw.empty_day("2026-10-16")
        own = {"id": "b1", "ch": "newsletters", "local": True, "src": "btown-brief", "name": "Btown Brief",
               "title": "Friday", "url": "https://www.btownbrief.com/p/f", "posted_at": "2026-10-16T11:00:00+00:00",
               "own": True}
        other = {"id": "a1", "ch": "local", "local": True, "src": "wcax", "name": "WCAX", "title": "Other",
                 "url": "https://a.com/1", "posted_at": "2026-10-16T12:00:00+00:00"}
        day["updates"] = [{"key": "midday", "label": "Midday", "items": [own, other]}]
        day["picks"] = [dict(own, rank=1, why="x"), dict(other, rank=2, why="y")]
        cw.finish(day, pulse(), NOW, changed=False)
        self.assertEqual([(p["id"], p["rank"]) for p in day["picks"]], [("a1", 1)])
        self.assertEqual(day["brief"]["id"], "b1")
        day["updates"][0]["items"] = [other]
        cw.finish(day, pulse(), NOW, changed=False)
        self.assertNotIn("brief", day)

    def test_the_cap_never_drops_the_briefs_own_edition(self):
        def mk(n, own=False):
            item = {"id": f"r{n}", "ch": "local", "local": True, "src": "wcax", "name": "WCAX",
                    "title": f"Headline {n}", "url": f"https://a.com/{n}",
                    "posted_at": f"2026-10-16T{(n % 12):02d}:00:00+00:00"}
            if own:
                item.update(src="btown-brief", name="Btown Brief", own=True, ch="newsletters",
                            posted_at="2026-10-16T00:00:00+00:00")   # the oldest thing in the river
            return item
        river_now = [mk(0, own=True)] + [mk(n) for n in range(1, cw.RIVER_MAX)]
        day = cw.empty_day("2026-10-16")
        day["updates"] = [{"key": "midday", "label": "Midday", "time": "12:10 pm", "updated": "x",
                           "lead": None, "items": [dict(item) for item in river_now]}]
        new = [dict(mk(1000 + n), d=NOW_TS, _score=5) for n in range(20)]
        numbered = [dict(item, d=NOW_TS, _score=5) for item in river_now]
        cw.apply_answer(day, {"add": list(range(cw.RIVER_MAX, cw.RIVER_MAX + 20)), "drop": []},
                        numbered, new, False, wc.et_now(NOW), NOW)
        self.assertEqual(len(cw.river(day)), cw.RIVER_MAX)
        self.assertTrue([item for item in cw.river(day) if item.get("own")])
        cw.finish(day, pulse(), NOW, changed=True)
        self.assertEqual(day["brief"]["id"], "r0")

    def test_a_reddit_post_that_only_links_an_outlet_is_that_article(self):
        payload = pulse()
        payload["sources"].append({"id": "r-burlington", "name": "r/burlington", "short": "r/burlington",
                                   "site": "https://www.reddit.com/r/burlington/", "topic": "local", "local": 1})
        payload["items"] += [
            {"t": "Local headline 0", "u": "https://www.reddit.com/r/burlington/comments/a/x/",
             "d": NOW_TS - 60, "s": "r-burlington", "o": "https://www.wcax.com/2026/10/16/x"},
            {"t": "Repair Cafe Saturday!", "u": "https://www.reddit.com/r/burlington/comments/b/y/",
             "d": NOW_TS - 90, "s": "r-burlington", "o": "https://www.facebook.com/share/1"},
        ]
        titles = [(i["ch"], i["title"]) for i in wc.wire_items(payload, NOW_TS, 26)]
        self.assertNotIn(("reddit", "Local headline 0"), titles)
        self.assertIn(("reddit", "Repair Cafe Saturday!"), titles)

    def test_first_update_of_the_day_can_catch_up(self):
        self.write_pulse(pulse(n_local=cw.NEW_MAX_LOCAL, n_world=0))
        self.run_curate(Stub(lambda numbers, river_n, schema: dict(
            take_all(numbers, river_n, schema), add=[n for n in numbers if n >= river_n])))
        self.assertEqual(self.today()["count"], cw.ADD_MAX_FIRST)

    def test_between_re_ranks_the_editor_sees_only_the_newest_river(self):
        items = [{"id": f"i{k}", "posted_at": f"2026-10-16T{k % 24:02d}:00:00+00:00"} for k in range(100)]
        shown = cw.shown_river(items, {"i0"}, want_picks=False)
        self.assertEqual(len(shown), cw.RIVER_SHOWN_HOURLY + 1)       # newest 60 plus the current update
        self.assertIn("i0", {entry["id"] for entry in shown})
        self.assertEqual(len(cw.shown_river(items, set(), want_picks=True)), 100)   # a re-rank sees all
        shown = [item(k, f"Burlington story {k}") for k in range(3)]
        text = cw.build_prompt(shown, [], [], [], False, wc.et_now(NOW), "Afternoon", NOW_TS, total=100)
        self.assertIn("TODAY'S RIVER (3 shown of 100 items, the newest):", text)


def item(n, title, ch="local", local=True, src=None, topic=None, region=None, comments=None):
    out = {"id": f"i{n}", "ch": ch, "local": local, "src": src or f"s{n}", "name": f"S{n}",
           "title": title, "url": f"https://x.example/{n}", "posted_at": NOW.isoformat(),
           "d": NOW_TS - n, "_score": 5}
    if topic:
        out["topic"] = topic
    if comments is not None:
        out["comments"] = comments
    return cw.annotate(out) if region is None else dict(out, region=region)


class FableRuleTests(unittest.TestCase):
    """The six defects in the first front page, each now enforced in code."""

    def test_crime_gate(self):
        burglary = item(1, "Police searching for suspect in Winooski market burglary", topic="public-safety")
        self.assertEqual(wc.pick_block(burglary), "a single crime or court story")
        self.assertIn("river only (a single crime or court story)", cw.line(0, burglary, NOW_TS))
        closure = item(2, "Route 2 closed in Richmond after a crash; driver charged")
        self.assertIsNone(wc.pick_block(closure))
        for title in ("Former Vermont therapist convicted of Medicaid fraud",
                      "Animal cruelty charges for Vermont man", "Parents file lawsuit against driver"):
            self.assertTrue(wc.pick_block(item(3, title)), title)

    def test_threads_need_a_real_conversation_and_stay_below_five(self):
        quiet = item(1, "Monkey House (And Other Winooski Music Venues)", ch="reddit")
        self.assertEqual(wc.pick_block(quiet), "a thread with no comment count")
        self.assertIn("comments unknown", cw.line(0, quiet, NOW_TS))
        self.assertTrue(wc.pick_block(item(2, "Parking at the Flynn?", ch="reddit", comments=6)))
        talked = [item(10 + k, f"Thread {k} about Burlington", ch="reddit", comments=50, src=f"r{k}")
                  for k in range(3)]
        news = [item(20 + k, f"Burlington story {k}", src=f"n{k}") for k in range(8)]
        ranked = cw.order_picks(talked + news)
        positions = [i for i, pick in enumerate(ranked) if pick["ch"] == "reddit"]
        self.assertEqual(len(positions), wc.THREAD_PICKS_MAX)
        self.assertTrue(all(i >= wc.THREAD_TOP_RANK - 1 for i in positions), positions)

    def test_local_is_the_subject_not_the_outlet(self):
        vox = item(1, "Vermont once dreamed of universal healthcare. This Democrat wants to try again",
                   ch="world", local=False, src="vox-all")
        self.assertEqual((vox["ch"], vox["local"]), ("local", True))
        claremont = item(2, "Claremont mayor under police investigation", src="wcax")
        self.assertEqual((claremont["ch"], claremont["local"]), ("world", False))
        self.assertEqual(wc.pick_block(claremont), "out of state")
        post = item(3, "Frost advisory for Burlington tonight", ch="x")
        self.assertEqual(post["ch"], "x")                    # a post keeps its kind

    def test_geography_order_and_gate(self):
        barre = item(1, "Millions in funding announced to rebuild Barre's North End", topic="housing")
        self.assertEqual(barre["town"], "Barre")
        self.assertEqual(wc.pick_block(barre), "outside the Burlington area")
        self.assertIn("Barre (outside the Burlington area)", cw.line(0, barre, NOW_TS))
        notch = item(2, "Smugglers’ Notch road off-limits to leaf peepers this weekend",
                     topic="transportation")
        self.assertIsNone(wc.pick_block(notch))              # a weekend plan may stay
        feature = item(3, "Horse logging, a 200-year Vermont tradition", topic="environment")
        rate = item(4, "Vermont regulators finalize rate increase for every GMP customer",
                    topic="economy")
        btv = [item(10 + k, f"Burlington council story {k}", topic="city-government", src=f"b{k}")
               for k in range(3)]
        ranked = cw.order_picks([notch, feature, rate] + btv)
        titles = [pick["title"] for pick in ranked]
        self.assertEqual(titles[-1], notch["title"])         # below every Burlington story
        self.assertLess(titles.index(rate["title"]), titles.index(feature["title"]))
        self.assertTrue(all(titles.index(b["title"]) < titles.index(feature["title"]) for b in btv))

    def test_display_names(self):
        self.assertEqual(wc.display_name({"id": "top-news-amp-analysis", "short": "Top News &amp…",
                                          "name": "Top News &amp; Analysis"}), "Top News & Analysis")
        self.assertEqual(wc.display_name({"id": "local-news-2310", "short": "Vermont Public",
                                          "name": "Local News"}), "Vermont Public")


class ReasonPassTests(unittest.TestCase):
    def day(self, why):
        return {"picks": [{"id": "a", "title": "VSP provides update on investigation into Williston police shooting",
                           "why": why},
                          {"id": "b", "title": "Vermont regulators finalize 5.5% rate increase",
                           "why": "What it adds to every household's bill."}],
                "updates": []}

    def stub(self, rewrites):
        calls = []

        def ask(engine, system, user, schema, max_tokens, attempts=2, log_prefix=""):
            calls.append(user)
            return {"rewrites": rewrites}, {"in": 10, "out": 5, "calls": 1}
        return ask, calls

    def test_restatement_is_rewritten(self):
        day = self.day("State police update on a police shooting in Williston.")
        ask, calls = self.stub([{"i": 0, "why": "A shooting by officers in a town next door; answers are coming."}])
        usage, rewritten, emptied = cw.polish_reasons(day, {"provider": "anthropic"}, True, ask)
        self.assertIn("0. MUST · VSP provides", calls[0])
        self.assertNotIn("1. MUST", calls[0])
        self.assertEqual((rewritten, emptied), (1, 0))
        self.assertTrue(day["picks"][0]["why"].startswith("A shooting by officers"))

    def test_a_rewrite_that_still_restates_ships_empty(self):
        day = self.day("State police update on a police shooting in Williston.")
        ask, _ = self.stub([{"i": 0, "why": "Williston police shooting investigation update."}])
        _, rewritten, emptied = cw.polish_reasons(day, {"provider": "anthropic"}, True, ask)
        self.assertEqual((rewritten, emptied), (0, 1))
        self.assertEqual(day["picks"][0]["why"], "")
        self.assertEqual(day["picks"][1]["why"], "What it adds to every household's bill.")

    def test_paraphrase_caught_by_the_model_is_accepted(self):
        day = self.day("Answers about a shooting by officers next door.")
        ask, _ = self.stub([{"i": 1, "why": "Every household's bill goes up with it."}])
        _, rewritten, emptied = cw.polish_reasons(day, {"provider": "anthropic"}, True, ask)
        self.assertEqual((rewritten, emptied), (1, 0))

    def test_a_critique_is_never_shipped_as_a_reason(self):
        """Seen live on 2026-10-16: the pass returned its verdict as the reason."""
        day = self.day("State police update on a police shooting in Williston.")
        ask, _ = self.stub([{"i": 0, "problem": "restates",
                             "why": "Paraphrases the headline; only swaps Williston for a suburb."},
                            {"i": 1, "problem": "fine", "why": "Marked MUST; adds nothing new."}])
        _, rewritten, emptied = cw.polish_reasons(day, {"provider": "anthropic"}, True, ask)
        self.assertEqual((rewritten, emptied), (0, 1))
        self.assertEqual(day["picks"][0]["why"], "")                      # the restatement goes
        self.assertEqual(day["picks"][1]["why"], "What it adds to every household's bill.")

    def test_a_lead_that_is_a_pick_is_sent_once_and_shares_the_reason(self):
        day = self.day("State police update on a police shooting in Williston.")
        day["updates"] = [{"lead": {"id": "a", "why": "State police update on a police shooting in Williston."},
                           "items": [{"id": "a", "title": day["picks"][0]["title"]}]}]
        ask, calls = self.stub([{"i": 0, "problem": "restates",
                                 "why": "Officers fired in a town next door; what comes next matters."}])
        cw.polish_reasons(day, {"provider": "anthropic"}, True, ask)
        self.assertEqual(calls[0].count("VSP provides"), 1)
        self.assertEqual(day["updates"][0]["lead"]["why"], day["picks"][0]["why"])

    def test_a_failed_pass_still_empties_restatements(self):
        day = self.day("State police update on a police shooting in Williston.")

        def broken(*args, **kwargs):
            raise wc.ModelError("overloaded")
        _, _, emptied = cw.polish_reasons(day, {"provider": "anthropic"}, True, broken)
        self.assertEqual((emptied, day["picks"][0]["why"]), (1, ""))

    def test_an_invented_fact_gets_one_rewrite_naming_the_word(self):
        """Seen live on 2026-10-16, pick 7: neither "free" nor "UVM" is in its headline."""
        title = "Center for Research on Vermont hosts revolutionary war history panel"
        why = "A free UVM evening on Vermont's Revolutionary history."
        self.assertEqual(cw.invented(why, title, "Vermont Biz"), "free")
        self.assertEqual(cw.invented("A UVM evening on Vermont's Revolutionary history.", title), "UVM")
        day = {"picks": [{"id": "a", "title": title, "name": "UVM Today", "why": why}], "updates": []}
        ask, calls = self.stub([{"i": 0, "problem": "free is not in it",
                                 "why": "An evening on what the war looked like from Vermont."}])
        _, rewritten, emptied = cw.polish_reasons(day, {"provider": "anthropic"}, True, ask)
        self.assertIn('0. MUST (invented: "free") · Center for Research', calls[0])
        self.assertEqual((rewritten, emptied), (1, 0))
        self.assertEqual(day["picks"][0]["why"], "An evening on what the war looked like from Vermont.")

    def test_an_invented_fact_the_rewrite_keeps_ships_empty(self):
        title = "Center for Research on Vermont hosts revolutionary war history panel"
        day = {"picks": [{"id": "a", "title": title, "why": "A free UVM evening on Vermont's Revolutionary history."}],
               "updates": []}
        ask, _ = self.stub([{"i": 0, "problem": "", "why": "A free evening of history talk for anyone curious."}])
        _, rewritten, emptied = cw.polish_reasons(day, {"provider": "anthropic"}, True, ask)
        self.assertEqual((rewritten, emptied, day["picks"][0]["why"]), (0, 1, ""))

    def test_may_and_march_as_verbs_are_not_months(self):
        title = "Burlington council weighs a new parking plan"
        self.assertIsNone(cw.invented("The plan may raise what you pay downtown.", title))
        self.assertIsNone(cw.invented("Students march downtown before the vote.", title + " as students rally downtown"))
        self.assertIsNone(cw.invented("May end the first hour you count on.", title))
        self.assertEqual(cw.invented("The vote comes in March, after the budget.", title), "March")
        self.assertEqual(cw.invented("May 3 is when the new rates start.", title), "May")
        self.assertEqual(cw.invented("It could start in may.", title + " in March"), None)
        self.assertEqual(cw.invented("The vote comes in March.", title + " in March"), None)

    def test_a_reason_that_reuses_the_headlines_number_is_fine(self):
        title = "New $4.95M investment to strengthen suicide care across Vermont"
        self.assertIsNone(cw.invented("The $4.95M reaches crisis lines Burlington callers use.", title))
        self.assertIsNone(cw.invented("Heating oil follows it toward $110.", "Oil prices jump sharply, to nearly $110 per barrel"))
        self.assertEqual(cw.invented("Heating oil follows it toward $120.", "Oil prices jump sharply, to nearly $110 per barrel"), "$120")
        self.assertIsNone(cw.invented("First look at the team this season, at home Saturday.",
                                      "Men's Basketball Hosts Holy Cross in Exhibition Saturday Afternoon"))
        self.assertEqual(cw.invented("Tickets go on sale Friday.", "The Flynn adds a second show"), "Friday")
        day = {"picks": [{"id": "a", "title": title, "why": "The $4.95M reaches crisis lines Burlington callers use."}],
               "updates": []}
        ask, calls = self.stub([])
        _, rewritten, emptied = cw.polish_reasons(day, {"provider": "anthropic"}, True, ask)
        self.assertNotIn("MUST", calls[0])
        self.assertEqual((rewritten, emptied), (0, 0))

    def test_no_call_when_only_a_clean_lead_is_due(self):
        day = {"picks": [], "updates": [{"lead": {"id": "a", "why": "Your bill, the next time it comes."},
                                         "items": [{"id": "a", "title": "Rates finalized"}]}]}
        ask, calls = self.stub([])
        self.assertEqual(cw.polish_reasons(day, {"provider": "anthropic"}, False, ask), (None, 0, 0))
        self.assertEqual(calls, [])


class CapTests(Workdir):
    def test_an_all_local_river_still_stops_at_the_cap(self):
        """Codex's repro: a full all-local river, 20 more, no drops from the
        model. Run at a cap of 80 to keep the fixture small; the rule is the
        same at the real cap."""
        self.write_pulse(pulse(n_local=80, n_world=0))
        cap = mock.patch.object(cw, "RIVER_MAX", 80)
        cap.start()
        self.addCleanup(cap.stop)
        with mock.patch.object(cw, "ADD_MAX_FIRST", 80), mock.patch.object(cw, "NEW_MAX_LOCAL", 100):
            self.run_curate(Stub(lambda numbers, river_n, schema: dict(
                take_all(numbers, river_n, schema), add=[n for n in numbers if n >= river_n][:80])))
        self.assertEqual(self.today()["count"], 80)
        payload = pulse(n_local=20, n_world=0, start=500)
        for item in payload["items"]:
            item["d"] = NOW_TS + 3000
        self.write_pulse(payload)
        self.run_curate(Stub(lambda numbers, river_n, schema: dict(
            take_all(numbers, river_n, schema), drop=[])), now=NOW + timedelta(hours=1))
        day = self.today()
        self.assertEqual(day["count"], cw.RIVER_MAX)
        ids = {item["id"] for item in cw.river(day)}
        self.assertTrue({pick["id"] for pick in day["picks"]} <= ids)

    def test_no_more_than_ten_national_picks(self):
        self.write_pulse(pulse(n_local=6, n_world=20))

        def national_first(numbers, river_n, schema):
            answer = take_all(numbers, river_n, schema)
            answer["picks"] = [{"i": n, "why": "R."} for n in numbers[6:26]] + \
                              [{"i": n, "why": "R."} for n in numbers[:5]]
            return answer
        self.run_curate(Stub(national_first))
        picks = self.today()["picks"]
        self.assertEqual(sum(1 for pick in picks if not pick["local"]), cw.NATIONAL_PICKS)
        self.assertEqual(sum(1 for pick in picks if pick["local"]), 5)


class FreezeTests(Workdir):
    def test_midnight_freezes_yesterday_and_starts_fresh(self):
        self.run_curate(Stub(take_all))
        yesterday = self.today()
        after_midnight = datetime(2026, 10, 17, 4, 20, tzinfo=timezone.utc)   # 12:20 am Eastern
        stub = Stub(take_all)
        self.assertEqual(self.run_curate(stub, now=after_midnight), 0)
        frozen = wc.load_json(os.path.join(self.data, "wire", "2026-10-16.json"), None)
        self.assertTrue(frozen["final"])
        self.assertEqual(frozen["count"], yesterday["count"])
        self.assertEqual(frozen["picks"], yesterday["picks"])
        index = wc.load_json(os.path.join(self.data, "wire", "index.json"), None)
        self.assertEqual(index["editions"][0]["date"], "2026-10-16")
        today = self.today()
        self.assertEqual(today["date"], "2026-10-17")
        self.assertEqual(today["count"], 0)
        self.assertEqual(stub.prompts, [])          # overnight: the editor sleeps

    def test_yesterdays_items_are_never_re_served(self):
        self.run_curate(Stub(take_all))
        morning = datetime(2026, 10, 17, 11, 10, tzinfo=timezone.utc)        # 7:10 am Eastern
        self.write_pulse(dict(pulse(), generated=morning.isoformat()))
        # same items, still inside the 26h window; plus three fresh ones
        payload = pulse()
        payload["items"] += pulse(n_local=10, n_world=0, start=200)["items"]
        for item in payload["items"][-10:]:
            item["d"] = int(morning.timestamp()) - 600
        self.write_pulse(payload)
        stub = Stub(take_all)
        self.run_curate(stub, now=morning)
        offered = stub.prompts[0][1]
        self.assertNotIn("Local headline 0\n", offered + "\n")
        self.assertIn("Local headline 200", offered)
        self.assertIn("ALREADY RAN", offered)
        day = self.today()
        self.assertTrue(all(int(item["url"].rsplit("/", 1)[1]) >= 200 for item in cw.river(day)))

    def test_freeze_survives_a_dead_model(self):
        self.run_curate(Stub(take_all))
        after_midnight = datetime(2026, 10, 17, 10, 20, tzinfo=timezone.utc)  # 6:20 am
        self.write_pulse(pulse(n_local=5, n_world=0, start=300))
        payload = wc.load_json(self.pulse_path, {})
        for item in payload["items"]:
            item["d"] = int(after_midnight.timestamp()) - 300
        self.write_pulse(payload)
        self.assertEqual(self.run_curate(Stub(error="HTTP 529"), now=after_midnight), 0)
        self.assertTrue(os.path.exists(os.path.join(self.data, "wire", "2026-10-16.json")))
        self.assertEqual(self.today()["date"], "2026-10-17")

    def test_archive_keeps_thirty_days(self):
        for back in (1, 29, 30, 31, 45):
            date = (datetime(2026, 10, 16) - timedelta(days=back)).date().isoformat()
            wc.write_json(os.path.join(self.data, "wire", f"{date}.json"), cw.empty_day(date))
        editions = cw.prune_and_index(self.data, "2026-10-16")
        self.assertEqual([e["date"] for e in editions], ["2026-10-15", "2026-09-17", "2026-09-16"])


class FailurePostureTests(Workdir):
    def test_api_failure_keeps_the_last_good_file(self):
        self.run_curate(Stub(take_all))
        with open(os.path.join(self.data, "wire-today.json")) as src:
            before = src.read()
        self.write_pulse(pulse(n_local=4, n_world=0, start=90))
        payload = wc.load_json(self.pulse_path, {})
        for item in payload["items"]:
            item["d"] = NOW_TS + 3000
        self.write_pulse(payload)
        code = self.run_curate(Stub(error="overloaded"), now=NOW + timedelta(hours=1))
        self.assertEqual(code, 0)
        with open(os.path.join(self.data, "wire-today.json")) as src:
            self.assertEqual(src.read(), before)
        ledger = wc.load_json(os.path.join(self.data, "wire-cost.json"), {})
        self.assertEqual(ledger["runs"][-1]["in"], 500)     # a failed call is still billed

    def test_stale_paper_fails_the_run(self):
        self.run_curate(Stub(take_all))
        payload = pulse(n_local=4, n_world=0, start=90)
        for item in payload["items"]:
            item["d"] = NOW_TS + 5 * 3600 - 300
        self.write_pulse(payload)
        with self.assertRaises(SystemExit) as caught:
            self.run_curate(Stub(error="overloaded"), now=NOW + timedelta(hours=5))
        self.assertIn("last checked 5.0h ago", str(caught.exception))

    def test_quiet_hour_stamps_checked_without_a_call(self):
        self.run_curate(Stub(take_all))
        stub = Stub(take_all)
        self.assertEqual(self.run_curate(stub, now=NOW + timedelta(hours=3)), 0)
        self.assertEqual(stub.prompts, [])
        day = self.today()
        self.assertEqual(day["checked"], (NOW + timedelta(hours=3)).isoformat())
        self.assertEqual(day["updated"], NOW.isoformat())

    def test_no_key_changes_nothing(self):
        os.environ.pop("OPENROUTER_API_KEY")
        stub = Stub(take_all)
        self.assertEqual(self.run_curate(stub), 0)
        self.assertEqual(stub.prompts, [])
        self.assertIsNone(self.today())

    def test_month_cap_refuses(self):
        wc.write_json(os.path.join(self.data, "wire-cost.json"),
                      {"v": 1, "month": "2026-10", "usd": wc.MONTH_CAP_USD + 0.01, "runs": []})
        stub = Stub(take_all)
        self.assertEqual(self.run_curate(stub), 0)
        self.assertEqual(stub.prompts, [])

    def test_last_months_spend_does_not_count(self):
        wc.write_json(os.path.join(self.data, "wire-cost.json"),
                      {"v": 1, "month": "2026-09", "usd": 99.0, "runs": []})
        stub = Stub(take_all)
        self.run_curate(stub)
        self.assertEqual(len(stub.prompts), 1)

    def test_costs_are_logged(self):
        self.run_curate(Stub(take_all))
        ledger = wc.load_json(os.path.join(self.data, "wire-cost.json"), {})
        run, reasons = ledger["runs"][-2], ledger["runs"][-1]
        self.assertEqual((run["script"], run["model"], run["in"], run["out"]),
                         ("curate_wire", wc.GLM, 4000, 900))
        self.assertEqual((reasons["script"], reasons["in"]), ("curate_wire (reasons)", 300))
        self.assertAlmostEqual(run["usd"], (4000 * 0.014 + 900 * 0.90) / 1e6)

    def test_garbage_answer_with_picks_due_writes_nothing(self):
        self.assertEqual(self.run_curate(Stub(lambda *a: {"add": [], "picks": []})), 0)
        self.assertIsNone(self.today())


class DecideTests(unittest.TestCase):
    def item(self, score, local=True):
        return {"local": local, "_score": score}

    def et(self, hour):
        return datetime(2026, 10, 16, hour, 10, tzinfo=wc.ET)

    def test_cadence(self):
        day = {"picks": [], "updates": []}
        new = [self.item(5)] * 10
        self.assertEqual(cw.decide(day, {}, new, self.et(3), NOW)[:2], (False, False))   # overnight
        self.assertEqual(cw.decide(day, {}, new, self.et(7), NOW)[:2], (True, True))     # first picks
        day = {"picks": [{}], "updates": []}
        state = {"picks_at": (NOW - timedelta(hours=1)).isoformat()}
        self.assertEqual(cw.decide(day, state, new, self.et(9), NOW)[:2], (True, False))  # additions
        self.assertEqual(cw.decide(day, state, [self.item(9)], self.et(9), NOW)[:2], (True, True))
        self.assertEqual(cw.decide(day, state, [self.item(9)], self.et(2), NOW)[:2], (True, True))
        self.assertEqual(cw.decide(day, state, [self.item(2, False)], self.et(9), NOW)[:2], (False, False))
        # picks are due once PICKS_EVERY_HOURS have passed (three a day), not an hour sooner
        state = {"picks_at": (NOW - timedelta(hours=cw.PICKS_EVERY_HOURS - 1)).isoformat()}
        self.assertEqual(cw.decide(day, state, new, self.et(12), NOW)[:2], (True, False))
        state = {"picks_at": (NOW - timedelta(hours=cw.PICKS_EVERY_HOURS)).isoformat()}
        self.assertEqual(cw.decide(day, state, new, self.et(12), NOW)[:2], (True, True))


class TagWireRunTests(Workdir):
    def run_tag(self, stub):
        args = SimpleNamespace(data_dir=self.data, pulse=self.pulse_path)
        with mock.patch.object(wc, "ask_json", stub), mock.patch.object(wc, "utcnow", return_value=NOW):
            return tw.run(args)

    def test_tags_only_new_items_and_junk_leaves_the_pool(self):
        def plan(engine, system, user, schema, max_tokens, attempts=2, log_prefix=""):
            rows = [line for line in user.splitlines() if line[:1].isdigit()]
            tags = []
            for row in rows:
                index = int(row.split(".")[0])
                tags.append({"i": index, "junk": "promo" if "headline 3" in row else "none",
                             "local": "Local" in row, "ch": "local", "topic": "other", "score": 6})
            plan.calls += 1
            return {"tags": tags}, {"in": 1000, "out": 300, "calls": 1}
        plan.calls = 0
        self.assertEqual(self.run_tag(plan), 0)
        store = wc.load_json(os.path.join(self.data, "wire-tags.json"), {})
        self.assertEqual(len(store["tags"]), 18)
        self.assertEqual(plan.calls, 1)
        self.run_tag(plan)
        self.assertEqual(plan.calls, 1)                 # nothing new: no second call
        tags = store["tags"]
        pool = cw.apply_tags(wc.wire_items(pulse(), NOW_TS, 26), tags)
        self.assertNotIn("Local headline 3", [item["title"] for item in pool])
        self.assertNotIn("National headline 3", [item["title"] for item in pool])

    def test_tagger_outage_exits_zero_and_leaves_items_untagged(self):
        self.assertEqual(self.run_tag(Stub(error="overloaded")), 0)
        store = wc.load_json(os.path.join(self.data, "wire-tags.json"), {})
        self.assertEqual(store["tags"], {})
        # and the curator still works from mechanical defaults
        self.run_curate(Stub(take_all))
        self.assertGreater(self.today()["count"], 0)


if __name__ == "__main__":
    unittest.main()
