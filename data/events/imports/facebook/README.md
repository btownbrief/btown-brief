# Facebook event drops

Facebook is login-walled, so the events pipeline never scrapes it. Instead,
drop export files into THIS directory and `scripts/events/sources/facebook.py`
imports them on every run:

```bash
python3 scripts/events/update.py --only facebook --window 30 --dry-run --sample 3
```

Files persist between runs — update.py's `lastSeen` mechanism keeps imported
events alive, and stale files whose events are all in the past are harmless
(past rows are skipped at import time). Delete old files whenever you like.

## Format 1: `*.csv` — Easy Scraper exports

Export the FB events discover page with Easy Scraper and drop the CSV here
as-is. Column names vary per scrape, so columns are detected heuristically:

- **title** — header containing title/name/event, or the first texty column
- **url** — any column whose values contain `facebook.com/events/...` links
- **date text** — FB's own phrasing, e.g. `Sat, Jul 12 at 7 PM`,
  `Saturday, July 12, 2026 at 7:00 PM EDT`, `Jul 12 at 7 PM – 10 PM`,
  `Today at 6 PM`, `Happening now`. No year → next occurrence of that
  month/day. Rows without a parseable future date are skipped.
- **location** — venue name OR bare street address; addresses are resolved
  to venue names via `scripts/events/venues.json`
  (e.g. `112 Lake St, Burlington` → Foam Brewers)
- **interested** — `87 interested` / `1.2K` → `signals.fb_interested`
  (never shown in reader-facing copy)

## Format 2: `*.jsonl` — Chrome-agent pass output

One JSON object per line. Minimum fields:

```json
{"title": "...", "url": "https://www.facebook.com/events/123.../",
 "date": "Sat, Jul 12 at 7 PM", "venue": "Foam Brewers"}
```

- `date` accepts ISO (`2026-07-12` or `2026-07-12T19:00:00-04:00`) or FB
  date text; `start` is an accepted alias for `date`.
- Give the location as `venue` (business name) or `address` (street
  address) — or a single `location` field, which is auto-classified.
- Optional, tolerated fields: `time` ("7 PM", upgrades a bare date),
  `end`, `town`, `price` (verbatim text — never invent, never default to
  Free), `description`, `fb_interested` (→ `signals.fb_interested`).

Events are deduplicated within one import by the FB event id in the URL.

## Where the data comes from: FB discover URLs (7 cities)

For a Chrome-agent pass (or manual Easy Scraper run), open these discover
pages logged in as Stephen, scroll to load everything in the window, and
produce one of the formats above. URL template:

```
https://www.facebook.com/events/?date_filter_option=CUSTOM_DATE_RANGE&discover_tab=CUSTOM&end_date=<END>T05:00:00.000Z&location_id=<LOCATION_ID>&start_date=<START>T05:00:00.000Z
```

`<START>`/`<END>` are `YYYY-MM-DD` (the `T05:00:00.000Z` suffix keeps the
range aligned to Eastern time). `scripts/edition_links.py` in the newsletter
repo prints ready-made links for each edition window.

| City | location_id |
|---|---|
| Burlington | 112673872077767 |
| South Burlington | 104067936295520 |
| Shelburne | 104330269602994 |
| Williston | 104022752967049 |
| Essex Junction | 112631562083722 |
| Winooski | 111971618819845 |
| Colchester | 109526772398915 |
