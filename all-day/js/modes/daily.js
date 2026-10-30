/* Daily (Play app, wave 1, 2026-10-29): the arcade's daily puzzles on one
   shelf, each a cabinet with Play and a "Played today" tick, and a streak
   per puzzle counted from those ticks.

   - The six puzzles and their words are data/play/play.json's `daily`:
     Btown Wordle, Crossings, the News Quiz, Higher or Lower, Where in
     Btown, Real or Fake. Each opens on the arcade in a new tab.
   - The arcade lives on play.btownbrief.com, another origin, so this app
     cannot see what was played there. The reader ticks it here instead:
     the ticks are kept on this phone only (localStorage `play-daily`, the
     Burlington dates each puzzle was ticked, the last 400), never sent.
   - A streak is the run of days in a row ending today, or ending yesterday
     while today's is still to play, so a streak is not lost at breakfast.
     Under it: the last seven days as dots, and the best run when the
     current one is shorter.
   - The bar's dot: once a new Burlington day has started since the last
     visit, the puzzles not yet ticked today are new.

   ?demo=1 reads data/demo/play-daily.json: ticks as "days ago", so the
   streaks are the same whenever the demo runs. Nothing is kept. */

import * as app from '../app.js';
import * as store from '../store.js';
import { el, esc, ICON } from '../ui.js';
import { playData, demoOf, arr, plural, sec, link, tab } from './playkit.js';

const KEY = 'daily';
const STORE = 'play-daily';
const KEEP = 400;
const SLUG = /^[a-z0-9-]{1,40}$/;
/* the puzzles with a picture of real play (assets/games/<slug>.webp, games.js's SHOTS) */
const SHOTS = new Set(['btown-wordle', 'btown-crossings', 'news-quiz', 'higher-or-lower', 'where-in-btown', 'real-or-fake']);
/* the pill's words for each puzzle, the map's top tabs */
const TOPS = { 'btown-wordle': 'Wordle', 'btown-crossings': 'Crossings', 'news-quiz': 'News quiz', 'higher-or-lower': 'Higher or lower', 'where-in-btown': 'Where in Btown', 'real-or-fake': 'Real or fake' };

const TZ = 'America/New_York';
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
function etDay(ms) {
  const o = {};
  dayFmt.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
  return o.year + '-' + o.month + '-' + o.day;
}
const today = () => etDay(Date.now());
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const addDays = (date, n) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10); };

const D = { puzzles: [], ticks: Object.create(null) };

/* the ticks as { slug: Set of dates } from what is stored (anything else dropped) */
function readTicks(raw) {
  const out = Object.create(null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  Object.entries(raw).forEach(([slug, dates]) => { if (SLUG.test(slug)) out[slug] = new Set(arr(dates).filter(isDate)); });
  return out;
}
function save() {
  if (app.demo) return;
  const out = {};
  Object.entries(D.ticks).forEach(([slug, set]) => { if (set.size) out[slug] = [...set].sort().slice(-KEEP); });
  store.write(STORE, out);
}
const ticked = (slug, day) => !!(D.ticks[slug] && D.ticks[slug].has(day));
/* days in a row ending today, or yesterday while today is still open */
export function streak(dates, day) {
  const set = dates instanceof Set ? dates : new Set(arr(dates));
  let d = set.has(day) ? day : addDays(day, -1);
  let n = 0;
  while (set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

function toggle(p, btn) {
  const day = today();
  const set = D.ticks[p.slug] || (D.ticks[p.slug] = new Set());
  if (set.has(day)) set.delete(day); else set.add(day);
  save();
  const on = set.has(day);
  const all = on && D.puzzles.every((x) => ticked(x.slug, day));
  app.toast(all ? 'All ' + (D.puzzles.length === 6 ? 'six' : D.puzzles.length) + ' today.' : on ? p.name + ': played. ' + streakWords(streak(set, day)) : p.name + ': not played.');
  mode.redraw(btn ? '[data-tick="' + p.slug + '"]' : null);
  app.recount();
}
const streakWords = (n) => (n >= 2 ? n + ' days in a row.' : '');
/* the longest run ever in the ticks */
export function best(dates) {
  const days = [...(dates instanceof Set ? dates : new Set(arr(dates)))].sort();
  let top = 0, run = 0, prev = '';
  days.forEach((d) => { run = prev && addDays(prev, 1) === d ? run + 1 : 1; top = Math.max(top, run); prev = d; });
  return top;
}
/* the last seven days, oldest first, as filled and empty dots */
const week = (set, day) => [6, 5, 4, 3, 2, 1, 0].map((n) => (set.has(addDays(day, -n)) ? '●' : '○')).join('');

function cabinet(p) {
  const day = today();
  const on = ticked(p.slug, day);
  const set = D.ticks[p.slug] || new Set();
  const n = streak(set, day);
  const top = best(set);
  const recent = [0, 1, 2, 3, 4, 5, 6].some((k) => set.has(addDays(day, -k)));
  const c = el('article', 'gm-cab' + (on ? ' done' : ''));
  c.dataset.k = 'daily:' + p.slug;
  c.dataset.sec = p.slug;
  const emo = '<span class="gm-emo" aria-hidden="true">' + esc(p.emoji || '🧩') + '</span>';
  const scr = link(SHOTS.has(p.slug) ? '<img src="assets/games/' + esc(p.slug) + '.webp" alt="" width="480" height="360" loading="lazy" decoding="async">' : emo,
    p.url, 'gm-scr' + (SHOTS.has(p.slug) ? ' shot' : ''), 'Play ' + p.name);
  const img = scr.querySelector('img');
  if (img) img.addEventListener('error', () => { scr.classList.remove('shot'); img.insertAdjacentHTML('beforebegin', emo); img.remove(); }, { once: true });
  /* short enough for one line in a two-up cabinet at 390 */
  const run = n >= 2 ? n + ' in a row' : '';
  const line = run + (top > n && top > 1 ? (run ? ' · ' : '') + 'best ' + top : '');
  const body = el('div', 'gm-cab-b', '<h3 class="gm-name">' + esc(p.name) + '</h3><p class="gm-pitch">' + esc(p.line || '') + '</p>' +
    '<p class="gm-champ" data-streak="' + n + '" data-best="' + top + '"' + (recent || top > 1 ? '' : ' hidden') + '>' +
    '<span class="pl-week" aria-label="' + esc(plural([0, 1, 2, 3, 4, 5, 6].filter((k) => set.has(addDays(day, -k))).length, 'day', 'days') + ' played this week') + '">' + week(set, day) + '</span>' +
    (line ? '<span>' + esc(line) + '</span>' : '') + '</p>');
  const acts = el('div', 'gm-acts');
  const tick = el('button', 'pillbtn' + (on ? ' on' : ''), (on ? ICON.check + ' ' : '') + esc(on ? 'Played' : 'Played?'));
  tick.type = 'button';
  tick.dataset.tick = p.slug;
  tick.setAttribute('aria-pressed', on ? 'true' : 'false');
  tick.setAttribute('aria-label', (on ? 'Played ' : 'Mark played today: ') + p.name);
  tick.addEventListener('click', () => toggle(p, tick));
  acts.append(link('Play', p.url, 'pillbtn on', 'Play ' + p.name + ' on the arcade'), tick);
  body.appendChild(acts);
  c.append(scr, body);
  return c;
}

function draw(page) {
  const day = today();
  const done = D.puzzles.filter((p) => ticked(p.slug, day)).length;
  const head = sec(page, 'today', 'Today’s puzzles', D.puzzles.length ? done + ' of ' + D.puzzles.length + ' played today' : '');
  const grid = el('div', 'gm-grid');
  D.puzzles.forEach((p) => grid.appendChild(cabinet(p)));
  head.appendChild(grid);
}

function load() {
  return Promise.all([playData(), demoOf('play-daily')]).then(([j, demo]) => {
    D.puzzles = arr(j.daily).filter((p) => p && SLUG.test(String(p.slug || '')) && p.name && /^https:\/\//.test(String(p.url || '')));
    if (demo) {
      const t = today();
      D.ticks = Object.create(null);
      Object.entries(demo.ticks || {}).forEach(([slug, ago]) => { if (SLUG.test(slug)) D.ticks[slug] = new Set(arr(ago).map((n) => addDays(t, -Number(n) || 0))); });
    } else D.ticks = readTicks(store.read(STORE, {}));
  });
}

/* a new day since the last look: the puzzles still to play today */
function newSince(ts) {
  const day = today();
  if (!ts || etDay(ts * 1000) >= day) return 0;
  return D.puzzles.filter((p) => !ticked(p.slug, day)).length;
}

const mode = tab({
  key: KEY, label: 'Daily', icon: 'calcheck', promise: 'Today’s puzzles on one shelf, a streak for each.',
  tops: Object.entries(TOPS), load, draw, newSince, stamp: today,
});
app.register(KEY, mode);
