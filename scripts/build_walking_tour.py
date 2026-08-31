#!/usr/bin/env python3
"""Regenerate walking-tour.html's stop list + sources from data.

Source of truth: out-loud/stories.json (the "downtown-loop" route and its
fact-checked pins) + data/walking-tour.json (the page's short written bodies,
directions and minutes). The HTML between the markers below is rewritten in
place; everything else on the page is left alone.

  python3 scripts/build_walking_tour.py                    # rebuild HTML from data
  python3 scripts/build_walking_tour.py --seed condensed.json   # one-time: write bodies into data/walking-tour.json first

Rule: a stop body may only say what its Out Loud script says (that's the
fact-checked text). If a script changes, re-condense and rerun.
"""
import argparse
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STORIES = ROOT / "out-loud" / "stories.json"
TOUR = ROOT / "data" / "walking-tour.json"
HTML = ROOT / "walking-tour.html"


def esc(s):
    return html.escape(str(s or ""), quote=True)


def seed(condensed_path):
    """Write the condensed bodies into data/walking-tour.json, keeping directions/minutes."""
    stories = json.loads(STORIES.read_text(encoding="utf-8"))
    route = next(r for r in stories["routes"] if r["id"] == "downtown-loop")
    cond = {s["id"]: s for s in json.loads(Path(condensed_path).read_text(encoding="utf-8"))["stops"]}
    old = json.loads(TOUR.read_text(encoding="utf-8")) if TOUR.exists() else {}
    old_stops = {s.get("n"): s for s in old.get("stops", [])}
    stops = []
    for i, step in enumerate(route["steps"], start=1):
        c = cond[step["pin"]]
        o = old_stops.get(i, {})
        stops.append({
            "n": i, "id": step["pin"], "title": c["title"], "location": c["location"],
            "lat": round(float(c["lat"]), 5), "lng": round(float(c["lng"]), 5),
            "body": c["body"].strip(),
            "directions": step.get("directions") or o.get("directions", ""),
            "minutes_to_next": step.get("minutes_to_next") if i < len(route["steps"]) else None,
        })
    out = {
        "name": old.get("name", "A Downtown Burlington Walking Tour"),
        "duration_note": old.get("duration_note", route.get("blurb", "")),
        "_note": "Bodies are condensed from the fact-checked Out Loud scripts (out-loud/stories.json). Rebuild the page with scripts/build_walking_tour.py.",
        "stops": stops,
    }
    TOUR.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"seeded {TOUR.relative_to(ROOT)} with {len(stops)} stops")


def render():
    tour = json.loads(TOUR.read_text(encoding="utf-8"))
    stories = json.loads(STORIES.read_text(encoding="utf-8"))
    pins = {p["id"]: p for p in stories["pins"]}
    stops = tour["stops"]
    n = len(stops)

    items = []
    for s in stops:
        last = s["n"] == n
        label = "Loop complete" if last else f"{s['minutes_to_next']} min to stop {s['n'] + 1}" if s.get("minutes_to_next") else f"To stop {s['n'] + 1}"
        items.append(f"""      <li class="tour-stop" id="stop-{s['n']}" data-stop="{s['n']}">
        <span class="tour-stop-number" aria-hidden="true">{s['n']}</span>
        <article class="tour-stop-card">
          <h2 class="tour-stop-title">{esc(s['title'])}</h2>
          <div class="tour-stop-meta"><p class="tour-location">{esc(s['location'])}</p><a class="tour-map-link" href="https://maps.google.com/?q={s['lat']:.5f},{s['lng']:.5f}" target="_blank" rel="noopener">Map ↗</a><a class="tour-listen-link" href="out-loud/?s={esc(s['id'])}">Listen · 2 min</a></div>
          <p class="tour-history">{esc(s['body'])}</p>
          <p class="tour-directions"><span class="tour-directions-label">{esc(label)}</span>{esc(s['directions'])}</p>
        </article>
      </li>""")
    route_html = '    <ol class="tour-route">\n' + "\n".join(items) + "\n    </ol>"

    # Sources: union of the pins' fetched sources, in stop order, de-duplicated by URL.
    seen, srcs = set(), []
    for s in stops:
        for src in pins.get(s["id"], {}).get("sources", []):
            u = src.get("url", "")
            if not u or u in seen or not re.match(r"^https?://", u):
                continue
            seen.add(u)
            srcs.append(f'        <li><a href="{esc(u)}" target="_blank" rel="noopener">{esc(src.get("label", u))}</a></li>')
    sources_html = '      <ol class="tour-sources-list">\n' + "\n".join(srcs) + "\n      </ol>"

    h = HTML.read_text(encoding="utf-8")
    h, c1 = re.subn(r'    <ol class="tour-route">.*?\n    </ol>', route_html, h, count=1, flags=re.S)
    h, c2 = re.subn(r'      <ol class="tour-sources-list">.*?\n      </ol>', sources_html, h, count=1, flags=re.S)
    h = re.sub(r'<span class="tour-fact">\d+ stops</span>', f'<span class="tour-fact">{n} stops</span>', h)
    h = re.sub(r'Stop 1 of \d+</p>', f'Stop 1 of {n}</p>', h)
    h = h.replace("A 1.7-mile, 14-stop walking tour", f"A 1.7-mile, {n}-stop walking tour").replace("Walk a 14-stop loop", f"Walk a {n}-stop loop")
    assert c1 == 1 and c2 == 1, (c1, c2)
    HTML.write_text(h, encoding="utf-8")
    print(f"rebuilt {HTML.name}: {n} stops, {len(srcs)} sources")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", help="condensed JSON to write into data/walking-tour.json first")
    a = ap.parse_args()
    if a.seed:
        seed(a.seed)
    render()


if __name__ == "__main__":
    main()
