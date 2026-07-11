"""Seven Days (community.sevendaysvt.com) — Burlington-area event listings.

Vermont's alt-weekly events calendar, scoped to the Burlington /
Chittenden County "neighborhoods". The search listing carries everything
we need (title, venue, address, date string, price, category, blurb), so
we parse listings directly and never fetch detail pages.

Date strings come in several shapes, all expanded to one event per
occurrence date inside the window:
  * "Fri., July 10, 7:30 p.m., Sat., July 11, 2 & 7:30 p.m. and ..."
  * "Tuesdays, 5-7 p.m. Continues through Nov. 3"
  * "Second and Fourth Tuesday of every month, 1-4 p.m."
  * "Through Sept. 7, 10 a.m.-5 p.m." / "Ongoing"   (exhibits: Seven Days
    lists these on every single day, verified via single-day searches)
  * "Reception: Friday, July 10, 5-8 p.m. July 10-Aug. 31"
Un-parseable recurrence text (e.g. "Every other Thursday") is skipped and
logged — never guessed.
"""
from __future__ import annotations

import re
import sys
import urllib.parse
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common
from common import local_dt, log, make_event, strip_tags

SOURCE = "sevendays"
LABEL = "Seven Days"

BASE = "https://community.sevendaysvt.com/vermont/EventSearch"
# 2124358 = Burlington, 2124360 = Chittenden County
NEIGHBORHOOD = "2124358,2124360"
MAX_PAGES = 30

# Seven Days category tag -> our category (unmapped tags fall back to
# common.classify() via category=None).
_CAT_MAP = {
    "music": "music", "live music": "music", "djs": "music",
    "open mics & jams": "music",
    "visual art shows": "art", "visual art events": "art", "crafts": "art",
    "call to artists": "art",
    "theater": "theater", "dance": "theater",
    "film": "film",
    "comedy": "comedy",
    "sports": "sports",
    "food & drink": "food-drink",
    "family fun": "family",
    "health & fitness": "wellness",
    "games": "games",
    "education": "learning", "seminars": "learning", "talks": "learning",
    "tech": "learning", "business": "learning", "conferences": "learning",
    "outdoors": "outdoors", "environment": "outdoors",
    "words": "words",
    "community": "community", "activism": "community", "politics": "community",
    "lgbtq": "community", "fairs & festivals": "community",
    "language": "community",
}

# ------------------------------------------------------------- date grammar

_MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}
_MONTH_RE = (r"Jan(?:\.|uary)?|Feb(?:\.|ruary)?|Mar(?:\.|ch)|Apr(?:\.|il)|May"
             r"|June?\.?|July?\.?|Aug(?:\.|ust)?|Sept?(?:\.|ember)?"
             r"|Oct(?:\.|ober)?|Nov(?:\.|ember)?|Dec(?:\.|ember)?")
_WD_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
            "Saturday", "Sunday"]
_WD_FULL_RE = "|".join(_WD_FULL)
_WD_PLURAL_RE = "|".join(w + "s" for w in _WD_FULL)
_ORDINALS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5,
             "last": -1}

_ANCHOR = re.compile(
    r"(?P<monthly>(?:First|Second|Third|Fourth|Fifth|Last)"
    rf"(?:,? and (?:First|Second|Third|Fourth|Fifth|Last))*\s+"
    rf"(?:{_WD_FULL_RE}) of every month)"
    rf"|(?P<everyother>Every other (?:{_WD_FULL_RE}))"
    r"|(?P<daily>\bDaily\b)"
    rf"|(?P<explicit>(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\.,?\s+(?:{_MONTH_RE})\s+\d{{1,2}})"
    rf"|(?P<weekly>(?:{_WD_PLURAL_RE})(?:\s*-\s*(?:{_WD_PLURAL_RE}))?"
    rf"(?:,\s*(?:{_WD_PLURAL_RE})(?:\s*-\s*(?:{_WD_PLURAL_RE}))?)*)")

_CONTINUES_RE = re.compile(
    rf"[,.]?\s*Continues through\s+({_MONTH_RE})\s+(\d{{1,2}})\.?\s*$")
_THROUGH_RE = re.compile(
    rf"^Through\s+({_MONTH_RE})\s+(\d{{1,2}})(?:,\s*(.+))?$")
_LABEL_RE = re.compile(
    rf"^([A-Z][^:]{{0,60}}?):\s*(?:{_WD_FULL_RE}),\s+({_MONTH_RE})\s+(\d{{1,2}})"
    r"((?:,\s*[^A-Z]*?[ap]\.?m\.?)?)\s*")
_RUN_RE = re.compile(
    rf"^({_MONTH_RE})\s+(\d{{1,2}})\s*[-–]\s*({_MONTH_RE})\s+(\d{{1,2}})\.?$")

_TIME_TOK = re.compile(r"(\d{1,2})(?::(\d{2}))?(?:\s*([ap])\.?m\.?)?", re.I)


def _month_num(tok: str) -> int | None:
    return _MONTHS.get(tok.rstrip(".").lower())


def _near_date(mon: int, day: int, lo: date) -> date | None:
    """Resolve a year-less 'July 10' to a real date near the window."""
    for year in (lo.year, lo.year + 1):
        try:
            d = date(year, mon, day)
        except ValueError:
            continue
        if d >= lo - timedelta(days=120):
            return d
    return None


def _parse_times(chunk: str) -> list[tuple[tuple[int, int], tuple[int, int] | None]]:
    """'7 & 9 p.m.' / '10 a.m.-2:30 p.m.' / '12, 2 & 4 p.m.'
    -> [((h, m), end_(h, m) or None), ...]; [] when no valid time found.
    Numbers without a meridiem inherit it from the next number that has one."""
    toks = []
    for m in _TIME_TOK.finditer(chunk):
        h, mm = int(m.group(1)), int(m.group(2) or 0)
        if not (1 <= h <= 12) or mm >= 60:
            return []
        toks.append({"h": h, "m": mm, "mer": (m.group(3) or "").lower() or None,
                     "s": m.start(), "e": m.end()})
    if not toks:
        return []
    mer = None
    for t in reversed(toks):
        if t["mer"]:
            mer = t["mer"]
        else:
            t["mer"] = mer
    if any(t["mer"] is None for t in toks):
        return []

    def hm(t):
        h = t["h"] % 12
        if t["mer"] == "p":
            h += 12
        return (h, t["m"])

    out, i = [], 0
    while i < len(toks):
        start, end = hm(toks[i]), None
        if i + 1 < len(toks):
            sep = chunk[toks[i]["e"]:toks[i + 1]["s"]]
            if "-" in sep or "–" in sep:
                end = hm(toks[i + 1])
                i += 1
        out.append((start, end))
        i += 1
    return out


def _weekday_set(text: str) -> set[int]:
    """'Mondays, Tuesdays, Thursdays-Sundays' -> {0, 1, 3, 4, 5, 6}"""
    idx = {w.lower() + "s": i for i, w in enumerate(_WD_FULL)}
    days: set[int] = set()
    for part in re.split(r",\s*", text):
        part = part.strip()
        if "-" in part:
            a, b = [idx.get(p.strip().lower()) for p in part.split("-", 1)]
            if a is None or b is None:
                continue
            d = a
            while True:
                days.add(d)
                if d == b:
                    break
                d = (d + 1) % 7
        elif part.lower() in idx:
            days.add(idx[part.lower()])
    return days


def _nth_weekdays(nths: list[int], wd: int, lo: date, hi: date) -> list[date]:
    out = []
    y, m = lo.year, lo.month
    while date(y, m, 1) <= hi:
        first = date(y, m, 1)
        nxt = date(y + (m == 12), m % 12 + 1, 1)
        for nth in nths:
            if nth > 0:
                d = first + timedelta(days=(wd - first.weekday()) % 7
                                      + 7 * (nth - 1))
                if d.month != m:
                    continue
            else:  # last
                last = nxt - timedelta(days=1)
                d = last - timedelta(days=(last.weekday() - wd) % 7)
            if lo <= d <= hi:
                out.append(d)
        y, m = nxt.year, nxt.month
    return out


def _daily_run(start: date, end: date,
               times: list) -> list[tuple[date, tuple | None, tuple | None]]:
    hm, ehm = (times[0][0], times[0][1]) if times else (None, None)
    out = []
    d = start
    while d <= end:
        out.append((d, hm, ehm))
        d += timedelta(days=1)
    return out


def expand_when(text: str, lo: date, hi: date):
    """Seven Days date string -> (occurrences, is_recurring).
    occurrences: [(date, (h, m) | None, end_(h, m) | None), ...] within
    [lo, hi]. Returns None when the format is unrecognized (caller logs)."""
    s = " ".join((text or "").split())
    if not s:
        return None
    occs: list[tuple[date, tuple | None, tuple | None]] = []
    recurring = False

    m = _CONTINUES_RE.search(s)
    through: date | None = None
    if m:
        mon = _month_num(m.group(1))
        through = _near_date(mon, int(m.group(2)), lo) if mon else None
        s = s[:m.start()].strip()
        recurring = True

    m = re.match(r"^Ongoing(?:,\s*(.+))?$", s, re.I)
    if m:
        return _daily_run(lo, hi, _parse_times(m.group(1) or "")), True

    m = _LABEL_RE.match(s)  # "Reception: Friday, July 10, 5-8 p.m. ..."
    if m:
        mon = _month_num(m.group(2))
        d = _near_date(mon, int(m.group(3)), lo) if mon else None
        if d:
            times = _parse_times(m.group(4) or "")
            if lo <= d <= hi:
                occs.append((d, times[0][0] if times else None,
                             times[0][1] if times else None))
        s = s[m.end():].strip()
        recurring = True
        if not s:
            return occs, recurring

    m = _THROUGH_RE.match(s)  # "Through Sept. 7[, 10 a.m.-5 p.m.]"
    if m:
        mon = _month_num(m.group(1))
        end_d = _near_date(mon, int(m.group(2)), lo) if mon else None
        if end_d is None:
            return None
        run = _daily_run(lo, min(hi, end_d), _parse_times(m.group(3) or ""))
        seen = {o[0] for o in occs}
        occs.extend(o for o in run if o[0] not in seen)
        return occs, True

    m = _RUN_RE.match(s)  # "July 10-Aug. 31" (exhibit run after a reception)
    if m:
        m1, m2 = _month_num(m.group(1)), _month_num(m.group(3))
        d1 = _near_date(m1, int(m.group(2)), lo) if m1 else None
        d2 = _near_date(m2, int(m.group(4)), lo) if m2 else None
        if d1 is None or d2 is None or d2 < d1:
            return None
        seen = {o[0] for o in occs}
        occs.extend(o for o in _daily_run(max(lo, d1), min(hi, d2), [])
                    if o[0] not in seen)
        return occs, True

    # ---- general clause scan: explicit dates / weekly / monthly rules
    anchors = list(_ANCHOR.finditer(s))
    if not anchors and not occs:
        return None
    hi_eff = min(hi, through) if through else hi
    parsed_any = bool(occs)
    for i, m in enumerate(anchors):
        chunk_end = anchors[i + 1].start() if i + 1 < len(anchors) else len(s)
        chunk = s[m.end():chunk_end].strip(" ,").removesuffix("and").strip(" ,")
        times = _parse_times(chunk)
        hm, ehm = (times[0][0], times[0][1]) if times else (None, None)

        if m.group("explicit"):
            em = re.match(
                rf"(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\.,?\s+({_MONTH_RE})\s+(\d{{1,2}})",
                m.group("explicit"))
            mon = _month_num(em.group(1))
            d = _near_date(mon, int(em.group(2)), lo) if mon else None
            if d:
                parsed_any = True
                if lo <= d <= hi:
                    occs.append((d, hm, ehm))
        elif m.group("weekly"):
            days = _weekday_set(m.group("weekly"))
            if days:
                parsed_any = True
                recurring = True
                d = lo
                while d <= hi_eff:
                    if d.weekday() in days:
                        occs.append((d, hm, ehm))
                    d += timedelta(days=1)
        elif m.group("monthly"):
            gm = re.match(
                rf"((?:First|Second|Third|Fourth|Fifth|Last)"
                rf"(?:,? and (?:First|Second|Third|Fourth|Fifth|Last))*)\s+"
                rf"({_WD_FULL_RE})", m.group("monthly"))
            nths = [_ORDINALS[w.lower()] for w in re.findall(
                r"First|Second|Third|Fourth|Fifth|Last", gm.group(1))]
            wd = _WD_FULL.index(gm.group(2))
            parsed_any = True
            recurring = True
            occs.extend((d, hm, ehm)
                        for d in _nth_weekdays(nths, wd, lo, hi_eff))
        elif m.group("daily"):
            parsed_any = True
            recurring = True
            occs.extend(_daily_run(lo, hi_eff, times))
        elif m.group("everyother"):
            # no anchor date -> can't tell which weeks; skip, never guess
            recurring = True

    if not parsed_any:
        return None
    # one event per occurrence date: keep the earliest time per date
    best: dict[date, tuple] = {}
    multi_dates = len({o[0] for o in occs}) > 1
    for d, hm, ehm in sorted(occs, key=lambda o: (o[0], o[1] or (24, 0))):
        if d not in best:
            best[d] = (d, hm, ehm)
    return list(best.values()), recurring or multi_dates


# ------------------------------------------------------------- listing parse

_PHONE_RE = re.compile(r"\(?\d{3}\)?[ .-]?\d{3}[.-]\d{4}|\b\d{10}\b")


def _grab(pattern: str, chunk: str) -> str | None:
    m = re.search(pattern, chunk, re.S)
    if not m:
        return None
    txt = strip_tags(m.group(1))
    return txt or None


def _parse_listing_page(page: str) -> list[dict]:
    """One EventSearch results page -> [{url, title, when, venue, address,
    neighborhood, price, tag, description}]. Excludes the 'Popular Events'
    sidebar module (stacked teasers after the results list)."""
    start = page.find("comp-event-searchresultsdynamic")
    if start < 0:
        return []
    end = page.find("EventsPopular", start)
    seg = page[start:end if end > start else len(page)]

    items = []
    for chunk in re.split(r'<li class="fdn-pres-item', seg)[1:]:
        m = re.search(
            r'fdn-teaser-headline[^>]*>\s*<a href="(https://community\.'
            r'sevendaysvt\.com/event/[^"]+)"[^>]*>(.*?)</a>', chunk, re.S)
        when = _grab(r'fdn-teaser-subheadline">(.*?)</p>', chunk)
        if not m or not when:
            continue  # not a search-result teaser
        when = " ".join(when.split())
        desc = _grab(r'fdn-teaser-description[^>]*>(.*?)</div>', chunk)
        if desc:
            desc = _PHONE_RE.sub("", desc).strip(" ,;")
        items.append({
            "url": m.group(1),
            "title": strip_tags(m.group(2)),
            "when": when,
            "venue": _grab(r'fdn-event-teaser-location-link"[^>]*>(.*?)</a>', chunk),
            "address": _grab(r'fdn-inline-split-list[^>]*>\s*<span>(.*?)</span>', chunk),
            "neighborhood": _grab(r'<span class="uk-text-muted">(.*?)</span>', chunk),
            "price": _grab(r'fdn-event-teaser-price[^>]*>(.*?)</span>', chunk),
            "tag": _grab(r'fdn-teaser-tag-link[^>]*>(.*?)</a>', chunk),
            "description": desc,
        })
    return items


def _search_url(lo: date, hi: date, page_n: int, staff_picks: bool) -> str:
    params = {
        "narrowByDate": f"{lo.isoformat()}-to-{hi.isoformat()}",
        "neighborhood": NEIGHBORHOOD,
        "sortType": "date",
        "v": "d",
    }
    if staff_picks:
        params["feature"] = "Staff Picks"
    if page_n > 1:
        params["page"] = str(page_n)
    return BASE + "?" + urllib.parse.urlencode(params)


def _fetch_listings(lo: date, hi: date, staff_picks: bool) -> list[dict]:
    """All result pages for the window, deduped by event URL."""
    seen: set[str] = set()
    out: list[dict] = []
    page_n = 1
    while page_n <= MAX_PAGES:
        page = common.fetch(_search_url(lo, hi, page_n, staff_picks))
        items = _parse_listing_page(page)
        if not items:
            break
        for it in items:
            if it["url"] not in seen:
                seen.add(it["url"])
                out.append(it)
        # the pagination widget links the next page when there is one
        if f"page={page_n + 1}" not in page.replace("&amp;", "&"):
            break
        page_n += 1
    else:
        log(f"  [sevendays] WARNING: hit {MAX_PAGES}-page safety cap"
            f"{' (staff picks)' if staff_picks else ''}")
    label = "staff-pick" if staff_picks else "listing"
    log(f"  [sevendays] {len(out)} {label} entries across {page_n} page(s)")
    return out


# ------------------------------------------------------------------- fetch

def fetch(window_start: date, window_end: date) -> list[dict]:
    listings = _fetch_listings(window_start, window_end, staff_picks=False)
    try:
        picks = {it["url"] for it in
                 _fetch_listings(window_start, window_end, staff_picks=True)}
    except Exception as e:  # picks are an enrichment, never fatal
        log(f"  [sevendays] staff-picks fetch failed ({e}); continuing")
        picks = set()

    events: list[dict] = []
    unparsed = 0
    for it in listings:
        expanded = expand_when(it["when"], window_start, window_end)
        if expanded is None:
            unparsed += 1
            log(f"  [sevendays] unparsed date text: {it['when']!r} "
                f"({it['url']})")
            continue
        occs, recurring = expanded
        town = "Burlington" if it["neighborhood"] == "Burlington" else None
        category = _CAT_MAP.get((it["tag"] or "").lower())
        for d, hm, end_hm in occs:
            start = local_dt(d, hm)
            end = None
            if hm and end_hm:
                end = local_dt(d, end_hm)
                if end <= start:
                    end += timedelta(days=1)  # e.g. 11 p.m.-1 a.m.
            try:
                events.append(make_event(
                    source=SOURCE, title=it["title"], url=it["url"],
                    start=start, end=end,
                    venue=it["venue"], address=it["address"], town=town,
                    price=it["price"], category=category,
                    description=it["description"],
                    recurring=it["when"] if recurring else None,
                    signals={"staff_pick": True} if it["url"] in picks else None,
                ))
            except Exception as e:
                log(f"  [sevendays] skipped occurrence ({it['url']}): {e}")
    if unparsed:
        log(f"  [sevendays] {unparsed} listing(s) with unparsed date text")
    return events
