#!/usr/bin/env python3
"""Assemble data/small-bites.json from the roster plus scraped per-restaurant
menu files, and write the deals call list.

Inputs:
  data/small-bites-roster.json    (scripts/small_bites_roster.py)
  <menus dir>/<restaurant-id>.json  one file per roster row, produced by the
                                    menu scrape (see README "Small Bites")
  data/deals.json                 already-verified deals, cross-referenced

Per-restaurant menu file schema (what the scrape step must produce):
  {
    "id": "<roster id>",
    "menu_status": "ok" | "partial" | "unavailable",
    "menu_url": str | null,          # the URL the menu was read from
    "fetched": "YYYY-MM-DD",
    "menu_note": str | null,         # why partial/unavailable, seasonal notes
    "cuisine": [str],                # only when the roster's cuisine was empty
    "items": [{"name": str, "section": str|null, "price": number|null,
               "price_text": str|null, "desc": str|null, "diet": [str]}],
    "deals": [{"text": str, "source_url": str}]   # only deals the site states
  }
Prices are numbers only when the menu prints them — never guessed. diet uses:
vegetarian, vegan, gluten-free, gf-option, veg-option, dairy-free.

Usage:
    python3 scripts/build_small_bites.py --menus /path/to/menus
"""

import argparse
import datetime
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

DIET_VOCAB = {"vegetarian", "vegan", "gluten-free", "gf-option", "veg-option", "dairy-free"}
STATUSES = {"ok", "partial", "unavailable"}

# Days as deals.json spells them, for the call-list rendering.
DAY_LABEL = {"mon": "Mon", "tue": "Tue", "wed": "Wed", "thu": "Thu",
             "fri": "Fri", "sat": "Sat", "sun": "Sun"}


def load_menu(path, warnings):
    menu = json.loads(path.read_text())
    rid = menu.get("id")
    if menu.get("menu_status") not in STATUSES:
        warnings.append(f"{rid}: bad menu_status {menu.get('menu_status')!r}")
        menu["menu_status"] = "unavailable"
    items = []
    for it in menu.get("items") or []:
        price = it.get("price")
        if price is not None:
            if not isinstance(price, (int, float)) or not (0 < price <= 300):
                warnings.append(f"{rid}: suspect price {price!r} on {it.get('name')!r}")
                continue
        diet = [d for d in (it.get("diet") or []) if d in DIET_VOCAB]
        bad = set(it.get("diet") or []) - DIET_VOCAB
        if bad:
            warnings.append(f"{rid}: dropped diet tags {sorted(bad)} on {it.get('name')!r}")
        items.append({
            "name": (it.get("name") or "").strip(),
            "section": it.get("section"),
            "price": price,
            "price_text": it.get("price_text"),
            "desc": (it.get("desc") or None),
            "diet": diet,
        })
    menu["items"] = [i for i in items if i["name"]]
    if menu["menu_status"] != "unavailable" and not menu["items"]:
        menu["menu_status"] = "unavailable"
    return menu


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--menus", required=True, help="directory of per-restaurant menu JSON files")
    ap.add_argument("--out", default=str(ROOT / "data" / "small-bites.json"))
    ap.add_argument("--call-list", default=str(ROOT / "data" / "small-bites-call-list.md"))
    args = ap.parse_args()

    roster = json.loads((ROOT / "data" / "small-bites-roster.json").read_text())
    all_deals = json.loads((ROOT / "data" / "deals.json").read_text())["deals"]
    deals_by_rid = {}
    for d in all_deals:
        deals_by_rid.setdefault(d.get("restaurant_id"), []).append(d)

    menus_dir = pathlib.Path(args.menus)
    warnings = []
    restaurants = []
    missing = []

    for r in roster["restaurants"]:
        mpath = menus_dir / f"{r['id']}.json"
        if mpath.exists():
            menu = load_menu(mpath, warnings)
        else:
            missing.append(r["id"])
            menu = {"menu_status": "unavailable", "menu_url": None,
                    "fetched": None, "menu_note": "No scrape result.", "items": [], "deals": []}

        cuisine = r["cuisine"] or menu.get("cuisine") or []
        scraped_deals = [
            {"text": d["text"], "source_url": d.get("source_url"), "source": "menu/site"}
            for d in (menu.get("deals") or []) if d.get("text")
        ]
        verified = [
            {"text": d["title"],
             "days": [DAY_LABEL.get(x, x) for x in (d.get("days") or [])],
             "price_note": d.get("price_note"),
             "last_verified": d.get("last_verified"),
             "source": "deals.json"}
            for d in deals_by_rid.get(r["id"], [])
        ]

        restaurants.append({
            **{k: r[k] for k in ("id", "name", "category", "address", "coords",
                                 "dist_m", "walk_min", "price", "patio", "dietary",
                                 "website", "google_maps")},
            "cuisine": cuisine,
            "menu": {
                "status": menu["menu_status"],
                "url": menu.get("menu_url"),
                "fetched": menu.get("fetched"),
                "note": menu.get("menu_note"),
                "items": menu["items"],
            },
            "deals": scraped_deals + verified,
        })

    n_items = sum(len(r["menu"]["items"]) for r in restaurants)
    n_priced = sum(1 for r in restaurants for i in r["menu"]["items"] if i["price"] is not None)
    coverage = {
        "places": len(restaurants),
        "menus_ok": sum(1 for r in restaurants if r["menu"]["status"] == "ok"),
        "menus_partial": sum(1 for r in restaurants if r["menu"]["status"] == "partial"),
        "menus_unavailable": sum(1 for r in restaurants if r["menu"]["status"] == "unavailable"),
        "items": n_items,
        "priced_items": n_priced,
    }

    out = {
        "generated": datetime.date.today().isoformat(),
        "zone": roster["zone"],
        "coverage": coverage,
        "restaurants": restaurants,
    }
    pathlib.Path(args.out).write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")

    write_call_list(pathlib.Path(args.call_list), restaurants, out["generated"])

    print(f"coverage: {coverage}")
    if missing:
        print(f"MISSING menu files ({len(missing)}): {', '.join(missing)}")
    for w in warnings:
        print("warn:", w)


def write_call_list(path, restaurants, generated):
    """Deals almost never appear on menus, so most places need a phone call to
    confirm. Order the list by how likely a call is to pay off."""
    stale, likely, rest = [], [], []
    for r in restaurants:
        verified = [d for d in r["deals"] if d["source"] == "deals.json"]
        stated = [d for d in r["deals"] if d["source"] == "menu/site"]
        if verified:
            stale.append((r, verified))
        elif not stated and r["category"] in ("Bar & Nightlife", "Brewery & Cidery"):
            likely.append(r)
        elif not stated:
            rest.append(r)

    lines = [
        "# Small Bites — deals call list",
        "",
        f"Generated {generated}. Menus almost never print deals, so everything here",
        "needs a phone call to confirm. Ask: happy hour? daily specials? any",
        "standing food deal? Update data/deals.json with what you learn.",
        "",
        "## Re-verify — already in deals.json, confirm still true",
        "",
    ]
    for r, deals in sorted(stale, key=lambda x: min(d.get("last_verified") or "0000" for d in x[1])):
        lines.append(f"### {r['name']}")
        if r["website"]:
            lines.append(f"- {r['website']}")
        for d in deals:
            days = "/".join(d["days"]) if d["days"] else "days unknown"
            lines.append(f"- [ ] \"{d['text']}\" ({days}"
                         f"{', ' + d['price_note'] if d.get('price_note') else ''})"
                         f" — last verified {d.get('last_verified') or 'never'}")
        lines.append("")

    lines += ["## Likely to have deals — bars & breweries, nothing on file", ""]
    for r in likely:
        lines.append(f"- [ ] {r['name']}" + (f" — {r['website']}" if r["website"] else ""))

    lines += ["", "## Everyone else — quick ask while confirming the menu", ""]
    for r in rest:
        lines.append(f"- [ ] {r['name']}" + (f" — {r['website']}" if r["website"] else ""))
    lines.append("")

    path.write_text("\n".join(lines))


if __name__ == "__main__":
    main()
