"""Champlain Valley (WFFF/ABC22 community calendar) via the CitySpark API.

The station page (mychamplainvalley.com/calendar) is a JS-rendered CitySpark
widget behind PerimeterX bot protection, but the widget's own JSON API at
portal.cityspark.com is open. The portal script
(https://portal.cityspark.com/PortalScripts/MyChamplainValley) exposes
ppid=8209 and slug "MyChamplainValley"; POST /v1/events/MyChamplainValley
with a date range + lat/lng/distance returns one record per occurrence date.

Quirks handled here:
  * DateStart/DateEnd carry a fake trailing "Z" — values are actually
    America/New_York local times (verified: Lake Monsters 6:35pm game comes
    back as 18:35:00Z).
  * `Free` is True/False but False looks like an unfilled default (~95% of
    events), so we only trust Free=True; False -> unknown.
  * Community-submitted junk: events with no venue AND no address are skipped.

Detail URLs follow the widget's Vue router (path "/details/:slug/:pid/:time?"
with slugify = lowercase + \\W+ -> "-", time = DateStart[:13]).
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime

import common

SOURCE = "champlainvalley"
LABEL = "Champlain Valley (WFFF calendar)"

API = "https://portal.cityspark.com/v1/events/MyChamplainValley"
PPID = 8209
BASE_URL = "https://www.mychamplainvalley.com/calendar"
# Widget default view: 10-mile radius; centered on downtown Burlington.
LAT, LNG, DISTANCE_MI = 44.4759, -73.2121, 10
MAX_PAGES = 30

ALLOWED_TOWNS = {
    "burlington", "south burlington", "winooski", "essex", "essex junction",
    "colchester", "shelburne", "williston",
}


def _slugify(name: str) -> str:
    """Match the widget's slugify: lowercase, \\W+ -> '-' (ASCII \\w)."""
    return re.sub(r"[^A-Za-z0-9_]+", "-", (name or "").lower())


def _detail_url(ev: dict) -> str:
    time_part = (ev.get("DateStart") or "")[:13]  # YYYY-MM-DDTHH
    return f"{BASE_URL}/#/details/{_slugify(ev.get('Name', ''))}/{ev['PId']}/{time_part}"


def _parse_local(iso: str | None) -> datetime | None:
    """CitySpark datetimes are local wall-clock with a bogus 'Z' suffix."""
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso.rstrip("Z"))
    except ValueError:
        return None
    return dt.replace(tzinfo=common.TZ)


def _town(ev: dict) -> str | None:
    city_state = ev.get("CityState") or ""
    if "," not in city_state:
        return None
    town, state = (p.strip() for p in city_state.rsplit(",", 1))
    if state.upper() != "VT":
        return None
    return town or None


def _price(ev: dict):
    """-> (price_text, free). Only trust Free=True; False is a default."""
    if ev.get("Free") is True:
        return "Free", True
    lo, hi = ev.get("Price"), ev.get("PriceHigh")

    def fmt(v):
        return f"${v:g}" if float(v) == int(v) else f"${v:.2f}"

    if isinstance(lo, (int, float)) and lo > 0:
        if isinstance(hi, (int, float)) and hi > lo:
            return f"{fmt(lo)}–{fmt(hi)}", None
        return fmt(lo), None
    return None, None


def fetch(window_start: date, window_end: date) -> list[dict]:
    events: list[dict] = []
    seen: set[tuple] = set()
    skip = 0
    for page in range(MAX_PAGES):
        body = json.dumps({
            "ppid": PPID,
            "start": f"{window_start.isoformat()}T00:00:00",
            "end": f"{window_end.isoformat()}T23:59:59",
            "lat": LAT, "lng": LNG, "distance": DISTANCE_MI,
            "skip": skip,
        }).encode()
        resp = json.loads(common.fetch(
            API, method="POST", data=body,
            headers={"Content-Type": "application/json"}))
        if not resp.get("Success"):
            raise RuntimeError(f"CitySpark error: {resp.get('ErrorMessage')}")
        batch = resp.get("Value") or []
        if not batch:
            break
        for ev in batch:
            try:
                made = _make(ev, window_start, window_end)
            except Exception as e:  # one junk record must not kill the source
                common.log(f"[{SOURCE}] skipping record {ev.get('PId')}: {e}")
                continue
            if made:
                key = (made["id"],)
                if key not in seen:
                    seen.add(key)
                    events.append(made)
        skip += len(batch)
    else:
        common.log(f"[{SOURCE}] WARNING: hit {MAX_PAGES}-page safety cap")
    return events


def _make(ev: dict, lo: date, hi: date) -> dict | None:
    title = (ev.get("Name") or "").strip()
    if not title or not ev.get("PId"):
        return None

    town = _town(ev)
    if not town or town.lower() not in ALLOWED_TOWNS:
        return None

    venue = (ev.get("Venue") or "").strip() or None
    address = (ev.get("Address") or "").strip() or None
    if not venue and not address:
        return None  # community-submitted junk with no location

    start_dt = _parse_local(ev.get("DateStart"))
    if start_dt is None:
        return None
    if start_dt.date() < lo or start_dt.date() > hi:
        return None
    all_day = bool(ev.get("AllDay")) or not ev.get("HasTime")
    start = start_dt.date() if all_day else start_dt
    end = None
    if not all_day:
        end_dt = _parse_local(ev.get("DateEnd"))
        if end_dt and end_dt > start_dt:
            end = end_dt

    if address and town.lower() not in address.lower():
        address = f"{address}, {town}, VT"

    price_text, free = _price(ev)

    # Descriptions are markdown-ish; the widget strips \ * ___ before display.
    description = ev.get("Description") or None
    if description:
        description = re.sub(r"\\|\*|___", "", description)

    return common.make_event(
        source=SOURCE,
        title=title,
        url=_detail_url(ev),
        start=start,
        end=end,
        venue=venue,
        address=address,
        town=town,
        price=price_text,
        free=free,
        description=description,
    )
