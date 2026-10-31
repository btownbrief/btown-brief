"""Town's live feed: everything that changed in Burlington, in one list.

Reads what the other Town scripts and the site's refresh jobs already write
and turns it into data/town/feed.json, the one file the app's Now tab reads:

  data/town/streets.json     permits, home sales, construction projects
  data/town/alerts.json      parking ban, school closings
  data/town/signups.json     registration openings
  data/changes/changes.json  agendas, road work, food news, weather, the
                             threads taking off on r/burlington
  data/jobs.json             new jobs, rolled up by day
  data/events/events.json    Tonight, and the day's New on the calendar rollup
  all-day/data/instagram.json  the Pictures tiles
  data/things.json           the day's Guess the street, a public place only
  the Reddit intake          what the Reddit tab reads, for each thread's
                             nsfw, flair and removal marks
  the VT Outages town list   customers out around Burlington, for the hero

It also writes data/town/moves.json, what Body's Today reads: the week's movement
events, the aerials of the club meets, and pictures from Body's accounts.

A permit, sale or job tile's time is when this script first saw it, kept in
feed-seen.json, so a batch the city posts on Tuesday arrives on Tuesday however
old its filing dates are. On the first run there is no ledger, so each takes its
own date. Everything else already carries the moment it happened, and a meeting
whose agenda lands jumps back to the top because its record changed.

Map points come from streets.py, which also strips a home down to its street
before anything is written (redact.py), so this file never sees a house number.
The app draws the state's aerial photo for each point.

Run from the repo root: python3 -m scripts.town.build_feed
"""

import datetime as dt
import hashlib
import json
import os
import re

from .title_guard import held, names_person
from .aerials import fetch, prune
from .redact import hidden
from .common import BTV_TZ, OUT_DIR, ROOT, get_json, load_json, now_iso, today_btv, write_json
from .geo import Geo, street_of

FEED_PATH = os.path.join(OUT_DIR, "feed.json")
SEEN_PATH = os.path.join(OUT_DIR, "feed-seen.json")
MOVES_PATH = os.path.join(OUT_DIR, "moves.json")
INSTAGRAM_PATH = os.path.join(ROOT, "all-day", "data", "instagram.json")
EVENTS_PATH = os.path.join(ROOT, "data", "events", "events.json")
THINGS_PATH = os.path.join(ROOT, "data", "things.json")
CLUBS_PATH = os.path.join(ROOT, "data", "run-clubs.json")
LEAGUES_PATH = os.path.join(ROOT, "data", "body", "leagues.json")
OUTAGES = "https://api.vtoutages.com/outage/town?utilityType=electric"
REDDIT_INTAKE = "https://raw.githubusercontent.com/btownbrief/btown-brief/reddit-data/data/reddit-intake.json"

WINDOW_DAYS = 28        # how far back a tile can reach
MAX_TILES = 140
SIGNUP_AHEAD = 10       # days of registration openings to show
JOB_DAYS = 3            # days of job rollups
FOOD_SAME_DAYS = 3      # two outlets on one story land within this long of each other
FOOD_PLACES = {"burlington", "vermont", "downtown"}
FOOD_STOP = set("afte anno clos from open with year".split())  # after, announces, close, opening, years...

OUTAGE_TOWNS = {"burlington", "southburlington", "winooski", "essex", "essexjunction", "colchester", "williston", "shelburne"}
OUTAGE_MIN = 25         # customers out before the hero says so

TONIGHT_ROWS = 8        # more than the tile shows, so it stays full as the evening passes
TONIGHT_HOUR = 16       # today's rows start here
CALENDAR_DAYS = 2       # days of New on the calendar rollups
CALENDAR_ROWS = 4
NEWS_DAYS = 8
MAX_NEWS = 30
PHOTO_DAYS = 3          # Instagram's image links die after about four
MAX_PHOTOS = 16
PHOTO_PER_ACCOUNT = 2
PHOTO_CATEGORIES = {"scenic", "events", "pets"}
PHOTO_KINDS = {"scenic", "vibe", "pets", "other"}  # a poster is words, not a picture
MOVE_DAYS = 7
MOVE_CATEGORIES = {"sports", "outdoors", "wellness"}
MOVE_ALSO = {"community", "other", "learning", "family"}  # a dance night or a cleanup filed elsewhere; UVM's in these are its students'
SCENE_POSTS = 4
# Body's accounts, all on the Instagram roster already
SCENE_HANDLES = {"socialsports_vt", "catamountoutdoorcenter", "localmotionvermont", "boltersrun", "dadguild", "skirackvt",
                 "savu.sauna", "vtsaunafest", "winooski_wheels", "nautipaddle", "burlington.basketball.league", "sbrecdept"}
# Guess the street's places, each point checked by eye on the state's own photo: things.json's coords are
# map pins, kilometers off for a view this tight. A new place goes in only after the same look. No festivals.
STREET_PLACES = {"waterfront-park": (44.4789, -73.2214), "battery-park": (44.4811, -73.2197), "echo-leahy-center": (44.4766, -73.221),
                 "community-sailing-center": (44.4831, -73.2248), "andy-adog-skatepark": (44.4828, -73.2238), "texaco-beach": (44.4897, -73.2334),
                 "oakledge-park": (44.4544, -73.2271), "worlds-tallest-filing-cabinet": (44.45584, -73.21722),
                 "generator-makerspace": (44.45923, -73.21625), "petra-cliffs": (44.45239, -73.21835),
                 "north-beach": (44.4917, -73.2395), "leddy-beach": (44.5017, -73.2531), "leddy-arena": (44.50279, -73.25338),
                 "ethan-allen-homestead": (44.5082, -73.2318), "intervale-center": (44.496, -73.2066),
                 "shelburne-museum": (44.3737, -73.2323), "shelburne-farms": (44.396, -73.2773), "vermont-teddy-bear": (44.3614, -73.2298),
                 "shelburne-orchards": (44.3537, -73.2662),
                 "cairns-arena": (44.4471, -73.175), "higher-ground": (44.469, -73.1757), "whale-tails-sculpture": (44.44561, -73.14314),
                 "sunset-drive-in": (44.537, -73.2515), "colchester-pond": (44.5492, -73.125), "delta-park": (44.5318, -73.2752),
                 "essex-resort-spa": (44.50161, -73.07842), "essex-cinemas": (44.5063, -73.0798), "saxon-hill": (44.4884, -73.0235)}
STREET_FAR = 0.002      # degrees apart, so two choices are never the same photo

# a town's stories, in its own words; national wire copy names none of these
LOCAL = re.compile(r"\b(Burlington|Winooski|Essex|Colchester|Williston|Shelburne|Chittenden|Hinesburg|Charlotte|Jericho|"
                   r"UVM|University of Vermont|Champlain College|Church Street|Lake Champlain|Old North End|Catamounts?)\b")
# held() stops at a name it knows and the words of an accusation; a crime story's own name may be neither
NEWS_CRIME = re.compile(r"\b(police(?! chief)|cops?|sheriffs?|troopers?|suspects?|crash\w*|collision|killed|kills?|dead|deaths?|dies|died|"
                        r"fatal\w*|overdos\w*|drugs?|fentanyl|robb\w*|burglar\w*|theft\w*|thie[fv]\w*|stolen|guns?|firearms?|"
                        r"weapons?|jail\w*|prisons?|inmates?|courts?|trials?|judges?|lawsuits?|sues?|sued|pleads?|plea|guilty|"
                        r"victims?|missing|manhunt|warrants?|prosecut\w*|crimes?|criminal\w*|felon\w*|"
                        r"shots?|shootings?|gunfire|gunshots?|gunman|gunmen|gunned|gunpoint|knifepoint|slain|slay\w*|stabs?|stabb\w*|"
                        r"arson\w*|kidnap\w*|abduct\w*|hostages?|carjack\w*|detain\w*|custody|bail|parole|probation|arraign\w*|extradit\w*|"
                        r"dui|dwi|oui|impaired|drunk[- ]driv\w*|traffick\w*|smuggl\w*|dealers?|heroin|cocaine|meth|methamphetamine|"
                        r"attack\w*|assault\w*|brawl\w*|strangl\w*|mugg(?:ed|ing|ings|er|ers)|violen\w*|standoff|lockdowns?|hit[- ]and[- ]run|"
                        r"vandal\w*|threat\w*|bomb(?:s|ed|ing|ings)?|riot\w*|gangs?|raid(?:s|ed|ing)?|trespass\w*|looting|looted|shoplift\w*|larceny|"
                        r"murder\w*|homicides?|manslaughter|rape\w*|rapist|molest\w*|sex offen\w*|offenders?|perpetrators?|fugitives?|"
                        r"abus\w*|harass\w*|stalk\w*|porn\w*|arrest\w*|charged|charges|indict\w*|convict\w*|sentenc\w*|accus\w*|alleg\w*|"
                        r"misdemeanors?|prisoners?|deputies|fraud\w*|defraud\w*|embezzl\w*|scam\w*|extort\w*|brib\w*|forged|forgery)\b", re.I)
NOT_NEWS = re.compile(r"^(opinion|commentary|editorial|letters?|perspective)\b", re.I)
PHOTO_PROMO = re.compile(r"\b(?:giveaway|booking|sponsored)\b|\[a ?d\]|#ad\b", re.I)
MOVING = re.compile(r"\b(run|runs|running|runners?|walk|walks|walking|hike|hikes|hiking|skate|skating|yoga|climb|climbing|bouldering|"
                    r"basketball|pickleball|volleyball|soccer|futsal|tennis|ultimate frisbee|disc golf|pick-?up|ride|rides|bike|biking|"
                    r"cycling|ski|skiing|snowshoe|snowshoeing|swim|swimming|paddle|kayak|kayaking|rowing|dance|dances|dancing|contra|"
                    r"swing|salsa|tango|bachata|zumba|barre|hiit|fitness|workout|workouts|boot ?camp|tai chi|qi ?gong|pilates|open gym|"
                    r"5k|10k|clean ?up)\b", re.I)
NOT_MOVING = re.compile(r"\b(intramurals?|students?|preschool|kids?|youth|itty bitty|toddlers?|vs\.?|sale|swap|workshop|basics)\b", re.I)
CAMPUS = re.compile(r"\b(Student Life|Davis Center)\b", re.I)  # a student's room, not the town's
LEAGUE_RANGE = re.compile(r"([A-Z][a-z]{2}) (\d{1,2}) to ([A-Z][a-z]{2}) (\d{1,2})")

# view widths in Web Mercator metres (about 0.7 of a real metre at this latitude)
VIEW_HOME = 260         # a neighborhood, not one house
VIEW_SITE = 170         # a business or a building site
VIEW_ROAD = 300
VIEW_PLACE = 300        # a park, a beach, a building and its block

BATCH = {"sold", "going", "week", "jobs", "signup"}  # posted in lumps, long after their own dates

KIND = {"Single Family Dwelling": "House", "Condominium": "Condo", "Multi Family": "Multi-family",
        "Office Buildings": "Office", "Retail": "Retail", "Mobile Home": "Mobile home"}
HOMES = {"House", "Condo", "Multi-family", "Mobile home"}

REASON = {"demolition": "Demolition", "adu": "New ADU", "restaurant_or_fitout": "Restaurant fit-out",
          "commercial_occupancy": "Change of use", "change_of_use": "Change of use", "new_building": "New building",
          "new_construction": "New building", "big_cost": "Big project", "big_project": "Big project"}



def _date(s):
    return dt.datetime.fromisoformat(str(s)[:10]).date()


def _noon(day):
    """A date with no time, as noon in Burlington."""
    return dt.datetime.fromisoformat(f"{str(day)[:10]}T12:00:00").replace(tzinfo=BTV_TZ).astimezone(dt.timezone.utc).isoformat()


def _ts(iso):
    return dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))


def _slug(*parts):
    return re.sub(r"[^a-z0-9]+", "-", " ".join(str(p) for p in parts).lower()).strip("-")[:70]


def _calm(text):
    """'NECTARS/CAPONES REFIT' -> 'Nectars/Capones Refit'. Mixed case is left alone."""
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    if re.search(r"[a-z]", t):
        return t
    return re.sub(r"(^|[\s/(-])([a-z])", lambda m: m.group(1) + m.group(2).upper(), t.lower())


# ---------------------------------------------------------------------- tiles
def sold_tiles(streets, cutoff):
    sales = (streets.get("sections", {}).get("sales") or {})
    best = {}
    for s in sales.get("items", []):
        if not s.get("arms_length") or not s.get("price") or s["price"] < 25000:
            continue
        kind = KIND.get(re.sub(r"^\d+\.\s*", "", s.get("property_class") or ""))
        if not kind or _date(s["posted"]) < cutoff:
            continue
        key = re.sub(r"\W+", "", (s["address"] + str(s.get("closed")) + str(s["price"])).lower())
        best.setdefault(key, (s, kind))
    out = []
    for s, kind in best.values():
        home = kind in HOMES or s.get("home", False)
        pt = s.get("pt") or [None, None]
        out.append({
            "id": "sold-" + str(s["id"]), "kind": "sold", "ts": _noon(s["posted"]),
            "title": f"{kind} on {s['address']}" if home else _calm(s["address"]),
            "price": s["price"], "assessed": s.get("grand_list_value") or None, "closed": s.get("closed"),
            "lat": pt[0], "lon": pt[1], "m": VIEW_HOME if home else VIEW_SITE, "url": None,
        })
    return out


def _job_name(p, reasons):
    label = next((REASON[r] for r in reasons if r in REASON), None)
    if p.get("home", True) or names_person(p.get("project")):
        return label or "Home project"  # the project name may be the owner's own
    label = label or _calm(p.get("address"))
    num = re.match(r"^\d+[-\d]*", p.get("address") or "")
    t = re.sub(r"\bburlington,?\s*(vt|vermont)?\s*\d{0,5}\s*$", "", str(p.get("project") or ""), flags=re.I).strip()
    if num:
        t = re.sub(r"\s*" + re.escape(num.group(0)) + r"\s+[A-Za-z .]+$", "", t).strip()
    t = re.sub(r"^[-\d\s]+[A-Za-z .]*\b(street|st|avenue|ave|road|rd|place|pl|lane|ln|drive|dr)\b\.?\s*[-–:]?\s*", "", t, flags=re.I).strip()
    if not t or re.match(r"^(project_\d+|\d)", t, re.I):
        return label
    return _calm(t)


def going_tiles(streets, cutoff):
    permits = (streets.get("sections", {}).get("permits") or {})
    seen, out = set(), []
    for p in sorted((x for x in permits.get("items", []) if x.get("notable")), key=lambda x: x["applied"], reverse=True):
        if _date(p["applied"]) < cutoff:
            continue
        key = (p["address"] + "|" + (p.get("project") or "")).lower()
        if key in seen:
            continue
        seen.add(key)
        reasons = p.get("notable_reasons") or []
        home = p.get("home", True)
        pt = p.get("pt") or [None, None]
        out.append({
            "id": "going-" + str(p["id"]), "kind": "going", "ts": _noon(p["applied"]),
            "title": _job_name(p, reasons),
            "where": p["address"] if home else _calm(p["address"]),
            "what": next((REASON[r] for r in reasons if r in REASON), None),
            "cost": p.get("est_cost") or None,
            "lat": pt[0], "lon": pt[1], "m": VIEW_HOME if home else VIEW_SITE,
            "url": p.get("source_url"),
        })
    return out


def week_tiles(streets, cutoff):
    """The week's ordinary permits as one tile, so they never flood the feed."""
    permits = (streets.get("sections", {}).get("permits") or {})
    out = []
    for w in (permits.get("weekly_roundup") or [])[:2]:
        dates = [p["applied"] for p in permits.get("items", []) if p.get("week") == w["week"]]
        if not dates or _date(max(dates)) < cutoff:
            continue
        kinds = sorted((w.get("by_kind") or {}).items(), key=lambda kv: -kv[1])[:4]
        out.append({"id": "week-" + w["week"], "kind": "week", "ts": _noon(max(dates)), "n": w["total"],
                    "cost": w.get("est_cost_total") or None, "bars": [[k, n] for k, n in kinds], "url": None})
    return out


MONTHS = {m: i + 1 for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}
WEEKDAYS = {d: i for i, d in enumerate("mon tue wed thu fri sat sun".split())}


def _meeting_day(text, today):
    """A date with no year: the year whose calendar matches the weekday, soonest first."""
    m = re.search(r"\b(Mon|Tues?|Wed(?:nes)?|Thu(?:rs)?|Fri|Sat(?:ur)?|Sun)[a-z]*,?\s+([A-Z][a-z]{2})[a-z]*\.?\s+(\d{1,2})", text)
    if not m or m.group(2).lower() not in MONTHS:
        return None
    month, day, want = MONTHS[m.group(2).lower()], int(m.group(3)), WEEKDAYS[m.group(1)[:3].lower()]
    fits = []
    for y in (today.year, today.year + 1):
        try:
            d = dt.date(y, month, day)
        except ValueError:
            continue
        if d.weekday() == want:
            fits.append(d)
    return next((d for d in fits if d >= today), fits[0] if fits else None)


def city_tiles(changes, today, cutoff):
    latest, cancelled = {}, set()
    for e in changes:
        if e.get("category") != "cityhall" or _ts(e["ts"]).astimezone(BTV_TZ).date() < cutoff:
            continue
        text = e["headline"] + " " + (e.get("detail") or "")
        day = _meeting_day(text, today)
        if not day or day < today:
            continue  # a meeting that has already happened is not news
        ev = re.search(r"/event/(\d+)", e.get("url") or "")
        key = ev.group(1) if ev else _slug(e["headline"])
        note = re.search(r"\*([^*]+)\*", e["headline"])
        note = note.group(1).strip() if note else None
        if note and "cancel" in note.lower():
            cancelled.add(key)
            continue
        posted = "agenda posted" in e["headline"].lower()
        if key in latest and latest[key]["agenda"] and not posted:
            continue
        name = re.sub(r"\*[^*]*\*\s*", "", e["headline"])
        name = re.sub(r"\s+(agenda posted|scheduled for .*)$", "", name, flags=re.I)
        name = re.sub(r"\s+Meeting$", "", name.strip()).replace(" - ", ": ")
        latest[key] = {"id": f"city-{key}-{'agenda' if posted else 'date'}", "kind": "city", "ts": e["ts"], "title": name,
                       "day": day.isoformat(), "agenda": posted, "url": e.get("url")}
        if note:
            latest[key]["sub"] = note
    meetings, seen = [], set()
    live = (m for key, m in latest.items() if key not in cancelled)
    for m in sorted(live, key=lambda x: x["ts"], reverse=True):
        if (m["title"], m["day"]) not in seen:
            seen.add((m["title"], m["day"]))
            meetings.append(m)
    big = [m for m in meetings if re.fullmatch(r"City Council", m["title"]) or re.search(r"forum|hearing", m["title"], re.I)]
    rest = sorted((m for m in meetings if m not in big), key=lambda x: x["day"])
    if rest:
        big.append({"id": "cityweek", "kind": "cityweek", "ts": max(m["ts"] for m in rest),
                    "rows": [[m["day"], m["title"], m["url"]] + ([m["sub"]] if m.get("sub") else []) for m in rest[:5]],
                    "n": len(rest), "url": "#cityhall"})
    return big


def road_tiles(changes, streets, geo, cutoff):
    projects = {re.sub(r"\W+", "", (p.get("name") or "").lower()): p
                for p in (streets.get("sections", {}).get("projects") or {}).get("items", [])}
    groups = {}
    for e in changes:
        if e.get("category") != "roads" or _ts(e["ts"]).astimezone(BTV_TZ).date() < cutoff:
            continue
        name = re.sub(r"^New on the city construction map:\s*", "", e["headline"]).strip()
        whole = name
        name = re.sub(r"\s*\(#\d+\)\s*$", "", name)
        name = name.split(" — ")[-1].strip()
        g = groups.setdefault(name.lower(), {"name": name, "n": 0, "ts": e["ts"], "url": e.get("url"), "raw": whole})
        g["n"] += 1
        g["ts"] = max(g["ts"], e["ts"])
    out = []
    for g in groups.values():
        p = projects.get(re.sub(r"\W+", "", g["raw"].lower()))
        street = None
        if p and p.get("streets"):
            s = p["streets"]
            street = (s[0] if isinstance(s, list) and s else s if isinstance(s, str) else None)
        if not street:
            m = re.match(r"^(.*?\b(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Place|Pl|Way|Park|Pkwy))\b", g["name"])
            street = m.group(1) if m else None
        hit = geo.find(street) if street else None
        out.append({"id": "road-" + _slug(g["name"]), "kind": "road", "ts": g["ts"], "title": g["name"], "n": g["n"],
                    "what": (p or {}).get("type"), "lat": hit[0] if hit else None, "lon": hit[1] if hit else None,
                    "m": VIEW_ROAD, "url": g["url"]})
    return out


def _food_words(headline):
    """What a headline is about, cut to four letters so brewery and breweries match. Place
    names and the words any closing or opening story uses say nothing about which one it is."""
    words = re.findall(r"[a-z]+", re.sub(r"\bbbq\b", "barbecue", headline.lower()))
    return {w[:4] for w in words if len(w) > 3 and w not in FOOD_PLACES and w[:4] not in FOOD_STOP}


def _same_story(a, b):
    shared = a & b
    return len(shared) >= 2 and len(shared) * 2 >= min(len(a), len(b))


def food_tiles(changes, cutoff):
    out, kept = [], []
    for e in sorted((x for x in changes if x.get("category") == "food"), key=lambda x: x["ts"]):
        ts = _ts(e["ts"])
        if ts.astimezone(BTV_TZ).date() < cutoff:
            continue
        words = _food_words(e["headline"])
        if any((ts - when).days < FOOD_SAME_DAYS and _same_story(words, had) for when, had in kept):
            continue
        kept.append((ts, words))
        out.append({"id": "food-" + _slug(e["headline"]), "kind": "food", "ts": e["ts"], "title": e["headline"], "url": e.get("url")})
    return out


def load_intake():
    try:
        return get_json(REDDIT_INTAKE, timeout=60)
    except (RuntimeError, ValueError) as e:
        print(f"[feed] no Reddit intake: {type(e).__name__}")
        return None


def _thread_id(url):
    m = re.search(r"/comments/([a-z0-9]+)", url or "", re.I)
    return m.group(1).lower() if m else None


def reddit_tiles(changes, cutoff, intake):
    """The threads r/burlington took to, by the Reddit tab's rules: the intake has the
    thread, confirmed safe for work and not removed, and neither title nor flair is
    held. A thread the intake doesn't have stays out, so no intake means no tiles."""
    posts = {str(p.get("id")).lower(): p for p in (intake or {}).get("posts", [])}
    removed = {str(k).lower() for k in (intake or {}).get("removed", {})}
    out = []
    for e in changes:
        if e.get("category") != "chatter" or _ts(e["ts"]).astimezone(BTV_TZ).date() < cutoff:
            continue
        m = re.match(r"^Taking off on r/burlington:\s*(.+)$", e["headline"])
        tid = _thread_id(e.get("url"))
        p = posts.get(tid)
        if not m or not p or tid in removed or p.get("nsfw") is not False or (p.get("score") or 0) < 0 or held(m.group(1), p.get("flair")):
            continue
        d = re.search(r"(\d+)\D+(\d+) comments", e.get("detail") or "")
        out.append({"id": "reddit-" + _slug(m.group(1)), "kind": "reddit", "ts": e["ts"], "title": m.group(1),
                    "score": int(d.group(1)) if d else None, "comments": int(d.group(2)) if d else None, "url": e.get("url")})
    return out


def weather_tiles(changes, now):
    """Only a live alert, and the latest word on it."""
    words = {}
    for e in changes:
        if e.get("category") == "weather":
            words[(e.get("detail") or e["headline"])[:60]] = e
    out = []
    for e in words.values():
        if "ended" in e["headline"].lower() or (now - _ts(e["ts"])).total_seconds() > 36 * 3600:
            continue
        out.append({"id": "weather-" + _slug(e["headline"], e["ts"][:10]), "kind": "weather", "ts": e["ts"],
                    "title": re.sub(r"\s+issued$", "", e["headline"]), "url": e.get("url")})
    return out


def news_tiles(changes, today):
    """Burlington's stories, newest first. No crime story, whatever it names; two outlets
    on one story keep the first."""
    cutoff = today - dt.timedelta(days=NEWS_DAYS)
    out, kept = [], []
    for e in sorted((x for x in changes if x.get("category") == "news"), key=lambda x: x["ts"]):
        title, ts = e["headline"], _ts(e["ts"])
        if ts.astimezone(BTV_TZ).date() < cutoff or not LOCAL.search(title) or NOT_NEWS.search(title):
            continue
        if held(title) or NEWS_CRIME.search(title) or not str(e.get("url") or "").startswith("http"):
            continue
        words = _food_words(title)
        if any(_same_story(words, had) for _, had in kept):
            continue
        kept.append((ts, words))
        out.append({"id": "news-" + _slug(title), "kind": "news", "ts": e["ts"], "title": title,
                    "src": e.get("sourceName"), "url": e["url"]})
    return out[-MAX_NEWS:]


def _caption_ok(post):
    """A caption is never printed, but one that names a person says the picture is of them."""
    return not held(post.get("c")) and not PHOTO_PROMO.search(post.get("c") or "")


def _post_time(post):
    return dt.datetime.fromtimestamp(post["ts"], dt.timezone.utc)


def _post_id(post):
    return (re.search(r"/(?:p|reel)/([\w-]+)", post.get("u") or "") or [None, _slug(post["h"], post["ts"])])[1]


def photo_tiles(instagram, now):
    fresh = now - dt.timedelta(days=PHOTO_DAYS)
    posts = sorted(instagram.get("posts") or [], key=lambda p: p.get("ts") or 0, reverse=True)
    out, per = [], {}
    for p in posts:
        if not p.get("i") or not p.get("u") or not p.get("ts") or _post_time(p) < fresh:
            continue
        if p.get("category") not in PHOTO_CATEGORIES or p.get("kind") not in PHOTO_KINDS or not _caption_ok(p):
            continue
        if per.get(p["h"], 0) >= PHOTO_PER_ACCOUNT:
            continue
        per[p["h"]] = per.get(p["h"], 0) + 1
        out.append({"id": "photo-" + _post_id(p), "kind": "photo", "ts": _post_time(p).isoformat(timespec="seconds"),
                    "title": "@" + p["h"], "pic": p["i"], "url": p["u"]})
    return out[:MAX_PHOTOS]


def _start(e):
    return dt.datetime.fromisoformat(e["start"]).astimezone(BTV_TZ)


def _event_ok(e, gone):
    """One night only and confirmed. An address for a venue may be someone's home, so it stays out."""
    tags = e.get("tags") or []
    return (e.get("status") == "active" and not e.get("recurring") and "series" not in tags and "ongoing" not in tags and
            not e.get("allDay") and e.get("id") not in gone and not held(e.get("title")) and
            not re.match(r"\d", str(e.get("venue") or "")) and not CAMPUS.search(str(e.get("venue") or "")))


def _event_rank(e):
    s = e.get("signals") or {}
    return (0 if s.get("staff_pick") else 1, -(s.get("meetup_going") or 0), 0 if s.get("image") else 1, e["start"])


def _venue(e):
    v = e.get("venue") or ""
    return None if held(v) else v or None


def _event_row(e):
    return [_start(e).isoformat(timespec="seconds"), re.sub(r"\s+", " ", e["title"].replace("\ufeff", "")).strip(), _venue(e), e.get("url")]


def tonight_tile(events, today, now, gone=frozenset()):
    """Tonight's best first, then tomorrow's for the hours after the last one has started."""
    tomorrow = today + dt.timedelta(days=1)
    pool = [e for e in events if _event_ok(e, gone) and _start(e) > now.astimezone(BTV_TZ)]
    late = [e for e in pool if _start(e).date() == today and _start(e).hour >= TONIGHT_HOUR]
    soon = [e for e in pool if _start(e).date() == tomorrow]
    rows = [_event_row(e) for e in sorted(late, key=_event_rank)[:TONIGHT_ROWS]]
    rows += [_event_row(e) for e in sorted(soon, key=_event_rank)[:TONIGHT_ROWS]]
    return {"id": "tonight-" + today.isoformat(), "kind": "tonight", "day": today.isoformat(), "rows": rows} if rows else None


def calendar_tiles(events, today, now, gone=frozenset()):
    """What landed on the calendar each day, one tile a day. A new source's whole backlog
    arrives at once, so the tile counts them and shows the best."""
    days = {}
    for e in events:
        seen = e.get("firstSeen")
        if not seen or not _event_ok(e, gone) or _start(e) <= now.astimezone(BTV_TZ):
            continue
        day = _ts(seen).astimezone(BTV_TZ).date()
        if (today - day).days < CALENDAR_DAYS:
            days.setdefault(day, []).append(e)
    out = []
    for day, list_ in days.items():
        top = sorted(sorted(list_, key=_event_rank)[:CALENDAR_ROWS], key=lambda e: e["start"])
        out.append({"id": f"calendar-{day}", "kind": "calendar", "ts": max(_ts(e["firstSeen"]) for e in list_).astimezone(dt.timezone.utc).isoformat(timespec="seconds"),
                    "n": len(list_), "rows": [_event_row(e) for e in top]})
    return out


def _hash(*parts):
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()


def street_place(things, today):
    """The day's place and its two decoys, from the same neighborhood. Only the checked
    places, at their checked points. Every place comes up once before any repeats."""
    places = [{**p, "coords": STREET_PLACES[p["id"]]} for p in things if p.get("id") in STREET_PLACES and not p.get("closed")]
    hoods = {}
    for p in places:
        hoods.setdefault(p.get("neighborhood"), []).append(p)

    def apart(a, b):
        return abs(a["coords"][0] - b["coords"][0]) + abs(a["coords"][1] - b["coords"][1]) > STREET_FAR

    def decoys(p):
        return [o for o in hoods[p.get("neighborhood")] if o is not p and apart(o, p)]

    pool = sorted((p for p in places if len(decoys(p)) >= 2), key=lambda p: _hash(p["id"]))
    if not pool:
        return None
    place = pool[today.toordinal() % len(pool)]
    others = sorted(decoys(place), key=lambda p: _hash(p["id"], today))[:2]
    return place, others


def _place_name(p):
    return re.sub(r"\s*\(.*?\)\s*$", "", p["name"]).strip()


def street_tile(things, today):
    found = street_place(things, today)
    if not found:
        return None
    place, others = found
    img = fetch(place["coords"][0], place["coords"][1], VIEW_PLACE)
    if not img:
        return None
    return {"id": f"street-{today}", "kind": "street", "day": today.isoformat(), "img": img,
            "answer": _place_name(place), "options": sorted(_place_name(p) for p in [place] + others)}


def move_rows(events, today, now, gone=frozenset()):
    """The week's movement: something a reader can go and do, not a game to watch or a
    student's class. A weekly class is fine here."""
    last = today + dt.timedelta(days=MOVE_DAYS)
    out = []
    for e in sorted(events, key=lambda x: x["start"]):
        kind, source = e.get("category"), e.get("source")
        if not (kind in MOVE_CATEGORIES or source == "meetup" or (kind in MOVE_ALSO and source != "uvm")):
            continue
        if e.get("status") != "active" or e.get("allDay") or e.get("id") in gone:
            continue
        when = _start(e)
        if when <= now.astimezone(BTV_TZ) or when.date() > last or set(e.get("tags") or []) & {"kids", "teens", "family"}:
            continue
        title, venue = e.get("title") or "", e.get("venue") or ""
        if not MOVING.search(title) or NOT_MOVING.search(title) or CAMPUS.search(venue) or held(title):
            continue
        numbered = re.match(r"\d", venue)  # a street number may be someone's home: no name and no picture
        where = None if numbered else _venue(e)
        row = {"at": when.isoformat(timespec="seconds"), "title": title, "where": where, "url": e.get("url")}
        if not numbered and e.get("lat") is not None and e.get("lng") is not None:
            img = fetch(e["lat"], e["lng"], VIEW_SITE)
            if img:
                row["img"] = img
        out.append(row)
    return out


def _season_has(season, day):
    """A league's season says 'Nov 2 to Dec 21, then Jan 4 to Feb 22, no games Nov 29'. A season
    with no such range says nothing about this week, so it answers no."""
    def on(mon, d):
        when = dt.date(day.year, MONTHS[mon.lower()], int(d))
        return when.replace(year=when.year + 1) if (day - when).days > 182 else when.replace(year=when.year - 1) if (when - day).days > 182 else when
    off = re.search(r"no \w+ ([A-Z][a-z]{2}) (\d{1,2})", season)
    if off and on(*off.groups()) == day:
        return False
    return any(on(m1, d1) <= day <= on(m2, d2) for m1, d1, m2, d2 in LEAGUE_RANGE.findall(season))


def league_rows(leagues, today, now):
    """League nights this week that are still taking signups. 'Fridays 7:30, 8:15 or 9pm' starts
    the night at 7:30 pm; a night with no clock or no dated season stays out."""
    out = []
    for org in leagues.get("organizers") or []:
        for x in org.get("sports") or []:
            night = re.match(r"((?:[A-Z][a-z]+days)(?: or [A-Z][a-z]+days)*) (\d{1,2})(?::(\d\d))?(?:\D[^;]*?)?(am|pm)", x.get("day") or "")
            if not night or x.get("signup_open") is not True or (x.get("signup_until") or "9") < today.isoformat():
                continue
            names, hour, minute, half = night.groups()
            hour = int(hour) % 12 + (12 if half == "pm" else 0)
            for add in range(MOVE_DAYS + 1):
                day = today + dt.timedelta(days=add)
                if day.strftime("%A") + "s" not in names or not _season_has(x.get("season") or "", day):
                    continue
                when = dt.datetime(day.year, day.month, day.day, hour, int(minute or 0), tzinfo=BTV_TZ)
                title = org["name"] if x["sport"] in org["name"] else f"{org['name']} {x['sport']}"
                at = when.isoformat(timespec="seconds")
                if when > now.astimezone(BTV_TZ) and not any(o["at"] == at and o["title"] == title for o in out):
                    out.append({"at": at, "title": title, "where": (x.get("where") or "").split(",")[0].split(";")[0] or None, "url": x.get("url")})
    return out


def club_aerials(clubs):
    """Each meet's place, by its point. A meet with no point goes without."""
    out = {}
    for club in clubs:
        for m in club.get("meets") or []:
            if m.get("lat") is not None and m.get("lng") is not None:
                img = fetch(m["lat"], m["lng"], VIEW_SITE)
                if img:
                    out[f"{m['lat']},{m['lng']}"] = img
    return out


def scene_posts(instagram, now, gone=frozenset()):
    fresh = now - dt.timedelta(days=PHOTO_DAYS)
    posts = sorted((p for p in instagram.get("posts") or [] if p.get("h") in SCENE_HANDLES and p.get("i") and p.get("u") and
                    p.get("ts") and _post_time(p) >= fresh and _caption_ok(p) and _post_id(p) not in gone), key=lambda p: p["ts"], reverse=True)
    return [{"id": _post_id(p), "h": p["h"], "pic": p["i"], "url": p["u"], "ts": p["ts"]} for p in posts[:SCENE_POSTS]]


def job_tiles(jobs, today):
    days = {}
    for j in jobs.get("jobs", []):
        days.setdefault(j.get("posted"), []).append(j)
    out = []
    for day in sorted((d for d in days if d), reverse=True)[:JOB_DAYS]:
        rows = {}
        for j in days[day]:
            rows.setdefault(re.split(r"\s+[—-]\s+", j.get("employer") or "Other")[0], []).append(j)
        top = sorted(rows.items(), key=lambda kv: -len(kv[1]))[:4]
        out.append({"id": "jobs-" + day, "kind": "jobs", "ts": _noon(day), "n": len(days[day]),
                    "rows": [[name, len(js)] for name, js in top], "url": "#work"})
    return out


def signup_tiles(signups, today):
    groups = {}
    for p in signups.get("programs", []):
        day = p.get("next_opens")
        if not day or p.get("date_basis") != "published":
            continue
        d = _date(day)
        if not today <= d <= today + dt.timedelta(days=SIGNUP_AHEAD):
            continue
        groups.setdefault((day, p.get("org")), []).append(p)
    out = []
    for (day, org), ps in sorted(groups.items(), key=lambda kv: kv[0][0])[:4]:
        first = re.sub(r"\s*\(.*?\)\s*$", "", re.sub(r"\s+Levels? .*$", "", ps[0].get("name") or ""))
        out.append({"id": "signup-" + _slug(day, org), "kind": "signup", "ts": now_iso(), "title": first, "day": day,
                    "n": len(ps), "org": org, "url": ps[0].get("page")})
    return out


def outages():
    """Customers out around Burlington, or 0 under the line. A feed that fails says 0: the
    hero's chip only ever shows a count someone reported."""
    try:
        n = sum(int(t.get("totalCustomers") or 0) for t in get_json(OUTAGES, timeout=20) if t.get("code") in OUTAGE_TOWNS)
    except (RuntimeError, ValueError, TypeError, AttributeError) as e:
        print(f"[feed] no outages: {type(e).__name__}")
        return 0
    return n if n >= OUTAGE_MIN else 0


def status(alerts, out=0):
    """ban is the city's headline while a ban stands, else None. schools counts the closings list."""
    sec = alerts.get("sections", {})
    parking = sec.get("parking_ban") or {}
    ban = (parking.get("items") or [None])[0] if parking.get("status") == "ban_announcement_posted" else None
    return {"ban": ban.get("headline") if ban else None,
            "ban_url": ban.get("source_url") if ban else None,
            "schools": len((sec.get("closings") or {}).get("items") or []),
            "outages": out}


def _seen_key(t, seen):
    """A day's jobs or a week's permits are news again only past the highest count seen."""
    if t["kind"] not in ("jobs", "week"):
        return t["id"]
    top = max((int(k.rsplit("#", 1)[1]) for k in seen if k.startswith(t["id"] + "#")), default=0)
    return f"{t['id']}#{max(t['n'], top)}"


def _unstamped(feed):
    return {k: v for k, v in feed.items() if k != "generated"}


def _write_changed(path, payload):
    """Rewrite a file only when something besides its stamp changed, as run_sections does."""
    if _unstamped(load_json(path, {}) or {}) == json.loads(json.dumps(_unstamped(payload))):
        print(f"[feed] no change to {os.path.basename(path)}; file left as is")
    else:
        write_json(path, payload)


def write_feed(payload):
    _write_changed(FEED_PATH, payload)


# a title from a source no other guard has read; a home's or a sale's comes through redact.py
GUARDED = {"road", "food", "reddit", "weather", "signup", "city", "news"}


def guard(tiles, gone):
    """The last look before anything is written: a takedown's id, and held() on every title."""
    return [t for t in tiles if t["id"].split("-", 1)[-1] not in gone and not (t["kind"] in GUARDED and held(t.get("title")))]


# ------------------------------------------------------------------- the feed
def build():
    now = dt.datetime.now(dt.timezone.utc)
    today = dt.date.fromisoformat(today_btv())
    cutoff = today - dt.timedelta(days=WINDOW_DAYS)

    streets = load_json(os.path.join(OUT_DIR, "streets.json"), {}) or {}
    alerts = load_json(os.path.join(OUT_DIR, "alerts.json"), {}) or {}
    signups = load_json(os.path.join(OUT_DIR, "signups.json"), {}) or {}
    jobs = load_json(os.path.join(ROOT, "data", "jobs.json"), {}) or {}
    changes = (load_json(os.path.join(ROOT, "data", "changes", "changes.json"), {}) or {}).get("events", [])

    # a missing source must not read as "nothing happened": keep the last good feed
    sections = streets.get("sections", {})
    if not (sections.get("sales") or {}).get("items") or not (sections.get("permits") or {}).get("items") or not changes or not jobs.get("jobs"):
        print("[feed] a source is missing or empty; keeping the last feed")
        last = load_json(FEED_PATH)
        if last:  # the ban and the closings still move
            write_feed({**last, "generated": now_iso(), "status": status(alerts, outages())})
        return

    events = (load_json(EVENTS_PATH, {}) or {}).get("events") or []
    instagram = load_json(INSTAGRAM_PATH, {}) or {}
    gone = hidden()

    geo = Geo()
    tiles = (sold_tiles(streets, cutoff) + going_tiles(streets, cutoff) + week_tiles(streets, cutoff) +
             city_tiles(changes, today, cutoff) + road_tiles(changes, streets, geo, cutoff) +
             food_tiles(changes, cutoff) + reddit_tiles(changes, cutoff, load_intake()) + weather_tiles(changes, now) +
             job_tiles(jobs, today) + signup_tiles(signups, today) + news_tiles(changes, today) +
             photo_tiles(instagram, now) + calendar_tiles(events, today, now, gone))
    tiles = guard(tiles, gone)
    geo.save()

    had_ledger = os.path.exists(SEEN_PATH)
    seen = load_json(SEEN_PATH, {}) or {}
    stamp = now.isoformat(timespec="seconds")
    for t in tiles:
        if t["kind"] not in BATCH:  # the rest already carry the moment they happened
            continue
        key = _seen_key(t, seen)
        if key not in seen:
            seen[key] = t["ts"] if not had_ledger else stamp
        t["ts"] = seen[key]
    # age out by date, not by what happens to be in this run
    oldest = (now - dt.timedelta(days=WINDOW_DAYS * 2)).isoformat()
    write_json(SEEN_PATH, {k: v for k, v in seen.items() if _ts(v).isoformat() >= oldest})

    tiles.sort(key=lambda t: _ts(t["ts"]), reverse=True)
    tiles = tiles[:MAX_TILES]
    # the photo is stored with the site; the tile keeps its file name, not the point
    for t in tiles:
        lat, lon, m = t.pop("lat", None), t.pop("lon", None), t.pop("m", None)
        if lat is not None and lon is not None:
            name = fetch(lat, lon, m or VIEW_SITE)
            if name:
                t["img"] = name
    street = street_tile(load_json(THINGS_PATH, []) or [], today)
    rows = move_rows(events, today, now, gone) + league_rows(load_json(LEAGUES_PATH, {}) or {}, today, now)
    moves = {"generated": now_iso(), "events": sorted(rows, key=lambda r: r["at"]),
             "aerials": club_aerials((load_json(CLUBS_PATH, {}) or {}).get("clubs") or []), "scene": scene_posts(instagram, now, gone)}
    keep = {t["img"] for t in tiles if t.get("img")}
    keep |= {street["img"]} if street else set()
    keep |= {r["img"] for r in moves["events"] if r.get("img")} | set(moves["aerials"].values())
    section = streets.get("sections", {})
    for rows in ((section.get("sales") or {}).get("items", []), (section.get("permits") or {}).get("items", [])):
        keep |= {r["img"] for r in rows if r.get("img")}
    medians = (streets.get("sections", {}).get("sales") or {}).get("medians") or {}
    write_feed({"generated": now_iso(), "status": status(alerts, outages()),
                "median": (medians.get("90d") or {}).get("all_residential"),
                "tonight": tonight_tile(events, today, now, gone), "street": street, "tiles": tiles})
    _write_changed(MOVES_PATH, moves)
    prune(keep)  # after the write: a stop between the two leaves spare files, never a broken photo
    print(f"[feed] {len(tiles)} tiles, {geo.asked} places looked up")


if __name__ == "__main__":
    build()
