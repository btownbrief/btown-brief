/* season.js — Body · Today · Season (wave 1, 2026-10-30): the eight-week
   season from Stephen's build notes (newsletter/reference/drafts/
   new-nine-2026-10/habits-build-notes.md), hosted in the Today cell
   beside the habit tracker. The tracker is what people open every day;
   the season is what they join.

   - The top: before kickoff, the countdown and Join; once it is live and
     you have a goal, the goal tile: the goal, its habit, one big Done (the
     whole reward: it fills, settles, and the streak ticks up), the streak,
     the days to the party, and your pod's streaks.
   - Goal: declare it (the goal, the finish line, what you'll show, the
     category, the goal habit, three milestones), saved as you type, until
     kickoff; then it is locked, and only the milestones tick. After
     kickoff, "I finished" opens your card for the Wall.
   - Review: this week's Said, Did, Next; past weeks read only.
   - Events: kickoff, midway, the party, with a Luma button.
   - Board: every member's first name, goal-habit streak and show-up rate,
     yours marked; nothing else about anyone. Your pod under it.
   - Wall: the finishers' published cards, public.

   Data: the sz_ doors in supabase/sz-SEASON.sql (on top of sz-SETUP.sql);
   before Stephen pastes it, the doors answer "off" and the top falls back
   to sz_season_next, which is already live. ?demo=1 answers from an
   invented season in memory (Season 1, week three). Streaks are
   habits-core.js streak(); the show-up rate is showUp() below. */

import * as app from '../app.js';
import * as store from '../store.js';
import { el, esc, ICON, button, pills } from '../ui.js';
import { HABIT_RULES, dayKey, addDays, streak, streakUnit, daysUntil } from '../habits-core.js';
import { DEMO_ME } from '../boards-fake.js';
import { page, row, para, links, ext, section, field, input, select, stat, shortDay, plural, pill } from './body-kit.js';

const KEY = 'season';
const CITY = 'burlington';
const CATS = [['fitness', 'Fitness'], ['creative', 'Creative'], ['business', 'Work'], ['life_admin', 'Life admin'], ['learn', 'Learning']];
const FREQ = [['daily', 'Daily'], ['weekdays', 'Weekdays'], ['n_per_week', 'N a week']];
const EVENT_WORD = { kickoff: 'Kickoff', midway: 'Midway', party: 'The party' };
const ERR = {
  locked: 'Your goal is locked now.', no_member: 'Add your name first.', no_season: 'No season to join yet.', not_found: 'That’s gone.',
  no_review_week: 'Reviews open at kickoff.', not_finished: 'Finish your goal first.', not_started: 'The season hasn’t started.',
  not_signed_in: 'Sign in first.', off: 'The season isn’t open yet.', offline: 'You’re offline. Try again.',
};
const msg = (code) => ERR[code] || ERR.offline;
const WHEN = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });

/* ----------------------------------------------------------------- rules */
/* Show-up rate (the build notes): reviews sent plus events attended, over
   the weeks gone since kickoff (eight at most) plus the events held.
   Null before there is anything to show up for: blank, never 0%. */
export function showUp({ reviews, attended, weeksGone, eventsHeld }) {
  const of = Math.min(8, Math.max(0, weeksGone || 0)) + Math.max(0, eventsHeld || 0);
  if (!of) return null;
  return Math.min(100, Math.round(100 * ((reviews || 0) + (attended || 0)) / of));
}
/* The board: streak first (a week of an N-a-week habit counts as seven
   days), then show-up, then name */
const days = (r) => r.streak * (r.frequency === 'n_per_week' ? 7 : 1);
export function boardRows(board, nowMs) {
  const weeksGone = Math.max(0, (board.week || 0) - 1);
  return (board.rows || []).map((r) => ({
    ...r,
    streak: r.frequency ? streak({ frequency: r.frequency, n: r.n }, new Set(r.taps || []), nowMs) : 0,
    show: showUp({ reviews: r.reviews, attended: r.attended, weeksGone, eventsHeld: board.events_held }),
  })).sort((a, b) => days(b) - days(a) || (b.show ?? -1) - (a.show ?? -1) || String(a.name).localeCompare(String(b.name)));
}
/* a goal with no number, date or thing to show gets a soft nudge */
const MONTHS = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
export const vague = (t) => !!String(t || '').trim() && !/\d/.test(t) && !MONTHS.test(t) && String(t).trim().split(/\s+/).length < 4;

/* ------------------------------------------------------------- the server */
const fail = (code) => ({ ok: false, error: code, message: msg(code) });
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
function call(fn, args) {
  if (app.demo) return Promise.resolve().then(() => ({ ok: true, data: fake().call(fn, args || {}) })).catch((e) => fail(e.code || 'offline'));
  const signedIn = !!app.user();
  return Promise.resolve(signedIn ? app.token() : null).then((tok) => fetch(store.SB_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: Object.assign({ apikey: store.SB_KEY, 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}),
    body: JSON.stringify(args || {}),
  })).then((r) => r.text().then((t) => {
    let j = null;
    try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
    if (r.ok) return { ok: true, data: j };
    if (r.status === 404 && j && j.code === 'PGRST202') return fail('off');
    return fail(j && typeof j.message === 'string' && /^[a-z_]+$/.test(j.message) ? j.message : 'offline');
  }), () => fail('offline'));
}

/* ------------------------------------------------------------ the demo */
/* An invented season in memory: Season 1 in its third week, twelve
   members, a pod of four, three cards on the Wall. Nothing is saved. */
let demoDb = null;
function fake() {
  if (demoDb) return demoDb;
  const now = Date.now(), D = 86400000, today = dayKey(now);
  /* events at an evening hour, 6 pm in Burlington give or take daylight saving */
  const at = (n) => { const d = new Date(now + n * D); d.setUTCHours(22, 0, 0, 0); return d.toISOString(); };
  const kickoff = at(-17);
  const err = (code) => { const e = new Error(code); e.code = code; throw e; };
  const NAMES = ['Ana', 'Ben', 'Caro', 'Dev', 'Eli', 'Fran', 'Gus', 'Hana', 'Ivo', 'Jess', 'Kai', 'Lou'];
  const FREQS = [['daily'], ['weekdays'], ['n_per_week', 3], ['daily'], ['n_per_week', 5], ['daily'], ['weekdays'], ['n_per_week', 4], ['daily'], ['n_per_week', 2], ['daily'], ['weekdays']];
  const members = NAMES.map((name, i) => {
    const [frequency, n] = FREQS[i];
    const miss = (d) => (d * 7 + i * 3) % (5 + (i % 4)) === 0;
    const taps = [];
    for (let d = 17; d >= 1; d--) if (!miss(d)) taps.push(addDays(today, -d));
    return { name, frequency, n: n || null, taps, reviews: Math.min(2, (i % 3) + 1), attended: i % 4 === 0 ? 0 : 1, pod: i < 3 };
  });
  const db = {
    season: { id: 'demo-s1', name: 'Season 1', city: CITY, status: 'live', kickoff_at: kickoff, midway_at: at(11),
      party_at: at(39), stripe_link: null,
      events: [
        { id: 'e1', type: 'kickoff', starts_at: kickoff, venue: 'Foam Brewers', luma_url: 'https://lu.ma/' },
        { id: 'e2', type: 'midway', starts_at: at(11), venue: 'Oakledge Park', luma_url: 'https://lu.ma/' },
        { id: 'e3', type: 'party', starts_at: at(39), venue: 'ArtsRiot', luma_url: 'https://lu.ma/' },
      ] },
    me: { name: 'Sam', phone: '8025550100' },
    goal: { id: 'demo-g', text: 'Run the Shelburne 10K under an hour', finish_line: 'A race time under 60:00', proof: 'My race bib and time', category: 'fitness',
      paid: true, finished_at: null, card: null,
      habit: { id: 'demo-gh', text: 'Run 30 minutes', frequency: 'n_per_week', n: 3, is_goal: true },
      milestones: [{ position: 1, text: 'Run 5K without stopping', hit_at: new Date(now - 6 * D).toISOString() }, { position: 2, text: 'Run 8K', hit_at: null }, { position: 3, text: 'Sign up for the race', hit_at: null }],
      reviews: [{ week: 1, said: 'Three runs', did: 'Two runs, one walk', next: 'Run before work' }, { week: 2, said: 'Three runs', did: 'Three runs', next: 'Add a long one' }] },
    myTaps: [addDays(today, -15), addDays(today, -13), addDays(today, -11), addDays(today, -8), addDays(today, -6), addDays(today, -4), addDays(today, -1)],
    members,
    wall: [
      { id: 'w1', name: 'Mara', goal: 'Finish the first draft of my novel', line1: '500 words before work', line2: '41 mornings out of 56', line3: '82,000 words', season: 'Season 0', published_at: new Date(now - 30 * D).toISOString() },
      { id: 'w2', name: 'Theo', goal: 'Swim a mile in the lake', line1: 'Three swims a week', line2: 'Started at 200 yards', line3: 'A mile at Oakledge in August', season: 'Season 0', published_at: new Date(now - 31 * D).toISOString() },
      { id: 'w3', name: 'Priya', goal: 'Launch my pottery shop', line1: 'One hour at the wheel a day', line2: '60 pieces', line3: 'Sold out the first weekend', season: 'Season 0', published_at: new Date(now - 33 * D).toISOString() },
    ],
  };
  const week = () => Math.min(9, Math.floor((Date.now() - Date.parse(db.season.kickoff_at)) / (7 * D)) + 1);
  const goal = () => ({ ...db.goal, locked: Date.parse(db.season.kickoff_at) <= Date.now() });
  const signedIn = () => { const u = app.user(); if (!u) err('not_signed_in'); return u; };
  demoDb = {
    db,
    call(fn, a) {
      switch (fn) {
        case 'sz_season_get': return { ...db.season, week: week(), joined: db.members.length + 1 };
        case 'sz_season_next': return null;
        case 'sz_me_get': signedIn(); return db.me;
        case 'sz_me_set': signedIn(); db.me = { name: a.p_name, phone: a.p_phone }; return db.me;
        case 'sz_goal_get': signedIn(); return goal();
        case 'sz_milestone_hit': { signedIn(); const m = db.goal.milestones.find((x) => x.position === a.p_position); if (!m) err('not_found'); m.hit_at = a.p_hit ? new Date().toISOString() : null; return goal(); }
        case 'sz_review_set': {
          signedIn();
          const w = week();
          db.goal.reviews = db.goal.reviews.filter((r) => r.week !== w).concat([{ week: w, said: a.p_said, did: a.p_did, next: a.p_next }]).sort((x, y) => x.week - y.week);
          return goal();
        }
        case 'sz_goal_set': {
          signedIn();
          if (Date.parse(db.season.kickoff_at) <= Date.now()) err('locked');
          const ht = String(a.p_habit_text || '').trim();
          Object.assign(db.goal, { text: a.p_text, finish_line: a.p_finish_line, proof: a.p_proof, category: a.p_category,
            habit: ht ? { id: 'demo-gh', text: ht, frequency: a.p_habit_frequency, n: a.p_habit_n, is_goal: true } : db.goal.habit,
            milestones: [0, 1, 2].map((i) => ({ position: i + 1, text: (a.p_milestones || [])[i] || '', hit_at: null })) });
          return goal();
        }
        case 'sz_goal_finish': signedIn(); db.goal.finished_at = a.p_done ? new Date().toISOString() : null; return goal();
        case 'sz_wall_card_set': {
          signedIn();
          if (!db.goal.finished_at) err('not_finished');
          const was = db.goal.card;
          db.goal.card = { id: 'w-me', line1: a.p_line1, line2: a.p_line2, line3: a.p_line3, published_at: a.p_publish ? (was && was.published_at) || new Date().toISOString() : null };
          db.wall = db.wall.filter((c) => c.id !== 'w-me');
          if (a.p_publish) db.wall.unshift({ id: 'w-me', name: db.me.name, goal: db.goal.text, line1: a.p_line1, line2: a.p_line2, line3: a.p_line3, season: db.season.name, published_at: db.goal.card.published_at });
          return goal();
        }
        case 'sz_board': {
          signedIn();
          const rows = db.members.map((m) => ({ name: m.name, me: false, pod: m.pod, frequency: m.frequency, n: m.n, taps: m.taps, reviews: m.reviews, attended: m.attended }));
          rows.push({ name: db.me.name, me: true, pod: false, frequency: db.goal.habit.frequency, n: db.goal.habit.n, taps: db.myTaps.slice(), reviews: db.goal.reviews.length, attended: 1 });
          return { season: db.season.id, week: week(), events_held: db.season.events.filter((e) => Date.parse(e.starts_at) <= Date.now()).length, rows,
            pod: { category: 'fitness', meets_on: 'Sundays, 9 am, Oakledge', chat_url: 'https://chat.whatsapp.com/', names: NAMES.slice(0, 3) } };
        }
        case 'sz_wall_list': return db.wall.slice();
        case 'sz_tap': signedIn(); if (!db.myTaps.includes(a.p_date)) db.myTaps.push(a.p_date); return { tapped: true };
        case 'sz_untap': signedIn(); db.myTaps = db.myTaps.filter((d) => d !== a.p_date); return { tapped: false };
        default: return err('off');
      }
    },
  };
  return demoDb;
}

/* --------------------------------------------------------------- loading */
async function loadAll() {
  const signedIn = !!app.user();
  const [s, w] = await Promise.all([call('sz_season_get', { p_city: CITY }), call('sz_wall_list', { p_limit: 60 })]);
  const ctx = { off: !s.ok && s.error === 'off', season: s.ok && isObj(s.data) && s.data.kickoff_at ? s.data : null, wall: w.ok && Array.isArray(w.data) ? w.data.filter((x) => isObj(x) && x.id) : [], me: null, goal: null, board: null, myTaps: new Set() };
  /* before sz-SEASON.sql is pasted: the season the tracker already knows */
  if (ctx.off) { const n = await call('sz_season_next', { p_city: CITY }); ctx.season = n.ok && isObj(n.data) && n.data.kickoff_at ? n.data : null; }
  if (signedIn && !ctx.off && ctx.season) {
    const [me, g, b] = await Promise.all([call('sz_me_get'), call('sz_goal_get', { p_city: CITY }), call('sz_board', { p_city: CITY })]);
    ctx.me = me.ok && isObj(me.data) ? me.data : null;
    ctx.goal = g.ok && isObj(g.data) ? g.data : null;
    ctx.board = b.ok && isObj(b.data) ? b.data : null;
    const mine = ctx.board && (ctx.board.rows || []).find((r) => r.me);
    ctx.myTaps = new Set(mine ? mine.taps : []);
  }
  return ctx;
}
const live = (c) => !!(c.season && Date.parse(c.season.kickoff_at) <= Date.now() && c.season.status !== 'done');
const weekOf = (c) => (c.season && c.season.week) || 0;

/* ------------------------------------------------------------------ top */
function drawTop(box, c) {
  const s = c.season;
  if (!s) {
    /* no season yet: what one is, and nothing to press */
    const t = el('section', 'hb-tile');
    t.dataset.k = 'season-none';
    t.innerHTML = '<p class="hb-kicker">' + esc('No season scheduled yet') + '</p><h2 class="hb-big">' + esc('Eight weeks, one goal, and a party at the end.') + '</h2>';
    box.appendChild(t);
    return;
  }
  if (live(c) && c.goal && c.goal.habit) { goalTile(box, c); return; }
  const t = el('section', 'hb-tile');
  t.dataset.k = 'season-top';
  const kick = Date.parse(s.kickoff_at);
  if (live(c)) {
    const party = s.party_at ? daysUntil(Date.parse(s.party_at), Date.now()) : null;
    t.innerHTML = '<p class="hb-kicker">' + esc(s.name + ' · week ' + Math.min(8, weekOf(c))) + '</p>' +
      '<h2 class="hb-big">' + esc(party != null ? (party <= 0 ? 'The party is today' : 'Party in ' + plural(party, 'day', 'days')) : s.name + ' is on') + '</h2>';
  } else {
    const n = Math.max(0, daysUntil(kick, Date.now()));
    t.innerHTML = '<p class="hb-kicker">' + esc(s.name + ' · ' + DAY.format(new Date(kick))) + '</p>' +
      '<h2 class="hb-big">' + esc(n === 0 ? 'Starts today' : 'Starts in ' + plural(n, 'day', 'days')) + '</h2>';
    t.appendChild(joinButton(c));
  }
  box.appendChild(t);
}
function joinButton(c) {
  if (!app.user()) return button('Sign in to join', 'hb-go', () => app.openSettings());
  if (c.off) return button('Join', 'hb-go', () => app.toast('Sign-up opens soon.'));
  if (c.goal) return button('Your goal', 'hb-go', () => app.go(KEY, 'goal'));
  return button('Join ' + c.season.name, 'hb-go', () => join(c));
}
function join(c) {
  if (!c.me) { app.go(KEY, 'goal'); return; }
  call('sz_goal_set', blankGoal()).then((r) => {
    if (!r.ok) { app.toast(r.message); return; }
    c.reload().then(() => app.go(KEY, 'goal'));
  });
}
const blankGoal = () => ({ p_text: '', p_finish_line: '', p_proof: '', p_category: null, p_habit_text: '', p_habit_frequency: 'daily', p_habit_n: null, p_milestones: [], p_city: CITY });

/* The goal tile: the goal, its habit, the Done button, the streak, the
   days to the party, the pod's streaks */
function goalTile(box, c) {
  const g = c.goal, h = g.habit, s = c.season;
  const today = dayKey(Date.now());
  const t = el('section', 'hb-tile');
  t.dataset.k = 'goal-tile';
  const n = () => streak(h, c.myTaps, Date.now());
  const party = s.party_at ? Math.max(0, daysUntil(Date.parse(s.party_at), Date.now())) : null;
  t.innerHTML = '<p class="hb-kicker">' + esc(s.name + (party != null ? ' · party in ' + plural(party, 'day', 'days') : '')) + '</p>' +
    '<h2 class="hb-big">' + esc(g.text || 'Your goal') + '</h2><p class="hb-kicker">' + esc(h.text) + '</p>';
  const done = el('button', 'btn ghost sz-done');
  done.type = 'button';
  done.style.width = '100%';
  done.style.minHeight = '64px';   // the biggest thing on the screen (the build notes)
  done.style.marginTop = 'var(--s2)';
  const paint = () => {
    const on = c.myTaps.has(today);
    done.innerHTML = (on ? ICON.check + ' Done today' : 'Done');
    done.setAttribute('aria-pressed', String(on));
    /* outlined until today is done, then filled in the accent */
    done.className = on ? 'btn hb-go sz-done' : 'btn ghost sz-done';
    const k = n();
    num.textContent = k ? k + ' ' + streakUnit(h, k) : 'No streak yet';
  };
  const num = el('p', 'hb-kicker sz-streak');
  num.setAttribute('aria-live', 'polite');
  done.addEventListener('click', () => {
    const on = c.myTaps.has(today);
    const go = () => {
      if (on) c.myTaps.delete(today); else c.myTaps.add(today);
      paint();
      if (!on) {
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches && done.animate) done.animate([{ transform: 'scale(1)' }, { transform: 'scale(.97)' }, { transform: 'scale(1)' }], { duration: 150 });
        if (navigator.vibrate) try { navigator.vibrate(10); } catch (e) { /* no buzz */ }
      }
      call(on ? 'sz_untap' : 'sz_tap', { p_habit: h.id, p_date: today }).then((r) => {
        if (r.ok) return;
        if (on) c.myTaps.add(today); else c.myTaps.delete(today);
        paint();
        app.toast(r.message);
      });
    };
    if (on) app.confirmBox({ title: 'Undo today?', body: h.text, yes: 'Undo', onYes: go }); else go();
  });
  t.append(done, num);
  /* the pod's goal-habit streaks, a name and a number each */
  const pod = c.board ? boardRows(c.board, Date.now()).filter((r) => r.pod) : [];
  if (pod.length) t.appendChild(el('p', 'hb-kicker sz-pod', esc(pod.map((r) => r.name + ' ' + r.streak).join(' · '))));
  paint();
  box.appendChild(t);
}

/* ----------------------------------------------------------------- goal */
function drawGoal(box, c) {
  section(box, 'Your goal', null);
  if (!app.user()) { links(box, [button('Sign in', '', () => app.openSettings())]); return; }
  if (!c.me) { box.appendChild(meForm(c)); return; }
  const g = c.goal;
  if (!g) { links(box, [joinButton(c)]); return; }
  if (!g.locked) { box.appendChild(goalForm(c)); return; }
  /* locked: read only, milestones tick */
  box.appendChild(row({ k: 'g-text', tile: { icon: ICON.trophy }, title: g.text || 'No goal written', lines: [['Done when', g.finish_line], ['At the party', g.proof]] }));
  if (g.habit) box.appendChild(row({ k: 'g-habit', tile: { icon: ICON.check }, title: g.habit.text,
    lines: [g.habit.frequency === 'n_per_week' ? g.habit.n + ' a week' : g.habit.frequency === 'weekdays' ? 'Weekdays' : 'Daily'] }));
  (g.milestones || []).filter((m) => m.text).forEach((m) => {
    const hit = !!m.hit_at;
    const tick = pill(hit ? ICON.check + '<span>Hit</span>' : '<span>Hit it</span>', () => {
      call('sz_milestone_hit', { p_position: m.position, p_hit: !hit, p_city: CITY }).then((r) => { if (!r.ok) app.toast(r.message); else { c.goal = r.data; c.redraw('goal'); } });
    });
    tick.setAttribute('aria-pressed', String(hit));
    const r = row({ k: 'm-' + m.position, tile: { big: m.position, small: 'step' }, title: m.text, lines: [hit ? 'Hit ' + shortDay(dayKey(Date.parse(m.hit_at))) : ''], right: tick, done: hit });
    r.dataset.milestone = String(m.position);
    box.appendChild(r);
  });
  if (live(c) || weekOf(c) > 8) box.appendChild(finishBlock(c));
}
function meForm(c) {
  const f = el('form', 'bform hb-gate sz-me');
  f.noValidate = true;
  const name = input('name', { placeholder: 'First name', max: HABIT_RULES.limits.nameMax });
  name.autocomplete = 'given-name';
  const phone = input('phone', { type: 'tel', placeholder: '802 555 0100', max: HABIT_RULES.limits.phoneMax });
  phone.autocomplete = 'tel';
  const m = el('p', 'bf-msg err');
  const go = button('Next', '');
  go.type = 'submit';
  const act = el('div', 'bf-go');
  act.append(go, m);
  f.append(field('Your first name', name), field('Your phone', phone, 'For your pod’s group chat.'), act);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    call('sz_me_set', { p_name: name.value.trim(), p_phone: phone.value.trim() }).then((r) => { if (!r.ok) { m.textContent = r.message; return; } c.reload(); });
  });
  return f;
}
/* the declare form: every change saves (debounced), until kickoff */
function goalForm(c) {
  const g = c.goal;
  const f = el('form', 'bform hb-gate sz-goal');
  f.noValidate = true;
  const text = input('text', { placeholder: 'Finish the screenplay', value: g.text, max: 120 });
  const nudge = el('p', 'bf-hint');
  const finish = input('finish_line', { placeholder: 'A full draft someone else can read', value: g.finish_line, max: 160 });
  const proof = input('proof', { placeholder: 'Read the first scene out loud', value: g.proof, max: 160 });
  const cat = select('category', [['', 'Pick one']].concat(CATS), g.category || '');
  const h = g.habit || { text: '', frequency: 'daily', n: null };
  const ht = input('habit', { placeholder: 'Write 300 words', value: h.text, max: HABIT_RULES.limits.habitTextMax });
  const hf = select('frequency', FREQ, h.frequency);
  const hn = select('n', [1, 2, 3, 4, 5, 6].map((n) => [n, n + ' a week']), h.n || 3);
  hn.hidden = h.frequency !== 'n_per_week';
  const ms = [0, 1, 2].map((i) => input('m' + i, { placeholder: ['Act one', 'Act two', 'Act three'][i], value: ((g.milestones || [])[i] || {}).text || '', max: 80 }));
  const saved = el('p', 'bf-msg');
  saved.setAttribute('role', 'status');
  const habitRow = field('The habit behind it', ht);
  habitRow.append(hf, hn);
  const mRow = el('div', 'bf-row');
  mRow.appendChild(el('p', 'bf-label', 'Three milestones'));
  ms.forEach((m) => mRow.appendChild(m));
  const lock = c.season ? el('p', 'bf-hint', esc('Locks ' + DAY.format(new Date(c.season.kickoff_at)) + '.')) : null;
  const goalRow = field('Your goal', text);
  goalRow.appendChild(nudge);
  f.append(goalRow, field('How will someone else know it’s done?', finish), field('What you’ll show at the party', proof), field('Kind', cat), habitRow, mRow);
  if (lock) f.appendChild(lock);
  f.appendChild(saved);
  if (c.season && /^https:\/\//.test(c.season.stripe_link || '') && !g.paid) f.appendChild(ext('Pay to hold your spot', c.season.stripe_link, 'btn'));
  let timer = 0;
  const paintNudge = () => { nudge.textContent = vague(text.value) ? 'A number or a date makes it easier to finish.' : ''; };
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      hn.hidden = hf.value !== 'n_per_week';
      call('sz_goal_set', { p_text: text.value, p_finish_line: finish.value, p_proof: proof.value, p_category: cat.value || null,
        p_habit_text: ht.value, p_habit_frequency: hf.value, p_habit_n: hf.value === 'n_per_week' ? Number(hn.value) : null,
        p_milestones: ms.map((m) => m.value), p_city: CITY }).then((r) => {
        saved.classList.toggle('err', !r.ok);
        saved.textContent = r.ok ? 'Saved' : r.message;
        if (r.ok) c.goal = r.data;
      });
    }, 600);
  };
  f.addEventListener('input', () => { paintNudge(); saved.textContent = ''; save(); });
  f.addEventListener('change', save);
  f.addEventListener('submit', (e) => e.preventDefault());
  paintNudge();
  return f;
}
/* After kickoff: "I finished", then the card for the Wall */
function finishBlock(c) {
  const g = c.goal;
  const w = el('div', 'hb-gate sz-finish');
  if (!g.finished_at) {
    w.appendChild(button('I finished', 'ghost', () => call('sz_goal_finish', { p_done: true, p_city: CITY }).then((r) => {
      if (!r.ok) { app.toast(r.message); return; }
      c.goal = r.data; c.redraw('goal');
    })));
    return w;
  }
  const card = g.card || {};
  const f = el('form', 'bform sz-card');
  f.noValidate = true;
  const l = [1, 2, 3].map((i) => input('line' + i, { value: card['line' + i] || '', placeholder: ['300 words before work', '41 mornings out of 56', 'A full draft'][i - 1], max: 80 }));
  f.appendChild(el('p', 'bf-label', card.published_at ? 'Your card is on the Wall' : 'Your card for the Wall'));
  l.forEach((x) => f.appendChild(x));
  const go = button(card.published_at ? 'Update' : 'Publish', '');
  go.type = 'submit';
  const m = el('p', 'bf-msg');
  const act = el('div', 'bf-go');
  act.append(go, m);
  if (card.published_at) act.appendChild(button('Take it down', 'ghost', (e) => { e.preventDefault(); sendCard(false); }));
  f.appendChild(act);
  const sendCard = (pub) => call('sz_wall_card_set', { p_line1: l[0].value, p_line2: l[1].value, p_line3: l[2].value, p_publish: pub, p_city: CITY }).then((r) => {
    if (!r.ok) { m.textContent = r.message; m.classList.add('err'); return; }
    c.reload();
  });
  f.addEventListener('submit', (e) => { e.preventDefault(); sendCard(true); });
  w.appendChild(f);
  return w;
}

/* --------------------------------------------------------------- review */
function drawReview(box, c) {
  const wk = Math.min(8, weekOf(c));
  section(box, 'Week ' + wk + ' review', null);
  const mine = ((c.goal && c.goal.reviews) || []).find((r) => r.week === wk) || {};
  const f = el('form', 'bform hb-gate sz-review');
  f.noValidate = true;
  const said = input('said', { value: mine.said, placeholder: 'Three runs', max: 280 });
  const did = input('did', { value: mine.did, placeholder: 'Two runs and a walk', max: 280 });
  const next = input('next', { value: mine.next, placeholder: 'Run before work', max: 280 });
  const m = el('p', 'bf-msg');
  m.setAttribute('role', 'status');
  const go = button(mine.week ? 'Update' : 'Send', '');
  go.type = 'submit';
  const act = el('div', 'bf-go');
  act.append(go, m);
  f.append(field('Said', said), field('Did', did), field('Next', next), act);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    call('sz_review_set', { p_said: said.value, p_did: did.value, p_next: next.value, p_city: CITY }).then((r) => {
      m.classList.toggle('err', !r.ok);
      m.textContent = r.ok ? 'Sent' : r.message;
      if (r.ok) { c.goal = r.data; go.textContent = 'Update'; }
    });
  });
  box.appendChild(f);
  ((c.goal && c.goal.reviews) || []).filter((r) => r.week !== wk).sort((a, b) => b.week - a.week).forEach((r) => {
    box.appendChild(row({ k: 'rv-' + r.week, tile: { big: r.week, small: 'week' }, title: r.did || r.said, lines: [['Said', r.said], ['Next', r.next]] }));
  });
}

/* --------------------------------------------------------------- events */
function drawEvents(box, c) {
  section(box, 'Events', null);
  (c.season.events || []).forEach((e) => {
    const at = Date.parse(e.starts_at);
    const [mo, d] = DAY.format(new Date(at)).split(' ');
    const r = row({ k: 'ev-' + e.type, tile: { big: d, small: mo }, title: EVENT_WORD[e.type] || e.type,
      lines: [WHEN.format(new Date(at)), e.venue], right: /^https:\/\//.test(e.luma_url || '') ? ext('Luma', e.luma_url) : null, done: at < Date.now() - 6 * 3600000 });
    r.dataset.event = e.type;
    box.appendChild(r);
  });
}

/* ---------------------------------------------------------------- board */
function drawBoard(box, c) {
  const rows = boardRows(c.board, Date.now());
  section(box, 'City board', esc(plural(rows.length, 'member', 'members')));
  rows.forEach((r, i) => {
    const line = (r.streak ? r.streak + ' ' + streakUnit({ frequency: r.frequency }, r.streak) : 'No streak') + (r.show != null ? ' · ' + r.show + '% show-up' : '');
    const n = row({ k: 'b-' + i, tile: { big: i + 1, small: '' }, title: r.me ? r.name + ' (you)' : r.name, lines: [line] });
    if (r.me) n.classList.add('spun');
    n.dataset.board = r.me ? 'me' : 'member';
    box.appendChild(n);
  });
  const p = c.board.pod;
  if (p) {
    const chat = /^https:\/\//.test(p.chat_url || '') ? ext('Pod chat', p.chat_url) : null;
    const pr = row({ k: 'pod', tile: { icon: ICON.people }, title: 'Your pod', lines: [(p.names || []).join(', '), p.meets_on], right: chat });
    pr.dataset.pod = '1';
    box.appendChild(pr);
  }
}

/* ----------------------------------------------------------------- wall */
function drawWall(box, c) {
  section(box, 'Wall', null);
  c.wall.forEach((w) => {
    const share = el('button', 'act sh', ICON.share);
    share.type = 'button';
    share.setAttribute('aria-label', 'Share ' + w.name + '’s card');
    share.addEventListener('click', () => app.share(KEY, 'w-' + w.id, w.name + ': ' + w.goal));
    const r = row({ k: 'w-' + w.id, tile: { icon: ICON.trophy }, title: w.goal, lines: [w.line1, w.line2, w.line3, [w.name, '· ' + w.season]], right: share });
    r.dataset.wall = w.id;
    box.appendChild(r);
  });
}

/* -------------------------------------------------------------- the tab */
let ctxRef = null;
app.onAuth(() => { if (ctxRef && ctxRef.reload) ctxRef.reload(); });

app.register(KEY, page({
  key: KEY, label: 'Season', icon: 'trophy', color: '--liq-habits',
  promise: 'Eight weeks, one goal, and a party at the end.',
  sections: [['top', 'Now'], ['goal', 'Goal'], ['review', 'Review'], ['events', 'Events'], ['board', 'Board'], ['wall', 'Wall']],
  shown(k, c) {
    if (k === 'goal') return !!c.season && !c.off;
    if (k === 'review') return !!(c.goal && c.goal.locked && weekOf(c) >= 1 && weekOf(c) <= 8);
    if (k === 'events') return !!(c.season && (c.season.events || []).length);
    if (k === 'board') return !!(c.board && (c.board.rows || []).length && live(c));
    if (k === 'wall') return c.wall.length > 0;
    return true;
  },
  load: () => loadAll().then((c) => (ctxRef = c)),
  draw(k, box, c) {
    if (k === 'top') drawTop(box, c);
    else if (k === 'goal') drawGoal(box, c);
    else if (k === 'review') drawReview(box, c);
    else if (k === 'events') drawEvents(box, c);
    else if (k === 'board') drawBoard(box, c);
    else if (k === 'wall') drawWall(box, c);
  },
}));

/* for tests */
export const _fake = () => (app.demo ? fake() : null);
