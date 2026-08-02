#!/usr/bin/env python3
"""
Auto-publish the latest weather read draft if it isn't live yet.

Runs from scheduled Actions so the page carries a fresh read by 7 AM, and
updated ones by noon and 5 PM Burlington time. The manual flow
(scripts/approve_read.py) still works and still wins: if the current draft
is already approved, or read.json already carries this draft's date AND
edition, this script does nothing.

Unlike approve_read.py this never edits and never prompts — it publishes the
drafted text verbatim.
"""

import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.join(os.path.dirname(__file__), "..")
DRAFT = os.path.join(ROOT, "data", "weather", "read-draft.json")
READ = os.path.join(ROOT, "data", "weather", "read.json")


def main():
    if not os.path.exists(DRAFT):
        print("No draft file — nothing to publish.")
        return
    with open(DRAFT) as f:
        draft = json.load(f)

    if draft.get("status") == "approved":
        print(f"Draft for {draft.get('date')} already approved — nothing to do.")
        return
    text = (draft.get("text") or "").strip()
    if not text:
        print("Draft has no generated text — leaving for manual review.")
        return

    if os.path.exists(READ):
        with open(READ) as f:
            current = json.load(f)
        if (current.get("date") == draft.get("date")
                and current.get("edition", "morning") == draft.get("edition", "morning")):
            # Same edition already live. One exception: a redraft can repair
            # week blurbs a failed call left out — publish that, but never
            # over a read Stephen edited by hand.
            repairs_week = (draft.get("week") and not current.get("week")
                            and not current.get("edited"))
            if not repairs_week:
                print(f"read.json already carries the {draft.get('edition', 'morning')} "
                      f"edition for {draft['date']} — nothing to do.")
                return
            print("Live read is missing week blurbs this draft has — republishing.")

    read = {
        "date": draft["date"],
        "edition": draft.get("edition", "morning"),
        "text": text,
        "week": draft.get("week"),
        "approved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "edited": False,
        "auto_published": True,
    }
    with open(READ, "w") as f:
        json.dump(read, f, indent=1, ensure_ascii=False)
    draft["status"] = "approved"
    with open(DRAFT, "w") as f:
        json.dump(draft, f, indent=1, ensure_ascii=False)
    print(f"Auto-published read for {read['date']}.")


if __name__ == "__main__":
    sys.exit(main())
