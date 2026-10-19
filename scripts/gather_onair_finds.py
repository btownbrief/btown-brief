#!/usr/bin/env python3
"""On Air finds: videos other people curated, sorted by how long they run.

Btown TV (curate_tv.py) is our own nightly edition. This is the shelf beside
it: what a handful of human curators found, checked against one quality bar,
with every video's real length so On Air can sort them into Snack (under 15
minutes), Commute (15 to 30), Sit-down (30 and up) and Trailers.

Where they come from (research: reference/drafts/new-nine-2026-10/research/
on-air-sources-2026-10-19.md in the newsletter repo):

  - Stephen's Inoreader tag "Curated Youtube": one public RSS request a day
    covers Wimp, Shahniva and The Awesomer (each item carries its YouTube id).
  - 13GB: its home page lists every card with a length and a category; an
    item's own page holds the YouTube id. At most a few new pages a run.
  - Clipsboard: nine-video boards ("nine clips, one idea"). The newest board
    links come from the tag; each board page carries its nine YouTube ids.
    A board is a playlist.
  - Short of the Week: its RSS, then each new film's page for the length and
    the player link (often Vimeo; Vimeo's public oEmbed gives the picture).
  - BiteTube: the same public, keyless Sanity query its own page makes, once
    a week. It has not changed since May (11 videos), so a weekly look is
    plenty.

Politeness: with the default --pages 4 a run makes at most about twenty
requests across all of these (the tag, 13GB's home page and up to four of
its pages, up to four new boards, Short of the Week's feed and up to four
film pages plus a Vimeo oEmbed each, BiteTube once a week) and one to three
YouTube API calls; most days it is fewer, since only new pages are read. It reads
only pages robots.txt allows, re-hosts nothing (On Air plays YouTube's and
Vimeo's own embeds), and credits the curator on every card with a link back.
What a run already looked at is remembered in the file (`seen`), so the
next run never asks again.

YouTube's videos.list fills in length, channel and whether the video can be
embedded: one quota unit per fifty ids. YOUTUBE_API_KEY, or the same OAuth
refresh token curate_tv.py publishes playlists with. No model call: cost $0.

The quality bar (gate()): public and embeddable, not live, not for kids,
two minutes or longer unless it is a trailer, no Shorts, no shouting
clickbait titles, at most three from one channel.

Failure posture: each source fails on its own and the file keeps what it had;
no YouTube credentials means nothing new can be measured, so nothing new is
added. The script exits 0 either way and only writes when it has items.

CLI:
  --out PATH     the payload, read for carry-forward and rewritten
                 (default all-day/data/onair-finds.json)
  --pages N      new 13GB / Clipsboard / Short of the Week pages per run (4)
  --dry-run      print the summary, write nothing
  --selftest     run the offline checks and exit
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
import xml.etree.ElementTree as ET

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "all-day", "data", "onair-finds.json")

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 btownbrief-onair/1.0")
API = "https://www.googleapis.com/youtube/v3"
TAG_URL = ("https://www.inoreader.com/stream/user/1003590800/tag/"
           "Curated%20Youtube?n=200")
GB_HOME = "https://13gb.com/"
SOTW_FEED = "https://www.shortoftheweek.com/feed/"
BITETUBE_QUERY = ("https://kfw08zjm.apicdn.sanity.io/v2024-01-01/data/query/"
                  "production")
BITETUBE_GROQ = ('*[_type == "video"] | order(curatedDate desc) '
                 '{_id, title, youtubeId, whyWatch, curatedDate}')

KEEP_DAYS = 45          # a find stays on the shelf this long
MAX_ITEMS = 320
MAX_BOARDS = 24
PER_CHANNEL = 3
PER_CURATOR_RUN = 10    # one curator's themed batch must not take the shelf over
SEEN_DAYS = 120         # how long a looked-at id or page is remembered
BITETUBE_EVERY = 6 * 86400
TRAILER_MIN = 30        # a trailer still has to be more than a sting
MIN_SECONDS = 120       # Stephen: "I don't LOVE videos under 2 minutes"

# the curator, by the feed Inoreader names as an item's source
CURATORS = [
    (re.compile(r"wimp\.com"), "Wimp", "wimp"),
    (re.compile(r"shahniva\.com"), "Shahniva", "shahniva"),
    (re.compile(r"theawesomer\.com"), "The Awesomer", "awesomer"),
    (re.compile(r"13gb\.com"), "13GB", "13gb"),
    (re.compile(r"clipsboard\.com"), "Clipsboard", "clipsboard"),
    (re.compile(r"shortoftheweek\.com"), "Short of the Week", "sotw"),
    (re.compile(r"uncrate\.com"), "Uncrate", "uncrate"),
]
VIA_NAME = {key: name for _, name, key in CURATORS}
VIA_NAME["bitetube"] = "BiteTube"

YT_ID = r"([A-Za-z0-9_-]{11})"
YT_RE = re.compile(r"(?:i\.ytimg\.com/vi/|img\.youtube\.com/vi/|youtube(?:-nocookie)?\.com/embed/"
                   r"|youtube\.com/watch\?v=|youtu\.be/)" + YT_ID)
SHAHNIVA_RE = re.compile(r"shahniva\.com/video/[^\s\"'<>]*-" + YT_ID + r"(?:[/?#]|$)")
VIMEO_RE = re.compile(r"(?:player\.)?vimeo\.com/(?:video/)?(\d{5,12})")
ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
ISO_RE = re.compile(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")

TRAILER_RE = re.compile(r"\b(trailer|teaser)\b", re.I)
SHORTS_RE = re.compile(r"#shorts?\b", re.I)
BAIT_PHRASES = re.compile(
    r"you won'?t believe|gone wrong|must see|will shock|shocking|insane|"
    r"destroy(?:ed|s)\b|exposed\b|\bpranks?\b|reacts? to\b|\bslams\b|\bowned\b|"
    r"!!|\?!|😱|🤯|😳|🔥🔥", re.I)
# all-caps words that are names, not shouting
CAPS_OK = {"NASA", "NYC", "USA", "BBC", "NPR", "TED", "SNL", "LEGO", "NBA", "NFL",
           "NHL", "MLB", "FIFA", "UFO", "DIY", "CEO", "HBO", "PBS", "CNN", "ESPN",
           "NATO", "JAPAN", "LIVE", "ASMR", "KPOP", "BTS", "UVM", "VPR", "WCAX",
           "MTV", "AMA", "RPG", "IMAX", "NYPD", "LAPD", "FBI", "CIA", "UNESCO",
           "KATSEYE", "BLACKPINK", "ABBA", "AC/DC", "R&B", "OK", "TV", "AI", "UK",
           "EU", "US", "LA", "DC", "VS", "II", "III", "IV", "XL", "AM", "PM"}
CAPS_WORD = re.compile(r"\b[A-Z][A-Z'’]{3,}\b")


# ----------------------------------------------------------------------- util

def now_ts():
    return int(time.time())


def clean(text, limit=0):
    text = re.sub(r"<[^>]+>", " ", html.unescape(str(text or "")))
    text = re.sub(r"\s+", " ", text).strip()
    if limit and len(text) > limit:
        cut = text[:limit - 1].rsplit(" ", 1)[0] or text[:limit - 1]
        text = cut.rstrip(" ,.;:-") + "…"
    return text


def fetch(url, accept=None, timeout=25, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers=dict(
        {"User-Agent": UA, "Accept": accept or "*/*"}, **(headers or {})))
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def fetch_json(url, **kw):
    return json.loads(fetch(url, accept="application/json", **kw))


def iso_seconds(iso):
    match = ISO_RE.fullmatch(iso or "")
    if not match:
        return None
    h, m, s = (int(part or 0) for part in match.groups())
    return h * 3600 + m * 60 + s


def fmt_seconds(sec):
    if not sec:
        return ""
    h, rest = divmod(int(sec), 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def clock_seconds(text):
    """'2:43' / '1:02:03' / '26.49' -> seconds, or None."""
    parts = re.findall(r"\d+(?:\.\d+)?", str(text or ""))
    if not parts or not re.fullmatch(r"[\d:.]+", str(text).strip()):
        return None
    total = 0.0
    for part in parts:
        total = total * 60 + float(part)
    return int(total)


def curator_of(url):
    for pattern, _name, key in CURATORS:
        if pattern.search(url or ""):
            return key
    return ""


def bucket(sec, trailer):
    """Stephen, 2026-10-19: a snack, a commute, a long sit-down; trailers apart."""
    if trailer:
        return "trailer"
    if sec < 15 * 60:
        return "snack"
    if sec < 30 * 60:
        return "commute"
    return "sit"


def clickbait(title):
    """Shouting, not naming: a caps word that is not a known name, or a bait phrase.
    Anything after a ' | ' is usually the channel or the series and is ignored."""
    head = re.split(r"\s[|•]\s", title or "")[0]
    if BAIT_PHRASES.search(head):
        return True
    shouts = [w for w in CAPS_WORD.findall(head) if w.replace("’", "'").rstrip("'S") not in CAPS_OK
              and w not in CAPS_OK]
    letters = re.sub(r"[^A-Za-z]", "", head)
    mostly_caps = len(letters) > 12 and sum(c.isupper() for c in letters) / len(letters) > 0.6
    return bool(shouts) or mostly_caps


# -------------------------------------------------------------------- sources

def parse_tag(xml_text):
    """Inoreader's RSS -> [{via, id?, vimeo?, url, title, why, d}] plus the
    Clipsboard board links it names. Never raises on one bad item."""
    root = ET.fromstring(xml_text)
    found, boards = [], []
    for item in root.findall("./channel/item"):
        source = item.find("source")
        via = curator_of(source.get("url") if source is not None else "") or curator_of(item.findtext("link"))
        link = (item.findtext("link") or "").strip()
        blob = ET.tostring(item, encoding="unicode")
        if via == "clipsboard":
            m = re.search(r"clipsboard\.com/grid/([a-z0-9-]+)", link)
            if m:
                boards.append(m.group(1))
            continue
        if via in ("13gb", "uncrate", "sotw", ""):
            continue    # 13GB and SOTW are read at the source; Uncrate has no ids
        m = SHAHNIVA_RE.search(link) or YT_RE.search(blob)
        if not m:
            continue
        found.append({"via": via, "id": m.group(1), "url": link,
                      "title": clean(item.findtext("title"), 140)})
    return found, list(dict.fromkeys(boards))


def parse_13gb_home(page):
    """Every card on 13GB's home page: slug, length, category, date, title, excerpt."""
    out = []
    for m in re.finditer(r'<div class="video-card"([^>]*)>(.*?)</div>\s*</a>', page, re.S):
        attrs, body = m.group(1), m.group(2)
        slug = re.search(r'href="/([A-Za-z0-9_-]+)"', body)
        if not slug:
            continue
        get = lambda name: (re.search(name + r'="([^"]*)"', attrs) or [None, ""])[1]  # noqa: E731
        title = re.search(r"<h2>(.*?)</h2>", body, re.S)
        excerpt = re.search(r'class="excerpt">(.*?)</p>', body, re.S)
        out.append({"slug": slug.group(1), "sec": clock_seconds(get("data-duration")),
                    "cat": get("data-subcategory").lower(), "date": get("data-upload-date"),
                    "title": clean(title.group(1) if title else "", 140),
                    "why": clean(excerpt.group(1) if excerpt else "", 160)})
    return out


def worth_13gb(card):
    """Ads are ads; a page read is spent only where a video could pass the bar."""
    if card["cat"] == "commercials":
        return False
    if card["cat"] == "trailers":
        return True
    return (card["sec"] or 0) >= MIN_SECONDS


def parse_board(page, slug):
    """A Clipsboard board: its title, category and nine YouTube ids, in order."""
    ids = []
    for m in re.finditer(r'\\?"videoId\\?":\\?"' + YT_ID, page):
        if m.group(1) not in ids:
            ids.append(m.group(1))
    if not ids:
        for m in re.finditer(r"youtube(?:-nocookie)?\.com/embed/" + YT_ID, page):
            if m.group(1) not in ids:
                ids.append(m.group(1))
    title = re.search(r'<meta property="og:title" content="([^"]+)"', page) or \
        re.search(r"<title>(.*?)</title>", page, re.S)
    title = clean(title.group(1) if title else slug.replace("-", " "), 90)
    title = re.sub(r"\s*[—|-]\s*Clipsboard.*$", "", title)
    cat = re.search(r'\\?"category\\?":\\?"([A-Za-z]+)', page)
    return {"slug": slug, "t": title, "cat": cat.group(1).lower() if cat else "",
            "ids": ids[:9]}


def parse_sotw_feed(xml_text):
    root = ET.fromstring(xml_text)
    out = []
    for item in root.findall("./channel/item"):
        link = (item.findtext("link") or "").strip()
        m = re.search(r"shortoftheweek\.com/(\d{4}/\d{2}/\d{2}/[a-z0-9-]+)/?$", link)
        if m:
            out.append({"slug": m.group(1), "url": link, "title": clean(item.findtext("title"), 140)})
    return out


def parse_sotw_page(page):
    """A film page's own data: length in minutes, the player link, the logline."""
    dur = re.search(r'"duration":"(\d{1,3})"', page)
    play = re.search(r'"play_link":"([^"]+)"', page)
    why = re.search(r'"post_excerpt":"((?:[^"\\]|\\.)*)"', page)
    play = play.group(1).replace("\\/", "/") if play else ""
    yt = YT_RE.search(play)
    vm = VIMEO_RE.search(play)
    return {"min": int(dur.group(1)) if dur else None,
            "id": yt.group(1) if yt else None, "vimeo": vm.group(1) if vm else None,
            "why": clean(json.loads('"' + why.group(1) + '"') if why else "", 160)}


# ------------------------------------------------------------------- youtube

def youtube_auth():
    key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if key:
        return {"key": key}, {}
    cid = os.environ.get("YT_OAUTH_CLIENT_ID", "").strip()
    secret = os.environ.get("YT_OAUTH_CLIENT_SECRET", "").strip()
    refresh = os.environ.get("YT_OAUTH_REFRESH_TOKEN", "").strip()
    if not (cid and secret and refresh):
        return None, None
    body = urllib.parse.urlencode({"client_id": cid, "client_secret": secret,
                                   "refresh_token": refresh, "grant_type": "refresh_token"}).encode()
    tok = json.loads(fetch("https://oauth2.googleapis.com/token", data=body,
                           headers={"Content-Type": "application/x-www-form-urlencoded"}))
    return {}, {"Authorization": "Bearer " + tok["access_token"]}


def youtube_details(ids, auth):
    """id -> the fields the gate needs. Fifty ids per quota unit."""
    params, headers = auth
    out = {}
    for start in range(0, len(ids), 50):
        query = dict(params, part="snippet,contentDetails,status", id=",".join(ids[start:start + 50]))
        data = fetch_json(f"{API}/videos?" + urllib.parse.urlencode(query), headers=headers)
        for v in data.get("items", []):
            sn, cd, st = v.get("snippet") or {}, v.get("contentDetails") or {}, v.get("status") or {}
            out[v["id"]] = {
                "t": clean(sn.get("title"), 140), "ch": clean(sn.get("channelTitle"), 60),
                "cid": sn.get("channelId", ""), "sec": iso_seconds(cd.get("duration")),
                "live": sn.get("liveBroadcastContent", "none") != "none",
                "ok": st.get("privacyStatus") == "public" and st.get("embeddable", False),
                "kids": bool(st.get("madeForKids")),
                "pub": sn.get("publishedAt", ""),
            }
    return out


# ---------------------------------------------------------------------- topic
# The curator's own category, where it has one, as On Air's topic (the
# Topics view, modes/onair.js TOPICS). Everything else is sorted there by
# channel and title; no model call.
GB_TOPIC = {"satirical content": "comedy", "comedy": "comedy", "music": "music", "short films": "film",
            "trailers": "trailer", "documentary": "docs", "documentaries": "docs", "sports": "sports"}


def topic_of(cand):
    if cand.get("via") == "sotw":
        return "film"
    if cand.get("via") == "13gb":
        return GB_TOPIC.get(str(cand.get("cat") or "").lower(), "")
    return ""


# ----------------------------------------------------------------------- gate

def gate(cand, detail):
    """One candidate + its YouTube detail -> an item, or the reason it failed."""
    if not detail:
        return None, "gone"
    if not detail["ok"]:
        return None, "not embeddable"
    if detail["live"]:
        return None, "live"
    if detail["kids"]:
        return None, "for kids"
    title = detail["t"] or cand.get("title", "")
    trailer = bool(TRAILER_RE.search(title)) or cand.get("cat") == "trailers"
    sec = detail["sec"] or 0
    if SHORTS_RE.search(title) or sec <= 60 and not trailer:
        return None, "short"
    if sec < (TRAILER_MIN if trailer else MIN_SECONDS):
        return None, "short" if trailer else "under two minutes"
    if clickbait(title) and cand.get("via") not in ("sotw", "bitetube"):
        return None, "clickbait"
    if not mostly_latin(title):
        return None, "not in English"
    item = {"id": cand["id"], "t": title, "ch": detail["ch"], "sec": sec, "dur": fmt_seconds(sec),
            "b": bucket(sec, trailer), "via": cand["via"], "via_url": cand.get("url", ""),
            "why": cand.get("why", ""), "d": cand.get("d") or now_ts()}
    if topic_of(cand):
        item["topic"] = topic_of(cand)
    return item, None


def mostly_latin(title):
    """On Air is read in English: a title mostly in another script is skipped."""
    letters = [c for c in title if c.isalpha()]
    if not letters:
        return False
    latin = sum(1 for c in letters if ord(c) < 0x250)
    return latin / len(letters) >= 0.6


def cap_curators(items, per=PER_CURATOR_RUN):
    count, out = {}, []
    for it in items:
        count[it["via"]] = count.get(it["via"], 0) + 1
        if count[it["via"]] <= per:
            out.append(it)
    return out


def cap_channels(items, per=PER_CHANNEL):
    count, out = {}, []
    for it in items:
        key = (it.get("ch") or it.get("via")).lower()
        if count.get(key, 0) >= per:
            continue
        count[key] = count.get(key, 0) + 1
        out.append(it)
    return out


# ------------------------------------------------------------------------ run

def safe(label, fn, report):
    try:
        out = fn()
        report[label] = "ok"
        return out
    except Exception as exc:  # noqa: BLE001  each source fails on its own
        report[label] = f"failed: {exc.__class__.__name__}"
        print(f"onair-finds: {label} failed ({exc})", file=sys.stderr)
        return None


def run(args):
    now = now_ts()
    prev = {}
    try:
        with open(args.out, encoding="utf-8") as fh:
            prev = json.load(fh)
    except (OSError, ValueError):
        prev = {}
    seen = {k: v for k, v in (prev.get("seen") or {}).items() if now - int(v) < SEEN_DAYS * 86400}
    items = [it for it in prev.get("items", []) if now - int(it.get("d", 0)) < KEEP_DAYS * 86400]
    boards = list(prev.get("boards", []))
    known = {it["id"] for it in items}
    report = {}
    # candidates a run found but could not measure (YouTube was down) wait here
    cands = [c for c in prev.get("pending", []) if isinstance(c, dict) and ID_RE.match(str(c.get("id", "")))]

    tag = safe("inoreader", lambda: parse_tag(fetch(TAG_URL, accept="application/rss+xml")), report)
    tag_items, board_slugs = tag or ([], [])
    cands.extend(c for c in tag_items if c["via"] in VIA_NAME)

    home = safe("13gb", lambda: parse_13gb_home(fetch(GB_HOME, accept="text/html")), report) or []
    opened = 0
    for card in home:
        key = "13gb:" + card["slug"]
        if key in seen or not worth_13gb(card) or opened >= args.pages:
            continue
        opened += 1
        page = safe(key, lambda: fetch(GB_HOME + card["slug"], accept="text/html"), report)
        if page is None:
            continue    # a failed read is tried again tomorrow
        seen[key] = now
        m = YT_RE.search(page)
        if m:
            cands.append({"via": "13gb", "id": m.group(1), "url": GB_HOME + card["slug"],
                          "title": card["title"], "why": card["why"], "cat": card["cat"]})

    opened = 0
    have_boards = {b["slug"] for b in boards}
    for slug in board_slugs:
        key = "clipsboard:" + slug
        if key in seen or slug in have_boards or opened >= args.pages:
            continue
        opened += 1
        board = safe(key, lambda: parse_board(fetch("https://clipsboard.com/grid/" + slug, accept="text/html"), slug), report)
        if board is None:
            continue
        seen[key] = now
        if len(board["ids"]) >= 3:
            board.update(via="clipsboard", via_url="https://clipsboard.com/grid/" + slug, d=now)
            boards.insert(0, board)

    sotw_items = []
    feed = safe("sotw", lambda: parse_sotw_feed(fetch(SOTW_FEED, accept="application/rss+xml")), report) or []
    opened = 0
    for film in feed:
        key = "sotw:" + film["slug"]
        if key in seen or opened >= args.pages:
            continue
        opened += 1
        info = safe(key, lambda: parse_sotw_page(fetch(film["url"], accept="text/html")), report)
        if info is None:
            continue
        seen[key] = now
        if info["id"]:
            cands.append({"via": "sotw", "id": info["id"], "url": film["url"], "title": film["title"], "why": info["why"]})
        elif info["vimeo"] and info["min"]:
            oe = safe(key + ":vimeo", lambda: fetch_json("https://vimeo.com/api/oembed.json?url=" +
                      urllib.parse.quote("https://vimeo.com/" + info["vimeo"])), report) or {}
            try:
                sec = int(oe.get("duration") or info["min"] * 60)
            except (TypeError, ValueError):
                sec = 0
            if sec >= MIN_SECONDS and str(oe.get("thumbnail_url", "")).startswith("https://i.vimeocdn.com/"):
                sotw_items.append({"id": "vm" + info["vimeo"], "vimeo": info["vimeo"], "t": film["title"], "topic": "film",
                                   "ch": clean(oe.get("author_name"), 60), "sec": sec, "dur": fmt_seconds(sec),
                                   "b": bucket(sec, False), "via": "sotw", "via_url": film["url"],
                                   "why": info["why"], "art": oe["thumbnail_url"], "d": now})

    if now - int((prev.get("checked") or {}).get("bitetube", 0)) > BITETUBE_EVERY:
        url = BITETUBE_QUERY + "?" + urllib.parse.urlencode({"query": BITETUBE_GROQ})
        def bitetube():
            out = []
            for v in fetch_json(url).get("result") or []:
                if isinstance(v, dict) and ID_RE.match(str(v.get("youtubeId") or "")):
                    out.append({"via": "bitetube", "id": v["youtubeId"], "title": clean(v.get("title"), 140),
                                "url": "https://bitetube.vercel.app/video/" + urllib.parse.quote(str(v.get("_id", ""))),
                                "why": clean(v.get("whyWatch"), 160)})
            return out
        bt = safe("bitetube", bitetube, report)
        if bt is not None:
            (prev.setdefault("checked", {}))["bitetube"] = now
            cands.extend(bt)

    # new YouTube ids only: what is on the shelf or was turned away is never asked twice
    fresh, order = {}, []
    for c in cands:
        if ID_RE.match(c["id"]) and c["id"] not in known and ("yt:" + c["id"]) not in seen and c["id"] not in fresh:
            fresh[c["id"]] = c
            order.append(c["id"])
    # a board's clips are measured once, when the board is new
    board_ids = [i for b in boards if not b.get("clips") for i in b.get("ids", [])]
    details = {}
    auth = safe("youtube-auth", youtube_auth, report)
    if auth and auth[0] is not None and (order or board_ids):
        details = safe("youtube", lambda: youtube_details(order + [i for i in dict.fromkeys(board_ids) if i not in fresh], auth), report) or {}
    elif order:
        report["youtube"] = "no credentials: nothing new measured"
    reasons = {}
    added = []
    pending = []
    for vid in order:
        if vid not in details and report.get("youtube") != "ok":
            pending.append(fresh[vid])    # unmeasured: kept for the next run, never re-fetched
            continue
        item, why = gate(fresh[vid], details.get(vid))
        seen["yt:" + vid] = now
        if item:
            added.append(item)
        else:
            reasons[why] = reasons.get(why, 0) + 1
    known_ids = {it["id"] for it in items}
    added = cap_curators(added + [it for it in sotw_items if it["id"] not in known_ids])

    # boards: keep only the clips that can play, with their lengths
    kept_boards = []
    for b in boards[:MAX_BOARDS]:
        clips = []
        for vid in b.get("ids", []):
            d = details.get(vid)
            prior = next((c for c in b.get("clips", []) if c.get("id") == vid), None)
            if d:
                trailer = bool(TRAILER_RE.search(d["t"] or ""))
                sec = d["sec"] or 0
                if d["ok"] and not d["live"] and not d["kids"] and sec >= (TRAILER_MIN if trailer else MIN_SECONDS):
                    clips.append({"id": vid, "t": d["t"], "ch": d["ch"], "sec": sec, "dur": fmt_seconds(sec)})
            elif prior:
                clips.append(prior)
        if len(clips) >= 3:
            b = dict(b, clips=clips, sec=sum(c["sec"] for c in clips))
            kept_boards.append(b)

    # a find from before topics were kept: Short of the Week's are films; an
    # older 13GB find kept no category, so On Air sorts it by channel and title
    for it in items:
        if not it.get("topic") and topic_of(it):
            it["topic"] = topic_of(it)
    merged = sorted(added + items, key=lambda it: -int(it.get("d", 0)))
    merged = cap_channels(merged)[:MAX_ITEMS]
    payload = {
        "v": 1,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "credit": {k: VIA_NAME[k] for k in VIA_NAME},
        "items": merged,
        "boards": kept_boards,
        "checked": prev.get("checked", {}),
        "seen": seen,
        "pending": pending[:200],
        "stats": {"added": len(added), "turned_away": reasons,
                  "sources": {k: v for k, v in report.items() if ":" not in k}},
    }
    by_bucket = {}
    for it in merged:
        by_bucket[it["b"]] = by_bucket.get(it["b"], 0) + 1
    print(json.dumps({"added": len(added), "total": len(merged), "buckets": by_bucket,
                      "boards": len(kept_boards), "turned_away": reasons,
                      "sources": {k: v for k, v in report.items() if ":" not in k}}, indent=1))
    if args.dry_run:
        return payload
    if not merged and not kept_boards:
        print("onair-finds: nothing to write; keeping the last file", file=sys.stderr)
        return payload
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    os.replace(tmp, args.out)
    return payload


def selftest():
    import subprocess
    return subprocess.call([sys.executable, "-m", "unittest", "tests.test_gather_onair_finds"], cwd=ROOT)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--pages", type=int, default=4)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        sys.exit(selftest())
    run(args)


if __name__ == "__main__":
    main()
