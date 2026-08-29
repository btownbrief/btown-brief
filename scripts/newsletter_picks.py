#!/usr/bin/env python3
"""newsletter_picks.py — the Brief's own local stories, out of the newsletter.

The wire already carries btownbrief.com as a source, but Beehiiv publishes one
RSS item per EDITION, titled "Friday, August 28th". As a headline that says
nothing, and there are only two a week. The stories are all in there — the
feed ships the whole edition as content:encoded — so this pulls them out.

Each story in the Local News section is the same three parts:

    <p><b><a href="THE ORIGINAL ARTICLE">HEADLINE</a></b></p>
    <div class="blockquote">... <i>"PULL QUOTE," per OUTLET.</i> ...</div>
    <p>STEPHEN'S OWN PARAGRAPH ON WHY IT MATTERS</p>

That last paragraph is the reason this file exists. Every other pick on the
site carries a machine-written `why`; these carry his.

QUICK HITS follow the same section and are headline-only links — kept, marked
`q: 1`, so a thin week still has something.

Wednesday editions are the podcast/Best-of format and carry no Local News
section at all. That is not a failure; they simply contribute nothing here.

Output: data/newsletter-picks.json, newest edition first.
"""

import argparse
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

FEED = "https://rss.beehiiv.com/feeds/1BT4mvZXMo.xml"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "newsletter-picks.json")
UA = "btown-brief-site/1.0 (newsletter picks)"

EDITIONS_KEEP = 8          # roughly a month of Mon/Fri
TRACKING = ("utm_", "ref_", "fbclid", "gclid")

# Anchored on the HEADING, not the words. "Local News" also appears in the
# table of contents and again in the quiz blurb ("the local news you just
# finished reading") — and that last one sits PAST Quick Hits, so taking the
# last match walked straight out of the section and into the ads.
SECTION_START = re.compile(r"<h[1-6][^>]*>[^<]{0,40}Local\s*News", re.I)
SECTION_END = re.compile(r"<h[1-6][^>]*>[^<]{0,40}QUICK\s*HITS", re.I)

# headline, optional pull quote, then his paragraph
STORY = re.compile(
    r'<p[^>]*>\s*<b>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>\s*</b>\s*</p>'
    r'(?:\s*<div class="blockquote">.*?<i>(.*?)</i>.*?</blockquote>\s*</div>)?'
    r'\s*<p[^>]*>(.*?)</p>',
    re.S,
)
# quick hits are a bare bolded link with no paragraph after
QUICK = re.compile(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.S)
# "…," per VTDigger.  ->  VTDigger
PER = re.compile(r"[,.\"”]\s*per\s+([^.<]{2,40})\.?\s*$", re.I)


def text(fragment):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", fragment or "")).strip()


def clean_url(url):
    """Beehiiv appends its own utm_ campaign to every outbound link."""
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:
        return url
    if parts.scheme not in ("http", "https"):
        return None
    kept = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
            if not k.lower().startswith(TRACKING)]
    return urllib.parse.urlunsplit(
        (parts.scheme, parts.netloc, parts.path,
         urllib.parse.urlencode(kept), parts.fragment))


def outlet(quote, url):
    """The outlet, from the quote's "per X" tail, else the domain."""
    hit = PER.search(text(quote or ""))
    if hit:
        return hit.group(1).strip()[:40]
    host = urllib.parse.urlsplit(url).netloc.lower()
    return re.sub(r"^(www|amp)\.", "", host).split("/")[0][:40]


def _bounds(body):
    """(start, end) of the Local News heading and the Quick Hits heading."""
    start = SECTION_START.search(body)
    if not start:
        return None, None
    end = SECTION_END.search(body, start.end())
    return start.end(), (end.start() if end else None)


def local_section(body):
    start, end = _bounds(body)
    if start is None:
        return ""
    return body[start:end] if end else body[start:start + 30000]


def quick_section(body):
    """Quick Hits runs from its own heading to whatever heading comes next."""
    _, end = _bounds(body)
    if end is None:
        return ""
    seg = body[end:]
    nxt = re.search(r"<h[1-6][^>]*>", seg[80:])
    return seg[:80 + nxt.start()] if nxt else seg[:6000]


def parse_edition(item):
    title = text(re.search(r"<title>(.*?)</title>", item, re.S).group(1)) if "<title>" in item else ""
    link = re.search(r"<link>(.*?)</link>", item, re.S)
    pub = re.search(r"<pubDate>(.*?)</pubDate>", item, re.S)
    when = None
    if pub:
        try:
            when = parsedate_to_datetime(text(pub.group(1)))
        except (TypeError, ValueError):
            when = None
    body_m = re.search(
        r"<content:encoded>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</content:encoded>", item, re.S)
    if not body_m:
        return None
    body = html.unescape(body_m.group(1))

    stories, seen = [], set()
    for m in STORY.finditer(local_section(body)):
        url, head, quote, why = m.group(1), text(m.group(2)), m.group(3), text(m.group(4))
        if url.startswith("#") or len(head) < 12:
            continue
        url = clean_url(url)
        if not url or url in seen:
            continue
        seen.add(url)
        stories.append({"t": head[:220], "u": url, "s": outlet(quote, url),
                        "w": why[:400], "q": 0})

    for m in QUICK.finditer(quick_section(body)):
        url, head = m.group(1), text(m.group(2))
        if url.startswith("#") or len(head) < 12:
            continue
        url = clean_url(url)
        if not url or url in seen or "btownbrief.com" in url:
            continue
        seen.add(url)
        stories.append({"t": head[:220], "u": url, "s": outlet(None, url),
                        "w": "", "q": 1})

    if not stories:
        return None
    return {
        "edition": title,
        "url": text(link.group(1)) if link else "",
        "d": int(when.timestamp()) if when else 0,
        "stories": stories,
    }


def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read().decode("utf-8", "replace")


def build(xml):
    out = []
    for item in re.findall(r"<item>(.*?)</item>", xml, re.S):
        ed = parse_edition(item)
        if ed:
            out.append(ed)
    out.sort(key=lambda e: e["d"], reverse=True)
    return {
        "v": 1,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "editions": out[:EDITIONS_KEEP],
    }


def selftest():
    edition = """<item><title>Friday, August 28th</title>
      <link>https://www.btownbrief.com/p/friday-august-28th</link>
      <pubDate>Fri, 28 Aug 2026 13:48:17 +0000</pubDate>
      <content:encoded><![CDATA[
      <h2>Table of Contents</h2><p>Local News (All Links Clickable)</p>
      <h2>Local News (All Links Clickable)</h2>
      <p class="paragraph"><b><a class="link" href="https://vtdigger.org/a?utm_source=www.btownbrief.com&amp;utm_medium=newsletter">Vermont secures $92.7M from Meta</a></b></p>
      <div class="blockquote"><blockquote class="blockquote__quote"><p><i>&quot;Children will be healthier,&quot; per VTDigger.</i></p></blockquote></div>
      <p class="paragraph">Attorney General Charity Clark's suit ended this week.</p>
      <p class="paragraph"><b><a class="link" href="https://www.sevendaysvt.com/b">A second local story that matters</a></b></p>
      <p class="paragraph">No pull quote on this one, just the take.</p>
      <h2>QUICK HITS</h2>
      <p><a href="https://wcax.com/c?utm_campaign=x">A quick hit worth keeping</a></p>
      <p><a href="https://www.btownbrief.com/p/self">Our own page, skipped</a></p>
      <h2>Events:</h2><p><a href="https://example.com/late">Too late to count</a></p>
      ]]></content:encoded></item>"""
    got = build(edition)
    eds = got["editions"]
    assert len(eds) == 1, eds
    st = eds[0]["stories"]
    assert [s["t"] for s in st] == [
        "Vermont secures $92.7M from Meta",
        "A second local story that matters",
        "A quick hit worth keeping"], [s["t"] for s in st]
    # utm_ stripped, everything else kept
    assert st[0]["u"] == "https://vtdigger.org/a", st[0]["u"]
    assert st[2]["u"] == "https://wcax.com/c", st[2]["u"]
    # the outlet comes from "per X", else the domain
    assert st[0]["s"] == "VTDigger", st[0]["s"]
    assert st[1]["s"] == "sevendaysvt.com", st[1]["s"]
    # his paragraph is the why; a story without a quote still gets one
    assert st[0]["w"].startswith("Attorney General"), st[0]["w"]
    assert st[1]["w"].startswith("No pull quote"), st[1]["w"]
    # quick hits carry no why and are marked
    assert st[2]["q"] == 1 and st[2]["w"] == ""
    # our own pages never become picks, and Events is past the section end
    assert not any("btownbrief.com" in s["u"] for s in st)
    assert not any("Too late" in s["t"] for s in st)
    # a Wednesday edition contributes nothing rather than erroring
    wed = """<item><title>Wednesday</title><pubDate>Wed, 26 Aug 2026 12:00:00 +0000</pubDate>
      <content:encoded><![CDATA[<h2>Podcast Picks</h2><p>no local news here</p>]]></content:encoded></item>"""
    assert build(wed)["editions"] == []
    print("newsletter_picks selftest: ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--feed", default=FEED)
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        selftest()
        return 0
    try:
        xml = fetch(args.feed)
    except Exception as exc:  # noqa: BLE001
        print(f"newsletter_picks: feed unreachable ({exc})", file=sys.stderr)
        return 1
    payload = build(xml)
    n = sum(len(e["stories"]) for e in payload["editions"])
    if not payload["editions"]:
        print("newsletter_picks: parsed nothing — leaving the old file alone",
              file=sys.stderr)
        return 1
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(f"newsletter_picks: {len(payload['editions'])} editions, {n} stories -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
