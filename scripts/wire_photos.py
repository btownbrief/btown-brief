#!/usr/bin/env python3
"""The Wire's world photos: picture feeds whose picture IS the story.

Stephen, 2026-10-19: "Photos 'Everything': no generic headline photos, only
images that are the story." The Photos tab's Everything view draws from a few
curated picture feeds, never from news thumbnails:

  The Atlantic (In Focus)   the photo desk: Photos of the Week, contests, scenes
  The Guardian              Photos of the day, picked by its picture editors
  NASA APOD                 the Astronomy Picture of the Day
  NASA Earth Observatory    the Earth Observatory's image of the day

AP and Reuters publish no public feed of their photos of the week (both
dropped RSS; their picture pages refuse plain HTTP, 2026-10-19). The
Atlantic's Photos of the Week and the Guardian's Photos of the day are built
from AP, Reuters and Getty pictures, so they stand in for them.

Each item keeps the publisher's own image URL from the feed, hotlinked the way
the Pulse's thumbnails and the Instagram posts are (the page loads it with
referrerpolicy=no-referrer and drops the card if it fails). Nothing is ever
downloaded or re-hosted. Every item links out to the publisher's page and
carries the credit the feed gives.

refresh_pulse.py calls refresh() each run. The feeds post about once a day,
so they are fetched at most every FETCH_EVERY_MINUTES; between fetches the
held store stands. The store lives in pulse.json under its own `photos` key,
so pages that predate it never see it:

  "photos": {"checked": "...", "fetched": "...",
             "sources": {"nasa-apod": {"name": "NASA APOD", "site": "...",
                                       "ok": true, "n": 7}, ...},
             "items": [{"id", "src", "name", "title", "url", "image",
                        "credit"?, "alt"?, "posted_at", "d"}, ...]}   newest first

curate_wire.py turns it into the day's `photos_world`. This module never
raises into refresh_pulse: a dead feed keeps its held items and says so.

CLI:
  --selftest       run the offline checks and exit
  --print          fetch every feed now and print what came back
"""

import html
import json
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import wire_common as wc

UA = "btown-brief-site/1.0 (wire photos)"
FETCH_EVERY_MINUTES = 60
KEEP_DAYS = 14             # the store; the page shows the last PHOTOS_WORLD_DAYS (curate_wire)
CAP = 120
TITLE_MAX = 200
CREDIT_MAX = 160
ALT_MAX = 300
IMAGE_WIDTH = 1600         # NASA's image service resizes on request; a phone needs no more

# (id, display name, feed URL, site, only items in this category or None)
FEEDS = [
    ("atlantic-in-focus", "The Atlantic", "https://www.theatlantic.com/feed/channel/photography/",
     "https://www.theatlantic.com/photography/", None),
    ("guardian-photos-of-the-day", "The Guardian",
     "https://www.theguardian.com/news/series/ten-best-photographs-of-the-day/rss",
     "https://www.theguardian.com/news/series/ten-best-photographs-of-the-day", None),
    # apod.nasa.gov/apod.rss now answers with the APOD web page, not a feed
    # (APOD moved to science.nasa.gov in 2026); this is the moved feed.
    ("nasa-apod", "NASA APOD", "https://science.nasa.gov/feed/apod-basic/",
     "https://science.nasa.gov/apod/", None),
    # the old Earth Observatory feed URL redirects to a NASA Science feed that
    # also carries Photojournal posts; only Earth Observatory's are kept
    ("nasa-earth-observatory", "NASA Earth Observatory",
     "https://earthobservatory.nasa.gov/feeds/image-of-the-day.rss",
     "https://science.nasa.gov/earth/earth-observatory/", "Earth Observatory"),
]

ATOM = "{http://www.w3.org/2005/Atom}"
MEDIA = "{http://search.yahoo.com/mrss/}"
CONTENT = "{http://purl.org/rss/1.0/modules/content/}encoded"
APOD = "{https://science.nasa.gov/apod/}"
IMG_RE = re.compile(r"<img\b[^>]*>", re.I)
ATTR_RE = re.compile(r'\b(src|alt)\s*=\s*"([^"]*)"', re.I)
CREDIT_RE = re.compile(r'<div class="credit">(.*?)</div>', re.I | re.S)
TAG_RE = re.compile(r"<[^>]+>")
INLINE_TAG_RE = re.compile(r"</?(?:a|em|i|b|strong|span|small)\b[^>]*>", re.I)
# APOD's stock alt text for a picture nobody described
NO_ALT_RE = re.compile(r"^see explanation", re.I)
# NASA's WordPress feeds ship `xmlns:apod="…"xmlns:media="…"` with no space
# between the two declarations, which no XML parser accepts (2026-10-19)
GLUED_NS_RE = re.compile(rb'"(xmlns:)')
TRACKING = {"utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"}


def text_of(value, limit):
    value = html.unescape(value or "")
    value = html.unescape(TAG_RE.sub(" ", INLINE_TAG_RE.sub("", value)))
    return wc.trim(value, limit)


def clean_url(url):
    """https only, no tracking params, entities decoded."""
    url = html.unescape((url or "").strip())
    if not url.startswith("https://"):
        return ""
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:
        return ""
    query = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
             if k.lower() not in TRACKING]
    path = urllib.parse.quote(parts.path, safe="/%:@!$&()*+,;=~-._")
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, path,
                                    urllib.parse.urlencode(query), ""))


def sized(url):
    """NASA's image service (assets.science.nasa.gov/dynamicimage) serves any
    width on request: ask for a phone-sized one instead of the 7,200-pixel
    original. Every other URL is left exactly as the publisher gave it."""
    if "assets.science.nasa.gov/dynamicimage/" not in url:
        return url
    parts = urllib.parse.urlsplit(url)
    query = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query) if k not in ("w", "h")]
    query.insert(0, ("w", str(IMAGE_WIDTH)))
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path,
                                    urllib.parse.urlencode(query), ""))


def parse_time(value):
    value = (value or "").strip()
    if not value:
        return None
    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def first_img(markup):
    """(src, alt) of the first <img> in an HTML body, or ("", "")."""
    for tag in IMG_RE.findall(markup or ""):
        attrs = {k.lower(): v for k, v in ATTR_RE.findall(tag)}
        src = clean_url(attrs.get("src"))
        if src and not src.lower().split("?")[0].endswith((".svg", ".gif")):
            return src, html.unescape(attrs.get("alt") or "")
    return "", ""


def widest_media(node):
    best, best_w, credit = "", -1, ""
    for media in node.findall(MEDIA + "content") + node.findall(MEDIA + "thumbnail"):
        kind, medium = media.get("type") or "", media.get("medium") or ""
        if kind and not kind.startswith("image") and medium != "image":
            continue
        try:
            width = int(media.get("width") or 0)
        except ValueError:
            width = 0
        url = clean_url(media.get("url"))
        if url and width > best_w:
            best, best_w = url, width
            credit = media.findtext(MEDIA + "credit") or credit
    return best, credit


def parse(raw, category=None):
    """One feed (RSS 2 or Atom) -> [{title, url, image, credit, alt, d}].
    Items without a picture, a link or a date are left out: a photo feed's
    item with no picture is a video or a text post."""
    root = ET.fromstring(GLUED_NS_RE.sub(rb'" \1', raw))
    out = []
    for node in root.iter("item"):
        if category and category not in [(c.text or "").strip() for c in node.findall("category")]:
            continue
        body = (node.findtext(CONTENT) or "") + (node.findtext("description") or "")
        image = clean_url(node.findtext(APOD + "hdurl"))
        credit = text_of(node.findtext(APOD + "credit"), CREDIT_MAX)
        alt = node.findtext(APOD + "primary_image_alt") or node.findtext(APOD + "alt") or ""
        if not image:
            image, media_credit = widest_media(node)
            credit = credit or media_credit
        if not image:
            enclosure = node.find("enclosure")
            if enclosure is not None and (enclosure.get("type") or "").startswith("image"):
                image = clean_url(enclosure.get("url"))
        if not image:
            image, alt = first_img(body)
        out.append({"title": node.findtext("title"), "url": node.findtext("link"),
                    "image": image, "credit": credit, "alt": alt,
                    "d": parse_time(node.findtext("pubDate"))})
    for node in root.iter(ATOM + "entry"):
        link = next((l.get("href") for l in node.findall(ATOM + "link")
                     if l.get("rel") in (None, "alternate")), "")
        body = node.findtext(ATOM + "content") or node.findtext(ATOM + "summary") or ""
        image, credit = widest_media(node)
        alt = ""
        if not image:
            image, alt = first_img(body)
        match = CREDIT_RE.search(body)
        if match:
            credit = match.group(1)
        out.append({"title": node.findtext(ATOM + "title"), "url": link, "image": image,
                    "credit": credit, "alt": alt,
                    "d": parse_time(node.findtext(ATOM + "published") or node.findtext(ATOM + "updated"))})
    items = []
    for entry in out:
        url, image = clean_url(entry["url"]), sized(entry["image"] or "")
        title = text_of(entry["title"], TITLE_MAX)
        if not (url and image and title and entry["d"]):
            continue
        item = {"title": title, "url": url, "image": image, "d": entry["d"]}
        credit = text_of(entry["credit"], CREDIT_MAX)
        if credit:
            item["credit"] = credit
        alt = text_of(entry["alt"], ALT_MAX)
        if alt and not NO_ALT_RE.match(alt):
            item["alt"] = alt
        items.append(item)
    return items


def fetch_bytes(url, timeout=20):
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def merge(held, fresh, now_ts):
    """Union by url (a re-fetched item replaces its held copy), the last
    KEEP_DAYS, newest first, at most CAP. -> (items, added), where `added`
    counts kept items that are new or changed."""
    before = {item["url"]: item for item in held or [] if isinstance(item, dict) and item.get("url")}
    by_url = dict(before)
    for item in fresh:
        by_url[item["url"]] = item
    cutoff = now_ts - KEEP_DAYS * 86400
    kept = sorted((item for item in by_url.values()
                   if cutoff <= item.get("d", 0) <= now_ts + 3600),
                  key=lambda item: (item["d"], item["url"]), reverse=True)[:CAP]
    return kept, sum(1 for item in kept if before.get(item["url"]) != item)


def refresh(previous, now=None, fetch=fetch_bytes, force=False):
    """-> (store, added). Fetches only when the last fetch is older than
    FETCH_EVERY_MINUTES (or `force`); never raises."""
    now = now or wc.utcnow()
    now_ts = int(now.timestamp())
    store = dict(previous) if isinstance(previous, dict) else {}
    held = [item for item in store.get("items") or [] if isinstance(item, dict)]
    fetched = store.get("fetched")
    try:
        last = datetime.fromisoformat(fetched) if fetched else None
    except ValueError:
        last = None
    if not force and last and timedelta(0) <= now - last < timedelta(minutes=FETCH_EVERY_MINUTES):
        return store, 0
    sources, fresh = {}, []
    for src, name, feed, site, category in FEEDS:
        entry = {"name": name, "site": site, "ok": False, "n": 0}
        try:
            items = parse(fetch(feed), category)
        except Exception as exc:  # noqa: BLE001 — a dead feed keeps its held items
            entry["reason"] = f"{exc.__class__.__name__}"
            items = []
        else:
            entry["ok"] = True
        for item in items:
            item.update(id=wc.item_id(item["url"]), src=src, name=name,
                        posted_at=wc.iso_ts(item["d"]))
            fresh.append(item)
        sources[src] = entry
    items, added = merge(held, fresh, now_ts)
    for src, entry in sources.items():
        entry["n"] = sum(1 for item in items if item["src"] == src)
    stamp = now.replace(microsecond=0).isoformat()
    store = {"checked": stamp, "fetched": stamp, "sources": sources, "items": items}
    return store, added


def summary_line(store):
    sources = (store or {}).get("sources") or {}
    parts = [f"{entry.get('name')} {entry.get('n', 0)}" + ("" if entry.get("ok") else " (down)")
             for entry in sources.values()]
    return "photos: " + (", ".join(parts) if parts else "not fetched this run")


# ----------------------------------------------------------------------
# Selftest — offline fixtures shaped like the four live feeds (2026-10-19)
# ----------------------------------------------------------------------

ATLANTIC = b"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>The Atlantic</title>
<entry><title>Photos of the Week: Rabbit Jumping, Floating Bazaar</title>
<link href="https://www.theatlantic.com/photography/2026/10/photos-week/689007/?utm_source=feed"/>
<published>2026-10-16T09:00:00-04:00</published>
<content type="html">&lt;figure&gt;&lt;img src="https://cdn.theatlantic.com/thumbor/x=/a01/original.jpg" width="1600" alt="A model poses before hot-air balloons."&gt;&lt;figcaption&gt;&lt;div class="credit"&gt;Ilkin Eskipehlivan / Anadolu / Getty&lt;/div&gt;&lt;/figcaption&gt;&lt;/figure&gt;</content>
</entry></feed>"""

GUARDIAN = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:media="http://search.yahoo.com/mrss/" version="2.0"><channel><title>Photos of the day</title>
<item><title>A painting by Churchill and a foam fight: photos of the day &#8211; Monday</title>
<link>https://www.theguardian.com/news/gallery/2026/oct/19/photos-of-the-day-monday</link>
<pubDate>Mon, 19 Oct 2026 13:07:27 GMT</pubDate>
<media:content width="140" url="https://i.guim.co.uk/img/a.png?width=140&amp;s=1"><media:credit>Photograph: Murdo MacLeod/The Guardian</media:credit></media:content>
<media:content width="700" url="https://i.guim.co.uk/img/a.png?width=700&amp;s=2"><media:credit>Photograph: Murdo MacLeod/The Guardian</media:credit></media:content>
</item></channel></rss>"""

NASA = b"""<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"
 xmlns:content="http://purl.org/rss/1.0/modules/content/"
 xmlns:apod="https://science.nasa.gov/apod/"xmlns:media="http://search.yahoo.com/mrss/" ><channel><title>NASA Science</title>
<item><title>Treble Clef: Unusual X-ray Hot Radio Source</title>
<link>https://science.nasa.gov/image-article/apod-2026-october-19-treble-clef/</link>
<pubDate>Mon, 19 Oct 2026 04:05:00 +0000</pubDate>
<apod:hdurl>https://assets.science.nasa.gov/dynamicimage/assets/apod/trebleclef.jpg?w=7200&amp;h=5361&amp;fit=clip</apod:hdurl>
<apod:credit>X-ray: &lt;a href="https://www.nasa.gov/"&gt;NASA&lt;/a&gt;/CXC</apod:credit>
<apod:alt>A radio source shaped like a treble clef.</apod:alt></item>
<item><title>Chasing the International Space Station</title>
<link>https://science.nasa.gov/image-article/apod-2026-october-16-chasing-iss/</link>
<pubDate>Fri, 16 Oct 2026 04:05:00 +0000</pubDate></item>
<item><title>Autumn Paints Poland&#8217;s Bieszczady Mountains</title>
<link>https://science.nasa.gov/earth/earth-observatory/autumn-paints-poland/</link>
<pubDate>Mon, 19 Oct 2026 04:01:00 +0000</pubDate><category><![CDATA[Earth Observatory]]></category>
<content:encoded><![CDATA[<svg></svg><img src="https://assets.science.nasa.gov/dynamicimage/assets/eo/poland.jpg?w=2048&amp;h=1365&amp;fit=clip" alt="Fall color on forested slopes."><img src="https://x/second.jpg">]]></content:encoded></item>
<item><title>Perseverance Navcam Image Marks Record Drive</title>
<link>https://science.nasa.gov/photojournal/record-drive/</link>
<pubDate>Tue, 13 Oct 2026 17:42:51 +0000</pubDate><category><![CDATA[Photojournal]]></category>
<content:encoded><![CDATA[<img src="https://x/rover.jpg">]]></content:encoded></item>
</channel></rss>"""


def selftest():
    [atl] = parse(ATLANTIC)
    assert atl["url"] == "https://www.theatlantic.com/photography/2026/10/photos-week/689007/", atl
    assert atl["image"] == "https://cdn.theatlantic.com/thumbor/x=/a01/original.jpg"
    assert atl["credit"] == "Ilkin Eskipehlivan / Anadolu / Getty" and atl["alt"].startswith("A model")
    [gdn] = parse(GUARDIAN)
    assert gdn["image"].endswith("width=700&s=2") and gdn["credit"].startswith("Photograph:")
    assert gdn["title"].endswith("photos of the day – Monday")
    apod = parse(NASA)
    assert [item["title"][:6] for item in apod] == ["Treble", "Autumn", "Persev"]   # the video has no picture
    assert apod[0]["image"].startswith("https://assets.science.nasa.gov/dynamicimage/assets/apod/"
                                       "trebleclef.jpg?w=1600&fit=clip"), apod[0]["image"]
    assert apod[0]["credit"] == "X-ray: NASA/CXC" and apod[0]["alt"].startswith("A radio")
    [eo] = parse(NASA, "Earth Observatory")
    assert eo["image"].endswith("poland.jpg?w=1600&fit=clip") and eo["alt"] == "Fall color on forested slopes."
    # refresh: four feeds, one down; the down one keeps nothing new and says so
    now = datetime(2026, 10, 19, 16, 0, tzinfo=timezone.utc)
    feeds = {FEEDS[0][2]: ATLANTIC, FEEDS[1][2]: GUARDIAN, FEEDS[2][2]: NASA}

    def fake(url):
        if url not in feeds:
            raise OSError("down")
        return feeds[url]
    store, added = refresh({}, now, fake)
    assert added == 5 and store["sources"]["nasa-earth-observatory"]["ok"] is False
    assert [item["src"] for item in store["items"]][:2] == ["guardian-photos-of-the-day", "nasa-apod"]
    assert store["items"][0]["id"] == wc.item_id(store["items"][0]["url"])
    # within the hour: no fetch at all; after it, the same items are not new
    again, added = refresh(store, now + timedelta(minutes=20), lambda url: 1 / 0)
    assert (again, added) == (store, 0)
    again, added = refresh(store, now + timedelta(minutes=61), fake)
    assert added == 0 and len(again["items"]) == len(store["items"])
    # two weeks on, everything has aged out
    later, _ = refresh(store, now + timedelta(days=KEEP_DAYS + 1), lambda url: 1 / 0)
    assert later["items"] == [] and "photos:" in summary_line(later)
    print("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    if "--print" in sys.argv:
        store, added = refresh({}, force=True)
        print(summary_line(store), f"({added} new)")
        print(json.dumps(store["items"][:12], indent=1, ensure_ascii=False))
        return
    print(__doc__)


if __name__ == "__main__":
    main()
