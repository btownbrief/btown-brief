#!/usr/bin/env python3
"""All Day's Watch tab — the film list: data/films.json, from TMDB.

Seven shelves, every title in the same small shape:

  top       the 300 best-rated films on The Movie Database (TMDB's own
            /movie/top_rated list, in its order). The tab's "Top rated".
  trend     the films trending on TMDB this week (/trending/movie/week),
            in its order. The tab's "Trending".
  soon      upcoming in the US (/movie/upcoming?region=US), soonest first,
            labelled theaters or streaming from TMDB's US release dates.
  now       in US theaters now (/movie/now_playing?region=US).
  tv_top    the 200 best-rated shows (/tv/top_rated).
  tv_trend  the shows trending this week (/trending/tv/week).
  tv_air    shows with an episode out this week (/tv/on_the_air), a
            season that premiered in the last two weeks (or premieres in
            the next two) first, marked `ns` (its season number) and `d`
            (the premiere date).
  stream    films coming to streaming in the US: TMDB's discover, films
            with a US digital release (release type 4) from three days ago
            to five weeks out, most popular first, kept only when first out
            in the last ~18 months (TMDB also dates old films reaching a
            new streamer), then soonest first. `d` is that digital date and
            `on` says where: the service the release's own note names
            ("Netflix"); for one already out, the subscription service
            JustWatch lists for the US (via TMDB's watch providers), else
            "Rent or buy"; else "" (the page says "Streaming").
  tv_stream new shows and new seasons coming to the big streamers
            (Netflix, Prime Video, Disney+, Apple TV, Hulu, HBO Max, HBO,
            Peacock, Paramount+; TMDB network ids checked on
            themoviedb.org/network/<id>, 2026-10-22) in the same window:
            `ns` the season (1 is a new series), `d` its first episode,
            `on` the network's name.

A show has the same shape as a film (`d` and `y` from its first air date,
`rt` its episode length) plus `sn`, its number of seasons. Show ids are
TMDB's TV ids, a separate number space from films: the page keeps them
apart (see watch.js, TV_BASE).

A film is { id, t (title), y (year), d (US release date, YYYY-MM-DD), g
(genre names), o (overview, trimmed), rt (minutes), p (poster PATH), yt
(YouTube trailer key) }, plus `where` and `d` on the soon, now and stream
shelves, and `on` on the stream shelves. A film TMDB gives a US home release
also carries `h`: the first digital or physical date (release types 4 and 5),
past or ahead, so the tab can move it to Past on that day without a rebuild.
A title with a Rotten Tomatoes score carries `tm`, the percent (`rt` is the
runtime). Only the poster's path is kept, never a picture: the page builds the URL
from `images` + a size + the path, so TMDB serves its own images. A film
with no YouTube trailer on TMDB has yt "" and the tab says so; a key is
never guessed.

TMDB's attribution travels in the file (`source`, `notice`) and the tab
prints it wherever this data shows, with TMDB's logo. The streaming
services come from JustWatch through TMDB, and TMDB's terms ask that
JustWatch is credited wherever they show: the file carries `stream_source`
and the tab credits JustWatch under the streaming row. TMDB's API is free
for non-commercial use with that attribution; its terms allow cached data
for six months, and this file is rebuilt weekly.

The score: OMDb's copy of the Rotten Tomatoes rating, asked by IMDb id (from
TMDB's external_ids), with OMDB_API_KEY in the environment. OMDb's free key
allows 1,000 requests a day: this file takes up to OMDB_MAX of them and
build_trailers.py up to 100. Answers, a "no score" included, are held for a
week in tomatoes.json beside the output, carried forward with --tomatoes-prev.
With no key it asks nothing, writes no score and no cache. Any OMDb trouble
stops the asking for that run and never fails the build.

The key: TMDB_API_KEY in the environment, either the short "API Key" (32
characters, sent as ?api_key=) or the long "API Read Access Token" (sent as
a Bearer header); both are on the same TMDB settings page, either works.

Failure posture: with no key it logs and exits 0 without writing, so the
workflow stays green until Stephen adds one, and the tab reads its baked
starter list (all-day/data/films-seed.json). With a key, any trouble (a
wrong key, TMDB down, fewer than MIN_TOP films back) writes nothing and
exits 1: the films-data branch keeps its last good file, and the failed
run is seen instead of the list quietly going stale.

CLI:
  --out PATH   where to write (default data/films.json)
  --tomatoes-prev PATH   the last score cache (default tomatoes.json beside --out)
  --selftest   run the offline checks on fixtures and exit
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "data", "films.json")
API = "https://api.themoviedb.org/3"
IMAGES = "https://image.tmdb.org/t/p/"
UA = "btown-all-day-films/1.0"
NOTICE = "This product uses the TMDB API but is not endorsed or certified by TMDB."
OMDB = "https://www.omdbapi.com/"

TOP_COUNT = 300          # 15 pages of 20
MIN_TOP = 200            # fewer than this back is a broken run, not a list
SOON_PAGES = 2
NOW_PAGES = 2
SOON_MAX = 30
NOW_MAX = 30
TREND_PAGES = 3          # 60 trending films
TV_TOP_COUNT = 200       # 10 pages
MIN_TV_TOP = 100
TV_TREND_PAGES = 2
TV_AIR_PAGES = 2
TV_AIR_MAX = 30
PREMIERE_DAYS = 14       # a season premiere this close to today is "new"
STREAM_BACK = 3          # coming to streaming: from three days ago
STREAM_AHEAD = 35        # to five weeks out
STREAM_PAGES = 2
STREAM_MAX = 24
STREAM_NEW_DAYS = 540    # a film first out more than ~18 months ago is not new to streaming
TV_STREAM_PAGES = 2
TV_STREAM_MAX = 24
PROVIDER_MAX = 40
# the streamers whose new shows and seasons count, by TMDB network id
STREAMERS = {213: "Netflix", 1024: "Prime Video", 2739: "Disney+", 2552: "Apple TV", 453: "Hulu",
             3186: "HBO Max", 49: "HBO", 3353: "Peacock", 4330: "Paramount+"}
OVERVIEW_MAX = 420
PAUSE = 0.06             # TMDB allows about 40 requests a second; we use ~15
ATTEMPTS = 3
OMDB_MAX = 800           # asks a day; build_trailers.py has 100 of the free 1,000
SCORE_DAYS = 7           # a score is asked again once it is this old

YT_KEY = re.compile(r"^[A-Za-z0-9_-]{11}$")
POSTER = re.compile(r"^/[A-Za-z0-9_-]+\.(jpg|png)$")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
IMDB = re.compile(r"^tt\d{7,10}$")

# TMDB's US release types: 2 theatrical (limited), 3 theatrical, 4 digital, 5 physical.
THEATER_TYPES = {2, 3}
DIGITAL_TYPES = {4}
HOME_TYPES = {4, 5}


def log(msg):
    print("build_films: " + msg, file=sys.stderr)


def utcnow():
    return datetime.now(timezone.utc)


def trim(value, limit):
    value = re.sub(r"\s+", " ", value or "").strip()
    if len(value) <= limit:
        return value
    cut = value[:limit - 1].rsplit(" ", 1)[0] or value[:limit - 1]
    return cut.rstrip(" ,.;:-") + "…"


def write_json(path, value):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as dst:
        json.dump(value, dst, separators=(",", ":"), ensure_ascii=False)
        dst.write("\n")


# ------------------------------------------------------------------ the API
def auth(key):
    """(extra query params, extra headers) for whichever key Stephen pasted:
    the short v3 API key goes in the query, the long read token in a header."""
    key = (key or "").strip()
    if key.count(".") == 2 and len(key) > 60:
        return {}, {"Authorization": "Bearer " + key}
    return {"api_key": key}, {}


class Tmdb:
    def __init__(self, key, opener=None):
        self.params, self.headers = auth(key)
        self.opener = opener or self._open
        self.calls = 0

    def _open(self, url, headers):
        request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", **headers})
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)

    def get(self, path, **params):
        query = urllib.parse.urlencode({**params, **self.params})
        url = API + path + ("?" + query if query else "")
        for attempt in range(ATTEMPTS):
            self.calls += 1
            try:
                out = self.opener(url, self.headers)
                time.sleep(PAUSE)
                return out
            except urllib.error.HTTPError as e:
                # 401 is a wrong key: no point asking again
                if e.code == 401:
                    raise
                if e.code == 404:
                    return None
                wait = 2 + attempt * 3 if e.code == 429 else 1 + attempt
                log(f"{path}: HTTP {e.code}, retrying in {wait}s")
                time.sleep(wait)
            except (urllib.error.URLError, TimeoutError, ValueError) as e:
                log(f"{path}: {e}, retrying")
                time.sleep(1 + attempt)
        raise RuntimeError(f"{path}: gave up after {ATTEMPTS} attempts")


class Omdb:
    """One try per title: anything but an answer raises, and score() stops."""

    def __init__(self, key, opener=None):
        self.key = key.strip()
        self.opener = opener or self._open

    def _open(self, url):
        request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)

    def score(self, imdb):
        got = self.opener(OMDB + "?" + urllib.parse.urlencode({"i": imdb, "apikey": self.key}))
        if str((got or {}).get("Response")) == "False" and re.search(r"limit|api key", str(got.get("Error")), re.I):
            raise RuntimeError("OMDb turned the request down")
        time.sleep(PAUSE)
        return tomato(got)


# ------------------------------------------------------------- the shapes
def tomato(answer):
    """The Rotten Tomatoes percent in an OMDb answer, or None."""
    for row in (answer or {}).get("Ratings") or []:
        hit = re.fullmatch(r"(\d{1,3})%", str(row.get("Value"))) if row.get("Source") == "Rotten Tomatoes" else None
        if hit and int(hit[1]) <= 100:
            return int(hit[1])
    return None


def imdb_of(detail):
    return str(((detail or {}).get("external_ids") or {}).get("imdb_id") or "")


def clean_scores(cache):
    """The cache as it is safe to use: {day, used, titles: {key: {i, at, tm?}}}."""
    cache = cache if isinstance(cache, dict) else {}
    titles = cache.get("titles") if isinstance(cache.get("titles"), dict) else {}
    keep = {k: v for k, v in titles.items() if isinstance(v, dict) and IMDB.match(str(v.get("i"))) and DAY.match(str(v.get("at")))
            and (v.get("tm") is None or (isinstance(v["tm"], int) and 0 <= v["tm"] <= 100))}
    used = cache.get("used")
    return {"day": str(cache.get("day") or ""), "used": used if isinstance(used, int) else 0, "titles": keep}


def asks_left(cache, today, limit):
    if cache["day"] != today:
        cache.update(day=today, used=0)
    return limit - cache["used"]


def score(rows, cache, omdb, today, limit):
    """rows are (key, IMDb id, title). Asks OMDb for what has no answer or one
    SCORE_DAYS old, oldest first, within the day's limit, then puts `tm` on each
    title. A title OMDb was not asked about keeps what it has. The cache ends
    up holding this run's titles only. Returns the number of asks."""
    titles = cache["titles"]
    ids = {}
    for key, imdb, _ in rows:
        ids[key] = ids.get(key) or imdb or (titles.get(key) or {}).get("i", "")
    now = date.fromisoformat(today).toordinal()
    asked = 0
    for key in sorted(ids, key=lambda k: (titles.get(k) or {}).get("at", "")):
        hit = titles.get(key)
        if not IMDB.match(ids[key]) or (hit and now - date.fromisoformat(hit["at"]).toordinal() < SCORE_DAYS):
            continue
        if asks_left(cache, today, limit) <= 0:
            break
        cache["used"] += 1
        asked += 1
        try:
            tm = omdb.score(ids[key])
        except Exception as e:  # noqa: BLE001 — a score is never worth the build
            log(f"OMDb stopped ({type(e).__name__}); what it has answered stands")
            break
        titles[key] = {"i": ids[key], "at": today, **({} if tm is None else {"tm": tm})}
    cache["titles"] = {k: titles[k] for k in ids if k in titles}
    for key, _, f in rows:
        hit = cache["titles"].get(key)
        if hit and hit.get("tm") is not None:
            f["tm"] = hit["tm"]
        elif hit:
            f.pop("tm", None)
    return asked


def pick_trailer(videos):
    """The YouTube key a reader should see: an official English trailer,
    newest first; then any trailer; then a teaser. "" when there is none."""
    rows = [v for v in (videos or []) if isinstance(v, dict) and v.get("site") == "YouTube"
            and YT_KEY.match(str(v.get("key") or ""))]
    if not rows:
        return ""

    def rank(v):
        kind = {"Trailer": 0, "Teaser": 1}.get(v.get("type"), 9)
        return (kind, 0 if v.get("official") else 1, 0 if v.get("iso_639_1") == "en" else 1,
                # newest first: invert the ISO timestamp's sort
                "".join(chr(255 - ord(c)) for c in str(v.get("published_at") or "")))

    best = sorted(rows, key=rank)[0]
    return best["key"] if rank(best)[0] < 9 else ""


def us_release(detail):
    """(date, where) from the film's US release dates: the soonest
    theatrical date if it has one, else the soonest digital one."""
    rows = []
    for country in ((detail.get("release_dates") or {}).get("results") or []):
        if country.get("iso_3166_1") != "US":
            continue
        for r in country.get("release_dates") or []:
            day = str(r.get("release_date") or "")[:10]
            if DAY.match(day):
                rows.append((day, r.get("type")))
    theater = sorted(d for d, t in rows if t in THEATER_TYPES)
    digital = sorted(d for d, t in rows if t in DIGITAL_TYPES)
    if theater:
        return theater[0], "theaters"
    if digital:
        return digital[0], "streaming"
    return "", ""


def us_digital(detail, lo, hi):
    """(date, note) of the soonest US digital release (type 4) between lo
    and hi, or ("", ""). TMDB's editors often name the service in the
    release's note ("Netflix")."""
    rows = []
    for country in ((detail.get("release_dates") or {}).get("results") or []):
        if country.get("iso_3166_1") != "US":
            continue
        for r in country.get("release_dates") or []:
            day = str(r.get("release_date") or "")[:10]
            if r.get("type") in DIGITAL_TYPES and DAY.match(day) and lo <= day <= hi:
                rows.append((day, str(r.get("note") or "")))
    return min(rows) if rows else ("", "")


def us_home(detail):
    """The first US digital or physical date, or "". An old film's only date
    is often its arrival on a new streamer, not its home release, so a date
    more than STREAM_NEW_DAYS after the film first came out does not count."""
    days = []
    for country in ((detail.get("release_dates") or {}).get("results") or []):
        if country.get("iso_3166_1") != "US":
            continue
        for r in country.get("release_dates") or []:
            day = str(r.get("release_date") or "")[:10]
            if r.get("type") in HOME_TYPES and DAY.match(day):
                days.append(day)
    if not days:
        return ""
    first, out = min(days), str(detail.get("release_date") or "")
    return "" if DAY.match(out) and first > today_minus(out, -STREAM_NEW_DAYS) else first


# a service's name as readers know it, from a release note or a JustWatch
# provider ("HBO Max Amazon Channel" is HBO Max, "Disney Plus" is Disney+);
# the specific services before Amazon, which also sells the others' channels
SERVICES = [
    (r"\bnetflix\b", "Netflix"), (r"\bhulu\b", "Hulu"), (r"\bdisney\s*(\+|plus)", "Disney+"), (r"\bhbo\b|^max\b|\bhbo max\b", "HBO Max"),
    (r"\bpeacock\b", "Peacock"), (r"\bparamount\s*(\+|plus)", "Paramount+"), (r"\bapple\s*tv\b", "Apple TV"), (r"\bshudder\b", "Shudder"),
    (r"\bmubi\b", "MUBI"), (r"\bstarz\b", "Starz"), (r"\bcriterion\b", "Criterion Channel"), (r"\btubi\b", "Tubi"),
    (r"\bamc\s*\+", "AMC+"), (r"\bcrunchyroll\b", "Crunchyroll"), (r"\bkanopy\b", "Kanopy"), (r"\bhoopla\b", "Hoopla"),
    (r"\bprime\s*video\b|\bamazon\b", "Prime Video"),
]


def service(name):
    low = str(name or "").lower().strip()
    for pattern, label in SERVICES:
        if re.search(pattern, low):
            return label
    return ""


def where_streams(detail, note, day, today):
    """Where a film streams: the service its digital release's note names;
    for a release already out, the first subscription service JustWatch
    lists for the US (via TMDB's watch providers), else "Rent or buy" when
    it is only for rent or sale; else "" (the page says "Streaming"). A
    date still ahead never borrows today's providers: a film on Hulu now
    may be coming to Netflix."""
    named = service(note)
    if named:
        return named
    if not day or day > today:
        return ""
    us = (((detail.get("watch/providers") or {}).get("results") or {}).get("US")) or {}
    for row in us.get("flatrate") or []:
        raw = str((row or {}).get("provider_name") or "")
        name = service(raw) or trim(re.sub(r"\s+(amazon|apple tv|roku premium)\s+channel$", "", raw, flags=re.I), PROVIDER_MAX)
        if name:
            return name
    if us.get("rent") or us.get("buy"):
        return "Rent or buy"
    return ""


def network(detail):
    """The streamer a show is on: the first of its networks we count."""
    for row in detail.get("networks") or []:
        if isinstance(row, dict) and row.get("id") in STREAMERS:
            return trim(str(row.get("name") or STREAMERS[row["id"]]), PROVIDER_MAX)
    return ""


def upcoming_season(detail, lo, hi):
    """(season number, date) when a season's first episode airs between lo
    and hi: the newest numbered season's air date, else the next episode
    when it is an episode one. None otherwise."""
    seasons = [s for s in detail.get("seasons") or [] if isinstance(s, dict) and isinstance(s.get("season_number"), int)
               and s["season_number"] > 0 and DAY.match(str(s.get("air_date") or ""))]
    if seasons:
        s = max(seasons, key=lambda s: s["season_number"])
        if lo <= s["air_date"] <= hi:
            return s["season_number"], s["air_date"]
    ep = detail.get("next_episode_to_air") or {}
    day = str(ep.get("air_date") or "")
    if ep.get("episode_number") == 1 and isinstance(ep.get("season_number"), int) and ep["season_number"] > 0 \
            and DAY.match(day) and lo <= day <= hi:
        return ep["season_number"], day
    return None


def film(detail, genres_by_id=None):
    """One film in the file's shape, or None for anything unusable."""
    if not isinstance(detail, dict) or not isinstance(detail.get("id"), int):
        return None
    title = trim(str(detail.get("title") or ""), 120)
    day = str(detail.get("release_date") or "")
    if not title:
        return None
    names = [g.get("name") for g in detail.get("genres") or [] if isinstance(g, dict) and g.get("name")]
    if not names and genres_by_id:
        names = [genres_by_id[i] for i in detail.get("genre_ids") or [] if i in genres_by_id]
    poster = str(detail.get("poster_path") or "")
    runtime = detail.get("runtime")
    out = {
        "id": detail["id"],
        "t": title,
        "y": int(day[:4]) if DAY.match(day) else None,
        "d": day if DAY.match(day) else "",
        "g": names[:4],
        "o": trim(str(detail.get("overview") or ""), OVERVIEW_MAX),
        "rt": runtime if isinstance(runtime, int) and runtime > 0 else None,
        "p": poster if POSTER.match(poster) else "",
        "yt": pick_trailer((detail.get("videos") or {}).get("results")),
    }
    home = us_home(detail)
    if home:
        out["h"] = home
    return out


def show(detail, genres_by_id=None):
    """One show in the same shape as a film, plus sn (seasons), or None."""
    if not isinstance(detail, dict) or not isinstance(detail.get("id"), int):
        return None
    title = trim(str(detail.get("name") or ""), 120)
    if not title:
        return None
    day = str(detail.get("first_air_date") or "")
    names = [g.get("name") for g in detail.get("genres") or [] if isinstance(g, dict) and g.get("name")]
    if not names and genres_by_id:
        names = [genres_by_id[i] for i in detail.get("genre_ids") or [] if i in genres_by_id]
    poster = str(detail.get("poster_path") or "")
    runs = [r for r in detail.get("episode_run_time") or [] if isinstance(r, int) and r > 0]
    seasons = detail.get("number_of_seasons")
    return {
        "id": detail["id"],
        "t": title,
        "y": int(day[:4]) if DAY.match(day) else None,
        "d": day if DAY.match(day) else "",
        "g": names[:4],
        "o": trim(str(detail.get("overview") or ""), OVERVIEW_MAX),
        "rt": runs[0] if runs else None,
        "p": poster if POSTER.match(poster) else "",
        "yt": pick_trailer((detail.get("videos") or {}).get("results")),
        "sn": seasons if isinstance(seasons, int) and seasons > 0 else None,
    }


def premiere(detail, today):
    """(season number, date) when a season premiered in the last
    PREMIERE_DAYS days or premieres in the next PREMIERE_DAYS, else None.
    The newest numbered season's air date first (it stays right after
    episode two airs), then either side's episode one."""
    lo, hi = today_minus(today, PREMIERE_DAYS), today_minus(today, -PREMIERE_DAYS)
    seasons = [s for s in detail.get("seasons") or [] if isinstance(s, dict) and isinstance(s.get("season_number"), int)
               and s["season_number"] > 0 and DAY.match(str(s.get("air_date") or ""))]
    if seasons:
        s = max(seasons, key=lambda s: s["season_number"])
        if lo <= s["air_date"] <= hi:
            return s["season_number"], s["air_date"]
    for key in ("next_episode_to_air", "last_episode_to_air"):
        ep = detail.get(key) or {}
        day = str(ep.get("air_date") or "")
        if ep.get("episode_number") == 1 and isinstance(ep.get("season_number"), int) and ep["season_number"] > 0 \
                and DAY.match(day) and lo <= day <= hi:
            return ep["season_number"], day
    return None


def listing(api, path, pages, **params):
    """The ids on a TMDB list, in its order, without repeats."""
    seen, out = set(), []
    for page in range(1, pages + 1):
        data = api.get(path, page=page, language="en-US", **params) or {}
        for row in data.get("results") or []:
            if isinstance(row, dict) and isinstance(row.get("id"), int) and row["id"] not in seen \
                    and not row.get("adult"):
                seen.add(row["id"])
                out.append(row["id"])
        if page >= int(data.get("total_pages") or 0):
            break
    return out


def details(api, ids, cache):
    out = []
    for i in ids:
        if i not in cache:
            cache[i] = api.get(f"/movie/{i}", language="en-US", append_to_response="videos,release_dates,watch/providers,external_ids")
        f = film(cache[i])
        if f:
            f["_raw"] = cache[i]
            out.append(f)
    return out


def show_details(api, ids, cache):
    out = []
    for i in ids:
        key = "tv", i
        if key not in cache:
            cache[key] = api.get(f"/tv/{i}", language="en-US", append_to_response="videos,external_ids")
        f = show(cache[key])
        if f:
            f["_raw"] = cache[key]
            out.append(f)
    return out


def shelf_air(shows, today):
    """Airing this week: new seasons first (newest premiere first), then
    the rest in TMDB's order."""
    fresh, rest = [], []
    for f in shows:
        p = premiere(f["_raw"], today)
        if p:
            fresh.append({**f, "ns": p[0], "d": p[1], "where": "tv"})
        else:
            rest.append({**f, "where": "tv"})
    fresh.sort(key=lambda f: f["d"], reverse=True)
    return (fresh + rest)[:TV_AIR_MAX]


def shelf_soon(films, today):
    """Upcoming, labelled from US release dates; only what is still ahead
    (or opened in the last week), soonest first."""
    out = []
    for f in films:
        day, where = us_release(f["_raw"])
        day = day or f["d"]
        if not day or day < today_minus(today, 7):
            continue
        out.append({**f, "d": day, "where": where or "theaters"})
    out.sort(key=lambda f: (f["d"], f["t"]))
    return out[:SOON_MAX]


def shelf_stream(films, today):
    """Coming to streaming: films with a US digital date in the window and
    a poster, soonest first, each with where it streams."""
    lo, hi = today_minus(today, STREAM_BACK), today_minus(today, -STREAM_AHEAD)
    new = today_minus(today, STREAM_NEW_DAYS)
    out = []
    for f in films:
        day, note = us_digital(f["_raw"], lo, hi)
        # TMDB also lists old films' new digital dates (a 2015 film reaching
        # a streamer): only films first out in the last ~18 months count
        if not day or not f["p"] or (f["d"] and f["d"] < new):
            continue
        out.append({**f, "d": day, "where": "streaming", "on": where_streams(f["_raw"], note, day, today)})
    out.sort(key=lambda f: (f["d"], f["t"]))
    return out[:STREAM_MAX]


def shelf_tv_stream(shows, today):
    """New shows and seasons on the streamers, soonest first."""
    lo, hi = today_minus(today, STREAM_BACK), today_minus(today, -STREAM_AHEAD)
    out = []
    for f in shows:
        s = upcoming_season(f["_raw"], lo, hi)
        on = network(f["_raw"])
        if not s or not on or not f["p"]:
            continue
        out.append({**f, "ns": s[0], "d": s[1], "where": "streaming", "on": on})
    out.sort(key=lambda f: (f["d"], f["t"]))
    return out[:TV_STREAM_MAX]


def stream_window(today):
    lo, hi = today_minus(today, STREAM_BACK), today_minus(today, -STREAM_AHEAD)
    return {"release_date.gte": lo, "release_date.lte": hi}, {"air_date.gte": lo, "air_date.lte": hi}


def shelf_now(films):
    return [{**f, "where": "theaters"} for f in films][:NOW_MAX]


def today_minus(today, days):
    return date.fromordinal(date.fromisoformat(today).toordinal() - days).isoformat()


def clean(films):
    return [{k: v for k, v in f.items() if k != "_raw"} for f in films]


def build_payload(top, soon, now, built, trend=(), tv_top=(), tv_trend=(), tv_air=(), stream=(), tv_stream=()):
    return {
        "v": 1,
        "built": built.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "TMDB",
        "notice": NOTICE,
        "images": IMAGES,
        "top": clean(top),
        "soon": clean(soon),
        "now": clean(now),
        "trend": clean(trend),
        "tv_top": clean(tv_top),
        "tv_trend": clean(tv_trend),
        "tv_air": clean(tv_air),
        "stream_source": "JustWatch",
        "stream": clean(stream),
        "tv_stream": clean(tv_stream),
    }


def add_tomatoes(args, omdb, films, shows):
    """Best effort, once the list is known good: films are asked before shows."""
    path = os.path.join(os.path.dirname(args.out) or ".", "tomatoes.json")
    try:
        try:
            with open(getattr(args, "tomatoes_prev", "") or path, encoding="utf-8") as src:
                cache = clean_scores(json.load(src))
        except (OSError, ValueError):
            cache = clean_scores(None)
        rows = [(f"m{f['id']}", imdb_of(f.get("_raw")), f) for shelf in films for f in shelf]
        rows += [(f"t{f['id']}", imdb_of(f.get("_raw")), f) for shelf in shows for f in shelf]
        asked = score(rows, cache, omdb, utcnow().date().isoformat(), OMDB_MAX)
        write_json(path, cache)
        log(f"{sum(1 for _, _, f in rows if 'tm' in f)} of {len(rows)} shelf rows have a score, {asked} OMDb asks")
    except Exception as e:  # noqa: BLE001 — a score is never worth the build
        log(f"no scores this run ({type(e).__name__})")


def run(args, api=None, omdb=None):
    key = os.environ.get("TMDB_API_KEY", "").strip()
    if not key and api is None:
        log("no TMDB_API_KEY; keeping the last file")
        return 0
    api = api or Tmdb(key)
    cache = {}
    try:
        top_ids = listing(api, "/movie/top_rated", TOP_COUNT // 20)[:TOP_COUNT]
        soon_ids = listing(api, "/movie/upcoming", SOON_PAGES, region="US")
        now_ids = listing(api, "/movie/now_playing", NOW_PAGES, region="US")
        trend_ids = listing(api, "/trending/movie/week", TREND_PAGES)
        top = details(api, top_ids, cache)
        today = utcnow().date().isoformat()
        soon = shelf_soon(details(api, soon_ids, cache), today)
        now = shelf_now(details(api, now_ids, cache))
        trend = details(api, trend_ids, cache)
        tv_top = show_details(api, listing(api, "/tv/top_rated", TV_TOP_COUNT // 20)[:TV_TOP_COUNT], cache)
        tv_trend = show_details(api, listing(api, "/trending/tv/week", TV_TREND_PAGES), cache)
        tv_air = shelf_air(show_details(api, listing(api, "/tv/on_the_air", TV_AIR_PAGES), cache), today)
        mwin, twin = stream_window(today)
        stream = shelf_stream(details(api, listing(api, "/discover/movie", STREAM_PAGES, region="US", with_release_type="4",
                                                   sort_by="popularity.desc", **mwin), cache), today)
        tv_stream = shelf_tv_stream(show_details(api, listing(api, "/discover/tv", TV_STREAM_PAGES, sort_by="popularity.desc",
                                                              with_networks="|".join(str(i) for i in STREAMERS), **twin), cache), today)
    except urllib.error.HTTPError as e:
        log(f"TMDB said HTTP {e.code}" + (" (is the key right?)" if e.code == 401 else "") + "; keeping the last file")
        return 1
    except Exception as e:  # noqa: BLE001 — any trouble keeps the last good file
        log(f"{e}; keeping the last file")
        return 1
    if len(top) < MIN_TOP:
        log(f"only {len(top)} top films came back; keeping the last file")
        return 1
    if len(tv_top) < MIN_TV_TOP:
        log(f"only {len(tv_top)} top shows came back; keeping the last file")
        return 1
    omdb_key = os.environ.get("OMDB_API_KEY", "").strip()
    omdb = omdb or (Omdb(omdb_key) if omdb_key else None)
    if omdb:
        add_tomatoes(args, omdb, (top, trend, now, soon, stream), (tv_top, tv_trend, tv_air, tv_stream))
    write_json(args.out, build_payload(top, soon, now, utcnow(), trend, tv_top, tv_trend, tv_air, stream, tv_stream))
    log(f"wrote {args.out}: {len(top)} top, {len(trend)} trending, {len(soon)} soon, {len(now)} now, "
        f"{len(stream)} to streaming, {len(tv_stream)} shows to streaming, "
        f"{len(tv_top)} top shows, {len(tv_trend)} trending shows, {len(tv_air)} airing, "
        f"{sum(1 for f in top if f['yt'])} top trailers, {api.calls} calls")
    return 0


# --------------------------------------------------------------- selftest
FIX_GENRES = {"genres": [{"id": 18, "name": "Drama"}, {"id": 80, "name": "Crime"}]}


def fixture_detail(i, title, day, **o):
    return {
        "id": i, "title": title, "release_date": day, "runtime": o.get("runtime", 120),
        "overview": o.get("overview", "A film about something. " * 3),
        "poster_path": o.get("poster", f"/p{i}.jpg"),
        "genres": [{"id": 18, "name": "Drama"}],
        "videos": {"results": o.get("videos", [])},
        "release_dates": {"results": o.get("releases", [])},
        "watch/providers": {"results": o.get("providers", {})},
        "external_ids": {"imdb_id": f"tt{i:07d}"},
    }


def selftest():
    os.environ.pop("OMDB_API_KEY", None)
    # the trailer: official English trailer beats a teaser, a clip and a
    # non-YouTube video; a malformed key never survives
    vids = [
        {"site": "Vimeo", "key": "AAAAAAAAAAA", "type": "Trailer", "official": True},
        {"site": "YouTube", "key": "clipclipcli", "type": "Clip", "official": True},
        {"site": "YouTube", "key": "teaserteas1", "type": "Teaser", "official": True, "iso_639_1": "en"},
        {"site": "YouTube", "key": "oldtrailer1", "type": "Trailer", "official": True, "iso_639_1": "en", "published_at": "2020-01-01T00:00:00.000Z"},
        {"site": "YouTube", "key": "newtrailer1", "type": "Trailer", "official": True, "iso_639_1": "en", "published_at": "2021-01-01T00:00:00.000Z"},
        {"site": "YouTube", "key": "fantrailer1", "type": "Trailer", "official": False, "iso_639_1": "en"},
        {"site": "YouTube", "key": "bad key!", "type": "Trailer", "official": True},
    ]
    assert pick_trailer(vids) == "newtrailer1", pick_trailer(vids)
    assert pick_trailer([v for v in vids if v["type"] != "Trailer"]) == "teaserteas1"
    assert pick_trailer([vids[1]]) == "", "a clip is not a trailer"
    assert pick_trailer(None) == ""
    print("build_films: trailers ok (official, English, newest; never a clip or a bad key)")

    # a film: the shape, the trims, and refusals
    f = film(fixture_detail(7, "  Long   Lake ", "2024-03-01", overview="word " * 200, poster="/../evil.jpg",
                            videos=[vids[4]]))
    assert set(f) == {"id", "t", "y", "d", "g", "o", "rt", "p", "yt"}, f.keys()
    assert f["t"] == "Long Lake" and f["y"] == 2024 and f["d"] == "2024-03-01"
    assert len(f["o"]) <= OVERVIEW_MAX and f["o"].endswith("…")
    assert f["p"] == "", "a poster path must be a bare TMDB path"
    assert f["yt"] == "newtrailer1" and f["g"] == ["Drama"] and f["rt"] == 120
    assert film({"id": "x", "title": "No"}) is None and film({"id": 3, "title": ""}) is None
    g = film({"id": 9, "title": "Undated", "genre_ids": [80, 99]}, {80: "Crime"})
    assert g["y"] is None and g["d"] == "" and g["g"] == ["Crime"] and g["yt"] == "" and g["rt"] is None
    print("build_films: film shape ok (trimmed, paths only, nothing invented)")

    ep = lambda day, s, e: {"air_date": day, "season_number": s, "episode_number": e}

    # release labels
    rel = lambda rows: {"release_dates": {"results": [{"iso_3166_1": "US", "release_dates": rows}, {"iso_3166_1": "FR", "release_dates": [{"release_date": "2026-01-01T00:00:00.000Z", "type": 3}]}]}}
    assert us_release(rel([{"release_date": "2026-11-20T00:00:00.000Z", "type": 3}, {"release_date": "2026-12-10T00:00:00.000Z", "type": 4}])) == ("2026-11-20", "theaters")
    assert us_release(rel([{"release_date": "2026-12-10T00:00:00.000Z", "type": 4}])) == ("2026-12-10", "streaming")
    assert us_release({}) == ("", "")
    print("build_films: release labels ok (US only; theaters before streaming)")

    # the home date: first US digital or physical date, never a theatrical one
    home = lambda rows, out="2026-07-15": us_home({"release_date": out, **rel(rows)})
    assert home([{"release_date": "2026-07-17T00:00:00.000Z", "type": 3}, {"release_date": "2026-11-17T00:00:00.000Z", "type": 5},
                 {"release_date": "2026-11-17T00:00:00.000Z", "type": 4}]) == "2026-11-17"
    assert home([{"release_date": "2026-12-01T00:00:00.000Z", "type": 5}, {"release_date": "2026-11-03T00:00:00.000Z", "type": 4}]) == "2026-11-03", "the first of the two"
    assert home([{"release_date": "2026-09-01T00:00:00.000Z", "type": 3}]) == "" and us_home({}) == ""
    assert home([{"release_date": "2026-11-20T00:00:00.000Z", "type": 4}], "2015-06-12") == "", "an old film reaching a streamer is not its home release"
    assert "h" not in film(fixture_detail(8, "No Home Yet", "2026-07-15"))
    assert film(fixture_detail(8, "Home", "2026-07-15", releases=rel([{"release_date": "2026-11-17T00:00:00.000Z", "type": 4}])["release_dates"]["results"]))["h"] == "2026-11-17"
    print("build_films: home dates ok (US digital or physical, first one, ahead too)")

    # coming to streaming: the US digital date in the window, and where
    digi = rel([{"release_date": "2026-10-01T00:00:00.000Z", "type": 4}, {"release_date": "2026-10-30T00:00:00.000Z", "type": 4},
                {"release_date": "2026-10-25T00:00:00.000Z", "type": 3}])
    assert us_digital(digi, "2026-10-19", "2026-11-26") == ("2026-10-30", ""), "a theatrical date is not a streaming date"
    assert us_digital(digi, "2026-10-19", "2026-10-29") == ("", "") and us_digital({}, "2026-01-01", "2026-12-31") == ("", "")
    assert us_digital(rel([{"release_date": "2026-10-24T00:00:00.000Z", "type": 4, "note": "Netflix"}]), "2026-10-19", "2026-11-26") == ("2026-10-24", "Netflix")
    names = ("Netflix", "HBO Max Amazon Channel", "Max", "Disney Plus", "Peacock Premium", "Starz Amazon Channel", "Amazon Prime Video", "4K UHD", "", "Maximum Effort")
    assert [service(x) for x in names] == ["Netflix", "HBO Max", "HBO Max", "Disney+", "Peacock", "Starz", "Prime Video", "", "", ""], [service(x) for x in names]
    wp = lambda us: {"watch/providers": {"results": {"US": us, "GB": {"flatrate": [{"provider_name": "BBC"}]}}}}
    assert where_streams(wp({"flatrate": [{"provider_name": "Hulu"}]}), "Netflix", "2026-10-30", "2026-10-22") == "Netflix", "the release's own note wins"
    assert where_streams(wp({"flatrate": [{"provider_name": "Hulu"}]}), "", "2026-10-30", "2026-10-22") == "", "a date ahead never borrows today's service"
    assert where_streams(wp({"flatrate": [{"provider_name": "Philo"}, {"provider_name": "Hulu"}], "rent": [{}]}), "", "2026-10-20", "2026-10-22") == "Philo"
    assert where_streams(wp({"buy": [{"provider_name": "Apple TV"}]}), "Digital", "2026-10-20", "2026-10-22") == "Rent or buy"
    assert where_streams(wp({}), "", "2026-10-20", "2026-10-22") == "" and where_streams({}, "", "2026-10-20", "2026-10-22") == ""
    assert network({"networks": [{"id": 1, "name": "ABC"}, {"id": 213, "name": "Netflix"}]}) == "Netflix" and network({"networks": [{"id": 1, "name": "ABC"}]}) == ""
    up = lambda **o: upcoming_season(o, "2026-10-19", "2026-11-26")
    assert up(seasons=[{"season_number": 1, "air_date": "2024-01-01"}, {"season_number": 2, "air_date": "2026-11-07"}]) == (2, "2026-11-07")
    assert up(next_episode_to_air=ep("2026-10-24", 1, 1)) == (1, "2026-10-24"), "a new series"
    assert up(next_episode_to_air=ep("2026-10-24", 3, 2)) is None, "episode two is not a premiere"
    assert up(seasons=[{"season_number": 0, "air_date": "2026-10-24"}]) is None, "a special is not a season"
    assert up(seasons=[{"season_number": 4, "air_date": "2027-03-01"}]) is None, "too far out"
    st = shelf_stream([{**g, "id": 1, "t": "B", "p": "/b.jpg", "_raw": rel([{"release_date": "2026-10-30T00:00:00.000Z", "type": 4, "note": "HBO Max"}])},
                       {**g, "id": 2, "t": "A", "p": "", "_raw": digi},
                       {**g, "id": 3, "t": "C", "p": "/c.jpg", "d": "2026-06-01", "_raw": {**rel([{"release_date": "2026-10-20T00:00:00.000Z", "type": 4}]), **wp({"flatrate": [{"provider_name": "Hulu"}]})}},
                       {**g, "id": 4, "t": "Old", "p": "/o.jpg", "d": "2015-06-12", "_raw": rel([{"release_date": "2026-10-25T00:00:00.000Z", "type": 4, "note": "Apple TV"}])}], "2026-10-22")
    assert [(f["id"], f["d"], f["on"], f["where"]) for f in st] == [(3, "2026-10-20", "Hulu", "streaming"), (1, "2026-10-30", "HBO Max", "streaming")], \
        "soonest first; no poster, no row; three days back still counts; a 2015 film is not new to streaming"
    print("build_films: coming to streaming ok (digital dates, the service, new seasons on the streamers)")

    # a show: the same shape plus seasons; a new season is found from either side
    sh = show({"id": 1399, "name": " Long  Winter ", "first_air_date": "2011-04-17", "episode_run_time": [0, 57],
               "number_of_seasons": 8, "poster_path": "/sh.jpg", "genres": [{"id": 18, "name": "Drama"}],
               "overview": "Snow.", "videos": {"results": [vids[4]]}})
    assert sh == {"id": 1399, "t": "Long Winter", "y": 2011, "d": "2011-04-17", "g": ["Drama"], "o": "Snow.", "rt": 57,
                  "p": "/sh.jpg", "yt": "newtrailer1", "sn": 8}, sh
    assert show({"id": 2, "title": "A film, not a show"}) is None and show({"id": "x", "name": "No"}) is None
    assert premiere({"last_episode_to_air": ep("2026-10-10", 3, 1)}, "2026-10-16") == (3, "2026-10-10")
    assert premiere({"next_episode_to_air": ep("2026-10-23", 2, 1), "last_episode_to_air": ep("2025-01-01", 1, 8)}, "2026-10-16") == (2, "2026-10-23")
    assert premiere({"last_episode_to_air": ep("2026-10-10", 3, 2)}, "2026-10-16") is None, "episode two is not a premiere"
    assert premiere({"last_episode_to_air": ep("2026-09-01", 3, 1)}, "2026-10-16") is None, "six weeks ago is not new"
    assert premiere({"last_episode_to_air": ep("2026-10-10", 0, 1)}, "2026-10-16") is None, "specials are not a season"
    seasons = [{"season_number": 0, "air_date": "2026-10-15"}, {"season_number": 1, "air_date": "2024-01-01"},
               {"season_number": 2, "air_date": "2026-10-06"}]
    assert premiere({"seasons": seasons, "last_episode_to_air": ep("2026-10-13", 2, 2)}, "2026-10-16") == (2, "2026-10-06"), \
        "a season that premiered last week is new after episode two airs"
    assert premiere({"seasons": seasons[:2]}, "2026-10-16") is None, "a special is never the new season"
    air = shelf_air([{**sh, "id": 1, "_raw": {}}, {**sh, "id": 2, "_raw": {"last_episode_to_air": ep("2026-10-02", 4, 1)}},
                     {**sh, "id": 3, "_raw": {"last_episode_to_air": ep("2026-10-12", 2, 1)}}], "2026-10-16")
    assert [(f["id"], f.get("ns"), f["d"]) for f in air] == [(3, 2, "2026-10-12"), (2, 4, "2026-10-02"), (1, None, "2011-04-17")], air
    assert all(f["where"] == "tv" for f in air)
    print("build_films: shows ok (shape, seasons, new seasons first)")

    # a whole run against a fake TMDB: lists, paging, details, shelves, the file
    lists = {
        "/movie/top_rated": [[{"id": i} for i in range(1, 21)], [{"id": i} for i in range(21, 25)] + [{"id": 3}]],
        "/movie/upcoming": [[{"id": 101}, {"id": 102}, {"id": 103, "adult": True}]],
        "/movie/now_playing": [[{"id": 201}, {"id": 1}]],
        "/trending/movie/week": [[{"id": 2}, {"id": 301}]],
        "/tv/top_rated": [[{"id": 500 + i} for i in range(20)], [{"id": 520}]],
        "/trending/tv/week": [[{"id": 501}, {"id": 600}]],
        "/tv/on_the_air": [[{"id": 600}, {"id": 601}]],
        "/discover/movie": [[{"id": 401}, {"id": 402}, {"id": 403}]],
        "/discover/tv": [[{"id": 700}, {"id": 701}, {"id": 702}]],
    }
    soon_day = lambda n: today_minus(utcnow().date().isoformat(), -n)
    asked = []

    def opener(url, headers):
        asked.append((url, headers))
        u = urllib.parse.urlparse(url)
        q = dict(urllib.parse.parse_qsl(u.query))
        path = u.path.replace("/3", "", 1)
        if path in lists:
            pages = lists[path]
            p = int(q.get("page", 1))
            return {"results": pages[p - 1] if p <= len(pages) else [], "total_pages": len(pages)}
        m = re.match(r"^/tv/(\d+)$", path)
        if m:
            i = int(m.group(1))
            last = {"air_date": today_minus(utcnow().date().isoformat(), 3), "season_number": 2, "episode_number": 1} if i == 601 else {}
            nxt = {700: ep(soon_day(10), 3, 1), 701: ep(soon_day(10), 2, 1), 702: ep(soon_day(10), 2, 2)}.get(i, {})
            nets = [{"id": 999, "name": "Local Broadcast"}] if i == 701 else [{"id": 213, "name": "Netflix"}]
            return {"id": i, "name": f"Show {i}", "first_air_date": "2010-01-01", "number_of_seasons": 2,
                    "poster_path": f"/s{i}.jpg", "genres": [{"id": 18, "name": "Drama"}], "last_episode_to_air": last,
                    "next_episode_to_air": nxt, "networks": nets, "videos": {"results": []}}
        m = re.match(r"^/movie/(\d+)$", path)
        if m:
            i = int(m.group(1))
            if i == 13:
                raise urllib.error.HTTPError(url, 404, "gone", {}, None)
            rows = []
            if i == 101:
                rows = [{"release_date": "2099-01-02T00:00:00.000Z", "type": 3}]
            if i == 102:
                rows = [{"release_date": "2099-01-01T00:00:00.000Z", "type": 4}]
            providers = {}
            first = "2001-05-0" + str(i % 9 + 1)
            if i in (401, 402, 403):
                # 401 names its service in the note, 403 is out and only for rent, 402 is too far out
                first = soon_day(-60)
                rows = [{"release_date": soon_day({401: 5, 402: 40, 403: -1}[i]) + "T00:00:00.000Z", "type": 4, "note": "Netflix" if i == 401 else ""}]
                providers = {401: {"US": {"flatrate": [{"provider_name": "Hulu"}]}}, 403: {"US": {"rent": [{"provider_name": "Apple TV"}]}}}.get(i, {})
            return fixture_detail(i, f"Film {i}", first, releases=[{"iso_3166_1": "US", "release_dates": rows}], providers=providers,
                                  videos=[{"site": "YouTube", "key": f"trailer{i:04d}"[:11].ljust(11, "x"), "type": "Trailer", "official": True}])
        raise AssertionError("unexpected call " + url)

    global PAUSE
    pause, PAUSE = PAUSE, 0
    try:
        api = Tmdb("0123456789abcdef0123456789abcdef", opener)
        cache = {}
        top_ids = listing(api, "/movie/top_rated", 15)
        assert top_ids == list(range(1, 25)), "both pages, in order, no repeats, stops at total_pages"
        top = details(api, top_ids, cache)
        assert len(top) == 23 and 13 not in [f["id"] for f in top], "a film TMDB no longer has is skipped"
        soon = shelf_soon(details(api, listing(api, "/movie/upcoming", 2, region="US"), cache), "2026-10-16")
        assert [(f["id"], f["where"], f["d"]) for f in soon] == [(102, "streaming", "2099-01-01"), (101, "theaters", "2099-01-02")], soon
        now = shelf_now(details(api, listing(api, "/movie/now_playing", 2, region="US"), cache))
        assert [f["id"] for f in now] == [201, 1] and all(f["where"] == "theaters" for f in now)
        detail_calls = [u for u, _ in asked if re.search(r"/movie/\d+\?", u)]
        assert len(detail_calls) == len(set(detail_calls)), "a film on two shelves is fetched once"
        assert all("api_key=0123456789abcdef" in u for u, _ in asked) and all(not h for _, h in asked)
        out = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".selftest-films.json")
        try:
            write_json(out, build_payload(top, soon, now, utcnow()))
            with open(out, encoding="utf-8") as src:
                written = json.load(src)
        finally:
            if os.path.exists(out):
                os.remove(out)
        assert written["v"] == 1 and written["notice"] == NOTICE and written["source"] == "TMDB"
        assert written["images"] == IMAGES
        assert set(written["top"][0]) == {"id", "t", "y", "d", "g", "o", "rt", "p", "yt"}
        assert set(written["soon"][0]) == {"id", "t", "y", "d", "g", "o", "rt", "p", "yt", "where"}, "no home date, no field"
        assert not any("_raw" in f or "http" in json.dumps(f) for f in written["top"] + written["soon"] + written["now"]), \
            "no full image URL and no raw TMDB payload in the file"
    finally:
        PAUSE = pause
    print("build_films: a run against a fake TMDB ok (paging, skips, shelves, one fetch per film, the file)")

    # the long read token goes in a header, never the URL
    params, headers = auth("eyJhbGciOiJIUzI1NiJ9." + "a" * 80 + ".sig")
    assert params == {} and headers["Authorization"].startswith("Bearer ")
    params, headers = auth(" 0123456789abcdef0123456789abcdef ")
    assert params == {"api_key": "0123456789abcdef0123456789abcdef"} and headers == {}
    print("build_films: both kinds of TMDB key ok")

    # no key: exits 0 and writes nothing
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".selftest-films-nokey.json")
    saved = os.environ.pop("TMDB_API_KEY", None)
    try:
        assert run(argparse.Namespace(out=out)) == 0 and not os.path.exists(out)
    finally:
        if saved is not None:
            os.environ["TMDB_API_KEY"] = saved
    print("build_films: no key keeps the last file ok")

    # a key TMDB refuses, or too few films: nothing written, and the run fails
    def refused(url, headers):
        raise urllib.error.HTTPError(url, 401, "bad key", {}, None)
    assert run(argparse.Namespace(out=out), Tmdb("wrong", refused)) == 1 and not os.path.exists(out)
    pause, PAUSE = PAUSE, 0
    try:
        assert run(argparse.Namespace(out=out), Tmdb("k", opener)) == 1 and not os.path.exists(out), "24 films is not a list"
    finally:
        PAUSE = pause
    print("build_films: a refused key or a short list fails the run and keeps the last file ok")

    # a whole run with the floors lowered: every shelf lands in the file
    global MIN_TOP, MIN_TV_TOP
    floors, (MIN_TOP, MIN_TV_TOP) = (MIN_TOP, MIN_TV_TOP), (20, 20)
    pause, PAUSE = PAUSE, 0
    try:
        assert run(argparse.Namespace(out=out), Tmdb("k", opener)) == 0
        with open(out, encoding="utf-8") as src:
            whole = json.load(src)
    finally:
        MIN_TOP, MIN_TV_TOP = floors
        PAUSE = pause
        if os.path.exists(out):
            os.remove(out)
    assert [f["id"] for f in whole["trend"]] == [2, 301]
    assert len(whole["tv_top"]) == 21 and set(whole["tv_top"][0]) == {"id", "t", "y", "d", "g", "o", "rt", "p", "yt", "sn"}
    assert [f["id"] for f in whole["tv_trend"]] == [501, 600]
    assert [(f["id"], f.get("ns")) for f in whole["tv_air"]] == [(601, 2), (600, None)], whole["tv_air"]
    assert [(f["id"], f["on"]) for f in whole["stream"]] == [(403, "Rent or buy"), (401, "Netflix")], whole["stream"]
    assert set(whole["stream"][0]) == {"id", "t", "y", "d", "g", "o", "rt", "p", "yt", "where", "on", "h"} and whole["stream_source"] == "JustWatch"
    assert [(f["id"], f["ns"], f["on"]) for f in whole["tv_stream"]] == [(700, 3, "Netflix")], whole["tv_stream"]
    discover = [u for u, _ in asked if "/discover/" in u]
    assert any("with_release_type=4" in u and "region=US" in u and "release_date.gte=" in u for u in discover), discover
    assert any("with_networks=213%7C1024" in u and "air_date.lte=" in u for u in discover), discover
    print("build_films: a whole run writes films, trending, the three TV shelves and both streaming shelves ok")

    # Rotten Tomatoes, through a fake OMDb
    ratings = lambda *rows: {"Response": "True", "Ratings": [{"Source": s, "Value": v} for s, v in rows]}
    assert tomato(ratings(("Internet Movie Database", "8.1/10"), ("Rotten Tomatoes", "92%"))) == 92
    assert tomato(ratings(("Rotten Tomatoes", "0%"))) == 0, "zero is a score"
    assert all(tomato(a) is None for a in (ratings(("Metacritic", "92/100")), ratings(("Rotten Tomatoes", "N/A")), ratings(("Rotten Tomatoes", "101%")), {}, None))
    pause, PAUSE = PAUSE, 0
    questions = []

    def fake_omdb(url):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))
        questions.append(q["i"])
        assert url.startswith(OMDB) and q["apikey"] == "omdbsecret"
        return {"tt0000001": ratings(("Rotten Tomatoes", "92%")), "tt0000002": ratings(("Rotten Tomatoes", "59%"))}.get(q["i"], {"Response": "True", "Ratings": []})

    omdb = Omdb(" omdbsecret ", fake_omdb)
    fresh, rotten, unrated, no_id = {"id": 1}, {"id": 2}, {"id": 3}, {"id": 4}
    twice = dict(fresh)
    rows = [("m1", "tt0000001", fresh), ("m1", "tt0000001", twice), ("m2", "tt0000002", rotten), ("m3", "tt0000003", unrated), ("m4", "", no_id)]
    cache = clean_scores(None)
    assert score(rows, cache, omdb, "2026-10-30", 10) == 3 and questions == ["tt0000001", "tt0000002", "tt0000003"], questions
    assert (fresh["tm"], twice["tm"], rotten["tm"]) == (92, 92, 59) and "tm" not in unrated and "tm" not in no_id
    assert cache["used"] == 3 and cache["titles"]["m3"] == {"i": "tt0000003", "at": "2026-10-30"} and "m4" not in cache["titles"]

    # six days on nothing is asked; on the seventh every one is, a score OMDb
    # has dropped goes, and the id comes from the cache when the row has none
    del questions[:]
    assert score(rows, cache, omdb, "2026-11-05", 10) == 0 and not questions and cache["used"] == 3 and cache["day"] == "2026-10-30"
    held = {"id": 1}
    assert score([("m1", "", held)], clean_scores(json.loads(json.dumps(cache))), omdb, "2026-11-05", 10) == 0 and held["tm"] == 92
    stale = {"id": 9, "tm": 40}
    cache["titles"]["m9"] = {"i": "tt0000009", "at": "2026-10-20", "tm": 40}
    assert score([("m9", "", stale)], cache, omdb, "2026-11-06", 10) == 1 and "tm" not in stale and questions == ["tt0000009"]
    assert list(cache["titles"]) == ["m9"], "the cache holds this run's titles only"

    # the day's limit: never over it, the oldest answers first, and a new day starts again
    del questions[:]
    aged = {"day": "2026-11-06", "used": 8, "titles": {f"m{i}": {"i": f"tt000000{i}", "at": f"2026-10-0{i}"} for i in (3, 1, 2)}}
    rows = [(k, "", {}) for k in aged["titles"]]
    assert score(rows, aged, omdb, "2026-11-06", 10) == 2 and questions == ["tt0000001", "tt0000002"] and aged["used"] == 10
    assert score(rows, aged, omdb, "2026-11-06", 10) == 0 and "m3" in aged["titles"], "a title past the limit stays in the cache"
    assert score(rows, aged, omdb, "2026-11-07", 10) == 1 and aged["used"] == 1 and questions[-1] == "tt0000003"

    # a spent day, a refused key or a dead line stops the asking and keeps what it had
    def refusing(answer):
        def ask(url):
            questions.append(url)
            if isinstance(answer, Exception):
                raise answer
            return answer
        return ask

    for trouble in ({"Response": "False", "Error": "Request limit reached!"}, {"Response": "False", "Error": "Invalid API key!"},
                    urllib.error.HTTPError(OMDB, 401, "Unauthorized", {}, None), urllib.error.URLError("down"), "not a dict"):
        del questions[:]
        kept = {"id": 9, "tm": 71}
        cache = clean_scores({"titles": {"m9": {"i": "tt0000009", "at": "2026-01-01", "tm": 71}, "m8": {"i": "tt0000008", "at": "2026-01-02", "tm": 12}}})
        score([("m9", "", kept), ("m8", "", {})], cache, Omdb("k", refusing(trouble)), "2026-11-06", 10)
        assert len(questions) == 1 and kept["tm"] == 71 and cache["titles"]["m9"]["at"] == "2026-01-01", trouble
    answer = {"Response": "False", "Error": "Incorrect IMDb ID."}
    assert Omdb("k", lambda url: answer).score("tt0000001") is None, "a title OMDb lacks is an answer, not trouble"
    assert clean_scores({"titles": {"a": {"i": "nope", "at": "2026-01-01"}, "b": {"i": "tt0000001", "at": "x"}, "c": {"i": "tt0000001", "at": "2026-01-01", "tm": "9"}, "d": 1}})["titles"] == {}
    assert clean_scores("garbage") == {"day": "", "used": 0, "titles": {}}

    # a whole run: scores in the file, the cache beside it, carried to the next run
    del questions[:]
    prev = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".selftest-tomatoes-prev.json")
    side = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tomatoes.json")
    floors, (MIN_TOP, MIN_TV_TOP) = (MIN_TOP, MIN_TV_TOP), (20, 20)
    assert not os.path.exists(side), side + " is in the way"
    try:
        assert run(argparse.Namespace(out=out), Tmdb("k", opener), omdb) == 0
        with open(out, encoding="utf-8") as src:
            whole = json.load(src)
        with open(side, encoding="utf-8") as src:
            carried = src.read()
        assert whole["top"][0]["tm"] == 92 and whole["top"][1]["tm"] == 59 and "tm" not in whole["top"][2]
        assert not any("_raw" in f for f in whole["top"])
        assert "omdbsecret" not in carried and "omdbsecret" not in json.dumps(whole), "the key is in no file"
        assert len(questions) == len(set(questions)), "a film on two shelves is asked once"
        os.replace(side, prev)
        n = len(questions)
        assert run(argparse.Namespace(out=out, tomatoes_prev=prev), Tmdb("k", opener), omdb) == 0
        assert len(questions) == n and os.path.exists(side), "the carried cache means no new asks"
        with open(out, encoding="utf-8") as src:
            assert json.load(src)["top"][0]["tm"] == 92

        # OMDb down: the film list is written all the same, with no score
        os.remove(side)
        down = Omdb("k", refusing(urllib.error.URLError("down")))
        assert run(argparse.Namespace(out=out), Tmdb("k", opener), down) == 0
        with open(out, encoding="utf-8") as src:
            assert "tm" not in json.load(src)["top"][0]

        # no key: not one score, and no cache
        os.remove(side)
        assert run(argparse.Namespace(out=out), Tmdb("k", opener)) == 0 and not os.path.exists(side)
        with open(out, encoding="utf-8") as src:
            assert '"tm"' not in src.read()
    finally:
        MIN_TOP, MIN_TV_TOP = floors
        PAUSE = pause
        for path in (out, prev, side):
            if os.path.exists(path):
                os.remove(path)
    print("build_films: Rotten Tomatoes ok (fake OMDb: weekly, within the day's limit, carried forward, never fails the build, nothing without a key)")

    # the baked starter list the tab falls back to keeps the same shape
    seed_path = os.path.join(ROOT, "all-day", "data", "films-seed.json")
    with open(seed_path, encoding="utf-8") as src:
        seed = json.load(src)
    assert seed["seed"] is True and seed["notice"] == NOTICE and len(seed["top"]) == 60
    ids = [f["id"] for f in seed["top"]]
    assert len(set(ids)) == 60
    for f in seed["top"]:
        assert set(f) == {"id", "t", "y", "d", "g", "o", "rt", "p", "yt"}, f
        assert isinstance(f["id"], int) and f["t"] and isinstance(f["y"], int) and DAY.match(f["d"])
        assert POSTER.match(f["p"]) and (f["yt"] == "" or YT_KEY.match(f["yt"]))
    print("build_films: the starter list ok (60 films, the same shape)")
    print("selftest ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=OUT)
    parser.add_argument("--tomatoes-prev", default="")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    sys.exit(run(args))


if __name__ == "__main__":
    main()
