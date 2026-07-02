# Things To Do in Burlington

A curated guide to Burlington, Vermont — built for the Burlington Brief.

Static HTML + vanilla JavaScript, no build step required. Works in any browser; deploys to GitHub Pages by pushing the folder.

---

## Previewing Locally

You need a local web server because browsers block data file loading on `file://` URLs.

**Easiest way (built into Python):**

```bash
cd /path/to/btown-brief
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

**To stop it:** press `Ctrl + C` in the terminal.

---

## Deploying to GitHub Pages

1. Create a new GitHub repository (e.g. `btown-brief`)
2. Push this entire folder to the `main` branch:

```bash
cd /path/to/btown-brief
git init
git add .
git commit -m "Initial site"
git remote add origin https://github.com/YOUR_USERNAME/btown-brief.git
git push -u origin main
```

3. In the GitHub repository: **Settings → Pages → Source → Deploy from branch → `main`, `/ (root)`**
4. Your site will be live at `https://YOUR_USERNAME.github.io/btown-brief/` in a minute or two.

---

## Adding or Editing Content

### Adding a Place (things.json)

Open `data/things.json`. Each entry follows this shape:

```json
{
  "id": "unique-hyphenated-id",
  "name": "Place Name",
  "group": "Food & Drink",
  "category": "Restaurant",
  "neighborhood": "Downtown / Church St",
  "cost_tier": "$",
  "cost_note": "Entrees $12–18",
  "season": ["Year-Round"],
  "time_of_day": ["Afternoon", "Evening"],
  "indoor_outdoor": "Both",
  "good_for": ["Date Night", "Locals' Pick"],
  "vibe": ["Cozy", "Local Institution"],
  "blurb": "One or two sentences. Lead with a specific — a dish, a price, a detail — not the category. No banned phrases (see below).",
  "why_special": "The one thing that makes this different from everywhere else like it.",
  "address": "123 Main Street, Burlington, VT",
  "coords": [44.4774, -73.2140],
  "website": "https://example.com",
  "image": null,
  "has_guide": false,
  "guide_id": null,
  "source": "how you know this",
  "last_verified": "2026-06"
}
```

**Controlled vocabulary** — values for each field must come from this list:

| Field | Valid values |
|---|---|
| `group` | Food & Drink, Outdoors, Culture, Live & Events, Do & Play, Shopping |
| `cost_tier` | Free, $, $$, $$$ |
| `indoor_outdoor` | Indoor, Outdoor, Both |
| `season` | Spring, Summer, Fall, Winter, Year-Round |
| `time_of_day` | Morning, Afternoon, Evening, Late Night |
| `good_for` | Date Night, Groups & Friends, Solo, Family & Kids, Rainy Day, Sunny Day, Cheap Eats, Quick Stop, Half Day, Special Occasion, Visitors, Locals' Pick |
| `vibe` | Laid-back, Lively, Romantic, Quirky, Iconic, Underrated, Scenic, Cozy, Lakeside, Historic, Outdoor Seating, Dog-Friendly, Kid-Friendly, Local Institution |
| `neighborhood` | Downtown / Church St, Old North End, New North End, South End, Hill Section, UVM / University, Waterfront, Winooski, South Burlington, Essex / Essex Jct, Williston, Shelburne, Colchester, Greater Burlington |

For the full list see `data/taxonomy.json`.

**Banned phrases in blurbs:** "perfect for," "must-visit," "nestled in," "hidden gem," "boasts," "vibrant." Cut them.

**Required:** at least one verifiable specific per entry (a price, a year, a named dish, a measurable fact).

### Finding coordinates

Go to [Google Maps](https://maps.google.com), right-click the location, click the coordinates that appear. Paste them as `[latitude, longitude]`.

### Upcoming events (calendar.json)

The **Upcoming** banner near the top of the List is fed by `data/calendar.json` — this is your 6-month event calendar. Each entry:

```json
{
  "id": "vt-brewers-fest-2026",
  "name": "Vermont Brewers Festival",
  "date": "2026-07-17",
  "date_display": "Mid-July",
  "note": "Waterfront Park · dozens of Vermont breweries",
  "link": "https://www.vermontbrewers.com/...",
  "tentative": true,
  "hidden": false
}
```

- `date` (ISO `YYYY-MM-DD`) is used only for **sorting and auto-hiding** — events whose date has passed drop off automatically. Approximate is fine.
- `date_display` is the human label shown on the banner (`"Mid-July"`, `"Aug 28"`, whatever reads best).
- `tentative: true` is just a marker for you (dates you haven't confirmed); it doesn't change display.
- The banner shows the next 12 upcoming events, soonest first.

The file ships **seeded with a handful of major annual events at approximate dates** — replace them with your real calendar. (`events.json` is the old "this week" strip and is no longer used.)

### Weather menu links

The header weather pill opens a small menu with two links you can edit in `index.html`:
- **Full forecast** → `weather.com` (Burlington page `USVT0033`).
- **Read the weather in the Brief** → your newsletter. This one auto-points to the latest issue URL from `newsletter.json`; the hardcoded `href` is just the fallback.

### Newsletter preview + "Events This Week" (auto-pulled)

Both are parsed automatically from your latest beehiiv issue by the refresh Action — nothing to edit by hand.

- **Newsletter banner preview** (`newsletter.json`): the Action grabs the **first paragraph of your "Weather & … Rundown" section** — i.e. the weather forecast itself — and shows it under the issue title.
- **"Events This Week" banner** (`events-week.json`): the Action then reads the **day-by-day curated paragraphs right after the weather** (the ones that start "Monday…", "Tuesday…", etc.), dates each one to that weekday of the issue's week, and saves them. The site shows each day as a card and **hides days that have already passed**, so Monday's picks drop off on Tuesday and by Thursday only Thursday is left. A fresh Monday or Friday issue repopulates it.

Both depend on your issue keeping that structure: a heading containing the word "Weather", the forecast as the first paragraph, then one paragraph per weekday. If you restructure the newsletter, tell me and I'll adjust the parser.

### Adding a Guide (guides.json)

Open `data/guides.json`. There are three guide types:

**Roundup** — automatically pulls from `things.json` using filters:
```json
{
  "id": "my-roundup",
  "type": "roundup",
  "title": "Guide Title",
  "tagline": "One sentence tease.",
  "cover_class": "guide-card-cover-outdoor",
  "intro": "Intro text. Separate paragraphs with a blank line.",
  "filter": {
    "good_for": ["Date Night"],
    "cost_tier": ["$", "$$"]
  },
  "sort": "featured"
}
```

**Itinerary** — a sequenced day, written as *experiences* with a time, a title, a paragraph, and the place(s) each stop involves. Each place becomes a tappable chip that opens the full detail drawer:
```json
{
  "id": "my-itinerary",
  "type": "itinerary",
  "title": "A Good Day",
  "tagline": "One sentence tease.",
  "cover_class": "guide-card-cover-night",
  "intro": "Intro text. Blank line = new paragraph.",
  "items": [
    {
      "time": "9:00 AM",
      "title": "Start with the best breakfast in town",
      "body": "A sentence or two in the local voice — lead with a specific.",
      "things": ["penny-cluse-cafe", "cafe-hot"]
    },
    { "time": "11:00 AM", "title": "…", "body": "…", "things": ["waterfront-park"] }
  ]
}
```
(A plain list of ids like `["foam-brewers", "waterfront-park"]` still works as a simple fallback.)

**Ranked** — the same experience format as an itinerary, but numbered instead of timed (this is the Top 100). Each item is `{ "title", "body", "things": [ids] }`. To re-rank, reorder the items in the `items` array of the guide with id `top-100`; to reword an entry, edit its `title`/`body`. The whole Top 100 is authored by hand in `data/guides.json`.

**Place** — a long-form deep dive on one entry (`"type": "place"`, plus `"thing_id"` pointing at the entry and a `"sections"` array — copy the Switchback guide as a template). After adding one, set `"has_guide": true` and `"guide_id"` on the matching entry in `things.json`.

**Cover classes** available: `guide-card-cover-outdoor`, `guide-card-cover-food`, `guide-card-cover-date`, `guide-card-cover-night`, `guide-card-cover-free`, `guide-card-cover-family`, `guide-card-cover-roundup`, `guide-card-cover-place`.

### Adding a sponsor (sponsors.json)

Open `data/sponsors.json` (starts empty) and add:

```json
{
  "name": "Sponsor Name",
  "image": "assets/img/sponsor-logo.png",
  "url": "https://sponsor-site.com",
  "placement": "footer",
  "active": true
}
```

`placement` is `"footer"` (block above the site footer) or `"list"` (a labeled card inserted every 12 entries in the list). Set `"active": false` to pause a sponsor without deleting it. When no sponsors are active, the slots disappear entirely.

### Adding a community photo (photos.json)

1. Save the submitted photo into `assets/img/community/` (create the folder the first time).
2. Add an object to `data/photos.json`:

```json
{
  "image": "assets/img/community/june-sunset.jpg",
  "credit": "Photographer Name",
  "caption": "Sunset from the breakwater",
  "date": "2026-06-28"
}
```

Newest `date` shows first. Photos come in through the "Submit a photo" Google Form linked on the site.

### Adding an FAQ (faq.json)

Open `data/faq.json` (starts empty) and add:

```json
{
  "question": "Where should I watch the sunset?",
  "answer": "Your answer, written in your own words.",
  "reddit_links": [
    { "label": "How locals answered", "url": "https://www.reddit.com/r/GoodBurlington/..." }
  ]
}
```

The FAQ section only appears once this file has at least one entry.

---

## Auto-Updating Data (GitHub Actions)

The workflow in `.github/workflows/refresh-data.yml` runs hourly and refreshes two files — you never edit these by hand:

- `data/reddit.json` — latest posts from r/GoodBurlington ("From the community" section)
- `data/newsletter.json` — latest Burlington Brief issue title + link (the teaser bar)

**One-time setup after pushing to GitHub:**

1. Repo **Settings → Actions → General → Actions permissions** → "Allow all actions"
2. Same page, **Workflow permissions** → "Read and write permissions" → Save
3. **Actions** tab → "Refresh community data" → "Run workflow" to test it immediately

If a fetch fails, the workflow keeps the last good file — it never commits broken data. Until the first successful run, both sections simply stay hidden on the site.

---

## File Structure

```
btown-brief/
├── index.html              ← All the HTML (don't need to edit this)
├── css/
│   └── style.css           ← All the styles
├── js/
│   ├── app.js              ← List mode, filtering, detail drawer, community sections
│   ├── guides.js           ← Guides mode (Top 100, itineraries, roundups, place guides)
│   ├── weather.js          ← Live weather + ambient weather layer (Open-Meteo)
│   └── sun.js              ← Daylight arc / sunset countdown (Open-Meteo)
├── data/
│   ├── things.json         ← Master list of places — edit this
│   ├── guides.json         ← Guide definitions — edit this
│   ├── calendar.json       ← Upcoming events (your 6-month calendar) — edit this
│   ├── events.json         ← Legacy "this week" strip (unused; calendar.json drives Upcoming)
│   ├── taxonomy.json       ← Controlled vocabularies (rarely needs editing)
│   ├── sponsors.json       ← Sponsor slots — edit this (starts empty)
│   ├── faq.json            ← Top questions — edit this (starts empty)
│   ├── photos.json         ← Community photos — edit this (starts empty)
│   ├── reddit.json         ← AUTO-GENERATED by the Action — don't edit
│   ├── newsletter.json     ← AUTO-GENERATED (title, link, weather preview) — don't edit
│   └── events-week.json    ← AUTO-GENERATED ("Events This Week" from the newsletter) — don't edit
├── .github/workflows/
│   └── refresh-data.yml    ← Hourly data refresh (Reddit + newsletter)
├── assets/
│   └── img/                ← Place images; community photos in img/community/
├── COVERAGE.md             ← Content coverage report
└── README.md
```

---

## Live Weather & the Ambient Weather Layer

The header shows current Burlington conditions (Open-Meteo, no API key). The site also draws a subtle full-screen effect matching the weather — falling snow, rain streaks (lighter for drizzle), or a soft sun glow. It's automatically disabled for visitors whose systems request reduced motion.

**To preview any mode regardless of the real weather**, add `?wx=` to the URL:
`?wx=sun` · `?wx=lightrain` · `?wx=rain` · `?wx=storm` · `?wx=snow`

## The Daylight Arc

Below the newsletter bar, a live arc shows today's sunrise and sunset with the sun riding a gradient between them and a countdown ("3h 24m until sunset") that ticks to the second in the final hour. After dark it flips to a muted marker and counts down to sunrise. Data is Open-Meteo (no key); all math uses absolute timestamps so it's correct from any timezone. Lives in `js/sun.js`.

**To preview any time of day**, add `?sunf=` to the URL: `?sunf=0` (sunrise) → `?sunf=1` (sunset), e.g. `?sunf=0.5` for midday, or `?sunf=night`.

---

## Dark Mode

The dark mode toggle in the header switches themes in-memory. It resets on page reload — no settings are saved.

---

## Questions / Bugs

File an issue at the Burlington Brief or reach out to the site editor. To add yourself as an editor: push access to the GitHub repository.
