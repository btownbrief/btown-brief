"""Higher Ground (highergroundmusic.com) — 1214 Williston Rd, S. Burlington.

How this works (discovered 2026-07):
  * /calendar/ is a WordPress page whose SeeTickets plugin server-renders a
    ~6-month calendar: <h2 class='month-name'>July 2026</h2> followed by a
    table of day cells; each event in a cell is a link with
    class='event-name headliners', a support-act <span>, and a venue <div>.
    No JSON-LD, no usable wp-json event endpoint.
  * Detail pages (highergroundmusic.com/events/<slug>/) carry the real data:
    class="dates" (e.g. "Fri Jul 10, 2026"), class="doors" / class="start"
    times, class="venue ..." ("Higher Ground,  Showcase Lounge" or an
    off-site venue), class="age-restriction ..." ("18+" when restricted),
    and an event-description div. Ticket prices are almost always behind
    wl.seetickets.us (bot-blocked, 403), so price is only set when a dollar
    figure appears on the HG page itself.
  * HG also promotes shows at out-of-region venues (e.g. Seaside Heights NJ);
    those are filtered out. Off-site but local venues (Waterfront Park,
    Shelburne Museum, the Flynn...) are kept with the stated venue.
"""

from __future__ import annotations

import re
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common

SOURCE = "higherground"
LABEL = "Higher Ground"

CALENDAR_URL = "https://highergroundmusic.com/calendar/"

_MONTH_SPLIT = re.compile(r"<h2 class='month-name'>([^<]+)</h2>")
_DAY_RE = re.compile(r">(\d{1,2})</span>")
_EVENT_RE = re.compile(
    r"class='event-name headliners' href='([^']+)'[^>]*>([^<]*)</a></h1>"
    r"\s*<span[^>]*>(.*?)</span><div[^>]*>([^<]*)</div>", re.S)
_EVENT_FALLBACK_RE = re.compile(
    r"class='event-name headliners' href='([^']+)'[^>]*>([^<]*)</a>")

_DETAIL_DATE_RE = re.compile(r'class="dates">\s*([^<]+?)\s*<')
_DOORS_RE = re.compile(r'class="doors">\s*Doors:\s*([^<]+?)\s*<')
_SHOW_RE = re.compile(r'class="start">\s*Show:\s*([^<]+?)\s*<')
_VENUE_RE = re.compile(r'class="venue[^"]*">\s*([^<]+?)\s*<')
_AGE_RE = re.compile(r'class="age-restriction[^"]*">\s*([^<]*?)\s*<')
_DESC_RE = re.compile(r'<div class="event-description">(.*?)</div>', re.S)
_PRICE_SECTION_RE = re.compile(r'class="ticket-price[^"]*">(.*?)</section>', re.S)
_DOLLAR_RE = re.compile(r"\$\s?\d+(?:\.\d{2})?")

_MAX_DETAIL_FETCHES = 80

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


def _parse_calendar(page: str):
    """-> list of (date, url, title, support, venue_hint)."""
    parts = _MONTH_SPLIT.split(page)
    out, seen = [], set()
    # parts = [prefix, "July 2026", chunk, "August 2026", chunk, ...]
    for i in range(1, len(parts) - 1, 2):
        try:
            month_start = datetime.strptime("1 " + parts[i].strip(), "%d %B %Y").date()
        except ValueError:
            continue
        for cell in parts[i + 1].split("<td")[1:]:
            dm = _DAY_RE.search(cell)
            if not dm:
                continue
            day = date(month_start.year, month_start.month, int(dm.group(1)))
            matches = _EVENT_RE.findall(cell)
            if not matches:
                matches = [(u, t, "", "") for u, t in _EVENT_FALLBACK_RE.findall(cell)]
            for url, title, support, hint in matches:
                title = " ".join(common.strip_tags(title).split())
                if not title or (day, url) in seen:
                    continue
                seen.add((day, url))
                out.append((day, url,
                            title,
                            " ".join(common.strip_tags(support).split()) or None,
                            " ".join(hint.split()) or None))
    return out


def _fetch_detail(url: str) -> dict:
    page = common.fetch(url)
    d: dict = {}
    for key, rx in (("date", _DETAIL_DATE_RE), ("doors", _DOORS_RE),
                    ("show", _SHOW_RE), ("venue", _VENUE_RE), ("age", _AGE_RE)):
        m = rx.search(page)
        if m:
            d[key] = " ".join(m.group(1).split()) or None
    m = _DESC_RE.search(page)
    if m:
        d["description"] = common.strip_tags(m.group(1))
    # Price: ONLY from the site's own ticket-price section. Description text
    # is unsafe ("$1 of every ticket goes to charity" is not a price), and
    # actual prices live behind wl.seetickets.us, which blocks bots.
    m = _PRICE_SECTION_RE.search(page)
    if m:
        dollars = _DOLLAR_RE.findall(common.strip_tags(m.group(1)))
        if dollars:
            d["price"] = "–".join(dict.fromkeys(dollars))
    return d


def _norm_age(text: str | None) -> str | None:
    if not text:
        return None
    m = re.match(r"^\s*(\d{2})\s*\+", text)
    if m:
        return f"{m.group(1)}+"
    if re.match(r"(?i)^\s*all\s*ages", text):
        return "All ages"
    return None


def fetch(window_start, window_end):
    page = common.fetch(CALENDAR_URL)
    listings = [l for l in _parse_calendar(page)
                if window_start <= l[0] <= window_end]
    if not listings:
        common.log("higherground: calendar parsed but no events in window")

    details: dict[str, dict] = {}
    events, skipped, fetches = [], set(), 0
    for day, url, title, support, hint in listings:
        if not _is_local(hint):
            skipped.add(hint or url)
            continue
        if url not in details:
            if fetches >= _MAX_DETAIL_FETCHES:
                common.log("higherground: detail-fetch cap reached")
                details[url] = {}
            else:
                fetches += 1
                try:
                    details[url] = _fetch_detail(url)
                except Exception as e:
                    common.log(f"higherground: detail fetch failed {url} ({e})")
                    details[url] = {}
        d = details[url]

        venue_text = d.get("venue") or hint
        if not _is_local(venue_text):
            skipped.add(venue_text)
            continue

        venue, town, tags = None, None, []
        if venue_text:
            if "higher ground" in venue_text.lower():
                venue = "Higher Ground"
                room = re.sub(r"(?i)higher ground[, ]*", "", venue_text).strip(" ,")
                if room:
                    tags.append(re.sub(r"[^a-z0-9]+", "-", room.lower()).strip("-"))
            else:
                venue = venue_text.strip(" ,")
                town = (common.town_from_address(venue_text)
                        or _extra_local_town(venue_text))

        show_hm = common.parse_time_str(d.get("show") or "")
        doors_hm = common.parse_time_str(d.get("doors") or "")
        start = common.local_dt(day, show_hm or doors_hm)

        parts = []
        if d.get("doors"):
            parts.append(f"Doors {d['doors']}")
        if support:
            parts.append(f"With {support}")
        if d.get("description"):
            parts.append(d["description"])
        description = " · ".join(parts) or None

        # Classify from the title only (support acts / venue names / bios
        # misfire, e.g. support act "Teen Mortgage" -> family); a ticketed
        # show at a music hall defaults to music.
        if re.search(r"(?i)drag|cabaret|burlesque", title):
            category = "theater"
        else:
            category = common.classify(title)
            if category in ("other", "community"):
                category = "music"  # HG is first and foremost a music hall

        try:
            events.append(common.make_event(
                source=SOURCE, title=title, url=url, start=start,
                venue=venue, town=town, price=d.get("price"),
                age=_norm_age(d.get("age")), category=category,
                description=description, tags=tags or None))
        except Exception as e:
            common.log(f"higherground: skipping {title!r}: {e}")
    if skipped:
        common.log(f"higherground: skipped non-local venues: {sorted(skipped)}")
    return events
