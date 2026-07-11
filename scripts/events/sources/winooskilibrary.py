"""Winooski Memorial Library — Library Programs on the City of Winooski
Time.ly calendar.

Method: winooskivt.gov/library embeds calendar.time.ly/nt0nyapn filtered to
category 677448597 ("Library Programs"). That embed is backed by a public
JSON API which this module calls directly:

  GET https://timelyapp.time.ly/api/calendars/42605500/events
      ?start_date=...&end_date=...&categories=677448597
  header X-Api-Key: <frontend key>

The X-Api-Key below is Time.ly's shared *frontend* key, baked into the
public embed bundle (calendar.time.ly/<ver>/main.js) — not a secret. If
requests start returning 401/403, pull the current key out of main.js
(grep for `apiKey:"..."`).

Notes:
  * The API returns one item per occurrence in range — no RRULE math needed.
  * Venue: Time.ly items here carry no structured venue (spaces=[]), and
    programs are occasionally off-site (e.g. school gym, Landry Park) with
    the location stated only in the description. Venue is set to the
    library only when the listing text names it ("Join the Winooski
    Memorial Library..."); otherwise it stays None with town=Winooski.
    The library itself is 32 Malletts Bay Ave.
  * cost_display is "0" for everything but the public page renders no cost
    line, so that is NOT an explicit "free" — free=True only when the
    listing text says so (e.g. "Free! No registration required.").
"""
from __future__ import annotations

import json
import re
import sys
import urllib.parse
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).parents[1]))
import common

SOURCE = "winooskilibrary"
LABEL = "Winooski Memorial Library"

CALENDAR_ID = 42605500              # City of Winooski
CATEGORY_ID = 677448597             # "Library Programs"
API = f"https://timelyapp.time.ly/api/calendars/{CALENDAR_ID}/events"
# Shared public frontend key from calendar.time.ly's embed JS (see docstring).
FRONTEND_KEY = "c6e5e0363b5925b28552de8805464c66f25ba0ce"
UTC = ZoneInfo("UTC")

_AT_LIBRARY_RE = re.compile(r"winooski (?:memorial )?library", re.I)
_FREE_RE = re.compile(
    r"\bfree!|free (?:and open to (?:the public|all|everyone)|event\b|"
    r"program\b|admission\b|of charge\b|to (?:attend|all|the public)\b)|"
    r"(?:admission|event|program|class|workshop|entry) is free", re.I)
_ONLINE_RE = re.compile(r"\bvirtual\b|\bonline only\b|\bzoom only\b", re.I)


def _api_page(lo: date, hi: date, page: int) -> dict:
    qs = urllib.parse.urlencode({
        "start_date": lo.isoformat(), "end_date": hi.isoformat(),
        "categories": CATEGORY_ID, "per_page": 100, "page": page,
    })
    raw = common.fetch(f"{API}?{qs}", headers={"X-Api-Key": FRONTEND_KEY,
                                               "Accept": "application/json"})
    return json.loads(raw)["data"]


def _dt(item: dict, key: str) -> datetime | None:
    """'2026-07-11 14:30:00' UTC -> aware local datetime."""
    v = item.get(f"{key}_utc_datetime")
    if not v:
        return None
    return datetime.strptime(v, "%Y-%m-%d %H:%M:%S").replace(
        tzinfo=UTC).astimezone(common.TZ)


def fetch(window_start: date, window_end: date) -> list[dict]:
    items: list[dict] = []
    for page in range(1, 31):                        # safety cap
        data = _api_page(window_start, window_end, page)
        items.extend(data.get("items") or [])
        if not data.get("has_next"):
            break
    else:
        common.log(f"{SOURCE}: pagination cap hit")

    per_id: dict = {}
    for it in items:
        per_id.setdefault(it.get("id"), []).append(it)

    out: list[dict] = []
    for it in items:
        try:
            ev = _build(it, len(per_id.get(it.get("id"), [])) > 1)
            if ev:
                out.append(ev)
        except Exception as e:
            common.log(f"{SOURCE}: skipped {it.get('title')!r}: {e}")
    return out


def _build(item: dict, multi: bool) -> dict | None:
    title = common.strip_tags(item.get("title") or "")
    url = item.get("canonical_url") or item.get("url")
    if not title or not url:
        return None
    if item.get("event_status") == "cancelled":
        return None
    desc = item.get("description_short") or None
    if _ONLINE_RE.search(f"{title} {desc or ''}"):
        return None

    if item.get("allday"):
        start = date.fromisoformat(item["start_datetime"][:10])
        end = None
    else:
        start = _dt(item, "start")
        end = _dt(item, "end")
        if start is None:
            return None

    free = True if _FREE_RE.search(f"{title} {desc or ''}") else None
    # Venue only when the listing itself places the event at the library
    # ("Join the Winooski Memorial Library..."); events hosted elsewhere
    # (school gym, parks) don't name it, and stay venue-less.
    venue = ("Winooski Memorial Library"
             if _AT_LIBRARY_RE.search(f"{title} {desc or ''}") else None)

    return common.make_event(
        source=SOURCE, title=title, url=url, start=start, end=end,
        venue=venue, town="Winooski", free=free,
        description=desc,
        recurring="Multiple dates" if multi else None,
    )
