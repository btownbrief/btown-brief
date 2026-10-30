/* picks.js — The Paper's Picks (wave 1, 2026-10-29): what Stephen
   would send you first, each with its reason.

     Stephen's picks  data/paper/picks.json, seeded from the hub's "A few of
                      my favorites"; the Front shows three a day from it
     Best of          the best-of pages, from the same file
     This month       the stories the Brief ran this month, edition by
                      edition (data/newsletter-picks.json)
     Spotlight        one guide page a day, round the whole catalog
                      (data/catalog.json), and the next few in line */

import * as app from '../app.js';
import { el, esc, ICON } from '../ui.js';
import { sectionBar } from '../sections.js';
import * as P from './paper-core.js';

const KEY = 'picks';
const SECS = [['mine', 'Stephen’s picks'], ['bestof', 'Best of'], ['month', 'This month'], ['spotlight', 'Spotlight']];
const S = { root: null, slots: {}, data: null, pending: null, ready: false };

function rows(host, list, prefix, o = {}) {
  const items = list.filter((p) => p && p.title && p.href).map((p, i) => P.item(KEY, prefix + '-' + i + '-' + p.title, { title: p.title, line: p.why || p.line || '', href: p.href, eyebrow: p.eyebrow || null, emoji: p.emoji || null }));
  app.know(items);
  const box = el('div', 'pp-list');
  items.forEach((it) => { const n = P.row(it, o); if (n) box.appendChild(n); });
  host.appendChild(box);
  return items.length;
}

function draw() {
  const d = S.data;
  const root = S.root;
  root.innerHTML = '';
  S.slots = {};
  const page = P.bind(el('div', 'pp'));

  const mine = P.block(page, 'mine', 'Stephen’s picks');
  if (!rows(mine, d.picks, 'mine')) P.noteLine(mine, 'Couldn’t load the picks.');
  S.slots.mine = mine;

  const best = P.block(page, 'bestof', 'Best of');
  if (!rows(best, d.bestof, 'best')) P.noteLine(best, 'Couldn’t load these.');
  S.slots.bestof = best;

  /* this month: the editions of the latest month that has any */
  const month = P.block(page, 'month', 'This month', d.monthLabel);
  if (d.month.length) {
    d.month.forEach((e) => {
      month.appendChild(el('div', 'tdiv', '<span>' + esc(e.edition) + '</span>'));
      rows(month, (e.stories || []).slice(0, 6).map((s) => ({ title: s.t, line: s.s || '', href: s.u })), 'm-' + e.d, { cls: 'tight' });
    });
  } else P.noteLine(month, 'Couldn’t load this month.');
  S.slots.month = month;

  const spot = P.block(page, 'spotlight', 'Spotlight');
  if (d.spot.length) rows(spot, d.spot.slice(0, 1), 'spot-today');
  else P.noteLine(spot, 'Couldn’t load the spotlight.');
  S.slots.spotlight = spot;

  root.appendChild(page);
  root.appendChild(el('div', 'spacer'));
  if (app.activeTab() === KEY) app.paintSubnav();
}

let loading = null;
function load() {
  if (!loading) loading = Promise.all([P.load('picks'), P.load('recent'), P.load('catalog')]).then(([pj, recent, cat]) => {
    const eds = ((recent && recent.editions) || []).filter((e) => e && e.d && Array.isArray(e.stories)).sort((a, b) => b.d - a.d);
    const first = eds[0] ? new Date(eds[0].d * 1000) : null;
    const same = (e) => { const t = new Date(e.d * 1000); return first && t.getMonth() === first.getMonth() && t.getFullYear() === first.getFullYear(); };
    S.data = {
      picks: (pj && pj.picks) || [],
      bestof: (pj && pj.bestof) || [],
      month: eds.filter(same),
      monthLabel: first ? P.monthName(first.getMonth()) + ' ' + first.getFullYear() : '',
      spot: [P.spotlight(cat)].filter(Boolean),
    };
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
  if (!app.flashHit(S.root, want)) app.toast('That’s not in Picks now.');
}

app.register(KEY, {
  label: 'Picks',
  icon: ICON.star,
  promise: 'Stephen’s picks, each with a reason.',
  mount(root) {
    P.style();
    S.root = root;
    root.appendChild(el('p', 'loading', esc('Loading the picks…')));
    load().then(() => { draw(); land(); });
  },
  activate(param) { S.pending = param || null; land(); },
  refresh() { if (S.ready && S.root) draw(); },
  deactivate() {},
  subnav() {
    if (!S.ready) return null;
    return sectionBar({ key: 'sec-paper-picks', title: 'Picks', color: '--app-paper-pop',
      find: (k) => S.slots[k], onPick: (k) => app.jumpTo(S.slots[k]),
      items: SECS.map(([k, label]) => ({ key: k, label })) });
  },
  keepSubnav: true,
  newSince() { return 0; },
});
