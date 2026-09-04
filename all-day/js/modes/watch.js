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
import { el, esc, agoShort, dayLabel, rail, heading, shelfHead, seg, voteBtn, paintVote, starBtn, shareBtn, tabStamp, stampOf, localSwitch, ICON } from './../ui.js';
import { hydrateVotes } from './../rows.js';

const WIRE_PAGE = 24;
const EDITIONS_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/btown-tv/data/tv-editions.json';

const LOCAL_SHELF = 'Burlington & Vermont';

/* A video is local if the curator marked it so (`vt`), or it came from a
   channel filed under the Vermont shelf (`g: 'vt'`), or it sits on the
   Burlington & Vermont shelf. Live cams are local by definition — the strip
   is titled "Burlington and Vermont, always on". */
const isLocalVideo = (v) => !!v && (!!v.vt || v.g === 'vt' || v.shelf === LOCAL_SHELF);

function localShelves(shelves) {
  return (Array.isArray(shelves) ? shelves : []).map((s) => {
    if (!s || !Array.isArray(s.items)) return null;
    const items = s.title === LOCAL_SHELF ? s.items : s.items.filter(isLocalVideo);
    return items.length ? { ...s, items } : null;
  }).filter(Boolean);
}

/* The order the data arrives in is the order the curator builds it, which
   leads with the longest videos. On a phone that buries everything else, so
   the page leads with the short ones, trailers ride right behind them, and
   the couch episode comes after. */
const SHELF_ORDER = ['Quick one', 'Coming soon', 'Settle in', LOCAL_SHELF];

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

const state = { root: null, tv: null, yt: null, past: null, view: 'tonight', shown: WIRE_PAGE,
                jump: null, jumpTried: false };   // a shared-in 'yt:' key

const thumb = (id) => 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';

/* --------------------------------------------------------------- bench */
/* The editor benches more videos each night than the shelves show —
   `shelf.more` on the data branch, about thirty a night. tv.html rendered
   them behind "Show more" and swapped one in whenever a reader hid a pick;
   this tab dropped both when that page retired, which silently threw the
   bench away. Ported here with one difference: this app never re-renders
   under a reader, so a mid-scroll ✕ dims the card now and the swap-in
   happens on the next draw of the shelf. */

const isSkipped = (v) => !!v && store.tvReacts()[v.id] === 'skip';

function composeShelf(shelf) {
  const pool = (Array.isArray(shelf.more) ? shelf.more : [])
    .filter((v) => v && app.isVideoId(v.id));
  const visible = [];
  (shelf.items || []).forEach((item) => {
    if (!item || !app.isVideoId(item.id)) return;
    if (isSkipped(item)) {
      const i = pool.findIndex((a) => !isSkipped(a));
      if (i >= 0) { visible.push({ v: pool.splice(i, 1)[0], swapped: true }); return; }
    }
    visible.push({ v: item, swapped: false });
  });
  return { visible, bench: pool };
}

/* The reader hid tonight's pick: the editor's first un-hidden runner-up
   steps in. If those are all hidden too the original stays, dimmed —
   the slot is never empty. */
function composePick(tv) {
  const pick = tv.pick;
  if (!pick || !isSkipped(pick)) return { pick, swapped: false };
  const alt = (Array.isArray(tv.pick_more) ? tv.pick_more : [])
    .find((a) => a && app.isVideoId(a.id) && !isSkipped(a));
  return alt ? { pick: alt, swapped: true } : { pick, swapped: false };
}

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

export function activate(param) {
  /* a shared link: #watch/yt:<id>. The card may live in tonight's edition or
     only on the wider wire — tryJump() flips the view once before giving up. */
  if (param) {
    state.jump = param;
    state.jumpTried = false;
    if (state.tv || state.yt) render();
  }
}

/* Consumed at the end of every render path. */
function tryJump(root) {
  if (!state.jump) return;
  if (app.flashHit(root, state.jump)) {
    state.jump = null;
    state.jumpTried = false;
    return;
  }
  if (!state.jumpTried && state.view === 'tonight') {
    state.jumpTried = true;
    state.view = 'wire';
    render();
    return;
  }
  state.jump = null;
  state.jumpTried = false;
  app.toast('That video has moved on — here’s what’s playing now');
}
/* the Local switch is a whole-app mode; a tab that mounted before it flipped
   has to redraw when you come back to it */
export function refresh() { if (state.tv || state.yt) render(); }
export function deactivate() {}

function render() {
  const root = state.root;
  if (!state.tv && !state.yt) return;
  root.innerHTML = '';

  const set = store.settings();
  const tvAll = [];
  (Array.isArray(state.tv?.shelves) ? state.tv.shelves : [])
    .forEach((sh) => (sh?.items || []).forEach((v) => tvAll.push(v)));
  if (state.tv?.pick) tvAll.push(state.tv.pick);
  const wireAll = (state.yt?.videos || []);
  const pool = state.view === 'wire' ? wireAll : tvAll;
  localSwitch(root, {
    on: set.localOnly,
    local: pool.filter(isLocalVideo).length + (state.view === 'wire' ? 0 : (state.tv?.live || []).length),
    all: pool.length + (state.view === 'wire' ? 0 : (state.tv?.live || []).length),
    noun: 'videos',
    extra: app.jarBtn('watch'),
    onChange(on) { app.setLocal(on); root.scrollTo({ top: 0 }); },
  });

  tabStamp(root, stampOf(state.tv?.generated) || stampOf(state.yt?.generated),
    state.view === 'wire' ? 'the youtube wire, every 3 hours' : 'tonight’s edition, built each morning');

  /* The Btown TV masthead, kept to three lines. On tv.html it was a full
     hero and pushed the first video off the screen; here it is a label. */
  const mast = el('header', 'tvmast');
  mast.innerHTML =
    '<p class="tvmast-pre">Btown Brief presents</p>' +
    '<h1>BTown TV</h1>' +
    /* the promise has to match what is actually on the screen — in local mode
       there is no nightly pick and one shelf, not six */
    '<p class="tvmast-sub">' + (set.localOnly
      ? 'Everything filmed here, made here or about here, pulled out of tonight’s edition ' +
        'and the live cameras — each with a reason.'
      : 'One curated page of video for Burlington, every evening. A pick for tonight and ' +
        'seven shelves — around fifty videos, each with a reason.') + '</p>';

  /* Every edition is published as its own YouTube playlist, and casting the
     whole night to a TV is the best thing this tab does. It was a quiet
     outline button below six shelves, which is where features go to die —
     it belongs in the masthead, filled, the way BTown TV had it. */
  if (state.view === 'tonight') {
    const row = el('div', 'tvmast-row');
    const play = playlistLink(state.tv, 'Play tonight on your TV');
    if (play) {
      row.appendChild(play);
      row.appendChild(el('span', 'tvmast-n', 'the whole edition, in order'));
    } else {
      /* Publishing the playlist can fail on the night (a dropped connection
         mid-upload has done it), and then this tab looks like it never had
         the feature. Offer the most recent night that does have one, said
         plainly — it is still fifty picked videos ready for a TV. */
      const prev = (state.past || []).find((e) => playlistUrl(e));
      if (prev) {
        const alt = playlistLink(prev, 'Play ' + dayLabel(prev.generated || prev.edition) + ' on your TV');
        row.appendChild(alt);
        row.appendChild(el('span', 'tvmast-n', 'tonight’s playlist isn’t up yet'));
      } else if (!state.past) {
        loadPast(() => { if (state.view === 'tonight') render(); });
      }
    }
    if (row.children.length) mast.appendChild(row);
  }
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

  const localOnly = store.settings().localOnly;
  const shelves = localOnly ? localShelves(tv.shelves) : (Array.isArray(tv.shelves) ? tv.shelves : []);

  const picked = composePick(tv);
  const pick = picked.pick;
  /* the nightly pick is usually a documentary from anywhere; in local mode it
     only leads if it is actually from here */
  if (pick && typeof pick === 'object' && app.isVideoId(pick.id) &&
      (!localOnly || isLocalVideo(pick))) {
    const hero = el('button', 'hero');
    hero.dataset.k = 'yt:' + pick.id;
    hero.innerHTML =
      '<img loading="lazy" src="' + thumb(pick.id) + '" alt="">' +
      '<span class="hero-body">' +
        /* "pick" alone never said an editor stood behind it */
        '<span class="eyebrow">' + (picked.swapped
          ? 'Runner-up pick · you hid the first choice'
          : 'Tonight’s pick · curated') + '</span>' +
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

  if (localOnly && !shelves.length) {
    root.appendChild(el('p', 'empty',
      'Nothing filmed here made tonight’s edition. The cameras above are still running, ' +
      'and Past picks has the last two weeks.'));
  }

  orderShelves(shelves).forEach((s) => {
    /* localShelves() filters items but not the bench — filter it here or
       local mode swaps a national video in for a hidden Vermont one */
    const c = composeShelf(localOnly
      ? { ...s, more: (Array.isArray(s.more) ? s.more : []).filter(isLocalVideo) }
      : s);
    if (!c.visible.length && !c.bench.length) return;
    shelfHead(root, s.title, s.sub, s.title === LOCAL_SHELF ? pastShelfHeadBtn(s) : null);
    /* Local mode leaves four or five clips on a shelf built for twelve. A
       half-empty scroller reads as "there is nothing here"; the same clips
       laid out flat read as a short list, which is the truth. */
    const { track, sync } = rail(root, { label: 'videos', open: localOnly });
    track.appendChild(pastEditionCard(s));
    c.visible.forEach(({ v, swapped }) => track.appendChild(videoCard(v, { swapped })));
    sync();
    if (c.bench.length) {
      const n = c.bench.length;
      const more = el('button', 'shelf-more bench-more',
        'Show ' + n + ' more · the editor’s bench');
      more.addEventListener('click', () => {
        c.bench.forEach((v) => track.appendChild(videoCard(v)));
        hydrateVotes(track, c.bench.map((v) => 'yt:' + v.id));
        sync();
        more.remove();
      });
      root.appendChild(more);
    }
  });

  root.appendChild(el('p', 'srcline', 'Edition ' + esc(tv.edition || '')));
  hydrateVotes(root, [...root.querySelectorAll('[data-k]')].map((n) => n.dataset.k));
  tryJump(root);
}

/* Local video is the whole reason this tab exists, and one night's shelf is
   five clips. A channel that posted yesterday is invisible by tomorrow. So
   the local shelf gets its own history button — not another toggle at the
   top of the page, where there are already three. */
function openShelfHistory(shelf) {
  app.sheet(shelf.title + ' — past editions', (body) => {
      if (!state.past) {
        body.appendChild(el('p', 'loading', 'Opening the archive…'));
        loadPast(() => { body.innerHTML = ''; fillShelfHistory(body, shelf); });
        return;
      }
      fillShelfHistory(body, shelf);
  });
}

function pastShelfHeadBtn(shelf) {
  const b = el('button', 'shelf-more', 'Past editions');
  b.addEventListener('click', () => openShelfHistory(shelf));
  return b;
}

function pastEditionCard(shelf) {
  const b = el('button', 'v past-editions-card',
    '<span class="past-editions-icon" aria-hidden="true">' + ICON.board + '</span>' +
    '<span class="past-editions-title">Past editions</span>' +
    '<span class="past-editions-sub">Earlier nights</span>');
  b.addEventListener('click', () => openShelfHistory(shelf));
  return b;
}

function fillShelfHistory(body, shelf) {
  const today = new Set();
  const tonightShelves = state.tv?.shelves || [];
  const tonightMatch = tonightShelves.find((s) => shelf.key && s?.key === shelf.key) ||
    tonightShelves.find((s) => s?.title === shelf.title);
  (tonightMatch?.items || []).forEach((v) => v && today.add(v.id));

  const seen = new Set();
  const nights = [];
  [...(state.past || [])].sort((a, b) =>
    Date.parse(b?.generated || b?.edition || '') - Date.parse(a?.generated || a?.edition || '')
  ).forEach((ed) => {
    const shelves = Array.isArray(ed?.shelves) ? ed.shelves : [];
    const match = shelves.find((s) => shelf.key && s?.key === shelf.key) ||
      shelves.find((s) => s?.title === shelf.title);
    if (!match) return;
    const items = (match.items || []).filter((v) => {
      if (!v || !app.isVideoId(v.id) || today.has(v.id) || seen.has(v.id)) return false;
      seen.add(v.id);
      return true;
    });
    if (items.length) nights.push({ edition: ed, items });
  });

  if (!nights.length) {
    body.appendChild(el('p', 'empty', 'Everything from recent editions is already on tonight’s shelf.'));
    return;
  }
  const keys = [];
  nights.forEach(({ edition, items }) => {
    shelfHead(body, dayLabel(edition.generated || edition.edition),
      items.length + (items.length === 1 ? ' video' : ' videos'));
    const grid = el('div', 'vgrid');
    items.forEach((v) => { grid.appendChild(videoCard(v)); keys.push('yt:' + v.id); });
    body.appendChild(grid);
  });
  hydrateVotes(body, keys);
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
    const localOnly = store.settings().localOnly;
    const items = [];
    if (ed.pick && app.isVideoId(ed.pick.id) && (!localOnly || isLocalVideo(ed.pick))) items.push(ed.pick);
    (Array.isArray(ed.shelves) ? ed.shelves : []).forEach((s) => {
      (Array.isArray(s?.items) ? s.items : []).forEach((v) => {
        if (!v || !app.isVideoId(v.id)) return;
        if (localOnly && !(isLocalVideo(v) || s?.title === LOCAL_SHELF)) return;
        items.push(v);
      });
    });
    if (!items.length) return;
    const { track, sync } = rail(root, { label: 'videos' });
    items.forEach((v) => track.appendChild(videoCard(v)));
    sync();
    const play = playlistLink(ed, 'Play this night on your TV', true);
    if (play) {
      const row = el('div', 'btns');
      row.style.margin = '-2px 0 6px';
      row.appendChild(play);
      root.appendChild(row);
    }
  });
  hydrateVotes(root, [...root.querySelectorAll('[data-k]')].map((n) => n.dataset.k));
  tryJump(root);
}

/* ------------------------------------------------------------ the wire */

function renderWire(root) {
  const localOnly = store.settings().localOnly;
  const vids = (state.yt?.videos || [])
    /* trailer-house channels feed only the edition's Coming soon shelf —
       on the raw wire they'd read as promo spam (same rule as pulse.js) */
    .filter((v) => v && app.isVideoId(v.id) && v.g !== 'trailer' &&
      (!localOnly || isLocalVideo(v)));
  if (!vids.length) {
    root.appendChild(el('p', 'empty', 'The YouTube wire isn’t answering right now.'));
    return;
  }
  heading(root, {
    eyebrow: 'Everything new',
    title: 'The firehose, newest first',
    sub: '<span class="count">' + vids.length + (localOnly
      ? ' from Vermont channels · nothing curated</span>'
      : ' videos from the channels we follow · nothing curated</span>'),
  });
  const grid = el('div', 'vgrid');
  const slice = vids.slice(0, state.shown);
  slice.forEach((v) => grid.appendChild(videoCard(v)));
  root.appendChild(grid);
  if (state.shown < vids.length) {
    const more = el('button', 'more', 'More videos');
    more.addEventListener('click', () => {
      const from = state.shown;
      state.shown += WIRE_PAGE;
      const added = vids.slice(from, state.shown);
      added.forEach((v) => grid.appendChild(videoCard(v)));
      hydrateVotes(grid, added.map((v) => 'yt:' + v.id));
      if (state.shown >= vids.length) more.remove();
    });
    root.appendChild(more);
  }
  hydrateVotes(root, slice.map((v) => 'yt:' + v.id));
  tryJump(root);
}

/* Each night's edition is published as its own YouTube playlist — the first
   fifty videos in page order — so you can cast the whole thing to a TV. The
   url is validated to exactly the playlist shape before it becomes an href,
   the same test tv.html used. */
const playlistUrl = (edition) => {
  const url = edition?.playlist?.url;
  return url && /^https:\/\/www\.youtube\.com\/playlist\?list=[A-Za-z0-9_-]+$/.test(url) ? url : null;
};

function playlistLink(edition, label, quiet) {
  const url = playlistUrl(edition);
  if (!url) return null;
  const a = el('a', quiet ? 'btn btn-quiet' : 'btn tv-play',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>' + esc(label));
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
      (opts.swapped ? '<span class="v-next">Next up · stepped in for one you hid</span>' : '') +
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
      const now = store.tvReact(v.id, kind, v.t, v.ch);
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

  const sh = shareBtn();
  sh.addEventListener('click', () => app.share('watch', k, v.t || ''));

  acts.append(mark('watched', ICON.check, 'Watched'), mark('skip', ICON.x, 'Not for me'), star, sh);
  return acts;
}
