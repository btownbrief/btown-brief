/* whatnow.js — the middle button, and the only tab that asks a question.

   This is the standalone What Now app brought inside All Day, so that page can
   retire. The decision engine is ported VERBATIM (whatnow-engine.js) — it read
   the sky and the calendar and handed back one safe answer, it survived an
   adversarial review, and its 38-test Node suite still passes against the
   copy. Nothing about the rules was re-derived here.

   What the engine does, in one line: it builds a pool of real answers that are
   safe and sensible FOR THE WINDOW BEING PLANNED — today's events, 213 curated
   things, 38 clubs, 39 hobbies, tonight's sunset plan, a swim when the lake has
   earned it — scores each against the moment, and picks weighted-random from
   the top so a respin stays good without being the same.

   The safety gates live where the pool is built, not in the UI, so no chip and
   no respin can reach around them: dangerous cold or heat, high wind, bad air,
   an active alert or NO CURRENT READING AT ALL remove everything outdoor. The
   swim needs season, daylight, 74°+, a real recent lake gage, and a fresh
   clean-water test. Any missing piece and it is not offered.

   THE SKY IS THE POINT, VISUALLY. The standalone app painted the whole page
   with a gradient from the real sun times — night, dawn, morning, day, golden,
   dusk. That is the thing that made it feel like Burlington rather than a
   list, so it came too. It is scoped to this panel: All Day is a light app and
   the other eight tabs must not inherit a night sky.

   Underneath the answer, the same ten-day calendar this tab already showed.
   The question first, the list second — a calendar is what you scroll when the
   answer was not the thing. */

import * as store from './../store.js';
import * as data from './../wire.js';
import * as app from './../app.js';
import { el, esc, safeHref, chip, shelfHead, scrollHint, tabStamp, stampOf, ICON } from './../ui.js';
import { loadAll } from './../whatnow-data.js';
import { buildContext, buildPool, pick, fmtTime, outdoorRisks } from './../whatnow-engine.js';

const EVENTS_URL = '../events.html';
const PLANNER_URL = 'https://play.btownbrief.com/burlington-days/';
const ARCADE_URL = 'https://play.btownbrief.com/';
const SPORTS_URL = '../sports.html';

/* The arcade's own roster, and the same read-only leaderboard RPC its
   /leaderboards/ page uses (play.btownbrief.com/leaderboard.js). The key is
   the published anon key that is already in that file — this reads, it never
   writes, and `scores` itself is not readable by anon, so the RPC is the only
   door. Both send CORS headers back to guide.btownbrief.com; either one
   failing just means no card. */
const ARCADE_ROSTER_URL = 'https://play.btownbrief.com/games.json';
const LB_RPC = 'https://jnouvwxomrcffqwilqkq.supabase.co/rest/v1/rpc/get_leaderboard';
const LB_ANON_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3';
const LB_TIMEOUT_MS = 6000;
const LB_CACHE_KEY = 'allday-wn-board';
const LB_CACHE_MS = 30 * 60 * 1000;

/* ~20 hours, so tomorrow does not open with yesterday's answer. */
const SEEN_KEY = 'allday-wn-seen';
const SEEN_MS = 20 * 3600 * 1000;

const MODES = [['now', 'now'], ['tonight', 'tonight'], ['tomorrow', 'tomorrow']];
const PATHS = [
  ['free', "I'm broke"],
  ['outside', 'get me outside'],
  ['people', 'people, please'],
  ['twohours', "I've got ~2 hours"],
  ['closeby', 'close by'],
  ['hobby', 'teach me something'],
];

const state = {
  root: null, feeds: null, status: null,
  mode: 'now', chips: new Set(),
  answer: null, poolSize: 0, ctx: null,
  spinning: false, loaded: false, listCat: null, games: null, board: null,
};

export function mount(root) {
  state.root = root;
  root.innerHTML = '<p class="loading">Reading the sky…</p>';
  /* Games ride alongside, and fail soft: no payload, no strip, and the rest
     of the tab is unchanged. */
  /* This payload can land BEFORE the engine's own feeds do, and render()
     needs a context to describe the hat. Store it either way; only redraw once
     the tab has actually rendered once. */
  data.load('sports', (json) => {
    state.games = json;
    if (state.loaded) render();
  }, () => {});
  /* Same deal for the arcade board: it is two cross-origin requests to
     another site, so it can only ever be a bonus. It never blocks the tab and
     it never reports an error — no board, no card. */
  loadBoard().then((board) => {
    state.board = board;
    if (state.loaded && board) render();
  });
  loadAll().then(({ data: feeds, status }) => {
    state.feeds = feeds;
    state.status = status;
    state.loaded = true;
    spin(true);
  }).catch(() => {
    root.innerHTML = '';
    root.appendChild(el('div', 'errbox',
      '<b>Couldn’t read the moment.</b><br>The feeds it needs are the guide’s own.'));
  });
}

export function activate() {}
export function refresh() { if (state.loaded) render(); }
export function deactivate() { app.closePeek(); }

/* --------------------------------------------------------------- memory */

function seen() {
  const raw = store.read(SEEN_KEY, {});
  const now = Date.now();
  const live = {};
  Object.keys(raw || {}).forEach((k) => {
    if (now - raw[k] < SEEN_MS) live[k] = raw[k];
  });
  return live;
}
function remember(id) {
  if (!id) return;
  const m = seen();
  m[id] = Date.now();
  store.write(SEEN_KEY, m);
}

/* ---------------------------------------------------------------- spin */

/* A slot machine, not a fade. The reel shows REAL candidates from the same
   pool the answer comes from — showing nonsense and then a result would be a
   lie about how the pick is made — and slows on an ease-out before it lands,
   which is the whole feel of a machine coming to rest.

   It never spins for longer than the reader will wait, and prefers-reduced-
   motion skips straight to the answer. */
const REEL_MS = [55, 60, 68, 78, 92, 110, 135, 170, 215, 275, 350];

function roll() {
  if (state.spinning || !state.feeds) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { spin(); return; }

  const ctx = buildContext(state.feeds, new Date(), state.mode);
  const pool = buildPool(state.feeds, ctx, state.chips);
  if (pool.length < 3) { spin(); return; }

  state.spinning = true;
  let i = 0;
  const step = () => {
    if (i >= REEL_MS.length) {
      state.spinning = false;
      spin();                       // the real pick, with its own memory rules
      return;
    }
    /* a different candidate each tick, never the one we are about to land on
       twice in a row */
    state.answer = pool[Math.floor(Math.random() * pool.length)];
    state.poolSize = pool.length;
    state.ctx = ctx;
    render();
    setTimeout(step, REEL_MS[i++]);
  };
  step();
}

function spin(first) {
  if (!state.feeds) return;
  const ctx = buildContext(state.feeds, new Date(), state.mode);
  const pool = buildPool(state.feeds, ctx, state.chips);
  state.ctx = ctx;
  state.poolSize = pool.length;
  state.answer = pick(pool, Object.keys(seen()));
  if (state.answer && state.answer.id) remember(state.answer.id);
  render(first);
}

/* The sky, from the real sun times — the same six phases the standalone app
   painted, scoped to this panel. */
function phaseOf(ctx) {
  const sun = state.feeds && state.feeds.weather && state.feeds.weather.sun;
  if (sun && sun.sunrise && sun.sunset) {
    const now = ctx.now;
    const rise = new Date(sun.sunrise);
    const set = new Date(sun.sunset);
    const m = (a, b) => (a - b) / 60000;
    if (m(now, rise) < -40) return 'night';
    if (m(now, rise) < 40) return 'dawn';
    if (now.getHours() < 11) return 'morning';
    if (m(set, now) > 75) return 'day';
    if (m(now, set) < 10) return 'golden';
    if (m(now, set) < 50) return 'dusk';
    return 'night';
  }
  const h = ctx.hour;   // Burlington hour, never the device's
  return h < 6 || h >= 21 ? 'night' : h < 9 ? 'dawn' : h < 11 ? 'morning' : h < 19 ? 'day' : 'dusk';
}

/* ------------------------------------------------------- answer copy */
/* metaLine and blurbFor are lifted from the standalone app so the answer
   reads exactly as it did there. */

function metaLine(c) {
  const bits = [];
  if (c.kind === 'event') {
    bits.push(c.venue);
    if (c.timeLabel) bits.push(c.timeLabel);
    bits.push(c.free ? 'free' : (c.minPrice != null && c.minPrice > 0 ? 'from $' + c.minPrice : ''));
  } else if (c.kind === 'thing') {
    bits.push(c.venue);
    if (c.costNote) bits.push(c.costNote);
    else if (c.costTier) bits.push(c.costTier === 'Free' ? 'free' : c.costTier);
  } else if (c.kind === 'sunset') {
    bits.push('be there by ' + c.arriveLabel);
    if (c.walkMin != null) bits.push(c.walkMin + ' min walk from Church St');
    bits.push("sun's down " + c.sunsetLabel);
  } else if (c.kind === 'beach') {
    bits.push(c.venue);
    if (c.beach && c.beach.sampled) bits.push('water tested clean');
  } else if (c.kind === 'club' || c.kind === 'hobby') {
    bits.push(c.venue);
  }
  return bits.filter(Boolean).join(' · ');
}

const trim = (s, n) => (!s ? '' : (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s));

function blurbFor(c) {
  if (c.kind === 'thing') return c.blurb || '';
  if (c.kind === 'club') return trim(c.what, 160);
  if (c.kind === 'hobby') return trim(c.startLine ? c.what + ' Start: ' + c.startLine : c.what, 280);
  if (c.kind === 'sunset') return c.why || 'Look west. That’s the whole assignment.';
  if (c.kind === 'beach') return 'Towel, water, done. This is what the lake is for.';
  return '';
}

const modeWord = () =>
  state.mode === 'tonight' ? 'tonight' : state.mode === 'tomorrow' ? 'tomorrow' : 'right now';

/* A thin pool at a rainy 2am is honesty, not failure — so it says why. */
function smallHatNote() {
  if (state.poolSize >= 8) return '';
  const ctx = state.ctx;
  if (!ctx) return '';
  const why = [];
  if (ctx.block === 'Late Night' && state.mode === 'now') why.push("it's late");
  if (ctx.rainT) why.push("it's raining");
  else if (ctx.tempT != null && ctx.tempT <= 20) why.push("it's bitter out");
  if (ctx.tempT == null) why.push("we can't read the sky");
  if (state.chips.size >= 2) why.push('the filters are tight');
  return why.length ? ' — the hat’s small because ' + why.slice(0, 2).join(' and ') : '';
}

/* -------------------------------------------------------------- render */

export function render(first) {
  const root = state.root;
  const ctx = state.ctx;
  root.innerHTML = '';
  root.dataset.phase = ctx ? phaseOf(ctx) : 'day';

  const sky = el('div', 'wn-sky');
  root.appendChild(sky);

  /* the conditions strip: what the engine is reading, said out loud */
  const w = state.feeds && state.feeds.weather;
  const bits = [];
  if (ctx) bits.push(esc(ctx.block));
  if (w && w.now && w.now.temp_f != null) bits.push(Math.round(w.now.temp_f) + '°');
  if (w && w.now && w.now.summary) bits.push(esc(String(w.now.summary).toLowerCase()));
  if (w && w.sun && w.sun.sunset) bits.push('sun’s down ' + esc(fmtTime(new Date(w.sun.sunset))));
  root.appendChild(el('p', 'wn-strip', bits.join(' · ')));

  /* window: now / tonight / tomorrow */
  const modes = el('div', 'wn-modes');
  MODES.forEach(([id, label]) => {
    const b = el('button', 'wn-mode' + (state.mode === id ? ' on' : ''), esc(label));
    b.setAttribute('aria-pressed', state.mode === id ? 'true' : 'false');
    b.addEventListener('click', () => { if (state.mode !== id) { state.mode = id; spin(); } });
    modes.appendChild(b);
  });
  root.appendChild(modes);

  /* the answer */
  const card = el('div', 'wn-answer' + (state.spinning ? ' is-spinning' : ''));
  if (!state.answer) {
    const walkable = ctx && !ctx.darkAtTarget && !ctx.rainT &&
      ctx.tempT != null && ctx.tempT >= 40 && !outdoorRisks(ctx).length;
    card.innerHTML =
      '<p class="wn-kicker">honestly?</p>' +
      '<h2 class="wn-title">Nothing fits all that.</h2>' +
      '<p class="wn-meta">' + (walkable
        ? 'Loosen a filter — or skip the plan and take the waterfront walk.'
        : 'Loosen a filter — or call it: some hours are for staying in.') + '</p>';
  } else {
    const c = state.answer;
    const blurb = blurbFor(c);
    card.innerHTML =
      '<p class="wn-kicker">' +
        (c.why_ && c.why_.length ? 'because ' + esc(c.why_.slice(0, 3).join(' · ')) : 'why not') +
      '</p>' +
      '<h2 class="wn-title">' + esc(c.title) + '</h2>' +
      '<p class="wn-meta">' + esc(metaLine(c)) + '</p>' +
      (blurb ? '<p class="wn-blurb">' + esc(blurb) + '</p>' : '');
    if (c.url) {
      const a = el('a', 'wn-go', 'Open it ' + ICON.ext);
      a.href = safeHref(c.url);
      a.target = '_blank';
      a.rel = 'noopener';
      card.appendChild(a);
    }
  }
  root.appendChild(card);

  const acts = el('div', 'wn-acts');
  const again = el('button', 'wn-again', 'Nah, spin again');
  again.addEventListener('click', () => roll());
  acts.appendChild(again);
  if (state.answer) {
    const going = el('button', 'wn-going', 'Whoa, that’s interesting');
    going.addEventListener('click', () => {
      app.toast('Good. Now put the phone down.');
    });
    acts.appendChild(going);
  }
  root.appendChild(acts);

  root.appendChild(el('p', 'wn-pool',
    state.poolSize
      ? 'picked from ' + state.poolSize + ' things that fit ' + modeWord() + esc(smallHatNote())
      : 'nothing in the hat for ' + modeWord() + esc(smallHatNote())));

  /* the paths */
  const paths = el('div', 'chips wn-paths');
  PATHS.forEach(([id, label]) => {
    paths.appendChild(chip(esc(label), state.chips.has(id), () => {
      if (state.chips.has(id)) state.chips.delete(id); else state.chips.add(id);
      spin();
    }));
  });
  root.appendChild(paths);
  scrollHint(paths);

  /* The sky has to be exactly as tall as the content it colours. A fixed
     height guesses, and it guessed wrong: the respin button, the pool note
     and the path chips sit in white-on-sky ink, so when the gradient ran out
     above them they went white-on-white. Measure the last sky-lit element
     and end the fade below it. */
  requestAnimationFrame(() => {
    const last = root.querySelector('.wn-paths');
    if (!last) return;
    const h = last.offsetTop + last.offsetHeight;
    sky.style.height = (h + 90) + 'px';
  });

  sportsStrip(root);
  arcadeBoard(root);
  renderList(root);
  doors(root);

  if (first) tabStamp(root, stampOf(state.feeds && state.feeds.events &&
    state.feeds.events.generated), 'the calendar, every morning');
}

/* ------------------------------------------------- the calendar beneath */
/* The answer is the product; this is what you scroll when it was not the
   thing. Same ten-day slice, bucketed against the reader's clock. */

function clock(e) {
  if (e.allDay) return 'All day';
  return new Date(e.start).toLocaleTimeString('en-US',
    { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
}

function dayLabelFor(iso) {
  const d = new Date(iso + 'T12:00:00');
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const days = Math.round((d - today) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function row(e) {
  const a = el('a', 'wn-row');
  a.href = safeHref(e.url);
  a.target = '_blank';
  a.rel = 'noopener';
  a.innerHTML =
    '<span class="wn-row-time">' + esc(clock(e)) + '</span>' +
    '<span class="wn-row-body">' +
      '<span class="wn-row-t">' + esc(e.title) + '</span>' +
      '<span class="wn-row-v">' + esc(e.venue || '') +
        (e.town && e.town !== 'Burlington' ? ', ' + esc(e.town) : '') +
        (e.free ? ' · Free' : (e.price ? ' · ' + esc(e.price) : '')) + '</span>' +
    '</span>';
  return a;
}

function renderList(root) {
  const payload = state.feeds && state.feeds.events;
  const all = (payload && Array.isArray(payload.events)) ? payload.events : [];
  if (!all.length) return;

  const counts = (payload && payload.counts) || {};
  const cats = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  shelfHead(root, 'What else is on', all.length + ' over the next ten days');

  const chips = el('div', 'chips');
  chips.appendChild(chip('Everything', !state.listCat, () => { state.listCat = null; render(); }));
  cats.slice(0, 10).forEach((c) => chips.appendChild(
    chip(esc(c.replace('-', ' ')) + ' <span class="n">' + counts[c] + '</span>',
      state.listCat === c, () => { state.listCat = state.listCat === c ? null : c; render(); })));
  root.appendChild(chips);
  scrollHint(chips);

  const now = Date.now();
  const list = all
    .filter((e) => !state.listCat || e.category === state.listCat)
    .filter((e) => e.allDay || new Date(e.start).getTime() >= now - 45 * 60000)
    .slice(0, 90);

  const holder = el('div', 'wn-list');
  let day = null;
  list.forEach((e) => {
    if (e.date !== day) {
      day = e.date;
      holder.appendChild(el('p', 'wn-day', dayLabelFor(e.date)));
    }
    holder.appendChild(row(e));
  });
  root.appendChild(holder);

  if (!list.length) root.appendChild(el('p', 'empty', 'Nothing left in that one today.'));
}

function doors(root) {
  const box = el('div', 'wn-doors');
  const door = (href, title, sub) => {
    const a = el('a', 'wn-door');
    a.href = safeHref(href);
    if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
    a.innerHTML =
      '<span><span class="wn-door-t">' + esc(title) + '</span>' +
      '<span class="wn-door-s">' + esc(sub) + '</span></span>' + ICON.ext;
    return a;
  };
  box.appendChild(door(EVENTS_URL, 'The whole calendar',
    'Every event, filterable, further out than this'));
  box.appendChild(door(PLANNER_URL, 'Build a day',
    'Burlington Days turns a mood into an itinerary'));
  box.appendChild(door(ARCADE_URL, 'Play something',
    'The arcade — and five games you go outside for'));
  root.appendChild(box);
}


/* ------------------------------------------------------------- the games */
/* You are on this tab because you want something to do, and a game is one of
   the better answers Burlington has. Two days' worth, then out to the full
   page — this is a pointer, not a second sports tab. */
function sportsStrip(root) {
  const doc = state.games;
  const games = (doc && Array.isArray(doc.games)) ? doc.games : [];
  if (!games.length) return;

  const now = Date.now();
  const soon = games
    .filter((g) => g.level !== 'national')
    .filter((g) => {
      const t = new Date(g.start).getTime();
      return t >= now - 2 * 3600000 && t <= now + 48 * 3600000;
    })
    .slice(0, 4);

  const box = el('div', 'wn-sport');
  const link = el('a', 'wn-sport-hit');
  link.href = safeHref(SPORTS_URL);

  if (soon.length) {
    link.innerHTML =
      '<span class="wn-sport-k">Games in the next two days</span>' +
      soon.map((g) => {
        const t = g.allDay ? 'All day' : new Date(g.start).toLocaleTimeString('en-US',
          { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
        return '<span class="wn-sport-g">' +
          '<b>' + esc(t) + '</b> ' + esc(g.title) +
          (g.venue ? ' <i>' + esc(g.venue) + '</i>' : '') + '</span>';
      }).join('') +
      '<span class="wn-sport-more">All Burlington sports ' + ICON.ext + '</span>';
  } else {
    /* Nothing in two days is normal here, not a failure — say what there IS. */
    const next = games.filter((g) => g.level !== 'national' &&
      new Date(g.start).getTime() > now)[0];
    link.innerHTML =
      '<span class="wn-sport-k">Sports</span>' +
      '<span class="wn-sport-g">' + (next
        ? 'Nothing tonight or tomorrow. Next up: <b>' + esc(next.title) + '</b>'
        : 'Schedules for UVM, the high school and the clubs') + '</span>' +
      '<span class="wn-sport-more">All Burlington sports ' + ICON.ext + '</span>';
  }
  box.appendChild(link);
  root.appendChild(box);
}

/* ----------------------------------------------------------- the arcade */
/* Sports is what other people are playing; this is what YOU can play, and
   the arcade is 32 cabinets deep with a leaderboard on every one. A wall of
   32 is a page of its own — this is one board, the top three, and a way in.

   ONE cabinet, not the whole arcade. "Who rules the arcade" is the better
   headline but it costs 32 requests to compute, which is not a thing a tab
   should do on open for a card three lines tall. One board, rotating on the
   day, gets the same job done in four small ones — and it is a real ranked
   board rather than a summary: a score you can go and beat today. */

function monthKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/* Same shape as wire.js's request(), which is GET-only. */
function rpc(body) {
  const ctl = 'AbortController' in window ? new AbortController() : null;
  const timer = ctl && setTimeout(() => ctl.abort(), LB_TIMEOUT_MS);
  return fetch(LB_RPC, {
    method: 'POST',
    headers: { apikey: LB_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: ctl ? ctl.signal : undefined,
  })
    .then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .finally(() => { if (timer) clearTimeout(timer); });
}

/* Day-of-year rotation: everyone sees the same cabinet on the same day, and
   tomorrow it is a different one. Four are asked at once because a board can
   be empty this month, and a card that says "no scores yet" is a worse card
   than the next cabinet along.

   The four STRIDE across the roster instead of being four in a row. Seven of
   the 32 boards had no scores this month and the empty ones sit together —
   the card games shipped as a batch — so four adjacent cabinets really can
   all be blank, while four spread across the arcade never were. Simulated
   over a full year against live counts, a stride of seven put three real
   names on the card every single day and still rotated through seventeen
   different cabinets. */
const LB_TRIES = 4;
const LB_STEP = 7;

function candidates(games) {
  const n = games.length;
  if (!n) return [];
  const d = new Date();
  const day = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const start = (((day * LB_STEP) % n) + n) % n;
  const out = [];
  /* dedupe rather than trust the stride: if the roster ever grows to a
     multiple of seven the stride lands on the same cabinet four times. */
  for (let i = 0; out.length < LB_TRIES && i < n; i += 1) {
    const g = games[(start + i * LB_STEP) % n];
    if (out.indexOf(g) === -1) out.push(g);
  }
  return out;
}

function loadBoard() {
  const month = monthKey();
  const hit = store.read(LB_CACHE_KEY, null);
  if (hit && hit.month === month && Date.now() - hit.at < LB_CACHE_MS && hit.board) {
    return Promise.resolve(hit.board);
  }
  return data.fetchJSON(ARCADE_ROSTER_URL, LB_TIMEOUT_MS)
    .then((json) => {
      const games = ((json && json.games) || []).filter((g) => g.live && g.leaderboard && g.slug);
      const picks = candidates(games);
      if (!picks.length) return null;
      return Promise.all(picks.map((g) => (
        rpc({ p_game: g.slug, p_month: month })
          .then((rows) => ({ g, rows: Array.isArray(rows) ? rows : [] }))
          .catch(() => ({ g, rows: [] }))
      )));
    })
    .then((results) => {
      if (!results) return null;
      /* Three names is the card. Take the day's first board that has them,
         and only if none does fall back to the fullest one going — one row
         is a high score, not a leaderboard, but it still beats no card. */
      const best = results.find((r) => r.rows.length >= 3) ||
        results.slice().sort((a, b) => b.rows.length - a.rows.length)[0];
      if (!best || !best.rows.length) return null;
      const board = {
        slug: best.g.slug,
        name: best.g.name || best.g.slug,
        emoji: best.g.emoji || '🕹️',
        rows: best.rows.slice(0, 3).map((r) => ({
          name: r.name || 'Anonymous',
          score: Number(r.score) || 0,
        })),
      };
      store.write(LB_CACHE_KEY, { at: Date.now(), month, board });
      return board;
    })
    .catch(() => null);
}

const MEDALS = ['🥇', '🥈', '🥉'];

function arcadeBoard(root) {
  const b = state.board;
  if (!b || !b.rows.length) return;

  const box = el('div', 'wn-arcade');
  const link = el('a', 'wn-arcade-hit');
  link.href = safeHref(ARCADE_URL);
  link.target = '_blank';
  link.rel = 'noopener';
  link.innerHTML =
    '<span class="wn-arcade-k">This month at the arcade</span>' +
    '<span class="wn-arcade-g">' + esc(b.emoji) + ' <b>' + esc(b.name) + '</b></span>' +
    '<span class="wn-arcade-rows">' +
    b.rows.map((r, i) => (
      '<span class="wn-arcade-r">' +
        '<i>' + MEDALS[i] + '</i>' +
        '<em>' + esc(r.name) + '</em>' +
        '<b>' + r.score.toLocaleString() + '</b>' +
      '</span>'
    )).join('') +
    '</span>' +
    '<span class="wn-arcade-more">Go beat it — the arcade ' + ICON.ext + '</span>';
  box.appendChild(link);
  root.appendChild(box);
}
