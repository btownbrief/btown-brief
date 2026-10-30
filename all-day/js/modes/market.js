/* Market (Eat, wave 1, 2026-10-29): who’s at the market, what’s in season,
   food to rescue. Five sections under the pill, freshest first:

   - This week. The farmers markets on the next seven days in Burlington's
     clock: the summer season's dates, else the winter market's own dates.
     Hours in plain words, the place, what it takes (SNAP and the rest), the
     vendors behind a button, the source on every row. A market with nothing
     this week says when it is back ("Winter market from Sat, Nov 21"), or
     honestly that its next dates aren't posted.
   - In season. This month's Vermont produce, next month on a smaller line,
     with the chart it comes from.
   - Farms. The farms that sell direct: what, how to order, pickup, price.
   - Fridge. The food shelves; and a community fridge only when its record
     is confirmed or active. The one record we have is unconfirmed and may
     be someone's home, so its address is never drawn.
   - Rescue. The board first: kitchens' free food at closing (boards.js,
     board 'rescue'). Free only: a priced post is never shown and the form
     has no price, because Vermont's Good Samaritan law covers food given
     away, not food sold cheap. Then the groups that rescue food here, then
     the apps, each saying plainly whether it serves Burlington ("unclear"
     when nobody could tell).

   Live reads ../data/eat/market.json and ../data/eat/rescue.json (both
   hand-checked); ?demo=1 reads data/demo/eat-market.json, the same shapes
   with invented content, its dates moved by whole weeks to the reader's
   today. Every row is m-<id>; #market/<section> and #market/m-<id> land. */

import * as app from '../app.js';
import * as data from '../wire.js';
import * as boards from '../boards.js';
import { RULES } from '../boards-core.js';
import { el, esc, safeHref, ICON, mark, section, button, collapseBar } from '../ui.js';
import { sectionBar } from '../sections.js';

const KEY = 'market';
const MARKET_URL = '../data/eat/market.json';
const RESCUE_URL = '../data/eat/rescue.json';
const DEMO_FILE = 'data/demo/eat-market.json';
const MAIL = 'btownbrief@gmail.com';
const TZ = 'America/New_York';
const HOUR = 3600;
const FIRST_FARMS = 8;
const SECTIONS = [['week', 'This week'], ['season', 'In season'], ['farms', 'Farms'], ['fridge', 'Fridge'], ['rescue', 'Rescue']];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_PLURAL = { sun: 'Sundays', mon: 'Mondays', tue: 'Tuesdays', wed: 'Wednesdays', thu: 'Thursdays', fri: 'Fridays', sat: 'Saturdays' };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const FREE_NOTE = 'Free food only.';
/* from rescue.json's rules: vt-time-temperature, vt-no-reservice, allergen-disclosure */
const SAFE_NOTE = 'Food that never left the kitchen, kept hot or cold, allergens listed.';

const S = {
  root: null, slots: null, pending: null, ready: false,
  market: null, rescue: null, marketFailed: false, rescueFailed: false,
  board: undefined,          // undefined: asking; false: not on the server yet; true: live
  posts: null, boardFailed: false, farmsAll: false,
  open: Object.create(null), // row key -> its sheet, for deep links
};

/* ------------------------------------------------------------ the clock */
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
/* today in Burlington, as 2026-10-29 */
function todayIso() {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
  return isoOf(+p.year, +p.month, +p.day);
}
const utc = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (iso, n) => { const t = utc(iso); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dowOf = (iso) => DAYS[utc(iso).getUTCDay()];
const dayShort = (iso) => utc(iso).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const dayLong = (iso) => utc(iso).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);

/* "15:00" -> "3 pm"; "18:30" -> "6:30 pm" */
function clock(hhmm, withAp = true) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  const hh = h % 24;
  if (hh === 12 && !m) return 'noon';
  return (hh % 12 || 12) + (m ? ':' + pad(m) : '') + (withAp ? ' ' + (hh < 12 ? 'am' : 'pm') : '');
}
/* "9:00-14:00" -> "9 am – 2 pm"; "15:00-18:30" -> "3 – 6:30 pm" */
function hoursText(h) {
  const [a, b] = String(h || '').split('-');
  if (!a || !b) return String(h || '');
  const same = (Number(a.split(':')[0]) < 12) === (Number(b.split(':')[0]) < 12) && clock(a) !== 'noon' && clock(b) !== 'noon';
  return (same ? clock(a, false) : clock(a)) + ' – ' + clock(b);
}

/* "May 9 - October 31, 2026" and "June 12 - September 18, 2026 (Jun 12, Jun 26, …)"
   -> { start, end, list } as ISO days, or null */
const monthNo = (s) => MONTHS.findIndex((m) => m.startsWith(String(s || '').toLowerCase().slice(0, 3))) + 1;
function parseSeason(str, yearHint) {
  const s = String(str || '');
  const m = s.match(/([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?\s*[-–]\s*([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})?/);
  if (!m || !monthNo(m[1]) || !monthNo(m[4])) return null;
  const y2 = Number(m[6] || yearHint), y1 = Number(m[3] || y2);
  if (!y2) return null;
  const out = { start: isoOf(y1, monthNo(m[1]), +m[2]), end: isoOf(y2, monthNo(m[4]), +m[5]), list: null };
  const paren = s.match(/\(([^)]*)\)/);
  if (paren) {
    const list = paren[1].split(',').map((t) => t.trim().match(/^([A-Za-z]+)\s+(\d{1,2})$/)).filter((x) => x && monthNo(x[1]))
      .map((x) => isoOf(y1, monthNo(x[1]), +x[2]));
    if (list.length) out.list = list;
  }
  return out;
}

/* ----------------------------------------------------------------- data */
function takeMarket(j, shift) {
  if (!j || !Array.isArray(j.markets)) throw new Error('bad shape');
  const move = (iso) => (shift ? addDays(iso, shift) : iso);
  j.markets.forEach((m) => {
    const s = parseSeason(m.season_dates, m.season_year);
    m._season = s ? { start: move(s.start), end: move(s.end), list: s.list ? s.list.map(move) : null } : null;
    if (m.winter && Array.isArray(m.winter.dates)) m.winter._dates = m.winter.dates.filter((d) => /^\d{4}-\d\d-\d\d$/.test(d)).map(move).sort();
  });
  S.market = j;
}
function takeRescue(j) {
  if (!j || !Array.isArray(j.apps) || !Array.isArray(j.organizations)) throw new Error('bad shape');
  S.rescue = j;
}

function load() {
  if (app.demo) {
    return app.demoJSON(DEMO_FILE).then((j) => {
      const d = JSON.parse(JSON.stringify(j));   // the cached file stays as written
      /* the demo is written on its anchor day; whole weeks keep its weekdays */
      const shift = 7 * Math.round(daysBetween(d.anchor || todayIso(), todayIso()) / 7);
      try { takeMarket(d, shift); } catch (e) { S.marketFailed = true; }
      try { takeRescue(d.rescue); } catch (e) { S.rescueFailed = true; }
    }).catch(() => { S.marketFailed = true; S.rescueFailed = true; });
  }
  return Promise.all([
    data.fetchJSON(MARKET_URL, 10000).then((j) => takeMarket(j, 0)).catch(() => { S.marketFailed = true; }),
    data.fetchJSON(RESCUE_URL, 10000).then(takeRescue).catch(() => { S.rescueFailed = true; }),
  ]);
}

/* the rescue board: asked after the page is drawn; a server without it
   (the SQL not pasted yet) or no answer at all is "Opens soon" */
function loadBoard() {
  return boards.hasBoard('rescue').then((has) => {
    if (!has) { S.board = false; return null; }
    return boards.list('rescue', { kind: 'rescue', limit: RULES.limits.listMax }).then((r) => {
      if (r.ok) { S.board = true; S.posts = r.posts.filter(isFree); S.boardFailed = false; }
      else if (r.error === 'bad_board' || r.error === 'off') S.board = false;
      else { S.board = true; S.posts = []; S.boardFailed = true; }
    });
  }).catch(() => { S.board = false; }).then(() => { paint('rescue'); app.recount(); if (app.activeTab() === KEY) app.paintSubnav(); land(); });
}
/* free only: a post with any price above nothing is left out */
const isFree = (p) => { const v = p && p.meta ? p.meta.price : null; return v == null || v === '' || Number(v) === 0; };

/* ---------------------------------------------------------------- links */
function outLink(label, href, cls) {
  const a = el('a', cls || 'btn ghost sm', label);
  a.href = safeHref(href);
  if (/^https?:/i.test(a.href)) { a.target = '_blank'; a.rel = 'noopener'; }
  if (app.demo && a.target) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the page in the real build'); });
  return a;
}
const mapsUrl = (address) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address);
const mailto = (subject) => 'mailto:' + MAIL + '?subject=' + encodeURIComponent(subject);
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'the source'; } };
/* "Feeding Champlain Valley Food Shelf (formerly …)" -> the name before the brackets */
const shortName = (n) => String(n || '').replace(/\s*\([^)]*\)\s*$/, '');
const aside = (n) => (String(n || '').match(/\(([^)]*)\)\s*$/) || [])[1] || '';
const firstLine = (s, max = 110) => { const t = String(s || '').split(/(?<=\.)\s/)[0]; return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : t; };

function sheetRow(body, head, text) {
  if (!text) return;
  body.appendChild(el('div', 'sheet-h', esc(head)));
  body.appendChild(el('div', 'sheet-row', '<div class="t">' + esc(text) + '</div>'));
}
function sheetLinks(body, links, key, title) {
  const row = el('div', 'linkrow');
  links.filter(([, u]) => u).forEach(([label, u], i) => row.appendChild(outLink(esc(label), u, i ? 'btn ghost sm' : 'btn sm')));
  row.appendChild(button(ICON.share + ' Share', 'ghost sm', () => app.share(KEY, key, title)));
  body.appendChild(row);
}

/* A list row: a mark or a day tile, the words (a button that opens the
   sheet), and the pills on the right. Every row has its key and a link. */
function lrow(key, o) {
  const r = el('div', 'lrow' + (o.cls ? ' ' + o.cls : ''));
  r.dataset.k = key;
  const lines = (o.lines || []).filter(Boolean).map((l) => '<div class="s' + (l.one ? ' one' : '') + '">' + l.html + '</div>').join('');
  const open = el('button', 'open', '<div class="t">' + esc(o.title) + '</div>' + lines);
  open.type = 'button';
  open.setAttribute('aria-label', o.label || o.title);
  open.addEventListener('click', o.onOpen);
  S.open[key] = o.onOpen;
  r.append(o.tile || el('span', 'th bare', mark(o.title, 'round')), open);
  const acts = el('div', 'placeacts');
  (o.pills || []).filter(Boolean).forEach((p) => acts.appendChild(p));
  if (acts.children.length) r.appendChild(acts);
  return r;
}
function pillLink(label, href, aria) {
  const a = outLink(esc(label), href, 'pillbtn');
  if (aria) a.setAttribute('aria-label', aria);
  return a;
}
function pillButton(label, aria, fn) {
  const b = el('button', 'pillbtn', esc(label));
  b.type = 'button';
  b.setAttribute('aria-label', aria);
  b.addEventListener('click', fn);
  return b;
}
const failNote = (box, what) => box.appendChild(el('p', 'note pad', esc('Didn’t load.')));

/* ------------------------------------------------------------ This week */
/* a market on a day: its summer season, else its winter dates */
function on(m, iso) {
  const s = m._season;
  if (s && (m.days || []).includes(dowOf(iso)) && iso >= s.start && iso <= s.end && (!s.list || s.list.includes(iso))) {
    return { m, iso, name: m.name, hours: m.hours, where: m.address, accepts: m.accepts || [], vendors: m.vendors || [],
      vendorsUrl: m.vendors_url, source: m.source_url, website: m.website, season: m.season_dates ? 'Summer season: ' + m.season_dates : '' };
  }
  const w = m.winter;
  if (w && w._dates && w._dates.includes(iso)) {
    return { m, iso, winter: true, name: w.name || m.name + ' (winter)', hours: w.hours || m.hours, where: w.location || m.address,
      accepts: w.accepts || m.accepts || [], vendors: w.vendors || [], vendorsUrl: w.source_url, source: w.source_url || m.source_url,
      website: m.website, season: w._dates.length ? 'Winter dates: ' + w._dates.map(dayShort).join(', ') : '' };
  }
  return null;
}
/* the line a market with nothing this week says */
function whenBack(m, today) {
  const s = m._season, w = m.winter;
  if (s && today < s.start) {
    let first = s.list ? s.list[0] : s.start;
    for (let i = 0; !s.list && i < 7 && !(m.days || []).includes(dowOf(first)); i++) first = addDays(first, 1);
    return 'Opens ' + dayShort(first);
  }
  const next = w && w._dates ? w._dates.find((d) => d >= today) : null;
  if (next) return (w._dates[0] < today ? 'Next winter market ' : 'Winter market from ') + dayShort(next);
  if (w) {
    const days = (w.days || []).map((d) => DAY_PLURAL[d]).filter(Boolean).join(' and ');
    return 'Winter market' + (days ? ' on ' + days : '') + (w.hours ? ', ' + hoursText(w.hours) : '') + ', dates to come';
  }
  return s && today > s.end ? 'Season over' : 'No dates yet';
}

function paintWeek(box) {
  section(box, 'This week');
  if (!S.market) { failNote(box, 'The markets'); return; }
  const today = todayIso();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const seen = new Set();
  let any = false;
  days.forEach((iso, i) => {
    const hits = S.market.markets.map((m) => on(m, iso)).filter(Boolean);
    if (!hits.length) return;
    any = true;
    const t = el('div', 'tdiv', '<span>' + esc(i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayLong(iso)) + '</span>' +
      (i < 2 ? '<span class="s">' + esc(dayShort(iso)) + '</span>' : ''));
    box.appendChild(t);
    hits.forEach((x) => { seen.add(x.m.id); box.appendChild(weekRow(x)); });
  });
  if (!any) box.appendChild(el('p', 'note pad', esc('No farmers market this week.')));
  const rest = S.market.markets.filter((m) => !seen.has(m.id));
  if (rest.length) {
    box.appendChild(el('div', 'tdiv', '<span>' + esc('Not this week') + '</span>'));
    rest.forEach((m) => {
      const key = 'm-' + m.id;
      box.appendChild(lrow(key, {
        title: m.name, label: m.name + '. ' + whenBack(m, today),
        lines: [{ html: esc([m.town, DAY_PLURAL[(m.days || [])[0]], hoursText(m.hours)].filter(Boolean).join(' · ')) }, { html: '<b>' + esc(whenBack(m, today)) + '</b>' }],
        onOpen: () => marketSheet(key, { m, name: m.name, hours: m.hours, where: m.address, accepts: m.accepts || [], vendors: m.vendors || [],
          vendorsUrl: m.vendors_url, source: m.source_url, website: m.website, season: m.season_dates ? 'Summer season: ' + m.season_dates : '', back: whenBack(m, today) }),
      }));
    });
  }
}
function weekRow(x) {
  const key = 'm-' + x.m.id;
  const [dow, , dom] = dayShort(x.iso).replace(',', '').split(' ');
  const snap = x.accepts.some((a) => /snap/i.test(a));
  return lrow(key, {
    cls: 'meet',
    tile: el('span', 'th tm', '<b>' + esc(dom) + '</b><span>' + esc(dow) + '</span>'),
    title: x.name, label: x.name + ', ' + dayLong(x.iso) + ', ' + hoursText(x.hours) + ', ' + x.where,
    lines: [
      { html: '<b>' + esc(hoursText(x.hours)) + '</b> · ' + esc(x.where.split(',').slice(0, 2).join(',')), one: true },
      x.accepts.length ? { html: (snap ? '<span class="ok">' + esc('Takes SNAP') + '</span> · ' : '') + esc(x.accepts.filter((a) => !/snap/i.test(a)).join(', ')), one: true } : null,
    ],
    onOpen: () => marketSheet(key, x),
    pills: [pillButton('Vendors', 'Vendors at ' + x.name, () => vendorSheet(x))],
  });
}
function marketSheet(key, x) {
  app.sheet(x.name, (body) => {
    body.appendChild(el('p', 'sheet-note', esc([x.iso ? dayLong(x.iso) : x.back, hoursText(x.hours)].filter(Boolean).join(' · '))));
    sheetRow(body, 'Where', x.where);
    sheetRow(body, 'Pay with', x.accepts.join(', '));
    if (x.season) sheetRow(body, 'Dates', x.season);
    const v = el('div', 'linkrow');
    v.appendChild(button(esc(x.vendors.length ? 'All ' + x.vendors.length + ' vendors' : 'Vendors'), 'ghost sm', () => vendorSheet(x)));
    v.appendChild(outLink(ICON.pin + ' Map', mapsUrl(x.where), 'btn ghost sm'));
    body.appendChild(v);
    sheetLinks(body, [['Website', x.website], ['Source: ' + host(x.source), x.source]], key, x.name);
  });
}
/* "agriculture (category only; products not listed)" -> "agriculture" */
const cleanSells = (s) => String(s || '').replace(/\s*\((?:category only|products not listed)[^)]*\)/i, '').trim();
function vendorSheet(x) {
  app.sheet('Vendors: ' + x.name, (body) => {
    const list = x.vendors || [];
    if (!list.length) {
      body.appendChild(el('p', 'sheet-note', esc('No vendor list.')));
      if (x.vendorsUrl) { const r = el('div', 'linkrow'); r.appendChild(outLink('The market’s own list', x.vendorsUrl, 'btn sm')); body.appendChild(r); }
      return;
    }
    const byCat = list.every((v) => /category only/i.test(v.sells || ''));
    body.appendChild(el('p', 'sheet-note', esc(list.length + ' vendors')));
    let last = null;
    list.forEach((v) => {
      const cat = byCat ? cleanSells(v.sells) : null;
      if (byCat && cat !== last) { body.appendChild(el('div', 'sheet-h', esc(cat.charAt(0).toUpperCase() + cat.slice(1)))); last = cat; }
      const sells = byCat ? '' : cleanSells(v.sells);
      body.appendChild(el('div', 'sheet-row', '<div class="t">' + esc(v.name) + (sells ? '<div class="d">' + esc(sells) + '</div>' : '') + '</div>'));
    });
    if (x.source) { const r = el('div', 'linkrow'); r.appendChild(outLink('Source: ' + esc(host(x.source)), x.source)); body.appendChild(r); }
  });
}

/* ------------------------------------------------------------ In season */
function paintSeason(box) {
  section(box, 'In season');
  if (!S.market) { failNote(box, 'The produce chart'); return; }
  const m = Number(todayIso().slice(5, 7));
  const months = S.market.in_season || [];
  const now = months.find((x) => x.month === m);
  if (!now) { box.appendChild(el('p', 'note pad', esc('No produce chart for this month.'))); return; }
  const key = 'm-season-' + m;
  const tc = el('div', 'textcard');
  tc.dataset.k = key;
  tc.innerHTML = '<h3 class="serif">' + esc(now.month_name) + '</h3><p>' + esc((now.produce || []).join(' · ')) + '</p>';
  box.appendChild(tc);
}

/* ---------------------------------------------------------------- Farms */
function paintFarms(box) {
  const all = S.market ? S.market.farms_direct || [] : [];
  section(box, 'Farms');
  if (!S.market) { failNote(box, 'The farms'); return; }
  if (!all.length) { box.appendChild(el('p', 'note pad', esc('No farms listed yet.'))); return; }
  const shown = S.farmsAll ? all : all.slice(0, FIRST_FARMS);
  shown.forEach((f) => {
    const key = 'm-' + f.id;
    const sells = (Array.isArray(f.sells) ? f.sells : [f.sells]).filter(Boolean).join(', ');
    box.appendChild(lrow(key, {
      title: f.name,
      lines: [{ html: esc([f.town, sells].filter(Boolean).join(' · ')), one: true }, f.how_to_order ? { html: esc(firstLine(f.how_to_order)), one: true } : null],
      onOpen: () => farmSheet(key, f, sells),
      pills: [f.website ? pillLink('Website', f.website, f.name + ' website') : null],
    }));
  });
  if (!S.farmsAll && all.length > FIRST_FARMS) {
    box.appendChild(button('All ' + all.length + ' farms ' + ICON.arrow, 'ghost more', () => { S.farmsAll = true; paint('farms'); }));
  } else if (S.farmsAll && all.length > FIRST_FARMS) {
    box.appendChild(collapseBar('the farms', () => { S.farmsAll = false; paint('farms'); jump('farms'); }));
  }
}
function farmSheet(key, f, sells) {
  app.sheet(f.name, (body) => {
    body.appendChild(el('p', 'sheet-note', esc([f.town, sells].filter(Boolean).join(' · '))));
    sheetRow(body, 'How to order', f.how_to_order);
    sheetRow(body, 'Pickup', f.pickup);
    sheetRow(body, 'Price', f.price_note);
    sheetLinks(body, [['Website', f.website], ['Source: ' + host(f.source_url), f.source_url]], key, f.name);
  });
}

/* --------------------------------------------------------------- Fridge */
function paintFridge(box) {
  section(box, 'Fridge');
  if (!S.market) { failNote(box, 'The food shelves'); return; }
  box.appendChild(el('div', 'tdiv', '<span>' + esc('Food shelves') + '</span>'));
  (S.market.food_shelves || []).forEach((f) => {
    const key = 'm-' + f.id;
    box.appendChild(lrow(key, {
      title: shortName(f.name),
      lines: [{ html: esc(String(f.address || '').split(',').slice(0, 2).map((s) => s.trim()).join(', ')), one: true },
        f.hours ? { html: esc(firstLine(f.hours, 90)), one: true } : null],
      onOpen: () => shelfSheet(key, f),
    }));
  });
  box.appendChild(el('div', 'tdiv', '<span>' + esc('Community fridges') + '</span>'));
  /* only a fridge whose record says it runs; an unconfirmed one may be a
     home address, so nothing of it is drawn */
  const ok = (S.market.community_fridges || []).filter((f) => /^(confirmed|active)$/i.test(String(f.status || '')));
  ok.forEach((f) => {
    const key = 'm-' + f.id;
    box.appendChild(lrow(key, {
      title: shortName(f.name),
      lines: [{ html: esc([f.address, f.hours].filter(Boolean).join(' · ')), one: true }, f.operator ? { html: esc('Kept by ' + f.operator), one: true } : null],
      onOpen: () => fridgeSheet(key, f),
    }));
  });
  if (!ok.length) {
    const tc = el('div', 'textcard gap');
    tc.dataset.k = 'm-fridge-none';
    tc.innerHTML = '<p>' + esc('None confirmed.') + '</p>';
    const row = el('div', 'row');
    const a = el('a', 'btn ghost sm', ICON.mail + ' ' + esc('Tell us'));
    a.href = mailto('A community fridge in Burlington');
    a.dataset.mail = 'fridge';
    row.appendChild(a);
    tc.appendChild(row);
    box.appendChild(tc);
  }
}
function shelfSheet(key, f) {
  app.sheet(shortName(f.name), (body) => {
    const was = aside(f.name);
    body.appendChild(el('p', 'sheet-note', esc([was ? was.charAt(0).toUpperCase() + was.slice(1) : '', f.operator ? 'Run by ' + f.operator : ''].filter(Boolean).join('. '))));
    sheetRow(body, 'Hours', f.hours);
    sheetRow(body, 'Who can use it', f.who_can_use);
    sheetRow(body, 'What they ask for', f.what_they_ask_for);
    sheetRow(body, 'How to give', f.how_to_donate);
    sheetRow(body, 'Where', f.address);
    const r = el('div', 'linkrow');
    if (f.address) r.appendChild(outLink(ICON.pin + ' Map', mapsUrl(f.address), 'btn ghost sm'));
    if (f.wishlist_url) r.appendChild(outLink('Their wish list', f.wishlist_url, 'btn ghost sm'));
    body.appendChild(r);
    sheetLinks(body, [['Source: ' + host(f.source_url), f.source_url]], key, shortName(f.name));
  });
}
function fridgeSheet(key, f) {
  app.sheet(shortName(f.name), (body) => {
    sheetRow(body, 'Where', f.address);
    sheetRow(body, 'Hours', f.hours);
    sheetRow(body, 'Leave', (f.what_they_ask_for || []).join(', '));
    sheetRow(body, 'Please don’t leave', (f.what_not_to_leave || []).join(', '));
    sheetLinks(body, [['Source: ' + host(f.source_url), f.source_url]], key, shortName(f.name));
  });
}

/* --------------------------------------------------------------- Rescue */
function paintRescue(box) {
  const post = S.board ? button(ICON.plus + ' ' + esc('Post leftovers'), 'ghost sm', postLeftovers) : null;
  if (post) { post.dataset.act = 'rescuepost'; post.setAttribute('aria-label', 'Post free leftovers'); }
  section(box, 'Rescue', null, post);
  const b = el('div', 'tdiv', '<span>' + esc('Free food at closing') + '</span>');
  box.appendChild(b);
  if (S.board === undefined) box.appendChild(el('p', 'note pad', esc('Checking the board…')));
  else if (S.board === false) {
    const tc = el('div', 'textcard gap');
    tc.dataset.k = 'm-board-soon';
    tc.innerHTML = '<h3>' + esc('Opens soon') + '</h3>';
    const row = el('div', 'row');
    const a = el('a', 'btn ghost sm', ICON.mail + ' ' + esc('Run a kitchen? Tell us'));
    a.href = mailto('The rescue board: count our kitchen in');
    row.appendChild(a);
    tc.appendChild(row);
    box.appendChild(tc);
  } else {
    const feed = el('div', 'feed rescue-board');
    if (S.boardFailed) feed.appendChild(el('p', 'note pad', esc('The board didn’t load. Try again later.')));
    else if (!S.posts.length) feed.appendChild(el('p', 'note pad', esc('Nothing posted tonight.')));
    else boards.draw(feed, S.posts, { tab: KEY, meta: boardMeta });
    app.bindFeed(feed);
    box.appendChild(feed);
  }

  box.appendChild(el('div', 'tdiv', '<span>' + esc('Rescue groups') + '</span>'));
  if (!S.rescue) { failNote(box, 'The rescue groups'); return; }
  S.rescue.organizations.forEach((o) => {
    const key = 'm-' + o.id;
    box.appendChild(lrow(key, {
      title: shortName(o.name),
      lines: [{ html: esc(firstLine(o.what_they_do)), one: true }, o.area ? { html: esc(o.area), one: true } : null],
      onOpen: () => orgSheet(key, o),
      pills: [o.website ? pillLink('Website', o.website, shortName(o.name)) : null],
    }));
  });

  box.appendChild(el('div', 'tdiv', '<span>' + esc('Apps') + '</span>'));
  const rank = (a) => (a.serves_burlington === true ? 0 : a.serves_burlington === false ? 2 : 1);
  S.rescue.apps.slice().sort((a, b) => rank(a) - rank(b)).forEach((a) => {
    const key = 'm-' + a.id;
    const word = servesWord(a.serves_burlington);
    box.appendChild(lrow(key, {
      title: a.name,
      lines: [{ html: (a.serves_burlington === true ? '<span class="ok">' + esc(word) + '</span>' : '<b>' + esc(word) + '</b>') + ' · ' + esc(firstLine(a.what_it_is, 90)), one: true }],
      label: a.name + ': ' + word,
      onOpen: () => appSheet(key, a),
      pills: [a.website ? pillLink('Website', a.website, a.name) : null],
    }));
  });
}
function servesWord(v) {
  if (v === true) return 'Serves Burlington';
  if (v === false) return 'Not in Burlington';
  return 'Unclear here';
}
function boardMeta(p) {
  const m = p.meta || {};
  return [m.spot, m.until ? 'pick up by ' + m.until : '', Number(m.portions) ? m.portions + (Number(m.portions) === 1 ? ' portion' : ' portions') : '', 'Free'].filter(Boolean).join(' · ');
}
function postLeftovers() {
  boards.compose({
    board: 'rescue', kind: 'rescue', heading: 'Free food at closing', title: 'What’s left', titlePlaceholder: 'Eight bowls of noodles',
    fields: [
      { key: 'spot', type: 'text', label: 'Your restaurant', required: true, max: 60, placeholder: 'The name, and the street' },
      { key: 'until', type: 'text', label: 'Pick up by', required: true, max: 20, placeholder: '10 pm' },
      { key: 'portions', type: 'int', label: 'Portions', placeholder: '8' },
    ],
    body: 'How to pick it up', bodyPlaceholder: 'Side door on Bank St. Bring a bag.',
    notes: [FREE_NOTE, SAFE_NOTE],
    cta: 'Post it',
    onPosted: () => loadBoard(),
  });
}
function orgSheet(key, o) {
  app.sheet(shortName(o.name), (body) => {
    if (o.area) body.appendChild(el('p', 'sheet-note', esc(o.area)));
    sheetRow(body, 'What they do', o.what_they_do);
    sheetRow(body, 'If you run a kitchen', o.restaurants_donate);
    sheetRow(body, 'If you need food', o.people_get_food);
    sheetLinks(body, [['Website', o.website], ['Contact', o.contact_url !== o.website ? o.contact_url : null], ['Source: ' + host(o.source_url), o.source_url]], key, shortName(o.name));
  });
}
function appSheet(key, a) {
  app.sheet(a.name, (body) => {
    body.appendChild(el('p', 'sheet-note', esc(servesWord(a.serves_burlington) + '')));
    sheetRow(body, 'What it is', a.what_it_is);
    sheetRow(body, 'What we found', a.evidence);
    sheetRow(body, 'How to use it', a.how_to_use);
    sheetLinks(body, [['Website', a.website], ['Source: ' + host(a.source_url), a.source_url]], key, a.name);
  });
}

/* ----------------------------------------------------------- the page */
const PAINT = { week: paintWeek, season: paintSeason, farms: paintFarms, fridge: paintFridge, rescue: paintRescue };
function paint(k) {
  const box = S.slots && S.slots[k];
  if (!box) return;
  box.innerHTML = '';
  PAINT[k](box);
}
function draw() {
  const root = S.root;
  root.innerHTML = '';
  S.slots = Object.create(null);
  const page = el('div', 'shelf market');
  SECTIONS.forEach(([k]) => {
    const box = el('section', 'shelf-sec');
    box.dataset.sec = k;
    S.slots[k] = box;
    page.appendChild(box);
    PAINT[k](box);
  });
  root.appendChild(page);
  root.appendChild(el('div', 'spacer'));
  if (app.activeTab() === KEY) app.paintSubnav();
}
const jump = (k) => app.jumpTo(S.slots && S.slots[k]);

/* #market/<section> opens there; #market/m-<id> flashes that row and opens
   its sheet; #market/b-<id> flashes a board post */
function land() {
  const want = S.pending;
  if (!want || !S.ready) return;
  if (/^b-/.test(want) && S.board === undefined) return;   // the board is still on its way
  S.pending = null;
  if (S.slots && S.slots[want]) { jump(want); return; }
  if (/^m-/.test(want) && !S.farmsAll && S.market && (S.market.farms_direct || []).slice(FIRST_FARMS).some((f) => 'm-' + f.id === want)) {
    S.farmsAll = true; paint('farms');
  }
  if (!app.flashHit(S.root, want)) { app.toast('That’s gone from Market now.'); return; }
  if (S.open[want]) S.open[want]();
}

/* when the section's newest thing arrived, for the pill's freshest-first
   order and its dots: a market today, a free post on the board */
function newest(k) {
  const t = Math.floor(Date.now() / 1000);
  if (k === 'week' && S.market) {
    const today = todayIso();
    return S.market.markets.some((m) => on(m, today)) ? t - 2 * HOUR : null;
  }
  if (k === 'rescue' && S.posts && S.posts.length) {
    return Math.max(...S.posts.map((p) => Math.floor((Date.parse(p.created_at) || 0) / 1000)));
  }
  return null;
}

app.register(KEY, {
  label: 'Market',
  icon: ICON.basket,
  promise: 'Who’s at the market, what’s in season, food to rescue.',
  mount(root) {
    S.root = root;
    root.innerHTML = '<p class="loading">' + esc('Checking the markets…') + '</p>';
    load().then(() => {
      S.ready = true;
      draw();
      land();
      loadBoard();
    });
  },
  activate(param) { S.pending = param || null; land(); },
  refresh() { if (S.ready) draw(); },
  deactivate() {},
  subnav() {
    if (!S.ready) return null;
    return sectionBar({ key: 'sec-market', title: 'Market', color: app.APP.accent + '-pop', fresh: true,
      find: (k) => S.slots && S.slots[k], onPick: (k) => jump(k),
      items: SECTIONS.map(([key, label]) => ({ key, label, newest: newest(key) })) });
  },
  keepSubnav: true,
  newSince(ts) {
    const base = Number(ts) || Math.floor(Date.now() / 1000) - 4 * HOUR;
    return S.posts ? S.posts.filter((p) => (Date.parse(p.created_at) || 0) / 1000 > base).length : 0;
  },
});
