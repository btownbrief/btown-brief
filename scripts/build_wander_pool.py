#!/usr/bin/env python3
"""Build the pool All Day's Wander tab draws from.

Why this exists: Wikipedia's own random endpoint is unusable as a browsing
primitive. Twelve real draws gave NOBLEX E-Optics GmbH, Bray Unknowns F.C.,
Daniel bar Maryam, LU 213 grenade and nine more like them; filtering for "has
a picture and a real intro" rescued 3 of 20, and those three were a butterfly
species and a defunct Alberta electoral district. Nobody spends an afternoon
there.

So Wander never draws from all of Wikipedia. It draws from three pools of
things that are already worth reading:

  unusual  Wikipedia:Unusual articles — a hand-maintained index of ~4,400
           genuinely strange pages, each with a hand-written one-line blurb.
           The blurbs are funnier and more specific than Wikipedia's own short
           descriptions, so we keep them: they become the card copy, and they
           make the browsable list a rabbit hole in its own right.
  popular  The last seven days of most-read articles, minus list pages,
           date pages and namespace junk. This is what makes a draw feel
           current rather than archival.
  vermont  Everything within 12 km of City Hall Park, plus a Vermont search.
           The local hook — no other Wikipedia reader has one.

Only titles and blurbs are stored. The client fetches a live summary at draw
time, which costs 2.4 KB and is always current, so caching descriptions and
thumbnails here would be both larger and staler.

Failure posture: every stage is independently guarded. A stage that fails
leaves the previous run's pool for that key untouched, and the script refuses
to write a payload smaller than MIN_TOTAL so a bad day can never empty the
tab. Exits non-zero only when it wrote nothing and had nothing to keep.

Wikimedia 403s the default Python user-agent, so UA below is mandatory, not
politeness. Run: python3 scripts/build_wander_pool.py [--selftest]
"""

import argparse
import html
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "all-day", "data", "wander-pool.json")

API = "https://en.wikipedia.org/w/api.php"
PAGEVIEWS = "https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access"

# Wikimedia rejects the stock urllib user-agent outright (403). Measured.
UA = "BtownBriefAllDay/1.0 (https://guide.btownbrief.com; stephenvdavis@gmail.com)"

INDEX_PAGE = "Wikipedia:Unusual articles"
BURLINGTON = (44.4759, -73.2121)

UNUSUAL_CAP = 2600      # rotated each night, so the whole index still gets seen
POPULAR_DAYS = 7
POPULAR_CAP = 1200
BLURB_CHARS = 170
MIN_TOTAL = 400         # below this something is wrong; keep the old file

# Namespace junk and page shapes that are never a good place to land.
JUNK_PREFIX = re.compile(
    r"^(Main_Page|Special:|Wikipedia:|Portal:|Category:|File:|Talk:|Help:|Template:|Draft:)")
LISTY = re.compile(r"^(List of|Lists of|Deaths in|Index of|Outline of|Timeline of|\d{4}[ _])")
# Countries and other flag-cell links that decorate the index's table rows.
ROW_RE = re.compile(r"<tr>(.*?)</tr>", re.S)
CELL_RE = re.compile(r"<t([dh])\b[^>]*>(.*?)</t\1>", re.S)
LINK_RE = re.compile(r'<a\s[^>]*href="/wiki/([^"#?]+)"[^>]*>', re.S)
TAG_RE = re.compile(r"<[^>]+>")


def fetch(url, tries=3):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.load(r)
        except Exception as exc:  # noqa: BLE001 — any transport problem is retryable
            if attempt == tries - 1:
                print(f"  ! giving up on {url[:90]}: {exc}", file=sys.stderr)
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


def api(**params):
    params.setdefault("action", "query")
    params.setdefault("format", "json")
    params.setdefault("formatversion", 2)
    return fetch(API + "?" + urllib.parse.urlencode(params))


def strip(fragment):
    return html.unescape(TAG_RE.sub("", fragment)).strip()


def trim(text):
    """Cut a blurb at a word boundary — a description that stops mid-word
    reads like a bug, and these are the card copy."""
    if len(text) <= BLURB_CHARS:
        return text.strip()
    cut = text[:BLURB_CHARS]
    space = cut.rfind(" ")
    if space > BLURB_CHARS * 0.6:
        cut = cut[:space]
    return cut.rstrip(" ,;:–-") + "…"


def is_article(title):
    return bool(title) and not JUNK_PREFIX.match(title.replace(" ", "_")) and not LISTY.match(title)


def build_unusual():
    """Parse the index's tables into (title, blurb) pairs.

    Each row is a flag/marker header cell, a cell holding the article link, and
    a cell holding the hand-written description. Rows vary, so we take the
    first mainspace link that isn't the flag's country and pair it with the
    longest remaining cell of prose.
    """
    doc = api(action="parse", page=INDEX_PAGE, prop="text")
    if not doc or "parse" not in doc:
        return []
    text = doc["parse"]["text"]
    rows = ROW_RE.findall(text)
    print(f"  index: {len(rows)} table rows")

    out, seen = [], set()
    for row in rows:
        cells = CELL_RE.findall(row)
        if len(cells) < 2:
            continue
        flag_links = set()
        title = None
        blurbs = []
        for kind, body in cells:
            links = LINK_RE.findall(body)
            if kind == "h":
                # The header cell carries the country flag; never the subject.
                flag_links.update(urllib.parse.unquote(x).replace("_", " ") for x in links)
                continue
            if title is None:
                for raw in links:
                    cand = urllib.parse.unquote(raw).replace("_", " ")
                    if cand in flag_links or not is_article(cand):
                        continue
                    title = cand
                    break
            blurbs.append(strip(body))
        if not title or title in seen:
            continue
        # The description is the longest cell that isn't just the title again.
        blurb = ""
        for b in sorted(blurbs, key=len, reverse=True):
            if b and b.lower() != title.lower() and len(b) > 12:
                blurb = b
                break
        seen.add(title)
        out.append({"t": title, "d": trim(blurb)})
    return out


def build_popular():
    titles, seen = [], set()
    for back in range(1, POPULAR_DAYS + 1):
        d = datetime.now(timezone.utc) - timedelta(days=back)
        res = fetch(f"{PAGEVIEWS}/{d.year}/{d.month:02d}/{d.day:02d}", tries=2)
        if not res or not res.get("items"):
            continue
        for a in res["items"][0].get("articles", []):
            raw = a.get("article", "")
            if not is_article(raw.replace("_", " ")) or JUNK_PREFIX.match(raw):
                continue
            t = raw.replace("_", " ")
            if t in seen:
                continue
            seen.add(t)
            titles.append(t)
    return titles[:POPULAR_CAP]


def build_vermont():
    titles, seen = [], set()
    lat, lon = BURLINGTON
    for radius in (2000, 10000):
        d = api(list="geosearch", gscoord=f"{lat}|{lon}", gsradius=radius, gslimit=200)
        for hit in ((d or {}).get("query", {}) or {}).get("geosearch", []):
            t = hit.get("title", "")
            if is_article(t) and t not in seen:
                seen.add(t)
                titles.append(t)
    for term in ("Burlington Vermont", "Lake Champlain", "Vermont history"):
        d = api(list="search", srsearch=term, srlimit=60, srnamespace=0)
        for hit in ((d or {}).get("query", {}) or {}).get("search", []):
            t = hit.get("title", "")
            if is_article(t) and t not in seen:
                seen.add(t)
                titles.append(t)
    return titles


def load_previous():
    try:
        with open(OUT, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001 — no previous file is the normal first run
        return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true",
                    help="parse a small sample and check the shape, write nothing")
    args = ap.parse_args()

    previous = load_previous()
    prev_pools = previous.get("pools", {}) if isinstance(previous, dict) else {}

    print("Wander pool")
    print("· unusual")
    unusual = build_unusual()
    print(f"  parsed {len(unusual)} entries, {sum(1 for u in unusual if u['d'])} with a blurb")

    print("· popular")
    popular = build_popular()
    print(f"  {len(popular)} titles over {POPULAR_DAYS} days")

    print("· vermont")
    vermont = build_vermont()
    print(f"  {len(vermont)} titles near Burlington")

    if args.selftest:
        ok = len(unusual) > 1000 and len(popular) > 200 and len(vermont) > 30
        print("\nSELFTEST", "PASS" if ok else "FAIL")
        if unusual:
            print("sample:", json.dumps(random.sample(unusual, min(4, len(unusual))), indent=1)[:700])
        return 0 if ok else 1

    # A stage that failed keeps whatever the last good run had.
    if len(unusual) < 500 and prev_pools.get("unusual"):
        print("  ! unusual came back short — keeping the previous pool")
        unusual = prev_pools["unusual"]
    if len(popular) < 100 and prev_pools.get("popular"):
        print("  ! popular came back short — keeping the previous pool")
        popular = prev_pools["popular"]
    if len(vermont) < 20 and prev_pools.get("vermont"):
        print("  ! vermont came back short — keeping the previous pool")
        vermont = prev_pools["vermont"]

    # Rotate rather than truncate, so the far end of the index still comes up.
    if len(unusual) > UNUSUAL_CAP:
        unusual = random.sample(unusual, UNUSUAL_CAP)
    unusual.sort(key=lambda u: u["t"])

    total = len(unusual) + len(popular) + len(vermont)
    if total < MIN_TOTAL:
        print(f"refusing to write a {total}-entry pool", file=sys.stderr)
        return 1

    payload = {
        "v": 1,
        "built": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "pools": {"unusual": unusual, "popular": popular, "vermont": vermont},
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(OUT)
    print(f"\nwrote {OUT} — {total} entries, {size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
