"""Vermont Comedy Club — 101 Main St, Burlington (SeatEngine ticketing).

How this works (discovered 2026-07):
  * The SeatEngine calendar page
    https://www-vermontcomedyclub-com.seatengine.com/calendar embeds ONE
    ld+json blob: a Place whose non-standard "Events" array lists every
    upcoming showtime (~5 months out) with name, startDate (UTC), a per-
    showtime detail url (/shows/<id>) and a long HTML description.
    NOTE: common.jsonld_events() can't see these (they're nested under a
    non-schema "Events" key), so we parse the blob directly.
  * Each /shows/<id> page embeds `window.seat_engine_app_config = {...}`
    with the authoritative local start_date_time and the ticket inventories
    (price in cents, e.g. "Gen Admin - $25" -> 2500), plus a
    "Door Time: 6:30 PM" heading and an "AGES: ..." line in the description
    ("ALL (18+ recommended)" vs a hard "18+").
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common

SOURCE = "vcc"
LABEL = "Vermont Comedy Club"

CALENDAR_URL = "https://www-vermontcomedyclub-com.seatengine.com/calendar"

_LDJSON_RE = re.compile(
    r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.S | re.I)
_CONFIG_RE = re.compile(r"seat_engine_app_config\s*=\s*(\{.*\})")
_DOORTIME_RE = re.compile(r"class='event-doortime'>\s*Door Time:\s*([^<]+?)\s*<")
_AGES_RE = re.compile(r"(?i)AGES\s*(?:</strong>)?\s*:\s*((?:<[^>]+>|&nbsp;|\s)*[^<\n]{0,40})")

_MAX_DETAIL_FETCHES = 80


def _calendar_events() -> list[dict]:
    page = common.fetch(CALENDAR_URL)
    for m in _LDJSON_RE.finditer(page):
        blob = m.group(1).strip()
        try:
            data = json.loads(blob)
        except json.JSONDecodeError:
            try:
                data = json.loads(re.sub(r"[\x00-\x1f]", " ", blob))
            except json.JSONDecodeError:
                continue
        nodes = data if isinstance(data, list) else [data]
        for node in nodes:
            if isinstance(node, dict) and isinstance(node.get("Events"), list):
                return node["Events"]
    raise RuntimeError("vcc: no Events array found in calendar JSON-LD")


def _show_detail(url: str) -> dict:
    """/shows/<id> -> {start, price, doors, age, sold_out} (best effort)."""
    page = common.fetch(url)
    d: dict = {}
    m = _CONFIG_RE.search(page)
    if m:
        try:
            cfg = json.loads(m.group(1))
            st = cfg.get("showtime") or {}
            if st.get("start_date_time"):
                d["start"] = common.parse_iso(st["start_date_time"])
            cents = sorted({inv.get("price") for inv in st.get("inventories", [])
                            if isinstance(inv.get("price"), (int, float))
                            and inv.get("price") > 0})
            if cents:
                lo, hi = cents[0] / 100, cents[-1] / 100
                fmt = lambda v: f"${v:.2f}".replace(".00", "")
                d["price"] = fmt(lo) if hi <= lo else f"{fmt(lo)}–{fmt(hi)}"
            if st.get("sold_out"):
                d["sold_out"] = True
        except (json.JSONDecodeError, TypeError, AttributeError):
            pass
    m = _DOORTIME_RE.search(page)
    if m:
        d["doors"] = " ".join(m.group(1).split())
    m = _AGES_RE.search(page)
    if m:
        ages = common.strip_tags(m.group(1)).strip()
        if re.match(r"^\s*18\s*\+", ages):
            d["age"] = "18+"
        elif re.match(r"^\s*21\s*\+", ages):
            d["age"] = "21+"
        elif re.match(r"(?i)^\s*all\b", ages):
            d["age"] = "All ages"
    return d


def fetch(window_start, window_end):
    raw = _calendar_events()
    events, fetches = [], 0
    seen = set()
    for ev in raw:
        try:
            name = " ".join((ev.get("name") or "").split())
            url = ev.get("url")
            start = common.parse_iso(ev["startDate"])  # UTC -> local
            if not name or not url or not isinstance(start, datetime):
                continue
            if re.match(r"(?i)^\s*(closed|private\b|buyout\b)", name):
                continue  # placeholder listings, not public events
            if not (window_start <= start.date() <= window_end):
                continue
            if url in seen:  # one /shows/<id> per showtime; be safe anyway
                continue
            seen.add(url)

            detail = {}
            if fetches < _MAX_DETAIL_FETCHES:
                fetches += 1
                try:
                    detail = _show_detail(url)
                except Exception as e:
                    common.log(f"vcc: detail fetch failed {url} ({e})")
            else:
                common.log("vcc: detail-fetch cap reached")

            if isinstance(detail.get("start"), datetime):
                start = detail["start"]  # authoritative local showtime

            tags = ["sold-out"] if detail.get("sold_out") else []
            desc_parts = []
            if detail.get("doors"):
                desc_parts.append(f"Doors {detail['doors']}")
            if ev.get("description"):
                desc_parts.append(common.strip_tags(ev["description"]))
            description = " · ".join(desc_parts) or None

            events.append(common.make_event(
                source=SOURCE, title=name, url=url, start=start,
                venue="Vermont Comedy Club", town="Burlington",
                price=detail.get("price"), age=detail.get("age"),
                category="comedy", description=description,
                tags=tags or None))
        except Exception as e:
            common.log(f"vcc: skipping {ev.get('name')!r}: {e}")
    return events
