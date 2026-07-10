"""Church Street Marketplace — churchstmarketplace.com/events/.

Method: the events page embeds a Timely (time.ly) calendar stream —
https://calendar.time.ly/vfaca7kw/stream?filter_groups_659983781=677491122
(the "Love Burlington" Timely calendar filtered to the Church Street /
downtown neighborhood group, which is exactly what the Marketplace's own
page displays). We call the same public JSON API the widget calls:

    GET https://timelyapp.time.ly/api/calendars/{CAL_ID}/events
        ?start_date=...&end_date=...&per_page=...&page=...&filter_groups_...

with the widget's public X-Api-Key (baked into calendar.time.ly's published
main.js; re-extracted automatically if it ever rotates and a 403 appears).

List responses include per-occurrence start/end (venue-local naive times +
timezone), taxonomy_venue (name/address/city) and taxonomy_category, so no
per-event detail fetches are needed. free=True only when the event carries
the explicit "Free Event" category (cost_display "0" alone is ambiguous and
is ignored). Venue defaults to "Church Street Marketplace" only when the
listing names no venue at all.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common

SOURCE = "churchst"
LABEL = "Church Street Marketplace"

CAL_ID = 54705107                       # Love Burlington calendar on time.ly
EMBED_SLUG = "vfaca7kw"
FILTER = "filter_groups_659983781=677491122"   # Neighborhood = Church St/downtown
API = f"https://timelyapp.time.ly/api/calendars/{CAL_ID}/events"
# Public key shipped in calendar.time.ly's widget bundle (not a secret).
_API_KEY = "c6e5e0363b5925b28552de8805464c66f25ba0ce"
MAX_PAGES = 30

# Chittenden-area towns we keep (rule 4); the feed is Burlington-centric.
_LOCAL = {t.lower() for t in common.TOWNS}

_CAT_MAP = {
    "live music": "music",
    "performance": None,        # too varied (music/theater); let classify()
    "art & exhibitions": "art",
    "film": "film",
    "food & drink": "food-drink",
    "family": "family",
    "market": "market",
    "sports & recreation": "sports",
    "talks & workshops": "learning",
}


def _api_key() -> str:
    return _API_KEY


def _refresh_api_key() -> str | None:
    """Re-extract the widget API key from the published bundle (403 fallback)."""
    try:
        stream = common.fetch(f"https://calendar.time.ly/{EMBED_SLUG}/stream")
        m = re.search(r'src="(https://calendar\.time\.ly/[\d.]+/main\.js)"', stream)
        if not m:
            return None
        bundle = common.fetch(m.group(1))
        k = re.search(r'apiKey:"([0-9a-f]{20,})"', bundle)
        return k.group(1) if k else None
    except Exception as e:
        common.log(f"churchst: api-key refresh failed: {e}")
        return None


def _get(url: str, key: str):
    return json.loads(common.fetch(url, headers={"X-Api-Key": key}))


def _fetch_pages(lo: date, hi: date) -> list[dict]:
    key = _api_key()
    events, page = [], 1
    while True:
        url = (f"{API}?group_by_date=1&start_date={lo.isoformat()}"
               f"&end_date={hi.isoformat()}&per_page=50&page={page}&{FILTER}")
        try:
            data = _get(url, key)
        except Exception as e:
            if "403" in str(e) and page == 1:
                fresh = _refresh_api_key()
                if fresh and fresh != key:
                    key = fresh
                    continue
            raise
        payload = data.get("data") or {}
        items = payload.get("items") or {}
        for day_events in items.values():
            events.extend(day_events)
        if not payload.get("has_next"):
            break
        if page >= MAX_PAGES:
            common.log(f"churchst: hit {MAX_PAGES}-page cap")
            break
        page += 1
    return events


def _naive_local(s: str | None, tzname: str | None):
    if not s:
        return None
    dt = datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
    tz = common.TZ
    if tzname and tzname != "America/New_York":
        try:
            from zoneinfo import ZoneInfo
            tz = ZoneInfo(tzname)
        except Exception:
            pass
    return dt.replace(tzinfo=tz)


def _one(ev: dict) -> dict | None:
    tax = ev.get("taxonomies") or {}
    venues = tax.get("taxonomy_venue") or []
    v = venues[0] if venues else {}
    venue = " ".join((v.get("title") or "").split()) or None
    city = (v.get("city") or "").strip()
    if city and city.lower() not in _LOCAL:
        return None                       # outside our coverage area
    city = city.title() if city else None
    address = v.get("address") or None
    if address and city:
        address = f"{address}, {city} VT"
    if venue and address:
        _, vinfo = common.resolve_venue(venue)
        if not vinfo:
            # Unregistered venue: drop the address, or make_event's
            # address-stem fallback would misfile every "N Church Street"
            # venue under the registry's street-only "Church St" entries.
            address = None

    cats = [(c.get("title") or "").strip()
            for c in tax.get("taxonomy_category") or []]
    free = True if any(c.lower() == "free event" for c in cats) else None
    category = None
    for c in cats:
        mapped = _CAT_MAP.get(c.lower())
        if mapped:
            category = mapped
            break

    price = None
    minp = ev.get("tickets_min_price")
    if minp not in (None, "", 0, "0"):
        price = f"${minp}"
    cost = ev.get("cost")
    if price is None and cost not in (None, "", 0, "0"):
        price = str(cost)

    start = ev.get("start_datetime")
    if not start:
        return None
    tzname = ev.get("timezone")
    sdt = _naive_local(start, tzname)
    if ev.get("allday"):
        sdt, edt = sdt.date(), None
    else:
        edt = _naive_local(ev.get("end_datetime"), tzname)
        if edt and edt <= sdt:
            edt = None

    return common.make_event(
        source=SOURCE,
        title=ev.get("title") or "",
        url=ev.get("canonical_url") or ev.get("url"),
        start=sdt, end=edt,
        venue=venue or "Church Street Marketplace",
        address=address,
        town=city,
        price=price, free=free,
        category=category,
        description=ev.get("description_short"),
    )


def fetch(window_start: date, window_end: date) -> list[dict]:
    out, seen = [], set()
    for ev in _fetch_pages(window_start, window_end):
        try:
            key = (ev.get("id"), ev.get("instance"))
            if key in seen:
                continue
            seen.add(key)
            e = _one(ev)
            if e is None:
                continue
            d = date.fromisoformat(e["date"])
            if window_start <= d <= window_end:
                out.append(e)
        except Exception as exc:
            common.log(f"churchst: skipped {ev.get('title')!r}: {exc}")
    return out
