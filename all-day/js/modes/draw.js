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

   ?demo=1 reads data/demo/play-draw.json, which shows the page as it will
   look once the game is live; its Play only toasts. */

import * as app from '../app.js';
import * as data from '../wire.js';
import { el, esc } from '../ui.js';
import { playData, demoOf, arr, sec, link, soon, row, tab } from './playkit.js';

const KEY = 'draw';
const CATALOG_URL = '../data/games-catalog.json';

const W = { draw: null, live: false };

function playButton(cls) {
  const d = W.draw;
  if (!W.live) { const b = soon(); b.className = cls.replace(' on', ''); b.dataset.play = 'soon'; return b; }
  if (app.demo) {
    const b = el('button', cls, 'Play');
    b.type = 'button';
    b.dataset.play = 'demo';
    b.addEventListener('click', () => app.toast('In the demo, Play would open ' + d.name + ' on the arcade.'));
    return b;
  }
  const a = link('Play', d.play, cls, 'Play ' + d.name + ' on the arcade');
  a.dataset.play = 'live';
  return a;
}

function part(key, p) {
  const c = el('article', 'gm-cab');
  c.dataset.k = 'draw:' + key;
  c.dataset.sec = key;
  const scr = el('span', 'gm-scr shot', '<img src="' + esc(p.shot) + '" alt="' + esc(p.title + ' in ' + W.draw.name) + '" width="480" height="1039" loading="lazy" decoding="async">');
  scr.style.aspectRatio = '4 / 5';
  const body = el('div', 'gm-cab-b', '<h3 class="gm-name">' + esc(p.title) + '</h3><p class="gm-pitch pl-full">' + esc(p.line) + '</p>');
  /* the line is the whole description here, not a two-line teaser */
  body.querySelector('.gm-pitch').style.webkitLineClamp = 'unset';
  body.querySelector('.gm-pitch').style.display = 'block';
  c.append(scr, body);
  return c;
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
  /* the gallery, then the prompt, the map's order */
  const more = sec(page, 'gallery', 'Every week');
  arr(d.more).forEach((m) => {
    const r = row('draw:' + m.key, m.emoji, m.title, [esc(m.line)], []);
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
  });
}

app.register(KEY, tab({
  key: KEY, label: 'Draw', icon: 'pencil', promise: 'Draw a fish and watch it swim in the shared tank.',
  tops: [['lake', 'Aquarium'], ['truck', 'The truck'], ['gallery', 'Gallery'], ['prompt', 'Prompt of the week']],
  load, draw,
}));
