/* out-common.js — what Out's four built tabs share (wave 1, 2026-10-29).

   Events, Nightlife, Sports and Explore are each a page of sections under
   the shell's pill of top tabs, the same contract shelf.js shows in its
   smallest form. This is that page once, so each tab only says where its
   data comes from and what its sections hold:

     outMode({ key, label, icon, promise, mixed, load })
       load(demo) -> Promise<[section]>, called on the first visit and again
       by reload() after a reader posts. A section:
         { key, label, sub,           the head ("sub" is plain text)
           world: 'irl' | 'online',   optional: Real life / Online
           newest,                    epoch seconds of its newest thing: the pill's dot
           items: [card item],        drawn with the shell's cards; each has k and href
           draw(box, list),           optional: anything else the section shows
           empty }                    what to say when it has nothing

   A card item may carry `act`: its call-to-action button then answers
   app.onAct(act) (Been there, Coming) instead of the shell's placeholder
   toast. Items may carry `created` (epoch seconds) for the tab's dot.

   Why one file: the four tabs would otherwise repeat the deep links, the
   pill, the dot count and the loading and error states four times over. */

import * as app from '../app.js';
import { el, esc, ICON, cards, section, note, button } from '../ui.js';
import { sectionBar } from '../sections.js';

export const HOUR = 3600;
export const now = () => Math.floor(Date.now() / 1000);

/* Burlington's clock, whatever the phone's zone: 'YYYY-MM-DD' and the hour */
const ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' });
export function etNow(ms = Date.now()) {
  const p = Object.fromEntries(ET.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: p.year + '-' + p.month + '-' + p.day, hour: Number(p.hour), dow: p.weekday };
}
export const addDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
};
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dowOf = (day) => { const [y, m, d] = day.split('-').map(Number); return DOW[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()]; };
export const domOf = (day) => String(Number(day.slice(8, 10)));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dateWords = (day) => dowOf(day) + ', ' + MON[Number(day.slice(5, 7)) - 1] + ' ' + domOf(day);
/* '19:30' or an ISO start -> '7:30 pm' */
export function clock(t) {
  const m = String(t || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = Number(m[1]), mm = m[2];
  return (h % 12 || 12) + (mm === '00' ? '' : ':' + mm) + (h < 12 ? ' am' : ' pm');
}
/* a demo date: n days from Burlington's today */
export const demoDay = (n) => addDays(etNow().day, Number(n) || 0);

export function outMode(cfg) {
  const key = cfg.key;
  const S = { root: null, secs: null, slots: null, pending: null, ready: false, error: false, loading: null };

  function load() {
    if (!S.loading) {
      S.loading = Promise.resolve().then(() => cfg.load(app.demo)).then((secs) => {
        S.secs = (secs || []).filter((s) => s && s.key && s.label);
        S.error = false;
      }).catch((e) => {
        console.error('[out] ' + key + ' did not load', e);
        S.secs = null;
        S.error = true;
      }).then(() => { S.ready = true; app.recount(); });
    }
    return S.loading;
  }

  function draw() {
    const root = S.root;
    if (!root) return;
    root.innerHTML = '';
    if (S.error || !S.secs) {
      root.appendChild(cards.caught({ title: cfg.label + ' didn’t load', text: 'Check your connection and try again.', check: false,
        buttons: [button('Try again', 'ghost', () => { reload(); })] }));
      return;
    }
    S.slots = Object.create(null);
    const feed = el('div', 'shelf out-page');
    S.secs.forEach((sec) => {
      const box = el('section', 'shelf-sec out-sec');
      box.dataset.sec = sec.key;
      if (sec.world) box.dataset.world = sec.world;
      section(box, sec.label, sec.sub ? esc(sec.sub) : null, sec.right ? sec.right() : null);
      const list = el('div', 'feed');
      const items = (sec.items || []).filter((it) => it && it.k && it.href);
      app.know(items);
      items.forEach((it) => {
        const n = cards.any(it);
        if (!n) return;
        /* the card's one button is this tab's (Been there, Coming), not the shell's placeholder */
        const cta = it.act && n.querySelector('[data-cta]');
        if (cta) { cta.dataset.act = it.act; cta.removeAttribute('data-cta'); }
        list.appendChild(n);
      });
      box.appendChild(list);
      if (!items.length && sec.empty) note(box, sec.empty, 'pad');
      if (sec.draw) sec.draw(box, list);
      feed.appendChild(box);
      S.slots[sec.key] = box;
    });
    root.appendChild(feed);
    root.appendChild(el('div', 'spacer'));
    app.bindFeed(feed);
    if (app.activeTab() === key) app.paintSubnav();
  }

  /* #events/<section> opens there; #events/<card key> flashes that card */
  function land() {
    const want = S.pending;
    if (!want || !S.ready || !S.slots) return;
    S.pending = null;
    if (S.slots[want]) { app.jumpTo(S.slots[want]); return; }
    if (!app.flashHit(S.root, want)) app.toast('That’s gone from ' + cfg.label + ' now.');
  }

  function reload() {
    S.loading = null;
    return load().then(() => { draw(); land(); });
  }

  /* read before the tab is opened, so its dot in the bar is honest */
  setTimeout(load, 0);

  return {
    label: cfg.label,
    icon: ICON[cfg.icon] || ICON.more,
    promise: cfg.promise || '',
    mixed: !!cfg.mixed,
    mount(root) {
      S.root = root;
      root.appendChild(el('p', 'loading', esc('Loading ' + cfg.label + '…')));
      load().then(() => { draw(); land(); });
    },
    activate(param) { S.pending = param || null; land(); },
    refresh() { if (S.ready) draw(); },
    deactivate() {},
    reload,
    subnav() {
      if (!S.secs || !S.secs.length) return null;
      return sectionBar({ key: 'sec-out-' + key, title: cfg.label, color: '--app-out-pop',
        find: (k) => S.slots && S.slots[k], onPick: (k) => app.jumpTo(S.slots && S.slots[k]),
        items: S.secs.map((s) => ({ key: s.key, label: s.short || s.label, newest: s.newest, world: s.world })) });
    },
    keepSubnav: true,
    /* the tab's dot: things that arrived since the reader last looked */
    newSince(ts) {
      if (!S.secs) return 0;
      const base = Number(ts) || now() - 4 * HOUR;
      return S.secs.reduce((n, s) => n + (s.items || []).filter((it) => Number(it.created) > base).length, 0);
    },
  };
}

/* the JSON a tab reads: its live file, or on ?demo=1 its invented one */
export function readJSON(live, demoFile) {
  const url = app.demo && demoFile ? 'data/demo/' + demoFile : live;
  return fetch(url).then((r) => { if (!r.ok) throw new Error(url + ' HTTP ' + r.status); return r.json(); });
}

/* a row of plain buttons at the foot of a section */
export function buttons(box, list) {
  const r = el('div', 'linkrow todaylinks');
  list.filter(Boolean).forEach((b) => r.appendChild(b));
  box.appendChild(r);
  return r;
}
/* a link that looks like a button (the shell's .btn), opening outside */
export function linkButton(label, href, cls) {
  const a = el('a', 'btn ' + (cls || 'ghost sm'), esc(label) + ' ' + ICON.ext);
  a.href = href;
  if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
  return a;
}
