#!/usr/bin/env python3
"""Town app, Streets tab: permits, property sales, the blotter numbers, construction projects.

    python3 -m scripts.town.streets                 # -> data/town/streets.json
    python3 -m scripts.town.streets --only permits,sales

Sections (each fails on its own; data/town/streets-sources.json explains every source):
  permits    City OpenGov permit export (Building + Zoning layers on the city ArcGIS), last 42 days,
             each permit tagged with the notable-permit rule, plus a by-week roundup
  sales      Vermont property transfer tax returns (VCGI PTTR layer) for Burlington, last 13 months:
             a sold list for the last 60 days, the notable rule, an out-of-state-buyer flag,
             and running medians of arm's-length sales
  blotter    BPD press releases (city RSS, headlines only) and the monthly BPD incident, arrest
             and BFD incident exports, counted by type and neighborhood (the exports carry no names)
  projects   City construction portal layer, one record per project for "one page per project"

Privacy rules baked in (the repository is public):
  - permits: the Applicant field is never copied (often a homeowner); the contractor field keeps
            only a business name, since it is often "Person / Company" or the owner's own name
  - sales:  individual buyer and seller names are never copied; only entity names (LLC, Inc,
            university, city...) are kept, and trusts and estates are treated as individuals
  - blotter: press releases are stored as headline + link only; the written column applies
            Stephen's rule (a person is named only once arrested or charged) by hand
"""

import argparse
import os
import re
import statistics
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

from .common import (CITY_ARCGIS, OUT_DIR, arcgis_first_layer, arcgis_query, epoch_ms_to_iso,
                     get_text, only_filter, parse_feed, rec, require, run_sections, strip_tags)

OUT = os.path.join(OUT_DIR, "streets.json")

PERMIT_LAYERS = {
    "building": f"{CITY_ARCGIS}/OpenGov_Building/FeatureServer/0",
    "zoning": f"{CITY_ARCGIS}/OpenGov_Zoning/FeatureServer/0",
}
PERMIT_PORTAL = "https://burlingtonvt.portal.opengov.com/"
PERMIT_DAYS = 42
BIG_COST = 250_000
PREFIX_LABELS = {
    "CBP": "Building", "CEP": "Electrical", "CMP": "Mechanical", "CPP": "Plumbing",
    "SIGN": "Sign", "DECK": "Deck", "FENC": "Fence", "WIN": "Windows", "ZP": "Zoning permit",
    "ZCO": "Zoning certificate of occupancy",
}
COMMERCIAL_LUC = re.compile(r"^(C|CR|I)\b")

PTTR = ("https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/"
        "FS_VCGI_OPENDATA_Cadastral_PTTR_point_WM_v1_view/FeatureServer/0")
PTTR_PUBLIC = "https://www.arcgis.com/home/item.html?id=91afc67976d54f9c86437c4fe8744e03"
SOLD_DAYS = 60
COMMERCIAL_CATS = re.compile(r"^(0[7-9]|1[0-9])\.")  # 07+ are non-residential classes; 20 "Other" is not
ENTITY_RE = re.compile(r"\b(LLC|L\.L\.C|INC|CORP|CORPORATION|COMPANY|CO\.|LP|LLP|LTD|PARTNERS|PARTNERSHIP|"
                       r"HOLDINGS|PROPERTIES|REALTY|ASSOCIATES|GROUP|FUND|BANK|UNIVERSITY|COLLEGE|CITY OF|"
                       r"STATE OF|HOUSING|AUTHORITY|DEVELOPMENT|ENTERPRISES|INVESTMENTS|CHURCH|FOUNDATION)\b", re.I)
PERSONAL_ENTITY_RE = re.compile(r"\b(TRUST|TRUSTEE|ESTATE|REVOCABLE|LIVING|U/T/A|FAMILY)\b", re.I)

BPD_RSS = "https://www.burlingtonvt.gov/RSSFeed.aspx?ModID=1&CID=Police-Department-7"
BPD_INCIDENTS = f"{CITY_ARCGIS}/Burlington_Police_Department_Incidents/FeatureServer"
BPD_ARRESTS = f"{CITY_ARCGIS}/Burlington_Police_Department_Arrests/FeatureServer"
BFD_INCIDENTS = f"{CITY_ARCGIS}/Fire_Department_Incidents/FeatureServer"
BPD_DASHBOARD = "https://data.burlingtonvt.gov/"

PROJECTS = f"{CITY_ARCGIS}/Construction_and_Planning_Datasets_Public_View_v2/FeatureServer/2"
PROJECTS_PAGE = "https://www.burlingtonvt.gov/323/Construction-Portal"
# A project's headline status is its most active segment's, not its majority's.
STATUS_PRIORITY = ["Under Construction", "Approved/In-Design", "In Design", "Proposed", "Postponed",
                   "Completed", "Canceled"]


BUSINESS_RE = re.compile(r"\b(LLC|L\.L\.C|INC|CORP|CO\b|COMPANY|LTD|ELECTRIC|ELECTRICAL|CONSTRUCTION|CONSTRCUTION|"
                         r"BUILDERS?|BUILDING|SOLAR|PLUMBING|HEATING|HVAC|ROOFING|SIDING|SYSTEMS|SERVICES|CONTRACTING|"
                         r"CONTRACTORS?|DESIGN|SIGNS?|GLASS|MASONRY|FENCE|DEPOT|MANAGEMENT|MAINTENANCE|RENOVATIONS?|"
                         r"MECHANICAL|RESTORATION|PAINTING|PAINT|WINDOWS?|EXTERIORS|BASEMENT|BATH|LANDSCAP\w*|HOMES|"
                         r"REMODEL\w*|GROUP|BROTHERS|SONS|AUTHORITY|ENERGY|INSULATION|FLOORING|CARPENTRY|WOODWORKS|"
                         r"PROPERTIES|ASSOCIATES|ENTERPRISES|INDUSTRIES|TECHNOLOGIES|PUROCLEAN|BRICKLINERS)\b", re.I)


def _contractor(raw):
    """Keep only a business name. The field is often 'Person / Company', and owner-builders
    put their own name in it, so a part with no business word is dropped."""
    parts = [x.strip(" ,") for x in (raw or "").split("/")]
    biz = [x for x in parts if x and BUSINESS_RE.search(x)]
    return biz[-1] if biz else None


def _clean(html_text, n=420):
    t = strip_tags(html_text or "")
    return t[:n] + ("…" if len(t) > n else "")


def _slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:80]


# ---------------------------------------------------------------- permits
def notable_permit(prefix, luc, text, cost):
    """The notable-permit rule. Returns a list of reasons (empty = routine).

    Content reasons count only on building (CBP) and zoning (Z*) permits, since the trade
    permits for the same job would repeat them; any permit can be notable for its cost."""
    t = text.lower()
    commercial = bool(COMMERCIAL_LUC.match(luc or "")) or not luc
    reasons = []
    if re.search(r"\bdemoli|\braze\b|tear(ing)? down", t) and "interior demol" not in t:
        reasons.append("demolition")
    if re.search(r"\badu\b|accessory dwelling", t):
        reasons.append("adu")
    if commercial and re.search(r"restaurant|\bbar\b|caf[eé]|bakery|brew|tap ?room|commercial kitchen|deli\b|"
                                r"coffee|pizza|bagel|catering|tenant fit|fit[- ]out|change of use|karaoke|wine", t):
        reasons.append("restaurant_or_fitout")
    if re.search(r"new (\d+[- ]unit|building|construction|dwelling|duplex|triplex|condo|apartment|home|house)|"
                 r"\b\d{2,}[- ]unit", t):
        reasons.append("new_building")
    if not (prefix == "CBP" or prefix.startswith("Z")):
        reasons = []  # trade permits (electrical, plumbing, signs...) repeat the building/zoning permit
    if (cost or 0) >= BIG_COST:
        reasons.append("big_project")
    if prefix in ("ZCO",) and commercial:
        reasons.append("commercial_occupancy")
    return reasons


def permits(verified):
    since = (date.today() - timedelta(days=PERMIT_DAYS)).isoformat()
    items, export_dates = [], set()
    for kind, layer in PERMIT_LAYERS.items():
        rows = arcgis_query(layer, where=f"ApplicationDate >= DATE '{since}'",
                            out_fields=("PermitNo,RecordType,ProjectName,Description,ApplicationDate,PermitStatus,"
                                        "WorkflowStep,StreetAddress,PrimaryLUC,StatusDate,ConstructionStartDate,"
                                        "ContractorOrOrganizationName,DateCompleted,PublicUrl,DataUpdateDate,"
                                        "EstimatedConstructionCost"),
                            order_by="ApplicationDate DESC")
        for a in rows:
            no = a.get("PermitNo") or ""
            prefix = re.sub(r"-.*", "", no)
            desc = _clean(a.get("Description"))
            text = f"{a.get('ProjectName') or ''} {desc}"
            cost = a.get("EstimatedConstructionCost")
            if a.get("DataUpdateDate"):
                export_dates.add(epoch_ms_to_iso(a["DataUpdateDate"], date_only=True))
            reasons = notable_permit(prefix, a.get("PrimaryLUC"), text, cost)
            applied = epoch_ms_to_iso(a.get("ApplicationDate"), date_only=True)
            items.append(rec(a.get("PublicUrl") or PERMIT_PORTAL, verified,
                             permit_no=no, layer=kind, kind=PREFIX_LABELS.get(prefix, prefix),
                             address=a.get("StreetAddress"), land_use=a.get("PrimaryLUC"),
                             project=(a.get("ProjectName") or "").strip() or None, description=desc,
                             est_cost=cost, status=a.get("PermitStatus"), step=a.get("WorkflowStep"),
                             applied=applied,
                             week=(datetime.fromisoformat(applied).strftime("%G-W%V") if applied else None),
                             start=epoch_ms_to_iso(a.get("ConstructionStartDate"), date_only=True),
                             contractor=_contractor(a.get("ContractorOrOrganizationName")),
                             notable=bool(reasons), notable_reasons=reasons))
    require(items, 20, "permits in the window")  # ~80 a week in practice
    items.sort(key=lambda r: (r["applied"] or "", r["permit_no"]), reverse=True)
    weeks = defaultdict(lambda: {"total": 0, "notable": 0, "by_kind": Counter(), "est_cost_total": 0})
    for p in items:
        w = weeks[p["week"]]
        w["total"] += 1
        w["notable"] += int(p["notable"])
        w["by_kind"][p["kind"]] += 1
        w["est_cost_total"] += p["est_cost"] or 0
    roundup = [{"week": k, "total": v["total"], "notable": v["notable"], "est_cost_total": v["est_cost_total"],
                "by_kind": dict(v["by_kind"].most_common())} for k, v in sorted(weeks.items(), reverse=True) if k]
    latest_export = max(export_dates) if export_dates else None
    return {"verified": verified,
            "export_date": latest_export,
            "notes": (f"The city's OpenGov portal has no public API; this is its export to ArcGIS, refreshed by the "
                      f"city (last export {latest_export}). Permits filed after that date are not here yet. "
                      "Latitude/Longitude in the export are rounded to 44.5/-73.2, so a map needs geocoding of "
                      "the address. Notable rule: demolition (not interior), ADU, commercial restaurant/bar/cafe "
                      f"or tenant fit-out or change of use, new building or 10+ units, est. cost >= ${BIG_COST:,}."),
            "rule": {"big_cost": BIG_COST, "window_days": PERMIT_DAYS},
            "weekly_roundup": roundup,
            "items": items}


# ---------------------------------------------------------------- sales
def _entity(name):
    name = (name or "").strip()
    if not name or PERSONAL_ENTITY_RE.search(name):
        return None
    return name if ENTITY_RE.search(name) else None


def sales(verified):
    since = (date.today() - timedelta(days=395)).isoformat()
    rows = arcgis_query(PTTR, where=f"TOWNNAME='BURLINGTON' AND closeDate >= DATE '{since}'",
                        out_fields=("OBJECTID,returnID,closeDate,postedDate,propLocStr,span,ValPdOrTrn,TownGlValu,"
                                    "blCn1Desc,intPrpType,intUDPdesc,prTxEx,bUsePrDesc,sUsePrDesc,buyEntNam,"
                                    "sellEntNam,buyerState,buyerCity,ttlBuyers,landSize"),
                        order_by="closeDate DESC")
    require(rows, 100, "Burlington property transfers in 13 months")
    all_sales, sold = [], []
    cutoff = (date.today() - timedelta(days=SOLD_DAYS)).isoformat()
    for a in rows:
        closed = epoch_ms_to_iso(a.get("closeDate"), date_only=True)
        price = a.get("ValPdOrTrn") or 0
        cat = a.get("blCn1Desc") or ""
        arms = a.get("intPrpType") == "01" and a.get("prTxEx") == "00" and price > 0
        state = (a.get("buyerState") or "").strip().upper()
        out_of_state = bool(state) and state not in ("VT", "VERMONT")
        commercial = bool(COMMERCIAL_CATS.match(cat)) or a.get("bUsePrDesc") == "Commercial"
        buyer_entity, seller_entity = _entity(a.get("buyEntNam")), _entity(a.get("sellEntNam"))
        reasons = []
        if commercial:
            reasons.append("commercial")
        if arms and price >= 1_000_000:
            reasons.append("price_1m_plus")
        if cat.startswith("06") and arms and price >= 750_000:
            reasons.append("multi_family")
        if buyer_entity and arms:
            reasons.append("entity_buyer")
        if out_of_state and arms:
            reasons.append("out_of_state_buyer")
        r = rec(PTTR_PUBLIC, verified,
                return_id=a.get("returnID"), closed=closed,
                posted=epoch_ms_to_iso(a.get("postedDate"), date_only=True),
                address=(a.get("propLocStr") or "").title(), span=a.get("span"),
                price=price or None, grand_list_value=a.get("TownGlValu"),
                property_class=cat or None, buyer_use=a.get("bUsePrDesc"),
                arms_length=arms, interest=a.get("intUDPdesc"),
                buyer_entity=buyer_entity, seller_entity=seller_entity,
                buyer_state=state or None, out_of_state_buyer=out_of_state,
                notable=bool(reasons) and (arms or commercial), notable_reasons=reasons)
        all_sales.append(r)
        if closed and closed >= cutoff:
            sold.append(r)

    def med(xs):
        return int(statistics.median(xs)) if xs else None

    resid = [s for s in all_sales if s["arms_length"] and (s["property_class"] or "")[:2] in ("02", "05", "06")]
    today = date.today()
    windows = {}
    for days in (30, 90, 365):
        c = (today - timedelta(days=days)).isoformat()
        win = [s for s in resid if s["closed"] and s["closed"] >= c]
        windows[f"{days}d"] = {
            "all_residential": med([s["price"] for s in win]), "count": len(win),
            "single_family": med([s["price"] for s in win if s["property_class"].startswith("02")]),
            "condo": med([s["price"] for s in win if s["property_class"].startswith("05")]),
            "out_of_state_share": round(sum(s["out_of_state_buyer"] for s in win) / len(win), 3) if win else None,
        }
    monthly = defaultdict(list)
    for s in resid:
        monthly[s["closed"][:7]].append(s["price"])
    by_month = [{"month": m, "median": med(v), "count": len(v)} for m, v in sorted(monthly.items())]
    latest_post = max((s["posted"] for s in all_sales if s["posted"]), default=None)
    return {"verified": verified,
            "latest_posted": latest_post,
            "notes": ("Vermont property transfer tax returns, posted by the Department of Taxes about a week after "
                      "closing and published by VCGI. Arm's length = fee-simple transfer, no tax exemption claimed, "
                      "price above $0. Buyer state is the buyer's mailing address on the return, a proxy for "
                      "'out-of-state'. Individual names are not copied."),
            "medians": windows, "medians_by_month": by_month,
            "items": sold}


# ---------------------------------------------------------------- blotter
def _month_counts(service, date_field, fields, extra=None):
    layer = arcgis_first_layer(service)
    latest = arcgis_query(layer, out_fields=date_field, order_by=f"{date_field} DESC", limit=1, page=1)
    if not latest:
        raise RuntimeError(f"no rows at {layer}")
    last = str(latest[0][date_field])[:7]  # 'YYYY-MM'
    rows = arcgis_query(layer, where=f"{date_field} LIKE '{last}%'", out_fields=",".join(fields + (extra or [])))
    out = {"layer": layer, "month": last, "total": len(rows)}
    for f in fields:
        out[f"by_{f}"] = dict(Counter((r.get(f) or "Unknown") for r in rows).most_common(15))
    return out, rows


def blotter(verified):
    feed = parse_feed(get_text(BPD_RSS).encode("utf-8"))
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    releases = [rec(i["link"] or BPD_RSS, verified, headline=i["title"],
                    posted=i["ts"].isoformat() if i["ts"] else None,
                    case_number=(re.search(r"\b\d{2}BU\d{6}\b", i["title"]) or [None])[0],
                    is_update=i["title"].upper().startswith("UPDATE"))
                for i in feed if not i["ts"] or i["ts"] >= cutoff]
    incidents, inc_rows = _month_counts(BPD_INCIDENTS, "call_time",
                                        ["call_type_group", "category_new", "AreaName", "call_type"],
                                        ["mental_health", "drug_related", "dv_related", "alcohol_related"])
    incidents["flags"] = {f: sum(1 for r in inc_rows if r.get(f) in (1, "1", True)) for f in
                          ("mental_health", "drug_related", "dv_related", "alcohol_related")}
    arrests, _ = _month_counts(BPD_ARRESTS, "arrest_date", ["category", "arrest_type"], ["felony", "violent"])
    fire, _ = _month_counts(BFD_INCIDENTS, "date", ["incident_type_group", "fire_station"])
    for block in (incidents, arrests, fire):
        block["source_url"] = block.pop("layer")
        block["verified"] = verified
    return {"verified": verified,
            "notes": ("The city publishes no daily police log. Press releases arrive by RSS (headline + link kept; "
                      "bodies can name people, so the column writer applies the arrested-or-charged rule). "
                      "Incident, arrest and fire exports are monthly, a month behind, and anonymous; the service is "
                      "re-published each month with a new layer id, which the script discovers."),
            "press_releases": releases, "police_incidents_month": incidents,
            "arrests_month": arrests, "fire_incidents_month": fire}


# ---------------------------------------------------------------- projects
def projects(verified):
    rows = arcgis_query(PROJECTS, out_fields=("OBJECTID,PROJNAME,PRJDEPT,PRJ_TYPE,CIPSTAT,PROJ_STAGE,PRJDESC,Description,"
                                              "CONSTYR,TOTCOST,EXPSTDAT,EXPCOMPDATE,COMPLETEDATE,PRJMAN,MANPHONE,"
                                              "MANEMAIL,LINK,StreetName,HouseNumbers,Ward_num,PublicOutreach,"
                                              "last_edited_date"))
    require(rows, 500, "construction segments")
    keep_after = (date.today() - timedelta(days=365)).isoformat()
    groups = defaultdict(list)
    for a in rows:
        name = re.sub(r"\s+", " ", (a.get("PROJNAME") or "")).strip()
        if not name:
            continue
        groups[_slug(name)].append(a)  # group by slug so case/spacing variants are one project
    out = []
    for slug, segs in groups.items():
        name = Counter(re.sub(r"\s+", " ", s["PROJNAME"]).strip() for s in segs).most_common(1)[0][0]
        statuses = Counter(s.get("CIPSTAT") or "Unknown" for s in segs)
        finished = set(statuses) <= {"Completed", "Canceled"}
        done = (epoch_ms_to_iso(max((s.get("COMPLETEDATE") or 0) for s in segs) or None, date_only=True)
                if finished else None)
        if finished and (not done or done < keep_after):
            continue  # finished more than a year ago (or never dated): not a living page any more
        status = next((st for st in STATUS_PRIORITY if st in statuses), statuses.most_common(1)[0][0])
        first = segs[0]
        links = sorted({s["LINK"] for s in segs if isinstance(s.get("LINK"), str) and s["LINK"].startswith("http")})
        edited = max((s.get("last_edited_date") or 0) for s in segs)
        cost = sum(s.get("TOTCOST") or 0 for s in segs) or None
        out.append(rec(links[0] if links else PROJECTS_PAGE, verified,
                       slug=slug, name=name, department=first.get("PRJDEPT"), type=first.get("PRJ_TYPE"),
                       status=status, status_counts=dict(statuses),
                       stage=first.get("PROJ_STAGE"),
                       description=_clean(first.get("PRJDESC") or first.get("Description"), 600) or None,
                       construction_year=first.get("CONSTYR"), total_cost=cost,
                       expected_start=epoch_ms_to_iso(min((s.get("EXPSTDAT") or 9e15) for s in segs) if any(s.get("EXPSTDAT") for s in segs) else None, date_only=True),
                       expected_finish=epoch_ms_to_iso(max((s.get("EXPCOMPDATE") or 0) for s in segs) or None, date_only=True),
                       completed=done,
                       streets=sorted({s["StreetName"].strip() for s in segs if s.get("StreetName")})[:40],
                       wards=sorted({s["Ward_num"] for s in segs if s.get("Ward_num")}),
                       segments=len(segs),
                       contact={"name": first.get("PRJMAN"), "phone": first.get("MANPHONE"), "email": first.get("MANEMAIL")},
                       links=links, last_edited=epoch_ms_to_iso(edited or None)))
    out.sort(key=lambda r: r["last_edited"] or "", reverse=True)
    return {"verified": verified,
            "notes": ("One record per PROJNAME from the city's construction portal layer (1,800+ street segments). "
                      "Projects completed or cancelled more than a year ago are dropped. Since You Checked already "
                      "emits a change line when a segment is edited (scripts/changes/sources/roads.py)."),
            "items": out}


SECTIONS = [("permits", permits), ("sales", sales), ("blotter", blotter), ("projects", projects)]


def main():
    ap = argparse.ArgumentParser(description="Refresh data/town/streets.json")
    ap.add_argument("--only", help="comma-separated section names")
    args = ap.parse_args()
    print("Town streets:")
    chosen = only_filter(args.only, SECTIONS)
    failed = run_sections(OUT, chosen, {"sources_file": "data/town/streets-sources.json"}, [n for n, _ in SECTIONS])
    sys.exit(1 if failed == len(chosen) else 0)


if __name__ == "__main__":
    main()
