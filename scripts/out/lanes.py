#!/usr/bin/env python3
"""Tag every upcoming event with Out's Events lanes.

Reads  data/events/events.json   (written by scripts/events/update.py; not modified)
Writes data/out/events-lanes.json

Lanes: live-music, open-mic, gallery, free, family, outdoors, sports-watch, civic, nightlife.
An event can sit in several lanes (a free outdoor concert is live-music + free + outdoors)
or in none (a knitting circle). Every tag carries the rule that fired, in `why`, so a wrong
tag can be traced to one regex and fixed there.

The rules are deliberately plain regexes over title, venue, description, the source's own
category and tags, the price text and the start time. No model call, no network, $0.

Usage:
  python3 scripts/out/lanes.py                    # write data/out/events-lanes.json
  python3 scripts/out/lanes.py --sample 100       # also print a seeded random sample (TSV)
  python3 scripts/out/lanes.py --today 2026-10-29 # pin "upcoming" to a date (tests)

When this merges into the events refresh, call tag_event() from scripts/events/update.py
right before events.json is written and store `lanes` on each record; this file then
becomes a thin wrapper (see the Out data report).
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "events" / "events.json"
OUT = ROOT / "data" / "out" / "events-lanes.json"

LANES = {
    "live-music": "Live music",
    "open-mic": "Open mics",
    "gallery": "Galleries and openings",
    "free": "Free",
    "family": "Family",
    "outdoors": "Outdoors",
    "sports-watch": "Sports to watch",
    "civic": "Civic",
    "nightlife": "Nightlife",
}

I = re.I

# ---- live music -------------------------------------------------------------------------
MUSIC_WORDS = re.compile(
    r"\b(live music|concert|band|bands|dj|d\.j\.|jazz|blues|bluegrass|folk|funk|reggae|"
    r"hip.?hop|rock|punk|metal|indie|americana|country|soul|r&b|orchestra|symphony|"
    r"philharmonic|quartet|quintet|trio|ensemble|choir|chorale|chorus|recital|"
    r"singer.?songwriter|acoustic|album release|ep release|tribute|unplugged|"
    r"jam|music|musical guests?|fiddle|celtic|irish music|piano|cello|"
    r"guitar|banjo|a cappella|opera|live band|dj set)\b", I)
# Music-category rows that are lessons or kid sing-alongs are not shows.
MUSIC_NOT_SHOW = re.compile(
    r"\b(lessons?|class(es)?|workshop|rehearsal|auditions?|music together|"
    r"sing.?along|storytime|story time|toddler|baby|babies|music & movement|"
    r"music and movement|music time|music class|kindermusik|karaoke|open mic|lecture|"
    r"talk|book club|radio show|help sessions?)\b", I)
MUSIC_VENUES = re.compile(
    r"\b(higher ground|nectar'?s|radio bean|monkey house|red square|club metronome|"
    r"light club lamp shop|lamp shop|flynn|flynnspace|main street landing|"
    r"rí ?ra|rira|halvorson'?s|three needs|the 126|venetian soda lounge|"
    r"music building and recital hall|recital hall|orlando'?s|zenbarn|"
    r"foam brewers|citizen cider|vermont pub|zero gravity|switchback|"
    r"burlington beer|four quarters|1st republic|shelburne vineyard)\b", I)

THEATER_WORDS = re.compile(r"\b(the musical|a musical|musical theat(er|re)|play|comedy|"
                           r"ballet|dance company|nutcracker|cast|broadway|improv|magic)\b", I)

# ---- open mic -----------------------------------------------------------------------------
OPEN_MIC = re.compile(
    r"\b(open[- ]?mic|open stage|open jam|poetry slam|story ?slam|slam poetry|"
    r"songwriters?'? (circle|round|night)|showcase night|comedy open)\b", I)

# ---- galleries and openings ---------------------------------------------------------------
GALLERY_WORDS = re.compile(
    r"\b(opening reception|reception|exhibit(ion)?s?|exhibition opening|art opening|"
    r"gallery|galleries|on view|art walk|first friday|artist talk|retrospective|"
    r"installation|museum|show opening|art show|art exhibit)\b", I)
GALLERY_VENUES = re.compile(
    r"\b(gallery|museum|bca center|s\.?p\.?a\.?c\.?e\.? gallery|fleming|"
    r"soda plant|karma bird|frog hollow|artists'? guild|art league|seaba|"
    r"generator|pine street studios|furchgott sourdiffe)\b", I)
GALLERY_NOT = re.compile(
    r"\b(class(es)?|workshop|paint (and|&|n) sip|sip (and|&|n) paint|drawing session|"
    r"figure drawing|lessons?|camp|storytime|story time|for kids|craft night|"
    r"crafternoon|knit|crochet|tour of the museum for|museum pass|carve.?in|yarn|"
    r"coloring|tedx|social sunday|faculty|staff|lecture|book (talk|signing))\b", I)

# ---- free ---------------------------------------------------------------------------------
FREE_PRICE = re.compile(r"^\s*(free|by donation|donations? (welcome|accepted)|"
                        r"pay what you (can|wish)|no cost|no charge|free admission)\b", I)
PAID_PRICE = re.compile(r"\$\s*\d|\b\d+\s*(dollars|usd)\b", I)
LIBRARY_SOURCES = {"fletcherfree", "sblibrary", "brownell", "winooskilibrary"}

# ---- family -------------------------------------------------------------------------------
# Same audience logic as the newsletter's merge_events.py KIDS rules: a kid word in the
# TITLE or a kid TAG means the audience is kids or families; in an art category it is a
# subject ("Investigating Child Labor") and does not count.
FAMILY_TITLE = re.compile(
    r"\b(kids?|child|children'?s?|toddlers?|preschool|pre-k|babies|baby|story ?time|"
    r"playgroup|youth|teens?|tweens?|camp|family|families|sing.?along|trick.or.treat|"
    r"trunk.or.treat|lego|puppet|storybook|all ages|grandparents?|ages? \d)\b", I)
FAMILY_TAGS = {"kids", "family", "all ages", "older kids", "teens", "storytime"}
ART_CAT = {"art"}
AGE_RANGE = re.compile(r"\bages?\s+(\d{1,2})\s*(?:to|through|-|–|—|\+)\s*(\d{1,2})?\b", I)
ADULTS_ONLY = re.compile(r"\b(21\+|21 and over|18\+|adults? only|for adults|grown.?ups|"
                         r"after dark|bar|brewery|beer|wine|cocktail|drag brunch|burlesque)\b", I)

# Seven Days files general social events under "Family Fun"; these title words or a bar
# venue mean the category is wrong about the audience.
FAMILY_CAT_NOT = re.compile(r"\b(night out|trivia|pub|beer|wine|cocktail|21\+|18\+|adults?|"
                            r"dads?'? night|moms?'? night|singles|date night|volunteer|sketch)\b", I)
FAMILY_TITLE_NOT = re.compile(r"\b(services|veterans?|partners desk|resource|caregiver support|"
                              r"volunteer|adult children|grown children)\b", I)
# a kids-and-caregivers program filed under art or other
FAMILY_DESC = re.compile(r"\b(children and (their )?caregivers|kids and (their )?caregivers|"
                         r"for (kids|children|families|toddlers)|caregivers and (wee|little) ones)\b", I)

# ---- outdoors -----------------------------------------------------------------------------
OUTDOOR_WORDS = re.compile(
    r"\b(hike|hiking|walk(ing)? tour|guided walk|nature walk|bird(ing|walk)?|paddle|"
    r"kayak|canoe|sail(ing)?|trail|trails|bike ride|group ride|mountain bike|"
    r"5k|10k|fun run|trail run|race|cleanup|clean.?up|garden(ing)?|farm stand|"
    r"orchard|apple picking|pumpkin patch|corn maze|hayride|campfire|bonfire|"
    r"stargazing|star party|foliage|snowshoe|ski|skiing|sledding|outdoor|outdoors|"
    r"in the park|park cleanup|beach|lake walk|plant sale|tree planting|"
    r"farmers'? market|forest bathing|full moon walk|night hike)\b", I)
OUTDOOR_VENUES = re.compile(
    r"\b(park|beach|trail|natural area|forest|woods|intervale|rock point|"
    r"ethan allen homestead|waterfront|bike path|greenway|farm|orchard|"
    r"catamount|sleepy hollow|red rocks|oakledge|leddy beach|centennial woods|"
    r"mount philo|camel'?s hump|shelburne farms)\b", I)
# Venues with "park" in the name that are indoor rooms or rinks.
OUTDOOR_VENUE_NOT = re.compile(r"\b(leddy park|park place|tavern|arena|rink|library|"
                               r"miller center|park ?& ?rec office)\b", I)
OUTDOOR_NOT = re.compile(r"\b(webinar|lecture|talk|book club|film|screening|class(es)? "
                         r"(on|about)|zoom|online|indoor|public skate|skate)\b", I)

# ---- sports to watch ----------------------------------------------------------------------
WATCH_TITLE = re.compile(
    r"(\bvs\.?\b|\bv\.?s\.?\b|\bversus\b|\bat\b.*\b(hockey|basketball|soccer)\b|"
    r"\bwatch party\b|\bviewing party\b|\bgame day\b|\bpack the gut+\b|"
    r"\bhome opener\b|\bchampionship\b|\bplayoffs?\b|\btournament\b|\bpolo match\b|"
    r"\bregatta\b|\bderby\b|\bmeet\b.*\b(swim|track|ski)\b|\bcarnival\b.*\bski\b|"
    r"\bmonday night football\b|\bsuper bowl\b|\bworld series\b|\bnba\b|\bnfl\b|\bnhl\b)", I)
WATCH_VENUES = re.compile(r"\b(gutterson|patrick gym|virtue field|moulton winder|"
                          r"centennial field|forward field|tarrant|ross sports center|"
                          r"cairns arena|amdez polo)\b", I)
WATCH_NOT = re.compile(
    r"\b(public skate|open gym|pickup|pick-up|drop-?in|league registration|sign.?ups?|"
    r"learn to|lessons?|class(es)?|clinic|practice|try ?outs?|5k|10k|fun run|"
    r"run club|yoga|climb|scavenger|trivia|esports|chess|bridge|board game|"
    r"spooky skate|skate|roller|dance|ski (and|&) ride sale|ski sale|swap|"
    r"tournament of (trivia|games)|cornhole tournament|poker|pinball|magic: the gathering|"
    r"mtg|pokemon|lorcana|warhammer|spelling bee|debate|hackathon|science fair)\b", I)
SPORT_WORDS = re.compile(r"\b(hockey|basketball|soccer|football|baseball|softball|"
                         r"lacrosse|volleyball|field hockey|polo|sailing|swim|track|ski|"
                         r"rugby|tennis|wrestling|gymnastics|roller derby|boxing|mma)\b", I)

TEAMS = re.compile(r"\b(catamounts|uvm|patriots|pats|celtics|bruins|red sox|canadiens|habs|"
                   r"lake monsters|vermont green|revolution|coyotes|world cup|world series|"
                   r"super bowl|stanley cup|nba finals|march madness|olympics?)\b", I)

# ---- civic --------------------------------------------------------------------------------
CIVIC = re.compile(
    r"\b(city council|council meeting|select ?board|school board|board of (commissioners|"
    r"directors|health)|commission( meeting)?|planning commission|development review board|"
    r"public hearing|public meeting|public forum|community forum|town hall|town meeting|"
    r"neighborhood planning assembly|\bnpa\b|ward \d|candidates?|candidate forum|debate|"
    r"election|ballot|vote|voting|voter registration|legislat\w+|legislators?|"
    r"budget (hearing|forum)|listening session|open house.*(plan|project|study|city)|"
    r"community (meeting|conversation|input)|charrette|zoning|cleanup|clean.?up|"
    r"volunteer (day|work|shift)|green up|rally|protest|vigil|march for|teach.?in|"
    r"civics?|naturalization|citizenship|mayor|city councilors?|state rep(resentative)?s?|"
    r"senator)\b", I)
CIVIC_POLITICAL = re.compile(r"\b(rally|protest|vigil|march for|teach.?in|candidate|"
                             r"democrats?|republicans?|progressives?|indivisible|campaign)\b", I)
CIVIC_NOT = re.compile(r"\b(debate club|debate team|vote for (your|the) (favorite|best)|"
                       r"costume contest|mock election for kids|civic (symphony|orchestra|band|"
                       r"chorus|ballet)|rally cat|movie|film|screening|bouldering|competition)\b", I)
CIVIC_VENUES = re.compile(r"\b(city hall|contois|cctv|town office|municipal|"
                          r"statehouse)\b", I)

# ---- nightlife ----------------------------------------------------------------------------
NIGHT_WORDS = re.compile(
    r"\b(dj|dance party|dance night|club night|late night|after dark|karaoke|drag|"
    r"burlesque|trivia|pub quiz|quiz night|bingo night|comedy|stand.?up|improv|"
    r"happy hour|cocktail|pub crawl|bar crawl|silent disco|disco|rave|"
    r"singles|mixer|speed dating|game night|cabaret|nightcap|after.?party|"
    r"halloween party|costume party|ball|swing dance|salsa night|contra dance|tango)\b", I)
BAR_VENUES = re.compile(
    r"\b(higher ground|nectar'?s|radio bean|monkey house|red square|club metronome|"
    r"lamp shop|rí ?ra|rira|halvorson'?s|three needs|the 126|venetian soda lounge|"
    r"doma bar|bar renée|bar renee|orlando'?s|drink|akes'? place|archives|"
    r"einstein'?s|park place tavern|olde northender|vermont comedy club|"
    r"foam brewers|vermont pub|zero gravity|citizen cider|switchback|burlington beer|"
    r"four quarters|1st republic|vermont cider lab|la reprise|deli 126|"
    r"pub|tavern|taproom|tap house|brewery|brewing|cider|lounge|bar\b|saloon|"
    r"winery|vineyard|wines|distillery|speakeasy)\b", I)
HAPPY_HOUR = re.compile(r"\b(happy hour|half.?price[d]? (cocktails|drinks|wine|beer|apps)|"
                        r"pub hour|cocktail hour|oyster hour|"
                        r"\$\d+(\.\d\d)? (drinks?|pints?|cocktails?|wine|martinis?|margaritas?|beers?)|"
                        r"(martini|margarita|wine|beer) (night|tuesday|wednesday|thursday|monday))\b", I)
NIGHT_NOT = re.compile(r"\b(storytime|story time|kids?|toddler|family|brunch|"
                       r"yoga|run club|5k|book club|knit|crochet|meditation|"
                       r"recovery|sober|aa meeting|class(es)?|workshop|lessons?)\b", I)


def _start_hour(e):
    s = e.get("start") or ""
    if e.get("allDay") or "T" not in s:
        return None
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    return dt.hour + dt.minute / 60


def _blob(*parts):
    return " ".join(p for p in parts if p)


def tag_event(e):
    """Return (lanes, why) for one events.json record. Pure function, no I/O."""
    title = e.get("title") or ""
    venue = e.get("venue") or ""
    desc = e.get("description") or ""
    cat = (e.get("category") or "").lower()
    tags = {t.lower() for t in (e.get("tags") or [])}
    price = e.get("price") or ""
    src = e.get("source") or ""
    hour = _start_hour(e)
    td = _blob(title, desc)
    tv = _blob(title, venue)
    why = {}

    def hit(lane, reason):
        why.setdefault(lane, reason)

    # family first: several lanes look at it
    family = False
    if tags & FAMILY_TAGS:
        family = True
        hit("family", f"tag:{sorted(tags & FAMILY_TAGS)[0]}")
    elif cat == "family" and not FAMILY_CAT_NOT.search(title) and not BAR_VENUES.search(venue):
        family = True
        hit("family", "category:family")
    elif FAMILY_DESC.search(desc) and not ADULTS_ONLY.search(title):
        family = True
        hit("family", f"description:{FAMILY_DESC.search(desc).group(0).lower()}")
    elif (FAMILY_TITLE.search(title) and cat not in ART_CAT and not ADULTS_ONLY.search(title)
          and not FAMILY_TITLE_NOT.search(title)):
        family = True
        hit("family", f"title:{FAMILY_TITLE.search(title).group(0).lower()}")
    else:
        m = AGE_RANGE.search(_blob(title, desc))
        if m and m.group(2) and int(m.group(2)) < 18:
            family = True
            hit("family", f"ages {m.group(1)}-{m.group(2)}")

    # open mic
    if OPEN_MIC.search(td):
        hit("open-mic", f"words:{OPEN_MIC.search(td).group(0).lower()}")

    # live music
    not_show = MUSIC_NOT_SHOW.search(title) or re.search(r"\bweekly rehearsal|drink specials\b", desc, I)
    if not not_show and re.search(r"\blive music\b", desc, I) and cat in {"food-drink", "other"}:
        hit("live-music", "description says live music")
    if "open-mic" not in why and not not_show:
        if cat == "music":
            hit("live-music", "category:music")
        elif MUSIC_WORDS.search(title) and cat not in {"learning", "words", "wellness", "film"}:
            hit("live-music", f"title:{MUSIC_WORDS.search(title).group(0).lower()}")
        elif MUSIC_VENUES.search(venue) and MUSIC_WORDS.search(desc) and (
                cat in {"other", "food-drink", ""} or (cat == "theater" and not THEATER_WORDS.search(td))):
            hit("live-music", "music venue + music words in description")

    # galleries and openings
    if not GALLERY_NOT.search(title) and not family:
        if cat == "art" and (GALLERY_WORDS.search(td) or GALLERY_VENUES.search(venue)):
            hit("gallery", "category:art + exhibit words/venue")
        elif GALLERY_WORDS.search(title) and (GALLERY_VENUES.search(venue) or cat == "art"):
            hit("gallery", f"title:{GALLERY_WORDS.search(title).group(0).lower()}")
        elif "ongoing" in tags and GALLERY_VENUES.search(venue):
            hit("gallery", "ongoing at a gallery/museum")

    # free
    paid = bool(PAID_PRICE.search(price)) and not FREE_PRICE.search(price)
    if paid:
        pass
    elif e.get("free") is True or e.get("minPrice") == 0:
        hit("free", "source says free")
    elif FREE_PRICE.search(price):
        hit("free", f"price:{price[:20]}")
    elif src in LIBRARY_SOURCES and not PAID_PRICE.search(desc):
        hit("free", "library event (always free)")
    elif re.search(r"\b(a |this )?free (yoga|class|event|workshop|concert|show|admission|"
                   r"program|session|screening)\b|\bfree and open to\b", desc, I):
        hit("free", "description says free")
    elif False:
        hit("free", "library event (always free)")

    # outdoors
    io = e.get("indoorOutdoor")
    if not OUTDOOR_NOT.search(title):
        if io == "outdoor":
            hit("outdoors", "source says outdoor")
        elif cat == "outdoors" and io != "indoor":
            hit("outdoors", "category:outdoors")
        elif io != "indoor" and OUTDOOR_WORDS.search(title):
            hit("outdoors", f"title:{OUTDOOR_WORDS.search(title).group(0).lower()}")
        elif io != "indoor" and OUTDOOR_VENUES.search(venue) and not OUTDOOR_VENUE_NOT.search(venue):
            hit("outdoors", f"venue:{OUTDOOR_VENUES.search(venue).group(0).lower()}")

    # sports to watch
    if not WATCH_NOT.search(title):
        wt = WATCH_TITLE.search(title)
        if wt and wt.group(0).strip().lower() in {"watch party", "viewing party"}:
            if SPORT_WORDS.search(title) or TEAMS.search(title):
                hit("sports-watch", "watch party")
        elif wt and (cat == "sports" or SPORT_WORDS.search(title) or WATCH_VENUES.search(venue)):
            hit("sports-watch", f"title:{wt.group(0).strip().lower()}")
        elif WATCH_VENUES.search(venue) and cat == "sports":
            hit("sports-watch", f"venue:{WATCH_VENUES.search(venue).group(0).lower()}")
        elif re.search(r"\bwatch party\b|\bviewing party\b|\bscreening\b", title, I) and (
                SPORT_WORDS.search(title) or TEAMS.search(title)):
            hit("sports-watch", "watch party")

    # civic
    if not CIVIC_NOT.search(title):
        m = CIVIC.search(title)
        if m:
            hit("civic", f"title:{m.group(0).lower()}")
        elif cat == "community" and CIVIC_VENUES.search(venue):
            hit("civic", f"venue:{CIVIC_VENUES.search(venue).group(0).lower()}")
        elif "civics" in tags:
            hit("civic", "tag:civics")

    # nightlife: an evening thing at a bar or club, or a night-out format after 8pm
    if not family and not NIGHT_NOT.search(title) and hour is not None:
        bar = BAR_VENUES.search(venue)
        nw = NIGHT_WORDS.search(title)
        if hour >= 21:
            hit("nightlife", f"starts {int(hour)}:{int(round((hour % 1) * 60)):02d}")
        elif hour >= 18 and bar and (nw or "live-music" in why or cat in {"music", "comedy", "games", "food-drink"}):
            hit("nightlife", f"evening at {bar.group(0).lower()}")
        elif hour >= 18 and re.search(r"\b(trivia|dj|karaoke)\b", title + " " + desc[:40], I) and (
                bar or not venue or re.search(r"\b(experience|lanes|arcade|bowl)\b", venue, I)):
            hit("nightlife", "evening trivia/DJ/karaoke")
        elif hour >= 19 and nw and not re.search(r"\bdads?'? night out\b", title, I):
            hit("nightlife", f"evening + {nw.group(0).lower()}")
        elif hour >= 20 and "live-music" in why:
            hit("nightlife", "live music after 8pm")
        elif hour >= 15 and HAPPY_HOUR.search(title):
            hit("nightlife", f"happy hour: {HAPPY_HOUR.search(title).group(0).lower()}")

    lanes = [k for k in LANES if k in why]
    return lanes, {k: why[k] for k in lanes}


# Stephen's own events (his Meetup group, Btown Brief / Btown Coffee Club) are flagged so the
# app can pin them, the same rule as the newsletter's merge_events.py STEPHEN_OWN.
STEPHEN_OWN = re.compile(r"burlington-social-activites-group|btown (brief|coffee)", I)


def is_upcoming(e, today):
    if e.get("status") != "active":
        return False
    last = e.get("ongoingUntil") or e.get("date") or ""
    return last[:10] >= today


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--today", default=date.today().isoformat())
    ap.add_argument("--sample", type=int, default=0)
    ap.add_argument("--seed", type=int, default=20261029)
    ap.add_argument("--src", default=str(SRC))
    ap.add_argument("--out", default=str(OUT))
    a = ap.parse_args(argv)

    data = json.loads(Path(a.src).read_text())
    events = [e for e in data["events"] if is_upcoming(e, a.today)]
    rows = []
    counts = {k: 0 for k in LANES}
    untagged = 0
    for e in events:
        lanes, why = tag_event(e)
        for k in lanes:
            counts[k] += 1
        if not lanes:
            untagged += 1
        rows.append({
            "id": e["id"], "title": e.get("title"), "start": e.get("start"),
            "end": e.get("end"), "date": e.get("date"), "allDay": e.get("allDay"),
            "ongoingUntil": e.get("ongoingUntil"),
            "venue": e.get("venue"), "address": e.get("address"), "town": e.get("town"),
            "price": e.get("price"), "free": e.get("free"),
            "category": e.get("category"), "url": e.get("url"), "source": e.get("source"),
            "lanes": lanes, "why": why,
            "own": bool(STEPHEN_OWN.search(f"{e.get('url') or ''} {e.get('title') or ''}")),
            # every record carries its source page and when that page was last read
            "source_url": e.get("url"), "verified": (e.get("lastSeen") or "")[:10] or None,
        })
    out = {
        "generated": datetime.now().astimezone().isoformat(timespec="seconds"),
        "_about": ("Out's Events lanes. Built by scripts/out/lanes.py from data/events/events.json "
                   "(the City Guide's events refresh). One row per upcoming active event, with the "
                   "lanes it belongs to and the rule that put it there (why). source_url is the "
                   "event's own listing; verified is the last time the refresh saw it there."),
        "sourceGenerated": data.get("generated"),
        "today": a.today,
        "lanes": LANES,
        "counts": {"events": len(rows), "untagged": untagged, **counts},
        "events": rows,
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {a.out}: {len(rows)} events, {untagged} untagged", file=sys.stderr)
    print(json.dumps(out["counts"]), file=sys.stderr)

    if a.sample:
        rnd = random.Random(a.seed)
        for r in rnd.sample(rows, min(a.sample, len(rows))):
            print("\t".join([r["id"], (r["title"] or "")[:70], (r["venue"] or "")[:30],
                             (r["start"] or "")[11:16], r["category"] or "", (r["price"] or "")[:15],
                             ",".join(r["lanes"])]))


if __name__ == "__main__":
    main()
