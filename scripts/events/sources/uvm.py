"""UVM & Colleges — public-facing campus events.

Sub-sources:
  * UVM              — events.uvm.edu (Localist), clean JSON API /api/2/events.
  * Champlain College — champlain.edu (The Events Calendar / Tribe REST API).
  * Saint Michael's   — smcvt.edu (The Events Calendar / Tribe REST API).

The Localist helpers (localist_instances / localist_event) are shared with
sources/uvmbored.py, which is the same calendar filtered to the UVM Bored
channel; results are cached per window so both sources cost one crawl.
"""

from __future__ import annotations

import html
import re
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import common

SOURCE = "uvm"
LABEL = "UVM & Colleges"

LOCALIST_API = "https://events.uvm.edu/api/2/events"
# Localist filter id for "UVM BORED" under event_exclude_event_from: events
# carrying it are hidden from the events.uvm.edu/bored channel (used by
# sources/uvmbored.py).
BORED_EXCLUDE_ID = 46259325533573

TRIBE_SITES = [
    ("Champlain College", "https://www.champlain.edu"),
    ("Saint Michael's College", "https://www.smcvt.edu"),
]

# Chittenden-County-area towns we keep (UVM's calendar carries statewide
# Extension events; the colleges post far-flung alumni meetups).
_REGION = {t.lower() for t in common.TOWNS} | {"essex jct"}

# Internal / not-public-facing campus items, identified by title.
_INTERNAL_RE = re.compile(
    r"thesis (?:defense|proposal)|dissertation (?:defense|proposal|seminar)"
    r"|\bdefense\b[^.]*\b(?:thesis|dissertation|ph\.?d|doctoral)"
    r"|faculty senate|staff council|board of trustees|search committee"
    r"|committee meeting|members[- ]only|office hours|employee orientation"
    r"|\bdeadline\b|last day to|add/drop", re.I)

_VIRTUAL_RE = re.compile(r"\bwebinar\b|\bvirtual\b|online[- ]only|\bzoom\b", re.I)


# ------------------------------------------------------------- UVM (Localist)

_localist_cache: dict[tuple[str, str], list] = {}


def localist_instances(window_start: date, window_end: date) -> list[tuple[dict, dict]]:
    """All (event, event_instance) pairs from events.uvm.edu in the window.

    The Localist API returns one entry per occurrence (recurring/multi-day
    events appear once per date, each carrying that date's single instance).
    Cached per window so uvm.py and uvmbored.py share one crawl.
    """
    key = (window_start.isoformat(), window_end.isoformat())
    if key in _localist_cache:
        return _localist_cache[key]
    out: list[tuple[dict, dict]] = []
    page = 1
    while True:
        url = f"{LOCALIST_API}?start={key[0]}&end={key[1]}&pp=100&page={page}"
        data = common.fetch_json(url)
        for item in data.get("events") or []:
            ev = (item or {}).get("event") or {}
            for wrap in ev.get("event_instances") or []:
                inst = (wrap or {}).get("event_instance") or {}
                if inst.get("start"):
                    out.append((ev, inst))
        total_pages = int((data.get("page") or {}).get("total") or 1)
        if page >= total_pages:
            break
        page += 1
        if page > 30:
            common.log("uvm: hit 30-page safety cap on events.uvm.edu")
            break
    _localist_cache[key] = out
    return out


def localist_event(ev: dict, inst: dict, *, source: str,
                   signals: dict | None = None) -> dict | None:
    """One Localist (event, instance) -> make_event() dict, or None to skip."""
    title = (ev.get("title") or "").strip()
    url = (ev.get("localist_url") or "").strip()
    if not title or not url:
        return None
    if _INTERNAL_RE.search(title):
        return None
    if ev.get("experience") == "virtual":
        return None
    geo = ev.get("geo") or {}
    city = (geo.get("city") or "").strip()
    if city and city.lower() not in _REGION:
        return None  # statewide Extension events etc.
    town = city or None
    if not city:
        # No geo city: resolve a region town from the address/venue text, or
        # weed out events that are clearly located elsewhere in Vermont.
        addr = ev.get("address") or ""
        town = (common.town_from_address(addr)
                or common.town_from_address(ev.get("location_name") or ""))
        if not town:
            if re.search(r"\bVT\b|\bVermont\b", addr):
                return None  # street address names an out-of-region town
            depts = " ".join(d.get("name", "")
                             for d in ev.get("departments") or [])
            if "extension" in depts.lower():
                return None  # statewide Extension programming, place unknown

    start = common.parse_iso(inst["start"])
    end = None
    if inst.get("all_day"):
        if isinstance(start, datetime):
            start = start.date()
    elif inst.get("end"):
        try:
            end = common.parse_iso(inst["end"])
        except ValueError:
            end = None

    price = (ev.get("ticket_cost") or "").strip() or None
    # Localist has an explicit organizer-set "free" checkbox; never infer it.
    free = True if ev.get("free") is True else None

    recurring = None
    first, last = ev.get("first_date"), ev.get("last_date")
    if first and last and first != last:
        recurring = f"multiple dates through {last}"

    return common.make_event(
        source=source, title=title, url=url, start=start, end=end,
        venue=(ev.get("location_name") or "").strip() or None,
        address=(ev.get("address") or "").strip() or None,
        town=town, price=price, free=free,
        description=ev.get("description_text") or None,
        recurring=recurring, signals=signals)


# ------------------------------------------- Champlain & SMC (Tribe REST API)

def _tribe_event(e: dict, site: str) -> dict | None:
    title = html.unescape(e.get("title") or "").strip()
    url = (e.get("url") or "").strip()
    if not title or not url:
        return None
    if _INTERNAL_RE.search(title):
        return None

    venue = e.get("venue") or {}
    if isinstance(venue, list):
        venue = venue[0] if venue else {}
    vname = html.unescape(venue.get("venue") or "").strip() or None
    city = (venue.get("city") or "").strip()

    desc = e.get("description") or ""
    # Tribe prepends an empty schedule <div> full of markup noise.
    desc = re.sub(r'<div[^>]*class="tribe-events-schedule.*?</div>', " ",
                  desc, flags=re.S)

    town = None
    if city:
        if city.lower() not in _REGION:
            return None  # out-of-region alumni events (Fenway Park etc.)
        town = city
    else:
        # No venue city: keep only if it's clearly in-region and not virtual.
        hay = f"{title} {common.strip_tags(desc)}"
        if _VIRTUAL_RE.search(hay):
            return None
        town = common.town_from_address(hay)
        if not town:
            return None

    start_s = e.get("start_date")
    if not start_s:
        return None
    if e.get("all_day"):
        start: datetime | date = date.fromisoformat(start_s[:10])
        end = None
    else:
        start = common.parse_iso(start_s)
        end = common.parse_iso(e["end_date"]) if e.get("end_date") else None

    address = ", ".join(x for x in (venue.get("address"), venue.get("city"),
                                    venue.get("stateprovince")) if x) or None
    return common.make_event(
        source=SOURCE, title=title, url=url, start=start, end=end,
        venue=vname, address=address, town=town,
        price=(e.get("cost") or "").strip() or None,
        description=desc or None)


def _tribe_fetch(site: str, base: str, lo: date, hi: date) -> list[dict]:
    out: list[dict] = []
    page = 1
    while True:
        url = (f"{base}/wp-json/tribe/events/v1/events"
               f"?start_date={lo.isoformat()}&end_date={hi.isoformat()}"
               f"&per_page=50&page={page}")
        data = common.fetch_json(url)
        for e in data.get("events") or []:
            try:
                ev = _tribe_event(e, site)
            except Exception as ex:  # one bad item must not sink the site
                common.log(f"uvm: {site} item skipped ({ex})")
                continue
            if ev:
                out.append(ev)
        if page >= int(data.get("total_pages") or 1):
            break
        page += 1
        if page > 30:
            common.log(f"uvm: hit 30-page safety cap on {base}")
            break
    return out


# ---------------------------------------------------------------------- fetch

def fetch(window_start: date, window_end: date) -> list[dict]:
    events: list[dict] = []

    # UVM Localist is the backbone — if it is down, fail the whole source so
    # update.py keeps last-good data instead of decaying it.
    counts = {}
    seen: set[str] = set()
    for ev, inst in localist_instances(window_start, window_end):
        try:
            e = localist_event(ev, inst, source=SOURCE)
        except Exception as ex:
            common.log(f"uvm: Localist item skipped ({ex})")
            continue
        if e and e["id"] not in seen:
            seen.add(e["id"])
            events.append(e)
    counts["uvm"] = len(events)

    for site, base in TRIBE_SITES:
        try:
            got = _tribe_fetch(site, base, window_start, window_end)
            events.extend(got)
            counts[site] = len(got)
        except Exception as ex:  # best-effort: log and move on
            common.log(f"uvm: {site} fetch failed ({ex})")
            counts[site] = "error"
    common.log(f"uvm: sub-source counts {counts}")
    return events
