"""Meetup — Burlington-area group events.

Two feeds, merged and deduped by event id:

1. GROUP ICAL FEEDS — every public Meetup group exposes an unauthenticated
   iCal at https://www.meetup.com/<slug>/events/ical/. The ical gives exact
   title/date/time/url but (as of 2026) NO venue, so each event's own page is
   fetched once and its embedded __NEXT_DATA__ Apollo cache (fallback:
   JSON-LD) supplies venue name/town, online-vs-in-person, cancellation
   status, RSVP "going" count and fee settings.

2. FIND PAGE — https://www.meetup.com/find/?location=us--vt--Burlington
   embeds recommended events (with inline venues + RSVP counts) in
   __NEXT_DATA__; anything not already seen via the icals is added.

Accuracy notes: online events are dropped; events whose town is known and
outside the Chittenden-County area are dropped; price/free stay None unless
Meetup states a fee (free is NOT assumed — many events are free, not all).
Attendee counts go in signals["meetup_going"], never the description.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common

SOURCE = "meetup"
LABEL = "Meetup"

OWN_GROUP = "burlington-social-activites-group"  # Stephen's group (sic: "activites")

# Curated active Burlington-area groups, verified 2026-07 (each slug's
# /events/ical/ returned events). To add a group: take the slug from its
# meetup.com URL (meetup.com/<slug>/) and append it here — dead/private
# feeds are skipped automatically, so a bad slug just logs a warning.
# Re-discover candidates at:
#   https://www.meetup.com/find/?location=us--vt--Burlington&source=EVENTS&eventType=inPerson
GROUP_SLUGS = [
    OWN_GROUP,                                   # Btown Brief IRL
    "getting-active-in-burlington",              # Getting Active in Burlington!
    "forever-38",                                # Forever 38 (social, 30s-50s)
    "friendlytabletopgamers",                    # The Friendly Tabletop Gamers
    "burlington-brewery-book-club",              # Burlington Brewery Book Club
    "womens-soccer-vermont",                     # VT Womxn's Pick-up Soccer
    "community-of-poets-sharing-circle-with-darlene-witte-phd",
    "burlington-vt-wordpress-meetup",            # Burlington WordPress Meetup
    "vermont-technology-meetup",                 # Vermont Technology Meetup
    "green-mountain-club-burlington-section-outdoor-adventures",
    "slow-runners-club",                         # Slow Runners Club
    "vtladiessocialgroup",                       # Burlington Area Ladies Social Group
    "burlington-writers",                        # Green Mountain Writers Group
    "nw-vermont-technology-meetups",             # NW Vermont Technology Meetups
    "ai-safety-awareness-group-burlington",      # AI Safety Awareness Group
    "burlington-bitcoin-meetup",                 # Burlington Bitcoin Meetup
    "gathering-in-the-champlain-islands",        # regional; town filter applies
]

FIND_URL = ("https://www.meetup.com/find/?location=us--vt--Burlington"
            "&source=EVENTS&eventType=inPerson")

ENRICH_CAP = 100  # max event-page fetches per run (1s/req rate limit applies)

# Keep events whose town is unknown (curated local groups) or in this set.
KEEP_TOWNS = {
    "burlington", "south burlington", "winooski", "essex", "essex junction",
    "colchester", "shelburne", "williston", "richmond", "jericho",
    "hinesburg", "milton", "charlotte", "underhill", "westford",
    "huntington", "bolton", "st. george", "saint george",
}

_ONLINE_HINT = re.compile(r"\b(online|virtual|zoom|webinar|google meet)\b", re.I)
_EVENT_ID_RE = re.compile(r"/events/(\d+)")
_NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json"[^>]*>(.*?)</script>', re.S)


def _next_data(page: str) -> dict | None:
    m = _NEXT_DATA_RE.search(page)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


def _apollo(page: str) -> dict:
    nd = _next_data(page)
    if not nd:
        return {}
    return ((nd.get("props") or {}).get("pageProps") or {}).get("__APOLLO_STATE__") or {}


def _fee_price(fee_settings) -> str | None:
    """feeSettings -> '$12' style display, or None. Never invents 'Free'."""
    if not isinstance(fee_settings, dict):
        return None
    amount = fee_settings.get("amount")
    try:
        amount = float(amount)
    except (TypeError, ValueError):
        return None
    if amount > 0:
        cur = (fee_settings.get("currency") or "USD").upper()
        return f"${amount:g}" if cur == "USD" else f"{amount:g} {cur}"
    return None


def _enrich_from_event_page(url: str) -> dict:
    """Fetch one event page -> {venue, address, town, online, cancelled,
    going, price, description}. Missing page/fields -> empty/None values."""
    info: dict = {}
    page = common.fetch(url)
    eid_m = _EVENT_ID_RE.search(url)
    eid = eid_m.group(1) if eid_m else None

    ap = _apollo(page)
    ev = ap.get(f"Event:{eid}") if eid else None
    if not ev:  # fall back to any Event node on the page
        ev = next((v for k, v in ap.items() if k.startswith("Event:")), None)
    if ev:
        info["online"] = ev.get("eventType") == "ONLINE"
        info["cancelled"] = ev.get("status") not in (None, "ACTIVE", "PUBLISHED", "PAST")
        info["price"] = _fee_price(ev.get("feeSettings"))
        for k, v in ev.items():
            if k.startswith("rsvps(") and '"YES"' in k and isinstance(v, dict):
                if isinstance(v.get("totalCount"), int):
                    info["going"] = v["totalCount"]
        vref = ev.get("venue")
        vnode = None
        if isinstance(vref, dict):
            vnode = ap.get(vref.get("__ref")) if vref.get("__ref") else vref
        if isinstance(vnode, dict) and vnode.get("__typename") == "Venue":
            info["venue"] = vnode.get("name")
            info["address"] = vnode.get("address")
            if (vnode.get("state") or "").upper() in ("VT", ""):
                info["town"] = vnode.get("city")
            else:
                info["town"] = vnode.get("city")
                info["out_of_state"] = (vnode.get("state") or "").upper() not in ("VT", "")

    if "online" not in info or (info.get("venue") is None and "town" not in info):
        for node in common.jsonld_events(page):
            mode = node.get("eventAttendanceMode") or ""
            if "online" not in info and mode:
                info["online"] = "Online" in mode
            status = node.get("eventStatus") or ""
            if "cancelled" not in info and status:
                info["cancelled"] = "Cancelled" in status or "Canceled" in status
            loc = node.get("location") or {}
            if isinstance(loc, dict) and info.get("venue") is None:
                info["venue"] = loc.get("name")
                addr = loc.get("address") or {}
                if isinstance(addr, dict):
                    info.setdefault("address", addr.get("streetAddress"))
                    info.setdefault("town", addr.get("addressLocality"))
            break
    return info


def _keep_town(town: str | None) -> bool:
    if not town:
        return True  # curated local groups; venue often revealed on RSVP
    return town.strip().lower() in KEEP_TOWNS


def _norm_town(town: str | None) -> str | None:
    """Meetup venue cities arrive in mixed case ('BURLINGTON', 'burlington')."""
    if not town:
        return None
    town = " ".join(town.split())
    for t in common.TOWNS:
        if town.lower() == t.lower():
            return t
    return town.title() if (town.isupper() or town.islower()) else town


def _strip_group_header(desc: str | None, group_name: str | None) -> str | None:
    """Meetup ical DESCRIPTION starts with the group name on its own line."""
    if not desc:
        return None
    lines = desc.split("\n")
    if group_name and lines and lines[0].strip() == group_name.strip():
        lines = lines[1:]
    return "\n".join(lines).strip() or None


def fetch(window_start, window_end):
    events: dict[str, dict] = {}   # meetup event id -> make_event dict
    enrich_budget = ENRICH_CAP
    capped = False

    # ---------------- part 1: curated group ical feeds ----------------
    for slug in GROUP_SLUGS:
        try:
            ics = common.fetch(f"https://www.meetup.com/{slug}/events/ical/")
            occurrences = common.parse_ics(ics, window_start, window_end)
        except Exception as e:
            common.log(f"  meetup: group '{slug}' feed failed ({e}); skipping")
            continue
        # X-WR-CALNAME = group display name (used to trim description header)
        gname_m = re.search(r"^(?:X-WR-CALNAME|NAME):(.+)$", ics, re.M)
        group_name = gname_m.group(1).strip() if gname_m else None
        kept = 0
        for occ in occurrences:
            url = occ.get("url")
            title = occ.get("summary")
            if not url or not title:
                continue
            eid_m = _EVENT_ID_RE.search(url)
            eid = eid_m.group(1) if eid_m else url
            if eid in events:
                continue
            info: dict = {}
            if enrich_budget > 0:
                try:
                    info = _enrich_from_event_page(url)
                    enrich_budget -= 1
                except Exception as e:
                    common.log(f"  meetup: enrich failed for {url} ({e})")
            else:
                capped = True
            if info.get("online"):
                continue
            if info.get("cancelled"):
                continue
            if info.get("out_of_state"):
                continue
            town = _norm_town(info.get("town"))
            if not _keep_town(town):
                continue
            desc = _strip_group_header(occ.get("description"), group_name)
            if not info and desc and _ONLINE_HINT.search(f"{title} {desc[:200]}"):
                continue  # unenriched + smells online -> too risky to keep
            signals: dict = {}
            if isinstance(info.get("going"), int):
                signals["meetup_going"] = info["going"]
            tags: list = []
            if slug == OWN_GROUP:
                signals["own_group"] = True
                tags.append("social")
            try:
                events[eid] = common.make_event(
                    source=SOURCE,
                    title=title,
                    url=url,
                    start=occ["start"],
                    end=occ.get("end"),
                    venue=info.get("venue"),
                    address=info.get("address"),
                    town=town,
                    price=info.get("price"),
                    description=desc,
                    recurring=occ.get("recurring"),
                    tags=tags,
                    signals=signals,
                )
                kept += 1
            except Exception as e:
                common.log(f"  meetup: bad event {url} ({e})")
        common.log(f"  meetup: {slug}: {kept} events")
    if capped:
        common.log(f"  meetup: enrichment cap {ENRICH_CAP} hit — some events "
                   "kept with venue unknown")

    # -------- part 2: find-page recommended events (venues inline) ----
    try:
        ap = _apollo(common.fetch(FIND_URL))
        added = 0
        for key, node in ap.items():
            if not key.startswith("Event:") or not isinstance(node, dict):
                continue
            url = node.get("eventUrl")
            title = node.get("title")
            dt_raw = node.get("dateTime")
            if not url or not title or not dt_raw:
                continue
            eid_m = _EVENT_ID_RE.search(url)
            eid = eid_m.group(1) if eid_m else url
            if eid in events:
                continue
            if node.get("eventType") and node["eventType"] != "PHYSICAL":
                continue
            try:
                start = common.parse_iso(dt_raw)
            except ValueError:
                continue
            sdate = start.date() if isinstance(start, datetime) else start
            if not (window_start <= sdate <= window_end):
                continue
            venue = node.get("venue") if isinstance(node.get("venue"), dict) else {}
            if venue.get("__ref"):
                venue = ap.get(venue["__ref"]) or {}
            town = _norm_town(venue.get("city"))
            if (venue.get("state") or "").upper() not in ("", "VT"):
                continue
            if not _keep_town(town):
                continue
            gref = (node.get("group") or {}).get("__ref")
            gslug = (ap.get(gref) or {}).get("urlname") if gref else None
            signals = {}
            going = (node.get("rsvps") or {}).get("totalCount")
            if isinstance(going, int):
                signals["meetup_going"] = going
            tags = []
            if gslug == OWN_GROUP:
                signals["own_group"] = True
                tags.append("social")
            try:
                events[eid] = common.make_event(
                    source=SOURCE,
                    title=title,
                    url=url,
                    start=start,
                    venue=venue.get("name"),
                    address=venue.get("address"),
                    town=town,
                    price=_fee_price(node.get("feeSettings")),
                    description=node.get("description"),
                    tags=tags,
                    signals=signals,
                )
                added += 1
            except Exception as e:
                common.log(f"  meetup: bad find-page event {url} ({e})")
        common.log(f"  meetup: find page added {added} extra events")
    except Exception as e:
        common.log(f"  meetup: find page failed ({e}); ical results only")

    if not events:
        raise RuntimeError("meetup: no events from any group feed or find page")
    return list(events.values())


if __name__ == "__main__":
    lo, hi = common.default_window(14)
    for ev in fetch(lo, hi):
        print(json.dumps(ev, indent=1))
