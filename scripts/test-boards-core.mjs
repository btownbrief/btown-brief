// The boards' pure rules, and the fake backend's mirror of the SQL.
//
//   node --test scripts/test-boards-core.mjs
//   node scripts/test-boards-core.mjs --write-sql   (copy RULES into nn-SETUP.sql)
//
// Three copies of one set of rules must agree: all-day/js/boards-core.js,
// nn_rules() and the checks in all-day/supabase/nn-SETUP.sql, and the fake
// in all-day/js/boards-fake.js. This file checks the first two are the same
// JSON, that the fake answers to the same function names the SQL grants, and
// runs the fake through the same cases scripts/test-nn-sql.sql runs against
// a real Postgres (scripts/test-nn-sql.sh), so a drift shows up here even on
// a machine without one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as core from '../all-day/js/boards-core.js';
import { FakeBoards, seedDemo, DEMO_ME } from '../all-day/js/boards-fake.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_PATH = path.join(ROOT, 'all-day/supabase/nn-SETUP.sql');
const RULES_RE = /\$json\$([\s\S]*?)\$json\$/;

if (process.argv.includes('--write-sql')) {
  const sql = readFileSync(SQL_PATH, 'utf8');
  writeFileSync(SQL_PATH, sql.replace(RULES_RE, () => '$json$' + JSON.stringify(core.RULES) + '$json$'));
  console.log('nn_rules() in nn-SETUP.sql now matches boards-core.js RULES');
  process.exit(0);
}
const SQL = readFileSync(SQL_PATH, 'utf8');

const MAYA = '11111111-1111-1111-1111-111111111111';
const SAM = '22222222-2222-2222-2222-222222222222';
const KIM = '33333333-3333-3333-3333-333333333333';
const LEE = '44444444-4444-4444-4444-444444444444';
const DAY = 86400000;
const code = (fn) => { try { fn(); } catch (e) { return e.code || e.message; } return 'no error'; };
const make = (o) => {
  let t = Date.parse('2026-10-16T12:00:00Z');
  const f = new FakeBoards({ now: () => t, ...o });
  f.tick = (ms) => { t += ms; };
  ['submissions/aaaa-0001.jpg', 'submissions/aaaa-0002.jpg'].forEach((p, i) => f.addPhoto(p, i ? 'approved' : 'pending'));
  f.addPhoto('submissions/aaaa-0003.jpg', 'rejected');
  return f;
};

/* ------------------------------------------------------------- one copy */
test('nn_rules() in the SQL is exactly RULES in boards-core.js', () => {
  const m = SQL.match(RULES_RE);
  assert.ok(m, 'nn-SETUP.sql has a $json$ block');
  assert.deepEqual(JSON.parse(m[1]), core.RULES, 'run: node scripts/test-boards-core.mjs --write-sql');
});

test('the fake answers to every function the SQL grants to readers, and only those', () => {
  const block = SQL.slice(SQL.indexOf('-- Readers, signed in or not'));
  const granted = new Set([...block.matchAll(/public\.(nn_\w+)\(/g)].map((m) => m[1]));
  const fake = new Set(Object.getOwnPropertyNames(FakeBoards.prototype).filter((n) => /^nn_/.test(n)));
  for (const fn of granted) assert.ok(fake.has(fn), fn + ' is granted in SQL but missing from the fake');
  for (const fn of fake) assert.ok(granted.has(fn), fn + ' is in the fake but the SQL does not grant it');
  const defined = new Set([...SQL.matchAll(/create or replace function public\.(nn_\w+)\(/g)].map((m) => m[1]));
  for (const fn of fake) assert.ok(defined.has(fn), fn + ' is not defined in the SQL');
});

/* ---------------------------------------------------------------- rules */
test('clean() drops control characters and links, and squeezes the spaces', () => {
  assert.equal(core.clean('1994 UVM crewneck see https://spam.example now'), '1994 UVM crewneck see now');
  assert.equal(core.clean('Back rack,\n\n\n\nby the boots.  www.spam.example', true), 'Back rack,\n\nby the boots.');
  assert.equal(core.clean('  Maya   R. '), 'Maya R.');
  assert.equal(core.clean('a\u0007b\u001fc\u007f'), 'abc');
  assert.equal(core.clean('line one\r\nline two'), 'line one line two');
  assert.equal(core.clean('line one\r\nline two', true), 'line one\nline two');
  assert.equal(core.clean(null), '');
  assert.equal(core.len('🌅🌅'), 2, 'an emoji is one character, as char_length counts it');
});

test('checkProfile: a first name, no @, a known neighborhood and archetype', () => {
  const R = core.RULES;
  assert.equal(core.checkProfile(R, { display_name: '   ' }).error, 'bad_name');
  assert.equal(core.checkProfile(R, { display_name: 'maya@example.com' }).error, 'bad_name');
  assert.equal(core.checkProfile(R, { display_name: 'm'.repeat(33) }).error, 'bad_name');
  assert.equal(core.checkProfile(R, { display_name: 'Maya', neighborhood: 'mars' }).error, 'bad_neighborhood');
  assert.equal(core.checkProfile(R, { display_name: 'Maya', archetype: 'wizard' }).error, 'bad_archetype');
  assert.deepEqual(core.checkProfile(R, { display_name: ' Maya  R.', neighborhood: '', archetype: 'trail' }).profile,
    { display_name: 'Maya R.', neighborhood: null, archetype: 'trail' });
});

/* The cases test-nn-sql.sql runs for a post, in its order. */
const POST_CASES = [
  ['food', { kind: 'dish', title: 'Pho' }, 'bad_board'],
  ['vintage', { kind: 'review', title: 'Pho' }, 'bad_kind'],
  ['vintage', { kind: 'spotted', title: '  ', meta: { shop: 'x' } }, 'bad_title'],
  ['vintage', { kind: 'spotted', title: 't'.repeat(81), meta: { shop: 'x' } }, 'bad_title'],
  ['vintage', { kind: 'spotted', title: 'ok', body: 'b'.repeat(601), meta: { shop: 'x' } }, 'bad_body'],
  ['vintage', { kind: 'spotted', title: 'ok', place: 'p'.repeat(81), meta: { shop: 'x' } }, 'bad_place'],
  ['vintage', { kind: 'spotted', title: 'ok', meta: { shop: 'x', colour: 'red' } }, 'bad_meta'],
  ['vintage', { kind: 'spotted', title: 'ok', meta: { shop: 'x', price: '28' } }, 'bad_meta'],
  ['vintage', { kind: 'spotted', title: 'ok', meta: { shop: 'x', price: 28.5 } }, 'bad_meta'],
  ['vintage', { kind: 'spotted', title: 'ok', meta: { shop: 'x', price: -1 } }, 'bad_meta'],
  ['vintage', { kind: 'spotted', title: 'ok', meta: [1] }, 'bad_meta'],
  ['art', { kind: 'photo', title: 'ok', meta: { shirt: 'maybe' }, photo_path: 'submissions/aaaa-0002.jpg' }, 'bad_meta'],
  ['vintage', { kind: 'spotted', title: 'ok', meta: { size: 'M' } }, 'needs_meta'],
  ['vintage', { kind: 'spotted', title: 'ok', meta: { shop: '   ' } }, 'needs_meta'],
  ['people', { kind: 'plan', title: 'Run', meta: { when: 'Sun 9am' }, photo_path: 'submissions/aaaa-0002.jpg' }, 'photo_not_allowed'],
  ['art', { kind: 'photo', title: 'Dawn' }, 'photo_required'],
  ['art', { kind: 'photo', title: 'Dawn', photo_path: '../etc/passwd' }, 'bad_photo'],
];

test('checkPost refuses what the SQL refuses, with the same code', () => {
  for (const [board, input, want] of POST_CASES) assert.equal(core.checkPost(core.RULES, board, input).error, want, JSON.stringify([board, input]));
  const ok = core.checkPost(core.RULES, 'vintage', { kind: 'spotted', title: 'A find', meta: { shop: ' Battery Street Jeans ', size: 'L', price: 28, want: '' } });
  assert.deepEqual(ok.post.meta, { shop: 'Battery Street Jeans', size: 'L', price: 28 });
});

test('expiry, pre-moderation and the limits', () => {
  const R = core.RULES, t = 1_000_000;
  assert.equal(core.expiresAt(R, 'vintage', 'spotted', t), t + 21 * DAY, 'a Vintage find lasts three weeks');
  assert.equal(core.expiresAt(R, 'art', 'photo', t), null, 'an Art piece never ends');
  assert.equal(core.expiresAt(R, 'watch', 'pick', t), t + 30 * DAY);
  assert.equal(core.startsPending(R, 'vintage'), false);
  assert.equal(core.rateError(R, 20, 0), 'rate_day');
  assert.equal(core.rateError(R, 3, 5), 'rate_waiting');
  assert.equal(core.rateError(R, 19, 4), null);
  assert.equal(core.leftLabel(t + 19 * DAY + 5, t), '19d left');
  assert.equal(core.leftLabel(t + 5 * 3600000, t), '5h left');
  assert.equal(core.leftLabel(t + 60000, t), 'ends soon');
  assert.equal(core.leftLabel(t - 1, t), 'ended');
  assert.equal(core.leftLabel(null, t), null);
  assert.equal(core.voterFor('abc', 'p_x'), 'u:abc');
  assert.equal(core.voterFor(null, 'p_reader01'), 'p_reader01');
  assert.equal(core.voterFor(null, 'x'), null);
  for (const c of Object.keys(core.MESSAGES)) assert.ok(core.message(c).length > 10);
  assert.equal(core.message('something new'), core.MESSAGES.offline);
});

/* ------------------------------------------------- the fake, as the SQL */
test('fake: the locks for a signed-out reader', () => {
  const f = make();
  assert.equal(code(() => f.call('nn_profile_get')), 'not_signed_in');
  assert.equal(code(() => f.call('nn_profile_set', { p_display_name: 'Maya' })), 'not_signed_in');
  assert.equal(code(() => f.call('nn_post_create', { p_board: 'vintage', p_kind: 'spotted', p_title: 'x' })), 'not_signed_in');
  assert.equal(code(() => f.call('nn_post_mine')), 'not_signed_in');
  assert.equal(code(() => f.call('nn_delete_me')), 'not_signed_in');
  assert.equal(code(() => f.call('nn_sweep')), 'no_function', 'helpers are not doors');
  assert.deepEqual(f.call('nn_posts_list', { p_board: 'vintage' }), []);
  assert.equal(code(() => f.call('nn_posts_list', { p_board: 'food' })), 'bad_board');
});

test('fake: a profile, then every refusal a post can meet', () => {
  const f = make().as(MAYA);
  assert.equal(f.call('nn_profile_get'), null);
  assert.equal(code(() => f.call('nn_post_create', { p_board: 'vintage', p_kind: 'spotted', p_title: 'A find', p_meta: { shop: 'Old Gold' } })), 'no_name');
  assert.equal(f.call('nn_profile_set', { p_display_name: '  Maya   R. ', p_neighborhood: 'old-north-end', p_archetype: 'trail' }).display_name, 'Maya R.');
  assert.deepEqual(f.call('nn_profile_get'), { display_name: 'Maya R.', neighborhood: 'old-north-end', archetype: 'trail' });
  for (const [board, input, want] of POST_CASES) {
    assert.equal(code(() => f.call('nn_post_create', { p_board: board, p_kind: input.kind, p_title: input.title, p_body: input.body, p_place: input.place, p_meta: input.meta, p_photo: input.photo_path })), want, JSON.stringify([board, input]));
  }
  const photo = (p) => code(() => f.call('nn_post_create', { p_board: 'art', p_kind: 'photo', p_title: 'Dawn', p_photo: p }));
  assert.equal(photo('submissions/nope-9999.jpg'), 'bad_photo', 'a photo not in the queue');
  assert.equal(photo('submissions/aaaa-0003.jpg'), 'bad_photo', 'a photo the queue rejected');
});

test('fake: a find, listed, voted on, reported, approved, expired, swept', () => {
  const f = make();
  f.as(MAYA).call('nn_profile_set', { p_display_name: 'Maya R.', p_neighborhood: 'old-north-end', p_archetype: 'trail' });
  const find = f.call('nn_post_create', { p_board: 'vintage', p_kind: 'spotted', p_title: '1994 UVM crewneck see https://spam.example now',
    p_body: 'Back rack,\n\n\n\nby the boots.  www.spam.example', p_place: 'Battery St', p_meta: { shop: ' Battery Street Jeans ', size: 'L', price: 28, want: '' } });
  assert.equal(find.title, '1994 UVM crewneck see now');
  assert.equal(find.body, 'Back rack,\n\nby the boots.');
  assert.deepEqual(find.meta, { shop: 'Battery Street Jeans', size: 'L', price: 28 });
  assert.equal(find.status, 'approved');
  assert.equal(Date.parse(find.expires_at) - Date.parse(find.created_at), 21 * DAY);

  f.as(null);
  let l = f.call('nn_posts_list', { p_board: 'vintage', p_player: 'p_reader01' });
  assert.equal(l.length, 1);
  assert.equal(l[0].author, 'Maya R.');
  assert.equal(l[0].author_arch, 'trail');
  assert.ok(!('user_id' in l[0]) && !/@/.test(JSON.stringify(l)), 'no account id and no email');
  assert.deepEqual([l[0].votes, l[0].voted, l[0].mine], [0, false, false]);
  assert.deepEqual(f.call('nn_posts_list', { p_board: 'vintage', p_filter: { kind: 'swap' } }), []);
  assert.equal(f.call('nn_posts_list', { p_board: 'vintage', p_filter: { meta: { size: 'L' } } }).length, 1);
  assert.deepEqual(f.call('nn_posts_list', { p_board: 'vintage', p_filter: { meta: { size: 'M' } } }), []);
  assert.deepEqual(f.call('nn_posts_list', { p_board: 'vintage', p_before: new Date(f.now() - DAY).toISOString() }), []);

  assert.equal(code(() => f.call('nn_vote', { p_post: find.id, p_player: 'x' })), 'bad_voter');
  assert.equal(code(() => f.call('nn_vote', { p_post: 'nope', p_player: 'p_reader01' })), 'not_found');
  assert.equal(f.call('nn_vote', { p_post: find.id, p_player: 'p_reader01' }).votes, 1);
  assert.equal(f.call('nn_vote', { p_post: find.id, p_player: 'p_reader01' }).votes, 1, 'twice is still one vote');
  assert.equal(f.call('nn_posts_list', { p_board: 'vintage', p_player: 'p_reader01' })[0].voted, true);
  assert.equal(f.call('nn_posts_list', { p_board: 'vintage', p_player: 'p_reader02' })[0].voted, false);
  assert.equal(f.as(SAM).call('nn_vote', { p_post: find.id, p_player: 'p_reader01' }).votes, 2, 'a signed-in vote is the account’s');
  f.as(null);
  assert.equal(f.call('nn_unvote', { p_post: find.id, p_player: 'p_reader01' }).votes, 1);
  assert.equal(f.call('nn_unvote', { p_post: find.id, p_player: 'p_reader01' }).votes, 1);

  f.as(MAYA);
  const art = f.call('nn_post_create', { p_board: 'art', p_kind: 'photo', p_title: 'North Beach, 6:52 am', p_meta: { shirt: 'yes' }, p_photo: 'submissions/aaaa-0001.jpg' });
  assert.equal(code(() => f.call('nn_post_create', { p_board: 'art', p_kind: 'art', p_title: 'Again', p_photo: 'submissions/aaaa-0001.jpg' })), 'bad_photo', 'one photo, one post');
  assert.deepEqual(f.call('nn_posts_list', { p_board: 'art' }), [], 'an art post waits for its photo');
  assert.equal(f.call('nn_post_mine').find((p) => p.id === art.id).photo_state, 'pending');
  f.setPhoto('submissions/aaaa-0001.jpg', 'approved');
  assert.equal(f.as(null).call('nn_posts_list', { p_board: 'art' })[0].photo, 'submissions/aaaa-0001.jpg');
  assert.equal(f.call('nn_posts_list', { p_board: 'art', p_sort: 'top' })[0].votes, 0);

  assert.equal(code(() => f.as(null).call('nn_report', { p_post: find.id, p_reason: 'spam' })), 'not_signed_in');
  assert.equal(code(() => f.as(MAYA).call('nn_report', { p_post: find.id, p_reason: 'spam' })), 'own_post');
  assert.equal(code(() => f.as(SAM).call('nn_report', { p_post: find.id, p_reason: 'meh' })), 'bad_reason');
  assert.equal(f.call('nn_report', { p_post: find.id, p_reason: 'spam' }).hidden, false, 'one report does not hide');
  assert.equal(code(() => f.call('nn_report', { p_post: find.id, p_reason: 'unkind' })), 'already_reported');
  assert.equal(f.as(KIM).call('nn_report', { p_post: find.id, p_reason: 'unsafe' }).hidden, true, 'the second one does');
  assert.deepEqual(f.as(null).call('nn_posts_list', { p_board: 'vintage' }), []);
  assert.equal(code(() => f.call('nn_vote', { p_post: find.id, p_player: 'p_reader01' })), 'not_found');
  assert.equal(f.as(MAYA).call('nn_post_mine').find((p) => p.id === find.id).status, 'pending');

  assert.equal(f.call('nn_mod_list', { p_secret: 'anything' }).error, 'bad_secret', 'no passphrase set: shut');
  f.modSecret = 'test-secret';
  assert.equal(f.call('nn_mod_list', { p_secret: 'wrong' }).error, 'bad_secret');
  const m = f.call('nn_mod_list', { p_secret: 'test-secret' });
  assert.equal(m.waiting.length, 1);
  assert.equal(m.waiting[0].reports, 2);
  assert.deepEqual(m.waiting[0].reasons.sort(), ['spam', 'unsafe']);
  assert.equal(f.call('nn_mod_act', { p_secret: 'test-secret', p_post: find.id, p_action: 'approve' }).ok, true);
  assert.equal(f.as(null).call('nn_posts_list', { p_board: 'vintage' }).length, 1, 'approved, it is back');
  assert.equal(f.posts.find((p) => p.id === find.id).reports, 0, 'with its count cleared');
  assert.equal(code(() => f.as(SAM).call('nn_report', { p_post: find.id, p_reason: 'spam' })), 'already_reported');
  assert.equal(f.call('nn_mod_act', { p_secret: 'test-secret', p_post: find.id, p_action: 'shrug' }).error, 'bad_action');
  assert.equal(f.call('nn_mod_act', { p_secret: 'test-secret', p_post: 'nope', p_action: 'hide' }).error, 'not_found');

  f.posts.find((p) => p.id === find.id).expires_at = f.now() - 3600000;
  assert.deepEqual(f.as(null).call('nn_posts_list', { p_board: 'vintage' }), [], 'an expired post is not listed');
  assert.equal(f.as(MAYA).call('nn_post_mine').find((p) => p.id === find.id).ended, true);
  f.posts.find((p) => p.id === find.id).expires_at = f.now() - 8 * DAY;
  const swap = f.call('nn_post_create', { p_board: 'vintage', p_kind: 'swap', p_title: 'M crewneck for an L flannel', p_meta: { want: 'L flannel' } });
  assert.ok(!f.posts.some((p) => p.id === find.id), 'a week past its end, the next post sweeps it away');
  assert.ok(![...f.votes].some((k) => k.startsWith(find.id)), 'with its votes');
  assert.ok(Date.parse(swap.expires_at) > f.now() + 20 * DAY);

  /* delete own */
  assert.equal(code(() => f.as(SAM).call('nn_post_delete_own', { p_post: art.id })), 'not_found');
  assert.equal(f.as(MAYA).call('nn_post_delete_own', { p_post: art.id }).deleted, true);
  assert.deepEqual(f.call('nn_posts_list', { p_board: 'art' }), []);
  assert.equal(f.photos.get('submissions/aaaa-0001.jpg'), 'removed', 'its photo leaves the gallery');
});

test('fake: the two limits, pre-moderation and bans', () => {
  const f = make({ modSecret: 'test-secret' });
  f.as(LEE).call('nn_profile_set', { p_display_name: 'Lee' });
  for (let i = 1; i <= 20; i++) f.call('nn_post_create', { p_board: 'watch', p_kind: 'pick', p_title: 'Pick ' + i });
  assert.equal(code(() => f.call('nn_post_create', { p_board: 'watch', p_kind: 'pick', p_title: 'One too many' })), 'rate_day');
  f.tick(DAY + 1000);
  assert.equal(f.call('nn_post_create', { p_board: 'watch', p_kind: 'pick', p_title: 'A new day' }).kind, 'pick', 'the day rolls');

  const rules = JSON.parse(JSON.stringify(core.RULES));
  rules.boards.people.premod = true;
  const g = make({ rules, modSecret: 'test-secret' }).as(KIM);
  g.call('nn_profile_set', { p_display_name: 'Kim', p_neighborhood: 'south-end', p_archetype: 'games' });
  for (let i = 1; i <= 5; i++) assert.equal(g.call('nn_post_create', { p_board: 'people', p_kind: 'plan', p_title: 'Pickup soccer ' + i, p_place: 'Leddy', p_meta: { when: 'Sunday 10 am', spots: 4 } }).status, 'pending');
  assert.equal(code(() => g.call('nn_post_create', { p_board: 'people', p_kind: 'plan', p_title: 'Sixth', p_meta: { when: 'Sat' } })), 'rate_waiting');
  assert.deepEqual(g.call('nn_posts_list', { p_board: 'people' }), []);

  const first = g.posts[0].id;
  assert.equal(g.call('nn_mod_act', { p_secret: 'test-secret', p_post: first, p_action: 'ban' }).ok, true);
  assert.equal(code(() => g.call('nn_post_create', { p_board: 'watch', p_kind: 'pick', p_title: 'Back again' })), 'banned');
  assert.ok(g.call('nn_post_mine').every((p) => p.status === 'hidden'));
  assert.equal(g.call('nn_mod_list', { p_secret: 'test-secret' }).bans.length, 1);
  g.call('nn_mod_unban', { p_secret: 'test-secret', p_user: KIM });
  assert.equal(g.call('nn_post_create', { p_board: 'watch', p_kind: 'rating', p_title: 'Winter Light', p_meta: { stars: 5, year: 2024 } }).kind, 'rating');
});

test('fake: missions, and deleting everything', () => {
  const f = make().as(SAM);
  f.call('nn_mission_set', { p_key: 'm7', p_done: true });
  f.call('nn_mission_set', { p_key: 'm9', p_done: true });
  f.call('nn_mission_set', { p_key: 'm9', p_done: false });
  assert.deepEqual(f.call('nn_missions_done'), [{ key: 'm7' }]);
  f.as(MAYA).call('nn_profile_set', { p_display_name: 'Maya' });
  const swap = f.call('nn_post_create', { p_board: 'vintage', p_kind: 'swap', p_title: 'Swap', p_meta: { want: 'x' } });
  f.as(SAM).call('nn_profile_set', { p_display_name: 'Sam' });
  f.call('nn_post_create', { p_board: 'watch', p_kind: 'rating', p_title: 'Causeway', p_meta: { stars: 4 } });
  f.call('nn_vote', { p_post: swap.id });
  f.call('nn_report', { p_post: swap.id, p_reason: 'other' });
  assert.equal(f.call('nn_delete_me').deleted, true);
  assert.equal(f.call('nn_profile_get'), null);
  assert.deepEqual(f.call('nn_post_mine'), []);
  assert.deepEqual(f.call('nn_missions_done'), []);
  assert.ok(![...f.votes].some((k) => k.endsWith('|u:' + SAM)));
  assert.ok(!f.reports.some((r) => r.reporter === SAM));
  assert.equal(f.as(null).call('nn_posts_list', { p_board: 'vintage' })[0].votes, 0);
});

test('the demo seed draws on every board and obeys the rules', () => {
  const f = seedDemo(new FakeBoards());
  for (const b of Object.keys(core.RULES.boards)) assert.ok(f.call('nn_posts_list', { p_board: b }).length >= 3, b + ' has demo posts');
  for (const p of f.posts) {
    const r = core.checkPost(core.RULES, p.board, { kind: p.kind, title: p.title, body: p.body, place: p.place, meta: p.meta, photo_path: p.photo_path });
    assert.ok(r.ok, p.title + ': ' + r.error);
  }
  assert.equal(f.as(DEMO_ME).call('nn_profile_get'), null, 'the demo reader starts with no name');
});
