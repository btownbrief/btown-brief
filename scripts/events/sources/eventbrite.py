"""Eventbrite — Burlington VT area events.

Method: Eventbrite's paginated search page
    https://www.eventbrite.com/d/vt--burlington/all-events/?start_date=..&end_date=..&page=N
embeds a `window.__SERVER_DATA__ = {...}` JSON blob whose
`search_data.events.results` list carries name / url / start date+time /
primary_venue (name + address incl. city) / is_online_event per event.

Prices come from a second, unauthenticated batch endpoint:
    https://www.eventbrite.com/api/v3/destination/events/?event_ids=..&expand=ticket_availability
whose `ticket_availability.is_free` flag is trustworthy (-> free=True) and
`minimum_ticket_price` gives a floor price. When that call fails we simply
leave price/free as None — never guess.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).parents[1]))
import common

SOURCE = "eventbrite"
LABEL = "Eventbrite"

LISTING = "https://www.eventbrite.com/d/vt--burlington/all-events/"
PAGE_CAP = 10          # safety cap; common.log()s a warning when hit
PRICE_BATCH = 20       # ids per ticket_availability API call

# Aggregator covers the whole region — keep Chittenden County (+ immediate
# neighbors already in common.TOWNS spirit) only.
KEEP_TOWNS = {
    "burlington", "south burlington", "winooski", "essex", "essex junction",
    "colchester", "shelburne", "williston", "richmond", "jericho",
    "hinesburg", "milton", "charlotte", "underhill", "westford",
    "huntington", "bolton", "st. george", "saint george",
}

_SERVER_DATA_RE = re.compile(r"window\.__SERVER_DATA__\s*=\s*")


def _server_data(page: str) -> dict | None:
    m = _SERVER_DATA_RE.search(page)
    if not m:
        return None
    try:
        obj, _ = json.JSONDecoder().raw_decode(page[m.end():])
        return obj
    except json.JSONDecodeError:
        return None


def _clean_town(city: str | None) -> str | None:
    if not city:
        return None
    return re.sub(r",\s*VT\.?$", "", city.strip(), flags=re.I).strip()


def _fetch_prices(event_ids: list[str]) -> dict[str, dict]:
    """id -> {'free': bool|None, 'price': str|None} via the destination API."""
    out: dict[str, dict] = {}
    for i in range(0, len(event_ids), PRICE_BATCH):
        chunk = event_ids[i:i + PRICE_BATCH]
        url = ("https://www.eventbrite.com/api/v3/destination/events/"
               f"?event_ids={','.join(chunk)}&expand=ticket_availability"
               f"&page_size={len(chunk)}")
        try:
            data = common.fetch_json(url)
        except Exception as e:
            common.log(f"  eventbrite: price lookup failed ({e}); leaving prices unknown")
            continue
        for ev in data.get("events", []):
            ta = ev.get("ticket_availability") or {}
            free = None
            price = None
            if ta.get("is_free") is True:
                free = True
                price = "Free"
            else:
                minp = ta.get("minimum_ticket_price") or {}
                try:
                    val = float(minp.get("major_value"))
                except (TypeError, ValueError):
                    val = None
                if val and val > 0:
                    price = f"${val:g}"
                # min == 0 but is_free False -> mixed/unknown; leave None
            out[str(ev.get("id"))] = {"free": free, "price": price}
    return out


def fetch(window_start, window_end):
    results: dict[str, dict] = {}   # eventbrite_event_id -> raw result
    page_count = None
    for page_num in range(1, PAGE_CAP + 1):
        url = (f"{LISTING}?start_date={window_start.isoformat()}"
               f"&end_date={window_end.isoformat()}&page={page_num}")
        try:
            page = common.fetch(url)
        except Exception as e:
            if page_num == 1:
                raise
            common.log(f"  eventbrite: page {page_num} failed ({e}); stopping")
            break
        data = _server_data(page)
        if not data:
            if page_num == 1:
                raise RuntimeError("eventbrite: __SERVER_DATA__ not found on listing page")
            break
        evs = ((data.get("search_data") or {}).get("events") or {})
        pagination = evs.get("pagination") or {}
        page_count = pagination.get("page_count")
        batch = evs.get("results") or []
        if not batch:
            break
        for r in batch:
            eid = str(r.get("eventbrite_event_id") or r.get("id") or "")
            if eid and eid not in results:
                results[eid] = r
        if page_count and page_num >= page_count:
            break
    else:
        common.log(f"  eventbrite: hit page cap {PAGE_CAP} "
                   f"(site reports {page_count} pages) — results truncated")

    # ---- filter to in-person, Chittenden-area events -----------------
    kept: list[tuple[str, dict]] = []
    for eid, r in results.items():
        if r.get("is_online_event"):
            continue
        if r.get("is_cancelled"):
            continue
        venue = r.get("primary_venue") or {}
        addr = venue.get("address") or {}
        town = _clean_town(addr.get("city"))
        region = (addr.get("region") or "").upper()
        if not town or town.lower() not in KEEP_TOWNS:
            continue
        if region and region != "VT":
            continue
        if not r.get("url") or not r.get("name") or not r.get("start_date"):
            continue
        kept.append((eid, r))

    prices = _fetch_prices([eid for eid, _ in kept]) if kept else {}

    events = []
    for eid, r in kept:
        try:
            venue = r.get("primary_venue") or {}
            addr = venue.get("address") or {}
            town = _clean_town(addr.get("city"))
            try:
                tz = ZoneInfo(r.get("timezone") or "America/New_York")
            except Exception:
                tz = common.TZ
            y, mo, d = (int(x) for x in r["start_date"].split("-"))
            start = None
            end = None
            tm = re.fullmatch(r"(\d{2}):(\d{2})", r.get("start_time") or "")
            if tm:
                start = datetime(y, mo, d, int(tm.group(1)), int(tm.group(2)), tzinfo=tz)
            else:
                from datetime import date as _date
                start = _date(y, mo, d)
            etm = re.fullmatch(r"(\d{2}):(\d{2})", r.get("end_time") or "")
            if etm and r.get("end_date") and isinstance(start, datetime):
                ey, em, ed = (int(x) for x in r["end_date"].split("-"))
                end = datetime(ey, em, ed, int(etm.group(1)), int(etm.group(2)), tzinfo=tz)
            pinfo = prices.get(eid, {})
            events.append(common.make_event(
                source=SOURCE,
                title=r["name"],
                url=r["url"],
                start=start,
                end=end,
                venue=venue.get("name"),
                address=addr.get("localized_address_display"),
                town=town,
                price=pinfo.get("price"),
                free=pinfo.get("free"),
                description=r.get("summary"),
            ))
        except Exception as e:
            common.log(f"  eventbrite: skipping event {eid}: {e}")
    return events


if __name__ == "__main__":
    lo, hi = common.default_window(14)
    for ev in fetch(lo, hi):
        print(json.dumps(ev, indent=1))
