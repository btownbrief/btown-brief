/* modes/watch.js — the screen.

   Two things that were two pages. TONIGHT is BTown TV's edition: one pick and
   six shelves chosen once a day, each with a bench of runners-up behind a
   fold. EVERYTHING is the raw channel wall — 579 videos off the roster,
   including the back catalogue.

   Both now read the same file. tv.html reads the btown-tv branch and
   listen.html reads main's committed copy, which has been frozen since
   23 August; that split is why listen.html has been advertising a five-day-old
   pick. One source, branch first, main only as a fallback.

   A ✓ or ✕ here still teaches tomorrow's edition — it writes to the same
   tv_react function curate_tv.py reads. The send is held for four seconds so
   an undo never leaves a row behind. */

import { get } from '../wire.js';
import * as store from '../store.js';
import { esc, safeUrl, ago, agoLong, fmtViews, ytThumb, wireFallbacks, sampleN } from '../ui.js';

const STALE_MS = 30 * 3600 * 1000;
const SEND_DELAY = 4500;
const WALL_PAGE = 24;

let root = null;
let ctx = null;
let tv = null;
let wall = null;
let expanded = {};
let pending = {};
let state = { view: 'tonight', page: 1, shuffle: 1 };

export default {
  mount(el, context) {
    root = el;
    ctx = context;

    root.innerHTML =
      '<div class="wrap-wide">' +
        '<div class="page-head">' +
          '<h1>On screen</h1>' +
          '<p class="sub" id="wt-sub">Rolling the tape…</p>' +
        '</div>' +
        '<div class="lw-toggle" role="tablist" aria-label="View">' +
          '<button class="lw-half is-active" data-view="tonight" role="tab" aria-selected="true">Tonight</button>' +
          '<button class="lw-half" data-view="everything" role="tab" aria-selected="false">Everything</button>' +
        '</div>' +
        '<div id="wt-body"><p class="loading">Rolling the tape…</p></div>' +
      '</div>';

    root.querySelector('.lw-toggle').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (!b || b.dataset.view === state.view) return;
      state.view = b.dataset.view;
      state.page = 1;
      [...root.querySelectorAll('.lw-half')].forEach((h) => {
        const on = h.dataset.view === state.view;
        h.classList.toggle('is-active', on);
        h.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      render();
      root.scrollTop = 0;
    });

    root.querySelector('#wt-body').addEventListener('click', onClick);

    get('tv')
      .then((res) => { tv = res.data; render(); })
      .catch(() => { tv = false; render(); });
  },
};

/* ------------------------------------------------------------------ tonight */

function render() {
  const body = root.querySelector('#wt-body');
  if (state.view === 'everything') { renderWall(body); return; }

  if (tv === null) { body.innerHTML = '<p class="loading">Rolling the tape…</p>'; return; }
  if (!tv || !tv.pick) {
    body.innerHTML = '<div class="empty"><b>No edition tonight</b>Try Everything instead.</div>';
    return;
  }

  root.querySelector('#wt-sub').textContent =
    'Tonight\'s edition · picked ' + agoLong(Math.floor(Date.parse(tv.generated) / 1000));

  let html = '';

  if (Date.now() - Date.parse(tv.generated) > STALE_MS) {
    html += '<p class="notice">This is the last edition we made — tonight\'s hasn\'t landed yet.</p>';
  }

  // The pick is the headline of the page, so it goes first. Live streams are
  // a rail underneath it, not a wall above it.
  html += '<p class="eyebrow accent" style="margin-top:18px">Tonight\'s pick</p>' + heroHTML(tv.pick);

  if (tv.live && tv.live.length) {
    html += '<p class="eyebrow accent" style="margin-top:24px">Live right now</p>' +
      '<div class="tv-live">' + tv.live.slice(0, 8).map((v) =>
        '<a class="tv-livepill" href="https://www.youtube.com/watch?v=' + esc(v.id) +
        '" target="_blank" rel="noopener"><i></i>' + esc(v.t) + '</a>').join('') + '</div>';
  }

  (tv.shelves || []).forEach((sh) => { html += shelfHTML(sh); });

  if (tv.playlist && tv.playlist.url && /^https:\/\/www\.youtube\.com\/playlist\?list=[A-Za-z0-9_-]+$/.test(tv.playlist.url)) {
    html += '<a class="btn wide primary" style="margin:24px 0" href="' + esc(tv.playlist.url) +
      '" target="_blank" rel="noopener">▶ Play tonight on your TV</a>';
  }

  body.innerHTML = html;
  wireFallbacks(body);
}

function heroHTML(v) {
  const k = store.keyOf('yt:' + v.id);
  ctx.index(k, { k, kind: 'video', t: v.t, u: 'https://www.youtube.com/watch?v=' + v.id, s: v.ch, d: v.d });
  const on = store.isSaved(k);
  return '<a class="card tv-hero" href="https://www.youtube.com/watch?v=' + esc(v.id) +
    '" target="_blank" rel="noopener">' +
    '<span class="vshell"><img class="vthumb" src="' + esc(ytThumb(v.id, true)) +
      '" data-fallback="' + esc(ytThumb(v.id, false)) + '" alt="" loading="lazy" decoding="async">' +
      durHTML(v) + '</span>' +
    '<span class="tv-hero-body">' +
      '<span class="tv-hero-t">' + esc(v.t) + '</span>' +
      (v.why ? '<span class="vwhy">' + esc(v.why) + '</span>' : '') +
      '<span class="vmeta">' + esc(v.ch) + (v.views ? '<span>' + esc(fmtViews(v.views)) + '</span>' : '') +
        (v.d ? '<span>' + esc(ago(v.d)) + '</span>' : '') + '</span>' +
      '<span class="fi-acts" style="opacity:1">' + reactHTML(v.id) +
        '<button data-save="' + esc(k) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        (on ? 'Saved' : 'Save') + '</button></span>' +
    '</span></a>';
}

function shelfHTML(sh) {
  const open = !!expanded[sh.key];
  const bench = sh.more || [];
  return '<section class="tv-shelf" data-shelf="' + esc(sh.key) + '">' +
    '<h2 class="sec">' + esc(sh.title) + '</h2>' +
    (sh.sub ? '<p class="faint" style="margin:-8px 0 12px;font-size:.86rem">' + esc(sh.sub) + '</p>' : '') +
    '<div class="grid">' + (sh.items || []).map(cardHTML).join('') + '</div>' +
    (bench.length
      ? (open
          ? '<div class="grid" style="margin-top:12px">' + bench.map(cardHTML).join('') + '</div>' +
            '<p class="faint" style="font-size:.82rem;margin-top:10px">That\'s everything the editor stood behind in this lane tonight.</p>'
          : '<button class="more-btn" data-bench="' + esc(sh.key) + '">Show ' + bench.length +
            ' more from the editor\'s bench</button>')
      : '') +
  '</section>';
}

function durHTML(v) {
  if (!v.dur) return '';
  const live = v.dur === 'LIVE';
  return '<span class="vdur' + (live ? ' live' : '') + '">' + esc(v.dur) + '</span>';
}

function cardHTML(v) {
  const k = store.keyOf('yt:' + v.id);
  ctx.index(k, { k, kind: 'video', t: v.t, u: 'https://www.youtube.com/watch?v=' + v.id, s: v.ch, d: v.d });
  const react = store.tvReact(v.id);
  const cls = react === 'watched' ? ' is-watched' : (react === 'skip' ? ' is-skipped' : '');
  const on = store.isSaved(k);

  return '<div class="card vcard' + cls + '" data-vid="' + esc(v.id) + '">' +
    '<a class="vshell" href="https://www.youtube.com/watch?v=' + esc(v.id) + '" target="_blank" rel="noopener">' +
      '<img class="vthumb" src="' + esc(ytThumb(v.id, false)) + '" alt="" loading="lazy" decoding="async">' +
      durHTML(v) + '</a>' +
    '<div class="vbody">' +
      '<a class="vtitle" href="https://www.youtube.com/watch?v=' + esc(v.id) + '" target="_blank" rel="noopener">' +
        esc(v.t) + '</a>' +
      (v.why ? '<p class="vwhy">' + esc(v.why) + '</p>' : '') +
      '<div class="vmeta"><span>' + esc(v.ch) + '</span>' +
        (v.views ? '<span>' + esc(fmtViews(v.views)) + '</span>' : '') +
        (v.d ? '<span>' + esc(ago(v.d)) + '</span>' : '') + '</div>' +
      '<div class="fi-acts" style="opacity:1">' + reactHTML(v.id) +
        '<button data-save="' + esc(k) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        (on ? 'Saved' : 'Save') + '</button></div>' +
    '</div></div>';
}

function reactHTML(id) {
  const r = store.tvReact(id);
  return '<button data-react="watched" data-vid="' + esc(id) + '" aria-pressed="' +
      (r === 'watched' ? 'true' : 'false') + '">✓ Watched</button>' +
    '<button data-react="skip" data-vid="' + esc(id) + '" aria-pressed="' +
      (r === 'skip' ? 'true' : 'false') + '">✕ Not for me</button>';
}

/* ------------------------------------------------------------ everything */

function renderWall(body) {
  if (!wall) {
    body.innerHTML = '<p class="loading">Loading the wall…</p>';
    get('youtube')
      .then((res) => { wall = res.data.videos || []; renderWall(body); })
      .catch(() => { body.innerHTML = '<div class="empty"><b>Couldn\'t load the wall</b>Try a refresh.</div>'; });
    return;
  }

  const mutes = store.inheritedMutes().ythidden || {};
  const key = (ch) => String(ch || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  // A livestream restart reuses one title across many ids — first copy wins.
  const seen = {};
  const clean = wall.filter((v) => {
    if (mutes[key(v.ch)]) return false;
    const t = (v.t || '').toLowerCase();
    if (seen[t]) return false;
    seen[t] = 1;
    return true;
  });

  const fresh = clean.filter((v) => !v.dc).sort((a, b) => b.d - a.d);
  const deep = clean.filter((v) => v.dc);
  const shown = fresh.slice(0, state.page * WALL_PAGE);

  root.querySelector('#wt-sub').textContent =
    clean.length + ' videos from the roster · newest first';

  let html = '<h2 class="sec">This week</h2><div class="grid">' +
    shown.map(cardHTML).join('') + '</div>';

  const left = fresh.length - shown.length;
  if (left > 0) {
    html += '<button class="more-btn" data-more>More videos ↓ (' + Math.min(left, WALL_PAGE) + ' more)</button>';
  }

  if (deep.length > 8) {
    html += '<h2 class="sec">Old gold <button class="chip" data-shuffle style="margin-left:10px">Shuffle</button></h2>' +
      '<p class="faint" style="margin:-8px 0 12px;font-size:.86rem">The back catalogue of the channels we follow.</p>' +
      '<div class="grid">' + sampleN(deep, 8, state.shuffle).map(cardHTML).join('') + '</div>';
  }

  body.innerHTML = html;
  wireFallbacks(body);
}

/* ----------------------------------------------------------------- events */

function onClick(e) {
  const bench = e.target.closest('[data-bench]');
  if (bench) { expanded[bench.getAttribute('data-bench')] = true; render(); return; }

  if (e.target.closest('[data-more]')) { state.page += 1; renderWall(root.querySelector('#wt-body')); return; }

  if (e.target.closest('[data-shuffle]')) {
    state.shuffle = Date.now() & 0x7fffffff;
    renderWall(root.querySelector('#wt-body'));
    return;
  }

  const react = e.target.closest('[data-react]');
  if (react) {
    e.preventDefault();
    e.stopPropagation();
    doReact(react.getAttribute('data-vid'), react.getAttribute('data-react'));
  }
}

function doReact(vid, kind) {
  const was = store.tvReact(vid);
  const now = was === kind ? null : kind;
  store.setTvReact(vid, now);

  // Repaint every copy of this video on the page.
  root.querySelectorAll('[data-vid="' + CSS.escape(vid) + '"]').forEach((node) => {
    if (node.matches('.vcard')) {
      node.classList.toggle('is-watched', now === 'watched');
      node.classList.toggle('is-skipped', now === 'skip');
    }
    if (node.matches('[data-react]')) {
      node.setAttribute('aria-pressed', node.getAttribute('data-react') === now ? 'true' : 'false');
    }
  });

  // Hold the write so an undo inside the window never reaches the editor.
  clearTimeout(pending[vid]);
  pending[vid] = setTimeout(() => {
    delete pending[vid];
    if (now) store.rpc('tv_react', { p_player: store.playerId(), p_kind: now, p_vid: vid, p_title: '', p_channel: '' });
    else if (was) store.rpc('tv_unreact', { p_player: store.playerId(), p_kind: was, p_vid: vid });
  }, SEND_DELAY);

  ctx.toast(now === 'watched' ? 'Marked watched' : now === 'skip' ? 'Won\'t show that again' : 'Taken back',
    () => { store.setTvReact(vid, was); clearTimeout(pending[vid]); delete pending[vid]; render(); });
}
