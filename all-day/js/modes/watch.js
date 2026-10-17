/* Watch: films for a couple and for the town. Top to bottom:

   - Coming soon: a rail of 2:3 posters, what is in US theaters now and what
     opens next, labelled theaters or streaming. A tap plays the trailer in
     the shell's one video box (never on its own); a film with no trailer on
     TMDB opens its sheet instead.
   - The list: TMDB's 300 best-rated films (scripts/build_films.py, weekly,
     on the films-data branch), or, until that has run, the baked starter
     list of 60 (data/films-seed.json), which says so. A poster grid with two
     seen-dots on every film, you and your person ("With Sam" / "Just me"),
     the town rating, filters by how recent and by genre, and a sort by town
     rating. The dots and the "want to watch" list live on this device; a
     signed-in reader's dots also follow them (supabase/nn-watch.sql). The
     partner is a first name typed once, never a second account.
   - The film sheet: the overview, year, runtime, genres, the trailer, the
     two seen toggles, want to watch, and a 1 to 5 star rating that posts a
     rating to the watch board (boards.js: meta year, stars, where).
     Signed-out readers can see everything and set their dots; rating asks
     for the one-email sign-in.
   - Town ratings this week: the films with the most ratings in the last
     seven days, with their average. A film with fewer than three ratings is
     never shown, here or on a poster.
   - Vote for the next screening: the watch board's picks, one per film,
     voted with the board's own vote, a bar each toward five. At five
     Stephen puts it on Meetup as a screening with a mixer after. A pick
     Stephen posts with a `where` is the last (or next) screening's card.
   - Watch chat: a door to the community channel and to Telegram. The talk
     lives there; nothing is built here.

   Ratings and picks identify a film by its title and year (the board's meta
   has no field for a TMDB id yet); a title alone is used when the year has
   drifted and the title is unique.

   ?demo=1 runs exactly this file on data/demo/watch.json: invented films,
   re-dated to the reader's clock, with their ratings and picks seeded into
   the boards' in-memory demo backend, so the counting below is the real
   code. Nothing in the demo is saved or sent. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as boards from '../boards.js';
import { fetchJSON } from '../wire.js';
import { RULES, expiresAt } from '../boards-core.js';
import { el, esc, safeHref, ICON, art, section, rail, chips, pills, button } from '../ui.js';

const KEY = 'watch';
const FILMS_URL = 'https://raw.githubusercontent.com/btownbrief/btown-brief/films-data/data/films.json';
const SEED_URL = 'data/films-seed.json';
/* the community's "Plans & Meetups" channel, until Stephen opens a Watch Club channel */
const CHAT_URL = 'https://www.btownbrief.com/community/channels/meetups-hangouts';
const CHAT_NAME = 'Plans & Meetups';
const TELEGRAM_URL = '../telegram.html';
const TMDB_URL = 'https://www.themoviedb.org/';
const TMDB_LOGO = '../assets/img/tmdb.svg';
const LOCAL_KEY = 'allday-watch';
const PAGE = 60;            // posters drawn at a time
const MIN_RATINGS = 3;      // a film shows a town rating only from three
const TOWN_ROWS = 8;
const GOAL = 5;             // votes before Stephen books it
const RATING_PAGES = 10;    // 600 ratings read back for the averages
const DAY = 86400000;
const WEEK = 7 * DAY;
const SECTIONS = ['soon', 'list', 'town', 'vote', 'chat'];
const YT = /^[A-Za-z0-9_-]{11}$/;
const POSTER = /^\/[A-Za-z0-9_-]+\.(jpg|png)$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const RECENCY = [
  ['any', 'Any time'], ['1m', 'Last month', 0, 31], ['6m', '6 months', 0, 183], ['1y', '1 year', 0, 366], ['2y', '2 years', 0, 731],
  ['5y', '5 years', 0, 1827], ['10y', '10 years', 0, 3653], ['15y', '15 years', 0, 5479], ['20y', '20 years', 0, 7305], ['20p', '20+ years', 7306, Infinity],
];

const arr = (v) => (Array.isArray(v) ? v : []);
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/* ---------------------------------------------------------------- clock */
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const todayKey = () => dayFmt.format(new Date());
const dayNum = (key) => Math.round(Date.parse(key + 'T12:00:00Z') / DAY);
const shortDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const dateLabel = (key) => shortDate.format(new Date(key + 'T12:00:00Z'));
const runtime = (m) => (m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60 ? (m % 60) + 'm' : '') : m + 'm').trim();

/* --------------------------------------------------------------- state */
let root = null, pending = null, ready = false;
let D = null;               // the demo file
let F = null;               // the film payload: { seed, demo, images, notice, top, soon, now }
const byId = new Map();     // id -> film
const byKey = new Map();    // "title|year" -> film
const byTitle = new Map();  // "title" -> film, or null when two films share it
const slots = Object.create(null);
const V = { recency: 'any', genre: 'all', sort: 'list', show: 'all', shown: PAGE };
const P = { state: 'loading', ratings: [], picks: [], agg: new Map() };
let L = null;               // this device's dots, partner, want list, own ratings

/* ------------------------------------------------------------ the films */
function film(raw, extra) {
  if (!raw || typeof raw !== 'object' || !Number.isInteger(raw.id) || raw.id < 1 || !raw.t) return null;
  const d = ISO_DAY.test(String(raw.d || '')) ? raw.d : '';
  const y = Number.isInteger(raw.y) ? raw.y : d ? Number(d.slice(0, 4)) : null;
  return {
    id: raw.id, k: 'f' + raw.id, t: String(raw.t), y, d: d || (y ? y + '-07-01' : ''),
    g: arr(raw.g).filter((x) => typeof x === 'string').slice(0, 4), o: String(raw.o || ''),
    rt: Number.isInteger(raw.rt) && raw.rt > 0 ? raw.rt : null,
    p: POSTER.test(String(raw.p || '')) ? raw.p : '', yt: YT.test(String(raw.yt || '')) ? raw.yt : '',
    art: app.demo ? String(raw.art || 'paper') : '', where: String(raw.where || ''), dur: String(raw.dur || ''), ...extra,
  };
}
const norm = (t) => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 80);
const fkey = (t, y) => norm(t) + '|' + (y || '');

function setFilms(j) {
  F = { seed: !!j.seed, demo: !!j.demo, images: /^https:\/\/image\.tmdb\.org\//.test(String(j.images || '')) ? j.images : 'https://image.tmdb.org/t/p/',
    notice: String(j.notice || 'This product uses the TMDB API but is not endorsed or certified by TMDB.'), top: [], soon: [], now: [] };
  const seen = new Set();
  F.top = arr(j.top).map((x) => film(x)).filter((f) => f && !seen.has(f.id) && seen.add(f.id));
  F.now = arr(j.now).map((x) => film(x, { shelf: 'now' })).filter(Boolean);
  F.soon = arr(j.soon).map((x) => film(x, { shelf: 'soon' })).filter(Boolean);
  byId.clear(); byKey.clear(); byTitle.clear();
  [...F.top, ...F.now, ...F.soon].forEach((f) => {
    if (!byId.has(f.id)) byId.set(f.id, f);
    byKey.set(fkey(f.t, f.y), byId.get(f.id));
    const n = norm(f.t);
    byTitle.set(n, byTitle.has(n) && byTitle.get(n) && byTitle.get(n).id !== f.id ? null : byId.get(f.id));
  });
}
/* a board post's film: title and year, else the title alone when it is unique */
const filmOf = (title, year) => byKey.get(fkey(title, year)) || byTitle.get(norm(title)) || null;

const posterUrl = (f, size) => (app.demo ? f.art : f.p ? F.images + size + f.p : '');
const picture = (f, size) => { const u = posterUrl(f, size); return u ? art(u) : ''; };
const tmdbHref = (f) => TMDB_URL + 'movie/' + f.id;
const trailer = (f) => ({ k: 'tr:' + f.id, kind: 'video', yt: f.yt, title: f.t + ' · trailer', src: 'Trailer', media: posterUrl(f, 'w342') || 'paper',
  dur: f.dur || '', href: f.yt ? 'https://www.youtube.com/watch?v=' + f.yt : '#watch/' + f.k });
const hasTrailer = (f) => app.demo || !!f.yt;
function playTrailer(f) {
  if (!hasTrailer(f)) { app.toast('No trailer for this one on TMDB yet.'); return; }
  app.play(trailer(f));
}

/* The demo file is written on _anchor; every date moves by the days since,
   so "last month" always has films in it. */
function redate(d) {
  const shift = /^\d{4}-\d{2}-\d{2}$/.test(String(d._anchor || '')) ? dayNum(todayKey()) - dayNum(d._anchor) : 0;
  const move = (f) => {
    if (!f || !ISO_DAY.test(String(f.d || ''))) return f;
    const nd = new Date((dayNum(f.d) + shift) * DAY + 12 * 3600000).toISOString().slice(0, 10);
    return { ...f, d: nd, y: Number(nd.slice(0, 4)) };
  };
  const films = d.films || {};
  return { ...films, top: arr(films.top).map(move), soon: arr(films.soon).map(move), now: arr(films.now).map(move) };
}

function loadFilms() {
  const ok = (j) => j && typeof j === 'object' && Array.isArray(j.top) && j.top.length > 0;
  if (app.demo) return app.demoData(KEY).then((d) => { D = d; return redate(d); });
  const seed = () => fetchJSON(SEED_URL, 8000).then((j) => { if (!ok(j)) throw new Error('bad seed'); return j; });
  return fetchJSON(FILMS_URL, 8000).then((j) => { if (!ok(j)) throw new Error('bad films'); return j; }).catch(seed);
}

/* ------------------------------------------------------- this device */
/* { mode: 'us' | 'me', partner: 'Sam', seen: { id: [me, them] }, want: { id: ts },
   rated: { id: { post, stars } } }, plus the sync's own two: dirty (films
   changed here and not yet saved to the account) and syncedFor (the account
   this phone last joined its dots with). The demo keeps its copy for the visit. */
let memory = null;
function loadLocal() {
  const raw = app.demo ? (memory = memory || { mode: 'us', partner: String(D.partner || ''), seen: dotsOf(D.dots), want: {}, rated: {} }) : store.read(LOCAL_KEY, {});
  const o = raw && typeof raw === 'object' ? raw : {};
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const seen = {};
  Object.entries(obj(o.seen)).forEach(([id, v]) => { if (/^\d+$/.test(id) && Array.isArray(v) && (v[0] || v[1])) seen[id] = [v[0] ? 1 : 0, v[1] ? 1 : 0]; });
  const partner = cleanName(o.partner);
  return { mode: o.mode === 'us' && partner ? 'us' : 'me', partner, seen, want: obj(o.want), rated: obj(o.rated),
    nameDirty: !!o.nameDirty, dirty: obj(o.dirty), syncedFor: typeof o.syncedFor === 'string' ? o.syncedFor : '' };
}
function dotsOf(d) {
  const out = {};
  Object.entries(d && typeof d === 'object' ? d : {}).forEach(([id, v]) => { if (Array.isArray(v)) out[id] = [v[0] ? 1 : 0, v[1] ? 1 : 0]; });
  return out;
}
function saveLocal() {
  if (app.demo) { memory = L; return; }
  store.write(LOCAL_KEY, { mode: L.mode, partner: L.partner, seen: L.seen, want: L.want, rated: L.rated,
    nameDirty: L.nameDirty, dirty: L.dirty, syncedFor: L.syncedFor });
}
const cleanName = (s) => String(s || '').replace(/[@<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
const us = () => L.mode === 'us' && !!L.partner;
const seenOf = (f) => L.seen[f.id] || [0, 0];
const partnerName = () => L.partner || 'partner';

function setSeen(f, who, on) {
  const s = seenOf(f).slice();
  s[who] = on ? 1 : 0;
  if (s[0] || s[1]) L.seen[f.id] = s; else delete L.seen[f.id];
  L.dirty[f.id] = 1;
  saveLocal();
  pushSeen(f.id);
}

/* ------------------------------------------- the account's copy of the dots */
/* A signed-in reader's dots also live in nn_watch_seen (supabase/nn-watch.sql).
   The first time a phone meets an account the two copies are joined: a dot
   set on either side stays set, so nothing marked before signing in is lost.
   After that the account is the record: a film changed on this phone and not
   yet saved (`dirty`) keeps this phone's dots and is sent; every other film
   takes the account's, so a dot cleared on the other phone stays cleared
   here. Before nn-watch.sql is pasted the calls answer 404 and the dots
   simply stay on the phone. */
function rpcAs(fn, args) {
  if (app.demo || !app.user()) return Promise.resolve(null);
  return Promise.resolve(app.token()).then((tok) => {
    if (!tok) return null;
    const ctl = 'AbortController' in window ? new AbortController() : null;
    const t = ctl && setTimeout(() => ctl.abort(), 8000);
    return fetch(store.SB_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: store.SB_KEY, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
      ...(ctl ? { signal: ctl.signal } : {}),
    }).then((r) => (r.ok ? r.json().catch(() => null) : null)).finally(() => { if (t) clearTimeout(t); });
  }).catch(() => null);
}
const queue = Object.create(null);
function pushSeen(id) {
  if (app.demo || !app.user()) return;
  queue[id] = (queue[id] || Promise.resolve()).then(() => {
    const s = L.seen[id] || [0, 0];
    const args = { p_film: Number(id), p_me: !!s[0], p_partner: !!s[1], p_partner_name: L.nameDirty ? L.partner : null };
    return rpcAs('nn_watch_seen_set', args).then((r) => {
      if (!r) return;   // not saved: it stays dirty and goes again on the next join
      const now = L.seen[id] || [0, 0];
      if (now[0] === s[0] && now[1] === s[1]) delete L.dirty[id];
      if (L.nameDirty && args.p_partner_name === L.partner) L.nameDirty = false;
      saveLocal();
    });
  });
}
function pullSeen() {
  const u = app.user();
  if (app.demo || !u || !L) return;
  rpcAs('nn_watch_seen_get').then((j) => {
    if (!j || typeof j !== 'object' || !Array.isArray(j.seen) || !app.user() || app.user().id !== u.id) return;
    const server = Object.create(null);
    j.seen.forEach((r) => { if (Array.isArray(r) && Number.isInteger(r[0]) && r[0] > 0 && (r[1] || r[2])) server[r[0]] = [r[1] ? 1 : 0, r[2] ? 1 : 0]; });
    const first = L.syncedFor !== String(u.id);
    const before = JSON.stringify(L.seen) + L.partner;
    new Set([...Object.keys(server), ...Object.keys(L.seen)]).forEach((id) => {
      const mine = L.seen[id] || [0, 0], theirs = server[id] || [0, 0];
      /* a change made here since this pull began, or not yet saved, wins */
      const next = L.dirty[id] ? mine : first ? [mine[0] || theirs[0], mine[1] || theirs[1]] : theirs;
      if (next[0] || next[1]) L.seen[id] = next; else delete L.seen[id];
      if (next[0] !== theirs[0] || next[1] !== theirs[1]) L.dirty[id] = 1;
    });
    const name = typeof j.partner === 'string' ? cleanName(j.partner) : '';
    if (name && !L.nameDirty && (!first || !L.partner)) L.partner = name;
    else if (L.partner && name !== L.partner) L.nameDirty = true;
    L.syncedFor = String(u.id);
    saveLocal();
    const send = Object.keys(L.dirty);
    if (!send.length && L.nameDirty && Object.keys(L.seen).length) send.push(Object.keys(L.seen)[0]);
    send.forEach(pushSeen);
    if (ready && JSON.stringify(L.seen) + L.partner !== before) draw('list');
  });
}
app.onAuth(() => { if (ready) pullSeen(); });

/* "Delete my account and posts" (boards.js) does not reach nn_watch_seen
   yet; until the foundation's nn_delete_me clears it too, ask the account
   to forget this reader's dots the moment that delete succeeds, while the
   reader is still signed in. Best effort; the PR asks for the real fix. */
window.addEventListener('allday-boards', (e) => {
  if (app.demo || !e.detail || e.detail.what !== 'deleteme') return;
  rpcAs('nn_watch_forget');
  if (L) { L.syncedFor = ''; L.dirty = {}; saveLocal(); }
});

/* -------------------------------------------------------- board posts */
/* Ratings, read back newest first up to RATING_PAGES pages, and the picks. */
function listAll(kind, pages) {
  const out = [];
  const step = (before, n) => boards.list('watch', { kind, limit: RULES.limits.listMax, before }).then((r) => {
    if (!r.ok) { if (!out.length) throw r; return out; }
    out.push(...r.posts);
    if (r.posts.length < RULES.limits.listMax || n + 1 >= pages) return out;
    return step(r.posts[r.posts.length - 1].created_at, n + 1);
  });
  return step(null, 0);
}

function loadPosts() {
  if (app.demo) seedDemo();
  P.state = 'loading';
  return Promise.all([listAll('rating', RATING_PAGES), listAll('pick', 1)]).then(([ratings, picks]) => {
    P.ratings = ratings;
    P.picks = picks;
    P.state = 'ok';
  }, (r) => { P.state = r && r.error === 'off' ? 'off' : 'fail'; }).then(() => {
    tally();
    if (ready) { if (V.sort === 'town') draw('list'); else rateTiles(); draw('town'); draw('vote'); app.recount(); }
  });
}

/* every rating, by film: all-time count and sum, and this week's */
function tally() {
  const agg = new Map();
  const weekAgo = Date.now() - WEEK;
  P.ratings.forEach((p) => {
    const stars = p.meta && p.meta.stars;
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return;
    const f = filmOf(p.title, p.meta.year);
    const key = f ? 'f' + f.id : 'x' + fkey(p.title, p.meta.year);
    const a = agg.get(key) || { f, title: p.title, year: Number.isInteger(p.meta.year) ? p.meta.year : null, n: 0, sum: 0, wn: 0, wsum: 0 };
    a.n++; a.sum += stars;
    if ((Date.parse(p.created_at) || 0) > weekAgo) { a.wn++; a.wsum += stars; }
    agg.set(key, a);
  });
  P.agg = agg;
}
const town = (f) => { const a = P.agg.get('f' + f.id); return a && a.n >= MIN_RATINGS ? a : null; };
const avg = (sum, n) => (n ? sum / n : 0);

/* The demo's ratings and picks go into the boards' in-memory backend, the
   way seedDemo() in boards-fake.js puts every board's demo posts there, so
   the counting above runs on them exactly as it does live. */
function seedDemo() {
  const fake = boards._fake();
  if (!fake || fake.watchSeeded) return;
  fake.watchSeeded = true;
  const t = fake.now();
  const H = 3600000;
  const people = ['Maya R.', 'Dev K.', 'Kara M.', 'Tom A.', 'Jess T.', 'Ruth O.', 'Ben S.', 'Priya N.', 'Luis G.', 'Ann W.'].map((name, i) => {
    const id = 'demo-0000-4000-8000-0000watch' + String(i).padStart(3, '0');
    fake.profiles.set(id, { display_name: name, neighborhood: null, archetype: null });
    return id;
  });
  let n = 0;
  const add = (kind, f, o) => {
    const created = t - o.h * H;
    const row = { id: 'dddddddd-0000-4000-8000-' + String(++n).padStart(12, '0'), board: 'watch', user_id: people[o.by % people.length], kind,
      title: f.t, body: o.body || '', photo_path: null, photo_req: false, meta: o.meta, place: '',
      expires_at: expiresAt(fake.rules, 'watch', kind, created), status: 'approved', reports: 0, created_at: created, decided_at: null };
    fake.posts.push(row);
    for (let i = 0; i < (o.votes || 0); i++) fake.votes.add(row.id + '|p_watch' + String(n * 10 + i).padStart(4, '0'));
  };
  arr(D.ratings).forEach((r, i) => {
    const f = byId.get(r[0]);
    if (f) add('rating', f, { h: r[2], by: i, meta: { year: f.y, stars: r[1] } });
  });
  arr(D.picks).forEach((p) => {
    const f = byId.get(p.f);
    if (f) add('pick', f, { h: p.h, by: p.by, votes: p.votes, body: p.body, meta: { year: f.y } });
  });
}

/* ------------------------------------------------------------- drawing */
const sec = (host, title, sub, key, right) => { const s = section(host, title, sub, right); s.dataset.sec = key; return s; };

function draw(name) {
  const host = slots[name];
  if (!host) return;
  host.innerHTML = '';
  ({ soon: drawSoon, list: drawList, town: drawTown, vote: drawVote, chat: drawChat })[name](host);
}

function render() {
  root.innerHTML = '';
  SECTIONS.forEach((s) => { slots[s] = el('div'); slots[s].dataset.slot = s; root.appendChild(slots[s]); draw(s); });
  root.appendChild(credit());
  root.appendChild(el('div', 'spacer'));
}

/* TMDB's attribution, with its logo, wherever its data shows */
function credit(inSheet) {
  const c = el('div', inSheet ? 'sheet-note' : 'note pad');
  c.dataset.credit = '1';
  if (app.demo) { c.textContent = 'Demo: every film, rating, vote and person here is invented.'; return c; }
  c.innerHTML = '<a href="' + esc(TMDB_URL) + '" target="_blank" rel="noopener"><img src="' + esc(TMDB_LOGO) + '" alt="TMDB" width="92" height="12" loading="lazy" decoding="async"></a>' +
    '<br>Film details, posters and trailers come from TMDB (The Movie Database). ' + esc(F.notice);
  return c;
}

/* ------------------------------------------------------- coming soon */
function drawSoon(host) {
  const now = F.now, soon = F.soon;
  if (!now.length && !soon.length) return;
  sec(host, 'Coming soon', esc('In theaters now, and what opens next in theaters and on streaming. Tap a poster for its trailer.'), 'soon');
  const r = rail(host);
  const label = (f) => (f.shelf === 'now' ? 'In theaters now' : (f.d ? dateLabel(f.d) + ' · ' : '') + (f.where === 'streaming' ? 'streaming' : 'theaters'));
  [...now, ...soon].forEach((f) => {
    const a = el('a', 'poster');
    a.href = '#watch/soon:' + f.id;
    a.dataset.k = 'soon:' + f.id;
    a.setAttribute('aria-label', (hasTrailer(f) ? 'Play the trailer for ' : '') + f.t + ', ' + label(f));
    a.innerHTML = '<span class="c-media">' + picture(f, 'w342') +
      (hasTrailer(f) ? '<span class="play">' + ICON.play + '</span>' + (f.dur ? '<span class="dur">' + esc(f.dur) + '</span>' : '') : '') + '</span>' +
      '<span class="t">' + esc(f.t) + '</span><span class="s">' + esc(label(f)) + '</span>';
    a.addEventListener('click', (e) => { e.preventDefault(); if (hasTrailer(f)) playTrailer(f); else filmSheet(f); });
    r.appendChild(a);
  });
}

/* ----------------------------------------------------------- the list */
function inWindow(f, key) {
  if (key === 'any') return true;
  const w = RECENCY.find((x) => x[0] === key);
  if (!w || !f.d) return false;
  const ago = dayNum(todayKey()) - dayNum(f.d);
  return ago >= w[2] && ago <= w[3];
}
function shown(f) {
  if (V.show === 'want' && !L.want[f.id]) return false;
  if (V.show === 'unseen') { const s = seenOf(f); if (s[0] || (us() && s[1])) return false; }
  return true;
}
function filtered(o = {}) {
  const recency = o.recency || V.recency, genre = o.genre || V.genre;
  let list = F.top.filter((f) => shown(f) && inWindow(f, recency) && (genre === 'all' || f.g.includes(genre)));
  if (V.sort === 'town') {
    const rank = new Map(F.top.map((f, i) => [f.id, i]));
    list = list.slice().sort((a, b) => {
      const ta = town(a), tb = town(b);
      if (ta && tb) return avg(tb.sum, tb.n) - avg(ta.sum, ta.n) || tb.n - ta.n || rank.get(a.id) - rank.get(b.id);
      if (ta || tb) return ta ? -1 : 1;
      return rank.get(a.id) - rank.get(b.id);
    });
  }
  return list;
}

function tile(f) {
  const a = el('a', 'poster');
  a.style.width = 'auto';
  a.href = '#watch/' + f.k;
  a.dataset.k = f.k;
  const s = seenOf(f), t = town(f);
  const who = us() ? [s[0] ? 'you have seen it' : 'you have not seen it', s[1] ? L.partner + ' has' : L.partner + ' has not']
    : [s[0] ? 'seen' : 'not seen'];
  a.setAttribute('aria-label', f.t + (f.y ? ', ' + f.y : '') + ', ' + who.join(', ') + (t ? ', town rating ' + avg(t.sum, t.n).toFixed(1) : ''));
  a.innerHTML = '<span class="c-media">' + picture(f, 'w342') +
    '<span class="seen" aria-hidden="true"><i class="' + (s[0] ? 'on' : '') + '" data-dot="me"></i>' + (us() ? '<i class="' + (s[1] ? 'on' : '') + '" data-dot="them"></i>' : '') + '</span>' +
    (t ? '<span class="rate" data-rate="' + esc(avg(t.sum, t.n).toFixed(2)) + '">' + esc(avg(t.sum, t.n).toFixed(1)) + '</span>' : '') + '</span>' +
    '<span class="t">' + esc(f.t) + '</span><span class="s">' + esc([f.y, f.g[0]].filter(Boolean).join(' · ')) + '</span>';
  a.addEventListener('click', (e) => { e.preventDefault(); filmSheet(f); });
  return a;
}

/* the town ratings arrived or changed: paint them onto the posters already
   drawn, so a poster a deep link just flashed is not redrawn under it */
function rateTiles() {
  slots.list.querySelectorAll('[data-grid] .poster').forEach((a) => {
    const f = byId.get(Number(a.dataset.k.slice(1)));
    if (!f) return;
    const fresh = tile(f);
    a.setAttribute('aria-label', fresh.getAttribute('aria-label'));
    const media = a.querySelector('.c-media');
    const old = media.querySelector('.rate');
    const now = fresh.querySelector('.rate');
    if (old) old.remove();
    if (now) media.appendChild(now);
  });
}

function drawList(host) {
  const n = F.top.length;
  const neither = F.top.filter((f) => { const s = seenOf(f); return !s[0] && !s[1]; }).length;
  const left = F.top.filter((f) => !seenOf(f)[0]).length;
  const what = F.seed ? 'A starter list: ' + n + ' well-known films to begin with.'
    : F.demo ? 'The ' + n + ' best-rated films (demo).' : 'The ' + n + ' best-rated films on TMDB.';
  const sub = esc(what) + ' ' + (us()
    ? esc('Two dots on every poster: you, then ' + L.partner + '.') + ' <b>' + esc(neither) + '</b> ' + esc('neither of you has seen.')
    : esc('A dot on every poster you have seen.') + ' <b>' + esc(left) + '</b> ' + esc('to go.'));
  const who = pills([['us', 'With ' + partnerName()], ['me', 'Just me']], us() ? 'us' : 'me', (v) => {
    if (v === 'us' && (!L.partner || us())) { draw('list'); nameSheet(); return; }
    L.mode = v;
    saveLocal();
    draw('list');
  });
  who.dataset.who = '1';
  const head = sec(host, 'The list', sub, 'list', who);
  if (F.seed) head.dataset.seed = '1';

  const tools = el('div', 'toolrow');
  const wantN = F.top.filter((f) => L.want[f.id]).length;
  const show = pills([['all', 'All'], ['want', 'Want to watch' + (wantN ? ' ' + wantN : '')], ['unseen', us() ? 'Neither of us' : 'Not seen']], V.show,
    (v) => { V.show = v; V.shown = PAGE; draw('list'); });
  show.dataset.show = '1';
  const sort = pills([['list', 'List order'], ['town', 'Town rating']], V.sort, (v) => { V.sort = v; V.shown = PAGE; draw('list'); });
  sort.dataset.sort = '1';
  tools.append(show, sort);
  host.appendChild(tools);

  /* a chip that would show nothing is left off, unless it is the one chosen */
  const rec = chips(RECENCY.map(([key, label]) => ({ key, label, n: key === 'any' ? null : filtered({ recency: key }).length }))
    .filter((c) => c.key === 'any' || c.n || c.key === V.recency), V.recency,
    (k) => { V.recency = k; V.shown = PAGE; draw('list'); });
  rec.dataset.filter = 'recency';
  host.appendChild(rec);
  const counts = new Map();
  F.top.forEach((f) => f.g.forEach((g) => counts.set(g, (counts.get(g) || 0) + 1)));
  const genres = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
  const gen = chips([{ key: 'all', label: 'All genres' }, ...genres.map((g) => ({ key: g, label: g, n: filtered({ genre: g }).length }))
    .filter((c) => c.n || c.key === V.genre)], V.genre,
    (k) => { V.genre = k; V.shown = PAGE; draw('list'); });
  gen.dataset.filter = 'genre';
  host.appendChild(gen);

  const list = filtered();
  const filters = V.recency !== 'any' || V.genre !== 'all' || V.show !== 'all';
  const count = el('p', 'note pad');
  count.dataset.count = String(list.length);
  count.textContent = list.length === n && !filters ? (V.sort === 'town' ? 'Town-rated films first, highest first.' : '')
    : plural(list.length, 'film', 'films') + ' of ' + n + (V.sort === 'town' ? ', town-rated first' : '') + '.';
  if (count.textContent) host.appendChild(count);
  if (!list.length) {
    const e = el('div', 'empty', esc(V.show === 'want' ? 'Nothing on your want-to-watch list here yet. Open a film and tap Want to watch.' : 'No film on the list matches those filters.'));
    host.appendChild(e);
    if (filters) {
      const r = el('div', 'linkrow');
      r.style.justifyContent = 'center';
      r.appendChild(button('Clear the filters', 'ghost sm', () => { V.recency = 'any'; V.genre = 'all'; V.show = 'all'; draw('list'); }));
      host.appendChild(r);
    }
    return;
  }
  const grid = el('div', 'grid3');
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(104px, 1fr))';
  grid.style.gap = 'var(--s4) var(--s3)';
  grid.dataset.grid = '1';
  list.slice(0, V.shown).forEach((f) => grid.appendChild(tile(f)));
  host.appendChild(grid);
  if (list.length > V.shown) {
    const r = el('div', 'addrow');
    r.appendChild(button('Show ' + Math.min(PAGE, list.length - V.shown) + ' more', 'ghost', () => {
      const from = V.shown;
      V.shown += PAGE;
      list.slice(from, V.shown).forEach((f) => grid.appendChild(tile(f)));
      if (list.length <= V.shown) r.remove();
      else r.firstChild.textContent = 'Show ' + Math.min(PAGE, list.length - V.shown) + ' more';
    }));
    host.appendChild(r);
  }
}

/* -------------------------------------------------------- the sheets */
function filmSheet(f) {
  app.sheet(f.t, (body, card, close) => {
    const top = el('div');
    top.style.display = 'flex';
    top.style.gap = 'var(--s4)';
    top.style.alignItems = 'flex-start';
    const pic = el('span', 'poster');
    pic.style.width = '104px';
    pic.style.flex = '0 0 auto';
    pic.innerHTML = '<span class="c-media">' + picture(f, 'w342') + '</span>';
    const facts = el('div');
    const t = town(f);
    facts.innerHTML = '<p class="sheet-note">' + esc([f.y, f.rt ? runtime(f.rt) : '', f.g.join(', ')].filter(Boolean).join(' · ')) + '</p>' +
      (t ? '<p class="sheet-note" data-town>Town rating <b>' + esc(avg(t.sum, t.n).toFixed(1)) + '</b> from ' + esc(plural(t.n, 'rating', 'ratings')) + '</p>' : '') +
      (f.shelf === 'soon' && f.d ? '<p class="sheet-note">' + esc((f.where === 'streaming' ? 'Streaming from ' : 'In theaters from ') + dateLabel(f.d)) + '</p>' : '') +
      (f.shelf === 'now' ? '<p class="sheet-note">In theaters now</p>' : '');
    const tr = el('div', 'linkrow');
    if (hasTrailer(f)) {
      const b = button(ICON.play + ' Trailer', '', () => { close(); playTrailer(f); });
      b.dataset.trailer = '1';
      tr.appendChild(b);
    } else tr.appendChild(el('span', 'sheet-note', 'No trailer on TMDB yet.'));
    facts.appendChild(tr);
    top.append(pic, facts);
    body.appendChild(top);
    if (f.o) { const o = el('p', null, esc(f.o)); o.style.marginTop = 'var(--s3)'; body.appendChild(o); }

    /* the two dots and the want list */
    body.appendChild(el('div', 'sheet-h', 'Seen it?'));
    const row = el('div', 'linkrow');
    const toggle = (label, isOn, flip) => {
      const b = button('', '', null);
      const paint = () => { const on = isOn(); b.textContent = (on ? '✓ ' : '') + label; b.classList.toggle('ghost', !on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); };
      b.addEventListener('click', () => { flip(); paint(); draw('list'); });
      paint();
      return b;
    };
    const me = toggle('I’ve seen it', () => !!seenOf(f)[0], () => setSeen(f, 0, !seenOf(f)[0]));
    me.dataset.seen = 'me';
    row.appendChild(me);
    if (L.partner) {
      const them = toggle(L.partner + ' has', () => !!seenOf(f)[1], () => {
        setSeen(f, 1, !seenOf(f)[1]);
        if (!us()) { L.mode = 'us'; saveLocal(); }
      });
      them.dataset.seen = 'them';
      row.appendChild(them);
    } else {
      const add = button('Add who you watch with', 'ghost', () => nameSheet(f));
      add.dataset.addPartner = '1';
      row.appendChild(add);
    }
    const want = toggle('Want to watch', () => !!L.want[f.id], () => {
      if (L.want[f.id]) delete L.want[f.id]; else L.want[f.id] = Math.floor(Date.now() / 1000);
      saveLocal();
    });
    want.dataset.want = '1';
    row.appendChild(want);
    body.appendChild(row);

    /* a rating, to the watch board */
    body.appendChild(el('div', 'sheet-h', 'Your rating'));
    rateRow(body, f);

    if (!app.demo) {
      const more = el('div', 'linkrow');
      const a = el('a', 'btn ghost sm', 'On TMDB ' + ICON.ext);
      a.href = safeHref(tmdbHref(f));
      a.target = '_blank';
      a.rel = 'noopener';
      more.appendChild(a);
      body.appendChild(more);
    }
    body.appendChild(credit(true));
  });
}

let where = '';
function rateRow(body, f) {
  const box = el('div');
  box.dataset.rate = '1';
  body.appendChild(box);
  const mine = L.rated[f.id];
  const stars = el('div', 'linkrow');
  stars.setAttribute('role', 'group');
  stars.setAttribute('aria-label', 'Rate ' + f.t);
  for (let i = 1; i <= 5; i++) {
    const b = el('button', 'act star' + (mine && mine.stars >= i ? ' on' : ''), ICON.star);
    b.dataset.stars = String(i);
    b.setAttribute('aria-label', plural(i, 'star', 'stars'));
    b.setAttribute('aria-pressed', mine && mine.stars === i ? 'true' : 'false');
    b.addEventListener('click', () => rate(f, i, box, stars));
    stars.appendChild(b);
  }
  box.appendChild(stars);
  const at = pills([['', 'Anywhere'], ['At home', 'At home'], ['In a theater', 'In a theater']], where, (v) => { where = v; });
  at.dataset.where = '1';
  box.appendChild(at);
  const msg = el('p', 'sheet-note', esc(mine ? 'You gave it ' + plural(mine.stars, 'star', 'stars') + '. Tap again to change it.'
    : 'A star rating goes to the town’s ratings under your first name.'));
  msg.dataset.msg = '1';
  msg.setAttribute('role', 'status');
  box.appendChild(msg);
}

function rate(f, stars, box, row) {
  const msg = box.querySelector('[data-msg]');
  const say = (t) => { msg.textContent = t; };
  if (!app.user()) {
    say('Rating takes the email sign-in: one email, no password. Your dots and your list work without it.');
    if (!box.querySelector('[data-signin]')) {
      const r = el('div', 'linkrow');
      const b = button('Sign in', '', () => app.openSettings());
      b.dataset.signin = '1';
      r.appendChild(b);
      box.appendChild(r);
    }
    return;
  }
  [...row.children].forEach((b) => { b.disabled = true; });
  say('Posting your rating…');
  const meta = { stars };
  if (Number.isInteger(f.y) && f.y >= 1888 && f.y <= 2100) meta.year = f.y;
  if (where) meta.where = where;
  const before = L.rated[f.id];
  boards.create('watch', { kind: 'rating', title: f.t.slice(0, RULES.limits.titleMax), body: '', meta }).then((r) => {
    [...row.children].forEach((b) => { b.disabled = false; });
    if (!r.ok) {
      if (r.error === 'no_name') { askName(box, () => rate(f, stars, box, row)); say(r.message); return; }
      say(r.message);
      return;
    }
    L.rated[f.id] = { post: r.post.id, stars };
    saveLocal();
    [...row.children].forEach((b, i) => { b.classList.toggle('on', i < stars); b.setAttribute('aria-pressed', i + 1 === stars ? 'true' : 'false'); });
    say('Rated ' + plural(stars, 'star', 'stars') + '. Thanks.');
    app.toast('Rated ' + plural(stars, 'star', 'stars'));
    /* your new rating replaces your last one for this film */
    const old = before && before.post && before.post !== r.post.id ? boards.remove(before.post) : Promise.resolve();
    old.then(() => loadPosts());
  });
}

/* a reader with no first name yet names themselves once, in place */
function askName(box, then) {
  if (box.querySelector('form')) return;
  const f = el('form', 'bform');
  f.noValidate = true;
  const i = el('input', 'field bf-in');
  i.name = 'display_name';
  i.maxLength = RULES.limits.nameMax;
  i.placeholder = 'Your first name';
  i.setAttribute('aria-label', 'Your first name');
  const go = button('Save and post', '');
  go.type = 'submit';
  const row = el('div', 'bf-go');
  row.append(go);
  f.append(i, row);
  box.appendChild(f);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    go.disabled = true;
    boards.setProfile({ display_name: i.value }).then((r) => {
      go.disabled = false;
      if (!r.ok) { app.toast(r.message); return; }
      f.remove();
      then();
    });
  });
}

function nameSheet(back) {
  app.sheet('Who do you watch with?', (body, card, close) => {
    body.appendChild(el('p', 'sheet-note', esc('Their first name puts a second dot on every poster, so the two of you can see what you have both seen. It stays on this phone' +
      (app.user() ? ' and in your account.' : '.') + ' It is only a label; they need no account.')));
    const f = el('form', 'bform');
    f.noValidate = true;
    const i = el('input', 'field bf-in');
    i.name = 'partner';
    i.maxLength = 32;
    i.placeholder = 'Sam';
    i.value = L.partner;
    i.setAttribute('aria-label', 'Their first name');
    const go = button('Save', '');
    go.type = 'submit';
    const row = el('div', 'bf-go');
    row.appendChild(go);
    if (L.partner) {
      const just = button('Just me', 'ghost', (e) => { e.preventDefault(); L.mode = 'me'; saveLocal(); close(); draw('list'); });
      just.type = 'button';
      row.appendChild(just);
    }
    f.append(i, row);
    body.appendChild(f);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = cleanName(i.value);
      if (!name) { i.focus(); return; }
      if (name !== L.partner) L.nameDirty = true;
      L.partner = name;
      L.mode = 'us';
      saveLocal();
      if (L.nameDirty) { const first = Object.keys(L.seen)[0]; if (first) pushSeen(first); }
      close();
      draw('list');
      app.toast('Two dots now: you and ' + name);
      if (back) filmSheet(back);
    });
    setTimeout(() => i.focus(), 50);
  });
}

/* ------------------------------------------------- town ratings */
function drawTown(host) {
  sec(host, 'Town ratings this week', esc('What Burlington watched in the last seven days, and what it thought. A film shows once it has three ratings.'), 'town');
  if (P.state === 'loading') { host.appendChild(el('p', 'note pad', 'Counting this week’s ratings…')); return; }
  if (P.state === 'off') { host.appendChild(el('p', 'note pad', 'Town ratings open soon. Your dots and your list work now.')); return; }
  if (P.state === 'fail') { host.appendChild(el('p', 'note pad', 'Town ratings didn’t load. Pull down to try again.')); return; }
  const rows = [...P.agg.values()].filter((a) => a.wn >= MIN_RATINGS)
    .sort((a, b) => b.wn - a.wn || avg(b.wsum, b.wn) - avg(a.wsum, a.wn)).slice(0, TOWN_ROWS);
  if (!rows.length) {
    host.appendChild(el('p', 'note pad', 'No film has three ratings this week yet. Rate what you watch: open any poster and tap the stars.'));
    return;
  }
  rows.forEach((a) => {
    const f = a.f || { id: 0, k: '', t: a.title, y: a.year, g: [], o: '', rt: null, p: '', yt: '', art: 'paper' };
    const r = el('div', 'lrow');
    r.dataset.k = 'town:' + (a.f ? a.f.id : norm(a.title));
    r.dataset.n = String(a.wn);
    r.innerHTML = '<span class="th">' + (a.f ? picture(f, 'w185') : '') + '</span><div><div class="t">' + esc(f.t) + (f.y ? ' <span class="note">' + esc(f.y) + '</span>' : '') + '</div>' +
      '<div class="s"><b>' + esc(avg(a.wsum, a.wn).toFixed(1)) + ' ★</b> · ' + esc(plural(a.wn, 'rating', 'ratings')) + ' this week</div></div>';
    if (a.f) {
      const b = el('button', 'pillbtn', 'Rate');
      b.addEventListener('click', (e) => { e.stopPropagation(); filmSheet(a.f); });
      r.appendChild(b);
      r.addEventListener('click', () => filmSheet(a.f));
    }
    host.appendChild(r);
  });
}

/* ------------------------------------------------ the screening vote */
function ballot() {
  const best = new Map();
  P.picks.filter((p) => !(p.meta && p.meta.where)).forEach((p) => {
    const f = filmOf(p.title, p.meta && p.meta.year);
    const key = f ? 'f' + f.id : fkey(p.title, p.meta && p.meta.year);
    const cur = best.get(key);
    if (!cur || p.votes > cur.votes || (p.votes === cur.votes && p.created_at < cur.created_at)) best.set(key, { ...p, film: f });
  });
  return [...best.values()].sort((a, b) => b.votes - a.votes || a.created_at.localeCompare(b.created_at));
}
const screening = () => P.picks.filter((p) => p.meta && p.meta.where).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;

function drawVote(host) {
  sec(host, 'Vote for the next screening', esc('At five votes Stephen books it, puts it on Meetup as a screening, and there’s a mixer after. One vote each.'), 'vote');
  if (P.state === 'loading') { host.appendChild(el('p', 'note pad', 'Counting votes…')); return; }
  if (P.state === 'off') { host.appendChild(el('p', 'note pad', 'The screening vote opens soon.')); return; }
  if (P.state === 'fail') { host.appendChild(el('p', 'note pad', 'The vote didn’t load. Pull down to try again.')); return; }
  const card = el('div', 'textcard');
  card.dataset.ballot = '1';
  const picks = ballot();
  if (!picks.length) card.appendChild(el('p', null, 'Nothing on the ballot yet. Suggest the first film.'));
  picks.forEach((p) => card.appendChild(voteOpt(p)));
  const row = el('div', 'row');
  const sug = button(ICON.plus + ' Suggest a film', 'ghost sm', suggestSheet);
  sug.dataset.suggest = '1';
  row.appendChild(sug);
  row.appendChild(el('span', 'fine', 'A suggestion stays up for 30 days.'));
  card.appendChild(row);
  host.appendChild(card);
  const s = screening();
  if (s) {
    const c = el('div', 'textcard gap');
    c.dataset.k = 'pick:' + s.id;
    c.dataset.screening = '1';
    const when = new Date(Date.parse(s.created_at) || Date.now());
    c.innerHTML = '<span class="eyebrow">Screening</span><h3 class="serif">' + esc(s.title) + '</h3>' +
      '<p>' + esc([s.meta.where, 'posted ' + shortDate.format(when)].join(' · ')) + '</p>' + (s.body ? '<p>' + esc(s.body) + '</p>' : '');
    host.appendChild(c);
  }
}

function voteOpt(p) {
  const o = el('div', 'vote-opt' + (p.voted ? ' on' : ''));
  o.dataset.k = 'pick:' + p.id;
  o.setAttribute('role', 'button');
  o.tabIndex = 0;
  const paint = () => {
    o.classList.toggle('on', p.voted);
    o.setAttribute('aria-pressed', p.voted ? 'true' : 'false');
    const label = p.votes >= GOAL ? p.votes + ' · going on Meetup' : p.votes + ' of ' + GOAL;
    o.innerHTML = '<div class="l">' + esc(p.title) + (p.film && p.film.y ? ' (' + esc(p.film.y) + ')' : '') + '<span>' + esc(label) + '</span></div>' +
      '<div class="bar"><i style="width:' + Math.round(Math.min(p.votes, GOAL) / GOAL * 100) + '%"></i></div>' +
      (p.body ? '<p class="fine">' + esc(p.author + ': ' + p.body) + '</p>' : '<p class="fine">' + esc('Suggested by ' + p.author) + '</p>');
  };
  paint();
  let busy = false;
  const go = () => {
    if (busy) return;
    busy = true;
    const other = !p.voted && ballot().find((x) => x.voted && x.id !== p.id);
    const was = { votes: p.votes, voted: p.voted };
    p.voted = !p.voted;
    p.votes = Math.max(0, p.votes + (p.voted ? 1 : -1));
    paint();
    /* one vote each: the old vote is taken back first, and if that fails
       the new one is not cast (the board itself counts a vote per post) */
    const first = other ? boards.unvote(other.id).then((r) => {
      if (!r.ok) return r;
      const x = P.picks.find((y) => y.id === other.id);
      if (x) { x.votes = r.votes; x.voted = false; }
      return null;
    }) : Promise.resolve(null);
    first.then((bad) => bad || (p.voted ? boards.vote(p.id) : boards.unvote(p.id))).then((r) => {
      busy = false;
      if (!r.ok) { Object.assign(p, was); paint(); app.toast(r.message); return; }
      p.votes = r.votes; p.voted = r.voted;
      const x = P.picks.find((y) => y.id === p.id);
      if (x) { x.votes = r.votes; x.voted = r.voted; }
      if (other) draw('vote'); else paint();
      app.toast(p.voted ? (p.votes >= GOAL ? 'Five! Stephen will put it on Meetup.' : 'Voted for ' + p.title) : 'Vote taken back');
    });
  };
  o.addEventListener('click', go);
  o.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  return o;
}

function suggestSheet() {
  app.sheet('Suggest a film', (body, card, close) => {
    if (!app.user()) {
      body.appendChild(el('p', 'sheet-note', 'Suggesting a film takes the email sign-in: one email, no password. Voting never does.'));
      const r = el('div', 'linkrow');
      r.appendChild(button('Sign in', '', () => app.openSettings()));
      body.appendChild(r);
      return;
    }
    body.appendChild(el('p', 'sheet-note', 'Pick a film from the list. If it is already on the ballot, your vote goes to it instead.'));
    const q = el('input', 'field bf-in');
    q.type = 'search';
    q.placeholder = 'Search the list';
    q.setAttribute('aria-label', 'Search the list');
    body.appendChild(q);
    const box = el('div');
    box.dataset.results = '1';
    body.appendChild(box);
    const paint = () => {
      const s = norm(q.value);
      box.innerHTML = '';
      const hits = [...F.top, ...F.now].filter((f, i, all) => all.findIndex((x) => x.id === f.id) === i && (!s || norm(f.t).includes(s))).slice(0, 30);
      if (!hits.length) box.appendChild(el('p', 'sheet-note', 'Nothing on the list by that name.'));
      hits.forEach((f) => {
        const r = el('div', 'sheet-row', '<div class="t">' + esc(f.t) + '<div class="d">' + esc([f.y, f.g[0]].filter(Boolean).join(' · ')) + '</div></div>');
        r.dataset.film = String(f.id);
        r.appendChild(button('Suggest', 'ghost sm', () => suggest(f, body, close)));
        box.appendChild(r);
      });
    };
    q.addEventListener('input', paint);
    paint();
  });
}

function suggest(f, body, close) {
  const on = ballot().find((p) => p.film && p.film.id === f.id);
  if (on) {
    close();
    if (!on.voted) { const opt = slots.vote.querySelector('[data-k="pick:' + CSS.escape(on.id) + '"]'); if (opt) opt.click(); }
    else app.toast('Already on the ballot, with your vote.');
    return;
  }
  const meta = {};
  if (Number.isInteger(f.y) && f.y >= 1888 && f.y <= 2100) meta.year = f.y;
  boards.create('watch', { kind: 'pick', title: f.t.slice(0, RULES.limits.titleMax), body: '', meta }).then((r) => {
    if (!r.ok) {
      if (r.error === 'no_name') { askName(body, () => suggest(f, body, close)); app.toast(r.message); return; }
      app.toast(r.message);
      return;
    }
    close();
    app.toast('On the ballot. Vote for it, then tell a friend.');
    loadPosts();
  });
}

/* ---------------------------------------------------------------- chat */
function drawChat(host) {
  sec(host, 'Watch chat', esc('Talk about what you’re watching, or plan to watch something together.'), 'chat');
  const card = el('div', 'textcard');
  card.dataset.chat = '1';
  card.innerHTML = '<p>' + esc('The talk lives in the Btown Brief community, in ' + CHAT_NAME + ' for now, with notifications and a moderator; sign in there with your newsletter email. ' +
    'Watching something at a set time? Start a group chat there for it. For right-now chat, the Brief’s Telegram is where people are.') + '</p>';
  const row = el('div', 'row');
  const ch = el('a', 'btn', esc(CHAT_NAME) + ' channel ' + ICON.ext);
  ch.href = safeHref(CHAT_URL);
  ch.target = '_blank';
  ch.rel = 'noopener';
  ch.dataset.door = 'community';
  const tg = el('a', 'btn ghost', 'Telegram');
  tg.href = TELEGRAM_URL;
  tg.dataset.door = 'telegram';
  row.append(ch, tg);
  card.appendChild(row);
  host.appendChild(card);
}

/* ------------------------------------------------------------ landing */
function land() {
  if (!pending || !ready) return;
  const k = pending;
  pending = null;
  if (SECTIONS.includes(k)) { const s = root.querySelector('[data-sec="' + k + '"]'); if (s) { app.jumpTo(s); return; } }
  const m = /^f(\d+)$/.exec(k);
  if (m) {
    const id = Number(m[1]);
    let at = filtered().findIndex((f) => f.id === id);
    if (at < 0 && F.top.some((f) => f.id === id)) { V.recency = 'any'; V.genre = 'all'; V.show = 'all'; at = filtered().findIndex((f) => f.id === id); }
    if (at >= 0) {
      if (at >= V.shown) V.shown = Math.ceil((at + 1) / PAGE) * PAGE;
      draw('list');
    } else if (byId.has(id)) { if (app.flashHit(root, 'soon:' + id)) return; }
  }
  if (/^pick:/.test(k) && P.state === 'loading') { pending = k; return; }
  if (!app.flashHit(root, k)) app.toast('That one has moved on.');
}

/* ------------------------------------------------------------ contract */
app.register(KEY, {
  label: 'Watch',
  icon: ICON.watch,
  promise: 'Trailers, the list you and your person are working through, and what the town thought of it.',
  mount(r) {
    root = r;
    r.innerHTML = '<p class="loading">Loading…</p>';
    loadFilms().then((j) => {
      setFilms(j);
      if (!F.top.length) throw new Error('no films');
      L = loadLocal();
      ready = true;
      render();
      if (app.activeTab() === KEY) app.paintSubnav();
      land();
      loadPosts().then(land);
      pullSeen();
    }).catch(() => {
      r.innerHTML = '<div class="errbox"><b>' + (app.demo ? 'The demo didn’t load.' : 'The film list didn’t load.') + '</b> Reload to try again.</div>';
    });
  },
  activate(param) { pending = param || null; land(); },
  refresh() { if (ready && root) render(); },
  deactivate() {},
  subnav() {
    if (!ready || !root) return null;
    const toc = [['soon', 'Coming soon'], ['list', 'The list'], ['town', 'Town'], ['vote', 'Next screening'], ['chat', 'Chat']]
      .filter(([key]) => root.querySelector('[data-sec="' + key + '"]'))
      .map(([key, label]) => ({ key, label }));
    return chips(toc, null, (key) => app.jumpTo(root.querySelector('[data-sec="' + key + '"]')));
  },
  /* new picks for the screening vote since the reader last looked */
  newSince(ts) { return P.picks.filter((p) => (Date.parse(p.created_at) || 0) > ts * 1000 && !p.mine).length; },
  pull() { if (!ready) return null; loadPosts(); return 'Checking the town’s ratings and votes'; },
});
