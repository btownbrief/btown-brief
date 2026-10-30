/* body-kit.js — what the Body app's five built tabs share (wave 1 of the
   eight apps, 2026-10-29). Not a mode itself: Train, Recover, Fuel, Coach
   and Together import it.

   - page(): a mode whose top tabs are sections of one scrolling page, the
     way shelf.js draws a demo: the pill jumps between them and follows the
     scroll, #train/gyms lands on a section, #train/<card key> flashes a
     card, and a file that did not load says so with Try again.
   - data(): the content lane's files under data/body/ (gyms.json and the
     rest), fetched once. They are reference content, so the demo shows the
     same files; what the demo invents is the reader's own side (the log,
     the counters), from data/demo/body.json through seed().
   - keep() and put(): what a reader keeps on this phone (the effort log,
     water and protein, the "less of" counters), the way habits-local keeps
     taps. In the demo it lives in memory and nothing is saved.
   - player(): the play-through timer the stretch, yoga, roll, meditation
     and sprint routines share, in the shell's sheet.

   Drawing is the shell's own classes only (cards, .lrow, .sec, .hb-*): a
   mode has no colours, sizes or fixed positions of its own. */

import * as app from '../app.js';
import * as store from '../store.js';
import { el, esc, safeHref, ICON, section, button, divider } from '../ui.js';
import { sectionBar } from '../sections.js';
import { dayKey, addDays } from '../habits-core.js';

export { addDays };
export const today = () => dayKey(Date.now());
const SHORT = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
/* '2026-10-29' as 'Oct 29' */
export const shortDay = (key) => (/^\d{4}-\d{2}-\d{2}$/.test(String(key || '')) ? SHORT.format(new Date(key + 'T12:00:00Z')) : '');
export const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/* ------------------------------------------------------------------ data */
const files = Object.create(null);
/* data/body/<name>.json (the <base> is /all-day/, so ../data is the repo's) */
export function data(name) {
  if (!files[name]) {
    files[name] = fetch('../data/body/' + name).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return /\.md$/.test(name) ? r.text() : r.json(); });
    files[name].catch(() => { delete files[name]; });   // Try again asks afresh
  }
  return files[name];
}
let demoFile = null;
/* data/demo/body.json: the reader's side, invented */
export const demoData = () => (demoFile = demoFile || app.demoData('body').catch(() => ({})));

/* ----------------------------------------------------- kept on the phone */
const MEM = Object.create(null);
export function keep(key, fallback) {
  if (app.demo) return Object.prototype.hasOwnProperty.call(MEM, key) ? MEM[key] : fallback;
  return store.read(key, fallback);
}
export function put(key, value) {
  if (app.demo) { MEM[key] = value; return true; }
  return store.write(key, value);
}
/* the demo's starting state for a key, once */
export function seed(key, value) { if (app.demo && !Object.prototype.hasOwnProperty.call(MEM, key)) MEM[key] = value; }

/* ------------------------------------------------------------- drawing */
export { section, divider };
/* a paragraph of reading, at the gutter */
export const para = (host, text, cls) => host.appendChild(el('p', 'hb-empty' + (cls ? ' ' + cls : ''), esc(text)));
/* a short list on the fern card (Stephen's rules, the basics) */
export function bullets(host, list, title) {
  const box = el('div', 'hb-help');
  if (title) box.appendChild(el('p', 'hb-lab', esc(title)));
  box.appendChild(el('ul', 'hb-helpl', (list || []).map((t) => '<li>' + esc(t) + '</li>').join('')));
  host.appendChild(box);
  return box;
}
/* a link out, in a new tab */
export function ext(label, href, cls) {
  const a = el('a', cls || 'pillbtn', esc(label) + ICON.ext);
  a.href = safeHref(href);
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}
/* a link to another tab (#train/gyms), in this app or the one that has it */
export function tabLink(label, hash, cls) {
  const a = el('a', cls || 'pillbtn', esc(label));
  a.href = '#' + hash;
  return a;
}
export function links(host, nodes) {
  const w = el('div', 'addrow');
  const r = el('div', 'linkrow');
  nodes.filter(Boolean).forEach((n) => r.appendChild(n));
  w.appendChild(r);
  host.appendChild(w);
  return r;
}

/* A list row (.lrow): a tile, the title, a few one-line facts, and one
   control on the right. tile: { big, small } or { icon }. lines: strings,
   or [bold, rest]. onOpen makes the middle a button. */
export function row({ k, tile, title, lines, right, onOpen, done }) {
  const r = el('div', 'lrow' + (done ? ' done' : ''));
  if (k) r.dataset.k = k;
  const th = tile && tile.icon ? el('span', 'th bare', tile.icon)
    : el('span', 'th tm', '<b>' + esc(tile ? tile.big : '') + '</b><span>' + esc(tile ? tile.small || '' : '') + '</span>');
  const inner = '<div class="t">' + esc(title) + '</div>' + (lines || []).filter((l) => l && (!Array.isArray(l) || l[1] || l[0]))
    .map((l) => '<div class="s">' + (Array.isArray(l) ? '<b>' + esc(l[0]) + '</b> ' + esc(l[1] || '') : esc(l)) + '</div>').join('');
  const mid = onOpen ? el('button', 'open', inner) : el('div', null, inner);
  if (onOpen) { mid.type = 'button'; mid.addEventListener('click', () => onOpen(r)); }
  r.append(th, mid, right || el('span'));
  return r;
}

/* "Sources" under a section: each one's title as a link, and what it says */
export function sources(host, list) {
  const ok = (list || []).filter((s) => s && /^https?:/i.test(String(s.url || '')));
  if (!ok.length) return;
  const box = el('div', 'hb-gate');
  box.appendChild(el('p', 'hb-lab', ok.length === 1 ? 'Source' : 'Sources'));
  ok.forEach((s) => {
    const r = el('div', 'sheet-row');
    const a = el('a', 't', esc(s.title) + (s.says ? '<div class="d">' + esc(s.says) + '</div>' : ''));
    a.href = safeHref(s.url);
    a.target = '_blank';
    a.rel = 'noopener';
    r.appendChild(a);
    box.appendChild(r);
  });
  host.appendChild(box);
}

/* The big-number block habits draws on top of Today: a number, its label,
   an optional right-hand number, and a bar. */
export function stat({ num, label, rnum, rlabel, share }) {
  const w = el('section', 'hb-today');
  w.innerHTML = '<div class="hb-stat"><span class="hb-num">' + esc(num) + '</span><span class="hb-lab">' + esc(label) + '</span></div>' +
    (rnum != null ? '<div class="hb-stat r"><span class="hb-num">' + esc(rnum) + '</span><span class="hb-lab">' + esc(rlabel || '') + '</span></div>' : '<span></span>') +
    (share != null ? '<span class="hb-bar" role="progressbar" aria-label="' + esc(label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(share) + '">' +
      '<i style="width:' + Math.max(0, Math.min(100, share)) + '%"></i></span>' : '');
  return w;
}

/* a small form field, the habits form's look */
let fid = 0;
export function field(label, input, hint) {
  const r = el('div', 'bf-row');
  input.id = input.id || 'bk-f' + (++fid);
  const l = el('label', 'bf-label', esc(label));
  l.htmlFor = input.id;
  r.append(l, input);
  if (hint) r.appendChild(el('p', 'bf-hint', esc(hint)));
  return r;
}
export function input(name, { placeholder, value, type, max } = {}) {
  const i = el('input', 'field bf-in');
  i.name = name;
  i.type = type || 'text';
  if (type === 'number') { i.inputMode = 'decimal'; i.min = '0'; }
  if (max) i.maxLength = max;
  if (placeholder) i.placeholder = placeholder;
  if (value != null) i.value = String(value);
  return i;
}
export function select(name, options, value) {
  const s = el('select', 'field bf-in');
  s.name = name;
  options.forEach(([v, label]) => { const o = el('option', null, esc(label)); o.value = String(v); if (String(v) === String(value)) o.selected = true; s.appendChild(o); });
  return s;
}

/* ------------------------------------------------------------- the player */
const mmss = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
export { mmss };
/* Play a routine through, one step at a time, in a sheet: the step, how to
   do it, its countdown and what comes next. steps: [{ name, seconds, how }].
   Pause, back, skip; closing the sheet stops it. */
export function player(title, steps) {
  const list = (steps || []).filter((s) => s && s.seconds > 0);
  if (!list.length) return;
  app.sheet(title, (body) => {
    body.dataset.player = '1';
    let i = 0, left = list[0].seconds, paused = false, last = Date.now(), timer = 0;
    const total = list.reduce((n, s) => n + s.seconds, 0);
    const box = el('div');
    const ctrl = el('div', 'linkrow');
    const back = button('Back', 'ghost sm', () => go(i - 1));
    const pause = button('Pause', 'sm', () => { paused = !paused; last = Date.now(); paint(); });
    const skip = button('Skip', 'ghost sm', () => go(i + 1));
    pause.dataset.play = 'pause';
    ctrl.append(back, pause, skip);
    body.append(box, ctrl);
    function go(n) {
      if (n < 0) n = 0;
      if (n >= list.length) { done(); return; }
      i = n; left = list[i].seconds; last = Date.now();
      if (navigator.vibrate) try { navigator.vibrate(30); } catch (e) { /* no buzz */ }
      paint();
    }
    function done() {
      clearInterval(timer);
      box.innerHTML = '';
      box.appendChild(stat({ num: 'Done', label: title + ', ' + mmss(total) }));
      box.appendChild(el('p', 'sheet-note', 'Nice work. Tap it done on your Today list if it’s one of your habits.'));
      ctrl.innerHTML = '';
      ctrl.appendChild(tabLink('Today', 'habits', 'btn sm'));
      body.dataset.player = 'done';
    }
    function paint() {
      const s = list[i];
      const elapsed = list.slice(0, i).reduce((n, x) => n + x.seconds, 0) + (s.seconds - left);
      box.innerHTML = '';
      const st = stat({ num: mmss(left), label: s.name, rnum: (i + 1) + ' of ' + list.length, rlabel: paused ? 'Paused' : 'Step', share: 100 * elapsed / total });
      st.dataset.step = String(i);
      box.appendChild(st);
      if (s.how) box.appendChild(el('p', 'sheet-note', esc(s.how)));
      if (list[i + 1]) box.appendChild(el('p', 'sheet-note', '<b>Next</b> ' + esc(list[i + 1].name)));
      pause.textContent = paused ? 'Resume' : 'Pause';
      back.disabled = i === 0;
    }
    timer = setInterval(() => {
      if (!body.isConnected) { clearInterval(timer); return; }
      const now = Date.now();
      if (!paused) { left -= (now - last) / 1000; if (left <= 0) go(i + 1); else paintClock(); }
      last = now;
    }, 250);
    const paintClock = () => { const n = box.querySelector('.hb-num'); if (n) n.textContent = mmss(left); };
    paint();
  });
}

/* ---------------------------------------------------------- a sectioned tab */
/* One scrolling page of sections under the top-tab pill. o:
     key, label, icon, promise, color (a --token for the pill's water),
     sections: [[key, label]], load(): Promise of what draw needs,
     draw(sectionKey, box, ctx): fills one section (it draws its own head),
     newSince(ts, ctx), aside, mixed */
export function page(o) {
  const S = { root: null, ctx: null, slots: null, pending: null, ready: false, failed: false };
  let loading = null;
  const load = () => (loading = loading || Promise.resolve().then(o.load).then((c) => { S.ctx = c || {}; S.failed = false; }, (e) => {
    console.warn('[body] ' + o.key + ' did not load', e);
    S.failed = true; loading = null;
  }).then(() => { S.ready = true; app.recount(); }));

  function drawOne(k) {
    const box = S.slots && S.slots[k];
    if (!box) return;
    box.innerHTML = '';
    try { o.draw(k, box, S.ctx); } catch (e) { console.error('[body] ' + o.key + '/' + k + ' threw', e); box.appendChild(el('p', 'hb-empty', 'This part didn’t draw.')); }
  }
  function draw() {
    const root = S.root;
    root.innerHTML = '';
    if (S.failed) {
      const box = el('div', 'hb-gate');
      box.appendChild(el('p', 'hb-empty', esc(o.label + ' didn’t load. Check your connection.')));
      box.appendChild(button('Try again', 'ghost', () => { root.innerHTML = ''; root.appendChild(el('p', 'loading', 'One moment…')); load().then(() => { draw(); land(); }); }));
      root.appendChild(box);
      return;
    }
    S.slots = Object.create(null);
    const feed = el('div', 'shelf body-page');
    feed.dataset.body = o.key;
    o.sections.forEach(([k]) => {
      const box = el('section', 'shelf-sec');
      box.dataset.sec = k;
      feed.appendChild(box);
      S.slots[k] = box;
    });
    root.appendChild(feed);
    o.sections.forEach(([k]) => drawOne(k));
    root.appendChild(el('div', 'spacer'));
    if (app.activeTab() === o.key) app.paintSubnav();
  }
  /* #train/gyms lands on Gyms; #train/<card> flashes the card */
  function land() {
    const want = S.pending;
    if (!want || !S.ready || S.failed) return;
    S.pending = null;
    if (S.slots && S.slots[want]) { app.jumpTo(S.slots[want]); return; }
    if (o.land && o.land(want, S.ctx)) return;
    if (!app.flashHit(S.root, want)) app.toast('That’s not in ' + o.label + ' any more.');
  }
  const mod = {
    label: o.label,
    icon: ICON[o.icon] || ICON.more,
    promise: o.promise,
    mixed: !!o.mixed,
    mount(root) {
      S.root = root;
      root.appendChild(el('p', 'loading', esc('Loading ' + o.label + '…')));
      load().then(() => { if (S.ctx) S.ctx.redraw = drawOne; draw(); land(); });
    },
    activate(param) { S.pending = param || null; land(); if (o.activate) o.activate(param, S.ctx); },
    refresh() { if (S.ready && !S.failed) draw(); },
    deactivate() { if (o.deactivate) o.deactivate(S.ctx); },
    subnav() {
      if (!S.slots) return null;
      return sectionBar({ key: 'sec-body-' + o.key, title: o.label, color: o.color || '--app-body-pop',
        find: (k) => S.slots && S.slots[k], onPick: (k) => app.jumpTo(S.slots && S.slots[k]),
        items: o.sections.map(([key, label]) => ({ key, label })) });
    },
    keepSubnav: true,
    newSince(ts) { return o.newSince && S.ctx ? Number(o.newSince(ts, S.ctx)) || 0 : 0; },
  };
  /* the dot needs the data before the tab is opened, as the shelf's does */
  if (o.newSince) setTimeout(load, 0);
  return mod;
}
