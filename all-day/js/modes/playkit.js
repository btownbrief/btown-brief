/* playkit.js — what the Play app's own tabs share (wave 1, 2026-10-29):
   Daily, City, Draw, Party and Boards (daily.js, city.js, draw.js, party.js, ranks.js).

   Each of those files hands tab() its key, its words, how to load and how
   to draw; tab() turns that into the shell's register() contract, the same
   one shelf.js shows in full:

   - the page is a column of sections, each a `data-sec` block whose head
     is the shell's section(); the top tabs are the pill over them
     (sectionBar), in page order, following the scroll;
   - #<tab>/<section> jumps to that section, #<tab>/<card key> flashes the
     card, and anything else says it has gone;
   - live, the words and links come from data/play/play.json (hand-edited);
     on ?demo=1 the tab's own data/demo/<file>.json is read on top.

   Nothing here has a colour, a type size or a position of its own: the
   rows are the shell's .lrow, the pictures the arcade's .gm-cab cabinets. */

import * as app from '../app.js';
import * as data from '../wire.js';
import { el, esc, safeHref, ICON, section } from '../ui.js';
import { sectionBar } from '../sections.js';

const PLAY_URL = '../data/play/play.json';
let words = null;
/* data/play/play.json, once for every Play tab */
export function playData() {
  if (!words) words = data.fetchJSON(PLAY_URL, 8000).then((j) => { if (!j || typeof j !== 'object') throw new Error('bad shape'); return j; });
  return words;
}
/* the tab's demo file (data/demo/<name>.json), or null when live */
export const demoOf = (name) => (app.demo ? app.demoData(name).catch(() => null) : Promise.resolve(null));

export const arr = (v) => (Array.isArray(v) ? v : []);
export const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/* a section: the shell's head, tagged with its pill key */
export function sec(host, key, title, sub, right) {
  const box = el('section', 'pl-sec');
  box.dataset.sec = key;
  section(box, title, sub ? esc(sub) : null, right);
  host.appendChild(box);
  return box;
}

/* a link out as a pill or a button; a page in this repo stays in this tab */
export function link(label, href, cls, aria) {
  const a = el('a', cls || 'pillbtn on', label);
  a.href = safeHref(href);
  if (/^https?:/i.test(String(href || ''))) { a.target = '_blank'; a.rel = 'noopener'; }
  if (aria) a.setAttribute('aria-label', aria);
  return a;
}
/* the button a thing gets when it has no link yet */
export function soon(label) {
  const b = el('button', 'pillbtn', esc(label || 'Coming soon'));
  b.type = 'button';
  b.disabled = true;
  b.dataset.soon = '1';
  return b;
}

/* A thing as a list row: its emoji, its name, a line or two (trusted
   markup: esc() text into it), and its buttons. */
export function row(k, emoji, name, lines, buttons) {
  const r = el('div', 'lrow');
  r.dataset.k = k;
  r.innerHTML = '<span class="th bare" aria-hidden="true">' + esc(emoji || '') + '</span><div><div class="t">' + esc(name) + '</div>' +
    arr(lines).filter(Boolean).map((l) => '<div class="s">' + l + '</div>').join('') + '</div>';
  const acts = arr(buttons).filter(Boolean);
  if (acts.length === 1) r.appendChild(acts[0]);
  else if (acts.length) { const box = el('div', 'linkrow'); acts.forEach((b) => box.appendChild(b)); r.appendChild(box); }
  return r;
}

/* A tab of the Play app.
   o = { key, label, icon, promise,
         tops: [[sectionKey, pill label], …]   the top tabs, in page order
         load() → Promise                        everything the page needs
         draw(root)                              the page, after load()
         newSince(ts) → n                        optional: the bar's dot }
   Returns the mode; the caller registers it under its key. */
export function tab(o) {
  const S = { root: null, ready: false, failed: false, pending: null };

  function render() {
    if (!S.root) return;
    S.root.innerHTML = '';
    if (S.failed) { S.root.appendChild(el('div', 'errbox', '<b>' + esc(o.label) + ' didn’t load.</b> Try again in a minute.')); return; }
    if (!S.ready) { S.root.appendChild(el('p', 'loading', esc('Loading ' + o.label + '…'))); return; }
    const page = el('div', 'pl-page');
    o.draw(page);
    S.root.appendChild(page);
    S.root.appendChild(el('div', 'spacer'));
    app.bindFeed(page);
    if (app.activeTab() === o.key) app.paintSubnav();
  }
  const find = (k) => (S.root ? S.root.querySelector('[data-sec="' + k + '"]') : null);
  function land() {
    const k = S.pending;
    if (!k || !S.ready || !S.root) return;
    S.pending = null;
    const at = find(k);
    if (at) { requestAnimationFrame(() => app.jumpTo(at)); return; }
    if (!app.flashHit(S.root, k)) app.toast('That’s gone from ' + o.label + ' now.');
  }

  return {
    label: o.label,
    icon: ICON[o.icon] || ICON.games,
    promise: o.promise,
    mount(root) {
      S.root = root;
      render();
      Promise.resolve().then(o.load).then(() => { S.ready = true; }, (e) => { console.error('[play] ' + o.key, e); S.failed = true; })
        .then(() => { render(); land(); app.recount(); });
    },
    activate(param) { S.pending = param || null; land(); },
    refresh() { render(); },
    redraw: render,
    deactivate() {},
    subnav() {
      if (!S.ready || S.failed) return null;
      const items = o.tops.filter(([k]) => find(k)).map(([key, label]) => ({ key, label }));
      return items.length ? sectionBar({ key: 'sec-play-' + o.key, title: o.label, color: '--app-play-pop', items, find, onPick: (k) => app.jumpTo(find(k)) }) : null;
    },
    keepSubnav: true,
    newSince(ts) { return S.ready && o.newSince ? o.newSince(ts) : 0; },
  };
}
