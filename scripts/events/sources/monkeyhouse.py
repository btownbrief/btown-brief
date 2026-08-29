"""The Monkey House (30 Main St, Winooski).

A small room that books local bills most nights, and one of the venues whose
listings were reaching the calendar only when another site happened to repost
them. It runs on Squarespace, which will hand back its own events collection
as JSON if asked — `?format=json` on the events page returns `upcoming` and
`past` arrays with the whole record: title, start and end as epoch
milliseconds, the event page URL, a poster image and an excerpt.

Titles are artist-forward and carry the whole bill the way a flyer does —
"Slow Teeth w/ Invisible Homes & Rose Asteroid", "Morning Giants | Guesstimate"
— which is exactly the shape the music surface reads support acts out of.

Not everything here is a gig: the room also runs trivia, drag and comedy. Those
are classified normally rather than forced to music.
"""

from __future__ import annotations

import html
import re
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common

SOURCE = "monkeyhouse"
LABEL = "The Monkey House"

FEED_URL = "https://www.monkeyhousevt.com/events?format=json"
SITE = "https://www.monkeyhousevt.com"

_NOT_MUSIC = re.compile(r"(?i)\b(trivia|bingo|comedy|open mic night|drag|"
                        r"market|craft|workshop|book club)\b")


def _dt(ms):
    """Squarespace stores epoch milliseconds; the calendar wants local time."""
    if not isinstance(ms, (int, float)):
        return None
    try:
        return datetime.fromtimestamp(ms / 1000, common.TZ)
    except (ValueError, OSError, OverflowError):
        return None


def fetch(window_start, window_end):
    data = common.fetch_json(FEED_URL)
    rows = data.get("upcoming") if isinstance(data, dict) else None
    if not rows:
        common.log("monkeyhouse: feed returned no upcoming events")
        return []

    events = []
    for r in rows:
        # Squarespace hands back HTML entities inside JSON strings, so a
        # bill reads "Slow Teeth w/ Invisible Homes &amp; Rose Asteroid" —
        # which also hides the "&" that separates the support acts.
        title = " ".join(html.unescape(r.get("title") or "").split())
        start = _dt(r.get("startDate"))
        if not title or not start:
            continue
        if not (window_start <= start.date() <= window_end):
            continue

        url = r.get("fullUrl") or ""
        url = (SITE + url) if url.startswith("/") else (url or SITE + "/events")

        description = None
        if r.get("excerpt"):
            description = common.strip_tags(r["excerpt"])

        category = common.classify(title, description) if _NOT_MUSIC.search(title) else "music"

        signals = {}
        if r.get("assetUrl"):
            signals["image"] = r["assetUrl"]

        try:
            events.append(common.make_event(
                source=SOURCE, title=title, url=url,
                start=start, end=_dt(r.get("endDate")),
                venue="The Monkey House", town="Winooski",
                category=category, description=description,
                signals=signals or None))
        except Exception as e:
            common.log(f"monkeyhouse: skipping {title!r}: {e}")
    return events
