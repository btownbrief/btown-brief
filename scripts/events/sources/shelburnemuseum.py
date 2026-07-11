"""Shelburne Museum — shelburnemuseum.org/calendar.

Method: The Events Calendar (Tribe) REST API at
/wp-json/tribe/events/v1/events (the site runs WordPress + Tribe).

Tribe venues here are on-grounds sub-locations ("Museum Concert Field",
"Pizzagalli Center ... Classroom", ...); we normalize venue to
"Shelburne Museum" (resolves in venues.json -> address/coords/town) and
keep the sub-location at the front of the description. An event whose
Tribe venue has a city other than Shelburne is treated as off-site and
keeps its own venue/town.

Ben & Jerry's Concerts on the Green appear in this calendar with the
"Concerts" category -> category music. Ticket prices are NOT shown on the
event pages (external ticketing), so price stays None — never guessed.
Long-running daily exhibits, if the calendar ever lists them per-day, are
collapsed to one "On view through ..." entry (same rule as ECHO/BCA).
"""
from __future__ import annotations

import html
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common
from sources import _tribe

SOURCE = "shelburnemuseum"
LABEL = "Shelburne Museum"
BASE = "https://shelburnemuseum.org"
MUSEUM = "Shelburne Museum"

_CAT_MAP = {
    "concerts": "music",
    "families": "family",
    "kids": "family",
    "schools": "learning",
    "curator tour": "art",
    "evening programs": None,   # too varied; let classify() decide
}


def _category(ev: dict) -> str | None:
    for c in ev.get("categories") or []:
        mapped = _CAT_MAP.get((c.get("name") or "").strip().lower())
        if mapped:
            return mapped
    if "curator tour" in _tribe.title_of(ev).lower():
        return "art"    # gallery tour of an exhibition
    return None


def _placement(ev: dict):
    """-> (venue, town, sub_location). On-grounds venues collapse to the
    museum; genuinely off-site venues (different city) are kept as-is."""
    v = ev.get("venue")
    if isinstance(v, dict) and v.get("venue"):
        name = " ".join(html.unescape(v["venue"]).split())
        city = (v.get("city") or "").strip()
        if city and city.lower() != "shelburne":
            return name, city, None
        if name.lower() == MUSEUM.lower():
            return MUSEUM, "Shelburne", None
        return MUSEUM, "Shelburne", name
    return MUSEUM, "Shelburne", None


def _one(ev: dict) -> dict:
    venue, town, sub = _placement(ev)
    description = ev.get("description")
    if sub:
        description = f"{sub}. {common.strip_tags(description or '')}"
    return common.make_event(
        source=SOURCE,
        title=_tribe.title_of(ev),
        url=ev["url"],
        start=_tribe.start_of(ev),
        end=_tribe.end_of(ev),
        venue=venue, town=town,
        price=(ev.get("cost") or None),
        category=_category(ev),
        description=description,
    )


def fetch(window_start: date, window_end: date) -> list[dict]:
    events = _tribe.fetch_all(BASE, window_start, window_end)
    out: list[dict] = []
    exhibits, singles = _tribe.split_exhibits(events, window_start, window_end)

    for occurrences in exhibits:   # defensive; calendar rarely lists these
        first = occurrences[0]
        try:
            first_day = date.fromisoformat(first["start_date"][:10])
            last_day = date.fromisoformat(occurrences[-1]["start_date"][:10])
            venue, town, sub = _placement(first)
            description = first.get("description")
            if sub:
                description = f"{sub}. {common.strip_tags(description or '')}"
            out.append(common.make_event(
                source=SOURCE,
                title=_tribe.title_of(first),
                url=_tribe.series_url(first) or first["url"],
                start=first_day,
                venue=venue, town=town,
                price=(first.get("cost") or None),
                category=_category(first) or "art",
                description=description,
                recurring=_tribe.on_view_note(first.get("description"), last_day),
            ))
        except Exception as e:
            common.log(f"shelburnemuseum: skipped exhibit "
                       f"{_tribe.title_of(first)!r}: {e}")

    for ev in singles:
        try:
            out.append(_one(ev))
        except Exception as e:
            common.log(f"shelburnemuseum: skipped event "
                       f"{_tribe.title_of(ev)!r}: {e}")

    return out
