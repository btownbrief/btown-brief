"""South Burlington Recreation & Parks — public events.

Method: the city's CivicPlus calendar (southburlingtonvt.gov/calendar.aspx)
holds ONLY committee meetings; the rec department's public events (SoBu/SB
Nite Out, movie nights, farmers market, 5Ks, ...) live in CivicRec at
secure.rec1.com/VT/south-burlington-vt-recreation-parks. We use the same
JSON endpoints the public catalog page calls (no cookies/auth needed):

    GET  /catalog                         -> session checkoutKey (in HTML)
    GET  /catalog/getTabs/{key}           -> find the "Events" tab id
    POST /catalog/getItems/{key}/{tab}    -> sections -> activity groups
    POST /catalog/getActivitySessions/{key}/{tab}/{group} -> dated sessions

Each session carries location, dates ("07/16/26" or "07/06-07/27"), weekday,
times ("5:30pm-8pm") and the catalog price. Ranged sessions with a weekday
are expanded weekly (RRULE-equivalent stated by the source); ranges longer
than ~4 months are skipped as ongoing programs (one stale "Running Club -
2024" entry would otherwise fabricate dates). Undated ("Open"/"TBD")
memberships and canceled sessions are skipped. free=True only when the
group/session text says FREE; $0 catalog price alone is not enough.
Committee meetings never appear in this tab.
"""
from __future__ import annotations

import base64
import html
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common

SOURCE = "sbrec"
LABEL = "South Burlington Rec & Parks"

BASE = "https://secure.rec1.com/VT/south-burlington-vt-recreation-parks"
MAX_PAGES = 30
MAX_RANGE_DAYS = 130          # beyond this a date range is an ongoing program

_FORM = {"Content-Type": "application/x-www-form-urlencoded"}
_DATE_RE = re.compile(r"^(\d{2})/(\d{2})/(\d{2})$")
_RANGE_RE = re.compile(r"^(\d{2})/(\d{2})-(\d{2})/(\d{2})$")
_TIMES_RE = re.compile(r"^\s*([^-]+?)\s*-\s*(.+?)\s*$")
_LEAD_DATE_RE = re.compile(
    r"^\s*(?:\d{1,2}/\d{1,2}(?:/\d{2,4})?|[A-Z][a-z]+\.?\s+20\d\d)\s*[-:—]\s*")
_TRAIL_DATE_RE = re.compile(
    r"\s*(?:\(\s*\d{1,2}/\d{1,2}(?:/\d{2,4})?\s*\)|[-–—]\s*20\d\d)\s*$")
_SPONSOR_RE = re.compile(r"\s*[-–—]?\s*(?:sponsored by|in partnership with|"
                         r"presented by)\b.*$", re.I)
_FREE_RE = re.compile(r"\bfree\b", re.I)
_WEEKDAYS = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}


def _post_json(url: str, page: int = 1):
    return json.loads(common.fetch(url, method="POST",
                                   data=f"page={page}".encode(), headers=_FORM))


def _all_sessions(url: str) -> list[dict]:
    """getActivitySessions paginates; loop until itemCount reached."""
    items: list[dict] = []
    page = 1
    while True:
        data = _post_json(url, page)
        batch = data.get("items") or []
        items.extend(batch)
        total = data.get("itemCount")
        if not batch or not isinstance(total, int) or len(items) >= total:
            break
        if page >= MAX_PAGES:
            common.log(f"sbrec: hit {MAX_PAGES}-page cap on sessions")
            break
        page += 1
    return items


def _session_url(session_id) -> str:
    token = base64.b64encode(f"search={session_id}".encode()).decode()
    return f"{BASE}/catalog?filter={token}"


def _century(yy: int) -> int:
    return 2000 + yy


def _dates_for(datestr: str, day: str | None, lo: date, hi: date):
    """-> (list of occurrence dates, recurring_note) or (None, reason)."""
    datestr = (datestr or "").strip()
    m = _DATE_RE.match(datestr)
    if m:
        mo, dd, yy = map(int, m.groups())
        try:
            return [date(_century(yy), mo, dd)], None
        except ValueError:
            return None, f"bad date {datestr!r}"
    m = _RANGE_RE.match(datestr)
    if m:
        # MM/DD-MM/DD, year unstated -> anchor to the window's year
        mo1, d1, mo2, d2 = map(int, m.groups())
        year = lo.year
        try:
            start = date(year, mo1, d1)
            end = date(year + (1 if (mo2, d2) < (mo1, d1) else 0), mo2, d2)
        except ValueError:
            return None, f"bad range {datestr!r}"
        if (end - start).days > MAX_RANGE_DAYS:
            return None, f"range {datestr!r} too long (ongoing program)"
        wd = _WEEKDAYS.get((day or "").strip().lower()[:3])
        if wd is None:
            return None, f"range {datestr!r} without weekday"
        cur = start + timedelta(days=(wd - start.weekday()) % 7)
        dates = []
        while cur <= end:
            dates.append(cur)
            cur += timedelta(weeks=1)
        plural = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays",
                  "Fridays", "Saturdays", "Sundays"][wd]
        note = f"{plural} {start.strftime('%b %-d')}–{end.strftime('%b %-d')}"
        return dates, note
    return None, f"undated ({datestr!r})"


def _parse_times(times: str | None):
    """'5:30pm-8pm' -> ((17,30),(20,0)); missing/TBD -> (None, None)."""
    if not times or "tbd" in times.lower():
        return None, None
    m = _TIMES_RE.match(times)
    if m:
        return common.parse_time_str(m.group(1)), common.parse_time_str(m.group(2))
    return common.parse_time_str(times), None


def _clean_group(name: str) -> str:
    return " ".join(_SPONSOR_RE.sub("", name or "").split())


def _title(group: str, session_text: str) -> str:
    g = _clean_group(group)
    s = _SPONSOR_RE.sub("", session_text or "")
    s = _LEAD_DATE_RE.sub("", s)
    s = _TRAIL_DATE_RE.sub("", s)
    s = " ".join(s.split()).strip(" -–—")
    if not s or s.lower() in ("tbd", g.lower()):
        return g
    if g.lower() in s.lower():
        return s
    if s.lower() in g.lower():
        return g
    if s.lower().startswith(("registration", "membership")):
        return g
    return f"{g}: {s}"


def _town_for(venue: str | None) -> str | None:
    """Resolved venues keep their registry town; unresolved ones default to
    South Burlington (it's the city's own rec catalog) unless clearly UVM."""
    if not venue:
        return "South Burlington"
    _, vinfo = common.resolve_venue(venue)
    if vinfo.get("town"):
        return None                   # let make_event use the registry town
    if "uvm" in venue.lower():
        return None                   # UVM facilities straddle the city line
    return "South Burlington"


def fetch(window_start: date, window_end: date) -> list[dict]:
    page = common.fetch(BASE + "/catalog")
    m = re.search(r'"key":"([0-9a-f]+)"', html.unescape(page))
    if not m:
        raise RuntimeError("sbrec: no checkout key on catalog page")
    key = m.group(1)

    tabs = json.loads(common.fetch(f"{BASE}/catalog/getTabs/{key}"))
    events_tab = next((t["id"] for t in tabs.get("tabs", [])
                       if (t.get("label") or "").strip().lower() == "events"), None)
    if not events_tab:
        raise RuntimeError("sbrec: no Events tab in CivicRec catalog")

    groups: list[tuple[str, dict]] = []
    pg = 1
    while True:
        data = _post_json(f"{BASE}/catalog/getItems/{key}/{events_tab}", pg)
        for section in data.get("sections") or []:
            for g in section.get("groups") or []:
                groups.append((section.get("name") or "", g))
        if not data.get("hasMoreResults"):
            break
        if pg >= MAX_PAGES:
            common.log(f"sbrec: hit {MAX_PAGES}-page cap on getItems")
            break
        pg += 1

    out: list[dict] = []
    seen_sessions: set = set()
    for section_name, g in groups:
        if g.get("type") != "activity":
            continue
        gname = g.get("name") or ""
        try:
            items = _all_sessions(
                f"{BASE}/catalog/getActivitySessions/{key}/{events_tab}/{g['id']}")
        except Exception as e:
            common.log(f"sbrec: sessions for {gname!r} failed: {e}")
            continue

        parsed: list[tuple[dict, list, str | None, tuple, str | None]] = []
        occupied: set[tuple] = set()   # slots taken by single-date sessions
        for it in items:
            if it.get("id") in seen_sessions:
                continue
            seen_sessions.add(it.get("id"))
            text = it.get("text") or ""
            if it.get("canceled") or re.search(r"\bcancell?ed\b", text, re.I):
                continue
            feats = {f.get("name"): f.get("value")
                     for f in it.get("features") or []}
            dates, note = _dates_for(feats.get("dates"), feats.get("days"),
                                     window_start, window_end)
            if dates is None:
                common.log(f"sbrec: skipped {gname!r}/{text!r}: {note}")
                continue
            hm = _parse_times(feats.get("times"))
            loc = (feats.get("location") or "").strip()
            venue = None if not loc or loc.lower() == "location tbd" else loc
            if len(dates) == 1:
                occupied.add((dates[0], hm[0], venue))
            parsed.append((it, dates, note, hm, venue))

        for it, dates, note, (start_hm, end_hm), venue in parsed:
            try:
                text = it.get("text") or ""
                is_range = len(dates) > 1
                dates = [d for d in dates if window_start <= d <= window_end]
                if is_range:
                    # a specific dated session in this group at the same
                    # date/time/venue supersedes the umbrella series entry
                    dates = [d for d in dates
                             if (d, start_hm, venue) not in occupied]
                if not dates:
                    continue
                title = _title(gname, text)
                price_val = it.get("price")
                display = (it.get("customDisplayPrice") or "").strip()
                price = display or None
                if not price and price_val:
                    try:
                        price = f"${float(price_val):g}"
                    except (TypeError, ValueError):
                        price = str(price_val)
                hay = f"{section_name} {gname} {text}"
                free = True if _FREE_RE.search(hay) else None

                desc = g.get("descriptionText") or None
                for d in dates:
                    out.append(common.make_event(
                        source=SOURCE,
                        title=title,
                        url=_session_url(it.get("id")),
                        start=common.local_dt(d, start_hm),
                        end=(common.local_dt(d, end_hm)
                             if start_hm and end_hm else None),
                        venue=venue,
                        town=_town_for(venue),
                        price=price, free=free,
                        description=desc,
                        recurring=note if is_range else None,
                    ))
            except Exception as e:
                common.log(f"sbrec: skipped {gname!r}/{it.get('text')!r}: {e}")
    return out
