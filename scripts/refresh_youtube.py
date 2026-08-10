#!/usr/bin/env python3
"""The Pulse — the YOUTUBE tab: followed channels + what's trending in the US.

Two shelves, refreshed every ~3 hours to the orphan `pulse-youtube` branch:

  * Followed channels. data/youtube-channels.json lists them; each channel's
    own free public RSS feed (youtube.com/feeds/videos.xml) supplies the
    uploads, so following costs zero API quota. (File empty is fine; the
    shelf just stays empty.)
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

CHANNELS_FILE = os.path.join(ROOT, "data", "youtube-channels.json")
CHANNEL_RSS = "https://www.youtube.com/feeds/videos.xml?channel_id="
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
# Shelf one — the followed channels (their own free RSS, zero quota)
# ----------------------------------------------------------------------

ATOM = "{http://www.w3.org/2005/Atom}"
YT_NS = "{http://www.youtube.com/xml/schemas/2015}"


def load_channels(path=CHANNELS_FILE):
    try:
        with open(path, encoding="utf-8") as src:
            data = json.load(src)
    except (OSError, ValueError):
        return []
    return [channel for channel in data.get("channels", [])
            if isinstance(channel, dict) and channel.get("id")]


def parse_channel_feed(raw, now_ts, fallback_name=""):
    """One channel's Atom feed -> [{id,t,ch,d}], ≤7 days."""
    root = ElementTree.fromstring(raw)
    feed_author = root.findtext(f"{ATOM}author/{ATOM}name") or fallback_name
    videos = []
    for entry in root.iter(f"{ATOM}entry"):
        vid = entry.findtext(f"{YT_NS}videoId")
        title = (entry.findtext(f"{ATOM}title") or "").strip()
        published = entry.findtext(f"{ATOM}published")
        if not vid or not title or not published:
            continue
        try:
            when = int(datetime.fromisoformat(published).timestamp())
        except ValueError:
            continue
        if now_ts - when > WINDOW_DAYS * 86400:
            continue
        name = (entry.findtext(f"{ATOM}author/{ATOM}name") or feed_author)
        videos.append({"id": vid, "t": title[:200], "ch": name.strip()[:60],
                       "d": when})
    return videos


def fetch_channel_videos(now_ts, channels=None):
    """All followed channels -> [{id,t,ch,d}] newest first, capped."""
    videos, seen = [], set()
    for channel in (channels if channels is not None else load_channels()):
        try:
            request = urllib.request.Request(
                CHANNEL_RSS + urllib.parse.quote(channel["id"]),
                headers={"User-Agent": UA})
            with urllib.request.urlopen(request, timeout=15) as response:
                fetched = parse_channel_feed(
                    response.read(), now_ts, channel.get("name", ""))
        except Exception as exc:  # noqa: BLE001 — one bad channel can't sink the shelf
            print(f"refresh_youtube: channel {channel['id']} failed ({exc})",
                  file=sys.stderr)
            continue
        for video in fetched:
            if video["id"] not in seen:
                seen.add(video["id"])
                videos.append(video)
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

    own = fetch_channel_videos(now_ts)

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

ATOM_FIXTURE = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:yt="http://www.youtube.com/xml/schemas/2015">
<author><name>Practical Vermont</name></author>
<entry><yt:videoId>abcdefghijk</yt:videoId>
  <title>How Vermont makes maple syrup</title>
  <published>{fresh}</published></entry>
<entry><yt:videoId>abcdefghijk</yt:videoId>
  <title>Duplicate id is dropped</title>
  <published>{fresh}</published></entry>
<entry><yt:videoId>stalestale1</yt:videoId>
  <title>Too old to matter</title>
  <published>{stale}</published></entry>
<entry><title>No video id, skipped</title>
  <published>{fresh}</published></entry>
</feed>"""


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
    fresh = datetime.fromtimestamp(now_ts - 3600, timezone.utc).isoformat()
    stale = datetime.fromtimestamp(now_ts - 30 * 86400, timezone.utc).isoformat()
    atom = ATOM_FIXTURE.format(fresh=fresh, stale=stale)

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
    urllib.request.urlopen = lambda *a, **k: FakeResponse(atom.encode())
    try:
        videos = fetch_channel_videos(now_ts, channels=[{"id": "UCtest"}])
    finally:
        urllib.request.urlopen = original
    assert [video["id"] for video in videos] == ["abcdefghijk"]
    assert videos[0]["ch"] == "Practical Vermont"
    assert load_channels("/nonexistent.json") == []
    print("refresh_youtube: channel feed ok (dedupe, window, missing ids)")

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
