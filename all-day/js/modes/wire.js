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
import { el, esc, safeHref, ago, rail, chip, heading, scrollHint, voteBtn, paintVote, starBtn,
  tipBar, tabStamp, stampOf, localSwitch, ICON } from './../ui.js';
import { feedRow, bindFeed, hydrateVotes, watchPassed, keyOf, isLocalSource } from './../rows.js';

const PAGE = 60;

const state = {
  root: null,
  pulse: null,
  top: null,
  shown: PAGE,
  edition: 0,        // 0 = today, 1 = the one before, …
  q: '',
  qOpen: false,
  wx: null,
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
  data.load('weather', (json) => { state.wx = json; if (state.pulse) render(); }, () => {});

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

  /* the source filter is remembered across visits; if that outlet has since
     been muted or dropped from the roster, its chip is gone too and the
     reader would be stuck on an empty wire with nothing to un-press */
  if (set.source && (!map[set.source] || muted[set.source])) {
    store.setSetting('source', '');
    set.source = '';
  }

  const all = (Array.isArray(state.pulse.items) ? state.pulse.items : []).filter((it) => {
    const s = it && map[it.s];
    if (!s || muted[s.id]) return false;
    if (/reddit\.com/.test(s.site || '')) return false;   // Reddit has its own tab
    return true;
  });

  const shown = all.filter((it) => {
    const s = map[it.s];
    if (set.source && s.id !== set.source) return false;
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

  /* how many headlines the other mode would show, so the switch can say what
     it costs you before you press it */
  const localCount = all.filter((it) => isLocalSource(map[it.s])).length;
  localSwitch(root, {
    on: set.localOnly,
    local: localCount,
    all: all.length,
    noun: 'headlines',
    onChange(on) {
      app.setLocal(on);
      state.shown = PAGE;
      root.scrollTo({ top: 0 });
    },
  });

  tabStamp(root, stampOf(state.pulse.generated), 'the wire, every 20 minutes');
  renderPicks(root, map);

  const sourceCount = new Set(shown.map((it) => it.s)).size;

  const only = set.source && map[set.source];
  heading(root, {
    eyebrow: set.topic === 'popular' ? 'Popular' : 'The wire',
    title: set.topic === 'popular' ? 'What readers upvoted'
      : state.q ? 'Matching “' + state.q + '”'
      : only ? String(only.name || only.short)
      : set.layout === 'sources' ? 'Every outlet, side by side'
      : (set.localOnly ? 'Burlington only' : 'Everything, newest first'),
    sub: '<span class="count">' + shown.length.toLocaleString() + ' headlines from ' +
      sourceCount + ' source' + (sourceCount === 1 ? '' : 's') + '</span>',
  });

  /* The chip row leads with search. A full-width search box cost a whole
     band of the screen to a thing most people never use; as the first chip
     it costs nothing and sits where the eye already is. */
  const chips = el('div', 'chips');
  const searchChip = chip(
    ICON.search + (state.q
      ? '<span>“' + esc(state.q.length > 12 ? state.q.slice(0, 11) + '…' : state.q) + '”</span>'
      : '<span>Search</span>'),
    state.qOpen || !!state.q,
    () => {
      if (state.q) { state.q = ''; state.qOpen = false; }
      else state.qOpen = !state.qOpen;
      state.shown = PAGE;
      render();
      const inp = root.querySelector('#wire-q');
      if (inp) inp.focus();
    },
    'search-chip'
  );
  chips.appendChild(searchChip);
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
  scrollHint(chips);

  if (state.qOpen || state.q) root.appendChild(searchBox(root));

  if (set.topic === 'popular') { renderPopular(root); return; }

  renderSourceBars(root, all, map, set);
  renderTools(root, set);
  renderWeather(root);

  if (!shown.length) {
    root.appendChild(el('p', 'empty', state.q
      ? 'Nothing on the wire matches “' + state.q + '”.'
      : set.focus
        ? 'Nothing left — you have read everything here. Turn Focus off in Settings to see it again.'
        : 'Nothing on the wire for that.'));
    return;
  }

  tipBar(root, 'swipe',
    '<span>Swipe a headline <b>left</b> to mute that outlet, <b>right</b> to save it.</span>');

  if (set.layout === 'sources' && !set.source) { renderBySource(root, shown, map, base); return; }

  const feed = el('div', 'feed');
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
  watchPassed(root);
}

function searchBox(root) {
  const box = el('div', 'search');
  box.style.margin = '0 0 12px';
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
  return box;
}

/* Two rows of outlets, locals on top — straight from Pulse, where it is the
   fastest way to say "just VTDigger" without opening anything. Sorted by the
   curator's priority first, then A–Z, so the papers people name lead. */
function renderSourceBars(root, all, map, set) {
  const counts = Object.create(null);
  all.forEach((it) => { counts[it.s] = (counts[it.s] || 0) + 1; });

  const pool = Object.keys(counts)
    .map((id) => map[id])
    .filter((s) => s && (set.topic === 'all' || s.topic === set.topic) &&
      (!set.localOnly || isLocalSource(s)))
    .sort((a, b) => ((a.pr || 500) - (b.pr || 500)) ||
      String(a.short || a.name).localeCompare(String(b.short || b.name)));

  const rows = [
    ['local', pool.filter(isLocalSource)],
    ['national', pool.filter((s) => !isLocalSource(s))],
  ];
  let first = true;
  rows.forEach(([kind, list]) => {
    if (!list.length) return;
    const bar = el('div', 'chips srcbar' + (kind === 'local' ? ' is-local' : ''));
    if (first) {
      first = false;
      bar.appendChild(chip('All sources', !set.source, () => pickSource('')));
    }
    list.forEach((s) => {
      const c = chip(String(s.short || s.name) + ' ' + counts[s.id],
        set.source === s.id, () => pickSource(s.id),
        'srcchip c-' + String(s.topic || '').replace(/[^a-z]/gi, ''));
      bar.appendChild(c);
    });
    root.appendChild(bar);
    scrollHint(bar);
  });
}

function pickSource(id) {
  const set = store.settings();
  store.setSetting('source', set.source === id ? '' : id);
  state.shown = PAGE;
  render();
  state.root.scrollTo({ top: 0 });
}

/* Focus and the layout switch were both buried in Settings, which meant
   nobody used either. They belong next to the thing they change. */
function renderTools(root, set) {
  const row = el('div', 'toolrow');

  const seg = el('div', 'toolseg');
  [['newest', 'Newest first'], ['sources', 'By source']].forEach(([v, label]) => {
    const b = el('button', 'toolbtn' + (set.layout === v ? ' on' : ''), label);
    b.addEventListener('click', () => {
      store.setSetting('layout', v);
      state.shown = PAGE;
      render();
      root.scrollTo({ top: 0 });
    });
    seg.appendChild(b);
  });
  row.appendChild(seg);

  const focus = el('button', 'toolbtn focus-btn' + (set.focus ? ' on' : ''),
    (set.focus ? '◉' : '○') + ' Focus');
  focus.title = set.focus
    ? 'Focus is on — headlines you have opened disappear'
    : 'Focus mode: hide headlines you have already opened';
  focus.addEventListener('click', () => {
    const on = !set.focus;
    store.setSetting('focus', on);
    render();
    app.toast(on ? 'Focus on — read headlines disappear' : 'Focus off');
  });
  row.appendChild(focus);
  root.appendChild(row);
}

/* Temperature, lake and sunset — the three numbers a Burlington reader
   actually checks. One line, from the same file the weather page uses. */
function renderWeather(root) {
  const w = state.wx;
  if (!w) return;
  const bits = [];
  if (w.now && w.now.temp_f != null) {
    bits.push(['Now', Math.round(w.now.temp_f) + '°' +
      (w.now.description ? ' ' + w.now.description : '')]);
  }
  if (w.lake_gage && w.lake_gage.water_temp_f != null) {
    bits.push(['Lake', Math.round(w.lake_gage.water_temp_f) + '°']);
  }
  if (w.sun && w.sun.sunset) {
    const t = new Date(w.sun.sunset).toLocaleTimeString('en-US',
      { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
    bits.push(['Sunset', t.replace(/\s?[AP]M$/i, '')]);
  }
  if (bits.length < 2) return;
  const strip = el('a', 'wxstrip');
  strip.href = 'https://guide.btownbrief.com/weather.html';
  strip.target = '_blank';
  strip.rel = 'noopener';
  strip.innerHTML = bits.map(([k, v]) =>
    '<span class="wx-bit"><span class="wx-k">' + esc(k) + '</span>' +
    '<span class="wx-v">' + esc(v) + '</span></span>').join('') +
    '<span class="wx-go">Forecast →</span>';
  root.appendChild(strip);
}

/* ------------------------------------------------------------ by source */
/* Pulse's front page: every outlet its own column, newest few each. It reads
   like a newsstand instead of a river, which is the point — you can see who
   is quiet today. The column order is shuffled once per visit so the same
   three papers do not always own the top of the screen. */

const gridSeed = Object.create(null);
const PER_SOURCE = 6;

function renderBySource(root, shown, map, base) {
  const bySrc = new Map();
  shown.forEach((it) => {
    const list = bySrc.get(it.s) || [];
    if (list.length < PER_SOURCE) { list.push(it); bySrc.set(it.s, list); }
  });
  if (!bySrc.size) { root.appendChild(el('p', 'empty', 'Nothing on the wire for that.')); return; }

  const secs = [...bySrc.entries()].map(([id, items]) => {
    if (gridSeed[id] === undefined) gridSeed[id] = Math.random();
    return { src: map[id], items };
  }).filter((x) => x.src).sort((a, b) => gridSeed[a.src.id] - gridSeed[b.src.id]);

  const grid = el('div', 'srcgrid');
  const keys = [];
  secs.forEach(({ src, items }) => {
    const sec = el('section', 'srcsec' + (isLocalSource(src) ? ' is-local' : ''));
    const head = el('h3', 'srcsec-head');
    const name = el('button', 'srcsec-name c-' + String(src.topic || '').replace(/[^a-z]/gi, ''),
      esc(String(src.short || src.name)));
    name.title = 'See only ' + String(src.name || src.short);
    name.addEventListener('click', () => pickSource(src.id));
    head.appendChild(name);
    head.appendChild(el('span', 'srcsec-tag',
      esc(isLocalSource(src) ? 'Local' : String(src.topic || '')) + ' · ' + items.length));
    sec.appendChild(head);

    const feed = el('div', 'feed feed-tight');
    items.forEach((it) => {
      keys.push(keyOf(it));
      feed.appendChild(feedRow(it, src, { isNew: base && it.d > base, compact: true }));
    });
    sec.appendChild(feed);
    grid.appendChild(sec);
  });
  root.appendChild(grid);
  hydrateVotes(root, keys);
  watchPassed(root);
}

function renderPicks(root, map) {
  const list = editions();
  if (!list.length) return;
  const idx = Math.min(state.edition, list.length - 1);
  const localOnly = store.settings().localOnly;
  const edition = list[idx];
  const stamp = Math.floor(new Date(edition.generated).getTime() / 1000);

  /* In local mode the picks narrow too. Leading the Burlington-only wire with
     a national headline was the one thing on the page still arguing with the
     switch. Some editions have no local pick at all — then the carousel steps
     aside rather than showing an empty shelf. */
  const picks = localOnly
    ? (edition.picks || []).filter((p) => p && p.local)
    : (edition.picks || []);
  if (localOnly && !picks.length) {
    heading(root, {
      eyebrow: 'The picks',
      title: 'No local pick in this edition',
      sub: '<span class="count">The picks are chosen three times a day from the whole wire. ' +
        'Everything below is still Burlington.</span>',
      right: list.length > 1 ? null : null,
    });
    return;
  }

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
      (localOnly ? ' · ' + picks.length + ' from here' : '') +
      (list.length > 1 ? ' · ' + (idx + 1) + ' of ' + list.length + ' editions' : '') + '</span>',
    right: list.length > 1 ? nav : null,
  });

  const { track, sync } = rail(root, { label: 'picks' });
  const keys = [];
  picks.forEach((p) => {
    if (!p || !p.t) return;
    /* The picks are the most-argued-with thing on the page and were the one
       card with no way to argue. A vote button cannot live inside an anchor,
       so the card is a box holding the link and a footer. */
    const k = keyOf({ u: p.u, t: p.t });
    keys.push(k);
    const card = el('div', 'pick' + (p.local ? ' is-local' : ''));
    card.dataset.k = k;

    const hit = el('a', 'pick-hit');
    hit.href = safeHref(p.u);
    hit.target = '_blank';
    hit.rel = 'noopener';
    hit.innerHTML =
      '<span class="fi-meta">' +
        (p.local ? '<span class="tag-local">Local</span>' : '') +
        '<span class="fi-src">' + esc(p.short || '') + '</span>' +
      '</span>' +
      '<span class="pick-title">' + esc(p.t) + '</span>' +
      (p.why ? '<span class="pick-why">' + esc(p.why) + '</span>' : '');
    hit.addEventListener('click', () => store.markRead(p.u));
    card.appendChild(hit);

    const foot = el('div', 'pick-foot');
    const vote = voteBtn(store.voteCount(k), store.hasVoted(k), store.votesLive());
    vote.addEventListener('click', () => {
      const on = store.toggleVote({ k, kind: 'wire', title: p.t, from: p.short || '', href: p.u });
      paintVote(vote, store.voteCount(k), on);
    });
    foot.appendChild(vote);

    const star = starBtn(store.isSaved(k));
    star.addEventListener('click', () => {
      star.classList.toggle('on', store.toggleSaved(
        { k, kind: 'wire', title: p.t, from: p.short || '', href: p.u }));
    });
    foot.append(el('span', 'spacer'), star);
    card.appendChild(foot);
    track.appendChild(card);
  });
  sync();
  hydrateVotes(root, keys);
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
    const feed = el('div', 'feed');
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
