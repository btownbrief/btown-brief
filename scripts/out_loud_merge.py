#!/usr/bin/env python3
"""Merge reviewed Btown Out Loud stories into out-loud/stories.json.

Takes the draft JSON(s) the research produced and the decisions JSON Stephen
copied out of the review page, keeps only approved stories (with his inline
edits applied), and writes them into out-loud/stories.json. Existing pins with
the same id are replaced; others are left alone. Never writes a pin without a
verified coordinate.

Usage:
  python3 scripts/out_loud_merge.py drafts/pins-*.json --decisions decisions.json
  python3 scripts/out_loud_merge.py drafts/pins-*.json --approve-all   # skip review (don't)
"""
import argparse
import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "out-loud" / "stories.json"

KEEP_FIELDS = [
    "id", "title", "tease", "hood", "stand_at", "lat", "lng", "radius_m", "script",
    "sources", "coord_source", "coord_confidence", "routes", "factchecked",
]


def load_drafts(paths):
    pins = {}
    for p in paths:
        d = json.loads(Path(p).read_text(encoding="utf-8"))
        for pin in d.get("pins", []):
            pins[pin["id"]] = pin
    return pins


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("drafts", nargs="+")
    ap.add_argument("--decisions", help="JSON pasted from the review page")
    ap.add_argument("--approve-all", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    drafts = load_drafts(a.drafts)
    decisions = {}
    if a.decisions:
        decisions = {d["id"]: d for d in json.loads(Path(a.decisions).read_text(encoding="utf-8"))["decisions"]}
    elif not a.approve_all:
        sys.exit("need --decisions or --approve-all")

    data = json.loads(DATA.read_text(encoding="utf-8"))
    existing = {p["id"]: p for p in data.get("pins", [])}
    today = dt.date.today().isoformat()
    added, skipped, noted = [], [], []
    for pid, pin in drafts.items():
        dec = decisions.get(pid)
        if decisions and (not dec or not dec.get("keep")):
            skipped.append(pid)
            continue
        if dec and (dec.get("note") or "").strip():
            # A note means "fix something first" — never merge it silently as approved.
            noted.append(f"{pid}: {dec['note'].strip()}")
            skipped.append(f"{pid} (has a note — fix by hand, clear the note, re-run)")
            continue
        out = {k: pin.get(k) for k in KEEP_FIELDS if k in pin}
        if dec:
            for k in ("title", "tease", "stand_at", "script"):
                if (dec.get(k) or "").strip():
                    out[k] = dec[k].strip()
            coords_edited = False
            for k in ("lat", "lng"):
                if isinstance(dec.get(k), (int, float)) and dec[k] == dec[k]:
                    if round(float(dec[k]), 5) != round(float(out.get(k) or 0), 5):
                        coords_edited = True
                    out[k] = round(float(dec[k]), 5)
            if coords_edited:
                out["coord_source"] = f"{out.get('coord_source', '')} (edited in review {today})".strip()
                out["coord_confidence"] = "high"
            if isinstance(dec.get("radius_m"), int):
                out["radius_m"] = dec["radius_m"]
        if not (isinstance(out.get("lat"), (int, float)) and isinstance(out.get("lng"), (int, float))):
            skipped.append(f"{pid} (no coordinate)")
            continue
        out["lat"], out["lng"] = round(float(out["lat"]), 5), round(float(out["lng"]), 5)
        out.setdefault("radius_m", 70)
        out["coord_verified"] = f"review-{today}" if dec else f"auto-{today}"
        out["enabled"] = existing.get(pid, {}).get("enabled", True)
        out["presented_by"] = existing.get(pid, {}).get("presented_by")
        out["audio"] = existing.get(pid, {}).get("audio")          # keep audio if already rendered
        out["audio_hash"] = existing.get(pid, {}).get("audio_hash")
        out["duration_s"] = existing.get(pid, {}).get("duration_s")
        out["updated"] = today
        existing[pid] = out
        added.append(pid)

    # Stable order: route order first, then the rest alphabetically.
    order = []
    for r in data.get("routes", []):
        for s in r.get("steps", []):
            if s["pin"] in existing and s["pin"] not in order:
                order.append(s["pin"])
    rest = sorted(k for k in existing if k not in order)
    data["pins"] = [existing[k] for k in order + rest]
    data["updated"] = today
    print(f"approved/merged: {len(added)} — {', '.join(added)}")
    if skipped:
        print(f"skipped: {len(skipped)} — {', '.join(skipped)}")
    if noted:
        print("\nNOTES TO ACT ON (not merged):")
        for n in noted:
            print(f"  - {n}")
    if a.dry_run:
        return
    DATA.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {DATA.relative_to(ROOT)} ({len(data['pins'])} pins)")


if __name__ == "__main__":
    main()
