/* app.js — the shell.

   It owns everything the five modes share and none of what they don't:
   routing and history, which pane is visible, each pane's scroll position,
   the saved list, the toast, the bottom sheet, and the audio player. A mode
   never touches document-level state; it gets a root element and a context
   object and stays inside them.

   Modes are dynamically imported the first time their tab is opened, so
   Watch's code and data cost nothing until you tap Watch. */

import * as store from './store.js';
import * as player from './player.js';
import { esc, safeUrl, ago } from './ui.js';

const TABS = ['read', 'reddit', 'watch', 'listen', 'wander'];

const LOADERS = {
  read: () => import('./modes/read.js'),
  reddit: () => import('./modes/reddit.js'),
  watch: () => import('./modes/watch.js'),
  listen: () => import('./modes/listen.js'),
  wander: () => import('./modes/wander.js'),
};

const modes = {};       // id -> module instance, once loaded
const scrollAt = {};    // id -> scrollTop
const saveIndex = new Map(); // save key -> row, filled by modes as they render

let active = null;
let toastTimer = 0;
let sheetOpen = false;

const el = {};

/* ------------------------------------------------------------------ boot */

function boot() {
  el.panes = document.getElementById('panes');
  el.topbar = document.getElementById('topbar');
  el.tabbar = document.getElementById('tabbar');
  el.toast = document.getElementById('toast');
  el.scrim = document.getElementById('scrim');
  el.sheet = document.getElementById('sheet');
  el.sheetTitle = document.getElementById('sheet-title');
  el.sheetBody = document.getElementById('sheet-body');
  el.savedCount = document.getElementById('saved-count');
  el.wordmark = document.getElementById('wordmark');

  player.init();
  store.playerId();
  store.touchVisit();

  el.tabbar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) go(b.dataset.tab);
  });

  document.getElementById('btn-saved').addEventListener('click', openSaved);
  document.getElementById('btn-search').addEventListener('click', () => {
    const m = modes[active];
    if (m && m.focusSearch) m.focusSearch();
    else toast('Search lives inside Read, Listen and Wander');
  });
  document.getElementById('sheet-close').addEventListener('click', closeSheet);
  el.scrim.addEventListener('click', closeSheet);

  // One delegated handler for every save button in the app.
  el.panes.addEventListener('click', onPaneClick);
  el.sheetBody.addEventListener('click', onSheetClick);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheetOpen) { closeSheet(); return; }
    if (e.target.matches('input, textarea')) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 5) go(TABS[n - 1]);
  });

  window.addEventListener('hashchange', () => {
    const want = (location.hash.replace(/^#/, '').split('/')[0] || '').toLowerCase();
    if (TABS.indexOf(want) >= 0 && want !== active) go(want, true);
  });

  paintSavedCount();
  applyFontSize();

  const first = (location.hash.replace(/^#/, '').split('/')[0] || '').toLowerCase();
  go(TABS.indexOf(first) >= 0 ? first : 'read', true);

  registerSW();
}

/* --------------------------------------------------------------- routing */

function go(tab, replace) {
  if (TABS.indexOf(tab) < 0 || tab === active) return;

  if (active) {
    const oldPane = document.getElementById('pane-' + active);
    scrollAt[active] = oldPane.scrollTop;
    oldPane.hidden = true;
    const m = modes[active];
    if (m && m.deactivate) { try { m.deactivate(); } catch (e) { /* keep switching */ } }
  }

  active = tab;
  const pane = document.getElementById('pane-' + tab);
  pane.hidden = false;
  untuck();

  [...el.tabbar.querySelectorAll('button[data-tab]')].forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });

  const hash = '#' + tab;
  if (location.hash !== hash) {
    if (replace) history.replaceState(null, '', hash);
    else history.pushState(null, '', hash);
  }

  if (window.fbq) { try { window.fbq('trackCustom', 'AllDayTab', { tab }); } catch (e) { /* pixel */ } }

  mount(tab, pane);
}

function mount(tab, pane) {
  if (modes[tab]) {
    const m = modes[tab];
    if (m.activate) { try { m.activate(); } catch (e) { /* keep going */ } }
    restoreScroll(tab, pane);
    return;
  }

  pane.innerHTML = '<p class="loading">Opening…</p>';
  LOADERS[tab]()
    .then((mod) => {
      const m = mod.default || mod;
      modes[tab] = m;
      m.mount(pane, ctx);
      if (m.activate) m.activate();
      restoreScroll(tab, pane);
    })
    .catch((err) => {
      pane.innerHTML = '<div class="empty"><b>That tab didn\'t load</b>' +
        esc(err && err.message ? err.message : 'Try a refresh.') + '</div>';
    });
}

function restoreScroll(tab, pane) {
  const y = scrollAt[tab] || 0;
  requestAnimationFrame(() => { pane.scrollTop = y; bindTuck(pane); });
}

/* --------------------------------------------- the top bar gets out of the way */

let tuckPane = null;
let lastY = 0;

function bindTuck(pane) {
  if (tuckPane === pane) return;
  if (tuckPane) tuckPane.removeEventListener('scroll', onTuckScroll);
  tuckPane = pane;
  lastY = pane.scrollTop;
  pane.addEventListener('scroll', onTuckScroll, { passive: true });
}

function onTuckScroll() {
  const y = tuckPane.scrollTop;
  const dy = y - lastY;
  if (y < 70) untuck();
  else if (dy > 8) el.topbar.classList.add('is-tucked');
  else if (dy < -8) untuck();
  lastY = y;
}

function untuck() { el.topbar.classList.remove('is-tucked'); }

/* ----------------------------------------------------------------- toast */

function toast(msg, undo) {
  clearTimeout(toastTimer);
  el.toast.innerHTML = '<span>' + esc(msg) + '</span>' +
    (undo ? '<button type="button" data-undo>Undo</button>' : '');
  el.toast.classList.add('on');
  if (undo) {
    el.toast.querySelector('[data-undo]').addEventListener('click', () => {
      undo();
      el.toast.classList.remove('on');
    }, { once: true });
  }
  toastTimer = setTimeout(() => el.toast.classList.remove('on'), undo ? 4200 : 2200);
}

/* ------------------------------------------------------------ save plumbing */

function onPaneClick(e) {
  const save = e.target.closest('[data-save]');
  if (save) {
    e.preventDefault();
    e.stopPropagation();
    doSave(save.getAttribute('data-save'), save);
    return;
  }
  // Any outbound link counts as read.
  const link = e.target.closest('a[data-readkey]');
  if (link) {
    store.markRead(link.getAttribute('data-readkey'));
    const row = link.closest('.fi');
    if (row) row.classList.add('is-read');
  }
}

function onSheetClick(e) {
  const save = e.target.closest('[data-save]');
  if (save) {
    e.preventDefault();
    doSave(save.getAttribute('data-save'), save);
    const row = save.closest('[data-savedrow]');
    if (row) row.remove();
    if (!store.savedCount()) renderSaved();
  }
}

function doSave(key, btn) {
  const row = saveIndex.get(key);
  if (!row) return;
  const on = store.toggleSave(row);
  paintSavedCount();
  // Every copy of this item on the page agrees.
  paintSaveButtons(key, on);
  if (btn) toast(on ? 'Saved' : 'Removed', on ? null : () => {
    store.toggleSave(row);
    paintSavedCount();
    paintSaveButtons(key, true);
  });
}

/* Two shapes of save control share one handler: a star in a dense feed row,
   and a worded button on a card or in the saved sheet. Repaint every copy. */
function paintSaveButtons(key, on) {
  document.querySelectorAll('[data-save="' + CSS.escape(key) + '"]').forEach((b) => {
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (b.classList.contains('fi-save')) b.textContent = on ? '★' : '☆';
    else if (b.closest('[data-savedrow]')) b.textContent = 'Remove';
    else b.textContent = on ? 'Saved' : 'Save';
  });
}

function paintSavedCount() {
  const n = store.savedCount();
  el.savedCount.hidden = !n;
  el.savedCount.textContent = n > 99 ? '99+' : String(n);
}

/* ----------------------------------------------------------------- sheet */

function openSheet(title, html) {
  el.sheetTitle.textContent = title;
  el.sheetBody.innerHTML = html;
  el.scrim.hidden = false;
  el.sheet.hidden = false;
  requestAnimationFrame(() => {
    el.scrim.classList.add('on');
    el.sheet.classList.add('on');
  });
  sheetOpen = true;
}

function closeSheet() {
  if (!sheetOpen) return;
  el.scrim.classList.remove('on');
  el.sheet.classList.remove('on');
  sheetOpen = false;
  setTimeout(() => {
    if (sheetOpen) return;
    el.scrim.hidden = true;
    el.sheet.hidden = true;
    el.sheetBody.innerHTML = '';
  }, 280);
}

const KIND_LABEL = { article: 'Read', video: 'Watch', episode: 'Listen', wiki: 'Wikipedia' };

function openSaved() { openSheet('Saved', savedHTML()); }
function renderSaved() { el.sheetBody.innerHTML = savedHTML(); }

function savedHTML() {
  const rows = store.savedList();
  if (!rows.length) {
    return '<div class="empty"><b>Nothing saved yet</b>' +
      'Save anything from any tab and it lands here.</div>';
  }
  return rows.map((r) => {
    saveIndex.set(r.k, r);
    const u = safeUrl(r.u);
    const kind = KIND_LABEL[r.kind] || 'Saved';
    return '<div class="fi" data-savedrow>' +
      '<div class="fi-body">' +
        (u ? '<a class="fi-t" href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(r.t) + '</a>'
           : '<span class="fi-t nolink">' + esc(r.t) + '</span>') +
        '<div class="fi-m">' +
          '<span class="fi-src">' + esc(kind) + '</span>' +
          (r.s ? '<span>' + esc(r.s) + '</span>' : '') +
          (r.d ? '<span>' + esc(ago(r.d)) + '</span>' : '') +
        '</div>' +
        '<div class="fi-acts" style="opacity:1">' +
          '<button data-save="' + esc(r.k) + '" aria-pressed="true">Remove</button>' +
        '</div>' +
      '</div>' +
      (r.i ? '<img class="fi-thumb" src="' + esc(safeUrl(r.i)) + '" alt="" loading="lazy">' : '<span></span>') +
    '</div>';
  }).join('');
}

/* ------------------------------------------------------------- type size */

function applyFontSize() {
  document.documentElement.style.setProperty('--fs', store.setting('fs') + 'px');
}

/* -------------------------------------------------------- service worker */

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').catch(() => null);
}

/* ------------------------------------------- what a mode is handed on mount */

const ctx = {
  toast,
  openSheet,
  closeSheet,
  player,
  store,
  /* Modes call index() as they render so the shell's one save handler can
     resolve a key back to a row without every mode wiring its own. */
  index(key, row) { saveIndex.set(key, row); return key; },
  isSaved: store.isSaved,
  go,
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
