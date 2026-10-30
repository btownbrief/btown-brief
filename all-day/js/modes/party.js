/* Party (Play app, wave 1, 2026-10-29): the games for a room of people,
   each a row with when to reach for it and its link: Btown Party, Church
   Street Trivia (unlisted on the arcade; its host page too), Arcade Night,
   Stay Awhile and Table Talk (the guide's own table.html). The words are
   data/play/play.json's `party`.

   Nothing here is invented, so ?demo=1 shows the same page. */

import * as app from '../app.js';
import { esc } from '../ui.js';
import { playData, arr, sec, link, row, tab } from './playkit.js';

const KEY = 'party';
/* the pill's word for each game, the map's top tabs */
const TOPS = [['btown-party', 'Btown Party'], ['church-street-trivia', 'Trivia'], ['arcade-night', 'Arcade Night'], ['stay-awhile', 'Stay Awhile'], ['table-talk', 'Table Talk']];

const P = { games: [] };

function draw(page) {
  const box = sec(page, 'games', 'Games for a room');
  P.games.forEach((g) => {
    const lines = [esc(g.when)];
    const buttons = [link('Open', g.url, 'pillbtn on', 'Open ' + g.name)];
    if (g.host) buttons.push(link('Host', g.host, 'pillbtn', 'Host ' + g.name + ' from a laptop on the TV'));
    const r = row('party:' + g.key, g.emoji, g.name, lines, buttons);
    r.dataset.sec = g.key;
    box.appendChild(r);
  });
}

function load() {
  return playData().then((j) => {
    P.games = arr(j.party).filter((g) => g && /^[a-z0-9-]{1,40}$/.test(String(g.key || '')) && g.name && g.url);
  });
}

app.register(KEY, tab({
  key: KEY, label: 'Party', icon: 'party', promise: 'Party games for the whole room.',
  tops: TOPS, load, draw,
}));
