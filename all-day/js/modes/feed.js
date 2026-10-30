/* Town · Now: everything that changed in Burlington, in one feed.

   data/town/feed.json, which scripts/town/build_feed.py writes, holds every
   tile, newest arrival first. This file draws them. The hero says how many
   are new since this phone last looked and whether anything is wrong. Under
   it, the day's house to guess, then the feed, with a "You're caught up"
   line where the new ones stop. The pill filters by kind, freshest kind
   first.

   Tiles with a place show the state's aerial photo of it, stored with the site
   in data/town/aerials so a reader never calls the state's server. A private
   home is shown by street at a neighborhood's width; the build never gives
   this file its house number.

   Guess the price: a sale keeps its price back until the reader picks one of
   three. Picks and the run are kept on this phone.

   Every reader-facing word of the tab is in COPY. */

import * as app from '../app.js';
import * as store from '../store.js';
import { el, esc, ICON, agoShort, safeHref } from '../ui.js';
import { sectionBar } from '../sections.js';
import { getJSON, fmtDay, money, shortMoney, daysTo, today, plusDays } from './town-kit.js';

const COPY = {
  label: 'Now',
  promise: 'What changed in Burlington',
  loading: 'Loading',
  failed: 'Didn’t load',
  empty: 'Nothing here yet',
  all: 'Latest',
  isNew: 'New',
  caught: 'You’re caught up',
  fresh: (n) => (n === 1 ? '1 new' : n + ' new'),
  since: 'since you checked',
  quiet: 'Nothing new yet',
  noBan: 'No ban posted',
  ban: 'Parking ban',
  noClosings: 'No school closings or delays',
  closings: (n) => (n === 1 ? '1 school closing or delay' : n + ' school closings or delays'),
  run: (n) => n + ' in a row',
  got: (n) => (n === 1 ? '1 new tile' : n + ' new tiles'),
  guess: 'Guess the price',
  hot: 'Most talked about',
  guessLabel: (v) => 'Guess ' + v,
  right: 'You got it',
  rightRun: (n) => n + ' in a row',
  wrong: 'Not this one',
  sold: (d) => 'Sold ' + d,
  assessed: (v) => 'Assessed at ' + v,
  agenda: 'Agenda posted',
  dated: 'On the calendar',
  meetings: 'Coming up at City Hall',
  allMeetings: (n) => 'All ' + n,
  jobsWord: (n) => (n === 1 ? 'new job' : 'new jobs'),
  jobs: (n) => n + ' ' + COPY.jobsWord(n),
  allJobs: 'See them',
  permitsWord: (n) => (n === 1 ? 'permit filed' : 'permits filed'),
  permits: (n) => n + ' ' + COPY.permitsWord(n),
  work: (v) => v + ' of work',
  sites: (n) => n + ' sites',
  talk: (s, c) => [s != null ? (s === 1 ? '1 upvote' : s + ' upvotes') : '', c != null ? (c === 1 ? '1 comment' : c + ' comments') : ''].filter(Boolean).join(' · '),
  opens: (n) => (n <= 0 ? 'Opens today' : n === 1 ? 'Opens tomorrow' : 'Opens in ' + n + ' days'),
  more: (n) => (n > 1 ? ' · ' + (n - 1) + ' more that day' : ''),
  moved: 'That one has moved on',
  share: 'Share',
  save: 'Save',
  source: 'Town',
  openSource: 'Open the source',
  tags: { sold: 'Sold', going: 'Going in', week: 'Permits', city: 'City Hall', cityweek: 'City Hall', road: 'Construction',
    food: 'Food', jobs: 'Jobs', signup: 'Signups', weather: 'Weather', reddit: 'r/burlington' },
};

/* the pill's kinds; Signups and Weather only show under All */
const LANES = [
  { key: 'homes', label: 'Homes', kinds: ['sold'] },
  { key: 'going', label: 'Going in', kinds: ['going', 'week'] },
  { key: 'city', label: 'City Hall', kinds: ['city', 'cityweek'] },
  { key: 'roads', label: 'Roads', kinds: ['road'] },
  { key: 'food', label: 'Food', kinds: ['food'] },
  { key: 'jobs', label: 'Jobs', kinds: ['jobs'] },
  { key: 'reddit', label: 'Reddit', kinds: ['reddit'] },
];

const FEED_URL = '../data/town/feed.json';
const SEEN_KEY = 'town-feed-seen';
const BASE_KEY = 'town-feed-base';
const GUESS_KEY = 'town-feed-guess';
const RUN_KEY = 'town-feed-run';
const FIRST_LOOK = 36 * 3600000;   // a phone that has never looked: the last day and a half is new
const STALE = 10 * 60000;          // how old a copy gets, and how long away counts as away
const DAY = 86400000;
const HOT_DAYS = 3;                // how long a thread can hold the top
const HOT_MIN = 10;                // comments before a thread counts

/* the phone's memory; the demo keeps its own for the visit and writes nothing */
const mem = new Map();
const keep = {
  get: (k, f) => (app.demo ? (mem.has(k) ? mem.get(k) : f) : store.read(k, f)),
  put: (k, v) => { if (app.demo) mem.set(k, v); else store.write(k, v); },
};

const S = { root: null, tiles: [], status: {}, pick: null, hot: null, filter: 'all', base: 0, loaded: false, failed: false, at: 0, pending: null, version: '', next: null, left: 0, rebase: 0, first: false };

/* ------------------------------------------------------------- the aerials */
const hasPic = (t) => !app.demo && !!t.img;
const pic = (t) => '<img class="tf-pic" src="../data/town/aerials/' + esc(t.img) + '" alt="" loading="lazy" decoding="async">';

/* ----------------------------------------------------------- guess the price */
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const nearest = (n) => { const step = n >= 1e6 ? 25000 : 5000; return Math.round(n / step) * step; };
const short = (n) => (n >= 1e6 ? '$' + Number((n / 1e6).toFixed(2)) + 'M' : '$' + Math.round(n / 1000) + 'K');
/* three round prices, low to high: the real one and two near enough to make
   you think. Which slot it lands in comes from the sale's id, so a reader
   can't learn the middle one is always right, and it never changes. */
export function options(t) {
  const h = hash(t.id);
  const real = nearest(t.price);
  const step = t.price >= 1e6 ? 25000 : 5000;
  const a = (n) => (h >> n) % 9 / 100;
  const shape = [[0.62 + a(2), 0.79 + a(6)], [0.72 + a(2), 1.22 + a(6)], [1.18 + a(2), 1.42 + a(6)]][h % 3];
  const out = new Set([real]);
  shape.forEach((f) => {
    const dir = f < 1 ? -step : step;
    let v = nearest(t.price * f);
    while (out.has(v)) v += dir;
    if (v <= 0) v = Math.max(...out) + step;
    out.add(v);
  });
  return [...out].sort((x, y) => x - y);
}
const guesses = () => { const g = keep.get(GUESS_KEY, {}); return g && typeof g === 'object' ? g : {}; };
const run = () => Number(keep.get(RUN_KEY, 0)) || 0;
function guessBar(t) {
  const mine = guesses()[t.id];
  if (mine !== undefined) return resultBar(t, mine, false);
  return '<div class="tf-opts">' + options(t).map((v) => '<button class="tf-opt" data-pick="' + v + '" aria-label="' + esc(COPY.guessLabel(short(v))) + '">' + esc(short(v)) + '</button>').join('') + '</div>';
}
function resultBar(t, mine, justNow) {
  const hit = Number(mine) === nearest(t.price);
  const n = run();
  const said = justNow ? (hit ? (n > 1 ? COPY.rightRun(n) : COPY.right) : COPY.wrong) : '';
  return '<div class="tf-result' + (hit ? ' hit' : ' miss') + '"><b class="tf-price">' + esc(money(t.price)) + '</b>' +
    (said ? '<span class="tf-said">' + esc(said) + '</span>' : '') +
    (t.assessed ? '<span class="tf-assessed">' + esc(COPY.assessed(money(t.assessed))) + '</span>' : '') + '</div>';
}
/* the price counts up to itself, because a reveal is the reward */
function countUp(node, to) {
  if (!node || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / 650);
    node.textContent = money(Math.round(to * (1 - Math.pow(1 - p, 3)) / 500) * 500);
    if (p < 1) requestAnimationFrame(step); else node.textContent = money(to);
  };
  requestAnimationFrame(step);
}
function pickPrice(btn) {
  const c = btn.closest('[data-id]');
  const t = S.tiles.find((x) => x.id === c.dataset.id);
  if (!t) return;
  const v = Number(btn.dataset.pick);
  const hit = v === nearest(t.price);
  const g = guesses();
  g[t.id] = v;
  keep.put(GUESS_KEY, g);
  keep.put(RUN_KEY, hit ? run() + 1 : 0);
  const bar = c.querySelector('.tf-guess');
  bar.innerHTML = resultBar(t, v, true);
  countUp(bar.querySelector('.tf-price'), t.price);
  if (hit && navigator.vibrate) navigator.vibrate(14);
  paintRun();
}
function paintRun() {
  const n = run();
  const chip = S.root && S.root.querySelector('.tf-chip.run');
  if (chip) { chip.hidden = n < 2; chip.textContent = COPY.run(n); }
}

/* --------------------------------------------------------------- the tiles */
const ms = (t) => Date.parse(t.ts) || 0;
const fresh = (t) => ms(t) > S.base;
const stamp = (t) => {
  const when = ms(t), age = Date.now() - when;
  return age < 2 * DAY ? agoShort(when / 1000) : new Date(when).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
};
const titleOf = (t) => ({ jobs: COPY.jobs(t.n), week: COPY.permits(t.n), cityweek: COPY.meetings }[t.kind] || t.title);
const head = (t) => '<div class="tf-head"><span class="tf-tag eyebrow">' + esc(t === S.pick ? COPY.guess : t === S.hot ? COPY.hot : COPY.tags[t.kind]) + '</span>' +
  (fresh(t) ? '<span class="tf-new">' + esc(COPY.isNew) + '</span>' : '') + '<span class="tf-when">' + esc(stamp(t)) + '</span></div>';
function acts(it) {
  const on = store.isSaved(it.k);
  return '<span class="tf-acts"><button class="act sh" data-act="share" aria-label="' + esc(COPY.share) + '">' + ICON.share + '</button>' +
    '<button class="act star' + (on ? ' on' : '') + '" data-act="save" aria-label="' + esc(COPY.save) + '" aria-pressed="' + on + '">' + ICON.star + '</button></span>';
}
/* the whole tile is the link; buttons sit above it */
const out = (t) => (t.url ? '<a class="tf-go" href="' + esc(safeHref(t.url)) + '"' + (/^https?:/.test(t.url) ? ' target="_blank" rel="noopener" data-open' : '') + ' aria-label="' + esc(titleOf(t)) + '"></a>' : '');
const words = (t, sub) => '<div class="tf-words"><h3 class="tf-title">' + esc(titleOf(t)) + '</h3>' + (sub ? '<p class="tf-sub">' + esc(sub) + '</p>' : '') + '</div>';
const frame = (t, it, inner, sub, big) => '<div class="tf-frame">' + (hasPic(t) ? pic(t) : '') + head(t) + (inner || '') +
  '<div class="tf-foot">' + words(t, sub) + (big ? '<b class="tf-big">' + esc(big) + '</b>' : '') + acts(it) + '</div></div>';
const dateBox = (day) => { const [, m, d] = fmtDayParts(day); return '<span class="tf-date"><span class="eyebrow">' + esc(m) + '</span><b>' + esc(d) + '</b></span>'; };
function fmtDayParts(day) {
  const s = fmtDay(day);                    // 'Mon, Nov 2'
  const m = s.match(/^(\w+),\s+(\w+)\s+(\d+)/);
  return m ? [m[1], m[2], m[3]] : ['', '', ''];
}

const DRAW = {
  sold: (t, it) => frame(t, it, '', t.closed ? COPY.sold(fmtDay(t.closed).replace(/^\w+, /, '')) : '') + '<div class="tf-guess">' + guessBar(t) + '</div>',
  going: (t, it) => frame(t, it, out(t), [t.where, t.what !== t.title ? t.what : ''].filter(Boolean).join(' · '), t.cost >= 1000 ? shortMoney(t.cost) : ''),
  road: (t, it) => frame(t, it, out(t), [t.what, t.n > 1 ? COPY.sites(t.n) : ''].filter(Boolean).join(' · ')),
  food: (t, it) => frame(t, it, out(t)),
  reddit: (t, it) => frame(t, it, out(t), COPY.talk(t.score, t.comments)),
  weather: (t, it) => frame(t, it, out(t)),
  signup: (t, it) => frame(t, it, out(t), COPY.opens(daysTo(t.day)) + COPY.more(t.n)),
  city: (t, it) => '<div class="tf-frame">' + head(t) + out(t) + '<div class="tf-foot">' + dateBox(t.day) + words(t, [t.sub, t.agenda ? COPY.agenda : COPY.dated].filter(Boolean).join(' · ')) + acts(it) + '</div></div>',
  cityweek: (t, it) => '<div class="tf-frame">' + head(t) + '<h3 class="tf-title">' + esc(COPY.meetings) + '</h3><ul class="tf-rows">' +
    t.rows.map(([day, name, url, note]) => { const [wd, , d] = fmtDayParts(day); return '<li><a href="' + esc(safeHref(url)) + '" target="_blank" rel="noopener"><span class="d">' + esc(wd + ' ' + d) + '</span><span class="n">' + esc(name) + (note ? '<span class="tf-sub">' + esc(note) + '</span>' : '') + '</span></a></li>'; }).join('') +
    '</ul><div class="tf-foot"><a class="tf-more" href="#cityhall">' + esc(COPY.allMeetings(t.n)) + ICON.right + '</a>' + acts(it) + '</div></div>',
  jobs: (t, it) => '<div class="tf-frame">' + head(t) + '<div class="tf-count"><b class="tf-huge">' + esc(t.n) + '</b><span>' + esc(COPY.jobsWord(t.n)) + '</span></div><ul class="tf-rows tight">' +
    t.rows.map(([name, n]) => '<li><span class="n">' + esc(name) + '</span><span class="d">' + esc(n) + '</span></li>').join('') +
    '</ul><div class="tf-foot"><a class="tf-more" href="#work">' + esc(COPY.allJobs) + ICON.right + '</a>' + acts(it) + '</div></div>',
  week: (t, it) => { const top = Math.max(...t.bars.map((b) => b[1]), 1); return '<div class="tf-frame">' + head(t) + '<div class="tf-count"><b class="tf-huge">' + esc(t.n) + '</b><span>' + esc(COPY.permitsWord(t.n)) + '</span></div><ul class="tf-bars">' +
    t.bars.map(([k, n]) => '<li><span class="l">' + esc(k) + '</span><span class="b"><i style="width:' + Math.round(n / top * 100) + '%"></i></span><span class="v">' + esc(n) + '</span></li>').join('') +
    '</ul><div class="tf-foot"><span class="tf-sub">' + esc(t.cost ? COPY.work(shortMoney(t.cost)) : '') + '</span><span class="sp"></span>' + acts(it) + '</div></div>'; },
};

function tile(t) {
  const k = 'tf-' + t.id;
  const it = { k, kind: 'post', title: titleOf(t), text: '', href: t.url || '#feed/' + k, src: COPY.source, ago: stamp(t), open: COPY.openSource };
  app.know([it]);
  const c = el('article', 'card tf tf-' + t.kind + (hasPic(t) ? ' has-pic' : ''));
  c.dataset.k = k;
  c.dataset.id = t.id;
  c.innerHTML = (DRAW[t.kind] || DRAW.food)(t, it);
  return c;
}

/* ---------------------------------------------------------------- the page */
/* the city's headline; a file from before headlines has only true */
const banWords = (b) => (typeof b === 'string' ? b : b ? COPY.ban : '');
function hero() {
  const fresh_ = S.tiles.filter(fresh).length;
  const st = S.status || {};
  const ban = banWords(st.ban);
  const schools = Number(st.schools ?? st.closings) || 0;
  const day = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
  const h = el('header', 'tf-hero' + (ban ? ' alarm' : ''));
  h.innerHTML = (app.demo ? '' : '<img class="tf-pic" src="assets/aerial/town-hero.jpg" alt="" decoding="async">') +
    '<div class="tf-day">' + esc(day) + '</div>' +
    '<p class="tf-tally">' + (fresh_ ? '<b>' + esc(COPY.fresh(fresh_)) + '</b>' + (S.first ? '' : ' ' + esc(COPY.since)) : esc(COPY.quiet)) + '</p>' +
    '<div class="tf-chips">' +
      '<a class="tf-chip' + (ban ? ' on' : '') + '" href="#alerts/trash">' + esc(ban || COPY.noBan) + '</a>' +
      '<a class="tf-chip' + (schools ? ' on' : '') + '" href="#alerts/schools">' + esc(schools ? COPY.closings(schools) : COPY.noClosings) + '</a>' +
      '<span class="tf-chip run"' + (run() < 2 ? ' hidden' : '') + '>' + esc(COPY.run(run())) + '</span>' +
    '</div>';
  return h;
}
function inLane(t) {
  if (S.filter === 'all') return true;
  const lane = LANES.find((l) => l.key === S.filter);
  return !!lane && lane.kinds.includes(t.kind);
}
function draw() {
  const root = S.root;
  if (!root) return;
  root.innerHTML = '';
  if (!S.loaded) { root.appendChild(el('p', 'tf-empty', esc(COPY.loading))); return; }
  if (!S.tiles.length) { root.appendChild(el('p', 'tf-empty', esc(S.failed ? COPY.failed : COPY.empty))); return; }
  const wrap = el('div', 'tf-wrap');
  if (S.filter === 'all') {
    wrap.appendChild(hero());
    if (S.pick) wrap.appendChild(tile(S.pick));
    if (S.hot) wrap.appendChild(tile(S.hot));
  }
  const list = S.tiles.filter((t) => inLane(t) && !(S.filter === 'all' && (t === S.pick || t === S.hot)));
  let marked = S.filter !== 'all' || !list.some(fresh);
  list.forEach((t) => {
    if (!marked && !fresh(t)) { wrap.appendChild(el('div', 'tf-caught', esc(COPY.caught))); marked = true; }
    wrap.appendChild(tile(t));
  });
  if (!list.length) wrap.appendChild(el('p', 'tf-empty', esc(COPY.empty)));
  root.appendChild(wrap);
  root.appendChild(el('div', 'spacer'));
}
function setFilter(k) {
  if (S.filter === k) return;
  S.filter = k;
  app.paintSubnav();
  draw();
  app.scrollTop(false);
}

/* ---------------------------------------------------------------- the data */
function demoFile() {
  return app.demoJSON('data/demo/town-feed.json').then((j) => {
    const now = Date.now();
    const soon = (n) => plusDays(today(), n);
    return { ...j, tiles: j.tiles.map((t, i) => ({ ...t, ts: new Date(now - t.ageHours * 3600000).toISOString(),
      day: t.kind === 'city' || t.kind === 'signup' ? soon(3) : t.day, closed: t.kind === 'sold' ? soon(-12) : t.closed,
      rows: t.kind === 'cityweek' ? t.rows.map((r, n) => [soon(n + 1), ...r.slice(1)]) : t.rows })) };
  });
}
function take(d) {
  S.tiles = Array.isArray(d.tiles) ? d.tiles : [];
  S.status = d.status || {};
  S.version = d.generated || '';
  const had = guesses();
  S.pick = S.tiles.find((t) => t.kind === 'sold' && t.price && had[t.id] === undefined) || null;
  /* the thread Burlington is arguing about, up top for as long as it's the biggest */
  const recent = Date.now() - HOT_DAYS * DAY;
  S.hot = S.tiles.filter((t) => t.kind === 'reddit' && t.comments >= HOT_MIN && ms(t) > recent).sort((a, b) => b.comments - a.comments)[0] || null;
  S.loaded = true;
  S.failed = false;
  S.at = Date.now();
}
const fetchFeed = () => (app.demo ? demoFile() : getJSON(FEED_URL));
/* a fresh copy, taken in now. How many tiles are new to this screen. */
function load() {
  const before = new Set(S.tiles.map((t) => t.id));
  return fetchFeed().then((d) => { take(d); return S.tiles.filter((t) => !before.has(t.id)).length; },
    (e) => { console.warn('[town] feed: ' + (e && e.message)); S.loaded = true; S.failed = !S.tiles.length; return 0; });
}
/* The reader left. Back after ten minutes or more, the count starts from when
   they left; a shorter trip keeps the old start. The start itself is stored so
   a short trip through a reload, or to another app, keeps it too. */
function looked() { S.left = Date.now(); keep.put(SEEN_KEY, S.left); keep.put(BASE_KEY, S.base); }
function back() { if (S.left && Date.now() - S.left >= STALE) S.rebase = S.left; S.left = 0; }
function rebase() { if (S.rebase) { S.base = S.rebase; S.rebase = 0; S.first = false; } }
function firstBase() {
  const left = Number(keep.get(SEEN_KEY, 0));
  S.first = !left;
  if (!left) return Date.now() - FIRST_LOOK;
  return (Date.now() - left < STALE && Number(keep.get(BASE_KEY, 0))) || left;
}
const atTop = () => { const p = S.root && S.root.closest('.panel'); return !p || p.scrollTop < 40; };
function catchUp() {
  if (S.next) { take(S.next); S.next = null; }
  rebase();
  draw();
  app.paintSubnav();
  app.recount();
}
document.addEventListener('visibilitychange', () => {
  if (app.activeTab() !== 'feed' || !S.loaded) return;
  if (document.hidden) { looked(); return; }
  back();
  const stale = Date.now() - S.at >= STALE;
  (stale ? fetchFeed().catch(() => null) : Promise.resolve(null)).then((d) => {
    if (d && d.generated !== S.version) S.next = d;
    /* a reader mid-scroll keeps their page; it catches up when they come back to the tab */
    if (atTop()) catchUp();
  });
});

function land(param) {
  if (!S.loaded) { S.pending = param; return; }
  S.pending = null;
  if (LANES.some((l) => l.key === param) || param === 'all') { setFilter(param); return; }
  S.filter = 'all';
  app.paintSubnav();
  draw();
  /* a link saved before now carries the bare id */
  if (!app.flashHit(S.root, param) && !app.flashHit(S.root, 'tf-' + param)) app.toast(COPY.moved);
}

app.register('feed', {
  label: COPY.label,
  icon: ICON.spark,
  promise: COPY.promise,
  mount(root) {
    S.root = root;
    S.base = firstBase();
    app.bindFeed(root, { onPeek() {} });
    root.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) { e.preventDefault(); pickPrice(b); } });
    /* an aerial fades in when it lands; one that never does leaves the tile's own colour */
    root.addEventListener('load', (e) => { if (e.target.classList && e.target.classList.contains('tf-pic')) e.target.classList.add('on'); }, true);
    root.addEventListener('error', (e) => {
      const n = e.target;
      if (!n.classList || !n.classList.contains('tf-pic')) return;
      const c = n.closest('.tf');
      if (c) c.classList.remove('has-pic');
      n.remove();
    }, true);
    draw();
    load().then(() => { draw(); app.paintSubnav(); app.recount(); if (S.pending) land(S.pending); });
  },
  activate(param) {
    back();
    if (S.loaded && (S.next || S.rebase)) catchUp();
    if (param) land(param);
  },
  refresh() { if (S.root && S.loaded) draw(); },
  deactivate() { looked(); },
  subnav() {
    if (!S.loaded || !S.tiles.length) return null;
    const newest = (l) => Math.max(0, ...S.tiles.filter((t) => l.kinds.includes(t.kind)).map((t) => ms(t) / 1000));
    const lanes = LANES.map((l) => ({ key: l.key, label: l.label, newest: newest(l) })).filter((l) => l.newest).sort((a, b) => b.newest - a.newest);
    return sectionBar({ key: 'town-feed', title: COPY.label, color: '--app-town-pop', current: S.filter, onPick: setFilter,
      items: [{ key: 'all', label: COPY.all }].concat(lanes) });
  },
  keepSubnav: true,
  newSince() { return S.loaded ? S.tiles.filter(fresh).length : 0; },
  pull() {
    const was = S.version;
    return load().then((n) => { if (S.version !== was) { draw(); app.paintSubnav(); } return n ? COPY.got(n) : null; });
  },
});

/* for tests */
export const _state = () => ({ filter: S.filter, tiles: S.tiles.length, base: S.base, pick: S.pick && S.pick.id, run: run() });
