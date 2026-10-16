#!/usr/bin/env python3
"""Build data/games-catalog.json, the Games tab's list of the arcade.

The arcade (play.btownbrief.com, the btownbrief/btownbrief.github.io repo)
lists every game in its games.json: slug, name, emoji, pitch, section, live
and leaderboard flags. What it does not have is a date, and the tab's "New
this month" needs one. So this reads the file's own git history: the first
commit on the arcade's main branch whose games.json names a slug is when that
game arrived (`first_seen`), and the first one that names it with
"live": true is when you could play it (`live_since`). Committer dates,
first-parent only, so a branch merged today counts from today and not from
whenever its first commit was written.

Output, about 15 KB:

  {
    "generated": "2026-10-16T18:00:00Z",
    "source": "btownbrief/btownbrief.github.io@<sha>",
    "sections": [{"id", "title", "description"}],
    "games": [{"slug", "name", "emoji", "pitch", "section", "live",
               "leaderboard", "boardHint"?, "where"?, "first_seen", "live_since"}]
  }

Dates are Burlington calendar days, YYYY-MM-DD. Games keep the arcade's
order, which is the order its hub shows them in.

`rooms: true` marks the games a neighbor can be challenged to. The list is
the Hangout's own allowlist (church-street-hangout/js/challenge.js, GAMES),
read fresh each run, and a game only keeps the flag while its live page on
play.btownbrief.com still opens a room from a ?join=CODE link. When either
check cannot be made (the network), the last catalog's answer stands.

Failure posture: if the arcade cannot be cloned, or its games.json does not
parse, the last good file stays where it is and the run exits 0 with a
warning. A catalog that is a day old is fine; an empty one would blank the
tab. Pass --strict to fail instead (for running it by hand).

Run:  python3 scripts/build_games.py
      python3 scripts/build_games.py --arcade ~/btownbrief/btownbrief.github.io
"""

from __future__ import annotations

import argparse
import datetime as dt
import http.client
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import urllib.request
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "games-catalog.json"
ARCADE_GIT = "https://github.com/btownbrief/btownbrief.github.io.git"
TZ = ZoneInfo("America/New_York")
SLUG_OK = set("abcdefghijklmnopqrstuvwxyz0123456789-")
# the only fields the tab reads; anything else in games.json stays there
KEEP = ("slug", "name", "emoji", "pitch", "section", "live", "leaderboard", "boardHint", "where")

CHALLENGE_JS = "https://raw.githubusercontent.com/btownbrief/church-street-hangout/main/js/challenge.js"
GAME_MAIN = "https://play.btownbrief.com/{slug}/js/main.js"
UA = {"User-Agent": "Mozilla/5.0 (compatible; btown-brief/1.0; +https://btownbrief.com)"}
# the join flow every room game shares: ?join=ABCD fills the code in and joins
JOIN_RE = re.compile(r"""get\(\s*['"]join['"]\s*\)""")


def fetch(url: str) -> str:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
        return r.read().decode("utf-8", "replace")


NET_ERRORS = (OSError, ValueError, http.client.HTTPException)


def old_rooms(previous: dict | None) -> set[str]:
    games = previous.get("games") if isinstance(previous, dict) else None
    return {g["slug"] for g in games if isinstance(g, dict) and g.get("rooms") and isinstance(g.get("slug"), str)} \
        if isinstance(games, list) else set()


def room_games(previous: dict | None) -> set[str] | None:
    """The slugs that can host a challenge today, or None when unknown."""
    try:
        src = fetch(CHALLENGE_JS)
        listed = src.split("export const GAMES", 1)[1].split("];", 1)[0]
        slugs = re.findall(r"""slug:\s*['"`]([a-z0-9-]+)['"`]""", listed)
    except (*NET_ERRORS, IndexError):
        return None
    if not slugs:
        return None  # the file changed shape, not the list: don't empty it on a parse
    ok = set()
    before = old_rooms(previous)
    for slug in slugs:
        try:
            if JOIN_RE.search(fetch(GAME_MAIN.format(slug=slug))):
                ok.add(slug)
        except NET_ERRORS:
            if slug in before:
                ok.add(slug)  # unreachable this morning: yesterday's answer stands
    return ok


def git(repo: pathlib.Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True, timeout=120).stdout


def clone(dest: pathlib.Path) -> pathlib.Path:
    # Blobless: the whole history of commits and trees, blobs fetched as
    # git show asks for them. The repo is public, so no token is needed.
    subprocess.run(["git", "clone", "--quiet", "--filter=blob:none", "--no-checkout", ARCADE_GIT, str(dest)],
                   check=True, capture_output=True, text=True, timeout=180)
    return dest


def et_day(iso: str) -> str:
    return dt.datetime.fromisoformat(iso).astimezone(TZ).date().isoformat()


def games_of(text: str) -> list[dict]:
    data = json.loads(text)
    games = data.get("games") if isinstance(data, dict) else None
    return [g for g in games or [] if isinstance(g, dict) and isinstance(g.get("slug"), str)]


def history(repo: pathlib.Path, ref: str) -> tuple[dict[str, str], dict[str, str]]:
    """slug -> first day it appears, and slug -> first day it appears live."""
    log = git(repo, "log", "--first-parent", "--reverse", "--format=%H %cI", ref, "--", "games.json")
    first: dict[str, str] = {}
    live: dict[str, str] = {}
    for line in log.splitlines():
        sha, iso = line.split(" ", 1)
        try:
            text = git(repo, "show", sha + ":games.json")
        except subprocess.CalledProcessError:
            # Deleted in that commit teaches nothing. But the clone is blobless,
            # so a failed lazy fetch of a file that IS there must stop the run
            # (and keep the last catalog) rather than shift a game's date.
            if git(repo, "ls-tree", sha, "--", "games.json").strip():
                raise
            continue
        try:
            games = games_of(text)
        except json.JSONDecodeError:
            continue  # a commit that broke the file teaches nothing
        day = et_day(iso)
        for g in games:
            first.setdefault(g["slug"], day)
            if g.get("live") is True:
                live.setdefault(g["slug"], day)
    return first, live


def build(repo: pathlib.Path, ref: str, rooms: set[str] | None = None) -> dict:
    head = git(repo, "rev-parse", ref).strip()
    data = json.loads(git(repo, "show", head + ":games.json"))
    first, live = history(repo, ref)
    sections = [{"id": str(s.get("id", "")), "title": str(s.get("title", "")), "description": str(s.get("description", ""))}
                for s in data.get("sections") or [] if isinstance(s, dict) and s.get("id")]
    out = []
    seen = set()
    for g in games_of(json.dumps(data)):
        slug = g["slug"]
        if slug in seen or not slug or set(slug) - SLUG_OK:
            continue  # the slug becomes a URL path; anything odd is dropped, not escaped
        seen.add(slug)
        row = {k: g[k] for k in KEEP if k in g}
        row["live"] = g.get("live") is True
        row["leaderboard"] = g.get("leaderboard") is True
        row["first_seen"] = first.get(slug)
        row["live_since"] = live.get(slug) if row["live"] else None
        row["rooms"] = bool(rooms) and slug in rooms and row["live"]
        out.append(row)
    return {
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "btownbrief/btownbrief.github.io@" + head[:12],
        "sections": sections,
        "games": out,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--arcade", help="a local clone of btownbrief.github.io (default: clone it)")
    ap.add_argument("--ref", default=None, help="branch to read (default: origin/main for a clone, main locally)")
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--strict", action="store_true", help="fail instead of keeping the last file")
    ap.add_argument("--offline", action="store_true", help="skip the room checks; keep the last catalog's")
    ap.add_argument("--allow-shrink", action="store_true", help="accept losing more than a fifth of the live games")
    args = ap.parse_args()

    dest = pathlib.Path(args.out)
    old = None
    if dest.exists():
        try:
            old = json.loads(dest.read_text())
        except json.JSONDecodeError:
            old = None
    try:
        rooms = None if args.offline else room_games(old)
        if rooms is None:
            rooms = old_rooms(old)
        with tempfile.TemporaryDirectory() as tmp:
            if args.arcade:
                repo = pathlib.Path(args.arcade).expanduser()
                ref = args.ref or "main"
            else:
                repo = clone(pathlib.Path(tmp) / "arcade")
                ref = args.ref or "origin/HEAD"
            catalog = build(repo, ref, rooms)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, json.JSONDecodeError, ValueError,
            AttributeError, TypeError, KeyError, http.client.HTTPException) as e:
        msg = f"build_games: could not read the arcade ({type(e).__name__}: {e}); keeping the last catalog"
        if args.strict:
            print(msg, file=sys.stderr)
            return 1
        print("::warning::" + msg)
        return 0

    live = [g for g in catalog["games"] if g["live"]]
    before = [g for g in (old or {}).get("games", []) if isinstance(g, dict) and g.get("live")] if isinstance(old, dict) and isinstance(old.get("games"), list) else []
    why = None
    if len(live) < 10:
        why = f"only {len(live)} live games"
    elif before and len(live) < 0.8 * len(before) and not args.allow_shrink:
        why = f"{len(live)} live games where the last catalog had {len(before)} (pass --allow-shrink if that is real)"
    if why:
        msg = f"build_games: {why}; refusing to overwrite the catalog with a probably-broken read"
        print(msg if args.strict else "::warning::" + msg, file=sys.stderr if args.strict else sys.stdout)
        return 1 if args.strict else 0

    # an arcade commit that left games.json alone must not make a commit here
    # every day just for the stamp and the sha
    same = lambda c: {k: v for k, v in c.items() if k not in ("generated", "source")}
    if isinstance(old, dict) and same(old) == same(catalog):
        print(f"build_games: {len(catalog['games'])} games, unchanged")
        return 0
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(catalog, ensure_ascii=False, indent=1) + "\n")
    print(f"build_games: wrote {dest.relative_to(ROOT) if dest.is_relative_to(ROOT) else dest}: "
          f"{len(catalog['games'])} games, {len(live)} live")
    return 0


if __name__ == "__main__":
    sys.exit(main())
