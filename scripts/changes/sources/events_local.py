#!/usr/bin/env python3
"""
Newly added events, read from the repo's own data/events.json (the feat/events
pipeline refreshes it). No network: the events pipeline already did the
fetching; we just notice what appeared between runs.

State shape:  {"items": [{"id", "title", "link", "ts", "start", "venue"}]}
Diff:         new event ids -> "New event: <title> — <weekday> at <venue>"
"""

import json
import os
from datetime import datetime, timedelta

from ..common import event, parse_when, now_utc, iso, BTV_TZ

ID = "events-local"
NAME = "BTown Brief events"
EVENTS_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "events.json")
PAGE_URL = "events.html"
MAX_LINES = 8


def _load_events():
    with open(EVENTS_PATH) as f:
        data = json.load(f)
    # events.json is either a list of events or {"events": [...]}
    if isinstance(data, dict):
        data = data.get("events", [])
    return data


def snapshot():
    items = []
    for e in _load_events():
        if not isinstance(e, dict):
            continue
        title = e.get("title") or e.get("name") or ""
        if not title:
            continue
        start = e.get("start") or e.get("startDate") or e.get("date") or ""
        eid = e.get("id") or e.get("url") or f"{title}|{start}"
        items.append({
            "id": str(eid),
            "title": title,
            "link": e.get("url") or e.get("link") or PAGE_URL,
            "ts": e.get("added") or e.get("firstSeen") or None,
            "start": start,
            "venue": e.get("venue") or e.get("location") or "",
        })
    return {"items": items}


def _when_phrase(start):
    dt = parse_when(start)
    if not dt:
        return ""
    local = dt.astimezone(BTV_TZ)
    today = now_utc().astimezone(BTV_TZ).date()
    d = local.date()
    if d == today:
        day = "today"
    elif d == today + timedelta(days=1):
        day = "tomorrow"
    elif 0 < (d - today).days <= 6:
        day = local.strftime("%A")
    else:
        day = local.strftime("%b %-d")
    if local.hour or local.minute:
        return f"{day} {local.strftime('%-I:%M %p').replace(':00', '')}"
    return day


def diff(prev, cur, bootstrap):
    run_now = now_utc()
    prev_ids = set() if prev is None else {i["id"] for i in prev.get("items", [])}
    horizon = run_now + timedelta(days=14)
    out = []
    for item in cur.get("items", []):
        if item["id"] in prev_ids:
            continue
        start = parse_when(item.get("start"))
        # only surface upcoming events; skip past ones and far-future noise
        if start and (start < run_now - timedelta(hours=6) or start > horizon):
            continue
        if bootstrap:
            # no reliable "added" timestamp on first run -> nothing honest to say
            added = parse_when(item.get("ts"))
            if added is None or added < run_now - timedelta(hours=24):
                continue
            stamp = added
        else:
            stamp = parse_when(item.get("ts")) or run_now
            # clamp to a credible window: an event first seen NOW with a stale
            # or future "added" stamp still changed the world at this run
            if stamp > run_now or stamp < run_now - timedelta(hours=24):
                stamp = run_now
        when = _when_phrase(item.get("start"))
        bits = [b for b in (when, item.get("venue")) if b]
        out.append(event(
            ts=iso(stamp), category="events",
            headline=f"New event: {item['title']}",
            detail=" · ".join(bits),
            url=item["link"], source=ID, source_name=NAME,
            priority=2 if when in ("today", "tomorrow") or (when or "").startswith(("Fri", "Sat", "Sun")) else 1,
        ))
        if len(out) >= MAX_LINES:
            break
    return out
