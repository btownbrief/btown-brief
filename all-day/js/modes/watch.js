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
import { el, esc, agoShort, dayLabel, rail, heading, shelfHead, seg, voteBtn, paintVote, starBtn, tabStamp, stampOf, ICON } from './../ui.js';
import { hydrateVotes } from './../rows.js';

const WIRE_PAGE = 24;
const EDITIONS_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/btown-tv/data/tv-editions.json';

const LOCAL_SHELF = 'Burlington & Vermont';

/* The order the data arrives in is the order the curator builds it, which
   leads with the longest videos. On a phone that buries everything else, so
   the page leads with the short ones and lets the couch episode come second. */
const SHELF_ORDER = ['Quick one', 'Settle in', LOCAL_SHELF];

function orderShelves(shelves) {
  const live = (Array.isArray(shelves) ? shelves : [])
    .filter((s) => s && Array.isArray(s.items) && s.items.length);
  const rank = (s) => {
    const i = SHELF_ORDER.indexOf(s.title);
    return i === -1 ? SHELF_ORDER.length : i;
  };
  return live.map((s, i) => [s, i]).sort((a, b) =>
    (rank(a[0]) - rank(b[0])) || (a[1] - b[1])).map((pair) => pair[0]);
}

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
  tabStamp(root, stampOf(state.tv?.generated) || stampOf(state.yt?.generated),
    state.view === 'wire' ? 'the youtube wire, every 3 hours' : 'tonight’s edition, built each morning');

  /* The Btown TV masthead, kept to three lines. On tv.html it was a full
     hero and pushed the first video off the screen; here it is a label. */
  const mast = el('header', 'tvmast');
  mast.innerHTML =
    '<p class="tvmast-pre">Btown Brief presents</p>' +
    '<h1>BTown TV</h1>' +
    '<p class="tvmast-sub">One curated page of video for Burlington, every evening. ' +
    'A pick for tonight and six shelves — around fifty videos, each with a reason.</p>';
  root.appendChild(mast);

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
    const hero = el('button', 'hero');
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
    const card = el('div', 'card hero-card');
    card.dataset.k = 'yt:' + pick.id;
    card.appendChild(hero);
    /* the pick was the one video you could not mark watched, skip or save */
    card.appendChild(videoActions(pick, card));
    root.appendChild(card);
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

  /* Webcams are ambient and now tiny, so they ride directly under the pick:
     one glance at what is happening outside right now, then the shelves. */
  liveStrip();

  orderShelves(tv.shelves).forEach((s) => {
    shelfHead(root, s.title, s.sub, s.title === LOCAL_SHELF ? pastLocalBtn() : null);
    const { track, sync } = rail(root, { label: 'videos' });
    s.items.forEach((v) => { if (v && app.isVideoId(v.id)) track.appendChild(videoCard(v)); });
    sync();
  });

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

/* Local video is the whole reason this tab exists, and one night's shelf is
   five clips. A channel that posted yesterday is invisible by tomorrow. So
   the local shelf gets its own history button — not another toggle at the
   top of the page, where there are already three. */
function pastLocalBtn() {
  const b = el('button', 'shelf-more', 'Past picks');
  b.addEventListener('click', () => {
    app.sheet('Vermont video, the last two weeks', (body) => {
      if (!state.past) {
        body.appendChild(el('p', 'loading', 'Opening the archive…'));
        loadPast(() => { body.innerHTML = ''; fillLocalHistory(body); });
        return;
      }
      fillLocalHistory(body);
    });
  });
  return b;
}

function fillLocalHistory(body) {
  const today = new Set();
  (state.tv?.shelves || []).forEach((s) => {
    if (s?.title === LOCAL_SHELF) (s.items || []).forEach((v) => v && today.add(v.id));
  });

  const seen = new Set();
  const rows = [];
  (state.past || []).forEach((ed) => {
    (Array.isArray(ed?.shelves) ? ed.shelves : []).forEach((s) => {
      if (s?.title !== LOCAL_SHELF) return;
      (s.items || []).forEach((v) => {
        /* skip what is already on the shelf behind this sheet */
        if (!v || !app.isVideoId(v.id) || today.has(v.id) || seen.has(v.id)) return;
        seen.add(v.id);
        rows.push(v);
      });
    });
  });

  if (!rows.length) {
    body.appendChild(el('p', 'empty', 'Everything local we have picked recently is already on the shelf.'));
    return;
  }
  body.appendChild(el('p', 'sheet-note',
    esc(rows.length + ' more from Vermont channels, newest first — picked on earlier nights.')));
  rows.sort((a, b) => (b.d || 0) - (a.d || 0));
  const grid = el('div', 'vgrid');
  rows.forEach((v) => grid.appendChild(videoCard(v)));
  body.appendChild(grid);
  hydrateVotes(body, rows.map((v) => 'yt:' + v.id));
}

/* --------------------------------------------------------- past nights */

function loadPast(then) {
  data.fetchJSON(EDITIONS_URL, 10000)
    .then((json) => { state.past = Array.isArray(json?.editions) ? json.editions : []; })
    .catch(() => { state.past = []; })
    .finally(() => {
      if (then) then();
      else if (state.view === 'past') render();
    });
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
  const r = store.tvReacts()[v.id];
  const seen = r === 'watched' || r === 'skip';
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

  card.appendChild(videoActions(v, card));
  return card;
}

/* Upvote, watched, not-for-me, save. Shared by the shelf cards and the
   nightly pick, which had none of them. */
function videoActions(v, card) {
  const k = 'yt:' + v.id;
  const reacts = store.tvReacts();
  const href = 'https://www.youtube.com/watch?v=' + v.id;
  const acts = el('div', 'v-acts');

  const vote = voteBtn(store.voteCount(k), store.hasVoted(k), store.votesLive());
  vote.addEventListener('click', () => {
    const on = store.toggleVote({ k, kind: 'video', title: v.t, from: v.ch || '', href });
    paintVote(vote, store.voteCount(k), on);
  });
  acts.appendChild(vote);
  acts.appendChild(el('span', 'spacer'));

  /* the two signals that teach tomorrow's edition */
  const mark = (kind, icon, label) => {
    const b = el('button', 'act' + (reacts[v.id] === kind ? ' on' : ''), icon);
    b.setAttribute('aria-label', label);
    b.title = label;
    b.addEventListener('click', () => {
      const now = store.tvReact(v.id, kind);
      b.classList.toggle('on', now === kind);
      if (card) card.classList.toggle('is-seen', now === 'watched' || now === 'skip');
    });
    return b;
  };

  const star = starBtn(store.isSaved(k));
  star.addEventListener('click', () => {
    star.classList.toggle('on', store.toggleSaved(
      { k, kind: 'video', title: v.t, from: v.ch || '', href, art: thumb(v.id) }));
  });

  acts.append(mark('watched', ICON.check, 'Watched'), mark('skip', ICON.x, 'Not for me'), star);
  return acts;
}
