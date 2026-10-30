/* Party (Play app, 2026-10-29): a game-night kit. The words and links are
   data/play/play.json's `party`.

   - Game night: a bar night in order, numbered: Btown Party to start (its
     screen on the TV, the host on a phone), Church Street Trivia (the host
     page is what goes on the TV), Arcade Night's finals, Stay Awhile at
     last call. Each step has its one line and its buttons: On the TV for
     the page the TV shows, Host or Play for phones.
   - At home: Table Talk, and Stay Awhile for a table of new people.

   Each game is its own top tab (the row is the section). Nothing here is
   invented, so ?demo=1 shows the same page. */

import * as app from '../app.js';
import { el, esc } from '../ui.js';
import { playData, arr, sec, link, row, tab } from './playkit.js';

const KEY = 'party';
const SLUG = /^[a-z0-9-]{1,40}$/;
const TOPS = [['btown-party', 'Btown Party'], ['church-street-trivia', 'Trivia'], ['arcade-night', 'Arcade Night'], ['stay-awhile', 'Stay Awhile'], ['table-talk', 'Table Talk']];

const P = { night: [], table: [] };

function gameRow(g, n) {
  const buttons = [];
  if (g.tv) buttons.push(link('On the TV', g.tv, 'pillbtn on', g.name + ': open on the TV'));
  if (g.host) buttons.push(link('Host', g.host, 'pillbtn', g.name + ': host from a phone'));
  if (g.play) buttons.push(link(g.tv ? 'Phones' : 'Open', g.play, g.tv ? 'pillbtn' : 'pillbtn on', 'Open ' + g.name));
  const r = row('party:' + g.key, g.emoji, g.name, [esc(g.when || '')], buttons);
  if (n) {
    const t = r.querySelector('.th');
    t.className = 'num';
    t.textContent = String(n);
  }
  if (TOPS.some(([k]) => k === g.key)) r.dataset.sec = g.key;
  return r;
}

function draw(page) {
  const night = sec(page, 'night', 'Game night');
  P.night.forEach((g, i) => night.appendChild(gameRow(g, i + 1)));
  if (!P.table.length) return;
  const home = sec(page, 'table', 'At a table');
  P.table.forEach((g) => home.appendChild(gameRow(g, 0)));
}

const ok = (g) => g && SLUG.test(String(g.key || '')) && g.name && (g.tv || g.play);
function load() {
  return playData().then((j) => {
    const p = j.party || {};
    P.night = arr(p.night).filter(ok);
    P.table = arr(p.table).filter(ok);
  });
}

app.register(KEY, tab({
  key: KEY, label: 'Party', icon: 'party', promise: 'Party games for the whole room.',
  tops: TOPS, load, draw,
}));
