# BTown Brief — Source Registry

Generated 2026-07-10 by live-probing every source (62 parallel probe agents; every feed destined for Inoreader was then re-fetched and item-counted directly).
Machine registry: [`data/sources.json`](data/sources.json) · Inoreader import: [`data/btown-inoreader.opml`](data/btown-inoreader.opml) · Feed-less sources: [`data/scrape-list.md`](data/scrape-list.md)

**Method priority:** real RSS/Atom → ICS → JSON API → HTML scrape → manual. "Confidence" is how sure I am this is the best available method and that it keeps working.

## Summary

102 sources: **56 RSS**, 2 ICS, 15 API, 17 scrape, 12 manual. 72 feeds/endpoints validated live with recent items.

## Events

| Source | Method | Feed / endpoint | Freshness | Confidence |
|---|---|---|---|---|
| [City of Burlington Calendar](https://www.burlingtonvt.gov/calendar) | scrape | `https://www.burlingtonvt.gov/calendar.aspx?view=list&CID=0` | ✅ live | 🟢 high |
| [Burlington Parks, Recreation & Waterfront](https://www.burlingtonvt.gov/735/Parks-Recreation-Waterfront) | scrape | `https://www.burlingtonvt.gov/calendar.aspx?view=list&CID=29,31` | ⚠️ see notes | 🟡 medium |
| [Burlington Beer Co](https://www.burlingtonbeercompany.com/bbcoevents/) | RSS | `https://burlingtonbeercompany.com/bbcoevents?format=rss` | ✅ live | 🟢 high |
| [Burlington City Arts](https://www.burlingtoncityarts.org/events) | RSS | `https://www.burlingtoncityarts.org/rss.xml` | ✅ live | 🟢 high |
| [Burlington Farmers Market](https://burlingtonfarmersmarket.org/) | scrape | — | ⚠️ see notes | 🟢 high |
| [Champlain College Events](https://www.champlain.edu/events/) | API | `https://www.champlain.edu/wp-json/tribe/events/v1/events` | ✅ live | 🟢 high |
| [Citizen Cider (Press House Pub)](https://www.citizencider.com/the-press-house-pub) | manual | — | — | 🟢 high |
| [Despacito VT](https://www.despacitovt.com/) | manual | — | — | 🟢 high |
| [ECHO Leahy Center](https://www.echovermont.org/) | manual | — | — | 🟢 high |
| [Eventbrite — Burlington](https://www.eventbrite.com/d/vt--burlington/all-events/) | manual | — | — | 🟢 high |
| [Fletcher Free Library](https://fletcherfree.org/) | RSS | `https://fletcherfree.libcal.com/rss.php?iid=6869&m=month&cid=21587` | ✅ live | 🟢 high |
| [The Flynn](https://www.flynnvt.org/events/) | API | `https://BR77IA976F-dsn.algolia.net/1/indexes/prod_flynn/query` | ✅ live | 🟢 high |
| [Foam Brewers](https://www.foambrewers.com/events) | scrape | — | ⚠️ see notes | 🟢 high |
| [Hello Burlington (Chamber) Events](https://www.helloburlingtonvt.com/events/) | RSS | `https://www.helloburlingtonvt.com/event/rss/` | ✅ live | 🟢 high |
| [Higher Ground](https://highergroundmusic.com/events/) | API | `https://highergroundmusic.com/wp-json/wp/v2/events?per_page=20&orderby=date&order=desc` | ✅ live | 🟢 high |
| [Hula Lakeside](https://www.hulalakeside.com/events-calendar/) | scrape | — | ⚠️ see notes | 🟡 medium |
| [Light Club Lamp Shop](https://www.lightclublampshop.com/calendar) | scrape | — | ⚠️ see notes | 🟡 medium |
| [Love Burlington (downtown) Events](https://loveburlington.org/events) | scrape | — | ⚠️ see notes | 🟡 medium |
| [Meetup — Burlington groups](https://www.meetup.com/find/?location=us--vt--burlington&source=EVENTS) | ICS | `https://www.meetup.com/{group-slug}/events/ical/` | ✅ live | 🟢 high |
| [The Monkey House (Winooski)](https://www.monkeyhousevt.com/events) | RSS | `https://www.monkeyhousevt.com/events?format=rss` | ✅ live | 🟢 high |
| [Nectar's / Club Metronome](https://liveatnectars.com/music-events/calendar/) | scrape | — | ⚠️ see notes | 🟡 medium |
| [Queen City Brewery](https://queencitybrewery.net/) | manual | — | — | 🟢 high |
| [Radio Bean](https://www.radiobean.com/calendar) | scrape | — | ⚠️ see notes | 🟡 medium |
| [Red Square](https://www.facebook.com/redsquarevt) | manual | — | — | 🟢 high |
| [South Burlington Recreation & Parks](https://www.southburlingtonvt.gov/160/Recreation-Parks) | scrape | `https://www.southburlingtonvt.gov/calendar.aspx?CID=44` | ⚠️ see notes | 🟡 medium |
| [South Burlington Public Library](https://southburlingtonlibrary.org/events/) | scrape | — | ⚠️ see notes | 🟢 high |
| [Seven Days Events](https://www.sevendaysvt.com/vermont/EventSearch) | scrape | `https://www.sevendaysvt.com/vermont/EventSearch` (browser-rendered) | ✅ live | 🟢 high |
| [Shelburne Museum](https://shelburnemuseum.org/events/) | ICS | `https://shelburnemuseum.org/events/?ical=1` | ✅ live | 🟢 high |
| [Saint Michael's College Events](https://www.smcvt.edu/events) | API | `https://www.smcvt.edu/wp-json/tribe/events/v1/events?per_page=50` | ✅ live | 🟢 high |
| [Switchback Brewing — Beer Garden](https://www.switchbackvt.com/events) | RSS | `https://www.switchbackvt.com/beer-garden-events?format=rss` | ✅ live | 🟢 high |
| [UVM Bored](https://www.uvmbored.com/) | RSS | `https://uvmbored.com/feed/` | ✅ live | 🟢 high |
| [UVM Events Calendar (Localist)](https://events.uvm.edu/) | RSS | `https://events.uvm.edu/calendar/1.xml` | ✅ live | 🟢 high |
| [Vermont Comedy Club](https://vermontcomedyclub.com/seeashow) | scrape | `https://www-vermontcomedyclub-com.seatengine.com/calendar` | ✅ live | 🟢 high |
| [Winooski Memorial Library](https://www.winooskivt.gov/1485/Winooski-Memorial-Library) | scrape | — | ⚠️ see notes | 🔴 low |
| [Zero Gravity Craft Brewery](https://www.zerogravitybeer.com/zero-gravity-beerhall) | manual | — | — | 🟢 high |

- **City of Burlington Calendar** (several/week; fragility: medium — server-rendered CivicPlus list view; the calendar RSS exists but returns 1 item vs 29 on the page) — CivicPlus Calendar module (ModID=58), distinct from CivicClerk meetings. The RSS (All-calendar.xml) is technically valid but massively under-reports (1 item vs 29 visible) — scrape the list view for Calendar.aspx?EID= links instead; per-event iCalendar.aspx export exists per EID.
- **Burlington Parks, Recreation & Waterfront** (several/week; fragility: medium — server-rendered CivicPlus calendar HTML; category RSS feeds exist but were sparse) — IMPORTANT: enjoyburlington.com consistently fails TLS handshakes to curl — use burlingtonvt.gov (identical CivicPlus content). Scrape the calendar list view for Calendar.aspx?EID= links; category feeds (Parks-Events-31, Recreation-Dropin-Programs-29) exist as alternates but carry few items.
- **Burlington Beer Co** (weekly; fragility: low-medium — native Squarespace collection RSS) — Squarespace events collection, 20 items (Moth Story Hour etc.), validated live. ?format=ical on the same slug is likely available as backup (untested).
- **Burlington City Arts** (several/week; fragility: medium — Drupal core 'promoted content' feed, not events-specific; editors control what gets promoted) — Drupal site. /rss.xml is the only feed (10 items, same-day fresh, mixes events/exhibitions/news). No per-event ICS. Retention is short — poll at least weekly.
- **Burlington Farmers Market** (static/seasonal; fragility: medium — season dates are hardcoded hero text on a Squarespace page) — No feed, no events collection. Schedule is one line of homepage text ('Every Saturday May 9 - October 31, 2026, 9-2, 345 Pine St'). Scrape once per season; a manual annual check is honestly fine.
- **Champlain College Events** (daily; fragility: low — The Events Calendar's documented REST API, robots-permitted) — 31 events, 10/page; supports ?start_date=YYYY-MM-DD&per_page=N&page=N. Each event has title/start/end/venue/categories — filter categories to skip internal admissions events.
- **Citizen Cider (Press House Pub)** (unknown; fragility: n/a — no events content on the site) — Squarespace (not Shopify); sitemap has 16 static pages and no events/blog collection at all. Taproom events go out via Instagram/Facebook only. Manual check or paid social monitoring.
- **Despacito VT** (weekly; fragility: n/a — robots.txt explicitly disallows ClaudeBot and AI agents) — Wix Events site, but robots.txt blocks ClaudeBot by name (plus GPTBot etc., Content-signal: ai-train=no). Respecting that: manual only — monitor their Instagram/Facebook or ask the venue for a listing partnership.
- **ECHO Leahy Center** (weekly; fragility: n/a — Cloudflare JS challenge on every path) — Fully bot-blocked (403 challenge on /, /feed/, /events/feed/, tribe endpoints) AND robots.txt disallows ClaudeBot by name plus /event/ and /calendar/ for everyone, with Content-Signal ai-train=no. Respect it: manual, or ask ECHO's marketing team for their calendar ICS — a very gettable partnership for a local newsletter.
- **Eventbrite — Burlington** (several/day; fragility: n/a — Cloudflare-blocked and robots-disallowed) — Destination page serves a Cloudflare block page even to a browser-UA curl, and robots.txt explicitly disallows /rss/, /events/rss/, /events/atom/ and /api/v3/destination/events/. Official API only covers your own organizer account. A licensed events-data provider (e.g. PredictHQ) is the only legitimate automated route.
- **Fletcher Free Library** (several/day; fragility: low-medium — LibCal (Springshare) documented RSS export; iid/cid discovered from page HTML) — LibCal calendar with 189 events/month and rich libcal: namespace fields (date/start/end/location). cid=21587 is 'Library Programs and Events'; cid=21782 is room bookings (skip). Best library feed in the county.
- **The Flynn** (several/week; fragility: medium — public search-only Algolia key hardcoded in the site's own JS; breaks if Flynn rotates the key or migrates CMS) — Kentico CMS, no RSS/ICS. Events grid runs on Algolia InstantSearch: POST to the index with headers X-Algolia-Application-Id: BR77IA976F and X-Algolia-API-Key: 134f196afdd3cef100a1172a6b214f93 (public search-only key from /Scripts/algolia.js). ~51 forward events validated. Note /whats-on/ is a soft-404; real page is /events/.
- **Foam Brewers** (several/week; fragility: high — Webflow CMS collection markup (w-dyn-item classes), no year on displayed dates) — Webflow, not Squarespace — no feed export exists (?format=rss silently returns HTML). Events ARE server-rendered: scrape .featured-event.w-dyn-item blocks (.event-heading, .event-date-month/.event-date-day). Infer year at ingest since it isn't displayed.
- **Hello Burlington (Chamber) Events** (several/day; fragility: low-medium — Simpleview DMO CMS RSS, stable platform convention, no bot protection) — Real domain is helloburlingtonvt.com (helloburlington.org is NXDOMAIN). Feed found via the Simpleview LayoutJS widget config (rssUrl:/event/rss/ — NOT /events/rss/, which 404s). 30 items, but pubDate is the EVENT date and the window only covers the next ~2 days — poll at least daily to avoid missing short-lived listings.
- **Higher Ground** (several/week; fragility: medium — standard WP REST for a custom post type, but show date/venue are prose inside content HTML, not structured fields) — WordPress with a native 'events' custom post type (493 shows). JSON gives id/title/link, but the actual concert date and room (Ballroom/Showcase/Waterfront Park) must be parsed from content.rendered prose. /feed/ (RSS, 100 items) validated as the announcement stream for Inoreader.
- **Hula Lakeside** (monthly; fragility: medium — static server-rendered Webflow pages, no feed) — Networking/business events (lower priority for nightlife coverage). Event pages are plain HTML: scrape the /events-calendar/ index for event slugs, then each page for date/time.
- **Light Club Lamp Shop** (several/week; fragility: high — Wix Events widget, fully JS-rendered) — Same Wix pattern as Radio Bean: no static event data, needs headless browser. Robots.txt permits crawling.
- **Love Burlington (downtown) Events** (several/week; fragility: high — JS-rendered Time.ly Angular widget, undocumented internal API) — Page embeds a Time.ly calendar (calendar.time.ly/vfaca7kw) whose account has disable_export_feeds:1 — RSS/ICS deliberately off. Scrape requires a headless browser to render the widget or capture its XHR to timelyapp.time.ly/api. Better play: email Love Burlington and ask them to flip the Time.ly export flag or share an ICS.
- **Meetup — Burlington groups** (weekly per group; fragility: low-medium — per-group ICS is a stable long-standing Meetup feature; fragility is curatorial (maintaining the group list)) — No all-Burlington feed, but per-group ICS works and is robots-clean. Maintain a whitelist of group slugs (the find page is server-rendered and scrapeable for discovering new groups). NOTE: the RSS variant (/events/rss/) also works but is disallowed by robots.txt — use ICS.
- **The Monkey House (Winooski)** (several/week; fragility: low-medium — native Squarespace Events RSS) — Found via venue research fan-out. 39 items, lastBuildDate same-day — the strongest venue feed of the batch.
- **Nectar's / Club Metronome** (several/day; fragility: high — See Tickets (seetickets.us) JS widget; the WP /feed/ is three years stale) — WordPress site whose blog feed died in 2023; the live calendar renders client-side via a See Tickets plugin XHR. Needs headless rendering of /music-events/calendar/ or capturing the seetickets.us endpoint. Two rooms, near-nightly shows — high value, high effort.
- **Queen City Brewery** (unknown; fragility: n/a — no events calendar exists) — Real site is queencitybrewery.net (the .com is a legacy frameset). Single-page Squarespace with no calendar; 'Event Space' is private-rental marketing. The one RSS link in the head is a vestigial empty collection. Facebook/Instagram only.
- **Radio Bean** (several/week; fragility: high — Wix Events widget, fully JS-rendered, no static data) — Wix site; /calendar has zero event data in raw HTML (loads client-side). Needs headless rendering or reverse-engineering the Wix Events XHR. Near-nightly shows make it valuable; consider it a candidate for a paid/managed scrape or a partnership ask.
- **Red Square** (unknown; fragility: n/a — venue website is gone) — redsquarevt.com no longer resolves. Facebook/Instagram (@redsquarevt) are the only channels. Manual or paid social monitoring.
- **South Burlington Recreation & Parks** (weekly; fragility: high — CivicPlus calendar whose iCal export is session-bound; plain GETs return inconsistent results) — CivicEngage calendar (CID=44 recreation). RSS index is robots-disallowed (/RSS.aspx) and the iCalendar.aspx export needs postback session state. Scrape the calendar list view; low volume, so a weekly poll suffices.
- **South Burlington Public Library** (several/day; fragility: high — custom MODX CMS, site-specific markup) — No feed of any kind (custom MODX, not LibCal). Events ARE server-rendered in div.post blocks with machine-friendly data attributes (data-recList dates, data-stime/data-etime, data-id) — a clean scrape target despite no feed.
- **Seven Days Events** (several/day; fragility: medium-high — needs a real browser context; Cloudflare blocks plain HTTP clients) — Stephen's newsletter pipeline already scrapes the full event search via browser rendering (147 events over a 4-day window, verified in production), so this is classified scrape. Caveat: robots.txt disallows /vermont/EventSearch — a knowingly-accepted policy exception for core newsletter content; a Seven Days data partnership remains the cleaner long-term answer.
- **Shelburne Museum** (several/week (seasonal); fragility: low-medium — The Events Calendar ICS export, but Cloudflare rate-limits rapid repeat requests) — WordPress + The Events Calendar. ?ical=1 export validated (30 VEVENTs, pre-expanded recurrences). JSON API and /feed/ also work as backups. Fetch gently (one request per poll) to stay under the Cloudflare challenge threshold.
- **Saint Michael's College Events** (several/week; fragility: low — The Events Calendar's documented REST API) — Same plugin as Champlain. Only ~10 upcoming events published at probe time (mostly athletics/president's tour). ICS alternative validated at /events/?ical=1.
- **Switchback Brewing — Beer Garden** (several/week; fragility: low-medium — native Squarespace collection RSS; slug 'beer-garden-events' is the dependency) — Squarespace events collection with 40+ items (live music, watch parties, wing nights), future-dated pubDates. ?format=ical on the same slug returns 0 VEVENTs — use the RSS.
- **UVM Bored** (monthly (academic year); fragility: low-medium — standard WordPress feed) — WordPress blog of roundup posts (~1-2/month during semester), not structured per-event data. The site itself embeds the events.uvm.edu Localist widget — the Localist API (see uvm-events) is the structured source; this feed is for the editorial roundups.
- **UVM Events Calendar (Localist)** (several/day; fragility: low-medium — Localist master-calendar export, explicitly allowed by robots.txt) — Localist instance with three validated exports: RSS (372 items), ICS (482 VEVENTs), and JSON API (/api/2/events?days=30, ~150 events/30 days, paginated). Use .xml not .rss (the latter 406s). For automation the JSON API is richest; RSS is for Inoreader.
- **Vermont Comedy Club** (several/week; fragility: medium — schema.org JSON-LD embedded server-side in SeatEngine's calendar page; more stable than DOM scraping but template could change) — Ticketing on SeatEngine. The calendar page embeds a full schema.org JSON-LD block with an Events array (115 upcoming shows validated) — parse that script tag, no JS rendering needed. Squarespace-side ?format tricks are robots-disallowed; scrape the SeatEngine URL, not the Squarespace one.
- **Winooski Memorial Library** (weekly; fragility: high — Time.ly JS widget; the citywide CivicPlus calendar RSS exists but has 0 items) — Library page moved to /1485/. Events use a Time.ly widget (JS-rendered, same problem as Love Burlington). The CivicPlus calendar feed (/RSSFeed.aspx?ModID=58&CID=All-calendar.xml) is live but unused/empty. Headless scrape or ask the library for their Time.ly ICS.
- **Zero Gravity Craft Brewery** (unknown; fragility: n/a — no events feature currently exists on the site) — Squarespace site with the /events nav link literally commented out in the HTML and zero event/calendar pages in the 206-URL sitemap. Events surface on Instagram only. Re-probe if they relaunch the events section.

## News

| Source | Method | Feed / endpoint | Freshness | Confidence |
|---|---|---|---|---|
| [Burlington Police Department](https://www.burlingtonvt.gov/770/Press-Releases) | RSS | `https://www.burlingtonvt.gov/RSSFeed.aspx?ModID=1&CID=Police-Department-7` | ✅ live | 🟢 high |
| [City of Burlington — News Flash (all departments)](https://www.burlingtonvt.gov/CivicAlerts.aspx?CID=1) | RSS | `https://www.burlingtonvt.gov/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml` | ✅ live | 🟢 high |
| [The Charlotte News](https://www.charlottenewsvt.org/) | RSS | `https://www.charlottenewsvt.org/feed/` | ✅ live | 🟢 high |
| [Google News — Burlington local topic](https://news.google.com/topics/CAAqHAgKIhZDQklTQ2pvSWJHOWpZV3hmZGpJb0FBUAE) | RSS | `https://news.google.com/rss/topics/CAAqHAgKIhZDQklTQ2pvSWJHOWpZV3hmZGpJb0FBUAE/sections/CAQiTkNCSVNO…` | ✅ live | 🟢 high |
| [Google News — "burlington vermont" search](https://news.google.com/search?q=burlington+vermont) | RSS | `https://news.google.com/news/rss/search?q=burlington%20vermont&hl=en` | ✅ live | 🟢 high |
| [Local 22/44 (WVNY/WFFF)](https://www.mychamplainvalley.com/) | RSS | `https://www.mychamplainvalley.com/news/feed/` | ✅ live | 🟢 high |
| [Mayor's Office](https://www.burlingtonvt.gov/CivicAlerts.aspx?CID=9) | RSS | `https://www.burlingtonvt.gov/RSSFeed.aspx?ModID=1&CID=Mayors-Office-9` | ⚠️ see notes | 🟡 medium |
| [WPTZ / MyNBC5](https://www.mynbc5.com/) | RSS | `https://www.mynbc5.com/topstories-rss` | ✅ live | 🟢 high |
| [The Other Paper (South Burlington)](https://www.vtcng.com/otherpapersbvt/) | RSS | `https://www.vtcng.com/search/?f=rss&t=article&l=25&s=start_time&sd=desc&app=editorial&sites=otherpapersbvt` | ✅ live | 🟡 medium |
| [Seven Days (news)](https://www.sevendaysvt.com/) | RSS | `https://www.sevendaysvt.com/feed/` | ✅ live | 🟢 high |
| [The Vermont Cynic (UVM)](https://vtcynic.com/) | RSS | `https://vtcynic.com/feed/` | ✅ live | 🟢 high |
| [Vermont Daily Chronicle](https://vermontdailychronicle.com/) | RSS | `https://vermontdailychronicle.com/feed/` | ✅ live | 🟢 high |
| [Vermont Public — Local News](https://www.vermontpublic.org/local-news) | RSS | `https://www.vermontpublic.org/local-news.rss` | ✅ live | 🟢 high |
| [Vermont Business Magazine](https://vermontbiz.com/) | RSS | `https://vermontbiz.com/rss.xml` | ✅ live | 🟢 high |
| [Community News Service](https://vtcommunitynews.org/) | RSS | `https://vtcommunitynews.org/feed/` | ✅ live | 🟢 high |
| [VTDigger](https://vtdigger.org/) | RSS | `https://vtdigger.org/feed/` | ✅ live | 🟢 high |
| [WCAX Channel 3](https://www.wcax.com/) | RSS | `https://www.wcax.com/arc/outboundfeeds/whiz-rss/category/news/?outputType=xml&sort=display_date:desc&size=50` | ✅ live | 🟢 high |
| [Williston Observer](https://www.willistonobserver.com/) | RSS | `https://www.willistonobserver.com/search/?f=rss&t=article&l=25&s=start_time&sd=desc&c=news*` | ✅ live | 🟡 medium |

- **Burlington Police Department** (weekly (bursty); fragility: low-medium — CivicPlus category feed listed on the city's own RSS index) — Official BPD press-release channel (2 items in window, freshest 2026-07-06). Subset of All-newsflash — subscribe to this for police-specific triage, dedupe against the citywide feed.
- **City of Burlington — News Flash (all departments)** (weekly; fragility: low-medium — CivicPlus News Flash export, a stable advertised CMS feature) — Aggregates every department's press releases (mayor, police, DPW, parks). Feed carries a short rolling window (~3 items) — poll daily and archive; scrape /CivicAlerts.aspx?CID=1 only if backfill is ever needed.
- **The Charlotte News** (several/week; fragility: low — WP feed) — Confirmed working (10 items, 1 day old).
- **Google News — Burlington local topic** (several/day; fragility: medium-high — opaque topic-token URL; Google can retire these tokens without notice) — Confirmed working (53 items). Keep the plain search feed as the durable fallback.
- **Google News — "burlington vermont" search** (several/day; fragility: medium — Google News RSS is unofficial-but-durable; dedupe against direct feeds) — Confirmed working (100 items). Catch-all for outlets without their own feeds.
- **Local 22/44 (WVNY/WFFF)** (several/day; fragility: low-medium — Nexstar WordPress feed) — News-category feed (25 items) chosen over sitewide /feed/ (13 items, mixes weather/sports). Both validated same-day.
- **Mayor's Office** (irregular; fragility: low-medium — official CivicPlus category feed, but staff tagging determines whether items land here) — Feed is structurally valid but had 0 items at probe time — mayoral announcements are mostly tagged into the general News-Announcements category instead. Keep this subscribed, but rely on All-newsflash as the actual catch-all.
- **WPTZ / MyNBC5** (several/day; fragility: low-medium — Hearst standard station feed) — Confirmed working (20 items, same-day). The legacy http://www.wptz.com/news/topstory.rss is dead (404) — remove it from Inoreader.
- **The Other Paper (South Burlington)** (several/day; fragility: low-medium — TownNews/BLOX search-as-RSS; the exact param combo (&sites= not &c=) was found by trial) — WARNING: the feed the site itself advertises in its <link> tag is stale (7 items from 2019) — use this &sites=-scoped one (25 items, same-day). Section variants available for community/news/sports.
- **Seven Days (news)** (several/day; fragility: low-medium — standard WordPress feed on the www site (NOT bot-blocked, unlike the events subdomain)) — Confirmed working in Stephen's Inoreader; re-validated (10 items, same-day).
- **The Vermont Cynic (UVM)** (several/week (academic year); fragility: low-medium — SNO/WordPress feed; main risk is misreading summer silence as breakage) — MYSTERY SOLVED: the feed is NOT broken — it has 10 items, newest 2026-05-11 ('SpringFest 2026'). The paper simply doesn't publish over summer break. If Inoreader shows 0 items, remove and re-add the subscription; expect new items when the fall semester starts (late Aug).
- **Vermont Daily Chronicle** (several/day; fragility: low — WP feed) — Confirmed working (100 items, same-day). Note: right-leaning outlet; useful for coverage breadth.
- **Vermont Public — Local News** (several/day; fragility: low — Grove/NPR platform feed) — Confirmed working (12 items, same-day). The legacy digital.vpr.net/feeds/1012/rss.xml still resolves to the same content — treat as duplicate.
- **Vermont Business Magazine** (daily; fragility: low-medium) — Confirmed working (10 items, 2 days old).
- **Community News Service** (several/week; fragility: low — WP feed) — Confirmed working (10 items, 2 days old).
- **VTDigger** (several/day; fragility: low — flagship WP feed, years of stability) — Confirmed working (30 items, same-day).
- **WCAX Channel 3** (several/day; fragility: medium — Gray TV ArcXP outbound feed; the older /arcio/rss/ variant already died (404), proving these URLs rotate) — The whiz-rss feed works (50 items, same-day). REMOVE the dead https://www.wcax.com/arcio/rss/category/news/?size=20 from Inoreader — it 404s.
- **Williston Observer** (several/week; fragility: low-medium — TownNews/BLOX search-as-RSS with a trial-discovered category filter) — The site's advertised feed returns 0 items and the unfiltered variant returns syndicated wire junk — the &c=news* filter yields 25 genuinely local items (validated). Watch it after any site redesign.

## Civic

| Source | Method | Feed / endpoint | Freshness | Confidence |
|---|---|---|---|---|
| [Burlington permits (building/zoning/fire)](https://data.burlingtonvt.gov/) | API | `https://services1.arcgis.com/1bO0c7PxQdsGidPK/arcgis/rest/services/OpenGov_Building/FeatureServer/0/…` | ✅ live | 🟡 medium |
| [Burlington City Council meetings](https://burlingtonvt.portal.civicclerk.com/) | API | `https://burlingtonvt.api.civicclerk.com/v1/Events?$filter=contains(eventName,'City Council')&$orderb…` | ✅ live | 🟢 high |
| [Burlington CivicClerk — all boards & agendas](https://burlingtonvt.portal.civicclerk.com/) | API | `https://burlingtonvt.api.civicclerk.com/v1/Events?$orderby=startDateTime desc` | ✅ live | 🟢 high |
| [Development Review Board / Planning & Zoning](https://burlingtonvt.portal.civicclerk.com/) | API | `https://burlingtonvt.api.civicclerk.com/v1/Events?$filter=categoryId eq 63&$orderby=startDateTime de…` | ✅ live | 🟢 high |

- **Burlington permits (building/zoning/fire)** (bulk refresh (city-controlled; last refresh 2026-04-27); fragility: low-medium — standard ArcGIS REST query API, but it's an ETL export whose refresh cadence the city controls) — The live OpenGov permitting portal has no public API, but the city exports permit data to its BTVstat ArcGIS hub (141k+ building records). CAVEAT: DataUpdateDate showed the export ~2.5 months stale — fine for trends, not for 'permits filed this week'. Zoning and Fire Marshal layers also exist.
- **Burlington City Council meetings** (several/week; fragility: medium — same CivicClerk API, filtered view) — Filtered slice of the CivicClerk Events API. The old burlingtonvt.gov/CityCouncil page is a soft-404 — CivicClerk is the system of record.
- **Burlington CivicClerk — all boards & agendas** (several/day; fragility: medium — unauthenticated OData v4 API backing the official portal; vendor could add auth without notice) — THE civic source: every board/commission meeting with eventName, startDateTime, categoryId/Name, agendaId, hasAgenda, mediaSourcePath. OData filtering works ($filter, $top, $orderby). Validated live (meetings through 2027). Agenda documents hang off agendaId via portal URLs.
- **Development Review Board / Planning & Zoning** (biweekly; fragility: medium — same CivicClerk API; categoryId=63 = DRB) — DRB meets every 1-2 weeks; categoryId 63 validated to return only DRB meetings. Other planning bodies (Planning Commission etc.) have their own categoryIds discoverable via the unfiltered Events call.

## Weather & Lake

| Source | Method | Feed / endpoint | Freshness | Confidence |
|---|---|---|---|---|
| [Air quality (AirNow, Burlington)](https://www.airnow.gov/?city=Burlington&state=VT&country=USA) | API | `https://www.airnowapi.org/aq/observation/zipCode/current/?format=application/json&zipCode=05401&dist…` | ⚠️ see notes | 🟢 high |
| [Burlington beach status (cyanobacteria/closures)](https://www.burlingtonvt.gov/1219/Water-Testing-Beach-Closures-2026) | API | `https://maps.burlingtonvt.gov/arcgis/rest/services/BTV_Beach_Status/MapServer/0/query?where=1%3D1&ou…` | ✅ live | 🟢 high |
| [NWS Burlington — forecast & alerts](https://www.weather.gov/btv/) | API | `https://api.weather.gov/gridpoints/BTV/89,56/forecast` | ✅ live | 🟢 high |
| [NWS Lake Champlain recreational forecast](https://forecast.weather.gov/product.php?site=BTV&issuedby=BTV&product=REC) | API | `https://api.weather.gov/products/types/REC/locations/BTV` | ✅ live | 🟢 high |
| [USGS Lake Champlain gage (Burlington 04294500)](https://waterdata.usgs.gov/monitoring-location/04294500/) | API | `https://waterservices.usgs.gov/nwis/iv/?sites=04294500&format=json&parameterCd=00010,62614` | ✅ live | 🟢 high |

- **Air quality (AirNow, Burlington)** (hourly; fragility: low (official, keyed) / medium-high (keyless fallback)) — ACTION NEEDED: register a free key at docs.airnowapi.org/account/request/ (endpoint+params verified; only the key is missing). Keyless fallback validated live: airnowgovapi.com/reportingarea/get_state?state_code=VT returns Burlington observed+forecast AQI, but it's undocumented — use only as backup. PurpleAir requires a key and adds little here.
- **Burlington beach status (cyanobacteria/closures)** (daily in swim season; fragility: medium — city's own ArcGIS layer behind the beach tracker map; layer name could change on GIS re-platform) — GeoJSON per beach with cyanobacteria status and test timestamps (validated, per-beach dates July 9-10). Seasonal — page slug carries the year ('...-2026'), so re-locate the page each season; the ArcGIS layer is likelier to stay stable. VT DOH cyanobacteria tracker is a statewide fallback.
- **NWS Burlington — forecast & alerts** (several/day (alerts event-driven); fragility: low — official documented federal API, no key) — Validated end-to-end: points lookup → gridpoint BTV/89,56 → 14-period forecast. Alerts zone for Burlington is VTZ005; both JSON and Atom alert feeds work (Atom is Inoreader-subscribable). Re-derive the gridpoint if the target coordinates ever change.
- **NWS Lake Champlain recreational forecast** (twice daily (boating season only); fragility: low — official API; the only gotcha is the seasonal winter gap) — REC text product validated (15 products, freshest same-day, wind/waves for Northern/Main/South lake). Poll the list endpoint, fetch the newest product id, parse productText. Handle zero-products gracefully in winter.
- **USGS Lake Champlain gage (Burlington 04294500)** (real-time (~15-60 min); fragility: low — documented USGS NWIS service with decades of stability) — IMPORTANT: this gage does NOT report 00065 (gage height). Correct parameters: 62614 (lake surface elevation, ft NGVD29) and 00010 (water temp °C). Validated with current-hour data.

## Transit & Roads

| Source | Method | Feed / endpoint | Freshness | Confidence |
|---|---|---|---|---|
| [Burlington construction projects (DPW portal)](https://www.burlingtonvt.gov/323/Construction-Portal) | API | `https://services1.arcgis.com/1bO0c7PxQdsGidPK/arcgis/rest/services/Construction_and_Planning_Dataset…` | ✅ live | 🟡 medium |
| [CCRPC — traffic alerts & news](https://www.ccrpcvt.org/about-us/news/traffic-alerts/) | scrape | — | ⚠️ see notes | 🟡 medium |
| [Champlain Parkway project updates](https://champlainparkway.com/) | scrape | — | ⚠️ see notes | 🟡 medium |
| [Green Mountain Transit — service alerts](https://ridegmt.com/category/service-alert/) | RSS | `https://ridegmt.com/category/service-alert/feed/` | ✅ live | 🟢 high |
| [Great Streets BTV](https://greatstreetsbtv.com/) | RSS | `https://greatstreetsbtv.com/feed/` | ✅ live | 🟡 medium |
| [New England 511 (VTrans incidents)](https://newengland511.org/) | API | `https://newengland511.org/api/v2/get/event` | ⚠️ see notes | 🟡 medium |

- **Burlington construction projects (DPW portal)** (rolling (staff edits); fragility: medium-high — undocumented ArcGIS layer traced from the Experience Builder dashboard; could move on re-publish) — The Construction Portal dashboard's backing FeatureServer, traced via ArcGIS sharing API (no key needed). Fields include project status (CIPSTAT) and last_edited_date. Recency of edits validated same-day. Re-trace the layer if the dashboard is re-published.
- **CCRPC — traffic alerts & news** (weekly; fragility: medium — static server-rendered WP page, but the news system bypasses WP posts so every feed is empty) — All /feed/ variants return valid-but-empty RSS (news lives in static Pages, not posts). Scrape the Traffic Alerts page (li.alert-item blocks, dated) — server-rendered, no JS needed.
- **Champlain Parkway project updates** (several/week (winding down); fragility: medium — Umbraco site, no feed; updates link out to Constant Contact pages) — Scrape homepage section.latest-news (ul.latest-news__list li a) for the 5 latest updates + the .notification banner. Site says the parkway is 'now fully open' — expect this source to wind down; revisit its relevance in 6 months.
- **Green Mountain Transit — service alerts** (irregular (bursty); fragility: low-medium — standard WP category feed) — Validated (6 items, same-day, 'Service Alert :: Essex Junction'). No GTFS-RT found on the site. Sitewide /feed/ works as broader fallback.
- **Great Streets BTV** (dormant (last post 2025-07-11); fragility: low technically — but the content pipeline looks dead) — Feed works but has 2 items, exactly one year stale. Tribe Events calendar present but empty. Poll monthly at most; candidate for removal if still silent by fall 2026.
- **New England 511 (VTrans incidents)** (real-time; fragility: low-medium — documented Castle Rock/Iteris Compass API, but requires a free developer key) — ACTION NEEDED: register at the developer portal (nec-por.ne-compass.com/DeveloperPortal) for a key — the endpoint 400s with 'Invalid Key' until then, which confirms the contract. The map-widget JSON (/map/mapIcons/Incidents) is keyless but undocumented; fallback only.

## Community

| Source | Method | Feed / endpoint | Freshness | Confidence |
|---|---|---|---|---|
| [Craigslist Burlington (community/events/gigs)](https://burlington.craigslist.org/) | manual | — | — | 🟢 high |
| [Front Porch Forum](https://frontporchforum.com/) | manual | — | — | 🟢 high |
| [r/burlington](https://www.reddit.com/r/burlington/) | RSS | `https://www.reddit.com/r/burlington/.rss` | ✅ live | 🟢 high |
| [r/vermont](https://www.reddit.com/r/vermont/) | RSS | `https://www.reddit.com/r/vermont/.rss` | ✅ live | 🟢 high |

- **Craigslist Burlington (community/events/gigs)** (several/day; fragility: n/a — RSS removed (~2021), format=rss now 403s, ToS prohibits scraping) — Verified: the old RSS endpoint is actively blocked (403) and Craigslist's ToS bans automated access. Manual spot-checks of /search/eee (events), /search/ggg (gigs), /search/com (community) or skip entirely.
- **Front Porch Forum** (daily; fragility: n/a — policy decision, not technical) — POLICY: never scraped, per standing decision — FPF is membership-gated and their ToS prohibits reuse. Stephen reads his own neighborhood digest by email. Any FPF-sourced item gets manually re-reported.
- **r/burlington** (several/day; fragility: medium — Reddit aggressively rate-limits unauthenticated fetches (429s on bare curl); fine via Inoreader or with OAuth) — Confirmed working in Inoreader (and via Stephen's output stream). For direct automation use the JSON mirror (.json) with a descriptive User-Agent and backoff, or the official API with OAuth.
- **r/vermont** (several/day; fragility: medium — same rate-limit caveat as r/burlington) — Confirmed working (25 items, same-day, despite a 429 on the status probe — Reddit throttles by IP).

## Sports

| Source | Method | Feed / endpoint | Freshness | Confidence |
|---|---|---|---|---|
| [Vermont Lake Monsters](https://vermontlakemonsters.com/) | RSS | `https://vermontlakemonsters.com/feed/` | ✅ live | 🟢 high |
| [UVM Athletics](https://uvmathletics.com/) | RSS | `https://uvmathletics.com/rss.aspx` | ✅ live | 🟢 high |
| [Vermont Green FC](https://www.vermontgreenfc.com/) | RSS | `https://vermontgreenfc.com/feed/` | ✅ live | 🟢 high |

- **Vermont Lake Monsters** (near-daily in season (Jun-Sep); fragility: low-medium — core WP feed) — Game recaps near-daily in season (validated same-day). Schedule itself is a JS Presto Sports widget with no export — recaps cover newsletter needs.
- **UVM Athletics** (several/day in season; fragility: low-medium — Sidearm Sports platform feeds, used by hundreds of NCAA sites) — General all-sports news feed validated (10 items). Per-sport feeds at /rss.aspx?path={code} all validated: mbball, mhockey, whockey, wbball, msoc, wsoc. Composite schedule ICS at /calendar.ashx/calendar.ics (17 VEVENTs) covers games — ingest news via RSS + schedule via ICS. Replaces the single mbball feed currently in Inoreader.
- **Vermont Green FC** (several/week in season; fragility: low-medium — standard WP feed; NOTE robots.txt disallows ClaudeBot by name (ai-train=no)) — Feed validated (10 items, same-day match content). Given the ClaudeBot robots signal, ingest via Inoreader/generic feed reader rather than AI-agent fetchers. Match schedule lives on static pages — USL League Two's site is the better fixtures source if needed.

## Jobs

| Source | Method | Feed / endpoint | Freshness | Confidence |
|---|---|---|---|---|
| [City of Burlington Jobs (NEOGOV)](https://www.governmentjobs.com/careers/burlingtonvt) | manual | — | — | 🟢 high |
| [Indeed — Burlington](https://www.indeed.com/jobs?q=&l=Burlington%2C+VT) | manual | — | — | 🟢 high |
| [Seven Days Jobs](https://jobs.sevendaysvt.com/jobs/) | RSS | `https://jobs.sevendaysvt.com/feed/?post_type=job_listing` | ✅ live | 🟢 high |
| [UVM Jobs (PeopleAdmin)](https://www.uvmjobs.com/postings/search) | RSS | `https://www.uvmjobs.com/postings/search.atom` | ✅ live | 🟢 high |
| [UVM Medical Center Careers](https://uvmhealthcareers.org/jobs/?entity=uvmmc-the-university-of-vermont-medical-center) | scrape | — | ⚠️ see notes | 🟢 high |
| [State of Vermont Jobs (Burlington)](https://careers.vermont.gov/search/?q=&locationsearch=Burlington%2C+VT%2C+US) | scrape | — | ⚠️ see notes | 🟢 high |

- **City of Burlington Jobs (NEOGOV)** (several/month; fragility: n/a — JS-only Angular SPA, robots.txt disallows all but major search bots) — No feed, no server-rendered data, robots-blocked for generic agents. Weekly manual check, or watch the city News Flash feed for hiring announcements.
- **Indeed — Burlington** (several/day; fragility: n/a — Cloudflare 403, RSS dead (404), robots.txt disallows ?rss and /api/) — All access paths verified dead or prohibited. Licensed alternatives if job coverage matters: Adzuna or Jooble APIs (free tiers), or lean on the direct employer feeds above.
- **Seven Days Jobs** (several/day; fragility: low-medium — WP Job Manager feed via standard query-var pattern) — Validated (10 items, same-day). The bare /feed/ is empty (no blog posts) — the ?post_type=job_listing param is required.
- **UVM Jobs (PeopleAdmin)** (several/day; fragility: low-medium — PeopleAdmin Atom export; robots.txt is restrictive for generic bots (feed itself fetches cleanly)) — 105 entries, several same-day (validated). /all_jobs.atom 404s on this instance — use the search.atom form. Query params filter (e.g. ?query=... appended before .atom).
- **UVM Medical Center Careers** (daily; fragility: medium-low — custom career site, server-rendered with JobPosting JSON-LD on detail pages) — NOT Workday: uvmhealth.org/careers 301s to uvmhealthcareers.org (custom Python site). The ?entity= filter isolates UVMMC (~180 reqs, 8 pages, param page_jobs=N); detail pages carry schema.org JobPosting JSON-LD — scrape the paginated index, parse JSON-LD per job.
- **State of Vermont Jobs (Burlington)** (weekly; fragility: medium — SuccessFactors server-rendered HTML; vendor-controlled class names (jobTitle-link, jobDate)) — No feed exists in this SuccessFactors deployment, but the search page is server-rendered and robots.txt does NOT disallow /search/ — a plain HTML parse works (~12-13 Burlington listings at probe).

## Podcasts

| Source | Method | Feed / endpoint | Freshness | Confidence |
|---|---|---|---|---|
| [802 News with Mark Johnson](https://www.buzzsprout.com/2246311) | RSS | `https://feeds.buzzsprout.com/2246311.rss` | ✅ live | 🟢 high |
| [Abstract VT](https://podcasters.spotify.com/pod/show/abbey-berger-knorr) | RSS | `https://anchor.fm/s/e58d850c/podcast/rss` | ✅ live | 🟢 high |
| [Brave Little State (YouTube playlist)](https://www.youtube.com/playlist?list=PLa1bETyEfgYoSgX6KEPft51n9hEKv085c) | RSS | `https://www.youtube.com/feeds/videos.xml?playlist_id=PLa1bETyEfgYoSgX6KEPft51n9hEKv085c` | ✅ live | 🟢 high |
| [There's No 'A' in Creemee (YouTube)](https://www.youtube.com/channel/UCby5mrxzAMdnGmq2EAnO4WQ) | RSS | `https://www.youtube.com/feeds/videos.xml?channel_id=UCby5mrxzAMdnGmq2EAnO4WQ` | ✅ live | 🟢 high |
| [Happy Vermont](https://happyvermont.com/) | RSS | `http://www.happyvermont.com/feed/` | ✅ live | 🟢 high |
| [Load-In Through The Back](https://loadinpodcast.com) | RSS | `https://anchor.fm/s/f94ed7a8/podcast/rss` | ✅ live | 🟢 high |
| [The Morning Drive (WVMT)](https://www.wvmtradio.com/podcast/the-morning-drive/) | RSS | `https://www.wvmtradio.com/podcast/the-morning-drive/feed/` | ✅ live | 🟢 high |
| [Net Zero Energy Burlington (BED podcast)](https://www.burlingtonelectric.com/series/net-zero-energy-burlington-vt/) | RSS | `https://www.burlingtonelectric.com/feed/podcast/net-zero-energy-burlington-vt/` | ✅ live | 🟢 high |
| [Rocket Shop Radio Hour (YouTube playlist)](https://www.youtube.com/playlist?list=PLQrG_YyGwGqCOhuPGcmOX00vofflw6vug) | RSS | `https://www.youtube.com/feeds/videos.xml?playlist_id=PLQrG_YyGwGqCOhuPGcmOX00vofflw6vug` | ✅ live | 🟢 high |
| [The Frequency: Daily Vermont News](https://www.vermontpublic.org/podcast/the-frequency-daily-vermont-news) | RSS | `https://www.vermontpublic.org/podcast/the-frequency-daily-vermont-news/rss.xml` | ✅ live | 🟢 high |
| [The Octagon](https://theoctagonpodcast.buzzsprout.com) | RSS | `https://feeds.buzzsprout.com/2403355.rss` | ✅ live | 🟢 high |
| [United in Green (Vermont Green FC podcast)](https://UNITEDINGREEN.podbean.com) | RSS | `https://feed.podbean.com/UNITEDINGREEN/feed.xml` | ✅ live | 🟢 high |
| [Vermont Edition](https://www.vermontpublic.org/tags/vermont-edition) | RSS | `http://digital.vpr.net/feeds/766/rss.xml` | ✅ live | 🟢 high |
| [Vermont Talks (YouTube playlist)](https://www.youtube.com/playlist?list=PLQhAgbH6LBIccsrN-Pn7AYIlZwMZuL2EW) | RSS | `https://www.youtube.com/feeds/videos.xml?playlist_id=PLQhAgbH6LBIccsrN-Pn7AYIlZwMZuL2EW` | ✅ live | 🟢 high |
| [Vermont This Week (YouTube playlist)](https://www.youtube.com/playlist?list=PLa1bETyEfgYpnNz7q6tXOW_7ikLHefTq9) | RSS | `https://www.youtube.com/feeds/videos.xml?playlist_id=PLa1bETyEfgYpnNz7q6tXOW_7ikLHefTq9` | ✅ live | 🟢 high |

- **802 News with Mark Johnson** (several/week; fragility: low — Buzzsprout hosted) — Confirmed working (81 episodes, 2 days old).
- **Abstract VT** (weekly; fragility: low) — Confirmed working (66 episodes, 5 days old).
- **Brave Little State (YouTube playlist)** (stale (playlist last updated 2023); fragility: medium — playlist-scoped) — Feed works but stale; the podcast itself is active — swap for Vermont Public's audio RSS (https://www.vermontpublic.org/podcast/brave-little-state/rss.xml, unverified) for current episodes.
- **There's No 'A' in Creemee (YouTube)** (dormant (last upload 2025-07); fragility: low — YouTube channel feed) — Working but stale a full year — likely on hiatus.
- **Happy Vermont** (weekly; fragility: low — WP feed) — Confirmed working (10 items, 6 days old).
- **Load-In Through The Back** (weekly; fragility: low — Spotify/Anchor hosted) — Confirmed working (120 episodes, 1 week old).
- **The Morning Drive (WVMT)** (daily (weekdays); fragility: low-medium) — Confirmed working (10 episodes, 1 day old).
- **Net Zero Energy Burlington (BED podcast)** (monthly; fragility: low-medium) — Confirmed working (50 episodes, 10 days old).
- **Rocket Shop Radio Hour (YouTube playlist)** (dormant (2020); fragility: medium) — Feed works but newest entry is 2020 — effectively dead; candidate for removal.
- **The Frequency: Daily Vermont News** (daily (weekdays); fragility: low) — Confirmed working (20 episodes, same-day).
- **The Octagon** (biweekly; fragility: low — Buzzsprout hosted) — Confirmed working (54 episodes; last 2026-04-26).
- **United in Green (Vermont Green FC podcast)** (weekly in season; fragility: low — Podbean hosted) — Confirmed working (89 episodes, same-day fresh).
- **Vermont Edition** (daily (weekdays); fragility: low-medium — legacy digital.vpr.net URL still redirects correctly) — Confirmed working (10 items, same-day).
- **Vermont Talks (YouTube playlist)** (stale (2024-08); fragility: medium) — Feed works but newest entry Aug 2024 — verify whether the show is still producing.
- **Vermont This Week (YouTube playlist)** (stale (playlist last updated 2024-09); fragility: medium — playlist feeds only update when videos are added to THAT playlist) — Feed works but newest entry is Sept 2024 — Vermont Public likely uses a newer playlist per season. Worth re-finding the current playlist or subscribing to the channel feed instead.

## Meta (BTown aggregation layer)

| Source | Method | Feed / endpoint | Freshness | Confidence |
|---|---|---|---|---|
| [BTown Brief newsletter (own beehiiv feed)](https://www.btownbrief.com/) | RSS | `https://rss.beehiiv.com/feeds/1BT4mvZXMo.xml` | ✅ live | 🟢 high |
| [Inoreader output — Broader Local News & Podcasts](https://www.inoreader.com/) | RSS | `https://www.inoreader.com/stream/user/1003590800/tag/Broader%20Local%20News%20%26%20Podcasts` | ✅ live | 🟢 high |
| [Inoreader output — r/burlington](https://www.inoreader.com/) | RSS | `https://www.inoreader.com/stream/user/1003590800/tag/Reddit%20%28r%2Fburlington%29` | ✅ live | 🟢 high |
| [Inoreader output — r/vermont](https://www.inoreader.com/) | RSS | `https://www.inoreader.com/stream/user/1003590800/tag/Reddit%20%28r%2FVermont%29` | ✅ live | 🟢 high |
| [Inoreader output — VT News (Focused)](https://www.inoreader.com/) | RSS | `https://www.inoreader.com/stream/user/1003590800/tag/VT%20News%20%28Focused%29` | ✅ live | 🟢 high |
| [Inoreader output — VT Podcasts](https://www.inoreader.com/) | RSS | `https://www.inoreader.com/stream/user/1003590800/tag/VT%20Podcasts` | ✅ live | 🟢 high |

- **BTown Brief newsletter (own beehiiv feed)** (weekly; fragility: low — beehiiv hosted) — Own newsletter's public feed — useful for the play.btownbrief.com hub to consume. Confirmed working (20 items).
- **Inoreader output — Broader Local News & Podcasts** (several/day; fragility: low-medium) — Validated (20 items, minutes old).
- **Inoreader output — r/burlington** (several/day; fragility: low-medium — same Inoreader dependency; also insulates automation from Reddit rate limits) — Validated (20 items, minutes old). This is the cleanest way for BTown automation to read Reddit — Inoreader absorbs the 429 problem.
- **Inoreader output — r/vermont** (several/day; fragility: low-medium) — Validated (20 items, minutes old).
- **Inoreader output — VT News (Focused)** (several/day; fragility: low-medium — depends on Inoreader subscription staying active and the tag name not changing) — Curated aggregation of the focused VT news folder — a single feed automation can consume instead of polling each outlet. Validated (20 items, minutes old). DO NOT re-import into Inoreader itself (circular).
- **Inoreader output — VT Podcasts** (daily; fragility: low-medium) — Validated (20 items, minutes old).

## Inoreader housekeeping

- **Remove (dead):** WCAX `arcio` feed (`https://www.wcax.com/arcio/rss/category/news/?size=20` → 404) and legacy WPTZ `http://www.wptz.com/news/topstory.rss` (404). Working replacements (whiz-rss, topstories-rss) are already subscribed.
- **Vermont Cynic:** feed is fine — the paper is on summer break (last item 2026-05-11). Remove/re-add the subscription if Inoreader still shows 0 items.
- **Duplicate:** `digital.vpr.net/feeds/1012/rss.xml` duplicates `vermontpublic.org/local-news.rss`.
- **Stale YouTube playlist feeds:** Vermont This Week (2024), Brave Little State (2023), Rocket Shop (2020), Vermont Talks (2024), Creemee (2025) — the shows may be active on newer playlists/audio RSS; worth re-finding current feeds.
- The OPML in `data/btown-inoreader.opml` contains every validated RSS/Atom feed (including all current working subscriptions); Inoreader de-duplicates on import. It deliberately **excludes** your own Inoreader output streams (circular) and ICS/API/scrape sources.

## Open questions for Stephen

1. ~~**Seven Days events**~~ **RESOLVED 2026-07-10:** Stephen's newsletter pipeline already scrapes it via browser rendering — reclassified as scrape. (Robots-policy caveat noted in the entry; a data partnership is still the cleaner long-term answer.)
2. ~~**ECHO**~~ **RESOLVED 2026-07-10:** not needed — deprioritized. (Same for Eventbrite.)
3. **Love Burlington** — their Time.ly calendar has feed export switched OFF (`disable_export_feeds:1`). One email could get them to flip it, which would beat any scraper.
4. ~~**API keys**~~ **RESOLVED 2026-07-10:** skipped — AirNow and New England 511 keys are only needed if a future dashboard wants AQI or live road incidents. Endpoints are documented in sources.json when that day comes.
5. **Instagram-only venues** (Radio Bean*, Zero Gravity, Citizen Cider, Queen City, Red Square, Despacito) — is a paid social-monitoring service or a weekly 15-minute manual sweep worth it? (*Radio Bean has a Wix calendar that a headless scraper could read, but it's high-maintenance.)
6. **Permits freshness** — the city's ArcGIS permit export was ~2.5 months stale at probe time. If 'permits filed this week' matters, ask the city clerk/DPI whether the OpenGov export refresh can be scheduled, or whether they publish elsewhere.
7. **Meetup group whitelist** — per-group ICS works great, but someone has to curate which Burlington groups matter. Start with the 3 validated ones?
8. **Jobs scope** — Indeed and NEOGOV are closed. Is direct-employer coverage (Seven Days Jobs + UVM + UVMMC + State) enough, or should we add a licensed aggregator (Adzuna/Jooble free tiers)?
9. **Great Streets BTV & Champlain Parkway** — both winding down/dormant. Keep polling or drop?

*All URLs verified 2026-07-10. Re-run the probe workflow quarterly — undocumented endpoints (Flynn Algolia, CivicClerk OData, ArcGIS layers) deserve a scheduled health check.*
