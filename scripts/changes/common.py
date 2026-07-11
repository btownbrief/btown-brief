#!/usr/bin/env python3
"""
Shared helpers for the "Since You Checked" change pipeline.

Every source module in scripts/changes/sources/ exposes:

    ID = "gmt-alerts"                    # stable source id (matches data/sources.json where possible)

    def snapshot() -> dict               # fetch live data, return normalized current state.
                                         # Raise on total failure (orchestrator keeps last good state).

    def diff(prev, cur, bootstrap) -> list[dict]
                                         # prev: previous state dict or None
                                         # cur:  the state snapshot() just returned
                                         # bootstrap: True when prev is None (first ever run) —
                                         #   emit events only for things whose OWN timestamp falls
                                         #   inside the last BOOTSTRAP_HOURS, so first-time visitors
                                         #   see a real "last 24 hours" instead of a firehose.
                                         # Returns change events (see event() below).

Design rules (match scripts/refresh_weather.py):
  - stdlib only, no pip installs
  - every source fails independently; the orchestrator keeps its last good state
  - be a polite client: identify ourselves, time out, retry once
"""

import email.utils
import json
import re
import time
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

BTV_TZ = ZoneInfo("America/New_York")
UA = "btownbrief.com since-you-checked pipeline (stephenvdavis@gmail.com)"
BOOTSTRAP_HOURS = 24          # first-run window for sources with native timestamps
MAX_EVENTS_PER_SOURCE = 12    # per run, keeps one noisy feed from drowning the page

# Category registry — the page renders these in this default order before
# re-sorting by "biggest change first". Keys are what event() validates against.
CATEGORIES = {
    "weather":  {"icon": "🌩", "label": "Weather"},
    "roads":    {"icon": "🚧", "label": "Roads & Transit"},
    "lake":     {"icon": "🏖", "label": "The Lake"},
    "cityhall": {"icon": "🏛", "label": "City Hall"},
    "food":     {"icon": "🍽", "label": "Food & Drink"},
    "events":   {"icon": "🎭", "label": "Events"},
    "news":     {"icon": "📰", "label": "News"},
    "chatter":  {"icon": "💬", "label": "Chatter"},
}


def now_utc():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds")


def parse_when(value):
    """Parse RFC-822 (RSS) or ISO-8601 (Atom/APIs) into an aware UTC datetime, or None."""
    if not value:
        return None
    value = value.strip()
    try:
        dt = email.utils.parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (TypeError, ValueError):
        pass
    try:
        v = value.replace("Z", "+00:00")
        dt = datetime.fromisoformat(v)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=BTV_TZ)  # bare local times from city systems
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def get(url, timeout=20, retries=1, headers=None):
    """GET → bytes. One quiet retry; raises on final failure."""
    hdrs = {"User-Agent": UA, "Accept": "*/*"}
    if headers:
        hdrs.update(headers)
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            last_err = e
            if attempt < retries:
                time.sleep(2)
    raise RuntimeError(f"GET {url} failed: {last_err}")


def get_json(url, **kw):
    return json.loads(get(url, **kw).decode("utf-8", "replace"))


def strip_tags(text):
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&#0?39;|&apos;|&#8217;", "’", text)
    text = re.sub(r"&quot;|&#8220;|&#8221;", '"', text)
    text = re.sub(r"&[a-zA-Z#0-9]+;", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _text(el, path, ns=None):
    found = el.find(path, ns) if ns else el.find(path)
    return (found.text or "").strip() if found is not None and found.text else ""


def parse_feed(raw):
    """Parse RSS 2.0 or Atom bytes → list of {id, title, link, ts, summary}.

    ts is an aware UTC datetime or None. id prefers guid/atom-id, falls back
    to link, then title — stable enough to diff runs against each other.
    """
    # Some feeds (Reddit, city CivicPlus) prepend BOM/whitespace or use odd encodings
    text = raw.decode("utf-8", "replace").lstrip("﻿ \r\n")
    root = ET.fromstring(text)
    items = []

    if root.tag.endswith("feed"):  # Atom
        ns = {"a": "http://www.w3.org/2005/Atom"}
        for entry in root.findall("a:entry", ns):
            link = ""
            for l in entry.findall("a:link", ns):
                if l.get("rel") in (None, "alternate"):
                    link = l.get("href", "")
                    break
            when = _text(entry, "a:published", ns) or _text(entry, "a:updated", ns)
            title = strip_tags(_text(entry, "a:title", ns))
            items.append({
                "id": _text(entry, "a:id", ns) or link or title,
                "title": title,
                "link": link,
                "ts": parse_when(when),
                "summary": strip_tags(_text(entry, "a:summary", ns) or _text(entry, "a:content", ns))[:400],
            })
    else:  # RSS 2.0 / RDF
        channel = root.find("channel")
        nodes = channel.findall("item") if channel is not None else root.findall(".//item")
        for item in nodes:
            title = strip_tags(_text(item, "title"))
            link = _text(item, "link")
            guid = _text(item, "guid")
            when = _text(item, "pubDate") or _text(item, "{http://purl.org/dc/elements/1.1/}date")
            items.append({
                "id": guid or link or title,
                "title": title,
                "link": link,
                "ts": parse_when(when),
                "summary": strip_tags(_text(item, "description"))[:400],
            })
    return items


def event(ts, category, headline, url, source, source_name, detail="", priority=1, kind="added"):
    """One human-readable change line. priority: 3 affects-your-day, 2 notable, 1 ambient."""
    assert category in CATEGORIES, f"unknown category {category}"
    if isinstance(ts, datetime):
        ts = iso(ts)
    return {
        "ts": ts,
        "category": category,
        "headline": headline.strip(),
        "detail": detail.strip() if detail else "",
        "url": url or "",
        "source": source,
        "sourceName": source_name,
        "priority": priority,
        "kind": kind,  # added | removed | changed | status
    }


def diff_feed_items(prev, cur, bootstrap, make_event, window_hours=BOOTSTRAP_HOURS):
    """Generic differ for feed-shaped state: {"items": [{id, title, link, ts?, ...}]}.

    Emits make_event(item, ts_iso) for items new since the previous run.
    On bootstrap, only items whose own timestamp is inside the window count.
    New items with no/old pubDate get stamped with the run time — the feed
    surfaced them now, that's when the world changed for the reader.
    """
    run_now = now_utc()
    cutoff = run_now - timedelta(hours=window_hours)
    prev_ids = set() if prev is None else {i["id"] for i in prev.get("items", [])}
    out = []
    for item in cur.get("items", []):
        if item["id"] in prev_ids:
            continue
        its = parse_when(item.get("ts")) if isinstance(item.get("ts"), str) else item.get("ts")
        if its and its > run_now:
            its = run_now  # clamp future-dated pubDates; never show "in 3 hours"
        if bootstrap:
            if its is None or its < cutoff:
                continue
            stamp = its
        else:
            stamp = its if (its and its > cutoff) else run_now
        ev = make_event(item, iso(stamp))
        if ev:
            out.append(ev)
        if len(out) >= MAX_EVENTS_PER_SOURCE:
            break
    return out


def serialize_state(state):
    """Make a state dict JSON-safe (datetimes → ISO strings)."""
    def conv(o):
        if isinstance(o, datetime):
            return iso(o)
        raise TypeError(f"not serializable: {type(o)}")
    return json.loads(json.dumps(state, default=conv))
