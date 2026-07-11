#!/usr/bin/env python3
"""City beach status transitions from Burlington's ArcGIS tracker."""

from datetime import datetime, timedelta

from ..common import BTV_TZ, event, get_json, iso, now_utc, parse_when

ID = "beach-status"
NAME = "City beach tracker"
URL = ("https://maps.burlingtonvt.gov/arcgis/rest/services/BTV_Beach_Status/"
       "MapServer/0/query?where=1%3D1&outFields=LocationName,"
       "CyanobacteriaDescription,ResultDateTime,DisplayOrder,Notes&"
       "returnGeometry=false&f=json")
PAGE_URL = "https://www.burlingtonvt.gov/1219/Beach-Closure-Tracker"
CLOSED_WORDS = ("closed", "advisory", "unsafe", "high alert")


def _result_time(value):
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, tz=BTV_TZ).astimezone(BTV_TZ)
    parsed = parse_when(value) if isinstance(value, str) else None
    if parsed:
        return parsed
    if value:
        try:
            return datetime.strptime(value, "%m/%d/%Y %I:%M %p").replace(tzinfo=BTV_TZ)
        except ValueError:
            pass
    return None


def snapshot():
    data = get_json(URL)
    beaches = {}
    for feature in data.get("features", []):
        attrs = feature.get("attributes", {})
        name = (attrs.get("LocationName") or "").strip()
        if not name:
            continue
        description = (attrs.get("CyanobacteriaDescription") or "").strip()
        notes = (attrs.get("Notes") or "").strip()
        text = " ".join((description, notes)).lower()
        stamp = _result_time(attrs.get("ResultDateTime"))
        beaches[name] = {
            "status": "closed" if any(word in text for word in CLOSED_WORDS) else "open",
            "reason": notes or description,
            "resultTime": iso(stamp) if stamp else None,
        }
    return {"beaches": beaches}


def diff(prev, cur, bootstrap):
    run_now = now_utc()
    cutoff = run_now - timedelta(hours=24)
    previous = {} if prev is None else prev.get("beaches", {})
    out = []
    for name, beach in cur.get("beaches", {}).items():
        before = previous.get(name)
        changed = before is not None and before.get("status") != beach.get("status")
        if bootstrap:
            changed = beach.get("status") == "closed"
        if not changed:
            continue
        result_time = parse_when(beach.get("resultTime"))
        if bootstrap and (result_time is None or result_time < cutoff):
            continue
        stamp = result_time if result_time and result_time >= cutoff else run_now
        reason = beach.get("reason", "")
        if beach.get("status") == "closed":
            headline = f"{name} closed"
            if reason:
                headline += f" — {reason[:100]}"
            detail = ""
        else:
            headline = f"{name} reopened"
            detail = reason
        out.append(event(
            ts=iso(stamp), category="lake", headline=headline, detail=detail,
            url=PAGE_URL, source=ID, source_name=NAME, priority=3, kind="status",
        ))
    return out
