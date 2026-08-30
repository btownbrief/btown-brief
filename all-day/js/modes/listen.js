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
import { el, esc, safeHref, agoShort, shelfHead, starBtn, voteBtn, paintVote, tabStamp, stampOf, localSwitch, ICON } from './../ui.js';
import { hydrateVotes } from './../rows.js';

const SHOW_URL = 'https://open.spotify.com/show/6ejf0OFAyNTZNKDzFLWbKp';
const PREVIEW = 4;      // newest episodes shown under every show, unasked
const state = { root: null, pulse: null, pod: null, open: Object.create(null) };

export function mount(root) {
  state.root = root;
  root.innerHTML = '<p class="loading">Tuning in…</p>';
  /* The show's own episodes ride in a second payload — Spotify's show embed
     is a player for the newest episode, not an archive. Fails soft: no file,
     no list, and the feature card is unchanged. */
  data.load('podcast', (json) => { state.pod = json; renderEpisodes(); }, () => {});
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
  /* Whoever published most recently goes first. Alphabetical order tells you
     nothing about a podcast list — freshness is the whole question. */
  list.sort((a, b) => (b.eps[0].d || 0) - (a.eps[0].d || 0));
  return list;
}

function render() {
  const root = state.root;
  /* the feature and the embed are built once — see the header note */
  if (root.querySelector('.l-list')) return renderList();

  root.innerHTML = '';
  /* The switch sits above everything, but the feature card and the Spotify
     iframe below are built exactly once and must never be torn down — so the
     switch gets a stable slot that renderList() repaints into. */
  root.appendChild(el('div', 'localsw-slot'));
  tabStamp(root, stampOf(state.pulse?.generated), 'episodes, every 20 minutes');
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
  /* Spotify's show embed plays the newest episode; it is not an episode
     browser, so it should not claim to be one. The link underneath is where
     the back catalogue actually lives. */
  const toggle = el('button', 'embed-toggle',
    '<span>Play the latest episode</span><span class="chev">' + ICON.chev + '</span>');
  toggle.setAttribute('aria-expanded', 'false');
  const embed = el('iframe', 'embed');
  embed.hidden = true;
  embed.title = 'BTown Arts Podcast — latest episode';
  embed.loading = 'lazy';
  embed.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
  const allEps = el('a', 'embed-all', 'Every episode on Spotify ↗');
  allEps.href = SHOW_URL;
  allEps.target = '_blank';
  allEps.rel = 'noopener';
  allEps.hidden = true;

  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    embed.hidden = open;
    allEps.hidden = open;
    if (!open && !embed.getAttribute('src')) {
      embed.src = 'https://open.spotify.com/embed/show/6ejf0OFAyNTZNKDzFLWbKp?theme=0';
    }
  });
  root.append(toggle, embed, allEps);

  root.appendChild(el('div', 'l-eps'));
  renderEpisodes();

  root.appendChild(el('div', 'l-list'));
  renderList();
}

function renderList() {
  const list = state.root.querySelector('.l-list');
  if (!list) return;
  const set = store.settings();
  const shows = build();
  /* "Everything" here means every show, the Vermont ones included and still
     ordered by who published last — not "the national ones", which is what
     the old either/or segment meant and which no other tab means. */
  const local = shows.filter((s) => s.local);
  const half = set.localOnly ? local : shows;
  const eps = half.reduce((n, s) => n + s.eps.length, 0);

  const slot = state.root.querySelector('.localsw-slot');
  if (slot) {
    slot.innerHTML = '';
    localSwitch(slot, {
      on: set.localOnly,
      local: local.length,
      all: shows.length,
      noun: 'shows',
      onChange(on) { app.setLocal(on); state.root.scrollTo({ top: 0 }); },
    });
  }

  list.innerHTML = '';

  const resume = resumeRow(shows);
  if (resume) list.appendChild(resume);

  shelfHead(list,
    set.localOnly ? 'Made in Vermont' : 'Every show we follow',
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
  const open = !!state.open[s.src.id];
  const shown = open ? Math.min(30, s.eps.length) : Math.min(PREVIEW, s.eps.length);
  const card = el('div', 'card show');

  const head = el('div', 'show-head');
  head.innerHTML =
    (s.art ? '<img loading="lazy" referrerpolicy="no-referrer" src="' + esc(s.art) + '" alt="">'
           : '<span class="noart">🎙</span>') +
    '<span class="show-meta">' +
      '<span class="show-name">' + esc(s.src.short || s.src.name) + '</span>' +
      '<span class="v-meta">' + s.eps.length + ' episode' + (s.eps.length === 1 ? '' : 's') +
        ' · latest ' + agoShort(s.eps[0].d) + '</span>' +
    '</span>';
  if (s.src.site) {
    const out = el('a', 'show-out', '↗');
    out.href = safeHref(s.src.site);
    out.target = '_blank';
    out.rel = 'noopener';
    out.setAttribute('aria-label', (s.src.short || s.src.name) + ' — the show’s own page');
    head.appendChild(out);
  }
  card.appendChild(head);

  const eps = el('div', 'eps');
  s.eps.slice(0, shown).forEach((ep) => eps.appendChild(epRow(ep, s)));
  card.appendChild(eps);

  /* Older episodes are there, one tap away — the point is that you do not
     have to tap to see the newest four. */
  if (s.eps.length > PREVIEW) {
    const more = el('button', 'show-more',
      open ? 'Show fewer' : (s.eps.length - PREVIEW) + ' older episode' +
        (s.eps.length - PREVIEW === 1 ? '' : 's'));
    more.setAttribute('aria-expanded', open ? 'true' : 'false');
    more.addEventListener('click', () => { state.open[s.src.id] = !open; renderList(); });
    card.appendChild(more);
  }
  return card;
}

function epRow(ep, s) {
  const k = ep.a;
  const at = store.heardAt(k);
  const playing = app.nowPlaying() === k;
  const row = el('div', 'ep' + (playing ? ' is-playing' : ''));
  row.dataset.k = k;

  const play = el('button', 'ep-go' + (playing ? ' is-playing' : ''), playing ? ICON.pause : ICON.play);
  play.dataset.pk = k;                     /* the shell paints it — see app.js */
  play.setAttribute('aria-label', 'Play ' + (ep.t || 'episode'));
  play.addEventListener('click', () => {
    app.toggleAudio({ src: ep.a, title: ep.t, show: s.src.short || s.src.name,
                      art: ep.i || s.art, key: k, href: ep.u || '' });
    renderList();
  });

  const meta = el('div', 'ep-meta');
  meta.appendChild(el('span', 'ep-title', esc(ep.t || 'Untitled')));
  const sub = [];
  if (ep.d) sub.push(agoShort(ep.d));
  if (at > 30) sub.push(Math.round(at / 60) + ' min in');
  if (playing) sub.push('playing');
  meta.appendChild(el('span', 'ep-age', sub.join(' \u00b7 ')));

  const rec = { k, kind: 'episode', title: ep.t || 'Untitled',
                from: s.src.short || s.src.name, href: safeHref(ep.u || ep.a),
                art: ep.i || s.art || '' };
  const vote = voteBtn(store.voteCount(k), store.hasVoted(k), store.votesLive());
  vote.addEventListener('click', () => paintVote(vote, store.voteCount(k), store.toggleVote(rec)));
  const star = starBtn(store.isSaved(k));
  star.addEventListener('click', () => star.classList.toggle('on', store.toggleSaved(rec)));

  row.append(play, meta, vote, star);
  return row;
}


/* ------------------------------------------------------- the Brief's show */
/* Every past episode, not just the newest. The Spotify SHOW embed renders the
   latest episode at any height — checked at 232, 352 and 500px — so the list
   comes from data/podcast.json and each row opens that EPISODE's own embed,
   which does play the episode you picked. */
function renderEpisodes() {
  const host = state.root && state.root.querySelector('.l-eps');
  if (!host) return;
  const eps = (state.pod && Array.isArray(state.pod.episodes)) ? state.pod.episodes : [];
  host.innerHTML = '';
  if (!eps.length) return;

  shelfHead(host, 'Every episode',
    eps.length + (eps.length === 1 ? ' episode' : ' episodes') + ' · newest first');

  const list = el('div', 'l-ep-list');
  eps.forEach((e) => {
    const row = el('div', 'l-ep');
    const hit = el('button', 'l-ep-hit');
    hit.innerHTML =
      '<span class="l-ep-t">' + esc(e.title || 'Untitled episode') + '</span>' +
      '<span class="l-ep-m">' +
        (e.date ? esc(e.date) : '') +
        (e.seconds ? ' · ' + Math.round(e.seconds / 60) + ' min' : '') +
      '</span>' +
      (e.blurb ? '<span class="l-ep-b">' + esc(e.blurb) + '</span>' : '');
    /* One iframe at a time, created on tap and left alone afterwards —
       rebuilding it is what silently stops playback. */
    hit.addEventListener('click', () => {
      const open = row.classList.toggle('is-open');
      let frame = row.querySelector('iframe');
      if (open && !frame && e.id) {
        frame = el('iframe', 'l-ep-embed');
        frame.loading = 'lazy';
        frame.title = e.title || 'Episode';
        frame.allow = 'clipboard-write; encrypted-media; fullscreen; picture-in-picture';
        frame.src = 'https://open.spotify.com/embed/episode/' + encodeURIComponent(e.id) + '?theme=0';
        row.appendChild(frame);
      } else if (frame) {
        frame.hidden = !open;
      }
      /* An episode with no Spotify id (hand-added before the API filled the
         file in) cannot embed — send it out rather than open an empty box. */
      if (open && !e.id && e.url) window.open(safeHref(e.url), '_blank', 'noopener');
    });
    row.appendChild(hit);
    list.appendChild(row);
  });
  host.appendChild(list);
}
