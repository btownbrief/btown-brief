"""build_groups.py: the checks that keep data/groups.json honest, the
generated data/clubs.json, and the kinds the page, the builder and the SQL
must agree on. The Validate and Clubs cases are pure; the last class reads
the real files.

Run: python3 -m unittest tests/test_build_groups.py
"""

import datetime as dt
import json
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import build_groups as bg  # noqa: E402

TODAY = dt.date(2026, 10, 17)
OWN = {
    "id": "btown-brief-irl", "name": "Burlington Social Activities Group", "kind": "social", "category": "social",
    "what": "Stephen's Meetup.", "meets": [], "schedule_note": "Several events most weeks.", "where": "Varies",
    "free": True, "cost": "free", "beginner": True, "signup": {"how": "RSVP on Meetup", "url": ""},
    "url": "https://www.meetup.com/burlington-social-activites-group/", "featured": True,
    "checked": {"date": "2026-10-17", "source": "https://www.meetup.com/burlington-social-activites-group/", "note": "Events listed."},
}


def group(gid="test-league", **kw):
    base = {
        "id": gid, "name": gid.replace("-", " ").title(), "kind": "league", "category": "kickball",
        "what": "A coed kickball league.",
        "meets": [{"day": "mon", "time": "18:00", "end": "20:00", "where": "Leddy Park", "address": "", "note": ""}],
        "schedule_note": "", "season": "", "where": "Leddy Park, Burlington", "town": "Burlington",
        "cost": "$60 per player", "free": False, "level": "all levels", "beginner": True,
        "signup": {"how": "Register a team or sign up solo", "url": "https://example.org/register"},
        "newcomers": "", "url": "https://example.org/", "links": {"instagram": "https://instagram.com/x"},
        "checked": {"date": "2026-10-17", "source": "https://example.org/kickball", "note": "Mondays 6 to 8pm."},
    }
    base.update(kw)
    return base


def errors_for(*groups, run=None):
    return bg.validate({"groups": [OWN, *groups]}, run or {"clubs": []}, today=TODAY)[0]


def warnings_for(*groups):
    return bg.validate({"groups": [OWN, *groups]}, {"clubs": []}, today=TODAY)[1]


class Validate(unittest.TestCase):
    def test_good_group_passes(self):
        self.assertEqual(errors_for(group()), [])

    def test_duplicate_id_and_name(self):
        self.assertTrue(any("duplicate id" in e for e in errors_for(group("a"), group("a"))))
        self.assertTrue(any("same name" in e for e in errors_for(group("a", name="Chess Club"), group("b", name="chess club"))))

    def test_run_directory_owns_its_clubs(self):
        run = {"clubs": [{"id": "skirack-run-club", "name": "Skirack Run Club"}]}
        self.assertTrue(any("run-clubs.json" in e for e in errors_for(group("skirack-run-club"), run=run)))
        self.assertTrue(any("run directory owns" in e for e in errors_for(group("x", name="Skirack run club"), run=run)))

    def test_kind_and_category(self):
        self.assertTrue(any("kind" in e for e in errors_for(group(kind="sport"))))
        self.assertTrue(any("category" in e for e in errors_for(group(category="kick-ball"))))

    def test_checked_record(self):
        self.assertTrue(any("checked.source" in e for e in errors_for(group(checked={"date": "2026-10-17", "source": "", "note": "x"}))))
        self.assertTrue(any("future" in e for e in errors_for(group(checked={"date": "2026-11-01", "source": "https://x.org", "note": "x"}))))
        self.assertTrue(any("no 'checked'" in e for e in errors_for(group(checked=None))))

    def test_free_must_be_backed_by_cost(self):
        self.assertTrue(any("never says free" in e for e in errors_for(group(free=True, cost="$10"))))
        self.assertEqual(errors_for(group(free=True, cost="Free; donations welcome")), [])
        self.assertTrue(any("'beginner' must be true or false" in e for e in errors_for(group(beginner="yes"))))

    def test_meets(self):
        bad = {"day": "monday", "time": "6pm", "where": ""}
        errs = errors_for(group(meets=[bad]))
        self.assertTrue(any("day" in e for e in errs))
        self.assertTrue(any("HH:MM" in e for e in errs))
        self.assertTrue(any("no 'where'" in e for e in errs))
        self.assertTrue(any("not after it starts" in e for e in errors_for(group(meets=[
            {"day": "mon", "time": "20:00", "end": "18:00", "where": "Gym"}]))))

    def test_time_null_needs_note(self):
        self.assertTrue(any("time is null" in e for e in errors_for(group(meets=[{"day": "tue", "time": None, "where": "Gym"}]))))
        self.assertEqual(errors_for(group(meets=[{"day": "tue", "time": None, "where": "Gym", "note": "games 6 to 9pm"}])), [])

    def test_no_meets_needs_schedule_note(self):
        self.assertTrue(any("schedule_note" in e for e in errors_for(group(meets=[]))))
        self.assertEqual(errors_for(group(meets=[], schedule_note="Second Tuesday of each month, 7pm.")), [])

    def test_season_fields(self):
        self.assertTrue(any("months" in e for e in errors_for(group(months=[0, 13]))))
        self.assertTrue(any("after until" in e for e in errors_for(group(**{"from": "2026-11-01", "until": "2026-10-01"}))))
        self.assertTrue(any("skip" in e for e in errors_for(group(skip=["Nov 2"]))))
        meet = {"day": "mon", "time": "18:00", "where": "Gym", "from": "2026-09-14", "until": "2026-11-02"}
        self.assertEqual(errors_for(group(meets=[meet], season="fall")), [])

    def test_wordy_season_warns(self):
        self.assertTrue(any("all year" in w for w in warnings_for(group(season="fall session"))))
        self.assertFalse(any("all year" in w for w in warnings_for(group(season="fall session", months=[9, 10, 11]))))
        self.assertFalse(any("all year" in w for w in warnings_for(group(season="year-round"))))

    def test_ended_season_warns(self):
        self.assertTrue(any("ended" in w for w in warnings_for(group(until="2026-08-01", season="summer"))))

    def test_signup_and_links(self):
        self.assertTrue(any("signup.how" in e for e in errors_for(group(signup={"how": "", "url": ""}))))
        self.assertTrue(any("signup.url" in e for e in errors_for(group(signup={"how": "x", "url": "javascript:alert(1)"}))))
        self.assertTrue(any("unknown link" in e for e in errors_for(group(links={"tiktok": "https://x.org"}))))
        self.assertTrue(any("is not a URL" in e for e in errors_for(group(links={"instagram": "@x"}))))

    def test_em_dash_is_refused(self):
        self.assertTrue(any("em dash" in e for e in errors_for(group(what="Kickball — for fun."))))

    def test_unknown_field(self):
        self.assertTrue(any("unknown field 'meet'" in e for e in errors_for(group(meet=[]))))

    def test_own_group_is_required_and_featured(self):
        errs = bg.validate({"groups": [group()]}, {"clubs": []}, today=TODAY)[0]
        self.assertTrue(any("own Meetup group" in e for e in errs))
        unfeatured = dict(OWN, featured=False)
        errs = bg.validate({"groups": [unfeatured]}, {"clubs": []}, today=TODAY)[0]
        self.assertTrue(any("featured: true" in e for e in errs))

    def test_wrong_types_are_errors_not_crashes(self):
        errs = errors_for(group(meets="Mondays", links=[], signup="online", checked={"date": 5, "source": 1, "note": None, "also": 3}))
        self.assertTrue(errs)


class Clubs(unittest.TestCase):
    def test_when_text(self):
        meets = [{"day": "tue", "time": "18:30"}, {"day": "thu", "time": "18:30"}]
        self.assertEqual(bg.when_text(meets), "Tuesdays 6:30pm · Thursdays 6:30pm")
        self.assertEqual(bg.when_text([{"day": "mon", "time": None, "note": "x"}], season="fall"), "Mondays (fall)")
        self.assertEqual(bg.when_text([], "Second Tuesday of each month. RSVP on Meetup."), "Second Tuesday of each month")
        many = [{"day": d, "time": "18:00"} for d in ("mon", "tue", "wed", "thu", "fri")]
        self.assertTrue(bg.when_text(many).endswith("+2 more"))

    def test_build_keeps_the_old_shape(self):
        run = {"clubs": [{"id": "skirack-run-club", "name": "Skirack Run Club", "kind": "run", "what": "Mondays.",
                          "meets": [{"day": "mon", "time": "18:00"}], "url": "https://skirack.com"}]}
        doc = bg.build_clubs({"groups": [group("chess", kind="games", category="chess"), OWN]}, run)
        rows = doc["clubs"]
        self.assertEqual(rows[0]["name"], OWN["name"])
        self.assertTrue(rows[0]["featured"])
        for row in rows:
            for key in ("name", "what", "when", "category", "url"):
                self.assertIsInstance(row[key], str)
        cats = {r["id"]: r["category"] for r in rows}
        self.assertEqual(cats["chess"], "Games & Puzzles")
        self.assertEqual(cats["skirack-run-club"], "Running")
        self.assertEqual(sum(1 for r in rows if r.get("featured")), 1)


class RealFiles(unittest.TestCase):
    def read(self, rel):
        with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
            return f.read()

    def test_groups_json_passes_and_clubs_json_is_current(self):
        doc = json.loads(self.read("data/groups.json"))
        run = json.loads(self.read("data/run-clubs.json"))
        errors, _ = bg.validate(doc, run)
        self.assertEqual(errors, [])
        self.assertEqual(self.read("data/clubs.json"), bg.render(bg.build_clubs(doc, run)),
                         "data/clubs.json is out of date: run python3 scripts/build_groups.py")

    def test_the_stale_lines_are_gone(self):
        doc = json.loads(self.read("data/groups.json"))
        self.assertFalse(any(g["name"].lower() == "burlington run club" for g in doc["groups"]),
                         "Burlington Run Club (Fridays at Foam) has had no posts since June 2025")
        for g in doc["groups"]:
            if "ultimate" in g["name"].lower():
                self.assertNotIn("hanover", json.dumps(g).lower(), g["id"])

    def test_kinds_agree_across_page_builder_and_sql(self):
        js = re.search(r"var FORM_KINDS = \[([^\]]+)\]", self.read("js/clubs.js")).group(1)
        js_kinds = re.findall(r"'([a-z-]+)'", js)
        sql = re.search(r"'kinds', jsonb_build_array\(([^)]+)\)", self.read("db/groups-submit.sql")).group(1)
        sql_kinds = re.findall(r"'([a-z-]+)'", sql)
        self.assertEqual(js_kinds, sql_kinds)
        self.assertEqual(js_kinds, ["run"] + bg.KINDS)


if __name__ == "__main__":
    unittest.main()
