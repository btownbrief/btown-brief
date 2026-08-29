"""Radio Bean (8 N Winooski Ave) and Light Club Lamp Shop (12 N Winooski Ave).

Two rooms, one calendar. Radio Bean runs its bookings through Tockify, which
publishes a plain iCalendar feed — ~500 events, further out than any other
local room, and the only machine-readable source in town for the small-venue
bills where Burlington bands actually play. Everything else on this street
reaches the calendar second-hand, if at all.

Light Club Lamp Shop shares the feed. Its shows are marked by a "[LCLS]" tag
in the summary, which is stripped from the title and used to pick the venue.

Why this matters more than its event count suggests: Higher Ground books
touring acts, so the artists there mostly do not live here. The names in this
feed — Clive, Wild Leek River, Lillian Leadbetter, The Red Newts — are the
local scene, and they are what a "who from around here is playing this week"
surface has to be built on.

Titles carry the whole bill: "Sova w/ Tom Pearo", "HONKY TONK TUESDAY: Marley
Hale & Wild Leek River". The support act is kept in the description rather
than parsed out here; splitting a bill into artists is the consumer's job.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common

SOURCE = "radiobean"
LABEL = "Radio Bean"

ICS_URL = "https://tockify.com/api/feeds/ics/radio.bean.event.calendar1"
CALENDAR_URL = "https://www.radiobean.com/calendar"

# The room tag Tockify carries in the summary, e.g. "Acid Wash [LCLS]".
_LCLS_RE = re.compile(r"\s*\[\s*LCLS\s*\]\s*", re.I)

# Some bills name the room in prose instead of using the tag, e.g. "PUNK ROCK
# QUEER PROM at the LIGHT CLUB LAMP SHOP!". Those are Light Club shows too.
_LCLS_PROSE_RE = re.compile(r"(?i)light\s*club(\s*lamp\s*shop)?")

# A trailing set time is useful in the description, not in the title:
# "Clive (11pm-1am)" -> "Clive".
_SETTIME_RE = re.compile(r"\s*\((\d{1,2}(?::\d{2})?\s*[apAP][mM][^)]{0,20})\)\s*$")

# Rooms that are not a music booking. Radio Bean's calendar carries its own
# cafe programming too, and a poetry open mic is not a gig.
_NOT_MUSIC = re.compile(r"(?i)\b(trivia|bingo|poetry|comedy|book club|"
                        r"knitting|craft night|market)\b")


def fetch(window_start, window_end):
    text = common.fetch(ICS_URL)
    rows = common.parse_ics(text, window_start, window_end)
    if not rows:
        common.log("radiobean: ICS parsed but no events in window")
        return []

    events = []
    for r in rows:
        title = (r.get("summary") or "").strip()
        if not title:
            continue

        lcls = bool(_LCLS_RE.search(title)) or bool(_LCLS_PROSE_RE.search(title))
        title = _LCLS_RE.sub(" ", title).strip(" -–—")
        set_time = None
        m = _SETTIME_RE.search(title)
        if m:
            set_time = m.group(1).strip()
            title = _SETTIME_RE.sub("", title).strip()
        if not title:
            continue

        venue = "Light Club Lamp Shop" if lcls else "Radio Bean"

        parts = []
        if set_time:
            parts.append(set_time)
        if r.get("description"):
            parts.append(r["description"])
        description = " · ".join(parts) or None

        # These rooms are music first. Only send a title somewhere else when it
        # plainly says so — common.classify would read "Old Time Jam" as games.
        category = "music"
        if _NOT_MUSIC.search(title):
            category = common.classify(title, description)

        try:
            events.append(common.make_event(
                source=SOURCE, title=title,
                url=r.get("url") or CALENDAR_URL,
                start=r["start"], end=r.get("end"),
                venue=venue, town="Burlington",
                category=category, description=description,
                recurring=r.get("recurring")))
        except Exception as e:
            common.log(f"radiobean: skipping {title!r}: {e}")
    return events
