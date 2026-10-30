/* switcher.js — the eight apps, from the bottom pill, and the home-screen
   card in the mast (wave 0, 2026-10-29).

   The switcher (Stephen, 2026-10-29 evening: not in the mast; on the
   floating pill). Hold the pill's centre cell and a ring under the finger
   counts 3, 2, 1; on 0 a bubble opens above the pill with the eight apps:
   each one's icon, name and one line from the map, a dot when it has
   something new since the reader last looked there, and this one marked.
   A plain tap on the centre cell still opens its tab. A short grace
   (GRACE_MS) passes before the ring shows, so a tap never flashes it;
   lifting once the ring shows, or sliding off, cancels it, with no
   bubble and no change of tab. HOLD_MS is the whole
   countdown, the one number to change (Stephen may want 3000 after trying
   it on his phone); the ring always ticks 3, 2, 1, each a third of it.
   The phone buzzes lightly when the bubble opens, where it can. The
   browser's own long-press menu is kept off that one cell. A mouse gets
   the same on press-and-hold; a keyboard or a screen reader gets "Btown
   apps" in Settings, which opens the same bubble.

   A coach mark says so once, on a reader's first visit ("Hold the middle
   button to switch apps"), and never again once it is closed or the hold
   has been used, in any of the eight apps.

   The everyday way between apps is still a card: a restaurant opens in
   Eat, a plan in People, a game in Play (app.js sends a link to a tab
   this app does not have to the app that has it).

   The home-screen card. A small button in the mast (shown until this app
   is on the home screen) opens a sheet: this app's card, with the
   browser's own install button where it offers one, the two taps drawn
   small elsewhere, and "How to bookmark this", the iPhone, Android and
   computer steps. Each app has its own manifest, name and icon, so each
   goes on the home screen as its own app. */

import { el, esc, ICON, button } from './ui.js';
import { APPS } from './apps/index.js';
import * as asks from './asks.js';

export const HOLD_MS = 1500;       // the whole countdown: three ticks of 500 ms
export const HOLD_TICKS = 3;       // the ring counts 3, 2, 1, then opens
export const GRACE_MS = 150;       // a plain tap is over before the ring shows
const SLOP = 12;                   // px a resting finger may drift
const COACH_KEY = 'allday-coach-apps';

let S = { sheet: null, toast: () => {}, app: null, demo: false, newIn: () => false };
export function bind(o) { S = { ...S, ...o }; }

/* the centre cell of a bar of n: What Now in All Day's nine */
export const centreIndex = (n) => Math.floor(n / 2);

/* an app's tile: its glyph on its own colour (the accent is a token name
   from a config: letters and hyphens only) */
export function tile(a, cls) {
  const t = /^--[a-z-]+$/.test(a.accent || '') ? a.accent : '--app-all-day';
  return '<span class="apptile' + (cls === 'sm' ? ' sm' : '') + '" style="--tile:var(' + t + ');--tile-pop:var(' + t + '-pop)">' + (ICON[a.icon] || ICON.grid) + '</span>';
}

/* ---------------------------------------------------------------- the hold */
let ring = null, holdTimer = 0, tickTimer = 0, graceTimer = 0, held = false, start = null;
/* held: the press outlasted the grace, so the click that ends it is a
   hold's (finished or let go), never a tap on the tab */

function stopHold() {
  clearTimeout(graceTimer); clearTimeout(holdTimer); clearInterval(tickTimer);
  graceTimer = holdTimer = tickTimer = 0;
  start = null;
  if (ring) { ring.remove(); ring = null; }
}
function showRing(x, y) {
  ring = el('div', 'holdring');
  ring.setAttribute('aria-hidden', 'true');
  ring.style.setProperty('--hold-ms', HOLD_MS + 'ms');
  ring.style.left = x + 'px';
  ring.style.top = y + 'px';
  ring.innerHTML = '<svg viewBox="0 0 64 64"><circle class="hr-track" cx="32" cy="32" r="28"/><circle class="hr-fill" cx="32" cy="32" r="28" pathLength="100"/></svg>' +
    '<b class="hr-n">' + HOLD_TICKS + '</b>';
  document.body.appendChild(ring);
  let n = HOLD_TICKS;
  tickTimer = setInterval(() => {
    n -= 1;
    if (ring && n > 0) ring.querySelector('.hr-n').textContent = String(n);
  }, HOLD_MS / HOLD_TICKS);
}

/* the centre cell: hold to switch, tap to open its tab */
export function bindHold(cell) {
  cell.classList.add('holdcell');
  cell.setAttribute('aria-description', 'Hold to switch apps');
  cell.addEventListener('contextmenu', (e) => e.preventDefault());
  cell.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stopHold();
    held = false;
    start = { x: e.clientX, y: e.clientY };
    graceTimer = setTimeout(() => {
      graceTimer = 0;
      if (start) { held = true; showRing(start.x, start.y); }
    }, GRACE_MS);
    holdTimer = setTimeout(() => {
      holdTimer = 0;
      stopHold();
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (x) { /* no buzz here */ } }
      open();
    }, GRACE_MS + HOLD_MS);
  });
  cell.addEventListener('pointermove', (e) => {
    if (start && (Math.abs(e.clientX - start.x) > SLOP || Math.abs(e.clientY - start.y) > SLOP)) stopHold();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => cell.addEventListener(t, () => { if (start) stopHold(); }));
  /* the click that ends a hold opens no tab; capture runs before the bar's own */
  cell.addEventListener('click', (e) => {
    const was = held;
    held = false;
    /* a keyboard's Enter (detail 0) is always a tap */
    if (was && e.detail !== 0) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
}

/* --------------------------------------------------------------- the bubble */
let bubble = null;
export function close() {
  if (!bubble) return;
  bubble.remove(); bubble = null;
  document.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('keydown', onKey, true);
}
function outside(e) { if (bubble && !bubble.contains(e.target)) close(); }
function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
export const isOpen = () => !!bubble;

export function open() {
  close();
  dismissCoach();
  const me = S.app || APPS[0];
  const b = el('div', 'appbubble');
  b.setAttribute('role', 'dialog');
  b.setAttribute('aria-label', 'Btown apps');
  const list = el('div', 'ab-list');
  APPS.forEach((a) => {
    const here = a.id === me.id;
    const fresh = !here && !!S.newIn(a);
    const row = el('a', 'ab-row' + (here ? ' on' : ''), tile(a, 'sm') +
      '<span class="ab-words"><b class="ab-name">' + esc(a.name) + '</b><span class="ab-line">' + esc(a.line || '') + '</span></span>' +
      (fresh ? '<i class="nd" aria-label="New"></i>' : '') + (here ? '<span class="ab-here">' + ICON.check + '</span>' : ''));
    /* the folder, relative to the shared <base>; the demo stays a demo */
    row.href = a.href + (S.demo ? '?demo=1' : '');
    row.dataset.app = a.id;
    if (fresh) row.dataset.new = '1';
    if (here) { row.setAttribute('aria-current', 'page'); row.addEventListener('click', (e) => { e.preventDefault(); close(); }); }
    list.appendChild(row);
  });
  b.appendChild(list);
  document.body.appendChild(b);
  place(b);
  bubble = b;
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
  const first = b.querySelector('.ab-row.on') || b.querySelector('.ab-row');
  if (first) first.focus({ preventScroll: true });
}
/* above the pill on a phone; beside the centre cell on a wide screen's rail */
function place(b) {
  const bar = document.getElementById('tabbar');
  const cell = bar && bar.querySelector('.holdcell');
  if (!bar) return;
  if (matchMedia('(min-width: 1024px)').matches && cell) {
    const r = cell.getBoundingClientRect();
    const h = b.offsetHeight;
    b.classList.add('side');
    b.style.left = (bar.getBoundingClientRect().right + 12) + 'px';
    b.style.top = Math.max(12, Math.min(innerHeight - h - 12, r.top + r.height / 2 - h / 2)) + 'px';
  } else {
    b.style.bottom = (innerHeight - bar.getBoundingClientRect().top + 10) + 'px';
  }
}

/* ------------------------------------------------------------ the coach mark */
let coachEl = null;
const coached = () => { try { return !!localStorage.getItem(COACH_KEY); } catch (e) { return true; } };
export function dismissCoach() {
  try { localStorage.setItem(COACH_KEY, String(Date.now())); } catch (e) { /* the next visit says it again */ }
  if (coachEl) { coachEl.remove(); coachEl = null; }
}
/* once, on a first visit: a small card above the centre cell */
export function coach() {
  if (coached() || coachEl) return;
  const bar = document.getElementById('tabbar');
  const cell = bar && bar.querySelector('.holdcell');
  if (!cell || !cell.offsetParent) return;
  const c = el('div', 'coachmark', '<span>' + esc('Hold the middle button to switch apps') + '</span>');
  c.setAttribute('role', 'status');
  const x = el('button', 'iconbtn', ICON.x);
  x.type = 'button';
  x.setAttribute('aria-label', 'Got it');
  x.addEventListener('click', dismissCoach);
  c.appendChild(x);
  document.body.appendChild(c);
  const r = cell.getBoundingClientRect();
  if (matchMedia('(min-width: 1024px)').matches) {
    c.classList.add('side');
    c.style.left = (bar.getBoundingClientRect().right + 12) + 'px';
    c.style.top = Math.round(r.top + r.height / 2 - c.offsetHeight / 2) + 'px';
  } else {
    c.style.bottom = (innerHeight - bar.getBoundingClientRect().top + 12) + 'px';
    c.style.setProperty('--arrow-x', Math.round(r.left + r.width / 2 - c.getBoundingClientRect().left) + 'px');
  }
  coachEl = c;
}

/* ------------------------------------------------- the home-screen card (mast) */
export function installButton() {
  const b = el('button', 'iconbtn installbtn', ICON.home);
  b.type = 'button';
  b.id = 'install-btn';
  b.setAttribute('aria-label', 'Add to home screen');
  b.addEventListener('click', () => installSheet());
  return b;
}
export function installSheet() {
  if (!S.sheet) return;
  const a = S.app || APPS[0];
  S.sheet('On your home screen', (body) => { body.appendChild(installCard(a)); });
}
export function installCard(a) {
  const c = el('div', 'installcard');
  c.dataset.install = a.id;
  c.innerHTML = tile(a, 'sm') + '<div class="ic-words"><b>' + esc(asks.installed() ? a.name + ' is on your home screen' : 'Put ' + a.name + ' on your home screen') + '</b></div>';
  const row = el('div', 'ic-row');
  if (!asks.installed()) {
    if (asks.canPrompt()) row.appendChild(button(ICON.plus + ' Add to home screen', 'sm', () => asks.promptInstall()));
    else row.appendChild(asks.howTo());
  }
  const how = button('How to bookmark this', 'ghost sm', () => howSheet(a));
  how.dataset.howto = '1';
  row.appendChild(how);
  c.appendChild(row);
  return c;
}

/* the short sheet: iPhone, Android, a computer; this phone's first */
export function howSheet(a) {
  if (!S.sheet) return;
  const steps = {
    iphone: ['iPhone', [[ICON.share, 'Tap Share in Safari'], [ICON.plus, 'Tap Add to Home Screen'], [ICON.check, 'Tap Add']]],
    android: ['Android', [[ICON.more, 'Tap the menu in Chrome'], [ICON.home, 'Tap Add to Home screen'], [ICON.check, 'Tap Install or Add']]],
    computer: ['A computer', [[ICON.star, (asks.isMac() ? 'Press ⌘ D' : 'Press Ctrl D') + ' to bookmark it']]],
  };
  const order = asks.isIOS() ? ['iphone', 'android', 'computer'] : asks.isAndroid() ? ['android', 'iphone', 'computer'] : ['computer', 'iphone', 'android'];
  S.sheet('Keep ' + a.name + ' handy', (body) => {
    body.classList.add('howto-sheet');
    order.forEach((k) => {
      const [name, list] = steps[k];
      const box = el('div', 'howto');
      box.dataset.platform = k;
      box.appendChild(el('div', 'sheet-h', esc(name)));
      const ol = el('ol', 'howto-steps');
      list.forEach(([icon, words]) => ol.appendChild(el('li', null, '<span class="ask-key">' + icon + '</span><span>' + esc(words) + '</span>')));
      box.appendChild(ol);
      body.appendChild(box);
    });
  });
}

/* the reader's last visit to an app, as epoch seconds (store.js's per-app key) */
export function visitBaseOf(id) {
  const key = id === 'all-day' ? 'allday-visit' : 'allday-visit-' + id;
  try { const v = JSON.parse(localStorage.getItem(key) || '{}'); return Number(v && v.base) || 0; } catch (e) { return 0; }
}
