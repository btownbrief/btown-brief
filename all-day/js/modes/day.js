/* Body · Today: the day as tiles you tap.

   Each tile is one thing to do today, and doing it is one tap. Water and
   protein count up from the same record the Fuel tab keeps. Train, Sprints,
   Stretch and Breathe open their tools and get ticked here. What's left sits
   on top; a finished tile sinks to the bottom. The hero's ring fills as the
   day does, and a day with DAY_WON or more tiles done keeps the streak alive.

   Everything is kept on this phone. Every reader-facing word is in COPY. */

import * as app from '../app.js';
import { el, esc, ICON } from '../ui.js';
import { today, addDays, keep, put, seed, data } from './body-kit.js';

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
};

const FUEL = 'allday-body-fuel';          // the Fuel tab's own day record
const FUEL_SET = 'allday-body-fuel-set';
const DONE = 'allday-body-day';           // { 'YYYY-MM-DD': ['train', ...] }
const SCORE = 'allday-body-day-score';    // { 'YYYY-MM-DD': tiles done }, so a new goal can't rewrite old days; never pruned, the streak walks it
const DAY_WON = 4;                        // tiles done that keep the streak alive
const KEEP = 60;

const S = { root: null, goals: { water: 96, tap: 16, protein: 140, shake: 30 }, defaults: {}, day: '' };

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
    tool('breathe', COPY.breathe, '', '#recover/breathe', 'breathe'),
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
    '<div class="dy-week">' + week.map((k) => '<i class="' + (scoreOf(k) >= DAY_WON ? 'on' : '') + (k === t ? ' now' : '') + '"></i>').join('') + '</div>';
  return h;
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
  items.filter((t) => !t.done).forEach((t) => wrap.appendChild(tile(t)));
  items.filter((t) => t.done).forEach((t) => wrap.appendChild(tile(t)));
  root.appendChild(wrap);
  root.appendChild(el('div', 'spacer'));
}

function onTap(e) {
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
    root.addEventListener('click', onTap);
    if (app.demo) seed(FUEL, { [today()]: { water: 48, protein: 60, shakes: 1, creatine: false } });
    draw();
    data('fuel.json').then((f) => { S.defaults = f.defaults || {}; readGoals(); draw(); }).catch(() => {});
  },
  activate() { if (S.root) { readGoals(); draw(); } },
  refresh() { draw(); },
  newSince() { return 0; },
});

/* for tests */
export const _state = () => ({ day: S.day, goals: S.goals, streak: streak(), done: ticks(today()) });
