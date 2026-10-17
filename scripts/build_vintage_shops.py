#!/usr/bin/env python3
"""Build data/vintage-shops.json, the Vintage tab's shop guide, from
data/things.json.

Which places: things.json entries in the Shopping group whose category,
name or blurb says they are a vintage, thrift, consignment or antique shop,
anywhere in greater Burlington (Burlington, Winooski, South Burlington,
Williston, Essex, Colchester, Shelburne; ROUTE below enforces it). The guide is for thrifting, so a
category decides two things: a "Record Store" is not a thrift and stays
out (it keeps its things.json entry for the rest of the site), and a
"Library & Bookstore" (used books) goes at the very bottom, after the walk,
with no leg into it. A shopping street ("Pine Street (South End Shopping)") is not
a shop and is left out, and so is a shop with no verified street address:
a walking guide can't send anyone to it. Those are named in `left_out` so
Stephen can see who is waiting on an address. Nothing is added by hand: a shop that is not in
things.json is not in the guide, so the way to add one is to add it there.

What each shop carries: name, neighborhood, address, website, coordinates
and hours exactly as things.json has them, and a one-line blurb, which is
the first sentence of the entry's own blurb. Hours come only from the
entry's `hours`, day by day, and only when the entry also has `checked`:
the date someone read them and the page they were read from, the shop's
own site wherever it publishes them:

    "hours": {"mon": null, "tue": "11:00-18:00", ..., "sun": "12:00-17:00"},
    "checked": {"date": "2026-10-17", "source": "https://...", "note": "..."}

A day set to null is a closed day, and "unlisted" is one the shop's page
leaves out (shown as "not listed", never as closed). `hours_note` carries
what a shop says beside its hours ("Show nights run late"). An entry with
no `hours` has none published, and the tab says to call ahead. The kinds
shown come from the words in the entry unless it sets `guide_kinds` ("a
used bookstore that mentions vintage" is not a vintage shop). Nothing is
guessed. Every
missing fact is listed in the shop's `gaps`, so the tab can say "hours not
checked yet" instead of leaving a hole, and Stephen can see what to fill.

The order is a walk, then a drive: downtown first, the South End along
Pine Street, the Old North End and Winooski on foot, then a loop by car
through Colchester, Essex, Williston, South Burlington and Shelburne. Within a
neighborhood, shops with coordinates go nearest-first from the previous
stop. Between two shops that both have coordinates the file carries the
walk (straight-line distance times 1.3 for the street grid, at 3 mph),
or, past a mile, the distance as a drive or a bus ride, so nobody is told to
walk half an hour along Route 2A; where either end has no coordinates, the
leg says so rather than guessing.

Instagram: an entry may carry `instagram`, the shop's handle as its own
site links it. The file lists those handles (plus the vintage markets in
MARKETS, which are not shops) so the tab's "New in" rail can pick the
shops' own posts out of all-day/data/instagram.json.

    python3 scripts/build_vintage_shops.py          # writes the file
    python3 scripts/build_vintage_shops.py --check  # exits 1 if it is stale
"""

import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "things.json"
OUT = ROOT / "data" / "vintage-shops.json"

# What makes a Shopping entry a shop for this guide, and which kind.
KINDS = [
    ("vintage", re.compile(r"\bvintage\b", re.I)),
    ("thrift", re.compile(r"\bthrift\b", re.I)),
    ("consignment", re.compile(r"\bconsign(ment|ed)?\b", re.I)),
    ("antique", re.compile(r"\bantiques?\b", re.I)),
    ("record", re.compile(r"\b(records?|vinyl)\b", re.I)),
]
KIND_LABEL = {"record": "Records", "antique": "Antiques", "consignment": "Consignment",
              "thrift": "Thrift", "vintage": "Vintage"}
# A street, a mall or a district is a place to walk, not a shop: "Church
# Street Marketplace" mentions its record shop, "Pine Street (South End
# Shopping)" its vintage shops, and neither is one. A shop may still call
# itself a marketplace ("Vintage Inspired Marketplace").
NOT_A_SHOP = re.compile(r"\bstreet marketplace\b|\bdistrict\b|\(.*shopping\)", re.I)

# Categories that are not thrifting: left out, or put after the walk.
NOT_THRIFT = {"Record Store"}
AFTER_THE_WALK = {"Library & Bookstore"}
# Instagram accounts that are vintage markets rather than shops: their
# posts are "new in" too. Each was read on its own profile.
MARKETS = ["burlingtonvintagemarket"]

# The walk, neighborhood by neighborhood, then the drive. These are also
# the guide's bounds: things.json files Stowe, Waterbury, Richmond and the
# rest of the day trips under "Greater Burlington", so a shop there (or in a
# neighborhood not listed) is named in left_out instead of joining the route.
ROUTE = ["Downtown / Church St", "Waterfront", "South End", "Hill Section", "UVM / University",
         "Old North End", "New North End", "Winooski", "Colchester", "Essex / Essex Jct",
         "Williston", "South Burlington", "Shelburne"]
HANDLE = re.compile(r"^[a-z0-9._]{1,30}$")

HOURS = re.compile(r"\bOpen ([^.]*?\b(daily|weekdays|weekends|mon|tue|wed|thu|fri|sat|sun)[^.]*)\.", re.I)
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DAY_LABEL = dict(zip(DAYS, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]))
UNLISTED = "unlisted"            # a day the shop's own page leaves out: not known to be closed
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SPAN = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$")
CHURCH_ST = [44.4759, -73.2121]
WALK_MPH = 3.0
STREET_FACTOR = 1.3
DRIVE_OVER_MILES = 1.0          # over 20 minutes on foot, the leg says drive or bus


def miles(a, b):
    r, rad = 3958.8, math.pi / 180
    dlat, dlon = (b[0] - a[0]) * rad, (b[1] - a[1]) * rad
    s = math.sin(dlat / 2) ** 2 + math.cos(a[0] * rad) * math.cos(b[0] * rad) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(s))


def kinds_of(t):
    text = " ".join([t.get("name") or "", t.get("category") or "", t.get("blurb") or ""])
    return [k for k, rx in KINDS if rx.search(text)]


def first_sentence(text):
    """The blurb's first sentence, minus an hours sentence (those are hours, not a blurb)."""
    parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", text or "") if p.strip()]
    parts = [p for p in parts if not HOURS.match(p)]
    return parts[0] if parts else ""


def clock(hh, mm):
    """14:30 -> 2:30pm, 12:00 -> noon."""
    h, m = int(hh), int(mm)
    if h == 12 and m == 0:
        return "noon"
    suffix = "am" if h < 12 else "pm"
    h = h % 12 or 12
    return f"{h}:{m:02d}{suffix}" if m else f"{h}{suffix}"


def week_of(t):
    """The entry's checked hours, day by day, or None. A malformed day stops the build: no guessing."""
    hours = t.get("hours")
    if hours is None:
        return None
    if not checked_of(t):
        sys.exit(f"{t['id']}: hours without a checked date and source page")
    if not isinstance(hours, dict) or sorted(hours) != sorted(DAYS):
        sys.exit(f"{t['id']}: hours must give all seven days, mon to sun (null for closed)")
    for d in DAYS:
        if hours[d] is not None and hours[d] != UNLISTED and not SPAN.match(hours[d]):
            sys.exit(f"{t['id']}: {d} hours {hours[d]!r} are not HH:MM-HH:MM, null or {UNLISTED!r}")
    if not any(hours[d] not in (None, UNLISTED) for d in DAYS):
        sys.exit(f"{t['id']}: hours with no open day; leave hours out instead")
    return {d: hours[d] for d in DAYS}


def checked_of(t):
    """The entry's checked record, if it is a real one: an ISO date and a web page."""
    c = t.get("checked")
    if c is None:
        return None
    if not (isinstance(c, dict) and ISO_DATE.match(str(c.get("date") or "")) and re.match(r"^https?://", str(c.get("source") or ""))):
        sys.exit(f"{t['id']}: checked needs a YYYY-MM-DD date and an http(s) source")
    return c


def hours_line(week):
    """Mon to Sun grouped into runs: "Tue–Sat 11am to 6pm · Sun noon to 5pm · closed Mon"."""
    if not week:
        return None
    label = lambda days: ", ".join(DAY_LABEL[d] for d in days)

    def say(span):
        m = SPAN.match(span)
        return clock(m[1], m[2]) + " to " + clock(m[3], m[4])

    runs = []                                   # [first day, last day, span or None]
    for d in DAYS:
        if runs and runs[-1][2] == week[d]:
            runs[-1][1] = d
        else:
            runs.append([d, d, week[d]])
    if len(runs) == 1:
        return "Daily " + say(runs[0][2])
    parts = [(DAY_LABEL[a] if a == b else DAY_LABEL[a] + "–" + DAY_LABEL[b]) + " " + say(span) for a, b, span in runs if span not in (None, UNLISTED)]
    closed = [d for d in DAYS if week[d] is None]
    unlisted = [d for d in DAYS if week[d] == UNLISTED]
    if closed:
        parts.append("closed " + label(closed))
    if unlisted:
        parts.append(label(unlisted) + " not listed")
    return " · ".join(parts)


def shop(t):
    ks = kinds_of(t)
    coords = t.get("coords")
    coords = coords if isinstance(coords, list) and len(coords) == 2 and all(isinstance(c, (int, float)) for c in coords) else None
    week = week_of(t)
    checked = checked_of(t)
    out = {
        "id": t["id"],
        "name": t["name"],
        "kinds": t.get("guide_kinds") or [KIND_LABEL[k] for k in ks],
        "neighborhood": t.get("neighborhood") or None,
        "address": t.get("address") or None,
        "website": t.get("website") or None,
        "coords": coords,
        "hours": hours_line(week),
        "week": week,
        "hours_note": t.get("hours_note") or None,
        "phone": t.get("phone") or None,
        "blurb": first_sentence(t.get("blurb")),
        "verified": (checked or {}).get("date") or t.get("last_verified") or None,
        "checked": checked,
    }
    ig = t.get("instagram")
    if ig is not None:
        if not (isinstance(ig, str) and HANDLE.match(ig)):
            sys.exit(f"{t['id']}: instagram must be a bare lowercase handle, got {ig!r}")
        out["instagram"] = ig
    if t.get("category") in AFTER_THE_WALK:
        out["after_walk"] = True
    # An address that only names a street area is not an address to walk to.
    if out["address"] and re.match(r"^[A-Za-z .]+ (area|street|st)\b,", out["address"], re.I) and not re.match(r"^\d", out["address"]):
        out["address_note"] = out["address"]
        out["address"] = None
    out["gaps"] = [k for k in ("address", "coords", "hours", "website") if not out[k]]
    return out


def walk_order(shops):
    rank = {n: i for i, n in enumerate(ROUTE)}
    by_hood = {}
    for s in shops:
        by_hood.setdefault(s["neighborhood"], []).append(s)
    hoods = sorted(by_hood, key=lambda h: (rank.get(h, len(ROUTE)), h or ""))
    ordered, last = [], CHURCH_ST      # the walk starts on Church Street
    for h in hoods:
        group = sorted(by_hood[h], key=lambda s: s["name"])
        # nearest-first from the previous stop, for the shops that can be placed
        placed = [s for s in group if s["coords"]]
        unplaced = [s for s in group if not s["coords"]]
        seq = []
        while placed:
            placed.sort(key=lambda s: miles(last, s["coords"]))
            nxt = placed.pop(0)
            seq.append(nxt)
            last = nxt["coords"]
        ordered += seq + unplaced
    return ordered


def legs(ordered):
    """The way from each shop to the next one. Nothing leads into the shops
    after the walk: the used bookstore is not the next stop on a thrift run."""
    for a, b in zip(ordered, ordered[1:]):
        if b.get("after_walk") and not a.get("after_walk"):
            a["next"] = None
        elif a["coords"] and b["coords"]:
            mi = miles(a["coords"], b["coords"]) * STREET_FACTOR
            a["next"] = {"miles": round(mi, 2), "minutes": max(1, round(mi / WALK_MPH * 60)), "mode": "drive" if mi > DRIVE_OVER_MILES else "walk"}
        elif a["neighborhood"] and a["neighborhood"] == b["neighborhood"]:
            a["next"] = {"same_neighborhood": True}
        else:
            a["next"] = {"unknown": True}
    if ordered:
        ordered[-1]["next"] = None


def build():
    things = json.loads(SRC.read_text())
    picked = [t for t in things if t.get("group") == "Shopping" and t.get("category") not in NOT_THRIFT
              and (kinds_of(t) or t.get("guide_kinds")) and not NOT_A_SHOP.search(t.get("name") or "")]
    ids = [t["id"] for t in picked]
    if len(ids) != len(set(ids)):
        sys.exit("duplicate ids: " + ", ".join(sorted({i for i in ids if ids.count(i) > 1})))
    every = [shop(t) for t in picked]
    inside = [s for s in every if s["neighborhood"] in ROUTE]
    placed = [s for s in inside if s["address"]]
    shops = walk_order([s for s in placed if not s.get("after_walk")]) + walk_order([s for s in placed if s.get("after_walk")])
    left_out = [{"id": s["id"], "name": s["name"], "why": "outside greater Burlington"} for s in every if s not in inside]
    left_out += [{"id": s["id"], "name": s["name"], "why": "no verified street address"} for s in inside if not s["address"]]
    legs(shops)
    gaps = {g: sum(1 for s in shops if g in s["gaps"]) for g in ("address", "coords", "hours", "website")}
    return {
        "_": "Built by scripts/build_vintage_shops.py from data/things.json (Shopping group: vintage, thrift, consignment and antique shops in greater Burlington). "
             "Walking order downtown, then a drive; used books last. Nothing here is typed by hand; a fact things.json lacks is listed in the shop's gaps. Add or fix a shop in things.json and rebuild.",
        "source": "data/things.json",
        "count": len(shops),
        "gaps": gaps,
        "left_out": left_out,
        "instagram": sorted({s["instagram"] for s in shops if s.get("instagram")} | set(MARKETS)),
        "shops": shops,
    }


def main():
    data = build()
    text = json.dumps(data, indent=1, ensure_ascii=False) + "\n"
    if "--check" in sys.argv:
        stale = not OUT.exists() or OUT.read_text() != text
        print("data/vintage-shops.json is " + ("stale: rebuild it" if stale else "current"))
        sys.exit(1 if stale else 0)
    OUT.write_text(text)
    print(f"wrote {OUT.relative_to(ROOT)}: {data['count']} shops; missing address {data['gaps']['address']}, "
          f"coordinates {data['gaps']['coords']}, hours {data['gaps']['hours']}, website {data['gaps']['website']}")
    for s in data["left_out"]:
        print(f"left out {s['name']}: {s['why']}")
    if data["count"] < 6:
        print("fewer than six shops: add more vintage, thrift or consignment shops to data/things.json")


if __name__ == "__main__":
    main()
