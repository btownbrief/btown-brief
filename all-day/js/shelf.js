/* shelf.js — the tab a mode has not been built for yet (wave 0 of the eight
   apps, 2026-10-29). Never a blank screen:

   - Live, it is the shell's empty state: the tab's icon, its name, its
     promise from the map (APP-MAP.html), "Coming soon", and the top tabs it
     will have, so a reader sees what is on the way.
   - On ?demo=1 it is the tab as the map draws it, on invented data
     (data/demo/apps/<app>.json): one section per top tab, under the pill
     of top tabs, freshest first, a dot on what is new since the last
     visit, and on a tab that mixes doing and reading, Real life / Online.

   It is also the smallest complete mode: everything the shell offers a tab
   (the pill, freshest first, the dots, the toggle, deep links, the cards)
   in about a hundred lines, which makes it the template a wave 1 builder
   copies into js/modes/ when the real tab is built.

   The demo file's shape, per tab key:
     { "sections": [ { "key": "weekend", "label": "This weekend",
         "world": "irl" | "online" (optional), "hours": 2,
         "items": [ an item in the shape cards.any() draws, with its own "k" ] } ] }
   `hours` is how long ago the section's newest thing arrived; it sets the
   freshest-first order and the dots. */

import * as app from './app.js';
import { el, esc, ICON, cards, section } from './ui.js';
import { sectionBar } from './sections.js';

const HOUR = 3600;

export function shelf(tab, cfg) {
  const key = tab.key || tab.mode;
  const S = { root: null, secs: null, slots: null, pending: null, ready: false };
  const now = () => Math.floor(Date.now() / 1000);

  function drawPromise() {
    app.promise(S.root, key);
    const p = S.root.querySelector('.promise');
    if (p && tab.top && tab.top.length) {
      const tops = el('div', 'promise-tops');
      tops.setAttribute('aria-label', 'What ' + tab.label + ' will have');
      tab.top.forEach((t) => tops.appendChild(el('span', 'chip', '<span>' + esc(t) + '</span>')));
      p.insertBefore(tops, p.querySelector('.soon'));
    }
  }

  function draw() {
    const root = S.root;
    root.innerHTML = '';
    if (!S.secs || !S.secs.length) { drawPromise(); return; }
    S.slots = Object.create(null);
    const feed = el('div', 'shelf');
    S.secs.forEach((sec) => {
      const box = el('section', 'shelf-sec');
      box.dataset.sec = sec.key;
      if (sec.world) box.dataset.world = sec.world;
      section(box, sec.label, null);
      const list = el('div', 'feed');
      app.know(sec.items);
      sec.items.forEach((it) => { const n = cards.any(it); if (n) list.appendChild(n); });
      box.appendChild(list);
      feed.appendChild(box);
      S.slots[sec.key] = box;
    });
    root.appendChild(feed);
    root.appendChild(el('div', 'spacer'));
    app.bindFeed(feed);
    if (app.activeTab() === key) app.paintSubnav();
  }

  /* a deep link: #events/<card key> flashes that card; #events/<section> opens there */
  function land() {
    const want = S.pending;
    if (!want || !S.ready) return;
    S.pending = null;
    if (S.slots && S.slots[want]) { app.jumpTo(S.slots[want]); return; }
    if (!app.flashHit(S.root, want)) app.toast('That’s gone from ' + tab.label + ' now.');
  }

  /* the demo's sections, read once for every shelf of this app (the file is
     fetched once); read before the tab is opened, so its dot is honest */
  let loading = null;
  function load() {
    if (!loading) loading = app.demoJSON('data/demo/apps/' + cfg.id + '.json').then((j) => {
      const t = now();
      const secs = (((j && j.tabs) || {})[key] || {}).sections || [];
      S.secs = secs.filter((s) => s && s.key && s.label && Array.isArray(s.items)).map((s) => ({
        key: String(s.key), label: String(s.label), world: s.world === 'irl' || s.world === 'online' ? s.world : null,
        newest: t - Math.round((Number(s.hours) || 0) * HOUR),
        /* every item has a key and a link (rule 4): in the demo, its own deep link */
        items: s.items.filter((it) => it && it.k).map((it) => ({ ...it, k: key + '-' + it.k, href: it.href || '#' + key + '/' + key + '-' + it.k })),
      }));
    }).catch(() => { S.secs = null; }).then(() => { S.ready = true; app.recount(); });
    return loading;
  }
  if (app.demo) setTimeout(load, 0);

  return {
    label: tab.label,
    icon: ICON[tab.icon] || ICON.more,
    promise: tab.promise || '',
    soon: 'Coming soon',
    shelf: true,
    mixed: !!tab.mixed,
    mount(root) {
      S.root = root;
      if (!app.demo) { S.ready = true; drawPromise(); land(); return; }
      root.appendChild(el('p', 'loading', esc('Loading ' + tab.label + '…')));
      load().then(() => { draw(); land(); });
    },
    activate(param) { S.pending = param || null; land(); },
    refresh() { if (S.ready && S.secs) draw(); },
    deactivate() {},
    subnav() {
      if (!S.secs || !S.secs.length) return null;
      return sectionBar({ key: 'sec-' + cfg.id + '-' + key, title: tab.label, color: cfg.accent + '-pop', fresh: true,
        find: (k) => S.slots && S.slots[k], onPick: (k) => app.jumpTo(S.slots && S.slots[k]),
        items: S.secs.map((s) => ({ key: s.key, label: s.label, newest: s.newest, world: s.world })) });
    },
    keepSubnav: true,
    /* the tab's dot: sections with something newer than the last visit */
    newSince(ts) {
      if (!S.secs) return 0;
      const base = Number(ts) || now() - 4 * HOUR;
      return S.secs.filter((s) => s.newest > base).length;
    },
  };
}
