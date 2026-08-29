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
  s   start, ISO with offset — the tab needs the real local time to bucket
  t   title
  v   venue, and w the town when it is not Burlington
  c   category, for the chips
  u   url
  p   price as printed, f free flag — the loudest signal in the whole app
      after "is it happening now"
  g   the artist/genre/image signals the venue sources now carry, when present

Run: python3 scripts/build_whatnow.py
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "events" / "events.json"
OUT = ROOT / "all-day" / "data" / "whatnow.json"

DAYS = 10
CAP = 700          # a hard ceiling so a bad merge cannot ship a 2 MB payload


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


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
            "t": title,
            "s": e.get("start") or d,
            "d": d,
            "u": e.get("url"),
            "c": e.get("category") or "other",
        }
        if e.get("venue"):
            rec["v"] = e["venue"]
        town = e.get("town")
        if town and town != "Burlington":
            rec["w"] = town
        if e.get("free"):
            rec["f"] = 1
        elif e.get("price"):
            rec["p"] = e["price"][:40]
        if e.get("allDay"):
            rec["a"] = 1

        sig = e.get("signals") or {}
        keep = {k: sig[k] for k in ("artist", "genre", "image") if sig.get(k)}
        if keep:
            rec["g"] = keep
        rows.append(rec)

    rows.sort(key=lambda r: (r["s"], r["t"]))
    if len(rows) > CAP:
        log(f"capping {len(rows)} -> {CAP}")
        rows = rows[:CAP]

    if not rows:
        log("no events in the window — refusing to write an empty payload")
        return 1

    cats = {}
    for r in rows:
        cats[r["c"]] = cats.get(r["c"], 0) + 1

    out = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "days": DAYS,
        "counts": cats,
        "events": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    free = sum(1 for r in rows if r.get("f"))
    log(f"wrote {OUT.relative_to(ROOT)}  {len(rows)} events over {DAYS} days · {free} free · "
        f"{OUT.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
