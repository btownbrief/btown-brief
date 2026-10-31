#!/usr/bin/env python3
"""Talk's news questions: one for each of the day's top stories.

The Wire's paper has headlines; Talk needs something to argue about. Three
times a day (Morning, Midday, Evening, Burlington time) this step in the
curate-wire workflow takes the stories in wire-today.json that pass the dinner
guard and asks the model for one question per story. The hourly ticks in
between read one stamp and stop, so they cost nothing.

  data/talk-today.json on the wire-data branch:
  {"v": 1, "date": "2026-10-30", "slot": "midday", "updated": "...", "items":
   [{"id", "b": "head"|"sports", "q", "title", "name", "src", "url", "local",
     "posted_at"}]}

A story keeps its question from one run to the next, so only new stories are
paid for and a shared card keeps its words. The model answers by INDEX into
the numbered list, as tag_wire.py's does, and every answer is checked here.
What fails is dropped.

Model and key: wire_common.pick_engine("curate"), the curator's. Cost goes to
data/wire-cost.json and the step summary, and the Wire's month cap applies.

Failure posture: no key, the cap, a thin paper or any API trouble logs
and exits 0. The last file stays on the branch, because the workflow carries
every file forward, and a failed run waits CALL_GAP_MINUTES before it tries
again.

CLI:
  --data-dir DIR   wire-data working tree (default data/)
  --as-of ISO      run as if it were that moment
  --force          ask now, whatever the hour or the stamp says
"""

import argparse
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wire_common as wc  # noqa: E402

SLOTS = (("morning", 7), ("midday", 12), ("evening", 18))   # Burlington hours
CALL_GAP_MINUTES = 50    # a failed run waits this long, as curate_wire.py does
ASK_HEAD, ASK_SPORTS = 20, 8   # asked for: more than is kept, the model skips some
KEEP_HEAD, KEEP_SPORTS = 9, 3  # about 12 pairs a run
MIN_STORIES = 8          # a paper this thin (just after midnight, say) is not asked yet
MAX_TOKENS = 6000
MAX_WORDS = 13           # under 14
QUESTION_WORDS = ("what", "what's", "what’s", "which", "who", "who's", "who’s",
                  "whose", "where", "where's", "where’s", "when", "why", "how", "if")

SCHEMA = {
    "type": "object",
    "properties": {"questions": {"type": "array", "items": {
        "type": "object",
        "properties": {"i": {"type": "integer"}, "q": {"type": "string"}},
        "required": ["i", "q"],
        "additionalProperties": False,
    }}},
    "required": ["questions"],
    "additionalProperties": False,
}

# ----------------------------------------------------------------------
# The dinner guard, ported from all-day/js/talk-core.js and reddit-lib.js.
# tests/test_talk_questions.py fails if these drift from the page's copies.
# ----------------------------------------------------------------------

STORY_CHANNELS = {"local", "world"}
LEFT_TOPICS = {"public-safety", "courts", "markets"}
MAX_TITLE = 130          # past this it is a post, not a headline

FIRST = set("""
aaron abby adam adrian aiden alan albert alex alexa alexis alice alicia alison allison
alyssa amanda amber amy andrea andrew andy angela anita ann anna anne annie anthony
april arthur ashley audrey austin barbara becky ben benjamin beth betty blake bob bobby
brad bradley brandon brenda brett brian briana bridget brittany brooke bruce bryan caleb
cameron carl carla carly carol caroline carolyn carrie catherine cathy charles charlie
charlotte chelsea cheryl chloe chris christina christine christopher cindy claire clara
cody colin colleen connor corey courtney craig crystal cynthia dale dan dana daniel
danielle danny darren dave david dawn dean deb deborah debra denise dennis derek diana
diane dominic don donald donna doug douglas drew dylan ed eddie edward eileen elaine
eleanor elizabeth ellen emily emma eric erica erik erin ethan eugene eva evan evelyn
fiona frances francis frank fred gabriel gail gary gavin george gerald gina glenn gloria
gordon greg gregory hannah harold harry heather helen henry holly howard ian irene isaac
isabel jack jackie jacob jacqueline jake james jamie jan jane janet janice jared jason
jay jean jeff jeffrey jen jenna jennifer jenny jeremy jerry jesse jessica jill jim jimmy
joan joann joanne jody joe joel john johnny jon jonathan jordan jose joseph josh joshua
joyce juan judith judy julia julie justin karen kari karl kate katherine kathleen
kathryn kathy katie katrina kayla keith kelly ken kenneth kenny kevin kim kimberly kirk
kristen kristin kristina kurt kyle larry laura lauren laurie lawrence leah lee leo leon
leslie lila linda lindsay lindsey lisa liz logan lori louis louise lucas lucy luke lydia
lynn madison maggie mandy marc marcus margaret maria marie marilyn marissa marjorie mark
marshall martha martin marty mary mason matt matthew maureen max megan melanie melissa
meredith mia michael michele michelle miguel mike mindy miranda misty mitch mitchell
molly monica morgan nancy naomi natalie nate nathan nathaniel neil nicholas nick nicole
nina noah nora norman olivia oscar owen pam pamela pat patricia patrick paul paula peggy
penny pete peter phil philip phillip rachel ralph randy ray raymond rebecca regina renee
rhonda richard rick ricky rita rob robert roberta robin rod rodney roger ron ronald rory
ross roy ruby russell ruth ryan sally sam samantha samuel sandra sandy sara sarah scott
sean seth shane shannon sharon shawn sheila shelby sherry shirley sophia sophie stacey
stacy stan stanley stella stephanie stephen steve steven stuart sue susan suzanne sydney
tamara tammy tanya tara taylor ted teresa terri terry theresa thomas tiffany tim timothy
tina todd tom tommy toni tony tracey tracy travis trevor troy tyler valerie vanessa vera
veronica vicki vicky victor victoria vincent virginia walter wanda wayne wendy wesley
whitney william willie wyatt yvonne zach zachary zoe
""".split())
NOT_SURNAME = set("""
street st ave avenue road rd drive lane park hill peak mountain lake pond river beach
bay island trail bridge farm farms house hall center centre school college university
hospital clinic church library market store shop shops bar cafe bakery brewery pub pizza
kitchen diner deli inn hotel show band trio quartet concert festival fair night day week
""".split())
HEAVY = re.compile(r"""\b(kill(?:s|ed|ing|er|ers)?|dead|dies?|died|dying|deaths?|deadly|fatal\w*|pass(?:es|ed)? away|obituar\w*|tributes?|funeral|mourn\w*|memorial|vigil|remembers|tragic|tragedy|tragedies|victims?|suicid\w*|overdos\w*|drown\w*|missing|crash\w*|collision|wreck\w*|rollover|injur\w*|hospitali[sz]ed|critical condition|rescued|wildfires?|fires?|burn|blaze|inferno|hurricanes?|typhoons?|tornado\w*|earthquakes?|tsunami|floods?|flooding|landslides?|avalanche|disasters?|catastroph\w*|evacuat\w*|explosions?|bombs?|bombing|blast|attacks?|attacked|ambush\w*|airstrikes?|missiles?|drones?|troops|invasion|massacre|genocid\w*|battered|wars?|gunman|gunmen|gunfire|guns?|shot|shoots?|shooter|knife|hostages?|terror\w*|crimes?|criminal|robber\w*|burglar\w*|theft|kidnap\w*|trafficking|sexual|prison|jail\w*|inmates?|detainees?|police|lawsuit|sued|trial|verdict|guilty|cancer|dementia|miscarriages?|outbreak|epidemic|pandemic|flesh-eating|cruel\w*|hate|plead\w*|plea|suspects?|suspected|cited|looting|riot\w*|violen\w*|execution|espionage|sabotage|shackled|blood clots?|fuck\w*|epstein)\b""", re.I | re.A)
BARE_NAME = re.compile(r"""^(?!(?:The|A|An|This|That|These|Those|Our|Your|My|Why|How|What|When|Where|Who|New|Old)\b)[A-Z][a-z'-]+ [A-Z][a-z'-]+(?:\s+(?:is|has)\b|[\s.!?…]*$)""", re.A)
PUBLIC = re.compile(r"""\b(Phil Scott|Bernie Sanders|Becca Balint|Peter Welch|Emma Mulvaney-Stanak|Miro Weinberger|Amanda Janoo|Donald Trump|Joe Biden|Kamala Harris)\b""", re.A)
NAMED = re.compile(r"""\b([A-Z][A-Za-z]+)(?=\s+(?:[A-Z]\.\s+)?([A-Z][A-Za-z’'-]+))""", re.A)
INITIAL = re.compile(r"""(?<![\w.])[A-Z]\.\s+([A-Z][A-Za-z’'-]+)""", re.A)
ROLE = re.compile(r"""\b(?:officer|deputy|sgt|sergeant|detective|prosecutor|judge|mr|mrs|ms|dr|professor|principal|superintendent|councilor|coach|pastor|reverend|rev)\.?\s+([A-Za-z]+)""", re.I | re.A)
CRIME = re.compile(r"""\b(accus\w*|alleg\w*|arrest\w*|embezzl\w*|stole|fraud\w*|indict\w*|charged|convict\w*|assault\w*|abus\w*|molest\w*|rape\w*|rapist|pedophil\w*|predator\w*|stalk\w*|harass\w*|murder\w*|homicide|shooting|stabb\w*|sentenced|misconduct|scammer)\b""", re.I | re.A)
MINOR = re.compile(r"""\b1[0-7][- ]?(?:year|yr|yo)\b""", re.I | re.A)
CONTACT = re.compile(r"""\bu\/[A-Za-z0-9_-]+|\b[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b|(?<!\d)\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}(?!\d)|\b\d+[a-z]?\s+(?:(?!(?:at|in|on|of|the|an?|to|by|for|from|near|and|or|with|mi|miles?|km|acres?|min|minutes?|hrs?|hours?|days?|weeks?|months?|yrs?|years?)\s)[a-z.'’-]+\s+){1,3}?(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|pl|place|pkwy|parkway|ter|terrace|cir|circle|way|blvd|boulevard|hts|heights|xing|crossing|sq|square|aly|alley|rdg|ridge|hl|hill|bch|grn|grv|park|trl|trail)\b""", re.I | re.A)


def names_person(title):
    text = PUBLIC.sub(" ", str(title or ""))
    for match in NAMED.finditer(text):
        if match.group(1).lower() in FIRST and match.group(2).lower() not in NOT_SURNAME:
            return True
    for match in INITIAL.finditer(text):
        if match.group(1).lower() not in NOT_SURNAME:
            return True
    return any(re.match(r"[A-Z][a-z]", match.group(1)) for match in ROLE.finditer(text))


def held(title):
    text = str(title or "")
    return names_person(text) or bool(CRIME.search(text) or MINOR.search(text) or CONTACT.search(text))


def fit(title, topic=None):
    text = re.sub("[‘’]", "'", str(title or ""))
    text = re.sub("[“”]", '"', text)
    return (topic not in LEFT_TOPICS and not held(text) and not HEAVY.search(text)
            and not BARE_NAME.search(text))


def card(item, kind, sources):
    if not isinstance(item, dict) or not item.get("id") or not item.get("title"):
        return None
    url, title = str(item.get("url") or ""), str(item["title"])
    if not re.match(r"https?:", url, re.I) or re.search("obituar", url, re.I):
        return None
    if item.get("ch") not in STORY_CHANNELS or item.get("own") or len(title) > MAX_TITLE:
        return None
    if not fit(title, item.get("topic")):
        return None
    source = sources.get(item.get("src")) if isinstance(sources.get(item.get("src")), dict) else {}
    name = item.get("name") or source.get("name") or ""
    if not name:
        return None
    return {"id": str(item["id"]), "b": kind, "title": title, "name": name,
            "src": item.get("src") or name, "url": url, "local": bool(item.get("local")),
            "posted_at": item.get("posted_at"), "why": item.get("why") or ""}


def once(cards):
    seen, out = set(), []
    for one in cards:
        if one and one["id"] not in seen:
            seen.add(one["id"])
            out.append(one)
    return out


def stories(paper):
    """(head, sports), in the order talk-core.js's stories() reads the paper."""
    sources = paper.get("sources") if isinstance(paper.get("sources"), dict) else {}
    updates = paper.get("updates") if isinstance(paper.get("updates"), list) else []
    river = [item for update in updates if isinstance(update, dict)
             for item in (update.get("items") or []) if isinstance(item, dict)]
    picks = [pick for pick in paper.get("picks") or [] if isinstance(pick, dict)]
    picks.sort(key=lambda pick: pick.get("rank") or 99)
    head = once(card(item, "head", sources) for item in picks + river
                if item.get("topic") != "sports")
    lanes = paper.get("sports") if isinstance(paper.get("sports"), dict) else {}
    lane_cards = []
    for chip, items in lanes.items():
        for item in items if isinstance(items, list) else []:
            one = card(item, "sports", sources)
            if one and chip == "local":
                one["local"] = True
            lane_cards.append(one)
    sports = once(lane_cards + [card(item, "sports", sources) for item in river
                                if item.get("topic") == "sports"])
    sports.sort(key=lambda one: (not one["local"], -(epoch(one["posted_at"]))))
    return head, sports


def epoch(iso):
    try:
        return datetime.fromisoformat(str(iso)).timestamp()
    except ValueError:
        return 0


# ----------------------------------------------------------------------
# Asking
# ----------------------------------------------------------------------


def slot_for(et):
    """The latest slot this Burlington hour has reached, or None before the first."""
    now = None
    for name, hour in SLOTS:
        if et.hour >= hour:
            now = name
    return now


def format_stories(asks):
    lines = []
    for i, one in enumerate(asks):
        kind = "sports" if one["b"] == "sports" else "Vermont" if one["local"] else "national"
        why = f" || {one['why']}" if one["why"] else ""
        lines.append(f"{i}. [{kind}] {one['title']}{why}")
    return "\n".join(lines)


def good_question(text, title):
    """The clean question, or None when it breaks a rule the model was given."""
    q = " ".join(str(text or "").split())
    words = q.split()
    if not 3 <= len(words) <= MAX_WORDS or not q.endswith("?") or q.count("?") != 1:
        return None
    first = words[0].lower().strip(",")
    if first not in QUESTION_WORDS:
        return None
    # "If bike lanes went in, would you..." is a yes/no in a coat
    if first == "if" and not ("," in q and q.split(",", 1)[1].split()[0].lower() in QUESTION_WORDS):
        return None
    if wc.restates(q, title, share=0.6) or not fit(q):
        return None
    return q


def take_answer(answer, asks):
    """{story id: question}. A number that is not on the list, a second answer
    for a story, and a question that fails the rules are all dropped."""
    out = {}
    entries = answer.get("questions") if isinstance(answer, dict) else None
    for entry in entries if isinstance(entries, list) else []:
        i = entry.get("i") if isinstance(entry, dict) else None
        if not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < len(asks):
            continue
        q = good_question(entry.get("q"), asks[i]["title"])
        if q and asks[i]["id"] not in out:
            out[asks[i]["id"]] = q
    return out


def keep_pairs(head, sports, known):
    """About 12 pairs in the paper's order; one kind running short leaves room
    for the other."""
    head = [one for one in head if one["id"] in known]
    sports = [one for one in sports if one["id"] in known]
    room = KEEP_HEAD + KEEP_SPORTS
    kept_sports = sports[:max(KEEP_SPORTS, room - len(head))]
    kept_head = head[:room - len(kept_sports)]
    public = ("id", "b", "title", "name", "src", "url", "local", "posted_at")
    return [{**{key: one[key] for key in public}, "q": known[one["id"]]}
            for one in kept_head + kept_sports]


def waited(prior, now):
    """True while a failed run's CALL_GAP_MINUTES are still running."""
    tried = prior.get("tried_at")
    if not tried:
        return False
    return 0 <= (now - datetime.fromisoformat(tried)).total_seconds() < CALL_GAP_MINUTES * 60


def as_of(args):
    value = getattr(args, "as_of", None)
    return datetime.fromisoformat(value).astimezone(timezone.utc) if value else None


def run(args):
    now = as_of(args) or wc.utcnow()
    et = wc.et_now(now)
    today = et.date().isoformat()
    path = os.path.join(args.data_dir, "talk-today.json")
    prior = wc.load_json(path, {})
    prior = prior if isinstance(prior, dict) else {}
    slot = slot_for(et)
    force = getattr(args, "force", False)
    if not force:
        if slot is None:
            print("talk_questions: before the morning run")
            return 0
        if prior.get("date") == today and prior.get("slot") == slot:
            print(f"talk_questions: {slot} is done")
            return 0
        if waited(prior, now):
            print("talk_questions: the last try failed under an hour ago; next tick")
            return 0

    paper = wc.load_json(os.path.join(args.data_dir, "wire-today.json"), None)
    if not isinstance(paper, dict) or paper.get("date") != today:
        print("talk_questions: no paper for today yet")
        return 0
    engine = wc.pick_engine("curate")
    if engine is None:
        print("talk_questions: no ANTHROPIC_API_KEY or OPENROUTER_API_KEY, skipping")
        return 0
    refuse, spent = wc.over_budget(args.data_dir, now)
    if refuse:
        line = (f"talk_questions: refusing to run, ${spent:.2f} spent this month "
                f"(cap ${wc.MONTH_CAP_USD:.0f})")
        print(line)
        wc.step_summary("- " + line)
        return 0

    head, sports = stories(paper)
    known = {one["id"]: one["q"] for one in prior.get("items") or []
             if isinstance(one, dict) and one.get("id") and one.get("q")}
    if len(head) + len(sports) < MIN_STORIES:
        print("talk_questions: the paper is still thin; next tick")
        return 0
    chosen = head[:ASK_HEAD] + sports[:ASK_SPORTS]
    asks = [one for one in chosen if one["id"] not in known]
    fresh = {}
    if asks:
        try:
            answer, usage = wc.ask_json(engine, wc.read_prompt("talk-questions.md"), format_stories(asks), SCHEMA,
                                        max_tokens=MAX_TOKENS, log_prefix="talk_questions")
        except Exception as exc:  # noqa: BLE001 — SDK missing, network, anything
            print(f"talk_questions: keeping the last file ({exc})", file=sys.stderr)
            if getattr(exc, "usage", None):
                wc.record_cost(args.data_dir, "talk_questions", engine, exc.usage, now)
            wc.write_json(path, {**prior, "tried_at": now.replace(microsecond=0).isoformat()})
            return 0
        wc.record_cost(args.data_dir, "talk_questions", engine, usage, now)
        fresh = take_answer(answer, asks)
    items = keep_pairs(head, sports, {**known, **fresh})
    if not items:
        print("talk_questions: nothing passed, keeping the last file", file=sys.stderr)
        wc.write_json(path, {**prior, "tried_at": now.replace(microsecond=0).isoformat()})
        return 0
    wc.write_json(path, {"v": 1, "date": today, "slot": slot or "morning",
                         "updated": now.replace(microsecond=0).isoformat(), "items": items})
    print(f"talk_questions: {len(items)} pairs for {slot or 'morning'}, "
          f"{len(fresh)} of {len(asks)} asked came back good")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data-dir", default=os.path.join(wc.ROOT, "data"))
    parser.add_argument("--as-of", help="run as if it were this ISO moment")
    parser.add_argument("--force", action="store_true", help="ask now, whatever the stamp says")
    return run(parser.parse_args())


if __name__ == "__main__":
    sys.exit(main())
