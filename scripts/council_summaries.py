#!/usr/bin/env python3
"""City Hall in 5 for the Town app: what the City Council did, from its minutes.

For each City Council meeting whose minutes the city has published and that
data/town/council.json does not hold yet, this fetches the minutes and agenda as
plain text from the CivicClerk API, asks Claude Opus for at most five bullets,
one "if you only read one" and one Next, and runs every answer through gate()
before a word is written. The prompt is private (council-summary.md, see
scripts/private_prompts.py).

The gate is the point of this file. A bullet is dropped unless:

  - its quote is found word for word in the minutes (whitespace evened out),
    and sits under the agenda item the bullet says it came from
  - every number in it, in digits or in words, appears in the minutes
  - the quote does not contradict it (passed against failed)
  - it names only the council, the mayor or a councilor: forum speakers and
    "Others present" are read out of the minutes and refused by name, and the
    Town feed's own name guard runs too
  - it carries no phone number and no street number

Fewer than MIN_BULLETS left means nothing is published for that meeting; it
tries again on later runs, RETRIES more times, and the count stays in the file.
The headline line may restate only a bullet that survived, or it becomes that
bullet's first sentence. The Next line's date comes from the city's calendar.

The speakers' names never reach the model at all: scrub() swaps them out of the
copy it reads, and the gate still checks quotes against the real minutes.

Cost goes to data/town/wire-cost.json (wire_common's ledger, its own file and
its own cap, so the Wire's budget is left alone). No ANTHROPIC_API_KEY means
quietly nothing: this never drops below Opus.

Run from the repo root:
  python3 scripts/council_summaries.py                  # what refresh-civic runs
  python3 scripts/council_summaries.py --days 200 --max 12 --cap 15  # a backfill
"""

import argparse
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import wire_common as wc  # noqa: E402
from refresh_civic import API_URL, BTV_TZ, USER_AGENT, document_links, video_url  # noqa: E402
from town.title_guard import CONTACT, names_person  # noqa: E402

OUT_DIR = os.path.join(wc.ROOT, "data", "town")
OUT = os.path.join(OUT_DIR, "council.json")
FILE_API = API_URL.rsplit("/", 1)[0] + "/Meetings/GetMeetingFileStream"
PROMPT = "council-summary.md"
MODEL = {"provider": "anthropic", "model": "claude-opus-5-5"}
EFFORT = "high"
MAX_TOKENS = 12000
MONTH_CAP_USD = 5.0     # a month is two or three meetings at about 20 cents each
DAYS = 60               # how far back a daily run looks
MAX_PER_RUN = 2
MAX_BULLETS = 5
MIN_BULLETS = 2
RETRIES = 3
MIN_MINUTES = 1500      # shorter than this is not the minutes of a meeting
MIN_QUOTE = 25
MAX_BULLET_WORDS = 70
MAX_TOP_WORDS = 32
MAX_MINUTES_CHARS = 120_000
MAX_AGENDA_CHARS = 30_000

SCHEMA = {
    "type": "object",
    "properties": {
        "top": {"type": "string"},
        "top_bullet": {"type": "integer"},
        "bullets": {"type": "array", "items": {
            "type": "object",
            "properties": {"head": {"type": "string"}, "text": {"type": "string"},
                           "quote": {"type": "string"}, "locator": {"type": "string"}},
            "required": ["head", "text", "quote", "locator"],
            "additionalProperties": False}},
        "next_item": {"type": "string"},
        "next_quote": {"type": "string"},
    },
    "required": ["top", "top_bullet", "bullets", "next_item", "next_quote"],
    "additionalProperties": False,
}

# ----------------------------------------------------------------------
# Reading the minutes
# ----------------------------------------------------------------------

STRAIGHT = str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " "})
NUMBER = re.compile(r"\d+(?:,\d{3})*(?:\.\d+)?")
WORDS = {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
         "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
         "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "hundred": 100,
         "thousand": 1000, "million": None, "billion": None}
SPELLED = re.compile(r"\b(" + "|".join(WORDS) + r")\b", re.I)
# an item's heading at the start of a line: "7.3. Title" or "Subject 7.3. Title"
ITEM = re.compile(r"^[ \t]*(?:Subject[ \t]+)?(\d+(?:\.\d+)?)\.[ \t]+\S", re.M)
ITEM_NUMBER = re.compile(r"\d+(?:\.\d+)?")
FORUM_START = re.compile(r"^[ \t]*(?:\d+\.\d+\.[ \t]+)?Verbal Comments\b", re.M)
NAME = r"[A-Z][\w.'’-]*(?:[ \t]+(?:(?:von|van|de)[ \t]+)?[A-Z][\w.'’-]*){0,3}"
SPEAKER = re.compile(r"(?:(?<=^)|(?<=[ \t]))(" + NAME + r"):")
NAME_ONLY = re.compile(r"^[ \t]*" + NAME + r"[ \t]*$")
NOT_A_SPEAKER = re.compile(r"^(?:Ayes|Nays|Abstain\w*|Absent|Recused|Motion|Note|Non-BTV|BTV)\b")
OTHERS = re.compile(r"Others? present:(.*?)(?=\nSubject\b|\n\d+\.|\Z)", re.S | re.I)
# officials and the places named for people
ALLOWED_TITLES = re.compile(r"\b(?:City Council President|Council President|Councilors?|Mayor)\s+(?:[A-Z][\w'’-]+)")
ALLOWED_PLACES = re.compile(r"\b(?:Robert Miller|Ethan Allen|Ira Allen|Howard Center|Howard Dean|Fletcher Allen|Fletcher Free|Dorothy Day)\b")
PUBLIC_ADDRESSES = re.compile(r"\b(?:149 Church Street|645 Pine Street)\b", re.I)
PASSED = re.compile(r"\b(?:approved|adopted|passed|authorized|ratified)\b", re.I)
SAID_FAILED = re.compile(r"\b(?:failed|defeated|rejected|voted down|did not pass|not approved)\b", re.I)


def squash(text):
    """The form two texts are compared in: quotes and dashes straightened, runs of
    whitespace made one space."""
    return re.sub(r"\s+", " ", (text or "").translate(STRAIGHT)).strip()


def tidy(text):
    """CivicClerk pads each PDF line to its column; keep the lines, lose the padding."""
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in (text or "").splitlines()]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip() + "\n"


def numbers(text):
    """Every figure in a text, comparable: 2,500,000.00 and 2500000 are one number."""
    out = set()
    for token in NUMBER.findall(text or ""):
        token = token.replace(",", "")
        if "." in token:
            token = token.rstrip("0").rstrip(".")
        out.add(token.lstrip("0") or "0")
    return out


def spelled(text):
    return {word.lower() for word in SPELLED.findall(text or "")}


def forum_block(minutes):
    """(start, end) of the speaker list in the minutes, or None: from the last
    "Verbal Comments" (the heading comes twice) to the next item."""
    starts = list(FORUM_START.finditer(minutes))
    if not starts:
        return None
    start = starts[-1].end()
    after = ITEM.search(minutes, start)
    return start, after.start() if after else len(minutes)


def forum_names(minutes):
    """The people the minutes list as public forum speakers. Two can share a line
    ("Pine Street Paving Lloyd Sage: parks"), so a long catch also gives its last
    two words."""
    block = forum_block(minutes)
    if not block:
        return set()
    names = set()
    for line in minutes[block[0]:block[1]].splitlines():
        found = SPEAKER.findall(line)
        names.update(found if found else [line] if NAME_ONLY.match(line) else [])
    names = {re.sub(r"\s+", " ", name).strip() for name in names}
    names = {name for name in names if name and not NOT_A_SPEAKER.match(name)}
    return names | {" ".join(name.split()[-2:]) for name in names if len(name.split()) > 2}


def others_present(minutes):
    """Surnames from the attendance's "Others present", all of them but the mayor."""
    names = set()
    for found in OTHERS.findall(minutes):
        for part in re.split(r",|\band\b|;", found):
            part = re.sub(r"\s+", " ", re.sub(r"\(.*?\)", " ", part)).strip()
            if not part or re.search(r"\bMayor\b", part):
                continue
            words = re.findall(r"[A-Z][\w'’-]*[a-z][\w'’-]*", part)
            if words:
                names.add(words[-1])
    return names


def councilors(minutes):
    """Surnames of the members, who are the only people a summary may name."""
    names = set()
    for found in re.findall(r"Members? (?:present|absent):(.*?)(?=Members? (?:present|absent):|Others? present:|\n[ \t]*\n)", minutes, re.S):
        names.update(re.findall(r"[A-Z][\w'’-]+(?:-\s*[A-Z][\w'’-]+)?", found))
    return {re.sub(r"\s+", "", name) for name in names}


def scrub(minutes):
    """The copy the model reads: "Speaker:" where the minutes list one, and "a
    speaker" wherever else they name one."""
    block = forum_block(minutes)
    if not block:
        return minutes
    names = forum_names(minutes)
    lines = []
    for line in minutes[block[0]:block[1]].split("\n"):
        if NAME_ONLY.match(line) and not NOT_A_SPEAKER.match(line.strip()):
            continue
        lines.append(SPEAKER.sub(lambda m: m.group(0) if NOT_A_SPEAKER.match(m.group(1)) else "Speaker:", line))
    text = minutes[:block[0]] + "\n".join(lines) + minutes[block[1]:]
    for name in sorted((one for one in names if " " in one), key=len, reverse=True):
        text = text.replace(name, "a speaker")
    return text


def item_at(minutes, position):
    """The number of the agenda item a position in the minutes sits under. A bare
    number counts only as the next section: "2. To authorize" inside item 6.15 is
    a step of that motion, not section 2."""
    current, section = None, 0
    for match in ITEM.finditer(minutes):
        if match.start() > position:
            break
        number = match.group(1)
        if "." in number or int(number) in (section, section + 1):
            current, section = number, int(number.split(".")[0])
    return current


def find_quote(minutes, quote):
    """Every place a quote sits in the original text. The search runs on the
    evened-out text, whose positions are mapped back to the original lines."""
    want = squash(quote)
    if len(want) < MIN_QUOTE:
        return []
    chars, spots = [], []
    for at, char in enumerate(minutes.translate(STRAIGHT)):
        if char.isspace():
            if chars and chars[-1] != " ":
                chars.append(" ")
                spots.append(at)
        else:
            chars.append(char)
            spots.append(at)
    text = "".join(chars)
    return [spots[match.start()] for match in re.finditer(re.escape(want), text)]


# ----------------------------------------------------------------------
# The gate
# ----------------------------------------------------------------------

class Record:
    """What the gate checks an answer against, read once from one meeting's minutes."""

    def __init__(self, minutes):
        self.minutes = minutes
        self.numbers = numbers(minutes)
        self.spelled = spelled(minutes)
        self.forum = forum_names(minutes)
        self.others = others_present(minutes) - councilors(minutes)


def bad_numbers(text, record):
    """Figures in `text` the minutes do not have, digits or spelled out."""
    missing = sorted(numbers(text) - record.numbers)
    for word in spelled(text):
        value = WORDS[word]
        if word not in record.spelled and (value is None or str(value) not in record.numbers):
            missing.append(word)
    return missing


def bad_people(text, record):
    """The first person `text` may not name, or None."""
    for name in record.forum:
        if re.search(r"(?<![\w-])" + re.escape(name) + r"(?![\w-])", text):
            return name
    for name in record.others:
        if re.search(r"(?<![\w-])" + re.escape(name) + r"(?![\w-])", text):
            return name
    clear = ALLOWED_PLACES.sub(" ", ALLOWED_TITLES.sub(" ", text))
    return "a person's name" if names_person(clear) else None


def bad_contact(text):
    """A phone number, email or street number; City Hall's own address is fine."""
    match = CONTACT.search(PUBLIC_ADDRESSES.sub(" ", text))
    return match.group(0) if match else None


def contradicts(text, quote):
    """Text and quote disagree on whether the thing passed."""
    said_yes, said_no = PASSED.search(text), SAID_FAILED.search(text)
    quote_yes, quote_no = re.search(r"\b(?:passed|adopted|approved)\b", quote, re.I), SAID_FAILED.search(quote)
    return bool((said_yes and not said_no and quote_no and not quote_yes) or (said_no and not said_yes and quote_yes and not quote_no))


def bullet_fault(bullet, record):
    """Why a bullet may not run, or None."""
    head, text, quote = (squash(bullet.get(key)) for key in ("head", "text", "quote"))
    locator = str(bullet.get("locator") or "")
    if not head or not text:
        return "empty"
    if len(text.split()) > MAX_BULLET_WORDS:
        return "too long"
    spots = find_quote(record.minutes, quote)
    if not spots:
        return "quote not in the minutes"
    wanted = ITEM_NUMBER.search(locator)
    if not wanted or wanted.group(0) not in {item_at(record.minutes, at) for at in spots}:
        return f"quote is not under item {locator!r}"
    words = head + " " + text
    missing = bad_numbers(words, record)
    if missing:
        return f"not in the minutes: {', '.join(missing)}"
    if contradicts(text, quote):
        return "quote contradicts the bullet"
    for part in (words, quote):
        person = bad_people(part, record)
        if person:
            return f"names {person}"
        contact = bad_contact(part)
        if contact:
            return f"contact detail: {contact}"
    return None


def first_sentence(text):
    match = re.match(r"(.+?[.!?])(?:\s+[A-Z]|$)", text)
    return match.group(1) if match else text


def choose_top(answer, kept, picked):
    """The headline line. It restates a bullet that survived, adding no figure, or
    it is that bullet's first sentence."""
    top = squash(answer.get("top"))
    bullet = kept[picked] if picked is not None else kept[0]
    source = bullet["text"]
    usable = (top and picked is not None and len(top.split()) <= MAX_TOP_WORDS
              and not numbers(top) - numbers(source) and not spelled(top) - spelled(source)
              and wc.restates(top, source))
    return top if usable else first_sentence(source)


def next_line(answer, record, next_when):
    """The city's date for the next meeting, then what comes back, if the minutes say so."""
    item, quote = squash(answer.get("next_item")), squash(answer.get("next_quote"))
    good = bool(item) and bool(find_quote(record.minutes, quote)) and not bad_numbers(item, record) \
        and not bad_people(item, record) and not bad_contact(item) and not bad_people(quote, record)
    if not good:
        item = ""
    return " ".join(part for part in (next_when, item) if part)


def gate(answer, minutes, next_when=""):
    """-> ({top, bullets, next} ready to publish, or None; every reason a bullet fell)."""
    record = Record(minutes)
    kept, faults, picked = [], [], None
    raw = answer.get("bullets") if isinstance(answer, dict) else None
    want_top = answer.get("top_bullet") if isinstance(answer, dict) else None
    for number, bullet in enumerate(raw if isinstance(raw, list) else [], 1):
        fault = "past the limit" if len(kept) >= MAX_BULLETS else bullet_fault(bullet, record) if isinstance(bullet, dict) else "not a bullet"
        if fault:
            faults.append(f"bullet {number}: {fault}")
            continue
        if number == want_top:
            picked = len(kept)
        kept.append({"head": squash(bullet["head"]), "text": squash(bullet["text"]),
                     "quote": squash(bullet["quote"]), "locator": squash(bullet["locator"])})
    if len(kept) < MIN_BULLETS:
        return None, faults
    return {"top": choose_top(answer, kept, picked), "bullets": kept, "next": next_line(answer, record, next_when)}, faults


# ----------------------------------------------------------------------
# CivicClerk
# ----------------------------------------------------------------------

def http_get(url, timeout=90):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def council_events(since, until):
    params = {"$filter": (f"categoryName eq 'City Council' and startDateTime ge {since:%Y-%m-%d}T00:00:00Z "
                          f"and startDateTime le {until:%Y-%m-%d}T23:59:59Z"),
              "$orderby": "startDateTime desc"}
    url, events = API_URL + "?" + urllib.parse.urlencode(params), []
    while url:
        payload = json.loads(http_get(url))
        events.extend(payload.get("value") or [])
        url = payload.get("@odata.nextLink")
    return [event for event in events if is_meeting(event)]


def is_meeting(event):
    """A real meeting of the council: the city keeps test rows, budget talks and
    hearings in the same category."""
    name = (event.get("eventName") or "").lower()
    return "city council" in name and not re.search(r"\btest\b|cancel", name)


def file_of(event, kind):
    for item in event.get("publishedFiles") or []:
        if isinstance(item, dict) and (item.get("type") or "").lower() == kind:
            return item.get("fileId")
    return None


def pdf_text(data):
    """The PDF's text, for the minutes the city's plain-text render comes back
    empty on (three in June and July 2026)."""
    from pypdf import PdfReader
    return "\n\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages)


def file_text(file_id):
    text = http_get(f"{FILE_API}(fileId={file_id},plainText=true)", timeout=180).decode("utf-8", "replace")
    if not text.strip():
        text = pdf_text(http_get(f"{FILE_API}(fileId={file_id},plainText=false)", timeout=180))
    return tidy(text)


def wall_time(event):
    """CivicClerk marks Burlington wall-clock times as UTC: 18:00Z is the 6 pm meeting."""
    return datetime.fromisoformat(event["startDateTime"].replace("Z", "+00:00"))


def next_meeting(when, later):
    """The city calendar's next meeting after `when`, as a reader says it."""
    after = sorted((wall_time(event) for event in later if wall_time(event) > when))
    if not after:
        return ""
    moment = after[0]
    clock = moment.strftime("%I:%M %p").lstrip("0")
    return f"{moment:%A, %B} {moment.day}, {clock}."


def clean_video(url):
    return url.split("?")[0] if url and "youtube.com/live/" in url else url


def format_meeting(event, minutes, agenda, next_when):
    return (f"Meeting: {event.get('eventName')}, {event['startDateTime'][:10]}\n"
            f"Next meeting on the city calendar: {next_when or 'not posted'}\n\n"
            f"<minutes>\n{scrub(minutes)[:MAX_MINUTES_CHARS]}\n</minutes>\n\n"
            f"<agenda>\n{agenda[:MAX_AGENDA_CHARS]}\n</agenda>\n")


# ----------------------------------------------------------------------
# The run
# ----------------------------------------------------------------------

def load_file(path):
    data = wc.load_json(path, {})
    data = data if isinstance(data, dict) else {}
    meetings = [one for one in data.get("meetings") or [] if isinstance(one, dict) and one.get("id")]
    tries = data.get("tries") if isinstance(data.get("tries"), dict) else {}
    return {"meetings": meetings, "tries": tries}


def save_file(path, data, now):
    data["meetings"].sort(key=lambda one: (one["date"], one["id"]), reverse=True)
    wc.write_json(path, {"v": 1, "generated": now.replace(microsecond=0).isoformat(),
                         "meetings": data["meetings"], "tries": data["tries"]})


def waiting(events, data):
    """Published minutes with no summary, newest first, skipping any out of retries."""
    done = {str(one["id"]) for one in data["meetings"]}
    return [event for event in events if file_of(event, "minutes") and str(event["id"]) not in done
            and int(data["tries"].get(str(event["id"]), 0)) <= RETRIES]


def summarize(event, later, engine, system, dump=None):
    """One meeting -> (entry or None, usage or None)."""
    minutes = file_text(file_of(event, "minutes"))
    if len(minutes) < MIN_MINUTES:
        print(f"council: {event['startDateTime'][:10]} has no readable minutes yet")
        return None, None
    agenda_id = file_of(event, "agenda")
    agenda = file_text(agenda_id) if agenda_id else ""
    next_when = next_meeting(wall_time(event), later)
    answer, usage = wc.ask_json(engine, system, format_meeting(event, minutes, agenda, next_when), SCHEMA,
                                max_tokens=MAX_TOKENS, log_prefix="council", effort=EFFORT)
    date = event["startDateTime"][:10]
    if dump:
        os.makedirs(dump, exist_ok=True)
        with open(os.path.join(dump, date + ".txt"), "w", encoding="utf-8") as dst:
            dst.write(minutes)
        with open(os.path.join(dump, date + ".json"), "w", encoding="utf-8") as dst:
            json.dump({"answer": answer, "next_when": next_when}, dst, indent=1, ensure_ascii=False)
    passed, faults = gate(answer, minutes, next_when)
    for fault in faults:
        print(f"council: {date} {fault}", file=sys.stderr)
    if not passed:
        print(f"council: {date} held back, too few bullets passed", file=sys.stderr)
        return None, usage
    links = document_links(event)
    return {"id": event["id"], "date": date, "title": event.get("eventName") or "City Council Meeting", **passed,
            "minutes_url": links["minutes_url"], "agenda_url": links["agenda_url"],
            "video_url": clean_video(video_url(event)),
            "generated": wc.utcnow().replace(microsecond=0).isoformat()}, usage


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--days", type=int, default=DAYS, help="how far back to look")
    parser.add_argument("--max", type=int, default=MAX_PER_RUN, help="meetings to summarize in one run")
    parser.add_argument("--cap", type=float, default=MONTH_CAP_USD, help="month-to-date dollars to stop at")
    parser.add_argument("--dump", help="also write each model answer and its minutes to this folder")
    args = parser.parse_args()

    now = wc.utcnow()
    today = now.astimezone(BTV_TZ).date()
    data = load_file(OUT)
    try:
        events = council_events(today - timedelta(days=args.days), today + timedelta(days=120))
    except Exception as exc:  # noqa: BLE001 — the city's API being down is not a failure here
        print(f"council: CivicClerk fetch failed, keeping the file ({exc})", file=sys.stderr)
        return 0
    past = [event for event in events if event["startDateTime"][:10] <= today.isoformat()]
    todo = waiting(past, data)
    if not todo:
        print("council: nothing new")
        return 0
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("council: no ANTHROPIC_API_KEY, skipping")
        return 0
    system = wc.read_prompt(PROMPT)

    changed = False
    for event in todo[:args.max]:
        refuse, spent = wc.over_budget(OUT_DIR, now, cap=args.cap)
        if refuse:
            line = f"council: stopping, ${spent:.2f} spent this month (cap ${args.cap:.0f})"
            print(line)
            wc.step_summary("- " + line)
            break
        key = str(event["id"])
        try:
            entry, usage = summarize(event, events, MODEL, system, args.dump)
        except Exception as exc:  # noqa: BLE001 — SDK missing, network, anything: the next run tries again
            print(f"council: {event['startDateTime'][:10]} failed ({exc})", file=sys.stderr)
            usage = getattr(exc, "usage", None)
            if usage and usage.get("calls"):   # a call that was refused cost nothing and proves nothing
                wc.record_cost(OUT_DIR, "council_summaries", MODEL, usage, now, cap=args.cap)
                data["tries"][key] = int(data["tries"].get(key, 0)) + 1
                changed = True
            continue
        if usage:
            wc.record_cost(OUT_DIR, "council_summaries", MODEL, usage, now, cap=args.cap)
        if entry:
            data["meetings"].append(entry)
            data["tries"].pop(key, None)
            changed = True
        elif usage:
            data["tries"][key] = int(data["tries"].get(key, 0)) + 1
            changed = True
    if changed:
        save_file(OUT, data, now)
    print(f"council: {len(data['meetings'])} meetings in the file")
    return 0


if __name__ == "__main__":
    sys.exit(main())
