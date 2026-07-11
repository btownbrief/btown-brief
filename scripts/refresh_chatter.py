#!/usr/bin/env python3
"""Refresh the public chatter summary and its small, public-safe history."""

import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import html
import json
import os
import re
import sys
import tempfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "data", "chatter.json")
SEEN = os.path.join(ROOT, "data", "chatter-seen.json")
TIPS = os.path.join(ROOT, "data", "tips-inbox.md")
UA = "btown-brief-site/1.0 (chatter refresh)"
MODEL = os.environ.get("CHATTER_MODEL", "claude-sonnet-5")

INOREADER = {
    "r/burlington": "https://www.inoreader.com/stream/user/1003590800/tag/Reddit%20%28r%2Fburlington%29?n=100",
    "r/vermont": "https://www.inoreader.com/stream/user/1003590800/tag/Reddit%20%28r%2FVermont%29?n=100",
}
STOP = set(("the a an and or but if then than to of in on at for from with by is are was were be been being "
            "it its this that these those i me my we our you your they their he she as do does did have has had "
            "can could would should will just not no so some any all about into out up down over more most who what "
            "where when why how burlington vermont btv city town area anyone know knows looking look best good great "
            "place places spot spots recommend recommendation recommendations thoughts question help need needs today "
            "tonight week around near").split())
ROUGH_TERMS = {"theft", "stolen", "steal", "break-in", "breakin", "robbery", "assault", "needles", "drugs",
               "overdose", "encampment", "gunshot", "shooting", "shots fired", "police", "cops", "arrested",
               "arrest", "scam", "scammer", "vandalism", "vandalized", "harass", "harassment", "catcall",
               "creep", "creepy", "sketchy", "unsafe", "rant", "vent", "pissed", "furious", "slumlord",
               "evicted", "eviction", "drunk driver", "road rage", "screaming"}
ACCUSE = {"scam", "scammed", "stole", "steals", "assault", "harass", "avoid", "warning", "beware",
          "slumlord", "creep", "predator", "abuser", "racist", "thief"}
DEROGATORY = {"moron", "idiot", "scumbag", "trashbag", "worst", "terrible", "awful", "fraud",
              "liar", "shady", "disgusting", "pathetic", "loser", "jerk"}
PUBLIC_NAMES = {"Emma Mulvaney-Stanak", "Miro Weinberger", "Phil Scott", "Becca Balint", "Peter Welch",
                "Bernie Sanders", "Kunin"}
# Capitalized words that start name-shaped pairs without naming anyone —
# places, institutions, calendar words, and sentence-leading question words.
# Compared casefolded, so ALL-CAPS forms are covered too.
NON_NAMES = {"street", "st", "ave", "avenue", "road", "rd", "drive", "park", "church", "main", "pine",
             "north", "south", "east", "west", "new", "old", "lake", "champlain", "burlington", "vermont",
             "winooski", "essex", "shelburne", "colchester", "williston", "city", "county", "hall", "market",
             "hospital", "medical", "center", "school", "high", "university", "college", "library", "farmers",
             "beach", "bay", "point", "island", "mountain", "green", "bike", "path", "end", "ward", "wards",
             "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january",
             "february", "march", "april", "may", "june", "july", "august", "september", "october",
             "november", "december", "the", "a", "i", "has", "who", "what", "where", "when", "why", "how",
             "does", "is", "are", "any", "anyone", "best", "free", "happy", "national", "day", "week",
             "weekend", "uvm", "btv", "vt", "usa", "psa", "iso", "dmv", "front", "porch", "forum"}
NEWS = {"fire", "lawsuit", "eviction", "development", "zoning", "permit", "closing permanently", "laid off",
        "layoffs", "strike", "union", "grand opening"}


# ----------------------------------------------------------------------
# Small text, time, and file helpers
# ----------------------------------------------------------------------

def utcnow():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds")


def parse_time(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return parsedate_to_datetime(value)


def clean_space(value):
    return re.sub(r"\s+", " ", value or "").strip()


def strip_html(value):
    value = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", value or "")
    return clean_space(html.unescape(re.sub(r"(?s)<[^>]+>", " ", value)))


def trim(value, limit):
    value = clean_space(value)
    if len(value) <= limit:
        return value
    cut = value[:limit - 1].rsplit(" ", 1)[0] or value[:limit - 1]
    return cut.rstrip(" ,.;:-") + "…"


def tokens(value):
    return [x for x in re.findall(r"[a-z0-9]+", (value or "").lower()) if len(x) >= 3 and x not in STOP]


def term_hit(text, terms):
    low = (text or "").lower()
    return any(re.search(r"(?<!\w)" + re.escape(term) + r"(?!\w)", low) for term in terms)


def reddit_id(url):
    match = re.search(r"/comments/([a-z0-9]+)/", url or "", re.I)
    return match.group(1).lower() if match else None


def reddit_url(url):
    post_id = reddit_id(url)
    if not post_id:
        return None
    path = urllib.parse.urlsplit(url).path
    return "https://www.reddit.com" + path


def cleaned_title(value):
    value = re.sub(r"^\s*(?:PSA\s*:\s*|\[[^]]+\]\s*)", "", value or "", flags=re.I)
    value = re.sub(r"\s*[|—-]\s*r/(?:burlington|vermont)\s*$", "", value, flags=re.I)
    return trim(value, 64)


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as src:
            return json.load(src)
    except (OSError, ValueError):
        return default


def write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as dst:
        json.dump(value, dst, indent=2, ensure_ascii=False)
        dst.write("\n")


# ----------------------------------------------------------------------
# Ingestion — every network request is bounded and independently optional
# ----------------------------------------------------------------------

def fetch_bytes(url, accept):
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def parse_inoreader(raw, sub):
    posts = []
    for item in ET.fromstring(raw).findall(".//item")[:100]:
        link = reddit_url(item.findtext("link"))
        post_id = reddit_id(link)
        if not post_id:
            continue
        body = strip_html(item.findtext("description"))
        body = re.sub(r"\s+submitted by\s+/u/.*$", "", body, flags=re.I).strip()
        posts.append({"id": post_id, "title": clean_space(item.findtext("title")), "body": body[:600],
                      "score": None, "comments": None, "created": parse_time(item.findtext("pubDate")),
                      "url": link, "sub": sub, "from_reddit": False, "from_inoreader": True})
    return posts


def parse_reddit(data, sub):
    posts = []
    for child in (data.get("data") or {}).get("children", [])[:100]:
        row = child.get("data") or {}
        post_id = str(row.get("id") or "").lower()
        link = reddit_url("https://www.reddit.com" + (row.get("permalink") or ""))
        if not post_id or not link:
            continue
        posts.append({"id": post_id, "title": clean_space(row.get("title")), "body": clean_space(row.get("selftext"))[:600],
                      "score": row.get("score"), "comments": row.get("num_comments"),
                      "created": datetime.fromtimestamp(row.get("created_utc", 0), timezone.utc),
                      "url": link, "sub": sub, "from_reddit": True, "from_inoreader": False})
    return posts


def merge_posts(groups):
    merged = {}
    for post in (p for group in groups for p in group):
        old = merged.get(post["id"])
        if not old:
            merged[post["id"]] = post
            continue
        if post["from_reddit"]:
            for key in ("created", "score", "comments"):
                old[key] = post[key]
        for key in ("title", "body", "url"):
            if not old.get(key):
                old[key] = post.get(key)
        old["from_reddit"] |= post["from_reddit"]
        old["from_inoreader"] |= post["from_inoreader"]
    return list(merged.values())


def load_sources(fixtures=None):
    groups = []
    if fixtures:
        for sub, name in (("r/burlington", "inoreader-burlington.xml"),
                          ("r/vermont", "inoreader-vermont.xml")):
            try:
                with open(os.path.join(fixtures, name), "rb") as src:
                    groups.append(parse_inoreader(src.read(), sub))
            except Exception as exc:  # one fixture may still be usable
                print(f"could not read {name}: {exc}", file=sys.stderr)
        for sub, name in (("r/burlington", "reddit-burlington.json"),
                          ("r/vermont", "reddit-vermont.json")):
            path = os.path.join(fixtures, name)
            if os.path.exists(path):
                try:
                    with open(path, encoding="utf-8") as src:
                        groups.append(parse_reddit(json.load(src), sub))
                except Exception as exc:
                    print(f"could not read {name}: {exc}", file=sys.stderr)
        return merge_posts(groups), "fixtures"

    used_reddit = used_inoreader = False
    for sub in ("r/burlington", "r/vermont"):
        short = sub.split("/", 1)[1]
        loaded = False
        for host in ("www.reddit.com", "old.reddit.com", "api.reddit.com"):
            try:
                raw = fetch_bytes(f"https://{host}/r/{short}/new.json?limit=100", "application/json")
                groups.append(parse_reddit(json.loads(raw), sub))
                used_reddit = loaded = True
                break
            except Exception as exc:
                print(f"reddit {host} {short} failed: {exc}", file=sys.stderr)
        if not loaded:
            print(f"reddit r/{short} unavailable; continuing", file=sys.stderr)
        try:
            groups.append(parse_inoreader(fetch_bytes(INOREADER[sub], "application/rss+xml, application/xml"), sub))
            used_inoreader = True
        except Exception as exc:
            print(f"inoreader {short} failed: {exc}", file=sys.stderr)
    mode = ("reddit+inoreader" if used_reddit and used_inoreader else
            "reddit-only" if used_reddit else "inoreader-only")
    return merge_posts(groups), mode


# ----------------------------------------------------------------------
# Safety, clustering, trend activity, and heuristic highlights
# ----------------------------------------------------------------------

# Unicode-aware: TitleCase, ALL-CAPS, accents, apostrophes, and hyphens all
# count as name-shaped ("José DOE", "O'Brien", "Mulvaney-Stanak"). The
# lookahead makes matches overlap, so "seen Jane Doe" still yields "Jane Doe".
NAME_RE = re.compile(r"(?<![\w'’-])(?=(([^\W\d_][\w'’-]+)\s+([^\W\d_][\w'’-]+)(?![\w'’-])))")


def name_candidates(original):
    original = re.sub(r"https?://\S+", " ", original or "")
    found = []
    for match in NAME_RE.finditer(original):
        first, second = match.group(2), match.group(3)
        if not (first[:1].isupper() and second[:1].isupper()):
            continue
        name = match.group(1)
        if any(name in public or public in name for public in PUBLIC_NAMES):
            continue
        if {first.casefold().strip("'’-"), second.casefold().strip("'’-")} & NON_NAMES:
            continue
        found.append(name)
    return found


SEEKING = re.compile(r"\b(?:has anyone seen|anyone seen|anyone know(?:s)? (?:a|an)?\s*|who is|whos|who's|"
                     r"looking for|watch out for|seen a? ?(?:man|woman|guy|lady) named)\s+[A-ZÀ-Þ]", re.I)


def safety_flag(post):
    """A post that names a person in a hostile, seeking, or doxx-y way stays
    off every public surface and becomes a private tip instead. Name-shaped
    matches alone don't flag — half of r/burlington is business names like
    'Taco Gordo' — but any hostile term, person-hunt phrasing, or phone/
    address pattern alongside one does. The optional LLM pass may ADD flags
    for nuance; it can never remove one."""
    original = post["title"] + " " + post["body"]
    names = name_candidates(original)
    # A named person in an accusing, hostile, crime/complaint, or person-seeking
    # context never goes public — that's the defamation/privacy risk. (ROUGH_TERMS
    # covers theft/police/eviction/harassment/etc.) Positive or neutral mentions
    # and whitelisted public figures stay on the page.
    if names and term_hit(original, ACCUSE | DEROGATORY | ROUGH_TERMS):
        return True
    if names and SEEKING.search(original):
        return True
    person_ref = bool(names or re.search(r"\b(?:my neighbor|this guy|this woman)\b", original, re.I))
    phone = re.search(r"(?<!\d)(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}(?!\d)", original)
    address = re.search(r"\b\d+\s+[A-Z][\w'-]+\s+(?:St|Street|Ave|Avenue|Rd|Road)\b", original)
    return bool(person_ref and (phone or address))


def signature(post):
    title = tokens(post["title"])
    body = tokens(post["body"][:400])
    weights = Counter(body)
    for token in title:
        weights[token] += 2
    bigrams = set(zip(title, title[1:]))
    return set(title), bigrams, weights


def similarity(a, cluster):
    at, ab, aw = a
    ct, cb, cw = cluster["title_tokens"], cluster["bigrams"], cluster["weights"]
    shared_title = len(at & ct)
    shared_bigram = bool(ab & cb)
    keys = set(aw) | set(cw)
    jac = sum(min(aw[k], cw[k]) for k in keys) / max(1, sum(max(aw[k], cw[k]) for k in keys))
    eligible = shared_title >= 2 or shared_bigram or jac >= 0.30
    return (shared_title * 2 + shared_bigram + jac) if eligible else -1


def cluster_posts(posts):
    clusters = []
    for post in sorted(posts, key=lambda p: p["created"], reverse=True):
        sig = signature(post)
        choices = [(similarity(sig, cluster), index) for index, cluster in enumerate(clusters)]
        score, index = max(choices, default=(-1, -1))
        if score < 0:
            clusters.append({"posts": [post], "title_tokens": set(sig[0]), "bigrams": set(sig[1]),
                             "weights": Counter(sig[2])})
        else:
            cluster = clusters[index]
            cluster["posts"].append(post)
            cluster["title_tokens"].update(sig[0])
            cluster["bigrams"].update(sig[1])
            cluster["weights"].update(sig[2])
    for cluster in clusters:
        freq = Counter(token for post in cluster["posts"] for token in tokens(post["title"] + " " + post["body"][:400]))
        top = sorted(freq, key=lambda token: (-freq[token], token))[:3]
        cluster["id"] = "-".join(top) or "post-" + cluster["posts"][0]["id"]
        known = [post for post in cluster["posts"] if post["comments"] is not None]
        cluster["rep"] = max(known, key=lambda p: (p["comments"], p["created"])) if known else cluster["posts"][0]
        cluster["rough"] = sum(term_hit(p["title"] + " " + p["body"], ROUGH_TERMS) for p in cluster["posts"]) * 2 >= len(cluster["posts"])
    return clusters


def activity(cluster, now, old_posts):
    total = 0.0
    for post in cluster["posts"]:
        age = (now - post["created"]).total_seconds() / 3600
        total += 3 if age < 12 else 2 if age < 24 else 1 if age < 48 else 0.5
        old = old_posts.get(post["id"], {})
        if post["comments"] is not None and old.get("last_comments") is not None:
            total += 0.15 * max(0, post["comments"] - old["last_comments"])
    return round(total, 3)


def direction(current, prior):
    if prior is None:
        return "hot" if current >= 4 else "rising" if current >= 1.5 else "steady"
    if current >= 6:
        return "hot"
    ratio = current / prior if prior else float("inf")
    return "rising" if ratio >= 1.5 else "fading" if ratio <= 0.6 else "steady"


SLOT_LABELS = {
    "useful_question": "Most useful neighbor question", "funniest": "Funniest local post",
    "most_debated": "Most debated", "needs_help": "Someone needs help",
    "recommendation": "Something people keep recommending", "rumor": "Emerging rumor — unverified",
}


def question(title):
    return title.rstrip().endswith("?") or re.match(r"^(?:who|what|where|when|why|how|does|is|are|any|anyone)\b", title, re.I)


def slot_candidates(posts, clusters):
    cluster_size = {post["id"]: len(cluster["posts"]) for cluster in clusters for post in cluster["posts"]}
    practical = {"dentist", "doctor", "plumber", "electrician", "mechanic", "daycare", "vet", "barber", "salon",
                 "dmv", "parking", "apartment", "lease", "internet", "compost", "recycle", "permit", "contractor",
                 "mover", "storage", "tailor", "repair", "dump", "transfer station"}
    civic = {"council", "mayor", "tax", "taxes", "zoning", "housing", "rent", "landlord", "bike lane", "parking",
             "school", "budget", "ordinance", "ban", "vote", "election", "development", "church street", "act 250"}
    # Single generic words only count in titles — bodies say "missing" or
    # "heard" all the time without meaning a lost pet or a rumor.
    help_title = {"lost", "missing", "found", "borrow", "ride", "iso"}
    help_terms = {"help find", "donations", "fundraiser", "gofundme", "in search of", "stolen bike"}
    rec = {"recommend", "recommendations", "best", "favorite", "where do you", "where can i"}
    rumor_title = {"closing", "opening", "rumor"}
    rumor = {"rumor has it", "heard a rumor", "heard they", "heard it", "is it true", "anyone know what",
             "what's going in", "whats going in", "going into the old", "closed for good", "opening soon",
             "coming to", "replacing", "for sale", "shutting down"}
    humor = {"lol", "lmao", "funny", "joke", "meme", "satire", "parody", "😂", "🤣", "shitpost", "chucklefuck", "onion"}
    out = {key: [] for key in SLOT_LABELS}
    for post in posts:
        text = post["title"] + " " + post["body"]
        comments = post["comments"] if post["comments"] is not None else -1
        recency = post["created"].timestamp()
        if question(post["title"]) and term_hit(text, practical):
            out["useful_question"].append(((comments, recency), post))
        if term_hit(text, humor) or (re.search(r"(?:\b[A-Z]{2,}\b.*){2,}!", post["title"]) is not None):
            out["funniest"].append((((post["score"] or -1), comments, recency), post))
        if term_hit(text, civic):
            rank = (comments, recency) if comments >= 0 else (cluster_size[post["id"]], recency)
            out["most_debated"].append((rank, post))
        if term_hit(post["title"], help_title) or term_hit(text, help_terms):
            out["needs_help"].append(((recency,), post))
        if question(post["title"]) and term_hit(text, rec):
            out["recommendation"].append(((comments, recency), post))
        if ((term_hit(post["title"], rumor_title) or term_hit(text, rumor))
                and (question(post["title"]) or re.search(r"\b(?:apparently|maybe|wonder|anyone|heard)\b", text, re.I))):
            out["rumor"].append(((comments, recency), post))
    for values in out.values():
        values.sort(key=lambda pair: pair[0], reverse=True)
    return out


def choose_slots(candidates, requested=None):
    chosen, used = {}, set()
    priority = ("rumor", "needs_help", "most_debated", "useful_question", "recommendation", "funniest")
    by_id = {post["id"]: post for values in candidates.values() for _, post in values}
    for slot in priority:
        if requested is not None and slot in requested and requested[slot] is None:
            continue
        wanted = requested.get(slot) if requested else None
        options = ([by_id[wanted]] if wanted in by_id and any(p["id"] == wanted for _, p in candidates[slot]) else
                   [post for _, post in candidates[slot]])
        post = next((item for item in options if item["id"] not in used), None)
        if post:
            chosen[slot] = post
            used.add(post["id"])
    return chosen


def highlight(slot, post):
    value = {"slot": slot, "slot_label": SLOT_LABELS[slot], "title": post["title"], "url": post["url"],
             "sub": post["sub"], "when": iso(post["created"]), "blurb": trim(post["body"], 140),
             "comments": post["comments"], "unverified": slot == "rumor"}
    return value


# ----------------------------------------------------------------------
# Optional one-call refinement and private tips inbox
# ----------------------------------------------------------------------

def refine(clusters, picks):
    key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not key:
        return None
    packet = {"clusters": [{"id": c["id"], "label": cleaned_title(c["rep"]["title"]),
                             "posts": [{"id": p["id"], "title": p["title"], "blurb": trim(p["body"], 140)}
                                       for p in c["posts"]]} for c in clusters],
              "slots": {slot: post["id"] for slot, post in picks.items()}}
    prompt = ("Refine this Burlington chatter packet. Return strict JSON only: "
              '{"labels":{"topic-id":"noun phrase"},"slots":{"slot":"post-id or null"},'
              '"rough_ids":[],"flag_ids":[]}. Labels: <=7 words, no emoji.\n' + json.dumps(packet, ensure_ascii=False))
    body = json.dumps({"model": MODEL, "max_tokens": 1200, "messages": [{"role": "user", "content": prompt}]}).encode()
    request = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body,
                                     headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                                              "content-type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.loads(response.read())
        text = "".join(block.get("text", "") for block in result.get("content", [])).strip()
        value = json.loads(text)
        if not isinstance(value.get("labels", {}), dict) or not isinstance(value.get("slots", {}), dict):
            raise ValueError("wrong response shape")
        valid_ids = {post["id"] for cluster in clusters for post in cluster["posts"]}
        valid_topics = {cluster["id"] for cluster in clusters}
        # The model reads untrusted reddit text, so treat its output as a
        # suggestion: labels must be name-free and share vocabulary with the
        # cluster they describe, and it may only flag a handful of posts —
        # a reply that tries to rewrite or empty the page is discarded.
        cluster_vocab = {cluster["id"]: set(tokens(" ".join(post["title"] + " " + post["body"][:400]
                                                            for post in cluster["posts"])))
                         for cluster in clusters}
        value["labels"] = {topic_id: label for topic_id, label in value.get("labels", {}).items()
                           if topic_id in valid_topics and isinstance(label, str) and len(label.split()) <= 7
                           and len(label) <= 64 and not re.search(r"[^\x00-\x7f]", label)
                           and not name_candidates(label)
                           and set(tokens(label)) & cluster_vocab[topic_id]}
        value["rough_ids"] = [post_id for post_id in value.get("rough_ids", []) if post_id in valid_ids][:5]
        value["flag_ids"] = [post_id for post_id in value.get("flag_ids", []) if post_id in valid_ids][:5]
        return value
    except Exception as exc:
        print(f"LLM refinement failed; keeping heuristic output: {exc}", file=sys.stderr)
        return None


def append_tips(leads, path=TIPS):
    if not leads:
        return 0
    try:
        with open(path, encoding="utf-8") as src:
            existing = src.read()
    except OSError:
        existing = "<!-- PRIVATE — newsletter leads, never publish directly; verify everything independently -->\n"
    urls = set(re.findall(r"https://[^)\s]+", existing))
    fresh = [lead for lead in leads if lead[0] not in urls]
    if not fresh:
        return 0
    day = datetime.now().astimezone().date().isoformat()
    section = "" if re.search(rf"^## {re.escape(day)}$", existing, re.M) else f"\n## {day}\n"
    lines = []
    for url, post, why in fresh:
        count = f"{post['comments']} comments" if post["comments"] is not None else "comments unknown"
        lines.append(f"- [ ] **[{post['title']}]({url})** — {post['sub']} · {count} · why: {why}")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as dst:
        dst.write(existing.rstrip() + "\n" + section.lstrip("\n") + "\n".join(lines) + "\n")
    return len(fresh)


# ----------------------------------------------------------------------
# Full refresh
# ----------------------------------------------------------------------

def run(fixtures=None, dry_run=False):
    now = utcnow()
    posts, mode = load_sources(fixtures)
    posts = [p for p in posts if p["created"] and timedelta(0) <= now - p["created"] <= timedelta(hours=72)
             and not re.search(r"\b(?:daily thread|weekly thread|megathread)\b", p["title"], re.I)]
    if len(posts) < 5 and not fixtures:
        # r/burlington alone runs ~25 posts per 72h window — fewer than 5
        # means ingestion is broken, not that the town went quiet.
        print(f"only {len(posts)} posts loaded in the 72-hour window; keeping last good chatter.json")
        return 0
    if not posts:
        print("zero posts loaded in the 72-hour window; keeping last good chatter.json")
        return 0

    state = load_json(SEEN, {"posts": {}, "snapshots": []})
    old_posts = state.get("posts", {})
    for post in posts:
        post["flagged"] = safety_flag(post)
        post["rough"] = term_hit(post["title"] + " " + post["body"], ROUGH_TERMS)

    public_posts = [post for post in posts if not post["flagged"]]
    clusters = cluster_posts(public_posts)
    heuristic_picks = choose_slots(slot_candidates([p for p in public_posts if not p["rough"]], clusters))
    llm_result = refine(clusters, heuristic_picks)
    llm_flags = set(llm_result.get("flag_ids", [])) if llm_result else set()
    llm_rough = set(llm_result.get("rough_ids", [])) if llm_result else set()
    if llm_flags or llm_rough:
        for post in posts:
            post["flagged"] |= post["id"] in llm_flags
            post["rough"] |= post["id"] in llm_rough
        public_posts = [post for post in posts if not post["flagged"]]
        clusters = cluster_posts(public_posts)
        for cluster in clusters:
            cluster["rough"] = sum(post["rough"] for post in cluster["posts"]) * 2 >= len(cluster["posts"])

    candidates = slot_candidates([p for p in public_posts if not p["rough"]], clusters)
    requested = llm_result.get("slots", {}) if llm_result else None
    picks = choose_slots(candidates, requested)
    labels = llm_result.get("labels", {}) if llm_result else {}

    snapshots = [snap for snap in state.get("snapshots", []) if parse_time(snap.get("ts")) and
                 now - parse_time(snap["ts"]) <= timedelta(days=7)]
    target = now - timedelta(hours=24)
    # Only a snapshot actually ~a day old is a valid baseline; comparing
    # against one from a few hours ago would flatten every direction.
    window = [snap for snap in snapshots
              if timedelta(hours=18) <= now - parse_time(snap["ts"]) <= timedelta(hours=30)]
    prior_snap = min(window, key=lambda snap: abs((parse_time(snap["ts"]) - target).total_seconds()), default=None)
    current = {cluster["id"]: activity(cluster, now, old_posts) for cluster in clusters}
    rank = {"hot": 0, "rising": 1, "steady": 2, "fading": 3}
    topics = []
    for cluster in clusters:
        if cluster["rough"]:
            continue
        prior = (prior_snap.get("topics") or {}).get(cluster["id"]) if prior_snap else None
        trend = direction(current[cluster["id"]], prior)
        if trend == "fading" and len(cluster["posts"]) < 2:
            continue
        sources = [{"title": p["title"], "url": p["url"], "sub": p["sub"], "when": iso(p["created"]),
                    "comments": p["comments"]} for p in sorted(cluster["posts"], key=lambda p: p["created"], reverse=True)
                   if not p["flagged"]]
        label = labels.get(cluster["id"]) or cleaned_title(cluster["rep"]["title"])
        if not sources:
            continue
        known_comments = [p["comments"] for p in cluster["posts"] if p["comments"] is not None]
        topics.append({"id": cluster["id"], "label": trim(label, 64), "direction": trend,
                       "posts": len(sources), "comments": sum(known_comments) if known_comments else None,
                       "last_activity": max(item["when"] for item in sources), "sources": sources})
    topics.sort(key=lambda topic: (rank[topic["direction"]], -topic["posts"], topic["label"].lower()))

    rough_ids = {post["id"] for cluster in clusters if cluster["rough"] for post in cluster["posts"]}
    rough = [{"title": p["title"], "url": p["url"], "sub": p["sub"], "when": iso(p["created"]),
              "comments": p["comments"]} for p in sorted(public_posts, key=lambda p: p["created"], reverse=True)
             if p["id"] in rough_ids][:10]
    highlights = [highlight(slot, picks[slot]) for slot in SLOT_LABELS if slot in picks]
    counts = Counter(post["sub"] for post in posts)
    output = {"updated": iso(now), "window_hours": 72, "mode": mode, "llm": MODEL if llm_result else None,
              "topics": topics[:8], "highlights": highlights, "rough": rough,
              "stats": {"posts_scanned": len(posts), "per_source": {"r/burlington": counts["r/burlington"],
                                                                       "r/vermont": counts["r/vermont"]}}}

    if dry_run:
        print(json.dumps(output, indent=2, ensure_ascii=False))
        return 0

    cutoff = now - timedelta(days=7)
    kept_posts = {key: value for key, value in old_posts.items()
                  if parse_time(value.get("first_seen")) and parse_time(value["first_seen"]) >= cutoff}
    for post in posts:
        if post["flagged"]:
            continue  # this file is committed publicly — no trace of suppressed posts
        previous = old_posts.get(post["id"], {})
        created_utc = post["created"] if post["from_reddit"] else None
        first = min(filter(None, (created_utc, parse_time(previous.get("first_seen")), now)))
        kept_posts[post["id"]] = {"first_seen": iso(first), "sub": post["sub"],
                                  "last_score": post["score"], "last_comments": post["comments"]}
    snapshots.append({"ts": iso(now), "topics": current})
    write_json(OUT, output)
    write_json(SEEN, {"posts": kept_posts, "snapshots": snapshots})

    if not (os.environ.get("GITHUB_ACTIONS") or os.environ.get("CI")):
        leads = []
        rough_known = [p for p in public_posts if p["rough"] and p["comments"] is not None and p["comments"] >= 15]
        rough_unknown = [p for p in public_posts if p["rough"] and p["comments"] is None][:2]
        rumor_ids = {p["id"] for _, p in candidates["rumor"]}
        for post in posts:
            why = None
            if post["flagged"]:
                why = "names a private individual — verify before any use"
            elif post in rough_known or post in rough_unknown:
                why = "engaged rough post — verify before any use"
            elif post["id"] in rumor_ids:
                why = "emerging rumor — unverified"
            elif term_hit(post["title"] + " " + post["body"], NEWS):
                why = "possible news lead — verify independently"
            if why:
                leads.append((post["url"], post, why))
        append_tips(leads)
    print(f"wrote chatter.json: {len(output['topics'])} topics, {len(highlights)} highlights, {len(rough)} rough")
    return 0


# ----------------------------------------------------------------------
# Built-in offline checks
# ----------------------------------------------------------------------

def selftest():
    assert tokens("The best Burlington plumber near town") == ["plumber"]
    now = utcnow()
    def post(post_id, title, body="", hours=1):
        return {"id": post_id, "title": title, "body": body, "created": now - timedelta(hours=hours),
                "comments": None, "score": None, "url": f"https://www.reddit.com/r/burlington/comments/{post_id}/x/",
                "sub": "r/burlington", "from_reddit": False, "from_inoreader": True}
    made = cluster_posts([post("aaa", "Main Street construction update"),
                          post("bbb", "Main Street construction delays"),
                          post("ccc", "Favorite dentist for children?")])
    assert sorted(len(c["posts"]) for c in made) == [1, 2]
    assert direction(4, None) == "hot" and direction(2, None) == "rising"
    assert direction(5, 2) == "rising" and direction(1, 2) == "fading" and direction(2, 2) == "steady"
    assert safety_flag(post("ddd", "Beware John Doe", "He scammed us"))
    assert safety_flag(post("dd2", "Local moron John Doe", ""))
    assert safety_flag(post("dd3", "Landlord Bob Jones is the worst", ""))
    assert safety_flag(post("dd4", "Saw police arrest Mike Smith downtown", ""))
    assert safety_flag(post("dd5", "Has anyone seen Jane Doe?", ""))
    assert not safety_flag(post("eee", "Phil Scott gives warning", "Public event"))
    assert not safety_flag(post("fff", "Scam near Main Street", "Watch out"))
    assert not safety_flag(post("ee2", "Thanks to Sarah Chen for the plant sale", ""))
    assert not safety_flag(post("ff2", "Police presence on Church Street today", ""))
    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, "tips.md")
        item = post("ggg", "A lead")
        assert append_tips([(item["url"], item, "test")], path) == 1
        assert append_tips([(item["url"], item, "test")], path) == 0
        assert open(path, encoding="utf-8").read().count(item["url"]) == 1
    print("refresh_chatter selftest passed")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", metavar="DIR")
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    return selftest() if args.selftest else run(args.fixtures, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
