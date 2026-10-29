#!/usr/bin/env python3
"""Town app, Alerts > Signups: re-check every registration page.

    python3 -m scripts.town.signups            # -> data/town/signups-live.json

Reads the hand-kept list in data/town/signups.json and writes what the live
sources say right now. It never edits signups.json (one writer per file); when a
watched page changes, the program is flagged "changed_since_review": true so a person (or a
reviewed routine) re-reads it and updates signups.json.

Sections:
  civicrec   Burlington Parks + Burlington City Arts catalog on CivicRec (secure.rec1.com):
             every session with its registration window, straight from the catalog's JSON
  libcal     Fletcher Free Library events that take registration (next 60 days), plus storytimes
  pages      every other program page: visible-text fingerprint and the check_hint phrase
"""

import argparse
import hashlib
import http.cookiejar
import json
import os
import re
import sys
import urllib.request
from datetime import date, datetime

from .common import (BROWSER_UA, OUT_DIR, get_json, get_text, load_json, only_filter,
                     page_text, rec, run_sections)

SEED = os.path.join(OUT_DIR, "signups.json")
OUT = os.path.join(OUT_DIR, "signups-live.json")
REC1 = "https://secure.rec1.com/VT/burlington-vt"
REC1_SKIP_TABS = ("Rental", "Gift", "Scholarship", "Facilit", "Garden", "Pass")
LIBCAL = "https://fletcherfree.libcal.com/ajax/calendar/list?c=21587&date=0000-00-00&perpage=48&page={page}"
LIBCAL_PUBLIC = "https://fletcherfree.libcal.com/calendar?cid=21587"
MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


# ---------------------------------------------------------------- civicrec
class _Rec1:
    """CivicRec's catalog JSON needs the page's checkout key and its session cookie."""

    def __init__(self):
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def get(self, url, xhr=True):
        hdrs = {"User-Agent": BROWSER_UA}
        if xhr:
            hdrs["X-Requested-With"] = "XMLHttpRequest"
        with self.opener.open(urllib.request.Request(url, headers=hdrs), timeout=40) as r:
            return r.read().decode("utf-8", "replace")


def _parse_window(info_lines, reg_start):
    """'Registration: Oct 15 10a-Feb 19 3p' -> (opens, closes) ISO dates.
    regStart (MM/DD/YYYY) anchors the year; a close month earlier than the open month rolls over."""
    opens = None
    if reg_start:
        try:
            opens = datetime.strptime(reg_start, "%m/%d/%Y").date()
        except ValueError:
            opens = None
    line = next((x for x in info_lines or [] if x.lower().startswith("registration")), "")
    closes = None
    m = re.search(r"-\s*([A-Z][a-z]{2})\w*\s+(\d{1,2})", line)
    if m and opens:
        mon, day = MONTHS.get(m.group(1).lower()[:3]), int(m.group(2))
        if mon:
            year = opens.year + (1 if mon < opens.month else 0)
            try:
                closes = date(year, mon, day)
            except ValueError:
                closes = None
    return (opens.isoformat() if opens else None, closes.isoformat() if closes else None, line)


def civicrec(verified):
    s = _Rec1()
    page = s.get(f"{REC1}/catalog", xhr=False)
    m = re.search(r'checkoutData&quot;:\{&quot;key&quot;:&quot;([0-9a-f]+)', page) or \
        re.search(r'"checkoutData":\{"key":"([0-9a-f]+)', page)
    if not m:
        raise RuntimeError("CivicRec catalog page no longer exposes checkoutData.key")
    key = m.group(1)
    tabs = json.loads(s.get(f"{REC1}/catalog/getTabs/{key}"))["tabs"]
    items, seen = [], set()
    for t in tabs:
        if any(x in t["label"] for x in REC1_SKIP_TABS):
            continue
        data = json.loads(s.get(f"{REC1}/catalog/getItems/{key}/{t['id']}"))
        groups = [g for sec in data.get("sections", []) for g in sec.get("groups", [])] + data.get("groups", [])
        for g in groups:
            if g.get("type") != "activity" or g["id"] in seen:
                continue
            seen.add(g["id"])
            try:
                sess = json.loads(s.get(f"{REC1}/catalog/getActivitySessions/{key}/{t['id']}/{g['id']}"))
            except (ValueError, OSError):
                continue
            for it in sess.get("items", []):
                opens, closes, line = _parse_window(it.get("basicInfo"), it.get("regStart"))
                items.append(rec(f"{REC1}/catalog", verified,
                                 tab=t["label"], group_id=g["id"], program=g.get("name"),
                                 session=it.get("text"), registration_text=line or None,
                                 opens=opens, closes=closes,
                                 open_now=bool(it.get("registrationOpen")),
                                 closed=bool(it.get("registrationOver")),
                                 full=bool(it.get("sessionFull")),
                                 details=[x for x in (it.get("basicInfo") or []) if not x.lower().startswith("registration")][:3]))
    if not items:
        raise RuntimeError("CivicRec returned no sessions")
    today = date.today().isoformat()
    upcoming = sorted({i["opens"] for i in items if i["opens"] and i["opens"] >= today})
    return {"verified": verified, "groups": len(seen), "next_open_dates": upcoming[:10], "items": items}


# ---------------------------------------------------------------- libcal
def libcal(verified):
    events, page = [], 1
    while page <= 8:
        d = get_json(LIBCAL.format(page=page))
        res = d.get("results") or []
        events += res
        if len(events) >= int(d.get("total_results") or 0) or not res:
            break
        page += 1
    today = date.today()
    items = []
    for e in events:
        try:
            start = datetime.strptime(e["startdt"], "%Y-%m-%d %H:%M:%S")
        except (KeyError, ValueError):
            continue
        if (start.date() - today).days > 60:
            continue
        is_story = bool(re.search(r"story\s*time|storytime", e.get("title", ""), re.I))
        if not (e.get("registration_enabled") or is_story):
            continue
        items.append(rec(e.get("url") or LIBCAL_PUBLIC, verified,
                         title=e.get("title"), start=start.isoformat(), location=e.get("location"),
                         audiences=[a.get("name") for a in e.get("audiences") or []],
                         registration=("online" if e.get("online_registration") else
                                       "in person" if e.get("in_person_registration") else
                                       "required" if e.get("registration_enabled") else "drop-in"),
                         seats=e.get("seats"), seats_left=e.get("seatsleft"),
                         waitlist=bool(e.get("waitlist")), storytime=is_story))
    items.sort(key=lambda r: r["start"])
    return {"verified": verified, "total_events_listed": len(events), "items": items}


# ---------------------------------------------------------------- pages
DATEISH = re.compile(r"regist|enrol|lottery|deadline|opens?\b|closes?\b|sign[- ]?up|apply|waitlist|"
                     r"\b20[2-3]\d\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d", re.I)


def _fingerprint(text):
    """Hash only the sentences that talk about dates or registration, so rotating
    banners, nonces and news teasers don't flag a page as changed."""
    sentences = [x.strip() for x in re.split(r"(?<=[.!?])\s+|\s{2,}", text) if DATEISH.search(x)]
    return hashlib.sha256("\n".join(sorted(set(sentences))).encode()).hexdigest()[:16]


def pages(verified):
    seed = load_json(SEED, {}) or {}
    prev = {i["id"]: i for i in ((load_json(OUT, {}) or {}).get("sections", {}).get("pages", {}).get("items") or [])}
    items, fetched = [], {}
    for p in seed.get("programs", []):
        if p.get("recheck") != "page-watch":
            continue
        url = p["page"]
        entry = {"id": p["id"], "name": p["name"]}
        try:
            if url not in fetched:
                fetched[url] = page_text(get_text(url, browser=True, timeout=30))
            text = fetched[url]
            fp = _fingerprint(text)
            hint = p.get("check_hint") or ""
            hint_found = None
            if hint:  # hints are short phrases, some with "|" alternatives
                try:
                    hint_found = bool(re.search(hint, text, re.I))
                except re.error:
                    hint_found = hint.lower() in text.lower()
            old = prev.get(p["id"]) or {}
            baseline = p.get("reviewed_fingerprint")
            entry.update(fetch_ok=True, fingerprint=fp, hint=hint or None, hint_found=hint_found,
                         changed_since_review=bool(baseline) and baseline != fp,
                         changed_since_last_run=bool(old.get("fingerprint")) and old.get("fingerprint") != fp,
                         years_mentioned=sorted(set(re.findall(r"\b(202[6-9])\b", text))))
        except Exception as e:  # noqa: BLE001 — Cloudflare (ECHO, Flynn) and the YMCA's rate limit land here
            old = prev.get(p["id"]) or {}
            entry.update(fetch_ok=False, error=str(e)[:160], fingerprint=old.get("fingerprint"),
                         changed_since_review=None, needs_browser_check=True)
        items.append(rec(url, verified, **entry))
    return {"verified": verified,
            "notes": ("changed_since_review=true means the page's date and registration sentences differ from "
                      "the reviewed_fingerprint stored in data/town/signups.json: re-read the page, update that "
                      "program's dates and copy the new fingerprint into reviewed_fingerprint. It is a nudge, "
                      "not a fact."),
            "items": items}


SECTIONS = [("civicrec", civicrec), ("libcal", libcal), ("pages", pages)]


def main():
    ap = argparse.ArgumentParser(description="Refresh data/town/signups-live.json")
    ap.add_argument("--only", help="comma-separated section names")
    args = ap.parse_args()
    print("Town signups:")
    chosen = only_filter(args.only, SECTIONS)
    failed = run_sections(OUT, chosen, {"seed_file": "data/town/signups.json"})
    sys.exit(1 if failed == len(chosen) else 0)


if __name__ == "__main__":
    main()
