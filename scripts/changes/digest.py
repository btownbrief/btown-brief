#!/usr/bin/env python3
"""
Print a grouped, biggest-first markdown digest of tracked Burlington changes
for any window — the interface the newsletter pipeline consumes.

The hourly pipeline already writes data/changes/daily-changes.md (last 24h).
This command lets the Mon/Fri newsletter pull a wider window, e.g. everything
since the last edition:

    python3 -m scripts.changes.digest --since 4d        # last 4 days
    python3 -m scripts.changes.digest --since 2026-07-07 # since a date
    python3 -m scripts.changes.digest --since 2026-07-07T06:00 > since-friday.md

It reads the same 7-day log the website reads (data/changes/changes.json), so
it never re-fetches anything. Default window is 4 days, which covers the gap
between a Friday and the following Monday edition with margin.
"""

import argparse
import re
import sys
from datetime import timedelta

from .common import now_utc, iso, parse_when
from .update import load_json, render_markdown, LOG_PATH


def resolve_since(value, now):
    """'4d' / '48h' -> relative; otherwise an ISO date/datetime (BTV-local)."""
    if value is None:
        return now - timedelta(days=4)
    m = re.fullmatch(r"(\d+)\s*([dh])", value.strip(), re.I)
    if m:
        n = int(m.group(1))
        return now - (timedelta(days=n) if m.group(2).lower() == "d" else timedelta(hours=n))
    dt = parse_when(value)
    if dt is None:
        sys.exit(f"Could not read --since '{value}'. Use e.g. 4d, 48h, or 2026-07-07.")
    return dt


def main():
    ap = argparse.ArgumentParser(description="Grouped markdown digest of tracked changes.")
    ap.add_argument("--since", help="window start: 4d, 48h, or an ISO date/datetime (default: 4d)")
    args = ap.parse_args()

    now = now_utc()
    since = resolve_since(args.since, now)
    log = load_json(LOG_PATH, {"events": []})
    days = max(1, round((now - since).total_seconds() / 86400))
    label = f"Everything tracked since {since.astimezone().strftime('%b %-d')} (~{days} day{'s' if days != 1 else ''})"
    sys.stdout.write(render_markdown(log["events"], iso(since), now, label))


if __name__ == "__main__":
    main()
