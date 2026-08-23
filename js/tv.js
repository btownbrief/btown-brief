/* ============================================================
   BTOWN TV — js/tv.js

   Renders tonight's edition from data/btown-tv.json on the
   orphan `btown-tv` branch (scripts/curate_tv.py writes it once
   a day). Nothing here ranks anything: the order on the page is
   the editor's order. The page only adds memory for the reader
   (watched / not for me / more like this — kept in localStorage,
   mirrored to Supabase as anonymous aggregate signals that the
   next edition reads). Every write fails soft.
============================================================ */
(function () {
  'use strict';

  var DATA_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/btown-tv/data/btown-tv.json';
  var FALLBACK_URL = 'data/btown-tv.json';      // main's first-paint copy, may be stale
  var SB_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
  var SB_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3'; // anon — safe to ship
  var REACT_KEY = 'btown-tv-reacts';            // { vid: 'watched' | 'skip' | 'more' }
  var STALE_MS = 30 * 3600 * 1000;              // an edition older than this says so

  var page = document.getElementById('tv-page');
  var reacts = loadReacts();

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function watchUrl(id) { return 'https://www.youtube.com/watch?v=' + encodeURIComponent(id); }
  function thumb(id, big) {
    return 'https://i.ytimg.com/vi/' + encodeURIComponent(id) + (big ? '/maxresdefault.jpg' : '/hqdefault.jpg');
  }
  function views(n) {
    if (!n) return '';
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M views';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K views';
    return n + ' views';
  }
  function ago(ts) {
    if (!ts) return '';
    var d = Math.floor((Date.now() / 1000 - ts) / 86400);
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 30) return d + ' days ago';
    if (d < 365) return Math.floor(d / 30) + ' mo ago';
    var y = Math.floor(d / 365);
    return y + (y === 1 ? ' year ago' : ' years ago');
  }
  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function loadReacts() {
    try { return JSON.parse(localStorage.getItem(REACT_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveReacts() {
    try { localStorage.setItem(REACT_KEY, JSON.stringify(reacts)); } catch (e) {}
  }
  function playerId() {
    var v = null;
    try { v = localStorage.getItem('btown-player-id'); } catch (e) {}
    if (!v) {
      v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() :
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          var r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 3 | 8)).toString(16);
        });
      try { localStorage.setItem('btown-player-id', v); } catch (e) {}
    }
    return v;
  }
  function rpc(fn, args) {
    return fetch(SB_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST', keepalive: true,
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); });
  }
  var toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'tv-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
  }

  /* ---------- render ---------- */
  function card(item, big) {
    var state = reacts[item.id] || '';
    var live = item.dur === 'LIVE';
    return '' +
      '<article class="tv-card' + (state === 'watched' ? ' is-watched' : state === 'skip' ? ' is-skipped' : '') + '" data-vid="' + esc(item.id) + '">' +
        '<a class="tv-link" href="' + watchUrl(item.id) + '" target="_blank" rel="noopener">' +
          '<div class="tv-thumb"><img loading="lazy" src="' + thumb(item.id, big) + '" alt="" ' +
            (big ? 'onerror="this.onerror=null;this.src=\'' + thumb(item.id, false) + '\'"' : '') + '>' +
            (item.dur ? '<span class="tv-dur' + (live ? ' is-live' : '') + '">' + esc(item.dur) + '</span>' : '') +
          '</div>' +
          '<div class="tv-card-body">' +
            '<div class="tv-card-title">' + esc(item.t) + '</div>' +
            '<div class="tv-meta"><span class="tv-ch">' + esc(item.ch) + '</span>' +
              (item.lane ? '<span class="tv-lane">' + esc(item.lane) + '</span>' : '') +
              (item.views ? '<span>· ' + views(item.views) + '</span>' : '') +
              (item.d ? '<span>· ' + ago(item.d) + '</span>' : '') +
            '</div>' +
            (item.why ? '<p class="tv-why">' + esc(item.why) + '</p>' : '') +
          '</div>' +
        '</a>' +
        '<div class="tv-acts" role="group" aria-label="Your reaction">' +
          act('watched', '✓ Watched', state) + act('skip', '✕ Not for me', state) + act('more', '♥ More like this', state) +
        '</div>' +
      '</article>';
  }
  function act(kind, label, state) {
    return '<button class="tv-act" type="button" data-kind="' + kind + '" aria-pressed="' + (state === kind) + '">' + label + '</button>';
  }

  function render(data) {
    var pick = data.pick;
    var html = '';
    var genMs = Date.parse(data.generated || '');
    var stale = isFinite(genMs) && (Date.now() - genMs) > STALE_MS;

    html += '<header class="tv-mast">' +
      '<div class="tv-kicker">Btown Brief presents</div>' +
      '<h1 class="tv-title">Btown <em>TV</em></h1>' +
      '<p class="tv-tag">One human-picked page of videos for Burlington, every evening. A Tonight\'s pick and a few short shelves — watch it here, or send the whole edition to your TV. No algorithm, no infinite scroll.</p>' +
      '<div class="tv-mast-row">' +
        (data.playlist && data.playlist.url ?
          '<a class="tv-play" href="' + esc(data.playlist.url) + '" target="_blank" rel="noopener" title="Opens tonight\'s playlist in YouTube — cast it or open it on your TV">' +
            '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>Play tonight on your TV</a>' : '') +
        '<span class="tv-edition">' + (isFinite(genMs) ? 'Edition picked <b>' + esc(fmtTime(data.generated)) + '</b>' : '') + '</span>' +
        '<button class="tv-how" type="button" aria-expanded="false" aria-controls="tv-howtext">How this works</button>' +
      '</div>' +
      (stale ? '<p class="tv-stale">This is the last edition we made — tonight\'s hasn\'t landed yet.</p>' : '') +
      '<div class="tv-howtext" id="tv-howtext" hidden>' +
        'Every three hours a script collects new uploads from ~100 channels we follow, a Vermont radar, and each channel\'s back catalog. Before dinner an editor — a model reading a written taste doctrine — throws out clips, trailers, reruns and webcams, then picks one Tonight\'s pick and a few shelves, by index, with a one-line reason for each. Titles are never rewritten. The same picks go into a public YouTube playlist so the edition plays on a TV with one tap. Your ✓ ✕ ♥ taps stay on this device and roll up, anonymously, into what the editor sees tomorrow. ' +
        'The taste doctrine is public: <a href="https://github.com/btownbrief/btown-brief/blob/main/prompts/tv-taste.md" target="_blank" rel="noopener">prompts/tv-taste.md</a>.' +
      '</div>' +
    '</header>';

    if (pick) {
      html += '<section class="tv-pick" aria-label="Tonight\'s pick">' +
        '<div class="tv-pick-label">Tonight\'s pick</div>' +
        '<a class="tv-pick-card" href="' + watchUrl(pick.id) + '" target="_blank" rel="noopener">' +
          '<div class="tv-thumb"><img src="' + thumb(pick.id, true) + '" alt="" onerror="this.onerror=null;this.src=\'' + thumb(pick.id, false) + '\'">' +
            (pick.dur ? '<span class="tv-dur">' + esc(pick.dur) + '</span>' : '') + '</div>' +
          '<div class="tv-pick-body"><h2>' + esc(pick.t) + '</h2>' +
            '<div class="tv-meta"><span class="tv-ch">' + esc(pick.ch) + '</span>' +
              (pick.views ? '<span>· ' + views(pick.views) + '</span>' : '') +
              (pick.d ? '<span>· ' + ago(pick.d) + '</span>' : '') + '</div>' +
            (pick.why ? '<p class="tv-why" style="margin-top:8px">' + esc(pick.why) + '</p>' : '') +
          '</div>' +
        '</a>' +
      '</section>';
    }

    (data.shelves || []).forEach(function (shelf) {
      if (!shelf.items || !shelf.items.length) return;
      html += '<section class="tv-shelf" aria-label="' + esc(shelf.title) + '">' +
        '<div class="tv-shelf-head"><h2>' + esc(shelf.title) + '</h2>' + (shelf.sub ? '<p>' + esc(shelf.sub) + '</p>' : '') + '</div>' +
        '<div class="tv-grid">' + shelf.items.map(function (it) { return card(it, false); }).join('') + '</div>' +
      '</section>';
    });

    if (data.live && data.live.length) {
      html += '<section class="tv-live" aria-label="Live now"><h2>Live now</h2><div class="tv-live-list">' +
        data.live.map(function (l) {
          return '<a href="' + watchUrl(l.id) + '" target="_blank" rel="noopener"><i aria-hidden="true"></i>' + esc(l.ch ? l.ch + ' — ' : '') + esc(l.t) + '</a>';
        }).join('') + '</div></section>';
    }

    var st = data.stats || {};
    var dropped = st.dropped || {};
    var dropBits = Object.keys(dropped).map(function (k) { return dropped[k] + ' ' + k; }).join(', ');
    var cands = st.candidates ? Object.keys(st.candidates).reduce(function (n, k) { return n + st.candidates[k]; }, 0) : 0;
    html += '<footer class="tv-colophon">' +
      'Edition ' + esc(data.edition || '') + (cands ? ' · the editor read ' + cands + ' candidates' : '') +
      (dropBits ? ' · the gates dropped ' + esc(dropBits) : '') + ' · picked ' + (st.picked || 0) + '. ' +
      'Videos open on YouTube; nothing is hosted here. Part of <a href="pulse.html">the Pulse</a> family.' +
    '</footer>';

    page.innerHTML = html;
    page.hidden = false;
    wire();
  }

  function wire() {
    var how = page.querySelector('.tv-how');
    if (how) {
      how.addEventListener('click', function () {
        var open = how.getAttribute('aria-expanded') === 'true';
        how.setAttribute('aria-expanded', String(!open));
        document.getElementById('tv-howtext').hidden = open;
      });
    }
    page.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.tv-act');
      if (!btn) return;
      var cardEl = btn.closest('.tv-card');
      var vid = cardEl && cardEl.dataset.vid;
      if (!vid) return;
      var kind = btn.dataset.kind;
      var was = reacts[vid];
      if (was === kind) { delete reacts[vid]; } else { reacts[vid] = kind; }
      saveReacts();
      cardEl.classList.toggle('is-watched', reacts[vid] === 'watched');
      cardEl.classList.toggle('is-skipped', reacts[vid] === 'skip');
      cardEl.querySelectorAll('.tv-act').forEach(function (b) {
        b.setAttribute('aria-pressed', String(reacts[vid] === b.dataset.kind));
      });
      if (reacts[vid]) {
        var title = cardEl.querySelector('.tv-card-title');
        var ch = cardEl.querySelector('.tv-ch');
        rpc('tv_react', { p_player: playerId(), p_kind: kind, p_vid: vid,
          p_title: title ? title.textContent : '', p_channel: ch ? ch.textContent : '' }).catch(function () {});
        toast(kind === 'watched' ? 'Marked watched' : kind === 'skip' ? 'Noted — the editor hears it' : 'Noted — more like this');
      }
    });
  }

  /* ---------- load ---------- */
  function load() {
    return fetch(DATA_URL, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).catch(function () {
      return fetch(FALLBACK_URL).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    });
  }

  load().then(function (data) {
    if (!data || !data.pick) throw new Error('empty edition');
    render(data);
  }).catch(function () {
    page.innerHTML = '<header class="tv-mast"><div class="tv-kicker">Btown Brief presents</div><h1 class="tv-title">Btown <em>TV</em></h1></header>' +
      '<p class="tv-empty">Tonight\'s edition hasn\'t been picked yet. Back around dinner.</p>';
    page.hidden = false;
  });
})();
