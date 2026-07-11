"""Burlington Farmers Market — burlingtonfarmersmarket.org.

Method: parse the schedule banner the site itself publishes on its
homepage (Squarespace; no calendar feed). As of July 2026 it reads:

    "Summer 2026  9:00 am - 2:00pm | 345 Pine St | Burlington, Vermont
     Every Saturday May 9 - October 31, 2026  Rain or shine."

We verify day/hours/location/season FROM that banner on every run and
emit one occurrence per market day inside both the window and the stated
season. free=True (attending the market is free) is set only when the
banner parse succeeds. If the banner cannot be parsed the module raises
so update.py keeps last-good data instead of silently losing the market.

Gaps: the site currently publishes no Winter Market schedule (checked
July 2026 — nav has only summer pages; if "winter market" text appears
later we log it so a human can extend this fetcher). No one-off special
events (e.g. Art Hop) are listed on the site either.
"""
from __future__ import annotations

import re
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common

SOURCE = "farmersmarket"
LABEL = "Burlington Farmers Market"
BASE = "https://burlingtonfarmersmarket.org/"

_WEEKDAYS = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
             "friday": 4, "saturday": 5, "sunday": 6}
_MONTHS = {m.lower(): i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"], 1)}

_BANNER_RE = re.compile(
    r"(\d{1,2}:\d{2}\s*[ap]\.?m\.?)\s*[-–—]\s*(\d{1,2}:\d{2}\s*[ap]\.?m\.?)"
    r"\s*\|\s*([^|]{3,60}?)\s*\|\s*Burlington,?\s*(?:Vermont|VT)"
    r".{0,40}?Every\s+([A-Z][a-z]+day)s?\s+"
    r"([A-Z][a-z]+)\s+(\d{1,2})\s*[-–—]\s*([A-Z][a-z]+)\s+(\d{1,2}),?\s*(\d{4})",
    re.I)


def fetch(window_start: date, window_end: date) -> list[dict]:
    text = " ".join(common.strip_tags(common.fetch(BASE)).split())

    m = _BANNER_RE.search(text)
    if not m:
        raise RuntimeError("farmersmarket: schedule banner not found on "
                           "homepage — refusing to emit unverified dates")
    t1_raw, t2_raw, addr, dayname, m1, d1, m2, d2, year = m.groups()
    weekday = _WEEKDAYS[dayname.lower()]
    season_start = date(int(year), _MONTHS[m1.lower()], int(d1))
    season_end = date(int(year), _MONTHS[m2.lower()], int(d2))
    hm1 = common.parse_time_str(t1_raw)
    hm2 = common.parse_time_str(t2_raw)
    if hm1 is None:
        raise RuntimeError(f"farmersmarket: could not parse time {t1_raw!r}")

    if "winter market" in text.lower():
        common.log("farmersmarket: NOTE — homepage now mentions a winter "
                   "market; extend this fetcher to cover it")

    rain = "rain or shine" in text.lower()
    recurring = (f"{dayname.capitalize()}s {t1_raw}–{t2_raw}, "
                 f"{m1} {d1} – {m2} {d2}, {year}"
                 + (" (rain or shine)" if rain else ""))

    lo = max(window_start, season_start)
    hi = min(window_end, season_end)
    out: list[dict] = []
    d = lo + timedelta(days=(weekday - lo.weekday()) % 7)
    while d <= hi:
        out.append(common.make_event(
            source=SOURCE,
            title="Burlington Farmers Market",
            url=BASE,
            start=common.local_dt(d, hm1),
            end=common.local_dt(d, hm2) if hm2 else None,
            venue="Burlington Farmers Market",
            address=f"{addr.strip()}, Burlington, VT",
            town="Burlington",
            free=True,                    # attending the market is free
            category="market",
            indoor_outdoor="outdoor",
            description=("Bringing the best of Vermont to the Queen City "
                         "since 1980." + (" Rain or shine." if rain else "")),
            recurring=recurring,
        ))
        d += timedelta(days=7)

    if not out:
        common.log(f"farmersmarket: no market days in window "
                   f"(season {season_start} – {season_end}); no winter "
                   f"schedule is published on the site")
    return out
