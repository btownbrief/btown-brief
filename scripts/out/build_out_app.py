#!/usr/bin/env python3
"""Slim copies of the Out data lane's files for the Out app's tabs (wave 1, 2026-10-29).

The lane's files are built for research and checking: events-lanes.json is 1.8 MB with
every rule's reason, history-seed.json carries verbatim evidence, Out Loud's stories.json
carries whole audio scripts. A phone only needs what a card shows, so this writes:

  data/out/app-events.json  the next 14 days of events: title, when, venue, cost, link, lanes, own
  data/out/app-then.json    Church Street by address: what is there now, what was there, the source
  data/out/app-walks.json   Out Loud's audio pins without their scripts, plus the walking tour's stops

Plain file reads, no network, no AI calls. Run after scripts/out/lanes.py:

  python3 scripts/out/lanes.py && python3 scripts/out/build_out_app.py
"""
import json
import re
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "out"
DAYS = 14

SOURCES = {
    "sevendays": "Seven Days", "uvm": "UVM", "loveburlington": "Love Burlington", "helloburlington": "Hello Burlington",
    "fletcherfree": "Fletcher Free Library", "brownell": "Brownell Library", "sblibrary": "South Burlington Library",
    "breweries": "Brewery calendars", "parksrec": "Burlington Parks", "champlainvalley": "Champlain Valley",
    "churchst": "Church Street Marketplace", "vcc": "Vermont Comedy Club", "meetup": "Meetup", "winooskilibrary": "Winooski Library",
    "monkeyhouse": "Monkey House", "sbrec": "South Burlington Rec", "flynn": "The Flynn", "generator": "Generator", "bca": "BCA",
    "instagram": "Instagram", "farmersmarket": "Farmers market",
}
ONLINE = re.compile(r"\b(online|virtual|zoom|livestream|live stream|webinar)\b", re.I)


def events():
    src = json.loads((OUT / "events-lanes.json").read_text())
    today = date.fromisoformat(src["today"])
    last = (today + timedelta(days=DAYS)).isoformat()
    rows = []
    for e in src["events"]:
        if e["date"] > last or not e.get("url"):
            continue  # every event ships with a URL
        where = " ".join(filter(None, [e.get("title"), e.get("venue")]))
        rows.append({
            "id": e["id"], "title": e["title"], "start": e["start"], "end": e.get("end"), "date": e["date"],
            "allDay": bool(e.get("allDay")), "until": e.get("ongoingUntil"),
            "venue": e.get("venue"), "town": e.get("town"), "price": e.get("price"), "free": e.get("free"),
            "url": e["url"], "src": SOURCES.get(e.get("source"), e.get("source") or ""),
            "lanes": e.get("lanes") or [], "own": bool(e.get("own")), "online": bool(ONLINE.search(where)),
        })
    rows.sort(key=lambda r: (r["start"] or r["date"], r["title"]))
    return {"generated": src["generated"], "today": src["today"], "lanes": src["lanes"], "events": rows}


def number(address):
    m = re.match(r"\s*(\d+)", address or "")
    return int(m.group(1)) if m else 10_000


def then():
    src = json.loads((OUT / "history-seed.json").read_text())
    geo = OUT / "then-coords.json"  # scripts/out/geocode_then.py: exact house-number matches from OpenStreetMap
    pins = json.loads(geo.read_text())["coords"] if geo.exists() else {}
    places = []
    for p in src["places"]:
        tl = [{"from": t.get("from"), "to": t.get("to"), "what": t.get("what"), "url": t.get("source_url"), "label": t.get("source_label")}
              for t in p.get("timeline") or [] if str(t.get("source_url") or "").startswith("https://") and t.get("what")]
        if not tl:
            continue
        tl.sort(key=lambda t: str(t["from"] or ""))
        places.append({
            "id": p["id"], "kind": p.get("kind"), "address": p.get("address"),
            "now": (p.get("now") or {}).get("name") if isinstance(p.get("now"), dict) else p.get("now"),
            "lat": p.get("lat") or pins.get(p["id"], {}).get("lat"), "lng": p.get("lng") or pins.get(p["id"], {}).get("lng"), "n": number(p.get("address")), "timeline": tl,
            "photos": len(p.get("photos") or []),  # counted, never hotlinked: the photos belong to their archives
        })
    places.sort(key=lambda p: (p["kind"] == "block", p["n"], p["address"] or ""))
    return {"generated": src["generated"], "about": "Church Street, address by address. Built from data/out/history-seed.json.", "places": places}


def walks():
    stories = json.loads((ROOT / "out-loud" / "stories.json").read_text())
    tour = json.loads((ROOT / "data" / "walking-tour.json").read_text())
    pins = [{"id": p["id"], "title": p["title"], "tease": p.get("tease"), "hood": p.get("hood"), "lat": p.get("lat"), "lng": p.get("lng"),
             "audio": p.get("audio"), "secs": p.get("duration_s")}
            for p in stories["pins"] if p.get("enabled") is not False]
    stops = [{"n": s["n"], "id": s["id"], "title": s["title"], "location": s.get("location")} for s in tour["stops"]]
    routes = [{"id": r["id"], "title": r["title"], "blurb": r.get("blurb"), "pins": [s["pin"] for s in r.get("steps") or []]} for r in stories.get("routes") or []]
    return {"generated": stories.get("updated"), "tour": {"name": tour["name"], "duration": tour.get("duration_note"), "stops": stops},
            "routes": routes, "pins": pins}


def write(name, data):
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(name, (OUT / name).stat().st_size, "bytes")


if __name__ == "__main__":
    write("app-events.json", events())
    write("app-then.json", then())
    write("app-walks.json", walks())
