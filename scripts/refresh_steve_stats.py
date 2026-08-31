#!/usr/bin/env python3
"""SteveWillDoIt giveaway stats for play.btownbrief.com/countach-countdown.

Same pattern as the Pulse shelves: runs in Actions with YOUTUBE_API_KEY,
writes JSON to an orphan data branch the page fetches off raw.githubusercontent.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

API = "https://www.googleapis.com/youtube/v3"
VIDEO_ID = "a_CdNYDSvWo"
MAIN_HANDLE = "SteveWillDoIt"
EXTRA_HANDLE = "SteveWillDoItExtra"
OUT = os.environ.get("OUT", os.path.join(os.path.dirname(__file__), "..", "data", "steve-stats.json"))


def get(endpoint, **params):
    params["key"] = os.environ["YOUTUBE_API_KEY"]
    url = f"{API}/{endpoint}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def channel_by_handle(handle):
    data = get("channels", part="statistics,contentDetails,snippet", forHandle=handle)
    items = data.get("items") or []
    if not items:
        return None
    c = items[0]
    return {
        "title": c["snippet"]["title"],
        "subs": int(c["statistics"].get("subscriberCount", 0)),
        "videos": int(c["statistics"].get("videoCount", 0)),
        "uploadsPlaylist": c["contentDetails"]["relatedPlaylists"]["uploads"],
    }


def main():
    video = get("videos", part="statistics,snippet", id=VIDEO_ID)["items"][0]
    main_ch = channel_by_handle(MAIN_HANDLE)
    extra_ch = channel_by_handle(EXTRA_HANDLE)

    uploads = []
    if main_ch:
        pl = get("playlistItems", part="snippet", playlistId=main_ch.pop("uploadsPlaylist"), maxResults=10)
        for it in pl.get("items", []):
            s = it["snippet"]
            uploads.append({
                "id": s["resourceId"]["videoId"],
                "title": s["title"],
                "publishedAt": s["publishedAt"],
            })
    if extra_ch:
        extra_ch.pop("uploadsPlaylist", None)

    out = {
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "video": {
            "id": VIDEO_ID,
            "title": video["snippet"]["title"],
            "publishedAt": video["snippet"]["publishedAt"],
            "views": int(video["statistics"].get("viewCount", 0)),
            "likes": int(video["statistics"].get("likeCount", 0)),
            "comments": int(video["statistics"].get("commentCount", 0)),
        },
        "channels": {"main": main_ch, "extra": extra_ch},
        "uploads": uploads,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
    print(f"wrote stats: {out['video']['views']:,} views / {out['video']['likes']:,} likes")


if __name__ == "__main__":
    if not os.environ.get("YOUTUBE_API_KEY"):
        sys.exit("YOUTUBE_API_KEY not set")
    main()
