#!/usr/bin/env python3
"""
Surface opening/closing candidates for the Openings & Closings page.

Scans the feeds the site already collects — the ticker, the chatter news
pool, and the Since You Checked change log — for headlines that smell like
a business opening or closing, drops anything already on the page, and
writes the survivors to data/openings-suggestions.md for review.

    python3 scripts/suggest_openings.py                 # full local checklist
    python3 scripts/suggest_openings.py --new-only      # only never-surfaced ones
    python3 scripts/suggest_openings.py --new-only --mark-seen
                                                        # …and remember them

--new-only filters against data/openings-seen.json (candidates already
surfaced once); --mark-seen records this run's candidates there. The weekly
openings-radar workflow uses both so its GitHub issue only pings about
genuinely new candidates. Local runs without flags always show everything.

Set BTB_ARCHIVE_STORIES to point at the archive repo's stories.json when
the sibling checkout isn't at ../archive (the workflow downloads it).

This script only SUGGESTS. Nothing it writes is published: entries reach
data/openings.json by hand, after the story checks out. The suggestions
file is local-only (gitignored), like the other working docs.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone

ROOT = os.path.join(os.path.dirname(__file__), "..")
OPENINGS = os.path.join(ROOT, "data", "openings.json")
OUT = os.path.join(ROOT, "data", "openings-suggestions.md")
SEEN = os.path.join(ROOT, "data", "openings-seen.json")

FEEDS = [
    ("ticker", os.path.join(ROOT, "data", "ticker.json")),
    ("chatter", os.path.join(ROOT, "data", "chatter.json")),
    ("changes", os.path.join(ROOT, "data", "changes", "changes.json")),
]

# The Brief's own archive (sibling repo, ~/btownbrief/archive) tags stories
# with openClose — the single best source. Optional: skipped silently when
# the checkout isn't there. BTB_ARCHIVE_STORIES overrides the path (the
# radar workflow downloads the raw file and points here).
ARCHIVE = os.environ.get(
    "BTB_ARCHIVE_STORIES",
    os.path.join(ROOT, "..", "archive", "data", "stories.json"))

# Business-change language. Word-boundary anchored so "reopens" still hits
# ("re" + open) but "chopin" doesn't.
SIGNAL = re.compile(
    r"\b(open(s|ed|ing)?|re-?open(s|ed|ing)?|close(s|d|ing|ure)?|"
    r"shutter(s|ed|ing)?|debut(s|ed|ing)?|launch(es|ed|ing)?|"
    r"first bite|entr[ée]es & exits|last (day|call)|"
    r"going out of business|new (restaurant|caf[eé]|bar|shop|store|spot)|"
    r"relocat(es|ed|ing)|mov(es|ed|ing) (into|back)|"
    r"mov(es|ed|ing) to (?!bring|make|allow|approve|consider|put|require))\b",
    re.IGNORECASE,
)

# Direction of a headline's signal, so a tracked-open business that later
# CLOSES still gets suggested (and vice versa) instead of being suppressed
# by its own name.
CLOSING_SIGNAL = re.compile(
    r"\b(close(s|d|ing|ure)?|shutter|going out of business|last (day|call))\b",
    re.IGNORECASE,
)

# Openings/closings of things that aren't storefronts. A hit here means the
# headline is almost certainly beaches, roads, meetings, or seasons — the
# feeds are full of those and none belong on the page.
NOISE = re.compile(
    r"\b(beach(es)?|water access|road|street closure|highway|interstate|"
    r"parkway|bridge|trail|bike park|lane|ramp|cove|school year|schools?|"
    r"meeting|agenda|hearing|subcommittee|session|registration|"
    r"applications?|enrollment|season|weekend|pool|rink|ski|mountain|"
    r"open house|open letter|opening act|open mic|open source|"
    r"open drug|encampment|flood|rain|wastewater|fema|buyout)\b",
    re.IGNORECASE,
)


def plain(text):
    """Lowercase and straighten curly quotes, so name matching isn't
    defeated by 'Burl’s' vs \"Burl's\"."""
    return text.lower().replace("’", "'").replace("‘", "'")


def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def known_keys():
    """What's already on the page: source URLs, plus (name, direction) pairs
    so we only suppress headlines that repeat the tracked story — a later
    story pointing the other way (a tracked opening later closing) still
    surfaces."""
    data = load(OPENINGS) or {}
    urls, names = set(), set()
    for e in data.get("entries", []):
        if e.get("source"):
            urls.add(e["source"].strip())
        if e.get("name"):
            # Strip any parenthetical so "Old Brick Store outpost (Public
            # Service VT)" still suppresses plain "Old Brick Store" headlines.
            name = plain(re.sub(r"\s*\(.*?\)", "", e["name"]).strip())
            closing = e.get("status") == "closed"
            names.add((name, closing))
            if " outpost" in name:
                names.add((name.split(" outpost")[0], closing))
    return urls, names


def harvest(feed_name, data):
    """Yield (text, url, extra) candidates out of one feed's shape."""
    if data is None:
        return
    if feed_name == "ticker":
        for h in data.get("headlines", []):
            if isinstance(h, str):
                yield h, "", ""
    elif feed_name == "chatter":
        for pool in ("news", "feed", "highlights", "rough"):
            for item in data.get(pool, []):
                if isinstance(item, dict) and item.get("title"):
                    yield (item["title"], item.get("url", ""),
                           item.get("outlet") or item.get("domain")
                           or item.get("sub") or "")
        for topic in data.get("topics", []):
            for item in (topic or {}).get("sources", []):
                if isinstance(item, dict) and item.get("title"):
                    yield (item["title"], item.get("url", ""),
                           item.get("outlet") or item.get("sub") or "")
    elif feed_name == "changes":
        for item in data.get("events", []):
            if isinstance(item, dict) and item.get("headline"):
                yield (item["headline"], item.get("url", ""),
                       item.get("sourceName") or "")
    elif feed_name == "archive":
        for item in data if isinstance(data, list) else []:
            if isinstance(item, dict) and item.get("openClose") and item.get("headline"):
                yield (item["headline"], item.get("url", ""),
                       "Brief %s" % (item.get("date") or "archive"))


def main():
    new_only = "--new-only" in sys.argv
    mark_seen = "--mark-seen" in sys.argv
    already = set(load(SEEN) or []) if (new_only or mark_seen) else set()

    urls, names = known_keys()
    suggestions, seen, failed = [], set(), []

    feeds = list(FEEDS)
    if os.path.exists(ARCHIVE):
        feeds.append(("archive", ARCHIVE))
    for feed_name, path in feeds:
        data = load(path)
        if data is None:
            failed.append(feed_name)
            continue
        for text, url, outlet in harvest(feed_name, data):
            if not SIGNAL.search(text) or NOISE.search(text):
                continue
            key = (url or text).strip().lower()
            if key in seen or (url and url.strip() in urls):
                continue
            if new_only and key in already:
                continue
            closing = bool(CLOSING_SIGNAL.search(text))
            if any(name in plain(text) and closing == was_closing
                   for name, was_closing in names):
                continue
            seen.add(key)
            suggestions.append({
                "text": text.strip(), "url": url, "outlet": outlet,
                "feed": feed_name, "key": key,
            })

    stamp = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M %Z")
    lines = [
        "# Openings & Closings — candidates to curate",
        "",
        "Generated by scripts/suggest_openings.py on %s. Local-only." % stamp,
        "Verify each story, then add keepers to data/openings.json by hand",
        "(name, area, status, date, one-line story, source URL).",
        "",
    ]
    if failed:
        lines.append("**Heads up:** couldn't read these feeds, so the list "
                     "below is partial: %s." % ", ".join(failed))
        lines.append("")
    if suggestions:
        for s in suggestions:
            src = " — [%s](%s)" % (s["outlet"] or "link", s["url"]) if s["url"] else ""
            lines.append("- [ ] %s%s  `%s`" % (s["text"], src, s["feed"]))
    else:
        lines.append("Nothing new in the feeds right now.")
    lines.append("")

    with open(OUT, "w") as f:
        f.write("\n".join(lines))
    if mark_seen and suggestions:
        with open(SEEN, "w") as f:
            json.dump(sorted(already | {s["key"] for s in suggestions}),
                      f, indent=1)
    print("Wrote %d candidate(s) to %s" % (len(suggestions), OUT))
    if failed:
        print("WARNING: unreadable feed(s): %s" % ", ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
