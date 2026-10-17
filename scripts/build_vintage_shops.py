#!/usr/bin/env python3
"""Build data/vintage-shops.json, the Vintage tab's shop guide, from
data/things.json.

Which places: things.json entries in the Shopping group whose category,
name or blurb says they are a vintage, thrift, consignment, antique or
record shop. A shopping street ("Pine Street (South End Shopping)") is not
a shop and is left out. Nothing is added by hand: a shop that is not in
things.json is not in the guide, so the way to add one is to add it there.

What each shop carries: name, neighborhood, address, website, coordinates
and hours exactly as things.json has them, and a one-line blurb, which is
the first sentence of the entry's own blurb. Hours come only from the
entry's `hours`, day by day, and only when the entry also has `checked`:
the date someone read them and the page they were read from, the shop's
own site wherever it publishes them:

    "hours": {"mon": null, "tue": "11:00-18:00", ..., "sun": "12:00-17:00"},
    "checked": {"date": "2026-10-17", "source": "https://...", "note": "..."}

A day set to null is a closed day; `hours_note` carries what a
shop says beside its hours ("Show nights run late"). An entry with no `hours` has none
published, and the tab says to call ahead. Nothing is guessed. Every
missing fact is listed in the shop's `gaps`, so the tab can say "hours not
checked yet" instead of leaving a hole, and Stephen can see what to fill.

The order is a walk: downtown first, then the South End along Pine Street,
the Old North End, Winooski, and Essex last (a drive). Within a
neighborhood, shops with coordinates go nearest-first from the previous
stop. Between two shops that both have coordinates the file carries the
walk (straight-line distance times 1.3 for the street grid, at 3 mph);
where either end has none, the leg says so rather than guessing.

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

# The walk, neighborhood by neighborhood. Anything not listed goes last.
ROUTE = ["Downtown / Church St", "Waterfront", "South End", "Hill Section", "Old North End",
         "New North End", "Winooski", "South Burlington", "Shelburne", "Colchester", "Essex / Essex Jct"]

HOURS = re.compile(r"\bOpen ([^.]*?\b(daily|weekdays|weekends|mon|tue|wed|thu|fri|sat|sun)[^.]*)\.", re.I)
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DAY_LABEL = dict(zip(DAYS, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]))
SPAN = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$")
CHURCH_ST = [44.4759, -73.2121]
WALK_MPH = 3.0
STREET_FACTOR = 1.3
DRIVE_OVER_MILES = 2.0


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
    hours, checked = t.get("hours"), t.get("checked")
    if not hours:
        return None
    if not (isinstance(checked, dict) and checked.get("date") and checked.get("source")):
        sys.exit(f"{t['id']}: hours without checked.date and checked.source")
    if not isinstance(hours, dict) or sorted(hours) != sorted(DAYS):
        sys.exit(f"{t['id']}: hours must give all seven days, mon to sun (null for closed)")
    for d in DAYS:
        if hours[d] is not None and not SPAN.match(hours[d]):
            sys.exit(f"{t['id']}: {d} hours {hours[d]!r} are not HH:MM-HH:MM")
    return {d: hours[d] for d in DAYS}


def hours_line(week):
    """Mon to Sun grouped into runs: "Tue–Sat 11am to 6pm · Sun noon to 5pm · closed Mon"."""
    if not week:
        return None

    def say(span):
        m = SPAN.match(span)
        return clock(m[1], m[2]) + " to " + clock(m[3], m[4])

    runs = []                                   # [first day, last day, span or None]
    for d in DAYS:
        if runs and runs[-1][2] == week[d]:
            runs[-1][1] = d
        else:
            runs.append([d, d, week[d]])
    if not any(span for _, _, span in runs):
        return None
    if len(runs) == 1:
        return "Daily " + say(runs[0][2])
    parts = [(DAY_LABEL[a] if a == b else DAY_LABEL[a] + "–" + DAY_LABEL[b]) + " " + say(span) for a, b, span in runs if span]
    closed = [DAY_LABEL[d] for d in DAYS if week[d] is None]
    if closed:
        parts.append("closed " + ", ".join(closed))
    return " · ".join(parts)


def shop(t):
    ks = kinds_of(t)
    coords = t.get("coords")
    coords = coords if isinstance(coords, list) and len(coords) == 2 and all(isinstance(c, (int, float)) for c in coords) else None
    week = week_of(t)
    checked = t.get("checked") if isinstance(t.get("checked"), dict) else None
    out = {
        "id": t["id"],
        "name": t["name"],
        "kinds": [KIND_LABEL[k] for k in ks],
        "neighborhood": t.get("neighborhood") or None,
        "address": t.get("address") or None,
        "website": t.get("website") or None,
        "coords": coords,
        "hours": hours_line(week),
        "week": week,
        "hours_note": (t.get("hours_note") or None) if week else None,
        "phone": t.get("phone") or None,
        "blurb": first_sentence(t.get("blurb")),
        "verified": (checked or {}).get("date") or t.get("last_verified") or None,
        "checked": checked,
    }
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
    """The way from each shop to the next one."""
    for a, b in zip(ordered, ordered[1:]):
        if a["coords"] and b["coords"]:
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
    picked = [t for t in things if t.get("group") == "Shopping" and kinds_of(t) and not NOT_A_SHOP.search(t.get("name") or "")]
    shops = walk_order([shop(t) for t in picked])
    legs(shops)
    gaps = {g: sum(1 for s in shops if g in s["gaps"]) for g in ("address", "coords", "hours", "website")}
    return {
        "_": "Built by scripts/build_vintage_shops.py from data/things.json (Shopping group: vintage, thrift, consignment, antique and record shops). "
             "Walking order. Nothing here is typed by hand; a fact things.json lacks is listed in the shop's gaps. Add or fix a shop in things.json and rebuild.",
        "source": "data/things.json",
        "count": len(shops),
        "gaps": gaps,
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
    if data["count"] < 6:
        print("fewer than six shops: add more vintage, thrift or record shops to data/things.json")


if __name__ == "__main__":
    main()
