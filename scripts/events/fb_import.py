#!/usr/bin/env python3
"""Convert an Easy Scraper Facebook-events export into a pipeline JSONL drop.

Facebook is login-walled, so you export the discover pages yourself (Easy
Scraper, or copy the table into a doc) and this turns that into a clean
`data/events/imports/facebook/<name>.jsonl` that the pipeline imports.

Why convert instead of dropping the raw export? The export uses date text
that is RELATIVE to the moment you scraped ("Tomorrow", "Happening now",
"This Sunday"). If the daily GitHub Action read those later, "Tomorrow" would
mean the wrong day. So we resolve every date to an absolute one HERE, against
the day you scraped (today by default), and write ISO dates the Action reads
deterministically forever.

Input formats (auto-detected):
  * Easy Scraper markdown/TSV: tab-separated columns, order
    url <tab> when <tab> title <tab> location  (a header row + junk rows are
    skipped automatically). This is what the .md export looks like.
  * .csv from Easy Scraper — handled by the importer directly, but running it
    through here still resolves the relative dates; columns detected by header.

Usage:
  python3 scripts/events/fb_import.py ~/Downloads/fb-export.md
  python3 scripts/events/fb_import.py fb-export.md --name 2026-07-10-fb
  python3 scripts/events/fb_import.py fb-export.md --scraped 2026-07-10
  python3 scripts/events/fb_import.py fb-export.md --print   # preview, no write

Then: python3 scripts/events/update.py   (or --only facebook to test)
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common

IMPORT_DIR = common.REPO_ROOT / "data" / "events" / "imports" / "facebook"

_MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
           "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
_WEEKDAYS = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
             "friday": 4, "saturday": 5, "sunday": 6}

_FB_URL_RE = re.compile(r"https?://(?:www\.|m\.|web\.)?facebook\.com/events/(\d+)", re.I)
_MD_ESCAPE_RE = re.compile(r"\\([^A-Za-z0-9])")
_MONTH_DAY_RE = re.compile(
    r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+"
    r"(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?", re.I)


def clean(s: str) -> str:
    return _MD_ESCAPE_RE.sub(r"\1", " ".join(str(s or "").split())).strip()


def clean_url(s: str):
    m = _FB_URL_RE.search(clean(s).replace("\\", ""))
    return f"https://www.facebook.com/events/{m.group(1)}/" if m else None


def _year_closest(month: int, day: int, ref: date):
    """No-year date -> the occurrence closest to the scrape day (handles the
    Dec->Jan rollover, and lets clearly-past rows fall before `ref`)."""
    best = None
    for y in (ref.year - 1, ref.year, ref.year + 1):
        try:
            d = date(y, month, day)
        except ValueError:
            continue
        if best is None or abs((d - ref).days) < abs((best - ref).days):
            best = d
    return best


def resolve_when(text: str, ref: date):
    """FB date text -> (start, end): start is an aware datetime (has a time) or
    a date (all-day); end is a datetime or None. Resolved against `ref` (the
    scrape day). Returns None if no date is found."""
    t = clean(text)
    low = t.lower()
    if not low:
        return None
    if "happening now" in low:
        return ref, None
    # relative day words
    m = re.match(r"(today|tomorrow|tonight)\b(.*)", low)
    if m:
        d = ref + timedelta(days=1 if m.group(1) == "tomorrow" else 0)
        return _attach_time(d, m.group(2))
    # "this / this coming / next <weekday>"
    m = re.match(r"(?:this coming|this|next)\s+(\w+)\b(.*)", low)
    if m and m.group(1) in _WEEKDAYS:
        delta = (_WEEKDAYS[m.group(1)] - ref.weekday()) % 7  # coming weekday (>= today)
        return _attach_time(ref + timedelta(days=delta), m.group(2))
    # "<Weekday>, Jul 16 [- Jul 18] [at 5:30 PM]" or "Jul 16 ..."
    m = _MONTH_DAY_RE.search(t)
    if m:
        month = _MONTHS[m.group(1).lower()[:3]]
        year = int(m.group(3)) if m.group(3) else None
        d = date(year, month, int(m.group(2))) if year else _year_closest(month, int(m.group(2)), ref)
        if d:
            return _attach_time(d, t[m.end():])
    return None


def _attach_time(d: date, rest: str):
    rest = re.split(r"\s*[–—]\s*|\s+-\s+|\s+(?:to|until)\s+", rest, maxsplit=1)
    hm = common.parse_time_str(rest[0]) if rest and rest[0].strip() else None
    if hm is None:
        return d, None
    start = common.local_dt(d, hm)
    end = None
    if len(rest) == 2 and common.parse_time_str(rest[1]):
        end = common.local_dt(d, common.parse_time_str(rest[1]))
        if end <= start:
            end += timedelta(days=1)
    return start, end


def rows_from_file(path: Path):
    """Yield (url, when, title, location) tuples from md/tsv or csv.

    Easy Scraper's export has a fixed column order: url, when, title,
    location. Parse positionally (a header row and junk rows are dropped
    because their first cell isn't an FB event link)."""
    text = path.read_text(encoding="utf-8", errors="replace")
    if path.suffix.lower() == ".csv" and "\t" not in text.split("\n", 1)[0]:
        rows = list(csv.reader(io.StringIO(text)))
    else:  # markdown / TSV
        rows = [ln.split("\t") for ln in text.splitlines() if ln.strip()]
    for cols in rows:
        cols = [c.strip() for c in cols]
        url = clean_url(cols[0]) if cols else None
        if not url:
            continue  # header / junk / non-event row
        when = cols[1] if len(cols) > 1 else None
        title = clean(cols[2]) if len(cols) > 2 else ""
        # anything past the title column is the location (re-join stray tabs)
        loc = clean(" ".join(cols[3:])) if len(cols) > 3 else None
        yield url, when, title, loc or None


def convert(path: Path, ref: date):
    seen, out, skipped = set(), [], 0
    for url, when, title, loc in rows_from_file(path):
        parsed = resolve_when(when, ref) if when else None
        if not title or parsed is None:
            skipped += 1
            continue
        start, end = parsed
        key = _FB_URL_RE.search(url).group(1)
        if key in seen:
            continue
        seen.add(key)
        rec = {"title": title, "url": url,
               "start": start.isoformat() if isinstance(start, datetime) else start.isoformat()}
        if end:
            rec["end"] = end.isoformat()
        if loc:
            rec["location"] = loc
        out.append(rec)
    return out, skipped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="Easy Scraper export (.md/.txt/.tsv/.csv)")
    ap.add_argument("--name", help="output basename (default: fb-<scraped-date>)")
    ap.add_argument("--scraped", help="scrape date YYYY-MM-DD (default: today)")
    ap.add_argument("--print", dest="print_only", action="store_true")
    args = ap.parse_args()

    ref = date.fromisoformat(args.scraped) if args.scraped else datetime.now(common.TZ).date()
    src = Path(args.input).expanduser()
    if not src.exists():
        sys.exit(f"not found: {src}")

    records, skipped = convert(src, ref)
    print(f"parsed {len(records)} events, skipped {skipped} non-event/undated rows "
          f"(scrape day {ref})", file=sys.stderr)
    if args.print_only:
        for r in records:
            print(json.dumps(r, ensure_ascii=False))
        return

    IMPORT_DIR.mkdir(parents=True, exist_ok=True)
    name = (args.name or f"fb-{ref.isoformat()}").removesuffix(".jsonl")
    dest = IMPORT_DIR / f"{name}.jsonl"
    dest.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records))
    print(f"wrote {dest} ({len(records)} events)", file=sys.stderr)


if __name__ == "__main__":
    main()
