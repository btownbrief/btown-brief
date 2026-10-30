"""Town's live feed: everything that changed in Burlington, in one list.

Reads what the other Town scripts and the site's refresh jobs already write
and turns it into data/town/feed.json, the one file the app's Now tab reads:

  data/town/streets.json     permits, home sales, construction projects
  data/town/alerts.json      parking ban, school closings
  data/town/signups.json     registration openings
  data/changes/changes.json  agendas, road work, food news, weather, the
                             threads taking off on r/burlington
  data/jobs.json             new jobs, rolled up by day
  the Reddit intake          what the Reddit tab reads, for each thread's
                             nsfw, flair and removal marks

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
import json
import os
import re

from .title_guard import held, names_person
from .aerials import fetch, prune
from .common import BTV_TZ, OUT_DIR, ROOT, get_json, load_json, now_iso, today_btv, write_json
from .geo import Geo, street_of

FEED_PATH = os.path.join(OUT_DIR, "feed.json")
SEEN_PATH = os.path.join(OUT_DIR, "feed-seen.json")
REDDIT_INTAKE = "https://raw.githubusercontent.com/btownbrief/btown-brief/reddit-data/data/reddit-intake.json"

WINDOW_DAYS = 28        # how far back a tile can reach
MAX_TILES = 140
SIGNUP_AHEAD = 10       # days of registration openings to show
JOB_DAYS = 3            # days of job rollups
FOOD_SAME_DAYS = 3      # two outlets on one story land within this long of each other
FOOD_PLACES = {"burlington", "vermont", "downtown"}
FOOD_STOP = set("afte anno clos from open with year".split())  # after, announces, close, opening, years...

# view widths in Web Mercator metres (about 0.7 of a real metre at this latitude)
VIEW_HOME = 260         # a neighborhood, not one house
VIEW_SITE = 170         # a business or a building site
VIEW_ROAD = 300

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


def status(alerts):
    """ban is the city's headline while a ban stands, else None. schools counts the closings list."""
    sec = alerts.get("sections", {})
    parking = sec.get("parking_ban") or {}
    ban = (parking.get("items") or [None])[0] if parking.get("status") == "ban_announcement_posted" else None
    return {"ban": ban.get("headline") if ban else None,
            "ban_url": ban.get("source_url") if ban else None,
            "schools": len((sec.get("closings") or {}).get("items") or [])}


def _seen_key(t, seen):
    """A day's jobs or a week's permits are news again only past the highest count seen."""
    if t["kind"] not in ("jobs", "week"):
        return t["id"]
    top = max((int(k.rsplit("#", 1)[1]) for k in seen if k.startswith(t["id"] + "#")), default=0)
    return f"{t['id']}#{max(t['n'], top)}"


def _unstamped(feed):
    return {k: v for k, v in feed.items() if k != "generated"}


def write_feed(payload):
    """Rewrite feed.json only when something besides its stamp changed, as run_sections does."""
    if _unstamped(load_json(FEED_PATH, {}) or {}) == json.loads(json.dumps(_unstamped(payload))):
        print("[feed] no change; file left as is")
    else:
        write_json(FEED_PATH, payload)


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
            write_feed({**last, "generated": now_iso(), "status": status(alerts)})
        return

    geo = Geo()
    tiles = (sold_tiles(streets, cutoff) + going_tiles(streets, cutoff) + week_tiles(streets, cutoff) +
             city_tiles(changes, today, cutoff) + road_tiles(changes, streets, geo, cutoff) +
             food_tiles(changes, cutoff) + reddit_tiles(changes, cutoff, load_intake()) + weather_tiles(changes, now) +
             job_tiles(jobs, today) + signup_tiles(signups, today))
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
    keep = {t["img"] for t in tiles if t.get("img")}
    section = streets.get("sections", {})
    for rows in ((section.get("sales") or {}).get("items", []), (section.get("permits") or {}).get("items", [])):
        keep |= {r["img"] for r in rows if r.get("img")}
    medians = (streets.get("sections", {}).get("sales") or {}).get("medians") or {}
    write_feed({"generated": now_iso(), "status": status(alerts),
                "median": (medians.get("90d") or {}).get("all_residential"), "tiles": tiles})
    prune(keep)  # after the write: a stop between the two leaves spare files, never a broken photo
    print(f"[feed] {len(tiles)} tiles, {geo.asked} places looked up")


if __name__ == "__main__":
    build()
