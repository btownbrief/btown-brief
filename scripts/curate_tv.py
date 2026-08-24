#!/usr/bin/env python3
"""BTown TV — the daily edition: a curated page of videos, not a feed.

refresh_youtube.py gathers the raw material (followed-channel uploads, the
Vermont radar, the deep-cut catalog) onto the `pulse-youtube` branch every
three hours. This script is the editor that runs once a day on top of it:

  1. Gates. Deterministic filters before any model sees a title — clips and
     trailers (anything far shorter than the channel's own median), promo /
     hashtag / webcam titles, reruns (a title the channel already published,
     or one the page already showed), livestreams (quarantined to their own
     rail), and anything a reader flagged "not for me" on the page.
  2. The editor. One Claude call reads the gated candidates plus the taste
     doctrine in prompts/tv-taste.md and picks by INDEX: one Tonight's pick
     and a handful per shelf, each with a one-line reason. Titles are used
     verbatim — the model never writes a headline — and every pick maps back
     to a real item with the URL, channel and timestamp the source gave us.
  3. The page + the TV. data/btown-tv.json goes to the orphan `btown-tv`
     branch (same single-commit pattern as pulse-top), and the same picks are
     written, in order, into a NEW public YouTube playlist for the night
     ("BTown TV — Sun, Aug 23") so the edition plays on the TV app with one
     click. One playlist per night (no deletes = half the API quota of
     rewriting one); the last 14 stay up, each Past night keeps its own.

The editor also names a BENCH for each shelf (and two runner-up picks): the
next-best items in that lane, same rules, same reasons. The page keeps them
folded — one "show more" per shelf, and a reader's ✕ on a pick swaps the
editor's next alternate in — so the page stays finite but never dead-ends.
The bench never goes to the playlist and is not remembered as "shown".

Memory lives on the branch too: data/tv-history.json remembers what the
page showed (so old gold and vault rotate instead of repeating),
data/tv-editions.json keeps the last two weeks of editions for the page's
"Past nights" strip, and the reader reactions table in Supabase
(supabase/tv.sql) feeds back "watched / not for me / more like this" as
signals — all of it fails soft.

Failure posture, same as the siblings: no key, no candidates, or any API
trouble logs and exits 0 without writing, so the workflow stays green and
the branch keeps its last good edition.

CLI:
  --out PATH       where to write (default data/btown-tv.json)
  --history PATH   the shown-id memory, read AND rewritten in place
                   (default data/tv-history.json)
  --vault PATH     enriched vault copy, read AND rewritten (default
                   data/tv-vault-live.json)
  --editions PATH  the past-editions archive, read AND rewritten
                   (default data/tv-editions.json)
  --no-playlist    page-only: don't publish a playlist (keeps the day's
                   earlier one on the button if there is one)
  --selftest       run the offline checks and exit
"""

import argparse
import hashlib
import json
import os
import re
import statistics
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "data", "btown-tv.json")
HISTORY = os.path.join(ROOT, "data", "tv-history.json")
VAULT_LIVE = os.path.join(ROOT, "data", "tv-vault-live.json")
EDITIONS = os.path.join(ROOT, "data", "tv-editions.json")
VAULT_SEED = os.path.join(ROOT, "data", "tv-vault.json")
TASTE = os.path.join(ROOT, "prompts", "tv-taste.md")
CHANNELS_FILE = os.path.join(ROOT, "data", "youtube-channels.json")

RAW = "https://raw.githubusercontent.com/btownbrief/btown-brief"
YT_URL = f"{RAW}/pulse-youtube/data/pulse-youtube.json"
CATALOG_URL = f"{RAW}/pulse-youtube/data/deep-catalog.json"
HISTORY_URL = f"{RAW}/btown-tv/data/tv-history.json"
VAULT_LIVE_URL = f"{RAW}/btown-tv/data/tv-vault-live.json"
EDITIONS_URL = f"{RAW}/btown-tv/data/tv-editions.json"
UA = "btown-tv/1.0"

API = "https://www.googleapis.com/youtube/v3"
SB_URL = "https://jnouvwxomrcffqwilqkq.supabase.co"
SB_KEY = "sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3"   # anon — safe

MODEL = "claude-opus-5"
WHY_MAX = 90              # the prompt's hard ceiling
WHY_KEEP = 100            # what validate() tolerates before trimming
FRESH_DAYS = 7            # an "upload" is this week's
GOLD_REST_DAYS = 30       # an old-gold pick rests this long before it can return
VAULT_REST_DAYS = 45
FRESH_REST_DAYS = 14      # a fresh pick shown once is not shown again
RERUN_MEMORY_DAYS = 60
HISTORY_KEEP_DAYS = 120
CLIP_RATIO = 0.35         # under this share of the channel's median = a clip
CLIP_FLOOR_SEC = 120      # under two minutes is a clip regardless of the channel
SETTLE_MIN_SEC = 20 * 60
QUICK_MIN_SEC = 5 * 60
QUICK_MAX_SEC = 12 * 60
PER_CHANNEL_CAP = 3
MAX_FRESH = 160
MAX_GOLD = 40
MAX_VAULT = 40
MAX_VT = 30
PLAYLIST_MAX = 50        # the page in order: pick, Settle in, Quick one, Vermont, ...
PLAYLISTS_KEEP = 14      # one playlist per night; older ones are deleted (= EDITIONS_KEEP)
PAGE_URL = "https://guide.btownbrief.com/tv.html"
MORE_PER_SHELF = 6       # the bench: alternates the editor names per shelf
MORE_PICKS = 2           # runner-up Tonight's picks
MORE_CHANNEL_CAP = 2     # per channel, within the bench
EDITIONS_KEEP = 14       # past editions kept for the page's archive strip
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
# Reader-signal thresholds. While the audience is small, ONE reader's ✕ is
# enough to keep a video off the page and one ♥ marks a channel LOVED —
# otherwise the taps do nothing and the loop never closes. Raise these as
# readers arrive (the SQL counts distinct players, so they scale cleanly).
SKIP_MIN = 1             # distinct readers saying "not for me" on a video
LOVED_MIN = 1            # distinct readers saying "more like this" on a channel
PASSED_MIN = 3           # distinct readers saying "not for me" on a channel

SHELVES = [
    # key, title, subtitle, how many the editor should pick (~50 on the page
    # with the pick; Stephen 8/23: "25 is too few — 50, with a show more")
    ("settle", "Settle in", "Twenty minutes and up — the couch episode", 9),
    ("quick", "Quick one", "Five to twelve minutes", 9),
    ("vt", "Burlington & Vermont", "Filmed here, made here, about here", 8),
    ("vault", "From the Vault", "Timeless — pulled from thirteen years of saves", 8),
    ("gold", "Old gold", "The back catalog of the channels we follow", 8),
    ("bench", "From the bench", "Channels that rarely post — and just did", 6),
]
SHELF_KEYS = [shelf[0] for shelf in SHELVES]

PROMO_RE = re.compile(
    r"#shorts?\b|\btrailer\b|\bteaser\b|\bpreview\b|\bpromo\b|\bsneak peek\b"
    r"|\bfirst look\b|\bcoming soon\b|\bwebcam\b|\bsky ?watch\b|\bsnow stake\b"
    r"|\blive cam\b|\bcam:|\bclips? from\b|\bbehind the scenes\b|\bbloopers?\b"
    r"|\bannouncement\b|\bofficial video\b.*\bout now\b|\bpodcast clip\b"
    r"|\bhighlights?\b|\brecap\b|\bfull episode\b.*\b(19|20)\d\d\b|\brerun\b"
    r"|\bre-?upload\b|\bq&a\b|\bask me anything\b",
    re.I)
HASHTAG_RE = re.compile(r"(?:^|\s)#\w+")
LIVE_RE = re.compile(r"🔴|\blive\b|\bstream\b", re.I)


def utcnow():
    return datetime.now(timezone.utc)


def trim(value, limit):
    value = re.sub(r"\s+", " ", value or "").strip()
    if len(value) <= limit:
        return value
    cut = value[:limit - 1].rsplit(" ", 1)[0] or value[:limit - 1]
    return cut.rstrip(" ,.;:-") + "…"


def dur_seconds(fmt):
    """'1:02:03' / '4:05' -> seconds; None for LIVE / unknown."""
    if not fmt or fmt == "LIVE":
        return None
    try:
        parts = [int(part) for part in fmt.split(":")]
    except ValueError:
        return None
    while len(parts) < 3:
        parts.insert(0, 0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def fmt_seconds(seconds):
    if seconds is None:
        return ""
    hours, rest = divmod(int(seconds), 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def title_key(title):
    return re.sub(r"[^a-z0-9]+", " ", (title or "").lower()).strip()


def http_json(url, timeout=30, headers=None, data=None, method=None):
    request = urllib.request.Request(
        url, data=data, method=method,
        headers=dict({"User-Agent": UA}, **(headers or {})))
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
    return json.loads(raw) if raw else None


FETCH_FAILED = object()   # sentinel: "the fetch broke", as opposed to "not there"


def fetch_optional(url, default, strict=False):
    """A 404 means the branch genuinely lacks the file -> default. Any other
    trouble is a transient failure; with strict=True that returns the
    FETCH_FAILED sentinel so callers can refuse to overwrite memory they
    couldn't read (a CDN blip must never wipe 120 days of history)."""
    try:
        return http_json(url)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return default
        print(f"curate_tv: fetch failed {url.rsplit('/', 1)[-1]} (HTTP {exc.code})",
              file=sys.stderr)
        return FETCH_FAILED if strict else default
    except Exception as exc:  # noqa: BLE001 — optional inputs fail soft
        print(f"curate_tv: fetch failed {url.rsplit('/', 1)[-1]} ({exc})",
              file=sys.stderr)
        return FETCH_FAILED if strict else default


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as src:
            return json.load(src)
    except (OSError, ValueError):
        return default


def write_json(path, value):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as dst:
        json.dump(value, dst, separators=(",", ":"), ensure_ascii=False)
        dst.write("\n")
    os.replace(tmp, path)   # never leave a half-written file for the push step


# ----------------------------------------------------------------------
# Memory: what the page already showed
# ----------------------------------------------------------------------

def history_index(history, now_ts):
    """{video id: last shown ts} and {title key: last shown ts}, pruned."""
    keep_after = now_ts - HISTORY_KEEP_DAYS * 86400
    shown = {}
    titles = {}
    for entry in history.get("shown", []):
        ts = int(entry.get("ts") or 0)
        if ts < keep_after:
            continue
        vid = entry.get("id")
        if vid:
            shown[vid] = max(ts, shown.get(vid, 0))
        key = entry.get("tk")
        if key:
            titles[key] = max(ts, titles.get(key, 0))
    return shown, titles


def remember(history, items, now_ts):
    keep_after = now_ts - HISTORY_KEEP_DAYS * 86400
    shown = [entry for entry in history.get("shown", [])
             if int(entry.get("ts") or 0) >= keep_after]
    for item in items:
        shown.append({"id": item["id"], "tk": title_key(item["t"]),
                      "ts": now_ts, "shelf": item.get("shelf", "")})
    return {"v": 1, "shown": shown}


# ----------------------------------------------------------------------
# Reader signals (Supabase, fails soft)
# ----------------------------------------------------------------------

def fetch_signals(days=21):
    """{'skip': {vid: n}, 'watched': {vid: n}, 'more': {channel: n}}."""
    empty = {"skip": {}, "watched": {}, "more": {}, "skip_ch": {}}
    try:
        headers = {"apikey": SB_KEY, "Content-Type": "application/json"}
        rows = http_json(f"{SB_URL}/rest/v1/rpc/tv_signals", timeout=15,
                         headers=headers,
                         data=json.dumps({"p_days": days}).encode("utf-8"),
                         method="POST")
    except Exception as exc:  # noqa: BLE001 — the table may not exist yet
        print(f"curate_tv: no reader signals ({exc})", file=sys.stderr)
        return empty
    if not isinstance(rows, list):
        return empty
    out = {"skip": {}, "watched": {}, "more": {}, "skip_ch": {}}
    for row in rows:
        kind = row.get("kind")
        n = int(row.get("n") or 0)
        if kind in ("skip", "watched") and row.get("vid"):
            out[kind][row["vid"]] = n
            if kind == "skip" and row.get("channel"):
                ch = row["channel"]
                out["skip_ch"][ch] = out["skip_ch"].get(ch, 0) + n
        elif kind == "more" and row.get("channel"):
            out["more"][row["channel"]] = n
    return out


# ----------------------------------------------------------------------
# Candidates + gates
# ----------------------------------------------------------------------

def channel_medians(videos, catalog):
    """Median upload length per channel, from the back catalog plus this
    week's uploads — the yardstick that tells a trailer from an episode."""
    lengths = {}
    for entry in (catalog or {}).values():
        for video in entry.get("videos", []):
            sec = dur_seconds(video.get("dur"))
            if sec:
                lengths.setdefault(video.get("ch", ""), []).append(sec)
    for video in videos:
        sec = dur_seconds(video.get("dur"))
        if sec and not video.get("dc"):
            lengths.setdefault(video.get("ch", ""), []).append(sec)
    return {ch: statistics.median(secs) for ch, secs in lengths.items()
            if len(secs) >= 3}


def catalog_title_keys(catalog):
    keys = {}
    for entry in (catalog or {}).values():
        for video in entry.get("videos", []):
            keys.setdefault(video.get("ch", ""), set()).add(
                title_key(video.get("t")))
    return keys


def gate(videos, catalog, history, signals, now_ts, roster_g):
    """Split the payload into pools and a tally of what was dropped and why."""
    shown, shown_titles = history_index(history, now_ts)
    medians = channel_medians(videos, catalog)
    old_titles = catalog_title_keys(catalog)
    rerun_after = now_ts - RERUN_MEMORY_DAYS * 86400
    fresh_after = now_ts - FRESH_DAYS * 86400

    fresh, gold, vt, live = [], [], [], []
    dropped = {}
    per_channel = {}
    uploads_this_week = {}
    for video in videos:
        if not video.get("dc") and (video.get("d") or 0) >= fresh_after:
            uploads_this_week[video.get("ch", "")] = \
                uploads_this_week.get(video.get("ch", ""), 0) + 1

    def drop(reason):
        dropped[reason] = dropped.get(reason, 0) + 1

    seen_ids = set()
    for video in videos:
        vid = video.get("id")
        title = video.get("t") or ""
        if not vid or not title or vid in seen_ids:
            continue
        seen_ids.add(vid)
        ch = video.get("ch") or ""
        sec = dur_seconds(video.get("dur"))
        item = {
            "id": vid, "t": title[:200], "ch": ch[:60], "d": video.get("d"),
            "dur": video.get("dur") or "", "sec": sec,
            "views": video.get("views"),
            "g": video.get("g") or roster_g.get(ch, ""),
        }
        is_live = bool(video.get("lv")) or video.get("dur") == "LIVE" or \
            (sec is None and LIVE_RE.search(title))
        if is_live:
            live.append(item)
            continue
        if not VIDEO_ID_RE.match(vid):
            drop("bad-id")
            continue
        if signals["skip"].get(vid, 0) >= SKIP_MIN:
            drop("not-for-me")
            continue
        # promo shapes are banned everywhere — the deep catalog is built
        # from order=viewCount, where a channel's top hit is often a trailer
        if PROMO_RE.search(title) or (sec and sec < 180 and HASHTAG_RE.search(title)):
            drop("promo")
            continue
        if video.get("dc"):
            if shown.get(vid, 0) > now_ts - GOLD_REST_DAYS * 86400:
                drop("resting")
                continue
            item["dc"] = 1
            gold.append(item)
            continue
        # --- this week's uploads + the Vermont radar ---
        tkey = title_key(title)
        median = medians.get(ch)
        clip_under = max(CLIP_FLOOR_SEC, median * CLIP_RATIO) if median else CLIP_FLOOR_SEC
        if sec and sec < clip_under:
            drop("clip")
            continue
        if shown.get(vid, 0) > now_ts - FRESH_REST_DAYS * 86400:
            drop("shown")
            continue
        if tkey in old_titles.get(ch, ()) or \
                shown_titles.get(tkey, 0) > rerun_after:
            drop("rerun")
            continue
        if video.get("vt") or item["g"] == "vt":
            # the API radar AND the roster's Vermont channels both feed the
            # Vermont shelf — the radar alone is mostly realty listings
            item["vt"] = 1
            vt.append(item)
            continue
        n = per_channel.get(ch, 0)
        if n >= PER_CHANNEL_CAP:
            drop("channel-cap")
            continue
        per_channel[ch] = n + 1
        if uploads_this_week.get(ch, 0) <= 1:
            item["rare"] = 1
        fresh.append(item)

    fresh.sort(key=lambda v: (v.get("d") or 0), reverse=True)
    gold.sort(key=lambda v: (v.get("views") or 0), reverse=True)
    vt.sort(key=lambda v: (v.get("d") or 0), reverse=True)
    return {"fresh": fresh[:MAX_FRESH], "gold": gold[:MAX_GOLD],
            "vt": vt[:MAX_VT], "live": live[:12]}, dropped


def vault_candidates(vault_live, history, now_ts):
    shown, _ = history_index(history, now_ts)
    rest_after = now_ts - VAULT_REST_DAYS * 86400
    pool = [dict(item, vault=1) for item in vault_live.get("items", [])
            if item.get("id") and item.get("alive", True)
            and shown.get(item["id"], 0) <= rest_after]
    # a little rotation so the model doesn't see the same forty every day:
    # order by how long ago the item was last shown (never-shown first),
    # then by a day-seeded shuffle
    day = now_ts // 86400
    pool.sort(key=lambda v: (shown.get(v["id"], 0), int(hashlib.md5(
        f"{v['id']}{day}".encode()).hexdigest()[:8], 16)))
    return pool[:MAX_VAULT]


def seed_as_live(seed):
    """The hand-curated seed is usable without the API — it only lacks
    durations and views. Used when there's no key and no enriched copy yet."""
    return {"v": 1, "checked": 0,
            "items": [dict(item, alive=True) for item in seed.get("items", [])
                      if item.get("id")]}


# ----------------------------------------------------------------------
# The vault: enrich the seed list with the API (durations, views, alive)
# ----------------------------------------------------------------------

def refresh_vault(seed, live, key, now_ts):
    """Seed (public list in the repo) + API -> enriched live copy. Costs one
    quota unit per fifty videos; re-checks everything weekly."""
    items = seed.get("items", [])
    if not items:
        return live
    prior = {item["id"]: item for item in live.get("items", [])
             if item.get("id")}
    if live.get("checked") and now_ts - int(live["checked"]) < 6 * 86400 and \
            all(item["id"] in prior for item in items):
        return live
    if not key:
        return live if live.get("items") else seed_as_live(seed)
    out = []
    for start in range(0, len(items), 50):
        batch = items[start:start + 50]
        query = urllib.parse.urlencode({
            "part": "contentDetails,statistics,status",
            "id": ",".join(item["id"] for item in batch), "key": key})
        try:
            details = http_json(f"{API}/videos?{query}").get("items", [])
        except Exception as exc:  # noqa: BLE001
            print(f"curate_tv: vault enrich trouble ({exc})", file=sys.stderr)
            return live if live.get("items") else seed_as_live(seed)
        by_id = {d.get("id"): d for d in details}
        for item in batch:
            detail = by_id.get(item["id"])
            entry = dict(item)
            if not detail:
                entry["alive"] = False
            else:
                status = detail.get("status") or {}
                entry["alive"] = status.get("privacyStatus") == "public"
                iso = (detail.get("contentDetails") or {}).get("duration") or ""
                sec = iso_seconds(iso)
                entry["sec"] = sec
                entry["dur"] = fmt_seconds(sec) if sec else ""
                entry["views"] = int(
                    (detail.get("statistics") or {}).get("viewCount") or 0)
            out.append(entry)
    return {"v": 1, "checked": now_ts, "items": out}


ISO_RE = re.compile(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def iso_seconds(iso):
    match = ISO_RE.fullmatch(iso or "")
    if not match:
        return None
    hours, minutes, seconds = (int(part or 0) for part in match.groups())
    return hours * 3600 + minutes * 60 + seconds


# ----------------------------------------------------------------------
# The editor
# ----------------------------------------------------------------------

SCHEMA = {
    "type": "object",
    "properties": {
        "pick": {
            "type": "object",
            "properties": {"i": {"type": "integer"}, "why": {"type": "string"}},
            "required": ["i", "why"],
            "additionalProperties": False,
        },
        "shelves": {
            "type": "object",
            "properties": {
                key: {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"i": {"type": "integer"},
                                       "why": {"type": "string"}},
                        "required": ["i", "why"],
                        "additionalProperties": False,
                    },
                } for key in SHELF_KEYS
            },
            "required": SHELF_KEYS,
            "additionalProperties": False,
        },
        "more": {
            "type": "object",
            "properties": {
                key: {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"i": {"type": "integer"},
                                       "why": {"type": "string"}},
                        "required": ["i", "why"],
                        "additionalProperties": False,
                    },
                } for key in ["pick"] + SHELF_KEYS
            },
            "required": ["pick"] + SHELF_KEYS,
            "additionalProperties": False,
        },
        "note": {"type": "string"},
    },
    "required": ["pick", "shelves", "more", "note"],
    "additionalProperties": False,
}

PROMPT_RULES = """
You are the editor of BTown TV, a once-a-day curated page of YouTube videos \
for people in Burlington, Vermont who would rather have a human choose what \
to watch tonight than scroll the algorithm. The page is finite: one \
Tonight's pick and six shelves, about fifty videos on a good night. \
Everything on it is there because you chose it and can say why.

Below is the taste doctrine, then the numbered candidates. Candidates are \
grouped: FRESH (this week's uploads from channels we follow), VERMONT (the \
local radar), VAULT (timeless videos from thirteen years of the editor's own \
saves), GOLD (each followed channel's all-time best). Every candidate line \
carries its channel, length, views, and age. Lines marked RARE are from \
channels that seldom post — those are the only valid picks for the bench \
shelf. Lines marked LOVED are from channels readers asked for more of. Lines \
marked PASSED are from channels readers keep marking "not for me" — pick one \
only if it is clearly the best thing in its lane tonight.

Pick BY INDEX ONLY:
  * pick — the single Tonight's pick. Usually FRESH or VERMONT, 8–40 minutes,
    the one video you'd text a friend about. If nothing fresh is worth it,
    promote a VAULT or GOLD item rather than pick a weak fresh one.
  * settle — {settle} items, all 20 minutes or longer. The couch episode.
  * quick — {quick} items, 5 to 12 minutes.
  * vt — {vt} VERMONT items (fewer if the radar is thin — never pad it).
  * vault — {vault} VAULT items, varied across lanes.
  * gold — {gold} GOLD items.
  * bench — {bench} RARE items (fewer if there aren't enough; never
    pick a non-RARE line here).
No video appears twice across the page. At most two items per channel \
across the whole page. Balance subjects — a page of six space videos is \
not a balanced page. Prefer substance over noise, access over takes, and \
videos that feel whole over fragments.

Then name the BENCH in `more`: for each shelf, up to {more} further items \
you would stand behind in that lane — the next-best, same length rules, \
same standard, not leftovers — and under `more.pick`, up to {more_picks} \
runner-up Tonight's picks. The page keeps the bench folded; it shows when a \
reader asks for more or hides one of your picks, so these must be real \
choices with real reasons. Nothing from the page repeats on the bench. The \
bench has its own allowance of two items per channel (separate from the \
page's two). Lane rules apply unchanged: settle 20 minutes and up, quick \
5–12 minutes, vt only VERMONT lines, vault only VAULT, gold only GOLD, \
bench only RARE; a shelf you left empty gets no bench. Fewer if the field \
is thin; never pad. An empty list is fine.

For each pick write a reason of {why_max} characters or less, written for a \
viewer deciding whether to press play — not for an editor. Titles are used \
verbatim on the page; never rewrite one. In `note`, one sentence (for the \
log, not the page) on what today's field looked like.
""".strip()


def load_taste(path=TASTE):
    try:
        with open(path, encoding="utf-8") as src:
            return src.read().strip()
    except OSError:
        return "(no taste doctrine found — use good judgment)"


def age_label(ts, now_ts):
    if not ts:
        return ""
    days = max(0, (now_ts - int(ts)) // 86400)
    if days == 0:
        return "today"
    if days < 30:
        return f"{days}d"
    if days < 365:
        return f"{days // 30}mo"
    return f"{days // 365}y"


def format_candidates(pools, signals, now_ts):
    """Numbered lines + the index -> item map."""
    lines, index = [], []
    loved = {ch for ch, n in signals.get("more", {}).items() if n >= LOVED_MIN}
    passed = {ch for ch, n in signals.get("skip_ch", {}).items() if n >= PASSED_MIN}
    for group, key in (("FRESH", "fresh"), ("VERMONT", "vt"),
                       ("VAULT", "vault"), ("GOLD", "gold")):
        items = pools.get(key) or []
        if not items:
            continue
        lines.append(f"\n== {group} ==")
        for item in items:
            i = len(index)
            index.append((key, item))
            flags = []
            if item.get("rare"):
                flags.append("RARE")
            if item.get("ch") in loved:
                flags.append("LOVED")
            if item.get("ch") in passed:
                flags.append("PASSED")
            if item.get("lane"):
                flags.append(item["lane"])
            views = item.get("views")
            views_s = f"{views/1e6:.1f}M" if views and views >= 1e6 else \
                (f"{views//1000}k" if views and views >= 1000 else
                 (str(views) if views else "?"))
            lines.append(
                f"{i}. [{item.get('ch','')}] {item['t']} · {item.get('dur') or '?'} "
                f"· {views_s} views · {age_label(item.get('d'), now_ts)}"
                + (f" · {' '.join(flags)}" if flags else ""))
    return "\n".join(lines), index


def build_prompt(taste, candidate_text):
    counts = {shelf[0]: shelf[3] for shelf in SHELVES}
    rules = PROMPT_RULES.format(why_max=WHY_MAX, more=MORE_PER_SHELF,
                                more_picks=MORE_PICKS, **counts)
    return (f"{rules}\n\n=== TASTE DOCTRINE ===\n{taste}\n\n"
            f"=== CANDIDATES ===\n{candidate_text}\n")


def ask_model(prompt):
    import anthropic

    client = anthropic.Anthropic()
    # streamed because the SDK refuses a non-streaming call this long;
    # reasoning counts toward max_tokens and a full pool + the bench blew
    # through 16k on 8/23
    with client.messages.stream(
        model=MODEL,
        max_tokens=48000,
        output_config={"format": {"type": "json_schema", "schema": SCHEMA},
                       "effort": "high"},
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        response = stream.get_final_message()
    if response.stop_reason == "refusal":
        raise RuntimeError("the model declined to answer")
    if response.stop_reason == "max_tokens":
        raise RuntimeError("response truncated at max_tokens")
    text = next(block.text for block in response.content if block.type == "text")
    return json.loads(text)


def validate(raw, index):
    """Model output -> (pick, shelves, more); silently drops anything that
    breaks the rules (bad index, duplicate, wrong length for the shelf,
    non-RARE on the bench, a third item from one channel). `more` is the
    folded bench: {"pick": [...], shelf: [...]} — same rules, its own
    per-channel cap (two across the whole bench, separate from the page's
    two), never overlapping the page."""
    used = set()
    per_channel = {}
    counts = {shelf[0]: shelf[3] for shelf in SHELVES}

    def take(entry, shelf, per_channel=per_channel, cap=2):
        try:
            i = int(entry.get("i"))
        except (TypeError, ValueError):
            return None
        if i < 0 or i >= len(index):
            return None
        pool, item = index[i]
        if item["id"] in used or not VIDEO_ID_RE.match(item["id"]):
            return None
        sec = item.get("sec")
        if shelf == "settle" and (not sec or sec < SETTLE_MIN_SEC):
            return None
        if shelf == "quick" and (not sec or sec < QUICK_MIN_SEC or sec > QUICK_MAX_SEC):
            return None
        if shelf == "vt" and pool != "vt":
            return None
        if shelf == "vault" and pool != "vault":
            return None
        if shelf == "gold" and pool != "gold":
            return None
        if shelf == "bench" and not item.get("rare"):
            return None
        ch = item.get("ch", "")
        if per_channel.get(ch, 0) >= cap:
            return None
        why = trim(str(entry.get("why") or ""), WHY_KEEP)
        if not why:
            return None
        used.add(item["id"])
        per_channel[ch] = per_channel.get(ch, 0) + 1
        out = {k: v for k, v in item.items()
               if k in ("id", "t", "ch", "d", "dur", "views", "g", "lane",
                        "vt", "dc", "vault")}
        out["why"] = why
        out["shelf"] = shelf
        return out

    pick = take(raw.get("pick") or {}, "pick")
    shelves = {}
    for key in SHELF_KEYS:
        kept = []
        for entry in (raw.get("shelves") or {}).get(key, []) or []:
            item = take(entry, key)
            if item:
                kept.append(item)
            if len(kept) >= counts[key]:
                break
        shelves[key] = kept
    # the bench: validated after the page so it can never steal from it
    more = {}
    bench_channels = {}
    for key in ["pick"] + SHELF_KEYS:
        kept = []
        limit = MORE_PICKS if key == "pick" else MORE_PER_SHELF
        if key != "pick" and not shelves.get(key):
            more[key] = []          # no shelf on the page -> nothing to unfold
            continue
        for entry in (raw.get("more") or {}).get(key, []) or []:
            item = take(entry, key, per_channel=bench_channels, cap=MORE_CHANNEL_CAP)
            if item:
                kept.append(item)
            if len(kept) >= limit:
                break
        more[key] = kept
    return pick, shelves, more


# ----------------------------------------------------------------------
# The TV: a public playlist that mirrors the edition
# ----------------------------------------------------------------------

def oauth_access_token():
    client_id = os.environ.get("YT_OAUTH_CLIENT_ID", "").strip()
    secret = os.environ.get("YT_OAUTH_CLIENT_SECRET", "").strip()
    refresh = os.environ.get("YT_OAUTH_REFRESH_TOKEN", "").strip()
    if not (client_id and secret and refresh):
        return None
    body = urllib.parse.urlencode({
        "client_id": client_id, "client_secret": secret,
        "refresh_token": refresh, "grant_type": "refresh_token"}).encode()
    token = http_json("https://oauth2.googleapis.com/token", data=body,
                      headers={"Content-Type": "application/x-www-form-urlencoded"},
                      method="POST")
    return (token or {}).get("access_token")


def playlist_title(edition):
    """'BTown TV — Sat, Aug 23' from the edition label."""
    try:
        day = datetime.strptime(edition, "%Y-%m-%d")
        return f"BTown TV — {day.strftime('%a, %b')} {day.day}"
    except ValueError:
        return f"BTown TV — {edition}"


def publish_playlist(video_ids, edition, replace_id=None, token=None, http=None):
    """One NEW public playlist per night holding tonight's page in order;
    returns its id (None = the TV has nothing tonight).

    Why a new playlist every night instead of rewriting one: the API charges
    50 units per insert AND per delete, so rewriting a 50-video playlist is
    ~5,000 of the 10k/day quota shared with refresh_youtube — too much.
    Creating one (50) + 50 inserts (2,500) with no deletes is half that,
    and every Past night keeps a playable playlist. The first insert is the
    probe: if it fails (quota, auth) the empty playlist is removed and the
    caller keeps whatever it had. A same-day rerun passes the day's earlier
    playlist as replace_id; it is deleted only after the new one is full.
    Old nights are pruned separately (prune_playlists)."""
    http = http or http_json
    token = token or oauth_access_token()
    if not token:
        print("curate_tv: playlist publish skipped (no OAuth)")
        return None
    auth = {"Authorization": f"Bearer {token}",
            "Content-Type": "application/json"}
    wanted = [vid for vid in dict.fromkeys(video_ids) if VIDEO_ID_RE.match(vid)][:PLAYLIST_MAX]
    if not wanted:
        return None
    body = json.dumps({
        "snippet": {"title": playlist_title(edition)[:150],
                    "description": ("Tonight's edition of BTown TV — a curated page of "
                                    "videos for Burlington, Vermont, in the order the editor "
                                    f"put them. The page: {PAGE_URL}")[:5000]},
        "status": {"privacyStatus": "public"}}).encode()
    try:
        created = http(f"{API}/playlists?part=snippet,status", headers=auth,
                       data=body, method="POST") or {}
    except urllib.error.HTTPError as exc:
        print(f"curate_tv: playlist create -> HTTP {exc.code}", file=sys.stderr)
        return None
    new_id = created.get("id")
    if not new_id:
        print("curate_tv: playlist create returned no id", file=sys.stderr)
        return None
    inserted, failures = 0, 0
    for vid in wanted:
        body = json.dumps({"snippet": {
            "playlistId": new_id,
            "resourceId": {"kind": "youtube#video", "videoId": vid}}}).encode()
        try:
            http(f"{API}/playlistItems?part=snippet", headers=auth,
                 data=body, method="POST")
            inserted += 1
            failures = 0
        except urllib.error.HTTPError as exc:
            # one private/deleted video refuses insertion — skip; three in a
            # row means quota or auth is gone — stop burning the budget
            failures += 1
            print(f"curate_tv: playlist insert {vid} -> HTTP {exc.code}",
                  file=sys.stderr)
            if failures >= 3:
                print("curate_tv: playlist publish aborted after 3 straight failures",
                      file=sys.stderr)
                break
    if inserted == 0:
        print("curate_tv: playlist publish inserted nothing — removing the empty one")
        delete_playlist(new_id, token, http)
        return None
    if replace_id and replace_id != new_id:
        delete_playlist(replace_id, token, http)     # the same day's earlier run
    print(f"curate_tv: playlist published {new_id} -> {inserted}/{len(wanted)} videos")
    return new_id


def delete_playlist(playlist_id, token, http=None):
    """50 units; fails soft (a playlist someone already removed is fine)."""
    http = http or http_json
    if not (playlist_id and token):
        return False
    try:
        http(f"{API}/playlists?id={urllib.parse.quote(playlist_id)}",
             headers={"Authorization": f"Bearer {token}"}, method="DELETE")
        return True
    except urllib.error.HTTPError as exc:
        print(f"curate_tv: playlist delete {playlist_id} -> HTTP {exc.code}",
              file=sys.stderr)
        return False


def prune_playlists(dropped_editions, token=None, http=None):
    """Editions that just fell out of the archive take their playlists with
    them. Called after archive_edition; fails soft."""
    token = token or oauth_access_token()
    if not token:
        return 0
    n = 0
    for entry in dropped_editions:
        pid = ((entry or {}).get("playlist") or {}).get("id")
        if pid and delete_playlist(pid, token, http):
            n += 1
    if n:
        print(f"curate_tv: pruned {n} old playlist(s)")
    return n


# ----------------------------------------------------------------------
# Run
# ----------------------------------------------------------------------

EDITION_TZ = timezone(timedelta(hours=-4))


def edition_label(now):
    """'Tonight' is the daily 5pm edition; a dispatch earlier in the day is
    still tonight's page, just early."""
    return now.astimezone(EDITION_TZ).strftime("%Y-%m-%d")


def forget_today(history, now):
    """A rerun on the same edition day REPLACES that day's edition — it must
    not treat the earlier run's picks as 'shown' and rest them, or every
    dispatch thins the pool for the next one (8/23: a second run the same
    day could not re-pick the morning's six Vermont videos and the local
    shelf fell to two). Drops today's entries; yesterday and older stay."""
    day_start = int(now.astimezone(EDITION_TZ).replace(
        hour=0, minute=0, second=0, microsecond=0).timestamp())
    shown = [e for e in history.get("shown", []) if int(e.get("ts") or 0) < day_start]
    return {"v": 1, "shown": shown}


def build_payload(pick, shelves, live, generated, stats, playlist_id, more=None):
    more = more or {}
    shelf_out = []
    for key, title, sub, _ in SHELVES:
        items = shelves.get(key) or []
        if items:
            shelf_out.append({"key": key, "title": title, "sub": sub,
                              "items": items, "more": more.get(key) or []})
    return {
        "v": 1,
        "generated": generated.replace(microsecond=0).isoformat(),
        "edition": edition_label(generated),
        "pick": pick,
        "pick_more": more.get("pick") or [],
        "shelves": shelf_out,
        "live": live[:8],
        "playlist": ({"id": playlist_id,
                      "url": f"https://www.youtube.com/playlist?list={playlist_id}"}
                     if playlist_id else None),
        "stats": stats,
    }


ARCHIVE_FIELDS = ("id", "t", "ch", "d", "dur", "views", "g", "lane", "why", "shelf")


def archive_edition(editions, payload):
    """Prepend tonight's edition to the archive (compact: the pick, the
    shelves and the night's playlist — no bench/live/stats), replacing any
    earlier entry for the same edition date (a dispatch re-run) and keeping
    the newest EDITIONS_KEEP. Returns (archive, entries that fell out) so
    their playlists can be pruned."""
    def slim(item):
        return {k: v for k, v in item.items() if k in ARCHIVE_FIELDS}
    entry = {
        "edition": payload["edition"],
        "generated": payload["generated"],
        "pick": slim(payload["pick"]) if payload.get("pick") else None,
        "playlist": payload.get("playlist"),
        "shelves": [{"key": s["key"], "title": s["title"],
                     "items": [slim(i) for i in s["items"]]}
                    for s in payload.get("shelves", []) if s.get("items")],
    }
    prior = [e for e in (editions or {}).get("editions", [])
             if isinstance(e, dict) and e.get("edition")]
    same_day = [e for e in prior if e["edition"] == entry["edition"]]
    kept = [e for e in prior if e["edition"] != entry["edition"]]
    kept.insert(0, entry)
    kept.sort(key=lambda e: e["edition"], reverse=True)
    fell_out = kept[EDITIONS_KEEP:]
    # a same-day earlier entry whose playlist differs is gone too (publish
    # already deleted it when it replaced it; listing it here is harmless)
    for e in same_day:
        if (e.get("playlist") or {}).get("id") and \
                (e.get("playlist") or {}).get("id") != (entry.get("playlist") or {}).get("id"):
            fell_out.append(e)
    return {"v": 1, "editions": kept[:EDITIONS_KEEP]}, fell_out


def same_day_playlist(editions, edition):
    """The playlist id the archive recorded for this edition day, if any."""
    for e in (editions or {}).get("editions", []) if isinstance(editions, dict) else []:
        if isinstance(e, dict) and e.get("edition") == edition:
            return ((e.get("playlist") or {}).get("id")) or None
    return None


def run(args):
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("curate_tv: no ANTHROPIC_API_KEY — nothing to do")
        return
    key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    now = utcnow()
    now_ts = int(now.timestamp())

    payload = fetch_optional(YT_URL, None)
    videos = (payload or {}).get("videos") or []
    if len(videos) < 20:
        print("curate_tv: too few videos on the pulse-youtube branch — skipping")
        return
    catalog = (fetch_optional(CATALOG_URL, {}) or {}).get("channels") or {}
    history = read_json(args.history, None)
    if history is None:
        history = fetch_optional(HISTORY_URL, {}, strict=True)
        if history is FETCH_FAILED:
            print("curate_tv: could not read the edition memory — not risking "
                  "a rewrite, skipping this run")
            return
    history = forget_today(history, now)
    vault_live = read_json(args.vault, None)
    if vault_live is None:
        vault_live = fetch_optional(VAULT_LIVE_URL, {}, strict=True)
        if vault_live is FETCH_FAILED:
            vault_live = {}          # re-enriched from the seed below; not memory
    vault_seed = read_json(VAULT_SEED, {}) or {}
    editions = read_json(args.editions, None)
    if editions is None:
        editions = fetch_optional(EDITIONS_URL, {}, strict=True)
        if editions is FETCH_FAILED:
            # the archive is memory too: never rebuild it from nothing on a
            # transient failure — skip writing it this run (the workflow
            # carries the branch's copy forward)
            editions = FETCH_FAILED
    signals = fetch_signals()
    roster_g = {ch.get("name", ""): ch.get("g", "")
                for ch in (read_json(CHANNELS_FILE, {}) or {}).get("channels", [])}

    try:
        vault_live = refresh_vault(vault_seed, vault_live, key, now_ts)
        if vault_live.get("items"):
            write_json(args.vault, vault_live)
    except Exception as exc:  # noqa: BLE001
        print(f"curate_tv: vault refresh trouble ({exc})", file=sys.stderr)

    pools, dropped = gate(videos, catalog, history, signals, now_ts, roster_g)
    pools["vault"] = vault_candidates(vault_live, history, now_ts)
    print("curate_tv: candidates "
          + ", ".join(f"{k}={len(v)}" for k, v in pools.items())
          + " · dropped " + json.dumps(dropped))
    if len(pools["fresh"]) + len(pools["gold"]) + len(pools["vault"]) < 12:
        print("curate_tv: not enough candidates for an edition — skipping")
        return

    text, index = format_candidates(pools, signals, now_ts)
    prompt = build_prompt(load_taste(), text)
    try:
        raw = ask_model(prompt)
    except Exception as exc:  # noqa: BLE001 — keep the last good edition
        print(f"curate_tv: model trouble ({exc})", file=sys.stderr)
        return
    pick, shelves, more = validate(raw, index)
    picked = sum(len(v) for v in shelves.values()) + (1 if pick else 0)
    benched = sum(len(v) for v in more.values())
    offered = {k: len(v or []) for k, v in (raw.get("more") or {}).items()}
    print("curate_tv: bench offered/kept "
          + " ".join(f"{k}={offered.get(k, 0)}/{len(more.get(k, []))}" for k in ["pick"] + SHELF_KEYS))
    if not pick or picked < 8:
        print(f"curate_tv: the editor returned too little ({picked}) — skipping")
        return
    print(f"curate_tv: picked {picked} · bench {benched} · "
          f"{trim(str(raw.get('note','')), 200)}")

    stats = {"candidates": {k: len(v) for k, v in pools.items() if k != "live"},
             "dropped": dropped, "picked": picked, "bench": benched}
    ordered = [pick] + [item for key in SHELF_KEYS for item in shelves.get(key, [])]
    label = edition_label(now)
    today_pl = same_day_playlist(editions, label) if editions is not FETCH_FAILED else None

    # the edition and its memory are written BEFORE the ~50-request playlist
    # publish, so a job killed mid-way never leaves the page a day behind.
    # A page-only rerun keeps the day's earlier playlist (still tonight's
    # date, slightly stale) rather than hide the button.
    playlist_id = today_pl if args.no_playlist else None
    edition = build_payload(pick, shelves, pools["live"], now, stats,
                            playlist_id or "", more)
    write_json(args.out, edition)
    write_json(args.history, remember(history, ordered, now_ts))
    print(f"curate_tv: edition {label} -> {args.out}")

    fell_out = []
    if not args.no_playlist:
        try:
            playlist_id = publish_playlist([item["id"] for item in ordered], label,
                                           replace_id=today_pl)
        except Exception as exc:  # noqa: BLE001
            print(f"curate_tv: playlist trouble ({exc})", file=sys.stderr)
            playlist_id = None
        if not playlist_id:
            # nothing publishable tonight: fall back to the day's earlier
            # playlist if there is one, else no button
            playlist_id = today_pl
        edition = build_payload(pick, shelves, pools["live"], now, stats,
                                playlist_id or "", more)
        write_json(args.out, edition)

    if editions is not FETCH_FAILED:
        try:
            archive, fell_out = archive_edition(editions, edition)
            write_json(args.editions, archive)
        except Exception as exc:  # noqa: BLE001 — the archive is a nicety, never the run
            print(f"curate_tv: archive trouble ({exc}) — left alone", file=sys.stderr)
    else:
        print("curate_tv: could not read the editions archive — left alone")
    if fell_out and not args.no_playlist:
        try:
            prune_playlists([e for e in fell_out
                             if ((e.get("playlist") or {}).get("id")) != playlist_id
                             and ((e.get("playlist") or {}).get("id")) != today_pl])
        except Exception as exc:  # noqa: BLE001
            print(f"curate_tv: playlist prune trouble ({exc})", file=sys.stderr)


# ----------------------------------------------------------------------
# Selftest — offline
# ----------------------------------------------------------------------

def selftest():
    now_ts = 1_800_000_000
    day = 86400
    catalog = {"UC1": {"videos": [
        {"id": "old0000000" + str(i), "t": f"Classic episode {i}", "ch": "Kurz",
         "dur": "12:00", "views": 1_000_000, "dc": 1} for i in range(5)]}}
    videos = [
        {"id": "fresh000001", "t": "How Antidepressants Work", "ch": "Kurz",
         "d": now_ts - day, "dur": "1:18", "views": 50000},            # clip
        {"id": "fresh000002", "t": "The Long Night of the Arctic", "ch": "Kurz",
         "d": now_ts - day, "dur": "24:10", "views": 900000},          # keeper
        {"id": "fresh000003", "t": "Soldier Rations #history #cooking", "ch": "Town",
         "d": now_ts - day, "dur": "1:20", "views": 1000},             # promo
        {"id": "fresh000004", "t": "Classic episode 2", "ch": "Kurz",
         "d": now_ts - day, "dur": "12:00", "views": 10},              # rerun
        {"id": "fresh000005", "t": "WCAX SkyWatch3: Church St", "ch": "WCAX",
         "d": now_ts - day, "dur": "LIVE", "lv": 1},                   # live
        {"id": "fresh000006", "t": "A ferry ride across the lake", "ch": "Local",
         "d": now_ts - 2 * day, "dur": "8:00", "views": 400, "vt": 1}, # vermont
        {"id": "fresh000007", "t": "One upload this week", "ch": "Quiet",
         "d": now_ts - 3 * day, "dur": "31:00", "views": 4000},        # rare
        {"id": "fresh000008", "t": "Shown last week already", "ch": "Other",
         "d": now_ts - day, "dur": "9:00", "views": 4000},             # shown
        {"id": "old00000001", "t": "Classic episode 1", "ch": "Kurz",
         "d": now_ts - 900 * day, "dur": "12:00", "views": 1_000_000, "dc": 1},
        {"id": "old00000002", "t": "Classic episode 2", "ch": "Kurz",
         "d": now_ts - 900 * day, "dur": "12:00", "views": 1_000_000, "dc": 1},
    ]
    history = {"shown": [
        {"id": "fresh000008", "tk": title_key("Shown last week already"),
         "ts": now_ts - 3 * day},
        {"id": "old00000002", "tk": title_key("Classic episode 2"),
         "ts": now_ts - 2 * day}]}
    signals = {"skip": {}, "watched": {}, "more": {"Quiet": 3}}
    pools, dropped = gate(videos, catalog, history, signals, now_ts, {})
    fresh_ids = [v["id"] for v in pools["fresh"]]
    assert "fresh000001" not in fresh_ids and dropped.get("clip") == 1, dropped
    assert "fresh000003" not in fresh_ids and dropped.get("promo") == 1, dropped
    assert "fresh000004" not in fresh_ids and dropped.get("rerun") == 1, dropped
    assert "fresh000008" not in fresh_ids and dropped.get("shown") == 1, dropped
    assert fresh_ids == ["fresh000002", "fresh000007"], fresh_ids
    assert pools["live"][0]["id"] == "fresh000005"
    assert pools["vt"][0]["id"] == "fresh000006"
    assert [v["id"] for v in pools["gold"]] == ["old00000001"], pools["gold"]
    rare = {v["id"]: v.get("rare") for v in pools["fresh"]}
    assert rare["fresh000007"] == 1 and not rare["fresh000002"], rare

    vault_live = {"items": [
        {"id": "vault000001", "t": "A timeless talk", "ch": "TED", "lane": "talk",
         "dur": "18:00", "sec": 1080, "alive": True},
        {"id": "vault000002", "t": "Gone private", "ch": "X", "alive": False},
        {"id": "vault000003", "t": "Shown yesterday", "ch": "Y", "alive": True}]}
    history2 = {"shown": [{"id": "vault000003", "tk": "x", "ts": now_ts - day}]}
    vault = vault_candidates(vault_live, history2, now_ts)
    assert [v["id"] for v in vault] == ["vault000001"], vault
    pools["vault"] = vault

    text, index = format_candidates(pools, signals, now_ts)
    assert "== FRESH ==" in text and "RARE LOVED" in text, text
    assert "== VAULT ==" in text and "talk" in text
    prompt = build_prompt("Taste: be good.", text)
    assert "TASTE DOCTRINE" in prompt and "Taste: be good." in prompt

    # indices: 0 fresh000002, 1 fresh000007(rare), 2 fresh000006(vt),
    #          3 vault000001, 4 old00000001
    raw = {
        "pick": {"i": 0, "why": "The big one this week"},
        "shelves": {
            "settle": [{"i": 0, "why": "dup — dropped"}, {"i": 1, "why": "thirty-one minutes"}],
            "quick": [{"i": 2, "why": "wrong pool but right length"},
                      {"i": 99, "why": "bad index"}],
            "vt": [{"i": 2, "why": "already used above — dropped"}],
            "vault": [{"i": 3, "why": "evergreen"}, {"i": 4, "why": "gold, not vault"}],
            "gold": [{"i": 4, "why": "old gold"}],
            "bench": [{"i": 0, "why": "not rare"}],
        },
        "more": {"pick": [], "settle": [], "quick": [], "vt": [], "vault": [],
                 "gold": [], "bench": []},
        "note": "thin week",
    }
    pick, shelves, more = validate(raw, index)
    assert pick and pick["id"] == "fresh000002"
    assert all(v == [] for v in more.values()), more
    assert [v["id"] for v in shelves["settle"]] == ["fresh000007"], shelves["settle"]
    assert [v["id"] for v in shelves["quick"]] == ["fresh000006"], shelves["quick"]
    assert shelves["vt"] == [], shelves["vt"]
    assert [v["id"] for v in shelves["vault"]] == ["vault000001"]
    assert [v["id"] for v in shelves["gold"]] == ["old00000001"]
    assert shelves["bench"] == []
    assert all("why" in v and len(v["why"]) <= WHY_KEEP for v in
               [pick] + [x for s in shelves.values() for x in s])

    # --- the bench: same rules, never overlapping the page, own channel cap
    def it(i, ch, dur, **kw):
        d = {"id": f"bench{i:06d}", "t": f"Bench item {i}", "ch": ch, "dur": dur,
             "sec": dur_seconds(dur), "d": now_ts - day, "views": 10}
        d.update(kw)
        return d
    index2 = [
        ("fresh", it(0, "A", "30:00")),          # 0 page pick
        ("fresh", it(1, "A", "25:00")),          # 1 page settle
        ("fresh", it(2, "B", "8:00")),           # 2 page quick
        ("fresh", it(3, "C", "40:00")),          # 3 bench settle
        ("fresh", it(4, "C", "9:00")),           # 4 bench quick (C's 2nd bench slot)
        ("fresh", it(5, "C", "50:00")),          # 5 bench settle — C's 3rd: dropped
        ("fresh", it(6, "D", "3:00")),           # 6 too short for quick
        ("vault", it(7, "E", "12:00", vault=1)), # 7 vault
        ("gold", it(8, "F", "15:00", dc=1)),     # 8 gold
        ("vt", it(9, "G", "6:00", vt=1)),        # 9 vermont
        ("fresh", it(10, "H", "22:00", rare=1)), # 10 rare
    ]
    raw2 = {
        "pick": {"i": 0, "why": "lead"},
        "shelves": {"settle": [{"i": 1, "why": "settle"}], "quick": [{"i": 2, "why": "quick"}],
                    "vt": [], "vault": [], "gold": [{"i": 8, "why": "gold"}], "bench": []},
        "more": {
            "pick": [{"i": 0, "why": "already the pick — dropped"},
                     {"i": 10, "why": "runner-up"}],
            "settle": [{"i": 3, "why": "forty minutes"}, {"i": 1, "why": "on the page — dropped"}],
            "quick": [{"i": 4, "why": "nine minutes"}, {"i": 6, "why": "three minutes — dropped"},
                      {"i": 99, "why": "bad index"}],
            "vt": [{"i": 9, "why": "no vt shelf on the page — dropped"}],
            "vault": [{"i": 7, "why": "no vault shelf on the page — dropped"}],
            "gold": [{"i": 8, "why": "on the page already — dropped"}, {"i": 7, "why": "vault, not gold — dropped"}],
            "bench": [{"i": 10, "why": "no bench shelf on the page — dropped"}],
        },
        "note": "",
    }
    pick2, shelves2, more2 = validate(raw2, index2)
    assert pick2["id"] == "bench000000" and [v["id"] for v in shelves2["gold"]] == ["bench000008"]
    assert [v["id"] for v in more2["pick"]] == ["bench000010"], more2["pick"]
    assert [v["id"] for v in more2["settle"]] == ["bench000003"], more2["settle"]
    assert [v["id"] for v in more2["quick"]] == ["bench000004"], more2["quick"]
    assert more2["vt"] == [] and more2["vault"] == [] and more2["bench"] == [], "no shelf on the page -> no bench"
    assert more2["gold"] == [], more2["gold"]
    assert all(v["shelf"] == k for k, vs in more2.items() for v in vs)
    page_ids = {pick2["id"]} | {v["id"] for vs in shelves2.values() for v in vs}
    assert not page_ids & {v["id"] for vs in more2.values() for v in vs}, "bench overlaps the page"
    raw3 = dict(raw2, more=dict(raw2["more"], settle=[
        {"i": 3, "why": "C #1"}, {"i": 5, "why": "C #2"}], quick=[{"i": 4, "why": "C #3 — dropped"}]))
    _, _, more3 = validate(raw3, index2)
    assert [v["id"] for v in more3["settle"]] == ["bench000003", "bench000005"] and more3["quick"] == [], more3

    payload = build_payload(pick, shelves, pools["live"], utcnow(),
                            {"picked": 5}, "PLxyz", more2)
    keys = [s["key"] for s in payload["shelves"]]
    assert keys == ["settle", "quick", "vault", "gold"], keys
    assert payload["playlist"]["url"].endswith("PLxyz")
    assert payload["live"][0]["id"] == "fresh000005"
    assert payload["pick_more"][0]["id"] == "bench000010"
    by_key = {s["key"]: s for s in payload["shelves"]}
    assert [v["id"] for v in by_key["quick"]["more"]] == ["bench000004"]
    assert [v["id"] for v in by_key["settle"]["more"]] == ["bench000003"]

    # --- the editions archive: newest first, same-day re-run replaces, capped
    arch, out = archive_edition({}, payload)
    assert arch["editions"][0]["edition"] == payload["edition"] and out == []
    assert arch["editions"][0]["pick"]["id"] == "fresh000002"
    assert arch["editions"][0]["playlist"]["id"] == "PLxyz"
    assert "more" not in arch["editions"][0]["shelves"][0] and "sec" not in arch["editions"][0]["pick"]
    assert same_day_playlist(arch, payload["edition"]) == "PLxyz" and same_day_playlist(arch, "1999-01-01") is None
    arch, out = archive_edition(arch, payload)
    assert len(arch["editions"]) == 1 and out == [], "same-day re-run must replace, not append"
    payload_b = dict(payload, playlist={"id": "PLnew", "url": "u"})
    arch, out = archive_edition(arch, payload_b)
    assert arch["editions"][0]["playlist"]["id"] == "PLnew"
    assert [e["playlist"]["id"] for e in out] == ["PLxyz"], "the day's earlier playlist is reported"
    older = {"editions": [{"edition": f"2020-01-{d:02d}", "pick": None, "shelves": [],
                           "playlist": {"id": f"PL2020{d:02d}"}} for d in range(1, 21)]}
    arch, out = archive_edition(older, payload)
    assert len(arch["editions"]) == EDITIONS_KEEP and arch["editions"][0]["edition"] == payload["edition"]
    assert arch["editions"][1]["edition"] == "2020-01-20"
    assert [e["edition"] for e in out] == [f"2020-01-{d:02d}" for d in range(7, 0, -1)], [e["edition"] for e in out]

    mem = remember(history, [pick] + shelves["settle"], now_ts)
    ids = {e["id"] for e in mem["shown"]}
    assert {"fresh000002", "fresh000007", "fresh000008"} <= ids
    shown, titles = history_index(mem, now_ts)
    assert shown["fresh000002"] == now_ts
    # a same-day rerun forgets today's picks (they're being replaced), keeps older
    now_dt = datetime.fromtimestamp(now_ts, tz=timezone.utc)
    again = forget_today(mem, now_dt)
    again_ids = {e["id"] for e in again["shown"]}
    assert "fresh000002" not in again_ids and "fresh000008" in again_ids, again_ids
    assert edition_label(now_dt) == now_dt.astimezone(EDITION_TZ).strftime("%Y-%m-%d")

    # --- nightly playlist: create, insert in order, then replace the day's earlier one
    assert playlist_title("2026-08-23") == "BTown TV — Sun, Aug 23", playlist_title("2026-08-23")
    calls = []
    def fake_http(url, headers=None, data=None, method=None, timeout=30):
        calls.append((method or "GET", url, data))
        if method == "POST" and "/playlists?" in url:
            return {"id": "PLnew"}
        if method == "POST" and b"badvid00000" in data:
            raise urllib.error.HTTPError(url, 404, "gone", {}, None)
        return {}
    pid = publish_playlist(["vidA0000001", "vidB0000002", "vidA0000001", "badvid00000",
                            "not-an-id"], "2026-08-23", replace_id="PLold", token="tok", http=fake_http)
    assert pid == "PLnew", pid
    kinds = [("create" if "/playlists?" in c[1] and c[0] == "POST" else c[0]) for c in calls]
    assert kinds == ["create", "POST", "POST", "POST", "DELETE"], kinds
    assert "id=PLold" in calls[-1][1], calls[-1][1]
    posts = [json.loads(c[2])["snippet"]["resourceId"]["videoId"] for c in calls if c[0] == "POST" and "/playlistItems" in c[1]]
    assert posts == ["vidA0000001", "vidB0000002", "badvid00000"], posts
    assert json.loads(calls[0][2])["status"]["privacyStatus"] == "public"
    calls.clear()
    def dead_http(url, headers=None, data=None, method=None, timeout=30):
        calls.append((method or "GET", url))
        if method == "POST" and "/playlists?" in url:
            return {"id": "PLnew"}
        if method == "POST":
            raise urllib.error.HTTPError(url, 403, "quota", {}, None)
        return {}
    pid = publish_playlist([f"vid{i:08d}" for i in range(10)], "2026-08-23",
                           replace_id="PLold", token="tok", http=dead_http)
    assert pid is None
    assert [c[0] for c in calls] == ["POST", "POST", "POST", "POST", "DELETE"], calls
    assert "id=PLnew" in calls[-1][1], "the empty new playlist is removed, the old one kept"
    assert publish_playlist(["vidA0000001"], "2026-08-23", token="", http=dead_http) is None
    calls.clear()
    n = prune_playlists([{"playlist": {"id": "PLa"}}, {"playlist": None}, {"playlist": {"id": "PLb"}}],
                        token="tok", http=fake_http)
    assert n == 2 and [c[0] for c in calls] == ["DELETE", "DELETE"], calls

    # --- reader signals parse the tv_signals row shape
    rows = [{"kind": "skip", "vid": "vidA0000001", "channel": "Chan", "n": 2},
            {"kind": "skip", "vid": "vidB0000002", "channel": "Chan", "n": 1},
            {"kind": "watched", "vid": "vidC0000003", "channel": "X", "n": 5},
            {"kind": "more", "vid": None, "channel": "Loved", "n": 3}]
    parsed = {"skip": {}, "watched": {}, "more": {}, "skip_ch": {}}
    for row in rows:
        kind, nn = row["kind"], int(row["n"])
        if kind in ("skip", "watched") and row.get("vid"):
            parsed[kind][row["vid"]] = nn
            if kind == "skip" and row.get("channel"):
                parsed["skip_ch"][row["channel"]] = parsed["skip_ch"].get(row["channel"], 0) + nn
        elif kind == "more" and row.get("channel"):
            parsed["more"][row["channel"]] = nn
    assert parsed["skip_ch"] == {"Chan": 3} and parsed["more"] == {"Loved": 3}
    sig2 = dict(signals, skip_ch={"Kurz": 3})
    text2, _ = format_candidates(pools, sig2, now_ts)
    assert "PASSED" in text2, text2

    # --- the vault seed stands in when nothing is enriched yet
    seed = {"items": [{"id": "seed0000001", "t": "A talk", "ch": "TED", "lane": "talk"}]}
    assert refresh_vault(seed, {}, "", now_ts)["items"][0]["alive"] is True
    assert refresh_vault(seed, vault_live, "", now_ts) is vault_live

    # --- clip floor applies even with no channel median; promo gate hits gold
    vids2 = [{"id": "nomedian001", "t": "A ninety second thing", "ch": "Newbie",
              "d": now_ts - day, "dur": "1:30", "views": 10},
             {"id": "nomedian002", "t": "A real episode", "ch": "Newbie",
              "d": now_ts - day, "dur": "9:30", "views": 10},
             {"id": "goldpromo01", "t": "Season 2 Official Trailer", "ch": "Kurz",
              "d": now_ts - 900 * day, "dur": "2:10", "views": 5_000_000, "dc": 1}]
    pools2, dropped2 = gate(vids2, catalog, {}, signals, now_ts, {})
    assert [v["id"] for v in pools2["fresh"]] == ["nomedian002"], pools2["fresh"]
    assert dropped2.get("clip") == 1 and dropped2.get("promo") == 1, dropped2
    assert pools2["gold"] == []

    assert iso_seconds("PT1H2M3S") == 3723 and iso_seconds("PT45S") == 45
    assert fmt_seconds(3723) == "1:02:03" and fmt_seconds(305) == "5:05"
    assert dur_seconds("LIVE") is None and dur_seconds("12:00") == 720
    assert PROMO_RE.search("Official Trailer") and not PROMO_RE.search("A clip-art history")
    assert trim("x" * 200, 90).endswith("…") and len(trim("x" * 200, 90)) <= 90
    # the schema is valid JSON schema shape for structured output
    assert SCHEMA["properties"]["shelves"]["required"] == SHELF_KEYS
    assert SCHEMA["properties"]["more"]["required"] == ["pick"] + SHELF_KEYS
    assert "{more}" not in build_prompt("t", "c") and "BENCH" in build_prompt("t", "c")
    print("curate_tv selftest: ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out", default=OUT)
    parser.add_argument("--history", default=HISTORY)
    parser.add_argument("--vault", default=VAULT_LIVE)
    parser.add_argument("--editions", default=EDITIONS)
    parser.add_argument("--no-playlist", action="store_true")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    run(args)


if __name__ == "__main__":
    main()
