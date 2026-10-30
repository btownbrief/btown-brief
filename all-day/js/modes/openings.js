/* New (Eat app, wave 1, 2026-10-29): what just opened, and what to visit
   before it closes. We feature, we don't review: no scores, no rankings,
   nothing negative; a closing is a reason to go, a closed place is a memory.

   Data: data/eat/openings.json (scripts/eat/openings.py: every entry a
   verified news story, statuses recomputed from its dates each run). On
   ?demo=1, data/demo/eat-openings.json, the same shape on invented places, its
   dates moved so the file's `updated` day is today.

   A Food / Everything else chip on top (Food first; the choice lasts the
   visit), then one section per top tab, freshest first by the pill:
     just       Just opened   status just_opened, newest opening first
     soon       Coming soon   coming_soon, newest news first
     closing    Closing soon  closing_soon, soonest last day first
     closed     Closed        closed, most recent first (12, then All N)
     month      Last month    anything announced, opened or closed in the
                              last 31 days (Burlington's calendar), any status
     reminisce  Reminisce     closed places the Brief covered, each linking
                              to that edition (12, then All N)
   A row: the name, where it is, a plain date line, the story's note, its
   source, the edition when there is one, and Open now for a place that is
   in the restaurant guide. Month-only dates (YYYY-MM) count as mid-month,
   as the build script treats them.

   Deep links: #openings/<section key> jumps there; #openings/n-<id> flashes that
   place in its own section (switching the chip, opening Closed in full). */

import * as app from '../app.js';
import * as data from '../wire.js';
import { el, esc, safeHref, ICON, mark, section, chips, button, collapseBar } from '../ui.js';
import { sectionBar } from '../sections.js';

const KEY = 'openings';
const URL_LIVE = '../data/eat/openings.json';
const URL_DEMO = 'data/demo/eat-openings.json';
const FIRST = 12;                        // Closed and Reminisce show this many, then All N
const CAPPED = ['closed', 'reminisce'];
const MONTH_DAYS = 31;
const CATS = [['food', 'Food'], ['non-food', 'Everything else']];
const SECS = [
  ['just', 'Just opened'], ['soon', 'Coming soon'], ['closing', 'Closing soon'],
  ['closed', 'Closed'], ['month', 'Last month'], ['reminisce', 'Reminisce'],
];
/* the section a place belongs to, by its status (a deep link lands there) */
const HOME = { just_opened: 'just', coming_soon: 'soon', closing_soon: 'closing', closed: 'closed' };
const EMPTY = {
  just: 'Nothing new.', soon: 'Nothing announced.', closing: 'Nothing closing soon.',
  closed: 'Nothing closed lately.', month: 'Nothing this month.', reminisce: 'Nothing yet.',
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS = DAYS_LONG.map((d) => d.slice(0, 3));

const S = { all: null, cat: 'food', open: {}, ready: false, failed: false, today: null };
let root = null, slots = null, pending = null, loading = null;

/* ------------------------------------------------------------------ dates */
/* today on Burlington's calendar, as a day number */
function todayNum() {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return (parse(s) || { n: Math.floor(Date.now() / 864e5) }).n;
}
/* 'YYYY-MM-DD' or 'YYYY-MM' (mid-month) → { y, m, d, month, n } (n: days since 1970) */
function parse(s) {
  const x = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(s || ''));
  if (!x) return null;
  const y = +x[1], m = +x[2], d = x[3] ? +x[3] : 15;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d, month: !x[3], n: Date.UTC(y, m - 1, d) / 864e5 };
}
const fromNum = (n) => { const t = new Date(n * 864e5); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const thisYear = () => fromNum(S.today).y;
/* a day as epoch seconds (about noon in Burlington), never later than now */
const epoch = (n) => Math.min(Math.floor(Date.now() / 1000), n * 86400 + 16 * 3600);
const yr = (p) => (p.y !== thisYear() ? ', ' + p.y : '');
const yrIn = (p) => (p.y !== thisYear() ? ' ' + p.y : '');
function plainDay(p, weekday) {
  if (p.month) return 'in ' + MONTHS[p.m - 1] + yrIn(p);
  if (p.n === S.today) return 'today';
  if (p.n === S.today - 1) return 'yesterday';
  if (p.n === S.today + 1) return 'tomorrow';
  return (weekday ? DAYS[new Date(p.n * 864e5).getUTCDay()] + ', ' : '') + MONTHS[p.m - 1].slice(0, 3) + ' ' + p.d + yr(p);
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const ordinal = (d) => d + ((d % 100 >= 11 && d % 100 <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][d % 10] || 'th');

/* ------------------------------------------------------------------ data */
function take(j, demo) {
  const list = j && Array.isArray(j.entries) ? j.entries : null;
  if (!list) throw new Error('no entries');
  /* the demo's dates move with the calendar: its `updated` day is today */
  const base = parse(j.updated);
  const shift = demo && base ? S.today - base.n : 0;
  const mv = (s) => {
    const p = parse(s);
    if (!p || !shift) return s || null;
    const q = fromNum(p.n + shift);
    return q.y + '-' + String(q.m).padStart(2, '0') + (p.month ? '' : '-' + String(q.d).padStart(2, '0'));
  };
  S.all = list.filter((e) => e && e.id && e.name && (HOME[e.status] || e.status === 'open')).map((e) => {
    const ed = e.edition && e.edition.archive_url ? { ...e.edition, date: mv(e.edition.date) } : null;
    if (ed && (shift || !ed.title)) { const p = parse(ed.date); if (p) ed.title = DAYS_LONG[new Date(p.n * 864e5).getUTCDay()] + ', ' + MONTHS[p.m - 1] + ' ' + ordinal(p.d); }
    const x = { ...e, cat: e.category === 'non-food' ? 'non-food' : 'food', edition: ed,
      announced: mv(e.announced), opened: mv(e.opened), closing: mv(e.closing), closed: mv(e.closed), expected_open: mv(e.expected_open) };
    x.k = 'n-' + e.id;
    x.P = { a: parse(x.announced), o: parse(x.opened), c: parse(x.closing), x: parse(x.closed), e: parse(x.expected_open), ed: ed ? parse(ed.date) : null };
    /* when it was news: announced, else the edition that covered it */
    x.news = (x.P.a || x.P.ed || x.P.o || x.P.x || { n: 0 }).n;
    /* the newest of its dates inside the last month, for Last month */
    const recent = [x.P.a, x.P.o, x.P.x].filter((p) => p && p.n <= S.today && p.n > S.today - MONTH_DAYS - 1).map((p) => p.n);
    x.recent = recent.length ? Math.max(...recent) : 0;
    return x;
  });
}

function load() {
  if (!loading) {
    S.today = todayNum();
    const got = app.demo ? app.demoJSON(URL_DEMO) : data.fetchJSON(URL_LIVE, 10000);
    loading = got.then((j) => { S.raw = j; take(j, app.demo); }).catch(() => { S.all = null; S.failed = true; })
      .then(() => { S.ready = true; app.recount(); });
  }
  return loading;
}

const by = (f) => (a, b) => f(b) - f(a);
/* each section's places in the chip's category, in the section's order */
function lists() {
  const mine = (S.all || []).filter((e) => e.cat === S.cat);
  const day = (p) => (p ? p.n : 0);
  return {
    just: mine.filter((e) => e.status === 'just_opened').sort(by((e) => day(e.P.o) || e.news)),
    soon: mine.filter((e) => e.status === 'coming_soon').sort(by((e) => e.news)),
    closing: mine.filter((e) => e.status === 'closing_soon').sort((a, b) => (day(a.P.c) || 1e9) - (day(b.P.c) || 1e9)),
    closed: mine.filter((e) => e.status === 'closed').sort(by((e) => day(e.P.x) || day(e.P.c) || e.news)),
    month: mine.filter((e) => e.recent).sort(by((e) => e.recent)),
    reminisce: mine.filter((e) => e.status === 'closed' && e.edition).sort(by((e) => day(e.P.ed))),
  };
}
/* the day a section's newest thing happened, for freshest first and the dots */
function newestOf(k, list) {
  const n = list.map((e) => k === 'just' ? (e.P.o ? e.P.o.n : e.news) : k === 'closed' ? (e.P.x ? e.P.x.n : e.news)
    : k === 'month' ? e.recent : k === 'reminisce' ? (e.P.ed ? e.P.ed.n : 0) : e.news).filter((d) => d && d <= S.today);
  return n.length ? epoch(Math.max(...n)) : null;
}

/* ------------------------------------------------------------------ rows */
function dateLine(e) {
  const P = e.P;
  if (e.status === 'just_opened') return P.o ? 'Opened ' + plainDay(P.o) : 'Just opened';
  if (e.status === 'closing_soon') return P.c ? 'Last day ' + plainDay(P.c, true) : 'Closing soon';
  if (e.status === 'closed') return P.x ? 'Closed ' + plainDay(P.x) : P.c ? 'Closed ' + plainDay(P.c) : 'Closed';
  if (e.status === 'coming_soon') {
    if (P.e && P.e.n >= S.today) return 'Expected ' + plainDay(P.e);
    if (e.date_label) return cap(String(e.date_label));
    return P.a ? 'Announced ' + plainDay(P.a) : 'Coming soon';
  }
  return P.o ? 'Open since ' + plainDay(P.o).replace(/^in /, '') : 'Open';
}
function outLink(label, href, ours) {
  const a = el('a', 'pillbtn', esc(label) + (ours ? '' : ' ' + ICON.ext));
  a.href = safeHref(href);
  if (!ours) { a.target = '_blank'; a.rel = 'noopener'; }
  if (app.demo && !ours) a.addEventListener('click', (ev) => { ev.preventDefault(); app.toast(label + ' opens in the real build'); });
  return a;
}
function editionLabel(ed) {
  const p = parse(ed.date);
  return 'The Brief, ' + (p ? plainDay(p) : ed.title || 'an edition');
}
/* the date the row is about, as a tile: the last day, the day it closed or
   opened, the day it's expected, else the day it was announced */
function tileDate(e) {
  const P = e.P;
  const d = e.status === 'closing_soon' ? P.c : e.status === 'closed' ? P.x || P.c : e.status === 'coming_soon' ? (P.e && P.e.n >= S.today ? P.e : P.a)
    : P.o || P.a;
  if (!d) return '<b>' + esc('·') + '</b>';
  return d.month ? '<b>' + esc(MONTHS[d.m - 1].slice(0, 3)) + '</b><span>' + esc(String(d.y)) + '</span>'
    : '<b>' + esc(String(d.d)) + '</b><span>' + esc(MONTHS[d.m - 1].slice(0, 3)) + '</span>';
}
/* the street and the town, once: "Riverside Ave, Burlington" and "317
   Riverside Ave" are one place */
function whereOf(e) {
  const hood = String(e.neighborhood || '');
  const town = hood.includes(',') ? hood.split(',').pop().trim() : hood;
  return [e.address, town].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · ');
}
function row(e, memory) {
  const r = el('div', 'lrow meet');
  r.dataset.k = e.k;
  const where = whereOf(e);
  const body = el('div', 'open',
    '<div class="t">' + esc(e.name) + '</div>' +
    (where ? '<div class="s">' + esc(where) + '</div>' : '') +
    '<div class="s"><b>' + esc(dateLine(e)) + '</b></div>' +
    (e.note ? '<div class="s">' + esc(e.note) + '</div>' : ''));
  const links = el('div', 'linkrow');
  if (memory && e.edition) links.appendChild(outLink(editionLabel(e.edition), e.edition.archive_url));
  if (e.source) links.appendChild(outLink(e.source_name || 'The story', e.source));
  if (e.restaurant_id && (e.status === 'open' || e.status === 'just_opened')) links.appendChild(outLink('Open now', '#food/r-' + e.restaurant_id, true));
  if (links.children.length) body.appendChild(links);
  r.append(el('span', 'th tm', tileDate(e)), body);
  return r;
}
/* Reminisce: the edition that covered it leads the links */
const memoryRow = (e) => row(e, true);

/* ---------------------------------------------------------------- render */
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
function render() {
  if (!root) return;
  root.innerHTML = '';
  slots = Object.create(null);
  if (!S.all) {
    root.appendChild(el('div', 'errbox', '<b>New didn’t load.</b> Try again in a minute.'));
    return;
  }
  const L = lists();
  const count = (c) => { const was = S.cat; S.cat = c; const l = lists(); S.cat = was; return new Set(Object.values(l).flat().map((e) => e.id)).size; };
  root.appendChild(chips(CATS.map(([key, label]) => ({ key, label, n: count(key) })), S.cat, (k) => {
    if (k === S.cat) return;
    S.cat = k; S.open = {}; render();
    if (app.activeTab() === KEY) app.paintSubnav();
  }, 'newcats'));
  const feed = el('div', 'shelf');
  SECS.forEach(([k, label]) => {
    const list = L[k];
    const box = el('section', 'shelf-sec');
    box.dataset.sec = k;
    section(box, label);
    if (!list.length) box.appendChild(el('p', 'note pad', esc(EMPTY[k])));
    const capped = CAPPED.includes(k);
    const shown = capped && !S.open[k] ? list.slice(0, FIRST) : list;
    shown.forEach((e) => box.appendChild(k === 'reminisce' ? memoryRow(e) : row(e)));
    if (capped && list.length > shown.length) {
      box.appendChild(button('All ' + list.length + ' ' + ICON.arrow, 'ghost more', () => { S.open[k] = true; render(); }));
    } else if (capped && S.open[k] && list.length > FIRST) {
      box.appendChild(collapseBar(k === 'closed' ? 'the closed places' : 'the memories', () => { S.open[k] = false; render(); app.jumpTo(slots[k]); }));
    }
    feed.appendChild(box);
    slots[k] = box;
  });
  root.appendChild(feed);
  root.appendChild(el('div', 'spacer'));
}

/* #openings/<section> jumps there; #openings/n-<id> flashes that place where it lives */
function land() {
  if (!pending || !S.ready || !root) return;
  const k = pending; pending = null;
  if (!S.all) return;
  if (slots && slots[k]) { app.jumpTo(slots[k]); return; }
  const e = /^n-/.test(k) && S.all.find((x) => x.k === k);
  if (!e) { app.toast('That one isn’t on New any more.'); return; }
  let redraw = false;
  if (e.cat !== S.cat) { S.cat = e.cat; redraw = true; }
  const home = HOME[e.status] || (e.recent ? 'month' : null);
  if (CAPPED.includes(home) && !S.open[home] && lists()[home].indexOf(e) >= FIRST) { S.open[home] = true; redraw = true; }
  if (redraw) { render(); if (app.activeTab() === KEY) app.paintSubnav(); }
  if (!(home && app.flashHit(slots[home], k)) && !app.flashHit(root, k)) app.toast('That one isn’t on New any more.');
}

app.register(KEY, {
  label: 'New',
  icon: ICON.spark,
  promise: 'What just opened, and what to visit before it closes.',
  mount(r) {
    root = r;
    r.innerHTML = '<p class="loading">Checking what’s new…</p>';
    load().then(() => {
      render();
      if (app.activeTab() === KEY) app.paintSubnav();
      land();
    });
  },
  activate(param) {
    pending = param || null;
    /* past midnight in Burlington: today, yesterday and Last month move */
    if (S.ready && S.raw && todayNum() !== S.today) { S.today = todayNum(); take(S.raw, app.demo); if (root) render(); }
    land();
  },
  refresh() { if (S.ready && root) render(); },
  deactivate() {},
  subnav() {
    if (!S.ready || !S.all || !slots) return null;
    const L = lists();
    return sectionBar({ key: 'sec-' + app.APP.id + '-' + KEY, title: 'New', color: app.APP.accent + '-pop', fresh: true,
      find: (k) => slots && slots[k], onPick: (k) => app.jumpTo(slots && slots[k]),
      items: SECS.map(([key, label]) => ({ key, label, n: L[key].length, newest: newestOf(key, L[key]) })) });
  },
  keepSubnav: true,
  /* places in the chip's category that were news after ts */
  newSince(ts) {
    if (!S.all) return 0;
    const t = Number(ts) || 0;
    if (!t) return 0;                     // a first visit: nothing is "new" yet
    return S.all.filter((e) => e.cat === S.cat && e.news && epoch(e.news) > t).length;
  },
});

/* read before the tab is opened, so its dot is honest */
setTimeout(load, 0);
