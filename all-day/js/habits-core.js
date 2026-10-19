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
/* The day a habit starts counting: the day it was made, in Burlington, or
   its first tap if that is earlier (habits moved from a phone keep their
   older taps). null when neither is known, and then every day counts. A
   day before it is never a missed day. */
export function startKey(habit, taps) {
  const c = habit && habit.created_at;
  const ms = typeof c === 'number' ? c : Date.parse(c);
  if (!(Number.isFinite(ms) && ms > 0)) return null;
  let k = dayKey(ms);
  for (const t of asSet(taps)) if (isKey(t) && t < k) k = t;
  return k;
}

/* One day of one habit, as a dot or a calendar square:
     done    a tap
     missed  a day the habit was due, gone by without one (a ring)
     off     a day it was not due: a weekend for a weekdays habit, any
             untapped day for an N-a-week habit, which has no set days, and
             any day before the habit started
     today   today, not tapped yet
     later   a day still to come */
function dayState(habit, set, key, today, start) {
  if (key <= today && set.has(key)) return 'done';
  if (key === today) return 'today';
  if (key > today) return 'later';
  if (start && key < start) return 'off';
  if (habit && habit.frequency === 'n_per_week') return 'off';
  if (habit && habit.frequency === 'weekdays' && isWeekend(key)) return 'off';
  return 'missed';
}

/* This week, Monday to Sunday, as seven dots (dayState). */
export function weekDots(habit, taps, nowMs) {
  const set = asSet(taps);
  const today = dayKey(nowMs);
  const start = startKey(habit, set);
  const w = weekStart(today);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const key = addDays(w, i);
    out.push({ key, state: dayState(habit, set, key, today, start) });
  }
  return out;
}

/* A month as calendar squares: ym is 'YYYY-MM'. lead is how many blank
   squares come before the 1st in a week that starts Monday. */
export const monthOf = (key) => String(key).slice(0, 7);
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
}
export function monthGrid(habit, taps, ym, nowMs) {
  const set = asSet(taps);
  const today = dayKey(nowMs);
  const start = startKey(habit, set);
  const first = ym + '-01';
  const days = [];
  for (let k = first; monthOf(k) === ym; k = addDays(k, 1)) days.push({ key: k, day: Number(k.slice(8)), state: dayState(habit, set, k, today, start) });
  return { ym, lead: dow(first), days };
}

/* ---------------------------------------------------------- more numbers */
/* The longest streak the taps hold, by the same rules as streak(): never
   less than the streak running now. */
export function bestStreak(habit, taps, nowMs) {
  const today = dayKey(nowMs);
  const set = new Set([...asSet(taps)].filter((k) => isKey(k) && k <= today));
  if (!set.size) return 0;
  const first = [...set].sort()[0];
  let best = 0, run = 0;
  if (habit && habit.frequency === 'n_per_week') {
    const n = nOf(habit);
    const w0 = weekStart(today);
    for (let w = weekStart(first); w <= w0; w = addDays(w, 7)) {
      let c = 0;
      for (let i = 0; i < 7; i++) { const k = addDays(w, i); if (k > today) break; if (set.has(k)) c++; }
      if (c >= n) best = Math.max(best, ++run);
      else if (w !== w0) run = 0;   // this week is not over: it never breaks a run
    }
  } else {
    const weekdays = habit && habit.frequency === 'weekdays';
    for (let d = first; d <= today; d = addDays(d, 1)) {
      if (set.has(d)) best = Math.max(best, ++run);
      else if (!(weekdays && isWeekend(d))) run = 0;
    }
  }
  return Math.max(best, streak(habit, set, nowMs));
}

/* How much of what was due got done over the last `days` days, as
   { done, due }. Today counts once it is tapped (it is not over yet), and
   nothing before the habit started counts. Daily: every day is due.
   Weekdays: Monday to Friday. N a week: N for every seven days, rounded,
   and never less than the taps made. */
export function completion(habit, taps, nowMs, days = 7) {
  const set = asSet(taps);
  const today = dayKey(nowMs);
  let from = addDays(today, -(days - 1));
  const start = startKey(habit, set);
  if (start && start > from) from = start;
  const to = set.has(today) ? today : addDays(today, -1);
  if (to < from) return { done: 0, due: 0 };
  let done = 0, due = 0;
  if (habit && habit.frequency === 'n_per_week') {
    for (let d = from; d <= to; d = addDays(d, 1)) if (set.has(d)) done++;
    due = Math.max(Math.round(nOf(habit) * (daysBetween(from, to) + 1) / 7), done);
    return { done, due };
  }
  const weekdays = habit && habit.frequency === 'weekdays';
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (weekdays && isWeekend(d)) continue;
    due++;
    if (set.has(d)) done++;
  }
  return { done, due };
}
export const percent = (c) => (c && c.due ? Math.round(100 * c.done / c.due) : null);

/* Is this habit one for today? Daily: always. Weekdays: Monday to Friday.
   N a week: until the week has its N, and on any day it is tapped. */
export function dueToday(habit, taps, nowMs) {
  const set = asSet(taps);
  const today = dayKey(nowMs);
  if (set.has(today)) return true;
  const f = habit && habit.frequency;
  if (f === 'weekdays') return !isWeekend(today);
  if (f === 'n_per_week') {
    const w = weekStart(today);
    let c = 0;
    for (let i = 0; i < 7; i++) if (set.has(addDays(w, i))) c++;
    return c < nOf(habit);
  }
  return true;
}

/* Each day from `from` to `to` across all your habits, for the heat map:
   [{ key, done, due }]. A tap is one done and one due; an untapped day is
   due for a daily habit, and for a weekdays one Monday to Friday, once the
   habit has started. An N-a-week habit has no set days, so only its taps
   count. Days to come are nothing. tapsOf(id) gives a habit's taps. */
export function dayTotals(habits, tapsOf, from, to, nowMs) {
  const today = dayKey(nowMs);
  const hs = (habits || []).map((h) => { const set = asSet(tapsOf(h.id)); return { f: h.frequency, set, start: startKey(h, set) }; });
  const out = [];
  for (let key = from; key <= to; key = addDays(key, 1)) {
    let done = 0, due = 0;
    if (key <= today) {
      for (const h of hs) {
        if (h.set.has(key)) { done++; due++; continue; }
        if (h.start && key < h.start) continue;
        if (h.f === 'daily' || (h.f === 'weekdays' && !isWeekend(key))) due++;
      }
    }
    out.push({ key, done, due });
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
  bad_forest_name: 'A name for your forest, up to 32 letters, no @.',
  bad_cohort: 'A cohort name, up to 32 letters.',
  bad_forest: 'That’s a lot of trees. Choose fewer.',
  offline: 'Couldn’t reach the server. Try again in a moment.',
};
export const message = (code) => MESSAGES[code] || MESSAGES.offline;
