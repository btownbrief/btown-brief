# Quick Wins — feat/quick-wins

Five additions, all on this branch, all verified rendering locally (mobile-width + dark mode). No existing URL was renamed or removed; everything is additive. Pushed as `feat/quick-wins` for review — merging to main is what deploys it.

**To preview:** `python3 -m http.server 8000` in this folder → http://localhost:8000

---

## 1. Donate presence + the BTown strip (every page)

- A shared **BTown strip** now renders once per page, above the footer, on all five pages (`js/community.js` injects it): a highlighted Ko-fi donate card + "The free newsletter" (btownbrief.com) + "It's just me — meet Stephen" (about-me).
- **Two copy variants** live in `js/community.js`:
  - **A (personal):** "One local guy builds all of this… a coffee keeps it going" → *☕ Buy me a coffee*
  - **B (civic):** "Keep Burlington's local info free… chip in to keep it that way" → *❤️ Chip in on Ko-fi*
  - Now running a **random sticky 50/50 split per visitor** (`ACTIVE_DONATE_VARIANT = 'AB'`); set it to `'A'` or `'B'` to pin one. Compare with: `select event, variant, count(*) from btb_events where event = 'strip-donate' group by 1,2;`
- **Click counter:** every strip click (donate/newsletter/about) posts to the shared games Supabase project with the active variant + page. Until you run `db/quick-wins.sql` (below) it silently no-ops. To see what's working: `select event, variant, count(*) from btb_events group by 1,2;`
- **Not naggy:** the old tiny "Donate ❤️" link in the index support-line was consolidated into the strip, so each page has exactly one donate placement.
- **Games arcade:** the strip is also added to the arcade hub repo (`btownbrief.github.io`, branch `feat/donate-strip`) — above its footer, after the game cabinets, never inside the play flow.
- Index also got a **"Get into Burlington life"** card row (top of the community section) linking the four new pages.

## 2. Volunteer page — `volunteer.html`

- "Help Burlington This Week" framing with **quick filters** that AND together: *I've got 2 hours · Outdoors · One-time · Recurring · Good with friends*.
- All ~32 orgs from your beehiiv "Burlington Volunteer Opportunities" page carried over, each tagged, grouped (Environment, Animals, Food & Housing, Kids & Families, Older Neighbors & Health, Arts & Civic), every link going straight to the org's volunteer page. Two Google-search-wrapped links from the old page were fixed to direct URLs; all links verified live.
- Big United Way NWVT ("find a shift this week") + Idealist buttons up top. Links out only — no scraping.
- Note at the bottom inviting orgs to email **BtownBrief@gmail.com** with opportunities.
- Data lives in `data/volunteer.json` — copy any entry to add an org.
- Your beehiiv page wasn't touched; when you're happy with this one, point it here (or just link it).

## 3. Clubs directory — `clubs.html`

- 38 researched-and-verified Burlington-area clubs and recurring groups across Running, Biking, Hiking, Games, Books, Sports & Rec, Making & Crafts, Language, Music, Dance, Social — each with name, one-liner, meeting cadence, and link.
- **Your Meetup group is featured at the top** in a highlighted card.
- Data lives in `data/clubs.json` — append an entry and the page regroups automatically. Invite note for club organizers to email you.

## 4. Community projects — `projects.html`

- 15 "people building things for Burlington" with warm one-liners and maker credits: fellow newsletters linked generously (BTV Daily, Good Govermont, The Winooski News, Seven Days, VTDigger), podcasts & community radio (Rumble Strip, Vermont Talks, Brave Little State, WBTV-LP 99.3), tools (UVM's ORCA / BTV Alerts), and community institutions (Front Porch Forum, Big Heavy World, Media Factory, Preservation Burlington, Chittenden County Historical Society).
- Data lives in `data/projects.json`. Invite note: "This page is for linking each other up, not competing."

## 5. Community playlist v1 — `playlist.html`

- **Theme banner per round** (edit `data/playlist.json` → `theme` every other Monday), **submission form** (song, artist, any-platform link, why-you-love-it, optional name, local-artist checkbox), **upvoting** (one vote per visitor per track; the list self-sorts by votes), and a **🍁 local musicians filter**. Platform auto-detected from the link (Spotify/Apple/YouTube/Bandcamp/SoundCloud badges).
- **Two-week rounds, winners kept:** the list resets every other Monday, and a **🏆 Past winners wall** shows the top-voted track of every earlier round, permanently.
- **Moderation queue:** submissions land as `pending` in Supabase and never appear until you flip them to `approved` in the Table Editor (tick `is_local` there too).
- **One-time setup:** run `db/quick-wins.sql` in the Supabase SQL editor (same shared games project). Until then the page shows five verified starter picks (Phish, Grace Potter, Noah Kahan, Rough Francis, Kat Wright) and the form falls back to a pre-filled email to you — still moderated, just by inbox.

---

## What was verified

- All 5 pages served locally and screenshotted at phone width, light + dark mode; no console errors.
- Volunteer filters tested (2 hours + outdoors → correct 3 orgs); playlist form fallback tested end-to-end; JSON files validated; JS syntax-checked.
- Every volunteer/club/project URL curl-checked (only Facebook/Phoenix Books block bots; they work in real browsers).
- Not verified: the Supabase RPCs themselves (they don't exist until you run `db/quick-wins.sql`) — the fallback paths are what's proven.

## Decisions (2026-07-10)

1. **Supabase setup** — Stephen runs `db/quick-wins.sql` once in the SQL editor (walkthrough provided); playlist voting/submissions and the click counter go live the moment it runs.
2. **Beehiiv volunteer page** — after this branch merges and deploys, add a prominent link from the beehiiv page to the new filterable page (do not edit beehiiv before the URL exists).
3. **A/B donate copy** — random sticky 50/50 per visitor, live now (`ACTIVE_DONATE_VARIANT = 'AB'`).
4. **Arcade strip** — done, on `feat/donate-strip` in the hub repo.
5. **Playlist cadence** — two-week rounds (not weekly), past winners stay on a permanent 🏆 wall.
6. **BTV Daily** — kept (Stephen confirms they still publish). CCHS kept too.

## Remaining to spot-check when convenient

- Clubs entries whose cadence shifts seasonally: Bolters Run Club day/time, Local Motion ride schedule, VCC trivia, Burlington Adult Social Sports season, Knot Knite recency, pickleball open-play times, both choruses' join windows. All linked pages are live; only the "when" text may drift.


---

# Burlington Right Now — build summary (feat/weather)

Turn weather-checking into Burlington life: one page (`weather.html`) that answers
"what's it like out, what should I do about it, and can I swim?" — plus Stephen's
own daily read, drafted automatically and published only after his review.

## What shipped

| Piece | Where |
|---|---|
| Data pipeline (hourly) | `scripts/refresh_weather.py` → `data/weather/latest.json`, `beaches.json` |
| Automation | `.github/workflows/refresh-weather.yml` (hourly :45 + 5:40 AM ET draft run) |
| Dashboard | `weather.html` + `js/life.js` + `js/theme.js` + styles in `css/style.css` |
| Life scores (6 + ski stub) | computed client-side in `js/life.js`, formulas documented in-file |
| Can I Swim board | city ArcGIS beach tracker → `beaches.json` → per-beach 🟢🟡🔴 |
| My Read | `scripts/draft_read.py` (+ `scripts/outlets.py`) → `read-draft.json` queue → `scripts/approve_read.py` → `read.json` |
| Shared weather brain | `prompts/weather-read.md`; newsletter repo's CLAUDE.md + run-edition skill now point at it |
| List-page hooks | teaser strip under the daylight arc + weather-pill menu item |

## Data coverage (all keyless, all verified live 2026-07-10)

- **NWS api.weather.gov** (grid BTV/89,56): KBTV observation (temp/feels/humidity/wind,
  metric→US converted), 7-day + hourly forecast, apparentTemperature & skyCover grid
  layers (joined into the hourly array), active alerts, and the **Area Forecast
  Discussion** — KEY MESSAGES parsed out for the read. 4–5 AFD issuances/day.
- **Lake Champlain recreational forecast** (NWS product `REC`, ~2:30 AM/PM daily
  Apr–Dec): all three lake zones parsed (wind knots, gusts, waves ft per period),
  plus its UV line and USGS gage table. Off-season: issuance stops; a stale product
  (>24 h) renders as "suspended" client-side.
- **USGS 04294500** (Lake Champlain at Burlington): water temp + lake level every
  15 min. Level bands: <99 normal, 99–100 elevated, ≥100 flood (NWS flood stage).
- **AirNow** (keyless `airnowgovapi.com/reportingarea` — the endpoint behind
  airnow.gov): observed AQI from the real Burlington monitor (VT DEC) + the
  forecaster's discussion text. Fallback: Open-Meteo CAMS model AQI. Undocumented
  endpoint — coded defensively, falls back automatically.
- **Open-Meteo**: sunrise/sunset/UV, and the **multi-model spread** (GFS vs ECMWF vs
  ICON daily highs/precip) — the quantitative "where forecasts diverge" signal.
- **City of Burlington beach tracker** (first-party ArcGIS,
  `maps.burlingtonvt.gov/.../BTV_Beach_Status`): per-beach Open/Alert/Closed covering
  BOTH E. coli (sampled Mon+Thu, posted by 11 AM Tue/Fri; closed >235 MPN/100mL) and
  cyanobacteria (visual checks daily from 11 AM in season, posted by noon). N/S
  sample pairs collapse worst-of into the five dashboard beaches. Stale rows (>72 h,
  i.e. off-season) render "no current data". VT DOH cyanobacteria tracker
  (`services.arcgis.com/YKJ5JtnaPQ2jDbX8/...`) verified as a corroborating source but
  not wired in — the city feed already includes cyano status.
- **Outlets for the daily read only** (`scripts/outlets.py`, never load-bearing):
  Weather Underground embedded TWC forecast (also = weather.com's data), WCAX's
  displayed numbers + meteorologist-written discussion, NBC5's latest First Warning
  article headline/lede. AccuWeather is bot-blocked — dropped.

Failure contract everywhere: each section fetches independently; a failure keeps the
last good data (same as `refresh-data.yml`). The site never sees a broken file.

## Life-score formula rationale

All scores: a **feels-like comfort trapezoid** (full credit in an ideal band, sloping
to zero over a slack range) minus activity-specific penalties, clamped 0–10. Verdicts:
8+ great / 6+ good / 4+ fair / else skip. Every card's "why?" drawer shows the actual
terms, so the math is public. Scores recompute per remaining hour of today, which also
yields the "better around 5 PM" / "good until about 9 PM" hints (suggestions confined
to waking hours except open-window).

- **Patio** — ideal feels 64–82. Rain is the killer (weight 7); wind >10 mph steals
  napkins (0.35/mph over); AQ at light exertion (×0.7); dark+cool −2, but warm summer
  nights stay prime time.
- **Sunset** — scored at the sunset hour, not now. 25–65% sky cover is the sweet spot
  (clouds are the canvas: peak at ~40%); bare-clear scores 7.5; overcast decays fast.
  Rain at sunset weight 8; AQI >100 smoke −2 (mutes color); waterfront chill a minor
  −1.5 max.
- **Swimming** — water temp dominates: 72°+ →10, 68+ →8.5, 64+ →6.5, 60+ →4.5, <60
  hard-capped at 3 regardless of the air. Cool shore air up to −4; broad-lake waves ≥2 ft
  −1.5/ft; rain/storm weight 6; after dark −4. Posted advisories live on the swim board
  rather than in this number.
- **Running** — ideal feels 42–64 (runners run warm). Dewpoint is the honest misery
  index: −0.25/degree over 55 (cap 4). AQ gets the biggest exertion multiplier (×1.5).
  Light rain barely matters (weight 3).
- **Open-window** — evaluated over the next ~14 h (the overnight is the point): outside
  temp 55–68 (sleep-science band), dewpoint over 60 = sticky air (−0.3/deg, cap 3.5),
  rain blowing in (5), smoke coming in (×1.3).
- **Dog-walk** — wide band (feels 35–75; dogs love brisk). Hot-pavement paw risk: sunny
  + ≥85° + daylight = −2.5. Rain 5, AQ ×1.0.
- **Ski** — stubbed card ("back this winter"); slot reserved in `SCORE_META`/render.

## My Read + review queue

Morning Action run (5:40 AM ET) builds a source packet (NWS + AFD + lake + gage +
model spread + AQI + WU/WCAX/NBC5) and, when the `ANTHROPIC_API_KEY` secret exists,
drafts the report per `prompts/weather-read.md` — hook first, casual numbers, model
divergence as story, practical closing call, 90–180 words. The draft lands in
`data/weather/read-draft.json` (committed, but **never displayed**). Approval:
`python3 scripts/approve_read.py [--edit] [--push]` promotes it to
`data/weather/read.json`, which the page shows with its approval timestamp. A draft
written from today's live packet is sitting in the queue now as a worked example.

**One weather brain:** the newsletter pipeline (`~/Desktop/newsletter`) step 6 now
reads `latest.json` + the approved `read.json` + the same prompt file before adding
its WCAX/NBC5 gathers — dashboard and newsletter can't disagree.

## Independent review

GPT-5.6 (Codex, read-only) reviewed the full diff; 13 findings, all triaged and the
real ones fixed: REC lake product now marked suspended when its issuance is >36 h old
(off-season safety); beach aggregation reordered so a known closure always wins and a
missing sample row can't be skipped (red > yellow > unknown > green, missing = unknown);
sun timestamps serialized with UTC offsets and all client clock/hour logic pinned to
America/New_York (was wrong for visitors outside Eastern); freshness stamp now reads the
hourly section's own timestamp and scores hide entirely when data is >24 h stale; the
9:40/9:45 workflow overlap got a concurrency group + push rebase-retry; wind ranges
("10 to 20 mph") now take the max; AirNow observations validated numeric; USGS must
return both series or the previous section is kept; `zoneinfo` replaced hardcoded UTC−4
(DST); explicit None checks replaced `or`-chains that treated 0°F as missing. One
finding declined deliberately: open-window's headline number stays the *current-hour*
score (it answers "should they be open right now"); the overnight is served by the
20-hour hint window ("better around 11 PM").

## Verification performed

- `refresh_weather.py` run repeatedly: 10/10 sections fresh, real values spot-checked
  against sources (81° KBTV obs, lake 70°/96.65 ft matching the REC product's own gage
  table, AQI 56 Moderate = wildfire smoke day, Euro-vs-GFS precip divergence 93% vs 25%).
- `outlets.py` and `draft_read.py` run live; packet verified complete; no-key fallback
  produces a packet-only draft as designed.
- Page verified in Chrome on localhost: hero stats, sun arc, sources row, My Read
  render; why-drawer toggles with correct term breakdowns; swim board shows all five
  beaches green with today's sample times; dark mode; footer strip (Ko-fi/newsletter/
  about) and attribution. No console errors. Mobile relies on the same ≤560px
  media-query patterns as the rest of the site (the browser extension wouldn't shrink
  below ~1450px to eyeball it).
- `data/weather/read.json` intentionally absent from the branch: the section stays
  hidden until Stephen approves his first read.

## Open questions

1. **Publish cadence of commits** — hourly data commits will dominate the repo history
   (like refresh-data already does). Fine, or want the weather Action squashed/less
   frequent overnight?
2. **First approved read** — a demo draft is queued for 2026-07-10; run
   `python3 scripts/approve_read.py --edit` to review/publish it (or discard).
3. **ANTHROPIC_API_KEY secret** — add it in repo Settings → Secrets to get generated
   drafts each morning (suggested model set via `WEATHER_READ_MODEL`, default
   claude-sonnet-5; the prompt is the quality lever). Without it the queue still fills
   with packets.
4. **Model divergence in the header?** — right now the spread only feeds the read.
   Could add a small "models disagree today" badge when high-spread ≥5° or PoP spread
   ≥40.
5. **VT DOH tracker as second opinion** — worth wiring in as a "state says" column if
   the city feed ever lags (it froze once before, winter 2025).
6. **Ski slot** — winter data sources to line up: Bolton/Smuggs/Stowe snow reports
   (scrape-hostile), NOHRSC snow depth, VT ski areas association feed. Decide the
   season's sources before December.
7. **weather.html discoverability** — teaser + pill menu now; want a proper nav tab
   ("Right Now") next to The List / Guides instead?
