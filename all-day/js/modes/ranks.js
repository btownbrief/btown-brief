/* Boards, route key `ranks` so it never collides with js/boards.js (Play app, wave 1, 2026-10-29): the arcade's scoreboards and the
   games board, in one place.

   - Leaderboards: this month's board for one game at a time, picked from a
     chip row of every live game that keeps one. It is the arcade's own
     read-only get_leaderboard call (store.rpc, the same one Games and the
     arcade's /leaderboards/ page use), one request per pick, so opening
     the tab never fires thirty. "Every board" opens Arcade's full board.
   - Predictions: a placeholder that names what is coming. The First Snow
     league is built on the staged/predictions-league branch, but that
     branch also changes the site's checks workflow, so it was not merged
     in here (wave 1's rule: merge it only if it just adds files).
   - Bracket: the Btown Bracket's link.
   - Playing, Looking for a group, Gamertags: Games' own boards, read the
     same way (boards.list on the `games` board, boards.handlesRecent),
     shown short here: the top games people play, the two newest open
     groups as the shell's board cards, and how many neighbors share a
     gamertag. Posting, "Me too" and the full lists stay in Arcade, where
     each "Open the board" button lands (#games/playing, lfg, tags).

   ?demo=1 reads the Games demo (data/demo/games.json: its catalog and
   boards) and data/demo/play-boards.json (which game the boards open on);
   the games board is the shell's demo copy (boards-fake.js). Nothing in
   the demo calls Supabase. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import * as boards from '../boards.js';
import { el, esc, mark, chips, cards } from '../ui.js';
import { playData, demoOf, arr, plural, sec, link, soon, row, tab } from './playkit.js';

const KEY = 'ranks';
const BOARD = 'games';
const CATALOG_URL = '../data/games-catalog.json';
const SLUG = /^[a-z0-9-]{1,40}$/;
const TOP = 10;
const BOARD_MS = 8000;
const PLAYS = 3;
const GROUPS = 2;
const GAMER = ['psn', 'xbox', 'steam', 'switch', 'discord', 'epic', 'riot', 'chess'];
const PLAT = { pc: 'PC', ps5: 'PS5', xbox: 'Xbox', switch: 'Switch', mobile: 'Phone', vr: 'VR', board: 'Board games', tabletop: 'Tabletop' };

const B = { words: {}, catalog: null, demoBoards: null, pick: '', rows: Object.create(null), posts: null, tags: null };

const TZ = 'America/New_York';
const monthKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const monthName = () => new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'long' }).format(new Date());
const num = (n) => Number(n || 0).toLocaleString('en-US');
const boardGames = () => arr(B.catalog && B.catalog.games).filter((g) => g && SLUG.test(String(g.slug || '')) && g.name && g.live === true && g.leaderboard === true);

/* ------------------------------------------------------- leaderboards */
function ask(slug) {
  if (B.rows[slug] !== undefined) return;
  if (B.demoBoards) { B.rows[slug] = arr(B.demoBoards[slug]); return; }
  B.rows[slug] = 'loading';
  Promise.race([store.rpc('get_leaderboard', { p_game: slug, p_month: monthKey() }), new Promise((res) => setTimeout(() => res(null), BOARD_MS))])
    .then((rows) => { B.rows[slug] = Array.isArray(rows) ? rows : null; })
    .catch(() => { B.rows[slug] = null; })
    .then(() => { if (B.pick === slug) mode.redraw(); });
}
/* one row per player, under their best score (the arcade sends best first) */
function onePerName(rows) {
  const seen = new Set();
  return arr(rows).filter((r) => { const n = String((r && r.name) || '').trim().toLowerCase(); if (!r || seen.has(n)) return false; seen.add(n); return true; });
}
function drawLeaders(page) {
  const box = sec(page, 'leaders', 'Leaderboards', monthName() + ', best this month');
  const list = boardGames();
  if (!B.catalog) { box.appendChild(el('p', 'note pad', esc('The game list didn’t load.'))); return; }
  if (!list.length) { box.appendChild(el('p', 'note pad', esc('No game keeps a board right now.'))); return; }
  if (!list.some((g) => g.slug === B.pick)) B.pick = list[0].slug;
  ask(B.pick);
  const row0 = chips(list.map((g) => ({ key: g.slug, label: g.name })), B.pick, (k) => { B.pick = k; ask(k); mode.redraw(); }, 'pl-games');
  box.appendChild(row0);
  const g = list.find((x) => x.slug === B.pick);
  const rows = B.rows[B.pick];
  const b = el('div', 'board');
  b.dataset.board = B.pick;
  if (rows === 'loading') box.appendChild(el('p', 'note pad', esc('Loading ' + g.name + '’s board…')));
  else if (rows === null) box.appendChild(el('p', 'note pad', esc('That board didn’t load.')));
  else if (!rows.length) box.appendChild(el('p', 'note pad', esc('No scores on ' + g.name + ' yet this month. First one in is the champ.')));
  else {
    onePerName(rows).slice(0, TOP).forEach((r, i) => {
      const x = el('div', 'r');
      x.innerHTML = '<span class="rank">' + (i + 1) + '</span>' + mark(r.name || 'Anonymous', 'round lg') + '<div><div class="t">' + esc(r.name || 'Anonymous') + '</div></div><span class="sc">' + esc(num(r.score)) + '</span>';
      b.appendChild(x);
    });
    box.appendChild(b);
  }
  const go = el('div', 'linkrow');
  go.append(link('Play ' + g.name, 'https://play.btownbrief.com/' + g.slug + '/', 'btn sm'), link('Every board', '#games/board', 'btn ghost sm'));
  box.appendChild(el('div', 'addrow')).appendChild(go);
}

/* ------------------------------------------------------ the games board */
function loadPosts() {
  return Promise.all([
    boards.list(BOARD, { kind: 'playing', limit: 50 }),
    boards.list(BOARD, { kind: 'lfg', limit: 20 }),
  ]).then(([pl, lf]) => {
    B.posts = { playing: pl.ok ? pl.posts : null, lfg: lf.ok ? lf.posts : null, err: pl.error || lf.error || '' };
  }, () => { B.posts = { playing: null, lfg: null, err: '' }; });
}
function loadTags() {
  if (!app.user()) { B.tags = { state: 'out', n: 0 }; return Promise.resolve(); }
  return boards.handlesRecent(GAMER, 40).then((r) => {
    B.tags = r.ok ? { state: 'ok', n: r.people.filter((p) => p && GAMER.some((k) => p.handles && typeof p.handles[k] === 'string' && p.handles[k].trim())).length }
      : { state: r.error === 'off' ? 'off' : 'err', n: 0 };
  });
}
const gameOf = (p) => String((p.meta && p.meta.game) || p.title || '').trim().slice(0, 60);
const quiet = (host, what) => host.appendChild(el('p', 'note pad', esc(B.posts && B.posts.err === 'off' ? 'Coming soon.' : what)));

function drawPlaying(page) {
  const box = sec(page, 'playing', 'What people are playing', null, link('Open the board', '#games/playing', 'btn ghost sm'));
  const posts = B.posts && B.posts.playing;
  if (!posts) { quiet(box, 'The board didn’t load.'); return; }
  if (!posts.length) { box.appendChild(el('p', 'note pad', esc('Nobody’s posted yet. Add yours in Arcade.'))); return; }
  const top = posts.map((p) => [p, 1 + (Number(p.votes) || 0)]).sort((a, b) => b[1] - a[1]).slice(0, PLAYS);
  top.forEach(([p, n], i) => {
    const plat = PLAT[p.meta && p.meta.platform] || '';
    const r = row('b-' + p.id, '', gameOf(p), [esc([plat, plural(n, 'person', 'people')].filter(Boolean).join(' · '))], [link('Me too', '#games/b-' + p.id, 'pillbtn', 'Me too on ' + gameOf(p) + ', in Arcade')]);
    const t = r.querySelector('.th');
    t.className = 'num';
    t.textContent = String(i + 1);
    box.appendChild(r);
  });
  if (posts.length > PLAYS) box.appendChild(el('p', 'note pad', esc(plural(posts.length - PLAYS, 'more game', 'more games') + ' on the board.')));
}

function drawLfg(page) {
  const box = sec(page, 'lfg', 'Looking for a group', null, link('All groups', '#games/lfg', 'btn ghost sm'));
  const posts = B.posts && B.posts.lfg;
  if (!posts) { quiet(box, 'The board didn’t load.'); return; }
  if (!posts.length) { box.appendChild(el('p', 'note pad', esc('No open groups. Start one in Arcade.'))); return; }
  const feed = el('div', 'feed');
  posts.slice(0, GROUPS).forEach((p) => {
    const it = boards.item(p, { tab: 'games', meta: (x) => [gameOf(x), PLAT[x.meta && x.meta.platform] || '', String((x.meta && x.meta.when) || '').slice(0, 60)].filter(Boolean).join(' · ') });
    app.know([it]);
    const n = cards.board(it);
    if (n) feed.appendChild(n);
  });
  box.appendChild(feed);
  if (posts.length > GROUPS) box.appendChild(el('p', 'note pad', esc(plural(posts.length - GROUPS, 'more group', 'more groups') + ' in Arcade.')));
}

function drawTags(page) {
  const box = sec(page, 'tags', 'Gamertags', null, link('See them', '#games/tags', 'btn ghost sm'));
  const T = B.tags || { state: 'out' };
  const words = T.state === 'out' ? 'Sign in to see the neighbors who share their PSN, Xbox, Steam or Discord name, and to add yours.'
    : T.state === 'ok' ? (T.n ? plural(T.n, 'neighbor shares', 'neighbors share') + ' a gamertag. Tap one in Arcade to copy it.' : 'No gamertags yet. Add yours in Arcade.')
      : T.state === 'off' ? 'Coming soon.' : 'They didn’t load.';
  const p = el('p', 'note pad', esc(words));
  p.dataset.tags = T.state;
  box.appendChild(p);
  if (T.state === 'out') { const r = el('div', 'addrow'); r.appendChild(Object.assign(el('button', 'btn sm', 'Sign in'), { type: 'button', onclick: () => app.openSettings() })); box.appendChild(r); }
}

/* ------------------------------------------------------------ the page */
function draw(page) {
  const w = B.words;
  drawLeaders(page);
  const pred = w.predictions || {};
  const pbox = sec(page, 'predictions', 'Predictions');
  const pr = row('boards:predictions', pred.emoji, pred.name || 'Predictions', [esc(pred.line || ''), pred.honest ? '<b>' + esc(pred.honest) + '</b>' : ''], [soon()]);
  pr.dataset.placeholder = '1';
  pbox.appendChild(pr);
  const br = w.bracket || {};
  const bbox = sec(page, 'bracket', 'Bracket');
  bbox.appendChild(row('boards:bracket', br.emoji, br.name || 'Btown Bracket', [esc(br.line || '')], br.url ? [link('Vote', br.url, 'pillbtn on', 'Open the Btown Bracket')] : [soon()]));
  drawPlaying(page);
  drawLfg(page);
  drawTags(page);
}

function load() {
  return Promise.all([
    playData(),
    app.demo ? app.demoData('games').catch(() => null) : data.fetchJSON(CATALOG_URL, 8000).catch(() => null),
    demoOf('play-boards'),
  ]).then(([j, cat, demo]) => {
    B.words = j.boards || {};
    if (app.demo) { B.catalog = cat && cat.catalog; B.demoBoards = (cat && cat.boards) || {}; B.pick = (demo && demo.pick) || ''; }
    else B.catalog = cat && Array.isArray(cat.games) ? cat : null;
    return Promise.all([loadPosts(), loadTags()]);
  });
}

const mode = tab({
  key: KEY, label: 'Boards', icon: 'trophy', promise: 'Leaderboards, predictions and who’s playing what.',
  tops: [['leaders', 'Leaderboards'], ['predictions', 'Predictions'], ['bracket', 'Bracket'], ['playing', 'Playing'], ['lfg', 'Looking for a group'], ['tags', 'Gamertags']],
  load, draw,
});
app.register(KEY, mode);
/* signing in or out changes the gamertags line; a post in Arcade changes the board */
app.onAuth(() => { loadTags().then(() => mode.redraw()); });
window.addEventListener('allday-boards', (e) => { if ((e.detail || {}).board === BOARD) loadPosts().then(() => mode.redraw()); });
