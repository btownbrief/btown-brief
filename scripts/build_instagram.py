#!/usr/bin/env python3
"""Build all-day/data/instagram.json — local Instagram, minus the algorithm.

Three places read this payload: the Wire's Photos view (every post, filtered
by the `category` chips), Food's "Their food" (by handle, plus `f`), and
Vintage's "New in" (by handle). The accounts come from one hand-curated
roster, data/instagram-handles.json, and nobody else's posts get in except
the tagged shelf (below).

EVERY ACCOUNT HAS A TIER AND A CATEGORY, and they answer different questions.

  tier      how often we PAY to check it. 1 = every run (the workflow runs
            twice a day), 2 = once a Burlington day, 3 = once a week, in a
            rotation that takes an even slice of the tier each day.
  category  what kind of picture it is, for the Photos chips: food, venue
            (bars, cafes, music venues: the vibe checks), events (posters
            and the accounts that post them), shop (vintage), pets, scenic
            (photographers and city accounts), other.

THE CREDIT BUDGET. Every request costs one Scrape Creators credit, whatever it
returns. MONTHLY_CREDIT_BUDGET is the ceiling, and the builder enforces it
pro rata: by the end of day d of a D-day month it may have spent at most
budget * d / D, counted in data/instagram-ledger.json (credits spent this
month, and when each account was last fetched). Tier 1 is served first, then
the tagged shelf, then tier 2, then tier 3, and whatever does not fit waits
for tomorrow. Credits are written to the ledger BEFORE the requests go out,
so a run that dies halfway has already counted them. In the workflow that is
two steps: `--reserve` writes the run's credits and its accounts into the
ledger and stops, the workflow pushes the ledger, and only then does
`--execute` fetch exactly what was reserved. A run that cannot push its
reservation spends nothing, so no later run can read a ledger that is
missing credits. A missing or unreadable ledger fails CLOSED: the run
assumes today's whole share is spent, fetches nothing, and writes a fresh
ledger so tomorrow starts normally.

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
     yesterday's still-signed posts and layers today's scrape on top. A
     tier 3 account fetched once a week therefore shows for about four days
     of every seven, for one credit.

  4. Reels carry a playable MP4 as well, and it lives a much shorter life.
     `video_versions` holds the signed candidates (on 2026-10-16 all three
     were the same 720p progressive file, about 65 KB a second); its `oe`
     sat 35 HOURS out, not four days. So a video post keeps its picture as
     the poster (`i`) and adds `vu` (the smallest candidate), `ve` (that
     URL's own expiry, read from its `oe`) and `vd` (seconds). A carried
     post whose video is about to lapse keeps its picture and loses only
     the video fields: it shows as a photo rather than a dead player.

FOOD. A post gets `f: 1` when its account's category is `food`, or when the
account carries `"food": true` (a bar, a brewery or a market that belongs on
the Food tab too). Food reads it.

KIND. Every post also carries `kind`, what the PICTURE is, for the Photos
chips: vibe (a room, a crowd, a night out), poster (a flyer for a dated
event), food, pets, scenic, other. The account's category is only the first
guess: a cat cafe's latte is food, not pets, and a restaurant's trivia flyer
is a poster, not food. So once a run, Claude Haiku 5.5 reads the account,
its category and the caption of every post that has no kind yet, in one
batched call, and says which kind each is and whether it is sure. The
posts it is not sure about (up to IMAGE_LOOK_MAX) get a second call that
shows it the 480px thumbnail itself. A kind is decided once per post and
carried with it, so a post is never paid for twice. Without a key, past
AI_MONTH_CAP_USD, or when a call fails, a post gets its category's kind
with `kd: 1` (defaulted) and is asked about again next run; an unsure post
whose picture could not be looked at this run ships the caption's guess,
also with `kd: 1`. The spend is
kept in the ledger's `ai` block; AI COST below has the measured numbers.

PERSISTENCE. Each category's cap is filled one post per account at a time
(every account's newest, then every account's second newest, ...), not
newest-first, so a weekly account's posts are not pushed out by an account
that posts daily. They still lapse when their signature does (about four
days), which is the one limit carrying cannot lift.

TAGGED is the one thing here that is not a roster. It is every post by anyone
that tags @btownbrief — the route onto the wall for a reader who is not an
account we follow. One credit per run (`/v1/instagram/user/tagged-posts`, by
numeric user id). That endpoint returns no `taken_at`, so the timestamp is
decoded from the post's `pk` — Instagram media ids are snowflakes (ms since
2011-08-24 in the high bits), and the decode checks out to within minutes
against posts that do carry `taken_at`. A handle listed in the roster file's
`tagged_block` array never lands, whatever it tags. A tagged post takes its
account's category when that account is rostered, else `other`.

Env: SCRAPECREATORS_API_KEY (or SCRAPE_CREATORS_API_KEY), or
     ~/.config/btownbrief/secrets.env.

Run: python3 scripts/build_instagram.py [--dry-run | --reserve | --execute]
                                        [--only h1,h2] [--no-carry] [--no-tagged]
                                        [--out PATH] [--ledger PATH]
     With no step flag it reserves and fetches in one go, and only for --only
     (a small local test): otherwise main's ledger would never see the credits.
     --dry-run prints what this run would fetch and what that costs. It makes
     no request and needs no key.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import pathlib
import re
import signal
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
ROSTER = ROOT / "data" / "instagram-handles.json"
LEDGER = ROOT / "data" / "instagram-ledger.json"
OUT = ROOT / "all-day" / "data" / "instagram.json"
SECRETS = pathlib.Path.home() / ".config" / "btownbrief" / "secrets.env"
TZ = ZoneInfo("America/New_York")

ENDPOINT = "https://api.scrapecreators.com/v2/instagram/user/posts"
POSTS_PER_HANDLE = 6          # newest few per account; the tab is a mixed feed
KEEP_DAYS = 21                # older than this is not "what is happening"
WANT_W = 480                  # candidate width to prefer for the grid

# THE ONE NUMBER. Credits this builder may spend in a calendar month. Set
# 2026-10-17 at twice what it spent before the tiered roster: 87 handles + 1
# tagged = 88 credits a day, 2,640 in a 30-day month. At the Freelance pack's
# price ($47 for 25,000 credits, $0.00188 each) the ceiling is about $9.93 a
# month. Raise it and the tier 3 rotation is the only thing that grows.
MONTHLY_CREDIT_BUDGET = 5400

RUNS_PER_DAY = 2              # refresh-allday.yml's two crons; for the projection only
TIER3_PERIOD_DAYS = 7         # tier 3: each account once a week
TIERS = (1, 2, 3)
PENDING_MAX_H = 6             # a --reserve older than this is not executed
# Wall-clock budget for the account requests in one --execute. The workflow's
# Build Instagram step is killed at 30 minutes, and a kill before the payload
# is written loses every post this run paid for: the 154-account morning runs
# of 2026-10-26, -28 and -29 hit that (Oct 27's finished in 28 minutes). Past
# this budget the run stops asking, gives the unasked accounts their rotation
# places back, and writes what it has, leaving ~10 minutes for the tagged
# shelf, the kind calls and the write.
FETCH_BUDGET_S = 20 * 60
ONLY_MAX = 5                  # --only is a small local test, never a second schedule
CATEGORIES = ("food", "venue", "events", "shop", "pets", "scenic", "other")

# One cap per category, so a chip never comes up empty because another kind
# of account posts more. About 1.25 KB a post: the caps total ~600 posts,
# ~750 KB, against 388 posts and 483 KB before the bigger roster.
CAP = {"food": 150, "venue": 90, "events": 100, "shop": 60, "pets": 50,
       "scenic": 90, "other": 60}
TAGGED_CAP = 12

# @btownbrief's numeric id (the tagged-posts endpoint takes ids, not handles).
# Checked 2026-09-02 via /v1/instagram/profile?handle=btownbrief.
TAGGED_ENDPOINT = "https://api.scrapecreators.com/v1/instagram/user/tagged-posts"
TAGGED_USER_ID = "71971306251"
TAGGED_DAYS = 120             # nobody has been asked to tag yet; a 3-week window would be empty
IG_EPOCH_MS = 1314220021721   # media-id snowflake epoch

# How long a carried post may live is not a constant here: it is whatever its
# own signature says, read per URL by carry_ok(). The measured life is 4.3-4.5
# days. This is the only knob — refuse anything that close to expiring, so a
# reader who opens the tab late in the day still gets pictures.
CARRY_MARGIN_H = 8

# What a picture is, for the Photos chips (the contract with the Wire's
# Photos view: it reads `kind` when present). A post nobody has judged yet
# takes its account's category's kind.
KINDS = ("vibe", "poster", "food", "pets", "scenic", "other")
KIND_OF_CATEGORY = {"food": "food", "venue": "vibe", "events": "poster", "pets": "pets",
                    "scenic": "scenic", "shop": "other", "other": "other"}
KIND_BATCH = 150              # posts per caption call; a steady-state run is one call
CAPTION_CHARS = 300           # of each caption the model reads
IMAGE_LOOK_MAX = 60           # unsure posts per run that get their thumbnail looked at
IMAGE_MAX_BYTES = 1_500_000   # a 480px thumbnail is ~20-60 KB; anything bigger is skipped
# AI COST. Claude Haiku 5.5, $0.10 / $0.50 per million tokens in / out
# (platform.claude.com pricing, checked 2026-10-18; under 100K-token prompts).
# An image is ceil(w/28) * ceil(h/28) tokens: a 480x600 thumbnail is 396.
# Measured 2026-10-18 on the live payload, every one of its 433 posts treated
# as new: captions 47,922 in / 8,165 out tokens over three calls = $0.0089
# ($0.00002 a post); 60 thumbnails 31,431 in / 904 out = $0.0036 ($0.00006 a
# post). The roster brings ~150 new posts a day, about half unsure, so a
# steady month is roughly $0.10 of captions and $0.13 of looks. This cap is
# the backstop, not the budget.
AI_MONTH_CAP_USD = 3.0


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


STP_SIZE = re.compile(r"_([ps])(\d{2,4})x(\d{2,4})(?:_|$)")


def with_size(c: dict) -> dict:
    """A candidate with its width, read from its own URL when the API left it
    off. On 2026-10-16 most photo posts came back with no sizes at all, and
    without one every candidate was skipped and the post was dropped. The
    size is written in the signed `stp` token: `p1080x1080` is the picture
    fitted inside that box (its own shape kept, so no height is claimed),
    `s480x480` a square crop."""
    if not isinstance(c, dict) or c.get("width") or not isinstance(c.get("url"), str):
        return c if isinstance(c, dict) else {}
    try:
        stp = (urllib.parse.parse_qs(urllib.parse.urlparse(c["url"]).query).get("stp") or [""])[0]
    except Exception:
        return c
    m = STP_SIZE.search(stp)
    if not m:
        return c
    out = dict(c, width=int(m.group(2)))
    if m.group(1) == "s":
        out["height"] = int(m.group(3))
    return out


def pick_thumb(item: dict) -> tuple[str | None, int | None]:
    """The smallest candidate at or above WANT_W — a 20 KB picture instead of
    a 1.3 MB one. Falls back to whatever single URL is on offer.

    A reel offers a 9:16 and a square crop at the same width; the one in the
    post's own shape wins, so a reel's poster is the reel's frame."""
    cands = ((item.get("image_versions2") or {}).get("candidates")) or []
    sized = [c for c in (with_size(c) for c in cands) if c.get("url") and c.get("width")]
    ow, oh = item.get("original_width"), item.get("original_height")
    shape = (oh / ow) if isinstance(ow, (int, float)) and isinstance(oh, (int, float)) and ow > 0 else None

    def off_shape(c: dict) -> float:
        if not shape or not c.get("height"):
            return 0.0
        return abs(c["height"] / c["width"] - shape)

    if sized:
        at_or_above = sorted((c for c in sized if c["width"] >= WANT_W),
                             key=lambda c: (c["width"], off_shape(c) > 0.02))
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
    # No timestamp on the record (the tagged-posts endpoint): decode the
    # media id. Verified against posts carrying both: within ~6 minutes.
    pk = item.get("pk") or item.get("id")
    try:
        pk = int(str(pk).split("_")[0])
    except (TypeError, ValueError):
        return None
    if pk <= 0:
        return None
    ts = ((pk >> 23) + IG_EPOCH_MS) // 1000
    return ts if ts > 1_300_000_000 else None


def fetch_tagged(key: str) -> list[dict]:
    """Newest page of posts that tag @btownbrief — ten or so, one credit."""
    url = TAGGED_ENDPOINT + "?" + urllib.parse.urlencode({"user_id": TAGGED_USER_ID})
    req = urllib.request.Request(url, headers={"x-api-key": key})
    with urllib.request.urlopen(req, timeout=45) as r:
        doc = json.load(r)
    items = doc.get("posts")
    if not isinstance(items, list):
        items = doc.get("items") if isinstance(doc.get("items"), list) else []
    return items or []


def tagged_record(it: dict, cutoff: float, now: float | None = None) -> dict | None:
    handle = ((it.get("user") or {}).get("username") or "").strip().lstrip("@").lower()
    if not handle:
        return None
    ts = taken_at(it)
    if not ts or ts < cutoff:
        return None
    thumb, w = pick_thumb(it)
    if not thumb:
        return None
    code = code_of(it)
    rec = {
        "h": handle,
        "ts": ts,
        "i": thumb,
        "u": f"https://www.instagram.com/p/{code}/" if code
             else f"https://www.instagram.com/{handle}/",
        "s": "tagged",
    }
    if w:
        rec["w"] = w
    cap = caption_of(it)
    if cap:
        rec["c"] = cap[:400]
    if it.get("media_type") == 2 or it.get("is_video"):
        rec["v"] = 1
        add_video(rec, it, now if now is not None else time.time())
    return rec


def code_of(item: dict) -> str | None:
    return item.get("code") or item.get("shortcode") or None


def pick_video(item: dict) -> str | None:
    """The smallest playable candidate. Instagram lists them biggest first
    and has been seen sending three copies of one file with no sizes at all,
    so an unsized candidate sorts after every sized one and ties keep the
    list's order."""
    cands = [c for c in (item.get("video_versions") or [])
             if isinstance(c, dict) and isinstance(c.get("url"), str) and c["url"].startswith("https://")]
    if not cands:
        return None
    big = float("inf")
    best = min(enumerate(cands), key=lambda ic: (
        (ic[1].get("width") or big) * (ic[1].get("height") or 1), ic[0]))
    return best[1]["url"]


def add_video(rec: dict, item: dict, now: float) -> None:
    """Give a video post its MP4: `vu`, `ve` and `vd`. Fails closed: a video
    URL whose expiry cannot be read, or that lapses inside the carry margin,
    is left off, and the post stays a photo (it is still marked `v` so the
    tab can say it is a reel)."""
    url = pick_video(item)
    exp = signature_expiry(url) if url else None
    if not url or not exp or exp - now < CARRY_MARGIN_H * 3600:
        return
    rec["vu"] = url
    rec["ve"] = exp
    dur = item.get("video_duration")
    if isinstance(dur, (int, float)) and dur > 0:
        rec["vd"] = round(float(dur), 1)


def video_ok(rec: dict, now: float) -> bool:
    """Is a post's video still worth shipping? The same margin as a carried
    picture: refuse anything about to lapse."""
    exp = rec.get("ve")
    return (isinstance(rec.get("vu"), str) and isinstance(exp, (int, float))
            and exp - now >= CARRY_MARGIN_H * 3600)


def drop_video(rec: dict) -> dict:
    for k in ("vu", "ve", "vd"):
        rec.pop(k, None)
    return rec


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


def post_record(h: str, it: dict, cutoff: float, now: float | None = None) -> dict | None:
    """One rostered account's post as the payload keeps it, or None when it
    is too old or has no picture."""
    ts = taken_at(it)
    if not ts or ts < cutoff:
        return None
    thumb, w = pick_thumb(it)
    if not thumb:
        return None
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
        add_video(rec, it, now if now is not None else time.time())
    return rec




def norm_handle(h: object) -> str:
    return str(h or "").strip().lstrip("@").lower()


def load_block() -> set[str]:
    """Handles whose tagged posts never land. Same file as the roster, so
    there is one place to look."""
    try:
        raw = json.loads(ROSTER.read_text(encoding="utf-8"))
        got = raw.get("tagged_block") or []
        return {norm_handle(h) for h in got if norm_handle(h)}
    except Exception:
        return set()


def load_hints(accounts: list[dict]) -> dict[str, set[str]]:
    """The roster's second opinions about an account, for the kind prompt:
    `photo_categories` (a cat cafe is also pets and a vibe check) and the
    `food` flag on a bar or a brewery."""
    out: dict[str, set[str]] = {}
    try:
        tags = json.loads(ROSTER.read_text(encoding="utf-8")).get("photo_categories") or {}
    except Exception:
        tags = {}
    for tag, hs in tags.items() if isinstance(tags, dict) else ():
        if tag.startswith("_") or not isinstance(hs, list):
            continue
        for h in hs:
            if norm_handle(h):
                out.setdefault(norm_handle(h), set()).add(tag)
    for a in accounts:
        if a["food"] and a["category"] != "food":
            out.setdefault(a["h"], set()).add("food")
    return out


def fair_cap(recs: list[dict], n: int) -> list[dict]:
    """At most `n` posts, filled one per account at a time: every account's
    newest, then every account's second newest, and so on, newest first
    within a round. Newest-first alone let a daily account push a weekly
    one's still-good posts out of the payload."""
    rank: dict[str, int] = {}
    ranked = []
    for r in sorted(recs, key=lambda r: -r["ts"]):
        k = rank.get(r["h"], 0)
        rank[r["h"]] = k + 1
        ranked.append((k, -r["ts"], r))
    ranked.sort(key=lambda t: (t[0], t[1]))
    return [r for _, _, r in ranked[:n]]


def load_roster(path: pathlib.Path | None = None) -> list[dict]:
    """The roster's `accounts`, cleaned: one dict per handle with `h`, `tier`,
    `category`, `s` (`do` or `see`, kept on posts for older readers) and
    `food`.

    A typo must not stop a build or cost money, so bad values fail CHEAP: an
    unknown tier becomes 3 (the least often fetched), an unknown category
    becomes `other`, and a handle listed twice keeps its first entry. Each is
    warned about."""
    doc = json.loads((path or ROSTER).read_text(encoding="utf-8"))
    out, seen, dupes, fixed = [], set(), [], []
    for a in doc.get("accounts") or []:
        if not isinstance(a, dict):
            continue
        h = norm_handle(a.get("h"))
        if not h or not re.fullmatch(r"[a-z0-9_.]{1,30}", h):
            fixed.append(f"bad handle {a.get('h')!r} dropped")
            continue
        if h in seen:
            dupes.append(h)
            continue
        seen.add(h)
        tier = a.get("tier")
        if tier not in TIERS or isinstance(tier, bool):
            fixed.append(f"{h}: tier {tier!r} -> 3")
            tier = 3
        cat = a.get("category")
        if cat not in CATEGORIES:
            fixed.append(f"{h}: category {cat!r} -> other")
            cat = "other"
        out.append({"h": h, "tier": tier, "category": cat,
                    "s": "see" if a.get("s") == "see" else "do",
                    "food": cat == "food" or a.get("food") is True})
    if dupes:
        log(f"WARNING: {len(dupes)} duplicate handle(s), first entry kept: {', '.join(dupes[:6])}")
    if fixed:
        log(f"WARNING: {len(fixed)} roster fix(es): {'; '.join(fixed[:6])}")
    return out


# -------------------------------------------------------------------- kind

KIND_RULES = """You sort Instagram posts from Burlington, Vermont accounts into the kind of
PICTURE each one is, for a photo wall with these filters:

vibe    what a place or a night looks like right now: a bar, a cafe or a venue's
        room, a crowd, a band on stage, people out, a patio, a storefront
poster  a flyer or graphic announcing a dated event: a lineup, a show, a market
        day, a class, trivia night, with the date or time usually in the picture
food    food or drink is the subject: a plate, a pastry, a coffee, a pour, a special
pets    an animal is the subject: a cat, a dog, an adoptable pet
scenic  the lake, a sunset, the mountains, foliage, streets, buildings, weather
other   anything else: clothing and goods for sale, portraits, merch, hiring
        notices, announcements with no event, memes, text that is not an event

The account's category is a hint, not the answer. A cat cafe's latte is food, a
restaurant's trivia flyer is a poster, a brewery's crowded taproom is vibe. A
caption describes the post but not always the picture: "join us Friday" may sit
on a flyer or on a photo of last week's crowd. Say sure=false whenever the
caption does not settle what the picture shows."""

LOOK_RULES = KIND_RULES + """

Now you can see each picture. Judge by the picture itself; use the caption only
to break a tie."""


def kind_schema(sure: bool) -> dict:
    props = {"i": {"type": "integer"}, "kind": {"type": "string", "enum": list(KINDS)}}
    if sure:
        props["sure"] = {"type": "boolean"}
    return {"type": "object", "additionalProperties": False, "required": ["kinds"],
            "properties": {"kinds": {"type": "array", "items": {
                "type": "object", "properties": props, "required": list(props),
                "additionalProperties": False}}}}


def kind_line(i: int, rec: dict, hints: dict) -> str:
    also = sorted(hints.get(rec["h"], ()))
    what = "reel" if rec.get("v") else "photo"
    cap = (rec.get("c") or "")[:CAPTION_CHARS] or "(no caption)"
    return (f"{i}. @{rec['h']} · {rec.get('category') or 'other'}"
            + (f" (also {', '.join(also)})" if also else "") + f" · {what} · {cap}")


def read_kinds(raw: object, n: int, sure: bool) -> dict[int, tuple[str, bool]]:
    """The model's answer -> {index: (kind, sure)}. A bad index, a repeat or
    an unknown kind is dropped, and that post simply keeps its default."""
    out = {}
    for e in raw if isinstance(raw, list) else []:
        if not isinstance(e, dict):
            continue
        i = e.get("i")
        if not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < n or i in out:
            continue
        if e.get("kind") not in KINDS:
            continue
        out[i] = (e["kind"], e.get("sure") is True if sure else True)
    return out


def sniff_image(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def fetch_thumb(url: str) -> tuple[str, str] | None:
    """(media type, base64) of a thumbnail, or None. Sent as bytes rather
    than a URL so the answer never depends on who else Instagram's CDN will
    serve."""
    import base64
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = r.read(IMAGE_MAX_BYTES + 1)
    except Exception:
        return None
    mt = sniff_image(data) if len(data) <= IMAGE_MAX_BYTES else None
    return (mt, base64.b64encode(data).decode("ascii")) if mt else None


def post_key(rec: dict) -> str:
    """A post's identity: its post URL, or (no shortcode) handle and time."""
    u = rec.get("u") or ""
    return "u:" + u if "/p/" in u else f"t:{rec.get('h')}:{rec.get('ts')}"


def ai_spent(ledger: dict | None, now: float) -> float:
    ai = (ledger or {}).get("ai") or {}
    return float(ai.get("usd") or 0) if ai.get("month") == month_key(local_day(now)) else 0.0


def assign_kinds(posts: list[dict], prev_kinds: dict, hints: dict,
                 ledger: dict | None, now: float, look: bool = True) -> dict:
    """Give every post a `kind`. Returns what the run did and spent.

    A post keeps a kind it already has, or the one it had in the last
    payload (`prev_kinds`, by post_key: a tier 2 account's posts come back
    every day; they are judged once). The rest start at their category's
    kind, marked `kd`, and are sent to the model, one question per post even
    when it ships twice (a rostered account's post that also tags the
    Brief); a valid answer replaces the default and clears `kd`."""
    todo, twins = [], {}
    for rec in posts:
        known = rec.get("kind") if not rec.get("kd") else None
        known = known or prev_kinds.get(post_key(rec))
        if known in KINDS:
            rec["kind"] = known
            rec.pop("kd", None)
            continue
        rec["kind"] = KIND_OF_CATEGORY.get(rec.get("category"), "other")
        rec["kd"] = 1
        k = post_key(rec)
        if k in twins:
            twins[k].append(rec)
        else:
            twins[k] = [rec]
            todo.append(rec)
    report = {"asked": 0, "looked": 0, "decided": 0, "usd": 0.0}
    if not todo:
        return report
    try:
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
        import wire_common as wc
    except Exception as e:
        log(f"kind: wire_common unavailable ({str(e)[:60]}); {len(todo)} post(s) keep their category's kind")
        return report
    engine = wc.pick_engine("tag")
    if engine is None:
        log(f"kind: no model key; {len(todo)} post(s) keep their category's kind")
        return report
    if ai_spent(ledger, now) >= AI_MONTH_CAP_USD:
        log(f"kind: ${ai_spent(ledger, now):.2f} spent this month (cap ${AI_MONTH_CAP_USD:.2f}); "
            f"{len(todo)} post(s) keep their category's kind")
        return report

    usage = {"in": 0, "out": 0, "cache_read": 0, "cache_write": 0, "calls": 0}

    def over_cap(what):
        spent = ai_spent(ledger, now) + wc.cost_usd(engine["model"], usage)
        if spent >= AI_MONTH_CAP_USD:
            log(f"kind: the month's cap (${AI_MONTH_CAP_USD:.2f}) reached; no {what} call")
            return True
        return False

    def ask(system, user, schema, n, sure, label):
        try:
            answer, got = wc.ask_json(engine, system, user, schema, max_tokens=60 * n + 500,
                                      log_prefix="kind")
        except Exception as e:  # noqa: BLE001 — SDK missing, network, a bad answer
            got = getattr(e, "usage", {}) or {}
            answer = None
            log(f"kind: {label} call failed ({str(e)[:80]})")
        for k in usage:
            usage[k] += got.get(k, 0)
        return read_kinds(answer.get("kinds") if isinstance(answer, dict) else None, n, sure)

    # The picture itself settles what a caption cannot. Claude only: the
    # OpenRouter fallback reads text, so there a caption's guess is final.
    can_look = look and engine["provider"] == "anthropic"
    unsure = []
    for start in range(0, len(todo), KIND_BATCH):
        if over_cap("caption"):
            break
        batch = todo[start:start + KIND_BATCH]
        text = "POSTS:\n" + "\n".join(kind_line(i, r, hints) for i, r in enumerate(batch))
        got = ask(KIND_RULES, text, kind_schema(True), len(batch), True, "caption")
        report["asked"] += len(batch)
        for i, rec in enumerate(batch):
            if i not in got:
                continue
            kind, sure = got[i]
            rec["kind"] = kind          # unsure: the caption's best guess while it waits for a look
            if sure or not can_look:
                rec.pop("kd", None)
            else:
                unsure.append(rec)

    if unsure and not over_cap("image"):
        # At most IMAGE_LOOK_MAX downloads, newest first, inside a deadline:
        # a CDN that hangs must not eat the step's timeout before the
        # payload is written.
        shown, content = [], []
        deadline = time.monotonic() + 90
        for rec in sorted(unsure, key=lambda r: -r["ts"])[:IMAGE_LOOK_MAX]:
            if time.monotonic() > deadline:
                log("kind: thumbnail downloads ran out of time")
                break
            pic = fetch_thumb(rec["i"])
            if not pic:
                continue
            content.append({"type": "text", "text": "Image " + kind_line(len(shown), rec, hints)})
            content.append({"type": "image", "source": {"type": "base64",
                                                        "media_type": pic[0], "data": pic[1]}})
            shown.append(rec)
        if shown:
            content.append({"type": "text", "text": f"Give the kind of each of the {len(shown)} images."})
            got = ask(LOOK_RULES, content, kind_schema(False), len(shown), False, "image")
            report["looked"] = len(shown)
            for i, rec in enumerate(shown):
                if i in got:
                    rec["kind"] = got[i][0]
                    rec.pop("kd", None)
    # An unsure post nobody looked at (past IMAGE_LOOK_MAX, a thumbnail that
    # would not download, the cap) keeps the caption's guess, still marked
    # `kd`, and is asked again next run.
    for rec in todo:
        for twin in twins[post_key(rec)][1:]:
            twin["kind"] = rec["kind"]
            if rec.get("kd"):
                twin["kd"] = 1
            else:
                twin.pop("kd", None)

    report["decided"] = sum(1 for r in todo if not r.get("kd"))
    usd = wc.cost_usd(engine["model"], usage)
    report["usd"] = usd
    if ledger is not None and (usage["calls"] or usage["in"]):
        month = month_key(local_day(now))
        ai = ledger.get("ai")
        if not isinstance(ai, dict) or ai.get("month") != month:
            ai = {"month": month, "usd": 0.0, "runs": []}
        ai["usd"] = round(ai["usd"] + usd, 6)
        ai["runs"].append({"at": dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat(timespec="seconds"),
                           "model": engine["model"], "asked": report["asked"], "looked": report["looked"],
                           "in": usage["in"], "out": usage["out"], "usd": round(usd, 6)})
        ledger["ai"] = ai
    log(f"kind: {report['decided']} of {len(todo)} new post(s) decided ({report['asked']} by caption, "
        f"{report['looked']} looked at) · {usage['in']:,} in / {usage['out']:,} out tokens · "
        f"${usd:.4f} this run · ${ai_spent(ledger, now) if ledger else usd:.2f} this month")
    return report


BUSY_DAYS = 14
BUSY_MIN = 3


def busy_tier3(accounts: list[dict], payload: pathlib.Path, now: float) -> list[tuple]:
    """Tier 3 accounts whose shipped posts say they post often enough to be
    worth a daily check: candidates to move to tier 2 by hand. Read from the
    payload, so it costs nothing and only knows accounts already fetched."""
    try:
        posts = json.loads(payload.read_text(encoding="utf-8")).get("posts") or []
    except Exception:
        return []
    t3 = {a["h"]: a["category"] for a in accounts if a["tier"] == 3}
    n: dict[str, int] = {}
    for r in posts:
        if (isinstance(r, dict) and r.get("h") in t3 and r.get("s") != "tagged"
                and isinstance(r.get("ts"), (int, float)) and r["ts"] >= now - BUSY_DAYS * 86400):
            n[r["h"]] = n.get(r["h"], 0) + 1
    return sorted(((h, t3[h], k) for h, k in n.items() if k >= BUSY_MIN), key=lambda t: (-t[2], t[0]))


# ------------------------------------------------------------------ budget

def local_day(ts: float) -> dt.date:
    """The Burlington calendar day an epoch second falls on."""
    return dt.datetime.fromtimestamp(ts, TZ).date()


def month_key(day: dt.date) -> str:
    return f"{day.year:04d}-{day.month:02d}"


def days_in_month(day: dt.date) -> int:
    nxt = (day.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    return (nxt - dt.timedelta(days=1)).day


def share_through(day: dt.date, budget: int, through: int | None = None) -> int:
    """Credits the month may have spent by the end of day `through` (default:
    `day` itself). Rounded down, so the month's shares never add to more than
    the budget."""
    d = day.day if through is None else through
    return (budget * max(0, d)) // days_in_month(day)


def load_ledger(path: pathlib.Path, now: float, budget: int) -> tuple[dict, bool]:
    """This month's ledger, and whether it was actually read.

    A ledger from last month starts this one at zero spent and keeps the
    fetch times (the rotation does not care about months). A missing or
    unreadable ledger, or one whose numbers do not make sense, fails CLOSED:
    the whole of today's share is assumed spent, so this run fetches nothing,
    and the ledger it writes lets tomorrow's run start from a known number.
    A missing ledger cannot be told apart from a lost one, and a lost one
    could hide a run that already spent today's credits."""
    today = local_day(now)
    month = month_key(today)
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(doc, dict):
            raise ValueError("not an object")
        last = doc.get("last") if isinstance(doc.get("last"), dict) else {}
        last = {norm_handle(h): int(t) for h, t in last.items()
                if isinstance(t, (int, float)) and not isinstance(t, bool) and 0 < t <= now + 86400}
        spent = doc.get("spent")
        if doc.get("month") == month:
            if not isinstance(spent, int) or isinstance(spent, bool) or spent < 0:
                raise ValueError(f"spent is {spent!r}")
        elif isinstance(doc.get("month"), str) and doc["month"] < month:
            spent = 0
        else:
            raise ValueError(f"month is {doc.get('month')!r}")
        runs = [r for r in (doc.get("runs") or []) if isinstance(r, dict)]
        out = {"month": month, "spent": spent, "last": last, "runs": runs}
        ai = doc.get("ai")
        if (isinstance(ai, dict) and ai.get("month") == month
                and isinstance(ai.get("usd"), (int, float)) and not isinstance(ai.get("usd"), bool)):
            out["ai"] = {"month": month, "usd": float(ai["usd"]),
                         "runs": [r for r in (ai.get("runs") or []) if isinstance(r, dict)]}
        pend = doc.get("pending")
        if (isinstance(pend, dict) and isinstance(pend.get("handles"), list)
                and isinstance(pend.get("at"), (int, float))):
            prev = pend.get("prev") if isinstance(pend.get("prev"), dict) else {}
            out["pending"] = {
                "handles": [norm_handle(h) for h in pend["handles"] if norm_handle(h)],
                "tagged": pend.get("tagged") is True, "at": int(pend["at"]),
                "month": pend.get("month"),
                "prev": {norm_handle(h): int(t) for h, t in prev.items()
                         if isinstance(t, (int, float)) and not isinstance(t, bool) and t >= 0},
            }
        return out, True
    except FileNotFoundError:
        why = "no ledger"
    except Exception as e:  # corrupt, hand-edited, from the future
        why = f"unreadable ledger ({str(e)[:60]})"
    assumed = share_through(today, budget)
    log(f"WARNING: {why} — assuming {assumed} credits already spent this month "
        f"(today's whole share), so this run fetches nothing")
    return {"month": month, "spent": assumed, "last": {}, "runs": []}, False


def allowance(ledger: dict, now: float, budget: int) -> int:
    """What this run may spend: today's running share, less what is spent."""
    return max(0, share_through(local_day(now), budget) - ledger["spent"])


def tier3_quota(n: int) -> int:
    """Tier 3 accounts to take each day so the whole tier turns over once a
    period."""
    return math.ceil(n / TIER3_PERIOD_DAYS) if n else 0


def plan(accounts: list[dict], last: dict, now: float, credits: int,
         tagged: bool = True) -> tuple[list[dict], bool, list[str]]:
    """Which accounts this run fetches, whether it fetches the tagged shelf,
    and what it had to leave for later — all inside `credits`.

    Order of claim: tier 1 (every run), the tagged shelf, tier 2 (any not yet
    fetched this Burlington day), then tier 3 (those not fetched for
    TIER3_PERIOD_DAYS, longest-waiting first, up to today's slice of the tier
    less any already taken today). The total never exceeds `credits`."""
    today = local_day(now)

    def day_of(h: str) -> dt.date | None:
        t = last.get(h)
        return local_day(t) if t else None

    # Every tier is served longest-waiting first, so when credits run short
    # the same accounts are not the ones left out every time. Ties (every
    # account the first week, or after a lost ledger) break on a hash of the
    # handle, not roster order, so a day's slice mixes categories instead of
    # being all `events` one day and all `shop` another.
    def oldest_first(group):
        return sorted(group, key=lambda a: (last.get(a["h"], 0), zlib.crc32(a["h"].encode()), a["h"]))

    t1 = oldest_first(a for a in accounts if a["tier"] == 1)
    t2 = oldest_first(a for a in accounts if a["tier"] == 2 and day_of(a["h"]) != today)
    t3_all = [a for a in accounts if a["tier"] == 3]
    taken_today = sum(1 for a in t3_all if day_of(a["h"]) == today)
    room3 = max(0, tier3_quota(len(t3_all)) - taken_today)
    due3 = oldest_first(a for a in t3_all
                        if day_of(a["h"]) is None
                        or (today - day_of(a["h"])).days >= TIER3_PERIOD_DAYS)[:room3]

    left = max(0, credits)
    picked, skipped, want_tagged = [], [], False
    for group in (t1, ["tagged"] if tagged else [], t2, due3):
        for a in group:
            if left <= 0:
                skipped.append("tagged" if a == "tagged" else a["h"])
                continue
            left -= 1
            if a == "tagged":
                want_tagged = True
            else:
                picked.append(a)
    return picked, want_tagged, skipped


def projection(accounts: list[dict], tagged: bool = True) -> dict:
    """Steady-state cost of a roster: credits a day and a 31-day month."""
    n = {t: sum(1 for a in accounts if a["tier"] == t) for t in TIERS}
    day = RUNS_PER_DAY * (n[1] + (1 if tagged else 0)) + n[2] + tier3_quota(n[3])
    return {"tiers": n, "per_day": day, "per_month": day * 31}


def save_ledger(path: pathlib.Path, ledger: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = {
        "_comment": "Written by scripts/build_instagram.py; read back by it. "
                    "spent = Scrape Creators credits this builder spent this "
                    "Burlington month (one per request, failures included). "
                    "last = when each account was last requested. Do not "
                    "hand-edit spent downward.",
        "month": ledger["month"],
        "budget": MONTHLY_CREDIT_BUDGET,
        "spent": ledger["spent"],
        "runs": ledger["runs"][-62:],
        "last": dict(sorted(ledger["last"].items())),
    }
    if ledger.get("pending"):
        doc["pending"] = ledger["pending"]
    if ledger.get("ai"):
        doc["ai"] = dict(ledger["ai"], runs=ledger["ai"]["runs"][-62:])
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


# -------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-carry", action="store_true",
                    help="ignore the previous payload; scrape-only")
    ap.add_argument("--no-tagged", action="store_true",
                    help="skip the one-credit tagged-posts fetch")
    ap.add_argument("--only", default="",
                    help="comma-separated rostered handles: fetch just these and "
                         "nothing else (no tagged shelf), still inside the budget")
    ap.add_argument("--no-look", action="store_true",
                    help="judge kinds from captions only; never send a thumbnail to the model")
    ap.add_argument("--out", type=pathlib.Path, default=None,
                    help="write the payload here instead of all-day/data/instagram.json")
    ap.add_argument("--ledger", type=pathlib.Path, default=None,
                    help="read and write the ledger here instead of data/instagram-ledger.json")
    step = ap.add_mutually_exclusive_group()
    step.add_argument("--dry-run", action="store_true",
                      help="print this run's plan and its cost; no request, no key, no write")
    step.add_argument("--reserve", action="store_true",
                      help="plan this run and write its credits and its accounts to the "
                           "ledger, then stop; no request (the workflow pushes it first)")
    step.add_argument("--execute", action="store_true",
                      help="fetch exactly what the last --reserve wrote to the ledger")
    args = ap.parse_args()
    ledger_path = args.ledger or LEDGER

    accounts = load_roster()
    cat_of = {a["h"]: a["category"] for a in accounts}
    now = time.time()
    budget = MONTHLY_CREDIT_BUDGET

    ledger, ledger_ok = load_ledger(ledger_path, now, budget)
    if args.execute:
        return execute(args, ledger, ledger_path, accounts, now)
    # A reservation still on the ledger was never executed (--execute clears
    # it before its first request). Its credits stay counted, which is the
    # safe side if it did run and its push was lost, but its accounts get
    # their places in the rotation back, so they are not skipped for a day
    # (tier 2) or a week (tier 3) without ever having been fetched.
    old = ledger.pop("pending", None)
    if old:
        for h in old["handles"]:
            if old["prev"].get(h):
                ledger["last"][h] = old["prev"][h]
            else:
                ledger["last"].pop(h, None)
        log(f"an unexecuted reservation of {len(old['handles'])} account(s) from "
            f"{dt.datetime.fromtimestamp(old['at'], dt.timezone.utc):%Y-%m-%d %H:%M} UTC: "
            f"credits kept as spent, rotation places restored")
    credits = allowance(ledger, now, budget)
    if args.only:
        want = {norm_handle(h) for h in args.only.split(",") if norm_handle(h)}
        if len(want) > ONLY_MAX:
            # Its credits land only in this checkout's ledger, so it has to
            # stay small enough not to matter to the month.
            log(f"refusing: --only takes at most {ONLY_MAX} handles")
            return 2
        stray = sorted(want - set(cat_of))
        if stray:
            log(f"--only: not in the roster, ignored: {', '.join(stray)}")
        pool = [a for a in accounts if a["h"] in want]
        picked = pool[:credits]
        skipped = [a["h"] for a in pool[credits:]]
        want_tagged = False         # "just these": never the tagged shelf
    else:
        picked, want_tagged, skipped = plan(accounts, ledger["last"], now, credits,
                                            tagged=not args.no_tagged)

    proj = projection(accounts, tagged=not args.no_tagged)
    n = proj["tiers"]
    log(f"roster: {len(accounts)} accounts (tier 1 {n[1]}, tier 2 {n[2]}, tier 3 {n[3]}); "
        f"steady state ~{proj['per_day']} credits/day, ~{proj['per_month']}/month "
        f"against a budget of {budget}")
    log(f"ledger: {ledger['spent']} spent in {ledger['month']}"
        + ("" if ledger_ok else " (assumed)") + f"; this run may spend {credits}")
    spend = len(picked) + (1 if want_tagged else 0)
    log(f"plan: {len(picked)} account(s)" + (" + tagged" if want_tagged else "")
        + f" = {spend} credits"
        + (f"; {len(skipped)} left for later: {', '.join(skipped[:8])}" if skipped else ""))
    if proj["per_month"] > budget:
        log(f"WARNING: the roster's steady state ({proj['per_month']}/month) is over the "
            f"budget; tier 3 will turn over slower than every {TIER3_PERIOD_DAYS} days")

    if args.dry_run:
        for t in TIERS:
            hs = [f"{a['h']} ({a['category']})" for a in picked if a["tier"] == t]
            if hs:
                print(f"tier {t} · {len(hs)}: " + ", ".join(hs))
        if want_tagged:
            print("tagged shelf · 1")
        print(f"total {spend} credits this run")
        busy = busy_tier3(accounts, args.out or OUT, now)
        if busy:
            print("tier 3 accounts posting like daily ones (posts in the last "
                  f"{BUSY_DAYS} days, from the payload): "
                  + ", ".join(f"{h} ({c}, {n})" for h, c, n in busy))
        return 0

    if not (args.reserve or args.only):
        # Reserving and spending in one go writes the credits only to THIS
        # checkout's ledger; main's never hears of them and the workflow
        # would spend the same allowance again. So the one-step mode is only
        # for an --only test of a handful of accounts, whose credits are
        # small and printed.
        log("refusing: run --reserve then --execute (the workflow does), --dry-run to "
            "see the plan, or --only h1,h2 for a small local test")
        return 2

    if not picked and not want_tagged:
        if not ledger_ok:
            save_ledger(ledger_path, ledger)    # tomorrow starts from a known number
        log("nothing to fetch inside the budget — payload left as it is")
        return 0

    if not api_key():
        log("no Scrape Creators key — set SCRAPECREATORS_API_KEY. Nothing written.")
        return 1

    # Every request is a credit, whatever comes back. The whole run's spend is
    # written to the ledger BEFORE the first request: a run killed halfway
    # has then over-counted, never under-counted, and a ledger that cannot be
    # written stops the run before it costs anything. With --reserve that is
    # all this run does: the workflow pushes the ledger, and only a push that
    # landed lets --execute spend it, so the next run can never read a ledger
    # that is missing these credits.
    ledger["spent"] += spend
    prev_last = {a["h"]: ledger["last"].get(a["h"], 0) for a in picked}
    for a in picked:
        ledger["last"][a["h"]] = int(now)
    roster_h = {a["h"] for a in accounts}
    ledger["last"] = {h: t for h, t in ledger["last"].items() if h in roster_h}
    ledger["runs"].append({"at": dt.datetime.fromtimestamp(now, dt.timezone.utc)
                           .isoformat(timespec="seconds"), "credits": spend})
    if args.reserve:
        ledger["pending"] = {"handles": [a["h"] for a in picked], "tagged": want_tagged,
                             "at": int(now), "month": ledger["month"], "prev": prev_last}
    save_ledger(ledger_path, ledger)
    log(f"ledger: {spend} reserved for this run, {ledger['spent']} of {budget} this month")
    if args.reserve:
        return 0
    log(f"--only: these {spend} credits are on this checkout's ledger only; "
        f"commit it to main or they go uncounted")
    return fetch_and_build(args, picked, want_tagged, accounts, now,
                           ledger=ledger, ledger_path=ledger_path)


def execute(args, ledger: dict, ledger_path: pathlib.Path, accounts: list[dict], now: float) -> int:
    """Spend what --reserve wrote, and nothing else. The credits were counted
    when they were reserved, so this changes `spent` not at all; it clears
    the reservation first, so it can never be spent twice."""
    pend = ledger.get("pending")
    if not pend:
        log("--execute: no reservation in the ledger — nothing fetched")
        return 0
    # Only a reservation made this Burlington month, in the last few hours,
    # is spent: last month's credits were counted against last month, and
    # spending them now would be spending this month's money uncounted. A
    # refused one stays on the ledger for the next --reserve to unwind.
    age = now - pend["at"]
    if pend.get("month") != ledger["month"] or not 0 <= age <= PENDING_MAX_H * 3600:
        log(f"--execute: the reservation is from {pend.get('month')}, "
            f"{age / 3600:.1f} hours ago — not spent")
        return 0
    if not api_key():
        log("no Scrape Creators key — set SCRAPECREATORS_API_KEY. Nothing written.")
        return 1
    by_h = {a["h"]: a for a in accounts}
    picked = [by_h[h] for h in dict.fromkeys(pend["handles"]) if h in by_h]
    want_tagged = pend["tagged"] and not args.no_tagged
    ledger.pop("pending", None)
    save_ledger(ledger_path, ledger)
    log(f"--execute: {len(picked)} account(s)" + (" + tagged" if want_tagged else "")
        + " as reserved")
    if not picked and not want_tagged:
        return 0

    def give_back(unattempted: list[str]) -> None:
        """Cut off partway (a crash, the step's timeout): the accounts never
        asked for get their rotation places back. Their credits stay
        counted; the run may have reached the API for the one in flight."""
        for h in unattempted:
            if pend["prev"].get(h):
                ledger["last"][h] = pend["prev"][h]
            else:
                ledger["last"].pop(h, None)
        save_ledger(ledger_path, ledger)
        log(f"--execute: stopped with {len(unattempted)} account(s) not asked for; "
            f"their rotation places restored")

    return fetch_and_build(args, picked, want_tagged, accounts, now, on_stop=give_back,
                           ledger=ledger, ledger_path=ledger_path)


def fetch_and_build(args, picked: list[dict], want_tagged: bool,
                    accounts: list[dict], now: float, on_stop=None,
                    ledger: dict | None = None, ledger_path: pathlib.Path | None = None) -> int:
    """Fetch `picked` (and the tagged shelf), carry forward what is still
    good, give every post its kind, and write the payload. The credits are
    already on the ledger; the kind call's dollars are added to it."""
    out_path = args.out or OUT
    key = api_key()
    cat_of = {a["h"]: a["category"] for a in accounts}
    seg_of = {a["h"]: a["s"] for a in accounts}
    food = {a["h"] for a in accounts if a["food"]}
    cutoff = now - KEEP_DAYS * 86400

    # Read the previous payload. Which of its posts we KEEP is decided after
    # the scrape, not before: a handle scheduled for today whose request fails
    # must keep yesterday's posts, or one API hiccup deletes the account from
    # the tab. Only a handle that actually answered gets its old posts
    # replaced.
    prev_posts = []
    if not args.no_carry and out_path.exists():
        try:
            prev = json.loads(out_path.read_text(encoding="utf-8"))
            got = prev.get("posts")
            prev_posts = got if isinstance(got, list) else []
        except Exception as e:
            log(f"could not read the previous payload ({str(e)[:60]}) — "
                f"building from this run alone")

    fresh, failed, answered = [], [], set()
    # A step timeout sends SIGTERM; make it an exception so on_stop runs.
    def _term(signum, frame):
        raise SystemExit(143)
    old_term = None
    try:
        old_term = signal.signal(signal.SIGTERM, _term)
    except ValueError:
        pass                    # not the main thread (a test harness)
    i = 0
    started = time.monotonic()
    try:
        for i, a in enumerate(picked):
            if time.monotonic() - started > FETCH_BUDGET_S:
                log(f"fetch budget ({FETCH_BUDGET_S // 60} min) spent after {i} of "
                    f"{len(picked)} account(s); writing what this run has")
                if on_stop:
                    on_stop([x["h"] for x in picked[i:]])
                break
            h = a["h"]
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
                rec = post_record(h, it, cutoff, now)
                if not rec:
                    continue
                fresh.append(rec)
                kept += 1
            time.sleep(0.4)
    except BaseException:
        if on_stop:
            on_stop([a["h"] for a in picked[i + 1:]])
        raise
    finally:
        if old_term is not None:
            signal.signal(signal.SIGTERM, old_term)
    log(f"asked {len(answered) + len(failed)} account(s) in "
        f"{(time.monotonic() - started) / 60:.1f} min")

    # The tagged shelf: anyone's posts, so it is judged by its own window
    # and blocklist, and carried on its own — a rostered account that
    # tagged the Brief appears in both places, and the two must not fold.
    block = load_block()
    tagged_cutoff = now - TAGGED_DAYS * 86400
    tagged, tagged_ok = [], False
    if want_tagged:
        try:
            for it in fetch_tagged(key):
                rec = tagged_record(it, tagged_cutoff, now)
                if rec and rec["h"] not in block:
                    tagged.append(rec)
            tagged_ok = True
        except Exception as e:
            failed.append(f"tagged: {str(e)[:50]}")

    if not tagged_ok:
        for rec in prev_posts:
            if (isinstance(rec, dict) and rec.get("s") == "tagged"
                    and rec.get("h") not in block
                    and carry_ok(rec, now, tagged_cutoff)):
                tagged.append(rec if video_ok(rec, now) else drop_video(rec))

    carried = []
    for rec in prev_posts:
        # One malformed record must not cost every good one, so each is judged
        # on its own rather than inside a single try around the whole loop.
        if not isinstance(rec, dict):
            continue
        if rec.get("s") == "tagged":
            continue            # handled above, on its own terms
        h = rec.get("h")
        if h in answered:
            continue            # today's fetch replaces it wholesale
        if h not in cat_of:
            continue            # dropped from the roster since that run
        if not carry_ok(rec, now, cutoff):
            continue
        carried.append(rec if video_ok(rec, now) else drop_video(rec))

    if carried:
        held = {r["h"] for r in carried} & {a["h"] for a in picked}
        log(f"carried {len(carried)} still-signed post(s) from "
            f"{len({r['h'] for r in carried})} account(s)"
            + (f", {len(held)} of them because today's fetch failed" if held else ""))

    if failed:
        log(f"{len(failed)} request(s) failed: {'; '.join(failed[:5])}")
    if not fresh:
        # Carried posts alone are yesterday's file with a new timestamp on it.
        # Better to leave the good payload in place and let the next run try.
        log("no posts collected — refusing to overwrite a good payload")
        return 1

    # Stamp segment, category and the food flag on every record, carried ones
    # included: the payload follows the roster as it is now, not the copy of
    # it that was current when the post was first seen.
    by_key = {}
    for rec in carried + fresh:
        rec["s"] = seg_of.get(rec["h"], "do")
        rec["category"] = cat_of.get(rec["h"], "other")
        if rec["h"] in food:
            rec["f"] = 1
        else:
            rec.pop("f", None)
        # A post URL identifies a post. The account URL does not — it is the
        # fallback for a post with no shortcode, and keying on it would fold
        # every shortcode-less post from that handle into one.
        u = rec.get("u") or ""
        by_key["u:" + u if "/p/" in u else f"t:{rec['h']}:{rec['ts']}"] = rec

    tagged_by_key = {}
    for rec in tagged:
        rec["category"] = cat_of.get(rec["h"], "other")
        tagged_by_key[rec.get("u") or f"{rec['h']}:{rec['ts']}"] = rec

    # Cap each category on its own, one post per account at a time, then
    # interleave back into one clock-ordered list.
    posts = []
    for cat, cap_n in CAP.items():
        half = [r for r in by_key.values() if r["category"] == cat]
        if len(half) > cap_n:
            log(f"{cat}: capped {len(half)} -> {cap_n}")
        posts.extend(fair_cap(half, cap_n))
    posts.extend(sorted(tagged_by_key.values(), key=lambda r: -r["ts"])[:TAGGED_CAP])
    posts.sort(key=lambda r: -r["ts"])

    # What each picture is. Only the shipped posts are judged, and a post the
    # last payload already judged keeps that answer.
    prev_kinds = {post_key(r): r["kind"] for r in prev_posts
                  if isinstance(r, dict) and r.get("kind") in KINDS and not r.get("kd")}
    before = ai_spent(ledger, now)
    try:
        assign_kinds(posts, prev_kinds, load_hints(accounts), ledger, now,
                     look=not getattr(args, "no_look", False))
    except Exception as e:  # noqa: BLE001 — a kind is never worth the payload
        log(f"kind: classification failed ({type(e).__name__}); unjudged posts keep their category's kind")
        for rec in posts:
            if rec.get("kind") not in KINDS:
                rec["kind"] = KIND_OF_CATEGORY.get(rec.get("category"), "other")
                rec["kd"] = 1
    if ledger is not None and ledger_path is not None and ai_spent(ledger, now) != before:
        save_ledger(ledger_path, ledger)

    segs = ("do", "see", "tagged")
    counts = {s: sum(1 for r in posts if r["s"] == s) for s in segs}
    accts = {s: len({r["h"] for r in posts if r["s"] == s}) for s in segs}
    cats = {c: sum(1 for r in posts if r.get("category") == c) for c in CATEGORIES}
    kinds = {k: sum(1 for r in posts if r.get("kind") == k) for k in KINDS}

    out = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        # These URLs stop working, and saying when is better than showing a
        # grid of broken frames. Measured at 4.3-4.5 days.
        "expires_hint_days": 4,
        # Accounts represented in THIS payload, not the whole roster.
        "handles": sorted({p["h"] for p in posts}),
        "segments": {s: {"posts": counts[s], "accounts": accts[s]} for s in segs},
        "categories": cats,
        # What the pictures are (`kind` on each post); `kd` marks a post still
        # on its category's default, to be judged next run.
        "kinds": kinds,
        "kinds_defaulted": sum(1 for r in posts if r.get("kd")),
        # Posts that carry a playable MP4 right now, and the food-tagged ones.
        "videos": sum(1 for r in posts if r.get("vu")),
        "food": sum(1 for r in posts if r.get("f")),
        "posts": posts,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    log(f"wrote {out_path}  {len(posts)} posts from {len(out['handles'])} accounts · "
        + " · ".join(f"{c} {n}" for c, n in cats.items() if n)
        + " · kinds " + " ".join(f"{k} {n}" for k, n in kinds.items() if n)
        + f" · {out['videos']} with video, {out['food']} food · "
        f"{out_path.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
