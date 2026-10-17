#!/usr/bin/env python3
"""All Day's Watch tab — the film list: data/films.json, from TMDB.

Three shelves, every film in the same small shape:

  top    the 300 best-rated films on The Movie Database (TMDB's own
         /movie/top_rated list, in its order). The tab's "The list".
  soon   upcoming in the US (/movie/upcoming?region=US), soonest first,
         labelled theaters or streaming from TMDB's US release dates.
  now    in US theaters now (/movie/now_playing?region=US).

A film is { id, t (title), y (year), d (US release date, YYYY-MM-DD), g
(genre names), o (overview, trimmed), rt (minutes), p (poster PATH), yt
(YouTube trailer key) }, plus `where` and `d` on the soon and now shelves.
Only the poster's path is kept, never a picture: the page builds the URL
from `images` + a size + the path, so TMDB serves its own images. A film
with no YouTube trailer on TMDB has yt "" and the tab says so; a key is
never guessed.

TMDB's attribution travels in the file (`source`, `notice`) and the tab
prints it wherever this data shows, with TMDB's logo. TMDB's API is free
for non-commercial use with that attribution; its terms allow cached data
for six months, and this file is rebuilt weekly.

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

TOP_COUNT = 300          # 15 pages of 20
MIN_TOP = 200            # fewer than this back is a broken run, not a list
SOON_PAGES = 2
NOW_PAGES = 2
SOON_MAX = 30
NOW_MAX = 30
OVERVIEW_MAX = 420
PAUSE = 0.06             # TMDB allows about 40 requests a second; we use ~15
ATTEMPTS = 3

YT_KEY = re.compile(r"^[A-Za-z0-9_-]{11}$")
POSTER = re.compile(r"^/[A-Za-z0-9_-]+\.(jpg|png)$")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# TMDB's US release types: 2 theatrical (limited), 3 theatrical, 4 digital.
THEATER_TYPES = {2, 3}
DIGITAL_TYPES = {4}


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


# ------------------------------------------------------------- the shapes
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
    return {
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
            cache[i] = api.get(f"/movie/{i}", language="en-US", append_to_response="videos,release_dates")
        f = film(cache[i])
        if f:
            f["_raw"] = cache[i]
            out.append(f)
    return out


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


def shelf_now(films):
    return [{**f, "where": "theaters"} for f in films][:NOW_MAX]


def today_minus(today, days):
    return date.fromordinal(date.fromisoformat(today).toordinal() - days).isoformat()


def clean(films):
    return [{k: v for k, v in f.items() if k != "_raw"} for f in films]


def build_payload(top, soon, now, built):
    return {
        "v": 1,
        "built": built.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "TMDB",
        "notice": NOTICE,
        "images": IMAGES,
        "top": clean(top),
        "soon": clean(soon),
        "now": clean(now),
    }


def run(args, api=None):
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
        top = details(api, top_ids, cache)
        soon = shelf_soon(details(api, soon_ids, cache), utcnow().date().isoformat())
        now = shelf_now(details(api, now_ids, cache))
    except urllib.error.HTTPError as e:
        log(f"TMDB said HTTP {e.code}" + (" (is the key right?)" if e.code == 401 else "") + "; keeping the last file")
        return 1
    except Exception as e:  # noqa: BLE001 — any trouble keeps the last good file
        log(f"{e}; keeping the last file")
        return 1
    if len(top) < MIN_TOP:
        log(f"only {len(top)} top films came back; keeping the last file")
        return 1
    write_json(args.out, build_payload(top, soon, now, utcnow()))
    log(f"wrote {args.out}: {len(top)} top, {len(soon)} soon, {len(now)} now, "
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
    }


def selftest():
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

    # release labels
    rel = lambda rows: {"release_dates": {"results": [{"iso_3166_1": "US", "release_dates": rows}, {"iso_3166_1": "FR", "release_dates": [{"release_date": "2026-01-01T00:00:00.000Z", "type": 3}]}]}}
    assert us_release(rel([{"release_date": "2026-11-20T00:00:00.000Z", "type": 3}, {"release_date": "2026-12-10T00:00:00.000Z", "type": 4}])) == ("2026-11-20", "theaters")
    assert us_release(rel([{"release_date": "2026-12-10T00:00:00.000Z", "type": 4}])) == ("2026-12-10", "streaming")
    assert us_release({}) == ("", "")
    print("build_films: release labels ok (US only; theaters before streaming)")

    # a whole run against a fake TMDB: lists, paging, details, shelves, the file
    lists = {
        "/movie/top_rated": [[{"id": i} for i in range(1, 21)], [{"id": i} for i in range(21, 25)] + [{"id": 3}]],
        "/movie/upcoming": [[{"id": 101}, {"id": 102}, {"id": 103, "adult": True}]],
        "/movie/now_playing": [[{"id": 201}, {"id": 1}]],
    }
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
            return fixture_detail(i, f"Film {i}", "2001-05-0" + str(i % 9 + 1), releases=[{"iso_3166_1": "US", "release_dates": rows}],
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
        assert set(written["soon"][0]) == {"id", "t", "y", "d", "g", "o", "rt", "p", "yt", "where"}
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
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    sys.exit(run(args))


if __name__ == "__main__":
    main()
