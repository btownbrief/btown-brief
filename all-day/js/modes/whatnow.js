/* What Now: one answer, then put the phone down.

   A weather line at the top (feels like, the lake when the gage is fresh,
   sunset), then three modes behind the chip row:

   - Spin. The standalone What Now app's engine (whatnow-engine.js, ported
     verbatim and not touched here) behind one big button. It builds a pool
     of answers that are safe and sensible for the window being planned (now,
     tonight, tomorrow), scores them against the sky and the clock, and picks
     weighted-random from the top. The safety gates live in the engine, where
     the pool is built, so no chip and no respin can reach around them. The
     answer card spells out the engine's reasons; Do it ends the session with
     the app's own line; Another respins. The path chips (I'm broke, get me
     outside, people please, two hours, close by, teach me something) are the
     engine's own constraint keys.
   - Missions. The Top 100 as missions (data/missions.json, built by
     scripts/build_missions.py): a numbered list, theme chips, Mark done
     (kept on this device, and on the reader's account when signed in, which
     fails soft), and Surprise me, which scrolls the list to a mission you
     have not done and lets it glow, rather than opening a modal. Tap a
     mission for its paragraph and its places.
   - Tonight. The local artists with a show tonight or this week
     (all-day/data/music.json), the job the old Music tab did, why lines
     kept, then today's calendar from 5 pm on (all-day/data/whatnow.json, in
     Burlington's clock, not the reader's) as event cards. Listen builds that artist's
     Bandcamp player in place; nothing plays until you press its play button,
     and the shell's player steps aside for it (and silences it in turn).

   ?demo=1 runs this same file on data/demo/whatnow.json, which holds every
   payload in its real shape; its dates are moved to today on load. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import { el, esc, safeHref, ICON, art, section, chips, pills, button, cards, put } from '../ui.js';
import { loadAll } from '../whatnow-data.js';
import { buildContext, buildPool, pick, fmtTime, outdoorRisks } from '../whatnow-engine.js';
import { sunScore } from '../sun.js';

const KEY = 'whatnow';
const MODES = ['spin', 'missions', 'tonight'];
const MISSIONS_URL = '../data/missions.json';
const EVENTS_URL = '../events.html';
const DONE_KEY = 'allday-missions';
const SEEN_KEY = 'allday-wn-seen';
const SEEN_MS = 20 * 3600 * 1000;       // about a day, so tomorrow does not open on today's answer
const EVENING = 17;                      // Tonight starts at 5 pm in Burlington
const WEEK = 7;
const REEL_MS = [55, 60, 68, 78, 92, 110, 135, 170, 215, 275, 350];

const WINDOWS = [['now', 'Now'], ['tonight', 'Tonight'], ['tomorrow', 'Tomorrow']];
const PATHS = [['free', 'I’m broke'], ['outside', 'Get me outside'], ['people', 'People, please'],
  ['twohours', 'Two hours'], ['closeby', 'Close by'], ['hobby', 'Teach me something']];
const THEME = { eat: 'Eat', drink: 'Drink', outdoors: 'Outdoors', water: 'Water', culture: 'Culture',
  play: 'Play', family: 'Family', winter: 'Winter', free: 'Free' };

/* Signed-in Mark done goes to the fleet's Supabase project through two
   functions this tab asks for (the SQL is in the pull request). Until they
   exist the calls fail and the device copy is all there is. */
const SB_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
const SB_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3'; // anon, safe to ship

/* ----------------------------------------------------------------- clock */
const TZ = 'America/New_York';
const partsFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dowFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' });
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' });
function et(ms) {
  const o = {};
  partsFmt.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
  return { date: o.year + '-' + o.month + '-' + o.day, hour: Number(o.hour), minute: Number(o.minute), dom: Number(o.day) };
}
const utcNoon = (d) => { const [y, m, n] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, n, 12)); };
const addDays = (d, n) => { const t = utcNoon(d); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const clock = (ms) => fmtTime(new Date(ms));                 // "6:06pm", the engine's own format
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/* ----------------------------------------------------------------- state */
const S = {
  mode: 'spin', theme: 'all', window: 'now', chips: new Set(),
  answer: null, pool: 0, ctx: null, rolling: false, did: false,
  feeds: null, feedsFailed: false, sun: null,
  weather: null, events: null, music: null, missions: null, missionsFailed: false,
};
let root = null, pending = null, ready = false, loaded = null, D = null, reel = 0;
const done = app.demo ? Object.create(null) : { ...readMap(DONE_KEY) };
const seenDemo = Object.create(null);

function readMap(key) { const v = store.read(key, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

/* ---------------------------------------------------------------- loading */
/* Everything is fetched on the first visit to the tab, never before:
   things.json alone is 236 KB. Each piece paints when it lands. */
function load() {
  if (app.demo) {
    return app.demoData(KEY).then((d) => {
      D = redate(d);
      S.weather = D.weather; S.events = D.events; S.music = D.music; S.missions = D.missions;
      S.feeds = { ...D.feeds, weather: D.weather, events: D.events };
    });
  }
  /* the wire may hand a payload over again later (a retry after a failed
     first try, or a fresh copy): keep the engine's view of it current and
     repaint the tab if it is showing */
  const sub = (key, take) => new Promise((res) => data.load(key, (j) => { take(j); res(); if (ready) repaint(); }, res));
  const parts = [
    sub('weather', (j) => { S.weather = j; if (S.feeds) S.feeds.weather = j; }),
    sub('whatnow', (j) => { S.events = j; if (S.feeds) S.feeds.events = j; }),
    sub('music', (j) => { S.music = j; }),
    data.fetchJSON(MISSIONS_URL, 8000).then((j) => {
      if (!j || !Array.isArray(j.missions)) throw new Error('bad shape');
      S.missions = j;
    }).catch(() => { S.missionsFailed = true; }),
    loadAll().then(({ data: feeds }) => { S.feeds = feeds; }).catch(() => { S.feedsFailed = true; }),
  ];
  sunScore(data).then((sun) => { S.sun = sun; });
  pullDone();
  return Promise.all(parts);
}

function repaint() {
  if (!root || app.activeTab() !== KEY || S.rolling || (S.mode === 'tonight' && embed)) return;
  const y = panel() ? panel().scrollTop : 0;
  render();
  app.paintSubnav();
  if (panel()) panel().scrollTop = y;
}

/* The demo file is dated 2026-10-16. Its dates move to today (Burlington's)
   and its weather reads as just observed, so the engine and Tonight see a
   live day whenever the demo is opened. */
function redate(d) {
  const shift = Math.round((utcNoon(et(Date.now()).date) - utcNoon(d.anchor || '2026-10-16')) / 86400000);
  /* a Burlington time keeps its wall clock: 5 pm in October is 5 pm in
     December, so the offset is the one in force on the new date */
  const offsetOn = (day) => {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(utcNoon(day)).find((x) => x.type === 'timeZoneName');
    const m = part && /GMT([+-]\d{2}:\d{2})/.exec(part.value);
    return m ? m[1] : '-05:00';
  };
  const walk = (v) => {
    if (typeof v === 'string') {
      if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return v;
      const day = addDays(v.slice(0, 10), shift);
      const m = /^(T[\d:.]+)(-0[45]:00)$/.exec(v.slice(10));
      return day + (m ? m[1] + offsetOn(day) : v.slice(10));
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach((k) => { o[k] = walk(v[k]); }); return o; }
    return v;
  };
  const out = walk(d);
  const now = new Date().toISOString();
  out.weather.updated = now;
  if (out.weather.now) out.weather.now.observed_at = now;
  if (out.weather.lake_gage) out.weather.lake_gage.water_temp_at = now;
  return out;
}

/* ---------------------------------------------------------------- the tab */
function render() {
  if (!root) return;
  closeBandcamp();
  root.innerHTML = '';
  const wx = weatherLine();
  if (wx) root.appendChild(wx);
  if (S.mode === 'spin') renderSpin();
  else if (S.mode === 'missions') renderMissions();
  else renderTonight();
}

/* One line: what it feels like, the lake when the gage is fresh, sunset. */
function weatherLine() {
  const w = S.weather;
  if (!w) return null;
  const bits = [];
  const feels = w.now && (w.now.feels_like_f != null ? w.now.feels_like_f : w.now.temp_f);
  if (feels != null && Number.isFinite(Number(feels))) bits.push('<span><b>' + esc(Math.round(feels)) + '°</b> feels like</span>');
  const g = w.lake_gage;
  const fresh = g && g.water_temp_f != null && g.water_temp_at && Date.now() - Date.parse(g.water_temp_at) < 24 * 3600000;
  if (fresh) bits.push('<span><b>' + esc(Math.round(g.water_temp_f)) + '°</b> lake</span>');
  const set = w.sun && Date.parse(w.sun.sunset);
  if (set) bits.push('<span><b>' + esc(clock(set).replace(/[ap]m$/, '')) + '</b> sunset</span>');
  if (!bits.length) return null;
  const line = el('div', 'wx', bits.join(''));
  line.setAttribute('aria-label', 'Weather');
  return line;
}

/* ------------------------------------------------------------------ Spin */
function renderSpin() {
  const tools = el('div', 'toolrow');
  tools.appendChild(pills(WINDOWS, S.window, (v) => { S.window = v; S.answer = null; S.did = false; render(); }));
  root.appendChild(tools);

  const s = el('div', 'spin');
  const big = el('button', 'big', ICON.shuffle + '<span>Spin</span>');
  big.addEventListener('click', roll);
  big.disabled = !S.feeds;
  s.appendChild(big);
  s.appendChild(el('p', 'sub', esc(!S.feeds ? (S.feedsFailed ? 'Couldn’t read the moment. The feeds are the guide’s own; try again in a bit.' : 'Reading the sky…')
    : 'One answer for ' + windowWord() + '. Then put the phone down.')));
  root.appendChild(s);

  const paths = chips(PATHS.map(([key, label]) => ({ key, label })), null, (k) => {
    if (S.chips.has(k)) S.chips.delete(k); else S.chips.add(k);
    if (S.answer || S.did) spin(); else render();
  }, 'paths');
  [...paths.children].forEach((b) => { const on = S.chips.has(b.dataset.chip); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  root.appendChild(paths);

  if (S.did && S.answer) root.appendChild(doneCard(S.answer));
  else if (S.answer || (S.ctx && !S.rolling)) root.appendChild(answerCard());
  if (S.ctx && !S.did) root.appendChild(el('p', 'note pad', esc(poolLine())));
}

const windowWord = () => (S.window === 'tonight' ? 'tonight' : S.window === 'tomorrow' ? 'tomorrow' : 'right now');

function context() {
  const ctx = buildContext(S.feeds, new Date(), S.window);
  ctx.sunsetScore = S.sun ? S.sun.score : null;
  return ctx;
}

/* the reel shows real candidates from the same pool, slows, then the real
   pick lands; reduced motion skips straight to it */
function roll() {
  if (S.rolling || !S.feeds) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { spin(); return; }
  const ctx = context();
  const pool = buildPool(S.feeds, ctx, S.chips);
  if (pool.length < 3) { spin(); return; }
  S.rolling = true; S.did = false; S.ctx = ctx; S.pool = pool.length;
  const mine = ++reel;
  let i = 0;
  const step = () => {
    if (mine !== reel) return;
    if (!root || i >= REEL_MS.length) { S.rolling = false; spin(); return; }
    S.answer = pool[Math.floor(Math.random() * pool.length)];
    render();
    setTimeout(step, REEL_MS[i++]);
  };
  step();
}

function spin() {
  if (!S.feeds) return;
  const ctx = context();
  const pool = buildPool(S.feeds, ctx, S.chips);
  S.ctx = ctx; S.pool = pool.length; S.did = false;
  const prev = S.answer && S.answer.id;
  const recent = Object.keys(seen());
  if (prev && !recent.includes(prev)) recent.push(prev);
  S.answer = pick(pool, recent);
  if (S.answer) remember(S.answer.id);
  render();
}

function seen() {
  const raw = app.demo ? seenDemo : readMap(SEEN_KEY);
  const out = {};
  Object.keys(raw).forEach((k) => { if (Date.now() - raw[k] < SEEN_MS) out[k] = raw[k]; });
  return out;
}
function remember(id) {
  if (!id) return;
  if (app.demo) { seenDemo[id] = Date.now(); return; }
  const m = seen();
  m[id] = Date.now();
  store.write(SEEN_KEY, m);
}

/* The engine's reasons, as a sentence: "Because it starts in 40 min, it's
   free and it's rain-proof." */
function because(c) {
  const why = (c.why_ || []).slice(0, 3);
  if (!why.length) return '';
  const list = why.length === 1 ? why[0] : why.slice(0, -1).join(', ') + ' and ' + why[why.length - 1];
  return 'Because ' + list + '.';
}

/* lifted from the standalone app so the answer reads as it did there */
function metaLine(c) {
  const bits = [];
  if (c.kind === 'event') {
    bits.push(c.venue, c.timeLabel, c.free ? 'free' : (c.minPrice != null && c.minPrice > 0 ? 'from $' + c.minPrice : ''));
  } else if (c.kind === 'thing') {
    bits.push(c.venue, c.costNote || (c.costTier === 'Free' ? 'free' : c.costTier));
  } else if (c.kind === 'sunset') {
    bits.push('be there by ' + c.arriveLabel, c.walkMin != null ? c.walkMin + ' min walk from Church St' : '', 'sun’s down ' + c.sunsetLabel);
  } else if (c.kind === 'beach') {
    bits.push(c.venue, c.beach && c.beach.sampled ? 'water tested clean' : '');
  } else bits.push(c.venue);
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

function eyebrow() {
  if (S.window === 'tonight') return 'Tonight';
  if (S.window === 'tomorrow') return 'Tomorrow';
  return 'Right now · ' + clock(Date.now());
}

function answerCard() {
  const r = el('div', 'result' + (S.rolling ? ' rolling' : ''));
  r.setAttribute('aria-live', 'polite');
  const c = S.answer;
  if (!c) {
    const ctx = S.ctx;
    const walkable = ctx && !ctx.darkAtTarget && !ctx.rainT && ctx.tempT != null && ctx.tempT >= 40 && !outdoorRisks(ctx).length;
    r.innerHTML = '<div class="in"><div class="eyebrow">Honestly</div><h3>Nothing fits all that.</h3><p>' +
      esc(walkable ? 'Loosen a chip, or skip the plan and take the waterfront walk.' : 'Loosen a chip, or call it: some hours are for staying in.') + '</p></div>';
    return r;
  }
  const blurb = blurbFor(c);
  const why = because(c);
  r.innerHTML = '<div class="in"><div class="eyebrow">' + esc(eyebrow()) + '</div><h3>' + esc(c.title) + '</h3>' +
    (why ? '<p class="because">' + esc(why) + '</p>' : '') +
    '<p class="meta">' + esc(metaLine(c)) + '</p>' + (blurb && !S.rolling ? '<p>' + esc(blurb) + '</p>' : '') + '<div class="row"></div></div>';
  if (!S.rolling) {
    const row = r.querySelector('.row');
    row.append(button('Do it ' + ICON.arrow, 'doit', () => { S.did = true; render(); }), button('Another', 'ghost another', roll));
  }
  return r;
}

/* Do it ends the session: the app's own line, and the way to the details. */
function doneCard(c) {
  const r = el('div', 'result did');
  r.innerHTML = '<div class="in"><div class="eyebrow">' + esc(c.title) + '</div><h3>Now put the phone down.</h3><p>' +
    esc(metaLine(c)) + '</p><div class="row"></div></div>';
  const row = r.querySelector('.row');
  if (c.url) row.appendChild(openLink('The details', c.url));
  row.appendChild(button('Spin again later', 'ghost', () => { S.did = false; S.answer = null; render(); }));
  return r;
}

/* A thin pool at a rainy 2 am is honesty, not failure, so it says why. */
function poolLine() {
  const ctx = S.ctx;
  const why = [];
  if (S.pool < 8) {
    if (ctx.block === 'Late Night' && S.window === 'now') why.push('it’s late');
    if (ctx.rainT) why.push('it’s raining');
    else if (ctx.tempT != null && ctx.tempT <= 20) why.push('it’s bitter out');
    if (ctx.tempT == null) why.push('the sky can’t be read');
    if (S.chips.size >= 2) why.push('the chips are tight');
  }
  const tail = why.length ? ', and it’s a small hat because ' + why.slice(0, 2).join(' and ') : '';
  return (S.pool ? 'Picked from ' + plural(S.pool, 'thing', 'things') + ' that fit ' : 'Nothing in the hat for ') + windowWord() + tail + '.';
}

/* --------------------------------------------------------------- Missions */
const missions = () => (S.missions && Array.isArray(S.missions.missions) ? S.missions.missions.filter((m) => m && m.k && m.title) : []);
const isDone = (k) => !!done[k];
const doneCount = () => missions().filter((m) => isDone(m.k)).length;

function renderMissions() {
  if (!S.missions) {
    root.appendChild(S.missionsFailed ? el('div', 'errbox', '<b>The missions didn’t load.</b><br>They come from the guide’s own Top 100. Pull down or come back in a bit.')
      : el('p', 'loading', 'Loading the missions…'));
    return;
  }
  const all = missions();
  const sur = el('button', 'pillbtn on surprise', ICON.shuffle + ' Surprise me');
  const head = section(root, 'The Top 100, as missions', '<b>' + esc(doneCount()) + '</b> of ' + esc(all.length) + ' done. Surprise me finds one you haven’t done.', sur);
  head.dataset.sec = 'missions';
  const themes = (S.missions.themes || Object.keys(THEME)).filter((t) => all.some((m) => m.theme === t));
  if (S.theme !== 'all' && !themes.includes(S.theme)) S.theme = 'all';
  root.appendChild(chips([{ key: 'all', label: 'All', n: all.length }].concat(themes.map((t) => ({ key: t, label: THEME[t] || t, n: all.filter((m) => m.theme === t).length }))),
    S.theme, (k) => { S.theme = k; history.replaceState(null, '', location.search + '#whatnow/missions'); render(); }, 'themes'));
  const list = all.filter((m) => S.theme === 'all' || m.theme === S.theme);
  const box = el('div', 'missions');
  list.forEach((m) => box.appendChild(missionRow(m)));
  root.appendChild(box);
  sur.addEventListener('click', () => surprise(box));
  root.appendChild(cards.caught({
    title: S.theme === 'all' ? 'That’s the hundred' : 'That’s every ' + (THEME[S.theme] || S.theme).toLowerCase() + ' mission',
    text: plural(doneCount(), 'mission', 'missions') + ' done so far. They come from the Brief’s Top 100 guide, ranked by how essential each one is to Burlington.',
    buttons: [button(ICON.shuffle + ' Surprise me', '', () => surprise(box))],
  }));
}

function missionRow(m) {
  const on = isDone(m.k);
  const r = el('div', 'lrow mission' + (on ? ' done' : ''));
  r.dataset.k = m.k;
  const hoods = [...new Set((m.places || []).map((p) => p.neighborhood).filter((h) => h && h !== 'Greater Burlington'))];
  const meta = [THEME[m.theme] || m.theme, (m.places || []).length > 1 ? plural(m.places.length, 'place', 'places') : '', hoods.slice(0, 2).join(', ')].filter(Boolean).join(' · ');
  const open = el('button', 'open', '<div class="t">' + esc(m.title) + '</div><div class="s">' + esc(meta) + '</div>');
  open.setAttribute('aria-label', 'Mission ' + m.n + ': ' + m.title + '. Read it');
  open.addEventListener('click', () => missionSheet(m));
  r.append(el('span', 'num', esc(m.n)), open, doneButton(m));
  return r;
}

function doneButton(m, after) {
  const on = isDone(m.k);
  const b = el('button', 'pillbtn markdone' + (on ? ' on' : ''), on ? ICON.check + ' Done' : 'Mark done');
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.setAttribute('aria-label', (on ? 'Done: ' : 'Mark done: ') + m.title);
  b.addEventListener('click', () => { setDone(m, !isDone(m.k)); if (after) after(); });
  return b;
}

function setDone(m, on) {
  if (on) done[m.k] = Math.floor(Date.now() / 1000); else delete done[m.k];
  if (!app.demo) { store.write(DONE_KEY, done); pushDone(m.k, on); }
  app.toast(on ? 'Mission ' + m.n + ' done' : 'Mission ' + m.n + ' unmarked');
  const y = panel() ? panel().scrollTop : 0;
  render();
  app.paintSubnav();
  if (panel()) panel().scrollTop = y;
}

/* Surprise me: a mission you haven't done (any, once they all are), the list
   scrolled to it, a short glow, and focus on it so a keyboard or a screen
   reader lands there too. Under reduced motion there is no glow and no
   smooth scroll; the focus ring marks it. */
function surprise(box) {
  const rows = [...box.querySelectorAll('.lrow')];
  if (!rows.length) return;
  const open = rows.filter((r) => !r.classList.contains('done'));
  const pool = open.length ? open : rows;
  const r = pool[Math.floor(Math.random() * pool.length)];
  rows.forEach((x) => x.classList.remove('hl'));
  void r.offsetWidth;
  r.classList.add('hl');
  app.jumpTo(r);
  r.querySelector('.open').focus({ preventScroll: true });
  setTimeout(() => r.classList.remove('hl'), 2400);
}

function missionSheet(m) {
  app.sheet(m.n + '. ' + m.title, (body, card, close) => {
    const paint = () => {
      body.innerHTML = '';
      body.appendChild(el('p', 'sheet-note', esc([THEME[m.theme] || m.theme, 'Mission ' + m.n + ' of ' + missions().length].join(' · '))));
      body.appendChild(el('p', 'pick-why', esc(m.paragraph)));
      const places = (m.places || []).filter((p) => p && p.name);
      if (places.length) {
        body.appendChild(el('div', 'sheet-h', esc(places.length === 1 ? 'The place' : 'The places')));
        places.forEach((p) => {
          const row = el('div', 'sheet-row');
          const sub = [p.neighborhood, p.nearby ? 'nearby' : ''].filter(Boolean).join(' · ');
          const label = esc(p.name) + (sub ? '<div class="d">' + esc(sub) + '</div>' : '');
          if (/^https?:/i.test(p.url || '')) {
            const a = el('a', 't', label);
            a.href = safeHref(p.url); a.target = '_blank'; a.rel = 'noopener';
            if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens ' + p.name + '’s site in the real build'); });
            row.append(a, el('span', 'note', ICON.ext));
          } else row.appendChild(el('div', 't', label));
          body.appendChild(row);
        });
      }
      const btns = el('div', 'linkrow');
      btns.append(doneButton(m, paint), button(ICON.share + ' Share', 'ghost sm', () => app.share(KEY, m.k, m.title)));
      body.appendChild(btns);
    };
    paint();
  });
}

/* Signed in, Mark done also lives on the reader's account. Every call fails
   soft: no session, no function yet, offline, it all leaves the device copy
   standing. Marks from the account are merged in, never subtracted. */
function rpcAs(fn, args) {
  if (app.demo || !app.user()) return Promise.resolve(null);
  return Promise.resolve(app.token()).then((tok) => {
    if (!tok) return null;
    const ctl = 'AbortController' in window ? new AbortController() : null;
    const t = ctl && setTimeout(() => ctl.abort(), 8000);
    return fetch(SB_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
      ...(ctl ? { signal: ctl.signal } : {}),
    }).then((r) => (r.ok ? r.json().catch(() => null) : null)).finally(() => { if (t) clearTimeout(t); });
  }).catch(() => null);
}
const touched = new Set();
const queue = Object.create(null);
function pushDone(k, on) {
  touched.add(k);
  queue[k] = (queue[k] || Promise.resolve()).then(() => rpcAs('nn_mission_set', { p_key: k, p_done: !!on }));
}
function pullDone() {
  rpcAs('nn_missions_done').then((rows) => {
    if (!Array.isArray(rows)) return;
    let added = 0;
    rows.forEach((r) => {
      const k = r && (r.key || r.mission);
      if (typeof k === 'string' && /^m\d+$/.test(k) && !done[k] && !touched.has(k)) { done[k] = Math.floor(Date.now() / 1000); added++; }
    });
    if (added) { store.write(DONE_KEY, done); if (ready) repaint(); }
  });
}

/* ---------------------------------------------------------------- Tonight */
/* Today's events from 5 pm on, in Burlington's clock. One that has ended,
   or started two hours ago with no end given, has gone. A cancelled one,
   or the same listing twice, is left out. */
function tonight() {
  const evs = S.events && Array.isArray(S.events.events) ? S.events.events : [];
  const now = Date.now();
  const today = et(now).date;
  const seenK = new Set();
  return evs.filter((e) => {
    if (!e || !e.id || !e.title || !e.url || e.allDay || (e.status && e.status !== 'active')) return false;
    if (/^\s*(cancel+ed|postponed)\b/i.test(e.title)) return false;
    const start = Date.parse(e.start);
    if (!start) return false;
    const t = et(start);
    if (t.date !== today || t.hour < EVENING) return false;
    const end = Date.parse(e.end) || 0;
    if (end ? end < now : start < now - 2 * 3600000) return false;
    const sig = e.title.toLowerCase().replace(/[^a-z0-9]+/g, '') + '|' + start;
    if (seenK.has(sig)) return false;
    seenK.add(sig);
    return true;
  }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

const priceOf = (e) => {
  if (e.free) return 'Free';
  const p = String(e.price || '').split(/[;|]/)[0].replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  return trim(p, 36);
};

function eventCard(e) {
  const start = Date.parse(e.start);
  const t = et(start);
  const where = (e.venue || e.town || 'Burlington') + (e.town && e.venue && e.town !== 'Burlington' ? ', ' + e.town : '');
  return {
    k: 'e-' + e.id, href: e.url, kind: 'event', title: e.title.replace(/^['‘’"“]+|['‘’"“]+$/g, ''),
    src: e.venue || e.town || 'Calendar', sid: 'venue:' + (e.venue || e.town || 'calendar').toLowerCase(),
    dow: dowFmt.format(utcNoon(t.date)), dom: String(t.dom), when: clock(start).replace(/(\d)([ap]m)$/, '$1 $2'), where, price: priceOf(e),
  };
}

/* the artists with a show tonight or in the next seven days, soonest first */
function artists() {
  const list = S.music && Array.isArray(S.music.artists) ? S.music.artists : [];
  const today = et(Date.now()).date;
  const last = addDays(today, WEEK - 1);
  return list.map((a) => {
    const shows = (Array.isArray(a.shows) ? a.shows : []).filter((s) => s && s.date >= today && s.date <= last).sort((x, y) => (x.date < y.date ? -1 : 1));
    return shows.length && a.id && a.name ? { a, s: shows[0] } : null;
  }).filter(Boolean).sort((x, y) => (x.s.date < y.s.date ? -1 : x.s.date > y.s.date ? 1 : 0));
}

function renderTonight() {
  const muted = store.muted();
  const list = tonight().map(eventCard).filter((c) => !muted[c.sid]);
  app.know(list);
  /* the artists first: a short shelf, and the old Music tab's whole job,
     which would be lost under a long night of listings */
  const acts = artists();
  if (acts.length) {
    const sec = section(root, 'Playing this week', esc('Local artists with a show in the next seven days. Listen opens their Bandcamp player; nothing plays until you press play.'));
    sec.dataset.sec = 'artists';
    const box = el('div', 'artists');
    acts.forEach((x) => box.appendChild(artistRow(x.a, x.s)));
    root.appendChild(box);
  }
  const head = section(root, 'Tonight', esc(list.length ? plural(list.length, 'thing', 'things') + ' from 5 pm on, from the calendar the newsletter uses.' : 'From 5 pm on, from the calendar the newsletter uses.'));
  head.dataset.sec = 'tonight';
  if (!S.events) root.appendChild(el('p', 'loading', 'Loading tonight…'));
  else if (!list.length) root.appendChild(el('p', 'note pad', esc('Nothing else on the calendar tonight.')));
  const feed = el('div', 'feed');
  list.forEach((c) => put(feed, cards.event(c)));
  root.appendChild(feed);
  app.bindFeed(feed);
  root.appendChild(cards.caught({
    title: 'That’s tonight',
    text: 'The whole calendar, further out than tonight, is on the events page.',
    buttons: [openLink('Every event', EVENTS_URL, true)],
  }));
}

function artistRow(a, s) {
  const today = et(Date.now()).date;
  const day = s.date === today ? 'Tonight' : s.date === addDays(today, 1) ? 'Tomorrow' : dayFmt.format(utcNoon(s.date));
  const k = 'a-' + a.id;
  const wrap = el('div', 'artist');
  const r = el('div', 'lrow');
  r.dataset.k = k;
  const pic = a.bandcamp && a.bandcamp.art;
  const show = [s.venue, s.time, s.free ? 'Free' : trim(s.price, 24)].filter(Boolean).join(' · ');
  const why = a.why || (a.genre ? a.genre.charAt(0).toUpperCase() + a.genre.slice(1) : '');
  const name = /^https?:/i.test(s.url || '') ? '<a class="t" href="' + esc(safeHref(s.url)) + '" target="_blank" rel="noopener">' + esc(a.name) + '</a>' : '<div class="t">' + esc(a.name) + '</div>';
  r.innerHTML = (pic ? '<span class="th">' + art(pic) + '</span>' : '<span class="th bare">' + ICON.listen + '</span>') +
    '<div>' + name + '<div class="s"><b>' + esc(day) + '</b> · ' + esc(show) + '</div>' + (why ? '<div class="s">' + esc(why) + '</div>' : '') + '</div>';
  if (app.demo) r.querySelectorAll('a.t').forEach((x) => x.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the show’s page in the real build'); }));
  const album = a.bandcamp && /^\d+$/.test(String(a.bandcamp.album || '')) ? String(a.bandcamp.album) : '';
  if (album) {
    const b = el('button', 'pillbtn listen', ICON.play + ' Listen');
    b.setAttribute('aria-label', 'Listen to ' + a.name + ' on Bandcamp');
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => toggleBandcamp(wrap, b, a, album));
    r.appendChild(b);
  }
  wrap.appendChild(r);
  return wrap;
}

/* One Bandcamp player at a time, built on the tap, never playing until its
   own play button is pressed. Opening it pauses the shell's player; the
   shell playing anything resets it (registerForeign), so two things never
   sound at once. Bandcamp paints its own player, so it is told the theme. */
let embed = null;
function closeBandcamp() {
  if (!embed) return;
  embed.unreg();
  embed.box.remove();
  embed.btn.innerHTML = ICON.play + ' Listen';
  embed.btn.classList.remove('on');
  embed.btn.setAttribute('aria-expanded', 'false');
  embed = null;
}
function toggleBandcamp(wrap, btn, a, album) {
  const same = embed && embed.btn === btn;
  closeBandcamp();
  if (same) return;
  if (app.isPlaying()) app.stop();
  app.closeVideo();
  const doc = document.documentElement;
  const dark = doc.getAttribute('data-theme') === 'dark' || (!doc.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  const box = el('div', 'hero bc');
  if (app.demo) {
    box.appendChild(el('p', 'note', esc('The Bandcamp player for “' + ((a.bandcamp && a.bandcamp.title) || a.name) + '” goes here in the real build.')));
  } else {
    const f = el('iframe', 'embed bandcamp');
    f.src = 'https://bandcamp.com/EmbeddedPlayer/album=' + encodeURIComponent(album) + '/size=large/bgcol=' + (dark ? '181a1f' : 'ffffff') +
      '/linkcol=' + (dark ? 'e8a33d' : '9a5b00') + '/artwork=small/transparent=true/';
    f.title = a.name + ' on Bandcamp';
    f.loading = 'lazy';
    box.appendChild(f);
  }
  wrap.appendChild(box);
  const unreg = app.registerForeign(() => closeBandcamp());
  embed = { box, btn, unreg };
  btn.innerHTML = ICON.x + ' Close';
  btn.classList.add('on');
  btn.setAttribute('aria-expanded', 'true');
}

/* ------------------------------------------------------------------ bits */
const panel = () => (root ? root.closest('.panel') : null);

/* An "Open ↗" link. Demo links go nowhere, and say so; the events page is ours. */
function openLink(label, href, ours) {
  const a = el('a', 'btn ghost sm', esc(label) + ' ' + ICON.ext);
  a.href = safeHref(href);
  if (!ours) { a.target = '_blank'; a.rel = 'noopener'; }
  if (app.demo && !ours) a.addEventListener('click', (e) => { e.preventDefault(); app.toast(label + ' opens in the real build'); });
  return a;
}

function stopReel() {
  if (!S.rolling) return;
  reel++;
  S.rolling = false;
  S.answer = null;
}

function setMode(mode) {
  stopReel();
  S.mode = mode;
  history.replaceState(null, '', location.search + '#whatnow/' + mode);
  app.paintSubnav();
  render();
  app.scrollTop();
}

/* #whatnow/spin|missions|tonight picks the mode; #whatnow/m14 opens a
   mission in the list and flashes it; #whatnow/e-<id> a card tonight. */
function land() {
  if (!pending || !ready) return;
  const k = pending; pending = null;
  if (MODES.includes(k)) { if (S.mode !== k) setMode(k); return; }
  const want = /^m\d+$/.test(k) ? 'missions' : /^[ea]-/.test(k) ? 'tonight' : null;
  if (want && (S.mode !== want || (want === 'missions' && S.theme !== 'all'))) { stopReel(); S.mode = want; S.theme = 'all'; app.paintSubnav(); render(); }
  if (!app.flashHit(root, k)) app.toast(want === 'missions' ? 'That mission isn’t on the list any more.' : 'That one has passed.');
}

app.register(KEY, {
  label: 'What Now',
  icon: ICON.whatnow,
  promise: 'One answer for right now, a hundred missions for later, and what is on tonight.',
  mount(r) {
    root = r;
    r.innerHTML = '<p class="loading">Reading the sky…</p>';
    loaded = load();
    loaded.then(() => {
      ready = true;
      render();
      if (app.activeTab() === KEY) app.paintSubnav();
      land();
      app.recount();
    }).catch(() => { r.innerHTML = '<div class="errbox"><b>What Now didn’t load.</b> Reload to try again.</div>'; });
  },
  activate(param) { pending = param || null; land(); },
  refresh() { if (ready) render(); },
  deactivate() { stopReel(); closeBandcamp(); app.closePeek(); },
  subnav() {
    if (!ready) return null;
    return chips([
      { key: 'spin', label: 'Spin', icon: ICON.shuffle },
      { key: 'missions', label: 'Missions', n: S.missions ? doneCount() + '/' + missions().length : null },
      { key: 'tonight', label: 'Tonight', n: S.events ? tonight().length : null },
    ], S.mode, (k) => { if (k !== S.mode) setMode(k); else app.scrollTop(true); });
  },
  /* Nothing here is a feed that grows while you are away, so the dot stays off. */
  newSince() { return 0; },
});
