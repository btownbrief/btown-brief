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
     each the same test restaurants.html runs, each with its count. Nearest
     Church Street first: a distance, never a judgement. A row opens a sheet
     with today's hours, the menu (data/small-bites.json), the website and
     "Full reviews on Google" by the place's Google id.
   - Deals. data/deals.json as a story deck: today's deals that carry a
     verified date and no open conflict between sources, happening-now first,
     then later today, then the untimed ones. Tap the right side for the next
     card, the left for the previous. The verified date is on every card.
   - In their own words. Reels from the kitchens and food accounts tagged in
     data/instagram-handles.json (`food`), from all-day/data/instagram.json.
     A reel plays only on a tap, in the shell's one video box. Its MP4 is
     signed for about a day and a half, so one about to lapse is shown as a
     photo instead; with no reels at all, the accounts' latest photos.
   - Feature a dish. One photo, one line, the place, the consent box. It
     goes to the review queue as category `dish`; nothing appears until
     Stephen approves it.

   ?demo=1 runs this same file on data/demo/food.json, which holds every
   payload in its real shape, its times moved to the reader's day. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import { el, esc, safeHref, ICON, art, mark, section, rail, chips, button, agoShort } from '../ui.js';

const KEY = 'food';
const RESTAURANTS_URL = '../data/restaurants.json';
const DEALS_URL = '../data/deals.json';
const MENUS_URL = '../data/small-bites.json';
const ROSTER_URL = '../data/instagram-handles.json';
const FOOD_LIB = '../js/food-lib.js';
const PHOTOS_LIB = '../js/photos-lib.js';
const GUIDE_URL = '../restaurants.html';
const DEALS_PAGE = '../restaurants.html?view=deals';
const CHURCH_ST = [44.4758, -73.2128];   // food-lib's anchor for "walkable"
const FIRST_ROWS = 12;                     // the list opens in place past these
const DECK_MAX = 12;                       // cards before the deck's end card
const RAIL_MAX = 12;
const LINE_MAX = 140;
const VIDEO_MARGIN = 30 * 60;              // a reel this close to lapsing shows as a photo
const LATE = 23 * 60;                      // "Open late": until 11 pm or later (restaurants.html)
const STALE_MS = 5 * 60000;                // the clock-driven parts redraw on the way back in after this

const SECTIONS = [['bite', 'The Bite'], ['open', 'Open now'], ['deals', 'Deals'], ['kitchens', 'Kitchens'], ['add', 'Feature a dish']];

/* ------------------------------------------------------------------ state */
const S = {
  f: 'open', all: false, deal: 0,
  places: null, byId: null, deals: null, menus: null, foodSet: null, posts: null, dish: undefined,
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
    ? Promise.all([script(FOOD_LIB), demoFile()]).then(([, d]) => { takePlaces(d.restaurants); takeDeals(d.deals); })
    : Promise.all([
      script(FOOD_LIB),
      data.fetchJSON(RESTAURANTS_URL, 12000).then(takePlaces),
      data.fetchJSON(DEALS_URL, 8000).then(takeDeals).catch(() => takeDeals({ deals: [] })),
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
      takeMenus(d.menus); takeRoster(d.roster); takeInstagram(d.instagram);
      S.dish = d.dish && d.dish.category === 'dish' ? d.dish : null;
      paint('open'); paint('kitchens'); paint('bite');
    });
    return;
  }
  data.fetchJSON(MENUS_URL, 15000).then((j) => { takeMenus(j); paint('open'); })
    .catch(() => { S.menusFailed = true; });
  const roster = data.fetchJSON(ROSTER_URL, 8000).then(takeRoster).catch(() => takeRoster({}));
  const ig = new Promise((res) => data.load('instagram', (j) => { takeInstagram(j); res(); if (ready && S.foodSet) paint('kitchens'); },
    () => { S.igFailed = true; res(); }));
  Promise.all([roster, ig]).then(() => paint('kitchens'));
  script(PHOTOS_LIB).then(() => window.BTBP.getApproved())
    .then(({ photos }) => { S.dish = (photos || []).find((p) => p && p.category === 'dish' && p.url) || null; })
    .catch(() => { S.dish = null; })
    .then(() => paint('bite'));
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

/* The deals we stand behind: a verified date, not retired, and no open
   conflict between the two sources that reported it. */
function takeDeals(j) {
  S.deals = (j && Array.isArray(j.deals) ? j.deals : [])
    .filter((d) => d && d.id && d.title && d.business && !d.retired && !d.conflict && /^\d{4}-\d{2}-\d{2}$/.test(String(d.last_verified || '')));
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
}

function takeInstagram(j) {
  S.posts = j && Array.isArray(j.posts) ? j.posts.filter((p) => p && p.h && p.u && p.i) : [];
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
  { key: 'open', label: 'Open now', note: 'Open at this minute.', test: (r, t) => isOpen(r, t) },
  { key: 'late', label: 'Open late', note: 'Open until 11 pm or later tonight.',
    test: (r, t) => { if (!hasHours(r)) return false; const c = F.latestCloseTonight(r.hours, t.day); return c !== null && c >= LATE; } },
  { key: 'patio', label: 'Patios', note: 'Outdoor seating, open right now.', test: (r, t) => r.patio === true && isOpen(r, t) },
  { key: 'hh', label: 'Happy hour', note: 'A happy hour on today.', test: (r, t) => dealsAt(r).some((d) => d.type === 'happy-hour' && F.dealAppliesToday(d, t)) },
  { key: 'cheap', label: 'Under $15', note: 'A real meal for under fifteen dollars.', test: (r) => r.under_15 === true },
  { key: 'deal', label: 'Deals', note: 'A verified deal on today.', test: (r, t) => dealsAt(r).some((d) => F.dealAppliesToday(d, t)) },
];
const filterOf = (k) => FILTERS.find((f) => f.key === k) || FILTERS[0];
const listFor = (k, t) => S.places.filter((r) => filterOf(k).test(r, t));

/* What it is: the first cuisine that names a kind of food, else the category. */
const NOT_A_KIND = new Set(['lunch', 'outdoor dining', 'other', 'romantic', 'activities']);
function kind(r) {
  const c = (r.cuisine || []).map((x) => String(x).replace(/\s*\(.*\)\s*$/, '').trim()).find((x) => x && !NOT_A_KIND.has(x.toLowerCase()));
  return c || r.category || '';
}

/* The editorial blurbs, minus the few that are notes to ourselves. */
const NOTE_RE = /\b(the 20\d\d window|per google|unverified|seed|sheet|beehiiv)\b|^(opened|grand opening|open daily)\b/i;
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
  ['bite', 'open', 'deals', 'kitchens', 'add'].forEach(paint);
  root.appendChild(el('div', 'spacer'));
  S.drawn = Date.now();
}

function paint(k) {
  if (!ready || !slots || !slots[k]) return;
  const host = slots[k];
  if (k === 'add' && host.firstChild) return;   // the form is drawn once; a redraw would eat what was typed
  const y = panel() ? panel().scrollTop : 0;
  host.innerHTML = '';
  ({ bite: paintBite, open: paintOpen, deals: paintDeals, kitchens: paintKitchens, add: paintAdd })[k](host);
  if (panel() && app.activeTab() === KEY) panel().scrollTop = y;
  if (k === 'open' || k === 'deals') app.paintSubnav();
}

/* ------------------------------------------------------- the Weekly Bite */
function paintBite(host) {
  if (S.dish === undefined) { host.appendChild(el('p', 'loading', 'Finding this week’s bite…')); return; }
  const p = S.dish;
  if (!p) {
    const tc = el('div', 'textcard gap', '<h3 class="serif">The Weekly Bite starts with you</h3><p>' +
      esc('One photo of something you ate here, one line about it, and the place. Each week one gets featured right here, with your name on it. We feature, we don’t review.') + '</p>');
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
  const where = [p.spot, p.area && p.area !== 'Elsewhere' ? p.area : ''].filter(Boolean).join(' · ');
  hero.innerHTML = '<span class="c-media r45" data-zoom>' + art(p.url) + '</span>' +
    '<span class="eyebrow">' + esc('The Weekly Bite · featured, not reviewed') + '</span>' +
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
  return n ? S.places.find((r) => r.name.toLowerCase() === n) || null : null;
}

/* ---------------------------------------------------------------- Open now */
function paintOpen(host) {
  const t = now();
  const f = filterOf(S.f);
  const list = listFor(f.key, t);
  section(host, 'Open now', esc(f.note) + ' <b>' + esc(plural(list.length, 'place', 'places')) + '</b>, nearest Church Street first. Hours checked against Google.');
  host.appendChild(chips(FILTERS.map((x) => ({ key: x.key, label: x.label, n: listFor(x.key, t).length })), S.f,
    (k) => { S.f = k; S.all = false; paint('open'); }, 'filters'));
  const box = el('div', 'places');
  const shown = S.all ? list : list.slice(0, FIRST_ROWS);
  shown.forEach((r) => box.appendChild(placeRow(r, t)));
  host.appendChild(box);
  if (!list.length) {
    host.appendChild(el('p', 'note pad', esc(f.key === 'open' || f.key === 'patio' ? 'Nothing with checked hours is open at this minute. Open late shows tonight’s late ones.' : 'Nothing fits that today.')));
  } else if (list.length > shown.length) {
    host.appendChild(button('All ' + list.length + ' ' + ICON.arrow, 'ghost more', () => { S.all = true; paint('open'); }));
  } else {
    host.appendChild(el('p', 'note pad', esc('That’s all ' + plural(list.length, 'place', 'places') + '. Every filter and the whole guide are on ') +
      '<a href="' + esc(GUIDE_URL) + '"><b>' + esc('the restaurants page') + '</b></a>.'));
  }
}

function placeRow(r, t) {
  const st = status(r, t);
  const row = el('div', 'lrow place');
  row.dataset.k = 'r-' + r.id;
  const meta = [r.neighborhood, kind(r), milesText(r.mi)].filter(Boolean).map(esc).join(' · ');
  const order = orderLine(r);
  const open = el('button', 'open', '<div class="t">' + esc(r.name) + '</div><div class="s">' + meta + ' · <span class="' + (st.open ? 'ok' : '') + '">' + esc(st.text) + '</span></div>' +
    (order ? '<div class="s">' + esc(order) + '</div>' : ''));
  open.setAttribute('aria-label', r.name + ', ' + st.text + '. More about it');
  open.addEventListener('click', () => placeSheet(r));
  row.append(el('span', 'th bare', mark(r.name, 'round')), open);
  const menu = menuOf(r);
  if (menu) {
    const a = outLink('Menu', menu, 'pillbtn');
    a.setAttribute('aria-label', 'Menu for ' + r.name);
    row.appendChild(a);
  }
  return row;
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
    body.appendChild(el('p', 'sheet-note', esc('We feature, we don’t review. The reviews, good and otherwise, are on Google.')));
  });
}

/* ------------------------------------------------------------------- Deals */
/* Today's deals in deck order: happening now, then later today by start
   time, then the untimed ones. A window that has already closed today is
   left out. */
function deck(t) {
  const out = (S.deals || []).filter((d) => F.dealAppliesToday(d, t)).map((d) => {
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
  section(host, 'Deals today', esc(all.length ? plural(all.length, 'deal', 'deals') + ' on today, happening now first. Tap the right side for the next one.' : 'Deals with a verified date, from the deals page.'));
  if (!cards.length) {
    host.appendChild(el('p', 'note pad', esc('No verified deals on today. The week’s deals are on the deals page.')));
    return;
  }
  if (S.deal > cards.length) S.deal = 0;
  const box = el('div', 'deck');
  box.setAttribute('role', 'region');
  box.setAttribute('aria-roledescription', 'deck');
  box.setAttribute('aria-label', 'Deals today');
  const n = cards.length + 1;                      // the deals, then the end card
  const go = (i) => { S.deal = (i + n) % n; draw(); };
  const draw = () => {
    const i = S.deal;
    const segs = '<div class="segs">' + Array.from({ length: n }, (_, j) => '<i class="' + (j <= i ? 'on' : '') + '"></i>').join('') + '</div>';
    const hits = '<button class="hit l" aria-label="Previous deal"></button><button class="hit r" aria-label="Next deal"></button>';
    if (i === cards.length) {
      box.dataset.k = 'deals-end';
      box.innerHTML = tint('deals-end') + segs + '<div class="body"><div class="eyebrow">' + esc('That’s today') + '</div><h3>' +
        esc(plural(all.length, 'deal', 'deals') + ' on today, each one verified') + '</h3><p>' + esc('Every day of the week is on the deals page.') + '</p><div class="row"></div></div>' + hits;
      box.querySelector('.row').append(outLink('All the deals', DEALS_PAGE, 'btn ghost sm', true), button('Start over', 'ghost sm', () => go(0)));
    } else {
      const x = cards[i];
      box.dataset.k = 'd-' + x.d.id;
      const where = [x.d.business, x.r && x.r.neighborhood].filter(Boolean).join(' · ');
      box.innerHTML = tint(x.d.id) + segs + '<div class="body"><div class="eyebrow">' + esc(eyebrowOf(x)) + '</div><h3>' + esc(x.d.title) + '</h3>' +
        '<p>' + esc(where) + '</p><p class="verified">' + esc(verified(x.d.last_verified, t)) + '</p><div class="row"></div></div>' + hits;
      const row = box.querySelector('.row');
      if (x.r) row.appendChild(button('The place', 'ghost sm', () => placeSheet(x.r)));
      if (/^https?:/i.test(x.d.link || '')) row.appendChild(outLink('Details', x.d.link));
    }
    box.querySelector('.hit.l').addEventListener('click', () => go(S.deal - 1));
    box.querySelector('.hit.r').addEventListener('click', () => go(S.deal + 1));
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

/* ------------------------------------------------------- In their own words */
const sigExpiry = (u) => { const m = /[?&]oe=([0-9a-f]+)/i.exec(String(u || '')); return m ? parseInt(m[1], 16) : null; };
const pictureOk = (p, nowS) => { const e = sigExpiry(p.i); return e === null || e > nowS; };
const isFood = (p) => p.f === 1 || (S.foodSet && S.foodSet.has(String(p.h).toLowerCase()));
const keyOf = (p) => { const m = /\/(?:p|reel)\/([A-Za-z0-9_-]+)/.exec(p.u); return 'ig-' + (m ? m[1] : p.h + '-' + p.ts); };
const hasClip = (p, nowS) => typeof p.vu === 'string' && /^https:\/\//.test(p.vu) && Number(p.ve) - nowS > VIDEO_MARGIN;

function paintKitchens(host) {
  if (!S.posts || !S.foodSet) {
    section(host, 'In their own words', esc('Short videos from the kitchens themselves.'));
    host.appendChild(S.igFailed ? el('p', 'note pad', esc('The kitchens’ posts didn’t load. They come in once a day; try again in a bit.')) : el('p', 'loading', 'Loading the kitchens…'));
    return;
  }
  const nowS = Date.now() / 1000;
  const food = S.posts.filter((p) => isFood(p) && pictureOk(p, nowS)).sort((a, b) => b.ts - a.ts);
  const clipsList = food.filter((p) => hasClip(p, nowS)).slice(0, RAIL_MAX);
  if (clipsList.length) {
    section(host, 'In their own words', esc('Short videos from the kitchens themselves, newest first. Nothing plays until you tap.'));
    const r = rail(host);
    clipsList.forEach((p) => r.appendChild(clipCard(p)));
    return;
  }
  section(host, 'In their own words', esc(food.length ? 'No new videos from the kitchens this week, so here are their latest photos.' : 'Nothing new from the kitchens this week.'));
  if (!food.length) return;
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

/* The shell's one video box plays YouTube. A reel is an MP4, so this puts a
   <video> into the same box, starts it on the tap that opened it (never
   before), and gives the box back exactly as it found it when it closes,
   however it closes: its X, the scrim, the shell's player starting. A shell
   showClip() would make this unnecessary; it is asked for in the PR. */
let clip = null;
function openClip(p) {
  const box = document.getElementById('vbox');
  const frame = document.getElementById('vbox-frame');
  const title = document.getElementById('vbox-title');
  const open = document.getElementById('vbox-open');
  const hint = document.getElementById('vbox-hint');
  if (!box || !frame || !title || !open) { window.open(safeHref(p.u), '_blank', 'noopener'); return; }
  closeClip();
  app.closeVideo();
  if (app.isPlaying()) app.stop();
  app.silenceForeign();
  const was = { label: open.innerHTML, href: open.getAttribute('href') };
  title.textContent = who(p) + (p.c ? ' · ' + trim(p.c, 60) : '');
  open.innerHTML = esc('Open on Instagram') + ' ' + ICON.ext;
  open.href = safeHref(p.u);
  if (hint) hint.hidden = true;
  Object.assign(frame.style, { aspectRatio: '9 / 16', maxHeight: '70vh', margin: '0 auto' });
  if (app.demo) {
    frame.innerHTML = art(p.i);
    app.toast('The kitchen’s video plays here in the real build');
  } else {
    const v = document.createElement('video');
    v.src = p.vu;
    v.poster = p.i;
    v.controls = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.preload = 'none';
    Object.assign(v.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain' });
    frame.appendChild(v);
    v.play().catch(() => {});
  }
  box.hidden = false;
  const restore = () => {
    if (!clip) return;
    const c = clip; clip = null;
    c.watch.disconnect();
    c.unreg();
    Object.assign(frame.style, { aspectRatio: '', maxHeight: '', margin: '' });
    frame.querySelectorAll('video').forEach((v) => { try { v.pause(); } catch (e) { /* gone */ } v.removeAttribute('src'); });
    open.innerHTML = was.label;
    if (was.href) open.setAttribute('href', was.href); else open.removeAttribute('href');
  };
  const watch = new MutationObserver(() => { if (box.hidden) restore(); });
  watch.observe(box, { attributes: true, attributeFilter: ['hidden'] });
  clip = { watch, unreg: app.registerForeign(() => app.closeVideo()), restore };
}
function closeClip() { if (clip) { app.closeVideo(); if (clip) clip.restore(); } }

/* ---------------------------------------------------------- Feature a dish */
const AREA_OF = { 'Essex': 'Essex / Essex Jct', 'Burlington': 'Greater Burlington' };
const NEGATIVE = /\b(worst|terrible|awful|gross|disgusting|overpriced|bland|rude|avoid|never again|inedible|mid)\b/i;

function paintAdd(host) {
  section(host, 'Feature a dish', esc('What should the town taste next?'));
  const tc = el('div', 'textcard');
  tc.dataset.k = 'add-form';
  tc.innerHTML = '<h3 class="serif">' + esc('We feature, we don’t review.') + '</h3><p>' +
    esc('One photo of something you ate here, one line about it, and the place. No stars, no scores, nothing negative: if you wouldn’t tell a friend to order it, leave it out. Every place links to its Google reviews for the rest.') + '</p>';
  const form = el('form', 'dish');
  form.noValidate = true;
  const names = S.places.map((r) => '<option value="' + esc(r.name) + '"></option>').join('');
  form.innerHTML =
    '<div class="row"><button type="button" class="btn ghost pick">' + ICON.plus + ' ' + esc('Choose a photo') + '</button><span class="note fname">' + esc('No photo yet') + '</span>' +
      '<input type="file" name="file" accept="image/*" hidden></div>' +
    '<div class="row"><input class="field" name="line" maxlength="' + LINE_MAX + '" placeholder="' + esc('One line: what it is, and why') + '" aria-label="One line about the dish" autocomplete="off"></div>' +
    '<div class="row"><input class="field" name="place" list="food-places" maxlength="120" placeholder="' + esc('The place') + '" aria-label="The place" autocomplete="off">' +
      '<datalist id="food-places">' + names + '</datalist></div>' +
    '<div class="row"><input class="field" name="credit" maxlength="60" placeholder="' + esc('Your first name, for the credit (optional)') + '" aria-label="Your name for the credit" autocomplete="given-name"></div>' +
    '<div class="row"><label class="consent"><input type="checkbox" name="consent"> ' + esc('I took this photo, and the Brief may feature it on the site and in the newsletter.') + '</label></div>' +
    '<div class="row"><button type="submit" class="btn send">' + esc('Send it in') + '</button><span class="fine">' + esc('Reviewed before it appears, usually within a day.') + '</span></div>' +
    '<p class="note err" role="alert" hidden></p>';
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
  const place = String(fd.get('place') || '').replace(/\s+/g, ' ').trim();
  const credit = String(fd.get('credit') || '').replace(/\s+/g, ' ').trim();
  if (!file || !file.size) return say('Choose a photo first.');
  if (!/^image\//.test(file.type || 'image/')) return say('That file isn’t a photo.');
  if (!line) return say('Add one line about it: what it is, and why.');
  if (NEGATIVE.test(line)) return say('We only feature what you’d recommend. Tell us what you liked about it.');
  if (!place) return say('Which place is it from?');
  if (!fd.get('consent')) return say('Tick the box first: we only feature photos you took and said we could use.');
  say('');
  const send = form.querySelector('.send');
  if (app.demo) {
    form.reset();
    form.querySelector('.fname').textContent = 'No photo yet';
    app.toast('Demo: nothing was sent. In the real build it goes to the review queue.');
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
    app.toast('Sent. Thank you: it’s in the queue, and we’ll look today.');
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

/* #food/bite|open|deals|kitchens|add jumps to a section; a filter key
   (late, patio, hh, cheap, deal) sets the filter; r-<id> opens a place;
   d-<id> turns the deck to that deal; ig-<code> a kitchen's post. */
function land() {
  if (!pending || !ready) return;
  const k = pending; pending = null;
  if (SECTIONS.some(([s]) => s === k) && k !== 'open') { jump(k); return; }
  if (FILTERS.some((f) => f.key === k)) { S.f = k; S.all = false; paint('open'); jump('open'); return; }
  if (/^r-/.test(k)) {
    const r = S.byId[k.slice(2)];
    if (!r) { app.toast('That place isn’t in the guide any more.'); return; }
    const key = 'r-' + r.id;                       // an old id lands on the place it became
    if (!slots.open.querySelector('[data-k="' + CSS.escape(key) + '"]')) {
      const t = now();
      const f = FILTERS.find((x) => x.test(r, t));
      S.f = f ? f.key : S.f; S.all = true; paint('open');
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
  promise: 'Where to eat right now, the deals worth crossing town for, and the kitchens in their own words.',
  mount(r) {
    root = r;
    r.innerHTML = '<p class="loading">Checking who’s open…</p>';
    load().then(() => {
      ready = true;
      render();
      if (app.activeTab() === KEY) app.paintSubnav();
      land();
    }).catch(() => { r.innerHTML = '<div class="errbox"><b>Food didn’t load.</b> Reload to try again.</div>'; });
  },
  activate(param) {
    pending = param || null;
    /* the list is about this minute: coming back later redraws it */
    if (ready && Date.now() - S.drawn > STALE_MS) { paint('open'); paint('deals'); S.drawn = Date.now(); }
    land();
  },
  refresh() { if (ready) { paint('bite'); paint('open'); paint('deals'); paint('kitchens'); } },
  deactivate() { closeClip(); },
  subnav() {
    if (!ready) return null;
    const t = now();
    return chips(SECTIONS.map(([key, label]) => ({
      key, label, n: key === 'open' ? listFor('open', t).length : key === 'deals' ? deck(t).length : null,
    })), null, (k) => jump(k));
  },
  /* Nothing here is a feed that grows while you are away, so the dot stays off. */
  newSince() { return 0; },
});
