#!/usr/bin/env python3
"""Check data/groups.json, the leagues, pickup games and groups directory,
and write data/clubs.json from it and data/run-clubs.json.

data/groups.json is written by hand (its `_about` key says how to add a
group and what "verified" means). Run clubs stay in data/run-clubs.json,
which scripts/build_run_clubs.py checks; clubs.html reads both files.

data/clubs.json is GENERATED here and never edited by hand. It keeps the
old shape (name, what, when, category, url, featured) that the All Day
People tab and What Now read, and adds id and kind. Every group in both
files lands in it, Stephen's own Meetup group first.

The check refuses data/groups.json when:

- a group has no `checked` record with a source URL, a quoted note and a
  valid date that is not in the future,
- an id is missing, not kebab-case, or used twice, or a name repeats,
- a group is already in data/run-clubs.json (same id or same name),
- `kind` or `category` is not one of KINDS / CATEGORIES,
- `free` or `beginner` is not true/false, or `free` is true while `cost`
  never says free (the "Free" filter must not promise what the page does not),
- a meet has a day outside mon..sun, a time that is not 24-hour "HH:MM"
  (null is allowed only with a note saying when), an end before its start,
  or no `where`,
- `months`, `from`, `until` or `skip` (on a group or a meet) are malformed,
- a group has no weekly meet and no `schedule_note`,
- `signup` lacks a one-line `how`, or a link is not a URL,
- reader-facing text has an em dash (the newsletter's voice rule),
- Stephen's own Meetup group is missing or not featured (his own events
  are never missed),
- a field name is not one the directory uses (catches typos).

It cannot tell whether the source page really says what checked.note
quotes: that is the human or second-model review in the file's `_about`.

It warns (without failing) when a check is more than STALE_DAYS old, when a
season is written in words with no machine months or dates (the page would
show it all year), and when a group's season has already ended.

    python3 scripts/build_groups.py           # check, write data/clubs.json, print counts
    python3 scripts/build_groups.py --check   # check only; fail if data/clubs.json is out of date

Exit status is 1 when there is a problem, 0 otherwise.
"""

import datetime as dt
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_run_clubs import DAYS, ID_RE, TIME_RE, check_date, clock, is_url  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
GROUPS = ROOT / "data" / "groups.json"
RUN_CLUBS = ROOT / "data" / "run-clubs.json"
CLUBS = ROOT / "data" / "clubs.json"

# The page's browse order. db/groups-submit.sql and js/clubs.js list the same
# kinds (plus "run" for the run directory); tests/test_build_groups.py checks.
KINDS = ["league", "pickup", "games", "trivia", "books", "language", "music", "dance",
         "making", "outdoors", "social", "other"]
CATEGORIES = {
    "volleyball", "soccer", "basketball", "pickleball", "tennis", "kickball", "softball",
    "baseball", "ultimate", "dodgeball", "hockey", "broomball", "curling", "bowling",
    "climbing", "flag-football", "cornhole", "disc-golf", "table-tennis", "badminton",
    "skating", "skiing", "sailing", "rowing-paddling", "cycling", "hiking", "golf", "darts",
    "billiards", "multi-sport", "board-games", "tabletop-rpg", "card-games", "chess", "go",
    "bridge", "mahjong", "video-games", "trivia", "books", "writing", "language", "choir",
    "music-jam", "dance", "crafts", "makerspace", "speaking", "social", "film", "improv",
    "art", "photography", "gardening", "other",
}
STALE_DAYS = 120

GROUP_KEYS = {"id", "name", "kind", "category", "what", "meets", "schedule_note", "season",
              "months", "from", "until", "skip", "where", "town", "cost", "free", "level",
              "beginner", "signup", "newcomers", "url", "links", "checked", "featured"}
REQUIRED_TEXT = ("id", "name", "kind", "category", "what", "where", "url")
OPTIONAL_TEXT = ("schedule_note", "season", "town", "cost", "level", "newcomers")
MEET_KEYS = {"day", "time", "end", "where", "address", "note", "season", "months", "from",
             "until", "skip"}
CHECKED_KEYS = {"date", "source", "note", "also"}
SIGNUP_KEYS = {"how", "url"}
LINK_KEYS = {"site", "instagram", "facebook", "meetup", "discord", "calendar", "strava",
             "reddit", "youtube"}
FREE_WORDS = re.compile(r"\bfree\b|no cost|no charge|donation|\$0\b", re.I)
# Reader-facing text: the newsletter's voice rules forbid em dashes.
VOICE_FIELDS = ("what", "schedule_note", "newcomers", "level", "season", "cost")

# Stephen's own Meetup group (newsletter AGENTS.md: his own events are never missed).
OWN_URL = re.compile(r"meetup\.com/burlington-social-activiti?es-group", re.I)

# data/clubs.json's old categories, which the People tab's quiz matches on.
LEGACY_ORDER = ["Social", "Running", "Biking", "Hiking & Outdoors", "Games & Puzzles", "Books",
                "Sports & Rec", "Making & Crafts", "Language", "Music", "Dance", "Other"]
LEGACY_BY_KIND = {"league": "Sports & Rec", "pickup": "Sports & Rec", "games": "Games & Puzzles",
                  "trivia": "Games & Puzzles", "books": "Books", "language": "Language",
                  "music": "Music", "dance": "Dance", "making": "Making & Crafts",
                  "outdoors": "Hiking & Outdoors", "social": "Social", "other": "Other"}
LEGACY_BY_RUN_KIND = {"run": "Running", "bike": "Biking", "hike": "Hiking & Outdoors",
                      "row-paddle": "Hiking & Outdoors", "climb": "Sports & Rec",
                      "pickup": "Sports & Rec", "yoga": "Other", "other": "Other"}
DAY_PLURAL = dict(zip(DAYS, ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays",
                             "Saturdays", "Sundays"]))


def name_key(name):
    return re.sub(r"[^a-z0-9]", "", str(name or "").lower())


def parse_date(value):
    try:
        return dt.date.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None


def check_season_fields(obj, label, errors):
    """months, from, until and skip, on a group or on one meet."""
    if "months" in obj:
        months = obj["months"]
        if (not isinstance(months, list) or not months
                or any(not isinstance(m, int) or isinstance(m, bool) or not 1 <= m <= 12 for m in months)
                or len(set(months)) != len(months)):
            errors.append(f"{label}: months must be a list of distinct month numbers 1 to 12")
    dates = {}
    for key in ("from", "until"):
        if key in obj:
            dates[key] = parse_date(obj[key])
            if dates[key] is None:
                errors.append(f"{label}: {key} {obj[key]!r} is not YYYY-MM-DD")
    if dates.get("from") and dates.get("until") and dates["from"] > dates["until"]:
        errors.append(f"{label}: from {obj['from']} is after until {obj['until']}")
    if "skip" in obj:
        skip = obj["skip"]
        if not isinstance(skip, list) or any(parse_date(d) is None for d in skip):
            errors.append(f"{label}: skip must be a list of YYYY-MM-DD dates")


def has_machine_season(obj):
    return any(key in obj for key in ("months", "from", "until"))


def check_meet(meet, label, errors):
    if not isinstance(meet, dict):
        errors.append(f"{label}: a meet must be an object")
        return
    for key in sorted(set(meet) - MEET_KEYS):
        errors.append(f"{label}: unknown field '{key}'")
    if meet.get("day") not in DAYS:
        errors.append(f"{label}: day {meet.get('day')!r} is not one of {', '.join(DAYS)}")
    time = meet.get("time")
    if time is None:
        if not isinstance(meet.get("note"), str) or not meet["note"].strip():
            errors.append(f"{label}: time is null, so 'note' must say when (e.g. 'games 6 to 9pm')")
    elif not isinstance(time, str) or not TIME_RE.match(time):
        errors.append(f"{label}: time {time!r} is not 24-hour HH:MM (or null)")
    end = meet.get("end", "")
    if end:
        if not isinstance(end, str) or not TIME_RE.match(end):
            errors.append(f"{label}: end {end!r} is not 24-hour HH:MM")
        elif isinstance(time, str) and TIME_RE.match(time) and end <= time:
            errors.append(f"{label}: ends at {end}, not after it starts at {time}")
    for key in ("address", "note", "season"):
        if key in meet and not isinstance(meet[key], str):
            errors.append(f"{label}: {key} must be text")
    if not isinstance(meet.get("where"), str) or not meet["where"].strip():
        errors.append(f"{label}: no 'where'")
    check_season_fields(meet, label, errors)


def check_group(group, label, today, errors, warnings):
    for key in sorted(set(group) - GROUP_KEYS):
        errors.append(f"{label}: unknown field '{key}'")
    for key in REQUIRED_TEXT:
        if not isinstance(group.get(key), str) or not group[key].strip():
            errors.append(f"{label}: missing '{key}'")
    for key in OPTIONAL_TEXT:
        if key in group and not isinstance(group[key], str):
            errors.append(f"{label}: {key} must be text")
    if isinstance(group.get("id"), str) and group["id"] and not ID_RE.match(group["id"]):
        errors.append(f"{label}: id is not kebab-case")
    if group.get("kind") not in KINDS:
        errors.append(f"{label}: kind {group.get('kind')!r} is not one of {', '.join(KINDS)}")
    if group.get("category") not in CATEGORIES:
        errors.append(f"{label}: category {group.get('category')!r} is not a known category")
    if group.get("url") and not is_url(group["url"]):
        errors.append(f"{label}: url {group['url']!r} is not a URL")
    for key in ("free", "beginner"):
        if not isinstance(group.get(key), bool):
            errors.append(f"{label}: '{key}' must be true or false")
    if "featured" in group and not isinstance(group["featured"], bool):
        errors.append(f"{label}: featured must be true or false")
    if group.get("free") is True and not FREE_WORDS.search(str(group.get("cost", ""))):
        errors.append(f"{label}: free is true but cost {group.get('cost', '')!r} never says free")
    for key in VOICE_FIELDS:
        if "—" in str(group.get(key, "")):
            errors.append(f"{label}: {key} has an em dash; rewrite it without one")

    signup = group.get("signup")
    if not isinstance(signup, dict):
        errors.append(f"{label}: no 'signup' object (how, url)")
    else:
        for key in sorted(set(signup) - SIGNUP_KEYS):
            errors.append(f"{label}: unknown signup field '{key}'")
        if not isinstance(signup.get("how"), str) or not signup["how"].strip():
            errors.append(f"{label}: signup.how should say in one line how to join")
        if signup.get("url") and not is_url(signup["url"]):
            errors.append(f"{label}: signup.url {signup['url']!r} is not a URL")

    links = group.get("links", {})
    if not isinstance(links, dict):
        errors.append(f"{label}: links must be an object of name: URL")
    else:
        for key, value in links.items():
            if key not in LINK_KEYS:
                errors.append(f"{label}: unknown link '{key}'")
            elif not is_url(value):
                errors.append(f"{label}: links.{key} {value!r} is not a URL")

    checked = group.get("checked")
    if not isinstance(checked, dict):
        errors.append(f"{label}: no 'checked' record (date, source, note)")
    else:
        for key in sorted(set(checked) - CHECKED_KEYS):
            errors.append(f"{label}: unknown checked field '{key}'")
        if not is_url(checked.get("source")):
            errors.append(f"{label}: checked.source must be the URL of the page that was read")
        if not isinstance(checked.get("note"), str) or not checked["note"].strip():
            errors.append(f"{label}: checked.note should say what the source page states")
        also = checked.get("also", [])
        if not isinstance(also, list) or any(not is_url(x) for x in also):
            errors.append(f"{label}: checked.also must be a list of URLs")
        check_date(checked.get("date"), label, today, errors, warnings)

    check_season_fields(group, label, errors)
    until = parse_date(group.get("until"))
    if until and until < today:
        warnings.append(f"{label}: its season ended {group['until']}; add the next season or drop it")

    meets = group.get("meets")
    if not isinstance(meets, list):
        errors.append(f"{label}: 'meets' must be a list (empty when there is no fixed weekly slot)")
        return
    slots = set()
    for j, meet in enumerate(meets):
        check_meet(meet, f"{label} meets[{j}]", errors)
        if isinstance(meet, dict):
            slot = (meet.get("day"), meet.get("time"), meet.get("where"))
            if slot in slots:
                errors.append(f"{label} meets[{j}]: same day, time and place listed twice")
            slots.add(slot)
    if not meets and not str(group.get("schedule_note", "")).strip():
        errors.append(f"{label}: no weekly meet, so 'schedule_note' must say when and where to look")
    season = str(group.get("season", "")).strip().lower()
    if (season and not season.startswith("year-round") and not has_machine_season(group)
            and meets and not all(isinstance(m, dict) and has_machine_season(m) for m in meets)):
        warnings.append(f"{label}: season {group['season']!r} has no months or from/until, "
                        "so the page shows its meets all year")


def validate(doc, run_doc=None, today=None):
    """Return (errors, warnings) for a parsed groups.json, checked against run-clubs.json."""
    today = today or dt.date.today()
    errors, warnings = [], []
    if not isinstance(doc, dict) or not isinstance(doc.get("groups"), list):
        return ["the file must be an object with a 'groups' list"], warnings
    run_ids, run_names = {}, {}
    for club in (run_doc or {}).get("clubs", []):
        if isinstance(club, dict):
            run_ids[club.get("id")] = club.get("name")
            run_names[name_key(club.get("name"))] = club.get("id")
    seen, names, own = {}, {}, []
    for i, group in enumerate(doc["groups"]):
        if not isinstance(group, dict):
            errors.append(f"groups[{i}]: must be an object")
            continue
        label = group.get("id") or f"groups[{i}]"
        check_group(group, label, today, errors, warnings)
        gid = group.get("id")
        if isinstance(gid, str) and gid:
            if gid in seen:
                errors.append(f"{label}: duplicate id (also groups[{seen[gid]}])")
            seen.setdefault(gid, i)
            if gid in run_ids:
                errors.append(f"{label}: already in data/run-clubs.json; the run directory owns it")
        key = name_key(group.get("name"))
        if key:
            if key in names:
                errors.append(f"{label}: same name as {names[key]}")
            names.setdefault(key, label)
            if key in run_names:
                errors.append(f"{label}: same name as run-clubs.json's {run_names[key]}; "
                              "the run directory owns it")
        if OWN_URL.search(str(group.get("url", ""))):
            own.append(group)
    if not own:
        errors.append("Stephen's own Meetup group (burlington-social-activites-group) is missing; "
                      "his own events are never left out")
    elif not any(g.get("featured") is True for g in own):
        errors.append("Stephen's own Meetup group must have featured: true")
    return errors, warnings


# ------------------------------------------------------------------ clubs.json
def _short_clock(hhmm):
    return clock(hhmm).replace(":00", "")


def when_text(meets, schedule_note="", season=""):
    """One short line for data/clubs.json's free-text `when` (What Now reads its day words)."""
    if meets:
        parts, seen = [], set()
        for meet in meets:
            day = DAY_PLURAL.get(meet.get("day"), "")
            text = day + (f" {_short_clock(meet['time'])}" if meet.get("time") else "")
            if text and text not in seen:
                seen.add(text)
                parts.append(text)
        line = " · ".join(parts[:3]) + (f" · +{len(parts) - 3} more" if len(parts) > 3 else "")
        season = (season or "").strip()
        if season and not season.lower().startswith("year-round"):
            line += f" ({season})"
        return line
    note = (schedule_note or "").strip()
    first = re.split(r"(?<=[.;])\s", note)[0].rstrip(".;")
    return first if len(first) <= 90 else first[:87].rstrip() + "..."


def legacy_category(group):
    if group.get("kind") == "outdoors" and group.get("category") == "cycling":
        return "Biking"
    return LEGACY_BY_KIND.get(group.get("kind"), "Other")


def build_clubs(doc, run_doc):
    """data/clubs.json: every group and run club in the People tab's old shape."""
    rows = []
    for group in doc["groups"]:
        rows.append({
            "id": group["id"], "kind": group["kind"], "name": group["name"], "what": group["what"],
            "when": when_text(group["meets"], group.get("schedule_note", ""), group.get("season", "")),
            "category": legacy_category(group), "url": group["url"],
            **({"featured": True} if group.get("featured") else {}),
        })
    for club in (run_doc or {}).get("clubs", []):
        rows.append({
            "id": club["id"], "kind": "run" if club["kind"] in ("run", "other") else club["kind"],
            "name": club["name"], "what": club["what"],
            "when": when_text(club.get("meets", []), club.get("schedule_note", ""), club.get("season", "")),
            "category": LEGACY_BY_RUN_KIND.get(club["kind"], "Other"), "url": club["url"],
        })
    order = {c: i for i, c in enumerate(LEGACY_ORDER)}
    rows.sort(key=lambda r: (not r.get("featured"), order.get(r["category"], 99), r["name"].lower()))
    return {
        "_comment": "GENERATED by scripts/build_groups.py from data/groups.json and data/run-clubs.json. "
                    "Do not edit; edit those files and run the script. The All Day People tab and What Now "
                    "read name, what, when, category, url and featured.",
        "clubs": rows,
    }


def render(doc):
    return json.dumps(doc, ensure_ascii=False, indent=1) + "\n"


def counts(doc, run_doc):
    by_kind = Counter(g["kind"] for g in doc["groups"])
    lines = [f"{kind}: {by_kind[kind]}" for kind in KINDS if by_kind[kind]]
    run = (run_doc or {}).get("clubs", [])
    lines.append(f"run directory (data/run-clubs.json): {len(run)}")
    return lines


def main(argv):
    check_only = "--check" in argv
    try:
        doc = json.loads(GROUPS.read_text(encoding="utf-8"))
        run_doc = json.loads(RUN_CLUBS.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: cannot read the data: {exc}")
        return 1
    errors, warnings = validate(doc, run_doc)
    for warning in warnings:
        print(f"WARN: {warning}")
    for error in errors:
        print(f"ERROR: {error}")
    if errors:
        print(f"{len(errors)} problem(s) in {GROUPS.relative_to(ROOT)}")
        return 1
    text = render(build_clubs(doc, run_doc))
    if check_only:
        current = CLUBS.read_text(encoding="utf-8") if CLUBS.exists() else ""
        if current != text:
            print(f"ERROR: {CLUBS.relative_to(ROOT)} is out of date; run python3 scripts/build_groups.py")
            return 1
    else:
        CLUBS.write_text(text, encoding="utf-8")
    meets = sum(len(g["meets"]) for g in doc["groups"])
    print(f"OK: {len(doc['groups'])} groups, {meets} weekly meets"
          + ("" if check_only else f"; wrote {CLUBS.relative_to(ROOT)}"))
    print("\n".join("  " + line for line in counts(doc, run_doc)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
