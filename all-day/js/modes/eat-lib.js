/* eat-lib.js — what the Eat app's three food tabs share (wave 1,
   2026-10-29): Open now (eat-open.js, under the `food` route), Deals
   (deals.js) and Bites (bites.js). All Day's Food tab (food.js) drew these
   as one long page; Eat splits it into three tabs, so the data, the hours
   engine and the place's sheet live here once and each tab draws its part.
   The code is food.js's, moved, with the same rules: we feature, we don't
   review. No stars, no scores, no rankings, nothing negative; every place
   links out to its Google page for the full reviews.

   Loading, as food.js did it: the places, the deals and the hours engine
   (js/food-lib.js) first, since every tab needs them; then the menus, the
   Instagram roster and posts, the directory, the reader dishes, the Reddit
   asks, Best of r/burlington and the Health Department inspections fill
   in as they land. A tab subscribes with onData(fn) and repaints its own
   part; nothing is fetched twice, whichever tab opens first.

   Inspections (data/eat/inspections.json, the eat-data lane): a place's
   latest Vermont Department of Health inspection, the date, its age in
   plain words, and each violation in the plain-English key
   (data/eat/inspection-key.json), with the day we checked on every record.
   Never the score: the state's number is in the data, and it stays there.

   ?demo=1 reads All Day's own data/demo/food.json (the same invented
   places and deals, read only) and data/demo/eat-inspections.json. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import { el, esc, safeHref, ICON, art, button, agoShort } from '../ui.js';
import { asksFrom, directoryFrom } from '../food-asks.js';

/* the route the place sheet shares under: Open now, which keeps food's */
export const KEY = 'food';
const RESTAURANTS_URL = '../data/restaurants.json';
const DEALS_URL = '../data/deals.json';
const MENUS_URL = '../data/small-bites.json';
const ROSTER_URL = '../data/instagram-handles.json';
const INSPECTIONS_URL = '../data/eat/inspections.json';
const INSP_KEY_URL = '../data/eat/inspection-key.json';
const FOOD_LIB = '../js/food-lib.js';
export const PHOTOS_LIB = '../js/photos-lib.js';
export const GUIDE_URL = '../restaurants.html';
export const DEALS_PAGE = '../restaurants.html?view=deals';
export const SMALL_BITES_PAGE = '../small-bites.html';
const DIRECTORY_URL = './data/food-directory.json';
const INTAKE_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/reddit-data/data/reddit-intake.json';
const BESTOF_URL = '../data/best-of-reddit.json';
const OWNER_MAIL = 'btownbrief@gmail.com';
export const CHURCH_ST = [44.4758, -73.2128];
const RAIL_MAX = 12;
export const LINE_MAX = 140;
const VIDEO_MARGIN = 30 * 60;
const DEAL_DAYS = 60;
export const HOME = 'Made at home';

/* ------------------------------------------------------------------ state */
export const S = {
  places: null, byId: null, deals: null, staleDeals: 0, menus: null, menuList: null, foodSet: null, posts: null,
  dish: undefined, dishes: [], dir: null, igBy: new Map(), dishBy: new Map(),
  asks: null, asksFailed: false, asksAt: 0, asksLoading: false, best: null, bestFailed: false,
  insp: null, inspKey: null, inspMeta: null, inspFailed: false,
  menusFailed: false, igFailed: false,
};
/* window.BTFood, the hours engine, once loaded (a live binding) */
export let F = null;

const subs = new Set();
/* fn(what) runs as each later piece lands: 'menus', 'kitchens', 'dishes',
   'asks', 'best', 'insp' */
export function onData(fn) { subs.add(fn); return () => subs.delete(fn); }
const told = (what) => subs.forEach((fn) => { try { fn(what); } catch (e) { console.error('[eat] ' + what, e); } });

/* ---------------------------------------------------------------- loading */
const libs = Object.create(null);
export function script(src) {
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
const demoFile = () => (demoP || (demoP = app.demoData('food').then(redate)));

let coreP = null;
/* the places, the deals and the engine: every food tab waits on these */
export function core() {
  if (coreP) return coreP;
  const first = app.demo
    ? Promise.all([script(FOOD_LIB), demoFile()]).then(([, d]) => { takePlaces(d.restaurants); takeDeals(d.deals, Date.parse(d.anchor)); })
    : Promise.all([
      script(FOOD_LIB),
      data.fetchJSON(RESTAURANTS_URL, 12000).then(takePlaces),
      data.fetchJSON(DEALS_URL, 8000).then((j) => takeDeals(j, Date.now())).catch(() => takeDeals({ deals: [] }, Date.now())),
    ]);
  coreP = first.then(() => {
    F = window.BTFood;
    if (!F || !S.places) throw new Error('no hours engine');
    later();
  });
  coreP.catch(() => { coreP = null; });
  return coreP;
}

function later() {
  loadInspections();
  if (app.demo) {
    demoFile().then((d) => {
      takeMenus(d.menus); takeRoster(d.roster); takeDirectory(d.directory); takeInstagram(d.instagram);
      takeDishes(d.dishes);
      S.asks = asksFrom(d.reddit, Date.now());
      takeBest(d.bestof);
      ['menus', 'kitchens', 'dishes', 'asks', 'best'].forEach(told);
    });
    return;
  }
  loadAsks();
  data.fetchJSON(BESTOF_URL, 10000).then(takeBest).catch(() => { S.bestFailed = true; }).then(() => told('best'));
  data.fetchJSON(MENUS_URL, 15000).then(takeMenus).catch(() => { S.menusFailed = true; }).then(() => told('menus'));
  const roster = data.fetchJSON(ROSTER_URL, 8000).then(takeRoster).catch(() => takeRoster({}));
  const dir = data.fetchJSON(DIRECTORY_URL, 8000).then(takeDirectory).catch(() => takeDirectory({}));
  const ig = new Promise((res) => data.load('instagram', (j) => { takeInstagram(j); res(); }, () => { S.igFailed = true; res(); }));
  Promise.all([roster, dir, ig]).then(() => told('kitchens'));
  script(PHOTOS_LIB).then(() => window.BTBP.getApproved())
    .then(({ photos }) => takeDishes(photos))
    .catch(() => takeDishes([]))
    .then(() => told('dishes'));
}

/* The Reddit asks, fetched now and again on the way back in (Bites). A
   failed refetch keeps the list it had. */
export function loadAsks() {
  S.asksAt = Date.now();
  S.asksLoading = true;
  return data.fetchJSON(INTAKE_URL, 10000).then((j) => {
    if (!j || !Array.isArray(j.posts)) throw new Error('not an intake');
    S.asks = asksFrom(j, Date.now());
    S.asksFailed = false;
  }).catch(() => { if (!S.asks) S.asksFailed = true; })
    .then(() => { S.asksLoading = false; told('asks'); });
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
   no open conflict between the two sources that reported it. */
const BTV_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export const btvDay = (ms) => BTV_DATE.format(new Date(Number(ms) || Date.now()));   // YYYY-MM-DD in Burlington
function takeDeals(j, at) {
  const ok = (j && Array.isArray(j.deals) ? j.deals : [])
    .filter((d) => d && d.id && d.title && d.business && !d.retired && !d.conflict && /^\d{4}-\d{2}-\d{2}$/.test(String(d.last_verified || '')));
  const today = Date.parse(btvDay(at) + 'T00:00:00Z');
  const fresh = (d) => (today - Date.parse(d.last_verified + 'T00:00:00Z')) / 86400000 <= DEAL_DAYS;
  S.deals = ok.filter(fresh);
  S.staleDeals = ok.length - S.deals.length;
}

/* the menus: by restaurant id for the rows, and the whole list (name, url)
   for Bites' menu shelf */
function takeMenus(j) {
  S.menus = Object.create(null);
  S.menuList = [];
  (j && Array.isArray(j.restaurants) ? j.restaurants : []).forEach((m) => {
    const u = m && m.menu && m.menu.status !== 'unavailable' && /^https?:/i.test(m.menu.url || '') ? m.menu.url : '';
    if (!m || !m.id || !u) return;
    S.menus[m.id] = u;
    S.menuList.push({ id: m.id, name: tidyName(String(m.name || m.id)), url: u, walk: Number(m.walk_min) || null, cuisine: m.cuisine || [], category: m.category || '' });
  });
}

function takeRoster(j) {
  S.foodSet = new Set((j && Array.isArray(j.food) ? j.food : []).map((h) => String(h).replace(/^@/, '').toLowerCase()));
  (Array.isArray(j && j.accounts) ? j.accounts : []).forEach((a) => {
    if (a && (a.category === 'food' || a.food === true)) S.foodSet.add(handle(a.h));
  });
}

export const handle = (h) => String(h || '').replace(/^@/, '').trim().toLowerCase();
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

/* the demo file is written on 2026-10-16: its Instagram and Reddit times
   move with the reader's clock (food.js does the same) */
function redate(d) {
  if (d.__redated) return d;
  d.__redated = true;
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

/* ------------------------------------------------------------ inspections */
/* Live: the state's records and the key, fetched once. Demo: invented
   records for the demo's invented places, the real key. */
function loadInspections() {
  const key = data.fetchJSON(INSP_KEY_URL, 10000);
  const recs = app.demo ? app.demoJSON('data/demo/eat-inspections.json') : data.fetchJSON(INSPECTIONS_URL, 20000);
  Promise.all([recs, key]).then(([j, k]) => {
    S.insp = Object.create(null);
    (j && Array.isArray(j.records) ? j.records : []).forEach((r) => {
      if (r && r.restaurant_id && r.latest && /^\d{4}-\d{2}-\d{2}$/.test(r.latest.date || '')) S.insp[r.restaurant_id] = r;
    });
    S.inspKey = (k && k.items) || {};
    S.inspMeta = { source: (j && j.source_url) || '', portal: (j && j.portal_url) || '', guide: (k && k.guide_url) || '' };
  }).catch(() => { S.inspFailed = true; }).then(() => told('insp'));
}
/* a place's record, under any of its ids */
export const inspOf = (r) => (S.insp && r ? r.aka.map((id) => S.insp[id]).find(Boolean) || null : null);

/* "Aug 28, 2026" from YYYY-MM-DD */
export function longDate(ymd) {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  return y && m && d ? MONTHS[m - 1] + ' ' + d + ', ' + y : '';
}
/* the age, from Burlington's today, in plain words, worked out on the visit */
export function ageWords(ymd, now) {
  const days = Math.round((Date.parse(btvDay(now) + 'T00:00:00Z') - Date.parse(ymd + 'T00:00:00Z')) / 86400000);
  if (!Number.isFinite(days)) return '';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return days + ' days ago';
  if (days < 60) return Math.round(days / 7) + ' weeks ago';
  if (days < 365) return Math.round(days / 30.44) + ' months ago';
  const y = Math.floor(days / 365.25), mo = Math.round((days - y * 365.25) / 30.44);
  return y + (y === 1 ? ' year' : ' years') + (mo >= 1 && mo < 12 ? ', ' + mo + (mo === 1 ? ' month' : ' months') : '') + ' ago';
}
/* the one line on every record: the visit, its age */
export function inspLine(rec, now) {
  const l = rec.latest;
  return 'Inspected ' + longDate(l.date) + ' · ' + ageWords(l.date, now);
}
const vSay = (v) => {
  const k = S.inspKey && S.inspKey[String(v.item)];
  return (k && k.plain_english) || v.plain_english || v.category || 'An item on the form';
};
/* what was noted, in a few plain words, with no tally that reads as a grade */
export function inspNoted(rec) {
  const vs = rec.latest.violations || [];
  if (!vs.length) return 'Nothing noted';
  return vs.length === 1 ? 'One item noted' : vs.length + ' items noted';
}
export const asOfLine = (rec) => 'As of ' + longDate(rec.as_of) + ', from the Vermont Department of Health’s public records.';

/* The inspection sheet: the visit, its age, each item in plain English
   (the critical ones first, marked as the kind most tied to illness, and
   whether it was fixed on the spot), the earlier visits by date, the
   source, and the day we checked. No score, no pass or fail. */
export function inspSheet(r) {
  const rec = inspOf(r);
  if (!rec) return;
  const now = Date.now();
  app.sheet(r.name, (body) => {
    const l = rec.latest;
    body.appendChild(el('p', 'sheet-note', esc('Health inspection · ' + inspLine(rec, now) + (l.type ? ' · ' + l.type.toLowerCase() + ' visit' : ''))));
    const vs = (l.violations || []).slice().sort((a, b) => (b.critical ? 1 : 0) - (a.critical ? 1 : 0));
    body.appendChild(el('div', 'sheet-h', esc(vs.length ? 'What the inspector noted' : 'What the inspector noted: nothing')));
    vs.forEach((v) => {
      const bits = [v.critical ? 'A critical item: the kind most tied to foodborne illness' : '', v.corrected_on_site ? 'Fixed on the spot' : '',
        v.correct_by ? 'To fix by ' + longDate(v.correct_by) : ''].filter(Boolean);
      const said = v.inspector_note ? '<div class="d">' + esc('The inspector: “' + trim(v.inspector_note, 220) + '”') + '</div>' : '';
      const row = el('div', 'sheet-row insp-v', '<div class="t">' + esc(vSay(v)) + (bits.length ? '<div class="d">' + esc(bits.join(' · ')) + '</div>' : '') + said + '</div>');
      row.dataset.k = 'v-' + String(v.item);
      body.appendChild(row);
    });
    if (vs.length) body.appendChild(el('p', 'sheet-note', esc('An item listed here may have been fixed since. The state’s records don’t show later fixes.')));
    const earlier = (rec.history || []).filter((h) => h && h.date && h.date !== l.date).slice(0, 6);
    if (earlier.length) {
      body.appendChild(el('div', 'sheet-h', esc('Earlier visits')));
      body.appendChild(el('div', 'sheet-row', '<div class="t">' + esc(earlier.map((h) => longDate(h.date)).join(' · ')) + '</div>'));
    }
    body.appendChild(el('p', 'sheet-note insp-asof', esc(asOfLine(rec))));
    const links = el('div', 'linkrow');
    const src = rec.source_url || S.inspMeta.portal;
    if (src) links.appendChild(outLink('The state’s records', src));
    if (S.inspMeta.guide) links.appendChild(outLink('How to read a report', S.inspMeta.guide));
    body.appendChild(links);
  });
}

/* ------------------------------------------------------------ the clock */
export const now = () => F.now();
export function clock(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  const hh = h % 24;
  if (hh === 0 && !m) return 'midnight';
  if (hh === 12 && !m) return 'noon';
  return (hh % 12 || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + ' ' + (hh < 12 ? 'am' : 'pm');
}
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function verified(dateStr, t) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return 'Verified ' + MONTHS[m - 1] + ' ' + d + (t && t.dateStr.slice(0, 4) !== String(y) ? ', ' + y : '');
}
const mmss = (s) => { const n = Math.max(0, Math.round(Number(s) || 0)); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0'); };
export const trim = (s, n) => { const v = String(s || '').replace(/\s+/g, ' ').trim(); return v.length > n ? v.slice(0, n - 1).trimEnd() + '…' : v; };
export const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

export function miles(a, b) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export const milesText = (mi) => (mi == null ? '' : mi < 0.1 ? 'steps away' : mi < 10 ? mi.toFixed(1) + ' mi' : Math.round(mi) + ' mi');
export const deal12 = (s) => String(s || '').replace(/\b(\d{1,2}(?::\d{2})?) (AM|PM)\b/g, (m0, n, ap) => n + ' ' + ap.toLowerCase());

/* ------------------------------------------------------------ the places */
export const hasHours = (r) => !!r.hours && Object.keys(r.hours).length > 0 && r.hours_confidence !== 'unverified';
export const isOpen = (r, t) => hasHours(r) && F.isOpenAt(r.hours, t.day, t.minutes);
export const dealsAt = (r) => (S.deals || []).filter((d) => r.aka.includes(d.restaurant_id));
export const menuOf = (r) => (S.menus ? r.aka.map((id) => S.menus[id]).find(Boolean) || '' : '');

export function placeByName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (n === HOME.toLowerCase()) return null;
  return n && S.places ? S.places.find((r) => r.name.toLowerCase() === n) || null : null;
}

export function handlesOf(r) {
  if (!S.dir) return [];
  return [...new Set(r.aka.map((id) => S.dir.places[id]).filter(Boolean))].filter((h) => !S.dir.notFood.has(h));
}
export function foodOf(r) {
  const nowS = Date.now() / 1000;
  const hs = handlesOf(r);
  const posts = hs.flatMap((h) => S.igBy.get(h) || []).filter((p) => pictureOk(p, nowS)).sort((a, b) => b.ts - a.ts);
  return { handle: hs[0] || '', posts, dishes: S.dishBy.get(r.id) || [] };
}
export function thumbOf(f) {
  const d = f.dishes[0], p = f.posts[0];
  const dTs = d ? (Date.parse(d.approved_on || '') / 1000 || 0) : -1;
  if (d && (!p || dTs >= Number(p.ts || 0))) return d.url;
  return p ? p.i : '';
}

const NOT_A_KIND = new Set(['lunch', 'outdoor dining', 'other', 'romantic', 'activities']);
export function kind(r) {
  const c = (r.cuisine || []).map((x) => String(x).replace(/\s*\(.*$/, '').split(/\s+\/\s+|[,;]/)[0].trim()).find((x) => x && !NOT_A_KIND.has(x.toLowerCase()));
  return trim(c || r.category || '', 32);
}

const NOTE_RE = /https?:|\b(the 20\d\d window|per google|unverified|seed|sheet|beehiiv|yelp|confirmed|do not|categori[sz]e|defunct|no longer|closed|permanently|not burlington|reportedly)\b|\b\d{1,2}(:\d\d)?\s?(am|pm)\b|^(opened|opening|grand opening|open|also|company|aimed|hotel|in \w+, not)\b/i;
export const cleanBlurb = (r) => (r.blurb && r.blurb.length >= 40 && !NOTE_RE.test(r.blurb) ? r.blurb : '');
const ORDER_RE = /\b(the standard order|starting point|converts|known for|famous for|signature|get the|try the|go for the|(is|are) mandatory|is the reason)\b/i;
export function orderLine(r) {
  const b = cleanBlurb(r);
  if (!b) return '';
  const said = b.split(/(?<=[.!?])\s+/).filter((s) => ORDER_RE.test(s) && s.length <= 120);
  return said.length && said[0] !== b ? said[0] : '';
}

export function status(r, t) {
  if (!hasHours(r)) return { open: null, text: 'Hours not checked yet' };
  if (F.isOpenAt(r.hours, t.day, t.minutes)) {
    const allDay = (r.hours[t.day] || []).some(([o, c]) => o === c);
    return { open: true, text: allDay ? 'Open all day and night' : 'Open until ' + clock(F.closingTime(r.hours, t.day, t.minutes)) };
  }
  const nx = F.nextOpening(r.hours, t.day, t.minutes);
  if (!nx) return { open: false, text: 'Not open this week' };
  return { open: false, text: 'Opens ' + clock(nx.time) + (nx.daysAhead === 0 ? '' : nx.daysAhead === 1 ? ' tomorrow' : ' ' + F.DAY_LABELS[nx.day]) };
}

export function googleUrl(r) {
  const q = encodeURIComponent(r.name + (r.address ? ', ' + r.address : ', Burlington VT'));
  if (r.place_id) return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(r.name) + '&query_place_id=' + encodeURIComponent(r.place_id);
  if (r.links && /^https?:/i.test(r.links.google_maps || '')) return r.links.google_maps;
  return 'https://www.google.com/maps/search/?api=1&query=' + q;
}

/* An outbound link. Demo links go nowhere and say so; our own pages open here. */
export function outLink(label, href, cls, ours) {
  const a = el('a', cls || 'btn ghost sm', esc(label) + (ours ? '' : ' ' + ICON.ext));
  a.href = safeHref(href);
  if (!ours) { a.target = '_blank'; a.rel = 'noopener'; }
  if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast(label + ' opens in the real build'); });
  return a;
}

/* A deal has no picture of its own: two of the shell's source-mark hues,
   picked by its id, so the same deal is always the same colour. */
export function tint(id) {
  let h = 7;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % 8, b = (a + 3) % 8;
  return '<span class="ph" style="--p1:var(--mark-' + a + ');--p2:var(--mark-' + b + ');--p3:var(--lightbox)"></span>';
}

/* ------------------------------------------------------------- the sheets */
/* A place: today's hours, its deals, its latest health inspection (date and
   age, a tap to the plain-English sheet), the menu, the website, the full
   reviews on Google. Opens from any of the three tabs. */
export function placeSheet(r) {
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
        const when = deal12([F.dealDaysLabel(d), F.dealTimeLabel(d)].filter(Boolean).join(' · '));
        body.appendChild(el('div', 'sheet-row', '<div class="t">' + esc(d.title) + '<div class="d">' + esc([when, verified(d.last_verified, t)].filter(Boolean).join(' · ')) + '</div></div>'));
      });
    }

    const rec = inspOf(r);
    if (rec) {
      body.appendChild(el('div', 'sheet-h', esc('Health inspection')));
      const row = el('div', 'sheet-row insp-row');
      const b = el('a', 't', esc(inspLine(rec, Date.now())) + ' ' + ICON.arrow + '<div class="d">' + esc(inspNoted(rec) + ' · the plain-English list') + '</div>');
      b.href = '#' + KEY + '/i-' + encodeURIComponent(r.id);
      b.addEventListener('click', (e) => { e.preventDefault(); inspSheet(r); });
      row.appendChild(b);
      body.appendChild(row);
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

/* Their food: dishes readers sent in first, then the place's own posts and
   reels. A reel plays in the shell's one video box. */
export function foodSheet(r) {
  const fd = foodOf(r);
  app.sheet(r.name, (body, card, close) => {
    card.classList.add('theirfood');
    const grid = el('div', 'fgrid');
    fd.dishes.forEach((d) => grid.appendChild(dishTile(d)));
    fd.posts.slice(0, RAIL_MAX).forEach((p) => grid.appendChild(postTile(p, close)));
    body.appendChild(grid.children.length ? grid : el('p', 'sheet-note', esc('No dishes here yet.')));
    const links = el('div', 'linkrow');
    if (fd.handle) links.appendChild(outLink('@' + fd.handle, 'https://www.instagram.com/' + encodeURIComponent(fd.handle) + '/', 'btn ghost sm insta'));
    links.appendChild(button('Feature a dish', 'ghost sm', () => { close(); app.go('bites', 'add'); }));
    links.appendChild(button('Feature your restaurant', 'ghost sm owner', () => ownerSheet(r)));
    body.appendChild(links);
  });
}

export function dishTile(d) {
  const b = el('button', 'ftile dish', '<span class="c-media r11">' + art(d.url) + '</span><span class="s">' +
    esc([trim(d.caption, 60), d.spot && d.spot !== HOME ? d.spot : '', d.credit ? 'sent in by ' + d.credit : ''].filter(Boolean).join(' · ')) + '</span>');
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
export function ownerSheet(r) {
  app.sheet('Feature your restaurant', (body) => {
    body.appendChild(el('p', 'sheet-note', esc('Send a clip of your own dishes. We add it free.')));
    const row = el('div', 'linkrow');
    const a = el('a', 'btn mailto', ICON.mail + ' ' + esc('Email a clip'));
    a.href = 'mailto:' + OWNER_MAIL + '?subject=' + encodeURIComponent('Feature my restaurant' + (r ? ': ' + r.name : ''));
    row.appendChild(a);
    body.appendChild(row);
  });
}

/* ------------------------------------------------------- the kitchens' posts */
const sigExpiry = (u) => { const m = /[?&]oe=([0-9a-f]+)/i.exec(String(u || '')); return m ? parseInt(m[1], 16) : null; };
export const pictureOk = (p, nowS) => { const e = sigExpiry(p.i); return e === null || e > nowS; };
const isFood = (p) => {
  const h = handle(p.h);
  if (S.dir && S.dir.notFood.has(h)) return false;
  return p.f === 1 || !!(S.foodSet && S.foodSet.has(h)) || !!(S.dir && S.dir.handles.has(h));
};
export const keyOf = (p) => { const m = /\/(?:p|reel)\/([A-Za-z0-9_-]+)/.exec(p.u); return 'ig-' + (m ? m[1] : p.h + '-' + p.ts); };
export const hasClip = (p, nowS) => typeof p.vu === 'string' && /^https:\/\//.test(p.vu) && Number(p.ve) - nowS > VIDEO_MARGIN;
/* the kitchens' pictures worth showing, newest first (none while they load) */
export function kitchenFood() {
  if (!S.posts || !S.foodSet || !S.dir) return [];
  const nowS = Date.now() / 1000;
  return S.posts.filter((p) => isFood(p) && pictureOk(p, nowS)).sort((a, b) => b.ts - a.ts);
}
export const who = (p) => trim('@' + p.h, 18);
export const when = (p) => (Number(p.ts) ? agoShort(p.ts) : '');
export { mmss };
export function openClip(p) {
  app.showClip({ src: p.vu, poster: p.i, title: who(p) + (p.c ? ' · ' + trim(p.c, 60) : ''), href: p.u, vertical: true });
}

/* the Reddit asks the reader has not muted */
export const asksShown = () => (S.asks || []).filter((a) => !store.isMuted(a.sid));
