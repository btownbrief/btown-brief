#!/usr/bin/env python3
"""Build all-day/data/music.json — the Music tab's payload.

Three inputs, and only one of them is trusted to name an artist:

  * data/music-artists.json — the hand-curated roster. NOTHING else can
    introduce a name. That rule exists because every automatic source tried
    during research produced plausible-looking garbage: parsing Rocket Shop
    episode titles yields "bands" called Breathwork and Lost Media, and the
    iTunes catalogue happily confirms both, because it has no idea Vermont
    exists. A page that claims to know the local scene cannot invent bands.
  * data/events/events.jsonl — the calendar, for "who is playing this week".
  * The Rocket Shop Radio Hour feed — Big Heavy World's archive of live
    in-studio sessions by Vermont artists, ~300 episodes with real audio.

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
OUT = ROOT / "all-day" / "data" / "music.json"

ROCKET_RSS = "https://bigheavyworld.com/rocket-shop-podcast?format=rss"
UA = {"User-Agent": "Mozilla/5.0 (compatible; btown-brief/1.0; +https://btownbrief.com)"}

# A name shorter than this cannot be matched against event titles: "WAX",
# "MJT" and "ONE" would hit constantly. They still get a card, just no shows.
MIN_MATCH_LEN = 6
WINDOW_DAYS = 60


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
        d = e.get("date")
        if not d:
            continue
        try:
            day = dt.date.fromisoformat(d)
        except ValueError:
            continue
        if not (today <= day <= today + dt.timedelta(days=WINDOW_DAYS)):
            continue
        sig = e.get("signals") or {}
        hay = fold(sig.get("artist") or "") or fold(e.get("title") or "")
        if not pat.search(hay):
            # the support bill is named in the title too
            if not pat.search(fold(e.get("title") or "")):
                continue
        out.append({
            "date": d,
            "time": e.get("start", "")[11:16] if not e.get("allDay") else None,
            "venue": e.get("venue"),
            "title": e.get("title"),
            "url": e.get("url"),
            "price": e.get("price"),
            "free": bool(e.get("free")),
        })
    out.sort(key=lambda s: (s["date"], s["time"] or ""))
    return out[:4]


def main() -> int:
    doc = json.loads(ROSTER.read_text(encoding="utf-8"))
    roster = doc["artists"]
    today = dt.date.today()

    log(f"roster: {len(roster)} artists")
    events = load_events()
    log(f"events: {len(events)} rows")
    sessions = rocket_sessions()
    log(f"rocket shop: {len(sessions)} sessions with audio")

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
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    log(f"wrote {OUT.relative_to(ROOT)}  "
        f"{len(artists)} artists · {n_bc} with bandcamp · {n_se} with a session · {n_sh} playing soon")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
