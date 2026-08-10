#!/usr/bin/env python3
"""The Pulse — the YOUTUBE tab: followed channels + what's trending in the US.

Two shelves, refreshed every ~3 hours to the orphan `pulse-youtube` branch:

  * Followed channels. The public Inoreader folder "YouTube" is the curation
    surface — subscribe to channels there and the tab follows next run, no
    code. (Folder absent or empty is fine; the shelf just stays empty.)
  * Trending. The YouTube Data API's mostPopular chart for the US, so the
    tab has something good even before any channels are followed.

Durations and view counts come from the API's videos endpoint. Without a
YOUTUBE_API_KEY the followed-channel shelf still publishes (no durations or
trending). Any network trouble logs and exits 0 so the workflow stays green
and the branch keeps its last good list.

CLI:
  --out PATH   where to write (default data/pulse-youtube.json)
  --selftest   run the offline checks and exit
"""

import argparse
import email.utils
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ElementTree
from datetime import datetime, timezone

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "data", "pulse-youtube.json")
UA = "btown-pulse-youtube/1.0"

STREAM_URL = ("https://www.inoreader.com/stream/user/1003590800/tag/"
              "YouTube?n=100")
API = "https://www.googleapis.com/youtube/v3"
WINDOW_DAYS = 7
MAX_CHANNEL_VIDEOS = 40
MAX_TRENDING = 15

VIDEO_ID_RE = re.compile(
    r"(?:v=|youtu\.be/|/shorts/|/embed/)([A-Za-z0-9_-]{11})")
DURATION_RE = re.compile(
    r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def utcnow():
    return datetime.now(timezone.utc)


def http_json(url, timeout=20):
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def video_id(url):
    match = VIDEO_ID_RE.search(url or "")
    return match.group(1) if match else None


def fmt_duration(iso):
    """PT1H2M3S -> 1:02:03, PT4M5S -> 4:05. Empty for unparseable/live."""
    match = DURATION_RE.fullmatch(iso or "")
    if not match or iso in ("PT0S", "P0D"):
        return ""
    hours, minutes, seconds = (int(part or 0) for part in match.groups())
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


# ----------------------------------------------------------------------
# Shelf one — the followed-channels folder
# ----------------------------------------------------------------------

def fetch_channel_videos(now_ts, url=STREAM_URL):
    """Inoreader folder stream -> [{id,t,ch,d}] newest first, ≤7 days."""
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
    if not raw.strip():
        return []
    root = ElementTree.fromstring(raw)
    videos, seen = [], set()
    for item in root.iter("item"):
        vid = video_id(item.findtext("link"))
        title = (item.findtext("title") or "").strip()
        if not vid or not title or vid in seen:
            continue
        source = item.find("source")
        channel = ((source.text if source is not None else None)
                   or item.findtext(
                       "{http://purl.org/dc/elements/1.1/}creator") or "")
        when = None
        pub = item.findtext("pubDate")
        if pub:
            try:
                when = int(email.utils.parsedate_to_datetime(pub).timestamp())
            except Exception:  # noqa: BLE001
                when = None
        if when is None or now_ts - when > WINDOW_DAYS * 86400:
            continue
        seen.add(vid)
        videos.append({"id": vid, "t": title[:200], "ch": channel.strip()[:60],
                       "d": when})
    videos.sort(key=lambda video: video["d"], reverse=True)
    return videos[:MAX_CHANNEL_VIDEOS]


# ----------------------------------------------------------------------
# Shelf two — the API: trending + durations/views for everything
# ----------------------------------------------------------------------

def api_videos(params, key):
    query = urllib.parse.urlencode(dict(params, key=key))
    return http_json(f"{API}/videos?{query}").get("items", [])


def fetch_trending(key):
    videos = []
    for item in api_videos({"part": "snippet,contentDetails,statistics",
                            "chart": "mostPopular", "regionCode": "US",
                            "maxResults": MAX_TRENDING}, key):
        snippet = item.get("snippet") or {}
        when = None
        published = snippet.get("publishedAt")
        if published:
            try:
                when = int(datetime.fromisoformat(
                    published.replace("Z", "+00:00")).timestamp())
            except ValueError:
                when = None
        videos.append({
            "id": item.get("id"),
            "t": (snippet.get("title") or "")[:200],
            "ch": (snippet.get("channelTitle") or "")[:60],
            "d": when,
            "dur": fmt_duration(
                (item.get("contentDetails") or {}).get("duration")),
            "views": int((item.get("statistics") or {}).get("viewCount") or 0),
            "trend": 1,
        })
    return [video for video in videos if video["id"] and video["t"]]


def enrich(videos, key):
    """Stamp durations and view counts onto the channel shelf, in place."""
    for start in range(0, len(videos), 50):
        batch = videos[start:start + 50]
        details = api_videos({"part": "contentDetails,statistics",
                              "id": ",".join(video["id"] for video in batch)},
                             key)
        by_id = {item.get("id"): item for item in details}
        for video in batch:
            item = by_id.get(video["id"])
            if not item:
                continue
            video["dur"] = fmt_duration(
                (item.get("contentDetails") or {}).get("duration"))
            video["views"] = int(
                (item.get("statistics") or {}).get("viewCount") or 0)


def build_payload(own, trending, generated):
    seen = {video["id"] for video in own}
    merged = own + [video for video in trending if video["id"] not in seen]
    return {
        "v": 1,
        "generated": generated.replace(microsecond=0).isoformat(),
        "videos": merged,
    }


def write_json(path, value):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as dst:
        json.dump(value, dst, separators=(",", ":"), ensure_ascii=False)
        dst.write("\n")


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------

def run(args):
    key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    now_ts = int(utcnow().timestamp())

    try:
        own = fetch_channel_videos(now_ts)
    except Exception as exc:  # noqa: BLE001 — folder may not exist yet
        print(f"refresh_youtube: channel folder unavailable ({exc})",
              file=sys.stderr)
        own = []

    trending = []
    if key:
        try:
            if own:
                enrich(own, key)
            trending = fetch_trending(key)
        except Exception as exc:  # noqa: BLE001 — quota/outage isn't a crash
            print(f"refresh_youtube: API trouble ({exc})", file=sys.stderr)

    if not own and not trending:
        print("refresh_youtube: nothing to publish this run")
        return

    write_json(args.out, build_payload(own, trending, utcnow()))
    print(f"refresh_youtube: {len(own)} followed + {len(trending)} trending "
          f"-> {args.out}")


# ----------------------------------------------------------------------
# Selftest — offline, no network
# ----------------------------------------------------------------------

RSS_FIXTURE = """<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
<item><title>How Vermont makes maple syrup</title>
  <link>https://www.youtube.com/watch?v=abcdefghijk</link>
  <source url="https://youtube.com">Practical Vermont</source>
  <pubDate>{fresh}</pubDate></item>
<item><title>Duplicate id is dropped</title>
  <link>https://youtu.be/abcdefghijk</link>
  <pubDate>{fresh}</pubDate></item>
<item><title>Too old to matter</title>
  <link>https://www.youtube.com/watch?v=stalestale1</link>
  <pubDate>{stale}</pubDate></item>
<item><title>Not a video link</title>
  <link>https://example.com/page</link>
  <pubDate>{fresh}</pubDate></item>
</channel></rss>"""


def selftest():
    assert video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert video_id("https://youtu.be/dQw4w9WgXcQ?t=1") == "dQw4w9WgXcQ"
    assert video_id("https://example.com/nope") is None
    assert fmt_duration("PT1H2M3S") == "1:02:03"
    assert fmt_duration("PT4M5S") == "4:05"
    assert fmt_duration("PT47S") == "0:47"
    assert fmt_duration("P0D") == ""
    assert fmt_duration(None) == ""
    print("refresh_youtube: helpers ok (ids, durations)")

    now_ts = int(utcnow().timestamp())
    fresh = email.utils.formatdate(now_ts - 3600)
    stale = email.utils.formatdate(now_ts - 30 * 86400)
    rss = RSS_FIXTURE.format(fresh=fresh, stale=stale)

    class FakeResponse:
        def __init__(self, body):
            self.body = body

        def read(self):
            return self.body

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    original = urllib.request.urlopen
    urllib.request.urlopen = lambda *a, **k: FakeResponse(rss.encode())
    try:
        videos = fetch_channel_videos(now_ts)
    finally:
        urllib.request.urlopen = original
    assert [video["id"] for video in videos] == ["abcdefghijk"]
    assert videos[0]["ch"] == "Practical Vermont"
    print("refresh_youtube: folder parse ok (dedupe, window, non-video links)")

    payload = build_payload(
        videos,
        [{"id": "abcdefghijk", "t": "dupe", "ch": "x", "d": now_ts,
          "dur": "1:00", "views": 5, "trend": 1},
         {"id": "trendtrend1", "t": "A trending thing", "ch": "Big",
          "d": now_ts, "dur": "10:00", "views": 1000000, "trend": 1}],
        utcnow())
    assert len(payload["videos"]) == 2      # trending dupe of a followed vid drops
    assert payload["videos"][-1]["trend"] == 1
    assert payload["v"] == 1 and "generated" in payload
    print("refresh_youtube: payload ok (merge, dedupe)")
    print("selftest ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=OUT)
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    run(args)


if __name__ == "__main__":
    main()
