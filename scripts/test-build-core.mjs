// The Build's data layer: the shift clock, the API, the fake server and the
// phone's own copy.
//
//   node --test scripts/test-build-core.mjs
//   node scripts/test-build-core.mjs --write-sql   (copy BUILD_RULES into bd-SETUP.sql)
//
// Three copies of one set of rules must agree: all-day/js/build-core.js,
// bd_rules() and the checks in all-day/supabase/bd-SETUP.sql, and the fake
// in all-day/js/build-fake.js. This file checks the first two are the same
// JSON, that the fake answers exactly the doors the SQL grants, runs the
// whistle with a fake clock, and runs the API end to end on the fake (the
// cases scripts/test-bd-sql.sql runs against a real Postgres).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as core from '../all-day/js/build-core.js';
import { FakeBuild, seedDemo, checkImport } from '../all-day/js/build-fake.js';
import { LocalBuild, openBuild, LOCAL_KEY } from '../all-day/js/build-local.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_PATH = path.join(ROOT, 'all-day/supabase/bd-SETUP.sql');
const RULES_RE = /\$json\$([\s\S]*?)\$json\$/;
if (process.argv.includes('--write-sql')) {
  const sql = readFileSync(SQL_PATH, 'utf8');
  writeFileSync(SQL_PATH, sql.replace(RULES_RE, () => '$json$' + JSON.stringify(core.BUILD_RULES) + '$json$'));
  console.log('bd_rules() in bd-SETUP.sql now matches build-core.js BUILD_RULES');
  process.exit(0);
}
const SQL = existsSync(SQL_PATH) ? readFileSync(SQL_PATH, 'utf8') : '';
const { BUILD_RULES: R, SHIFT, memoryStorage } = core;
const MIN = 60000;
const T0 = Date.parse('2026-10-21T18:00:00Z');   // 2 pm in Burlington, a Wednesday

/* a clock a test can move, and chance it can pin */
function clock(t = T0) { const c = { t, now: () => c.t, go: (ms) => { c.t += ms; return c.t; } }; return c; }
const fixed = (r) => () => r;

/* ------------------------------------------------------------ one copy */
test('bd_rules() in bd-SETUP.sql is exactly BUILD_RULES', () => {
  const m = SQL.match(RULES_RE);
  assert.ok(m, 'bd-SETUP.sql has a $json$ rules block');
  assert.deepEqual(JSON.parse(m[1]), R, 'run: node scripts/test-build-core.mjs --write-sql');
});
test('data/build-config.json is exactly BUILD_CONFIG', () => {
  assert.deepEqual(JSON.parse(readFileSync(path.join(ROOT, 'all-day/data/build-config.json'), 'utf8')), core.BUILD_CONFIG);
});
test('the fake answers exactly the bd_ doors the SQL grants to the app', () => {
  const g = SQL.match(/grant execute on function([\s\S]*?)to anon, authenticated;/);
  assert.ok(g, 'one grant block');
  const granted = [...g[1].matchAll(/public\.(bd_\w+)\(/g)].map((x) => x[1]).sort();
  const fake = Object.getOwnPropertyNames(FakeBuild.prototype).filter((n) => /^bd_/.test(n)).sort();
  assert.deepEqual(fake, granted);
  for (const d of [...core.LOCAL_DOORS, ...core.PUBLIC_DOORS]) assert.ok(granted.includes(d), d + ' is granted');
});
test('every refusal code the SQL raises has a sentence', () => {
  const codes = new Set([...SQL.matchAll(/raise exception '([a-z_]+)'/g)].map((m) => m[1]));
  for (const c of codes) assert.notEqual(core.message(c), core.message('__nope__'), c + ' has its own message');
});

/* ---------------------------------------------------------- the whistle */
test('the whistle blows between 15 and 30 minutes after the last touch', () => {
  assert.equal(core.whistleGap(fixed(0)), 15 * MIN);
  assert.equal(core.whistleGap(fixed(0.9999999)), 30 * MIN);
  for (let i = 0; i < 200; i++) { const g = core.whistleGap(Math.random); assert.ok(g >= 15 * MIN && g <= 30 * MIN); }
  const r = core.newShift({ id: 'a', now: T0, random: fixed(0.5) });
  assert.equal(r.whistle_at - T0, 15 * MIN + Math.floor(0.5 * (15 * MIN + 1)));
});

test('a shift answered every time banks every minute, including the wait for the whistle', () => {
  const c = clock();
  let r = core.newShift({ id: 'a', now: c.t, random: fixed(0) });   // whistle at 15:00
  for (let m = 1; m <= 15; m++) r = core.beatShift(r, c.go(MIN));
  assert.equal(core.shiftStatus(r, c.t).state, 'whistle');
  r = core.beatShift(r, c.go(MIN));                                  // 16:00, whistle blowing
  assert.equal(core.shiftStatus(r, c.t).minutes, 15, 'while it blows, unanswered minutes wait');
  r = core.touchShift(r, c.go(MIN), fixed(0));                       // answered at 17:00
  const s = core.shiftStatus(r, c.t);
  assert.equal(s.state, 'working');
  assert.equal(s.minutes, 17);
  assert.equal(s.whistles, 1);
  assert.equal(r.whistle_at, c.t + 15 * MIN);
});

test('a missed whistle knocks the crew off and keeps exactly what was there at the last touch', () => {
  const c = clock();
  let r = core.newShift({ id: 'a', now: c.t, random: fixed(0) });
  for (let m = 0; m < 10; m++) r = core.beatShift(r, c.go(MIN));
  r = core.touchShift(r, c.t, fixed(0));                              // touched at 10:00, next whistle 25:00
  for (let m = 0; m < 18; m++) r = core.beatShift(r, c.go(MIN));     // 28:00: page alive, whistle unanswered
  const s = core.shiftStatus(r, c.t);
  assert.equal(s.state, 'missed');
  assert.equal(s.minutes, 10);
  assert.equal(s.missed_at, T0 + 28 * MIN);
  /* nothing brings it back; ending it banks the ten */
  assert.equal(core.shiftStatus(core.touchShift(r, c.go(MIN), fixed(0)), c.t).state, 'missed');
  assert.equal(core.finishShift(r, c.t, fixed(0)).minutes, 10);
});

test('a page that goes quiet pauses at its last heartbeat; coming back is a touch', () => {
  const c = clock();
  let r = core.newShift({ id: 'a', now: c.t, random: fixed(0) });
  for (let m = 0; m < 6; m++) r = core.beatShift(r, c.go(MIN));     // last beat 6:00
  c.go(60 * MIN);                                                     // an hour of nothing (killed tab)
  let s = core.shiftStatus(r, c.t);
  assert.equal(s.state, 'paused');
  assert.equal(s.minutes, 6);
  r = core.settle(r, c.t);
  r = core.touchShift(r, c.t, fixed(0));
  for (let m = 0; m < 5; m++) r = core.beatShift(r, c.go(MIN));
  s = core.shiftStatus(r, c.t);
  assert.equal(s.state, 'working');
  assert.equal(s.minutes, 11);
});

test('pause() stops the clock at once; unanswered whistle minutes are given back', () => {
  const c = clock();
  let r = core.newShift({ id: 'a', now: c.t, random: fixed(0) });
  for (let m = 0; m < 16; m++) r = core.beatShift(r, c.go(MIN));     // 16:00, whistle blew at 15:00
  r = core.pauseShift(r, c.t);
  assert.equal(core.shiftStatus(r, c.go(30 * MIN)).minutes, 15);
  assert.equal(core.shiftStatus(r, c.t).state, 'paused', 'a paused shift is never missed');
});

test('ending answers a blowing whistle; a shift never banks more than twelve hours', () => {
  const c = clock();
  let r = core.newShift({ id: 'a', now: c.t, random: fixed(0) });
  for (let m = 0; m < 16; m++) r = core.beatShift(r, c.go(MIN));
  assert.equal(core.finishShift(r, c.t, fixed(0)).minutes, 16);
  r = core.newShift({ id: 'b', now: c.t, random: fixed(0) });
  for (let m = 0; m < 800; m++) { r = core.beatShift(r, c.go(MIN)); if (m % 14 === 13) r = core.touchShift(r, c.t, fixed(0)); }
  assert.equal(core.finishShift(r, c.t, fixed(0)).minutes, R.limits.shiftMaxMinutes);
});

test('the builder moves through real jobs as the minutes go by', () => {
  const r = core.newShift({ id: 'a', now: T0, random: fixed(0) });
  const at = (m) => core.shiftStatus({ ...r, beat: T0 + m * MIN, whistle_at: T0 + 999 * MIN }, T0 + m * MIN).task;
  assert.ok(R.tasks.includes(at(0)));
  assert.notEqual(at(0), at(10));
});

/* --------------------------------------------------------------- floors */
test('floors from town minutes and habit drops, the roof last', () => {
  const cfg = core.BUILD_CONFIG;
  assert.deepEqual(core.floorsOf({ total_minutes: 0 }, cfg), { build_minutes: 0, floors: 7, floors_done: 0, floor_progress: 0, topped_out: false });
  const f = core.floorsOf({ total_minutes: 25 * 60 * 2 + 3 * 60, habit_drops: 36 }, cfg);   // 2 floors + 3h, + 36 pallets of 5 min
  assert.equal(f.floors_done, 2);
  assert.equal(f.build_minutes, 3000 + 180 + 180);
  assert.equal(f.floor_progress, 360 / 1500);
  assert.equal(core.floorsOf({ total_minutes: 10 ** 7 }, cfg).topped_out, true);
  assert.equal(core.floorsOf({ total_minutes: 10 ** 7 }, cfg).floor_progress, 1);
});

/* ------------------------------------------------------------ the API */
/* A town on the fake, with you signed in or out, and this phone's copy. */
function rig({ who = 'u-me', c = clock(), fake, offline } = {}) {
  const f = fake || new FakeBuild({ now: c.now });
  let uid = who;
  const store = { local: memoryStorage(), shift: memoryStorage(), outbox: memoryStorage() };
  const make = () => {
    const lb = new LocalBuild({ now: c.now, storage: store.local });
    const local = core.fakeServer(lb, null);
    local.snapshot = () => lb.snapshot(); local.forget = () => lb.forget();
    const srv = core.fakeServer(f, () => uid);
    const server = { state: 'demo', intro: srv.intro, call: (fn, a) => (offline && offline.on ? Promise.resolve({ ok: false, error: 'offline' }) : srv.call(fn, a)) };
    return { api: core.createBuild({ server, local, uid: () => uid, storage: { shift: store.shift, outbox: store.outbox }, now: c.now, random: fixed(0) }), lb };
  };
  const m = make();
  return { f, c, store, api: m.api, lb: m.lb, make, signIn: (id) => { uid = id; }, signOut: () => { uid = null; } };
}
const named = (f, id, first_name = 'Pat', o = {}) => { f.builders.set(id, { hat: 'yellow', vest: 'orange', first_name, first_name_public: true, ...o }); return id; };

test('signed out: thing, shift, Log it, record and builder all work on the phone; the rest asks for sign-in', async () => {
  const { api, c, store } = rig({ who: null });
  assert.equal((await api.thing.get()).thing, null);
  const t = await api.thing.set({ title: '  Fix   my own bike ', why: 'Tired of paying someone.' });
  assert.equal(t.thing.title, 'Fix my own bike');
  assert.equal((await api.thing.set({ title: '' })).error, 'bad_title');
  assert.equal((await api.thing.set({ why: 'x'.repeat(281) })).error, 'bad_why');
  assert.equal((await api.thing.set({ target_date: '2026-02-30' })).error, 'bad_date');
  assert.equal((await api.thing.set({ target_date: '2026-12-01' })).thing.target_date, '2026-12-01');
  assert.equal((await api.thing.set({ target_date: null })).thing.target_date, null, 'null clears the date');
  const st = await api.shift.start('true the back wheel');
  assert.equal(st.shift.step, 'true the back wheel');
  assert.equal(st.shift.thing, t.thing.id);
  assert.equal((await api.shift.start('again')).error, 'shift_running');
  for (let m = 0; m < 14; m++) { c.go(MIN); await api.shift.heartbeat(); }
  const end = await api.shift.end({ note: 'Trued it. Mostly.' });
  assert.equal(end.minutes, 14);
  assert.equal(end.shift.kind, 'shift');
  assert.equal(store.shift.get(), null, 'the running shift is gone from the phone');
  assert.equal((await api.logIt({ minutes: 45, note: 'a run' })).shift.minutes, 45);
  assert.equal((await api.logIt({ minutes: 0 })).error, 'bad_minutes');
  assert.equal((await api.logIt({ minutes: 30, day: core.addDays(core.dayKey(c.t), -8) })).error, 'bad_day');
  const rec = await api.record.get();
  assert.deepEqual(rec.days, [{ day: core.dayKey(c.t), minutes: 59, logged: 45 }]);
  assert.equal(rec.total_minutes, 59);
  assert.equal((await api.builder.set({ hat: 'blue', vest: 'lime', first_name: 'Jo' })).builder.hat, 'blue');
  assert.equal((await api.builder.set({ hat: 'plaid' })).error, 'bad_look');
  assert.equal((await api.builder.set({ first_name: 'jo@x.com' })).error, 'bad_name');
  for (const r of [await api.post.create({ kind: 'progress', line: 'hi' }), await api.nice.toggle('x'), await api.help.offer('x', 'hi'),
    await api.help.list(), await api.report({ post: 'x' }, 'spam'), await api.block.list()]) assert.equal(r.error, 'not_signed_in');
  assert.ok(JSON.parse(store.local.get()).shifts.length === 2, 'kept on the phone');
  assert.equal((await api.shelf.get()).posts.length, 0);
  assert.deepEqual((await api.things.public()).things, [], 'public things come from the (empty) town');
});

test('a shift survives a reload: a new page recovers it from the phone', async () => {
  const r1 = rig({ who: null });
  await r1.api.shift.start('outline chapter 3');
  for (let m = 0; m < 5; m++) { r1.c.go(MIN); await r1.api.shift.heartbeat(); }
  r1.c.go(20 * 1000);
  const page2 = r1.make().api;                                 // same phone, new page
  let s = (await page2.shift.recover()).shift;
  assert.equal(s.state, 'working');
  assert.equal(s.step, 'outline chapter 3');
  r1.c.go(30 * MIN);                                            // and then the page died
  const page3 = r1.make().api;
  s = (await page3.shift.recover()).shift;
  assert.equal(s.state, 'paused');
  assert.equal(s.minutes, 5);
  s = (await page3.shift.resume()).shift;
  assert.equal(s.state, 'working');
  r1.c.go(2 * MIN); await page3.shift.heartbeat();
  assert.equal((await page3.shift.end({})).minutes, 7);
});

test('a missed whistle, recovered after a reload, ends with the minutes up to the last touch', async () => {
  const r = rig({ who: null });
  await r.api.shift.start('');
  for (let m = 0; m < 12; m++) { r.c.go(MIN); await r.api.shift.heartbeat(); }
  await r.api.shift.whistleAnswered();                         // 12:00, next whistle 27:00
  for (let m = 0; m < 16; m++) { r.c.go(MIN); await r.api.shift.heartbeat(); }   // 28:00, still blowing
  for (let m = 0; m < 3; m++) { r.c.go(MIN); await r.api.shift.heartbeat(); }   // 31:00 > 30:00 deadline
  assert.equal(r.api.shift.status().state, 'missed');
  const e = await r.make().api.shift.end({});
  assert.equal(e.minutes, 12);
  assert.equal(e.missed, true);
});

test('Start after the crew knocked off banks the old shift, then clocks in again', async () => {
  const r = rig({ who: null });
  await r.api.shift.start('');
  for (let m = 0; m < 33; m++) { r.c.go(MIN); await r.api.shift.heartbeat(); if (m === 9) await r.api.shift.touch(); }   // touched 10:00, missed 28:00
  assert.equal(r.api.shift.status().state, 'missed');
  const s = await r.api.shift.start('again');
  assert.equal(s.shift.state, 'working');
  assert.equal(s.shift.step, 'again');
  assert.equal((await r.api.record.get()).total_minutes, 10, 'the old shift banked up to its last touch');
  assert.equal((await r.api.shift.start('twice')).error, 'shift_running');
});

test('a shift under a minute is not kept', async () => {
  const r = rig({ who: null });
  await r.api.shift.start('');
  r.c.go(40 * 1000);
  const e = await r.api.shift.end({});
  assert.equal(e.shift, null);
  assert.equal(e.minutes, 0);
  assert.equal((await r.api.record.get()).total_minutes, 0);
});

test('offline: hours wait in the outbox, count on your record, and go once the network is back', async () => {
  const offline = { on: false };
  const r = rig({ offline });
  await r.api.thing.set({ title: 'Write ten songs' });
  offline.on = true;
  await r.api.shift.start('a bridge');
  for (let m = 0; m < 20; m++) { r.c.go(MIN); await r.api.shift.heartbeat(); if (m === 14) await r.api.shift.touch(); }
  const e = await r.api.shift.end({ note: 'the bridge works' });
  assert.equal(e.shift.pending, true);
  assert.equal(e.minutes, 20);
  assert.equal(JSON.parse(r.store.outbox.get()).length, 1);
  assert.equal(r.f.shifts.length, 0);
  offline.on = false;
  const rec = await r.api.record.get();                       // flushes first
  assert.equal(rec.total_minutes, 20);
  assert.equal(r.f.shifts.length, 1);
  assert.equal(r.store.outbox.get(), null);
  /* the same shift sent twice is kept once */
  const s = r.f.shifts[0];
  r.f.as('u-me').bd_shift_add({ p_client_id: s.client_id, p_started: new Date(s.started).toISOString(), p_ended: new Date(s.ended).toISOString(), p_minutes: 20 });
  assert.equal(r.f.shifts.length, 1);
});

test('signed in: presence puts your builder on the site, by public id, and takes it off', async () => {
  const r = rig();
  named(r.f, 'u-me', 'Alex', { first_name_public: false, hat: 'red' });
  await r.api.shift.start('step');
  let town = (await r.api.town.get()).town;
  assert.equal(town.on_shift_count, 1);
  const me = town.on_shift[0];
  assert.deepEqual(me.look, { hat: 'red', vest: 'orange' });
  assert.equal(me.me, true);
  assert.equal(me.name, null, 'first name hidden unless they show it');
  assert.notEqual(me.id, 'u-me', 'never the account id');
  assert.ok(R.tasks.includes(me.task));
  /* anyone else sees the same builder, not marked as theirs */
  const other = r.f.as(null).bd_town({});
  assert.equal(other.on_shift[0].me, false);
  /* three minutes without a heartbeat and it is gone */
  r.c.go(R.limits.staleSeconds * 1000 + 1000);
  assert.equal(r.f.as(null).bd_town({}).on_shift_count, 0);
  r.c.go(-(R.limits.staleSeconds * 1000 + 1000));
  await r.api.shift.end({});
  assert.equal(r.f.as(null).bd_town({}).on_shift_count, 0, 'ending takes you off');
});

test('the town counts the season from its start and the week from Monday', async () => {
  const c = clock();
  const f = new FakeBuild({ now: c.now });
  const today = core.dayKey(c.t);                              // Wednesday 2026-10-21
  f.as('a').bd_log_add({ p_client_id: 'log-00000001', p_minutes: 600, p_day: today });
  f.as('a').bd_log_add({ p_client_id: 'log-00000002', p_minutes: 120, p_day: '2026-10-19' });   // Monday
  f.as('b').bd_log_add({ p_client_id: 'log-00000003', p_minutes: 90, p_day: '2026-10-18' });    // Sunday
  f.habitTaps.push(today, today, '2026-09-01');
  named(f, 'a');
  f.as('a').bd_post_create({ p_kind: 'found', p_line: 'The library lends sewing machines.' });
  let t = f.as(null).bd_town({});
  assert.equal(t.total_minutes, 810);
  assert.equal(t.week_minutes, 720);
  assert.equal(t.habit_drops, 3);
  assert.equal(t.posts_lit, 1);
  t = f.as(null).bd_town({ p_since: '2026-10-19' });
  assert.equal(t.total_minutes, 720);
  assert.equal(t.habit_drops, 2);
  const api = core.createBuild({ server: core.fakeServer(f, () => null), config: { season: { starts: '2026-10-19' } }, now: c.now });
  const town = (await api.town.get()).town;
  assert.equal(town.total_minutes, 720);
  assert.equal(town.build_minutes, 720 + 2 * 5);
  assert.equal(town.windows_lit, 1);
  assert.equal(town.season.starts, '2026-10-19');
  assert.equal(town.season.building, 'watershed');
  assert.equal(town.floors_done, 0);
  assert.equal(town.floors, 7);
});

test('posts: a first name first, the four kinds, Stuck fields only on Stuck, the photo queue, the daily limit', async () => {
  const r = rig();
  await r.api.thing.set({ title: 'Paint the kitchen' });
  assert.equal((await r.api.post.create({ kind: 'progress', line: 'Primed two walls.' })).error, 'no_name');
  await r.api.builder.set({ first_name: 'Alex' });
  assert.equal((await r.api.post.create({ kind: 'brag', line: 'x' })).error, 'bad_kind');
  assert.equal((await r.api.post.create({ kind: 'progress', line: '   ' })).error, 'bad_line');
  assert.equal((await r.api.post.create({ kind: 'progress', line: 'x', stuck_reason: 'unclear' })).error, 'bad_stuck');
  assert.equal((await r.api.post.create({ kind: 'stuck', line: 'x', help_need: 'money' })).error, 'bad_stuck');
  assert.equal((await r.api.post.create({ kind: 'progress', line: 'x', minutes: 0 })).error, 'bad_minutes');
  assert.equal((await r.api.post.create({ kind: 'progress', line: 'x', photo: 'submissions/nope.jpg' })).error, 'bad_photo');
  r.f.addPhoto('submissions/abc-1.jpg', 'pending');
  r.f.addPhoto('submissions/other-1.jpg', 'pending', { spot: 'Photos · Church St' });
  assert.equal((await r.api.post.create({ kind: 'progress', line: 'x', photo: 'submissions/other-1.jpg' })).error, 'bad_photo', 'only a photo filed from All Day');
  await r.api.shift.start('walls');
  for (let m = 0; m < 10; m++) { r.c.go(MIN); await r.api.shift.heartbeat(); }
  const sh = (await r.api.shift.end({})).shift;
  const p = await r.api.post.create({ kind: 'progress', line: 'Primed two walls. https://spam.example', photo: 'submissions/abc-1.jpg', minutes: 10, brief_ok: true, shift: sh.id });
  assert.equal(p.post.line, 'Primed two walls.', 'links are dropped');
  assert.equal(p.post.photo, null, 'the photo shows once the queue approves it');
  assert.equal(p.post.thing, 'Paint the kitchen');
  assert.equal(p.post.author, 'Alex');
  assert.equal(r.f.shifts[0].posted, true);
  r.f.photos.get('submissions/abc-1.jpg').status = 'approved';
  assert.equal((await r.api.feed.list()).posts[0].photo, 'submissions/abc-1.jpg');
  const s = await r.api.post.create({ kind: 'stuck', line: 'Can’t cut in around the ceiling.', stuck_reason: 'missing', help_need: 'hand' });
  assert.equal(s.post.stuck_reason, 'missing');
  for (let i = 0; i < R.limits.postsPerDay - 2; i++) await r.api.post.create({ kind: 'found', line: 'n' + i });
  assert.equal((await r.api.post.create({ kind: 'found', line: 'one more' })).error, 'rate_day');
  assert.equal((await r.api.feed.list({ brief: true })).posts.length, 1);
  assert.equal((await r.api.feed.list({ kind: 'stuck' })).posts.length, 1);
  const shelf = (await r.api.shelf.get()).posts;
  assert.equal(shelf[0].line, 'Primed two walls.', 'the shelf runs oldest first');
  assert.equal(shelf.length, R.limits.postsPerDay);
  r.f.bans.add('u-me');
  r.c.go(86400000);
  assert.equal((await r.api.post.create({ kind: 'found', line: 'x' })).error, 'banned');
});

test('Nice: one tap, again to take it back, never on your own post', async () => {
  const r = rig();
  named(r.f, 'u-me'); named(r.f, 'u-sam', 'Sam');
  const p = r.f.as('u-sam').bd_post_create({ p_kind: 'progress', p_line: 'Ran 9 miles.' });
  assert.deepEqual(await r.api.nice.toggle(p.id), { ok: true, nice: 1, niced: true });
  assert.deepEqual(await r.api.nice.toggle(p.id), { ok: true, nice: 0, niced: false });
  const mine = (await r.api.post.create({ kind: 'progress', line: 'mine' })).post;
  assert.equal((await r.api.nice.toggle(mine.id)).error, 'own_post');
  assert.equal((await r.api.nice.toggle('nope')).error, 'not_found');
});

test('I can help: offer, Yes, one intro email to each side; No thanks sends nothing', async () => {
  const r = rig();
  named(r.f, 'u-me', 'Alex'); named(r.f, 'u-dev', 'Dev'); named(r.f, 'u-kate', 'Kate');
  const stuck = (await r.api.post.create({ kind: 'stuck', line: 'Can’t get the derailleur right.', help_need: 'hand' })).post;
  const prog = (await r.api.post.create({ kind: 'progress', line: 'Tires off.' })).post;
  const dev = core.createBuild({ server: core.fakeServer(r.f, () => 'u-dev'), uid: () => 'u-dev', now: r.c.now });
  assert.equal((await dev.help.offer(prog.id, 'I can')).error, 'not_stuck');
  assert.equal((await dev.help.offer(stuck.id, '')).error, 'bad_help_line');
  const o = await dev.help.offer(stuck.id, 'I’ve got a stand and a Tuesday.');
  assert.equal(o.help.status, 'offered');
  assert.equal((await dev.help.offer(stuck.id, 'again')).error, 'already_offered');
  assert.equal((await r.api.help.offer(stuck.id, 'me')).error, 'own_post');
  const feedMine = (await r.api.feed.list({ kind: 'stuck' })).posts[0];
  assert.equal(feedMine.offers_waiting, 1);
  assert.equal((await dev.feed.list({ kind: 'stuck' })).posts[0].offered, true);
  const inc = (await r.api.help.list()).incoming;
  assert.deepEqual(inc.map((h) => [h.name, h.line, h.status, h.post_line]), [['Dev', 'I’ve got a stand and a Tuesday.', 'offered', 'Can’t get the derailleur right.']]);
  assert.equal((await dev.help.respond(o.help.id, true)).error, 'not_found', 'only the poster answers');
  const yes = await r.api.help.respond(o.help.id, true);
  assert.equal(yes.help.status, 'accepted');
  assert.equal(r.f.intros.length, 1, 'the intro went');
  assert.deepEqual(r.f.intros[0], { help_id: o.help.id, poster: 'u-me', helper: 'u-dev' });
  assert.equal(r.f.sendIntro(o.help.id), false, 'never twice');
  assert.equal((await r.api.help.respond(o.help.id, false)).error, 'already_answered');
  assert.equal((await dev.help.list()).outgoing[0].status, 'accepted');
  assert.equal((await dev.help.list()).outgoing[0].name, 'Alex');
  const kate = core.createBuild({ server: core.fakeServer(r.f, () => 'u-kate'), uid: () => 'u-kate', now: r.c.now });
  const k = await kate.help.offer(stuck.id, 'Me too');
  assert.equal((await r.api.help.respond(k.help.id, false)).help.status, 'declined');
  assert.equal(r.f.intros.length, 1, 'No thanks sends nothing');
  assert.equal((await r.api.help.list()).incoming.length, 1, 'a declined offer leaves your list');
  /* nothing anywhere carries an email or an account id */
  const all = JSON.stringify([await r.api.help.list(), await dev.help.list(), await r.api.feed.list(), r.f.as(null).bd_town({})]);
  assert.ok(!/@|u-me|u-dev|u-kate/.test(all));
});

test('reports: two hide a post; a poster reporting an offer declines it; blocks hide both ways', async () => {
  const r = rig();
  for (const [id, n] of [['u-me', 'Alex'], ['u-a', 'Ann'], ['u-b', 'Bo'], ['u-c', 'Cy']]) named(r.f, id, n);
  const as = (id) => core.createBuild({ server: core.fakeServer(r.f, () => id), uid: () => id, now: r.c.now });
  const bad = r.f.as('u-c').bd_post_create({ p_kind: 'found', p_line: 'buy my stuff' });
  assert.equal((await r.api.report({ post: bad.id }, 'rude')).error, 'bad_reason');
  assert.equal((await r.api.report({}, 'spam')).error, 'bad_target');
  assert.equal((await r.api.report({ post: bad.id }, 'spam')).hidden, false);
  assert.equal((await r.api.report({ post: bad.id }, 'spam')).error, 'already_reported');
  assert.equal((await as('u-a').report({ post: bad.id }, 'spam')).hidden, true);
  assert.equal((await as('u-b').feed.list()).posts.length, 0);
  assert.equal((await as('u-c').report({ post: r.f.as('u-c').bd_post_create({ p_kind: 'found', p_line: 'mine' }).id }, 'spam')).error, 'own_post');

  const stuck = (await r.api.post.create({ kind: 'stuck', line: 'Need a hand.' })).post;
  const creepy = (await as('u-b').help.offer(stuck.id, 'call me')).help;
  assert.equal((await r.api.report({ help: creepy.id }, 'unsafe')).hidden, true);
  assert.equal(r.f.helps.find((h) => h.id === creepy.id).status, 'declined');
  const fine = (await as('u-a').help.offer(stuck.id, 'happy to help')).help;
  assert.ok(fine.id);
  await r.api.block.add({ help: fine.id });
  assert.equal(r.f.helps.find((h) => h.id === fine.id).status, 'declined', 'a block declines what waits');
  assert.equal((await as('u-a').feed.list()).posts.some((p) => p.id === stuck.id), false, 'the blocked no longer see you');
  const annPost = r.f.as('u-a').bd_post_create({ p_kind: 'progress', p_line: 'ann' });
  assert.equal((await r.api.feed.list()).posts.some((p) => p.id === annPost.id), false, 'nor you them');
  assert.equal((await r.api.nice.toggle(annPost.id)).error, 'not_found');
  const blocks = (await r.api.block.list()).blocks;
  assert.deepEqual(blocks.map((b) => b.name), ['Ann']);
  await r.api.block.remove(blocks[0].id);
  assert.equal((await r.api.feed.list()).posts.some((p) => p.id === annPost.id), true);
  assert.equal((await r.api.block.remove('nope')).error, 'not_found');
});

test('public things: only things with a post, why only when shared, a name only when shown', async () => {
  const c = clock();
  const f = new FakeBuild({ now: c.now });
  named(f, 'u-a', 'Ann', { first_name_public: false }); named(f, 'u-b', 'Bo');
  f.as('u-a').bd_thing_set({ p_title: 'Build a canoe', p_why: 'The lake is right there.', p_why_public: true });
  f.as('u-b').bd_thing_set({ p_title: 'Knit a sweater', p_why: 'private reasons' });
  f.as('u-c').bd_thing_set({ p_title: 'No posts yet' });
  f.as('u-a').bd_post_create({ p_kind: 'progress', p_line: 'ribs sanded' });
  c.go(MIN);
  f.as('u-b').bd_post_create({ p_kind: 'stuck', p_line: 'dropped a stitch' });
  const list = f.as(null).bd_public_things({});
  assert.deepEqual(list.map((t) => [t.title, t.why, t.name, t.last_kind, t.last_at]), [
    ['Knit a sweater', null, 'Bo', 'stuck', core.dayKey(c.t)],
    ['Build a canoe', 'The lake is right there.', null, 'progress', core.dayKey(c.t)],
  ]);
  assert.ok(list.every((t) => typeof t.id === 'string'));
  assert.equal(f.as('u-a').bd_public_things({}).length, 1, 'not your own');
  f.as('u-a').bd_thing_status({ p_status: 'done' });
  assert.equal(f.as(null).bd_public_things({}).length, 1, 'a finished thing leaves the door');
});

test('the thing: one at a time, pause, resume, finish, then the next', async () => {
  const r = rig();
  assert.equal((await r.api.thing.finish()).error, 'no_thing');
  await r.api.thing.set({ title: 'One', for_whom: 'my niece', partner: 'Sam' });
  assert.equal((await r.api.thing.pause()).thing.status, 'paused');
  assert.equal((await r.api.thing.get()).thing.status, 'paused');
  assert.equal((await r.api.thing.resume()).thing.status, 'active');
  const done = await r.api.thing.finish();
  assert.equal(done.thing.status, 'done');
  const g = await r.api.thing.get();
  assert.equal(g.thing, null);
  assert.deepEqual(g.done.map((t) => t.title), ['One']);
  assert.equal((await r.api.thing.set({ title: 'Two' })).thing.title, 'Two');
});

test('Log it: a day in the last week, never more than the day had', async () => {
  const r = rig();
  const today = core.dayKey(r.c.t);
  assert.equal((await r.api.logIt({ minutes: 721 })).error, 'bad_minutes');
  assert.equal((await r.api.logIt({ minutes: 60, day: core.addDays(today, 1) })).error, 'bad_day');
  assert.ok((await r.api.logIt({ minutes: 60, day: core.addDays(today, -7) })).ok);
  await r.api.logIt({ minutes: 720 }); await r.api.logIt({ minutes: 700 });
  assert.equal((await r.api.logIt({ minutes: 30 })).error, 'too_much');
  const rec = await r.api.record.get();
  assert.equal(rec.total_minutes, 1480);
  assert.equal(rec.weeks.length, 2);
});

test('sign-in moves the phone’s thing, hours and look to the account once', async () => {
  const r = rig({ who: null });
  await r.api.builder.set({ hat: 'green', first_name: 'Jo' });
  await r.api.thing.set({ title: 'Bake bread that rises', why: 'Sundays' });
  await r.api.logIt({ minutes: 50 });
  await r.api.shift.start('levain');
  for (let m = 0; m < 8; m++) { r.c.go(MIN); await r.api.shift.heartbeat(); }
  await r.api.shift.end({});
  r.signIn('u-jo');
  const moved = await r.api.importLocal();
  assert.equal(moved.moved, true);
  assert.equal(r.f.things[0].title, 'Bake bread that rises');
  assert.equal(r.f.shifts.length, 2);
  assert.ok(r.f.shifts.every((s) => s.thing_id === r.f.things[0].id));
  assert.equal(r.f.builders.get('u-jo').hat, 'green');
  assert.equal(r.store.local.get(), null, 'the phone let go');
  assert.equal((await r.api.record.get()).total_minutes, 58);
  r.signOut();
  await r.api.logIt({ minutes: 5 });
  r.signIn('u-jo');
  assert.equal((await r.api.importLocal()).error, 'already_synced');
  assert.ok(r.lb.has(), 'a refused import leaves the phone its copy');
});

test('checkImport refuses anything out of shape', () => {
  const today = '2026-10-21';
  const ok = { thing: { title: 'T' }, shifts: [{ client_id: 'abcdefgh-1', kind: 'shift', day: today, minutes: 30 }], builder: null };
  assert.ok(checkImport(R, ok, today));
  for (const bad of [null, [], { extra: 1 }, { thing: { title: '' } }, { shifts: [{ client_id: 'x', kind: 'shift', day: today, minutes: 30 }] },
    { shifts: [{ client_id: 'abcdefgh-1', kind: 'nap', day: today, minutes: 30 }] }, { shifts: [{ client_id: 'abcdefgh-1', kind: 'shift', day: '2026-10-22', minutes: 30 }] },
    { shifts: [{ client_id: 'abcdefgh-1', kind: 'logged', day: today, minutes: 721 }] },
    { shifts: [{ client_id: 'abcdefgh-1', kind: 'shift', day: today, minutes: 720 }, { client_id: 'abcdefgh-2', kind: 'shift', day: today, minutes: 721 }] },
    { builder: { hat: 'plaid' } }]) assert.equal(checkImport(R, bad, today), null, JSON.stringify(bad));
});

test('delete my account takes everything of yours, and your reports stop counting', async () => {
  const r = rig();
  named(r.f, 'u-me'); named(r.f, 'u-x', 'X');
  await r.api.thing.set({ title: 'gone' });
  await r.api.logIt({ minutes: 30 });
  const p = (await r.api.post.create({ kind: 'stuck', line: 'gone' })).post;
  r.f.as('u-x').bd_help_offer({ p_post: p.id, p_line: 'hi' });
  const theirs = r.f.as('u-x').bd_post_create({ p_kind: 'found', p_line: 'x' });
  await r.api.report({ post: theirs.id }, 'spam');
  await r.api.shift.start('');
  assert.ok((await r.api.deleteMine()).ok);
  assert.equal(r.f.things.length + r.f.shifts.length + r.f.helps.length, 0);
  assert.equal(r.f.posts.length, 1);
  assert.equal(r.f.posts[0].reports, 0);
  assert.equal(r.f.builders.has('u-me'), false);
  assert.equal(r.f.presence.size, 0);
});

test('the phone’s copy: a newer version is read-only, junk is ignored, a full disk keeps it in memory', () => {
  const s = memoryStorage(JSON.stringify({ v: 99, things: [] }));
  const lb = new LocalBuild({ storage: s });
  assert.throws(() => lb.call('bd_thing_set', { p_title: 'x' }), /offline/);
  assert.equal(JSON.parse(s.get()).v, 99);
  const junk = new LocalBuild({ storage: memoryStorage('{not json') });
  assert.equal(junk.call('bd_thing_get').thing, null);
  const full = { get: () => null, set: () => false, remove: () => false };
  const lb2 = new LocalBuild({ storage: full });
  lb2.call('bd_thing_set', { p_title: 'kept' });
  assert.equal(lb2.call('bd_thing_get').thing.title, 'kept');
  assert.equal(LOCAL_KEY, 'allday-build-local');
});

test('liveServer: PostgREST answers become ok/error codes; a missing function is "off"', async () => {
  const replies = [];
  const fetch = (url, init) => { replies.push([url, init]); return Promise.resolve(next()); };
  let next;
  const resp = (status, body) => ({ ok: status < 300, status, text: () => Promise.resolve(body == null ? '' : JSON.stringify(body)) });
  const srv = core.liveServer({ url: 'https://x.supabase.co', key: 'pk', user: () => ({ id: 'u' }), token: () => Promise.resolve('tok'), fetch });
  next = () => resp(200, { total_minutes: 5 });
  assert.deepEqual(await srv.call('bd_town', {}), { ok: true, data: { total_minutes: 5 } });
  assert.equal(replies[0][0], 'https://x.supabase.co/rest/v1/rpc/bd_town');
  assert.equal(replies[0][1].headers.Authorization, 'Bearer tok');
  next = () => resp(400, { code: 'P0001', message: 'own_post' });
  assert.deepEqual(await srv.call('bd_nice', {}), { ok: false, error: 'own_post' });
  next = () => resp(404, { code: 'PGRST202', message: 'Could not find' });
  assert.deepEqual(await srv.call('bd_town', {}), { ok: false, error: 'off' });
  assert.equal(srv.state, 'off');
  next = () => { throw new Error('down'); };
  assert.deepEqual(await srv.call('bd_town', {}), { ok: false, error: 'offline' });
  next = () => resp(200, {});
  srv.intro('h-1');
  assert.equal(replies.at(-1)[0], 'https://x.supabase.co/functions/v1/bd-intro');
  assert.deepEqual(JSON.parse(replies.at(-1)[1].body), { help_id: 'h-1' });
  const anon = core.liveServer({ url: 'u', key: 'pk', user: () => null, token: () => Promise.resolve(null), fetch });
  next = () => resp(200, []);
  await anon.call('bd_feed', {});
  assert.equal(replies.at(-1)[1].headers.Authorization, undefined);
});

test('the demo: thirty neighbours, six on shift, every kind of post, your Stuck with an offer waiting', async () => {
  const c = clock();
  const f = seedDemo(new FakeBuild({ now: c.now }), 'demo-me');
  assert.ok(f.builders.size >= 30);
  const town = f.as(null).bd_town({});
  assert.equal(town.on_shift_count, 6);
  c.go(3600000);
  assert.equal(f.as(null).bd_town({}).on_shift_count, 6, 'the demo crew never goes stale');
  const kinds = new Set(f.as('demo-me').bd_feed({ p_limit: 60 }).map((p) => p.kind));
  assert.deepEqual([...kinds].sort(), ['finished', 'found', 'progress', 'stuck']);
  const inc = f.as('demo-me').bd_help_list().incoming;
  assert.equal(inc.filter((h) => h.status === 'offered').length, 1);
  assert.ok(f.as('demo-me').bd_feed({ p_kind: 'stuck' }).some((p) => !p.mine && !p.offered), 'a neighbour you could help');
  assert.ok(f.as(null).bd_public_things({}).length >= 4);
  assert.ok(f.as('demo-me').bd_thing_get().thing);
  const api = openBuild({ demo: true, user: () => ({ id: 'demo-0000-4000-8000-00000000me00' }), now: c.now });
  assert.equal((await api.town.get()).town.on_shift_count, 6);
  assert.equal((await api.thing.get()).thing.title, 'Fix up the old Raleigh');
  const out = await openBuild({ demo: true, user: () => null, now: c.now }).thing.get();
  assert.equal(out.thing, null, 'signed out, the demo starts on a fresh phone');
});
