#!/usr/bin/env python3
"""Refresh data/reddit.json from r/GoodBurlington.

Fixes the long-broken "From the community" block on things-to-do.html /
index.html (js/app.js:57 fetches data/reddit.json, which has been
`{"updated": null, "posts": []}` since Reddit started 403ing GitHub
runners — see SUMMARY-chatter.md). Also feeds the "Recently on
r/GoodBurlington" strip on best-of-reddit.html.

Reddit's own listing (real upvote scores) comes first, through
scripts/reddit_client.py's read-only OAuth route once REDDIT_CLIENT_ID/SECRET
are set (skipped without them: the logged-out .json 403s since May 2026),
then Steve's
public Inoreader stream is tried as a fallback/supplement (no auth, but
Inoreader never carries a score — those posts get score 0 so the existing
"▲ N" badge in js/app.js never renders blank). On any failure, or if too
few posts come back, the last good data/reddit.json is kept untouched —
the community block should never go blank because of a bad run.

CLI flags mirror refresh_chatter.py: --fixtures DIR, --selftest, --dry-run.
"""

import argparse
from datetime import datetime, timezone
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import reddit_client  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "data", "reddit.json")
UA = "btown-brief-site/1.0 (goodburlington refresh)"
SUB = "r/GoodBurlington"

# Same account/tag pattern as the r/burlington and r/vermont streams
# already hardcoded in refresh_chatter.py's INOREADER dict.
INOREADER_URL = "https://www.inoreader.com/stream/user/1003590800/tag/Reddit%20%28r%2FGoodBurlington%29"

# Reddit.json only stores title/score/url/created_utc (no body), so the
# risk surface is small, but drop anything with a phone-number-shaped
# string out of caution before it ever reaches the public page.
PHONE_RE = re.compile(r"(?<!\d)(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}(?!\d)")


def clean_space(value):
    return re.sub(r"\s+", " ", value or "").strip()


def reddit_id(url):
    match = re.search(r"/comments/([a-z0-9]+)/", url or "", re.I)
    return match.group(1).lower() if match else None


def reddit_url(url):
    post_id = reddit_id(url)
    if not post_id:
        return None
    path = urllib.parse.urlsplit(url).path
    return "https://www.reddit.com" + path


def fetch_bytes(url, accept):
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def parse_reddit_json(raw):
    posts = []
    data = raw if isinstance(raw, dict) else json.loads(raw)
    children = (data.get("data") or {}).get("children", [])
    for child in children[:25]:
        row = child.get("data") or {}
        if row.get("stickied"):
            continue
        title = clean_space(row.get("title"))
        link = reddit_url("https://www.reddit.com" + (row.get("permalink") or ""))
        post_id = reddit_id(link)
        if not post_id or not title or PHONE_RE.search(title):
            continue
        posts.append({
            "id": post_id, "title": title, "score": row.get("score", 0),
            "url": link, "created_utc": row.get("created_utc"),
        })
    return posts


def parse_inoreader_xml(raw):
    posts = []
    for item in ET.fromstring(raw).findall(".//item")[:25]:
        link = reddit_url(item.findtext("link"))
        post_id = reddit_id(link)
        title = clean_space(item.findtext("title"))
        if not post_id or not title or PHONE_RE.search(title):
            continue
        pub = item.findtext("pubDate")
        created_utc = None
        if pub:
            try:
                from email.utils import parsedate_to_datetime
                created_utc = parsedate_to_datetime(pub).timestamp()
            except Exception:
                created_utc = None
        # Inoreader never carries a score; 0 keeps the "▲ N" badge in
        # js/app.js from rendering blank rather than pretending it's real.
        posts.append({"id": post_id, "title": title, "score": 0, "url": link, "created_utc": created_utc})
    return posts


def merge_posts(groups):
    merged = {}
    for posts in groups:
        for post in posts:
            old = merged.get(post["id"])
            if not old:
                merged[post["id"]] = post
                continue
            # Prefer a real score / created_utc over a 0/None placeholder.
            if post.get("score"):
                old["score"] = post["score"]
            if post.get("created_utc") and not old.get("created_utc"):
                old["created_utc"] = post["created_utc"]
    return list(merged.values())


def load_posts(fixtures=None, client=None):
    if fixtures:
        groups = []
        json_path = os.path.join(fixtures, "reddit-goodburlington.json")
        if os.path.exists(json_path):
            with open(json_path, encoding="utf-8") as src:
                groups.append(parse_reddit_json(src.read()))
        xml_path = os.path.join(fixtures, "inoreader-goodburlington.xml")
        if os.path.exists(xml_path):
            with open(xml_path, "rb") as src:
                groups.append(parse_inoreader_xml(src.read()))
        return merge_posts(groups), "fixtures"

    groups = []
    used_reddit = used_inoreader = False
    client = client or reddit_client.Client()
    if client.oauth:
        try:
            groups.append(parse_reddit_json(client.oauth_json("r/GoodBurlington/hot", limit=25)))
            used_reddit = True
        except reddit_client.RedditError as exc:
            print(f"reddit GoodBurlington failed: {exc}", file=sys.stderr)
    try:
        raw = fetch_bytes(INOREADER_URL, "application/rss+xml, application/xml")
        groups.append(parse_inoreader_xml(raw))
        used_inoreader = True
    except Exception as exc:
        print(f"inoreader GoodBurlington failed: {exc}", file=sys.stderr)

    mode = ("reddit+inoreader" if used_reddit and used_inoreader else
            "reddit-only" if used_reddit else
            "inoreader-only" if used_inoreader else "none")
    return merge_posts(groups), mode


def run(fixtures=None, dry_run=False):
    posts, mode = load_posts(fixtures)
    posts.sort(key=lambda p: p.get("created_utc") or 0, reverse=True)
    posts = posts[:12]

    if not posts:
        print("zero GoodBurlington posts loaded; keeping last good data/reddit.json")
        return 0

    output = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "mode": mode,
        "posts": [{"title": p["title"], "score": p.get("score") or 0, "url": p["url"],
                    "created_utc": p.get("created_utc")} for p in posts],
    }

    if dry_run:
        print(json.dumps(output, indent=2, ensure_ascii=False))
        return 0

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as dst:
        json.dump(output, dst, indent=2, ensure_ascii=False)
        dst.write("\n")
    print(f"wrote data/reddit.json: {len(posts)} posts, mode={mode}")
    return 0


def selftest():
    sample_reddit = json.dumps({"data": {"children": [
        {"data": {"id": "abc123", "title": "Someone fixed my flat for free", "score": 42,
                  "permalink": "/r/GoodBurlington/comments/abc123/someone_fixed_my_flat/",
                  "created_utc": 1750000000, "stickied": False}},
        {"data": {"id": "stuck", "title": "Read the rules", "score": 1,
                  "permalink": "/r/GoodBurlington/comments/stuck/rules/",
                  "created_utc": 1750000001, "stickied": True}},
        {"data": {"id": "phone1", "title": "Call me at 802-555-0134 for help", "score": 3,
                  "permalink": "/r/GoodBurlington/comments/phone1/call/",
                  "created_utc": 1750000002, "stickied": False}},
    ]}})
    posts = parse_reddit_json(sample_reddit)
    assert len(posts) == 1, posts
    assert posts[0]["id"] == "abc123"
    assert posts[0]["score"] == 42

    sample_xml = (
        "<rss><channel>"
        "<item><title>Neighbor shoveled my walk</title>"
        "<link>https://www.reddit.com/r/GoodBurlington/comments/xyz789/neighbor_shoveled/</link>"
        "<pubDate>Mon, 01 Jan 2026 12:00:00 +0000</pubDate></item>"
        "</channel></rss>"
    ).encode()
    ino_posts = parse_inoreader_xml(sample_xml)
    assert len(ino_posts) == 1 and ino_posts[0]["score"] == 0

    merged = merge_posts([posts, ino_posts])
    assert len(merged) == 2

    assert reddit_id("https://www.reddit.com/r/GoodBurlington/comments/abc123/x/") == "abc123"
    assert reddit_url("https://old.reddit.com/r/GoodBurlington/comments/abc123/x/?utm=1") == \
        "https://www.reddit.com/r/GoodBurlington/comments/abc123/x/"
    print("refresh_goodburlington selftest passed")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", metavar="DIR")
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    return selftest() if args.selftest else run(args.fixtures, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
