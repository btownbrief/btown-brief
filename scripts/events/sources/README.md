# Source fetcher contract

Each file in this directory is one source module (stdlib Python only — no pip):

```python
SOURCE = "slug"       # unique lowercase slug == filename
LABEL  = "Human Name"

def fetch(window_start, window_end):   # datetime.date, inclusive
    """Return a list of dicts built with common.make_event()."""
```

Import shared helpers: `import common` (update.py puts scripts/events on sys.path;
for standalone testing use `sys.path.insert(0, str(Path(__file__).parents[1]))`).

`common.py` gives you: `fetch(url)` (polite UA/gzip/retries/rate-limit),
`fetch_json`, `strip_tags`, `collect_links`, `jsonld_events` (JSON-LD Event
extraction — try this FIRST on any modern site), `parse_ics(text, lo, hi)`
(full ICS with RRULE expansion), `parse_time_str`, `local_dt`, `parse_iso`,
`make_event(...)` (normalizes venue/town/price/category, computes stable id).

## Binding rules (accuracy is existential for this product)

1. **Never invent data.** Unknown field → None. `free=True` ONLY when the
   source explicitly says free — never default. Price text goes in `price`
   verbatim-ish; `make_event` parses it.
2. **One event dict per occurrence date.** Expand recurring/multi-date
   listings within [window_start, window_end]; put the human-readable rule in
   `recurring=`. Never emit occurrences you can't verify from the source.
3. **Every event needs its own real `url`** (detail page preferred over the
   listing page). `title`, `start` (aware datetime via `common.local_dt`, or a
   `date` for all-day/unknown-time), and `url` are required.
4. Set `town=` when the source states it or the venue implies it. Aggregators
   cover the whole region — only return events in/near Chittenden County
   (Burlington, South Burlington, Winooski, Essex, Essex Jct, Colchester,
   Shelburne, Williston; nearby towns OK if the source is local).
5. FB/Meetup interest counts → `signals={"meetup_going": N}` etc., never in
   the description. Seven Days staff picks → `signals={"staff_pick": True}`.
6. Paginate to exhaustion within the window, but honor a safety cap
   (~30 pages) and `common.log()` a warning if you hit it.
7. Wrap flaky per-item fetches in try/except and keep going; raise only when
   the whole source is down (update.py records it and keeps last-good data).

## Testing

```bash
cd <repo root>
python3 scripts/events/update.py --only <slug> --window 14 --dry-run --sample 3
```

Check: count looks sane vs the live site, dates/times/venues match reality,
no fabricated "Free", towns tagged.
