"""Burlington City Arts — burlingtoncityarts.org.

Method: Drupal HTML scrape (no JSON-LD, no ICS, no exposed views JSON).

1. /events — the calendar view renders one views-row per OCCURRENCE with
   the detail link, title, venue (field--name-field-venue) and one or two
   <time datetime="..."> elements (start / end). Covers the summer concert
   series, Splash Dance, openings, talks, festivals, partner events.
2. /exhibitions and /upcoming-exhibitions — long-running BCA Center shows
   ("July 10 — September 12, 2026"). Each is emitted ONCE, all-day, on its
   opening day if inside the window else on window_start, with
   recurring="On view through <end>", per the long-running-exhibition rule.

Prices are not shown on listing or detail pages, so price stays None —
never guessed (most of the summer series is unticketed but the site does
not say "free", so we don't either). Towns come from venues.json
resolution (City Hall Park, BCA Center, Waterfront Park, ... are all
registered Burlington venues); unrecognized venues keep town=None rather
than assuming Burlington, since Partner Events can be off-site.
"""
from __future__ import annotations

import html
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common

SOURCE = "bca"
LABEL = "Burlington City Arts"
BASE = "https://www.burlingtoncityarts.org"

_TIME_RE = re.compile(r'<time datetime="([^"]+)"')
_TITLE_RE = re.compile(r'field--name-title[^>]*>([^<]+)<')
_VENUE_RE = re.compile(r'field--name-field-venue[^>]*>([^<]+)<')


def _articles(page: str, kind: str) -> list[str]:
    """Split into <article> chunks of the given node type. Each chunk also
    carries the trailing markup up to the next article (the calendar view
    puts the date field just after </article>), truncated at the footer."""
    chunks = []
    for chunk in re.split(r"(?=<article )", page):
        if not chunk.startswith("<article") or f"node--type-{kind}" not in chunk[:300]:
            continue
        for stop in ('<div class="view-footer', "<footer"):
            i = chunk.find(stop)
            if i != -1:
                chunk = chunk[:i]
        chunks.append(chunk)
    return chunks


# ------------------------------------------------------------- calendar

# The calendar's own filter categories, mapped to our taxonomy. Fetching
# each filtered view tells us authoritatively which events BCA calls
# Music / Film / Kids (better than keyword-classifying "Sunday Classical").
_FILTER_CATS = {2: "music", 3: "film", 4: "family"}


def _site_categories() -> dict[str, str]:
    href_cat: dict[str, str] = {}
    for cid, cat in _FILTER_CATS.items():
        try:
            page = common.fetch(f"{BASE}/events?field_category_target_id={cid}")
            for href, _ in common.collect_links(page, r"^/event/"):
                href_cat[href] = cat
        except Exception as e:
            common.log(f"bca: category filter {cid} failed: {e}")
    return href_cat


def _calendar_events(lo: date, hi: date) -> list[dict]:
    page = common.fetch(f"{BASE}/events")
    href_cat = _site_categories()
    out: list[dict] = []
    for chunk in _articles(page, "event"):
        try:
            href = re.search(r'href="(/event/[^"]+)"', chunk)
            title = _TITLE_RE.search(chunk)
            if not href or not title:
                continue
            times = _TIME_RE.findall(chunk)
            if not times:
                continue
            start = common.parse_iso(times[0])
            end = common.parse_iso(times[1]) if len(times) > 1 else None
            venue_m = _VENUE_RE.search(chunk)
            venue = html.unescape(venue_m.group(1)).strip() if venue_m else None
            kwargs = dict(
                source=SOURCE,
                title=html.unescape(title.group(1)),
                url=BASE + href.group(1),
                venue=venue,
                category=href_cat.get(href.group(1)),
            )
            if (not isinstance(start, datetime) and isinstance(end, date)
                    and not isinstance(end, datetime) and end > start):
                # all-day date range (e.g. a 2-day festival): one entry/day
                span = f"{start.strftime('%b %-d')} – {end.strftime('%b %-d')}"
                if (end - start).days > 10:   # months-long -> single entry
                    if lo <= start <= hi or start < lo <= end:
                        out.append(common.make_event(
                            start=max(start, lo),
                            recurring=f"Through {end.strftime('%B %-d, %Y')}",
                            **kwargs))
                    continue
                d = start
                while d <= end:
                    if lo <= d <= hi:
                        out.append(common.make_event(
                            start=d, recurring=span, **kwargs))
                    d += timedelta(days=1)
                continue
            sdate = start.date() if isinstance(start, datetime) else start
            if not (lo <= sdate <= hi):
                continue
            out.append(common.make_event(start=start, end=end, **kwargs))
        except Exception as e:
            common.log(f"bca: skipped calendar row: {e}")
    if not out:
        common.log("bca: WARNING — calendar view yielded 0 events "
                   "(markup may have changed)")
    return out


# ---------------------------------------------------------- exhibitions

_RANGE_RE = re.compile(
    r"([A-Z][a-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?\s*[—–-]+\s*"
    r"([A-Z][a-z]+)\s+(\d{1,2}),?\s*(\d{4})")


def _month(name: str) -> int:
    for fmt in ("%B", "%b"):
        try:
            return datetime.strptime(name[:3 if fmt == "%b" else 20], fmt).month
        except ValueError:
            continue
    raise ValueError(f"bad month: {name}")


def _exhibitions(lo: date, hi: date) -> list[dict]:
    out: list[dict] = []
    for path in ("/exhibitions", "/upcoming-exhibitions"):
        try:
            page = common.fetch(BASE + path)
        except Exception as e:
            common.log(f"bca: {path} fetch failed: {e}")
            continue
        for chunk in _articles(page, "exhibition"):
            try:
                href = re.search(r'href="(/exhibition/[^"]+)"', chunk)
                title = _TITLE_RE.search(chunk)
                if not href or not title:
                    continue
                text = " ".join(common.strip_tags(chunk).split())
                m = _RANGE_RE.search(text)
                if not m:
                    continue
                m1, d1, y1, m2, d2, y2 = m.groups()
                end = date(int(y2), _month(m2), int(d2))
                sy = int(y1) if y1 else (int(y2) - 1 if _month(m1) > end.month
                                         else int(y2))
                start = date(sy, _month(m1), int(d1))
                if end < lo or start > hi:
                    continue
                out.append(common.make_event(
                    source=SOURCE,
                    title=html.unescape(title.group(1)),
                    url=BASE + href.group(1),
                    start=max(start, lo),          # ONE all-day entry only
                    venue="BCA Center",
                    category="art",
                    recurring=f"On view through {end.strftime('%B %-d, %Y')}",
                ))
            except Exception as e:
                common.log(f"bca: skipped exhibition teaser: {e}")
    return out


def fetch(window_start: date, window_end: date) -> list[dict]:
    return (_calendar_events(window_start, window_end)
            + _exhibitions(window_start, window_end))
