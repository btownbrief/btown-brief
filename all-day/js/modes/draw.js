/* Draw (Play app, wave 1, 2026-10-29): the page for Btown Draw, the drawing
   world built today as its own arcade game (~/btownbrief/btown-draw, see
   newsletter/reference/drafts/apps-2026-10/draw-report.md).

   - The Lake and the Truck, each with a screenshot from the game
     (data/play/draw-lake.jpg, draw-truck.jpg) and a few lines on what it is;
     the Prompt of the week and the Gallery as two rows under them.
   - Play points at the arcade path the deploy note names
     (play.btownbrief.com/btown-draw/#lake). Until the game is live it is
     disabled and says Coming soon. "Live" is the arcade's own word for it:
     the game is in data/games-catalog.json (the arcade's games.json, built
     daily) with live: true, so the button wakes up on its own the day
     Stephen adds the game to the arcade, with no change here.

   Once live, the pictures and the Gallery and Prompt rows open the game
   at their own routes (#lake, #truck, #gallery, #prompt), and the truck's
   monthly board shows under them (get_leaderboard, game key btown-draw,
   read only; distance in metres).

   ?demo=1 reads data/demo/play-draw.json, which shows the page as it will
   look once the game is live, with an invented board; its buttons only
   toast. */

import * as app from '../app.js';
import * as data from '../wire.js';
import * as store from '../store.js';
import { el, esc, mark } from '../ui.js';
import { playData, demoOf, arr, sec, link, soon, row, tab } from './playkit.js';

const KEY = 'draw';
const CATALOG_URL = '../data/games-catalog.json';

const TZ = 'America/New_York';
const TOP = 5;
const BOARD_MS = 8000;

const W = { draw: null, live: false, board: null };

const monthKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const monthName = () => new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'long' }).format(new Date());
/* a part of the game by its own route (#lake, #truck, #gallery, #prompt) */
const routeUrl = (r) => String(W.draw.play || '').split('#')[0] + '#' + r;
/* once live, a thing that opens the game at a route: a link, or in the demo a toast */
function opener(html, route, cls, aria) {
  if (app.demo) {
    const b = el('button', cls, html);
    b.type = 'button';
    b.dataset.play = 'demo';
    b.setAttribute('aria-label', aria);
    b.addEventListener('click', () => app.toast('In the demo, this would open ' + W.draw.name + '.'));
    return b;
  }
  const a = link(html, routeUrl(route), cls, aria);
  a.dataset.play = 'live';
  return a;
}

function playButton(cls) {
  const d = W.draw;
  if (!W.live) { const b = soon(); b.className = cls.replace(' on', ''); b.dataset.play = 'soon'; return b; }
  return opener('Play', 'lake', cls, 'Play ' + d.name + ' on the arcade');
}

function part(key, p) {
  const c = el('article', 'gm-cab');
  c.dataset.k = 'draw:' + key;
  c.dataset.sec = key;
  const img = '<img src="' + esc(p.shot) + '" alt="' + esc(p.title + ' in ' + W.draw.name) + '" width="480" height="1039" loading="lazy" decoding="async">';
  /* live, the picture opens that part of the game */
  const scr = W.live ? opener(img, key, 'gm-scr shot', 'Open ' + p.title) : el('span', 'gm-scr shot', img);
  scr.style.aspectRatio = '4 / 5';
  const body = el('div', 'gm-cab-b', '<h3 class="gm-name">' + esc(p.title) + '</h3><p class="gm-pitch pl-full">' + esc(p.line) + '</p>');
  /* the line is the whole description here, not a two-line teaser */
  body.querySelector('.gm-pitch').style.webkitLineClamp = 'unset';
  body.querySelector('.gm-pitch').style.display = 'block';
  c.append(scr, body);
  return c;
}

/* the truck's monthly board: distance in metres, each player once */
function drawBoard(page) {
  const box = sec(page, 'board', 'The truck’s board', monthName());
  if (W.board === null) { box.appendChild(el('p', 'note pad', esc('The board didn’t load.'))); return; }
  const seen = new Set();
  const rows = W.board.filter((r) => { const n = String((r && r.name) || '').trim().toLowerCase(); if (!r || seen.has(n)) return false; seen.add(n); return true; }).slice(0, TOP);
  if (!rows.length) { box.appendChild(el('p', 'note pad', esc('No runs yet.'))); return; }
  const b = el('div', 'board');
  b.dataset.board = W.draw.slug;
  rows.forEach((r, i) => {
    const x = el('div', 'r');
    x.innerHTML = '<span class="rank">' + (i + 1) + '</span>' + mark(r.name || 'Anonymous', 'round lg') + '<div><div class="t">' + esc(r.name || 'Anonymous') + '</div></div><span class="sc">' + esc(Number(r.score || 0).toLocaleString('en-US')) + ' m</span>';
    b.appendChild(x);
  });
  box.appendChild(b);
}

function draw(page) {
  const d = W.draw;
  const top = sec(page, 'about', d.name);
  const go = el('div', 'addrow');
  go.appendChild(playButton('btn'));
  top.appendChild(go);
  const grid = el('div', 'gm-grid');
  grid.dataset.sec = 'lake';
  grid.appendChild(part('lake', d.lake));
  grid.lastChild.removeAttribute('data-sec');
  grid.appendChild(part('truck', d.truck));
  page.appendChild(el('div', 'spacer'));
  page.appendChild(grid);
  if (W.live) drawBoard(page);
  /* the gallery, then the prompt, the map's order */
  const more = sec(page, 'gallery', 'Every week');
  arr(d.more).forEach((m) => {
    const r = row('draw:' + m.key, m.emoji, m.title, [esc(m.line)], W.live ? [opener('Open', m.key, 'pillbtn', 'Open the ' + m.title)] : []);
    if (m.key === 'prompt') r.dataset.sec = 'prompt';
    more.appendChild(r);
  });
}

function load() {
  return Promise.all([
    playData(),
    data.fetchJSON(CATALOG_URL, 8000).catch(() => null),
    demoOf('play-draw'),
  ]).then(([j, cat, demo]) => {
    if (!j.draw || !j.draw.lake || !j.draw.truck) throw new Error('no draw');
    W.draw = j.draw;
    const g = arr(cat && cat.games).find((x) => x && x.slug === j.draw.slug);
    W.live = demo ? demo.live === true : !!(g && g.live === true);
    if (!W.live) return null;
    if (demo) { W.board = arr(demo.board); return null; }
    /* the truck's distances are the arcade's own monthly board, read only */
    return Promise.race([store.rpc('get_leaderboard', { p_game: j.draw.slug, p_month: monthKey() }), new Promise((res) => setTimeout(() => res(null), BOARD_MS))])
      .then((rows) => { W.board = Array.isArray(rows) ? rows : null; }, () => { W.board = null; });
  });
}

app.register(KEY, tab({
  key: KEY, label: 'Draw', icon: 'pencil', promise: 'Draw a fish and watch it swim in the shared tank.',
  tops: [['lake', 'Aquarium'], ['truck', 'The truck'], ['gallery', 'Gallery'], ['prompt', 'Prompt of the week']],
  load, draw, stamp: monthKey,
}));
