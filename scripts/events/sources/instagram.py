"""Instagram via Scrape Creators — DORMANT until the API key lands.

Burlington venues that only announce events on Instagram (Foam, Venetian
Soda Lounge, Despacito, The Archives, ...). We pull their recent posts
through scrapecreators.com and extract event candidates from captions,
CONSERVATIVELY: a caption must contain an explicit date or we emit nothing.

How to activate
---------------
1. Buy/obtain a Scrape Creators API key (scrapecreators.com).
2. Paste it into ~/btown-brief-prompts/secrets.env as
       SCRAPE_CREATORS_API_KEY=sk_...
   (or export the env var). The key is never logged and never written
   anywhere in this repo.
3. On the FIRST live run, verify POSTS_ENDPOINT below against the current
   Scrape Creators docs — it was written from memory while the key was
   empty and could not be verified. The endpoint path / query param /
   response shape are each isolated in one place (POSTS_ENDPOINT,
   HANDLE_PARAM, _as_post_list, _post_caption, _post_url) so a mismatch
   is a one-line fix.

How to test one handle
----------------------
    cd <repo root>
    python3 - <<'EOF'
    import sys; sys.path.insert(0, "scripts/events")
    from sources import instagram
    instagram.HANDLES = ["foambrewers"]          # just one handle
    from datetime import date, timedelta
    today = date.today()
    for ev in instagram.fetch(today, today + timedelta(days=30)):
        print(ev["date"], ev["start"], "|", ev["title"], "|", ev["url"])
    EOF

Offline caption-parser tests: python3 scripts/events/sources/instagram.py

Complementary manual path: for flyer-only announcements (date baked into
an image, no caption text), screenshot the flyer and have Claude read it —
image analysis of flyer screenshots covers what caption parsing can't.
"""
from __future__ import annotations

import os
import re
import sys
import urllib.parse
from datetime import date, datetime
from pathlib import Path

if __package__ in (None, ""):  # standalone: python3 scripts/events/sources/instagram.py
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import common

SOURCE = "instagram"
LABEL = "Instagram (Scrape Creators)"

SECRETS_ENV = Path.home() / "btown-brief-prompts" / "secrets.env"

# --- Scrape Creators API (UNVERIFIED — confirm on first live run) ----------
# Docs: https://scrapecreators.com (couldn't be checked while the key was
# empty). Assumed: GET {POSTS_ENDPOINT}?handle=<handle> with header
# "x-api-key: <key>". If the first live run 404s, fix these constants.
POSTS_ENDPOINT = "https://api.scrapecreators.com/v1/instagram/user/posts"
HANDLE_PARAM = "handle"
API_KEY_HEADER = "x-api-key"

MAX_POSTS_PER_HANDLE = 24   # recent posts per handle to scan
MAX_EVENTS_PER_CAPTION = 3  # a caption listing more dates than this is noise

# --- EDIT ME: curated handle list ------------------------------------------
# Handles to scan + the venue each one maps to. Seeded with Burlington
# Instagram-only venues; curate/expand this list over time. HANDLES is
# derived from the dict so the two can't drift apart.
HANDLE_TO_VENUE: dict[str, dict] = {
    "foambrewers":        {"venue": "Foam Brewers",         "town": "Burlington"},
    "venetiansodalounge": {"venue": "Venetian Soda Lounge", "town": "Burlington"},
    "despacitovt":        {"venue": "Despacito",            "town": "Burlington"},
    "thearchivesbtv":     {"venue": "The Archives",         "town": "Burlington"},
    "queencitybrewery":   {"venue": "Queen City Brewery",   "town": "Burlington"},
}
HANDLES: list[str] = list(HANDLE_TO_VENUE)
# --- /EDIT ME ---------------------------------------------------------------


def _api_key() -> str | None:
    """SCRAPE_CREATORS_API_KEY from env, else secrets.env. NEVER log/print it."""
    val = os.environ.get("SCRAPE_CREATORS_API_KEY", "").strip()
    if val:
        return val
    try:
        if SECRETS_ENV.exists():
            for line in SECRETS_ENV.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                name, _, v = line.partition("=")
                if name.strip() == "SCRAPE_CREATORS_API_KEY":
                    v = v.strip().strip("'\"")
                    return v or None
    except OSError:
        pass
    return None


# ------------------------------------------------------- caption date parsing

_MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
           "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}

# "July 12" / "Jul 12th" / "July 12, 2026" (weekday prefixes just precede the match)
_WORD_DATE_RE = re.compile(
    r"\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
    r"aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+"
    r"(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b", re.I)

# "7/12" / "7/12/26" — not preceded by $ or digits (prices like "$10/12")
_NUM_DATE_RE = re.compile(r"(?<![\d$./-])(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?(?![\d/])")


def _resolve_date(month: int, day: int, year: int | None, today: date) -> date | None:
    """Explicit year wins; no year -> NEXT occurrence of that month/day."""
    if not 1 <= month <= 12:
        return None
    if year:
        y = year if year >= 100 else 2000 + year
        try:
            return date(y, month, day)
        except ValueError:
            return None
    for y in (today.year, today.year + 1):
        try:
            d = date(y, month, day)
        except ValueError:
            return None
        if d >= today:
            return d
    return None


def _time_near(caption: str, start_idx: int, end_idx: int):
    """Time on the same line as the date match, else within 80 chars after."""
    ls = caption.rfind("\n", 0, start_idx) + 1
    le = caption.find("\n", end_idx)
    le = len(caption) if le == -1 else le
    hm = common.parse_time_str(caption[ls:le])
    if hm is None:
        hm = common.parse_time_str(caption[end_idx:end_idx + 80])
    return hm


def extract_caption_datetimes(caption: str, today: date) -> list[tuple[date, tuple | None]]:
    """Explicit dates only -> [(date, (h, m) | None), ...], deduped, sorted.
    No parseable date -> []. Never guesses ("this weekend" emits nothing)."""
    found: dict[date, tuple | None] = {}
    for m in _WORD_DATE_RE.finditer(caption):
        month = _MONTHS.get(m.group(1)[:3].lower())
        year = int(m.group(3)) if m.group(3) else None
        d = _resolve_date(month or 0, int(m.group(2)), year, today)
        if d and d not in found:
            found[d] = _time_near(caption, m.start(), m.end())
    for m in _NUM_DATE_RE.finditer(caption):
        year = int(m.group(3)) if m.group(3) else None
        d = _resolve_date(int(m.group(1)), int(m.group(2)), year, today)
        if d and d not in found:
            found[d] = _time_near(caption, m.start(), m.end())
    return sorted(found.items())


def _title_from_caption(caption: str) -> str | None:
    """First non-empty caption line, whitespace-collapsed, <= 80 chars."""
    for line in caption.splitlines():
        line = " ".join(line.split())
        if line:
            if len(line) > 80:
                cut = line[:79].rsplit(" ", 1)[0].rstrip(" ,;:·-—|") or line[:79]
                line = cut + "…"
            return line
    return None


def _events_from_caption(caption: str, handle: str, permalink: str,
                         lo: date, hi: date, today: date) -> list[dict]:
    title = _title_from_caption(caption)
    if not title:
        return []
    info = HANDLE_TO_VENUE.get(handle, {})
    clean = " ".join(caption.split())
    events: list[dict] = []
    for d, hm in extract_caption_datetimes(caption, today):
        if d < today or d < lo or d > hi:
            continue
        if len(events) >= MAX_EVENTS_PER_CAPTION:
            common.log(f"instagram: {handle}: caption has >{MAX_EVENTS_PER_CAPTION} "
                       "dates in window — capping (likely a schedule dump)")
            break
        try:
            events.append(common.make_event(
                source=SOURCE, title=title, url=permalink,
                start=common.local_dt(d, hm),
                venue=info.get("venue"), town=info.get("town"),
                description=clean[:200], tags=["instagram"]))
        except Exception as e:  # never let one bad caption kill the run
            common.log(f"instagram: {handle}: skipped candidate ({e})")
    return events


# ------------------------------------------------------- API response shapes
# All tolerant of shape drift; adjust here after the first live run.

def _as_post_list(payload) -> list:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("data", "posts", "items", "results", "edges", "media"):
            v = payload.get(key)
            if isinstance(v, list):
                return v
            if isinstance(v, dict):
                for k2 in ("posts", "items", "edges", "media"):
                    if isinstance(v.get(k2), list):
                        return v[k2]
    return []


def _post_caption(post) -> str | None:
    if not isinstance(post, dict):
        return None
    node = post.get("node") if isinstance(post.get("node"), dict) else post
    cap = node.get("caption")
    if isinstance(cap, str) and cap.strip():
        return cap
    if isinstance(cap, dict) and isinstance(cap.get("text"), str):
        return cap["text"]
    for k in ("caption_text", "text", "description"):
        v = node.get(k)
        if isinstance(v, str) and v.strip():
            return v
    try:  # raw GraphQL shape
        return node["edge_media_to_caption"]["edges"][0]["node"]["text"]
    except (KeyError, IndexError, TypeError):
        return None


def _post_url(post) -> str | None:
    if not isinstance(post, dict):
        return None
    node = post.get("node") if isinstance(post.get("node"), dict) else post
    for k in ("permalink", "url", "link"):
        v = node.get(k)
        if isinstance(v, str) and v.startswith("http"):
            return v
    for k in ("shortcode", "code"):
        v = node.get(k)
        if isinstance(v, str) and v:
            return f"https://www.instagram.com/p/{v}/"
    return None


def _fetch_posts(handle: str, key: str) -> list:
    url = f"{POSTS_ENDPOINT}?{urllib.parse.urlencode({HANDLE_PARAM: handle})}"
    payload = common.fetch_json(url, headers={API_KEY_HEADER: key})
    return _as_post_list(payload)


# ------------------------------------------------------------------- fetch

def fetch(window_start: date, window_end: date) -> list[dict]:
    key = _api_key()
    if not key:
        common.log("instagram: no SCRAPE_CREATORS_API_KEY yet — skipping")
        return []
    today = datetime.now(common.TZ).date()
    events: list[dict] = []
    for handle in HANDLES:
        try:
            posts = _fetch_posts(handle, key)
        except Exception as e:
            common.log(f"instagram: {handle}: fetch failed ({e}) — "
                       "verify POSTS_ENDPOINT against Scrape Creators docs")
            continue
        if not posts:
            common.log(f"instagram: {handle}: 0 posts parsed — "
                       "response shape may differ; inspect _as_post_list")
            continue
        for post in posts[:MAX_POSTS_PER_HANDLE]:
            caption = _post_caption(post)
            url = _post_url(post)
            if caption and url:
                events.extend(_events_from_caption(
                    caption, handle, url, window_start, window_end, today))
    return events


# ------------------------------------------------- offline caption-parser tests

if __name__ == "__main__":
    T = date(2026, 7, 10)  # frozen "today" so tests are deterministic

    cases = [
        # explicit month-name date, no time -> all-day
        ("Live music on the patio!\nJuly 12 · free popcorn",
         [(date(2026, 7, 12), None)]),
        # numeric date, time earlier on the same line
        ("Doors 7pm — 7/12 — no cover", [(date(2026, 7, 12), (19, 0))]),
        # weekday + ordinal + time
        ("Saturday July 12th • 8:30 PM • dance night",
         [(date(2026, 7, 12), (20, 30))]),
        # no explicit date -> nothing (conservative)
        ("Come hang this weekend! Big things happening", []),
        # month/day already past this year -> next year
        ("January 5 vinyl listening night", [(date(2027, 1, 5), None)]),
        # explicit year respected
        ("July 12, 2026 at 6 PM in the beer garden",
         [(date(2026, 7, 12), (18, 0))]),
        # price text must not parse as a date
        ("$10/12 at the door, 21+", []),
        # numeric with 2-digit year + time
        ("Fri 8/1/26 9pm with DJ Disco Phantom", [(date(2026, 8, 1), (21, 0))]),
        # two dates on one line share the line's time
        ("July 12 + July 13, music at 9pm both nights",
         [(date(2026, 7, 12), (21, 0)), (date(2026, 7, 13), (21, 0))]),
        # invalid day never becomes a date
        ("June 45 is not a real day", []),
        # time only in a later window after the date
        ("Mark your calendars: 7/26\nTunes start at 6:00 PM sharp",
         [(date(2026, 7, 26), (18, 0))]),
    ]

    failures = 0
    for caption, expected in cases:
        got = extract_caption_datetimes(caption, T)
        ok = got == expected
        failures += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {caption.splitlines()[0][:48]!r}"
              f"  ->  {got}" + ("" if ok else f"  (expected {expected})"))

    # end-to-end: caption -> make_event with venue mapping + tags
    evs = _events_from_caption(
        "Sunset Sessions vol. 4\nJuly 12 · 6 PM on the deck 🌅",
        "foambrewers", "https://www.instagram.com/p/TEST123/",
        T, date(2026, 9, 1), T)
    assert len(evs) == 1, evs
    ev = evs[0]
    assert ev["title"] == "Sunset Sessions vol. 4", ev["title"]
    assert ev["venue"] == "Foam Brewers", ev["venue"]
    assert ev["town"] == "Burlington", ev["town"]
    assert ev["date"] == "2026-07-12" and not ev["allDay"], (ev["date"], ev["allDay"])
    assert "instagram" in ev["tags"], ev["tags"]
    assert ev["free"] is None and ev["price"] is None, "never invent price"
    print("PASS  end-to-end make_event (venue/town/tags/no-invented-price)")

    # title trimming stays <= 80 chars
    long_title = _title_from_caption("A" * 50 + " " + "B" * 60 + "\nJuly 12")
    assert long_title is not None and len(long_title) <= 80, long_title
    print("PASS  title trimmed to <= 80 chars")

    if _api_key() is None:  # demonstrate the dormant path without network
        out = fetch(T, date(2026, 8, 10))
        assert out == []
        print("PASS  no-key path logs and returns []")
    else:
        print("SKIP  no-key path (a key is configured; not fetching in tests)")

    print(f"\n{len(cases)} parser cases, {failures} failures")
    sys.exit(1 if failures else 0)
