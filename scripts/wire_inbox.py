#!/usr/bin/env python3
"""The Wire's inbox reader: X posts (Grok Bot) and Facebook group posts (Muse).

Two bots drop files in the private repo btownbrief/wire-inbox:

  grok/x.json         X posts from a shortlist of accounts: six Vermont ones and the
                      national desks (AP, Reuters, BBC and others), 2026-10-17
  muse/facebook.json  posts from public Facebook groups, every one of them local
  grok/recaps.json    Grok's packed recaps (Morning briefing, AI & tech, Sports...):
                      each a short intro plus linked bullets, 2026-10-19; and
                      "Pictures of the day", X posts whose picture is the point

refresh_pulse.py calls read_inbox() each run. This module fetches both files
through the GitHub contents API with the WIRE_INBOX_TOKEN secret, checks them
against the same rules as the inbox's own validator (scripts/validate_inbox.py
in that repo, ported here so this side never trusts the other side's CI), and
merges the surviving posts into pulse.json under its own `inbox` key:

  "inbox": {
    "x":        {"paused": false, "reason": null, "updated_at": "...",
                 "checked": "...", "pause_after_hours": 18, "n": 12,
                 "items": [{"u", "d", "fd", "from", "name", "summary",
                            "kind", "ch": "x", "local": false}, ...]},
    "facebook": {...same shape, "ch": "facebook"...},
    "recaps":   {"paused": false, "reason": null, "updated_at": "...", "checked": "...",
                 "pause_after_hours": 18, "n": 5,
                 "items": [{"id", "kind", "title", "posted_at", "d", "intro", "basis",
                            "bullets": [{"text", "url", "note", "sport"?}, ...]}, ...]}
  }

The posts live under their own key, not in `items`, so pages that predate the
Wire (pulse.html, the current All Day) never see them. The bot's one-line
recap is the post's text on the page, verbatim, so it is stored as `summary`.

Honesty rules, same as the Reddit bridge's pause:

  * A missing file, a file that fails the contract, or an `updated_at` older
    than PAUSE_HOURS marks that source paused, with the reason. Nothing new is
    merged from it; the posts already held stay with their honest ages and age
    out after KEEP_DAYS.
  * One bad post does not pause a source: it is dropped and counted. A file
    where most posts fail is a bad file.
  * No token means paused ("no token"), and nothing else about the run changes.
  * This module never raises into refresh_pulse: every failure is a state.

CLI:
  --file CH PATH   check a local file as if it were fetched (CH is x or facebook)
  --selftest       run the offline checks and exit
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import wire_common as wc

REPO = "btownbrief/wire-inbox"
API = "https://api.github.com/repos/" + REPO + "/contents/"
UA = "btown-brief-site/1.0 (wire inbox reader)"
TOKEN_ENV = "WIRE_INBOX_TOKEN"

# channel -> (path in the inbox repo, the `source` value that file must carry)
FILES = {
    "x": ("grok/x.json", "grok-x"),
    "facebook": ("muse/facebook.json", "muse-facebook"),
}
PAUSE_HOURS = 18     # README: "paused if updated_at is older than 18 hours"
# The Wire keeps its own store (pulse.json's inbox key) and only reads the
# last ~28 hours of it, so the inbox files need a short window: the bots keep
# 3 days (README, 2026-10-19), and this side keeps up to 7 days, 300 posts per
# channel, of what it has read. That is two and a half days of X at ~120 posts
# a day, still far more than the Wire's window.
KEEP_DAYS = 7
CAP = 300
BAD_SHARE = 0.5      # more than half the posts failing = a bad file
CLOCK_SKEW_MINUTES = 10

# --- the contract, ported from wire-inbox/scripts/validate_inbox.py --------
SOURCES = {"grok-x", "muse-facebook"}
KINDS = {"post", "recap", "listing"}
# 2026-10-19: was 300 items and 7 days, which a busy X list outgrew in three
# days ("the file will reach the 300-item limit tomorrow"). The bots now keep
# 3 days with a safety cap of 1,000; this side still accepts posts up to 7 days
# old, so a bot running an older brief is never paused for keeping too much.
MAX_ITEMS = 1000
MAX_SUMMARY = 200
MAX_AGE_DAYS = 7
HTTPS = re.compile(r"^https://[^\s]+$")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE = re.compile(r"(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)")
SHOUTY = re.compile(r"\bBREAKING\b|#\w+|[\U0001F300-\U0001FAFF]")
# A summary that narrates the poster ("Someone is sharing...", "Burlington Area
# History is sharing...") instead of speaking in the post's own voice (2026-10-19). Counted
# and reported, never dropped: the page strips the narrator meanwhile, and a
# bot still on its old brief must not pause its whole source.
NARRATOR = re.compile(r"^(someone|a member|a user|the poster|a neighbor|a resident)\b"
                      r"|^\S.{0,60}?\bis (sharing|asking|promoting|announcing|advertising|"
                      r"inviting|looking for|offering)\b", re.I)


def parse_ts(value):
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        return None
    return dt.astimezone(timezone.utc)


def check(data, now):
    """The validator's rules, split the way the Wire needs them.

    Returns (file_problems, item_problems) where item_problems maps an item's
    index to its list of problems. The validator itself reports both kinds as
    one flat list; the rules are the same, line for line."""
    if not isinstance(data, dict):
        return ["top level must be an object"], {}
    problems = []
    if data.get("source") not in SOURCES:
        problems.append(f"source must be one of {sorted(SOURCES)}, got {data.get('source')!r}")
    if parse_ts(data.get("updated_at")) is None:
        problems.append("updated_at must be ISO 8601 with a timezone")
    note = data.get("run_note", "")
    if not isinstance(note, str) or "\n" in note or len(note) > 300:
        problems.append("run_note must be one line of at most 300 characters")
    items = data.get("items")
    if not isinstance(items, list):
        return problems + ["items must be a list"], {}
    if len(items) > MAX_ITEMS:
        problems.append(f"{len(items)} items; the cap is {MAX_ITEMS}")

    per_item = {}
    seen = set()
    last_posted = None
    for i, it in enumerate(items):
        bad = []
        if not isinstance(it, dict):
            per_item[i] = ["must be an object"]
            continue
        url = it.get("url")
        if not isinstance(url, str) or not HTTPS.match(url):
            bad.append("url must be a real https:// link")
        elif url in seen:
            bad.append(f"duplicate url {url}")
        else:
            seen.add(url)
        for key in ("from", "name"):
            v = it.get(key)
            if not isinstance(v, str) or not v.strip() or len(v) > 120:
                bad.append(f"{key} must be 1 to 120 characters")
        s = it.get("summary")
        if not isinstance(s, str) or not s.strip() or len(s) > MAX_SUMMARY:
            bad.append(f"summary must be 1 to {MAX_SUMMARY} characters")
        else:
            if SHOUTY.search(s):
                bad.append("summary has a hashtag, emoji or BREAKING")
            if EMAIL.search(s) or PHONE.search(s):
                bad.append("summary contains an email or phone number")
        posted = parse_ts(it.get("posted_at"))
        if posted is None:
            bad.append("posted_at must be ISO 8601 with a timezone")
        if parse_ts(it.get("found_at")) is None:
            bad.append("found_at must be ISO 8601 with a timezone")
        if posted is not None:
            if posted > now:
                bad.append("posted_at is in the future")
            if now - posted > timedelta(days=MAX_AGE_DAYS):
                bad.append(f"older than {MAX_AGE_DAYS} days; drop it")
            if last_posted is not None and posted > last_posted:
                # an ordering slip is the bot's bookkeeping, not a bad post:
                # the validator flags it, the Wire just sorts
                problems.append(f"items[{i}]: items must be newest first")
            last_posted = posted
        if it.get("kind") not in KINDS:
            bad.append(f"kind must be one of {sorted(KINDS)}")
        if bad:
            per_item[i] = bad
    # ordering is reported but never pauses a source on its own
    return problems, per_item


def is_fatal(problem):
    return not problem.startswith("items[")


# --- recaps (grok/recaps.json), ported from the validator too ----------------

RECAP_PATH, RECAP_SOURCE = "grok/recaps.json", "grok-recaps"
EASTERN = wc.ET
# kind -> the fixed title the page shows. Each kind is optional on any day.
RECAP_KINDS = {
    "morning": "Morning briefing", "evening": "Evening wrap", "breaking": "Breaking",
    "ai": "AI & tech", "politics": "Politics & Washington", "world": "World",
    "markets": "Markets & money", "sports": "Sports", "vermont": "Vermont on X",
    # 2026-10-19, "stock news and RECAPS for it": two weekday market recaps;
    # Markets & money stays as the weekend look back at the week
    "market-open": "Market open", "market-close": "Market close",
    "culture": "Culture & entertainment", "science": "Science & space",
    "weekend": "Weekend preview", "week-ahead": "Week ahead",
    # Stephen, 2026-10-19: "a Grok 'Pictures of the day' recap kind (~5 X posts
    # where the image is the point, one-line why each)". Every bullet is an X
    # post's own link; the page shows it or X's official embed, never a copy.
    "pictures": "Pictures of the day",
}
# what the recap was built from -> the small label the page shows. Never "AI".
RECAP_BASIS = {"trending": "From X trending summaries", "accounts": "From posts on X"}
# today's sports, plus `soccer`, which a bot on the brief before 2026-10-19's
# "drop soccer" may still write: accepted, and read as `other`
RECAP_SPORTS = wc.SPORTS + tuple(wc.LEGACY_SPORTS)
RECAP_MAX = 60            # recaps in the file: ~12 a day for 3 days, with room
RECAP_KEEP_DAYS = 3       # the file keeps 3 days, and so does the Wire's store
RECAP_STORE_BYTES = 250_000   # and the store never adds more than this to pulse.json
RECAP_BULLETS = (1, 20)
RECAP_URL_MAX = 300
RECAP_TEXT_MAX = 160
RECAP_NOTE_MAX = 200
RECAP_INTRO_MAX = 400
RECAP_ID = re.compile(r"^(\d{4}-\d{2}-\d{2})-([a-z-]+?)(?:-([23]))?$")
RECAP_BREAKING_BULLETS = 5
RECAP_PICTURES_BULLETS = (3, 8)   # "~5": a recap of one picture is not one
X_POST = re.compile(r"^https://(?:www\.)?(?:x|twitter)\.com/[A-Za-z0-9_]{1,15}/status/\d{1,25}/?$")
SEARCH_URL = re.compile(r"/search\b|[?&]q=", re.I)


def clean_text(value, limit, what, bad, required=True):
    """One reader-facing string: present, short, no shouting, no contact details."""
    if not isinstance(value, str) or not value.strip():
        if required:
            bad.append(f"{what} must be 1 to {limit} characters")
        return
    if len(value) > limit:
        bad.append(f"{what} must be 1 to {limit} characters")
    if SHOUTY.search(value):
        bad.append(f"{what} has a hashtag, emoji or BREAKING")
    if EMAIL.search(value) or PHONE.search(value):
        bad.append(f"{what} contains an email or phone number")


def check_recap(rc, now):
    """Problems with one recap, as a list (empty when it is fine)."""
    if not isinstance(rc, dict):
        return ["must be an object"]
    bad = []
    kind = rc.get("kind")
    match = RECAP_ID.match(rc["id"]) if isinstance(rc.get("id"), str) else None
    if not match:
        bad.append("id must be YYYY-MM-DD-<kind>, with -2 or -3 for a second or third Breaking")
    elif kind in RECAP_KINDS and match.group(2) != kind:
        bad.append(f"id {rc['id']!r} names another kind than {kind!r}")
    elif match.group(3) and kind != "breaking":
        bad.append("only Breaking may have a second or third recap in a day")
    if kind not in RECAP_KINDS:
        bad.append(f"kind must be one of {list(RECAP_KINDS)}")
    elif rc.get("title") != RECAP_KINDS[kind]:
        bad.append(f"title for {kind} must be {RECAP_KINDS[kind]!r}")
    if rc.get("basis") not in RECAP_BASIS:
        bad.append(f"basis must be one of {list(RECAP_BASIS)}")
    if rc.get("source") != "grok":
        bad.append("source must be 'grok'")
    posted = parse_ts(rc.get("posted_at"))
    if posted is None:
        bad.append("posted_at must be ISO 8601 with a timezone")
    else:
        if match and posted.astimezone(EASTERN).date().isoformat() != match.group(1):
            bad.append(f"id date {match.group(1)} is not posted_at's Burlington date")
        if posted - now > timedelta(minutes=CLOCK_SKEW_MINUTES):
            bad.append("posted_at is in the future")
        if now - posted > timedelta(days=RECAP_KEEP_DAYS):
            bad.append(f"older than {RECAP_KEEP_DAYS} days; drop it")
    clean_text(rc.get("intro"), RECAP_INTRO_MAX, "intro", bad)
    bullets = rc.get("bullets")
    lo, hi = RECAP_BULLETS
    if kind == "breaking":
        hi = RECAP_BREAKING_BULLETS
    elif kind == "pictures":
        lo, hi = RECAP_PICTURES_BULLETS
    if not isinstance(bullets, list) or not lo <= len(bullets) <= hi:
        return bad + [f"bullets must be a list of {lo} to {hi}"]
    seen = set()
    for j, bl in enumerate(bullets):
        where = f"bullets[{j}]"
        if not isinstance(bl, dict):
            bad.append(f"{where}: must be an object")
            continue
        url = bl.get("url")
        if not isinstance(url, str) or not HTTPS.match(url) or SEARCH_URL.search(url) \
                or len(url) > RECAP_URL_MAX:
            bad.append(f"{where}: url must be a real https:// link of at most {RECAP_URL_MAX} "
                       "characters, never a search page")
        elif url in seen:
            bad.append(f"{where}: duplicate url {url}")
        elif kind == "pictures" and not X_POST.match(url):
            bad.append(f"{where}: in Pictures of the day, url must be the X post itself "
                       "(https://x.com/<handle>/status/<id>)")
        else:
            seen.add(url)
        inner = []
        clean_text(bl.get("text"), RECAP_TEXT_MAX, "text", inner)
        clean_text(bl.get("note"), RECAP_NOTE_MAX, "note", inner)
        sport = bl.get("sport")
        if kind == "sports" and sport not in RECAP_SPORTS:
            inner.append(f"sport must be one of {list(RECAP_SPORTS)} in a Sports recap")
        elif sport is not None and sport not in RECAP_SPORTS:
            inner.append(f"sport must be one of {list(RECAP_SPORTS)}")
        bad += [f"{where}: {problem}" for problem in inner]
    return bad


def check_recaps(data, now):
    """-> (file_problems, {recap_index: problems}), the validator's rules."""
    if not isinstance(data, dict):
        return ["top level must be an object"], {}
    problems = []
    if data.get("source") != RECAP_SOURCE:
        problems.append(f"source must be {RECAP_SOURCE!r}, got {data.get('source')!r}")
    if parse_ts(data.get("updated_at")) is None:
        problems.append("updated_at must be ISO 8601 with a timezone")
    note = data.get("run_note", "")
    if not isinstance(note, str) or "\n" in note or len(note) > 300:
        problems.append("run_note must be one line of at most 300 characters")
    recaps = data.get("recaps")
    if not isinstance(recaps, list):
        return problems + ["recaps must be a list"], {}
    if len(recaps) > RECAP_MAX:
        problems.append(f"{len(recaps)} recaps; the cap is {RECAP_MAX}")
    per, ids = {}, set()
    for i, rc in enumerate(recaps):
        bad = check_recap(rc, now)
        if isinstance(rc, dict) and isinstance(rc.get("id"), str):
            if rc["id"] in ids:
                bad.append(f"duplicate id {rc['id']}")
            ids.add(rc["id"])
        if bad:
            per[i] = bad
    return problems, per


def read_recaps(raw, now):
    """grok/recaps.json -> (state, fresh_recaps), the same posture as read_one:
    a bad file or a stale write pauses the source; one bad recap is dropped."""
    state = {"paused": True, "reason": None, "updated_at": None,
             "checked": iso(now), "pause_after_hours": PAUSE_HOURS}
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        state["reason"] = f"{RECAP_PATH} is not valid JSON ({exc.__class__.__name__})"
        return state, []
    problems, per = check_recaps(data, now)
    if problems:
        state["reason"] = f"{RECAP_PATH} fails the contract: {problems[0]}"
        return state, []
    updated = parse_ts(data["updated_at"])
    state["updated_at"] = iso(updated)
    recaps = data["recaps"]
    if recaps and len(per) > BAD_SHARE * len(recaps):
        state["reason"] = (f"{RECAP_PATH}: {len(per)} of {len(recaps)} recaps fail the "
                           f"contract (first: {next(iter(per.values()))[0]})")
        return state, []
    if updated - now > timedelta(minutes=CLOCK_SKEW_MINUTES):
        state["reason"] = f"{RECAP_PATH} claims it was written in the future ({iso(updated)})"
        return state, []
    if now - updated > timedelta(hours=PAUSE_HOURS):
        hours = (now - updated).total_seconds() / 3600
        state["reason"] = f"{RECAP_PATH} last written {hours:.0f}h ago (limit {PAUSE_HOURS}h)"
        return state, []
    fresh = []
    for i, rc in enumerate(recaps):
        if i in per:
            continue
        posted = parse_ts(rc["posted_at"])
        bullets = []
        for bl in rc["bullets"]:
            out = {"text": re.sub(r"\s+", " ", bl["text"]).strip(), "url": bl["url"],
                   "note": re.sub(r"\s+", " ", bl["note"]).strip()}
            if bl.get("sport"):
                out["sport"] = wc.norm_sport(bl["sport"])
            bullets.append(out)
        fresh.append({"id": rc["id"], "kind": rc["kind"], "title": RECAP_KINDS[rc["kind"]],
                      "posted_at": iso(posted), "d": int(posted.timestamp()),
                      "intro": re.sub(r"\s+", " ", rc["intro"]).strip(),
                      "basis": rc["basis"], "bullets": bullets})
    state["paused"] = False
    if per:
        state["dropped"] = len(per)
    return state, fresh


def merge_recaps(previous, fresh, now):
    """Union by id (the bot's newest version of a recap wins), newest first,
    the last RECAP_KEEP_DAYS, at most RECAP_MAX."""
    by_id = {item["id"]: dict(item) for item in previous or []
             if isinstance(item, dict) and item.get("id")}
    before = dict(by_id)
    for item in fresh:
        by_id[item["id"]] = dict(item)
    cutoff = int((now - timedelta(days=RECAP_KEEP_DAYS)).timestamp())
    kept = sorted((item for item in by_id.values() if item.get("d", 0) >= cutoff),
                  key=lambda item: item.get("d", 0), reverse=True)[:RECAP_MAX]
    while kept and len(json.dumps(kept, ensure_ascii=False).encode("utf-8")) > RECAP_STORE_BYTES:
        kept.pop()   # the oldest go first; today's recaps are what the Wire shows
    # new or rewritten, and still kept: a recap the caps turned away is not news
    added = sum(1 for item in kept if before.get(item["id"]) != item)
    return kept, added


# --- fetching ----------------------------------------------------------------

def fetch_file(path, token, timeout=20):
    """GitHub contents API, raw media type. Returns (status, body_bytes).
    status is "ok", "missing", or "error: ..."; never raises."""
    request = urllib.request.Request(API + path, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": UA,
    })
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return "ok", response.read()
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return "missing", None
        return f"error: HTTP {exc.code}", None
    except Exception as exc:  # noqa: BLE001 — a dead inbox is a state, not a crash
        return f"error: {exc.__class__.__name__}", None


def iso(dt):
    return dt.replace(microsecond=0).isoformat() if dt else None


def read_one(ch, raw, now):
    """One fetched file -> (state, fresh_items). state is the page-facing
    dict without `items`; fresh_items are pulse-shaped posts."""
    path, source = FILES[ch]
    state = {"paused": True, "reason": None, "updated_at": None,
             "checked": iso(now), "pause_after_hours": PAUSE_HOURS}
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        state["reason"] = f"{path} is not valid JSON ({exc.__class__.__name__})"
        return state, []
    problems, per_item = check(data, now)
    fatal = [p for p in problems if is_fatal(p)]
    if isinstance(data, dict) and data.get("source") not in (None, source) \
            and data.get("source") in SOURCES:
        fatal.append(f"{path} carries source {data.get('source')!r}, expected {source!r}")
    if fatal:
        state["reason"] = f"{path} fails the contract: {fatal[0]}"
        return state, []
    updated = parse_ts(data["updated_at"])
    state["updated_at"] = iso(updated)
    items = data["items"]
    if items and len(per_item) > BAD_SHARE * len(items):
        state["reason"] = (f"{path}: {len(per_item)} of {len(items)} posts fail the "
                           f"contract (first: {next(iter(per_item.values()))[0]})")
        return state, []
    if updated - now > timedelta(minutes=CLOCK_SKEW_MINUTES):
        # a write stamped in the future would otherwise never look stale
        state["reason"] = f"{path} claims it was written in the future ({iso(updated)})"
        return state, []
    if now - updated > timedelta(hours=PAUSE_HOURS):
        hours = (now - updated).total_seconds() / 3600
        state["reason"] = f"{path} last written {hours:.0f}h ago (limit {PAUSE_HOURS}h)"
        return state, []
    fresh = []
    for i, it in enumerate(items):
        if i in per_item:
            continue
        fresh.append({
            "u": it["url"],
            "d": int(parse_ts(it["posted_at"]).timestamp()),
            "fd": int(parse_ts(it["found_at"]).timestamp()),
            "from": it["from"].strip(),
            "name": it["name"].strip(),
            "summary": re.sub(r"\s+", " ", it["summary"]).strip(),
            "kind": it["kind"],
            "ch": ch,
            "local": local_guess(ch, it["summary"]),
        })
    state["paused"] = False
    if per_item:
        state["dropped"] = len(per_item)
    narrated = sum(1 for item in fresh if NARRATOR.search(item["summary"]))
    if narrated:
        state["narrated"] = narrated
    return state, fresh


def local_guess(ch, summary):
    """Whether an inbox post is local, until tag_wire.py decides. Every
    Facebook group is local, and that stays mechanical. The X shortlist mixes
    Vermont accounts with national desks, so an X post is only guessed local
    when its text names Burlington or Vermont; the tagger's `local` verdict
    replaces the guess (a national desk on Vermont is local, WCAX on a South
    Carolina trial is not). An untagged post with no place named waits in
    Everything rather than putting a national story on Local."""
    if ch == "facebook":
        return True
    region, _ = wc.place_of(summary)
    return region in ("btv", "away", "vt")


def merge_items(previous, fresh, now):
    """Union by URL, newest first, last KEEP_DAYS, at most CAP. A post seen
    again takes the bot's newest wording but keeps its first-seen time."""
    by_url = {}
    for item in previous or []:
        if isinstance(item, dict) and item.get("u"):
            by_url[item["u"]] = dict(item)
    added = 0
    for item in fresh:
        held = by_url.get(item["u"])
        if held is None:
            by_url[item["u"]] = dict(item)
            added += 1
        else:
            fd = min(held.get("fd", item["fd"]), item["fd"])
            held.update(item)
            held["fd"] = fd
    cutoff = int((now - timedelta(days=KEEP_DAYS)).timestamp())
    kept = [item for item in by_url.values() if item.get("d", 0) >= cutoff]
    kept.sort(key=lambda item: item.get("d", 0), reverse=True)
    return kept[:CAP], added


def read_inbox(previous_inbox, now=None, token=None, fetch=fetch_file):
    """-> (inbox_dict, added_count, changed). `previous_inbox` is the last
    payload's `inbox` key (or None). `changed` is true when a source paused,
    resumed, or brought something new — a change worth publishing even on a
    run with no new headlines."""
    now = now or datetime.now(timezone.utc)
    token = token if token is not None else os.environ.get(TOKEN_ENV, "")
    previous_inbox = previous_inbox if isinstance(previous_inbox, dict) else {}
    out, added_total, changed = {}, 0, False
    for ch, (path, _source) in FILES.items():
        prev = previous_inbox.get(ch) if isinstance(previous_inbox.get(ch), dict) else {}
        if not token:
            state, fresh = {"paused": True, "reason": f"no {TOKEN_ENV} secret",
                            "updated_at": prev.get("updated_at"), "checked": iso(now),
                            "pause_after_hours": PAUSE_HOURS}, []
        else:
            status, raw = fetch(path, token)
            if status == "ok":
                state, fresh = read_one(ch, raw, now)
            else:
                state = {"paused": True, "updated_at": prev.get("updated_at"),
                         "reason": (f"{path} is missing" if status == "missing"
                                    else f"{path} could not be fetched ({status})"),
                         "checked": iso(now), "pause_after_hours": PAUSE_HOURS}
                fresh = []
        items, added = merge_items(prev.get("items"), fresh, now)
        state["n"] = len(items)
        state["items"] = items
        out[ch] = state
        added_total += added
        if added or bool(prev.get("paused")) != state["paused"] or not prev:
            changed = True
    # Grok's recaps: their own file and shape, the same pause rules
    prev = previous_inbox.get("recaps") if isinstance(previous_inbox.get("recaps"), dict) else {}
    if not token:
        state, fresh = {"paused": True, "reason": f"no {TOKEN_ENV} secret",
                        "updated_at": prev.get("updated_at"), "checked": iso(now),
                        "pause_after_hours": PAUSE_HOURS}, []
    else:
        status, raw = fetch(RECAP_PATH, token)
        if status == "ok":
            state, fresh = read_recaps(raw, now)
        else:
            state = {"paused": True, "updated_at": prev.get("updated_at"),
                     "reason": (f"{RECAP_PATH} is missing" if status == "missing"
                                else f"{RECAP_PATH} could not be fetched ({status})"),
                     "checked": iso(now), "pause_after_hours": PAUSE_HOURS}
            fresh = []
    recaps, added = merge_recaps(prev.get("items"), fresh, now)
    state["n"] = len(recaps)
    state["items"] = recaps
    out["recaps"] = state
    added_total += added
    # a recap file that is still missing (the bot has not written one yet)
    # changes nothing worth a publish on its own
    if added or (prev and bool(prev.get("paused")) != state["paused"]):
        changed = True
    return out, added_total, changed


def summary_line(inbox):
    parts = []
    for ch, state in inbox.items():
        if state["paused"]:
            parts.append(f"{ch} paused ({state['reason']})")
        else:
            extra = f", {state['dropped']} posts dropped" if state.get("dropped") else ""
            if state.get("narrated"):
                extra += f", {state['narrated']} narrate the poster"
            parts.append(f"{ch} ok ({state['n']} held{extra})")
    return "wire inbox: " + "; ".join(parts)


# --- selftest ------------------------------------------------------------------

def _fixture(now, **over):
    data = {
        "source": "grok-x", "updated_at": iso(now - timedelta(hours=1)),
        "run_note": "2 new", "items": [
            {"url": "https://x.com/wcax/status/2", "from": "@wcax", "name": "WCAX",
             "summary": "I-89 northbound closed at exit 14 after a rollover.",
             "posted_at": iso(now - timedelta(hours=2)),
             "found_at": iso(now - timedelta(hours=1)), "kind": "post"},
            {"url": "https://x.com/nws/status/1", "from": "@NWSBurlington",
             "name": "NWS Burlington", "summary": "Frost advisory tonight, 2 to 8 am.",
             "posted_at": iso(now - timedelta(hours=3)),
             "found_at": iso(now - timedelta(hours=1)), "kind": "post"},
        ]}
    data.update(over)
    return json.dumps(data).encode()


def selftest():
    now = datetime(2026, 10, 16, 20, 0, tzinfo=timezone.utc)
    state, fresh = read_one("x", _fixture(now), now)
    assert not state["paused"] and len(fresh) == 2 and fresh[0]["ch"] == "x"
    # X: a guess from the text until the tagger decides; Facebook: always local
    assert [item["local"] for item in fresh] == [False, False], fresh
    assert local_guess("x", "Vermont governor signs the housing bill") is True
    assert local_guess("x", "Winooski council votes on rents") is True
    assert local_guess("x", "Senate passes the spending bill") is False
    assert local_guess("facebook", "Anyone know a good plumber?") is True
    for narrated in ("Someone is sharing the Haunted Hustle 5K on October 24",
                     "A member is asking where to find dry ice",
                     "Burlington Area History is sharing a photo of Church Street in 1950"):
        assert NARRATOR.search(narrated), narrated
    for own in ("Haunted Hustle 5K, October 24 at 3:30", "Where can I find dry ice?",
                "Frost advisory tonight, 2 to 8 am.", "Saturday morning run from the waterfront, 8am. Who's in?",
                "Senate passes the spending bill; the House votes Friday",
                "President Trump said he delayed further sanctions"):   # news, not narration
        assert not NARRATOR.search(own), own
    stale = _fixture(now, updated_at=iso(now - timedelta(hours=19)))
    state, fresh = read_one("x", stale, now)
    assert state["paused"] and "19h" in state["reason"] and fresh == []
    state, _ = read_one("x", b"{not json", now)
    assert state["paused"] and "not valid JSON" in state["reason"]
    state, _ = read_one("x", _fixture(now, source="muse-facebook"), now)
    assert state["paused"] and "expected 'grok-x'" in state["reason"]
    inbox, added, changed = read_inbox(None, now, token="")
    assert inbox["x"]["paused"] and "no WIRE_INBOX_TOKEN" in inbox["x"]["reason"]
    assert added == 0 and changed
    inbox, added, _ = read_inbox(None, now, token="t",
                                 fetch=lambda path, tok: ("ok", _fixture(now)) if path.startswith("grok")
                                 else ("missing", None))
    assert added == 2 and not inbox["x"]["paused"] and inbox["facebook"]["paused"]
    assert inbox["facebook"]["reason"] == "muse/facebook.json is missing"
    print("selftest ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--file", nargs=2, metavar=("CH", "PATH"))
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    if args.file:
        ch, path = args.file
        with open(path, "rb") as src:
            state, fresh = read_one(ch, src.read(), datetime.now(timezone.utc))
        print(json.dumps(dict(state, fresh=len(fresh)), indent=1))
        return
    inbox, added, _ = read_inbox(None)
    print(summary_line(inbox), f"({added} new)")


if __name__ == "__main__":
    main()
