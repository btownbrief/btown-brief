/* app.js — the shell. Router, tab lifecycle, and everything that has to
   outlive a tab switch: the one <audio>, the video box, the sheets, the
   toast, the peek card.

   Boot order is not a problem here the way it was in the first pass: ES
   modules import their tabs, so every register() has run before route()
   is called. There is no window-global registry to race.

   Each tab panel is its own scroll container, so per-tab scroll memory is
   just saving and restoring scrollTop, and the top chrome can slide away
   without the layout reflowing. */

import * as store from './store.js';
import * as wire from './wire.js';
import { el, esc, safeHref, ICON } from './ui.js';

const $ = (id) => document.getElementById(id);
/* What Now sits fifth of nine — dead centre, which is where the bar puts
   its own button. */
/* Ten tabs on two rows. What Now sits at the centre of the BOTTOM row — the
   row a thumb reaches — with two tabs either side of it. */
const TABS = ['wire', 'reddit', 'watch', 'listen', 'music',
              'photos', 'sports', 'whatnow', 'ig', 'wander'];

const registry = Object.create(null);
let active = null;
const mounted = Object.create(null);

export function register(tab, mod) { registry[tab] = mod; }

/* ------------------------------------------------------------------ hash */

function parseHash() {
  const h = location.hash.replace(/^#/, '');
  const m = h.match(/^wander\/(.+)$/);
  if (m) {
    /* a shared link can carry broken percent-encoding, and an uncaught
       URIError here would take the whole router down */
    let title;
    try { title = decodeURIComponent(m[1]); } catch (e) { title = m[1]; }
    return { tab: 'wander', param: title };
  }
  return { tab: TABS.includes(h) ? h : 'wire', param: null };
}

export function go(tab, param) {
  const next = param ? tab + '/' + encodeURIComponent(param) : tab;
  if (location.hash.replace(/^#/, '') === next) route();
  else location.hash = next;
}

function route() {
  const { tab, param } = parseHash();
  const panel = $('panel-' + tab);
  if (!panel) return;

  if (active && active !== tab) {
    const prev = $('panel-' + active);
    if (prev) {
      scrollMemory[active] = prev.scrollTop;
      prev.hidden = true;
    }
    registry[active]?.deactivate?.();
  }

  const first = !mounted[tab];
  if (first) { mounted[tab] = true; registry[tab]?.mount?.(panel); }
  else if (stale[tab]) { delete stale[tab]; registry[tab]?.refresh?.(); }
  panel.hidden = false;

  document.querySelectorAll('.tabbar button').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  if (active !== tab) {
    panel.scrollTop = scrollMemory[tab] || 0;
    document.body.classList.remove('chrome-away');
    paintReadbar(panel);
  }
  active = tab;
  registry[tab]?.activate?.(param, first);
  store.touchVisit();
}

const scrollMemory = Object.create(null);
export const activeTab = () => active;

/* Redraw the tab on screen because something it reads has changed — a source
   muted from Settings, Focus switched on. route() cannot do this: it only
   calls activate(), which for most tabs is deliberately empty so that a plain
   tab switch does not throw away scroll position and re-render. */
export function refresh() { registry[active]?.refresh?.(); }

/* A tab that mounted earlier does not re-render when you come back to it —
   that is deliberate, it keeps your scroll position. But the Local switch is
   one shared mode across all five tabs, so flipping it has to reach the four
   you cannot see. Mark them; route() redraws on the way in. */
const stale = Object.create(null);

export function setLocal(on) {
  store.setSetting('localOnly', !!on);
  Object.keys(mounted).forEach((t) => { if (t !== active) stale[t] = true; });
  refresh();
}

/* ----------------------------------------------------------------- chrome */

const mast = $('mast');

function measureChrome() {
  const root = document.documentElement;
  root.style.setProperty('--mast-h', mast.offsetHeight + 'px');
  /* nav.js is deferred and prepends its bar to body — it can arrive after
     first paint and wraps to two lines on a narrow phone, so measure it
     rather than assume. It stays 0 if the bar never loads. */
  const nav = document.querySelector('.btnav');
  root.style.setProperty('--nav-h', (nav ? nav.offsetHeight : 0) + 'px');
}

function paintReadbar(panel) {
  const max = panel.scrollHeight - panel.clientHeight;
  const pct = max > 40 ? Math.min(100, (panel.scrollTop / max) * 100) : 0;
  $('readbar').firstElementChild.style.width = pct + '%';
}

/* --------------------------------------------------------------- toasting */

let toastTimer = 0;
export function toast(msg, undo) {
  const t = $('toast');
  t.innerHTML = '';
  t.appendChild(document.createTextNode(msg));
  if (undo) {
    const b = el('button', 'btn btn-quiet', 'Undo');
    b.style.cssText = 'margin-left:12px;padding:5px 12px;min-height:0;font-size:.82rem';
    b.addEventListener('click', () => { t.hidden = true; undo(); });
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 6000 : 2600);
}

export function confirmBox({ title, body, yes, danger, onYes }) {
  const box = $('confirm');
  box.innerHTML = '';
  const card = el('div', 'confirm-card');
  card.appendChild(el('h3', null, esc(title)));
  card.appendChild(el('p', null, esc(body)));
  const btns = el('div', 'confirm-btns');
  const no = el('button', 'btn btn-quiet', 'Cancel');
  const ok = el('button', 'btn', esc(yes || 'OK'));
  if (danger) ok.style.cssText = 'background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)';
  btns.append(no, ok);
  card.appendChild(btns);
  box.appendChild(card);
  box.hidden = false;
  const close = () => { box.hidden = true; };
  no.addEventListener('click', close);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  ok.addEventListener('click', () => { close(); onYes(); });
  ok.focus();
}

/* ------------------------------------------------------------------- peek */
/* Hold any row and read it right there. This is the gesture worth keeping —
   it is faster than opening the article and coming back, and it means the
   feed is browsable without ever leaving. */

let peekEl = null;

export function closePeek() {
  if (!peekEl) return;
  peekEl.remove();
  peekEl = null;
  document.removeEventListener('pointerdown', onOutside, true);
}

function onOutside(e) {
  if (peekEl && !peekEl.contains(e.target)) closePeek();
}

export function peek({ title, from, art, body, href, loading, actions }) {
  closePeek();
  const box = el('div', 'peek');
  const head = el('div', 'peek-head');
  head.appendChild(el('div', 't', esc(title)));
  const x = el('button', 'iconbtn', ICON.x);
  x.setAttribute('aria-label', 'Close');
  x.addEventListener('click', closePeek);
  head.appendChild(x);

  const content = el('div', 'peek-body');
  if (loading) content.appendChild(el('p', 'loading', 'Loading…'));
  else {
    if (art) {
      const img = el('img');
      img.src = art;
      img.alt = '';
      img.loading = 'lazy';
      content.appendChild(img);
    }
    if (from) content.appendChild(el('p', 'eyebrow', esc(from)));
    content.appendChild(el('p', null, esc(body || '')));
  }

  const foot = el('div', 'peek-foot');
  (actions || []).forEach((a) => foot.appendChild(a));
  if (href) {
    const open = el('a', 'btn', 'Read it ' + ICON.ext);
    open.href = safeHref(href);
    open.target = '_blank';
    open.rel = 'noopener';
    open.addEventListener('click', closePeek);
    foot.appendChild(open);
  }

  box.append(head, content, foot);
  document.body.appendChild(box);
  peekEl = box;
  setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
  return { box, content };
}

/* ------------------------------------------------------------------ sheet */

export function sheet(title, build) {
  const s = $('sheet');
  s.innerHTML = '';
  const scrim = el('div', 'sheet-scrim');
  const card = el('div', 'sheet-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', title);
  const head = el('div', 'sheet-head');
  head.appendChild(el('h2', null, esc(title)));
  const x = el('button', 'iconbtn', ICON.x);
  x.setAttribute('aria-label', 'Close');
  head.appendChild(x);
  const body = el('div', 'sheet-body');
  card.append(head, body);
  s.append(scrim, card);
  s.hidden = false;
  const close = () => { s.hidden = true; };
  x.addEventListener('click', close);
  scrim.addEventListener('click', close);
  build(body, close);
  return { body, close };
}

/* ----------------------------------------------------------------- player */
/* ONE <audio>. It is in the shell, not in a tab, so it keeps playing across
   every tab switch — which is the entire point of a listen tab in an app you
   are also reading. */

const audio = $('audio');
const player = $('player');
let currentKey = null;
let lastSave = 0;
let pendingSeek = 0;

export function playAudio({ src, title, show, art, key }) {
  if (!src) return;
  const k = key || src;
  if (audio.getAttribute('src') !== src) {
    audio.src = src;
    const at = store.heardAt(k);
    /* Safari throws on currentTime before the media is seekable, so set it
       now if it takes and again on loadedmetadata if it did not */
    pendingSeek = at > 30 ? at : 0;
    if (pendingSeek) { try { audio.currentTime = pendingSeek; } catch (e) { /* retried below */ } }
  }
  currentKey = k;
  $('p-title').textContent = title || '';
  $('p-show').textContent = show || '';
  const img = $('p-art');
  if (art) { img.src = art; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
  player.hidden = false;
  document.body.classList.add('has-player');
  audio.play().catch(() => {});
  closeVideo();
  if ('mediaSession' in navigator && window.MediaMetadata) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || '', artist: show || '', album: 'All Day',
        artwork: art ? [{ src: art, sizes: '512x512' }] : [],
      });
      navigator.mediaSession.setActionHandler('play', () => audio.play());
      navigator.mediaSession.setActionHandler('pause', () => audio.pause());
      navigator.mediaSession.setActionHandler('seekbackward', () => { audio.currentTime = Math.max(0, audio.currentTime - 15); });
      navigator.mediaSession.setActionHandler('seekforward', () => { audio.currentTime += 30; });
    } catch (e) { /* handler support varies */ }
  }
}

export const nowPlaying = () => currentKey;

audio.addEventListener('loadedmetadata', () => {
  if (pendingSeek && Math.abs(audio.currentTime - pendingSeek) > 2) {
    try { audio.currentTime = pendingSeek; } catch (e) { /* give up quietly */ }
  }
  pendingSeek = 0;
});
audio.addEventListener('timeupdate', () => {
  const now = Date.now();
  if (currentKey && now - lastSave >= 5000) {
    lastSave = now;
    store.setHeardAt(currentKey, audio.currentTime);
  }
  $('p-bar').firstElementChild.style.width =
    (audio.duration ? (audio.currentTime / audio.duration) * 100 : 0) + '%';
});
audio.addEventListener('ended', () => { if (currentKey) store.setHeardAt(currentKey, 0); });
audio.addEventListener('error', () => { if (audio.getAttribute('src')) toast('That episode would not load'); });

function paintPlayIcon() {
  $('p-toggle').innerHTML = audio.paused ? ICON.play : ICON.pause;
}
audio.addEventListener('play', paintPlayIcon);
audio.addEventListener('pause', paintPlayIcon);
$('p-toggle').addEventListener('click', () => { if (audio.paused) audio.play(); else audio.pause(); });
$('p-back').addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 15); });
$('p-close').addEventListener('click', () => {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  currentKey = null;
  player.hidden = true;
  document.body.classList.remove('has-player');
});

/* ------------------------------------------------------------------ video */

const YT_RE = /^[A-Za-z0-9_-]{11}$/;
let hintTimer = 0;

export const isVideoId = (id) => YT_RE.test(String(id || ''));

export function showVideo(id, title) {
  if (!YT_RE.test(id)) return;
  $('vbox-title').textContent = title || '';
  const frame = $('vbox-frame');
  frame.innerHTML = '';
  const f = document.createElement('iframe');
  f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1';
  f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  f.setAttribute('allowfullscreen', '');
  f.title = title || 'Video';
  frame.appendChild(f);
  $('vbox-open').href = 'https://www.youtube.com/watch?v=' + id;
  $('vbox-hint').hidden = true;
  $('vbox').hidden = false;
  audio.pause();
  /* embed blocking is invisible cross-origin, so the escape hatch just fades
     in after a few seconds rather than waiting for an error that never comes */
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { if (!$('vbox').hidden) $('vbox-hint').hidden = false; }, 3000);
}

export function closeVideo() {
  clearTimeout(hintTimer);
  $('vbox-frame').innerHTML = '';
  $('vbox').hidden = true;
}
$('vbox-close').addEventListener('click', closeVideo);
$('vbox').addEventListener('click', (e) => { if (e.target === $('vbox')) closeVideo(); });

/* ------------------------------------------------------------ fresh + stale */

let pendingFresh = [];

function applyFresh() {
  const q = pendingFresh;
  pendingFresh = [];
  $('fresh')?.remove();
  q.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
}

wire.setFreshGate((apply) => {
  const panel = active && $('panel-' + active);
  if (!panel || panel.scrollTop < 300) { apply(); return; }
  pendingFresh.push(apply);
  if ($('fresh')) return;
  const pill = el('button', 'fresh', '↑ Fresh');
  pill.id = 'fresh';
  pill.addEventListener('click', () => {
    applyFresh();
    $('panel-' + active)?.scrollTo({ top: 0 });
  });
  document.body.appendChild(pill);
});

wire.setStaleHandler((isStale) => {
  $('stale').hidden = !isStale;
  measureChrome();
});

/* ------------------------------------------------------------------- boot */

store.applyTheme(store.theme());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (store.theme() === 'auto') store.applyTheme('auto');
});

function paintThemeBtn() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
    (!document.documentElement.hasAttribute('data-theme') &&
      matchMedia('(prefers-color-scheme: dark)').matches);
  const b = $('theme-btn');
  b.innerHTML = dark ? ICON.sun : ICON.moon;
  b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}
paintThemeBtn();
$('theme-btn').addEventListener('click', () => {
  store.setTheme(store.nextTheme());
  paintThemeBtn();
});

let lastY = 0;
TABS.forEach((tab) => {
  const panel = $('panel-' + tab);
  if (!panel) return;
  panel.addEventListener('scroll', () => {
    const y = panel.scrollTop;
    const away = y > lastY && y > 90;
    document.body.classList.toggle('chrome-away', away);
    lastY = y;
    paintReadbar(panel);
    if ($('fresh') && y < 60) applyFresh();
  }, { passive: true });
});

document.querySelector('.tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const tab = b.dataset.tab;
  /* tapping the tab you are on goes home within it — out of an article,
     back to the top of a feed */
  if (active === tab) {
    if (tab === 'wander' && /^#wander\//.test(location.hash)) { go('wander'); return; }
    $('panel-' + tab)?.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  go(tab);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (peekEl) closePeek();
  else if (!$('vbox').hidden) closeVideo();
  else if (!$('confirm').hidden) $('confirm').hidden = true;
  else if (!$('sheet').hidden) $('sheet').hidden = true;
});

if ('ResizeObserver' in window) {
  const ro = new ResizeObserver(measureChrome);
  ro.observe(mast);
  new MutationObserver(() => {
    const nav = document.querySelector('.btnav');
    if (nav && !nav.dataset.measured) { nav.dataset.measured = '1'; ro.observe(nav); }
    measureChrome();
  }).observe(document.body, { childList: true });
}
window.addEventListener('resize', measureChrome);
window.addEventListener('load', measureChrome);
measureChrome();
paintPlayIcon();

window.addEventListener('hashchange', route);
export { route };
