/* Today: All Day's front page (wave 1 of the eight apps, 2026-10-29; the
   map's Today row, newsletter/reference/drafts/apps-2026-10/APP-MAP.html).

   A dateline, "Today in Burlington", the date and the weather line Out's Now
   card carries (data/weather/latest.json, one fetch), then five short
   shelves, each three to five things from data another tab already reads,
   each ending in a link to the app that has the rest:

   - What matters. The Wire's local picks of the current ranking
     (wire-today.json through wire.js), in rank order. A row opens the
     story; "More in the Wire" opens the tab.
   - Tonight. What Now's Tonight: today's calendar from 5 pm on
     (all-day/data/whatnow.json), with the same rules (in Burlington's
     clock, gone once over, no cancelled or doubled listings). A row opens
     the listing in Out (#whatnow/e-<id>).
   - Open now. Restaurants open this minute (data/restaurants.json through
     js/food-lib.js, the hours engine Food and restaurants.html use), the
     ones with a write-up first, then nearest Church Street, as Food sorts.
     A row opens the place in Eat (#food/r-<id>).
   - Open plans. The People board's plans that happen in the next seven
     days, soonest first, read as anyone can read them (no sign-in). A row
     opens the plan in People (#people/b-<id>).
   - Your habits. What is due today from the habits kept on this phone
     (habits-local.js, the signed-out Habits), each with today's tick or
     its streak. With none, "No habits yet." and the way to Body.

   The shelves are freshest first (the shell's `fresh` rule): each one's
   time is when its newest thing arrived, and the pill of top tabs and the
   page take that order. Your habits has no such time and sits last. An
   empty shelf says so in a few words and keeps its link (DESIGN.md §10:
   a section is a title, no captions, no counts the button already says).

   Nothing is fetched until the tab first opens (a reader who lands on a
   Wire link never pays for the restaurant list). The page then waits for
   every source to answer, at most WAIT_MS, so it is
   drawn once in its order; a source that answers later fills its own shelf
   in place without moving the others.

   Nothing here is stored or sent. Rows are links: a tap on one in another
   app's tab opens that app (the shell's cross-app rule), so nothing in this
   file names a folder.

   ?demo=1 runs this same file on data/demo/today.json (the Wire's picks,
   tonight's calendar, a few restaurants and the weather, in their real
   shapes, with times moved to the reader's day), the boards' demo copy for
   plans and habits-fake.js's demo reader for habits. */

import * as app from '../app.js';
import * as data from '../wire.js';
import * as boards from '../boards.js';
import { el, esc, safeHref, ICON, art, mark, section } from '../ui.js';
import { sectionBar, freshOrder } from '../sections.js';
import { dayKey, addDays as addDayKeys, dueToday, streak } from '../habits-core.js';
import { LocalHabits, browserStorage } from '../habits-local.js';
import { FakeHabits, seedDemo } from '../habits-fake.js';

const KEY = 'today';
const MAX = 5;                         // a shelf shows three to five things
const EVENING = 17;                    // What Now's Tonight starts at 5 pm
const WAIT_MS = 2500;                  // the longest the page waits to draw in order
const WEEK = 7 * 86400000;
const FOOD_LIB = '../js/food-lib.js';
const CHURCH_ST = [44.4758, -73.2128];

/* the five shelves, in the order they have when none has a time yet */
const SHELVES = [
  { key: 'matters', label: 'What matters', more: ['wire', 'More in the Wire'],
    empty: 'No picks yet today.' },
  { key: 'tonight', label: 'Tonight', more: ['whatnow/tonight', 'More in Out'],
    empty: 'Nothing listed tonight.' },
  { key: 'open', label: 'Open now', more: ['food', 'More in Eat'],
    empty: 'Nothing open right now.' },
  { key: 'plans', label: 'Open plans', more: ['people', 'More in People'],
    empty: 'No plans this week.' },
  { key: 'habits', label: 'Your habits', more: ['habits', 'More in Body'],
    empty: 'No habits yet.' },
];

/* ---------------------------------------------------------------- time */
/* Burlington's clock, wherever the reader is (people.js and whatnow.js
   read time the same way) */
const BTV = 'America/New_York';
const ETP = new Intl.DateTimeFormat('en-US', { timeZone: BTV, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' });
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function et(ms) {
  const o = {};
  ETP.formatToParts(new Date(ms)).forEach((x) => { o[x.type] = x.value; });
  const x = { y: +o.year, mo: +o.month - 1, d: +o.day, h: +o.hour % 24, mi: +o.minute, dow: WD.indexOf(o.weekday) };
  x.date = x.y + '-' + String(x.mo + 1).padStart(2, '0') + '-' + String(x.d).padStart(2, '0');
  return x;
}
function etWall(y, mo, d, h, mi) {
  const want = Date.UTC(y, mo, d, h, mi);
  let t = want + 5 * 3600000;
  for (let i = 0; i < 3; i++) { const x = et(t); t += want - Date.UTC(x.y, x.mo, x.d, x.h, x.mi); }
  return t;
}
const addDays = (y, mo, d, n) => { const u = new Date(Date.UTC(y, mo, d + n, 12)); return { y: u.getUTCFullYear(), mo: u.getUTCMonth(), d: u.getUTCDate(), dow: u.getUTCDay() }; };
const clock = (ms) => { const x = et(ms); return ((x.h % 12) || 12) + (x.mi ? ':' + String(x.mi).padStart(2, '0') : '') + (x.h < 12 ? ' am' : ' pm'); };
const hhmm = (s) => { const [h, m] = String(s || '').split(':').map(Number); return ((h % 12) || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h % 24 < 12 ? ' am' : ' pm'); };
const DATELINE = new Intl.DateTimeFormat('en-US', { timeZone: BTV, weekday: 'long', month: 'long', day: 'numeric' });
const DAYWORD = new Intl.DateTimeFormat('en-US', { timeZone: BTV, weekday: 'long' });
const ago = (ms) => { const s = Math.max(0, (Date.now() - ms) / 1000); return s < 90 ? 'now' : s < 3600 ? Math.round(s / 60) + 'm' : s < 86400 ? Math.round(s / 3600) + 'h' : Math.round(s / 86400) + 'd'; };
const sec = (ms) => (ms ? Math.floor(ms / 1000) : 0);

/* A plan's "when" is words ("Sat, Oct 18, 7 pm", "Tonight, 7:30 pm",
   "Sunday, 8 am"), read from the day it was posted. People's own reader,
   whenMs() in modes/people.js, copied because that file registers the
   People tab when imported, and All Day no longer has one. */
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DOWS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6 };
function whenMs(text, createdMs) {
  const t = String(text || '').toLowerCase();
  const b = et(createdMs || Date.now());
  let day = null;
  let m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})\b(?:,? (\d{4}))?/);
  if (m) {
    const mo = MON.indexOf(m[1]), dd = Number(m[2]);
    let y = m[3] ? Number(m[3]) : b.y;
    if (!m[3] && Date.UTC(y, mo, dd) - Date.UTC(b.y, b.mo, b.d) < -60 * 86400000) y += 1;
    if (new Date(Date.UTC(y, mo, dd, 12)).getUTCDate() !== dd) return null;
    day = { y, mo, d: dd };
  } else if (/\b(today|tonight)\b/.test(t)) day = b;
  else if (/\btomorrow\b/.test(t)) day = addDays(b.y, b.mo, b.d, 1);
  else {
    m = t.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)\b/);
    if (m) day = addDays(b.y, b.mo, b.d, (DOWS[m[1]] - b.dow + 7) % 7);
  }
  if (!day) return null;
  let h = /\b(tonight|evening)\b/.test(t) ? 19 : /\bafternoon\b/.test(t) ? 14 : /\bmorning\b/.test(t) ? 9 : 12, min = 0;
  m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12 && Number(m[2] || 0) < 60) { h = (Number(m[1]) % 12) + (m[3] === 'pm' ? 12 : 0); min = Number(m[2] || 0); }
  return etWall(day.y, day.mo, day.d, h, min);
}

/* ------------------------------------------------------------- sources */
/* Each answers its payload, or null when it could not be had; none throws */
const once = (key) => new Promise((res) => data.load(key, res, () => res(null)));
const libs = {};
function script(src) {
  if (window.BTFood) return Promise.resolve(true);
  if (!libs[src]) libs[src] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => res(true);
    s.onerror = () => { delete libs[src]; rej(new Error('could not load ' + src)); };
    document.head.appendChild(s);
  });
  return libs[src];
}

/* the demo file, its times moved to the reader's day: `hours_ago` becomes
   a moment that long ago, an `at` of "19:30" tonight's 7:30 pm */
let demoP = null;
function demoFile() {
  if (!demoP) demoP = app.demoData(KEY).then((d) => {
    const now = Date.now(), t = et(now);
    const back = (h) => new Date(now - Number(h) * 3600000).toISOString();
    const tonightAt = (s) => { const [h, m] = String(s).split(':').map(Number); return new Date(etWall(t.y, t.mo, t.d, h, m || 0)).toISOString(); };
    const w = d.wire || {};
    w.date = t.date;
    w.updated = back(w.hours_ago || 0);
    (w.picks || []).forEach((p) => { p.posted_at = back(p.hours_ago || 0); });
    const ev = d.whatnow || {};
    ev.generated = back(ev.hours_ago || 0);
    (ev.events || []).forEach((e) => { e.start = tonightAt(e.at); if (e.until) e.end = tonightAt(e.until); });
    const food = d.restaurants || {};
    food.generated = back(food.hours_ago || 0);
    const wx = d.weather || {};
    if (wx.sun && wx.sun.at) wx.sun.sunset = tonightAt(wx.sun.at);
    if (wx.lake_gage) wx.lake_gage.water_temp_at = back(1);
    return d;
  });
  return demoP;
}
const SRC = app.demo ? {
  weather: () => demoFile().then((d) => d.weather || null),
  wire: () => demoFile().then((d) => d.wire || null),
  whatnow: () => demoFile().then((d) => d.whatnow || null),
  restaurants: () => Promise.all([script(FOOD_LIB), demoFile()]).then(([, d]) => d.restaurants || null),
} : {
  weather: () => once('weather'),
  wire: () => once('today'),
  whatnow: () => once('whatnow'),
  restaurants: () => Promise.all([script(FOOD_LIB), data.fetchJSON('../data/restaurants.json', 12000)]).then(([, j]) => j),
};

/* the habits on this phone (signed out), or the demo reader's */
function habitStore() {
  if (app.demo) { const f = new FakeHabits(); seedDemo(f, 'demo-today'); return f.as('demo-today'); }
  return new LocalHabits({ storage: browserStorage() });
}

/* ------------------------------------------------------------- shelves */
/* Each turns its source into { rows, newest, sub }: rows are
   { k, href, title, sub, thumb | tile | mark }, newest is epoch seconds */
function matters(p) {
  if (!p || !Array.isArray(p.picks)) return null;
  const sources = p.sources && typeof p.sources === 'object' ? p.sources : {};
  const picks = p.picks.filter((x) => x && x.id && x.url && x.title && x.local && !x.own)
    .sort((a, b) => (Number(a.rank) || 99) - (Number(b.rank) || 99)).slice(0, MAX);
  const today = et(Date.now()).date;
  const rows = picks.map((x) => {
    const ms = Date.parse(x.posted_at) || 0;
    const src = x.name || (sources[x.src] && sources[x.src].name) || x.src || '';
    return { k: String(x.id), href: x.url, title: x.title, sub: [src, ms ? ago(ms) : ''].filter(Boolean).join(' · '), thumb: x.thumb || '', mark: src, out: true };
  });
  const newest = Math.max(0, ...picks.map((x) => Date.parse(x.posted_at) || 0));
  return { rows, newest: sec(newest), sub: p.date && p.date !== today && rows.length ? 'From ' + DAYWORD.format(new Date(p.date + 'T12:00:00Z')) : '' };
}

function tonight(j) {
  if (!j || !Array.isArray(j.events)) return null;
  const now = Date.now(), today = et(now).date, seen = new Set();
  const list = j.events.filter((e) => {
    if (!e || !e.id || !e.title || !e.url || e.allDay || (e.status && e.status !== 'active')) return false;
    if (/^\s*(cancel+ed|postponed)\b/i.test(e.title)) return false;
    const start = Date.parse(e.start);
    if (!start) return false;
    const t = et(start);
    if (t.date !== today || t.h < EVENING) return false;
    const end = Date.parse(e.end) || 0;
    if (end ? end < now : start < now - 2 * 3600000) return false;
    const sig = e.title.toLowerCase().replace(/[^a-z0-9]+/g, '') + '|' + start;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const rows = list.slice(0, MAX).map((e) => {
    const [n, ap] = clock(Date.parse(e.start)).split(' ');
    const where = e.venue || e.town || 'Burlington';
    return { k: 'e-' + e.id, href: '#whatnow/e-' + e.id, title: e.title.replace(/^['‘’"“]+|['‘’"“]+$/g, ''), sub: [where, e.free ? 'Free' : ''].filter(Boolean).join(' · '), tile: [n, ap] };
  });
  return { rows, newest: sec(Date.parse(j.generated) || 0), sub: '' };
}

function openNow(j) {
  const F = window.BTFood;
  if (!F || !j || !Array.isArray(j.restaurants)) return null;
  const t = F.now(), names = new Set();
  const open = j.restaurants.filter((r) => {
    if (!r || !r.id || !r.name || r.closed || !r.hours || !Object.keys(r.hours).length) return false;
    if (r.closing && /temporar/i.test(r.closing.note || '')) return false;
    const n = r.name.toLowerCase();
    if (names.has(n) || !F.isOpenAt(r.hours, t.day, t.minutes)) return false;
    names.add(n);
    return true;
  }).map((r) => ({ r, mi: r.coords && r.coords.length === 2 ? F.haversineMiles(r.coords, CHURCH_ST) : 99 }))
    .sort((a, b) => (b.r.blurb ? 1 : 0) - (a.r.blurb ? 1 : 0) || a.mi - b.mi);
  const rows = open.slice(0, MAX).map(({ r }) => {
    const allNight = (r.hours[t.day] || []).some(([o, c]) => o === c);
    const until = allNight ? 'Open all night' : 'Open until ' + hhmm(F.closingTime(r.hours, t.day, t.minutes));
    return { k: 'r-' + r.id, href: '#food/r-' + r.id, title: r.name, sub: [until, r.neighborhood].filter(Boolean).join(' · '), mark: r.name, ok: true };
  });
  return { rows, newest: sec(Date.parse(j.generated) || 0), sub: '' };
}

function plans(r) {
  if (!r || !r.ok) return { rows: [], newest: 0, sub: '' };
  const now = Date.now();
  const list = r.posts.filter((p) => p && p.id && p.title).map((p) => {
    const created = Date.parse(p.created_at) || now;
    return { p, created, at: whenMs(p.meta && p.meta.when, created) };
  }).filter((x) => x.at && x.at > now - 2 * 3600000 && x.at < now + WEEK).sort((a, b) => a.at - b.at);
  const rows = list.slice(0, MAX).map(({ p }) => ({ k: 'b-' + p.id, href: '#people/b-' + p.id, title: p.title,
    sub: [p.meta && p.meta.when, p.place].filter(Boolean).join(' · '), mark: p.author || p.title }));
  return { rows, newest: sec(Math.max(0, ...list.map((x) => x.created))), sub: '' };
}

function habits() {
  let f;
  try { f = habitStore(); } catch (e) { return { rows: [], newest: 0, sub: '' }; }
  const now = Date.now(), today = dayKey(now);
  let list = [], taps = [];
  try {
    list = f.call('sz_habits_get');
    taps = f.call('sz_taps_get', { p_from: addDayKeys(today, -60), p_to: today });
  } catch (e) { list = []; }
  const tapsOf = (id) => taps.filter((t) => t.habit === id).map((t) => t.date);
  const due = list.filter((h) => dueToday(h, tapsOf(h.id), now));
  const rows = due.slice(0, MAX).map((h) => {
    const mine = tapsOf(h.id), done = mine.includes(today), n = streak(h, mine, now);
    return { k: 'h-' + h.id, href: '#habits', title: h.text, done,
      sub: done ? 'Done' : n ? n + (h.frequency === 'n_per_week' ? (n === 1 ? ' week' : ' weeks') : (n === 1 ? ' day' : ' days')) + ' in a row' : '', check: true };
  });
  const left = due.filter((h) => !tapsOf(h.id).includes(today)).length;
  return { rows, newest: 0, sub: due.length && !left ? 'All done' : '' };
}

/* -------------------------------------------------------------- render */
const S = { root: null, page: null, slots: Object.create(null), got: Object.create(null), wx: null, drawn: false, pending: null, ready: false };

function row(r) {
  const a = el('a', 'lrow' + (r.done ? ' done' : ''));
  a.dataset.k = r.k;
  a.href = safeHref(r.href);
  if (r.out) { a.target = '_blank'; a.rel = 'noopener'; }
  const th = r.tile ? el('span', 'th tm', '<b>' + esc(r.tile[0]) + '</b><span>' + esc(r.tile[1]) + '</span>')
    : r.thumb ? el('span', 'th', art(r.thumb))
      : r.check ? el('span', 'th bare', r.done ? ICON.check : ICON.habits)
        : el('span', 'th bare', mark(r.mark, 'round'));
  const words = el('div', '', '<div class="t">' + esc(r.title) + '</div>' + (r.sub ? '<div class="s one">' + (r.ok ? '<span class="ok">' + esc(r.sub.split(' · ')[0]) + '</span>' + esc(r.sub.slice(r.sub.split(' · ')[0].length)) : esc(r.sub)) + '</div>' : ''));
  a.append(th, words, el('span', '', r.out ? ICON.ext : ICON.right));
  if (r.out && app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the story in the real build'); });
  return a;
}

/* one shelf, drawn into its own box so a late source can fill it in place */
function paintShelf(sh) {
  const box = S.slots[sh.key];
  if (!box) return;
  const got = S.got[sh.key];
  box.innerHTML = '';
  const more = el('a', 'btn ghost sm', esc(sh.more[1]));
  more.href = '#' + sh.more[0];
  more.dataset.more = sh.more[0].split('/')[0];
  section(box, sh.label, got && got.sub ? esc(got.sub) : null, more);
  if (got === undefined) { box.appendChild(el('p', 'note pad', esc('Loading…'))); return; }
  if (!got || !got.rows.length) {
    const signedIn = sh.key === 'habits' && app.user();
    box.appendChild(el('p', 'note pad empty-shelf', esc(signedIn ? 'Your habits are in Body.' : sh.empty)));
    return;
  }
  const list = el('div', 'today-rows');
  got.rows.forEach((r) => list.appendChild(row(r)));
  box.appendChild(list);
}

/* the dateline: "Today in Burlington", the date, the weather line */
function dateline() {
  const head = el('div', 'today-head');
  head.dataset.sec = 'dateline';
  section(head, 'Today in Burlington', esc(DATELINE.format(new Date())));
  const w = S.wx;
  if (w) {
    const bits = [];
    const now = w.now || {};
    const temp = now.temp_f != null ? now.temp_f : now.feels_like_f;
    if (temp != null && Number.isFinite(Number(temp))) bits.push('<span><b>' + esc(Math.round(temp)) + '°</b>' + esc(String(now.description || '').toLowerCase()) + '</span>');
    if (now.feels_like_f != null && now.temp_f != null && Math.round(now.feels_like_f) !== Math.round(now.temp_f)) bits.push('<span><b>' + esc(Math.round(now.feels_like_f)) + '°</b> feels like</span>');
    const g = w.lake_gage;
    if (g && g.water_temp_f != null && g.water_temp_at && Date.now() - Date.parse(g.water_temp_at) < 24 * 3600000) bits.push('<span><b>' + esc(Math.round(g.water_temp_f)) + '°</b> lake</span>');
    const set = w.sun && Date.parse(w.sun.sunset);
    if (set && set > Date.now() - 3600000) bits.push('<span><b>' + esc(clock(set).replace(/ [ap]m$/, '')) + '</b> sunset</span>');
    if (bits.length) {
      const line = el('div', 'wx', bits.join(''));
      line.setAttribute('aria-label', 'Weather');
      head.appendChild(line);
    }
  }
  return head;
}

function order() {
  return freshOrder(SHELVES.map((sh) => ({ ...sh, newest: (S.got[sh.key] && S.got[sh.key].newest) || 0 })));
}

function draw() {
  S.drawn = true;
  S.root.innerHTML = '';
  S.page = el('div', 'today');
  S.page.appendChild(dateline());
  order().forEach((sh) => {
    const box = el('section', 'shelf-sec');
    box.dataset.sec = sh.key;
    S.slots[sh.key] = box;
    S.page.appendChild(box);
    paintShelf(sh);
  });
  S.root.appendChild(S.page);
  S.root.appendChild(el('div', 'spacer'));
  if (app.activeTab() === KEY) app.paintSubnav();
}

/* a deep link: #today/<shelf> opens there, #today/<row key> flashes it */
function land() {
  const want = S.pending;
  if (!want || !S.ready) return;
  S.pending = null;
  if (S.slots[want]) { app.jumpTo(S.slots[want]); return; }
  if (!app.flashHit(S.root, want)) app.toast('That’s gone from Today now.');
}

let loading = null;
function load() {
  if (loading) return loading;
  const take = (key, fn) => (v) => {
    let got = null;
    try { got = fn(v); } catch (e) { console.error('[all-day] today: ' + key, e); }
    S.got[key] = got;
    if (S.drawn) { paintShelf(SHELVES.find((s) => s.key === key)); app.recount(); }
  };
  const soft = (p) => Promise.resolve().then(p).catch(() => null);
  const all = [
    soft(SRC.weather).then((w) => { S.wx = w; if (S.drawn) { const h = S.root.querySelector('.today-head'); if (h) h.replaceWith(dateline()); } }),
    soft(SRC.wire).then(take('matters', matters)),
    soft(SRC.whatnow).then(take('tonight', tonight)),
    soft(SRC.restaurants).then(take('open', openNow)),
    soft(() => boards.list('people', { kind: 'plan', limit: 60 })).then(take('plans', plans)),
    soft(() => null).then(take('habits', habits)),
  ];
  loading = Promise.race([Promise.allSettled(all), new Promise((res) => setTimeout(res, WAIT_MS))]);
  return loading;
}

app.register(KEY, {
  label: 'Today',
  icon: ICON.sun,
  promise: 'Today in Burlington: what matters, what’s on tonight, who’s open, the plans people made and your habits, on one page.',
  mount(root) {
    S.root = root;
    root.innerHTML = '<p class="loading">Putting today together…</p>';
    load().then(() => { S.ready = true; draw(); land(); app.recount(); });
  },
  activate(param) { S.pending = param || null; land(); },
  refresh() {
    if (!S.ready) return;
    /* the habits are this phone's and can change in Body; the rest redraws as is */
    S.got.habits = habits();
    draw();
  },
  deactivate() {},
  subnav() {
    if (!S.ready) return null;
    return sectionBar({ key: 'sec-today', title: 'Today', color: '--app-all-day-pop', fresh: true,
      find: (k) => S.slots[k], onPick: (k) => app.jumpTo(S.slots[k]),
      items: order().map((sh) => ({ key: sh.key, label: sh.label, newest: (S.got[sh.key] && S.got[sh.key].newest) || 0 })) });
  },
  keepSubnav: true,
  /* the tab's dot: shelves with something newer than the last visit */
  newSince(ts) {
    const base = Number(ts) || 0;
    if (!base) return 0;
    return SHELVES.filter((sh) => S.got[sh.key] && S.got[sh.key].newest > base).length;
  },
});

/* for the tests */
export const _state = () => ({ ready: S.ready, order: order().map((s) => s.key),
  shelves: Object.fromEntries(SHELVES.map((sh) => [sh.key, S.got[sh.key] ? S.got[sh.key].rows.map((r) => r.k) : null])) });
