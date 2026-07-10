#!/usr/bin/env python3
"""
Review and approve the morning weather read.

The dashboard only ever displays data/weather/read.json — nothing shows
publicly until this script promotes the draft. Flow:

    python3 scripts/approve_read.py            # show draft, approve/edit/skip
    python3 scripts/approve_read.py --edit     # open the text in $EDITOR first
    python3 scripts/approve_read.py --push     # also commit + push data/weather/read.json

Approving stamps approved_at; the site shows that timestamp.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

ROOT = os.path.join(os.path.dirname(__file__), "..")
DRAFT = os.path.join(ROOT, "data", "weather", "read-draft.json")
READ = os.path.join(ROOT, "data", "weather", "read.json")


def edit_text(text):
    editor = os.environ.get("EDITOR", "nano")
    with tempfile.NamedTemporaryFile("w+", suffix=".txt", delete=False) as tf:
        tf.write(text)
        path = tf.name
    subprocess.call([editor, path])
    with open(path) as f:
        out = f.read().strip()
    os.unlink(path)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--edit", action="store_true", help="edit in $EDITOR before approving")
    ap.add_argument("--push", action="store_true", help="commit and push read.json after approving")
    args = ap.parse_args()

    if not os.path.exists(DRAFT):
        sys.exit("No draft found (data/weather/read-draft.json). Run scripts/draft_read.py first.")
    with open(DRAFT) as f:
        draft = json.load(f)

    print(f"\n=== Draft read for {draft['date']} "
          f"(drafted {draft['drafted_at']}, model {draft.get('model') or '—'}) ===\n")
    print(draft.get("text") or "(no generated text — packet below)")
    if not draft.get("text"):
        print("\n--- source packet ---\n" + draft.get("packet", ""))

    text = draft.get("text", "")
    if args.edit or not text:
        input("\nPress Enter to open in your editor…")
        text = edit_text(text or draft.get("packet", ""))

    if not text.strip():
        sys.exit("Empty text — nothing approved.")

    if not args.edit:
        ans = input("\nApprove this read? [y/e = edit first/n] ").strip().lower()
        if ans == "e":
            text = edit_text(text)
        elif ans != "y":
            sys.exit("Not approved. Draft left in the queue.")

    read = {
        "date": draft["date"],
        "text": text.strip(),
        "approved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "edited": text.strip() != (draft.get("text") or "").strip(),
    }
    with open(READ, "w") as f:
        json.dump(read, f, indent=1, ensure_ascii=False)
    draft["status"] = "approved"
    with open(DRAFT, "w") as f:
        json.dump(draft, f, indent=1, ensure_ascii=False)
    print(f"\nApproved → data/weather/read.json ({read['approved_at']})")

    if args.push:
        subprocess.check_call(["git", "-C", ROOT, "add", "data/weather/read.json",
                               "data/weather/read-draft.json"])
        subprocess.check_call(["git", "-C", ROOT, "commit", "-m",
                               f"Approve weather read for {read['date']}"])
        subprocess.check_call(["git", "-C", ROOT, "push"])
        print("Pushed.")


if __name__ == "__main__":
    main()
