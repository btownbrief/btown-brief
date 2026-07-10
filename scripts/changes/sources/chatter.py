#!/usr/bin/env python3
"""
Hot posts from r/burlington, with RSS as a scoreless fallback when Reddit's
JSON endpoint rate-limits script clients.

State shape:  {"posts": [{"id", "title", "url", "score", "comments", "created"}]}
Diff:         new posts over 25 points, plus posts gaining 150 points per run
"""

import re
from datetime import datetime, timedelta, timezone

from ..common import get, get_json, parse_feed, event, parse_when, now_utc, iso, strip_tags

ID = "reddit-burlington"
NAME = "r/burlington"
JSON_URL = "https://www.reddit.com/r/burlington/hot.json?limit=25&raw_json=1"
# Reddit 403s non-browser clients; Stephen's Inoreader account republishes
# r/burlington as RSS (data/sources.json: ino-reddit-burlington). Scoreless,
# but every item links straight to the reddit thread.
RSS_URL = "https://www.inoreader.com/stream/user/1003590800/tag/Reddit%20%28r%2Fburlington%29"
BASE_URL = "https://www.reddit.com"
MAX_LINES = 6


def _full_url(value):
    if not value:
        return ""
    return value if value.startswith("http") else BASE_URL + value


_POST_ID = re.compile(r"/comments/([a-z0-9]+)")


def _post_id(url, fallback):
    """Normalize to the base-36 reddit post id from the permalink, so the JSON
    and RSS fetch paths agree on identity — a path flip between runs must not
    make every post look new."""
    m = _POST_ID.search(url or "")
    return m.group(1) if m else fallback


def snapshot():
    posts = []
    try:
        data = get_json(JSON_URL)
        for child in data.get("data", {}).get("children", []):
            post = child.get("data", {})
            if post.get("stickied"):
                continue
            title = strip_tags(post.get("title", ""))
            if not title:
                continue
            created = datetime.fromtimestamp(post["created_utc"], timezone.utc)
            url = _full_url(post.get("permalink"))
            posts.append({
                "id": _post_id(url, post.get("id") or url),
                "title": title,
                "url": url,
                "score": post.get("score"),
                "comments": post.get("num_comments"),
                "created": iso(created),
            })
    except Exception:
        for item in parse_feed(get(RSS_URL)):
            if not item.get("title"):
                continue
            url = _full_url(item.get("link"))
            posts.append({
                "id": _post_id(url, item["id"]),
                "title": item["title"],
                "url": url,
                "score": None,
                "comments": None,
                "created": iso(item["ts"]) if item.get("ts") else None,
            })
    return {"posts": posts}


def _new_detail(post):
    parts = []
    if post.get("score") is not None:
        parts.append(f"▲{post['score']}")
    if post.get("comments") is not None:
        parts.append(f"{post['comments']} comments")
    return " · ".join(parts)


def diff(prev, cur, bootstrap):
    run_now = now_utc()
    cutoff = run_now - timedelta(hours=24)
    previous = {} if prev is None else {p["id"]: p for p in prev.get("posts", [])}
    ranked = []

    for post in cur.get("posts", []):
        score = post.get("score")
        created = parse_when(post.get("created"))
        old = previous.get(post["id"])
        if score is None:
            # scoreless RSS fallback: a new post is still a change worth a line
            if old is None and created is not None and created >= cutoff:
                ranked.append((0, event(
                    ts=iso(created), category="chatter",
                    headline=f"New on r/burlington: {post['title']}",
                    detail="", url=post["url"], source=ID, source_name=NAME,
                    priority=1, kind="added",
                )))
            continue
        if old is None:
            if score < 25 or (bootstrap and (created is None or created < cutoff)):
                continue
            stamp = created if created is not None and created >= cutoff else run_now
            ranked.append((score, event(
                ts=iso(stamp), category="chatter",
                headline=f"Taking off on r/burlington: {post['title']}",
                detail=_new_detail(post), url=post["url"], source=ID, source_name=NAME,
                priority=2 if score >= 150 else 1, kind="added",
            )))
            continue

        old_score = old.get("score")
        if not bootstrap and old_score is not None and score - old_score >= 150:
            gain = score - old_score
            ranked.append((score, event(
                ts=iso(run_now), category="chatter",
                headline=f"Blowing up on r/burlington: {post['title']}",
                detail=f"▲{score}, up {gain} since last check",
                url=post["url"], source=ID, source_name=NAME,
                priority=2, kind="changed",
            )))

    ranked.sort(key=lambda pair: pair[0], reverse=True)
    return [ev for _, ev in ranked[:MAX_LINES]]
