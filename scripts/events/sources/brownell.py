"""Brownell Library — brownelllibrary.org/calendar/ (Essex Junction).

Method: WordPress The Events Calendar (Tribe) public REST API at
  /wp-json/tribe/events/v1/events
The API is richer than the site's ICS export: it supplies structured local
start/end times, all-day status, venue/address, audience categories, cost,
description, and occurrence URLs. The ICS feed lacks the audience categories
needed for reliable kids/teens/family tagging, so JSON wins.

Rules applied here:
  * Events mentioning online/virtual/Zoom/webinar attendance are dropped.
  * Kids/family programs ARE included and tagged kids/teens/family from the
    Tribe audience categories (Children 0-5, Children 6-11, Teens, and
    Intergenerational).
  * free is set only from Tribe's cost field or a tight explicit-free phrase
    in the event text; an absent cost never implies free.
  * Brownell and its Kolvoord Community Room normalize to the shared Brownell
    Library venue; other structured venues remain unchanged for off-site use.

Gap: Tribe has no dedicated online-event flag here, so the in-person filter is
necessarily a conservative text match. Recurring occurrences are supplied by
the API; no RRULE expansion is needed.
"""
from __future__ import annotations

import html
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common
from sources import _tribe

SOURCE = "brownell"
LABEL = "Brownell Library"

BASE = "https://brownelllibrary.org"
LIBRARY = "Brownell Library"

_ONLINE_RE = re.compile(r"\bonline\b|\bvirtual\b|\bzoom\b|\bwebinar\b", re.I)
_FREE_RE = re.compile(
    r"free (?:and open to (?:the public|all|everyone)|event\b|program\b|"
    r"admission\b|of charge\b|to (?:attend|all|the public)\b)|"
    r"(?:admission|event|program|class|workshop|entry) is free|"
    r"this (?:event|program) is free", re.I)

_KID_AUD = re.compile(r"child|early learner|youth", re.I)
_TEEN_AUD = re.compile(r"teen|tween|12-18", re.I)
_FAMILY_AUD = re.compile(r"family|all ages|intergenerational", re.I)
_ADULT_AUD = re.compile(r"adult|senior|19-54|55\+", re.I)


def _audience_names(item: dict) -> str:
    return " ".join(c.get("name", "") for c in item.get("categories") or [])


def _audience_tags(item: dict) -> list[str]:
    names = _audience_names(item)
    tags: list[str] = []
    if _KID_AUD.search(names):
        tags.append("kids")
    if _TEEN_AUD.search(names):
        tags.append("teens")
    if _FAMILY_AUD.search(names):
        tags.append("family")
    return tags


def _category(item: dict, tags: list[str], title: str, desc: str | None,
              venue: str | None) -> str:
    guess = common.classify(title, desc, venue)
    kid_focused = ("kids" in tags or "teens" in tags or
                   ("family" in tags and not _ADULT_AUD.search(
                       _audience_names(item))))
    if kid_focused and guess in ("other", "community"):
        return "family"
    return guess


def _placement(item: dict):
    """Tribe venue -> (venue, address, town, Brownell sub-location)."""
    raw = item.get("venue")
    if not isinstance(raw, dict):
        return None, None, None, None

    name = " ".join(html.unescape(raw.get("venue") or "").split()) or None
    street = (raw.get("address") or "").strip()
    city = (raw.get("city") or "").strip() or None
    state = (raw.get("stateprovince") or raw.get("state") or "").strip()
    zipcode = (raw.get("zip") or "").strip()
    address = ", ".join(x for x in (street, city, state, zipcode) if x) or None

    at_brownell = (name and name.lower() == LIBRARY.lower()) \
        or street.lower().startswith("6 lincoln st") \
        or (name and "kolvoord community room" in name.lower())
    if at_brownell:
        sub = name if name and name.lower() != LIBRARY.lower() else None
        return LIBRARY, None, "Essex Junction", sub
    return name, address, city, None


def _recurring(item: dict, multi: bool) -> str | None:
    if item.get("all_day") and item.get("start_date") and item.get("end_date"):
        start_day = date.fromisoformat(item["start_date"][:10])
        end_day = date.fromisoformat(item["end_date"][:10])
        if end_day > start_day:
            return f"Through {end_day:%b %-d}"
    return "Multiple dates" if multi else None


def _build(item: dict, multi: bool) -> dict | None:
    title = _tribe.title_of(item)
    url = item.get("url")
    if not title or not url:
        return None

    venue, address, town, sub = _placement(item)
    desc = common.strip_tags(item.get("description") or "") or None
    if _ONLINE_RE.search(f"{title} {venue or ''} {desc or ''}"):
        return None
    if sub:
        desc = f"{sub}. {desc}" if desc else sub

    cost = (item.get("cost") or "").strip() or None
    free = True if _FREE_RE.search(f"{title} {desc or ''}") else None
    tags = _audience_tags(item)

    return common.make_event(
        source=SOURCE, title=title, url=url,
        start=_tribe.start_of(item), end=_tribe.end_of(item),
        venue=venue, address=address, town=town, price=cost, free=free,
        category=_category(item, tags, title, desc, venue),
        description=desc, tags=tags, recurring=_recurring(item, multi),
    )


def fetch(window_start: date, window_end: date) -> list[dict]:
    items = _tribe.fetch_all(BASE, window_start, window_end)
    counts: dict[str, int] = {}
    for item in items:
        title = _tribe.title_of(item)
        counts[title] = counts.get(title, 0) + 1

    out: list[dict] = []
    seen: set[tuple] = set()
    for item in items:
        try:
            title = _tribe.title_of(item)
            ev = _build(item, counts.get(title, 0) > 1)
            if ev is None:
                continue
            key = (item.get("id") or title, ev["start"])
            if key in seen:
                continue
            seen.add(key)
            out.append(ev)
        except Exception as e:
            common.log(f"{SOURCE}: skipped {_tribe.title_of(item)!r}: {e}")
    return out
