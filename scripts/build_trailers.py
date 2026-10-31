#!/usr/bin/env python3
"""All Day's Watch tab: the trailer card's file, data/trailers.json.

Studio channels are read fresh every three hours (refresh-youtube.yml), one
long-form uploads playlist each, so Shorts never arrive. A title is kept when
it says trailer or teaser, is not a clip, a game tie-in, a reissue or a
compilation, runs 45 seconds to 5 minutes, plays in an embed, and is a film
that is new.

Two ways to read, picked by what the environment holds:

  YOUTUBE_API_KEY   playlistItems and videos through the Data API. Actions has
                    to use this: YouTube RSS is soft-blocked from its IPs.
  no key            the channels' public RSS, and each candidate's watch page
                    for its length and whether it plays in an embed. Works
                    from a home connection, so a real file can be built on a
                    Mac for a phone preview.

Two ways to decide a title is a new film:

  TMDB_API_KEY      /search/movie: the exact title, released no more than 120
                    days ago or still ahead. Series fail this. Each entry then
                    has the films.json shape (build_films.film).
  no key            the title gate below (local_gate): a title on films.json's
                    new shelves, or from a studio channel or Rotten Tomatoes
                    Trailers. The streamers' channels mix series and films
                    under identical titles, so a title seen only there needs
                    that corroboration and is otherwise left out. These
                    entries have no TMDB id, so they carry a made-up one above
                    LOCAL_ID, which the next TMDB run replaces.

The file:

  {"v":1,"built":"…","source":"…",
   "fresh":[{…film…,"yt":"…","at":1793500000,"ch":"Sony"}],   last 7 days, one per film
   "past":[…],                                                 cap 300: the
       channels' last 365 days, newest first, then the back catalogue
   "skip":["B6Z9MM1LhEA"]}                                     films.json keys that will not play

The back catalogue is every film on films.json with a trailer key that is not
already in the file, in shelf order. These rows have no at and no ch, and no
overview, to keep the file small; the page reads a row with no at as one with
no upload date. They are rebuilt from films.json each run, or carried from the
last file when films.json will not load.

fresh is ordered: the last 72 hours by views per hour, then the rest by date.
When a studio and Rotten Tomatoes Trailers both carry a film, the studio's copy
is used. A failure anywhere keeps the last file. The last file is also read
back in as the memory of older weeks, since a feed only holds 15 items.

trailers-seen.json, beside it and not read by the page: titles TMDB has not
matched (retried for 7 days, because TMDB lags a new upload) and the keys
already checked, films.json's and the last file's own (again after 30 days).

  python3 scripts/build_trailers.py --out data/trailers.json
  python3 scripts/build_trailers.py --selftest
"""

import argparse
import concurrent.futures
import json
import os
import re
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zlib
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import build_films as bf  # noqa: E402
from build_showtimes import title_case  # noqa: E402

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
FILMS_URL = "https://raw.githubusercontent.com/btownbrief/btown-brief/films-data/data/films.json"
API = "https://www.googleapis.com/youtube/v3"
RSS = "https://www.youtube.com/feeds/videos.xml?playlist_id="
WATCH = "https://www.youtube.com/watch?v="

DAY = 86400
FRESH_DAYS = 7
HOT_HOURS = 72
PAST_DAYS = 365
PAST_MAX = 300
BACK_SHELVES = ("now", "soon", "trend", "stream", "top")    # movies only: the card's list is films
BACK_FIELDS = ("id", "t", "y", "d", "g", "rt", "p", "yt")
RELEASE_BACK = 120       # a film released longer ago than this is not new
RETRY_DAYS = 7           # TMDB can lag a new upload this long
RECHECK_DAYS = 30
MIN_SEC = 45             # curate_tv.py's TRAILER_MIN_SEC: under this is a spot
MAX_SEC = 300
LOCAL_ID = 40000000      # made-up ids sit here, under the page's TV_BASE
PAGE_WORKERS = 2         # the watch page answers 429 well before six at a time
PAGE_PAUSE = 0.5
PAGE_KEYS_MAX = 150      # films.json keys checked per run without a key, in shelf order
DESC_OPENING = 200

STUDIO, HOUSE, MIXED = "studio", "house", "mixed"
# Disney has no channel of its own here: Marvel, Pixar, 20th Century and
# Rotten Tomatoes Trailers carry its films. IGN and Crunchyroll are mostly
# games and series; FilmSelect stopped in January 2025.
CHANNELS = [
    ("Rotten Tomatoes Trailers", "UCi8e0iOVk1fEOogdfu4YgfA", HOUSE),
    ("Netflix", "UCWOA1ZGywLbqmigxE4Qlvuw", MIXED),
    ("Prime Video", "UCQJWtTnAHhEG5w4uN0udnUQ", MIXED),
    ("Apple TV", "UC1Myj674wRVXB9I4c6Hm5zA", MIXED),
    ("Amazon MGM", "UCf5CjDJvsFvtVIhkfmKAwAA", STUDIO),
    ("Warner Bros.", "UCjmJDM5pRKbUlVIzDYYWb6g", STUDIO),
    ("Sony", "UCz97F7dMxBNOfGYu3rx8aCw", STUDIO),
    ("Universal", "UCq0OueAsdxH6b8nyAspwViw", STUDIO),
    ("Paramount", "UCF9imwPMSGz4Vq1NiTWCC7g", STUDIO),
    ("Lionsgate", "UCJ6nMHaJPZvsJ-HmUmj1SeA", STUDIO),
    ("A24", "UCuPivVjnfNo4mb3Oog_frZg", STUDIO),
    ("NEON", "UCpy5dRhZd-JbZP4NsrnLt1w", STUDIO),
    ("Searchlight", "UCor9rW6PgxSQ9vUPWQdnaYQ", STUDIO),
    ("Focus", "UCU4SM3j_9TNWaSu8KdGV50g", STUDIO),
    ("Blumhouse", "UCCEfOHkckMXnoZQAjUZsMig", STUDIO),
    ("Sony Pictures Classics", "UCruD_lL-5fmllpKMSL-yCyQ", STUDIO),
    ("MUBI", "UCb6-VM5UQ4Czj_d3m9EPGfg", STUDIO),
    ("20th Century", "UC2-BeLxzUBSs0uSrmzWhJuQ", STUDIO),
    ("Marvel", "UCvC4D8onUfXzvjTOM-dBfEA", STUDIO),
    ("Pixar", "UC_IRYSp4auq7hKLvziWVH6w", STUDIO),
]

TRAILER_WORD = re.compile(r"\b(trailers?|teasers?)\b", re.I)
NOT_A_FILM = re.compile(
    r"new trailers this week|season \d|\bepisode\b|\bfortnite\b|\broblox\b|\bgameplay\b|game vault"
    r"|\banniversary\b|\bre-?release\b|\bin 4k\b|\bdub(bed)?\b|\bsub(bed|titled)\b"
    r"|\b(spanish|french|german|italian|japanese|korean|hindi|tamil|telugu|mandarin|cantonese|portuguese)\s+(trailer|teaser)\b"
    r"|\btv spot\b|\bfeaturette\b|\bbehind the scenes\b|\breaction\b|\bbreakdown\b|\brecap\b", re.I)
SERIES_HINT = re.compile(r"\b(mini|limited |docu|new |original )?series\b|\b\w+-part\b|\bdisney\+|\bhulu\b|\bhbo max\b|\bpeacock\b|\bparamount\+", re.I)
RED_BAND = re.compile(r"\bred band\b", re.I)
YEAR_TAG = re.compile(r"\((\d{4})(?:\s+movie)?\)", re.I)
TAIL = re.compile(r"(\s+(official|final|new|first|red band|exclusive|theatrical|international|main|full|us|hd|\d+(st|nd|rd|th)?|#\d+))*"
                  r"\s+(trailers?|teasers?)\b.*$", re.I)
QUOTED = re.compile(r"\bfor\s+['‘\"“](.+?)['’\"”]")
SPLIT = re.compile(r"\s+[|–—-]\s+|\s*\|\s*")
PLAIN_LABEL = re.compile(r"^(official|final|new|first|red band|teaser|trailer|hd|\d)(\s|$)", re.I)
MONTHS = {m: i + 1 for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"))}
RELEASE_LINE = re.compile(
    r"\b(theat(?:er|re)s?|imax|cinemas?|premieres?|digital|demand|netflix|prime video|apple tv|streaming|mubi)\b[^.\n|]{0,40}?"
    r"\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})\b", re.I)
ATOM = {"a": "http://www.w3.org/2005/Atom", "m": "http://search.yahoo.com/mrss/", "y": "http://www.youtube.com/xml/schemas/2015"}


def log(msg):
    print("build_trailers: " + msg, file=sys.stderr)


# ------------------------------------------------------------------ titles
def norm(text):
    """The title as both the page and TMDB matching compare it."""
    plain = unicodedata.normalize("NFKD", str(text or ""))
    plain = "".join(c for c in plain if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", plain.lower())[:80]


def is_trailer(title, year):
    """A trailer for a film that could be new: the title alone."""
    if not TRAILER_WORD.search(title) or NOT_A_FILM.search(title):
        return False
    tag = YEAR_TAG.search(title)
    return not (tag and int(tag.group(1)) < year - 1)


def film_title(title):
    """"Jumanji: Open World Trailer #2 (2026)", "BEHEMOTH! | Official Trailer |
    Searchlight Pictures" and "Above the Below (2026) Official Trailer - Idris
    Elba" all name the film first."""
    quoted = QUOTED.search(title)
    if quoted:
        return quoted.group(1).strip()
    for part in SPLIT.split(title):
        part = YEAR_TAG.sub(" ", part)
        part = TAIL.sub("", part).strip(" -–—|:'\"")
        if part and not PLAIN_LABEL.match(part):
            return re.sub(r"\s+", " ", part)
    return ""


def year_of(titles):
    for title in titles:
        tag = YEAR_TAG.search(title)
        if tag:
            return int(tag.group(1))
    return None


def release_date(text, today):
    """"only in theaters January 15" as a date, the next one it can be."""
    hit = RELEASE_LINE.search(re.sub(r"christmas day", "December 25", text or "", flags=re.I))
    if not hit:
        return ""
    month, day = MONTHS[hit.group(2)[:3].lower()], int(hit.group(3))
    for year in (today.year, today.year + 1):
        try:
            when = today.replace(year=year, month=month, day=day)
        except ValueError:
            return ""
        if (when - today).days > -180:
            return when.strftime("%Y-%m-%d")
    return ""


# ----------------------------------------------------------------- reading
def http_get(url):
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.read()


def parse_feed(xml, channel):
    name, _cid, kind = channel
    out = []
    for entry in ET.fromstring(xml).findall("a:entry", ATOM):
        yt = entry.findtext("y:videoId", "", ATOM)
        when = entry.findtext("a:published", "", ATOM)
        if not bf.YT_KEY.match(yt) or not when:
            continue
        stats = entry.find("m:group/m:community/m:statistics", ATOM)
        out.append({"yt": yt, "title": entry.findtext("a:title", "", ATOM), "at": int(datetime.fromisoformat(when).timestamp()),
                    "views": int(stats.get("views", 0)) if stats is not None else 0,
                    "desc": entry.findtext("m:group/m:description", "", ATOM), "ch": name, "kind": kind})
    return out


def read_rss(fetch):
    out = []
    read = 0
    for channel in CHANNELS:
        try:
            out.extend(parse_feed(fetch(RSS + "UULF" + channel[1][2:]), channel))
            read += 1
        except (urllib.error.URLError, TimeoutError, ET.ParseError, ValueError) as e:
            log(f"{channel[0]}: {e}")
    return out, read


def api_get(fetch, key, path, **params):
    return json.loads(fetch(f"{API}/{path}?" + urllib.parse.urlencode({**params, "key": key})))


def read_api(fetch, key):
    """Each channel's long-form playlist. UULF is untested from Actions, so
    a channel it fails for falls back to the plain uploads playlist, where the
    duration gate still keeps Shorts out."""
    out = []
    read = 0
    for name, cid, kind in CHANNELS:
        items = None
        for prefix in ("UULF", "UU"):
            try:
                items = api_get(fetch, key, "playlistItems", part="snippet,contentDetails", playlistId=prefix + cid[2:], maxResults=50).get("items", [])
                break
            except (urllib.error.URLError, TimeoutError, ValueError) as e:
                log(f"{name} {prefix}: {e}")
        if items is None:
            continue
        read += 1
        for item in items:
            yt = (item.get("contentDetails") or {}).get("videoId", "")
            snip = item.get("snippet") or {}
            when = (item.get("contentDetails") or {}).get("videoPublishedAt") or snip.get("publishedAt") or ""
            if bf.YT_KEY.match(yt) and when:
                out.append({"yt": yt, "title": snip.get("title", ""), "at": int(datetime.fromisoformat(when.replace("Z", "+00:00")).timestamp()),
                            "views": 0, "desc": snip.get("description", ""), "ch": name, "kind": kind})
    return out, read


def iso_seconds(text):
    hit = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", str(text or ""))
    if not hit:
        return None
    h, m, s = (int(x or 0) for x in hit.groups())
    return h * 3600 + m * 60 + s


def api_facts(fetch, key, ids):
    """{yt: {secs, plays, views}} through videos.list. A video the API does
    not return is gone."""
    out = {yt: {"secs": None, "plays": False, "views": 0} for yt in ids}
    for i in range(0, len(ids), 50):
        batch = ",".join(ids[i:i + 50])
        rows = api_get(fetch, key, "videos", part="contentDetails,status,statistics", id=batch).get("items", [])
        for row in rows:
            detail = row.get("contentDetails") or {}
            region = detail.get("regionRestriction") or {}
            blocked = "US" in (region.get("blocked") or []) or ("allowed" in region and "US" not in region["allowed"])
            rated = (detail.get("contentRating") or {}).get("ytRating") == "ytAgeRestricted"
            out[row.get("id")] = {"secs": iso_seconds(detail.get("duration")), "plays": bool((row.get("status") or {}).get("embeddable")) and not blocked and not rated,
                                  "views": int((row.get("statistics") or {}).get("viewCount") or 0)}
    return out


def page_facts_of(html):
    """The watch page's own record of a video, or None when it did not show
    one (a consent wall, a bot check): unknown, not unplayable."""
    status = re.search(r'"playabilityStatus":\{"status":"([A-Z_]+)"', html)
    embed = re.search(r'"playableInEmbed":(true|false)', html)
    if not status:
        return None
    secs = re.search(r'"lengthSeconds":"(\d+)"', html)
    return {"secs": int(secs.group(1)) if secs else None, "views": 0,
            "plays": status.group(1) == "OK" and (not embed or embed.group(1) == "true")}


def page_facts(fetch, ids):
    """Stops asking at the first 429: what is left stays unknown this run."""
    stop = threading.Event()

    def one(yt):
        if stop.is_set():
            return yt, None
        try:
            html = fetch(WATCH + yt).decode("utf-8", "replace")
            time.sleep(PAGE_PAUSE)
            return yt, page_facts_of(html)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                log("the watch page says slow down; stopping for this run")
                stop.set()
            else:
                log(f"watch page {yt}: {e}")
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            log(f"watch page {yt}: {e}")
        return yt, None

    with concurrent.futures.ThreadPoolExecutor(PAGE_WORKERS) as pool:
        return {yt: facts for yt, facts in pool.map(one, ids) if facts}


# ------------------------------------------------------------------ gating
def new_shelves(films, today):
    """films.json's new titles by normalized name. The list of the best ever
    is left out: Pride and Prejudice 2005 is not Netflix's new series."""
    floor = (today - timedelta(days=RELEASE_BACK)).strftime("%Y-%m-%d")
    out = {}
    for shelf in ("soon", "now", "stream", "trend"):
        for f in (films or {}).get(shelf) or []:
            if isinstance(f, dict) and f.get("t") and str(f.get("d") or "") >= floor:
                out.setdefault(norm(f["t"]), f)
    return out


def from_shelf(f):
    return {"id": f.get("id"), "t": f.get("t"), "y": f.get("y"), "d": f.get("d") or "", "g": f.get("g") or [], "o": f.get("o") or "",
            "rt": f.get("rt"), "p": f.get("p") or "", "where": f.get("where") or "theaters", "on": f.get("on") or ""}


def streamer(ups):
    """The service a film is on: none when a studio also carries it."""
    if any(u["kind"] == STUDIO for u in ups):
        return ""
    return next((u["ch"] for u in ups if u["kind"] == MIXED), "")


def local_id(key):
    return LOCAL_ID + zlib.crc32(key.encode()) % 9999999


def local_gate(key, ups, shelves, today):
    """No TMDB: a title on films.json's new shelves, else one a film channel
    carries. A streamer's channel alone proves nothing, because its series and
    its films have identical titles. Only the title and the opening of the
    description are read for "series": the rest is each channel's boilerplate,
    and Netflix's says "TV series" under every film."""
    if key in shelves:
        return from_shelf(shelves[key])
    if all(u["kind"] == MIXED for u in ups):
        return None
    if not any(u["kind"] == HOUSE for u in ups) and any(SERIES_HINT.search(u["title"] + " " + u["desc"][:DESC_OPENING]) for u in ups):
        return None
    titles = [u["title"] for u in ups]
    names = [film_title(t) for t in titles]
    name = next((n for n in names if n != n.upper()), names[0])
    day = next((d for d in (release_date(u["title"] + "\n" + u["desc"], today) for u in ups) if d), "")
    mixed = streamer(ups)
    return {"id": local_id(key), "t": title_case(name), "y": year_of(titles) or (int(day[:4]) if day else None), "d": day, "g": [], "o": "", "rt": None, "p": "",
            "where": "streaming" if mixed else "theaters", "on": mixed}


def tmdb_gate(api, name, year, today, cache, ups):
    """The exact title, released in the last 120 days or still ahead."""
    key = norm(name)
    floor = (today - timedelta(days=RELEASE_BACK)).strftime("%Y-%m-%d")
    got = api.get("/search/movie", query=name, include_adult="false", language="en-US") or {}
    rows = [r for r in got.get("results") or [] if key in (norm(r.get("title")), norm(r.get("original_title")))
            and str(r.get("release_date") or "") >= floor]
    if year:
        rows = [r for r in rows if str(r.get("release_date"))[:4] == str(year)] or rows
    if not rows:
        return None
    best = max(rows, key=lambda r: r.get("popularity") or 0)
    details = bf.details(api, [best["id"]], cache)
    if not details:
        return None
    f = details[0]
    raw = f.pop("_raw")
    f.pop("yt", None)
    day, where = bf.us_release(raw)
    mixed = streamer(ups)
    if mixed:
        digital, _note = bf.us_digital(raw, "0000-00-00", "9999-99-99")
        day, where = digital or day, "streaming"
    return {**f, "d": day or f["d"], "where": where or "theaters", "on": mixed if where == "streaming" else ""}


def rank(u):
    """The copy to use: a studio's over the house's, then the newest."""
    return (u["kind"] != HOUSE, u["at"])


def order_fresh(entries, now):
    def hours(e):
        return max((now - e["at"]) / 3600, 1)

    hot = [e for e in entries if (now - e["at"]) / 3600 <= HOT_HOURS]
    rest = [e for e in entries if (now - e["at"]) / 3600 > HOT_HOURS]
    hot.sort(key=lambda e: e.get("_views", 0) / hours(e), reverse=True)
    rest.sort(key=lambda e: e["at"], reverse=True)
    return hot + rest


def read_json(path):
    try:
        with open(path, encoding="utf-8") as src:
            out = json.load(src)
        return out if isinstance(out, dict) else {}
    except (OSError, ValueError):
        return {}


def load_films(source, fetch):
    if not source:
        return {}
    try:
        if re.match(r"https?://", source):
            return json.loads(fetch(source))
        return read_json(source)
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        log(f"films.json: {e}")
        return {}


def film_keys(films):
    """Every key the page can put on the card, in shelf order."""
    keys = []
    for shelf in ("now", "soon", "trend", "stream", "top", "tv_stream", "tv_air"):
        for f in (films or {}).get(shelf) or []:
            yt = str((f or {}).get("yt") or "")
            if bf.YT_KEY.match(yt) and yt not in keys:
                keys.append(yt)
    return keys


# --------------------------------------------------------------------- run
def build(uploads, facts_for, prev, seen, films, now, api=None, dead=()):
    """(fresh, past) from what was read. facts_for(ids) answers
    {yt: {secs, plays, views}} and may leave out what it could not tell. dead
    is the last file's keys that no longer play, so they are not carried on."""
    today = datetime.fromtimestamp(now, timezone.utc).date()
    year = today.year
    known = {}
    for e in list(prev.get("past") or []) + list(prev.get("fresh") or []):
        if isinstance(e, dict) and isinstance(e.get("id"), int) and bf.YT_KEY.match(str(e.get("yt") or "")):
            if api and e["id"] >= LOCAL_ID:
                continue          # a title the no-TMDB gate let in goes back through TMDB
            known[e["yt"]] = {k: v for k, v in e.items() if not k.startswith("_")}

    groups = {}
    for u in uploads:
        if now - u["at"] > PAST_DAYS * DAY or not is_trailer(u["title"], year):
            continue
        key = norm(film_title(u["title"]))
        if key:
            groups.setdefault(key, []).append(u)

    shelves = new_shelves(films, today)
    unmatched = seen.setdefault("unmatched", {})
    cache = {}
    accepted = {}
    for key, ups in groups.items():
        hit = next((known[u["yt"]] for u in ups if u["yt"] in known), None)
        if hit:
            accepted[key] = {k: hit[k] for k in hit if k not in ("yt", "at", "ch", "dur")}
        elif api is None:
            f = local_gate(key, ups, shelves, today)
            if f:
                accepted[key] = f
        else:
            first = unmatched.setdefault(key, now)
            if now - first > RETRY_DAYS * DAY:
                continue
            names = [film_title(u["title"]) for u in ups]
            f = tmdb_gate(api, next((n for n in names if n != n.upper()), names[0]), year_of([u["title"] for u in ups]), today, cache, ups)
            if f:
                accepted[key] = f
                unmatched.pop(key, None)

    wanted = sorted({u["yt"] for key in accepted for u in groups[key]})
    facts = facts_for(wanted) if wanted else {}

    def fits(got):
        return got["plays"] and (got["secs"] is None or MIN_SEC <= got["secs"] <= MAX_SEC)

    def playable(u):
        got = facts.get(u["yt"])
        return fits(got) if got else not RED_BAND.search(u["title"])    # usually age-gated, so not on a guess

    fresh, past, used = [], [], set()
    for key, f in accepted.items():
        ups = sorted((u for u in groups[key] if playable(u)), key=rank, reverse=True)
        recent = [u for u in ups if now - u["at"] <= FRESH_DAYS * DAY]
        u = (recent or ups or [None])[0]
        if not u:
            continue
        got = facts.get(u["yt"]) or {}
        entry = {**f, "yt": u["yt"], "at": u["at"], "ch": u["ch"], "_views": got.get("views") or u["views"]}
        if got.get("secs"):
            entry["dur"] = f"{got['secs'] // 60}:{got['secs'] % 60:02d}"
        (fresh if recent else past).append(entry)
        used.add(f.get("id"))

    # older weeks from the last file: a feed only holds the last 15 uploads
    for yt, e in known.items():
        age = now - int(e.get("at") or 0)
        if e.get("id") in used or age > PAST_DAYS * DAY or yt in dead or (yt in facts and not fits(facts[yt])):
            continue
        used.add(e["id"])
        (fresh if age <= FRESH_DAYS * DAY else past).append(e)

    fresh = order_fresh(fresh, now)
    past.sort(key=lambda e: e["at"], reverse=True)
    return [strip(e) for e in fresh], [strip(e) for e in past[:PAST_MAX]]


def back_catalogue(fresh, past, films, prev, dead):
    """past filled to PAST_MAX with the films' own trailers: one row a film,
    never one the channels already gave, never a key that will not play."""
    rows = [f for shelf in BACK_SHELVES for f in (films or {}).get(shelf) or []]
    if not any(isinstance(f, dict) and f.get("yt") for f in rows):
        rows = [e for e in prev.get("past") or [] if isinstance(e, dict) and not e.get("at")]
    ids = {e.get("id") for e in fresh + past}
    names = {norm(e.get("t")) for e in fresh + past}
    keys = {e.get("yt") for e in fresh + past}
    out = list(past)
    for f in rows:
        if len(out) >= PAST_MAX:
            break
        yt = str((f or {}).get("yt") or "") if isinstance(f, dict) else ""
        if not bf.YT_KEY.match(yt) or yt in dead or yt in keys or f.get("id") in ids or norm(f.get("t")) in names or not f.get("t"):
            continue
        ids.add(f.get("id"))
        names.add(norm(f.get("t")))
        keys.add(yt)
        out.append(strip({k: f[k] for k in BACK_FIELDS if f.get(k) is not None}))
    return out


def strip(entry):
    return {k: v for k, v in entry.items() if not k.startswith("_") and v != ""}


def carried_keys(prev):
    """The last file's own keys, which build() would carry on."""
    rows = list(prev.get("past") or []) + list(prev.get("fresh") or [])
    return [e["yt"] for e in rows if isinstance(e, dict) and bf.YT_KEY.match(str(e.get("yt") or ""))]


def check_keys(keys, facts_for, seen, now, limit=None):
    """The keys that will not play, each asked at most monthly."""
    checked = seen.setdefault("checked", {})
    due = [k for k in keys if k not in checked or now - checked[k][0] > RECHECK_DAYS * DAY][:limit]
    if due:
        got = facts_for(due)
        for k in due:
            if k in got:
                checked[k] = [now, 1 if got[k]["plays"] else 0]
    for k in [k for k in checked if k not in keys]:
        del checked[k]
    return [k for k in keys if k in checked and not checked[k][1]]


def run(args, fetch=None, api=None, now=None):
    fetch = fetch or http_get
    now = now or int(datetime.now(timezone.utc).timestamp())
    yt_key = "" if args.rss else os.environ.get("YOUTUBE_API_KEY", "").strip()
    tmdb_key = os.environ.get("TMDB_API_KEY", "").strip()
    if api is None and tmdb_key:
        api = bf.Tmdb(tmdb_key)
    prev = read_json(args.out)
    seen_path = args.seen or os.path.join(os.path.dirname(args.out) or ".", "trailers-seen.json")
    seen = read_json(seen_path)

    uploads, read = read_api(fetch, yt_key) if yt_key else read_rss(fetch)
    if not read:
        log("no channel could be read; keeping the last file")
        return 0
    if yt_key:
        def facts_for(ids):
            return api_facts(fetch, yt_key, ids)
    else:
        def facts_for(ids):
            return page_facts(fetch, ids)

    films = load_films(args.films, fetch)
    keys = film_keys(films)
    held = dict(seen.get("checked") or {})
    try:
        dead = set(check_keys(list(dict.fromkeys(keys + carried_keys(prev))), facts_for, seen, now, None if yt_key else PAGE_KEYS_MAX))
        fresh, past = build(uploads, facts_for, prev, seen, films, now, api, dead)
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        log(f"could not check the videos ({e}); keeping the last file")
        return 0
    if keys:
        skip = [k for k in keys if k in dead]
    else:                     # films.json did not load: its answers from last time stand
        skip = prev.get("skip") or []
        seen["checked"] = {**held, **seen["checked"]}
    if not fresh and not past and (prev.get("fresh") or prev.get("past")):
        log("nothing passed the gates; keeping the last file")
        return 0
    past = back_catalogue(fresh, past, films, prev, dead)
    built = datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    source = ("YouTube" if yt_key else "YouTube RSS") + (", TMDB" if api else "")
    bf.write_json(args.out, {"v": 1, "built": built, "source": source, "fresh": fresh, "past": past, "skip": skip})
    bf.write_json(seen_path, seen)
    log(f"{read} channels, {len(uploads)} uploads: {len(fresh)} fresh, {len(past)} past, {len(skip)} skipped keys ({source})")
    return 0


# --------------------------------------------------------------- selftest
# real titles from the channels' feeds on 2026-10-30
SELFTEST_NOW = int(datetime(2026, 10, 30, 21, 0, tzinfo=timezone.utc).timestamp())


def upload(yt, title, days, ch="Sony", kind=STUDIO, views=1000, desc=""):
    return {"yt": yt, "title": title, "at": SELFTEST_NOW - int(days * DAY), "views": views, "desc": desc, "ch": ch, "kind": kind}


class FakeTmdb:
    """The two calls tmdb_gate makes, from a tiny table."""

    def __init__(self, rows):
        self.rows = rows

    def get(self, path, **params):
        if path == "/search/movie":
            return {"results": [r for r in self.rows if norm(r["title"]) == norm(params["query"])]}
        wanted = int(path.rsplit("/", 1)[1])
        row = next(r for r in self.rows if r["id"] == wanted)
        return {**row, "genres": [{"name": "Adventure"}], "overview": "An overview.", "poster_path": "/x.jpg", "runtime": 118, "release_dates": {"results": []}}


def selftest():
    today = datetime(2026, 10, 30).date()
    for title, want in (("Jumanji: Open World Trailer #2 (2026)", "Jumanji: Open World"), ("JUMANJI: OPEN WORLD - New Trailer (4K)", "JUMANJI: OPEN WORLD"),
                        ("BEHEMOTH! | Official Trailer | Searchlight Pictures", "BEHEMOTH!"), ("Dune: Part Three Final Trailer (2026)", "Dune: Part Three"),
                        ("Above the Below (2026) Official Trailer - Idris Elba, Caitlin FitzGerald, Hero Fiennes Tiffin", "Above the Below"),
                        ("Way of the Warrior Kid — Official Trailer | Apple TV", "Way of the Warrior Kid"), ("Hexed Teaser - Tickets on Sale (2026)", "Hexed"),
                        ("BUNKER | Starring Javier Bardem & Penélope Cruz | Official US Trailer (2027)", "BUNKER"), ("The Mosquito Bowl Red Band Trailer (2026)", "The Mosquito Bowl"),
                        ("Ebenezer | Official Trailer 2 (2026 Movie) - Johnny Depp, Ian McKellen", "Ebenezer"), ("NEW TRAILER for 'Jumanji: Open World' (2026)", "Jumanji: Open World"),
                        ("Clarissa - Official Trailer - In Select Theaters December", "Clarissa")):
        assert film_title(title) == want, (title, film_title(title))
    for title in ("How To Rob A Bank | Fortnite Announcement Trailer", "PADDINGTON (2014) Official Trailer - Hugh Bonneville, Sally Hawkins, Nicole Kidman",
                  "New Trailers This Week | Week 43", "The Cat in the Hat | Roblox Trailer", "The Host 20th Anniversary 4K Re-Release Trailer (2026)",
                  "MARIE ANTOINETTE in 4K | Official Trailer | In US Theaters & on MUBI October 23", "THE ABOMINABLE DR. PHIBES (1971) | Official Trailer | Amazon MGM",
                  "The Irregular at Magic High School THE MOVIE -Yotsuba Succession Arc- Dub Trailer (2026)", "The Mosquito Bowl Exclusive Spot - Get Tickets Now (2026)"):
        assert not is_trailer(title, 2026), title
    assert is_trailer("JUMANJI: OPEN WORLD - New Trailer (4K)", 2026)
    assert release_date("only in theaters and IMAX December 18. Tickets", today) == "2026-12-18"
    assert release_date("See River only in theaters January 15.", today) == "2027-01-15"
    assert release_date("Other Mommy only in theaters October 9", today) == "2026-10-09"
    assert release_date("Terrell & T.O. premieres November 5 on Prime Video.", today) == "2026-11-05"
    assert release_date("exclusively in theatres Christmas Day.", today) == "2026-12-25"
    assert release_date("A groundbreaking symphonic journey.", today) == ""

    assert page_facts_of('"playabilityStatus":{"status":"OK"},"lengthSeconds":"171","playableInEmbed":true') == {"secs": 171, "views": 0, "plays": True}
    assert page_facts_of('"playabilityStatus":{"status":"LOGIN_REQUIRED"},"lengthSeconds":"150"')["plays"] is False
    assert page_facts_of('"playabilityStatus":{"status":"OK"},"playableInEmbed":false')["plays"] is False
    assert page_facts_of("<html>consent</html>") is None
    assert iso_seconds("PT2M51S") == 171 and iso_seconds("PT1H") == 3600 and iso_seconds("P0D") is None

    ups = [upload("jumanjiSony", "JUMANJI: OPEN WORLD - New Trailer (4K)", 2.3, views=11000000),
           upload("jumanjiRTrt", "Jumanji: Open World Trailer #2 (2026)", 2.2, "Rotten Tomatoes Trailers", HOUSE, views=9000),
           upload("behemothSrc", "BEHEMOTH! | Official Trailer | Searchlight Pictures", 2.4, "Searchlight", views=500000),
           upload("dunepart3WB", "Dune: Part Three | Final Trailer", 3.2, "Warner Bros.", views=9000000, desc="Dune: Part Three only in theaters and IMAX December 18."),
           upload("prideNflxxx", "Pride and Prejudice | Official Trailer | Netflix", 2, "Netflix", MIXED, desc="a six-part series"),
           upload("allenNflxxx", "Allen | Official Trailer | Netflix", 3, "Netflix", MIXED, desc="A film about an alien. " + "x" * 200 + " Netflix has TV series, documentaries and feature films."),
           upload("allenRTrrrr", "Allen Trailer #1 (2026)", 3, "Rotten Tomatoes Trailers", HOUSE),
           upload("paddington1", "PADDINGTON (2014) Official Trailer - Hugh Bonneville, Sally Hawkins, Nicole Kidman", 17, "Lionsgate"),
           upload("fortniteAMZ", "How To Rob A Bank | Fortnite Announcement Trailer", 0.4, "Amazon MGM"),
           upload("thisWeekRTr", "New Trailers This Week | Week 43", 3, "Rotten Tomatoes Trailers", HOUSE),
           upload("riverUniver", "River | Official Trailer", 18, "Universal", desc="only in theaters January 15"),
           upload("marvelShoww", "Vision Quest | Official Trailer | Disney+", 2, "Marvel"),
           upload("spotTooShrt", "Cold Harbor | Official Trailer", 1, "A24"),
           upload("redBandAgeR", "The Mosquito Bowl Red Band Trailer (2026)", 3, "Rotten Tomatoes Trailers", HOUSE),
           upload("studioOnlyx", "Cold Lake | Official Trailer", 3, "Warner Bros.", desc="A six-part limited series.")]
    facts = {"spotTooShrt": {"secs": 30, "plays": True, "views": 0}}
    films = {"top": [{"id": 4348, "t": "Pride and Prejudice", "d": "2005-09-16", "yt": "1dYv5u6v55Y"}],
             "soon": [{"id": 777, "t": "Behemoth!", "y": 2026, "d": "2027-03-05", "g": ["Drama"], "o": "An overview.", "rt": 120, "p": "/b.jpg", "where": "theaters", "yt": "1dYv5u6v55Z"}]}

    fresh, past = build(ups, lambda ids: {k: v for k, v in facts.items() if k in ids}, {}, {}, films, SELFTEST_NOW)
    assert [e["t"] for e in fresh][:3] == ["Jumanji: Open World", "Behemoth!", "Allen"], [e["t"] for e in fresh]
    assert fresh[0]["yt"] == "jumanjiSony" and fresh[0]["ch"] == "Sony", "the studio copy wins"
    assert next(e for e in fresh if e["t"] == "Behemoth!")["id"] == 777, "a shelf title brings its TMDB id"
    assert next(e for e in fresh if e["t"] == "Allen")["where"] == "streaming"
    assert next(e for e in fresh if e["t"].startswith("Dune"))["d"] == "2026-12-18"
    names = {e["t"] for e in fresh + past}
    assert not names & {"Pride and Prejudice", "Paddington", "How To Rob A Bank", "Vision Quest", "Cold Harbor", "Cold Lake", "The Mosquito Bowl"}, names
    assert [e["t"] for e in past] == ["River"] and all(LOCAL_ID <= e["id"] < 50000000 for e in past)

    # the next run keeps older weeks the feed no longer holds, and no duplicates
    again, past2 = build([], lambda ids: {}, {"fresh": fresh, "past": past}, {}, films, SELFTEST_NOW + 8 * DAY)
    assert not again and {e["t"] for e in past2} >= {"River", "Jumanji: Open World"} and len({e["id"] for e in past2}) == len(past2)

    # TMDB: exact title, recent or ahead; series fail; a miss is retried, then let go
    tmdb = FakeTmdb([{"id": 5, "title": "Jumanji: Open World", "release_date": "2026-12-25", "popularity": 90},
                     {"id": 6, "title": "Pride and Prejudice", "release_date": "2005-09-16", "popularity": 50},
                     {"id": 7, "title": "Allen", "release_date": "2026-11-20", "popularity": 10}])
    seen = {}
    fresh, past = build(ups[:7], lambda ids: {}, {}, seen, {}, SELFTEST_NOW, tmdb)
    assert [e["id"] for e in fresh] == [5, 7], fresh
    assert fresh[0]["g"] == ["Adventure"] and fresh[0]["rt"] == 118 and fresh[0]["p"] == "/x.jpg" and fresh[0]["d"] == "2026-12-25"
    assert fresh[1]["where"] == "streaming" and fresh[1]["on"] == "Netflix"
    assert norm("Pride and Prejudice") in seen["unmatched"]
    seen["unmatched"][norm("Pride and Prejudice")] = SELFTEST_NOW - 8 * DAY
    calls = []
    tmdb.get = lambda path, **params: calls.append(params) or {"results": []}
    build(ups[4:5], lambda ids: {}, {}, seen, {}, SELFTEST_NOW, tmdb)
    assert not calls, "a title past its week is not asked again"

    # a local entry goes back through TMDB once there is a key
    local = {"id": local_id("river"), "t": "River", "yt": "riverUniver", "at": SELFTEST_NOW - 18 * DAY, "ch": "Universal"}
    assert build([], lambda ids: {}, {"past": [local]}, {}, {}, SELFTEST_NOW, FakeTmdb([]))[1] == []

    seen = {}
    assert check_keys(["P87QXvvav7Y", "dQw4w9WgXcQ"], lambda ids: {"P87QXvvav7Y": {"plays": False}, "dQw4w9WgXcQ": {"plays": True}}, seen, SELFTEST_NOW) == ["P87QXvvav7Y"]
    assert check_keys(["P87QXvvav7Y"], lambda ids: 1 / 0, seen, SELFTEST_NOW + DAY) == ["P87QXvvav7Y"], "a key is asked at most monthly"
    assert list(seen["checked"]) == ["P87QXvvav7Y"]

    # the older weeks are not carried past a check that failed them
    old = upload("rejectedOne", "River | Official Trailer", 18, "Universal")
    prior = {"past": [{"id": 9, "t": "River", "yt": "rejectedOne", "at": old["at"], "ch": "Universal"}]}
    for secs, plays in ((120, False), (20, True)):
        assert build([old], lambda ids: {"rejectedOne": {"secs": secs, "plays": plays, "views": 0}}, prior, {}, {}, SELFTEST_NOW) == ([], [])
    assert build([], lambda ids: {}, prior, {}, {}, SELFTEST_NOW, dead={"rejectedOne"}) == ([], [])
    assert [e["yt"] for e in build([], lambda ids: {}, prior, {}, {}, SELFTEST_NOW)[1]] == ["rejectedOne"], "unknown is not rejected"
    print("selftest ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default="data/trailers.json")
    parser.add_argument("--seen", default="")
    parser.add_argument("--films", default=FILMS_URL, help="films.json, a URL or a path")
    parser.add_argument("--rss", action="store_true", help="read RSS even with a YouTube key")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return 0
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
