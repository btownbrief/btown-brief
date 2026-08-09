#!/usr/bin/env python3
"""Burlington Pulse — build the combined local + national headline feed.

One JSON payload (data/pulse.json) drives pulse.html: every source in two
public Inoreader folders, each with its rolling last-20 headlines, plus a
flat newest-first index across all of them. Inoreader is the curation
surface — add or remove a feed in either folder and the site follows on
the next run, no code changes here.

How the data flows, and why:

  * The source ROSTER comes from the folders' public OPML exports, so
    names/sites/membership always match what Stephen sees in Inoreader.
  * Fresh ITEMS come from the folders' public stream feeds. Inoreader
    fetches the underlying feeds server-side, which is what lets Reddit
    and other cloud-IP-hostile hosts work from GitHub Actions (same trick
    refresh_chatter.py used, minus the local-runner half).
  * A stream is a recency window, and busy national wires (ESPN, Guardian)
    would starve quiet sources out of it. So each run MERGES the stream
    into the previous payload: per-source lists are unioned by URL, capped
    at ITEM_CAP, and a quiet source simply keeps its last-known headlines
    with honest ages — exactly how brutalist.report treats slow feeds.
  * National sources get a topic from data/pulse-topics.json (domain →
    topic, hand-checked against brutalist.report's sections). Everything
    in the local folder is topic "local". Unknown domains land in "news".

Failure posture: every fetch is retried, any hard failure exits non-zero
before writing, and a payload that shrank suspiciously is refused — the
workflow then simply doesn't push, so the page keeps the last good data.

CLI:
  --seed       also fetch every source's own feed directly (deep backfill;
               run from a residential IP so Reddit et al. answer)
  --store IN   previous payload to merge into (default: the --out path)
  --out PATH   where to write (default data/pulse.json)
  --selftest   run the pure-function checks and exit
"""

import argparse
import concurrent.futures
import hashlib
import html
import json
import os
import re
import sys
import time
from collections import Counter
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "data", "pulse.json")
TOPICS_FILE = os.path.join(ROOT, "data", "pulse-topics.json")
UA = "btown-brief-site/1.0 (burlington pulse refresh)"

INO = "https://www.inoreader.com"
USER = "1003590800"
# (folder label, is_local). Folder names are URL-encoded on use.
FOLDERS = [
    ("Everything", False),
    ("Broader Local News & Podcasts", True),
]
# Stream depth per run. The rolling store supplies history, so these only
# need to cover everything published since the last run (~20 minutes) with
# lots of slack; bigger numbers just re-download full article bodies.
STREAM_N = {False: 300, True: 150}
SEED_STREAM_N = 1000  # --seed casts a wider net once

ITEM_CAP = 20          # headlines kept per source
TITLE_MAX = 200
MIN_SOURCES = 40       # roster sanity floor (folders hold ~90 today)
MIN_ITEMS = 150        # payload sanity floor after the folders are warm

# Query params that only track — matched EXACTLY (plus the utm_ prefix);
# everything else in a URL is kept (YouTube needs ?v=, feeds use ?rssid=…).
TRACKING_PARAMS = {"utm", "fbclid", "gclid", "mc_cid", "mc_eid", "cmpid",
                   "smid", "ncid", "ftag", "rss"}
# Hosts that only ever serve podcast audio — marks the source as a podcast
# even before an audio enclosure shows up in the window.
PODCAST_HOSTS = ("buzzsprout.com", "anchor.fm", "spotify.com", "libsyn.com",
                 "megaphone.fm", "simplecast.com", "transistor.fm",
                 "podbean.com", "audioboom.com", "captivate.fm")
# Hosts that host many unrelated feeds — topic lookup needs the path too.
MULTI_FEED_HOSTS = ("reddit.com", "youtube.com")

# Chip-sized display names. Feed titles are whatever the publisher put in
# <channel><title> ("Latest Science News -- ScienceDaily"), which is too much
# for the app-style source chips. Keyed by source id (the title slug); any
# source not listed gets shorten()'s generic cleanup, so a renamed feed
# degrades to "pretty good" instead of breaking.
SHORT_NAMES = {
    "abc-news-top-stories": "ABC News",
    "artificial-intelligence": "r/Artificial",
    "bbc-news-us-canada": "BBC News",
    "billboard-com-music-news": "Billboard",
    "burlington-vt-news-flash-police-department": "BTV Police",
    "cnet-news-com": "CNET",
    "engadget-full-rss-feed": "Engadget",
    "espn-com-nba": "ESPN NBA",
    "espn-com-nfl": "ESPN NFL",
    "fortune-fortune": "Fortune",
    "hacker-news-daily": "HN Daily",
    "hacker-news-front-page": "Hacker News",
    "heavy-com": "Heavy",
    "jokes-get-your-funny-on": "r/Jokes",
    "latest-science-news-sciencedaily": "ScienceDaily",
    "load-in-through-the-back": "Load-In",
    "local-news-2310": "Vermont Public",
    "local-news-a7bd": "VPR Legacy",
    "marketwatch-com-top-stories": "MarketWatch",
    "nba": "r/NBA",
    "nbc-news-top-stories": "NBC News",
    "net-zero-energy-burlington-vt": "Net Zero Energy",
    "news": "NPR",
    "pbs-newshour-headlines": "PBS NewsHour",
    "phys-org-latest-science-and-technology-news-stories": "Phys.org",
    "politico-top-stories": "Politico",
    "rocket-shop-radio-hour": "Rocket Shop",
    "science": "r/Science",
    "scientific-american-content-global": "Scientific American",
    "scientific-american-podcast-60-second-science": "60-Second Science",
    "technology": "r/Technology",
    "the-frequency-daily-vermont-news": "The Frequency",
    "the-hill-technology-policy": "The Hill",
    "the-other-paper-south-burlington": "The Other Paper",
    "top-news-analysis": "CNBC",
    "united-in-green-vermont-green-podcast": "United in Green",
    "university-of-vermont-athletics": "UVM Athletics",
    "vermont-business-magazine": "Vermont Biz",
    "vermont-this-week-delve-into-the-most-important-news-stories-each-week": "Vermont This Week",
    "world-news": "r/WorldNews",
    "world-news-the-guardian": "The Guardian",
    "wsj-world-news": "WSJ World",
    "802-news-with-mark-johnson": "802 News",
}


def shorten(name):
    """Generic chip name: drop separator tails, parentheticals, and .com."""
    short = re.sub(r"\s*\([^)]*\)", "", name or "")
    head = re.split(r"\s+[-–—|»:·]\s+|\s+--\s+", short)[0]
    if len(head) >= 3:
        short = head
    short = re.sub(r"\.com\b", "", short, flags=re.I)
    return trim(clean_space(short), 22)


# ----------------------------------------------------------------------
# Small text, time, and file helpers
# ----------------------------------------------------------------------

def utcnow():
    return datetime.now(timezone.utc)


def clean_space(value):
    return re.sub(r"\s+", " ", value or "").strip()


def strip_html(value):
    value = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", value or "")
    return clean_space(html.unescape(re.sub(r"(?s)<[^>]+>", " ", value)))


def trim(value, limit):
    value = clean_space(value)
    if len(value) <= limit:
        return value
    cut = value[:limit - 1].rsplit(" ", 1)[0] or value[:limit - 1]
    return cut.rstrip(" ,.;:-") + "…"


def parse_time(value):
    """RFC-822 (RSS) or ISO-8601 (Atom) → aware datetime, else None."""
    value = clean_space(value)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return None
    if parsed and parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def canon_url(url):
    """Drop fragments and tracking params so dedupe survives repost noise."""
    url = clean_space(url)
    if not url:
        return ""
    parts = urllib.parse.urlsplit(url)

    def is_tracking(pair):
        key = pair.split("=", 1)[0].lower()
        return key in TRACKING_PARAMS or key.startswith("utm_")

    query = "&".join(pair for pair in parts.query.split("&")
                     if pair and not is_tracking(pair))
    return urllib.parse.urlunsplit(
        (parts.scheme, parts.netloc, parts.path, query, ""))


def dedupe_key(url):
    """URL identity for dedupe ONLY — stored URLs stay exactly as published.

    Collapses the differences publishers reshuffle between fetches: scheme,
    host case, www., a trailing slash, and percent-escape case (Salon serves
    %E2 and %e2 for the same story on different days).
    """
    parts = urllib.parse.urlsplit(url)
    host = parts.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    upper_escapes = lambda text: re.sub(  # noqa: E731 — tiny, local
        r"%[0-9a-fA-F]{2}", lambda m: m.group(0).upper(), text)
    path = upper_escapes(parts.path).rstrip("/") or "/"
    query = upper_escapes(parts.query)
    return host + path + ("?" + query if query else "")


def norm_site(url):
    """Normalize a site URL for identity matching: scheme/www/slash noise off."""
    url = clean_space(url).lower()
    url = re.sub(r"^https?://", "", url)
    url = re.sub(r"^www\.", "", url)
    return url.rstrip("/")


def site_host(url):
    host = urllib.parse.urlsplit(clean_space(url)).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def topic_keys(url):
    """Lookup keys for pulse-topics.json: 'host/first/path/bits' then 'host'."""
    parts = urllib.parse.urlsplit(clean_space(url).lower())
    host = parts.netloc[4:] if parts.netloc.startswith("www.") else parts.netloc
    path = parts.path.strip("/")
    keys = []
    if path:
        keys.append(host + "/" + "/".join(path.split("/")[:2]))
    keys.append(host)
    return keys


def slugify(value):
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return slug or "source"


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as src:
            return json.load(src)
    except (OSError, ValueError):
        return default


def write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as dst:
        json.dump(value, dst, separators=(",", ":"), ensure_ascii=False)
        dst.write("\n")


# ----------------------------------------------------------------------
# Fetching — bounded, retried, and loud about what failed
# ----------------------------------------------------------------------

def fetch_bytes(url, tries=3, timeout=30):
    last = None
    for attempt in range(tries):
        try:
            request = urllib.request.Request(url, headers={
                "User-Agent": UA, "Accept": "application/xml,text/xml,*/*"})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except Exception as exc:  # noqa: BLE001 — retry everything, report last
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"fetch failed after {tries} tries: {url} ({last})")


def folder_opml_url(label):
    return (f"{INO}/reader/subscriptions/export/user/{USER}/label/"
            + urllib.parse.quote(label))


def folder_stream_url(label, count):
    return (f"{INO}/stream/user/{USER}/tag/"
            + urllib.parse.quote(label) + f"?n={count}")


# ----------------------------------------------------------------------
# Parsing — OPML roster, Inoreader stream, and (for --seed) raw feeds
# ----------------------------------------------------------------------

def parse_opml(raw):
    """OPML export → [{title, xml, html}] in folder order."""
    out = []
    for node in ET.fromstring(raw).iter("outline"):
        if node.get("type") != "rss":
            continue
        out.append({
            "title": clean_space(node.get("title") or node.get("text")),
            "xml": clean_space(node.get("xmlUrl")),
            "html": clean_space(node.get("htmlUrl")),
        })
    return out


def first_text(node, *tags):
    for tag in tags:
        found = node.find(tag)
        if found is not None:
            value = found.text or found.get("href") or ""
            if clean_space(value):
                return clean_space(value)
    return ""


def item_audio(node):
    candidates = []
    enclosure = node.find("enclosure")
    if enclosure is not None and (enclosure.get("type") or "").startswith("audio"):
        candidates.append(enclosure.get("url"))
    for link in node.findall("{http://www.w3.org/2005/Atom}link"):
        if (link.get("type") or "").startswith("audio"):
            candidates.append(link.get("href"))
    for url in candidates:  # a typed element with no URL must not end the search
        url = clean_space(url)
        if url:
            return url
    return ""


MEDIA = "{http://search.yahoo.com/mrss/}"


def item_image(node):
    """One thumbnail URL per item, straight from the publisher.

    Never rehosted: the page hotlinks with referrerpolicy=no-referrer and
    collapses the slot on error, so an expired CDN URL costs nothing.
    """
    candidates = []
    enclosure = node.find("enclosure")
    if enclosure is not None and (enclosure.get("type") or "").startswith("image"):
        candidates.append(enclosure.get("url"))
    for media in node.findall(MEDIA + "content") + node.findall(MEDIA + "thumbnail"):
        kind = media.get("type") or ""
        medium = media.get("medium") or ""
        if (kind.startswith("image") or medium == "image"
                or (not kind and media.tag.endswith("thumbnail"))):
            candidates.append(media.get("url"))
    for url in candidates:
        url = clean_space(url)
        if url:
            return url
    return ""


def parse_stream(raw):
    """Inoreader folder RSS → items tagged with their origin feed.

    Every <item> carries <source url="htmlUrl">Feed Title</source>, which is
    what lets one aggregated stream be regrouped per source.
    """
    items = []
    for node in ET.fromstring(raw).iter("item"):
        source = node.find("source")
        items.append({
            "title": trim(strip_html(first_text(node, "title")), TITLE_MAX),
            "url": canon_url(first_text(node, "link")),
            "when": parse_time(first_text(node, "pubDate")),
            "audio": item_audio(node),
            "image": item_image(node),
            "src_title": clean_space(source.text if source is not None else ""),
            "src_site": clean_space(source.get("url") if source is not None else ""),
        })
    return items


ATOM = "{http://www.w3.org/2005/Atom}"


def parse_feed(raw):
    """A single feed (RSS2 or Atom) → bare items. Used only by --seed."""
    root = ET.fromstring(raw)
    items = []
    for node in root.iter("item"):  # RSS 2.0
        items.append({
            "title": trim(strip_html(first_text(node, "title")), TITLE_MAX),
            "url": canon_url(first_text(node, "link")),
            "when": parse_time(first_text(
                node, "pubDate", "{http://purl.org/dc/elements/1.1/}date")),
            "audio": item_audio(node),
            "image": item_image(node),
        })
    for node in root.iter(ATOM + "entry"):  # Atom
        link = ""
        for candidate in node.findall(ATOM + "link"):
            if candidate.get("rel") in (None, "alternate"):
                link = candidate.get("href") or ""
                break
        items.append({
            "title": trim(strip_html(first_text(node, ATOM + "title")), TITLE_MAX),
            "url": canon_url(link),
            "when": parse_time(first_text(
                node, ATOM + "published", ATOM + "updated")),
            "audio": item_audio(node),
            "image": item_image(node),
        })
    return items


# ----------------------------------------------------------------------
# Roster
# ----------------------------------------------------------------------

def build_roster(folder_outlines, topics):
    """OPML outlines (+local flag) → source registry.

    Identity is (title, site): Inoreader folders can hold literal duplicate
    subscriptions (two "The Charlotte News" rows today) — those collapse to
    one source. Distinct sources that SHARE a title (two "Local News" feeds)
    get a feed-URL hash suffix instead of an ordinal, so the id survives
    OPML reordering — ordinals would swap ids and silently remap users'
    hidden-source settings and the SHORT_NAMES table.
    """
    entries, seen = [], set()
    for outline, is_local in folder_outlines:
        key = (outline["title"].lower(), norm_site(outline["html"] or outline["xml"]))
        if key in seen:
            continue
        seen.add(key)
        entries.append((outline, is_local))
    title_counts = Counter(slugify(outline["title"]) for outline, _ in entries)

    sources, used_ids = [], set()
    for outline, is_local in entries:
        base = slugify(outline["title"])
        if title_counts[base] > 1:
            suffix = hashlib.md5((outline["xml"] or "").encode()).hexdigest()[:4]
            source_id = f"{base}-{suffix}"
        else:
            source_id = base
        bump = 2
        while source_id in used_ids:   # freak hash collision backstop
            source_id = f"{base}-{bump}"
            bump += 1
        used_ids.add(source_id)
        site = outline["html"] or outline["xml"]
        topic = "local"
        if not is_local:
            topic = next((topics[k] for k in topic_keys(site) if k in topics),
                         "news")
        podcast = (
            any(h in (outline["xml"] or "") for h in PODCAST_HOSTS)
            or "podcast" in outline["title"].lower()
            or (is_local and "youtube.com" in (outline["xml"] or "")))
        sources.append({
            "id": source_id,
            "name": outline["title"],
            "site": site,
            "feed": outline["xml"],
            "topic": topic,
            "local": is_local,
            "podcast": podcast,
        })
    return sources


def source_index(sources):
    """Lookup tables for attributing stream items back to a source."""
    by_site, by_title = {}, {}
    for source in sources:
        by_site.setdefault(norm_site(source["site"]), source["id"])
        by_site.setdefault(norm_site(source["feed"]), source["id"])
        by_title.setdefault(source["name"].lower(), source["id"])
    return by_site, by_title


def attribute(item, by_site, by_title):
    for key in (norm_site(item.get("src_site", "")),):
        if key and key in by_site:
            return by_site[key]
    title = item.get("src_title", "").lower()
    return by_title.get(title)


# ----------------------------------------------------------------------
# Merge — union per source by URL, newest first, capped
# ----------------------------------------------------------------------

def merge_source(previous, incoming, now_ts):
    """Previous payload items + fresh items → (capped newest-first list,
    count of genuinely new stories) — the count feeds the staleness guard."""
    by_key, added = {}, 0
    for item in previous:
        if item.get("u"):
            by_key[dedupe_key(item["u"])] = dict(item)
    for item in incoming:
        if not item["url"] or not item["title"] or item["when"] is None:
            continue
        ts = int(item["when"].timestamp())
        if ts > now_ts + 3600:  # feeds occasionally post-date; don't sort lies up top
            ts = now_ts
        fresh = {"t": item["title"], "u": item["url"], "d": ts}
        if item.get("audio"):
            fresh["a"] = item["audio"]
        if item.get("image"):
            fresh["i"] = item["image"]
        key = dedupe_key(item["url"])
        held = by_key.get(key)
        if held is None:
            by_key[key] = fresh
            added += 1
        else:
            # Same story seen again: take the freshest headline text and any
            # media that showed up, but keep the EARLIEST timestamp — feeds
            # that re-stamp pubDate on edits would otherwise yo-yo to the top.
            held["t"] = fresh["t"]
            held["d"] = min(held.get("d", ts), ts)
            for field in ("a", "i"):
                if fresh.get(field):
                    held[field] = fresh[field]
    merged = sorted(by_key.values(), key=lambda entry: entry.get("d", 0),
                    reverse=True)
    return merged[:ITEM_CAP], added


def build_payload(sources, per_source, generated):
    out_sources, out_items = [], []
    seen_urls = set()
    for source in sources:
        items = []
        for item in per_source.get(source["id"], []):
            # One URL, one headline, site-wide. Duplicate subscriptions and
            # syndicated wire copies (ESPN main vs ESPN NFL, the legacy VPR
            # feed shadowing Vermont Public) collapse to whichever source
            # comes first in folder order.
            key = dedupe_key(item["u"])
            if key in seen_urls:
                continue
            seen_urls.add(key)
            items.append(item)
        podcast = source["podcast"] or any(item.get("a") for item in items)
        entry = {
            "id": source["id"], "name": source["name"],
            "short": SHORT_NAMES.get(source["id"]) or shorten(source["name"]),
            "site": source["site"], "topic": source["topic"], "n": len(items),
        }
        if source["local"]:
            entry["local"] = 1
        if podcast:
            entry["pod"] = 1
        out_sources.append(entry)
        for item in items:
            out_items.append(dict(item, s=source["id"]))
    out_items.sort(key=lambda entry: entry.get("d", 0), reverse=True)
    return {
        "v": 1,
        "generated": generated.replace(microsecond=0).isoformat(),
        "sources": out_sources,
        "items": out_items,
    }


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------

def run(args):
    topics = load_json(TOPICS_FILE, {})
    topics.pop("_comment", None)
    if not topics:
        sys.exit("data/pulse-topics.json missing or empty — refusing to run")

    folder_outlines = []
    for label, is_local in FOLDERS:
        outlines = parse_opml(fetch_bytes(folder_opml_url(label)))
        if not outlines:
            sys.exit(f"OPML for folder {label!r} came back empty")
        folder_outlines.extend((outline, is_local) for outline in outlines)
    sources = build_roster(folder_outlines, topics)
    if len(sources) < MIN_SOURCES:
        sys.exit(f"roster has only {len(sources)} sources — refusing to run")

    previous = load_json(args.store or args.out, {})
    prev_by_source = {}
    for item in previous.get("items", []):
        prev_by_source.setdefault(item.get("s"), []).append(
            {k: item[k] for k in ("t", "u", "d", "a", "i") if k in item})

    by_site, by_title = source_index(sources)
    fresh_by_source = {}
    unmatched = 0
    for label, is_local in FOLDERS:
        count = SEED_STREAM_N if args.seed else STREAM_N[is_local]
        for item in parse_stream(fetch_bytes(folder_stream_url(label, count))):
            source_id = attribute(item, by_site, by_title)
            if source_id is None:
                unmatched += 1
                continue
            fresh_by_source.setdefault(source_id, []).append(item)

    matched = sum(len(items) for items in fresh_by_source.values())
    if unmatched > matched:
        # If most stream items can't be attributed, Inoreader changed its
        # output (or the OPML and streams disagree) — publishing would freeze
        # the feed while stamping it fresh. Fail loudly instead.
        sys.exit(f"{unmatched} stream items unattributed vs {matched} matched "
                 "— attribution looks broken, refusing to write")

    if args.seed:
        seed_direct(sources, fresh_by_source)

    now_ts = int(utcnow().timestamp())
    per_source, added_total = {}, 0
    for source in sources:
        merged, added = merge_source(
            prev_by_source.get(source["id"], []),
            fresh_by_source.get(source["id"], []), now_ts)
        per_source[source["id"]] = merged
        added_total += added

    prev_total = len(previous.get("items", []))
    if not args.seed and prev_total and added_total == 0:
        # Nothing new anywhere: don't write at all. The workflow then skips
        # its push, the branch keeps its honest `generated` stamp, and the
        # page's "updated Xm ago" reflects when content actually changed.
        print("pulse: no new items this run — leaving the last payload in place")
        return

    payload = build_payload(sources, per_source, utcnow())
    total = len(payload["items"])
    floor = max(MIN_ITEMS, prev_total // 2)
    if total < floor:
        sys.exit(f"payload shrank to {total} items (was {prev_total}) — refusing to write")

    write_json(args.out, payload)
    empty = sum(1 for source in payload["sources"] if source["n"] == 0)
    print(f"pulse: {len(payload['sources'])} sources, {total} items "
          f"({empty} sources empty, {unmatched} stream items unattributed) "
          f"-> {os.path.relpath(args.out, ROOT)}")
    if args.verbose:
        for source in payload["sources"]:
            print(f"  {source['n']:3}  {source['topic']:9} {source['name']}")


def seed_direct(sources, fresh_by_source):
    """--seed: fetch every source's own feed for history the streams lack.

    Run from a residential IP: Reddit and friends refuse cloud egress, which
    is fine — a failed feed just contributes nothing and the streams cover it.
    """
    def grab(source):
        try:
            return source["id"], parse_feed(fetch_bytes(source["feed"], tries=2,
                                                        timeout=25))
        except Exception as exc:  # noqa: BLE001 — seed is best-effort per feed
            print(f"  seed skip {source['name']}: {exc}", file=sys.stderr)
            return source["id"], []

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        for source_id, items in pool.map(grab, sources):
            fresh_by_source.setdefault(source_id, []).extend(items)


# ----------------------------------------------------------------------
# Selftest — pure functions only, no network
# ----------------------------------------------------------------------

STREAM_FIXTURE = b"""<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
<item><title>Big &amp; loud story</title>
<link>https://example.com/a?utm_source=x&amp;id=7</link>
<pubDate>Sun, 09 Aug 2026 12:00:00 +0000</pubDate>
<enclosure type="audio/mpeg" url="https://example.com/a.mp3"></enclosure>
<source url="https://example.com/">Example Wire</source></item>
<item><title>Pictured</title>
<link>https://example.com/b</link>
<pubDate>Sun, 09 Aug 2026 11:00:00 +0000</pubDate>
<enclosure type="image/jpeg" url="https://example.com/b.jpg"></enclosure>
<source url="https://example.com/">Example Wire</source></item>
</channel></rss>"""


def selftest():
    assert canon_url("https://a.com/x?utm_source=b&v=1&fbclid=2#f") == "https://a.com/x?v=1"
    assert canon_url("https://www.youtube.com/watch?v=abc") == "https://www.youtube.com/watch?v=abc"
    # exact-match only: params that merely START with a tracking name survive
    assert canon_url("https://a.com/x?rssid=9&smid_x=1") == "https://a.com/x?rssid=9&smid_x=1"
    assert canon_url("https://a.com/x?rss=1") == "https://a.com/x"
    assert norm_site("https://www.Example.com/") == "example.com"
    assert topic_keys("https://www.reddit.com/r/science/") == ["reddit.com/r/science", "reddit.com"]
    assert slugify("ESPN.com - NBA") == "espn-com-nba"

    assert dedupe_key("https://airy.so/") == dedupe_key("http://www.airy.so")
    assert dedupe_key("https://a.com/x%e2%80%91y") == dedupe_key("https://a.com/x%E2%80%91y")
    assert dedupe_key("https://a.com/p?q=1") != dedupe_key("https://a.com/p?q=2")

    items = parse_stream(STREAM_FIXTURE)
    assert len(items) == 2
    assert items[0]["title"] == "Big & loud story"
    assert items[0]["url"] == "https://example.com/a?id=7"
    assert items[0]["audio"].endswith(".mp3")
    assert items[0]["src_title"] == "Example Wire"
    assert items[0]["image"] == ""
    assert items[1]["image"].endswith("b.jpg") and items[1]["audio"] == ""

    outlines = parse_opml(
        b'<opml><body><outline text="F"><outline title="A" text="A" type="rss"'
        b' xmlUrl="https://a.com/rss" htmlUrl="https://a.com/"/>'
        b'<outline title="A" text="A" type="rss" xmlUrl="https://a.com/rss2"'
        b' htmlUrl="https://a.com/"/></outline></body></opml>')
    roster = build_roster([(outline, False) for outline in outlines],
                          {"a.com": "tech"})
    assert len(roster) == 1 and roster[0]["topic"] == "tech"

    # distinct sources sharing a title: ids are feed-URL hashes, so they are
    # identical no matter what order the OPML lists them in
    twins = parse_opml(
        b'<opml><body><outline title="Local News" text="Local News" type="rss"'
        b' xmlUrl="https://a.com/rss" htmlUrl="https://a.com/"/>'
        b'<outline title="Local News" text="Local News" type="rss"'
        b' xmlUrl="https://b.com/rss" htmlUrl="https://b.com/"/></body></opml>')
    ids_fwd = {s["id"] for s in build_roster([(o, True) for o in twins], {})}
    ids_rev = {s["id"] for s in build_roster([(o, True) for o in reversed(twins)], {})}
    assert ids_fwd == ids_rev and len(ids_fwd) == 2
    assert all(len(i) > len("local-news") for i in ids_fwd)

    now_ts = 1_754_000_000
    older = [{"t": f"old {n}", "u": f"https://a.com/{n}", "d": 100 + n}
             for n in range(ITEM_CAP)]
    fresh = [{"title": "new", "url": "https://a.com/new", "audio": "",
              "when": datetime.fromtimestamp(now_ts, tz=timezone.utc)}]
    merged, added = merge_source(older, fresh, now_ts)
    assert len(merged) == ITEM_CAP and merged[0]["t"] == "new" and added == 1
    merged2, added2 = merge_source(merged, fresh, now_ts)
    assert added2 == 0 and merged2[0]["t"] == "new"

    payload = build_payload(
        [{"id": "a", "name": "A", "site": "https://a.com/", "topic": "tech",
          "local": False, "podcast": False},
         {"id": "b", "name": "B", "site": "https://b.com/", "topic": "news",
          "local": True, "podcast": False}],
        {"a": [{"t": "x", "u": "https://a.com/x", "d": 5, "a": "https://a.com/x.mp3"}],
         "b": [{"t": "x2", "u": "https://a.com/x", "d": 5}]},
        utcnow())
    assert payload["sources"][0]["pod"] == 1 and payload["items"][0]["s"] == "a"
    assert payload["sources"][1]["n"] == 0 and len(payload["items"]) == 1

    assert shorten("Latest Science News -- ScienceDaily") == "Latest Science News"
    assert shorten("The Other Paper (South Burlington)") == "The Other Paper"
    assert shorten("CNET News.com") == "CNET News"
    assert shorten("Vox -  All") == "Vox"
    print("selftest ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--seed", action="store_true",
                        help="also fetch each source's own feed (deep backfill)")
    parser.add_argument("--store", help="previous payload to merge (default: --out)")
    parser.add_argument("--out", default=OUT)
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    run(args)


if __name__ == "__main__":
    main()
