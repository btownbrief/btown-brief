#!/usr/bin/env python3
"""City construction-map changes plus nearby New England 511 events.

Construction labels prefer ``StreetName — PROJNAME`` because the live layer's
project name is often shared by many features (for example, one paving program
on several streets). A lone street or project name is used when only one exists.

Each upstream is optional. A failed sub-fetch is represented temporarily by
``None``; diff() replaces it with the previous sub-state before the orchestrator
stores the snapshot, preventing recovery from looking like a batch of new items.
"""

from datetime import datetime, timedelta, timezone

from ..common import event, get_json, iso, now_utc, parse_when

ID = "roads"
NAME = "City construction map"
CONSTRUCTION_NAME = "City construction map"
VT511_NAME = "New England 511"
CONSTRUCTION_URL = ("https://services1.arcgis.com/1bO0c7PxQdsGidPK/arcgis/rest/services/"
                    "Construction_and_Planning_Datasets_Public_View_v2/FeatureServer/2/"
                    "query?where=1%3D1&outFields=*&f=json&orderByFields="
                    "last_edited_date+DESC&resultRecordCount=50&returnGeometry=false")
VT511_URLS = (
    "https://newengland511.org/api/v2/get/event",
    "https://newengland511.org/api/v2/get/events",
)
DPW_URL = "https://www.burlingtonvt.gov/DPW"
AREA_WORDS = ("burlington", "south burlington", "winooski", "colchester",
              "i-89", "interstate 89", "us-7", "us 7", "vt-127", "vt 127")


def _epoch(value):
    if isinstance(value, (int, float)):
        return iso(datetime.fromtimestamp(value / 1000, tz=timezone.utc))
    dt = parse_when(value) if isinstance(value, str) else None
    return iso(dt) if dt else None


def _construction_snapshot():
    data = get_json(CONSTRUCTION_URL)
    items = []
    for feature in data.get("features", []):
        attrs = feature.get("attributes", {})
        item_id = attrs.get("GlobalID") or attrs.get("OBJECTID")
        if item_id is None:
            continue
        street = (attrs.get("StreetName") or "").strip()
        project = (attrs.get("PROJNAME") or attrs.get("PRJDESC") or
                   attrs.get("Description") or "").strip()
        name = " — ".join(dict.fromkeys(x for x in (street, project) if x))
        if not name:
            name = f"Construction project {item_id}"
        link = attrs.get("LINK") or DPW_URL
        if not isinstance(link, str) or not link.startswith("http"):
            link = DPW_URL
        items.append({
            "id": str(item_id), "name": name,
            "ts": _epoch(attrs.get("last_edited_date")), "url": link,
        })
    return {"items": items}


def _pick(obj, *names):
    for name in names:
        value = obj.get(name)
        if value not in (None, ""):
            return value
    return None


def _vt511_snapshot():
    last_error = None
    for url in VT511_URLS:
        try:
            data = get_json(url, headers={"Accept": "application/json"})
            break
        except RuntimeError as exc:
            last_error = exc
    else:
        raise last_error
    rows = data if isinstance(data, list) else _pick(data, "events", "Events", "items", "Items") or []
    items = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        road = str(_pick(row, "road", "Road", "roadName", "RoadName", "route", "Route") or "")
        description = str(_pick(row, "description", "Description", "headline", "Headline", "eventType", "EventType") or "")
        location = str(_pick(row, "location", "Location", "area", "Area", "county", "County") or "")
        searchable = " ".join((road, description, location)).lower()
        if not any(word in searchable for word in AREA_WORDS):
            continue
        item_id = _pick(row, "id", "Id", "ID", "eventId", "EventId")
        if item_id is None:
            item_id = f"{road}|{description}|{location}"
        kind_text = str(_pick(row, "eventType", "EventType", "type", "Type", "category", "Category") or description).lower()
        if any(word in kind_text for word in ("closure", "closed", "incident", "crash", "accident")):
            priority, event_kind = 3, "incident"
        else:
            priority, event_kind = 2, "roadwork"
        stamp = _pick(row, "updated", "Updated", "lastUpdated", "LastUpdated",
                      "startTime", "StartTime", "start", "Start")
        items.append({
            "id": str(item_id), "road": road or location or "Road alert",
            "description": description or location or event_kind,
            "ts": _epoch(stamp) if isinstance(stamp, (int, float)) else stamp,
            "priority": priority, "kind": event_kind,
            "url": str(_pick(row, "url", "Url", "URL") or "https://newengland511.org/"),
        })
    return {"items": items}


def snapshot():
    state = {"construction": None, "vt511": None}
    try:
        state["construction"] = _construction_snapshot()
    except (RuntimeError, ValueError, TypeError):
        pass
    try:
        state["vt511"] = _vt511_snapshot()
    except (RuntimeError, ValueError, TypeError):
        pass
    if state["construction"] is None and state["vt511"] is None:
        raise RuntimeError("both roads sources failed")
    return state


def diff(prev, cur, bootstrap):
    run_now = now_utc()
    cutoff = run_now - timedelta(hours=24)
    previous = prev or {}
    for key in ("construction", "vt511"):
        if cur.get(key) is None:
            cur[key] = previous.get(key, {"items": []})

    out = []
    old_construction = {item["id"]: item for item in previous.get("construction", {}).get("items", [])}
    for item in cur["construction"].get("items", []):
        old = old_construction.get(item["id"])
        stamp = parse_when(item.get("ts"))
        if old is None:
            if bootstrap and (stamp is None or stamp < cutoff):
                continue
            headline = f"New on the city construction map: {item['name']}"
        elif old.get("ts") != item.get("ts"):
            headline = f"{item['name']} construction update"
        else:
            continue
        out.append(event(
            ts=iso(stamp if stamp and stamp >= cutoff else run_now), category="roads",
            headline=headline, url=item["url"], source=ID,
            source_name=CONSTRUCTION_NAME, priority=2, kind="changed" if old else "added",
        ))

    old_511 = {item["id"] for item in previous.get("vt511", {}).get("items", [])}
    for item in cur["vt511"].get("items", []):
        if item["id"] in old_511:
            continue
        stamp = parse_when(item.get("ts"))
        if bootstrap and (stamp is None or stamp < cutoff):
            continue
        description = " ".join(item["description"].split())
        if len(description) > 100:
            description = description[:97].rstrip() + "…"
        out.append(event(
            ts=iso(stamp if stamp and stamp >= cutoff else run_now), category="roads",
            headline=f"{item['road']}: {description}", url=item["url"], source=ID,
            source_name=VT511_NAME, priority=item["priority"], kind="added",
        ))

    return sorted(out, key=lambda item: item["priority"], reverse=True)[:8]
