#!/usr/bin/env python3
"""Build data/eat/openings.json (the Eat app's New tab) and
data/eat/openings-candidates.json (what Stephen still has to confirm).

Three inputs, all read-only here:
  * data/openings.json — the hand-curated Openings & Closings page (88
    entries through Aug 24, 2026). Its entries carry over as-is.
  * data/eat/openings-additions.json — hand-curated, verified entries added
    since, including status updates to old entries ("updates_existing").
    THIS is where a confirmed candidate goes. Nothing reaches the app any
    other way.
  * the Brief's archive editions (../archive/editions or BTB_ARCHIVE_EDITIONS)
    plus a few news RSS feeds — scanned only for candidates.

Statuses are recomputed every run from the dates, so the file stays current
between curation passes: an "open" place whose opening date is within
JUST_OPENED_DAYS reads just_opened; a closing date that has passed flips
closing_soon to closed.

House rule: never announce off a filing alone. A liquor-license application,
permit, zoning or DRB filing is a lead. Candidates that look like filings are
marked kind="lead" and the script never promotes any candidate on its own.

Usage:
    python3 scripts/eat/openings.py                 # build both files
    python3 scripts/eat/openings.py --no-feeds      # skip the RSS feeds (offline)
    python3 scripts/eat/openings.py --since 2026-08-01
"""

import argparse
import datetime
import json
import os
import pathlib
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
# Reuse the radar's tested headline filters rather than a second copy.
from suggest_openings import CLOSING_SIGNAL, MD_LINK, NEWS_DOMAIN, NOISE, SIGNAL  # noqa: E402

LEGACY = ROOT / "data" / "openings.json"
ADDITIONS = ROOT / "data" / "eat" / "openings-additions.json"
RESTAURANTS = ROOT / "data" / "restaurants.json"
OUT = ROOT / "data" / "eat" / "openings.json"
CANDIDATES = ROOT / "data" / "eat" / "openings-candidates.json"

ARCHIVE = pathlib.Path(os.environ.get("BTB_ARCHIVE", ROOT.parent / "archive"))
EDITIONS_DIR = pathlib.Path(os.environ.get("BTB_ARCHIVE_EDITIONS", ARCHIVE / "editions"))
ARCHIVE_SITE = "https://play.btownbrief.com/archive/e/{slug}/"

JUST_OPENED_DAYS = 60
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")

FEEDS = [
    ("Seven Days", "https://www.sevendaysvt.com/feed/"),
    ("VTDigger", "https://vtdigger.org/feed/"),
    ("WCAX", "https://www.wcax.com/arc/outboundfeeds/rss/?outputType=xml"),
    ("NBC5", "https://www.mynbc5.com/local-news-rss"),
    ("Vermont Business Magazine", "https://vermontbiz.com/rss.xml"),
    ("City of Burlington", "https://www.burlingtonvt.gov/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml"),
]

# Headlines that describe paperwork, not a business with its doors open.
FILING = re.compile(
    r"\b(liquor licen[cs]e|licen[cs]e application|permits?|zoning|DRB|"
    r"development review|site plan|filed|filing|"
    r"plans? to (open|close|bring)|proposed (restaurant|bar|caf[eé]|shop|store|brewery))\b",
    re.IGNORECASE,
)
# Extra noise the shared radar filter lets through (launches and openings
# that are not storefronts).
EXTRA_NOISE = re.compile(
    r"\b(trial|arguments|flight|PAC|ad blitz|observatory|series|program|traffic|"
    r"diverging|campaign|lawsuit|apartments?|housing|shelter|hearing|exemption|"
    r"show|season|exhibit)\b",
    re.IGNORECASE,
)
AREA = re.compile(
    r"\b(burlington|btv|winooski|south burlington|so\. burlington|essex|williston|"
    r"shelburne|colchester|old north end|church street|pine street|south end|"
    r"north avenue|university mall)\b",
    re.IGNORECASE,
)

STATUS_FROM_LEGACY = {"opening-soon": "coming_soon", "open": "open", "closed": "closed"}


def slug(s):
    s = s.lower().replace("&", " and ").replace("’", "").replace("'", "")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def as_date(s):
    """'2026-09-12' -> that day; '2026-09' -> the 15th (middle of the month)."""
    if not s:
        return None
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
            return datetime.date.fromisoformat(s)
        if re.fullmatch(r"\d{4}-\d{2}", s):
            return datetime.date.fromisoformat(s + "-15")
    except ValueError:
        return None
    return None


def norm(s):
    s = re.sub(r"\s*\(.*?\)", "", s or "").lower().replace("’", "'")
    return " ".join(re.findall(r"[a-z0-9']+", s))


# ---------- archive: which edition covered a story ----------

def load_editions():
    """URL -> earliest edition that linked it."""
    index = {}
    if not EDITIONS_DIR.is_dir():
        return index, []
    stories = []
    for path in sorted(EDITIONS_DIR.glob("*.md")):
        body = path.read_text(errors="replace")
        m = re.search(r"^date:\s*(\S+)", body, re.M)
        date = m.group(1) if m else path.name[:10]
        u = re.search(r"^url:\s*(\S+)", body, re.M)
        title = re.search(r'^title:\s*"?(.*?)"?\s*$', body, re.M)
        ed = {
            "slug": path.stem.split("--", 1)[-1],
            "date": date,
            "title": title.group(1) if title else path.stem,
            "archive_url": ARCHIVE_SITE.format(slug=path.stem.split("--", 1)[-1]),
            "url": u.group(1) if u else None,
        }
        for text, url in MD_LINK.findall(body):
            key = url.split("?")[0].rstrip("/")
            index.setdefault(key, ed)
            if NEWS_DOMAIN.search(url):
                stories.append((text.strip(), url, ed))
    return index, stories


def edition_for(url, index):
    return index.get((url or "").split("?")[0].rstrip("/")) if url else None


# ---------- records ----------

def legacy_record(e, verified):
    status = STATUS_FROM_LEGACY.get(e.get("status"), e.get("status"))
    rec = {"announced": None, "opened": None, "expected_open": None, "closing": None, "closed": None}
    if status == "open":
        rec["opened"] = e.get("date")
    elif status == "coming_soon":
        rec["expected_open"] = e.get("date")
    elif status == "closed":
        # The old page filed "closing on X" under closed; keep the date as the
        # last day and let the status logic decide closing_soon vs closed.
        rec["closing" if "closing" in (e.get("dateLabel") or "") else "closed"] = e.get("date")
    return {
        "id": slug(e["name"]),
        "name": e["name"],
        "category": "food" if e.get("food") else "non-food",
        "status": status,
        **rec,
        "date_label": e.get("dateLabel"),
        "neighborhood": e.get("area"),
        "address": None,
        "source": e.get("source"),
        "source_name": e.get("sourceName"),
        "note": e.get("story"),
        "verified": verified,
        "origin": "data/openings.json",
    }


def addition_record(e):
    keep = ("name", "category", "status", "announced", "opened", "closing", "closed",
            "neighborhood", "address", "source", "source_name", "note", "verified")
    rec = {k: e.get(k) for k in keep}
    rec["id"] = slug(e["name"])
    rec["expected_open"] = e.get("expected_open")
    rec["origin"] = "data/eat/openings-additions.json"
    return rec


def settle_status(rec, today):
    """Recompute the status from the dates so the file never goes stale."""
    closing, closed, opened = as_date(rec.get("closing")), as_date(rec.get("closed")), as_date(rec.get("opened"))
    s = rec["status"]
    if s in ("closing_soon", "closed") and closing and not closed:
        s = "closing_soon" if closing >= today else "closed"
        if s == "closed":
            rec["closed"] = rec["closing"]
    if s == "open" and opened and (today - opened).days <= JUST_OPENED_DAYS:
        s = "just_opened"
    rec["status"] = s
    return rec


def restaurant_index():
    data = json.loads(RESTAURANTS.read_text())["restaurants"]
    return {norm(r["name"]): r for r in data}


def build(today):
    legacy = json.loads(LEGACY.read_text())
    adds = json.loads(ADDITIONS.read_text()) if ADDITIONS.exists() else {"entries": []}
    records = {}
    for e in legacy.get("entries", []):
        r = legacy_record(e, legacy.get("updated"))
        records[r["id"]] = r
    by_name = {norm(r["name"]): rid for rid, r in records.items()}
    for e in adds.get("entries", []):
        new = addition_record(e)
        target = by_name.get(norm(e.get("updates_existing") or "")) if e.get("updates_existing") else None
        if target:
            old = records.pop(target)
            new["earlier"] = {k: old.get(k) for k in ("status", "date_label", "source", "verified")}
            new["note"] = new["note"] or old.get("note")
            new["neighborhood"] = new["neighborhood"] or old.get("neighborhood")
        records[new["id"]] = new

    index, _ = load_editions()
    rest = restaurant_index()
    out = []
    for r in records.values():
        settle_status(r, today)
        ed = edition_for(r.get("source"), index) or edition_for((r.get("earlier") or {}).get("source"), index)
        r["edition"] = {"date": ed["date"], "title": ed["title"], "archive_url": ed["archive_url"],
                        "newsletter_url": ed["url"]} if ed else None
        match = rest.get(norm(r["name"]))
        r["restaurant_id"] = match["id"] if match else None
        if match and not r.get("address"):
            r["address"] = match.get("address")
        out.append(r)

    def sort_key(r):
        d = max((as_date(r.get(k)) or datetime.date.min) for k in
                ("announced", "opened", "expected_open", "closing", "closed"))
        return d
    out.sort(key=sort_key, reverse=True)
    return out, adds


# ---------- candidates ----------

def classify(title):
    if EXTRA_NOISE.search(title):
        return None
    if FILING.search(title):
        return "lead"
    if NOISE.search(title) or not SIGNAL.search(title):
        return None
    return "closing" if CLOSING_SIGNAL.search(title) else "opening"


def feed_items(name, url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as resp:
            root = ET.fromstring(resp.read())
    except Exception as e:  # a dead feed should not stop the run
        print(f"feed {name} skipped: {e}", file=sys.stderr)
        return []
    items = []
    for it in root.iter():
        if it.tag.split("}")[-1] not in ("item", "entry"):
            continue
        get = {c.tag.split("}")[-1]: (c.text or c.get("href") or "").strip() for c in it}
        items.append((get.get("title", ""), get.get("link", ""), get.get("pubDate") or get.get("updated") or "",
                      get.get("description", "")))
    return items


def candidates(records, since, use_feeds):
    known_urls = {(r.get("source") or "").split("?")[0].rstrip("/") for r in records}
    known_urls |= {((r.get("earlier") or {}).get("source") or "").split("?")[0].rstrip("/") for r in records}
    # name -> which way the tracked story already points
    known_names = {norm(r["name"]): ("closing" if r["status"] in ("closing_soon", "closed") else "opening")
                   for r in records}
    seen, out = set(), []

    def add(title, url, found_in, date, edition=None):
        key = url.split("?")[0].rstrip("/")
        if key in known_urls or key in seen:
            return
        kind = classify(title)
        if not kind:
            return
        seen.add(key)
        named = next((n for n in known_names if n and len(n) > 4 and n in norm(title)), None)
        if named and known_names[named] == kind:
            return  # same story we already track, from another outlet
        out.append({
            "headline": title,
            "url": url,
            "kind": kind,
            "found_in": found_in,
            "date": date,
            "edition": edition,
            "mentions_tracked": named,
            "action": ("Lead only: confirm the business is actually open or closing before adding."
                       if kind == "lead" else
                       "Read the story; if it checks out add it to data/eat/openings-additions.json."),
        })

    _, stories = load_editions()
    for title, url, ed in stories:
        if ed["date"] >= since.isoformat():
            add(title, url, "archive edition", ed["date"], ed["archive_url"])
    if use_feeds:
        for name, url in FEEDS:
            for title, link, date, desc in feed_items(name, url):
                if link and (name in ("Seven Days", "City of Burlington") or AREA.search(title + " " + desc)):
                    add(title, link, name + " feed", date[:16] or None)
    out.sort(key=lambda c: (c["kind"] == "lead", str(c["date"] or "")), reverse=False)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--no-feeds", action="store_true", help="skip the RSS feeds")
    ap.add_argument("--since", help="oldest edition date to scan for candidates (default: 45 days ago)")
    args = ap.parse_args()
    today = datetime.date.today()
    since = datetime.date.fromisoformat(args.since) if args.since else today - datetime.timedelta(days=45)

    records, adds = build(today)
    counts = {}
    for r in records:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    OUT.write_text(json.dumps({
        "updated": today.isoformat(),
        "note": ("Openings and closings for the Eat app's New tab. Built by scripts/eat/openings.py from "
                 "data/openings.json (curated through 2026-08-24) plus data/eat/openings-additions.json. "
                 "Every entry is a verified news story; filings and rumors are never here. Statuses are "
                 f"recomputed from dates each run: just_opened means opened within {JUST_OPENED_DAYS} days. "
                 "Month-only dates (YYYY-MM) are treated as mid-month."),
        "counts": counts,
        "entries": records,
        "leads": adds.get("leads", []),
    }, indent=1, ensure_ascii=False) + "\n")

    cands = candidates(records, since, not args.no_feeds)
    CANDIDATES.write_text(json.dumps({
        "updated": today.isoformat(),
        "since": since.isoformat(),
        "note": ("UNCONFIRMED. Headlines that might be an opening or closing, for Stephen to check. "
                 "Nothing here is shown in the app. 'lead' means a filing, permit or plan: never "
                 "announce off one of those alone."),
        "candidates": cands,
    }, indent=1, ensure_ascii=False) + "\n")
    print(f"openings: {len(records)} entries {counts}; candidates: {len(cands)}", file=sys.stderr)


if __name__ == "__main__":
    main()
