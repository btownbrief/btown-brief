// The boards' pure rules, and the fake backend's mirror of the SQL.
//
//   node --test scripts/test-boards-core.mjs
//   node scripts/test-boards-core.mjs --write-sql   (copy RULES into nn-ROUND2.sql)
//
// Three copies of one set of rules must agree: all-day/js/boards-core.js,
// nn_rules() and the checks in the SQL (all-day/supabase/nn-SETUP.sql, with
// nn-ROUND2.sql pasted over it), and the fake in all-day/js/boards-fake.js.
// This file checks the first two are the same JSON (nn-ROUND2.sql's copy is
// the live one), that nothing nn-SETUP.sql allowed has been taken away,
// that the fake answers to the same function names the SQL grants, and
// runs the fake through the same cases scripts/test-nn-sql.sql and
// scripts/test-nn-round2-sql.sql run against a real Postgres
// (scripts/test-nn-sql.sh), so a drift shows up here even on a machine
// without one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as core from '../all-day/js/boards-core.js';
import { FakeBoards, seedDemo, DEMO_ME } from '../all-day/js/boards-fake.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETUP_PATH = path.join(ROOT, 'all-day/supabase/nn-SETUP.sql');
const ROUND2_PATH = path.join(ROOT, 'all-day/supabase/nn-ROUND2.sql');
const RULES_RE = /\$json\$([\s\S]*?)\$json\$/;

if (process.argv.includes('--write-sql')) {
  const sql = readFileSync(ROUND2_PATH, 'utf8');
  writeFileSync(ROUND2_PATH, sql.replace(RULES_RE, () => '$json$' + JSON.stringify(core.RULES) + '$json$'));
  console.log('nn_rules() in nn-ROUND2.sql now matches boards-core.js RULES');
  process.exit(0);
}
const SETUP = readFileSync(SETUP_PATH, 'utf8');
const ROUND2 = readFileSync(ROUND2_PATH, 'utf8');

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
  f.addPhoto('submissions/gall-0004.jpg', 'pending', { board: false });   // a gallery photo, not from a board
  return f;
};

/* ------------------------------------------------------------- one copy */
test('nn_rules() in nn-ROUND2.sql is exactly RULES in boards-core.js', () => {
  const m = ROUND2.match(RULES_RE);
  assert.ok(m, 'nn-ROUND2.sql has a $json$ block');
  assert.deepEqual(JSON.parse(m[1]), core.RULES, 'run: node scripts/test-boards-core.mjs --write-sql');
});

test('round two takes nothing away: every board, kind, field and limit nn-SETUP.sql allowed still stands as it was', () => {
  const old = JSON.parse(SETUP.match(RULES_RE)[1]);
  const R = core.RULES;
  for (const [k, v] of Object.entries(old.limits)) assert.equal(R.limits[k], v, 'limit ' + k);
  for (const list of ['neighborhoods', 'archetypes', 'reasons']) assert.deepEqual(R[list], old[list], list);
  for (const [b, ob] of Object.entries(old.boards)) {
    const nb = R.boards[b];
    assert.ok(nb, 'board ' + b);
    assert.equal(nb.premod, ob.premod, b + ' premod');
    assert.equal(nb.gallery, ob.gallery, b + ' gallery');
    for (const [k, ok] of Object.entries(ob.kinds)) {
      const nk = nb.kinds[k];
      assert.ok(nk, b + '/' + k);
      assert.deepEqual([nk.days, nk.photo, nk.needs], [ok.days, ok.photo, ok.needs], b + '/' + k + ' days, photo and needs');
    }
    for (const [k, of] of Object.entries(ob.meta)) assert.deepEqual(nb.meta[k], of, b + ' field ' + k);
  }
});

test('the profile interests are the People tab’s activity list', () => {
  const js = readFileSync(path.join(ROOT, 'all-day/js/modes/people.js'), 'utf8');
  const lit = js.match(/export const PEOPLE_RULES = (\{[\s\S]*?\n\});/);
  assert.ok(lit, 'people.js has PEOPLE_RULES');
  const people = Function('return ' + lit[1])();
  assert.deepEqual(core.RULES.interests, people.interests);
  assert.equal(core.RULES.limits.interestsMax, people.interestsMax);
  assert.deepEqual(Object.keys(core.INTEREST_LABELS), core.RULES.interests, 'every interest has words');
});

test('the fake answers to every function the SQL grants to readers, and only those', () => {
  const readers = (sql) => sql.slice(sql.indexOf('-- Readers, signed in or not'));
  const granted = new Set([...(readers(SETUP) + readers(ROUND2)).matchAll(/public\.(nn_\w+)\(/g)].map((m) => m[1]));
  const fake = new Set(Object.getOwnPropertyNames(FakeBoards.prototype).filter((n) => /^nn_/.test(n)));
  for (const fn of granted) assert.ok(fake.has(fn), fn + ' is granted in SQL but missing from the fake');
  for (const fn of fake) assert.ok(granted.has(fn), fn + ' is in the fake but the SQL does not grant it');
  const defined = new Set([...(SETUP + ROUND2).matchAll(/create or replace function public\.(nn_\w+)\(/g)].map((m) => m[1]));
  for (const fn of fake) assert.ok(defined.has(fn), fn + ' is not defined in the SQL');
});

test('nn-ROUND2.sql only adds: no drop, no delete, no truncate, no column taken away', () => {
  const code = ROUND2.replace(/--[^\n]*/g, '');
  assert.ok(!/\bdrop\s+(table|function|column|index|schema|extension)\b/i.test(code), 'drops nothing but its own two policies');
  assert.ok(!/\btruncate\b/i.test(code));
  assert.ok(!/\balter\s+table[^;]*\bdrop\b/i.test(code));
  const deletes = [...code.matchAll(/\bdelete\s+from\s+([\w.]+)/gi)].map((m) => m[1]);
  assert.deepEqual([...new Set(deletes)].sort(), ['public.nn_posts', 'public.nn_votes'], 'only the sweep (as before) and a moved ballot vote delete rows');
  for (const m of code.matchAll(/drop policy if exists "([^"]+)"/g)) assert.match(m[1], /^nn stray photos/, 'only its own policies');
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
  assert.deepEqual(f.call('nn_profile_get'), { display_name: 'Maya R.', neighborhood: 'old-north-end', archetype: 'trail', interests: [] });
  for (const [board, input, want] of POST_CASES) {
    assert.equal(code(() => f.call('nn_post_create', { p_board: board, p_kind: input.kind, p_title: input.title, p_body: input.body, p_place: input.place, p_meta: input.meta, p_photo: input.photo_path })), want, JSON.stringify([board, input]));
  }
  const photo = (p) => code(() => f.call('nn_post_create', { p_board: 'art', p_kind: 'photo', p_title: 'Dawn', p_photo: p }));
  assert.equal(photo('submissions/nope-9999.jpg'), 'bad_photo', 'a photo not in the queue');
  assert.equal(photo('submissions/aaaa-0003.jpg'), 'bad_photo', 'a photo the queue rejected');
  assert.equal(photo('submissions/aaaa-0002.jpg'), 'bad_photo', 'an approved photo: its path is public, so it can never be claimed');
  assert.equal(photo('submissions/gall-0004.jpg'), 'bad_photo', 'a photo the gallery form sent, not a board');
  assert.equal(f.call('nn_photo_abandon', { p_path: 'submissions/gall-0004.jpg' }).removed, false, 'and a board cannot take it out of the queue');
  f.addPhoto('submissions/old0-0005.jpg', 'pending', { at: f.now() - 2 * DAY });
  assert.equal(photo('submissions/old0-0005.jpg'), 'bad_photo', 'a board photo more than a day old');
  f.addPhoto('submissions/left-0006.jpg', 'pending');
  assert.equal(f.as(null).call('nn_photo_abandon', { p_path: 'submissions/left-0006.jpg' }).removed, true, 'a board photo whose post never happened leaves the queue');
  assert.equal(f.photos.get('submissions/left-0006.jpg').status, 'removed');
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
  assert.equal(f.photos.get('submissions/aaaa-0001.jpg').status, 'removed', 'its photo leaves the gallery');
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
  const f = make();
  assert.equal(code(() => f.call('nn_mission_set', { p_key: 'm7', p_done: true })), 'not_signed_in', 'missions are signed-in only, as the SQL grants them');
  f.as(SAM);
  assert.equal(code(() => f.call('nn_mission_set', { p_key: 'x7', p_done: true })), 'bad_key');
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
  assert.equal(f.posts.find((p) => p.id === swap.id).reports, 1);
  assert.equal(f.call('nn_delete_me').deleted, true);
  assert.equal(f.posts.find((p) => p.id === swap.id).reports, 0, 'their report no longer counts against the post');
  /* an old report Stephen already cleared must not erase a newer one */
  const g = make({ modSecret: 's' });
  g.as(MAYA).call('nn_profile_set', { p_display_name: 'Maya' });
  const p2 = g.call('nn_post_create', { p_board: 'watch', p_kind: 'pick', p_title: 'Pick' });
  g.as(SAM).call('nn_report', { p_post: p2.id, p_reason: 'spam' });
  g.tick(1000);
  g.call('nn_mod_act', { p_secret: 's', p_post: p2.id, p_action: 'approve' });
  g.tick(1000);
  g.as(KIM).call('nn_report', { p_post: p2.id, p_reason: 'spam' });
  g.as(SAM).call('nn_delete_me');
  assert.equal(g.posts.find((p) => p.id === p2.id).reports, 1, 'Sam’s cleared report goes; Kim’s newer one still counts');
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

/* ------------------------------------------------------------- round two */
/* The cases scripts/test-nn-round2-sql.sql runs against Postgres. */
test('round two: the new kinds and fields, checked like every other', () => {
  const R = core.RULES;
  const post = (board, input) => core.checkPost(R, board, input);
  const pic = 'submissions/aaaa-0002.jpg';
  assert.equal(post('vintage', { kind: 'design', title: 'Rainy Church Street', meta: { thanks: 'shirts' } }).error, 'photo_required');
  assert.equal(post('vintage', { kind: 'design', title: 'Rainy Church Street', photo_path: pic }).error, 'needs_meta', 'a design says how its artist is thanked');
  assert.equal(post('vintage', { kind: 'design', title: 'Rainy Church Street', meta: { thanks: 'cash' }, photo_path: pic }).error, 'bad_meta', 'never cash');
  assert.ok(post('vintage', { kind: 'design', title: 'Rainy Church Street', meta: { thanks: 'credit' }, photo_path: pic }).ok);
  assert.equal(post('vintage', { kind: 'fit', title: 'All thrifted' }).error, 'photo_required');
  assert.ok(post('vintage', { kind: 'fit', title: 'All thrifted', photo_path: pic }).ok);
  assert.equal(core.expiresAt(R, 'vintage', 'fit', 0), 60 * DAY);
  assert.equal(core.expiresAt(R, 'vintage', 'design', 0), null);
  assert.deepEqual(post('people', { kind: 'plan', title: 'Run', meta: { when: 'Sun', meetup: true, ages: 'thirties' } }).post.meta, { when: 'Sun', meetup: true, ages: 'thirties' });
  assert.equal(post('people', { kind: 'plan', title: 'Run', meta: { when: 'Sun', meetup: 'yes' } }).error, 'bad_meta', 'a box is true or false');
  assert.equal(post('people', { kind: 'plan', title: 'Run', meta: { when: 'Sun', ages: '18' } }).error, 'bad_meta');
  assert.deepEqual(post('people', { kind: 'plan', title: 'Run', meta: { when: 'Sun', meetup: false } }).post.meta, { when: 'Sun', meetup: false });
  assert.deepEqual(post('watch', { kind: 'pick', title: 'Heat', meta: { film: 949, year: 1995 } }).post.meta, { film: 949, year: 1995 });
  assert.equal(post('watch', { kind: 'pick', title: 'Heat', meta: { film: 0 } }).error, 'bad_meta');
  assert.equal(post('watch', { kind: 'pick', title: 'Heat', meta: { film: '949' } }).error, 'bad_meta');
  assert.equal(core.oneVote(R, 'watch', 'pick'), true);
  assert.equal(core.oneVote(R, 'watch', 'rating'), false);
  assert.equal(core.oneVote(R, 'art', 'photo'), false);
});

test('round two: interests on the profile, activities from the list only', () => {
  const R = core.RULES;
  assert.equal(core.checkProfile(R, { display_name: 'Maya', interests: ['running', 'lgbtq'] }).error, 'bad_interest', 'never who someone is');
  assert.equal(core.checkProfile(R, { display_name: 'Maya', interests: 'running' }).error, 'bad_interest');
  assert.equal(core.checkProfile(R, { display_name: 'Maya', interests: R.interests.slice(0, 9) }).error, 'bad_interest', 'eight at most');
  assert.deepEqual(core.checkProfile(R, { display_name: 'Maya', interests: ['running', 'games', 'running'] }).profile.interests, ['running', 'games']);
  const f = make().as(MAYA);
  f.call('nn_profile_set', { p_display_name: 'Maya', p_interests: ['running', 'books'] });
  assert.deepEqual(f.call('nn_profile_get').interests, ['running', 'books']);
  assert.deepEqual(f.call('nn_profile_set', { p_display_name: 'Maya R.', p_archetype: 'trail' }).interests, ['running', 'books'], 'the round-one call keeps them');
  assert.deepEqual(f.call('nn_profile_set', { p_display_name: 'Maya R.', p_interests: null }).interests, ['running', 'books'], 'a null keeps them');
  assert.equal(code(() => f.call('nn_profile_set', { p_display_name: 'Maya', p_interests: ['women'] })), 'bad_interest');
  assert.deepEqual(f.call('nn_profile_set', { p_display_name: 'Maya', p_interests: [] }).interests, [], 'an empty list clears them');
});

test('round two: change the fields on your own post', () => {
  const f = make({ modSecret: 's' });
  f.as(MAYA).call('nn_profile_set', { p_display_name: 'Maya' });
  const find = f.call('nn_post_create', { p_board: 'vintage', p_kind: 'spotted', p_title: 'Red barn jacket', p_meta: { shop: 'Old Gold', size: 'M' } });
  assert.equal(code(() => f.as(null).call('nn_post_meta_set', { p_post: find.id, p_meta: { got: true } })), 'not_signed_in');
  assert.equal(code(() => f.as(SAM).call('nn_post_meta_set', { p_post: find.id, p_meta: { got: true } })), 'not_found', 'only your own');
  f.as(MAYA);
  assert.equal(code(() => f.call('nn_post_meta_set', { p_post: find.id, p_meta: [1] })), 'bad_meta');
  assert.equal(code(() => f.call('nn_post_meta_set', { p_post: find.id, p_meta: { got: 'yes' } })), 'bad_meta');
  assert.equal(code(() => f.call('nn_post_meta_set', { p_post: find.id, p_meta: { stars: 5 } })), 'bad_meta', 'only the board’s fields');
  assert.equal(code(() => f.call('nn_post_meta_set', { p_post: find.id, p_meta: { shop: null } })), 'needs_meta', 'a required field stays');
  assert.deepEqual(f.call('nn_post_meta_set', { p_post: find.id, p_meta: { got: true, size: null } }).meta, { shop: 'Old Gold', got: true }, 'merged; a null takes one away');
  assert.deepEqual(f.as(null).call('nn_posts_list', { p_board: 'vintage', p_filter: { meta: { got: true } } }).map((p) => p.id), [find.id]);
  const plan = f.as(MAYA).call('nn_post_create', { p_board: 'people', p_kind: 'plan', p_title: 'Trivia', p_meta: { when: 'Tue 7pm' } });
  assert.deepEqual(f.call('nn_post_meta_set', { p_post: plan.id, p_meta: { meetup: true, ages: 'any' } }).meta, { when: 'Tue 7pm', meetup: true, ages: 'any' });
  f.call('nn_mod_act', { p_secret: 's', p_post: find.id, p_action: 'ban' });
  assert.equal(code(() => f.call('nn_post_meta_set', { p_post: plan.id, p_meta: { meetup: false } })), 'banned');
  const rules = JSON.parse(JSON.stringify(core.RULES));
  rules.boards.vintage.premod = true;
  const g = make({ rules, modSecret: 's' }).as(KIM);
  g.call('nn_profile_set', { p_display_name: 'Kim' });
  const p = g.call('nn_post_create', { p_board: 'vintage', p_kind: 'swap', p_title: 'Tee', p_meta: { want: 'free' } });
  g.call('nn_mod_act', { p_secret: 's', p_post: p.id, p_action: 'approve' });
  assert.equal(g.as(KIM).call('nn_post_meta_set', { p_post: p.id, p_meta: { want: 'a flannel' } }).status, 'pending', 'on a pre-moderated board an edit waits again');
});

test('round two: one vote on the screening ballot, moved in one step', () => {
  const f = make();
  f.as(LEE).call('nn_profile_set', { p_display_name: 'Lee' });
  const a = f.call('nn_post_create', { p_board: 'watch', p_kind: 'pick', p_title: 'Heat', p_meta: { film: 949 } });
  const b = f.call('nn_post_create', { p_board: 'watch', p_kind: 'pick', p_title: 'Ran', p_meta: { film: 11645 } });
  const r = f.call('nn_post_create', { p_board: 'watch', p_kind: 'rating', p_title: 'Heat', p_meta: { stars: 5, film: 949 } });
  const r2 = f.call('nn_post_create', { p_board: 'watch', p_kind: 'rating', p_title: 'Ran', p_meta: { stars: 4, film: 11645 } });
  f.as(null);
  assert.deepEqual(f.call('nn_vote', { p_post: a.id, p_player: 'p_reader01' }), { votes: 1, voted: true, moved: [] });
  assert.deepEqual(f.call('nn_vote', { p_post: b.id, p_player: 'p_reader01' }), { votes: 1, voted: true, moved: [a.id] }, 'voting for another pick moves the vote');
  assert.equal(f._count(a.id), 0);
  assert.deepEqual(f.call('nn_vote', { p_post: b.id, p_player: 'p_reader01' }).moved, [], 'again is still one vote');
  f.call('nn_vote', { p_post: r.id, p_player: 'p_reader01' });
  assert.deepEqual(f.call('nn_vote', { p_post: r2.id, p_player: 'p_reader01' }).moved, [], 'ratings have no one-vote rule');
  assert.equal(f._count(r.id), 1);
  f.call('nn_vote', { p_post: a.id, p_player: 'p_reader02' });
  f.posts.find((p) => p.id === a.id).expires_at = f.now() - 1000;
  assert.deepEqual(f.call('nn_vote', { p_post: b.id, p_player: 'p_reader02' }).moved, [], 'a vote on an ended pick stays as it was counted');
  assert.equal(f._count(a.id), 1);
  const art = make();
  art.as(MAYA).call('nn_profile_set', { p_display_name: 'Maya' });
  const n1 = art.call('nn_post_create', { p_board: 'art', p_kind: 'notice', p_title: 'Open studio' });
  const n2 = art.call('nn_post_create', { p_board: 'art', p_kind: 'notice', p_title: 'Model wanted' });
  art.as(null).call('nn_vote', { p_post: n1.id, p_player: 'p_reader01' });
  assert.deepEqual(art.call('nn_vote', { p_post: n2.id, p_player: 'p_reader01' }).moved, [], 'other boards vote as before');
});

test('round two: votes by the week they were cast, Burlington time', () => {
  /* make() starts Friday 2026-10-16, 8 am in Burlington */
  const f = make();
  f.as(MAYA).call('nn_profile_set', { p_display_name: 'Maya' });
  f.setPhoto('submissions/aaaa-0001.jpg', 'pending');
  const old = f.call('nn_post_create', { p_board: 'art', p_kind: 'photo', p_title: 'Dawn', p_photo: 'submissions/aaaa-0001.jpg' });
  f.setPhoto('submissions/aaaa-0001.jpg', 'approved');
  f.as(null).call('nn_vote', { p_post: old.id, p_player: 'p_reader01' });
  f.call('nn_vote', { p_post: old.id, p_player: 'p_reader02' });
  f.tick(3 * DAY + 3 * 3600000);   /* Monday 11 am: a new week */
  f.call('nn_vote', { p_post: old.id, p_player: 'p_reader03' });
  assert.equal(code(() => f.call('nn_votes_by_week', { p_board: 'food' })), 'bad_board');
  assert.deepEqual(f.call('nn_votes_by_week', { p_board: 'art', p_weeks: 2 }), [
    { post: old.id, week: '2026-W43', votes: 1 }, { post: old.id, week: '2026-W42', votes: 2 }]);
  assert.deepEqual(f.call('nn_votes_by_week', { p_board: 'art', p_weeks: 1 }), [{ post: old.id, week: '2026-W43', votes: 1 }], 'only the weeks asked for');
  f.call('nn_unvote', { p_post: old.id, p_player: 'p_reader01' });
  assert.deepEqual(f.call('nn_votes_by_week', { p_board: 'art', p_weeks: 2 })[1], { post: old.id, week: '2026-W42', votes: 1 }, 'a vote taken back is no vote');
  assert.deepEqual(f.call('nn_votes_by_week', { p_board: 'vintage' }), []);
  assert.equal(core.isoWeek(Date.parse('2026-10-19T03:59:00Z')), '2026-W42', 'Sunday 11:59 pm Burlington is still last week');
  assert.equal(core.isoWeek(Date.parse('2026-10-19T04:00:00Z')), '2026-W43', 'and midnight starts the next');
  assert.deepEqual(core.lastWeeks(Date.parse('2027-01-02T12:00:00Z'), 3), ['2026-W53', '2026-W52', '2026-W51']);
});

test('round two: the photo sweep', () => {
  const f = make({ modSecret: 's' });
  f.addPhoto('submissions/left-0007.jpg', 'pending', { at: f.now() - 26 * 3600000 });
  f.addPhoto('submissions/new0-0008.jpg', 'pending', { at: f.now() - 3600000 });
  f.addPhoto('submissions/gall-0009.jpg', 'pending', { board: false, at: f.now() - 3 * DAY });
  f.addFile('submissions/lost-0010.jpg', f.now() - 2 * DAY);   // uploaded, never filed
  f.addFile('submissions/lost-0011.jpg', f.now() - 3600000);   // too new to call lost
  f.addFile('submissions/left-0007.jpg', f.now() - 2 * DAY);   // has a queue row
  f.addFile('elsewhere/lost-0012.jpg', f.now() - 2 * DAY);     // not a submission
  assert.equal(f.call('nn_mod_photo_sweep', { p_secret: 'wrong' }).error, 'bad_secret');
  assert.deepEqual(f.call('nn_mod_photo_sweep', { p_secret: 's' }), { abandoned: 1, strays: ['submissions/lost-0010.jpg'] });
  assert.equal(f.photos.get('submissions/left-0007.jpg').status, 'removed', 'a day-old board photo nobody posted leaves the queue');
  assert.equal(f.photos.get('submissions/new0-0008.jpg').status, 'pending', 'one still inside its day stays');
  assert.equal(f.photos.get('submissions/gall-0009.jpg').status, 'pending', 'a gallery photo is never a board’s to sweep');
  assert.deepEqual(f.removeFiles(['submissions/lost-0010.jpg', 'submissions/lost-0011.jpg', 'submissions/left-0007.jpg']), ['submissions/lost-0010.jpg'], 'only strays can be removed');
  assert.ok(f.files.has('submissions/lost-0011.jpg') && f.files.has('submissions/left-0007.jpg'));
});

test('round two: People’s Meetup list reads the box in the plan', () => {
  const f = make({ modSecret: 's' });
  f.as(MAYA).call('nn_profile_set', { p_display_name: 'Maya' });
  const yes = f.call('nn_post_create', { p_board: 'people', p_kind: 'plan', p_title: 'Trivia', p_place: 'Three Needs', p_meta: { when: 'Tue 7pm', spots: 2, meetup: true, ages: 'thirties' } });
  f.call('nn_post_create', { p_board: 'people', p_kind: 'plan', p_title: 'Walk', p_meta: { when: 'Sat 9am', meetup: false } });
  f.as(null).call('nn_vote', { p_post: yes.id, p_player: 'p_reader01' });
  assert.equal(f.call('nn_people_meetup_list', { p_secret: 'nope' }).error, 'bad_secret');
  const l = f.call('nn_people_meetup_list', { p_secret: 's' }).plans;
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].title, l[0].when, l[0].place, l[0].spots, l[0].ages, l[0].author, l[0].going], ['Trivia', 'Tue 7pm', 'Three Needs', 2, 'thirties', 'Maya', 1]);
});
