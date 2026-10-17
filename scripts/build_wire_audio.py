#!/usr/bin/env python3
"""The Brief, out loud: a two-to-three-minute morning audio brief from the Wire.

Every morning at 7 Eastern (.github/workflows/wire-audio.yml):

  1. Read today's Wire (wire-today.json on the wire-data branch). Before the
     morning's picks are ranked, today's paper is too thin to read from, so
     yesterday's frozen edition (data/wire/YYYY-MM-DD.json) is used instead,
     and the brief says so.
  2. Take the top local picks (up to twelve), in rank order. Facts come from
     their headlines (and an item's own text, when it has any) and nothing
     else: the Wire's one-line reasons are passed to the writer marked as an
     editor's note that may shape emphasis and order but is never a source,
     and they are left out of every check's source set. (The first Opus
     clip said a panel was free because pick 7's reason did; its headline
     never did.)
  3. Ask Claude Opus 5.5 (ANTHROPIC_API_KEY) for the body of a 400 to 500
     word script, written the way a neighbour tells you what's in the paper:
     contractions, sentences of different lengths, a spoken turn between
     stories, and a few pacing marks the voice takes as direction (TAGS:
     [pause], [short pause], [slowly], [softly] and the like, plus
     ellipses). The first clip read like a bulletin, flat and unbroken, and
     Stephen heard it as a machine. Opus only: this is the Brief speaking in
     its own name, and accuracy here is the product, so there is no cheaper
     fallback (GLM 5.3 Flash, tried on the first test runs, invented a
     candidate's first name and gender). No key, no clip. The greeting and
     the sign-off are fixed text added here.
  4. Check the body mechanically, the way curate_wire.py checks its reasons:
     no fact the headlines and reasons do not give (curate_wire.invented:
     a number, a weekday or month, "free", a capitalized name; and a pronoun
     that gives someone a gender), no run of eight words copied from a
     headline, no list, and the length. A draft that passes is fact-checked
     sentence by sentence by a second call. Pacing marks are taken out
     before every check and before the fact check reads the draft (plain()),
     so a mark can neither hide a word from a check nor be flagged as one;
     a bracket that is not one of TAGS sends the draft back and never ships
     or reaches the voice (unknown_marks()). Up to two rewrites name what was
     wrong; a draft that still invents means no clip today, never a wrong one.
  5. Send the script to ElevenLabs (eleven_v4, the quality model: the brief
     is made ahead, so it never needs Turbo's speed; the voice in
     ELEVENLABS_VOICE_ID, default Wyatt, a voice ElevenLabs itself owns;
     STABILITY and SIMILARITY say why they are set where they are),
     then one ffmpeg pass: loudness to -16 LUFS, true peak -1 dB, mono MP3
     at 64 kbps (research/tts-options.md, "Best format to publish").
  6. Publish data/audio/YYYY-MM-DD.mp3, the script beside it as
     YYYY-MM-DD.txt, and data/audio/index.json (date, duration, bytes, the
     script's file name and the rest), keeping a rolling 30 days. The
     workflow force-pushes that folder as the single commit of the orphan
     wire-audio branch, so old MP3s never pile up in git history.

Failure posture: no ELEVENLABS_API_KEY, no ANTHROPIC_API_KEY, a month cap, or an
invented fact logs, exits 0 and writes nothing, so the page keeps showing the
most recent clip with its date. When the key exists but the newest clip is
more than STALE_DAYS old, a failure exits 1 so the broken pipeline is seen.

Costs: the model's tokens and ElevenLabs' characters go to data/audio/
cost.json, month to date. The script refuses the model once LLM_CAP_USD is
spent and refuses ElevenLabs once TTS_CAP_USD of characters at the model's
API rate is spent, so a loop can never run up a bill.

CLI:
  --out-dir DIR      the data/audio folder to publish into (default data/audio)
  --wire-file PATH   read wire-today.json from a file (else the wire-data branch)
  --edition-file P   read yesterday's frozen edition from a file
  --date YYYY-MM-DD  make the clip for that day (default: today in Burlington)
  --script-only      stage one alone: write and check the script, save it as
                     YYYY-MM-DD.txt with pending.json beside it, no voice
                     (needs only ANTHROPIC_API_KEY)
  --audio-from P     stage two alone: voice and publish an existing script
                     (needs only ELEVENLABS_API_KEY; reads pending.json
                     beside P for the teaser and the rest)
  --dry-run          write and check the script, print it, call no TTS
  --force            make today's clip even if one exists
  --selftest         run the offline checks and exit
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wire_common as wc  # noqa: E402
from curate_wire import invented  # noqa: E402  (the reasons pass's invented-fact guard)

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SECRETS = os.path.expanduser("~/.config/btownbrief/secrets.env")
RAW = "https://raw.githubusercontent.com/btownbrief/btown-brief/wire-data/data/"
UA = "btown-wire-audio/1.0"

API = "https://api.elevenlabs.io/v1"
# eleven_v4 is ElevenLabs' quality-first model and eleven_v4_turbo its
# real-time one. The brief is written and voiced ahead of 7 am, so speed buys
# nothing and quality wins: about $0.20 a clip at v4's rate, against $0.10.
MODEL = "eleven_v4"
DEFAULT_VOICE = "FrS6cKLB1wg4WYgPa9GW"     # Wyatt, made and kept by ElevenLabs (4,015-day notice)
OUTPUT_FORMAT = "mp3_44100_64"
USD_PER_1K_CHARS = {"eleven_v4_turbo": 0.04, "eleven_v4": 0.08}   # API pricing page, 2026-10-16
# v4 has no speed or style slider; these two are the voice's only dials.
# Stability 0.5 (the middle) gave the first clip its flat, even read: lower
# lets the voice move more between sentences. Similarity 0.75 held it close
# to the reference recording at the cost of naturalness; 0.65 loosens that
# without losing the voice. (ElevenLabs' own guidance, 2026-10.)
STABILITY = 0.4
SIMILARITY = 0.65

# Length, the whole script with the greeting and sign-off. 400 to 500 is the
# target the writer is given; a shorter brief that is all true is a finished
# one (facts come from headlines alone, and a headline holds a sentence or
# two), so only SHORT_OK and WORDS_MAX send a draft back. Never padding.
WORDS_MIN, WORDS_MAX = 400, 500
# SHORT_OK and WORDS_SOFT_MIN were 250 and 230 when the greeting and sign-off
# ran 67 words; they run 41 now, so both come down 26 to ask the same of the body.
SHORT_OK = 224                             # twelve headlines told plainly run about 270 with the old fixed text
WORDS_SOFT_MIN, WORDS_SOFT_MAX = 204, 560  # after the rewrites, close enough to ship
STORIES_MAX = 12
STORIES_MIN = 4                            # fewer local picks than this and today is too thin
COPY_RUN = 8                               # words in a row copied from a headline
KEEP_DAYS = 30
STALE_DAYS = 3
LLM_CAP_USD = 8.0                          # about $0.05 to $0.20 a day; this only stops a runaway
DRAFTS = 3                                 # a draft and up to two rewrites, each fact-checked
# The voice's monthly ceiling in dollars at the model's API rate, so it stays
# honest whichever model runs: $8 is about 100,000 v4 characters, a month of
# clips (about 2,800 characters each) with room for a re-run or two. The
# plan's own allowance runs out first (Starter includes 30,000 v4
# characters, about twelve clips); past it ElevenLabs bills the top-up or
# refuses, and a refusal is a loud failure once the clips go stale.
TTS_CAP_USD = 8.0
MAX_TOKENS = {"openrouter": 6000, "anthropic": 16000}   # Opus's draft plus its fact check ran past 8,000
WRITER = {"provider": "anthropic", "model": "claude-opus-5-5"}   # never a cheaper fallback

# Spoken place names a voice gets wrong, respelled for the voice only; the
# published script keeps the real spelling. Spot-check new names on the first runs.
RESPELL = {
    "Charlotte": "Shar-LOT",
    "Calais": "CAL-iss",
    "Vergennes": "ver-JENZ",
    "Montpelier": "mont-PEEL-yer",
    "Champlain": "sham-PLANE",
    "Lamoille": "la-MOYL",
}

# Saying an acronym or a title in full is good for the ear ("Vermont State
# Police" for "VSP", "Governor" for "Gov."), so when a headline uses one of
# these, its spelled-out words count as given. Nothing else is expanded.
ACRONYMS = {
    "VSP": "Vermont State Police",
    "AOT": "Vermont Agency of Transportation",
    "VTrans": "Vermont Agency of Transportation",
    "UVM": "University of Vermont",
    "UVMMC": "University of Vermont Medical Center",
    "BPD": "Burlington Police Department",
    "BED": "Burlington Electric Department",
    "BHS": "Burlington High School",
    "CCV": "Community College of Vermont",
    "VTSU": "Vermont State University",
    "GMT": "Green Mountain Transit",
    "DMV": "Department of Motor Vehicles",
    "DOC": "Department of Corrections",
    "DCF": "Department for Children and Families",
    "PUC": "Public Utility Commission",
    "FEMA": "Federal Emergency Management Agency",
    "Gov": "Governor",
    "Lt": "Lieutenant",
    "Sen": "Senator",
    "Rep": "Representative",
}

# Pacing marks. eleven_v4 takes no SSML breaks; it reads a word in square
# brackets placed before some text as direction for that text, never aloud.
# Too many make the voice wobble, so the writer gets a short list and a ration
# (MAX_DELIVERY and MAX_PAUSES a paragraph), and tidy_tags() enforces both:
# anything else in brackets sends the draft back and never ships (deleting
# it could change the meaning: "the vote did [not] pass"). Never an emotion
# and never a sound effect.
PAUSE_TAGS = ("pause", "short pause", "long pause")
DELIVERY_TAGS = ("slowly", "softly", "gently")
TAGS = PAUSE_TAGS + DELIVERY_TAGS
MAX_DELIVERY, MAX_PAUSES = 1, 2
# and for the whole brief (Codex review, 2026-10-17: a ration per paragraph
# still let twelve paragraphs carry twelve [long pause]s)
BRIEF_MAX = {"long pause": 3, "pause": 4, "delivery": 4}   # "pause" counts [pause] and [short pause]
BRACKET_RE = re.compile(r"\[([^\[\]\n]*)\]")
TAG_RE = re.compile(r"\[\s*(?:" + "|".join(t.replace(" ", r"\s+") for t in TAGS) + r")\s*\]", re.I)

TASK = """You write the Btown Brief, out loud: a two- to three-minute morning news brief
for Burlington, Vermont, spoken by one voice.

Who is talking: a neighbour who reads the paper every morning and tells you
what's in it. Warm, unhurried, dry when the news is dry, never chirpy, never a
bulletin. They talk the way people talk across a kitchen table, and they never
editorialise.

You get the stories, numbered in order of importance. Each is a headline, the
outlet that ran it, sometimes the story's own text, and an editor's note on why
it was picked. Write the body of the brief: every story, in the order given,
each its own short spoken paragraph. The greeting before you ends "Here's
what's going on around Burlington.", so start straight in on the first story.

The facts. These rules are hard, and nothing about the voice loosens them:
- The headline (and the story's own text, when it is given) is your only source
  of facts. The editor's note may shape what you put first and what you stress,
  but it is never a source: state nothing from the note that the headline does
  not say. Add no name, number, date, day of the week, place, price, cost or
  detail the headline does not give. When a headline is unclear, say less,
  never more. Do not guess what happened, why, or what comes next.
- If a headline gives little, say little: one plain sentence is enough. Never
  pad. No vague filler ("of some kind", "it remains to be seen", "time will
  tell"), no repeating what you just said. A sentence you cannot ground in the
  headline is left out, and a short true brief beats a long padded one.
- Never read a headline out. Retell each story in your own words. Never copy
  more than six words in a row from a headline.
- No commentary. No judgement of your own, nothing like "it's a reminder that",
  "good news" or "it shows", nothing about what a story means.
- Talking to the listener adds no fact either. "If someone calls claiming to
  be police" says the scam comes by phone; "if you're heading out this
  weekend" says when something is. Say "you" only around what the headline
  gives.
- A turn between stories asserts nothing. It may only group what the headlines
  already say: "And one for the weekend." only before a story whose headline
  says weekend, Saturday or Sunday; "Two from the state" only before two
  statewide stories; "Closer to home." only before a story whose headline
  puts it in or around Burlington, after one that is not. When unsure, use a
  turn that names no place or time: "Something different now."

How it sounds:
- Contractions, always: it's, there's, they're, won't, that's.
- Sentences of different lengths. One idea each. A four-word sentence next to
  a fifteen-word one. Never three sentences in a row built the same way.
- No two stories start the same way: not the same first word, not the same
  shape. Never a run of "X reports that", "According to" or "There is".
- Now and then, a spoken turn between stories: "Closer to home.", "Two things
  from the state this morning.", "And one for the weekend.", "Something
  different now." A few in the whole brief, not one per story.
- Name the outlet the way people say it, and not more than once every two or
  three stories: "Seven Days has that one.", "That's from WCAX.", "WCAX says".
  Never in two stories in a row, and never the same phrase twice. Most stories
  need no outlet at all.
- Write for the ear: numbers the way they are said ("4.95 million dollars"), no
  symbols, no abbreviation a listener cannot decode unless the headline uses it.
- No lists, no bullets, no "first" or "number one", no headings, no emoji, no
  parentheses.
- No greeting, no sign-off, no date, no weather: those are added for you.
- Length: about {lo} to {hi} words for the body, only if the headlines carry it.

Pacing marks. The voice takes a mark in square brackets as direction for the
words after it and never says it aloud. A few, well placed, are what make it
sound like someone talking; too many make the voice wobble.
- Each story is its own paragraph, and a [pause] is put before every one for
  you: never start a paragraph with [pause] yourself.
- [long pause] at the start of a paragraph where the brief changes direction,
  just before a turn ("[long pause] Closer to home."). Two or three in the
  whole brief at most.
- [short pause] inside a sentence for a small catch before what matters.
- An ellipsis (...) for a trailing beat inside a sentence, two or three times in
  the whole brief at most.
- At most one delivery mark a paragraph, and only [slowly] or [softly]:
  [softly] before a hard story (a death, a shooting), [slowly] before a number
  the listener needs to catch. Most paragraphs have none.
- Only these marks: [pause], [short pause], [long pause], [slowly], [softly],
  [gently]. Never an emotion, a laugh or a sound effect, and never a word that
  carries a fact inside brackets: anything else in brackets sends the draft
  back.

An example, two stories that are NOT today's, only to show the difference.
The headlines: "Burlington library extends weekend hours" (Seven Days) and
"State police investigating crash on I-89 in Richmond" (WCAX).
Written flat, the way not to:
  Seven Days reports that the Burlington library is extending its weekend
  hours. WCAX reports that state police are investigating a crash on I-89 in
  Richmond.
Written the way a person says it:
  If weekends are when you get to the library, Burlington's is keeping longer
  hours. That one's from Seven Days.

  [long pause] Out on the interstate... state police are looking into a crash
  on 89, in Richmond.
Same facts, nothing added: the second says "you", uses a contraction, names
one outlet once at the end, turns with words that only restate the headline,
and pauses where a person would.

Also write `teaser`: one plain phrase under 90 characters naming three of the
stories' topics, for the card the clip sits on, e.g. "The governor's race money,
a new interchange, and a scam warning." Same rules on facts: headlines only. No
pacing marks in the teaser."""

SCHEMA = {
    "type": "object",
    "properties": {
        "paragraphs": {"type": "array", "minItems": 1, "maxItems": 14, "items": {"type": "string", "maxLength": 900}},
        "teaser": {"type": "string", "maxLength": 120},
    },
    "required": ["paragraphs", "teaser"],
    "additionalProperties": False,
}

# The second pass: the same model reads the draft against the headlines alone
# (never the reasons) and quotes every sentence they do not support, padding
# included. The word checks above catch a
# new name or number; this catches what they cannot (seen on the first real
# run: "She's the one with the cash advantage" about a candidate no source
# gave a gender, and a line of opinion about health care stated as fact).
VERIFY_TASK = """You fact-check a short radio news script against its only sources: the
numbered headlines below, each with the outlet that ran it (and the story's own
text, when it is given). Nothing else counts as a source.

List every sentence of the script that says something the sources do not support.
Unsupported means: a name, title or role; a pronoun that gives someone a gender;
a number, date, time or place; what happened, why, or what comes next; who is
affected; an opinion, judgement or prediction stated as fact. Rewording a headline
or a note is supported. So are turns between stories and words to the listener
("If you drive...", "Something different now.", "That one's from Seven Days.")
that assert nothing new, and saying when the brief airs ("this morning"). Words to the
listener are unsupported when they imply a detail the sources do not give: "if
someone calls" when no source says the scam is by phone, "next week" when a
source gives only a date. A turn that groups
stories, or that implies a place or a time, is supported only when the headlines
bear it out: "one for the weekend" needs a headline that says the weekend,
Saturday or Sunday; "closer to home" needs the next story's headline to put it in
or around Burlington and the one before it not to. An ellipsis (...) is
a spoken pause, not a gap in the text. Also list padding: a sentence of vague
filler that grounds nothing ("with a twist of some kind", "it remains to be
seen") or that only repeats what the script already said.

Quote each unsupported sentence exactly as it appears and say in a few words what
it adds. Return an empty list when every sentence is supported."""

VERIFY_SCHEMA = {
    "type": "object",
    "properties": {"unsupported": {"type": "array", "maxItems": 20, "items": {
        "type": "object",
        "properties": {"sentence": {"type": "string", "maxLength": 600},
                       "problem": {"type": "string", "maxLength": 200}},
        "required": ["sentence", "problem"], "additionalProperties": False}}},
    "required": ["unsupported"],
    "additionalProperties": False,
}

WEEKDAY = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
MONTH = ("January", "February", "March", "April", "May", "June", "July", "August",
         "September", "October", "November", "December")


# ----------------------------------------------------------------------
# Plumbing
# ----------------------------------------------------------------------

def load_secrets():
    """On Stephen's machine the keys live in ~/.config/btownbrief/secrets.env;
    on GitHub they arrive as environment variables. The environment wins."""
    try:
        with open(SECRETS, encoding="utf-8") as src:
            for line in src:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    except OSError:
        pass


def fetch_json(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def as_date(value):
    return datetime.strptime(value, "%Y-%m-%d").date()


def spoken_date(date):
    d = as_date(date)
    return f"{WEEKDAY[d.weekday()]}, {MONTH[d.month - 1]} {d.day}"


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def plain(text):
    """The words alone: every pacing mark out, line breaks kept. Every check
    reads this, and so does the fact check, so a mark can never split a
    copied run, hide a word or be flagged as one. Only TAGS come out; any
    other bracket is left for the checks to read, and a draft that has one
    never ships (unknown_marks). A mark inside a word joins the word back
    up, so "Mont[pause]pelier" is checked as Montpelier."""
    text = MIDWORD_RE.sub("", text or "")
    text = TAG_RE.sub(" ", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r" +([,.;:!?])", r"\1", text)
    return re.sub(r"(?m)^ +| +$", "", text).strip()


def word_count(text):
    return len(re.findall(r"[A-Za-z0-9][A-Za-z0-9'’.,$%-]*", plain(text)))


MIDWORD_RE = re.compile(r"(?<=[A-Za-z0-9’'])\[[^\[\]\n]*\](?=[A-Za-z0-9’'])")


def unknown_marks(text):
    """Every bracket in `text` that is not one of TAGS, as written."""
    return [m.group(0) for m in BRACKET_RE.finditer(text or "")
            if re.sub(r"\s+", " ", m.group(1)).strip().lower() not in TAGS]


def tidy_tags(paragraph, budget=None):
    """A paragraph's pacing marks, kept to TAGS and the ration. Marks are
    written in their canonical form; a mark inside a word goes (it is
    never direction, and it splits a word the checks need whole); pause
    marks in a row become the first; past MAX_DELIVERY delivery marks and
    MAX_PAUSES pause marks a paragraph, and past what is left of the
    brief's BRIEF_MAX in `budget` (a dict tidy() shares across paragraphs),
    the rest go. Taking a mark out never changes a word. A bracket that is
    not one of TAGS is left exactly as written for unknown_marks() to send
    back; a lone bracket with no partner goes."""
    paragraph = MIDWORD_RE.sub(lambda m: m.group(0) if unknown_marks(m.group(0)) else "", paragraph)
    parts, last = [], 0
    for m in BRACKET_RE.finditer(paragraph):
        parts.append(paragraph[last:m.start()].replace("[", " ").replace("]", " "))
        name = re.sub(r"\s+", " ", m.group(1)).strip().lower()
        parts.append(f" [{name}] " if name in TAGS else " " + m.group(0) + " ")
        last = m.end()
    parts.append(paragraph[last:].replace("[", " ").replace("]", " "))
    pause = r"\[(?:short |long )?pause\]"
    text = re.sub(r"(" + pause + r")(?:\s*" + pause + r")+", r"\1", "".join(parts))
    seen = {"delivery": 0, "pause": 0}
    budget = budget if budget is not None else dict(BRIEF_MAX)

    def ration(m):
        name = m.group(1)
        if name not in TAGS:
            return m.group(0)
        kind = "delivery" if name in DELIVERY_TAGS else "pause"
        seen[kind] += 1
        pool = "long pause" if name == "long pause" else kind
        if seen[kind] > (MAX_DELIVERY if kind == "delivery" else MAX_PAUSES) or budget[pool] <= 0:
            return " "
        budget[pool] -= 1
        return m.group(0)
    text = re.sub(r"\[([a-z ]+)\]", ration, text)
    text = re.sub(r"\s+", " ", text)
    return re.sub(r" +([,.;:!?])", r"\1", text).strip()


# ----------------------------------------------------------------------
# What the brief is written from
# ----------------------------------------------------------------------

def local_stories(payload, limit=STORIES_MAX):
    """The edition's local picks in rank order (never the Brief's own
    edition), then the local leads of its updates, as
    [{"id", "title", "source", "text", "why"}]. Nothing without a title.
    `why` is the Wire's reason: emphasis and order, never a fact."""
    out, seen = [], set()

    def add(item, why):
        if not isinstance(item, dict) or not item.get("local") or item.get("own"):
            return
        key = item.get("id") or item.get("url")
        title = re.sub(r"\s+", " ", str(item.get("title") or "")).strip()
        if not key or not title or key in seen:
            return
        seen.add(key)
        text = re.sub(r"\s+", " ", str(item.get("text") or item.get("summary") or "")).strip()
        out.append({"id": key, "title": title, "source": str(item.get("name") or item.get("src") or "").strip(),
                    "text": text[:600], "why": re.sub(r"\s+", " ", str(why or "")).strip()})

    picks = [p for p in payload.get("picks") or [] if isinstance(p, dict)]
    for pick in sorted(picks, key=lambda p: p.get("rank") or 99):
        add(pick, pick.get("why"))
    for update in payload.get("updates") or []:
        lead = (update or {}).get("lead") or {}
        item = next((i for i in update.get("items") or [] if isinstance(i, dict) and i.get("id") == lead.get("id")), None)
        if item:
            add(item, lead.get("why"))
    return out[:limit]


def choose_edition(today_payload, date, fetch_edition):
    """-> (payload, "today" | "yesterday") or (None, reason). Today's paper
    when it already has enough local picks; otherwise the frozen edition of
    the day before (or a today file that is still yesterday's paper)."""
    yesterday = (as_date(date) - timedelta(days=1)).isoformat()
    if today_payload and today_payload.get("date") == date and len(local_stories(today_payload)) >= STORIES_MIN:
        return today_payload, "today"
    if today_payload and today_payload.get("date") == yesterday and len(local_stories(today_payload)) >= STORIES_MIN:
        return today_payload, "yesterday"
    try:
        frozen = fetch_edition(yesterday)
    except Exception as exc:  # noqa: BLE001 — a missing edition is a quiet day
        return None, f"today's paper is thin and yesterday's edition did not load ({exc})"
    if frozen and frozen.get("date") == yesterday and len(local_stories(frozen)) >= STORIES_MIN:
        return frozen, "yesterday"
    return None, "not enough local picks today or yesterday"


# ----------------------------------------------------------------------
# The script
# ----------------------------------------------------------------------

def intro(date, which):
    """How a person starts: the day, who this is, and straight in."""
    d = as_date(date)
    day = f"{WEEKDAY[d.weekday()]}, {MONTH[d.month - 1]} {ordinal(d.day)}"
    what = ("Here's what's going on around Burlington." if which == "today"
            else "Here's what was going on around Burlington yesterday that's still worth knowing.")
    return f"Morning. It's {day}, and this is the Btown Brief. {what}"


OUTRO = ("That's the Brief for this morning. Every story's on the Wire in All Day if you want "
         "the whole thing. Have a good one.")


def prompt_for(stories, which):
    budget_lo = WORDS_MIN - word_count(intro("2026-10-16", which)) - word_count(OUTRO)
    budget_hi = WORDS_MAX - word_count(intro("2026-10-16", which)) - word_count(OUTRO)
    system = TASK.replace("{lo}", str(budget_lo)).replace("{hi}", str(budget_hi))
    lines = [f"{i}. Headline: {s['title']} || Outlet: {s['source'] or 'unknown'}"
             + (f" || Text: {s['text']}" if s.get("text") else "")
             + (f" || Editor's note, not a source: {s['why']}" if s.get("why") else "")
             for i, s in enumerate(stories, 1)]
    head = ("These are this morning's top local stories:" if which == "today"
            else "These were yesterday's top local stories; write them as yesterday's news:")
    return system, head + "\n" + "\n".join(lines)


def headlines_for_check(stories):
    """What the fact check reads: the headlines, outlets and own text, and
    never the Wire's reasons (they once invented "free" for a panel whose
    headline never said so, and the first Opus clip repeated it)."""
    return "\n".join(f"{i}. {s['title']} || {s['source'] or 'unknown outlet'}"
                     + (f" || {s['text']}" if s.get("text") else "")
                     for i, s in enumerate(stories, 1))


def sources_of(stories):
    """The words a script may state as fact: headlines, outlets, the items'
    own text, and the spelled-out form of an acronym a headline uses. The
    reasons are not here: they shape emphasis, never facts."""
    given = [s["title"] for s in stories] + [s.get("text", "") for s in stories] + [s["source"] for s in stories]
    spelled = [full for short, full in ACRONYMS.items()
               if any(re.search(r"\b" + short + r"\b", text) for text in given)]
    return given + spelled + ["Btown Brief"]


VERBS = re.compile(r"\b(may|march)\b")


def made_up(text, sources):
    """Every word of `text` that states a fact `sources` do not give,
    sentence by sentence (curate_wire.invented reports the first per call)."""
    found = []
    for sentence in re.split(r"(?<=[.!?])\s+", plain(text)):
        # invented() reads every "may" and "march" as a month; in a spoken
        # script the lowercase ones are verbs, so they are checked as one
        sentence = VERBS.sub("might", sentence)
        allowed = list(sources)
        for _ in range(12):
            word = invented(sentence, *allowed)
            if not word:
                break
            found.append(word)
            allowed.append(word)
    return found


PRONOUN_RE = re.compile(r"\b(he|she|him|her|his|hers|himself|herself)\b", re.I)


def gendered(text, sources):
    """Pronouns that give someone a gender when no source uses one."""
    given = {w.lower() for w in PRONOUN_RE.findall(" ".join(str(s) for s in sources if s))}
    return [w for w in PRONOUN_RE.findall(plain(text)) if w.lower() not in given]


def _norm_words(text):
    return re.findall(r"[a-z0-9]+", (text or "").replace("’", "'").lower())


def copied(text, titles, run=COPY_RUN):
    """Headlines the text copies `run` or more words in a row from."""
    body = " " + " ".join(_norm_words(plain(text))) + " "
    hits = []
    for title in titles:
        words = _norm_words(title)
        for i in range(len(words) - run + 1):
            if " " + " ".join(words[i:i + run]) + " " in body:
                hits.append(title)
                break
    return hits


LIST_RE = re.compile(r"(^|\n)\s*([-*•]|\d+[.)]|#)\s|\b(number one|firstly|secondly|first up|story one)\b", re.I)


def problems_of(paragraphs, teaser, stories, date, which):
    """-> {"invented": [...], "copied": [...], "list": bool, "words": n, "teaser_invented": [...]}."""
    body = plain("\n\n".join(paragraphs))
    srcs = sources_of(stories)
    return {
        "invented": made_up(body, srcs) + gendered(body, srcs),
        "unsupported": [],
        "copied": copied(body, [s["title"] for s in stories]),
        "list": bool(LIST_RE.search(body)),
        "marks": unknown_marks("\n\n".join(paragraphs)),
        "words": word_count(assemble(date, which, paragraphs)),
        "teaser_invented": made_up(teaser, srcs),
    }


def hard_fail(p):
    return bool(p["invented"] or p["unsupported"] or p.get("marks"))


def clean(p, soft=False):
    lo, hi = (WORDS_SOFT_MIN, WORDS_SOFT_MAX) if soft else (SHORT_OK, WORDS_MAX)
    return not hard_fail(p) and not p["list"] and lo <= p["words"] <= hi and (soft or not p["copied"])


def describe(p):
    out = []
    if p["invented"]:
        out.append("These words state facts the headlines do not give (an editor's note is never a source); "
                   "remove them and any "
                   "other such fact: " + ", ".join(f'"{w}"' for w in dict.fromkeys(p["invented"])))
    for u in p["unsupported"]:
        out.append(f'This sentence says what the sources do not ({u["problem"]}); cut it or say only '
                   f'what they give: "{u["sentence"]}"')
    if p["copied"]:
        out.append("These headlines were read out word for word; retell them in your own words: "
                   + " | ".join(p["copied"]))
    if p["list"]:
        out.append("It reads as a list; write connected spoken paragraphs.")
    if p.get("marks"):
        out.append("These brackets are not pacing marks, and nothing but a pacing mark goes in brackets; "
                   "write the words plainly or leave them out: " + ", ".join(dict.fromkeys(p["marks"])))
    if p["words"] > WORDS_MAX:
        out.append(f"The whole script is {p['words']} words with the greeting and sign-off; "
                   f"cut it to under {WORDS_MAX}, dropping the least grounded sentences first.")
    elif p["words"] < SHORT_OK:
        out.append(f"The whole script is only {p['words']} words. Retell each story a little more fully "
                   "from its headline, but add no fact and no filler; if a headline gives no more, leave it.")
    if p["teaser_invented"]:
        out.append("The teaser states facts not given: " + ", ".join(p["teaser_invented"]))
    return out


def assemble(date, which, paragraphs):
    parts = [intro(date, which)] + [re.sub(r"\s+", " ", p).strip() for p in paragraphs if p and p.strip()] + [OUTRO]
    return "\n\n".join(parts) + "\n"


def tidy(paragraphs):
    out, budget = [], dict(BRIEF_MAX)
    for p in paragraphs or []:
        p = re.sub(r"\s+", " ", str(p)).strip()
        p = p.replace("&", "and").replace("%", " percent").replace("…", "...")
        p = tidy_tags(p, budget)
        if re.search(r"[A-Za-z0-9]", plain(p)):
            out.append(p)
    return out


def verify(stories, paragraphs, engine, ask):
    """-> (unsupported [{"sentence", "problem"}], usage). Only quotes that
    really are in the draft count, so a confused checker cannot sink a good
    script; a checker that does not answer at all can, because nothing ships
    unchecked."""
    body = "\n\n".join(plain(p) for p in paragraphs)    # the words alone: marks are not facts
    flat = re.sub(r"\s+", " ", body)
    try:
        answer, usage = ask(engine, VERIFY_TASK, headlines_for_check(stories) + "\n\nThe script:\n" + body,
                            VERIFY_SCHEMA, max_tokens=MAX_TOKENS[engine["provider"]], log_prefix="wire_audio")
    except wc.ModelError as exc:
        return [{"sentence": "", "problem": "the fact check did not run"}], getattr(exc, "usage", None) or {}
    found = []
    for u in (answer or {}).get("unsupported") or []:
        sentence = re.sub(r"\s+", " ", str((u or {}).get("sentence") or "")).strip().strip('"“”')
        if sentence and sentence in flat:
            found.append({"sentence": sentence, "problem": str(u.get("problem") or "unsupported").strip()[:200]})
    return found, usage


def write_script(stories, engine, date, which, ask=None):
    """-> (script or None, teaser, usage, notes). A draft and, while it has
    a problem, up to two rewrites naming it. A draft that passes the word
    checks is then fact-checked by a second call (verify). The best draft
    ships: never one that invents, fails the check or reads as a list, then
    the one nearest the length."""
    ask = ask or wc.ask_json
    system, user = prompt_for(stories, which)
    usage = {"in": 0, "out": 0, "cache_read": 0, "cache_write": 0, "calls": 0}
    notes, drafts = [], []

    def add(total, got):
        for key in ("in", "out", "cache_read", "cache_write", "calls"):
            total[key] += (got or {}).get(key, 0)
    for attempt in range(1, DRAFTS + 1):
        try:
            answer, got = ask(engine, system, user, SCHEMA, max_tokens=MAX_TOKENS[engine["provider"]],
                              log_prefix="wire_audio")
        except wc.ModelError as exc:
            got, answer = getattr(exc, "usage", None) or {}, None
        add(usage, got)
        if not isinstance(answer, dict):
            notes.append(f"attempt {attempt}: no usable answer")
            continue
        paragraphs = tidy(answer.get("paragraphs"))
        teaser = re.sub(r"\s+", " ", str(answer.get("teaser") or "")).strip()[:120]
        p = problems_of(paragraphs, teaser, stories, date, which)
        if paragraphs and not p["invented"] and not p["list"] and not p["marks"]:
            p["unsupported"], got = verify(stories, paragraphs, engine, ask)
            add(usage, got)
        drafts.append((paragraphs, teaser, p))
        if clean(p):
            break
        fix = describe(p)
        notes.append(f"attempt {attempt}: " + "; ".join(fix))
        user = (user + "\n\nYour draft:\n" + "\n\n".join(paragraphs) + "\n\nTeaser: " + teaser
                + "\n\nRewrite the whole body and teaser, fixing this:\n- " + "\n- ".join(fix))
    if not any(clean(d[2]) for d in drafts):
        # the last resort: cut exactly the sentences the fact check quoted.
        # Taking a sentence out cannot add a fact, and every sentence left
        # was read by the check and passed.
        for k, (paragraphs, teaser, p) in enumerate(list(drafts), 1):
            quoted = [u["sentence"] for u in p["unsupported"]]
            if quoted and all(quoted) and not p["invented"] and not p["list"] and not p["marks"]:
                cut = cut_sentences(paragraphs, quoted)
                q = problems_of(cut, teaser, stories, date, which)
                q["cut"] = len(quoted)
                if cut and not q["invented"] and not q["marks"]:
                    drafts.append((cut, teaser, q))
                    notes.append(f"draft {k}: cut {len(quoted)} sentence(s) the fact check could not support")
    honest = [d for d in drafts if d[0] and not hard_fail(d[2]) and not d[2]["list"]]
    if not honest:
        notes.append("every draft invented a fact, failed the fact check or read as a list: "
                     "no clip today rather than a wrong one")
        return None, "", usage, notes
    off = lambda d: max(SHORT_OK - d[2]["words"], d[2]["words"] - WORDS_MAX, 0)  # noqa: E731
    # nearest the length, then fewest copied headlines, then a draft nothing was cut from
    paragraphs, teaser, p = min(honest, key=lambda d: (off(d), len(d[2]["copied"]), d[2].get("cut", 0)))
    if not clean(p, soft=True):
        notes.append(f"the nearest draft is {p['words']} words: no clip today")
        return None, "", usage, notes
    if p["copied"] or off((paragraphs, teaser, p)):
        notes.append("shipped with a soft problem: " + "; ".join(describe(p)))
    if p["teaser_invented"] or len(teaser) > 100 or "[" in teaser or "]" in teaser:
        teaser = ""     # a teaser with a bracket in it is dropped whole, never trimmed
    return assemble(date, which, paragraphs), teaser, usage, notes


TURN_WORDS = 7   # a paragraph this short after a cut is a turn left introducing nothing


def cut_one(text, sentence):
    """`text` without `sentence`, which was quoted from plain(text): any
    pacing marks inside it, or just before it, go with it. When the marks
    sit where the pattern cannot follow, the paragraph loses its marks
    rather than keep the sentence."""
    words = sentence.split()
    if not words:
        return text
    mark = r"\[[a-z ]+\]"
    gap = r"(?:\s+(?:" + mark + r"\s*)*|\s*" + mark + r"\s*)"     # a space, or a mark, between two words
    pattern = r"(?:" + mark + r"\s*)*" + gap.join(re.escape(w) for w in words)
    cut, n = re.subn(pattern, " ", text, count=1)
    if n:
        return cut
    return plain(text).replace(sentence, "") if sentence in plain(text) else text


def cut_sentences(paragraphs, sentences):
    """Take the quoted sentences out. A paragraph the cut leaves as a bare
    turn ("Some business news now.", the first end-to-end run, whose
    DandyLion sentence had been cut) goes with them, and so does one left
    holding only pacing marks."""
    out = []
    for para in paragraphs:
        flat = re.sub(r"\s+", " ", para)
        for sentence in sentences:
            flat = cut_one(flat, sentence)
        flat = re.sub(r"\s{2,}", " ", flat).strip()
        if not re.search(r"[A-Za-z]", plain(flat)):
            continue
        if flat != re.sub(r"\s+", " ", para).strip() and word_count(flat) < TURN_WORDS:
            continue
        out.append(flat)
    return out


STORY_BEAT = "[pause]"
PAUSE_OPEN = re.compile(r"\[(?:short |long )?pause\]")


def for_voice(script):
    """What the voice is sent: the script with its pacing marks (the voice
    takes them as direction, canonical and rationed: taking a mark out never
    changes a word), STORY_BEAT before every
    paragraph after the greeting, and RESPELL. The beat is added here, in the
    voice's copy only: measured on eleven_v4 with Wyatt (2026-10-17, word
    timestamps from ElevenLabs' own transcription), a full stop and a
    paragraph break both leave about 0.55 s and an ellipsis about 0.5 s, so
    the first clip ran its stories together; [pause] leaves 1.0 to 1.3 s and
    [long pause] about 1.7 s, and [short pause] barely 0.7 s."""
    budget = dict(BRIEF_MAX)
    paragraphs = [tidy_tags(p, budget) for p in re.split(r"\n\s*\n", script.strip())]
    paragraphs = [p if i == 0 or PAUSE_OPEN.match(p) else f"{STORY_BEAT} {p}" for i, p in enumerate(paragraphs) if p]
    text = "\n\n".join(paragraphs) + ("\n" if script.endswith("\n") else "")
    for word, said in RESPELL.items():
        text = re.sub(r"\b" + re.escape(word) + r"\b", said, text)
    return text


# ----------------------------------------------------------------------
# The voice and the file
# ----------------------------------------------------------------------

def tts(api_key, voice_id, text, model=MODEL):
    """-> (mp3 bytes, the response headers that carry the cost)."""
    body = json.dumps({"text": text, "model_id": model,
                       "voice_settings": {"stability": STABILITY, "similarity_boost": SIMILARITY}}).encode("utf-8")
    req = urllib.request.Request(
        f"{API}/text-to-speech/{voice_id}?output_format={OUTPUT_FORMAT}", data=body, method="POST",
        headers={"xi-api-key": api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
    with urllib.request.urlopen(req, timeout=180) as resp:
        headers = {k.lower(): v for k, v in resp.headers.items()
                   if any(w in k.lower() for w in ("char", "cost", "request-id", "model"))}
        return resp.read(), headers


def normalize(raw, title):
    """One ffmpeg pass: -16 LUFS, true peak under -1 dB, mono, 44.1 kHz,
    64 kbps. -> (mp3 bytes, seconds). Single-pass loudnorm alone left the
    first real clip at +0.3 dBFS after encoding, so a limiter follows it
    (measured on that clip: -16.6 LUFS, -1.6 dBFS). Without ffmpeg the
    voice's own MP3 ships as is."""
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = os.path.join(tmp, "in.mp3"), os.path.join(tmp, "out.mp3")
        with open(src, "wb") as f:
            f.write(raw)
        if not ffmpeg:
            print("wire_audio: no ffmpeg on this machine; publishing the voice's MP3 unnormalized")
            dst = src
        else:
            subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", src,
                            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.79:attack=5:release=50:level=false",
                            "-ac", "1", "-ar", "44100",
                            "-c:a", "libmp3lame", "-b:a", "64k",
                            "-metadata", f"title={title}", "-metadata", "artist=The Btown Brief",
                            "-metadata", "comment=Every story is on the Wire in All Day",
                            dst], check=True)
        seconds = 0.0
        if ffprobe:
            out = subprocess.run([ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", dst],
                                 check=True, capture_output=True, text=True).stdout.strip()
            seconds = float(out or 0)
        with open(dst, "rb") as f:
            data = f.read()
        if not seconds:
            seconds = len(data) * 8 / 64000
        return data, round(seconds, 1)


# ----------------------------------------------------------------------
# Publishing: the folder the workflow pushes as the wire-audio branch
# ----------------------------------------------------------------------

def load_index(out_dir):
    index = wc.load_json(os.path.join(out_dir, "index.json"), {})
    if not isinstance(index, dict) or not isinstance(index.get("clips"), list):
        index = {"v": 1, "clips": []}
    return index


def publish(out_dir, date, mp3, script, meta, now):
    """Write the clip, its script and the index; drop clips older than KEEP_DAYS."""
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, f"{date}.mp3"), "wb") as f:
        f.write(mp3)
    with open(os.path.join(out_dir, f"{date}.txt"), "w", encoding="utf-8") as f:
        f.write(script)
    index = load_index(out_dir)
    clips = [c for c in index["clips"] if isinstance(c, dict) and c.get("date") != date]
    clips.append({"date": date, "file": f"{date}.mp3", "script": f"{date}.txt", "bytes": len(mp3), **meta})
    index["clips"] = sorted(clips, key=lambda c: c.get("date") or "", reverse=True)
    index["updated"] = now.replace(microsecond=0).isoformat()
    pending = os.path.join(out_dir, "pending.json")
    if (wc.load_json(pending, {}) or {}).get("date") == date:
        os.remove(pending)
    prune(out_dir, index, date)
    wc.write_json(os.path.join(out_dir, "index.json"), index)
    return index


def prune(out_dir, index, today):
    oldest = (as_date(today) - timedelta(days=KEEP_DAYS - 1)).isoformat()
    index["clips"] = [c for c in index["clips"] if (c.get("date") or "") >= oldest]
    keep = {c["file"] for c in index["clips"]} | {c["script"] for c in index["clips"]}
    pending = wc.load_json(os.path.join(out_dir, "pending.json"), {})
    if isinstance(pending, dict) and pending.get("script"):
        keep.add(pending["script"])
    for name in os.listdir(out_dir):
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}\.(mp3|txt)", name) and name not in keep:
            os.remove(os.path.join(out_dir, name))


def load_cost(out_dir, now):
    month = wc.month_key(now)
    cost = wc.load_json(os.path.join(out_dir, "cost.json"), {})
    if not isinstance(cost, dict) or cost.get("month") != month:
        cost = {"v": 1, "month": month, "llm_usd": 0.0, "tts_chars": 0, "tts_usd": 0.0, "runs": []}
    return cost


def record(out_dir, now, entry):
    cost = load_cost(out_dir, now)
    cost["llm_usd"] = round(cost["llm_usd"] + entry.get("llm_usd", 0), 6)
    cost["tts_chars"] += entry.get("tts_chars", 0)
    cost["tts_usd"] = round(cost["tts_usd"] + entry.get("tts_usd", 0), 6)
    cost["runs"] = (cost["runs"] + [{"at": now.replace(microsecond=0).isoformat(), **entry}])[-62:]
    wc.write_json(os.path.join(out_dir, "cost.json"), cost)
    model = entry.get("tts_model") or MODEL
    line = (f"wire_audio: ${entry.get('llm_usd', 0):.4f} model + {entry.get('tts_chars', 0):,} characters "
            f"(${entry.get('tts_usd', 0):.4f} at {model}'s ${USD_PER_1K_CHARS.get(model, 0.08):.2f} per 1,000) "
            f"this run; month to date ${cost['llm_usd']:.2f} model, {cost['tts_chars']:,} characters "
            f"(${cost['tts_usd']:.2f} of the ${TTS_CAP_USD:.0f} voice cap)")
    print(line)
    wc.step_summary("- " + line)


# ----------------------------------------------------------------------
# The run
# ----------------------------------------------------------------------

def write_pending(out_dir, date, script, meta):
    """--script-only: the script beside where its MP3 will go, and
    pending.json, which --audio-from reads back. The page never sees either:
    only index.json lists clips, and only clips with an MP3."""
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, f"{date}.txt"), "w", encoding="utf-8") as f:
        f.write(script)
    wc.write_json(os.path.join(out_dir, "pending.json"), {"date": date, "script": f"{date}.txt", **meta})


def run(args):
    load_secrets()
    now = wc.utcnow()
    date = args.date or wc.et_now(now).date().isoformat()
    out_dir = args.out_dir
    index = load_index(out_dir)
    newest = max((c.get("date") or "" for c in index["clips"] if isinstance(c, dict)), default="")
    stale = not newest or (as_date(date) - as_date(newest)).days > STALE_DAYS

    def give_up(reason, fatal=False):
        print(f"wire_audio: {reason}; nothing written")
        wc.step_summary(f"- wire_audio: {reason}; nothing written")
        return 1 if fatal and stale and not args.dry_run and not args.script_only else 0

    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key and not args.dry_run and not args.script_only:
        return give_up("no ELEVENLABS_API_KEY (add it as a repository secret to turn the audio brief on)")
    if not args.force and any(c.get("date") == date for c in index["clips"] if isinstance(c, dict)):
        return give_up(f"the clip for {date} is already up")
    cost_now = load_cost(out_dir, now)

    if args.audio_from:
        # stage two on its own: voice a script already written (and checked)
        with open(args.audio_from, encoding="utf-8") as f:
            script = f.read().strip() + "\n"
        pending = wc.load_json(os.path.join(os.path.dirname(os.path.abspath(args.audio_from)), "pending.json"), {})
        if not isinstance(pending, dict) or pending.get("date") != date:
            pending = {}
        entry = {"edition": pending.get("edition"), "writer": pending.get("writer") or "file"}
        teaser, stories_n, which = pending.get("teaser") or "", pending.get("stories") or 0, pending.get("from") or ""
        print(f"wire_audio: voicing {args.audio_from}" + (f" (written by {entry['writer']})" if pending else ""))
    else:
        if args.wire_file:
            today_payload = wc.load_json(args.wire_file, None)
        else:
            try:
                today_payload = fetch_json(RAW + "wire-today.json")
            except Exception as exc:  # noqa: BLE001
                today_payload = None
                print(f"wire_audio: wire-today.json did not load ({exc})")

        def fetch_edition(day):
            if args.edition_file:
                return wc.load_json(args.edition_file, None)
            return fetch_json(RAW + f"wire/{day}.json")

        payload, which = choose_edition(today_payload, date, fetch_edition)
        if not payload:
            return give_up(which, fatal=True)
        stories = local_stories(payload)
        stories_n = len(stories)
        print(f"wire_audio: {stories_n} local stories from the {which} edition ({payload.get('date')})")
        if not os.environ.get("ANTHROPIC_API_KEY"):
            return give_up("no ANTHROPIC_API_KEY to write the script (Opus only, no fallback)", fatal=True)
        if cost_now["llm_usd"] >= LLM_CAP_USD:
            return give_up(f"the model cap (${LLM_CAP_USD:.0f} a month) is spent", fatal=True)
        script, teaser, usage, notes = write_script(stories, WRITER, date, which)
        entry = {"edition": payload.get("date"), "writer": WRITER["model"],
                 "llm_usd": round(wc.cost_usd(WRITER["model"], usage), 6),
                 "llm_in": usage.get("in", 0), "llm_out": usage.get("out", 0)}
        for note in notes:
            print("wire_audio: " + note)
        if not script:
            if not args.dry_run:
                record(out_dir, now, {**entry, "result": "no script"})
            return give_up("no script passed the checks", fatal=True)

    words = word_count(script)
    print(f"wire_audio: script, {words} words, {len(script):,} characters\n\n{script}")
    if args.dry_run:
        return 0
    if args.script_only:
        write_pending(out_dir, date, script, {"words": words, "stories": stories_n, "edition": entry.get("edition"),
                                              "from": which, "teaser": teaser, "writer": entry["writer"],
                                              "written": now.replace(microsecond=0).isoformat()})
        record(out_dir, now, {**entry, "result": "script only"})
        wc.step_summary(f"- wire_audio: wrote {date}.txt ({words} words); voice it with --audio-from")
        return 0
    if unknown_marks(script):
        # never voiced and never trimmed: --audio-from reads a file, and
        # deleting "[not]" from "the vote did [not] pass" would reverse it
        record(out_dir, now, {**entry, "result": "unknown marks"})
        return give_up("the script has brackets that are not pacing marks ("
                       + ", ".join(dict.fromkeys(unknown_marks(script))) + ")", fatal=True)
    voice_text = for_voice(script)
    voice = os.environ.get("ELEVENLABS_VOICE_ID") or DEFAULT_VOICE
    model = os.environ.get("ELEVENLABS_MODEL") or MODEL
    rate = USD_PER_1K_CHARS.get(model, 0.08)
    if cost_now["tts_usd"] + len(voice_text) / 1000 * rate > TTS_CAP_USD:
        record(out_dir, now, {**entry, "result": "tts cap"})
        return give_up(f"the month's ${TTS_CAP_USD:.0f} of ElevenLabs characters "
                       f"(about {int(TTS_CAP_USD / rate * 1000):,} on {model}) is spent", fatal=True)
    try:
        raw, headers = tts(api_key, voice, voice_text, model)
    except urllib.error.HTTPError as exc:
        detail = exc.read()[:300].decode("utf-8", "replace")
        record(out_dir, now, {**entry, "result": f"tts HTTP {exc.code}"})
        return give_up(f"ElevenLabs said HTTP {exc.code}: {detail}", fatal=True)
    except Exception as exc:  # noqa: BLE001
        record(out_dir, now, {**entry, "result": "tts error"})
        return give_up(f"ElevenLabs did not answer ({exc})", fatal=True)
    # Dollars are estimated from the characters sent at the published API
    # rate, an upper bound. ElevenLabs' own figure comes back as
    # "character-cost" in its credits (the first real clip: 2,821 characters,
    # 310 credits) and no API call converts credits to dollars, so both are kept.
    credits = headers.get("character-cost") or headers.get("x-character-count")
    entry.update(tts_chars=len(voice_text), tts_usd=round(len(voice_text) / 1000 * rate, 6), tts_model=model,
                 tts_credits=int(credits) if str(credits or "").isdigit() else None, tts_headers=headers, result="published")
    title = f"{spoken_date(date)}: the Btown Brief, out loud"
    try:
        mp3, seconds = normalize(raw, title)
    except Exception as exc:  # noqa: BLE001 — the voice's own file is still good
        print(f"wire_audio: ffmpeg failed ({exc}); publishing the voice's MP3 as is")
        mp3, seconds = raw, round(len(raw) * 8 / 64000, 1)
    meta = {"duration": seconds, "words": words, "stories": stories_n, "edition": entry.get("edition"),
            "from": which, "teaser": teaser, "made": now.replace(microsecond=0).isoformat(),
            "voice": voice, "model": model, "writer": entry.get("writer", "")}
    publish(out_dir, date, mp3, script, meta, now)
    record(out_dir, now, entry)
    print(f"wire_audio: published {date}.mp3, {len(mp3) / 1e6:.2f} MB, {seconds:.0f} s, {words} words")
    wc.step_summary(f"- wire_audio: published {date}.mp3 ({seconds:.0f} s, {words} words, {stories_n} stories)")
    return 0


# ----------------------------------------------------------------------
# Selftest: offline, no model, no voice
# ----------------------------------------------------------------------

def selftest():
    def item(i, local=True, own=False, why=""):
        return {"id": f"x{i}", "local": local, "own": own, "name": "Seven Days", "src": "seven-days", "rank": i,
                "title": f"Burlington council approves the {i}th bike lane plan for North Avenue", "url": f"https://e/{i}",
                "why": why or "Your commute on North Avenue changes."}
    payload = {"date": "2026-10-16", "picks": [item(1, own=True)] + [item(i) for i in range(2, 9)] + [item(9, local=False)],
               "updates": []}
    stories = local_stories(payload)
    assert len(stories) == 7 and all(s["id"] != "x1" for s in stories), stories
    assert choose_edition(payload, "2026-10-16", lambda d: None)[1] == "today"
    thin = {"date": "2026-10-16", "picks": [item(2)], "updates": []}
    frozen = dict(payload, date="2026-10-15")
    assert choose_edition(thin, "2026-10-16", lambda d: frozen) == (frozen, "yesterday")
    assert choose_edition(thin, "2026-10-16", lambda d: thin)[0] is None
    srcs = sources_of(stories)
    assert made_up("Seven Days says the plan passed on Tuesday for 12 dollars.", srcs) == ["Tuesday", "12"]
    assert made_up("The council approved a plan for North Avenue.", srcs) == []
    assert made_up("You may want to march over in May.", srcs) == ["May"]
    vsp = sources_of([{"title": "VSP update on the case", "why": "", "source": "WCAX"}])
    assert made_up("The Vermont State Police have an update.", vsp) == []
    assert made_up("The Vermont State Police have an update.", srcs) == ["State", "Police"]
    assert copied("they said the council approves the 2th bike lane plan for north avenue today", [stories[0]["title"]])
    assert not copied("the council said yes to more bike lanes", [stories[0]["title"]])
    assert LIST_RE.search("1. The council\n2. The lake") and not LIST_RE.search("The council met.")
    assert for_voice("Charlotte and Vergennes") == "Shar-LOT and ver-JENZ"
    assert spoken_date("2026-10-16") == "Friday, October 16"
    body = ["The council said yes to more bike lanes on North Avenue. " * 6] * 6
    calls = []

    def fake(engine, system, user, schema, max_tokens, log_prefix):
        if "unsupported" in schema["properties"]:
            return {"unsupported": [{"sentence": "Not in the script.", "problem": "x"}]}, {"calls": 1}
        calls.append(user)
        return {"paragraphs": body, "teaser": "Bike lanes on North Avenue."}, {"in": 10, "out": 10, "calls": 1}
    script, teaser, usage, notes = write_script(stories, {"provider": "anthropic", "model": "m"}, "2026-10-16", "today", ask=fake)
    assert script and script.startswith("Morning. It's Friday, October 16th") and " AI " not in script, script
    assert SHORT_OK <= word_count(script) <= WORDS_MAX, word_count(script)
    assert len(calls) == 1 and teaser == "Bike lanes on North Avenue." and usage["calls"] == 2, (calls, usage)
    assert gendered("She said his plan works.", srcs) == ["She", "his"] and not gendered("She said so.", ["she won"])
    # pacing marks: kept to TAGS, never read by a check, never a hiding place
    assert tidy_tags("[Short Pause] Closer to home... the plan [pause][pause] pa[pause]ssed.") == \
        "[short pause] Closer to home... the plan [pause] passed."
    assert unknown_marks(tidy_tags("The vote did [not] pass [softly].")) == ["[not]"]
    assert made_up("The council in Mont[short pause]pelier approved it.", srcs) == ["Montpelier"]
    assert made_up("The council approved it. [short pause] Closer to home, North Avenue.", srcs) == []
    assert made_up("The plan [softly] passed on [pause] Tuesday.", srcs) == ["Tuesday"]
    assert copied("they said the council approves the [pause] 2th bike lane plan for north avenue", [stories[0]["title"]])
    assert word_count("[pause] one two [softly] three") == 3 and plain("a [slowly] b [pause].") == "a b."
    assert for_voice("[pause] In Charlotte now.\n") == "[pause] In Shar-LOT now.\n"

    def liar(engine, system, user, schema, max_tokens, log_prefix):
        return {"paragraphs": ["Mayor Emma Mulvaney-Stanak cut the ribbon on Tuesday."] + body, "teaser": "x"}, {"calls": 1}
    script, *_ = write_script(stories, {"provider": "anthropic", "model": "m"}, "2026-10-16", "today", ask=liar)
    assert script is None
    with tempfile.TemporaryDirectory() as tmp:
        now = datetime(2026, 10, 16, 11, 2, tzinfo=timezone.utc)
        for name in ("2026-09-01.mp3", "2026-09-01.txt", "2026-10-15.mp3", "2026-10-15.txt"):
            open(os.path.join(tmp, name), "wb").close()
        wc.write_json(os.path.join(tmp, "index.json"), {"v": 1, "clips": [
            {"date": "2026-09-01", "file": "2026-09-01.mp3", "script": "2026-09-01.txt"},
            {"date": "2026-10-15", "file": "2026-10-15.mp3", "script": "2026-10-15.txt"}]})
        index = publish(tmp, "2026-10-16", b"ID3", "Good morning.\n", {"duration": 1.0}, now)
        assert [c["date"] for c in index["clips"]] == ["2026-10-16", "2026-10-15"], index
        assert not os.path.exists(os.path.join(tmp, "2026-09-01.mp3"))
        assert os.path.exists(os.path.join(tmp, "2026-10-16.txt"))
    print("build_wire_audio selftest: ok")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out-dir", default=os.path.join(ROOT, "data", "audio"))
    ap.add_argument("--wire-file")
    ap.add_argument("--edition-file")
    ap.add_argument("--date")
    ap.add_argument("--script-only", action="store_true")
    ap.add_argument("--audio-from")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        selftest()
        return 0
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
