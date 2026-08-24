#!/usr/bin/env python3
"""Seed data/best-of-reddit.json from the frozen research dataset.

Source: data/bestof-raw.json — a checked-in, untouched copy of
~/Desktop/newsletter/reference/research/02-bestof-data.json (the merged
2023 + 2025 "Best of r/burlington" lists, 310 raw entries). This script is a
one-time/rerunnable transform, not part of the automated refresh pipeline —
the Tier-1 directory content doesn't change on a schedule, only when Steve
re-runs the research/merge step by hand (e.g. a future 2027 edition).

Beyond regrouping by category, the transform:
- merges raw entries that are the same question (the source lists number
  repeat questions — "Best Burger 1"…"Best Burger 6" — and list some
  questions several times; here they become ONE card with several thread
  links);
- relabels each thread link from its Reddit URL slug (mirrors the actual
  thread title) instead of the lists' numbered labels;
- drops the raw file's maintainer-facing notes — they were written for
  Steve, not for readers;
- applies Seven Days comparisons from data/sevendays.json (Seven Daysies
  readers' choice winners) wherever a question has a matching award, so
  the page can show the Reddit crowd next to the Seven Days ballot;
- merges data/bestof-2026.json (fresh "best X" threads mined from the
  site's Inoreader r/burlington wire after the 2025 list) — an addition
  whose question matches an existing card becomes an extra thread link on
  that card, otherwise it becomes its own card. bestof-raw.json itself
  stays a frozen, untouched copy of the 2023+2025 research merge.

Run: python3 scripts/seed_bestof.py
"""

import json
import os
import re

ROOT = os.path.join(os.path.dirname(__file__), "..")
RAW = os.path.join(ROOT, "data", "bestof-raw.json")
ADDITIONS = os.path.join(ROOT, "data", "bestof-2026.json")
SEVENDAYS = os.path.join(ROOT, "data", "sevendays.json")
OUT = os.path.join(ROOT, "data", "best-of-reddit.json")

RASPUTINS_NOTE = (
    "Suggested in a comment on the 2025 list thread rather than in its own "
    "question thread — one to watch, not a settled crowd answer."
)


def slugify(value):
    value = re.sub(r"[’'\"]", "", value.lower())
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value[:60] or "entry"


def base_question(question):
    """Strip the source lists' repeat-question numbering ("Best Burger 4")."""
    return re.sub(r"\s+\d+$", "", question).strip()


def label_from_url(thread_url):
    """Humanize the Reddit slug — it mirrors the actual thread title."""
    m = re.search(r"/comments/[a-z0-9]+/([^/]+)", thread_url)
    if not m:
        return None
    slug = m.group(1)
    words = slug.replace("_", " ").strip()
    if not words:
        return None
    # Reddit truncates slugs around 50 chars, often mid-sentence.
    if len(slug) >= 48:
        words += "…"
    return words[:1].upper() + words[1:]


def merge_status(statuses):
    if any(s == "active" for s in statuses):
        return "active"
    if any(s == "2023-only" for s in statuses):
        return "2023-only"
    return statuses[0]


def load_sevendays():
    if not os.path.exists(SEVENDAYS):
        return [], []
    with open(SEVENDAYS, encoding="utf-8") as fh:
        data = json.load(fh)
    return data.get("matches", []), data.get("categories", [])


def main():
    with open(RAW, encoding="utf-8") as src:
        raw = json.load(src)

    additions_meta = {}
    additions = []
    if os.path.exists(ADDITIONS):
        with open(ADDITIONS, encoding="utf-8") as src:
            added = json.load(src)
        additions_meta = added.get("meta", {})
        additions = added.get("entries", [])
        raw["entries"].extend(additions)

    meta = raw["meta"]
    taxonomy = meta["taxonomy"]
    sd_matches, sd_categories = load_sevendays()

    # ---- merge raw entries that are the same question ----
    merged = {}  # (category, base question lower) -> merged entry
    order = []
    for entry in raw["entries"]:
        question = base_question(entry["question"])
        if entry["status"] == "comment-suggestion":
            # "Best Barbershop (comment suggestion: Rasputins)" — keep it a
            # distinct card with a reader-facing note, under its real question.
            question = re.sub(r"\s*\(comment suggestion:.*\)$", "", question).strip()
        key = (entry["category"], question.lower())
        if key not in merged:
            merged[key] = {
                "question": question,
                "category": entry["category"],
                "statuses": [],
                "sources": [],  # (year, url) de-duped, order preserved
            }
            order.append(key)
        m = merged[key]
        m["statuses"].append(entry["status"])
        for s in entry["sources"]:
            pair = (s["year"], s["thread_url"])
            if pair not in [(x["year"], x["thread_url"]) for x in m["sources"]]:
                m["sources"].append({
                    "year": s["year"],
                    "thread_url": s["thread_url"],
                    "label": s["label"],
                })

    # ---- build categories in taxonomy order ----
    by_category = {cat: [] for cat in taxonomy}
    for key in order:
        e = merged[key]
        by_category.setdefault(e["category"], []).append(e)

    def sd_for(category, question):
        for m in sd_matches:
            if m["category"] == category and m["question"].lower() == question.lower():
                return m
        return None

    def sd_for_category(category):
        for c in sd_categories:
            if c["category"] == category:
                return c
        return None

    seen_ids = set()
    categories = []
    source_link_count = 0
    for cat_title in taxonomy:
        entries_raw = by_category.get(cat_title, [])
        if not entries_raw:
            continue
        # Alphabetical within a category, "active"/"comment-suggestion"
        # entries before "2023-only" so the page can default-show the
        # confirmed set and tuck the stale ones into an expander.
        status_rank = {"active": 0, "comment-suggestion": 0, "2023-only": 1}
        entries_raw = sorted(
            entries_raw,
            key=lambda e: (
                status_rank.get(merge_status(e["statuses"]), 2),
                e["question"].lower(),
            ),
        )
        cat_id = slugify(cat_title)
        entries = []
        for entry in entries_raw:
            status = merge_status(entry["statuses"])
            base_id = cat_id + "--" + slugify(entry["question"])
            entry_id = base_id
            suffix = 2
            while entry_id in seen_ids:
                entry_id = f"{base_id}-{suffix}"
                suffix += 1
            seen_ids.add(entry_id)

            sources = []
            labels_used = {}
            for s in sorted(entry["sources"], key=lambda x: (-x["year"], x["thread_url"])):
                if s["label"].startswith("Comment by"):
                    label = s["label"]  # the one comment-mined source
                else:
                    label = label_from_url(s["thread_url"]) or s["label"]
                # Different threads sometimes share an identical slug
                # ("best burgers in town", twice) — tell them apart. Same-URL
                # repeats (a thread both editions linked) keep one label; the
                # page collapses those into a single link.
                if label in labels_used and labels_used[label] != s["thread_url"]:
                    label = f"{label} (asked again)"
                else:
                    labels_used[label] = s["thread_url"]
                sources.append({
                    "year": s["year"],
                    "thread_url": s["thread_url"],
                    "label": label,
                })
            source_link_count += len(sources)

            sd = sd_for(cat_title, entry["question"])
            entries.append({
                "id": entry_id,
                "question": entry["question"],
                "status": status,
                "notes": RASPUTINS_NOTE if status == "comment-suggestion" else None,
                "sevendays_url": sd["url"] if sd else None,
                "sevendays_note": (
                    f"Seven Daysies {sd['year']}: {sd['winner']}" if sd else None
                ),
                "sources": sources,
            })

        sd_cat = sd_for_category(cat_title)
        categories.append({
            "id": cat_id,
            "title": cat_title,
            "sevendays_url": sd_cat["url"] if sd_cat else None,
            "sevendays_note": sd_cat.get("note") if sd_cat else None,
            "counts": {
                "active": sum(1 for e in entries if e["status"] in ("active", "comment-suggestion")),
                "2023_only": sum(1 for e in entries if e["status"] == "2023-only"),
                "total": len(entries),
            },
            "entries": entries,
        })

    all_entries = [e for c in categories for e in c["entries"]]
    counts = {
        "questions": len(all_entries),
        "active": sum(1 for e in all_entries if e["status"] in ("active", "comment-suggestion")),
        "2023_only": sum(1 for e in all_entries if e["status"] == "2023-only"),
        "comment_suggestions": sum(1 for e in all_entries if e["status"] == "comment-suggestion"),
        "thread_links": source_link_count,
        "with_sevendays": sum(1 for e in all_entries if e["sevendays_url"]),
        "added_2026_entries": len(additions),
        "added_2026_threads": sum(len(e["sources"]) for e in additions),
        "raw_entries": len(raw["entries"]) - len(additions),
        # Raw-list accounting: 317 list links across both editions, plus one
        # comment-mined source riding on the 2025 list thread = 318 sources.
        "raw_list_links": meta["counts"]["raw_links_total"],
    }

    output = {
        "generated": meta["generated"],
        "updated": additions_meta.get("updated", meta["generated"]),
        "note": (
            "Tier 1: a categorized directory of recurring “best X” questions "
            "r/burlington has already asked, merged from the 2023 and 2025 community "
            "list threads (repeat questions collapsed into one card each) plus fresh "
            "asks mined from the sub since the 2025 list. Each card "
            "links to its Reddit thread(s) — the crowd's answer lives in the comments, "
            "one click away — and, where Seven Days readers picked a winner in the "
            "same category, shows the Seven Daysies pick for comparison."
        ),
        "sources": meta["sources"],
        "counts": counts,
        "categories": categories,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as dst:
        json.dump(output, dst, indent=2, ensure_ascii=False)
        dst.write("\n")

    print(
        f"wrote {OUT}: {len(categories)} categories, {counts['questions']} questions, "
        f"{counts['thread_links']} thread links ({counts['added_2026_threads']} from 2026 asks), "
        f"{counts['with_sevendays']} Seven Days comparisons"
    )


if __name__ == "__main__":
    main()
