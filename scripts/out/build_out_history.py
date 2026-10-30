#!/usr/bin/env python3
"""Rebuild data/out/history-seed.json: Church Street, address by address, for Out's Explore > Then.

What it does: builds one record per Church Street address and corner from
  - scripts/out/inputs/history/hp_A.json, hp_B.json, hp_C.json: entries extracted on 2026-10-29
    from UVM's HP206 historic preservation student pages (https://www.uvm.edu/~hp206/2017/ and /2018/),
    each with the exact quote (`evidence`) it rests on;
  - scripts/out/inputs/history/gaps.json: addresses with nothing found and source conflicts;
  - out-loud/stories.json and data/walking-tour.json in this repo (read live);
  - facts typed in below from the Church Street Marketplace tour pages, the state survey forms,
    Seven Days, NBC5, WCAX, VTDigger and other articles linked from the Btown Brief archive editions
    (each with source_url, edition_url and a verified date).
It makes NO network calls.

What still needs a hand:
  - Re-extracting HP206 pages or adding new articles is manual: edit the inputs or the typed-in
    facts, then rerun. `verified` dates are hard-coded as read on 2026-10-29.
  - Eight source conflicts are kept both ways (see gaps); a person decides which is right.
  - Most of 157 to 197 Church St and a few top-block numbers have no records yet.

Usage: python3 scripts/out/build_out_history.py [out_path]
"""
import json, re, collections

S = str(__import__('pathlib').Path(__file__).resolve().parent / 'inputs' / 'history') + '/'
REPO = str(__import__('pathlib').Path(__file__).resolve().parents[2]) + '/'
OUT = __import__('sys').argv[1] if len(__import__('sys').argv) > 1 else REPO + 'data/out/history-seed.json'
V = '2026-10-29'
ED = 'https://www.btownbrief.com/p/'

stories = {p['id']: p for p in json.load(open(REPO + 'out-loud/stories.json'))['pins']}

def clean(s):
    if s is None:
        return s
    s = s.replace('—', ', ').replace('–', ' to ').replace(' , ', ', ')
    s = re.sub(r',\s*,', ',', s)
    return re.sub(r'\s+', ' ', s).strip()

places = collections.OrderedDict()

def place(pid, kind, address, aka=None, numbers=None, side=None, lat=None, lng=None, coord_note=None, pin=None, hooks=None):
    if pid not in places:
        places[pid] = {'id': pid, 'kind': kind, 'address': address, 'aka': [], 'numbers': numbers or [],
                       'side': side, 'lat': lat, 'lng': lng, 'now': None, 'timeline': [], 'photos': [],
                       'out_loud_pin': pin, 'story_hooks': []}
        if coord_note:
            places[pid]['coord_source'] = coord_note
    p = places[pid]
    for a in aka or []:
        if a not in p['aka']:
            p['aka'].append(a)
    for h in hooks or []:
        p['story_hooks'].append(h)
    if pin:
        p['out_loud_pin'] = pin
    if lat is not None:
        p['lat'], p['lng'] = lat, lng
        if coord_note:
            p['coord_source'] = coord_note
    return p

def ev(pid, frm, to, what, detail, url, label, edition=None, verified=V, via=None, evidence=None, note=None):
    e = {'from': frm, 'to': to, 'what': clean(what), 'detail': clean(detail), 'source_url': url,
         'source_label': clean(label), 'verified': verified}
    if edition:
        e['edition_url'] = edition
    if via:
        e['via'] = via
    if evidence:
        e['evidence'] = clean(evidence)
    if note:
        e['note'] = clean(note)
    places[pid]['timeline'].append(e)

def now(pid, name, since, url, label=None, edition=None, note=None):
    n = {'name': name, 'since': since, 'source_url': url, 'verified': V}
    if label:
        n['source_label'] = label
    if edition:
        n['edition_url'] = edition
    if note:
        n['note'] = clean(note)
    places[pid]['now'] = n

def photo(pid, ref, url, caption):
    places[pid]['photos'].append({'ref': clean(ref), 'source_url': url, 'caption': clean(caption)})

def story_src(pin, i):
    s = stories[pin]['sources'][i]
    return s['url'], clean(s['label'])

def sv(pin):
    return stories[pin].get('factchecked') or stories[pin].get('updated')

# ---------- shared source constants ----------
CSM_TOURS = 'https://churchstmarketplace.com/historic-tours'
CSM_TOURS_L = 'Church Street Marketplace and Preservation Burlington, Historic Tours page'
CSM_HIST = 'https://churchstmarketplace.com/history'
CSM_HIST_L = 'Church Street Marketplace, History page'
HEAD_PDF = 'https://outside.vermont.gov/agency/ACCD/ACCD_Web_Docs/_Drupal%207%20ACCD%20Website%20Document%20Library/images/CD/PlanningAtlas/HistoricDistricts/HeadOfChurchStHD.pdf'
HEAD_L = 'Vermont Division for Historic Preservation, Head of Church Street Historic District survey form (recorded 1973, updated 2010)'
CHP_PDF = 'https://outside.vermont.gov/agency/ACCD/ACCD_Web_Docs/_Drupal%207%20ACCD%20Website%20Document%20Library/images/CD/PlanningAtlas/HistoricDistricts/CityHallParkHD.pdf'
CHP_L = 'Vermont Division for Historic Preservation, City Hall Park Historic District survey form (John Page, 2010)'
BLANCH = 'https://www.sevendaysvt.com/arts-culture/stuckinvermont/stuck-in-vermont-strolling-through-church-streets-past-with-bob-blanchard/'
BLANCH_L = 'Seven Days, Stuck in Vermont: Strolling Through Church Street\'s Past With Bob Blanchard, 2026-06-25'
HP_TOP = 'https://www.uvm.edu/~hp206/2017/pages/Henderson/index.html'
HP_TOP_L = 'UVM HP206, Head of Church Street: Pearl Street west to St. Paul Street, by Timothy Henderson, 2017'

# ---------- street-wide and block records ----------
place('church-street', 'block', 'Church Street Marketplace (whole street, Main St to Pearl St)', aka=['Church Street Marketplace', 'Rue Canada (2025 nickname)'],
      lat=stories['church-street-marketplace']['lat'], lng=stories['church-street-marketplace']['lng'],
      coord_note='out-loud/stories.json pin church-street-marketplace (midpoint of Bank and Cherry crossings)', pin='church-street-marketplace',
      hooks=['Did you cruise Church Street in a car before 1980? What was it like?', 'Were you at the 1971 or 1972 street fairs that tested the pedestrian mall idea?', 'What store on Church Street do you miss most?'])
ev('church-street', '1816', None, 'Street named for the church at its head', 'The street takes its name from the Unitarian church at its top, built in 1816.', BLANCH, BLANCH_L)
ev('church-street', '1854', '1886', 'Gas lamps, then electric lights', 'Gas lamps lit the street from 1854 and were replaced by electric lights in 1886.', BLANCH, BLANCH_L)
ev('church-street', '1885', '1929', 'Horse railroad, trolleys, then buses', 'Public transit began in 1885 with the Winooski and Burlington Horse Railroad, with tracks up the center of the street. Electric trolleys replaced it in 1893, and buses were carrying people by 1929.', BLANCH, BLANCH_L)
ev('church-street', '1923', '1948', 'Concrete, then asphalt', 'The dirt street was concreted in 1923 and paved with asphalt in 1948.', BLANCH, BLANCH_L)
ev('church-street', '1959', None, 'One-way street for cruising', 'Church Street became a one-way street in 1959 and was a popular place for young people to cruise in their cars.', BLANCH, BLANCH_L)
u, l = story_src('church-street-marketplace', 1)
ev('church-street', '1958', None, 'Pedestrian mall idea first raised', 'The idea of closing the street to cars came up as early as 1958 in urban renewal discussions.', u, l, verified=sv('church-street-marketplace'), via='out-loud/stories.json', note='Wikipedia used as cited in the fact-checked Out Loud pin.')
ev('church-street', '1962', None, 'Bill Truex sees the Stroget', 'Architecture student Bill Truex saw Copenhagen\'s Stroget turned from a traffic-snarled street into a pedestrian mall. Seven years later, as Planning Commission chair, he pushed the idea for Church Street with Street Commission chair Pat Robins.', CSM_HIST, CSM_HIST_L)
ev('church-street', '1971', '1972', 'Street fairs test the idea', 'A one-day street fair in 1971 drew about 15,000 people, and a week-long fair in 1972 drew an estimated 50,000.', u, l, verified=sv('church-street-marketplace'), via='out-loud/stories.json')
ev('church-street', '1978', '2026', 'Downtown Burlington Development Association, later Burlington Business Association', 'Business boosters formed the Downtown Burlington Development Association in 1978. Its members helped turn Church Street into a pedestrian mall. As the Burlington Business Association it announced its closure on August 10, 2026.', 'https://www.sevendaysvt.com/news/burlington-business-association-shutters-after-nearly-50-years/', 'Seven Days, 2026-08-20', edition=ED + 'friday-august-21st')
ev('church-street', '1980', None, 'Middle two blocks close to cars', 'The two blocks between College and Cherry were permanently closed to traffic on July 7, 1980.', CSM_HIST, CSM_HIST_L)
ev('church-street', '1981', None, 'Church Street Marketplace opens', 'The Marketplace officially opened on September 15, 1981. Funding came from a federal grant secured by Senator Patrick Leahy and Paul Bruhn and a city bond passed by voters with Mayor Gordon Paquette\'s support.', CSM_HIST, CSM_HIST_L)
ev('church-street', '1981', None, 'Glass canopies and brick paving', 'Many storefronts on the west side between Cherry and Bank got glass canopies in 1981, with brickwork laid in the early 1980s.', 'https://www.uvm.edu/~hp206/2018/pages/Cava/', 'UVM HP206, West Side between Cherry and Bank Streets, by Joseph Cava, 2018')
ev('church-street', '1994', None, 'Top block closes', 'The block between Cherry and Pearl was closed to vehicles and resurfaced in brick in 1994.', CSM_HIST, CSM_HIST_L)
ev('church-street', '2005', None, 'City Hall block closes', 'The block between Main and College was the last to close to vehicles and be resurfaced in brick, in 2005.', CSM_HIST, CSM_HIST_L)
ev('church-street', '2010', None, 'Church Street Historic District', 'Burlington\'s Church Street Historic District was listed on the National Register; the HP206 research says a heavily altered building at 25-27 Church was ruled noncontributing in that 2010 nomination.', 'https://www.uvm.edu/~hp206/2017/pages/Tolstoi/pages/Tolstoi.html', 'UVM HP206, Change on Church and Cherry, by Alexander Tolstoi, 2017', note='The National Register nomination PDF itself was not retrieved; the city\'s old link is dead and the Internet Archive was offline on 2026-10-29.')
ev('church-street', None, None, 'Abial Anthony, barber', 'Abial Anthony, a Black barber born in Burlington, worked on Church Street for over 50 years and developed hair products for men that he shipped to Boston and New York. No address or years were given.', 'https://vtcommunitynews.org/2026/07/07/after-three-years-of-grant-funds-the-burlington-history-culture-center-prepares-for-the-future/', 'Community News Service, 2026-07-07', edition=ED + 'friday-july-17th')
photo('church-street', 'Church Street Marketplace History page image: The Preston Company, c. 1960', 'https://churchstmarketplace.com/assets/image-cache/Default.1b164df8.1960_champ_college.9b732ac4.jpg', 'The Preston Company, c. 1960. Courtesy Champlain College (credit as given by the Marketplace). Address not stated.')
photo('church-street', 'Church Street Marketplace History page image: 1980s', 'https://churchstmarketplace.com/assets/image-cache/Default.f351801e.csm_1980s.7dd98447.jpg', 'Church Street Marketplace in the 1980s (as shown on the Marketplace history page; no credit given).')
photo('church-street', 'Church Street Marketplace History page image: 2000s', 'https://churchstmarketplace.com/assets/image-cache/Default.e4b1450d.csm_2000.4d5dff98.jpg', 'Church Street Marketplace around 2000 (as shown on the Marketplace history page; no credit given).')

place('block-pearl-cherry', 'block', 'Church St, Pearl St to Cherry St (top block)', hooks=['Do you remember the top block before it was bricked in 1994?'])
ev('block-pearl-cherry', '1994', None, 'Closed to cars and bricked', 'The top block was closed to vehicles and resurfaced in brick in 1994.', CSM_HIST, CSM_HIST_L)
place('block-cherry-bank', 'block', 'Church St, Cherry St to Bank St')
ev('block-cherry-bank', '1980', None, 'Closed to cars', 'Part of the two blocks between College and Cherry closed to traffic on July 7, 1980.', CSM_HIST, CSM_HIST_L)
place('block-bank-college', 'block', 'Church St, Bank St to College St')
ev('block-bank-college', '1980', None, 'Closed to cars', 'Part of the two blocks between College and Cherry closed to traffic on July 7, 1980.', CSM_HIST, CSM_HIST_L)
place('block-college-main', 'block', 'Church St, College St to Main St (City Hall block)', hooks=['Did you drive or park on the City Hall block before 2005?'])
ev('block-college-main', '2005', None, 'Last block closed to cars', 'The City Hall block was the final block closed to vehicles and resurfaced in brick, in 2005.', CSM_HIST, CSM_HIST_L)
u, l = story_src('church-street-marketplace', 0)
ev('block-college-main', '2005', None, 'Free of cars only since 2005', 'The Out Loud script notes the block facing City Hall has only been car-free since 2005.', u, l, verified=sv('church-street-marketplace'), via='out-loud/stories.json')

# ---------- HP206 merge ----------
def nums(addr):
    m = re.match(r'^(\d+)(?:-(\d+))?\s+Church St$', addr)
    if m:
        a = int(m.group(1)); b = int(m.group(2) or a)
        return [n for n in range(a, b + 1) if n % 2 == a % 2]
    m = re.match(r'^32, 34, and 32 1/2 Church St$', addr)
    if m:
        return [32, 34]
    return []

HP_ID = {
    'West side of Church St between Cherry and Bank (block overview)': 'block-cherry-bank',
    'East side of Church St between College and Bank (block overview)': 'block-bank-college',
    'West side of Church St between King and Maple (block overview)': 'block-king-maple-west',
    'Corner of Church and Main Streets': 'corner-church-main',
    'Corner of Church and College (King Tavern, Strong Block, YMCA Block site)': 'corner-church-college',
    'Ethan Allen Engine Co. No. 4 firehouse (no street number given)': 'church-st-135',
    'City Hall (Court House Square east side; no street number given)': 'church-st-149',
    'Barrows Block': 'church-st-47-55',
    '32, 34, and 32 1/2 Church St': 'church-st-32-34',
    'L-shaped brick dwelling south of the Custom House': 'corner-church-main',
    'Chittenden County Courthouse (southern part of the Custom House lot)': 'corner-church-main',
    'Ravine and parking lot (east side, Main to Maple)': 'block-main-maple-east',
    'Green Mountain Skating Rink site (in the ravine behind the post office)': 'block-main-maple-east',
    '174-176 Maple St': 'church-st-222-228-former',
}
place('block-king-maple-west', 'block', 'Church St below Main: King St to Maple St, west side')
place('block-main-maple-east', 'block', 'Church St below Main: Main St to Maple St, east side')
place('corner-church-main', 'corner', 'Church St and Main St', hooks=['Do you remember the old county courthouse at Church and Main before the 1982 fire?'])
place('corner-church-college', 'corner', 'Church St and College St', hooks=['Did you get coffee or a crepe at the Petit Bijou kiosk?'])
place('church-st-135', 'address', '135 Church St', aka=['Ethan Allen Engine Company No. 4', 'Ethan Allen Firehouse', 'BCA Center'], numbers=[135], side='west',
      lat=stories['firehouse-gallery']['lat'], lng=stories['firehouse-gallery']['lng'], coord_note='out-loud/stories.json pin firehouse-gallery (OSM way 938638122)', pin='firehouse-gallery',
      hooks=['Did you see a show at the Firehouse Gallery in the 1990s?', 'Did you take a UVM continuing education class at the Church Street Center?'])
place('church-st-149', 'address', '149 Church St', aka=['Burlington City Hall', 'Contois Auditorium'], numbers=[149], side='west', pin='city-hall-park',
      hooks=['What event did you attend in Contois Auditorium?'])
place('church-st-222-228-former', 'address', '174-176 Maple St (formerly 222-228 Church St)', aka=['222-228 Church Street'], numbers=[222, 224, 226, 228], side='east')

for f in 'ABC':
    for pg in json.load(open(S + f'hp_{f}.json'))['pages']:
        for pl in pg['places']:
            a = pl['address']
            if a in HP_ID:
                pid = HP_ID[a]
            else:
                ns = nums(a)
                pid = 'church-st-' + (str(ns[0]) if len(ns) == 1 else f'{ns[0]}-{ns[-1]}')
            if pid not in places:
                ns = nums(a)
                place(pid, 'address', a, numbers=ns, side=pl.get('side'))
            p = places[pid]
            if pl.get('side') and not p.get('side'):
                p['side'] = pl['side']
            for x in pl.get('aka') or []:
                x = clean(x)
                if x not in p['aka'] and not re.match(r'^\d', x):
                    p['aka'].append(x)
            for e in pl['timeline']:
                det = e.get('detail') or ''
                if a in ('L-shaped brick dwelling south of the Custom House', 'Chittenden County Courthouse (southern part of the Custom House lot)', 'Green Mountain Skating Rink site (in the ravine behind the post office)', 'Barrows Block'):
                    det = f'({a}) ' + det
                ev(pid, e.get('from'), e.get('to'), e['what'], det, pg['source_url'], pg['source_label'], evidence=e.get('quote'))
            for ph in pl.get('photos') or []:
                cap = (ph.get('caption') or '') + ('. Credit: ' + ph['credit'] if ph.get('credit') else '')
                photo(pid, f"{pg['source_label']}, {ph.get('fig')}", pg['source_url'], cap)

# ---------- Head of Church Street ----------
place('church-st-1-5', 'address', '1-5 Church St', aka=['Masonic Temple', 'One Church Street'], numbers=[1, 3, 5], side='west',
      lat=stories['masonic-temple']['lat'], lng=stories['masonic-temple']['lng'], coord_note='out-loud/stories.json pin masonic-temple (sidewalk point)', pin='masonic-temple',
      hooks=['Did you ever go inside the Masonic Temple when lodges still met there?'])
mt = 'masonic-temple'
ev('church-st-1-5', '1830', '1896', 'House at 3 Church and shop at 5 Church', 'Before the temple the site held a home and a commercial building dating to at least 1830. 3 Church was a private residence; 5 Church had a leather dealer, confectioners and finally cigar maker John Seith. Clearing began July 11, 1896.', HP_TOP, HP_TOP_L)
ev('church-st-1-5', '1868', None, 'Grand Lodge picks Burlington', 'On January 10, 1868 the Grand Lodge of Vermont chose Burlington as the site for a Masonic Temple.', HP_TOP, HP_TOP_L)
ev('church-st-1-5', '1897', '1898', 'Masonic Temple built', 'Built 1897 to 1898 as state headquarters for the Grand Masonic Lodge of Vermont, designed by John McArthur Harris of Wilson Brothers and Company of Philadelphia. It cost $87,500.', HEAD_PDF, HEAD_L)
ev('church-st-1-5', '1898', None, 'Retail on the ground floor from the start', 'The top four floors held lodge meetings and ceremonies; the bottom floor was for retail stores.', CSM_TOURS, CSM_TOURS_L)
ev('church-st-1-5', '1914', None, 'Masons consider selling', 'As early as 1914 the Grand Master suggested selling the temple because of heating costs.', HP_TOP, HP_TOP_L)
ev('church-st-1-5', '1933', None, 'Fire', 'A fire on February 3, 1933 nearly consumed the building, with damage estimated at $60,000.', HP_TOP, HP_TOP_L)
ev('church-st-1-5', '1970', None, 'Meetings move out', 'By 1970 Masonic meetings had moved to a Ramada Inn where heat was included. The Marketplace tour also says meetings ended in the 1970s.', HP_TOP, HP_TOP_L,
   note='Out Loud pin masonic-temple, citing Wikipedia, says the last Burlington lodge merged away in 2016 and moved to Williston; both can be true if lodges met elsewhere after 1970.')
ev('church-st-1-5', '1983', None, 'Bought and renovated for offices', 'The Marketplace tour says the architectural firm Paul, Frank and Collins bought the building in 1983. The HP206 research says the One Church Street Partnership, including Peter Collins, formed in 1984 to buy and renovate it, lifting it onto a new foundation and reopening bricked windows.', CSM_TOURS, CSM_TOURS_L,
   note='Sources disagree on 1983 versus 1984 and on the buyer name (see HP206 Henderson 2017).')
ev('church-st-1-5', '1984', None, 'One Church Street Partnership renovation', 'The partnership received $3.1 million in industrial revenue bonds toward a $4 million purchase and renovation of 50,000 square feet of offices. The building was lifted for a new steel and concrete foundation and windows bricked in the 1940s were reopened.', HP_TOP, HP_TOP_L)
u, l = story_src(mt, 0)
ev('church-st-1-5', '1974', None, 'Head of Church Street Historic District', 'Listed on the National Register on July 15, 1974 with the Unitarian Church and the Richardson Building.', u, l, verified=sv(mt), via='out-loud/stories.json')
photo('church-st-1-5', 'UVM HP206 Henderson 2017, Fig. 3: The Proposed Masonic Temple', HP_TOP, 'Proposed Masonic Temple, Burlington Free Press and Times, June 10, 1896.')
photo('church-st-1-5', 'UVM HP206 Henderson 2017, Fig. 4: West side of Church St at Pearl, April 1860', HP_TOP, '3 Church Street (white one-story home) and 5 Church Street (dark commercial building) before the temple. Courtesy of Special Collections, Bailey/Howe Library, University of Vermont.')

place('church-st-2', 'address', '2 Church St', aka=['Richardson Building', 'Richardson Place', "Abernethy's"], numbers=[2], side='east',
      lat=stories['richardson-building']['lat'], lng=stories['richardson-building']['lng'], coord_note='out-loud/stories.json pin richardson-building', pin='richardson-building',
      hooks=['Did you shop at Abernethy\'s? Do you remember the elevator?'])
ev('church-st-2', '1895', None, 'Richardson Building built', 'Built in 1895 in the Chateauesque style for businessman Albert E. Richardson, designed by Withers and Dickson of New York, to house Burlington\'s largest department store. Upper floors had four upscale apartments.', CSM_TOURS, CSM_TOURS_L)
ev('church-st-2', None, None, "Abernethy's department store (until the 1980s)", 'Abernethy\'s sold high-end clothing for men and women and had a rare early elevator. It stayed until the 1980s.', CSM_TOURS, CSM_TOURS_L, note='The Marketplace spells it Abernathy; most other sources use Abernethy.')
u, l = story_src('richardson-building', 1)
ev('church-st-2', '1983', None, 'R balconies restored', 'Abernethy\'s had covered the R ironwork on the balconies with gold A\'s; the R\'s came back in 1983.', u, l, verified=sv('richardson-building'), via='out-loud/stories.json')
ev('church-st-2', '1974', None, 'Head of Church Street Historic District', 'One of the three buildings listed together in 1974; the state form says it was intended to quarter Burlington\'s largest department store.', HEAD_PDF, HEAD_L)

place('pearl-st-152', 'address', '152 Pearl St (head of Church St)', aka=['First Unitarian Universalist Society', 'Unitarian Church'], numbers=[],
      lat=stories['unitarian-church']['lat'], lng=stories['unitarian-church']['lng'], coord_note='out-loud/stories.json pin unitarian-church', pin='unitarian-church',
      hooks=['Have you heard the bell or been to an event under the steeple?'])
u, l = story_src('unitarian-church', 1)
ev('pearl-st-152', '1814', None, 'Land bought', 'The congregation bought a five-acre pasture in 1814 for $1,000.', u, l, verified=sv('unitarian-church'), via='out-loud/stories.json')
ev('pearl-st-152', '1816', None, 'Meeting house built', 'Built in 1816 by master architect Peter Banner, with evidence Charles Bulfinch supervised or amended the plan. Directions in Burlington are frequently given in relation to it.', HEAD_PDF, HEAD_L)
ev('pearl-st-152', '1817', None, 'Dedicated', 'The church was dedicated on January 9, 1817.', HP_TOP, HP_TOP_L)
ev('pearl-st-152', '1828', '1928', 'Revere bell cracks, recast, replaced', 'The original Paul Revere and Sons bell cracked during vigorous ringing in 1828 and was recast; it was replaced in 1928 with a Meneely bell.', HP_TOP, HP_TOP_L)
ev('pearl-st-152', '1955', '1958', 'Lightning, steeple removed and rebuilt', 'HP206 research says a lightning strike on August 17, 1955, with rot in the framing, made the steeple lean; it was taken down in 1956 and a steel-framed replica was finished in 1958 for $55,000.', HP_TOP, HP_TOP_L,
   note='Out Loud pin unitarian-church says lightning took the original in 1954. HP206 cites Free Press articles from 1955 and 1956. Treat 1954 as unconfirmed.')
ev('pearl-st-152', '1974', None, 'Head of Church Street Historic District', 'Listed on the National Register July 15, 1974.', *story_src('unitarian-church', 2), verified=sv('unitarian-church'), via='out-loud/stories.json')
ev('pearl-st-152', '2026', None, 'Location', 'The walking tour gives the address as 152 Pearl Street, at the top of Church Street.', 'data/walking-tour.json', 'Btown walking tour data (data/walking-tour.json)', verified='2026-08-23', via='data/walking-tour.json')
photo('pearl-st-152', 'UVM HP206 Henderson 2017, Fig. 2: Steeple being removed, 1956', HP_TOP, 'Southwestern elevation of the Unitarian Church with the steeple being removed. Photograph Louis L. McAllister, 1956. Courtesy of Special Collections, Bailey/Howe Library, University of Vermont.')

place('corner-church-pearl', 'corner', 'Church St and Pearl St', aka=['Head of Church Street'], lat=44.48044, lng=-73.21278,
      coord_note='Church x Pearl intersection computed from OSM, as recorded in out-loud/stories.json coord_source for pins unitarian-church and masonic-temple')
ev('corner-church-pearl', '1974', None, 'Head of Church Street Historic District', 'The Unitarian Church, the Masonic Temple and the Richardson Building were listed together. The state form says their placement at Church and Pearl emphasizes the importance of that business center.', HEAD_PDF, HEAD_L)
ev('corner-church-pearl', '1937', '1974', 'A and P supermarket on Pearl near the corner', 'Burlington\'s first supermarket, an A and P on the south side of Pearl between Church and St. Paul, opened in 1937 with a bowling alley in the basement and closed in 1974.', HP_TOP, HP_TOP_L)
ev('corner-church-pearl', '1984', None, 'Hotel plan clears the St. Paul side', 'Tenants near St. Paul and Pearl got eviction notices in October 1984 for a 250-room hotel that was never built; the John J. Zampieri State Office Building opened there in 1993.', HP_TOP, HP_TOP_L)

# ---------- Cherry corner and CityPlace ----------
place('corner-church-cherry', 'corner', 'Church St and Cherry St', lat=44.47930, lng=-73.21271,
      coord_note='OSM Church x Cherry intersection node, as recorded in out-loud/stories.json coord_source for pin cityplace-burlington-town-center', pin='cityplace-burlington-town-center',
      hooks=['Do you remember the New Sherwood Hotel fire stories, or Woolworth\'s lunch counter on this corner?'])
ev('corner-church-cherry', '1859', '1940', 'Hotels on the corner', 'The Stanton House (1859), Rowe\'s Hotel (1874), Hotel Chittenden (1889), the Sherwood and the seven-story New Sherwood (1912) stood at Church and Cherry until the February 14, 1940 fire. See 29-35 Church St.', 'https://www.uvm.edu/~hp206/2017/pages/Tolstoi/pages/Tolstoi.html', 'UVM HP206, Change on Church and Cherry, by Alexander Tolstoi, 2017')
ev('corner-church-cherry', '1863', '1864', "Payn's Block on the southeast corner", 'Gunsmith Edward H. Payn built a three-story Italianate block on the southeast corner after the Concert Hall building burned or was demolished. See 38-44 Church St.', 'https://www.uvm.edu/~hp206/2018/pages/Rizer/', 'UVM HP206, Bank Street to Cherry Street, East Side, by Christopher Rizer, 2018')
ev('corner-church-cherry', '1899', '1998', "Woolworth's", 'Woolworth\'s ran on the corner from 1899 and rebuilt in 1964; it closed in 1998. See 37-45 Church St.', CSM_TOURS, CSM_TOURS_L)

place('church-st-47-55', 'address', '47-55 Church St', numbers=[47, 49, 51, 53, 55], side='west')
cp = 'cityplace-burlington-town-center'
p = places['church-st-47-55']
p['out_loud_pin'] = cp
p['story_hooks'] += ['Did you shop at the Burlington Square Mall when it opened in 1976?', 'What do you remember about the pit years, 2017 to 2022?']
for x in ['Burlington Square Mall', 'Burlington Town Center', 'CityPlace Burlington', 'Burlington Square']:
    if x not in p['aka']:
        p['aka'].append(x)
u, l = story_src(cp, 2)
ev('church-st-47-55', '1976', None, 'Burlington Square Mall opens', 'The indoor mall opened November 1, 1976 as the Burlington Square Mall with Porteous as anchor, later renamed Burlington Town Center. Filene\'s, later Macy\'s, came in 1999 and L.L. Bean in 2014.', u, l, verified=sv(cp), via='out-loud/stories.json', note='Wikipedia as cited in the fact-checked pin.')
ev('church-st-47-55', '1976', None, 'Mall built as a competitor to suburbs', 'Bob Blanchard\'s stroll describes the 1976 mall as an attempt to compete with suburban shopping centers.', BLANCH, BLANCH_L)
ev('church-st-47-55', '2013', None, 'Bought for $25 million', 'An investor group bought the property in December 2013 for $25 million and in November 2014 proposed a $200 million rebuild.', u, l, verified=sv(cp), via='out-loud/stories.json')
u, l = story_src(cp, 0)
ev('church-st-47-55', '2017', '2022', 'Demolition and the pit', 'Demolition began in December 2017, then work stopped for four years and the site became known as the pit. Local developers restarted construction in 2022.', u, l, verified=sv(cp), via='out-loud/stories.json')
ev('church-st-47-55', '2018', None, 'Macy\'s closes', 'Macy\'s, the only department store downtown, closed in March 2018; Burlington High School used the building from 2021 to 2026.', 'https://www.wcax.com/2026/06/17/developer-floats-amazon-warehouse-former-macys-building-downtown-burlington/', 'WCAX, 2026-06-17', edition=ED + 'friday-june-19th',
   note='The Macy\'s building fronts Cherry Street behind the mall rather than Church Street.')
ev('church-st-47-55', '2025', None, 'Burlington Square south tower opens', 'The AC Hotel by Marriott opened September 18, 2025 with apartments following; the first phase has 161 hotel rooms and 53 apartments.', 'https://www.mynbc5.com/article/burlington-square-apartments-ac-marriott-hotel/65490684', 'NBC5, 2025-07-23', edition=ED + 'thursday-july-24th-must-read')
ev('church-st-47-55', '2026', None, 'North tower and Phase 2', 'In March 2026 the north tower was 90 percent enclosed and the project was aimed at late 2027 or early 2028. In October 2026 developers presented Phase 2, which would replace the rest of the former mall and the old L.L. Bean building with 314 apartments.', 'https://www.wcax.com/2026/03/06/burlington-square-track-late-27-early-28-completion/', 'WCAX, 2026-03-06', edition=ED + 'monday-march-9th',
   note='Phase 2 details are from the Btown Brief 2026-10-19 listing for the Ward 3 NPA meeting at 29 Church Street, linked to a Front Porch Forum calendar post, not independently fetched.')
now('church-st-47-55', 'Burlington Square (former mall site; remaining mall stub and L.L. Bean building vacant)', '2025-09', 'https://www.mynbc5.com/article/burlington-square-apartments-ac-marriott-hotel/65490684', 'NBC5, 2025-07-23')

# ---------- Bank corner, Howard Opera House ----------
place('corner-church-bank', 'corner', 'Church St and Bank St', lat=44.47820, lng=-73.21264,
      coord_note='OSM Church x Bank intersection node, as recorded in out-loud/stories.json coord_source for pin howard-opera-house')
ev('corner-church-bank', '1879', None, 'Howard Opera House on the southwest corner', 'The opera house block opened in 1879 at the southwest corner of Church and Bank. See 81-91 Church St.', *story_src('howard-opera-house', 0), verified=sv('howard-opera-house'), via='out-loud/stories.json')
ev('corner-church-bank', '1900', None, 'Druggists on the northwest corner', 'R. B. Stearns and Co., druggist, was listed at 75 Church on the Bank Street corner in 1900; Kelley Pharmacy ran there from 1943 into the 1990s. See 75 Church St.', 'https://www.uvm.edu/~hp206/2018/pages/Cava/', 'UVM HP206, West Side between Cherry and Bank Streets, by Joseph Cava, 2018')

oh = 'howard-opera-house'
p = places['church-st-81-91']
p['lat'], p['lng'], p['coord_source'], p['out_loud_pin'] = stories[oh]['lat'], stories[oh]['lng'], 'out-loud/stories.json pin howard-opera-house', oh
p['story_hooks'] += ["Did you shop at Magram's?", 'What did you eat at Pascolo, Riko\'s, or the bakery in the opera house block?']
u, l = story_src(oh, 0)
ev('church-st-81-91', '1881', '1901', 'Given to the Home for Destitute Children', 'On November 14, 1881 John Purple Howard gave the whole block to the Home for Destitute Children; the deed barred selling it or closing the theater before November 1901.', u, l, verified=sv(oh), via='out-loud/stories.json')
ev('church-st-81-91', '1904', None, 'Last performance', 'The last performance was November 30, 1904; merchants had bought out the theater lease because of fire insurance costs.', u, l, verified=sv(oh), via='out-loud/stories.json')
ev('church-st-81-91', None, None, "Magram's for over forty years", 'The Marketplace tour says the building housed Magram\'s Department Store for over forty years.', CSM_TOURS, CSM_TOURS_L)
ev('church-st-81-91', None, '2022', 'Pascolo Ristorante, first run at 83', 'Pascolo Ristorante relocated from 83 Church Street to the larger 120 Church Street space when Sweetwaters closed in September 2022.', 'https://www.sevendaysvt.com/food-drink/foodnews/sweetwaters-to-reopen-on-burlingtons-church-street/', 'Seven Days, 2026-01-23', edition=ED + 'monday-january-26th')
ev('church-st-81-91', '2025', '2025', "Riko's Pizza at 83", 'The first Vermont Riko\'s Pizza, a Connecticut tavern-style pizza franchise, held its grand opening in late January 2025 in the 5,000 square foot original Pascolo space at 83 Church and closed for good on August 10, 2025.', 'https://www.sevendaysvt.com/food-drink/rikos-pizza-has-closed-on-burlingtons-church-street-44217625', 'Seven Days, 2025-08-12', edition=ED + 'friday-august-15th-packed-weekend')
ev('church-st-81-91', '2026', None, 'Pascolo returns to 83', 'Jed Davis moved Pascolo back to its original, smaller, subterranean spot at 83 Church Street; Btown Brief reported it reopening there in January 2026.', 'https://www.sevendaysvt.com/food-drink/firstbite/sweetwaters-makes-a-church-street-comeback-in-burlington/', 'Seven Days, 2026-08-04', edition=ED + 'monday-february-9th',
   note='The edition of 2025-10-31 linked an NBC5 URL for this news that now serves an unrelated shopping article.')
now('church-st-81-91', 'Pascolo Ristorante (83), ECCO Clothes (81), Phoenix Books (89) and others', '2026', 'https://www.sevendaysvt.com/food-drink/firstbite/sweetwaters-makes-a-church-street-comeback-in-burlington/', 'Seven Days, 2026-08-04',
    note='ECCO at 81 and Phoenix Books at 89 come from Btown Brief event listings (2026-03-20, 2026-03-23, 2026-08-24). When Phoenix Books moved to 89 Church was not confirmed.')

# ---------- other address facts from editions and articles ----------
def edfact(pid, frm, to, what, detail, url, label, ed, note=None):
    ev(pid, frm, to, what, detail, url, label, edition=ED + ed, note=note)

edfact('church-st-38-44', '2025', '2025', 'Black Cap Coffee and Bakery at 42', 'Black Cap\'s Burlington location at 42 Church Street closed at the end of 2025 amid a strike; owner Laura Vilalta cited two years of declining sales and denied the union was a factor.', 'https://www.sevendaysvt.com/food-drink/foodnews/new-scale-poke-bar-burlington-black-cap-closed/', 'Seven Days, 2025-12-09', 'friday-december-12th')
edfact('church-st-38-44', '2026', None, 'PopUp Bagels coming to 42', 'PopUp Bagels, founded in Connecticut, announced its first Vermont location at 42 Church St.; no opening date was given in May 2026.', 'https://www.mynbc5.com/article/popup-bagels-burlington-vermont/71293164', 'NBC5, 2026-05-13', 'friday-may-15th')
edfact('church-st-38-44', None, '2025', 'Dear Lucy at 38', 'HP206 lists Dear Lucy in Payn\'s Block as of 2018. Seven Days says Dear Lucy later combined with Whim in a larger storefront at 50 Church Street in spring 2025 and closed in January 2026.', 'https://www.sevendaysvt.com/news/business-news/whim-boutique-to-reopen-in-former-church-street-space/', 'Seven Days, 2026-02-08', 'monday-february-16th-president-s-day',
       note='A Btown Brief listing on 2026-01-09 put the Dear Lucy closing sale at 38 Church Street; Seven Days puts the final store at 50 Church Street.')
edfact('church-st-46-50', '2025', '2026', 'Dear Lucy (with Whim) at 50', 'Melissa Desautels merged Whim into Dear Lucy at 50 Church Street in May 2025. Dear Lucy announced its Burlington closing in January 2026.', 'https://www.mynbc5.com/article/dear-lucy-closing-burlington/69948896', 'NBC5, 2026-01-08', 'friday-january-9th',
       note='The 50 Church address comes from Seven Days, 2026-02-08 (Whim article).')
edfact('church-st-60-78', None, '2025', 'Whim boutique at 62', 'Whim occupied the narrow space at 62 Church Street for about 18 years before merging into Dear Lucy in spring 2025.', 'https://www.sevendaysvt.com/news/business-news/whim-boutique-to-reopen-in-former-church-street-space/', 'Seven Days, 2026-02-08', 'monday-february-16th-president-s-day')
edfact('church-st-60-78', '2025', '2026', 'Olive and Ollie at 62', 'Ava Stanley moved her children\'s shop Olive and Ollie into the old Whim space in December 2025 before relaunching Whim there.', 'https://www.sevendaysvt.com/news/business-news/whim-boutique-to-reopen-in-former-church-street-space/', 'Seven Days, 2026-02-08', 'monday-february-16th-president-s-day')
edfact('church-st-60-78', '2026', None, 'Whim returns to 62', 'Ava Stanley, Whim\'s manager from 2018 to 2021, planned to relaunch Whim at 62 Church Street in April 2026 under new ownership.', 'https://www.sevendaysvt.com/news/business-news/whim-boutique-to-reopen-in-former-church-street-space/', 'Seven Days, 2026-02-08', 'monday-february-16th-president-s-day')
edfact('church-st-60-78', None, None, 'Flora and Fauna at 70', 'Shlomi and Miriam Lavi own Flora and Fauna, a large second-floor curiosity and gift store at 70 Church Street.', 'https://www.sevendaysvt.com/news/nostalgia-toy-store-on-burlingtons-church-street-to-close/', 'Seven Days, 2026-06-29', 'monday-july-6th')
edfact('church-st-52-54', '2026', None, 'Homeport expands to Essex', 'Homeport, the kitchen and gift store on the Marketplace, signed a lease for a second store at the Essex Experience in March 2026; the Burlington store stays open.', 'https://www.sevendaysvt.com/news/business-news/church-street-retailer-homeport-to-open-second-store-in-essex/', 'Seven Days, 2026-03-13', 'monday-march-23rd',
       note='Homeport\'s address of 52 Church comes from HP206 (2018) and a Btown Brief listing (2026-05-08).')
now('church-st-52-54', 'Homeport', None, 'https://www.sevendaysvt.com/news/business-news/church-street-retailer-homeport-to-open-second-store-in-essex/', 'Seven Days, 2026-03-13', edition=ED + 'monday-march-23rd')
edfact('church-st-80-82', '2024', '2025', 'Weenies Hot Dogs at 80', 'The compact takeout-only Weenies opened in late November 2024 in a former ATM location at 80 Church Street and closed less than nine months later.', 'https://www.sevendaysvt.com/food-drink/fooddrinkevents/weenies-hot-dogs-closes-in-downtown-burlington/', 'Seven Days, 2025-09-16', 'friday-september-19th',
       note='The article says Weenies opened in November without a year; less than nine months before September 2025 means November 2024.')
edfact('church-st-80-82', '2025', '2026', 'Nostalgia Toys and More at 80', 'The same owners opened the retro toy store in the 300 square foot corner storefront in November 2025. Its last day was July 5, 2026; they cited rent, operating costs, staffing and theft.', 'https://www.sevendaysvt.com/news/nostalgia-toy-store-on-burlingtons-church-street-to-close/', 'Seven Days, 2026-06-29', 'monday-july-6th')
edfact('church-st-112', '1933', '2026', "Lippa's Estate and Fine Jewelry", 'Myer Lippa started the business in 1933. It occupied two other spots on the street before settling at 112 Church Street, and in June 2026 announced a move to an appointment-only showroom in Colchester after 93 years.', 'https://www.sevendaysvt.com/news/business-news/lippas-estate-and-fine-jewelry-to-leave-burlington/', 'Seven Days, 2026-06-23', 'friday-june-26th')
edfact('church-st-104-106', None, '2025', 'Cosmic Grind at 104', 'Barista Cole Thornton worked a decade at the Cosmic Grind at 104 Church Street before leaving in May 2025; it was mostly closed after that.', 'https://www.sevendaysvt.com/food-drink/foodnews/cafe-napoli-to-open-on-cherry-street-in-burlington/', 'Seven Days, 2026-02-10', 'friday-february-13th')
edfact('church-st-104-106', '2026', None, 'Artemus Cafe and Burlington Art Mini Museum at 104', 'Michael Chase took over the narrow former Cosmic Grind storefront at 104 Church Street, aiming for a mid-August 2026 opening.', 'https://www.sevendaysvt.com/food-drink/foodnews/artemus-cafe-and-art-museum-to-open-on-church-street-in-burlington/', 'Seven Days, 2026-08-04', 'monday-august-10th')
edfact('church-st-118-126', '1981', '2022', 'Sweetwaters, first run', 'The Perry Restaurant Group opened Sweetwaters in 1981 in the historic bank building at 120 Church Street. It closed in September 2022 after 41 years so Pascolo could move in.', 'https://www.sevendaysvt.com/food-drink/firstbite/sweetwaters-makes-a-church-street-comeback-in-burlington/', 'Seven Days, 2026-08-04', 'friday-august-7th')
edfact('church-st-118-126', '1981', None, 'The Sweetwaters mural', 'A 1981 mural showed Burlington figures such as Mayor Bernie Sanders, musician Big Joe Burrell and Lois Bodoky, the Church Street hot dog lady. It remains tiled over.', 'https://www.sevendaysvt.com/food-drink/firstbite/sweetwaters-makes-a-church-street-comeback-in-burlington/', 'Seven Days, 2026-08-04', 'friday-august-7th')
edfact('church-st-118-126', '2022', '2025', 'Pascolo Ristorante', 'Pascolo moved into 120 Church Street from 83 Church in 2022 and ran about three years before returning to 83.', 'https://www.sevendaysvt.com/food-drink/foodnews/sweetwaters-to-reopen-on-burlingtons-church-street/', 'Seven Days, 2026-01-23', 'monday-january-26th')
edfact('church-st-118-126', '2026', None, 'Sweetwaters reopens', 'Sweetwaters reopened at its original location on Thursday, April 23, 2026 under David Melincoff.', 'https://www.wcax.com/2026/04/23/sweetwaters-is-back-after-4-year-hiatus/', 'WCAX, 2026-04-23', 'friday-april-24th')
now('church-st-118-126', 'Sweetwaters', '2026-04', 'https://www.wcax.com/2026/04/23/sweetwaters-is-back-after-4-year-hiatus/', 'WCAX, 2026-04-23', edition=ED + 'friday-april-24th')
places['church-st-118-126']['story_hooks'] += ['Did you eat at Sweetwaters before 2022? Do you remember the mural?', 'Who did you spot in the Sweetwaters mural?']
edfact('church-st-150-156', '1989', '2026', 'Earth Prime Comics and Quarterstaff Games at 154', 'Christine Farrell opened Earth Prime on Bank Street in 1983, moved it to the building she bought at 154 Church Street in 1989, and opened Quarterstaff Games upstairs that year. After her estate sold the building the shops merged and reopened at 130 Bank Street on May 16, 2026.', 'https://www.sevendaysvt.com/arts-culture/earth-prime-comics-quarterstaff-games-move-to-burlington-square/', 'Seven Days, 2026-05-28', 'friday-may-29th')
places['church-st-150-156']['story_hooks'] += ['Did you buy comics or play Magic upstairs at 154 Church?']
edfact('church-st-184', '2026', None, 'Vacant building renovated into housing', 'The city called 184 Church Street a success story: long vacant, it was under renovation in April 2026 to provide 17 housing units.', 'https://www.wcax.com/2026/04/07/how-burlington-is-addressing-problem-properties/', 'WCAX, 2026-04-07', 'friday-april-10th')
place('church-st-177', 'address', '177 Church St', numbers=[177], side='west')
edfact('church-st-177', None, None, "Big Daddy's Pizza", 'The small restaurant on lower Church Street is best known as the former home of Big Daddy\'s Pizza (years not given).', 'https://www.sevendaysvt.com/food-drink/foodnews/jamaican-taste-cuisine-cooks-home-style-dishes-in-burlington/', 'Seven Days, 2026-07-28', 'monday-august-3rd')
edfact('church-st-177', '2025', '2026', 'Nomads', 'Nomads opened in May 2025 with Arabic and American food and closed about eight months later.', 'https://www.sevendaysvt.com/food-drink/foodnews/jamaican-taste-cuisine-cooks-home-style-dishes-in-burlington/', 'Seven Days, 2026-07-28', 'monday-august-3rd')
edfact('church-st-177', '2026', None, 'Jamaican Taste Cuisine', 'Natalie Bailey opened Jamaican Taste Cuisine at 177 Church Street on May 30, 2026.', 'https://www.sevendaysvt.com/food-drink/foodnews/jamaican-taste-cuisine-cooks-home-style-dishes-in-burlington/', 'Seven Days, 2026-07-28', 'monday-august-3rd')
now('church-st-177', 'Jamaican Taste Cuisine', '2026-05', 'https://www.sevendaysvt.com/food-drink/foodnews/jamaican-taste-cuisine-cooks-home-style-dishes-in-burlington/', 'Seven Days, 2026-07-28', edition=ED + 'monday-august-3rd')
places['church-st-177']['story_hooks'].append("Did you get a slice at Big Daddy's on lower Church?")

# Church & College corner
edfact('corner-church-college', '2017', '2026', "Leunig's Petit Bijou kiosk", 'Leunig\'s Bistro ran the city-owned 135 square foot kiosk at the corner of Church and College (180 College Street) seasonally since 2017 under a 10-year lease, then chose not to renew.', 'https://www.sevendaysvt.com/food-drink/foodnews/sabahs-house-to-take-over-burlingtons-church-street-kiosk/', 'Seven Days, 2026-05-04', 'monday-may-11th')
edfact('corner-church-college', '2026', None, "Sabah's House kiosk", 'Mustafa Khudaier reopened the kiosk in late June 2026 as Sabah\'s House, serving his mother Sabah Abbas\'s recipes, including a chicken shawarma wrap.', 'https://www.sevendaysvt.com/food-drink/restaurantreviews/one-dish-sabahs-house-shares-shawarma-from-a-family-recipe', 'Seven Days, 2026-10-06', 'friday-october-9th')
now('corner-church-college', "Sabah's House (city kiosk at 180 College St)", '2026-06', 'https://www.sevendaysvt.com/food-drink/restaurantreviews/one-dish-sabahs-house-shares-shawarma-from-a-family-recipe', 'Seven Days, 2026-10-06', edition=ED + 'friday-october-9th')
ev('corner-church-college', '1980', None, "Leunig's on the northwest corner", 'Leunig\'s Bistro opened in 1980 in the Abraham\'s block at 111-115 Church Street. See 111-115 Church St.', 'https://www.uvm.edu/~hp206/2018/pages/Socinski/', 'UVM HP206, Church Street Between Bank and College Streets, West Side, by Greg Socinski, 2018')

# Leunig's, current
edfact('church-st-111-115', '1980', None, "Leunig's described as a fixture since 1980", 'Btown Brief\'s restaurant review calls Leunig\'s Bistro and Cafe a fixture on Church Street since 1980.', ED + 'monday-july-14th-our-next-heatwave-edition', 'Btown Brief restaurant review, 2025-07-14', 'monday-july-14th-our-next-heatwave-edition')
now('church-st-111-115', "Leunig's Bistro and Cafe (115)", '1980', 'https://www.leunigsbistro.com/', "Leunig's Bistro website (address 115 Church Street)")
places['church-st-111-115']['story_hooks'] += ["Did you fill a prescription or buy film at Abraham's?"]
ev('church-st-111-115', '1830', '1956', 'Abraham\'s Block and Sherman Block facades', 'The Marketplace tour dates the joined blocks to 1830 and 1847, with Art Deco and Streamline Moderne facade work by Lewis Newton in 1933 and 1946 and Roland Whittier in 1956.', CSM_TOURS, CSM_TOURS_L)

# 37-45
now('church-st-37-45', 'Outdoor Gear Exchange (37)', None, 'https://www.gearx.com/pages/hours-location', 'Outdoor Gear Exchange, Hours and Location page')
edfact('church-st-37-45', '1995', None, 'Outdoor Gear Exchange marks 30 years', 'Outdoor Gear Exchange celebrated 30 years on the Church Street Marketplace with a block party in July 2025.', 'https://www.mynbc5.com/article/outdoor-gear-exchange-to-celebrate-30-years-on-church-street/65450371', 'NBC5, 2025-07-18', 'monday-july-21st-two-new-ideas-to-introduce',
       note='Thirty years on the Marketplace implies about 1995, but the article does not say when the store first opened or whether it started at 37 Church.')
ev('church-st-37-45', '1964', None, "Woolworth's modern building", 'The Marketplace tour calls the 1964 Woolworth\'s one of Burlington\'s few modernist commercial buildings, with Googie elements and a folded plate facade, and says the lot earlier held a home from the 1830s, an ice cream company and a gas station. At the time it was the chain\'s largest store.', CSM_TOURS, CSM_TOURS_L,
   note='The Marketplace tour labels it 37-42 Church; HP206 uses 37-45 and calls the 1964 building Art Deco. The tour says largest of all their stores; HP206 says one of the largest in New England.')
photo('church-st-37-45', 'Outdoor Gear Exchange storefront (current)', 'https://www.gearx.com/cdn/shop/files/ogestorefronthq_result_1.webp?width=750', 'Current storefront photo from Outdoor Gear Exchange\'s own Hours and Location page (listed in data/vintage-photos.json).')
places['church-st-37-45']['story_hooks'] += ["What did you buy at the Woolworth's lunch counter?"]

# Warner House 32
ev('church-st-32-34', '1854', None, 'Warner House', 'The Marketplace tour dates the small Greek Revival house to about 1854. It was a private home until 1900, a bakery until 1931, then a clothing shop; Shepard and Hamelle sold clothing there for about thirty years. Later uses included a jewelry store, a children\'s clothing store and a finance company.', CSM_TOURS, CSM_TOURS_L)
# Montgomery Ward
ev('church-st-52-54', '1929', '1961', 'Montgomery Ward, store number 515', 'Montgomery Ward opened its 515th store here on December 28, 1929, with the terracotta Spirit of Progress figure on the parapet. It closed in 1961; later tenants included a bargain store, a furniture company and a bank. The building is separately listed on the National Register.', CSM_TOURS, CSM_TOURS_L)
# Warner Block 90-98
ev('church-st-90-96', '1886', '1983', 'Warner Block and The Royal', 'The Marketplace tour gives 90-98 Church as the 1886 Queen Anne Warner Block, built for Mary Wheeler in honor of her uncle Charles Wheeler. The Royal, a dry goods store, ran there from 1903 to 1983.', CSM_TOURS, CSM_TOURS_L,
   note='The tour says the uncle was Charles Wheeler; HP206 Telesca says Mrs. Wheeler inherited from her uncle Charles F. Warner. HP206 uses 90-96 for the Warner Block and 98-100 for the Isham Block.')
# Exchange Block
ev('church-st-150-156', '1878', None, 'Exchange Block', 'The Marketplace tour says local builder William Townshend designed the Italianate block, which replaced the Allen House hotel. Upton\'s candy shop and arcade ran from the 1930s to the 1960s; later uses included a bowling alley, offices, restaurants, a Salvation Army and a drug store.', CSM_TOURS, CSM_TOURS_L)
# Firehouse
fg = 'firehouse-gallery'
ev('church-st-135', '1887', None, 'Ethan Allen Fire Station', 'The Marketplace tour dates the Romanesque Revival firehouse with its 85-foot hose tower to 1887. The city took over fire protection in the 1890s, police used it in the 1960s (bullet holes from target practice remain in the basement) and citizens saved it from demolition in the early 1970s.', CSM_TOURS, CSM_TOURS_L,
   note='Build date conflict: the Marketplace tour and the Out Loud script say 1887; HP206 King, the Champlain College library blog and Wikipedia say 1889.')
u, l = story_src(fg, 1)
ev('church-st-135', '1995', '2002', 'Firehouse Gallery to BCA Center', 'Burlington City Arts moved a gallery into half the ground floor in 1995; the whole building opened as the Firehouse Center for the Visual Arts in 2002, and the original bell returned from the Shelburne Museum that September.', u, l, verified=sv(fg), via='out-loud/stories.json')
ev('church-st-135', '1971', None, 'National Register listing', 'The Out Loud script gives the National Register listing as April 16, 1971.', *story_src(fg, 0), verified=sv(fg), via='out-loud/stories.json',
   note='HP206 King says it was saved and listed in 1970.')
now('church-st-135', 'BCA Center (Burlington City Arts)', '2002', u, l)
# City Hall
ch = 'city-hall-park'
u, l = story_src(ch, 2)
ev('church-st-149', '1928', None, 'City Hall opens', 'The McKim, Mead and White City Hall by William M. Kendall opened May 12, 1928, costing $475,000, $25,000 under budget, built almost entirely of Vermont materials.', u, l, verified=sv(ch), via='out-loud/stories.json')
ev('church-st-149', '1983', None, 'City Hall Park Historic District', 'City Hall and the park were listed on the National Register June 9, 1983 as the City Hall Park Historic District, eight acres bounded by Church, College, Main and St. Paul.', *story_src(ch, 1), verified=sv(ch), via='out-loud/stories.json')
ev('church-st-149', '1790', None, 'Court House Square', 'In the 1790s the proprietors set aside a public common for the county courthouse; it was called Court House Square until the 1880s. The old courthouse stood on the present City Hall site.', CHP_PDF, CHP_L)
now('church-st-149', 'Burlington City Hall (Contois Auditorium inside)', '1928', u, l)
p = places['church-st-149']
p['lat'], p['lng'], p['coord_source'] = 44.47618, -73.21286, 'Burlington City Hall, OSM way 28160084, as recorded in out-loud/stories.json coord_source for pin city-hall-park'
# City Hall Park district buildings on Church
ev('church-st-117', '1928', None, 'McAuliffe Building', 'The state survey form describes the McAuliffe Building, built in 1928, as having a Style Moderne facade of patterned brickwork; it is one of the buildings seen looking west from Church Street.', CHP_PDF, CHP_L)
ev('church-st-123', '1931', None, 'Neo-classical bank in the City Hall Park district', 'The state survey form lists the Merchants Bank (#9) of 1931 as an outstanding Neo-classical building in the streetscape looking west from Church Street. HP206 King identifies 123 Church as the 1931 Chittenden County Trust Company building by Harper and West.', CHP_PDF, CHP_L,
   note='The form does not give street numbers, so the match between survey #9 and 123 Church is not confirmed.')
now('church-st-123', 'Ri Ra Irish Pub', None, 'https://rira.com/burlington/', 'Ri Ra Burlington website (address 123 Church St)')
place('block-main-king-west', 'block', 'Church St below Main: Main St to King St, west side')
ev('block-main-king-west', None, None, 'City Hall Park Historic District buildings', 'The district runs along the west curb of Church Street across Main to King. The form names the c. 1820 Mills House at Church and King, built by the publishers of Burlington\'s first newspaper, the 1845 Times Building (a Greek Revival church turned office building in the 1870s), Stacy\'s Livery Stable, the c. 1835 Asahel Peck House and Charlie\'s Red Hots among buildings on this streetscape.', CHP_PDF, CHP_L,
   note='The form gives survey numbers, not street addresses.')
place('corner-church-king', 'corner', 'Church St and King St')
ev('corner-church-king', '1820', None, 'Mills House', 'The c. 1820 Federal Mills House at the corner of Church and King keeps a fanlight entrance that now opens from the second story because the street was regraded.', CHP_PDF, CHP_L)
ev('corner-church-king', '1917', None, 'Skating rink fire', 'A skating rink and annex at Church and King burned October 10, 1917, costing seventy jobs and $50,000 in damage.', 'https://www.uvm.edu/~hp206/2018/pages/Bodine/', 'UVM HP206, King Street to Maple Street, West Side, by Kristi Bodine, 2018')

# other current occupants from Btown Brief listings and Burger Week
def lst(pid, address, name, ed, url, label, nums_=None, side=None, aka=None):
    if pid not in places:
        place(pid, 'address', address, numbers=nums_, side=side, aka=aka)
    if places[pid]['now'] is None:
        now(pid, name, None, url, label, edition=ED + ed, note='Current occupant as listed in a Btown Brief edition; opening date not established.')
lst('church-st-10', '10 Church St', "EB Strong's Prime Steakhouse", 'wednesday-november-5th-burger-week-incoming', 'https://burgerweek.sevendaysvt.com/burger-special/eb-strongs-prime-steakhouse/', 'Seven Days Burger Week listing, 2025')
lst('church-st-14-16', '14-16 Church St', "Halvorson's Upstreet Cafe (16)", 'wednesday-november-5th-burger-week-incoming', 'https://burgerweek.sevendaysvt.com/burger-special/halvorsons-upstreet-cafe-2/', 'Seven Days Burger Week listing, 2025')
lst('church-st-103-105', '103-105 Church St', 'Church Street Tavern', 'wednesday-november-5th-burger-week-incoming', 'https://burgerweek.sevendaysvt.com/burger-special/church-street-tavern/', 'Seven Days Burger Week listing, 2025')
lst('church-st-99-101', '99-101 Church St', '4T2D (Fourtitude) at 101', 'monday-february-2nd', 'https://churchstmarketplace.com/events/#event=78259937;instance=20260205100000', 'Church Street Marketplace event listing: 4T2D grand opening, 2026-02-05')
places['church-st-99-101']['now']['since'] = '2026-02'
lst('church-st-19-21', '19-21 Church St', 'Spiral House Art Collective (upstairs at 19)', 'wednesday-october-7th', 'https://community.sevendaysvt.com/event/bat-bazaar-45567421', 'Seven Days calendar listing, 2026')
lst('church-st-29-35', '29-35 Church St', 'Lululemon (31)', 'friday-march-27th', 'https://www.meetup.com/special-olympics-vermont-and-lululemon-run-club/events/313918633/', 'Meetup listing, 2026')
lst('church-st-98-100', '98-100 Church St', 'SoulShine Power Yoga (100, third floor)', 'friday-january-9th', 'https://www.facebook.com/events/1385148496389615/', 'Facebook event listing, 2026')
lst('church-st-86-88', '86-88 Church St', 'Saratoga Olive Oil Co. (86)', 'friday-may-8th', 'https://www.btownbrief.com/p/friday-may-8th', 'Btown Brief listing, 2026-05-08')
lst('church-st-165', '165 Church St', "Einstein's Tap House", 'friday-november-14th', 'https://www.btownbrief.com/p/friday-november-14th', 'Btown Brief event listings, 2025-11 to 2026-05', nums_=[165], side='west')
lst('church-st-36', '36 Church St', "Ben & Jerry's", 'monday-april-13th-ad43', 'https://churchstmarketplace.com/events/#event=78323718;instance=20260414000000?popup=1&lang=en-US', 'Church Street Marketplace event listing: Free Cone Day, 2026-04-14', nums_=[36], side='east')
lst('church-st-142-144', '142-144 Church St', 'Gaku Ramen', 'friday-august-7th', 'https://www.btownbrief.com/p/friday-august-7th', 'Btown Brief, Sidewalk Sale item, 2026-08-07')
places['church-st-142-144']['now']['since'] = '2016'
places['church-st-142-144']['now']['note'] = 'Since 2016 per UVM HP206 Johnson 2018; still operating per the Btown Brief 2026-08-07 edition.'

# Bero clock hook, Big Joe hook
places['church-st-107']['story_hooks'].append('Do you set your watch by the Bero clock at 107 Church?')
places['church-st-14-16']['story_hooks'].append('Did you hear Big Joe Burrell play before the statue went up in 2010?')
places['church-st-29-35']['story_hooks'].append('Did you shop at J.C. Penney or Borders at the corner of Church and Cherry?')
places['church-st-71-73']['story_hooks'].append("What did you order at Ken's?")
places['church-st-80-82']['story_hooks'].append('Do you remember the Concord Candy Kitchen at 80 Church?')

# ---------- finalize ----------
def key(p):
    k = p['kind']
    if p['numbers']:
        return (1, p['numbers'][0], p['address'])
    order = {'church-street': 0, 'corner-church-pearl': 1, 'block-pearl-cherry': 2, 'pearl-st-152': 1.5, 'corner-church-cherry': 3, 'block-cherry-bank': 4,
             'corner-church-bank': 5, 'block-bank-college': 6, 'corner-church-college': 7, 'block-college-main': 8, 'corner-church-main': 9,
             'block-main-king-west': 10, 'block-main-maple-east': 11, 'corner-church-king': 12, 'block-king-maple-west': 13}
    return (0, order.get(p['id'], 50), p['address'])

def ykey(e):
    y = e['from'] or e['to'] or '9999'
    m = re.match(r'\d{4}', y)
    return m.group(0) if m else '9999'

out = []
for p in sorted(places.values(), key=key):
    p['timeline'].sort(key=ykey)
    if not p['photos']:
        p.pop('photos')
    if not p['story_hooks']:
        p.pop('story_hooks')
    if not p['numbers']:
        p.pop('numbers')
    if not p.get('side'):
        p.pop('side', None)
    out.append(p)

srcs = collections.OrderedDict()
for p in out:
    for e in p['timeline']:
        srcs.setdefault(e['source_url'], e['source_label'])
    if p.get('now'):
        srcs.setdefault(p['now']['source_url'], p['now'].get('source_label', ''))
    for ph in p.get('photos', []):
        srcs.setdefault(ph['source_url'], ph['ref'])

gaps = json.load(open(S + 'gaps.json'))
doc = {
    'generated': V,
    '_about': ('Living history seed for Church Street, Burlington, Vermont (Main St to Pearl St, the Marketplace blocks, the corners, and notable addresses '
               'just past Pearl and below Main). One record per building or address range, corner, or block, with a dated timeline of what was there. '
               'Every timeline entry has a source_url and a verified date: the date its claim was checked against that source. Entries marked via '
               'out-loud/stories.json were taken from the fact-checked Out Loud scripts and carry that pin\'s fact-check date. Entries from UVM HP206 '
               'student research pages carry an evidence field with a short verbatim excerpt. edition_url points to the Btown Brief edition that '
               'reported the item. numbers lists the individual street numbers a building record covers, so the app can look up 42 Church inside '
               'the 38-44 Church record. Historic street numbers changed around 1885 (HP206 notes 104-106 was 154 before 1885), so old addresses in '
               'evidence text may not match today\'s numbers. lat and lng are filled only where out-loud/stories.json recorded a reliable coordinate. '
               'Reader memories are meant to layer on later, keyed by id.'),
    'counts': {},
    'sources_index': [{'url': u, 'label': l} for u, l in srcs.items()],
    'gaps': gaps,
    'places': out,
}
doc['counts'] = {'places': len(out), 'timeline_entries': sum(len(p['timeline']) for p in out), 'photos': sum(len(p.get('photos', [])) for p in out), 'unique_sources': len(srcs)}
s = json.dumps(doc, indent=1, ensure_ascii=False)
assert '—' not in s and '–' not in s, 'dash found'
open(OUT, 'w').write(s + '\n')
print(doc['counts'])
