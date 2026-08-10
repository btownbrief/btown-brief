#!/usr/bin/env python3
"""Burlington Pulse — the swipe-left payoff: a drafted deep-dive page.

Readers swipe a headline left to say "I want to go deeper on this". Those
votes land in Supabase. Nightly, any topic past the threshold gets a
generated explainer page — the underlying subject, not the news cycle: what
it is, what to watch, where people are arguing about it.

Nothing here auto-publishes. The script writes topics/<slug>.html into the
working tree and the workflow opens a pull request; a human merges or not.

How a page is kept honest:

  * GROUNDING. The draft is written only from Wikipedia extracts and real
    headlines we hand the model. No Wikipedia hit, no page — a topic with
    no encyclopedia footing is a topic we can't fact-check.
  * NO INVENTION. The prompt forbids facts, figures, dates and names that
    aren't in the supplied material, and forbids picking a video or thread
    that isn't in the supplied lists.
  * VERIFIED LINKS. Every outbound URL is fetched before it is rendered.
    Anything that fails is dropped; if Wikipedia itself fails, the topic is
    abandoned rather than published unsourced.

Failure posture: every fetch and every model call is wrapped, and any
failure logs and exits 0 — a quiet night is a normal night.

CLI:
  --force-url URL --force-title TITLE   skip Supabase, draft this headline
  --selftest                            run the offline checks and exit
"""

import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from zoneinfo import ZoneInfo

ROOT = os.path.join(os.path.dirname(__file__), "..")
TEMPLATE = os.path.join(os.path.dirname(__file__), "topic_page_template.html")
TOPICS_DIR = os.path.join(ROOT, "topics")

UA = "btown-pulse-topics/1.0"
TIMEOUT = 20
MODEL = "claude-sonnet-5"

SUPABASE_RPC = ("https://jnouvwxomrcffqwilqkq.supabase.co/rest/v1/rpc/"
                "pulse_dig_leaders")
SUPABASE_KEY = "sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3"
EASTERN = ZoneInfo("America/New_York")

PULSE_URL = ("https://raw.githubusercontent.com/btownbrief/btown-brief/"
             "pulse-data/data/pulse.json")

MAX_LEADERS = 2
MAX_VIDEOS = 4
MAX_THREADS = 3
MAX_RELATED = 6

TOPIC_SCHEMA = {
    "type": "object",
    "properties": {
        "topic": {"type": "string"},
        "slug": {"type": "string"},
        "wiki_queries": {"type": "array", "items": {"type": "string"}},
        "search_query": {"type": "string"},
    },
    "required": ["topic", "slug", "wiki_queries", "search_query"],
    "additionalProperties": False,
}

DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "eyebrow": {"type": "string"},
        "title": {"type": "string"},
        "dek": {"type": "string"},
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "heading": {"type": "string"},
                    "paragraphs": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["heading", "paragraphs"],
                "additionalProperties": False,
            },
        },
        "video_picks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "why": {"type": "string"},
                },
                "required": ["id", "why"],
                "additionalProperties": False,
            },
        },
        "thread_picks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "why": {"type": "string"},
                },
                "required": ["url", "why"],
                "additionalProperties": False,
            },
        },
        "further": {"type": "string"},
    },
    "required": ["eyebrow", "title", "dek", "sections", "video_picks",
                 "thread_picks", "further"],
    "additionalProperties": False,
}

STOPWORDS = {
    "about", "after", "again", "against", "amid", "among", "and", "are", "been",
    "before", "being", "between", "both", "but", "can", "could", "did", "does",
    "down", "during", "each", "for", "from", "had", "has", "have", "how", "into",
    "its", "just", "like", "more", "most", "new", "not", "now", "off", "one",
    "only", "other", "out", "over", "said", "says", "she", "some", "such", "than",
    "that", "the", "their", "them", "then", "there", "these", "they", "this",
    "those", "through", "under", "until", "was", "were", "what", "when", "where",
    "which", "while", "who", "why", "will", "with", "would", "you", "your",
}


# ----------------------------------------------------------------------
# Small helpers
# ----------------------------------------------------------------------

def clean(value):
    return re.sub(r"\s+", " ", value or "").strip()


def slugify(value):
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return slug[:70].strip("-")


def tokens(value):
    words = re.findall(r"[a-z0-9']{3,}", (value or "").lower())
    return {word for word in words if word not in STOPWORDS}


def fetch(url, data=None, headers=None, timeout=TIMEOUT):
    request = urllib.request.Request(url, data=data,
                                     headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def fetch_json(url, data=None, headers=None, timeout=TIMEOUT):
    return json.loads(fetch(url, data, headers, timeout).decode("utf-8"))


def link_ok(url):
    """Fetch a URL and accept anything under 400. One retry, then give up."""
    for attempt in range(2):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
                if response.status < 400:
                    return True
        except Exception:  # noqa: BLE001 — any failure means "don't link it"
            if attempt == 0:
                time.sleep(1)
    return False


# ----------------------------------------------------------------------
# Vote leaders
# ----------------------------------------------------------------------

def fetch_leaders():
    """Supabase RPC -> [{url,title,source,votes}], or None if unavailable."""
    day = datetime.now(EASTERN).strftime("%Y-%m-%d")
    body = json.dumps({"p_day": day}).encode("utf-8")
    try:
        return fetch_json(SUPABASE_RPC, data=body, headers={
            "apikey": SUPABASE_KEY, "Content-Type": "application/json"})
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            print("topics: pulse_dig_leaders is not installed yet — nothing to do")
        else:
            print(f"topics: vote query failed ({exc})", file=sys.stderr)
    except Exception as exc:  # noqa: BLE001 — a quiet exit beats a red workflow
        print(f"topics: vote query failed ({exc})", file=sys.stderr)
    return None


# ----------------------------------------------------------------------
# The two model calls
# ----------------------------------------------------------------------

def ask_model(prompt, schema, max_tokens):
    import anthropic

    client = anthropic.Anthropic()
    response = client.messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        output_config={"format": {"type": "json_schema", "schema": schema}},
        messages=[{"role": "user", "content": prompt}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("the model declined to answer")
    text = next(block.text for block in response.content if block.type == "text")
    return json.loads(text)


def derive_topic(headline):
    prompt = f"""A reader of a Burlington, Vermont news reader swiped on this \
headline to ask for a deep-dive:

  {headline}

Name the underlying TOPIC the reader wants to understand. Usually that is the \
story's own subject. Occasionally the real subject is the thing the story is \
made of — a headline about a container ship running aground is arguably about \
the shipping container — but only say so when that is genuinely what the story \
is about. When in doubt, the topic is the subject of the story itself.

Return:
  topic         a short noun phrase naming the topic
  slug          a url-safe lowercase slug for that topic, words joined by
                hyphens, no other punctuation
  wiki_queries  2-3 Wikipedia search queries that would surface the best
                encyclopedia articles on the topic
  search_query  one general search query for finding videos and discussion
"""
    return ask_model(prompt, TOPIC_SCHEMA, 1000)


def draft_page(topic, headline, material):
    prompt = f"""You are writing an explainer page for "The Pulse", a \
Burlington, Vermont news reader. Readers asked for a deep-dive on this topic:

  TOPIC: {topic}
  The headline that prompted it: {headline}

Everything you may draw on is in the JSON below: Wikipedia extracts, related \
headlines, and lists of candidate videos and discussion threads.

MATERIAL:
{json.dumps(material, ensure_ascii=False, indent=1)}

Write the page:
  * 400-600 words total, across 3-4 sections, each with a short heading.
  * Ground every sentence in the supplied Wikipedia extracts and headlines.
    Invent nothing: no facts, figures, dates, names, quotes or events that are
    not in the material above. Every number you write must appear there.
  * If the material does not support a claim, leave the claim out.
  * Plain prose. No markdown, no bullet lists, no links inside the text.
  * Pick at most 4 videos and at most 3 threads, chosen ONLY from the
    candidate lists above, referenced by their exact id / url. Give each a
    one-line note saying why it is worth the reader's time. If the lists are
    empty or nothing is good, return empty lists.
  * eyebrow: two or three words placing the topic (e.g. "Infrastructure").
    title: the topic as a page title. dek: one sentence on why it matters.
    further: one sentence pointing the curious reader at what to look into
    next, again grounded in the material.

Tone: a smart explainer page — Wikipedia's steadiness with a good \
newsletter's clarity. Never marketing, never hype, never second person.
"""
    return ask_model(prompt, DRAFT_SCHEMA, 16000)


# ----------------------------------------------------------------------
# Gathering — every fetch is best-effort and skippable
# ----------------------------------------------------------------------

def wikipedia(queries):
    """Search queries -> up to 2 distinct {title, extract, url} summaries."""
    titles = []
    for query in queries[:3]:
        url = ("https://en.wikipedia.org/w/rest.php/v1/search/page?q="
               + urllib.parse.quote(query) + "&limit=4")
        try:
            found = fetch_json(url)
        except Exception as exc:  # noqa: BLE001 — one dud query is survivable
            print(f"  wiki search skip {query!r}: {exc}", file=sys.stderr)
            continue
        for page in found.get("pages", []):
            key = page.get("key") or page.get("title")
            if key and key not in titles:
                titles.append(key)

    pages = []
    for title in titles:
        if len(pages) == 2:
            break
        url = ("https://en.wikipedia.org/api/rest_v1/page/summary/"
               + urllib.parse.quote(title, safe=""))
        try:
            summary = fetch_json(url)
        except Exception as exc:  # noqa: BLE001
            print(f"  wiki summary skip {title!r}: {exc}", file=sys.stderr)
            continue
        extract = clean(summary.get("extract"))
        content = (summary.get("content_urls", {})
                   .get("desktop", {}).get("page"))
        if extract and content:
            pages.append({"title": clean(summary.get("title") or title),
                          "extract": extract, "url": content})
    return pages


def iso_duration(value):
    """PT1H2M3S -> 62:03. Anything unparseable comes back empty."""
    match = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", value or "")
    if not match:
        return ""
    hours, minutes, seconds = (int(part or 0) for part in match.groups())
    return f"{hours * 60 + minutes}:{seconds:02d}"


def youtube(query):
    key = os.environ.get("YOUTUBE_API_KEY", "")
    if not key:
        return []
    search = ("https://www.googleapis.com/youtube/v3/search?part=snippet"
              "&type=video&maxResults=6&q=" + urllib.parse.quote(query)
              + "&key=" + urllib.parse.quote(key))
    try:
        found = fetch_json(search)
    except Exception as exc:  # noqa: BLE001
        print(f"  youtube search skip: {exc}", file=sys.stderr)
        return []

    videos = {}
    for item in found.get("items", []):
        video_id = (item.get("id") or {}).get("videoId")
        snippet = item.get("snippet") or {}
        if video_id and video_id not in videos:
            videos[video_id] = {
                "id": video_id,
                "title": clean(html.unescape(snippet.get("title", ""))),
                "channel": clean(snippet.get("channelTitle", "")),
                "duration": "", "views": 0,
            }
    if not videos:
        return []

    details = ("https://www.googleapis.com/youtube/v3/videos"
               "?part=contentDetails,statistics&id="
               + urllib.parse.quote(",".join(videos)) + "&key="
               + urllib.parse.quote(key))
    try:
        for item in fetch_json(details).get("items", []):
            video = videos.get(item.get("id"))
            if video is None:
                continue
            video["duration"] = iso_duration(
                (item.get("contentDetails") or {}).get("duration"))
            video["views"] = int((item.get("statistics") or {})
                                 .get("viewCount") or 0)
    except Exception as exc:  # noqa: BLE001 — durations are a nicety
        print(f"  youtube details skip: {exc}", file=sys.stderr)
    return list(videos.values())


ATOM = "{http://www.w3.org/2005/Atom}"


def reddit(query):
    """Reddit's public search feed. Cloud IPs are often blocked — that's fine."""
    url = ("https://www.reddit.com/search.rss?q=" + urllib.parse.quote(query)
           + "&sort=top&t=month&limit=8")
    try:
        raw = fetch(url)
    except Exception as exc:  # noqa: BLE001 — 403/429 from a runner is expected
        print(f"  reddit skip: {exc}", file=sys.stderr)
        return []
    threads = []
    try:
        for entry in ET.fromstring(raw).iter(ATOM + "entry"):
            title = clean((entry.findtext(ATOM + "title") or ""))
            link = entry.find(ATOM + "link")
            href = clean(link.get("href")) if link is not None else ""
            if title and href:
                threads.append({"title": title, "url": href})
    except ET.ParseError as exc:
        print(f"  reddit parse skip: {exc}", file=sys.stderr)
    return threads


def related_coverage(payload, topic, headline):
    """Token-overlap match against pulse.json titles, distinct sources only."""
    wanted = tokens(topic) | tokens(headline)
    if not wanted or not payload:
        return []
    sources = {source["id"]: source for source in payload.get("sources", [])}
    scored = []
    for item in payload.get("items", []):
        if item.get("x") or not item.get("u") or not item.get("t"):
            continue
        score = len(wanted & tokens(item["t"]))
        if score >= 2:
            source = sources.get(item.get("s"), {})
            scored.append((score, item.get("d", 0), {
                "title": item["t"], "url": item["u"],
                "source": source.get("short") or source.get("name") or "",
                "s": item.get("s"),
            }))
    scored.sort(key=lambda row: (row[0], row[1]), reverse=True)
    seen, out = set(), []
    for _, _, entry in scored:
        if entry["s"] in seen:
            continue
        seen.add(entry["s"])
        out.append(entry)
        if len(out) == MAX_RELATED:
            break
    return out


# ----------------------------------------------------------------------
# Rendering — every model string is escaped on the way in
# ----------------------------------------------------------------------

def esc(value):
    return html.escape(clean(value), quote=True)


def render_sections(page):
    parts = []
    for section in page.get("sections", []):
        heading = esc(section.get("heading"))
        if heading:
            parts.append(f"<h2>{heading}</h2>")
        for paragraph in section.get("paragraphs", []):
            text = esc(paragraph)
            if text:
                parts.append(f"<p>{text}</p>")
    further = esc(page.get("further"))
    if further:
        parts.append(f'<p class="further">{further}</p>')
    return "\n".join(parts)


def render_watch(videos):
    if not videos:
        return ""
    cards = []
    for video in videos:
        meta = " · ".join(part for part in (esc(video.get("channel")),
                                            esc(video.get("duration"))) if part)
        note = esc(video.get("why"))
        cards.append(
            f'<a class="card" href="{esc(video["url"])}" target="_blank" '
            f'rel="noopener">\n'
            f'  <div class="card-title">{esc(video.get("title"))}</div>\n'
            f'  <div class="meta">{meta}</div>\n'
            + (f'  <div class="note">{note}</div>\n' if note else "")
            + "</a>")
    return ('<section>\n<p class="label">Watch</p>\n'
            + "\n".join(cards) + "\n</section>")


def render_lurk(threads):
    if not threads:
        return ""
    items = []
    for thread in threads:
        domain = urllib.parse.urlsplit(thread["url"]).netloc.lower()
        note = esc(thread.get("why"))
        items.append(
            f'  <li><a href="{esc(thread["url"])}" target="_blank" '
            f'rel="noopener">{esc(thread.get("title"))}</a>\n'
            f'    <div class="meta">{esc(domain)}</div>\n'
            + (f'    <div class="note">{note}</div>\n' if note else "")
            + "  </li>")
    return ('<section>\n<p class="label">Lurk</p>\n<ul class="list">\n'
            + "\n".join(items) + "\n</ul>\n</section>")


def render_related(related):
    if not related:
        return ""
    items = []
    for entry in related:
        source = esc(entry.get("source"))
        items.append(
            f'  <li><a href="{esc(entry["url"])}" target="_blank" '
            f'rel="noopener">{esc(entry.get("title"))}</a>\n'
            + (f'    <div class="meta">{source}</div>\n' if source else "")
            + "  </li>")
    return ('<section>\n<p class="label">Related coverage</p>\n'
            '<ul class="list">\n' + "\n".join(items) + "\n</ul>\n</section>")


def render(page, videos, threads, related, votes, date):
    with open(TEMPLATE, encoding="utf-8") as src:
        out = src.read()
    for token, value in (
        ("{{TITLE}}", esc(page.get("title"))),
        ("{{EYEBROW}}", esc(page.get("eyebrow"))),
        ("{{DEK}}", esc(page.get("dek"))),
        ("{{SECTIONS}}", render_sections(page)),
        ("{{WATCH}}", render_watch(videos)),
        ("{{LURK}}", render_lurk(threads)),
        ("{{RELATED}}", render_related(related)),
        ("{{DATE}}", esc(date)),
        ("{{VOTES}}", esc(str(votes))),
    ):
        out = out.replace(token, value)
    return out


# ----------------------------------------------------------------------
# One topic, end to end
# ----------------------------------------------------------------------

def build_one(leader, payload):
    headline = clean(leader.get("title")) or clean(leader.get("url"))
    print(f"topics: working on {headline!r}")

    try:
        derived = derive_topic(headline)
    except Exception as exc:  # noqa: BLE001
        print(f"  topic call failed: {exc}", file=sys.stderr)
        return None
    topic = clean(derived.get("topic"))
    slug = slugify(derived.get("slug")) or slugify(topic)
    if not topic or not slug:
        print("  no usable topic came back", file=sys.stderr)
        return None

    out_path = os.path.join(TOPICS_DIR, slug + ".html")
    if os.path.exists(out_path):
        print(f"  topics/{slug}.html already exists — skipping")
        return None

    wiki = wikipedia(derived.get("wiki_queries") or [topic])
    if not wiki:
        print("  nothing from Wikipedia — skipping (no grounding)", file=sys.stderr)
        return None

    search_query = clean(derived.get("search_query")) or topic
    videos = youtube(search_query)
    threads = reddit(search_query)
    related = related_coverage(payload, topic, headline)

    material = {
        "wikipedia": wiki,
        "candidate_videos": videos,
        "candidate_threads": threads,
        "related_headlines": [
            {"title": entry["title"], "source": entry["source"]}
            for entry in related],
    }
    try:
        page = draft_page(topic, headline, material)
    except Exception as exc:  # noqa: BLE001
        print(f"  draft call failed: {exc}", file=sys.stderr)
        return None

    by_id = {video["id"]: video for video in videos}
    picked_videos = []
    for pick in (page.get("video_picks") or [])[:MAX_VIDEOS]:
        video = by_id.get(clean(pick.get("id")))
        if video is None:
            continue
        url = "https://www.youtube.com/watch?v=" + video["id"]
        if link_ok(url):
            picked_videos.append(dict(video, url=url, why=pick.get("why", "")))

    by_url = {thread["url"]: thread for thread in threads}
    picked_threads = []
    for pick in (page.get("thread_picks") or [])[:MAX_THREADS]:
        thread = by_url.get(clean(pick.get("url")))
        if thread is None:
            continue
        if link_ok(thread["url"]):
            picked_threads.append(dict(thread, why=pick.get("why", "")))

    wiki = [entry for entry in wiki if link_ok(entry["url"])]
    if not wiki:
        print("  every Wikipedia link failed verification — abandoning topic",
              file=sys.stderr)
        return None
    related = [entry for entry in related if link_ok(entry["url"])]

    # The encyclopedia articles the page was written from belong in the
    # reader's related list too — they are the sources.
    related = [{"title": entry["title"] + " (Wikipedia)", "url": entry["url"],
                "source": "Wikipedia"} for entry in wiki] + related

    votes = leader.get("votes") or 0
    # Eastern, not UTC: the nightly run fires at 23:55 ET, and a UTC stamp
    # would tell a Burlington reader the links were checked tomorrow.
    date = datetime.now(EASTERN).strftime("%B %-d, %Y")
    markup = render(page, picked_videos, picked_threads, related, votes, date)

    os.makedirs(TOPICS_DIR, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as dst:
        dst.write(markup)
    print(f"  wrote topics/{slug}.html "
          f"({len(picked_videos)} videos, {len(picked_threads)} threads, "
          f"{len(related)} related)")
    return slug


def run(args):
    if args.force_url:
        leaders = [{"url": args.force_url,
                    "title": args.force_title or args.force_url,
                    "source": "", "votes": 0}]
    else:
        leaders = fetch_leaders()
        if leaders is None:
            return
        threshold = int(os.environ.get("TOPIC_VOTE_THRESHOLD", "3"))
        leaders = [leader for leader in leaders
                   if (leader.get("votes") or 0) >= threshold][:MAX_LEADERS]
    if not leaders:
        print("topics: no topic past the vote threshold today")
        return

    try:
        payload = fetch_json(PULSE_URL, timeout=30)
    except Exception as exc:  # noqa: BLE001 — related coverage is a nicety
        print(f"topics: could not fetch pulse.json ({exc})", file=sys.stderr)
        payload = {}

    slugs = [slug for slug in (build_one(leader, payload) for leader in leaders)
             if slug]
    print(f"topics: {len(slugs)} page(s) drafted"
          + (": " + ", ".join(slugs) if slugs else ""))


# ----------------------------------------------------------------------
# Selftest — offline, template rendering only
# ----------------------------------------------------------------------

FIXTURE_PAGE = {
    "eyebrow": "Infrastructure",
    "title": "The Shipping Container",
    "dek": "A steel box that rewired how everything gets anywhere.",
    "sections": [
        {"heading": "What it is",
         "paragraphs": ["A standard steel box, twenty or forty feet long.",
                        "Its dimensions are the whole point."]},
        {"heading": "Why it mattered",
         "paragraphs": ["Loading a ship stopped being a day of hand labour."]},
    ],
    "video_picks": [], "thread_picks": [],
    "further": "Look next at how ports rebuilt themselves around the box.",
}
FIXTURE_VIDEOS = [{"id": "abc123", "url": "https://www.youtube.com/watch?v=abc123",
                   "title": "How the box changed the world", "channel": "Docklands",
                   "duration": "12:04", "views": 900,
                   "why": "The clearest twelve minutes on the subject."}]
FIXTURE_THREADS = [{"title": "Why are containers all one size?",
                    "url": "https://www.reddit.com/r/AskEngineers/comments/x/",
                    "why": "Engineers arguing about tolerances, politely."}]
FIXTURE_RELATED = [{"title": "Port backlog eases", "url": "https://example.com/a",
                    "source": "Wire"}]


def selftest():
    assert slugify("The Shipping Container!") == "the-shipping-container"
    assert iso_duration("PT1H2M3S") == "62:03" and iso_duration("PT45S") == "0:45"
    assert iso_duration("garbage") == ""
    assert "the" not in tokens("The shipping container")
    print("build_topic_page: helpers ok (slug, duration, tokens)")

    related = related_coverage({
        "sources": [{"id": "a", "short": "Wire"}, {"id": "b", "short": "Other"}],
        "items": [
            {"t": "Shipping container ship aground", "u": "https://a.com/1",
             "d": 5, "s": "a"},
            {"t": "Unrelated weather story", "u": "https://a.com/2",
             "d": 4, "s": "b"},
        ],
    }, "The Shipping Container", "Container ship runs aground")
    assert len(related) == 1 and related[0]["source"] == "Wire"
    print("build_topic_page: related coverage ok (overlap, distinct sources)")

    markup = render(FIXTURE_PAGE, FIXTURE_VIDEOS, FIXTURE_THREADS,
                    FIXTURE_RELATED, 7, "August 9, 2026")
    assert "{{" not in markup and "}}" not in markup
    assert "</html>" in markup
    for needle in ("The Shipping Container", "Infrastructure",
                   "A steel box that rewired how everything gets anywhere.",
                   "What it is", "Its dimensions are the whole point.",
                   "How the box changed the world", "Docklands", "12:04",
                   "The clearest twelve minutes on the subject.",
                   "Why are containers all one size?", "www.reddit.com",
                   "Engineers arguing about tolerances, politely.",
                   "Port backlog eases", "Wire",
                   "Look next at how ports rebuilt themselves around the box.",
                   "August 9, 2026", "requested by 7 readers"):
        assert needle in markup, needle
    assert 'target="_blank" rel="noopener"' in markup
    print("build_topic_page: render ok (no placeholders left, fixture present)")

    bare = render(FIXTURE_PAGE, [], [], [], 3, "August 9, 2026")
    assert "{{" not in bare
    assert "Watch" not in bare and "Lurk" not in bare
    assert "Related coverage" not in bare
    print("build_topic_page: empty sections ok (headings omitted too)")

    escaped = render(dict(FIXTURE_PAGE, title='Steel & <script>"boxes"'),
                     [], [], [], 1, "August 9, 2026")
    assert "<script>" not in escaped and "&lt;script&gt;" in escaped
    print("build_topic_page: escaping ok")
    print("selftest ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--force-url", help="draft this headline, skip Supabase")
    parser.add_argument("--force-title", help="headline text for --force-url")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
        return
    run(args)


if __name__ == "__main__":
    main()
