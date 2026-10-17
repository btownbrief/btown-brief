/* Games: the Btown arcade (play.btownbrief.com) from inside All Day. Top to
   bottom:

   - This month's leaderboard: the top ten in every live game that keeps a
     board, from the same read-only get_leaderboard RPC the arcade's own
     /leaderboards/ page calls, grouped by the arcade's sections. The arcade
     knows a player by a device id on play.btownbrief.com, which this app
     (another origin) cannot read, so the tab asks once for the name the
     reader plays under, keeps it on this device, and marks the rows with
     that name. Names are not unique; when two players share one, it says so.
     No name, no highlight, and no guessing.
   - Challenge a neighbor: the games on the Hangout's challenge allowlist
     (church-street-hangout/js/challenge.js), kept by the catalog only while
     each still opens a room from ?join=CODE. A room's seat is tied to a
     device token in play.btownbrief.com's own storage, so a room made from
     here would seat this app instead of the reader. The tab sends the reader
     to the game's own Host flow, which makes the room on the arcade and hands
     back the join link to text.
   - New this month: games that went live in the last 30 days.
   - Party night: the arcade's party-night section, in its own words.
   - Arcade chat: a door to the community's Btown Arcade channel and to
     Telegram. The talk lives there; nothing is built here.
   - Champions: champions.json (the arcade's champions workflow, every six
     hours): the reigning champ on each board and the all-arcade leaders.

   The catalog is data/games-catalog.json (scripts/build_games.py, daily):
   the arcade's games.json plus the day each game went live.

   ?demo=1 runs exactly this file on data/demo/games.json, which holds the
   catalog, the boards and champions.json in their real shapes, re-dated to
   the reader's clock. Nothing in the demo calls Supabase. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import { el, esc, safeHref, ICON, mark, section, chips, button, divider } from '../ui.js';

const KEY = 'games';
const ARCADE = 'https://play.btownbrief.com/';
const BOARDS_PAGE = ARCADE + 'leaderboards/';
const CATALOG_URL = '../data/games-catalog.json';
const CHAT_URL = 'https://www.btownbrief.com/community/channels/photo-wall';   // the Btown Arcade channel; the slug is historical
const TELEGRAM_URL = '../telegram.html';
const NAME_KEY = 'allday-arcade-name';
const TOP = 10;           // the arcade's own board is a top ten
const SHOWN = 3;          // drawn before "the rest of the top ten"
const NEW_DAYS = 30;
const PARALLEL = 6;       // board requests in flight at once
const BOARD_MS = 8000;    // a board that has not answered by then is counted as not loaded
const SLUG = /^[a-z0-9-]{1,40}$/;

const arr = (v) => (Array.isArray(v) ? v : []);
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const num = (n) => Number(n || 0).toLocaleString('en-US');
const playUrl = (slug) => (SLUG.test(slug) ? ARCADE + slug + '/' : ARCADE);
const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const ORD = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

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
    Object.entries(d.boards || {}).forEach(([slug, rows]) => { G.boards[slug] = arr(rows); });
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
      .then((rows) => { if (run === G.run) G.boards[g.slug] = Array.isArray(rows) ? rows : null; })
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
  const a = el('a', 'pillbtn', 'Play ' + ICON.ext);
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
    host.appendChild(gameRow(g, 'g:' + g.slug, esc(g.boardHint || '')));
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
    host.appendChild(b);
    if (!open && top.length > SHOWN) {
      const more = button('The rest of the top ten · ' + (top.length - SHOWN) + ' more', 'ghost more', () => { G.open[g.slug] = true; drawBoardsSlot(); });
      more.dataset.more = g.slug;
      host.appendChild(more);
    }
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
  card.appendChild(go);
  host.appendChild(card);
  return true;
}

/* --------------------------------------------------------- new and party */
function drawNew(host) {
  if (!G.catalog) return false;
  sec(host, 'New this month', null, 'new');
  const list = newGames();
  if (!list.length) { host.appendChild(el('p', 'note pad', esc('Nothing new this month.'))); return true; }
  list.forEach((g) => {
    const ago = daysBetween(since(g), todayKey());
    const when = ago === 0 ? 'Added today' : ago === 1 ? 'Added yesterday' : 'Added ' + dayName(since(g));
    host.appendChild(gameRow(g, 'new:' + g.slug, esc(when + ' · ' + (g.pitch || ''))));
  });
  return true;
}

function drawParty(host) {
  if (!G.catalog) return false;
  const list = live().filter((g) => g.section === 'party-night');
  if (!list.length) return false;
  sec(host, 'Party night', null, 'party');
  list.forEach((g) => host.appendChild(gameRow(g, 'party:' + g.slug, esc(g.pitch || ''))));
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
  const royalty = arr(C && C.royalty).filter((x) => x && x.name);
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

/* ---------------------------------------------------------------- render */
function drawYouSlot() { if (G.slots) { G.slots.you.innerHTML = ''; if (G.catalog && boardGames().length) drawYou(G.slots.you); } }
function drawBoardsSlot() { if (G.slots) { G.slots.boards.innerHTML = ''; drawBoards(G.slots.boards); } }
function drawChallengeSlot() { if (G.slots) { G.slots.challenge.innerHTML = ''; G.slots.challenge.hidden = !drawChallenge(G.slots.challenge); } }

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
    const mk = (name) => { const s = el('div'); s.dataset.slot = name; root.appendChild(s); return s; };
    G.slots = { head: mk('head'), you: mk('you'), boards: mk('boards'), challenge: mk('challenge'), new: mk('new'), party: mk('party'), chat: mk('chat'), champs: mk('champs') };
    drawYouSlot();
  }
  const S = G.slots;
  ['head', 'boards', 'challenge', 'new', 'party', 'chat', 'champs'].forEach((k) => { S[k].innerHTML = ''; });
  if (!S.you.firstChild || S.you.firstChild.dataset.you !== 'ask') drawYouSlot();
  S.head.hidden = !(G.catalog && boardGames().length) && !G.failed.catalog;
  if (!S.head.hidden) drawBoardHead(S.head);
  drawBoards(S.boards);
  S.challenge.hidden = !drawChallenge(S.challenge);
  S.new.hidden = !drawNew(S.new);
  S.party.hidden = !drawParty(S.party);
  drawChat(S.chat);
  S.champs.hidden = !drawChamps(S.champs);
  if (app.activeTab() === KEY) app.paintSubnav();
  land();
}

/* -------------------------------------------------------------- deep links */
/* #games/board|challenge|new|party|chat|champs jumps to a section;
   #games/challenge:<slug> picks that game, or says it cannot host; any
   other key flashes its row once everything that might hold it is in. */
const SECTIONS = ['board', 'challenge', 'new', 'party', 'chat', 'champs'];
/* what a key has to wait for before it can be found, or called gone */
function needs(k) {
  if (k === 'board' || /^g:/.test(k)) return ['catalog', 'boards'];
  if (k === 'champs' || /^champ:/.test(k)) return ['catalog', 'champions'];
  if (SECTIONS.includes(k) || /^(challenge|new|party):/.test(k)) return ['catalog'];
  return PARTS;
}
function land() {
  const k = G.pending;
  if (!k || !G.root || !G.slots || !needs(k).every((p) => G.settled[p])) return;
  G.pending = null;
  const m = /^challenge:([a-z0-9-]{1,40})$/.exec(k);
  if (m) {
    const g = roomGames().find((x) => x.slug === m[1]);
    if (g) { G.pick = g.slug; G.refused = null; } else { G.refused = { slug: m[1], name: (bySlug(m[1]) || {}).name || '' }; app.toast('That game can’t host a room right now.'); }
    drawChallengeSlot();
    requestAnimationFrame(() => app.jumpTo(G.root.querySelector('[data-sec="challenge"]')));
    return;
  }
  if (SECTIONS.includes(k)) { requestAnimationFrame(() => app.jumpTo(G.root.querySelector('[data-sec="' + k + '"]'))); return; }
  const slug = /^g:([a-z0-9-]+)$/.exec(k);
  if (slug) {
    const g = bySlug(slug[1]);
    const home = g && groups().find((x) => x.id !== 'yours' && x.games.includes(g));
    if (home) G.group = home.id;
    G.open[slug[1]] = true;
    drawBoardsSlot();
  }
  if (!app.flashHit(G.root, k)) app.toast('That one has moved on. Here’s the arcade now.');
}

/* ----------------------------------------------------------------- the tab */
function mount(root) {
  G.root = root;
  render();
  if (app.demo) loadDemo().then(render, () => { G.root.innerHTML = '<div class="errbox"><b>The demo didn’t load.</b></div>'; });
  else loadLive();
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
  promise: 'The arcade’s leaderboard, challenges to send a neighbor, and new games every month.',
  mount,
  activate(param) { rollover(); G.pending = param || null; land(); },
  refresh() { if (G.root) render(); },
  deactivate() {},
  subnav() {
    if (!G.root || !G.slots) return null;
    const toc = [['board', 'This month'], ['challenge', 'Challenge'], ['new', 'New'], ['party', 'Party night'], ['champs', 'Champions']]
      .filter(([key]) => G.root.querySelector('[data-sec="' + key + '"]'))
      .map(([key, label]) => ({ key, label }));
    return toc.length ? chips(toc, null, (k) => app.jumpTo(G.root.querySelector('[data-sec="' + k + '"]'))) : null;
  },
  newSince,
});
