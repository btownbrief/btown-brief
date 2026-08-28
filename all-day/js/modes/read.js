/* modes/read.js — the wire.

   This is the Pulse's reading surface, rebuilt against the same payload. The
   judgement is carried over deliberately, not reinvented:

     · 120 headlines per page behind an explicit button. No infinite scroll.
     · The local floor: on ALL, every block of five in the first 120 is
       guaranteed at least one Burlington headline, promoted from below —
       but never one more than a day older than the block it lands in.
     · Three ways of being seen. Read (you clicked it) dims the row. The
       since-your-last-visit divider says where you left off.
     · Reddit and podcasts are not topics here. They have their own tabs.

   Source mutes are inherited from pulse.html and never written back. */

import { get } from '../wire.js';
import * as store from '../store.js';
import { bindGestures } from '../gestures.js';
import { esc, safeUrl, ago, topicClass, isReddit, subOf } from '../ui.js';

const PAGE = 120;
const FLOOR_BLOCK = 5;      // one local headline per five, in the first page
const FLOOR_MAX_LAG = 86400; // never promote a local story a day staler than its block

const TOPIC_ORDER = ['all', 'local', 'news', 'newsletters', 'tech', 'business',
  'science', 'culture', 'politics', 'sports', 'gaming'];

let root = null;
let ctx = null;
let data = null;
let srcMap = {};
let mutes = {};
let state = { topic: 'all', page: 1, q: '', ready: false, stale: false };
let baseline = 0;

export default {
  mount(el, context) {
    root = el;
    ctx = context;
    mutes = store.inheritedMutes().hidden || {};
    baseline = store.visitBaseline();

    root.innerHTML =
      '<div class="wrap">' +
        '<div class="page-head">' +
          '<h1>The wire</h1>' +
          '<p class="sub" id="rd-sub">Taking the pulse…</p>' +
        '</div>' +
        '<div class="searchwrap" id="rd-searchwrap" hidden>' +
          '<input class="searchbox" id="rd-search" type="search" placeholder="Search every headline" autocomplete="off">' +
        '</div>' +
        '<nav class="rail" id="rd-rail" aria-label="Topics"></nav>' +
        '<div id="rd-top"></div>' +
        '<div class="feed" id="rd-feed"><p class="loading">Taking the pulse…</p></div>' +
      '</div>';

    root.querySelector('#rd-rail').addEventListener('click', (e) => {
      const c = e.target.closest('.chip[data-topic]');
      if (!c) return;
      state.topic = c.dataset.topic;
      state.page = 1;
      render();
      root.scrollTop = 0;
    });

    const search = root.querySelector('#rd-search');
    let t = 0;
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { state.q = search.value.trim(); state.page = 1; render(); }, 130);
    });

    root.querySelector('#rd-feed').addEventListener('click', (e) => {
      if (e.target.closest('[data-more]')) { state.page += 1; render(); }
      if (e.target.closest('[data-hint-done]')) { store.setSetting('gestureHint', 'done'); render(); }
    });

    bindGestures(root.querySelector('#rd-feed'), {
      onSave(key) { ctx.save(key); learned(); },
      onDig(key, row) { doDig(key, row); learned(); },
      onHold(key, row) { muteFrom(row); learned(); },
    });

    load();
  },

  activate() { store.touchVisit(); },

  focusSearch() {
    const w = root.querySelector('#rd-searchwrap');
    w.hidden = !w.hidden;
    if (!w.hidden) root.querySelector('#rd-search').focus();
  },
};

function load() {
  get('pulse')
    .then((res) => {
      data = res.data;
      state.stale = res.stale;
      state.ready = true;
      srcMap = {};
      (data.sources || []).forEach((s) => { srcMap[s.id] = s; });
      render();
      loadTop();
    })
    .catch(() => {
      root.querySelector('#rd-feed').innerHTML =
        '<div class="empty"><b>Couldn\'t reach the wire</b>Try a refresh.</div>';
    });
}

/* TOP is a small curated strip above the feed — 25 picks chosen three times a
   day, verbatim headlines, never model-written. Only shown while fresh. */
function loadTop() {
  get('top')
    .then((res) => {
      const d = res.data;
      const fresh = d && d.generated &&
        (Date.now() - Date.parse(d.generated)) < 30 * 3600 * 1000;
      if (!fresh || !d.picks || !d.picks.length) return;
      const picks = d.picks.slice(0, 6);
      root.querySelector('#rd-top').innerHTML =
        '<p class="eyebrow accent" style="margin-top:16px">Today\'s picks</p>' +
        '<div class="feed" style="margin-bottom:6px">' +
        picks.map((p) => {
          const k = store.keyOf(p.u);
          ctx.index(k, { k, kind: 'article', t: p.t, u: p.u, s: p.short, d: p.d });
          const u = safeUrl(p.u);
          return '<div class="fi' + (store.isRead(k) ? ' is-read' : '') + '">' +
            '<div class="fi-body">' +
              '<a class="fi-t" href="' + esc(u) + '" target="_blank" rel="noopener" ' +
                'data-readkey="' + esc(k) + '" title="' + esc(p.why || '') + '">' + esc(p.t) + '</a>' +
              '<div class="fi-m">' +
                '<span class="fi-src' + (p.local ? ' c-local' : '') + '">' + esc(p.short) + '</span>' +
                '<span>' + esc(ago(p.d)) + '</span>' + saveButton(k) +
              '</div>' +
            '</div></div>';
        }).join('') + '</div>' +
        '<p class="eyebrow" style="margin-top:18px">Everything, newest first</p>';
    })
    .catch(() => { /* the strip is a bonus, not the page */ });
}

/* ------------------------------------------------------------- filtering */

function visibleSources() {
  mutes = store.inheritedMutes().hidden || {};
  return (data.sources || []).filter((s) => !mutes[s.id] && !isReddit(s) && !s.pod);
}

function inTopic(src, topic) {
  if (topic === 'all') return true;
  return src.topic === topic;
}

function matches(item, src, q) {
  if (!q) return true;
  const hay = (item.t + ' ' + (src.short || '') + ' ' + (src.name || '')).toLowerCase();
  return q.toLowerCase().split(/\s+/).every((term) => hay.indexOf(term) >= 0);
}

function filtered() {
  const ok = {};
  visibleSources().forEach((s) => { if (inTopic(s, state.topic)) ok[s.id] = s; });
  return (data.items || []).filter((it) => {
    const src = ok[it.s];
    return src && matches(it, src, state.q);
  });
}

/* The local floor. Deterministic, ALL-tab only, and off during a search —
   a search is explicit retrieval and should see exactly what it asked for. */
function blendLocalFloor(items) {
  if (state.topic !== 'all' || state.q) return items;
  const out = [];
  const held = [];
  let pool = items.slice();

  while (out.length < PAGE && pool.length) {
    const block = pool.splice(0, FLOOR_BLOCK);
    const hasLocal = block.some((it) => srcMap[it.s] && srcMap[it.s].local);
    if (!hasLocal) {
      const anchor = block[0] ? block[0].d : 0;
      const at = pool.findIndex((it) =>
        srcMap[it.s] && srcMap[it.s].local && (anchor - it.d) < FLOOR_MAX_LAG);
      if (at >= 0) {
        const local = pool.splice(at, 1)[0];
        held.push(block.pop());   // displaced, not dropped
        block.push(local);
      }
    }
    out.push(...block);
  }
  return out.concat(held, pool);
}

/* ---------------------------------------------------------------- render */

function render() {
  if (!state.ready) return;
  renderRail();
  renderSub();

  const all = blendLocalFloor(filtered());
  const shown = all.slice(0, state.page * PAGE);
  const feed = root.querySelector('#rd-feed');

  if (!shown.length) {
    feed.innerHTML = state.q
      ? '<div class="empty"><b>Nothing matches “' + esc(state.q) + '”</b>Try fewer words.</div>'
      : '<div class="empty"><b>Nothing here yet</b>This topic is quiet.</div>';
    return;
  }

  /* The divider only earns its place when there is something on both sides of
     it. On a first-ever visit everything is older than the baseline, and a
     "since you were here" line above the very first headline is a lie. */
  const fresh = shown.filter((it) => it.d >= baseline).length;
  const showDivider = state.topic === 'all' && !state.q && fresh > 0 && fresh < shown.length;

  let html = hintHTML();
  let dividerDrawn = false;

  shown.forEach((it) => {
    if (showDivider && !dividerDrawn && it.d < baseline) {
      dividerDrawn = true;
      html += '<div class="since">' + fresh + ' new since you were here</div>';
    }
    html += itemHTML(it);
  });

  const left = all.length - shown.length;
  if (left > 0) {
    html += '<button class="more-btn" data-more>More headlines ↓ (' +
      Math.min(left, PAGE) + ' more)</button>';
  } else {
    html += '<div class="caught-up">That\'s the whole wire ✓</div>';
  }

  feed.innerHTML = html;
}

function renderSub() {
  const el = root.querySelector('#rd-sub');
  const n = (data.items || []).length;
  const when = data.generated ? ago(Math.floor(Date.parse(data.generated) / 1000)) : '';
  el.innerHTML = esc(n.toLocaleString() + ' headlines from ' +
    (data.sources || []).length + ' sources' + (when ? ' · updated ' + when + ' ago' : '')) +
    (state.stale ? ' <span class="faint">(showing the last good copy)</span>' : '');
}

function renderRail() {
  const counts = {};
  visibleSources().forEach((s) => { counts[s.topic] = (counts[s.topic] || 0) + 1; });

  const html = TOPIC_ORDER
    .filter((t) => t === 'all' || counts[t])
    .map((t) => {
      const cls = t === 'all' ? '' : ' ' + topicClass(t);
      return '<button class="chip' + cls + '" data-topic="' + t + '" aria-pressed="' +
        (state.topic === t ? 'true' : 'false') + '">' + esc(t) + '</button>';
    }).join('');
  root.querySelector('#rd-rail').innerHTML = html;
}

/* The save control rides in the metadata line rather than on a row of its
   own. A dedicated action row cost every headline about 30px of height for a
   control that is almost never the thing you came for. */
/* A gesture nobody knows about is not a feature, so the card stays until you
   have actually used one. */
function learned() {
  if (store.setting('gestureHint') !== 'done') store.setSetting('gestureHint', 'done');
}

function hintHTML() {
  if (store.setting('gestureHint') === 'done') return '';
  return '<div class="hint">' +
    '<b>Two shortcuts</b>' +
    '<p>Swipe a headline <b>right</b> to save it, <b>left</b> to dig it. ' +
    'Press and hold to stop showing that source.</p>' +
    '<button data-hint-done>Got it</button></div>';
}

/* A dig is a public vote — one per story per Eastern day, feeding the same
   pulse_react function pulse.html writes to, so both pages count together. */
function doDig(key, row) {
  const item = ctx.rowFor(key);
  if (!item) return;
  if (!store.dig(key)) { ctx.toast('Already dug that today'); return; }
  if (row) row.classList.add('is-dug');
  store.rpc('pulse_react', {
    p_player: store.playerId(), p_kind: 'dig',
    p_url: item.u, p_title: item.t, p_source: item.s || '',
  });
  ctx.toast('Dug ↓', () => {
    store.undig(key);
    if (row) row.classList.remove('is-dug');
  });
}

function muteFrom(row) {
  const id = row && row.getAttribute('data-src');
  const src = srcMap[id];
  if (!src) return;
  store.muteSource(id);
  render();
  ctx.toast('Hiding ' + (src.short || 'that source'), () => {
    store.unmuteSource(id);
    render();
  });
}

function saveButton(k) {
  const on = store.isSaved(k);
  return '<button class="fi-save" data-save="' + esc(k) + '" aria-pressed="' +
    (on ? 'true' : 'false') + '" aria-label="Save">' + (on ? '★' : '☆') + '</button>';
}

function itemHTML(it) {
  const src = srcMap[it.s] || {};
  const k = store.keyOf(it.u);
  const tc = topicClass(src.topic);

  // Email-only newsletter items have no public copy to link to.
  const emailOnly = !!it.x;
  if (!emailOnly) {
    ctx.index(k, { k, kind: 'article', t: it.t, u: it.u, s: src.short, d: it.d, i: it.i });
  }

  const u = safeUrl(it.u);
  const title = emailOnly || !u
    ? '<span class="fi-t nolink">' + esc(it.t) + '</span>'
    : '<a class="fi-t" href="' + esc(u) + '" target="_blank" rel="noopener" data-readkey="' +
      esc(k) + '">' + esc(it.t) + '</a>';

  let bits = '';
  if (it.r) {
    const sub = subOf(it.r) || 'reddit';
    bits += '<a class="disc" href="' + esc(safeUrl(it.r)) +
      '" target="_blank" rel="noopener">[' + esc(sub) + ']</a>';
  }
  if (it.h) {
    bits += '<a class="disc hn" href="' + esc(safeUrl(it.h)) + '" target="_blank" rel="noopener">[hn' +
      (it.hc ? '·' + it.hc : '') + ']</a>';
  } else if (it.du) {
    bits += '<a class="disc hn" href="' + esc(safeUrl(it.du)) + '" target="_blank" rel="noopener">[hn' +
      (it.dn ? '·' + it.dn : '') + ']</a>';
  }

  const thumb = (it.i && store.setting('thumbs'))
    ? '<img class="fi-thumb" src="' + esc(safeUrl(it.i)) + '" alt="" loading="lazy" decoding="async">'
    : '';

  return '<div class="fi' + (store.isRead(k) ? ' is-read' : '') +
      (store.isDug(k) ? ' is-dug' : '') + '" data-k="' + esc(k) +
      '" data-src="' + esc(it.s) + '">' +
    '<div class="fi-body">' + title +
      '<div class="fi-m">' +
        '<span class="fi-src ' + tc + '">' + esc(src.short || '—') + '</span>' +
        '<span>' + esc(ago(it.d)) + '</span>' + bits +
        (emailOnly ? '' : saveButton(k)) +
      '</div>' +
    '</div>' + thumb + '</div>';
}
