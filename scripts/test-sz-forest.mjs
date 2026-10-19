// The Habits tab's forest: the trees (all-day/js/forest.js), the fake's
// sharing doors (all-day/js/habits-fake.js), and their agreement with
// all-day/supabase/sz-FOREST.sql.
//
//   node --test scripts/test-sz-forest.mjs
//   node scripts/test-sz-forest.mjs --parity-sql > file.sql   (scripts/test-sz-sql.sh runs it)
//
// The parity SQL makes a few hundred habits with random taps on fixed
// "todays" (both daylight-saving changes, every weekday) and checks that
// sz_forest_tree() and sz_forest_seed() give exactly what forest.js and
// habits-core.js give for the same taps. The cases come from a fixed seed,
// so a run is the same every time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as core from '../all-day/js/habits-core.js';
import * as F from '../all-day/js/forest.js';
import { FakeHabits, seedDemo } from '../all-day/js/habits-fake.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FOREST_SQL = readFileSync(path.join(ROOT, 'all-day/supabase/sz-FOREST.sql'), 'utf8');

/* -------------------------------------------------------- parity cases */
function rand(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const TODAYS = ['2026-10-19', '2026-10-21', '2026-10-24', '2026-10-25', '2026-11-01', '2026-11-02', '2026-03-08', '2026-03-09', '2026-12-31', '2027-01-03'];
function cases(n = 360) {
  const R = rand(20261019);
  const out = [];
  for (let i = 0; i < n; i++) {
    const today = TODAYS[i % TODAYS.length];
    const f = ['daily', 'weekdays', 'n_per_week'][i % 3];
    const hn = f === 'n_per_week' ? 1 + Math.floor(R() * 6) : null;
    const span = [5, 30, 120, 400, 420][Math.floor(R() * 5)];
    const p = [0.95, 0.8, 0.5, 0.2, 1][Math.floor(R() * 5)];
    const taps = new Set();
    for (let d = 0; d < span; d++) if (R() < p) taps.add(core.addDays(today, -d));
    if (R() < 0.3) taps.delete(today);
    if (R() < 0.1) taps.clear();
    const id = 'f0' + String(i).padStart(6, '0') + '-0000-4000-8000-' + Math.floor(R() * 0xffffffffffff).toString(16).padStart(12, '0');
    const h = { id, frequency: f, n: hn };
    const set = F.inWindow(taps, today);
    const now = Date.parse(today + 'T16:00:00Z');
    out.push({ h, today, taps: [...taps].sort(), want: { leaves: set.size, streak: set.size ? core.streak(h, set, now) : 0, best: set.size ? core.bestStreak(h, set, now) : 0 } });
  }
  return out;
}

if (process.argv.includes('--parity-sql')) {
  const U = "'5f000000-0000-4000-8000-0000000fa111'";
  const lines = ['\\set ON_ERROR_STOP on', 'set client_min_messages = warning;', 'begin;',
    `insert into auth.users values (${U}, null) on conflict do nothing;`];
  for (const c of cases()) {
    lines.push(`insert into public.sz_habits (id, user_id, text, frequency, n, archived_at) values ('${c.h.id}', ${U}, 'p', '${c.h.frequency}', ${c.h.n == null ? 'null' : c.h.n}, now());`);
    if (c.taps.length) lines.push(`insert into public.sz_taps (habit_id, date) select '${c.h.id}', unnest('{${c.taps.join(',')}}'::date[]);`);
    const want = JSON.stringify(c.want);
    lines.push(`do $$ declare got jsonb := public.sz_forest_tree('${c.h.id}', '${c.today}'); begin if got <> '${want}'::jsonb then raise exception 'parity: % % on % wants % got %', '${c.h.frequency}', '${c.h.id}', '${c.today}', '${want}', got; end if; end $$;`);
    lines.push(`do $$ begin if public.sz_forest_seed('${c.h.id}') <> ${F.seedOf(c.h.id)} then raise exception 'seed parity: ${c.h.id}'; end if; end $$;`);
  }
  lines.push('rollback;');
  /* wait for a pipe to take it all before leaving, and register no tests */
  await new Promise((done) => process.stdout.write(lines.join('\n') + '\n', done));
  process.exit(0);
}

/* ---------------------------------------------------------------- trees */
test('a seed is FNV-1a over the id, unsigned 32 bits', () => {
  assert.equal(F.seedOf(''), 2166136261);
  assert.equal(F.seedOf('a'), 0xe40c292c);   // the published FNV-1a test vector
  assert.equal(F.seedOf('foobar'), 0xbf9cf968);
  assert.ok(F.seedOf('00000000-0000-4000-8000-000000000001') !== F.seedOf('00000000-0000-4000-8000-000000000002'));
});

test('a tree is the same drawing every time, for the same seed, leaves and flowers', () => {
  const s = F.seedOf('5f000000-0000-4000-8000-00000000f001');
  assert.equal(F.tree(s, 42, 1), F.tree(s, 42, 1));
  assert.notEqual(F.tree(s, 42, 1), F.tree(F.seedOf('another'), 42, 1));
});

test('every day the window can hold has its own leaf spot', () => {
  for (let i = 0; i < 400; i++) assert.ok(F.slotsOf(F.seedOf('id-' + i)) >= F.LEAF_DAYS, 'seed ' + i);
});

test('a tree draws exactly one leaf per day done', () => {
  const s = F.seedOf('habit-x');
  const leaves = (svg) => [...svg.matchAll(/class="tr-l\d"[^>]*d="([^"]*)"/g)].map((m) => m[1]).join('').split('Z').filter(Boolean).length;
  for (const n of [0, 1, 2, 7, 30, 119, 120, 121, 369, 370]) assert.equal(leaves(F.tree(s, n, 0)), n, n + ' leaves');
  const fresh = F.tree(s, 10, 0, { fresh: true });
  assert.equal((fresh.match(/tr-new/g) || []).length, 1, 'the newest leaf is marked to grow in');
});

test('flowers: one per streak milestone, in the habit’s own unit', () => {
  assert.equal(F.bloomsOf('daily', 6), 0);
  assert.equal(F.bloomsOf('daily', 7), 1);
  assert.equal(F.bloomsOf('weekdays', 50), 3);
  assert.equal(F.bloomsOf('n_per_week', 4), 2);
  assert.equal(F.bloomsOf('daily', 400), 6);
  assert.equal((F.tree(F.seedOf('f'), 200, 3).match(/class="tr-pet"/g) || []).length, 3);
});

test('leaves are the days done in the 370 that end today, never a future one', () => {
  const today = '2026-10-19';
  const taps = [today, core.addDays(today, -369), core.addDays(today, -370), core.addDays(today, 1), 'nonsense'];
  assert.equal(F.leavesOf(taps, today), 2);
});

test('a label is escaped', () => {
  assert.match(F.tree(1, 0, 0, { label: '<b>"x" & y</b>' }), /aria-label="&lt;b&gt;&quot;x&quot; &amp; y&lt;\/b&gt;"/);
});

test('checkForest refuses what sz_forest_set refuses, in the same order', () => {
  const c = (x) => F.checkForest(x, core.clean);
  assert.equal(c({ name: '' }).error, 'bad_forest_name');
  assert.equal(c({ name: 'https://spam.example' }).error, 'bad_forest_name');
  assert.equal(c({ name: 'me@example.com' }).error, 'bad_forest_name');
  assert.equal(c({ name: 'x'.repeat(33) }).error, 'bad_forest_name');
  assert.equal(c({ name: 'Fern', cohort: 'c'.repeat(33) }).error, 'bad_cohort');
  assert.equal(c({ name: 'Fern', habits: Array.from({ length: 101 }, (_, i) => 'h' + i) }).error, 'bad_forest');
  assert.deepEqual(c({ name: '  Fern  the  Runner ', public: 1, show_names: 0, habits: ['a', 'a', 'b'], cohort: '' }).forest,
    { name: 'Fern the Runner', public: true, show_names: false, habits: ['a', 'b'], cohort: null });
  for (const code of ['bad_forest_name', 'bad_cohort', 'bad_forest']) assert.notEqual(core.message(code), core.message('offline'), code + ' has its own words');
});

/* ------------------------------------------------------ the fake's doors */
test('the fake answers to exactly the forest doors sz-FOREST.sql grants', () => {
  const grant = FOREST_SQL.match(/grant execute on function([\s\S]*?)to anon, authenticated;/)[1];
  const granted = [...new Set([...grant.matchAll(/public\.(sz_\w+)\(/g)].map((m) => m[1]))].filter((n) => n !== 'sz_delete_me').sort();
  const fake = Object.getOwnPropertyNames(FakeHabits.prototype).filter((n) => /^sz_forest/.test(n)).sort();
  assert.deepEqual(fake, granted);
  const made = [...FOREST_SQL.matchAll(/create or replace function public\.(sz_\w+)\(/g)].map((m) => m[1]);
  const revoked = FOREST_SQL.match(/revoke all on function([\s\S]*?)from public, anon, authenticated;/)[1];
  for (const fn of made) assert.ok(revoked.includes('public.' + fn + '('), fn + ' is revoked before the grants');
  for (const internal of ['sz_forest_tree', 'sz_forest_seed', 'sz_forest_json', 'sz_forest_habits_owner']) assert.ok(!grant.includes(internal + '('), internal + ' is not a door');
});

test('sz_delete_me is the same function in sz-SETUP.sql and sz-FOREST.sql', () => {
  const setup = readFileSync(path.join(ROOT, 'all-day/supabase/sz-SETUP.sql'), 'utf8');
  const fn = (sql) => sql.match(/create or replace function public\.sz_delete_me\(\)[\s\S]*?end \$\$;/)[0];
  assert.equal(fn(setup), fn(FOREST_SQL));
});

test('the fake runs the SQL test’s cases (scripts/test-sz-forest.sql)', () => {
  let t = Date.parse('2026-10-19T16:00:00Z');
  const f = new FakeHabits({ now: () => t });
  const fern = 'fern', gus = 'gus';
  const err = (fn) => { try { fn(); } catch (e) { return e.code; } return 'none'; };
  assert.equal(err(() => f.as(null).sz_forest_get()), 'not_signed_in');
  assert.equal(err(() => f.as(null).sz_forest_set({ p_name: 'Fern', p_public: true, p_show_names: true })), 'not_signed_in');
  assert.deepEqual(f.as(null).sz_forests_public({}), []);
  const run = f.as(fern).sz_habit_add({ p_text: 'Run', p_frequency: 'daily' }).id;
  const journal = f.as(fern).sz_habit_add({ p_text: 'Journal', p_frequency: 'weekdays' }).id;
  f.as(fern).sz_habit_add({ p_text: 'Secret habit', p_frequency: 'n_per_week', p_n: 2 });
  for (let d = 0; d <= 9; d++) f.addTap(run, core.addDays('2026-10-19', -d));
  for (let d = 3; d <= 5; d++) f.addTap(journal, core.addDays('2026-10-19', -d));
  assert.equal(f.as(fern).sz_forest_get(), null);
  assert.equal(err(() => f.as(fern).sz_forest_set({ p_name: '', p_public: true, p_show_names: false })), 'bad_forest_name');
  assert.equal(err(() => f.as(fern).sz_forest_set({ p_name: 'fern@example.com', p_public: true, p_show_names: false })), 'bad_forest_name');
  assert.equal(err(() => f.as(fern).sz_forest_set({ p_name: 'Fern', p_public: true, p_show_names: false, p_cohort: 'c'.repeat(33) })), 'bad_cohort');
  assert.equal(err(() => f.as(fern).sz_forest_set({ p_name: 'Fern', p_public: true, p_show_names: false, p_habits: ['nope'] })), 'not_found');
  assert.equal(f.as(fern).sz_forest_get(), null, 'a refused share saves nothing');
  const saved = f.as(fern).sz_forest_set({ p_name: ' Fern   the Runner ', p_public: true, p_show_names: false, p_habits: [run, journal], p_cohort: '' });
  assert.equal(saved.name, 'Fern the Runner');
  assert.equal(saved.cohort, null);
  assert.equal(saved.habits.length, 2);
  const g = f.as(null).sz_forests_public({});
  assert.equal(g.length, 1);
  assert.deepEqual(Object.keys(g[0]).sort(), ['cohort', 'id', 'name', 'show_names', 'trees']);
  assert.deepEqual(Object.keys(g[0].trees[0]).sort(), ['best', 'frequency', 'leaves', 'n', 'name', 'seed', 'streak']);
  assert.deepEqual({ ...g[0].trees[0], seed: 0 }, { seed: 0, name: null, frequency: 'daily', n: null, leaves: 10, streak: 10, best: 10 });
  assert.equal(g[0].trees[0].seed, F.seedOf(run));
  assert.equal(g[0].trees[1].leaves, 3);
  assert.ok(!JSON.stringify(g).includes(run) && !JSON.stringify(g).includes('Secret') && !JSON.stringify(g).includes('fern"'));
  assert.deepEqual(f.as(null).sz_forest_public({ p_id: g[0].id }), g[0]);
  assert.equal(f.as(null).sz_forest_public({ p_id: 'nope' }), null);
  f.as(fern).sz_forest_set({ p_name: 'Fern', p_public: true, p_show_names: true });
  assert.equal(f.as(fern).sz_forest_get().habits.length, 2, 'null keeps the habits');
  assert.equal(f.as(null).sz_forests_public({})[0].trees[0].name, 'Run');
  assert.equal(f.as(gus).sz_forest_get(), null);
  assert.equal(err(() => f.as(gus).sz_forest_set({ p_name: 'Gus', p_public: true, p_show_names: true, p_habits: [run] })), 'not_found');
  const stretch = f.as(gus).sz_habit_add({ p_text: 'Stretch', p_frequency: 'daily' }).id;
  assert.equal(f.as(gus).sz_forest_set({ p_name: 'Gus', p_public: true, p_show_names: false, p_habits: [stretch], p_cohort: 'Season 0' }).cohort, 'Season 0');
  assert.deepEqual(f.as(null).sz_forests_public({}).map((x) => x.name), ['Fern', 'Gus'], 'the one tended most recently first');
  assert.equal(f.as(null).sz_forests_public({ p_limit: 1 }).length, 1);
  f.as(gus).sz_habit_set({ p_habit: stretch, p_archived: true });
  assert.deepEqual(f.as(gus).sz_forest_get().habits, []);
  assert.equal(f.as(null).sz_forests_public({}).length, 1, 'a forest with no trees is not in the gallery');
  assert.equal(f.as(null).sz_forest_public({ p_id: f.forests.get(gus).id }), null, 'nor behind its link');
  f.forests.get(fern).hidden = true;
  assert.deepEqual(f.as(null).sz_forests_public({}), [], 'hidden');
  f.forests.get(fern).hidden = false;
  const id = f.as(fern).sz_forest_get().id;
  f.as(fern).sz_forest_set({ p_name: 'Fern', p_public: false, p_show_names: true });
  assert.deepEqual(f.as(null).sz_forests_public({}), []);
  assert.equal(f.as(null).sz_forest_public({ p_id: id }), null);
  assert.equal(f.as(fern).sz_forest_set({ p_name: 'Fern', p_public: true, p_show_names: true }).id, id, 'the same link again');
  f.as(fern).sz_delete_me();
  assert.ok(!f.forests.has(fern) && f.forests.has(gus));
});

test('the demo has three neighbours’ forests to look at, and none of the reader’s own', () => {
  const f = seedDemo(new FakeHabits(), 'me');
  const g = f.as(null).sz_forests_public({});
  assert.deepEqual(g.map((x) => x.name).sort(), ['Maya', 'Night Owl', 'Theo R.']);
  assert.ok(g.find((x) => x.name === 'Night Owl').trees.every((t) => t.name === null));
  assert.equal(f.as('me').sz_forest_get(), null);
});

test('the fake’s numbers are habits-core’s, on the same window (the SQL parity cases)', () => {
  for (const c of cases(90)) {
    const f = new FakeHabits({ now: () => Date.parse(c.today + 'T16:00:00Z') });
    f.habits.push({ ...c.h, user_id: 'u', goal_id: null, text: 'p', is_goal: false, shared: false, position: 1, archived_at: null, created_at: 0 });
    c.taps.forEach((d) => f.addTap(c.h.id, d));
    assert.deepEqual(f._tree(c.h, c.today), c.want, c.h.frequency + ' ' + c.today);
  }
});
