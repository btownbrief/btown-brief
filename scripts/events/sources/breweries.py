"""Chittenden County brewery/cidery/vineyard event calendars.

One module sweeps every local brewery that publishes a scrapeable calendar;
each gets its own adapter so one broken site can't kill the rest.

Working adapters (methods verified 2026-07):
  Foam Brewers            server-rendered Webflow CMS cards on /events
  Switchback Brewing      Squarespace events collection /beer-garden-events?format=json
  Burlington Beer Co      Squarespace events collection /bbcoevents?format=json
  Shelburne Vineyard      Squarespace events collection /events-list?format=json
  Fiddlehead Brewing      WordPress "The Events Calendar" REST API

Deliberately skipped (no scrapeable public calendar — see fetch report):
  Zero Gravity, Citizen Cider, Queen City, Four Quarters (stale page),
  1st Republic (Weebly, no events page)  -> Instagram/Facebook only.
  Simple Roots closed (Oct 2025).  Stone Corral blocks non-browser clients.
"""
from __future__ import annotations

import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import common
from common import TZ

SOURCE = "breweries"
LABEL = "Breweries & Taprooms"

_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday",
             "saturday", "sunday"]

# Explicit-free phrases only — never default price to Free.
_FREE_PHRASES = re.compile(
    r"free (?:admission|entry|show|event|concert|to attend|and open|& open)"
    r"|admission is free|no cover", re.I)


def _explicit_price(text: str | None) -> str | None:
    """Pull an explicit price statement out of blurb text, else None."""
    if not text:
        return None
    m = _FREE_PHRASES.search(text)
    if m:
        return m.group(0)
    dollars = re.findall(r"\$\s?\d+(?:\.\d{2})?(?:\s*(?:adv|dos|door|advance|day of|suggested))?",
                         text, re.I)
    if dollars:
        return " / ".join(dollars[:3])
    return None


def _weekly_stated(text: str, start_dt: datetime) -> bool:
    """True only when the blurb explicitly states a weekly repeat on the
    series' start weekday (e.g. 'every Wednesday', 'Wednesdays', or the
    weekday named alongside 'weekly')."""
    wd = _WEEKDAYS[start_dt.weekday()]
    if re.search(rf"every {wd}|\b{wd}s\b", text, re.I):
        return True
    return bool(re.search(rf"\b{wd}\b", text, re.I)
                and re.search(r"\bweekly\b", text, re.I))


def _expand_span(title: str, blurb: str, start: datetime, end: datetime | None,
                 lo: date, hi: date, who: str) -> list[tuple[datetime | date, str | None]]:
    """One source listing -> [(occurrence_start, recurring_text)].

    Single-day (or overnight) events pass through. Short spans (2-4 days,
    e.g. a weekend fest) emit one occurrence per day. Long spans expand
    weekly ONLY when the text states the weekly day; otherwise skipped —
    we never emit occurrences the source doesn't verify.
    """
    if end is None:
        return [(start, None)]
    days = (end.date() - start.date()).days
    if days <= 0 or (days == 1 and end.hour < 6):  # overnight show ends after midnight
        return [(start, None)]
    span_txt = f"{start.strftime('%b %-d')} – {end.strftime('%b %-d, %Y')}"
    if days <= 3:
        out: list[tuple[datetime | date, str | None]] = []
        d = start.date()
        while d <= end.date():
            if lo <= d <= hi:
                out.append((start if d == start.date() else d,
                            f"Multi-day: {span_txt}"))
            d += timedelta(days=1)
        return out
    if _weekly_stated(f"{title} {blurb}", start):
        wd_name = _WEEKDAYS[start.weekday()].capitalize()
        out = []
        d = start.date()
        while d <= min(end.date(), hi):
            if d >= lo:
                out.append((start.replace(year=d.year, month=d.month, day=d.day),
                            f"Weekly on {wd_name}s through {end.strftime('%b %-d')}"))
            d += timedelta(days=7)
        return out
    common.log(f"  breweries/{who}: skipping unexpandable {days}-day span: "
               f"{title!r} ({span_txt})")
    return []


# ------------------------------------------------------- Squarespace events

def _sqsp_events(base: str, path: str, *, venue: str, town: str,
                 lo: date, hi: date, who: str) -> list[dict]:
    """Squarespace events collection -> events (JSON at <path>?format=json)."""
    data = common.fetch_json(f"{base}{path}?format=json")
    upcoming = data.get("upcoming") or []
    if len(upcoming) >= 30:
        common.log(f"  breweries/{who}: 30+ upcoming items — page may be truncated")
    out: list[dict] = []
    for item in upcoming:
        try:
            title = common.strip_tags(item.get("title") or "")
            full = item.get("fullUrl") or ""
            if not title or not full:
                continue
            url = full if full.startswith("http") else base + full
            start = datetime.fromtimestamp(item["startDate"] // 1000, TZ)
            end = (datetime.fromtimestamp(item["endDate"] // 1000, TZ)
                   if item.get("endDate") else None)
            excerpt = common.strip_tags(item.get("excerpt") or "")
            loc = item.get("location") or {}
            address = ", ".join(filter(None, [loc.get("addressLine1"),
                                              loc.get("addressLine2")])) or None
            for occ, recurring in _expand_span(title, excerpt, start, end, lo, hi, who):
                occ_end = end if (recurring is None and end
                                  and (end - start) <= timedelta(hours=12)) else None
                out.append(common.make_event(
                    source=SOURCE, title=title, url=url,
                    start=occ, end=occ_end if isinstance(occ, datetime) else None,
                    venue=venue, address=address, town=town,
                    price=_explicit_price(f"{title} {excerpt}"),
                    description=excerpt or None, recurring=recurring))
        except Exception as e:
            common.log(f"  breweries/{who}: item failed ({e})")
    return out


# ------------------------------------------------------------------ adapters

def _foam(lo: date, hi: date) -> list[dict]:
    """Foam Brewers — Webflow CMS event cards, fully server-rendered."""
    base = "https://foambrewers.com"
    page = common.fetch(f"{base}/events")
    out, seen = [], set()
    for chunk in page.split('class="event-list-item"')[1:]:
        try:
            href = re.search(r'href="(/events/[^"]+)"', chunk)
            title = re.search(r'<h4 class="bold-heading">([^<]+)</h4>', chunk)
            datem = re.search(
                r'(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+'
                r'(\w+) (\d{1,2}), (\d{4})', chunk)
            if not (href and title and datem):
                continue
            head = chunk[:title.start()]           # date/time block precedes title
            locm = re.search(r'fs-cmsfilter-field="location"[^>]*>([^<]+)<', chunk)
            location = (locm.group(1).strip() if locm else "")
            if re.search(r"offsite", location, re.I):
                continue                            # not at the brewery; venue unknown
            d = datetime.strptime(" ".join(datem.groups()), "%B %d %Y").date()
            if not (lo <= d <= hi):
                continue
            key = (href.group(1), d)
            if key in seen:
                continue
            seen.add(key)
            hm = common.parse_time_str(head)
            pricem = re.search(r'class="text-color-white price">([^<]*)<', chunk)
            descm = re.search(
                r'<p class="text-color-white margin-bottom margin-small">([^<]*)</p>', chunk)
            out.append(common.make_event(
                source=SOURCE,
                title=common.strip_tags(title.group(1)),
                url=base + href.group(1),
                start=common.local_dt(d, hm),
                venue="Foam Brewers", town="Burlington",
                price=(common.strip_tags(pricem.group(1)) or None) if pricem else None,
                description=common.strip_tags(descm.group(1)) if descm else None))
        except Exception as e:
            common.log(f"  breweries/foam: card failed ({e})")
    return out


def _switchback(lo: date, hi: date) -> list[dict]:
    return _sqsp_events("https://www.switchbackvt.com", "/beer-garden-events",
                        venue="Switchback Brewing Company", town="Burlington",
                        lo=lo, hi=hi, who="switchback")


def _burlington_beer(lo: date, hi: date) -> list[dict]:
    return _sqsp_events("https://burlingtonbeercompany.com", "/bbcoevents",
                        venue="Burlington Beer Company", town="Burlington",
                        lo=lo, hi=hi, who="burlingtonbeer")


def _shelburne_vineyard(lo: date, hi: date) -> list[dict]:
    return _sqsp_events("https://shelburnevineyard.com", "/events-list",
                        venue="Shelburne Vineyard", town="Shelburne",
                        lo=lo, hi=hi, who="shelburnevineyard")


def _fiddlehead(lo: date, hi: date) -> list[dict]:
    """Fiddlehead Brewing — WordPress 'The Events Calendar' REST API."""
    base = "https://fiddleheadbrewing.com"
    out: list[dict] = []
    page = 1
    while page <= 10:
        data = common.fetch_json(
            f"{base}/wp-json/tribe/events/v1/events"
            f"?start_date={lo.isoformat()}&end_date={hi.isoformat()}"
            f"&per_page=50&page={page}")
        for ev in data.get("events", []):
            try:
                title = common.strip_tags(ev.get("title") or "")
                url = ev.get("url")
                if not title or not url:
                    continue
                if ev.get("all_day"):
                    start = date.fromisoformat(ev["start_date"][:10])
                    end = None
                else:
                    start = common.parse_iso(ev["start_date"].replace(" ", "T"))
                    end = (common.parse_iso(ev["end_date"].replace(" ", "T"))
                           if ev.get("end_date") else None)
                venue_info = ev.get("venue") or {}
                out.append(common.make_event(
                    source=SOURCE, title=title, url=url, start=start, end=end,
                    venue="Fiddlehead Brewing Company",
                    address=venue_info.get("address"),
                    town=venue_info.get("city") or "Shelburne",
                    price=(ev.get("cost") or "").strip() or None,
                    description=ev.get("description")))
            except Exception as e:
                common.log(f"  breweries/fiddlehead: item failed ({e})")
        if page >= int(data.get("total_pages") or 1):
            break
        page += 1
    return out


ADAPTERS = {
    "foam": _foam,
    "switchback": _switchback,
    "burlingtonbeer": _burlington_beer,
    "shelburnevineyard": _shelburne_vineyard,
    "fiddlehead": _fiddlehead,
}


def fetch(window_start: date, window_end: date) -> list[dict]:
    events: list[dict] = []
    failures: list[str] = []
    lo_iso, hi_iso = window_start.isoformat(), window_end.isoformat()
    for name, adapter in ADAPTERS.items():
        try:
            got = [e for e in adapter(window_start, window_end)
                   if lo_iso <= e["date"] <= hi_iso]
            events.extend(got)
            common.log(f"  breweries/{name}: {len(got)} events")
        except Exception as e:
            failures.append(name)
            common.log(f"  breweries/{name}: FAILED ({e})")
    if failures and len(failures) == len(ADAPTERS):
        raise RuntimeError(f"all brewery adapters failed: {', '.join(failures)}")
    return events
