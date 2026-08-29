#!/usr/bin/env python3
"""Build currents-pools.json for the Wander doorway (nightly).

Pools (CURRENTS-NOTES.md, all verified live):
  weird-stuff  - Wikipedia:Unusual articles + the joke one-liners that make
                 that list worth reading in the first place
  trending     - the day's most-read articles, off the featured feed
  on-this-day  - events from the featured feed
near-here is CLIENT-LIVE geosearch - deliberately NOT in this file, because
the pool builder has no idea the reader is in Burlington and the query is
instant from the browser anyway.

Wikimedia 403s default-UA scripts: a real User-Agent is REQUIRED.
"""
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

UA = "btownbrief-currents-pools/1.0 (https://btownbrief.com; contact: steve@btownbrief.com)"
REST = "https://en.wikipedia.org/api/rest_v1/"
ACTION = "https://en.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*&"
NS_SKIP = ("Wikipedia:", "File:", "Category:", "Template:", "Portal:", "Help:")
ENTRY_RE = re.compile(r"^['|]*\s*'''\[\[([^\]|]+)(?:\|([^\]]+))?\]\]'''")
TEMPLATE_RE = re.compile(r"\{\{[^}]+\}\}")
WIKILINK_RE = re.compile(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]")


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.load(res)


def harvest_entries(wikitext, seen):
    """Subpage entries are wikitables: a bold-link cell, then the blurb on the
    next line. The blurb is the whole point of this pool - a bare list of
    titles would be no better than the random endpoint."""
    lines = wikitext.splitlines()
    out = []
    for idx, line in enumerate(lines):
        m = ENTRY_RE.match(line.strip())
        if not m:
            continue
        title = m.group(1).strip()
        if title in seen or title.startswith(":") or title.startswith(NS_SKIP):
            continue
        blurb = lines[idx + 1].strip().lstrip("|").strip() if idx + 1 < len(lines) else ""
        blurb = TEMPLATE_RE.sub("", blurb)
        blurb = WIKILINK_RE.sub(r"\1", blurb)
        blurb = re.sub(r"'{2,}", "", blurb).strip()
        seen.add(title)
        out.append({"t": title, "d": blurb[:140]})
        if len(out) >= 40:
            break
    return out, seen


def weird_stuff():
    # The main page transcludes its entries from subpages like
    # "Wikipedia:Unusual articles/Places and infrastructure" - that is
    # where the one-liners live.
    data = get_json(ACTION + "action=parse&page=Wikipedia%3AUnusual%20articles&prop=wikitext")
    subpages = re.findall(r"\{\{/(.+?)\}\}", data["parse"]["wikitext"])
    out, seen = [], set()
    for sub in subpages[:6]:
        if len(out) >= 40:
            break
        page = "Wikipedia:Unusual articles/" + sub.strip()
        try:
            subdata = get_json(ACTION + "action=parse&page=" +
                               urllib.parse.quote(page, safe="") + "&prop=wikitext")
            more, seen = harvest_entries(subdata["parse"]["wikitext"], seen)
            out.extend(more[: max(0, 40 - len(out))])
        except Exception as exc:
            print("warn: {} failed: {}".format(page, exc), file=sys.stderr)
    return out


def featured(day_offset=1):
    day = datetime.now(timezone.utc) - timedelta(days=day_offset)
    return get_json(REST + "feed/featured/{:%Y/%m/%d}".format(day))


def trending():
    # The metrics pageviews endpoint 404s for recent dates in practice;
    # mostread off the featured feed carries the same top list.
    articles = (featured().get("mostread") or {}).get("articles") or []
    skip = ("Main Page", "Special:", "Wikipedia:", "Portal:", "Search")
    out, seen = [], set()
    for a in articles:
        title = (a.get("title") or "").replace("_", " ")
        if not title or title in seen or title.startswith(skip):
            continue
        seen.add(title)
        out.append({"t": title})
        if len(out) >= 40:
            break
    return out


def on_this_day():
    # One page often anchors several related events - keep the first mention.
    out, seen = [], set()
    for ev in (featured().get("onthisday") or []):
        page = (ev.get("pages") or [{}])[0]
        title = (page.get("titles") or {}).get("normalized")
        if not title or title in seen:
            continue
        seen.add(title)
        out.append({"t": title, "d": (ev.get("text") or "")[:140]})
        if len(out) >= 16:
            break
    return out


def main():
    pools = {}
    failures = []
    for name, fn in (("weird-stuff", weird_stuff), ("trending", trending), ("on-this-day", on_this_day)):
        try:
            pools[name] = fn()
        except Exception as exc:
            failures.append(name)
            print("warn: {} failed: {}".format(name, exc), file=sys.stderr)
    total = sum(len(p) for p in pools.values())
    if total < 20:
        print("refusing to publish suspiciously small payload ({} entries)".format(total), file=sys.stderr)
        sys.exit(1)
    payload = {
        "v": 1,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "pools": pools,
    }
    json.dump(payload, sys.stdout, ensure_ascii=False, indent=1)
    print()
    if failures:
        print("warn: partial pools, failed: {}".format(", ".join(failures)), file=sys.stderr)


if __name__ == "__main__":
    main()
