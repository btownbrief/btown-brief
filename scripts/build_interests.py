#!/usr/bin/env python3
"""Build all-day/data/interests.json: the headlines under the Wire's feeds.

The row of feeds under News · Recaps · Town Square · Photos
(all-day/js/modes/wire-interests.js) is mostly Instagram, but three of its
feeds are words: Good news, Nosy and Tech. Each is a short list of free RSS
feeds, read here, twice a day, in refresh-allday.yml. Ashley's brief
(2026-11-01): fun, interesting, informative; no politics, no tech-world news
unless you asked for Tech, and "I like that shit because I'm nosy".

WHAT GETS LEFT OUT, for every feed: an address, a phone number or a username
(title_guard.CONTACT), a private person's name, a child's age, politics and
self-harm. Good news and Nosy also leave out anything grim, because a chip
called Nosy must never serve up a death. Nosy goes furthest, because its stories
are police stories: no surname on its own, no child of any age, and no picture
at all, since a crime feed's thumbnail is a mugshot or a booking photo and no
rule here can read one. `only` narrows a mixed feed, so one section of a paper
can stand in for the paper.

THE JUDGE. The RSS is free; the model is there because a word list cannot tell
a stolen ATM from a stolen life. Good news and Nosy put each new headline to
Claude Sonnet 5.5 on its own, about a tenth of a cent each: the bakeoff of
2026-11-01 found Haiku a poor judge of long lists, changing its mind on 32 of
140 between identical runs, and Sonnet alone showed a third of its bad
headlines. Tech stays one Haiku call a feed. Each headline is judged once:
data/interests-judged.json keeps every verdict by feed and URL, so a rejection
stays a rejection, and only a model's yes counts as approved. Being in the last
file proves nothing. A headline the model did not answer records nothing and is
asked again next run. Until then Nosy and Good news show only what a model has
approved, and Tech, the one that goes stale, also shows what the rules passed.

A headline can hide what its story says: "Middlebury police clear up confusion
after false Halloween report" was a minor's razor-blade prank, and only the third
sentence said so (sample of 2026-11-01). So Nosy's judge reads the opening of the
story too, free, and a story that names a minor is a no without asking. A Google
News link goes through Google's own redirect and a Fark link through Fark's. A
page that will not open leaves the judge the headline alone, as before.

THE SPEND. A verdict is kept by URL until its item ages out, and one headline
under two URLs is asked about once, so a Google News search that keeps turning
up the same stories costs nothing. New headlines are another matter: Google
shows a different slice of a month's results from run to run. So a feed asks
about at most JUDGE_MAX new headlines a run, every call's cost goes in the `ai`
block of data/interests-judged.json, and past JUDGE_MONTH_CAP_USD nothing new is
asked until next month. Sonnet is about $0.0013 a headline and $0.0022 with a story
to read, and a steady month at 50 new headlines a run is about $2.

Most of these feeds hold a day or two of stories, so items stay from run to
run until they age out, each with its honest age. A source that fails, or
reads clean and empty, simply adds nothing new.

Run: python3 scripts/build_interests.py [--out PATH] [--judged PATH]
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import html
import json
import os
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from email.utils import parsedate_to_datetime
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from town.title_guard import CONTACT, names_person

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "all-day" / "data" / "interests.json"
JUDGED = ROOT / "data" / "interests-judged.json"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36"
KEEP_DAYS = {"good": 14, "nosy": 30, "tech": 5}     # a funny burglary keeps; a chip's worth takes weeks to gather
PER_SOURCE = 12
SOURCE_CAP = {"Atlas Obscura": 3, "UPI Odd News": 4}   # the two that would otherwise be the whole feed
PER_FEED = 60
TITLE_MAX = 160
TITLE_MIN_WORDS = 4           # "Great Scot!" says nothing away from its picture
FAIL_OPEN = {"tech"}          # keeps unjudged headlines when the model is out
NO_PICTURE = {"nosy"}
READS_STORY = {"nosy"}        # police stories, whose headlines are written to tease
STORY_CHARS = 1500            # far enough to reach "a minor who claimed..."
STORY_MIN_PARAGRAPH = 60      # shorter is a caption, a byline or a button

# (name, url, only): only, when set, is a regex the title must match. No clean
# Vermont blotter feed exists, so local news stands in, narrowed to crime words,
# and a Google News search reaches the small papers that have no feed of their
# own. Its items wear their own outlet's name.
CRIME_WORD = (r"\b(police|cops?|sheriff\w*|deput\w+|arrest\w*|charged|accused|cited|fined|busted|stole\w*|steal\w*|theft|thief|"
              r"thieves|burglar\w*|break-?in|robb\w*|heist|loot\w*|vandal\w*|trespass\w*|caught(?! on (?:camera|video))|suspect\w*|smuggl\w*|scam\w*|"
              r"fraud\w*|drunk|naked|neighbors?|dispute\w*|feud\w*|lawsuit|sues?|sued)\b")
GOOGLE = "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q="
SOURCES = {
    "good": [
        ("NASA", "https://www.nasa.gov/feed/", None),
        ("Science News Explores", "https://www.snexplores.org/feed", None),
        ("Good News Network", "https://www.goodnewsnetwork.org/category/news/animals/feed/", None),
        ("Good Good Good", "https://www.goodgoodgood.co/articles/rss.xml", None),
        ("Smithsonian", "https://www.smithsonianmag.com/rss/smart-news/", None),
        ("Atlas Obscura", "https://www.atlasobscura.com/feeds/latest", None),
        ("UPI Odd News", "https://rss.upi.com/news/odd_news.rss", None),
        ("Seven Days", "https://www.sevendaysvt.com/category/arts-culture/feed/", None),
        ("Seven Days WTF", "https://www.sevendaysvt.com/category/wtf/feed/", None),
        ("Vermont Public", "https://www.vermontpublic.org/local-news.rss", None),
        ("Yankee", "https://newengland.com/feed/", None),
    ],
    "nosy": [
        ("The Smoking Gun", "https://www.thesmokinggun.com/rss.xml", None),
        ("UPI Odd News", "https://rss.upi.com/news/odd_news.rss", CRIME_WORD),
        ("NY Post", "https://nypost.com/weird-but-true/feed/", CRIME_WORD),
        ("Google News", GOOGLE + "Vermont+police+stolen+when:30d", CRIME_WORD),
        ("Google News", GOOGLE + "Vermont+burglary+arrested+when:30d", CRIME_WORD),
        ("Google News", GOOGLE + "police+bizarre+stolen+when:30d", CRIME_WORD),
        ("Fark", "https://www.fark.com/fark.rss", CRIME_WORD),
        ("Daily Star", "https://www.dailystar.co.uk/news/weird-news/?service=rss", CRIME_WORD),
        ("Mirror", "https://www.mirror.co.uk/news/weird-news/?service=rss", CRIME_WORD),
        ("Sky News", "https://feeds.skynews.com/feeds/rss/strange.xml", CRIME_WORD),
        ("Universal Hub", "https://www.universalhub.com/rss.xml", CRIME_WORD),
        ("WCAX", "https://www.wcax.com/arc/outboundfeeds/rss/?outputType=xml", CRIME_WORD),
        ("NBC5", "https://www.mynbc5.com/local-news-rss", CRIME_WORD),
        ("Boston.com", "https://www.boston.com/tag/crime/feed/", None),
        ("NBC Boston", "https://www.nbcboston.com/news/local/feed/", CRIME_WORD),
        ("MassLive", "https://www.masslive.com/arc/outboundfeeds/rss/category/police-fire/?outputType=xml", CRIME_WORD),
        ("WMUR", "https://www.wmur.com/local-news-rss", CRIME_WORD),
        ("WGME", "https://www.wgme.com/news/local.rss", CRIME_WORD),
    ],
    "tech": [
        ("The Verge", "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", None),
        ("Ars Technica", "https://arstechnica.com/ai/feed/", None),
        ("TechCrunch", "https://techcrunch.com/category/startups/feed/", None),
        ("Hacker News", "https://hnrss.org/best", None),
        ("Simon Willison", "https://simonwillison.net/atom/everything/", None),
    ],
}

POLITICS = re.compile(
    r"\b(trump|biden|harris|vance|obama|congress\w*|senat\w+|republican\w*|democrat\w*|gop|election\w*|ballot\w*|"
    r"governor\w*|gubernatorial|white house|supreme court|president\w*|lawmaker\w*|legislat\w+|campaign\w*|"
    r"tariff\w*|immigra\w+|ice raid|deport\w*|shutdown|abortion|gaza|israel\w*|ukrain\w*|russia\w*|pentagon|"
    r"vote[rs]?|voting|midterm\w*|partisan|impeach\w*|parliament\w*|prime minister|"
    r"(?:green|labou?r|tory|conservative|liberal|political) party)\b", re.I)
GRIM = re.compile(
    r"\b(kill\w*|dead|deadly|death\w*|dies?|died|dying|murder\w*|homicide|shoot\w*|shot|gun\w*|firearm\w*|"
    r"(?:back)?stab\w*|armed|rap(?:e|ed|es|ing|ist|ists)|sex\w*|assault\w*|attack\w*|injur\w*|wound\w*|hospitali[sz]ed|mutilat\w*|"
    r"arson\w*|crash\w*|drown\w*|molest\w*|child porn\w*|groom\w*|predator\w*|domestic|strangl\w*|overdos\w*|"
    r"drugs?|fentanyl|heroin|cocaine|fatal\w*|massacre|bomb\w*|terror\w*|war|hostage|kidnap\w*|"
    r"abus\w+|lewd\w*|indecent\w*|obscen\w*|jerkoff|trafficking|corpse|body found|remains|cancer|mourn\w*|tragedy|tragic)\b", re.I)
SELF_HARM = re.compile(r"\b(suicid\w*|self-harm|kill(?:s|ed|ing)? (?:him|her|them)sel(?:f|ves))\b", re.I)
NOISE = re.compile(r"\bfor media\b|^(LTE|Opinion|Sponsored|Gift guide)\b|founder summit|^town by town\b|"
                   r"\b(?:astrology|horoscopes?|crossword|sudoku)\b|\bpolice logs?\b|"
                   r"\bmug ?shots?\b|\bphoto fun\b|\bmatch (?:the arrestee|game)\b|"      # The Smoking Gun's booking-photo games
                   r"^quoting\b|^[\w.-]+/[\w.-]+$|\b\d+\.\d+(?:\.\d+)?(?:(?:a|b|rc)\d+)?$", re.I)   # a blog's quote, repo and release posts
# A child by age: 9-year-old, nine-year-old, ", 12," or "(14)". Good news may
# still say "kids"; only Nosy, whose stories are police stories, drops the word.
AGED = re.compile(r"\b(?:[1-9]|1[0-7]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\w+teen)"
                  r"[- ](?:years?|yrs?)[- ]old\b|\b(?:[1-9]|1[0-7])[- ]?yo\b|[,(]\s*(?:[1-9]|1[0-7])\s*[,)]", re.I)
YOUNG = re.compile(r"\b(teen\w*|preteen\w*|tween\w*|boys?|girls?|schoolboys?|schoolgirls?|juvenile\w*|minors|a minor|"
                   r"students?|pupils?|kids?|child\w*|toddlers?|infants?|bab(?:y|ies)|newborns?|sons?|daughters?|trick-or-treat\w*)\b", re.I)
# title_guard knows first names; a police story's name can be any surname. Two
# capitalised words before a lowercase verb or a comma read as a person unless
# one of them is an everyday word, and so does a capitalised word after a
# possessive place ("Burlington's Hernandez stole").
SURNAME = r"[A-Z][a-z]+(?:[’'-][A-Za-z]+)?"
PAIR = re.compile(rf"(?<![\w’'-])({SURNAME})\s+({SURNAME})(?=,|\s+[a-z])")
POSSESSIVE = re.compile(rf"\b[A-Z][a-z]+[’']s\s+{SURNAME}\s+[a-z]")
NOT_A_NAME = set(
    "a an the this that these those his her their my our one two three four five six seven eight nine ten "
    "after before when while how why what who where as at by for from in into of off on over to up with "
    "man men woman women guy guys couple family people person neighbor neighbors resident residents driver "
    "drivers owner owners worker workers employee employees customer customers police cop cops officer officers "
    "deputy deputies sheriff trooper troopers state city town county village department dept fire rescue court "
    "district attorney federal national public local new old north south east west northern southern eastern "
    "western upper lower central mount mt saint st san santa los las fort lake river hill bay beach island "
    "street road route highway interstate avenue park plaza square junction falls center centre mall market "
    "store shop bank school high college university hospital airport church station stadium arena hotel "
    "florida vermont boston massachusetts mass maine connecticut hampshire york jersey island texas california "
    "america american british britain english england scotland scottish irish ireland london uk us usa "
    "halloween christmas thanksgiving easter monday tuesday wednesday thursday friday saturday sunday "
    "january february march april may june july august september october november december "
    "red green blue black white pink gold silver big little small great good bad best worst strange weird "
    "stolen stole suspect suspects thief thieves burglar burglars robber robbers cops watch video photo photos".split())
# A story that says this is about a child, however its headline reads. Words of
# the police report, not YOUNG's "son" or "kids", which a story can use in passing.
A_MINOR = re.compile(r"\b(?:a minor|minors|juveniles?|teen(?:ager)?s?|(?:[1-9]|1[0-7])[- ]years?[- ]old)\b", re.I)
APOD = re.compile(r"^(?:APOD: \d{4} \w+ \d{1,2}\s*[–-]\s*|(?:watch|look): )", re.I)   # NASA's filing and UPI's video labels
TAG = re.compile(r"\s*\[[A-Z][\w ]*\]$")   # Fark's own label on the end of a headline
# Public figures the first-name list would otherwise hold back, on top of title_guard.PUBLIC.
FIGURES = re.compile(r"\b(Sam Altman|Mark Zuckerberg|Tim Cook|Jeff Bezos|Steve Jobs|Steve Wozniak|Bill Gates|Larry Page|"
                     r"Larry Ellison|Jack Dorsey|Peter Thiel|Paul Graham|Mark Gurman|Ben Thompson|Tim Berners-Lee)\b")
# Good news only: a smile, not a state budget or somebody's lottery ticket.
OFF_BRIEF = re.compile(r"\b(lotter\w+|powerball|mega millions|jackpot|scratch-?off\w*|budget\w*|tax|taxes|"
                       r"consolidat\w+|school board\w*|pledges?)\b", re.I)
PLACE_PAGE = re.compile(r"\bin [A-Z][\w.'’ -]+, [A-Z][a-z]+(?: [A-Z][a-z]+)?$")   # "... in Durham, North Carolina"
# Words any two local headlines can share, so two of them are not one story.
COMMON = set("""the and for with from that this was were who has have had into out after over about near his her
their but not are all new man men woman women people police cop state city town county local say said says
one two three four five week day sunday monday tuesday wednesday thursday friday saturday""".split())
NUMBER = dict(zip("two three four five six seven eight nine ten".split(), "2 3 4 5 6 7 8 9 10".split()))
RARE_WORD = 5                 # letters: "dolphin" names a story, "cat" does not
RARE_HEADLINES = 3            # in this few of a feed's headlines: a story in three outlets is still one story
TAGS = re.compile(r"<[^>]+>")
IMG = re.compile(r"""<img[^>]+src=["'](https://[^"']+)["']""", re.I)
ATOM = "{http://www.w3.org/2005/Atom}"
MEDIA = "{http://search.yahoo.com/mrss/}"
CONTENT = "{http://purl.org/rss/1.0/modules/content/}"
UNREAD = re.compile(r"<(script|style)\b.*?</\1>", re.S | re.I)
PARAGRAPH = re.compile(r"<p\b[^>]*>(.*?)</p>", re.S | re.I)
FARK_LINK = re.compile(r'href="(https://www\.fark\.com/goto/\d+/[^"]+)"')
GOOGLE_SIGN = re.compile(r'data-n-a-sg="([^"]+)"')
GOOGLE_TIME = re.compile(r'data-n-a-ts="(\d+)"')
GOOGLE_TARGET = re.compile(r'garturlres\\",\\"(https?:[^"\\]+)')
GOOGLE_DECODE = "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je"


def log(m: str) -> None:
    print(m, file=sys.stderr, flush=True)


def clean(text: object) -> str:
    return TAG.sub("", APOD.sub("", " ".join(html.unescape(TAGS.sub(" ", str(text or ""))).split())))


def when(text: str | None) -> int:
    if not text:
        return 0
    t = text.strip()
    try:
        return int(parsedate_to_datetime(t).timestamp())
    except (TypeError, ValueError):
        pass
    try:
        return int(datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return 0


def picture(e: ET.Element, body: str) -> str:
    for tag in (MEDIA + "content", MEDIA + "thumbnail"):
        for m in e.iter(tag):
            u = m.get("url") or ""
            if u.startswith("https://") and m.get("medium", "image") == "image":
                return u
    for m in e.findall("enclosure"):
        u = m.get("url") or ""
        if u.startswith("https://") and (m.get("type") or "image").startswith("image"):
            return u
    hit = IMG.search(body)
    # A src in HTML is escaped (&#038;), and WordPress serves any width it is asked for.
    return re.sub(r"([?&]w=)\d{4}\b", r"\g<1>600", html.unescape(hit.group(1))) if hit else ""


def by_outlet(x: dict) -> dict:
    """Google News signs each headline " - WCAX"; that is the source to show."""
    if "news.google.com" in x["u"] and " - " in x["t"]:
        x["t"], _, outlet = x["t"].rpartition(" - ")
        x["s"] = outlet.split(" | ")[0]
    return x


def parse_feed(xml_text: str) -> list[dict]:
    """RSS or Atom -> [{t, u, ts, i}], newest as the feed gave them. A bad
    entry is skipped."""
    root = ET.fromstring(xml_text)
    out = []
    for e in root.iter("item"):
        body = (e.findtext(CONTENT + "encoded") or "") + (e.findtext("description") or "")
        out.append({"t": clean(e.findtext("title")), "u": (e.findtext("link") or "").strip(),
                    "ts": when(e.findtext("pubDate") or e.findtext("{http://purl.org/dc/elements/1.1/}date")),
                    "i": picture(e, body)})
    for e in root.iter(ATOM + "entry"):
        link = next((a.get("href") for a in e.findall(ATOM + "link") if a.get("rel", "alternate") == "alternate"), "")
        body = (e.findtext(ATOM + "content") or "") + (e.findtext(ATOM + "summary") or "")
        out.append({"t": clean(e.findtext(ATOM + "title")), "u": (link or "").strip(),
                    "ts": when(e.findtext(ATOM + "published") or e.findtext(ATOM + "updated")),
                    "i": picture(e, body)})
    return [by_outlet(x) for x in out if x["t"] and x["u"].startswith("https://") and x["ts"]]


def names_someone(feed: str, title: str) -> bool:
    """A private person's name, by first name or, on Nosy, by its shape."""
    if names_person(FIGURES.sub(" ", title)):
        return True
    return feed == "nosy" and (bool(POSSESSIVE.search(title)) or any(
        m.group(1).lower() not in NOT_A_NAME and m.group(2).lower() not in NOT_A_NAME for m in PAIR.finditer(title)))


def foreign_script(text: str) -> bool:
    """A headline or an outlet a reader of this page cannot read, like 스포츠조선."""
    return any(ch.isalpha() and ord(ch) > 0x24F for ch in text)


def keeps(feed: str, title: str, only: str | None = None) -> bool:
    if len(title) > TITLE_MAX or len(title.split()) < TITLE_MIN_WORDS or CONTACT.search(title) or NOISE.search(title):
        return False
    if foreign_script(title):
        return False
    if only and not re.search(only, title, re.I):
        return False
    if POLITICS.search(title) or SELF_HARM.search(title) or AGED.search(title) or names_someone(feed, title):
        return False
    if feed == "tech":
        return True
    if GRIM.search(title):
        return False
    if feed == "good":
        return not (OFF_BRIEF.search(title) or PLACE_PAGE.search(title))
    return not YOUNG.search(title)


NAMES = "Drop any headline that names a private person, even by surname alone, or names a child or gives a child's age."
JUDGE = {
    "good": "Be strict: when in doubt, drop it, and expect to drop about half. Keep a headline only if a person "
            "who avoids the news would smile at it or tell a friend: animals, space, discoveries, odd history, a "
            "strange place with a story, nature, people being kind or clever, and Vermont fun such as art, food "
            "and oddities. It must tell something good or delightful that happened, on its own: a poetic title that "
            "only names a thing tells nothing. Drop politics, "
            "government, state policy, journalism, budgets, school funding and mergers, foreign aid, business, "
            "the tech industry, AI, lotteries, sales and gift guides, event listings, travel, shopping and recipe "
            "lists, advice and explainers, interviews, tributes and obituaries, a place or a building that is "
            "only a name and a location, a specimen, map or object with no story, animals or people in trouble "
            "or decline, and anything sad, frightening or worrying. " + NAMES,
    "nosy": "Keep a headline only if a reader would repeat it to a friend: a light story about a crime, a police "
            "call or a neighbor dispute with a twist or an odd detail, such as gates stolen from a cemetery, a "
            "stolen ATM, a naked stroll, a thief outwitted, a false alarm, police called over something silly, a "
            "ridiculous excuse. A plain theft counts only in a named Vermont town and only if it says what was "
            "taken. Drop routine arrests, warrants, bail, court dates, police logs, roundups, and ordinary "
            "burglaries, fraud and drunk driving. An accident or a funny animal with no police in it is not "
            "one. Drop anything about a minor, whichever side of the crime they are on, and anything done to "
            "trick-or-treaters. Drop anything where someone was hurt, any death, fire with injuries, armed "
            "robbery, sexual or domestic violence, anything crude, abuse, self-harm, drugs, guns and weapons, a "
            "trial with a real victim, a victim left shaken or out of something that mattered to them, politics, and "
            "courts of national importance. Drop a plain theft from a trade site or with no town, and a headline "
            "that makes no sense without its article or its picture. " + NAMES + " A headline may come with the "
            "opening of its story, there to show what really happened: a headline can hide a minor, an injury, a "
            "death or a weapon, and the rules above apply to all of that. Names and adult ages in the story are "
            "normal for a police story and do not count against it: only the headline's own words are checked "
            "for names. A silly crime stays a keep when its story names the man who did it.",
    "tech": "Keep a headline only if it is about technology, AI, software, science or startups and says what "
            "happened on its own. Drop politics and energy policy, a bare software release, a quote post, a link "
            "that is only a project's name, and anything about suicide or self-harm. A well-known founder, "
            "executive or researcher may be named. " + NAMES,
}
JUDGE_MAX = 60                # new headlines a feed sends to the model in a run
JUDGE_MONTH_CAP_USD = 3.0     # Sonnet and Haiku together; a steady month is about $2
HEADLINE_USD = 0.0025         # what a verdict is budgeted at: Sonnet's measured $0.0022 with a story, rounded up
TZ = ZoneInfo("America/New_York")
SPENT: list[tuple[str, dict]] = []  # (model, usage) of each call since the last log_cost
ONE_BY_ONE = {"good", "nosy"} # asked one headline a call; the rest go as one list
ONE_TOKENS = 4000             # Sonnet's thinking cannot be turned off, and it counts
ONE_WORKERS = 8
ONE_TIMEOUT_S = 30            # one call, no retry: an unanswered headline is asked next run
ONE_TIME_S = 60               # no new headline past this, so two feeds and the RSS fit the step's five minutes
KEEP_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["keep"],
               "properties": {"keep": {"type": "array", "items": {"type": "integer"}}}}


def ask_list(engine, feed: str, fresh: list[dict], tokens: int, **kw) -> set[str]:
    """The URLs the model keeps, of a numbered list. Anything short of a
    readable answer raises, so a bad night never reads as a verdict."""
    import wire_common as wc
    text = "HEADLINES:\n" + "\n".join(f"{i}. {x['t']} ({x['s']})" + (f"\nStory: {x['story']}" if x.get("story") else "")
                                       for i, x in enumerate(fresh))
    try:
        answer, got = wc.ask_json(engine, JUDGE[feed] + " Return the numbers to keep.", text, KEEP_SCHEMA,
                                  max_tokens=tokens, log_prefix="interests", **kw)
    except Exception as e:
        SPENT.append((engine["model"], getattr(e, "usage", None) or {}))    # a failed attempt is still billed
        raise
    SPENT.append((engine["model"], got))
    return {fresh[i]["u"] for i in answer["keep"] if isinstance(i, int) and 0 <= i < len(fresh)}


def ask_each(feed: str, fresh: list[dict]) -> dict[str, bool]:
    """Sonnet on one headline at a time: {url: keep?} for those it answered.
    One that fails, or that the clock reaches first, is simply not in it."""
    import wire_common as wc
    engine = wc.pick_engine("judge")
    if not engine:
        raise RuntimeError("no Anthropic key")
    deadline = time.monotonic() + ONE_TIME_S

    def one(x):
        if time.monotonic() > deadline:
            return None
        story = story_of(x["u"]) if feed in READS_STORY else ""
        if A_MINOR.search(story):
            return x["u"], False
        try:
            return x["u"], x["u"] in ask_list(engine, feed, [{**x, "story": story}], ONE_TOKENS, attempts=1, timeout=ONE_TIMEOUT_S)
        except Exception as e:  # noqa: BLE001 one headline never costs the others
            log(f"{feed}: no verdict on a headline ({str(e)[:70]})")
            return None

    with cf.ThreadPoolExecutor(ONE_WORKERS) as pool:
        got = dict(a for a in pool.map(one, fresh) if a)
    if not got:
        raise RuntimeError("no headline answered")
    return got


def ask_model(feed: str, fresh: list[dict]) -> dict[str, bool]:
    """{url: keep?} for the headlines the model answered. Raises when it
    answered none."""
    if feed in ONE_BY_ONE:
        return ask_each(feed, fresh)
    import wire_common as wc
    engine = wc.pick_engine("curate")       # a verdict is kept, so it gets the more careful read
    if not engine:
        raise RuntimeError("no model key")
    yes = ask_list(engine, feed, fresh, 6 * len(fresh) + 200)
    return {x["u"]: x["u"] in yes for x in fresh}


def same_title(title: str) -> str:
    return re.sub(r"\W+", "", title.lower())[:60]


def judge(feed: str, items: list[dict], memory: dict, ask=ask_model, room: int = JUDGE_MAX) -> list[dict]:
    """The rules above catch words; this catches meaning. `memory` is the
    model's verdicts, {url: [1 or 0, the item's ts]}: each headline is asked
    about once, whatever URLs it comes under, and only a yes in it is approved.
    An outage records nothing, and neither does a month past its cap (`room`
    is how many verdicts the month can still pay for)."""
    known = {same_title(x["t"]): memory[x["u"]][0] for x in items if x["u"] in memory}
    twins: dict[str, list[dict]] = {}
    for x in items:
        if x["u"] in memory:
            continue
        key = same_title(x["t"])
        if key in known:
            memory[x["u"]] = [known[key], x["ts"]]
        else:
            twins.setdefault(key, []).append(x)
    asked = [xs[0] for xs in twins.values()][:max(0, min(JUDGE_MAX, room))]
    unjudged = bool(twins) and not asked and feed in FAIL_OPEN      # what a headline with no verdict counts as
    if twins and not asked:
        log(f"{feed}: the month's judge cap is spent; {len(twins)} headline(s) wait")
    if asked:
        try:
            said = ask(feed, asked)
            for x in asked:
                if x["u"] in said:
                    memory.update({y["u"]: [int(said[x["u"]]), y["ts"]] for y in twins[same_title(x["t"])]})
            log(f"{feed}: judge kept {sum(said.values())} of {len(said)}, {len(asked) - len(said)} unanswered")
        except Exception as e:  # noqa: BLE001 a model never costs the file
            log(f"{feed}: judge failed ({str(e)[:70]})")
            unjudged = feed in FAIL_OPEN
    return [x for x in items if memory.get(x["u"], [unjudged])[0]]


def month_of(now: float) -> str:
    return datetime.fromtimestamp(now, TZ).strftime("%Y-%m")


def month_spent(memory: dict, now: float) -> float:
    ai = memory.get("ai") or {}
    return float(ai.get("usd") or 0) if ai.get("month") == month_of(now) else 0.0


def log_cost(memory: dict, now: float, feed: str) -> None:
    """Move what the calls since the last time spent into the `ai` block."""
    calls, SPENT[:] = list(SPENT), []
    if not calls:
        return
    import wire_common as wc
    usd = sum(wc.cost_usd(m, u) for m, u in calls)
    ai = memory.get("ai") if month_spent(memory, now) else None
    ai = ai or {"month": month_of(now), "usd": 0.0, "runs": []}
    ai["usd"] = round(ai["usd"] + usd, 6)
    ai["runs"] = ai["runs"][-185:] + [{
        "at": datetime.fromtimestamp(now, TZ).isoformat(timespec="seconds"), "feed": feed, "model": calls[0][0],
        "calls": len(calls), "in": sum(u.get("in", 0) for _, u in calls),
        "out": sum(u.get("out", 0) for _, u in calls), "usd": round(usd, 6)}]
    memory["ai"] = ai
    log(f"{feed}: {len(calls)} call(s), ${usd:.4f}; ${ai['usd']:.2f} this month (cap ${JUDGE_MONTH_CAP_USD:.2f})")


def words(title: str) -> set[str]:
    """What a headline is about, for telling two outlets' takes on one story."""
    found = (NUMBER.get(w, w) for w in re.findall(r"[a-z0-9]+", title.lower()))
    return {w[:-1] if w.endswith("s") else w for w in found if len(w) >= 3 or w.isdigit()} - COMMON


def same_story(a: dict, b: dict, rare: set[str] = frozenset()) -> bool:
    """Two outlets on one event share its who, what and where, whatever
    their wording: suspects, ATM and Pittsford. Two shared words will do when
    one of them is rare in the feed: Bugatti and CEO, dolphin and 6. One
    outlet's own headlines can share a town and be two stories."""
    shared = words(a["t"]) & words(b["t"])
    return a["s"] != b["s"] and (len(shared) >= 3 or (len(shared) >= 2 and bool(shared & rare)))


def tidy(feed: str, items: list[dict]) -> list[dict]:
    """Newest first, one headline per story, no source past its cap."""
    out: list[dict] = []
    keys: set[str] = set()
    per: dict[str, int] = {}
    seen = Counter(w for x in items for w in words(x["t"]))
    rare = {w for w, n in seen.items() if n <= RARE_HEADLINES and len(w) >= RARE_WORD}
    for x in sorted(items, key=lambda x: -x["ts"]):
        key = same_title(x["t"])
        if key in keys or any(same_story(x, y, rare) for y in out):
            continue
        per[x["s"]] = per.get(x["s"], 0) + 1
        if per[x["s"]] > SOURCE_CAP.get(x["s"], PER_SOURCE):
            continue
        keys.add(key)
        out.append({k: v for k, v in x.items() if v and not (k == "i" and feed in NO_PICTURE)})
    return out[:PER_FEED]


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml, */*"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.read(3_000_000).decode("utf-8", "replace")


def post_form(url: str, form: dict) -> str:
    req = urllib.request.Request(url, data=urllib.parse.urlencode(form).encode(), headers={
        "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.read(100_000).decode("utf-8", "replace")


def google_target(url: str, page: str, send=post_form) -> str:
    """Where a Google News link really goes. Google's page does the redirect
    with this one signed call; the link itself no longer decodes. "" if it changes."""
    sign, stamp = GOOGLE_SIGN.search(page), GOOGLE_TIME.search(page)
    if not sign or not stamp:
        return ""
    code = url.split("/articles/")[-1].split("?")[0]
    args = ["garturlreq", [["X", "X", ["X", "X"], None, None, 1, 1, "US:en", None, 1, None, None, None, None, None, 0, 1],
                           "X", "X", 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0], code, int(stamp.group(1)), sign.group(1)]
    hit = GOOGLE_TARGET.search(send(GOOGLE_DECODE, {"f.req": json.dumps([[["Fbv4je", json.dumps(args)]]])}))
    return hit.group(1) if hit else ""


def story_of(url: str, read=fetch, send=post_form) -> str:
    """The opening of a headline's story, or "" when the page will not give it."""
    try:
        page = read(url)
        target = ""
        if "news.google.com" in url:
            target = google_target(url, page, send)
            if not target:
                return ""
        elif "fark.com/comments" in url:
            hit = FARK_LINK.search(page)
            target = hit.group(1) if hit else ""
            if not target:
                return ""
        page = read(target) if target else page
    except Exception as e:  # noqa: BLE001 the judge still has the headline
        log(f"story: {str(e)[:70]}")
        return ""
    paragraphs = (clean(p) for p in PARAGRAPH.findall(UNREAD.sub(" ", page)))
    return " ".join(p for p in paragraphs if len(p) >= STORY_MIN_PARAGRAPH)[:STORY_CHARS]


def build(prev: dict, now: float, sources: dict | None = None, read=fetch, ask=ask_model,
          memory: dict | None = None) -> dict:
    memory = {} if memory is None else memory
    feeds = {}
    for feed, rows in (SOURCES if sources is None else sources).items():
        cutoff = now - KEEP_DAYS[feed] * 86400
        judged = memory.setdefault(feed, {})
        got = {x["u"]: x for x in prev.get(feed) or []
               if x.get("u") and x.get("ts", 0) >= cutoff and keeps(feed, x.get("t", ""))
               and not foreign_script(x.get("s", ""))}
        for name, url, only in rows:
            try:
                items = parse_feed(read(url))
            except Exception as e:  # noqa: BLE001 one bad feed never costs the others
                log(f"{feed}: {name} failed ({str(e)[:70]}); keeping its last good items")
                continue
            for x in items:
                got.pop(x["u"], None)           # a headline can change; today's wording is what is judged
                x = {"s": name, **x}
                if x["ts"] >= cutoff and keeps(feed, x["t"], only) and not foreign_script(x["s"]):
                    got[x["u"]] = x
            log(f"{feed}: {name}: read {len(items)}")
        room = int((JUDGE_MONTH_CAP_USD - month_spent(memory, now)) / HEADLINE_USD)
        feeds[feed] = tidy(feed, judge(feed, list(got.values()), judged, ask, room))
        log_cost(memory, now, feed)
        memory[feed] = {u: v for u, v in judged.items() if v[1] >= cutoff}
    return feeds


def load_judged(path: pathlib.Path) -> dict:
    """The verdicts so far. Unreadable means asking again, never approving."""
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        out = {feed: {u: v for u, v in doc.get(feed, {}).items() if isinstance(v, list) and len(v) == 2}
               for feed in KEEP_DAYS}
        if isinstance(doc.get("ai"), dict):
            out["ai"] = doc["ai"]
        return out
    except (OSError, ValueError, AttributeError):
        return {}


def write(path: pathlib.Path, doc: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=pathlib.Path, default=OUT)
    ap.add_argument("--judged", type=pathlib.Path, default=JUDGED)
    args = ap.parse_args()
    try:
        prev = json.loads(args.out.read_text(encoding="utf-8")).get("feeds") or {}
    except (OSError, ValueError):
        prev = {}
    memory = load_judged(args.judged)
    feeds = build(prev, time.time(), memory=memory)
    write(args.judged, memory)
    if not any(feeds.values()):
        log("nothing read; the last good file stays")
        return 0
    write(args.out, {"generated": datetime.now().astimezone().isoformat(timespec="seconds"), "feeds": feeds})
    log("wrote " + ", ".join(f"{k} {len(v)}" for k, v in feeds.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
