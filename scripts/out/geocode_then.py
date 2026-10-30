#!/usr/bin/env python3
"""Coordinates for the history seed's street addresses, for Explore's map (2026-10-29).

The seed (data/out/history-seed.json) pins only 10 of its 87 places. This asks
OpenStreetMap's Nominatim, one address a second as its usage policy asks, and keeps
a point only when OSM matched the house number and the street, in Burlington. For a
range ("150-156 Church St") the first number stands for the building. Answers already
in then-coords.json are reused, never asked again (Nominatim's policy is to cache).
Corners and blocks are left as they are. Writes data/out/then-coords.json, which
scripts/out/build_out_app.py folds into app-then.json. Run it again only when the
seed gains addresses; the answers do not change.
"""
import json, re, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "data" / "out" / "history-seed.json"
OUT = ROOT / "data" / "out" / "then-coords.json"
UA = "BtownBrief-OutApp/1.0 (btownbrief@gmail.com)"

def lookup(num, street):
    q = urllib.parse.urlencode({"street": f"{num} {street}", "city": "Burlington", "state": "Vermont", "countrycodes": "us",
                                "viewbox": "-73.28,44.52,-73.17,44.44", "bounded": 1, "format": "json", "addressdetails": 1, "limit": 1})
    req = urllib.request.Request("https://nominatim.openstreetmap.org/search?" + q, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        hits = json.load(r)
    if not hits:
        return None
    h = hits[0]
    a = h.get("address", {})
    if str(a.get("house_number", "")).split(";")[0].strip() != str(num):
        return None
    if street.split()[0].lower() not in str(a.get("road", "")).lower():
        return None
    return {"lat": round(float(h["lat"]), 6), "lng": round(float(h["lon"]), 6), "osm": f"{h['osm_type']}/{h['osm_id']}"}

out = json.loads(OUT.read_text())["coords"] if OUT.exists() else {}
for p in json.loads(SEED.read_text())["places"]:
    if p["id"] in out:
        continue
    m = re.match(r"\s*(\d+)(?:\s*(?:-|to|and|&)\s*\d+)?\s+(.+?)(?:\s*\(.*)?$", p.get("address") or "")
    if not m or p.get("lat"):
        continue
    street = re.sub(r"\bSt\b\.?", "Street", m.group(2)).strip()
    try:
        hit = lookup(m.group(1), street)
    except OSError as e:  # one failed lookup is skipped, not the whole run
        print(p["id"], "failed:", e)
        hit = None
    time.sleep(1.1)
    if hit:
        out[p["id"]] = hit
    print(p["id"], p["address"], "->", hit)
OUT.write_text(json.dumps({"generated": time.strftime("%Y-%m-%d"), "source": "OpenStreetMap Nominatim: house number and street matched in Burlington; a range is pinned at its first number",
                           "coords": out}, indent=1) + "\n")
print(len(out), "pinned")
