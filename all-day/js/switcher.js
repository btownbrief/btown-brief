/* switcher.js — the apps, from the bottom pill, and the home-screen
   card in the mast (wave 0, 2026-10-29).

   The switcher (Stephen, 2026-10-29 evening: not in the mast; on the
   floating pill). Hold the pill's centre cell and a ring fills under the
   finger; when it closes a bubble opens above the pill with the three
   apps: each one's icon, name and one line, a dot when it has
   something new since the reader last looked there, and this one marked.
   A short grace (GRACE_MS) passes before the ring shows, so a quick tap
   never flashes it. Any lift before the bubble opens is a tap and opens
   the cell's tab; sliding off once the ring shows cancels, with no bubble
   and no change of tab. GRACE_MS + HOLD_MS is the whole hold, 450 ms
   (Stephen, 2026-10-30: quicker; the 3, 2, 1 went with it, three ticks at
   100 ms being a strobe). The phone buzzes lightly when the bubble opens,
   where it can. The browser's own long-press menu is kept off that one
   cell. A mouse gets the same on press-and-hold; a keyboard or a screen
   reader gets "Btown apps" in Settings, which opens the same bubble.

   Three dots on the cell, one per app, say there is more here. On the
   first three opens, across every app, the app does the hold itself with
   no words: a soft disc settles on the cell, the real ring fills, the real
   bubble rises, stays and drops back. Any touch, scroll or key stops it at
   once, and it ends for good the first time the hold is used.

   The everyday way between apps is still a card: a restaurant in Town
   opens in All Day, a habit in Body (app.js sends a link to a tab this app
   does not have to the offered app that has it).

   The home-screen card. A small button in the mast (shown until this app
   is on the home screen) opens a sheet: this app's card, with the
   browser's own install button where it offers one, the two taps drawn
   small elsewhere, and "How to bookmark this", the iPhone, Android and
   computer steps. Each app has its own manifest, name and icon, so each
   goes on the home screen as its own app. */

import { el, esc, ICON, button } from './ui.js';
import { APPS } from './apps/index.js';
import * as asks from './asks.js';

export const HOLD_MS = 300;        // the ring's fill (Stephen, 2026-10-30: 1500, then 750, were too long)
export const GRACE_MS = 150;       // a plain tap is over before the ring shows
const SLOP = 12;                   // px a resting finger may drift
const COACH_KEY = 'allday-coach-apps'; // plays so far; a timestamp from the old coach mark counts as done
const SHOW_PLAYS = 3;              // the first three opens
const SHOW_SETTLE_MS = 350;        // the disc settles
const SHOW_RING_MS = 500;          // the ring, slowed so the eye can catch it
const SHOW_UP_MS = 1400;           // the bubble stays
const SHOW_DROP_MS = 180;          // and drops back (app.css .ab-drop)

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
let ring = null, holdTimer = 0, graceTimer = 0, held = false, start = null;
/* held: the press reached the bubble or slid off, so the click that ends it
   is never a tap on the tab */

function stopHold() {
  clearTimeout(graceTimer); clearTimeout(holdTimer);
  graceTimer = holdTimer = 0;
  start = null;
  if (ring) { ring.remove(); ring = null; }
}
function showRing(x, y, ms = HOLD_MS) {
  ring = el('div', 'holdring');
  ring.setAttribute('aria-hidden', 'true');
  ring.style.setProperty('--hold-ms', ms + 'ms');
  ring.style.left = x + 'px';
  ring.style.top = y + 'px';
  ring.innerHTML = '<svg viewBox="0 0 64 64"><circle class="hr-track" cx="32" cy="32" r="28"/><circle class="hr-fill" cx="32" cy="32" r="28" pathLength="100"/></svg>';
  document.body.appendChild(ring);
}

/* the finger that opened the bubble can stay down: slide up to an app, let go
   and it opens (Stephen, 2026-10-30). Letting go anywhere else leaves the
   bubble open for a plain tap. */
const rowAt = (e) => { const n = document.elementFromPoint(e.clientX, e.clientY); return n && n.closest('.appbubble .ab-row'); };
let unslide = null;
/* the click that follows a lift still has to be swallowed, so held clears just after it */
const clearHeld = () => setTimeout(() => { held = false; }, 350);
function slide(pointerId) {
  const mark = (r) => { if (bubble) bubble.querySelectorAll('.ab-row.hot').forEach((x) => x.classList.toggle('hot', x === r)); if (r) r.classList.add('hot'); };
  const mine = (e) => e.pointerId === undefined || pointerId === undefined || e.pointerId === pointerId;
  const move = (e) => { if (mine(e)) mark(rowAt(e)); };
  const stop = () => {
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('pointercancel', cancel, true);
    window.removeEventListener('blur', cancel);
    unslide = null;
    clearHeld();
  };
  function up(e) {
    if (!mine(e)) return;
    const r = rowAt(e);
    mark(null);
    stop();
    if (!r) return;
    if (r.classList.contains('on')) close(); else location.assign(r.href);
  }
  function cancel(e) { if (mine(e)) { mark(null); stop(); } }
  document.addEventListener('pointermove', move, true);
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', cancel, true);
  window.addEventListener('blur', cancel);
  unslide = stop;
}

/* the centre cell: hold to switch, tap to open its tab */
export function bindHold(cell) {
  cell.classList.add('holdcell');
  cell.style.touchAction = 'none';
  cell.setAttribute('aria-description', 'Hold to switch apps');
  /* Android's long press can beat the hold; its lift brings no click of its own */
  let longPress = false;
  cell.addEventListener('contextmenu', (e) => { e.preventDefault(); longPress = !!start; });
  /* a press that ends any way but a lift cancels the hold once the ring shows;
     a lift before the bubble is a tap, so its click goes on to the bar */
  const cancelHold = () => { if (ring) held = true; stopHold(); };
  cell.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stopHold();
    held = false;
    longPress = false;
    start = { x: e.clientX, y: e.clientY };
    graceTimer = setTimeout(() => {
      graceTimer = 0;
      if (start) showRing(start.x, start.y);
    }, GRACE_MS);
    holdTimer = setTimeout(() => {
      holdTimer = 0;
      held = true;
      stopHold();
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (x) { /* no buzz here */ } }
      open();
      slide(e.pointerId);
    }, GRACE_MS + HOLD_MS);
  });
  cell.addEventListener('pointermove', (e) => {
    if (start && (Math.abs(e.clientX - start.x) > SLOP || Math.abs(e.clientY - start.y) > SLOP)) cancelHold();
  });
  cell.addEventListener('pointerup', () => { if (start) { stopHold(); clearHeld(); if (longPress) cell.click(); } });
  ['pointercancel', 'pointerleave'].forEach((t) => cell.addEventListener(t, () => { if (start) { cancelHold(); clearHeld(); } }));
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
  if (unslide) unslide();
  bubble.remove(); bubble = null;
  document.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('keydown', onKey, true);
}
function outside(e) { if (bubble && !bubble.contains(e.target)) close(); }
function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
export const isOpen = () => !!bubble;

export function open({ quiet = false } = {}) {
  close();
  if (!quiet) { endShow(); setPlays(SHOW_PLAYS); }
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
  if (quiet) return;
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

/* -------------------------------------------------- the hold, shown wordlessly */
let showing = false, showTimer = 0, ghost = null;
const plays = () => { try { return Number(localStorage.getItem(COACH_KEY)) || 0; } catch (e) { return SHOW_PLAYS; } };
const setPlays = (n) => { try { localStorage.setItem(COACH_KEY, String(n)); } catch (e) { /* the next open plays it again */ } };

/* any touch, scroll or key ends it: a finger already down only shows up as
   a scroll. A press on the bubble leaves the bubble up, so a tap on a row
   still works */
const SHOW_STOPS = ['pointerdown', 'keydown', 'wheel', 'scroll'];
function endShow(e) {
  if (!showing) return;
  showing = false;
  clearTimeout(showTimer);
  showTimer = 0;
  SHOW_STOPS.forEach((t) => document.removeEventListener(t, endShow, true));
  if (ghost) { ghost.remove(); ghost = null; }
  if (ring) { ring.remove(); ring = null; }
  if (bubble && e && bubble.contains(e.target)) bubble.classList.remove('ab-rise', 'ab-drop');
  else close();
}
export function coach() {
  const covered = ['sheet', 'vbox', 'confirm'].some((id) => { const n = document.getElementById(id); return n && !n.hidden; });
  if (showing || bubble || start || document.hidden || covered || plays() >= SHOW_PLAYS) return;
  const cell = document.querySelector('#tabbar .holdcell');
  if (!cell || !cell.offsetParent) return;
  setPlays(plays() + 1);
  showing = true;
  const r = cell.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  ghost = el('div', 'holdghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.left = x + 'px';
  ghost.style.top = y + 'px';
  document.body.appendChild(ghost);
  SHOW_STOPS.forEach((t) => document.addEventListener(t, endShow, { capture: true, passive: true }));
  showTimer = setTimeout(() => {
    showRing(x, y, SHOW_RING_MS);
    showTimer = setTimeout(() => {
      ring.remove(); ring = null;
      ghost.remove(); ghost = null;
      open({ quiet: true });
      bubble.classList.add('ab-rise');
      showTimer = setTimeout(() => {
        bubble.classList.add('ab-drop');
        showTimer = setTimeout(endShow, SHOW_DROP_MS);
      }, SHOW_UP_MS);
    }, SHOW_RING_MS);
  }, SHOW_SETTLE_MS);
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
