/* All Boards — one screen, three channels, one clock.

   WATCH is Pulse Live, TABLE is Table Talk, ASK is Stay Awhile. Each runs in
   its own iframe exactly as it does on its own page (both boards in their
   ?tv=1 cut, Stay Awhile in its ?embed=1 cut), so nothing about them forks.
   This file only decides which one is on air and for how long.

   URL switches:
     ?start=watch|table|ask   which channel opens the show
     ?pace=relaxed|normal|lively
     ?stay=<url>              point ASK at another Stay Awhile (local testing) */
(function () {
  'use strict';

  var qs = new URLSearchParams(window.location.search);
  var STAY_BASE = qs.get('stay') || 'https://play.btownbrief.com/stay-awhile/';

  var CHANNELS = [
    { key: 'watch', label: 'Pulse Live',  src: 'live.html?tv=1&embed=1',  alone: 'live.html',  secs: 180 },
    { key: 'table', label: 'Table Talk',  src: 'table.html?tv=1&embed=1', alone: 'table.html', secs: 150 },
    { key: 'ask',   label: 'Stay Awhile', src: STAY_BASE + (STAY_BASE.indexOf('?') < 0 ? '?' : '&') + 'embed=1', alone: STAY_BASE, secs: 120 }
  ];
  var PACES = ['relaxed', 'normal', 'lively'];
  var PACE_FACTOR = { relaxed: 1.6, normal: 1, lively: 0.5 };
  var PACE_KEY = 'all-board-pace';

  var state = {
    i: 0,
    pace: 'normal',
    held: false,        // the viewer pressed LIVE to freeze the channel
    left: 0,            // seconds left on the current channel
    total: 0
  };

  var tabs = [].slice.call(document.querySelectorAll('.chan'));
  var screens = [].slice.call(document.querySelectorAll('.screen'));
  var badge = document.getElementById('live-badge');
  var badgeLabel = document.getElementById('live-badge-label');
  var holdNote = document.getElementById('hold-note');
  var paceBtn = document.getElementById('pace-btn');
  var openAlone = document.getElementById('open-alone');
  var announce = document.getElementById('announce');

  function savedPace() {
    try { return window.localStorage.getItem(PACE_KEY); } catch (e) { return null; }
  }
  function storePace(p) {
    try { window.localStorage.setItem(PACE_KEY, p); } catch (e) { /* private mode: fine */ }
  }

  function load(i) {
    var f = screens[i];
    if (!f.getAttribute('src')) f.setAttribute('src', CHANNELS[i].src);
  }

  function tell(i, action) {
    var f = screens[i];
    try { if (f.contentWindow) f.contentWindow.postMessage({ source: 'btown-all', action: action }, '*'); } catch (e) { /* not loaded yet */ }
  }

  function show(i, why) {
    state.i = (i + CHANNELS.length) % CHANNELS.length;
    var ch = CHANNELS[state.i];
    load(state.i);
    screens.forEach(function (f, k) { f.classList.toggle('on', k === state.i); });
    tabs.forEach(function (t, k) {
      t.setAttribute('aria-selected', String(k === state.i));
      t.tabIndex = k === state.i ? 0 : -1;
    });
    state.total = Math.round(ch.secs * PACE_FACTOR[state.pace]);
    state.left = state.total;
    paint();
    openAlone.href = ch.alone;
    openAlone.title = 'Open ' + ch.label + ' on its own';
    tell(state.i, 'show');               // Stay Awhile deals a fresh three when it comes on air
    if (why !== 'boot') announce.textContent = ch.label + ' is on.';
    // warm the next channel so the change is a fade, not a load
    window.setTimeout(function () { load((state.i + 1) % CHANNELS.length); }, 4000);
  }

  function paint() {
    var t = tabs[state.i];
    t.style.setProperty('--left', state.total ? (state.left / state.total).toFixed(4) : '1');
  }

  function setHeld(h) {
    state.held = h;
    badge.setAttribute('aria-pressed', String(h));
    badgeLabel.textContent = h ? 'HELD' : 'LIVE';
    holdNote.hidden = !h;
  }

  function tick() {
    if (state.held || document.hidden) return;
    state.left -= 1;
    if (state.left <= 0) { show(state.i + 1); return; }
    paint();
  }

  /* ---------- controls ---------- */
  tabs.forEach(function (t, k) {
    t.addEventListener('click', function () { show(k); });
  });
  document.getElementById('next-btn').addEventListener('click', function () { show(state.i + 1); });
  badge.addEventListener('click', function () { setHeld(!state.held); });
  paceBtn.addEventListener('click', function () {
    state.pace = PACES[(PACES.indexOf(state.pace) + 1) % PACES.length];
    storePace(state.pace);
    paceBtn.textContent = state.pace.toUpperCase();
    var ch = CHANNELS[state.i];
    var frac = state.total ? state.left / state.total : 1;
    state.total = Math.round(ch.secs * PACE_FACTOR[state.pace]);
    state.left = Math.max(5, Math.round(state.total * frac));
    paint();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { show(state.i + 1); }
    else if (e.key === 'ArrowLeft') { show(state.i - 1); }
    else if (e.key === ' ' && e.target === document.body) { e.preventDefault(); setHeld(!state.held); }
  });

  /* Someone reaching into a channel (a tap inside the iframe moves focus there)
     means they want to stay on it. The page can't see clicks across origins,
     but it can see its own window lose focus to one of its frames. */
  window.addEventListener('blur', function () {
    window.setTimeout(function () {
      var a = document.activeElement;
      if (a && a.tagName === 'IFRAME' && !state.held) setHeld(true);
    }, 0);
  });

  /* ---------- boot ---------- */
  var p = qs.get('pace') || savedPace();
  if (PACES.indexOf(p) >= 0) state.pace = p;
  paceBtn.textContent = state.pace.toUpperCase();
  var startKey = qs.get('start');
  var startAt = 0;
  CHANNELS.forEach(function (c, k) { if (c.key === startKey) startAt = k; });
  show(startAt, 'boot');
  window.setInterval(tick, 1000);
})();
