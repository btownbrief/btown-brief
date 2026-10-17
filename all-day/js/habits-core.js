/* habits-core.js — the Habits tab's rules, in one place.

   No DOM, no fetch, no clock: time is an argument. Three things obey these
   rules and must agree: this file (the tab draws streaks and dots, and
   checks a habit before it is sent), supabase/sz-SETUP.sql (the server
   checks it again, because the anon key is public), and js/habits-fake.js
   (the demo and the tests).

   HABIT_RULES below is copied, as JSON, into sz_rules() in the newest
   rules paste, supabase/sz-ROUND2.sql (sz-SETUP.sql carries the same copy
   for a fresh install). scripts/test-habits-core.mjs fails if they ever
   differ: edit HABIT_RULES, run `node scripts/test-habits-core.mjs
   --write-sql`, and Stephen pastes sz-ROUND2.sql again.

   habitsMax is not a limit readers are told about. It is a ceiling against
   a script making habits by the million; nobody keeping habits by hand
   comes near it, so the tab never mentions it.

   Days. Every day here is a Burlington calendar date, 'YYYY-MM-DD' in
   America/New_York, whatever the reader's phone says. A day starts at
   midnight New York, not UTC. Keys are added and subtracted as calendar
   dates (UTC noon arithmetic), so a daylight-saving change, which happens
   at 2 am, never moves a day. A week runs Monday to Sunday.

   Streaks (the notes' Rules, word for word in the tests):
   - daily: consecutive days with a tap, counting back from today if tapped
     today, else from yesterday. Today untapped does not break it until
     midnight.
   - weekdays: the same, but Saturday and Sunday are skipped, not broken. A
     tap on a weekend day still counts (HABITS-DECISIONS.md).
   - n_per_week: counted in weeks. A week is on target at N taps; the streak
     is the run of on-target weeks. The current week never breaks the run
     while it can still reach N, and adds one once it does.
   A tap dated after today is ignored. Streaks are worked out here from the
   taps, never stored. */

export const HABIT_RULES = {
  version: 1,
  tz: 'America/New_York',
  frequencies: ['daily', 'weekdays', 'n_per_week'],
  categories: ['fitness', 'creative', 'business', 'life_admin', 'learn'],
  seasonStatuses: ['upcoming', 'open', 'live', 'done'],
  limits: {
    habitsMax: 100,
    habitTextMax: 60,
    nameMax: 32,
    phoneMin: 7,
    phoneMax: 20,
    nMin: 1,
    nMax: 6,
    tapsRangeMaxDays: 370,
  },
};

/* How far back the habits kept on a phone before sign-in may carry their
   taps when they move to the account (sz_import_local in sz-ROUND3.sql has
   the same 400). A phone keeps no more than this, either (habits-local.js). */
export const IMPORT_DAYS = 400;

/* ------------------------------------------------------------------ days */
const TZ = HABIT_RULES.tz;
const DAYF = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const WALLF = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });

/* The Burlington calendar date of an instant. */
export function dayKey(ms) {
  const o = {};
  DAYF.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
  return o.year + '-' + o.month + '-' + o.day;
}
const keyMs = (key) => { const [y, m, d] = String(key).split('-').map(Number); return Date.UTC(y, m - 1, d, 12); };
const msKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export const isKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && msKey(keyMs(k)) === k;
/* a calendar date n days on (or back, n < 0) */
export const addDays = (key, n) => msKey(keyMs(key) + n * 86400000);
/* 0 Monday … 6 Sunday */
export const dow = (key) => (new Date(keyMs(key)).getUTCDay() + 6) % 7;
export const isWeekend = (key) => dow(key) >= 5;
export const weekStart = (key) => addDays(key, -dow(key));
/* whole calendar days from a to b */
export const daysBetween = (a, b) => Math.round((keyMs(b) - keyMs(a)) / 86400000);

/* The instant midnight starts on a Burlington date: what the tab waits for
   to roll the day over. Midnight is never inside a daylight-saving jump
   (those happen at 2 am), so two passes settle it. */
function wall(ms) {
  const o = {};
  WALLF.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
  return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second);
}
export function midnightOf(key) {
  const [y, m, d] = key.split('-').map(Number);
  const g = Date.UTC(y, m - 1, d);
  let t = g - (wall(g) - g);
  t = g - (wall(t) - t);
  return t;
}
export const nextMidnight = (nowMs) => midnightOf(addDays(dayKey(nowMs), 1));

/* "Next season starts in N days": calendar days in Burlington, so a kickoff
   tomorrow at 9 am is 1 day away at 11 pm tonight. */
export const daysUntil = (thenMs, nowMs) => daysBetween(dayKey(nowMs), dayKey(thenMs));

/* ---------------------------------------------------------------- streaks */
/* taps: the habit's tapped dates, as an array or a Set of keys */
const asSet = (taps) => (taps instanceof Set ? taps : new Set(taps || []));
const nOf = (habit) => Math.max(1, Math.min(7, Number(habit && habit.n) || 1));

export function streak(habit, taps, nowMs) {
  const today = dayKey(nowMs);
  const set = new Set([...asSet(taps)].filter((k) => isKey(k) && k <= today));
  if (!set.size) return 0;
  const first = [...set].sort()[0];
  const freq = habit && habit.frequency;

  if (freq === 'n_per_week') {
    const n = nOf(habit);
    const inWeek = (start, upto) => { let c = 0; for (let i = 0; i < 7; i++) { const k = addDays(start, i); if (k > upto) break; if (set.has(k)) c++; } return c; };
    const w0 = weekStart(today);
    const now = inWeek(w0, today);
    /* days still open this week: today if untapped, and every day after it */
    const left = (6 - dow(today)) + (set.has(today) ? 0 : 1);
    if (now < n && now + left < n) return 0;
    let run = now >= n ? 1 : 0;
    for (let w = addDays(w0, -7); w >= weekStart(first); w = addDays(w, -7)) {
      if (inWeek(w, addDays(w, 6)) >= n) run++; else break;
    }
    return run;
  }

  const weekdays = freq === 'weekdays';
  let d = set.has(today) ? today : addDays(today, -1);
  let run = 0;
  while (d >= first) {
    if (set.has(d)) run++;
    else if (!(weekdays && isWeekend(d))) break;
    d = addDays(d, -1);
  }
  return run;
}

/* The unit a streak is counted in, for the words beside the number. */
export const streakUnit = (habit, n) => (habit && habit.frequency === 'n_per_week'
  ? (n === 1 ? 'week' : 'weeks') : (n === 1 ? 'day' : 'days'));

/* ------------------------------------------------------------------- dots */
/* This week, Monday to Sunday, as seven dots:
     done    a tap
     missed  a day the habit was due, gone by without one (a ring)
     off     a day it was not due: a weekend for a weekdays habit, and any
             untapped day for an N-a-week habit, which has no set days
     today   today, not tapped yet
     later   a day still to come */
export function weekDots(habit, taps, nowMs) {
  const set = asSet(taps);
  const today = dayKey(nowMs);
  const start = weekStart(today);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const key = addDays(start, i);
    let state;
    if (key <= today && set.has(key)) state = 'done';
    else if (key === today) state = 'today';
    else if (key > today) state = 'later';
    else if (habit && habit.frequency === 'n_per_week') state = 'off';
    else if (habit && habit.frequency === 'weekdays' && isWeekend(key)) state = 'off';
    else state = 'missed';
    out.push({ key, state });
  }
  return out;
}

/* ------------------------------------------------------------- the checks */
/* Tidy words the way sz_clean() does, in the same order: drop control
   characters, drop links, squeeze the spaces. */
export function clean(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* A new habit or a change to one: { ok, habit } or { ok: false, error }.
   Same order of checks as sz_habit_add. */
export function checkHabit(rules, input) {
  const L = rules.limits;
  const text = clean(input && input.text);
  if (!text || text.length > L.habitTextMax) return { ok: false, error: 'bad_text' };
  const frequency = input && input.frequency;
  if (!rules.frequencies.includes(frequency)) return { ok: false, error: 'bad_frequency' };
  let n = null;
  if (frequency === 'n_per_week') {
    n = Number(input.n);
    if (!Number.isInteger(n) || n < L.nMin || n > L.nMax) return { ok: false, error: 'bad_n' };
  }
  return { ok: true, habit: { text, frequency, n, shared: !!(input && input.shared) } };
}

/* Name and phone, asked when a reader joins a season. Same as sz_me_set. */
export function checkMe(rules, input) {
  const L = rules.limits;
  const name = clean(input && input.name);
  if (!name || name.length > L.nameMax || name.includes('@')) return { ok: false, error: 'bad_name' };
  const phone = clean(input && input.phone);
  const digits = phone.replace(/\D/g, '');
  if (phone.length > L.phoneMax || !/^\+?[0-9 ().-]+$/.test(phone) || digits.length < L.phoneMin) return { ok: false, error: 'bad_phone' };
  return { ok: true, me: { name, phone } };
}

/* -------------------------------------------------------------- the words */
const MESSAGES = {
  not_signed_in: 'Sign in first.',
  already_synced: 'This account already has habits.',
  bad_import: 'Couldn’t move this phone’s habits.',
  no_member: 'Add your name first.',
  bad_name: 'A first name, up to 32 letters.',
  bad_phone: 'That phone number doesn’t look right.',
  bad_text: 'A name for the habit, up to 60 letters.',
  bad_frequency: 'Choose how often.',
  bad_n: 'Between 1 and 6 times a week.',
  too_many_habits: 'That’s a lot of habits. Archive a few first.',
  not_found: 'That habit is gone.',
  not_today: 'Only today can be marked.',
  goal_habit: 'The goal habit stays.',
  locked: 'The goal is locked for the season.',
  bad_range: 'Couldn’t load that stretch.',
  off: 'Habits open soon.',
  offline: 'Couldn’t reach the server. Try again in a moment.',
};
export const message = (code) => MESSAGES[code] || MESSAGES.offline;
