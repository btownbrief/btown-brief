#!/usr/bin/env python3
"""Build the Vintage tab's "Make a tee" rail from the merch site's own data.

Reads the merch repo (data.js and its prev/ previews; never writes there)
and writes, in this repo:

  all-day/assets/merch/<id>.webp      one square preview per design: the
                                      front print centred on the colour of
                                      the shirt it is shown on, 320px,
                                      under 60 KB
  all-day/data/merch-designs.json     the rail: name, the design's idea,
                                      the preview, and its product page on
                                      merch.btownbrief.com

Which designs: the merch site's `core` list, the designs that are always
in stock, in that order. The product page (#/p/huba/d/<id>) is where the
Printify mockups live, which is the tab's "see it on a model" for now.
No prices: the tab takes no money and links to the shop for that.

    python3 scripts/build_merch_rail.py [--merch ~/btownbrief/merch]
"""

import argparse
import io
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "all-day" / "assets" / "merch"
OUT = ROOT / "all-day" / "data" / "merch-designs.json"
SHOP = "https://merch.btownbrief.com/"
SIDE = 320          # the square preview, in pixels
FILL = 0.74         # how much of the square the print may take
MAX_BYTES = 60_000


def load_merch(merch):
    text = (merch / "data.js").read_text()
    return json.loads(text[text.index("{"):text.rindex("}") + 1])


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def preview(merch, design):
    front = design.get("front") or {}
    src = merch / (front.get("prev") or "")
    if not front.get("prev") or not src.exists():
        return None
    garment = (design.get("variants") or [{}])[0].get("garment") or "#E8DFCC"
    art = Image.open(src).convert("RGBA")
    scale = min(SIDE * FILL / art.width, SIDE * FILL / art.height)
    art = art.resize((max(1, round(art.width * scale)), max(1, round(art.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIDE, SIDE), hex_rgb(garment) + (255,))
    canvas.alpha_composite(art, ((SIDE - art.width) // 2, (SIDE - art.height) // 2))
    out = canvas.convert("RGB")
    for q in (82, 74, 66, 58, 50):
        buf = io.BytesIO()
        out.save(buf, "WEBP", quality=q, method=6)
        if buf.tell() <= MAX_BYTES:
            return buf.getvalue()
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--merch", default=str(Path.home() / "btownbrief" / "merch"))
    merch = Path(ap.parse_args().merch).expanduser()
    data = load_merch(merch)
    by_id = {d["id"]: d for d in data["designs"]}
    ASSETS.mkdir(parents=True, exist_ok=True)
    rail, skipped = [], []
    for i in data.get("core") or []:
        d = by_id.get(i)
        img = preview(merch, d) if d else None
        if not img:
            skipped.append(i)
            continue
        name = f"{d['id']}.webp"
        (ASSETS / name).write_bytes(img)
        rail.append({
            "id": d["id"], "name": d["name"], "idea": d.get("idea") or "",
            "img": "assets/merch/" + name, "href": f"{SHOP}#/p/huba/d/{d['id']}",
        })
    if not rail or skipped:
        raise SystemExit(f"stopped before writing: core designs without a preview: {skipped or 'all'}")
    OUT.write_text(json.dumps({
        "_": "Built by scripts/build_merch_rail.py from the merch repo's data.js (its core list: always in stock). "
             "href is the design's page on merch.btownbrief.com, where the Printify mockups are. No prices on purpose.",
        "shop": SHOP, "total": len(data["designs"]), "designs": rail,
    }, indent=1, ensure_ascii=False) + "\n")
    sizes = [(ASSETS / f"{r['id']}.webp").stat().st_size for r in rail]
    print(f"wrote {len(rail)} designs to {OUT.relative_to(ROOT)}; previews {min(sizes)}-{max(sizes)} bytes"
          + (f"; skipped {skipped}" if skipped else ""))


if __name__ == "__main__":
    main()
