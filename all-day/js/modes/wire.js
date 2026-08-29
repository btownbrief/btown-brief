/* wire.js (mode) — the headline wire.

   Two payloads. pulse-top.json carries the editorial picks, rebuilt three
   times a day, each with a one-line `why`; pulse.json is the full 2,500-item
   wire underneath. The picks now ship with an archive of past editions, so
   the most-read thing on the site stops vanishing at every rebuild — you can
   page back through the week.

   The picks ride a carousel because they are the most important thing here
   and deserve the space, and every carousel in this app announces itself:
   dots per page, a progress bar and a count. A rail with no affordance is
   invisible to most people.

   Local is not a topic among topics. It is the reason this paper exists, so
   it gets its own switch, its own colour and a left edge you can see while
   scrolling past. The switch says "Local only" as an instruction, because
   labelled as a state people read the whole wire as already-local and never
   press it. */

import * as store from './../store.js';
import * as data from './../wire.js';
import * as app from './../app.js';
import { bindGestures } from './../gestures.js';
import { el, esc, safeHref, ago, rail, chip, heading, voteBtn, paintVote, ICON } from './../ui.js';
import { feedRow, bindFeed, hydrateVotes, keyOf, isLocalSource } from './../rows.js';

const PAGE = 60;

const state = {
  root: null,
  pulse: null,
  top: null,
  shown: PAGE,
  edition: 0,        // 0 = today, 1 = the one before, …
  q: '',
  byKey: new Map(),
};

const TOPICS = [
  ['all', 'Everything'], ['popular', '▲ Popular'], ['local', 'Local'], ['news', 'News'], ['politics', 'Politics'],
  ['business', 'Business'], ['tech', 'Tech'], ['science', 'Science'],
  ['sports', 'Sports'], ['culture', 'Culture'], ['gaming', 'Gaming'],
  ['newsletters', 'Newsletters'],
];

export function mount(root) {
  state.root = root;
  root.innerHTML = '<p class="loading">Loading the wire…</p>';

  data.load('pulse', (json) => { state.pulse = json; render(); }, () => {
    root.innerHTML = '';
    const box = el('div', 'errbox', '<b>Couldn’t reach the wire.</b><br>The feed is served from GitHub — if you are offline it will come back on its own.');
    root.appendChild(box);
  });
  data.load('top', (json) => { state.top = json; if (state.pulse) render(); }, () => {});

  bindGestures(root, bindFeed(root, (k) => state.byKey.get(k), () => render()));
}

export function activate() {}
export function refresh() { if (state.pulse) render(); }
export function deactivate() { app.closePeek(); }

/* every edition we can show: today, then the archive */
function editions() {
  const t = state.top;
  if (!t) return [];
  const list = [{ generated: t.generated, picks: t.picks }];
  const archive = Array.isArray(t.editions) ? t.editions
    : (t.prev ? [t.prev] : []);
  archive.forEach((e) => {
    if (e && Array.isArray(e.picks) && e.generated) list.push(e);
  });
  return list;
}

function sourceMap() {
  const m = Object.create(null);
  (Array.isArray(state.pulse.sources) ? state.pulse.sources : [])
    .forEach((s) => { if (s && s.id) m[s.id] = s; });
  return m;
}

function render() {
  const root = state.root;
  const set = store.settings();
  const muted = store.muted();
  const map = sourceMap();
  const base = store.visitBase();

  const all = (Array.isArray(state.pulse.items) ? state.pulse.items : []).filter((it) => {
    const s = it && map[it.s];
    if (!s || muted[s.id]) return false;
    if (/reddit\.com/.test(s.site || '')) return false;   // Reddit has its own tab
    return true;
  });

  const shown = all.filter((it) => {
    const s = map[it.s];
    if (set.localOnly && !isLocalSource(s)) return false;
    if (set.topic !== 'all' && s.topic !== set.topic) return false;
    if (set.focus && store.isRead(keyOf(it))) return false;
    if (state.q) {
      const hay = (it.t + ' ' + (s.short || s.name || '')).toLowerCase();
      if (!state.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });

  state.byKey = new Map(all.map((it) => [keyOf(it), { it, src: map[it.s] }]));

  root.innerHTML = '';
  renderPicks(root, map);

  const sourceCount = new Set(shown.map((it) => it.s)).size;
  const updated = state.pulse.generated
    ? ago(Math.floor(new Date(state.pulse.generated).getTime() / 1000)) : '';

  const localBtn = chip(
    set.localOnly ? '✓ Local only' : 'View local only',
    set.localOnly,
    () => { store.setSetting('localOnly', !set.localOnly); state.shown = PAGE; render(); root.scrollTo({ top: 0 }); },
    'local-switch'
  );

  heading(root, {
    eyebrow: set.topic === 'popular' ? 'Popular' : 'The wire',
    title: set.topic === 'popular' ? 'What readers upvoted'
      : state.q ? 'Matching “' + state.q + '”'
      : (set.localOnly ? 'Burlington only' : 'Everything, newest first'),
    sub: '<span class="count">' + shown.length.toLocaleString() + ' headlines from ' +
      sourceCount + ' source' + (sourceCount === 1 ? '' : 's') +
      (updated ? ' · updated ' + esc(updated) : '') + '</span>',
    right: localBtn,
  });

  const chips = el('div', 'chips');
  TOPICS.forEach(([value, label]) => {
    if (value !== 'all' && value !== 'local' && value !== 'popular' &&
        !all.some((it) => map[it.s]?.topic === value)) return;
    chips.appendChild(chip(label, set.topic === value, () => {
      store.setSetting('topic', value);
      state.shown = PAGE;
      render();
      root.scrollTo({ top: 0 });
    }));
  });
  root.appendChild(chips);

  const box = el('div', 'search');
  box.style.margin = '0 0 14px';
  box.innerHTML =
    '<svg class="mag" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>' +
    '<input id="wire-q" type="search" autocomplete="off" placeholder="Search every headline">';
  const input = box.querySelector('input');
  input.value = state.q;
  let typing = 0;
  input.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      state.q = input.value.trim();
      state.shown = PAGE;
      render();
      /* keep the caret where it was — a re-render must not eject you */
      const next = root.querySelector('#wire-q');
      if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
    }, 220);
  });
  root.appendChild(box);

  if (set.topic === 'popular') { renderPopular(root); return; }

  if (!shown.length) {
    root.appendChild(el('p', 'empty', state.q
      ? 'Nothing on the wire matches “' + state.q + '”.'
      : set.focus
        ? 'Nothing left — you have read everything here. Turn Focus off in Settings to see it again.'
        : 'Nothing on the wire for that.'));
    return;
  }

  const feed = el('div', 'card feed');
  const slice = shown.slice(0, state.shown);
  slice.forEach((it) => {
    feed.appendChild(feedRow(it, map[it.s], { isNew: base && it.d > base }));
  });
  root.appendChild(feed);

  if (state.shown < shown.length) {
    const more = el('button', 'more', 'More headlines');
    more.addEventListener('click', () => { state.shown += PAGE; render(); });
    root.appendChild(more);
  } else {
    root.appendChild(el('p', 'caught', 'You’re caught up ✓'));
  }

  hydrateVotes(root, slice.map(keyOf));
}

function renderPicks(root, map) {
  const list = editions();
  if (!list.length) return;
  const idx = Math.min(state.edition, list.length - 1);
  const edition = list[idx];
  const stamp = Math.floor(new Date(edition.generated).getTime() / 1000);

  const nav = el('div', 'picks-when');
  const back = el('button', 'iconbtn', ICON.chev);
  back.style.transform = 'rotate(90deg)';
  back.setAttribute('aria-label', 'Earlier picks');
  back.disabled = idx >= list.length - 1;
  back.style.opacity = back.disabled ? '.35' : '1';
  back.addEventListener('click', () => { state.edition = idx + 1; render(); });

  const fwd = el('button', 'iconbtn', ICON.chev);
  fwd.style.transform = 'rotate(-90deg)';
  fwd.setAttribute('aria-label', 'Later picks');
  fwd.disabled = idx <= 0;
  fwd.style.opacity = fwd.disabled ? '.35' : '1';
  fwd.addEventListener('click', () => { state.edition = idx - 1; render(); });
  nav.append(back, fwd);

  heading(root, {
    eyebrow: idx === 0 ? 'The picks' : 'The picks · earlier',
    title: idx === 0 ? 'What matters today' : 'What mattered then',
    sub: '<span class="count">Chosen ' + esc(ago(stamp)) +
      (list.length > 1 ? ' · ' + (idx + 1) + ' of ' + list.length + ' editions' : '') + '</span>',
    right: list.length > 1 ? nav : null,
  });

  const { track, sync } = rail(root, { label: 'picks' });
  edition.picks.forEach((p) => {
    if (!p || !p.t) return;
    const card = el('a', 'pick' + (p.local ? ' is-local' : ''));
    card.href = safeHref(p.u);
    card.target = '_blank';
    card.rel = 'noopener';
    card.innerHTML =
      '<span class="fi-meta">' +
        (p.local ? '<span class="tag-local">Local</span>' : '') +
        '<span class="fi-src">' + esc(p.short || '') + '</span>' +
      '</span>' +
      '<span class="pick-title">' + esc(p.t) + '</span>' +
      (p.why ? '<span class="pick-why">' + esc(p.why) + '</span>' : '');
    card.addEventListener('click', () => store.markRead(p.u));
    track.appendChild(card);
  });
  sync();
}

/* ---------------------------------------------------------------- popular */
/* Votes are cast on headlines, videos, episodes and Wikipedia articles
   alike, so this list is deliberately mixed — it is the one place the five
   tabs meet. The rows are drawn from what was stored with each vote rather
   than looked up again, because a headline can fall off the wire while the
   votes it earned are still worth showing. */

const KIND_LABEL = { wire: 'Headline', video: 'Video', episode: 'Episode', wiki: 'Wikipedia', reddit: 'Thread' };

function renderPopular(root) {
  const holder = el('div');
  holder.appendChild(el('p', 'loading', 'Counting votes…'));
  root.appendChild(holder);

  store.topVoted(60).then((rows) => {
    holder.innerHTML = '';
    if (rows === null) {
      holder.appendChild(el('div', 'errbox',
        '<b>Voting isn’t switched on yet.</b><br>The counter needs its table created in Supabase — ' +
        'until then the arrows stay hidden and everything else works as normal.'));
      return;
    }
    if (!rows.length) {
      holder.appendChild(el('p', 'empty', 'No votes yet. Tap ▲ on anything worth pointing at.'));
      return;
    }
    const feed = el('div', 'card feed');
    rows.forEach((r) => {
      const row = el('div', 'fi');
      row.dataset.k = r.k;
      const link = el('a', 'fi-body');
      link.href = safeHref(r.href || '#');
      if (!/^#/.test(r.href || '')) { link.target = '_blank'; link.rel = 'noopener'; }
      link.innerHTML = '<span class="fi-title">' + esc(r.title || 'Untitled') + '</span>' +
        '<span class="fi-meta"><span class="tag-local">' + esc(KIND_LABEL[r.kind] || 'Saved') + '</span>' +
        '<span class="fi-src">' + esc(r.from || '') + '</span></span>';
      row.appendChild(link);

      const foot = el('div', 'fi-foot');
      foot.appendChild(el('span', 'spacer'));
      const vote = voteBtn(store.voteCount(r.k), store.hasVoted(r.k), true);
      vote.addEventListener('click', () => {
        const on = store.toggleVote(r);
        paintVote(vote, store.voteCount(r.k), on);
      });
      foot.appendChild(vote);
      row.appendChild(foot);
      feed.appendChild(row);
    });
    holder.appendChild(feed);
  });
}
