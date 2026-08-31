#!/usr/bin/env python3
"""Build all-day/data/instagram.json — the Instagram tab's payload.

The tab has two halves and this builds both.

  DO   — organisers. Burlington announces on Instagram and nowhere else, so a
         lot of what happens here is only visible to people who already follow
         the right accounts. Read newest-first, in order, no ranking.
  SEE  — the people who MAKE things about this place: the missed-connections
         page, the food reviewers, the DJs, the sunset shooters. Same feed
         discipline, different promise. You read DO to find out what to go do;
         you open SEE because you want to look at Burlington for a minute.

The segment is not the tier. Tier answers "how often do we pay to check this
account"; segment answers "which half of the tab does it belong to". A handle
has both, independently, and they are set by which array it sits in:
tier1/tier2 are DO, see1/see2 are SEE.

THREE FACTS ABOUT INSTAGRAM'S CDN SHAPE EVERYTHING HERE.

  1. Image URLs expire. The `oe` parameter is a hex epoch. Measured against a
     live payload on 2026-08-30 it sits 4.3-4.5 DAYS out, not the three days
     this file used to claim — and `carry_ok()` re-reads the real `oe` on
     every record rather than trusting any constant.

  2. The obvious image URL is enormous. The `image` field the newsletter's
     fetcher keeps is the full-size original — 1.29 MB for a single post,
     which is 30 MB for a screenful. The API actually returns FOURTEEN signed
     resolutions in image_versions2.candidates; the 320px one is 20 KB, the
     same picture 64x smaller. Editing the size out of the big URL does not
     work — `stp` is inside the signature and rewriting it returns 403. You
     have to pick the candidate.

  3. Because those URLs stay good for four days, a run does not have to
     re-fetch an account to keep showing it. THIS IS THE WHOLE REASON THE
     ROSTER CAN BE BIG. The old builder started from an empty list every
     morning, so the payload only ever held the handles that run happened to
     scrape — 26 accounts out of a rostered 79. Now each run carries forward
     yesterday's still-signed posts and layers today's scrape on top, so the
     payload holds roughly (tier1 + see1) plus several days of both rotating
     batches — three times the accounts for the same money.

Credits: one per handle per run, and only the handles actually fetched. Tier 1
every run; tier 2 on a rotation keyed to the day of the year.

Env: SCRAPECREATORS_API_KEY (or SCRAPE_CREATORS_API_KEY), or
     ~/.config/btownbrief/secrets.env.

Run: python3 scripts/build_instagram.py [--tier2-batch N] [--see2-batch N]
                                        [--dry-run] [--no-carry]
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
WANT_W = 480                  # candidate width to prefer for the grid

# One cap per segment, not one for the payload. A single global cap lets
# whichever half posts more often eat the other's slots, and the two halves
# are not competing for the same attention — you switch to SEE on purpose.
CAP = {"do": 240, "see": 260}

# How long a carried post may live is not a constant here: it is whatever its
# own signature says, read per URL by carry_ok(). The measured life is 4.3-4.5
# days. This is the only knob — refuse anything that close to expiring, so a
# reader who opens the tab late in the day still gets pictures.
CARRY_MARGIN_H = 8


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


def signature_expiry(url: str) -> int | None:
    """When Instagram's CDN stops serving this URL, as an epoch second.

    Every signed URL carries `oe`, a hex epoch. Reading it is better than
    assuming a lifetime: it is the CDN's own answer, per image, and it is what
    makes carrying posts forward safe rather than hopeful."""
    try:
        q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    except Exception:
        return None
    oe = (q.get("oe") or [None])[0]
    if not oe:
        return None
    try:
        return int(oe, 16)
    except ValueError:
        return None


def carry_ok(rec: dict, now: float, cutoff: float) -> bool:
    """Is a post from a previous payload still worth shipping?

    Four ways to fail: the record is malformed, the post itself aged out of
    the window, the signature is about to expire (a grid of 403s is worse
    than a shorter grid), or the signature cannot be READ at all.

    That last one fails CLOSED, which is the opposite of what a fresh post
    gets. A fresh URL was just handed to us and works; a carried one is a
    claim about the future, and a URL whose `oe` we cannot parse is a claim
    we cannot check. Every post in the live payload carries a parseable `oe`,
    so this costs nothing today and stops a signing-format change from
    quietly shipping a wall of expired images."""
    if not isinstance(rec, dict) or not rec.get("h"):
        return False
    img = rec.get("i")
    if not isinstance(img, str) or not img:
        return False
    ts = rec.get("ts")
    if not isinstance(ts, (int, float)) or ts < cutoff:
        return False
    exp = signature_expiry(img)
    if exp is None or exp - now < CARRY_MARGIN_H * 3600:
        return False
    return True


def load_roster() -> tuple[dict[str, list[str]], dict[str, str]]:
    """The four arrays, and the handle -> segment map they imply.

    tier1/tier2 are DO, see1/see2 are SEE. Keeping segment implicit in the
    array a handle sits in means there is no second list to drift out of sync
    — you move a handle between halves by moving the string."""
    doc = json.loads(ROSTER.read_text(encoding="utf-8"))
    arrays = {k: [h for h in (doc.get(k) or []) if isinstance(h, str) and h.strip()]
              for k in ("tier1", "tier2", "see1", "see2")}

    seen: dict[str, str] = {}
    dupes = []
    for key in ("tier1", "tier2", "see1", "see2"):
        for h in arrays[key]:
            if h in seen:
                dupes.append(f"{h} (in {seen[h]} and {key})")
                continue        # first placement wins, as the warning implies
            seen[h] = key
    if dupes:
        # A handle in two arrays is paid for twice and shows up twice. Say so
        # loudly, then keep the first placement so a typo cannot stop a build.
        log(f"WARNING: {len(dupes)} duplicate handle(s): {'; '.join(dupes[:6])}")

    segment = {h: ("see" if key.startswith("see") else "do")
               for h, key in seen.items()}
    return arrays, segment


def rotate(pool: list[str], batch: int) -> list[str]:
    """Today's slice of a rotating tier, advancing by `batch` a day."""
    n = max(0, batch)
    if not n or not pool:
        return []
    start = (dt.date.today().toordinal() * n) % len(pool)
    return [pool[(start + i) % len(pool)] for i in range(min(n, len(pool)))]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier2-batch", type=int, default=12,
                    help="how many rotating DO handles to refresh this run")
    ap.add_argument("--see2-batch", type=int, default=26,
                    help="how many rotating SEE handles to refresh this run")
    ap.add_argument("--no-carry", action="store_true",
                    help="ignore the previous payload; scrape-only, as the "
                         "builder behaved before carry-forward existed")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    key = api_key()
    if not key:
        log("no Scrape Creators key — set SCRAPECREATORS_API_KEY. Nothing written.")
        return 1

    arrays, segment = load_roster()
    today = (arrays["tier1"] + rotate(arrays["tier2"], args.tier2_batch)
             + arrays["see1"] + rotate(arrays["see2"], args.see2_batch))
    # Order the roster arrays, not a set: a handle listed twice was already
    # warned about in load_roster(), and paying for it twice helps nobody.
    handles, seen_h = [], set()
    for h in today:
        if h not in seen_h:
            seen_h.add(h)
            handles.append(h)

    log(f"roster: {len(arrays['tier1'])}+{len(arrays['tier2'])} DO, "
        f"{len(arrays['see1'])}+{len(arrays['see2'])} SEE; "
        f"fetching {len(handles)} this run = {len(handles)} credits")

    now = time.time()
    cutoff = now - KEEP_DAYS * 86400

    # Read the previous payload. Which of its posts we KEEP is decided after
    # the scrape, not before: a handle scheduled for today whose request fails
    # must keep yesterday's posts, or one API hiccup deletes the account from
    # the tab. Only a handle that actually answered gets its old posts
    # replaced.
    prev_posts = []
    if not args.no_carry and OUT.exists():
        try:
            prev = json.loads(OUT.read_text(encoding="utf-8"))
            got = prev.get("posts")
            prev_posts = got if isinstance(got, list) else []
        except Exception as e:
            log(f"could not read the previous payload ({str(e)[:60]}) — "
                f"building from this run alone")

    fresh, failed, answered = [], [], set()
    for h in handles:
        try:
            items = fetch_handle(h, key)
        except Exception as e:
            failed.append(f"{h}: {str(e)[:50]}")
            continue
        # It answered. Even an empty list is an answer — the account posted
        # nothing recent — so its stale posts are now genuinely stale.
        answered.add(h)
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
            fresh.append(rec)
            kept += 1
        time.sleep(0.4)

    carried = []
    for rec in prev_posts:
        # One malformed record must not cost every good one, so each is judged
        # on its own rather than inside a single try around the whole loop.
        if not isinstance(rec, dict):
            continue
        h = rec.get("h")
        if h in answered:
            continue            # today's fetch replaces it wholesale
        if h not in segment:
            continue            # dropped from the roster since that run
        if not carry_ok(rec, now, cutoff):
            continue
        carried.append(rec)

    if carried:
        held = {r["h"] for r in carried} & set(handles)
        log(f"carried {len(carried)} still-signed post(s) from "
            f"{len({r['h'] for r in carried})} account(s)"
            + (f", {len(held)} of them because today's fetch failed" if held else ""))

    if failed:
        log(f"{len(failed)} handle(s) failed: {'; '.join(failed[:5])}")
    if not fresh:
        # Carried posts alone are yesterday's file with a new timestamp on it.
        # Better to leave the good payload in place and let the next run try.
        log("no posts collected — refusing to overwrite a good payload")
        return 1

    # Stamp the segment on every record, carried ones included: a handle can
    # move from DO to SEE between runs and the payload must follow the roster,
    # not the copy of it that was current when the post was first seen.
    by_key = {}
    for rec in carried + fresh:
        rec["s"] = segment.get(rec["h"], "do")
        # A post URL identifies a post. The account URL does not — it is the
        # fallback for a post with no shortcode, and keying on it would fold
        # every shortcode-less post from that handle into one.
        u = rec.get("u") or ""
        by_key["u:" + u if "/p/" in u else f"t:{rec['h']}:{rec['ts']}"] = rec

    # Cap each half on its own, newest first, then interleave back into one
    # clock-ordered list. The tab filters by segment anyway; sorting the whole
    # thing keeps the payload readable and keeps "newest first" true of it.
    posts = []
    for seg_name, cap_n in CAP.items():
        half = sorted((r for r in by_key.values() if r["s"] == seg_name),
                      key=lambda r: -r["ts"])
        if len(half) > cap_n:
            log(f"{seg_name}: capped {len(half)} -> {cap_n}")
        posts.extend(half[:cap_n])
    posts.sort(key=lambda r: -r["ts"])

    counts = {s: sum(1 for r in posts if r["s"] == s) for s in CAP}
    accounts = {s: len({r["h"] for r in posts if r["s"] == s}) for s in CAP}

    out = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        # The tab shows this: these URLs stop working, and saying when is
        # better than showing a grid of broken frames. Measured at 4.3-4.5
        # days; the tab rounds down when it phrases the warning.
        "expires_hint_days": 4,
        # Accounts represented in THIS payload, not the whole roster — the tab
        # counts chips from it. Kept as plain strings; ig.js reads .length.
        "handles": sorted({p["h"] for p in posts}),
        "segments": {s: {"posts": counts[s], "accounts": accounts[s]} for s in CAP},
        "posts": posts,
    }
    if args.dry_run:
        log(f"dry run — DO {counts['do']} posts/{accounts['do']} accounts · "
            f"SEE {counts['see']} posts/{accounts['see']} accounts")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    log(f"wrote {OUT.relative_to(ROOT)}  "
        f"DO {counts['do']} posts/{accounts['do']} accounts · "
        f"SEE {counts['see']} posts/{accounts['see']} accounts · "
        f"{OUT.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
