#!/usr/bin/env python3
"""All Day's Watch tab, in theaters near you: data/showtimes.json.

Today's and the next few days' showtimes at the three cinemas Stephen
named, each read from the theater's own public showtimes page, the same
page a person would open:

  Partizanfilm    230 College St., Burlington. Its homepage says when it is
                  closed (and when it is back); its times are on its Veezi
                  ticketing page (/sessions/, which Veezi's robots.txt allows),
                  whose site token is printed on the homepage.
  Majestic 10     190 Boxwood St., Williston. The site's own showtimes
                  fragment, one plain GET per day (/theater/nowplaying), for
                  the days its date bar has shows on. robots.txt allows all.
  Essex Cinemas   21 Essex Way, Essex. The showtimes page carries every
                  screening as schema.org ScreeningEvent JSON-LD. Its site
                  sits behind an AWS firewall that answers GitHub's runners
                  "405 Not Allowed" (a "Human Verification" page to other
                  cloud machines) on every run since 2026-10-17, while a home
                  connection gets the page. So Stephen's Mac reads that one
                  page each morning (scripts/send_essex_showtimes.sh runs
                  --essex-dump and hands the screenings to this workflow as
                  its `essex` input, --essex-json here). Nothing here tries
                  to get past the firewall.

A theater whose page fails this run keeps the times it last had that are
still ahead (--prev, the published file), with `read` saying when they were
read, so one good morning carries the days after it.

Only film titles and start times are kept: no posters, synopses or prices
from the theaters. With TMDB_API_KEY set, each title is matched to TMDB
(id and poster path) so the tab can open its trailer and sheet; without a
key the titles stand alone.

The file:

  { v, built, days: ["2026-10-17", ...],
    theaters: [ { id, name, town, url, ok, closed, back,
                  days: { "2026-10-17": [ { t, id?, p?, times: ["11:00", "13:40"] } ] } } ] }

`ok` is false when that theater's page could not be read this run (the tab
still shows its row and the Showtimes button). `closed` and `back` come
from the theater's own closure notice.

Failure posture: a theater that fails is written with ok false; if every
theater fails, nothing is written and the run exits 1, so the last good
file stays.

CLI:
  --out PATH         where to write (default data/showtimes.json)
  --days N           how many days ahead, today included (default 7)
  --prev PATH        the last published file: a theater that fails keeps its days still ahead
  --essex-json PATH  Essex's screenings read elsewhere (the --essex-dump shape), used when its page fails here
  --essex-dump       read Essex's page and print its screenings as JSON, for the Mac to send
  --selftest         run the offline checks and exit
"""

import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_films import POSTER, Tmdb, write_json  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "data", "showtimes.json")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
ET = ZoneInfo("America/New_York")
DAYS = 7
PAUSE = 1.0
ATTEMPTS = 2

THEATERS = [
    {"id": "partizanfilm", "name": "Partizanfilm", "town": "Burlington", "url": "https://www.partizanfilm.org/"},
    {"id": "majestic10", "name": "Majestic 10", "town": "Williston", "url": "https://www.majestic10.com/movies"},
    {"id": "essex", "name": "Essex Cinemas", "town": "Essex", "url": "https://www.essexcinemas.com/vermont/essex/essex-cinemas-9/showtimes"},
]
PZ_HOME = "https://www.partizanfilm.org/"
VEEZI = "https://ticketing.useast.veezi.com/sessions/?siteToken={token}"
MJ_HOME = "https://www.majestic10.com/"
MJ_DAY = "https://www.majestic10.com/theater/nowplaying?locationKey=Majestic10&date={mdy}"
ESSEX = "https://www.essexcinemas.com/vermont/essex/essex-cinemas-9/showtimes"

MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
SMALL = {"a", "an", "and", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "with"}


def log(msg):
    print("build_showtimes: " + msg, file=sys.stderr)


def text(fragment):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment or ""))).strip()


def norm(t):
    return re.sub(r"[^a-z0-9]+", "", str(t or "").lower().replace("&", "and"))


def clock(s):
    """'1:55 PM' -> '13:55'; None for anything else."""
    m = re.match(r"^\s*(\d{1,2}):(\d{2})\s*([AaPp])\.?\s*[Mm]?\.?\s*$", s or "")
    if not m:
        return None
    h, mi, ap = int(m.group(1)), int(m.group(2)), m.group(3).lower()
    if not (1 <= h <= 12 and 0 <= mi < 60):
        return None
    h = h % 12 + (12 if ap == "p" else 0)
    return f"{h:02d}:{mi:02d}"


def title_case(t):
    """'STREET FIGHTER II: THE MOVIE' -> 'Street Fighter II: The Movie'.
    Only for a title with no lowercase at all; anything else is left alone."""
    t = re.sub(r"\s+", " ", t or "").strip()
    if not t or re.search(r"[a-z]", t):
        return t
    out = []
    for i, w in enumerate(t.split(" ")):
        lw = w.lower()
        if re.fullmatch(r"[IVX]{1,4}[:,.!?]*", w):
            out.append(w)
        elif i and lw in SMALL and not out[-1].endswith(":"):
            out.append(lw)
        else:
            out.append(re.sub(r"(^|[-'(\"])([a-z])", lambda m: m.group(1) + m.group(2).upper(), lw))
    return " ".join(out)


def add(days, day, title, when):
    if not title or not when:
        return
    films = days.setdefault(day, [])
    f = next((x for x in films if norm(x["t"]) == norm(title)), None)
    if not f:
        f = {"t": title, "times": []}
        films.append(f)
    if when not in f["times"]:
        f["times"].append(when)


def tidy(days, wanted):
    """The wanted days that have shows; a theater with none in the window
    (closed for a fortnight) keeps its first day after it instead."""
    out = {}
    later = sorted(d for d in days if d > wanted[-1] and days[d])
    for day in wanted + later[:1]:
        if day not in wanted and out:
            break
        films = days.get(day) or []
        for f in films:
            f["times"].sort()
        films = [f for f in films if f["times"]]
        films.sort(key=lambda f: (f["times"][0], f["t"]))
        if films:
            out[day] = films
    return out


# ------------------------------------------------------------ the parsers
def pz_closed(doc, today):
    """(closed, back) from Partizanfilm's homepage notice: 'Partizanfilm is
    temporarily closed. We will return on Friday, Oct. 30, ...'."""
    body = text(doc)
    if not re.search(r"\b(temporarily|currently) closed\b", body, re.I):
        return False, ""
    m = re.search(r"\b(?:return|reopen|re-open|back)\w*\s+(?:on\s+)?(?:[A-Z][a-z]+day,?\s+)?([A-Z][a-z]{2,8})\.?\s+(\d{1,2})\b", body)
    if m and m.group(1)[:3].lower() in MONTHS:
        back = infer(today, MONTHS[m.group(1)[:3].lower()], int(m.group(2)))
        return True, back.isoformat() if back else ""
    return True, ""


def infer(today, month, day):
    """The date with that month and day nearest after today (a listing has no year)."""
    for y in (today.year, today.year + 1):
        try:
            d = date(y, month, day)
        except ValueError:
            continue
        if d >= today - timedelta(days=1):
            return d
    return None


def pz_token(doc):
    m = re.search(r"veezi\.com/[^\"']*?siteToken=([A-Za-z0-9]+)", doc or "")
    return m.group(1) if m else ""


def veezi(doc, today):
    """{day: [(title, 'HH:MM')]} from a Veezi sessions page."""
    out = {}
    panel = (doc or "").split('id="sessionsByFilmConent"')[0]
    for block in re.split(r'<div class="date">', panel)[1:]:
        head = re.search(r'<h3 class="date-title[^"]*">(.*?)</h3>', block, re.S)
        m = head and re.search(r"(\d{1,2}),?\s+([A-Za-z]+)", text(head.group(1)))
        if not m or m.group(2)[:3].lower() not in MONTHS:
            continue
        day = infer(today, MONTHS[m.group(2)[:3].lower()], int(m.group(1)))
        if not day:
            continue
        for film in re.split(r'<div\s+class="film\b', block)[1:]:
            t = re.search(r'<h3 class="title">(.*?)</h3>', film, re.S)
            for tm in re.findall(r"<time>(.*?)</time>", film, re.S):
                out.setdefault(day.isoformat(), []).append((text(t.group(1)) if t else "", clock(text(tm))))
    return out


def mj_dates(doc):
    """The MM/DD/YYYY dates Majestic 10's date bar has shows on."""
    out = []
    for cls, mdy in re.findall(r'<div class="(dates__item[^"]*)"\s+data-date="(\d{2}/\d{2}/\d{4})"', doc or ""):
        if "disabled" not in cls and mdy not in out:
            out.append(mdy)
    return out


def mj_day(doc):
    """[(title, 'HH:MM')] from one day's nowplaying fragment."""
    out = []
    for item in re.split(r'<div class="nowPlaying__item\b', doc or "")[1:]:
        t = re.search(r'<h3 class="nowPlaying__movieTitle"[^>]*\btitle="([^"]*)"', item)
        title = title_case(html.unescape(t.group(1))) if t else ""
        for tm in re.findall(r'<a class="button button--showtime[^"]*"[^>]*>\s*<span>(.*?)</span>', item, re.S):
            out.append((title, clock(text(tm))))
    return out


def essex(doc):
    """{day: [(title, 'HH:MM')]} from the ScreeningEvent JSON-LD."""
    out = {}
    for raw in re.findall(r'<script type="application/ld\+json">(.*?)</script>', doc or "", re.S):
        try:
            data = json.loads(raw)
        except ValueError:
            continue
        nodes = data.get("@graph") if isinstance(data, dict) else data
        for n in nodes if isinstance(nodes, list) else [data]:
            if not isinstance(n, dict) or n.get("@type") != "ScreeningEvent":
                continue
            work = n.get("workPresented") if isinstance(n.get("workPresented"), dict) else {}
            title = str(work.get("name") or re.sub(r"\s+at Essex Cinemas$", "", str(n.get("name") or ""))).strip()
            m = re.match(r"^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})", str(n.get("startDate") or ""))
            if title and m:
                out.setdefault(m.group(1), []).append((title_case(html.unescape(title)), m.group(2) + ":" + m.group(3)))
    return out


# ------------------------------------------------- Essex, read elsewhere
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
HHMM_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
RELAY_MAX = 600   # screenings: a week of a nine-screen house is about 250


def essex_dump(web, now=None):
    """Essex's screenings as the small JSON the workflow's `essex` input takes."""
    now = now or datetime.now(timezone.utc)
    got = essex(web.get(ESSEX))
    if not got:
        raise RuntimeError("no ScreeningEvent on the showtimes page")
    return {"v": 1, "read": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "days": {d: [[t, h] for t, h in rows] for d, rows in sorted(got.items())}}


def essex_relayed(raw, today):
    """(days, read) from an --essex-dump document, every field checked: it
    arrives as a workflow input, so it is treated as untrusted text. Only days
    from today on; nothing at all when the shape is wrong."""
    try:
        doc = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        return {}, ""
    if not isinstance(doc, dict) or doc.get("v") != 1 or not isinstance(doc.get("days"), dict):
        return {}, ""
    read = str(doc.get("read") or "")
    if not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", read):
        return {}, ""
    out, n = {}, 0
    for day, rows in doc["days"].items():
        if not DAY_RE.match(str(day)) or day < today.isoformat() or not isinstance(rows, list):
            continue
        for row in rows:
            if not (isinstance(row, list) and len(row) == 2 and all(isinstance(x, str) for x in row)):
                continue
            title, when = re.sub(r"\s+", " ", row[0]).strip()[:120], row[1]
            if title and HHMM_RE.match(when) and n < RELAY_MAX:
                out.setdefault(day, []).append((title, when))
                n += 1
    return out, read


def carried(prev, tid, today):
    """(days, read) a failed theater keeps from the last published file:
    its days from today on, and when they were read."""
    if not isinstance(prev, dict):
        return {}, ""
    row = next((t for t in prev.get("theaters") or [] if isinstance(t, dict) and t.get("id") == tid and t.get("ok")), None)
    if not row or not isinstance(row.get("days"), dict):
        return {}, ""
    days = {d: v for d, v in row["days"].items() if DAY_RE.match(str(d)) and d >= today.isoformat() and isinstance(v, list) and v}
    return days, str(row.get("read") or prev.get("built") or "")


# --------------------------------------------------------------- the run
class Web:
    def __init__(self, opener=None, pause=PAUSE):
        self.opener = opener or self._open
        self.pause = pause

    def _open(self, url):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode("utf-8", "replace")

    def get(self, url):
        last = None
        for attempt in range(ATTEMPTS):
            try:
                out = self.opener(url)
                time.sleep(self.pause)
                return out
            except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
                last = e
                time.sleep(self.pause * (1 + attempt))
        raise RuntimeError(f"{url}: {last}")


def read_theater(tid, web, today, wanted):
    """(days, closed, back) for one theater.
    A page that answers but no longer looks like what the parser knows
    raises, so the theater is marked ok false instead of an empty success
    that would replace its last good times."""
    days, closed, back = {}, False, ""
    if tid == "partizanfilm":
        home = web.get(PZ_HOME)
        closed, back = pz_closed(home, today)
        token = pz_token(home)
        if not token:
            raise RuntimeError("no Veezi token on the homepage")
        page = web.get(VEEZI.format(token=token))
        if 'id="sessionsByDateConent"' not in page:
            raise RuntimeError("the Veezi page has no sessions panel")
        for day, rows in veezi(page, today).items():
            for title, when in rows:
                add(days, day, title, when)
        if not days and not closed:
            raise RuntimeError("open, and no sessions read")
    elif tid == "majestic10":
        home = web.get(MJ_HOME)
        if "dates__item" not in home:
            raise RuntimeError("no date bar on the homepage")
        mdys = [d for d in mj_dates(home)
                if f"{d[6:]}-{d[:2]}-{d[3:5]}" >= wanted[0]][:len(wanted) + 1]
        for mdy in mdys:
            day = f"{mdy[6:]}-{mdy[:2]}-{mdy[3:5]}"
            frag = web.get(MJ_DAY.format(mdy=urllib.parse.quote(mdy, safe="")))
            if "nowPlaying" not in frag:
                raise RuntimeError(f"the {mdy} fragment is not a showtimes list")
            for title, when in mj_day(frag):
                add(days, day, title, when)
        if mdys and not days:
            raise RuntimeError("days with shows, and no times read")
    elif tid == "essex":
        got = essex(web.get(ESSEX))
        if not got:
            raise RuntimeError("no ScreeningEvent on the showtimes page")
        for day, rows in got.items():
            for title, when in rows:
                add(days, day, title, when)
    return tidy(days, wanted), closed, back


def match_titles(api, theaters, today):
    """TMDB id and poster for each title, where the title matches exactly:
    a release from the last two years first, then the most popular."""
    cache = {}
    for th in theaters:
        for films in th["days"].values():
            for f in films:
                key = norm(f["t"])
                if key not in cache:
                    data = api.get("/search/movie", query=f["t"], include_adult="false", language="en-US") or {}
                    best = None
                    for r in data.get("results") or []:
                        if not isinstance(r, dict) or not isinstance(r.get("id"), int) or r.get("adult"):
                            continue
                        if key not in (norm(r.get("title")), norm(r.get("original_title"))):
                            continue
                        y = str(r.get("release_date") or "")[:4]
                        recent = y.isdigit() and int(y) >= today.year - 2
                        rank = (0 if recent else 1, -(r.get("popularity") or 0))
                        if best is None or rank < best[0]:
                            best = (rank, r)
                    cache[key] = best[1] if best else None
                r = cache[key]
                if r:
                    f["id"] = r["id"]
                    f["t"] = str(r.get("title") or f["t"])
                    poster = str(r.get("poster_path") or "")
                    if POSTER.match(poster):
                        f["p"] = poster


def run(args, web=None, api=None, now=None):
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(ET).date()
    wanted = [(today + timedelta(days=i)).isoformat() for i in range(max(1, args.days))]
    web = web or Web()
    prev = None
    if getattr(args, "prev", None):
        try:
            with open(args.prev, encoding="utf-8") as fh:
                prev = json.load(fh)
        except (OSError, ValueError):
            prev = None
    relay = ({}, "")
    if getattr(args, "essex_json", None):
        try:
            with open(args.essex_json, encoding="utf-8") as fh:
                relay = essex_relayed(fh.read(), today)
        except OSError:
            relay = ({}, "")
    theaters = []
    for th in THEATERS:
        row = {**th, "ok": True, "closed": False, "back": "", "days": {}}
        try:
            row["days"], row["closed"], row["back"] = read_theater(th["id"], web, today, wanted)
        except Exception as e:  # noqa: BLE001 — one theater's trouble never sinks the others
            log(f"{th['name']}: {e}")
            row["ok"] = False
        if not row["ok"] and th["id"] == "essex" and relay[0]:
            days = {}
            for day, rows in relay[0].items():
                for title, when in rows:
                    add(days, day, title_case(title), when)
            row.update(ok=True, days=tidy(days, wanted), read=relay[1])
            log(f"{th['name']}: read on the Mac at {relay[1]}")
        if not row["ok"]:
            days, read = carried(prev, th["id"], today)
            if days:
                row.update(ok=True, days=tidy({d: [dict(f, times=list(f.get("times") or [])) for f in v if isinstance(f, dict) and f.get("t")]
                                               for d, v in days.items()}, wanted), read=read)
                log(f"{th['name']}: kept its times read {read or 'earlier'}")
        theaters.append(row)
    if not any(t["ok"] and (t["days"] or t["closed"]) for t in theaters):
        log("no theater gave times or a closure; keeping the last file")
        return 1
    key = os.environ.get("TMDB_API_KEY", "").strip()
    if api or key:
        try:
            match_titles(api or Tmdb(key), theaters, today)
        except Exception as e:  # noqa: BLE001 — titles without posters still ship
            log(f"TMDB matching skipped: {e}")
    write_json(args.out, {"v": 1, "built": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "days": wanted, "theaters": theaters})
    log(f"wrote {args.out}: " + ", ".join(
        f"{t['name']} " + ("failed" if not t["ok"] else f"{sum(len(v) for v in t['days'].values())} film-days"
                           + (f", closed until {t['back'] or '?'}" if t["closed"] else "")) for t in theaters))
    return 0


def selftest():
    sys.path.insert(0, os.path.join(ROOT, "tests"))
    import unittest
    suite = unittest.defaultTestLoader.loadTestsFromName("test_build_showtimes")
    if not unittest.TextTestRunner(verbosity=1).run(suite).wasSuccessful():
        sys.exit(1)
    print("selftest ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=OUT)
    parser.add_argument("--days", type=int, default=DAYS)
    parser.add_argument("--prev")
    parser.add_argument("--essex-json")
    parser.add_argument("--essex-dump", action="store_true")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    if args.essex_dump:
        print(json.dumps(essex_dump(Web()), ensure_ascii=False, separators=(",", ":")))
        return
    sys.exit(run(args))


if __name__ == "__main__":
    main()
