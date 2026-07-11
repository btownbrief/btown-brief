# Since You Checked — change pipeline

Answers "what changed in Burlington since you last looked?" by converting
feeds and APIs into timestamped, human-readable change events.

- `common.py` — fetch/RSS/state helpers + the source-module contract
- `sources/*.py` — one module per tracked source (see contract in common.py)
- `update.py` — orchestrator: snapshot → diff → append to the change log
- `digest.py` — print a grouped markdown digest for any window (newsletter interface)

Run from the repo root:

    python3 -m scripts.changes.update            # full run
    python3 -m scripts.changes.update --dry-run  # fetch + diff, write nothing
    python3 -m scripts.changes.update --only news,lake

Outputs (all under data/changes/):
- `changes.json` — rolling 7-day log of change events; the only file changes.html reads
- `state.json` — last known state per source (diff baseline)
- `snapshots/` — raw snapshot archive (last 30 runs)
- `daily-changes.md` — last-24h grouped markdown; the daily editor's-desk view

## Feeding the newsletter

The newsletter runs Mon/Fri, so it wants a multi-day window, not just today.
Pull one on demand — no re-fetching, it reads the same 7-day `changes.json`:

    python3 -m scripts.changes.digest --since 4d          # last 4 days
    python3 -m scripts.changes.digest --since 2026-07-07  # since a date
    python3 -m scripts.changes.digest --since 4d > friday-brief.md

Output is grouped by category, biggest first, every line linked to its source —
skim, pick, rewrite, drop in. (`daily-changes.md` is the same rendering at a
fixed 24h window, written every run for a quick "what changed today" glance.)

## Optional: New England 511 road incidents (I-89 crashes/closures)

Off by default — the 511 API needs a free developer key. To enable:
1. Register at http://nec-por.ne-compass.com/DeveloperPortal (covers Vermont).
2. Add the key as a GitHub Actions secret named `NE511_API_KEY`
   (and export it locally to test). `roads.py` lights up automatically; the
   `?key=` parameter name may need a one-line tweak once a real key is in hand.
Roads already works without it via the city construction map + GMT alerts.
