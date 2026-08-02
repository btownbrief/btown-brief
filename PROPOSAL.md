# Jobs Board v2 — proposal

*What the guide's jobs page should absorb from the job-radar, what it shouldn't,
and how one person keeps it running.*

---

## 1. The two projects, side by side

| | `jobs.html` (the guide) | `~/job-radar` (sister's tracker) |
|---|---|---|
| Audience | Anyone in Burlington | One person, healthcare-admin focus |
| Sources | 5 (Seven Days, UVM, City, State, UVMMC) | 23 employers/boards via ATS adapters |
| Volume shown | ~48 postings, 14-day window | 984 tracked, 141 surfaced as best/look |
| Freshness | posted date, tri-weekly refresh | daily run, first-seen / closed tracking |
| Pay | raw string, crude $25 regex | normalized to ≈$/hr, real $25 floor |
| Quality control | 5 sparse filter tags | scoring, tiers, skip pile with reasons |
| Framing | flat list, newest first | daily digest: "N new today, N closed" |
| State | stateless (jobs.json is the whole file) | persistent DB with open/closed status |

The radar is the better *product* because of four ideas, none of which have
anything to do with the sister's resume:

1. **ATS adapters.** Most Burlington employers sit on ~8 commodity applicant-
   tracking systems (Workday, Greenhouse, ADP, UKG, NeoGov, Workable…), each
   with a public JSON endpoint. One ~30-line adapter per ATS unlocks every
   employer on it. This is how 23 sources cost less code than the guide's 5
   scrapers.
2. **Normalized pay.** Parse "$52,000–$62,000 Annually" and "$26.50/hr" into
   the same ≈$/hr number, so a pay floor actually works across sources.
3. **Digest framing.** "12 new since yesterday" is a reason to come back
   daily; a flat list of 48 is not.
4. **Honest freshness.** Track when a listing appeared and say so; never show
   something stale as new.

## 2. What transfers, what stays behind

**Transfers into v2:**

- The adapter architecture and seven proven adapters (with their exact,
  already-calibrated configs): Workday → **GlobalFoundries**, Greenhouse →
  **Beta Technologies**, Workable → **OnLogic**, UKG Pro → **Howard Center**,
  ADP → **CHCB** and **EastRise Credit Union**, NeoGov → **City of South
  Burlington**, WP Job Manager → **Common Good Vermont** (the statewide
  nonprofit board, filtered to Chittenden County). Sources go **5 → 13**, and
  the new mix is exactly what the current board lacks: private employers,
  manufacturing/tech, nonprofits, a second municipality.
- `parse_pay` — the radar's pay parser, verbatim in spirit. Pay shows as the
  raw string plus a normalized "≈$28–34/hr" hint, and the $25+ filter uses
  the normalized floor instead of a regex guess.
- Digest framing: the page opens with stat tiles (new today / this week /
  employers watched) and the list is grouped **Today / Yesterday / Earlier
  this week / Last week** instead of one flat run.
- The general shape of categorization — but as neutral **categories**, not
  fit scores (below).

**Stays behind in the radar:**

- Resume matching: strong/good/exclude keyword tiers, "best match" scoring,
  the skip pile, commute allowlist tuned to one person. A public board must
  not editorialize about whether a job is good *for you* — it curates what's
  fresh and lets filters do the rest.
- The persistent open/closed database. It's the radar's biggest maintenance
  surface (status transitions, reopened listings, close detection). The
  guide's stateless model — `data/jobs.json` is the entire state, sources
  that fail keep their last good rows, everything ages out — survives neglect
  far better, and the 14-day window makes close-tracking unnecessary: a
  posting two weeks old leaves the page anyway.
- Detail-page fetching for descriptions. The guide keeps its privacy/weight
  contract: listing metadata only, descriptions parsed for pay at fetch time
  and dropped.

## 3. "Are there too many jobs for me to do this?"

Honestly: **no — but only because the right product is curation, not
completeness.** Two things make this true:

**The work scales with sources, not with jobs.** The radar tracks 984 open
listings and its maintenance cost is unchanged from when it tracked 200 —
because the unit of maintenance is the adapter, not the posting. Eight
adapters covering thirteen sources is the whole recurring surface, and the
existing failure contract (each source isolated, failures keep last-good rows
and print loudly, everything ages out in 21 days) means a broken source
degrades to "slightly staler" — never to a broken page. Mon/Wed/Fri Actions
runs; nothing manual.

**An Indeed clone is both impossible and undesirable.** Full coverage of
every Burlington opening means hundreds of stale, duplicated listings — which
is exactly the LinkedIn/Indeed experience people are escaping. The board's
promise should be narrower and stronger: *the Burlington-area postings the local boards list right now, refreshed
daily, every link to the original listing.* That is a bounded product:
the 14-day window caps the page at roughly 100–150 postings no matter how
many sources feed it, and "fresh + direct + well-filtered" is a claim Indeed
can't make. When a reader says "I only know Seven Days and LinkedIn," the
answer isn't a bigger haystack — it's a smaller, fresher one.

The one genuinely manual growth path — employers emailing listings in — lives
in data/jobs-manual.json, which every refresh merges and preserves. Sources are
per-board adapter functions today; a config-driven employer table is future work.

## 4. The v2 design

### Data pipeline (`scripts/refresh_jobs.py`, extended in place)

- Same architecture and contracts: stdlib-only, one function per source,
  isolated failures keep last-good, 21-day cutoff, dedupe by title+employer,
  UVMMC detail-fetch budget untouched.
- New: a config-driven `EMPLOYER_SOURCES` table with the seven ported
  adapters. Every new source supplies a real posted date (Workday's relative
  "Posted N Days Ago" is parsed like the City's already is), so the pipeline
  stays **stateless** — no first-seen bookkeeping needed.
- New fields per job: `cat` (one category) and `pay_hr` (`[lo, hi]`
  normalized hourly, when pay is parseable). `tags` keeps `pay25` /
  `weekend` / `seasonal`, with `pay25` now computed from the
  normalized floor.
- Categories are deterministic, no scoring: each source has a default
  (GlobalFoundries → tech & manufacturing, Howard Center → healthcare & care,
  City/State → government…) and title keywords override it (a custodian at
  UVM is trades & service; a nurse at the State is healthcare). Roughly:
  **Healthcare & care · Government & civic · Education · Tech, engineering &
  manufacturing · Trades, food & service · Office, admin & finance ·
  Community & nonprofit**.
- `MAX_JOBS` rises 60 → 150 with the same protected-source cap logic.

### Page (`jobs.html` + new `css/jobs.css` + rewritten `js/jobs.js`)

Moves from the light Lora "style.css" family to the hub's design system
(`css/hub.css`'s Lake Hour aesthetic): near-black ground, glass panels,
Instrument Serif display type, DM Sans UI, the amber accent. It reads as the
hub's own jobs department, not a separate site.

- **Hero**: serif headline with the digest lede, then three glass stat tiles —
  *New today*, *This week*, *Employers watched* — computed client-side from
  the data. "Last checked …" line under them.
- **Filters**: one row of category pills (single-select, with live counts;
  categories with nothing this week don't render) plus a second row of
  quality chips ($25+/hr when listed, pay listed, weekend, seasonal)
  that AND together. State lives in the URL hash so filtered views are
  shareable.
- **The list**: grouped by recency — *Today / Yesterday / Earlier this week /
  Last week* — with glass rows: title, employer, category; pay pill (amber
  when ≥$25/hr normalized), "new" dot for ≤1 day, source attribution. The
  14-day client-side expiry stays.
- **Employer directory**: the "go straight to the big employers" cards stay
  and grow to include the newly watched employers.
- **"Hiring? It's free"** note card stays — it's the board's only manual
  growth loop and its community differentiator.
- Always dark (like the hub), so `auto-theme.js` and the toggle go away on
  this page; `community.js` strip and footer get glass styles in `jobs.css`.

### What v2 deliberately does not do

No accounts, no saved searches, no email alerts (the newsletter is the alert
channel), no apply-through-us, no open/closed tracking, no job descriptions
stored, no resume matching. Each of those is a second product.
