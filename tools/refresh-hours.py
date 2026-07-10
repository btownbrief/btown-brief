#!/usr/bin/env python3
"""Refresh restaurant hours from Google Places.

Usage:
    export GOOGLE_MAPS_API_KEY=...   # or: set -a; source ~/btown-brief-prompts/secrets.env; set +a
    python3 tools/refresh-hours.py            # refresh entries older than 30 days
    python3 tools/refresh-hours.py --all      # refresh everything with a place_id

Updates data/restaurants.json in place: hours, business status (marks newly
closed places), and last_verified. Never writes the API key anywhere.
Costs roughly $0.02 per place refreshed (legacy Place Details).
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / 'data' / 'restaurants.json'
DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json'
FIELDS = 'opening_hours,business_status'

API_KEY = os.environ.get('GOOGLE_MAPS_API_KEY')
if not API_KEY:
    sys.exit('GOOGLE_MAPS_API_KEY not set (source secrets.env first)')


def periods_to_hours(periods):
    if not periods:
        return None
    hours = {}
    for p in periods:
        o, c = p.get('open'), p.get('close')
        if not o:
            continue
        od = DAYS[o['day']]
        ot = o['time'][:2] + ':' + o['time'][2:]
        if not c:
            hours.setdefault(od, []).append(['00:00', '24:00'])
            continue
        hours.setdefault(od, []).append([ot, c['time'][:2] + ':' + c['time'][2:]])
    for d in hours:
        hours[d].sort()
    return hours or None


def main():
    refresh_all = '--all' in sys.argv
    cutoff = (date.today() - timedelta(days=30)).isoformat()
    doc = json.loads(DATA.read_text())
    todo = [r for r in doc['restaurants']
            if not r.get('closed') and r.get('place_id')
            and (refresh_all or (r.get('last_verified') or '') < cutoff)]
    print(f'{len(todo)} places to refresh')
    changed = closed = 0
    for i, r in enumerate(todo):
        params = urllib.parse.urlencode({'place_id': r['place_id'], 'fields': FIELDS, 'key': API_KEY})
        try:
            with urllib.request.urlopen(f'{DETAILS_URL}?{params}', timeout=30) as resp:
                data = json.load(resp)
        except Exception as e:
            print(f'  ! {r["name"]}: {type(e).__name__}', file=sys.stderr)
            continue
        if data.get('status') != 'OK':
            print(f'  ! {r["name"]}: {data.get("status")}', file=sys.stderr)
            continue
        result = data['result']
        if result.get('business_status') == 'CLOSED_PERMANENTLY':
            r['closed'] = True
            closed += 1
            print(f'  ✝ {r["name"]} is permanently closed')
        else:
            new_hours = periods_to_hours((result.get('opening_hours') or {}).get('periods'))
            if new_hours and new_hours != r.get('hours'):
                r['hours'] = new_hours
                r['hours_confidence'] = 'google'
                changed += 1
                print(f'  ~ {r["name"]}: hours updated')
        r['last_verified'] = date.today().isoformat()
        time.sleep(0.12)
        if (i + 1) % 25 == 0:
            print(f'  … {i + 1}/{len(todo)}')
    doc['generated'] = date.today().isoformat()
    DATA.write_text(json.dumps(doc, indent=1, ensure_ascii=False))
    print(f'done: {changed} hour changes, {closed} closures, {len(todo)} re-verified')


if __name__ == '__main__':
    main()
