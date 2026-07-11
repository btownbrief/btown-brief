#!/usr/bin/env python3
"""Run all event fetchers, dedupe, and write data/events/.

Usage:
  python3 scripts/events/update.py                  # all sources, 60-day window
  python3 scripts/events/update.py --only flynn     # one source (comma-list ok)
  python3 scripts/events/update.py --window 14      # shorter horizon
  python3 scripts/events/update.py --only flynn --sample 5 --dry-run

Outputs (git-tracked, consumed by events.html and the newsletter pipeline):
  data/events/events.json   — deduped events + per-run metadata
  data/events/events.jsonl  — newsletter-schema export (one JSON per line)
  data/events/report.json   — per-source counts, errors, dedup + change log

Exit code is 0 as long as at least one source succeeded (a single flaky
site must not nuke the calendar); nonzero only on total failure.
"""
from __future__ import annotations

import argparse
import importlib
import json
import re
import sys
import time
import traceback
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common
from common import TZ, DATA_DIR, log, norm_title, _norm_venue

SOURCES_DIR = Path(__file__).resolve().parent / "sources"

# Higher = more authoritative when merging duplicate listings.
# Venue-run calendars beat aggregators; aggregators beat social scrapes.
PRIORITY = {
    "flynn": 90, "higherground": 90, "vcc": 90, "echo": 90, "bca": 90,
    "shelburnemuseum": 90, "greenfc": 90, "fletcherfree": 90, "sblibrary": 90,
    "winooskilibrary": 90, "churchst": 85, "farmersmarket": 85, "uvm": 85,
    "parksrec": 85, "sbrec": 85, "breweries": 80, "loveburlington": 70,
    "sevendays": 65, "helloburlington": 60, "uvmbored": 55,
    "eventbrite": 50, "meetup": 50, "champlainvalley": 40,
    "facebook": 35, "instagram": 35,
}

MISSING_GRACE_DAYS = 3  # future event unseen this long -> flagged, then dropped


def discover_sources(only: set[str] | None):
    mods = []
    for f in sorted(SOURCES_DIR.glob("*.py")):
        if f.name.startswith("_"):
            continue
        name = f.stem
        if only and name not in only:
            continue
        mods.append(importlib.import_module(f"sources.{name}"))
    return mods


# ------------------------------------------------------------------ dedup

def _title_sim(a: str, b: str) -> float:
    if a == b:
        return 1.0
    ta, tb = set(a.split()), set(b.split())
    if ta and tb and (ta <= tb or tb <= ta):
        return 0.95
    return SequenceMatcher(None, a, b).ratio()


def _venue_compatible(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return True
    na, nb = _norm_venue(a), _norm_venue(b)
    if na == nb or na in nb or nb in na:
        return True
    return SequenceMatcher(None, na, nb).ratio() >= 0.8


# Titles too generic to merge across different venues — the same night can
# have "Trivia Night" at three bars, and those are genuinely different events.
_GENERIC_TITLE_RE = re.compile(
    r"trivia|open mic|karaoke|bingo|happy hour|live music|story ?time|"
    r"yoga|book club|farmers.? market|game night|run club|drag (?:brunch|bingo)|"
    r"\bquiz|line danc|salsa|dance party|open studio|figure drawing|"
    r"drop.?in|story ?hour|\bclass\b|\bworkshop\b|\bservice\b|\bmass\b|"
    r"worship|\btour\b|tasting|meeting|paint ?night|pub quiz|"
    r"pickup|pick.?up|jam session|sound bath|meditation|networking|"
    r"reception|opening|concert|festival|matinee|brunch|rehearsal|ceremony|"
    r"social|mixer|gathering|showcase|screening|market|\bfair\b|"
    r"celebration|fundraiser|storytime|playgroup|practice", re.I)


def _distinctive(title: str) -> bool:
    """A title specific enough that same-title + same-date almost certainly
    means the same event even if the venue strings differ across sources
    (e.g. 'Thundercat', 'Sylvan Esso', 'Party on the Bricks'). Excludes
    generic recurring names — the same night really can have 'Trivia Night'
    at three different bars."""
    if _GENERIC_TITLE_RE.search(title):
        return False
    words = title.split()
    return len(words) >= 2 or (len(words) == 1 and len(words[0]) >= 6)


def _towns_compatible(a: dict, b: dict) -> bool:
    ta, tb = a.get("town"), b.get("town")
    return not ta or not tb or ta == tb


def _same_source_other_showtime(ev: dict, cluster: list[dict]) -> bool:
    """A source that lists the same title twice on one date means two real
    showtimes (VCC 7pm & 9pm) — never merge those. Cross-source duplicates
    with slightly different times ARE still merged."""
    if ev["allDay"]:
        return False
    for other in cluster:
        if (other["source"] == ev["source"] and not other["allDay"]
                and other["start"] != ev["start"]):
            return True
    return False


def dedupe(events: list[dict]) -> tuple[list[dict], list[dict]]:
    """Fuzzy-merge same title+date+venue across sources.
    Returns (merged_events, merge_log)."""
    by_date: dict[str, list[dict]] = {}
    for ev in events:
        by_date.setdefault(ev["date"], []).append(ev)

    merged: list[dict] = []
    merge_log: list[dict] = []
    for date_key in sorted(by_date):
        clusters: list[list[dict]] = []
        for ev in sorted(by_date[date_key],
                         key=lambda e: -PRIORITY.get(e["source"], 45)):
            nt = norm_title(ev["title"])
            placed = False
            for cluster in clusters:
                head = cluster[0]
                sim = _title_sim(nt, norm_title(head["title"]))
                if _same_source_other_showtime(ev, cluster):
                    continue
                # normal path: similar title + compatible venue
                compatible = (sim >= 0.87
                              and _venue_compatible(ev.get("venue"), head.get("venue")))
                # cross-venue path: a near-identical DISTINCTIVE title on the same
                # date in the same town is the same event even if venues differ
                # (promoter vs venue name, or an unresolved FB address)
                if not compatible and sim >= 0.93 and _distinctive(nt) \
                        and _towns_compatible(ev, head):
                    compatible = True
                if compatible:
                    cluster.append(ev)
                    placed = True
                    break
            if not placed:
                clusters.append([ev])
        for cluster in clusters:
            primary = cluster[0]  # highest priority source
            out = dict(primary)
            srcs, seen_src = [], set()
            for ev in cluster:
                if ev["source"] not in seen_src:
                    srcs.append({"source": ev["source"], "url": ev["url"]})
                    seen_src.add(ev["source"])
                for field in ("venue", "address", "town", "price", "free",
                              "minPrice", "age", "indoorOutdoor", "description",
                              "lat", "lng", "end", "recurring"):
                    if out.get(field) is None and ev.get(field) is not None:
                        out[field] = ev[field]
                for t in ev.get("tags", []):
                    if t not in out["tags"]:
                        out["tags"].append(t)
                out["signals"] = {**ev.get("signals", {}), **out.get("signals", {})}
                # all-day listing + timed listing of the same thing -> keep the time
                if out["allDay"] and not ev["allDay"]:
                    out.update(start=ev["start"], end=ev.get("end"), allDay=False)
            if out.get("category") == "other":
                for ev in cluster[1:]:
                    if ev.get("category") not in (None, "other"):
                        out["category"] = ev["category"]
                        break
            out["sources"] = srcs
            merged.append(out)
            if len(seen_src) > 1:
                merge_log.append({
                    "kept": {"title": out["title"], "source": out["source"]},
                    "merged_sources": sorted(seen_src), "date": date_key,
                })
    return merged, merge_log


def collapse_ongoing(events: list[dict], min_days: int = 10):
    """An all-day listing that repeats on many dates (exhibits, 'on view
    through…' shows) becomes ONE entry with ongoingUntil + an 'ongoing' tag,
    instead of flooding every day group. One-offs and short runs untouched."""
    from collections import defaultdict
    groups = defaultdict(list)
    out: list[dict] = []
    for ev in events:
        if ev["allDay"]:
            groups[(norm_title(ev["title"]), _norm_venue(ev.get("venue") or ""))].append(ev)
        else:
            out.append(ev)
    collapsed = 0
    for evs in groups.values():
        dates = sorted({e["date"] for e in evs})
        if len(dates) >= min_days:
            keep = dict(min(evs, key=lambda e: e["date"]))
            keep["ongoingUntil"] = dates[-1]
            if "ongoing" not in keep["tags"]:
                keep["tags"] = keep["tags"] + ["ongoing"]
            if not keep.get("recurring"):
                keep["recurring"] = f"Ongoing through {dates[-1]}"
            out.append(keep)
            collapsed += len(evs) - 1
        else:
            out.extend(evs)
    return out, collapsed


# ------------------------------------------------------------------ state merge

def merge_state(fresh: list[dict], previous: list[dict], now_iso: str,
                today: str, fetched_sources: set[str], failed: set[str]):
    """Carry firstSeen/lastSeen; flag future events that vanished from a
    source that DID succeed (possible cancellation); drop after grace."""
    prev_by_id = {e["id"]: e for e in previous}
    changes: list[dict] = []
    out: list[dict] = []
    fresh_ids = set()

    for ev in fresh:
        fresh_ids.add(ev["id"])
        prev = prev_by_id.get(ev["id"])
        ev["firstSeen"] = prev["firstSeen"] if prev else now_iso
        ev["lastSeen"] = now_iso
        ev["status"] = "active"
        if prev and prev.get("start") != ev["start"] and not ev["allDay"]:
            changes.append({"id": ev["id"], "title": ev["title"], "date": ev["date"],
                            "change": "time", "was": prev["start"], "now": ev["start"]})
        out.append(ev)

    grace = timedelta(days=MISSING_GRACE_DAYS)
    now_dt = datetime.fromisoformat(now_iso)
    for prev in previous:
        if prev["id"] in fresh_ids or prev["date"] < today:
            continue
        ev_sources = {s["source"] for s in prev.get("sources", [{"source": prev["source"]}])}
        if failed and ev_sources <= failed:
            # every source that knew this event errored this run — keep as-is
            out.append(prev)
            continue
        if ev_sources & fetched_sources or not fetched_sources:
            last = datetime.fromisoformat(prev["lastSeen"])
            if now_dt - last <= grace:
                prev = dict(prev)
                prev["status"] = "unconfirmed"
                out.append(prev)
                changes.append({"id": prev["id"], "title": prev["title"],
                                "date": prev["date"], "change": "missing",
                                "lastSeen": prev["lastSeen"]})
            else:
                changes.append({"id": prev["id"], "title": prev["title"],
                                "date": prev["date"], "change": "dropped"})
        else:
            out.append(prev)  # its source wasn't part of this (--only) run
    return out, changes


# ------------------------------------------------------------------ exports

_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def newsletter_row(ev: dict) -> dict:
    d = datetime.fromisoformat(ev["date"])
    t = None
    if not ev["allDay"]:
        st = datetime.fromisoformat(ev["start"])
        t = st.strftime("%-I:%M %p").replace(":00 ", " ")
    return {
        "title": ev["title"], "url": ev["url"], "source": ev["source"],
        "date": ev["date"], "day": _DAYS[d.weekday()], "time": t,
        "venue": ev.get("venue"), "city": ev.get("town"),
        "cost": ("Free" if ev.get("free") else ev.get("price")),
        "category": ev.get("category"), "signals": ev.get("signals", {}),
        "multiday": bool(ev.get("recurring")), "notes": ev.get("description"),
    }


# ------------------------------------------------------------------ main

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated source slugs")
    ap.add_argument("--window", type=int, default=60, help="days ahead (default 60)")
    ap.add_argument("--sample", type=int, default=0, help="print N sample events")
    ap.add_argument("--dry-run", action="store_true", help="don't write data files")
    args = ap.parse_args()

    only = set(args.only.split(",")) if args.only else None
    lo, hi = common.default_window(args.window)
    now_iso = datetime.now(TZ).isoformat(timespec="seconds")
    log(f"window {lo} → {hi}")

    all_events: list[dict] = []
    report_sources: dict[str, dict] = {}
    failed: set[str] = set()
    fetched: set[str] = set()

    for mod in discover_sources(only):
        slug = getattr(mod, "SOURCE", mod.__name__.split(".")[-1])
        label = getattr(mod, "LABEL", slug)
        t0 = time.time()
        try:
            evs = mod.fetch(lo, hi)
            evs = [e for e in evs if lo.isoformat() <= e["date"] <= hi.isoformat()]
            all_events.extend(evs)
            fetched.add(slug)
            report_sources[slug] = {"label": label, "count": len(evs),
                                    "seconds": round(time.time() - t0, 1)}
            log(f"  {slug:16s} {len(evs):4d} events  ({report_sources[slug]['seconds']}s)")
        except Exception as e:
            failed.add(slug)
            report_sources[slug] = {"label": label, "count": 0, "error": str(e)[:300]}
            log(f"  {slug:16s} FAILED: {e}")
            traceback.print_exc(file=sys.stderr)

    if only is None and not fetched:
        log("every source failed — keeping previous data untouched")
        return 1

    merged, merge_log = dedupe(all_events)

    merged, n_collapsed = collapse_ongoing(merged)
    if n_collapsed:
        log(f"collapsed {n_collapsed} daily copies of long-running exhibits/series")

    # two showtimes of one title share a content hash — make ids unique
    # deterministically (suffix = start time) so state merging stays stable
    seen_ids: set[str] = set()
    for ev in merged:
        if ev["id"] in seen_ids:
            suffix = ev["start"][11:16].replace(":", "") if not ev["allDay"] else "d"
            ev["id"] = f"{ev['id']}-{suffix}"
        seen_ids.add(ev["id"])

    prev_path = DATA_DIR / "events.json"
    previous = []
    if prev_path.exists():
        try:
            previous = json.loads(prev_path.read_text()).get("events", [])
        except Exception:
            previous = []

    final, changes = merge_state(merged, previous, now_iso, lo.isoformat(),
                                 fetched, failed)
    final = [e for e in final if e["date"] <= hi.isoformat()]
    final.sort(key=lambda e: (e["date"], e["allDay"], e["start"]))

    dupes_removed = len(all_events) - len(merged)
    log(f"gathered {len(all_events)} · after dedup {len(merged)} "
        f"(-{dupes_removed}) · final with carryover {len(final)}")

    if args.sample:
        for ev in final[:args.sample]:
            print(json.dumps(ev, indent=2))

    if args.dry_run:
        return 0

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "events.json").write_text(json.dumps({
        "generated": now_iso, "windowStart": lo.isoformat(),
        "windowEnd": hi.isoformat(), "events": final,
    }, ensure_ascii=False, separators=(",", ":")) + "\n")
    with (DATA_DIR / "events.jsonl").open("w") as f:
        for ev in final:
            if ev["status"] == "active":
                f.write(json.dumps(newsletter_row(ev), ensure_ascii=False) + "\n")
    (DATA_DIR / "report.json").write_text(json.dumps({
        "generated": now_iso, "sources": report_sources,
        "gathered": len(all_events), "afterDedup": len(merged),
        "duplicatesMerged": dupes_removed, "final": len(final),
        "mergeLog": merge_log[-200:], "changes": changes[-200:],
    }, ensure_ascii=False, indent=1) + "\n")
    log(f"wrote {DATA_DIR}/events.json (+.jsonl, report.json)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
