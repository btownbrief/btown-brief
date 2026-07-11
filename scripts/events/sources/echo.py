"""ECHO Leahy Center for Lake Champlain — echovermont.org.

Method: The Events Calendar (Tribe) REST API at
/wp-json/tribe/events/v1/events (the site runs WordPress + Tribe).

Long-running exhibits that Tribe expands into one entry per open day
(e.g. "Dinosaur Safari", daily 10-5) are collapsed to a single all-day
entry on their first in-window date with recurring="On view through ...".
Real one-off or weekly programs get one entry per occurrence.

Venue: events on ECHO's own calendar with no Tribe venue are at ECHO
(1 College St); off-site events (e.g. library outreach) carry the venue
and town Tribe provides. Price: the API's cost field is passed through
verbatim when present; it is usually empty (general admission applies to
exhibits) so price stays None — never guessed.
"""
from __future__ import annotations

import html
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common
from sources import _tribe

SOURCE = "echo"
LABEL = "ECHO Leahy Center"
BASE = "https://www.echovermont.org"
DEFAULT_VENUE = "ECHO, Leahy Center for Lake Champlain"


def _venue_bits(ev: dict):
    """-> (venue, address, town). Empty Tribe venue = at ECHO itself."""
    v = ev.get("venue")
    if isinstance(v, dict) and v.get("venue"):
        name = " ".join(html.unescape(v["venue"]).split())
        parts = [v.get("address"), v.get("city"),
                 v.get("stateprovince") or v.get("state")]
        address = ", ".join(p for p in parts if p) or None
        return name, address, (v.get("city") or None)
    return DEFAULT_VENUE, None, None


def fetch(window_start: date, window_end: date) -> list[dict]:
    events = _tribe.fetch_all(BASE, window_start, window_end)
    out: list[dict] = []
    exhibits, singles = _tribe.split_exhibits(events, window_start, window_end)

    for occurrences in exhibits:
        first = occurrences[0]
        try:
            first_day = date.fromisoformat(first["start_date"][:10])
            last_day = date.fromisoformat(occurrences[-1]["start_date"][:10])
            venue, address, town = _venue_bits(first)
            out.append(common.make_event(
                source=SOURCE,
                title=_tribe.title_of(first),
                url=_tribe.series_url(first) or first["url"],
                start=first_day,                      # all-day, one entry only
                venue=venue, address=address, town=town,
                price=(first.get("cost") or None),
                description=first.get("description"),
                recurring=_tribe.on_view_note(first.get("description"), last_day),
            ))
        except Exception as e:                        # keep going per item
            common.log(f"echo: skipped exhibit {_tribe.title_of(first)!r}: {e}")

    for ev in singles:
        try:
            venue, address, town = _venue_bits(ev)
            out.append(common.make_event(
                source=SOURCE,
                title=_tribe.title_of(ev),
                url=ev["url"],
                start=_tribe.start_of(ev),
                end=_tribe.end_of(ev),
                venue=venue, address=address, town=town,
                price=(ev.get("cost") or None),
                description=ev.get("description"),
            ))
        except Exception as e:
            common.log(f"echo: skipped event {_tribe.title_of(ev)!r}: {e}")

    return out
