# Since You Checked — change pipeline

Answers "what changed in Burlington since you last looked?" by converting
feeds and APIs into timestamped, human-readable change events.

- `common.py` — fetch/RSS/state helpers + the source-module contract
- `sources/*.py` — one module per tracked source (see contract in common.py)
- `update.py` — orchestrator: snapshot → diff → append to the change log

Run from the repo root:

    python3 -m scripts.changes.update            # full run
    python3 -m scripts.changes.update --dry-run  # fetch + diff, write nothing
    python3 -m scripts.changes.update --only news,lake

Outputs (all under data/changes/):
- `changes.json` — rolling 7-day log of change events; the only file changes.html reads
- `state.json` — last known state per source (diff baseline)
- `snapshots/` — raw snapshot archive (last 30 runs)
- `daily-changes.md` — last 24h grouped as markdown; newsletter raw material
