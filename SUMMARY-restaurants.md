# Restaurant Engine — Build Summary

**Branch:** `feat/restaurants` · **Built:** 2026-07-10

## What shipped

Two new pages, one shared engine, and a real dataset:

- **`restaurants.html`** — "What's open right now?" Every view is one tap, computed live
  against the current Burlington clock (re-renders every minute, timezone-pinned to
  America/New_York so it's correct even for out-of-town viewers):
  Open Now · Open Late · Kitchen After 10 · Patios Right Now · Happy Hour Now ·
  Deals Today · Under $15 · New in Burlington · Closing Soon · Good for 8 ·
  Walk from Church St · Quiet Enough to Talk · Actually Good Alone · Watch the Game ·
  Everything · **Randomize Dinner** (full-screen slot-machine shuffle over places
  actually open for dinner tonight).
- **`deals.html`** — every deal by day, "Happening right now" section on top, each card
  carrying its **last-verified date** and a one-tap **"this expired?"** report (marks
  locally + opens a prefilled email to you — that inbox is the review queue).
- **`js/food-lib.js`** — the hours engine: per-day windows, overnight closes
  (close < open = past midnight), kitchen-close tracking, deal time-window matching,
  URL scheme validation for scraped links.
- **`data/restaurants.json`** — the dataset (see below).
- **`data/deals.json`** — 111 deals, all linked to restaurant entries.
- **`data/call-list.md`** — prioritized verification list for you.
- **`tools/refresh-hours.py`** — monthly hours re-verification against Google Places
  (reads the key from the environment; ~$0.02/place).
- `index.html` gained a **Food & Drink** nav link.

## The dataset

**282 places** (269 live + 13 confirmed-closed kept for the record):

| | |
|---|---|
| With Google-verified per-day hours | **252 (92% of live)** |
| With Google place_id (refreshable) | 259 |
| Restaurants / Cafés / Bars / Breweries / Sweet | 173 / 43 / 22 / 19 / 17 |
| Editorial attributes (quiet, solo, TV, groups, patio) | 76 venues researched, evidence + confidence stored |
| Late-night kitchen maps (hand-curated) | 8 venues (KKD, Ahli Baba's, Mr. Mikes, Taco Gordo, Devil Takes a Holiday, Daily Planet, Mule Bar, Insomnia) |
| New openings tracked (2025–26) | 15 incl. The Harborvale (opened July 7!), Sweetwaters reopening, Thai in the Alley, Upper Pass |

**Sources merged:** your existing 87-entry Food & Drink guide (kept all editorial voice) +
Hello Burlington's full 367-listing registry (via its JSON API) + Love Burlington +
Google Places (hours/status/coords) + your beehiiv deals page + the deals Google Sheet +
targeted research (Seven Days, Reddit, venue sites). Scope: Burlington, Winooski,
South Burlington + the guide's existing day-trip picks; 154 out-of-footprint directory
rows deliberately excluded.

**Confidence:** hours marked `google` were pulled today; `unverified` (22 live entries)
render as "Hours unverified" and never claim open/closed. Editorial flags (quiet, solo,
TV…) are **your-call-to-refine** — each drawer says "Vibe calls are the editor's —
disagree?" and links to your email. The attribute agent's least-confident venues:
Four Quarters, Stone Corral, Wise Fool, May Day, Venetian Soda Lounge, Willow's Bagels.

**Notable intelligence surfaced during the build:**
- **Nectar's closed for good** (July 2025) — likely still on the main site; check things.json.
- The Gryphon, Drink, Feldman's Bagels, Simple Roots, Kestrel's Pine St café: all closed.
- **Bleu Northeast Kitchen is "temporarily closed"** and The Harborvale (same address,
  same chef) just opened — Bleu's famous $1 oyster happy hour is probably dead. Top of the call list.
- Vermont bans drink-price happy hours — that's why every "happy hour" here is a food
  deal or renamed ("Honey Time"). Worth an editorial note on the deals page someday.
- 11 stale Hello Burlington listings were auto-excluded after Google confirmed them
  permanently closed (Asiana House, Our House Bistro, Café HOT, etc.).

## Deals

111 deals: 89 confirmed by both beehiiv and the sheet, 14 beehiiv-only, 7 sheet-only,
plus 3 research-found happy hours (Hen of the Wood oysters, Honey Road "Honey Time",
Leunig's Bistro Dinner) flagged for verification before you promote them.
14 source conflicts (different prices/days between beehiiv and sheet) → call list, top section.
beehiiv-sourced deals carry `last_verified: 2026-03-25` (the page's update date); sheet-only
deals show "Unverified" until you touch them.

## Verification performed

- 24-assertion DOM test suite (jsdom): chip switching, counts, drawer + 7-day hours
  table + backdrop, Escape/Enter keyboard paths, shuffle open/land/close with safe
  hrefs, deals day-switching, expired-report localStorage queue, hostile-input XSS
  smoke test — **all pass**.
- Visual check in Chrome at three different times of day; counts recomputed correctly
  as real time passed (including a two-hour gap that caught a stale-chip-count bug, fixed).
- `node --check` on all JS; live logic cross-checked in Node against the real dataset
  (Friday-evening spot checks: late-night kitchens = KKD/Ahli Baba's/Taco Gordo ✓).
- **Codex (GPT-5.6) independent review** found 10 real issues, all fixed: `javascript:`
  URL injection via scraped links, unescaped `<option>` values, kitchen-close data
  contradicting hours (my parser had applied "Fri–Sat 2:30 AM" to all seven days),
  untimed deals wrongly styled "live", dead drawer backdrop, cross-midnight deal
  matching, stale day nav after midnight, keyboard accessibility, over-broad Open
  Late label, and "Burlington" scope copy.
- Codex also contributed the directory ingestion review path; subagents did the four
  parallel research sweeps (directories, Places, deals, attributes/new-openings).

## Security notes

- The Google Maps API key was read from `~/btown-brief-prompts/secrets.env` into the
  environment only. It is **not** in any file in this repo, and the site makes **no
  client-side Google API calls** — hours are baked into `data/restaurants.json`.
- If you later add an embedded map (Maps JS), **domain-restrict the key first**.
- All scraped URLs are scheme-validated (`http`/`https` only) before becoming links.

## What I'd do next (not done)

- Retire Revolution Kitchen (and check Nectar's) in `things.json` — the main guide
  still lists at least one closed place.
- Update the beehiiv food-drink-deals page to link to the new `deals.html` (didn't touch
  beehiiv — that's publishing).
- A "Burlington only" toggle if the greater-Burlington footprint bothers anyone.
- Consider a Google Form instead of mailto for expired-deal reports if volume grows.

## Decisions made (Stephen, 2026-07-10)

- **Chains stay in** every view (99 Restaurants, Texas Roadhouse, Moe's, BWW).
- **Insomnia Cookies keeps** its Kitchen After 10 spot.
- **Sweet Treats stands stay thin** on attributes.
- **Day-trip entries stay** in Open Now with real hours.
- **Low-confidence attribute venues got a second research pass** (Four Quarters,
  Stone Corral, Shacksbury, Wise Fool, May Day, Ms. Weinerz, Boxcar, Venetian Soda
  Lounge, Willow's Bagels, Scout & Company) — flags updated in the dataset.

## Open questions (your calls)

1. **The call list** (`data/call-list.md`, 55 items): the top section (deal conflicts +
   3 unverified happy hours) is the newsletter-facing set — worth doing before the next
   Wednesday issue. Is Bleu's oyster hour dead, and did it move to The Harborvale?
