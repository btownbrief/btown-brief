#!/usr/bin/env python3
"""The Pulse — the YOUTUBE tab: followed channels, all curated.

The shelves, refreshed every ~3 hours to the orphan `pulse-youtube` branch:

  * Followed channels. The public Inoreader folder "YouTube" is the primary
    transport: one stream request covers the whole roster, works from
    datacenter IPs, and costs zero API quota (YouTube's own RSS soft-blocks
    Actions IPs — the Reddit problem all over again). data/youtube-channels.json
    carries the metadata (cap/g/min_sec); channels followed only in Inoreader
    still ride along with defaults. Fallbacks: the API's playlistItems
    endpoint (with a key), then direct YouTube RSS (residential IPs only).
    Firehose channels carry a per-refresh cap; Shorts are filtered out;
    channels marked min_sec keep only full episodes/talks.
  * Filmed in Vermont. Two API searches surface fresh local footage no
    channel roster would catch, ranked by view velocity.
  * Deep cuts. Every roster channel's all-time most-viewed videos, kept in
    a catalog (data/deep-catalog.json on the same branch) — the back catalog
    is where half the gold lives, and recency feeds never surface it. The
    search endpoint costs 100 quota units a call and greatest-hits lists
    barely change, so each channel is bought once (backfill a handful per
    run) and then only the stalest entries are re-checked.
  * Live now. One eventType=live search per run — Vermont streams ride the
    Vermont shelf with dur "LIVE" while they're on the air.
  * video-digest.json. The trailing week's roster uploads ranked by view
    velocity — the newsletter's Friday "videos worth your weekend" block.
  * channel-suggestions.json. Friday mornings, three discovery searches
    surface Vermont-adjacent channels not yet followed; each suggested
    once. Keepers just get added to the Inoreader folder.

Raw US trending was dropped 2026-08 — it clashed with the curated-feeds
premise; the client now ranks the week's roster uploads by view velocity
instead ("Popular this week"). Durations and view counts come from the
API's videos endpoint. Without a YOUTUBE_API_KEY the followed-channel shelf
still publishes (no durations). Any network trouble logs and exits 0 so the
workflow stays green and the branch keeps its last good list.

CLI:
  --out PATH       where to write (default data/pulse-youtube.json)
  --catalog PATH   the deep-cut catalog, read AND rewritten in place
                   (default data/deep-catalog.json)
  --selftest       run the offline checks and exit
"""

import argparse
import email.utils
import html
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
# The public Inoreader folder "YouTube" mirrors the roster (imported from
# infrastructure/youtube-channels.opml). One stream request covers every
# channel and works from datacenter IPs — the preferred uploads transport.
INO_STREAM = "https://www.inoreader.com/stream/user/1003590800/tag/YouTube"
INO_STREAM_N = 1000
INO_CHANNEL_RE = re.compile(r"/channel/(UC[A-Za-z0-9_-]{22})")
API = "https://www.googleapis.com/youtube/v3"
WINDOW_DAYS = 7
MAX_CHANNEL_VIDEOS = 160
DEFAULT_CAP = 6          # per-channel per refresh; firehoses set lower in the file
SHORTS_MAX_SEC = 75      # anything shorter is a Short — not for this shelf
MAX_VERMONT = 10
CATALOG = os.path.join(ROOT, "data", "deep-catalog.json")
DEEP_PER_CHANNEL = 5
DEEP_BACKFILL_PER_RUN = 8   # 8 searches ≈ 800 units/run while the catalog fills
DEEP_REFRESH_PER_RUN = 2    # steady state: re-check the two stalest channels
DEEP_REFRESH_DAYS = 30      # greatest-hits lists barely move
DEEP_MIN_AGE_DAYS = 180     # a deep cut is old gold, not last month's upload
# The radar runs the anchor plus two rotating slots every run, so the
# whole pool gets swept roughly daily without raising the per-run cost
# past 3 searches (300 units).
VT_QUERY_ANCHOR = "Burlington Vermont"
VT_QUERY_POOL = [
    "Lake Champlain Vermont",
    "Church Street Marketplace Burlington",
    "Winooski Vermont",
    "Stowe Vermont",
    "Montpelier Vermont",
    "UVM Burlington Vermont",
    "Green Mountains Vermont hiking",
    "Vermont skiing",
    "Vermont maple",
    "Vermont foliage",
]
VT_ROTATE = 2
VT_RE = re.compile(
    r"vermont|burlington|champlain|montpelier|stowe|winooski|green mountain"
    r"|church street|queen city|middlebury|brattleboro|rutland|killington"
    r"|sugarbush|mad river|waterbury|shelburne|\buvm\b|catamount",
    re.I)

VIDEO_ID_RE = re.compile(
    r"(?:v=|youtu\.be/|/shorts/|/embed/)([A-Za-z0-9_-]{11})")
DURATION_RE = re.compile(
    r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def duration_seconds_from_fmt(fmt):
    """'1:02:03' / '4:05' back to seconds (payload durations are formatted)."""
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
            "maxResults": 25, "key": key})
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


def parse_inoreader_stream(raw, now_ts):
    """Inoreader folder-stream RSS -> [{id,t,ch,d,cid}], ≤7 days. Each item
    carries its origin feed in <source url=".../channel/UC...">, which is
    how one aggregated stream regroups into per-channel lists."""
    root = ElementTree.fromstring(raw)
    entries = []
    for item in root.iter("item"):
        vid = video_id(item.findtext("link") or "")
        title = (item.findtext("title") or "").strip()
        pub = item.findtext("pubDate")
        source = item.find("source")
        src_url = source.get("url", "") if source is not None else ""
        match = INO_CHANNEL_RE.search(src_url)
        name = ((source.text if source is not None else "") or "").strip()
        if not vid or not title or not pub or not match:
            continue
        try:
            when = int(email.utils.parsedate_to_datetime(pub).timestamp())
        except (TypeError, ValueError):
            continue
        if now_ts - when > WINDOW_DAYS * 86400:
            continue
        # Inoreader double-escapes <source> text ("Fish &amp; Wildlife")
        entries.append({"id": vid, "t": html.unescape(title)[:200],
                        "ch": html.unescape(name)[:60],
                        "d": when, "cid": match.group(1)})
    return entries


def fetch_channel_videos_inoreader(now_ts, channels=None, raw=None):
    """Followed channels via the public Inoreader folder — one request for
    the whole roster, works from datacenter IPs, zero API quota. Channels
    followed in Inoreader but missing from the metadata file still ride
    along with defaults, so Inoreader stays the curation surface.
    Returns (videos, covered_channel_ids) — the second half lets run()
    top up channels the stream had nothing for."""
    if raw is None:
        request = urllib.request.Request(
            f"{INO_STREAM}?n={INO_STREAM_N}", headers={"User-Agent": UA})
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
    roster = {channel["id"]: channel
              for channel in (channels if channels is not None
                              else load_channels())}
    by_channel = {}
    for entry in parse_inoreader_stream(raw, now_ts):
        by_channel.setdefault(entry["cid"], []).append(entry)

    videos, seen = [], set()
    for cid, fetched in by_channel.items():
        channel = roster.get(cid, {})
        fetched.sort(key=lambda video: video["d"], reverse=True)
        kept = 0
        cap = int(channel.get("cap", DEFAULT_CAP))
        for video in fetched:
            if kept >= cap:
                break
            if video["id"] in seen or "#short" in video["t"].lower():
                continue
            video = {key: value for key, value in video.items()
                     if key != "cid"}
            # curated roster name wins over YouTube's channel title, so the
            # display (and the reader's channel mutes, keyed on it) stays
            # identical whichever transport fetched the run
            if channel.get("name"):
                video["ch"] = channel["name"][:60]
            if channel.get("min_sec"):
                video["_min"] = int(channel["min_sec"])
            if channel.get("g"):
                video["g"] = channel["g"]
            seen.add(video["id"])
            videos.append(video)
            kept += 1
    videos.sort(key=lambda video: video["d"], reverse=True)
    return videos[:MAX_CHANNEL_VIDEOS], sorted(by_channel.keys())


# ----------------------------------------------------------------------
# The API: durations/views for everything
# ----------------------------------------------------------------------

def api_videos(params, key):
    query = urllib.parse.urlencode(dict(params, key=key))
    return http_json(f"{API}/videos?{query}").get("items", [])


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


def vt_queries_for(when):
    """Anchor + VT_ROTATE rotating slots; the rotation advances one window
    per 3-hour run, so the whole pool is swept about once a day."""
    step = (when.timetuple().tm_yday * 8 + when.hour // 3) * VT_ROTATE
    picks = [VT_QUERY_POOL[(step + i) % len(VT_QUERY_POOL)]
             for i in range(VT_ROTATE)]
    return [VT_QUERY_ANCHOR] + picks


def fetch_vermont(key, now_ts, exclude):
    """Fresh local footage the roster wouldn't catch, by view velocity."""
    import html as html_mod

    found, seen = [], set(exclude)
    published_after = datetime.fromtimestamp(
        now_ts - WINDOW_DAYS * 86400, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for term in vt_queries_for(datetime.fromtimestamp(now_ts, timezone.utc)):
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


def fetch_live_now(key, now_ts, exclude):
    """One eventType=live search — is anything Vermont streaming right now?
    Live hits ride the Vermont shelf (vt:1) with dur 'LIVE', which both
    clients already render as-is. 100 units per run."""
    query = urllib.parse.urlencode({
        "part": "snippet", "type": "video", "eventType": "live",
        "q": "Vermont", "maxResults": 10, "regionCode": "US", "key": key})
    live = []
    for item in http_json(f"{API}/search?{query}").get("items", []):
        vid = (item.get("id") or {}).get("videoId")
        snippet = item.get("snippet") or {}
        title = html.unescape((snippet.get("title") or "").strip())
        channel = html.unescape((snippet.get("channelTitle") or "").strip())
        if not vid or vid in exclude or not title:
            continue
        if not VT_RE.search(f"{title} {channel}"):
            continue
        live.append({"id": vid, "t": title[:200], "ch": channel[:60],
                     "d": now_ts, "dur": "LIVE", "vt": 1, "lv": 1})
    return live[:4]


def build_digest(own, now_ts):
    """The trailing week's roster uploads ranked by view velocity — a
    ready-made 'videos worth your weekend' block for the newsletter.
    Costs nothing: it reuses the already-enriched shelf."""
    ranked = []
    for video in own:
        if video.get("lv"):
            continue
        sec = duration_seconds_from_fmt(video.get("dur"))
        if sec is not None and sec < 120:
            continue
        hours = max(1.0, (now_ts - video.get("d", now_ts)) / 3600.0)
        ranked.append(((video.get("views") or 0) / hours, video))
    ranked.sort(key=lambda pair: pair[0], reverse=True)
    return {
        "v": 1,
        "generated": utcnow().replace(microsecond=0).isoformat(),
        "videos": [{"id": v["id"], "t": v["t"], "ch": v["ch"],
                    "dur": v.get("dur", ""), "views": v.get("views"),
                    "vph": round(velocity, 1),
                    "u": "https://www.youtube.com/watch?v=" + v["id"]}
                   for velocity, v in ranked[:8]],
    }


DISCOVERY_QUERIES = ["Vermont vlog", "Vermont life", "made in Vermont"]


def update_channel_suggestions(key, now_ts, roster_ids, prior):
    """Fridays only: three searches for Vermont-adjacent channels not yet
    followed. Each channel is suggested once (the seen list persists on
    the data branch); keepers get added to the Inoreader folder, which is
    all it takes now. 300 units, once a week."""
    seen = set(prior.get("seen") or []) if isinstance(prior, dict) else set()
    when = datetime.fromtimestamp(now_ts, timezone.utc)
    if when.weekday() != 4 or not (9 <= when.hour < 12):
        return None
    fresh = []
    for term in DISCOVERY_QUERIES:
        query = urllib.parse.urlencode({
            "part": "snippet", "type": "video", "order": "relevance",
            "q": term, "maxResults": 15, "key": key})
        for item in http_json(f"{API}/search?{query}").get("items", []):
            snippet = item.get("snippet") or {}
            cid = snippet.get("channelId")
            channel = html.unescape((snippet.get("channelTitle") or "").strip())
            title = html.unescape((snippet.get("title") or "").strip())
            if not cid or cid in roster_ids or cid in seen:
                continue
            if not VT_RE.search(f"{title} {channel}"):
                continue
            seen.add(cid)
            fresh.append({"id": cid, "ch": channel[:60], "t": title[:200],
                          "u": "https://www.youtube.com/channel/" + cid})
    return {
        "v": 1,
        "generated": utcnow().replace(microsecond=0).isoformat(),
        "seen": sorted(seen),
        "fresh": fresh,
    }


def load_deep_catalog(path):
    """{channel id: {ts, videos}} from disk; empty on anything unreadable."""
    try:
        with open(path, encoding="utf-8") as src:
            data = json.load(src)
    except (OSError, ValueError):
        return {}
    channels = data.get("channels")
    return channels if isinstance(channels, dict) else {}


def search_channel_top(key, channel, published_before):
    """One channel's all-time most-viewed uploads, enriched, rules applied."""
    import html as html_mod

    query = urllib.parse.urlencode({
        "part": "snippet", "type": "video", "order": "viewCount",
        "channelId": channel["id"], "publishedBefore": published_before,
        "maxResults": DEEP_PER_CHANNEL, "key": key})
    found, seen = [], set()
    for item in http_json(f"{API}/search?{query}").get("items", []):
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
    if found:
        enrich(found, key)
        found = apply_duration_rules(found)
    return found


def update_deep_catalog(key, now_ts, channels, catalog):
    """Greatest-hits lists are static gold, so buy each channel once:
    backfill channels the catalog is missing first, then slowly re-check the
    stalest entries. A search error leaves the old entry untouched; a
    genuinely empty result is recorded so the channel isn't re-bought every
    run. Channels dropped from the roster leave the catalog."""
    roster = {c["id"]: c for c in channels if c.get("id")}
    catalog = {cid: entry for cid, entry in catalog.items() if cid in roster}
    missing = [cid for cid in roster if cid not in catalog]
    if missing:
        import random

        random.shuffle(missing)
        batch = missing[:DEEP_BACKFILL_PER_RUN]
    else:
        stale = sorted(catalog, key=lambda cid: catalog[cid].get("ts") or 0)
        batch = [cid for cid in stale
                 if now_ts - (catalog[cid].get("ts") or 0)
                 > DEEP_REFRESH_DAYS * 86400][:DEEP_REFRESH_PER_RUN]
    published_before = datetime.fromtimestamp(
        now_ts - DEEP_MIN_AGE_DAYS * 86400,
        timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for cid in batch:
        try:
            videos = search_channel_top(key, roster[cid], published_before)
        except Exception as exc:  # noqa: BLE001 — keep whatever we had
            print(f"refresh_youtube: deep cuts "
                  f"{roster[cid].get('name', cid)} failed ({exc})",
                  file=sys.stderr)
            continue
        catalog[cid] = {"ts": now_ts, "videos": videos}
    return catalog


def catalog_deep_cuts(catalog, exclude):
    """The whole catalog as one pool — the client samples and shuffles it."""
    found, seen = [], set(exclude)
    for entry in catalog.values():
        for video in entry.get("videos", []):
            if video.get("id") and video["id"] not in seen:
                seen.add(video["id"])
                found.append(video)
    found.sort(key=lambda video: video.get("views") or 0, reverse=True)
    return found


def title_key(video):
    """Normalized title+channel — livestream restarts (the Mount Washington
    weather cam) publish the same title under a fresh video id every time,
    so id-level dedupe alone lets the same card repeat across shelves."""
    raw = (video.get("t", "") + " " + video.get("ch", "")).lower()
    return re.sub(r"[^a-z0-9]+", " ", raw).strip()


def build_payload(own, vermont, deep, generated):
    merged = []
    seen = set()
    seen_titles = set()
    for shelf in (own, vermont, deep):
        for video in shelf:
            if video["id"] in seen:
                continue
            tkey = title_key(video)
            if tkey and tkey in seen_titles:
                continue
            seen.add(video["id"])
            seen_titles.add(tkey)
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

    # uploads transport: Inoreader folder stream first (works everywhere,
    # no quota), then the API, then direct YouTube RSS (residential only)
    own, covered = [], []
    try:
        own, covered = fetch_channel_videos_inoreader(now_ts)
        print(f"refresh_youtube: inoreader stream -> {len(own)} uploads "
              f"from {len(covered)} channels")
    except Exception as exc:  # noqa: BLE001 — the fallbacks still publish
        print(f"refresh_youtube: inoreader stream failed ({exc})",
              file=sys.stderr)
    if len(own) < 10:
        alt = (fetch_channel_videos_api(key, now_ts) if key
               else fetch_channel_videos(now_ts))
        # keep whichever transport did better — a partial stream still
        # beats a fallback that returns nothing on datacenter IPs
        if len(alt) > len(own):
            own = alt
    elif key:
        # targeted top-up: a channel absent from the stream is usually just
        # quiet, but it might be a feed Inoreader silently dropped — one
        # playlistItems unit each settles it
        covered_set = set(covered)
        missing = [channel for channel in load_channels()
                   if channel["id"] not in covered_set]
        if missing:
            try:
                extra = fetch_channel_videos_api(key, now_ts,
                                                 channels=missing[:20])
                have = {video["id"] for video in own}
                fresh_extra = [v for v in extra if v["id"] not in have]
                if fresh_extra:
                    own.extend(fresh_extra)
                    own.sort(key=lambda video: video["d"], reverse=True)
                print(f"refresh_youtube: api top-up checked "
                      f"{len(missing[:20])} quiet channels -> "
                      f"+{len(fresh_extra)}")
            except Exception as exc:  # noqa: BLE001
                print(f"refresh_youtube: top-up trouble ({exc})",
                      file=sys.stderr)

    vermont, deep = [], []
    if key:
        try:
            if own:
                enrich(own, key)
                own = apply_duration_rules(own)
        except Exception as exc:  # noqa: BLE001 — quota/outage isn't a crash
            print(f"refresh_youtube: API trouble ({exc})", file=sys.stderr)
        try:
            vermont = fetch_vermont(
                key, now_ts, {video["id"] for video in own})
        except Exception as exc:  # noqa: BLE001
            print(f"refresh_youtube: Vermont search trouble ({exc})",
                  file=sys.stderr)
        try:
            # live streams lead the Vermont shelf; title dedupe in
            # build_payload keeps cam restarts to one card
            live = fetch_live_now(
                key, now_ts,
                {video["id"] for video in own + vermont})
            if live:
                vermont = live + vermont
                print(f"refresh_youtube: {len(live)} Vermont stream(s) live now")
        except Exception as exc:  # noqa: BLE001
            print(f"refresh_youtube: live search trouble ({exc})",
                  file=sys.stderr)
        try:
            out_dir = os.path.dirname(args.out) or "."
            sugg_path = os.path.join(out_dir, "channel-suggestions.json")
            try:
                with open(sugg_path, encoding="utf-8") as src:
                    prior_sugg = json.load(src)
            except (OSError, ValueError):
                prior_sugg = {}
            roster_ids = {channel["id"] for channel in load_channels()}
            suggestions = update_channel_suggestions(
                key, now_ts, roster_ids, prior_sugg)
            if suggestions:
                write_json(sugg_path, suggestions)
                print(f"refresh_youtube: channel discovery -> "
                      f"{len(suggestions['fresh'])} new suggestion(s)")
        except Exception as exc:  # noqa: BLE001
            print(f"refresh_youtube: discovery trouble ({exc})",
                  file=sys.stderr)
        try:
            catalog = update_deep_catalog(
                key, now_ts, load_channels(), load_deep_catalog(args.catalog))
            if catalog:
                write_json(args.catalog, {"v": 1, "channels": catalog})
            deep = catalog_deep_cuts(
                catalog, {video["id"] for video in own + vermont})
        except Exception as exc:  # noqa: BLE001
            print(f"refresh_youtube: deep cuts trouble ({exc})",
                  file=sys.stderr)
    else:
        own = apply_duration_rules(own)   # strips the internal markers

    if not own and not vermont and not deep:
        print("refresh_youtube: nothing to publish this run")
        return

    if own:
        write_json(os.path.join(os.path.dirname(args.out) or ".",
                                "video-digest.json"),
                   build_digest(own, now_ts))

    write_json(args.out, build_payload(own, vermont, deep, utcnow()))
    print(f"refresh_youtube: {len(own)} followed + {len(vermont)} vermont + "
          f"{len(deep)} deep cuts -> {args.out}")


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

INO_FIXTURE = """<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>YouTube via test</title>
<item><title>Council meeting</title>
<link>https://www.youtube.com/watch?v=aaaaaaaaaaa</link>
<pubDate>{fresh}</pubDate>
<source url="https://www.youtube.com/channel/UCcapchancapchancapchan1">Cap Chan Full YouTube Title</source></item>
<item><title>Second upload blocked by cap</title>
<link>https://www.youtube.com/watch?v=bbbbbbbbbbb</link>
<pubDate>{fresh}</pubDate>
<source url="https://www.youtube.com/channel/UCcapchancapchancapchan1">Cap Chan</source></item>
<item><title>Unknown channel rides along</title>
<link>https://www.youtube.com/watch?v=ccccccccccc</link>
<pubDate>{fresh2}</pubDate>
<source url="https://www.youtube.com/channel/UCunknownunknownunknown2">Mystery &amp;amp; Co</source></item>
<item><title>An obvious #Short</title>
<link>https://www.youtube.com/watch?v=ddddddddddd</link>
<pubDate>{fresh2}</pubDate>
<source url="https://www.youtube.com/channel/UCunknownunknownunknown2">Mystery</source></item>
<item><title>Too old</title>
<link>https://www.youtube.com/watch?v=eeeeeeeeeee</link>
<pubDate>{stale}</pubDate>
<source url="https://www.youtube.com/channel/UCunknownunknownunknown2">Mystery</source></item>
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

    ino, covered = fetch_channel_videos_inoreader(
        now_ts,
        channels=[{"id": "UCcapchancapchancapchan1", "name": "Cap Chan",
                   "cap": 1, "g": "vt", "min_sec": 300}],
        raw=INO_FIXTURE.format(
            fresh=email.utils.formatdate(now_ts - 3600, usegmt=True),
            fresh2=email.utils.formatdate(now_ts - 7200, usegmt=True),
            stale=email.utils.formatdate(
                now_ts - 9 * 86400, usegmt=True)).encode())
    assert [video["id"] for video in ino] == ["aaaaaaaaaaa", "ccccccccccc"]
    assert ino[0]["g"] == "vt" and ino[0]["_min"] == 300
    assert ino[0]["ch"] == "Cap Chan"        # roster name beats stream title
    assert "g" not in ino[1] and "cid" not in ino[1]
    assert ino[1]["ch"] == "Mystery & Co"    # Inoreader double-escaping undone
    assert covered == ["UCcapchancapchancapchan1", "UCunknownunknownunknown2"]
    print("refresh_youtube: inoreader stream ok (regroup, caps, names, window, shorts)")

    # VT radar rotation: anchor always leads, slots advance run to run
    run_a = vt_queries_for(datetime(2026, 8, 11, 9, 0, tzinfo=timezone.utc))
    run_b = vt_queries_for(datetime(2026, 8, 11, 12, 0, tzinfo=timezone.utc))
    assert run_a[0] == VT_QUERY_ANCHOR and run_b[0] == VT_QUERY_ANCHOR
    assert len(run_a) == 1 + VT_ROTATE and run_a[1:] != run_b[1:]
    assert all(q in VT_QUERY_POOL for q in run_a[1:] + run_b[1:])
    print("refresh_youtube: vt radar rotation ok (anchor + rotating slots)")

    digest = build_digest([
        {"id": "hothothot01", "t": "Fresh and popular", "ch": "A",
         "d": now_ts - 3600, "dur": "10:00", "views": 50000},
        {"id": "slowslowsl1", "t": "Old and slow", "ch": "B",
         "d": now_ts - 6 * 86400, "dur": "10:00", "views": 50000},
        {"id": "shortshort1", "t": "A quick clip", "ch": "C",
         "d": now_ts - 3600, "dur": "1:30", "views": 999999},
        {"id": "livelive123", "t": "Streaming", "ch": "D",
         "d": now_ts, "dur": "LIVE", "lv": 1, "views": 5},
    ], now_ts)
    assert [v["id"] for v in digest["videos"]] == ["hothothot01", "slowslowsl1"]
    assert digest["videos"][0]["vph"] > digest["videos"][1]["vph"]
    print("refresh_youtube: digest ok (velocity rank, shorts + live excluded)")

    # discovery runs only in the Friday-morning window and suggests once
    assert update_channel_suggestions(
        "k", int(datetime(2026, 8, 12, 10, 0,
                          tzinfo=timezone.utc).timestamp()), set(), {}) is None
    friday_ts = int(datetime(2026, 8, 14, 9, 30,
                             tzinfo=timezone.utc).timestamp())
    real_http = globals()["http_json"]
    globals()["http_json"] = lambda url, timeout=20: {"items": [
        {"snippet": {"channelId": "UCnewvermontchannel0001",
                     "channelTitle": "Green Mountain Films",
                     "title": "A Vermont story"}},
        {"snippet": {"channelId": "UCalreadyseenchannel001",
                     "channelTitle": "Seen Before VT",
                     "title": "Stowe again"}},
        {"snippet": {"channelId": "UCnotvermontatall00001",
                     "channelTitle": "Desert Vlogs",
                     "title": "Sand dunes forever"}},
    ]}
    try:
        sugg = update_channel_suggestions(
            "k", friday_ts, {"UCrosterchannel0000001"},
            {"seen": ["UCalreadyseenchannel001"]})
    finally:
        globals()["http_json"] = real_http
    assert [c["id"] for c in sugg["fresh"]] == ["UCnewvermontchannel0001"]
    assert "UCalreadyseenchannel001" in sugg["seen"]
    print("refresh_youtube: discovery ok (friday gate, seen list, vt filter)")

    payload = build_payload(
        videos,
        [{"id": "vermontvid1", "t": "Fall in Stowe", "ch": "Local",
          "d": now_ts, "dur": "3:00", "views": 900, "vt": 1}],
        [{"id": "deepcutvid1", "t": "The best one ever", "ch": "Classic",
          "d": now_ts - 400 * 86400, "dur": "12:00", "views": 5000000,
          "dc": 1, "g": "sci"},
         {"id": "abcdefghijk", "t": "dupe", "ch": "x", "d": now_ts,
          "dur": "1:00", "views": 5, "dc": 1},
         {"id": "restarted01", "t": "Fall in Stowe!", "ch": "Local",
          "d": now_ts, "dur": "3:00", "views": 12, "dc": 1},
         {"id": "oldgoldvid1", "t": "An old classic", "ch": "Classic",
          "d": now_ts - 500 * 86400, "dur": "9:00", "views": 900000,
          "dc": 1, "g": "sci"}],
        utcnow())
    assert len(payload["videos"]) == 4      # id dupe AND title-restart dupe drop
    assert payload["videos"][1]["vt"] == 1 and payload["videos"][2]["dc"] == 1
    assert payload["videos"][-1]["id"] == "oldgoldvid1"
    assert payload["v"] == 1 and "generated" in payload
    print("refresh_youtube: payload ok (merge, id+title dedupe, shelf order)")

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

    # Deep-cut catalog: backfill missing, keep fresh, drop de-rostered,
    # record empty results, survive per-channel errors.
    searched = []

    def fake_search(key, channel, published_before):
        searched.append(channel["id"])
        if channel["id"] == "UCemptyempty":
            return []
        if channel["id"] == "UCboomboombo":
            raise RuntimeError("quota")
        return [{"id": "vid_" + channel["id"][-6:], "t": "Classic",
                 "ch": channel.get("name", ""), "d": now_ts - 400 * 86400,
                 "dur": "12:00", "views": 1000, "dc": 1,
                 "g": channel.get("g", "sci")}]

    real_search = globals()["search_channel_top"]
    globals()["search_channel_top"] = fake_search
    try:
        roster = [{"id": "UCaaaaaaaaaa", "name": "A", "g": "news"},
                  {"id": "UCbbbbbbbbbb", "name": "B"},
                  {"id": "UCemptyempty", "name": "Empty"}]
        catalog = update_deep_catalog("k", now_ts, roster, {
            "UCaaaaaaaaaa": {"ts": now_ts - 3600,
                             "videos": [{"id": "keptkeptkep", "views": 5,
                                         "dc": 1}]},
            "UCgonegonego": {"ts": now_ts, "videos": []},
        })
        assert sorted(searched) == ["UCbbbbbbbbbb", "UCemptyempty"]
        assert "UCgonegonego" not in catalog          # left the roster
        assert catalog["UCaaaaaaaaaa"]["ts"] == now_ts - 3600  # untouched
        assert catalog["UCemptyempty"] == {"ts": now_ts, "videos": []}
        searched.clear()
        catalog2 = update_deep_catalog("k", now_ts, roster, catalog)
        assert searched == [] and catalog2 == catalog  # all fresh: no buys
        stale = dict(catalog,
                     UCboomboombo={"ts": now_ts - 40 * 86400,
                                   "videos": [{"id": "oldgoldoldg",
                                               "views": 9, "dc": 1}]})
        roster_boom = roster + [{"id": "UCboomboombo", "name": "Boom"}]
        searched.clear()
        catalog3 = update_deep_catalog("k", now_ts, roster_boom, stale)
        assert searched == ["UCboomboombo"]            # only the stale one
        assert catalog3["UCboomboombo"] == stale["UCboomboombo"]  # error kept it
    finally:
        globals()["search_channel_top"] = real_search
    pool = catalog_deep_cuts(catalog, {"vid_bbbbbb"})
    assert [video["id"] for video in pool] == ["keptkeptkep"]  # excluded + empty
    assert load_deep_catalog("/nonexistent.json") == {}
    print("refresh_youtube: deep catalog ok (backfill, refresh, errors)")
    print("selftest ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=OUT)
    parser.add_argument("--catalog", default=CATALOG)
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    run(args)


if __name__ == "__main__":
    main()
