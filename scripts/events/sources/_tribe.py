"""Shared helpers for sites running The Events Calendar (Tribe) WordPress
plugin, which exposes /wp-json/tribe/events/v1/events. Used by echo.py and
shelburnemuseum.py. Not a source module (leading underscore = skipped).
"""
from __future__ import annotations

import html
import re
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common

MAX_PAGES = 30


def fetch_all(base_url: str, lo: date, hi: date) -> list[dict]:
    """All Tribe events starting within [lo, hi], paginated to exhaustion."""
    events: list[dict] = []
    page = 1
    while True:
        url = (f"{base_url}/wp-json/tribe/events/v1/events"
               f"?start_date={lo.isoformat()}&end_date={hi.isoformat()}"
               f"&per_page=50&page={page}")
        data = common.fetch_json(url)
        events.extend(data.get("events") or [])
        total_pages = int(data.get("total_pages") or 1)
        if page >= total_pages:
            break
        if page >= MAX_PAGES:
            common.log(f"_tribe: hit {MAX_PAGES}-page cap for {base_url}")
            break
        page += 1
    return events


def title_of(ev: dict) -> str:
    return " ".join(html.unescape(ev.get("title") or "").split())


def start_of(ev: dict):
    """-> aware local datetime, or a date for all-day events.
    Tribe's start_date is venue-local ("YYYY-MM-DD HH:MM:SS")."""
    dt = datetime.strptime(ev["start_date"], "%Y-%m-%d %H:%M:%S")
    if ev.get("all_day"):
        return dt.date()
    return dt.replace(tzinfo=common.TZ)


def end_of(ev: dict):
    raw = ev.get("end_date")
    if not raw or ev.get("all_day"):
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d %H:%M:%S").replace(tzinfo=common.TZ)
    except ValueError:
        return None


def series_url(ev: dict) -> str:
    """Recurring occurrences get URLs like .../event/slug/2026-07-10/;
    strip the date suffix to link the series page instead."""
    return re.sub(r"/\d{4}-\d{2}-\d{2}/?$", "/", ev.get("url") or "")


def split_exhibits(events: list[dict], lo: date, hi: date,
                   min_count: int = 5, density: float = 0.7):
    """Partition Tribe events into (exhibit_groups, singles).

    A title whose occurrences cover most days of the window (>= density of
    window days, and at least min_count dates) is a long-running exhibit
    that the site expands into daily open-hours entries; we collapse those.
    Weekly/sparse programs stay as individual occurrences.
    exhibit_groups: list of occurrence-lists sorted by date.
    """
    by_title: dict[str, list[dict]] = {}
    for ev in events:
        by_title.setdefault(title_of(ev), []).append(ev)
    window_days = max(1, (hi - lo).days + 1)
    exhibits, singles = [], []
    for evs in by_title.values():
        dates = {(ev.get("start_date") or "")[:10] for ev in evs}
        if len(dates) >= min_count and len(dates) / window_days >= density:
            evs.sort(key=lambda e: e.get("start_date") or "")
            exhibits.append(evs)
        else:
            singles.extend(evs)
    return exhibits, singles


_THROUGH_RE = re.compile(r"through\s+([A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4})")


def on_view_note(description_html: str | None, last_seen: date) -> str:
    """'On view through <date>' when the event copy states an end date,
    else a conservative note based on the last occurrence actually seen."""
    text = common.strip_tags(description_html or "")
    m = _THROUGH_RE.search(text)
    if m:
        return f"On view through {m.group(1).rstrip(',').replace('  ', ' ')}"
    return f"On view daily through at least {last_seen.strftime('%b %-d')}"
