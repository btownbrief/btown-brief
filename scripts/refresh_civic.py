#!/usr/bin/env python3
"""Refresh Burlington government meetings from the public CivicClerk API.

The API timestamps are UTC. They are converted with zoneinfo, and implausible
local hours are retained with time_uncertain=true rather than silently fixed.
School Board and NPA schedules are link-only: neither has a suitable stdlib
feed, and the city's robots-disallowed RSS endpoint is intentionally unused.
"""

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo


API_URL = "https://burlingtonvt.api.civicclerk.com/v1/Events"
PORTAL_URL = "https://burlingtonvt.portal.civicclerk.com/"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "civic.json")
USER_AGENT = "btownbrief.com civic calendar (BtownBrief@gmail.com)"
BTV_TZ = ZoneInfo("America/New_York")


FEED_BODIES = {
    "City Council": ("city-council", "Burlington City Council", "Meets on Mondays; dates vary month to month", "https://www.burlingtonvt.gov/413/City-Council", "https://www.cctv.org/watch-tv/series/burlington-city-council"),
    "City Council - Board of Finance": ("board-of-finance", "City Council — Board of Finance", "Meets as needed with the city budget calendar", "https://www.burlingtonvt.gov/822/Board-of-Finance", "https://www.cctv.org/watch-tv/series/burlington-city-council"),
    "City Council - Racial Equity, Inclusion, and Belonging": ("reib-committee", "City Council — Racial Equity, Inclusion & Belonging Committee", "Schedule varies; see posted meetings", "https://www.burlingtonvt.gov/494/Standing-Committees", "https://www.cctv.org/watch-tv/series/burlington-city-council"),
    "Transportation, Energy, and Utilities Committee": ("teuc", "Transportation, Energy & Utilities Committee", "Schedule varies; see posted meetings", "https://www.burlingtonvt.gov/494/Standing-Committees", "https://www.cctv.org/watch-tv/series/burlington-city-council"),
    "Planning Commission": ("planning-commission", "Burlington Planning Commission", "Usually 2nd & 4th Tuesday, 6:30pm", "https://www.burlingtonvt.gov/796/Burlington-Planning-Commission", "https://www.cctv.org/watch-tv/series/burlington-planning-commission"),
    "Development Review Board": ("drb", "Development Review Board", "Usually 2nd & 4th Tuesday evenings", "https://www.burlingtonvt.gov/581/Development-Review-Board", "https://www.cctv.org/watch-tv/series/burlington-development-review-board"),
    "Design Advisory Board": ("design-advisory-board", "Design Advisory Board", "Schedule varies; see posted meetings", "https://www.burlingtonvt.gov/760/Design-Advisory-Board", "https://www.cctv.org/watch-tv/series/burlington-design-advisory-board"),
    "Parks & Recreation Commission": ("parks-rec-commission", "Parks & Recreation Commission", "Schedule varies; see posted meetings", "https://www.burlingtonvt.gov/763/Parks-Recreation-Commission", "https://www.cctv.org/watch-tv/series/burlington-parks-recreation-commission"),
    "Police Commission": ("police-commission", "Police Commission", "4th Tuesday, 6:00pm", "https://www.burlingtonvt.gov/414/Police-Commission", "https://www.burlingtonvt.gov/883/Police-Commission-Meetings-on-YouTube"),
    "Retirement Board": ("retirement-board", "Retirement Board", "Schedule varies; see posted meetings", PORTAL_URL, None),
    "Advisory Committee on Accessibility": ("accessibility-committee", "Advisory Committee on Accessibility", "Schedule varies; see posted meetings", "https://www.burlingtonvt.gov/412/Public-Boards-Commissions-Committees", None),
    "Housing Board of Review": ("housing-board-review", "Housing Board of Review", "Schedule varies; see posted meetings", "https://www.burlingtonvt.gov/412/Public-Boards-Commissions-Committees", None),
}


STATIC_BODIES = [
    {"id": "school-board", "name": "Burlington Board of School Commissioners", "typical_schedule": "Usually 1st & 3rd Tuesday, 6:00pm — confirm in the live portal", "source_url": "https://www.bsdvt.org/school-board/agendaminutes/", "video_url": "https://www.mediafactory.org/bsd", "in_feed": False},
    {"id": "npa-ward1", "name": "Ward 1 NPA", "typical_schedule": "2nd Wednesday, 6:30–8:30pm", "source_url": "https://www.burlingtonvt.gov/223/Ward-1", "video_url": "https://www.cctv.org/watch-tv/series/burlington-neighborhood-planning-assemblies-npa-meetings", "in_feed": False},
    {"id": "npa-ward2", "name": "Ward 2 NPA", "typical_schedule": "2nd Thursday, 6:30–8:30pm (dinner 5:30pm)", "source_url": "https://www.burlingtonvt.gov/225/Ward-2", "video_url": "https://www.cctv.org/watch-tv/series/burlington-neighborhood-planning-assemblies-npa-meetings", "in_feed": False},
    {"id": "npa-ward3", "name": "Ward 3 NPA", "typical_schedule": "1st Wednesday, 6:30–8:30pm", "source_url": "https://www.burlingtonvt.gov/769/Ward-3", "video_url": "https://www.cctv.org/watch-tv/series/burlington-neighborhood-planning-assemblies-npa-meetings", "in_feed": False},
    {"id": "npa-ward4-7", "name": "Wards 4 & 7 NPA", "typical_schedule": "4th Wednesday, 6:30–8:30pm (dinner 6:00pm)", "source_url": "https://www.burlingtonvt.gov/226/Wards-4-7", "video_url": "https://www.cctv.org/watch-tv/series/burlington-neighborhood-planning-assemblies-npa-meetings", "in_feed": False},
    {"id": "npa-ward5", "name": "Ward 5 NPA", "typical_schedule": "3rd Thursday, 7:00–8:30pm (dinner 6:30pm)", "source_url": "https://www.burlingtonvt.gov/227/Ward-5", "video_url": "https://www.cctv.org/watch-tv/series/burlington-neighborhood-planning-assemblies-npa-meetings", "in_feed": False},
    {"id": "npa-ward6", "name": "Ward 6 NPA", "typical_schedule": "Schedule not confirmed — check the city NPA page", "source_url": "https://www.burlingtonvt.gov/219/Neighborhood-Planning-Assemblies", "video_url": "https://www.cctv.org/watch-tv/series/burlington-neighborhood-planning-assemblies-npa-meetings", "in_feed": False},
    {"id": "npa-ward8", "name": "Ward 8 NPA", "typical_schedule": "Schedule not confirmed — check the city NPA page", "source_url": "https://www.burlingtonvt.gov/219/Neighborhood-Planning-Assemblies", "video_url": "https://www.cctv.org/watch-tv/series/burlington-neighborhood-planning-assemblies-npa-meetings", "in_feed": False},
]


def slugify(value):
    return re.sub(r"[^a-z0-9]+", "-", (value or "meeting").lower()).strip("-")


def parse_api_time(value):
    """Return an aware Burlington datetime and the explicit sanity flag."""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    local = parsed.astimezone(BTV_TZ)
    wall_time = local.timetz().replace(tzinfo=None)
    return local, wall_time < time(8) or wall_time > time(22)


def location_text(value):
    if isinstance(value, str):
        return re.sub(r"\s+", " ", value).strip() or None
    if isinstance(value, dict):
        pieces = []
        for key in ("name", "address1", "address2", "city", "state", "zipCode"):
            if value.get(key) and value[key] not in pieces:
                pieces.append(str(value[key]).strip())
        return ", ".join(pieces) or None
    return None


def file_url(value):
    if not value:
        return None
    return urllib.parse.urljoin("https://burlingtonvt.api.civicclerk.com/", str(value))


def document_links(event):
    links = {"agenda_url": None, "packet_url": None, "minutes_url": None}
    for item in event.get("publishedFiles") or []:
        if not isinstance(item, dict):
            continue
        label = " ".join(str(item.get(key) or "") for key in ("name", "fileName", "title", "documentType")).lower()
        raw_url = next((item.get(key) for key in ("url", "fileUrl", "streamUrl", "path") if item.get(key)), None)
        url = file_url(raw_url)
        if not url:
            continue
        if "minute" in label:
            links["minutes_url"] = url
        elif "packet" in label:
            links["packet_url"] = url
        elif "agenda" in label:
            links["agenda_url"] = url
    if not links["agenda_url"] and event.get("hasAgenda") and event.get("id") is not None:
        links["agenda_url"] = PORTAL_URL + "event/{}/files".format(event["id"])
    return links


def body_for(category):
    if category in FEED_BODIES:
        return FEED_BODIES[category]
    if "parks" in (category or "").lower() and "commission" in category.lower():
        return FEED_BODIES["Parks & Recreation Commission"]
    if (category or "").startswith("City Council - "):
        return ("city-council-" + slugify(category[15:]), category.replace(" - ", " — ", 1), "Schedule varies; see posted meetings", "https://www.burlingtonvt.gov/494/Standing-Committees", "https://www.cctv.org/watch-tv/series/burlington-city-council")
    return (slugify(category), category or "City government meeting", "Schedule varies; see posted meetings", "https://www.burlingtonvt.gov/412/Public-Boards-Commissions-Committees", None)


def video_url(event):
    video_id = event.get("youtubeVideoId")
    if video_id:
        return "https://www.youtube.com/watch?v=" + urllib.parse.quote(str(video_id))
    url = event.get("externalMediaUrl")
    return url if isinstance(url, str) and url.startswith(("http://", "https://")) else None


def fetch_events(start):
    params = {
        "$filter": "startDateTime ge {}".format(start.astimezone(timezone.utc).isoformat(timespec="seconds")),
        "$orderby": "startDateTime asc",
        "$top": "500",
    }
    url = API_URL + "?" + urllib.parse.urlencode(params)
    events = []
    while url:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
        events.extend(payload.get("value") or [])
        url = payload.get("@odata.nextLink")
    return events


def prior_summaries():
    try:
        with open(OUT, encoding="utf-8") as handle:
            old = json.load(handle)
    except (OSError, ValueError, TypeError):
        return {}
    return {(item.get("body_id"), item.get("title"), item.get("start")): (item.get("summary_text"), item.get("summary_status", "pending")) for section in ("upcoming", "past") for item in old.get(section, [])}


def main():
    now = datetime.now(BTV_TZ)
    window_start = now - timedelta(days=30)
    window_end = now + timedelta(days=60)
    try:
        raw_events = fetch_events(window_start)
    except Exception as exc:
        print("CivicClerk fetch failed; data/civic.json left untouched: {}".format(exc), file=sys.stderr)
        return 1

    summaries = prior_summaries()
    meetings = []
    seen_bodies = {}
    for event in raw_events:
        if not event.get("startDateTime") or not event.get("categoryName"):
            continue
        local, uncertain = parse_api_time(event["startDateTime"])
        if local < window_start or local > window_end:
            continue
        body_id, body_name, typical, source, body_video = body_for(event["categoryName"])
        seen_bodies[body_id] = {"id": body_id, "name": body_name, "typical_schedule": typical, "source_url": source, "video_url": body_video, "in_feed": True}
        title = event.get("eventName") or body_name
        start = local.isoformat(timespec="seconds")
        summary = summaries.get((body_id, title, start), (None, "pending"))
        meeting = {
            "body": body_name, "body_id": body_id, "title": title, "start": start,
            "time_uncertain": uncertain, "venue": location_text(event.get("eventLocation")),
            "agenda_url": None, "packet_url": None, "minutes_url": None,
            "video_url": video_url(event), "summary_text": summary[0], "summary_status": summary[1],
        }
        meeting.update(document_links(event))
        meetings.append(meeting)

    upcoming = [item for item in meetings if datetime.fromisoformat(item["start"]) >= now]
    past = [item for item in meetings if datetime.fromisoformat(item["start"]) < now]
    upcoming.sort(key=lambda item: item["start"])
    past.sort(key=lambda item: item["start"], reverse=True)

    configured = {}
    for row in FEED_BODIES.values():
        body_id, name, typical, source, body_video = row
        configured[body_id] = {"id": body_id, "name": name, "typical_schedule": typical, "source_url": source, "video_url": body_video, "in_feed": True}
    configured.update(seen_bodies)
    bodies = sorted(configured.values(), key=lambda item: item["name"])
    bodies.extend(STATIC_BODIES)

    output = {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "upcoming": upcoming, "past": past, "bodies": bodies}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    print("wrote {} ({} upcoming, {} past, {} bodies)".format(os.path.relpath(OUT), len(upcoming), len(past), len(bodies)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
