#!/usr/bin/env python3
"""Apply fact-check revisions to Btown Out Loud stories.

Input: one or more revised-*.json files shaped
  {"pins": {"<id>": {"script": "...", "tease": ..., "stand_at": ..., "lat": ..., "lng": ..., "changes": [...]}}}
(the output of the copy-editor pass). Applies the non-null fields to
out-loud/stories.json (and to any out-loud/drafts/pins-*.json that carries the
same id, so a future re-merge doesn't resurrect the old text), bumps `updated`,
and prints a change log. The audio build re-renders only stories whose spoken
text changed (hash), so this is safe to run repeatedly.

Usage: python3 scripts/out_loud_apply_revisions.py scratch/revised-1.json [...] [--dry-run]
"""
import argparse
import datetime as dt
import glob
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "out-loud" / "stories.json"
DRAFTS = sorted(glob.glob(str(ROOT / "out-loud" / "drafts" / "pins-*.json")))
TTS_RISK = [r"\$\d[\d,]*\.\d+", r"\d\s?[–—]\s?\d", r"(?<![\d$])\b\d+\.\d+\b", r"&"]


def apply_to(pin, rev, today):
    changed = []
    for k in ("script", "tease", "stand_at"):
        v = rev.get(k)
        if isinstance(v, str) and v.strip() and v.strip() != (pin.get(k) or "").strip():
            pin[k] = v.strip()
            changed.append(k)
    for k in ("lat", "lng"):
        v = rev.get(k)
        if isinstance(v, (int, float)) and round(float(v), 5) != round(float(pin.get(k) or 0), 5):
            pin[k] = round(float(v), 5)
            changed.append(k)
    if "lat" in changed or "lng" in changed:
        pin["coord_source"] = f"{pin.get('coord_source', '')} (moved by fact-check {today})".strip()
        pin["coord_confidence"] = "high"
        pin["coord_verified"] = f"factcheck-{today}"
    if changed:
        pin["updated"] = today
        pin["factchecked"] = today
    return changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("revisions", nargs="+")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    today = dt.date.today().isoformat()

    revs = {}
    for path in a.revisions:
        d = json.loads(Path(path).read_text(encoding="utf-8"))
        for pid, rev in d["pins"].items():
            revs[pid] = rev

    data = json.loads(DATA.read_text(encoding="utf-8"))
    by_id = {p["id"]: p for p in data["pins"]}
    log = []
    for pid, rev in revs.items():
        if pid not in by_id:
            log.append(f"  ! {pid}: not in stories.json (skipped)")
            continue
        ch = apply_to(by_id[pid], rev, today)
        words = len(by_id[pid]["script"].split())
        risks = [m for rx in TTS_RISK for m in re.findall(rx, by_id[pid]["script"])]
        log.append(f"  {pid}: {', '.join(ch) if ch else 'no change'} · {words}w" + (f" · TTS-RISK {risks}" if risks else ""))
        for c in rev.get("changes", []):
            log.append(f"      - {c}")
        for s in rev.get("skipped", []):
            log.append(f"      ~ skipped: {s}")
    print("\n".join(log))

    if a.dry_run:
        return
    data["updated"] = today
    DATA.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    # keep drafts in sync so a re-merge can't resurrect the old text
    for dp in DRAFTS:
        dd = json.loads(Path(dp).read_text(encoding="utf-8"))
        hit = False
        for p in dd.get("pins", []):
            if p["id"] in revs:
                apply_to(p, revs[p["id"]], today)
                hit = True
        if hit:
            Path(dp).write_text(json.dumps(dd, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {DATA.relative_to(ROOT)} + synced drafts")


if __name__ == "__main__":
    main()
