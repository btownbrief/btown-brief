/* Watch: films and shows for a couple and for the town. Top to bottom:

   - Movies | TV: one switch at the top. Everything below shows that kind;
     the dots, the want list and the town ratings work the same for both.
     On Movies, today's showtimes come first (fresh first, 2026-10-19),
     opening on the first theater with shows still to come today.
   - Coming soon (Movies): a rail of 2:3 posters, what is in US theaters now
     and what opens next, labelled theaters or streaming. A tap plays the
     trailer in the shell's one video box (never on its own); a film with no
     trailer on TMDB opens its sheet instead. Right under it, the call to
     vote for the next screening, which scrolls to the ballot, with the one
     line a first-time visitor needs: Steve (Stephen's name on the page)
     hosts the movie night (a link to his Meetup group), and this picks the film.
     On TV the rail is what is airing this week, new seasons first.
   - In theaters near you (Movies): Partizanfilm, Majestic 10 and Essex
     Cinemas, one at a time, with the rest of today's times read off each
     theater's own page (scripts/build_showtimes.py, every morning), or the
     next day it has shows, or "Back Oct 30" while it is closed. Partizanfilm
     is picked first (Stephen, 2026-10-18: the local one). Every theater
     keeps its Showtimes button to its own page. Back then's Show all, and
     the list once "Show more" has grown it, carry a Collapse bar that
     stays in reach while the list is on screen.
   - Back then: the time machine. ‹ October 2021 › and a row of years; the
     month's big titles (scripts/build_time_machine.py, monthly: what Rotten
     Tomatoes' front page listed that month, as archived by the Wayback
     Machine, matched to TMDB; or TMDB's own most popular releases of a
     month the archive missed). Titles only ever come from there; every
     picture and word is TMDB's. The section says where the titles come
     from (a TMDB month says so on its dateline), and "Show all" swaps the
     rail for a wrapping grid.
   - The list: the ranking is chosen, and the chosen chip says what it is:
     Top rated (TMDB's 300 best films or 200 best shows, in its order),
     Trending (TMDB's this week), Town favorites (the town's ratings, three
     or more), Newest (by release), By genre (a ranked shelf per genre),
     Shuffle (the ones you have not seen, in a new order on every tap).
     Seen dots for you and your person (the "Watching with someone"
     switch, one line saying what it is for, and a legend naming the two
     dots while it is on), the town
     rating, filters by how recent and by genre, and the want list. The
     dots and the want list live on this device; a signed-in reader's dots
     also follow them (supabase/nn-watch.sql). The partner is a first name
     typed once, never a second account.
   - The film sheet: the overview, year, runtime (or episode length and
     seasons), genres, the trailer, the two seen toggles, want to watch,
     and a 1 to 5 star rating that posts a rating to the watch board
     (boards.js: meta film, year, stars, where). Signed-out readers can see
     everything and set their dots; rating asks for the one-email sign-in.
   - Town ratings this week: the titles with the most ratings in the last
     seven days, with their average. A title with fewer than three ratings
     is never shown, here or on a poster.
   - Vote for the next screening: the watch board's picks, one per film,
     voted with the board's own vote, a bar each toward five. One vote each:
     the server moves a reader's vote when they pick another (the pick
     kind's one_vote rule), and the tab takes the old one back first so the
     bars move at once. At five Stephen puts it on Meetup as a screening
     with a mixer after. A pick Stephen posts with a `where` is the last (or
     next) screening's card.
   - Watch chat: Talk opens the Telegram watch chat; the community channel
     is the second, smaller door. The talk lives there; nothing is built here.

   One number per title. A film is its TMDB film id. A show is TV_BASE plus
   its TMDB TV id, because TMDB numbers films and shows separately and the
   two would otherwise collide. That one number is what the watch board's
   `film` meta, the account's seen dots (nn_watch_seen.film) and this
   device's dots and want list carry, so neither the board nor the database
   changed to hold shows (`film` allows up to 99,999,999; TMDB's film ids
   are near 1.6 million). Posts from before the board had `film`, or posted
   while the server's rules are still round one's (boards.roundTwo()), go
   by title and year, or the title alone when the year has drifted and the
   title is unique.

   ?demo=1 runs exactly this file on data/demo/watch.json: invented films
   and shows, re-dated to the reader's clock, with their ratings and picks
   seeded into the boards' in-memory demo backend, so the counting below is
   the real code. Nothing in the demo is saved or sent. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as boards from '../boards.js';
import { fetchJSON } from '../wire.js';
import { RULES, expiresAt } from '../boards-core.js';
import { el, esc, safeHref, ICON, art, section, rail, chips, pills, button, put, dateline, divider } from '../ui.js';

const KEY = 'watch';
const DATA = 'https://raw.githubusercontent.com/btownbrief/btown-brief/films-data/data/';
const FILMS_URL = DATA + 'films.json';
const TM_URL = DATA + 'time-machine.json';
const SHOWTIMES_URL = DATA + 'showtimes.json';
const SEED_URL = 'data/films-seed.json';
/* Talk: the Telegram watch chat first, the community channel second */
const TELEGRAM_URL = 'https://t.me/+39fLB9cqY684ZmVh';
const CHAT_URL = 'https://www.btownbrief.com/community/channels/meetups-hangouts';
/* the screening is a night Stephen hosts through his Meetup group */
const MEETUP_URL = 'https://www.meetup.com/burlington-social-activites-group/';
const TMDB_URL = 'https://www.themoviedb.org/';
const TMDB_LOGO = '../assets/img/tmdb.svg';
const LOCAL_KEY = 'allday-watch';
const TV_BASE = 50000000;   // a show's number: TV_BASE + its TMDB TV id
const PAGE = 60;            // posters drawn at a time
const SHELF = 20;           // posters on a genre shelf
const MIN_RATINGS = 3;      // a title shows a town rating only from three
const TOWN_ROWS = 8;
const GOAL = 5;             // votes before Stephen books it
const RATING_PAGES = 10;    // 600 ratings read back for the averages
const DAY = 86400000;
const WEEK = 7 * DAY;
const YT = /^[A-Za-z0-9_-]{11}$/;
const POSTER = /^\/[A-Za-z0-9_-]+\.(jpg|png)$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/* the three theaters, so their rows and Showtimes buttons show even before
   (or without) showtimes.json */
const THEATERS = [
  { id: 'partizanfilm', name: 'Partizanfilm', town: 'Burlington', url: 'https://www.partizanfilm.org/' },
  { id: 'majestic10', name: 'Majestic 10', town: 'Williston', url: 'https://www.majestic10.com/movies' },
  { id: 'essex', name: 'Essex Cinemas', town: 'Essex', url: 'https://www.essexcinemas.com/vermont/essex/essex-cinemas-9/showtimes' },
];

const RECENCY = [
  ['any', 'Any time'], ['1m', 'Last month', 0, 31], ['6m', '6 months', 0, 183], ['1y', '1 year', 0, 366], ['2y', '2 years', 0, 731],
  ['5y', '5 years', 0, 1827], ['10y', '10 years', 0, 3653], ['15y', '15 years', 0, 5479], ['20y', '20 years', 0, 7305], ['20p', '20+ years', 7306, Infinity],
];
const SORTS = [['top', 'Top rated'], ['trend', 'Trending'], ['town', 'Town favorites'], ['new', 'Newest'], ['genre', 'By genre'], ['shuffle', 'Shuffle']];

const arr = (v) => (Array.isArray(v) ? v : []);
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/* ---------------------------------------------------------------- clock */
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const hmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const todayKey = () => dayFmt.format(new Date());
const nowHM = () => hmFmt.format(new Date());
const dayNum = (key) => Math.floor(Date.parse(key + 'T12:00:00Z') / DAY);
const keyOf = (n) => new Date(n * DAY + 12 * 3600000).toISOString().slice(0, 10);
const shortDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const dayName = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const monthName = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const dateLabel = (key) => shortDate.format(new Date(key + 'T12:00:00Z'));
const monthLabel = (m) => monthName.format(new Date(m + '-15T12:00:00Z'));
const monthIndex = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const monthOf = (i) => Math.floor(i / 12) + '-' + String((i % 12) + 1).padStart(2, '0');
const runtime = (m) => (m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60 ? (m % 60) + 'm' : '') : m + 'm').trim();

/* --------------------------------------------------------------- state */
let root = null, pending = null, ready = false, extras = false;
let D = null;               // the demo file
let F = null;               // the payload: films and shows, by shelf
let TM = null;              // the time machine: { months: [{ m, movie: [..], tv: [..] }] }, newest first
let ST = null;              // showtimes: { theaters: [...] }, or null
const byId = new Map();     // id -> title (films and shows; a show's id is TV_BASE + its TMDB id)
const byKey = new Map();    // "title|year" -> title
const byTitle = new Map();  // "title" -> title, or null when two share it
const slots = Object.create(null);
const V = { kind: 'movie', recency: 'any', genre: 'all', sort: 'top', show: 'all', shown: PAGE, seed: 1, month: '', theater: '', picked: false, backAll: false };
const P = { state: 'loading', ratings: [], picks: [], agg: new Map() };
let L = null;               // this device's dots, partner, want list, own ratings

/* ------------------------------------------------------------ the titles */
function film(raw, extra, kind) {
  const tv = kind === 'tv';
  if (!raw || typeof raw !== 'object' || !Number.isInteger(raw.id) || raw.id < 1 || raw.id >= TV_BASE || !raw.t) return null;
  const d = ISO_DAY.test(String(raw.d || '')) ? raw.d : '';
  const y = Number.isInteger(raw.y) ? raw.y : d ? Number(d.slice(0, 4)) : null;
  return {
    id: tv ? TV_BASE + raw.id : raw.id, tmdb: raw.id, kind: tv ? 'tv' : 'movie', k: (tv ? 'tv' : 'f') + raw.id,
    t: String(raw.t), y, d: d || (y ? y + '-07-01' : ''),
    g: arr(raw.g).filter((x) => typeof x === 'string').slice(0, 4), o: String(raw.o || ''),
    rt: Number.isInteger(raw.rt) && raw.rt > 0 ? raw.rt : null,
    sn: tv && Number.isInteger(raw.sn) && raw.sn > 0 ? raw.sn : null,
    ns: tv && Number.isInteger(raw.ns) && raw.ns > 0 ? raw.ns : null,
    p: POSTER.test(String(raw.p || '')) ? raw.p : '', yt: YT.test(String(raw.yt || '')) ? raw.yt : '',
    art: app.demo ? String(raw.art || 'paper') : '', where: String(raw.where || ''), dur: String(raw.dur || ''), ...extra,
  };
}
const norm = (t) => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 80);
const fkey = (t, y) => norm(t) + '|' + (y || '');
const uniq = (list) => { const seen = new Set(); return list.filter((f) => f && !seen.has(f.id) && seen.add(f.id)); };

function know(f) {
  if (!byId.has(f.id)) byId.set(f.id, f);
  const k = byId.get(f.id);
  if (!byKey.has(fkey(f.t, f.y))) byKey.set(fkey(f.t, f.y), k);
  const n = norm(f.t);
  byTitle.set(n, byTitle.has(n) && (!byTitle.get(n) || byTitle.get(n).id !== f.id) ? null : k);
}

function setFilms(j) {
  F = { seed: !!j.seed, demo: !!j.demo, images: /^https:\/\/image\.tmdb\.org\//.test(String(j.images || '')) ? j.images : 'https://image.tmdb.org/t/p/',
    notice: String(j.notice || 'This product uses the TMDB API but is not endorsed or certified by TMDB.') };
  const list = (key, kind, extra) => uniq(arr(j[key]).map((x) => film(x, extra, kind)));
  F.top = list('top', 'movie');
  F.trend = list('trend', 'movie');
  F.now = arr(j.now).map((x) => film(x, { shelf: 'now' }, 'movie')).filter(Boolean);
  F.soon = arr(j.soon).map((x) => film(x, { shelf: 'soon' }, 'movie')).filter(Boolean);
  F.tvTop = list('tv_top', 'tv');
  F.tvTrend = list('tv_trend', 'tv');
  F.tvAir = list('tv_air', 'tv', { shelf: 'air' });
  byId.clear(); byKey.clear(); byTitle.clear();
  [...F.top, ...F.trend, ...F.now, ...F.soon, ...F.tvTop, ...F.tvTrend, ...F.tvAir].forEach(know);
}
const hasTV = () => F.tvTop.length > 0;
const tops = () => (V.kind === 'tv' ? F.tvTop : F.top);
const trends = () => (V.kind === 'tv' ? F.tvTrend : F.trend);
/* everything of this kind the list can rank: the top list, then what is trending or showing that is not on it */
const pool = () => uniq(V.kind === 'tv' ? [...F.tvTop, ...F.tvTrend, ...F.tvAir] : [...F.top, ...F.trend, ...F.now]);

/* a board post's title: its id; else title and year, else the title alone when it is unique */
const filmOf = (p) => {
  const m = (p && p.meta) || {};
  return (Number.isInteger(m.film) && byId.get(m.film)) || byKey.get(fkey(p.title, m.year)) || byTitle.get(norm(p.title)) || null;
};
/* the fields a new rating or pick carries for its title */
function filmMeta(f, two) {
  const meta = {};
  if (two) meta.film = f.id;
  if (Number.isInteger(f.y) && f.y >= 1888 && f.y <= 2100) meta.year = f.y;
  return meta;
}

const posterUrl = (f, size) => (app.demo ? f.art : f.p ? F.images + size + f.p : '');
const picture = (f, size) => { const u = posterUrl(f, size); return u ? art(u) : ''; };
const tmdbHref = (f) => TMDB_URL + (f.kind === 'tv' ? 'tv/' : 'movie/') + f.tmdb;
const trailer = (f) => ({ k: 'tr:' + f.id, kind: 'video', yt: f.yt, title: f.t + ' · trailer', src: 'Trailer', media: posterUrl(f, 'w342') || 'paper',
  dur: f.dur || '', href: f.yt ? 'https://www.youtube.com/watch?v=' + f.yt : '#watch/' + f.k });
const hasTrailer = (f) => app.demo || !!f.yt;
function playTrailer(f) {
  if (!hasTrailer(f)) { app.toast('No trailer for this one on TMDB yet.'); return; }
  app.play(trailer(f));
}

/* ------------------------------------------------------- the time machine */
/* time-machine.json: { titles: { m603: {...}, t1399: {...} }, months: [{ m, src, theaters, streaming, tv }] };
   src is "rt" (the archived front page) or "tmdb" (a month the archive missed) */
function setTM(j) {
  TM = null;
  if (!j || typeof j !== 'object' || !j.titles || typeof j.titles !== 'object' || !Array.isArray(j.months)) return;
  const titles = new Map();
  Object.entries(j.titles).forEach(([key, raw]) => {
    const tv = /^t\d+$/.test(key), mv = /^m\d+$/.test(key);
    if (!(tv || mv) || !raw || Number(key.slice(1)) !== raw.id) return;
    const f = film(raw, null, tv ? 'tv' : 'movie');
    if (f) { know(f); titles.set(key, byId.get(f.id)); }
  });
  const pick = (keys) => uniq(arr(keys).map((k) => titles.get(k)));
  const months = j.months.filter((m) => m && MONTH.test(String(m.m)))
    .map((m) => ({ m: m.m, src: m.src === 'tmdb' ? 'tmdb' : 'rt', movie: pick([...arr(m.theaters), ...arr(m.streaming)]), tv: pick(m.tv) }))
    .filter((m) => m.movie.length || m.tv.length)
    .sort((a, b) => b.m.localeCompare(a.m));
  if (months.length) TM = { months };
}
const tmMonths = () => (TM ? TM.months.filter((m) => m[V.kind].length) : []);
/* a year back from this month, or the closest month there is */
function defaultMonth() {
  const list = tmMonths();
  if (!list.length) return '';
  const want = monthIndex(todayKey().slice(0, 7)) - 12;
  return list.slice().sort((a, b) => Math.abs(monthIndex(a.m) - want) - Math.abs(monthIndex(b.m) - want))[0].m;
}

/* ----------------------------------------------------------- showtimes */
function setShowtimes(j) {
  ST = null;
  if (!j || typeof j !== 'object' || !Array.isArray(j.theaters)) return;
  const got = new Map();
  j.theaters.forEach((t) => {
    const known = t && THEATERS.find((x) => x.id === t.id);
    if (!known) return;
    const days = {};
    Object.entries(t.days && typeof t.days === 'object' ? t.days : {}).forEach(([day, films]) => {
      if (!ISO_DAY.test(day)) return;
      const list = arr(films).filter((x) => x && typeof x.t === 'string' && x.t.trim())
        .map((x) => ({ t: x.t.trim().slice(0, 120), id: Number.isInteger(x.id) && x.id > 0 && x.id < TV_BASE ? x.id : null,
          p: POSTER.test(String(x.p || '')) ? x.p : '', art: app.demo ? String(x.art || '') : '',
          times: arr(x.times).filter((h) => HHMM.test(String(h))).sort() }))
        .filter((x) => x.times.length);
      if (list.length) days[day] = list;
    });
    got.set(known.id, { ...known, ok: t.ok !== false, closed: !!t.closed, back: ISO_DAY.test(String(t.back || '')) ? t.back : '', days });
  });
  if (got.size) ST = { theaters: THEATERS.map((t) => got.get(t.id) || { ...t, ok: false, closed: false, back: '', days: {} }) };
}
const theaters = () => (ST ? ST.theaters : THEATERS.map((t) => ({ ...t, ok: false, closed: false, back: '', days: {} })));
/* the day a theater's row shows: today if it has a show still to come, else its next day with shows */
function showDay(t) {
  const today = todayKey(), hm = nowHM();
  const days = Object.keys(t.days).filter((d) => d >= today).sort();
  for (const d of days) {
    const films = t.days[d].map((f) => ({ ...f, times: d === today ? f.times.filter((h) => h >= hm) : f.times })).filter((f) => f.times.length);
    if (films.length) return { day: d, films };
  }
  return null;
}
/* "11:00 am · 1:40 · 4:20 pm": the half of the day once, where it changes and at the end */
function timesLabel(times) {
  const parts = times.map((h) => { const [H, M] = h.split(':').map(Number); return { t: ((H + 11) % 12 + 1) + ':' + String(M).padStart(2, '0'), pm: H >= 12 }; });
  return parts.map((p, i) => p.t + (i === parts.length - 1 || parts[i + 1].pm !== p.pm ? (p.pm ? ' pm' : ' am') : '')).join(' · ');
}
const dayLabel = (d) => (d === todayKey() ? 'Today' : dayNum(d) - dayNum(todayKey()) === 1 ? 'Tomorrow' : dayName.format(new Date(d + 'T12:00:00Z')));

/* The demo file is written on _anchor; every date moves by the days since,
   and every time-machine month by the months since, so "last month" always
   has films in it. */
function redate(d) {
  const today = todayKey();
  const shift = ISO_DAY.test(String(d._anchor || '')) ? dayNum(today) - dayNum(d._anchor) : 0;
  const mshift = ISO_DAY.test(String(d._anchor || '')) ? monthIndex(today.slice(0, 7)) - monthIndex(d._anchor.slice(0, 7)) : 0;
  const moveDay = (k) => keyOf(dayNum(k) + shift);
  const move = (f) => {
    if (!f || !ISO_DAY.test(String(f.d || ''))) return f;
    const nd = moveDay(f.d);
    return { ...f, d: nd, y: Number(nd.slice(0, 4)) };
  };
  const films = d.films || {};
  const out = { ...films };
  ['top', 'soon', 'now', 'trend', 'tv_top', 'tv_trend', 'tv_air'].forEach((k) => { out[k] = arr(films[k]).map(move); });
  const tm = d.tm && { ...d.tm, months: arr(d.tm.months).map((m) => ({ ...m, m: monthOf(monthIndex(m.m) + mshift) })) };
  const st = d.showtimes && { ...d.showtimes, theaters: arr(d.showtimes.theaters).map((t) => ({ ...t, back: t.back ? moveDay(t.back) : '',
    days: Object.fromEntries(Object.entries(t.days || {}).map(([k, v]) => [moveDay(k), v])) })) };
  return { films: out, tm, st };
}

function loadFilms() {
  const ok = (j) => j && typeof j === 'object' && Array.isArray(j.top) && j.top.length > 0;
  if (app.demo) return app.demoData(KEY).then((d) => { D = d; return redate(d); });
  const seed = () => fetchJSON(SEED_URL, 8000).then((j) => { if (!ok(j)) throw new Error('bad seed'); return j; });
  return fetchJSON(FILMS_URL, 8000).then((j) => { if (!ok(j)) throw new Error('bad films'); return j; }).catch(seed).then((films) => ({ films }));
}
/* the time machine and the showtimes come after the list, and each simply
   leaves its section out when it does not load */
function loadExtras(got) {
  if (app.demo) { setTM(got.tm); setShowtimes(got.st); return Promise.resolve(); }
  return Promise.all([
    fetchJSON(TM_URL, 10000).then(setTM, () => setTM(null)),
    fetchJSON(SHOWTIMES_URL, 8000).then(setShowtimes, () => setShowtimes(null)),
  ]);
}

/* ------------------------------------------------------- this device */
/* { mode: 'us' | 'me', partner: 'Sam', seen: { id: [me, them] }, want: { id: ts },
   rated: { id: { post, stars } }, kind: 'movie' | 'tv' }, plus the sync's own two: dirty (films
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
  return { mode: o.mode === 'us' && partner ? 'us' : 'me', partner, seen, want: obj(o.want), rated: obj(o.rated), kind: o.kind === 'tv' ? 'tv' : 'movie',
    nameDirty: !!o.nameDirty, dirty: obj(o.dirty), syncedFor: typeof o.syncedFor === 'string' ? o.syncedFor : '' };
}
function dotsOf(d) {
  const out = {};
  Object.entries(d && typeof d === 'object' ? d : {}).forEach(([id, v]) => { if (Array.isArray(v)) out[id] = [v[0] ? 1 : 0, v[1] ? 1 : 0]; });
  return out;
}
function saveLocal() {
  if (app.demo) { memory = L; return; }
  store.write(LOCAL_KEY, { mode: L.mode, partner: L.partner, seen: L.seen, want: L.want, rated: L.rated, kind: L.kind,
    nameDirty: L.nameDirty, dirty: L.dirty, syncedFor: L.syncedFor });
}
const cleanName = (s) => String(s || '').replace(/[@<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
const us = () => L.mode === 'us' && !!L.partner;
const seenOf = (f) => L.seen[f.id] || [0, 0];

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

/* "Delete my account and posts" (boards.js): nn_delete_me clears
   nn_watch_seen and the partner's name itself once nn-ROUND3.sql is pasted.
   Before that paste it does not, so ask the account to forget this reader's
   dots the moment the delete succeeds, while the reader is still signed in
   (best effort; after the paste there is nothing left to forget). This
   phone's copy goes too: kept, the next sign-in would send it straight back
   up. The want list never leaves the phone and stays. */
window.addEventListener('allday-boards', (e) => {
  if (app.demo || !e.detail || e.detail.what !== 'deleteme') return;
  rpcAs('nn_watch_forget');
  if (L) {
    Object.assign(L, { mode: 'me', partner: '', seen: {}, rated: {}, nameDirty: false, dirty: {}, syncedFor: '' });
    saveLocal();
    if (ready) draw('list');
  }
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
    if (ready) { if (V.sort === 'town') draw('list'); rateTiles(); draw('town'); draw('vote'); app.recount(); }
  });
}

/* every rating, by film: all-time count and sum, and this week's */
function tally() {
  const agg = new Map();
  const weekAgo = Date.now() - WEEK;
  P.ratings.forEach((p) => {
    const stars = p.meta && p.meta.stars;
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return;
    const f = filmOf(p);
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
    if (f) add('rating', f, { h: r[2], by: i, meta: { film: f.id, year: f.y, stars: r[1] } });
  });
  arr(D.picks).forEach((p) => {
    const f = byId.get(p.f);
    if (f) add('pick', f, { h: p.h, by: p.by, votes: p.votes, body: p.body, meta: { film: f.id, year: f.y } });
  });
}

/* ------------------------------------------------------------- drawing */
const sec = (host, title, sub, key, right) => { const s = section(host, title, sub, right); s.dataset.sec = key; return s; };
/* what is on today first (Stephen, 2026-10-19: "when someone opens to a
   tab, the fresh content is the first thing they see"): today's showtimes,
   then what is in theaters and coming, then the rest */
const SECTIONS = ['kind', 'theaters', 'soon', 'cta', 'back', 'list', 'town', 'vote', 'chat'];

function draw(name) {
  const host = slots[name];
  if (!host) return;
  host.innerHTML = '';
  ({ kind: drawKind, soon: drawSoon, cta: drawCta, theaters: drawTheaters, back: drawBack, list: drawList,
    town: drawTown, vote: drawVote, chat: drawChat })[name](host);
}

function render() {
  root.innerHTML = '';
  SECTIONS.forEach((s) => { slots[s] = el('div'); slots[s].dataset.slot = s; root.appendChild(slots[s]); draw(s); });
  put(root, credit());
  root.appendChild(el('div', 'spacer'));
}

/* Movies or TV: everything below follows it */
function setKind(k) {
  if (k === V.kind || (k === 'tv' && !hasTV())) return;
  V.kind = k;
  V.genre = 'all';
  V.shown = PAGE;
  if (V.sort === 'trend' && !trends().length) V.sort = 'top';
  V.month = defaultMonth();
  L.kind = k;
  saveLocal();
  render();
  if (app.activeTab() === KEY) app.paintSubnav();
}
function drawKind(host) {
  if (!hasTV()) return;
  const row = el('div', 'toolrow');
  const p = pills([['movie', 'Movies'], ['tv', 'TV']], V.kind, (v) => setKind(v));
  p.dataset.kind = '1';
  p.style.flex = '1 1 auto';
  p.setAttribute('role', 'group');
  p.setAttribute('aria-label', 'Movies or TV');
  row.appendChild(p);
  host.appendChild(row);
}

/* TMDB's attribution, with its logo, wherever its data shows */
function credit(inSheet) {
  const c = el('div', inSheet ? 'sheet-note' : 'note pad');
  c.dataset.credit = '1';
  if (app.demo) return null;
  /* the logo mark only; the full attribution and notice are in Settings, About */
  c.innerHTML = '<a href="' + esc(TMDB_URL) + '" target="_blank" rel="noopener"><img src="' + esc(TMDB_LOGO) + '" alt="TMDB" width="92" height="12" loading="lazy" decoding="async"></a>';
  return c;
}

/* ------------------------------------------------------- coming soon */
/* TMDB's now-playing list carries re-releases under their first year (Endgame,
   2019): a film three or more years old is back, not new */
const BACK_YEARS = 3;
const nowLabel = (f) => (f.y && f.y <= Number(todayKey().slice(0, 4)) - BACK_YEARS ? 'Back in theaters' : 'In theaters now');
const airLabel = (f) => (f.ns ? (f.d > todayKey() ? 'Season ' + f.ns + ' · ' + dateLabel(f.d) : 'New season ' + f.ns) : 'Airing now');
const railLabel = (f) => (f.shelf === 'air' ? airLabel(f) : f.shelf === 'now' ? nowLabel(f)
  : (f.d ? dateLabel(f.d) + ' · ' : '') + (f.where === 'streaming' ? 'streaming' : 'theaters'));

function drawSoon(host) {
  const list = V.kind === 'tv' ? F.tvAir : [...F.now, ...F.soon];
  if (!list.length) return;
  sec(host, V.kind === 'tv' ? 'On TV now' : 'Coming soon', null, 'soon');
  const r = rail(host);
  list.forEach((f) => {
    const a = el('a', 'poster');
    a.href = '#watch/soon:' + f.id;
    a.dataset.k = 'soon:' + f.id;
    a.setAttribute('aria-label', (hasTrailer(f) ? 'Play the trailer for ' : '') + f.t + ', ' + railLabel(f));
    a.innerHTML = '<span class="c-media">' + picture(f, 'w342') +
      (hasTrailer(f) ? '<span class="play">' + ICON.play + '</span>' + (f.dur ? '<span class="dur">' + esc(f.dur) + '</span>' : '') : '') + '</span>' +
      '<span class="t">' + esc(f.t) + '</span><span class="s">' + esc(railLabel(f)) + '</span>';
    a.addEventListener('click', (e) => { e.preventDefault(); if (hasTrailer(f)) playTrailer(f); else filmSheet(f); });
    r.appendChild(a);
  });
}

/* who is screening, for a first-time visitor: one line, with the Meetup link */
function hostLine() {
  const p = el('p', 'note pad wnight', '<a href="' + esc(MEETUP_URL) + '" target="_blank" rel="noopener">' + esc('Steve hosts a movie night') + '</a>' +
    esc(' with a mixer after. Pick the next film.'));
  p.dataset.host = '1';
  return p;
}

/* the screening vote, right where people are: under Coming soon */
function drawCta(host) {
  if (V.kind !== 'movie') return;
  host.appendChild(hostLine());
  const row = el('div', 'addrow');
  const b = button('Vote for the next screening ' + ICON.arrow, '', () => app.jumpTo(root.querySelector('[data-sec="vote"]')));
  b.dataset.cta = 'vote';
  row.appendChild(b);
  host.appendChild(row);
}

/* ---------------------------------------------- in theaters near you */
function drawTheaters(host) {
  if (V.kind !== 'movie') return;
  const all = theaters();
  sec(host, 'In theaters near you', null, 'theaters');
  /* until the reader picks one: the first in the set order (Partizanfilm,
     the local one, then Majestic 10, then Essex; Stephen, 2026-10-18) with
     shows still to come today, so the tab opens on tonight's times; else
     the first that read, even while it is closed, since it says when it is
     back */
  const today = todayKey();
  const tonight = (t) => t.ok && (!t.closed || (t.back && t.back <= today)) && (showDay(t) || {}).day === today;
  if (!V.picked) V.theater = (all.find(tonight) || all.find((t) => t.ok) || all[0]).id;
  const pick = pills(all.map((t) => [t.id, t.name]), V.theater, (v) => { V.theater = v; V.picked = true; draw('theaters'); });
  pick.dataset.theater = '1';
  pick.style.flex = '1 1 auto';
  const pr = el('div', 'toolrow');
  pr.appendChild(pick);
  host.appendChild(pr);
  const t = all.find((x) => x.id === V.theater);
  const box = el('div');
  box.dataset.k = 'th:' + t.id;
  box.dataset.showing = t.id;
  const show = t.ok ? showDay(t) : null;
  const open = show && (!t.closed || (t.back && show.day >= t.back));
  const line = [t.town];
  /* closed with a reopening still to come: "Back Oct 30", and the day its
     schedule is for when that is later; once the day has come, its shows */
  const back = t.closed && t.back > todayKey() ? t.back : '';
  if (back) line.push('Back ' + dateLabel(back));
  else if (t.closed && !open) line.push('Closed for now');
  if (open && show.day !== back) line.push(dayLabel(show.day));
  /* the times could not be read this morning (Essex's site turns away
     GitHub's machines): its own page has them */
  if (!t.ok && !t.closed) line.push('Times on their site');
  const head = el('p', 'note pad', esc(line.join(' · ')));
  head.dataset.status = '1';
  box.appendChild(head);
  if (open) {
    show.films.forEach((x) => {
      const known = (x.id && byId.get(x.id)) || byTitle.get(norm(x.t)) || null;
      const r = el('div', 'lrow');
      r.dataset.film = x.t;
      const pic = known ? picture(known, 'w185') : app.demo ? (x.art ? art(x.art) : '') : x.p ? art(F.images + 'w185' + x.p) : '';
      r.innerHTML = '<span class="th">' + pic + '</span><div><div class="t">' + esc(known ? known.t : x.t) + '</div>' +
        '<div class="s" data-times>' + esc(timesLabel(x.times)) + '</div></div>';
      if (known) {
        const b = el('button', 'pillbtn', hasTrailer(known) ? ICON.play : 'More');
        b.setAttribute('aria-label', hasTrailer(known) ? 'Trailer for ' + known.t : 'More about ' + known.t);
        b.addEventListener('click', (e) => { e.stopPropagation(); if (hasTrailer(known)) playTrailer(known); else filmSheet(known); });
        r.appendChild(b);
        r.addEventListener('click', () => filmSheet(known));
      }
      box.appendChild(r);
    });
  }
  const links = el('div', 'addrow');
  const a = el('a', 'btn ghost sm', 'Showtimes ' + ICON.ext);
  a.href = safeHref(t.url);
  a.target = '_blank';
  a.rel = 'noopener';
  a.dataset.showtimes = t.id;
  links.appendChild(a);
  box.appendChild(links);
  host.appendChild(box);
}

/* ------------------------------------------------------- back then */
function drawBack(host) {
  const months = tmMonths();
  if (!months.length) return;
  if (!months.some((m) => m.m === V.month)) V.month = defaultMonth();
  const at = months.findIndex((m) => m.m === V.month);
  const cur = months[at];
  const list = cur[V.kind];
  /* the rail, or every title in a wrapping grid, with a Collapse bar that
     stays in reach while the grid is on screen */
  const all = list.length > 3 ? button(V.backAll ? 'Show less' : 'Show all ' + list.length, 'ghost sm', () => {
    V.backAll = !V.backAll;
    draw('back');
    const h = root.querySelector('[data-sec="back"]');
    if (!V.backAll && h && h.getBoundingClientRect().top < 0) app.jumpTo(h);
    backToggle();
  }) : null;
  if (all) { all.dataset.backAll = V.backAll ? 'open' : 'closed'; all.setAttribute('aria-expanded', V.backAll ? 'true' : 'false'); }
  sec(host, 'Back then', esc('Rotten Tomatoes’ front page, month by month'), 'back', all);
  const go = (m) => { V.month = m; draw('back'); };
  /* months are newest first: ‹ is older, › is newer. A month the archive
     missed is TMDB's most popular, and its dateline says so. */
  const dl = dateline({ title: monthLabel(cur.m), sub: cur.src === 'tmdb' ? 'Most popular on TMDB' : '',
    prev: at < months.length - 1 ? () => go(months[at + 1].m) : null, next: at > 0 ? () => go(months[at - 1].m) : null });
  dl.dataset.month = cur.m;
  host.appendChild(dl);
  const years = [...new Set(months.map((m) => m.m.slice(0, 4)))];
  if (years.length > 1) {
    const yr = chips(years.map((y) => ({ key: y, label: y })), cur.m.slice(0, 4), (y) => {
      const same = months.find((m) => m.m === y + cur.m.slice(4));
      const near = months.filter((m) => m.m.startsWith(y)).sort((a, b) => Math.abs(monthIndex(a.m) - monthIndex(y + cur.m.slice(4))) - Math.abs(monthIndex(b.m) - monthIndex(y + cur.m.slice(4))))[0];
      go((same || near).m);
    });
    yr.dataset.years = '1';
    host.appendChild(yr);
  }
  let r;
  if (V.backAll && all) {
    const wrap = el('div', 'expwrap');
    r = el('div', 'grid3 wgrid');
    wrap.append(r, collapseBar('Back then', () => {
      V.backAll = false;
      draw('back');
      app.jumpTo(root.querySelector('[data-sec="back"]'));
      backToggle();
    }));
    host.appendChild(wrap);
  } else r = rail(host);
  r.dataset.back = cur.m;
  list.forEach((f) => { const t = tile(f, 'back:' + cur.m + ':' + f.id); if (r.classList.contains('wgrid')) t.style.width = 'auto'; r.appendChild(t); });
}
/* the redraw took the pressed button away: keep the keyboard on its toggle */
function backToggle() {
  const t = root.querySelector('[data-back-all]');
  if (t) t.focus({ preventScroll: true });
}
/* the bar under an opened list: it rides the bottom of the screen while the
   list is in view, so a long list folds back up from anywhere in it */
function collapseBar(what, onCollapse) {
  const bar = el('div', 'collapsebar');
  const b = button(ICON.up + ' Collapse', '', onCollapse);
  b.type = 'button';
  b.dataset.collapse = '1';
  b.setAttribute('aria-label', 'Collapse ' + what);
  bar.appendChild(b);
  return bar;
}

/* ----------------------------------------------------------- the list */
function inWindow(f, key) {
  if (key === 'any') return true;
  const w = RECENCY.find((x) => x[0] === key);
  if (!w || !f.d) return false;
  const ago = dayNum(todayKey()) - dayNum(f.d);
  return ago >= w[2] && ago <= w[3];
}
const seenEnough = (f) => { const s = seenOf(f); return !!(s[0] || (us() && s[1])); };
function shown(f) {
  if (V.show === 'want' && !L.want[f.id]) return false;
  if (V.show === 'unseen' && seenEnough(f)) return false;
  return true;
}
/* a seeded shuffle, so a redraw keeps the order until Shuffle is tapped again */
function shuffled(list, seed) {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
/* the titles a sort ranks, in its order, before the filters */
function ranked(sort) {
  const top = tops();
  if (sort === 'trend') return trends();
  if (sort === 'new') { const today = todayKey(); return pool().filter((f) => f.d && f.d <= today).sort((a, b) => b.d.localeCompare(a.d) || a.t.localeCompare(b.t)); }
  if (sort === 'shuffle') return shuffled(pool().filter((f) => !seenEnough(f)), V.seed);
  if (sort === 'town') {
    const all = pool();
    const rank = new Map(all.map((f, i) => [f.id, i]));
    return all.slice().sort((a, b) => {
      const ta = town(a), tb = town(b);
      if (ta && tb) return avg(tb.sum, tb.n) - avg(ta.sum, ta.n) || tb.n - ta.n || rank.get(a.id) - rank.get(b.id);
      if (ta || tb) return ta ? -1 : 1;
      return rank.get(a.id) - rank.get(b.id);
    });
  }
  return top;
}
function filtered(o = {}) {
  const recency = o.recency || V.recency, genre = o.genre || V.genre;
  return ranked(V.sort).filter((f) => shown(f) && inWindow(f, recency) && (genre === 'all' || f.g.includes(genre)));
}

function tile(f, key) {
  const a = el('a', 'poster');
  if (!key) a.style.width = 'auto';
  a.href = '#watch/' + f.k;
  a.dataset.k = key || f.k;
  a.dataset.id = String(f.id);
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
  root.querySelectorAll('[data-slot="list"] .poster, [data-slot="back"] .poster').forEach((a) => {
    const f = byId.get(Number(a.dataset.id));
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

/* Watching with someone: a switch, the one line that says what it is for,
   and while it is on, which dot is whose */
function withSwitch(nouns) {
  const box = el('div', 'wwith');
  box.dataset.who = '1';
  const lab = el('label', 'consent', '<input type="checkbox" role="switch" data-with> ' + esc('Watching with someone'));
  const cb = lab.querySelector('input');
  cb.checked = us();
  cb.addEventListener('change', () => {
    if (cb.checked && !L.partner) { cb.checked = false; nameSheet(); return; }
    L.mode = cb.checked ? 'us' : 'me';
    saveLocal();
    draw('list');
  });
  box.append(lab, el('p', 'note', esc('Mark what each of you has seen, and find ' + nouns + ' neither of you has.')));
  if (us()) {
    /* the dots sit side by side on every poster: the first is yours */
    const who = (first, name) => '<span class="wwho"><span class="wdots" aria-hidden="true"><i' + (first ? ' class="on"' : '') + '></i><i' + (first ? '' : ' class="on"') + '></i></span>' + esc(name) + '</span>';
    const leg = el('p', 'wlegend', who(true, 'You') + who(false, L.partner));
    leg.dataset.legend = '1';
    const ch = button('Change name', 'ghost sm', () => nameSheet());
    ch.dataset.rename = '1';
    leg.appendChild(ch);
    box.appendChild(leg);
  }
  return box;
}

function drawList(host) {
  const top = tops();
  const n = top.length;
  const noun = V.kind === 'tv' ? ['show', 'shows'] : ['film', 'films'];
  const neither = top.filter((f) => { const s = seenOf(f); return !s[0] && !s[1]; }).length;
  const left = top.filter((f) => !seenOf(f)[0]).length;
  const sub = us() ? '<b>' + esc(neither) + '</b> ' + esc('neither of you has seen') : '<b>' + esc(left) + '</b> ' + esc('of ' + n + ' to go');
  const head = sec(host, 'The list', sub, 'list');
  if (F.seed) head.dataset.seed = '1';
  host.appendChild(withSwitch(noun[1]));

  /* the ranking, chosen: the chip that is on says what the order is */
  const sorts = SORTS.filter(([k]) => k !== 'trend' || trends().length);
  const sort = chips(sorts.map(([key, label]) => ({ key, label, icon: key === 'shuffle' ? ICON.shuffle : '' })), V.sort, (k) => {
    if (k === 'shuffle') V.seed = (Date.now() ^ (Math.random() * 4294967296)) >>> 0;
    V.sort = k;
    V.shown = PAGE;
    if (k === 'genre') V.genre = 'all';
    draw('list');
  });
  sort.dataset.sort = '1';
  sort.setAttribute('aria-label', 'Order');
  host.appendChild(sort);

  const tools = el('div', 'toolrow');
  const pl = pool();
  const wantN = pl.filter((f) => L.want[f.id]).length;
  const show = pills([['all', 'All'], ['want', 'Want to watch' + (wantN ? ' ' + wantN : '')], ['unseen', us() ? 'Neither of us' : 'Not seen']], V.show,
    (v) => { V.show = v; V.shown = PAGE; draw('list'); });
  show.dataset.show = '1';
  tools.append(show);
  host.appendChild(tools);

  /* a chip that would show nothing is left off, unless it is the one chosen */
  const rec = chips(RECENCY.map(([key, label]) => ({ key, label, n: key === 'any' ? null : filtered({ recency: key }).length }))
    .filter((c) => c.key === 'any' || c.n || c.key === V.recency), V.recency,
    (k) => { V.recency = k; V.shown = PAGE; draw('list'); });
  rec.dataset.filter = 'recency';
  host.appendChild(rec);
  const counts = new Map();
  pl.forEach((f) => f.g.forEach((g) => counts.set(g, (counts.get(g) || 0) + 1)));
  const genres = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
  if (V.sort !== 'genre') {
    const gen = chips([{ key: 'all', label: 'All genres' }, ...genres.map((g) => ({ key: g, label: g, n: filtered({ genre: g }).length }))
      .filter((c) => c.n || c.key === V.genre)], V.genre,
      (k) => { V.genre = k; V.shown = PAGE; draw('list'); });
    gen.dataset.filter = 'genre';
    host.appendChild(gen);
  }

  const filters = V.recency !== 'any' || V.genre !== 'all' || V.show !== 'all';
  const clear = () => {
    const r = el('div', 'linkrow');
    r.style.justifyContent = 'center';
    r.appendChild(button('Clear the filters', 'ghost sm', () => { V.recency = 'any'; V.genre = 'all'; V.show = 'all'; draw('list'); }));
    host.appendChild(r);
  };
  const nothing = () => {
    host.appendChild(el('div', 'empty', esc(V.show === 'want' ? 'Nothing on your list yet.' : 'Nothing matches those filters.')));
    if (filters) clear();
  };

  /* By genre: a shelf per genre, most titles first, each in Top rated order */
  if (V.sort === 'genre') {
    const base = top.filter((f) => shown(f) && inWindow(f, V.recency));
    const shelves = genres.map((g) => [g, base.filter((f) => f.g.includes(g))]).filter(([, l]) => l.length).sort((a, b) => b[1].length - a[1].length);
    if (!shelves.length) { nothing(); return; }
    shelves.forEach(([g, l]) => {
      const d = divider(host, g, plural(l.length, noun[0], noun[1]));
      d.dataset.shelf = g;
      const r = rail(host);
      r.dataset.genre = g;
      l.slice(0, SHELF).forEach((f) => r.appendChild(tile(f, 'g:' + g + ':' + f.id)));
    });
    return;
  }

  const list = filtered();
  const count = el('p', 'note pad');
  count.dataset.count = String(list.length);
  count.textContent = filters ? plural(list.length, noun[0], noun[1]) : '';
  if (count.textContent) host.appendChild(count);
  if (!list.length) { nothing(); return; }
  const grid = el('div', 'grid3');
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(104px, 1fr))';
  grid.style.gap = 'var(--s4) var(--s3)';
  grid.dataset.grid = '1';
  list.slice(0, V.shown).forEach((f) => grid.appendChild(tile(f)));
  /* once "Show more" has opened it past the first page, the list gets the
     Collapse bar: back to the first page, and back up to the list's head */
  const wrap = el('div', 'expwrap');
  wrap.appendChild(grid);
  host.appendChild(wrap);
  const fold = () => {
    if (wrap.querySelector('.collapsebar')) return;
    wrap.appendChild(collapseBar('the list', () => {
      V.shown = PAGE;
      draw('list');
      app.jumpTo(root.querySelector('[data-sec="list"]'));
    }));
  };
  if (V.shown > PAGE) fold();
  if (list.length > V.shown) {
    const r = el('div', 'addrow');
    r.appendChild(button('Show ' + Math.min(PAGE, list.length - V.shown) + ' more', 'ghost', () => {
      const from = V.shown;
      V.shown += PAGE;
      list.slice(from, V.shown).forEach((f) => grid.appendChild(tile(f)));
      if (list.length <= V.shown) r.remove();
      else r.firstChild.textContent = 'Show ' + Math.min(PAGE, list.length - V.shown) + ' more';
      fold();
    }));
    grid.after(r);
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
    const len = f.kind === 'tv' ? [f.sn ? plural(f.sn, 'season', 'seasons') : '', f.rt ? runtime(f.rt) + ' episodes' : ''] : [f.rt ? runtime(f.rt) : ''];
    facts.innerHTML = '<p class="sheet-note">' + esc([f.y, ...len, f.g.join(', ')].filter(Boolean).join(' · ')) + '</p>' +
      (t ? '<p class="sheet-note" data-town>Town rating <b>' + esc(avg(t.sum, t.n).toFixed(1)) + '</b> from ' + esc(plural(t.n, 'rating', 'ratings')) + '</p>' : '') +
      (f.shelf === 'soon' && f.d ? '<p class="sheet-note">' + esc((f.where === 'streaming' ? 'Streaming from ' : 'In theaters from ') + dateLabel(f.d)) + '</p>' : '') +
      (f.shelf === 'now' ? '<p class="sheet-note">' + esc(nowLabel(f)) + '</p>' : '') +
      (f.shelf === 'air' ? '<p class="sheet-note">' + esc(airLabel(f)) + '</p>' : '');
    const tr = el('div', 'linkrow');
    if (hasTrailer(f)) {
      const b = button(ICON.play + ' Trailer', '', () => { close(); playTrailer(f); });
      b.dataset.trailer = '1';
      tr.appendChild(b);
    } else tr.appendChild(el('span', 'sheet-note', 'No trailer yet.'));
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
    put(body, credit(true));
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
  const msg = el('p', 'sheet-note', esc(mine ? '' : 'Posts under your first name.'));
  msg.dataset.msg = '1';
  msg.setAttribute('role', 'status');
  box.appendChild(msg);
}

function rate(f, stars, box, row) {
  const msg = box.querySelector('[data-msg]');
  const say = (t) => { msg.textContent = t; };
  if (!app.user()) {
    say('Sign in to rate.');
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
  const before = L.rated[f.id];
  boards.roundTwo().then((two) => {
    const meta = { stars, ...filmMeta(f, two) };
    if (where) meta.where = where;
    return boards.create('watch', { kind: 'rating', title: f.t.slice(0, RULES.limits.titleMax), body: '', meta });
  }).then((r) => {
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
  sec(host, 'Town ratings this week', null, 'town');
  if (P.state === 'loading') { host.appendChild(el('p', 'note pad', 'Counting…')); return; }
  if (P.state === 'off') { host.appendChild(el('p', 'note pad', 'Opening soon.')); return; }
  if (P.state === 'fail') { host.appendChild(el('p', 'note pad', 'Didn’t load.')); return; }
  const rows = [...P.agg.values()].filter((a) => a.wn >= MIN_RATINGS)
    .sort((a, b) => b.wn - a.wn || avg(b.wsum, b.wn) - avg(a.wsum, a.wn)).slice(0, TOWN_ROWS);
  if (!rows.length) {
    host.appendChild(el('p', 'note pad', 'No ratings this week yet.'));
    return;
  }
  rows.forEach((a) => {
    const f = a.f || { id: 0, k: '', kind: 'movie', t: a.title, y: a.year, g: [], o: '', rt: null, p: '', yt: '', art: 'paper' };
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
    const f = filmOf(p);
    const key = f ? 'f' + f.id : fkey(p.title, p.meta && p.meta.year);
    const cur = best.get(key);
    if (!cur || p.votes > cur.votes || (p.votes === cur.votes && p.created_at < cur.created_at)) best.set(key, { ...p, film: f });
  });
  return [...best.values()].sort((a, b) => b.votes - a.votes || a.created_at.localeCompare(b.created_at));
}
const screening = () => P.picks.filter((p) => p.meta && p.meta.where).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;

function drawVote(host) {
  sec(host, 'Vote for the next screening', null, 'vote');
  host.appendChild(hostLine());
  if (P.state === 'loading') { host.appendChild(el('p', 'note pad', 'Counting…')); return; }
  if (P.state === 'off') { host.appendChild(el('p', 'note pad', 'Opening soon.')); return; }
  if (P.state === 'fail') { host.appendChild(el('p', 'note pad', 'Didn’t load.')); return; }
  const card = el('div', 'textcard');
  card.dataset.ballot = '1';
  const picks = ballot();
  if (!picks.length) card.appendChild(el('p', null, 'Nothing on the ballot yet.'));
  picks.forEach((p) => card.appendChild(voteOpt(p)));
  const row = el('div', 'row');
  const sug = button(ICON.plus + ' Suggest a film', 'ghost sm', suggestSheet);
  sug.dataset.suggest = '1';
  row.appendChild(sug);
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
    /* one vote each. On round two the server moves the vote in one step
       (nn_vote's one_vote rule) and says which pick it left. Before that
       the old vote is taken back first, and if that fails the new one is
       not cast. */
    const first = (two) => (two || !other ? Promise.resolve(null) : boards.unvote(other.id).then((r) => {
      if (!r.ok) return r;
      const x = P.picks.find((y) => y.id === other.id);
      if (x) { x.votes = r.votes; x.voted = false; }
      return null;
    }));
    boards.roundTwo().then((two) => first(two)).then((bad) => bad || (p.voted ? boards.vote(p.id) : boards.unvote(p.id))).then((r) => {
      busy = false;
      if (!r.ok) { Object.assign(p, was); paint(); app.toast(r.message); return; }
      p.votes = r.votes; p.voted = r.voted;
      const x = P.picks.find((y) => y.id === p.id);
      if (x) { x.votes = r.votes; x.voted = r.voted; }
      /* the picks the server moved the vote off: the one shown here, or one
         cast on another device */
      const moved = r.moved || [];
      moved.forEach((id) => { const y = P.picks.find((z) => z.id === id); if (y && y.voted) { y.voted = false; y.votes = Math.max(0, y.votes - 1); } });
      if (other || moved.length) draw('vote'); else paint();
      app.toast(p.voted ? (p.votes >= GOAL ? 'Five! Steve will put it on Meetup.' : 'Voted for ' + p.title) : 'Vote taken back');
    });
  };
  o.addEventListener('click', go);
  o.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  return o;
}

function suggestSheet() {
  app.sheet('Suggest a film', (body, card, close) => {
    if (!app.user()) {
      body.appendChild(el('p', 'sheet-note', 'Sign in to suggest a film.'));
      const r = el('div', 'linkrow');
      r.appendChild(button('Sign in', '', () => app.openSettings()));
      body.appendChild(r);
      return;
    }
    body.appendChild(el('p', 'sheet-note', 'A suggestion is up for 30 days.'));
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
      const hits = [...F.top, ...F.trend, ...F.now].filter((f, i, all) => all.findIndex((x) => x.id === f.id) === i && (!s || norm(f.t).includes(s))).slice(0, 30);
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
  boards.roundTwo().then((two) => boards.create('watch', { kind: 'pick', title: f.t.slice(0, RULES.limits.titleMax), body: '', meta: filmMeta(f, two) })).then((r) => {
    if (!r.ok) {
      if (r.error === 'no_name') { askName(body, () => suggest(f, body, close)); app.toast(r.message); return; }
      app.toast(r.message);
      return;
    }
    close();
    app.toast('On the ballot');
    loadPosts();
  });
}

/* ---------------------------------------------------------------- chat */
function drawChat(host) {
  sec(host, 'Watch chat', null, 'chat');
  const row = el('div', 'linkrow');
  row.style.padding = '0 var(--gutter)';
  row.style.alignItems = 'center';
  const tg = el('a', 'btn', 'Talk ' + ICON.ext);
  tg.setAttribute('aria-label', 'Talk, in the Telegram watch chat');
  tg.href = safeHref(TELEGRAM_URL);
  tg.target = '_blank';
  tg.rel = 'noopener';
  tg.dataset.door = 'telegram';
  const ch = el('a', 'btn ghost sm', 'Community');
  ch.href = safeHref(CHAT_URL);
  ch.target = '_blank';
  ch.rel = 'noopener';
  ch.dataset.door = 'community';
  row.append(tg, ch);
  row.dataset.chat = '1';
  host.appendChild(row);
}

/* ------------------------------------------------------------ landing */
const TOC = () => [['theaters', 'Theaters'], ['soon', V.kind === 'tv' ? 'On TV now' : 'Coming soon'], ['back', 'Back then'], ['list', 'The list'],
  ['town', 'Town'], ['vote', 'Next screening'], ['chat', 'Chat']];

function land() {
  if (!pending || !ready) return;
  const k = pending;
  pending = null;
  /* #watch/tv and #watch/movies pick the kind */
  if (k === 'tv' || k === 'movies') { setKind(k === 'tv' ? 'tv' : 'movie'); app.scrollTop(); return; }
  const bm = /^back:(\d{4}-\d{2})$/.exec(k);
  /* the time machine and the theaters' times arrive after the list */
  if (!extras && (bm || k === 'back' || k === 'theaters')) { pending = k; return; }
  if (SECTIONS.includes(k)) { const s = root.querySelector('[data-sec="' + k + '"]'); if (s) { app.jumpTo(s); return; } }
  /* #watch/back:2021-10 opens the time machine on that month */
  if (bm) {
    if (tmMonths().some((m) => m.m === bm[1])) { V.month = bm[1]; draw('back'); }
    const s = root.querySelector('[data-sec="back"]');
    if (s) { app.jumpTo(s); return; }
  }
  const m = /^(f|tv)(\d+)$/.exec(k);
  if (m) {
    const id = m[1] === 'tv' ? TV_BASE + Number(m[2]) : Number(m[2]);
    /* a title only the time machine knows may not have arrived yet */
    if (!byId.has(id) && !extras) { pending = k; return; }
    const f = byId.get(id);
    if (f && f.kind !== V.kind) setKind(f.kind);
    let at = filtered().findIndex((x) => x.id === id);
    if (at < 0 && pool().some((x) => x.id === id)) { V.recency = 'any'; V.genre = 'all'; V.show = 'all'; if (V.sort === 'genre' || V.sort === 'shuffle') V.sort = 'top'; at = filtered().findIndex((x) => x.id === id); }
    if (at < 0 && pool().some((x) => x.id === id) && V.sort !== 'top') { V.sort = 'top'; at = filtered().findIndex((x) => x.id === id); }
    if (at >= 0) {
      if (at >= V.shown) V.shown = Math.ceil((at + 1) / PAGE) * PAGE;
      draw('list');
    } else if (f) {
      if (app.flashHit(root, 'soon:' + id)) return;
      filmSheet(f);
      return;
    }
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
    loadFilms().then((got) => {
      setFilms(got.films);
      if (!F.top.length) throw new Error('no films');
      L = loadLocal();
      V.kind = L.kind === 'tv' && hasTV() ? 'tv' : 'movie';
      ready = true;
      render();
      if (app.activeTab() === KEY) app.paintSubnav();
      land();
      loadExtras(got).then(() => {
        extras = true;
        V.month = defaultMonth();
        /* ratings counted before the time machine named its titles: count again */
        if (P.state === 'ok') { tally(); draw('town'); draw('vote'); }
        draw('theaters');
        draw('back');
        if (app.activeTab() === KEY) app.paintSubnav();
        land();
      });
      loadPosts().then(land);
      pullSeen();
    }).catch(() => {
      r.innerHTML = '<div class="errbox"><b>' + (app.demo ? 'The demo didn’t load.' : 'The film list didn’t load.') + '</b></div>';
    });
  },
  activate(param) { pending = param || null; land(); },
  refresh() { if (ready && root) render(); },
  deactivate() {},
  subnav() {
    if (!ready || !root) return null;
    const toc = TOC().filter(([key]) => root.querySelector('[data-sec="' + key + '"]')).map(([key, label]) => ({ key, label }));
    return chips(toc, null, (key) => app.jumpTo(root.querySelector('[data-sec="' + key + '"]')));
  },
  /* new picks for the screening vote since the reader last looked */
  newSince(ts) { return P.picks.filter((p) => (Date.parse(p.created_at) || 0) > ts * 1000 && !p.mine).length; },
  pull() { if (!ready) return null; loadPosts(); return 'Checking the town’s ratings and votes'; },
});
