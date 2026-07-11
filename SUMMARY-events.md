# Events Product — Build Summary

Branch: `feat/events` (worktree; not merged, not deployed — your review gate).
Built July 10, 2026.

## What this is

Burlington's everything-calendar, in two layers:

1. **Ingestion** — `scripts/events/update.py` sweeps 25 sources (stdlib Python,
   no dependencies), normalizes into one schema, fuzzy-dedupes across sources
   (title + date + venue), tracks first/last-seen for cancellation detection,
   and writes `data/events/events.json` (site), `events.jsonl` (newsletter-
   compatible), and `report.json` (per-source counts, errors, merges, changes).
2. **The page** — `events.html`, in the site's existing design system. Leads
   with time-aware buckets ("Tonight: N · Free tonight: N · Live music ·
   Actually social · Outside · Under $15 · Starting in the next 2 hours"),
   which pivot to Tomorrow after 10pm. Below: the full calendar — search,
   date pills, category/town/price/age filters, list ⇄ Leaflet map toggle,
   an "Ongoing — exhibits & long-runners" strip, the "want your event
   listed?" note, and the Ko-fi / newsletter / about-me footer strip. All on
   one page; 3.1 MB JSON (~0.5 MB gzipped over GitHub Pages).

Auto-update: `.github/workflows/refresh-events.yml` runs the pipeline at
5:40am + 4:40pm Burlington time and commits only on change. One flaky source
never nukes the calendar (3-day last-seen grace, then events drop out).
Manual run: `python3 scripts/events/update.py` (options in README).

## The numbers (first full run, 60-day window, July 10 2026)

**5,802 gathered → 4,711 after cross-source dedup (1,091 duplicates merged)
→ 3,185 final** (1,526 daily copies of long-running exhibits collapsed into
32 "ongoing" entries). 638 events corroborated by 2+ sources. 122 events
today; 1,475 events carry map coordinates (via venue registry + things.json).

| Source | Events (60d) | Method |
|---|---|---|
| Seven Days | 3,094 | listing HTML, 15 pages, staff picks flagged, 0 silent drops |
| Hello Burlington | 750 | Simpleview REST API (fixes the old recurrence undercount) |
| Love Burlington | 487 | Time.ly JSON API, day-by-day (avoids series collapse) |
| Fletcher Free Library | 257 | LibCal JSON |
| Champlain Valley (WFFF) | 165 | CitySpark API direct (bypasses the JS wall) |
| UVM + colleges | 158 | Localist API; Champlain College Tribe API |
| Eventbrite | 131 | embedded __SERVER_DATA__ + price API |
| UVM Bored | 131 | same Localist channel, bored-filtered (dedups into UVM) |
| South Burlington Library | 88 | MODX HTML w/ recurrence attributes |
| Church St Marketplace | 84 | Time.ly API (downtown-filtered Love Burlington calendar) |
| Meetup | 75 | 17 group iCal feeds + page enrichment (incl. your BSAG group, `own_group` flagged) |
| Breweries | 60 | Foam, Switchback, BBCo, Shelburne Vineyard, Fiddlehead |
| Higher Ground | 56 | calendar HTML + detail pages (incl. off-site shows) |
| Vermont Comedy Club | 55 | SeatEngine embedded JSON, every showtime |
| South Burlington Rec | 54 | CivicRec JSON endpoints |
| Shelburne Museum | 41 | Tribe API (incl. Concerts on the Green) |
| BCA | 37 | Drupal HTML + exhibitions |
| Winooski Library | 35 | Time.ly API |
| The Flynn | 14 | its own Algolia index + buy-button price API |
| Burlington Parks & Rec | 12 | CivicPlus iCal feeds (summer-thin; skating resumes Oct) |
| Farmers Market | 9 | Saturdays from the site's own schedule banner |
| ECHO | 7 | Tribe API; Dinosaur Safari collapsed to one "ongoing" entry |
| Vermont Green FC | 2 | schedule HTML — 2 home playoff matches left; season ends soon |
| Facebook | 0 | import slot only — see below |
| Instagram | 0 | dormant until Scrape Creators key — see below |

Accuracy: every fetcher was live spot-checked (2–3 events each against the
source's own pages; dates/times/venues/prices matched). Free is set only when
a source explicitly says free — "Free with admission / for members" is
correctly NOT free. Interest counts live in `signals`, never reader-facing.

## What works beyond the basics

- **Dedup is showtime-aware**: VCC's 7pm & 9pm shows stay separate; the same
  show listed by Seven Days and the venue merges (all source links kept).
- **Newsletter reuse**: `data/events/events.jsonl` matches the run-edition
  schema (`{title,url,source,date,day,time,venue,city,cost,category,signals,…}`),
  so an edition can start from this file instead of re-gathering. Seven Days
  staff picks and your Meetup group are already flagged in `signals`.
- **Venue registry** (`scripts/events/venues.json`, 137 venues): resolves
  aliases + bare street addresses to canonical venues, tags towns, and pulls
  coordinates from the city guide's `things.json`.
- **Change tracking**: report.json logs time changes, missing-from-source
  events (marked `unconfirmed` for 3 days, then dropped as likely cancelled).

## Known gaps

- **Facebook** — login-walled, never scraped headlessly. Drop Easy Scraper
  CSVs (or the Chrome-agent JSONL) into `data/events/imports/facebook/`
  (formats documented in its README). **A fresh Facebook pass is needed now**
  — the calendar currently has zero FB-only events.
- **Instagram** — adapter built, dormant until `SCRAPE_CREATORS_API_KEY`
  lands in `~/btown-brief-prompts/secrets.env` (locally) and as a GitHub
  repo secret (for the Action). The endpoint shape is an educated guess
  documented in `sources/instagram.py`; expect one tweak on first live run.
  Confirmed Instagram-only venues to add handles for: Zero Gravity, Citizen
  Cider, Queen City Brewery, Four Quarters, 1st Republic, plus BBCo events.
- **Front Porch Forum** — login-walled; stays a newsletter-workflow source.
- **Stone Corral (Richmond)** — real events page but Cloudflare-blocked to
  scripts; gap.
- **Saint Michael's College** — fetcher works; their calendar currently
  lists only out-of-state alumni outings, so 0 events is correct for July.
- **Seven Days "every other week" listings** — 3–4 events skipped per run
  (the listing doesn't say which week; guessing would violate accuracy).
- **South Burlington sites** (library + city) intermittently drop non-browser
  TLS connections; the fetchers have fallbacks, but watch the Action logs.
- Simple Roots Brewing closed Oct 2025 (still in the venue registry
  harmlessly, for old-address resolution).

## Fragility notes (for future maintenance)

Several fetchers use the sites' own widget APIs with public keys extracted
from their JS bundles (Time.ly, CitySpark, Algolia). If a key rotates the
module either re-extracts automatically or fails loudly — update.py keeps
last-good data either way. Seven Days parsing is anchored to their current
CSS class names; a redesign there needs a parser revisit.

## Verification performed

- Every fetcher live spot-checked by its builder (2–3 events each against the
  source's own pages) plus per-source count audits vs known baselines.
- Full pipeline run end-to-end (exit 0, all 25 sources OK, report.json clean).
- The page was verified in a real Chrome tab against the live data:
  time-aware hero ("Friday evening in Burlington · 30 things tonight"),
  all seven buckets with correct counts, bucket panel open/close, day-grouped
  calendar (507 events / 7 days), ongoing strip (32), free-price filter
  (503 → 216, every visible card had a Free badge) and clear-filters — all
  confirmed via DOM inspection.
- Map view: the marker-grouping logic was verified headlessly against the
  real dataset (24 venue pins, all valid; Leaflet usage mirrors the already-
  shipped app.js). A visual click-through of the map didn't complete — the
  Chrome extension session kept dropping mid-check — so give the Map toggle
  one manual click when you review. Everything else was eyeballs-on-DOM.

## How to run / preview

```bash
cd btown-brief
python3 scripts/events/update.py          # refresh data (all sources, ~7 min)
python3 -m http.server 8000               # then open localhost:8000/events.html
```

After merging: enable the "Refresh events calendar" workflow (same two
Settings→Actions switches as the existing one) and optionally add
`SCRAPE_CREATORS_API_KEY` as a repo secret.

## Open questions (for Stephen)

1. **Facebook cadence** — want the newsletter's Chrome-agent FB pass (or an
   Easy Scraper drop) folded into your Mon/Fri routine so the calendar gets
   FB events twice a week? The import slot is ready.
2. **Scrape Creators** — paste the key into secrets.env when the account
   exists and tell me; I'll verify the endpoint and curate the handle list
   (suggest starting with the Instagram-only breweries above + Despacito +
   The Archives).
3. **Nav placement** — I added "Events" as a third item in the site header
   next to The List/Guides. Good, or do you want it somewhere else (e.g.
   replacing the "Events This Week" strip on the list page)?
4. **Radius** — Champlain Valley/aggregators are filtered to Chittenden
   towns (plus Richmond/Huntington/Fairfax when a local org hosts there).
   Want a wider or tighter net?
5. **Exhibits** — long-runners are collapsed into the "Ongoing" strip.
   Happy with that, or should they also appear in each day's list?
