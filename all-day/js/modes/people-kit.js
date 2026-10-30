/* people-kit.js — what the People app's six new tabs share (wave 1 of the
   eight apps, 2026-10-29). Not a mode: plans.js, clubs.js, dating.js,
   neighbors.js, pets.js and talk.js import it.

   The People mode (people.js) is hosted whole on You. Its sections draw
   inside one closure and export only their helpers (whenMs, whenLabel,
   isOwnEvent), so the other tabs are built on the same foundations it is:
   the boards (boards.js), the club week (clubs-week.js), the matchers
   (people-match.js), the calendar (wire.js's whatnow file) and the
   hand-checked Dating and Pets file. A row that belongs to You opens there
   (#people/<key>), so nothing is drawn twice with two behaviours.

   tab(o) is the whole mode contract around a list of sections, one per top
   tab: it draws each section's heading and body, gives the pill its items
   (freshest first when o.fresh), lands a deep link on a section or a card,
   and counts the tab's dot from the posts it was handed. A section is
     { key, label, world: 'irl' | 'online', draw(box), newest() }
   draw() redraws the section's body; newest() is the epoch seconds of its
   newest thing, or 0. o.load() fetches what the tab needs (and in the demo
   seeds the demo board first), resolving when the sections can draw. */

import * as app from '../app.js';
import * as data from '../wire.js';
import * as boards from '../boards.js';
import { el, esc, safeHref, ICON, mark, section, button, cards } from '../ui.js';
import { sectionBar } from '../sections.js';
import { RULES, KIND_LABELS, expiresAt, photoRequired } from '../boards-core.js';
import { whenLabel, et, etWall } from './people.js';

const HOUR = 3600000;
export const DAY = 86400000;
export const MEETUP_GROUP = 'https://www.meetup.com/burlington-social-activites-group/';
export const DP_URL = '../data/dating-pets.json';
export const GROUPS_URL = '../data/groups.json';
export const RUN_CLUBS_URL = '../data/run-clubs.json';
export const CLUBS_PAGE = '../clubs.html';
export const TELEGRAM_PAGE = '../telegram.html';
export const nowSec = () => Math.floor(Date.now() / 1000);

/* ------------------------------------------------------------- the tab */
export function tab(o) {
  const S = { root: null, slots: null, pending: null, ready: false, posts: [] };
  const secs = o.sections;

  function draw() {
    if (!S.root) return;
    if (!S.slots) {
      S.root.innerHTML = '';
      S.slots = Object.create(null);
      const wrap = el('div', 'pp-tab');
      wrap.dataset.pp = o.key;
      secs.forEach((s) => {
        const box = el('section', 'shelf-sec pp-sec');
        box.dataset.sec = s.key;
        if (s.world) box.dataset.world = s.world;
        section(box, s.label, s.sub || null);
        const body = el('div', 'pp-body');
        box.appendChild(body);
        wrap.appendChild(box);
        S.slots[s.key] = box;
      });
      S.root.appendChild(wrap);
      S.root.appendChild(el('div', 'spacer'));
      app.bindFeed(wrap);
    }
    secs.forEach((s) => {
      const body = S.slots[s.key].querySelector('.pp-body');
      body.innerHTML = '';
      if (!S.ready) { body.appendChild(el('p', 'loading', 'One moment…')); return; }
      try { s.draw(body); } catch (e) { console.error('[people] ' + o.key + '/' + s.key, e); body.appendChild(el('p', 'note pad', 'This part didn’t load.')); }
    });
    if (app.activeTab() === o.key) app.paintSubnav();
  }

  function land() {
    const want = S.pending;
    if (!want || !S.ready || !S.slots) return;
    S.pending = null;
    if (S.slots[want]) { app.jumpTo(S.slots[want]); return; }
    if (o.land && o.land(want, S.slots)) return;
    if (!app.flashHit(S.root, want)) app.toast('That’s gone from ' + app.labelOf(o.key) + ' now.');
  }

  let loading = null;
  function load() {
    if (!loading) loading = Promise.resolve().then(o.load).catch((e) => console.error('[people] ' + o.key + ' load', e))
      .then(() => { S.ready = true; draw(); land(); app.recount(); });
    return loading;
  }
  /* the dot is honest from the first paint, so the tab loads before it is opened */
  setTimeout(load, 0);

  /* a board changed (a post, a vote, a delete): reload the boards this tab reads */
  window.addEventListener('allday-boards', (e) => {
    const b = e && e.detail && e.detail.board;
    if (!S.root || !o.boards || (b && !o.boards.includes(b))) return;
    Promise.resolve(o.reload && o.reload()).then(draw);
  });

  return {
    label: o.label,
    icon: ICON[o.icon] || ICON.people,
    promise: o.promise,
    mixed: !!o.mixed,
    mount(root) { S.root = root; S.slots = null; draw(); load(); },
    activate(param) { S.pending = param || null; land(); },
    refresh() { if (S.slots) draw(); },
    deactivate() {},
    subnav() {
      if (!S.slots) return null;
      return sectionBar({ key: 'sec-people-' + o.key, title: app.labelOf(o.key), color: '--app-people-pop', fresh: !!o.fresh,
        find: (k) => S.slots && S.slots[k], onPick: (k) => app.jumpTo(S.slots && S.slots[k]),
        items: secs.map((s) => ({ key: s.key, label: s.label, world: s.world || undefined, newest: s.newest ? s.newest() : 0 })) });
    },
    keepSubnav: true,
    newSince(ts) { return o.count ? o.count(Number(ts) || nowSec() - 4 * 3600) : 0; },
    redraw: draw,
  };
}

/* ------------------------------------------------------------- boards */
/* the board's posts, or [] with the reason kept (off: the SQL is not pasted) */
export function listBoard(board, opts = {}) {
  return boards.list(board, { limit: 60, ...opts }).then((r) => (r.ok ? { ok: true, posts: r.posts } : { ok: false, posts: [], error: r.error, message: r.message }));
}
/* posts newer than ts (epoch seconds) */
export const newer = (posts, ts) => posts.filter((p) => Date.parse(p.created_at) / 1000 > ts).length;
export const newest = (posts) => posts.reduce((m, p) => Math.max(m, Math.floor((Date.parse(p.created_at) || 0) / 1000)), 0);

/* A board's cards in a feed, each with its kind's word ahead of its own
   meta line; opts.map adds a Map pill under a post that names a place
   (Lost & found). */
export function feed(host, posts, opts = {}) {
  const f = el('div', 'feed');
  const items = boards.draw(f, posts, { tab: opts.tab, meta: opts.meta });
  items.forEach((it) => {
    const card = f.querySelector('.card[data-k="' + CSS.escape(it.k) + '"]');
    if (!card) return;
    /* a plan ends when it happens: its `when` says so, not a countdown */
    if (opts.noLeft) { const l = card.querySelector('.tag-left'); if (l) l.remove(); }
    /* the vote in the tab's words (I'd go, I'm in, Me too), its count kept */
    const v = opts.vote && card.querySelector('[data-act="bvote"]');
    if (v) { v.setAttribute('aria-label', opts.vote); v.insertBefore(el('span', 'pp-vote', esc(opts.vote)), v.querySelector('.n')); }
  });
  if (opts.map) items.forEach((it) => {
    if (!it.place) return;
    const card = f.querySelector('.card[data-k="' + CSS.escape(it.k) + '"] .c-body');
    if (card) card.appendChild(mapPill(it.place));
  });
  if (opts.after) items.forEach((it, i) => {
    const card = f.querySelector('.card[data-k="' + CSS.escape(it.k) + '"]');
    const add = card && opts.after(posts[i], it);
    if (add) card.appendChild(add);
  });
  host.appendChild(f);
  return items;
}
/* a place on the map, by its words (Burlington, VT appended) */
export function mapPill(place, lat, lng) {
  const a = el('a', 'pillbtn map', ICON.pin + ' Map');
  a.href = safeHref(lat != null && lng != null ? 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng
    : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place + ', Burlington, VT'));
  a.target = '_blank';
  a.rel = 'noopener';
  a.setAttribute('aria-label', 'Map: ' + place);
  a.dataset.map = '1';
  const r = el('div', 'linkrow pp-map');
  r.appendChild(a);
  return r;
}

/* When a board's posts didn't come: why, in a line */
export function boardNote(host, r, empty) {
  if (r && r.ok === false) {
    host.appendChild(el('p', 'note pad', r.error === 'off' ? 'This board opens once Stephen switches it on.' : (r.message || 'The posts didn’t load.')));
    return;
  }
  host.appendChild(el('p', 'note pad', empty));
}

/* the board's house rules, short */
export function rules(host, lines) {
  const p = el('p', 'note pad pp-rules', '<b>The rules.</b> ' + lines.map(esc).join(' '));
  host.appendChild(p);
}

/* a bright Post button that opens boards.compose */
export function postButton(label, opts, onPosted) {
  const b = button(ICON.plus + ' ' + esc(label), 'pkey', () => boards.compose({ ...opts, onPosted: (p) => { if (onPosted) onPosted(p); } }));
  b.type = 'button';
  b.dataset.post = opts.board + ':' + opts.kind;
  const r = el('div', 'addrow');
  r.appendChild(b);
  return r;
}

/* A kind's word and its own fields, for a card's meta line */
export const kindWord = (k) => KIND_LABELS[k] || k;

/* ------------------------------------------------------- the demo board */
/* Demo posts onto the in-memory board (boards-fake.js), once per file:
   each { who, board, kind, title, body, place, meta, ago (hours), votes,
   on: [days from today, hour, minute] (a plan's `when`, in words), day
   and at (days from today and '9 am': a shift's `when`, date first) }. They go in approved, as Stephen would leave them. */
const seeded = new Set();
const DEMO_FOLK = [
  ['demo-0000-4000-8000-0000000pp001', 'Nadia F.', 'old-north-end', 'new'],
  ['demo-0000-4000-8000-0000000pp002', 'Theo B.', 'south-end', 'regular'],
  ['demo-0000-4000-8000-0000000pp003', 'Rosa G.', 'hill', 'trail'],
  ['demo-0000-4000-8000-0000000pp004', 'Marcus D.', 'winooski', 'games'],
  ['demo-0000-4000-8000-0000000pp005', 'June K.', 'new-north-end', null],
  ['demo-0000-4000-8000-0000000pp006', 'Eli W.', 'downtown', 'regular'],
];
let nextId = 0;
const ETD = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export const etDay = (ms) => ETD.format(new Date(ms));
export function seed(name, posts) {
  const f = boards._fake();
  if (!f || seeded.has(name)) return;
  seeded.add(name);
  const t = f.now();
  DEMO_FOLK.forEach(([id, n, hood, arch]) => { if (!f.profiles.has(id)) f.profiles.set(id, { display_name: n, neighborhood: hood, archetype: arch, interests: [] }); });
  (posts || []).forEach((o) => {
    const created = t - (Number(o.ago) || 1) * HOUR;
    const meta = { ...(o.meta || {}) };
    if (o.on) { const x = et(t + Number(o.on[0]) * DAY); meta.when = whenLabel(etWall(x.y, x.mo, x.d, Number(o.on[1]) || 0, Number(o.on[2]) || 0)); }
    if (o.day != null) meta.when = etDay(t + Number(o.day) * DAY) + (o.at ? ', ' + o.at : '');
    if (o.photo) f.addPhoto(o.photo, 'approved');
    const id = '00000000-0000-4000-8000-' + String(++nextId + 700000).padStart(12, '0');
    f.posts.push({
      id, board: o.board, user_id: DEMO_FOLK[(Number(o.who) || 0) % DEMO_FOLK.length][0], kind: o.kind, title: o.title, body: o.body || '',
      photo_path: o.photo || null, photo_req: photoRequired(RULES, o.board, o.kind), meta, place: o.place || '',
      expires_at: expiresAt(RULES, o.board, o.kind, created, meta), status: 'approved', reports: 0, created_at: created, decided_at: null,
    });
    for (let i = 0; i < (Number(o.votes) || 0); i++) f.votes.add(id + '|p_pp' + String(i).padStart(4, '0'));
  });
}

/* ------------------------------------------------------ the calendar */
/* The guide's events (wire.js's whatnow file, rebuilt daily) live; on
   ?demo=1, the tab's own demo events dated `day` days from today. */
export function events(demoEvents) {
  if (app.demo) {
    const t = Date.now();
    return Promise.resolve((demoEvents || []).map((e) => {
      const date = etDay(t + (Number(e.day) || 0) * DAY);
      return { ...e, date, start: e.time ? date + 'T' + e.time + ':00' + offset(date) : date, allDay: !e.time };
    }));
  }
  return new Promise((res) => data.load('whatnow', (j) => res((j && j.events) || []), () => res(null)));
}
/* Burlington's UTC offset on that day, as -04:00 or -05:00 */
function offset(date) {
  const noon = Date.parse(date + 'T12:00:00Z');
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(noon)));
  return '-' + String(12 - h).padStart(2, '0') + ':00';
}
const EV_DOW = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' });
const EV_DOM = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', day: 'numeric' });
const EV_TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
/* calendar events that pass keep(), from now to `days` ahead, soonest
   first, one per title a day, as event cards (prefix keys them) */
export function eventItems(list, keep, prefix, days = 14) {
  const now = Date.now(), seen = new Set(), out = [];
  (list || []).forEach((e) => {
    if (!e || !e.title || !/^https?:/i.test(String(e.url || '')) || !e.date || !keep(e)) return;
    const allDay = !!e.allDay || !/T\d/.test(String(e.start || ''));
    const at = allDay ? Date.parse(e.date + 'T12:00:00' + offset(e.date)) : Date.parse(e.start);
    if (!at || at < now - (allDay ? 12 : 2) * HOUR || at > now + days * DAY) return;
    const k = e.date + '|' + String(e.title).toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    const d = new Date(at);
    out.push({ k: prefix + String(e.id || e.date + '-' + out.length), kind: 'event', title: String(e.title), href: e.url, at,
      src: e.venue || 'The calendar', dow: EV_DOW.format(d), dom: EV_DOM.format(d),
      when: allDay ? 'All day' : EV_TIME.format(d), where: [e.venue, e.town].filter(Boolean).join(', ') || 'Burlington', price: e.price || (e.free ? 'Free' : 'See the page') });
  });
  return out.sort((a, b) => a.at - b.at);
}
export function eventList(host, items, empty) {
  if (!items.length) { host.appendChild(el('p', 'note pad', empty)); return; }
  const f = el('div', 'feed');
  app.know(items);
  items.forEach((it) => { const n = cards.event(it); if (n) f.appendChild(n); });
  host.appendChild(f);
}

/* ------------------------------------------------------------ rows */
/* a link out, as one row: a mark, a name, one line */
export function outRow(name, line, href, key) {
  const ext = /^https?:/.test(href);
  const a = el('a', 'lrow', mark(name, 'round lg') + '<div><div class="t">' + esc(name) + '</div>' + (line ? '<div class="s">' + esc(line) + '</div>' : '') + '</div>' + (ext ? ICON.ext : ICON.right));
  a.href = safeHref(href);
  if (ext) { a.target = '_blank'; a.rel = 'noopener'; }
  if (key) a.dataset.k = key;
  return a;
}
export function rowList(host, rows) {
  const g = el('div', 'dplist');
  rows.forEach((r) => { if (r) g.appendChild(r); });
  host.appendChild(g);
  return g;
}
/* a short card of words with buttons under it */
export function textCard(host, title, words, buttons, key) {
  const tc = el('div', 'textcard', (title ? '<h3 class="serif">' + esc(title) + '</h3>' : '') + words.map((w) => '<p>' + esc(w) + '</p>').join(''));
  if (key) tc.dataset.card = key;
  if (buttons && buttons.length) {
    const r = el('div', 'row');
    buttons.forEach((b) => r.appendChild(b));
    tc.appendChild(r);
  }
  host.appendChild(tc);
  return tc;
}
export function linkBtn(label, href, cls) {
  const a = el('a', 'btn' + (cls ? ' ' + cls : ''), esc(label));
  a.href = safeHref(href);
  if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
  return a;
}
/* what is coming to a part of a tab that is not built yet, in plain words */
export function soon(host, title, words, key) {
  const tc = textCard(host, title, words, null, key);
  tc.classList.add('pp-soon');
  tc.appendChild(el('span', 'soon', 'Coming soon'));
  return tc;
}

/* the hand-checked Dating and Pets file */
let dp = null;
export function datingPets() {
  if (!dp) dp = data.fetchJSON(DP_URL, 8000).then((j) => (j && j.dating && j.pets ? j : null), () => null);
  return dp;
}
export function json(url) { return data.fetchJSON(url, 8000).then((j) => j, () => null); }
