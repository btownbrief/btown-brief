#!/usr/bin/env python3
"""Build all-day/data/whatnow.json — the payload behind the What Now tab.

data/events/events.json is 1.7 MB and does not belong in a phone app that has
to answer one question quickly, so this writes a compact slice: the next ten
days, the fields a card actually renders, and nothing else. Roughly 60 KB.

It reads events.json and NOT events.jsonl. The .jsonl beside it is the
NEWSLETTER schema — it carries `cost` as prose and `time` as "8 PM", and has
no `start`, no `free` and no `allDay`. Building from it silently produced a
payload where every event was date-only and nothing was free, which is exactly
the kind of wrong that renders fine.

The BUCKETING IS NOT DONE HERE. "Right now", "tonight" and "this weekend"
depend on the hour you open the app, and a file rebuilt once a morning cannot
know that — a payload that said "tonight" would be wrong by dinner. The tab
does the bucketing client-side against the same list.

What it keeps per event, and why:
FIELD NAMES ARE THE ENGINE'S, NOT SHORTHAND. The What Now decision engine
was ported from the standalone app verbatim and reads events by their real
names — start, end, venue, town, lat, lng, tags, indoorOutdoor, minPrice,
recurring, status. Renaming them to save bytes would mean adapting the engine,
and the engine is the thing that must not be touched. So this writes a
narrower events.json, not a different shape.

Kept per event: the 18 fields the engine actually reads, plus the artist and
image signals the venue sources now carry.

It also writes all-day/data/calendar.json, the small file behind The Calendar
block on What Now and People: the next three weeks as per-day, per-category
counts, and the best few events of the next three days with their photos. It
counts what events.html lists (active, not the long-running exhibits), so a
number tapped in the app is the number the calendar opens on. Today's "still
on" rule moves with the clock, so the file carries when each event ends for
the near days and the page takes off what has finished.

Run: python3 scripts/build_whatnow.py
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import re
import sys
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "events" / "events.json"
OUT = ROOT / "all-day" / "data" / "whatnow.json"
CAL_OUT = ROOT / "all-day" / "data" / "calendar.json"

DAYS = 10
CAP = 700          # a hard ceiling so a bad merge cannot ship a 2 MB payload

TZ = ZoneInfo("America/New_York")
CAL_DAYS = 21      # the block counts 14; the spare week outlasts a missed build
CAL_ENDS = 3       # days that carry end times, and picks
CAL_PICKS = 24     # picks kept per day, best first
UNDONE = re.compile(r"^\s*(cancel+ed|postponed)\b", re.I)
BIG_NIGHT = {"music", "comedy", "theater", "film", "sports", "market", "food-drink"}


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def listed(e: dict) -> bool:
    """What events.html lists: active, dated, not a long-running exhibit."""
    return (e.get("status") == "active" and bool(e.get("start")) and bool(e.get("date"))
            and "ongoing" not in (e.get("tags") or []))


def ends_at(e: dict) -> int | None:
    """When events.html stops listing it, in epoch seconds; None for all day."""
    if e.get("allDay"):
        return None
    start = dt.datetime.fromisoformat(e["start"])
    end = dt.datetime.fromisoformat(e["end"]) if e.get("end") else None
    if end is None or end <= start:
        end = start + dt.timedelta(hours=2)
    return int(end.timestamp())


def worth(e: dict) -> int:
    """How much a night's list wants this one: his own first, then what
    Seven Days picked, then one-off shows over the weekly regulars."""
    sig = e.get("signals") or {}
    tags = e.get("tags") or []
    score = 0
    if sig.get("own_group"):
        score += 100
    if sig.get("staff_pick"):
        score += 60
    if sig.get("image"):
        score += 12
    if "main-stage" in tags:
        score += 10
    if "series" not in tags:
        score += 25
    if e.get("category") in BIG_NIGHT:
        score += 6
    if dt.datetime.fromisoformat(e["start"]).astimezone(TZ).hour >= 17:
        score += 8
    if e.get("town") == "Burlington":
        score += 3
    if e.get("source") == "uvm" and not sig.get("staff_pick"):
        score -= 15        # campus intramurals and seminars, listed but not a night out
    return score


def calendar_payload(events: list, now: dt.datetime) -> dict:
    """The Calendar block's file. Past days are left out; days with nothing
    on still appear, so the page never has to guess at a gap."""
    today = now.astimezone(TZ).date()
    keys = [(today + dt.timedelta(days=i)).isoformat() for i in range(CAL_DAYS)]
    near = set(keys[:CAL_ENDS])
    days = {k: {"date": k, "cats": {}} for k in keys}
    pool = {k: [] for k in near}
    for e in events:
        if not listed(e) or e["date"] not in days:
            continue
        day = days[e["date"]]
        cat = e.get("category") or "other"
        day["cats"][cat] = day["cats"].get(cat, 0) + 1
        if e["date"] not in near:
            continue
        end = ends_at(e)
        if end is not None:
            day.setdefault("ends", {}).setdefault(cat, []).append(end)
            title = (e.get("title") or "").strip()
            if title and e.get("url") and not UNDONE.search(title):
                pool[e["date"]].append(e)
    picks = []
    for k in keys[:CAL_ENDS]:
        same = set()       # one show listed twice at one door keeps its better listing
        best = []
        for e in sorted(pool[k], key=lambda x: (-worth(x), x["start"], x["title"])):
            door = (e.get("venue"), e["start"])
            if door[0] and door in same:
                continue
            same.add(door)
            best.append(e)
        for e in best[:CAL_PICKS]:
            sig = e.get("signals") or {}
            rec = {"id": e.get("id"), "title": e["title"].strip(), "start": e["start"], "date": k,
                   "category": e.get("category") or "other", "end": ends_at(e)}
            for f in ("venue", "town"):
                if e.get(f):
                    rec[f] = e[f]
            if e.get("free"):
                rec["free"] = True
            if sig.get("image"):
                rec["image"] = sig["image"]
            if sig.get("own_group"):
                rec["own"] = True
            elif sig.get("staff_pick"):
                rec["pick"] = True
            picks.append(rec)
    return {"generated": now.astimezone(dt.timezone.utc).isoformat(timespec="seconds"),
            "days": [days[k] for k in keys], "picks": picks}


def main() -> int:
    if not SRC.exists():
        log(f"no events file at {SRC}")
        return 1

    today = dt.date.today()
    horizon = today + dt.timedelta(days=DAYS)
    doc = json.loads(SRC.read_text(encoding="utf-8"))
    events = doc.get("events") if isinstance(doc, dict) else doc
    if not isinstance(events, list):
        log("events.json did not contain an events list")
        return 1

    rows = []
    for e in events:
        if e.get("status") == "dropped":
            continue
        d = e.get("date")
        if not d:
            continue
        try:
            day = dt.date.fromisoformat(d)
        except ValueError:
            continue
        if not (today <= day <= horizon):
            continue
        title = (e.get("title") or "").strip()
        if not title or not e.get("url"):
            continue

        rec = {
            "id": e.get("id"),
            "title": title,
            "start": e.get("start") or d,
            "date": d,
            "url": e.get("url"),
            "category": e.get("category") or "other",
            "allDay": bool(e.get("allDay")),
        }
        for k in ("end", "venue", "town", "price", "minPrice", "age",
                  "indoorOutdoor", "recurring", "lat", "lng"):
            if e.get(k) is not None:
                rec[k] = e[k]
        if e.get("free"):
            rec["free"] = True
        if e.get("tags"):
            rec["tags"] = e["tags"]

        sig = e.get("signals") or {}
        keep = {k: sig[k] for k in ("artist", "genre", "image") if sig.get(k)}
        if keep:
            rec["signals"] = keep
        rows.append(rec)

    rows.sort(key=lambda r: (r["start"], r["title"]))
    if len(rows) > CAP:
        log(f"capping {len(rows)} -> {CAP}")
        rows = rows[:CAP]

    if not rows:
        log("no events in the window — refusing to write an empty payload")
        return 1

    cats = {}
    for r in rows:
        cats[r["category"]] = cats.get(r["category"], 0) + 1

    out = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "days": DAYS,
        "counts": cats,
        "events": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    free = sum(1 for r in rows if r.get("free"))
    log(f"wrote {OUT.relative_to(ROOT)}  {len(rows)} events over {DAYS} days · {free} free · "
        f"{OUT.stat().st_size // 1024} KB")

    cal = calendar_payload(events, dt.datetime.now(dt.timezone.utc))
    CAL_OUT.write_text(json.dumps(cal, ensure_ascii=False, separators=(",", ":")) + "\n")
    log(f"wrote {CAL_OUT.relative_to(ROOT)}  {len(cal['picks'])} picks · "
        f"{CAL_OUT.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
