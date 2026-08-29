/* listen.js — the podcast side of the same wire.

   The Brief's own show leads. Always. It is not ranked among the others and
   it is not sorted into a shelf that might bury it — it is the feature card
   at the top, above the fold, every time. The first pass sorted it in with
   everything else and it landed halfway down a list, which is the wrong
   answer for the one show this paper actually makes.

   Everything else: sources with pod === 1 are shows, their items with an `a`
   are episodes. Shows collapse to a row and open in place, so 871 episodes
   never all land on screen at once.

   Local and national are a switch, not a filter buried in a menu — the two
   moods are genuinely different and people switch between them.

   The Spotify embed is built once and never rebuilt. Re-rendering the panel
   on every tap would recreate that iframe and silently stop whatever was
   playing inside it. */

import * as store from './../store.js';
import * as data from './../wire.js';
import * as app from './../app.js';
import { el, esc, safeHref, agoShort, shelfHead, seg, starBtn, voteBtn, paintVote, ICON } from './../ui.js';
import { hydrateVotes } from './../rows.js';

const SHOW_URL = 'https://open.spotify.com/show/6ejf0OFAyNTZNKDzFLWbKp';
const state = { root: null, pulse: null, open: Object.create(null), scope: 'local' };

export function mount(root) {
  state.root = root;
  root.innerHTML = '<p class="loading">Tuning in…</p>';
  data.load('pulse', (json) => { state.pulse = json; render(); }, () => {
    root.innerHTML = '';
    root.appendChild(el('div', 'errbox', '<b>Couldn’t reach the wire.</b><br>Episodes ride the same feed as the headlines.'));
  });
}

export function activate() {}
export function refresh() { if (state.pulse) renderList(); }
export function deactivate() {}

function build() {
  const muted = store.muted();
  const shows = Object.create(null);
  const order = [];
  (Array.isArray(state.pulse.sources) ? state.pulse.sources : []).forEach((s) => {
    if (!s || s.pod !== 1 || muted[s.id]) return;
    shows[s.id] = { src: s, eps: [], local: s.local === 1 || s.topic === 'local' };
    order.push(s.id);
  });
  (Array.isArray(state.pulse.items) ? state.pulse.items : []).forEach((it) => {
    if (!it || !it.a || !shows[it.s]) return;
    shows[it.s].eps.push(it);
  });
  const list = order.map((id) => shows[id]).filter((s) => s.eps.length);
  list.forEach((s) => {
    s.eps.sort((a, b) => (b.d || 0) - (a.d || 0));
    s.art = (s.eps.find((e) => e.i) || {}).i || null;
  });
  return list;
}

function render() {
  const root = state.root;
  /* the feature and the embed are built once — see the header note */
  if (root.querySelector('.l-list')) return renderList();

  root.innerHTML = '';
  const feat = el('section', 'card feature');
  feat.innerHTML =
    '<img src="../assets/btown-arts-cover.jpg" alt="BTown Arts Podcast cover art">' +
    '<div>' +
      '<p class="eyebrow">The Brief’s own show</p>' +
      '<h2>BTown Arts Podcast</h2>' +
      '<p>Artists coming through Burlington, hosted by Kwame Dankwa.</p>' +
      '<div class="btns">' +
        '<a class="btn" href="https://www.youtube.com/watch?v=W6LBJ72UKvo" target="_blank" rel="noopener">▶ Watch the HAYLA interview</a>' +
        '<a class="btn btn-quiet" href="' + SHOW_URL + '" target="_blank" rel="noopener">Follow on Spotify</a>' +
      '</div>' +
    '</div>';
  root.appendChild(feat);

  /* The episode browser is 352px tall. Open by default it pushed the first
     local podcast a full screen below the fold, so it opens on request — and
     the iframe is only created once, on that first open, so nothing here can
     interrupt playback later. */
  const toggle = el('button', 'embed-toggle',
    '<span>Every episode of the show</span><span class="chev">' + ICON.chev + '</span>');
  toggle.setAttribute('aria-expanded', 'false');
  const embed = el('iframe', 'embed');
  embed.hidden = true;
  embed.title = 'BTown Arts Podcast — all episodes';
  embed.loading = 'lazy';
  embed.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    embed.hidden = open;
    if (!open && !embed.getAttribute('src')) {
      embed.src = 'https://open.spotify.com/embed/show/6ejf0OFAyNTZNKDzFLWbKp?theme=0';
    }
  });
  root.append(toggle, embed);

  root.appendChild(el('div', 'l-list'));
  renderList();
}

function renderList() {
  const list = state.root.querySelector('.l-list');
  if (!list) return;
  const shows = build();
  const half = shows.filter((s) => (state.scope === 'local') === s.local);
  const eps = half.reduce((n, s) => n + s.eps.length, 0);
  list.innerHTML = '';

  list.appendChild(seg([['local', 'Vermont shows'], ['world', 'Everything else']],
    state.scope === 'local' ? 'local' : 'world',
    (v) => { state.scope = v; renderList(); }));
  list.appendChild(el('div', null, '<div style="height:16px"></div>'));

  const resume = resumeRow(shows);
  if (resume) list.appendChild(resume);

  shelfHead(list,
    state.scope === 'local' ? 'Made in Vermont' : 'The rest of the dial',
    half.length + ' show' + (half.length === 1 ? '' : 's') + ' · ' + eps.toLocaleString() + ' episodes');

  const grid = el('div', 'shows');
  half.forEach((s) => grid.appendChild(showCard(s)));
  list.appendChild(grid);
  hydrateVotes(list, [...list.querySelectorAll('.fi')].map((n) => n.dataset.k));
}

/* an episode you left part-way through is the most useful row on this tab */
function resumeRow(shows) {
  const open = [];
  shows.forEach((s) => s.eps.slice(0, 25).forEach((ep) => {
    const at = store.heardAt(ep.a);
    if (at > 30) open.push({ ep, show: s, at });
  }));
  if (!open.length) return null;
  const sec = el('div');
  shelfHead(sec, 'Pick up where you left off', 'Still listening');
  const card = el('div', 'card feed');
  open.slice(0, 4).forEach((o) => card.appendChild(epRow(o.ep, o.show)));
  sec.appendChild(card);
  return sec;
}

function showCard(s) {
  const wrap = el('div');
  const open = !!state.open[s.src.id];
  const head = el('button', 'card show-head' + (open ? ' open' : ''));
  head.innerHTML =
    (s.art ? '<img loading="lazy" referrerpolicy="no-referrer" src="' + esc(s.art) + '" alt="">'
           : '<span class="noart">🎙</span>') +
    '<span class="show-meta">' +
      '<span class="show-name">' + esc(s.src.short || s.src.name) + '</span>' +
      '<span class="v-meta">' + s.eps.length + ' episodes · newest ' + agoShort(s.eps[0].d) + '</span>' +
    '</span>' +
    '<span class="chev">▾</span>';
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  head.addEventListener('click', () => {
    state.open[s.src.id] = !open;
    renderList();
  });
  wrap.appendChild(head);
  if (open) {
    const eps = el('div', 'card feed eps');
    s.eps.slice(0, 30).forEach((ep) => eps.appendChild(epRow(ep, s)));
    wrap.appendChild(eps);
  }
  return wrap;
}

function epRow(ep, s) {
  const k = ep.a;
  const row = el('div', 'fi');
  row.dataset.k = k;
  const at = store.heardAt(k);
  const playing = app.nowPlaying() === k;

  const play = el('button', 'fi-body ep-play');
  play.innerHTML =
    '<span class="fi-title">' + esc(ep.t || 'Untitled') + '</span>' +
    '<span class="fi-meta">' +
      (playing ? '<span class="tag-local">Playing</span>' : '') +
      '<span class="fi-src">' + esc(s.src.short || s.src.name) + '</span>' +
      (ep.d ? '<span>' + agoShort(ep.d) + '</span>' : '') +
      (at > 30 ? '<span>' + Math.round(at / 60) + ' min in</span>' : '') +
    '</span>';
  play.addEventListener('click', () => {
    app.playAudio({ src: ep.a, title: ep.t, show: s.src.short || s.src.name, art: ep.i || s.art, key: k });
    renderList();
  });
  row.appendChild(play);

  const foot = el('div', 'fi-foot');
  foot.appendChild(el('span', 'spacer'));
  const rec = { k, kind: 'episode', title: ep.t || 'Untitled', from: s.src.short || s.src.name, href: safeHref(ep.u || ep.a), art: ep.i || s.art || '' };
  const vote = voteBtn(store.voteCount(k), store.hasVoted(k), store.votesLive());
  vote.addEventListener('click', () => {
    const on = store.toggleVote(rec);
    paintVote(vote, store.voteCount(k), on);
  });
  const star = starBtn(store.isSaved(k));
  star.addEventListener('click', () => {
    const on = store.toggleSaved(rec);
    star.classList.toggle('on', on);
  });
  foot.append(vote, star);
  row.appendChild(foot);
  return row;
}
