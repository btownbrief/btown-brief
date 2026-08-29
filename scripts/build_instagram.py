#!/usr/bin/env python3
"""Build all-day/data/instagram.json — the Instagram tab's payload.

Burlington organisers announce on Instagram and nowhere else, so a lot of what
happens here is only visible to people who already follow the right accounts
and who get served those posts. This reads the accounts directly, newest
first, in order — no ranking, no engagement signal, no algorithm. That is the
whole point of the tab.

TWO FACTS ABOUT INSTAGRAM'S CDN SHAPE EVERYTHING HERE.

  1. Image URLs expire. The `oe` parameter is a hex epoch and it sits about
     THREE DAYS out. A weekly rebuild would ship a grid of broken images, so
     this has to run at least every other day. It is why the workflow is daily.

  2. The obvious image URL is enormous. The `image` field the newsletter's
     fetcher keeps is the full-size original — 1.29 MB for a single post,
     which is 30 MB for a screenful. The API actually returns FOURTEEN signed
     resolutions in image_versions2.candidates; the 320px one is 20 KB, the
     same picture 64x smaller. Editing the size out of the big URL does not
     work — `stp` is inside the signature and rewriting it returns 403. You
     have to pick the candidate.

Credits: one per handle per run. Tier 1 every run; tier 2 on a slower rotation
keyed to the day of the year, so the whole roster is covered without paying
for 75 handles a day.

Env: SCRAPECREATORS_API_KEY (or SCRAPE_CREATORS_API_KEY), or
     ~/.config/btownbrief/secrets.env.

Run: python3 scripts/build_instagram.py [--tier2-batch N] [--dry-run]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
ROSTER = ROOT / "data" / "instagram-handles.json"
OUT = ROOT / "all-day" / "data" / "instagram.json"
SECRETS = pathlib.Path.home() / ".config" / "btownbrief" / "secrets.env"

ENDPOINT = "https://api.scrapecreators.com/v2/instagram/user/posts"
POSTS_PER_HANDLE = 6          # newest few per account; the tab is a mixed feed
KEEP_DAYS = 21                # older than this is not "what is happening"
TOTAL_CAP = 240
WANT_W = 480                  # candidate width to prefer for the grid


def log(m: str) -> None:
    print(m, file=sys.stderr, flush=True)


def api_key() -> str | None:
    for var in ("SCRAPECREATORS_API_KEY", "SCRAPE_CREATORS_API_KEY"):
        v = os.environ.get(var)
        if v:
            return v.strip()
    if SECRETS.exists():
        for line in SECRETS.read_text().splitlines():
            m = re.match(r"\s*(SCRAPE_?CREATORS_API_KEY)\s*=\s*(.+)", line)
            if m:
                return m.group(2).strip().strip('"\'')
    return None


def fetch_handle(handle: str, key: str) -> list[dict]:
    url = ENDPOINT + "?" + urllib.parse.urlencode({"handle": handle})
    req = urllib.request.Request(url, headers={"x-api-key": key})
    with urllib.request.urlopen(req, timeout=45) as r:
        doc = json.load(r)
    items = doc.get("items")
    if not isinstance(items, list):
        for k in ("data", "posts", "results"):
            if isinstance(doc.get(k), list):
                items = doc[k]
                break
    return items or []


def pick_thumb(item: dict) -> tuple[str | None, int | None]:
    """The smallest candidate at or above WANT_W — a 20 KB picture instead of
    a 1.3 MB one. Falls back to whatever single URL is on offer."""
    cands = ((item.get("image_versions2") or {}).get("candidates")) or []
    sized = [c for c in cands if c.get("url") and c.get("width")]
    if sized:
        at_or_above = sorted((c for c in sized if c["width"] >= WANT_W),
                             key=lambda c: c["width"])
        chosen = at_or_above[0] if at_or_above else max(sized, key=lambda c: c["width"])
        return chosen["url"], chosen.get("width")
    for k in ("display_url", "thumbnail_url", "image"):
        if item.get(k):
            return item[k], None
    return None, None


def caption_of(item: dict) -> str:
    c = item.get("caption")
    if isinstance(c, dict):
        c = c.get("text")
    if not isinstance(c, str):
        c = item.get("edge_media_to_caption", {})
        try:
            c = c["edges"][0]["node"]["text"]
        except Exception:
            c = ""
    return " ".join((c or "").split())


def taken_at(item: dict) -> int | None:
    for k in ("taken_at", "taken_at_timestamp", "device_timestamp"):
        v = item.get(k)
        if isinstance(v, (int, float)) and v > 1_000_000_000:
            return int(v)
    return None


def code_of(item: dict) -> str | None:
    return item.get("code") or item.get("shortcode") or None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier2-batch", type=int, default=12,
                    help="how many tier-2 handles to refresh this run")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    key = api_key()
    if not key:
        log("no Scrape Creators key — set SCRAPECREATORS_API_KEY. Nothing written.")
        return 1

    doc = json.loads(ROSTER.read_text(encoding="utf-8"))
    tier1 = doc.get("tier1") or []
    tier2 = doc.get("tier2") or []

    # Rotate through tier 2 so the whole roster gets covered over a few days
    # without paying for 75 handles every morning.
    n = max(0, args.tier2_batch)
    if n and tier2:
        start = (dt.date.today().toordinal() * n) % len(tier2)
        rota = [tier2[(start + i) % len(tier2)] for i in range(min(n, len(tier2)))]
    else:
        rota = []
    handles = tier1 + rota
    log(f"roster: {len(tier1)} tier-1 + {len(rota)} tier-2 this run = {len(handles)} credits")

    cutoff = time.time() - KEEP_DAYS * 86400
    posts, failed = [], []
    for h in handles:
        try:
            items = fetch_handle(h, key)
        except Exception as e:
            failed.append(f"{h}: {str(e)[:50]}")
            continue
        kept = 0
        for it in items:
            if kept >= POSTS_PER_HANDLE:
                break
            ts = taken_at(it)
            if not ts or ts < cutoff:
                continue
            thumb, w = pick_thumb(it)
            if not thumb:
                continue
            code = code_of(it)
            rec = {
                "h": h,
                "ts": ts,
                "i": thumb,
                "u": f"https://www.instagram.com/p/{code}/" if code
                     else f"https://www.instagram.com/{h}/",
            }
            if w:
                rec["w"] = w
            cap = caption_of(it)
            if cap:
                rec["c"] = cap[:400]
            if it.get("media_type") == 2 or it.get("is_video"):
                rec["v"] = 1
            posts.append(rec)
            kept += 1
        time.sleep(0.4)

    if failed:
        log(f"{len(failed)} handle(s) failed: {'; '.join(failed[:5])}")
    if not posts:
        log("no posts collected — refusing to overwrite a good payload")
        return 1

    posts.sort(key=lambda p: -p["ts"])
    posts = posts[:TOTAL_CAP]

    out = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        # The tab shows this: these URLs stop working, and saying when is
        # better than showing a grid of broken frames.
        "expires_hint_days": 3,
        "handles": sorted({p["h"] for p in posts}),
        "posts": posts,
    }
    if args.dry_run:
        log(f"dry run — {len(posts)} posts from {len(out['handles'])} accounts")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    log(f"wrote {OUT.relative_to(ROOT)}  {len(posts)} posts · "
        f"{len(out['handles'])} accounts · {OUT.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
