/* everything.js — The Paper's Everything (wave 1, 2026-10-29):
   every project on one page, the hub's A to Z in the app.

     Apps        the eight apps, up top
     Pages       every guide page, on the hub's shelves (Right now,
                 Evening, Go and do...), and any page in data/catalog.json
                 the shelves don't have yet, so a new launch shows up
     Games       every game in play.btownbrief.com/games.json, by its
                 section (the hub's game shelves if that doesn't answer)
     A to Z      all of it, by letter
     Start here  the hub's Start here: the ones that are new every day

   A search box above it all finds a page or game by its name, its line or
   the hub's keywords, as the hub's A to Z does. */

import * as app from '../app.js';
import { el, esc, ICON } from '../ui.js';
import { sectionBar } from '../sections.js';
import * as P from './paper-core.js';

const KEY = 'everything';
const SECS = [['apps', 'Apps'], ['pages', 'Pages'], ['games', 'Games'], ['az', 'A to Z'], ['start', 'Start here']];
const GAME_SHELVES = new Set(['daily', 'arcade', 'board']);
const S = { root: null, slots: {}, data: null, q: '', pending: null, ready: false };
const norm = (u) => String(u || '').replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/$/, '').replace(/\/index\.html$/, '').toLowerCase();

function rows(host, list, prefix, o = {}) {
  /* one key per link, wherever it shows: a star saved on one row lights them all */
  const items = list.map((p) => P.item(KEY, norm(p.href), { title: p.title, line: p.line || '', href: p.href, emoji: p.emoji || null }));
  app.know(items);
  const box = el('div', 'pp-list');
  items.forEach((it) => { const n = P.row(it, o); if (n) box.appendChild(n); });
  host.appendChild(box);
  return box;
}

/* everything, once: the hub's shelves, then what the catalog and the
   arcade have that the shelves don't */
function build(shelvesJ, catalog, games) {
  /* each list is whole on its own (a party game is on the hub's At the
     table shelf and in Games too); the A to Z has everything once */
  const adder = () => { const seen = new Set(); return (list, it) => { const k = norm(it.href); if (!it.title || !it.href || seen.has(k)) return; seen.add(k); list.push(it); }; };
  const shelves = ((shelvesJ && shelvesJ.shelves) || []).filter((s) => s && Array.isArray(s.items));
  const pages = [], gameShelves = [];
  const addPage = adder(), addGame = adder();
  shelves.filter((s) => !GAME_SHELVES.has(s.key)).forEach((s) => { const sh = { key: s.key, label: s.label, items: [] }; s.items.forEach((i) => addPage(sh.items, i)); if (sh.items.length) pages.push(sh); });
  const more = { key: 'more', label: 'More pages', items: [] };
  ((catalog && catalog.groups) || []).forEach((g) => (g.cards || []).forEach((c) => addPage(more.items, { title: c.title, line: c.blurb || '', href: c.href, emoji: c.emoji || null })));
  if (more.items.length) pages.push(more);
  const gj = games && Array.isArray(games.games) ? games : null;
  if (gj) {
    (gj.sections || []).forEach((sec) => {
      const sh = { key: sec.id, label: sec.title, items: [] };
      gj.games.filter((g) => g && g.section === sec.id && g.live !== false && g.slug).forEach((g) => addGame(sh.items, { title: g.name, line: g.pitch || '', href: 'https://play.btownbrief.com/' + g.slug + '/', emoji: g.emoji || null }));
      if (sh.items.length) gameShelves.push(sh);
    });
  }
  /* the hub's own game shelves: all of them if the arcade didn't answer, else what it left out */
  const extra = { key: 'moregames', label: 'More games', items: [] };
  shelves.filter((s) => GAME_SHELVES.has(s.key)).forEach((s) => {
    if (!gj) { const sh = { key: s.key, label: s.label, items: [] }; s.items.forEach((i) => addGame(sh.items, i)); if (sh.items.length) gameShelves.push(sh); } else s.items.forEach((i) => addGame(extra.items, i));
  });
  if (extra.items.length) gameShelves.push(extra);
  const all = [], addAll = adder();
  [...pages, ...gameShelves].forEach((s) => s.items.forEach((i) => addAll(all, i)));
  const byHref = Object.create(null);
  all.forEach((i) => { byHref[norm(i.href)] = i; });
  const start = ((shelvesJ && shelvesJ.start) || []).map((h) => byHref[norm(h)]).filter(Boolean);
  return { pages, games: gameShelves, all, start, gamesLive: !!gj };
}

function drawShelves(box, shelves, prefix) {
  shelves.forEach((s) => {
    const sh = el('div', 'pp-shelf');
    sh.appendChild(el('h3', '', esc(s.label)));
    rows(sh, s.items, prefix + '-' + s.key, { cls: 'tight' });
    box.appendChild(sh);
  });
}

function drawAZ(box) {
  const bare = (t) => t.replace(/^(the|a)\s+/i, '');
  const sorted = S.data.all.slice().sort((a, b) => bare(a.title).localeCompare(bare(b.title), 'en', { sensitivity: 'base' }));
  const letters = new Map();
  sorted.forEach((it) => {
    const L = (bare(it.title).match(/[a-z]/i) || ['#'])[0].toUpperCase();
    if (!letters.has(L)) letters.set(L, []);
    letters.get(L).push(it);
  });
  letters.forEach((list, L) => {
    box.appendChild(el('div', 'pp-tl-year', esc(L)));
    rows(box, list, 'x', { cls: 'tight' });
  });
}

function drawSearch(page) {
  const form = el('form', 'pp-search pp-find');
  form.setAttribute('role', 'search');
  const input = el('input', 'field');
  input.type = 'search';
  input.placeholder = 'Find a page or a game';
  input.setAttribute('aria-label', 'Find a page or a game');
  input.value = S.q;
  form.appendChild(input);
  const out = el('div', 'pp-results');
  const paint = () => {
    out.innerHTML = '';
    const q = S.q.trim().toLowerCase();
    if (q.length < 2) return;
    const words = q.split(/\s+/).filter(Boolean);
    const hay = (i) => (i.title + ' ' + (i.line || '') + ' ' + (i.kw || '')).toLowerCase();
    const hits = S.data.all.filter((i) => words.every((w) => hay(i).includes(w)))
      .sort((a, b) => (b.title.toLowerCase().includes(q) ? 1 : 0) - (a.title.toLowerCase().includes(q) ? 1 : 0));
    if (!hits.length) out.appendChild(el('p', 'pp-count', esc('No matches.')));
    rows(out, hits.slice(0, 30), 'find', { cls: 'tight' });
  };
  let t = 0;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { S.q = input.value; paint(); }, 100); });
  form.addEventListener('submit', (e) => { e.preventDefault(); S.q = input.value; paint(); input.blur(); });
  page.append(form, out);
  paint();
}

function draw() {
  const root = S.root;
  root.innerHTML = '';
  S.slots = {};
  const page = P.bind(el('div', 'pp'));
  page.appendChild(el('div', 'pp-gap'));
  drawSearch(page);

  const apps = P.block(page, 'apps', 'Apps');
  P.appCards(apps, KEY);
  S.slots.apps = apps;

  const pages = P.block(page, 'pages', 'Pages');
  drawShelves(pages, S.data.pages, 'p');
  S.slots.pages = pages;

  const games = P.block(page, 'games', 'Games');
  if (S.data.games.length) drawShelves(games, S.data.games, 'g'); else P.noteLine(games, 'Couldn’t load the games.');
  S.slots.games = games;

  const az = P.block(page, 'az', 'A to Z');
  drawAZ(az);
  S.slots.az = az;

  const start = P.block(page, 'start', 'Start here');
  if (S.data.start.length) rows(start, S.data.start, 'start'); else P.noteLine(start, 'Couldn’t load these.');
  S.slots.start = start;

  root.appendChild(page);
  root.appendChild(el('div', 'spacer'));
  if (app.activeTab() === KEY) app.paintSubnav();
}

let loading = null;
function load() {
  if (!loading) loading = Promise.all([P.load('shelves'), P.load('catalog'), P.load('games')]).then(([sh, cat, games]) => {
    S.data = build(sh, cat, games);
    S.ready = true;
    app.recount();
  });
  return loading;
}

function land() {
  const want = S.pending;
  if (!want || !S.ready || !S.root || !S.root.firstChild) return;
  S.pending = null;
  if (S.slots[want]) { app.jumpTo(S.slots[want]); return; }
  if (!app.flashHit(S.root, want)) app.toast('That’s not in Everything now.');
}

app.register(KEY, {
  label: 'Everything',
  icon: ICON.grid,
  promise: 'Every app, page and game, A to Z.',
  mount(root) {
    P.style();
    S.root = root;
    root.appendChild(el('p', 'loading', esc('Loading everything…')));
    load().then(() => { draw(); land(); });
  },
  activate(param) { S.pending = param || null; land(); },
  refresh() { if (S.ready && S.root) draw(); },
  deactivate() {},
  subnav() {
    if (!S.ready) return null;
    return sectionBar({ key: 'sec-paper-everything', title: 'Everything', color: '--app-paper-pop',
      find: (k) => S.slots[k], onPick: (k) => app.jumpTo(S.slots[k]),
      items: SECS.map(([k, label]) => ({ key: k, label })) });
  },
  keepSubnav: true,
  newSince() { return 0; },
});
