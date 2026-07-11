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

- **VT511 road incidents** — code is in place (`roads.py`) but dormant behind a free developer key (see Decision 1 below). Enabling it lights up I-89 crash/closure lines, the single best "affects your drive home" source.
- **Restaurant openings as first-class state** — currently food news comes from keyword-routing headlines. The feat/restaurants dataset (282 places, live hours) could yield true state diffs ("Poko listed a new location", "hours changed at Onyx").
- **Front Porch Forum** — no feed, login-walled; would need the newsletter-side pipeline.
- **Reddit scores/velocity** — "blowing up, +300 in 2 hours" needs the JSON API; consider a Reddit app credential someday.
- **City calendar events / permits layer** — both in `data/sources.json`, easy follow-ups.

## Verification performed

- Pipeline run against all real sources 4×: bootstrap emitted 14 genuine events (Monday's City Council agenda, a GMT Essex Junction alert, live r/burlington threads, filtered local news); immediate re-runs emitted 0 (diff engine is stable); the chatter id-scheme migration re-emitted 6 and the 48h dedupe absorbed all 6.
- Page rendered live in Chrome at desktop width, light mode, first-visit state: hero count, category grouping, per-line source links and relative times all correct.
- All client state logic tested headlessly in Node against the real data file: first visit, 19h return visit, quiet state + fallback list, 30-minute reload grace window, and a hostile-event XSS probe (escaped, `javascript:` link dropped) — 5/5 pass (`scratchpad/test-changes-js.mjs`).
- **Dark mode verified** on the live site (Opus session): deep-navy palette, readable cream text, coral accent, cards render as proper raised dark surfaces.
- **Mobile verified** via the live CSS: the page carries its own `max-width: 560px` query plus the shared `.rn-footer-strip { flex-direction: column }` rule (the same one already shipping on weather.html), and the 720px centered containers rule out horizontal overflow; all three footer buttons present.

## What Codex contributed

GPT-5.6 Sol built 6 of 8 fetcher modules to the `common.py` contract (news,
chatter, lake, roads, transit, civic) and ran an independent 11-finding review
of the whole branch. I tightened its output (food-keyword false positives,
obituary noise, Reddit fallback, CivicClerk date-window bug — desc ordering
only ever returned 2027 placeholder meetings) and fixed 8 review findings
(dedupe semantics, corrupt-state fail-closed, write ordering, timestamp
clamps, forecast-flag carry, BTV-timezone day scoping, attribute-safe
escaping, http(s)-only links).

## Decisions made (previously open questions)

1. **511 key — decided: leave it off, made it a 2-minute future toggle.** There's no
   keyless authoritative Vermont incident feed, and 511's own map uses a fragile
   internal endpoint I won't depend on. The real developer portal (buried in the
   511 site footer, not Google-able) is **http://nec-por.ne-compass.com/DeveloperPortal** —
   free registration, covers Vermont. `roads.py` now skips 511 cleanly unless a
   `NE511_API_KEY` env var / GitHub secret is set, then lights up automatically.
   Roads already works without it (city construction map + GMT alerts). Not worth
   blocking a shipped feature on a bonus source.
2. **Newsletter hookup — decided: a flexible digest command, newsletter picks its window.**
   `daily-changes.md` stays as the daily editor's-desk view (last 24h). For the
   Mon/Fri newsletter, run `python3 -m scripts.changes.digest --since 4d`
   (or `--since <last-edition-date>`) — grouped markdown, biggest first, every line
   linked, ready to skim and drop in. It reads the same 7-day `changes.json`, so no
   re-fetching. This beats hardcoding a window: Fri→Mon and Mon→Fri gaps differ, and
   the editor stays in control. See `scripts/changes/README.md`.
3. **Homepage teaser** — a "Since You Checked" teaser card sits under the Right Now
   teaser on index.html, with a header link on weather.html. Easy to move/restyle
   if it ever crowds the top of the list page.
4. **Shipped** — merged to main via PR #19; live at
   https://play.btownbrief.com/btown-brief/changes.html; hourly `refresh-changes.yml`
   confirmed running unattended in CI.
