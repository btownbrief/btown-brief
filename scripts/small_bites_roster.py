#!/usr/bin/env python3
"""Build the Small Bites roster: every open food-and-drink spot within a short
walk of a zone center, pulled from data/restaurants.json.

The roster is the scrape worklist for data/small-bites.json — one row per
restaurant with the website to fetch a menu from. Zones are declared in ZONES
so South Burlington city center and the Winooski circle can be added later
without touching the selection logic.

Usage:
    python3 scripts/small_bites_roster.py            # writes data/small-bites-roster.json
    python3 scripts/small_bites_roster.py --zone church-st
"""

import argparse
import datetime
import json
import math
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

ZONES = {
    "church-st": {
        "label": "Church Street Marketplace",
        # Church & College — mid-Marketplace.
        "center": [44.4785, -73.2129],
        "radius_m": 400,  # ~a 5-minute walk
    },
    # Later: "so-burlington-city-center", "winooski-circle"
}

# Same Google place listed twice in restaurants.json; keep the id that
# deals.json / things.json reference and drop the stray.
DUPLICATE_IDS = {
    "ben-jerry-s-ice-cream": "ben-jerrys-church-street",
    "folino-s-pizza-burlington": "folinos",
    "leunigs-french-bistro": "leunigs-bistro",
    "ruben-james": "rj-s",
}


def dist_m(center, coords):
    dlat = (coords[0] - center[0]) * 111320
    dlon = (coords[1] - center[1]) * 111320 * math.cos(math.radians(center[0]))
    return math.hypot(dlat, dlon)


def build(zone_id):
    zone = ZONES[zone_id]
    restaurants = json.loads((ROOT / "data" / "restaurants.json").read_text())["restaurants"]

    rows = []
    for r in restaurants:
        if r.get("closed") or not r.get("coords"):
            continue
        if r["id"] in DUPLICATE_IDS:
            continue
        m = dist_m(zone["center"], r["coords"])
        if m > zone["radius_m"]:
            continue
        rows.append({
            "id": r["id"],
            "name": r["name"],
            "category": r["category"],
            "cuisine": r.get("cuisine") or [],
            "address": r.get("address"),
            "coords": r["coords"],
            "dist_m": round(m),
            "walk_min": max(1, round(m / 80)),  # ~80 m per minute
            "price": r.get("price"),
            "patio": r.get("patio"),
            "dietary": r.get("dietary") or [],
            "website": (r.get("links") or {}).get("website"),
            "google_maps": (r.get("links") or {}).get("google_maps"),
        })

    rows.sort(key=lambda x: x["dist_m"])
    return {
        "generated": datetime.date.today().isoformat(),
        "zone": {"id": zone_id, **zone},
        "count": len(rows),
        "restaurants": rows,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zone", default="church-st", choices=ZONES)
    ap.add_argument("--out", default=str(ROOT / "data" / "small-bites-roster.json"))
    args = ap.parse_args()

    out = build(args.zone)
    pathlib.Path(args.out).write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"{out['count']} places within {ZONES[args.zone]['radius_m']}m -> {args.out}")


if __name__ == "__main__":
    main()
