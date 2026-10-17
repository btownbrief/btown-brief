// The Habits tab's pure rules, and the fake backend's mirror of the SQL.
//
//   node --test scripts/test-habits-core.mjs
//   node scripts/test-habits-core.mjs --write-sql   (copy HABIT_RULES into sz-ROUND2.sql and sz-SETUP.sql)
//
// Three copies of one set of rules must agree: all-day/js/habits-core.js,
// sz_rules() and the checks in the SQL (all-day/supabase/sz-SETUP.sql, with
// sz-ROUND2.sql pasted over it), and the fake in all-day/js/habits-fake.js.
// This file checks the first two are the same JSON (sz-ROUND2.sql's copy is
// the live one; sz-SETUP.sql carries the same for a fresh install), that
// sz-ROUND2.sql changes nothing but the rules, that the fake answers to exactly the doors the SQL grants, runs the
// streak and dot rules from the build notes (midnight New York, weekends,
// N-a-week weeks, both daylight-saving changes), and runs the fake through
// the cases scripts/test-sz-sql.sql runs against a real Postgres, so a
// drift shows up here even on a machine without one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as core from '../all-day/js/habits-core.js';
import { FakeHabits, seedDemo } from '../all-day/js/habits-fake.js';
import { LocalHabits, LOCAL_KEY, LOCAL_VERSION, LOCAL_DOORS, memoryStorage } from '../all-day/js/habits-local.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_PATH = path.join(ROOT, 'all-day/supabase/sz-SETUP.sql');
const ROUND2_PATH = path.join(ROOT, 'all-day/supabase/sz-ROUND2.sql');
const ROUND3_PATH = path.join(ROOT, 'all-day/supabase/sz-ROUND3.sql');
const RULES_RE = /\$json\$([\s\S]*?)\$json\$/;

if (process.argv.includes('--write-sql')) {
  for (const p of [ROUND2_PATH, SQL_PATH]) {
    const sql = readFileSync(p, 'utf8');
    writeFileSync(p, sql.replace(RULES_RE, () => '$json$' + JSON.stringify(core.HABIT_RULES) + '$json$'));
  }
  console.log('sz_rules() in sz-ROUND2.sql and sz-SETUP.sql now matches habits-core.js HABIT_RULES');
  process.exit(0);
}
const SQL = readFileSync(SQL_PATH, 'utf8');
const ROUND2 = readFileSync(ROUND2_PATH, 'utf8');
const ROUND3 = readFileSync(ROUND3_PATH, 'utf8');
const HABIT_ADD_RE = /-- Add a habit of your own\.[\s\S]*?end \$\$;\n/;

/* an instant from a Burlington wall-clock time: '2026-10-14 15:00' */
const ny = (s) => {
  const [d, t = '12:00'] = s.split(' ');
  const g = Date.parse(d + 'T' + t + ':00Z');
  /* the offset at that moment, settled twice (as midnightOf does) */
  const off = (ms) => { const k = core.dayKey(ms); const h = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).format(new Date(ms));
    const [hh, mm] = h.split(':').map(Number); return Date.UTC(...k.split('-').map((x, i) => (i === 1 ? x - 1 : +x)), hh, mm) - ms; };
  let ms = g - off(g);
  ms = g - off(ms);
  return ms;
};
const days = (from, to) => { const out = []; for (let d = from; d <= to; d = core.addDays(d, 1)) out.push(d); return out; };
const DAILY = { frequency: 'daily' }, WEEKDAYS = { frequency: 'weekdays' }, THREE = { frequency: 'n_per_week', n: 3 };

/* ------------------------------------------------------------- one copy */
test('sz_rules() in sz-ROUND2.sql, the newest rules paste, is exactly HABIT_RULES in habits-core.js', () => {
  const m = ROUND2.match(RULES_RE);
  assert.ok(m, 'sz-ROUND2.sql has a $json$ block');
  assert.deepEqual(JSON.parse(m[1]), core.HABIT_RULES, 'run: node scripts/test-habits-core.mjs --write-sql');
});

test('sz-SETUP.sql gives a fresh install the same rules', () => {
  const m = SQL.match(RULES_RE);
  assert.ok(m, 'sz-SETUP.sql has a $json$ block');
  assert.deepEqual(JSON.parse(m[1]), core.HABIT_RULES, 'run: node scripts/test-habits-core.mjs --write-sql');
});

test('the habit ceiling is an abuse ceiling, not a limit readers meet', () => {
  assert.equal(core.HABIT_RULES.limits.habitsMax, 100);
  assert.equal(core.message('too_many_habits'), 'That’s a lot of habits. Archive a few first.');
  const tab = readFileSync(path.join(ROOT, 'all-day/js/modes/habits.js'), 'utf8');
  assert.ok(!/habitsMax/.test(tab), 'the tab never hides Add habit or counts toward the ceiling');
});

test('sz-ROUND2.sql replaces sz_rules() and nothing else, with sz-SETUP.sql\'s grants', () => {
  const code = ROUND2.replace(/--[^\n]*/g, '').replace(RULES_RE, '');
  assert.deepEqual([...code.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]), ['sz_rules']);
  assert.ok(!/\b(drop|delete|truncate|alter|insert|update|create\s+(table|index|trigger|policy))\b/i.test(code), 'no other change');
  const stmts = code.split(';').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  assert.deepEqual(stmts.filter((x) => /^(revoke|grant)\b/.test(x)), [
    'revoke all on function public.sz_rules() from public, anon, authenticated',
    'grant execute on function public.sz_rules() to anon, authenticated',
  ]);
  const setupRevoke = SQL.match(/revoke all on function([\s\S]*?)from public, anon, authenticated;/)[1];
  const setupGrant = SQL.match(/grant execute on function([\s\S]*?)to anon, authenticated;/)[1];
  assert.ok(setupRevoke.includes('public.sz_rules()') && setupGrant.includes('public.sz_rules()'), 'as sz-SETUP.sql gives them');
  assert.match(ROUND2, /language sql immutable as \$rules\$/, 'the same kind of function as sz-SETUP.sql makes');
});

test('the SQL holds the limits the rules name', () => {
  const R = core.HABIT_RULES;
  assert.match(SQL, new RegExp("frequency in \\('" + R.frequencies.join("', '") + "'\\)"), 'the frequency check lists the same three');
  assert.match(SQL, new RegExp("category in \\('" + R.categories.join("', '") + "'\\)"), 'the goal categories');
  assert.match(SQL, new RegExp("status in \\('" + R.seasonStatuses.join("', '") + "'\\)"), 'the season statuses');
  assert.match(SQL, new RegExp('n between ' + R.limits.nMin + ' and ' + R.limits.nMax), 'N between nMin and nMax');
  assert.match(SQL, new RegExp('char_length\\(text\\) between 1 and ' + R.limits.habitTextMax), 'a habit name');
  assert.match(SQL, new RegExp('char_length\\(name\\) between 1 and ' + R.limits.nameMax), 'a member name');
});

test('sz-ROUND3.sql replaces sz_habit_add and adds sz_import_local, and nothing else', () => {
  const code = ROUND3.replace(/--[^\n]*/g, '');
  assert.deepEqual([...code.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]), ['sz_habit_add', 'sz_import_local']);
  assert.ok(!/\b(drop|truncate|alter|create\s+(table|index|trigger|policy))\b/i.test(code), 'no table, column or trigger changes');
  assert.ok(!/\bdelete\b/i.test(code), 'it deletes nothing');
  const stmts = code.split(';').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  assert.deepEqual(stmts.filter((x) => /^(revoke|grant)\b/.test(x)), [
    'revoke all on function public.sz_habit_add(text, text, int, boolean), public.sz_import_local(jsonb) from public, anon, authenticated',
    'grant execute on function public.sz_habit_add(text, text, int, boolean), public.sz_import_local(jsonb) to anon, authenticated',
  ]);
  assert.equal(ROUND3.match(HABIT_ADD_RE)[0], SQL.match(HABIT_ADD_RE)[0], 'sz_habit_add is word for word the one sz-SETUP.sql carries');
  assert.ok(!/no_member/.test(SQL.match(HABIT_ADD_RE)[0]), 'and it asks no name first');
  assert.match(ROUND3, new RegExp('v_d < v_today - ' + core.IMPORT_DAYS + ' '), 'the same window as IMPORT_DAYS');
  assert.match(ROUND3, new RegExp("'\\[\\]'::jsonb\\)\\) > " + (core.IMPORT_DAYS + 1) + ' '), 'at most a tap a day in the window');
  assert.match(ROUND3, /pg_advisory_xact_lock\(hashtext\('sz_habits:' \|\| u::text\)\)/, 'the same lock sz_habits_cap takes');
});

test('the fake answers to exactly the doors the SQL grants', () => {
  const grant = SQL.match(/grant execute on function([\s\S]*?)to anon, authenticated;/);
  assert.ok(grant, 'sz-SETUP.sql grants the reader doors');
  const grant3 = ROUND3.match(/grant execute on function([\s\S]*?)to anon, authenticated;/);
  const granted = [...new Set([...grant[1].matchAll(/public\.(sz_\w+)\(/g), ...grant3[1].matchAll(/public\.(sz_\w+)\(/g)].map((m) => m[1]))].sort();
  const fake = Object.getOwnPropertyNames(FakeHabits.prototype).filter((n) => /^sz_/.test(n)).sort();
  assert.deepEqual(fake, granted);
  /* every function the file makes is either a door or revoked */
  const made = [...SQL.matchAll(/create or replace function public\.(sz_\w+)\(/g)].map((m) => m[1]);
  const revoked = SQL.match(/revoke all on function([\s\S]*?)from public, anon, authenticated;/)[1];
  for (const fn of made) assert.ok(revoked.includes('public.' + fn + '('), fn + ' is revoked before the grants');
  /* the phone answers a subset of them itself */
  for (const fn of LOCAL_DOORS) assert.ok(granted.includes(fn), fn + ' is a server door too');
});

/* ---------------------------------------------------------------- days */
test('dayKey is the Burlington date: midnight New York, not UTC', () => {
  assert.equal(core.dayKey(Date.parse('2026-10-17T03:59:59Z')), '2026-10-16', '11:59 pm EDT is still the 16th');
  assert.equal(core.dayKey(Date.parse('2026-10-17T04:00:00Z')), '2026-10-17', 'midnight EDT is the 17th');
  assert.equal(core.dayKey(Date.parse('2026-12-01T04:59:59Z')), '2026-11-30', 'in winter (EST) the day turns at 5 am UTC');
  assert.equal(core.dayKey(Date.parse('2026-12-01T05:00:00Z')), '2026-12-01');
  /* spring forward, 2026-03-08: midnight is still EST */
  assert.equal(core.dayKey(Date.parse('2026-03-08T04:59:59Z')), '2026-03-07');
  assert.equal(core.dayKey(Date.parse('2026-03-08T05:00:00Z')), '2026-03-08');
  assert.equal(core.dayKey(Date.parse('2026-03-09T03:59:59Z')), '2026-03-08', 'the 8th is 23 hours long');
  assert.equal(core.dayKey(Date.parse('2026-03-09T04:00:00Z')), '2026-03-09');
  /* fall back, 2026-11-01: midnight is still EDT, the next is EST */
  assert.equal(core.dayKey(Date.parse('2026-11-01T03:59:59Z')), '2026-10-31');
  assert.equal(core.dayKey(Date.parse('2026-11-01T04:00:00Z')), '2026-11-01');
  assert.equal(core.dayKey(Date.parse('2026-11-02T04:59:59Z')), '2026-11-01', 'the 1st is 25 hours long');
  assert.equal(core.dayKey(Date.parse('2026-11-02T05:00:00Z')), '2026-11-02');
});

test('midnight, the next midnight, and days until', () => {
  assert.equal(new Date(core.midnightOf('2026-10-17')).toISOString(), '2026-10-17T04:00:00.000Z');
  assert.equal(new Date(core.midnightOf('2026-03-08')).toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(new Date(core.midnightOf('2026-03-09')).toISOString(), '2026-03-09T04:00:00.000Z');
  assert.equal(new Date(core.midnightOf('2026-11-01')).toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(new Date(core.midnightOf('2026-11-02')).toISOString(), '2026-11-02T05:00:00.000Z');
  assert.equal(new Date(core.nextMidnight(Date.parse('2026-11-01T23:30:00Z'))).toISOString(), '2026-11-02T05:00:00.000Z', 'from 7:30 pm on the long day');
  assert.equal(new Date(core.nextMidnight(Date.parse('2026-11-02T04:59:59Z'))).toISOString(), '2026-11-02T05:00:00.000Z', 'a second before it');
  assert.equal(new Date(core.nextMidnight(Date.parse('2026-03-08T06:00:00Z'))).toISOString(), '2026-03-09T04:00:00.000Z');
  assert.equal(core.daysUntil(ny('2026-10-18 09:00'), ny('2026-10-17 23:00')), 1, 'tomorrow morning is one day away at 11 pm');
  assert.equal(core.daysUntil(ny('2026-11-09 18:00'), ny('2026-10-17 08:00')), 23);
  assert.equal(core.daysUntil(ny('2026-10-17 18:00'), ny('2026-10-17 08:00')), 0, 'today is zero');
  assert.equal(core.dow('2026-10-12'), 0, 'Monday is 0');
  assert.equal(core.dow('2026-10-18'), 6, 'Sunday is 6');
  assert.equal(core.weekStart('2026-10-18'), '2026-10-12');
  assert.equal(core.weekStart('2026-11-02'), '2026-11-02');
  assert.equal(core.addDays('2026-03-07', 2), '2026-03-09', 'adding days never trips on a clock change');
  assert.equal(core.addDays('2026-11-01', -1), '2026-10-31');
  assert.ok(core.isKey('2026-02-28') && !core.isKey('2026-02-30') && !core.isKey('26-2-1'));
});

/* -------------------------------------------------------------- streaks */
test('a daily streak counts back from today if tapped, else from yesterday', () => {
  const wed = ny('2026-10-14 15:00');
  assert.equal(core.streak(DAILY, [], wed), 0);
  assert.equal(core.streak(DAILY, ['2026-10-12', '2026-10-13'], wed), 2, 'today untapped: from yesterday');
  assert.equal(core.streak(DAILY, ['2026-10-12', '2026-10-13', '2026-10-14'], wed), 3, 'tapped today: from today');
  assert.equal(core.streak(DAILY, ['2026-10-11', '2026-10-12'], wed), 0, 'yesterday missed: broken');
  assert.equal(core.streak(DAILY, new Set(['2026-10-13', '2026-10-15']), wed), 1, 'a tap dated after today is ignored');
  assert.equal(core.streak(DAILY, ['2026-10-14', '2026-10-12'], wed), 1, 'a gap stops the count');
});

test('today untapped does not break a daily streak until midnight New York', () => {
  const taps = ['2026-10-12', '2026-10-13'];
  assert.equal(core.streak(DAILY, taps, ny('2026-10-14 23:59')), 2, '11:59 pm: still 2');
  assert.equal(core.streak(DAILY, taps, Date.parse('2026-10-15T03:59:59Z')), 2, 'which is 3:59 am UTC the next day: still 2');
  assert.equal(core.streak(DAILY, taps, Date.parse('2026-10-15T04:00:01Z')), 0, 'past midnight New York: broken');
  assert.equal(core.streak(DAILY, ['2026-10-14'], Date.parse('2026-10-15T02:00:00Z')), 1, '10 pm New York on the 14th: a tap on the 14th is today’s');
});

test('daily streaks run straight through both daylight-saving changes', () => {
  assert.equal(core.streak(DAILY, days('2026-10-28', '2026-11-02'), ny('2026-11-02 12:00')), 6, 'across the 25-hour day');
  assert.equal(core.streak(DAILY, days('2026-10-28', '2026-11-01'), Date.parse('2026-11-02T04:30:00Z')), 5, '11:30 pm EST on the long day, tapped');
  assert.equal(core.streak(DAILY, days('2026-03-05', '2026-03-09'), ny('2026-03-09 07:00')), 5, 'across the 23-hour day');
  assert.equal(core.streak(DAILY, days('2026-03-05', '2026-03-08'), Date.parse('2026-03-09T03:30:00Z')), 4, '11:30 pm EDT on the short day');
});

test('a weekdays streak skips Saturday and Sunday, never breaks on them', () => {
  const mon = ny('2026-10-12 10:00');
  assert.equal(core.streak(WEEKDAYS, ['2026-10-08', '2026-10-09'], mon), 2, 'Monday morning, untapped: Thursday and Friday');
  assert.equal(core.streak(WEEKDAYS, ['2026-10-08', '2026-10-09', '2026-10-12'], mon), 3, 'tapped Monday');
  assert.equal(core.streak(WEEKDAYS, ['2026-10-08', '2026-10-12'], mon), 1, 'Friday missed: broken');
  assert.equal(core.streak(WEEKDAYS, ['2026-10-08', '2026-10-09'], ny('2026-10-10 18:00')), 2, 'Saturday, untapped: still 2');
  assert.equal(core.streak(WEEKDAYS, ['2026-10-08', '2026-10-09'], ny('2026-10-11 23:00')), 2, 'Sunday night: still 2');
  assert.equal(core.streak(WEEKDAYS, ['2026-10-09', '2026-10-10'], ny('2026-10-11 10:00')), 2, 'a Saturday tap counts');
  assert.equal(core.streak(WEEKDAYS, days('2026-09-28', '2026-10-09').filter((d) => !core.isWeekend(d)), mon), 10, 'two whole weeks');
});

test('an N-a-week streak counts on-target weeks, Monday to Sunday', () => {
  const lastTwo = ['2026-09-28', '2026-09-30', '2026-10-02', '2026-10-05', '2026-10-07', '2026-10-11'];
  assert.equal(core.streak(THREE, lastTwo, ny('2026-10-12 09:00')), 2, 'Monday of a new week: two weeks on target, this one not yet');
  assert.equal(core.streak(THREE, [...lastTwo, '2026-10-12'], ny('2026-10-14 12:00')), 2, 'one tap so far this week: it can still reach three, so nothing breaks');
  assert.equal(core.streak(THREE, [...lastTwo, '2026-10-12', '2026-10-13', '2026-10-14'], ny('2026-10-14 12:00')), 3, 'three taps: this week counts');
  assert.equal(core.streak(THREE, [...lastTwo, '2026-10-12', '2026-10-16'], ny('2026-10-18 09:00')), 2, 'Sunday with two and today open: still reachable');
  assert.equal(core.streak(THREE, [...lastTwo, '2026-10-12'], ny('2026-10-18 09:00')), 0, 'Sunday with one: it cannot reach three, broken');
  assert.equal(core.streak(THREE, [...lastTwo, '2026-10-12'], ny('2026-10-17 20:00')), 2, 'Saturday with one: Saturday and Sunday still make three');
  assert.equal(core.streak(THREE, ['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-13', '2026-10-14'], ny('2026-10-14 12:00')), 1, 'last week had two: only this week');
  assert.equal(core.streak({ frequency: 'n_per_week', n: 1 }, ['2026-10-01', '2026-10-06'], ny('2026-10-12 12:00')), 2, 'once a week: two weeks, this one open');
  assert.equal(core.streak({ frequency: 'n_per_week', n: 1 }, ['2026-10-01', '2026-10-06'], ny('2026-10-19 12:00')), 0, 'a whole week with none between: broken');
  assert.equal(core.streak(THREE, ['2026-10-26', '2026-10-28', '2026-11-01', '2026-11-02'], ny('2026-11-02 12:00')), 1, 'the week of the clock change is a normal week');
  assert.equal(core.streakUnit(THREE, 1), 'week');
  assert.equal(core.streakUnit(DAILY, 2), 'days');
});

/* ----------------------------------------------------------------- dots */
test('this week as seven dots: done, missed, off, today, later', () => {
  const wed = ny('2026-10-14 15:00');
  const st = (h, taps, now) => core.weekDots(h, taps, now).map((d) => d.state).join(' ');
  assert.equal(st(DAILY, ['2026-10-12'], wed), 'done missed today later later later later');
  assert.equal(st(DAILY, ['2026-10-12', '2026-10-14'], wed), 'done missed done later later later later');
  assert.equal(core.weekDots(DAILY, [], wed)[0].key, '2026-10-12', 'the week starts Monday');
  const sun = ny('2026-10-18 10:00');
  assert.equal(st(WEEKDAYS, ['2026-10-12', '2026-10-13', '2026-10-15', '2026-10-16'], sun), 'done done missed done done off today', 'a weekend is off, not missed');
  assert.equal(st(WEEKDAYS, ['2026-10-17'], sun), 'missed missed missed missed missed done today', 'a weekend tap is done');
  assert.equal(st(THREE, ['2026-10-13'], wed), 'off done today later later later later', 'an N-a-week habit has no set days: an untapped day is off');
  assert.equal(st(DAILY, ['2026-10-19'], ny('2026-10-19 00:00')), 'done later later later later later later', 'at midnight a new week starts');
});

/* --------------------------------------------------------------- checks */
test('checkHabit and checkMe agree with the SQL', () => {
  const R = core.HABIT_RULES;
  const H = [
    [{ text: '  ', frequency: 'daily' }, 'bad_text'],
    [{ text: 'h'.repeat(61), frequency: 'daily' }, 'bad_text'],
    [{ text: 'https://x.example', frequency: 'daily' }, 'bad_text'],
    [{ text: 'Stretch', frequency: 'hourly' }, 'bad_frequency'],
    [{ text: 'Stretch' }, 'bad_frequency'],
    [{ text: 'Stretch', frequency: 'n_per_week' }, 'bad_n'],
    [{ text: 'Stretch', frequency: 'n_per_week', n: 0 }, 'bad_n'],
    [{ text: 'Stretch', frequency: 'n_per_week', n: 7 }, 'bad_n'],
    [{ text: 'Stretch', frequency: 'n_per_week', n: 2.5 }, 'bad_n'],
  ];
  for (const [input, want] of H) assert.equal(core.checkHabit(R, input).error, want, JSON.stringify(input));
  assert.deepEqual(core.checkHabit(R, { text: ' Stretch  https://x.example now ', frequency: 'weekdays', n: 4, shared: 1 }).habit,
    { text: 'Stretch now', frequency: 'weekdays', n: null, shared: true });
  const M = [
    [{ name: '  ', phone: '802-555-0199' }, 'bad_name'],
    [{ name: 'dana@example.com', phone: '802-555-0199' }, 'bad_name'],
    [{ name: 'd'.repeat(33), phone: '802-555-0199' }, 'bad_name'],
    [{ name: 'Dana', phone: 'call me' }, 'bad_phone'],
    [{ name: 'Dana', phone: '555-01' }, 'bad_phone'],
    [{ name: 'Dana', phone: '+1 (802) 555-0199 0000' }, 'bad_phone'],
  ];
  for (const [input, want] of M) assert.equal(core.checkMe(R, input).error, want, JSON.stringify(input));
  assert.deepEqual(core.checkMe(R, { name: '  Dana   R. ', phone: '+1 (802) 555-0199' }).me, { name: 'Dana R.', phone: '+1 (802) 555-0199' });
  assert.equal(core.clean('a\u0001b\tc\n d'), 'ab c d', 'control characters go, spaces squeeze, as sz_clean does');
  assert.ok(Object.keys(core.HABIT_RULES).length && core.message('too_many_habits') !== core.message('nope'));
});

/* ------------------------------------------------------- the fake, as SQL */
const DANA = 'dana', MAYA = 'maya', SAM = 'sam', KIM = 'kim';
const code = (fn) => { try { fn(); } catch (e) { return e.code || e.message; } return 'no error'; };
function make() {
  let t = ny('2026-10-14 15:00');
  const f = new FakeHabits({ now: () => t });
  f.tick = (ms) => { t += ms; };
  /* a small seed: Maya and Sam in pod a, Kim in pod b */
  for (const [u, name, pod] of [[MAYA, 'Maya', 'a'], [SAM, 'Sam', 'a'], [KIM, 'Kim', 'b']]) {
    f.as(u).sz_me_set({ p_name: name, p_phone: '802-555-0100' });
    f.members.get(u).pod = pod;
  }
  f.as(MAYA);
  const read = f.sz_habit_add({ p_text: 'Read twenty pages', p_frequency: 'daily' }).id;
  const walk = f.sz_habit_add({ p_text: 'Walk to work', p_frequency: 'weekdays', p_shared: true }).id;
  f.goals.push({ id: 'g-maya', user_id: MAYA, locked_at: Date.now() });
  const goal = { id: 'h-maya-goal', user_id: MAYA, goal_id: 'g-maya', text: 'Write 300 words', frequency: 'weekdays', n: null, is_goal: true, shared: false, position: 0, archived_at: null, created_at: 0 };
  f.habits.push(goal);
  for (const d of days('2026-10-01', '2026-10-14')) { f.addTap(read, d); f.addTap(walk, d); f.addTap(goal.id, d); }
  f.as(null);
  return { f, read, walk, goal: goal.id };
}

test('the fake: the locks', () => {
  const { f, read } = make();
  f.as(null);
  assert.equal(f.sz_rules().limits.habitsMax, 100);
  for (const [fn, a] of [['sz_me_get'], ['sz_me_set', { p_name: 'Dana', p_phone: '802-555-0199' }], ['sz_habits_get'], ['sz_habit_add', { p_text: 'Stretch', p_frequency: 'daily' }],
    ['sz_tap', { p_habit: read, p_date: '2026-10-14' }], ['sz_taps_get', { p_from: '2026-10-07', p_to: '2026-10-14' }], ['sz_pod_habits', { p_from: '2026-10-07', p_to: '2026-10-14' }], ['sz_delete_me']]) {
    assert.equal(code(() => f.call(fn, a)), 'not_signed_in', fn);
  }
  assert.equal(code(() => f.call('nn_vote')), 'no_function');
  assert.equal(f.sz_season_next(), null, 'no season scheduled: null');
});

test('the fake: a new member, habits, taps', () => {
  const { f } = make();
  f.as(DANA);
  assert.equal(f.sz_me_get(), null);
  assert.deepEqual(f.sz_habits_get(), []);
  assert.equal(code(() => f.sz_me_set({ p_name: 'dana@example.com', p_phone: '802-555-0199' })), 'bad_name');
  assert.deepEqual(f.sz_me_set({ p_name: '  Dana   R. ', p_phone: '+1 (802) 555-0199' }), { name: 'Dana R.', phone: '+1 (802) 555-0199', city: 'burlington', email_opt_out: false });
  assert.equal(code(() => f.sz_habit_add({ p_text: 'Stretch', p_frequency: 'n_per_week', p_n: 7 })), 'bad_n');
  const h1 = f.sz_habit_add({ p_text: 'Stretch https://x.example', p_frequency: 'daily' });
  assert.equal(h1.text, 'Stretch');
  assert.deepEqual([f.sz_habit_add({ p_text: 'Gym', p_frequency: 'n_per_week', p_n: 3, p_shared: true })].map((h) => [h.frequency, h.n, h.shared, h.position]), [['n_per_week', 3, true, 2]]);
  assert.equal(f.sz_habit_add({ p_text: 'Floss', p_frequency: 'weekdays', p_n: 4 }).n, null);
  f.sz_habit_add({ p_text: 'Journal', p_frequency: 'daily' });
  const h5 = f.sz_habit_add({ p_text: 'Water the plants', p_frequency: 'daily' });
  f.sz_habit_set({ p_habit: h5.id, p_position: 1 });
  assert.equal(f.sz_habits_get().map((h) => h.text).join(','), 'Water the plants,Stretch,Gym,Floss,Journal');
  f.sz_habit_set({ p_habit: h1.id, p_position: 99 });
  assert.equal(f.sz_habits_get().map((h) => h.text).join(','), 'Water the plants,Gym,Floss,Journal,Stretch');
  assert.deepEqual(['text', 'frequency', 'n'].map((k) => f.sz_habit_set({ p_habit: h1.id, p_text: 'Stretch for ten minutes', p_frequency: 'n_per_week', p_n: 5 })[k]), ['Stretch for ten minutes', 'n_per_week', 5]);
  assert.equal(code(() => f.sz_habit_set({ p_habit: h1.id, p_n: 9 })), 'bad_n');
  assert.equal(f.sz_habit_set({ p_habit: h1.id, p_frequency: 'daily' }).n, null);
  f.sz_habit_set({ p_habit: h1.id, p_archived: true });
  assert.equal(f.sz_habits_get().length, 4);
  f.sz_habit_add({ p_text: 'Call home', p_frequency: 'n_per_week', p_n: 1 });
  /* no limit a reader meets: a sixth, and on to the abuse ceiling of 100 */
  for (let i = 6; i <= 100; i++) f.sz_habit_add({ p_text: 'Habit ' + i, p_frequency: 'daily' });
  assert.equal(f.sz_habits_get().length, 100, 'a hundred habits of your own');
  assert.equal(code(() => f.sz_habit_add({ p_text: 'One too many', p_frequency: 'daily' })), 'too_many_habits');
  assert.equal(code(() => f.sz_habit_set({ p_habit: h1.id, p_archived: false })), 'too_many_habits');
  assert.equal(code(() => f.sz_tap({ p_habit: h1.id, p_date: '2026-10-14' })), 'not_found', 'an archived habit takes no taps');

  f.sz_tap({ p_habit: h5.id, p_date: '2026-10-14' });
  f.sz_tap({ p_habit: h5.id, p_date: '2026-10-14' });
  assert.equal(f.sz_taps_get({ p_from: '2026-10-14', p_to: '2026-10-14' }).length, 1, 'tapping twice is one tap');
  assert.equal(code(() => f.sz_tap({ p_habit: h5.id, p_date: '2026-10-13' })), 'not_today');
  assert.equal(code(() => f.sz_tap({ p_habit: h5.id, p_date: '2026-10-15' })), 'not_today');
  assert.equal(code(() => f.sz_untap({ p_habit: h5.id, p_date: '2026-10-13' })), 'not_today');
  f.sz_untap({ p_habit: h5.id, p_date: '2026-10-14' });
  assert.deepEqual(f.sz_taps_get({ p_from: '2026-10-13', p_to: '2026-10-14' }), []);
  f.sz_tap({ p_habit: h5.id, p_date: '2026-10-14' });
  assert.equal(code(() => f.sz_taps_get({ p_from: '2026-10-14', p_to: '2026-10-13' })), 'bad_range');
  assert.equal(code(() => f.sz_taps_get({ p_from: '2025-10-08', p_to: '2026-10-14' })), 'bad_range', '371 days');
  assert.deepEqual(f.sz_pod_habits({ p_from: '2026-10-07', p_to: '2026-10-14' }), [], 'no pod, no podmates');

  /* midnight: yesterday's tap is fixed, today is new */
  f.tick(9 * 3600000 + 60000);   // 3 pm + 9 h 1 min = 12:01 am on the 15th
  assert.equal(code(() => f.sz_untap({ p_habit: h5.id, p_date: '2026-10-14' })), 'not_today', 'after midnight New York the 14th is a day gone by');
  assert.equal(f.sz_tap({ p_habit: h5.id, p_date: '2026-10-15' }).tapped, true);
});

test('the fake: privacy, the same cases as the SQL', () => {
  const { f, read, walk, goal } = make();
  f.as(DANA).sz_me_set({ p_name: 'Dana', p_phone: '802-555-0199' });
  assert.equal(code(() => f.sz_habit_set({ p_habit: read, p_text: 'Mine now' })), 'not_found', 'another member’s habit cannot be changed');
  assert.equal(code(() => f.sz_tap({ p_habit: read, p_date: '2026-10-14' })), 'not_found', 'or tapped');
  assert.ok(!JSON.stringify(f.sz_habits_get()).includes('Read twenty'), 'or seen');
  f.as(SAM);
  const pod = f.sz_pod_habits({ p_from: '2026-10-01', p_to: '2026-10-14' });
  assert.deepEqual(pod.map((p) => p.name), ['Maya'], 'Sam sees his podmate');
  assert.deepEqual(pod[0].habits.map((h) => h.text), ['Write 300 words', 'Walk to work'], 'her goal habit and her shared one, never the private one');
  assert.equal(pod[0].habits[1].taps.length, 14, 'with the taps in range');
  assert.ok(!/phone|802-555|Read twenty/.test(JSON.stringify(pod)), 'no phone, no private habit');
  assert.equal(code(() => f.sz_tap({ p_habit: walk, p_date: '2026-10-14' })), 'not_found', 'a podmate cannot tap it');
  f.as(KIM);
  assert.deepEqual(f.sz_pod_habits({ p_from: '2026-10-01', p_to: '2026-10-14' }), [], 'another pod sees nothing');
  f.as(MAYA).sz_habit_set({ p_habit: walk, p_shared: false });
  f.as(SAM);
  assert.deepEqual(f.sz_pod_habits({ p_from: '2026-10-01', p_to: '2026-10-14' })[0].habits.map((h) => h.text), ['Write 300 words'], 'unshared: gone at once');
  f.as(MAYA);
  assert.equal(f.sz_habits_get()[0].is_goal, true, 'the goal habit comes first');
  assert.equal(code(() => f.sz_habit_set({ p_habit: goal, p_archived: true })), 'goal_habit');
  assert.equal(code(() => f.sz_habit_set({ p_habit: goal, p_text: 'Write 100 words' })), 'locked');
  assert.equal(f.sz_habit_set({ p_habit: goal, p_text: 'Write 300 words' }).text, 'Write 300 words', 'the same words are not a change');
  assert.equal(f.sz_habit_set({ p_habit: goal, p_position: 1 }).position, 0, 'the goal habit does not move into the list');
  f.as(DANA);
  assert.deepEqual(f.sz_delete_me(), { deleted: true });
  assert.equal(f.sz_me_get(), null);
  assert.ok(f.members.has(MAYA), 'and nobody else’s');
});

test('the fake: the next season', () => {
  const { f } = make();
  const t = f.now(), iso = (d) => new Date(t + d * 86400000).toISOString();
  f.seasons.push(
    { id: 's1', city: 'burlington', name: 'Season 1', status: 'open', kickoff_at: iso(40), stripe_link: 'https://buy.stripe.com/example' },
    { id: 's2', city: 'burlington', name: 'Season 2', status: 'upcoming', kickoff_at: iso(120) },
    { id: 's0', city: 'burlington', name: 'Season Gone', status: 'done', kickoff_at: iso(-150) },
    { id: 'm0', city: 'montpelier', name: 'Montpelier 0', status: 'open', kickoff_at: iso(10) });
  assert.equal(f.sz_season_next().name, 'Season 1');
  assert.equal(f.sz_season_next().stripe_link, 'https://buy.stripe.com/example');
  assert.equal(f.sz_season_next({ p_city: 'montpelier' }).name, 'Montpelier 0');
  assert.equal(f.sz_season_next({ p_city: 'nowhere' }), null);
});

test('the demo seed: three habits, three weeks of taps, a season to come', () => {
  const f = seedDemo(new FakeHabits({ now: () => ny('2026-10-14 15:00') }), 'me');
  f.as('me');
  const hs = f.sz_habits_get();
  assert.deepEqual(hs.map((h) => h.text), ['Morning walk', 'Read twenty pages', 'Gym']);
  const taps = f.sz_taps_get({ p_from: '2026-09-01', p_to: '2026-10-14' });
  for (const h of hs) {
    const mine = taps.filter((t) => t.habit === h.id).map((t) => t.date);
    for (const r of core.HABIT_RULES.frequencies) assert.ok(r);
    assert.ok(core.streak(h, mine, f.now()) > 0, h.text + ' has a streak');
  }
  assert.equal(core.daysUntil(Date.parse(f.sz_season_next().kickoff_at), f.now()), 23);
});

/* ------------------------------------------ no name wall, and the import */
test('the fake: a signed-in reader adds habits with no name or phone', () => {
  const { f } = make();
  f.as('zoe');
  assert.equal(f.sz_me_get(), null);
  assert.equal(f.sz_habit_add({ p_text: 'Stretch', p_frequency: 'daily' }).text, 'Stretch');
  assert.equal(f.sz_tap({ p_habit: f.sz_habits_get()[0].id, p_date: '2026-10-14' }).tapped, true);
  assert.equal(f.sz_me_get(), null, 'and no member row is made behind their back');
});

test('the fake: sz_import_local, the same cases as the SQL', () => {
  const { f, read } = make();
  const today = '2026-10-14';
  const mayaTaps = () => [...f.taps.values()].filter((t) => t.user === MAYA).length;
  const before = mayaTaps();
  f.as(null);
  assert.equal(code(() => f.call('sz_import_local', { p_habits: [] })), 'not_signed_in');
  /* an account with a habit, even an archived one, has had its import */
  f.as('zoe').sz_habit_add({ p_text: 'Stretch', p_frequency: 'daily' });
  assert.equal(code(() => f.sz_import_local({ p_habits: [{ text: 'Read', frequency: 'daily' }] })), 'already_synced');
  f.as('omar');
  f.sz_habit_set({ p_habit: f.sz_habit_add({ p_text: 'Floss', p_frequency: 'daily' }).id, p_archived: true });
  assert.equal(code(() => f.sz_import_local({ p_habits: [{ text: 'Read', frequency: 'daily' }] })), 'already_synced');
  f.as(MAYA);
  assert.equal(code(() => f.sz_import_local({ p_habits: {} })), 'already_synced', 'refused before the list is even read');

  f.as('ivy');
  const H = (o) => [{ text: 'Read', frequency: 'daily', ...o }];
  const bad = [null, {}, 'habits', [1], [[]], Array.from({ length: 101 }, (_, i) => ({ text: 'Habit ' + i, frequency: 'daily' })),
    H({ id: read, taps: [today] }), H({ habit_id: read }), H({ user_id: MAYA }), H({ source: 'email' }),
    H({ text: '  ' }), H({ text: 'h'.repeat(61) }), H({ text: 42 }), H({ frequency: 'hourly' }), [{ text: 'Read' }],
    H({ frequency: 'n_per_week' }), H({ frequency: 'n_per_week', n: 7 }), H({ frequency: 'n_per_week', n: 2.5 }), H({ frequency: 'n_per_week', n: '3' }),
    H({ shared: 'yes' }), H({ archived: 1 }),
    H({ taps: ['2026-10-15'] }), H({ taps: [core.addDays(today, -401)] }), H({ taps: ['2026-02-30'] }), H({ taps: ['2026-2-3'] }),
    H({ taps: ['yesterday'] }), H({ taps: [20261010] }), H({ taps: today }), H({ taps: Array(402).fill(today) }),
    [{ text: 'Read', frequency: 'daily', taps: [today] }, { text: 'Gym', frequency: 'weekly' }]];
  for (const p of bad) assert.equal(code(() => f.sz_import_local({ p_habits: p })), 'bad_import', JSON.stringify(p).slice(0, 80));
  assert.ok(!f.habits.some((h) => h.user_id === 'ivy'), 'every refusal wrote nothing');
  assert.equal(mayaTaps(), before, 'and Maya’s taps are as they were');

  const walk = [...Array.from({ length: 10 }, (_, d) => core.addDays(today, -d)), today, core.addDays(today, -core.IMPORT_DAYS)];
  const got = f.sz_import_local({ p_habits: [
    { text: '  Morning   walk ', frequency: 'daily', n: null, shared: false, archived: false, taps: walk },
    { text: 'Gym', frequency: 'n_per_week', n: 3, shared: true, taps: [core.addDays(today, -2)] },
    { text: 'Read', frequency: 'weekdays', n: 4 },
    { text: 'Old habit', frequency: 'daily', archived: true, taps: [core.addDays(today, -30)] },
  ] });
  assert.deepEqual(got.map((h) => h.text), ['Morning walk', 'Gym', 'Read'], 'in the phone’s order, the archived one kept out of the list');
  assert.deepEqual([got[1].n, got[1].shared, got[2].n], [3, true, null]);
  assert.equal(f.sz_taps_get({ p_from: core.addDays(today, -370), p_to: today }).length, 12, 'the taps, a doubled date once');
  assert.equal([...f.taps.values()].filter((t) => t.user === 'ivy').length, 13, 'thirteen in all, the archived habit’s and the 400th day’s included');
  assert.equal(core.streak(got[0], f.sz_taps_get({ p_from: core.addDays(today, -370), p_to: today }).filter((t) => t.habit === got[0].id).map((t) => t.date), f.now()), 10, 'the streak comes across');
  assert.equal(code(() => f.sz_import_local({ p_habits: [{ text: 'Again', frequency: 'daily', taps: [today] }] })), 'already_synced', 'a second time: refused');
  assert.equal(code(() => f.sz_import_local({ p_habits: [] })), 'already_synced');
  assert.equal(f.sz_habits_get().length, 3);
});

/* ------------------------------------------------ the phone's own copy */
function phone(start = '2026-10-14 15:00', storage = memoryStorage()) {
  let t = ny(start);
  const p = new LocalHabits({ now: () => t, storage });
  p.at = (s) => { t = ny(s); return p; };
  p.storage = storage;
  return p;
}
/* tap a habit on each of these days, as a reader would: on the day itself */
const tapOn = (p, id, keys) => { for (const k of keys) p.at(k + ' 12:00').call('sz_tap', { p_habit: id, p_date: k }); };
const streakOf = (p, h) => core.streak(h, p.call('sz_taps_get', { p_from: core.addDays(core.dayKey(p.now()), -369), p_to: core.dayKey(p.now()) })
  .filter((t) => t.habit === h.id).map((t) => t.date), p.now());

test('the phone: the same doors and rules as the server, and only the tracker’s', () => {
  const p = phone();
  assert.deepEqual(p.call('sz_habits_get'), []);
  for (const fn of ['sz_me_get', 'sz_me_set', 'sz_delete_me', 'sz_pod_habits', 'sz_import_local', 'sz_season_next']) assert.equal(code(() => p.call(fn, {})), 'not_signed_in', fn);
  assert.equal(code(() => p.call('sz_habit_add', { p_text: 'https://x.example', p_frequency: 'daily' })), 'bad_text');
  assert.equal(code(() => p.call('sz_habit_add', { p_text: 'Gym', p_frequency: 'n_per_week', p_n: 7 })), 'bad_n');
  const h = p.call('sz_habit_add', { p_text: 'Stretch https://x.example', p_frequency: 'daily' });
  assert.equal(h.text, 'Stretch');
  assert.equal(code(() => p.call('sz_tap', { p_habit: h.id, p_date: '2026-10-13' })), 'not_today', 'today only');
  assert.equal(code(() => p.call('sz_tap', { p_habit: h.id, p_date: '2026-10-15' })), 'not_today');
  assert.equal(code(() => p.call('sz_tap', { p_habit: 'nope', p_date: '2026-10-14' })), 'not_found');
  /* 11:59 pm in New York is still the 14th, whatever the phone's own zone */
  p.at('2026-10-14 23:59');
  assert.equal(p.call('sz_tap', { p_habit: h.id, p_date: '2026-10-14' }).tapped, true);
  p.at('2026-10-15 00:01');
  assert.equal(code(() => p.call('sz_untap', { p_habit: h.id, p_date: '2026-10-14' })), 'not_today', 'after midnight New York the 14th is a day gone by');
  for (let i = 2; i <= 100; i++) p.call('sz_habit_add', { p_text: 'Habit ' + i, p_frequency: 'daily' });
  assert.equal(code(() => p.call('sz_habit_add', { p_text: 'One too many', p_frequency: 'daily' })), 'too_many_habits', 'the same hidden ceiling');
});

test('the phone keeps everything across a reload, in one versioned key', () => {
  const store = memoryStorage();
  const p = phone('2026-10-14 09:00', store);
  const a = p.call('sz_habit_add', { p_text: 'Walk', p_frequency: 'daily' });
  const b = p.call('sz_habit_add', { p_text: 'Gym', p_frequency: 'n_per_week', p_n: 3, p_shared: true });
  const c = p.call('sz_habit_add', { p_text: 'Floss', p_frequency: 'weekdays' });
  p.call('sz_tap', { p_habit: a.id, p_date: '2026-10-14' });
  p.call('sz_tap', { p_habit: b.id, p_date: '2026-10-14' });
  p.call('sz_untap', { p_habit: b.id, p_date: '2026-10-14' });
  p.call('sz_tap', { p_habit: b.id, p_date: '2026-10-14' });
  p.call('sz_habit_set', { p_habit: c.id, p_position: 1 });
  p.call('sz_habit_set', { p_habit: a.id, p_archived: true });
  const saved = JSON.parse(store.get());
  assert.equal(saved.v, LOCAL_VERSION);
  assert.equal(LOCAL_KEY, 'allday-habits-local');
  const again = phone('2026-10-14 10:00', store);
  assert.deepEqual(again.call('sz_habits_get').map((h) => [h.text, h.frequency, h.n, h.shared]), [['Floss', 'weekdays', null, false], ['Gym', 'n_per_week', 3, true]], 'the order, how often and sharing');
  assert.deepEqual(again.call('sz_taps_get', { p_from: '2026-10-01', p_to: '2026-10-14' }).map((t) => t.habit).sort(), [a.id, b.id].sort(), 'the taps, an archived habit’s kept');
  again.call('sz_habit_set', { p_habit: a.id, p_archived: false });
  assert.equal(phone('2026-10-14 11:00', store).call('sz_habits_get').at(-1).text, 'Walk', 'Undo comes back at the bottom, after a reload too');
  /* two tabs: each reads the key before it answers */
  const tab1 = phone('2026-10-14 12:00', store), tab2 = phone('2026-10-14 12:00', store);
  tab1.call('sz_habit_add', { p_text: 'From tab one', p_frequency: 'daily' });
  tab2.call('sz_habit_add', { p_text: 'From tab two', p_frequency: 'daily' });
  assert.deepEqual(tab1.call('sz_habits_get').slice(-2).map((h) => h.text), ['From tab one', 'From tab two']);
});

test('the phone: a broken, newer or refused store never loses or overwrites anything', () => {
  for (const raw of ['not json', '[]', '{"v":0,"habits":[]}', '{"v":1}', '{"v":1,"habits":[{"id":"x","text":"","frequency":"daily"}],"taps":{"x":["2026-10-14"]}}']) {
    const p = phone('2026-10-14 12:00', memoryStorage(raw));
    assert.deepEqual(p.call('sz_habits_get'), [], raw);
  }
  const mixed = phone('2026-10-14 12:00', memoryStorage(JSON.stringify({ v: 1, habits: [{ id: 'a', text: 'Walk', frequency: 'daily', position: 1 }, { id: 'b', text: '', frequency: 'daily' }, { id: 'a', text: 'Twin', frequency: 'daily' }],
    taps: { a: ['2026-10-14', '2026-02-30', 'x'], b: ['2026-10-14'], z: ['2026-10-14'] } })));
  assert.deepEqual(mixed.call('sz_habits_get').map((h) => h.text), ['Walk'], 'a bad row is skipped, the good one kept');
  assert.deepEqual(mixed.call('sz_taps_get', { p_from: '2026-10-01', p_to: '2026-10-14' }).map((t) => t.date), ['2026-10-14'], 'and only real dates of known habits');
  /* a copy from a newer version of the app: read as empty, and never written over */
  const newer = JSON.stringify({ v: LOCAL_VERSION + 1, habits: [{ id: 'q', text: 'From the future', frequency: 'daily' }], extra: true });
  const store = memoryStorage(newer);
  const p = phone('2026-10-14 12:00', store);
  assert.deepEqual(p.call('sz_habits_get'), []);
  assert.equal(code(() => p.call('sz_habit_add', { p_text: 'Mine', p_frequency: 'daily' })), 'offline');
  assert.equal(p.has(), false);
  p.clear();
  assert.equal(store.get(), newer, 'untouched');
  /* a phone that refuses to store (private mode, a full disk) keeps them for the visit */
  const refusing = { get: () => { throw new Error('SecurityError'); }, set: () => false, remove: () => {} };
  const safe = { get() { try { return refusing.get(); } catch (e) { return null; } }, set: refusing.set, remove: refusing.remove };
  const q = phone('2026-10-14 12:00', safe);
  assert.equal(q.call('sz_habit_add', { p_text: 'Walk', p_frequency: 'daily' }).text, 'Walk');
});

test('the phone: streaks from its own taps, the same cases as the server’s', () => {
  let p = phone();
  const d = p.call('sz_habit_add', { p_text: 'Daily', p_frequency: 'daily' });
  tapOn(p, d.id, ['2026-10-12', '2026-10-13']);
  assert.equal(streakOf(p.at('2026-10-14 15:00'), d), 2, 'today untapped: from yesterday');
  assert.equal(streakOf(p.at('2026-10-14 23:59'), d), 2, '11:59 pm: still 2');
  tapOn(p, d.id, ['2026-10-14']);
  assert.equal(streakOf(p.at('2026-10-14 15:00'), d), 3, 'tapped today: from today');
  assert.equal(streakOf(p.at('2026-10-16 12:00'), d), 0, 'a day missed: broken');

  p = phone();
  const w = p.call('sz_habit_add', { p_text: 'Weekdays', p_frequency: 'weekdays' });
  tapOn(p, w.id, ['2026-10-08', '2026-10-09']);
  assert.equal(streakOf(p.at('2026-10-11 23:00'), w), 2, 'Sunday night: the weekend skipped, not broken');
  assert.equal(streakOf(p.at('2026-10-12 10:00'), w), 2, 'Monday morning, untapped: Thursday and Friday');
  tapOn(p, w.id, ['2026-10-12']);
  assert.equal(streakOf(p.at('2026-10-12 18:00'), w), 3, 'tapped Monday');

  p = phone();
  const n = p.call('sz_habit_add', { p_text: 'Three a week', p_frequency: 'n_per_week', p_n: 3 });
  tapOn(p, n.id, ['2026-09-28', '2026-09-30', '2026-10-02', '2026-10-05', '2026-10-07', '2026-10-11']);
  assert.equal(streakOf(p.at('2026-10-12 09:00'), n), 2, 'two weeks on target, this one not yet');
  tapOn(p, n.id, ['2026-10-12']);
  assert.equal(streakOf(p.at('2026-10-18 09:00'), n), 0, 'Sunday with one: it cannot reach three, broken');

  p = phone();
  const dst = p.call('sz_habit_add', { p_text: 'Across the clock change', p_frequency: 'daily' });
  tapOn(p, dst.id, days('2026-10-28', '2026-11-02'));
  assert.equal(streakOf(p.at('2026-11-02 12:00'), dst), 6, 'across the 25-hour day');
  assert.deepEqual(core.weekDots(dst, p.call('sz_taps_get', { p_from: '2026-10-26', p_to: '2026-11-02' }).map((t) => t.date), p.now()).map((x) => x.state).join(' '),
    'done later later later later later later', 'and the seven dots, a new week');
});

test('the phone keeps 400 days of taps, and hands them over with no id', () => {
  const store = memoryStorage();
  const p = phone('2025-09-01 12:00', store);
  const old = p.call('sz_habit_add', { p_text: 'Old', p_frequency: 'daily' });
  p.call('sz_tap', { p_habit: old.id, p_date: '2025-09-01' });
  const a = p.at('2026-10-14 12:00').call('sz_habit_add', { p_text: 'Walk', p_frequency: 'daily', p_shared: true });
  tapOn(p, a.id, ['2026-10-13', '2026-10-14']);
  assert.ok(!store.get().includes('2025-09-01'), 'a tap more than 400 days old is let go on the next write');
  const b = p.call('sz_habit_add', { p_text: 'Gym', p_frequency: 'n_per_week', p_n: 2 });
  p.call('sz_habit_set', { p_habit: b.id, p_position: 1 });
  p.call('sz_habit_set', { p_habit: old.id, p_archived: true });
  const list = p.toImport();
  assert.deepEqual(list.map((h) => h.text), ['Gym', 'Walk', 'Old'], 'your order, then the archived');
  assert.deepEqual(list[1], { text: 'Walk', frequency: 'daily', n: null, shared: true, archived: false, taps: ['2026-10-13', '2026-10-14'] });
  assert.ok(!/"id"|this-phone|user/.test(JSON.stringify(list)), 'nothing names this phone or a habit id');
  /* and the account takes exactly that list */
  const f = new FakeHabits({ now: () => ny('2026-10-14 13:00') }).as('new-reader');
  f.sz_import_local({ p_habits: list });
  const got = f.sz_habits_get();
  assert.deepEqual(got.map((h) => h.text), ['Gym', 'Walk']);
  const taps = f.sz_taps_get({ p_from: '2026-10-01', p_to: '2026-10-14' }).filter((t) => t.habit === got[1].id).map((t) => t.date);
  assert.equal(core.streak(got[1], taps, f.now()), 2, 'the streak is the same on the account');
  assert.equal(p.has(), true);
  p.clear();
  assert.equal(p.has(), false);
  assert.equal(store.get(), null, 'cleared: the key is gone');
  assert.deepEqual(phone('2026-10-14 14:00', store).call('sz_habits_get'), [], 'and the phone’s list is empty');
});

test('the phone: at most habitsMax go to the account, yours before the archived', () => {
  const p = phone();
  for (let i = 1; i <= 100; i++) p.call('sz_habit_add', { p_text: 'Habit ' + i, p_frequency: 'daily' });
  const first = p.call('sz_habits_get')[0];
  p.call('sz_habit_set', { p_habit: first.id, p_archived: true });
  p.call('sz_habit_add', { p_text: 'Habit 101', p_frequency: 'daily' });
  const list = p.toImport();
  assert.equal(list.length, 100);
  assert.ok(list.every((h) => !h.archived) && list.at(-1).text === 'Habit 101');
});
