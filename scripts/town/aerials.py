"""Vermont's aerial photos, stored with the site so a reader's phone never calls the
state's server. Each file is named by a hash of its view, so a place already fetched
is never fetched again, and files no tile uses any more are removed. A home's point
is rounded before it gets here, so the photo is of the neighborhood. Credit: VCGI,
shown in Settings."""

import hashlib
import math
import os
import time
import urllib.parse

from .common import OUT_DIR, get

EXPORT = ("https://maps.vcgi.vermont.gov/arcgis/rest/services/EGC_services/"
          "IMG_VCGI_CLR_WM_CACHE/ImageServer/exportImage")
DIR = os.path.join(OUT_DIR, "aerials")
RADIUS = 6378137


def url_for(lat, lon, m, w, h):
    x = RADIUS * math.radians(lon)
    y = RADIUS * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    hw, hh = m / 2, m / 2 * h / w
    q = {"bbox": f"{x - hw:.1f},{y - hh:.1f},{x + hw:.1f},{y + hh:.1f}", "bboxSR": 3857, "imageSR": 3857,
         "size": f"{w},{h}", "format": "jpg", "f": "image"}
    return EXPORT + "?" + urllib.parse.urlencode(q)


def fetch(lat, lon, m, w=800, h=600):
    """The file's name inside data/town/aerials, fetching it if needed. None on failure."""
    name = hashlib.sha1(f"{lat},{lon},{m},{w},{h}".encode()).hexdigest()[:14] + ".jpg"
    path = os.path.join(DIR, name)
    if os.path.exists(path):
        return name
    try:
        time.sleep(0.3)
        raw = get(url_for(lat, lon, m, w, h))
        if raw[:2] != b"\xff\xd8":   # the server answers errors as text
            print(f"[aerials] not an image for {lat},{lon}")
            return None
        os.makedirs(DIR, exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(raw)
        os.replace(tmp, path)
        return name
    except Exception as e:  # a tile without a photo keeps its colour
        print(f"[aerials] failed for {lat},{lon}: {e}")
        return None


def prune(keep):
    """Remove every stored photo not in keep."""
    if not os.path.isdir(DIR):
        return 0
    gone = 0
    for f in os.listdir(DIR):
        if f.endswith(".jpg") and f not in keep:
            os.remove(os.path.join(DIR, f))
            gone += 1
    return gone
