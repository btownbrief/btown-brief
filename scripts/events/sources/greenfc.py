"""Vermont Green FC — HOME games at Virtue Field (Burlington).

Method: parse the schedule pages vermontgreenfc.com/{year}-schedule-men/ and
{year}-schedule-women/. Each fixture is three consecutive <h5><span> texts:
("Fri. July 17, 7pm", opponent, "Burlington, VT"). Home = location starts
with Burlington and opponent has no leading "@".

The club also publishes a Google-Calendar ICS (linked from /2026-schedule/),
but it is STALE for playoffs — e.g. the women's July 11 National Semifinal
and the men's July 17 home playoff date appear only in the HTML — so the
HTML pages are treated as the source of truth.

Home venue is Virtue Field: the club's own ICS locates every "(H)" fixture
at "Virtue Field, 83 Davis Rd, Burlington", and venues.json knows it.
Season runs roughly May–mid-July (+ playoffs); outside that window zero
events is the correct result. Ticket prices are not on the schedule page ->
price stays None.
"""
from __future__ import annotations

import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common

SOURCE = "greenfc"
LABEL = "Vermont Green FC"

BASE = "https://vermontgreenfc.com"
VENUE = "Virtue Field"

_H5_RE = re.compile(r"<h5[^>]*>\s*<span>(.*?)</span>", re.S)
# "Tues. March 17, 7pm" / "Wed, July 1, 5pm" / "Sat. May 16, 4:30pm"
_DATE_RE = re.compile(
    r"^[A-Za-z]{3,6}[.,]?\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*$",
    re.I)
_MONTHS = {m.lower(): i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"], 1)}
_PLAYOFF_RE = re.compile(r"^PLAYOFFS?\s*(?:\(([^)]+)\))?\s*:?\s*", re.I)


def _rows(page: str):
    """Yield (date_text, opponent_text, location_text) fixture triplets."""
    import html as _h
    spans = [" ".join(_h.unescape(s).split()) for s in _H5_RE.findall(page)]
    i = 0
    while i < len(spans):
        if (_DATE_RE.match(spans[i]) and i + 2 < len(spans)
                and not _DATE_RE.match(spans[i + 1])):
            yield spans[i], spans[i + 1], spans[i + 2]
            i += 3
        else:
            i += 1


def _title(opponent: str, squad: str) -> str:
    note = None
    m = _PLAYOFF_RE.match(opponent)
    if m:
        note = m.group(1) or "Playoffs"
        opponent = opponent[m.end():].strip()
    opponent = re.sub(r"^vs\.?\s+", "", opponent, flags=re.I).strip()
    team = f"Vermont Green FC {squad}"
    if not opponent or opponent.upper() == "TBD":
        title = f"{team} home playoff match (opponent TBD)" if note else \
            f"{team} home match (opponent TBD)"
        return title
    title = f"{team} vs {opponent}"
    if note and note.lower() != "playoffs":
        title += f" ({note})"
    elif note:
        title += " (playoffs)"
    return title


def fetch(window_start: date, window_end: date) -> list[dict]:
    out: list[dict] = []
    year = window_start.year
    pages_ok = 0
    for squad, slug in (("Men", f"{year}-schedule-men"),
                        ("Women", f"{year}-schedule-women")):
        url = f"{BASE}/{slug}/"
        try:
            page = common.fetch(url)
            pages_ok += 1
        except Exception as e:
            common.log(f"greenfc: {url} failed: {e}")
            continue
        for date_text, opponent, location in _rows(page):
            try:
                if not location.lower().startswith("burlington"):
                    continue                      # away fixture
                if opponent.lstrip().startswith("@"):
                    continue                      # defensive: away marker
                m = _DATE_RE.match(date_text)
                month = _MONTHS.get(m.group(1).lower())
                if not month:
                    common.log(f"greenfc: bad month in {date_text!r}")
                    continue
                d = date(year, month, int(m.group(2)))
                if not (window_start <= d <= window_end):
                    continue
                hm = common.parse_time_str(m.group(3))
                out.append(common.make_event(
                    source=SOURCE,
                    title=_title(opponent, squad),
                    url=url,
                    start=common.local_dt(d, hm),
                    venue=VENUE,
                    town="Burlington",
                    category="sports",
                ))
            except Exception as e:
                common.log(f"greenfc: skipped row {date_text!r}: {e}")
    if pages_ok == 0:
        raise RuntimeError("greenfc: both schedule pages failed")
    return out
