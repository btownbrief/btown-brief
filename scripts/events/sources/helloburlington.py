"""Hello Burlington (helloburlingtonvt.com) — Lake Champlain Chamber events.

The public listing (/events/this-weekend/ etc.) is a Vue widget with no
server-rendered entries; the page populates itself from Simpleview's REST
API, so we call the same endpoints the widget calls:

    GET /plugins/core/get_simple_token/          -> per-session query token
    GET /includes/rest_v2/plugins_events_events_by_date/find/
        ?json={filter, options}&token=...

Queried with a `date` range filter the API returns ONE DOC PER OCCURRENCE
DATE — recurring rules are already expanded server-side, with the human rule
text in `recurrence` ("Recurring weekly on Monday", ...) and the rule's end
in `endDate`. (The widget's own `date_range` filter instead collapses a
recurring series to its first date in range, which is why the old newsletter
scrape of the rendered listing undercounted.)

Docs carry title, detail url, location/address/city, startTime/endTime,
admission and description, so we never fetch detail pages — their JSON-LD is
date-only and adds nothing. Docs with no startTime are emitted as all-day
(date only), never with a guessed time.
"""
from __future__ import annotations

import json
import re
import urllib.parse
from datetime import date, datetime, timedelta

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common
from common import TZ, local_dt, log, make_event, parse_time_str

SOURCE = "helloburlington"
LABEL = "Hello Burlington"

BASE = "https://www.helloburlingtonvt.com"
API = BASE + "/includes/rest_v2/plugins_events_events_by_date/find/"
PAGE_SIZE = 25          # the API 500s on large limits (100 fails, 50 ok)
MAX_PAGES = 30

# Only the fields we use — mirrors the widget's own field list (plus times /
# admission / description); requesting everything works but is 10x the bytes.
FIELDS = {
    "recid": 1, "title": 1, "url": 1, "date": 1, "endDate": 1,
    "startTime": 1, "endTime": 1, "times": 1, "location": 1, "address1": 1,
    "city": 1, "admission": 1, "description": 1, "recurrence": 1,
    "categories": 1, "linkUrl": 1,
}

# "Free with Admission / Membership" is conditional, not free — without this
# guard common.parse_price would see the bare word "free" and mark it free.
_CONDITIONAL_FREE = re.compile(r"\bfree\s+(with|for\s+member)", re.I)

# Simpleview catName -> our category, for the unambiguous ones only.
# Broad buckets ("Arts & Culture", "Fun + Games", "This Weekend") are left
# unmapped so common.classify() can do better from title/description/venue.
_CAT_MAP = {
    "concerts & live music": "music",
    "food & drink": "food-drink",
    "farmers market": "market",
    "sporting event": "sports",
    "holidays": "community",
}


def _utc_iso(dt: datetime) -> str:
    """Aware datetime -> the {"$date": ...} ISO format the API expects."""
    return dt.astimezone(common.ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _get_token() -> str:
    token = common.fetch(BASE + "/plugins/core/get_simple_token/").strip()
    if not re.fullmatch(r"[0-9a-f]{16,64}", token):
        raise RuntimeError(f"unexpected simple-token response: {token[:60]!r}")
    return token


def _query(token: str, lo: date, hi: date, skip: int) -> dict:
    payload = {
        "filter": {
            "active": True,
            "date": {   # `date` = occurrence date (11:59:59pm ET, stored UTC)
                "$gte": {"$date": _utc_iso(datetime(lo.year, lo.month, lo.day, tzinfo=TZ))},
                "$lte": {"$date": _utc_iso(
                    datetime(hi.year, hi.month, hi.day, tzinfo=TZ) + timedelta(days=1, seconds=-1))},
            },
        },
        "options": {
            "limit": PAGE_SIZE, "skip": skip, "count": True, "castDocs": False,
            "fields": FIELDS, "sort": {"date": 1, "rank": 1, "title_sort": 1},
        },
    }
    url = API + "?" + urllib.parse.urlencode(
        {"json": json.dumps(payload, separators=(",", ":")), "token": token})
    return json.loads(common.fetch(url))["docs"]


def _fetch_docs(lo: date, hi: date) -> list[dict]:
    token = _get_token()
    docs: list[dict] = []
    total = None
    for page in range(MAX_PAGES):
        res = _query(token, lo, hi, page * PAGE_SIZE)
        total = res.get("count", 0)
        batch = res.get("docs") or []
        if not batch:
            break
        docs.extend(batch)
        if len(docs) >= total:
            break
    else:
        log(f"  [{SOURCE}] WARNING: hit {MAX_PAGES}-page safety cap")
    log(f"  [{SOURCE}] {len(docs)} occurrence docs (API count {total})")
    return docs


def _hm(doc: dict):
    """(hour, minute) from startTime 'HH:MM:SS', else from the free-text
    `times` field ('Doors: 8:00 PM / Show: 8:30 PM' -> first time)."""
    st = doc.get("startTime")
    if st:
        m = re.fullmatch(r"(\d{2}):(\d{2}):\d{2}", st)
        if m:
            return int(m.group(1)), int(m.group(2))
    return parse_time_str(doc.get("times") or "")


def _recurring_text(doc: dict, occ_date: date) -> str | None:
    rule = (doc.get("recurrence") or "").strip()
    if not rule:
        return None
    end = doc.get("endDate")
    if end:
        try:
            end_d = common.parse_iso(end)
            end_d = end_d.astimezone(TZ).date() if isinstance(end_d, datetime) else end_d
            if end_d > occ_date:
                rule += f" until {end_d.strftime('%B')} {end_d.day}, {end_d.year}"
        except ValueError:
            pass
    return rule


def fetch(window_start: date, window_end: date) -> list[dict]:
    docs = _fetch_docs(window_start, window_end)
    events: list[dict] = []
    seen: set[tuple] = set()
    for doc in docs:
        try:
            occ = common.parse_iso(doc["date"])   # aware, converted to ET
            occ_date = occ.astimezone(TZ).date() if isinstance(occ, datetime) else occ
            key = (doc.get("recid"), occ_date.isoformat(), doc.get("startTime"))
            if key in seen:     # pagination overlap guard
                continue
            seen.add(key)

            hm = _hm(doc)
            start = local_dt(occ_date, hm)
            end = None
            if hm and doc.get("endTime"):
                m = re.fullmatch(r"(\d{2}):(\d{2}):\d{2}", doc["endTime"])
                if m:
                    end = local_dt(occ_date, (int(m.group(1)), int(m.group(2))))
                    if end <= start:
                        end += timedelta(days=1)  # e.g. 10 p.m.-1 a.m.

            path = doc.get("url")
            url = BASE + path if path else doc.get("linkUrl")
            if not url:
                log(f"  [{SOURCE}] skipped (no url): {doc.get('title')!r}")
                continue

            category = None
            for c in doc.get("categories") or []:
                category = _CAT_MAP.get((c.get("catName") or "").lower())
                if category:
                    break

            admission = doc.get("admission")
            free = False if _CONDITIONAL_FREE.search(admission or "") else None

            events.append(make_event(
                source=SOURCE,
                title=doc["title"],
                url=url,
                start=start, end=end,
                venue=(doc.get("location") or "").strip() or None,
                address=(doc.get("address1") or "").strip() or None,
                town=(doc.get("city") or "").strip().title() or None,
                price=admission, free=free,
                category=category,
                description=doc.get("description"),
                recurring=_recurring_text(doc, occ_date),
            ))
        except Exception as e:
            log(f"  [{SOURCE}] skipped doc {doc.get('recid')!r}: {e}")
    return events
