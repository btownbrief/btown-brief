#!/usr/bin/env python3
"""The Brief, out loud: each newsletter edition, read aloud word for word.

Stephen, 2026-10-18: "Every Monday and Friday, and sometimes Wednesday, I'll do
the transcription of it, of just the intro paragraphs and the news. People
don't really need the full events calendar or the filler in between." This
replaces the daily two-minute recap (build_wire_audio.py, retired the same
day), which had a model write its own script from the Wire.

Nothing here writes or rewrites a word. The run (.github/workflows/wire-audio.yml,
hourly through the day):

  1. Read the newsletter's own RSS feed (Beehiiv ships every edition whole as
     content:encoded). Take the newest edition that is not voiced yet and is
     at most MAX_AGE_DAYS old. One edition a run, never a backlog.
  2. Cut out two sections by their headings: the intro ("Weather & Weekend
     Rundown:" / "Weather & Monday Update:", which holds the weather and each
     day's featured events and "Also Friday," roundup) and the news ("Local
     News" through QUICK HITS, which ends at the quiz). The events calendar,
     IRL, the projects plug, the support block, sports and the quiz are
     never read. An edition with no news section (the Wednesday format) is
     skipped and logged, not guessed at.
  3. The script is those paragraphs in order, verbatim, with four fixed
     lines around them: who and when at the top, "Now, the local news.",
     "Quick hits.", and one short supporter line to close. Square brackets in
     the text ("[MEETUP]", "[Here]") are dropped, because the voice takes a
     bracketed word as direction; [pause] goes before each day and each
     story, which is the only direction it gets.
  4. ElevenLabs voices it with the same settings the recap used (eleven_v4,
     the voice in ELEVENLABS_VOICE_ID, default Wyatt, stability 0.4,
     similarity 0.65, place names respelled for the voice only). An edition
     runs 16,000 to 21,000 characters, past one request's limit, so it goes in
     paragraph-aligned chunks of at most CHUNK_CHARS, joined and loudness-
     matched in one ffmpeg pass (-16 LUFS, mono, 64 kbps).
  5. Publish data/audio/YYYY-MM-DD.mp3 (the edition's date in Burlington),
     the script as YYYY-MM-DD.txt, and index.json (v2, every clip
     kind "edition"), keeping the newest KEEP editions. The old recap's files
     are pruned on the first run. The workflow force-pushes the folder as the
     one commit of the orphan wire-audio branch, so the page's URLs do not
     change and old MP3s never pile up in git history.

Cost: ElevenLabs bills characters, $0.08 per 1,000 on eleven_v4 (API pricing
page, checked 2026-10-18). An edition is about 19,000 characters, so about
$1.50; two a week is about $13 a month. TTS_CAP_USD stops the month at $25 and
MAX_EDITION_CHARS refuses an edition that parsed suspiciously long (a broken
cut that swallowed the calendar), so a loop or a parser slip can never run up
a bill. The spend goes to data/audio/cost.json, month to date.

Failure posture: no ELEVENLABS_API_KEY, nothing new, a Wednesday, or the cap
reached logs and exits 0 with nothing published. A voice or ffmpeg failure
part way exits 1 so it is seen, and publishes nothing (the characters already
spent are still recorded).

CLI:
  --out-dir DIR     the data/audio folder to publish into (default data/audio)
  --feed-file PATH  read the feed from a file instead of the network
  --edition URL     voice this edition (its link in the feed) even if older
  --force           voice it again even if it is already published
  --dry-run         build and print the script and its size; no voice
  --sample DIR      voice only the opening (greeting and the first paragraph)
                    into DIR/sample.mp3, to hear the settings; publishes nothing
"""

import argparse
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SECRETS = os.path.expanduser("~/.config/btownbrief/secrets.env")
FEED = "https://rss.beehiiv.com/feeds/1BT4mvZXMo.xml"   # the newsletter's own feed (newsletter_picks.py reads it too)
UA = "btown-edition-audio/1.0"
TZ = ZoneInfo("America/New_York")
CONTENT = "{http://purl.org/rss/1.0/modules/content/}encoded"

# The voice, exactly as the recap had it (build_wire_audio.py, 2026-10-17).
API = "https://api.elevenlabs.io/v1"
MODEL = "eleven_v4"
DEFAULT_VOICE = "FrS6cKLB1wg4WYgPa9GW"     # Wyatt, made and kept by ElevenLabs
OUTPUT_FORMAT = "mp3_44100_64"
STABILITY = 0.4
SIMILARITY = 0.65
USD_PER_1K_CHARS = 0.08                    # eleven_v4, API pricing page, 2026-10-18
RESPELL = {                                # for the voice only; the published script keeps the real spelling
    "Charlotte": "Shar-LOT",
    "Calais": "CAL-iss",
    "Vergennes": "ver-JENZ",
    "Montpelier": "mont-PEEL-yer",
    "Champlain": "sham-PLANE",
    "Lamoille": "la-MOYL",
}

CHUNK_CHARS = 4500          # eleven_v4 takes 10,000 a request; shorter keeps the read steady
MIN_EDITION_CHARS = 1500    # less than this and the cut missed
MAX_EDITION_CHARS = 32000   # more than this and the cut swallowed something (the calendar alone is 15,000+)
TTS_CAP_USD = 25.0          # a month: about sixteen editions, so two a week with room for a re-run
MAX_AGE_DAYS = 4            # an edition older than this is never voiced on a schedule
KEEP = 10                   # editions kept on the branch, about five weeks

GREETING = "This is the Btown Brief for {title}."
NEWS_TURN = "Now, the local news."
QUICK_TURN = "Quick hits."
SIGN_OFF = ("That's the Brief. If it's worth something to you, you can become a monthly supporter "
            "at btownbrief.com.")
BEAT = "[pause]"
LONG_BEAT = "[long pause]"

HEADING = re.compile(r"<h([1-6])\b[^>]*>(.*?)</h\1>", re.S | re.I)
PARA = re.compile(r'<p class="paragraph"[^>]*>(.*?)</p>', re.S)   # an image caption is a bare <p> and never matches
INTRO_HEAD = re.compile(r"^weather\b", re.I)
NEWS_HEAD = re.compile(r"^local news\b", re.I)
QUICK_HEAD = re.compile(r"^quick hits\b", re.I)
SKIP_LINE = re.compile(r"^(scroll down to events section|\*+\s*for best viewing)", re.I)
DAY_LABEL = re.compile(r"^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$", re.I)
LONE_LINK = re.compile(r"^\s*(?:<[^>]+>\s*)*<a\b[^>]*>.*?</a>\s*(?:</[^>]+>\s*)*$", re.S)
BRACKETS = re.compile(r"\s*\[[^\[\]\n]*\]")


# ----------------------------------------------------------------------
# Plumbing
# ----------------------------------------------------------------------

def load_secrets():
    """Stephen's machine keeps the keys in ~/.config/btownbrief/secrets.env;
    GitHub passes them as environment variables, which win."""
    try:
        with open(SECRETS, encoding="utf-8") as src:
            for line in src:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    except OSError:
        pass


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as src:
            return json.load(src)
    except (OSError, ValueError):
        return default


def write_json(path, value):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as dst:
        json.dump(value, dst, indent=1, ensure_ascii=False)
        dst.write("\n")
    os.replace(tmp, path)


def say(line):
    """A log line, and the same line in the Actions summary when there is one."""
    print("edition_audio: " + line)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as dst:
            dst.write("- " + line + "\n")


def mark_changed():
    """Tells the workflow there is something to push."""
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as dst:
            dst.write("changed=true\n")


# ----------------------------------------------------------------------
# The feed and the two sections
# ----------------------------------------------------------------------

def read_feed(path=None):
    if path:
        with open(path, encoding="utf-8") as src:
            return src.read()
    req = urllib.request.Request(FEED, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8")


def editions(feed_xml):
    """Every edition in the feed, newest first: title, url, date (Burlington's), published, html."""
    out = []
    for item in ET.fromstring(feed_xml).iter("item"):
        title = (item.findtext("title") or "").strip()
        url = (item.findtext("link") or "").strip()
        body = item.findtext(CONTENT) or ""
        try:
            published = parsedate_to_datetime(item.findtext("pubDate") or "")
        except (TypeError, ValueError):
            continue
        if not (title and url and body and published.tzinfo):
            continue
        out.append({"title": title, "url": url, "published": published,
                    "date": published.astimezone(TZ).date().isoformat(), "html": body})
    return sorted(out, key=lambda e: e["published"], reverse=True)


def text_of(fragment):
    t = html.unescape(re.sub(r"<[^>]+>", "", fragment))
    t = BRACKETS.sub("", t)
    return re.sub(r"\s+", " ", t).strip()


def regions(body):
    """The edition cut at every heading: [(heading text, the html under it)]."""
    heads = list(HEADING.finditer(body))
    return [(text_of(h.group(2)), body[h.end(): heads[i + 1].start() if i + 1 < len(heads) else len(body)])
            for i, h in enumerate(heads)]


def paragraphs(fragment):
    """[(kind, text)]: 'day' for a lone weekday label, 'head' for a paragraph
    that is only a link (a news headline), 'p' for the rest."""
    out = []
    for m in PARA.finditer(fragment):
        t = text_of(m.group(1))
        if not t or SKIP_LINE.match(t):
            continue
        kind = "day" if DAY_LABEL.match(t) else "head" if LONE_LINK.match(m.group(1)) else "p"
        out.append((kind, t))
    return out


def sentence(t):
    """A headline or a label ends in a full stop, so the voice stops there."""
    return t if re.search(r"[.!?…:\"”’']$", t) else t + "."


def script_of(ed):
    """-> (script, stats) or (None, why). The script is plain paragraphs with
    the voice's [pause] marks, the words all the edition's own."""
    intro = news = quick = None
    for head, frag in regions(ed["html"]):
        if intro is None and INTRO_HEAD.match(head):
            intro = frag
        elif news is None and NEWS_HEAD.match(head):
            news = frag
        elif news is not None and quick is None and QUICK_HEAD.match(head):
            quick = frag
    if news is None:
        return None, "no Local News section (a Wednesday-style edition), nothing to read"
    out = [GREETING.format(title=ed["title"])]
    for kind, t in paragraphs(intro or ""):
        out.append(f"{BEAT} {sentence(t)}" if kind == "day" else t)
    stories = [(k, t) for k, t in paragraphs(news)]
    out.append(f"{LONG_BEAT} {NEWS_TURN}")
    n = 0
    for kind, t in stories:
        if kind == "head":
            n += 1
            out.append(f"{BEAT} {sentence(t)}")
        else:
            out.append(t)
    hits = paragraphs(quick or "")
    if hits:
        out.append(f"{BEAT} {QUICK_TURN}")
        out.extend(t for _, t in hits)
    out.append(f"{LONG_BEAT} {SIGN_OFF}")
    if not n:
        return None, "the Local News section has no headlines; the layout may have changed"
    script = "\n\n".join(out) + "\n"
    return script, {"stories": n, "quick": len(hits), "intro": bool(intro), "chars": len(for_voice(script))}


def for_voice(script):
    """What the voice is sent: the script with place names respelled and
    "&" said as "and". Never a word changed in the published script."""
    text = script.replace(" & ", " and ")
    for word, said in RESPELL.items():
        text = re.sub(r"\b" + re.escape(word) + r"\b", said, text)
    return text


def chunks(text, limit=CHUNK_CHARS):
    """Paragraph-aligned pieces of at most `limit` characters (a paragraph
    longer than that is split at sentence ends)."""
    pieces = []
    for p in text.strip().split("\n\n"):
        while len(p) > limit:
            cut = max(p.rfind(". ", 0, limit), p.rfind("? ", 0, limit), p.rfind("! ", 0, limit))
            cut = cut + 1 if cut > 0 else limit
            pieces.append(p[:cut].strip())
            p = p[cut:].strip()
        if p:
            pieces.append(p)
    out, cur = [], ""
    for p in pieces:
        if cur and len(cur) + 2 + len(p) > limit:
            out.append(cur)
            cur = p
        else:
            cur = cur + "\n\n" + p if cur else p
    if cur:
        out.append(cur)
    return out


# ----------------------------------------------------------------------
# The voice and the file
# ----------------------------------------------------------------------

def tts(api_key, voice_id, text):
    body = json.dumps({"text": text, "model_id": MODEL,
                       "voice_settings": {"stability": STABILITY, "similarity_boost": SIMILARITY}}).encode("utf-8")
    req = urllib.request.Request(
        f"{API}/text-to-speech/{voice_id}?output_format={OUTPUT_FORMAT}", data=body, method="POST",
        headers={"xi-api-key": api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        return resp.read()


def join_and_normalize(parts, title):
    """One ffmpeg pass over every chunk in order: joined, -16 LUFS, true peak
    under -1 dB, mono, 44.1 kHz, 64 kbps. -> (mp3 bytes, seconds)."""
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is needed to join the pieces")
    with tempfile.TemporaryDirectory() as tmp:
        args = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y"]
        for i, raw in enumerate(parts):
            src = os.path.join(tmp, f"{i:02d}.mp3")
            with open(src, "wb") as f:
                f.write(raw)
            args += ["-i", src]
        joined = "".join(f"[{i}:a]" for i in range(len(parts))) + f"concat=n={len(parts)}:v=0:a=1"
        dst = os.path.join(tmp, "out.mp3")
        args += ["-filter_complex", joined + ",loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.79:attack=5:release=50:level=false",
                 "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "64k",
                 "-metadata", f"title={title}", "-metadata", "artist=The Btown Brief", dst]
        subprocess.run(args, check=True)
        seconds = 0.0
        if ffprobe:
            out = subprocess.run([ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", dst],
                                 check=True, capture_output=True, text=True).stdout.strip()
            seconds = float(out or 0)
        with open(dst, "rb") as f:
            data = f.read()
        return data, round(seconds or len(data) * 8 / 64000, 1)


# ----------------------------------------------------------------------
# Publishing: the folder the workflow pushes as the wire-audio branch
# ----------------------------------------------------------------------

CLIP_NAME = re.compile(r"\d{4}-\d{2}-\d{2}\.(mp3|txt)")


def load_index(out_dir):
    """Edition clips only: the retired recap's entries (no kind) drop out."""
    index = load_json(os.path.join(out_dir, "index.json"), {})
    clips = index.get("clips") if isinstance(index, dict) else None
    clips = [c for c in clips or [] if isinstance(c, dict) and c.get("kind") == "edition"]
    return {"v": 2, "clips": clips}


def publish(out_dir, ed, mp3, script, meta, now):
    os.makedirs(out_dir, exist_ok=True)
    date = ed["date"]
    with open(os.path.join(out_dir, f"{date}.mp3"), "wb") as f:
        f.write(mp3)
    with open(os.path.join(out_dir, f"{date}.txt"), "w", encoding="utf-8") as f:
        f.write(script)
    index = load_index(out_dir)
    clips = [c for c in index["clips"] if c.get("date") != date]
    clips.append({"kind": "edition", "date": date, "title": ed["title"], "url": ed["url"],
                  "file": f"{date}.mp3", "script": f"{date}.txt", "bytes": len(mp3),
                  "made": now.replace(microsecond=0).isoformat(), **meta})
    index["clips"] = sorted(clips, key=lambda c: c["date"], reverse=True)[:KEEP]
    index["updated"] = now.replace(microsecond=0).isoformat()
    prune(out_dir, index)
    write_json(os.path.join(out_dir, "index.json"), index)
    return index


def prune(out_dir, index):
    """Every clip file the index does not list goes, the recap's included,
    and the recap's half-made pending.json with them."""
    keep = {c["file"] for c in index["clips"]} | {c["script"] for c in index["clips"]}
    for name in os.listdir(out_dir):
        if (CLIP_NAME.fullmatch(name) and name not in keep) or name == "pending.json":
            os.remove(os.path.join(out_dir, name))


def month_of(now):
    return now.astimezone(TZ).strftime("%Y-%m")


def load_cost(out_dir, now):
    cost = load_json(os.path.join(out_dir, "cost.json"), {})
    if not isinstance(cost, dict) or cost.get("month") != month_of(now):
        cost = {"month": month_of(now), "tts_chars": 0, "tts_usd": 0.0, "runs": []}
    cost.setdefault("tts_chars", 0)
    cost.setdefault("tts_usd", 0.0)
    cost.setdefault("runs", [])
    return cost


def record(out_dir, now, chars, what):
    cost = load_cost(out_dir, now)
    usd = round(chars / 1000 * USD_PER_1K_CHARS, 4)
    cost["v"] = 2
    cost["tts_chars"] += chars
    cost["tts_usd"] = round(cost["tts_usd"] + usd, 4)
    cost["runs"] = (cost["runs"] + [{"at": now.replace(microsecond=0).isoformat(), "what": what,
                                     "tts_chars": chars, "tts_usd": usd}])[-40:]
    write_json(os.path.join(out_dir, "cost.json"), cost)
    mark_changed()
    say(f"{chars:,} characters (${usd:.2f}) for {what}; month to date {cost['tts_chars']:,} "
        f"(${cost['tts_usd']:.2f} of the ${TTS_CAP_USD:.0f} cap)")


# ----------------------------------------------------------------------
# The run
# ----------------------------------------------------------------------

def choose(eds, index, now, want_url=None, force=False):
    """The edition to voice this run, or (None, why)."""
    done = {c["date"] for c in index["clips"]}
    if want_url:
        ed = next((e for e in eds if e["url"].rstrip("/") == want_url.rstrip("/")), None)
        if not ed:
            return None, f"{want_url} is not in the feed"
        if ed["date"] in done and not force:
            return None, f"{ed['title']} is already voiced (pass --force to make it again)"
        return ed, ""
    for ed in eds:
        if (now - ed["published"]).days > MAX_AGE_DAYS:
            break
        if ed["date"] in done and not force:
            return None, f"the newest edition, {ed['title']}, is already voiced"
        script, _ = script_of(ed)
        if script:
            return ed, ""
        say(f"{ed['title']}: skipped, {_}")
    return None, "no edition in the last %d days to voice" % MAX_AGE_DAYS


def run(args, now=None):
    now = now or datetime.now(timezone.utc)
    load_secrets()
    eds = editions(read_feed(args.feed_file))
    out_dir = args.out_dir
    index = load_index(out_dir)
    ed, why = choose(eds, index, now, args.edition, args.force)
    if not ed:
        say(why)
        return 0
    script, stats = script_of(ed)
    if not script:
        say(f"{ed['title']}: {stats}")
        return 0
    voice = for_voice(script)
    pieces = chunks(voice)
    say(f"{ed['title']}: intro {'found' if stats['intro'] else 'MISSING'}, {stats['stories']} stories, "
        f"{stats['quick']} quick hits, {len(voice):,} characters in {len(pieces)} pieces "
        f"(about ${len(voice) / 1000 * USD_PER_1K_CHARS:.2f})")
    if not (MIN_EDITION_CHARS <= len(voice) <= MAX_EDITION_CHARS):
        say(f"{len(voice):,} characters is outside {MIN_EDITION_CHARS:,} to {MAX_EDITION_CHARS:,}: "
            "the cut is probably wrong, so nothing is voiced")
        return 1
    if args.dry_run:
        print(script)
        return 0
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key:
        say("no ELEVENLABS_API_KEY, nothing voiced")
        return 0
    voice_id = os.environ.get("ELEVENLABS_VOICE_ID", "").strip() or DEFAULT_VOICE
    if args.sample:
        opening = "\n\n".join(voice.split("\n\n")[:2])
        mp3, seconds = join_and_normalize([tts(key, voice_id, opening)], "Sample")
        os.makedirs(args.sample, exist_ok=True)
        with open(os.path.join(args.sample, "sample.mp3"), "wb") as f:
            f.write(mp3)
        print(f"edition_audio: sample, {len(opening):,} characters (${len(opening) / 1000 * USD_PER_1K_CHARS:.3f}), "
              f"{seconds:.0f} s -> {os.path.join(args.sample, 'sample.mp3')}")
        return 0
    spent = load_cost(out_dir, now)["tts_usd"]
    if spent + len(voice) / 1000 * USD_PER_1K_CHARS > TTS_CAP_USD:
        say(f"this edition would pass the month's ${TTS_CAP_USD:.0f} voice cap (${spent:.2f} spent); nothing voiced")
        return 0
    parts, sent = [], 0
    try:
        for piece in pieces:
            parts.append(tts(key, voice_id, piece))
            sent += len(piece)
        mp3, seconds = join_and_normalize(parts, f"The Btown Brief, {ed['title']}")
    except Exception as err:   # noqa: BLE001  (any failure: record the spend, publish nothing, fail loud)
        if sent:
            record(out_dir, now, sent, ed["title"] + " (failed part way)")
        say(f"{ed['title']}: the voice failed after {len(parts)} of {len(pieces)} pieces: {type(err).__name__}: {err}")
        return 1
    record(out_dir, now, sent, ed["title"])
    publish(out_dir, ed, mp3, script, {"duration": seconds, "chars": sent, "stories": stats["stories"],
                                       "quick": stats["quick"], "voice": voice_id, "model": MODEL}, now)
    say(f"published {ed['date']}.mp3, {seconds / 60:.1f} minutes, {len(mp3):,} bytes")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out-dir", default=os.path.join(ROOT, "data", "audio"))
    ap.add_argument("--feed-file")
    ap.add_argument("--edition")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--sample")
    return run(ap.parse_args())


if __name__ == "__main__":
    sys.exit(main())
