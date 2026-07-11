#!/usr/bin/env python3
"""
New stories from Burlington newsrooms and city RSS feeds. State is kept per
feed so one broken endpoint cannot make stories from the other feeds repeat.

State shape:  {"feeds": {feed_id: {"items": [{"id", "title", "link", "ts", "summary"}]}}}
Diff:         new feed items -> news or food change lines, capped across feeds
"""

import json
import os
import re

from ..common import get, parse_feed, diff_feed_items, event, MAX_EVENTS_PER_SOURCE

ID = "news"
NAME = "Local news"

FEEDS = {
    "sevendays-news": ("Seven Days", "https://www.sevendaysvt.com/feed/"),
    "vtdigger": ("VTDigger", "https://vtdigger.org/feed/"),
    "vermont-public": ("Vermont Public", "https://www.vermontpublic.org/local-news.rss"),
    "wcax": ("WCAX", "https://www.wcax.com/arc/outboundfeeds/whiz-rss/category/news/?outputType=xml&sort=display_date:desc&size=50"),
    "mynbc5": ("NBC5", "https://www.mynbc5.com/topstories-rss"),
    "btv-news-releases": ("City of Burlington", "https://www.burlingtonvt.gov/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml"),
    "bpd-updates": ("Burlington Police", "https://www.burlingtonvt.gov/RSSFeed.aspx?ModID=1&CID=Police-Department-7"),
    "mayor-office": ("Mayor’s Office", "https://www.burlingtonvt.gov/RSSFeed.aspx?ModID=1&CID=Mayors-Office-9"),
}

STATEWIDE = {"vtdigger", "vermont-public", "wcax", "mynbc5"}
CITY = {"btv-news-releases", "bpd-updates", "mayor-office"}
RELEVANT = re.compile(
    r"\b(?:Burlington|South\s+Burlington|Winooski|Chittenden|UVM|Champlain|BTV|Church\s+Street|Queen\s+City)\b",
    re.I,
)
# Food routing needs a food-venue noun — "opening"/"closing" alone is not food news.
FOOD = re.compile(
    r"\b(?:restaurants?|cafés?|cafes?|brewer(?:y|ies)|baker(?:y|ies)|bistros?|diners?|"
    r"pizzeri(?:a|as)|delis?|creemees?|coffee\s+shops?|wine\s+bars?|cocktail\s+bars?|"
    r"menus?|food\s+trucks?|taprooms?|eater(?:y|ies))\b",
    re.I,
)
# Feed noise that is never a "Burlington changed" line: obituaries, legal
# notices, syndicated quizzes.
NOISE = re.compile(
    r"^(?:obituary|in memoriam)|\bobituar(?:y|ies)\b|legal notice|public notice|"
    r"superior court.{0,80}case no|^news quiz",
    re.I,
)
STATE_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "changes", "state.json")


def _previous_feeds():
    try:
        with open(STATE_PATH) as f:
            return json.load(f).get(ID, {}).get("feeds", {})
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def snapshot():
    feeds = {}
    previous = _previous_feeds()
    for feed_id, (_, url) in FEEDS.items():
        try:
            items = parse_feed(get(url))
            feeds[feed_id] = {"items": [{
                "id": item["id"],
                "title": item["title"],
                "link": item["link"],
                "ts": item["ts"].isoformat(timespec="seconds") if item["ts"] else None,
                "summary": item["summary"],
            } for item in items if item.get("title")]}
        except Exception:
            feeds[feed_id] = previous.get(feed_id, {"items": []})
    return {"feeds": feeds}


def diff(prev, cur, bootstrap):
    out = []
    prev_feeds = {} if prev is None else prev.get("feeds", {})
    for feed_id, (source_name, _) in FEEDS.items():
        def make_event(item, stamp, feed_id=feed_id, source_name=source_name):
            text = f"{item['title']} {item.get('summary', '')}"
            if NOISE.search(item["title"]):
                return None
            if feed_id in STATEWIDE and not RELEVANT.search(text):
                return None
            is_food = bool(FOOD.search(text))
            return event(
                ts=stamp, category="food" if is_food else "news",
                headline=item["title"], detail="", url=item.get("link", ""),
                source=feed_id, source_name=source_name,
                priority=2 if is_food or feed_id in CITY else 1,
            )

        out.extend(diff_feed_items(
            prev_feeds.get(feed_id), cur.get("feeds", {}).get(feed_id, {"items": []}),
            bootstrap, make_event,
        ))
    out.sort(key=lambda e: (e["priority"], e["ts"]), reverse=True)
    return out[:MAX_EVENTS_PER_SOURCE]
