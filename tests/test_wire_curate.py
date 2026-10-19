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
        self.assertEqual(set(day["status"]), {"x", "facebook", "reddit", "recaps"})
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

    def newsletter_pulse(self, payload):
        payload["sources"] += [
            {"id": "semafor", "name": "Semafor", "short": "Semafor",
             "site": "https://www.semafor.com/newsletters", "topic": "newsletters"},
            {"id": "btv-daily", "name": "BTV Daily", "short": "BTV Daily", "site": "",
             "topic": "newsletters"}]
        payload["items"] += [
            {"t": "Anger and shame", "u": "https://semafor.com/s/abc",
             "d": NOW_TS - 2 * 3600, "s": "semafor"},
            {"t": "#BTV Daily Friday", "u": "https://us20.campaign-archive.com/?u=a&id=b",
             "d": NOW_TS - 3 * 3600, "s": "btv-daily"},
            # no public copy: nowhere to send a reader, so never in the river
            {"t": "Weekly Wrap", "u": "https://www.inoreader.com/article/1", "x": 1,
             "d": NOW_TS - 3 * 3600, "s": "btv-daily"}]
        return payload

    def test_every_linkable_newsletter_edition_runs(self):
        # Stephen, 2026-10-19: the Newsletters chip read 0 while Inoreader
        # showed fifteen. The editor skipping them no longer keeps them out.
        self.write_pulse(self.newsletter_pulse(pulse()))

        def skip_newsletters(numbers, river_n, schema):
            answer = take_all(numbers, river_n, schema)
            answer["add"] = answer["add"][:3]
            answer["picks"] = answer.get("picks", [])[:3]
            return answer
        self.run_curate(Stub(skip_newsletters))
        editions = [item for item in cw.river(self.today()) if item["ch"] == "newsletters"]
        self.assertEqual(sorted(item["title"] for item in editions),
                         ["#BTV Daily Friday", "Anger and shame"])
        self.assertEqual(self.today()["counts"]["everything"]["newsletters"], 2)
        self.assertEqual(self.today()["counts"]["local"]["newsletters"], 1)

    def test_a_quiet_hour_still_files_newsletter_editions(self):
        payload = pulse(n_local=0, n_world=0)
        self.write_pulse(self.newsletter_pulse(payload))
        stub = Stub(take_all)
        # picks ranked a minute ago and too few new items to ask about
        day = cw.empty_day("2026-10-16")
        day["picks"] = [{"id": "p", "src": "wcax", "title": "x", "rank": 1}]
        wc.write_json(os.path.join(self.data, "wire-today.json"), day)
        wc.write_json(os.path.join(self.data, "wire-state.json"),
                      {"date": "2026-10-16", "picks_at": NOW.isoformat()})
        with mock.patch.object(cw, "MIN_NEW", 10):
            self.run_curate(stub)
        self.assertEqual(stub.prompts, [])          # no model call
        editions = [item for item in cw.river(self.today()) if item["ch"] == "newsletters"]
        self.assertEqual(len(editions), 2)

    def test_yesterdays_editions_stay_out_of_today(self):
        # 2026-10-19: the 26-hour window back-filled four Sunday editions into
        # Monday's first update. An edition runs only on its own Burlington
        # day; one from after 9 pm last night still counts as this morning's.
        monday = datetime(2026, 10, 19, 11, 7, tzinfo=timezone.utc)   # 7:07 am Eastern
        ts = lambda iso: int(datetime.fromisoformat(iso).timestamp())  # noqa: E731
        payload = pulse(n_local=0, n_world=0)
        payload["sources"] += [
            {"id": "semafor", "name": "Semafor", "short": "Semafor",
             "site": "https://www.semafor.com/newsletters", "topic": "newsletters"},
            {"id": "1440", "name": "1440", "short": "1440", "site": "https://join1440.com/",
             "topic": "newsletters"}]
        payload["items"] += [
            {"t": "Sunday morning 1440", "u": "https://join1440.com/sun",
             "d": ts("2026-10-18T09:38:08+00:00"), "s": "1440"},
            {"t": "Sunday evening Semafor", "u": "https://semafor.com/s/sun",
             "d": ts("2026-10-18T22:15:33+00:00"), "s": "semafor"},
            {"t": "Late Sunday Semafor", "u": "https://semafor.com/s/late",
             "d": ts("2026-10-19T02:30:00+00:00"), "s": "semafor"},
            {"t": "Monday 1440", "u": "https://join1440.com/mon",
             "d": ts("2026-10-19T08:28:20+00:00"), "s": "1440"}]
        self.write_pulse(payload)
        self.run_curate(Stub(take_all), now=monday)
        titles = sorted(item["title"] for item in cw.river(self.today())
                        if item["ch"] == "newsletters")
        self.assertEqual(titles, ["Late Sunday Semafor", "Monday 1440"])

    def test_the_edition_window_is_last_night_9pm_to_midnight(self):
        ts = lambda iso: int(datetime.fromisoformat(iso).timestamp())  # noqa: E731
        payload = pulse(n_local=0, n_world=0)
        payload["sources"].append({"id": "1440", "name": "1440", "short": "1440",
                                   "site": "https://join1440.com/", "topic": "newsletters"})
        payload["items"] += [
            # Sunday 9:05 pm, still unfiled at Monday 11:30 pm (26h25m old)
            {"t": "Late Sunday", "u": "https://join1440.com/a", "d": ts("2026-10-19T01:05:00+00:00"),
             "s": "1440"},
            # Tuesday 12:15 am, already in the pulse at Monday 11:30 pm
            {"t": "Tuesday", "u": "https://join1440.com/b", "d": ts("2026-10-20T04:15:00+00:00"),
             "s": "1440"}]
        late_monday = datetime(2026, 10, 20, 3, 30, tzinfo=timezone.utc)
        pool = cw.candidates(payload, int(late_monday.timestamp()), wc.et_now(late_monday))
        picked, _ = cw.select_new(pool, set(), set(), set(), set(),
                                  editions_in=cw.edition_window(wc.et_now(late_monday)))
        self.assertEqual([item["title"] for item in picked], ["Late Sunday"])

    def test_editions_filed_before_the_guard_leave_todays_river(self):
        # today's paper already held five Sunday editions when the guard
        # landed; the next run takes them out (and nothing else)
        monday = datetime(2026, 10, 19, 12, 7, tzinfo=timezone.utc)   # 8:07 am Eastern
        edition = lambda n, iso: {"id": f"nl{n}", "ch": "newsletters", "local": False,  # noqa: E731
                                  "src": "1440", "name": "1440", "title": f"Edition {n}",
                                  "url": f"https://join1440.com/{n}", "posted_at": iso}
        news = {"id": "w1", "ch": "world", "local": False, "src": "ap", "name": "AP",
                "title": "National 1", "url": "https://world.example/1",
                "posted_at": "2026-10-18T22:00:00+00:00"}
        day = cw.empty_day("2026-10-19")
        day["updates"] = [{"key": "morning", "label": "Morning", "time": "7:24 am",
                           "lead": {"id": "nl1", "why": "x"},
                           "items": [edition(1, "2026-10-18T09:38:08+00:00"), news,
                                     edition(2, "2026-10-19T08:28:20+00:00")]}]
        wc.write_json(os.path.join(self.data, "wire-today.json"), day)
        wc.write_json(os.path.join(self.data, "wire-state.json"),
                      {"date": "2026-10-19", "picks_at": monday.isoformat()})
        self.write_pulse(pulse(n_local=0, n_world=0, start=0) | {"items": [
            {"t": "Old local", "u": "https://local.example/old", "d": NOW_TS, "s": "wcax"}]})
        self.run_curate(Stub(take_all), now=monday)
        after = self.today()
        self.assertEqual([item["id"] for item in cw.river(after)], ["w1", "nl2"])
        self.assertIsNone(after["updates"][0]["lead"])
        self.assertEqual((after["count"], after["counts"]["everything"]["newsletters"]), (2, 1))

    def test_the_cap_never_drops_a_filed_newsletter_edition(self):
        et = wc.et_now(NOW)
        full = [{"id": f"w{k}", "ch": "world", "local": False, "src": "ap", "name": "AP",
                 "title": f"National {k}", "url": f"https://world.example/{k}",
                 "posted_at": "2026-10-16T10:00:00+00:00"} for k in range(5)]
        day = cw.empty_day("2026-10-16")
        day["updates"] = [{"key": "morning", "label": "Morning", "items": list(full)}]
        edition = {"id": "nl", "ch": "newsletters", "local": False, "src": "semafor",
                   "name": "Semafor", "title": "Anger and shame", "url": "https://semafor.com/s/a",
                   "posted_at": "2026-10-16T09:00:00+00:00"}
        with mock.patch.object(cw, "RIVER_MAX", 5):
            result = cw.apply_answer(day, {}, cw.river(day), [edition], False, et, NOW)
        ids = [item["id"] for item in cw.river(day)]
        self.assertIn("nl", ids)
        self.assertEqual(len(ids), 5)
        self.assertEqual(result["added"], ["nl"])

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

    def test_one_list_by_importance_keeps_national_slots(self):
        # Stephen, 2026-10-17: on Everything the top five should mix local and
        # national. The tier sort reorders the local picks among the local
        # slots only; every national pick stays exactly where the editor put it.
        feature = item(1, "Horse logging, a 200-year Vermont tradition", topic="environment")
        btv = [item(10 + k, f"Burlington council story {k}", topic="city-government", src=f"b{k}")
               for k in range(3)]
        fed = item(20, "Fed holds rates steady", ch="world", local=False, src="ap")
        senate = item(21, "Senate advances the stopgap bill", ch="world", local=False, src="reuters")
        asked = [feature, fed, btv[0], senate, btv[1], btv[2]]
        ranked = cw.order_picks(asked)
        self.assertEqual([p["local"] for p in ranked], [p["local"] for p in asked])
        self.assertEqual(ranked[1]["title"], fed["title"])
        self.assertEqual(ranked[3]["title"], senate["title"])
        local = [p["title"] for p in ranked if p["local"]]
        self.assertEqual(local, [b["title"] for b in btv] + [feature["title"]])  # Burlington first
        top5 = ranked[:5]
        self.assertTrue(any(p["local"] for p in top5) and any(not p["local"] for p in top5))

    def test_a_national_lead_stays_number_one(self):
        fed = item(20, "Fed holds rates steady", ch="world", local=False, src="ap")
        btv = [item(10 + k, f"Burlington council story {k}", topic="city-government", src=f"b{k}")
               for k in range(4)]
        ranked = cw.order_picks([fed] + btv)
        self.assertEqual(ranked[0]["title"], fed["title"])

    def test_the_prompt_says_one_list(self):
        self.assertIn("single list by importance, not two lists", cw.TASK)
        doctrine = wc.read_prompt("wire-taste.md")
        self.assertIn("One list, by importance", doctrine)
        self.assertNotIn("Local first", doctrine)

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

    def test_national_picks_capped_at_the_band(self):
        self.write_pulse(pulse(n_local=6, n_world=32))

        def national_first(numbers, river_n, schema):
            answer = take_all(numbers, river_n, schema)
            answer["picks"] = [{"i": n, "why": "R."} for n in numbers[6:38]] + \
                              [{"i": n, "why": "R."} for n in numbers[:5]]
            return answer
        self.run_curate(Stub(national_first))
        picks = self.today()["picks"]
        self.assertEqual(sum(1 for pick in picks if not pick["local"]), cw.NATIONAL_PICKS)
        self.assertEqual(sum(1 for pick in picks if pick["local"]), 5)
        # the editor ranked national first, so national leads (every national
        # pick here is AP, so the outlet rule spaces them out with local ones)
        self.assertFalse(picks[0]["local"])

    def test_an_interleaved_ranking_reaches_the_page_interleaved(self):
        self.write_pulse(pulse(n_local=12, n_world=6))

        def mixed(numbers, river_n, schema):
            answer = take_all(numbers, river_n, schema)
            local, world = numbers[:12], numbers[12:18]
            order = [local[0], world[0], local[1], local[2], world[1], local[3], world[2]]
            answer["picks"] = [{"i": n, "why": "R."} for n in order]
            return answer
        self.run_curate(Stub(mixed))
        picks = self.today()["picks"]
        self.assertEqual([p["local"] for p in picks], [True, False, True, True, False, True, False])
        self.assertEqual([p["rank"] for p in picks], list(range(1, 8)))

    def test_local_picks_capped_at_the_band(self):
        self.write_pulse(pulse(n_local=32, n_world=6))

        def local_first(numbers, river_n, schema):
            answer = take_all(numbers, river_n, schema)
            answer["picks"] = [{"i": n, "why": "R."} for n in numbers[:32]] + \
                              [{"i": n, "why": "R."} for n in numbers[32:37]]
            return answer
        self.run_curate(Stub(local_first))
        picks = self.today()["picks"]
        self.assertEqual(sum(1 for pick in picks if pick["local"]), cw.LOCAL_PICKS)
        self.assertEqual(sum(1 for pick in picks if not pick["local"]), 5)


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


def titled(user):
    """number -> headline, from the numbered lines a prompt showed."""
    out = {}
    for row in user.splitlines():
        if row[:1].isdigit():
            out[int(row.split(".")[0])] = row.rsplit(" · ", 1)[1]
    return out


class Rerank(Stub):
    """Ranks every numbered line except the headlines in `leave_out`."""

    def __init__(self, leave_out=()):
        super().__init__(self.rank)
        self.leave_out = set(leave_out)

    def rank(self, numbers, river_n, schema):
        answer = take_all(numbers, river_n, schema)
        if "picks" in answer:
            titles = titled(self.prompts[-1][1])
            answer["picks"] = [{"i": n, "why": f"Reason {n}."} for n in numbers
                               if titles[n] not in self.leave_out][:cw.PICK_COUNT]
        return answer


class PicksEarlierTests(Workdir):
    """A day keeps every story the editor ranked (Stephen, 2026-10-17)."""

    def setUp(self):
        super().setUp()
        self.cadence = mock.patch.object(cw, "PICKS_EVERY_HOURS", 1)
        self.cadence.start()
        self.addCleanup(self.cadence.stop)

    def fresh_items(self, start):
        # a few new stories, so the next hour has something to rank
        self.write_pulse(pulse(n_local=3, n_world=0, start=start))

    def rerank(self, hours, leave_out=(), start=50):
        self.fresh_items(start)
        self.assertEqual(self.run_curate(Rerank(leave_out), now=NOW + timedelta(hours=hours)), 0)
        return self.today()

    def test_a_rerank_that_drops_three_moves_them_to_earlier(self):
        self.run_curate(Stub(take_all))
        first = self.today()
        self.assertEqual(first["picks_earlier"], [])
        gone = [pick["title"] for pick in first["picks"][2:5]]
        day = self.rerank(1, leave_out=gone)
        earlier = day["picks_earlier"]
        self.assertEqual([pick["title"] for pick in earlier], gone)       # by last rank
        old = {pick["id"]: pick for pick in first["picks"]}
        for pick in earlier:
            self.assertEqual(pick["rank"], old[pick["id"]]["rank"])       # its last rank
            self.assertEqual(pick["why"], old[pick["id"]]["why"])         # and its reason
            self.assertEqual(pick["ranked_at"], NOW.isoformat())          # the 2:10 ranking
        self.assertEqual({p["ranked_at"] for p in day["picks"]},
                         {(NOW + timedelta(hours=1)).isoformat()})
        self.assertFalse({p["id"] for p in earlier} & {p["id"] for p in day["picks"]})
        # newest ranking first: a later drop sorts above the 2:10 ones
        later_gone = [day["picks"][0]["title"]]
        day = self.rerank(2, leave_out=gone + later_gone, start=60)
        self.assertEqual([p["title"] for p in day["picks_earlier"]], later_gone + gone)
        ids = [p["id"] for p in day["picks_earlier"]]
        self.assertEqual(len(ids), len(set(ids)))                          # one row per story

    def test_a_story_picked_again_leaves_earlier(self):
        self.run_curate(Stub(take_all))
        gone = [pick["title"] for pick in self.today()["picks"][:3]]
        self.assertEqual(len(self.rerank(1, leave_out=gone)["picks_earlier"]), 3)
        day = self.rerank(2, leave_out=gone[1:], start=60)                 # gone[0] is back
        self.assertEqual([p["title"] for p in day["picks_earlier"]], gone[1:])
        self.assertIn(gone[0], [p["title"] for p in day["picks"]])
        self.assertFalse({p["id"] for p in day["picks_earlier"]} & {p["id"] for p in day["picks"]})

    def test_the_freeze_carries_both_and_the_index_counts_them(self):
        self.run_curate(Stub(take_all))
        gone = [pick["title"] for pick in self.today()["picks"][:7]]
        yesterday = self.rerank(1, leave_out=gone)
        self.assertEqual(len(yesterday["picks_earlier"]), 7)
        after_midnight = datetime(2026, 10, 17, 4, 20, tzinfo=timezone.utc)
        self.run_curate(Stub(take_all), now=after_midnight)
        frozen = wc.load_json(os.path.join(self.data, "wire", "2026-10-16.json"), None)
        self.assertTrue(frozen["final"])
        self.assertEqual(frozen["picks"], yesterday["picks"])
        self.assertEqual(frozen["picks_earlier"], yesterday["picks_earlier"])
        index = wc.load_json(os.path.join(self.data, "wire", "index.json"), None)
        entry = index["editions"][0]
        self.assertEqual(entry["date"], "2026-10-16")
        self.assertEqual(entry["picks"], len(yesterday["picks"]))
        self.assertEqual(entry["picks_total"], len(yesterday["picks"]) + 7)
        self.assertEqual(self.today()["picks_earlier"], [])               # the new day starts clean

    def test_the_summary_counts_the_earlier_picks(self):
        self.run_curate(Stub(take_all))
        gone = [pick["title"] for pick in self.today()["picks"][:7]]
        out = io.StringIO()
        self.fresh_items(50)
        with redirect_stdout(out):
            self.run_curate(Rerank(gone), now=NOW + timedelta(hours=1))
        self.assertRegex(out.getvalue(), r"picks \d+ \(\+7 earlier today\)")

    def test_the_cap_never_drops_an_earlier_pick(self):
        self.run_curate(Stub(take_all))
        gone = [pick["title"] for pick in self.today()["picks"][:3]]
        before = self.rerank(1, leave_out=gone)["count"]
        # a flood past the cap: the earlier picks stay river items, so counted
        flood = pulse(n_local=40, n_world=0, start=100)
        for k, item in enumerate(flood["items"]):
            item["d"] = NOW_TS + 7000 - k * 10      # newer than the picks: the oldest go first
        self.write_pulse(flood)
        with mock.patch.object(cw, "RIVER_MAX", before + 1), mock.patch.object(cw, "ADD_MAX", 40):
            self.run_curate(Rerank(gone), now=NOW + timedelta(hours=2))
        day = self.today()
        self.assertLess(day["count"], before + 40)                         # the cap did drop
        ids = {item["id"] for item in cw.river(day)}
        self.assertEqual(len(day["picks_earlier"]), 3)
        self.assertTrue({pick["id"] for pick in day["picks_earlier"]} <= ids)

    def test_retire_picks_dedupes_and_never_keeps_a_current_pick(self):
        old = [{"id": "a", "rank": 1, "ranked_at": "2026-10-16T16:00:00+00:00"},
               {"id": "b", "rank": 2, "ranked_at": "2026-10-16T16:00:00+00:00"}]
        earlier = [{"id": "b", "rank": 9, "ranked_at": "2026-10-16T10:00:00+00:00"},
                   {"id": "c", "rank": 3, "ranked_at": "2026-10-16T10:00:00+00:00"}]
        out = cw.retire_picks(old, earlier, [{"id": "a"}])
        self.assertEqual([(p["id"], p["rank"]) for p in out], [("b", 2), ("c", 3)])
        # a pick from before `ranked_at` existed takes the standing ranking's time
        out = cw.retire_picks([{"id": "z", "rank": 1}], [], [], previous_at="T")
        self.assertEqual(out[0]["ranked_at"], "T")


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

    def test_a_second_tick_in_the_hour_does_not_pay_twice(self):
        day = {"picks": [{}], "updates": []}
        new = [self.item(5)] * 10
        state = {"picks_at": (NOW - timedelta(hours=1)).isoformat(),
                 "called_at": (NOW - timedelta(minutes=20)).isoformat()}
        self.assertEqual(cw.decide(day, state, new, self.et(9), NOW)[:2], (False, False))
        self.assertEqual(cw.decide(day, state, [self.item(9)], self.et(9), NOW)[:2], (True, True))  # urgent
        state["called_at"] = (NOW - timedelta(minutes=cw.CALL_GAP_MINUTES)).isoformat()
        self.assertEqual(cw.decide(day, state, new, self.et(9), NOW)[:2], (True, False))


def rule_breaks(items):
    """Every place an update's order breaks a river rule that it could have
    kept: a fourth local (or national) in a row while the other kind waits
    further down, two from one outlet back to back while another outlet
    waits, a third X (Facebook, Reddit) post in a row while anything else
    waits."""
    breaks = []
    for k in range(1, len(items)):
        rest = items[k:]
        if k >= cw.KIND_RUN_MAX and all(bool(o["local"]) == bool(items[k]["local"])
                                        for o in items[k - cw.KIND_RUN_MAX:k]) \
                and any(bool(o["local"]) != bool(items[k]["local"]) for o in rest):
            breaks.append((k, "kind"))
        if items[k]["src"] == items[k - 1]["src"] and any(o["src"] != items[k]["src"] for o in rest):
            breaks.append((k, "outlet"))
        if items[k]["ch"] in cw.SPREAD_CHANNELS and k >= cw.POST_RUN_MAX \
                and all(o["ch"] == items[k]["ch"] for o in items[k - cw.POST_RUN_MAX:k]) \
                and any(o["ch"] != items[k]["ch"] for o in rest):
            breaks.append((k, "posts"))
    return breaks


def river_item(n, local=True, src="wcax", ch=None, score=5):
    return {"id": f"r{n}", "ch": ch or ("local" if local else "world"), "local": local,
            "src": src, "name": src, "title": f"Story {n}", "url": f"https://r.example/{n}",
            "posted_at": "2026-10-16T17:00:00+00:00", "_score": score}


class RiverOrderTests(Workdir):
    """Stephen, 2026-10-17: local and national "get a little lost when it's all
    in a row ... websites tend to update in bunches"."""

    def test_a_bunch_of_local_is_broken_up_by_national(self):
        # a local site posts eight in a row; three national stories score lower
        local = [river_item(k, src=("wcax", "vtd")[k % 2], score=6) for k in range(8)]
        national = [river_item(10 + k, local=False, src=("ap", "reuters", "nyt")[k], score=3)
                    for k in range(3)]
        out = cw.order_update(local + national, "r0", [i["id"] for i in local + national])
        self.assertEqual(out[0]["id"], "r0")                        # the lead leads
        self.assertEqual(rule_breaks(out), [])
        self.assertEqual([bool(i["local"]) for i in out[:8]],
                         [True, True, True, False, True, True, True, False])
        self.assertEqual(len(out), 11)

    def test_importance_decides_within_the_rules(self):
        items = [river_item(1, score=3), river_item(2, src="vtd", score=8),
                 river_item(3, local=False, src="ap", score=6)]
        out = cw.order_update(items, None, ["r1", "r2", "r3"])
        self.assertEqual([i["id"] for i in out], ["r1", "r2", "r3"])   # fresh order is the caller's
        fresh = ["r2", "r3", "r1"]                                      # most important first
        self.assertEqual([i["id"] for i in cw.order_update(items, None, fresh)], fresh)

    def test_never_two_from_one_outlet_back_to_back(self):
        items = [river_item(k, src="sevendays" if k < 4 else "wcax") for k in range(6)]
        out = cw.order_update(items, None, [i["id"] for i in items])
        self.assertEqual([i["src"] for i in out],
                         ["sevendays", "wcax", "sevendays", "wcax", "sevendays", "sevendays"])
        self.assertEqual(rule_breaks(out), [])     # the last two could not be helped

    def test_an_x_desks_bunch_of_five_is_spread(self):
        # a Grok run brings five posts from one national desk, all scored high
        xs = [river_item(k, local=False, src="x:@AP", ch="x", score=7) for k in range(5)]
        rest = ([river_item(10 + k, local=False, src=("reuters", "nyt", "npr")[k], score=4)
                 for k in range(3)]
                + [river_item(20 + k, src=("wcax", "vtd", "nbc5", "sevendays")[k], score=6)
                   for k in range(4)])
        items = xs + rest
        out = cw.order_update(items, None, [i["id"] for i in items])
        self.assertEqual(rule_breaks(out), [])
        runs = max(len(run) for run in "".join("x" if i["ch"] == "x" else "." for i in out).split("."))
        self.assertLessEqual(runs, 1)            # one desk: never two of its posts together

    def test_x_posts_from_different_desks_run_two_at_most(self):
        xs = [river_item(k, local=False, src=f"x:@desk{k}", ch="x", score=7) for k in range(6)]
        rest = [river_item(10 + k, src=("wcax", "vtd")[k % 2], score=3) for k in range(4)]
        out = cw.order_update(xs + rest, None, [i["id"] for i in xs + rest])
        self.assertEqual(rule_breaks(out), [])
        self.assertEqual("".join("x" if i["ch"] == "x" else "." for i in out)[:6], "xx.xx.")

    def test_a_choice_never_corners_the_next_slot(self):
        # Codex review: AP, Reuters, AP left only an AP and a local, and two AP
        # posts sat together. Looking one slot ahead keeps every rule.
        items = [river_item(1, local=False, src="x:@AP", ch="x"),
                 river_item(2, local=False, src="x:@AP", ch="x"),
                 river_item(3, local=False, src="x:@Reuters", ch="x"),
                 river_item(4, local=False, src="x:@Reuters", ch="x"),
                 river_item(5, src="x:@AP", ch="x")]
        out = cw.order_update(items, None, [i["id"] for i in items])
        self.assertEqual(rule_breaks(out), [])
        self.assertTrue(all(a["src"] != b["src"] for a, b in zip(out, out[1:])), out)

    def test_a_settled_update_stays_put(self):
        local = [river_item(k, src=("wcax", "vtd")[k % 2]) for k in range(7)]
        national = [river_item(10 + k, local=False, src="ap" if k % 2 else "npr") for k in range(4)]
        once = cw.order_update(local + national, "r3", [i["id"] for i in local + national])
        again = cw.order_update(once, "r3")
        self.assertEqual([i["id"] for i in again], [i["id"] for i in once])

    def test_this_hours_additions_come_before_what_the_update_held(self):
        held = [river_item(k, src=("wcax", "ap")[k % 2], local=not k % 2) for k in range(4)]
        added = [river_item(10, src="vtd"), river_item(11, local=False, src="npr")]
        out = cw.order_update(held + added, None, ["r10", "r11"])
        self.assertEqual([i["id"] for i in out], ["r10", "r11", "r0", "r1", "r2", "r3"])

    def test_the_hourly_run_orders_the_current_update(self):
        # 12 local from two sites and 6 national from one, all at once
        self.write_pulse(pulse(n_local=12, n_world=6))
        self.run_curate(Stub(take_all))
        items = self.today()["updates"][0]["items"]
        self.assertEqual(len(items), 18)
        self.assertEqual(rule_breaks(items), [])
        self.assertEqual([bool(i["local"]) for i in items[:8]].count(False), 2)
        # and an hour later the new arrivals go on top, the rules kept
        self.write_pulse(pulse(n_local=5, n_world=0, start=40))
        self.run_curate(Stub(take_all), now=NOW + timedelta(minutes=60))
        later = self.today()["updates"][0]["items"]
        self.assertEqual(len(later), 23)
        self.assertEqual(rule_breaks(later), [])
        self.assertTrue(all(i["title"].startswith("Local headline 4") for i in later[:3]))


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

    def test_a_second_tick_inside_the_hour_does_not_tag(self):
        calls = []

        def plan(engine, system, user, schema, max_tokens, attempts=2, log_prefix=""):
            rows = [line for line in user.splitlines() if line[:1].isdigit()]
            calls.append(len(rows))
            return {"tags": [{"i": int(r.split(".")[0]), "junk": "none", "local": True, "ch": "local",
                              "topic": "other", "sport": "none", "score": 5} for r in rows]}, \
                {"in": 1000, "out": 300, "calls": 1}
        args = SimpleNamespace(data_dir=self.data, pulse=self.pulse_path)
        for minutes, payload in ((0, pulse()), (20, pulse(start=40)), (50, pulse(start=40))):
            self.write_pulse(payload)
            at = NOW + timedelta(minutes=minutes)
            with mock.patch.object(wc, "ask_json", plan), mock.patch.object(wc, "utcnow", return_value=at):
                tw.run(args)
        self.assertEqual(len(calls), 2)            # the :20 tick waited for the next hour

    def test_tagger_outage_exits_zero_and_leaves_items_untagged(self):
        self.assertEqual(self.run_tag(Stub(error="overloaded")), 0)
        store = wc.load_json(os.path.join(self.data, "wire-tags.json"), {})
        self.assertEqual(store["tags"], {})
        # and the curator still works from mechanical defaults
        self.run_curate(Stub(take_all))
        self.assertGreater(self.today()["count"], 0)


if __name__ == "__main__":
    unittest.main()
