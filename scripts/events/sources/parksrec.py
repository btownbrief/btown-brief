"""Burlington Parks, Recreation & Waterfront — city calendars.

enjoyburlington.com (the old WordPress site) now 301-redirects to
burlingtonvt.gov/735/Parks-Recreation-Waterfront: the department lives on
the city's CivicPlus site, so The Events Calendar JSON / ?ical=1 no longer
exist. We use the CivicPlus per-category iCalendar exports instead:

    /common/modules/iCalendar/iCalendar.aspx?catID={N}&feed=calendar

    31 = Parks Events            (Leddy Beach Bites, concerts, ...)
    29 = Recreation Drop-in Programs  (public skate, table tennis, ...)
    30 = Cultural Calendar       (cross-listed park events)

Feeds are pre-expanded (one VEVENT per occurrence, UID == calendar EID),
deduped across feeds by UID. Each VEVENT's DESCRIPTION holds the real
detail-page URL (calendar.aspx?EID=n). Cancellation notices ("No Public
Skate Today") are skipped — they are notices, not events. Descriptions are
enriched by fetching ONE detail page per unique title (capped) and reading
its itemprop="description". No price data exists in the feeds -> price/free
stay None (never guessed).
"""
from __future__ import annotations

import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common

SOURCE = "parksrec"
LABEL = "Burlington Parks & Rec"

BASE = "https://www.burlingtonvt.gov"
CAT_IDS = [31, 29, 30]          # Parks Events, Rec Drop-in, Cultural Calendar
MAX_DETAIL_FETCHES = 8

_CANCEL_RE = re.compile(r"^no\b.*\btoday\b", re.I)
_EID_RE = re.compile(r"calendar\.aspx\?EID=(\d+)", re.I)


def _split_location(loc: str | None):
    """CivicPlus LOCATION is 'Venue Name - 123 Street Road  Burlington VT ...'."""
    if not loc:
        return None, None
    loc = " ".join(loc.split())
    if " - " in loc:
        venue, address = loc.split(" - ", 1)
        return venue.strip() or None, address.strip() or None
    return loc, None


def _detail_description(url: str) -> str | None:
    page = common.fetch(url)
    m = re.search(r'(?s)<div[^>]*itemprop="description"[^>]*>(.*?)</div>', page)
    return common.strip_tags(m.group(1)) if m else None


def fetch(window_start: date, window_end: date) -> list[dict]:
    occurrences: list[dict] = []
    seen: set[tuple] = set()
    feeds_ok = 0
    for cat in CAT_IDS:
        url = f"{BASE}/common/modules/iCalendar/iCalendar.aspx?catID={cat}&feed=calendar"
        try:
            text = common.fetch(url)
            parsed = common.parse_ics(text, window_start, window_end)
            feeds_ok += 1
        except Exception as e:
            common.log(f"parksrec: feed catID={cat} failed: {e}")
            continue
        for occ in parsed:
            key = (occ.get("uid"), str(occ["start"]))
            if key in seen:
                continue
            seen.add(key)
            occurrences.append(occ)
    if feeds_ok == 0:
        raise RuntimeError("parksrec: all city iCalendar feeds failed")

    descriptions: dict[str, str | None] = {}
    out: list[dict] = []
    for occ in occurrences:
        try:
            title = occ.get("summary") or ""
            if not title or _CANCEL_RE.match(title.strip()):
                continue
            m = _EID_RE.search(occ.get("description") or "")
            eid = m.group(1) if m else (occ.get("uid") or "").strip()
            if eid and eid.isdigit():
                url = f"{BASE}/calendar.aspx?EID={eid}"
            else:
                url = f"{BASE}/calendar.aspx"
            venue, address = _split_location(occ.get("location"))

            tkey = title.strip().lower()
            if tkey not in descriptions:
                if eid and eid.isdigit() and len(descriptions) < MAX_DETAIL_FETCHES:
                    try:
                        descriptions[tkey] = _detail_description(url)
                    except Exception as e:
                        common.log(f"parksrec: detail {eid} failed: {e}")
                        descriptions[tkey] = None
                else:
                    descriptions[tkey] = None

            out.append(common.make_event(
                source=SOURCE,
                title=title,
                url=url,
                start=occ["start"], end=occ.get("end"),
                venue=venue, address=address,
                description=descriptions.get(tkey),
                recurring=occ.get("recurring"),
            ))
        except Exception as e:
            common.log(f"parksrec: skipped {occ.get('summary')!r}: {e}")
    return out
