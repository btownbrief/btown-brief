#!/usr/bin/env python3
"""All Day's Watch tab, the time machine: data/time-machine.json.

What was big, month by month, for the last five years, so a reader can
find the hits of October 2021 and watch them at home.

Where the titles come from. Rotten Tomatoes' front page is the best "what
is big right now" page there is, and it keeps no archive of itself. The
Wayback Machine does: it has a copy of rottentomatoes.com from nearly every
day since the 1990s. For each month this script asks the Wayback Machine's
CDX index for one copy of the front page from the middle of the month (the
15th or the first one after it; the 1st if the month is too young),
fetches that copy once, and reads the TITLES listed under three shelves:

  theaters   "Top 10 Box Office" first, then "Popular in Theaters" /
             "Movies in Theaters" / "Now in Theaters" (the shelf's name
             changed over the years)
  streaming  "Popular Streaming Movies"
  tv         "Most Popular TV on RT" / "Popular TV"

A title and the month it was popular are facts. Nothing else is taken from
Rotten Tomatoes: no scores, no words, no pictures, no links. Every title
is matched to The Movie Database (TMDB) and from then on it is a TMDB
title: its id, poster path, year, genres and overview come from TMDB's API
under the same attribution as data/films.json. A title TMDB cannot match
exactly is left out rather than guessed.

Two steps, because archive.org refuses connections from GitHub's runners
(verified 2026-10-17: "Connection refused" on every request from Actions,
while the same requests answer from a home connection):

  1. --harvest (anywhere archive.org answers, no TMDB key): read the
     archived front pages and write the TITLES ONLY to
     data/time-machine-titles.json, which is committed to the repo. Each
     listing is [kind, title, year], the year only when the listing's link
     carried one. Finished months are final; a harvest re-reads only this
     month and last month, so a monthly harvest is two pages.
  2. The workflow (monthly, with the TMDB key, --no-wayback): match every
     harvested title to TMDB and write data/time-machine.json.

When a month has no harvested titles (no usable copy, a login wall, or no
harvest yet), the month comes from TMDB itself instead: the most popular
films released in the US that month, and the most popular shows that
premiered in it. Such a month is marked `src: "tmdb"` and is matched from
the titles file as soon as a later harvest has it.

Politeness. One CDX query and one page per month, a pause between Wayback
requests, an honest user agent, a 15-minute budget per run, and it stops
asking after four failures in a row.

The file:

  { v, built, source, notice, images,
    titles: { "m603": {id, k: "movie", t, y, d, g, o, p}, "t1399": {... k: "tv"} },
    months: [ { m: "2026-10", src: "rt" | "tmdb", at: "20261015...",
                theaters: ["m1", ...], streaming: [...], tv: [...] } ]   newest first }

CLI:
  --harvest PATH  refresh the titles file at PATH from the Wayback Machine, then exit
  --titles PATH   the titles file to match (default data/time-machine-titles.json)
  --no-wayback    never ask the Wayback Machine (the workflow passes this)
  --out PATH      where to write (default data/time-machine.json)
  --prev PATH     the last good file, whose finished months are kept
  --months N      how many months back (default 60)
  --selftest      run the offline checks and exit

Monthly, on a machine where archive.org answers (Stephen's Mac):
  python3 scripts/build_time_machine.py --harvest data/time-machine-titles.json
then commit the file; the next workflow run matches it.

Failure posture, as build_films.py: no TMDB_API_KEY logs and exits 0
without writing; with a key, fewer than MIN_MONTHS usable months, or a
TMDB error, writes nothing and exits 1 so the last good file stays.
"""

import argparse
import html
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_films import IMAGES, NOTICE, POSTER, DAY, Tmdb, trim, write_json  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "data", "time-machine.json")
TITLES = os.path.join(ROOT, "data", "time-machine-titles.json")
CDX = "https://web.archive.org/cdx/search/cdx"
SNAP = "https://web.archive.org/web/{ts}id_/https://www.rottentomatoes.com/"
UA = "btown-all-day-time-machine/1.0 (+https://guide.btownbrief.com/all-day/)"
MONTHS = 60
MIN_MONTHS = 40          # fewer usable months than this is a broken run
WAYBACK_PAUSE = 1.5      # seconds between Wayback requests
ATTEMPTS = 2
TIMEOUT = 45             # seconds for one Wayback request
BUDGET = 15 * 60         # seconds of Wayback asking per run; the rest of the months come from TMDB
GIVE_UP = 4              # Wayback requests failing in a row before this run stops asking
CAP = {"theaters": 12, "streaming": 12, "tv": 12}
OVERVIEW_MAX = 180
MIN_TITLES = 6           # a copy with fewer titles than this is a wall, not a front page
RETRY = 12               # older months that fell back to TMDB, asked of the Wayback Machine again per run

# the shelves, in the order their titles are taken
SECTIONS = {
    "theaters": ["top 10 box office", "top box office", "popular in theaters", "movies in theaters", "now in theaters"],
    "streaming": ["popular streaming movies", "most popular streaming movies"],
    "tv": ["most popular tv on rt", "popular tv", "most popular tv now", "popular tv on rt"],
}
HEAD = re.compile(r"<h2\b[^>]*>(.*?)</h2>", re.S | re.I)
LINK = re.compile(r'<a\b[^>]*?href="(?:https?://(?:www\.)?rottentomatoes\.com)?/(m|tv)/([A-Za-z0-9_-]+)(?:/s\d+)?/?"[^>]*>(.*?)</a>',
                  re.S | re.I)
SLUG_YEAR = re.compile(r"_((?:19|20)\d{2})$")
SEASON = re.compile(r"\s*:\s*S(?:eason\s*)?\d+$", re.I)


def log(msg):
    print("build_time_machine: " + msg, file=sys.stderr)


def utcnow():
    return datetime.now(timezone.utc)


def text(fragment):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment or ""))).strip()


def norm(title):
    t = unicodedata.normalize("NFKD", str(title or "")).encode("ascii", "ignore").decode().lower()
    t = t.replace("&", "and")
    return re.sub(r"[^a-z0-9]+", "", t)


# ------------------------------------------------------------- the months
def month_list(today, n):
    """['2026-10', '2026-09', ...], n months, newest first."""
    y, m = today.year, today.month
    out = []
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    return out


# ------------------------------------------------------------ the page
def extract(doc):
    """{theaters: [(kind, slug, title)], streaming: [...], tv: [...]} from one
    archived front page: the links under each shelf's heading, in order,
    one per title. Titles only; a link with no text is skipped."""
    heads = [(m.start(), text(m.group(1)).lower()) for m in HEAD.finditer(doc or "")]
    out = {}
    for shelf, names in SECTIONS.items():
        rows, seen = [], set()
        for name in names:
            for i, (pos, head) in enumerate(heads):
                if head != name:
                    continue
                end = heads[i + 1][0] if i + 1 < len(heads) else len(doc)
                for m in LINK.finditer(doc[pos:end]):
                    kind, slug, inner = m.groups()
                    title = SEASON.sub("", re.sub(r"\s*\d{1,3}%", "", text(inner))).strip()
                    key = (kind, slug.lower())
                    if not title or key in seen or len(title) > 160:
                        continue
                    seen.add(key)
                    rows.append(("movie" if kind == "m" else "tv", slug.lower(), title))
        out[shelf] = rows
    return out


class Wayback:
    """The Wayback Machine, asked politely and within a budget: past BUDGET
    seconds, or after GIVE_UP failed requests in a row, this run stops asking
    and every remaining month comes from TMDB (and is asked again next run)."""

    def __init__(self, opener=None, pause=WAYBACK_PAUSE, budget=BUDGET, clock=time.monotonic):
        self.opener = opener or self._open
        self.pause = pause
        self.calls = 0
        self.clock = clock
        self.deadline = clock() + budget
        self.failing = 0
        self.stopped = False

    def usable(self):
        if not self.stopped and (self.failing >= GIVE_UP or self.clock() > self.deadline):
            self.stopped = True
            log("the Wayback Machine is " + ("not answering" if self.failing >= GIVE_UP else "out of this run's time")
                + "; the remaining months come from TMDB this run")
        return not self.stopped

    def _open(self, url):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            body = r.read()
        if body[:2] == b"\x1f\x8b":   # the copy as it was served, gzip and all
            import gzip
            body = gzip.decompress(body)
        return body.decode("utf-8", "replace")

    def get(self, url):
        for attempt in range(ATTEMPTS):
            if not self.usable():
                return None
            self.calls += 1
            try:
                out = self.opener(url)
                self.failing = 0
                time.sleep(self.pause)
                return out
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    self.failing = 0
                    return None
                log(f"wayback HTTP {e.code}, retrying")
            except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
                log(f"wayback {e}, retrying")
            time.sleep(self.pause * (2 + attempt * 2))
        self.failing += 1
        return None

    def snapshots(self, month):
        """Timestamps of 200 HTML copies of the front page in the month,
        from the 15th on first, then from the 1st."""
        ym = month.replace("-", "")
        out = []
        for start in (ym + "15", ym + "01"):
            q = urllib.parse.urlencode([("url", "rottentomatoes.com/"), ("from", start), ("to", ym),
                                        ("filter", "statuscode:200"), ("filter", "mimetype:text/html"),
                                        ("limit", "4"), ("output", "json")])
            raw = self.get(CDX + "?" + q)
            try:
                rows = json.loads(raw) if raw else []
            except ValueError:
                rows = []
            for r in rows[1:]:
                if isinstance(r, list) and len(r) > 1 and re.match(r"^\d{14}$", str(r[1])) and r[1] not in out \
                        and r[1].startswith(ym):
                    out.append(r[1])
            if out:
                break
        return out

    def month(self, month):
        """(timestamp, shelves) from the first copy in the month that reads
        as a front page, or (None, None)."""
        if not self.usable():
            return None, None
        for ts in self.snapshots(month)[:3]:
            doc = self.get(SNAP.format(ts=ts))
            shelves = extract(doc or "")
            if sum(len(v) for v in shelves.values()) >= MIN_TITLES:
                return ts, shelves
        return None, None


# ------------------------------------------------------------- matching
class Matcher:
    def __init__(self, api):
        self.api = api
        self.cache = {}
        self.genres = {}

    def genre_names(self, kind):
        if kind not in self.genres:
            data = self.api.get(f"/genre/{kind}/list", language="en-US") or {}
            self.genres[kind] = {g["id"]: g["name"] for g in data.get("genres") or []
                                 if isinstance(g, dict) and isinstance(g.get("id"), int) and g.get("name")}
        return self.genres[kind]

    def item(self, kind, row):
        """A TMDB search result in the file's shape."""
        names = self.genre_names(kind)
        day = str(row.get("release_date" if kind == "movie" else "first_air_date") or "")
        poster = str(row.get("poster_path") or "")
        return {
            "id": row["id"],
            "k": kind,
            "t": trim(str(row.get("title" if kind == "movie" else "name") or ""), 120),
            "y": int(day[:4]) if DAY.match(day) else None,
            "d": day if DAY.match(day) else "",
            "g": [names[i] for i in row.get("genre_ids") or [] if i in names][:4],
            "o": trim(str(row.get("overview") or ""), OVERVIEW_MAX),
            "p": poster if POSTER.match(poster) else "",
        }

    def match(self, kind, title, month, hint=None):
        """The TMDB title this listing means, or None. The title must match
        exactly (ignoring case, accents and punctuation); among exact
        matches, one released by that month, closest to it, then the most
        popular. A year from the listing's link (/m/dune_2021) must agree."""
        year = int(month[:4])
        limit = year + (1 if month.endswith("-12") else 0)
        key = (kind, norm(title), hint, year, limit)
        if key in self.cache:
            return self.cache[key]
        data = self.api.get(f"/search/{kind}", query=title, include_adult="false", language="en-US") or {}
        want = norm(title)
        best = None
        for r in data.get("results") or []:
            if not isinstance(r, dict) or not isinstance(r.get("id"), int) or r.get("adult"):
                continue
            names = {norm(r.get("title")), norm(r.get("original_title")), norm(r.get("name")), norm(r.get("original_name"))}
            if want not in names:
                continue
            day = str(r.get("release_date" if kind == "movie" else "first_air_date") or "")
            y = int(day[:4]) if DAY.match(day) else None
            if y is None or y > limit:
                continue
            if hint and abs(y - hint) > 1:
                continue
            pop = r.get("popularity") if isinstance(r.get("popularity"), (int, float)) else 0
            # a show's first season can be years before the month it is popular:
            # by popularity alone; a film by how close to the month, then popularity
            rank = (0 if kind == "tv" else abs(year - y), -pop)
            if best is None or rank < best[0]:
                best = (rank, r)
        out = self.item(kind, best[1]) if best else None
        self.cache[key] = out
        return out

    def discover(self, month):
        """A month the Wayback Machine could not give: TMDB's most popular
        US releases and premieres of that month."""
        y, m = (int(x) for x in month.split("-"))
        first = f"{month}-01"
        last = f"{y + (m == 12):04d}-{(m % 12) + 1:02d}-01"
        films = self.api.get("/discover/movie", region="US", language="en-US", sort_by="popularity.desc",
                             include_adult="false", with_release_type="2|3", **{
                                 "release_date.gte": first, "release_date.lt": last, "vote_count.gte": 20}) or {}
        shows = self.api.get("/discover/tv", language="en-US", sort_by="popularity.desc", **{
            "first_air_date.gte": first, "first_air_date.lt": last, "vote_count.gte": 20}) or {}
        pick = lambda data, kind: [self.item(kind, r) for r in data.get("results") or []
                                   if isinstance(r, dict) and isinstance(r.get("id"), int) and not r.get("adult")]
        return {"theaters": pick(films, "movie")[:CAP["theaters"]], "streaming": [], "tv": pick(shows, "tv")[:CAP["tv"]]}


def tkey(item):
    return ("m" if item["k"] == "movie" else "t") + str(item["id"])


def rows(shelves):
    """Shelves as extract() reads them, as the titles file keeps them:
    [kind, title, year or None], the year only when the link carried one."""
    out = {}
    for shelf, listed in shelves.items():
        out[shelf] = []
        for kind, slug, title in listed:
            m = SLUG_YEAR.search(slug)
            out[shelf].append([kind, title, int(m.group(1)) if m else None])
    return out


def harvest(months, wayback, prev=None, keep_from=2):
    """The titles file: for each month, the archived copy's timestamp and its
    shelves' titles. Months already in `prev` are final, except the newest
    `keep_from`, which can still change. Needs no TMDB key."""
    prev = prev if isinstance(prev, dict) else {}
    old = prev.get("months") if isinstance(prev.get("months"), dict) else {}
    out = {}
    for i, month in enumerate(months):
        if i >= keep_from and month in old:
            out[month] = old[month]
            continue
        ts, shelves = wayback.month(month)
        if ts:
            out[month] = {"at": ts, **rows(shelves)}
        elif month in old:
            out[month] = old[month]
    return {"v": 1, "source": "Titles listed on rottentomatoes.com's front page, read from the Wayback Machine's copies",
            "months": dict(sorted(out.items(), reverse=True))}


def build(months, wayback, matcher, prev=None, keep_from=2, retry=None, harvested=None):
    """The file's titles and months. A month's titles come from the titles
    file (`harvested`, read from the Wayback Machine where it answers), or
    from asking the Wayback Machine now, or else from TMDB discover.

    A month from `prev` is kept as it was unless it is one of the newest
    `keep_from` months, which can still change; or it fell back to TMDB and
    the titles file now has it; or it fell back to TMDB and is one of the
    first `retry` such months, asked of the Wayback Machine again (so a run
    never re-reads more than keep_from + retry archived months)."""
    retry = RETRY if retry is None else retry
    prev = prev if isinstance(prev, dict) else {}
    harvested = harvested if isinstance(harvested, dict) else {}
    old_titles = prev.get("titles") if isinstance(prev.get("titles"), dict) else {}
    old = {m.get("m"): m for m in prev.get("months") or [] if isinstance(m, dict)}
    titles, out = {}, []
    for i, month in enumerate(months):
        o = old.get(month)
        have = month in harvested
        again = i >= keep_from and o is not None and o.get("src") != "rt" and not have and wayback is not None and retry > 0
        if again:
            retry -= 1
        if i >= keep_from and o is not None and (o.get("src") == "rt" or not (have or again)):
            row = {"m": month, "src": "rt" if o.get("src") == "rt" else "tmdb", "at": o.get("at", "")}
            for shelf in CAP:
                row[shelf] = [k for k in o.get(shelf) or [] if k in old_titles]
                for k in row[shelf]:
                    titles[k] = old_titles[k]
            out.append(row)
            continue
        if have:
            ts, listed = str(harvested[month].get("at") or "h"), harvested[month]
        elif wayback is not None:
            ts, shelves = wayback.month(month)
            listed = rows(shelves) if ts else {}
        else:
            ts, listed = None, {}
        row = {"m": month, "src": "rt" if ts else "tmdb", "at": ts or ""}
        if ts:
            for shelf in CAP:
                keys = []
                for entry in listed.get(shelf) or []:
                    if not (isinstance(entry, list) and len(entry) == 3 and entry[0] in ("movie", "tv") and isinstance(entry[1], str)):
                        continue
                    kind, title, hint = entry
                    if (kind == "tv") != (shelf == "tv"):
                        continue
                    item = matcher.match(kind, title, month, hint if isinstance(hint, int) else None)
                    if item and tkey(item) not in keys:
                        keys.append(tkey(item))
                        titles[tkey(item)] = item
                    if len(keys) >= CAP[shelf]:
                        break
                row[shelf] = keys
            if sum(len(row[s]) for s in CAP) < MIN_TITLES:
                ts = None
                row = {"m": month, "src": "tmdb", "at": ""}
        if not ts:
            got = matcher.discover(month)
            for shelf in CAP:
                row[shelf] = [tkey(x) for x in got[shelf]]
                for x in got[shelf]:
                    titles[tkey(x)] = x
        out.append(row)
    return titles, out


def payload(titles, months, built):
    return {
        "v": 1,
        "built": built.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Titles from the Wayback Machine's copies of rottentomatoes.com's front page; details and posters from TMDB",
        "notice": NOTICE,
        "images": IMAGES,
        "titles": titles,
        "months": months,
    }


def read_json(path):
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as src:
            return json.load(src)
    except (OSError, ValueError):
        return None


def run_harvest(args, wayback=None):
    """--harvest: refresh the titles file from the Wayback Machine. No TMDB
    key needed. Run where archive.org answers (it refuses GitHub's runners)."""
    wayback = wayback or Wayback()
    doc = harvest(month_list(utcnow().date(), args.months), wayback, read_json(args.harvest))
    if not doc["months"]:
        log("the Wayback Machine gave no months; keeping the titles file")
        return 1
    write_json(args.harvest, doc)
    log(f"wrote {args.harvest}: {len(doc['months'])} months, {wayback.calls} Wayback requests")
    return 0


def run(args, api=None, wayback=None):
    if getattr(args, "harvest", ""):
        return run_harvest(args, wayback)
    key = os.environ.get("TMDB_API_KEY", "").strip()
    if not key and api is None:
        log("no TMDB_API_KEY; keeping the last file")
        return 0
    api = api or Tmdb(key)
    if wayback is None and not getattr(args, "no_wayback", False):
        wayback = Wayback()
    prev = read_json(args.prev)
    harvested = (read_json(getattr(args, "titles", "")) or {}).get("months")
    try:
        titles, months = build(month_list(utcnow().date(), args.months), wayback, Matcher(api), prev,
                               harvested=harvested if isinstance(harvested, dict) else None)
    except urllib.error.HTTPError as e:
        log(f"TMDB said HTTP {e.code}; keeping the last file")
        return 1
    except Exception as e:  # noqa: BLE001 — any trouble keeps the last good file
        log(f"{e}; keeping the last file")
        return 1
    good = [m for m in months if sum(len(m[s]) for s in CAP) >= MIN_TITLES]
    if len(good) < min(MIN_MONTHS, args.months):
        log(f"only {len(good)} usable months; keeping the last file")
        return 1
    write_json(args.out, payload(titles, months, utcnow()))
    rt = sum(1 for m in months if m["src"] == "rt")
    log(f"wrote {args.out}: {len(months)} months ({rt} from the Wayback Machine, {len(months) - rt} from TMDB), "
        f"{len(titles)} titles, {wayback.calls if wayback else 0} Wayback requests, {api.calls} TMDB calls")
    return 0


# --------------------------------------------------------------- selftest
def selftest():
    sys.path.insert(0, os.path.join(ROOT, "tests"))
    import unittest
    suite = unittest.defaultTestLoader.loadTestsFromName("test_build_time_machine")
    ok = unittest.TextTestRunner(verbosity=1).run(suite).wasSuccessful()
    if not ok:
        sys.exit(1)
    print("selftest ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=OUT)
    parser.add_argument("--prev", default="")
    parser.add_argument("--months", type=int, default=MONTHS)
    parser.add_argument("--titles", default=TITLES, help="the titles file to match (default data/time-machine-titles.json)")
    parser.add_argument("--no-wayback", action="store_true", help="never ask the Wayback Machine (it refuses GitHub's runners)")
    parser.add_argument("--harvest", default="", metavar="PATH", help="refresh the titles file at PATH from the Wayback Machine and exit")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    sys.exit(run(args))


if __name__ == "__main__":
    main()
