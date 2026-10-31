/* Body · Today: the day as tiles you tap, under what's going on outside.

   Each tile is one thing to do today, and doing it is one tap. Water and
   protein count up from the same record the Fuel tab keeps. Train, Sprints,
   Stretch and Breathe open their tools and get ticked here. What's left sits
   on top; a finished tile sinks to the bottom. The hero's ring fills as the
   day does, and a day with DAY_WON or more tiles done keeps the streak alive.

   Above the tools, three tiles from outside the phone: the next places to
   move with other people this week (club meets from run-clubs.json, events
   and league nights from data/town/moves.json), the newest picture from
   Body's accounts, and races and league signups still open, in date order
   (a signup with no closing date last). They are never scored: list()
   holds what the ring and the streak count, and these aren't in it. Any file
   that doesn't load takes only its own tile with it.

   Everything is kept on this phone. Every reader-facing word is in COPY. */

import * as app from '../app.js';
import * as store from '../store.js';
import { el, esc, ICON, safeHref, art } from '../ui.js';
import { today, addDays, keep, put, seed, data, demoData, shortDay } from './body-kit.js';
import { meetsInWindow, redateDemo } from '../clubs-week.js';
import { chips as outsideChips, moreChips, WEATHER_URL } from '../outside.js';

const COPY = {
  label: 'Today',
  promise: 'Your day',
  of: (a, b) => a + ' of ' + b,
  streak: (n) => (n === 1 ? '1 day' : n + ' days'),
  won: 'Day won',
  done: 'Done',
  mark: (t) => 'Mark ' + t + ' done',
  unmark: (t) => 'Mark ' + t + ' not done',
  water: 'Water',
  protein: 'Protein',
  shake: 'Shake',
  train: 'Train',
  trainSub: '20 to 30 minutes',
  levels: [['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['hardcore', 'Hardcore']],
  sprints: 'Sprints',
  stretch: 'Stretch',
  stretchSub: '10 minutes',
  breathe: 'Breathe',
  start: 'Start',
  habits: 'Your habits',
  build: 'The Build',
  open: 'Open',
  moving: 'Moving this week',
  races: 'Races and signups',
  closes: (d) => 'Signups close ' + d,
  signupOpen: 'Open',
  inDays: (n) => (n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : n + ' days'),
  more: 'Show more',
  share: 'Share',
  save: 'Save',
  source: 'Body',
  openSource: 'Open the source',
};

const FUEL = 'allday-body-fuel';          // the Fuel tab's own day record
const FUEL_SET = 'allday-body-fuel-set';
const DONE = 'allday-body-day';           // { 'YYYY-MM-DD': ['train', ...] }
const SCORE = 'allday-body-day-score';    // { 'YYYY-MM-DD': tiles done }, so a new goal can't rewrite old days; never pruned, the streak walks it
const DAY_WON = 4;                        // tiles done that keep the streak alive
const KEEP = 60;
const MOVES_URL = '../data/town/moves.json';
const RACES_URL = '../data/town/races.json';
const CLUBS_URL = '../data/run-clubs.json';
const MOVE_DAYS = 7;
const SOON_DAYS = 90;                     // a race shows this close
const COUNTDOWN = 14;                     // inside this many days a row counts down; past it, the date
const STEP = { moves: 8, soon: 6 };       // rows that show, and how many Show more adds
const RELOAD = 15 * 60000;                // the outside files are this old before a tab change refetches them
const HOUR = 3600000;
const TZ = 'America/New_York';

const S = { root: null, goals: { water: 96, tap: 16, protein: 140, shake: 30 }, defaults: {}, day: '',
  weather: null, moves: [], aerials: {}, scene: [], clubs: [], races: [], signups: [], dead: new Set(), at: 0, shown: { ...STEP } };

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const fuelDay = (k) => { const d = obj(obj(keep(FUEL, {}))[k]); return { water: Number(d.water) || 0, protein: Number(d.protein) || 0, shakes: Number(d.shakes) || 0, creatine: d.creatine === true }; };
function addFuel(patch) {
  const k = today();
  const all = obj(keep(FUEL, {}));
  all[k] = { ...fuelDay(k), ...patch };
  put(FUEL, all);
}
const doneMap = () => obj(keep(DONE, {}));
const ticks = (k) => { const v = doneMap()[k]; return Array.isArray(v) ? v : []; };
function toggle(id) {
  const k = today();
  const all = doneMap();
  const now = ticks(k);
  all[k] = now.includes(id) ? now.filter((x) => x !== id) : now.concat(id);
  const cut = addDays(k, -KEEP);
  Object.keys(all).forEach((x) => { if (x < cut) delete all[x]; });
  put(DONE, all);
}
/* Mind: a finished sit gives a tile the tick a tap would, once */
export function markDone(id) { if (!ticks(today()).includes(id)) toggle(id); }
const metersDone = (k) => { const f = fuelDay(k); return (f.water >= S.goals.water ? 1 : 0) + (f.protein >= S.goals.protein ? 1 : 0); };
const count = (k) => ticks(k).length + metersDone(k);
const scoreOf = (k) => (k === today() ? count(k) : Math.max(Number(obj(keep(SCORE, {}))[k]) || 0, ticks(k).length));
function saveScore() {
  const t = today(), n = count(t), all = obj(keep(SCORE, {}));
  if (all[t] === n) return;
  all[t] = n;
  put(SCORE, all);
}
/* for Fuel: a goal met there counts for today even if Today isn't opened again */
export function saveDayScore() {
  return data('fuel.json').then((f) => { S.defaults = f.defaults || {}; readGoals(); saveScore(); }).catch(() => {});
}
function streak() {
  const t = today();
  let n = scoreOf(t) >= DAY_WON ? 1 : 0;
  for (let k = addDays(t, -1); scoreOf(k) >= DAY_WON; k = addDays(k, -1)) n += 1;
  return n;
}

/* ---------------------------------------------------------------- the tiles */
const check = (t, on) => '<button class="dy-tick' + (on ? ' on' : '') + '" data-tick="' + t.id + '" aria-pressed="' + on + '" aria-label="' + esc(on ? COPY.unmark(t.title) : COPY.mark(t.title)) + '">' + ICON.check + '</button>';
const meter = (val, goal, unit) => '<div class="dy-num"><b data-num>' + esc(val) + '</b><span>' + esc(COPY.of('', goal + ' ' + unit).trim()) + '</span></div>' +
  '<div class="dy-bar"><i style="width:' + Math.min(100, Math.round(100 * val / goal)) + '%"></i></div>';
const go = (href, label) => '<a class="dy-go" href="' + href + '">' + esc(label) + ICON.right + '</a>';

function list() {
  const f = fuelDay(today());
  const g = S.goals;
  const on = ticks(today());
  const tool = (id, title, sub, href, cls) => ({ id, title, cls, wide: false, done: on.includes(id),
    html: (d) => '<div class="dy-top"><h3>' + esc(title) + '</h3>' + check({ id, title }, d) + '</div>' + (sub ? '<p class="dy-sub">' + esc(sub) + '</p>' : '') + go(href, COPY.start) });
  const items = [
    { id: 'water', title: COPY.water, cls: 'water', wide: true, done: f.water >= g.water,
      html: () => '<div class="dy-top"><h3>' + esc(COPY.water) + '</h3></div>' + meter(f.water, g.water, 'oz') +
        '<div class="dy-btns"><button class="dy-add" data-add="water">' + ICON.plus + esc(g.tap + ' oz') + '</button></div>' },
    { id: 'protein', title: COPY.protein, cls: 'protein', wide: true, done: f.protein >= g.protein,
      html: () => '<div class="dy-top"><h3>' + esc(COPY.protein) + '</h3></div>' + meter(f.protein, g.protein, 'g') +
        '<div class="dy-btns"><button class="dy-add" data-add="shake">' + ICON.plus + esc(COPY.shake) + '</button><button class="dy-add" data-add="ten">' + ICON.plus + esc('10 g') + '</button></div>' },
    { id: 'train', title: COPY.train, cls: 'train', wide: true, done: on.includes('train'),
      html: (d) => '<div class="dy-top"><h3>' + esc(COPY.train) + '</h3>' + check({ id: 'train', title: COPY.train }, d) + '</div><p class="dy-sub">' + esc(COPY.trainSub) + '</p>' +
        '<div class="dy-btns">' + COPY.levels.map(([k, l]) => '<a class="dy-add" href="#train/' + k + '">' + esc(l) + '</a>').join('') + '</div>' },
    tool('sprints', COPY.sprints, '', '#train/sprints', 'sprints'),
    tool('stretch', COPY.stretch, COPY.stretchSub, '#recover/stretch', 'stretch'),
    tool('breathe', COPY.breathe, '', '#mind', 'breathe'),
    { id: 'habits', title: COPY.habits, cls: 'habits', link: true, done: false,
      html: () => '<div class="dy-top"><h3>' + esc(COPY.habits) + '</h3></div>' + go('#habits', COPY.open) },
    { id: 'build', title: COPY.build, cls: 'build', link: true, wide: true, done: false,
      html: () => '<div class="dy-top"><h3>' + esc(COPY.build) + '</h3></div>' + go('#build', COPY.open) },
  ];
  /* the evening leads with winding down */
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }).format(new Date()));
  if (hour >= 18) items.sort((a, b) => (['stretch', 'breathe'].includes(b.id) ? 1 : 0) - (['stretch', 'breathe'].includes(a.id) ? 1 : 0));
  return items;
}
function tile(t) {
  const c = el('article', 'dy-tile dy-' + t.cls + (t.wide ? ' wide' : '') + (t.done ? ' is-done' : ''));
  c.dataset.tile = t.id;
  c.innerHTML = t.html(t.done);
  return c;
}

/* ------------------------------------------------- from outside the phone */
const CLOCK = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
const YMD = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = (at) => YMD.format(new Date(at));
const clock = (at) => CLOCK.format(new Date(at)).replace(':00', '');
/* today's rows need only the time; the rest say the day */
const whenOf = (at) => (dayKey(at) === today() ? '' : WEEKDAY.format(new Date(at)) + ' ') + clock(at);
/* clubs and classes together, soonest first; the same thing listed twice shows once */
function nextMoves() {
  const now = Date.now();
  const meets = meetsInWindow(S.clubs, now, now + MOVE_DAYS * 24 * HOUR).map((o) => ({ at: o.at, title: o.club.name, where: o.meet.where,
    url: o.club.url, img: S.aerials[o.meet.lat + ',' + o.meet.lng] }));
  const rows = S.moves.map((m) => ({ ...m, at: Date.parse(m.at) })).filter((m) => m.at > now);
  const seen = new Map();
  return meets.concat(rows).sort((a, b) => a.at - b.at).filter((m) => {
    const t = String(m.title).toLowerCase().replace(/[^a-z0-9]/g, '');
    const same = seen.get(m.at) || [];
    if (same.some((o) => o.includes(t) || t.includes(o))) return false;
    seen.set(m.at, same.concat(t));
    return true;
  });
}
/* a league still taking signups, one row a sport at its soonest close; 'z' sorts after any date */
function openSignups(t) {
  const by = new Map();
  S.signups.filter((x) => x.signup_open === true && (x.signup_until || 'z') >= t && (x.ends || 'z') >= t)
    .sort((a, b) => (a.signup_until || 'z').localeCompare(b.signup_until || 'z'))
    .forEach((x) => { if (!by.has(x.name)) by.set(x.name, x); });
  return [...by.values()];
}
function nextSoon() {
  const t = today(), last = addDays(t, SOON_DAYS);
  const races = S.races.filter((r) => r.day >= t && r.day <= last).map((r) => ({ day: r.day, name: r.name, sub: r.town, url: r.url }));
  const signups = openSignups(t).map((x) => ({ day: x.signup_until || 'z', name: x.name, sub: x.signup_until ? COPY.closes(shortDay(x.signup_until)) : '', url: x.url || '#leagues' }));
  return races.concat(signups).sort((a, b) => a.day.localeCompare(b.day));
}
const daysUntil = (d) => { let n = 0; for (let k = today(); k < d && n <= COUNTDOWN; k = addDays(k, 1)) n += 1; return n; };
const whenSoon = (d) => { if (d === 'z') return COPY.signupOpen; const n = daysUntil(d); return n > COUNTDOWN ? shortDay(d) : COPY.inDays(n); };

function acts(it) {
  const on = store.isSaved(it.k);
  return '<span class="tf-acts"><button class="act sh" data-act="share" aria-label="' + esc(COPY.share) + '">' + ICON.share + '</button>' +
    '<button class="act star' + (on ? ' on' : '') + '" data-act="save" aria-label="' + esc(COPY.save) + '" aria-pressed="' + on + '">' + ICON.star + '</button></span>';
}
const link = (url) => { const out = /^https?:/.test(url || ''); return '<a href="' + esc(safeHref(url)) + '"' + (out ? ' target="_blank" rel="noopener"' : '') + (app.demo && out ? ' data-open' : '') + '>'; };
const row = (d, name, sub, url, off) => '<li' + (off ? ' hidden' : '') + '>' + link(url) + '<span class="d">' + esc(d) + '</span><span class="n">' + esc(name) + (sub ? '<span class="tf-sub">' + esc(sub) + '</span>' : '') + '</span></a></li>';
const moreBtn = (id, n) => (n > S.shown[id] ? '<button class="tf-more dy-more" data-more="' + id + '">' + esc(COPY.more) + '</button>' : '');
function liveTile(id, cls, title, inner, href, pic, key = id) {
  const k = 'dy-' + key;
  const it = { k, kind: 'post', title, text: '', href: href || '#day/' + k, src: COPY.source, ago: '', open: COPY.openSource };
  app.know([it]);
  const c = el('article', 'dy-tile dy-live dy-' + cls + ' wide' + (pic ? ' has-pic' : ''));
  c.dataset.tile = id;
  c.dataset.k = k;
  c.innerHTML = (pic || '') + inner(it);
  return c;
}
function movingTile() {
  const rows = nextMoves();
  if (!rows.length) return null;
  const first = rows[0];
  const pic = !app.demo && first.img ? '<img class="tf-pic" src="../data/town/aerials/' + esc(first.img) + '" alt="" loading="lazy" decoding="async">' : '';
  return liveTile('moves', 'moves', COPY.moving, (it) => '<div class="dy-top"><h3>' + esc(COPY.moving) + '</h3>' + acts(it) + '</div><ul class="tf-rows">' +
    rows.map((m, i) => row(whenOf(m.at), m.title, m.where, m.url, i >= S.shown.moves)).join('') + '</ul>' + moreBtn('moves', rows.length), '', pic);
}
function sceneTile() {
  const p = S.scene.find((x) => !S.dead.has(x.id));
  if (!p) return null;
  const pic = app.demo ? art(p.art) : '<img class="tf-pic" src="' + esc(safeHref(p.pic)) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">';
  const name = '@' + p.h;
  const c = liveTile('scene', 'scene', name, (it) => '<a class="tf-go" href="' + esc(safeHref(p.url)) + '" target="_blank" rel="noopener"' + (app.demo ? ' data-open' : '') + ' aria-label="' + esc(name) + '"></a>' +
    '<div class="dy-top"><p class="dy-sub">' + esc(name) + '</p>' + acts(it) + '</div>', p.url, pic, 'scene-' + p.id);
  c.dataset.post = p.id;
  return c;
}
function soonTile() {
  const rows = nextSoon();
  if (!rows.length) return null;
  return liveTile('soon', 'soon', COPY.races, (it) => '<div class="dy-top"><h3>' + esc(COPY.races) + '</h3>' + acts(it) + '</div><ul class="tf-rows">' +
    rows.map((r, i) => row(whenSoon(r.day), r.name, r.sub, r.url, i >= S.shown.soon)).join('') + '</ul>' + moreBtn('soon', rows.length));
}
/* opens the next rows where they are; a redraw here would flash the picture */
function showMore(b) {
  const id = b.dataset.more;
  const before = S.shown[id];
  S.shown[id] += STEP[id];
  const rows = [...b.closest('.dy-live').querySelectorAll('.tf-rows li')];
  rows.forEach((li, i) => { li.hidden = i >= S.shown[id]; });
  const next = rows[before] && rows[before].querySelector('a');
  if (S.shown[id] >= rows.length) b.remove();
  if (next) next.focus({ preventScroll: true });
}
const json = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
function takeMoves(m) {
  S.moves = Array.isArray(m && m.events) ? m.events : [];
  S.aerials = (m && m.aerials) || {};
  S.scene = Array.isArray(m && m.scene) ? m.scene : [];
}
const leagueRows = (d) => ((d && d.organizers) || []).flatMap((o) => (o.sports || []).map((x) => ({ ...x, name: o.name.includes(x.sport) ? o.name : o.name + ' ' + x.sport })));
function loadDemo() {
  return Promise.all([demoData(), app.demoData('run-clubs')]).then(([d, rc]) => {
    const now = Date.now();
    const at = (h) => new Date(now + h * HOUR).toISOString();
    const o = d.outside || {};
    const w = o.weather || {};
    S.weather = { ...w, now: { ...w.now, observed_at: at(-0.5) }, lake_gage: { ...w.lake_gage, water_temp_at: at(-1) },
      sun: { sunrise: at(-6), sunset: at(4), sunrise_tomorrow: at(18), sunset_tomorrow: at(28) },
      hourly: { hours: [1, 2, 3].map((h, i) => ({ t: at(h), pop: i * 20, wind_mph: 6 + i * 3, sky: 40, temp_f: 58 })) } };
    takeMoves({ events: (o.moves || []).map((m) => ({ ...m, at: at(m.inHours) })), scene: o.scene });
    S.races = (o.races || []).map((r) => ({ ...r, day: addDays(today(), r.inDays) }));
    S.signups = (o.signups || []).map((x) => ({ ...x, signup_until: addDays(today(), x.inDays) }));
    S.clubs = redateDemo(rc, now).clubs;
  }).catch(() => {});
}
function loadLive() {
  const quiet = (p) => p.catch(() => null);
  return Promise.all([quiet(json(WEATHER_URL)), quiet(json(MOVES_URL)), quiet(json(CLUBS_URL)), quiet(json(RACES_URL)), quiet(data('leagues.json'))])
    .then(([w, m, rc, races, leagues]) => {
      S.weather = w || S.weather;
      if (m) takeMoves(m);
      S.clubs = (rc && rc.clubs) || S.clubs;
      S.races = (races && races.races) || S.races;
      if (leagues) S.signups = leagueRows(leagues);
    });
}
function loadOutside() {
  S.at = Date.now();
  return (app.demo ? loadDemo() : loadLive()).then(draw);
}

/* ---------------------------------------------------------------- the hero */
function hero(items) {
  const scored = items.filter((t) => !t.link);
  const n = scored.filter((t) => t.done).length;
  const all = scored.length;
  const R = 34, C = 2 * Math.PI * R;
  const h = el('header', 'dy-hero' + (n === all ? ' won' : ''));
  const day = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
  const t = today();
  const week = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
  const s = streak();
  h.innerHTML = (app.demo ? '' : '<img class="tf-pic" src="assets/aerial/body-hero.jpg" alt="" decoding="async" onload="this.classList.add(\'on\')" onerror="this.remove()">') +
    '<div class="dy-hero-main"><div><div class="tf-day">' + esc(day) + '</div>' +
      (n === all ? '<p class="tf-tally"><b>' + esc(COPY.won) + '</b></p>' : '') +
      (s ? '<span class="tf-chip run">' + esc(COPY.streak(s)) + '</span>' : '') + '</div>' +
      '<div class="dy-ring" role="img" aria-label="' + esc(COPY.of(n, all)) + '"><svg viewBox="0 0 80 80"><circle class="t" cx="40" cy="40" r="' + R + '"/><circle class="f" cx="40" cy="40" r="' + R + '" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - n / all)).toFixed(1) + '"/></svg><b>' + esc(n + '/' + all) + '</b></div></div>' +
    outside() + '<div class="dy-week">' + week.map((k) => '<i class="' + (scoreOf(k) >= DAY_WON ? 'on' : '') + (k === t ? ' now' : '') + '"></i>').join('') + '</div>';
  return h;
}

function outside() {
  const all = outsideChips(S.weather).concat(moreChips(S.weather));
  return all.length ? '<div class="tf-chips">' + all.map((c) => '<span class="tf-chip wx">' + esc(c) + '</span>').join('') + '</div>' : '';
}

function draw() {
  const root = S.root;
  if (!root) return;
  S.day = today();
  saveScore();
  const items = list();
  root.innerHTML = '';
  const wrap = el('div', 'dy-wrap');
  wrap.appendChild(hero(items));
  [movingTile(), sceneTile(), soonTile()].filter(Boolean).forEach((c) => wrap.appendChild(c));
  items.filter((t) => !t.done).forEach((t) => wrap.appendChild(tile(t)));
  items.filter((t) => t.done).forEach((t) => wrap.appendChild(tile(t)));
  root.appendChild(wrap);
  root.appendChild(el('div', 'spacer'));
}

function onTap(e) {
  const more = e.target.closest('[data-more]');
  if (more) { showMore(more); return; }
  const add = e.target.closest('[data-add]');
  if (add) {
    const f = fuelDay(today());
    const g = S.goals;
    if (add.dataset.add === 'water') addFuel({ water: f.water + g.tap });
    if (add.dataset.add === 'shake') addFuel({ protein: f.protein + g.shake, shakes: f.shakes + 1 });
    if (add.dataset.add === 'ten') addFuel({ protein: f.protein + 10 });
    if (navigator.vibrate) navigator.vibrate(8);
    draw();
    return;
  }
  const tick = e.target.closest('[data-tick]');
  if (tick) {
    toggle(tick.dataset.tick);
    if (navigator.vibrate) navigator.vibrate(12);
    draw();
  }
}

/* the same goals the Fuel tab sets */
function readGoals() {
  const d = S.defaults, s = obj(keep(FUEL_SET, {}));
  S.goals = { water: Number(s.waterGoal) || (d.water || {}).goal_oz || 96, tap: Number(s.waterTap) || (d.water || {}).tap_oz || 16,
    protein: Number(s.proteinGoal) || (d.protein_shake || {}).protein_goal_g || 140, shake: Number(s.shakeG) || (d.protein_shake || {}).grams_per_shake || 30 };
}
/* a board left open overnight turns the page */
const rollover = () => { if (S.root && S.day !== today() && app.activeTab() === 'day') draw(); };
document.addEventListener('visibilitychange', () => { if (!document.hidden) rollover(); });
setInterval(rollover, 60000);

app.register('day', {
  label: COPY.label,
  icon: ICON.habits,
  promise: COPY.promise,
  mount(root) {
    S.root = root;
    app.bindFeed(root, { onPeek() {} });
    root.addEventListener('click', onTap);
    /* a picture that won't load gives way to the next post, or the tile goes */
    root.addEventListener('load', (e) => { if (e.target.classList && e.target.classList.contains('tf-pic') && e.target.closest('.dy-live')) e.target.classList.add('on'); }, true);
    root.addEventListener('error', (e) => {
      const n = e.target;
      const c = n.closest && n.closest('.dy-live');
      if (!c || n.tagName !== 'IMG') return;
      if (c.dataset.post) { S.dead.add(c.dataset.post); draw(); return; }
      c.classList.remove('has-pic');
      n.remove();
    }, true);
    if (app.demo) seed(FUEL, { [today()]: { water: 48, protein: 60, shakes: 1, creatine: false } });
    draw();
    data('fuel.json').then((f) => { S.defaults = f.defaults || {}; readGoals(); draw(); }).catch(() => {});
    loadOutside();
  },
  activate(param) {
    if (!S.root) return;
    readGoals();
    draw();
    if (Date.now() - S.at > RELOAD) loadOutside();
    if (param) app.flashHit(S.root, param);
  },
  refresh() { draw(); },
  newSince() { return 0; },
});

/* for tests */
export const _state = () => ({ day: S.day, goals: S.goals, streak: streak(), done: ticks(today()) });
