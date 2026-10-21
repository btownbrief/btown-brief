#!/usr/bin/env python3
"""Generator Makerspace (40 Sears Ln) — classes, tool trainings, talks.

Generator publishes its calendar on GlueUp. The org listing page sits behind a
Cloudflare challenge (403 from curl and from the GitHub runner), but each
event's own page is served plainly. So:

  1. The listing is fetched with `fallback=True` (one Firecrawl credit when the
     direct request is blocked) only when the cached slug list is older than
     LISTING_MAX_AGE_DAYS — about two credits a week, not three a day.
  2. Every event page is fetched directly, every run, for free. Its Google
     Calendar "add" link carries the exact title, start/end and timezone; the
     ticket block carries the public price.

An event page that 404s was taken down, so it is skipped. A listing that fails
falls back to the cached slugs while they are under LISTING_STALE_DAYS old,
then the source fails loudly.
"""
from __future__ import annotations

import html
import json
import re
import sys
import urllib.parse
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import common
from common import TZ, log

SOURCE = "generator"
LABEL = "Generator Makerspace"

ORG_LISTING = "https://app.glueup.com/org/generatormakerspace/events/timeframe/upcoming/"
EVENT_URL = "https://app.glueup.com/event/{slug}/"
VENUE = "Generator Makerspace"

CACHE_PATH = common.DATA_DIR / "cache" / "generator-listing.json"
LISTING_MAX_AGE_DAYS = 3   # refetch the listing (maybe 1 credit) after this
LISTING_STALE_DAYS = 14    # past this a cached list is not trusted at all

# Staff-only admin sessions, not things a reader can go to.
SKIP_TITLE = re.compile(r"\bnew member enrollment\b", re.I)


def _load_cache() -> tuple[list[str], timedelta] | None:
    try:
        cache = json.loads(CACHE_PATH.read_text())
        age = datetime.now(TZ) - datetime.fromisoformat(cache["fetched"])
        return list(cache["slugs"]), age
    except FileNotFoundError:
        return None
    except Exception as e:
        log(f"  [generator] listing cache unreadable ({e}) — ignoring it")
        return None


def _save_cache(slugs: list[str]) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps({
        "fetched": datetime.now(TZ).isoformat(timespec="seconds"),
        "slugs": slugs,
    }, indent=0) + "\n")


def _listing_slugs() -> list[str]:
    cached = _load_cache()
    if cached and cached[1] < timedelta(days=LISTING_MAX_AGE_DAYS):
        log(f"  [generator] {len(cached[0])} slugs from cache "
            f"({cached[1].days}d old)")
        return cached[0]
    try:
        page = common.fetch(ORG_LISTING, fallback=True)
        if "just a moment" in page.lower():
            raise RuntimeError("Cloudflare challenge page")
        slugs = sorted(set(re.findall(r"/event/([a-z0-9-]+-\d+)/", page)))
        if not slugs:
            raise RuntimeError("listing had no event links")
        _save_cache(slugs)
        return slugs
    except Exception as e:
        if cached and cached[1] < timedelta(days=LISTING_STALE_DAYS):
            log(f"  [generator] listing failed ({e}); using "
                f"{cached[1].days}d-old cache")
            return cached[0]
        raise


def _gcal_fields(page: str) -> dict[str, str]:
    m = re.search(r"calendar\.google\.com/calendar/render\?([^\"']+)", page)
    if not m:
        return {}
    q = urllib.parse.parse_qs(html.unescape(m.group(1)))
    return {k: v[0] for k, v in q.items()}


def _gcal_dt(stamp: str) -> datetime:
    # Floating local time, e.g. 20261021T173000, paired with ctz.
    return datetime.strptime(stamp, "%Y%m%dT%H%M%S").replace(tzinfo=TZ)


def _page_text(page: str) -> str:
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", page, flags=re.S)
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", t)).split())


def _public_price(text: str) -> tuple[str | None, bool | None]:
    """(price, free) from the ticket block's Standard Price entries only.

    Member prices are ignored: they are not what a reader would pay.
    """
    i = text.find(" Tickets ")
    j = text.find(" Venue ", i)
    if i < 0 or j < 0:
        return None, None
    block = text[i:j]
    std = re.findall(r"Standard Price (\$[\d,]+(?:\.\d\d)?|Complimentary)", block)
    if not std:
        return None, None
    paid = [p for p in std if p.startswith("$")]
    if not paid:
        return "Free", True
    return " / ".join(dict.fromkeys(paid)), False


def _event(slug: str, lo: date, hi: date) -> dict | None:
    url = EVENT_URL.format(slug=slug)
    page = common.fetch(url)
    g = _gcal_fields(page)
    title = g.get("text")
    dates = g.get("dates", "")
    if not title or "/" not in dates:
        log(f"  [generator] no calendar data on {slug}; skipping")
        return None
    if SKIP_TITLE.search(title):
        return None
    if g.get("ctz") and g["ctz"] != "America/New_York":
        log(f"  [generator] unexpected timezone {g['ctz']} on {slug}; skipping")
        return None
    s_raw, e_raw = dates.split("/", 1)
    start, end = _gcal_dt(s_raw), _gcal_dt(e_raw)
    if not (lo <= start.date() <= hi):
        return None

    recurring = None
    if end.date() != start.date():
        # A multi-week series (e.g. 5 Thursdays). Only the first session is
        # verifiable from the calendar link, so emit that one and say so.
        recurring = f"Series runs through {end.strftime('%b')} {end.day}"
        end = datetime.combine(start.date(), end.time(), tzinfo=TZ)

    text = _page_text(page)
    price, free = _public_price(text)
    desc = re.search(r'og:description" content="([^"]*)"', page)
    tags = ["sold-out"] if "this event is now sold out" in text.lower() else []
    return common.make_event(
        source=SOURCE, title=html.unescape(title), url=url,
        start=start, end=end, venue=VENUE,
        price=price, free=free, recurring=recurring, tags=tags,
        description=html.unescape(html.unescape(desc.group(1))) if desc else None,
    )


def fetch(window_start: date, window_end: date) -> list[dict]:
    events, failed = [], 0
    slugs = _listing_slugs()
    for slug in slugs:
        try:
            ev = _event(slug, window_start, window_end)
        except Exception as e:
            if getattr(e, "code", None) == 404:
                continue  # taken down since the listing was cached
            log(f"  [generator] {slug}: {e}")
            failed += 1
            continue
        if ev:
            events.append(ev)
    # Event pages are fetched direct (no Firecrawl). If GlueUp starts blocking
    # them too, say so rather than reporting a quiet, empty success.
    if slugs and failed == len(slugs):
        raise RuntimeError(f"all {failed} event pages failed to fetch")
    return events


if __name__ == "__main__":
    lo, hi = common.default_window()
    for ev in fetch(lo, hi):
        print(ev["date"], ev["start"][11:16], ev["price"], "|", ev["title"],
              "|", ev["recurring"] or "", "|", ",".join(ev["tags"]))
