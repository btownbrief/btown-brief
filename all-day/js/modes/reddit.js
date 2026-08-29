/* reddit.js — the threads, off the same pulse.json wire.

   There is no Reddit API call here and there never will be: titles come off
   the feeds we already pull, and the row links out to the thread. That is a
   standing rule, not a limitation to route around.

   source.short is already "r/sub" shaped, so it doubles as the filter chip
   and as the row's badge. */

import * as store from './../store.js';
import * as data from './../wire.js';
import * as app from './../app.js';
import { bindGestures } from './../gestures.js';
import { el, esc, chip, heading, scrollHint, ago, tipBar, tabStamp, stampOf, localSwitch } from './../ui.js';
import { feedRow, bindFeed, hydrateVotes, watchPassed, keyOf } from './../rows.js';

const state = { root: null, pulse: null, sub: null, byKey: new Map() };

export function mount(root) {
  state.root = root;
  root.innerHTML = '<p class="loading">Loading threads…</p>';
  data.load('pulse', (json) => { state.pulse = json; render(); }, () => {
    root.innerHTML = '';
    root.appendChild(el('div', 'errbox', '<b>Couldn’t reach the wire.</b><br>Threads ride the same feed as the headlines.'));
  });
  bindGestures(root, bindFeed(root, (k) => state.byKey.get(k), () => render()));
}

export function activate() {}
export function refresh() { if (state.pulse) render(); }
export function deactivate() { app.closePeek(); }

/* r/burlington and r/vermont — this tab's local, and the only two subs where
   the poster is probably standing in the same town as the reader. */
const LOCAL_SUBS = ['r/burlington', 'r/vermont'];
const isLocalSub = (src) => LOCAL_SUBS.indexOf(String(src?.short || '').toLowerCase()) !== -1;

function render() {
  const root = state.root;
  const set = store.settings();
  const muted = store.muted();
  const map = Object.create(null);
  const subs = [];

  (Array.isArray(state.pulse.sources) ? state.pulse.sources : []).forEach((s) => {
    if (!s || !s.id) return;
    map[s.id] = s;
    if (/reddit\.com/.test(s.site || '') && !muted[s.id]) subs.push(s);
  });
  /* Not alphabetical. r/burlington and r/vermont are the reason this tab
     exists, then the news subs, then the specialist ones, and the three you
     dip into rather than read — jokes, AI, basketball — bring up the rear. */
  const LEAD = ['r/burlington', 'r/vermont', 'r/news', 'r/worldnews',
    'r/science', 'r/technology'];
  const TAIL = ['r/jokes', 'r/artificial', 'r/nba'];
  const rank = (x) => {
    const n = (x.short || '').toLowerCase();
    const lead = LEAD.indexOf(n);
    if (lead !== -1) return lead;
    const tail = TAIL.indexOf(n);
    return tail !== -1 ? LEAD.length + 1 + tail : LEAD.length;
  };
  subs.sort((a, b) => rank(a) - rank(b) || (a.short || '').localeCompare(b.short || ''));

  const all = (Array.isArray(state.pulse.items) ? state.pulse.items : [])
    .filter((it) => it && map[it.s] && /reddit\.com/.test(map[it.s].site || '') && !muted[it.s]);

  /* in local mode the chip row shrinks to the two local subs, so a sub you
     had picked earlier has to let go */
  const chipSubs = set.localOnly ? subs.filter(isLocalSub) : subs;
  if (state.sub && !chipSubs.some((s) => s.id === state.sub)) state.sub = null;

  const scoped = set.localOnly ? all.filter((it) => isLocalSub(map[it.s])) : all;
  const shown = state.sub ? scoped.filter((it) => it.s === state.sub) : scoped;
  state.byKey = new Map(all.map((it) => [keyOf(it), { it, src: map[it.s] }]));

  root.innerHTML = '';

  /* Reddit's local is the two subs the town actually reads. */
  const localPosts = all.filter((it) => isLocalSub(map[it.s])).length;
  localSwitch(root, {
    on: set.localOnly,
    local: localPosts,
    all: all.length,
    noun: 'posts',
    onChange(on) { app.setLocal(on); root.scrollTo({ top: 0 }); },
  });

  tabStamp(root, stampOf(state.pulse.generated), 'reddit, every 20 minutes');

  heading(root, {
    eyebrow: 'Reddit',
    title: state.sub ? (map[state.sub].short || 'Threads') : 'What people are posting',
    sub: '<span class="count">' + shown.length + ' post' + (shown.length === 1 ? '' : 's') +
      ' across ' + chipSubs.length + ' subreddit' + (chipSubs.length === 1 ? '' : 's') + '</span>',
  });

  const chips = el('div', 'chips');
  chips.appendChild(chip('All', state.sub === null, () => {
    state.sub = null; render(); root.scrollTo({ top: 0 });
  }));
  chipSubs.forEach((s) => {
    const n = scoped.filter((it) => it.s === s.id).length;
    const b = chip(s.short || s.id, state.sub === s.id, () => {
      state.sub = s.id; render(); root.scrollTo({ top: 0 });
    });
    b.appendChild(el('span', 'n', n));
    chips.appendChild(b);
  });
  root.appendChild(chips);
  scrollHint(chips);

  if (!shown.length) {
    root.appendChild(el('p', 'empty', 'No threads on the wire right now.'));
    return;
  }

  const feed = el('div', 'feed');
  const slice = shown.slice(0, 220);
  slice.forEach((it) => {
    /* the sub name is the tag here; feedRow's own outlet line would print
       "r/vermont" a second time right beside it. Thumbnails stay — a map or
       a photo is often the whole post. */
    feed.appendChild(feedRow(it, map[it.s], { tag: map[it.s].short, noSource: true }));
  });
  root.appendChild(feed);
  tipBar(root, 'swipe',
    '<span>Swipe a post <b>left</b> to mute that subreddit, <b>right</b> to save it.</span>');
  hydrateVotes(root, slice.map(keyOf));
  watchPassed(root);
}
