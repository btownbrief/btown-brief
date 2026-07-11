"""Fletcher Free Library — fletcherfree.libcal.com (Springshare LibCal).

Method: LibCal's public JSON endpoint, one request per day in the window:
  /ajax/calendar/list?c=21587&date=YYYY-MM-DD&perpage=100&page=1
It returns rich structured data per occurrence: startdt/enddt, room
(location/locations), branch (campus), audiences, categories, cost, and an
online_event flag. (The ICS feed at /ical_subscribe.php exists too but lacks
the online flag, audiences, and cost, so JSON wins.)

Rules applied here:
  * online_event=True (or a campus/location that says online/virtual/zoom)
    is dropped — the newsletter only lists attendable-in-person events.
  * Kids/family programs ARE included (this feed powers the calendar, not
    the newsletter cut) and tagged kids/teens/family from LibCal audiences.
  * The library does NOT publish a blanket "all programs are free"
    statement, so free stays None unless the event's own text explicitly
    says so (tight phrase match — never inferred).
  * Branch venues: "Main Library" -> Fletcher Free Library (registry
    resolves address); "New North End Branch" kept verbatim; "Offsite
    Location" -> venue None (the room/park is only in the title/blurb).
"""
from __future__ import annotations

import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common

SOURCE = "fletcherfree"
LABEL = "Fletcher Free Library"

CAL_ID = 21587
API = ("https://fletcherfree.libcal.com/ajax/calendar/list"
       f"?c={CAL_ID}&date={{day}}&perpage=100&page={{page}}")

_ONLINE_RE = re.compile(r"\bonline\b|\bvirtual\b|\bzoom\b|\bwebinar\b", re.I)

# Explicit-free phrases only; "free books", "feel free", "gluten-free" etc.
# must NOT trigger. Accuracy is existential — when unsure, free stays None.
_FREE_RE = re.compile(
    r"free (?:and open to (?:the public|all|everyone)|event\b|program\b|"
    r"admission\b|of charge\b|to (?:attend|all|the public)\b)|"
    r"(?:admission|event|program|class|workshop|entry) is free|"
    r"this (?:event|program) is free", re.I)

_KID_AUD = re.compile(r"early learner|youth", re.I)
_TEEN_AUD = re.compile(r"teen|tween", re.I)
_FAMILY_AUD = re.compile(r"family|all ages", re.I)
_ADULT_AUD = re.compile(r"adult", re.I)


def _day_results(day: date) -> list[dict]:
    """All listings for one calendar day (paginate, though >100/day is rare)."""
    out: list[dict] = []
    for page in range(1, 6):                       # safety cap
        data = common.fetch_json(API.format(day=day.isoformat(), page=page))
        results = data.get("results") or []
        out.extend(results)
        total = int(data.get("total_results") or 0)
        if len(out) >= total or not results:
            break
    else:
        common.log(f"{SOURCE}: pagination cap hit on {day}")
    return out


def _venue_bits(item: dict):
    """LibCal campus/location -> (venue, town, room)."""
    campus = (item.get("campus") or "").strip()
    room = (item.get("location") or "").strip() or None
    if campus.lower().startswith("main library"):
        return "Fletcher Free Library", "Burlington", room
    if campus.lower().startswith("new north end"):
        # keep LibCal's own branch name; "Fletcher Free ... Branch" would
        # substring-match the main library in venues.json (wrong address)
        return "New North End Branch", "Burlington", None
    if campus.lower().startswith("offsite"):
        # actual site lives only in the title/description; don't invent one
        return None, None, room
    if room and room.lower().startswith("new north end"):
        return "New North End Branch", "Burlington", None
    if room:  # no campus but a named room -> it's in the main building
        return "Fletcher Free Library", "Burlington", room
    return None, None, None


def _audience_tags(item: dict) -> list[str]:
    tags: list[str] = []
    names = " ".join(a.get("name", "") for a in item.get("audiences") or [])
    if _KID_AUD.search(names):
        tags.append("kids")
    if _TEEN_AUD.search(names):
        tags.append("teens")
    if _FAMILY_AUD.search(names):
        tags.append("family")
    return tags


def _category(item: dict, tags: list[str], title: str, desc: str | None,
              venue: str | None) -> str | None:
    guess = common.classify(title, desc, venue)
    kid_focused = ("kids" in tags or "teens" in tags or
                   ("family" in tags and not _ADULT_AUD.search(
                       " ".join(a.get("name", "") for a in item.get("audiences") or []))))
    if kid_focused and guess in ("other", "community"):
        return "family"
    return guess


def _is_online(item: dict) -> bool:
    if item.get("online_event"):
        return True
    hay = f"{item.get('campus') or ''} {item.get('location') or ''}"
    return bool(_ONLINE_RE.search(hay))


def fetch(window_start: date, window_end: date) -> list[dict]:
    out: list[dict] = []
    seen: set[tuple] = set()
    day = window_start
    while day <= window_end:
        try:
            results = _day_results(day)
        except Exception as e:
            common.log(f"{SOURCE}: day {day} failed: {e}")
            day += timedelta(days=1)
            continue
        for item in results:
            try:
                ev = _build(item, day)
                if ev is None:
                    continue
                key = (item.get("id"), ev["date"])
                if key in seen:            # multi-day items repeat per day
                    continue
                seen.add(key)
                out.append(ev)
            except Exception as e:
                common.log(f"{SOURCE}: skipped {item.get('title')!r}: {e}")
        day += timedelta(days=1)
    return out


def _build(item: dict, day: date) -> dict | None:
    title = common.strip_tags(item.get("title") or "")
    url = item.get("url")
    if not title or not url:
        return None
    if _is_online(item):
        return None

    startdt, enddt = item.get("startdt"), item.get("enddt")
    if item.get("all_day"):
        start = date.fromisoformat(startdt[:10]) if startdt else day
        end = None
    else:
        start = datetime.strptime(startdt, "%Y-%m-%d %H:%M:%S").replace(
            tzinfo=common.TZ) if startdt else day
        end = (datetime.strptime(enddt, "%Y-%m-%d %H:%M:%S").replace(
            tzinfo=common.TZ) if enddt else None)
        # multi-day timed span listed again each day -> keep first day only
        if startdt and startdt[:10] != day.isoformat():
            if date.fromisoformat(startdt[:10]) < day:
                return None

    venue, town, room = _venue_bits(item)
    desc = item.get("shortdesc") or item.get("description") or None
    if desc:
        desc = common.strip_tags(desc)
    # offsite outreach (YSO etc.): town only when the text itself says so
    if town is None and desc and re.search(r"\bBurlington\b", desc) \
            and "South Burlington" not in desc:
        town = "Burlington"
    if room and desc:
        desc = f"{room}. {desc}"
    elif room:
        desc = room

    cost = (item.get("registration_cost") or "").strip() or None
    free = None
    if _FREE_RE.search(f"{title} {desc or ''}"):
        free = True

    tags = _audience_tags(item)
    recurring = "Recurring" if item.get("recurring_event") else None

    return common.make_event(
        source=SOURCE, title=title, url=url, start=start, end=end,
        venue=venue, town=town, price=cost, free=free,
        category=_category(item, tags, title, desc, venue),
        description=desc, tags=tags, recurring=recurring,
    )
