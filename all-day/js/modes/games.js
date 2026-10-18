/* Games: the Btown arcade (play.btownbrief.com) and the people around town
   who play anything, from inside All Day. Top to bottom:

   - The News Quiz, featured: five questions from this week's Brief (the
     quiz's own data/questions.json), one minute on the clock. It is the one
     game that sends the reader to the newsletter, so it leads the tab and
     is left out of the arcade's cabinets below.
   - The arcade: the arcade's own games as cabinets (a picture of the game
     being played, or its emoji on a coloured screen, the name, the pitch,
     this month's champ, Play), newest first, with chips for New, each of the
     arcade's sections and Out in Burlington. Every cabinet has Invite: a
     text message with the game's link.
   - What people are playing: the `games` board's `playing` posts (game and
     platform, 14 days), a poll with "Me too" as the board's vote, platform
     chips, and an "I'm playing…" line to add yours.
   - Looking for a group: the board's `lfg` posts (game, platform, when, 7
     days) on the shell's board card, its vote painted "I'm in", with
     Invite by text.
   - Gamertags: for a signed-in reader, the members who switched their
     handles on, with their gaming kinds only (boards.handlesRecent), each a
     chip that copies the name. "Add your gamertag" opens the profile sheet
     at its Games fold. Nothing here keeps a handle.
   - VR corner: Stephen's picks on the Quest store, and how many neighbors
     posted a VR game.
   - Challenge a neighbor: the games on the Hangout's challenge allowlist
     (church-street-hangout/js/challenge.js), kept by the catalog only while
     each still opens a room from ?join=CODE. A room's seat is tied to a
     device token in play.btownbrief.com's own storage, so a room made from
     here would seat this app instead of the reader. The tab sends the reader
     to the game's own Host flow, which makes the room on the arcade and hands
     back the join link to text.
   - This month's leaderboard: every live game that keeps a board as a
     headline (name, Play) with its "Top scores" attached below it, the top
     five and a control for the top ten. Each player shows once per board,
     under their best score, from the same read-only get_leaderboard RPC the arcade's own
     /leaderboards/ page calls (best first), grouped by the arcade's sections. The arcade
     knows a player by a device id on play.btownbrief.com, which this app
     (another origin) cannot read, so the tab asks once for the name the
     reader plays under, keeps it on this device, and marks the rows with
     that name. Names are not unique; when two players share one, it says so.
     No name, no highlight, and no guessing.
   - Champions: champions.json (the arcade's champions workflow, every six
     hours): the reigning champ on each board and the all-arcade leaders.
   - Arcade chat: a door to the community's Btown Arcade channel and to
     Telegram. The talk lives there; nothing is built here.

   Invites are sms: links with the message in the body (no number: the
   reader picks who in Messages), so nothing reads or keeps a contact. On a
   screen without touch, where sms: goes nowhere, Invite hands the same
   words to the share sheet, or copies them.

   The catalog is data/games-catalog.json (scripts/build_games.py, daily):
   the arcade's games.json plus the day each game went live.

   ?demo=1 runs exactly this file on data/demo/games.json, which holds the
   catalog, the boards and champions.json in their real shapes, re-dated to
   the reader's clock, and a few more invented posts for the boards' demo
   copy (boards-fake.js). Nothing in the demo calls Supabase. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import * as boards from '../boards.js';
import { RULES, HANDLE_LABELS, NEIGHBORHOOD_LABELS } from '../boards-core.js';
import { el, esc, safeHref, ICON, mark, section, chips, button, divider, cards, agoShort } from '../ui.js';

const KEY = 'games';
const BOARD = 'games';
const ARCADE = 'https://play.btownbrief.com/';
const BOARDS_PAGE = ARCADE + 'leaderboards/';
const CATALOG_URL = '../data/games-catalog.json';
const CHAT_URL = 'https://www.btownbrief.com/community/channels/photo-wall';   // the Btown Arcade channel; the slug is historical
const TELEGRAM_URL = '../telegram.html';
const NAME_KEY = 'allday-arcade-name';
const TOP = 10;           // the arcade's own board is a top ten
const SHOWN = 5;          // drawn before "Top 10"
const NEW_DAYS = 30;
const PARALLEL = 6;       // board requests in flight at once
const BOARD_MS = 8000;    // a board that has not answered by then is counted as not loaded
const CABS = 4;           // cabinets in the grid before "All n games"
const POLL = 8;           // playing rows before "n more"
const TAGS = 12;          // gamertag rows before "n more"
const SLUG = /^[a-z0-9-]{1,40}$/;
/* The games with a moment of real play as their picture (assets/games/<slug>.webp,
   taken by tests/game-shots.mjs). A game not on this list, a new one or one that
   needs a live room to show anything, keeps its emoji on a coloured screen. */
const SHOTS = new Set([
  'archive', 'battle-on-the-lake', 'btown-cribbage', 'btown-crossings', 'btown-hangman', 'btown-riddle',
  'btown-wordle', 'burlington-days', 'challenges', 'champlain-glider', 'church-street-checkers',
  'church-street-runner', 'church-street-skate', 'church-street-zombies', 'crazy-eights', 'creemee-drop',
  'dibs', 'earlier-or-later', 'filed', 'flappy-champ', 'four-in-a-rowboat', 'front-porch-dominoes',
  'heads-up-btown', 'higher-or-lower', 'kings-corner', 'lake-breath', 'little-local', 'maple-mancala',
  'maple-scramble', 'maples-to-maples', 'news-quiz', 'north-star-hop', 'peak-foliage', 'pothole-patrol',
  'queen-city-chess', 'rank-what-you-know', 'real-or-fake', 'snowball-slinger', 'stay-awhile', 'street-yeet',
  'sugarbush-squares', 'tap-the-maple', 'trivia-ladder', 'where-in-btown', 'whos-playing'
]);
/* The featured game. The catalog may or may not list it (the demo's does
   not), so the tab carries what it needs to draw the card. Five questions and
   a sixty-second clock are the quiz's own (news-quiz/data/questions.json). */
const QUIZ = { slug: 'news-quiz', emoji: '🗞️', name: 'News Quiz', pitch: 'Five questions from this week’s Brief. One minute.' };

/* the board's platforms, in its own order, and the words for them */
const PLATFORMS = [['pc', 'PC'], ['ps5', 'PS5'], ['xbox', 'Xbox'], ['switch', 'Switch'], ['mobile', 'Phone'], ['vr', 'VR'], ['board', 'Board games'], ['tabletop', 'Tabletop']];
const PLAT = Object.fromEntries(PLATFORMS);
/* the profile's Games fold: the only handle kinds this tab ever asks for */
const GAMER = ['psn', 'xbox', 'steam', 'switch', 'discord', 'epic', 'riot', 'chess'];

/* The VR corner: Stephen's three picks (boxing, ping pong, golf), each on
   its official Meta store page (checked 2026-10-18; Meta has sold these
   three together as one sports pack). No prices and no sales here: those
   change by the day. */
const VR = [
  { k: 'vr:thrill-of-the-fight-2', emoji: '🥊', name: 'The Thrill of the Fight 2', what: 'Boxing',
    url: 'https://www.meta.com/experiences/the-thrill-of-the-fight-2/5479643155418422/' },
  { k: 'vr:eleven-table-tennis', emoji: '🏓', name: 'Eleven Table Tennis', what: 'Ping pong',
    url: 'https://www.meta.com/experiences/eleven-table-tennis/1995434190525828/' },
  { k: 'vr:golf-plus', emoji: '⛳', name: 'GOLF+', what: 'Golf',
    url: 'https://www.meta.com/experiences/golf/2412327085529357/' },
];

const arr = (v) => (Array.isArray(v) ? v : []);
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const num = (n) => Number(n || 0).toLocaleString('en-US');
const playUrl = (slug) => (SLUG.test(slug) ? ARCADE + slug + '/' : ARCADE);
const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
/* One row per player name on a board: the first one, since get_leaderboard
   answers best first (and "best" is the arcade's to define; some games score
   low-is-better). Names match without case or extra spaces; the row keeps
   its own spelling. A row with no name is not a name, so each stays. */
function onePerName(rows) {
  const seen = new Set();
  return arr(rows).filter((r) => {
    const k = r ? norm(r.name) : '';
    if (!k) return !!r;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
const ORD = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
/* one line of plain text: no control characters, no line breaks, no
   direction overrides (they could make a texted link read as another), no
   half of an emoji; cut by characters, so the cut never splits one either */
const unsafe = (c) => c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x61c || c === 0x200e || c === 0x200f || (c >= 0x202a && c <= 0x202e) ||
  c === 0x2028 || c === 0x2029 || (c >= 0x2066 && c <= 0x2069) || (c >= 0xd800 && c <= 0xdfff);
const line1 = (s, max) => [...[...String(s == null ? '' : s)].map((ch) => (unsafe(ch.codePointAt(0)) ? ' ' : ch)).join('').replace(/\s+/g, ' ').trim()]
  .slice(0, max || 200).join('').trim();
/* a stable colour for a game's cabinet screen, from the shell's mark hues */
const hue = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 8; };

/* --------------------------------------------------------------- clock */
/* The boards' month is Burlington's (the scores table's month_key). */
const TZ = 'America/New_York';
const keyFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const monthFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long' });
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
function etDay(ms) {
  const o = {};
  keyFmt.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
  return o.year + '-' + o.month + '-' + o.day;
}
const todayKey = () => etDay(Date.now());
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const utcNoon = (date) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
const addDays = (date, n) => { const t = utcNoon(date); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((utcNoon(b) - utcNoon(a)) / 86400000);
const monthKey = () => todayKey().slice(0, 7);
const monthName = (ym) => monthFmt.format(utcNoon(ym + '-01'));
const dayName = (date) => dayFmt.format(utcNoon(date));          // "October 10"
const clock = (ms) => timeFmt.format(new Date(ms)).replace(/\s+/g, ' ').toLowerCase();
function nextReset() {
  const [y, m] = monthKey().split('-').map(Number);
  const first = new Date(Date.UTC(y, m, 1, 12)).toISOString().slice(0, 10);
  return { date: first, days: daysBetween(todayKey(), first) };
}

/* ----------------------------------------------------------------- state */
const G = {
  root: null, slots: null,
  catalog: null, champions: null,
  boards: Object.create(null),   // slug -> rows, or null when that board did not answer
  boardMonth: '',                // the ET month the boards were read for
  run: 0,                        // which board load is current; an older one's answers are dropped
  settled: Object.create(null), failed: Object.create(null),
  open: Object.create(null),     // slug -> the rest of the top ten is showing
  group: null,                   // which section's boards are showing
  pick: null,                    // the game picked to challenge with
  refused: null,                 // a game a link asked for that cannot host
  editing: false,
  pending: null,
  demo: null,
  arc: 'all',                    // which arcade chip is on
  arcOpen: false,                // every game under that chip is showing
  posts: null,                   // the games board: { playing, lfg }, each a list or null when it did not load
  postErr: { playing: '', lfg: '' },
  postRun: 0,
  four: false,                   // the server takes the games board's posts (nn-ROUND4.sql)
  plat: 'all',                   // which platform chip is on in the poll
  pollOpen: false,
  sayPlat: '',                   // the platform the "I'm playing" line starts on
  tags: { state: 'out', people: [] },
  tagRun: 0,
  tagsOpen: false,
};
const PARTS = ['catalog', 'champions', 'boards'];

/* The name the reader plays under: this device's, or the visit's in the demo. */
let demoName = '';
const readerName = () => (app.demo ? demoName : String(store.read(NAME_KEY, '') || ''));
function setReaderName(v) {
  const s = String(v || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  if (app.demo) demoName = s; else store.write(NAME_KEY, s);
  return s;
}

/* ------------------------------------------------------------- sources */
const games = () => arr(G.catalog && G.catalog.games).filter((g) => g && SLUG.test(String(g.slug || '')) && g.name);
const live = () => games().filter((g) => g.live === true);
const boardGames = () => live().filter((g) => g.leaderboard === true);
const roomGames = () => live().filter((g) => g.rooms === true);
const bySlug = (slug) => games().find((g) => g.slug === slug) || null;
const since = (g) => (isDate(g.live_since) ? g.live_since : isDate(g.first_seen) ? g.first_seen : '');
function newGames() {
  const cut = addDays(todayKey(), -NEW_DAYS);
  return live().filter((g) => since(g) && since(g) > cut && since(g) <= todayKey())
    .sort((a, b) => (since(a) < since(b) ? 1 : -1));
}

/* The demo file is written on 2026-10-16; move its dates by however long ago
   that was, so "added six days ago" and "this month" stay true. */
function redate(d) {
  const days = daysBetween(String(d._anchor || '2026-10-16'), todayKey());
  arr(d.catalog && d.catalog.games).forEach((g) => {
    if (isDate(g.first_seen)) g.first_seen = addDays(g.first_seen, days);
    if (isDate(g.live_since)) g.live_since = addDays(g.live_since, days);
  });
  if (d.champions) {
    d.champions.month = monthKey();
    d.champions.monthLabel = monthName(monthKey());
    d.champions.updated = new Date(Date.now() - 2 * 3600000).toISOString();
  }
  return d;
}

function loadDemo() {
  return app.demoData(KEY).then(redate).then((d) => {
    G.demo = d;
    G.catalog = d.catalog;
    G.champions = d.champions;
    Object.entries(d.boards || {}).forEach(([slug, rows]) => { G.boards[slug] = onePerName(rows); });
    PARTS.forEach((p) => { G.settled[p] = true; });
  });
}

function loadLive() {
  data.fetchJSON(CATALOG_URL, 8000)
    .then((j) => { if (!j || !Array.isArray(j.games)) throw new Error('bad shape'); G.catalog = j; })
    .catch(() => { G.failed.catalog = true; })
    .then(() => { G.settled.catalog = true; render(); return loadBoards(); });
  data.load('champions', (j) => { G.champions = j; G.settled.champions = true; delete G.failed.champions; render(); },
    () => { G.settled.champions = true; G.failed.champions = true; render(); });
}

/* Every board, six at a time; store.rpc answers null for a board that
   failed, which is kept apart from a board with no scores yet ([]). */
function loadBoards() {
  const list = boardGames();
  const month = monthKey();
  const run = ++G.run;
  G.boardMonth = month;
  let i = 0;
  /* store.rpc has no deadline of its own; one stalled board must not hold
     the other thirty, or the deep links that wait for them */
  const ask = (slug) => Promise.race([
    store.rpc('get_leaderboard', { p_game: slug, p_month: month }),
    new Promise((res) => setTimeout(() => res(null), BOARD_MS)),
  ]);
  const next = () => {
    if (i >= list.length || run !== G.run) return Promise.resolve();
    const g = list[i++];
    return ask(g.slug)
      .then((rows) => { if (run === G.run) G.boards[g.slug] = Array.isArray(rows) ? onePerName(rows) : null; })
      .then(next);
  };
  return Promise.all(Array.from({ length: Math.min(PARALLEL, list.length) }, next)).then(() => {
    if (run !== G.run) return;
    G.settled.boards = true;
    if (list.length && list.every((g) => G.boards[g.slug] === null)) G.failed.boards = true;
    render();
    app.recount();
  });
}

/* ------------------------------------------------------------ the reader */
/* Every row on every board under the reader's name, and how many different
   players those rows belong to. */
function mine() {
  const want = norm(readerName());
  const hits = [];
  if (!want) return { want, hits, players: 0 };
  Object.entries(G.boards).forEach(([slug, rows]) => arr(rows).forEach((r, i) => {
    if (r && norm(r.name) === want) hits.push({ slug, rank: i + 1, row: r });
  }));
  const players = new Set(hits.map((h) => String(h.row.player_id || h.slug + h.rank))).size;
  return { want, hits, players };
}
const isMe = (r, want) => !!want && !!r && norm(r.name) === want;

/* ---------------------------------------------------------------- draw */
const sec = (host, title, sub, key, right) => { const s = section(host, title, sub, right); if (key) s.dataset.sec = key; return s; };

function extLink(label, href, cls) {
  const a = el('a', 'btn' + (cls ? ' ' + cls : ''), label);
  a.href = safeHref(href); a.target = '_blank'; a.rel = 'noopener';
  return a;
}
function playPill(g) {
  const a = el('a', 'pillbtn on', 'Play ' + ICON.ext);
  a.href = playUrl(g.slug); a.target = '_blank'; a.rel = 'noopener';
  a.setAttribute('aria-label', 'Play ' + g.name + ' on the arcade');
  return a;
}
/* a game as a list row: its emoji, its name, a line, and Play */
function gameRow(g, key, line) {
  const r = el('div', 'lrow');
  r.dataset.k = key;
  r.dataset.slug = g.slug;
  r.innerHTML = '<span class="th bare" aria-hidden="true">' + esc(g.emoji || '') + '</span><div><div class="t">' + esc(g.name) + '</div>' +
    (line ? '<div class="s">' + line + '</div>' : '') + '</div>';
  r.appendChild(playPill(g));
  return r;
}

function boardRow(r, rank, want, sub, score) {
  const me = isMe(r, want);
  const row = el('div', 'r' + (me ? ' me' : ''));
  if (me) row.dataset.me = '1';
  row.innerHTML = '<span class="rank">' + rank + '</span>' + mark(r.name || 'Anonymous', 'round lg') + '<div><div class="t">' + esc(r.name || 'Anonymous') +
    '</div>' + (sub ? '<div class="s">' + esc(sub) + '</div>' : '') + '</div><span class="sc">' + esc(score != null ? score : num(r.score)) + '</span>';
  return row;
}

/* the name form, or the line that says what the name found */
function drawYou(host) {
  const name = readerName();
  if (!name || G.editing) {
    const card = el('div', 'textcard');
    card.dataset.you = 'ask';
    card.innerHTML = '<h3>Which name do you play under?</h3>';
    const form = el('form', 'signin');
    const input = el('input', 'field');
    input.type = 'text'; input.name = 'arcade-name'; input.maxLength = 24; input.autocomplete = 'nickname';
    input.placeholder = app.demo && G.demo && G.demo._you ? 'In the demo, try ' + G.demo._you : 'Your arcade name';
    input.setAttribute('aria-label', 'The name you play under at the arcade');
    input.value = name;
    const go = el('button', 'btn', 'Find me');
    go.type = 'submit';
    form.append(input, go);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = setReaderName(input.value);
      G.editing = false;
      if (v && mine().hits.length) G.group = 'yours';
      drawYouSlot();
      drawBoardsSlot();
      if (v) {
        const m = mine();
        const first = m.hits.length && G.root.querySelector('[data-me]');
        if (first) app.jumpTo(first.closest('.board') || first);
      }
    });
    card.appendChild(form);
    if (name) card.appendChild(button('Keep ' + esc(name), 'ghost sm', () => { G.editing = false; drawYouSlot(); }));
    host.appendChild(card);
    return;
  }
  const m = mine();
  const card = el('div', 'textcard');
  card.dataset.you = m.hits.length ? 'found' : 'none';
  let line;
  if (!G.settled.boards) line = 'Looking for <b>' + esc(name) + '</b> on the boards…';
  else if (!m.hits.length) line = 'No score this month under <b>' + esc(name) + '</b>.';
  else {
    const boards = new Set(m.hits.map((h) => h.slug)).size;
    const best = m.hits.reduce((a, b) => (b.rank < a.rank ? b : a));
    const g = bySlug(best.slug);
    line = 'Playing as <b>' + esc(name) + '</b>: on ' + esc(plural(boards, 'board', 'boards')) + ' this month, best ' + esc(ORD(best.rank)) + (g ? ' in ' + esc(g.name) : '') + '.';
    if (m.players > 1) line += ' ' + esc(plural(m.players, 'player uses', 'players use') + ' that name.');
  }
  card.innerHTML = '<p>' + line + '</p>';
  const row = el('div', 'row');
  row.appendChild(button('Change name', 'ghost sm', () => { G.editing = true; drawYouSlot(); const f = G.root.querySelector('[data-you] input'); if (f) f.focus(); }));
  row.appendChild(button('Forget it', 'ghost sm', () => { setReaderName(''); drawYouSlot(); drawBoardsSlot(); }));
  card.appendChild(row);
  host.appendChild(card);
}

function drawBoardHead(host) {
  const r = nextReset();
  const all = extLink('All boards ' + ICON.ext, BOARDS_PAGE, 'ghost sm');
  sec(host, 'This month’s leaderboard', esc('Resets ' + (r.days === 1 ? 'tomorrow' : 'in ' + r.days + ' days')), 'board', all);
}

/* The boards come in groups, the arcade's own sections, one group at a time:
   thirty-odd top tens on one page is a scroll nobody finishes. With a name
   that is on any board, "Yours" comes first and opens by default. */
function groups() {
  const sections = arr(G.catalog && G.catalog.sections);
  const order = sections.map((s) => s.id);
  const by = new Map();
  boardGames().forEach((g) => {
    const id = order.includes(g.section) ? g.section : '_';
    if (!by.has(id)) by.set(id, []);
    by.get(id).push(g);
  });
  const list = order.filter((id) => by.has(id)).map((id) => {
    const s = sections.find((x) => x.id === id);
    return { id, label: String(s.title || id), games: by.get(id) };
  });
  if (by.has('_')) list.push({ id: '_', label: 'More games', games: by.get('_') });
  const m = mine();
  if (m.hits.length) {
    const slugs = new Set(m.hits.map((h) => h.slug));
    list.unshift({ id: 'yours', label: 'Yours', games: boardGames().filter((g) => slugs.has(g.slug)) });
  }
  return list;
}

function drawBoards(host) {
  if (!G.settled.catalog) return;
  if (G.failed.catalog) { host.appendChild(el('p', 'note pad', esc('The game list didn’t load.'))); return; }
  if (!G.settled.boards) { host.appendChild(el('p', 'note pad', esc('Loading ' + plural(boardGames().length, 'board', 'boards') + '…'))); return; }
  if (G.failed.boards) { host.appendChild(el('p', 'note pad', esc('The scoreboard didn’t load.'))); return; }
  const list = groups();
  if (!list.length) return;
  if (!list.some((x) => x.id === G.group)) G.group = list[0].id;
  const pick = el('div', 'addrow');
  const row = el('div', 'linkrow');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Which boards');
  list.forEach((x) => {
    const p = el('button', 'pillbtn' + (x.id === G.group ? ' on' : ''), esc(x.label));
    p.setAttribute('aria-pressed', x.id === G.group ? 'true' : 'false');
    p.dataset.group = x.id;
    p.addEventListener('click', () => { G.group = x.id; drawBoardsSlot(); });
    row.appendChild(p);
  });
  pick.appendChild(row);
  host.appendChild(pick);
  const want = norm(readerName());
  const quiet = [];
  list.find((x) => x.id === G.group).games.forEach((g) => {
    const rows = G.boards[g.slug];
    if (rows === null) { quiet.push([g, 'didn’t load']); return; }
    if (!arr(rows).length) { quiet.push([g, '']); return; }
    /* one block per game: the game is the headline, its scores hang under it */
    const blk = el('div', 'gm-lb');
    blk.appendChild(gameRow(g, 'g:' + g.slug, esc(g.boardHint || '')));
    blk.appendChild(el('p', 'gm-lb-label', esc('Top scores · ' + g.name)));
    const top = arr(rows).slice(0, TOP);
    const myAt = top.findIndex((r) => isMe(r, want));
    const open = G.open[g.slug] || myAt >= SHOWN;
    const b = el('div', 'board');
    b.dataset.board = g.slug;
    top.slice(0, open ? TOP : SHOWN).forEach((r, i) => b.appendChild(boardRow(r, i + 1, want)));
    /* further down than the top ten: the arcade sends a hundred, so the reader's place is known */
    if (want && myAt < 0) {
      const at = arr(rows).findIndex((r) => isMe(r, want));
      if (at >= 0) b.appendChild(boardRow(rows[at], at + 1, want, 'Your best this month, outside the top ten'));
    }
    blk.appendChild(b);
    if (!open && top.length > SHOWN) {
      const more = button(top.length === TOP ? 'Show top ' + TOP : 'Show all ' + top.length, 'ghost more', () => { G.open[g.slug] = true; drawBoardsSlot(); });
      more.dataset.more = g.slug;
      blk.appendChild(more);
    }
    host.appendChild(blk);
  });
  if (quiet.length) {
    const p = el('p', 'note pad');
    p.innerHTML = esc('No scores yet: ') + quiet.map(([g, why]) => '<a href="' + esc(playUrl(g.slug)) + '" target="_blank" rel="noopener">' + esc(g.name) + '</a>' + (why ? ' (' + esc(why) + ')' : '')).join(', ') + '.';
    host.appendChild(el('div', 'spacer'));
    host.appendChild(p);
  }
}

/* ------------------------------------------------------------ challenge */
function drawChallenge(host) {
  if (!G.catalog) return false;
  sec(host, 'Challenge a neighbor', null, 'challenge');
  const list = roomGames();
  const card = el('div', 'textcard');
  card.dataset.challenge = '1';
  if (G.refused) {
    card.appendChild(el('p', 'fine', esc((G.refused.name || 'That game') + ' can’t host a room right now.')));
    card.lastChild.dataset.refused = G.refused.slug || '';
  }
  if (!list.length) {
    card.appendChild(el('p', '', esc('No room games right now.')));
    host.appendChild(card);
    return true;
  }
  if (!G.pick || !list.some((g) => g.slug === G.pick)) G.pick = list[0].slug;
  const g = list.find((x) => x.slug === G.pick);
  const row = el('div', 'row');
  list.forEach((x) => {
    const p = el('button', 'pillbtn' + (x.slug === G.pick ? ' on' : ''), esc(x.name));
    p.setAttribute('aria-pressed', x.slug === G.pick ? 'true' : 'false');
    p.dataset.pick = x.slug;
    p.addEventListener('click', () => { G.pick = x.slug; G.refused = null; drawChallengeSlot(); });
    row.appendChild(p);
  });
  card.appendChild(row);
  card.appendChild(el('p', '', esc(g.pitch || '')));
  const go = el('div', 'row');
  /* the same tab: the arcade is the same network, and the tab bar's #games link brings the reader back */
  const a = el('a', 'btn', 'Host a room in ' + esc(g.name) + ' ' + ICON.arrow);
  a.href = playUrl(g.slug);
  a.dataset.host = g.slug;
  go.appendChild(a);
  const words = 'Up for a game of ' + g.name + '? Host a room, or I will.';
  go.appendChild(inviteLink(ICON.mail + ' Invite by text', words, playUrl(g.slug), 'btn ghost', 'Invite by text: ' + g.name));
  go.appendChild(shareBtn(words, playUrl(g.slug), 'Share ' + g.name));
  card.appendChild(go);
  host.appendChild(card);
  return true;
}

/* ----------------------------------------------------------------- chat */
function drawChat(host) {
  sec(host, 'Arcade chat', null, 'chat');
  const card = el('div', 'textcard');
  card.dataset.chat = '1';
  const row = el('div', 'row');
  const ch = extLink('Talk ' + ICON.ext, CHAT_URL);
  ch.setAttribute('aria-label', 'Talk, in the Btown Arcade channel');
  ch.dataset.door = 'community';
  const tg = el('a', 'btn ghost', 'Telegram');
  tg.href = TELEGRAM_URL;
  tg.dataset.door = 'telegram';
  row.append(ch, tg);
  card.appendChild(row);
  host.appendChild(card);
  return true;
}

/* ------------------------------------------------------------ champions */
function drawChamps(host) {
  const C = G.champions;
  const boards = arr(C && C.games).filter((x) => x && SLUG.test(String(x.slug || '')) && x.champ);
  const royalty = onePerName(arr(C && C.royalty).filter((x) => x && x.name));
  if (!boards.length && !royalty.length) return false;
  const month = /^\d{4}-\d{2}$/.test(String(C.month || '')) ? C.month : monthKey();
  const young = month !== monthKey();
  const label = String(C.monthLabel || monthName(month));
  const stamp = Date.parse(C.updated);
  sec(host, 'Champions', esc(young ? label : stamp ? 'Updated ' + clock(stamp) : ''), 'champs', extLink('All boards ' + ICON.ext, BOARDS_PAGE, 'ghost sm'));
  const want = norm(readerName());
  if (royalty.length) {
    divider(host, 'The whole arcade');
    const b = el('div', 'board');
    b.dataset.royalty = '1';
    royalty.slice(0, 5).forEach((p, i) => {
      const bits = [p.crowns ? 'topped ' + plural(Number(p.crowns), 'board', 'boards') : '', Number(p.podiums) > Number(p.crowns) ? plural(Number(p.podiums), 'podium', 'podiums') : '',
        'on ' + plural(Number(p.boards) || 0, 'board', 'boards')].filter(Boolean).join(' · ');
      b.appendChild(boardRow({ name: p.name }, i + 1, want, bits.charAt(0).toUpperCase() + bits.slice(1), ''));
    });
    host.appendChild(b);
  }
  if (boards.length) {
    divider(host, 'Every board');
    const b = el('div', 'board');
    b.dataset.champs = '1';
    boards.forEach((x) => {
      const g = bySlug(x.slug) || { slug: x.slug, name: String(x.name || x.slug), emoji: x.emoji };
      const me = isMe({ name: x.champ }, want);
      const r = el('a', 'r' + (me ? ' me' : ''));
      r.href = playUrl(g.slug); r.target = '_blank'; r.rel = 'noopener';
      r.dataset.k = 'champ:' + x.slug;
      if (me) r.dataset.me = '1';
      r.innerHTML = '<span class="rank" aria-hidden="true">' + esc(g.emoji || x.emoji || '') + '</span>' + mark(String(x.champ), 'round lg') + '<div><div class="t">' + esc(x.champ) +
        '</div><div class="s">' + esc(g.name + (Number(x.players) ? ' · ' + plural(Number(x.players), 'player', 'players') : '')) + '</div></div><span class="sc">' + esc(num(x.score)) + '</span>';
      b.appendChild(r);
    });
    host.appendChild(b);
  }
  return true;
}

/* ---------------------------------------------------------------- invites */
/* An invite is a text message: an sms: link with the words and the link in
   its body and no number, so the reader picks who in Messages and nothing
   here reads or keeps a contact. On a screen without touch (a laptop, where
   sms: goes nowhere) the same words go to the share sheet, or are copied. */
const touch = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
const inviteText = (words, url) => line1(words, 220) + ' ' + url;
const smsHref = (words, url) => 'sms:?&body=' + encodeURIComponent(inviteText(words, url));
function copyText(s, said) {
  const done = () => app.toast(said), fail = () => app.toast('Couldn’t copy');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(done, fail);
  else fail();
}
function shareOut(words, url) {
  if (navigator.share) { navigator.share({ text: line1(words, 220), url }).catch(() => {}); return; }
  copyText(inviteText(words, url), 'Invite copied');
}
function inviteLink(label, words, url, cls, aria) {
  const a = el('a', cls || 'pillbtn', label);
  a.href = smsHref(words, url);
  a.dataset.invite = '1';
  if (aria) a.setAttribute('aria-label', aria);
  a.addEventListener('click', (e) => { if (touch()) return; e.preventDefault(); shareOut(words, url); });
  return a;
}
function shareBtn(words, url, aria) {
  const b = button(ICON.share, 'ghost gm-share', () => shareOut(words, url));
  b.setAttribute('aria-label', aria || 'Share');
  b.dataset.shareout = '1';
  return b;
}
/* this app's own link to a card, as app.share builds it */
const appUrl = (k) => (app.demo ? location.origin + location.pathname + '?demo=1' : 'https://guide.btownbrief.com/all-day/') + '#' + KEY + '/' + encodeURIComponent(k);

/* ------------------------------------------------------------- the arcade */
const champOf = (slug) => arr(G.champions && G.champions.games).find((x) => x && x.slug === slug && x.champ) || null;
const inArcade = () => live().filter((g) => g.slug !== QUIZ.slug);
function arcadeFilters() {
  const L = inArcade();
  const out = [{ key: 'all', label: 'All', n: L.length }];
  const fresh = newGames().filter((g) => g.slug !== QUIZ.slug).length;
  if (fresh) out.push({ key: 'new', label: 'New', n: fresh });
  arr(G.catalog && G.catalog.sections).forEach((s) => {
    const n = L.filter((g) => g.section === s.id).length;
    if (s && s.id && n) out.push({ key: s.id, label: String(s.title || s.id), n });
  });
  const outside = L.filter((g) => g.where === 'out').length;
  if (outside) out.push({ key: 'out', label: 'Out in Burlington', n: outside });
  return out;
}
/* All: what's new first, then the boards with the most players this month,
   then the catalog's own order */
function arcadeList(f) {
  const L = inArcade();
  const fresh = newGames().filter((g) => g.slug !== QUIZ.slug);
  if (f === 'new') return fresh;
  if (f === 'out') return L.filter((g) => g.where === 'out');
  if (f !== 'all') return L.filter((g) => g.section === f);
  const players = (g) => Number((champOf(g.slug) || {}).players) || 0;
  const rest = L.filter((g) => !fresh.includes(g)).map((g, i) => [g, i]).sort((a, b) => players(b[0]) - players(a[0]) || a[1] - b[1]).map((x) => x[0]);
  return fresh.concat(rest);
}

/* a cabinet's screen: a moment of play when there is one, else the emoji
   (also when the picture doesn't load: offline, or a deploy half done) */
function screen(slug, emoji, extra) {
  const emo = '<span class="gm-emo" aria-hidden="true">' + esc(emoji || '🕹️') + '</span>';
  const a = el('a', 'gm-scr' + (SHOTS.has(slug) ? ' shot' : ''), (SHOTS.has(slug)
    ? '<img src="assets/games/' + esc(slug) + '.webp" alt="" width="480" height="360" loading="lazy" decoding="async">' : emo) + (extra || ''));
  const img = a.querySelector('img');
  if (img) img.addEventListener('error', () => { a.classList.remove('shot'); img.insertAdjacentHTML('beforebegin', emo); img.remove(); }, { once: true });
  a.href = playUrl(slug); a.target = '_blank'; a.rel = 'noopener';
  a.style.setProperty('--mk', 'var(--mark-' + hue(slug) + ')');
  return a;
}

function cabinet(g, feat) {
  const c = el('article', 'gm-cab' + (feat ? ' feat' : ''));
  c.dataset.k = 'cab:' + g.slug;
  c.dataset.slug = g.slug;
  const fresh = newGames().includes(g);
  const ch = champOf(g.slug);
  const scr = screen(g.slug, g.emoji, fresh ? '<span class="tag gm-new">New</span>' : '');
  scr.setAttribute('aria-label', 'Play ' + g.name);
  const body = el('div', 'gm-cab-b', '<h3 class="gm-name">' + esc(g.name) + '</h3>' +
    (g.pitch ? '<p class="gm-pitch">' + esc(g.pitch) + '</p>' : '') +
    (ch ? '<p class="gm-champ">' + ICON.trophy + '<span><b>' + esc(ch.champ) + '</b> · ' + esc(num(ch.score)) + '</span></p>' : ''));
  const acts = el('div', 'gm-acts');
  const play = el('a', 'pillbtn on', 'Play');
  play.href = playUrl(g.slug); play.target = '_blank'; play.rel = 'noopener';
  play.setAttribute('aria-label', 'Play ' + g.name + ' on the arcade');
  acts.append(play, inviteLink('Invite', 'Play ' + g.name + ' with me?', playUrl(g.slug), 'pillbtn', 'Invite by text to ' + g.name));
  body.appendChild(acts);
  c.append(scr, body);
  return c;
}

/* The featured game: a card above the arcade. It keeps the cabinet's key, so
   an older #games/cab:news-quiz link lands on it. */
function drawQuiz(host) {
  const g = bySlug(QUIZ.slug);
  if (g && g.live !== true) return false;
  const ch = champOf(QUIZ.slug);
  const c = el('article', 'gm-quiz');
  c.dataset.sec = 'quiz';
  c.dataset.k = 'cab:' + QUIZ.slug;
  c.dataset.slug = QUIZ.slug;
  const scr = screen(QUIZ.slug, QUIZ.emoji);
  scr.setAttribute('aria-label', 'Take the ' + QUIZ.name);
  const body = el('div', 'gm-cab-b', '<h3 class="gm-name">' + esc(QUIZ.name) + '</h3><p class="gm-pitch">' + esc(QUIZ.pitch) + '</p>' +
    (ch ? '<p class="gm-champ">' + ICON.trophy + '<span><b>' + esc(ch.champ) + '</b> · ' + esc(num(ch.score)) + '</span></p>' : ''));
  const acts = el('div', 'gm-acts');
  const play = el('a', 'pillbtn on', 'Take the quiz');
  play.href = playUrl(QUIZ.slug); play.target = '_blank'; play.rel = 'noopener';
  play.setAttribute('aria-label', 'Take the ' + QUIZ.name + ' on the arcade');
  acts.append(play, inviteLink('Invite', 'Think you read this week’s Brief? Try the ' + QUIZ.name + '.', playUrl(QUIZ.slug), 'pillbtn', 'Invite by text to ' + QUIZ.name));
  body.appendChild(acts);
  c.append(scr, body);
  host.appendChild(c);
  return true;
}

function drawArcade(host) {
  if (!G.catalog) return false;
  const all = el('a', 'btn ghost sm', 'Open ' + ICON.ext);
  all.href = ARCADE; all.target = '_blank'; all.rel = 'noopener';
  all.setAttribute('aria-label', 'Open the arcade');
  sec(host, 'The arcade', null, 'arcade', all);
  const filters = arcadeFilters();
  if (!filters.some((f) => f.key === G.arc)) G.arc = 'all';
  const row = chips(filters, G.arc, (k) => { G.arc = k; G.arcOpen = false; drawArcadeSlot(); }, 'gm-filters');
  row.dataset.arcade = '1';
  host.appendChild(row);
  const list = arcadeList(G.arc);
  if (!list.length) { host.appendChild(el('p', 'note pad', esc('No games here yet.'))); return true; }
  let rest = list;
  if (G.arc === 'all') {
    const f = el('div', 'gm-feat');
    f.appendChild(cabinet(list[0], true));
    host.appendChild(f);
    rest = list.slice(1);
  }
  const grid = el('div', 'gm-grid');
  grid.dataset.grid = G.arc;
  (G.arcOpen ? rest : rest.slice(0, CABS)).forEach((g) => grid.appendChild(cabinet(g)));
  host.appendChild(grid);
  if (!G.arcOpen && rest.length > CABS) {
    const more = button('All ' + plural(list.length, 'game', 'games'), 'ghost more', () => { G.arcOpen = true; drawArcadeSlot(); });
    more.dataset.allgames = '1';
    host.appendChild(more);
  }
  return true;
}

/* ------------------------------------------------- the games board, read */
/* The demo's board copy (boards-fake.js) has two posts of each kind; the
   demo file adds a few more neighbors' posts through the fake's own calls,
   once a visit, so the poll has something to rank. */
let seeded = false;
function seedDemo() {
  const fake = app.demo && boards._fake ? boards._fake() : null;
  const list = arr(G.demo && G.demo.board);
  if (seeded || !fake || !list.length) return;
  seeded = true;
  const H = 3600000;
  list.forEach((p, i) => {
    try {
      const row = fake.as(p.who).call('nn_post_create', { p_board: BOARD, p_kind: p.kind, p_title: p.title, p_body: p.body || '', p_place: p.place || '', p_meta: p.meta || {} });
      const raw = fake.posts.find((x) => x.id === row.id);
      if (raw && p.ago) { raw.created_at -= p.ago * H; if (typeof raw.expires_at === 'number') raw.expires_at -= p.ago * H; }
      fake.as(null);
      for (let v = 0; v < (Number(p.votes) || 0); v++) fake.call('nn_vote', { p_post: row.id, p_player: 'demoseed-' + i + '-' + v });
    } catch (e) { /* a seed the rules refuse is left out */ }
  });
  fake.as(null);
}

function loadPosts() {
  const run = ++G.postRun;
  seedDemo();
  return Promise.all([
    boards.list(BOARD, { kind: 'playing', limit: RULES.limits.listMax }),
    boards.list(BOARD, { kind: 'lfg', limit: RULES.limits.listMax }),
    boards.roundFour(),
  ]).then(([pl, lf, four]) => {
    if (run !== G.postRun) return;
    G.four = four === true;
    G.posts = { playing: pl.ok ? pl.posts : null, lfg: lf.ok ? lf.posts : null };
    G.postErr = { playing: pl.ok ? '' : pl.error, lfg: lf.ok ? '' : lf.error };
    G.settled.posts = true;
    drawPostsSlots();
    land();
  });
}
const gameOf = (p) => line1((p.meta && p.meta.game) || p.title, 60);
const platOf = (p) => (p.meta && PLAT[p.meta.platform] ? p.meta.platform : '');
const sameText = (a, b) => norm(a) === norm(b);

/* ---------------------------------------------------- what people play */
function playItem(p) {
  const it = boards.item(p, { tab: KEY, meta: (x) => [gameOf(x), PLAT[platOf(x)] || ''].filter(Boolean).join(' · ') });
  app.know([it]);
  return it;
}
/* each row's bar counts the people on it (the poster and the "me too"s),
   drawn against the game with the most: a tie is a tie, at any count. It is
   redrawn whenever a vote moves. */
function paintBars(box) {
  if (!box) return;
  const rows = [...box.querySelectorAll('.gm-poll')];
  const people = rows.map((r) => 1 + ((app.item(r.dataset.k) || {}).votes || 0));
  const most = Math.max(1, ...people);
  rows.forEach((r, i) => r.style.setProperty('--w', Math.round((people[i] / most) * 100) + '%'));
}
function pollRow(p, it) {
  const r = el('div', 'gm-poll' + (it.voted ? ' on' : ''));
  r.dataset.k = it.k;
  r.dataset.post = p.id;
  const game = gameOf(p), pl = platOf(p);
  const note = sameText(p.title, game) ? '' : line1(p.title, 80);
  const who = [it.author, agoShort(it.created)].filter(Boolean).join(' · ');
  r.innerHTML = '<span class="gm-bar" aria-hidden="true"></span><div class="gm-pl"><div class="t">' + esc(game) +
    (pl ? ' <span class="tag gm-plat">' + esc(PLAT[pl]) + '</span>' : '') + '</div>' +
    '<div class="s">' + esc(who) + (note ? ' · ' + esc(note) : '') + '</div></div>';
  const me = el('button', 'gm-metoo' + (it.voted ? ' on' : ''), '<span>Me too</span><span class="n">' + esc(it.votes || '') + '</span>');
  me.type = 'button';
  me.dataset.metoo = p.id;
  me.setAttribute('aria-pressed', it.voted ? 'true' : 'false');
  me.setAttribute('aria-label', 'Me too: ' + game);
  r.appendChild(me);
  const mod = el('button', 'act ' + (it.mine ? 'del' : 'rep'), it.mine ? ICON.trash : ICON.flag);
  mod.dataset.act = it.mine ? 'bdelete' : 'breport';
  mod.setAttribute('aria-label', it.mine ? 'Delete your post' : 'Report');
  r.appendChild(mod);
  return r;
}
/* "Me too" is the board's vote; it repaints itself and the bar */
function metoo(id, btn) {
  const it = app.item('b-' + id);
  if (!it) return;
  const was = { votes: it.votes, voted: it.voted };
  const paint = () => {
    const row = btn.closest('.gm-poll');
    btn.classList.toggle('on', it.voted);
    btn.setAttribute('aria-pressed', it.voted ? 'true' : 'false');
    btn.querySelector('.n').textContent = it.votes || '';
    if (row) { row.classList.toggle('on', it.voted); paintBars(row.parentNode); }
  };
  it.voted = !it.voted;
  it.votes = Math.max(0, it.votes + (it.voted ? 1 : -1));
  paint();
  (it.voted ? boards.vote : boards.unvote)(id).then((r) => {
    if (r.ok) { it.votes = r.votes; it.voted = r.voted; paint(); return; }
    Object.assign(it, was);
    paint();
    app.toast(r.message);
  });
}

/* "I'm playing…": the game and the platform, one line */
function sayForm() {
  const f = el('form', 'gm-say');
  f.dataset.say = '1';
  f.noValidate = true;
  const game = el('input', 'field');
  game.type = 'text'; game.name = 'game'; game.maxLength = 60; game.placeholder = 'I’m playing…'; game.autocomplete = 'off';
  game.setAttribute('aria-label', 'The game you’re playing');
  const plat = el('select', 'field');
  plat.name = 'platform';
  plat.setAttribute('aria-label', 'Where you play it');
  [['', 'On…']].concat(PLATFORMS).forEach(([v, l]) => { const o = el('option', null, esc(l)); o.value = v; plat.appendChild(o); });
  if (G.sayPlat) plat.value = G.sayPlat;
  const go = el('button', 'btn', 'Post');
  go.type = 'submit';
  f.append(game, plat, go);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const g = line1(game.value, 60), p = plat.value;
    if (!g) { game.focus(); return; }
    if (!p) { plat.focus(); app.toast('Pick where you play it.'); return; }
    if (!app.user()) { app.toast('Sign in to post.'); app.openSettings(); return; }
    go.disabled = true;
    boards.create(BOARD, { kind: 'playing', title: g, meta: { game: g, platform: p } }).then((r) => {
      go.disabled = false;
      if (!r.ok) {
        app.toast(r.message);
        if (r.error === 'no_name') boards.profileSheet();
        return;
      }
      G.sayPlat = '';
      G.plat = 'all';
      G.pollOpen = true;      // a new post has no "me too" yet, so it ranks last: show the whole poll
      app.toast('Posted');
      loadPosts().then(() => app.flashHit(G.root, 'b-' + r.post.id));
    });
  });
  return f;
}

function drawPlaying(host) {
  sec(host, 'What people are playing', null, 'playing');
  if (!G.settled.posts) { host.appendChild(el('p', 'loading', 'One moment…')); return; }
  const posts = G.posts.playing;
  if (!posts) { host.appendChild(el('p', 'note pad', esc(G.postErr.playing === 'off' ? 'Coming soon.' : 'The board didn’t load.'))); return; }
  if (G.four) host.appendChild(sayForm());
  if (!posts.length) { host.appendChild(el('p', 'note pad', esc('Nobody’s posted yet.'))); return; }
  const by = new Map();
  posts.forEach((p) => { const k = platOf(p); if (k) by.set(k, (by.get(k) || 0) + 1); });
  if (G.plat !== 'all' && !by.has(G.plat)) G.plat = 'all';
  if (by.size > 1) {
    const list = [{ key: 'all', label: 'All', n: posts.length }].concat(PLATFORMS.filter(([k]) => by.has(k)).map(([k, l]) => ({ key: k, label: l, n: by.get(k) })));
    const row = chips(list, G.plat, (k) => { G.plat = k; G.pollOpen = false; drawPostsSlots(); }, 'gm-filters');
    row.dataset.plats = '1';
    host.appendChild(row);
  }
  const shown = posts.filter((p) => G.plat === 'all' || platOf(p) === G.plat)
    .map((p) => [p, playItem(p)])
    .sort((a, b) => b[1].votes - a[1].votes || b[1].created - a[1].created);
  const box = el('div', 'gm-polls');
  (G.pollOpen ? shown : shown.slice(0, POLL)).forEach(([p, it]) => box.appendChild(pollRow(p, it)));
  paintBars(box);
  host.appendChild(box);
  if (!G.pollOpen && shown.length > POLL) host.appendChild(button(plural(shown.length - POLL, 'more', 'more'), 'ghost more', () => { G.pollOpen = true; drawPostsSlots(); }));
}

/* ------------------------------------------------- looking for a group */
const lfgMeta = (p) => [gameOf(p), PLAT[platOf(p)] || '', line1(p.meta && p.meta.when, 60)].filter(Boolean).join(' · ');
function lfgCard(p) {
  const it = boards.item(p, { tab: KEY, meta: lfgMeta });
  app.know([it]);
  const n = cards.board(it);
  if (!n) return null;
  n.dataset.lfg = p.id;
  const b = n.querySelector('[data-act="bvote"]');
  if (b) {
    b.setAttribute('aria-label', 'I’m in');
    b.innerHTML = ICON.check + '<span>I’m in</span><span class="n">' + esc(it.votes || '') + '</span>';
  }
  const game = gameOf(p), when = line1(p.meta && p.meta.when, 60);
  const words = 'Want in? ' + game + (PLAT[platOf(p)] ? ' on ' + PLAT[platOf(p)] : '') + (when ? ', ' + when : '') + '.';
  const row = el('div', 'linkrow gm-inv');
  row.appendChild(inviteLink(ICON.mail + ' Invite by text', words, appUrl(it.k), 'btn ghost sm', 'Invite by text: ' + game));
  n.appendChild(row);
  return n;
}
function composeLfg() {
  boards.compose({
    board: BOARD, kind: 'lfg', heading: 'Find a group', title: 'What you need', titlePlaceholder: 'Need two for ranked',
    fields: [
      { key: 'game', label: 'Game', type: 'text', max: 60, placeholder: 'Valorant, Catan, D&D' },
      { key: 'platform', label: 'Platform', type: 'enum', options: PLATFORMS },
      { key: 'when', label: 'When', type: 'text', max: 60, placeholder: 'Thursdays, 7 pm' },
    ],
    place: 'Where', placePlaceholder: 'Online, or a place in town', body: 'More', cta: 'Post',
    onPosted() { loadPosts(); },
  });
}
function drawLfg(host) {
  const add = G.four ? button(ICON.plus + ' Find a group', 'ghost sm', composeLfg) : null;
  if (add) add.dataset.addlfg = '1';
  sec(host, 'Looking for a group', null, 'lfg', add);
  if (!G.settled.posts) return;
  const posts = G.posts.lfg;
  if (!posts) { host.appendChild(el('p', 'note pad', esc(G.postErr.lfg === 'off' ? 'Coming soon.' : 'The board didn’t load.'))); return; }
  if (!posts.length) { host.appendChild(el('p', 'note pad', esc('No open groups.'))); return; }
  const feed = el('div', 'feed');
  posts.forEach((p) => { const n = lfgCard(p); if (n) feed.appendChild(n); });
  host.appendChild(feed);
}

/* ------------------------------------------------------------ gamertags */
function loadTags() {
  const run = ++G.tagRun;
  if (!app.user()) { G.tags = { state: 'out', people: [] }; drawTagsSlot(); return Promise.resolve(); }
  G.tags = { state: 'loading', people: [] };
  drawTagsSlot();
  return boards.handlesRecent(GAMER, 40).then((r) => {
    if (run !== G.tagRun) return;
    G.tags = r.ok ? { state: 'ok', people: r.people } : { state: r.error === 'off' ? 'off' : 'err', people: [], msg: r.message };
    drawTagsSlot();
  });
}
/* the profile sheet, opened at its Games fold; the list reloads when it closes */
function openHandles() {
  if (!app.user()) { app.openSettings(); return; }
  boards.profileSheet();
  const t0 = Date.now();
  const look = () => {
    const d = [...document.querySelectorAll('#sheet [data-handles] details')].find((x) => /Games/.test((x.querySelector('summary') || {}).textContent || ''));
    if (d) {
      d.open = true;
      d.scrollIntoView({ block: 'center' });
      const i = d.querySelector('input');
      if (i) i.focus({ preventScroll: true });
      const s = document.getElementById('sheet');
      if (s && 'MutationObserver' in window) {
        const mo = new MutationObserver(() => { if (s.hidden || !s.contains(d)) { mo.disconnect(); loadTags(); } });
        mo.observe(s, { attributes: true, childList: true });
      }
      return;
    }
    if (Date.now() - t0 < 6000) setTimeout(look, 60);
  };
  look();
}
const tagValue = (v) => (typeof v === 'string' ? line1(v, RULES.limits.handleMax) : '');
function tagRow(p) {
  const kinds = GAMER.filter((k) => tagValue(p.handles && p.handles[k]));
  if (!kinds.length) return null;
  const name = line1(p.display_name, 32) || 'A neighbor';
  const r = el('div', 'gm-tag' + (p.me ? ' me' : ''));
  if (p.me) r.dataset.me = '1';
  const hood = NEIGHBORHOOD_LABELS[p.neighborhood] || '';
  r.innerHTML = mark(name, 'round lg') + '<div class="gm-tag-b"><div class="t">' + esc(name) + (p.me ? ' <span class="tag tag-own">You</span>' : '') +
    (hood ? '<span class="s"> · ' + esc(hood) + '</span>' : '') + '</div><div class="gm-hs"></div></div>';
  const hs = r.querySelector('.gm-hs');
  kinds.forEach((k) => {
    const v = tagValue(p.handles[k]);
    const b = el('button', 'gm-h', '<span>' + esc(HANDLE_LABELS[k] || k) + '</span><b>' + esc(v) + '</b>');
    b.type = 'button';
    b.dataset.kind = k;
    b.setAttribute('aria-label', 'Copy ' + (HANDLE_LABELS[k] || k) + ' ' + v);
    b.addEventListener('click', () => copyText(v, 'Copied ' + v));
    hs.appendChild(b);
  });
  return r;
}
function drawTags(host) {
  const T = G.tags;
  const add = T.state === 'out' ? null : button(ICON.plus + ' Add your gamertag', 'ghost sm', openHandles);
  if (add) add.dataset.addtag = '1';
  sec(host, 'Gamertags', null, 'tags', add);
  if (T.state === 'out') {
    const r = el('div', 'gm-signin');
    r.dataset.tags = 'out';
    r.appendChild(el('p', null, esc('Sign in to see neighbors’ gamertags.')));
    r.appendChild(button('Sign in', 'sm', () => app.openSettings()));
    host.appendChild(r);
    return;
  }
  if (T.state === 'loading') { host.appendChild(el('p', 'loading', 'One moment…')); return; }
  if (T.state !== 'ok') { host.appendChild(el('p', 'note pad', esc(T.state === 'off' ? 'Coming soon.' : T.msg || 'They didn’t load.'))); return; }
  const rows = T.people.map(tagRow).filter(Boolean);
  if (!rows.length) { host.appendChild(el('p', 'note pad', esc('No gamertags yet.'))); return; }
  const box = el('div', 'gm-tags');
  box.dataset.tags = 'ok';
  (G.tagsOpen ? rows : rows.slice(0, TAGS)).forEach((r) => box.appendChild(r));
  host.appendChild(box);
  if (!G.tagsOpen && rows.length > TAGS) host.appendChild(button(plural(rows.length - TAGS, 'more', 'more'), 'ghost more', () => { G.tagsOpen = true; drawTagsSlot(); }));
}

/* ------------------------------------------------------------ VR corner */
function vrRow(v) {
  const r = el('div', 'lrow gm-vr');
  r.dataset.k = v.k;
  r.innerHTML = '<span class="th bare" aria-hidden="true">' + esc(v.emoji) + '</span><div><div class="t">' + esc(v.name) + '</div><div class="s">' + esc(v.what) + '</div></div>';
  const a = el('a', 'pillbtn', 'Store ' + ICON.ext);
  a.href = safeHref(v.url); a.target = '_blank'; a.rel = 'noopener';
  a.setAttribute('aria-label', v.name + ' on the Meta store');
  r.appendChild(a);
  return r;
}
function drawVr(host) {
  sec(host, 'VR corner', null, 'vr');
  VR.forEach((v) => host.appendChild(vrRow(v)));
  const inVr = arr(G.posts && G.posts.playing).filter((p) => platOf(p) === 'vr').length;
  const row = el('div', 'linkrow gm-vr-go');
  if (inVr) {
    const b = button(esc(plural(inVr, 'VR game', 'VR games') + ' in the poll'), 'ghost sm', () => { G.plat = 'vr'; drawPostsSlots(); app.jumpTo(G.root.querySelector('[data-sec="playing"]')); });
    b.dataset.invr = String(inVr);
    row.appendChild(b);
  }
  if (G.four) {
    const b = button(ICON.plus + ' I’m playing in VR', 'ghost sm', () => {
      G.sayPlat = 'vr';
      drawPostsSlots();
      const f = G.root.querySelector('[data-say] input');
      app.jumpTo(G.root.querySelector('[data-sec="playing"]'));
      if (f) f.focus({ preventScroll: true });
    });
    b.dataset.sayvr = '1';
    row.appendChild(b);
  }
  if (row.children.length) host.appendChild(row);
}

/* ---------------------------------------------------------------- render */
function drawYouSlot() { if (G.slots) { G.slots.you.innerHTML = ''; if (G.catalog && boardGames().length) drawYou(G.slots.you); } }
function drawBoardsSlot() { if (G.slots) { G.slots.boards.innerHTML = ''; drawBoards(G.slots.boards); } }
function drawChallengeSlot() { if (G.slots) { G.slots.challenge.innerHTML = ''; G.slots.challenge.hidden = !drawChallenge(G.slots.challenge); } }
function drawQuizSlot() { if (G.slots) { G.slots.quiz.innerHTML = ''; G.slots.quiz.hidden = !drawQuiz(G.slots.quiz); } }
function drawArcadeSlot() { if (G.slots) { G.slots.arcade.innerHTML = ''; G.slots.arcade.hidden = !drawArcade(G.slots.arcade); } }
function drawTagsSlot() { if (G.slots) { G.slots.tags.innerHTML = ''; drawTags(G.slots.tags); } }
/* the board's three sections, redrawn only when the board changes, so a
   catalog or a leaderboard arriving never wipes a half-typed "I'm playing" */
function drawPostsSlots() {
  if (!G.slots) return;
  const S = G.slots;
  ['playing', 'lfg', 'vr'].forEach((k) => { S[k].innerHTML = ''; });
  drawPlaying(S.playing);
  drawLfg(S.lfg);
  drawVr(S.vr);
  if (app.activeTab() === KEY) app.paintSubnav();
}

const ORDER = ['quiz', 'arcade', 'playing', 'lfg', 'tags', 'vr', 'challenge', 'head', 'you', 'boards', 'champs', 'chat'];
function render() {
  const root = G.root;
  if (!root) return;
  if (!PARTS.some((k) => G.settled[k])) { root.innerHTML = '<p class="loading">Warming up the cabinets…</p>'; return; }
  if (G.settled.catalog && G.failed.catalog && G.settled.champions && G.failed.champions) {
    G.slots = null;
    root.innerHTML = '<div class="errbox"><b>Couldn’t reach the arcade.</b></div>';
    return;
  }
  if (!G.slots) {
    /* made once, so a board arriving never redraws the name you are typing */
    root.innerHTML = '';
    G.slots = {};
    ORDER.forEach((name) => { const s = el('div'); s.dataset.slot = name; root.appendChild(s); G.slots[name] = s; });
    /* the board's posts answer the shell's buttons (I'm in, report, share) */
    app.bindFeed(G.slots.playing);
    app.bindFeed(G.slots.lfg);
    G.slots.playing.addEventListener('click', (e) => {
      const b = e.target.closest('[data-metoo]');
      if (b) { e.preventDefault(); metoo(b.dataset.metoo, b); }
    });
    drawYouSlot();
    drawPostsSlots();
    drawTagsSlot();
  }
  const S = G.slots;
  ['head', 'boards', 'challenge', 'chat', 'champs'].forEach((k) => { S[k].innerHTML = ''; });
  drawQuizSlot();
  drawArcadeSlot();
  if (!S.you.firstChild || S.you.firstChild.dataset.you !== 'ask') drawYouSlot();
  S.head.hidden = !(G.catalog && boardGames().length) && !G.failed.catalog;
  if (!S.head.hidden) drawBoardHead(S.head);
  drawBoards(S.boards);
  S.challenge.hidden = !drawChallenge(S.challenge);
  drawChat(S.chat);
  S.champs.hidden = !drawChamps(S.champs);
  if (app.activeTab() === KEY) app.paintSubnav();
  land();
}

/* -------------------------------------------------------------- deep links */
/* #games/arcade|playing|lfg|tags|vr|challenge|board|champs|chat jumps to a
   section; #games/new and #games/party open the arcade on those games;
   #games/challenge:<slug> picks that game, or says it cannot host; any
   other key flashes its row once everything that might hold it is in. A
   cabinet is cab:<slug>, and the old new:<slug> and party:<slug> links
   land on it. */
const SECTIONS = ['quiz', 'arcade', 'playing', 'lfg', 'tags', 'vr', 'challenge', 'board', 'champs', 'chat'];
/* what a key has to wait for before it can be found, or called gone */
function needs(k) {
  if (k === 'board' || /^g:/.test(k)) return ['catalog', 'boards'];
  if (k === 'champs' || /^champ:/.test(k)) return ['catalog', 'champions'];
  if (k === 'playing' || k === 'lfg' || /^b-/.test(k)) return ['catalog', 'posts'];
  if (SECTIONS.includes(k) || k === 'new' || k === 'party' || /^(challenge|new|party|cab|vr):/.test(k)) return ['catalog'];
  return PARTS.concat('posts');
}
function land() {
  const k = G.pending;
  if (!k || !G.root || !G.slots || !needs(k).every((p) => G.settled[p])) return;
  G.pending = null;
  const jump = (key) => requestAnimationFrame(() => app.jumpTo(G.root.querySelector('[data-sec="' + key + '"]')));
  const m = /^challenge:([a-z0-9-]{1,40})$/.exec(k);
  if (m) {
    const g = roomGames().find((x) => x.slug === m[1]);
    if (g) { G.pick = g.slug; G.refused = null; } else { G.refused = { slug: m[1], name: (bySlug(m[1]) || {}).name || '' }; app.toast('That game can’t host a room right now.'); }
    drawChallengeSlot();
    jump('challenge');
    return;
  }
  if (k === 'new' || k === 'party') {
    const want = k === 'new' ? 'new' : 'party-night';
    if (arcadeFilters().some((f) => f.key === want)) { G.arc = want; G.arcOpen = false; }
    else app.toast(k === 'new' ? 'Nothing new this month.' : 'No party games right now.');
    drawArcadeSlot();
    jump('arcade');
    return;
  }
  if (SECTIONS.includes(k)) { jump(k); return; }
  const cab = /^(?:cab|new|party):([a-z0-9-]{1,40})$/.exec(k);
  if (cab) {
    G.arc = 'all';
    G.arcOpen = true;
    drawArcadeSlot();
    if (!app.flashHit(G.root, 'cab:' + cab[1])) app.toast('That game has moved on. Here’s the arcade now.');
    return;
  }
  const slug = /^g:([a-z0-9-]+)$/.exec(k);
  if (slug) {
    const g = bySlug(slug[1]);
    const home = g && groups().find((x) => x.id !== 'yours' && x.games.includes(g));
    if (home) G.group = home.id;
    G.open[slug[1]] = true;
    drawBoardsSlot();
  }
  if (/^b-/.test(k)) {
    /* a playing post past the first few, or under another platform, is drawn first */
    G.plat = 'all';
    G.pollOpen = true;
    drawPostsSlots();
  }
  if (!app.flashHit(G.root, k)) app.toast('That one has moved on. Here’s the arcade now.');
}

/* ----------------------------------------------------------------- the tab */
function mount(root) {
  G.root = root;
  render();
  if (app.demo) {
    loadDemo().then(() => { render(); loadPosts(); }, () => { G.root.innerHTML = '<div class="errbox"><b>The demo didn’t load.</b></div>'; });
  } else {
    loadLive();
    loadPosts();
  }
  loadTags();
  /* signing in or out changes what the board says is yours, and the gamertags */
  app.onAuth(() => { if (!G.root) return; loadPosts(); loadTags(); });
  window.addEventListener('allday-boards', (e) => {
    const d = e.detail || {};
    if (d.board === BOARD || d.what === 'hidden' || d.what === 'delete' || d.what === 'deleteme') loadPosts();
  });
}

/* Games that went live after the reader's last look. A game is dated by day,
   so one that arrived the same day as the visit is not counted: the dot
   never claims something the reader may already have seen. */
function newSince(ts) {
  if (!G.catalog) return 0;
  const seen = etDay(ts * 1000);
  return newGames().filter((g) => since(g) > seen).length;
}

/* a tab left open across midnight on the 1st reads the new month's boards */
function rollover() {
  if (app.demo || !G.settled.boards || G.boardMonth === monthKey()) return;
  G.boards = Object.create(null);
  G.settled.boards = false;
  delete G.failed.boards;
  render();
  loadBoards();
}

app.register(KEY, {
  label: 'Games',
  icon: ICON.games,
  promise: 'The arcade, what people are playing, groups to join, and gamertags.',
  mount,
  activate(param) { rollover(); G.pending = param || null; land(); },
  refresh() { if (G.root) render(); },
  deactivate() {},
  subnav() {
    if (!G.root || !G.slots) return null;
    const toc = [['arcade', 'Arcade'], ['playing', 'Playing'], ['lfg', 'Groups'], ['tags', 'Gamertags'], ['vr', 'VR'], ['challenge', 'Challenge'], ['board', 'Leaderboard'], ['champs', 'Champions']]
      .filter(([key]) => G.root.querySelector('[data-sec="' + key + '"]'))
      .map(([key, label]) => ({ key, label }));
    return toc.length ? chips(toc, null, (k) => app.jumpTo(G.root.querySelector('[data-sec="' + k + '"]'))) : null;
  },
  newSince,
});
