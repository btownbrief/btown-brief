#!/usr/bin/env python3
"""
Export approved community photos to data/photos/manifest.json — the static
snapshot other consumers use:

  - any page on this site, as an offline/Supabase-down fallback
    (js/photos-lib.js reads it automatically)
  - the newsletter pipeline: photo_of_the_week has a ready-to-embed image
    URL, caption, and credit
  - future pages (sunset tracker, events coverage): filter `photos` by
    category/area instead of re-querying Supabase

Keyless in the same sense as the other scripts: uses only the public
anon key + the read-only RPCs from db/photos.sql. On any failure the
existing manifest is left untouched (same contract as refresh-data.yml).

Run:  python3 scripts/export_photos.py
"""

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SUPABASE_URL = "https://jnouvwxomrcffqwilqkq.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3"
BUCKET = "btb-photos"

OUT = Path(__file__).resolve().parent.parent / "data" / "photos" / "manifest.json"


def rpc(fn, args=None):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rpc/{fn}",
        data=json.dumps(args or {}).encode(),
        headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        body = res.read().decode()
        return json.loads(body) if body else None


def public_url(storage_path):
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{storage_path}"


def normalize(row):
    return {
        "id": row["id"],
        "url": public_url(row["storage_path"]),
        "caption": row.get("caption") or "",
        "category": row.get("category") or "other",
        "area": row.get("area") or "Elsewhere",
        "spot": row.get("spot") or "",
        "taken_on": row.get("taken_on") or "",
        "credit": row.get("credit") or "",
        "label": row.get("display_label"),
        "votes": int(row.get("votes") or 0),
        "approved_on": row.get("approved_on"),
    }


def main():
    photos = [normalize(r) for r in (rpc("btb_photos_get") or [])]
    potw_rows = rpc("btb_photos_potw") or []
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "photo_of_the_week": normalize(potw_rows[0]) if potw_rows else None,
        "photos": photos,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".json.tmp")  # atomic swap: never truncate the last good file
    tmp.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    os.replace(tmp, OUT)
    print(f"Wrote {OUT.relative_to(OUT.parent.parent.parent)}: "
          f"{len(photos)} photos"
          f"{', potw: ' + manifest['photo_of_the_week']['id'] if manifest['photo_of_the_week'] else ', no potw yet'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # keep the last good manifest on any failure
        print(f"export_photos: failed, keeping existing manifest ({e})", file=sys.stderr)
        sys.exit(1)
