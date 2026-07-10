#!/usr/bin/env python3
"""Burlington CivicClerk meeting additions and agenda postings."""

from datetime import timedelta

from ..common import BTV_TZ, event, get_json, iso, now_utc, parse_when

ID = "civicclerk"
NAME = "City meeting portal"
# NB: '$orderby=startDateTime desc' alone surfaces placeholder meetings a year
# out and never the coming week — always query a rolling date window instead.
API_ROOT = "https://burlingtonvt.api.civicclerk.com/v1/Events"
PAGE_ROOT = "https://burlingtonvt.portal.civicclerk.com"
BOOTSTRAP_BODIES = ("city council", "development review board", "planning commission")


def _window_url():
    start = (now_utc() - timedelta(days=2)).strftime("%Y-%m-%dT00:00:00Z")
    end = (now_utc() + timedelta(days=30)).strftime("%Y-%m-%dT00:00:00Z")
    return (f"{API_ROOT}?$filter=startDateTime%20ge%20{start}"
            f"%20and%20startDateTime%20le%20{end}"
            "&$orderby=startDateTime%20asc&$top=100")


def snapshot():
    data = get_json(_window_url(), headers={"Accept": "application/json"})
    meetings = {}
    for item in data.get("value", []):
        meeting_id = item.get("id")
        start = parse_when(item.get("startDateTime"))
        if meeting_id is None or start is None:
            continue
        published = item.get("publishedFiles") or []
        files = [str(f.get("name") or f.get("fileName")).strip()
                 for f in published if isinstance(f, dict) and (f.get("name") or f.get("fileName"))]
        agenda_file = item.get("agendaFile") or {}
        if agenda_file.get("fileName") and agenda_file["fileName"] not in files:
            files.append(agenda_file["fileName"])
        has_agenda_file = any(
            str(f.get("type") or "").lower().startswith("agenda")
            for f in published if isinstance(f, dict)
        )
        meetings[str(meeting_id)] = {
            "name": (item.get("eventName") or item.get("categoryName") or "City meeting").strip(),
            "start": iso(start),
            "hasAgenda": bool(item.get("hasAgenda") or agenda_file.get("fileName") or has_agenda_file),
            "files": files,
        }
    return {"meetings": meetings}


def _day(start):
    return parse_when(start).astimezone(BTV_TZ).strftime("%A, %b %-d")


def _url(meeting_id):
    return f"{PAGE_ROOT}/event/{meeting_id}/overview"


def diff(prev, cur, bootstrap):
    run_now = now_utc()
    old = {} if prev is None else prev.get("meetings", {})
    out = []
    for meeting_id, meeting in cur.get("meetings", {}).items():
        start = parse_when(meeting.get("start"))
        if start is None:
            continue
        name = meeting["name"]
        lower_name = name.lower()
        before = old.get(meeting_id)

        if bootstrap:
            if (run_now <= start <= run_now + timedelta(days=7)
                    and meeting.get("hasAgenda")
                    and any(body in lower_name for body in BOOTSTRAP_BODIES)):
                out.append(event(
                    ts=iso(run_now), category="cityhall",
                    headline=f"{name} scheduled for {_day(meeting['start'])}",
                    detail="agenda posted", url=_url(meeting_id), source=ID,
                    source_name=NAME, priority=2, kind="added",
                ))
            continue

        if before is None and start > run_now:
            out.append(event(
                ts=iso(run_now), category="cityhall",
                headline=f"{name} scheduled for {_day(meeting['start'])}",
                url=_url(meeting_id), source=ID, source_name=NAME,
                priority=2 if "city council" in lower_name else 1, kind="added",
            ))
            continue

        agenda_added = before is not None and (
            (not before.get("hasAgenda") and meeting.get("hasAgenda"))
            or len(meeting.get("files", [])) > len(before.get("files", []))
        )
        if agenda_added and start >= run_now - timedelta(days=2):
            out.append(event(
                ts=iso(run_now), category="cityhall", headline=f"{name} agenda posted",
                detail=f"meets {_day(meeting['start'])}", url=_url(meeting_id),
                source=ID, source_name=NAME,
                priority=3 if "city council" in lower_name else 2, kind="changed",
            ))
    return out[:5] if bootstrap else out
