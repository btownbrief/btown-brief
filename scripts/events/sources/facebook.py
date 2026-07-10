"""Facebook events — manual drops only (Facebook is login-walled; NO scraping).

Imports files Stephen drops into data/events/imports/facebook/ (see the
README.md there for exact formats and the 7-city FB discover URLs):

  *.csv    Easy Scraper exports of the FB events discover pages. Column
           names vary between scrapes, so columns are detected
           heuristically: title/name, a link containing facebook.com/events,
           FB date text ("Sat, Jul 12 at 7 PM", "Jul 12 at 7 PM – 10 PM",
           "Saturday, July 12, 2026 at 7:00 PM EDT", "Happening now"),
           location, "N interested".

  *.jsonl  One JSON object per line — the shape the newsletter's
           Chrome-agent pass produces. At least {title, url, date|start,
           venue|address|location}; extra fields tolerated (time, end,
           town, price, description, fb_interested -> signals).

Behavior:
  * Rows without a parseable future date are skipped (no year -> next
    occurrence of that month/day).
  * Locations that look like street addresses go to make_event(address=)
    so common.resolve_venue can map them to venue names ("112 Lake St,
    Burlington" -> Foam Brewers); venue-name-looking strings go to venue=.
  * fb_interested counts land in signals={"fb_interested": N} — never in
    the description (golden rule).
  * Deduped within the import by FB event id from the URL.
  * Files persist between runs (update.py's lastSeen keeps entries alive);
    stale files whose events are all past are harmless — past rows are
    skipped here.

Test: python3 scripts/events/update.py --only facebook --window 30 --dry-run --sample 3
"""
from __future__ import annotations

import csv
import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

if __package__ in (None, ""):  # standalone execution
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import common

SOURCE = "facebook"
LABEL = "Facebook (manual drops)"

IMPORT_DIR = common.REPO_ROOT / "data" / "events" / "imports" / "facebook"


# ------------------------------------------------------- FB date-text parsing

_MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
           "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}

_FB_DATE_RE = re.compile(
    r"\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
    r"aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+"
    r"(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b", re.I)

_RANGE_SPLIT_RE = re.compile(r"\s*[–—]\s*|\s+-\s+|\s+(?:to|until)\s+", re.I)


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


def _with_times(d: date, rest: str):
    """Attach start/end times found in text after the date. -> (start, end)."""
    parts = _RANGE_SPLIT_RE.split(rest, maxsplit=1)
    hm = common.parse_time_str(parts[0])
    if hm is None:
        return d, None  # all-day date
    start = common.local_dt(d, hm)
    end = None
    if len(parts) == 2:
        end_hm = common.parse_time_str(parts[1])
        if end_hm:
            end = common.local_dt(d, end_hm)
            if end <= start:  # "9 PM – 1 AM" crosses midnight
                end += timedelta(days=1)
    return start, end


def parse_fb_when(text, today: date):
    """FB date text -> (start, end) where start is an aware datetime or a
    date (all-day) and end is a datetime or None. Unparseable -> None."""
    if not text:
        return None
    t = " ".join(str(text).split())
    low = t.lower()
    if "happening now" in low:
        return today, None  # ongoing today; time unknown -> all-day
    m = re.match(r"(today|tomorrow)\b(.*)", low)
    if m:
        d = today + timedelta(days=1 if m.group(1) == "tomorrow" else 0)
        return _with_times(d, m.group(2))
    m = _FB_DATE_RE.search(t)
    if not m:
        return None
    month = _MONTHS.get(m.group(1)[:3].lower(), 0)
    year = int(m.group(3)) if m.group(3) else None
    d = _resolve_date(month, int(m.group(2)), year, today)
    if d is None:
        return None
    return _with_times(d, t[m.end():])


def _looks_like_when(v: str) -> bool:
    low = v.lower()
    return bool(_FB_DATE_RE.search(v) or "happening now" in low
                or re.match(r"(today|tomorrow)\b", low))


# ------------------------------------------------------------ misc helpers

_STREET_RE = re.compile(
    r"\d+\s+\S+.*\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|way|blvd|"
    r"boulevard|pl|place|ct|court|ter|terrace|pkwy|parkway|hwy|highway|rte|route)\b\.?",
    re.I)


def _split_location(loc):
    """Location string -> (venue, address): street-address-looking strings go
    to address= (common.resolve_venue maps them to venue names)."""
    if not loc:
        return None, None
    loc = " ".join(str(loc).split())
    if not loc:
        return None, None
    if _STREET_RE.search(loc) or re.match(r"^\d", loc):
        return None, loc
    return loc, None


def _venue_from_address(address):
    """Map a bare address to a registry venue name. The registry's address
    matcher effectively needs the trailing ', VT' that FB addresses usually
    omit, so retry with it appended (a lookup hint only — the event keeps
    the address exactly as dropped)."""
    if not address:
        return None
    canon, info = common.resolve_venue(None, address)
    if info:
        return canon
    if not re.search(r"\bvt\.?$", address.strip(), re.I):
        canon, info = common.resolve_venue(None, address + ", VT")
        if info:
            return canon
    return None


def _parse_count(v):
    """'87 interested' / '1.2K' / 345 -> int, else None. Never invents."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).strip().lower().replace(",", "")
    m = re.search(r"(\d+(?:\.\d+)?)\s*k\b", s)
    if m:
        return int(float(m.group(1)) * 1000)
    m = re.search(r"\d+", s)
    return int(m.group(0)) if m else None


_FB_EVENT_ID_RE = re.compile(r"facebook\.com/events/(\d+)", re.I)
_FB_EVENT_URL_RE = re.compile(r"https?://(?:www\.|m\.|web\.)?facebook\.com/events/[^\s\"'<>]+", re.I)


def _dedup_key(url: str) -> str:
    m = _FB_EVENT_ID_RE.search(url)
    return m.group(1) if m else url.rstrip("/")


def _in_window(start, lo: date, hi: date, today: date) -> bool:
    d = start.date() if isinstance(start, datetime) else start
    return d >= today and lo <= d <= hi


# --------------------------------------------------------------- CSV import

_URL_HDR = re.compile(r"url|link|href", re.I)
_DATE_HDR = re.compile(r"date|time|when|start", re.I)
_LOC_HDR = re.compile(r"location|venue|place|address|where", re.I)
_TITLE_HDR = re.compile(r"title|name|event", re.I)
_INT_HDR = re.compile(r"interested", re.I)


def _detect_columns(headers: list[str], rows: list[dict]) -> dict:
    """Heuristic column mapping — Easy Scraper header names vary per scrape."""
    sample = rows[:20]

    def vals(h):
        return [str(r.get(h) or "").strip() for r in sample if str(r.get(h) or "").strip()]

    # url: prefer a column whose VALUES contain FB event links, then header hint
    url_col = next((h for h in headers
                    if any("facebook.com/events" in v for v in vals(h))), None)
    if url_col is None:
        url_col = next((h for h in headers if _URL_HDR.search(h)), None)

    int_col = next((h for h in headers if _INT_HDR.search(h)), None)
    loc_col = next((h for h in headers
                    if h not in (url_col, int_col) and _LOC_HDR.search(h)), None)

    taken = {url_col, int_col, loc_col}
    date_col = next((h for h in headers
                     if h not in taken and _DATE_HDR.search(h)), None)
    if date_col is None:  # value-shape fallback
        for h in headers:
            if h in taken:
                continue
            v = vals(h)
            if v and sum(_looks_like_when(x) for x in v) >= max(1, len(v) // 2):
                date_col = h
                break
    taken.add(date_col)

    title_col = next((h for h in headers
                      if h not in taken and _TITLE_HDR.search(h)
                      and not _LOC_HDR.search(h)), None)
    if title_col is None:  # first remaining texty column
        for h in headers:
            if h in taken:
                continue
            v = vals(h)
            if v and not any("facebook.com" in x for x in v) \
                    and not all(_looks_like_when(x) for x in v):
                title_col = h
                break

    return {"title": title_col, "url": url_col, "when": date_col,
            "loc": loc_col, "interested": int_col}


def _events_from_csv(path: Path, lo: date, hi: date, today: date) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        headers = [h for h in (reader.fieldnames or []) if h]
        rows = [r for r in reader if any((v or "").strip() for v in r.values())]
    if not headers or not rows:
        return []
    cols = _detect_columns(headers, rows)
    if not cols["url"] or not cols["when"] or not cols["title"]:
        common.log(f"facebook: {path.name}: couldn't detect columns "
                   f"(got {cols}) — skipping file")
        return []

    out: list[dict] = []
    for row in rows:
        title = " ".join(str(row.get(cols["title"]) or "").split())
        raw_url = str(row.get(cols["url"]) or "")
        m = _FB_EVENT_URL_RE.search(raw_url)
        url = m.group(0) if m else (raw_url.strip() if raw_url.strip().startswith("http") else None)
        parsed = parse_fb_when(row.get(cols["when"]), today)
        if not title or not url or parsed is None:
            continue
        start, end = parsed
        if not _in_window(start, lo, hi, today):
            continue
        venue, address = _split_location(row.get(cols["loc"]) if cols["loc"] else None)
        if address and not venue:
            venue = _venue_from_address(address)
        signals = {}
        n = _parse_count(row.get(cols["interested"]) if cols["interested"] else None)
        if n is not None:
            signals["fb_interested"] = n
        try:
            out.append(common.make_event(
                source=SOURCE, title=title, url=url, start=start, end=end,
                venue=venue, address=address, signals=signals or None))
        except Exception as e:
            common.log(f"facebook: {path.name}: skipped row {title!r} ({e})")
    return out


# -------------------------------------------------------------- JSONL import

def _events_from_jsonl(path: Path, lo: date, hi: date, today: date) -> list[dict]:
    out: list[dict] = []
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            common.log(f"facebook: {path.name}:{i}: bad JSON — skipped")
            continue
        if not isinstance(obj, dict):
            continue
        title = " ".join(str(obj.get("title") or obj.get("name") or "").split())
        url = obj.get("url") or obj.get("link")
        raw_when = obj.get("start") or obj.get("date") or obj.get("when")

        start = end = None
        if isinstance(raw_when, str) and raw_when.strip():
            try:
                start = common.parse_iso(raw_when)
            except ValueError:
                parsed = parse_fb_when(raw_when, today)
                if parsed:
                    start, end = parsed
        if not title or not url or start is None:
            if title or url:
                common.log(f"facebook: {path.name}:{i}: missing/unparseable "
                           "title/url/date — skipped")
            continue
        # optional separate time field upgrades a bare date
        if not isinstance(start, datetime):
            hm = common.parse_time_str(str(obj.get("time") or ""))
            if hm:
                start = common.local_dt(start, hm)
        if not _in_window(start, lo, hi, today):
            continue
        if end is None and isinstance(obj.get("end"), str):
            try:
                e = common.parse_iso(obj["end"])
                end = e if isinstance(e, datetime) else None
            except ValueError:
                pass

        venue, address = obj.get("venue"), obj.get("address")
        if not venue and not address:
            venue, address = _split_location(obj.get("location"))
        if address and not venue:
            venue = _venue_from_address(address)
        signals = {}
        n = _parse_count(obj.get("fb_interested", obj.get("interested")))
        if n is not None:
            signals["fb_interested"] = n
        try:
            out.append(common.make_event(
                source=SOURCE, title=title, url=str(url),
                start=start, end=end,
                venue=venue, address=address,
                town=obj.get("town"), price=obj.get("price"),
                description=obj.get("description"),
                signals=signals or None))
        except Exception as e:
            common.log(f"facebook: {path.name}:{i}: skipped ({e})")
    return out


# ------------------------------------------------------------------- fetch

def fetch(window_start: date, window_end: date) -> list[dict]:
    if not IMPORT_DIR.exists():
        common.log(f"facebook: {IMPORT_DIR} missing — nothing to import")
        return []
    files = sorted(IMPORT_DIR.glob("*.csv")) + sorted(IMPORT_DIR.glob("*.jsonl"))
    if not files:
        common.log("facebook: no drop files in imports/facebook — skipping")
        return []
    today = datetime.now(common.TZ).date()
    events: list[dict] = []
    seen: set[str] = set()
    for path in files:
        try:
            if path.suffix == ".csv":
                evs = _events_from_csv(path, window_start, window_end, today)
            else:
                evs = _events_from_jsonl(path, window_start, window_end, today)
        except Exception as e:
            common.log(f"facebook: {path.name}: failed to parse ({e}) — skipping file")
            continue
        kept = 0
        for ev in evs:
            key = _dedup_key(ev["url"])
            if key in seen:
                continue
            seen.add(key)
            events.append(ev)
            kept += 1
        common.log(f"facebook: {path.name}: {kept} events "
                   f"({len(evs) - kept} duplicate URLs)")
    return events
