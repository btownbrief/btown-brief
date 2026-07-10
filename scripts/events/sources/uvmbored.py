"""UVM Bored — student-run "what's happening" aggregator (uvmbored.com).

uvmbored.com has no event data of its own: its listings are Localist widgets
over events.uvm.edu with exclude_types=46259325533573 (the "UVM BORED"
exclude filter), i.e. the events.uvm.edu/bored channel. So we read the same
Localist API as sources/uvm.py (shared per-window cache — one crawl for both)
and keep only events NOT flagged "exclude from UVM BORED". Events the BORED
team tags "boredfeatured" (their featured picks) get a signal.

Duplicates UVM's own calendar by design; the pipeline dedupes.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import common
from sources import uvm as _uvm

SOURCE = "uvmbored"
LABEL = "UVM Bored"


def fetch(window_start: date, window_end: date) -> list[dict]:
    events: list[dict] = []
    seen: set[str] = set()
    for ev, inst in _uvm.localist_instances(window_start, window_end):
        filters = ev.get("filters") or {}
        excluded = {f.get("id") for f in
                    filters.get("event_exclude_event_from") or []}
        if _uvm.BORED_EXCLUDE_ID in excluded:
            continue  # hidden from the UVM Bored channel
        tags = [t.lower() for t in ev.get("tags") or [] if isinstance(t, str)]
        signals = {"bored_featured": True} if "boredfeatured" in tags else None
        try:
            e = _uvm.localist_event(ev, inst, source=SOURCE, signals=signals)
        except Exception as ex:
            common.log(f"uvmbored: item skipped ({ex})")
            continue
        if e and e["id"] not in seen:
            seen.add(e["id"])
            events.append(e)
    return events
