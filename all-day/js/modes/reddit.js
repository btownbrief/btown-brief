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
import { el, esc, chip, heading, scrollHint, ago } from './../ui.js';
import { feedRow, bindFeed, hydrateVotes, keyOf } from './../rows.js';

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

function render() {
  const root = state.root;
  const muted = store.muted();
  const map = Object.create(null);
  const subs = [];

  (Array.isArray(state.pulse.sources) ? state.pulse.sources : []).forEach((s) => {
    if (!s || !s.id) return;
    map[s.id] = s;
    if (/reddit\.com/.test(s.site || '') && !muted[s.id]) subs.push(s);
  });
  subs.sort((a, b) => (a.short || '').localeCompare(b.short || ''));
  if (state.sub && !subs.some((s) => s.id === state.sub)) state.sub = null;

  const all = (Array.isArray(state.pulse.items) ? state.pulse.items : [])
    .filter((it) => it && map[it.s] && /reddit\.com/.test(map[it.s].site || '') && !muted[it.s]);
  const shown = state.sub ? all.filter((it) => it.s === state.sub) : all;
  state.byKey = new Map(all.map((it) => [keyOf(it), { it, src: map[it.s] }]));

  root.innerHTML = '';
  const updated = state.pulse.generated
    ? ago(Math.floor(new Date(state.pulse.generated).getTime() / 1000)) : '';

  heading(root, {
    eyebrow: 'Reddit',
    title: state.sub ? (map[state.sub].short || 'Threads') : 'What people are posting',
    sub: '<span class="count">' + shown.length + ' post' + (shown.length === 1 ? '' : 's') +
      ' across ' + subs.length + ' subreddit' + (subs.length === 1 ? '' : 's') +
      (updated ? ' · updated ' + esc(updated) : '') + '</span>',
  });

  const chips = el('div', 'chips');
  chips.appendChild(chip('All', state.sub === null, () => {
    state.sub = null; render(); root.scrollTo({ top: 0 });
  }));
  subs.forEach((s) => {
    const n = all.filter((it) => it.s === s.id).length;
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

  const feed = el('div', 'card feed');
  const slice = shown.slice(0, 220);
  slice.forEach((it) => {
    feed.appendChild(feedRow(it, map[it.s], { tag: map[it.s].short }));
  });
  root.appendChild(feed);
  hydrateVotes(root, slice.map(keyOf));
}
