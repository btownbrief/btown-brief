"""Unit checks for build_feed.py. Run from the repo root:
python3 -m scripts.town.test_build_feed"""

import contextlib
import datetime as dt
import hashlib
import io
import json
import os
import re
import tempfile

import scripts.town.build_feed as build_feed
import scripts.town.geo as geo_module
import scripts.town.redact as redact_module

from .build_feed import (_job_name, _meeting_day, _seen_key, calendar_tiles, city_tiles, food_tiles, guard, league_rows, move_rows, news_tiles,
                         photo_tiles, reddit_tiles, scene_posts, sold_tiles, status, street_place, tonight_tile, write_feed)
from .common import ROOT
from .geo import Geo, street_of
from .redact import is_business, publish_permits, publish_sales
from .signups import bikereg_rows, merge_races, race_rows, ultrasignup_rows
from .title_guard import CONTACT, held


class NoGeo:
    forgotten = []

    def find(self, q, home=False):
        return None

    def forget(self, q):
        self.forgotten.append(q)


def main():
    assert street_of("12 SAMPLE RD") == "Sample Road"
    assert street_of("34 N SAMPLE ST") == "North Sample Street"
    assert street_of("8-34 Pine St") == "Pine Street"

    assert street_of("12 PINE ST APT 3") == "Pine Street"

    # no digit survives, however the number or a bare unit is written
    assert street_of("12 Lake Forest Drive 34") == "Lake Forest Drive"
    assert street_of("12 1/2 Pine St") == "Pine Street"
    assert street_of("10 & 12 Pine St") == "Pine Street"
    assert street_of("12 PINE ST 3B") == "Pine Street"
    assert street_of("10 THRU 12 PINE ST") == "Pine Street"
    assert street_of("12 ST PAUL ST") == "St Paul Street" and street_of("12 ST PAUL") == "St Paul"
    assert not re.search(r"\d", street_of("12 ROUTE 7"))

    # anything not positively a business counts as a home
    assert not is_business({"land_use": "R1 - Single Fam"})
    assert not is_business({"land_use": "CR - Com/Resident", "notable_reasons": ["new_building"]})
    assert not is_business({"land_use": None, "notable_reasons": []})

    # mixed-use and exempt are homes until their text names a business
    for luc in ("CR - Com/Resident", "E - Exempt", "EL - Exmpt Land", "TE - Partl Exempt"):
        assert not is_business({"land_use": luc}), luc
        for reasons in (["commercial_occupancy"], ["restaurant_or_fitout"], ["big_project"]):
            assert not is_business({"land_use": luc, "notable_reasons": reasons, "description": "Zoning Certificate of Occupancy Request"}), (luc, reasons)
        for words in ("new restaurant", "wine bar", "cafe seating", "retail fit-out", "office space", "tenant fit-up", "NECTARS sign"):
            assert is_business({"land_use": luc, "project": words}), (luc, words)
        for words in ("grab bar in shower", "wet bar", "home office", "wood shop", "storage shed"):
            assert not is_business({"land_use": luc, "description": words}), (luc, words)
    # a Bank Street or College Street address is not a use
    assert not is_business({"land_use": "CR - Com/Resident", "project": "12 Bank Street"})
    assert not is_business({"land_use": "CR - Com/Resident", "project": "restaurant", "description": "live-work above"})

    # a blank land use is a home, however its description reads, unless it is on the list
    assert not is_business({"land_use": None, "notable_reasons": ["big_project"]})
    assert not is_business({"land_use": "", "notable_reasons": ["restaurant_or_fitout"], "description": "wine cellar"})
    assert is_business({"land_use": None, "project": "NECTARS/CAPONES REFIT", "notable_reasons": ["restaurant_or_fitout"]})
    # big alone is not a storefront; the description speaks too, and is never published
    assert not is_business({"land_use": "CR - Com/Resident", "notable_reasons": ["big_project"]})
    for words in ("kitchen remodel", "new dwelling", "ADU over garage", "second unit", "townhouse", "townhome",
                  "live-work conversion", "live/work space", "parsonage", "front porch", "rear deck"):
        assert not is_business({"land_use": "C - Commercial", "description": words}), words
    assert is_business({"land_use": "C - Commercial", "description": "commercial kitchen hood"})
    assert is_business({"land_use": "C - Commercial"})
    # a roof and the deck under it are a commercial building's too
    for words in ("remove roof system down to metal roof deck", "walls to deck above", "roof replacement"):
        assert is_business({"land_use": "C - Commercial", "description": words}), words
    assert not is_business({"land_use": "CR - Com/Resident", "project": "apartment 7 Sample Street", "notable_reasons": ["restaurant_or_fitout"]})

    # what's published about a home carries no number, no parties, no parcel id
    pub = publish_permits([{"permit_no": "ZP-1", "address": "7 Sample Street", "land_use": "CR - Com/Resident", "project": "apartment 7 Sample Street", "notable": True,
                            "notable_reasons": ["new_building"], "description": "x", "contractor": "y", "source_url": "https://city/rec/1"},
                           {"permit_no": "ZP-2", "address": "9 Sample Street", "land_use": "R1 - Single Fam", "project": "Jane Example", "notable": False}], NoGeo(), "https://portal")
    assert pub[0]["address"] == "Sample Street" and pub[0]["project"] is None and pub[0]["source_url"] == "https://portal"
    assert "address" not in pub[1] and "project" not in pub[1] and "description" not in pub[0] and "contractor" not in pub[0]
    sale = publish_sales([{"return_id": 1, "address": "12 Sample Road", "price": 412000, "property_class": "02. Single Family Dwelling", "span": "114", "buyer_state": "NY"}], NoGeo())[0]
    assert sale["address"] == "Sample Road" and "span" not in sale and "buyer_state" not in sale and "return_id" not in sale

    # a sale whose class is unclear is a home until it says otherwise
    for cls in ("20. Other", None, "05. Condominium"):
        odd = publish_sales([{"return_id": 2, "address": "12 Sample Point Rd", "price": 500000, "property_class": cls}], NoGeo())[0]
        assert odd["home"] and odd["address"] == "Sample Point Road", odd
    assert not publish_sales([{"return_id": 3, "address": "1 Sample Lane", "price": 500000, "property_class": "09. Office Buildings"}], NoGeo())[0]["home"]
    lived_in = publish_sales([{"return_id": 3, "address": "1 Sample Lane", "price": 500000, "property_class": "09. Office Buildings", "buyer_use": "Principal Residence"}], NoGeo())[0]
    assert lived_in["home"] and lived_in["address"] == "Sample Lane"
    tile = sold_tiles({"sections": {"sales": {"items": [{"id": "x", "address": "Sample Lane", "home": True, "price": 500000, "arms_length": True, "posted": "2026-10-20", "property_class": "10. Retail"}]}}}, dt.date(2026, 9, 1))[0]
    assert tile["m"] == 260

    # a row's id comes from what the row prints, never a record number
    assert sale["id"] == hashlib.sha1(b"Sample Road|None|412000").hexdigest()[:12]
    assert sale["id"] != hashlib.sha1(b"1").hexdigest()[:12]
    again = publish_sales([{"return_id": 99, "address": "14 Sample Rd", "price": 412000, "property_class": "02. Single Family Dwelling"}], NoGeo())[0]
    assert again["id"] == sale["id"]
    shop = publish_sales([{"return_id": 3, "address": "1 Sample Lane", "price": 500000, "closed": "2026-10-15", "property_class": "10. Retail"}], NoGeo())[0]
    assert shop["id"] == hashlib.sha1(b"1 Sample Lane|2026-10-15|500000").hexdigest()[:12]

    def permit(no, address, notable=True):
        return {"permit_no": no, "address": address, "kind": "Building", "applied": "2026-10-20", "notable": notable, "land_use": "R1 - Single Fam"}
    batch = [permit("CBP-26-102", "12 Sample Road"), permit("CBP-26-99", "14 Sample Road"), permit("CBP-26-50", "1 Other Lane")]
    first = [r["id"] for r in publish_permits(batch, NoGeo(), "https://portal")]
    assert first[1] == hashlib.sha1(b"Sample Road|2026-10-20|Building|0").hexdigest()[:12]
    assert len(set(first)) == 3
    assert first == [r["id"] for r in publish_permits(batch, NoGeo(), "https://portal")]
    # a later permit on the street leaves the earlier ones' ids alone
    joined = publish_permits([permit("CBP-26-103", "16 Sample Road")] + batch, NoGeo(), "https://portal")
    assert [r["id"] for r in joined[1:]] == first
    # a row that prints no street hashes no street
    quiet = publish_permits([permit("CBP-26-1", "12 Sample Road", False), permit("CBP-26-2", "1 Other Lane", False)], NoGeo(), "https://portal")
    assert quiet[0]["id"] == hashlib.sha1(b"|2026-10-20|Building|0").hexdigest()[:12]
    assert quiet[1]["id"] == hashlib.sha1(b"|2026-10-20|Building|1").hexdigest()[:12]

    # the street a row prints is the street its id hashes, a corrected spelling included
    class FixedGeo(NoGeo):
        def find(self, q, home=False):
            return [44.5, -73.2, "Corrected Road"]
    real_fetch, redact_module.fetch = redact_module.fetch, lambda *a, **k: "x.jpg"
    fixed = publish_sales([{"address": "12 Corected Road", "price": 412000, "closed": "2026-10-15"}], FixedGeo())[0]
    assert fixed["address"] == "Corrected Road" and fixed["id"] == hashlib.sha1(b"Corrected Road|2026-10-15|412000").hexdigest()[:12]
    fixed = publish_permits([permit("CBP-26-1", "12 Corected Road")], FixedGeo(), "https://portal")[0]
    assert fixed["address"] == "Corrected Road" and fixed["id"] == hashlib.sha1(b"Corrected Road|2026-10-20|Building|0").hexdigest()[:12]
    redact_module.fetch = real_fetch

    # two records alike in everything printed still get one id each
    twins = publish_sales([{"return_id": n, "address": "Sample Road", "price": None, "property_class": "02. Single Family Dwelling"} for n in (8, 9)], NoGeo())
    assert twins[0]["id"] != twins[1]["id"], twins

    # a takedown names one row id per record, and each hidden row leaves the geocoder cache
    keep = redact_module.hidden
    redact_module.hidden = lambda: {sale["id"], first[0]}
    NoGeo.forgotten.clear()
    assert publish_sales([{"return_id": 1, "address": "12 Sample Road", "price": 412000, "property_class": "02. Single Family Dwelling"}], NoGeo()) == []
    assert [r["id"] for r in publish_permits(batch, NoGeo(), "https://portal")] == first[1:]
    assert NoGeo.forgotten == ["12 Sample Road", "12 Sample Road"]
    redact_module.hidden = keep
    assert not hasattr(redact_module, "place_id")
    assert list(json.load(open(os.path.join(ROOT, "data", "town", "hidden.json")))) == ["about", "ids"]
    geo = Geo.__new__(Geo)
    geo.cache = {geo_module._key("12 Sample Rd", True): None, geo_module._key("12 Sample Rd", False): None, "other": None}
    geo.forget("12 Sample Rd")
    assert list(geo.cache) == ["other"]

    # a failed lookup is counted, and its message never carries the address
    def boom(url):
        raise RuntimeError(f"GET {url} failed")
    real_get, real_sleep = geo_module.get_json, geo_module.time.sleep
    geo_module.get_json, geo_module.time.sleep = boom, lambda s: None
    geo = Geo.__new__(Geo)
    geo.cache, geo.asked = {}, 0
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        assert geo.find("12 Sample Road") is None
    geo_module.get_json, geo_module.time.sleep = real_get, real_sleep
    assert out.getvalue() == "[geo] lookup failed: RuntimeError\n" and not geo.cache

    # a home permit never takes the name its owner typed
    home = {"project": "Jane Example garage", "address": "Morse Place", "home": True, "kind": "Building"}
    assert _job_name(home, ["demolition"]) == "Demolition"
    assert _job_name(home, []) == "Home project"
    biz = {"project": "High Key", "address": "191-195 Bank Street", "home": False, "kind": "Zoning permit"}
    assert _job_name(biz, ["restaurant_or_fitout"]) == "High Key"
    blank = {"project": "Project_391737", "address": "32-50 Lakeside Avenue", "home": False, "kind": "Zoning permit"}
    assert _job_name({"project": "John Smith Remodel", "address": "1 Main Street", "home": False}, ["big_project"]) == "Big project"
    assert _job_name(blank, []) == "32-50 Lakeside Avenue"

    today = dt.date(2026, 10, 30)
    assert _meeting_day("Council scheduled for Monday, Nov 2", today) == dt.date(2026, 11, 2)
    assert _meeting_day("x meets Tuesday, Jan 5", today) == dt.date(2027, 1, 5)
    assert _meeting_day("x meets Tuesday, April 6", today) == dt.date(2027, 4, 6)
    assert _meeting_day("x meets Monday, Oct 26", today) == dt.date(2026, 10, 26)
    assert _meeting_day("nothing here", today) is None

    # a home is titled by street; a shop keeps its address
    cutoff = dt.date(2026, 9, 1)
    streets = {"sections": {"sales": {"items": [
        {"id": "a", "address": "Sample Road", "pt": [44.508, -73.255], "home": True, "price": 412000, "arms_length": True, "posted": "2026-10-20", "closed": "2026-10-15",
         "property_class": "02. Single Family Dwelling", "grand_list_value": 300000},
        {"id": "b", "address": "10 Church Street", "home": False, "price": 900000, "arms_length": True, "posted": "2026-10-20", "closed": "2026-10-15",
         "property_class": "10. Retail"},
        {"id": "c", "address": "Skip Lane", "home": True, "price": 500000, "arms_length": False, "posted": "2026-10-20", "property_class": "02. Single Family Dwelling"},
    ]}}}
    tiles = {t["id"]: t for t in sold_tiles(streets, cutoff)}
    assert tiles["sold-a"]["title"] == "House on Sample Road" and tiles["sold-a"]["m"] >= 240 and tiles["sold-a"]["lat"] == 44.508
    assert tiles["sold-b"]["title"] == "10 Church Street"
    assert "sold-c" not in tiles

    # two homes on a street closing the same day are two sales; the same sale twice is one
    same_day = [{"id": i, "address": "North Sample Avenue", "home": True, "price": p, "arms_length": True, "posted": "2026-10-20", "closed": "2026-10-15",
                 "property_class": "02. Single Family Dwelling"} for i, p in (("x", 410000), ("y", 510000), ("z", 510000))]
    assert sorted(t["id"] for t in sold_tiles({"sections": {"sales": {"items": same_day}}}, cutoff)) == ["sold-x", "sold-y"]

    # a jobs or permits tile is news again only past its highest count
    seen = {"jobs-2026-10-28#14": "t1"}
    assert _seen_key({"id": "jobs-2026-10-28", "kind": "jobs", "n": 17}, seen) == "jobs-2026-10-28#17"
    assert _seen_key({"id": "jobs-2026-10-28", "kind": "jobs", "n": 12}, seen) == "jobs-2026-10-28#14"
    assert _seen_key({"id": "week-2026-W44", "kind": "week", "n": 3}, {}) == "week-2026-W44#3"
    assert _seen_key({"id": "sold-a", "kind": "sold"}, seen) == "sold-a"

    # the ban shows only while the city's post stands, and only the closings list counts
    ban = {"sections": {"parking_ban": {"status": "ban_announcement_posted", "items": [{"headline": "Winter parking ban tonight", "source_url": "u"}]},
                        "closings": {"items": [{"name": "A School"}, {"name": "B School"}], "district_posts": [{"headline": "Message to families"}]}}}
    assert status(ban) == {"ban": "Winter parking ban tonight", "ban_url": "u", "schools": 2, "outages": 0}
    assert status(ban, 40)["outages"] == 40
    for word in ("lifted_or_cancelled_posted", "older_announcement_only", "none_posted_72h"):
        ban["sections"]["parking_ban"]["status"] = word
        assert status(ban)["ban"] is None and status(ban)["ban_url"] is None
    assert status({}) == {"ban": None, "ban_url": None, "schools": 0, "outages": 0}

    # only the towns around Burlington count, a handful is no news, and a dead feed reads as zero
    real_get = build_feed.get_json
    build_feed.get_json = lambda url, **kw: [{"code": "burlington", "totalCustomers": "30"}, {"code": "newbury", "totalCustomers": "900"}]
    assert build_feed.outages() == 30
    build_feed.get_json = lambda url, **kw: [{"code": "burlington", "totalCustomers": "24"}]
    assert build_feed.outages() == 0
    def down(url, **kw):
        raise RuntimeError("GET failed")
    build_feed.get_json = down
    with contextlib.redirect_stdout(io.StringIO()):
        assert build_feed.outages() == 0
    build_feed.get_json = real_get

    # feed.json is left alone when only its stamp would change
    with tempfile.TemporaryDirectory() as tmp:
        real_path, build_feed.FEED_PATH = build_feed.FEED_PATH, os.path.join(tmp, "feed.json")
        write_feed({"generated": "one", "tiles": [1], "status": {"ban": None}})
        write_feed({"generated": "two", "tiles": [1], "status": {"ban": None}})
        assert json.load(open(build_feed.FEED_PATH))["generated"] == "one"
        write_feed({"generated": "three", "tiles": [2], "status": {"ban": None}})
        assert json.load(open(build_feed.FEED_PATH))["generated"] == "three"
        # a skipped build still carries the ban: only status moves
        real_load, build_feed.load_json = build_feed.load_json, lambda path, default=None: real_load(path, default) if path == build_feed.FEED_PATH else default
        real_out, build_feed.outages = build_feed.outages, lambda: 60
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            build_feed.build()
        build_feed.load_json, build_feed.outages = real_load, real_out
        kept = json.load(open(build_feed.FEED_PATH))
        assert kept["tiles"] == [2] and kept["status"] == {"ban": None, "ban_url": None, "schools": 0, "outages": 60}
        build_feed.FEED_PATH = real_path

    # one story, however many outlets ran it
    food = food_tiles([{"category": "food", "ts": "2026-10-29T18:41:00+00:00", "headline": "Bluebird Barbecue in Burlington to close", "url": "a"},
                       {"category": "food", "ts": "2026-10-29T20:35:00+00:00", "headline": "Bluebird BBQ in Burlington announces closure", "url": "b"}], cutoff)
    assert len(food) == 1
    # the same first word is not the same story, and a story days later is a new one
    other = food_tiles([{"category": "food", "ts": "2026-10-10T18:00:00+00:00", "headline": "Bluebird Barbecue in Burlington to close", "url": "a"},
                        {"category": "food", "ts": "2026-10-11T18:00:00+00:00", "headline": "Bluebird Coffee adds a second cafe", "url": "b"},
                        {"category": "food", "ts": "2026-10-20T18:00:00+00:00", "headline": "Bluebird Barbecue closes for good", "url": "c"}], cutoff)
    assert [t["url"] for t in other] == ["a", "b", "c"]
    # two places closing the same week are two stories, however alike their headlines read
    two = food_tiles([{"category": "food", "ts": "2026-10-27T18:00:00+00:00", "headline": "Vermont Pub & Brewery to Close After 38 Years", "url": "a"},
                      {"category": "food", "ts": "2026-10-29T18:00:00+00:00", "headline": "Bluebird Barbecue in Burlington to close after 17 years", "url": "b"}], cutoff)
    assert [t["url"] for t in two] == ["a", "b"]
    one = food_tiles([{"category": "food", "ts": "2026-10-29T18:00:00+00:00", "headline": "Bluebird Barbecue in Burlington to close after 17 years", "url": "a"},
                      {"category": "food", "ts": "2026-10-29T20:00:00+00:00", "headline": "Bluebird BBQ in Burlington announces closure", "url": "b"}], cutoff)
    assert [t["url"] for t in one] == ["a"]

    # meetings: the past is dropped, the Council stands alone, the rest share a tile
    ch = [{"category": "cityhall", "ts": "2026-10-29T10:00:00+00:00", "headline": "City Council Meeting agenda posted", "detail": "meets Monday, Nov 9", "url": "https://x/event/1/"},
          {"category": "cityhall", "ts": "2026-10-29T10:00:00+00:00", "headline": "Board of Finance Meeting agenda posted", "detail": "meets Monday, Oct 26", "url": "https://x/event/2/"},
          {"category": "cityhall", "ts": "2026-10-29T10:00:00+00:00", "headline": "Conservation Board scheduled for Monday, Nov 2", "detail": "", "url": "https://x/event/3/"}]
    tiles = city_tiles(ch, today, cutoff)
    assert sorted(t["kind"] for t in tiles) == ["city", "cityweek"]
    week = next(t for t in tiles if t["kind"] == "cityweek")
    assert week["n"] == 1 and week["rows"][0][1] == "Conservation Board"
    # a cancelled meeting leaves the feed; any other starred note becomes a sub line
    note = [{"category": "cityhall", "ts": "2026-10-29T10:00:00+00:00", "headline": "Board of Finance agenda posted", "detail": "meets Monday, Nov 9", "url": "https://x/event/4/"},
            {"category": "cityhall", "ts": "2026-10-29T11:00:00+00:00", "headline": "*Meeting Cancelled* Board of Finance scheduled for Monday, Nov 9", "detail": "", "url": "https://x/event/4/"},
            {"category": "cityhall", "ts": "2026-10-29T10:00:00+00:00", "headline": "*New Location* City Council Meeting agenda posted", "detail": "meets Monday, Nov 9", "url": "https://x/event/5/"},
            {"category": "cityhall", "ts": "2026-10-29T10:00:00+00:00", "headline": "*New Location* Ward Sample NPA Meeting agenda posted", "detail": "meets Monday, Nov 9", "url": "https://x/event/6/"}]
    tiles = {t["kind"]: t for t in city_tiles(note, today, cutoff)}
    assert tiles["city"]["title"] == "City Council" and tiles["city"]["sub"] == "New Location"
    assert tiles["cityweek"]["rows"] == [["2026-11-09", "Ward Sample NPA", "https://x/event/6/", "New Location"]]
    # a Reddit title that names someone or a crime never reaches the feed
    assert held("Officer Smith pulled me over") and held("John Doe stole my bike") and held("Man arrested on Church Street")
    assert not held("Confirming my hatred of the pine/maple st. light") and not held("Skinny Pancake is great")
    for t in ("party at 12 lake forest drive", "12 North Winooski Ave again", "Cops at 40 Sample Way", "Noise on 7B old mill ct", "12 1/2 Pine St",
              "Thanks to J. Sample for the ride", "Spotted J. SAMPLE downtown"):
        assert held(t), t
    for t in ("A 30 year old tradition", "4 way stop at the top", "Mayor visits U.S. Senate", "St. Albans trip", "Mt. Mansfield snow"):
        assert not held(t), t
    for t in ("Call 8025550100", "Call 802 555 0100", "Call (802) 555-0100", "802.555.0100 for rides", "write to someone@example.com",
              "Oak Lane sample.name+vt@mail.example.org", "12 Sample Park", "Noise at 40 sample trail", "9 Mill Trl", "3 North Bch",
              "7 Sample Grn", "party at 12 Old Mill Grv", "Cops at 40 Sample Park", "at 12 Maple St"):
        assert held(t), t
    for t in ("5 mile trail", "10 acre park", "2 dogs at Oakledge Park", "Three killed, 5 in park", "3 hours on the Long Trail",
              "at 12 Maple", "Doors at 7 tonight", "Open at 5 pm", "Back at 8 Thursday", "The 2026 budget of 123456789 dollars", "2026-10-30 meeting",
              "Email the mayor", "$1,000,000,000 grant", "follow @sample.news"):
        assert not held(t), t
    assert held("Fine title", "Misleading - See Comments") and not held("Fine title", "News")
    # the guard and the Reddit tab's copy of it hold the same addresses
    js = open(os.path.join(ROOT, "all-day", "js", "reddit-lib.js"), encoding="utf-8").read()
    assert CONTACT.pattern in js

    # a Reddit tile needs the intake's word: safe for work, unflagged, not removed
    def thread(i, title="Fort Club", detail="▲42 · 6 comments"):
        return {"category": "chatter", "ts": "2026-10-29T10:00:00+00:00", "headline": f"Taking off on r/burlington: {title} {i}", "detail": detail,
                "url": f"https://www.reddit.com/r/burlington/comments/{i}/x/"}
    def post(i, **kw):
        return {"id": i, "nsfw": False, "score": 42, "flair": None, **kw}
    intake = {"removed": {"gone": "2026-10-29T11:00:00+00:00"},
              "posts": [post("ok"), post("nsfw", nsfw=True), post("unsure", nsfw=None), post("flag", flair="Removed by mods"), post("gone"), post("sunk", score=-2)]}
    changes = [thread(i) for i in ("ok", "nsfw", "unsure", "flag", "gone", "sunk", "missing")]
    changes.append({"category": "chatter", "ts": "2026-10-29T10:00:00+00:00", "headline": "New on r/burlington: Hockey Goalies?", "detail": "", "url": "https://www.reddit.com/r/burlington/comments/ok/y/"})
    reddit = reddit_tiles(changes, cutoff, intake)
    assert [t["title"] for t in reddit] == ["Fort Club ok"] and reddit[0]["score"] == 42 and reddit[0]["comments"] == 6
    assert reddit_tiles(changes, cutoff, None) == []
    feeds_new()
    print("build_feed: all checks passed")


def feeds_new():
    now = dt.datetime(2026, 10, 30, 18, 0, tzinfo=dt.timezone.utc)  # 2 pm in Burlington
    today = dt.date(2026, 10, 30)

    # Local news: a local place, no crime story however it is worded, one tile a story
    def story(headline, ts="2026-10-29T12:00:00+00:00", **kw):
        return {"category": "news", "ts": ts, "headline": headline, "sourceName": "Seven Days", "url": "https://example.com/" + str(hash(headline)), **kw}
    news = news_tiles([
        story("Burlington library adds Sunday hours"),
        story("Burlington Library Adds Sunday Hours", ts="2026-10-29T15:00:00+00:00"),
        story("Sunday hours added to national parks"),
        story("Zephyr Tolliver pleads not guilty in Burlington case"),
        story("Burlington police seek driver after crash"),
        story("Sam Smith of Burlington wins a prize"),
        story("Opinion: Burlington should add Sunday hours again"),
        story("Mayor names new Burlington police chief"),
        story("Old Burlington story", ts="2026-10-01T12:00:00+00:00"),
    ], today)
    assert [t["title"] for t in news] == ["Burlington library adds Sunday hours", "Mayor names new Burlington police chief"], news
    assert news[0]["src"] == "Seven Days"
    # a name held() has never heard of: the crime words alone stop these
    crimes = ["Burlington man Xavier Dupuis shot outside bar", "Essex man Xavier Dupuis detained after standoff", "Winooski teen Xavier Dupuis kidnapped",
              "Arson suspected in Burlington fire set by Xavier Dupuis", "Xavier Dupuis, of Burlington, held without bail", "Burlington DUI: Xavier Dupuis",
              "UVM student Xavier Dupuis attacked on campus", "Xavier Dupuis trafficked heroin in Burlington, feds say", "Hit-and-run in Essex leaves Xavier Dupuis hurt",
              "Shots fired in Winooski, Xavier Dupuis sought", "Xavier Dupuis of Colchester gets parole", "Burlington vandalism: Xavier Dupuis cited",
              "Threats made at Essex school by Xavier Dupuis", "Xavier Dupuis of Shelburne in custody", "Burlington bookkeeper Xavier Dupuis ran a scam"]
    assert news_tiles([story(c) for c in crimes], today) == [], news_tiles([story(c) for c in crimes], today)
    assert len(news_tiles([story("Burlington stable reopens after a muggy summer"), story("Traffic changes coming to Winooski roundabout"),
                           story("Shelburne methods class fills up")], today)) == 3, "a crime word's near neighbors stay"

    # Pictures: fresh, by kind, capped by account, and never a post that names someone
    stamp = int(now.timestamp())
    def post(h, age=0.5, **kw):
        return {"h": h, "ts": stamp - int(age * 86400), "i": "https://example.com/i.jpg", "u": f"https://www.instagram.com/p/{h}{int(age * 10)}/",
                "c": "Sunset over the lake", "category": "scenic", "kind": "scenic", **kw}
    shots = photo_tiles({"posts": [post("sun"), post("sun", 0.6), post("sun", 0.7), post("old", 3.5), post("flyer", kind="poster"), post("shop", category="shop"),
                                   post("named", c="Meet Sarah Johnson at the pier"), post("win", c="GIVEAWAY time"), post("dog", category="pets", kind="pets")]}, now)
    assert [t["title"] for t in shots] == ["@sun", "@dog", "@sun"], shots
    assert shots[0]["id"] == "photo-sun5" and "c" not in shots[0] and set(shots[0]) == {"id", "kind", "ts", "title", "pic", "url"}
    assert [p["h"] for p in scene_posts({"posts": [post("dadguild"), post("sun"), post("skirackvt", c="Jane Doe arrested")]}, now)] == ["dadguild"]
    # a paid post is out of Pictures and Scene however the mark is written
    for paid in ("[A D] @helloburlington", "[ad] fall trip", "Great spot #ad", "x [AD] y", "Sponsored by the lake"):
        assert not photo_tiles({"posts": [post("sun", c=paid)]}, now) and not scene_posts({"posts": [post("dadguild", c=paid)]}, now), paid
    assert photo_tiles({"posts": [post("sun", c="Road trip #adirondacks")]}, now), "a hashtag that starts with ad stays"
    # a takedown reaches Body's Scene as well as Town's tiles
    scene = [post("dadguild"), post("skirackvt")]
    assert [p["h"] for p in scene_posts({"posts": scene}, now, {"dadguild5"})] == ["skirackvt"]

    # Tonight: staff picks first, then the crowd; nothing recurring, in a series, unconfirmed or past
    def event(title, start, **kw):
        return {"id": title, "title": title, "start": start, "allDay": False, "status": "active", "recurring": None, "tags": [], "signals": {},
                "venue": "The Hall", "url": "https://example.com", **kw}
    tonight = [event("Early", "2026-10-30T12:00:00-04:00"), event("Crowd", "2026-10-30T19:00:00-04:00", signals={"meetup_going": 9}),
               event("Pick", "2026-10-30T21:00:00-04:00", signals={"staff_pick": True}), event("Plain", "2026-10-30T18:00:00-04:00"),
               event("Weekly", "2026-10-30T18:00:00-04:00", recurring="Fridays"), event("Series", "2026-10-30T18:00:00-04:00", tags=["series"]),
               event("Maybe", "2026-10-30T18:00:00-04:00", status="unconfirmed"), event("Sam Smith arrested", "2026-10-30T18:00:00-04:00"),
               event("At home", "2026-10-30T18:00:00-04:00", venue="12 Sample Road"), event("Campus", "2026-10-30T18:00:00-04:00", venue="IDX Student Life Center"),
               event("Hidden", "2026-10-30T18:00:00-04:00"), event("Next day", "2026-10-31T10:00:00-04:00")]
    tile = tonight_tile(tonight, today, now, {"Hidden"})
    assert [r[1] for r in tile["rows"]] == ["Pick", "Crowd", "Plain", "Next day"], tile
    assert tonight_tile([], today, now) is None
    bare = tonight_tile([event("Quiet", "2026-10-30T19:00:00-04:00", venue="Ethan Allen Homestead")], today, now)
    assert bare["rows"][0][2] is None, "a venue that trips the guard prints no venue"

    # New on the calendar: one tile a day, counted by when each landed
    fresh = [event(f"New {i}", "2026-11-02T19:00:00-04:00", firstSeen="2026-10-30T09:00:00-04:00") for i in range(6)]
    cal = calendar_tiles(fresh + [event("Yesterday's", "2026-11-02T19:00:00-04:00", firstSeen="2026-10-29T09:00:00-04:00"),
                                  event("Long ago", "2026-11-02T19:00:00-04:00", firstSeen="2026-10-20T09:00:00-04:00")], today, now)
    assert sorted((t["id"], t["n"], len(t["rows"])) for t in cal) == [("calendar-2026-10-29", 1, 1), ("calendar-2026-10-30", 6, 4)], cal

    # Guess the street: checked places at their checked points, decoys from one neighborhood, never the same photo, never a repeat in a lap
    def place(i, hood="South End", **kw):
        return {"id": f"p{i}", "name": f"Place {i}", "group": "Outdoors", "neighborhood": hood, "coords": [0, 0], **kw}
    real_places = build_feed.STREET_PLACES
    build_feed.STREET_PLACES = {**{f"p{i}": (44.4 + i / 100, -73.2) for i in (0, 1, 2, 3, 4, 10, 12, 13, 14)}, "p15": (44.4, -73.2)}
    things = [place(i) for i in range(5)] + [place(9), place(10, closed=True), place(12, "Essex"), place(13, "Essex"), place(15)]
    laps = [street_place(things, today + dt.timedelta(days=d)) for d in range(6)]
    assert sorted(l[0]["id"] for l in laps[:6]) == ["p0", "p1", "p15", "p2", "p3", "p4"], [l[0]["id"] for l in laps]
    for chosen, others in laps:
        assert chosen not in others and len(others) == 2 and all(o["neighborhood"] == "South End" for o in others)
        assert chosen["coords"] == build_feed.STREET_PLACES[chosen["id"]], "the checked point, never the pin in things.json"
        assert {chosen["id"], others[0]["id"]} != {"p0", "p15"} and {chosen["id"], others[1]["id"]} != {"p0", "p15"}
    assert street_place([place(1), place(2)], today) is None
    build_feed.STREET_PLACES = real_places
    # the real list: every id in things.json, open, no festival, and every place takes its turn
    real = json.load(open(build_feed.THINGS_PATH, encoding="utf-8"))
    listed = [p for p in real if p["id"] in real_places]
    festivals = {"discover-jazz-festival", "vermont-brewers-festival", "grand-point-north", "south-end-art-hop", "south-end-get-down", "leddy-beach-bites", "champlain-valley-fair", "burlington-farmers-market"}
    assert len(listed) == len(real_places) and not any(p.get("closed") for p in listed) and not festivals & set(real_places), sorted(set(real_places) - {p["id"] for p in listed})
    assert {street_place(real, today + dt.timedelta(days=d))[0]["id"] for d in range(len(real_places))} == set(real_places), "a place with no two decoys never comes up"

    # Moving: something to go and do, not a game to watch or a student's class
    real_fetch, build_feed.fetch = build_feed.fetch, lambda lat, lon, m: "aerial.jpg"
    moves = move_rows([event("Open Gym Basketball", "2026-10-30T19:00:00-04:00", category="sports", recurring="Weekly", tags=["series"], lat=44.5, lng=-73.2),
                       event("Men's Hockey vs Maine", "2026-10-30T19:00:00-04:00", category="sports"),
                       event("Soccer Intramurals", "2026-10-30T19:00:00-04:00", category="wellness"),
                       event("Morning Yoga", "2026-10-30T19:00:00-04:00", category="wellness", venue="IDX Student Life Center"),
                       event("Kids Yoga", "2026-10-30T19:00:00-04:00", category="wellness", tags=["kids"]),
                       event("Book Club Walk", "2026-10-30T19:00:00-04:00", category="words"),
                       event("Trail Run", "2026-11-20T19:00:00-04:00", category="outdoors"),
                       event("Latin Dance Night", "2026-10-31T19:00:00-04:00", category="other"),
                       event("Pick-up Basketball", "2026-10-31T19:00:00-04:00", category="theater", source="meetup"),
                       event("Wednesday Walks", "2026-10-31T19:00:00-04:00", category="other", source="uvm"),
                       event("Spooky Youth Fun Run", "2026-10-31T19:00:00-04:00", category="community"),
                       event("Ski & Ride Sale", "2026-10-31T19:00:00-04:00", category="sports"),
                       event("Bike Basics", "2026-10-31T19:00:00-04:00", category="learning"),
                       event("Yoga at Home", "2026-10-31T19:00:00-04:00", category="wellness", venue="12 Maple Street", lat=44.5, lng=-73.2)], today, now)
    build_feed.fetch = real_fetch
    assert [m["title"] for m in moves] == ["Open Gym Basketball", "Latin Dance Night", "Pick-up Basketball", "Yoga at Home"] and moves[0]["img"] == "aerial.jpg", moves
    assert moves[3]["where"] is None and "img" not in moves[3], "a street number stays out, and so does its picture"

    # league nights: open for signups, inside a dated season, on this week's weekday
    leagues = {"organizers": [{"name": "Game On", "sports": [
        {"sport": "Broomball", "day": "Saturdays 7:30, 8:15 or 9pm", "season": "Oct 2 to Dec 4, then Jan 8 to Apr 2", "signup_open": True, "where": "Leddy Park, Burlington", "url": "u"},
        {"sport": "Broomball", "day": "Saturdays 7:30pm", "season": "Oct 2 to Dec 4", "signup_open": True, "url": "u2"},
        {"sport": "Hockey", "day": "Sundays or Thursdays 3 to 8pm", "season": "Nov 1 to Dec 20, no games Nov 1", "signup_open": True, "url": "u"},
        {"sport": "Closed", "day": "Sundays 6pm", "season": "Oct 2 to Dec 4", "signup_open": False, "url": "u"},
        {"sport": "Over", "day": "Sundays 6pm", "season": "Oct 2 to Dec 4", "signup_open": True, "signup_until": "2026-10-01", "url": "u"},
        {"sport": "Undated", "day": "Sundays 6pm", "season": "Fall 2026 session", "signup_open": True, "url": "u"},
        {"sport": "Winter", "day": "Sundays 6pm", "season": "Jan 8 to Apr 2", "signup_open": True, "url": "u"},
        {"sport": "Clockless", "day": "Sundays", "season": "Oct 2 to Dec 4", "signup_open": True, "url": "u"}]}]}
    nights = league_rows(leagues, today, now)
    assert [(n["at"], n["title"], n["where"]) for n in nights] == [("2026-10-31T19:30:00-04:00", "Game On Broomball", "Leddy Park"),
                                                                  ("2026-11-05T15:00:00-05:00", "Game On Hockey", None)], nights

    # the last look: a takedown's id, and held() on every title the other guards don't read
    tiles = [{"id": "news-a", "kind": "news", "title": "Fine"}, {"id": "news-b", "kind": "news", "title": "Fine too"},
             {"id": "food-c", "kind": "food", "title": "Sam Smith opens a bar"}, {"id": "sold-d", "kind": "sold", "title": "12 Pine Street"}]
    assert [t["id"] for t in guard(tiles, {"b"})] == ["news-a", "sold-d"]

    # races: near Burlington, upcoming, public, and no street address
    def race(name, town, day="11/26/2026", **kw):
        return {"race": {"race_id": 1, "name": name, "next_date": day, "is_private_race": "F", "is_draft_race": "F", "url": "https://example.com",
                         "address": {"street": "20 Gable Place", "city": town, "state": kw.pop("state", "VT")}, **kw}}
    rows = race_rows({"races": [race("GMAA Trot", "Burlington"), race("Far Trot", "Boston", state="MA"), race("Albany Trot", "Albany", state="NY"), race("Paint and Sip", "Stowe"), race("Brattleboro Trot", "Brattleboro", day="11/27/2026"), race("Done", "Burlington", day="10/01/2026"),
                                race("Late Trot", "Burlington", day="03/01/2027"),
                                race("Sam Smith Arrested 5K", "Essex"), race("Secret", "Essex", is_private_race="T"), race("Youth Fun Run", "Essex"),
                                race("Spelled", "St.Albans", day="11/01/2026"), race("Lake Run", "Lake Placid", day="11/02/2026", state="NY")]}, today)
    assert [r["name"] for r in rows] == ["Spelled", "Lake Run", "GMAA Trot", "Brattleboro Trot"] and rows[2]["day"] == "2026-11-26", rows
    assert rows[1]["town"] == "Lake Placid, NY" and rows[0]["town"] == "St.Albans", rows
    assert set(rows[0]) == {"id", "name", "day", "town", "url"}, "no street"

    # BikeReg and UltraSignup: the same fields, the same guards, and one row for a race on two lists
    bike = bikereg_rows({"MatchingEvents": [{"EventId": 7, "EventName": "Unrouted", "EventDate": "/Date(1793505600000-0400)/", "EventCity": "Jericho", "EventState": "VT", "EventAddress": "20 Gable Place", "EventUrl": "https://b"},
                                            {"EventId": 8, "EventName": "Gone CX - CANCELED", "EventDate": "/Date(1793505600000-0400)/", "EventCity": "Jericho", "EventState": "VT", "EventUrl": "https://b"},
                                            {"EventId": 9, "EventName": "Far Ride", "EventDate": "/Date(1793505600000-0400)/", "EventCity": "Boston", "EventState": "MA", "EventUrl": "https://b"}]}, today)
    assert [(r["id"], r["day"], r["town"]) for r in bike] == [("br-7", "2026-11-01", "Jericho")], bike
    ultra = ultrasignup_rows([{"EventDateId": 1, "EventName": "RutFest", "EventDate": "11/21/2026", "City": "Williston", "State": "VT"},
                              {"EventDateId": 2, "EventName": "Off", "EventDate": "11/21/2026", "City": "Williston", "State": "VT", "Cancelled": True},
                              {"EventDateId": 3, "EventName": "Online", "EventDate": "11/21/2026", "City": "Williston", "State": "VT", "VirtualEvent": True}], today)
    assert [r["url"] for r in ultra] == ["https://ultrasignup.com/register.aspx?did=1"], ultra
    twin = {**rows[2], "id": "us-5", "name": "GMAA Trot 2026"}
    both = merge_races([rows, [twin, {**twin, "town": "Essex", "name": "Other Trot"}], ultra])
    assert [r["name"] for r in both] == ["Spelled", "Lake Run", "RutFest", "GMAA Trot", "Other Trot", "Brattleboro Trot"], both
    # a takedown holds for a race too, and takes its twin on the other list with it
    assert "GMAA Trot" not in [r["name"] for r in merge_races([rows, [twin]], {rows[2]["id"]})]


if __name__ == "__main__":
    main()
