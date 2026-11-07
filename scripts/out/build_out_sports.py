#!/usr/bin/env python3
"""Rebuild data/out/sports.json for the Out app's Sports tab.

What it does: assembles sports.json from snapshot inputs in scripts/out/inputs/sports/
(read on 2026-10-29) plus two live repo files (data/groups.json rows are already in
groups_sports.jsonl; /Users/stephendavis/btownbrief/whos-playing/data/pickup.json is read
directly). It makes NO network calls: it only reshapes what was fetched that day.

Inputs and where they came from (all fetched 2026-10-29 with a browser user agent):
  uvm.json            UVM home games, from https://uvmathletics.com/calendar.ashx/calendar.ics?sport_id={id}
  hs/hs_schools.json  8 high schools from ArbiterLive: GET https://arbiterlive.com/School/Calendar/{id}
                      for a session cookie, then POST startDate/endDate to
                      https://arbiterlive.com/School/GetEventsByEntity/ (venue needs one game-page fetch)
  bhs.json            Burlington High's public Google Calendars (index: https://burlingtonathletics.com/wp-json/calids/v2),
                      read with scripts/build_sports.py's helpers
  lg/gameon.json      Game On VT program pages (https://www.gameonvt.com/programs.php?sport=N)
  pk/parks.json       Burlington Parks Finder ArcGIS layer (courts, fields, rinks; amenities + coordinates)
  mu/past_all.json    Past events of the Burlington Adult Social Sports Meetup (urlname Burlington-Social)
  groups_sports.jsonl sports rows of data/groups.json (checked 2026-10-17), carried over

What still needs a hand:
  - The fetch step is not in this script. The one-off fetchers used that day (UVM ICS, ArbiterLive,
    BHS Google Calendars, Game On, Meetup) were scratch helpers; to refresh, re-fetch each input above
    into scripts/out/inputs/sports/ in the same shape, then rerun this. The ArbiterLive and feed recipes
    are also recorded in sports.json itself (high_school[].feed_url and how-to notes).
  - Hand-typed facts inside this file (league seasons, sign-up links, day-pass prices, the Btown
    Basketball League, VPA notes, gaps) were read on the organizers' pages on 2026-10-29 and must be
    re-checked by a person before trusting them later. `verified` dates are hard-coded as 2026-10-29.
  - Pages that block scripts (South Burlington, Essex, Rice, Mount Mansfield athletics sites; Burlington
    Parks' CivicRec catalog; Cairns Arena; UVM open-rec hours) still need a person or a browser.

Usage: python3 scripts/out/build_out_sports.py [inputs_dir] [out_path]
"""
from pathlib import Path as _P
import sys as _sys
_ROOT = _P(__file__).resolve().parents[2]
if len(_sys.argv) < 2:
    _sys.argv.append(str(_ROOT / "scripts/out/inputs/sports"))
if len(_sys.argv) < 3:
    _sys.argv.append(str(_ROOT / "data/out/sports.json"))
import json, re, datetime as dt, sys
S=sys.argv[1]; OUT=sys.argv[2]
V="2026-10-29"
DAYS={"mon":"Mon","tue":"Tue","wed":"Wed","thu":"Thu","fri":"Fri","sat":"Sat","sun":"Sun"}
def hm(t):
    if not t: return None
    h,m=map(int,t.split(":")); return dt.time(h,m).strftime("%-I:%M%p").lower()
groups={json.loads(l)["id"]:json.loads(l) for l in open(S+"/groups_sports.jsonl")}
def meets_str(g):
    out=[]
    for m in g.get("meets") or []:
        s=DAYS.get(m["day"],m["day"])+(" "+hm(m["time"]) if m.get("time") else "")+("-"+hm(m["end"]) if m.get("end") else "")+(" at "+m["where"] if m.get("where") else "")
        out.append(s)
    return "; ".join(out) or None
def span(g):
    f=[m.get("from") for m in g.get("meets") or [] if m.get("from")]; u=[m.get("until") for m in g.get("meets") or [] if m.get("until")]
    return (min(f) if f else None, max(u) if u else None)

# ---------------- UVM
uvm=json.load(open(S+"/uvm.json"))
for t in uvm:
    if t["team"]=="Field Hockey": t["note"]="No home games left on UVM's feed after Oct 29 (regular season over); postseason home games, if any, would appear in the same feed."
    if t["team"]=="Women's Swimming and Diving": t["tickets_note"]="feed carries no ticket link; UVM's eVenue has no swimming list page (404)"
    if t["team"] in ("Men's Basketball","Women's Basketball"): t["note"]="Neutral-site games outside Burlington (Hempstead NY, Bayamon PR) are left out. UVM's feed was cross-checked against America East's ICS for missing Burlington games: none."
uvm_meta={"source_feeds":"https://uvmathletics.com/calendar.ashx/calendar.ics?sport_id={id}",
  "address_source":"https://uvmathletics.com/sports/2010/6/8/MBB_0608102351.aspx",
  "address_note":"UVM's facility pages give 97 Spear Street, Burlington, VT 05405 for directions to the athletic complex (Gutterson, Patrick, Virtue, Moulton Winder, Forbush); ArbiterLive and Meetup list Gutterson Fieldhouse at 147 Spear St.",
  "not_yet_published":"Men's and women's lacrosse (sport_id 6, 13) and track and field (25, 26) feeds still show only the 2026 spring season; no 2027 dates published yet. Tennis and golf have no ICS feed. UVM has no baseball or softball."}

# ---------------- High school
hs=json.load(open(S+"/hs/hs_schools.json"))
bhs=json.load(open(S+"/hs/../bhs.json")) if False else json.load(open(S+"/bhs.json"))
for s in hs:
    if s["school"]=="Burlington High School":
        s["also_feeds"]={"platform":"Google Calendar (public ICS), one calendar per team",
          "index_url":"https://burlingtonathletics.com/wp-json/calids/v2",
          "ics_template":"https://calendar.google.com/calendar/ical/{calendar_id}/public/basic.ics",
          "examples":[f["ics"] for f in bhs["feeds"][:2]],
          "calendars_resolved":len(bhs["feeds"]),"index_entries":36,
          "note":"Already used by scripts/build_sports.py. Checked today: all 17 high-school varsity calendars resolve, but none has an event after Oct 28, 2026 (fall regular season over; winter schedules not yet entered there). ArbiterLive does have BHS winter games."}
        s["home_venues"]=[{"name":"Burlington High School Gymnasium","address":"52 Seahorse Way, Burlington (ArbiterLive lists 110 Institute Rd/Seahorse Street)"}, {"name":"Gordon H. Paquette Arena, Leddy Park (hockey)","address":"216 Leddy Park Road, Burlington"}]
        s["home_venues_note"]="Venue names from ArbiterLive game pages; Leddy is the home ice of BHS hockey per the city's arena page. 52 Seahorse Way is the BHS address on the Burlington Revolution ticket page."
    s["winter_season_start_note"]="VPA's posted Sports Calendar is still the 2025-26 one; first_winter_game_listed is the earliest winter game in this school's ArbiterLive feed."
vpa={"sports_calendar_url":"https://docs.google.com/spreadsheets/d/17w5IYbT7P4yJx6xDjCefbRqamG2GeKDx6pl18zYYbVY/edit?usp=sharing",
 "sports_calendar_csv":"https://docs.google.com/spreadsheets/d/17w5IYbT7P4yJx6xDjCefbRqamG2GeKDx6pl18zYYbVY/export?format=csv",
 "sports_calendar_status":"Linked from vpaonline.org/athletics/ as 'Sports Calendar', but it still shows 2025 fall, 2025-26 winter and 2026 spring dates (approved by VSADA 1/14/2025). No 2026-27 calendar is posted, so fall 2026 finals dates and the 2026-27 winter start are not stated by VPA.",
 "last_published_pattern":{"winter_2025_26_first_practice":"2025-12-01","winter_2025_26_first_play":"2025-12-12","note":"Last year's dates, for context only; not a 2026-27 date."},
 "fall_2026_playoffs":[{"sport":"Boys Soccer","bracket_url":"https://maxpreps.com/vt/soccer/playoffs"},{"sport":"Girls Soccer","bracket_url":"https://maxpreps.com/vt/soccer/girls/playoffs"},{"sport":"Field Hockey","bracket_url":"https://maxpreps.com/vt/field-hockey/playoffs"},{"sport":"Girls Volleyball","bracket_url":"https://www.maxpreps.com/vt/volleyball/playoffs/"},{"sport":"Boys Volleyball","bracket_url":"https://www.maxpreps.com/vt/volleyball/boys/playoffs/"}],
 "fall_2026_playoffs_note":"VPA's Tournaments page links these 2026 brackets (hosted on MaxPreps, a lead, not read here); football is not linked. Tickets: https://gofan.co/app/school/VPA (JavaScript-only, not readable by script).",
 "tournaments_url":"https://vpaonline.org/athletics/tournaments/",
 "source_url":"https://vpaonline.org/athletics/tournaments/","verified":V}

# ---------------- Leagues
L=[]
def add(**k):
    base={"id":None,"name":None,"organizer":None,"sport":None,"level":None,"ages":None,"town":None,"venue":None,"season_start":None,"season_end":None,"season_note":None,"registration_opens":None,"registration_deadline":None,"signup_url":None,"cost":None,"source_url":None,"verified":V,"notes":None}
    base.update(k); L.append(base)
# Social Sports VT
add(id="ssvt-coed-7v7-soccer-winter",name="Social Sports VT Adult Coed 7v7 Soccer (winter)",organizer="Social Sports VT",sport="soccer",level="adult",ages="16+",town="Shelburne",venue="Shelburne Field House",
    season_note="Winter season January to April 2027; Wed (D1, D2) and Thu (D3, D4) at 6, 7, 8, 9 or 10pm. Spring-summer May-Aug at Essex Tree Farm (Wed); fall Sep-Dec at Shelburne Field House.",
    signup_url="https://www.socialsportsvt.com/winter-team-coed-registration",source_url="https://www.socialsportsvt.com/adult-coed-fall1873961a",
    notes="Page banner says 'REGISTRATION IS OPEN FOR THE WINTER 2027 SEASON' while the winter-season box still says 'REGISTRATION NOT OPEN YET'. Individual sign-up: https://www.socialsportsvt.com/winter-coed-individual-regi. No price or exact dates stated.")
add(id="ssvt-womens-7v7-soccer-winter",name="Social Sports VT Women's 7v7 Soccer (winter)",organizer="Social Sports VT",sport="soccer",level="adult",ages="16+",town="Shelburne",venue="Shelburne Field House",
    season_note="Winter season January to April 2027, Mondays 7 or 8pm. Spring-summer May-Aug at Essex Tree Farm; fall Sep-Dec at Shelburne Field House.",
    signup_url="https://www.socialsportsvt.com/winter-team-womens-registration",source_url="https://www.socialsportsvt.com/women-s-league-winter",
    notes="Banner: 'REGISTRATION IS OPEN FOR THE WINTER 2027 SEASON'; winter box: 'REGISTRATION COMING LATER'. Individual: https://www.socialsportsvt.com/winter-womens-individual-regi. No price stated.")
add(id="ssvt-friday-futsal",name="Social Sports VT Friday Futsal (youth, high school and adult divisions)",organizer="Social Sports VT",sport="futsal",level="adult",ages="U8 to adult; adult divisions Open, Women, 35+, 50+, Walking Futsal",town="Shelburne",venue="Shelburne Field House",
    season_start="2026-10-23",season_end="2027-04-23",season_note="Fridays, 8-week sessions (7 weeks + 1 playoff week): Session 1 Oct 23-Dec 18 (no games Nov 27), Session 2 Jan 1-Feb 19, Session 3 Mar 5-Apr 23. Adult kickoffs 8:00 and 9:00pm; walking futsal 6-7pm. 5v5 incl. goalkeepers.",
    registration_deadline="2026-10-16",signup_url="https://www.socialsportsvt.com/indoor-futsal-league#RegisterHere",
    cost="Teams $720 early bird (to Sep 13, first 4 teams), $800 regular (Sep 14-Oct 4), $850 late (Oct 5-18); individuals $110; walking futsal $120",
    source_url="https://www.socialsportsvt.com/indoor-futsal-league",notes="The Oct 16 deadline is for Session 1; deadlines for sessions 2 and 3 are not stated.")
add(id="ssvt-coming-soon",name="Social Sports VT basketball, pickleball, kickball, ultimate, flag football, wiffle ball, lawn games",organizer="Social Sports VT",sport="multi",level="adult",town=None,
    season_note="Each of these sport pages says 'Coming Soon!' and asks for a volunteer Jr commissioner; no league dates.",source_url="https://www.socialsportsvt.com/basketball",
    notes="Also checked: /pickleball, /kickball, /ultimate-frisbee, /flag-football, /wiffle-ball, /lawn-games (all 'Coming Soon!').")
# Game On
go=json.load(open(S+"/lg/gameon.json"))
MON={"Jan":1,"Feb":2,"Mar":3,"Apr":4,"May":5,"Jun":6,"Jul":7,"Aug":8,"Sep":9,"Oct":10,"Nov":11,"Dec":12}
def pd(s):
    m=re.match(r"([A-Z][a-z]{2}) (\d+)\w*, (\d{4})",s.strip()); return dt.date(int(m.group(3)),MON[m.group(1)],int(m.group(2))).isoformat() if m else None
SPORT={"Volleyball":"volleyball","Pickleball":"pickleball","Floor Hockey":"floor hockey","Broomball":"broomball","Flag Football":"flag football","Cornhole":"cornhole","Field Hockey":"field hockey","Lacrosse":"lacrosse","Basketball":"basketball"}
for pid,p in sorted(go.items()):
    if pid=="149": continue
    rng=[(pd(x["dates"].split(" to ")[0]),pd(x["dates"].split(" to ")[1])) for x in p["sessions"] if " to " in x["dates"]]
    sport=next((v for k,v in SPORT.items() if k in p["name"]),None)
    youth="Youth" in p["name"] or "High School" in p["name"]
    sess="; ".join(f"{x['session']}: {x['day']} {x['time']}, {x['dates']}, {x['location']}, {x['cost']}" for x in p["sessions"])
    venue=p["sessions"][0]["location"] if p["sessions"] else None
    if pid=="20146": venue="BBCO and Queen City Brewery, Burlington"
    add(id="gameon-"+pid,name=p["name"].replace("Game On - ","Game On VT: "),organizer="Game On VT",sport=sport,level="youth" if youth else "adult",
        ages=("8-13" if pid=="19630" else "high school JV/varsity" if pid=="939" else "21+" if pid=="20146" else "18+" if pid in ("2596","156") else "geared toward 18+" if pid in ("19628","2576","2622","177") else None),
        town=(venue.split(",")[1].strip() if venue and venue.count(",")>=1 else None),venue=venue,
        season_start=min(r[0] for r in rng) if rng else None,season_end=max(r[1] for r in rng) if rng else None,season_note=sess,
        signup_url=(f"https://gameonvt.leagueapps.com/registration/init?bid={p['bid']}&redirectToSelfReg=true" if p["bid"] else f"https://www.gameonvt.com/program.php?id={pid}"),
        cost="; ".join(sorted(set(x["cost"] for x in p["sessions"]))),source_url=f"https://www.gameonvt.com/program.php?id={pid}",
        notes=("Ages: the page says 'Geared toward players 18+' for flag football and lacrosse." if pid in ("19628","2576","2622","177") else None))
add(id="bpr-melanie-davidian-basketball",name="Melanie Davidian Women's Basketball League",organizer="Burlington Parks, Recreation & Waterfront",sport="basketball",level="adult",ages="18+",town="Burlington",venue="Robert Miller Community & Recreation Center",
    season_start="2026-11-08",season_end="2027-03-07",season_note="Sundays 2:30-5:30pm. LGBTQIA+ inclusive league (cis-women, trans, intersex, non-binary, gender non-conforming players).",
    signup_url=None,cost="$1,000 per team",source_url="https://www.gameonvt.com/program.php?id=149",
    notes="No online registration: register a team or ask to join one through Jen Cotton, jcotton@burlingtonvt.gov, 802-556-4778 (per the listing). Page also mentions a captains meeting 'Wednesday, October 7' with no year. Listing is hosted on Game On VT's directory but organized by BPRW.")
# Revolution
add(id="burlington-revolution",name="Burlington Revolution (ABA)",organizer="Revolution Basketball",sport="basketball",level="pro-team",ages=None,town="Burlington",venue="Burlington High School, 52 Seahorse Way, Burlington",
    season_start="2026-11-01",season_note="Inaugural 2026-27 ABA season. Home opener vs Capital Region Elites at 4 PM at Burlington High School; season pass covers all 12 regular-season home games and says the first home game is November 1. Full schedule not posted.",
    signup_url="https://burlingtonrevolution.com/products/revolution-vs-capital-region",cost="Single game: $12 general (18+), $8 youth (6-17), $5 BHS/SBHS students with ID, kids 5 and under free. Season pass $100 (general admission).",
    source_url="https://burlingtonrevolution.com/products/revolution-vs-capital-region",
    notes="Season pass: https://burlingtonrevolution.com/products/26-27-season-pass-limited-time-t-shirt. Home games stream on NSNsports.net (schedule page). The opener's date is from the season-pass page; the ticket page gives the time and place.")
add(id="revolution-mens-league",name="Revolution Men's League",organizer="Revolution Basketball",sport="basketball",level="adult",town=None,
    season_note="Revolution Basketball's page says 'Sign up for our 2026 Fall men's league here!!' but the SIGN UP NOW link (revolutionprintsvt.com/collections/frontpage/products/revolution-summer-league) returns 404 today. No dates, venue or price stated.",
    source_url="https://burlingtonrevolution.com/pages/contact",notes="Same page lists invitationals, community leagues and tournaments without dates.")
add(id="revolution-tfl",name="The Future League (TFL), high school",organizer="Revolution Basketball x Blueprint Basketball",sport="basketball",level="youth",ages="high school boys and girls",
    season_note="Described as a league 'bringing the most competitive high school basketball players under one roof'; no dates, venue or price stated.",source_url="https://revolutionprintsvt.com/pages/the-future-league")
# Burlington youth
add(id="bprw-youth-basketball",name="Burlington Youth Basketball League",organizer="Burlington Parks, Recreation & Waterfront",sport="basketball",level="youth",ages="grades 1-8",town="Burlington",
    venue="Burlington Boys and Girls Club, Hunt Middle School, Champlain Elementary School",season_note="Season runs early December to mid-February; one 1-hour weekday practice; games Saturdays 9am-3pm; possible away games grades 3-8; all-girl divisions grades 3-4 and 5-6 at Hunt and Champlain; grades 7-8 only at the Boys & Girls Club.",
    registration_opens="2026-10",signup_url="https://secure.rec1.com/VT/burlington-vt/catalog",source_url="https://www.burlingtonvt.gov/1118/Youth-Basketball-League",
    notes="Page: 'REGISTRATION BEGINS IN OCTOBER' (register through CivicRec or 802-864-0123); late fee after the season starts. registration_opens is month-only as stated. Cost is in the CivicRec catalog, which renders by script and was not read.")
add(id="baha-youth-hockey",name="Burlington Amateur Hockey Association (BAHA)",organizer="Burlington Amateur Hockey Association",sport="hockey",level="youth",town="Burlington",venue="Gordon H. Paquette Ice Arena, Leddy Park",
    season_note="Home ice is Leddy Arena (city arena page). BAHA's site: Learn to Play (ages 5-9, with Boston Bruins/Pure Hockey) 'Registration has closed'; first session '10/4'. No season dates or fees for travel teams stated.",
    source_url="https://www.bahabobcats.com/",notes="Registrar contact on site: baharegistrar1@gmail.com.")
# carried from groups.json
for gid in ["ejrp-barcomb-basketball-league","williston-coed-volleyball-league","full-stride-adult-hockey","full-stride-learn-to-play-hockey","elite-8-soccer-league","elite-11-soccer-league","vermont-ultimate-tuesday-league","vermont-ultimate-rec-coed-league","vermont-ultimate-womens-winter-league","usta-vermont-league-tennis","usta-greater-burlington-flex-league","awasiwi-growth-league","cvu-rando-dubs","spare-time-colchester-bowling-leagues","green-mountain-apa-pool-league","green-mountain-curling-club"]:
    g=groups[gid]; a,b=span(g)
    add(id=gid,name=g["name"],organizer=None,sport=g["category"],level="adult",ages=g.get("level") or None,town=g.get("town") or None,venue=g.get("where") or None,
        season_start=a,season_end=b,season_note=" | ".join(x for x in [g.get("season"),meets_str(g)] if x) or None,signup_url=(g.get("signup") or {}).get("url") or g.get("url"),
        cost=g.get("cost") or None,source_url=g["checked"]["source"],verified=g["checked"]["date"],notes=g.get("what"))
    L[-1]["carried_from"]="data/groups.json"
# UVM community
add(id="uvm-campus-rec-community",name="UVM Campus Recreation community membership",organizer="UVM Campus Recreation",sport="multi (open rec basketball, pickleball, badminton, swim, skate, squash)",level="adult",ages="18+ to join alone (under 18 needs a parent or guardian at sign-up)",town="Burlington",venue="Patrick-Fieldhouse-Gutterson (PFG) complex, UVM",
    season_note="Year-round; hours vary in academic breaks. Includes Gucciardi Fitness Center, pool, indoor track/courts, Gutterson ice rink, squash courts.",
    signup_url="https://uvmcampusrec.com/sports/2017/7/5/membership",cost="$45 per month plus $25 activation fee (monthly auto-renew); $12 day pass; $40 5-visit pass (summer only)",
    source_url="https://uvmcampusrec.com/sports/2017/7/5/membership",notes="Buy at the Campus Rec front desk in the Gucciardi Fitness Center. Group fitness not included. Intramurals and club sports: no community access stated on the pages read.")
# Stephen's BBL
add(id="btown-basketball-league",name="Btown Basketball League (BBL)",organizer="Btown Brief (Stephen Davis)",sport="basketball",level="adult",town="Burlington",venue="Two courts, outdoor first with indoor backup space (courts not named)",
    season_note="6-week league on Wednesday nights (4-week regular season + 2-week playoffs), Thursday rain backup; full-court 5v5, 7-player max rosters, players rate themselves 1-10 for balanced teams. Page says 'Starts Wednesday April 29th' with no year (April 29 was a Wednesday in 2026); the next season's dates are not posted.",
    signup_url="https://forms.gle/C7VXoCeqsN3d8ebLA",cost="$20 (Venmo @BtownBrief)",source_url="https://play.btownbrief.com/btown-basketball-league/",
    notes="Local source file: /Users/stephendavis/btownbrief/btown-basketball-league/index.html. Not for beginners, per the page.")

# ---------------- Pickup
P=[]
def padd(**k):
    base={"id":None,"name":None,"sport":None,"kind":None,"venue":None,"address":None,"town":None,"hours":None,"season":None,"cost":None,"day_pass":None,"door":None,"lat":None,"lng":None,"source_url":None,"verified":V,"notes":None}
    base.update(k); P.append(base)
padd(id="btown-brief-wednesday-pickup",name="Btown Brief Wednesday pickup basketball",sport="basketball",kind="meetup",venue="UVM Indoor Track & Basketball Courts, Gutterson Fieldhouse",address="147 Spear St, Burlington, VT 05405",town="Burlington",
     hours="Wednesdays 5:30-7:30pm",season="Weekly; events posted through Mar 10, 2027",cost="Free to RSVP; UVM day pass required",day_pass={"price":"$12","url":"https://uvmcampusrec.com/sports/2017/7/5/membership","where":"Campus Rec front desk, Gucciardi Fitness Center"},
     door="just show up",source_url="https://www.meetup.com/burlington-social-activites-group/events/",
     notes="Event text: 'competitive pick-up basketball every week on Wednesday evenings' ... 'moving indoors to UVM's Indoor Track & Basketball Courts at Gutterson Fieldhouse. A day pass is $12 per person'. Next: Nov 4, 2026 (https://www.meetup.com/burlington-social-activites-group/events/317001207/). Read with Cache-Control: no-cache and a cache-busting query. door = RSVP on Meetup encouraged; no member gate stated.")
padd(id="uvm-campus-rec-open-rec",name="UVM Campus Rec open rec (basketball, pickleball, badminton)",sport="basketball",kind="indoor-drop-in",venue="UVM PFG complex: Indoor Track courts and the MAC",address="97 Spear Street, Burlington, VT 05405",town="Burlington",
     hours=None,season="Year-round",cost="Included with membership",day_pass={"price":"$12","url":"https://uvmcampusrec.com/sports/2017/7/5/membership"},door="members",
     source_url="https://uvmcampusrec.com/sports/2023/6/9/open-rec.aspx",
     notes="Open Rec page: first come, first served; 'a valid UVM identification is required'. Community members get access through a membership or day pass (membership page). Hours are on https://uvmcampusrec.com/sports/2017/7/5/facility-schedules.aspx (not machine-read). Address is UVM's athletics directions address.")
padd(id="leddy-public-skate",name="Public Skate at Leddy Arena",sport="skating",kind="rink",venue="Gordon H. Paquette Ice Arena, Leddy Park",address="216 Leddy Park Road, Burlington, VT 05401",town="Burlington",
     hours="Mon and Wed 9:10-10:30am; Sun 2:30-4:00pm (plus occasional extra sessions)",season="Posted Nov 2026 to Apr 21, 2027; arena closed Thanksgiving and Dec 31",cost="$6 adult, $4 student; under 5 and over 65 free; 10-visit card $50 adult / $30 student; skate rental $5",
     door="just show up",lat=44.502804,lng=-73.25339,source_url="https://www.burlingtonvt.gov/common/modules/iCalendar/iCalendar.aspx?catID=29&feed=calendar",
     notes="Times from the city's Recreation Drop-in Programs iCal (catID=29, machine-readable). Prices from https://www.burlingtonvt.gov/Facilities/Facility/Details/Gordon-H-Paquette-Ice-Arena-10 (4% card fee). Some Sundays say 'No Public Skate Today'. Coordinates from the city's Parks Finder layer.")
padd(id="leddy-stick-and-puck",name="Stick and Puck at Leddy Arena",sport="hockey",kind="rink",venue="Gordon H. Paquette Ice Arena, Leddy Park",address="216 Leddy Park Road, Burlington, VT 05401",town="Burlington",
     hours="Mon and Wed 10:45am-12:00pm; some Sundays 1:00-2:15pm",season="Posted Nov 2, 2026 to Apr 21, 2027",cost="$9 per player (all ages) or $80 10-visit card; helmet and gloves required",
     door="just show up",lat=44.502804,lng=-73.25339,source_url="https://www.burlingtonvt.gov/common/modules/iCalendar/iCalendar.aspx?catID=29&feed=calendar",
     notes="Prices from the arena facility page. Feed is machine-readable (CivicPlus iCal).")
padd(id="miller-center-pickleball",name="Miller Center drop-in pickleball",sport="pickleball",kind="indoor-drop-in",venue="Robert Miller Community & Recreation Center",address="130 Gosse Court, Burlington, VT 05408",town="Burlington",
     hours="Beginner Thu 1-3pm; Advanced Mon/Wed/Fri 11am-1pm; High Intermediate Tue/Thu 11am-1pm and Sat 8:30-10:30am; Intermediate Mon/Tue/Fri 1-3pm",season="October to May; center closed for renovation Sep 21 to Nov 6, 2026",
     cost="$7 per player; 10-visit card $50; 25-visit card $100",door="just show up",lat=44.513448,lng=-73.246818,source_url="https://www.burlingtonvt.gov/Facilities/Facility/Details/Robert-Miller-Community-Recreation-Cente-11",
     notes="These sessions are not yet on the city's drop-in iCal (catID=29) for after the reopening.")
padd(id="miller-center-table-tennis",name="Miller Center adult drop-in table tennis",sport="table tennis",kind="indoor-drop-in",venue="Robert Miller Community & Recreation Center",address="130 Gosse Court, Burlington, VT 05408",town="Burlington",
     hours="Mondays 6:00-8:30pm",season="Posted Nov 9 to Dec 28, 2026",cost="$7, cash only",door="just show up",lat=44.513448,lng=-73.246818,source_url="https://www.burlingtonvt.gov/Calendar.aspx?EID=4654")
padd(id="miller-center-basketball",name="Miller Center adult drop-in basketball (18+)",sport="basketball",kind="indoor-drop-in",venue="Robert Miller Community & Recreation Center",address="130 Gosse Court, Burlington, VT 05408",town="Burlington",
     hours=None,season=None,cost="$7 per visit, cash (last posted session)",door="just show up",lat=44.513448,lng=-73.246818,source_url="https://www.burlingtonvt.gov/Calendar.aspx?EID=3797",
     notes="The city's facility page says the Miller Center 'offers drop-in Pickleball, Basketball', but no basketball drop-in is on the current drop-in iCal; the last posted session was Sat Dec 13, 2025, 8-10pm. Gym hosts the Melanie Davidian league Sundays from Nov 8.")
padd(id="sb-monday-futsal",name="South Burlington Monday indoor soccer (futsal), 18+",sport="soccer",kind="indoor-drop-in",venue="Rick Marcotte Central School",address="200 Market Street, South Burlington, VT 05403",town="South Burlington",
     hours="Mondays 6:00-8:00pm",season="Nov 2, 2026 to May 3, 2027 (27 dates); not during school vacations",cost="$5 nightly, cash, paid to coordinator",door="just show up",
     source_url="https://www.southburlingtonvt.gov/Calendar.aspx?EID=1735",notes="Co-ed, all skill levels, waiver required, no spectators, no web registration. Machine-readable: https://www.southburlingtonvt.gov/common/modules/iCalendar/iCalendar.aspx?catID=49&feed=calendar (Recreation Adult Drop-in Sports).")
pk=json.load(open("/Users/stephendavis/btownbrief/whos-playing/data/pickup.json"))["entries"]
pkd={e["id"]:e for e in pk}
DOOR={"open":"just show up","ask":"ask first","members":"members"}
for pid,kind in [("sb-sunday-hoops","indoor-drop-in"),("sb-friday-hoops-35","indoor-drop-in"),("sb-monday-pickleball","indoor-drop-in"),("jacked-volleyball","indoor-drop-in"),("vtu-thursday-mixed","field"),("vtu-wednesday-wnb","field"),("edge-racquet-round-robin","indoor-drop-in")]:
    e=pkd[pid]
    padd(id=pid,name=e["name"],sport=e["sport"],kind=kind,venue=e["venue"],town=e["area"],hours=e["schedule"],season=e["season"],cost=e["cost"] or None,door=DOOR.get(e["door"]),source_url=e["link"],verified=e["last_checked"],notes=e.get("note"))
    P[-1]["carried_from"]="/Users/stephendavis/btownbrief/whos-playing/data/pickup.json"
    if pid.startswith("sb-"): P[-1]["notes"]=(e.get("note") or "")+" Not yet on South Burlington's 2026-27 drop-in calendar (catID=49 lists only futsal as of 2026-10-29)."
GDOOR={"ejrp-mens-pickup-basketball":"ask first","ejrp-womens-pickup-basketball":"ask first","shelburne-pickleball-open-play":"just show up","shelburne-adult-volleyball":"ask first","shelburne-mens-pickup-basketball":"ask first","shelburne-table-tennis":"ask first","socialsports-sunday-pickup-soccer":"ask first","cairns-arena-stick-and-puck":"just show up","edge-pickleball-open-play":"ask first","vermont-ultimate-forever-summer-saturdays":"ask first","williston-table-tennis-pickup":"ask first","williston-pickup-volleyball":"ask first","williston-mens-pickup-basketball":"ask first","williston-womens-pickup-basketball":"ask first","talent-skatepark-sessions":"ask first"}
GKIND={"shelburne-pickleball-open-play":"court","cairns-arena-stick-and-puck":"rink"}
for gid,door in GDOOR.items():
    g=groups[gid]
    padd(id=gid,name=g["name"],sport=g["category"],kind=GKIND.get(gid,"indoor-drop-in"),venue=g.get("where") or None,town=g.get("town") or None,hours=meets_str(g),season=g.get("season") or None,cost=g.get("cost") or None,door=door,
         source_url=g["checked"]["source"],verified=g["checked"]["date"],notes=((g.get("signup") or {}).get("how") or "")+". "+(g.get("schedule_note") or ""))
    P[-1]["carried_from"]="data/groups.json"
    P[-1]["door_note"]="door derived from the sign-up rule recorded in groups.json ('register' = ask first)"
parks=json.load(open(S+"/pk/parks.json"))["features"]
for f in parks:
    a=f["attributes"]; am=a.get("Amenities") or ""
    sports=[]
    for k,v in [("Basketball Court","basketball"),("Tennis","tennis"),("Pickleball","pickleball"),("Volleyball","volleyball"),("Soccer Field","soccer"),("Softball","softball"),("Baseball","baseball"),("Disc Golf","disc golf"),("Takraw","takraw"),("Bocce","bocce")]:
        if k.lower() in am.lower(): sports.append(v)
    rink=bool(re.search(r"(?i)outdoor (ice )?rink|winter skating",am))
    if a["Type"] in ("Rec Center","Ice Arena"): continue
    if not sports and not rink: continue
    court=any(s in sports for s in ["basketball","tennis","pickleball","volleyball","takraw","bocce"])
    lat=a.get("Longitude"); lng=a.get("Lat")
    if sports:
        padd(id="btv-park-"+re.sub(r"[^a-z]+","-",a["Location"].lower()).strip("-"),name=a["Location"]+(" courts and fields" if court and len(sports)>1 else ""),sport=", ".join(sports),kind="court" if court else "field",venue=a["Location"],town="Burlington",
             hours=None,season=None,cost=None,door="just show up",lat=lat,lng=lng,source_url="https://services1.arcgis.com/1bO0c7PxQdsGidPK/arcgis/rest/services/Parks_Locations/FeatureServer/5/query?where=1%3D1&outFields=*&f=json",
             notes="Amenities per Burlington Parks' Parks & Facilities Finder layer: "+am+". The city layer states no hours or fees; door is 'just show up' because these are public park amenities, not a stated policy. Its Lat/Longitude fields are swapped (Lat holds longitude); corrected here.")
    if rink:
        padd(id="btv-rink-"+re.sub(r"[^a-z]+","-",a["Location"].lower()).strip("-"),name=a["Location"]+" outdoor ice",sport="skating",kind="rink",venue=a["Location"],town="Burlington",hours=None,season="Winter, when conditions allow",cost=None,door="just show up",lat=lat,lng=lng,
             source_url="https://www.burlingtonvt.gov/1146/Winter-Outdoor-Recreation-in-Parks",
             notes="City: rinks run 'when the temperature and conditions are right', mostly volunteer-managed; live status on https://experience.arcgis.com/experience/6538df1b4d6744e89da6ae8e9dd45689/page/Skating-Rink-Status. Listed as rink/skating in the Parks Finder layer ("+am+").")

# ---------------- Meetup group
ev=json.load(open(S+"/mu/past_all.json"))
fmt=[
 {"format":"Coed indoor volleyball league (recruiting post)","example_titles":["Join a Coed Indoor Volleyball League","Join a coed indoor Volleyball league on Thursday evenings","Join a COED Social Indoor Volleyball League on Wednesdays!"],"typical_day_time":"Wednesdays 6:30-9:30pm (2018-2020), then Thursdays 6:30-9:30pm (2022-2024); games at 6:30, 7:30 or 8:30","venues":["Christ the King School, 136 Locust St, Burlington","Vermont Commons School, 75 Green Mountain Dr, South Burlington","Greater Burlington YMCA, 266 College St","UVM gyms (some games)"],"cost":None,"how_often":"One post per season (fall, winter, spring); 8-11 week leagues","count_seen":0,"years":"2018-2024"},
 {"format":"Coed outdoor grass volleyball league (summer)","example_titles":["Join a Coed Social Outdoor Volleyball League","Co-ed Outdoor Grass Volleyball League","Join an Outdoor Coed Volleyball League!"],"typical_day_time":"Wednesdays 6-8:30pm at Oakledge (2018-2021); Thursdays 5:45-8:30pm, games 6 and 7pm, at Farrell Park (2023-2025)","venues":["Oakledge Park, Burlington","Farrell Park, South Burlington","Schmanska Park, Burlington (2022)"],"cost":None,"how_often":"Once a summer; 8 weeks incl. a playoff week","count_seen":0,"years":"2018-2025"},
 {"format":"Pickup volleyball night (single event, register online)","example_titles":["Pickup Volleyball Thursday, May 9","Pickup Volleyball Thursday, May 16","Pickup Volleyball Thursday, May 23rd"],"typical_day_time":"Thursdays 7-9pm","venues":["Vermont Commons School, South Burlington"],"cost":None,"how_often":"Weekly for three weeks in May 2024","count_seen":3,"years":"2024","notes":"Co-ed 6v6 with 2 players of the opposite gender on court; online registration required because fees cover court costs (fee amount not stated)."},
 {"format":"Coed softball league","example_titles":["Join a Coed SOCIAL Adult Recreational Softball League on Sundays!","Join a Coed Social SOFTBALL league on Thursdays!","Join a Coed Social Softball League"],"typical_day_time":"Sundays 10am-2/3pm; also Thursday evenings 6:15-10pm and a Tuesday evening league (2020)","venues":["Landry Park, Winooski","Jaycee Park, South Burlington"],"cost":None,"how_often":"Fall leagues 2017-2020; 7 weeks (6 games + playoffs)","count_seen":0,"years":"2017-2020"},
 {"format":"Burlington Softball, first season (2016)","example_titles":["Burlington Softball!"],"typical_day_time":"Sundays 10am-2pm per description (event entries were posted nightly at 7pm)","venues":["L.C. Hunt School, 1364 North Ave, Burlington"],"cost":"$55 per player; $770 per team","how_often":"One 9-week league; listed as 99 near-daily repeating entries Aug 22-Nov 27, 2016","count_seen":0,"years":"2016"},
 {"format":"Coed flag football league","example_titles":["Join a COED Social Flag Football League on Tuesdays!"],"typical_day_time":"Tuesdays 6-8:30pm","venues":["various fields in greater Burlington"],"cost":None,"how_often":"Once (summer 2018)","count_seen":0,"years":"2018"},
 {"format":"Coed kickball league","example_titles":["Join a COED SOCIAL Kickball league on Thursday evenings!"],"typical_day_time":"Thursday evenings 6-8pm","venues":[],"cost":None,"how_often":"Once (summer 2018); sponsor-bar social after games","count_seen":0,"years":"2018"},
 {"format":"Coed dodgeball league","example_titles":["Join a Coed Social Dodgeball League on Thursdays!"],"typical_day_time":"Thursdays 7-9pm","venues":["Central School, South Burlington"],"cost":None,"how_often":"Once (winter 2020)","count_seen":0,"years":"2020"},
 {"format":"Coed cornhole league","example_titles":["Join a Coed SOCIAL Cornhole league on Wednesday evenings!"],"typical_day_time":"Wednesdays 7-9pm; teams of 4, three matches a night","venues":["TBD at posting"],"cost":None,"how_often":"Once (fall 2017)","count_seen":0,"years":"2017"},
]
def bucket(e):
    t=e["title"].lower()
    if "pickup volleyball" in t: return 2
    if "burlington softball" in t: return 4
    if "softball" in t: return 3
    if "flag" in t: return 5
    if "kickball" in t: return 6
    if "dodgeball" in t: return 7
    if "cornhole" in t: return 8
    if "volleyball" in t:
        v=(e.get("venue") or {}).get("name") or ""; d=(e.get("description") or "").lower()
        if "outdoor" in t or "grass" in t or v in ("Oakledge Park","Farrell Park","Schmanska Park") or "outdoor" in d[:300]: return 1
        return 0
    return None
for e in ev:
    b=bucket(e)
    if b is not None and b!=2: fmt[b]["count_seen"]+=1
for f in fmt: f["source_url"]="https://www.meetup.com/burlington-social/events/?type=past"
# example event urls
for i,f in enumerate(fmt):
    urls=[e["eventUrl"] for e in ev if bucket(e)==i][:2]
    if i==2: urls=["https://www.meetup.com/burlington-social/events/299893260/","https://www.meetup.com/burlington-social/events/301017257/"]
    f["example_event_urls"]=urls
last=max(e["dateTime"] for e in ev)
meetup={"group_name":"Burlington Adult Social Sports","url":"https://www.meetup.com/burlington-social-sports/","urlname":"burlington-social","member_count":1960,
 "organizer_shown":"Steve Davis (sole leader listed)","founded":"2016-07-26","event_rating":{"average":4.86,"ratings":7},"join_mode":"open",
 "description":"Play sports, meet people and have fun with us! We offer 4 seasons of sports throughout the year . . . play kickball, volleyball, dodgeball, soccer, flag football and so much more with us! www.mysocialsports.com app.mysocialsports.com/regions",
 "status":"dormant","last_event":last[:10],"last_event_title":"Join an Outdoor Coed Volleyball League!","upcoming_events":0,
 "past_events_total":132,"past_events_note":"Meetup's API reports 132 past events; 3 pickup volleyball nights (May 2024) appear on the public past-events page but not in that list, so about 135 in all. 99 of them are repeats of one 2016 softball listing. Every event is a recruiting post for a My Social Sports (mysocialsports.com, later mysocialsports.leagueapps.com) league with registration off Meetup; RSVPs ran 1-23, usually 3-10.",
 "pattern_for_relaunch":"Seasonal cadence (fall, winter, spring indoor; summer outdoor), weeknight 6-9:30pm slots, school gyms (Christ the King, Vermont Commons) indoors and Oakledge/Farrell parks outdoors, free agents / small groups / full teams all accepted, sponsor-bar social after games (2018-2019 copy). Only one post states a price ($55 player / $770 team, 2016).",
 "past_event_formats":fmt,
 "source_url":"https://www.meetup.com/burlington-social-sports/","verified":V,
 "read_method":"Public group page and past-events page (__NEXT_DATA__ Apollo state, Cache-Control: no-cache + cache-buster), plus Meetup's public GraphQL endpoint (https://www.meetup.com/gql2, groupByUrlname events status PAST) read without login. Read only; did not join or RSVP."}

gaps=[
 "VPA has not posted a 2026-27 Sports Calendar: its linked Google Sheet still shows 2025-26 dates, so fall 2026 state-final dates/sites and the official 2026-27 winter first-practice/first-game dates are unknown. Fall 2026 brackets are only on MaxPreps (lead, not read). VPA tickets on GoFan are JavaScript-only.",
 "South Burlington HS (sbschools.net) and Essex HS (ewsd.org) serve a JavaScript bot challenge; Rice (rmhsvt.org) a Cloudflare 403; Mount Mansfield (mmuusd.org) a 403. Their athletics pages were not read; their ArbiterLive calendars were (entity ids found through opponents' game pages).",
 "Essex HS and Winooski keep few of their own home games in ArbiterLive (3 and 2 of 69 and 39 rows), so their home schedules are incomplete there.",
 "Burlington High's 17 public Google Calendars have no events after Oct 28, 2026 (winter not entered yet); ArbiterLive has BHS winter games.",
 "ArbiterLive feed needs a session cookie (GET the school calendar page, then POST to /School/GetEventsByEntity/); it has no venue in the list, so venue needs one game-page fetch per game. Some ArbiterLive times are placeholders (12:01 AM, 5:00 AM); set to null.",
 "UVM lacrosse, track and field 2027 schedules not yet in UVM's feed; tennis and golf have no ICS; no UVM home games for field hockey remain.",
 "Burlington Parks' CivicRec catalog (secure.rec1.com) renders by script and needs a session checkout key, so youth basketball/soccer fees and dates and other BPRW program prices were not read.",
 "Revolution Men's League sign-up link 404s; no 2026-27 dates, venue or price published. Burlington Revolution has not published a full schedule (only the Nov 1 home opener).",
 "Burlington youth soccer club, Little League and other youth associations: no official site found by direct URL (web search budget was exhausted mid-task), so not included beyond BPRW youth basketball and BAHA.",
 "Miller Center adult drop-in basketball: the city says it is offered but no session is posted after Dec 2025; times unknown until the city posts them (center reopens Nov 6, 2026).",
 "South Burlington Sunday 18+ basketball, Friday 35+ basketball and Monday pickleball are not yet on SB's 2026-27 drop-in calendar; carried from whos-playing/data/pickup.json (checked 2026-08-23).",
 "UVM Campus Rec open-rec hours live on facility schedule pages not machine-read; intramural/club access for community members not stated.",
 "Cairns Arena stick-and-puck times and price render by script (finnlyconnect); carried from data/groups.json.",
 "Williston, Essex Junction, Shelburne, Elite 8/11, Full Stride, Vermont Ultimate, USTA, disc golf, bowling, APA and curling rows were carried from data/groups.json (checked 2026-10-17), not re-read today.",
 "Btown Basketball League page gives 'April 29th' with no year and no next-season date.",
 "Burlington park courts/fields: the city's Parks Finder layer gives amenities and coordinates but no street addresses, hours, or fees; outdoor-rink status lives in a separate ArcGIS tracker not read.",
 "Meetup 'Burlington Adult Social Sports': almost no event states a price; Meetup's GraphQL past list omitted 3 events that the public page shows."]

counts={"uvm_teams":len(uvm),"uvm_home_games":sum(len(t["home_games"]) for t in uvm),"high_schools":len(hs),"high_school_sample_home_games":sum(len(s["upcoming_home_games"]) for s in hs),"leagues":len(L),"pickup":len(P),"adult_social_sports_meetup_formats":len(fmt),"gaps":len(gaps)}
doc={"generated":dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
 "_about":"Sports data for Out, the Btown Brief city app (Burlington, VT): UVM home schedules, nearby high-school schedule sources and sample home games, youth/adult leagues with sign-up details, pickup spots and drop-ins, and a profile of the dormant 'Burlington Adult Social Sports' Meetup group for a relaunch. Every record carries source_url (the page that states the facts) and verified (2026-10-29 if read today; an earlier date plus carried_from when copied unchanged from data/groups.json or whos-playing/data/pickup.json). Nothing is guessed: unknown dates, times and prices are null with a note. Refresh path: UVM from uvmathletics.com/calendar.ashx/calendar.ics?sport_id=N (same feed scripts/build_sports.py uses); high schools from ArbiterLive (GET arbiterlive.com/School/Calendar/{entityId} for a cookie, POST startDate/endDate to arbiterlive.com/School/GetEventsByEntity/) plus Burlington High's Google Calendars; Leddy Arena and Miller Center drop-ins from Burlington's CivicPlus iCal (catID=29) and South Burlington's (catID=49); park courts from the city's ArcGIS Parks_Locations layer; Game On VT program pages and Social Sports VT pages by hand; the Meetup group from its public page and gql2. Carried rows should be re-checked on their source pages.",
 "counts":counts,
 "uvm":{"_meta":uvm_meta,"teams":uvm},
 "high_school":{"schools":hs,"vpa":vpa,"machine_readable_note":"All eight schools publish on ArbiterLive, readable by script (JSON). Burlington High also has public Google Calendar ICS feeds."},
 "leagues":L,"pickup":P,"adult_social_sports_meetup":meetup,"gaps":gaps}
json.dump(doc,open(OUT,"w"),indent=1,ensure_ascii=False)
print(json.dumps(counts))
