/* Currents — the shell: hash router, tab lifecycle, per-tab scroll memory,
   the one <audio> element, the video embedbox, the saved drawer.

   Boot order matters. shell.js defines Currents.boot() but does NOT call it:
   the tab modules register themselves as they load, and index.html calls
   boot() from an inline script AFTER the last one. Routing before that
   point would find an empty registry and mount nothing.

   State keys are all currents-* — pulse's own pulse2-* keys are not ours
   to touch. Every read/write is wrapped: Safari private mode throws on
   localStorage.                                                            */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var TABS = ['pulse', 'reddit', 'watch', 'listen', 'read'];
  var VISIT_GAP = 1800000;                 /* 30 min of quiet starts a new visit */
  var registry = {}, mounted = {}, active = null, booted = false;

  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, val);
    } catch (e) { return null; }
  }
  function storeJSON(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }
  function stateKey(k) { return 'currents-' + k; }

  function parseHash() {
    var h = location.hash.replace(/^#/, '');
    var m = h.match(/^read\/(.+)$/);
    if (m) return { tab: 'read', param: decodeURIComponent(m[1]) };
    if (TABS.indexOf(h) === -1) h = 'pulse';
    return { tab: h, param: null };
  }

  /* the baseline for "new since you last looked": touched on every
     activation so a reload does not reset it, restarted after 30 min away */
  function touchVisit() {
    var now = Date.now();
    var last = parseInt(store(stateKey('visit-last')) || '0', 10);
    if (!last || now - last > VISIT_GAP) store(stateKey('visit-base'), String(last || now));
    store(stateKey('visit-last'), String(now));
  }
  window.Currents.visitBase = function () {
    return parseInt(store(stateKey('visit-base')) || '0', 10) || 0;
  };

  function activate(tab, param) {
    if (TABS.indexOf(tab) === -1) tab = 'pulse';
    var panel = $('panel-' + tab);
    if (!panel) return;
    if (active && active !== tab) {
      var prev = $('panel-' + active);
      if (prev) store(stateKey('scroll-' + active), String(prev.scrollTop));
      if (registry[active] && registry[active].deactivate) registry[active].deactivate();
      if (prev) prev.hidden = true;
    }
    var first = !mounted[tab];
    if (first && registry[tab]) { mounted[tab] = true; registry[tab].mount(panel); }
    panel.hidden = false;
    document.querySelectorAll('.tabbar .tab').forEach(function (t) {
      var on = t.dataset.tab === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (active !== tab) {
      panel.scrollTop = parseInt(store(stateKey('scroll-' + tab)) || '0', 10) || 0;
      mast.classList.remove('mast-hidden');
      document.body.classList.remove('chrome-hidden');
    }
    active = tab;
    store(stateKey('tab'), tab);
    if (registry[tab] && registry[tab].activate) registry[tab].activate(param, first);
    touchVisit();
  }

  function onHash() { var r = parseHash(); activate(r.tab, r.param); }
  window.addEventListener('hashchange', onHash);

  window.Currents.register = function (tab, mod) {
    registry[tab] = mod;
    /* a module that loads late (or is re-registered) still gets mounted */
    if (booted && active === tab && !mounted[tab]) {
      mounted[tab] = true;
      mod.mount($('panel-' + tab));
      if (mod.activate) mod.activate(parseHash().param, true);
    }
  };
  window.Currents.boot = function () {
    if (booted) return;
    booted = true;
    onHash();
  };
  window.Currents.activeTab = function () { return active; };
  window.Currents.activePanel = function () { return active ? $('panel-' + active) : null; };
  window.Currents.go = function (tab, param) {
    var next = param ? tab + '/' + encodeURIComponent(param) : tab;
    if (location.hash.replace(/^#/, '') === next) onHash();
    else location.hash = next;
  };
  window.Currents.toast = function (msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.hidden = true; }, 2600);
  };
  window.Currents.store = store;
  window.Currents.storeJSON = storeJSON;
  window.Currents.stateKey = stateKey;
  /* Some feed titles arrive already HTML-escaped ("Top News &amp; Analysis"),
     so decode the handful of entities RSS actually produces before escaping
     — otherwise the ampersand renders as literal "&amp;". */
  var ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  window.Currents.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/g, function (m, name) {
        return ENTITY[name] || "'";
      })
      /* upstream truncation can cut an entity in half ("Top News &amp…") —
         drop the stub rather than render it */
      .replace(/&[a-zA-Z]{1,8}(\u2026|\.\.\.)\s*$/, '\u2026')
      .replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
  };
  window.Currents.ago = function (epochSeconds) {
    var mins = Math.round((Date.now() / 1000 - epochSeconds) / 60);
    if (!isFinite(mins) || mins < 0) return '';
    if (mins < 1) return 'now';
    if (mins < 60) return mins + 'm';
    if (mins < 1440) return Math.round(mins / 60) + 'h';
    return Math.round(mins / 1440) + 'd';
  };

  /* ---------- the mast: an overlay, so panels scroll under it ---------- */
  var mast = $('mast');
  function measureMast() {
    var root = document.documentElement;
    root.style.setProperty('--mast-h', mast.offsetHeight + 'px');
    /* nav.js is deferred and prepends its bar to body — it can arrive after
       first paint, and it wraps to two lines on a narrow phone, so measure
       rather than assume */
    var nav = document.querySelector('.btnav');
    root.style.setProperty('--nav-h', (nav ? nav.offsetHeight : 0) + 'px');
  }
  if ('ResizeObserver' in window) {
    var ro = new ResizeObserver(measureMast);
    ro.observe(mast);
    new MutationObserver(function () {
      var nav = document.querySelector('.btnav');
      if (nav && !nav._measured) { nav._measured = true; ro.observe(nav); }
      measureMast();
    }).observe(document.body, { childList: true });
  }
  window.addEventListener('resize', measureMast);
  window.addEventListener('load', measureMast);
  measureMast();

  /* scroll does not bubble — every panel gets its own listener */
  var lastY = 0;
  TABS.forEach(function (tab) {
    var panel = $('panel-' + tab);
    if (!panel) return;
    panel.addEventListener('scroll', function () {
      var y = panel.scrollTop;
      var away = y > lastY && y > 90;
      mast.classList.toggle('mast-hidden', away);
      document.body.classList.toggle('chrome-hidden', away);
      lastY = y;
      var pill = $('fresh-pill');
      if (pill && y < 60) applyFresh();
    }, { passive: true });
  });

  /* ---------- fresh payloads: never swap under a reader ---------- */
  var pendingFresh = [];
  function applyFresh() {
    var q = pendingFresh;
    pendingFresh = [];
    var pill = $('fresh-pill');
    if (pill) pill.remove();
    q.forEach(function (fn) { try { fn(); } catch (e) {} });
  }
  window.Currents.freshGate = function (apply) {
    var panel = active && $('panel-' + active);
    if (!panel || panel.scrollTop < 300) { apply(); return; }
    pendingFresh.push(apply);
    if ($('fresh-pill')) return;
    var pill = document.createElement('button');
    pill.className = 'fresh-pill';
    pill.id = 'fresh-pill';
    pill.textContent = '↑ Fresh';
    pill.addEventListener('click', function () {
      applyFresh();
      var p = active && $('panel-' + active);
      if (p) p.scrollTo({ top: 0 });
    });
    document.body.appendChild(pill);
  };

  /* ---------- miniplayer: ONE <audio>, it survives every tab switch ---------- */
  var audio = $('mp-audio'), mp = $('miniplayer'), bar = mp.querySelector('.mp-progress i');
  var lastSave = 0;
  window.Currents.playAudio = function (ep) {
    if (!ep || !ep.src) return;
    var key = ep.key || ep.src;
    if (audio.getAttribute('src') !== ep.src) {
      audio.src = ep.src;
      var pos = parseFloat(store(stateKey('resume-' + key)) || '0');
      if (pos > 5) { try { audio.currentTime = pos; } catch (e) {} }
    }
    audio.dataset.key = key;
    $('mp-title').textContent = ep.title || '';
    $('mp-show').textContent = ep.show || '';
    var img = $('mp-art');
    if (ep.art) { img.src = ep.art; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
    $('mp-back').hidden = false;
    mp.hidden = false;
    document.body.classList.add('has-player');
    audio.play().catch(function () {});
    if ('mediaSession' in navigator && window.MediaMetadata) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: ep.title || '', artist: ep.show || '', album: 'Currents',
          artwork: ep.art ? [{ src: ep.art, sizes: '512x512' }] : [],
        });
        navigator.mediaSession.setActionHandler('play', function () { audio.play(); });
        navigator.mediaSession.setActionHandler('pause', function () { audio.pause(); });
        navigator.mediaSession.setActionHandler('seekbackward', function () { audio.currentTime = Math.max(0, audio.currentTime - 15); });
        navigator.mediaSession.setActionHandler('seekforward', function () { audio.currentTime += 30; });
      } catch (e) {}
    }
  };
  window.Currents.nowPlaying = function () { return audio.dataset.key || null; };
  audio.addEventListener('timeupdate', function () {
    var now = Date.now();
    if (audio.dataset.key && now - lastSave >= 5000) {
      lastSave = now;
      store(stateKey('resume-' + audio.dataset.key), String(audio.currentTime));
    }
    bar.style.width = (audio.duration ? (audio.currentTime / audio.duration) * 100 : 0) + '%';
  });
  audio.addEventListener('ended', function () {
    store(stateKey('resume-' + audio.dataset.key), '0');
  });
  audio.addEventListener('error', function () {
    if (audio.getAttribute('src')) Currents.toast('That episode would not load');
  });
  function icons() {
    $('mp-toggle').querySelector('.ic-play').hidden = !audio.paused;
    $('mp-toggle').querySelector('.ic-pause').hidden = audio.paused;
  }
  audio.addEventListener('play', icons);
  audio.addEventListener('pause', icons);
  $('mp-toggle').addEventListener('click', function () { if (audio.paused) audio.play(); else audio.pause(); });
  $('mp-back').addEventListener('click', function () { audio.currentTime = Math.max(0, audio.currentTime - 15); });
  $('mp-close').addEventListener('click', function () {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    delete audio.dataset.key;
    mp.hidden = true;
    document.body.classList.remove('has-player');
  });

  /* ---------- embedbox: one iframe at a time, id validated before src ---------- */
  var YT_RE = /^[A-Za-z0-9_-]{11}$/;
  var hintTimer = null;
  window.Currents.isVideoId = function (id) { return YT_RE.test(String(id || '')); };
  window.Currents.showVideo = function (id, title) {
    if (!YT_RE.test(id)) return;
    $('eb-title').textContent = title || '';
    $('eb-frame').innerHTML = '';
    var f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1';
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.setAttribute('allowfullscreen', '');
    f.title = title || 'Video';
    $('eb-frame').appendChild(f);
    $('eb-open').href = 'https://www.youtube.com/watch?v=' + id;
    $('eb-hint').hidden = true;
    $('embedbox').hidden = false;
    audio.pause();
    /* embed blocking is invisible cross-origin, so the escape hatch just
       fades in after a few seconds rather than waiting for an error */
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      if (!$('embedbox').hidden) $('eb-hint').hidden = false;
    }, 3000);
  };
  function closeVideo() {
    clearTimeout(hintTimer);
    $('eb-frame').innerHTML = '';
    $('embedbox').hidden = true;
  }
  $('eb-close').addEventListener('click', closeVideo);
  $('embedbox').addEventListener('click', function (e) { if (e.target === $('embedbox')) closeVideo(); });

  /* ---------- saved ---------- */
  function savedList() { return storeJSON(stateKey('saved')) || []; }
  window.Currents.isSaved = function (href) {
    return savedList().some(function (i) { return i.href === href; });
  };
  window.Currents.toggleSave = function (item) {
    var items = savedList();
    var at = -1;
    items.forEach(function (i, n) { if (i.href === item.href) at = n; });
    if (at >= 0) { items.splice(at, 1); Currents.toast('Removed'); }
    else { items.unshift(item); if (items.length > 120) items.pop(); Currents.toast('Saved'); }
    storeJSON(stateKey('saved'), items);
    if (!$('savedrawer').hidden) renderSaved();
    return at < 0;
  };
  function renderSaved() {
    var list = $('sd-list'), items = savedList();
    list.innerHTML = '';
    if (!items.length) {
      list.innerHTML = '<p class="c-empty">Nothing saved yet. Tap ★ on anything worth keeping.</p>';
      return;
    }
    items.forEach(function (it) {
      var row = document.createElement('div');
      row.className = 'sd-row';
      var internal = /^#/.test(it.href || '');
      row.innerHTML =
        '<a class="sd-link" ' + (internal ? '' : 'target="_blank" rel="noopener" ') +
          'href="' + Currents.esc(it.href) + '">' +
          '<span class="sd-row-title">' + Currents.esc(it.title) + '</span>' +
          '<span class="feed-src">' + Currents.esc(it.from || '') + '</span></a>' +
        '<button class="mp-btn sd-drop" aria-label="Remove">' +
          '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>';
      row.querySelector('.sd-drop').addEventListener('click', function () {
        Currents.toggleSave(it);
      });
      if (internal) row.querySelector('.sd-link').addEventListener('click', function () { closeSaved(); });
      list.appendChild(row);
    });
  }
  function closeSaved() { $('savedrawer').hidden = true; }
  window.Currents.openSaved = function () { renderSaved(); $('savedrawer').hidden = false; };
  $('sd-close').addEventListener('click', closeSaved);
  $('sd-scrim').addEventListener('click', closeSaved);
  $('saved-btn').addEventListener('click', function () { Currents.openSaved(); });

  /* the ★ every tab stamps on a row — markup here so the tabs stay thin */
  window.Currents.starBtn = function (href) {
    return '<button class="star' + (Currents.isSaved(href) ? ' is-on' : '') + '" aria-label="Save">' +
      '<svg viewBox="0 0 24 24"><path d="m12 4 2.35 4.9 5.4.75-3.9 3.75.93 5.35L12 16.2 7.22 18.75l.93-5.35L4.25 9.65l5.4-.75z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></button>';
  };
  window.Currents.bindStar = function (wrap, item) {
    var b = wrap.querySelector('.star');
    if (!b) return;
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      b.classList.toggle('is-on', Currents.toggleSave(item));
    });
  };

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('embedbox').hidden) closeVideo();
    else if (!$('savedrawer').hidden) closeSaved();
  });

  /* ---------- broken remote images ----------
     The wire links thumbnails on a hundred domains and Btown TV links
     i.ytimg. Some 404, some refuse cross-origin embedding outright (Quartz
     serves CORP: same-origin). An empty grey box reads as a bug, so drop
     the image; YouTube gets one retry at mqdefault, which exists for live
     streams where hqdefault does not. `error` does not bubble — capture. */
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    var src = img.getAttribute('src') || '';
    if (/i\.ytimg\.com\/vi\/.+\/hqdefault\.jpg$/.test(src)) {
      img.src = src.replace('/hqdefault.jpg', '/mqdefault.jpg');
      return;
    }
    img.remove();
  }, true);

  /* ---------- tab bar ---------- */
  document.querySelector('.tabbar').addEventListener('click', function (e) {
    var btn = e.target.closest('.tab');
    if (!btn) return;
    var tab = btn.dataset.tab;
    /* tapping the tab you are already on goes home within that tab —
       out of a Wikipedia article, back to the top of a feed */
    if (active === tab) {
      if (tab === 'read' && /^#read\//.test(location.hash)) { Currents.go('read'); return; }
      var p = $('panel-' + tab);
      if (p) p.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    Currents.go(tab);
  });

  /* ---------- stale banner ---------- */
  window.Currents.showStale = function () { $('stale-note').hidden = false; measureMast(); };
  window.Currents.hideStale = function () { $('stale-note').hidden = true; measureMast(); };
})();
