#!/usr/bin/env python3
"""Build all-day/data/music.json — the Music tab's payload.

Four inputs, and only one of them is trusted to name an artist:

  * data/music-artists.json — the hand-curated roster. NOTHING else can
    introduce a name. That rule exists because every automatic source tried
    during research produced plausible-looking garbage: parsing Rocket Shop
    episode titles yields "bands" called Breathwork and Lost Media, and the
    iTunes catalogue happily confirms both, because it has no idea Vermont
    exists. A page that claims to know the local scene cannot invent bands.
  * data/events/events.jsonl — the calendar, for "who is playing this week"
    and for the venue calendar (`calendar`).
  * The Rocket Shop Radio Hour feed — Big Heavy World's archive of live
    in-studio sessions by Vermont artists, ~300 episodes with real audio.
  * The Higher Ground and Flynn event adapters, called directly, for the two
    big-room calendars (`bigrooms`). events.jsonl stops at the pipeline's
    60-day window; both rooms have announced far past it (HG into January,
    the Flynn into May), and a room calendar that stops in October would
    misrepresent both.

Matching an artist to a show is deliberately conservative: word-boundary,
case-folded, music-category events only, and the name must be long enough
that it cannot collide. Without the length floor, "WAX" matches half the
calendar and "Brunch" matches Board Game Brunch at a comic shop — both
observed. A wrong show on an artist card is worse than no show at all.

Bandcamp album ids are read from each artist's /music page, because Bandcamp
publishes no API and no feed. They are what lets the tab embed a player that
plays a whole track rather than a thirty-second preview.

Run: python3 scripts/build_music.py
"""

from __future__ import annotations

import datetime as dt
import html
import importlib
import json
import pathlib
import re
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
ROSTER = ROOT / "data" / "music-artists.json"
EVENTS = ROOT / "data" / "events" / "events.jsonl"
EVENTS_PKG = ROOT / "scripts" / "events"          # where sources/ and common live
OUT = ROOT / "all-day" / "data" / "music.json"

ROCKET_RSS = "https://bigheavyworld.com/rocket-shop-podcast?format=rss"
UA = {"User-Agent": "Mozilla/5.0 (compatible; btown-brief/1.0; +https://btownbrief.com)"}

# A name shorter than this cannot be matched against event titles: "WAX",
# "MJT" and "ONE" would hit constantly. They still get a card, just no shows.
MIN_MATCH_LEN = 6
WINDOW_DAYS = 60

# The two rooms that get their own full calendar, fetched from their own
# adapters so they are not clipped to the pipeline's 60-day window.
#   * `venue` is what the adapter canonicalises the room to; anything else the
#     room promotes belongs to somebody else's calendar. Higher Ground lists a
#     dozen shows a season at Shelburne Museum, Spruce Peak and the Flynn.
#   * `blank_venue` accepts rows the adapter left without a venue. Only the
#     Flynn produces those: its Algolia records carry no Location facet for
#     in-house productions (observed: "Playing Fields", "Bluey's Big Play"),
#     and the Flynn's own listing with no other room named is the Flynn.
#   * `collapse` folds a multi-performance run into one row. The Flynn sells
#     one show as fourteen performances; without this the calendar reads as a
#     fortnight of different shows.
BIG_ROOMS = [
    {"name": "Higher Ground", "source": "higherground",
     "site": "https://highergroundmusic.com/calendar/",
     "venue": "Higher Ground", "blank_venue": False, "collapse": False},
    {"name": "The Flynn", "source": "flynn",
     "site": "https://www.flynnvt.org/Events",
     "venue": "The Flynn", "blank_venue": True, "collapse": True},
]
BIG_ROOM_DAYS = 400   # past the furthest either room has ever announced

# A run survives one dark day — theatres go dark Mondays and the Flynn's
# September run of "Playing Fields" does exactly that. Two dark days in a row
# is a different booking.
RUN_GAP_DAYS = 2

# A price longer than this is prose, not a price ("$10 Please be aware, our
# venues are 21+ starting at 9pm nightly…" is a real cost string). The date
# list has one short column for it.
PRICE_MAX = 30


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def get(url: str, timeout: int = 30) -> str | None:
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    except Exception as e:
        log(f"  fetch failed {url[:60]}: {e}")
        return None


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def fold(s: str) -> str:
    """Case-fold and flatten the punctuation people spell differently."""
    return re.sub(r"\s+", " ", re.sub(r"[’']", "'", s or "").lower()).strip()


# ----------------------------------------------------------------- bandcamp
_ALBUM_RE = re.compile(r'data-item-id="album-(\d+)"')
_TITLE_NEAR_RE = re.compile(r'<p class="title">\s*(.*?)\s*</p>', re.S)
_ART_RE = re.compile(r'<img[^>]+src="(https://f\d+\.bcbits\.com/img/[^"]+)"')


def bandcamp(url: str) -> dict | None:
    """First release on an artist's /music page: id, title, cover art.

    A roster link may point at the artist root OR at one album, so this walks
    back to the subdomain root before asking for /music — otherwise the album
    URLs pick up a second /music and 404."""
    m = re.match(r"(https?://[^/]+)", url.strip())
    if not m:
        return None
    root = m.group(1)
    page = get(root + "/music") or get(url.rstrip("/")) or get(root)
    if not page:
        return None
    m = _ALBUM_RE.search(page)
    if not m:
        return None
    album_id = m.group(1)
    title = None
    near = page[m.start(): m.start() + 900]
    t = _TITLE_NEAR_RE.search(near)
    if t:
        title = html.unescape(re.sub(r"<[^>]+>", "", t.group(1))).strip()
    art = None
    a = _ART_RE.search(near) or _ART_RE.search(page)
    if a:
        art = a.group(1)
    return {"album": album_id, "title": title or None, "art": art}


# --------------------------------------------------------------- rocket shop
_DATE_TAIL = (r"\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
              r"[a-z]*\.?\s+\d{4}")


def rocket_sessions() -> list[dict]:
    xml = get(ROCKET_RSS, timeout=60)
    if not xml:
        return []
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as e:
        log(f"  rocket shop feed did not parse: {e}")
        return []
    out = []
    for item in root.findall(".//item"):
        enc = item.find("enclosure")
        if enc is None or not enc.get("url"):
            continue
        out.append({
            "title": (item.findtext("title") or "").strip(),
            "audio": enc.get("url"),
            "url": (item.findtext("link") or "").strip() or None,
            "date": (item.findtext("pubDate") or "")[:16].strip(),
        })
    return out


def session_for(name: str, sessions: list[dict]) -> dict | None:
    """A session belongs to an artist when the episode title starts with the
    name — Rocket Shop titles lead with the guest. Anything looser matches
    prose ("...From Pete Seeger to Today") and attributes it to the wrong act."""
    want = fold(name)
    if len(want) < 4:
        return None
    for s in sessions:
        t = fold(s["title"])
        t = re.sub(r"(?i)\s*(?:[-–—|:].*)$", "", t)
        t = re.sub(r"(?i)\s*" + _DATE_TAIL + r".*$", "", t).strip()
        if t == want or t.startswith(want + " "):
            return s
    return None


# -------------------------------------------------------------------- shows
def load_events() -> list[dict]:
    if not EVENTS.exists():
        log(f"  no events file at {EVENTS}")
        return []
    rows = []
    for line in EVENTS.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


# ------------------------------------------------------------- calendar rows
# One row shape, used by the artist cards, the venue calendar and the two big
# rooms alike, so the UI renders all three with the same component.
#   {date, time, venue, vid, title, url, price, free}  (+ through, on a run)

_MONEY_RE = re.compile(r"\$\d+(?:,\d{3})*(?:\.\d{2})?"
                       r"(?:\s*[–—-]\s*\$?\d+(?:,\d{3})*(?:\.\d{2})?)?")
_TIME_RE = re.compile(r"^(\d{1,2})(?::(\d{2}))?\s*([APap])")


def price_free(cost: str | None) -> tuple[str, bool]:
    """Cost text -> (short display price, free?).

    "Free" is a boolean, not a price, so it does not also ride in the display
    string. A cost that has turned into a paragraph is cut back to the money
    it names; nothing is invented, only dropped."""
    text = " ".join((cost or "").split())
    if not text:
        return "", False
    if text.lower() in ("free", "free!", "no cover"):
        return "", True
    if len(text) > PRICE_MAX:
        m = _MONEY_RE.search(text)
        text = m.group(0) if m else text[:PRICE_MAX - 1].rstrip() + "…"
    return text, False


def minutes(t: str | None) -> int:
    """"7 PM" -> 1140, for sorting. Lexical order puts 10 PM before 7 PM."""
    m = _TIME_RE.match((t or "").strip())
    if not m:
        return 24 * 60  # unknown time sorts to the end of its day
    h = int(m.group(1)) % 12
    if m.group(3).lower() == "p":
        h += 12
    return h * 60 + int(m.group(2) or 0)


def row_from_export(e: dict) -> dict:
    """A row from events.jsonl (the newsletter export schema: time already
    formatted "7:30 PM", price in `cost`, town in `city`)."""
    venue = " ".join((e.get("venue") or "").split())
    price, free = price_free(e.get("cost"))
    return {
        "date": e.get("date"),
        "time": " ".join((e.get("time") or "").split()),
        "venue": venue,
        "vid": slug(venue),
        "title": e.get("title") or "",
        "url": e.get("url") or "",
        "price": price,
        "free": free,
    }


def row_from_event(e: dict, venue: str) -> dict:
    """A row from an adapter's make_event() dict (ISO `start`, `price`/`free`
    already split). Times are formatted exactly as update.py formats them for
    events.jsonl so both halves of the payload read the same."""
    t = ""
    if not e.get("allDay") and e.get("start"):
        try:
            t = dt.datetime.fromisoformat(e["start"]).strftime("%-I:%M %p").replace(":00 ", " ")
        except ValueError:
            t = ""
    price, _ = price_free(e.get("price"))
    return {
        "date": e.get("date"),
        "time": t,
        "venue": venue,
        "vid": slug(venue),
        "title": e.get("title") or "",
        "url": e.get("url") or "",
        "price": price,
        "free": bool(e.get("free")),
    }


def in_window(d: str | None, today: dt.date, days: int) -> bool:
    try:
        day = dt.date.fromisoformat(d or "")
    except ValueError:
        return False
    return today <= day <= today + dt.timedelta(days=days)


# A bill reads "The Dream Eaters w/ Cady Ternity" or "HONKY TONK TUESDAY:
# Marley Hale & Wild Leek River" — an act sits at the start, or straight after
# one of these separators, and ends at one or at the end of the string.
# Requiring that is what stops the band Brunch matching "Sunday Brunch Tunes"
# at Hotel Vermont, which is a real listing that a plain word-boundary match
# happily claimed.
_BILL_BEFORE = r"(?:^|[:,+/|]\s*|\s(?:w/|with|and|&|ft\.?|feat\.?|featuring|presents|plus)\s+)"
_BILL_AFTER = r"(?:$|\s*[:,+/|(]|\s+(?:w/|with|and|&|ft\.?|feat\.?|featuring|plus)\s)"


def shows_for(name: str, events: list[dict], today: dt.date) -> list[dict]:
    if len(name) < MIN_MATCH_LEN:
        return []
    pat = re.compile(_BILL_BEFORE + re.escape(fold(name)) + _BILL_AFTER)
    out = []
    for e in events:
        if e.get("category") != "music":
            continue
        if not in_window(e.get("date"), today, WINDOW_DAYS):
            continue
        sig = e.get("signals") or {}
        hay = fold(sig.get("artist") or "") or fold(e.get("title") or "")
        if not pat.search(hay):
            # the support bill is named in the title too
            if not pat.search(fold(e.get("title") or "")):
                continue
        out.append(row_from_export(e))
    out.sort(key=lambda s: (s["date"], minutes(s["time"])))
    return out[:4]


# ---------------------------------------------------------- venue calendar
def build_calendar(events: list[dict], today: dt.date) -> dict:
    """Every music event in the pipeline's window, as a date-and-text list
    plus the venue counts that drive the filter chips.

    "Music" is the same test the artist matcher uses — the pipeline's own
    category — so an event can never be on one surface and off the other.

    A show with no venue is dropped: the row has nothing to print in its venue
    column and no chip to file itself under. A handful per build, all of them
    listings where the source itself named no room. The count is logged."""
    rows, no_venue = [], []
    for e in events:
        if e.get("category") != "music":
            continue
        if not in_window(e.get("date"), today, WINDOW_DAYS):
            continue
        r = row_from_export(e)
        if not r["vid"] or not r["title"]:
            no_venue.append(f'{r["date"]} {r["title"][:40]}')
            continue
        rows.append(r)

    # Two sources spell one room two ways ("Cathedral Church of St Paul" /
    # "St. Paul"). They slug to the same chip, so the rows adopt the commonest
    # spelling — a chip that reads one thing filtering rows that read another
    # looks like a bug.
    spellings: dict[str, dict[str, int]] = {}
    for r in rows:
        s = spellings.setdefault(r["vid"], {})
        s[r["venue"]] = s.get(r["venue"], 0) + 1
    canon = {vid: max(s.items(), key=lambda kv: (kv[1], kv[0]))[0]
             for vid, s in spellings.items()}
    for r in rows:
        r["venue"] = canon[r["vid"]]
    rows.sort(key=lambda r: (r["date"], minutes(r["time"]), r["venue"], r["title"]))

    counts: dict[str, dict] = {}
    for r in rows:
        v = counts.setdefault(r["vid"], {"id": r["vid"], "name": r["venue"], "n": 0})
        v["n"] += 1
    venues = sorted(counts.values(), key=lambda v: (-v["n"], v["name"].lower()))

    if no_venue:
        log(f"  calendar: dropped {len(no_venue)} music events with no venue: "
            + "; ".join(no_venue[:6]))
    return {"window": WINDOW_DAYS, "venues": venues, "events": rows}


# ------------------------------------------------------------- the big rooms
def collapse_runs(rows: list[dict]) -> list[dict]:
    """Same title in the same room across consecutive dates is one run.

    The Flynn sells a show as performances: CINDERELLA is six records over
    four days, "Playing Fields" is fourteen over thirteen. Listed straight,
    a fortnight of the calendar is one show repeated. The first performance
    keeps the row; the last date becomes `through`."""
    groups: dict[tuple[str, str], list[dict]] = {}
    for r in rows:
        groups.setdefault((fold(r["title"]), r["vid"]), []).append(r)

    def close(run: list[dict]) -> dict:
        row = dict(run[0])
        if run[-1]["date"] != row["date"]:
            row["through"] = run[-1]["date"]
        return row

    out = []
    for g in groups.values():
        g.sort(key=lambda r: (r["date"], minutes(r["time"])))
        run = [g[0]]
        for r in g[1:]:
            gap = (dt.date.fromisoformat(r["date"])
                   - dt.date.fromisoformat(run[-1]["date"])).days
            if gap <= RUN_GAP_DAYS:
                run.append(r)
            else:
                out.append(close(run))
                run = [r]
        out.append(close(run))
    return out


def big_room(room: dict, today: dt.date) -> dict:
    """One room's whole announced calendar, straight from its adapter.

    Never returns without an `events` key, and never returns an empty one
    without an `error` beside it: a room whose site went down must not read as
    a room with nothing on."""
    out = {"id": slug(room["name"]), "name": room["name"], "site": room["site"],
           "far": None, "n": 0, "events": []}
    try:
        # scripts/events/sources/__pycache__ is (unfortunately) git-tracked, so
        # a read-only data build must not rewrite it every run.
        sys.dont_write_bytecode = True
        if str(EVENTS_PKG) not in sys.path:
            sys.path.insert(0, str(EVENTS_PKG))
        mod = importlib.import_module(f"sources.{room['source']}")
        raw = mod.fetch(today, today + dt.timedelta(days=BIG_ROOM_DAYS))
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
        log(f"  {room['name']}: FETCH FAILED — {out['error']}")
        return out

    rows, elsewhere, blank, dropped = [], set(), [], 0
    for e in raw:
        venue = " ".join((e.get("venue") or "").split())
        if not venue and room["blank_venue"]:
            blank.append(e.get("title") or "")
            venue = room["venue"]
        if fold(venue) != fold(room["venue"]):
            elsewhere.add(venue or "(no venue)")
            dropped += 1
            continue
        if not e.get("date") or not e.get("title"):
            continue
        rows.append(row_from_event(e, room["venue"]))

    if room["collapse"]:
        before = len(rows)
        rows = collapse_runs(rows)
        log(f"  {room['name']}: {before} performances collapsed to {len(rows)} shows")
    rows.sort(key=lambda r: (r["date"], minutes(r["time"]), r["title"]))

    out["events"] = rows
    out["n"] = len(rows)
    out["far"] = max((r.get("through") or r["date"]) for r in rows) if rows else None
    if not rows:
        out["error"] = "the adapter returned no events for this room"
        log(f"  {room['name']}: NO events — the adapter ran but matched nothing")
    if elsewhere:
        log(f"  {room['name']}: dropped {dropped} listings at other rooms: "
            f"{sorted(elsewhere)}")
    if blank:
        log(f"  {room['name']}: {len(blank)} listings stated no room, kept as "
            f"{room['venue']}: {sorted(set(blank))}")
    return out


def main() -> int:
    # what the last good build found, so a rate-limited fetch degrades to
    # yesterday's answer rather than to nothing
    prev_bandcamp: dict[str, dict] = {}
    if OUT.exists():
        try:
            for a in json.loads(OUT.read_text(encoding="utf-8")).get("artists", []):
                if a.get("bandcamp"):
                    prev_bandcamp[a["name"]] = a["bandcamp"]
        except Exception as e:
            log(f"  couldn't read the previous payload ({e}); starting clean")

    doc = json.loads(ROSTER.read_text(encoding="utf-8"))
    roster = doc["artists"]
    today = dt.date.today()

    log(f"roster: {len(roster)} artists")
    events = load_events()
    log(f"events: {len(events)} rows")
    sessions = rocket_sessions()
    log(f"rocket shop: {len(sessions)} sessions with audio")

    calendar = build_calendar(events, today)
    log(f"calendar: {len(calendar['events'])} music events at "
        f"{len(calendar['venues'])} venues over {WINDOW_DAYS} days")

    log(f"big rooms: fetching {BIG_ROOM_DAYS} days ahead")
    bigrooms = [big_room(r, today) for r in BIG_ROOMS]
    for r in bigrooms:
        log(f"  {r['name']}: {r['n']} shows through {r['far'] or '—'}"
            + (f"  [{r['error']}]" if r.get("error") else ""))

    artists, n_bc, n_se, n_sh = [], 0, 0, 0
    for a in roster:
        name = a["name"]
        rec = {
            "id": slug(name),
            "name": name,
            "genre": a.get("genre"),
            "why": a.get("why"),
            "threads": a.get("threads") or 0,
            "links": a.get("links") or {},
        }
        bc_url = rec["links"].get("bandcamp")
        if bc_url:
            got = bandcamp(bc_url)
            if not got:
                # Bandcamp rate-limits: two builds inside ten minutes and it
                # starts answering 429. Dropping the embed on a 429 publishes a
                # quieter tab and says nothing about why — measured, one such
                # run took the playable count from 85 to 62. Keep what the last
                # good build found; a stale album id still plays, and a real
                # removal costs one extra day to notice.
                got = (prev_bandcamp.get(name))
                if got:
                    log(f"  kept last build's Bandcamp for {name} (fetch failed)")
            if got:
                rec["bandcamp"] = got
                n_bc += 1
        s = session_for(name, sessions)
        if s:
            rec["session"] = s
            n_se += 1
        sh = shows_for(name, events, today)
        if sh:
            rec["shows"] = sh
            n_sh += 1
        artists.append(rec)

    # Sort: playing soon first, then by how loudly the city recommends them.
    artists.sort(key=lambda r: (0 if r.get("shows") else 1, -r["threads"], r["name"].lower()))

    out = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "artists": artists,
        "calendar": calendar,
        "bigrooms": bigrooms,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    log(f"wrote {OUT.relative_to(ROOT)}  "
        f"{len(artists)} artists · {n_bc} with bandcamp · {n_se} with a session · {n_sh} playing soon"
        f" · {len(calendar['events'])} on the calendar · "
        + " + ".join(f"{r['n']} at {r['name']}" for r in bigrooms))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
