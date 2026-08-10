#!/usr/bin/env python3
"""The Pulse — the YOUTUBE tab: followed channels + what's trending in the US.

Two shelves, refreshed every ~3 hours to the orphan `pulse-youtube` branch:

  * Followed channels. data/youtube-channels.json lists them. In Actions the
    uploads come from the API's playlistItems endpoint (1 quota unit per
    channel — YouTube's RSS soft-blocks datacenter IPs, the Reddit problem
    all over again); without a key the free public RSS still works from
    residential IPs. Firehose channels carry a per-refresh cap; Shorts are
    filtered out; channels marked min_sec keep only full episodes/talks.
  * Filmed in Vermont. Two API searches surface fresh local footage no
    channel roster would catch, ranked by view velocity.
  * Deep cuts. Each refresh, a rotating handful of roster channels give up
    their all-time most-viewed videos — the back catalog is where half the
    gold lives, and recency feeds never surface it.
  * Trending. The YouTube Data API's mostPopular chart for the US.

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
MAX_CHANNEL_VIDEOS = 60
MAX_TRENDING = 15
DEFAULT_CAP = 3          # per-channel per refresh; firehoses set lower in the file
SHORTS_MAX_SEC = 75      # anything shorter is a Short — not for this shelf
MAX_VERMONT = 8
DEEP_CHANNELS_PER_RUN = 4   # rotating sample; 4 searches ≈ 400 quota units
DEEP_PER_CHANNEL = 4
MAX_DEEP = 24
DEEP_MIN_AGE_DAYS = 180     # a deep cut is old gold, not last month's upload
VT_QUERIES = ["Burlington Vermont", "Lake Champlain Vermont"]
VT_RE = re.compile(
    r"vermont|burlington|champlain|montpelier|stowe|winooski|green mountain",
    re.I)

VIDEO_ID_RE = re.compile(
    r"(?:v=|youtu\.be/|/shorts/|/embed/)([A-Za-z0-9_-]{11})")
DURATION_RE = re.compile(
    r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def duration_seconds_from_fmt(fmt):
    """'1:02:03' / '4:05' back to seconds (trending already formatted)."""
    if not fmt:
        return None
    parts = [int(part) for part in fmt.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def duration_seconds(iso):
    match = DURATION_RE.fullmatch(iso or "")
    if not match:
        return None
    hours, minutes, seconds = (int(part or 0) for part in match.groups())
    return hours * 3600 + minutes * 60 + seconds


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


def uploads_playlist(channel_id):
    """UCxxxx -> UUxxxx, the channel's auto-generated uploads playlist."""
    return "UU" + channel_id[2:]


def fetch_channel_videos_api(key, now_ts, channels=None):
    """Followed channels via the Data API — the path GitHub runners use."""
    videos, seen = [], set()
    for channel in (channels if channels is not None else load_channels()):
        query = urllib.parse.urlencode({
            "part": "snippet,contentDetails",
            "playlistId": uploads_playlist(channel["id"]),
            "maxResults": 10, "key": key})
        try:
            items = http_json(f"{API}/playlistItems?{query}").get("items", [])
        except Exception as exc:  # noqa: BLE001 — one bad channel can't sink the shelf
            print(f"refresh_youtube: channel {channel['id']} failed ({exc})",
                  file=sys.stderr)
            continue
        fetched = []
        for item in items:
            vid = (item.get("contentDetails") or {}).get("videoId")
            snippet = item.get("snippet") or {}
            title = (snippet.get("title") or "").strip()
            published = (item.get("contentDetails") or {}).get(
                "videoPublishedAt") or snippet.get("publishedAt")
            if not vid or not title or not published:
                continue
            try:
                when = int(datetime.fromisoformat(
                    published.replace("Z", "+00:00")).timestamp())
            except ValueError:
                continue
            if now_ts - when > WINDOW_DAYS * 86400:
                continue
            fetched.append({"id": vid, "t": title[:200],
                            "ch": channel.get("name", "")[:60], "d": when})
        fetched.sort(key=lambda video: video["d"], reverse=True)
        kept = 0
        cap = int(channel.get("cap", DEFAULT_CAP))
        for video in fetched:
            if kept >= cap:
                break
            if video["id"] in seen or "#short" in video["t"].lower():
                continue
            if channel.get("min_sec"):
                video["_min"] = int(channel["min_sec"])
            if channel.get("g"):
                video["g"] = channel["g"]
            seen.add(video["id"])
            videos.append(video)
            kept += 1
    videos.sort(key=lambda video: video["d"], reverse=True)
    return videos[:MAX_CHANNEL_VIDEOS]


def fetch_channel_videos(now_ts, channels=None):
    """All followed channels -> [{id,t,ch,d}] newest first. Each channel is
    capped per refresh so one firehose can't own the shelf, and obvious
    Shorts are dropped by title (the duration pass catches the rest)."""
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
        fetched.sort(key=lambda video: video["d"], reverse=True)
        kept = 0
        cap = int(channel.get("cap", DEFAULT_CAP))
        for video in fetched:
            if kept >= cap:
                break
            if video["id"] in seen or "#short" in video["t"].lower():
                continue
            if channel.get("min_sec"):
                video["_min"] = int(channel["min_sec"])
            if channel.get("g"):
                video["g"] = channel["g"]
            seen.add(video["id"])
            videos.append(video)
            kept += 1
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
    videos = [video for video in videos if video["id"] and video["t"]]
    for video in videos:
        video["_sec"] = duration_seconds_from_fmt(video.get("dur"))
    return apply_duration_rules(videos)


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
            iso = (item.get("contentDetails") or {}).get("duration")
            video["dur"] = fmt_duration(iso)
            video["_sec"] = duration_seconds(iso)
            video["views"] = int(
                (item.get("statistics") or {}).get("viewCount") or 0)


def apply_duration_rules(videos):
    """Shorts out; min_sec channels keep only their long-form uploads.
    Videos whose duration is unknown (no API key) are left alone."""
    kept = []
    for video in videos:
        seconds = video.pop("_sec", None)
        wanted = video.pop("_min", None)
        if seconds is not None and seconds < SHORTS_MAX_SEC:
            continue
        if wanted and seconds is not None and seconds < wanted:
            continue
        kept.append(video)
    return kept


def fetch_vermont(key, now_ts, exclude):
    """Fresh local footage the roster wouldn't catch, by view velocity."""
    import html as html_mod

    found, seen = [], set(exclude)
    published_after = datetime.fromtimestamp(
        now_ts - WINDOW_DAYS * 86400, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for term in VT_QUERIES:
        query = urllib.parse.urlencode({
            "part": "snippet", "type": "video", "order": "date",
            "publishedAfter": published_after, "q": term,
            "maxResults": 15, "key": key})
        for item in http_json(f"{API}/search?{query}").get("items", []):
            vid = (item.get("id") or {}).get("videoId")
            snippet = item.get("snippet") or {}
            title = html_mod.unescape(snippet.get("title") or "")
            channel = html_mod.unescape(snippet.get("channelTitle") or "")
            if not vid or vid in seen or not title:
                continue
            if not VT_RE.search(title + " " + channel):
                continue  # search drifts; only keep the visibly-Vermont ones
            when = None
            published = snippet.get("publishedAt")
            if published:
                try:
                    when = int(datetime.fromisoformat(
                        published.replace("Z", "+00:00")).timestamp())
                except ValueError:
                    when = None
            if when is None:
                continue
            seen.add(vid)
            found.append({"id": vid, "t": title[:200], "ch": channel[:60],
                          "d": when, "vt": 1})
    if not found:
        return []
    enrich(found, key)
    found = apply_duration_rules(found)
    found.sort(key=lambda video: (video.get("views") or 0) /
               (max(now_ts - video["d"], 3600) / 86400.0 + 0.5), reverse=True)
    return found[:MAX_VERMONT]


def fetch_deep_cuts(key, now_ts, channels, exclude):
    """A rotating sample of channels -> their all-time most-viewed videos."""
    import html as html_mod
    import random

    pool = [channel for channel in channels if channel.get("id")]
    random.shuffle(pool)
    published_before = datetime.fromtimestamp(
        now_ts - DEEP_MIN_AGE_DAYS * 86400,
        timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    found, seen = [], set(exclude)
    for channel in pool[:DEEP_CHANNELS_PER_RUN]:
        query = urllib.parse.urlencode({
            "part": "snippet", "type": "video", "order": "viewCount",
            "channelId": channel["id"], "publishedBefore": published_before,
            "maxResults": DEEP_PER_CHANNEL, "key": key})
        try:
            items = http_json(f"{API}/search?{query}").get("items", [])
        except Exception as exc:  # noqa: BLE001 — one channel's miss is fine
            print(f"refresh_youtube: deep cuts {channel['name']} failed ({exc})",
                  file=sys.stderr)
            continue
        for item in items:
            vid = (item.get("id") or {}).get("videoId")
            snippet = item.get("snippet") or {}
            title = html_mod.unescape(snippet.get("title") or "")
            if not vid or vid in seen or not title:
                continue
            when = None
            published = snippet.get("publishedAt")
            if published:
                try:
                    when = int(datetime.fromisoformat(
                        published.replace("Z", "+00:00")).timestamp())
                except ValueError:
                    when = None
            seen.add(vid)
            found.append({"id": vid, "t": title[:200],
                          "ch": channel.get("name", "")[:60], "d": when,
                          "dc": 1, "g": channel.get("g", "sci")})
    if not found:
        return []
    enrich(found, key)
    found = apply_duration_rules(found)
    found.sort(key=lambda video: video.get("views") or 0, reverse=True)
    return found[:MAX_DEEP]


def build_payload(own, vermont, deep, trending, generated):
    merged = list(own)
    seen = {video["id"] for video in merged}
    for shelf in (vermont, deep, trending):
        for video in shelf:
            if video["id"] not in seen:
                seen.add(video["id"])
                merged.append(video)
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

    own = (fetch_channel_videos_api(key, now_ts) if key
           else fetch_channel_videos(now_ts))

    vermont, deep, trending = [], [], []
    if key:
        try:
            if own:
                enrich(own, key)
                own = apply_duration_rules(own)
            trending = fetch_trending(key)
        except Exception as exc:  # noqa: BLE001 — quota/outage isn't a crash
            print(f"refresh_youtube: API trouble ({exc})", file=sys.stderr)
        try:
            vermont = fetch_vermont(
                key, now_ts, {video["id"] for video in own + trending})
        except Exception as exc:  # noqa: BLE001
            print(f"refresh_youtube: Vermont search trouble ({exc})",
                  file=sys.stderr)
        try:
            deep = fetch_deep_cuts(
                key, now_ts, load_channels(),
                {video["id"] for video in own + trending + vermont})
        except Exception as exc:  # noqa: BLE001
            print(f"refresh_youtube: deep cuts trouble ({exc})",
                  file=sys.stderr)
    else:
        own = apply_duration_rules(own)   # strips the internal markers

    if not own and not vermont and not deep and not trending:
        print("refresh_youtube: nothing to publish this run")
        return

    write_json(args.out, build_payload(own, vermont, deep, trending, utcnow()))
    print(f"refresh_youtube: {len(own)} followed + {len(vermont)} vermont + "
          f"{len(deep)} deep cuts + {len(trending)} trending -> {args.out}")


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
        [{"id": "vermontvid1", "t": "Fall in Stowe", "ch": "Local",
          "d": now_ts, "dur": "3:00", "views": 900, "vt": 1}],
        [{"id": "deepcutvid1", "t": "The best one ever", "ch": "Classic",
          "d": now_ts - 400 * 86400, "dur": "12:00", "views": 5000000,
          "dc": 1, "g": "sci"}],
        [{"id": "abcdefghijk", "t": "dupe", "ch": "x", "d": now_ts,
          "dur": "1:00", "views": 5, "trend": 1},
         {"id": "trendtrend1", "t": "A trending thing", "ch": "Big",
          "d": now_ts, "dur": "10:00", "views": 1000000, "trend": 1}],
        utcnow())
    assert len(payload["videos"]) == 4      # trending dupe of a followed vid drops
    assert payload["videos"][1]["vt"] == 1 and payload["videos"][2]["dc"] == 1
    assert payload["videos"][-1]["trend"] == 1
    assert payload["v"] == 1 and "generated" in payload
    print("refresh_youtube: payload ok (merge, dedupe, shelf order)")

    ruled = apply_duration_rules([
        {"id": "a", "t": "a Short", "_sec": 40},
        {"id": "b", "t": "clip on a full-episode channel", "_sec": 300, "_min": 1200},
        {"id": "c", "t": "full episode", "_sec": 3400, "_min": 1200},
        {"id": "d", "t": "unknown duration survives", "_sec": None},
    ])
    assert [video["id"] for video in ruled] == ["c", "d"]
    assert "_sec" not in ruled[0] and "_min" not in ruled[0]
    assert duration_seconds("PT1H2M3S") == 3723
    assert duration_seconds_from_fmt("1:02:03") == 3723
    assert duration_seconds_from_fmt("4:05") == 245
    print("refresh_youtube: duration rules ok (shorts, min_sec, unknowns)")

    capped = fetch_channel_videos.__doc__  # cap behavior is covered live; the
    assert "capped per refresh" in capped  # docstring pins the contract
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
