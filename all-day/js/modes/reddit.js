/* modes/reddit.js — the threads.

   On pulse.html Reddit is one chip among thirteen and its posts are mixed
   into the firehose. Here it gets its own room, grouped by subreddit, with
   the post's preview image and — the part the firehose loses — the outbound
   article a link post actually points at, so you can go read the thing
   instead of only the argument about it.

   How the posts get here matters and is worth restating: they arrive through
   public Inoreader streams, the same as every other feed. This app makes no
   request to reddit.com and holds no Reddit credentials. Two Burlington subs
   ride along on their own per-tag streams; the rest are ordinary
   subscriptions in the "Everything" folder. */

import { get } from '../wire.js';
import * as store from '../store.js';
import { bindGestures } from '../gestures.js';
import { esc, safeUrl, ago, isReddit, subOf } from '../ui.js';

const PAGE = 60;
const LOCAL_SUBS = ['r/burlington', 'r/vermont'];

let root = null;
let ctx = null;
let data = null;
let srcMap = {};
let subs = [];
let state = { sub: 'all', page: 1, ready: false };

export default {
  mount(el, context) {
    root = el;
    ctx = context;

    root.innerHTML =
      '<div class="wrap">' +
        '<div class="page-head">' +
          '<h1>Threads</h1>' +
          '<p class="sub" id="rx-sub">Loading the boards…</p>' +
        '</div>' +
        '<nav class="rail" id="rx-rail" aria-label="Subreddits"></nav>' +
        '<div class="feed" id="rx-feed"><p class="loading">Loading the boards…</p></div>' +
      '</div>';

    root.querySelector('#rx-rail').addEventListener('click', (e) => {
      const c = e.target.closest('.chip[data-sub]');
      if (!c) return;
      state.sub = c.dataset.sub;
      state.page = 1;
      render();
      root.scrollTop = 0;
    });

    root.querySelector('#rx-feed').addEventListener('click', (e) => {
      if (e.target.closest('[data-more]')) { state.page += 1; render(); }
    });

    bindGestures(root.querySelector('#rx-feed'), {
      onSave(key) { ctx.save(key); },
      onDig(key, row) {
        const item = ctx.rowFor(key);
        if (!item) return;
        if (!store.dig(key)) { ctx.toast('Already dug that today'); return; }
        if (row) row.classList.add('is-dug');
        store.rpc('pulse_react', {
          p_player: store.playerId(), p_kind: 'dig',
          p_url: item.u, p_title: item.t, p_source: item.s || '',
        });
        ctx.toast('Dug \u2193', () => {
          store.undig(key);
          if (row) row.classList.remove('is-dug');
        });
      },
    });

    get('pulse')
      .then((res) => {
        data = res.data;
        srcMap = {};
        (data.sources || []).forEach((s) => { srcMap[s.id] = s; });
        subs = (data.sources || []).filter(isReddit).sort((a, b) => {
          const al = LOCAL_SUBS.indexOf((a.short || '').toLowerCase());
          const bl = LOCAL_SUBS.indexOf((b.short || '').toLowerCase());
          if (al !== bl) return (al < 0 ? 99 : al) - (bl < 0 ? 99 : bl);
          return (a.pr || 500) - (b.pr || 500);
        });
        state.ready = true;
        render();
      })
      .catch(() => {
        root.querySelector('#rx-feed').innerHTML =
          '<div class="empty"><b>Couldn\'t reach the boards</b>Try a refresh.</div>';
      });
  },
};

function items() {
  const ids = {};
  subs.forEach((s) => {
    if (state.sub === 'all' || (s.short || '').toLowerCase() === state.sub) ids[s.id] = s;
  });
  return (data.items || []).filter((it) => ids[it.s]);
}

function render() {
  if (!state.ready) return;

  root.querySelector('#rx-rail').innerHTML =
    '<button class="chip c-reddit" data-sub="all" aria-pressed="' +
      (state.sub === 'all' ? 'true' : 'false') + '">all</button>' +
    subs.map((s) => {
      const key = (s.short || '').toLowerCase();
      return '<button class="chip c-reddit" data-sub="' + esc(key) + '" aria-pressed="' +
        (state.sub === key ? 'true' : 'false') + '">' + esc(s.short) + '</button>';
    }).join('');

  const all = items();
  const shown = all.slice(0, state.page * PAGE);
  const feed = root.querySelector('#rx-feed');

  root.querySelector('#rx-sub').textContent =
    all.length + ' posts across ' + subs.length + ' subreddits' +
    (state.sub === 'all' ? '' : ' · showing ' + state.sub);

  if (!shown.length) {
    feed.innerHTML = '<div class="empty"><b>Quiet in here</b>Nothing new on this board.</div>';
    return;
  }

  let html = shown.map(postHTML).join('');
  const left = all.length - shown.length;
  if (left > 0) {
    html += '<button class="more-btn" data-more>More posts ↓ (' + Math.min(left, PAGE) + ' more)</button>';
  } else {
    html += '<div class="caught-up">That\'s every post we have ✓</div>';
  }
  feed.innerHTML = html;
}

function postHTML(it) {
  const src = srcMap[it.s] || {};
  const k = store.keyOf(it.u);
  ctx.index(k, { k, kind: 'article', t: it.t, u: it.u, s: src.short, d: it.d, i: it.i });

  const thread = safeUrl(it.u);
  const out = it.o ? safeUrl(it.o) : '';
  const sub = src.short || subOf(it.u) || 'reddit';

  // The link a post submitted is the point of a link post — surface the
  // publisher by name rather than making it a mystery behind the thread.
  let outBit = '';
  if (out) {
    let host = '';
    try { host = new URL(out).hostname.replace(/^www\./, ''); } catch (e) { /* leave blank */ }
    outBit = '<a class="disc" style="color:var(--accent)" href="' + esc(out) +
      '" target="_blank" rel="noopener" data-readkey="' + esc(k) + '">↗ ' + esc(host) + '</a>';
  }

  const thumb = (it.i && store.setting('thumbs'))
    ? '<img class="fi-thumb" src="' + esc(safeUrl(it.i)) + '" alt="" loading="lazy" decoding="async">'
    : '';

  const on = store.isSaved(k);

  return '<div class="fi' + (store.isRead(k) ? ' is-read' : '') +
      (store.isDug(k) ? ' is-dug' : '') + '" data-k="' + esc(k) +
      '" data-src="' + esc(it.s) + '">' +
    '<div class="fi-body">' +
      '<a class="fi-t" href="' + esc(thread) + '" target="_blank" rel="noopener" data-readkey="' +
        esc(k) + '">' + esc(it.t) + '</a>' +
      '<div class="fi-m">' +
        '<span class="fi-src c-reddit">' + esc(sub) + '</span>' +
        '<span>' + esc(ago(it.d)) + '</span>' + outBit +
        '<button class="fi-save" data-save="' + esc(k) + '" aria-pressed="' +
          (on ? 'true' : 'false') + '" aria-label="Save">' + (on ? '★' : '☆') + '</button>' +
      '</div>' +
    '</div>' + thumb + '</div>';
}
