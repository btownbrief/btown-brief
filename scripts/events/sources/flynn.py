"""The Flynn (flynnvt.org) — performing arts center, 153 Main St, Burlington.

How this works (discovered 2026-07):
  * /Events is rendered client-side by Algolia InstantSearch. The page embeds
    the search credentials in the #algoliaSearchCont `data-settings` attribute
    and a `var keys = {...}` facet-id -> label map (Genre / Location /
    Event Type). We query the same Algolia index the site does, with the same
    filters (ExcludeFromCalendar:false + the page's "Web Setup" facet).
  * Records carry StartDate (epoch seconds, local wall-clock), Title,
    KenticoUrl (detail page), Venue ("Main Stage" / "Flynn Space" / "Other"),
    and numeric Genre / Location / Event Type facet ids.
  * Prices come from the site's own buy-button API:
    POST /buybutton/ByPerformanceIds -> per-performance
    {Status, MinPrice, MaxPrice, ...}. Detail pages have no JSON-LD and no
    price text, so this API is the only price source (it is exactly what the
    site's Buy buttons use). MinPrice/MaxPrice appear to include fees.
"""

from __future__ import annotations

import html as _html
import json
import re
import sys
import urllib.parse
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common

SOURCE = "flynn"
LABEL = "The Flynn"

BASE = "https://www.flynnvt.org"
LISTING = BASE + "/Events"

# Observed 2026-07; used only if the listing page markup changes.
_FALLBACK_SETTINGS = {
    "appid": "BR77IA976F",
    "apikey": "134f196afdd3cef100a1172a6b214f93",
    "index": "prod_flynn",
    "webSetup": ["1497"],
}
_FALLBACK_KEYS = {
    "Genre.2": "Theater", "Genre.3": "Dance", "Genre.9": "Broadway",
    "Genre.21": "Family", "Genre.23": "Comedy", "Genre.41": "Music",
    "Genre.1489": "Other",
    "Location.74": "FlynnSpace", "Location.76": "Main Stage",
    "Location.78": "UVM Recital Hall", "Location.81": "Burlington Waterfront",
    "Location.86": "Shelburne Museum", "Location.1496": "Other",
    "Location.1528": "Virtual/Online",
    "Event Type.18": "Benefit", "Event Type.67": "Movie/Film",
    "Event Type.1499": "Performance", "Event Type.1500": "Online",
    "Event Type.1501": "Workshop/Masterclass", "Event Type.1502": "Free Events",
}

# Rooms inside the Flynn building itself -> canonical venue "The Flynn".
_FLYNN_ROOMS = {"Main Stage", "Flynn Space", "FlynnSpace",
                "Amy E. Tarrant Gallery", "Chase Dance Studio", "Hoehl Studio"}

_GENRE_CATEGORY = {"Theater": "theater", "Dance": "theater",
                   "Broadway": "theater", "Comedy": "comedy",
                   "Music": "music", "Family": "family"}
# When a record carries several genres, prefer the most specific one.
_GENRE_ORDER = ["Comedy", "Theater", "Broadway", "Dance", "Music", "Family"]

_MAX_PAGES = 30


def _listing_config():
    """Parse Algolia settings + facet-label map from the listing page."""
    settings, keys = dict(_FALLBACK_SETTINGS), dict(_FALLBACK_KEYS)
    try:
        page = common.fetch(LISTING)
    except Exception as e:
        common.log(f"flynn: listing page fetch failed ({e}); using fallbacks")
        return settings, keys
    m = re.search(r'data-settings="([^"]+)"', page)
    if m:
        try:
            parsed = json.loads(urllib.parse.unquote(_html.unescape(m.group(1))))
            if parsed.get("appid") and parsed.get("apikey") and parsed.get("index"):
                settings = parsed
        except (json.JSONDecodeError, TypeError):
            common.log("flynn: could not parse data-settings; using fallbacks")
    m = re.search(r"var keys = (\{.*?\});", page, re.S)
    if m:
        try:
            keys = json.loads(m.group(1))
        except json.JSONDecodeError:
            common.log("flynn: could not parse facet keys; using fallbacks")
    return settings, keys


def _algolia_hits(settings, lo_epoch: int, hi_epoch: int) -> list[dict]:
    """Query the Flynn's Algolia index the same way the site does."""
    appid, apikey = settings["appid"], settings["apikey"]
    index = settings["index"]
    facet_filters = [["ExcludeFromCalendar:false"]]
    web_setup = settings.get("webSetup") or []
    if web_setup:
        facet_filters.append([f"Web Setup:{w}" for w in web_setup])
    url = f"https://{appid.lower()}-dsn.algolia.net/1/indexes/{urllib.parse.quote(index)}/query"
    headers = {"X-Algolia-Application-Id": appid, "X-Algolia-API-Key": apikey,
               "Content-Type": "application/json"}
    hits, page_no = [], 0
    while page_no < _MAX_PAGES:
        params = urllib.parse.urlencode({
            "hitsPerPage": 100,
            "page": page_no,
            "distinct": "true",
            "attributesToHighlight": "[]",
            "numericFilters": json.dumps(
                [f"StartDate>={lo_epoch}", f"StartDate<={hi_epoch}"]),
            "facetFilters": json.dumps(facet_filters),
        })
        body = json.dumps({"params": params}).encode()
        data = json.loads(common.fetch(url, headers=headers, method="POST", data=body))
        hits.extend(data.get("hits", []))
        page_no += 1
        if page_no >= data.get("nbPages", 0):
            break
    else:
        common.log("flynn: hit Algolia page cap")
    return hits


def _buy_buttons(perf_ids: list, nontess_ids: list) -> dict:
    """Site's own buy-button API: price / status per performance id."""
    if not perf_ids and not nontess_ids:
        return {}
    pairs = [("PerformanceIds[]", i) for i in perf_ids]
    pairs += [("NonTessIds[]", i) for i in nontess_ids]
    try:
        raw = common.fetch(
            BASE + "/buybutton/ByPerformanceIds",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST", data=urllib.parse.urlencode(pairs).encode())
        return json.loads(raw)
    except Exception as e:
        common.log(f"flynn: buy-button API failed ({e}); prices unavailable")
        return {}


def _fmt_price(lo: float, hi: float) -> str:
    def one(v: float) -> str:
        return f"${v:.2f}".replace(".00", "")
    return one(lo) if hi <= lo else f"{one(lo)}–{one(hi)}"


def fetch(window_start, window_end):
    settings, keys = _listing_config()
    lo_epoch = int(datetime(window_start.year, window_start.month,
                            window_start.day, tzinfo=common.TZ).timestamp())
    hi_dt = datetime(window_end.year, window_end.month, window_end.day,
                     tzinfo=common.TZ) + timedelta(days=1)
    hi_epoch = int(hi_dt.timestamp()) - 1
    hits = _algolia_hits(settings, lo_epoch, hi_epoch)

    seen_obj, perf_ids, nontess_ids = set(), [], []
    uniq = []
    for h in hits:
        oid = h.get("objectID")
        if oid in seen_obj:
            continue
        seen_obj.add(oid)
        uniq.append(h)
        tid = h.get("TessituraId")
        if tid is not None:
            (perf_ids if h.get("CalendarDataType") == "TessituraItem"
             else nontess_ids).append(tid)
    buttons = _buy_buttons(perf_ids, nontess_ids)

    events = []
    for h in uniq:
        try:
            ev = _build(h, keys, buttons)
            if ev:
                events.append(ev)
        except Exception as e:
            common.log(f"flynn: skipping {h.get('Title')!r}: {e}")
    return events


def _build(h: dict, keys: dict, buttons: dict):
    title = (h.get("Title") or "").strip()
    kurl = h.get("KenticoUrl")
    if not title or not kurl:
        return None
    start = datetime.fromtimestamp(h["StartDate"], common.TZ)
    url = urllib.parse.urljoin(BASE, kurl)

    genres = [keys.get(f"Genre.{g}") for g in (h.get("Genre") or [])]
    et_labels = [keys.get(f"Event Type.{e}") for e in (h.get("Event Type") or [])]
    loc_labels = [keys.get(f"Location.{l}") for l in (h.get("Location") or [])]

    if "Online" in et_labels or "Virtual/Online" in loc_labels:
        return None  # not a local, in-person happening

    # Venue: Flynn rooms -> "The Flynn" (room in tags); named off-site
    # locations pass through as stated; "Other"/unknown -> no venue claim.
    venue, room = None, None
    v = h.get("Venue")
    if v in _FLYNN_ROOMS:
        venue, room = "The Flynn", v
    elif v and v != "Other":
        venue = v
    else:
        label = next((l for l in loc_labels if l), None)
        if label in _FLYNN_ROOMS:
            venue, room = "The Flynn", label
        elif label and label != "Other":
            venue = label

    category = None
    for g in _GENRE_ORDER:
        if g in genres:
            category = _GENRE_CATEGORY[g]
            break
    if "Movie/Film" in et_labels:
        category = "film"
    elif category is None and "Workshop/Masterclass" in et_labels:
        category = "learning"

    # Price/status from the buy-button API (never invented).
    price, free, tags = None, None, []
    b = buttons.get(str(h.get("TessituraId")))
    if b:
        status = (b.get("Status") or "").lower()
        if status == "free":
            free = True
        elif (b.get("MinPrice") or 0) > 0:
            price = _fmt_price(b["MinPrice"], b.get("MaxPrice") or b["MinPrice"])
        if "sold" in status:
            tags.append("sold-out")
    if "Free Events" in et_labels:
        free = True
    if room:
        tags.append(re.sub(r"[^a-z0-9]+", "-", room.lower()).strip("-"))

    town = None
    if venue and venue != "The Flynn":
        town = common.town_from_address(venue)

    description = h.get("Desc") or h.get("SubTitle") or None

    return common.make_event(
        source=SOURCE, title=title, url=url, start=start,
        venue=venue, town=town, price=price, free=free,
        category=category, description=description, tags=tags or None)
