/* The Build: pick one thing you want to finish, set the phone down face-up,
   and go do it. While the phone sits there, your builder works on a drawing
   of Watershed, the building going up on Lakeside Avenue, beside every other
   neighbor on shift. Stephen's spec is the product (newsletter repo,
   reference/drafts/new-nine-2026-10/the-build/SPEC.md); BUILD-PLAN.md beside
   it splits the work four ways. This file is the tab.

   The tab took Habits' cell on the bar. A Build | Habits switch floats under
   the mast, the same as On Air's TV | Podcasts; Build is the default and
   Habits is the tracker as it stood, untouched (modes/habits.js, its own
   panel and its own #habits links). The one bridge: a habit tapped done
   drops a small load of material on the site.

   The Build side, top to bottom:
   - the site (js/build-site.js), half the page: the building as the town
     has raised it, everyone on shift working on it right now, lit by the
     real sun; under it the town line (who's on shift, the week's hours,
     the floor going up, the party);
   - your thing: its name, why it matters, the finish line; Start shift and
     Log it. With no thing yet, naming one (then why, then two optional
     questions), or the starter door: four things to borrow from town;
   - after a gap, one question with three answers instead of a neglected card;
   - hours off your phone, by day or by week; your part of the building
     (the cutaway); your shelf of posts;
   - neighbors: the feed. Nice, and on a Stuck post, I can help.

   A shift (build-shift.js keeps its clock) is the site full screen, the
   screen held awake, the builder working while the app is open and waiting
   while it is not. The foreman's whistle blows 15 to 30 minutes after the
   last touch: a buzz and a raised hand on the site, three minutes to touch
   the phone or pick it up. Missed, the crew knocks off with the time up to
   the last touch banked. Clocking out: the time, one line, Keep it or Post.

   No streaks, ranks, percentages or comments anywhere (DESIGN.md, the
   spec's "What we deliberately don't do"). Two places to type on a shift,
   both one line, both skippable.

   Data: the Build API (js/build-core.js live, build-local.js signed out,
   build-fake.js in ?demo=1). Words: data/build-foreman.json and
   data/build-starters.json; numbers: data/build-config.json. */

import * as app from '../app.js';
import * as store from '../store.js';
import { el, esc, svg, ICON, button, pills, listRail, agoShort } from '../ui.js';
import { liquify } from '../liquid.js';
import * as clock from '../build-shift.js';
import { createBuild, createSite } from '../build-standins.TEMP.js';
import { REASON_LABELS } from '../boards-core.js';
import { meetsInWindow, timeLabel } from '../clubs-week.js';

const KEY = 'build';
export const ICON_BUILD = svg('<path d="M3 17.5h18M5 17.5v-1.2a7 7 0 0 1 14 0v1.2"/><path d="M10 10V7.2a2 2 0 0 1 4 0V10"/>');
const SIDE_KEY = 'allday-build-side';      // the side last on: 'build' | 'habits'
const SHIFT_KEY = 'allday-build-shift';    // the open shift, written on every change
const SEEN_KEY = 'allday-build-back';      // the coming-back question, answered on this day
const COUNT_KEY = 'allday-build-count';    // shifts clocked out on this phone, for the rare "why" question
const STEP_KEY = 'allday-build-step';      // the smaller next step a Stuck post or a comeback named
const GAP_DAYS = 4;                        // this long with no hours and the next visit asks where to pick up
const LAT = 44.4759, LON = -73.2121;       // Burlington, for the site's sun
const KINDS = [['progress', 'Made progress'], ['stuck', 'Stuck'], ['found', 'Found something'], ['finished', 'Finished']];
const KIND = Object.fromEntries(KINDS);
const NEEDS = ['hand', 'tool', 'smaller', 'different'];
const NEED_REASON = { hand: 'skill', tool: 'skill', smaller: 'too_big', different: 'not_sure' };
const HATS = ['amber', 'brick', 'lake', 'park', 'plum', 'white'];
const LOG_CHOICES = [[15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 hr'], [90, '1½ hr'], [120, '2 hr'], [180, '3 hr']];

/* ------------------------------------------------------------------ words */
/* The foreman's lines (D's data/build-foreman.json) and what stands in until
   it loads or if it never does. He says things; he rarely asks. */
const FOREMAN_FALLBACK = {
  clock_in: ['What’s the job?'],
  clock_out: ['What got done?'],
  why: ['Why’s this one matter to you?'],
  come_back: ['Site’s still here. Where do you want to pick up?'],
  site_talk: ['{crew} on the site right now.', '{hours} hours in this week.', 'Floor {floor} is going up.'],
  stuck: { hand: 'A hand', tool: 'A tool', smaller: 'A smaller job', different: 'A different job' },
  stuck_reply: { hand: 'Post it. Somebody in town has done this.', tool: 'Post it. Somebody in town has one.', smaller: 'Name the smaller job and start there.', different: 'Pause it. No shame in that.' },
  comeback: { same: 'Same job', smaller: 'Smaller job', new: 'New job' },
};
const CONFIG_FALLBACK = { HOURS_PER_FLOOR: 25, floors: 6, season: { building: 'watershed', starts: null, topping_out_date: null, party_url: null } };

/* ------------------------------------------------------------------ state */
const B = {
  root: null, body: null, side: 'build',
  phase: 'loading', failed: null,
  api: null, apiFor: undefined,
  thing: undefined, town: null, record: [], shelf: [], feed: [], builder: null,
  foreman: FOREMAN_FALLBACK, config: CONFIG_FALLBACK, starters: null,
  draft: null,           // the thing being named: { step: 'name' | 'why' | 'more', title, why, ... }
  cut: false,            // the cutaway is showing
  scale: 'days',         // hours off your phone: 'days' | 'weeks'
  back: false,           // the coming-back question is showing
  talk: null,            // the foreman's site line on show
  drops: [],             // material from Habits waiting to land when the site is next on screen
  flash: null,           // a #build/<key> link waiting for its card
};
let site = null, siteBox = null, canvas = null, talkTimer = 0, skyTimer = 0, loadGen = 0;
const lastLine = Object.create(null);

const signedIn = () => !!app.user();
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------- the server */
/* One API per reader: the fake in the demo, the phone signed out, the
   account signed in. Every answer comes back as { ok, data, message }. */
function api() {
  const who = app.demo ? 'demo' : signedIn() ? 'u:' + app.user().id : 'local';
  if (!B.api || B.apiFor !== who) {
    B.api = createBuild({ demo: app.demo, user: app.user, token: app.token });
    B.apiFor = who;
  }
  return B.api;
}
function res(p) {
  return Promise.resolve().then(() => p).then((v) => (v && typeof v === 'object' && 'ok' in v && ('data' in v || 'message' in v || 'error' in v)
    ? { ok: !!v.ok, data: v.data, message: v.message || (v.ok ? '' : 'That didn’t go through. Try again.') }
    : { ok: true, data: v }), (e) => ({ ok: false, data: null, message: (e && e.message && !/^[a-z_]+$/.test(e.message) ? e.message : null) || 'That didn’t go through. Try again.' }));
}
const call = (fn) => res(Promise.resolve().then(fn));

/* ------------------------------------------------------------------ files */
const getJSON = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
let filesAsk = null;
function loadFiles() {
  if (filesAsk) return filesAsk;
  filesAsk = Promise.all([getJSON('data/build-foreman.json'), getJSON('data/build-config.json')]).then(([f, c]) => {
    if (f && typeof f === 'object') B.foreman = { ...FOREMAN_FALLBACK, ...f };
    if (c && typeof c === 'object') B.config = { ...CONFIG_FALLBACK, ...c, season: { ...CONFIG_FALLBACK.season, ...(c.season || {}) } };
  });
  return filesAsk;
}

/* one of the foreman's lines for a moment, never the same twice running */
function says(moment, vars) {
  const pool = B.foreman[moment];
  const list = Array.isArray(pool) ? pool.filter((x) => typeof x === 'string' && x) : typeof pool === 'string' ? [pool] : [];
  if (!list.length) return '';
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && i === lastLine[moment]) i = (i + 1) % list.length;
  lastLine[moment] = i;
  return list[i].replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
}
const word = (group, key) => {
  const g = B.foreman[group];
  return (g && typeof g === 'object' && typeof g[key] === 'string' && g[key]) || FOREMAN_FALLBACK[group][key];
};

/* ---------------------------------------------------------------- numbers */
export function hm(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return r + 'm';
  return r ? h + 'h ' + r + 'm' : h + 'h';
}
/* a bar's label: 45m, 2h, 2.5h */
const short = (m) => (m < 60 ? Math.round(m) + 'm' : (Math.round(m / 6) / 10).toString().replace(/\.0$/, '') + 'h');
const hoursWord = (minutes) => { const h = Math.floor((Number(minutes) || 0) / 60); return h === 1 ? '1 hour' : h + ' hours'; };
const crewWord = (n) => (n === 1 ? '1 neighbor' : n + ' neighbors');
function floorsOf(t) {
  const total = Math.max(1, Number(B.config.floors) || 6);
  const per = Math.max(1, Number(B.config.HOURS_PER_FLOOR) || 25) * 60;
  const mins = Number(t && t.total_minutes) || 0;
  const done = t && Number.isFinite(t.floors_done) ? t.floors_done : Math.min(total, Math.floor(mins / per));
  const progress = t && Number.isFinite(t.floor_progress) ? t.floor_progress : done >= total ? 1 : (mins % per) / per;
  return { total, done: Math.min(total, done), progress: Math.max(0, Math.min(1, progress)) };
}
const dayKey = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const dateWord = (key) => new Date(key + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/* -------------------------------------------------------------- loading */
function load() {
  const my = ++loadGen;
  B.phase = 'loading';
  B.failed = null;
  paint();
  const a = api();
  const thing = call(() => a.thing.get());
  const rest = Promise.all([
    call(() => a.town.get()), call(() => a.record.get()), call(() => a.shelf.get()),
    call(() => a.feed.list()), call(() => a.builder.get()), loadFiles(),
  ]);
  return Promise.all([thing, rest]).then(([t, [town, rec, shelf, feed, bld]]) => {
    if (my !== loadGen) return;
    if (!t.ok) { B.failed = t.message; B.phase = 'ready'; paint(); return; }
    B.thing = t.data && typeof t.data === 'object' && t.data.status !== 'done' ? t.data : null;
    B.town = town.ok ? town.data : null;
    B.record = rec.ok && Array.isArray(rec.data) ? rec.data : [];
    B.shelf = shelf.ok && Array.isArray(shelf.data) ? shelf.data : [];
    B.feed = feed.ok && Array.isArray(feed.data) ? feed.data : [];
    B.builder = bld.ok && bld.data ? bld.data : null;
    if (!B.builder || !B.builder.hat) B.builder = { ...(B.builder || {}), hat: HATS[Math.floor(Math.random() * HATS.length)], vest: 'amber' };
    B.back = !!B.thing && cameBack();
    B.phase = 'ready';
    paint();
    land();
    feedSite();
  });
}
/* the town and the feed, again: after a shift, a post, a pull */
function reloadTown() {
  const a = api();
  return Promise.all([call(() => a.town.get()), call(() => a.feed.list()), call(() => a.record.get()), call(() => a.shelf.get())]).then(([town, feed, rec, shelf]) => {
    if (town.ok) B.town = town.data;
    if (feed.ok && Array.isArray(feed.data)) B.feed = feed.data;
    if (rec.ok && Array.isArray(rec.data)) B.record = rec.data;
    if (shelf.ok && Array.isArray(shelf.data)) B.shelf = shelf.data;
    if (B.side === 'build' && B.phase === 'ready') { paint(); feedSite(); }
  });
}

/* ------------------------------------------------------ coming back */
/* After a gap the tab asks one question instead of showing a thing that
   looks neglected. Never says how long. */
function lastActive() {
  let last = 0;
  B.record.forEach((d) => { if ((Number(d.shift_minutes) || 0) + (Number(d.logged_minutes) || 0) > 0) last = Math.max(last, Date.parse(d.day + 'T12:00:00Z')); });
  return last;
}
function cameBack() {
  if (store.read(SEEN_KEY, '') === dayKey(Date.now())) return false;
  const since = lastActive() || Date.parse((B.thing && B.thing.created) || '') || 0;
  return !!since && Date.now() - since >= GAP_DAYS * 86400000;
}

/* --------------------------------------------------------------- drawing */
function paint() {
  if (!B.body) return;
  B.body.innerHTML = '';
  const wrap = el('div', 'bd');
  B.body.appendChild(wrap);
  wrap.appendChild(siteSection());
  if (B.phase === 'loading') { wrap.appendChild(el('div', 'bd-skel', '<span class="skel w60"></span><span class="skel big"></span><span class="skel pill"></span>')); return; }
  if (B.failed) {
    const box = el('div', 'bd-gate', '<p>' + esc(B.failed) + '</p>');
    box.appendChild(button('Try again', 'ghost', load));
    wrap.appendChild(box);
    return;
  }
  const cols = el('div', 'bd-cols');
  const left = el('div', 'bd-col'), right = el('div', 'bd-col');
  cols.append(left, right);
  wrap.appendChild(cols);
  if (B.thing && B.back) left.appendChild(comebackCard());
  left.appendChild(B.thing ? thingCard() : nameCard());
  /* no thing yet: four to borrow, right there under the name */
  if (!B.thing && (!B.draft || B.draft.step === 'name')) left.appendChild(starterDoor());
  if (B.thing || yourMinutes() > 0) left.appendChild(hoursSection());
  const shelf = shelfSection();
  if (shelf) left.appendChild(shelf);
  right.appendChild(feedSection());
}

/* the site, and the town line under it */
function siteSection() {
  const s = el('section', 'bd-site');
  s.dataset.k = 'site';
  if (!siteBox) {
    siteBox = el('div', 'bd-sitebox');
    canvas = document.createElement('canvas');
    canvas.className = 'bd-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'A drawing of Watershed going up on Lakeside Avenue, raised by the town’s hours');
    siteBox.appendChild(canvas);
    siteBox.appendChild(el('p', 'bd-talk'));
  }
  if (!shiftOpen()) s.appendChild(siteBox);
  s.appendChild(townLine());
  if (!site && canvas) {
    try { site = createSite(canvas, { reducedMotion: reduced() }); } catch (e) { console.error('[all-day] build site', e); site = null; }
  }
  return s;
}
function townLine() {
  const t = B.town || {};
  const crew = Array.isArray(t.on_shift) ? t.on_shift.length : 0;
  const f = floorsOf(t);
  const floorWord = f.done >= f.total ? 'topped out' : 'floor ' + (f.done + 1) + ' of ' + f.total;
  const line = el('div', 'bd-town');
  line.innerHTML = '<p class="bd-townl"><b>' + esc(crewWord(crew)) + '</b> on shift · <b>' + esc(hoursWord(t.week_minutes)) + '</b> this week · ' + esc(floorWord) + '</p>';
  const season = B.config.season || {};
  const when = season.topping_out_date ? new Date(season.topping_out_date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'date coming';
  const party = el(season.party_url ? 'a' : 'p', 'bd-party', esc('Topping-out party · ' + when));
  if (season.party_url && /^https:\/\//.test(season.party_url)) { party.href = season.party_url; party.target = '_blank'; party.rel = 'noopener'; }
  line.appendChild(party);
  return line;
}

/* everything the site draws, from what the tab knows */
function feedSite() {
  if (!site) return;
  const t = B.town || {};
  const f = floorsOf(t);
  try {
    site.setTown({ total_minutes: Number(t.total_minutes) || 0, floors_done: f.done, floor_progress: f.progress, windows_lit: Number(t.posts_lit) || 0 });
    site.setCrew((Array.isArray(t.on_shift) ? t.on_shift : []).map((c, i) => ({ id: c.id || 'c' + i, look: c.look || {}, task: c.task || null, name: c.name || null })));
    site.setYou(youState());
    site.setSky(sky());
    site.cutaway(B.cut, { your_minutes: yourMinutes() });
  } catch (e) { console.error('[all-day] build site', e); }
  while (B.drops.length && B.side === 'build') { try { site.dropMaterial(B.drops.shift()); } catch (e) { break; } }
}
function youState() {
  const look = { hat: (B.builder && B.builder.hat) || 'amber', vest: (B.builder && B.builder.vest) || 'amber' };
  if (!S) return { state: 'off', look, task: null };
  if (S.status !== 'on') return { state: 'off', look, task: null };
  if (S.since == null) return { state: 'away', look, task: null };
  return { state: paused ? 'paused' : 'working', look, task: null };
}
const yourMinutes = () => B.record.reduce((n, d) => n + (Number(d.shift_minutes) || 0) + (Number(d.logged_minutes) || 0), 0);

/* Burlington's sun, worked out here (a few lines of the standard solar
   position), and the weather line the What Now card reads */
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
function sky() {
  const alt = sunAltitude(Date.now());
  return { sunAltitude: alt, isNight: alt < -6, weather };
}
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
  const p = siteBox && siteBox.querySelector('.bd-talk');
  if (!p || B.phase !== 'ready') return;
  const t = B.town || {};
  const f = floorsOf(t);
  const line = says('site_talk', { crew: Array.isArray(t.on_shift) ? t.on_shift.length : 0, hours: Math.floor((Number(t.week_minutes) || 0) / 60), floor: Math.min(f.total, f.done + 1) });
  if (!line) return;
  p.textContent = line;
  p.classList.add('on');
  talkTimer = setTimeout(() => { p.classList.remove('on'); talkTimer = setTimeout(siteTalk, 4 * 60000); }, 9000);
}

/* ------------------------------------------------------------ your thing */
function thingCard() {
  const t = B.thing;
  const c = el('section', 'bd-thing');
  c.dataset.k = 'thing';
  const meta = [t.target_date ? 'By ' + dateWord(String(t.target_date).slice(0, 10)) : '', t.for_whom ? 'For ' + t.for_whom : '', t.partner ? 'With ' + t.partner : ''].filter(Boolean);
  c.innerHTML = '<h2 class="bd-title">' + esc(t.title) + '</h2>' +
    (t.why ? '<p class="bd-why">' + esc('“' + t.why + '”') + '</p>' : '') +
    (meta.length ? '<p class="bd-meta">' + meta.map(esc).join(' · ') + '</p>' : '') +
    (t.status === 'paused' ? '<p class="bd-meta">Paused</p>' : '');
  const go = el('div', 'bd-go');
  const start = button(ICON_BUILD + '<span>Start shift</span>', 'bd-start', () => clockInSheet());
  const log = button('Log it', 'ghost bd-log', () => logSheet());
  const more = el('button', 'iconbtn bd-more', ICON.more);
  more.type = 'button';
  more.setAttribute('aria-label', 'More for your thing');
  more.addEventListener('click', thingSheet);
  go.append(start, log, more);
  c.appendChild(go);
  return c;
}

/* naming a thing: the name, then why, then the two optional questions */
function nameCard() {
  const d = B.draft || (B.draft = { step: 'name' });
  const c = el('section', 'bd-thing bd-name');
  c.dataset.k = 'thing';
  const form = el('form', 'bd-form');
  form.noValidate = true;
  const field = (name, ph, value, type) => {
    const i = el('input', 'field');
    i.name = name; i.type = type || 'text'; i.placeholder = ph || ''; i.value = value || ''; i.maxLength = 140;
    i.setAttribute('aria-label', ph || name);
    return i;
  };
  const row = (...kids) => { const r = el('div', 'bd-row'); r.append(...kids); return r; };
  if (d.step === 'name') {
    form.appendChild(el('h2', 'bd-ask', esc('What do you want to finish?')));
    const i = field('title', 'Finish the screenplay', d.title);
    const go = button('Name it', 'bd-start');
    go.type = 'submit';
    form.appendChild(row(i, go));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = i.value.trim();
      if (!v) { i.focus(); return; }
      d.title = v.slice(0, 140); d.step = 'why'; paint(); focusField();
    });
    c.appendChild(form);
    return c;
  }
  /* one card for the rest: why it matters, then the two optional questions
     (kept apart: one is who it's for, the other who's in on it) and a date */
  form.appendChild(el('p', 'bd-kicker', esc(d.title)));
  const q = (label, input) => { const l = el('label', 'bd-q', '<span>' + esc(label) + '</span>'); l.appendChild(input); return l; };
  form.appendChild(el('h2', 'bd-ask', esc('Why does it matter to you?')));
  form.appendChild(field('why', 'One line, or leave it', d.why));
  form.appendChild(q('Is it for someone?', field('for_whom', 'Yourself counts', d.for_whom)));
  form.appendChild(q('Want someone in on it?', field('partner', 'A name', d.partner)));
  form.appendChild(q('Finish by', field('target_date', '', d.target_date, 'date')));
  const go = button('Done', 'bd-start'); go.type = 'submit';
  form.appendChild(row(go));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const thing = { title: d.title, why: String(fd.get('why') || '').trim().slice(0, 280), for_whom: String(fd.get('for_whom') || '').trim().slice(0, 80), partner: String(fd.get('partner') || '').trim().slice(0, 80),
      target_date: /^\d{4}-\d{2}-\d{2}$/.test(String(fd.get('target_date') || '')) ? String(fd.get('target_date')) : null };
    go.disabled = true;
    call(() => api().thing.set(thing)).then((r) => {
      go.disabled = false;
      if (!r.ok) { app.toast(r.message); return; }
      B.thing = r.data && r.data.title ? r.data : { ...thing, status: 'active' };
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

/* "No thing yet?" Four things to borrow from town: a mission, a club that
   meets this week, an Up For It idea that tipped, a neighbor's thing. */
let startersAsk = null;
function loadStarters() {
  if (startersAsk) return startersAsk;
  startersAsk = Promise.all([getJSON('data/build-starters.json'), getJSON('../data/missions.json'), getJSON('../data/run-clubs.json')]).then(([st, mi, rc]) => {
    const out = [];
    const day = Math.floor(Date.now() / 86400000);
    const missions = mi && Array.isArray(mi.missions) ? mi.missions.filter((m) => m && m.title && !m.needs_check) : [];
    if (missions.length) { const m = missions[day % missions.length]; out.push({ k: 'st-' + m.k, kind: 'Mission', title: m.title, why: m.teaser || '', href: '#whatnow/' + m.k }); }
    const clubs = rc && Array.isArray(rc.clubs) ? rc.clubs : [];
    try {
      const meets = meetsInWindow(clubs, Date.now(), Date.now() + 7 * 86400000);
      const m = meets && meets[0];
      if (m) { const club = m.club || {}; out.push({ k: 'st-club-' + (club.id || 'x'), kind: club.kind === 'run' ? 'Run club' : 'Meets this week', title: club.name ? 'Run with ' + club.name : 'A club this week', why: (m.day ? '' : '') + (club.what || ''), href: club.url || '#people' }); }
    } catch (e) { /* no week to show */ }
    const extra = st && Array.isArray(st.fallback) ? st.fallback : st && Array.isArray(st.starters) ? st.starters : [];
    const ideas = extra.filter((x) => x && x.title);
    const things = B.feed.filter((p) => p && p.thing_title && p.thing_why).slice(0, 1).map((p) => ({ k: 'st-p-' + p.id, kind: 'A neighbor’s thing', title: p.thing_title, why: p.thing_why, href: '#build/p-' + p.id }));
    ideas.forEach((x, i) => out.push({ k: 'st-x-' + i, kind: x.kind || 'Up For It', title: x.title, why: x.why || x.line || '', href: x.href || '#build' }));
    out.splice(3, 0, ...things);
    B.starters = out.slice(0, 4);
    if (!B.thing && B.side === 'build' && B.phase === 'ready') paint();
  });
  return startersAsk;
}
function starterDoor() {
  const s = el('section', 'bd-door');
  s.dataset.k = 'starters';
  s.appendChild(el('div', 'bd-head', '<h2>No thing yet? Borrow one</h2>'));
  if (!B.starters) { s.appendChild(el('div', 'bd-skel', '<span class="skel w60"></span><span class="skel w40"></span>')); loadStarters(); return s; }
  const grid = el('div', 'bd-starters');
  B.starters.forEach((st) => {
    const c = el('div', 'bd-starter');
    c.dataset.k = st.k;
    c.innerHTML = '<p class="bd-skind">' + esc(st.kind) + '</p><h3>' + esc(st.title) + '</h3>' + (st.why ? '<p class="bd-swhy">' + esc(st.why) + '</p>' : '');
    c.appendChild(button('Pick this', 'ghost sm', () => { B.draft = { step: 'why', title: st.title }; paint(); app.flashHit(B.body, 'thing'); focusField(); }));
    grid.appendChild(c);
  });
  s.appendChild(grid);
  return s;
}

/* the thing's own sheet: change it, finish it, pause it, your builder */
function thingSheet() {
  app.sheet(B.thing.title, (body, card, close) => {
    const row = (label, cls, fn) => { const r = el('div', 'sheet-row', '<div class="t">' + esc(label) + '</div>'); const b = button(esc(label.split(' ')[0]), cls, fn); r.innerHTML = ''; r.appendChild(el('div', 't', esc(label))); r.appendChild(b); return r; };
    body.appendChild(row('Finished it', 'sm', () => { close(); finishThing(); }));
    body.appendChild(row(B.thing.status === 'paused' ? 'Pick it back up' : 'Pause it', 'ghost sm', () => {
      close();
      const back = B.thing.status === 'paused';
      call(() => (back ? api().thing.set({ ...B.thing, status: 'active' }) : api().thing.pause())).then((r) => {
        if (!r.ok) { app.toast(r.message); return; }
        B.thing = { ...B.thing, status: back ? 'active' : 'paused' };
        paint();
      });
    }));
    body.appendChild(row('Change the thing', 'ghost sm', () => { close(); B.draft = { step: 'name', title: B.thing.title }; B.thing = null; paint(); focusField(); }));
    body.appendChild(el('div', 'sheet-h', 'Your builder'));
    const hats = el('div', 'bd-hats');
    hats.setAttribute('role', 'group');
    hats.setAttribute('aria-label', 'Hard hat colour');
    HATS.forEach((h) => {
      const b = el('button', 'bd-hat' + ((B.builder && B.builder.hat) === h ? ' on' : ''));
      b.type = 'button';
      b.dataset.hat = h;
      b.setAttribute('aria-label', h);
      b.setAttribute('aria-pressed', (B.builder && B.builder.hat) === h ? 'true' : 'false');
      b.addEventListener('click', () => {
        B.builder = { ...(B.builder || {}), hat: h };
        hats.querySelectorAll('.bd-hat').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        call(() => api().builder.set(B.builder));
        if (site) site.setYou(youState());
      });
      hats.appendChild(b);
    });
    body.appendChild(hats);
  });
}
function finishThing() {
  call(() => api().thing.finish()).then((r) => {
    if (!r.ok) { app.toast(r.message); return; }
    const done = B.thing;
    B.thing = null; B.draft = { step: 'name' };
    paint();
    /* finishing gets its own post, and its own five minutes at the party */
    postSheet({ kind: 'finished', line: 'Finished ' + lower(done.title), minutes: 0, thing: done, after: () => {} });
  });
}
const lower = (s) => String(s || '').replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase());

/* ------------------------------------------------------------ coming back */
function comebackCard() {
  const c = el('section', 'bd-back');
  c.dataset.k = 'back';
  c.appendChild(el('p', 'bd-foreman', esc(says('come_back'))));
  const r = el('div', 'bd-row');
  const done = () => { store.write(SEEN_KEY, dayKey(Date.now())); B.back = false; };
  r.appendChild(button(esc(word('comeback', 'same')), 'bd-start', () => { done(); paint(); }));
  r.appendChild(button(esc(word('comeback', 'smaller')), 'ghost', () => { done(); paint(); clockInSheet({ smaller: true }); }));
  r.appendChild(button(esc(word('comeback', 'new')), 'ghost', () => { done(); B.draft = { step: 'name' }; B.thing = null; paint(); focusField(); }));
  c.appendChild(r);
  return c;
}

/* ------------------------------------------------------------ progress */
function hoursSection() {
  const s = el('section', 'bd-hours');
  s.dataset.k = 'hours';
  const head = el('div', 'bd-head', '<h2>Hours off your phone</h2>');
  const sw = pills([['days', 'Days'], ['weeks', 'Weeks']], B.scale, (v) => { B.scale = v; const n = hoursSection(); s.replaceWith(n); }, 'bd-scale');
  head.appendChild(sw);
  s.appendChild(head);
  const byDay = new Map(B.record.map((d) => [String(d.day).slice(0, 10), d]));
  const today = dayKey(Date.now());
  const back = (key, n) => { const t = Date.parse(key + 'T12:00:00Z') - n * 86400000; return new Date(t).toISOString().slice(0, 10); };
  let bars;
  if (B.scale === 'days') {
    bars = Array.from({ length: 7 }, (_, i) => {
      const k = back(today, 6 - i), d = byDay.get(k) || {};
      return { label: new Date(k + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }), shift: Number(d.shift_minutes) || 0, logged: Number(d.logged_minutes) || 0, now: k === today };
    });
  } else {
    /* a week is the seven days ending on that bar's day */
    bars = Array.from({ length: 8 }, (_, i) => {
      const end = back(today, (7 - i) * 7);
      let shift = 0, logged = 0;
      for (let j = 0; j < 7; j++) { const d = byDay.get(back(end, j)); if (d) { shift += Number(d.shift_minutes) || 0; logged += Number(d.logged_minutes) || 0; } }
      return { label: i === 7 ? 'This week' : dateWord(back(end, 6)), shift, logged, now: i === 7 };
    });
  }
  const week = bars.length && B.scale === 'days' ? bars.reduce((n, b) => n + b.shift + b.logged, 0) : (bars[bars.length - 1].shift + bars[bars.length - 1].logged);
  const max = Math.max(60, ...bars.map((b) => b.shift + b.logged));
  s.appendChild(el('p', 'bd-big', '<b>' + esc(hm(week)) + '</b> <span>' + esc(B.scale === 'days' ? 'last 7 days' : 'this week') + '</span>'));
  const chart = el('div', 'bd-bars' + (B.scale === 'weeks' ? ' wk' : ''));
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', bars.map((b) => b.label + ' ' + hm(b.shift + b.logged)).join(', '));
  bars.forEach((b) => {
    const tot = b.shift + b.logged;
    const col = el('div', 'bd-bar' + (b.now ? ' now' : ''));
    col.innerHTML = '<span class="bd-v">' + (tot ? esc(short(tot)) : '') + '</span><span class="bd-track"><i class="sh" style="height:' + (b.shift / max * 100).toFixed(1) + '%"></i><i class="lg" style="height:' + (b.logged / max * 100).toFixed(1) + '%"></i></span><span class="bd-l">' + esc(b.label) + '</span>';
    chart.appendChild(col);
  });
  s.appendChild(chart);
  if (bars.some((b) => b.logged)) s.appendChild(el('p', 'bd-key', '<i class="sh"></i>Shifts <i class="lg"></i>Logged'));
  const cut = button(B.cut ? 'Back to the whole site' : 'See your part of the building', 'ghost bd-cutbtn', () => {
    B.cut = !B.cut;
    if (site) site.cutaway(B.cut, { your_minutes: yourMinutes() });
    cut.textContent = B.cut ? 'Back to the whole site' : 'See your part of the building';
    cut.setAttribute('aria-pressed', B.cut ? 'true' : 'false');
    if (B.cut) app.scrollTop(true);
  });
  cut.setAttribute('aria-pressed', B.cut ? 'true' : 'false');
  s.appendChild(cut);
  return s;
}

function shelfSection() {
  if (!B.shelf.length) return null;
  const s = el('section', 'bd-shelf');
  s.dataset.k = 'shelf';
  s.appendChild(el('div', 'bd-head', '<h2>Your shelf</h2>'));
  const r = listRail(s, { name: 'build-shelf', label: 'your shelf', cls: 'bd-shelfrail' });
  B.shelf.forEach((p) => {
    const c = el('div', 'bd-shelfcard k-' + esc(p.kind));
    c.innerHTML = '<p class="bd-kind">' + esc(KIND[p.kind] || 'Post') + '</p><p class="bd-sline">' + esc(p.line) + '</p><p class="bd-sdate">' + esc(dateWord(String(p.created).slice(0, 10))) + '</p>';
    r.appendChild(c);
  });
  return s;
}

/* -------------------------------------------------------------- the feed */
const postItem = (p) => ({ k: 'p-' + p.id, id: p.id, kind: 'build', title: p.line, text: p.line, author: p.name || 'A neighbor', href: '#build/p-' + p.id, post: p });
function feedSection() {
  const s = el('section', 'bd-feed');
  s.dataset.k = 'neighbors';
  s.appendChild(el('div', 'bd-head', '<h2>Neighbors</h2>'));
  const list = el('div', 'bd-posts');
  const posts = B.feed.filter((p) => p && p.id && p.line);
  app.know(posts.map(postItem));
  if (!posts.length) list.appendChild(el('p', 'bd-empty', 'No posts yet.'));
  posts.forEach((p) => list.appendChild(postCard(p)));
  s.appendChild(list);
  return s;
}
function postCard(p) {
  const c = el('article', 'card bd-post k-' + esc(p.kind));
  c.dataset.k = 'p-' + p.id;
  const ago = p.created ? agoShort(Date.parse(p.created) / 1000) : '';
  const hours = Number(p.hours_minutes || p.hours) > 0 ? hm(p.hours_minutes || p.hours) : '';
  c.innerHTML = '<div class="c-head"><span class="c-src">' + esc(p.name || 'A neighbor') + '</span>' + (ago ? '<span>· ' + esc(ago) + '</span>' : '') + '</div>' +
    '<p class="bd-kind">' + esc(KIND[p.kind] || 'Post') + (hours ? ' · ' + esc(hours) : '') + '</p>' +
    '<p class="bd-line">' + esc(p.line) + '</p>' +
    (p.kind === 'stuck' && p.help_need ? '<p class="bd-need">' + esc(needWords(p.help_need)) + '</p>' : '') +
    (p.photo_url ? '<span class="c-media r45"><img class="pic" loading="lazy" decoding="async" alt="" src="' + esc(p.photo_url) + '"></span>' : '');
  const acts = el('div', 'bd-acts');
  const nice = el('button', 'bd-nice' + (p.mine_nice ? ' on' : ''), ICON.heart + '<span>Nice</span><span class="n">' + (Number(p.nice) > 0 ? esc(p.nice) : '') + '</span>');
  nice.type = 'button';
  nice.dataset.act = 'bdnice';
  nice.setAttribute('aria-pressed', p.mine_nice ? 'true' : 'false');
  acts.appendChild(nice);
  if (p.kind === 'stuck' && !p.mine && !p.helped) {
    const help = el('button', 'btn sm bd-help', 'I can help');
    help.type = 'button';
    help.dataset.act = 'bdhelp';
    acts.appendChild(help);
  }
  if (p.helped) acts.appendChild(el('span', 'bd-sent', 'Offer sent'));
  const more = el('button', 'iconbtn bd-pmore', ICON.more);
  more.type = 'button';
  more.dataset.act = 'bdmore';
  more.setAttribute('aria-label', 'More for this post');
  acts.appendChild(more);
  c.appendChild(acts);
  /* the poster sees who offered, one line each, and answers */
  const offers = Array.isArray(p.offers) ? p.offers.filter((o) => o && o.status === 'offered') : [];
  if (p.mine && offers.length) {
    const box = el('div', 'bd-offers');
    offers.forEach((o) => {
      const r = el('div', 'bd-offer');
      r.dataset.help = o.id;
      r.innerHTML = '<p><b>' + esc(o.helper_name || 'A neighbor') + '</b> ' + esc(o.line || '') + '</p>';
      const yes = el('button', 'btn sm', 'Yes'); yes.type = 'button'; yes.dataset.act = 'bdyes';
      const no = el('button', 'btn sm ghost', 'No thanks'); no.type = 'button'; no.dataset.act = 'bdno';
      const row = el('div', 'bd-row'); row.append(yes, no);
      r.appendChild(row);
      box.appendChild(r);
    });
    c.appendChild(box);
  }
  const yes = Array.isArray(p.offers) ? p.offers.find((o) => o && o.status === 'accepted') : null;
  if (p.mine && yes) c.appendChild(el('p', 'bd-sent', esc('You and ' + (yes.helper_name || 'a neighbor') + ' have each other’s email')));
  return c;
}
const needWords = (k) => ({ hand: 'Could use a hand', tool: 'Could use a tool', smaller: 'Looking for a smaller job', different: 'Thinking about a different job' }[k] || String(k));

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
  if (!p || needSignIn('say nice')) return;
  p.mine_nice = !p.mine_nice;
  p.nice = Math.max(0, (Number(p.nice) || 0) + (p.mine_nice ? 1 : -1));
  repaintPost(p);
  call(() => api().nice.toggle(p.id)).then((r) => {
    if (r.ok) return;
    p.mine_nice = !p.mine_nice; p.nice = Math.max(0, p.nice + (p.mine_nice ? 1 : -1));
    repaintPost(p); app.toast(r.message);
  });
});
app.onAct('bdhelp', (it) => {
  const p = postOf(it);
  if (!p || needSignIn('offer help')) return;
  app.sheet('I can help', (body, card, close) => {
    body.appendChild(el('p', 'bd-sline', esc((p.name || 'A neighbor') + '. ' + p.line)));
    if (p.help_need) body.appendChild(el('p', 'bd-need', esc(needWords(p.help_need))));
    const f = el('form', 'bd-form');
    f.noValidate = true;
    const i = el('input', 'field');
    i.name = 'line'; i.maxLength = 140; i.placeholder = 'I’ve got a stand and a Tuesday';
    i.setAttribute('aria-label', 'What you can offer, in a line');
    const go = button('Send', ''); go.type = 'submit';
    const row = el('div', 'bd-row'); row.append(i, go);
    f.appendChild(row);
    f.appendChild(el('p', 'sheet-note', 'If they say yes, you each get the other’s email.'));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const line = i.value.trim();
      if (!line) { i.focus(); return; }
      go.disabled = true;
      call(() => api().help.offer(p.id, line.slice(0, 140))).then((r) => {
        go.disabled = false;
        if (!r.ok) { app.toast(r.message); return; }
        p.helped = true; repaintPost(p); close(); app.toast('Sent');
      });
    });
    body.appendChild(f);
    setTimeout(() => i.focus({ preventScroll: true }), 50);
  });
});
function answerHelp(it, act, yes) {
  const p = postOf(it);
  const row = act.closest('[data-help]');
  if (!p || !row) return;
  const id = row.dataset.help;
  row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  call(() => api().help.respond(id, yes)).then((r) => {
    if (!r.ok) { row.querySelectorAll('button').forEach((b) => { b.disabled = false; }); app.toast(r.message); return; }
    const o = (p.offers || []).find((x) => x.id === id);
    if (o) o.status = yes ? 'accepted' : 'declined';
    repaintPost(p);
    app.toast(yes ? 'You’ll both get an email' : 'Said no thanks');
  });
}
app.onAct('bdyes', (it, act) => answerHelp(it, act, true));
app.onAct('bdno', (it, act) => answerHelp(it, act, false));
app.onAct('bdmore', (it) => {
  const p = postOf(it);
  if (!p) return;
  app.sheet(p.mine ? 'Your post' : (p.name || 'A neighbor') + '’s post', (body, card, close) => {
    if (p.mine) { body.appendChild(el('p', 'sheet-note', esc(p.line))); return; }
    body.appendChild(el('div', 'sheet-h', 'Report this post'));
    Object.entries(REASON_LABELS).forEach(([k, label]) => {
      const r = el('div', 'sheet-row', '<div class="t">' + esc(label) + '</div>');
      r.appendChild(button('Report', 'ghost sm', () => {
        if (needSignIn('report')) return;
        close();
        call(() => api().report({ target: p.id, kind: 'post', reason: k })).then((x) => app.toast(x.ok ? 'Reported. Thanks.' : x.message));
      }));
      body.appendChild(r);
    });
    body.appendChild(el('div', 'sheet-h', 'Block'));
    const r = el('div', 'sheet-row', '<div class="t">' + esc('Block ' + (p.name || 'this neighbor')) + '</div>');
    r.appendChild(button('Block', 'danger sm', () => {
      if (needSignIn('block')) return;
      close();
      app.confirmBox({ title: 'Block ' + (p.name || 'this neighbor') + '?', body: 'You won’t see their posts or offers, and they can’t offer you help.', yes: 'Block', onYes() {
        call(() => api().block(p.user)).then((x) => {
          if (!x.ok) { app.toast(x.message); return; }
          B.feed = B.feed.filter((q) => q.user !== p.user);
          paint();
          app.toast('Blocked');
        });
      } });
    }));
    body.appendChild(r);
  });
});

/* ------------------------------------------------------------- shifts */
/* The open shift: build-shift.js's object, written to the phone on every
   change so a reload, a crash or a closed tab picks it back up. */
let S = null, layer = null, tickTimer = 0, lastSave = 0, lastBeat = 0, paused = false, pauseTimer = 0, lock = null, rest = null, motionOn = false, lastMotion = 0;
const rand = () => Math.random();
const shiftOpen = () => !!layer;
const saveShift = () => { if (!S) { store.write(SHIFT_KEY, null); return; } S.saved = Date.now(); lastSave = S.saved; store.write(SHIFT_KEY, S); };

/* "What's the job?" One line, or Start and skip it. Typing spot one. */
function clockInSheet(o = {}) {
  const hint = store.read(STEP_KEY, '');
  app.sheet(o.smaller ? 'A smaller job' : 'Clock in', (body, card, close) => {
    body.appendChild(el('p', 'bd-foreman', esc(o.smaller ? 'What’s the smaller job?' : says('clock_in'))));
    const f = el('form', 'bd-form');
    f.noValidate = true;
    const i = el('input', 'field');
    i.name = 'step'; i.maxLength = 140; i.placeholder = typeof hint === 'string' && hint ? hint : 'Outline chapter 3';
    i.setAttribute('aria-label', 'The next step, in a line');
    const go = button(ICON_BUILD + '<span>Start</span>', 'bd-start'); go.type = 'submit';
    const row = el('div', 'bd-row'); row.append(i, go);
    f.appendChild(row);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      /* iPhone asks once to read the phone being picked up: in this tap */
      askMotion();
      const step = i.value.trim().slice(0, 140);
      store.write(STEP_KEY, '');
      close();
      startShift(step);
    });
    body.appendChild(f);
    setTimeout(() => { if (matchMedia('(hover: hover)').matches) i.focus({ preventScroll: true }); }, 50);
  });
}

function startShift(step) {
  if (S && S.status === 'on') { openLayer(); return; }
  const now = Date.now();
  S = clock.start(now, rand, { thing: B.thing && B.thing.id, step });
  saveShift();
  call(() => api().shift.start(step)).then((r) => { if (r.ok && r.data && S && !S.id) { S.id = r.data.id || r.data; saveShift(); } });
  openLayer();
}

function openLayer() {
  if (layer) return;
  layer = el('div', 'bd-shift');
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-label', 'On shift');
  const top = el('div', 'bd-shift-site');
  if (siteBox) top.appendChild(siteBox);
  const foot = el('div', 'bd-shift-foot');
  layer.append(top, foot, el('p', 'bd-live'));
  layer.querySelector('.bd-live').setAttribute('aria-live', 'polite');
  document.body.appendChild(layer);
  document.body.classList.add('bd-shifting');
  layer.addEventListener('pointerdown', onTouch, { passive: true });
  layer.addEventListener('keydown', (e) => { if (e.key !== 'Tab') onTouch(e); });
  paintFoot();
  wake();
  watchMotion(true);
  clearInterval(tickTimer);
  tickTimer = setInterval(onTick, 1000);
  if (site) { site.setYou(youState()); site.whistle(!!(S && S.whistleOpen)); }
  /* the town's crew, live: you are one of them now */
  call(() => api().town.get()).then((r) => { if (r.ok) { B.town = r.data; feedSite(); paintFoot(); } });
}
function closeLayer() {
  if (!layer) return;
  clearInterval(tickTimer); tickTimer = 0;
  clearTimeout(pauseTimer); paused = false;
  watchMotion(false);
  unwake();
  layer.remove();
  layer = null;
  document.body.classList.remove('bd-shifting');
  if (site) { site.whistle(false); site.setYou(youState()); }
  if (B.side === 'build') paint();
}

function paintFoot() {
  if (!layer) return;
  const foot = layer.querySelector('.bd-shift-foot');
  foot.innerHTML = '';
  layer.classList.toggle('is-whistle', !!(S && S.status === 'on' && S.whistleOpen));
  layer.classList.toggle('is-off', !!(S && S.status === 'off'));
  if (!S) return;
  if (S.status === 'done' || S.endScreen) { endScreen(foot); return; }
  const crew = B.town && Array.isArray(B.town.on_shift) ? B.town.on_shift.length : 0;
  if (S.status === 'off') {
    foot.appendChild(el('p', 'bd-shift-step', esc('Crew knocked off')));
    foot.appendChild(el('p', 'bd-shift-crew', esc(hm(clock.minutes(S.worked)) + ' banked')));
    const r = el('div', 'bd-row');
    r.appendChild(button('Done', 'bd-start', () => { S.endScreen = true; saveShift(); paintFoot(); }));
    r.appendChild(button('Start again', 'ghost on-dark', () => { finishShift({ keep: true, quiet: true }).then(() => clockInSheet()); }));
    foot.appendChild(r);
    return;
  }
  if (S.step) foot.appendChild(el('p', 'bd-shift-step', esc(S.step)));
  foot.appendChild(el('p', 'bd-shift-crew', esc(crewWord(Math.max(1, crew)) + ' on shift')));
  foot.appendChild(button('Clock out', 'ghost on-dark bd-out', () => { clock.end(S, Date.now()); S.endScreen = true; saveShift(); call(() => api().shift.whistleAnswered()); paintFoot(); if (site) site.setYou({ ...youState(), state: 'off' }); }));
}

/* the end screen: the time, one line, Keep it or Post. Typing spot two. */
function endScreen(foot) {
  const mins = clock.minutes(S.worked);
  const count = Number(store.read(COUNT_KEY, 0)) || 0;
  const askWhy = !!B.thing && (count + 1) % 10 === 0;
  foot.classList.add('end');
  foot.appendChild(el('p', 'bd-endtime', esc(hm(mins))));
  foot.appendChild(el('p', 'bd-foreman', esc(askWhy ? says('why') : says('clock_out'))));
  const f = el('form', 'bd-form');
  f.noValidate = true;
  const i = el('input', 'field');
  i.name = 'note'; i.maxLength = 280; i.value = S.note || '';
  i.placeholder = askWhy ? 'One line' : 'One line, or skip it';
  i.setAttribute('aria-label', askWhy ? 'Why it matters, in a line' : 'What got done, in a line');
  i.addEventListener('input', () => { S.note = i.value; });
  f.appendChild(i);
  const r = el('div', 'bd-row');
  const keep = button('Keep it', 'ghost on-dark', (e) => { e.preventDefault(); S.note = i.value.trim(); finishShift({ keep: true }); });
  const post = button('Post', 'bd-start', (e) => {
    e.preventDefault();
    S.note = i.value.trim();
    if (needSignIn('post')) return;
    const note = S.note;
    const done = { ...S };
    finishShift({ keep: false }).then(() => postSheet({ kind: 'progress', line: note, minutes: clock.minutes(done.worked), thing: B.thing }));
  });
  r.append(keep, post);
  f.appendChild(r);
  f.addEventListener('submit', (e) => { e.preventDefault(); keep.click(); });
  foot.appendChild(f);
}

/* the shift goes on the record (and up the building), then the layer closes */
function finishShift(o = {}) {
  if (!S) { closeLayer(); return Promise.resolve(); }
  const s = S;
  const mins = clock.minutes(s.worked);
  const count = (Number(store.read(COUNT_KEY, 0)) || 0) + 1;
  store.write(COUNT_KEY, count);
  S = null;
  saveShift();
  if (site) { site.setYou({ ...youState(), state: 'off' }); if (mins >= 1) site.dropMaterial(mins >= 90 ? 'timber' : mins >= 30 ? 'brick' : 'lumber'); }
  const why = !!B.thing && count % 10 === 0;
  return call(() => api().shift.end({ id: s.id, note: why ? '' : (s.note || ''), why: why ? (s.note || '') : '', banked_minutes: mins, missed: s.status === 'off' })).then((r) => {
    if (!r.ok) app.toast(r.message);
    else if (!o.quiet && o.keep) app.toast(mins ? hm(mins) + ' in the building' : 'Clocked out');
    closeLayer();
    reloadTown();
  });
}

/* every second while the shift screen is up */
function onTick() {
  if (!S) return;
  const now = Date.now();
  const e = clock.tick(S, now);
  if (e === 'whistle') {
    if (navigator.vibrate) { try { navigator.vibrate([180]); } catch (x) { /* no buzz */ } }
    if (site) site.whistle(true);
    const live = layer && layer.querySelector('.bd-live');
    if (live) live.textContent = 'The foreman’s whistle';
    saveShift();
    paintFoot();
  } else if (e === 'missed') {
    missed();
  }
  if (S && now - lastSave >= 15000) saveShift();
  if (S && S.status === 'on' && S.since != null && now - lastBeat >= 60000) { lastBeat = now; call(() => api().shift.heartbeat()); }
}
function missed() {
  if (site) { site.whistle(false); site.setYou({ ...youState(), state: 'off' }); }
  const live = layer && layer.querySelector('.bd-live');
  if (live) live.textContent = 'Crew knocked off';
  saveShift();
  paintFoot();
}
/* a hand on the phone: the tools go down a moment, and a waiting whistle is answered */
function onTouch() {
  if (!S || S.status !== 'on') return;
  const answered = clock.touch(S, Date.now(), rand);
  saveShift();
  if (answered) {
    if (site) site.whistle(false);
    call(() => api().shift.whistleAnswered());
    const live = layer && layer.querySelector('.bd-live');
    if (live) live.textContent = '';
    paintFoot();
  }
  paused = true;
  if (site) site.setYou(youState());
  clearTimeout(pauseTimer);
  pauseTimer = setTimeout(() => { paused = false; if (site && S) site.setYou(youState()); }, 3000);
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
function onMotion(e) {
  const g = e.accelerationIncludingGravity;
  if (!g || g.x == null) return;
  const now = Date.now();
  if (!rest) { rest = { x: g.x, y: g.y, z: g.z }; return; }
  if (clock.pickedUp(rest, g) && now - lastMotion > 2000) { lastMotion = now; onTouch(); }
  /* the resting pull drifts slowly toward where the phone now lies */
  rest = { x: rest.x * 0.95 + g.x * 0.05, y: rest.y * 0.95 + g.y * 0.05, z: rest.z * 0.95 + g.z * 0.05 };
}
function watchMotion(on) {
  if (on && !motionOn && 'DeviceMotionEvent' in window) { rest = null; window.addEventListener('devicemotion', onMotion); motionOn = true; }
  if (!on && motionOn) { window.removeEventListener('devicemotion', onMotion); motionOn = false; }
}

/* leave the app and the builder stops and waits; come back and the tools go up */
document.addEventListener('visibilitychange', () => {
  if (!S || S.status !== 'on') return;
  const now = Date.now();
  if (document.visibilityState === 'hidden') {
    clock.hide(S, now);
    saveShift();
    if (site) site.setYou(youState());
    return;
  }
  const r = clock.show(S, now, rand);
  saveShift();
  if (r === 'missed') { missed(); return; }
  if (r === 'answered') call(() => api().shift.whistleAnswered());
  if (site) { site.whistle(false); site.setYou(youState()); }
  wake();
  paintFoot();
});

/* a shift the phone was in the middle of: pick it back up */
function recoverShift() {
  const saved = store.read(SHIFT_KEY, null);
  if (!clock.valid(saved)) { if (saved) store.write(SHIFT_KEY, null); return; }
  S = saved;
  if (S.status === 'on') {
    const r = clock.recover(S, Date.now(), rand);
    saveShift();
    call(() => api().shift.recover());
    openLayer();
    if (r === 'missed') missed();
    return;
  }
  openLayer();
}

/* ------------------------------------------------------------- Log it */
/* Real work away from the phone: say roughly how long, and it counts the
   same, marked "logged" on your own record. Nobody checks. */
function logSheet() {
  app.sheet('Log it', (body, card, close) => {
    body.appendChild(el('p', 'bd-foreman', esc('How long?')));
    let mins = 0;
    const choose = el('div', 'bd-logs');
    choose.setAttribute('role', 'group');
    choose.setAttribute('aria-label', 'Roughly how long');
    LOG_CHOICES.forEach(([m, label]) => {
      const b = el('button', 'bd-logc', esc(label));
      b.type = 'button';
      b.dataset.min = m;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => { mins = m; choose.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); go.disabled = false; post.disabled = false; });
      choose.appendChild(b);
    });
    body.appendChild(choose);
    body.appendChild(el('p', 'bd-foreman', esc(says('clock_out'))));
    const i = el('input', 'field bd-lognote');
    i.maxLength = 280; i.placeholder = 'One line, or skip it';
    i.setAttribute('aria-label', 'What got done, in a line');
    body.appendChild(i);
    const r = el('div', 'bd-row bd-logrow');
    const send = (thenPost) => {
      if (!mins) return;
      if (thenPost && needSignIn('post')) return;
      go.disabled = true; post.disabled = true;
      const note = i.value.trim().slice(0, 280);
      call(() => api().logIt({ minutes: mins, note })).then((x) => {
        if (!x.ok) { go.disabled = false; post.disabled = false; app.toast(x.message); return; }
        close();
        if (site) site.dropMaterial(mins >= 90 ? 'timber' : mins >= 30 ? 'brick' : 'lumber');
        reloadTown();
        if (thenPost) postSheet({ kind: 'progress', line: note, minutes: mins, thing: B.thing });
        else app.toast(hm(mins) + ' in the building');
      });
    };
    const go = button('Keep it', 'ghost', () => send(false));
    const post = button('Post', 'bd-start', () => send(true));
    go.disabled = true; post.disabled = true;
    r.append(go, post);
    body.appendChild(r);
  });
}

/* --------------------------------------------------------------- posting */
/* Made progress, Stuck, Found something or Finished; one line, an optional
   photo, hours only if you want them, and the Brief only with a separate yes. */
function postSheet(o) {
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
    KINDS.forEach(([k, label]) => {
      const b = el('button', 'bd-kindb k-' + k, esc(label));
      b.type = 'button'; b.dataset.kind = k;
      b.addEventListener('click', () => { kind = k; paintKinds(); });
      kinds.appendChild(b);
    });
    body.appendChild(kinds);
    const i = el('input', 'field bd-postline');
    i.maxLength = 280; i.value = o.line || ''; i.placeholder = 'One line';
    i.setAttribute('aria-label', 'Your post, in a line');
    body.appendChild(i);
    /* what would help you take the next step? Four buttons, no typing */
    stuck.appendChild(el('p', 'bd-foreman', esc('What would help?')));
    const needs = el('div', 'bd-needs');
    NEEDS.forEach((k) => {
      const b = el('button', 'bd-needb', esc(word('stuck', k)));
      b.type = 'button'; b.dataset.need = k; b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => { need = need === k ? null : k; needs.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x.dataset.need === need); x.setAttribute('aria-pressed', x.dataset.need === need ? 'true' : 'false'); }); });
      needs.appendChild(b);
    });
    stuck.appendChild(needs);
    body.appendChild(stuck);
    const extras = el('div', 'bd-extras');
    const pick = el('input'); pick.type = 'file'; pick.accept = 'image/*'; pick.hidden = true;
    const pname = el('span', 'bd-pname', '');
    const pbtn = button(ICON.plus + ' Add a photo', 'ghost sm', (e) => { e.preventDefault(); pick.click(); });
    pick.addEventListener('change', () => { file = (pick.files && pick.files[0]) || null; pname.textContent = file ? file.name : ''; });
    const prow = el('div', 'bd-row bd-photo'); prow.append(pbtn, pname, pick);
    extras.appendChild(prow);
    const check = (name, label, on) => { const l = el('label', 'bd-check', '<input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + '><span>' + esc(label) + '</span>'); return l; };
    if (o.minutes > 0) extras.appendChild(check('hours', 'Add ' + hm(o.minutes)));
    extras.appendChild(check('brief', 'The Brief can print this'));
    body.appendChild(extras);
    const go = button('Post', 'bd-start bd-postgo', () => {
      const line = i.value.trim();
      if (!line) { i.focus(); return; }
      go.disabled = true;
      const hours = extras.querySelector('[name=hours]');
      const p = { kind, line: line.slice(0, 280), thing: o.thing && o.thing.id || null,
        hours: hours && hours.checked ? o.minutes : null, brief_ok: !!extras.querySelector('[name=brief]').checked,
        help_need: kind === 'stuck' ? need : null, stuck_reason: kind === 'stuck' && need ? NEED_REASON[need] : null, photo: file };
      call(() => api().post.create(p)).then((r) => {
        go.disabled = false;
        if (!r.ok) { app.toast(r.message); return; }
        close();
        if (site) site.setTown({ windows_lit: (Number(B.town && B.town.posts_lit) || 0) + 1 });
        if (kind === 'stuck' && need) {
          app.toast(word('stuck_reply', need));
          if (need === 'smaller') store.write(STEP_KEY, '');
        } else app.toast(r.data && r.data.photo_waiting ? 'Posted. The photo shows once approved.' : 'Posted');
        reloadTown();
      });
    });
    const r = el('div', 'bd-row bd-postrow'); r.appendChild(go);
    body.appendChild(r);
    paintKinds();
  });
}

/* ------------------------------------------------------- Habits' bridge */
/* A habit tapped done drops a small load of material on the site (not
   hours off your phone). Habits is untouched: this listens to its taps. */
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('#panel-habits .hb-tap');
  if (!b) return;
  /* the tap repaints its row in the same click; read it just after */
  setTimeout(() => {
    const row = b.isConnected ? b : null;
    const on = row ? row.getAttribute('aria-pressed') === 'true' : !!document.querySelector('#panel-habits .hb-tap.pop');
    if (!on) return;
    B.drops.push('nails');
    call(() => api().habitDrop && api().habitDrop());
  }, 0);
}, true);

/* --------------------------------------------------- deep links, the sides */
function land() {
  if (!B.flash || B.phase !== 'ready') return;
  const k = B.flash;
  B.flash = null;
  if (!app.flashHit(B.body, k)) app.toast('That post has moved on');
}

function setSide(side) {
  store.write(SIDE_KEY, side);
  if (side === 'habits') app.go('habits'); else app.go('build');
}
/* Build | Habits, poured like On Air's sides (liquid.js) */
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

/* ------------------------------------------------------------------ the tab */
app.onAuth(() => {
  if (!B.root) return;
  B.api = null;
  load();
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
    load();
    loadWeather();
    recoverShift();
  },
  activate(param) {
    B.side = 'build';
    store.write(SIDE_KEY, 'build');
    if (param && /^p-[\w-]{1,80}$/.test(param)) { B.flash = param; land(); }
    else if (param === 'habits') { app.go('habits'); return; }
    if (B.phase === 'ready') { feedSite(); clearTimeout(talkTimer); talkTimer = setTimeout(siteTalk, 1200); }
    clearInterval(skyTimer);
    skyTimer = setInterval(() => { if (site) site.setSky(sky()); }, 5 * 60000);
  },
  refresh() { if (B.side === 'build') paint(); },
  deactivate() { clearTimeout(talkTimer); clearInterval(skyTimer); },
  subnav() { return wrapRow(sideSwitch('build'), null); },
  /* Habits' own row, under the switch, when Habits is the side on screen */
  frame(child, row) {
    if (child !== 'habits') return row;
    B.side = 'habits';
    store.write(SIDE_KEY, 'habits');
    return wrapRow(sideSwitch('habits'), row);
  },
  /* the bar's Build lands on the side the reader was last on */
  landing() { return store.read(SIDE_KEY, 'build') === 'habits' ? 'habits' : 'build'; },
  keepSubnav: true,
  newSince() { return 0; },
  pull() { return reloadTown().then(() => null); },
});
function wrapRow(top, row) {
  const bar = el('div', 'secbar bd-sub');
  bar.appendChild(top);
  if (row) {
    /* a hosted tab hands back its own .secbar: keep what is inside it */
    const kids = row.classList && row.classList.contains('secbar') ? [...row.children] : [row];
    kids.forEach((k) => bar.appendChild(k));
  }
  return bar;
}

/* for tests */
export const _state = () => ({ side: B.side, phase: B.phase, thing: B.thing, shift: S ? { ...S } : null, open: shiftOpen(), lock: !!lock, drops: B.drops.slice(), back: B.back });
export const _api = () => api();
