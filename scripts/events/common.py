"""Shared toolkit for BTown Brief event fetchers.

Stdlib only — no pip installs. Every source module in scripts/events/sources/
imports from here and returns events built with make_event().

Source module contract:

    SOURCE = "slug"            # unique, lowercase
    LABEL  = "Human Name"      # for reports
    def fetch(window_start, window_end):   # datetime.date, inclusive
        return [make_event(source=SOURCE, ...), ...]

Rules that bind every fetcher (from the newsletter's golden rules):
  * Never invent data. Unknown field -> None. NEVER default price to Free;
    set free=True only when the source explicitly says free.
  * One event dict per occurrence date (expand recurring/multi-date listings
    within the window; put the human rule text in `recurring`).
  * Keep description plain text, <= 300 chars, no marketing fluff.
  * Facebook/Meetup interest counts go in `signals`, never in description.
"""

from __future__ import annotations

import gzip
import hashlib
import html as _html
import io
import json
import re
import ssl
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/New_York")
EVENTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = EVENTS_DIR.parent.parent
DATA_DIR = REPO_ROOT / "data" / "events"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 BTownBrief-Events/1.0"
)

CATEGORIES = [
    "music",        # live music, concerts, DJ nights, open mics
    "comedy",
    "theater",      # theater, dance performance, opera
    "art",          # exhibits, gallery openings, craft workshops
    "film",
    "food-drink",   # tastings, dinners, brewery events, cooking
    "outdoors",     # hikes, paddles, nature walks, outdoor rec
    "sports",       # spectator + participatory sports, races
    "family",       # kid/family-oriented
    "community",    # socials, meetups, clubs, volunteering, civic
    "learning",     # talks, classes, workshops, author events
    "market",       # farmers markets, craft fairs, pop-ups
    "games",        # trivia, board games, bingo, pinball
    "wellness",     # yoga, meditation, fitness classes
    "words",        # book clubs, readings, poetry, storytelling
    "other",
]

TOWNS = [
    "Burlington", "South Burlington", "Winooski", "Essex", "Essex Junction",
    "Colchester", "Shelburne", "Williston", "Richmond", "Jericho", "Hinesburg",
    "Milton", "Charlotte", "Waterbury", "Stowe", "Montpelier",
]

# ---------------------------------------------------------------- fetching

_LAST_HIT: dict[str, float] = {}
_MIN_GAP = 1.0  # polite seconds between hits to the same host

_SSL_CTX = ssl.create_default_context()


def fetch(url: str, headers: dict | None = None, retries: int = 3,
          timeout: int = 30, method: str = "GET", data: bytes | None = None) -> str:
    """GET a URL politely (UA, gzip, per-host rate limit, retries). Returns text."""
    host = urllib.parse.urlparse(url).netloc
    wait = _MIN_GAP - (time.time() - _LAST_HIT.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    hdrs = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/json,text/calendar,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip",
    }
    if headers:
        hdrs.update(headers)
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=hdrs, method=method, data=data)
            with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as resp:
                raw = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
                _LAST_HIT[host] = time.time()
                charset = resp.headers.get_content_charset() or "utf-8"
                return raw.decode(charset, errors="replace")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
            last_err = e
            code = getattr(e, "code", None)
            if code in (403, 404, 410):   # won't improve with retries
                raise
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"fetch failed after {retries} tries: {url} ({last_err})")


def fetch_json(url: str, **kw):
    return json.loads(fetch(url, **kw))


# ---------------------------------------------------------------- HTML helpers

def strip_tags(fragment: str) -> str:
    """HTML fragment -> collapsed plain text."""
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", fragment, flags=re.S | re.I)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = _html.unescape(text)
    return re.sub(r"[ \t\r\f\v]+", " ", text).strip()


def extract_jsonld(page: str) -> list[dict]:
    """All JSON-LD objects on a page, flattened (handles @graph and arrays)."""
    out: list[dict] = []
    for m in re.finditer(
            r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
            page, flags=re.S | re.I):
        blob = m.group(1).strip()
        try:
            parsed = json.loads(blob)
        except json.JSONDecodeError:
            try:  # some sites leave literal newlines/control chars in strings
                parsed = json.loads(re.sub(r"[\x00-\x1f]", " ", blob))
            except json.JSONDecodeError:
                continue
        stack = [parsed]
        while stack:
            node = stack.pop()
            if isinstance(node, list):
                stack.extend(node)
            elif isinstance(node, dict):
                if "@graph" in node:
                    stack.extend(node["@graph"])
                out.append(node)
    return out


def jsonld_events(page: str) -> list[dict]:
    """JSON-LD nodes whose @type is an Event subtype."""
    evs = []
    for node in extract_jsonld(page):
        t = node.get("@type", "")
        types = t if isinstance(t, list) else [t]
        if any(isinstance(x, str) and "Event" in x for x in types):
            evs.append(node)
    return evs


class LinkCollector(HTMLParser):
    """Collect (href, text) pairs, optionally filtered by an href regex."""

    def __init__(self, pattern: str | None = None):
        super().__init__()
        self.pattern = re.compile(pattern) if pattern else None
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._buf: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            href = dict(attrs).get("href")
            if href and (not self.pattern or self.pattern.search(href)):
                self._href = href
                self._buf = []

    def handle_data(self, d):
        if self._href is not None:
            self._buf.append(d)

    def handle_endtag(self, tag):
        if tag == "a" and self._href is not None:
            self.links.append((self._href, " ".join("".join(self._buf).split())))
            self._href = None


def collect_links(page: str, href_pattern: str) -> list[tuple[str, str]]:
    p = LinkCollector(href_pattern)
    p.feed(page)
    return p.links


# ---------------------------------------------------------------- ICS parsing

def _ics_unfold(text: str) -> list[str]:
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def _ics_parse_dt(value: str, params: dict) -> datetime | date:
    value = value.strip()
    if params.get("VALUE") == "DATE" or re.fullmatch(r"\d{8}", value):
        return date(int(value[:4]), int(value[4:6]), int(value[6:8]))
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)", value)
    if not m:
        raise ValueError(f"bad ICS datetime: {value}")
    y, mo, d, h, mi, s, z = m.groups()
    dt = datetime(int(y), int(mo), int(d), int(h), int(mi), int(s))
    if z == "Z":
        return dt.replace(tzinfo=ZoneInfo("UTC")).astimezone(TZ)
    tzid = params.get("TZID")
    try:
        return dt.replace(tzinfo=ZoneInfo(tzid) if tzid else TZ)
    except Exception:
        return dt.replace(tzinfo=TZ)


_WEEKDAYS = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def _expand_rrule(start, rule: str, exdates: set, lo: date, hi: date) -> list:
    """Expand an RRULE into occurrence starts within [lo, hi]. Supports
    FREQ=DAILY/WEEKLY/MONTHLY(+BYDAY nth), INTERVAL, UNTIL, COUNT, BYDAY."""
    parts = dict(p.split("=", 1) for p in rule.split(";") if "=" in p)
    freq = parts.get("FREQ", "").upper()
    interval = int(parts.get("INTERVAL", 1) or 1)
    count = int(parts["COUNT"]) if parts.get("COUNT") else None
    until: date | None = None
    if parts.get("UNTIL"):
        u = _ics_parse_dt(parts["UNTIL"], {})
        if isinstance(u, datetime):
            # a midnight UNTIL excludes any timed occurrence later that day
            until = u.date() - timedelta(days=1) if (u.hour, u.minute) == (0, 0) \
                and isinstance(start, datetime) and (start.hour, start.minute) != (0, 0) \
                else u.date()
        else:
            until = u
    sdate = start.date() if isinstance(start, datetime) else start

    def mk(d: date):
        if isinstance(start, datetime):
            return start.replace(year=d.year, month=d.month, day=d.day)
        return d

    out, n, cur = [], 0, sdate
    horizon = min(hi, until or hi)
    byday = [b for b in parts.get("BYDAY", "").split(",") if b]

    if freq == "DAILY":
        while cur <= horizon and (count is None or n < count):
            if cur >= lo and cur not in exdates:
                out.append(mk(cur))
            n += 1
            cur += timedelta(days=interval)
    elif freq == "WEEKLY":
        days = sorted(_WEEKDAYS[b[-2:]] for b in byday if b[-2:] in _WEEKDAYS) or [sdate.weekday()]
        week0 = sdate - timedelta(days=sdate.weekday())
        w = 0
        while True:
            base = week0 + timedelta(weeks=w * interval)
            if base > horizon:
                break
            stop = False
            for dw in days:
                d = base + timedelta(days=dw)
                if d < sdate:
                    continue
                if count is not None and n >= count:
                    stop = True
                    break
                n += 1
                if d > horizon:
                    stop = True
                    break
                if d >= lo and d not in exdates:
                    out.append(mk(d))
            if stop:
                break
            w += 1
    elif freq == "MONTHLY":
        # BYDAY like "2TU" (2nd Tuesday) or "-1FR" (last Friday); else same day-of-month
        m = re.fullmatch(r"(-?\d)([A-Z]{2})", byday[0]) if byday else None
        cur_y, cur_m = sdate.year, sdate.month
        while (count is None or n < count):
            first = date(cur_y, cur_m, 1)
            if first > horizon + timedelta(days=31):
                break
            d = None
            if m:
                nth, wd = int(m.group(1)), _WEEKDAYS.get(m.group(2), 0)
                if nth > 0:
                    d = first + timedelta(days=(wd - first.weekday()) % 7 + 7 * (nth - 1))
                    if d.month != cur_m:
                        d = None
                else:
                    nxt = date(cur_y + (cur_m == 12), cur_m % 12 + 1, 1)
                    last = nxt - timedelta(days=1)
                    d = last - timedelta(days=(last.weekday() - wd) % 7)
            else:
                try:
                    d = date(cur_y, cur_m, sdate.day)
                except ValueError:
                    d = None
            if d and d >= sdate:
                n += 1
                if d > horizon:
                    break
                if d >= lo and d not in exdates:
                    out.append(mk(d))
            months = cur_y * 12 + (cur_m - 1) + interval
            cur_y, cur_m = months // 12, months % 12 + 1
    else:
        if lo <= sdate <= hi:
            out.append(start)
    return out


def parse_ics(text: str, lo: date, hi: date) -> list[dict]:
    """Parse ICS text -> list of occurrence dicts within [lo, hi]:
    {summary, start, end, location, description, url, uid, recurring}"""
    events: list[dict] = []
    cur: dict | None = None
    for line in _ics_unfold(text):
        if line.startswith("BEGIN:VEVENT"):
            cur = {"exdates": set()}
            continue
        if cur is None:
            continue
        if line.startswith("END:VEVENT"):
            events.append(cur)
            cur = None
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        name, *plist = key.split(";")
        params = dict(p.split("=", 1) for p in plist if "=" in p)
        name = name.upper()
        try:
            if name == "DTSTART":
                cur["start"] = _ics_parse_dt(value, params)
            elif name == "DTEND":
                cur["end"] = _ics_parse_dt(value, params)
            elif name == "RRULE":
                cur["rrule"] = value.strip()
            elif name == "EXDATE":
                for v in value.split(","):
                    d = _ics_parse_dt(v.strip(), params)
                    cur["exdates"].add(d.date() if isinstance(d, datetime) else d)
            elif name == "SUMMARY":
                cur["summary"] = _ics_text(value)
            elif name == "LOCATION":
                cur["location"] = _ics_text(value)
            elif name == "DESCRIPTION":
                cur["description"] = _ics_text(value)
            elif name == "URL":
                cur["url"] = value.strip()
            elif name == "UID":
                cur["uid"] = value.strip()
        except ValueError:
            continue

    out: list[dict] = []
    for ev in events:
        start = ev.get("start")
        if start is None:
            continue
        duration = None
        if isinstance(start, datetime) and isinstance(ev.get("end"), datetime):
            duration = ev["end"] - start
        rule = ev.get("rrule")
        occurrences = (_expand_rrule(start, rule, ev["exdates"], lo, hi) if rule
                       else [start])
        for occ in occurrences:
            od = occ.date() if isinstance(occ, datetime) else occ
            if not (lo <= od <= hi):
                continue
            end = None
            if isinstance(occ, datetime) and duration is not None:
                end = occ + duration
            elif not rule:
                end = ev.get("end")
            out.append({
                "summary": ev.get("summary"), "start": occ, "end": end,
                "location": ev.get("location"), "description": ev.get("description"),
                "url": ev.get("url"), "uid": ev.get("uid"),
                "recurring": _describe_rrule(rule) if rule else None,
            })
    return out


def _ics_text(v: str) -> str:
    return v.replace("\\n", "\n").replace("\\,", ",").replace("\\;", ";").strip()


def _describe_rrule(rule: str | None) -> str | None:
    if not rule:
        return None
    parts = dict(p.split("=", 1) for p in rule.split(";") if "=" in p)
    freq = parts.get("FREQ", "").capitalize()
    names = {"MO": "Mon", "TU": "Tue", "WE": "Wed", "TH": "Thu", "FR": "Fri",
             "SA": "Sat", "SU": "Sun"}
    byday = ", ".join(names.get(b[-2:], b) for b in parts.get("BYDAY", "").split(",") if b)
    label = {"Daily": "Daily", "Weekly": "Weekly", "Monthly": "Monthly"}.get(freq, freq)
    return f"{label} on {byday}" if byday and freq == "Weekly" else label or None


# ---------------------------------------------------------------- time parsing

_TIME_RE = re.compile(
    r"(?<!\d)(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|am|pm)", re.I)


def parse_time_str(text: str):
    """'7 p.m.' / '7:30pm' -> (hour, minute) 24h, or None."""
    m = _TIME_RE.search(text or "")
    if not m:
        return None
    h = int(m.group(1)) % 12
    if m.group(3).lower().startswith("p"):
        h += 12
    return h, int(m.group(2) or 0)


def local_dt(d: date, hm=None) -> datetime | date:
    """date (+ optional (h, m)) -> aware local datetime, or the date itself."""
    if hm is None:
        return d
    return datetime(d.year, d.month, d.day, hm[0], hm[1], tzinfo=TZ)


def parse_iso(s: str) -> datetime | date:
    """Lenient ISO-8601 -> aware datetime (assumes local if naive) or date."""
    s = s.strip().replace("Z", "+00:00")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return date.fromisoformat(s)
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    return dt.astimezone(TZ)


# ---------------------------------------------------------------- price / free

_FREE_RE = re.compile(r"\bfree\b", re.I)
# "Free with admission" / "free for members" means NOT free to walk in
_FREE_QUALIFIED_RE = re.compile(r"\bfree\s+(with|w/|for\s+member|to\s+member)", re.I)
_PRICE_RE = re.compile(r"\$\s?(\d+(?:\.\d{2})?)")


def parse_price(text: str | None):
    """Price text -> (display, free, min_price). Free only when explicit."""
    if not text:
        return None, None, None
    text = " ".join(text.split())[:80]
    prices = [float(p) for p in _PRICE_RE.findall(text)]
    if _FREE_QUALIFIED_RE.search(text):
        return text, False, (min(prices) if prices else None)
    free = None
    if _FREE_RE.search(text):
        free = True if not prices else None  # "free for members, $10..." -> unknown
    if prices:
        if free is None:
            free = min(prices) == 0
        return text, free, min(prices)
    return text, free, (0.0 if free else None)


# ---------------------------------------------------------------- classification

_CAT_RULES: list[tuple[str, str]] = [
    ("comedy", r"comed|stand[- ]?up|improv|open mic comedy"),
    ("film", r"\bfilm\b|movie|screening|cinema"),
    ("theater", r"theat|\bplay\b|musical\b|ballet|\bdance (?:performance|recital)|opera|drag show"),
    ("games", r"trivia|board game|bingo|pinball|chess|mahjong|poker|game night|puzzle|dungeons|d&d|cribbage"),
    ("words", r"book club|author|poetry|reading|storytell|writers|literary|spelling"),
    ("market", r"farmers'? market|craft fair|makers market|pop[- ]?up market|flea market|artist market|vintage market"),
    ("wellness", r"yoga|meditat|pilates|barre\b|fitness|zumba|tai chi|sound bath|breathwork"),
    ("outdoors", r"\bhike\b|hiking|paddle|kayak|birding|bird walk|nature walk|garden tour|foraging|campfire|stargaz|bike ride|trail"),
    ("sports", r"lake monsters|vermont green|soccer|basketball|hockey|pickleball|climbing|\brace\b|5k|10k|marathon|regatta|skate"),
    ("family", r"\bkids?\b|family|toddler|preschool|children|storytime|story time|playgroup|teen\b|youth"),
    ("learning", r"workshop|class\b|lecture|talk\b|seminar|lesson|how to|intro to|history of|panel"),
    ("food-drink", r"tasting|dinner|brunch|beer|wine|cider|cocktail|food truck|bbq|pizza|potluck|brewery tour|cook"),
    ("art", r"\bart\b|gallery|exhibit|craft|paint|pottery|ceramic|drawing|photograph|fiber|print(?:mak|shop)"),
    ("music", r"live music|concert|\bband\b|\bdj\b|jazz|bluegrass|karaoke|open mic|singer|songwriter|orchestra|choir|vinyl|album"),
    ("community", r"meetup|social|mixer|volunteer|clean[- ]?up|club\b|gathering|network|fundraiser|drive\b|celebration|festival|parade"),
]


def classify(title: str, description: str | None = None,
             venue: str | None = None) -> str:
    hay = " ".join(filter(None, [title, description or "", venue or ""])).lower()
    for cat, pat in _CAT_RULES:
        if re.search(pat, hay):
            return cat
    return "other"


_SOCIAL_RE = re.compile(
    r"meetup|social|mixer|trivia|game night|board game|open mic|karaoke|"
    r"run club|club\b|pickup|pick-up|drop-in|singles|networking|potluck|"
    r"dance (?:party|social)|contra|swing dance|salsa|volunteer|book club|"
    r"stitch|knit|language|conversation", re.I)


def is_social(title: str, description: str | None = None) -> bool:
    """Events where showing up alone is normal."""
    return bool(_SOCIAL_RE.search(f"{title} {description or ''}"))


_OUTDOOR_RE = re.compile(
    r"park\b|waterfront|outdoor|beach|trail|hike|paddle|garden|farm\b|"
    r"lake\b|bike|patio|rooftop|market\b|festival grounds|green\b", re.I)


def guess_indoor_outdoor(title: str, venue: str | None,
                         description: str | None = None) -> str | None:
    """Conservative guess; None when unclear."""
    hay = f"{title} {venue or ''} {description or ''}"
    if _OUTDOOR_RE.search(hay):
        return "outdoor"
    return None


# ---------------------------------------------------------------- venues

_VENUES_CACHE: dict | None = None


def venue_registry() -> dict:
    """venues.json: canonical venue name -> {aliases, address, town, lat, lng,
    indoor_outdoor}. Coordinates come from things.json when names match."""
    global _VENUES_CACHE
    if _VENUES_CACHE is not None:
        return _VENUES_CACHE
    reg = json.loads((EVENTS_DIR / "venues.json").read_text())
    # enrich with coords from the city-guide data when the venue matches
    things_path = REPO_ROOT / "data" / "things.json"
    if things_path.exists():
        try:
            things = json.loads(things_path.read_text())
            by_name = {_norm_venue(t["name"]): t for t in things
                       if isinstance(t, dict) and t.get("coords") and t.get("name")}
            for name, info in reg.items():
                if info.get("lat"):
                    continue
                for candidate in [name] + info.get("aliases", []):
                    t = by_name.get(_norm_venue(candidate))
                    if t:
                        info["lat"], info["lng"] = t["coords"]
                        info.setdefault("address", t.get("address"))
                        break
        except Exception:
            pass
    _VENUES_CACHE = reg
    return reg


def _norm_venue(name: str) -> str:
    s = unicodedata.normalize("NFKD", name.lower())
    s = re.sub(r"\b(the|at|a)\b", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def resolve_venue(venue: str | None, address: str | None = None):
    """Match against the registry -> (canonical_name, info dict) or (venue, {})."""
    if not venue and not address:
        return None, {}
    reg = venue_registry()
    if venue:
        key = _norm_venue(venue)
        for name, info in reg.items():
            if key == _norm_venue(name) or key in [_norm_venue(a) for a in info.get("aliases", [])]:
                return name, info
        for name, info in reg.items():  # substring fallback
            n = _norm_venue(name)
            if n and (n in key or key in n) and min(len(n), len(key)) >= 8:
                return name, info
    if address:
        a = re.sub(r"[^a-z0-9]+", " ", address.lower())
        for name, info in reg.items():
            ia = (info.get("address") or "").split(",")[0]
            stem = re.sub(r"[^a-z0-9]+", " ", ia.lower()).strip()
            # numberless stems like "church st" would swallow every address
            # on that street — only match stems anchored by a street number
            if stem and stem[0].isdigit() and stem in a:
                return name, info
    return venue, {}


def town_from_address(address: str | None) -> str | None:
    if not address:
        return None
    for t in TOWNS:
        if re.search(rf"\b{re.escape(t)}\b", address, re.I):
            return t
    return None


# ---------------------------------------------------------------- make_event

def make_event(*, source: str, title: str, url: str,
               start, end=None,
               venue: str | None = None, address: str | None = None,
               town: str | None = None, price: str | None = None,
               free: bool | None = None, age: str | None = None,
               indoor_outdoor: str | None = None, category: str | None = None,
               description: str | None = None, tags: list | None = None,
               recurring: str | None = None, signals: dict | None = None) -> dict:
    """Normalize one event occurrence. start/end: aware datetime, date, or ISO str."""
    title = " ".join((title or "").split())
    if not title or not url:
        raise ValueError("event needs title and url")
    if isinstance(start, str):
        start = parse_iso(start)
    if isinstance(end, str):
        end = parse_iso(end)
    all_day = not isinstance(start, datetime)
    sdate = start if all_day else start.date()

    canon, vinfo = resolve_venue(venue, address)
    venue = canon or venue
    address = address or vinfo.get("address")
    town = town or vinfo.get("town") or town_from_address(address)
    lat, lng = vinfo.get("lat"), vinfo.get("lng")

    pdisplay, pfree, pmin = parse_price(price)
    if free is None:
        free = pfree
    if description:
        description = " ".join(strip_tags(description).split())
        if len(description) > 300:
            description = description[:297].rsplit(" ", 1)[0] + "…"

    category = category if category in CATEGORIES else classify(title, description, venue)
    if indoor_outdoor is None:
        indoor_outdoor = vinfo.get("indoor_outdoor") or guess_indoor_outdoor(
            title, venue, description)

    tags = list(tags or [])
    if is_social(title, description) and "social" not in tags:
        tags.append("social")

    key = f"{_norm_title(title)}|{sdate.isoformat()}|{_norm_venue(venue or '')}"
    return {
        "id": hashlib.sha1(key.encode()).hexdigest()[:12],
        "title": title,
        "start": start.isoformat(),
        "end": end.isoformat() if end else None,
        "allDay": all_day,
        "date": sdate.isoformat(),
        "venue": venue, "address": address, "town": town,
        "lat": lat, "lng": lng,
        "price": pdisplay, "free": free, "minPrice": pmin,
        "age": age, "indoorOutdoor": indoor_outdoor,
        "category": category, "tags": tags,
        "description": description or None,
        "recurring": recurring,
        "url": url,
        "source": source,
        "signals": signals or {},
    }


_STOP_TITLE = re.compile(
    r"[‘’“”'\"!?.:;,()\[\]&+/-]|\b(the|a|an|with|and|at|of|in|for)\b")


def _norm_title(title: str) -> str:
    s = unicodedata.normalize("NFKD", title.lower())
    s = _STOP_TITLE.sub(" ", s)
    return " ".join(s.split())


def norm_title(title: str) -> str:
    return _norm_title(title)


# ---------------------------------------------------------------- misc

def default_window(days: int = 60):
    today = datetime.now(TZ).date()
    return today, today + timedelta(days=days)


def log(msg: str):
    print(msg, file=sys.stderr, flush=True)
