# Since You Checked — Build Summary

**Branch:** `feat/since-you-checked` · **Built:** 2026-07-10
**The page:** `changes.html` — answers "what changed in Burlington since you last looked?"

**To preview:** `python3 -m http.server 8000` in this folder → http://localhost:8000/changes.html
**To refresh the data:** `python3 -m scripts.changes.update` (from the repo root)

## How it works

Every pipeline run snapshots each source, diffs against the previous state
(`data/changes/state.json`), and appends timestamped, human-readable change
events to `data/changes/changes.json` (rolling 7 days). The page stores your
last visit in localStorage and filters that log client-side — first-time
visitors get "the last 24 hours." Categories render biggest-change-first.
A GitHub Actions workflow (`refresh-changes.yml`) runs hourly at :25 once the
branch is merged; until then, run it locally.

`data/changes/daily-changes.md` is rewritten every run: the last 24 hours of
change lines, grouped and linked — drop-in raw material for the newsletter.

## What's tracked (8 sources, all live-validated today)

| Category | Source | What becomes a change line |
|---|---|---|
| 🌩 Weather | NWS alerts + forecast (api.weather.gov) | warning issued/ended; a once-a-day heads-up when thunder/snow/damaging wind enters today's forecast |
| 🏖 The Lake | City ArcGIS beach tracker | any beach flips open ↔ closed ("North Beach reopened") |
| 🚧 Roads | City construction ArcGIS layer | new/edited construction-map entries |
| 🚧 Roads | GMT service-alert RSS | every new service alert / detour |
| 🏛 City Hall | CivicClerk API | meeting scheduled; **agenda posted** (City Council = top priority) |
| 📰 News + 🍽 Food | 8 RSS feeds: Seven Days, VTDigger, Vermont Public, WCAX, NBC5 (WPTZ), city news releases, BPD, Mayor's office | new stories; statewide feeds filtered to Burlington-area mentions; food-venue stories routed to 🍽; obituaries/legal notices dropped |
| 💬 Chatter | r/burlington via Inoreader stream | new posts (Reddit 403s scripts everywhere; the JSON path stays as first choice, scores/"blowing up" activate automatically if it ever works from CI) |
| 🎭 Events | repo's own `data/events.json` | newly added upcoming events (lights up when the feat/events refresh workflow lands on main) |

## What isn't tracked yet

- **VT511 road incidents** — code is in place (`roads.py`) but newengland511.org's API now demands a key ("Invalid Key"). Registering for a free 511 developer key would light up I-89 crash/closure lines, the single best "affects your drive home" source.
- **Restaurant openings as first-class state** — currently food news comes from keyword-routing headlines. The feat/restaurants dataset (282 places, live hours) could yield true state diffs ("Poko listed a new location", "hours changed at Onyx").
- **Front Porch Forum** — no feed, login-walled; would need the newsletter-side pipeline.
- **Reddit scores/velocity** — "blowing up, +300 in 2 hours" needs the JSON API; consider a Reddit app credential someday.
- **City calendar events / permits layer** — both in `data/sources.json`, easy follow-ups.

## Verification performed

- Pipeline run against all real sources 4×: bootstrap emitted 14 genuine events (Monday's City Council agenda, a GMT Essex Junction alert, live r/burlington threads, filtered local news); immediate re-runs emitted 0 (diff engine is stable); the chatter id-scheme migration re-emitted 6 and the 48h dedupe absorbed all 6.
- Page rendered live in Chrome at desktop width, light mode, first-visit state: hero count, category grouping, per-line source links and relative times all correct.
- All client state logic tested headlessly in Node against the real data file: first visit, 19h return visit, quiet state + fallback list, 30-minute reload grace window, and a hostile-event XSS probe (escaped, `javascript:` link dropped) — 5/5 pass (`scratchpad/test-changes-js.mjs`).
- **Not visually verified:** dark mode and 390px mobile layout (Chrome automation was contended by a parallel session; both are built purely on the shared design-system variables and the same media-query pattern weather.html uses). Worth one eyeball before merge.

## What Codex contributed

GPT-5.6 Sol built 6 of 8 fetcher modules to the `common.py` contract (news,
chatter, lake, roads, transit, civic) and ran an independent 11-finding review
of the whole branch. I tightened its output (food-keyword false positives,
obituary noise, Reddit fallback, CivicClerk date-window bug — desc ordering
only ever returned 2027 placeholder meetings) and fixed 8 review findings
(dedupe semantics, corrupt-state fail-closed, write ordering, timestamp
clamps, forecast-flag carry, BTV-timezone day scoping, attribute-safe
escaping, http(s)-only links).

## Open questions for Stephen

1. **511 key** — want me to register for a New England 511 API key? Free, and it unlocks real-time road incidents.
2. **Newsletter hookup** — `daily-changes.md` regenerates every run; should the newsletter pipeline on the SAMSUNG drive consume it directly, or would you rather it read `changes.json` and pick lines itself?
3. **Homepage teaser** — I added a "Since You Checked" teaser card under the Right Now teaser on index.html and a header link on weather.html. Happy to move/restyle if it crowds the top of the list page.
4. **Merge = deploy** — nothing is pushed; the branch is local. Merging to main deploys the page and starts the hourly workflow.
