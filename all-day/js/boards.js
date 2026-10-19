/* boards.js — reader posts, for every tab that has them, built once.

   The People, Vintage, Art, Watchlist, Games, Square and Gatherings boards
   all need the same few things: a reader who is known, a place to post,
   votes, reports, an expiry and a way to take a post down. This module is
   that, on the fleet's Supabase project under the nn_ prefix
   (supabase/nn-SETUP.sql, then nn-ROUND2.sql to nn-ROUND4.sql), with the rules in
   boards-core.js and an in-memory copy of the server in boards-fake.js for
   ?demo=1. A tab never talks to Supabase about posts itself.

   For a tab, the whole API:

     import * as boards from '../boards.js';
     boards.list('vintage', { kind: 'spotted', meta: { size: 'M' }, limit, before, sort: 'top' })
                                       -> { ok, posts }   posts newest first
     boards.item(post, { tab, ratio, meta: (p) => 'Size M · $28' })
                                       -> an item for cards.board (app.know() it, or use boards.draw)
     boards.draw(host, posts, opts)    -> draws and knows them; the host must be bindFeed()-ed
     boards.compose({ board, kind, heading, title, body, place, fields, notes, onPosted })
                                       -> opens the compose sheet
     boards.create(board, { kind, title, body, place, meta, photo, consent }) -> { ok, post }
     boards.put(id, { got: true })     -> { ok, post }   change your own post's fields; a null removes one
     boards.mine() -> { ok, posts }     boards.remove(id) -> { ok }
     boards.vote(id) / boards.unvote(id) -> { ok, votes, voted, moved }
                                       moved: the posts a one-vote kind's vote left (the Watch ballot)
     boards.votesByWeek(board, weeks)  -> { ok, weeks: [{ post, week: '2026-W42', votes }] }
                                       votes counted by the Burlington week they were cast
     boards.report(id, reason)          -> { ok, hidden }
     boards.profile() -> { ok, profile } boards.setProfile({ display_name, neighborhood, archetype, interests, handles, handles_public })
                                       interests, handles or the switch left out: the server keeps what it has
                                       profile: { display_name, neighborhood, archetype, interests: [],
                                                  handles: { strava: 'maya_runs', … }, handles_public: false }
     boards.setHandles(handles, isPublic) -> { ok, profile }
                                       handles: { instagram, spotify, strava, letterboxd, goodreads, beli,
                                       untappd, psn, xbox, steam, switch, discord, epic, riot, chess, linkedin }
                                       (any of them; '' or null drops one; the map replaces the old one;
                                       null keeps it). isPublic: the "show my handles" switch (null keeps it).
     boards.handlesRecent(kinds, limit) -> { ok, people: [{ display_name, neighborhood, handles, updated_at, me }] }
                                       signed in only: the most recently updated profiles whose switch is
                                       on, with their handles of those kinds (all kinds when none are
                                       given; limit 20 by default, 60 at most). updated_at is a day,
                                       '2026-10-17'. Never an email or an account id.
     boards.roundTwo() / boards.roundFour() -> true | false | null (could not ask)
     boards.hasBoard('playlists')      -> true | false | null: the server's rules carry that board
     boards.status()  'unknown' | 'live' | 'off' (the SQL is not pasted yet)

   The Games ('playing', 'lfg'), Square ('post', 'show', 'ask', 'free',
   'pets') and Gatherings ('gathering') boards go through the same list,
   create, put, vote and report calls; their fields are in boards-core.js
   RULES. A gathering waits for Stephen before it shows (create() answers
   post.status 'pending'), and ends the day after the date its `when` starts
   with ('2026-10-24, 7 pm'), so a tab should start `when` with that date.

   put() and votesByWeek() need nn-ROUND2.sql; until it is pasted they
   answer { ok: false, error: 'off' } and the rest of the boards stay live,
   so a tab can fall back to what it did before. The kinds and fields round
   two added (a Vintage design or fit, a plan's meetup and ages, a film id)
   are refused by a server without it, so a tab asks boards.roundTwo()
   (true once the server's rules are version 2) before posting one, and
   posts the old shape until then. Likewise the three new boards and the
   handles need nn-ROUND4.sql: a tab asks boards.roundFour() (rules version
   3) before offering to post on one, handlesRecent() answers 'off' until
   it is pasted, and setProfile() saves everything else and answers
   handlesSaved: false.

   Every call resolves { ok: true, ... } or { ok: false, error, message } and
   never rejects; `message` is a sentence to show as is. Signed-out readers
   can read and vote (the vote is the device's anonymous btown-player-id);
   posting and reporting need the email sign-in. A card's vote, report and
   delete buttons are wired here, through app.onAct(); a tab only draws.
   After any change the window hears 'allday-boards' { board, id, what }.

   Privacy, by construction: the server never hands back an email or an
   account id, only a first name, and nothing here stores one. */

import * as app from './app.js';
import * as store from './store.js';
import { el, esc, ICON, agoShort, pills, button, cards } from './ui.js';
import { RULES, BOARD_LABELS, NEIGHBORHOOD_LABELS, ARCHETYPE_LABELS, REASON_LABELS, INTEREST_LABELS, HANDLE_LABELS, HANDLE_GROUPS, HANDLE_HINTS,
  message, checkPost, checkProfile, checkHandles, dateError, leftLabel } from './boards-core.js';
import { FakeBoards, seedDemo, DEMO_ME } from './boards-fake.js';

const PHOTOS_LIB = '../js/photos-lib.js';
const PHOTO_BASE = store.SB_URL + '/storage/v1/object/public/btb-photos/';
/* the photo queue's area list (db/photos.sql), from a profile's neighborhood */
const AREA = { downtown: 'Downtown / Church St', 'old-north-end': 'Old North End', 'new-north-end': 'New North End', 'south-end': 'South End',
  hill: 'Hill Section', waterfront: 'Waterfront', winooski: 'Winooski', 'south-burlington': 'South Burlington', essex: 'Essex / Essex Jct',
  shelburne: 'Shelburne', colchester: 'Colchester' };

/* ------------------------------------------------------------- backends */
let fake = null;
function demoBackend() {
  if (!fake) fake = seedDemo(new FakeBoards({ modSecret: 'demo' }));
  return fake;
}
let state = 'unknown';
export const status = () => state;

const fail = (error) => ({ ok: false, error, message: message(error) });
/* later rounds' own doors (nn-ROUND2.sql, nn-ROUND4.sql): missing, they
   are 'off' for the call, never for the boards */
const ROUND2 = new Set(['nn_post_meta_set', 'nn_votes_by_week', 'nn_handles_recent']);

/* One call to an nn_ function, as the reader. Live, it is a POST to
   PostgREST with the reader's token when signed in; the server's refusal
   arrives as {"code":"P0001","message":"<our code>"}. A function that does
   not exist yet (the SQL not pasted) is 404 PGRST202: the boards are 'off'. */
function call(fn, args) {
  if (app.demo) {
    const u = app.user();
    return Promise.resolve().then(() => ({ ok: true, data: demoBackend().as(u ? u.id : null).call(fn, args || {}) }))
      .catch((e) => fail(e.code || 'offline'));
  }
  const signedIn = !!app.user();
  return Promise.resolve(signedIn ? app.token() : null).then((tok) => {
    /* signed in but no token (offline, or the refresh failed): say so, rather
       than let the call go as a stranger and come back "sign in first" */
    if (signedIn && !tok) throw new Error('no token');
    return tok;
  }).then((tok) => fetch(store.SB_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: Object.assign({ apikey: store.SB_KEY, 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}),
    body: JSON.stringify(args || {}),
  })).then((r) => r.text().then((t) => {
    let j = null;
    try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
    if (r.ok) { state = 'live'; return { ok: true, data: j }; }
    if (r.status === 404 && j && j.code === 'PGRST202') { if (!ROUND2.has(fn)) state = 'off'; return fail('off'); }
    if (r.status === 401) return fail('not_signed_in');
    const code = j && typeof j.message === 'string' && /^[a-z_]+$/.test(j.message) ? j.message : 'offline';
    if (code !== 'offline') state = 'live';
    return fail(code);
  }), () => fail(app.user() ? 'offline' : 'not_signed_in'));   // a refused refresh has signed the reader out
}

const changed = (board, id, what) => window.dispatchEvent(new CustomEvent('allday-boards', { detail: { board, id, what } }));

/* Which rounds has Stephen pasted? The server's rules say: version 2 is
   nn-ROUND2.sql, version 3 is nn-ROUND4.sql. Each resolves true or false
   once the server has answered, and null when it could not be asked
   (offline): a tab then posts the old shape, which every server takes, and
   does nothing it cannot undo. Asked once a visit; an unanswered ask is
   asked again next time. */
let ver = null;
function serverRules() {
  if (app.demo) return Promise.resolve(RULES);
  if (!ver) {
    ver = call('nn_rules').then((r) => {
      if (!r.ok) { ver = null; return null; }
      return r.data && typeof r.data === 'object' ? r.data : {};
    });
  }
  return ver;
}
const rulesVersion = () => serverRules().then((d) => (d == null ? null : Number(d.version) || 1));
export const roundTwo = () => rulesVersion().then((v) => (v == null ? null : v >= 2));
export const roundFour = () => rulesVersion().then((v) => (v == null ? null : v >= 3));
/* a board added without a new version (the Playlists board, nn-PLAYLISTS.sql):
   true once the server's rules carry it, so a tab never asks for a board the
   server would refuse */
export const hasBoard = (board) => serverRules().then((d) => (d == null ? null : !!(d.boards && Object.prototype.hasOwnProperty.call(d.boards, board))));

/* --------------------------------------------------------------- photos */
/* A post's photo path, as something art() can draw: the public bucket URL
   live; in the demo, the placeholder palette its name carries. */
export function photoUrl(path) {
  if (!path) return null;
  if (app.demo) { const m = String(path).match(/^submissions\/demo-([a-z]+)/); return m ? m[1] : 'paper'; }
  return PHOTO_BASE + String(path).split('/').map(encodeURIComponent).join('/');
}

let libLoad = null;
function photosLib() {
  if (window.BTBP) return Promise.resolve(window.BTBP);
  if (!libLoad) {
    libLoad = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PHOTOS_LIB;
      s.onload = () => (window.BTBP ? resolve(window.BTBP) : reject(new Error('no BTBP')));
      s.onerror = () => { libLoad = null; reject(new Error('could not load the photo library')); };
      document.head.appendChild(s);
    });
  }
  return libLoad;
}

/* Into the fleet's photo queue first (resize, upload, register as pending,
   with the consent box ticked), then the post points at it. Same queue,
   same rules and the same photo-admin.html as every reader photo. */
let demoPhotos = 0;
function sendPhoto(board, file, title, prof) {
  if (app.demo) {
    const palettes = ['dawn', 'teal', 'plum', 'foliage', 'slate'];
    return Promise.resolve(demoBackend().addPhoto('submissions/demo-' + palettes[demoPhotos++ % palettes.length] + '-' + demoPhotos + '.jpg', 'pending'));
  }
  return photosLib().then(async (P) => {
    const blob = await P.resizeImage(file);
    const path = await P.uploadBlob(blob);
    await P.rpc('btb_photos_submit', {
      /* 'board' stays out of the community gallery (db/photos-board.sql) */
      p_path: path, p_caption: title.slice(0, 280), p_category: RULES.boards[board] && RULES.boards[board].gallery ? 'other' : 'board', p_area: AREA[prof && prof.neighborhood] || 'Greater Burlington',
      p_spot: ('All Day · ' + (BOARD_LABELS[board] || board)).slice(0, 120), p_taken: '', p_name: ((prof && prof.display_name) || '').slice(0, 60),
      p_permission: true, p_ai: false, p_voter: store.playerId(),
    });
    return path;
  });
}

/* -------------------------------------------------------------- profile */
/* Cached for the visit, dropped when the reader signs in or out. */
let me;              // undefined: not asked yet; null: no profile; else the profile
let meAsk = null;
app.onAuth(() => { me = undefined; meAsk = null; });
/* a profile always has its interests ([] before nn-ROUND2.sql) and its
   handles ({} and the switch off before nn-ROUND4.sql); an answer without
   them (an older call) keeps the ones the visit already knew */
const normal = (p, prev) => (p ? {
  ...p,
  interests: Array.isArray(p.interests) ? p.interests : ((prev && prev.interests) || []),
  handles: p.handles && typeof p.handles === 'object' && !Array.isArray(p.handles) ? p.handles : ((prev && prev.handles) || {}),
  handles_public: typeof p.handles_public === 'boolean' ? p.handles_public : !!(prev && prev.handles_public),
} : null);

export function profile() {
  if (!app.user()) return Promise.resolve(fail('not_signed_in'));
  if (me !== undefined) return Promise.resolve({ ok: true, profile: me });
  if (!meAsk) {
    meAsk = call('nn_profile_get').then((r) => {
      meAsk = null;
      if (!r.ok) return r;
      me = normal(r.data);
      return { ok: true, profile: me };
    });
  }
  return meAsk;
}
export function setProfile(input) {
  const c = checkProfile(RULES, input || {});
  if (!c.ok) return Promise.resolve(fail(c.error));
  const args = { p_display_name: c.profile.display_name, p_neighborhood: c.profile.neighborhood, p_archetype: c.profile.archetype };
  const prev = me;
  /* with interests it is round two's call, with handles or the switch
     round four's (which takes interests too: null keeps them); before
     those are pasted there is no such call, so the rest is saved without */
  const wantI = !!c.profile.interests;
  const wantH = !!c.profile.handles || c.profile.handles_public !== undefined;
  return (wantI || wantH ? rulesVersion() : Promise.resolve(1)).then((v) => {
    const two = v >= 2, four = v >= 3;
    let a = args;
    if (wantH && four) {
      a = { ...args, p_interests: wantI ? c.profile.interests : null, p_handles: c.profile.handles || null,
        p_handles_public: c.profile.handles_public === undefined ? null : c.profile.handles_public };
    } else if (wantI && two) a = { ...args, p_interests: c.profile.interests };
    return call('nn_profile_set', a).then((r) => {
      if (!r.ok) return r;
      me = normal(r.data, prev);
      changed(null, null, 'profile');
      const out = { ok: true, profile: me };
      if (wantI && !two) out.interestsSaved = false;
      if (wantH && !four) out.handlesSaved = false;
      return out;
    });
  });
}

/* Your handles and the "show my handles" switch, keeping the rest of your
   profile as it is. Needs a profile (a first name) and nn-ROUND4.sql. */
export function setHandles(handles, isPublic) {
  if (!app.user()) return Promise.resolve(fail('not_signed_in'));
  if (handles != null) { const h = checkHandles(RULES, handles); if (!h.ok) return Promise.resolve(Object.assign(fail(h.error), { key: h.key })); }
  return Promise.all([profile(), rulesVersion()]).then(([p, v]) => {
    if (!p.ok) return p;
    if (!p.profile) return fail('no_name');
    if (v == null) return fail('offline');
    if (v < 3) return fail('off');
    const cur = p.profile;
    return setProfile({ display_name: cur.display_name, neighborhood: cur.neighborhood, archetype: cur.archetype,
      handles: handles == null ? undefined : handles, handles_public: isPublic == null ? null : !!isPublic })
      .then((r) => (r.ok ? { ok: true, profile: r.profile } : r));
  });
}

/* For a signed-in reader, the most recently updated profiles whose
   "show my handles" switch is on, with their handles of these kinds. */
export function handlesRecent(kinds, limit) {
  if (!app.user()) return Promise.resolve(Object.assign(fail('not_signed_in'), { people: [] }));
  const list = Array.isArray(kinds) ? kinds : kinds ? [kinds] : [];
  if (list.some((k) => !RULES.handles[k])) return Promise.resolve(Object.assign(fail('bad_handle'), { people: [] }));
  return call('nn_handles_recent', { p_kinds: list.length ? list : null, p_limit: limit || 20 })
    .then((r) => (r.ok ? { ok: true, people: Array.isArray(r.data) ? r.data : [] } : Object.assign(r, { people: [] })));
}

/* ---------------------------------------------------------------- posts */
export function list(board, opts = {}) {
  const filter = {};
  if (opts.kind) filter.kind = opts.kind;
  if (opts.meta && typeof opts.meta === 'object') filter.meta = opts.meta;
  return call('nn_posts_list', {
    p_board: board, p_limit: opts.limit || RULES.limits.listDefault, p_before: opts.before || null, p_filter: filter,
    p_player: store.playerId(), p_sort: opts.sort === 'top' ? 'top' : 'new',
  }).then((r) => (r.ok ? { ok: true, posts: Array.isArray(r.data) ? r.data : [] } : Object.assign(r, { posts: [] })));
}

export function create(board, input = {}) {
  if (!app.user()) return Promise.resolve(fail('not_signed_in'));
  if (input.photo && !input.consent) return Promise.resolve(fail('no_consent'));
  /* the same checks the server runs, before anything is uploaded */
  const pre = checkPost(RULES, board, { ...input, photo_path: input.photo ? 'submissions/check.jpg' : null });
  if (!pre.ok) return Promise.resolve(fail(pre.error));
  const late = dateError(RULES, board, pre.post.kind, pre.post.meta, Date.now());
  if (late) return Promise.resolve(fail(late));
  return profile().then((p) => {
    if (!p.ok) return p;
    if (!p.profile) return fail('no_name');
    const photo = input.photo ? sendPhoto(board, input.photo, pre.post.title, p.profile).catch(() => null) : Promise.resolve(null);
    return photo.then((path) => {
      if (input.photo && !path) return fail('bad_photo');
      return call('nn_post_create', {
        p_board: board, p_kind: pre.post.kind, p_title: pre.post.title, p_body: pre.post.body, p_place: pre.post.place,
        p_meta: pre.post.meta, p_photo: path,
      }).then((r) => {
        if (!r.ok) {
          /* the photo is in the queue but its post is not: take it back out,
             so it can never be approved into the gallery on its own */
          return (path ? call('nn_photo_abandon', { p_path: path }) : Promise.resolve()).then(() => r);
        }
        changed(board, r.data.id, 'create');
        return { ok: true, post: r.data, photoWaiting: !!path };
      });
    });
  });
}

/* Change the fields on your own post (nn_post_meta_set): `meta` goes over
   the fields it has, a null takes one away. The post comes back. */
export function put(id, meta) {
  /* the drawing helper used to be called put(host, posts, opts) */
  if (id && id.nodeType === 1) return draw(id, meta, arguments[2]);
  if (!app.user()) return Promise.resolve(fail('not_signed_in'));
  return call('nn_post_meta_set', { p_post: id, p_meta: meta || {} }).then((r) => {
    if (!r.ok) return r;
    changed(r.data.board, id, 'edit');
    return { ok: true, post: r.data };
  });
}

/* Votes counted by the Burlington week they were cast: this week and the
   weeks - 1 before it. Weeks are ISO labels (boards-core isoWeek). */
export function votesByWeek(board, weeks) {
  return call('nn_votes_by_week', { p_board: board, p_weeks: weeks || 8 })
    .then((r) => (r.ok ? { ok: true, weeks: Array.isArray(r.data) ? r.data : [] } : Object.assign(r, { weeks: [] })));
}

export function mine() {
  if (!app.user()) return Promise.resolve(Object.assign(fail('not_signed_in'), { posts: [] }));
  return call('nn_post_mine').then((r) => (r.ok ? { ok: true, posts: r.data || [] } : Object.assign(r, { posts: [] })));
}
export function remove(id) {
  return call('nn_post_delete_own', { p_post: id }).then((r) => { if (r.ok) changed(null, id, 'delete'); return r.ok ? { ok: true } : r; });
}
export function vote(id) {
  return call('nn_vote', { p_post: id, p_player: store.playerId() })
    .then((r) => (r.ok ? { ok: true, votes: Number(r.data.votes) || 0, voted: true, moved: Array.isArray(r.data.moved) ? r.data.moved : [] } : r));
}
export function unvote(id) {
  return call('nn_unvote', { p_post: id, p_player: store.playerId() }).then((r) => (r.ok ? { ok: true, votes: Number(r.data.votes) || 0, voted: false } : r));
}
export function report(id, reason) {
  if (!app.user()) return Promise.resolve(fail('not_signed_in'));
  return call('nn_report', { p_post: id, p_reason: reason }).then((r) => {
    if (!r.ok) return r;
    if (r.data.hidden) changed(null, id, 'hidden');
    return { ok: true, hidden: !!r.data.hidden };
  });
}
/* Other modules' own data goes with the account: each registers a
   function that deletes it and resolves { ok } (Habits: sz_delete_me).
   They run first, and any refusal but 'off' (their SQL not pasted, so
   nothing to delete) stops the deletion with its message, so Settings never
   says "Deleted" while something is left behind. */
const alsoDelete = new Set();
export function onDeleteMe(fn) { alsoDelete.add(fn); return () => alsoDelete.delete(fn); }
export function deleteMe() {
  return Promise.all([...alsoDelete].map((fn) => Promise.resolve().then(fn).catch(() => fail('offline')))).then((rs) => {
    const bad = rs.find((r) => r && !r.ok && r.error !== 'off');
    return bad || call('nn_delete_me');
  }).then((r) => {
    if (!r.ok) return r;
    me = undefined;
    changed(null, null, 'deleteme');
    return { ok: true };
  });
}

/* ---------------------------------------------------------------- cards */
/* A server post as an item cards.board draws. `meta` is the tab's own
   one-line summary of its fields ("Battery Street Jeans · L · $28"); the
   default joins the values. `tab` is where the deep link lands. */
export function item(post, opts = {}) {
  const created = Date.parse(post.created_at) || Date.now();
  const ends = post.expires_at ? Date.parse(post.expires_at) : null;
  const metaLine = opts.meta ? opts.meta(post) : Object.values(post.meta || {}).join(' · ');
  return {
    k: 'b-' + post.id, kind: 'board', id: post.id, board: post.board, href: '#' + (opts.tab || post.board) + '/b-' + post.id,
    title: post.title, text: post.body || '', author: post.author, arch: ARCHETYPE_LABELS[post.author_arch] || '',
    ago: agoShort(created / 1000), created: created / 1000, media: photoUrl(post.photo), ratio: opts.ratio || 'r45',
    metaLine: metaLine || '', place: post.place || '', votes: Number(post.votes) || 0, voted: !!post.voted, mine: !!post.mine,
    left: leftLabel(ends, Date.now()),
  };
}
export function draw(host, posts, opts = {}) {
  const items = (posts || []).map((p) => item(p, opts));
  app.know(items);
  items.forEach((it) => { const n = cards.board(it); if (n) host.appendChild(n); });
  return items;
}

/* The three buttons on a board card. bindFeed() hands them here. */
const nodesOf = (it) => document.querySelectorAll('.card.board[data-k="' + CSS.escape(it.k) + '"]');
function paintVote(it) {
  nodesOf(it).forEach((c) => {
    const b = c.querySelector('[data-act="bvote"]');
    if (!b) return;
    b.classList.toggle('on', it.voted);
    b.setAttribute('aria-pressed', it.voted ? 'true' : 'false');
    b.querySelector('.n').textContent = it.votes || '';
  });
}
app.onAct('bvote', (it) => {
  const was = { votes: it.votes, voted: it.voted };
  it.voted = !it.voted;
  it.votes = Math.max(0, it.votes + (it.voted ? 1 : -1));
  paintVote(it);
  (it.voted ? vote : unvote)(it.id).then((r) => {
    if (r.ok) {
      it.votes = r.votes; it.voted = r.voted; paintVote(it);
      /* a one-vote kind moved the vote off another post */
      (r.moved || []).forEach((id) => { const o = app.item('b-' + id); if (o && o.voted) { o.voted = false; o.votes = Math.max(0, o.votes - 1); paintVote(o); } });
      return;
    }
    Object.assign(it, was);
    paintVote(it);
    app.toast(r.message);
  });
});
app.onAct('breport', (it) => {
  if (!app.user()) { app.toast('Sign in to report.'); return; }
  app.sheet('Report this post', (body, card, close) => {
    body.appendChild(el('p', 'sheet-note', esc('“' + it.title + '”. Who reported it is never shown.')));
    RULES.reasons.forEach((reason) => {
      const r = el('div', 'sheet-row', '<div class="t">' + esc(REASON_LABELS[reason]) + '</div>');
      r.appendChild(button('Report', 'ghost sm', () => {
        close();
        report(it.id, reason).then((res) => {
          if (!res.ok) { app.toast(res.message); return; }
          if (res.hidden) nodesOf(it).forEach((n) => n.remove());
          app.toast(res.hidden ? 'Thanks. It’s down until Stephen has a look.' : 'Thanks. Stephen will take a look.');
        });
      }));
      body.appendChild(r);
    });
  });
});
app.onAct('bdelete', (it) => {
  app.confirmBox({
    title: 'Delete this post?', body: 'It goes for good, with its votes. This can’t be undone.', yes: 'Delete',
    onYes() {
      remove(it.id).then((r) => {
        if (!r.ok) { app.toast(r.message); return; }
        nodesOf(it).forEach((n) => n.remove());
        app.toast('Deleted');
      });
    },
  });
});

/* ------------------------------------------------------------- compose */
/* The one compose sheet. A tab passes its board and kind, the words for
   its title and body, its own fields as a small schema, and its notes
   ("We feature, we don't review."). Fields:
     { key, label, type: 'text' | 'int' | 'enum' | 'url', options: [[value, label]], placeholder, required }
   Only keys the board's rules know are accepted by the server. */
export function compose(opts) {
  const board = opts.board, kind = opts.kind;
  const rule = RULES.boards[board] && RULES.boards[board].kinds[kind];
  if (!rule) { app.toast(message('bad_kind')); return null; }
  return app.sheet(opts.heading || 'Post', (body, card, close) => {
    const note = (t) => body.appendChild(el('p', 'sheet-note', esc(t)));
    if (!app.user()) {
      note('Sign in to post.');
      const r = el('div', 'linkrow');
      r.appendChild(button('Sign in', '', () => app.openSettings()));
      body.appendChild(r);
      return;
    }
    const wait = el('p', 'loading', 'One moment…');
    body.appendChild(wait);
    profile().then((p) => {
      wait.remove();
      if (!p.ok) { note(p.message); return; }
      form(body, card, close, opts, rule, p.profile);
    });
  });
}

const fieldId = (() => { let n = 0; return () => 'bf' + (++n); })();
function labelled(label, input, hint, required) {
  const id = fieldId();
  input.id = id;
  const w = el('div', 'bf-row');
  w.appendChild(el('label', 'bf-label', esc(label) + (required ? '' : ' <span class="bf-opt">optional</span>')));
  w.firstChild.htmlFor = id;
  w.appendChild(input);
  if (hint) w.appendChild(el('p', 'bf-hint', esc(hint)));
  return w;
}
function input(type, name, o = {}) {
  const i = el(type === 'textarea' ? 'textarea' : 'input', 'field bf-in');
  if (type !== 'textarea') i.type = type;
  i.name = name;
  if (o.max) i.maxLength = o.max;
  if (o.placeholder) i.placeholder = o.placeholder;
  if (o.value) i.value = o.value;
  if (type === 'number') i.inputMode = 'numeric';
  return i;
}
function select(name, options, value) {
  const s = el('select', 'field bf-in');
  s.name = name;
  options.forEach(([v, label]) => { const o = el('option', null, esc(label)); o.value = v; if (v === value) o.selected = true; s.appendChild(o); });
  return s;
}

function form(body, card, close, opts, rule, prof) {
  const L = RULES.limits;
  const f = el('form', 'bform');
  f.noValidate = true;
  if (!prof) {
    f.appendChild(labelled('Your first name', input('text', 'display_name', { max: L.nameMax, placeholder: 'Maya, or Maya R.' }),
      'Neighbors see it.', true));
  }
  f.appendChild(labelled(opts.title || 'Title', input('text', 'title', { max: L.titleMax, placeholder: opts.titlePlaceholder }), null, true));
  (opts.fields || []).forEach((fd) => {
    const need = (rule.needs || []).includes(fd.key) || fd.required;
    const ctl = fd.type === 'enum' ? select('m:' + fd.key, [['', need ? 'Choose one' : 'None']].concat(fd.options || []), '')
      : input(fd.type === 'int' ? 'number' : fd.type === 'url' ? 'url' : 'text', 'm:' + fd.key, { max: fd.max || L.metaTextMax, placeholder: fd.placeholder });
    f.appendChild(labelled(fd.label, ctl, fd.hint, need));
  });
  if (opts.body !== false) f.appendChild(labelled(opts.body || 'More', input('textarea', 'body', { max: L.bodyMax, placeholder: opts.bodyPlaceholder }), null, false));
  if (opts.place) f.appendChild(labelled(opts.place, input('text', 'place', { max: L.placeMax, placeholder: opts.placePlaceholder }), null, false));

  let file = null;
  if (rule.photo !== 'none') {
    const w = el('div', 'bf-row');
    const pick = el('input');
    pick.type = 'file'; pick.accept = 'image/*'; pick.hidden = true; pick.name = 'photo';
    const fname = el('span', 'bf-hint', esc(rule.photo === 'required' ? 'A photo is needed for this one.' : 'No photo'));
    const btn = button(ICON.plus + ' ' + esc(rule.photo === 'required' ? 'Choose a photo' : 'Add a photo'), 'ghost sm', (e) => { e.preventDefault(); pick.click(); });
    btn.type = 'button';
    pick.addEventListener('change', () => { file = pick.files && pick.files[0] || null; fname.textContent = file ? file.name : 'No photo'; });
    const line = el('div', 'bf-photo');
    line.append(btn, fname);
    const consent = el('label', 'consent', '<input type="checkbox" name="consent"> ' +
      esc('I took this photo, and the Brief may show it in All Day and the newsletter.'));
    w.append(line, pick, consent);
    f.appendChild(w);
  }
  (opts.notes || []).forEach((n) => f.appendChild(el('p', 'bf-note', esc(n))));
  const msg = el('p', 'bf-msg');
  msg.setAttribute('role', 'status');
  const go = button(esc(opts.cta || 'Post'), '');
  go.type = 'submit';
  const row = el('div', 'bf-go');
  row.append(go, msg);
  f.appendChild(row);
  body.appendChild(f);

  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const say = (code) => { msg.textContent = message(code); msg.classList.add('err'); go.disabled = false; };
    const meta = {};
    (opts.fields || []).forEach((x) => {
      const v = String(fd.get('m:' + x.key) || '').trim();
      if (!v) return;
      meta[x.key] = x.type === 'int' ? (/^-?\d+$/.test(v) ? Number(v) : v) : v;
    });
    const post = { kind: opts.kind, title: fd.get('title'), body: fd.get('body') || '', place: fd.get('place') || '', meta,
      photo: file, consent: !!fd.get('consent') };
    if (!prof && !String(fd.get('display_name') || '').trim()) return say('no_name');
    if (file && !post.consent) return say('no_consent');
    const pre = checkPost(RULES, opts.board, { ...post, photo_path: file ? 'submissions/check.jpg' : null });
    if (!pre.ok) return say(pre.error);
    go.disabled = true;
    msg.classList.remove('err');
    msg.textContent = file ? 'Sending the photo…' : 'Posting…';
    const named = prof ? Promise.resolve({ ok: true }) : setProfile({ display_name: fd.get('display_name') });
    named.then((n) => {
      if (!n.ok) return say(n.error);
      return create(opts.board, post).then((r) => {
        if (!r.ok) return say(r.error);
        close();
        app.toast(r.post.status === 'pending' ? 'Posted. It shows once approved.'
          : r.photoWaiting ? 'Posted. The photo shows once approved.' : 'Posted');
        if (opts.onPosted) opts.onPosted(r.post);
      });
    });
  });
}

/* ------------------------------------------------------ account sheets */
/* Settings → Your account, signed in: the profile, your posts, sign out,
   and delete. app.js draws the signed-out states and calls this when there
   is a reader. */
export function profileSheet() {
  app.sheet('Your profile', (body, card, close) => {
    const wait = el('p', 'loading', 'One moment…');
    body.appendChild(wait);
    profile().then((p) => {
      wait.remove();
      if (!p.ok) { body.appendChild(el('p', 'sheet-note', esc(p.message))); return; }
      const cur = p.profile || {};
      const f = el('form', 'bform');
      f.noValidate = true;
      f.appendChild(labelled('Your first name', input('text', 'display_name', { max: RULES.limits.nameMax, placeholder: 'Maya, or Maya R.', value: cur.display_name }),
        'Neighbors see it.', true));
      f.appendChild(labelled('Neighborhood', select('neighborhood', [['', 'None']].concat(RULES.neighborhoods.map((h) => [h, NEIGHBORHOOD_LABELS[h]])), cur.neighborhood || ''), null, false));
      let arch = cur.archetype || '';
      const w = el('div', 'bf-row');
      w.appendChild(el('div', 'bf-label', 'Who are you here as? <span class="bf-opt">optional</span>'));
      w.appendChild(pills([['', 'None']].concat(RULES.archetypes.map((a) => [a, ARCHETYPE_LABELS[a]])), arch, (v) => { arch = v; }, 'wrap'));
      f.appendChild(w);
      /* what you're into: any of the activity list, several at once */
      const into = new Set(cur.interests || []);
      const iw = el('div', 'bf-row');
      iw.appendChild(el('div', 'bf-label', 'What you’re into <span class="bf-opt">optional</span>'));
      const box = el('div', 'pills wrap');
      box.dataset.interests = '';
      RULES.interests.forEach((k) => {
        const b = el('button', into.has(k) ? 'on' : '', esc(INTEREST_LABELS[k]));
        b.type = 'button';
        b.dataset.k = k;
        b.setAttribute('aria-pressed', into.has(k) ? 'true' : 'false');
        b.addEventListener('click', () => {
          if (into.has(k)) into.delete(k); else if (into.size < RULES.limits.interestsMax) into.add(k); else return;
          b.classList.toggle('on', into.has(k));
          b.setAttribute('aria-pressed', into.has(k) ? 'true' : 'false');
        });
        box.appendChild(b);
      });
      iw.appendChild(box);
      iw.appendChild(el('p', 'bf-hint', esc('Up to eight. Private unless you join the directory.')));
      f.appendChild(iw);
      /* handles: one box per service, in three folds that open when they
         hold one; and the switch */
      const hw = el('div', 'bf-row');
      hw.dataset.handles = '';
      hw.appendChild(el('div', 'bf-label', 'Handles <span class="bf-opt">optional</span>'));
      const had = cur.handles || {};
      HANDLE_GROUPS.forEach(([group, kinds]) => {
        const d = el('details');
        d.open = kinds.some((k) => had[k]);
        d.appendChild(el('summary', 'bf-opt', esc(group)));
        const grid = el('div');
        grid.style.cssText = 'display:grid;grid-template-columns:7em minmax(0,1fr);gap:var(--s2) var(--s3);align-items:center;padding-top:var(--s2)';
        kinds.forEach((k) => {
          const i = input('text', 'h:' + k, { max: RULES.limits.handleMax, placeholder: HANDLE_HINTS[k] || '', value: had[k] || '' });
          i.id = fieldId();
          i.autocapitalize = 'none'; i.autocomplete = 'off'; i.spellcheck = false;
          i.setAttribute('autocorrect', 'off');
          const l = el('label', 'bf-opt', esc(HANDLE_LABELS[k]));
          l.htmlFor = i.id;
          grid.append(l, i);
        });
        d.appendChild(grid);
        hw.appendChild(d);
      });
      const sw = el('label', 'consent', '<input type="checkbox" role="switch" name="handles_public"> ' + esc('Show my handles in the directory'));
      sw.querySelector('input').checked = !!cur.handles_public;
      hw.appendChild(sw);
      f.appendChild(hw);
      const msg = el('p', 'bf-msg');
      const go = button('Save', '');
      go.type = 'submit';
      const row = el('div', 'bf-go');
      row.append(go, msg);
      f.appendChild(row);
      body.appendChild(f);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(f);
        go.disabled = true;
        const interests = RULES.interests.filter((k) => into.has(k));
        /* a leading @ is how people write a handle; the server wants it without */
        const handles = {};
        Object.keys(RULES.handles).forEach((k) => { const v = String(fd.get('h:' + k) || '').trim().replace(/^@/, ''); if (v) handles[k] = v; });
        f.querySelectorAll('[name^="h:"]').forEach((i) => i.removeAttribute('aria-invalid'));
        const h = checkHandles(RULES, handles);
        if (!h.ok) {
          go.disabled = false;
          const bad = h.key && f.querySelector('[name="h:' + h.key + '"]');
          if (bad) { bad.setAttribute('aria-invalid', 'true'); bad.closest('details').open = true; bad.focus(); }
          msg.textContent = (h.key && HANDLE_LABELS[h.key] ? HANDLE_LABELS[h.key] + ': ' : '') + message('bad_handle');
          msg.classList.add('err');
          return;
        }
        setProfile({ display_name: fd.get('display_name'), neighborhood: fd.get('neighborhood'), archetype: arch, interests,
          handles: h.handles, handles_public: !!fd.get('handles_public') }).then((r) => {
          go.disabled = false;
          if (!r.ok) { msg.textContent = r.message; msg.classList.add('err'); return; }
          close();
          const later = [r.interestsSaved === false && 'what you’re into', r.handlesSaved === false && 'your handles'].filter(Boolean).join(' and ');
          app.toast(later ? 'Saved. ' + later[0].toUpperCase() + later.slice(1) + ' save once the boards’ next update is in.' : 'Saved');
        });
      });
    });
  });
}

const STATUS_WORDS = { approved: 'Live', pending: 'Waiting for a look', hidden: 'Taken down by the moderator' };
export function mineSheet() {
  app.sheet('Your posts', (body) => {
    const paint = () => {
      body.innerHTML = '<p class="loading">One moment…</p>';
      mine().then((r) => {
        body.innerHTML = '';
        if (!r.ok) { body.appendChild(el('p', 'sheet-note', esc(r.message))); return; }
        if (!r.posts.length) { body.appendChild(el('p', 'sheet-note', 'Nothing yet.')); return; }
        r.posts.forEach((p) => {
          const left = leftLabel(p.expires_at ? Date.parse(p.expires_at) : null, Date.now());
          const bits = [BOARD_LABELS[p.board] || p.board, p.ended ? 'Ended' : (STATUS_WORDS[p.status] || p.status)];
          if (!p.ended && left && p.status === 'approved') bits.push(left);
          if (p.photo_state === 'pending') bits.push('photo waiting for a check');
          if (p.photo_state === 'rejected') bits.push('photo not used');
          const row = el('div', 'sheet-row mine', '<div class="t">' + esc(p.title) + '<div class="d">' + esc(bits.join(' · ')) + '</div></div>');
          row.dataset.id = p.id;
          row.appendChild(button('Delete', 'ghost sm', () => app.confirmBox({
            title: 'Delete this post?', body: 'It goes for good, with its votes. This can’t be undone.', yes: 'Delete',
            onYes() { remove(p.id).then((x) => { app.toast(x.ok ? 'Deleted' : x.message); if (x.ok) paint(); }); },
          })));
          body.appendChild(row);
        });
      });
    };
    paint();
  });
}

/* The signed-in half of Settings → Your account. */
app.registerAccount((host, repaint) => {
  host.innerHTML = '';
  const who = el('div', 'sheet-row', '<div class="t">Signed in<div class="d">One moment…</div></div>');
  who.appendChild(button('Sign out', 'ghost sm', () => { app.signOut(); repaint(); app.toast('Signed out'); }));
  host.appendChild(who);
  if (app.demo) host.appendChild(el('p', 'sheet-note', 'Demo account. Nothing is saved.'));
  profile().then((p) => {
    const d = who.querySelector('.d');
    if (!p.ok) { d.textContent = p.error === 'off' ? 'Posting is coming soon.' : p.message; return; }
    d.textContent = p.profile ? 'as ' + p.profile.display_name : 'Add your first name before you post';
  });
  const prof = el('div', 'sheet-row', '<div class="t">Your profile<div class="d">Name, neighborhood, tile, interests, handles</div></div>');
  prof.appendChild(button('Edit', 'ghost sm', profileSheet));
  const posts = el('div', 'sheet-row', '<div class="t">Your posts</div>');
  posts.appendChild(button('Open', 'ghost sm', mineSheet));
  host.append(prof, posts);
  const del = el('div', 'linkrow');
  del.appendChild(button('Delete my account and posts', 'danger sm', () => app.confirmBox({
    title: 'Delete your account and posts?',
    body: 'Your profile, every post and its photo, your votes, your reports, your missions, your People directory listing, your Watch dots and your habits go for good, and you are signed out. Your email sign-in is shared with other Btown Brief apps, so it stays; email Stephen to remove that too.',
    yes: 'Delete everything',
    onYes() {
      deleteMe().then((r) => {
        if (!r.ok) { app.toast(r.message); return; }
        app.signOut();
        repaint();
        app.toast('Deleted. You’re signed out.');
      });
    },
  })));
  host.appendChild(del);
});

/* the demo reader, for tests and the demo's own sign-in button */
export const demoReader = DEMO_ME;
export const _fake = () => (app.demo ? demoBackend() : null);
