"""Love Burlington (loveburlington.org) — downtown Burlington's event calendar.

The /events page embeds a Time.ly ("Timely") calendar widget
(https://calendar.time.ly/vfaca7kw). The widget is an Angular SPA, so we call
the JSON API it uses, with the public API key shipped inside the widget's own
JS bundle (calendar.time.ly/<ver>/main.js):

    GET https://timelyapp.time.ly/api/calendars/info?url=<calendar url>
        -> resolves the numeric calendar id (54705107)
    GET https://timelyapp.time.ly/api/calendars/<id>/events
        ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&per_page=&page=
        (header X-Api-Key: <key>)

IMPORTANT: a single ranged query silently collapses SOME recurring series to
their first instance (e.g. a daily 9pm event returned once while another
daily event came back per-date; 125 items vs the API's own total of 135 for
a 14-day window), and no query parameter disables that. So we query ONE DAY
AT A TIME — day queries return every instance, verified equal to the API
total. A day query also returns multi-day spans (exhibits, camps) covering
that day even when they started months earlier, which is the source itself
asserting the event occurs that day; span occurrences away from their start
date are emitted as all-day since per-day hours aren't stated.

`cost` is used verbatim when present; `cost_display` is a widget settings
code, NOT a price, and is ignored. free=True only from an explicit
"Free Event" category. Note: loveburlington.com (.com) is an unrelated
parked domain; the org's site is .org and briefly refused connections
during development — transient, retried fine.
"""
from __future__ import annotations

import re
import sys
import urllib.parse
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).parents[1]))
import common
from common import TZ, log, make_event

SOURCE = "loveburlington"
LABEL = "Love Burlington"

CAL_URL = "https://calendar.time.ly/vfaca7kw"
API_BASE = "https://timelyapp.time.ly/api"
# Public key embedded in the Time.ly widget bundle (main.js: apiKey:"...").
API_KEY = "c6e5e0363b5925b28552de8805464c66f25ba0ce"
CAL_ID = 54705107          # "Love Burlington Calendar" (fallback if info fails)
PER_PAGE = 50
MAX_PAGES_PER_DAY = 5      # >250 instances in one day would be a data error

_HDRS = {"X-Api-Key": API_KEY, "Accept": "application/json"}

# "Free with admission/membership" is conditional, not free — block
# common.parse_price from flagging it free off the bare word "free".
_CONDITIONAL_FREE = re.compile(r"\bfree\s+(with|for\s+member)", re.I)

# Time.ly taxonomy_category title -> our category (unambiguous ones only;
# the rest fall through to common.classify()). "Free Event" is handled as
# the free flag, not a category.
_CAT_MAP = {
    "live music": "music",
    "family fun": "family",
    "educational": "learning",
    "class": "learning",
    "sports": "sports",
    "art": "art",
    "food": "food-drink",
    "drink": "food-drink",
}


def _calendar_id() -> int:
    try:
        info = common.fetch_json(
            API_BASE + "/calendars/info?url=" + urllib.parse.quote(CAL_URL, safe=""),
            headers=_HDRS)
        return int(info["data"]["id"])
    except Exception as e:
        log(f"  [{SOURCE}] calendar info lookup failed ({e}); "
            f"using cached id {CAL_ID}")
        return CAL_ID


def _day_items(cal_id: int, day: date) -> list[dict]:
    """Every event instance the calendar lists for one day (paginated)."""
    items: list[dict] = []
    for page in range(1, MAX_PAGES_PER_DAY + 1):
        params = urllib.parse.urlencode({
            "start_date": day.isoformat(), "end_date": day.isoformat(),
            "per_page": PER_PAGE, "page": page,
        })
        data = common.fetch_json(
            f"{API_BASE}/calendars/{cal_id}/events?{params}", headers=_HDRS)["data"]
        got = data.get("items") or {}
        for evs in (got.values() if isinstance(got, dict) else [got]):
            items.extend(evs)
        if not data.get("has_next"):
            break
    else:
        log(f"  [{SOURCE}] WARNING: {day} hit the per-day pagination cap")
    return items


def _parse_local(s: str, tz) -> datetime:
    return datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=tz)


def _venue(item: dict):
    """(venue, address, town) from the taxonomy_venue attached to the item."""
    vx = (item.get("taxonomies") or {}).get("taxonomy_venue") or []
    if not vx:
        return None, None, None
    v = vx[0]
    town = (v.get("city") or "").strip() or None
    return ((v.get("title") or "").strip() or None,
            (v.get("address") or "").strip() or None,
            town.title() if town else None)


def _cats(item: dict) -> list[str]:
    cx = (item.get("taxonomies") or {}).get("taxonomy_category") or []
    return [(c.get("title") or "").strip() for c in cx]


def _is_allday(item: dict, sdt: datetime, edt: datetime | None) -> bool:
    if item.get("allday"):
        return True
    # Time.ly stores date-only events as 00:00:00 -> 23:59:xx
    return (edt is not None and sdt.time() == datetime.min.time()
            and edt.date() == sdt.date() and (edt.hour, edt.minute) == (23, 59))


def fetch(window_start: date, window_end: date) -> list[dict]:
    cal_id = _calendar_id()

    # occurrences[(event id, day)] = (item, day)  — day-by-day, deduped
    occurrences: dict[tuple, tuple[dict, date]] = {}
    day = window_start
    while day <= window_end:
        try:
            for it in _day_items(cal_id, day):
                if it.get("event_status") == "cancelled":
                    continue
                occurrences.setdefault((it.get("id"), day), (it, day))
        except Exception as e:
            log(f"  [{SOURCE}] day {day} failed ({e}); continuing")
        day += timedelta(days=1)
    log(f"  [{SOURCE}] {len(occurrences)} occurrences across "
        f"{(window_end - window_start).days + 1} day queries")

    # ids occurring on >1 date = recurring series (no rule text in the API)
    date_count: dict = {}
    for (eid, d) in occurrences:
        date_count[eid] = date_count.get(eid, 0) + 1

    events: list[dict] = []
    for (eid, day), (it, _) in sorted(occurrences.items(),
                                      key=lambda kv: (kv[0][1], str(kv[0][0]))):
        try:
            tz = TZ
            if it.get("timezone"):
                try:
                    tz = ZoneInfo(it["timezone"])
                except Exception:
                    pass
            sdt = _parse_local(it["start_datetime"], tz)
            edt = _parse_local(it["end_datetime"], tz) if it.get("end_datetime") else None

            url = it.get("url") or it.get("canonical_url")
            if not url:
                log(f"  [{SOURCE}] skipped (no url): {it.get('title')!r}")
                continue

            cats = _cats(it)
            category = None
            for c in cats:
                category = _CAT_MAP.get(c.lower())
                if category:
                    break
            free = True if any(c.lower() == "free event" for c in cats) else None
            if _CONDITIONAL_FREE.search(it.get("cost") or ""):
                free = False
            venue, address, town = _venue(it)
            base = dict(
                source=SOURCE, title=it["title"], url=url,
                venue=venue, address=address, town=town,
                price=it.get("cost"), free=free, category=category,
                description=it.get("description_short"),
            )
            allday = _is_allday(it, sdt, edt)

            # multi-day span whose start is another day: hours for THIS day
            # aren't stated -> all-day occurrence, "Through <end>" marker
            if sdt.date() != day:
                end_d = edt.date() if edt else None
                through = (f"Through {end_d.strftime('%B')} {end_d.day}, "
                           f"{end_d.year}"
                           if end_d and end_d > sdt.date() else None)
                events.append(make_event(**base, start=day, recurring=through))
                continue

            recurring = None
            if edt is not None and edt.date() > day + timedelta(days=1) or (
                    edt is not None and edt.date() == day + timedelta(days=1)
                    and edt.time() > sdt.time()):
                # first day of a genuine multi-day span (not an overnight gig)
                recurring = (f"Through {edt.date().strftime('%B')} "
                             f"{edt.date().day}, {edt.date().year}")
                edt = None          # span end is not this occurrence's end
            elif date_count.get(eid, 0) > 1:
                recurring = "Multiple dates"

            if allday:
                events.append(make_event(**base, start=day, recurring=recurring))
            else:
                events.append(make_event(**base, start=sdt, end=edt,
                                         recurring=recurring))
        except Exception as e:
            log(f"  [{SOURCE}] skipped item {eid!r} on {day}: {e}")
    return events
