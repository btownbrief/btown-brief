/* rank.js — Food's Rank section, Rank What You Know brought into the tab.
   Not a tab of its own: food.js gives it a slot and a pill segment and calls
   load, paint, open and revisit.

   One block per food list (data/rank-lists.json), every list open at once.
   The keys are Rank What You Know's month keys, so the arcade's ballots
   count here and the other way round; new lists are keyed 2030-xx. A block
   is the title, its ballots and how long since the last one, the top three
   (results only, never a voter's name), or how many more ballots until it
   has a first place. Freshest first by rank_activity: the list anyone
   ranked last leads, lists with no ballots after, six showing, then See more.

   Rank it opens a sheet: check the places you've been, put them in order
   (drag the handle, or the up and down buttons), Save. It answers with your
   % match with Burlington and the whole community list; a name Food has a
   card for opens that card. When the sheet
   closes, the block rises to the top, and the tab scrolls there. Your
   ballot stays on this phone (rwyk-ballot-<key>, the arcade's own key) and
   prefills the next time; Edit reopens it. #food/rank-<key> lands on a block
   and opens it: on the community list if it has one or you've ranked it, so
   a shared link shows what was shared, on the checklist if not.

   Who you are is the arcade's btown-player-id and btown-player-token.
   submit_ballot wants a UUID and All Day mints p_xxxx ids (store.playerId),
   which votes elsewhere are keyed to, so a phone holding one of those ranks
   under a UUID of its own, kept beside it.

   With Supabase down the lists still show and Save says so and keeps
   nothing. ?demo=1 reads data/demo/food.json's `rank` and sends nothing. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import { el, esc, svg, ICON, section, moreGrid, button, agoShort } from '../ui.js';
import { MIN_BALLOTS, chartOf, pendingOf, needsMore, orderLists, cleanBallot, startOrder, matchPercent } from '../rank-core.js';

const KEY = 'food';
const LISTS_URL = '../data/rank-lists.json';
const CALL_MS = 8000;                 // a Supabase call gives up after this
const STALE_MS = 5 * 60000;           // the blocks are fetched again on the way back in after this
const RISE_MS = 460;
const CLEAR_TOP = 120;                // the floating mast and pill cover this much of the screen
const CLEAR_FOOT = 90;                // and the dock this much
const EDGE = 56;                      // a drag this near the sheet's edge scrolls it
const EDGE_STEP = 7;
const ID_KEY = 'btown-player-id';
const UUID_KEY = 'btown-player-uuid';
const TOKEN_KEY = 'btown-player-token';
const NAME_KEY = 'btown-player-name';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRIP = svg('<path d="M5 8h14M5 12h14M5 16h14"/>');
const DOWN = svg('<path d="M12 5v14M5.5 12.5 12 19l6.5-6.5"/>');   // ICON.up turned over; ICON.down is a chevron

const WORDS = {
  head: 'Ranked by Burlington',
  loading: 'Counting the ballots…',
  lists: (n) => n + (n === 1 ? ' list' : ' lists'),
  freshest: 'latest ballot first',
  places: (n) => n + (n === 1 ? ' place' : ' places'),
  ballots: (n) => n + (n === 1 ? ' ballot' : ' ballots'),
  needs: (n) => 'Needs ' + n + ' more',
  rankIt: 'Rank it',
  edit: 'Edit',
  share: 'Share',
  back: 'Back',
  save: 'Save',
  saving: 'Saving…',
  next: 'Next',
  rankYour: (n) => 'Rank your ' + n,
  been: 'Where you’ve been',
  order: 'Your order',
  moveUp: (n) => 'Move ' + n + ' up',
  moveDown: (n) => 'Move ' + n + ' down',
  match: (p) => p + '% match',
  withTown: 'with Burlington',
  town: 'Burlington’s list',
  you: (n) => 'You: ' + n,
  pending: 'Needs more ballots',
  count: (n) => n + ' of ' + MIN_BALLOTS,
  shareTitle: (t) => t + ', ranked by Burlington',
  src: 'Burlington Brief',
  down: 'Couldn’t save. Try again in a minute.',
  noList: 'Didn’t load. Try again later.',
  demo: 'Demo: nothing was sent.',
  label: 'the rankings',
};
const blurb = (p) => (p >= 90 ? 'You basically are Burlington.' : p >= 75 ? 'Strongly with the town.'
  : p >= 55 ? 'Mostly with the crowd, a few hot takes.' : p >= 35 ? 'A contrarian streak. Respect.' : 'You are at war with this town.');

/* ------------------------------------------------------------------ state */
const S = {
  lists: null,                        // null until data/rank-lists.json lands
  activity: Object.create(null),      // list key -> { ballots, last_at }
  rows: Object.create(null),          // list key -> get_rankings' rows
  settled: false, down: false, at: 0, loading: null,
};
const memory = new Map();             // ballots while storage is blocked, and always in the demo
let H = { paint() {}, jump() {}, slot: () => null, place: () => null, openPlace() {} };
/* food.js hands over how to repaint its slot, jump to it and open a place */
export function bind(hooks) { H = { ...H, ...hooks }; }

const blockKey = (l) => 'rank-' + l.key;
const ballotKey = (l) => 'rwyk-ballot-' + l.key;
const firstStep = (l) => (mineOf(l).length || chartOf(S.rows[l.key], l).length ? 'result' : 'check');
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const settled = () => S.settled;
export const hasLists = () => !!(S.lists && S.lists.length);

/* ---------------------------------------------------------------- backend */
/* store.rpc swallows failures, and Save has to know, so these calls are
   their own */
async function call(fn, args) {
  const stop = new AbortController();
  const t = setTimeout(() => stop.abort(), CALL_MS);
  try {
    const r = await fetch(store.SB_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST', signal: stop.signal,
      headers: { apikey: store.SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
    });
    if (!r.ok) throw new Error(fn + ' ' + r.status);
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  } finally { clearTimeout(t); }
}

function stored(key, make) {
  let v = null;
  try { v = localStorage.getItem(key); } catch (e) { /* storage blocked */ }
  if (v) return v;
  v = memory.get(key) || make();
  memory.set(key, v);
  try { localStorage.setItem(key, v); } catch (e) { /* kept for the visit */ }
  return v;
}
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
function mintUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = hex(b);
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-');
}
const ballotId = () => { const id = stored(ID_KEY, mintUuid); return UUID_RE.test(id) ? id : stored(UUID_KEY, mintUuid); };
const ballotToken = () => stored(TOKEN_KEY, () => hex(crypto.getRandomValues(new Uint8Array(16))));
function playerName() {
  try { return localStorage.getItem(NAME_KEY) || 'Ranker'; } catch (e) { return 'Ranker'; }
}

function mineOf(l) {
  let v = memory.get(ballotKey(l));
  if (!v && !app.demo) {
    try { v = JSON.parse(localStorage.getItem(ballotKey(l))); } catch (e) { /* none */ }
  }
  return cleanBallot(v, l);
}
function keepMine(l, ballot) {
  memory.set(ballotKey(l), ballot);
  if (app.demo) return;
  try { localStorage.setItem(ballotKey(l), JSON.stringify(ballot)); } catch (e) { /* kept for the visit */ }
}

function takeActivity(rows) {
  if (!Array.isArray(rows)) return;
  S.activity = Object.create(null);
  rows.forEach((r) => { if (r && r.category_month) S.activity[r.category_month] = { ballots: Number(r.ballots) || 0, last_at: r.last_at }; });
}
const fetchRows = (l) => call('get_rankings', { p_month: l.key }).then((rows) => { if (Array.isArray(rows)) S.rows[l.key] = rows; });

/* the activity, then each list that has ballots, all one paint */
function fetchBlocks() {
  S.at = Date.now();
  return call('rank_activity').then((rows) => { takeActivity(rows); S.down = false; }).catch(() => { S.down = true; })
    .then(() => Promise.all((S.lists || []).filter((l) => S.activity[l.key]).map((l) => fetchRows(l).catch(() => {}))));
}

function takeLists(j) {
  S.lists = (j && Array.isArray(j.lists) ? j.lists : [])
    .filter((l) => l && /^\d{4}-\d{2}$/.test(l.key) && l.title && Array.isArray(l.items) && l.items.length);
}

/* The demo file carries its lists, and hours since each list's last ballot,
   so the block times stay true on the reader's clock. */
function takeDemo(d) {
  const r = (d && d.rank) || {};
  takeLists(r);
  Object.keys(r.activity || {}).forEach((k) => {
    const a = r.activity[k];
    S.activity[k] = { ballots: a.ballots, last_at: new Date(Date.now() - a.hours_ago * 3600000).toISOString() };
  });
  S.rows = { ...S.rows, ...(r.rankings || {}) };
}

export function load(demoFile) {
  if (!S.loading) {
    S.loading = (app.demo ? demoFile().then(takeDemo)
      : data.fetchJSON(LISTS_URL, 8000).then(takeLists).catch(() => takeLists(null)).then(fetchBlocks))
      .catch(() => { if (!S.lists) S.lists = []; })
      .then(() => { S.settled = true; });
  }
  return S.loading;
}

/* the way back into the tab: other people may have ranked, and a list file
   that failed gets another try, since a phone can keep the app open for days */
export function revisit() {
  if (app.demo || !S.settled || Date.now() - S.at < STALE_MS) return;
  if (!hasLists()) S.loading = null;
  (hasLists() ? fetchBlocks() : load()).then(() => { if (!document.querySelector('.ranksheet')) H.paint(); });
}

/* ----------------------------------------------------------------- blocks */
export function paint(host) {
  if (!S.settled) {
    section(host, WORDS.head);
    host.appendChild(el('p', 'loading', esc(WORDS.loading)));
    return;
  }
  if (!hasLists()) return;
  const head = section(host, WORDS.head, '<b>' + esc(WORDS.lists(S.lists.length)) + '</b> · ' + esc(WORDS.freshest));
  moreGrid(host, { name: 'food-rank', label: WORDS.label, head, cells: orderLists(S.lists, S.activity).map(block) }).classList.add('rankgrid');
}

/* a name on a chart: the place's own card, when Food has one */
function placeName(host, name) {
  const r = H.place(name);
  if (!r) return;
  const b = el('button', 't rb-place', esc(name));
  b.type = 'button';
  b.addEventListener('click', () => H.openPlace(r));
  host.querySelector('.t').replaceWith(b);
}

const itemOf = (l) => ({ k: blockKey(l), kind: 'headline', href: '#' + KEY + '/' + blockKey(l), title: WORDS.shareTitle(l.title), src: WORDS.src });

function block(l) {
  const a = S.activity[l.key], rows = S.rows[l.key], chart = chartOf(rows, l), mine = mineOf(l);
  const c = el('article', 'rankblk');
  c.dataset.k = blockKey(l);
  const it = itemOf(l);
  const saved = store.isSaved(it.k);

  const top = el('div', 'rb-head');
  const name = el('button', 'rb-title', esc(l.title));
  name.type = 'button';
  name.addEventListener('click', () => openSheet(l, firstStep(l)));
  const share = el('button', 'act sh', ICON.share);
  share.type = 'button';
  share.setAttribute('aria-label', WORDS.share + ' ' + l.title);
  share.addEventListener('click', () => app.share(KEY, it.k, it.title));
  const star = el('button', 'act star' + (saved ? ' on' : ''), ICON.star);
  star.type = 'button';
  star.setAttribute('aria-label', 'Save');
  star.setAttribute('aria-pressed', String(saved));
  star.addEventListener('click', () => app.toggleSave(it));
  top.append(name, share, star);
  c.appendChild(top);

  c.appendChild(el('p', 'rb-meta', esc(a && a.ballots ? WORDS.ballots(a.ballots) + ' · ' + agoShort(Date.parse(a.last_at) / 1000) : WORDS.places(l.items.length))));

  if (chart.length) {
    const ol = el('ol', 'rb-top');
    chart.slice(0, 3).forEach((r, i) => {
      const li = el('li', '', '<span class="n">' + (i + 1) + '</span><span class="t">' + esc(r.item) + '</span>');
      placeName(li, r.item);
      ol.appendChild(li);
    });
    c.appendChild(ol);
  }

  const foot = el('div', 'rb-foot');
  const m = mine.length ? matchPercent(mine, chart.map((r) => r.item)) : null;
  /* a ballot count we couldn't read is not a list that needs ballots */
  const known = !S.down && (!a || rows);
  if (m != null) foot.appendChild(el('span', 'rb-match', esc(WORDS.match(m))));
  else if (!chart.length && known) foot.appendChild(el('span', 'rb-need', esc(WORDS.needs(needsMore(rows, l)))));
  foot.appendChild(mine.length ? button(esc(WORDS.edit), 'ghost sm', () => openSheet(l, 'check')) : button(esc(WORDS.rankIt), 'sm', () => openSheet(l, 'check')));
  c.appendChild(foot);
  return c;
}

/* #food/rank-<key>: land on the block and open it */
export function open(k) {
  const l = (S.lists || []).find((x) => blockKey(x) === k);
  if (!l) return false;
  app.flashHit(H.slot(), k);
  openSheet(l, firstStep(l));
  return true;
}

/* A saved block climbs from where it was and the rest make room. It runs
   when the sheet closes, because until then the sheet is in the way. */
function rise(l) {
  const host = H.slot();
  if (!host) return;
  const k = blockKey(l);
  const blocks = () => [...host.querySelectorAll('.rankblk:not([hidden])')];
  const was = new Map(blocks().map((n) => [n.dataset.k, n.getBoundingClientRect().top]));
  H.paint();
  const hit = blocks().find((n) => n.dataset.k === k);
  if (!hit) return;
  /* measured before the climb starts: mid-climb it reads as where it was */
  const r = hit.getBoundingClientRect();
  const away = r.top < CLEAR_TOP || r.bottom > window.innerHeight - CLEAR_FOOT;
  if (!reduced()) {
    blocks().forEach((n) => {
      const top = n.getBoundingClientRect().top;
      const dy = (was.has(n.dataset.k) ? was.get(n.dataset.k) : top + (n === hit ? 80 : 0)) - top;
      if (dy) n.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'translateY(0)' }], { duration: RISE_MS, easing: 'cubic-bezier(.2,.9,.3,1)' });
    });
  }
  app.flashHit(host, k, true);
  if (away) H.jump();
  /* the repaint took the button focus went back to */
  if (document.getElementById('sheet').hidden) hit.querySelector('.rb-foot .btn').focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ sheet */
function openSheet(l, step) {
  app.sheet(l.title, (body, card) => {
    card.classList.add('ranksheet');
    const foot = el('div', 'rs-foot');
    card.appendChild(foot);
    const V = { l, body, card, foot, checked: new Set(mineOf(l)), order: [], rose: false };
    (step === 'result' ? drawResult : drawCheck)(V);
    /* the shell's sheet has no close hook: watch for the card leaving */
    const watch = new MutationObserver(() => {
      if (card.isConnected) return;
      watch.disconnect();
      if (V.rose) rise(l);
    });
    watch.observe(card.parentNode, { childList: true });
  });
}

function reset(V, heading) {
  V.body.innerHTML = '';
  V.body.scrollTop = 0;
  V.foot.innerHTML = '';
  if (heading) V.body.appendChild(el('div', 'sheet-h', esc(heading)));
}

function drawCheck(V) {
  reset(V, WORDS.been);
  const next = button('', '', () => drawOrder(V));
  next.type = 'button';
  const count = () => {
    const n = V.checked.size;
    next.disabled = !n;
    next.textContent = n ? WORDS.rankYour(n) : WORDS.next;
  };
  const list = el('div', 'rs-list');
  V.l.items.forEach((it) => {
    const on = V.checked.has(it.name);
    const b = el('button', 'rs-check' + (on ? ' on' : ''), '<span class="box">' + ICON.check + '</span><span class="w"><span class="t">' + esc(it.name) + '</span><span class="d">' + esc(it.where || '') + '</span></span>');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', () => {
      const now = !V.checked.has(it.name);
      if (now) V.checked.add(it.name); else V.checked.delete(it.name);
      b.classList.toggle('on', now);
      b.setAttribute('aria-pressed', String(now));
      count();
    });
    list.appendChild(b);
  });
  V.body.appendChild(list);
  count();
  V.foot.appendChild(next);
}

function drawOrder(V) {
  reset(V, WORDS.order);
  V.order = startOrder(V.checked, V.l, V.order.length ? V.order : mineOf(V.l));
  const list = el('div', 'rs-list rs-order');
  const sync = () => {
    V.order = [...list.children].map((r) => r.dataset.name);
    [...list.children].forEach((r, i) => {
      r.querySelector('.rs-num').textContent = i + 1;
      r.querySelector('[data-move="up"]').disabled = i === 0;
      r.querySelector('[data-move="down"]').disabled = i === list.children.length - 1;
    });
  };
  V.order.forEach((name) => {
    const it = V.l.items.find((x) => x.name === name);
    const r = el('div', 'rs-row', '<span class="rs-num"></span><span class="w"><span class="t">' + esc(name) + '</span><span class="d">' + esc((it && it.where) || '') + '</span></span>' +
      '<button type="button" class="iconbtn" data-move="up" aria-label="' + esc(WORDS.moveUp(name)) + '">' + ICON.up + '</button>' +
      '<button type="button" class="iconbtn" data-move="down" aria-label="' + esc(WORDS.moveDown(name)) + '">' + DOWN + '</button>' +
      '<span class="rs-handle" aria-hidden="true">' + GRIP + '</span>');
    r.dataset.name = name;
    list.appendChild(r);
  });
  V.body.appendChild(list);
  sortable(list, V.body, sync);
  sync();
  const back = button(esc(WORDS.back), 'ghost', () => drawCheck(V));
  back.type = 'button';
  const save = button(esc(WORDS.save), '', () => saveBallot(V, save, back));
  save.type = 'button';
  V.foot.append(back, save);
}

async function saveBallot(V, btn, back) {
  const l = V.l;
  /* the order is what's being sent: nothing moves or goes Back until it lands */
  const hold = (on) => {
    btn.disabled = back.disabled = V.body.inert = on;
    btn.textContent = on ? WORDS.saving : WORDS.save;
  };
  hold(true);
  const had = mineOf(l).length > 0;
  if (app.demo) app.toast(WORDS.demo);
  else {
    try {
      await call('submit_ballot', { p_month: l.key, p_player: ballotId(), p_token: ballotToken(), p_name: playerName(), p_ranking: V.order });
    } catch (e) {
      hold(false);
      app.toast(WORDS.down);
      return;
    }
    await fetchRows(l).catch(() => {});
  }
  hold(false);
  keepMine(l, V.order.slice());
  const a = S.activity[l.key];
  S.activity[l.key] = { ballots: ((a && a.ballots) || 0) + (had ? 0 : 1), last_at: new Date().toISOString() };
  V.rose = true;
  if (V.card.isConnected) drawResult(V); else rise(l);   // closed while it saved
}

async function drawResult(V) {
  const l = V.l;
  reset(V);
  if (!S.rows[l.key] && !app.demo) {
    V.body.appendChild(el('p', 'loading', esc(WORDS.loading)));
    await fetchRows(l).catch(() => {});
    reset(V);
  }
  const rows = S.rows[l.key], mine = mineOf(l), chart = chartOf(rows, l), wait = pendingOf(rows, l);
  const m = matchPercent(mine, chart.map((r) => r.item));
  if (m != null) {
    const card = el('div', 'rs-score', '<span class="pct">' + esc(m + '%') + '</span><span class="w"><span class="t">' + esc(WORDS.withTown) + '</span><span class="d">' + esc(blurb(m)) + '</span></span>');
    V.body.appendChild(card);
  }
  V.body.appendChild(el('div', 'sheet-h', esc(WORDS.town)));
  if (!rows && !chart.length) V.body.appendChild(el('p', 'sheet-note', esc(WORDS.noList)));
  else if (!chart.length) V.body.appendChild(el('p', 'rb-need', esc(WORDS.needs(needsMore(rows, l)))));
  chart.forEach((r, i) => {
    const at = mine.indexOf(r.item);
    const row = el('div', 'rs-bar', '<span class="rs-num">' + (i + 1) + '</span><span class="w"><span class="t">' + esc(r.item) + '</span>' +
      '<span class="track"><i style="width:' + Math.round(r.score * 100) + '%"></i></span></span>' +
      (at >= 0 ? '<span class="you">' + esc(WORDS.you(at + 1)) + '</span>' : ''));
    placeName(row, r.item);
    V.body.appendChild(row);
  });
  if (wait.length) {
    V.body.appendChild(el('div', 'sheet-h', esc(WORDS.pending)));
    wait.forEach((r) => V.body.appendChild(el('div', 'rs-wait', '<span class="t">' + esc(r.item) + '</span><span class="d">' + esc(WORDS.count(r.ballot_count)) + '</span>')));
  }
  const edit = button(esc(mine.length ? WORDS.edit : WORDS.rankIt), mine.length ? 'ghost' : '', () => drawCheck(V));
  edit.type = 'button';
  const it = itemOf(l);
  const share = button(ICON.share + ' ' + esc(WORDS.share), 'ghost', () => app.share(KEY, it.k, it.title));
  share.type = 'button';
  V.foot.append(edit, share);
}

/* ------------------------------------------------------------ the dragging */
/* Rank What You Know's drag.js, for a sheet. The handle takes the finger
   (touch-action: none), the row follows it and its neighbours step aside.
   The row itself is never moved in the DOM: a touch ends if its target is
   detached, so the neighbours are moved around it. Near the sheet's edge the
   list scrolls, since a long list runs past a phone's screen. */
function sortable(list, scroller, onChange) {
  let D = null;
  const glide = (rows, tops, ms) => {
    if (reduced()) return;
    rows.forEach((r) => {
      const d = tops.get(r) - r.getBoundingClientRect().top;
      if (d) r.animate([{ transform: 'translateY(' + d + 'px)' }, { transform: 'translateY(0)' }], { duration: ms, easing: 'cubic-bezier(.2,.9,.3,1.1)' });
    });
  };
  const place = () => {
    const { row, y, grab } = D;
    const others = [...list.children].filter((r) => r !== row);
    /* layout positions: a neighbour mid-glide must not read as still where it was */
    const centre = y - grab + row.offsetHeight / 2 - list.getBoundingClientRect().top;
    const target = others.findIndex((r) => centre < r.offsetTop + r.offsetHeight / 2);
    const to = target < 0 ? others.length : target;
    const from = [...list.children].indexOf(row);
    if (to !== from) {
      const tops = new Map(others.map((r) => [r, r.getBoundingClientRect().top]));
      const moving = to > from ? others.slice(from, to) : others.slice(to, from);
      if (to > from) moving.forEach((r) => list.insertBefore(r, row));
      else moving.reverse().forEach((r) => row.after(r));
      glide(others, tops, 170);
    }
    row.style.transform = 'translateY(0)';
    row.style.transform = 'translateY(' + (y - grab - row.getBoundingClientRect().top) + 'px)';
  };
  const edge = () => {
    if (!D) return;
    const box = scroller.getBoundingClientRect();
    const v = D.y < box.top + EDGE ? -EDGE_STEP : D.y > box.bottom - EDGE ? EDGE_STEP : 0;
    if (v) { scroller.scrollTop += v; place(); }
    D.frame = requestAnimationFrame(edge);
  };
  const move = (e) => {
    if (!D || e.pointerId !== D.id) return;
    D.y = e.clientY;
    place();
  };
  const end = (e) => {
    if (!D || e.pointerId !== D.id) return;
    const { row, frame } = D;
    D = null;
    cancelAnimationFrame(frame);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    row.classList.remove('dragging');
    list.classList.remove('live');
    const off = row.getBoundingClientRect().top;
    row.style.transform = '';
    glide([row], new Map([[row, off]]), 160);
    onChange();
  };
  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.rs-handle');
    const row = handle && handle.closest('.rs-row');
    if (!row || D) return;
    e.preventDefault();
    D = { row, id: e.pointerId, y: e.clientY, grab: e.clientY - row.getBoundingClientRect().top, frame: 0 };
    row.classList.add('dragging');
    list.classList.add('live');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    D.frame = requestAnimationFrame(edge);
  });
  /* the buttons do the same with a tap */
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-move]');
    if (!b || b.disabled) return;
    const row = b.closest('.rs-row');
    const up = b.dataset.move === 'up';
    const sib = up ? row.previousElementSibling : row.nextElementSibling;
    if (!sib) return;
    const rows = [...list.children];
    const tops = new Map(rows.map((r) => [r, r.getBoundingClientRect().top]));
    if (up) row.after(sib); else list.insertBefore(sib, row);
    glide(rows, tops, 200);
    onChange();
    if (b.disabled) (row.querySelector('[data-move]:not([disabled])') || b).focus({ preventScroll: true });
  });
}
