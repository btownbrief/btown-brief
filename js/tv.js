/* ============================================================
   BTOWN TV — js/tv.js

   Renders tonight's edition from data/btown-tv.json on the
   orphan `btown-tv` branch (scripts/curate_tv.py writes it once
   a day). Nothing here ranks anything: the order on the page is
   the editor's order, and "more" is the editor's bench — named
   in the same run, folded until asked for. The page only adds
   memory for the reader (watched / not for me / more like this —
   kept in localStorage, mirrored to Supabase as anonymous
   aggregate signals that the next edition reads). A ✕ on a pick
   swaps in the editor's next alternate for that shelf; that is a
   substitution from a list the editor already wrote, not a
   recommendation. Every write fails soft.
============================================================ */
(function () {
  'use strict';

  var BRANCH = 'https://raw.githubusercontent.com/btownbrief/btown-brief/btown-tv/data/';
  var DATA_URL = BRANCH + 'btown-tv.json';
  var EDITIONS_URL = BRANCH + 'tv-editions.json';
  var FALLBACK_URL = 'data/btown-tv.json';      // main's first-paint copy, may be stale
  var SB_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
  var SB_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3'; // anon — safe to ship
  var REACT_KEY = 'btown-tv-reacts';            // { vid: 'watched' | 'skip' | 'more' }
  var STALE_MS = 30 * 3600 * 1000;              // an edition older than this says so
  var PAST_NIGHTS = 14;                         // how many past editions the strip shows (= what the archive keeps)
  var SEND_DELAY_MS = 4500;                     // a reaction reaches the server only after the Undo window

  var page = document.getElementById('tv-page');
  var reacts = loadReacts();
  var data = null;                              // tonight's edition
  var expanded = {};                            // shelf key -> bench is showing
  var archive = null;                           // past editions (lazy)
  var archiveAsked = false;
  var openNight = '';                           // which past edition is unfolded
  var pending = {};                             // vid -> timer for a not-yet-sent reaction

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /* ids are used in URLs and attributes; anything that isn't a YouTube id
     shape becomes empty rather than reaching markup */
  function ytid(id) { return /^[A-Za-z0-9_-]{11}$/.test(String(id || '')) ? id : ''; }
  function watchUrl(id) { return 'https://www.youtube.com/watch?v=' + ytid(id); }
  function thumb(id, big) {
    return 'https://i.ytimg.com/vi/' + ytid(id) + (big ? '/maxresdefault.jpg' : '/hqdefault.jpg');
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
  /* "2026-08-22" -> "Sat, Aug 22" (a calendar day, not an instant) */
  function fmtNight(edition) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(edition || '');
    if (!m) return esc(edition);
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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
  /* Reactions reach Supabase late and revocably: a tap is sent after the
     Undo window closes (so a misclick + Undo never leaves a row), and taking
     a tap back — toggle off, Undo, switching kinds — deletes the row that
     may already be there (tv_unreact; fails soft until the SQL is pasted).
     This matters because the editor now acts on a single reader's ✕. */
  function sync(vid, was, now, title, ch) {
    var unsent = pending[vid];                  // {kind, timer} not yet on the server
    if (unsent) { clearTimeout(unsent.timer); delete pending[vid]; }
    if (was && was !== now && !(unsent && unsent.kind === was)) {
      rpc('tv_unreact', { p_player: playerId(), p_kind: was, p_vid: vid }).catch(function () {});
    }
    if (now) {
      pending[vid] = { kind: now, timer: setTimeout(function () {
        delete pending[vid];
        rpc('tv_react', { p_player: playerId(), p_kind: now, p_vid: vid, p_title: title, p_channel: ch }).catch(function () {});
      }, SEND_DELAY_MS) };
    }
  }
  /* tab closing before the window elapsed: send what's pending now */
  function flush() {
    Object.keys(pending).forEach(function (vid) {
      var p = pending[vid]; clearTimeout(p.timer); delete pending[vid];
      rpc('tv_react', { p_player: playerId(), p_kind: p.kind, p_vid: vid, p_title: '', p_channel: '' }).catch(function () {});
    });
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);

  var toastEl, toastTimer, toastUndo;
  function toast(msg, undo) {
    if (!toastEl) {
      toastEl = document.createElement('div'); toastEl.className = 'tv-toast'; document.body.appendChild(toastEl);
      toastEl.addEventListener('click', function (ev) {
        if (ev.target.closest('.tv-toast-undo') && toastUndo) { var fn = toastUndo; toastUndo = null; toastEl.classList.remove('show'); fn(); }
      });
    }
    toastUndo = undo || null;
    toastEl.innerHTML = esc(msg) + (undo ? ' <button class="tv-toast-undo" type="button">Undo</button>' : '');
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); toastUndo = null; }, undo ? SEND_DELAY_MS - 300 : 1800);
  }
  function skipped(item) { return !!item && reacts[item.id] === 'skip'; }

  /* ---------- cards ---------- */
  function card(item, opts) {
    opts = opts || {};
    var state = reacts[item.id] || '';
    var live = item.dur === 'LIVE';
    return '' +
      '<article class="tv-card' + (state === 'watched' ? ' is-watched' : state === 'skip' ? ' is-skipped' : '') +
        (opts.swapped ? ' is-swapped' : '') + '" data-vid="' + esc(item.id) + '">' +
        '<a class="tv-link" href="' + watchUrl(item.id) + '" target="_blank" rel="noopener">' +
          '<div class="tv-thumb"><img loading="lazy" src="' + thumb(item.id, false) + '" alt="">' +
            (item.dur ? '<span class="tv-dur' + (live ? ' is-live' : '') + '">' + esc(item.dur) + '</span>' : '') +
            (opts.swapped ? '<span class="tv-swapped" title="Swapped in after you hid the editor\'s first choice">Next up</span>' : '') +
          '</div>' +
          '<div class="tv-card-body">' +
            '<div class="tv-card-title">' + esc(item.t) + '</div>' +
            '<div class="tv-meta"><span class="tv-ch">' + esc(item.ch) + '</span>' +
              (item.lane ? '<span class="tv-lane">' + esc(item.lane) + '</span>' : '') +
              (item.views ? '<span>· ' + esc(views(item.views)) + '</span>' : '') +
              (item.d ? '<span>· ' + ago(item.d) + '</span>' : '') +
            '</div>' +
            (item.why ? '<p class="tv-why">' + esc(item.why) + '</p>' : '') +
          '</div>' +
        '</a>' +
        acts(state) +
      '</article>';
  }
  function acts(state) {
    return '<div class="tv-acts" role="group" aria-label="Your reaction — watched, not for me, more like this">' +
      act('watched', '✓ Watched', state) + act('skip', '✕ Not for me', state) + act('more', '♥ More', state) +
    '</div>';
  }
  function act(kind, label, state) {
    return '<button class="tv-act" type="button" data-kind="' + kind + '" aria-pressed="' + (state === kind) + '">' + label + '</button>';
  }

  /* ---------- tonight's pick (with runner-ups) ---------- */
  function composePick() {
    var pick = data.pick;
    if (!pick || !skipped(pick)) return { pick: pick, swapped: false };
    var alts = (data.pick_more || []).filter(function (a) { return a && !skipped(a); });
    /* the reader hid the pick: the first un-hidden runner-up steps in; if
       they've hidden those too, the original stays (dimmed) — never empty */
    return alts.length ? { pick: alts[0], swapped: true } : { pick: pick, swapped: false };
  }
  function pickHtml() {
    var c = composePick();
    var pick = c.pick;
    if (!pick) return '';
    var state = reacts[pick.id] || '';
    return '<section class="tv-pick' + (state === 'skip' ? ' is-skipped' : state === 'watched' ? ' is-watched' : '') + '" aria-label="Tonight\'s pick" data-vid="' + esc(pick.id) + '">' +
      '<div class="tv-pick-label">' + (c.swapped ? 'Runner-up pick <span class="tv-pick-note">— you hid the first choice</span>' : 'Tonight\'s pick') + '</div>' +
      '<a class="tv-pick-card" href="' + watchUrl(pick.id) + '" target="_blank" rel="noopener">' +
        '<div class="tv-thumb"><img src="' + thumb(pick.id, true) + '" alt="" data-fallback="' + thumb(pick.id, false) + '">' +
          (pick.dur ? '<span class="tv-dur">' + esc(pick.dur) + '</span>' : '') + '</div>' +
        '<div class="tv-pick-body"><h2>' + esc(pick.t) + '</h2>' +
          '<div class="tv-meta"><span class="tv-ch">' + esc(pick.ch) + '</span>' +
            (pick.views ? '<span>· ' + esc(views(pick.views)) + '</span>' : '') +
            (pick.d ? '<span>· ' + ago(pick.d) + '</span>' : '') + '</div>' +
          (pick.why ? '<p class="tv-why" style="margin-top:8px">' + esc(pick.why) + '</p>' : '') +
        '</div>' +
      '</a>' +
      '<div class="tv-pick-acts">' + acts(state) + '</div>' +
    '</section>';
  }

  /* ---------- shelves (with the bench) ---------- */
  /* The shelf's visible cards: the editor's picks, except that a pick the
     reader hid is replaced by the next unused, un-hidden alternate from the
     bench. What's left of the bench is what "Show more" reveals (or, once
     unfolded, what stays below the fold — a later ✕ just moves the next one
     up). */
  function composeShelf(shelf) {
    var pool = (shelf.more || []).slice();
    var visible = [];
    (shelf.items || []).forEach(function (item) {
      if (skipped(item)) {
        var idx = -1;
        for (var i = 0; i < pool.length; i++) { if (!skipped(pool[i])) { idx = i; break; } }
        if (idx >= 0) { visible.push({ item: pool.splice(idx, 1)[0], swapped: true }); return; }
      }
      visible.push({ item: item, swapped: false });
    });
    return { visible: visible, bench: pool };
  }
  function shelfHtml(shelf) {
    if (!shelf.items || !shelf.items.length) return '';
    var c = composeShelf(shelf);
    var open = !!expanded[shelf.key];
    var n = c.bench.length;
    var html = '<section class="tv-shelf" aria-label="' + esc(shelf.title) + '" data-shelf="' + esc(shelf.key) + '">' +
      '<div class="tv-shelf-head"><h2>' + esc(shelf.title) + '</h2>' + (shelf.sub ? '<p>' + esc(shelf.sub) + '</p>' : '') + '</div>' +
      '<div class="tv-grid">' + c.visible.map(function (v) { return card(v.item, { swapped: v.swapped }); }).join('') + '</div>';
    if (open) {
      html += '<section class="tv-bench" aria-label="' + esc(shelf.title) + ' — the bench" tabindex="-1">' +
        '<div class="tv-bench-head"><span>The bench</span> — ' + (n ? 'the editor\'s next ' + (n === 1 ? 'one' : n) + ' in this lane' : 'all used up') + '</div>' +
        (n ? '<div class="tv-grid">' + c.bench.map(function (it) { return card(it); }).join('') + '</div>' : '') +
        '<p class="tv-bench-end">That\'s everything the editor stood behind in this lane tonight.</p>' +
      '</section>';
    } else if (n) {
      html += '<button class="tv-more-btn" type="button" data-shelf="' + esc(shelf.key) + '">' +
        'Show ' + n + ' more <span>from the editor\'s bench</span></button>';
    }
    return html + '</section>';
  }

  /* ---------- past nights ---------- */
  function pastHtml() {
    if (!archive || !archive.editions) return '';
    var today = (data && data.edition) || '';
    var nights = archive.editions.filter(function (e) {
      /* ISO dates compare as strings; anything not strictly older than the
         front page is "tonight" (or a newer edition the fallback copy lags) */
      return e && e.edition && e.pick && (!today || e.edition < today);
    }).slice(0, PAST_NIGHTS);
    if (!nights.length) return '';
    var html = '<section class="tv-past" aria-label="Past nights" data-past>' +
      '<div class="tv-shelf-head"><h2>Past nights</h2><p>Missed an evening? The last ' + (nights.length === 1 ? 'edition' : nights.length + ' editions') + ', as they ran.</p></div>' +
      '<div class="tv-past-strip">' +
      nights.map(function (e) {
        var on = e.edition === openNight;
        return '<button class="tv-past-night" type="button" data-night="' + esc(e.edition) + '" aria-expanded="' + on + '">' +
          '<span class="tv-past-thumb"><img loading="lazy" src="' + thumb(e.pick.id, false) + '" alt=""></span>' +
          '<span class="tv-past-date">' + fmtNight(e.edition) + '</span>' +
          '<span class="tv-past-title">' + esc(e.pick.t) + '</span>' +
        '</button>';
      }).join('') + '</div>';
    var open = null;
    nights.forEach(function (e) { if (e.edition === openNight) open = e; });
    if (open) {
      html += '<div class="tv-past-body">' +
        '<div class="tv-past-body-head"><h3>Edition of ' + fmtNight(open.edition) + '</h3>' +
          '<span class="tv-past-body-acts">' +
          (open.playlist && open.playlist.url && /^https:\/\/www\.youtube\.com\/playlist\?list=[A-Za-z0-9_-]+$/.test(open.playlist.url) ?
            '<a class="tv-past-play" href="' + esc(open.playlist.url) + '" target="_blank" rel="noopener">▶ Play this night on your TV</a>' : '') +
          '<button class="tv-past-close" type="button" data-night="' + esc(open.edition) + '">Close</button></span></div>' +
        '<div class="tv-past-pick"><div class="tv-pick-label">That night\'s pick</div><div class="tv-grid tv-grid-1">' + card(open.pick) + '</div></div>' +
        (open.shelves || []).map(function (s) {
          if (!s.items || !s.items.length) return '';
          return '<div class="tv-past-shelf"><h4>' + esc(s.title) + '</h4><div class="tv-grid">' +
            s.items.map(function (it) { return card(it); }).join('') + '</div></div>';
        }).join('') +
      '</div>';
    }
    return html + '</section>';
  }

  /* ---------- the page ---------- */
  function render() {
    var html = '';
    var genMs = Date.parse(data.generated || '');
    var stale = isFinite(genMs) && (Date.now() - genMs) > STALE_MS;

    html += '<header class="tv-mast">' +
      '<div class="tv-kicker">Btown Brief presents</div>' +
      '<h1 class="tv-title">Btown <em>TV</em></h1>' +
      '<p class="tv-tag">One human-picked page of videos for Burlington, every evening. A Tonight\'s pick and six shelves — around fifty videos, each with a reason — watch it here, or send the top of the edition to your TV. No algorithm, no infinite scroll.</p>' +
      '<div class="tv-mast-row">' +
        (data.playlist && data.playlist.url ?
          '<a class="tv-play" href="' + esc(data.playlist.url) + '" target="_blank" rel="noopener" title="Opens tonight\'s playlist in YouTube — cast it or open it on your TV">' +
            '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>Play tonight on your TV</a>' : '') +
        '<span class="tv-edition">' + (isFinite(genMs) ? 'Edition picked <b>' + esc(fmtTime(data.generated)) + '</b>' : '') + '</span>' +
        '<button class="tv-how" type="button" aria-expanded="false" aria-controls="tv-howtext">How this works</button>' +
      '</div>' +
      (stale ? '<p class="tv-stale">This is the last edition we made — tonight\'s hasn\'t landed yet.</p>' : '') +
      '<div class="tv-howtext" id="tv-howtext" hidden>' +
        'Every three hours a script collects new uploads from ~100 channels we follow, a Vermont radar, and each channel\'s back catalog. Before dinner an editor — a model reading a written taste doctrine — throws out clips, trailers, reruns and webcams, then picks one Tonight\'s pick and a few shelves, by index, with a one-line reason for each. Titles are never rewritten. ' +
        'Each night\'s page becomes its own public playlist (the first fifty, in page order) — the "Play tonight on your TV" button — and the last two weeks of those stay up under Past nights. ' +
        'The editor also names a short bench for each shelf — the next few it would stand behind. That\'s what "Show more" unfolds, once, and what steps in when you hide a pick with ✕. It isn\'t a feed: when the bench is out, that\'s the night. Past editions stay up for two weeks under Past nights. ' +
        'Your ✓ ✕ ♥ taps stay on this device and roll up, anonymously, into what the editor sees tomorrow. ' +
        'The taste doctrine is public: <a href="https://github.com/btownbrief/btown-brief/blob/main/prompts/tv-taste.md" target="_blank" rel="noopener">prompts/tv-taste.md</a>.' +
      '</div>' +
    '</header>';

    html += pickHtml();
    (data.shelves || []).forEach(function (shelf) { html += shelfHtml(shelf); });

    if (data.live && data.live.length) {
      html += '<section class="tv-live" aria-label="Live now"><h2>Live now</h2><div class="tv-live-list">' +
        data.live.map(function (l) {
          return '<a href="' + watchUrl(l.id) + '" target="_blank" rel="noopener"><i aria-hidden="true"></i>' + esc(l.ch ? l.ch + ' — ' : '') + esc(l.t) + '</a>';
        }).join('') + '</div></section>';
    }

    html += '<div id="tv-past-slot">' + pastHtml() + '</div>';

    var st = data.stats || {};
    var dropped = st.dropped || {};
    var dropBits = Object.keys(dropped).map(function (k) { return dropped[k] + ' ' + k; }).join(', ');
    var cands = st.candidates ? Object.keys(st.candidates).reduce(function (n, k) { return n + st.candidates[k]; }, 0) : 0;
    html += '<footer class="tv-colophon">' +
      'Edition ' + esc(data.edition || '') + (cands ? ' · the editor read ' + esc(String(cands)) + ' candidates' : '') +
      (dropBits ? ' · the gates dropped ' + esc(dropBits) : '') + ' · picked ' + esc(String(st.picked || 0)) +
      (st.bench ? ' · benched ' + esc(String(st.bench)) : '') + '. ' +
      'Videos open on YouTube; nothing is hosted here. Want the whole river instead? <a href="pulse.html">The Pulse</a> has every upload.' +
    '</footer>';

    page.innerHTML = html;
    page.hidden = false;
    wireFallbacks(page);
  }

  /* maxresdefault is missing for many older videos — fall back to hqdefault */
  function wireFallbacks(root) {
    root.querySelectorAll('img[data-fallback]').forEach(function (img) {
      img.addEventListener('error', function () {
        if (img.dataset.fallback && img.src !== img.dataset.fallback) img.src = img.dataset.fallback;
      }, { once: true });
    });
  }

  /* re-render just one section so a reaction doesn't repaint the page */
  function rerenderShelf(key) {
    var sec = page.querySelector('section[data-shelf="' + key + '"]');
    var shelf = null;
    (data.shelves || []).forEach(function (s) { if (s.key === key) shelf = s; });
    if (!sec || !shelf) return;
    sec.outerHTML = shelfHtml(shelf);
  }
  function rerenderPick() {
    var sec = page.querySelector('section.tv-pick');
    if (!sec) return;
    sec.outerHTML = pickHtml();
    wireFallbacks(page.querySelector('section.tv-pick') || page);
  }
  function rerenderPast() {
    var slot = document.getElementById('tv-past-slot');
    if (slot) slot.innerHTML = pastHtml();
  }

  /* ---------- reactions ---------- */
  function react(holder, kind) {
    var vid = holder.dataset.vid;
    if (!vid) return;
    var was = reacts[vid] || '';
    if (was === kind) { delete reacts[vid]; } else { reacts[vid] = kind; }
    var now = reacts[vid] || '';
    saveReacts();
    var title = holder.querySelector('.tv-card-title, .tv-pick-body h2');
    var ch = holder.querySelector('.tv-ch');
    sync(vid, was, now, title ? title.textContent : '', ch ? ch.textContent : '');

    var shelfSec = holder.closest('section[data-shelf]');
    var pickSec = holder.closest('section.tv-pick');
    var frontCard = !holder.closest('.tv-bench') && !!(shelfSec || pickSec);
    /* only a ✕ (on or off) on a front-page slot can change what's on the
       page; everything else toggles in place so focus and aria stay put */
    var recompose = frontCard && (kind === 'skip' || was === 'skip');

    function inPlace(el) {
      el.classList.toggle('is-watched', reacts[vid] === 'watched');
      el.classList.toggle('is-skipped', reacts[vid] === 'skip');
      el.querySelectorAll('.tv-act').forEach(function (b) {
        b.setAttribute('aria-pressed', String(reacts[vid] === b.dataset.kind));
      });
    }
    function repaint() {
      if (recompose && shelfSec) rerenderShelf(shelfSec.dataset.shelf);
      else if (recompose && pickSec) rerenderPick();
      else {
        /* the same video can sit in more than one place (a past night and
           tonight, the bench and a swapped slot) — keep every copy honest */
        var copies = page.querySelectorAll('[data-vid="' + vid + '"]');
        if (copies.length) copies.forEach(inPlace); else inPlace(holder);
      }
    }
    var swappedIn = false;
    if (now === 'skip' && recompose) {
      if (shelfSec) {
        var s = null;
        (data.shelves || []).forEach(function (x) { if (x.key === shelfSec.dataset.shelf) s = x; });
        if (s) swappedIn = !composeShelf(s).visible.some(function (v) { return v.item.id === vid; });
      } else if (pickSec) {
        swappedIn = composePick().pick.id !== vid;
      }
    }
    repaint();
    if (!now) return;
    var undo = function () {
      if (was) { reacts[vid] = was; } else { delete reacts[vid]; }
      saveReacts();
      sync(vid, now, was, title ? title.textContent : '', ch ? ch.textContent : '');
      /* after an undo the holder may be gone (re-rendered) — repaint from data */
      if (shelfSec) rerenderShelf(shelfSec.dataset.shelf);
      else if (pickSec) rerenderPick();
      else page.querySelectorAll('[data-vid="' + vid + '"]').forEach(inPlace);
    };
    if (kind === 'watched') toast('Marked watched');
    else if (kind === 'more') toast('Noted — more like this');
    else if (swappedIn) toast('Hidden — the editor\'s next choice stepped in', undo);
    else toast('Hidden for you — enough of these and the editor backs off the channel', undo);
  }

  function wire() {
    page.addEventListener('click', function (ev) {
      var how = ev.target.closest('.tv-how');
      if (how) {
        var open = how.getAttribute('aria-expanded') === 'true';
        how.setAttribute('aria-expanded', String(!open));
        document.getElementById('tv-howtext').hidden = open;
        return;
      }
      var moreBtn = ev.target.closest('.tv-more-btn');
      if (moreBtn) {
        expanded[moreBtn.dataset.shelf] = true;
        rerenderShelf(moreBtn.dataset.shelf);
        var bench = page.querySelector('section[data-shelf="' + moreBtn.dataset.shelf + '"] .tv-bench');
        if (bench) bench.focus({ preventScroll: true });
        return;
      }
      var night = ev.target.closest('.tv-past-night, .tv-past-close');
      if (night) {
        var key = night.dataset.night;
        openNight = (openNight === key || night.classList.contains('tv-past-close')) ? '' : key;
        rerenderPast();
        if (openNight) {
          var body = page.querySelector('.tv-past-body');
          if (body && body.scrollIntoView) body.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }
      var btn = ev.target.closest('.tv-act');
      if (!btn) return;
      var holder = btn.closest('[data-vid]');
      if (holder) react(holder, btn.dataset.kind);
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
  function loadArchive() {
    if (archiveAsked) return;
    archiveAsked = true;
    fetch(EDITIONS_URL).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (a) { archive = a; rerenderPast(); }).catch(function () { /* no archive yet — the strip stays hidden */ });
  }
  /* the archive is ~100KB of past editions most visits never open — fetch
     it only when the reader scrolls near where the strip would sit */
  function watchArchive() {
    var slot = document.getElementById('tv-past-slot');
    if (!slot) return;
    if (!('IntersectionObserver' in window)) { loadArchive(); return; }
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) { io.disconnect(); loadArchive(); }
    }, { rootMargin: '600px 0px' });
    io.observe(slot);
  }

  wire();
  load().then(function (d) {
    if (!d || !d.pick) throw new Error('empty edition');
    data = d;
    render();
    watchArchive();
  }).catch(function () {
    page.innerHTML = '<header class="tv-mast"><div class="tv-kicker">Btown Brief presents</div><h1 class="tv-title">Btown <em>TV</em></h1></header>' +
      '<p class="tv-empty">Tonight\'s edition hasn\'t been picked yet. Back around dinner.</p>';
    page.hidden = false;
  });
})();
