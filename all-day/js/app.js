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
const TABS = ['wire', 'reddit', 'watch', 'listen', 'whatnow',
              'music', 'photos', 'ig', 'wander'];

const registry = Object.create(null);
let active = null;
const mounted = Object.create(null);

export function register(tab, mod) { registry[tab] = mod; }

/* ------------------------------------------------------------------ hash */

function parseHash() {
  const h = location.hash.replace(/^#/, '');
  /* any tab can carry a /param now — wander opens an article, wire and
     watch jump to a shared card; the rest just land on the tab */
  const m = h.match(/^([a-z]+)\/(.+)$/);
  if (m && TABS.includes(m[1])) {
    /* a shared link can carry broken percent-encoding, and an uncaught
       URIError here would take the whole router down */
    let param;
    try { param = decodeURIComponent(m[2]); } catch (e) { param = m[2]; }
    return { tab: m[1], param };
  }
  return { tab: TABS.includes(h) ? h : 'wire', param: null };
}

/* ------------------------------------------------------------------ share */
/* One card, one link. The URL is this app with the tab and the card's key in
   the hash, so a text from a neighbour lands the reader inside All Day rather
   than on YouTube or an outlet's site. Native share sheet where phones have
   one; the clipboard everywhere else. */
export function share(tab, key, title) {
  const url = 'https://guide.btownbrief.com/all-day/#' + tab +
    (key ? '/' + encodeURIComponent(key) : '');
  if (window.goatcounter && window.goatcounter.count) {
    window.goatcounter.count({ path: 'all-day-share-' + tab,
                               title: 'All Day share: ' + tab, event: true });
  }
  if (navigator.share) {
    navigator.share({ title: title || 'All Day — Burlington Brief', url }).catch(() => {});
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url)
      .then(() => toast('Link copied'), () => toast('Couldn’t copy the link'));
  } else {
    toast('Couldn’t copy the link');
  }
}

/* Scroll a shared-in card into view and let it glow once. Returns whether the
   key was found, so the caller can say something honest when it wasn't. */
export function flashHit(root, key) {
  const hit = [...root.querySelectorAll('[data-k]')].find((n) => n.dataset.k === key);
  if (!hit) return false;
  requestAnimationFrame(() => {
    hit.scrollIntoView({ block: 'center' });
    hit.classList.add('shared-hit');
    setTimeout(() => hit.classList.remove('shared-hit'), 2600);
  });
  return true;
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
  const switched = active !== tab;
  active = tab;
  registry[tab]?.activate?.(param, first);
  store.touchVisit();

  /* Which feeds people actually live in. GoatCounter events, one per tab
     LANDING (first paint or a real switch, never a same-tab re-route), so
     the dashboard reads as "times a tab was opened". count.js loads async
     and ad blockers eat it — the guard means tracking can never break the
     app. */
  if ((switched || first) && window.goatcounter && window.goatcounter.count) {
    window.goatcounter.count({
      path: 'all-day-tab-' + tab,
      title: 'All Day tab: ' + tab,
      event: true,
    });
  }
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
  /* The bar arriving changes what sits behind the iOS clock, which changes
     the colour that keeps the clock readable. */
  store.paintStatusBar();
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
  /* a property, not addEventListener — the box is persistent and every
     confirm would otherwise stack one more listener on it forever */
  box.onclick = (e) => { if (e.target === box) close(); };
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

/* The one open sheet's close(), so Escape and a sheet-over-sheet both run the
   real teardown. Hiding the container instead of closing it strands
   body.sheet-open (which hides the tab bar) and skips the caller's onClose. */
let sheetClose = null;

export function sheet(title, build, onClose) {
  if (sheetClose) sheetClose();
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
  document.body.classList.add('sheet-open');
  /* Emptying it is not tidiness. A sheet can hold a cross-origin iframe — the
     Bandcamp player on an artist — and hiding its container does not stop the
     music. Only removing the node does. Closing a sheet therefore destroys
     what was in it, and any teardown the caller registered runs first. */
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (sheetClose === close) sheetClose = null;
    s.hidden = true;
    document.body.classList.remove('sheet-open');
    /* empty BEFORE onClose: an onClose that opens another sheet would
       otherwise build into `s` and be wiped when this close resumed */
    s.innerHTML = '';
    if (onClose) { try { onClose(); } catch (e) { /* never block the close */ } }
  };
  sheetClose = close;
  x.addEventListener('click', close);
  scrim.addEventListener('click', close);
  build(body, close);
  return { body, close };
}

/* ----------------------------------------------------------------- player */
/* ONE <audio>. It is in the shell, not in a tab, so it keeps playing across
   every tab switch — which is the entire point of a listen tab in an app you
   are also reading.

   It is also the only sound in this app we actually control. A Bandcamp embed
   and a YouTube embed are cross-origin iframes: they cannot be asked what they
   are doing and they cannot be told to pause. So the rule is one-way and
   absolute — anything that can make a noise registers a stop function here,
   and when this player starts, all of them are torn down. Two players running
   at once is the one thing a music app may never do. */

const audio = $('audio');
const player = $('player');
let currentKey = null;
let currentItem = null;
let lastSave = 0;
let pendingSeek = 0;

const foreign = new Set();
export function registerForeign(stop) {
  foreign.add(stop);
  return () => foreign.delete(stop);
}
export function silenceForeign() {
  foreign.forEach((stop) => { try { stop(); } catch (e) { /* already gone */ } });
}

const RATE_KEY = 'allday-rate';
const RATES = [1, 1.25, 1.5, 1.75, 2];
const rate = () => {
  const r = Number(store.read(RATE_KEY, 1));
  return RATES.indexOf(r) === -1 ? 1 : r;
};

const two = (n) => (n < 10 ? '0' : '') + n;
function clock(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  return h ? h + ':' + two(m) + ':' + two(s) : m + ':' + two(s);
}

/* Every play button anywhere in the app carries data-pk="<key>" and the shell
   paints it. A tab gets the playing state for free, and — the part that was
   actually broken — a button pressed inside a sheet becomes a pause the
   instant the audio starts, whether or not the dock is visible behind it. */
export function paintPlayButtons() {
  const live = currentKey && !audio.paused;
  document.querySelectorAll('[data-pk]').forEach((b) => {
    const on = !!live && b.dataset.pk === currentKey;
    if (b.classList.contains('is-playing') === on) return;
    b.classList.toggle('is-playing', on);
    b.innerHTML = on ? ICON.pause : ICON.play;
  });
}

function paintMeta() {
  const it = currentItem || {};
  $('p-title').textContent = it.title || '';
  $('p-show').textContent = it.show || '';
  const img = $('p-art');
  if (it.art) { img.src = it.art; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
}

export function playAudio(item) {
  const { src, title, show, art, key, href } = item || {};
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
  currentItem = { src, title: title || '', show: show || '', art: art || '', key: k, href: href || '' };
  audio.playbackRate = rate();
  paintMeta();
  player.hidden = false;
  document.body.classList.add('has-player');
  silenceForeign();
  closeVideo();
  audio.play().catch(() => {});
  paintPlayButtons();
  paintNowPlaying();
  setMediaSession();
}

/* What a play button actually wants: press it on the thing already playing
   and it pauses, press it again and it picks up where it stopped. Calling
   playAudio twice used to just re-issue play() on a running element. */
export function toggleAudio(item) {
  const k = (item && (item.key || item.src)) || '';
  if (k && k === currentKey && audio.getAttribute('src')) {
    if (audio.paused) { silenceForeign(); audio.play().catch(() => {}); } else { audio.pause(); }
    paintPlayButtons();
    return;
  }
  playAudio(item);
}

export const nowPlaying = () => currentKey;
export const isPlaying = () => !!currentKey && !audio.paused;
/* for a foreign player that has just started and cannot be listened to */
export function pauseAudio() { if (!audio.paused) audio.pause(); }

function setMediaSession() {
  if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
  const it = currentItem || {};
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: it.title || '', artist: it.show || '', album: 'All Day',
      artwork: it.art ? [{ src: it.art, sizes: '512x512' }] : [],
    });
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('seekbackward', () => back(15));
    navigator.mediaSession.setActionHandler('seekforward', () => fwd(30));
    /* the lock screen draws its own scrubber, but only if it is told where in
       the track we are — without this it shows a dead bar on an hour-long set */
    navigator.mediaSession.setActionHandler('seekto', (d) => {
      if (d && d.seekTime != null) { try { audio.currentTime = d.seekTime; } catch (e) { /* ignore */ } }
    });
  } catch (e) { /* handler support varies */ }
}

function setPositionState() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!audio.duration || !isFinite(audio.duration)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(audio.currentTime, audio.duration),
    });
  } catch (e) { /* Safari throws on a rate it does not like */ }
}

const back = (n) => { audio.currentTime = Math.max(0, audio.currentTime - n); };
const fwd = (n) => {
  const d = isFinite(audio.duration) ? audio.duration : Infinity;
  audio.currentTime = Math.min(d, audio.currentTime + n);
};

audio.addEventListener('loadedmetadata', () => {
  if (pendingSeek && Math.abs(audio.currentTime - pendingSeek) > 2) {
    try { audio.currentTime = pendingSeek; } catch (e) { /* give up quietly */ }
  }
  pendingSeek = 0;
  paintProgress();
  setPositionState();
});

function paintProgress() {
  const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  $('p-bar').firstElementChild.style.width = pct + '%';
  $('p-time').textContent = audio.duration
    ? clock(audio.currentTime) + ' / ' + clock(audio.duration)
    : clock(audio.currentTime);
  paintNowPlaying();
}

audio.addEventListener('timeupdate', () => {
  const now = Date.now();
  if (currentKey && now - lastSave >= 5000) {
    lastSave = now;
    store.setHeardAt(currentKey, audio.currentTime);
    setPositionState();
  }
  paintProgress();
});
audio.addEventListener('ended', () => { if (currentKey) store.setHeardAt(currentKey, 0); });
audio.addEventListener('error', () => { if (audio.getAttribute('src')) toast('That episode would not load'); });

function paintPlayIcon() {
  $('p-toggle').innerHTML = audio.paused ? ICON.play : ICON.pause;
  paintPlayButtons();
  paintNowPlaying();
}
audio.addEventListener('play', () => { silenceForeign(); paintPlayIcon(); });
audio.addEventListener('pause', paintPlayIcon);
audio.addEventListener('ratechange', setPositionState);

$('p-toggle').addEventListener('click', () => {
  if (audio.paused) { silenceForeign(); audio.play().catch(() => {}); } else { audio.pause(); }
});
$('p-back').addEventListener('click', () => back(15));
$('p-fwd').addEventListener('click', () => fwd(30));
function closePlayer() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  currentKey = null;
  currentItem = null;
  player.hidden = true;
  document.body.classList.remove('has-player');
  paintPlayButtons();
}
$('p-close').addEventListener('click', closePlayer);

/* ------------------------------------------------------------------ scrub */
/* The bar was two pixels of decoration. It is a control now: the strip across
   the top of the player is 14px of hit area drawing a 3px line, and it takes
   a drag, a tap and the arrow keys. An hour-long session is unusable without
   it — which is what "there is no way to skip forward" actually meant. */

function bindScrub(bar) {
  let scrubbing = false;
  const seek = (e) => {
    if (!audio.duration || !isFinite(audio.duration)) return;
    const r = bar.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)));
    audio.currentTime = p * audio.duration;
    paintProgress();
  };
  bar.addEventListener('pointerdown', (e) => {
    if (!audio.duration) return;
    scrubbing = true;
    bar.classList.add('scrubbing');
    try { bar.setPointerCapture(e.pointerId); } catch (err) { /* older Safari */ }
    seek(e);
    e.preventDefault();
    e.stopPropagation();
  });
  bar.addEventListener('pointermove', (e) => { if (scrubbing) seek(e); });
  const stop = (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    bar.classList.remove('scrubbing');
    try { bar.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  };
  bar.addEventListener('pointerup', stop);
  bar.addEventListener('pointercancel', stop);
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { fwd(e.shiftKey ? 60 : 15); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { back(e.shiftKey ? 60 : 15); e.preventDefault(); }
    else if (e.key === ' ' || e.key === 'Enter') {
      if (audio.paused) audio.play().catch(() => {}); else audio.pause();
      e.preventDefault();
    }
  });
}
bindScrub($('p-bar'));

/* ------------------------------------------------------------ now playing */
/* The dock row is a handle, not the player. Tapping it opens the thing you
   actually want on an hour-long recording: a bar wide enough to aim at, a
   readable clock, and a speed control. */

let npBody = null;

function npRow(label, onClick, cls) {
  const b = el('button', cls || 'np-btn', label);
  b.addEventListener('click', onClick);
  return b;
}

export function openNowPlaying() {
  if (!currentItem) return;
  sheet('Now playing', (body, close) => {
    npBody = body;
    const it = currentItem;
    const head = el('div', 'np-head');
    if (it.art) {
      const img = el('img', 'np-art');
      img.src = it.art; img.alt = ''; img.referrerPolicy = 'no-referrer';
      head.appendChild(img);
    }
    const meta = el('div', 'np-meta');
    meta.appendChild(el('h3', 'np-title', esc(it.title)));
    if (it.show) meta.appendChild(el('p', 'np-show', esc(it.show)));
    head.appendChild(meta);
    body.appendChild(head);

    const bar = el('div', 'np-bar');
    bar.id = 'np-bar';
    bar.setAttribute('role', 'slider');
    bar.setAttribute('aria-label', 'Seek');
    bar.tabIndex = 0;
    bar.appendChild(el('i'));
    body.appendChild(bar);
    bindScrub(bar);

    const times = el('div', 'np-times');
    times.innerHTML = '<span id="np-at"></span><span id="np-left"></span>';
    body.appendChild(times);

    const row = el('div', 'np-transport');
    row.appendChild(npRow(ICON.back15 + '<span>15</span>', () => back(15), 'np-btn np-skip'));
    const toggle = npRow('', () => {
      if (audio.paused) { silenceForeign(); audio.play().catch(() => {}); } else { audio.pause(); }
    }, 'np-btn np-big');
    toggle.id = 'np-toggle';
    row.appendChild(toggle);
    const f = npRow(ICON.back15 + '<span>30</span>', () => fwd(30), 'np-btn np-skip np-flip');
    row.appendChild(f);
    body.appendChild(row);

    const foot = el('div', 'np-foot');
    const speed = npRow('', () => {
      const next = RATES[(RATES.indexOf(rate()) + 1) % RATES.length];
      store.write(RATE_KEY, next);
      audio.playbackRate = next;
      paintNowPlaying();
    }, 'np-btn np-rate');
    speed.id = 'np-rate';
    foot.appendChild(speed);
    if (it.href) {
      const open = el('a', 'np-btn np-open', 'Open ' + ICON.ext);
      open.href = safeHref(it.href);
      open.target = '_blank';
      open.rel = 'noopener';
      foot.appendChild(open);
    }
    /* the dock drops its close button under 360px, so the way out of a
       playing session has to exist here too */
    const stop = npRow(ICON.x, () => { closePlayer(); close(); }, 'np-btn np-stop');
    stop.setAttribute('aria-label', 'Close the player');
    foot.appendChild(stop);
    body.appendChild(foot);
    paintNowPlaying();
  }, () => { npBody = null; });
}

function paintNowPlaying() {
  if (!npBody || !npBody.isConnected) { npBody = null; return; }
  const at = npBody.querySelector('#np-at');
  const left = npBody.querySelector('#np-left');
  const bar = npBody.querySelector('#np-bar');
  const toggle = npBody.querySelector('#np-toggle');
  const speed = npBody.querySelector('#np-rate');
  if (at) at.textContent = clock(audio.currentTime);
  if (left) left.textContent = audio.duration ? '-' + clock(audio.duration - audio.currentTime) : '';
  if (bar) bar.firstElementChild.style.width =
    (audio.duration ? (audio.currentTime / audio.duration) * 100 : 0) + '%';
  if (toggle) toggle.innerHTML = audio.paused ? ICON.play : ICON.pause;
  if (speed) speed.textContent = rate() + '×';
}

$('p-open').addEventListener('click', openNowPlaying);

/* -------------------------------------------------------------------- jar */
/* One control, two errands, because they are the same errand: this is a page
   built by one person, and it gets better either by being told what is
   missing or by being paid for. Splitting those into a feedback form and a
   donate button would put two asks on every tab; this is one.

   It lives beside the Local switch because that is the one control already on
   every tab, in the same place, above the content — the spot a reader's eye
   has already learned. */

const SB = 'https://jnouvwxomrcffqwilqkq.supabase.co';
const SB_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3';
const KOFI = 'https://ko-fi.com/btownbrief';

/* What the jar asks depends on where you opened it — "what should be on the
   music tab" gets a useful answer where "any feedback?" gets silence. */
const JAR_ASK = {
  wire: 'An outlet I should be pulling from? A story the wire keeps missing?',
  reddit: 'A subreddit worth watching, or one that should go?',
  watch: 'A channel worth watching, or a video that should have been tonight’s pick?',
  listen: 'A podcast that should be on here?',
  music: 'A band, a venue, a night I have missed? This one especially — the roster is only as good as who tells me about it.',
  photos: 'A spot worth shooting, or a photo you want on the wall?',
  ig: 'An account I should be following?',
  wander: 'Something about Burlington that belongs in here?',
  whatnow: 'Something to do that I never suggest?',
};

function rpc(fn, args) {
  return fetch(SB + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  }).then((r) => (r.ok ? r.text().then((t) => (t ? JSON.parse(t) : true)) : null))
    .catch(() => null);
}

export function openJar(tab) {
  const where = tab || active || '';
  sheet('The jar', (body, close) => {
    body.appendChild(el('p', 'jar-lede',
      'Two things in one, because they are the same thing. Tell me what is ' +
      'missing, or chip in — both make this better.'));

    const form = el('form', 'jar-form');
    form.innerHTML =
      '<label>What should be on here?' +
        '<textarea name="text" rows="4" maxlength="600" required placeholder="' +
        esc(JAR_ASK[where] || 'Anything missing, wrong, or worth adding.') +
        '"></textarea></label>' +
      '<label class="jar-who">Your name or email, if you want an answer' +
        '<input type="text" name="who" maxlength="120" placeholder="Optional"></label>' +
      '<p class="jar-err" hidden></p>' +
      '<button class="btn btn-big" type="submit">Put it in the jar</button>';

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const text = (f.get('text') || '').toString().trim();
      const err = form.querySelector('.jar-err');
      if (text.length < 4) { err.textContent = 'A few more words than that.'; err.hidden = false; return; }
      err.hidden = true;
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      rpc('ad_suggest', {
        p_text: text,
        p_who: (f.get('who') || '').toString().trim(),
        p_tab: where,
        p_sender: store.playerId(),
      }).then((okay) => {
        /* ad_suggest returns false on a server-side reject (rate limit,
           validation) and null when the call itself failed — neither is a
           success, and closing would throw away what they typed */
        if (!okay) {
          btn.disabled = false;
          btn.textContent = 'Put it in the jar';
          err.textContent = 'That didn’t send — try again in a minute.';
          err.hidden = false;
          return;
        }
        close();
        toast('In the jar. Thank you — I read all of them.');
      });
    });
    body.appendChild(form);

    /* The tip half. It says who is behind this because that is the honest
       reason to chip in: it is not a company with a team. */
    const tip = el('div', 'jar-tip');
    tip.innerHTML =
      '<p class="jar-tip-lede">All of this — the guide, the arcade, the feed, the ' +
      'newsletter — is <b>one person</b> in Burlington. No staff, no investors, no ads. ' +
      'A coffee genuinely keeps it going.</p>';
    const kofi = el('a', 'btn jar-kofi', 'Chip in on Ko-fi ' + ICON.ext);
    kofi.href = KOFI;
    kofi.target = '_blank';
    kofi.rel = 'noopener';
    tip.appendChild(kofi);
    body.appendChild(tip);

    body.appendChild(el('p', 'jar-fine',
      'No promises. Most suggestions do not make it on, and I cannot answer ' +
      'every one. I do read every one.'));
  });
}

/* The button itself. Modes get it from here rather than from ui.js, because
   ui.js is imported BY this file — a jar that lived there would have to
   import back and close the loop. */
export function jarBtn(tab) {
  const b = el('button', 'jarbtn', ICON.jar + '<span>Jar</span>');
  b.setAttribute('aria-label', 'Suggestion jar and tip jar');
  b.title = 'Suggestions and tips';
  b.addEventListener('click', () => openJar(tab));
  return b;
}

/* For the tabs with no Local switch to sit beside. */
export function jarRow(host, tab) {
  const row = el('div', 'jarrow');
  row.appendChild(jarBtn(tab));
  host.appendChild(row);
  return row;
}

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
  silenceForeign();
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
/* Settings changes the theme too, and announces it with this event —
   without a listener the mast's moon/sun shows the previous state. */
window.addEventListener('allday-theme', paintThemeBtn);

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
  else if (!$('sheet').hidden) {
    if (sheetClose) sheetClose(); else $('sheet').hidden = true;
  }
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
