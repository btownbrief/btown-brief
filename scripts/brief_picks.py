#!/usr/bin/env python3
"""Build data/brief-picks.json — the newsletter's own event picks, dated.

The Countdown page's FROM THE BRIEF tab ticks down to the events Stephen
actually wrote up. Every edition's "Weather & Weekend Rundown" section has
one paragraph per day, and every event he names in those paragraphs is a
link. Those links are the picks: the intro is his curation, the calendar
section further down is the full listing. This script takes both apart
from the Beehiiv RSS feed (the same feed refresh-data.yml already reads):

  1. Intro paragraphs -> one pick per link, dated by the paragraph's day.
  2. Calendar section  -> "H:MM AM: <a>Title</a> at Venue (price)" per day,
                          keyed by url, which gives each pick its start time
                          and venue when the two match.

Editions from the last EDITION_DAYS days are read so a Friday edition's
weekend picks and a Monday edition's weekday picks coexist. Picks already
past are dropped here; the page drops the rest as they pass.

Fails soft: on a fetch error or a parse that finds nothing, the previous
file is left alone. Local run: python3 scripts/brief_picks.py
"""

import html
import json
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data/brief-picks.json'
FEED = 'https://rss.beehiiv.com/feeds/1BT4mvZXMo.xml'
EDITION_DAYS = 9            # Monday + Friday editions, with slack for a late send
KEEP_PAST_DAYS = 1          # a pick stays a day after so "happening now" can show

WD = {'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3,
      'friday': 4, 'saturday': 5, 'sunday': 6}
MONTHS = {m: i for i, m in enumerate(
    ['january', 'february', 'march', 'april', 'may', 'june', 'july',
     'august', 'september', 'october', 'november', 'december'], 1)}

# Links in the intro that are not events: his own pages, socials, the
# newsletter itself. Kept as a hostname test so a Meetup or Instagram event
# post (which IS an event) still passes on its calendar match.
OWN_HOSTS = re.compile(r'(^|\.)(btownbrief\.com|beehiiv\.com)$', re.I)
NEWS_PATH = re.compile(r'(sevendaysvt\.com/(news|music/musicnews|food-drink)|wcax\.com/\d{4}|vtdigger\.org/\d{4}|mychamplainvalley\.com/news)', re.I)
PROFILE_URL = re.compile(r'^https?://(www\.)?instagram\.com/[^/]+$', re.I)
NOT_EVENT_TEXT = re.compile(
    r'^(burlington right now|the brief|btown brief|read more|here|this|'
    r'the calendar|events? page|full (calendar|list))$', re.I)


def clean_url(u):
    """Strip the utm_ tags Beehiiv appends so intro and calendar links match."""
    try:
        parts = urlsplit(html.unescape(u.strip()))
    except ValueError:
        return u
    q = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
         if not k.lower().startswith('utm_')]
    path = parts.path.rstrip('/') or '/'
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path,
                       urlencode(q), ''))


def text_of(fragment):
    return html.unescape(re.sub(r'<[^>]+>', '', fragment)).strip()


def blocks(body):
    """Yield ('h', level, text) and ('p', html) in document order."""
    for m in re.finditer(r'<h([1-6])[^>]*>(.*?)</h\1>|<(?:p|li)[^>]*>(.*?)</(?:p|li)>',
                         body, re.S):
        if m.group(1):
            yield ('h', int(m.group(1)), text_of(m.group(2)))
        elif m.group(3) is not None:
            yield ('p', m.group(3))


def parse_time(s):
    m = re.match(r'\s*(\d{1,2})(?::(\d{2}))?\s*([AP])\.?M', s, re.I)
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2) or 0)
    if m.group(3).upper() == 'P' and h != 12:
        h += 12
    if m.group(3).upper() == 'A' and h == 12:
        h = 0
    return f'{h:02d}:{mi:02d}'


def parse_day_heading(txt):
    """'Friday, September 4, 2026' -> date."""
    m = re.match(r'(?:\w+,\s*)?(\w+)\s+(\d{1,2}),?\s*(\d{4})', txt.strip())
    if not m or m.group(1).lower() not in MONTHS:
        return None
    try:
        return date(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2)))
    except ValueError:
        return None


def parse_edition(item):
    """Return (meta, picks) for one RSS item, or (None, [])."""
    title = text_of(re.search(r'<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>', item, re.S).group(1))
    link = text_of((re.search(r'<link>(.*?)</link>', item, re.S) or [None, ''])[1])
    pub = re.search(r'<pubDate>(.*?)</pubDate>', item)
    try:
        pdt = parsedate_to_datetime(pub.group(1).strip())
    except (AttributeError, TypeError, ValueError):
        return None, []
    body = re.search(r'<content:encoded><!\[CDATA\[(.*?)\]\]></content:encoded>', item, re.S)
    if not body:
        return None, []
    body = body.group(1)
    issue_monday = pdt.date() - timedelta(days=pdt.weekday())

    # ---- calendar: url -> {time, venue, date, title}
    calendar = {}
    section = None      # 'intro' | 'events' | None
    day = None
    intro_paras = []    # (date, html)
    for kind, *rest in blocks(body):
        if kind == 'h':
            level, txt = rest
            if re.search(r'weather', txt, re.I) and level == 2:
                section = 'intro'
                continue
            if re.match(r'events?\b', txt, re.I) and level <= 2:
                section = 'events'
                day = None
                continue
            if section == 'events' and level == 3:
                day = parse_day_heading(txt)
                continue
            if level <= 2:
                section = None
            continue
        frag = rest[0]
        if section == 'intro':
            plain = text_of(frag)
            m = re.match(r'^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b', plain, re.I)
            if m:
                intro_paras.append((issue_monday + timedelta(days=WD[m.group(1).lower()]), frag))
            elif re.match(r'^(This weekend|The weekend|Weekend)\b', plain, re.I):
                intro_paras.append((issue_monday + timedelta(days=5), frag))
        elif section == 'events' and day:
            plain = text_of(frag)
            t = parse_time(plain)
            a = re.search(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', frag, re.S)
            if not a:
                continue
            after = text_of(frag[a.end():])
            vm = re.match(r'\s*at\s+(.+?)(?:\s*\(|\s*—|\s*-\s*\[|$)', after)
            venue = vm.group(1).strip().rstrip('.,') if vm else ''
            calendar.setdefault(clean_url(a.group(1)), {
                'time': t, 'venue': venue, 'date': day.isoformat(), 'title': text_of(a.group(2)),
            })

    # ---- picks: every link in the day paragraphs
    picks, seen = [], set()
    for d, frag in intro_paras:
        for a in re.finditer(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', frag, re.S):
            u = clean_url(a.group(1))
            name = text_of(a.group(2))
            name = re.sub(r'\s*\((?:\$|free)[^)]*\)\s*$', '', name, flags=re.I).strip()
            host = urlsplit(u).netloc
            if not name or len(name) < 4 or NOT_EVENT_TEXT.match(name):
                continue
            if OWN_HOSTS.search(host) and u not in calendar:
                continue
            if u in seen:
                continue
            seen.add(u)
            cal = calendar.get(u) or {}
            # A link the calendar doesn't know is only a pick if it reads like
            # an event name: "Sunday Polo Match" yes, "grandstand tickets",
            # "the block party", "Foam", or a news story no.
            if not cal:
                if name[0].islower() or len(name.split()) < 2:
                    continue
                if NEWS_PATH.search(u) or PROFILE_URL.match(u):
                    continue
            # prose links read mid-sentence ("the last South End Get Down of
            # the summer"); a card wants a name. After the filters above, which
            # use the lowercase start as a tell.
            name = re.sub(r'^(the|a|an)\s+', '', name, flags=re.I)
            name = name[:1].upper() + name[1:]
            # the calendar's own date wins when it has one — the paragraph is
            # about a day, but a Friday paragraph can mention Saturday's show
            pick_date = cal.get('date') or d.isoformat()
            picks.append({
                'name': name,
                'link': u,
                'start': pick_date,
                'time': cal.get('time'),
                'venue': cal.get('venue') or '',
                'edition': title,
                'editionUrl': link,
            })
    meta = {'title': title, 'url': link, 'date': pdt.date().isoformat()}
    return meta, picks


def main():
    req = urllib.request.Request(FEED, headers={'User-Agent': 'btown-brief-site/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            xml = res.read().decode('utf-8', 'replace')
    except Exception as e:  # noqa: BLE001
        print(f'brief-picks: fetch failed, keeping last good file: {e}', file=sys.stderr)
        return 1

    cutoff = datetime.now(timezone.utc) - timedelta(days=EDITION_DAYS)
    today = date.today()
    editions, picks, seen = [], [], set()
    for m in re.finditer(r'<item>(.*?)</item>', xml, re.S):
        item = m.group(1)
        pub = re.search(r'<pubDate>(.*?)</pubDate>', item)
        try:
            when = parsedate_to_datetime(pub.group(1).strip())
        except (AttributeError, TypeError, ValueError):
            continue
        if when < cutoff:
            continue
        meta, found = parse_edition(item)
        if not meta:
            continue
        editions.append(meta)
        for p in found:
            key = p['link']
            if key in seen:
                continue
            if date.fromisoformat(p['start']) < today - timedelta(days=KEEP_PAST_DAYS):
                continue
            seen.add(key)
            picks.append(p)

    if not picks:
        print('brief-picks: no picks parsed, keeping last good file', file=sys.stderr)
        return 1

    picks.sort(key=lambda p: (p['start'], p['time'] or '99:99', p['name']))
    out = {
        'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'editions': editions,
        'picks': picks,
    }
    try:
        previous = json.loads(OUT.read_text())
    except (OSError, ValueError):
        previous = {}
    if {k: v for k, v in out.items() if k != 'updated'} == \
       {k: v for k, v in previous.items() if k != 'updated'}:
        print('brief-picks.json: no content changes')
        return 0
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + '\n')
    timed = sum(1 for p in picks if p['time'])
    print(f'brief-picks.json: {len(picks)} picks ({timed} with a time) from {len(editions)} editions')
    return 0


if __name__ == '__main__':
    sys.exit(main())
