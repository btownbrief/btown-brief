#!/usr/bin/env python3
"""The Brief, out loud: a three-minute morning audio brief from the Wire.

Every morning at 7 Eastern (.github/workflows/wire-audio.yml):

  1. Read today's Wire (wire-today.json on the wire-data branch). Before the
     morning's picks are ranked, today's paper is too thin to read from, so
     yesterday's frozen edition (data/wire/YYYY-MM-DD.json) is used instead,
     and the brief says so.
  2. Take the top local picks, in rank order, with their one-line reasons.
  3. Ask Claude Opus 5.5 (ANTHROPIC_API_KEY) for the body of a 400 to 500
     word script in a newsreader's spoken English. Opus only: this is the
     Brief speaking in its own name, and accuracy here is the product, so
     there is no cheaper fallback (GLM 5.3 Flash, tried on the first test
     runs, invented a candidate's first name and gender). No key, no clip.
     The greeting and the sign-off, which carries the AI-voice disclosure,
     are fixed text added here.
  4. Check the body mechanically, the way curate_wire.py checks its reasons:
     no fact the headlines and reasons do not give (curate_wire.invented:
     a number, a weekday or month, "free", a capitalized name; and a pronoun
     that gives someone a gender), no run of eight words copied from a
     headline, no list, and the length. A draft that passes is fact-checked
     sentence by sentence by a second call. Up to two rewrites name what was
     wrong; a draft that still invents means no clip today, never a wrong one.
  5. Send the script to ElevenLabs (eleven_v4_turbo, the voice in
     ELEVENLABS_VOICE_ID, default Wyatt, a voice ElevenLabs itself owns),
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
spent and refuses ElevenLabs past TTS_MONTH_CHARS (Starter's v4 Turbo
allowance), so a loop can never run up a bill.

CLI:
  --out-dir DIR      the data/audio folder to publish into (default data/audio)
  --wire-file PATH   read wire-today.json from a file (else the wire-data branch)
  --edition-file P   read yesterday's frozen edition from a file
  --date YYYY-MM-DD  make the clip for that day (default: today in Burlington)
  --script-file P    read the script from a file instead of asking the model
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
MODEL = "eleven_v4_turbo"
DEFAULT_VOICE = "FrS6cKLB1wg4WYgPa9GW"     # Wyatt, made and kept by ElevenLabs (4,015-day notice)
OUTPUT_FORMAT = "mp3_44100_64"
USD_PER_1K_CHARS = {"eleven_v4_turbo": 0.04, "eleven_v4": 0.08}   # API pricing page, 2026-10-16

WORDS_MIN, WORDS_MAX = 400, 500            # the whole script, greeting and sign-off included
WORDS_SOFT_MIN, WORDS_SOFT_MAX = 360, 560  # after the rewrite, close enough to ship
STORIES_MAX = 8
STORIES_MIN = 4                            # fewer local picks than this and today is too thin
COPY_RUN = 8                               # words in a row copied from a headline
KEEP_DAYS = 30
STALE_DAYS = 3
LLM_CAP_USD = 8.0                          # about $0.05 to $0.20 a day; this only stops a runaway
DRAFTS = 3                                 # a draft and up to two rewrites, each fact-checked
TTS_MONTH_CHARS = 150_000                  # Starter's v4 Turbo allowance ($6)
MAX_TOKENS = {"openrouter": 6000, "anthropic": 8000}
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

# Saying an acronym in full is good for the ear ("Vermont State Police" for
# "VSP"), so when a headline or reason uses one of these, its spelled-out
# words count as given. Nothing else is expanded.
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
}

TASK = """You write the Btown Brief, out loud: a three-minute morning news brief for
Burlington, Vermont, read aloud by a synthetic voice. Write it the way a public
radio newsreader talks to a neighbour: plain, warm, unhurried.

You get the stories, numbered in order of importance. Each is a headline, the
outlet that ran it, and a one-line note on why it matters. Write the body of the
brief: every story, in the order given, as short spoken paragraphs.

Rules, all of them hard:
- Every fact comes from the headline or the note. Add no name, number, date,
  day of the week, place, price or detail that they do not give. When a headline
  is unclear, say less, never more. Do not guess what happened or what comes next.
- Never read a headline out. Retell each story in your own words: full, short
  sentences, one idea each. Never copy more than six words in a row from a headline.
- No lists, no bullets, no "first" or "number one", no headings, no emoji, no
  parentheses. Move between stories with a natural turn now and then, and do not
  start two stories the same way.
- No commentary. No judgement of your own, nothing like "it's a reminder that"
  or "it shows", nothing about what a story means beyond what its note says.
- Name the outlet where it helps the listener trust a story ("Seven Days
  reports..."), not every time.
- Write for the ear: numbers the way they are said ("4.95 million dollars"),
  no symbols, no abbreviation a listener cannot decode unless the headline uses it.
- No greeting, no sign-off, no date, no weather: those are added for you.
- Length: {lo} to {hi} words for the body.

Also write `teaser`: one plain phrase under 90 characters naming three of the
stories' topics, for the card the clip sits on, e.g. "The governor's race money,
a new interchange, and a scam warning." Same rules on facts."""

SCHEMA = {
    "type": "object",
    "properties": {
        "paragraphs": {"type": "array", "minItems": 1, "maxItems": 14, "items": {"type": "string", "maxLength": 900}},
        "teaser": {"type": "string", "maxLength": 120},
    },
    "required": ["paragraphs", "teaser"],
    "additionalProperties": False,
}

# The second pass: the same model reads the draft against the sources and
# quotes every sentence they do not support. The word checks above catch a
# new name or number; this catches what they cannot (seen on the first real
# run: "She's the one with the cash advantage" about a candidate no source
# gave a gender, and a line of opinion about health care stated as fact).
VERIFY_TASK = """You fact-check a short radio news script against its only sources: the
numbered stories below, each a headline, the outlet that ran it, and a one-line note.

List every sentence of the script that says something the sources do not support.
Unsupported means: a name, title or role; a pronoun that gives someone a gender;
a number, date, time or place; what happened, why, or what comes next; who is
affected; an opinion, judgement or prediction stated as fact. Rewording a headline
or a note is supported. So are turns between stories and words to the listener
("If you drive...", "Worth a look before you head out") that assert nothing new,
and saying when the brief airs ("this morning").

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


def word_count(text):
    return len(re.findall(r"[A-Za-z0-9][A-Za-z0-9'’.,$%-]*", text or ""))


# ----------------------------------------------------------------------
# What the brief is written from
# ----------------------------------------------------------------------

def local_stories(payload, limit=STORIES_MAX):
    """The edition's local picks in rank order (never the Brief's own
    edition), then the local leads of its updates, as
    [{"id", "title", "source", "why"}]. Nothing without a title."""
    out, seen = [], set()

    def add(item, why):
        if not isinstance(item, dict) or not item.get("local") or item.get("own"):
            return
        key = item.get("id") or item.get("url")
        title = re.sub(r"\s+", " ", str(item.get("title") or "")).strip()
        if not key or not title or key in seen:
            return
        seen.add(key)
        out.append({"id": key, "title": title, "source": str(item.get("name") or item.get("src") or "").strip(),
                    "why": re.sub(r"\s+", " ", str(why or "")).strip()})

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
    when = ("the stories that matter in Burlington this morning" if which == "today"
            else "the stories that mattered in Burlington yesterday, the ones still worth knowing this morning")
    return f"Good morning. It's {spoken_date(date)}, and this is the Btown Brief, out loud: {when}."


OUTRO = ("That's the Brief for this morning. Every one of these stories, with a link to the outlet "
         "that reported it, is on the Wire in All Day. This summary was written from the Wire's "
         "picks and read by an AI voice. Have a good day.")


def prompt_for(stories, which):
    budget_lo = WORDS_MIN - word_count(intro("2026-10-16", which)) - word_count(OUTRO)
    budget_hi = WORDS_MAX - word_count(intro("2026-10-16", which)) - word_count(OUTRO)
    system = TASK.replace("{lo}", str(budget_lo)).replace("{hi}", str(budget_hi))
    lines = [f"{i}. {s['title']} || {s['source'] or 'unknown outlet'} || {s['why'] or '(no note)'}"
             for i, s in enumerate(stories, 1)]
    head = ("These are this morning's top local stories:" if which == "today"
            else "These were yesterday's top local stories; write them as yesterday's news:")
    return system, head + "\n" + "\n".join(lines)


def sources_of(stories):
    given = [s["title"] for s in stories] + [s["why"] for s in stories] + [s["source"] for s in stories]
    spelled = [full for short, full in ACRONYMS.items()
               if any(re.search(r"\b" + short + r"\b", text) for text in given)]
    return given + spelled + ["Btown Brief"]


VERBS = re.compile(r"\b(may|march)\b")


def made_up(text, sources):
    """Every word of `text` that states a fact `sources` do not give,
    sentence by sentence (curate_wire.invented reports the first per call)."""
    found = []
    for sentence in re.split(r"(?<=[.!?])\s+", text or ""):
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
    return [w for w in PRONOUN_RE.findall(text or "") if w.lower() not in given]


def _norm_words(text):
    return re.findall(r"[a-z0-9]+", (text or "").replace("’", "'").lower())


def copied(text, titles, run=COPY_RUN):
    """Headlines the text copies `run` or more words in a row from."""
    body = " " + " ".join(_norm_words(text)) + " "
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
    body = "\n\n".join(paragraphs)
    srcs = sources_of(stories)
    return {
        "invented": made_up(body, srcs) + gendered(body, srcs),
        "unsupported": [],
        "copied": copied(body, [s["title"] for s in stories]),
        "list": bool(LIST_RE.search(body)),
        "words": word_count(assemble(date, which, paragraphs)),
        "teaser_invented": made_up(teaser, srcs),
    }


def hard_fail(p):
    return bool(p["invented"] or p["unsupported"])


def clean(p, soft=False):
    lo, hi = (WORDS_SOFT_MIN, WORDS_SOFT_MAX) if soft else (WORDS_MIN, WORDS_MAX)
    return not hard_fail(p) and not p["list"] and lo <= p["words"] <= hi and (soft or not p["copied"])


def describe(p):
    out = []
    if p["invented"]:
        out.append("These words state facts the headlines and notes do not give; remove them and any "
                   "other such fact: " + ", ".join(f'"{w}"' for w in dict.fromkeys(p["invented"])))
    for u in p["unsupported"]:
        out.append(f'This sentence says what the sources do not ({u["problem"]}); cut it or say only '
                   f'what they give: "{u["sentence"]}"')
    if p["copied"]:
        out.append("These headlines were read out word for word; retell them in your own words: "
                   + " | ".join(p["copied"]))
    if p["list"]:
        out.append("It reads as a list; write connected spoken paragraphs.")
    if not WORDS_MIN <= p["words"] <= WORDS_MAX:
        out.append(f"The whole script is {p['words']} words with the greeting and sign-off; "
                   f"the body must bring it to {WORDS_MIN} to {WORDS_MAX}.")
    if p["teaser_invented"]:
        out.append("The teaser states facts not given: " + ", ".join(p["teaser_invented"]))
    return out


def assemble(date, which, paragraphs):
    parts = [intro(date, which)] + [re.sub(r"\s+", " ", p).strip() for p in paragraphs if p and p.strip()] + [OUTRO]
    return "\n\n".join(parts) + "\n"


def tidy(paragraphs):
    out = []
    for p in paragraphs or []:
        p = re.sub(r"\s+", " ", str(p)).strip()
        p = p.replace("&", "and").replace("%", " percent")
        if p:
            out.append(p)
    return out


def verify(stories, paragraphs, engine, ask):
    """-> (unsupported [{"sentence", "problem"}], usage). Only quotes that
    really are in the draft count, so a confused checker cannot sink a good
    script; a checker that does not answer at all can, because nothing ships
    unchecked."""
    _, sources = prompt_for(stories, "today")
    body = "\n\n".join(paragraphs)
    flat = re.sub(r"\s+", " ", body)
    try:
        answer, usage = ask(engine, VERIFY_TASK, sources.split("\n", 1)[1] + "\n\nThe script:\n" + body,
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
        if paragraphs and not p["invented"] and not p["list"]:
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
            if quoted and all(quoted) and not p["invented"] and not p["list"]:
                cut = cut_sentences(paragraphs, quoted)
                q = problems_of(cut, teaser, stories, date, which)
                if cut and not q["invented"]:
                    drafts.append((cut, teaser, q))
                    notes.append(f"draft {k}: cut {len(quoted)} sentence(s) the fact check could not support")
    honest = [d for d in drafts if d[0] and not hard_fail(d[2]) and not d[2]["list"]]
    if not honest:
        notes.append("every draft invented a fact, failed the fact check or read as a list: "
                     "no clip today rather than a wrong one")
        return None, "", usage, notes
    off = lambda d: max(WORDS_MIN - d[2]["words"], d[2]["words"] - WORDS_MAX, 0)  # noqa: E731
    paragraphs, teaser, p = min(honest, key=lambda d: (off(d), len(d[2]["copied"])))
    if not clean(p, soft=True):
        notes.append(f"the nearest draft is {p['words']} words: no clip today")
        return None, "", usage, notes
    if p["copied"] or off((paragraphs, teaser, p)):
        notes.append("shipped with a soft problem: " + "; ".join(describe(p)))
    if p["teaser_invented"] or len(teaser) > 100:
        teaser = ""
    return assemble(date, which, paragraphs), teaser, usage, notes


def cut_sentences(paragraphs, sentences):
    out = []
    for para in paragraphs:
        flat = re.sub(r"\s+", " ", para)
        for sentence in sentences:
            flat = flat.replace(sentence, "")
        flat = re.sub(r"\s{2,}", " ", flat).strip()
        if re.search(r"[A-Za-z]", flat):
            out.append(flat)
    return out


def for_voice(script):
    text = script
    for word, said in RESPELL.items():
        text = re.sub(r"\b" + re.escape(word) + r"\b", said, text)
    return text


# ----------------------------------------------------------------------
# The voice and the file
# ----------------------------------------------------------------------

def tts(api_key, voice_id, text, model=MODEL):
    """-> (mp3 bytes, the response headers that carry the cost)."""
    body = json.dumps({"text": text, "model_id": model,
                       "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}}).encode("utf-8")
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
                            "-metadata", "comment=Written from the Wire's picks and read by an AI voice",
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
    prune(out_dir, index, date)
    wc.write_json(os.path.join(out_dir, "index.json"), index)
    return index


def prune(out_dir, index, today):
    oldest = (as_date(today) - timedelta(days=KEEP_DAYS - 1)).isoformat()
    index["clips"] = [c for c in index["clips"] if (c.get("date") or "") >= oldest]
    keep = {c["file"] for c in index["clips"]} | {c["script"] for c in index["clips"]}
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
    line = (f"wire_audio: ${entry.get('llm_usd', 0):.4f} model + {entry.get('tts_chars', 0):,} characters "
            f"(${entry.get('tts_usd', 0):.4f}) this run; month to date ${cost['llm_usd']:.2f} model, "
            f"{cost['tts_chars']:,} characters (${cost['tts_usd']:.2f})")
    print(line)
    wc.step_summary("- " + line)


# ----------------------------------------------------------------------
# The run
# ----------------------------------------------------------------------

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
        return 1 if fatal and stale and not args.dry_run else 0

    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key and not args.dry_run:
        return give_up("no ELEVENLABS_API_KEY (add it as a repository secret to turn the audio brief on)")
    if not args.force and any(c.get("date") == date for c in index["clips"] if isinstance(c, dict)):
        return give_up(f"the clip for {date} is already up")

    # what to read from
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
    print(f"wire_audio: {len(stories)} local stories from the {which} edition ({payload.get('date')})")

    cost_now = load_cost(out_dir, now)
    entry = {"edition": payload.get("date")}
    if args.script_file:
        with open(args.script_file, encoding="utf-8") as f:
            script = f.read().strip() + "\n"
        teaser, notes = "", ["script read from a file"]
        entry["writer"] = "file"
    else:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            return give_up("no ANTHROPIC_API_KEY to write the script (Opus only, no fallback)", fatal=True)
        engine = WRITER
        if cost_now["llm_usd"] >= LLM_CAP_USD:
            return give_up(f"the model cap (${LLM_CAP_USD:.0f} a month) is spent", fatal=True)
        script, teaser, usage, notes = write_script(stories, engine, date, which)
        entry.update(writer=engine["model"], llm_usd=round(wc.cost_usd(engine["model"], usage), 6),
                     llm_in=usage.get("in", 0), llm_out=usage.get("out", 0))
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
    voice_text = for_voice(script)
    if cost_now["tts_chars"] + len(voice_text) > TTS_MONTH_CHARS:
        record(out_dir, now, {**entry, "result": "tts cap"})
        return give_up(f"the month's {TTS_MONTH_CHARS:,} ElevenLabs characters are spent", fatal=True)

    voice = os.environ.get("ELEVENLABS_VOICE_ID") or DEFAULT_VOICE
    model = os.environ.get("ELEVENLABS_MODEL") or MODEL
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
    entry.update(tts_chars=len(voice_text), tts_usd=round(len(voice_text) / 1000 * USD_PER_1K_CHARS.get(model, 0.08), 6),
                 tts_credits=int(credits) if str(credits or "").isdigit() else None, tts_headers=headers, result="published")
    title = f"{spoken_date(date)}: the Btown Brief, out loud"
    try:
        mp3, seconds = normalize(raw, title)
    except Exception as exc:  # noqa: BLE001 — the voice's own file is still good
        print(f"wire_audio: ffmpeg failed ({exc}); publishing the voice's MP3 as is")
        mp3, seconds = raw, round(len(raw) * 8 / 64000, 1)
    meta = {"duration": seconds, "words": words, "stories": len(stories), "edition": payload.get("date"),
            "from": which, "teaser": teaser, "made": now.replace(microsecond=0).isoformat(),
            "voice": voice, "model": model, "writer": entry.get("writer", "")}
    publish(out_dir, date, mp3, script, meta, now)
    record(out_dir, now, entry)
    print(f"wire_audio: published {date}.mp3, {len(mp3) / 1e6:.2f} MB, {seconds:.0f} s, {words} words")
    wc.step_summary(f"- wire_audio: published {date}.mp3 ({seconds:.0f} s, {words} words, {len(stories)} stories)")
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
    assert script and script.startswith("Good morning. It's Friday, October 16") and "AI voice" in script, script
    assert WORDS_MIN <= word_count(script) <= WORDS_MAX, word_count(script)
    assert len(calls) == 1 and teaser == "Bike lanes on North Avenue." and usage["calls"] == 2, (calls, usage)
    assert gendered("She said his plan works.", srcs) == ["She", "his"] and not gendered("She said so.", ["she won"])

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
    ap.add_argument("--script-file")
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
