#!/usr/bin/env python3
"""The Wire's inbox reader: X posts (Grok Bot) and Facebook group posts (Muse).

Two bots drop files in the private repo btownbrief/wire-inbox:

  grok/x.json         X posts from a shortlist of Burlington and Vermont accounts
  muse/facebook.json  posts from public Facebook groups

refresh_pulse.py calls read_inbox() each run. This module fetches both files
through the GitHub contents API with the WIRE_INBOX_TOKEN secret, checks them
against the same rules as the inbox's own validator (scripts/validate_inbox.py
in that repo, ported here so this side never trusts the other side's CI), and
merges the surviving posts into pulse.json under its own `inbox` key:

  "inbox": {
    "x":        {"paused": false, "reason": null, "updated_at": "...",
                 "checked": "...", "pause_after_hours": 18, "n": 12,
                 "items": [{"u", "d", "fd", "from", "name", "summary",
                            "kind", "ch": "x", "local": true}, ...]},
    "facebook": {...same shape, "ch": "facebook"...}
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
KEEP_DAYS = 7        # README: "Keep the last 7 days"
CAP = 300            # README: "At most 300"
BAD_SHARE = 0.5      # more than half the posts failing = a bad file

# --- the contract, ported from wire-inbox/scripts/validate_inbox.py --------
SOURCES = {"grok-x", "muse-facebook"}
KINDS = {"post", "recap", "listing"}
MAX_ITEMS = 300
MAX_SUMMARY = 200
MAX_AGE_DAYS = 7
HTTPS = re.compile(r"^https://[^\s]+$")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE = re.compile(r"(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)")
SHOUTY = re.compile(r"\bBREAKING\b|#\w+|[\U0001F300-\U0001FAFF]")


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
            if (now - posted).days > MAX_AGE_DAYS:
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
            "local": True,   # both shortlists are Burlington and Vermont sources
        })
    state["paused"] = False
    if per_item:
        state["dropped"] = len(per_item)
    return state, fresh


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
    return out, added_total, changed


def summary_line(inbox):
    parts = []
    for ch, state in inbox.items():
        if state["paused"]:
            parts.append(f"{ch} paused ({state['reason']})")
        else:
            extra = f", {state['dropped']} posts dropped" if state.get("dropped") else ""
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
