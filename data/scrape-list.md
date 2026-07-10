# Feed-less sources — scrape & manual playbook

Sources with no usable RSS/ICS/API as of 2026-07-10, with the recommended approach for each.
Policy reminders: **Front Porch Forum and Facebook groups are never scraped.** Sites that block bots or disallow AI agents in robots.txt are honored (marked manual).

## Scrape targets (technically feasible, server-rendered unless noted)

### Seven Days Events
- **Target:** `https://www.sevendaysvt.com/vermont/EventSearch` (browser-rendered; plain HTTP clients get Cloudflare-blocked)
- **Cadence:** several/day · **Fragility:** medium-high — legacy Gyrobase CMS markup behind Cloudflare
- **Approach:** Already working in Stephen's newsletter pipeline (147 events over a 4-day window pulled in production). Caveat: robots.txt disallows /vermont/EventSearch — knowingly accepted for core newsletter content; a Seven Days data partnership remains the cleaner long-term answer.

### City of Burlington Calendar
- **Target:** `https://www.burlingtonvt.gov/calendar.aspx?view=list&CID=0`
- **Cadence:** several/week · **Fragility:** medium — server-rendered CivicPlus list view; the calendar RSS exists but returns 1 item vs 29 on the page
- **Approach:** CivicPlus Calendar module (ModID=58), distinct from CivicClerk meetings. The RSS (All-calendar.xml) is technically valid but massively under-reports (1 item vs 29 visible) — scrape the list view for Calendar.aspx?EID= links instead; per-event iCalendar.aspx export exists per EID.

### Burlington Parks, Recreation & Waterfront
- **Target:** `https://www.burlingtonvt.gov/calendar.aspx?view=list&CID=29,31`
- **Cadence:** several/week · **Fragility:** medium — server-rendered CivicPlus calendar HTML; category RSS feeds exist but were sparse
- **Approach:** IMPORTANT: enjoyburlington.com consistently fails TLS handshakes to curl — use burlingtonvt.gov (identical CivicPlus content). Scrape the calendar list view for Calendar.aspx?EID= links; category feeds (Parks-Events-31, Recreation-Dropin-Programs-29) exist as alternates but carry few items.

### Burlington Farmers Market
- **Target:** `https://burlingtonfarmersmarket.org/`
- **Cadence:** static/seasonal · **Fragility:** medium — season dates are hardcoded hero text on a Squarespace page
- **Approach:** No feed, no events collection. Schedule is one line of homepage text ('Every Saturday May 9 - October 31, 2026, 9-2, 345 Pine St'). Scrape once per season; a manual annual check is honestly fine.

### Foam Brewers
- **Target:** `https://www.foambrewers.com/events`
- **Cadence:** several/week · **Fragility:** high — Webflow CMS collection markup (w-dyn-item classes), no year on displayed dates
- **Approach:** Webflow, not Squarespace — no feed export exists (?format=rss silently returns HTML). Events ARE server-rendered: scrape .featured-event.w-dyn-item blocks (.event-heading, .event-date-month/.event-date-day). Infer year at ingest since it isn't displayed.

### Hula Lakeside
- **Target:** `https://www.hulalakeside.com/events-calendar/`
- **Cadence:** monthly · **Fragility:** medium — static server-rendered Webflow pages, no feed
- **Approach:** Networking/business events (lower priority for nightlife coverage). Event pages are plain HTML: scrape the /events-calendar/ index for event slugs, then each page for date/time.

### Light Club Lamp Shop
- **Target:** `https://www.lightclublampshop.com/calendar`
- **Cadence:** several/week · **Fragility:** high — Wix Events widget, fully JS-rendered
- **Approach:** Same Wix pattern as Radio Bean: no static event data, needs headless browser. Robots.txt permits crawling.

### Love Burlington (downtown) Events
- **Target:** `https://loveburlington.org/events`
- **Cadence:** several/week · **Fragility:** high — JS-rendered Time.ly Angular widget, undocumented internal API
- **Approach:** Page embeds a Time.ly calendar (calendar.time.ly/vfaca7kw) whose account has disable_export_feeds:1 — RSS/ICS deliberately off. Scrape requires a headless browser to render the widget or capture its XHR to timelyapp.time.ly/api. Better play: email Love Burlington and ask them to flip the Time.ly export flag or share an ICS.

### Nectar's / Club Metronome
- **Target:** `https://liveatnectars.com/music-events/calendar/`
- **Cadence:** several/day · **Fragility:** high — See Tickets (seetickets.us) JS widget; the WP /feed/ is three years stale
- **Approach:** WordPress site whose blog feed died in 2023; the live calendar renders client-side via a See Tickets plugin XHR. Needs headless rendering of /music-events/calendar/ or capturing the seetickets.us endpoint. Two rooms, near-nightly shows — high value, high effort.

### Radio Bean
- **Target:** `https://www.radiobean.com/calendar`
- **Cadence:** several/week · **Fragility:** high — Wix Events widget, fully JS-rendered, no static data
- **Approach:** Wix site; /calendar has zero event data in raw HTML (loads client-side). Needs headless rendering or reverse-engineering the Wix Events XHR. Near-nightly shows make it valuable; consider it a candidate for a paid/managed scrape or a partnership ask.

### South Burlington Recreation & Parks
- **Target:** `https://www.southburlingtonvt.gov/calendar.aspx?CID=44`
- **Cadence:** weekly · **Fragility:** high — CivicPlus calendar whose iCal export is session-bound; plain GETs return inconsistent results
- **Approach:** CivicEngage calendar (CID=44 recreation). RSS index is robots-disallowed (/RSS.aspx) and the iCalendar.aspx export needs postback session state. Scrape the calendar list view; low volume, so a weekly poll suffices.

### South Burlington Public Library
- **Target:** `https://southburlingtonlibrary.org/events/`
- **Cadence:** several/day · **Fragility:** high — custom MODX CMS, site-specific markup
- **Approach:** No feed of any kind (custom MODX, not LibCal). Events ARE server-rendered in div.post blocks with machine-friendly data attributes (data-recList dates, data-stime/data-etime, data-id) — a clean scrape target despite no feed.

### Vermont Comedy Club
- **Target:** `https://www-vermontcomedyclub-com.seatengine.com/calendar`
- **Cadence:** several/week · **Fragility:** medium — schema.org JSON-LD embedded server-side in SeatEngine's calendar page; more stable than DOM scraping but template could change
- **Approach:** Ticketing on SeatEngine. The calendar page embeds a full schema.org JSON-LD block with an Events array (115 upcoming shows validated) — parse that script tag, no JS rendering needed. Squarespace-side ?format tricks are robots-disallowed; scrape the SeatEngine URL, not the Squarespace one.

### Winooski Memorial Library
- **Target:** `https://www.winooskivt.gov/1485/Winooski-Memorial-Library`
- **Cadence:** weekly · **Fragility:** high — Time.ly JS widget; the citywide CivicPlus calendar RSS exists but has 0 items
- **Approach:** Library page moved to /1485/. Events use a Time.ly widget (JS-rendered, same problem as Love Burlington). The CivicPlus calendar feed (/RSSFeed.aspx?ModID=58&CID=All-calendar.xml) is live but unused/empty. Headless scrape or ask the library for their Time.ly ICS.

### CCRPC — traffic alerts & news
- **Target:** `https://www.ccrpcvt.org/about-us/news/traffic-alerts/`
- **Cadence:** weekly · **Fragility:** medium — static server-rendered WP page, but the news system bypasses WP posts so every feed is empty
- **Approach:** All /feed/ variants return valid-but-empty RSS (news lives in static Pages, not posts). Scrape the Traffic Alerts page (li.alert-item blocks, dated) — server-rendered, no JS needed.

### Champlain Parkway project updates
- **Target:** `https://champlainparkway.com/`
- **Cadence:** several/week (winding down) · **Fragility:** medium — Umbraco site, no feed; updates link out to Constant Contact pages
- **Approach:** Scrape homepage section.latest-news (ul.latest-news__list li a) for the 5 latest updates + the .notification banner. Site says the parkway is 'now fully open' — expect this source to wind down; revisit its relevance in 6 months.

### UVM Medical Center Careers
- **Target:** `https://uvmhealthcareers.org/jobs/?entity=uvmmc-the-university-of-vermont-medical-center`
- **Cadence:** daily · **Fragility:** medium-low — custom career site, server-rendered with JobPosting JSON-LD on detail pages
- **Approach:** NOT Workday: uvmhealth.org/careers 301s to uvmhealthcareers.org (custom Python site). The ?entity= filter isolates UVMMC (~180 reqs, 8 pages, param page_jobs=N); detail pages carry schema.org JobPosting JSON-LD — scrape the paginated index, parse JSON-LD per job.

### State of Vermont Jobs (Burlington)
- **Target:** `https://careers.vermont.gov/search/?q=&locationsearch=Burlington%2C+VT%2C+US`
- **Cadence:** weekly · **Fragility:** medium — SuccessFactors server-rendered HTML; vendor-controlled class names (jobTitle-link, jobDate)
- **Approach:** No feed exists in this SuccessFactors deployment, but the search page is server-rendered and robots.txt does NOT disallow /search/ — a plain HTML parse works (~12-13 Burlington listings at probe).

## Manual / no legitimate automation

### Citizen Cider (Press House Pub)
- **Where:** https://www.citizencider.com/the-press-house-pub
- **Why manual:** Squarespace (not Shopify); sitemap has 16 static pages and no events/blog collection at all. Taproom events go out via Instagram/Facebook only. Manual check or paid social monitoring.

### Despacito VT
- **Where:** https://www.despacitovt.com/
- **Why manual:** Wix Events site, but robots.txt blocks ClaudeBot by name (plus GPTBot etc., Content-signal: ai-train=no). Respecting that: manual only — monitor their Instagram/Facebook or ask the venue for a listing partnership.

### ECHO Leahy Center
- **Where:** https://www.echovermont.org/
- **Why manual:** Fully bot-blocked (403 challenge on /, /feed/, /events/feed/, tribe endpoints) AND robots.txt disallows ClaudeBot by name plus /event/ and /calendar/ for everyone, with Content-Signal ai-train=no. Respect it: manual, or ask ECHO's marketing team for their calendar ICS — a very gettable partnership for a local newsletter.

### Eventbrite — Burlington
- **Where:** https://www.eventbrite.com/d/vt--burlington/all-events/
- **Why manual:** Destination page serves a Cloudflare block page even to a browser-UA curl, and robots.txt explicitly disallows /rss/, /events/rss/, /events/atom/ and /api/v3/destination/events/. Official API only covers your own organizer account. A licensed events-data provider (e.g. PredictHQ) is the only legitimate automated route.

### Queen City Brewery
- **Where:** https://queencitybrewery.net/
- **Why manual:** Real site is queencitybrewery.net (the .com is a legacy frameset). Single-page Squarespace with no calendar; 'Event Space' is private-rental marketing. The one RSS link in the head is a vestigial empty collection. Facebook/Instagram only.

### Red Square
- **Where:** https://www.facebook.com/redsquarevt
- **Why manual:** redsquarevt.com no longer resolves. Facebook/Instagram (@redsquarevt) are the only channels. Manual or paid social monitoring.

### Zero Gravity Craft Brewery
- **Where:** https://www.zerogravitybeer.com/zero-gravity-beerhall
- **Why manual:** Squarespace site with the /events nav link literally commented out in the HTML and zero event/calendar pages in the 206-URL sitemap. Events surface on Instagram only. Re-probe if they relaunch the events section.

### Craigslist Burlington (community/events/gigs)
- **Where:** https://burlington.craigslist.org/
- **Why manual:** Verified: the old RSS endpoint is actively blocked (403) and Craigslist's ToS bans automated access. Manual spot-checks of /search/eee (events), /search/ggg (gigs), /search/com (community) or skip entirely.

### Front Porch Forum
- **Where:** https://frontporchforum.com/
- **Why manual:** POLICY: never scraped, per standing decision — FPF is membership-gated and their ToS prohibits reuse. Stephen reads his own neighborhood digest by email. Any FPF-sourced item gets manually re-reported.

### City of Burlington Jobs (NEOGOV)
- **Where:** https://www.governmentjobs.com/careers/burlingtonvt
- **Why manual:** No feed, no server-rendered data, robots-blocked for generic agents. Weekly manual check, or watch the city News Flash feed for hiring announcements.

### Indeed — Burlington
- **Where:** https://www.indeed.com/jobs?q=&l=Burlington%2C+VT
- **Why manual:** All access paths verified dead or prohibited. Licensed alternatives if job coverage matters: Adzuna or Jooble APIs (free tiers), or lean on the direct employer feeds above.

## Is a paid service the honest answer for Instagram-only venues?

Yes, for the venue tier (Radio Bean's nightly shows, Red Square, Despacito, Zero Gravity, Citizen Cider taproom events) the honest options are:
1. **A weekly 15-minute manual sweep** of ~6 Instagram accounts (cheapest, fully compliant, fits a solo-operator newsletter cadence).
2. **A licensed social listening/data service** (e.g. an official Instagram Graph API app requires each venue's authorization — impractical; third-party IG scrapers violate Meta ToS — not recommended).
3. **Partnership asks:** several venues (ECHO, Love Burlington, Seven Days) have the data sitting behind one email. Do these first — every yes deletes a scraper.

Recommendation: (1) + (3). Skip gray-market IG scrapers entirely — the compliance risk isn't worth it for a local newsletter whose brand is trust.
