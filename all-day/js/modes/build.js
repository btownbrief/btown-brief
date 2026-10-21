/* The Build: pick one thing you want to finish, set the phone down face-up,
   and go do it. While the phone sits there your builder works on a drawing
   of Watershed, the building going up on Lakeside Avenue, beside every other
   neighbor on shift. Stephen's spec is the vision (newsletter repo,
   reference/drafts/new-nine-2026-10/the-build/SPEC.md), with his later word
   on the layout: "something useful AND something gamified ... the top half
   I envision something useful and easy to visually see, like people posting
   on Twitter, where people can chime in with help easily", and the site in
   the bottom half, which can be expanded.

   The tab took Habits' cell on the bar. A Build | Habits switch floats under
   the mast, the same as On Air's TV | Podcasts; Build is the default and
   Habits is the tracker as it stood (modes/habits.js, untouched, its own
   panel and its own #habits links). The one bridge: a habit tapped done
   drops a pallet on the site (the town's habit drops, counted by the
   server, raise the building a little).

   The Build side:
   - On top, the useful part. Your thing (its name, why it matters, this
     week's hours off your phone) with Start shift, Log it and Post; with
     no thing yet, naming one and four to borrow. Then neighbors, newest
     first, one line each: Nice on any post, and on a Stuck post a big
     "I can help" that opens a one-line reply right in the post.
   - At the bottom, the site (js/build-site.js) in a docked panel with a
     handle: drag or tap it up to full screen, down to just the town line.
     Alive while docked: the crew on shift, the floors, posts lighting
     windows, the real sun.
   - A shift is the site full screen with the screen held awake. The clock
     is build-core.js's: working while the app is open, waiting while it is
     not; the foreman's whistle 15 to 30 minutes after the last touch, a
     buzz and a raised hand on the site, three minutes to touch the phone or
     pick it up; missed, the crew knocks off with the time to the last touch
     banked. Clocking out: the time, one line, Keep it or Post.

   No streaks, ranks, percentages or comments (DESIGN.md, the spec's "What
   we deliberately don't do"). Words: data/build-foreman.json. Numbers:
   data/build-config.json. Data: the Build API (build-local.js openBuild). */

import * as app from '../app.js';
import * as store from '../store.js';
import { el, esc, svg, ICON, button, pills, mark, agoShort } from '../ui.js';
import { liquify } from '../liquid.js';
import * as boards from '../boards.js';
import { photoUrl, queuePhoto } from '../boards.js';
import { REASON_LABELS } from '../boards-core.js';
import { meetsInWindow, oneLine, redateDemo, timeLabel } from '../clubs-week.js';
import { openBuild } from '../build-local.js';
import { createSite } from '../build-site.js';

const KEY = 'build';
export const ICON_BUILD = svg('<path d="M3 17.5h18M5 17.5v-1.2a7 7 0 0 1 14 0v1.2"/><path d="M10 10V7.2a2 2 0 0 1 4 0V10"/>');
const SIDE_KEY = 'allday-build-side';      // the side last on: 'build' | 'habits'
const DOCK_KEY = 'allday-build-dock';      // the site panel: 'mini' | 'dock'
const SEEN_KEY = 'allday-build-back';      // the coming-back question, answered on this day
const COUNT_KEY = 'allday-build-count';    // shifts clocked out on this phone, for the rare "why"
const ENDING_KEY = 'allday-build-ending';  // a clocked-out shift whose end screen is open: { minutes, missed }
const SEEN_AT_KEY = 'allday-build-alive';  // the shift screen's last second on screen, for recovery
const GAP_DAYS = 4;                        // this long with no hours and the next visit asks where to pick up
const STALE_MS = 30 * 60000;               // a shift whose screen went dark longer than this opens on its end screen
const LAT = 44.4759, LON = -73.2121;       // Burlington, for the site's sun
const KINDS = ['progress', 'stuck', 'found', 'finished'];
const NEED_REASON = { hand: 'missing', tool: 'missing', smaller: 'too_big', different: 'unsure' };
const HATS = [['yellow', '--sunset'], ['orange', '--liq-food'], ['red', '--liq-build'], ['blue', '--liq-square'], ['green', '--liq-lists'], ['white', '--raised']];

/* ------------------------------------------------------------------ words */
/* The foreman's lines (data/build-foreman.json). What stands in until the
   file loads, or if it never does, is the smallest set the tab needs. */
const FOREMAN = {
  clock_in: { prompts: ['What’s the job?'], placeholder: ['outline chapter 3'], start: 'Start' },
  clock_out: { prompts: ['What got done?'], placeholder: ['got the first page down'], rare_why: { every: 10, prompts: ['Why’s this one matter to you?'], placeholder: ['I said I would'] } },
  whistle: { knocked_off: ['Crew knocked off. Everything up to the last whistle is banked.'] },
  end_screen: { time: '{duration} on the job', keep: 'Keep it', post: 'Post', kept: ['Kept. It still went into the building.'],
    post_kinds: { progress: 'Made progress', stuck: 'Stuck', found: 'Found something', finished: 'Finished' },
    stuck_question: 'What would help you take the next step?', add_hours: 'Add the hours', brief_ok: 'OK to print this in the Brief',
    posted: ['Posted. A window’s lit on the street side.'], finished_posted: 'Posted. Bring this one to the party.' },
  stuck: { help_buttons: [{ key: 'hand', label: 'A hand' }, { key: 'tool', label: 'A tool' }, { key: 'smaller', label: 'A smaller job' }, { key: 'different', label: 'A different job' }] },
  help: { offer_button: 'I can help', offer_placeholder: 'I’ve got a stand and a Tuesday', offered: 'Sent. If they say yes, you’ll both get an email.',
    poster_sees: '{name} can help.', yes: 'Yes', no: 'No thanks', accepted: 'Done. You’ll both get an email with the other’s address.', declined: 'No problem. Nobody hears about it.', nice: 'Nice' },
  come_back: { lines: ['Coffee’s on. Your tools are where you left them.'], buttons: [{ key: 'same', label: 'Same job' }, { key: 'smaller', label: 'Smaller job' }, { key: 'new', label: 'New job' }] },
  site_talk: [{ text: '{hours} hours in the building this week.' }],
  log_it: { title: 'Log it after', how_long: 'Roughly how long?', chips: [15, 30, 60, 90, 120], what: 'What was it?', what_placeholder: 'a run, a bike repair', save: 'Log it', saved: ['Logged. It’s in the building.'] },
  town: { line: '{crew} neighbors on shift · {hours} hours this week · floor {floor} of {floors}', line_none: 'Nobody on shift right now · {hours} hours this week · floor {floor} of {floors}' },
  party: { no_date: 'Topping out party. Date coming.', upcoming: 'Topping out {date}. Everyone who put hours in signs the beam.', today: 'Topping out today. The beam’s waiting for your name.' },
};
const CONFIG = { hours_per_floor: 25, floors: 6, roof: true, season: { building: 'watershed', starts: null, topping_out_date: null, party_url: '' }, rare_why_every: 10 };

/* ------------------------------------------------------------------ state */
const B = {
  root: null, body: null, side: 'build', active: false,
  phase: 'loading', failed: null,
  api: null, apiFor: undefined,
  thing: undefined, town: null, days: [], shelf: [], feed: [], offers: [], builder: null,
  foreman: FOREMAN, config: CONFIG, starters: null, firstStep: '',
  draft: null,           // a thing being named: { step: 'name' | 'more', title, first_step }
  only: 'all',           // the feed: 'all' | 'stuck'
  back: false,           // the coming-back question is up
  cut: false,            // the cutaway is showing
  flash: null,           // a #build/<key> link waiting for its card
  replying: null,        // the Stuck post whose reply line is open
  scope: ['today', 'week', 'season'].includes(store.read('allday-build-scope', 'week')) ? store.read('allday-build-scope', 'week') : 'week',
  season: null,          // your minutes this season (record.get)
};
let site = null, dock = null, canvas = null, talkTimer = 0, skyTimer = 0, loadGen = 0;
const lastLine = Object.create(null);
const signedIn = () => !!app.user();
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const FAIL = 'That didn’t go through. Try again.';
/* every API door resolves { ok, ... } and never rejects; this keeps a
   thrown error from becoming one */
const go = (fn) => Promise.resolve().then(fn).then((r) => (r && typeof r === 'object' ? r : { ok: false, message: FAIL }), () => ({ ok: false, message: FAIL }));

/* ------------------------------------------------------------- the server */
function api() {
  const who = app.demo ? 'demo' + (signedIn() ? ':in' : '') : signedIn() ? 'u:' + app.user().id : 'local';
  if (!B.api || B.apiFor !== who) {
    /* the demo's town opened three days ago, so its building is part way up */
    const config = app.demo && !B.config.season.starts ? { ...B.config, season: { ...B.config.season, starts: keyBack(dayKey(Date.now()), 3) } } : B.config;
    B.starts = config.season && config.season.starts || null;
    B.api = openBuild({ demo: app.demo, user: () => app.user(), token: () => app.token(), url: store.SB_URL, key: store.SB_KEY, config });
    B.apiFor = who;
  }
  return B.api;
}

/* ------------------------------------------------------------------ files */
const getJSON = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
let filesAsk = null;
function loadFiles() {
  if (filesAsk) return filesAsk;
  filesAsk = Promise.all([getJSON('data/build-foreman.json'), getJSON('data/build-config.json')]).then(([f, c]) => {
    if (f && typeof f === 'object') B.foreman = { ...FOREMAN, ...f };
    if (c && typeof c === 'object') {
      /* the config file names the floor rule HOURS_PER_FLOOR; the API reads hours_per_floor */
      B.config = { ...CONFIG, ...c, hours_per_floor: Number(c.hours_per_floor || c.HOURS_PER_FLOOR) || CONFIG.hours_per_floor,
        season: { ...CONFIG.season, ...(c.season || {}) } };
    }
    B.api = null;   // the API reads the config: build it again with the real one
  });
  return filesAsk;
}

/* the foreman: one line from a group, never the same twice running */
function pick(group, list, vars) {
  const xs = (Array.isArray(list) ? list : typeof list === 'string' ? [list] : []).filter((x) => typeof x === 'string' && x);
  if (!xs.length) return '';
  let i = Math.floor(Math.random() * xs.length);
  if (xs.length > 1 && i === lastLine[group]) i = (i + 1) % xs.length;
  lastLine[group] = i;
  return fill(xs[i], vars);
}
const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
const dig = (root, path) => { let v = root; for (const k of path.split('.')) v = v && typeof v === 'object' ? v[k] : undefined; return v; };
const F = (path, fallback) => { const v = dig(B.foreman, path); if (v != null) return v; const w = dig(FOREMAN, path); return w == null ? fallback : w; };
const lower = (x) => String(x || '').replace(/^(My|Our|The|A|An|Your)\b/, (w) => w.toLowerCase());
const kindWord = (k) => F('end_screen.post_kinds.' + k, k);

/* ---------------------------------------------------------------- numbers */
export function hm(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return r + 'm';
  return r ? h + 'h ' + r + 'm' : h + 'h';
}
const short = (m) => (m < 60 ? Math.round(m) + 'm' : (Math.round(m / 6) / 10).toString().replace(/\.0$/, '') + 'h');
const dayKey = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const keyBack = (key, n) => new Date(Date.parse(key + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10);
const dateWord = (key) => new Date(key + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const etHour = () => Number(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' })) % 24;
function floors() {
  const t = B.town || {};
  const total = Math.max(1, Number(B.config.floors) || 6);
  const done = Math.max(0, Number(t.floors_done) || 0);
  return { total, done, progress: Math.max(0, Math.min(1, Number(t.floor_progress) || 0)), topped: !!t.topped_out, going: Math.min(total, done + 1) };
}
const crewNow = () => Math.max(Number(B.town && B.town.on_shift_count) || 0, B.town && Array.isArray(B.town.on_shift) ? B.town.on_shift.length : 0);
const live = () => { const e = ending(); if (e) return Number(e.minutes) || 0; const s = status(); return s && s.state !== 'missed' ? Number(s.minutes) || 0 : 0; };
const todayMinutes = () => { const k = dayKey(Date.now()); const d = B.days.find((x) => x.day === k); return (d ? Number(d.minutes) || 0 : 0) + live(); };
const seasonMinutes = () => (B.season != null ? B.season : yourMinutes()) + live();
function mineInner() {
  const cell = (n, label) => '<span class="bd-stat"><b>' + esc(hm(n)) + '</b><span>' + esc(label) + '</span></span>';
  return cell(todayMinutes(), 'today') + cell(weekMinutes() + live(), 'this week') + cell(seasonMinutes(), 'this season') + ICON.right;
}
const monday = () => { const t = dayKey(Date.now()); return keyBack(t, (new Date(t + 'T12:00:00Z').getUTCDay() + 6) % 7); };
/* this week runs from Monday, as the town's does, and never reaches back before the season opened */
const weekMinutes = () => { const from = monday(); let n = 0; B.days.forEach((d) => { if (d.day >= from && (!B.starts || d.day >= B.starts)) n += Number(d.minutes) || 0; }); return n; };
const yourMinutes = () => B.days.reduce((n, d) => n + (Number(d.minutes) || 0), 0);

/* -------------------------------------------------------------- loading */
function load() {
  const my = ++loadGen;
  B.phase = 'loading';
  B.failed = null;
  paint();
  return loadFiles().then(() => {
    const a = api();
    return Promise.all([go(() => a.thing.get()), go(() => a.town.get()), go(() => a.record.get()), go(() => a.shelf.get()),
      go(() => a.feed.list()), go(() => a.builder.get()), signedIn() ? go(() => a.help.list()) : Promise.resolve({ ok: false })]);
  }).then(([t, town, rec, shelf, feed, bld, help]) => {
    if (my !== loadGen) return;
    if (!t.ok && !feed.ok) { B.failed = t.message || FAIL; B.phase = 'ready'; paint(); return; }
    B.thing = t.ok && t.thing && t.thing.status !== 'done' ? t.thing : null;
    B.town = town.ok ? town.town : null;
    B.days = rec.ok && Array.isArray(rec.days) ? rec.days : [];
    B.season = rec.ok && Number.isFinite(rec.season_minutes) ? rec.season_minutes : null;
    B.shelf = shelf.ok && Array.isArray(shelf.posts) ? shelf.posts : [];
    B.feed = feed.ok && Array.isArray(feed.posts) ? feed.posts : [];
    B.builder = bld.ok && bld.builder ? bld.builder : null;
    B.offers = help.ok && Array.isArray(help.incoming) ? help.incoming : [];
    B.back = !!B.thing && cameBack();
    B.phase = 'ready';
    paint();
    land();
    feedSite();
    paintDock();
  });
}
/* the town and the feed again: after a shift, a post, a pull */
function reload() {
  const a = api();
  return Promise.all([go(() => a.town.get()), go(() => a.feed.list()), go(() => a.record.get()), go(() => a.shelf.get()),
    signedIn() ? go(() => a.help.list()) : Promise.resolve({ ok: false })]).then(([town, feed, rec, shelf, help]) => {
    if (town.ok) B.town = town.town;
    if (feed.ok && Array.isArray(feed.posts)) B.feed = feed.posts;
    if (rec.ok && Array.isArray(rec.days)) { B.days = rec.days; B.season = Number.isFinite(rec.season_minutes) ? rec.season_minutes : null; }
    if (shelf.ok && Array.isArray(shelf.posts)) B.shelf = shelf.posts;
    if (help.ok && Array.isArray(help.incoming)) B.offers = help.incoming;
    if (B.phase === 'ready') { paint(); feedSite(); paintDock(); }
  });
}

/* after a gap the tab asks one question instead of showing a thing that
   looks neglected, and never says how long */
function cameBack() {
  if (store.read(SEEN_KEY, '') === dayKey(Date.now())) return false;
  let last = 0;
  B.days.forEach((d) => { if ((Number(d.minutes) || 0) > 0) last = Math.max(last, Date.parse(d.day + 'T12:00:00Z')); });
  const since = last || Date.parse((B.thing && B.thing.created_at) || '') || 0;
  return !!since && Date.now() - since >= GAP_DAYS * 86400000;
}

/* --------------------------------------------------------------- drawing */
function paint() {
  if (!B.body) return;
  const open = B.body.querySelector('.bd-reply input[name=line]');
  const draft = open ? open.value : '';
  B.body.innerHTML = '';
  const wrap = el('div', 'bd');
  B.body.appendChild(wrap);
  if (B.phase === 'loading') { wrap.appendChild(el('div', 'bd-skel', '<span class="skel w60"></span><span class="skel big"></span><span class="skel pill"></span>')); return; }
  if (B.failed) {
    const box = el('div', 'bd-gate', '<p>' + esc(B.failed) + '</p>');
    box.appendChild(button('Try again', 'ghost', load));
    wrap.appendChild(box);
    return;
  }
  if (B.thing && B.back) wrap.appendChild(comebackCard());
  wrap.appendChild(B.thing ? thingCard() : nameCard());
  if (!B.thing && (!B.draft || B.draft.step === 'name')) wrap.appendChild(starterDoor());
  wrap.appendChild(counter());
  const today = todayStrip();
  if (today) wrap.appendChild(today);
  wrap.appendChild(feedSection());
  if (draft) { const i = B.body.querySelector('.bd-reply input[name=line]'); if (i) i.value = draft; }
}

/* ------------------------------------------------------------ your thing */
function thingCard() {
  const t = B.thing;
  const c = el('section', 'bd-thing');
  c.dataset.k = 'thing';
  const meta = [t.target_date ? 'By ' + dateWord(String(t.target_date).slice(0, 10)) : '', t.for_whom ? 'For ' + lower(t.for_whom) : '', t.partner ? 'With ' + t.partner : '', t.status === 'paused' ? 'Paused' : ''].filter(Boolean);
  c.innerHTML = '<h2 class="bd-title">' + esc(t.title) + '</h2>' +
    (t.why ? '<p class="bd-why">' + esc('“' + t.why + '”') + '</p>' : '') +
    (meta.length ? '<p class="bd-meta">' + meta.map(esc).join(' · ') + '</p>' : '');
  /* your hours off the phone: today, this week, the season. The number the
     tab is proudest of, yours alone; it counts up while a shift runs */
  const wk = el('button', 'bd-mine');
  wk.type = 'button';
  wk.setAttribute('aria-label', 'Your hours off your phone');
  wk.innerHTML = mineInner();
  wk.addEventListener('click', recordSheet);
  c.appendChild(wk);
  const row = el('div', 'bd-go');
  const start = button(ICON_BUILD + '<span>Start shift</span>', 'bd-start', () => clockIn());
  const log = button('Log it', 'ghost', logSheet);
  const post = button('Post', 'ghost', () => postSheet({ kind: 'progress', minutes: 0 }));
  const more = el('button', 'iconbtn bd-more', ICON.more);
  more.type = 'button';
  more.setAttribute('aria-label', 'More for your thing');
  more.addEventListener('click', thingSheet);
  row.append(start, log, post, more);
  c.appendChild(row);
  return c;
}

/* naming a thing: one line, then one card with why and the optional bits */
function nameCard() {
  const d = B.draft || (B.draft = { step: 'name' });
  const c = el('section', 'bd-thing bd-name');
  c.dataset.k = 'thing';
  const form = el('form', 'bd-form');
  form.noValidate = true;
  const field = (name, ph, value, type, max) => {
    const i = el('input', 'field');
    i.name = name; i.type = type || 'text'; i.placeholder = ph || ''; i.value = value || ''; if (max) i.maxLength = max;
    i.setAttribute('aria-label', ph || name);
    return i;
  };
  const row = (...kids) => { const r = el('div', 'bd-row'); r.append(...kids); return r; };
  if (d.step === 'name') {
    form.appendChild(el('h2', 'bd-ask', esc('What do you want to finish?')));
    const i = field('title', 'Fix my own bike', d.title, 'text', 80);
    i.setAttribute('aria-label', 'Your thing, in a line');
    const ok = button('Next', 'bd-start'); ok.type = 'submit';
    form.appendChild(row(i, ok));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = i.value.trim();
      if (!v) { i.focus(); return; }
      d.title = v.slice(0, 80); d.step = 'more'; paint(); focusField();
    });
    c.appendChild(form);
    return c;
  }
  /* why it matters, then the two optional questions (kept apart: who it is
     for, who is in on it) and a date, one card, one Done */
  form.appendChild(el('p', 'bd-kicker', esc(d.title)));
  form.appendChild(el('h2', 'bd-ask', esc('Why does it matter to you?')));
  form.appendChild(field('why', 'One line, or leave it', d.why, 'text', 280));
  const q = (label, input) => { const l = el('label', 'bd-q', '<span>' + esc(label) + '</span>'); l.appendChild(input); return l; };
  form.appendChild(q('Is it for someone?', field('for_whom', 'Yourself counts', d.for_whom, 'text', 80)));
  form.appendChild(q('Want someone in on it?', field('partner', 'A name', d.partner, 'text', 80)));
  form.appendChild(q('Finish by', field('target_date', '', d.target_date, 'date')));
  const ok = button('Done', 'bd-start'); ok.type = 'submit';
  const back = button('Back', 'ghost', (e) => { e.preventDefault(); d.step = 'name'; paint(); focusField(); });
  form.appendChild(row(ok, back));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const str = (k, n) => String(fd.get(k) || '').trim().slice(0, n);
    const date = str('target_date', 10);
    const thing = { title: d.title, why: str('why', 280), for_whom: str('for_whom', 80), partner: str('partner', 80), target_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null };
    ok.disabled = true;
    go(() => api().thing.set(thing)).then((r) => {
      ok.disabled = false;
      if (!r.ok) { app.toast(r.message || FAIL); return; }
      B.thing = r.thing || { ...thing, status: 'active' };
      if (d.first_step) B.firstStep = d.first_step;
      B.draft = null; B.back = false;
      paint();
      app.flashHit(B.body, 'thing');
    });
  });
  c.appendChild(form);
  return c;
}
function focusField() {
  requestAnimationFrame(() => { const i = B.body && B.body.querySelector('.bd-name input'); if (i && matchMedia('(hover: hover)').matches) i.focus({ preventScroll: true }); });
}

/* Four to borrow (data/build-starters.json): a Top 100+ mission, a club
   that meets this week, an Up For It idea that tipped, a neighbor's thing.
   A slot with nothing usable takes a fallback, so it always shows four. The
   picks hold still for a Burlington week. */
let startersAsk = null;
function loadStarters() {
  if (startersAsk) return startersAsk;
  const ideas = app.demo ? Promise.resolve(null) : fetch(store.SB_URL + '/rest/v1/rpc/uf_ideas_public', { method: 'POST',
    headers: { apikey: store.SB_KEY, Authorization: 'Bearer ' + store.SB_KEY, 'Content-Type': 'application/json' }, body: '{}' })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  startersAsk = Promise.all([getJSON('data/build-starters.json'), getJSON('../data/missions.json'),
    getJSON(app.demo ? 'data/demo/run-clubs.json' : '../data/run-clubs.json'), ideas, go(() => api().things.public())]).then(([st, mi, rc, uf, pub]) => {
    const rules = st && st.sources ? st.sources : {};
    const now = Date.now();
    const today = dayKey(now);
    const month = Number(today.slice(5, 7));
    const monday = keyBack(today, (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7);
    let seed = 0; for (const ch of monday) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const at = (list) => list[seed % list.length];
    const slots = {};
    /* a mission in season, the free, culture, play and outdoor themes first */
    const months = (rules.mission && rules.mission.season_months) || {};
    let done = {};
    try { done = JSON.parse(localStorage.getItem('allday-missions') || '{}') || {}; } catch (e) { done = {}; }
    const ms = (mi && Array.isArray(mi.missions) ? mi.missions : []).filter((m) => m && m.title && !m.needs_check && !done[m.mark] &&
      (!Array.isArray(months[m.mark]) || months[m.mark].includes(month)));
    const keen = ms.filter((m) => ['free', 'culture', 'play', 'outdoors'].includes(m.theme));
    if (ms.length) { const m = at(keen.length ? keen : ms); slots.mission = { k: 'st-' + m.k, kind: 'Top 100+', title: m.title, line: m.teaser || '', first_step: (rules.mission && rules.mission.first_step) || '' }; }
    /* the soonest run club this week, else the soonest meet */
    try {
      let doc = rc;
      if (app.demo && doc) doc = redateDemo(doc, now);
      const clubs = doc && Array.isArray(doc.clubs) ? doc.clubs : [];
      const meets = (meetsInWindow(clubs, now, now + 7 * 86400000) || []).filter((x) => x && x.club && x.club.newcomers &&
        !/dads only|members[- ]only|join first/i.test([x.club.what, x.club.schedule_note, x.meet && x.meet.note].join(' ')));
      const m = meets.find((x) => x.club.kind === 'run') || meets[0];
      if (m) {
        const when = Number(m.start || m.at || m.ms) || now;
        const wd = new Date(when).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' });
        const WD = new Date(when).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
        const time = m.meet && m.meet.time ? timeLabel(m.meet.time) : '';
        slots.meet = { k: 'st-club-' + m.club.id, kind: m.club.kind === 'run' ? 'Run club' : 'This week', title: m.club.name + ', ' + wd + (time ? ' ' + time : ''),
          thing: 'Go to ' + m.club.name + ' on ' + WD, line: oneLine(m.club.what || ''),
          first_step: m.meet && m.meet.where ? 'Show up at ' + m.meet.where + (time ? ' at ' + time : '') : '' };
      }
    } catch (e) { /* no week to show */ }
    /* an Up For It idea that tipped, newest first */
    const tipped = (Array.isArray(uf) ? uf : []).filter((x) => x && x.title && x.tipped_at && ['live', 'claimed'].includes(x.status) && (!Array.isArray(x.months) || !x.months.length || x.months.includes(month)))
      .sort((a, b) => String(b.tipped_at).localeCompare(String(a.tipped_at)));
    if (tipped[0]) { const x = tipped[0]; slots.upforit = { k: 'st-uf-' + (x.id || 0), kind: 'Up For It', title: x.title, line: (x.yes_count || 0) + ' neighbors said they’d go', first_step: 'Tap I’d go, then pick a night' }; }
    /* a neighbor's thing, a Finished one first */
    const things = pub.ok && Array.isArray(pub.things) ? pub.things : [];
    const th = things.find((x) => x.last_kind === 'finished') || things[0];
    if (th) slots.public = { k: 'st-t-' + th.id, kind: 'A neighbor', title: th.title, line: th.why ? '“' + th.why + '”' : (th.name ? th.name + ' is working on this' : 'A neighbor is working on this'), first_step: 'Name your own version of it' };
    /* fallbacks fill what is left */
    const spare = (st && Array.isArray(st.fallbacks) ? st.fallbacks : []).filter((x) => x && x.title && (!x.until || x.until >= today));
    let si = seed % Math.max(1, spare.length);
    const out = [];
    ((st && Array.isArray(st.slots) && st.slots) || ['mission', 'meet', 'upforit', 'public']).forEach((slot) => {
      if (slots[slot]) { out.push(slots[slot]); return; }
      if (!spare.length) return;
      const x = spare[si++ % spare.length];
      out.push({ k: 'st-' + x.id, kind: 'Try this', title: x.title, line: x.line || '', first_step: x.first_step || '' });
    });
    B.starters = out.slice(0, (st && st.show) || 4);
    /* only the door redraws: never the card someone may be typing in */
    const door = B.body && B.body.querySelector('.bd-door');
    if (door) door.replaceWith(starterDoor());
  });
  return startersAsk;
}
function starterDoor() {
  const s = el('section', 'bd-door');
  s.dataset.k = 'starters';
  s.appendChild(el('div', 'bd-head', '<h2>Or borrow one</h2>'));
  if (!B.starters) { s.appendChild(el('div', 'bd-skel', '<span class="skel w60"></span><span class="skel w40"></span>')); loadStarters(); return s; }
  const grid = el('div', 'bd-starters');
  B.starters.forEach((st) => {
    const c = el('button', 'bd-starter');
    c.type = 'button';
    c.dataset.st = st.k;
    c.innerHTML = '<span class="bd-skind">' + esc(st.kind) + '</span><span class="bd-st">' + esc(st.title) + '</span>' + (st.line ? '<span class="bd-swhy">' + esc(st.line) + '</span>' : '');
    c.addEventListener('click', () => { B.draft = { step: 'more', title: (st.thing || st.title).slice(0, 80), first_step: st.first_step || '' }; paint(); app.flashHit(B.body, 'thing'); focusField(); });
    grid.appendChild(c);
  });
  s.appendChild(grid);
  return s;
}

/* the thing's own sheet: finish it, pause it, change it, your builder */
function thingSheet() {
  app.sheet(B.thing.title, (body, card, close) => {
    const row = (label, cls, fn) => { const r = el('div', 'sheet-row', '<div class="t">' + esc(label[0]) + '</div>'); r.appendChild(button(esc(label[1]), cls, fn)); return r; };
    body.appendChild(row(['Finished it', 'Finished'], 'sm bd-start', () => { close(); finishThing(); }));
    const paused = B.thing.status === 'paused';
    body.appendChild(row([paused ? 'Paused' : 'Put it down for a while', paused ? 'Pick it up' : 'Pause'], 'ghost sm', () => {
      close();
      go(() => (paused ? api().thing.resume() : api().thing.pause())).then((r) => {
        if (!r.ok) { app.toast(r.message || FAIL); return; }
        B.thing = r.thing || { ...B.thing, status: paused ? 'active' : 'paused' };
        paint();
      });
    }));
    body.appendChild(row(['A different thing', 'Change'], 'ghost sm', () => { close(); B.draft = { step: 'name', title: B.thing.title }; B.thing = null; paint(); focusField(); }));
    body.appendChild(el('div', 'sheet-h', 'Your builder'));
    body.appendChild(builderForm());
  });
}
/* Your builder: a hard hat, and a name tag (a nickname or your first name,
   Stephen 2026-10-21: "so that it actually feels like a neighborhood").
   Neighbors see the tag on your posts; on the site only if you say so.
   inline: no Save button (the clock-in sheet saves it with Start). */
function builderForm(o = {}) {
  const f = el(o.inline ? 'div' : 'form', 'bd-form bd-builder' + (o.inline ? ' inline' : ''));
  if (!o.inline) f.noValidate = true;
  const b = B.builder || {};
  const hats = el('div', 'bd-hats');
  hats.setAttribute('role', 'group');
  hats.setAttribute('aria-label', 'Hard hat');
  let hat = b.hat || 'yellow';
  HATS.forEach(([h, tok]) => {
    const x = el('button', 'bd-hat' + (hat === h ? ' on' : ''));
    x.type = 'button'; x.dataset.hat = h; x.style.setProperty('--hat', 'var(' + tok + ')');
    x.setAttribute('aria-label', h + ' hard hat'); x.setAttribute('aria-pressed', hat === h ? 'true' : 'false');
    x.addEventListener('click', () => { hat = h; hats.querySelectorAll('.bd-hat').forEach((y) => { y.classList.toggle('on', y === x); y.setAttribute('aria-pressed', y === x ? 'true' : 'false'); }); });
    hats.appendChild(x);
  });
  f.appendChild(hats);
  const name = el('input', 'field bd-tag');
  name.name = 'first_name'; name.maxLength = 32; name.placeholder = 'Name tag: a nickname or your first name'; name.value = b.first_name || '';
  name.setAttribute('aria-label', 'Name tag, a nickname or your first name');
  f.appendChild(name);
  const show = el('label', 'bd-check', '<input type="checkbox" name="show"' + (b.first_name_public || (!b.first_name && o.inline) ? ' checked' : '') + '><span>Show it on the site</span>');
  f.appendChild(show);
  const values = () => ({ hat, first_name: name.value.trim().slice(0, 32), first_name_public: !!show.querySelector('input').checked });
  const saveIt = (next) => go(() => api().builder.set(next)).then((r) => {
    if (r.ok) { B.builder = r.builder || { ...b, ...next }; if (site) site.setYou(youState()); }
    return r;
  });
  if (o.inline) { f.save = () => { const v = values(); return v.first_name || v.hat !== b.hat ? saveIt(v) : Promise.resolve({ ok: true }); }; return f; }
  const save = button('Save', 'bd-start'); save.type = 'submit';
  f.appendChild(save);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    save.disabled = true;
    saveIt(values()).then((r) => {
      save.disabled = false;
      if (!r.ok) { app.toast(r.message || FAIL); return; }
      app.closeSheet();
      app.toast('Saved');
    });
  });
  return f;
}
function finishThing() {
  go(() => api().thing.finish()).then((r) => {
    if (!r.ok) { app.toast(r.message || FAIL); return; }
    B.thing = null; B.draft = { step: 'name' };
    paint();
    /* finishing gets its own post, and its own five minutes at the party */
    if (signedIn()) postSheet({ kind: 'finished', minutes: 0 });
  });
}

/* ------------------------------------------------------------ coming back */
function comebackCard() {
  const c = el('section', 'bd-back');
  c.dataset.k = 'back';
  c.appendChild(el('p', 'bd-foreman', esc(pick('come_back', F('come_back.lines', [])))));
  const r = el('div', 'bd-row');
  const done = () => { store.write(SEEN_KEY, dayKey(Date.now())); B.back = false; };
  (F('come_back.buttons', []) || []).forEach((x, i) => {
    const b = button(esc(x.label), i === 0 ? 'bd-start' : 'ghost', () => {
      done();
      if (x.key === 'new') { B.draft = { step: 'name' }; B.thing = null; paint(); focusField(); return; }
      paint();
      if (x.after) app.toast(x.after);
      if (x.key === 'smaller') clockIn({ smaller: true });
    });
    b.dataset.back = x.key;
    r.appendChild(b);
  });
  c.appendChild(r);
  return c;
}

/* ------------------------------------------------------- your record */
/* Hours off your phone by day or by week (never a streak), your part of
   the building, and your shelf: everything you posted about this thing. */
function recordSheet() {
  let scale = 'weeks';
  app.sheet('Hours off your phone', (body, card, close) => {
    const host = el('div', 'bd-record');
    const paintIt = () => {
      host.innerHTML = '';
      const byDay = new Map(B.days.map((d) => [String(d.day).slice(0, 10), d]));
      const today = dayKey(Date.now());
      const sum = (from, n) => { let m = 0, l = 0; for (let j = 0; j < n; j++) { const d = byDay.get(keyBack(from, j)); if (d) { m += Number(d.minutes) || 0; l += Number(d.logged) || 0; } } return { m, l }; };
      const bars = scale === 'days'
        ? Array.from({ length: 7 }, (_, i) => { const k = keyBack(today, 6 - i); return { label: new Date(k + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }), ...sum(k, 1), now: i === 6 }; })
        : Array.from({ length: 8 }, (_, i) => { const end = keyBack(today, (7 - i) * 7); return { label: i === 7 ? 'Now' : dateWord(keyBack(end, 6)), ...sum(end, 7), now: i === 7 }; });
      const head = el('div', 'bd-rhead');
      const big = scale === 'days' ? bars.reduce((n, b) => n + b.m, 0) : bars.reduce((n, b) => n + b.m, 0);
      head.appendChild(el('p', 'bd-big', '<b>' + esc(hm(big)) + '</b> <span>' + esc(scale === 'days' ? 'last 7 days' : 'last 8 weeks') + '</span>'));
      head.appendChild(pills([['weeks', 'Weeks'], ['days', 'Days']], scale, (v) => { scale = v; paintIt(); }, 'bd-scale'));
      host.appendChild(head);
      const max = Math.max(60, ...bars.map((b) => b.m));
      const chart = el('div', 'bd-bars' + (scale === 'weeks' ? ' wk' : ''));
      chart.setAttribute('role', 'img');
      chart.setAttribute('aria-label', bars.map((b) => b.label + ' ' + hm(b.m)).join(', '));
      bars.forEach((b) => {
        const col = el('div', 'bd-bar' + (b.now ? ' now' : ''));
        col.innerHTML = '<span class="bd-v">' + (b.m ? esc(short(b.m)) : '') + '</span><span class="bd-track"><i class="sh" style="height:' + (Math.max(0, b.m - b.l) / max * 100).toFixed(1) +
          '%"></i><i class="lg" style="height:' + (b.l / max * 100).toFixed(1) + '%"></i></span><span class="bd-l">' + esc(b.label) + '</span>';
        chart.appendChild(col);
      });
      host.appendChild(chart);
      if (bars.some((b) => b.l)) host.appendChild(el('p', 'bd-key', '<i class="sh"></i>Shifts <i class="lg"></i>Logged'));
      host.appendChild(button('See your part of the building', 'ghost bd-cutbtn', () => { close(); setCut(true); setDock('full'); }));
      if (B.shelf.length) {
        host.appendChild(el('div', 'sheet-h', 'Your shelf'));
        const list = el('div', 'bd-shelf');
        B.shelf.forEach((p) => list.appendChild(el('div', 'bd-shelfrow k-' + esc(p.kind), '<p class="bd-kind">' + esc(kindWord(p.kind)) +
          ' · ' + esc(dateWord(String(p.created_at || today).slice(0, 10))) + '</p><p class="bd-sline">' + esc(p.line) + '</p>')));
        host.appendChild(list);
      }
    };
    paintIt();
    body.appendChild(host);
  });
}

/* The town's counter (Stephen, 2026-10-21: "people spent this many minutes
   building and doing productive things instead of doom scrolling"): the
   town's hours off its phones, today, this week or this season, shifts and
   Log it (habit pallets don't count). One number for everyone, never a
   name beside it. It counts up while your own shift runs. */
const SCOPES = [['today', 'Today'], ['week', 'This week'], ['season', 'Season']];
function townMinutes(scope) {
  const t = B.town || {};
  const base = scope === 'today' ? Number(t.today_minutes) || 0 : scope === 'week' ? Number(t.week_minutes) || 0 : Number(t.total_minutes) || 0;
  return base + live();
}
function bigWords(m) {
  if (m < 60) return [String(Math.round(m)), m === 1 ? 'minute' : 'minutes'];
  const h = Math.floor(m / 60);
  return [h.toLocaleString('en-US'), h === 1 ? 'hour' : 'hours'];
}
function counterInner() {
  const scope = B.scope || 'week';
  const m = townMinutes(scope);
  const [n, unit] = bigWords(m);
  const when = scope === 'today' ? 'today' : scope === 'week' ? 'this week' : (B.config.season && B.config.season.starts ? 'since the site opened' : 'so far');
  const days = m >= 48 * 60 ? Math.floor(m / 1440) : 0;
  return '<p class="bd-cbig"><b>' + esc(n) + '</b> ' + esc(unit) + '</p>' +
    '<p class="bd-cline">' + esc('Burlington put its phones down ' + when + '.') + (days ? ' <span>' + esc('That’s ' + days + ' days, end to end.') + '</span>' : '') + '</p>';
}
function counter() {
  const s = el('section', 'bd-counter');
  s.dataset.k = 'town';
  const body = el('div', 'bd-cbody', counterInner());
  body.setAttribute('aria-live', 'off');
  const sw = pills(SCOPES, B.scope || 'week', (v) => { B.scope = v; store.write('allday-build-scope', v); body.innerHTML = counterInner(); paintDock(); }, 'bd-scope');
  sw.setAttribute('role', 'group');
  sw.setAttribute('aria-label', 'Today, this week or the season');
  s.append(body, sw);
  return s;
}
/* a running shift ticks the numbers up, once a minute */
let lastLive = -1;
function tickNumbers() {
  const n = live();
  if (n === lastLive) return;
  lastLive = n;
  const c = B.body && B.body.querySelector('.bd-cbody');
  if (c) c.innerHTML = counterInner();
  const m = B.body && B.body.querySelector('.bd-mine');
  if (m) m.innerHTML = mineInner();
  paintDock();
}

/* Today on the site: short clips of today's shifts that chose to post,
   with their time ("Maya · Set three windows · 40m"). Built from the feed's
   own posts (no table of its own); three at most, newest first. */
function todayStrip() {
  const today = dayKey(Date.now());
  const clips = B.feed.filter((p) => p && p.line && Number(p.minutes) > 0 && p.created_at && dayKey(Date.parse(p.created_at)) === today).slice(0, 3);
  if (!clips.length) return null;
  const s = el('section', 'bd-today');
  s.dataset.k = 'today';
  s.appendChild(el('h2', 'bd-todayh', 'Today on the site'));
  const ul = el('ul', 'bd-clips');
  clips.forEach((p) => {
    const li = el('li', 'bd-clip');
    const b = el('button', 'bd-clipb', '<b>' + esc(p.author || 'A neighbor') + '</b> ' + esc(oneLine(p.line, 70)) + ' <span>· ' + esc(hm(p.minutes)) + '</span>');
    b.type = 'button';
    b.dataset.post = p.id;
    b.addEventListener('click', () => { if (!app.flashHit(B.body, 'p-' + p.id)) app.toast('That post has moved on'); });
    li.appendChild(b);
    ul.appendChild(li);
  });
  s.appendChild(ul);
  return s;
}

/* Tap a neighbor's builder on the site: their name tag, the job they are
   on, and their latest post if there is one. The site draws the tag on its
   own; this reads where everyone is from site.stats(). */
const JOB = { haul: 'hauling timber across the yard', frame: 'framing the {n} floor', brick: 'laying brick on the {n} floor', wire: 'running wire on the {n} floor',
  window: 'setting windows on the {n} floor', roof: 'up on the roof', lunch: 'eating lunch on a beam' };
const nth = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
function jobWords(task) { return fill(JOB[task] || 'on the site', { n: nth(floors().going) }); }
let pickTimer = 0;
function pickAt(e) {
  if (!site || !site.stats || !canvas) return;
  let st;
  try { st = site.stats(); } catch (x) { return; }
  if (!st || !Array.isArray(st.crew) || !st.size) return;
  const r = canvas.getBoundingClientRect();
  if (!r.width) return;
  const x = st.cam[0] + (e.clientX - r.left) / r.width * st.size[0], y = st.cam[1] + (e.clientY - r.top) / r.height * st.size[1];
  const crew = (B.town && Array.isArray(B.town.on_shift) ? B.town.on_shift : []);
  let best = null, bd = 9;
  st.crew.forEach(([id, ax, ay, , act]) => {
    if (act === 'gone') return;
    const c = crew.find((q) => String(q.id) === String(id).replace(/^c:/, ''));
    if (!c || c.me) return;
    const d = Math.abs(ax - x) + Math.abs(ay - 7 - y) * 0.7;
    if (d < bd) { bd = d; best = c; }
  });
  showWho(best);
}
function showWho(c) {
  const box = dock && dock.querySelector('.bd-sitebox');
  if (!box) return;
  const old = box.querySelector('.bd-whocard');
  if (old) old.remove();
  clearTimeout(pickTimer);
  if (!c) return;
  const name = c.name || 'A neighbor';
  const card = el('div', 'bd-whocard');
  card.setAttribute('role', 'status');
  card.innerHTML = '<p class="bd-whoname">' + esc(name) + '</p><p class="bd-whojob">' + esc(jobWords(c.task)) + '</p>';
  const post = c.name ? B.feed.find((p) => p.author === c.name && p.line) : null;
  if (post) {
    const a = el('button', 'bd-wholink', esc('“' + oneLine(post.line, 60) + '”'));
    a.type = 'button';
    a.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (dock.dataset.state === 'full' && !shiftOpen()) setDock('dock');
      if (!app.flashHit(B.body, 'p-' + post.id)) app.toast('That post has moved on');
    });
    card.appendChild(a);
  }
  box.appendChild(card);
  pickTimer = setTimeout(() => card.remove(), 7000);
}

/* -------------------------------------------------------------- the feed */
const postItem = (p) => ({ k: 'p-' + p.id, id: p.id, kind: 'build', title: p.line, text: p.line, author: p.author || 'A neighbor', href: '#build/p-' + p.id, post: p });
function feedSection() {
  const s = el('section', 'bd-feed');
  s.dataset.k = 'neighbors';
  const all = B.feed.filter((p) => p && p.id && p.line);
  const stuck = all.filter((p) => p.kind === 'stuck' && !p.mine);
  if (B.only === 'stuck' && !stuck.length) B.only = 'all';
  const head = el('div', 'bd-head', '<h2>Neighbors</h2>');
  if (stuck.length) {
    const sw = pills([['all', 'All'], ['stuck', 'Stuck · ' + stuck.length]], B.only, (v) => { B.only = v; paint(); }, 'bd-only');
    sw.setAttribute('role', 'group');
    sw.setAttribute('aria-label', 'All posts, or only the ones stuck');
    head.appendChild(sw);
  }
  s.appendChild(head);
  const posts = B.only === 'stuck' ? stuck : all;
  app.know(posts.map(postItem));
  const list = el('div', 'bd-posts');
  if (!posts.length) list.appendChild(el('p', 'bd-empty', 'Nobody’s posted yet.'));
  posts.forEach((p) => list.appendChild(postCard(p)));
  s.appendChild(list);
  return s;
}
const needLabel = (k) => { const x = (F('stuck.help_buttons', []) || []).find((b) => b.key === k); return x ? x.label : ''; };
function postCard(p) {
  const c = el('article', 'card bd-post k-' + esc(p.kind) + (p.mine ? ' mine' : ''));
  c.dataset.k = 'p-' + p.id;
  const who = p.author || 'A neighbor';
  const ago = p.created_at ? agoShort(Date.parse(p.created_at) / 1000) : '';
  const mins = Number(p.minutes) > 0 ? hm(p.minutes) : '';
  const pic = p.photo ? photoUrl(p.photo) : null;
  const need = p.kind === 'stuck' && p.help_need ? needLabel(p.help_need) : '';
  c.innerHTML = '<span class="bd-av">' + mark(who, 'round') + '</span><div class="bd-pm">' +
    '<p class="bd-who"><b>' + esc(who) + '</b>' + (ago ? ' <span>· ' + esc(ago) + '</span>' : '') + '</p>' +
    '<p class="bd-kind">' + esc(kindWord(p.kind)) + (p.thing ? '<span> · ' + esc(p.thing) + '</span>' : '') + (mins ? '<span> · ' + esc(mins) + '</span>' : '') + '</p>' +
    '<p class="bd-line">' + esc(p.line) + '</p>' +
    (need ? '<p class="bd-need">' + esc('Could use ' + need.replace(/^A /, 'a ')) + '</p>' : '') +
    (pic && /^https?:/.test(pic) ? '<span class="c-media r45"><img class="pic" loading="lazy" decoding="async" alt="" src="' + esc(pic) + '"></span>' : '') + '</div>';
  const pm = c.querySelector('.bd-pm');
  const acts = el('div', 'bd-acts');
  /* on a neighbor's Stuck post, chiming in is the big button */
  if (p.kind === 'stuck' && !p.mine) {
    if (p.offered) acts.appendChild(el('span', 'bd-sent', esc('Offer sent')));
    else {
      const help = el('button', 'btn bd-help', esc(F('help.offer_button', 'I can help')));
      help.type = 'button'; help.dataset.act = 'bdhelp';
      help.setAttribute('aria-expanded', B.replying === p.id ? 'true' : 'false');
      acts.appendChild(help);
    }
  }
  const nice = el('button', 'bd-nice' + (p.niced ? ' on' : ''), ICON.heart + '<span>' + esc(F('help.nice', 'Nice')) + '</span><span class="n">' + (Number(p.nice) > 0 ? esc(p.nice) : '') + '</span>');
  nice.type = 'button'; nice.dataset.act = 'bdnice';
  nice.setAttribute('aria-pressed', p.niced ? 'true' : 'false');
  if (p.mine) nice.disabled = true;
  acts.appendChild(nice);
  const more = el('button', 'iconbtn bd-pmore', ICON.more);
  more.type = 'button'; more.dataset.act = 'bdmore';
  more.setAttribute('aria-label', 'More for this post');
  acts.appendChild(more);
  pm.appendChild(acts);
  /* I can help: one line, right here in the post */
  if (B.replying === p.id && !p.offered) {
    const f = el('form', 'bd-reply');
    f.noValidate = true;
    f.dataset.post = p.id;
    const i = el('input', 'field');
    i.name = 'line'; i.maxLength = 140; i.placeholder = F('help.offer_placeholder', '');
    i.setAttribute('aria-label', 'What you can offer, in a line');
    const send = button('Send', 'bd-start'); send.type = 'submit';
    const r = el('div', 'bd-row'); r.append(i, send);
    if (!(B.builder && B.builder.first_name)) {
      const n = el('input', 'field bd-fname');
      n.name = 'first_name'; n.maxLength = 32; n.placeholder = 'Your first name';
      n.setAttribute('aria-label', 'Your first name');
      f.appendChild(n);
    }
    f.appendChild(r);
    pm.appendChild(f);
  }
  /* your own Stuck post: who offered, one line each, and Yes or No thanks */
  if (p.mine) {
    const offers = B.offers.filter((o) => o.post === p.id);
    if (offers.length) {
      const box = el('div', 'bd-offers');
      offers.forEach((o) => {
        const r = el('div', 'bd-offer');
        r.dataset.help = o.id;
        r.innerHTML = '<p><b>' + esc(fill(F('help.poster_sees', '{name} can help.'), { name: o.name || 'A neighbor' })) + '</b> ' + esc(o.line || '') + '</p>';
        if (o.status === 'offered') {
          const yes = el('button', 'btn sm bd-start', esc(F('help.yes', 'Yes'))); yes.type = 'button'; yes.dataset.act = 'bdyes';
          const no = el('button', 'btn sm ghost', esc(F('help.no', 'No thanks'))); no.type = 'button'; no.dataset.act = 'bdno';
          const row = el('div', 'bd-row'); row.append(yes, no);
          r.appendChild(row);
        } else if (o.status === 'accepted') r.appendChild(el('p', 'bd-sent', esc('You’ll both get an email')));
        box.appendChild(r);
      });
      pm.appendChild(box);
    }
  }
  return c;
}

function needSignIn(what) {
  if (signedIn()) return false;
  app.toast('Sign in to ' + what + '.');
  app.openSettings();
  return true;
}
function postOf(it) { return it && it.post ? B.feed.find((p) => p.id === it.post.id) || it.post : null; }
function repaintPost(p) {
  const old = B.body && [...B.body.querySelectorAll('.bd-post')].find((n) => n.dataset.k === 'p-' + p.id);
  if (old) old.replaceWith(postCard(p));
}
app.onAct('bdnice', (it) => {
  const p = postOf(it);
  if (!p || p.mine || needSignIn('say nice')) return;
  p.niced = !p.niced;
  p.nice = Math.max(0, (Number(p.nice) || 0) + (p.niced ? 1 : -1));
  repaintPost(p);
  go(() => api().nice.toggle(p.id)).then((r) => {
    if (r.ok) { if (Number.isFinite(r.nice)) { p.nice = r.nice; p.niced = !!r.niced; repaintPost(p); } return; }
    p.niced = !p.niced; p.nice = Math.max(0, p.nice + (p.niced ? 1 : -1));
    repaintPost(p); app.toast(r.message || FAIL);
  });
});
app.onAct('bdhelp', (it) => {
  const p = postOf(it);
  if (!p || needSignIn('offer help')) return;
  B.replying = B.replying === p.id ? null : p.id;
  repaintPost(p);
  const i = B.body.querySelector('.bd-reply input');
  if (i) i.focus({ preventScroll: true });
});
function sendHelp(form) {
  const p = B.feed.find((x) => x.id === form.dataset.post);
  if (!p) return;
  const i = form.querySelector('input[name=line]');
  const n = form.querySelector('input[name=first_name]');
  const line = i.value.trim();
  if (n && !n.value.trim()) { n.focus(); return; }
  if (!line) { i.focus(); return; }
  form.querySelectorAll('button, input').forEach((x) => { x.disabled = true; });
  const named = n ? go(() => api().builder.set({ first_name: n.value.trim().slice(0, 32) })).then((r) => { if (r.ok) B.builder = r.builder || { ...(B.builder || {}), first_name: n.value.trim() }; return r; }) : Promise.resolve({ ok: true });
  named.then((r) => (r.ok ? go(() => api().help.offer(p.id, line.slice(0, 140))) : r)).then((r) => {
    if (!r.ok) { form.querySelectorAll('button, input').forEach((x) => { x.disabled = false; }); app.toast(r.message || FAIL); return; }
    p.offered = true; B.replying = null; repaintPost(p);
    app.toast(F('help.offered', 'Sent'));
  });
}
function answerHelp(it, act, yes) {
  const p = postOf(it);
  const row = act.closest('[data-help]');
  if (!p || !row) return;
  const id = row.dataset.help;
  row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  go(() => api().help.respond(id, yes)).then((r) => {
    if (!r.ok) { row.querySelectorAll('button').forEach((b) => { b.disabled = false; }); app.toast(r.message || FAIL); return; }
    const o = B.offers.find((x) => x.id === id);
    if (o) o.status = yes ? 'accepted' : 'declined';
    B.offers = B.offers.filter((x) => x.status !== 'declined');
    repaintPost(p);
    app.toast(yes ? F('help.accepted', 'Done') : F('help.declined', 'OK'));
  });
}
app.onAct('bdyes', (it, act) => answerHelp(it, act, true));
app.onAct('bdno', (it, act) => answerHelp(it, act, false));
app.onAct('bdmore', (it) => {
  const p = postOf(it);
  if (!p) return;
  app.sheet(p.mine ? 'Your post' : (p.author || 'A neighbor') + '’s post', (body, card, close) => {
    body.appendChild(el('p', 'bd-sline', esc(p.line)));
    if (p.mine) {
      const r = el('div', 'sheet-row', '<div class="t">Take it down</div>');
      r.appendChild(button('Delete', 'danger sm', () => {
        close();
        go(() => api().post.remove(p.id)).then((x) => { if (!x.ok) { app.toast(x.message || FAIL); return; } B.feed = B.feed.filter((q) => q.id !== p.id); paint(); app.toast('Deleted'); });
      }));
      body.appendChild(r);
      return;
    }
    body.appendChild(el('div', 'sheet-h', 'Report it'));
    Object.entries(REASON_LABELS).forEach(([k, label]) => {
      const r = el('div', 'sheet-row', '<div class="t">' + esc(label) + '</div>');
      const b = button('Report', 'ghost sm', () => {
        if (needSignIn('report')) return;
        close();
        go(() => api().report({ post: p.id }, k)).then((x) => app.toast(x.ok ? 'Reported. Thanks.' : x.message || FAIL));
      });
      b.dataset.reason = k;
      r.appendChild(b);
      body.appendChild(r);
    });
    body.appendChild(el('div', 'sheet-h', 'Block'));
    const r = el('div', 'sheet-row', '<div class="t">' + esc('Block ' + (p.author || 'this neighbor')) + '</div>');
    r.appendChild(button('Block', 'danger sm', () => {
      if (needSignIn('block')) return;
      close();
      app.confirmBox({ title: 'Block ' + (p.author || 'this neighbor') + '?', body: 'You won’t see their posts, and they can’t offer you help.', yes: 'Block', onYes() {
        go(() => api().block.add({ post: p.id })).then((x) => {
          if (!x.ok) { app.toast(x.message || FAIL); return; }
          reload();
          app.toast('Blocked');
        });
      } });
    }));
    body.appendChild(r);
  });
});

/* ------------------------------------------------------------- the dock */
/* The site lives in a panel at the bottom of the screen, outside the tab's
   scroll, as the player does: docked, it shows the site and the town line;
   its handle drags (or taps) it up to full screen, or down to just the
   town line. A shift takes it full screen. */
function ensureDock() {
  if (dock) return dock;
  dock = el('div', 'bd-dock');
  dock.dataset.state = store.read(DOCK_KEY, 'dock') === 'mini' ? 'mini' : 'dock';
  dock.hidden = true;
  const handle = el('button', 'bd-handle', '<i></i>');
  handle.type = 'button';
  bindHandle(handle);
  const bar = el('div', 'bd-dockbar');
  const box = el('div', 'bd-sitebox');
  canvas = document.createElement('canvas');
  canvas.className = 'bd-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'A drawing of Watershed on Lakeside Avenue, raised by the town’s hours, with everyone on shift');
  const cut = el('button', 'bd-cut', 'Your part');
  cut.type = 'button';
  cut.addEventListener('click', () => setCut(!B.cut));
  box.append(canvas, el('p', 'bd-talk'), cut);
  canvas.addEventListener('click', (e) => { if (!shiftOpen()) pickAt(e); });
  const foot = el('div', 'bd-shift-foot');
  const live = el('p', 'bd-live');
  live.setAttribute('aria-live', 'polite');
  dock.append(handle, bar, box, foot, live);
  dock.addEventListener('pointerdown', onTouch, { passive: true });
  document.body.appendChild(dock);
  try { site = createSite(canvas, { reducedMotion: reduced() }); } catch (e) { console.error('[all-day] build site', e); site = null; }
  paintDock();
  return dock;
}
function setDock(state) {
  if (!dock) return;
  if (shiftOpen() && state !== 'full') return;
  dock.dataset.state = state;
  if (state !== 'full') store.write(DOCK_KEY, state);
  document.body.classList.toggle('bd-full', state === 'full' && !dock.hidden);
  if (!dock.hidden) document.body.dataset.bdDock = state;
  paintDock();
  if (state !== 'mini') feedSite();
}
function paintHandle() {
  const h = dock && dock.querySelector('.bd-handle');
  if (!h) return;
  const s = dock.dataset.state;
  h.setAttribute('aria-label', s === 'full' ? 'Shrink the site' : 'Open the site full screen');
  h.setAttribute('aria-expanded', s === 'full' ? 'true' : 'false');
  h.hidden = shiftOpen();
}
const STATES = ['mini', 'dock', 'full'];
function bindHandle(h) {
  let y0 = null, moved = 0;
  h.addEventListener('pointerdown', (e) => { y0 = e.clientY; moved = 0; try { h.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } });
  h.addEventListener('pointermove', (e) => { if (y0 != null) moved = e.clientY - y0; });
  h.addEventListener('pointerup', () => {
    if (y0 == null) return;
    const i = STATES.indexOf(dock.dataset.state);
    y0 = null;
    if (moved < -30) setDock(STATES[Math.min(2, i + 1)]);
    else if (moved > 30) setDock(STATES[Math.max(0, i - 1)]);
    else return;
    h.dataset.dragged = '1';
  });
  h.addEventListener('click', () => {
    if (h.dataset.dragged) { delete h.dataset.dragged; return; }
    setDock(dock.dataset.state === 'full' ? 'dock' : dock.dataset.state === 'mini' ? 'dock' : 'full');
  });
}
function showDock(on) {
  ensureDock();
  const want = !!on || shiftOpen();
  dock.hidden = !want;
  document.body.classList.toggle('bd-docked', want);
  if (want) { document.body.dataset.bdDock = dock.dataset.state; document.body.classList.toggle('bd-full', dock.dataset.state === 'full'); feedSite(); }
  else { document.body.classList.remove('bd-full'); delete document.body.dataset.bdDock; }
}
/* the town line, and the party, under the handle */
function paintDock() {
  if (!dock) return;
  const bar = dock.querySelector('.bd-dockbar');
  const t = B.town || {};
  const f = floors();
  const crew = crewNow();
  const vars = { crew, hours: Math.floor(((Number(t.week_minutes) || 0) + live()) / 60), floor: f.going, floors: f.total };
  let line = fill(crew ? F('town.line', '') : F('town.line_none', ''), vars);
  if (crew === 1) line = line.replace(/^1 neighbors/, '1 neighbor');
  if (f.topped) line = line.replace(/floor \d+ of \d+/, 'topped out');
  /* folded to a strip: the town's counter, short, and who's on shift */
  if (dock.dataset.state === 'mini' && !shiftOpen()) {
    const scope = B.scope || 'week';
    const [n, unit] = bigWords(townMinutes(scope));
    line = n + ' ' + unit + ' off phones ' + (scope === 'today' ? 'today' : scope === 'week' ? 'this week' : 'this season') + ' · ' + (crew ? crew + ' on shift' : 'nobody on shift');
  }
  const season = B.config.season || {};
  let party = F('party.no_date', '');
  if (season.topping_out_date) {
    const when = new Date(season.topping_out_date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    party = season.topping_out_date === dayKey(Date.now()) ? F('party.today', '') : fill(F('party.upcoming', ''), { date: when });
  }
  bar.innerHTML = '<p class="bd-townl">' + esc(line) + '</p>';
  const pp = el(season.party_url && /^https:\/\//.test(season.party_url) ? 'a' : 'p', 'bd-party', esc(party));
  if (pp.tagName === 'A') { pp.href = season.party_url; pp.target = '_blank'; pp.rel = 'noopener'; }
  bar.appendChild(pp);
  /* the split works both ways: posts only (the site folds to this strip,
     and stops drawing), or the site back */
  if (!shiftOpen()) {
    const mini = dock.dataset.state === 'mini';
    if (mini) { bar.classList.add('tap'); bar.onclick = () => setDock('dock'); } else { bar.classList.remove('tap'); bar.onclick = null; }
    const t = el('button', 'iconbtn bd-fold', mini ? ICON.up : ICON.down);
    t.type = 'button';
    t.setAttribute('aria-label', mini ? 'Show the site' : 'Posts only');
    t.addEventListener('click', (e) => { e.stopPropagation(); setDock(mini ? 'dock' : 'mini'); });
    bar.appendChild(t);
  }
  const cut = dock.querySelector('.bd-cut');
  cut.classList.toggle('on', B.cut);
  cut.setAttribute('aria-pressed', B.cut ? 'true' : 'false');
  paintHandle();
}
function setCut(on) {
  B.cut = !!on;
  if (site) site.cutaway(B.cut, { your_minutes: yourMinutes() });
  paintDock();
}

/* everything the site draws, from what the tab knows */
function feedSite() {
  if (!site) return;
  const t = B.town || {};
  const f = floors();
  try {
    site.setTown({ total_minutes: Number(t.total_minutes) || 0, floors: f.total, floors_done: Math.min(f.done, f.total), floor_progress: f.progress, windows_lit: Number(t.windows_lit || t.posts_lit) || 0, topped_out: f.topped });
    site.setCrew((Array.isArray(t.on_shift) ? t.on_shift : []).filter((c) => !c.me).map((c, i) => ({ id: c.id || 'c' + i, look: c.look || {}, task: c.task || null, name: c.name || null })));
    site.setYou(youState());
    site.setSky(sky());
    site.cutaway(B.cut, { your_minutes: yourMinutes() });
  } catch (e) { console.error('[all-day] build site', e); }
}
let tapsDown = 0;
function youState() {
  const look = { hat: (B.builder && B.builder.hat) || 'yellow', vest: (B.builder && B.builder.vest) || 'orange' };
  const s = status();
  if (!s || s.state === 'missed' || ending()) return { state: 'off', look, task: null };
  if (s.state === 'paused' || document.visibilityState === 'hidden') return { state: 'away', look, task: s.task };
  return { state: Date.now() < tapsDown ? 'paused' : 'working', look, task: s.task };
}

/* Burlington's sun, worked out here (the standard few lines of solar
   position), and the weather line What Now reads */
export function sunAltitude(ms, lat = LAT, lon = LON) {
  const rad = Math.PI / 180;
  const d = ms / 86400000 - 10957.5;
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const ha = (gmst * 15 + lon) * rad - ra;
  return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad;
}
let weather = 'clear';
function sky() { const alt = sunAltitude(Date.now()); return { sunAltitude: alt, isNight: alt < -6, weather }; }
let wxAsk = null;
function loadWeather() {
  if (wxAsk || app.demo) return;
  wxAsk = getJSON('../data/weather/latest.json').then((j) => {
    const d = String((j && j.now && j.now.description) || '').toLowerCase();
    weather = /snow|sleet|flurr/.test(d) ? 'snow' : /rain|shower|drizzle|storm/.test(d) ? 'rain' : /fog|mist|haze/.test(d) ? 'fog' : /cloud|overcast/.test(d) ? 'cloud' : 'clear';
    if (site) site.setSky(sky());
  });
}

/* the foreman says one thing about the site now and then; nothing to answer */
function siteTalk() {
  clearTimeout(talkTimer);
  const p = dock && dock.querySelector('.bd-talk');
  if (!p || B.phase !== 'ready' || dock.hidden) return;
  const t = B.town || {};
  const f = floors();
  const crew = crewNow();
  const h = etHour();
  const when = h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 17 ? 'day' : h >= 17 && h < 21 ? 'evening' : 'night';
  const names = (Array.isArray(t.on_shift) ? t.on_shift : []).map((c) => c.name).filter(Boolean);
  const vars = { crew, hours: Math.floor((Number(t.week_minutes) || 0) / 60), floor: f.going, floors: f.total, name: names[0] };
  const ok = (x) => x && typeof x.text === 'string' && (!x.when || x.when === when || x.when === 'any') && (!x.weather || x.weather === weather) &&
    (x.crew_min == null || crew >= x.crew_min) && (x.crew_max == null || crew <= x.crew_max) &&
    [...x.text.matchAll(/\{(\w+)\}/g)].every((m) => vars[m[1]] != null && vars[m[1]] !== 0 && vars[m[1]] !== '');
  const pool = (Array.isArray(B.foreman.site_talk) ? B.foreman.site_talk : []).filter(ok).map((x) => x.text);
  const line = pick('site_talk', pool, vars);
  if (!line) return;
  p.textContent = line;
  p.classList.add('on');
  talkTimer = setTimeout(() => { p.classList.remove('on'); talkTimer = setTimeout(siteTalk, 4 * 60000); }, 9000);
}

/* ------------------------------------------------------------- shifts */
/* The clock and the running shift's record are the API's (build-core.js):
   it keeps the shift on this phone, so a reload or a dead battery never
   loses it. The tab draws what shift.status() says, once a second. */
let tickTimer = 0, lastState = null, lastBeat = 0, lock = null, rest = null, motionOn = false, lastMotion = 0;
const status = () => { try { return B.api ? api().shift.status() : null; } catch (e) { return null; } };
const shiftOpen = () => !!(dock && dock.classList.contains('is-shift'));
const ending = () => { const e = store.read(ENDING_KEY, null); return e && typeof e === 'object' ? e : null; };

/* "What's the job?" One line, or Start and skip it. Typing spot one. */
function clockIn(o = {}) {
  const s = status();
  if (s && s.state !== 'missed') { openShift(); return; }
  app.sheet(o.smaller ? 'A smaller job' : 'Start shift', (body, card, close) => {
    body.appendChild(el('p', 'bd-foreman', esc(o.smaller ? 'What’s the smaller piece?' : pick('clock_in', F('clock_in.prompts', [])))));
    const f = el('form', 'bd-form');
    f.noValidate = true;
    const i = el('input', 'field bd-step');
    i.name = 'step'; i.maxLength = 80;
    i.placeholder = B.firstStep || pick('clock_in_ph', F('clock_in.placeholder', []));
    i.setAttribute('aria-label', 'The next step, in a line');
    const ok = button(ICON_BUILD + '<span>' + esc(F('clock_in.start', 'Start')) + '</span>', 'bd-start'); ok.type = 'submit';
    const r = el('div', 'bd-row'); r.append(i, ok);
    f.appendChild(r);
    /* the first time: your builder, right here (a hard hat, a name tag) */
    const setup = B.builder && B.builder.first_name ? null : builderForm({ inline: true });
    if (setup) { f.appendChild(el('p', 'sheet-h', 'Your builder')); f.appendChild(setup); }
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      /* iPhone asks once to feel the phone being picked up: in this tap */
      askMotion();
      const step = i.value.trim().slice(0, 80);
      close();
      (setup ? setup.save() : Promise.resolve()).then(() => startShift(step));
    });
    body.appendChild(f);
    setTimeout(() => { if (matchMedia('(hover: hover)').matches) i.focus({ preventScroll: true }); }, 50);
  });
}
function startShift(step) {
  go(() => api().shift.start(step)).then((r) => {
    if (!r.ok) { app.toast(r.message || FAIL); return; }
    B.firstStep = '';
    store.write(ENDING_KEY, null);
    openShift();
  });
}

function openShift() {
  ensureDock();
  /* a reader who chose posts only gets a calm shift: no site, a timer, the whistle as a gentle line */
  dock.classList.toggle('is-calm', store.read(DOCK_KEY, 'dock') === 'mini');
  dock.classList.add('is-shift');
  showDock(true);
  setDock('full');
  document.body.classList.add('bd-shifting');
  lastState = null;
  lastBeat = 0;
  wake();
  watchMotion(true);
  clearInterval(tickTimer);
  tickTimer = setInterval(onTick, 1000);
  onTick();
  /* the crew, live: you are one of them now */
  go(() => api().town.get()).then((r) => { if (r.ok) { B.town = r.town; feedSite(); paintDock(); paintFoot(); } });
}
function closeShift() {
  clearInterval(tickTimer); tickTimer = 0;
  watchMotion(false);
  unwake();
  if (!dock) return;
  dock.classList.remove('is-shift', 'is-whistle', 'is-end', 'is-calm');
  document.body.classList.remove('bd-shifting');
  const foot = dock.querySelector('.bd-shift-foot');
  foot.innerHTML = ''; delete foot.dataset.key;
  setDock(store.read(DOCK_KEY, 'dock') === 'mini' ? 'mini' : 'dock');
  showDock(B.active && B.side === 'build');
  if (site) { site.whistle(false); site.setYou(youState()); }
}

/* every second while the shift is up */
function onTick() {
  if (ending()) { paintFoot(); return; }
  const s = status();
  if (!s) { closeShift(); return; }
  if (s.state !== lastState) {
    const was = lastState;
    lastState = s.state;
    if (s.state === 'whistle') {
      if (navigator.vibrate) { try { navigator.vibrate(180); } catch (x) { /* no buzz */ } }
      if (site) site.whistle(true);
      say('The foreman’s whistle');
    } else if (was === 'whistle') {
      if (site) site.whistle(false);
      say('');
    }
    if (s.state === 'missed') { knockOff(); return; }
    if (site) site.setYou(youState());
  }
  paintFoot();
  tickNumbers();
  if (document.visibilityState === 'visible') store.write(SEEN_AT_KEY, Date.now());
  /* the heartbeat: the page is alive and in front (the clock pauses a shift whose page went quiet) */
  if (document.visibilityState === 'visible' && (s.state === 'working' || s.state === 'whistle') && Date.now() - lastBeat >= 30000) {
    lastBeat = Date.now();
    go(() => api().shift.heartbeat({ task: s.task }));
  }
}
const say = (t) => { const live = dock && dock.querySelector('.bd-live'); if (live) live.textContent = t; };
/* missed: the crew knocks off, banked to the last touch, and straight to the end screen */
function knockOff() {
  /* one more heartbeat writes the miss down, so it stays a miss after the page goes quiet */
  go(() => api().shift.heartbeat({}));
  const s = status();
  if (site) { site.whistle(false); site.setYou({ ...youState(), state: 'off' }); }
  store.write(ENDING_KEY, { missed: true, minutes: s ? s.minutes : 0 });
  say('Crew knocked off');
  paintFoot();
}
/* a hand on the phone: the tools go down a moment, and a blowing whistle is answered */
function onTouch(e) {
  if (!shiftOpen() || ending()) return;
  if (e && e.target && e.target.closest && e.target.closest('.bd-out')) return;
  const s = status();
  if (!s || (s.state !== 'working' && s.state !== 'whistle')) return;
  go(() => api().shift.touch()).then(() => onTick());
  tapsDown = Date.now() + 3000;
  if (site) site.setYou(youState());
  setTimeout(() => { if (site) site.setYou(youState()); }, 3100);
}

function paintFoot() {
  if (!dock || !shiftOpen()) return;
  const foot = dock.querySelector('.bd-shift-foot');
  const e = ending();
  const s = status();
  dock.classList.toggle('is-whistle', !e && !!s && s.state === 'whistle');
  dock.classList.toggle('is-end', !!e);
  const calm = dock.classList.contains('is-calm');
  const key = e ? 'end:' + (e.missed ? 'm' : '') : s ? s.state + ':' + (s.step || '') + ':' + crewNow() + (calm ? ':' + s.minutes : '') : 'none';
  if (foot.dataset.key === key) return;
  foot.dataset.key = key;
  foot.innerHTML = '';
  if (e) { endScreen(foot, e); return; }
  if (!s) return;
  if (calm) foot.appendChild(el('p', 'bd-calmtime', esc(hm(s.minutes))));
  if (s.step) foot.appendChild(el('p', 'bd-shift-step', esc(s.step)));
  if (calm && s.state === 'whistle') foot.appendChild(el('p', 'bd-calmwhistle', esc('The foreman’s whistle. Tap anywhere to keep going.')));
  const crew = Math.max(1, crewNow());
  foot.appendChild(el('p', 'bd-shift-crew', esc(crew === 1 ? 'Just you on shift' : crew + ' neighbors on shift')));
  foot.appendChild(button(calm ? 'Stop' : 'Clock out', 'ghost on-dark bd-out', clockOut));
}
/* clocking out stops the clock now (pause), and the end screen banks it */
function clockOut() {
  go(() => api().shift.pause()).then(() => {
    const s = status();
    store.write(ENDING_KEY, { missed: false, minutes: s ? s.minutes : 0 });
    if (site) site.setYou({ ...youState(), state: 'off' });
    paintFoot();
  });
}

/* the end screen: the time, one line, Keep it or Post. Typing spot two. */
function endScreen(foot, e) {
  const count = Number(store.read(COUNT_KEY, 0)) || 0;
  const every = Number(F('clock_out.rare_why.every', 10)) || 10;
  const askWhy = !!B.thing && count > 0 && (count + 1) % every === 0;
  if (e.missed) foot.appendChild(el('p', 'bd-foreman bd-knock', esc(pick('knocked_off', F('whistle.knocked_off', [])))));
  foot.appendChild(el('p', 'bd-endtime', esc(fill(F('end_screen.time', '{duration}'), { duration: hm(e.minutes) }))));
  foot.appendChild(el('p', 'bd-foreman', esc(askWhy ? pick('why', F('clock_out.rare_why.prompts', [])) : pick('clock_out', F('clock_out.prompts', [])))));
  const f = el('form', 'bd-form');
  f.noValidate = true;
  const i = el('input', 'field bd-note');
  i.name = 'note'; i.maxLength = 200;
  i.placeholder = pick('out_ph', askWhy ? F('clock_out.rare_why.placeholder', []) : F('clock_out.placeholder', []));
  i.setAttribute('aria-label', askWhy ? 'Why it matters, in a line' : 'What got done, in a line');
  f.appendChild(i);
  const r = el('div', 'bd-row');
  const keep = button(esc(F('end_screen.keep', 'Keep it')), 'ghost on-dark bd-keep', (ev) => { ev.preventDefault(); bank(i.value.trim(), askWhy, false); });
  const post = button(esc(F('end_screen.post', 'Post')), 'bd-start bd-postb', (ev) => {
    ev.preventDefault();
    if (needSignIn('post')) return;
    bank(i.value.trim(), askWhy, true);
  });
  r.append(keep, post);
  f.appendChild(r);
  f.addEventListener('submit', (ev) => { ev.preventDefault(); keep.click(); });
  foot.appendChild(f);
}
/* the shift goes on the record (and up the building), then the site docks */
function bank(note, why, thenPost) {
  const e = ending() || { minutes: 0 };
  store.write(COUNT_KEY, (Number(store.read(COUNT_KEY, 0)) || 0) + 1);
  /* the rare "why" answer goes on the thing card, if it had none */
  if (why && note && B.thing && !B.thing.why) go(() => api().thing.set({ why: note })).then((r) => { if (r.ok && r.thing) B.thing = r.thing; });
  go(() => api().shift.end({ note: why ? '' : note })).then((r) => {
    store.write(ENDING_KEY, null);
    if (!r.ok) { app.toast(r.message || FAIL); closeShift(); return; }
    const mins = Number(r.minutes) || e.minutes || 0;
    closeShift();
    if (site && mins >= 1) site.dropMaterial(mins >= 90 ? 'timber' : mins >= 30 ? 'brick' : 'lumber');
    if (thenPost) postSheet({ kind: 'progress', line: why ? '' : note, minutes: mins, shift: r.shift && r.shift.id });
    else app.toast(pick('kept', F('end_screen.kept', [])) || 'Kept');
    reload();
  });
}

/* the screen stays awake on its own; the browser can let go of that when the
   page is hidden or the battery is low, so it is asked again on the way back */
async function wake() {
  try {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || lock) return;
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch (e) { lock = null; }
}
function unwake() { const l = lock; lock = null; try { if (l) l.release(); } catch (e) { /* gone */ } }

/* picking the phone up answers the whistle (iPhone asks once) */
function askMotion() {
  try {
    const D = window.DeviceMotionEvent;
    if (D && typeof D.requestPermission === 'function') D.requestPermission().catch(() => {});
  } catch (e) { /* no motion */ }
}
export function pickedUp(base, g, threshold = 3) {
  if (!base || !g) return false;
  return Math.hypot((g.x || 0) - base.x, (g.y || 0) - base.y, (g.z || 0) - base.z) > threshold;
}
function onMotion(e) {
  const g = e.accelerationIncludingGravity;
  if (!g || g.x == null) return;
  const now = Date.now();
  if (!rest) { rest = { x: g.x, y: g.y, z: g.z }; return; }
  if (pickedUp(rest, g) && now - lastMotion > 2000) { lastMotion = now; onTouch(); }
  /* the resting pull drifts toward where the phone now lies */
  rest = { x: rest.x * 0.95 + g.x * 0.05, y: rest.y * 0.95 + g.y * 0.05, z: rest.z * 0.95 + g.z * 0.05 };
}
function watchMotion(on) {
  if (on && !motionOn && 'DeviceMotionEvent' in window) { rest = null; window.addEventListener('devicemotion', onMotion); motionOn = true; }
  if (!on && motionOn) { window.removeEventListener('devicemotion', onMotion); motionOn = false; }
}

/* leave the app and the builder stops and waits; come back and the tools go up */
document.addEventListener('visibilitychange', () => {
  if (!shiftOpen() || ending()) return;
  const s = status();
  if (!s || s.state === 'missed') return;
  if (document.visibilityState === 'hidden') { go(() => api().shift.pause()); if (site) site.setYou({ ...youState(), state: 'away' }); return; }
  go(() => api().shift.resume()).then(() => { lastState = null; onTick(); wake(); });
});

/* a shift the phone was in the middle of: pick it back up */
function recoverShift() {
  return go(() => api().shift.recover()).then((r) => {
    const s = r.ok ? r.shift : null;
    if (!s) { store.write(ENDING_KEY, null); return; }
    if (s.state === 'missed') { openShift(); knockOff(); return; }
    if (ending()) { openShift(); return; }
    /* a screen dark for a long while opens on its end screen; else a reload is a touch */
    const seen = Number(store.read(SEEN_AT_KEY, 0)) || 0;
    if (s.state === 'paused' && seen && Date.now() - seen > STALE_MS) {
      store.write(ENDING_KEY, { missed: false, minutes: s.minutes });
      openShift();
      return;
    }
    return go(() => api().shift.resume()).then(() => openShift());
  });
}

/* ------------------------------------------------------------- Log it */
/* Real work away from the phone: roughly how long, and it counts the same,
   marked logged on your own record. Nobody checks. */
function logSheet() {
  app.sheet(F('log_it.title', 'Log it'), (body, card, close) => {
    body.appendChild(el('p', 'bd-foreman', esc(F('log_it.how_long', 'Roughly how long?'))));
    let mins = 0;
    const choose = el('div', 'bd-logs');
    choose.setAttribute('role', 'group');
    choose.setAttribute('aria-label', 'Roughly how long');
    const chips = F('log_it.chips', []);
    (Array.isArray(chips) && chips.length ? chips : [30, 60]).forEach((m) => {
      const b = el('button', 'bd-logc', esc(m < 60 ? m + ' min' : (m / 60).toString().replace('.5', '½') + ' hr'));
      b.type = 'button'; b.dataset.min = m; b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => { mins = m; choose.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); keep.disabled = false; post.disabled = false; });
      choose.appendChild(b);
    });
    body.appendChild(choose);
    const i = el('input', 'field bd-lognote');
    i.maxLength = 200; i.placeholder = F('log_it.what_placeholder', '');
    i.setAttribute('aria-label', F('log_it.what', 'What was it?'));
    body.appendChild(i);
    const r = el('div', 'bd-row bd-logrow');
    const send = (thenPost) => {
      if (!mins) return;
      if (thenPost && needSignIn('post')) return;
      keep.disabled = true; post.disabled = true;
      const note = i.value.trim().slice(0, 200);
      go(() => api().logIt({ minutes: mins, note })).then((x) => {
        if (!x.ok) { keep.disabled = false; post.disabled = false; app.toast(x.message || FAIL); return; }
        close();
        if (site) site.dropMaterial(mins >= 90 ? 'timber' : mins >= 30 ? 'brick' : 'lumber');
        reload();
        if (thenPost) postSheet({ kind: 'progress', line: note, minutes: mins, shift: x.shift && x.shift.id });
        else app.toast(pick('saved', F('log_it.saved', [])) || 'Logged');
      });
    };
    const keep = button(esc(F('log_it.save', 'Log it')), 'ghost bd-logkeep', () => send(false));
    const post = button('Log and post', 'bd-start', () => send(true));
    keep.disabled = true; post.disabled = true;
    r.append(keep, post);
    body.appendChild(r);
  });
}

/* --------------------------------------------------------------- posting */
/* Made progress, Stuck, Found something or Finished; one line, an optional
   photo, hours only if you want them, the Brief only with its own yes. */
function postSheet(o) {
  if (needSignIn('post')) return;
  app.sheet('Post', (body, card, close) => {
    let kind = o.kind || 'progress', need = null, file = null;
    const kinds = el('div', 'bd-kinds');
    kinds.setAttribute('role', 'group');
    kinds.setAttribute('aria-label', 'What kind of post');
    const stuck = el('div', 'bd-stuck');
    const paintKinds = () => {
      kinds.querySelectorAll('button').forEach((b) => { const on = b.dataset.kind === kind; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      stuck.hidden = kind !== 'stuck';
    };
    KINDS.forEach((k) => {
      const b = el('button', 'bd-kindb k-' + k, esc(kindWord(k)));
      b.type = 'button'; b.dataset.kind = k;
      b.addEventListener('click', () => { kind = k; paintKinds(); });
      kinds.appendChild(b);
    });
    body.appendChild(kinds);
    const i = el('input', 'field bd-postline');
    i.maxLength = 200; i.value = o.line || ''; i.placeholder = 'One line';
    i.setAttribute('aria-label', 'Your post, in a line');
    body.appendChild(i);
    /* what would help you take the next step? Four buttons, no typing */
    stuck.appendChild(el('p', 'bd-foreman', esc(F('end_screen.stuck_question', 'What would help?'))));
    const needs = el('div', 'bd-needs');
    (F('stuck.help_buttons', []) || []).forEach((x) => {
      const b = el('button', 'bd-needb', esc(x.label));
      b.type = 'button'; b.dataset.need = x.key; b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => { need = need === x.key ? null : x.key; needs.querySelectorAll('button').forEach((y) => { y.classList.toggle('on', y.dataset.need === need); y.setAttribute('aria-pressed', y.dataset.need === need ? 'true' : 'false'); }); });
      needs.appendChild(b);
    });
    stuck.appendChild(needs);
    body.appendChild(stuck);
    const extras = el('div', 'bd-extras');
    const pickF = el('input'); pickF.type = 'file'; pickF.accept = 'image/*'; pickF.hidden = true;
    const pname = el('span', 'bd-pname', '');
    const consent = el('label', 'bd-check', '<input type="checkbox" name="consent"><span>I took this photo, and the Brief may show it</span>');
    consent.hidden = true;
    pickF.addEventListener('change', () => { file = (pickF.files && pickF.files[0]) || null; pname.textContent = file ? file.name : ''; consent.hidden = !file; });
    const prow = el('div', 'bd-row bd-photo'); prow.append(button(ICON.plus + ' Photo', 'ghost sm', (ev) => { ev.preventDefault(); pickF.click(); }), pname, pickF);
    extras.append(prow, consent);
    const check = (name, label) => el('label', 'bd-check', '<input type="checkbox" name="' + name + '"><span>' + esc(label) + '</span>');
    if (o.minutes > 0) extras.appendChild(check('hours', F('end_screen.add_hours', 'Add the hours') + ' (' + hm(o.minutes) + ')'));
    extras.appendChild(check('brief', F('end_screen.brief_ok', 'OK to print this in the Brief')));
    body.appendChild(extras);
    /* a post carries a first name: asked once, here, when there is none */
    let fname = null;
    if (!(B.builder && B.builder.first_name)) {
      fname = el('input', 'field bd-fname');
      fname.maxLength = 32; fname.placeholder = 'Your first name';
      fname.setAttribute('aria-label', 'Your first name');
      body.appendChild(fname);
    }
    const ok = button('Post', 'bd-start bd-postgo', () => {
      const line = i.value.trim();
      if (!line) { i.focus(); return; }
      if (fname && !fname.value.trim()) { fname.focus(); return; }
      if (file && !consent.querySelector('input').checked) { app.toast('Tick the photo box first.'); return; }
      ok.disabled = true;
      const hours = extras.querySelector('[name=hours]');
      const named = fname ? go(() => api().builder.set({ first_name: fname.value.trim().slice(0, 32) })).then((r) => { if (r.ok) B.builder = r.builder || { ...(B.builder || {}), first_name: fname.value.trim() }; return r; }) : Promise.resolve({ ok: true });
      const photo = file ? queuePhoto(file, line).catch(() => null) : Promise.resolve(null);
      Promise.all([named, photo]).then(([nr, path]) => {
        if (!nr.ok) return nr;
        if (file && !path) return { ok: false, message: 'That photo couldn’t be sent. Try again, or post without it.' };
        return go(() => api().post.create({ kind, line: line.slice(0, 200), photo: path, minutes: hours && hours.checked ? o.minutes : null,
          brief_ok: !!extras.querySelector('[name=brief]').checked, help_need: kind === 'stuck' ? need : null,
          stuck_reason: kind === 'stuck' && need ? NEED_REASON[need] : null, shift: o.shift || null }));
      }).then((r) => {
        ok.disabled = false;
        if (!r.ok) { app.toast(r.message || FAIL); return; }
        close();
        if (site) site.setTown({ windows_lit: (Number(B.town && B.town.posts_lit) || 0) + 1 });
        const after = kind === 'stuck' && need ? ((F('stuck.help_buttons', []) || []).find((x) => x.key === need) || {}).after : null;
        app.toast(after || (kind === 'finished' ? F('end_screen.finished_posted', 'Posted') : file ? 'Posted. The photo shows once approved.' : pick('posted', F('end_screen.posted', [])) || 'Posted'));
        reload();
      });
    });
    const r = el('div', 'bd-row bd-postrow'); r.appendChild(ok);
    body.appendChild(r);
    paintKinds();
  });
}

/* ------------------------------------------------------- Habits' bridge */
/* A habit tapped done drops a pallet on the site. The server counts the
   town's habit taps into the building (habit_drops); this shows it land,
   the next time the site is on screen. Habits is untouched: this listens
   for its taps. */
let pallets = 0;
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('#panel-habits .hb-tap');
  if (!b) return;
  const row = b.closest('.hb-row');
  const id = row && row.dataset.id;
  setTimeout(() => {
    const now = id ? document.querySelector('#panel-habits .hb-row[data-id="' + CSS.escape(id) + '"] .hb-tap') : null;
    if (now && now.getAttribute('aria-pressed') === 'true') pallets++;
  }, 0);
}, true);
function dropPallets() {
  if (!site || !pallets) return;
  const n = Math.min(pallets, 5);
  pallets = 0;
  for (let k = 0; k < n; k++) setTimeout(() => { try { site.dropMaterial('nails'); } catch (e) { /* fine */ } }, 400 + k * 500);
}

/* --------------------------------------------------- deep links, the sides */
function land() {
  if (!B.flash || B.phase !== 'ready') return;
  const k = B.flash;
  B.flash = null;
  if (!app.flashHit(B.body, k)) app.toast('That post has moved on');
}
function setSide(side) {
  store.write(SIDE_KEY, side);
  app.go(side === 'habits' ? 'habits' : 'build');
}
/* Build | Habits, poured like On Air's sides */
function sideSwitch(on) {
  const row = el('div', 'secrow oa-sidesrow bd-sidesrow');
  const sw = pills([['build', 'Build'], ['habits', 'Habits']], on, (v) => setSide(v), 'oa-sideswitch bd-sideswitch');
  sw.setAttribute('role', 'group');
  sw.setAttribute('aria-label', 'Build or Habits');
  [...sw.children].forEach((b, i) => { b.dataset.side = ['build', 'habits'][i]; b.setAttribute('aria-pressed', String(b.dataset.side === on)); });
  liquify(sw, { key: 'bd-side', idx: on === 'habits' ? 1 : 0, colors: ['--liq-build', '--liq-habits'] });
  row.appendChild(sw);
  return row;
}
function wrapRow(top, row) {
  const bar = el('div', 'secbar bd-sub');
  bar.appendChild(top);
  /* a hosted tab hands back its own .secbar: keep what is inside it */
  if (row) (row.classList && row.classList.contains('secbar') ? [...row.children] : [row]).forEach((k) => bar.appendChild(k));
  return bar;
}

/* ------------------------------------------------------------------ the tab */
/* Settings' "Delete my account and posts" (boards.js) takes your thing,
   hours, posts and builder too */
boards.onDeleteMe(() => go(() => api().deleteMine()).then((r) => ({ ok: !!r.ok, message: r.message })));

app.onAuth(() => {
  B.api = null;
  if (!B.root) return;
  /* signing in: this phone's thing, hours and look move to the account once */
  if (signedIn() && !app.demo) go(() => api().importLocal()).then(load); else load();
});

app.register(KEY, {
  label: 'Build',
  icon: ICON_BUILD,
  promise: 'Pick one thing, put the phone down, and build the town.',
  mount(host) {
    B.root = host;
    B.body = el('div', 'bd-host');
    host.appendChild(B.body);
    app.bindFeed(B.body, { onPeek() {}, onSave() {} });
    B.body.addEventListener('submit', (e) => { const f = e.target.closest('.bd-reply'); if (f) { e.preventDefault(); sendHelp(f); } });
    load().then(recoverShift);
    loadWeather();
  },
  activate(param) {
    B.side = 'build';
    B.active = true;
    store.write(SIDE_KEY, 'build');
    if (param === 'habits') { app.go('habits'); return; }
    if (param && /^p-[\w-]{1,80}$/.test(param)) { B.flash = param; land(); }
    showDock(true);
    if (dock && dock.dataset.state === 'full' && !shiftOpen()) setDock('dock');
    dropPallets();
    clearTimeout(talkTimer);
    talkTimer = setTimeout(siteTalk, 1500);
    clearInterval(skyTimer);
    skyTimer = setInterval(() => { if (site) site.setSky(sky()); }, 5 * 60000);
  },
  refresh() { paint(); },
  deactivate() {
    B.active = false;
    clearTimeout(talkTimer); clearInterval(skyTimer);
    showDock(false);
  },
  subnav() { return wrapRow(sideSwitch('build'), null); },
  /* Habits' own row, under the switch, while Habits is the side on screen */
  frame(child, row) {
    if (child !== 'habits') return row;
    B.side = 'habits';
    store.write(SIDE_KEY, 'habits');
    return wrapRow(sideSwitch('habits'), row);
  },
  /* the bar's Build lands on the side last on */
  landing() { return store.read(SIDE_KEY, 'build') === 'habits' ? 'habits' : 'build'; },
  keepSubnav: true,
  newSince() { return 0; },
  pull() { return reload().then(() => null); },
});
/* Escape folds a full-screen site back down (never a shift) */
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dock && !dock.hidden && dock.dataset.state === 'full' && !shiftOpen()) setDock('dock'); });

/* for tests */
export const _state = () => ({ side: B.side, phase: B.phase, thing: B.thing, shift: status(), ending: ending(), open: shiftOpen(), lock: !!lock,
  dock: dock ? (dock.hidden ? 'hidden' : dock.dataset.state) : null, pallets, back: B.back, starters: B.starters });
export const _api = () => api();
export const _site = () => site;
