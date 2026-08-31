#!/usr/bin/env python3
"""Build all-day/data/podcast.json — every episode of the Brief's own show.

WHY THIS EXISTS. The Listen tab could only ever show the newest episode,
because Spotify's SHOW embed is a player for the latest episode and not an
episode browser — verified at three heights, it renders the same one every
time. And there was no list to fall back on:

  * the show is not on Apple Podcasts (searched by show name and by host)
  * it is not on beehiiv (the publication has zero podcast shows)
  * the host's YouTube channel is DJ sets, not the archive
  * neither the embed payload nor the public show page carries an episode
    list — both were fetched and checked

So the archive is reachable one way only: Spotify's API, with credentials.

WITH CREDENTIALS (the good path)
    Create a free app at developer.spotify.com/dashboard, then set
    SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET (locally in
    ~/.config/btownbrief/secrets.env, or as repo secrets for the workflow).
    This then fetches every episode and rewrites the file. Nothing else to do.

WITHOUT THEM
    The file is hand-maintained and this script leaves it alone rather than
    overwriting it with nothing. Add an episode as:
        {"title": "...", "url": "https://open.spotify.com/episode/<id>",
         "date": "2026-06-02", "blurb": "..."}

Run: python3 scripts/build_podcast.py
"""

from __future__ import annotations

import base64
import json
import os
import pathlib
import re
import sys
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "all-day" / "data" / "podcast.json"
SECRETS = pathlib.Path.home() / ".config" / "btownbrief" / "secrets.env"

SHOW_ID = "6ejf0OFAyNTZNKDzFLWbKp"
MARKET = "US"


def log(m: str) -> None:
    print(m, file=sys.stderr, flush=True)


def creds() -> tuple[str, str] | None:
    cid = os.environ.get("SPOTIFY_CLIENT_ID")
    sec = os.environ.get("SPOTIFY_CLIENT_SECRET")
    if not (cid and sec) and SECRETS.exists():
        vals = {}
        for line in SECRETS.read_text().splitlines():
            m = re.match(r"\s*(SPOTIFY_CLIENT_(?:ID|SECRET))\s*=\s*(.+)", line)
            if m:
                vals[m.group(1)] = m.group(2).strip().strip('"\'')
        cid = cid or vals.get("SPOTIFY_CLIENT_ID")
        sec = sec or vals.get("SPOTIFY_CLIENT_SECRET")
    return (cid, sec) if cid and sec else None


def token(cid: str, sec: str) -> str:
    body = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode()
    auth = base64.b64encode(f"{cid}:{sec}".encode()).decode()
    req = urllib.request.Request(
        "https://accounts.spotify.com/api/token", data=body,
        headers={"Authorization": "Basic " + auth,
                 "Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)["access_token"]


def episodes(tok: str) -> list[dict]:
    out = []
    url = (f"https://api.spotify.com/v1/shows/{SHOW_ID}/episodes"
           f"?limit=50&market={MARKET}")
    while url:
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + tok})
        with urllib.request.urlopen(req, timeout=30) as r:
            page = json.load(r)
        for e in page.get("items") or []:
            if not e:
                continue
            imgs = e.get("images") or []
            art = None
            if imgs:
                art = min(imgs, key=lambda i: abs((i.get("width") or 0) - 300)).get("url")
            out.append({
                "id": e.get("id"),
                "title": (e.get("name") or "").strip(),
                "url": (e.get("external_urls") or {}).get("spotify"),
                "date": e.get("release_date"),
                "seconds": round((e.get("duration_ms") or 0) / 1000) or None,
                "blurb": (e.get("description") or "").strip()[:300] or None,
                "art": art,
            })
        url = page.get("next")
    return out


def main() -> int:
    c = creds()
    if not c:
        log("no Spotify credentials — leaving the hand-maintained list alone.")
        log("set SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET to fill it automatically.")
        return 0
    try:
        eps = episodes(token(*c))
    except Exception as e:
        log(f"Spotify fetch failed ({e}) — keeping the existing list.")
        return 0
    if not eps:
        log("Spotify returned no episodes — keeping the existing list.")
        return 0

    eps.sort(key=lambda e: (e.get("date") or ""), reverse=True)
    doc = {
        "_comment": ("Episodes of the Brief's own show. Written by "
                     "scripts/build_podcast.py when Spotify credentials are set; "
                     "hand-maintained otherwise."),
        "show": "Btown Arts Presents",
        "show_url": f"https://open.spotify.com/show/{SHOW_ID}",
        "source": "spotify-api",
        "episodes": eps,
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    log(f"wrote {OUT.relative_to(ROOT)} — {len(eps)} episodes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
