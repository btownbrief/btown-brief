/* player.js — one audio element, owned by the shell.

   This is the single strongest argument for the app existing at all. On
   listen.html the <audio> lives inside the page, stores nothing, and stops
   the moment you go anywhere. Here it sits above the tab bar, outside every
   pane, so an episode keeps playing while you read Reddit and wander through
   Wikipedia — and it remembers where you were in it.

   The Media Session bindings are what make it feel native: artwork, title and
   working controls on the lock screen and in the car. */

import { heardAt, setHeard, keyOf } from './store.js';
import { esc, secsToClock } from './ui.js';

const PLAY_ICON = '<path d="M8 5.2l11 6.8-11 6.8z"/>';
const PAUSE_ICON = '<rect x="7" y="5" width="3.6" height="14" rx="1"/><rect x="13.4" y="5" width="3.6" height="14" rx="1"/>';

let el = {};
let current = null;   // { key, src, title, sub, art, pageUrl }
let saveTimer = 0;
const listeners = new Set();

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => { try { fn(current); } catch (e) { /* one bad listener */ } }); }

export function nowPlaying() { return current; }

export function init() {
  el = {
    audio: document.getElementById('audio'),
    bar: document.getElementById('player'),
    art: document.getElementById('player-art'),
    artFallback: document.getElementById('player-art-fallback'),
    t: document.getElementById('player-t'),
    s: document.getElementById('player-s'),
    seek: document.getElementById('player-bar'),
    fill: document.getElementById('player-fill'),
    toggle: document.getElementById('player-toggle'),
    icon: document.getElementById('player-icon'),
    back: document.getElementById('player-back'),
    close: document.getElementById('player-close'),
  };

  el.toggle.addEventListener('click', toggle);
  el.close.addEventListener('click', stop);
  el.back.addEventListener('click', () => nudge(-15));

  el.seek.addEventListener('click', (e) => {
    const r = el.seek.getBoundingClientRect();
    seekTo(((e.clientX - r.left) / r.width) * (el.audio.duration || 0));
  });
  el.seek.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { nudge(15); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { nudge(-15); e.preventDefault(); }
  });

  el.audio.addEventListener('timeupdate', paint);
  el.audio.addEventListener('durationchange', paint);
  el.audio.addEventListener('play', () => { setIcon(true); emit(); });
  el.audio.addEventListener('pause', () => { setIcon(false); remember(); emit(); });
  el.audio.addEventListener('ended', () => { remember(); stop(); });
  el.audio.addEventListener('error', () => {
    if (!current) return;
    el.s.textContent = 'COULD NOT PLAY THIS ONE';
  });

  // A phone can kill the tab without warning; write the position on the way out.
  document.addEventListener('visibilitychange', () => { if (document.hidden) remember(); });
  window.addEventListener('pagehide', remember);

  saveTimer = setInterval(remember, 10000);
  bindMediaSession();
}

/* play({ key?, src, title, sub, art, pageUrl }) — key defaults to a hash of
   the audio URL, which is what the resume points are filed under. */
export function play(item) {
  const src = item && item.src;
  if (!src) return;
  const key = item.key || keyOf(src);

  if (current && current.key === key) { toggle(); return; }

  current = {
    key,
    src,
    title: item.title || '',
    sub: item.sub || '',
    art: item.art || '',
    pageUrl: item.pageUrl || '',
  };

  el.audio.src = src;
  el.t.textContent = current.title;
  el.s.textContent = (current.sub || '').toUpperCase();
  el.fill.style.width = '0%';

  if (current.art) {
    el.art.src = current.art;
    el.art.hidden = false;
    el.artFallback.hidden = true;
  } else {
    el.art.hidden = true;
    el.art.removeAttribute('src');
    el.artFallback.hidden = false;
  }

  el.bar.hidden = false;
  document.documentElement.style.setProperty('--dock', '117px');

  /* Order matters. The element is preload="none", so nothing is fetched until
     play() is called — waiting for loadedmetadata first deadlocks, because
     that event can never fire. Call play() immediately, while the user's tap
     is still the active gesture, and apply the resume point once metadata
     actually arrives (currentTime is not settable before then). */
  const resume = heardAt(key);
  if (resume > 5) {
    el.audio.addEventListener('loadedmetadata', () => {
      try { el.audio.currentTime = resume; } catch (e) { /* not seekable */ }
    }, { once: true });
  }
  el.audio.play().catch(() => { setIcon(false); });

  setMetadata();
  emit();
}

export function toggle() {
  if (!current) return;
  if (el.audio.paused) el.audio.play().catch(() => {});
  else el.audio.pause();
}

export function stop() {
  remember();
  el.audio.pause();
  el.audio.removeAttribute('src');
  el.audio.load();
  el.bar.hidden = true;
  document.documentElement.style.setProperty('--dock', '60px');
  current = null;
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  emit();
}

function nudge(by) {
  if (!current) return;
  seekTo((el.audio.currentTime || 0) + by);
}

function seekTo(t) {
  if (!current || !isFinite(t)) return;
  const d = el.audio.duration || 0;
  try { el.audio.currentTime = Math.max(0, Math.min(d ? d - 1 : t, t)); } catch (e) { /* not seekable */ }
  paint();
}

function setIcon(playing) {
  el.icon.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  el.toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

function paint() {
  if (!current) return;
  const d = el.audio.duration || 0;
  const t = el.audio.currentTime || 0;
  const pct = d ? (t / d) * 100 : 0;
  el.fill.style.width = pct.toFixed(2) + '%';
  el.seek.setAttribute('aria-valuenow', String(Math.round(pct)));
  if (d) {
    const left = Math.max(0, d - t);
    el.s.textContent = ((current.sub ? current.sub + ' · ' : '') +
      secsToClock(left) + ' left').toUpperCase();
  }
}

function remember() {
  if (!current || !el.audio) return;
  const t = el.audio.currentTime || 0;
  if (t > 5) setHeard(current.key, t, el.audio.duration || 0);
}

/* ------------------------------------------------------- media session */

function setMetadata() {
  if (!('mediaSession' in navigator) || !current) return;
  try {
    const art = current.art
      ? [{ src: current.art, sizes: '512x512', type: 'image/jpeg' }]
      : [{ src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png' }];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.sub,
      album: 'All Day — Btown Brief',
      artwork: art,
    });
  } catch (e) { /* MediaMetadata is not everywhere */ }
}

function bindMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const set = (action, fn) => {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch (e) { /* unsupported action */ }
  };
  set('play', () => el.audio.play().catch(() => {}));
  set('pause', () => el.audio.pause());
  set('seekbackward', (d) => nudge(-(d && d.seekOffset ? d.seekOffset : 15)));
  set('seekforward', (d) => nudge(d && d.seekOffset ? d.seekOffset : 30));
  set('seekto', (d) => { if (d && d.seekTime != null) seekTo(d.seekTime); });
  set('stop', stop);
}

export function isPlaying(key) {
  return !!(current && current.key === key && el.audio && !el.audio.paused);
}

export function isLoaded(key) {
  return !!(current && current.key === key);
}

/* A one-line "resume from 12:04" tag for an episode row. */
export function resumeLabel(key) {
  const t = heardAt(key);
  return t > 30 ? 'RESUME ' + secsToClock(t) : '';
}

export { esc };
