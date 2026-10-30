/* City (Play app, 2026-10-29): the city game as one game on one page.

   - Missions: the Top 100+ What Now keeps (data/missions.json, read only).
     Five a day, the same five for everyone that Burlington day, each with
     a check to mark it done right here. The marks are What Now's own
     (localStorage `allday-missions`, { stable mark: epoch seconds }, shared
     by every app on the guide), so a mission done here is done in What Now
     and the other way round. Tapping a mission opens it in What Now (Out).
   - On the streets: the location games, each its own top tab: Streets
     (Every Street, only local today), Lit, Dibs, then Btown Hunt (live)
     and the Photo quests to come.
   - Crews: the neighborhood you rep, picked here and kept on this phone
     (`play-crew`). Crew boards need a backend.
   - Season: the season's collection (data/play/play.json `city.seasons`,
     by date): a handful of missions that fit it, with the same checks, and
     how many of them are done.

   ?demo=1 reads data/demo/play-city.json (missions done, a crew); a check
   or a crew picked in the demo is kept in memory only. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import { el, esc, ICON, chips } from '../ui.js';
import { NEIGHBORHOOD_LABELS } from '../boards-core.js';
import { playData, demoOf, arr, sec, link, soon, row, tab } from './playkit.js';

const KEY = 'city';
const MISSIONS_URL = '../data/missions.json';
const DONE_KEY = 'allday-missions';
const CREW_KEY = 'play-crew';
const STABLE = /^m[2-9]\d\d$/;
const SHOWN = 5;
const TZ = 'America/New_York';

const C = { city: {}, missions: null, done: Object.create(null), crew: '', picking: false };

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const dayNum = () => Math.round(Date.parse(today() + 'T12:00:00Z') / 86400000);
const markOf = (m) => (typeof m.mark === 'string' && STABLE.test(m.mark) ? m.mark : m.k);
const missions = () => arr(C.missions && C.missions.missions).filter((m) => m && /^[a-z0-9-]{1,40}$/.test(String(m.k || '')) && m.title);
const isDone = (m) => !!C.done[markOf(m)];
const endFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const endName = (date) => endFmt.format(new Date(date + 'T12:00:00Z'));

/* the same five all day: a window over the list that moves by five each
   Burlington day, so marking one done does not swap it for another */
function todays() {
  const all = missions();
  if (all.length <= SHOWN) return all;
  const at = (dayNum() * SHOWN) % all.length;
  return all.slice(at, at + SHOWN).concat(all.slice(0, Math.max(0, at + SHOWN - all.length)));
}
/* the season whose dates hold today, or null */
function season() {
  const t = today();
  return arr(C.city.seasons).find((s) => s && s.starts <= t && t <= s.ends && Array.isArray(s.marks)) || null;
}

function toggle(m) {
  const k = markOf(m);
  if (C.done[k]) delete C.done[k]; else C.done[k] = Math.floor(Date.now() / 1000);
  /* What Now's own map, read fresh so a mark made there since is kept */
  if (!app.demo) {
    const now = store.read(DONE_KEY, {});
    const map = now && typeof now === 'object' && !Array.isArray(now) ? now : {};
    if (C.done[k]) map[k] = C.done[k]; else delete map[k];
    store.write(DONE_KEY, map);
  }
  app.toast(C.done[k] ? 'Done: ' + m.title : 'Not done: ' + m.title);
  mode.redraw();
}

/* a mission as a row: its number, its title and line (a link to the
   mission in What Now), and a Done toggle */
function missionRow(m, where) {
  const on = isDone(m);
  const r = row(where + ':' + m.k, '', m.title, [m.teaser ? esc(m.teaser) : ''], []);
  if (on) r.classList.add('done');
  const t = r.querySelector('.th');
  t.className = 'num';
  t.innerHTML = on ? ICON.check : esc(String(m.n || ''));
  const words = t.nextElementSibling;
  const open = link(words.innerHTML, '#whatnow/' + m.k, 'open', 'Mission ' + m.n + ': ' + m.title + ', in What Now');
  words.replaceWith(open);
  const b = el('button', 'pillbtn' + (on ? ' on' : ''), (on ? ICON.check + ' ' : '') + 'Done');
  b.type = 'button';
  b.dataset.done = markOf(m);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.setAttribute('aria-label', (on ? 'Done: ' : 'Mark done: ') + m.title);
  b.addEventListener('click', () => toggle(m));
  r.appendChild(b);
  return r;
}

function drawMissions(page) {
  const all = missions();
  const box = sec(page, 'missions', 'Missions', C.missions ? all.filter(isDone).length + ' of ' + all.length + ' done' : '');
  if (!C.missions) { box.appendChild(el('p', 'note pad', esc('The missions didn’t load.'))); return; }
  const list = el('div', 'missions');
  todays().forEach((m) => list.appendChild(missionRow(m, 'mission')));
  box.appendChild(list);
  const more = el('div', 'linkrow');
  more.appendChild(link('All the missions', '#whatnow/missions', 'btn ghost sm'));
  box.appendChild(el('div', 'addrow')).appendChild(more);
}

/* a game in the city as a row with its link, or the honest line; the row
   is its own top tab */
function gameRow(key, g) {
  const lines = [esc(g.line || '')];
  if (g.honest) lines.push('<b>' + esc(g.honest) + '</b>');
  const go = g.soon || !g.url ? soon() : link('Play', g.url, 'pillbtn on', 'Play ' + g.name + ' on the arcade');
  const r = row('city:' + g.key, g.emoji, g.name, lines, [go]);
  if (key) r.dataset.sec = key;
  return r;
}
/* the location games, one section: Streets, Lit, Dibs, then the photo quests to come and Btown Hunt */
function drawLanes(page) {
  const c = C.city;
  const box = sec(page, 'lanes', 'On the streets');
  [['streets', c.streets], ['lit', c.lit], ['dibs', c.dibs]].forEach(([k, g]) => { if (g) box.appendChild(gameRow(k, g)); });
  const ph = c.photos;
  if (!ph) return;
  if (ph.now && ph.now.url) box.appendChild(gameRow('', { key: ph.key + ':now', emoji: '🪙', name: ph.now.name, line: ph.now.line, url: ph.now.url }));
  const r = gameRow('photos', { key: ph.key, emoji: ph.emoji, name: ph.name, line: ph.line, soon: true });
  r.dataset.placeholder = '1';
  box.appendChild(r);
}

function setCrew(k) {
  C.crew = NEIGHBORHOOD_LABELS[k] ? k : '';
  C.picking = false;
  if (!app.demo) store.write(CREW_KEY, C.crew);
  mode.redraw();
}
function drawCrews(page, g) {
  const box = sec(page, 'crews', 'Crews');
  if (C.crew && !C.picking) {
    const change = el('button', 'pillbtn', 'Change');
    change.type = 'button';
    change.addEventListener('click', () => { C.picking = true; mode.redraw(); });
    const r = row('city:crew', '🚩', NEIGHBORHOOD_LABELS[C.crew], [esc('Your crew')], [change]);
    r.dataset.crew = C.crew;
    box.appendChild(r);
  } else {
    if (g && g.line) box.appendChild(el('p', 'note pad', esc(g.line)));
    const pick = chips(Object.entries(NEIGHBORHOOD_LABELS).map(([key, label]) => ({ key, label })), C.crew, setCrew, 'pl-crews');
    box.appendChild(pick);
  }
}

function drawSeason(page, g) {
  const s = season();
  if (!s || !C.missions) {
    const box = sec(page, 'season', 'Season');
    const r = row('city:' + ((g && g.key) || 'season'), (g && g.emoji) || '🍂', 'Season', [esc((g && g.line) || '')], [soon()]);
    r.dataset.placeholder = '1';
    box.appendChild(r);
    return;
  }
  const set = s.marks.map((k) => missions().find((m) => markOf(m) === k)).filter(Boolean);
  const done = set.filter(isDone).length;
  const box = sec(page, 'season', s.name, done + ' of ' + set.length + ' · until ' + endName(s.ends));
  box.dataset.season = s.key;
  const list = el('div', 'missions');
  set.forEach((m) => list.appendChild(missionRow(m, 'season')));
  box.appendChild(list);
}

function draw(page) {
  const c = C.city;
  drawMissions(page);
  drawLanes(page);
  drawCrews(page, c.crews);
  drawSeason(page, c.season);
}

function load() {
  return Promise.all([
    playData(),
    data.fetchJSON(MISSIONS_URL, 8000).then((j) => (j && Array.isArray(j.missions) ? j : null), () => null),
    demoOf('play-city'),
  ]).then(([j, m, demo]) => {
    C.city = j.city || {};
    C.missions = m;
    const marks = demo ? demo.done : store.read(DONE_KEY, {});
    C.done = Object.create(null);
    if (Array.isArray(marks)) marks.forEach((k) => { C.done[k] = 1; });
    else if (marks && typeof marks === 'object') Object.keys(marks).forEach((k) => { if (marks[k]) C.done[k] = Number(marks[k]) || 1; });
    const crew = demo ? demo.crew : store.read(CREW_KEY, '');
    C.crew = NEIGHBORHOOD_LABELS[crew] ? crew : '';
  });
}

const mode = tab({
  key: KEY, label: 'City', icon: 'flag', promise: 'Claim your streets, one walk at a time.',
  tops: [['missions', 'Missions'], ['streets', 'Streets'], ['lit', 'Lit'], ['dibs', 'Dibs'], ['photos', 'Photo quests'], ['crews', 'Crews'], ['season', 'Season']],
  load, draw,
});
app.register(KEY, mode);
