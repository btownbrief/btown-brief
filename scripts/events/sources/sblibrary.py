"""South Burlington Public Library — southburlingtonlibrary.org/events/.

Method: HTML. The site is MODX with a server-rendered events listing (no
LibCal/Communico/Assabet, no JSON-LD, no ICS/RSS feed found). /events/
contains every event series as a <div class="post"> block:

  * data-recList="07/03/2026,07/10/2026,..."  — every occurrence date
    (including past ones; the site's own JS prunes those client-side)
  * data-stime/data-etime — occurrence times, data-dur — extra days a
    grab-&-go kit / exhibit stays available (0 for normal programs)
  * <div class="location">South Burlington Public Library : Room</div>,
    <p class="summary">, category tags via ?category=... links

This module expands data-recList itself, so it works on the raw server
HTML. It equally handles the browser-rendered variant of the page (one
block per occurrence, href carrying ?c=<start>&e=<end>) because blocks
dedupe on (series id, date) — that matters for the proxy fallback below.

Fragility note: southburlingtonlibrary.org's WAF drops TLS handshakes from
non-browser clients *intermittently* (TCP connect succeeds, handshake is
reset — client-fingerprint filtering). Direct fetch is tried first; on
failure the module retries through the public r.jina.ai reader proxy
(x-respond-with: html returns the rendered page's HTML verbatim). If both
fail the source raises and update.py keeps last-good data. Longer-term:
ask the library for a real feed.

Free: the site publishes no prices and no blanket "programs are free"
statement, so free stays None unless an event's own text says free.
Dur>0 items (grab-&-go kits, art walls) are collapsed to one entry on
their first in-window day with an "Available through ..." note, like the
exhibit handling in other sources.
"""
from __future__ import annotations

import html as _html
import re
import sys
import urllib.parse
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common

SOURCE = "sblibrary"
LABEL = "South Burlington Public Library"

BASE = "https://southburlingtonlibrary.org"
EVENTS_URL = f"{BASE}/events/"
PROXY_URL = f"https://r.jina.ai/{EVENTS_URL}"

_FREE_RE = re.compile(
    r"\bfree!|free (?:and open to (?:the public|all|everyone)|event\b|"
    r"program\b|admission\b|of charge\b|to (?:attend|all|the public)\b|"
    r"\d+[ -]minute)|"
    r"(?:admission|event|program|class|workshop|entry) is free", re.I)
_ONLINE_RE = re.compile(r"\bvirtual\b|\bonline\b|\bzoom\b", re.I)

_BLOCK_RE = re.compile(r'<div class="post[ "]')
_TITLE_RE = re.compile(r'<h3 class="title"><a href="([^"]+)">([^<]*)</a>')
_LOC_RE = re.compile(r'class="location">([^<]*)<')
_SUMMARY_RE = re.compile(r'class="summary">\s*(.*?)\s*</p>', re.S)
_TAG_RE = re.compile(r'\?category=([^"]+)"')
_ATTR_RES = {
    "reclist": re.compile(r'data-reclist="([^"]*)"', re.I),
    "dur": re.compile(r'data-dur="(\d+)"', re.I),
    "id": re.compile(r'data-id="([^"]*)"', re.I),
    "stime": re.compile(r'data-stime="([^"]*)"', re.I),
    "etime": re.compile(r'data-etime="([^"]*)"', re.I),
}
_MDY_RE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})")
_HM_RE = re.compile(r"(\d{1,2}):(\d{2})")

_KID_TAGS = {"kids", "older kids", "storytime", "teens", "all ages"}


def _listing_html() -> str:
    try:  # direct first — short retries, the WAF just drops the handshake
        return common.fetch(EVENTS_URL, retries=2, timeout=25)
    except Exception as e:
        common.log(f"{SOURCE}: direct fetch blocked ({e}); using reader proxy")
    return common.fetch(PROXY_URL, headers={"x-respond-with": "html"},
                        retries=2, timeout=120)


def _attr(block: str, name: str) -> str:
    m = _ATTR_RES[name].search(block)
    return m.group(1) if m else ""


def _hm(text: str):
    m = _HM_RE.fullmatch(text.strip()) if text else None
    return (int(m.group(1)), int(m.group(2))) if m else None


def fetch(window_start: date, window_end: date) -> list[dict]:
    page = _listing_html()
    if 'class="post' not in page:
        raise RuntimeError("events listing markup not found (page layout changed?)")

    out: list[dict] = []
    seen: set[tuple] = set()
    for block in _BLOCK_RE.split(page)[1:]:
        try:
            for ev, series_id in _build(block, window_start, window_end):
                key = (series_id or ev["title"], ev["date"])
                if key in seen:      # rendered-DOM variant repeats per occurrence
                    continue
                seen.add(key)
                out.append(ev)
        except Exception as e:
            common.log(f"{SOURCE}: skipped a block: {e}")
    return out


def _occurrences(block: str, lo: date, hi: date):
    """-> (list of in-window occurrence dates, available-through date|None)."""
    dates = []
    for m in _MDY_RE.finditer(_attr(block, "reclist")):
        mo, d, y = map(int, m.groups())
        try:
            dates.append(date(y, mo, d))
        except ValueError:
            continue
    dates = sorted(set(dates))
    dur = int(_attr(block, "dur") or 0)
    if dur > 0:
        # kit/exhibit available start..start+dur -> one entry, first in-window day
        for d0 in dates:
            end = d0 + timedelta(days=dur)
            if end < lo or d0 > hi:
                continue
            return [max(d0, lo)], end
        return [], None
    return [d for d in dates if lo <= d <= hi], None


def _build(block: str, lo: date, hi: date):
    tm = _TITLE_RE.search(block)
    if not tm:
        return
    href = _html.unescape(tm.group(1))
    title = _html.unescape(tm.group(2)).strip()
    if not title:
        return
    url = urllib.parse.urljoin(f"{BASE}/", href.split("?")[0])

    loc = _html.unescape(_LOC_RE.search(block).group(1)).strip() \
        if _LOC_RE.search(block) else ""
    if _ONLINE_RE.search(f"{title} {loc}"):
        return                          # virtual-only program
    venue = room = None
    if ":" in loc:
        venue, room = (p.strip() for p in loc.split(":", 1))
    elif loc and loc.lower() != "custom":
        venue = loc
    # "Custom" = off-site (e.g. farmers market); place lives in title/summary

    sm = _SUMMARY_RE.search(block)
    desc = common.strip_tags(sm.group(1)) if sm else None
    if room and desc:
        desc = f"{room}. {desc}"
    elif room:
        desc = room

    tags = sorted({urllib.parse.unquote_plus(t).strip().lower()
                   for t in _TAG_RE.findall(block)})
    free = True if _FREE_RE.search(f"{title} {desc or ''}") else None
    category = common.classify(title, desc, venue)
    if category in ("other", "community") and _KID_TAGS & set(tags):
        category = "family"

    occ_dates, through = _occurrences(block, lo, hi)
    stime, etime = _hm(_attr(block, "stime")), _hm(_attr(block, "etime"))
    series_id = _attr(block, "id") or None
    recurring = (f"Available through {through:%b %-d}" if through
                 else "Multiple dates" if len(occ_dates) > 1 else None)

    for d in occ_dates:
        start = common.local_dt(d, stime)
        end = common.local_dt(d, etime) if (stime and etime) else None
        if isinstance(end, datetime) and isinstance(start, datetime) and end <= start:
            end = None
        yield common.make_event(
            source=SOURCE, title=title, url=url, start=start, end=end,
            venue=venue, free=free, category=category,
            description=desc, tags=tags, recurring=recurring,
        ), series_id
