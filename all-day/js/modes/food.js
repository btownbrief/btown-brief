/* Food: where to eat right now, the deals worth crossing town for, the
   kitchens in their own words, and the dishes readers would tell a friend
   about. We feature, we don't review: no stars, no scores, no rankings and
   nothing negative anywhere on the tab; every place links out to its Google
   page for the full reviews.

   Top to bottom, and the chip row is the table of contents:

   - The Weekly Bite. The newest approved "dish" photo from the reader photo
     queue (js/photos-lib.js, the same queue, consent box and moderation as
     every other reader photo): the picture, its one line, the place, the
     reader's name. Labelled featured, never rated. With none approved yet,
     the slot invites the first one.
   - Open now. data/restaurants.json through js/food-lib.js (the hours engine
     restaurants.html uses, loaded as is), always in Burlington's clock.
     Filter chips: Open now, Open late, Patios, Happy hour, Under $15, Deals,
     each the same test restaurants.html runs, each with its count; then a
     Breakfast / Lunch / Dinner toggle read off today's hours, and a sort:
     nearest Church Street (the default, a distance, never a judgement),
     closest to the reader (only after they allow it), open latest, price,
     newest. When nothing at all is open (the small hours) and the reader
     has not picked a filter, the list leads with what opens next instead
     of an empty block. The Map button at the head draws the list as dots with no
     network at all; tapping it loads Leaflet and OpenStreetMap tiles (the
     guide's own map stack) into a sheet centred on Church Street, pins the
     list, and draws the reader's dot once they allow it. The reader's
     position lives in this module's memory only: never stored, never sent,
     and the map is never turned to it on its own, so no tile request
     carries it either. A row opens a sheet with today's
     hours, the menu (data/small-bites.json), the website and "Full reviews
     on Google" by the place's Google id.
   - The directory. all-day/data/food-directory.json maps a place to its own
     Instagram handle (linked from its own website). A place with its own
     posts, or with dishes readers sent in through the Weekly Bite, gets a
     "Their food" button and its newest picture as the row's thumbnail;
     owners without Instagram get "Feature your restaurant", a mailto.
   - Deals. data/deals.json as a story deck: today's deals that carry a
     verified date from the last 60 days and no open conflict between sources, happening-now first,
     then later today, then the untimed ones. Tap the right side (or the ›)
     for the next card, the left for the previous. The verified date is on
     every card, and the place's own food picture behind it when it has one.
   - Asked on Reddit. The r/burlington threads (and r/vermont ones that
     name a Burlington-area place) asking where to eat or drink, newest
     first, from the shared Reddit intake (scripts/reddit_intake.py, hourly,
     on the reddit-data branch, a 10-day store). js/food-asks.js picks them
     by title rules. A row is the thread's own title and links to it; no
     comment is copied. Coming back after 15 minutes fetches it again.
   - Best of r/burlington. data/best-of-reddit.json's food, coffee and drink
     questions, most asked first: a card per question, a sheet with its
     threads and the Seven Daysies pick where the directory has one. The
     answers live in the threads; nothing here picks a winner.
   - In their own words. Reels from the kitchens and food accounts tagged in
     data/instagram-handles.json (`food`) or listed in the directory, from
     all-day/data/instagram.json, minus the directory's `not_food` accounts.
     A reel plays only on a tap, in the shell's one video box. Its MP4 is
     signed for about a day and a half, so one about to lapse is shown as a
     photo instead; with no reels at all, the accounts' latest photos.
   - Feature a dish. One photo, one line, where it is from, the consent box.
     A dish you loved somewhere or one you made at home: the form asks which
     (At a place / Made at home). The photo queue has no field for that, and
     the SQL is not changed for it, so a home dish travels in the existing
     `spot` field as HOME ("Made at home"), the place it came from; the
     Bite shows it as such, and it never matches a place. It goes to the
     review queue as category `dish`; nothing appears until Stephen
     approves it.

   ?demo=1 runs this same file on data/demo/food.json, which holds every
   payload in its real shape, its times moved to the reader's day. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import { el, esc, safeHref, ICON, art, mark, section, rail, chips, pills, button, agoShort, cards as feedCards, put } from '../ui.js';
import { asksFrom, directoryFrom, GROUPS } from '../food-asks.js';

const KEY = 'food';
const RESTAURANTS_URL = '../data/restaurants.json';
const DEALS_URL = '../data/deals.json';
const MENUS_URL = '../data/small-bites.json';
const ROSTER_URL = '../data/instagram-handles.json';
const FOOD_LIB = '../js/food-lib.js';
const PHOTOS_LIB = '../js/photos-lib.js';
const GUIDE_URL = '../restaurants.html';
const DEALS_PAGE = '../restaurants.html?view=deals';   // deals.html redirects here
const DIRECTORY_URL = './data/food-directory.json';
/* the shared Reddit intake: only on its branch, so no same-origin copy */
const INTAKE_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/reddit-data/data/reddit-intake.json';
const BESTOF_URL = '../data/best-of-reddit.json';
const SUB_URL = 'https://www.reddit.com/r/burlington/';
/* the guide's own map stack (events.html, things-to-do.html): Leaflet from
   unpkg with its integrity hashes, OpenStreetMap's tiles, loaded on the
   first tap of Map and never before */
const LEAFLET = {
  js: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', jsSri: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
  css: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', cssSri: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=',
};
const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const OWNER_MAIL = 'btownbrief@gmail.com';
const FAR_MI = 40;                         // a reader further than this from Church St is not "near" anything here
const CHURCH_ST = [44.4758, -73.2128];   // food-lib's anchor for "walkable"
const FIRST_ROWS = 12;                     // the list opens in place past these
const DECK_MAX = 12;                       // cards before the deck's end card
const RAIL_MAX = 12;
const LINE_MAX = 140;
const VIDEO_MARGIN = 30 * 60;              // a reel this close to lapsing shows as a photo
const LATE = 23 * 60;                      // "Open late": until 11 pm or later (restaurants.html)
const STALE_MS = 5 * 60000;                // the clock-driven parts redraw on the way back in after this
const ASKS_STALE = 15 * 60000;             // the Reddit asks are fetched again on the way back in after this
const DEAL_DAYS = 60;                      // a deal last verified longer ago than this is not shown
const Q_FIRST = 12;                        // Best of r/burlington opens in place past these

const SECTIONS = [['bite', 'The Bite'], ['open', 'Open now'], ['deals', 'Deals'], ['asks', 'Asked'], ['best', 'Best of'], ['kitchens', 'Kitchens'], ['add', 'Feature a dish']];

/* ------------------------------------------------------------------ state */
const S = {
  f: 'open', all: false, deal: 0, sort: 'near', meal: 'any',
  chose: false,              // the reader picked a filter: an empty Open now stays theirs
  asks: null, asksFailed: false, asksAt: 0, asksLoading: false, best: null, bestFailed: false, bestGroup: 'all', bestAll: false,
  staleDeals: 0,
  places: null, byId: null, deals: null, menus: null, foodSet: null, posts: null, dish: undefined, dishes: [],
  dir: null, igBy: new Map(), dishBy: new Map(),
  me: null,                  // [lat, lon] once the reader allows it; memory only
  menusFailed: false, igFailed: false, drawn: 0,
};
let F = null;                // window.BTFood, the hours engine
let root = null, slots = null, pending = null, ready = false;

/* ---------------------------------------------------------------- loading */
const libs = Object.create(null);
function script(src) {
  if (!libs[src]) {
    libs[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve(true);
      s.onerror = () => { delete libs[src]; reject(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  return libs[src];
}

let demoP = null;
const demoFile = () => (demoP || (demoP = app.demoData(KEY).then(redate)));

/* The places, the deals and the engine come first: the tab is drawn when
   they land. The menus (800 KB), the reels and the Weekly Bite fill their
   own slots when they arrive, so a reader typing in the form is never
   redrawn underneath. */
function load() {
  const core = app.demo
    ? Promise.all([script(FOOD_LIB), demoFile()]).then(([, d]) => { takePlaces(d.restaurants); takeDeals(d.deals, Date.parse(d.anchor)); })
    : Promise.all([
      script(FOOD_LIB),
      data.fetchJSON(RESTAURANTS_URL, 12000).then(takePlaces),
      data.fetchJSON(DEALS_URL, 8000).then((j) => takeDeals(j, Date.now())).catch(() => takeDeals({ deals: [] }, Date.now())),
    ]);
  return core.then(() => {
    F = window.BTFood;
    if (!F || !S.places) throw new Error('no hours engine');
    loadLater();
  });
}

function loadLater() {
  if (app.demo) {
    demoFile().then((d) => {
      takeMenus(d.menus); takeRoster(d.roster); takeDirectory(d.directory); takeInstagram(d.instagram);
      takeDishes(d.dishes);
      S.asks = asksFrom(d.reddit, Date.now());
      takeBest(d.bestof);
      paint('bite'); paint('open'); paint('deals'); paint('asks'); paint('best'); paint('kitchens');
      app.paintSubnav();
      land();
    });
    return;
  }
  loadAsks();
  data.fetchJSON(BESTOF_URL, 10000).then(takeBest).catch(() => { S.bestFailed = true; })
    .then(() => { paint('best'); land(); });
  data.fetchJSON(MENUS_URL, 15000).then((j) => { takeMenus(j); paint('open'); })
    .catch(() => { S.menusFailed = true; });
  const roster = data.fetchJSON(ROSTER_URL, 8000).then(takeRoster).catch(() => takeRoster({}));
  const dir = data.fetchJSON(DIRECTORY_URL, 8000).then(takeDirectory).catch(() => takeDirectory({}));
  const ig = new Promise((res) => data.load('instagram', (j) => { takeInstagram(j); res(); if (ready && S.foodSet && S.dir) { paint('kitchens'); paint('open'); paint('deals'); } },
    () => { S.igFailed = true; res(); }));
  Promise.all([roster, dir, ig]).then(() => { paint('kitchens'); paint('open'); paint('deals'); });
  script(PHOTOS_LIB).then(() => window.BTBP.getApproved())
    .then(({ photos }) => takeDishes(photos))
    .catch(() => takeDishes([]))
    .then(() => { paint('bite'); paint('open'); paint('deals'); });
}

/* The Reddit asks, fetched now and again on the way back in. A failed
   refetch keeps the list it had. */
function loadAsks() {
  S.asksAt = Date.now();
  S.asksLoading = true;
  return data.fetchJSON(INTAKE_URL, 10000).then((j) => {
    if (!j || !Array.isArray(j.posts)) throw new Error('not an intake');
    S.asks = asksFrom(j, Date.now());
    S.asksFailed = false;
  }).catch(() => { if (!S.asks) S.asksFailed = true; })
    .then(() => { S.asksLoading = false; paint('asks'); land(); });
}

function takeBest(j) {
  S.best = directoryFrom(j);
  if (!S.best.length) { S.best = null; S.bestFailed = true; }
}

/* restaurants.json lists a dozen places twice (two names for one Google
   place, sometimes one id twice). One row each: the record with the
   editorial blurb wins, and the other's id still finds it, so its deals and
   its menu follow. */
function takePlaces(j) {
  const list = (j && Array.isArray(j.restaurants) ? j.restaurants : [])
    .filter((r) => r && r.id && r.name && !r.closed && !(r.closing && /temporar/i.test(r.closing.note || '')));
  const worth = (r) => (r.blurb ? 4 : 0) + (r.hours_confidence === 'google' ? 2 : 0) + (r.place_id ? 1 : 0);
  const keep = new Map();
  list.forEach((r) => {
    const k = r.place_id || 'id:' + r.id;
    const had = keep.get(k) || keep.get('id:' + r.id);
    if (!had) { keep.set(k, { r, aka: new Set([r.id]) }); keep.set('id:' + r.id, keep.get(k)); return; }
    had.aka.add(r.id);
    if (worth(r) > worth(had.r)) had.r = r;
    keep.set(k, had);
    keep.set('id:' + r.id, had);
  });
  S.byId = Object.create(null);
  S.places = [...new Set(keep.values())].map(({ r, aka }) => ({
    ...r, name: tidyName(r.name), aka: [...aka], mi: r.coords && r.coords.length === 2 ? miles(r.coords, CHURCH_ST) : null,
  })).sort((a, b) => (a.mi == null ? 99 : a.mi) - (b.mi == null ? 99 : b.mi) || a.name.localeCompare(b.name));
  S.places.forEach((r) => r.aka.forEach((id) => { S.byId[id] = r; }));
}

/* "THORN + ROOTS" reads as shouting in a list of quiet names */
const tidyName = (n) => (/[a-z]/.test(n) || !/[A-Z]{3}/.test(n) ? n
  : n.toLowerCase().replace(/(^|[\s(\/-])([a-z])/g, (m, a, b) => a + b.toUpperCase()));

/* The deals we stand behind: verified in the last 60 days, not retired, and
   no open conflict between the two sources that reported it. `at` is the
   clock it is judged by (the demo's anchor in the demo). */
const BTV_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });   // YYYY-MM-DD
function takeDeals(j, at) {
  const ok = (j && Array.isArray(j.deals) ? j.deals : [])
    .filter((d) => d && d.id && d.title && d.business && !d.retired && !d.conflict && /^\d{4}-\d{2}-\d{2}$/.test(String(d.last_verified || '')));
  const today = Date.parse(BTV_DATE.format(new Date(Number(at) || Date.now())) + 'T00:00:00Z');
  const fresh = (d) => (today - Date.parse(d.last_verified + 'T00:00:00Z')) / 86400000 <= DEAL_DAYS;
  S.deals = ok.filter(fresh);
  S.staleDeals = ok.length - S.deals.length;
}

function takeMenus(j) {
  S.menus = Object.create(null);
  (j && Array.isArray(j.restaurants) ? j.restaurants : []).forEach((m) => {
    const u = m && m.menu && m.menu.status !== 'unavailable' && /^https?:/i.test(m.menu.url || '') ? m.menu.url : '';
    if (m && m.id && u) S.menus[m.id] = u;
  });
}

function takeRoster(j) {
  S.foodSet = new Set((j && Array.isArray(j.food) ? j.food : []).map((h) => String(h).replace(/^@/, '').toLowerCase()));
  (Array.isArray(j && j.accounts) ? j.accounts : []).forEach((a) => {
    if (a && (a.category === 'food' || a.food === true)) S.foodSet.add(handle(a.h));
  });
}

/* The directory: restaurant id to the place's own handle, and the accounts
   tagged food that are not about food. */
const handle = (h) => String(h || '').replace(/^@/, '').trim().toLowerCase();
function takeDirectory(j) {
  const places = Object.create(null);
  const src = j && j.places && typeof j.places === 'object' ? j.places : {};
  Object.keys(src).forEach((id) => { const h = handle(src[id]); if (/^[a-z0-9_.]{1,30}$/.test(h)) places[id] = h; });
  const nf = j && j.not_food && typeof j.not_food === 'object' ? Object.keys(j.not_food) : [];
  S.dir = { places, handles: new Set(Object.values(places)), notFood: new Set(nf.map(handle)) };
  indexFood();
}

function takeInstagram(j) {
  S.posts = j && Array.isArray(j.posts) ? j.posts.filter((p) => p && p.h && p.u && p.i) : [];
  indexFood();
}

/* every approved reader dish, newest first; the first is the Weekly Bite */
function takeDishes(list) {
  S.dishes = (Array.isArray(list) ? list : []).filter((p) => p && p.category === 'dish' && p.url);
  S.dish = S.dishes[0] || null;
  indexFood();
}

/* Who posted what, and which dishes belong to which place, worked out once
   per payload rather than once per row. */
function indexFood() {
  S.igBy = new Map();
  (S.posts || []).slice().sort((a, b) => b.ts - a.ts).forEach((p) => {
    const h = handle(p.h);
    if (!S.igBy.has(h)) S.igBy.set(h, []);
    S.igBy.get(h).push(p);
  });
  S.dishBy = new Map();
  if (S.places) S.dishes.forEach((d) => {
    const r = placeByName(d.spot);
    if (!r) return;
    if (!S.dishBy.has(r.id)) S.dishBy.set(r.id, []);
    S.dishBy.get(r.id).push(d);
  });
}

/* The demo file is written on 2026-10-16: its Instagram times and the reels'
   signed expiry move with the reader's clock, so "2d ago" stays two days
   and a demo reel never lapses. Hours are weekly, so they need no moving. */
function redate(d) {
  const shift = Math.round(Date.now() / 1000 - Date.parse(d.anchor || '2026-10-16T12:00:00-04:00') / 1000);
  ((d.instagram && d.instagram.posts) || []).forEach((p) => {
    if (Number(p.ts)) p.ts = Number(p.ts) + shift;
    if (Number(p.ve)) p.ve = Number(p.ve) + shift;
  });
  ((d.reddit && d.reddit.posts) || []).forEach((p) => {
    const ms = Date.parse(p.created || '');
    if (Number.isFinite(ms)) p.created = new Date(ms + shift * 1000).toISOString();
  });
  return d;
}

/* ------------------------------------------------------------ the clock */
/* Burlington's minute, from the engine: { day: 'thu', minutes, dateStr }. */
const now = () => F.now();

/* "10 pm", "9:30 pm", "noon", "midnight" from "HH:MM" */
function clock(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  const hh = h % 24;
  if (hh === 0 && !m) return 'midnight';
  if (hh === 12 && !m) return 'noon';
  return (hh % 12 || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + ' ' + (hh < 12 ? 'am' : 'pm');
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function verified(dateStr, t) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return 'Verified ' + MONTHS[m - 1] + ' ' + d + (t && t.dateStr.slice(0, 4) !== String(y) ? ', ' + y : '');
}
const mmss = (s) => { const n = Math.max(0, Math.round(Number(s) || 0)); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0'); };
const trim = (s, n) => { const v = String(s || '').replace(/\s+/g, ' ').trim(); return v.length > n ? v.slice(0, n - 1).trimEnd() + '…' : v; };
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

function miles(a, b) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const milesText = (mi) => (mi == null ? '' : mi < 0.1 ? 'steps away' : mi < 10 ? mi.toFixed(1) + ' mi' : Math.round(mi) + ' mi');

/* ------------------------------------------------------------ the places */
const hasHours = (r) => !!r.hours && Object.keys(r.hours).length > 0 && r.hours_confidence !== 'unverified';
const isOpen = (r, t) => hasHours(r) && F.isOpenAt(r.hours, t.day, t.minutes);
const dealsAt = (r) => (S.deals || []).filter((d) => r.aka.includes(d.restaurant_id));
const menuOf = (r) => (S.menus ? r.aka.map((id) => S.menus[id]).find(Boolean) || '' : '');

/* the restaurants page's own tests, minus the ones this tab does not carry */
const FILTERS = [
  { key: 'open', label: 'Open now', test: (r, t) => isOpen(r, t) },
  { key: 'late', label: 'Open late',
    test: (r, t) => { if (!hasHours(r)) return false; const c = F.latestCloseTonight(r.hours, t.day); return c !== null && c >= LATE; } },
  { key: 'patio', label: 'Patios', test: (r, t) => r.patio === true && isOpen(r, t) },
  { key: 'hh', label: 'Happy hour', test: (r, t) => dealsAt(r).some((d) => d.type === 'happy-hour' && F.dealAppliesToday(d, t)) },
  { key: 'cheap', label: 'Under $15', test: (r) => r.under_15 === true },
  { key: 'deal', label: 'Deals', test: (r, t) => dealsAt(r).some((d) => F.dealAppliesToday(d, t)) },
];
const filterOf = (k) => FILTERS.find((f) => f.key === k) || FILTERS[0];
const listFor = (k, t) => S.places.filter((r) => filterOf(k).test(r, t) && servesMeal(r, S.meal, t.day));

/* Nothing open at all (the small hours), on the list's own default: rather
   than an empty block, the places in the order they open next. A filter the
   reader picks, Open now included, is shown as asked. */
const nothingOpen = (t) => S.f === 'open' && !S.chose && !S.places.some((r) => isOpen(r, t));
function openingNext(t) {
  return S.places.map((r) => ({ r, nx: hasHours(r) ? F.nextOpening(r.hours, t.day, t.minutes) : null }))
    .filter((x) => x.nx && servesMealOn(x.r, x.nx))
    .sort((a, b) => a.nx.daysAhead - b.nx.daysAhead || F.toMin(a.nx.time) - F.toMin(b.nx.time))
    .map((x) => x.r);
}
/* the meal toggle still applies: the place serves it on the day it opens */
const servesMealOn = (r, nx) => S.meal === 'any' || servesMeal(r, S.meal, nx.day);
/* what the Open now block draws, and what its map pins */
function shownPlaces(t) {
  if (nothingOpen(t)) return { next: true, list: openingNext(t) };
  return { next: false, list: sorted(listFor(S.f, t), t) };
}

/* Breakfast, lunch, dinner: read off today's hours. A place serves the meal
   when it is open for at least half of the meal's window (7 to 10 am,
   11 am to 2 pm, 5 to 9 pm). A window whose close is not after its open
   runs past midnight; the same open and close is around the clock. */
const MEALS = [['any', 'Any time'], ['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner']];
const MEAL_WIN = { breakfast: [7 * 60, 10 * 60], lunch: [11 * 60, 14 * 60], dinner: [17 * 60, 21 * 60] };
function servesMeal(r, meal, day) {
  const w = MEAL_WIN[meal];
  if (!w) return true;
  if (!hasHours(r)) return false;
  const enough = (a, b) => Math.min(b, w[1]) - Math.max(a, w[0]) >= (w[1] - w[0]) / 2;
  const win = (o, c) => { const a = F.toMin(o), b = F.toMin(c); return a === null || b === null ? null : [a, b]; };
  /* last night's window that runs past midnight counts this morning */
  const spill = (r.hours[DAYS[(DAYS.indexOf(day) + 6) % 7]] || []).some(([o, c]) => { const x = win(o, c); return x && x[1] < x[0] && enough(0, x[1]); });
  return spill || (r.hours[day] || []).some(([o, c]) => { const x = win(o, c); return x && enough(x[0], x[1] > x[0] ? x[1] : x[1] + 1440); });
}
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/* The sorts. Nearest Church Street is the list's own order (takePlaces);
   the rest keep it as the tiebreak. */
const PRICE = { '$': 1, '$$': 2, '$$$': 3, '$$$$': 4 };
const SORTS = [
  { key: 'near', label: 'Nearest Church St', sub: 'nearest first' },
  { key: 'me', label: 'Closest to me', sub: 'closest to you' },
  { key: 'late', label: 'Open latest', sub: 'open latest first' },
  { key: 'price', label: 'Price', sub: 'cheapest first' },
  { key: 'new', label: 'Newest', sub: 'newest first', when: () => S.places.some((r) => r.opened) },
];
const sortOf = (k) => SORTS.find((x) => x.key === k) || SORTS[0];
const fromMe = (r) => (S.me && r.coords && r.coords.length === 2 ? miles(r.coords, S.me) : null);
function sorted(list, t) {
  const k = S.sort === 'me' && !S.me ? 'near' : S.sort;
  if (k === 'near') return list;
  const key = {
    me: (r) => { const m = fromMe(r); return m == null ? 1e6 : m; },
    late: (r) => { const c = hasHours(r) ? F.latestCloseTonight(r.hours, t.day) : null; return c == null ? 1e6 : -c; },
    price: (r) => PRICE[r.price] || 9,
    new: (r) => (/^\d{4}-\d{2}/.test(r.opened || '') ? -Number(r.opened.slice(0, 4) + r.opened.slice(5, 7)) : 1e6),
  }[k];
  const at = new Map(list.map((r, i) => [r, i]));
  return list.slice().sort((a, b) => key(a) - key(b) || at.get(a) - at.get(b));
}
const openedText = (ym) => { const [y, m] = String(ym || '').split('-').map(Number); return y && m ? 'opened ' + MONTHS[m - 1] + ' ' + y : ''; };

/* --------------------------------------------------------- the directory */
/* A place's own handle(s), its own posts (newest first, pictures that have
   not lapsed) and the dishes readers sent in for it. */
function handlesOf(r) {
  if (!S.dir) return [];
  return [...new Set(r.aka.map((id) => S.dir.places[id]).filter(Boolean))].filter((h) => !S.dir.notFood.has(h));
}
function foodOf(r) {
  const nowS = Date.now() / 1000;
  const hs = handlesOf(r);
  const posts = hs.flatMap((h) => S.igBy.get(h) || []).filter((p) => pictureOk(p, nowS)).sort((a, b) => b.ts - a.ts);
  return { handle: hs[0] || '', posts, dishes: S.dishBy.get(r.id) || [] };
}
/* the newest of its reader dishes and its own posts */
function thumbOf(f) {
  const d = f.dishes[0], p = f.posts[0];
  const dTs = d ? (Date.parse(d.approved_on || '') / 1000 || 0) : -1;
  if (d && (!p || dTs >= Number(p.ts || 0))) return d.url;
  return p ? p.i : '';
}

/* What it is: the first cuisine that names a kind of food, else the category. */
const NOT_A_KIND = new Set(['lunch', 'outdoor dining', 'other', 'romantic', 'activities']);
function kind(r) {
  const c = (r.cuisine || []).map((x) => String(x).replace(/\s*\(.*$/, '').split(/\s+\/\s+|[,;]/)[0].trim()).find((x) => x && !NOT_A_KIND.has(x.toLowerCase()));
  return trim(c || r.category || '', 32);
}

/* The editorial blurbs, minus the ones that are research notes to ourselves
   ("cafe closed permanently…", hours, a URL): nothing negative, nothing
   half-checked. A reader-facing field in restaurants.json would be better. */
const NOTE_RE = /https?:|\b(the 20\d\d window|per google|unverified|seed|sheet|beehiiv|yelp|confirmed|do not|categori[sz]e|defunct|no longer|closed|permanently|not burlington|reportedly)\b|\b\d{1,2}(:\d\d)?\s?(am|pm)\b|^(opened|opening|grand opening|open|also|company|aimed|hotel|in \w+, not)\b/i;
const cleanBlurb = (r) => (r.blurb && r.blurb.length >= 40 && !NOTE_RE.test(r.blurb) ? r.blurb : '');

/* What to order, when the blurb says: the one sentence that names a dish to
   get ("The Vacation IPA is a reliable starting point."). */
const ORDER_RE = /\b(the standard order|starting point|converts|known for|famous for|signature|get the|try the|go for the|(is|are) mandatory|is the reason)\b/i;
function orderLine(r) {
  const b = cleanBlurb(r);
  if (!b) return '';
  const said = b.split(/(?<=[.!?])\s+/).filter((s) => ORDER_RE.test(s) && s.length <= 120);
  return said.length && said[0] !== b ? said[0] : '';
}

function status(r, t) {
  if (!hasHours(r)) return { open: null, text: 'Hours not checked yet' };
  if (F.isOpenAt(r.hours, t.day, t.minutes)) {
    const allDay = (r.hours[t.day] || []).some(([o, c]) => o === c);
    return { open: true, text: allDay ? 'Open all day and night' : 'Open until ' + clock(F.closingTime(r.hours, t.day, t.minutes)) };
  }
  const nx = F.nextOpening(r.hours, t.day, t.minutes);
  if (!nx) return { open: false, text: 'Not open this week' };
  return { open: false, text: 'Opens ' + clock(nx.time) + (nx.daysAhead === 0 ? '' : nx.daysAhead === 1 ? ' tomorrow' : ' ' + F.DAY_LABELS[nx.day]) };
}

/* The place's own Google page, by its Google place id: the full reviews
   live there, not here. Without an id, its Maps link; without that, a search. */
function googleUrl(r) {
  const q = encodeURIComponent(r.name + (r.address ? ', ' + r.address : ', Burlington VT'));
  if (r.place_id) return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(r.name) + '&query_place_id=' + encodeURIComponent(r.place_id);
  if (r.links && /^https?:/i.test(r.links.google_maps || '')) return r.links.google_maps;
  return 'https://www.google.com/maps/search/?api=1&query=' + q;
}

/* An outbound link. Demo links go nowhere and say so; our own pages open here. */
function outLink(label, href, cls, ours) {
  const a = el('a', cls || 'btn ghost sm', esc(label) + (ours ? '' : ' ' + ICON.ext));
  a.href = safeHref(href);
  if (!ours) { a.target = '_blank'; a.rel = 'noopener'; }
  if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast(label + ' opens in the real build'); });
  return a;
}

/* ---------------------------------------------------------------- render */
function render() {
  root.innerHTML = '';
  slots = Object.create(null);
  SECTIONS.forEach(([k]) => {
    const s = el('div', 'slot');
    s.dataset.sec = k;
    slots[k] = s;
    root.appendChild(s);
  });
  SECTIONS.forEach(([k]) => paint(k));
  root.appendChild(el('div', 'spacer'));
  S.drawn = Date.now();
}

function paint(k) {
  if (!ready || !slots || !slots[k]) return;
  const host = slots[k];
  if (k === 'add' && host.firstChild) return;   // the form is drawn once; a redraw would eat what was typed
  const y = panel() ? panel().scrollTop : 0;
  host.innerHTML = '';
  ({ bite: paintBite, open: paintOpen, deals: paintDeals, asks: paintAsks, best: paintBest, kitchens: paintKitchens, add: paintAdd })[k](host);
  if (panel() && app.activeTab() === KEY) panel().scrollTop = y;
  if (k === 'open' || k === 'deals' || k === 'asks') app.paintSubnav();
}

/* ------------------------------------------------------- the Weekly Bite */
function paintBite(host) {
  if (S.dish === undefined) { host.appendChild(el('p', 'loading', 'Finding this week’s bite…')); return; }
  const p = S.dish;
  if (!p) {
    const tc = el('div', 'textcard gap', '<h3 class="serif">The Weekly Bite starts with you</h3>');
    tc.dataset.k = 'bite';
    const row = el('div', 'row');
    row.appendChild(button('Feature a dish ' + ICON.arrow, '', () => jump('add')));
    tc.appendChild(row);
    host.appendChild(tc);
    return;
  }
  const place = placeByName(p.spot);
  const hero = el('div', 'hero');
  hero.dataset.k = 'bite';
  const home = p.spot === HOME;
  const where = [p.spot, p.area && p.area !== 'Elsewhere' && !home ? p.area : ''].filter(Boolean).join(' · ');
  hero.innerHTML = '<span class="c-media r45" data-zoom>' + art(p.url) + '</span>' +
    '<span class="eyebrow">' + esc('The Weekly Bite') + '</span>' +
    '<h3>' + esc(trim(p.caption, LINE_MAX) || p.spot || 'This week’s dish') + '</h3>' +
    '<p>' + esc([where, p.credit ? 'sent in by ' + p.credit : '', p.label || ''].filter(Boolean).join(' · ')) + '</p>';
  const row = el('div', 'row');
  if (place) row.appendChild(button('The place', 'ghost', () => placeSheet(place)));
  row.appendChild(button('Feature yours', 'ghost', () => jump('add')));
  hero.appendChild(row);
  hero.querySelector('[data-zoom]').addEventListener('click', () => app.lightbox({ media: p.url, title: p.caption, text: p.caption }));
  host.appendChild(hero);
}

function placeByName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (n === HOME.toLowerCase()) return null;
  return n ? S.places.find((r) => r.name.toLowerCase() === n) || null : null;
}

/* ---------------------------------------------------------------- Open now */
function paintOpen(host) {
  const t = now();
  const f = filterOf(S.f);
  const { next, list } = shownPlaces(t);
  const by = S.sort === 'me' && !S.me ? sortOf('near') : sortOf(S.sort);
  section(host, next ? 'Opening next' : 'Open now', '<b>' + esc(plural(list.length, 'place', 'places')) + '</b> · ' + esc(next ? 'soonest first' : by.sub), mapButton(list));
  host.appendChild(chips(FILTERS.map((x) => ({ key: x.key, label: x.label, n: listFor(x.key, t).length })), next ? null : S.f,
    (k) => { S.f = k; S.chose = true; S.all = false; paint('open'); }, 'filters'));
  const tools = el('div', 'toolrow foodtools');
  const meal = pills(MEALS, S.meal, (v) => { S.meal = v; S.all = false; paint('open'); }, 'meals');
  meal.setAttribute('aria-label', 'Meal');
  const sel = el('select', 'field fsort');
  sel.setAttribute('aria-label', 'Sort');
  SORTS.filter((x) => !x.when || x.when()).forEach((x) => {
    const o = el('option', '', esc(x.label));
    o.value = x.key;
    o.selected = x.key === by.key;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => setSort(sel.value));
  tools.append(meal);
  if (!next) tools.appendChild(sel);
  host.appendChild(tools);
  const box = el('div', 'places');
  const shown = S.all ? list : list.slice(0, FIRST_ROWS);
  shown.forEach((r) => box.appendChild(placeRow(r, t)));
  host.appendChild(box);
  if (!list.length) {
    host.appendChild(el('p', 'note pad', esc(next ? 'Nothing opens this week.' : f.key === 'open' || f.key === 'patio' ? 'Nothing open right now.' : 'Nothing fits that today.')));
  } else if (list.length > shown.length) {
    host.appendChild(button('All ' + list.length + ' ' + ICON.arrow, 'ghost more', () => { S.all = true; paint('open'); }));
  }
  const r = el('div', 'addrow linkrow');
  if (list.length <= shown.length) r.appendChild(outLink('All restaurants', GUIDE_URL, 'btn ghost sm', true));
  r.appendChild(button('Feature your restaurant', 'ghost sm owner', () => ownerSheet(null)));
  host.appendChild(r);
}

/* Closest to me asks for the reader's position the first time; if they say
   no (or are nowhere near), the list stays on Church Street and says so. */
function setSort(k) {
  if (k !== 'me') { S.sort = k; S.all = false; paint('open'); return; }
  locate().then(() => { S.sort = 'me'; S.all = false; paint('open'); })
    .catch((e) => {
      S.sort = 'near'; paint('open');
      app.toast(e && e.far ? 'You’re not near Burlington. Sorted from Church St.' : 'Location is off. Sorted from Church St.');
    });
}

/* The reader's position: asked for only on a tap, kept in this module for
   the visit, never written down, never sent anywhere. */
function locate() {
  if (S.me) return Promise.resolve(S.me);
  if (!navigator.geolocation) return Promise.reject(new Error('no location'));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition((pos) => {
      const at = [pos.coords.latitude, pos.coords.longitude];
      if (!at.every(Number.isFinite)) { reject(new Error('no location')); return; }
      if (miles(at, CHURCH_ST) > FAR_MI) { const e = new Error('far'); e.far = true; reject(e); return; }
      S.me = at;
      resolve(at);
    }, reject, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });
}

function placeRow(r, t) {
  const st = status(r, t);
  const row = el('div', 'lrow place');
  row.dataset.k = 'r-' + r.id;
  const mi = S.sort === 'me' && S.me ? fromMe(r) : r.mi;
  const extra = S.sort === 'price' ? r.price : S.sort === 'new' ? openedText(r.opened) : '';
  const meta = [r.neighborhood, kind(r), extra, milesText(mi)].filter(Boolean).map(esc).join(' · ');
  const order = orderLine(r);
  const open = el('button', 'open', '<div class="t">' + esc(r.name) + '</div><div class="s">' + meta + ' · <span class="' + (st.open ? 'ok' : '') + '">' + esc(st.text) + '</span></div>' +
    (order ? '<div class="s">' + esc(order) + '</div>' : ''));
  open.setAttribute('aria-label', r.name + ', ' + st.text + '. More about it');
  open.addEventListener('click', () => placeSheet(r));
  const fd = foodOf(r);
  const pic = thumbOf(fd);
  row.append(pic ? el('span', 'th', art(pic)) : el('span', 'th bare', mark(r.name, 'round')), open);
  const acts = el('div', 'placeacts');
  if (fd.posts.length || fd.dishes.length) {
    const b = el('button', 'pillbtn theirs', esc('Their food'));
    b.setAttribute('aria-label', 'Their food at ' + r.name);
    b.addEventListener('click', () => foodSheet(r));
    acts.appendChild(b);
  }
  const menu = menuOf(r);
  if (menu) {
    const a = outLink('Menu', menu, 'pillbtn');
    a.setAttribute('aria-label', 'Menu for ' + r.name);
    acts.appendChild(a);
  }
  if (acts.children.length) row.appendChild(acts);
  return row;
}

/* ---------------------------------------------------------------- the map */
/* The button's picture is the list itself: a dot per place around Church
   Street (or the reader, once they have allowed it), drawn here with no
   tiles and no library, so it costs nothing until it is tapped. */
function mapButton(list) {
  const c = S.me || CHURCH_ST;
  const W = 72, H = 44, halfLon = 0.022, halfLat = halfLon * Math.cos(c[0] * Math.PI / 180) * H / W;
  const dots = list.filter((r) => r.coords && Math.abs(r.coords[0] - c[0]) < halfLat && Math.abs(r.coords[1] - c[1]) < halfLon).slice(0, 60)
    .map((r) => '<circle class="fm-dot" r="2.2" cx="' + (W / 2 + (r.coords[1] - c[1]) / halfLon * W / 2).toFixed(1) + '" cy="' + (H / 2 - (r.coords[0] - c[0]) / halfLat * H / 2).toFixed(1) + '"/>').join('');
  const b = el('button', 'mapbtn', '<svg class="fm-mini" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><rect class="fm-ground" width="' + W + '" height="' + H + '"/>' +
    '<path class="fm-street" d="M0 ' + H / 2 + 'H' + W + 'M' + W / 2 + ' 0V' + H + '"/>' + dots + '<circle class="fm-here" r="3.6" cx="' + W / 2 + '" cy="' + H / 2 + '"/></svg><span>' + esc('Map') + '</span>');
  b.setAttribute('aria-label', 'Map of ' + plural(list.length, 'place', 'places'));
  b.addEventListener('click', () => openMap());
  return b;
}

let leafletP = null;
function loadLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (!leafletP) {
    if (!document.querySelector('link[data-leaflet]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = LEAFLET.css; css.integrity = LEAFLET.cssSri; css.crossOrigin = '';
      css.dataset.leaflet = '1';
      document.head.appendChild(css);
    }
    leafletP = new Promise((resolve, reject) => {
      const js = document.createElement('script');
      js.src = LEAFLET.js; js.integrity = LEAFLET.jsSri; js.crossOrigin = '';
      js.onload = () => (window.L && window.L.map ? resolve(window.L) : reject(new Error('no Leaflet')));
      js.onerror = () => { leafletP = null; js.remove(); reject(new Error('no Leaflet')); };
      document.head.appendChild(js);
    });
  }
  return leafletP;
}

let M = null;                // the Leaflet map while its sheet is up
function dropMap() { if (M) { try { M.remove(); } catch (e) { /* already gone */ } M = null; } }

function openMap() {
  const t = now();
  const f = filterOf(S.f);
  const shown = shownPlaces(t);
  const list = shown.list.filter((r) => r.coords && r.coords.length === 2);
  app.sheet('Map', (body) => {
    body.appendChild(el('p', 'sheet-note', '<b>' + esc(plural(list.length, 'place', 'places')) + '</b> · ' + esc(shown.next ? 'opening next' : f.label.toLowerCase())));
    const box = el('div', 'foodmap');
    box.dataset.k = 'map';
    const bar = el('div', 'linkrow');
    const near = button(ICON.pin + ' ' + esc('Near me'), 'ghost sm nearme', () => {
      locate().then(() => { placeMe(); paint('open'); })
        .catch((e) => app.toast(e && e.far ? 'You’re not near Burlington.' : 'Location is off.'));
    });
    bar.appendChild(near);
    body.append(box, bar);
    dropMap();
    loadLeaflet().then((L) => {
      if (!box.isConnected) return;
      M = L.map(box, { zoomControl: true, attributionControl: true }).setView(CHURCH_ST, S.me ? 14 : 15);
      L.tileLayer(TILES, { maxZoom: 19, attribution: TILE_CREDIT }).addTo(M);
      list.forEach((r) => {
        const pin = L.circleMarker(r.coords, { radius: 7, weight: 2, className: 'fm-pin' + (isOpen(r, t) ? ' open' : '') }).addTo(M);
        pin.bindTooltip(esc(r.name));
        pin.on('click', () => placeSheet(r));
      });
      if (S.me) placeMe();
      else if (navigator.permissions && navigator.permissions.query) {
        /* already allowed on an earlier visit: no need to ask again */
        navigator.permissions.query({ name: 'geolocation' }).then((p) => { if (p.state === 'granted') locate().then(() => { placeMe(); paint('open'); }).catch(() => {}); }).catch(() => {});
      }
      setTimeout(() => { if (M) M.invalidateSize(); }, 80);
    }).catch(() => {
      if (box.isConnected) box.replaceWith(el('p', 'note pad', esc('The map didn’t load.')));
    });
  });
}

/* the reader's own dot, and the map turned to it */
let mePin = null;
function placeMe() {
  if (!M || !S.me || !window.L || !M.getContainer().isConnected) return;
  if (mePin) { try { mePin.remove(); } catch (e) { /* gone with its map */ } }
  mePin = window.L.circleMarker(S.me, { radius: 8, weight: 3, className: 'fm-me', interactive: false }).addTo(M);
  /* the map stays on Church Street and the dot is drawn here: turning the
     map to the reader would ask the tile server for their neighbourhood */
  M.setZoom(14);
  const near = document.querySelector('.sheet-body .nearme');
  if (near) near.hidden = true;
}

function placeSheet(r) {
  const t = now();
  app.sheet(r.name, (body) => {
    const st = status(r, t);
    body.appendChild(el('p', 'sheet-note', esc([r.neighborhood, kind(r), r.price, r.mi == null ? '' : r.mi < 0.1 ? 'on Church St' : milesText(r.mi) + ' from Church St'].filter(Boolean).join(' · '))));
    const blurb = cleanBlurb(r);
    if (blurb) body.appendChild(el('p', 'pick-why', esc(blurb)));

    body.appendChild(el('div', 'sheet-h', esc('Today, ' + F.DAY_LABELS[t.day])));
    const today = el('div', 'sheet-row');
    if (hasHours(r)) {
      const wins = (r.hours[t.day] || []).map(([o, c]) => (o === c ? 'Open around the clock' : clock(o) + ' – ' + clock(c)));
      const kc = r.kitchen_close && r.kitchen_close[t.day];
      today.innerHTML = '<div class="t">' + esc(wins.length ? wins.join(', ') : 'Not open today') +
        '<div class="d">' + esc([/all day and night/.test(st.text) ? '' : st.text, kc && wins.length ? 'kitchen until ' + clock(kc) : ''].filter(Boolean).join(' · ')) + '</div></div>';
    } else {
      today.innerHTML = '<div class="t">' + esc('Hours not checked yet') + '<div class="d">' + esc('Check with them before you go.') + '</div></div>';
    }
    body.appendChild(today);

    const ds = dealsAt(r);
    if (ds.length) {
      body.appendChild(el('div', 'sheet-h', esc(ds.length === 1 ? 'A deal here' : 'Deals here')));
      ds.forEach((d) => {
        const when = [F.dealDaysLabel(d), F.dealTimeLabel(d)].filter(Boolean).join(' · ').replace(/\b(\d{1,2}(?::\d{2})?) (AM|PM)\b/g, (m0, n, ap) => n + ' ' + ap.toLowerCase());
        body.appendChild(el('div', 'sheet-row', '<div class="t">' + esc(d.title) + '<div class="d">' + esc([when, verified(d.last_verified, t)].filter(Boolean).join(' · ')) + '</div></div>'));
      });
    }

    const links = el('div', 'linkrow');
    const menu = menuOf(r);
    if (menu) links.appendChild(outLink('Menu', menu, 'btn sm'));
    if (r.links && /^https?:/i.test(r.links.website || '')) links.appendChild(outLink('Website', r.links.website));
    const g = outLink('Full reviews on Google', googleUrl(r));
    g.classList.add('google');
    links.appendChild(g);
    links.appendChild(button(ICON.share + ' Share', 'ghost sm', () => app.share(KEY, 'r-' + r.id, r.name)));
    body.appendChild(links);
    const own = el('div', 'linkrow');
    const fd = foodOf(r);
    if (fd.posts.length || fd.dishes.length) own.appendChild(button('Their food', 'ghost sm theirs', () => foodSheet(r)));
    own.appendChild(button('Feature your restaurant', 'ghost sm owner', () => ownerSheet(r)));
    body.appendChild(own);
  });
}

/* Their food: the place in its own words. Dishes readers sent in through the
   Weekly Bite first (a place with no Instagram still has these), then its
   own posts and reels. A reel plays in the shell's one video box. */
function foodSheet(r) {
  const fd = foodOf(r);
  app.sheet(r.name, (body, card, close) => {
    card.classList.add('theirfood');
    const grid = el('div', 'fgrid');
    fd.dishes.forEach((d) => grid.appendChild(dishTile(d)));
    fd.posts.slice(0, RAIL_MAX).forEach((p) => grid.appendChild(postTile(p, close)));
    body.appendChild(grid.children.length ? grid : el('p', 'sheet-note', esc('No dishes here yet.')));
    const links = el('div', 'linkrow');
    if (fd.handle) links.appendChild(outLink('@' + fd.handle, 'https://www.instagram.com/' + encodeURIComponent(fd.handle) + '/', 'btn ghost sm insta'));
    links.appendChild(button('Feature a dish', 'ghost sm', () => { close(); jump('add'); }));
    links.appendChild(button('Feature your restaurant', 'ghost sm owner', () => ownerSheet(r)));
    body.appendChild(links);
  });
}

function dishTile(d) {
  const b = el('button', 'ftile dish', '<span class="c-media r11">' + art(d.url) + '</span><span class="s">' +
    esc([trim(d.caption, 60), d.credit ? 'sent in by ' + d.credit : ''].filter(Boolean).join(' · ')) + '</span>');
  b.dataset.k = 'dish-' + String(d.id || '');
  b.setAttribute('aria-label', trim(d.caption, 60) || 'A dish');
  b.addEventListener('click', () => app.lightbox({ media: d.url, title: d.caption, text: d.caption }));
  return b;
}

function postTile(p, close) {
  const clip = hasClip(p, Date.now() / 1000);
  const a = el('a', 'ftile post' + (clip ? ' clip' : ''), '<span class="c-media r11">' + art(p.i) + (clip ? '<span class="play">' + ICON.play + '</span>' : '') + '</span>' +
    '<span class="s">' + esc([trim(p.c, 50), when(p)].filter(Boolean).join(' · ')) + '</span>');
  a.href = safeHref(p.u);
  a.dataset.k = keyOf(p);
  if (clip) {
    a.setAttribute('aria-label', 'Play the video from ' + who(p));
    a.addEventListener('click', (e) => { e.preventDefault(); close(); openClip(p); });
  } else {
    a.target = '_blank'; a.rel = 'noopener';
    if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the post on Instagram in the real build'); });
  }
  return a;
}

/* Owners: send a clip of your own dishes, we add it free. A mailto, no form. */
function ownerSheet(r) {
  app.sheet('Feature your restaurant', (body) => {
    body.appendChild(el('p', 'sheet-note', esc('Send a clip of your own dishes. We add it free.')));
    const row = el('div', 'linkrow');
    const a = el('a', 'btn mailto', ICON.mail + ' ' + esc('Email a clip'));
    a.href = 'mailto:' + OWNER_MAIL + '?subject=' + encodeURIComponent('Feature my restaurant' + (r ? ': ' + r.name : ''));
    row.appendChild(a);
    body.appendChild(row);
  });
}

/* ------------------------------------------------------------------- Deals */
/* Today's deals in deck order: happening now, then later today by start
   time, then the untimed ones. A window that has already closed today is
   left out. */
function deck(t) {
  /* a Thursday 10 pm to 1 am deal is still on at 12:30 Friday morning */
  const out = (S.deals || []).filter((d) => F.dealAppliesToday(d, t) || F.dealLiveNow(d, t)).map((d) => {
    const s = F.toMin(d.start), e = F.toMin(d.end);
    const live = F.dealLiveNow(d, t);
    const over = !live && !d.all_day && s !== null && e !== null && e > s && t.minutes >= e;
    return over ? null : { d, live, s, e, r: S.byId[d.restaurant_id] || null };
  }).filter(Boolean);
  const rank = (x) => (x.live ? 0 : x.s !== null && x.s > t.minutes ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || (a.s == null ? 9999 : a.s) - (b.s == null ? 9999 : b.s) || a.d.business.localeCompare(b.d.business));
}

function eyebrowOf(x) {
  const span = x.d.start && x.d.end ? clock(x.d.start) + '–' + clock(x.d.end) : '';
  if (x.live) return 'Happening now · ' + (x.d.all_day ? 'all day' : 'until ' + clock(x.d.end));
  if (span) return 'Later today · ' + span;
  return 'Today';
}

function paintDeals(host) {
  const t = now();
  const all = deck(t);
  const cards = all.slice(0, DECK_MAX);
  const every = outLink('See all deals', DEALS_PAGE, 'btn ghost sm alldeals', true);
  section(host, 'Deals today', all.length ? '<b>' + esc(plural(all.length, 'deal', 'deals')) + '</b> · now first' : null, every);
  if (!cards.length) {
    host.appendChild(el('p', 'note pad', esc(S.staleDeals ? 'No recently verified deals today.' : 'No deals on today.')));
    return;
  }
  if (S.deal > cards.length) S.deal = 0;
  const box = el('div', 'deck deals');
  box.setAttribute('role', 'region');
  box.setAttribute('aria-roledescription', 'deck');
  box.setAttribute('aria-label', 'Deals today');
  const n = cards.length + 1;                      // the deals, then the end card
  const go = (i) => { S.deal = (i + n) % n; draw(); };
  const draw = () => {
    const i = S.deal;
    const segs = '<div class="segs">' + Array.from({ length: n }, (_, j) => '<i class="' + (j <= i ? 'on' : '') + '"></i>').join('') + '</div>';
    const hits = '<button class="hit l" aria-label="Previous deal"></button><button class="hit r" aria-label="Next deal"></button>' +
      '<button class="next" tabindex="-1" aria-hidden="true">' + ICON.right + '</button>';
    if (i === cards.length) {
      box.dataset.k = 'deals-end';
      box.innerHTML = tint('deals-end') + segs + '<div class="body"><h3>' + esc('That’s all.') + '</h3><div class="row"></div></div>' + hits;
      box.querySelector('.row').append(outLink('All the deals', DEALS_PAGE, 'btn ghost sm', true), button('Start over', 'ghost sm', () => go(0)));
    } else {
      const x = cards[i];
      box.dataset.k = 'd-' + x.d.id;
      const where = [x.d.business, x.r && x.r.neighborhood].filter(Boolean).join(' · ');
      const pic = x.r ? thumbOf(foodOf(x.r)) : '';
      box.innerHTML = (pic ? art(pic) : tint(x.d.id)) + segs + '<div class="body"><div class="eyebrow">' + esc(eyebrowOf(x)) + '</div><h3>' + esc(x.d.title) + '</h3>' +
        '<p>' + esc(where) + '</p><p class="verified">' + esc(verified(x.d.last_verified, t)) + '</p><div class="row"></div></div>' + hits;
      const row = box.querySelector('.row');
      if (x.r) row.appendChild(button('The place', 'ghost sm', () => placeSheet(x.r)));
      if (/^https?:/i.test(x.d.link || '')) row.appendChild(outLink('Details', x.d.link));
    }
    box.querySelector('.hit.l').addEventListener('click', () => go(S.deal - 1));
    box.querySelector('.hit.r').addEventListener('click', () => go(S.deal + 1));
    box.querySelector('.next').addEventListener('click', () => go(S.deal + 1));
  };
  draw();
  box.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { go(S.deal + 1); box.querySelector('.hit.r').focus(); }
    else if (e.key === 'ArrowLeft') { go(S.deal - 1); box.querySelector('.hit.l').focus(); }
  });
  host.appendChild(box);
}

/* A deal has no picture of its own: each card is two of the shell's
   source-mark hues, picked by its id, so the same deal is always the same
   colour and neighbours differ. */
function tint(id) {
  let h = 7;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % 8, b = (a + 3) % 8;
  return '<span class="ph" style="--p1:var(--mark-' + a + ');--p2:var(--mark-' + b + ');--p3:var(--lightbox)"></span>';
}

/* --------------------------------------------------------- Asked on Reddit */
/* The threads asking where to eat or drink, newest first, as the shell's
   rows: the thread's title, its subreddit and age, and its comment count
   once the intake carries one. Mutes are the Wire's (r-burlington,
   r-vermont), so muting r/burlington anywhere quiets it here too. */
const askItem = (a) => ({ k: a.k, kind: 'headline', href: a.url, title: a.title, src: a.sub, sid: a.sid, local: true,
  ago: agoShort(a.d), d: a.d, comments: a.comments == null ? '' : a.comments, open: 'Open the thread' });
const asksShown = () => (S.asks || []).filter((a) => !store.isMuted(a.sid));

function paintAsks(host) {
  const sub = outLink('r/burlington', SUB_URL, 'btn ghost sm');
  if (!S.asks) {
    section(host, 'Asked on Reddit', null, sub);
    host.appendChild(S.asksFailed ? el('p', 'note pad', esc('Didn’t load. Try again later.')) : el('p', 'loading', 'Loading the threads…'));
    return;
  }
  const list = asksShown();
  section(host, 'Asked on Reddit', list.length ? '<b>' + esc(plural(list.length, 'thread', 'threads')) + '</b> · newest first' : null, sub);
  if (!list.length) { host.appendChild(el('p', 'note pad', esc(S.asks.length ? 'You muted these subreddits.' : 'No new food questions.'))); return; }
  const items = app.know(list.map(askItem));
  const feed = el('div', 'feed asks');
  items.forEach((it) => put(feed, feedCards.row(it, { noComments: it.comments === '', greenLocal: true })));
  app.bindFeed(feed);
  host.appendChild(feed);
}

/* ---------------------------------------------------- Best of r/burlington */
/* The questions r/burlington keeps asking, most asked first, a card each.
   A card opens its threads; the answers are in them, one tap away. */
function paintBest(host) {
  if (!S.best) {
    section(host, 'Best of r/burlington');
    host.appendChild(S.bestFailed ? el('p', 'note pad', esc('Didn’t load. Try again later.')) : el('p', 'loading', 'Loading the questions…'));
    return;
  }
  if (S.bestGroup !== 'all' && !S.best.some((q) => q.group === S.bestGroup)) S.bestGroup = 'all';
  const list = S.best.filter((q) => S.bestGroup === 'all' || q.group === S.bestGroup);
  section(host, 'Best of r/burlington', '<b>' + esc(plural(list.length, 'question', 'questions')) + '</b> · most asked first');
  const kinds = [['all', 'All']].concat(GROUPS.filter(([g]) => S.best.some((q) => q.group === g)).map(([g, label]) => [g, label]));
  const tools = el('div', 'toolrow foodtools');
  const p = pills(kinds, S.bestGroup, (v) => { S.bestGroup = v; S.bestAll = false; paint('best'); }, 'kinds');
  p.setAttribute('role', 'group');
  p.setAttribute('aria-label', 'Food, coffee or drinks');
  tools.appendChild(p);
  host.appendChild(tools);
  const grid = el('div', 'qgrid');
  const shown = S.bestAll ? list : list.slice(0, Q_FIRST);
  shown.forEach((q) => grid.appendChild(qCard(q)));
  host.appendChild(grid);
  if (list.length > shown.length) host.appendChild(button('All ' + list.length + ' ' + ICON.arrow, 'ghost more', () => { S.bestAll = true; paint('best'); }));
}

/* A card is a link to its newest thread (rule 4: every item has a URL), and
   a plain tap opens the sheet with all of them; a modified click (new tab)
   goes straight to the thread. */
function qCard(q) {
  const a = el('a', 'qcard', '<span class="t">' + esc(q.q) + '</span><span class="s">' +
    esc([q.sd ? 'Seven Daysies: ' + q.sd.pick : '', plural(q.threads.length, 'thread', 'threads')].filter(Boolean).join(' · ')) + '</span>');
  a.href = safeHref(q.threads[0].url);
  a.target = '_blank';
  a.rel = 'noopener';
  a.dataset.k = q.k;
  a.setAttribute('aria-label', q.q + ', ' + plural(q.threads.length, 'thread', 'threads') + ' on r/burlington');
  a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    e.preventDefault();
    qSheet(q);
  });
  return a;
}

/* a link out of the sheet: the thread, or Seven Days' page */
function sheetLink(title, sub, href) {
  const a = el('a', 't', esc(title) + ' ' + ICON.ext + '<div class="d">' + esc(sub) + '</div>');
  a.href = safeHref(href);
  a.target = '_blank';
  a.rel = 'noopener';
  if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the page in the real build'); });
  const row = el('div', 'sheet-row');
  row.appendChild(a);
  return row;
}

function qSheet(q) {
  app.sheet(q.q, (body) => {
    body.appendChild(el('div', 'sheet-h', esc(q.threads.length === 1 ? 'Asked on r/burlington' : 'Asked on r/burlington ' + q.threads.length + ' times')));
    q.threads.forEach((t) => body.appendChild(sheetLink(t.label, ['r/burlington', t.year].filter(Boolean).join(' · '), t.url)));
    if (q.sd) {
      body.appendChild(el('div', 'sheet-h', esc('Seven Daysies ' + q.sd.year)));
      body.appendChild(sheetLink(q.sd.pick, 'Seven Days readers’ pick', q.sd.url));
    }
    const links = el('div', 'linkrow');
    links.appendChild(button(ICON.share + ' Share', 'ghost sm', () => app.share(KEY, q.k, q.q)));
    body.appendChild(links);
  });
}

/* ------------------------------------------------------- In their own words */
const sigExpiry = (u) => { const m = /[?&]oe=([0-9a-f]+)/i.exec(String(u || '')); return m ? parseInt(m[1], 16) : null; };
const pictureOk = (p, nowS) => { const e = sigExpiry(p.i); return e === null || e > nowS; };
/* food: tagged by the builder, tagged in the roster, or a place's own
   account in the directory; never one the directory says is not food */
const isFood = (p) => {
  const h = handle(p.h);
  if (S.dir && S.dir.notFood.has(h)) return false;
  return p.f === 1 || !!(S.foodSet && S.foodSet.has(h)) || !!(S.dir && S.dir.handles.has(h));
};
const keyOf = (p) => { const m = /\/(?:p|reel)\/([A-Za-z0-9_-]+)/.exec(p.u); return 'ig-' + (m ? m[1] : p.h + '-' + p.ts); };
const hasClip = (p, nowS) => typeof p.vu === 'string' && /^https:\/\//.test(p.vu) && Number(p.ve) - nowS > VIDEO_MARGIN;

function paintKitchens(host) {
  if (!S.posts || !S.foodSet || !S.dir) {
    section(host, 'In their own words');
    host.appendChild(S.igFailed ? el('p', 'note pad', esc('Didn’t load. Try again later.')) : el('p', 'loading', 'Loading the kitchens…'));
    return;
  }
  const nowS = Date.now() / 1000;
  const food = S.posts.filter((p) => isFood(p) && pictureOk(p, nowS)).sort((a, b) => b.ts - a.ts);
  const clipsList = food.filter((p) => hasClip(p, nowS)).slice(0, RAIL_MAX);
  if (clipsList.length) {
    section(host, 'In their own words');
    const r = rail(host);
    clipsList.forEach((p) => r.appendChild(clipCard(p)));
    return;
  }
  section(host, 'In their own words');
  if (!food.length) { host.appendChild(el('p', 'note pad', 'Nothing new this week.')); return; }
  const r = rail(host);
  food.slice(0, RAIL_MAX).forEach((p) => r.appendChild(photoCard(p)));
}

const who = (p) => trim('@' + p.h, 18);
const when = (p) => (Number(p.ts) ? agoShort(p.ts) : '');

function clipCard(p) {
  const c = el('a', 'vcard vert clip');
  c.href = safeHref(p.u);
  c.dataset.k = keyOf(p);
  c.innerHTML = '<span class="c-media">' + art(p.i) + '<span class="play">' + ICON.play + '</span>' + (p.vd ? '<span class="dur">' + esc(mmss(p.vd)) + '</span>' : '') + '</span>' +
    '<span class="t">' + esc(who(p)) + '</span><span class="s">' + esc([trim(p.c, 60), when(p)].filter(Boolean).join(' · ')) + '</span>';
  c.setAttribute('aria-label', 'Play the video from ' + who(p));
  c.addEventListener('click', (e) => { e.preventDefault(); openClip(p); });
  return c;
}

function photoCard(p) {
  const c = el('a', 'vcard w150');
  c.href = safeHref(p.u);
  c.target = '_blank';
  c.rel = 'noopener';
  c.dataset.k = keyOf(p);
  c.innerHTML = '<span class="c-media r11">' + art(p.i) + '</span><span class="t">' + esc(who(p)) + '</span><span class="s">' + esc([trim(p.c, 50), when(p)].filter(Boolean).join(' · ')) + '</span>';
  if (app.demo) c.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the post on Instagram in the real build'); });
  return c;
}

/* A reel is an MP4, not a YouTube id: it plays in the shell's one video
   box through app.showClip(), started by the tap, 9:16, with the box's link
   pointing back to the post on Instagram. */
function openClip(p) {
  app.showClip({ src: p.vu, poster: p.i, title: who(p) + (p.c ? ' · ' + trim(p.c, 60) : ''), href: p.u, vertical: true });
}

/* ---------------------------------------------------------- Feature a dish */
const AREA_OF = { 'Essex': 'Essex / Essex Jct', 'Burlington': 'Greater Burlington' };
/* a dish made at home: its spot, in the queue's existing field */
const HOME = 'Made at home';
const NEGATIVE = /\b(worst|terrible|awful|gross|disgusting|overpriced|bland|rude|avoid|never again|inedible|mid)\b/i;

function paintAdd(host) {
  section(host, 'Feature a dish');
  const tc = el('div', 'textcard');
  tc.dataset.k = 'add-form';
  const form = el('form', 'dish');
  form.noValidate = true;
  const names = S.places.map((r) => '<option value="' + esc(r.name) + '"></option>').join('');
  form.innerHTML =
    '<p class="note">' + esc('A dish you loved somewhere, or one you made at home.') + '</p>' +
    '<div class="row where"></div>' +
    '<div class="row"><button type="button" class="btn ghost pick">' + ICON.plus + ' ' + esc('Choose a photo') + '</button><span class="note fname">' + esc('No photo yet') + '</span>' +
      '<input type="file" name="file" accept="image/*" hidden></div>' +
    '<div class="row"><input class="field" name="line" maxlength="' + LINE_MAX + '" placeholder="' + esc('One line: what it is, and why') + '" aria-label="One line about the dish" autocomplete="off"></div>' +
    '<div class="row placerow"><input class="field" name="place" list="food-places" maxlength="120" placeholder="' + esc('The place') + '" aria-label="The place" autocomplete="off">' +
      '<datalist id="food-places">' + names + '</datalist></div>' +
    '<div class="row"><input class="field" name="credit" maxlength="60" placeholder="' + esc('Your first name, for the credit (optional)') + '" aria-label="Your name for the credit" autocomplete="given-name"></div>' +
    '<div class="row"><label class="consent"><input type="checkbox" name="consent"> ' + esc('I took this photo, and the Brief may feature it on the site and in the newsletter.') + '</label></div>' +
    '<div class="row"><button type="submit" class="btn send">' + esc('Send it in') + '</button></div>' +
    '<p class="note err" role="alert" hidden></p>';
  /* at a place, or made at home: home needs no place */
  form.dataset.where = 'place';
  const placeRow = form.querySelector('.placerow');
  const where = pills([['place', 'At a place'], ['home', 'Made at home']], 'place', (v) => {
    form.dataset.where = v;
    placeRow.hidden = v === 'home';
  });
  where.setAttribute('role', 'group');
  where.setAttribute('aria-label', 'Where the dish is from');
  form.querySelector('.where').appendChild(where);
  const file = form.querySelector('input[type=file]');
  form.querySelector('.pick').addEventListener('click', () => file.click());
  file.addEventListener('change', () => { form.querySelector('.fname').textContent = file.files[0] ? file.files[0].name : 'No photo yet'; });
  form.addEventListener('submit', (e) => { e.preventDefault(); submitDish(form); });
  tc.appendChild(form);
  host.appendChild(tc);
}

function submitDish(form) {
  const err = form.querySelector('.err');
  const say = (msg) => { err.textContent = msg; err.hidden = !msg; };
  const fd = new FormData(form);
  const file = form.querySelector('input[type=file]').files[0];
  const line = String(fd.get('line') || '').replace(/\s+/g, ' ').trim();
  const home = form.dataset.where === 'home';
  const place = home ? HOME : String(fd.get('place') || '').replace(/\s+/g, ' ').trim();
  const credit = String(fd.get('credit') || '').replace(/\s+/g, ' ').trim();
  if (!file || !file.size) return say('Choose a photo first.');
  if (!/^image\//.test(file.type || 'image/')) return say('That file isn’t a photo.');
  if (!line) return say('Add one line about it.');
  if (NEGATIVE.test(line)) return say('We only feature what you’d recommend.');
  if (!place) return say('Which place is it from?');
  if (!fd.get('consent')) return say('Tick the box first.');
  say('');
  const send = form.querySelector('.send');
  if (app.demo) {
    form.reset();
    form.querySelector('.fname').textContent = 'No photo yet';
    app.toast('Demo: nothing was sent.');
    return;
  }
  send.disabled = true;
  send.textContent = 'Sending…';
  const r = placeByName(place);
  script(PHOTOS_LIB).then(async () => {
    const P = window.BTBP;
    const hood = r && r.neighborhood ? (AREA_OF[r.neighborhood] || r.neighborhood) : '';
    const area = P.AREAS.includes(hood) ? hood : 'Greater Burlington';
    const blob = await P.resizeImage(file);
    const path = await P.uploadBlob(blob);
    await P.rpc('btb_photos_submit', {
      p_path: path, p_caption: line.slice(0, LINE_MAX), p_category: 'dish', p_area: area, p_spot: place.slice(0, 120),
      p_taken: '', p_name: credit.slice(0, 60), p_permission: true, p_ai: false, p_voter: store.playerId(),
    });
  }).then(() => {
    form.reset();
    form.querySelector('.fname').textContent = 'No photo yet';
    send.disabled = false;
    send.textContent = 'Send it in';
    say('');
    app.toast('Sent. It shows once reviewed.');
  }).catch((e) => {
    send.disabled = false;
    send.textContent = 'Send it in';
    const m = String((e && e.message) || '');
    say(/category|check constraint/i.test(m) ? 'The dish queue isn’t open yet. Try again soon.'
      : /waiting for review|queue is full/i.test(m) ? m.charAt(0).toUpperCase() + m.slice(1) + '.'
        : 'That didn’t send. Try again in a minute.');
  });
}

/* ------------------------------------------------------------------- bits */
const panel = () => (root ? root.closest('.panel') : null);
function jump(k) { if (slots && slots[k]) app.jumpTo(slots[k]); }

/* #food/bite|open|deals|asks|best|kitchens|add jumps to a section; #food/map opens
   the map; a filter key
   (late, patio, hh, cheap, deal) sets the filter; r-<id> opens a place;
   d-<id> turns the deck to that deal; ig-<code> a kitchen's post; q-<id>
   opens a Best of question; a thread's URL flashes its Reddit ask. */
function land() {
  if (!pending || !ready) return;
  const k = pending; pending = null;
  if (SECTIONS.some(([s]) => s === k) && k !== 'open') { jump(k); return; }
  if (k === 'map') { jump('open'); openMap(); return; }
  if (FILTERS.some((f) => f.key === k)) { S.f = k; S.chose = true; S.all = false; paint('open'); jump('open'); return; }
  if (/^q-/.test(k)) {
    if (!S.best && !S.bestFailed) { pending = k; return; }   // still loading: land when it arrives
    const q = (S.best || []).find((x) => x.k === k);
    if (!q) { app.toast('That question isn’t in the list any more.'); return; }
    if (!slots.best.querySelector('[data-k="' + CSS.escape(k) + '"]')) { S.bestGroup = 'all'; S.bestAll = true; paint('best'); }
    app.flashHit(root, k);
    qSheet(q);
    return;
  }
  if (/^https:\/\/(www\.|old\.)?reddit\.com\//.test(k)) {
    const a = (S.asks || []).find((x) => x.k === k);
    /* still loading, or a refetch is under way that may bring it: land when it arrives */
    if ((!S.asks && !S.asksFailed) || (!a && S.asksLoading)) { pending = k; return; }
    if (a && store.isMuted(a.sid)) { app.toast('You muted ' + a.sub + '.'); return; }
    if (!app.flashHit(root, k)) app.toast('That thread has moved on.');
    return;
  }
  if (/^r-/.test(k)) {
    const r = S.byId[k.slice(2)];
    if (!r) { app.toast('That place isn’t in the guide any more.'); return; }
    const key = 'r-' + r.id;                       // an old id lands on the place it became
    if (!slots.open.querySelector('[data-k="' + CSS.escape(key) + '"]')) {
      const t = now();
      const f = FILTERS.find((x) => x.test(r, t));
      S.f = f ? f.key : S.f; S.chose = true; S.all = true; paint('open');
    }
    app.flashHit(root, key);
    placeSheet(r);
    return;
  }
  if (/^d-/.test(k)) {
    const i = deck(now()).slice(0, DECK_MAX).findIndex((x) => 'd-' + x.d.id === k);
    if (i < 0) { app.toast('That deal isn’t on today.'); return; }
    S.deal = i; paint('deals');
    app.flashHit(root, k);
    return;
  }
  if (!app.flashHit(root, k)) app.toast('That one has moved on.');
}

app.register(KEY, {
  label: 'Food',
  icon: ICON.food,
  promise: 'Where to eat right now, the deals worth crossing town for, what Burlington recommends, and the kitchens in their own words.',
  mount(r) {
    root = r;
    r.innerHTML = '<p class="loading">Checking who’s open…</p>';
    load().then(() => {
      ready = true;
      render();
      if (app.activeTab() === KEY) app.paintSubnav();
      land();
    }).catch(() => { r.innerHTML = '<div class="errbox"><b>Food didn’t load.</b></div>'; });
  },
  activate(param) {
    pending = param || null;
    /* the list is about this minute: coming back later redraws it */
    if (ready && Date.now() - S.drawn > STALE_MS) { paint('open'); paint('deals'); S.drawn = Date.now(); }
    if (ready && !app.demo && Date.now() - S.asksAt > ASKS_STALE) loadAsks();
    land();
  },
  refresh() { if (ready) { paint('bite'); paint('open'); paint('deals'); paint('asks'); paint('best'); paint('kitchens'); } },
  deactivate() { app.closeVideo(); if (M && !M.getContainer().isConnected) dropMap(); },
  subnav() {
    if (!ready) return null;
    const t = now();
    const next = nothingOpen(t);
    return chips(SECTIONS.map(([key, label]) => ({
      key, label: key === 'open' && next ? 'Opening next' : label,
      n: key === 'open' ? (next ? null : listFor('open', t).length) : key === 'deals' ? deck(t).length : key === 'asks' && S.asks ? asksShown().length : null,
    })), null, (k) => jump(k));
  },
  /* The Reddit asks are the one part that grows while you are away. */
  newSince(ts) { return S.asks ? asksShown().filter((a) => a.d > Number(ts || 0)).length : 0; },
});
