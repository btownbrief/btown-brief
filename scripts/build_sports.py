#!/usr/bin/env python3
"""Build all-day/data/sports.json — the Sports tab's payload.

LOCAL comes from each organisation's own feed. NATIONAL comes from ESPN.
Everything here is keyless.

WHY THESE ENDPOINTS AND NOT THE OBVIOUS ONES — each was tested, and the
obvious choice was wrong more than once:

  * UVM: the iCalendar feed, NOT the JSON services. uvmathletics.com/robots.txt
    disallows /services/ and /*print=true*, which rules out
    responsive-calendar.ashx, sportnames.ashx, schedule_txt.ashx and the print
    pages — the richest endpoints on the site. calendar.ashx/calendar.ics sits
    outside every Disallow rule, needs no key, carries RESULTS, TV, streams and
    ticket links, and declares its own two-hour TTL. It is the only UVM path
    that is both complete and allowed.
  * America East's identical ICS is merged on top for basketball, because
    UVM's own feed is missing non-conference games the conference feed has.
    Entries are duplicated once per school's perspective, so it is deduped.
  * Lake Monsters: the Futures League PrestoSports RSS, which carries
    <ps:score> and <ps:opponent> in the http://www.prestosports.com/rss/schedule
    namespace. The .ics/.json variants all 404.
  * Burlington High School: the district publishes 37 PUBLIC Google Calendars
    and burlingtonathletics.com/wp-json/calids/v2 lists their ids. Two id
    formats appear — a bare calendar address, and a base64url cid inside a
    calendar.google.com URL — and both must be handled or you silently get 2
    of 37. Practices and tryouts share these calendars with games, so games
    are filtered for. There are NO SCORES here, by construction.
  * National: ESPN's site.api. It is undocumented and Disney's terms restrict
    automated use, so this stays small: five teams, cached, linked back.

THE ESPN USER-AGENT TRAP, which cost real time to find: ESPN's edge serves 200
to a default curl/python user-agent and 403s a *custom* one from a datacenter
IP. Setting a polite "btownbrief/1.0" UA is what breaks it. So this sends no
User-Agent to ESPN, and its own UA everywhere else.

Run: python3 scripts/build_sports.py
"""

from __future__ import annotations

import base64
import datetime as dt
import json
import pathlib
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
TEAMS = ROOT / "data" / "sports-teams.json"
OUT = ROOT / "all-day" / "data" / "sports.json"

UA = {"User-Agent": "btown-brief/1.0 (+https://btownbrief.com)"}

# Every feed here publishes in UTC, and a 7pm Burlington puck drop is 23:00 or
# 01:00 UTC depending on the month. Taking .date() off the UTC timestamp filed
# 83 of 340 games — every evening game — one day late. The day a game belongs
# to is the day it is in Burlington.
NY = ZoneInfo("America/New_York")


def local_date(start) -> str:
    if isinstance(start, dt.datetime) and start.tzinfo is not None:
        return start.astimezone(NY).date().isoformat()
    if isinstance(start, dt.datetime):
        return start.date().isoformat()
    return start.isoformat()
BACK_DAYS = 14          # finished games worth still showing
# 200 days, not 120: at 120 the window ended in December and UVM basketball —
# which tips off in November and runs through February — was entirely absent
# from a tab that lists it as a sport. A season has to fit inside the window.
FWD_DAYS = 200

UVM_ICS = "https://uvmathletics.com/calendar.ashx/calendar.ics?sport_id={sid}"
AE_ICS = "https://americaeast.com/calendar.ashx/calendar.ics?sport_id=0"
LM_RSS = ("https://thefuturesleague.com/sports/bsb/{year}/schedule"
          "?teamId=dol7ec9h5ajz5i3t&print=rss")
HS_IDS = "https://burlingtonathletics.com/wp-json/calids/v2"
HS_ICS = "https://calendar.google.com/calendar/ical/{cal}/public/basic.ics"
ESPN = "https://site.api.espn.com/apis/site/v2/sports/{path}/teams/{team}/schedule"

PS_NS = {"ps": "http://www.prestosports.com/rss/schedule"}


def log(m: str) -> None:
    print(m, file=sys.stderr, flush=True)


def get(url: str, timeout: int = 30, espn: bool = False) -> str | None:
    """espn=True sends NO User-Agent — a custom one gets 403'd at their edge."""
    try:
        req = urllib.request.Request(url, headers={} if espn else UA)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    except Exception as e:
        log(f"    fetch failed {url[:70]}: {str(e)[:60]}")
        return None


# ------------------------------------------------------------------ icalendar

def ics_unfold(text: str) -> list[str]:
    out: list[str] = []
    for raw in text.splitlines():
        if raw[:1] in (" ", "\t") and out:
            out[-1] += raw[1:]
        else:
            out.append(raw)
    return out


def ics_dt(value: str, params: dict) -> dt.datetime | dt.date | None:
    v = value.strip()
    try:
        if v.endswith("Z"):
            return dt.datetime.strptime(v, "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)
        if "T" in v:
            return dt.datetime.strptime(v, "%Y%m%dT%H%M%S")
        if params.get("VALUE") == "DATE" or len(v) == 8:
            return dt.datetime.strptime(v, "%Y%m%d").date()
    except ValueError:
        return None
    return None


def parse_ics(text: str) -> list[dict]:
    out, cur = [], None
    for line in ics_unfold(text):
        if line.startswith("BEGIN:VEVENT"):
            cur = {}
            continue
        if cur is None:
            continue
        if line.startswith("END:VEVENT"):
            out.append(cur)
            cur = None
            continue
        if ":" not in line:
            continue
        key, val = line.split(":", 1)
        name, *plist = key.split(";")
        params = dict(p.split("=", 1) for p in plist if "=" in p)
        name = name.upper()
        if name == "DTSTART":
            cur["start"] = ics_dt(val, params)
        elif name in ("SUMMARY", "LOCATION", "DESCRIPTION", "URL", "UID"):
            cur[name.lower()] = (val.replace("\\n", "\n").replace("\\,", ",")
                                    .replace("\\;", ";").strip())
    return out


# ----------------------------------------------------------------------- UVM
# sport_id -> label. Read once from services/sportnames.ashx (which robots.txt
# disallows crawling, so the ids are pinned here rather than fetched each run).
UVM_SPORTS = {
    3:  "Men's Basketball",
    10: "Women's Basketball",
    5:  "Men's Hockey",
    12: "Women's Hockey",
    8:  "Men's Soccer",
    15: "Women's Soccer",
    1:  "Field Hockey",
}

_RESULT_RE = re.compile(r"^\s*\[([WLT])\]\s*")
_SCORE_RE = re.compile(r"\b([WLT])\s+(\d+)\s*-\s*(\d+)")
_UVM_RE = re.compile(r"(?i)\bUniversity of Vermont\b\s*")
# America East writes "Women's Soccer Vermont at Stonehill" where UVM's own
# feed says "Women's Soccer at Stonehill" — same game, two feeds. Normalising
# this is what lets the dedup see them as one.
_VT_RE = re.compile(r"(?i)\bVermont\b\s*")
# Burlington's calendars put status in front of the title.
_STATUS_RE = re.compile(r"(?i)^\s*(cancell?ed|postponed|rescheduled(?:\s+to\s+\S+)?)\b[:\s-]*")


def uvm_games() -> list[dict]:
    games = []
    for sid, label in UVM_SPORTS.items():
        text = get(UVM_ICS.format(sid=sid))
        if not text:
            continue
        rows = parse_ics(text)
        for r in rows:
            g = ics_to_game(r, org="UVM", sport=label, level="college")
            if g:
                games.append(g)
        log(f"    UVM {label}: {len(rows)}")
    return games


def ics_to_game(r: dict, org: str, sport: str, level: str) -> dict | None:
    start = r.get("start")
    summary = (r.get("summary") or "").strip()
    if not start or not summary:
        return None

    result = None
    m = _RESULT_RE.match(summary)
    if m:
        result = m.group(1)
        summary = _RESULT_RE.sub("", summary)
    summary = _UVM_RE.sub("", summary).strip()

    status = None
    sm2 = _STATUS_RE.match(summary)
    if sm2:
        status = sm2.group(1).split()[0].lower().replace("cancelled", "canceled")
        summary = _STATUS_RE.sub("", summary).strip()
    summary = " ".join(summary.split())

    desc = r.get("description") or ""
    score = None
    sm = _SCORE_RE.search(desc)
    if sm:
        result = result or sm.group(1)
        score = f"{sm.group(2)}-{sm.group(3)}"

    home = None
    if re.search(r"(?i)\bat\b\s", summary) and " vs " not in summary.lower():
        home = False
    elif " vs" in summary.lower():
        home = True

    g = {
        "org": org, "sport": sport, "level": level,
        "title": summary,
        "start": start.isoformat(),
        "date": local_date(start),
        "allDay": not isinstance(start, dt.datetime),
    }
    if r.get("location"):
        g["venue"] = r["location"]
    if r.get("url"):
        g["url"] = r["url"]
    if result:
        g["result"] = result
    if score:
        g["score"] = score
    if home is not None:
        g["home"] = home
    if status:
        g["status"] = status
    for label, key in (("TV:", "tv"), ("Streaming Video:", "watch"), ("Tickets:", "tickets")):
        mm = re.search(re.escape(label) + r"\s*(\S+)", desc)
        if mm:
            g[key] = mm.group(1).strip()
    return g


def america_east_fill(existing: list[dict]) -> list[dict]:
    """UVM's own feed publishes fewer basketball games than the conference's —
    women's especially. Merge the conference feed's Vermont games in, keeping
    UVM's row when both have the same date and sport."""
    text = get(AE_ICS, timeout=45)
    if not text:
        return []
    have = {(g["date"], g["sport"]) for g in existing}
    added = []
    for r in parse_ics(text):
        s = (r.get("summary") or "")
        if "vermont" not in s.lower():
            continue
        # The conference feed carries EVERY America East sport, not just
        # basketball. Matching on "men"/"women" alone imported Vermont's soccer
        # games as basketball — and because the conference spells the title
        # differently ("Women's Soccer Vermont at Stonehill"), the mislabelled
        # row then beat UVM's own correct row in the dedup. Only take a game
        # this feed actually calls basketball.
        if not re.search(r"(?i)\bbasketball\b", s):
            continue
        sport = ("Women's Basketball" if re.search(r"(?i)\bwomen", s)
                 else "Men's Basketball" if re.search(r"(?i)\bmen", s) else None)
        if not sport:
            continue
        g = ics_to_game(r, org="UVM", sport=sport, level="college")
        if g and (g["date"], g["sport"]) not in have:
            have.add((g["date"], g["sport"]))
            g["via"] = "America East"
            added.append(g)
    log(f"    America East filled {len(added)} basketball games UVM's feed lacked")
    return added


# -------------------------------------------------------------- Lake Monsters

_LM_SCORE = re.compile(r"([WL]),\s*(\d+)-(\d+)")


def lake_monsters(year: int) -> list[dict]:
    text = get(LM_RSS.format(year=year), timeout=45)
    if not text:
        return []
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        log(f"    lake monsters feed did not parse: {e}")
        return []
    out = []
    for item in root.findall(".//item"):
        title = (item.findtext("title") or "").strip()
        date_s = item.findtext("{http://purl.org/dc/elements/1.1/}date") or ""
        if not title or not date_s:
            continue
        try:
            start = dt.datetime.fromisoformat(date_s.replace("Z", "+00:00"))
        except ValueError:
            continue
        opp_el = item.find("ps:opponent", PS_NS)
        sc_el = item.find("ps:score", PS_NS)
        opp = (opp_el.text or "").strip() if opp_el is not None else ""
        g = {
            "org": "Lake Monsters", "sport": "Baseball", "level": "pro",
            "title": ("Lake Monsters " + opp) if opp else title,
            "start": start.isoformat(),
            "date": local_date(start),
            "allDay": False,
            "url": (item.findtext("link") or "").strip() or None,
            "venue": "Centennial Field" if opp.lower().startswith("vs") else None,
            "home": opp.lower().startswith("vs") if opp else None,
        }
        if sc_el is not None and sc_el.text:
            m = _LM_SCORE.search(sc_el.text)
            if m:
                g["result"] = m.group(1)
                g["score"] = f"{m.group(2)}-{m.group(3)}"
        out.append({k: v for k, v in g.items() if v is not None})
    log(f"    Lake Monsters {year}: {len(out)}")
    return out


# ------------------------------------------------------------- Burlington HS
# The district's own calendars. fall-sports / winter-sports / spring-sports are
# the HIGH SCHOOL teams; the "-2" variants are Hunt and Edmunds middle schools,
# which is the whole filter.
HS_WANT = re.compile(r"/team/(fall|winter|spring)-sports/([a-z0-9-]+)/?$")
HS_SPORTS = {
    "football": "Football", "boys-soccer": "Boys Soccer", "girls-soccer": "Girls Soccer",
    "boys-basketball": "Boys Basketball", "girls-basketball": "Girls Basketball",
    "baseball": "Baseball", "softball": "Softball",
    "boys-hockey": "Boys Hockey", "girls-hockey": "Girls Hockey",
    "field-hockey": "Field Hockey",
}
# A game names an opponent. Practices, tryouts and team meetings do not.
_HS_GAME = re.compile(r"(?i)\b(vs\.?|@|at)\b")
_HS_SKIP = re.compile(r"(?i)\b(practice|tryout|try-out|meeting|picture|banquet|"
                      r"scrimmage|camp|conditioning|open gym|no school)\b")


def hs_calendar_ids() -> list[tuple[str, str]]:
    raw = get(HS_IDS)
    if not raw:
        return []
    try:
        rows = json.loads(raw)
    except json.JSONDecodeError:
        return []
    out = []
    for e in rows if isinstance(rows, list) else []:
        link = (e.get("permalink") or "")
        m = HS_WANT.search(link)
        if not m or m.group(2) not in HS_SPORTS:
            continue
        ident = (e.get("id") or "").strip()
        cal = None
        if "@" in ident and not ident.startswith("http"):
            cal = ident
        else:
            q = urllib.parse.parse_qs(urllib.parse.urlparse(ident).query)
            cid = (q.get("cid") or [""])[0]
            if cid:
                # base64url with the padding stripped
                fixed = cid.replace("-", "+").replace("_", "/")
                try:
                    cal = base64.b64decode(fixed + "=" * (-len(fixed) % 4)).decode("utf-8", "ignore")
                except Exception:
                    cal = None
        if cal and "@" in cal:
            out.append((HS_SPORTS[m.group(2)], cal))
    return out


def burlington_hs() -> list[dict]:
    ids = hs_calendar_ids()
    if not ids:
        log("    no Burlington HS calendars resolved")
        return []
    out = []
    for sport, cal in ids:
        text = get(HS_ICS.format(cal=urllib.parse.quote(cal, safe="")), timeout=45)
        if not text:
            continue
        kept = 0
        for r in parse_ics(text):
            s = (r.get("summary") or "")
            if _HS_SKIP.search(s) or not _HS_GAME.search(s):
                continue
            g = ics_to_game(r, org="Burlington High", sport=sport, level="high school")
            if g:
                g.pop("result", None)   # these calendars carry no scores
                g.pop("score", None)
                out.append(g)
                kept += 1
        log(f"    BHS {sport}: {kept}")
    return out


# ------------------------------------------------------------------ national
# New England, plus Montreal — Burlington is 90 minutes from the Canadian
# border and closer to the Bell Centre than to Fenway.
NATIONAL = [
    ("baseball/mlb",    "bos", "Red Sox",   "Baseball"),
    ("hockey/nhl",      "bos", "Bruins",    "Hockey"),
    ("hockey/nhl",      "mtl", "Canadiens", "Hockey"),
    ("basketball/nba",  "bos", "Celtics",   "Basketball"),
    ("football/nfl",    "ne",  "Patriots",  "Football"),
]


def espn_team(path: str, team: str, name: str, sport: str, season: int | None) -> list[dict]:
    url = ESPN.format(path=path, team=team)
    if season:
        url += f"?season={season}&seasontype=2"
    raw = get(url, timeout=45, espn=True)
    if not raw:
        return []
    try:
        doc = json.loads(raw)
    except json.JSONDecodeError:
        return []
    out = []
    for e in doc.get("events") or []:
        comp = (e.get("competitions") or [{}])[0]
        date_s = e.get("date") or ""
        try:
            start = dt.datetime.fromisoformat(date_s.replace("Z", "+00:00"))
        except ValueError:
            continue
        us = them = None
        home = None
        for c in comp.get("competitors") or []:
            t = (c.get("team") or {})
            abbr = (t.get("abbreviation") or "").lower()
            sc = c.get("score")
            if isinstance(sc, dict):
                sc = sc.get("displayValue")
            side = {"name": t.get("shortDisplayName") or t.get("displayName"), "score": sc}
            if abbr == team:
                us = side
                home = (c.get("homeAway") == "home")
            else:
                them = side
        if not them:
            continue
        st = ((comp.get("status") or {}).get("type") or {})
        g = {
            "org": name, "sport": sport, "level": "national",
            "title": f"{name} {'vs' if home else 'at'} {them['name']}",
            "start": start.isoformat(),
            "date": local_date(start),
            "allDay": False,
            "home": home,
            "state": st.get("state"),          # pre | in | post
        }
        venue = ((comp.get("venue") or {}).get("fullName"))
        if venue:
            g["venue"] = venue
        if st.get("state") == "post" and us and us.get("score") is not None:
            try:
                a, b = int(us["score"]), int(them["score"])
                g["score"] = f"{a}-{b}"
                g["result"] = "W" if a > b else ("L" if a < b else "T")
            except (TypeError, ValueError):
                pass
        elif st.get("state") == "in":
            g["live"] = st.get("shortDetail") or "Live"
        for b in comp.get("broadcasts") or []:
            names = b.get("names") or []
            if names:
                g["tv"] = names[0]
                break
        links = e.get("links") or []
        if links and links[0].get("href"):
            g["url"] = links[0]["href"]
        out.append(g)
    return out


def national_games(today: dt.date) -> list[dict]:
    """NFL and NBA return preseason only without an explicit season; MLB and
    NHL are fine bare. Season year is the year the season ENDS for winter
    sports, which is why they differ."""
    seasons = {
        "football/nfl": today.year if today.month >= 3 else today.year - 1,
        "basketball/nba": today.year + 1 if today.month >= 8 else today.year,
    }
    out = []
    for path, team, name, sport in NATIONAL:
        got = espn_team(path, team, name, sport, seasons.get(path))
        log(f"    {name}: {len(got)}")
        out.extend(got)
    return out


# ---------------------------------------------------------------------- main

def in_window(g: dict, lo: dt.date, hi: dt.date) -> bool:
    try:
        d = dt.date.fromisoformat(g["date"])
    except (KeyError, ValueError):
        return False
    return lo <= d <= hi


def main() -> int:
    today = dt.date.today()
    lo, hi = today - dt.timedelta(days=BACK_DAYS), today + dt.timedelta(days=FWD_DAYS)

    log("local:")
    local = uvm_games()
    local += america_east_fill(local)
    local += lake_monsters(today.year)
    local += burlington_hs()

    log("national:")
    national = national_games(today)

    # Teams with no feed at all live in a hand-kept file — Vermont Green FC's
    # schedule is a typed WordPress table, and the Burlington Revolution has
    # published no games at all yet.
    curated, dormant = [], []
    if TEAMS.exists():
        doc = json.loads(TEAMS.read_text(encoding="utf-8"))
        for t in doc.get("teams") or []:
            # A team with no games is not the same as a team that does not
            # exist. Green FC's season ended in August; the Revolution has not
            # played a game yet. The tab says which rather than dropping them.
            if not (t.get("games") or []):
                dormant.append({k: t.get(k) for k in ("name", "sport", "url", "note") if t.get(k)})
            for g in t.get("games") or []:
                g = dict(g)
                g.setdefault("org", t.get("name"))
                g.setdefault("sport", t.get("sport"))
                g.setdefault("level", t.get("level", "local"))
                g.setdefault("allDay", False)
                curated.append(g)
        log(f"curated: {len(curated)} game(s) from {TEAMS.name}")

    games = [g for g in (local + curated + national) if in_window(g, lo, hi)]
    # one org can appear in two feeds; date+title is enough to collapse them
    # A duplicate is the SAME game arriving from two feeds — UVM's own and the
    # conference's. It is not two games on one day: a high school plays JV and
    # Varsity the same evening, and those are genuinely different fixtures, so
    # the key keeps whatever distinguishes them.
    def dkey(g: dict) -> tuple:
        t = (g.get("title") or "").lower()
        t = _VT_RE.sub(" ", t)
        t = re.sub(r"[^a-z0-9 ]+", " ", t)
        return (g["date"], (g.get("org") or "").lower(), " ".join(t.split()))

    # When one game arrives from two feeds, the organisation's OWN feed wins:
    # it labels its sports correctly and carries the richer description.
    seen, deduped = set(), []
    for g in sorted(games, key=lambda x: (x["start"], 1 if x.get("via") else 0,
                                          x.get("title", ""))):
        k = dkey(g)
        if k in seen:
            continue
        seen.add(k)
        deduped.append(g)

    if not deduped:
        log("no games in the window — refusing to write an empty payload")
        return 1

    orgs = {}
    for g in deduped:
        orgs.setdefault(g["level"], {}).setdefault(g["org"], 0)
        orgs[g["level"]][g["org"]] += 1

    doc = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "window": {"from": lo.isoformat(), "to": hi.isoformat()},
        "orgs": orgs,
        "dormant": dormant,
        "games": deduped,
        # Said out loud in the tab, because a schedule that has not been
        # released yet is not the same thing as a team with no games.
        "notes": [n for n in [
            "Burlington High School calendars carry no scores.",
            "National games and scores from ESPN.",
        ]],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n")
    n_res = sum(1 for g in deduped if g.get("result"))
    log(f"\nwrote {OUT.relative_to(ROOT)}  {len(deduped)} games · {n_res} with a result · "
        f"{OUT.stat().st_size // 1024} KB")
    for lvl, o in orgs.items():
        log(f"  {lvl}: " + ", ".join(f"{k} {v}" for k, v in sorted(o.items())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
