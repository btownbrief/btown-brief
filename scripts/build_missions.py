#!/usr/bin/env python3
"""Build data/missions.json, the Top 100 as missions, for All Day's What Now tab.

The Top 100 in data/guides.json (id top-100) is a ranked list of one-off
things to do. A mission is the same entry made into an outing: a title, one
theme, a paragraph that strings the places together with the walk or drive
between them, and the places themselves (name, website, neighborhood) from
data/things.json.

Two kinds of input, kept apart on purpose:

- The FACTS come from the data, every run: which places an entry names, their
  websites and neighborhoods, and, for an entry that names a single place,
  its neighbors (the nearest places within a short walk, in the same
  neighborhood, festivals and market days left out). The walk or drive
  between two places is an estimate from their coordinates: straight-line
  distance times 1.3 for the street grid at 80 m a minute on foot, and past a
  half-hour walk, times 1.4 at 42 km/h plus three minutes to park. The
  coordinates in things.json are approximate, so a paragraph that quotes one
  of these minutes is always marked for a read.

- The WORDS live in scripts/missions_copy.json, one entry per rank, drafted
  from those facts and edited by hand: title, theme, paragraph, and `with`,
  the nearby places the paragraph pulls in (thing ids; when it is missing an
  entry that names one place gets the computed neighbors). A paragraph is
  never generated at build time, so the file only changes when someone
  changes the words.

The build checks every paragraph against the sources it was written from.
Style rules fail the build (60 to 120 words, no em or en dashes, no
exclamation points). Grounding is softer: a number, a number with its unit
("3 miles", "$25") or a capitalized word mid-sentence that appears nowhere in
the entry's guide text or its places' fields marks the mission needs_check,
with the reason, so Stephen reads it before it ships; a rewritten title is
checked the same way. A drafter can set needs_check too. The check is a net,
not a proof: a lowercase claim ("the patio fills fast") passes it, which is
why every paragraph was also read by a person against its sources.

If the Top 100 changes under the copy (an entry's title no longer matches
the one the paragraph was written for), the mission keeps the guide's own
words and is marked needs_check.

Run:  python3 scripts/build_missions.py            writes data/missions.json
      python3 scripts/build_missions.py --sources  prints the facts per entry
                                                   (what a drafter writes from)
      python3 scripts/build_missions.py --check FILE  checks a draft copy file
                                                   without writing anything
"""

from __future__ import annotations

import datetime as dt
import json
import math
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
GUIDES = ROOT / "data" / "guides.json"
THINGS = ROOT / "data" / "things.json"
COPY = ROOT / "scripts" / "missions_copy.json"
OUT = ROOT / "data" / "missions.json"

THEMES = ["eat", "drink", "outdoors", "water", "culture", "play", "family", "winter", "free"]
NEAR_M = 800          # a neighbor is within this, as the crow flies
NEIGHBORS = 2         # added to an entry that names one place
WORDS = (60, 120)

# words a paragraph may capitalize without the sources spelling them out
COMMON = {"Burlington", "Vermont", "Vermont's", "Lake", "Champlain", "I"}
NUMBER_WORDS = {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
                "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "twenty": 20, "thirty": 30,
                "forty": 40, "fifty": 50, "hundred": 100}


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# ------------------------------------------------------------------ facts
def metres(a: list, b: list) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


def leg(a: dict, b: dict) -> dict | None:
    if not (a.get("coords") and b.get("coords")):
        return None
    m = metres(a["coords"], b["coords"])
    walk = m * 1.3 / 80
    if walk <= 30:
        mins = max(1, round(walk)) if walk < 10 else 5 * round(walk / 5)
        return {"from": a["id"], "to": b["id"], "km": round(m / 1000, 1), "mode": "walk", "min": mins}
    drive = m * 1.4 / 700 + 3
    return {"from": a["id"], "to": b["id"], "km": round(m / 1000, 1), "mode": "drive", "min": 5 * max(1, round(drive / 5))}


def is_event(t: dict) -> bool:
    """A festival, a market day or a summer series: a date, not a place to walk to."""
    return t.get("group") == "Live & Events" and t.get("category") == "Activity & Experience"


def neighbors(anchor: dict, things: list) -> list:
    """The nearest places within a short walk, a different kind of place first."""
    if not anchor.get("coords"):
        return []
    near = []
    for t in things:
        if t["id"] == anchor["id"] or not t.get("coords") or is_event(t):
            continue
        # the coordinates are approximate, so the neighborhood has to agree too
        if t.get("neighborhood") != anchor.get("neighborhood"):
            continue
        d = metres(anchor["coords"], t["coords"])
        if d <= NEAR_M:
            near.append((t.get("category") == anchor.get("category"), d, t))
    near.sort(key=lambda x: (x[0], x[1]))
    return [t for _, _, t in near[:NEIGHBORS]]


def candidates(listed: list, things: list) -> list:
    """Places a drafter may pull in: the same neighborhood as a listed place,
    nearest first where both have coordinates. "Greater Burlington" is the
    catch-all for everything out of town, so it offers nothing."""
    ids = {p["id"] for p in listed}
    hoods = {p.get("neighborhood") for p in listed} - {None, "", "Greater Burlington"}
    out = [t for t in things if t["id"] not in ids and t.get("neighborhood") in hoods and not is_event(t)]
    def dist(t):
        ds = [metres(p["coords"], t["coords"]) for p in listed if p.get("coords") and t.get("coords")]
        return min(ds) if ds else 1e9
    return sorted(out, key=dist)[:8]


def route(places: list) -> list:
    """The listed places in the guide's order; neighbors walked nearest-first."""
    listed = [p for p in places if p["_role"] == "listed"]
    rest = [p for p in places if p["_role"] == "nearby"]
    out = listed[:]
    while rest:
        here = out[-1]
        if not here.get("coords") or not all(p.get("coords") for p in rest):
            out += rest
            break
        rest.sort(key=lambda p: metres(here["coords"], p["coords"]))
        out.append(rest.pop(0))
    return out


def facts(things_by_id: dict, things: list, entry: dict, chosen: list | None = None) -> dict:
    """`chosen` is the copy's own pick of nearby places (its `with` list);
    without one, an entry that names one place gets its computed neighbors."""
    places = [dict(things_by_id[i], _role="listed") for i in entry["things"] if i in things_by_id]
    if chosen is not None:
        places += [dict(things_by_id[i], _role="nearby") for i in chosen if i in things_by_id and i not in entry["things"]]
    elif len(places) == 1:
        places += [dict(t, _role="nearby") for t in neighbors(places[0], things)]
    places = route(places)
    legs = [l for l in (leg(a, b) for a, b in zip(places, places[1:])) if l]
    return {"places": places, "legs": legs}


# -------------------------------------------------------------- checking
def source_text(entry: dict, f: dict) -> str:
    bits = [entry["title"], entry["body"]]
    for p in f["places"]:
        bits += [p.get(k) or "" for k in ("name", "neighborhood", "category", "cost_note", "blurb", "why_special", "address")]
        bits += p.get("good_for") or []
        bits += p.get("vibe") or []
        bits += p.get("season") or []
        bits += p.get("time_of_day") or []
    return "\n".join(bits)


def numbers_in(text: str) -> set:
    out = {n.replace(",", "") for n in re.findall(r"\d[\d,]*(?:\.\d+)?", text)}
    for w, n in NUMBER_WORDS.items():
        if re.search(r"\b" + w + r"\b", text, re.I):
            out.add(str(n))
    return out


UNITS = r"(miles?|feet|foot|acres?|hours?|years?|percent|%)"


def measures(text: str) -> set:
    """Each number with its unit ("3 mile", "38 foot", "$25"), so a price
    cannot ground a distance. Number words become digits, plurals singular."""
    words = "|".join(NUMBER_WORDS)
    out = set()
    # a range is both ends: "$20–30" and "$20 to $30" say the same thing
    for m in re.finditer(r"\$\s?(\d[\d,]*(?:\.\d+)?)(?:\s*(?:[-\u2013\u2014]|to)\s*\$?(\d[\d,]*(?:\.\d+)?))?", text):
        out.update("$" + g.replace(",", "") for g in m.groups() if g)
    for m in re.finditer(r"(?<![\w-])(\d[\d,]*(?:\.\d+)?|" + words + r")(?:\+|-plus)?[ -]" + UNITS + r"(?![\w])", text, re.I):
        n = m.group(1).lower().replace(",", "")
        n = str(NUMBER_WORDS.get(n, n))
        unit = m.group(2).lower()
        unit = {"feet": "foot", "%": "percent"}.get(unit, unit)
        out.add(n + " " + unit.rstrip("s") if unit not in ("percent",) else n + " percent")
    return out


def grounding(paragraph: str, src: str, legs: list) -> list:
    """Reasons a paragraph may say something its sources do not."""
    why = []
    have = numbers_in(src)
    # a walk or drive time is checked as a phrase: "7" in a price does not
    # ground "7 minutes on foot"
    said = set()
    for m in re.finditer(r"\b(\d+|" + "|".join(NUMBER_WORDS) + r")[ -](?:minutes?|mins?)\b", paragraph, re.I):
        n = m.group(1).lower()
        n = str(NUMBER_WORDS.get(n, n))
        said.add(n)
        if not re.search(r"\b" + re.escape(m.group(1)) + r"[ -](?:minutes?|mins?)\b", src, re.I):
            est = n in {str(l["min"]) for l in legs}
            why.append("the " + n + " minutes is " + ("estimated from approximate coordinates" if est else "not in the sources"))
    for n in sorted(numbers_in(paragraph) - have - said, key=lambda s: float(s)):
        why.append("the number " + n + " is not in the sources")
    for x in sorted(measures(paragraph) - measures(src)):
        if not x.endswith(" minute"):
            why.append("“" + x + "” is not in the sources as written")
    for sentence in re.split(r"(?<=[.?:;])\s+", paragraph):
        tokens = re.findall(r"[A-Za-z][\w'’&.-]*", sentence)
        for tok in tokens[1:]:
            word = tok.rstrip(".'’").replace("’", "'")
            if not word[:1].isupper() or word in COMMON:
                continue
            base = re.sub(r"'s$", "", word)
            if base not in src.replace("’", "'"):
                why.append("“" + base + "” is not in the sources")
    return sorted(set(why))


def style(n: int, paragraph: str) -> list:
    bad = []
    count = len(paragraph.split())
    if not WORDS[0] <= count <= WORDS[1]:
        bad.append("%d: %d words (60 to 120)" % (n, count))
    if re.search(r"[—–]|\s--\s", paragraph):
        bad.append("%d: a dash" % n)
    if "!" in paragraph:
        bad.append("%d: an exclamation point" % n)
    return bad


# ----------------------------------------------------------------- build
def load():
    guides = json.loads(GUIDES.read_text(encoding="utf-8"))
    top = next(g for g in guides if g.get("id") == "top-100")
    things = json.loads(THINGS.read_text(encoding="utf-8"))
    return top["items"], things, {t["id"]: t for t in things}


def place_out(p: dict) -> dict:
    url = p.get("website") or ""
    return {"id": p["id"], "name": p["name"], "url": url if re.match(r"^https?://", url) else "",
            "neighborhood": p.get("neighborhood") or "", "nearby": p["_role"] == "nearby"}


def sources() -> int:
    items, things, by_id = load()
    out = []
    for n, e in enumerate(items, 1):
        f = facts(by_id, things, e)
        out.append({
            "n": n, "top100_title": e["title"], "top100_body": e["body"],
            "places": [{k: p.get(k) for k in ("id", "name", "neighborhood", "category", "cost_tier", "cost_note", "season",
                                              "time_of_day", "indoor_outdoor", "blurb", "why_special", "address")} | {"role": p["_role"]}
                       for p in f["places"]],
            "legs": [dict(l, from_name=by_id[l["from"]]["name"], to_name=by_id[l["to"]]["name"]) for l in f["legs"]],
            "candidates": [{k: t.get(k) for k in ("id", "name", "neighborhood", "category", "address", "blurb")}
                           for t in candidates([p for p in f["places"] if p["_role"] == "listed"], things)],
        })
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
    print()
    return 0


def main() -> int:
    if "--sources" in sys.argv:
        return sources()
    check = sys.argv[sys.argv.index("--check") + 1] if "--check" in sys.argv else None
    items, things, by_id = load()
    copy = json.loads(pathlib.Path(check or COPY).read_text(encoding="utf-8")) if check or COPY.exists() else {}
    missions, errors = [], []
    for n, e in enumerate(items, 1):
        if check and str(n) not in copy:
            continue
        c = copy.get(str(n)) or {}
        chosen = c.get("with") if isinstance(c.get("with"), list) else None
        errors += ["%d: no place %r in things.json" % (n, i) for i in (chosen or []) if i not in by_id]
        f = facts(by_id, things, e, chosen)
        note = []
        if c and c.get("source") == e["title"] and c.get("paragraph"):
            title, para, theme = c.get("title") or e["title"], c["paragraph"].strip(), c.get("theme")
            errors += style(n, para)
            note += grounding(para, source_text(e, f), f["legs"])
            note += ["title: " + x for x in grounding(title, source_text(e, f), f["legs"]) if title != e["title"]]
            if c.get("needs_check"):
                note.insert(0, c.get("check_note") or "the drafter asked for a read")
        else:
            title, para, theme = e["title"], e["body"], c.get("theme")
            note.append("no paragraph written for this entry yet" if not c else "the Top 100 entry changed since this was written")
        if theme not in THEMES:
            errors.append("%d: theme %r is not one of %s" % (n, theme, ", ".join(THEMES)))
        missions.append({
            "n": n, "k": "m" + str(n), "title": title, "theme": theme, "paragraph": para,
            "needs_check": bool(note), **({"check_note": "; ".join(note)} if note else {}),
            "places": [place_out(p) for p in f["places"]],
            "legs": f["legs"],
            "top100": e["title"],
        })
    if check:
        for m in missions:
            if m.get("check_note"):
                log("  %d: %s" % (m["n"], m["check_note"]))
        for x in errors:
            log("  " + x)
        log("%d checked, %d style problems, %d need a read" % (len(missions), len(errors), sum(m["needs_check"] for m in missions)))
        return 1 if errors else 0
    if errors:
        for x in errors:
            log("  " + x)
        log("%d style problems; nothing written" % len(errors))
        return 1
    doc = {
        "generated": dt.date.today().isoformat(),
        "source": "data/guides.json (top-100) and data/things.json; words from scripts/missions_copy.json",
        "themes": THEMES,
        "count": len(missions),
        "needs_check": sum(m["needs_check"] for m in missions),
        "missions": missions,
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    log("wrote %s: %d missions, %d need a read" % (OUT.relative_to(ROOT), len(missions), doc["needs_check"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
