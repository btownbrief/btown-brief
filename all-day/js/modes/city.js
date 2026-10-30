/* City (Play app, wave 1, 2026-10-29): the city game, as far as it exists
   today, and what is coming, named.

   - Missions: the Top 100+ missions What Now keeps (data/missions.json,
     the same file, read only). Five not yet done, picked by the Burlington
     date so everyone sees the same five that day, and how many are done.
     Done marks are What Now's (localStorage `allday-missions`, shared by
     every app on the guide); they are read here, never written. Each
     mission, and "All the missions", opens What Now in Out, where marking
     done happens.
   - Streets: Every Street, said plainly: built, but it runs only on a
     local copy today, so its button says Coming soon.
   - Lit: Keep Burlington Lit, unlisted on the arcade, with its link.
   - Dibs: with its link.
   - Photo quests, Crews, Season: placeholders that name what will appear.
     Photo quests points at Btown Hunt, the walk-and-collect game that is
     live now.

   ?demo=1 reads data/demo/play-city.json: which missions are done. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import { el, esc } from '../ui.js';
import { playData, demoOf, arr, plural, sec, link, soon, row, tab } from './playkit.js';

const KEY = 'city';
const MISSIONS_URL = '../data/missions.json';
const DONE_KEY = 'allday-missions';
const STABLE = /^m[2-9]\d\d$/;
const SHOWN = 5;

const C = { city: {}, missions: null, done: Object.create(null) };

const markOf = (m) => (typeof m.mark === 'string' && STABLE.test(m.mark) ? m.mark : m.k);
const missions = () => arr(C.missions && C.missions.missions).filter((m) => m && /^[a-z0-9-]{1,40}$/.test(String(m.k || '')) && m.title);
const isDone = (m) => !!C.done[markOf(m)];

/* five not done, a window that moves along by five each Burlington day */
function todays() {
  const open = missions().filter((m) => !isDone(m));
  if (open.length <= SHOWN) return open;
  const day = Math.round(Date.parse(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) + 'T12:00:00Z') / 86400000);
  const at = (day * SHOWN) % open.length;
  return open.slice(at, at + SHOWN).concat(open.slice(0, Math.max(0, at + SHOWN - open.length)));
}

function drawMissions(page) {
  const all = missions();
  const box = sec(page, 'missions', 'Missions', C.missions ? plural(all.filter(isDone).length, 'done', 'done') + ' of ' + all.length : '');
  if (!C.missions) { box.appendChild(el('p', 'note pad', esc('The missions didn’t load.'))); return; }
  box.appendChild(el('p', 'note pad', esc('The Top 100+ as missions. Five for today; mark them done in What Now.')));
  const list = el('div', 'missions');
  todays().forEach((m) => {
    const r = row('mission:' + m.k, '', m.title, [m.teaser ? esc(m.teaser) : ''], [link('Go', '#whatnow/' + m.k, 'pillbtn on', 'Mission ' + m.n + ': ' + m.title + ', in What Now')]);
    const num = r.querySelector('.th');
    num.className = 'num';
    num.textContent = String(m.n || '');
    list.appendChild(r);
  });
  box.appendChild(list);
  const more = el('div', 'linkrow');
  more.classList.add('pl-more');
  more.appendChild(link('All the missions', '#whatnow/missions', 'btn ghost sm'));
  box.appendChild(el('div', 'addrow')).appendChild(more);
}

/* a game in the city: its row, with its link or the honest line */
function drawGame(page, key, title, g) {
  if (!g) return;
  const box = sec(page, key, title);
  const lines = [esc(g.line || '')];
  if (g.honest) lines.push('<b>' + esc(g.honest) + '</b>');
  const go = g.soon || !g.url ? soon() : link('Play', g.url, 'pillbtn on', 'Play ' + g.name + ' on the arcade');
  box.appendChild(row('city:' + g.key, g.emoji, g.name, lines, [go]));
}

/* a top tab that is not built: what will appear, and anything live now */
function drawSoon(page, key, title, g) {
  if (!g) return;
  const box = sec(page, key, title);
  const r = row('city:' + g.key, g.emoji, title, [esc(g.line || '')], [soon()]);
  r.dataset.placeholder = '1';
  box.appendChild(r);
  if (g.now && g.now.url) box.appendChild(row('city:' + g.key + ':now', '🪙', g.now.name, [esc('Live now: ' + (g.now.line || ''))], [link('Play', g.now.url, 'pillbtn on', 'Play ' + g.now.name)]));
}

function draw(page) {
  const c = C.city;
  drawMissions(page);
  drawGame(page, 'streets', 'Streets', c.streets);
  drawGame(page, 'lit', 'Lit', c.lit);
  drawGame(page, 'dibs', 'Dibs', c.dibs);
  drawSoon(page, 'photos', 'Photo quests', c.photos);
  drawSoon(page, 'crews', 'Crews', c.crews);
  drawSoon(page, 'season', 'Season', c.season);
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
    else if (marks && typeof marks === 'object') Object.keys(marks).forEach((k) => { if (marks[k]) C.done[k] = 1; });
  });
}

app.register(KEY, tab({
  key: KEY, label: 'City', icon: 'flag', promise: 'Claim your streets, one walk at a time.',
  tops: [['missions', 'Missions'], ['streets', 'Streets'], ['lit', 'Lit'], ['dibs', 'Dibs'], ['photos', 'Photo quests'], ['crews', 'Crews'], ['season', 'Season']],
  load, draw,
}));
