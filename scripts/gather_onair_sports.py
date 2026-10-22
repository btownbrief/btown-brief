#!/usr/bin/env python3
"""On Air: Sports. The NBA first, then the NFL, then basketball around here.

Stephen, 2026-10-22: "I love the NBA ... the only stuff that matters is like
the clips and like the highlights ... easily link the highlights to upcoming
games ... I don't really care about the other ones." And: "the Vermont
Coyotes games and the UVM basketball games, both men's and women's ... link
like different basketball leagues in general that people can join."

What this writes, all-day/data/onair-sports.json:
  leagues.nba / leagues.nfl:
    games   ESPN's scoreboard for the days around today: [{id, start, day,
            state (pre|in|post), detail, away/home {name, nick, abbr, color,
            score, win}, tv, url, week?, hl (a clip id)}]
    clips   the league's own YouTube channel, full-game highlights and the
            nightly recap / week's top plays only: [{id, t, kind (game|recap|
            top), ch, sec, dur, d, day, game?}], newest first
    reddit  r/nba or r/nfl, the day's top posts: [{id, t, url, out, flair,
            score, comments}], in Reddit's order
  local:
    uvm     UVM men's and women's basketball from data/sports.json (which
            scripts/build_sports.py refreshes from UVM's own calendar)
    teams   the ABA teams from data/hoops-local.json (hand-checked)
    pickup  Stephen's Wednesday pickup, with the next date when Meetup answers
    play    leagues and pickup from data/clubs.json (+ town and cost from
            data/groups.json) and data/hoops-local.json's extras

The X bullets and the headlines are NOT gathered here: On Air reads them from
the Wire's own wire-today.json (Grok's Sports recap, the sports lanes), so
there is one pipeline for them.

Sources and the evidence for each rule:
reference/drafts/new-nine-2026-10/research/sports-sources-2026-10-22.md in the
newsletter repo. In short:
  * YouTube: the channels' uploads playlists through playlistItems.list (1
    quota unit for 50; NFL two pages: it posts ~60 a day), then videos.list
    for length and embeddability, like gather_onair_news.py. No credentials:
    the free RSS (newest 15), and candidates wait in `pending`.
  * ESPN: site.api's scoreboard by month (dates=YYYYMM&limit=300), one or two
    calls a league. Undocumented and Disney's terms restrict automated use,
    so it stays small and every game links back to ESPN. No User-Agent, per
    build_sports.py ("a custom one gets 403'd at their edge").
  * Reddit: reddit_client.py (the shared door: User-Agent, rate limits,
    token) and reddit_intake.py's parsers. OAuth (top of the day, with
    scores) when REDDIT_CLIENT_ID/SECRET exist, else the public top RSS.
    Reddit ends RSS on 2026-11-13; without OAuth after that the block is
    empty and On Air leaves it out.

Every source fails on its own and the file keeps what it had. Exits 0. $0.

CLI: --out PATH, --dry-run, --selftest
"""

import argparse
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import gzip
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone

import gather_onair_finds as finds
import reddit_client
import reddit_intake as reddit

try:
    from zoneinfo import ZoneInfo
    NY = ZoneInfo("America/New_York")
except Exception:  # noqa: BLE001  no tz database: Eastern daylight time
    NY = timezone(timedelta(hours=-4))

ROOT = finds.ROOT
OUT = os.path.join(ROOT, "all-day", "data", "onair-sports.json")
SPORTS_JSON = os.path.join(ROOT, "data", "sports.json")
HOOPS_JSON = os.path.join(ROOT, "data", "hoops-local.json")
CLUBS_JSON = os.path.join(ROOT, "data", "clubs.json")
GROUPS_JSON = os.path.join(ROOT, "data", "groups.json")

FEED = "https://www.youtube.com/feeds/videos.xml?channel_id="
NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}
ESPN = "https://site.api.espn.com/apis/site/v2/sports/{path}/scoreboard?dates={ym}&limit=300"
MEETUP = "https://www.meetup.com/burlington-social-activites-group/events/"
S5_ARCHIVE = "https://www.nba.com/news/category/starting-5-daily-newsletter"
S5_URL = re.compile(r"^https://www\.nba\.com/news/[a-z0-9-]+$")
S5_KEEP = {"NBA", "ESPN", "ET", "KD", "MVP", "OT", "TV", "Q&A", "NBC", "WNBA", "LA", "OKC", "AD", "SGA", "CJ", "PJ", "RJ", "TJ", "JJ", "II", "III"}

KEEP_CLIPS = 10            # days a highlight stays
PENDING_DAYS = 2
SEEN_DAYS = 14
MAX_CLIPS = 60
MIN_SEC = 120              # a highlight is a few minutes, never a Short
REDDIT_N = 12
UVM_BACK, UVM_FWD = 21, 60

LEAGUES = {
    "nba": {
        "name": "NBA", "path": "basketball/nba", "channel": "UCWJ2lWNubArHWmf3FIHbfcQ", "pages": 1,
        "sub": "nba", "back": 3, "fwd": 7,
        "rules": [
            # KINGS at CLIPPERS | FULL GAME HIGHLIGHTS | October 21, 2026
            ("game", re.compile(r"^(?P<a>[A-Z0-9 .'’-]+?) (?:at|vs\.?) (?P<b>[A-Z0-9 .'’-]+?) \|\s*FULL GAME HIGHLIGHTS\b", re.I)),
            ("recap", re.compile(r"^NBA'?s Nightly Recap\b", re.I)),
            ("top", re.compile(r"^NBA'?s Top 10 Plays of the Night\b", re.I)),
        ],
    },
    "nfl": {
        "name": "NFL", "path": "football/nfl", "channel": "UCDVYQ4Zhbm3S2dlz7P1GBDg", "pages": 2,
        "sub": "nfl", "back": 8, "fwd": 7,
        "rules": [
            # Chicago Bears vs Atlanta Falcons Game Highlights | 2026 NFL Season Week 6
            ("game", re.compile(r"^(?P<a>[A-Za-z0-9 .'’-]+?) vs\.? (?P<b>[A-Za-z0-9 .'’-]+?) Game Highlights\b", re.I)),
            ("top", re.compile(r"^Top \d+ Plays of Week \d+\b", re.I)),
        ],
    },
}
MONTHS = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."]
NATIONAL_SKIP = re.compile(r"league pass", re.I)
REDDIT_SKIP = re.compile(r"^(?:\[?(?:game thread|daily discussion|free talk|index thread)\b)", re.I)
HEX = re.compile(r"^[0-9a-fA-F]{6}$")


def log(msg):
    print("onair-sports: " + msg, file=sys.stderr)


# ------------------------------------------------------------------- clocks

def et_day(ts):
    return datetime.fromtimestamp(ts, NY).date().isoformat()


def parse_ts(text):
    try:
        return int(datetime.fromisoformat(str(text).replace("Z", "+00:00")).timestamp())
    except ValueError:
        return 0


def ap_date(day):
    d = date.fromisoformat(day)
    return MONTHS[d.month - 1] + " " + str(d.day)


# -------------------------------------------------------------------- games

def team_of(c):
    t = c.get("team") or {}
    color = str(t.get("color") or "")
    return {
        "name": finds.clean(t.get("displayName"), 40),
        "nick": finds.clean(t.get("name") or t.get("shortDisplayName"), 30),
        "abbr": finds.clean(t.get("abbreviation"), 5),
        "color": color.lower() if HEX.match(color) else "",
        "score": str(c.get("score") or "") if str(c.get("score") or "").isdigit() else "",
        "win": bool(c.get("winner")),
    }


def parse_scoreboard(data):
    """ESPN scoreboard JSON -> games. A game missing either team is skipped."""
    out = []
    for e in (data or {}).get("events", []):
        try:
            comp = (e.get("competitions") or [{}])[0]
            sides = {c.get("homeAway"): c for c in comp.get("competitors", [])}
            if "home" not in sides or "away" not in sides:
                continue
            status = (e.get("status") or {}).get("type") or {}
            start = parse_ts(e.get("date"))
            if not start:
                continue
            tv = []
            for b in comp.get("broadcasts", []):
                if b.get("market") == "national":
                    tv += [n for n in b.get("names", []) if not NATIONAL_SKIP.search(n)]
            link = next((l.get("href") for l in e.get("links", []) if str(l.get("href", "")).startswith("https://www.espn.com/")), "")
            g = {"id": str(e.get("id") or ""), "start": start, "day": et_day(start),
                 "state": status.get("state") if status.get("state") in ("pre", "in", "post") else "pre",
                 "detail": finds.clean(status.get("shortDetail"), 40),
                 "away": team_of(sides["away"]), "home": team_of(sides["home"]),
                 "tv": tv[:2], "url": link, "neutral": bool(comp.get("neutralSite"))}
            week = (e.get("week") or {}).get("number")
            if isinstance(week, int):
                g["week"] = week
            if g["id"] and g["away"]["nick"] and g["home"]["nick"]:
                out.append(g)
        except (AttributeError, TypeError, IndexError):
            continue
    return out


def months_between(lo, hi):
    out, d = [], date(lo.year, lo.month, 1)
    while d <= hi:
        out.append(d.strftime("%Y%m"))
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return out


def espn_games(key, today):
    L = LEAGUES[key]
    lo, hi = today - timedelta(days=L["back"]), today + timedelta(days=L["fwd"])
    games = {}
    for ym in months_between(lo, hi):
        # no User-Agent header at all: see the docstring
        req = urllib.request.Request(ESPN.format(path=L["path"], ym=ym), headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=25) as r:
            raw = r.read()
        if raw[:2] == b"\x1f\x8b":     # ESPN gzips whether or not it was asked to
            raw = gzip.decompress(raw)
        for g in parse_scoreboard(json.loads(raw.decode("utf-8", "replace"))):
            games[g["id"]] = g
    keep = [g for g in games.values() if lo.isoformat() <= g["day"] <= hi.isoformat()]
    return sorted(keep, key=lambda g: (g["start"], g["id"]))


# -------------------------------------------------------------------- clips

def classify(key, title):
    """(kind, match) for a title the league rules want, else (None, None)."""
    if finds.SHORTS_RE.search(title):
        return None, None
    for kind, rule in LEAGUES[key]["rules"]:
        m = rule.search(title)
        if m:
            return kind, m
    return None, None


def norm(text):
    return re.sub(r"[^a-z0-9]+", " ", str(text).lower()).strip()


def clip_title(key, kind, m, day):
    if kind == "game":
        a, b = (" ".join(w.capitalize() if w.isupper() or w.islower() else w for w in m.group(x).split()) for x in ("a", "b"))
        a, b = a.replace("76Ers", "76ers"), b.replace("76Ers", "76ers")
        return a + (" at " if key == "nba" else " vs. ") + b
    if kind == "recap":
        return "Nightly recap · " + ap_date(day)
    if key == "nba":
        return "Top 10 plays · " + ap_date(day)
    return m.group(0).strip().rstrip("!").replace("Plays", "plays")


def game_for(clip, games):
    """The game a game-highlight clip is of: both nicknames in its title, and
    the latest such game that started before the clip went up (within 3
    days). Nicknames, so "TRAIL BLAZERS" and "Portland Trail Blazers" meet."""
    text = " " + norm(clip["raw"]) + " "
    best = None
    for g in games:
        if g["state"] == "pre" or g["start"] > clip["d"] or clip["d"] - g["start"] > 3 * 86400:
            continue
        if all(" " + norm(g[s]["nick"]) + " " in text for s in ("away", "home")):
            if not best or g["start"] > best["start"]:
                best = g
    return best


def parse_feed(xml_text):
    out = []
    for e in ET.fromstring(xml_text).findall("a:entry", NS):
        vid = (e.findtext("yt:videoId", namespaces=NS) or "").strip()
        title = finds.clean(e.findtext("a:title", namespaces=NS), 160)
        d = parse_ts(e.findtext("a:published", namespaces=NS))
        if finds.ID_RE.match(vid) and title and d:
            out.append({"id": vid, "title": title, "d": d})
    return out


def uploads(key, auth):
    """The channel's newest uploads: the API's uploads playlist with
    credentials, the free RSS feed without."""
    L = LEAGUES[key]
    if not auth or auth[0] is None:
        return parse_feed(finds.fetch(FEED + L["channel"], accept="application/atom+xml"))
    params, headers = auth
    out, token = [], None
    for _ in range(L["pages"]):
        q = dict(params, part="snippet,contentDetails", playlistId="UU" + L["channel"][2:], maxResults=50)
        if token:
            q["pageToken"] = token
        data = finds.fetch_json(finds.API + "/playlistItems?" + urllib.parse.urlencode(q), headers=headers)
        for it in data.get("items", []):
            sn, cd = it.get("snippet") or {}, it.get("contentDetails") or {}
            vid = cd.get("videoId") or (sn.get("resourceId") or {}).get("videoId") or ""
            d = parse_ts(cd.get("videoPublishedAt") or sn.get("publishedAt"))
            title = finds.clean(sn.get("title"), 160)
            if finds.ID_RE.match(vid) and title and d:
                out.append({"id": vid, "title": title, "d": d})
        token = data.get("nextPageToken")
        if not token:
            break
    return out


def gate(key, cand, detail):
    """(clip, None) to keep, (None, reason) to forget, (None, None) to wait."""
    if not detail:
        return None, "gone"
    if not detail["ok"]:
        return None, "not embeddable"
    if detail["live"] or not detail["sec"]:
        return None, None
    if detail["kids"]:
        return None, "for kids"
    if detail["sec"] < MIN_SEC:
        return None, "too short"
    title = detail["t"] or cand["title"]
    kind, m = classify(key, title)
    if not kind:
        return None, "not a highlight"
    day = et_day(cand["d"] - 4 * 3600)    # after midnight is still last night
    return {"id": cand["id"], "raw": title, "t": clip_title(key, kind, m, day), "kind": kind,
            "ch": detail["ch"] or LEAGUES[key]["name"], "sec": detail["sec"], "dur": finds.fmt_seconds(detail["sec"]),
            "d": cand["d"], "day": day}, None


def link_games(clips, games):
    by_id = {g["id"]: g for g in games}
    for c in clips:
        c.pop("game", None)
        if c["kind"] != "game":
            continue
        g = game_for(c, games)
        if g:
            c["game"] = g["id"]
            if "hl" not in by_id[g["id"]]:
                by_id[g["id"]]["hl"] = c["id"]
    return clips


# ------------------------------------------------------------------- reddit

def reddit_top(key, client):
    sub = LEAGUES[key]["sub"]
    route, data = client.read(f"r/{sub}/top", t="day", limit=30)
    if route != "rss":  # oauth, shreddit and mirror all hand back a listing dict
        posts, _ = reddit.parse_listing(data, "r/" + sub)
    else:
        posts = reddit.parse_atom(data, "r/" + sub)
    return shape_reddit(posts)


def shape_reddit(posts):
    out = []
    for p in posts:
        if p.get("nsfw") or p.get("stickied") or REDDIT_SKIP.search(p.get("title", "")):
            continue
        flair = p.get("flair")
        m = re.match(r"^\[([^\]]{2,24})\]\s*", p["title"])
        if not flair and m:
            flair = m.group(1)
        title = p["title"][m.end():] if m and finds.clean(flair, 24).lower() == m.group(1).lower() else p["title"]
        out.append({"id": p["id"], "t": finds.clean(title, 200), "url": p["url"], "out": p.get("out") or "",
                    "flair": finds.clean(flair, 24) if flair else "", "score": p.get("score"), "comments": p.get("comments")})
        if len(out) >= REDDIT_N:
            break
    return out


# ---------------------------------------------------------------- starting 5
# The NBA's own daily newsletter, Starting 5 (nba.com/starting5). Stephen is
# not subscribed, but every edition is posted on NBA.com the same morning:
# the archive page's __NEXT_DATA__ lists them, and an edition's five stories
# are its numbered <h3>s ("1. OPENING ACTS: ANT GOES OFF, ..."). On Air shows
# the edition's title and the five story titles, and links the edition.

def s5_case(text):
    """"OPENING ACTS: ANT GOES OFF" -> "Opening Acts: Ant Goes Off", keeping
    the initialisms a reader knows (KD, ESPN, ET)."""
    words = []
    for w in text.split():
        core = re.sub(r"[^A-Za-z&]", "", w)
        if core.upper() in S5_KEEP or (w.isupper() and re.fullmatch(r"\d+[A-Z]*", w)):
            words.append(w)
        elif w.isupper():
            words.append(re.sub(r"[A-Z][A-Z’']*", lambda m: m.group(0)[0] + m.group(0)[1:].lower(), w))
        else:
            words.append(w)
    return " ".join(words)


def s5_latest(archive_html):
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', archive_html, re.S)
    items = (((json.loads(m.group(1)).get("props") or {}).get("pageProps") or {}).get("category") or {}).get("latest", {}).get("items", []) if m else []
    for it in items:
        url = str(it.get("permalink") or "")
        if S5_URL.match(url) and str(it.get("title", "")).startswith("Starting 5"):
            return {"t": finds.clean(it["title"], 140), "url": url, "d": parse_ts(it.get("date")),
                    "x": finds.clean(it.get("excerpt"), 200)}
    return None


def s5_stories(article_html):
    out = []
    for h in re.findall(r"(?s)<h3[^>]*>(.*?)</h3>", article_html):
        text = finds.clean(h, 160)
        m = re.match(r"^([1-5])\.\s+(.+)$", text)
        if m and int(m.group(1)) == len(out) + 1:
            out.append(s5_case(m.group(2)))
    return out if len(out) >= 3 else []


def starting5(prev, report):
    page = finds.safe("starting5", lambda: finds.fetch(S5_ARCHIVE), report)
    ed = s5_latest(page) if page else None
    if not ed:
        return prev if prev and prev.get("d", 0) > finds.now_ts() - 3 * 86400 else None
    if prev and prev.get("url") == ed["url"] and prev.get("stories"):
        return prev
    art = finds.safe("starting5-edition", lambda: finds.fetch(ed["url"]), report)
    ed["stories"] = s5_stories(art) if art else []
    return ed


# -------------------------------------------------------------------- local

def load(path, default):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def uvm_games(sports, today):
    lo, hi = (today - timedelta(days=UVM_BACK)).isoformat(), (today + timedelta(days=UVM_FWD)).isoformat()
    out = []
    for g in (sports or {}).get("games", []):
        if not isinstance(g, dict) or g.get("org") != "UVM" or "Basketball" not in str(g.get("sport")):
            continue
        if not (lo <= str(g.get("date", "")) <= hi):
            continue
        title = re.sub(r"^(?:Men's|Women's) Basketball\s+", "", str(g.get("title", "")))
        out.append({k: v for k, v in {
            "side": "w" if g["sport"].startswith("Women") else "m",
            "t": finds.clean(title, 90), "start": parse_ts(g.get("start")) or None, "day": g["date"],
            "home": bool(g.get("home")), "url": html.unescape(str(g.get("url") or "")),
            "tv": finds.clean(g.get("tv"), 30), "watch": html.unescape(str(g.get("watch") or "")),
            "tickets": html.unescape(str(g.get("tickets") or "")),
            "score": finds.clean(g.get("score"), 12), "result": g.get("result") if g.get("result") in ("W", "L", "T") else "",
        }.items() if v not in ("", None)})
    return sorted(out, key=lambda x: (x["day"], x.get("start") or 0))


DAY_SHORT = {"Mondays": "Mon", "Tuesdays": "Tue", "Wednesdays": "Wed", "Thursdays": "Thu", "Fridays": "Fri", "Saturdays": "Sat", "Sundays": "Sun"}


def compact_when(text):
    """"Mondays 6:45pm · Mondays 7:15pm · Tuesdays 6:45pm · Tuesdays 7:15pm"
    -> "Mon, Tue 6:45pm & 7:15pm" when every day has the same times; a
    plain one or two stays as it is."""
    parts = [p.strip() for p in text.split("·") if p.strip()]
    if len(parts) <= 2:
        return finds.clean(text, 60)
    by_day = {}
    for p in parts:
        m = re.fullmatch(r"(\w+days) (\d{1,2}(?::\d{2})?[ap]m)", p)
        if not m or m.group(1) not in DAY_SHORT:
            return finds.clean(" · ".join(parts[:2]) + " and more", 60)
        by_day.setdefault(m.group(1), []).append(m.group(2))
    times = {tuple(v) for v in by_day.values()}
    if len(times) != 1:
        return finds.clean(" · ".join(parts[:2]) + " and more", 60)
    return ", ".join(DAY_SHORT[d] for d in by_day) + " " + " & ".join(next(iter(times)))


def play_list(clubs, groups, extra):
    """Leagues and pickup to join: every basketball entry in clubs.json, with
    the town and cost groups.json verified; the Btown Brief pickup is its own
    card, so it is left out here."""
    by_id = {g.get("id"): g for g in (groups or {}).get("groups", []) if isinstance(g, dict)}
    out = []
    for c in (clubs or {}).get("clubs", []):
        if not isinstance(c, dict) or c.get("kind") not in ("league", "pickup"):
            continue
        if not re.search(r"basketball|queerball", c.get("name", "") + " " + c.get("what", ""), re.I) or c.get("id", "").startswith("btown-brief"):
            continue
        g = by_id.get(c.get("id"), {})
        when = compact_when(re.sub(r"\s*\(.*$", "", str(c.get("when", ""))))
        out.append({k: v for k, v in {
            "id": c["id"], "name": finds.clean(c.get("name"), 70), "kind": c["kind"], "when": when,
            "where": finds.clean(g.get("town") or "", 30), "cost": finds.clean(g.get("cost") or "", 50),
            "url": str(c.get("url") or ""),
        }.items() if v})
    for e in extra or []:
        out.append({k: v for k, v in e.items() if k in ("id", "name", "when", "where", "cost", "url") and v})
    out.sort(key=lambda x: (x.get("kind") != "league", x["name"].lower()))
    return [x for x in out if str(x.get("url", "")).startswith("https://") or str(x.get("url", "")).startswith("http://")]


def next_pickup(page, now):
    """The next "Pick-up Basketball" on Stephen's Meetup events page, or None."""
    best = None
    for m in re.finditer(r'"title":"([^"]*[Bb]asketball[^"]*)"', page):
        seg = page[m.start():m.start() + 2000]
        when = re.search(r'"dateTime":"([^"]+)"', seg)
        url = re.search(r'"eventUrl":"(https://www\.meetup\.com/burlington-social-activites-group/events/[A-Za-z0-9]+/?)"', seg)
        ts = parse_ts(when.group(1)) if when else 0
        if ts and url and ts > now - 3 * 3600 and (not best or ts < best["start"]):
            best = {"start": ts, "url": url.group(1)}
    return best


def local_block(today, now, report, prev_local):
    hoops = load(HOOPS_JSON, {})
    teams = []
    for t in hoops.get("teams", []):
        games = [g for g in t.get("games", []) if isinstance(g, dict) and str(g.get("date", "")) >= today.isoformat()]
        teams.append({k: v for k, v in dict(t, games=games).items() if k in ("id", "name", "league", "where", "url", "watch", "note", "games") and v not in ("", None)})
    pickup = dict(hoops.get("pickup") or {})
    page = finds.safe("meetup", lambda: finds.fetch(MEETUP + "?cb=" + str(now), headers={"Cache-Control": "no-cache"}), report)
    nxt = next_pickup(page, now) if page else None
    if not nxt and prev_local:
        old = (prev_local.get("pickup") or {}).get("next")
        if old and old.get("start", 0) > now - 3 * 3600:
            nxt = old
    if nxt:
        pickup["next"] = nxt
    return {
        "uvm": uvm_games(load(SPORTS_JSON, {}), today),
        "teams": teams,
        "pickup": pickup,
        "play": play_list(load(CLUBS_JSON, {}), load(GROUPS_JSON, {}), hoops.get("play")),
        "checked": hoops.get("checked", ""),
    }


# ---------------------------------------------------------------------- run

def run(args, env=None):
    env = os.environ if env is None else env
    now = finds.now_ts()
    today = datetime.fromtimestamp(now, NY).date()
    prev = load(args.out, {})
    prev_leagues = prev.get("leagues") or {}
    seen = {k: v for k, v in (prev.get("seen") or {}).items() if now - int(v) < SEEN_DAYS * 86400}
    report = {}
    auth = finds.safe("youtube-auth", finds.youtube_auth, report)
    rc = reddit_client.Client(env=env, sleep=(lambda _s: None) if env.get("ONAIR_SPORTS_NO_SLEEP") else time.sleep)
    leagues, pending_all = {}, []
    for key in LEAGUES:
        old = prev_leagues.get(key) or {}
        games = finds.safe(key + "-espn", lambda: espn_games(key, today), report)
        if games is None:
            games = [g for g in old.get("games", []) if isinstance(g, dict) and g.get("day", "") >= (today - timedelta(days=LEAGUES[key]["back"])).isoformat()]
        clips = [c for c in old.get("clips", []) if isinstance(c, dict) and finds.ID_RE.match(str(c.get("id", "")))
                 and now - int(c.get("d", 0)) < KEEP_CLIPS * 86400 and c.get("raw")]
        known = {c["id"] for c in clips}
        cands = {c["id"]: c for c in prev.get("pending", []) if isinstance(c, dict) and c.get("lg") == key
                 and finds.ID_RE.match(str(c.get("id", ""))) and now - int(c.get("d", 0)) < PENDING_DAYS * 86400 and c["id"] not in known}
        ups = finds.safe(key + "-youtube", lambda: uploads(key, auth), report) or []
        for u in ups:
            if u["id"] in known or u["id"] in seen or u["id"] in cands or now - u["d"] > KEEP_CLIPS * 86400:
                continue
            if classify(key, u["title"])[0]:
                cands[u["id"]] = dict(u, lg=key)
        details = {}
        if cands and auth and auth[0] is not None:
            details = finds.safe(key + "-videos", lambda: finds.youtube_details(list(cands), auth), report) or {}
        measured = report.get(key + "-videos") == "ok"
        for vid, c in cands.items():
            if not measured:
                pending_all.append(c)
                continue
            clip, why = gate(key, c, details.get(vid))
            if clip:
                clips.append(clip)
            elif why:
                seen[vid] = now
            else:
                pending_all.append(c)
        for g in games:
            g.pop("hl", None)
        clips = link_games(sorted(clips, key=lambda c: -int(c["d"]))[:MAX_CLIPS], games)
        # reddit_at is when the list last CHANGED, so a quiet run commits
        # nothing; a dead route keeps the last list for a day and a half
        posts = finds.safe(key + "-reddit", lambda: reddit_top(key, rc), report)
        at = old.get("reddit_at", 0)
        if posts is None:
            posts = old.get("reddit", []) if at > now - 36 * 3600 else []
        elif posts != old.get("reddit"):
            at = now
        leagues[key] = {"name": LEAGUES[key]["name"], "games": games, "clips": clips, "reddit": posts, "reddit_at": at}
        if key == "nba":
            s5 = starting5(old.get("starting5"), report)
            if s5:
                leagues[key]["starting5"] = s5
        time.sleep(0 if env.get("ONAIR_SPORTS_NO_SLEEP") else 4)   # Reddit 429s two quick asks in a row
    payload = {
        "v": 1,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "leagues": leagues,
        "local": local_block(today, now, report, prev.get("local")),
        "pending": sorted(pending_all, key=lambda c: -int(c["d"]))[:80],
        "seen": seen,
        "stats": {"sources": report},
    }
    print(json.dumps({k: {"games": len(v["games"]), "clips": len(v["clips"]), "linked": sum(1 for g in v["games"] if g.get("hl")),
                          "reddit": len(v["reddit"])} for k, v in leagues.items()} |
                     {"uvm": len(payload["local"]["uvm"]), "play": len(payload["local"]["play"]),
                      "pickup_next": bool(payload["local"]["pickup"].get("next")), "sources": report}, indent=1))
    if args.dry_run:
        return payload
    same = all(prev.get(k) == payload[k] for k in ("leagues", "local", "pending", "seen"))
    if same:
        log("nothing changed; file left as it was")
        return payload
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    os.replace(tmp, args.out)
    return payload


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        import subprocess
        sys.exit(subprocess.call([sys.executable, "-m", "unittest", "tests.test_gather_onair_sports"], cwd=ROOT))
    run(args)


if __name__ == "__main__":
    main()
