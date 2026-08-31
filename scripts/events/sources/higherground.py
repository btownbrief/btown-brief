"""Higher Ground (highergroundmusic.com) — 1214 Williston Rd, S. Burlington.

How this works (rewritten 2026-08 — the site changed):
  * /calendar/ is a WordPress page. It used to server-render a SeeTickets
    month-grid whose events carried only a title and a link, so every event
    needed a second fetch of its detail page to get date/time/venue/price.
  * Higher Ground has since moved to Eventim's "eventim-us-event-listings"
    plugin, which renders a LIST view alongside the calendar. Every event is
    a `.seetickets-list-event-container` card carrying the whole record
    inline: title, date, headliner, support, venue, door time, price, genre
    and a 600px image. Nothing needs a detail fetch any more — this source
    went from ~80 HTTP requests per run to exactly one.
  * The old parser matched `class='event-name headliners'` (single quotes,
    month-grid markup). None of that survives in the new theme, so it matched
    zero events and the source silently returned nothing — no error, just an
    empty list — from whenever the site was upgraded until this rewrite.
  * Dates read "Sat Aug 29" with no year. The weekday disambiguates: we take
    the first year (this one or next) whose weekday matches, which is exact
    for every date inside a 12-month window.
  * The headliner/support/genre/image fields have no home in the shared event
    schema, so they ride along in `signals` — a free-form dict that already
    passes through make_event untouched. That gives downstream surfaces a
    clean artist name without re-parsing the title.
  * HG also promotes shows at out-of-region venues (e.g. Capitol Center for
    the Arts in Concord NH); those are filtered out. Off-site but local
    venues (Waterfront Park, Shelburne Museum, the Flynn...) are kept.
"""

from __future__ import annotations

import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common

SOURCE = "higherground"
LABEL = "Higher Ground"

CALENDAR_URL = "https://highergroundmusic.com/calendar/"

# One list card per event. Split on the container, then read each field out
# of the card; the fields are plain <p class="... name">text</p>.
_CARD_SPLIT = "seetickets-list-event-container"
_LINK_RE = re.compile(r'<a href=([^\s>"\']+)')
_IMG_RE = re.compile(r'data-src="([^"]+)"')

def _field(card: str, cls: str) -> str | None:
    """Text of the <p class="... cls ..."> in this card, tags stripped."""
    m = re.search(r'class="[^"]*\b' + cls + r'\b[^"]*"[^>]*>(.*?)</p>', card, re.S)
    if not m:
        return None
    return " ".join(common.strip_tags(m.group(1)).split()) or None


_DATE_RE = re.compile(r"^(?:(\w{3}),?\s+)?(\w{3,9})\s+(\d{1,2})$")

# Local venues HG uses whose names carry no town and aren't in venues.json.
_EXTRA_LOCAL_TOWNS = {
    "champlain valley expo": "Essex Junction",
    "midway lawn": "Essex Junction",
    "spruce peak": "Stowe",
}


def _extra_local_town(t: str) -> str | None:
    tl = t.lower()
    for key, town in _EXTRA_LOCAL_TOWNS.items():
        if key in tl:
            return town
    return None


def _is_local(venue_text: str | None) -> bool:
    """Keep only venues in/near Chittenden County (HG promotes NJ/NY shows)."""
    if not venue_text:
        return True  # unknown — let the detail page decide
    t = " ".join(venue_text.split())
    if "higher ground" in t.lower() or _extra_local_town(t):
        return True
    _, info = common.resolve_venue(t)
    if info:  # matched the local venue registry
        return True
    return common.town_from_address(t) is not None


def _year_for(month: int, day: int, weekday: str | None, today: date) -> date | None:
    """HG prints "Sat Aug 29" with no year. Try this year and next, and take
    the one whose weekday matches what the page says. Without a weekday, roll
    forward: a month already past means next year."""
    cands = []
    for yr in (today.year, today.year + 1):
        try:
            d = date(yr, month, day)
        except ValueError:
            continue  # Feb 29 in a non-leap year
        cands.append(d)
    if not cands:
        return None
    if weekday:
        w = weekday[:3].lower()
        for d in cands:
            if d.strftime("%a").lower() == w:
                return d
    for d in cands:
        if d >= today - timedelta(days=1):
            return d
    return cands[0]


def _parse_date(text: str | None, today: date) -> date | None:
    m = _DATE_RE.match((text or "").strip())
    if not m:
        return None
    weekday, month_name, day = m.groups()
    for fmt in ("%b", "%B"):
        try:
            month = datetime.strptime(month_name[:3] if fmt == "%b" else month_name, fmt).month
            break
        except ValueError:
            month = None
    if not month:
        return None
    return _year_for(month, int(day), weekday, today)


def _parse_cards(page: str, today: date):
    """-> list of dicts, one per event card on the list view."""
    out, seen = [], set()
    for card in page.split(_CARD_SPLIT)[1:]:
        title = _field(card, "event-title")
        if not title:
            continue
        # A postponed or cancelled show is not something to put on a calendar
        # of what is on. The site marks them in the title.
        if re.match(r"(?i)\s*(postponed|cancell?ed)\b", title):
            continue
        m = _LINK_RE.search(card)
        url = m.group(1).strip("'\"") if m else None
        day = _parse_date(_field(card, "event-date"), today)
        if not url or not day or (day, url) in seen:
            continue
        seen.add((day, url))
        img = _IMG_RE.search(card)
        out.append({
            "date": day,
            "url": url,
            "title": title,
            "presenter": _field(card, "event-header"),
            "artist": _field(card, "headliners"),
            "support": _field(card, "supporting-talent"),
            "venue": re.sub(r"(?i)^at\s+", "", _field(card, "venue") or "").strip() or None,
            "doors": _field(card, "doortime-showtime"),
            "price": _field(card, "price"),
            "genre": _field(card, "genre"),
            "image": img.group(1) if img else None,
        })
    return out


def fetch(window_start, window_end):
    page = common.fetch(CALENDAR_URL)
    today = date.today()
    cards = _parse_cards(page, today)
    if not cards:
        # Loud, because this is exactly how the previous rewrite went unnoticed:
        # the markup changed, every regex missed, and the source just returned [].
        common.log("higherground: NO events parsed — the calendar markup has "
                   "probably changed again (expected .%s cards)" % _CARD_SPLIT)
        return []

    events, skipped = [], set()
    for c in cards:
        if not (window_start <= c["date"] <= window_end):
            continue
        if not _is_local(c["venue"]):
            skipped.add(c["venue"])
            continue

        venue, town, tags = None, None, []
        vtext = c["venue"]
        if vtext:
            if "higher ground" in vtext.lower():
                venue = "Higher Ground"
                room = re.sub(r"(?i)higher ground[, ]*", "", vtext).strip(" ,")
                if room:
                    tags.append(re.sub(r"[^a-z0-9]+", "-", room.lower()).strip("-"))
            else:
                venue = vtext.strip(" ,")
                town = (common.town_from_address(vtext)
                        or _extra_local_town(vtext))

        # "Doors at 7:00PM" / "Doors at 7:00PM Show at 8:00PM" — the show time
        # if it is given, otherwise doors.
        hm = None
        if c["doors"]:
            times = re.findall(r"\d{1,2}:\d{2}\s*[APap][Mm]", c["doors"])
            if times:
                hm = common.parse_time_str(times[-1] if "show" in c["doors"].lower() else times[0])
        start = common.local_dt(c["date"], hm)

        parts = []
        if c["presenter"]:
            parts.append(c["presenter"].rstrip(":"))
        if c["doors"]:
            parts.append(c["doors"])
        if c["support"]:
            parts.append(f"With {c['support']}")
        description = " · ".join(parts) or None

        # Classify from the title only (support acts and bios misfire — a
        # support act called "Teen Mortgage" would read as family). HG is
        # first and foremost a music hall, so anything unclassified is music.
        if re.search(r"(?i)drag|cabaret|burlesque", c["title"]):
            category = "theater"
        else:
            category = common.classify(c["title"])
            if category in ("other", "community"):
                category = "music"

        # The artist/genre/art have no column in the shared schema but are the
        # whole point for a music surface, so they ride in signals.
        signals = {k: v for k, v in (
            ("artist", c["artist"]), ("support", c["support"]),
            ("genre", c["genre"]), ("image", c["image"]),
            ("presenter", c["presenter"]),
        ) if v}

        try:
            events.append(common.make_event(
                source=SOURCE, title=c["title"], url=c["url"], start=start,
                venue=venue, town=town, price=c["price"],
                category=category, description=description,
                tags=tags or None, signals=signals or None))
        except Exception as e:
            common.log(f"higherground: skipping {c['title']!r}: {e}")

    if skipped:
        common.log(f"higherground: skipped non-local venues: {sorted(x for x in skipped if x)}")
    return events
