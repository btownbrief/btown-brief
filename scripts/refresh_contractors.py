#!/usr/bin/env python3
"""Refresh the licensed-trades backbone of the contractors directory.

Pulls Vermont DFS licensing data (open ODbL dataset on data.vermont.gov,
no key needed) for the core Chittenden County towns and writes the
license-holder backbone into data/contractors.json, preserving any
hand-curated entries already in the file.

Only name / city / license number / expiration / level are kept — the
dataset's street addresses are often home addresses, so they stay out.
"""

import json
import os
import urllib.parse
import urllib.request
from datetime import date, datetime

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "data", "contractors.json")
API = "https://data.vermont.gov/resource/cy8e-89cz.json"
TOWNS = ("BURLINGTON", "SOUTH BURLINGTON", "ESSEX", "ESSEX JUNCTION",
         "COLCHESTER", "WINOOSKI", "WILLISTON", "SHELBURNE")
TRADES = {
    "Electrician": ("electricians", "Electricians"),
    "Plumber": ("plumbers", "Plumbers"),
    "Gas Installer": ("gas", "Gas installers"),
}
UA = "btown-brief-site/1.0 (contractors refresh)"


def fetch():
    towns = ",".join("'%s'" % t for t in TOWNS)
    q = {"$where": "city in(%s)" % towns, "$limit": "5000"}
    url = API + "?" + urllib.parse.urlencode(q)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main():
    rows = fetch()
    today = date.today().isoformat()
    trades = {slug: {"id": slug, "title": title, "pros": []}
              for slug, title in TRADES.values()}

    for r in rows:
        t = TRADES.get(r.get("type_desc"))
        if not t:
            continue
        # Electricians/plumbers: master-level only — the strongest signal,
        # and journeymen usually work under a master's business. Gas
        # installers have fuel-type levels instead, so all of those stay.
        if r["type_desc"] in ("Electrician", "Plumber") and r.get("level_desc") != "Master":
            continue
        level = r.get("level_desc", "")
        exp = (r.get("license_exp_date") or "")[:10]
        if exp and exp < today:
            continue  # lapsed
        name = "%s %s" % (r.get("first_name", "").title(), r.get("last_name", "").title())
        trades[t[0]]["pros"].append({
            "name": name.strip(),
            "city": r.get("city", "").title().replace("South Burlington", "South Burlington"),
            "license": r.get("license_number", ""),
            "level": level,
            "expires": exp,
        })

    for t in trades.values():
        t["pros"].sort(key=lambda p: (p["city"], p["name"]))

    # keep hand-curated entries (vetted: true) if the file already has them
    curated = []
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT))
            curated = old.get("curated", [])
        except Exception:
            pass

    json.dump({
        "generated": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source": "Vermont DFS Licensing MasterList (data.vermont.gov, ODbL) — master-level, unexpired, core Chittenden towns",
        "curated": curated,
        "trades": list(trades.values()),
    }, open(OUT, "w"), indent=1)
    print("wrote %s: %s" % (OUT, ", ".join(
        "%d %s" % (len(t["pros"]), t["id"]) for t in trades.values())))


if __name__ == "__main__":
    main()
