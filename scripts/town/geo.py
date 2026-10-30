"""Addresses to map points, through Vermont's E911 geocoder.

The cache never reaches the repo or the site: its keys are short hashes of addresses
a stranger could guess, next to the street in plain text. It is gitignored, and the
Town workflow carries it between runs with actions/cache. Without it a run only makes
more lookups. A private home's point is rounded to about 100 metres before it is kept,
so the exact spot exists nowhere. An address with no match is cached as null and asked
once; a call that fails is not cached, so it is asked again on the next run."""

import hashlib
import os
import re
import time
import urllib.parse

from .common import OUT_DIR, get_json, load_json, write_json

GEOCODER = ("https://maps.vcgi.vermont.gov/arcgis/rest/services/EGC_services/"
            "GCS_E911_COMPOSITE_SP_v2/GeocodeServer/findAddressCandidates")
GEO_PATH = os.path.join(OUT_DIR, "geo-cache.json")

SUFFIX = {"ST": "Street", "AVE": "Avenue", "RD": "Road", "DR": "Drive", "LN": "Lane", "CT": "Court",
          "PL": "Place", "PKWY": "Parkway", "TER": "Terrace", "CIR": "Circle", "WAY": "Way", "BLVD": "Boulevard",
          "HTS": "Heights", "XING": "Crossing", "SQ": "Square", "ALY": "Alley", "RDG": "Ridge", "HL": "Hill"}
PREFIX = {"N": "North", "S": "South", "E": "East", "W": "West"}
STREET_ENDS = set(SUFFIX) | {name.upper() for name in SUFFIX.values()}


def street_of(line):
    """'12 SAMPLE RD 3B' -> 'Sample Road': the street's name through its suffix, and no digit."""
    text = re.sub(r"\s*(\b(apt|unit|ste|suite)\b|#).*$", "", str(line).upper(), flags=re.I)
    all_words = [w.strip(".,") for w in text.split()]
    has_digit = [bool(re.search(r"\d", w)) for w in all_words]
    ends = [i for i, w in enumerate(all_words) if i and w in STREET_ENDS and not has_digit[i - 1]]
    last = ends[-1] if ends else len(all_words) - 1
    start = max((i + 1 for i in range(last + 1) if has_digit[i]), default=0)
    words = all_words[start:last + 1] or [w for w, d in zip(all_words, has_digit) if not d]
    out = []
    for i, w in enumerate(words):
        if i == len(words) - 1 and w in SUFFIX:
            out.append(SUFFIX[w])
        elif i == 0 and w in PREFIX and len(words) > 1:
            out.append(PREFIX[w])
        else:
            out.append(w.capitalize())
    return " ".join(out)


def _key(query, home):
    return hashlib.sha1(f"{query.strip().lower()}|{'h' if home else 'b'}".encode()).hexdigest()[:16]


class Geo:
    def __init__(self):
        self.cache = load_json(GEO_PATH, {}) or {}
        self.asked = 0

    def find(self, query, home=False):
        """[lat, lon, street], or None. home=True rounds the point."""
        key = _key(query, home)
        if key in self.cache:
            return self.cache[key]
        hit = None
        try:
            url = GEOCODER + "?" + urllib.parse.urlencode(
                {"SingleLine": f"{query}, Burlington, VT", "outSR": 4326, "maxLocations": 1, "f": "json"})
            time.sleep(0.25)
            self.asked += 1
            c = (get_json(url).get("candidates") or [None])[0]
            if c and c.get("score", 0) >= 88 and "BURLINGTON" in c.get("address", "") and "SOUTH BURLINGTON" not in c.get("address", ""):
                digits = 3 if home else 6
                hit = [round(c["location"]["y"], digits), round(c["location"]["x"], digits), street_of(c["address"].split(",")[0])]
        except Exception as e:  # one bad lookup must not cost the run
            print(f"[geo] lookup failed: {type(e).__name__}")  # the exception's text holds the address
            return None
        self.cache[key] = hit
        return hit

    def forget(self, query):
        """A place taken down on request leaves the cache too."""
        for home in (True, False):
            self.cache.pop(_key(query, home), None)

    def save(self):
        write_json(GEO_PATH, self.cache)
