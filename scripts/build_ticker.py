#!/usr/bin/env python3
"""Build data/ticker.json — the shared news + events feed for the games.

Every game on play.btownbrief.com loads a scrolling ticker (via the shared
ticker.js widget) that mixes recent Btown Brief headlines with upcoming
Burlington events. This script assembles that feed from three sources:

  1. Headlines — the beehiiv RSS feed. Every "Local News" item from every
     edition published in the last 60 days, so the ticker always has two
     months of fresh headlines (the feed holds ~20 editions, which covers it).
  2. This week — data/events-week.json, the curated day-by-day event picks
     already pulled from the newsletter intro by refresh-data.yml. The ticker
     uses the first sentence of each day (it names the day's anchor event).
  3. Upcoming — data/calendar.json tentpoles plus the marquee events from
     data/events/events.json, selected with the same rules the things-to-do
     page uses for its Upcoming rail (see js/app.js renderEvents).

Run AFTER the newsletter/events refresh steps so the local JSON is current.
On RSS failure, or if extraction looks broken (<3 headlines), the last good
ticker.json is kept rather than overwritten — same policy as the other
refreshers. Local run: python3 scripts/build_ticker.py
"""

import html
import json
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FEED = 'https://rss.beehiiv.com/feeds/1BT4mvZXMo.xml'
MAX_AGE_DAYS = 60
MAX_HEADLINES = 300          # ~2 months of Local News runs under this
MAX_UPCOMING = 20

# Same junk filter the Church Street Runner news extractor used.
JUNK = re.compile(r'instagram|facebook|reddit|twitter|tiktok|subscribe|click here|read more|sign up|^post ', re.I)

# Ported from js/app.js renderEvents — keep the two in sync so the ticker
# shows the same Upcoming picks as the things-to-do rail.
MARQUEE = re.compile(r'festival|fair\b|fest\b|parade|marathon|block party|art hop|expo\b|fireworks|gala|carnival|regatta|tournament|opening night|premiere', re.I)
MARQUEE_VENUE = re.compile(r'waterfront park|the flynn|flynn (theat|center)|higher ground|champlain valley exp|shelburne museum|memorial auditorium|church st(reet)? marketplace|centennial field|midway lawn', re.I)
NOT_MARQUEE = re.compile(r'jobs? fair|career fair|health fair|vendor fair|job expo|hamfest|psychic|craft fair|blood drive', re.I)

MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def decode(s):
    s = re.sub(r'<[^>]+>', '', s)
    s = html.unescape(s)
    return re.sub(r'\s+', ' ', s).strip()


def short_date(iso):
    try:
        d = date.fromisoformat(iso)
        return f'{MON[d.month - 1]} {d.day}'
    except (TypeError, ValueError):
        return iso or ''


def load_json(rel, fallback):
    try:
        with open(ROOT / rel) as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        print(f'{rel}: unreadable ({e}), skipping', file=sys.stderr)
        return fallback


def fetch_headlines():
    """Local News items from every edition in the last MAX_AGE_DAYS days."""
    req = urllib.request.Request(FEED, headers={'User-Agent': 'btown-brief-site/1.0'})
    with urllib.request.urlopen(req, timeout=30) as res:
        xml = res.read().decode('utf-8', 'replace')

    cutoff = datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)
    headlines, latest = [], None

    for m in re.finditer(r'<item>(.*?)</item>', xml, re.S):
        item = m.group(1)
        pub = re.search(r'<pubDate>(.*?)</pubDate>', item)
        try:
            when = parsedate_to_datetime(pub.group(1).strip())
        except (AttributeError, TypeError, ValueError):
            continue
        if when < cutoff:
            continue

        t = re.search(r'<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>', item, re.S)
        u = re.search(r'<link>(.*?)</link>', item, re.S)
        title = decode(t.group(1)) if t else 'the latest Btown Brief'
        url = decode(u.group(1)) if u else 'https://www.btownbrief.com/'
        if latest is None:
            latest = {'title': title, 'url': url}

        body = re.search(r'<content:encoded><!\[CDATA\[(.*?)\]\]></content:encoded>', item, re.S)
        if not body:
            continue
        section = re.search(r'<h2[^>]*>[^<]*Local News.*?</h2>(.*?)<h[12][^>]*>', body.group(1), re.S)
        if not section:
            continue
        for a in re.finditer(r'<a[^>]*>(.*?)</a>', section.group(1), re.S):
            text = decode(a.group(1))
            if not 18 <= len(text) <= 110:
                continue
            if JUNK.search(text) or text in headlines:
                continue
            headlines.append(text)

    return headlines[:MAX_HEADLINES], latest


def build_week():
    """This week's curated picks: first sentence of each day paragraph."""
    data = load_json('data/events-week.json', {})
    out = []
    for day in data.get('days', []):
        full = (day.get('text') or '').strip()
        # Lead sentences name the day's anchor event — but some days open with
        # a short teaser ("Thursday is the marquee."), so keep taking sentences
        # until the item is substantial. A sentence ends at ". " followed by an
        # uppercase letter (so "8 p.m." and "$49.50" don't split it).
        sentences = re.split(r'(?<=\.)\s+(?=[A-Z])', full)
        text = ''
        for s in sentences:
            text = f'{text} {s}'.strip()
            if len(text) >= 110:
                break
        if len(text) > 200:
            text = text[:200].rsplit(' ', 1)[0] + '…'
        if text:
            out.append({'date': day.get('date'), 'label': day.get('label'), 'text': text})
    return out


def build_upcoming():
    """Tentpoles + marquee scraped events, same picks as the Upcoming rail."""
    today = date.today().isoformat()

    def not_past(d):
        return not d or d >= today

    tentpoles = [e for e in load_json('data/calendar.json', [])
                 if not e.get('hidden') and not_past(e.get('date'))]
    seen = {str(e.get('name') or '').lower()[:24] for e in tentpoles}

    marquee = []
    for e in load_json('data/events/events.json', {}).get('events', []):
        if e.get('status') != 'active' or not not_past(e.get('date')):
            continue
        if any(t in ('ongoing', 'series') for t in e.get('tags') or []):
            continue
        title = e.get('title') or ''
        if NOT_MARQUEE.search(title):
            continue
        if not (MARQUEE.search(title) or MARQUEE_VENUE.search(e.get('venue') or '')):
            continue
        key = title.lower()[:24]
        if key in seen:
            continue
        seen.add(key)
        marquee.append({
            'name': title,
            'date': e.get('date'),
            'date_display': short_date(e.get('date')),
            'note': ' · '.join(filter(None, [e.get('venue'), e.get('town')])),
        })

    both = tentpoles + marquee
    both.sort(key=lambda e: str(e.get('date') or ''))
    return [{'date': e.get('date'),
             'label': e.get('date_display') or short_date(e.get('date')),
             'text': e.get('name'),
             'note': e.get('note') or ''} for e in both[:MAX_UPCOMING]]


def main():
    try:
        headlines, latest = fetch_headlines()
    except Exception as e:
        print(f'RSS fetch failed, keeping last good ticker.json: {e}', file=sys.stderr)
        return
    if len(headlines) < 3:
        print(f'only {len(headlines)} headlines extracted — keeping last good ticker.json', file=sys.stderr)
        return

    ticker = {
        'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'latest': latest or {'title': 'the latest Btown Brief', 'url': 'https://www.btownbrief.com/'},
        'headlines': headlines,
        'week': build_week(),
        'upcoming': build_upcoming(),
    }
    # Don't churn a commit every run just because the timestamp moved.
    previous = load_json('data/ticker.json', {})
    if {k: v for k, v in ticker.items() if k != 'updated'} == \
       {k: v for k, v in previous.items() if k != 'updated'}:
        print('ticker.json: no content changes')
        return
    with open(ROOT / 'data/ticker.json', 'w') as f:
        json.dump(ticker, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print(f'ticker.json: {len(headlines)} headlines, {len(ticker["week"])} week days, '
          f'{len(ticker["upcoming"])} upcoming events — latest "{latest["title"]}"')


if __name__ == '__main__':
    main()
