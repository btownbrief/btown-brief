/* watch.js — Btown TV, in full.

   Three views, because the old split hid two of them:

     Tonight     the curated edition — one pick, then the shelves
     Past nights the last two weeks, from tv-editions.json. The archive
                 already existed on the data branch and nothing rendered it,
                 which is why this tab felt like a trailer for tv.html
                 instead of the thing itself.
     Everything  the raw 3-hourly YouTube wire, newest first and labelled as
                 such, because "Everything" alone does not tell you it is a
                 firehose in date order.

   Card sizes are deliberate. A video the editor chose gets a real thumbnail;
   a 24/7 webcam gets a smaller one, because a lake at night is not competing
   with a documentary for your attention. Four cards to a phone screen, not
   two.

   Reactions write to the same key tv.html uses, so a ✓ here still teaches
   tomorrow's edition. */

import * as store from './../store.js';
import * as data from './../wire.js';
import * as app from './../app.js';
import { el, esc, agoShort, dayLabel, rail, heading, shelfHead, seg, voteBtn, paintVote, starBtn, ICON } from './../ui.js';
import { hydrateVotes } from './../rows.js';

const WIRE_PAGE = 24;
const EDITIONS_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/btown-tv/data/tv-editions.json';

const state = { root: null, tv: null, yt: null, past: null, view: 'tonight', shown: WIRE_PAGE };

const thumb = (id) => 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';

export function mount(root) {
  state.root = root;
  root.innerHTML = '<p class="loading">Tuning the set…</p>';
  data.load('tv', (json) => { state.tv = json; render(); }, () => {
    if (!state.yt) {
      root.innerHTML = '';
      root.appendChild(el('div', 'errbox', '<b>Tonight’s edition isn’t up yet.</b><br>It is built fresh each morning.'));
    } else render();
  });
  data.load('youtube', (json) => { state.yt = json; render(); }, () => {});
}

export function activate() {}
export function deactivate() {}

function render() {
  const root = state.root;
  if (!state.tv && !state.yt) return;
  root.innerHTML = '';

  root.appendChild(seg([
    ['tonight', 'Tonight'],
    ['past', 'Past nights'],
    ['wire', 'Everything new'],
  ], state.view, (v) => {
    state.view = v;
    state.shown = WIRE_PAGE;
    render();
    root.scrollTo({ top: 0 });
    if (v === 'past' && !state.past) loadPast();
  }));
  root.appendChild(el('div', null, '<div style="height:16px"></div>'));

  if (state.view === 'wire') return renderWire(root);
  if (state.view === 'past') return renderPast(root);
  return renderTonight(root);
}

/* ------------------------------------------------------------- tonight */

function renderTonight(root) {
  const tv = state.tv;
  if (!tv) { root.appendChild(el('p', 'empty', 'Tonight’s edition isn’t up yet.')); return; }

  const pick = tv.pick;
  if (pick && typeof pick === 'object' && app.isVideoId(pick.id)) {
    const hero = el('button', 'card hero');
    hero.dataset.k = 'yt:' + pick.id;
    hero.innerHTML =
      '<img loading="lazy" src="' + thumb(pick.id) + '" alt="">' +
      '<span class="hero-body">' +
        /* "pick" alone never said who picked it */
        '<span class="eyebrow">Tonight’s pick · chosen by hand</span>' +
        '<span class="hero-title">' + esc(pick.t) + '</span>' +
        '<span class="v-meta">' + esc(pick.ch || '') + (pick.dur ? ' · ' + esc(pick.dur) : '') + '</span>' +
        (pick.why ? '<span class="v-why">' + esc(pick.why) + '</span>' : '') +
      '</span>';
    hero.addEventListener('click', () => app.showVideo(pick.id, pick.t));
    root.appendChild(hero);
  }

  const live = Array.isArray(tv.live) ? tv.live.filter((v) => v && app.isVideoId(v.id)) : [];
  const liveStrip = () => {
    if (!live.length) return;
    const strip = el('div', 'livestrip');
    shelfHead(strip, 'Live right now', 'Burlington and Vermont, always on');
    const { track, sync } = rail(strip, { label: 'cameras' });
    live.forEach((v) => track.appendChild(videoCard(v, { live: true })));
    root.appendChild(strip);
    sync();
  };

  /* Webcams sit BELOW the first real shelf. They are ambient — nobody opens
     this tab to watch a covered bridge — and putting them straight under the
     pick meant the first screenful was a hero and seven webcams, with the
     curated video you actually came for pushed off the bottom. */
  let placedLive = false;
  (Array.isArray(tv.shelves) ? tv.shelves : []).forEach((s, i) => {
    if (!s || !Array.isArray(s.items) || !s.items.length) return;
    shelfHead(root, s.title, s.sub);
    const { track, sync } = rail(root, { label: 'videos' });
    s.items.forEach((v) => { if (v && app.isVideoId(v.id)) track.appendChild(videoCard(v)); });
    sync();
    if (!placedLive) { placedLive = true; liveStrip(); }
  });
  if (!placedLive) liveStrip();      /* no shelves tonight — still show them */

  const play = playlistLink(tv, 'Play tonight on your TV');
  if (play) {
    const row = el('div', 'btns');
    row.style.marginTop = '4px';
    row.appendChild(play);
    root.appendChild(row);
  }
  root.appendChild(el('p', 'srcline', 'Edition ' + esc(tv.edition || '')));
  hydrateVotes(root, [...root.querySelectorAll('[data-k]')].map((n) => n.dataset.k));
}

/* --------------------------------------------------------- past nights */

function loadPast() {
  data.fetchJSON(EDITIONS_URL, 10000)
    .then((json) => {
      state.past = Array.isArray(json?.editions) ? json.editions : [];
      if (state.view === 'past') render();
    })
    .catch(() => { state.past = []; if (state.view === 'past') render(); });
}

function renderPast(root) {
  if (!state.past) { root.appendChild(el('p', 'loading', 'Opening the archive…')); loadPast(); return; }
  if (!state.past.length) {
    root.appendChild(el('p', 'empty', 'No past editions yet — the archive fills in as editions are built.'));
    return;
  }
  heading(root, {
    eyebrow: 'Past nights',
    title: 'Every edition, still here',
    sub: '<span class="count">' + state.past.length + ' editions kept</span>',
  });
  state.past.forEach((ed) => {
    if (!ed || !ed.edition) return;
    shelfHead(root, dayLabel(ed.generated || ed.edition), ed.pick?.t || ed.edition);
    const items = [];
    if (ed.pick && app.isVideoId(ed.pick.id)) items.push(ed.pick);
    (Array.isArray(ed.shelves) ? ed.shelves : []).forEach((s) => {
      (Array.isArray(s?.items) ? s.items : []).forEach((v) => {
        if (v && app.isVideoId(v.id)) items.push(v);
      });
    });
    if (!items.length) return;
    const { track, sync } = rail(root, { label: 'videos' });
    items.forEach((v) => track.appendChild(videoCard(v)));
    sync();
    const play = playlistLink(ed, 'Play this night on your TV');
    if (play) {
      const row = el('div', 'btns');
      row.style.margin = '-2px 0 6px';
      row.appendChild(play);
      root.appendChild(row);
    }
  });
  hydrateVotes(root, [...root.querySelectorAll('[data-k]')].map((n) => n.dataset.k));
}

/* ------------------------------------------------------------ the wire */

function renderWire(root) {
  const vids = (state.yt?.videos || []).filter((v) => v && app.isVideoId(v.id));
  if (!vids.length) {
    root.appendChild(el('p', 'empty', 'The YouTube wire isn’t answering right now.'));
    return;
  }
  heading(root, {
    eyebrow: 'Everything new',
    title: 'The firehose, newest first',
    sub: '<span class="count">' + vids.length + ' videos from the channels we follow · nothing curated</span>',
  });
  const grid = el('div', 'vgrid');
  const slice = vids.slice(0, state.shown);
  slice.forEach((v) => grid.appendChild(videoCard(v)));
  root.appendChild(grid);
  if (state.shown < vids.length) {
    const more = el('button', 'more', 'More videos');
    more.addEventListener('click', () => { state.shown += WIRE_PAGE; render(); });
    root.appendChild(more);
  }
  hydrateVotes(root, slice.map((v) => 'yt:' + v.id));
}

/* Each night's edition is published as its own YouTube playlist — the first
   fifty videos in page order — so you can cast the whole thing to a TV. The
   url is validated to exactly the playlist shape before it becomes an href,
   the same test tv.html used. */
function playlistLink(edition, label) {
  const url = edition?.playlist?.url;
  if (!url || !/^https:\/\/www\.youtube\.com\/playlist\?list=[A-Za-z0-9_-]+$/.test(url)) return null;
  const a = el('a', 'btn btn-quiet', '▶ ' + label);
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.title = 'Opens the playlist in YouTube — cast it, or open it on your TV';
  return a;
}

/* ---------------------------------------------------------------- card */

function videoCard(v, opts = {}) {
  const k = 'yt:' + v.id;
  const reacts = store.tvReacts();
  const seen = reacts[v.id] === 'watched' || reacts[v.id] === 'skip';
  const card = el('div', 'v' + (seen ? ' is-seen' : ''));
  card.dataset.k = k;

  const hit = el('button', 'v-hit');
  hit.innerHTML =
    '<span class="v-shot">' +
      '<img loading="lazy" referrerpolicy="no-referrer" src="' + thumb(v.id) + '" alt="">' +
      (opts.live ? '<span class="v-live"><i></i>LIVE</span>'
        : (v.dur ? '<span class="v-dur">' + esc(v.dur) + '</span>' : '')) +
    '</span>' +
    '<span class="v-body">' +
      '<span class="v-title">' + esc(v.t) + '</span>' +
      '<span class="v-meta">' + esc(v.ch || '') +
        (v.d && !opts.live ? ' · ' + agoShort(v.d) : '') + '</span>' +
      (v.why ? '<span class="v-why">' + esc(v.why) + '</span>' : '') +
    '</span>';
  hit.addEventListener('click', () => app.showVideo(v.id, v.t));
  card.appendChild(hit);

  const acts = el('div', 'v-acts');
  const vote = voteBtn(store.voteCount(k), store.hasVoted(k), store.votesLive());
  vote.addEventListener('click', () => {
    const on = store.toggleVote({ k, kind: 'video', title: v.t, from: v.ch || '', href: 'https://www.youtube.com/watch?v=' + v.id });
    paintVote(vote, store.voteCount(k), on);
  });
  acts.appendChild(vote);
  acts.appendChild(el('span', 'spacer'));

  /* the two signals that teach tomorrow's edition */
  const watched = el('button', 'act' + (reacts[v.id] === 'watched' ? ' on' : ''), ICON.check);
  watched.setAttribute('aria-label', 'Mark watched');
  watched.title = 'Watched';
  watched.addEventListener('click', () => {
    const now = store.tvReact(v.id, 'watched');
    watched.classList.toggle('on', now === 'watched');
    card.classList.toggle('is-seen', now === 'watched' || now === 'skip');
  });

  const skip = el('button', 'act' + (reacts[v.id] === 'skip' ? ' on' : ''), ICON.x);
  skip.setAttribute('aria-label', 'Not for me');
  skip.title = 'Not for me';
  skip.addEventListener('click', () => {
    const now = store.tvReact(v.id, 'skip');
    skip.classList.toggle('on', now === 'skip');
    card.classList.toggle('is-seen', now === 'watched' || now === 'skip');
  });

  const rec = { k, kind: 'video', title: v.t, from: v.ch || '', href: 'https://www.youtube.com/watch?v=' + v.id, art: thumb(v.id) };
  const star = starBtn(store.isSaved(k));
  star.addEventListener('click', () => {
    const on = store.toggleSaved(rec);
    star.classList.toggle('on', on);
  });

  acts.append(watched, skip, star);
  card.appendChild(acts);
  return card;
}
