/* Habits: the accountability club's tracker. A member signs up for an
   eight-week season, declares one goal and the habit behind it, and keeps a
   few habits of their own underneath. Stephen's build notes are the product
   (newsletter repo, reference/drafts/new-nine-2026-10/habits-build-notes.md);
   the brief beside them (briefs/habits-tab.md) moves it onto All Day.

   Phase one is the habit tracker on its own, and it should feel finished:

   - Today. The goal tile on top: with no goal live it says when the next
     season starts, with a sign-up button, or that none is scheduled. Below
     it, your own habits, as many as you keep, each a row with its name, its
     streak, this week as seven dots and a 48px tap target. Tap to mark
     today done, tap again to un-mark. Swipe a row left to archive it (the
     toast has Undo); drag it by its grip to reorder (held near the top or
     bottom of the screen, the list scrolls with it); tap its name to edit
     it. An Add habit row at the bottom: a name, how often (daily,
     weekdays, N times a week) and sharing with your pod, off unless you
     turn it on.
   - Goal, Season and Wall are chips that say Season 0 is coming.

   Signed out, it just works: the same Today, every habit and tap kept on
   this phone (habits-local.js, the same doors and rules as the server),
   and one quiet "Sync across devices" line under the list. Signing in only
   adds things: the phone's habits and their taps move to the account once
   (sz_import_local, sz-ROUND3.sql), the phone forgets them, and the account
   is the one copy from then on. Signing out leaves them on the account and
   shows this phone's own list again, empty. No name or phone is asked for
   the tracker; they are asked when a reader joins a season (Sign up).

   A tap is optimistic: the row repaints in the click itself, well under
   100 ms, and the call goes behind it. A tap not yet confirmed is written
   to this phone first (allday-habits-pending), so a refresh, a dead signal
   or a closed tab never loses it; it is sent again on the next visit, when
   the phone comes back online, or with the next tap. The day turns at
   midnight New York (habits-core.js), on a timer, and again whenever the
   app comes back to the front.

   Data: the sz_ functions in supabase/sz-SETUP.sql, through call() below,
   which talks to Supabase the way boards.js does; in ?demo=1 an in-memory
   copy of the server (habits-fake.js) answers instead. Signed out, the
   phone answers the tracker's doors itself (habits-local.js; in the demo,
   in memory only). Rules and streaks:
   habits-core.js. Habit rows are not feed cards, so their swipe and drag
   are this tab's own (the shell's swipe means save and mute). */

import * as app from '../app.js';
import * as store from '../store.js';
import * as boards from '../boards.js';
import { el, esc, ICON, button, chips } from '../ui.js';
import { HABIT_RULES, dayKey, addDays, streak, streakUnit, weekDots, daysUntil, nextMidnight, checkHabit, checkMe, clean, message } from '../habits-core.js';
import { FakeHabits, seedDemo } from '../habits-fake.js';
import { LocalHabits, LOCAL_DOORS, browserStorage, memoryStorage } from '../habits-local.js';
import { DEMO_ME } from '../boards-fake.js';

const KEY = 'habits';
const VIEWS = [['today', 'Today'], ['goal', 'Goal'], ['season', 'Season'], ['wall', 'Wall']];
const PENDING = 'allday-habits-pending';
const HISTORY_DAYS = HABIT_RULES.limits.tapsRangeMaxDays - 1;
const SWIPE_START = 24, SWIPE_COMMIT = 72, SWIPE_CANCEL_Y = 14;
const DRAG_EDGE = 56, DRAG_SPEED = 18;   // the band where a drag scrolls the list, and its top speed in px a frame
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FREQ_WORD = { daily: 'Daily', weekdays: 'Weekdays' };
const freqWord = (h) => (h.frequency === 'n_per_week' ? h.n + ' a week' : FREQ_WORD[h.frequency] || '');

/* ------------------------------------------------------------- the server */
let fake = null;
function demoBackend() {
  if (!fake) fake = seedDemo(new FakeHabits(), DEMO_ME);   // the demo reader auth.js signs in
  return fake;
}

/* this phone's habits, for a reader who has not signed in */
let localDb = null;
function local() {
  if (!localDb) localDb = new LocalHabits({ storage: app.demo ? memoryStorage() : browserStorage() });
  return localDb;
}

const fail = (error) => ({ ok: false, error, message: message(error) });
/* One call to an sz_ function. Signed out, the tracker's doors are this
   phone's own. Live, a POST to PostgREST with the reader's token when
   signed in; a refusal arrives as {"message":"<our code>"}. A function that
   does not exist yet (sz-SETUP.sql not pasted) is 404 PGRST202: 'off'.
   Never rejects. */
function call(fn, args) {
  if (!S.uid && LOCAL_DOORS.has(fn)) {
    return Promise.resolve().then(() => ({ ok: true, data: local().call(fn, args || {}) })).catch((e) => fail(e.code || 'offline'));
  }
  return serverCall(fn, args);
}
function serverCall(fn, args) {
  if (app.demo) {
    const u = app.user();
    return Promise.resolve().then(() => ({ ok: true, data: demoBackend().as(u ? u.id : null).call(fn, args || {}) }))
      .catch((e) => fail(e.code || 'offline'));
  }
  const signedIn = !!app.user();
  return Promise.resolve(signedIn ? app.token() : null).then((tok) => {
    if (signedIn && !tok) throw new Error('no token');
    return fetch(store.SB_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: Object.assign({ apikey: store.SB_KEY, 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}),
      body: JSON.stringify(args || {}),
    });
  }).then((r) => r.text().then((t) => {
    let j = null;
    try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
    if (r.ok) return { ok: true, data: j };
    if (r.status === 404 && j && j.code === 'PGRST202') return fail('off');
    if (r.status === 401) return fail('not_signed_in');
    return fail(j && typeof j.message === 'string' && /^[a-z_]+$/.test(j.message) ? j.message : 'offline');
  }), () => fail('offline'));
}

/* ------------------------------------------------------------------ state */
const S = {
  view: 'today',
  phase: 'loading',     // 'loading' | 'ready'
  uid: null,            // whose habits these are
  season: undefined,    // the next season, null for none, undefined while asking
  me: undefined,        // the member row (name and phone), null before joining a season
  habits: [],           // yours, not archived, goal habit first
  taps: new Map(),      // habit id -> Set of date keys
  off: false,           // the SQL is not pasted yet
  failed: null,         // a load that did not work, as its sentence
  adding: false,        // the Add habit form is open
  today: dayKey(Date.now()),
};
let root = null, body = null, gen = 0, dayTimer = 0, flashKey = null;

const isGoal = (h) => !!h.is_goal;
const mine = () => S.habits.filter((h) => !isGoal(h));
const tapsOf = (id) => { if (!S.taps.has(id)) S.taps.set(id, new Set()); return S.taps.get(id); };

/* ---------------------------------------------------- taps kept on the phone */
/* Every tap or un-tap not yet confirmed by the server, for this reader:
   [{ op: 'tap' | 'untap', habit, date }]. The newest op for a habit and day
   is the one that stands. Demo mode keeps nothing. */
function pending() {
  if (app.demo || !S.uid) return [];
  const all = store.read(PENDING, {});
  return Array.isArray(all && all[S.uid]) ? all[S.uid] : [];
}
function setPending(list) {
  if (app.demo || !S.uid) return;
  const all = store.read(PENDING, {}) || {};
  if (list.length) all[S.uid] = list; else delete all[S.uid];
  store.write(PENDING, all);
}
function queue(op, habit, date) {
  const list = pending().filter((p) => !(p.habit === habit && p.date === date));
  list.push({ op, habit, date });
  setPending(list);
}
/* an op that is still waiting wins over what the server last said */
function overlay() {
  pending().forEach((p) => {
    if (p.date !== S.today) return;   // a day gone by: the server would refuse it
    if (p.op === 'tap') tapsOf(p.habit).add(p.date); else tapsOf(p.habit).delete(p.date);
  });
}

let flushing = null;
function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    for (;;) {
      const p = app.demo ? demoQueue.shift() : pending()[0];
      if (!p) break;
      /* a day gone by: the server would refuse it, so it is let go quietly,
         and the screen goes back to what the server has */
      if (p.date !== dayKey(Date.now())) {
        if (!app.demo) setPending(pending().filter((x) => !(x.habit === p.habit && x.date === p.date && x.op === p.op)));
        undo(p);
        continue;
      }
      const r = await call(p.op === 'tap' ? 'sz_tap' : 'sz_untap', { p_habit: p.habit, p_date: p.date });
      if (!r.ok && (r.error === 'offline' || r.error === 'off')) {
        if (app.demo) demoQueue.unshift(p);
        break;   // keep it; try again later
      }
      if (!app.demo) setPending(pending().filter((x) => !(x.habit === p.habit && x.date === p.date && x.op === p.op)));
      if (!r.ok) {
        /* refused (a day gone by, a habit gone): take it back on screen */
        undo(p);
        app.toast(r.message);
      }
    }
    flushing = null;
  })();
  return flushing;
}
const demoQueue = [];
/* an op the server never took: put the row back as the server has it */
function undo(p) {
  if (p.op === 'tap') tapsOf(p.habit).delete(p.date); else tapsOf(p.habit).add(p.date);
  paintRow(p.habit);
}
window.addEventListener('online', () => { if (S.uid) flush(); });

/* --------------------------------------------------------------- loading */
function load() {
  const my = ++gen;
  const u = app.user();
  S.uid = u ? u.id : null;
  S.today = dayKey(Date.now());
  S.phase = 'loading';
  S.failed = null;
  S.off = false;
  paint();
  const season = call('sz_season_next', { p_city: 'burlington' }).then((r) => {
    if (my !== gen) return;
    S.season = r.ok && r.data && typeof r.data === 'object' && !Array.isArray(r.data) && r.data.kickoff_at ? r.data : null;
  });
  S.me = undefined;
  S.habits = [];
  S.taps = new Map();
  /* the member row only matters for Sign up; a missing one stops nothing */
  const me = !u ? Promise.resolve() : call('sz_me_get').then((r) => {
    if (my !== gen) return;
    S.me = r.ok && r.data && typeof r.data === 'object' && !Array.isArray(r.data) && r.data.name ? r.data : (r.ok ? null : undefined);
  });
  /* signed in: this phone's habits move to the account first */
  const habits = (u ? moveLocal(u.id) : Promise.resolve()).then(() => Promise.all([
    call('sz_habits_get'),
    call('sz_taps_get', { p_from: addDays(S.today, -HISTORY_DAYS), p_to: S.today }),
  ])).then(([h, t]) => {
    if (my !== gen) return;
    if (!h.ok || !t.ok) {
      const r = h.ok ? t : h;
      if (r.error === 'off') S.off = true; else S.failed = r.message;
      return;
    }
    S.habits = Array.isArray(h.data) ? h.data : [];
    S.taps = new Map();
    (Array.isArray(t.data) ? t.data : []).forEach((x) => tapsOf(x.habit).add(String(x.date).slice(0, 10)));
    if (u) overlay();
  });
  return Promise.all([season, me, habits]).then(() => {
    if (my !== gen) return;
    S.phase = 'ready';
    paint();
    land();
    if (u && pending().length) flush();
  });
}

/* ------------------------------------------- moving this phone's habits */
/* At sign-in, the habits this phone kept, with their taps, go to the
   account in one call, and the phone lets go of exactly those. The server
   takes them only into an account with nothing in it yet (the first
   sign-in). An account that already has habits gets this phone's own,
   matched by name and how often so nothing is doubled, with today's taps (a
   day gone by cannot be tapped from the app); when that leaves anything
   behind (an archived habit, a past day), the phone keeps its whole copy,
   and remembers which habits that account has had, so they are never sent
   twice. Offline, before the paste, or if the reader signs out or switches
   account on the way, nothing is let go: it moves on the next visit. Every
   call here goes to the server, never to the phone, and stops if the
   signed-in reader is no longer the one it started for. Never rejects. */
let moving = null;   // { uid, p }
const TRANSIENT = new Set(['offline', 'off', 'not_signed_in']);
function remote(uid, fn, args) {
  const u = app.user();
  if (!u || u.id !== uid) return Promise.resolve(fail('not_signed_in'));
  return serverCall(fn, args);
}
function moveLocal(uid) {
  if (moving && moving.uid === uid) return moving.p;
  const db = local();
  if (!db.pendingFor(uid)) return Promise.resolve();
  const snap = db.snapshot(uid);
  const p = remote(uid, 'sz_import_local', { p_habits: snap.list }).then((r) => {
    if (r.ok) { db.forget(snap.ids); return null; }
    if (r.error === 'already_synced') return mergeLocal(db, uid);
    if (!TRANSIENT.has(r.error)) app.toast(r.message);
    return null;
  }).then(() => { if (moving && moving.p === p) moving = null; }, () => { if (moving && moving.p === p) moving = null; });
  moving = { uid, p };
  return p;
}
const habitKey = (h) => clean(h.text).toLowerCase() + '|' + h.frequency + '|' + (h.frequency === 'n_per_week' ? h.n : '');
async function mergeLocal(db, uid) {
  const got = await remote(uid, 'sz_habits_get');
  if (!got.ok) return;
  const have = new Map((Array.isArray(got.data) ? got.data : []).filter((h) => !h.is_goal).map((h) => [habitKey(h), h]));
  const today = dayKey(Date.now());
  const snap = db.snapshot(uid);
  let whole = snap.whole;
  const added = [];
  for (let i = 0; i < snap.list.length; i++) {
    const h = snap.list[i];
    if (h.archived) { whole = false; continue; }
    if (h.taps.some((d) => d !== today)) whole = false;
    let row = have.get(habitKey(h));
    if (!row) {
      const r = await remote(uid, 'sz_habit_add', { p_text: h.text, p_frequency: h.frequency, p_n: h.n, p_shared: h.shared });
      if (!r.ok && TRANSIENT.has(r.error)) break;
      if (!r.ok) { whole = false; continue; }   // refused (the ceiling): it stays on the phone
      row = r.data;
      have.set(habitKey(h), row);
    }
    if (h.taps.includes(today)) {
      const t = await remote(uid, 'sz_tap', { p_habit: row.id, p_date: today });
      if (!t.ok && TRANSIENT.has(t.error)) break;
    }
    added.push(snap.ids[i]);
  }
  if (!added.length) return;
  if (whole && added.length === snap.ids.length) db.forget(added);
  else db.markMerged(uid, added);
}

/* the day turns at midnight New York: repaint then, and on coming back */
function armDay() {
  clearTimeout(dayTimer);
  dayTimer = setTimeout(() => { rollDay(); armDay(); }, Math.max(1000, nextMidnight(Date.now()) - Date.now() + 250));
}
function rollDay() {
  const now = dayKey(Date.now());
  if (now === S.today) return;
  S.today = now;
  paint();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !root) return;
  rollDay();
  if (S.uid && pending().length) flush();
});

/* ---------------------------------------------------------------- drawing */
function paint() {
  if (!body) return;
  body.innerHTML = '';
  if (S.view !== 'today') {
    body.appendChild(el('div', 'hb-soon', '<p>' + esc('Season 0 is coming') + '</p>'));
    app.paintSubnav();
    return;
  }
  body.appendChild(tile());
  if (S.phase === 'loading') { body.appendChild(skeleton()); return; }
  if (S.off && S.uid) { body.appendChild(el('p', 'hb-empty', esc(message('off')))); return; }
  if (S.failed) {
    const box = el('div', 'hb-gate');
    box.appendChild(el('p', 'hb-empty', esc(S.failed)));
    box.appendChild(button('Try again', 'ghost', load));
    body.appendChild(box);
    return;
  }
  const list = el('ul', 'hb-list');
  list.setAttribute('aria-label', 'Your habits');
  mine().forEach((h) => list.appendChild(row(h)));
  body.appendChild(list);
  bindList(list);
  if (!mine().length && !S.adding) body.appendChild(el('p', 'hb-empty', 'No habits yet.'));
  body.appendChild(addRow());
  if (!S.uid && mine().length) body.appendChild(button('Sync across devices', 'hb-sync', () => app.openSettings()));
}

/* a #habits/<key> link, or a habit just added: scroll to it and flash it */
function land() {
  if (!flashKey || S.phase !== 'ready' || S.view !== 'today') return;
  const k = flashKey;
  flashKey = null;
  if (!app.flashHit(body, k)) app.toast('That card has moved on');
}

/* The goal tile. Phase one has no goals, so it is the between-seasons
   tile: when the next season starts, and the button to sign up. */
function tile() {
  const t = el('section', 'hb-tile');
  t.dataset.k = 'next-season';
  if (S.season === undefined) {
    t.classList.add('is-skel');
    t.innerHTML = '<span class="skel w40"></span><span class="skel big"></span><span class="skel pill"></span>';
    return t;
  }
  const s = S.season;
  if (!s) {
    t.innerHTML = '<h2 class="hb-big">' + esc('No season scheduled yet') + '</h2>';
    return t;
  }
  const n = Math.max(0, daysUntil(Date.parse(s.kickoff_at), Date.now()));
  const when = new Date(s.kickoff_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  t.innerHTML = '<p class="hb-kicker">' + esc((s.name || 'Next season') + ' · ' + when) + '</p>' +
    '<h2 class="hb-big">' + esc(n === 0 ? 'Next season starts today' : 'Next season starts in ' + n + (n === 1 ? ' day' : ' days')) + '</h2>';
  t.appendChild(button('Sign up', 'hb-go', signUp));
  return t;
}
function signUp() {
  if (!S.uid) { app.toast('Sign in to join a season.'); app.openSettings(); return; }
  if (!S.me) { joinSheet(); return; }
  goSignUp();
}
function goSignUp() {
  const s = S.season;
  if (s && /^https:\/\//.test(s.stripe_link || '')) {
    if (app.demo) { app.toast('Opens the sign-up page in the real build'); return; }
    const w = window.open(s.stripe_link, '_blank', 'noopener');
    if (w === null && !app.demo) location.href = s.stripe_link;   // a blocked pop-up: go there in this tab
    return;
  }
  const opens = s && s.signup_opens && Date.parse(s.signup_opens) > Date.now()
    ? new Date(s.signup_opens).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }) : null;
  app.toast(opens ? 'Sign-up opens ' + opens + '.' : 'Sign-up opens soon.');
}

function skeleton() {
  const w = el('div', 'hb-list is-skel');
  w.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) {
    w.appendChild(el('div', 'hb-row', '<span class="hb-in"><span class="hb-grip"></span><span class="hb-main"><span class="skel w60"></span>' +
      '<span class="skel w30"></span><span class="hb-dots">' + '<i class="d later"></i>'.repeat(7) + '</span></span><span class="hb-tap skel"></span></span>'));
  }
  return w;
}

/* --------------------------------------------------------------- a habit */
function rowInner(h) {
  const taps = tapsOf(h.id);
  const on = taps.has(S.today);
  const n = streak(h, taps, Date.now());
  const dots = weekDots(h, taps, Date.now());
  const done = dots.filter((d) => d.state === 'done').length;
  const meta = [n > 0 ? '<span class="hb-streak"><b>' + esc(n) + '</b> ' + esc(streakUnit(h, n)) + '</span>' : '', esc(freqWord(h)), h.shared ? esc('Shared') : '']
    .filter(Boolean).join('<span class="sep"> · </span>');
  return '<span class="hb-in">' +
    '<button class="hb-grip" type="button" aria-label="' + esc('Move ' + h.text) + '">' + GRIP + '</button>' +
    '<span class="hb-main">' +
      '<button class="hb-name" type="button">' + esc(h.text) + '</button>' +
      '<span class="hb-meta">' + meta + '</span>' +
      '<span class="hb-dots" role="img" aria-label="' + esc('This week, ' + done + ' of 7 days done') + '">' +
        dots.map((d) => '<i class="d ' + d.state + '" title="' + esc(DOW[dots.indexOf(d)]) + '"></i>').join('') + '</span>' +
    '</span>' +
    '<button class="hb-tap' + (on ? ' on' : '') + '" type="button" aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="' + esc('Done today: ' + h.text) + '">' + ICON.check + '</button>' +
    '</span><span class="hb-arch" aria-hidden="true">Archive</span>';
}
const GRIP = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6.5" r="1.3"/><circle cx="15" cy="6.5" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="17.5" r="1.3"/><circle cx="15" cy="17.5" r="1.3"/></svg>';
function row(h) {
  const li = el('li', 'hb-row', rowInner(h));
  li.dataset.k = 'h-' + h.id;
  li.dataset.id = h.id;
  return li;
}
function rowOf(id) { return body && body.querySelector('.hb-row[data-id="' + CSS.escape(id) + '"]'); }
function paintRow(id) {
  const li = rowOf(id);
  const h = S.habits.find((x) => x.id === id);
  if (li && h) li.innerHTML = rowInner(h);
}

/* Tap: today done, or not. Painted first, sent after. */
function toggle(id) {
  const h = S.habits.find((x) => x.id === id);
  if (!h) return;
  rollDay();
  const taps = tapsOf(id);
  const day = S.today;
  const on = !taps.has(day);
  if (on) taps.add(day); else taps.delete(day);
  paintRow(id);
  const b = rowOf(id) && rowOf(id).querySelector('.hb-tap');
  if (b && on) { b.classList.add('pop'); if (navigator.vibrate) navigator.vibrate(8); }
  const op = { op: on ? 'tap' : 'untap', habit: id, date: day };
  /* signed out: the phone is the server, and it answers at once */
  if (!S.uid) {
    call(on ? 'sz_tap' : 'sz_untap', { p_habit: id, p_date: day }).then((r) => { if (!r.ok) { undo(op); app.toast(r.message); } });
    return;
  }
  if (app.demo) demoQueue.push(op);
  else queue(op.op, id, day);
  flush();
}

/* Archive, with Undo. */
function archive(id) {
  const h = S.habits.find((x) => x.id === id);
  if (!h) return;
  const at = S.habits.indexOf(h);
  S.habits.splice(at, 1);
  paint();
  call('sz_habit_set', { p_habit: id, p_archived: true }).then((r) => {
    if (!r.ok) { S.habits.splice(at, 0, h); paint(); app.toast(r.message); return; }
    app.toast('Archived ' + h.text, () => {
      call('sz_habit_set', { p_habit: id, p_archived: false }).then((back) => {
        if (!back.ok) { app.toast(back.message); return; }
        /* it comes back at the bottom of the list, as the server put it */
        S.habits.push({ ...h, ...back.data });
        paint();
      });
    });
  });
}

/* Move a habit to place k (1 is the top) of your own list. */
function move(id, k, focus) {
  const list = mine();
  const from = list.findIndex((h) => h.id === id);
  if (from < 0) return;
  const to = Math.max(0, Math.min(list.length - 1, k - 1));
  if (from === to) { paint(); return; }
  const before = S.habits.slice();
  const [h] = list.splice(from, 1);
  list.splice(to, 0, h);
  list.forEach((x, i) => { x.position = i + 1; });
  S.habits = S.habits.filter(isGoal).concat(list);
  paint();
  if (focus) { const g = rowOf(id) && rowOf(id).querySelector('.hb-grip'); if (g) g.focus(); }
  call('sz_habit_set', { p_habit: id, p_position: to + 1 }).then((r) => {
    if (r.ok) return;
    S.habits = before;
    paint();
    app.toast(r.message);
  });
}

/* One set of handlers on the list: tap, name, the swipe left to archive,
   and the drag by the grip. */
function bindList(list) {
  let sw = null, drag = null, deadUntil = 0, deadRow = null, rolling = 0;
  /* The dragged row follows the finger. Past a neighbour's middle the rows
     swap, and the dragged one keeps its place under the finger. The
     neighbour is the one moved in the page, both ways: moving the dragged
     row itself would drop its pointer capture, and a finger let go over the
     mast would then never end the drag. */
  const follow = () => {
    const li = drag.li;
    li.style.transform = 'translateY(' + (drag.cy - drag.y0) + 'px)';
    const mid = li.getBoundingClientRect().top + li.offsetHeight / 2;
    const prev = li.previousElementSibling, next = li.nextElementSibling;
    if (next && mid > next.getBoundingClientRect().top + next.offsetHeight / 2) {
      drag.y0 += next.offsetHeight;
      list.insertBefore(next, li);
    } else if (prev && mid < prev.getBoundingClientRect().top + prev.offsetHeight / 2) {
      drag.y0 -= prev.offsetHeight;
      li.after(prev);
    } else return;
    li.style.transform = 'translateY(' + (drag.cy - drag.y0) + 'px)';
  };
  /* Held near the top or the bottom of the screen (under the mast, above
     the tab bar), a drag scrolls the panel, faster the closer it gets, so a
     habit can travel the whole of a long list. The row stays under the
     finger while the list moves past it. */
  const roll = () => {
    rolling = 0;
    const p = drag && list.closest('.panel');
    if (!p) return;
    const mast = document.getElementById('mast'), bar = document.getElementById('tabbar');
    const top = Math.max(0, mast ? mast.getBoundingClientRect().bottom : 0) + DRAG_EDGE;
    const b = bar && bar.getBoundingClientRect();
    const bottom = (b && b.height && b.top > innerHeight / 2 ? b.top : innerHeight) - DRAG_EDGE;
    const v = drag.cy < top ? -Math.min(DRAG_SPEED, Math.ceil((top - drag.cy) / 3))
      : drag.cy > bottom ? Math.min(DRAG_SPEED, Math.ceil((drag.cy - bottom) / 3)) : 0;
    if (!v) return;
    const s0 = p.scrollTop;
    p.scrollTop = s0 + v;
    const d = p.scrollTop - s0;
    if (!d) return;
    drag.y0 -= d;
    drag.moved = true;
    follow();
    rolling = requestAnimationFrame(roll);
  };
  list.addEventListener('click', (e) => {
    const li = e.target.closest('.hb-row');
    if (!li) return;
    if (li === deadRow && Date.now() < deadUntil) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.target.closest('.hb-tap')) { toggle(li.dataset.id); return; }
    if (e.target.closest('.hb-name')) { editSheet(li.dataset.id); }
  });
  list.addEventListener('keydown', (e) => {
    const g = e.target.closest('.hb-grip');
    if (!g || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const id = g.closest('.hb-row').dataset.id;
    const at = mine().findIndex((h) => h.id === id);
    move(id, at + 1 + (e.key === 'ArrowUp' ? -1 : 1), true);
  });
  list.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const li = e.target.closest('.hb-row');
    if (!li) return;
    if (e.target.closest('.hb-grip')) {
      e.preventDefault();
      drag = { li, id: li.dataset.id, pid: e.pointerId, y0: e.clientY, cy: e.clientY, moved: false };
      try { li.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
      li.classList.add('is-drag');
      return;
    }
    if (e.target.closest('.hb-tap')) return;
    sw = { li, pid: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, on: false };
  });
  list.addEventListener('pointermove', (e) => {
    if (drag && e.pointerId === drag.pid) {
      e.preventDefault();
      drag.cy = e.clientY;
      if (Math.abs(e.clientY - drag.y0) > 4) drag.moved = true;
      follow();
      if (!rolling && drag.moved) rolling = requestAnimationFrame(roll);
      return;
    }
    if (!sw || e.pointerId !== sw.pid) return;
    const mx = e.clientX - sw.x0, my = e.clientY - sw.y0;
    if (!sw.on) {
      if (Math.abs(my) > SWIPE_CANCEL_Y) { endSwipe(); return; }
      if (Math.abs(mx) < SWIPE_START || mx > 0) return;
      sw.on = true;
      try { sw.li.setPointerCapture(sw.pid); } catch (err) { /* optional */ }
    }
    sw.dx = Math.min(0, mx);
    sw.li.style.setProperty('--swipe', Math.max(-140, sw.dx) + 'px');
    sw.li.classList.add('is-swiping');
    sw.li.classList.toggle('will-commit', sw.dx <= -SWIPE_COMMIT);
    e.preventDefault();
  }, { passive: false });
  const endSwipe = () => {
    if (!sw) return;
    sw.li.style.removeProperty('--swipe');
    sw.li.classList.remove('is-swiping', 'will-commit');
    sw = null;
  };
  const finish = (e) => {
    if (drag && e.pointerId === drag.pid) {
      const d = drag;
      drag = null;
      cancelAnimationFrame(rolling);
      rolling = 0;
      d.li.classList.remove('is-drag');
      d.li.style.transform = '';
      if (!d.moved) return;
      deadRow = d.li; deadUntil = Date.now() + 400;
      const k = [...list.querySelectorAll('.hb-row')].indexOf(d.li) + 1;
      move(d.id, k);
      return;
    }
    if (!sw || e.pointerId !== sw.pid) return;
    const { li, dx, on } = sw;
    endSwipe();
    if (!on) return;
    deadRow = li; deadUntil = Date.now() + 400;
    if (dx <= -SWIPE_COMMIT) archive(li.dataset.id);
  };
  list.addEventListener('pointerup', finish);
  list.addEventListener('pointercancel', finish);
}

/* ------------------------------------------------------------- the forms */
let fid = 0;
function field(label, input) {
  const id = 'hb-f' + (++fid);
  input.id = id;
  const w = el('div', 'bf-row');
  const l = el('label', 'bf-label', esc(label));
  l.htmlFor = id;
  w.append(l, input);
  return w;
}
function textInput(name, max, value, placeholder) {
  const i = el('input', 'field bf-in');
  i.type = name === 'phone' ? 'tel' : 'text';
  i.name = name;
  i.maxLength = max;
  if (value) i.value = value;
  if (placeholder) i.placeholder = placeholder;
  if (name === 'phone') i.autocomplete = 'tel';
  if (name === 'name') i.autocomplete = 'given-name';
  return i;
}

/* The habit form, for Add and for Edit: a name, how often, sharing. */
function habitForm(h, onDone, extra) {
  const f = el('form', 'bform hb-form');
  f.noValidate = true;
  const name = textInput('text', HABIT_RULES.limits.habitTextMax, h && h.text, 'Morning walk');
  f.appendChild(field('Name', name));
  let freq = (h && h.frequency) || 'daily';
  const nSel = el('select', 'field bf-in hb-n');
  nSel.name = 'n';
  for (let i = HABIT_RULES.limits.nMin; i <= HABIT_RULES.limits.nMax; i++) {
    const o = el('option', null, esc(i + (i === 1 ? ' time a week' : ' times a week')));
    o.value = String(i);
    if (i === ((h && h.n) || 3)) o.selected = true;
    nSel.appendChild(o);
  }
  const how = el('div', 'bf-row');
  how.appendChild(el('div', 'bf-label', 'How often'));
  const pills = el('div', 'pills hb-freq');
  [['daily', 'Daily'], ['weekdays', 'Weekdays'], ['n_per_week', 'N a week']].forEach(([v, label]) => {
    const b = el('button', v === freq ? 'on' : '', esc(label));
    b.type = 'button';
    b.dataset.freq = v;
    b.setAttribute('aria-pressed', v === freq ? 'true' : 'false');
    b.addEventListener('click', () => {
      freq = v;
      [...pills.children].forEach((c) => { c.classList.toggle('on', c === b); c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); });
      nSel.hidden = v !== 'n_per_week';
    });
    pills.appendChild(b);
  });
  nSel.hidden = freq !== 'n_per_week';
  nSel.setAttribute('aria-label', 'Times a week');
  how.append(pills, nSel);
  f.appendChild(how);
  const share = el('label', 'hb-share', '<input type="checkbox" name="shared"' + (h && h.shared ? ' checked' : '') + '> <span>' + esc('Share with my pod') + '</span>');
  f.appendChild(share);
  const msg = el('p', 'bf-msg');
  msg.setAttribute('role', 'status');
  const go = button(h ? 'Save' : 'Add', '');
  go.type = 'submit';
  const actions = el('div', 'bf-go');
  actions.append(go);
  if (extra) extra(actions);
  actions.append(msg);
  f.appendChild(actions);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = { text: name.value, frequency: freq, n: Number(nSel.value), shared: f.querySelector('input[name="shared"]').checked };
    const c = checkHabit(HABIT_RULES, input);
    if (!c.ok) { msg.textContent = message(c.error); msg.classList.add('err'); return; }
    go.disabled = true;
    msg.classList.remove('err');
    msg.textContent = '';
    onDone(c.habit).then((r) => {
      go.disabled = false;
      if (r && !r.ok) { msg.textContent = r.message; msg.classList.add('err'); }
    });
  });
  setTimeout(() => { if (!h) name.focus(); }, 0);
  return f;
}

function addRow() {
  const w = el('div', 'hb-add');
  if (!S.adding) {
    w.appendChild(button(ICON.plus + ' Add habit', 'ghost hb-addbtn', () => { S.adding = true; paint(); }));
    return w;
  }
  w.appendChild(habitForm(null, (habit) => call('sz_habit_add', { p_text: habit.text, p_frequency: habit.frequency, p_n: habit.n, p_shared: habit.shared }).then((r) => {
    if (!r.ok) return r;
    S.habits.push(r.data);
    S.adding = false;
    flashKey = 'h-' + r.data.id;
    paint();
    land();
    return r;
  }), (actions) => actions.appendChild(button('Cancel', 'ghost', (e) => { e.preventDefault(); S.adding = false; paint(); }))));
  return w;
}

function editSheet(id) {
  const h = S.habits.find((x) => x.id === id);
  if (!h) return;
  app.sheet('Edit habit', (sheetBody, card, close) => {
    sheetBody.appendChild(habitForm(h, (habit) => call('sz_habit_set', {
      p_habit: id, p_text: habit.text, p_frequency: habit.frequency, p_n: habit.frequency === 'n_per_week' ? habit.n : null, p_shared: habit.shared,
    }).then((r) => {
      if (!r.ok) return r;
      Object.assign(h, r.data);
      close();
      paint();
      return r;
    }), (actions) => actions.appendChild(button('Archive', 'ghost', (e) => { e.preventDefault(); close(); archive(id); }))));
  });
}

/* Joining a season asks a first name and a phone, once: pods meet on a
   group chat Stephen sets up. The tracker never asks. */
function joinSheet() {
  app.sheet('Join ' + ((S.season && S.season.name) || 'the season'), (sheetBody, card, close) => {
    sheetBody.appendChild(meForm(() => { close(); goSignUp(); }));
  });
}
function meForm(onSaved) {
  const w = el('div', 'hb-me');
  const f = el('form', 'bform');
  f.noValidate = true;
  const name = textInput('name', HABIT_RULES.limits.nameMax, '', '');
  const phone = textInput('phone', HABIT_RULES.limits.phoneMax, '', '');
  f.append(field('Your first name', name), field('Phone', phone));
  f.appendChild(el('p', 'bf-hint', esc('Only Stephen sees your phone number.')));
  const msg = el('p', 'bf-msg');
  msg.setAttribute('role', 'status');
  const go = button('Save', '');
  go.type = 'submit';
  const actions = el('div', 'bf-go');
  actions.append(go, msg);
  f.appendChild(actions);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const c = checkMe(HABIT_RULES, { name: name.value, phone: phone.value });
    if (!c.ok) { msg.textContent = message(c.error); msg.classList.add('err'); return; }
    go.disabled = true;
    call('sz_me_set', { p_name: c.me.name, p_phone: c.me.phone }).then((r) => {
      go.disabled = false;
      if (!r.ok) { msg.textContent = r.message; msg.classList.add('err'); return; }
      S.me = r.data;
      onSaved();
    });
  });
  w.appendChild(f);
  return w;
}

/* ----------------------------------------------- deleting your account */
/* Settings' "Delete my account and posts" (boards.js) deletes your habits,
   taps and member row first, and stops if that fails. */
boards.onDeleteMe(() => call('sz_delete_me').then((r) => {
  if (r.ok) { S.habits = []; S.taps = new Map(); S.me = null; setPending([]); }
  return r;
}));

app.onAuth(() => {
  if (!root) return;
  const u = app.user();
  if ((u ? u.id : null) === S.uid) return;
  S.adding = false;
  load();
});

/* ------------------------------------------------------------------ the tab */
app.register(KEY, {
  label: 'Habits',
  icon: ICON.habits,
  promise: 'One goal, a few habits, and a season that ends in a party.',
  mount(host) {
    root = host;
    body = el('div', 'hb');
    root.appendChild(body);
    load();
  },
  activate(param) {
    const v = VIEWS.find(([k]) => k === param);
    const was = S.view;
    S.view = v ? v[0] : 'today';
    if (param && !v) flashKey = param;
    armDay();
    rollDay();
    if (was !== S.view || flashKey) paint();
    land();
    app.paintSubnav();
  },
  refresh() { paint(); },
  deactivate() { clearTimeout(dayTimer); },
  subnav() {
    return chips(VIEWS.map(([key, label]) => ({ key, label })), S.view, (k) => {
      if (k === S.view) { app.scrollTop(true); return; }
      S.view = k;
      history.replaceState(null, '', location.search + '#habits' + (k === 'today' ? '' : '/' + k));
      paint();
      app.paintSubnav();
    });
  },
  /* nothing here grows while you are away */
  newSince() { return 0; },
});

/* for tests: the demo's server */
export const _fake = () => (app.demo ? demoBackend() : null);
