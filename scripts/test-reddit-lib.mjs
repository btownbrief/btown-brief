// The Reddit tab's shapers (all-day/js/reddit-lib.js): what shows in Fresh,
// what is held back, and how the questions gather their threads.
//
//   node --test scripts/test-reddit-lib.mjs
//
// Every name and thread below is invented for this test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { held, namesPerson, freshFrom, postsFromListings, newCount, questionsFrom, questionOfDay, search, askedAt, isAsk, catOf } from '../all-day/js/reddit-lib.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BEST = JSON.parse(readFileSync(path.join(ROOT, 'data/best-of-reddit.json'), 'utf8'));
const NOW = Date.parse('2026-10-30T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();
const post = (o) => ({ id: 'a1', sub: 'r/burlington', title: 'A quiet morning on Pine', url: 'https://www.reddit.com/r/burlington/comments/a1/', created: hoursAgo(1), first_seen: hoursAgo(1), nsfw: false, score: 5, comments: 5, flair: null, out: null, ...o });

test('titles naming a private person are held', () => {
  ['Zealot Erin Sample freaks out at the market', 'Accused thief Stephanie Testcase has a page', 'Former Prosecutor Fakename’s dog', 'Officer Madeup was rude', 'Tiffany Placeholder lost her job', 'ERIC SAMPLE IS BACK'].forEach((t) => assert.ok(held(t), t));
});
test('businesses, places and public officials are not names', () => {
  ['Bluebird BBQ closing.', 'Charlie’s Boathouse to turn into public park', 'St Albans to Jay Peak options', 'Higher Ground Show', 'Phil Scott on the budget', 'Fire at Trapp Family Lodge?', 'Free Haircuts at Burlington Barber Shop', 'Reckless Driving on S Prospect St'].forEach((t) => assert.ok(!namesPerson(t), t));
});
test('arrests, crimes, usernames, phones and addresses are held', () => {
  ['Senator arrested on Tuesday', 'Former administrator stole $1M', 'Ask u/somebody about it', 'Call 802-555-0100 now', 'The house at 12 Maple Street again'].forEach((t) => assert.ok(held(t), t));
  ['party at 12 lake forest drive', '12 North Winooski Ave again', 'Cops at 40 Sample Way', 'Noise on 7B old mill ct', '12 1/2 Pine St'].forEach((t) => assert.ok(held(t), t));
  ['Thanks to J. Sample for the ride', 'Spotted J. SAMPLE downtown'].forEach((t) => assert.ok(held(t), t));
  ['A 30 year old tradition', '4 way stop at the top', 'Mayor visits U.S. Senate', 'St. Albans trip', 'Mt. Mansfield snow'].forEach((t) => assert.ok(!held(t), t));
  ['Call 8025550100', 'Call 802 555 0100', 'Call (802) 555-0100', '802.555.0100 for rides', 'write to someone@example.com', 'Oak Lane sample.name+vt@mail.example.org'].forEach((t) => assert.ok(held(t), t));
  ['12 Sample Park', 'Noise at 40 sample trail', '9 Mill Trl', '3 North Bch', '7 Sample Grn', 'party at 12 Old Mill Grv', 'Cops at 40 Sample Park', 'at 12 Maple St'].forEach((t) => assert.ok(held(t), t));
  ['5 mile trail', '10 acre park', '2 dogs at Oakledge Park', 'Three killed, 5 in park', '3 hours on the Long Trail', 'at 12 Maple', 'Doors at 7 tonight', 'Open at 5 pm', 'Back at 8 Thursday', 'The 2026 budget of 123456789 dollars', '2026-10-30 meeting', 'Email the mayor', '$1,000,000,000 grant', 'follow @sample.news'].forEach((t) => assert.ok(!held(t), t));
  assert.ok(held('Fine title', 'Misleading - See Comments'));
  assert.ok(!held('LOST PET in the New North End', 'Lost/Stolen Property or Animal'));
  assert.ok(held('What do you do when a 17 year old does this'));
  assert.ok(!held('The officer was kind') && !held('A coach bus to Montreal'));
});
test('Fresh: confirmed, newest first, with a floor', () => {
  const out = freshFrom({ posts: [
    post({ id: 'old', created: hoursAgo(30), score: 40, comments: 2 }),
    post({ id: 'new', created: hoursAgo(1), score: 0, comments: 0 }),
    post({ id: 'dead', created: hoursAgo(10), score: 1, comments: 2 }),
    post({ id: 'unconfirmed', nsfw: null }),
    post({ id: 'nsfw', nsfw: true }),
    post({ id: 'away', sub: 'r/news' }),
    post({ id: 'down', score: -3 }),
    post({ id: 'stale', created: hoursAgo(24 * 20) }),
  ].map((p, i) => ({ ...p, title: 'Thread number ' + p.id + i })) }, NOW);
  assert.deepEqual(out.map((p) => p.id), ['new', 'old']);
});
test('Fresh: the same story in both subs shows once, the bigger copy', () => {
  const out = freshFrom({ posts: [post({ id: 'b', score: 9 }), post({ id: 'v', sub: 'r/vermont', score: 90 })] }, NOW);
  assert.deepEqual(out.map((p) => p.id), ['v']);
});
test('Fresh: a hot thread, and the outlet of a link', () => {
  const [p] = freshFrom({ posts: [post({ comments: 74, out: 'https://www.sevendaysvt.com/news/x/' })] }, NOW);
  assert.equal(p.hot, false);
  assert.equal(freshFrom({ posts: [post({ comments: 75 })] }, NOW)[0].hot, true);
  assert.equal(p.outlet, 'Seven Days');
});
test('never a username or body in what Fresh hands on', () => {
  const [p] = freshFrom({ posts: [post({ author: 'somebody', body: 'words' })] }, NOW);
  assert.deepEqual(Object.keys(p).sort(), ['comments', 'flair', 'hot', 'id', 'outlet', 'score', 'seen', 'sub', 'title', 'ts', 'url']);
});
test('the bar count reads the listings', () => {
  const doc = { listings: { 'r/burlington/new': { data: { data: { children: [
    { data: { id: 'x1', title: 'Fresh one here', url: 'https://www.reddit.com/x1', created_utc: (NOW - 3600000) / 1000, over_18: false, score: 3, num_comments: 1 } },
    { data: { id: 'x2', title: 'Pinned one here', url: 'https://www.reddit.com/x2', created_utc: (NOW - 3600000) / 1000, over_18: false, stickied: true } },
  ] } } } } };
  const fresh = freshFrom({ posts: postsFromListings(doc) }, NOW);
  assert.equal(newCount(fresh, NOW - 7200000), 1);
  assert.equal(newCount(fresh, NOW), 0);
});
test('asks', () => {
  ['Acupuncture that takes insurance?', 'Best ramen', 'Pellet stove installation recommendations', 'Looking for a dog trainer'].forEach((t) => assert.ok(isAsk(t), t));
  ['Bluebird BBQ closing.', 'Looking for 2 tickets to the show', 'LOST PET in the New North End?'].forEach((t) => assert.ok(!isAsk(t), t));
  assert.equal(catOf('Acupuncture that takes insurance?'), 'health');
  assert.equal(catOf('Pellet stove installation recommendations'), 'services');
  assert.equal(catOf('Any good pizza?'), 'food');
  assert.equal(catOf('Is the thing still there?'), 'around');
});
test('the list: every card has threads, a real date, and no comment-suggestion', () => {
  const cards = questionsFrom(BEST, null, NOW);
  assert.ok(cards.length > 200, cards.length);
  cards.forEach((c) => {
    assert.ok(c.threads.length && c.n === c.threads.length, c.q);
    assert.ok(c.threads.every((t) => /^https:\/\/www\.reddit\.com\//.test(t.url) && new Date(t.ts).getUTCFullYear() >= 2018), c.q);
  });
});
test('a thread that asks again joins its card and floats it', () => {
  const url = 'https://www.reddit.com/r/burlington/comments/zz1/best_burger/';
  const cards = questionsFrom(BEST, { posts: [post({ id: 'zz1', title: 'Best burger near downtown?', url, created: hoursAgo(3) })] }, NOW);
  assert.equal(cards[0].q, 'Best Burger');
  assert.equal(cards[0].week, 1);
  assert.equal(cards[0].threads[0].url, url);
  assert.equal(cards[0].threads[0].exact, true);
});
test('a new question gets its own card; a link post or an r/vermont thread does not', () => {
  const posts = [post({ id: 'n1', title: 'Acupuncture that takes insurance?' }),
    post({ id: 'n2', title: 'Is this a question?', out: 'https://example.com/a' }),
    post({ id: 'n3', sub: 'r/vermont', title: 'Why is the sky?' })];
  const cards = questionsFrom({ categories: [] }, { posts }, NOW);
  assert.deepEqual(cards.map((c) => [c.q, c.cat, c.n]), [['Acupuncture that takes insurance?', 'health', 1]]);
});
test('a question with no subject of its own needs to ask outright; politics stays out', () => {
  const posts = [post({ id: 'r1', title: 'What are we doing?' }), post({ id: 'r2', title: 'Is the Lantern still open?' }), post({ id: 'r3', title: 'Scott or the other one?' })];
  assert.deepEqual(questionsFrom({ categories: [] }, { posts }, NOW).map((c) => c.q), ['Is the Lantern still open?']);
});
test('a held thread never joins a card', () => {
  const cards = questionsFrom({ categories: [] }, { posts: [post({ title: 'Is Erin Sample still around?' })] }, NOW);
  assert.equal(cards.length, 0);
});
test('thread years from ids', () => {
  assert.equal(new Date(askedAt('https://www.reddit.com/r/burlington/comments/1xj518e/x/')).getUTCFullYear(), 2026);
  assert.equal(new Date(askedAt('https://www.reddit.com/r/burlington/comments/1kuadqb/x/')).getUTCFullYear(), 2025);
  assert.equal(new Date(askedAt('https://www.reddit.com/r/burlington/comments/12r1lpn/x/')).getUTCFullYear(), 2023);
});
test('question of the day turns over daily and search finds', () => {
  const cards = questionsFrom(BEST, null, NOW);
  const a = questionOfDay(cards, NOW), b = questionOfDay(cards, NOW + 86400000);
  assert.ok(a && b && a.k !== b.k && a.n >= 3);
  assert.ok(search(cards, 'tattoo').some((c) => /Tattoo/.test(c.q)));
  assert.equal(search(cards, 'zzzznothing').length, 0);
});
