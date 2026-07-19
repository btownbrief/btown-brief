# Contractor Directory — Data Build Summary

**Branch:** `feat/contractors` · **Built:** 2026-07-19 (pass 1: VBRA) + 2026-07-19 (pass 2: DFS address-grouping)

## What shipped

A business-level contractor/handyman directory layer on top of the existing
DFS licensing-rolls backbone (`data/contractors.json`, from a prior session), built
in two passes — see "Pass 2" below for why a second pass happened same-day:

- **`data/contractors/directory.json`** — 11 publishable business listings.
- **`data/contractors/review-queue.json`** — 8 items needing your judgment call,
  each with a `review_reason` and `evidence_needed`.
- **`data/contractors/excluded.json`** — 1,489 dropped records, each with a reason
  (`individual-without-business`, `non-contractor`, or `out-of-scope`).
- **`data/contractors/directory.csv`** — spreadsheet mirror of `directory.json`.
- **`data/contractors/places-cache.json`** — cached Google Places responses (place_id
  + basic/contact fields only — no ratings or review text, per Places ToS) so a rerun
  doesn't re-bill.
- **`data/contractors/source/05-contractor-dataset.json`** — a copy of the pass-1 (VBRA)
  input dataset, kept in the worktree so the build is self-contained and reproducible.
- **`data/contractors/source/05-dfs-full-columns-pull.json`** — the pass-2 fresh DFS
  pull (1,474 rows, all 10 available columns including `street_address`).
- **`scripts/build_contractors_directory.py`** — pass-1 build script (VBRA); rerun any
  time the source dataset or the hand-reviewed VBRA decision table changes.
- **`scripts/build_contractors_dfs_pass2.py`** — pass-2 build script (DFS address
  grouping); rerun any time you want a fresh DFS pull re-evaluated. It merges its
  output on top of whatever pass 1 already wrote, so run pass 1 first if both need
  a fresh run.
- **`js/contractors.js`**, **`contractors.html`** — updated to fetch `directory.json` and
  render it as the page's existing "Vetted picks" section, on top of the unchanged
  licensing-rolls list.

## The starting datasets

**Pass 1 (VBRA):** 1,504 rows from the original research pull: 1,467 VT DFS individual
license holders (Electrician/Plumber/Gas Installer/Oil Installer, live pull from
`data.vermont.gov`, 224 already expired, **no street address, phone, or business name
carried into this particular pull**) + 37 VBRA Remodelers Directory entries (12 of
those are VBRA's own "non-trade associate member" tier — lenders, insurers, a fiber
ISP, an accounting firm, two design firms VBRA itself classifies as associate rather
than builder members).

**Pass 2 (DFS address grouping):** a fresh, second pull of the same live DFS API, this
time requesting every column the dataset actually has. See "Pass 2" section below.

## Method — Pass 1 (VBRA), 2026-07-19

**DFS rows (1,467) → all excluded, as `individual-without-business`, in pass 1.** This
was the biggest decision in the first pass: Steve's rule #1 requires grouping
individual license holders into a business only where the data supports it (shared
business/employer name, shared address, or shared phone), and requires independent
verification before listing an unaffiliated individual as a business. That particular
DFS pull carried **none** of those fields — just name, license info, town, and zip. No
street address, no phone, no business name at all. There was nothing to group on and
nothing to verify against, so every DFS row was excluded with an honest reason rather
than guessed at. **Pass 2 (below) revisits this** with a fresh pull that does have
`street_address`, per the coordinator's follow-up instruction — see that section for
what changed and what didn't.

**VBRA rows (37) → read individually (small enough to do by hand, which rule #8
requires anyway for anything short of a mechanical fact-check):**
1. The 12 "Non-trade VBRA associate member" rows → excluded, `non-contractor`.
2. Of the remaining 25 trade rows, 2 are suppliers by their own business name (Hauke
   Building Supply, Goodro Lumber) despite VBRA's category tag → excluded.
3. 1 is an out-of-state duplicate-name entity (a second, unrelated "Allen Pools & Spas"
   in Lebanon, NH) → excluded.
4. 4 more are headquartered in a VT county that does **not** border Chittenden
   (Geobarns/White River Junction-Windsor, Carroll Concrete/Newport-Orleans, Ennis
   Construction/Quechee-Windsor, Cocoplum Appliances/Brattleboro-Windham) → excluded,
   `out-of-scope`. This is objective VT county-adjacency geography, not a taste call.
5. The remaining candidates and the businesses in an **adjacent** county (Franklin,
   Grand Isle, Addison — VBRA tags them as serving Chittenden even though their HQ
   isn't in it) went to Google Places for confirmation.
6. VBRA's own auto-guessed `category` field (a keyword match against ~180 service tags,
   flagged in its own schema notes as needing a human pass) was corrected against the
   business's own name where the name made the real trade obvious — e.g. "BLUE SKY
   ROOFING" was tagged "General Contractor," corrected to Roofing; "Green State
   Builders" was tagged "Appliances," corrected to General Contractor & Remodeler.

**Google Places (legacy Find Place From Text + Place Details).** A working key was
found in `~/btown-brief-prompts/secrets.env` (`GOOGLE_MAPS_API_KEY`, already used by
`btown-guide-work/tools/refresh-hours.py`) and verified against 3 test calls before the
batch — legacy Places still works on this project, matching your prior experience.
18 businesses were shortlisted (everything that was a publish or review-queue
candidate); each got a Find Place From Text search on `"{business name}, {town}, VT"`
followed by a Place Details call for `name, formatted_address,
formatted_phone_number, website` when exactly one candidate came back. **32 Places API
calls total** across the whole build (well under the 350-call ceiling) — cached to
`places-cache.json` by query text so a rerun is free.

A candidate only stays in the **publish** tier if Places returns exactly one confident
match. Zero or multiple candidates demotes it to the review queue instead (3 cases: Culligan
Water Technologies initially returned 2 candidates on the first pass and resolved to 1
on a retry — Google's fuzzy text search isn't perfectly deterministic — but Builders
Installed Products and Godbout Development stayed ambiguous both times and are queued
with the full candidate list attached so you can pick manually). Where Places confirmed
a physical address, that address's town **replaced** VBRA's self-reported town in the
final listing — a few VBRA rows had a stale or wrong town (BLUE SKY ROOFING listed
itself as Colchester; Places' confirmed office is actually in Richmond, still
in-county). One genuinely interesting find: two separate VBRA rows both named "Hayward
Design Build" (one listed South Hero, one Colchester, different phone numbers) resolved
to the **identical** Google place_id — proof they're one business with two stale VBRA
profile entries, not two businesses. They're merged into a single review-queue item
(HQ is South Hero, Grand Isle County — adjacent, not in Chittenden — so it's queued for
your service-area call either way).

Per-row Places output only ever stores `place_id`, `formatted_address`,
`formatted_phone_number`, and `website` — no ratings, review counts, or review text, per
the caching rules in the research brief.

## Method — Pass 2 (DFS address grouping), 2026-07-19, same day

Requested by the coordinator: 10 published listings from VBRA alone was too thin
against Steve's "100 excellent listings" goal, and pass 1 had already identified the
remedy (re-pull DFS with `street_address`).

**Step 1 — confirmed the real column list, not assumed it.** Fetched
`https://data.vermont.gov/api/views/cy8e-89cz.json` (the dataset's own Socrata
metadata endpoint) before pulling any rows. The DFS Licensing MasterList has exactly
10 columns: `last_name`, `first_name`, `street_address`, `city`, `state`, `zip_code`,
`license_number`, `license_exp_date`, `type_desc`, `level_desc`. **`street_address`
exists** (confirming pass 1's guess); **no business/employer/dba column exists at
any point** — confirmed against the live schema, not assumed.

**Step 2 — fresh pull.** Same trade filter (Electrician/Plumber/Gas Installer/Oil
Installer) and the same 18 Chittenden County towns used for VBRA scope-checking in
pass 1 (this time as a city-name filter rather than a zip-code list, since the exact
20-zip list pass 1's authors used wasn't recorded verbatim anywhere — city name is the
more auditable, reproducible filter and is the one this build's own scope logic
already uses). Result: **1,474 rows** — close to pass 1's 1,467 but not identical; the
live DFS dataset updates roughly daily, so some drift between two pulls on different
days is expected and already flagged as normal in pass 1's own gap notes.

**Step 3 — grouped conservatively.** Normalized `street_address` (uppercase, collapsed
whitespace, no abbreviation-guessing — deliberately conservative, since guessing that
"Rd" = "Road" risks *inventing* a match) and grouped rows by (address, city, trade).
Rows whose address is the literal placeholder text `"BAD ADDRESS"` (DFS's own marker
for an address it doesn't have) or a PO Box were dropped from grouping entirely —
neither is a verifiable physical location. Within each address+trade group, collapsed
duplicate license records for the *same* individual (e.g. someone re-licensed, or
whose first name appears as "Andrew" on one record and "Andrew C." on another) so they
don't masquerade as two people. This left **16 groups of 2+ genuinely distinct
people** sharing a street address and trade, covering 32 of the 1,474 rows. The other
1,442 rows are singletons — no one else licensed in the same trade shares their
address — and stayed excluded per the coordinator's explicit instruction ("An
individual at an address with no corroborating second signal ... stays excluded").

**Step 4 — required independent verification before publishing any of the 16, not just
a shared address.** Read by hand, it was immediately obvious most of these 16 groups
are family members or roommates sharing a home (e.g. two people with the same last
name, or a parent/"Jr." pair) — a shared *address* is real corroboration for "these two
people are connected," but it is not corroboration for "this is a business" on its own.
So each of the 16 got a Google Places Find Place From Text search on the address
itself (`"{street_address}, {town}, VT"`), and — only when every person in the group
shares a surname — a second search combining that surname with a trade-appropriate
guess (`"{Surname} Electric"`, `"{Surname} Plumbing"`, `"{Surname} Heating"`). No
business name was ever invented outright: the published name always comes verbatim
from what Places itself returned. A first pass at this logic had a real bug — it
compared Places' returned name against the exact query text to catch a bare geocoded
address (e.g. Places just echoing "126 Sadie Ln" back), but that check missed
abbreviation differences (query said "Lane", Places said "Ln") and let 8 plain
residential addresses through as false "verified businesses." Caught on manual
inspection before those were written to `directory.json` (they were nonsensical —
business names like "94 Hunting Ridge Ln"), fixed with a proper street-suffix pattern
match, and the 8 affected cache entries were invalidated and re-evaluated for free
(no new billed calls, since query text and pattern-matching are local).

**Result of the 16 groups:** 14 had no independently verifiable business at that
address (Places either found nothing or just echoed the residential address back) →
stayed excluded, now with a specific reason ("shares this address with N other
license holder(s), but Places found no business here"). 2 resolved to a real,
independently-confirmed business:
- **Fisher's Heating & Gas** (Jericho) — 2 active Gas Installer licenses (Adam A.
  Fischer, Justin MW Fischer) at the same address; a `"Fischer Heating"`-style search
  found a real Google Business listing, phone, and website
  (`fischersheatingvt.com` — note the family spells their surname "Fischer" but the
  business trades as "Fisher's"). **Published** — both licenses are active.
- **Yankee Plumbing & Heating Inc** (Winooski) — 2 Plumber licenses (Kyle C. Crete,
  Kevin M. Crete) at the same address, found via a `"Crete Plumbing"` search. **Both
  licenses are expired** (Jan and Mar 2025) — per the coordinator's rule ("Active
  licenses only publish; expired-only → review queue"), this goes to the **review
  queue**, not straight to publish, even though the business itself was independently
  confirmed.

This is the first Plumber- and HVAC & Heat Pumps-relevant data this build has
produced from DFS. Plumber still has **zero published** listings (Yankee Plumbing's
licenses are expired), but HVAC & Heat Pumps now has one (Fisher's Heating & Gas).

## Counts (after both passes)

| Stage | Count |
|---|---|
| Input rows | 1,511 (37 VBRA + 1,474 fresh DFS pull) |
| -> Published (`directory.json`) | **11** (10 VBRA + 1 DFS) |
| -> Review queue (`review-queue.json`) | **8** (7 VBRA + 1 DFS) |
| -> Excluded (`excluded.json`) | **1,489** |
| &nbsp;&nbsp;&nbsp;- individual-without-business (DFS singletons, no shared address) | 1,442 |
| &nbsp;&nbsp;&nbsp;- individual-without-business (DFS, shared address but no verifiable business) | 28 |
| &nbsp;&nbsp;&nbsp;- non-contractor (VBRA associate members) | 12 |
| &nbsp;&nbsp;&nbsp;- out-of-scope (supplier / out-of-state dup / out-of-county, VBRA) | 7 |
| Google Places calls, pass 1 | 32 (test calls + batch) |
| Google Places calls, pass 2 | 45 (32 on a buggy first run whose false positives were caught before publishing, then re-evaluated locally for free; 13 new billed calls after the fix) |
| **Google Places calls, running total** | **~85 of 350 budget** (includes 3 pre-batch verification calls from pass 1) |

**Published (11), by category:** General Contractor & Remodeler 5, Electrician 1,
Flooring 1, HVAC & Heat Pumps 1, Pool & Spa 1, Roofing 1, Windows & Doors 1.

**Review queue themes:** adjacent-county HQ needing a service-area call (Bourbeau
Custom Homes, Chevalier Drilling, H.J. LeBoeuf & Son, and the merged Hayward Design
Build) — 4; ambiguous/no confident Google Places match (Builders Installed Products,
Godbout Development) — 2; residential-vs-commercial scope call (Dousevicz, Inc.) — 1;
Places-confirmed business with only expired licenses (Yankee Plumbing & Heating) — 1.

**Categories with zero published listings after both passes:** Plumber (one
Places-confirmed candidate exists but its licenses are expired — see review queue),
Handyman, Painting, Landscaping. Handyman and Painting/Landscaping reflect real data
gaps (no source in either dataset touches them at all), not a screening decision.

## Known gaps and recommended next steps

1. ~~DFS individual rows carry no business-identifying data in this pull~~ — **done in
   pass 2** (see above). The result was smaller than a first read of the gap might have
   suggested: only 2 of 1,474 fresh DFS rows turned into real, independently-verified
   businesses (1 published, 1 queued on expired licenses); the other 1,470 are either
   true singletons (1,442) or shared an address with no verifiable business behind it
   (28 — almost all family members at a shared home). That's not a bug in the method,
   it's what "individual license holder" data actually looks like once you require real
   corroboration instead of guessing — DFS licenses *people*, and most licensed
   electricians/plumbers/gas installers work *for* a business rather than *owning* one
   under their own name at their home address. **Further follow-up, if still worth it:**
   Yankee Plumbing & Heating (Winooski) is a real, Places-confirmed business whose two
   DFS plumber licenses (Kyle C. Crete, Kevin M. Crete) both show expired — worth a
   quick manual check (a new/renewed license, or a different license holder now working
   there) before Steve rules it in or out from the review queue.
2. **No handyman source exists in this dataset at all** (a known gap carried over from
   the research brief — handymen are unlicensed in VT, so no state registry covers
   them). The Handyman category is empty because no handyman rows were ever gathered,
   not because any were screened out. Per your rule, every future handyman row needs
   manual review regardless of source — a good source to try next: a Front Porch Forum
   "recommend a handyman" search (manual, per the research brief's FPF ToS guidance) or
   reader email submissions via the page's existing "Are you one of these people?" box.
3. **Efficiency Vermont's EEN list still isn't pulled.** Confirmed again this pass: the
   "Find a Contractor" tool at `efficiencyvermont.com/find-contractor-retailer` is a
   client-side JS widget with hash-fragment routing — a plain scrape returns the empty
   search form. This would populate HVAC & Heat Pumps specifically (EEN membership is
   required for HVAC/weatherization/electrical trade partners). Manual steps: either
   (a) `firecrawl-interact` to fill the zip field, submit, and read the rendered result
   list for each Chittenden County zip, or (b) email `een@efficiencyvermont.com`
   directly and ask about a data-sharing arrangement — both untried this pass.
4. **OPR Act 182 Residential Contractor Registry still has no bulk export.** Manual
   steps for you: visit `https://sos.vermont.gov/opr/find-a-professional/`, search or
   select "Residential Contractors," and check whether a "Profession Roster Download"
   button appears (mentioned on OPR's general pages but not reachable without logging
   into the interactive Pega portal). If it exports a CSV, treat it like DFS: pull,
   filter to Chittenden zips, and this build's script can be extended to ingest it —
   critically, it should carry actual business names (Act 182 registers residential
   contracting businesses, not individuals the way DFS does), which would unlock a much
   larger General Contractor & Remodeler / Handyman-adjacent layer.
5. **VBRA directory pages 2-3 (members 51-110, of which the research brief separately
   found 80 total serve Chittenden) were never captured** — only page 1's 50 members
   (41 tagging Chittenden, deduped to 37) made it into this dataset. Re-scraping with
   `firecrawl-interact` to click through VBRA's AJAX pagination would roughly double the
   VBRA-sourced candidate pool.
6. **No BBB matching was performed** (`bbb_profile_url` is null on every row) — BBB's
   directory search pages are `robots.txt`-disallowed, so this has to be a manual,
   per-business lookup, same as the research brief found. Not attempted this pass.
7. **The 7 phone-number mismatches flagged in `other_signals`** (Places' phone differs
   from VBRA's listed phone for Floor Coverings International, Green State Builders,
   Allen Pools & Spas, GORDON'S WINDOW DECOR, Culligan Water Technologies, Bourbeau
   Custom Homes, Dousevicz) are all still published or queued — a differing phone
   between a VBRA membership contact and a business's public Google listing is common
   (regional office vs. local branch, owner's cell vs. front desk) and isn't on its own
   evidence of a wrong match, especially where the business name, address town, and
   website all lined up. Flagged for your quick glance, not blocking.

## Verification performed

- Google Places legacy API confirmed working with 3 test calls before the batch run
  (Find Place From Text + Place Details, both via proper `GET` requests — an early
  `curl` test without `-G` silently POSTed and returned a misleading "must use an API
  key" error; fixed before any real calls ran).
- `python3 scripts/build_contractors_directory.py` (pass 1) reconciles its own output:
  published + queued + excluded + merged-duplicates must equal the 1,504 pass-1 input
  rows. Confirmed: 10 + 7 + 1,486 + 1 = 1,504.
- `python3 scripts/build_contractors_dfs_pass2.py` (pass 2) reconciles in *raw DFS row*
  terms (a published/queued business folds 2+ raw rows into one entry via its
  `licenses` array, so the check sums `len(licenses)` for those, not entry counts) and
  hard-asserts on mismatch rather than just printing a warning. Confirmed twice: the
  per-pass check (18 + 2 + 1,454 = 1,474 raw DFS rows) and the final merged check
  (37 VBRA + 1,474 DFS = 1,511 raw rows accounted for across both passes' outputs).
- The pass-2 bare-address false-positive bug (see Pass 2 method above) was caught by
  manually reading the published output, not by an automated check — a real miss in
  the first version of the verification logic, fixed before anything wrong reached a
  committed `directory.json`.
- `node --check js/contractors.js` passes; the `directory.json` -> `curatedCard` shape
  adapter was hand-traced against the real 10-row pass-1 output in Python to confirm
  the rendered `name` / `trade` / `notes` / `review_links` fields come out correctly —
  not verified in an actual browser render this pass, since the page skeleton itself
  wasn't otherwise touched.
- Every published listing's `google_maps_url` and `website` were spot-checked by eye
  against the cached Places response for plausibility (right town, right business
  type) — this is exactly the check that caught the pass-2 bug (a "business" literally
  named after a street address is not plausible).

## Security notes

- The Google Maps API key was read from `~/btown-brief-prompts/secrets.env` into the
  environment only, exactly as `refresh-hours.py` already does — it is **not** written
  to any file in this repo. `places-cache.json` stores only `place_id`,
  `formatted_address`, `formatted_phone_number`, and `website` per business — no
  ratings, review counts, or review text, per the Places ToS caching rules documented
  in the research brief.

## Open questions (your calls)

1. **The 4 adjacent-county businesses** (Bourbeau Custom Homes, Chevalier Drilling,
   H.J. LeBoeuf & Son, Hayward Design Build) — VBRA's own directory tags them as serving
   Chittenden even though their HQ is in a neighboring county. Publish with a "serves
   Chittenden, based in [county]" note, or hold to a strict Chittenden-HQ bar?
2. **Dousevicz, Inc.** — a commercial contractor VBRA member in Essex Junction. Does a
   homeowner-facing directory want commercial-only contractors at all?
3. **Builders Installed Products / Godbout Development** — Google Places couldn't
   confidently disambiguate either (candidate lists are attached in the review queue).
   Do you recognize either business well enough to confirm by hand, or should they stay
   excluded?
4. **Yankee Plumbing & Heating Inc** (Winooski) — a real, Places-confirmed plumbing
   business, but both DFS licenses found there (Kyle C. Crete, Kevin M. Crete) show
   expired as of the dates on file. Worth a quick manual re-check before ruling it in
   or out — a business can easily have a current license under a holder or record this
   build didn't happen to match to that address.
