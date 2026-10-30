/* eat-open.js — Eat's Open now (wave 1, 2026-10-29). Top tabs: Open now ·
   Randomizer · Inspections.

   It keeps food's route. The Eat config hosts `{ mode: 'food' }`, so
   main.js loads food.js and every #food/<key> link in every app still
   lands in Eat; this file imports food.js first and then registers Eat's
   own tab under the same key, so in Eat the later registration is the one
   the shell runs (app.register keeps the last). deals.js and bites.js
   import this file, so it loads with them; if it ever failed to load, Eat
   would show food.js whole, which still works. All Day never loads it.

   - Open now: food.js's list: the filter chips (Open now, Open late,
     Patios, Happy hour, Under $15, Deals, each with its count), Breakfast /
     Lunch / Dinner, nearest Church Street (nearest the reader once they
     allow it on the map), Opening next in the small hours, the Map button (Leaflet on the first tap; the reader's position
     in memory only) and each place's sheet.
   - Randomizer: one place picked at random from the list as filtered, and
     Spin again (restaurants.html's dinner randomizer, the tab's way).
   - Inspections: every place we could match to the Health Department's
     records, A to Z, never by score: the latest visit's date and its age,
     what was noted in a few words, the day we checked; a tap opens the
     plain-English sheet (eat-lib.js). A search box narrows the list.

   Deep links, food's own kept: #food/open|random|insp jumps; #food/map
   opens the map; a filter key (late, patio, hh, cheap, deal) sets it;
   r-<id> opens a place; i-<id> its inspection. Food's sections that moved
   follow them: bite, kitchens, asks, best, add, q-…, a thread's URL and
   ig-… go to Bites; deals and d-… to Deals. */

import './food.js';
import * as app from '../app.js';
import { el, esc, ICON, art, mark, section, collapseBar, chips, pills, button } from '../ui.js';
import { sectionBar } from '../sections.js';
import * as E from './eat-lib.js';

const KEY = E.KEY;
const FAR_MI = 40;
const FIRST_ROWS = 12;
const INSP_FIRST = 12;
const LATE = 23 * 60;
const STALE_MS = 5 * 60000;
const FLASH_MS = 2400;                     // ui.js's flash: how long a linked row glows
const LEAFLET = {
  js: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', jsSri: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
  css: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', cssSri: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=',
};
const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const SECTIONS = [['open', 'Open now'], ['random', 'Randomizer'], ['insp', 'Inspections']];
/* where food's other sections live in Eat */
const MOVED = { bite: 'bites', kitchens: 'bites', asks: 'bites', best: 'bites', add: 'bites', deals: 'deals' };

const S = { f: 'open', all: false, meal: 'any', chose: false, me: null, drawn: 0, pick: null, q: '', inspAll: false };
let root = null, slots = null, pending = null, ready = false, tick = 0, flashing = null;
const F = () => E.F;

/* ------------------------------------------------------------- the list */
const FILTERS = [
  { key: 'open', label: 'Open now', test: (r, t) => E.isOpen(r, t) },
  { key: 'late', label: 'Open late',
    test: (r, t) => { if (!E.hasHours(r)) return false; const c = F().latestCloseTonight(r.hours, t.day); return c !== null && c >= LATE; } },
  { key: 'patio', label: 'Patios', test: (r, t) => r.patio === true && E.isOpen(r, t) },
  { key: 'hh', label: 'Happy hour', test: (r, t) => E.dealsAt(r).some((d) => d.type === 'happy-hour' && F().dealAppliesToday(d, t)) },
  { key: 'cheap', label: 'Under $15', test: (r) => r.under_15 === true },
  { key: 'deal', label: 'Deals', test: (r, t) => E.dealsAt(r).some((d) => F().dealAppliesToday(d, t)) },
];
const filterOf = (k) => FILTERS.find((f) => f.key === k) || FILTERS[0];
const listFor = (k, t) => E.S.places.filter((r) => filterOf(k).test(r, t) && servesMeal(r, S.meal, t.day));

const nothingOpen = (t) => S.f === 'open' && !S.chose && !E.S.places.some((r) => E.isOpen(r, t));
function openingNext(t) {
  return E.S.places.map((r) => ({ r, nx: E.hasHours(r) ? F().nextOpening(r.hours, t.day, t.minutes) : null }))
    .filter((x) => x.nx && (S.meal === 'any' || servesMeal(x.r, S.meal, x.nx.day)))
    .sort((a, b) => a.nx.daysAhead - b.nx.daysAhead || F().toMin(a.nx.time) - F().toMin(b.nx.time))
    .map((x) => x.r);
}
function shownPlaces(t) {
  if (nothingOpen(t)) return { next: true, list: openingNext(t) };
  return { next: false, list: sorted(listFor(S.f, t)) };
}

const MEALS = [['any', 'Any time'], ['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner']];
const MEAL_WIN = { breakfast: [7 * 60, 10 * 60], lunch: [11 * 60, 14 * 60], dinner: [17 * 60, 21 * 60] };
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function servesMeal(r, meal, day) {
  const w = MEAL_WIN[meal];
  if (!w) return true;
  if (!E.hasHours(r)) return false;
  const enough = (a, b) => Math.min(b, w[1]) - Math.max(a, w[0]) >= (w[1] - w[0]) / 2;
  const win = (o, c) => { const a = F().toMin(o), b = F().toMin(c); return a === null || b === null ? null : [a, b]; };
  const spill = (r.hours[DAYS[(DAYS.indexOf(day) + 6) % 7]] || []).some(([o, c]) => { const x = win(o, c); return x && x[1] < x[0] && enough(0, x[1]); });
  return spill || (r.hours[day] || []).some(([o, c]) => { const x = win(o, c); return x && enough(x[0], x[1] > x[0] ? x[1] : x[1] + 1440); });
}

/* Nearest Church Street is the list's own order (eat-lib); once the reader
   has allowed their position (the map's Near me), nearest them. The old
   sorts each repeated a filter (Open late, Under $15) or a tab (New). */
const fromMe = (r) => (S.me && r.coords && r.coords.length === 2 ? E.miles(r.coords, S.me) : null);
function sorted(list) {
  if (!S.me) return list;
  const d = (r) => { const m = fromMe(r); return m == null ? 1e6 : m; };
  const at = new Map(list.map((r, i) => [r, i]));
  return list.slice().sort((a, b) => d(a) - d(b) || at.get(a) - at.get(b));
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
  const p = panel();
  const y = p ? p.scrollTop : 0;
  /* the search box keeps the reader's cursor: Inspections redraws its list only */
  if (k === 'insp' && host.querySelector('.insp-list')) { paintInspList(host.querySelector('.insp-list')); return; }
  host.innerHTML = '';
  ({ open: paintOpen, random: paintRandom, insp: paintInsp })[k](host);
  if (p && app.activeTab() === KEY) p.scrollTop = y;
  if (k === 'open') app.paintSubnav();
  /* a late load rebuilt the rows: the place just linked to keeps its flash */
  if (k === 'open' && flashing && Date.now() - flashing.t < FLASH_MS) app.flashHit(root, flashing.k);
  resettle();
}

function paintOpen(host) {
  const t = E.now();
  const f = filterOf(S.f);
  const { next, list } = shownPlaces(t);
  section(host, next ? 'Opening next' : 'Open now', null, mapButton(list));
  host.appendChild(chips(FILTERS.map((x) => ({ key: x.key, label: x.label, n: listFor(x.key, t).length })), next ? null : S.f,
    (k) => { S.f = k; S.chose = true; S.all = false; S.pick = null; paint('open'); paint('random'); }, 'filters'));
  const tools = el('div', 'toolrow foodtools');
  const meal = pills(MEALS, S.meal, (v) => { S.meal = v; S.all = false; S.pick = null; paint('open'); paint('random'); }, 'meals');
  meal.setAttribute('aria-label', 'Meal');
  tools.append(meal);
  host.appendChild(tools);
  const box = el('div', 'places');
  const shown = S.all ? list : list.slice(0, FIRST_ROWS);
  shown.forEach((r) => box.appendChild(placeRow(r, t)));
  host.appendChild(box);
  if (!list.length) {
    host.appendChild(el('p', 'note pad', esc(next ? 'Nothing opens this week.' : f.key === 'open' || f.key === 'patio' ? 'Nothing open right now.' : 'Nothing fits that today.')));
  } else if (list.length > shown.length) {
    host.appendChild(button('All ' + list.length + ' ' + ICON.arrow, 'ghost more', () => { S.all = true; paint('open'); }));
  } else if (S.all && list.length > FIRST_ROWS) {
    host.appendChild(collapseBar('the places', () => { S.all = false; paint('open'); jump('open'); }));
  }
  const r = el('div', 'addrow linkrow');
  if (list.length <= shown.length) r.appendChild(E.outLink('All restaurants', E.GUIDE_URL, 'btn ghost sm', true));
  r.appendChild(button('Feature your restaurant', 'ghost sm owner', () => E.ownerSheet(null)));
  host.appendChild(r);
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
      if (E.miles(at, E.CHURCH_ST) > FAR_MI) { const e = new Error('far'); e.far = true; reject(e); return; }
      S.me = at;
      resolve(at);
    }, reject, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });
}

function placeRow(r, t, cls) {
  const st = E.status(r, t);
  const row = el('div', 'lrow place' + (cls ? ' ' + cls : ''));
  row.dataset.k = (cls ? cls + '-' : 'r-') + r.id;
  const mi = S.me ? fromMe(r) : r.mi;
  const meta = [r.neighborhood, E.kind(r), E.milesText(mi)].filter(Boolean).map(esc).join(' · ');
  const order = E.orderLine(r);
  /* the latest health inspection's age, plainly; its sheet is a tap away */
  const rec = E.inspOf(r);
  const insp = rec ? '<div class="s insp-age">' + esc('Inspected ' + E.ageWords(rec.latest.date, Date.now())) + '</div>' : '';
  const open = el('button', 'open', '<div class="t">' + esc(r.name) + '</div><div class="s">' + meta + ' · <span class="' + (st.open ? 'ok' : '') + '">' + esc(st.text) + '</span></div>' +
    (order ? '<div class="s">' + esc(order) + '</div>' : '') + insp);
  open.setAttribute('aria-label', r.name + ', ' + st.text + '. More about it');
  open.addEventListener('click', () => E.placeSheet(r));
  const fd = E.foodOf(r);
  const pic = E.thumbOf(fd);
  row.append(pic ? el('span', 'th', art(pic)) : el('span', 'th bare', mark(r.name, 'round')), open);
  const acts = el('div', 'placeacts');
  const nPics = fd.dishes.length + Math.min(fd.posts.length, 12);
  if (nPics) {
    const b = el('button', 'pillbtn theirs', esc(E.plural(nPics, 'photo', 'photos')));
    b.setAttribute('aria-label', 'Their food at ' + r.name);
    b.addEventListener('click', () => E.foodSheet(r));
    acts.appendChild(b);
  }
  const menu = E.menuOf(r);
  if (menu) {
    const a = E.outLink('Menu', menu, 'pillbtn');
    a.setAttribute('aria-label', 'Menu for ' + r.name);
    acts.appendChild(a);
  }
  if (acts.children.length) row.appendChild(acts);
  return row;
}

/* ----------------------------------------------------------- the randomizer */
/* One place from the list as it stands (the filter, the meal), picked at
   random: a way to decide, never a recommendation. */
function paintRandom(host) {
  const t = E.now();
  const { next, list } = shownPlaces(t);
  section(host, 'Randomizer');
  if (!list.length) { host.appendChild(el('p', 'note pad', esc('Nothing to pick from.'))); return; }
  if (S.pick && !list.includes(S.pick)) S.pick = null;
  const r = S.pick;
  const card = el('div', 'textcard spin');
  card.dataset.k = r ? 'spun-' + r.id : 'spin';
  if (r) {
    const st = E.status(r, t);
    card.innerHTML = '<h3 class="serif">' + esc(r.name) + '</h3><p>' + esc([r.neighborhood, E.kind(r), E.milesText(r.mi)].filter(Boolean).join(' · ')) + '</p>' +
      '<p>' + esc(st.text) + '</p>';
  }
  const row = el('div', 'row');
  row.appendChild(button((r ? 'Spin again' : 'Pick one for me') + ' ' + ICON.arrow, r ? 'ghost sm' : '', () => spin(list)));
  if (r) row.appendChild(button('The place', 'ghost sm', () => E.placeSheet(r)));
  card.appendChild(row);
  host.appendChild(card);
}
function spin(list) {
  const others = list.length > 1 ? list.filter((r) => r !== S.pick) : list;
  S.pick = others[Math.floor(Math.random() * others.length)];
  paint('random');
}

/* ----------------------------------------------------------- inspections */
function inspPlaces() {
  return E.S.places.filter((r) => E.inspOf(r)).sort((a, b) => a.name.localeCompare(b.name));
}
function paintInsp(host) {
  if (!E.S.insp) {
    section(host, 'Inspections');
    host.appendChild(E.S.inspFailed ? el('p', 'note pad', esc('Didn’t load. Try again later.')) : el('p', 'loading', 'Loading the inspections…'));
    return;
  }
  const all = inspPlaces();
  section(host, 'Inspections');
  const tools = el('div', 'toolrow foodtools');
  const q = el('input', 'field insp-q');
  q.type = 'search';
  q.placeholder = 'Find a place';
  q.setAttribute('aria-label', 'Find a place’s inspection');
  q.value = S.q;
  q.addEventListener('input', () => { S.q = q.value; S.inspAll = false; paintInspList(host.querySelector('.insp-list')); });
  tools.appendChild(q);
  host.appendChild(tools);
  host.appendChild(el('div', 'insp-list'));
  paintInspList(host.querySelector('.insp-list'));
}
function paintInspList(box) {
  box.innerHTML = '';
  const want = S.q.trim().toLowerCase();
  const list = inspPlaces().filter((r) => !want || r.name.toLowerCase().includes(want));
  const shown = S.inspAll || want ? list : list.slice(0, INSP_FIRST);
  const now = Date.now();
  const rows = el('div', 'places');
  shown.forEach((r) => {
    const rec = E.inspOf(r);
    const row = el('div', 'lrow insp');
    row.dataset.k = 'i-' + r.id;
    const b = el('button', 'open', '<div class="t">' + esc(r.name) + '</div><div class="s">' + esc(E.inspLine(rec, now)) + '</div>' +
      '<div class="s">' + esc(E.inspNoted(rec)) + '</div>');
    b.setAttribute('aria-label', r.name + ': ' + E.inspLine(rec, now) + '. The plain-English list');
    b.addEventListener('click', () => E.inspSheet(r));
    row.append(el('span', 'th bare', mark(r.name, 'round')), b);
    rows.appendChild(row);
  });
  box.appendChild(rows);
  if (!list.length) box.appendChild(el('p', 'note pad', esc(want ? 'No place by that name.' : 'No inspections yet.')));
  else if (list.length > shown.length) box.appendChild(button('All ' + list.length + ' ' + ICON.arrow, 'ghost more', () => { S.inspAll = true; paintInspList(box); }));
  else if (S.inspAll && !want && list.length > INSP_FIRST) box.appendChild(collapseBar('the inspections', () => { S.inspAll = false; paintInspList(box); jump('insp'); }));
}

/* ---------------------------------------------------------------- the map */
function mapButton(list) {
  const c = S.me || E.CHURCH_ST;
  const W = 72, H = 44, halfLon = 0.022, halfLat = halfLon * Math.cos(c[0] * Math.PI / 180) * H / W;
  const dots = list.filter((r) => r.coords && Math.abs(r.coords[0] - c[0]) < halfLat && Math.abs(r.coords[1] - c[1]) < halfLon).slice(0, 60)
    .map((r) => '<circle class="fm-dot" r="2.2" cx="' + (W / 2 + (r.coords[1] - c[1]) / halfLon * W / 2).toFixed(1) + '" cy="' + (H / 2 - (r.coords[0] - c[0]) / halfLat * H / 2).toFixed(1) + '"/>').join('');
  const b = el('button', 'mapbtn', '<svg class="fm-mini" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><rect class="fm-ground" width="' + W + '" height="' + H + '"/>' +
    '<path class="fm-street" d="M0 ' + H / 2 + 'H' + W + 'M' + W / 2 + ' 0V' + H + '"/>' + dots + '<circle class="fm-here" r="3.6" cx="' + W / 2 + '" cy="' + H / 2 + '"/></svg><span>' + esc('Map') + '</span>');
  b.setAttribute('aria-label', 'Map of ' + E.plural(list.length, 'place', 'places'));
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

let M = null;
function dropMap() { if (M) { try { M.remove(); } catch (e) { /* already gone */ } M = null; } }

function openMap() {
  const t = E.now();
  const shown = shownPlaces(t);
  const list = shown.list.filter((r) => r.coords && r.coords.length === 2);
  app.sheet('Map', (body) => {
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
      M = L.map(box, { zoomControl: true, attributionControl: true }).setView(E.CHURCH_ST, S.me ? 14 : 15);
      L.tileLayer(TILES, { maxZoom: 19, attribution: TILE_CREDIT }).addTo(M);
      list.forEach((r) => {
        const pin = L.circleMarker(r.coords, { radius: 7, weight: 2, className: 'fm-pin' + (E.isOpen(r, t) ? ' open' : '') }).addTo(M);
        pin.bindTooltip(esc(r.name));
        pin.on('click', () => E.placeSheet(r));
      });
      if (S.me) placeMe();
      else if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then((p) => { if (p.state === 'granted') locate().then(() => { placeMe(); paint('open'); }).catch(() => {}); }).catch(() => {});
      }
      setTimeout(() => { if (M) M.invalidateSize(); }, 80);
    }).catch(() => {
      if (box.isConnected) box.replaceWith(el('p', 'note pad', esc('The map didn’t load.')));
    });
  });
}

let mePin = null;
function placeMe() {
  if (!M || !S.me || !window.L || !M.getContainer().isConnected) return;
  if (mePin) { try { mePin.remove(); } catch (e) { /* gone with its map */ } }
  mePin = window.L.circleMarker(S.me, { radius: 8, weight: 3, className: 'fm-me', interactive: false }).addTo(M);
  /* the map stays on Church Street: turning it to the reader would ask the
     tile server for their neighbourhood */
  M.setZoom(14);
  const near = document.querySelector('.sheet-body .nearme');
  if (near) near.hidden = true;
}

/* ------------------------------------------------------------------- bits */
const panel = () => (root ? root.closest('.panel') : null);
/* A section the reader was just sent to (a pill, a deep link) is scrolled
   to once more if a late load redraws the list above it (food.js's rule);
   the reader taking the scroll over cancels it. */
let jumped = null, settleT = 0, watching = null;
function jump(k) {
  if (!slots || !slots[k]) return;
  jumped = { k, t: Date.now() };
  const p = panel();
  if (p && watching !== p) {
    watching = p;
    ['wheel', 'touchstart', 'keydown'].forEach((ev) => p.addEventListener(ev, () => { jumped = null; }, { passive: true }));
  }
  app.jumpTo(slots[k]);
}
function resettle() {
  clearTimeout(settleT);
  settleT = setTimeout(() => {
    if (jumped && Date.now() - jumped.t < 6000 && app.activeTab() === KEY && slots && slots[jumped.k]) app.jumpTo(slots[jumped.k]);
  }, 60);
}

function land() {
  if (!pending || !ready) return;
  const k = pending; pending = null;
  if (MOVED[k]) { app.go(MOVED[k], k); return; }
  if (/^d-/.test(k)) { app.go('deals', k); return; }
  if (/^(q-|ig-)/.test(k) || /^https:\/\/(www\.|old\.)?reddit\.com\//.test(k)) { app.go('bites', k); return; }
  if (SECTIONS.some(([s]) => s === k)) { jump(k); return; }
  if (k === 'map') { jump('open'); openMap(); return; }
  if (FILTERS.some((f) => f.key === k)) { S.f = k; S.chose = true; S.all = false; paint('open'); jump('open'); return; }
  if (/^[ri]-/.test(k)) {
    const r = E.S.byId[k.slice(2)];
    if (!r) { app.toast('That place isn’t in the guide any more.'); return; }
    if (k[0] === 'i') {
      if (!E.S.insp && !E.S.inspFailed) { pending = k; return; }   // still loading: land when it arrives
      if (!E.inspOf(r)) { app.toast('No inspection on file for ' + r.name + '.'); return; }
      S.q = r.name; S.inspAll = false; paint('insp');
      const q = slots.insp.querySelector('.insp-q');
      if (q) q.value = S.q;
      app.flashHit(root, 'i-' + r.id);
      E.inspSheet(r);
      return;
    }
    const key = 'r-' + r.id;
    if (!slots.open.querySelector('[data-k="' + CSS.escape(key) + '"]')) {
      const t = E.now();
      const f = FILTERS.find((x) => x.test(r, t));
      S.f = f ? f.key : S.f; S.chose = true; S.all = true; paint('open');
    }
    flashing = { k: key, t: Date.now() };
    app.flashHit(root, key);
    E.placeSheet(r);
    return;
  }
  if (!app.flashHit(root, k)) app.toast('That one has moved on.');
}

/* the later pieces: menus and thumbnails redraw the list's pills, the
   inspections fill their section */
E.onData((what) => {
  if (!ready) return;
  if (what === 'insp') { paint('insp'); paint('open'); land(); }
  else if (what === 'menus' || what === 'kitchens' || what === 'dishes') { paint('open'); if (S.pick) paint('random'); }
});

app.register(KEY, {
  label: 'Open now',
  icon: ICON.food,
  promise: 'Where to eat right now: what’s open, a pick when you can’t decide, and each kitchen’s latest health inspection.',
  mount(r) {
    root = r;
    r.innerHTML = '<p class="loading">Checking who’s open…</p>';
    E.core().then(() => {
      ready = true;
      render();
      if (app.activeTab() === KEY) app.paintSubnav();
      land();
    }).catch(() => { r.innerHTML = '<div class="errbox"><b>Open now didn’t load.</b></div>'; });
  },
  activate(param) {
    pending = param || null;
    if (ready && Date.now() - S.drawn > STALE_MS) { paint('open'); paint('random'); S.drawn = Date.now(); }
    /* who is open changes by the minute: staying on the tab redraws the list too */
    clearInterval(tick);
    tick = setInterval(() => { if (ready && app.activeTab() === KEY) { paint('open'); S.drawn = Date.now(); } }, STALE_MS);
    land();
  },
  refresh() { if (ready) { paint('open'); paint('random'); } },
  deactivate() { clearInterval(tick); app.closeVideo(); if (M && !M.getContainer().isConnected) dropMap(); },
  subnav() {
    if (!ready) return null;
    const t = E.now();
    const next = nothingOpen(t);
    return sectionBar({ key: 'sec-eat-open', title: 'Open now', color: '--app-eat-pop', find: (k) => slots && slots[k], onPick: (k) => jump(k),
      items: SECTIONS.map(([key, label]) => ({
        key, label: key === 'open' && next ? 'Opening next' : label,
        n: key === 'open' ? (next ? null : listFor('open', t).length) : null,
      })) });
  },
  keepSubnav: true,
  /* the list is the same all day: nothing here counts as new */
  newSince() { return 0; },
});
