#!/usr/bin/env python3
"""Town app, Alerts tab: the fetchable official sources, one JSON file.

    python3 -m scripts.town.alerts                 # all sections -> data/town/alerts.json
    python3 -m scripts.town.alerts --only closings,parking_ban

Sections (each fails on its own; see data/town/alerts-sources.json for the why):
  recycling     DPW "Find Your Recycling Day" ArcGIS layer: street -> pickup day + parking-ban zone
  dropoff       CSWD Burlington Drop-Off Center (339 Pine St) hours, read from its page
  parking_ban   City Alert Center + News Flash RSS, scanned for snow/parking-ban announcements
  greenway      Parks' Greenway plowing status layer (the only plow status the city publishes)
  closings      NBC5 and WCAX closings pages, filtered to Burlington-area districts; BSD news feed
  shelters      City Alert Center + News Flash RSS, scanned for warming/cooling center notices

Nothing here interprets a source beyond keyword matching. A parking-ban line is
"the city posted this headline at this time", never "there is a ban tonight"
unless the headline says so; the page should show the headline and link.
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

from .common import (CITY_ARCGIS, OUT_DIR, arcgis_layer_info, arcgis_query, get_text,
                     only_filter, page_text, parse_feed, rec, run_sections, strip_tags)

OUT = os.path.join(OUT_DIR, "alerts.json")

RECYCLING_LAYER = f"{CITY_ARCGIS}/Recycling_Streets/FeatureServer/1"
RECYCLING_PAGE = "https://www.burlingtonvt.gov/315/Recycling-Solid-Waste-Collection"
RECYCLING_MAP = ("https://burlingtonvt.maps.arcgis.com/apps/webappviewer/index.html"
                 "?id=724c74c720c24fb28c72c1eab435956a")
CSWD_BURLINGTON = "https://cswd.net/cswd-location/cswd-drop-off-center-in-burlington/"
ALERT_CENTER_RSS = "https://www.burlingtonvt.gov/RSSFeed.aspx?ModID=63&CID=All-0"
NEWSFLASH_RSS = "https://www.burlingtonvt.gov/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml"
WINTER_PARKING_PAGE = "https://www.burlingtonvt.gov/628/Winter-Parking"
GREENWAY_LAYER = f"{CITY_ARCGIS}/Greenway_Plowing_and_Condition_Status_Public/FeatureServer/0"
NBC5_CLOSINGS = "https://www.mynbc5.com/weather/closings"
WCAX_CLOSINGS = "https://www.wcax.com/weather/closings/"
BSD_FEED = "https://www.bsdvt.org/feed/"

BAN_RE = re.compile(r"\b(snow|parking|winter parking)\s+ban\b", re.I)
BAN_LIFTED_RE = re.compile(r"\b(lifted|cancel+ed|ended|no (snow|parking) ban)\b", re.I)
SHELTER_RE = re.compile(r"\b(warming (center|station|shelter|site)s?|cooling (center|site)s?|"
                        r"overflow shelter|emergency shelter|cold weather (shelter|exception)|"
                        r"adverse weather)\b", re.I)
SCHOOL_RE = re.compile(r"\b(delay(ed)?|clos(ed|ing|ure)|early (release|dismissal)|remote (learning|day)|"
                       r"snow day|cancel+ed)\b", re.I)
# Districts and colleges the Town app watches (match against closings-list names).
AREA_ORGS = [
    "Burlington School District", "Burlington", "South Burlington", "Winooski",
    "Champlain Valley", "CVSD", "Essex Westford", "EWSD", "Colchester", "Milton",
    "Mount Mansfield", "MMU", "Grand Isle", "Hinesburg", "Shelburne", "Williston",
    "Charlotte", "St. Michael", "Saint Michael", "Champlain College", "UVM",
    "University of Vermont", "Rice Memorial", "Mater Christi", "Christ the King",
]
AREA_RE = re.compile("|".join(re.escape(o) for o in AREA_ORGS), re.I)


def _feed_items(url, since_hours):
    raw = get_text(url).encode("utf-8")
    cutoff = datetime.now(timezone.utc) - timedelta(hours=since_hours)
    out = []
    for it in parse_feed(raw):
        if it["ts"] and it["ts"] < cutoff:
            continue
        out.append(it)
    return out


# ---------------------------------------------------------------- recycling
def recycling(verified):
    info = arcgis_layer_info(RECYCLING_LAYER)
    edited = (info.get("editingInfo") or {}).get("dataLastEditDate")
    rows = arcgis_query(RECYCLING_LAYER, out_fields="FACILITYID,Day,PARKINGBAN,Zone,Address_From")
    seen, streets = set(), []
    for a in rows:
        street = (a.get("FACILITYID") or "").strip()
        if not street:
            continue
        key = (street, a.get("Day"), a.get("PARKINGBAN"), a.get("Address_From"))
        if key in seen:
            continue
        seen.add(key)
        streets.append(rec(RECYCLING_MAP, verified,
                           street=street.title(),
                           recycling_day=a.get("Day"),
                           parking_ban_zone=(a.get("PARKINGBAN") or "").replace("ZONE ", "") or None,
                           address_from=a.get("Address_From"),
                           route_zone=a.get("Zone")))
    streets.sort(key=lambda r: (r["street"], r["recycling_day"] or ""))
    return {
        "source_name": "Burlington DPW recycling pickup days (ArcGIS)",
        "source_url": RECYCLING_LAYER,
        "layer_last_edited": datetime.fromtimestamp(edited / 1000, tz=timezone.utc).date().isoformat() if edited else None,
        "notes": ("City DPW collects residential recycling weekly in covered carts, out by 7am. "
                  "Trash is collected by private haulers, so there is no city trash day. "
                  "No pickup on Memorial Day, July 4, Labor Day, Thanksgiving, Christmas. "
                  "A street can appear twice when its segments differ; the layer has no house-number ranges."),
        "rules_url": RECYCLING_PAGE,
        "verified": verified,
        "items": streets,
    }


# ---------------------------------------------------------------- dropoff
def dropoff(verified):
    text = page_text(get_text(CSWD_BURLINGTON, browser=True))
    m = re.search(r"Hours of Operation\s+(.{5,160}?)\s+(Phone Assistance|At this Location|Get Directions)", text)
    if not m:
        raise RuntimeError("CSWD page no longer shows 'Hours of Operation'")
    notice = re.search(r"Access update:\s*(.{10,240}?)(?:\s+Menu\b|\s+Location Details)", text)
    return {"verified": verified, "items": [rec(
        CSWD_BURLINGTON, verified,
        name="CSWD Drop-Off Center in Burlington", address="339 Pine St., Burlington",
        hours=m.group(1).strip(),
        district_notice=notice.group(1).strip() if notice else None,
        takes="Blue-bin recycling, food scraps, small special items; no trailers or large loads",
    )]}


# ---------------------------------------------------------------- parking ban
def parking_ban(verified):
    items = []
    for name, url in (("City Alert Center", ALERT_CENTER_RSS), ("City News Flash", NEWSFLASH_RSS)):
        for it in _feed_items(url, since_hours=72):
            hay = f"{it['title']} {it['summary']}"
            if not BAN_RE.search(hay):
                continue
            items.append(rec(it["link"] or url, verified,
                             headline=it["title"], posted=it["ts"].isoformat() if it["ts"] else None,
                             channel=name, says_lifted=bool(BAN_LIFTED_RE.search(hay)),
                             summary=it["summary"][:280]))
    items.sort(key=lambda r: r["posted"] or "", reverse=True)
    latest = items[0] if items else None
    recent = latest and latest["posted"] and (
        datetime.now(timezone.utc) - datetime.fromisoformat(latest["posted"]) < timedelta(hours=24))
    if not latest:
        status = "none_posted_72h"
    elif recent and not latest["says_lifted"]:
        status = "ban_announcement_posted"
    elif recent:
        status = "lifted_or_cancelled_posted"
    else:
        status = "older_announcement_only"
    return {
        "verified": verified,
        "status": status,
        "status_note": ("Read from the city's own web channels. The official signal is the overhead "
                        "parking-ban lights plus 802-658-SNOW, VT-Alert texts and DPW social media, "
                        "which this script cannot read; show the headline, not a verdict."),
        "rules": rec(WINTER_PARKING_PAGE, verified,
                     called_by="3 PM the day of the ban",
                     hours="10 PM to 7 AM citywide; downtown Zone F midnight to 6 AM",
                     penalty="$75 ticket plus $75 tow",
                     free_garages="Marketplace, Downtown (College St) and Lakeview garages from 7 PM, out by 9 AM",
                     surface_lots="No overnight parking in municipal surface lots 2:30 to 6 AM, Dec 1 to Mar 15",
                     sign_up="https://www.burlingtonvt.gov/btv-alerts (VT-Alert text and email)"),
        "items": items,
    }


# ---------------------------------------------------------------- greenway
def greenway(verified):
    rows = arcgis_query(GREENWAY_LAYER, out_fields="Segment_Name,Plowing_Status,Ski_Condition,Condition_Notes,LastPlowedDate,EditDate")
    items = []
    for a in rows:
        last = a.get("LastPlowedDate")
        items.append(rec(GREENWAY_LAYER, verified,
                         segment=a.get("Segment_Name"),
                         plowed_in_winter_program=a.get("Plowing_Status") == 1,
                         skiable=a.get("Ski_Condition") == 1,
                         notes=(a.get("Condition_Notes") or "").strip() or None,
                         last_plowed=datetime.fromtimestamp(last / 1000, tz=timezone.utc).isoformat() if last else None,
                         updated=datetime.fromtimestamp(a["EditDate"] / 1000, tz=timezone.utc).isoformat() if a.get("EditDate") else None))
    return {"verified": verified,
            "notes": ("The city publishes no street-plow tracker. This Parks layer covers the five Greenway "
                      "(bike path) segments and is updated in winter only. A 'Plow_Data_sample' layer of DPW "
                      "truck tracks exists from a January 2026 trial but is not a live public feed."),
            "items": items}


# ---------------------------------------------------------------- closings
def _nbc5(verified):
    html = get_text(NBC5_CLOSINGS, browser=True)
    m = re.search(r'\\?"closingsData\\?":(\{.*?\\?"total\\?":\d+\})', html)
    if not m:
        raise RuntimeError("NBC5 page no longer carries closingsData")
    blob = m.group(1)
    if '\\"' in blob:
        blob = blob.replace('\\"', '"')
    data = json.loads(blob)
    out = []
    for c in data.get("closings") or []:
        name = next((str(c[k]) for k in ("name", "organization", "orgName", "title") if c.get(k)), "")
        status = next((str(c[k]) for k in ("status", "message", "closingStatus", "description") if c.get(k)), "")
        if name and AREA_RE.search(name):
            out.append(rec(NBC5_CLOSINGS, verified, org=name, status=status, outlet="NBC5"))
    return data.get("total", 0), out


def _wcax(verified):
    html = get_text(WCAX_CLOSINGS, browser=True)
    i = html.find("gsync-closings-detailed")
    if i < 0:
        raise RuntimeError("WCAX page no longer carries the closings block")
    block = html[i:i + 60000]
    end = block.find("</section>")
    text = page_text(block[:end] if end > 0 else block)
    lines = []
    for m in re.finditer(r"([A-Z][\w.&'’ -]{2,80}?)\s+(Closed|Delayed?[^.]{0,40}|Early (?:Release|Dismissal)[^.]{0,40}|Remote[^.]{0,40})", text):
        org, status = m.group(1).strip(), m.group(2).strip()
        if AREA_RE.search(org):
            lines.append(rec(WCAX_CLOSINGS, verified, org=org, status=status, outlet="WCAX"))
    return lines, ("no closings" in text.lower())


def closings(verified):
    items, notes = [], []
    errors = 0
    try:
        total, nb = _nbc5(verified)
        items += nb
        notes.append(f"NBC5 list total {total}")
    except Exception as e:  # noqa: BLE001
        errors += 1
        notes.append(f"NBC5 failed: {e}")
    try:
        wc, empty = _wcax(verified)
        items += wc
        notes.append("WCAX shows no closings" if empty and not wc else f"WCAX matches {len(wc)}")
    except Exception as e:  # noqa: BLE001
        errors += 1
        notes.append(f"WCAX failed: {e}")
    bsd = []
    try:
        for it in _feed_items(BSD_FEED, since_hours=36):
            if SCHOOL_RE.search(it["title"]):
                bsd.append(rec(it["link"] or BSD_FEED, verified, headline=it["title"],
                               posted=it["ts"].isoformat() if it["ts"] else None, outlet="BSD news"))
    except Exception as e:  # noqa: BLE001
        errors += 1
        notes.append(f"BSD feed failed: {e}")
    if errors == 3:
        raise RuntimeError("; ".join(notes))
    return {"verified": verified,
            "notes": "; ".join(notes) + (". The district's own call or ParentSquare message is the "
                                          "official word; TV lists are relays."),
            "items": items, "district_posts": bsd}


# ---------------------------------------------------------------- shelters
def shelters(verified):
    items = []
    for name, url in (("City Alert Center", ALERT_CENTER_RSS), ("City News Flash", NEWSFLASH_RSS)):
        for it in _feed_items(url, since_hours=24 * 14):
            hay = f"{it['title']} {it['summary']}"
            if SHELTER_RE.search(hay):
                items.append(rec(it["link"] or url, verified, headline=it["title"],
                                 posted=it["ts"].isoformat() if it["ts"] else None,
                                 channel=name, summary=strip_tags(it["summary"])[:280]))
    items.sort(key=lambda r: r["posted"] or "", reverse=True)
    return {"verified": verified,
            "notes": ("Announcements only, last 14 days. Standing year-round shelters and the state's "
                      "adverse-weather motel rule are listed in alerts-sources.json; call 2-1-1 or COTS "
                      "802-864-7402 to confirm a bed."),
            "items": items}


SECTIONS = [("recycling", recycling), ("dropoff", dropoff), ("parking_ban", parking_ban),
            ("greenway", greenway), ("closings", closings), ("shelters", shelters)]


def main():
    ap = argparse.ArgumentParser(description="Refresh data/town/alerts.json")
    ap.add_argument("--only", help="comma-separated section names")
    args = ap.parse_args()
    print("Town alerts:")
    failed = run_sections(OUT, only_filter(args.only, SECTIONS),
                          {"sources_file": "data/town/alerts-sources.json"})
    sys.exit(1 if failed == len(only_filter(args.only, SECTIONS)) else 0)


if __name__ == "__main__":
    main()
