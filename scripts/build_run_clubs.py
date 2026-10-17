#!/usr/bin/env python3
"""Check data/run-clubs.json, the run and fitness club directory, and print
the week at a glance.

The file is written by hand (see its `_about` key for how to add a club and
what "verified" means). This script does not fetch anything or change the
file. It refuses the file when:

- a club has no `checked` source URL or no valid `checked` date (or a date
  in the future),
- an id is missing, not kebab-case, or used twice,
- `kind` is not one of KINDS,
- a meet has a day outside mon..sun, a time that is not 24-hour "HH:MM",
  no `where`, or coordinates outside the Burlington area box (BBOX),
- a meet has no coordinates without saying its start point varies
  (`where` starting "Varies", lat and lng both null),
- a club has no weekly meet and no `schedule_note` telling a reader where
  to look,
- a field name is not one the directory uses (catches typos like "meet").

It warns (without failing) when a check is more than STALE_DAYS old, so a
human knows which clubs to re-read first.

    python3 scripts/build_run_clubs.py          # check, then print the week
    python3 scripts/build_run_clubs.py --quiet  # check only

Exit status is 1 when there is a problem, 0 otherwise.
"""

import datetime as dt
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "run-clubs.json"

KINDS = {"run", "hike", "bike", "climb", "pickup", "yoga", "row-paddle", "other"}
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DAY_NAMES = dict(zip(DAYS, ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]))
# Chittenden County, loosely: Milton to Charlotte, the lake to Richmond and Jericho.
BBOX = {"lat": (44.25, 44.75), "lng": (-73.40, -72.85)}
STALE_DAYS = 120

CLUB_KEYS = {"id", "name", "kind", "what", "meets", "schedule_note", "level", "cost", "season",
             "newcomers", "url", "instagram", "meetup", "strava", "checked"}
REQUIRED_TEXT = ("id", "name", "kind", "what", "url")
MEET_KEYS = {"day", "time", "where", "address", "lat", "lng", "note", "season"}
CHECKED_KEYS = {"date", "source", "note", "also"}
LINK_KEYS = ("url", "instagram", "meetup", "strava")

ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def is_url(value):
    return isinstance(value, str) and re.match(r"^https?://\S+$", value) is not None


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def check_meet(meet, where_label, errors):
    if not isinstance(meet, dict):
        errors.append(f"{where_label}: a meet must be an object")
        return
    for key in sorted(set(meet) - MEET_KEYS):
        errors.append(f"{where_label}: unknown field '{key}'")
    if meet.get("day") not in DAYS:
        errors.append(f"{where_label}: day {meet.get('day')!r} is not one of {', '.join(DAYS)}")
    if not isinstance(meet.get("time"), str) or not TIME_RE.match(meet["time"]):
        errors.append(f"{where_label}: time {meet.get('time')!r} is not 24-hour HH:MM")
    place = meet.get("where")
    if not isinstance(place, str) or not place.strip():
        errors.append(f"{where_label}: no 'where'")
        place = ""
    lat, lng = meet.get("lat"), meet.get("lng")
    if lat is None and lng is None:
        if not place.lower().startswith("varies"):
            errors.append(f"{where_label}: no coordinates; give lat/lng, or start 'where' with "
                          "'Varies' when the start point moves")
        if meet.get("address"):
            errors.append(f"{where_label}: has an address but no coordinates")
    elif not (is_number(lat) and is_number(lng)):
        errors.append(f"{where_label}: lat/lng must both be numbers (or both null)")
    elif not (BBOX["lat"][0] <= lat <= BBOX["lat"][1] and BBOX["lng"][0] <= lng <= BBOX["lng"][1]):
        errors.append(f"{where_label}: {lat}, {lng} is outside the Burlington area")


def check_date(value, label, today, errors, warnings):
    try:
        date = dt.date.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        date = None
    if date is None:
        errors.append(f"{label}: checked.date {value!r} is not YYYY-MM-DD")
        return
    if date > today:
        errors.append(f"{label}: checked.date {value} is in the future")
    elif (today - date).days > STALE_DAYS:
        warnings.append(f"{label}: last checked {value}, over {STALE_DAYS} days ago; re-read the source")


def validate(doc, today=None):
    """Return (errors, warnings) for a parsed run-clubs.json document."""
    today = today or dt.date.today()
    errors, warnings = [], []
    if not isinstance(doc, dict) or not isinstance(doc.get("clubs"), list):
        return ["the file must be an object with a 'clubs' list"], warnings
    seen = {}
    for i, club in enumerate(doc["clubs"]):
        if not isinstance(club, dict):
            errors.append(f"clubs[{i}]: must be an object")
            continue
        label = club.get("id") or f"clubs[{i}]"
        for key in sorted(set(club) - CLUB_KEYS):
            errors.append(f"{label}: unknown field '{key}'")
        for key in REQUIRED_TEXT:
            if not isinstance(club.get(key), str) or not club[key].strip():
                errors.append(f"{label}: missing '{key}'")
        cid = club.get("id")
        if isinstance(cid, str) and cid:
            if not ID_RE.match(cid):
                errors.append(f"{label}: id is not kebab-case")
            if cid in seen:
                errors.append(f"{label}: duplicate id (also clubs[{seen[cid]}])")
            seen.setdefault(cid, i)
        if club.get("kind") not in KINDS:
            errors.append(f"{label}: kind {club.get('kind')!r} is not one of {', '.join(sorted(KINDS))}")
        for key in LINK_KEYS:
            value = club.get(key, "")
            if value and not is_url(value):
                errors.append(f"{label}: {key} {value!r} is not a URL")
        for key in ("schedule_note", "level", "cost", "season", "newcomers"):
            if key in club and not isinstance(club[key], str):
                errors.append(f"{label}: {key} must be text")

        checked = club.get("checked")
        if not isinstance(checked, dict):
            errors.append(f"{label}: no 'checked' record (date, source, note)")
        else:
            for key in sorted(set(checked) - CHECKED_KEYS):
                errors.append(f"{label}: unknown checked field '{key}'")
            if not is_url(checked.get("source")):
                errors.append(f"{label}: checked.source must be the URL of the page that was read")
            if not isinstance(checked.get("note"), str) or not checked["note"].strip():
                errors.append(f"{label}: checked.note should say what the source page states")
            for extra in checked.get("also", []) or []:
                if not is_url(extra):
                    errors.append(f"{label}: checked.also {extra!r} is not a URL")
            check_date(checked.get("date"), label, today, errors, warnings)

        meets = club.get("meets")
        if not isinstance(meets, list):
            errors.append(f"{label}: 'meets' must be a list (empty when there is no fixed weekly slot)")
            continue
        slots = set()
        for j, meet in enumerate(meets):
            check_meet(meet, f"{label} meets[{j}]", errors)
            if isinstance(meet, dict):
                slot = (meet.get("day"), meet.get("time"), meet.get("where"))
                if slot in slots:
                    errors.append(f"{label} meets[{j}]: same day, time and place listed twice")
                slots.add(slot)
        if not meets and not str(club.get("schedule_note", "")).strip():
            errors.append(f"{label}: no weekly meet, so 'schedule_note' must say where to find the schedule")
    return errors, warnings


def clock(hhmm):
    hour, minute = (int(x) for x in hhmm.split(":"))
    suffix = "am" if hour < 12 else "pm"
    return f"{(hour % 12) or 12}:{minute:02d}{suffix}"


def week_grid(doc):
    """The week as text lines: each day, its meets in time order."""
    rows = {day: [] for day in DAYS}
    for club in doc["clubs"]:
        for meet in club["meets"]:
            club_season = club.get("season", "")
            season = meet.get("season") or ("" if club_season.startswith("year-round") else club_season)
            place = meet["where"]
            town = meet.get("address", "").split(",")[-1].strip()
            if town and town not in place:
                place += f", {town}"
            rows[meet["day"]].append((meet["time"], club["name"], place, season))
    lines = []
    for day in DAYS:
        lines.append(f"{DAY_NAMES[day]} ({len(rows[day])})")
        for time, name, place, season in sorted(rows[day]):
            tail = f"  [{season}]" if season else ""
            lines.append(f"  {clock(time):>7}  {name} - {place}{tail}")
        if not rows[day]:
            lines.append("          (nothing listed)")
    loose = [c for c in doc["clubs"] if not c["meets"]]
    if loose:
        lines.append("")
        lines.append(f"No fixed weekly slot ({len(loose)})")
        for club in sorted(loose, key=lambda c: c["name"].lower()):
            lines.append(f"  {club['name']}: {club['schedule_note']}")
    return lines


def main(argv):
    quiet = "--quiet" in argv
    try:
        doc = json.loads(DATA.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: cannot read {DATA.relative_to(ROOT)}: {exc}")
        return 1
    errors, warnings = validate(doc)
    for warning in warnings:
        print(f"WARN: {warning}")
    for error in errors:
        print(f"ERROR: {error}")
    if errors:
        print(f"{len(errors)} problem(s) in {DATA.relative_to(ROOT)}")
        return 1
    clubs = doc["clubs"]
    meets = sum(len(c["meets"]) for c in clubs)
    print(f"OK: {len(clubs)} clubs, {meets} weekly meets")
    if not quiet:
        print()
        print("\n".join(week_grid(doc)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
