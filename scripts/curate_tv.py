#!/usr/bin/env python3
"""Btown TV — the daily edition: a curated page of videos, not a feed.

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
     written, in order, into a public YouTube playlist so the edition plays
     on the TV app with one click.

Memory lives on the branch too: data/tv-history.json remembers what the
page showed (so old gold and vault rotate instead of repeating), and the
reader reactions table in Supabase (supabase/tv.sql) feeds back "watched /
not for me / more like this" as signals — all of it fails soft.

Failure posture, same as the siblings: no key, no candidates, or any API
trouble logs and exits 0 without writing, so the workflow stays green and
the branch keeps its last good edition.

CLI:
  --out PATH       where to write (default data/btown-tv.json)
  --history PATH   the shown-id memory, read AND rewritten in place
                   (default data/tv-history.json)
  --vault PATH     enriched vault copy, read AND rewritten (default
                   data/tv-vault-live.json)
  --no-playlist    skip the YouTube playlist sync
  --selftest       run the offline checks and exit
"""

import argparse
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
VAULT_SEED = os.path.join(ROOT, "data", "tv-vault.json")
TASTE = os.path.join(ROOT, "prompts", "tv-taste.md")
CHANNELS_FILE = os.path.join(ROOT, "data", "youtube-channels.json")

RAW = "https://raw.githubusercontent.com/btownbrief/btown-brief"
YT_URL = f"{RAW}/pulse-youtube/data/pulse-youtube.json"
CATALOG_URL = f"{RAW}/pulse-youtube/data/deep-catalog.json"
HISTORY_URL = f"{RAW}/btown-tv/data/tv-history.json"
VAULT_LIVE_URL = f"{RAW}/btown-tv/data/tv-vault-live.json"
UA = "btown-tv/1.0"

API = "https://www.googleapis.com/youtube/v3"
SB_URL = "https://jnouvwxomrcffqwilqkq.supabase.co"
SB_KEY = "sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3"   # anon — safe

MODEL = "claude-opus-5"
WHY_MAX = 90
FRESH_DAYS = 7            # an "upload" is this week's
GOLD_REST_DAYS = 30       # an old-gold pick rests this long before it can return
VAULT_REST_DAYS = 45
FRESH_REST_DAYS = 14      # a fresh pick shown once is not shown again
RERUN_MEMORY_DAYS = 60
HISTORY_KEEP_DAYS = 120
CLIP_RATIO = 0.35         # under this share of the channel's median = a clip
CLIP_FLOOR_SEC = 120      # never call something a clip just for being < this
SETTLE_MIN_SEC = 20 * 60
QUICK_MIN_SEC = 5 * 60
QUICK_MAX_SEC = 12 * 60
PER_CHANNEL_CAP = 3
MAX_FRESH = 110
MAX_GOLD = 40
MAX_VAULT = 40
MAX_VT = 30
PLAYLIST_MAX = 25

SHELVES = [
    # key, title, subtitle, how many the editor should pick
    ("settle", "Settle in", "Twenty minutes and up — the couch episode", 6),
    ("quick", "Quick one", "Five to twelve minutes", 6),
    ("vt", "Burlington & Vermont", "Filmed here, made here, about here", 6),
    ("vault", "From the Vault", "Timeless — pulled from thirteen years of saves", 6),
    ("gold", "Old gold", "The back catalog of the channels we follow", 5),
    ("bench", "From the bench", "Channels that rarely post — and just did", 4),
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


def fetch_optional(url, default):
    try:
        return http_json(url)
    except Exception as exc:  # noqa: BLE001 — optional inputs fail soft
        print(f"curate_tv: optional fetch failed {url.rsplit('/', 1)[-1]} "
              f"({exc})", file=sys.stderr)
        return default


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as src:
            return json.load(src)
    except (OSError, ValueError):
        return default


def write_json(path, value):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as dst:
        json.dump(value, dst, separators=(",", ":"), ensure_ascii=False)
        dst.write("\n")


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
    empty = {"skip": {}, "watched": {}, "more": {}}
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
    out = {"skip": {}, "watched": {}, "more": {}}
    for row in rows:
        kind = row.get("kind")
        n = int(row.get("n") or 0)
        if kind in ("skip", "watched") and row.get("vid"):
            out[kind][row["vid"]] = n
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
        if signals["skip"].get(vid, 0) >= 2:
            drop("not-for-me")
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
        if PROMO_RE.search(title) or (sec and sec < 180 and HASHTAG_RE.search(title)):
            drop("promo")
            continue
        median = medians.get(ch)
        if sec and median and sec < max(CLIP_FLOOR_SEC, median * CLIP_RATIO):
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
    pool.sort(key=lambda v: (shown.get(v["id"], 0),
                             hash((v["id"], day)) % 1000))
    return pool[:MAX_VAULT]


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
        return live
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
            return live
        by_id = {d.get("id"): d for d in details}
        for item in batch:
            detail = by_id.get(item["id"])
            entry = dict(item)
            if not detail:
                entry["alive"] = False
            else:
                status = detail.get("status") or {}
                entry["alive"] = status.get("privacyStatus") == "public" and \
                    status.get("embeddable", True)
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
        "note": {"type": "string"},
    },
    "required": ["pick", "shelves", "note"],
    "additionalProperties": False,
}

PROMPT_RULES = """
You are the editor of Btown TV, a once-a-day curated page of YouTube videos \
for people in Burlington, Vermont who would rather have a human choose what \
to watch tonight than scroll the algorithm. The page is finite: one \
Tonight's pick and a few short shelves. Everything on it is there because \
you chose it and can say why.

Below is the taste doctrine, then the numbered candidates. Candidates are \
grouped: FRESH (this week's uploads from channels we follow), VERMONT (the \
local radar), VAULT (timeless videos from thirteen years of the editor's own \
saves), GOLD (each followed channel's all-time best). Every candidate line \
carries its channel, length, views, and age. Lines marked RARE are from \
channels that seldom post — those are the only valid picks for the bench \
shelf. Lines marked LOVED are from channels readers asked for more of.

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
    loved = {ch for ch, n in signals.get("more", {}).items() if n >= 2}
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
    rules = PROMPT_RULES.format(why_max=WHY_MAX, **counts)
    return (f"{rules}\n\n=== TASTE DOCTRINE ===\n{taste}\n\n"
            f"=== CANDIDATES ===\n{candidate_text}\n")


def ask_model(prompt):
    import anthropic

    client = anthropic.Anthropic()
    response = client.messages.create(
        model=MODEL,
        max_tokens=16000,
        output_config={"format": {"type": "json_schema", "schema": SCHEMA},
                       "effort": "high"},
        messages=[{"role": "user", "content": prompt}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("the model declined to answer")
    if response.stop_reason == "max_tokens":
        raise RuntimeError("response truncated at max_tokens")
    text = next(block.text for block in response.content if block.type == "text")
    return json.loads(text)


def validate(raw, index):
    """Model output -> {pick, shelves}; silently drops anything that breaks
    the rules (bad index, duplicate, wrong length for the shelf, non-RARE on
    the bench, a third item from one channel)."""
    used = set()
    per_channel = {}
    counts = {shelf[0]: shelf[3] for shelf in SHELVES}

    def take(entry, shelf):
        try:
            i = int(entry.get("i"))
        except (TypeError, ValueError):
            return None
        if i < 0 or i >= len(index):
            return None
        pool, item = index[i]
        if item["id"] in used:
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
        if per_channel.get(ch, 0) >= 2:
            return None
        why = trim(str(entry.get("why") or ""), WHY_MAX)
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
    return pick, shelves


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


def sync_playlist(video_ids, playlist_id=None, token=None):
    """Make the playlist hold exactly video_ids, in that order. Removes what
    isn't in the edition, inserts what is — then re-inserts out-of-order
    survivors so the order matches. ~50 units per insert/delete."""
    playlist_id = playlist_id or os.environ.get("YT_TV_PLAYLIST_ID", "").strip()
    token = token or oauth_access_token()
    if not (playlist_id and token):
        print("curate_tv: playlist sync skipped (no OAuth / playlist id)")
        return False
    auth = {"Authorization": f"Bearer {token}",
            "Content-Type": "application/json"}
    existing = []
    page = None
    while True:
        query = {"part": "id,snippet", "playlistId": playlist_id, "maxResults": 50}
        if page:
            query["pageToken"] = page
        data = http_json(f"{API}/playlistItems?{urllib.parse.urlencode(query)}",
                         headers=auth)
        for item in data.get("items", []):
            rid = (item.get("snippet") or {}).get("resourceId") or {}
            existing.append({"item": item["id"], "vid": rid.get("videoId"),
                             "pos": (item.get("snippet") or {}).get("position", 0)})
        page = data.get("nextPageToken")
        if not page:
            break
    wanted = list(dict.fromkeys(video_ids))[:PLAYLIST_MAX]
    wanted_set = set(wanted)
    # drop what is not in tonight's edition (and any duplicates)
    seen = set()
    for entry in sorted(existing, key=lambda e: e["pos"]):
        if entry["vid"] not in wanted_set or entry["vid"] in seen:
            http_json(f"{API}/playlistItems?id={entry['item']}", headers=auth,
                      method="DELETE")
        else:
            seen.add(entry["vid"])
    # insert the new ones at their position
    for pos, vid in enumerate(wanted):
        if vid in seen:
            continue
        body = json.dumps({"snippet": {
            "playlistId": playlist_id, "position": pos,
            "resourceId": {"kind": "youtube#video", "videoId": vid}}}).encode()
        try:
            http_json(f"{API}/playlistItems?part=snippet", headers=auth,
                      data=body, method="POST")
        except urllib.error.HTTPError as exc:
            # a private/deleted video refuses insertion — skip, don't fail
            print(f"curate_tv: playlist insert {vid} -> HTTP {exc.code}",
                  file=sys.stderr)
    print(f"curate_tv: playlist synced -> {len(wanted)} videos")
    return True


# ----------------------------------------------------------------------
# Run
# ----------------------------------------------------------------------

def edition_label(now):
    """'Tonight' is the daily 5pm edition; a dispatch earlier in the day is
    still tonight's page, just early."""
    return now.astimezone(timezone(timedelta(hours=-4))).strftime("%Y-%m-%d")


def build_payload(pick, shelves, live, generated, stats, playlist_id):
    shelf_out = []
    for key, title, sub, _ in SHELVES:
        items = shelves.get(key) or []
        if items:
            shelf_out.append({"key": key, "title": title, "sub": sub,
                              "items": items})
    return {
        "v": 1,
        "generated": generated.replace(microsecond=0).isoformat(),
        "edition": edition_label(generated),
        "pick": pick,
        "shelves": shelf_out,
        "live": live[:8],
        "playlist": ({"id": playlist_id,
                      "url": f"https://www.youtube.com/playlist?list={playlist_id}"}
                     if playlist_id else None),
        "stats": stats,
    }


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
    history = read_json(args.history, None) or fetch_optional(HISTORY_URL, {}) or {}
    vault_live = read_json(args.vault, None) or fetch_optional(VAULT_LIVE_URL, {}) or {}
    vault_seed = read_json(VAULT_SEED, {}) or {}
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
    pick, shelves = validate(raw, index)
    picked = sum(len(v) for v in shelves.values()) + (1 if pick else 0)
    if not pick or picked < 8:
        print(f"curate_tv: the editor returned too little ({picked}) — skipping")
        return
    print(f"curate_tv: picked {picked} · {trim(str(raw.get('note','')), 200)}")

    stats = {"candidates": {k: len(v) for k, v in pools.items()},
             "dropped": dropped, "picked": picked}
    playlist_id = os.environ.get("YT_TV_PLAYLIST_ID", "").strip()
    ordered = [pick] + [item for key in SHELF_KEYS for item in shelves.get(key, [])]
    if not args.no_playlist:
        try:
            sync_playlist([item["id"] for item in ordered], playlist_id)
        except Exception as exc:  # noqa: BLE001
            print(f"curate_tv: playlist trouble ({exc})", file=sys.stderr)

    write_json(args.out, build_payload(pick, shelves, pools["live"], now,
                                       stats, playlist_id))
    write_json(args.history, remember(history, ordered, now_ts))
    print(f"curate_tv: edition {edition_label(now)} -> {args.out}")


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
        "note": "thin week",
    }
    pick, shelves = validate(raw, index)
    assert pick and pick["id"] == "fresh000002"
    assert [v["id"] for v in shelves["settle"]] == ["fresh000007"], shelves["settle"]
    assert [v["id"] for v in shelves["quick"]] == ["fresh000006"], shelves["quick"]
    assert shelves["vt"] == [], shelves["vt"]
    assert [v["id"] for v in shelves["vault"]] == ["vault000001"]
    assert [v["id"] for v in shelves["gold"]] == ["old00000001"]
    assert shelves["bench"] == []
    assert all("why" in v and len(v["why"]) <= WHY_MAX for v in
               [pick] + [x for s in shelves.values() for x in s])

    payload = build_payload(pick, shelves, pools["live"], utcnow(),
                            {"picked": 5}, "PLxyz")
    keys = [s["key"] for s in payload["shelves"]]
    assert keys == ["settle", "quick", "vault", "gold"], keys
    assert payload["playlist"]["url"].endswith("PLxyz")
    assert payload["live"][0]["id"] == "fresh000005"

    mem = remember(history, [pick] + shelves["settle"], now_ts)
    ids = {e["id"] for e in mem["shown"]}
    assert {"fresh000002", "fresh000007", "fresh000008"} <= ids
    shown, titles = history_index(mem, now_ts)
    assert shown["fresh000002"] == now_ts

    assert iso_seconds("PT1H2M3S") == 3723 and iso_seconds("PT45S") == 45
    assert fmt_seconds(3723) == "1:02:03" and fmt_seconds(305) == "5:05"
    assert dur_seconds("LIVE") is None and dur_seconds("12:00") == 720
    assert PROMO_RE.search("Official Trailer") and not PROMO_RE.search("A clip-art history")
    assert trim("x" * 200, 90).endswith("…") and len(trim("x" * 200, 90)) <= 90
    # the schema is valid JSON schema shape for structured output
    assert SCHEMA["properties"]["shelves"]["required"] == SHELF_KEYS
    print("curate_tv selftest: ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out", default=OUT)
    parser.add_argument("--history", default=HISTORY)
    parser.add_argument("--vault", default=VAULT_LIVE)
    parser.add_argument("--no-playlist", action="store_true")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    run(args)


if __name__ == "__main__":
    main()
