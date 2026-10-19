// Food's Reddit shapers (all-day/js/food-asks.js): which r/burlington and
// r/vermont threads are someone asking where to eat or drink, and the Best
// of r/burlington directory's food, coffee and drink cards.
//
//   node --test scripts/test-food-asks.mjs
//
// The titles below are real r/burlington and r/vermont titles from the
// shared Reddit intake on 2026-10-19, plus a few written to catch the
// announcements and complaints the rules must leave out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isFoodAsk, burlingtonArea, asksFrom, directoryFrom, MAX_AGE_DAYS } from '../all-day/js/food-asks.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BEST = JSON.parse(readFileSync(path.join(ROOT, 'data/best-of-reddit.json'), 'utf8'));

const ASKS = [
  'Trying to find a restaurant for my birthday',
  'Bars to watch hockey?',
  'Best ramen',
  'best deli style chicken salad?',
  'Sushi recs',
  'bar recommendations?',
  'Apple Cider Donuts?',
  'Butterfly pea flower tea?',
  'I need to yell at my grandma. Where to take her for Sunday brunch?',
  'Restaurant Recommendations for a Birthday Trip to Vermont!',
  'Where can I get good pho now that my spot closed?',
  'Who sells the best cider donuts?',
  'What’s open late for food downtown?',
  'Any good Ethiopian food around here?',
  'Looking for a cozy café to work from',
  'Visiting next week, best brunch spots?',
  'Coffee shop recs for working remotely',
  'Best caterer for a small wedding?',
  'Where to buy raw milk?',
];
const NOT_ASKS = [
  'Heads up everyone coming and leaving town this week 👍',
  'nail salons??',
  'Looking for some costume props before buy new',
  'Hen of the Woods',
  'Kismayo Kitchen is Open!',
  'Kismayo Kitchen Reopens in BTV on Riverside Ave — for Now',
  'Hong’s Dumplings for sale',
  'What charity is leaving food?',
  'NEFP clothing & food drive',
  'stop bringing ur pets to the bar',
  'Curry and Cocktails',
  'Burlington trip this weekend',
  'Best place to get a large beard trim and haircut?',
  'Recommendation for Co-Work/Work Locations for Visitors',
  'Runners: your favorite half marathon',
  'Where do the crows go during the day??',
  'Giving away Woodstock VT Restaurant Reservation, 10/16',
  'Worst pizza in town?',
  'Avoid this bakery',
  'Now hiring line cooks, best pay in town',
  'Monkey House (And Other Winooski Music Venues)',
  'Best coffee table?',
  'Looking for a bar job',
  'Best bars to work at?',
];

test('the food asks are asks', () => {
  for (const t of ASKS) assert.equal(isFoodAsk(t), true, t);
});
test('announcements, sales, drives, other questions and complaints are not', () => {
  for (const t of NOT_ASKS) assert.equal(isFoodAsk(t), false, t);
});
test('Burlington-area titles', () => {
  assert.equal(burlingtonArea('Where to get good dumplings in Winooski?'), true);
  assert.equal(burlingtonArea('Best brunch in South Burlington'), true);
  assert.equal(burlingtonArea('Where to take her for Sunday brunch?'), false);
  assert.equal(burlingtonArea('Best maple creemee in the Northeast Kingdom?'), false);
});

const NOW = Date.parse('2026-10-19T08:00:00Z');
const iso = (hoursAgo) => new Date(NOW - hoursAgo * 3600000).toISOString();
const post = (id, sub, title, hoursAgo, extra = {}) => ({ id, sub, title, url: 'https://www.reddit.com/' + sub + '/comments/' + id + '/x/',
  kind: 'self', comments: null, nsfw: null, created: iso(hoursAgo), ...extra });

test('asksFrom: food asks only, newest first, r/vermont only when it is Burlington', () => {
  const intake = { v: 1, removed: { gone1: '2026-10-18T00:00:00Z' }, posts: [
    post('a1', 'r/burlington', 'Sushi recs', 30, { comments: 12 }),
    post('a2', 'r/burlington', 'Best ramen', 2),
    post('a3', 'r/burlington', 'Hen of the Woods', 1),
    post('a4', 'r/vermont', 'Where to get good dumplings in Winooski?', 5),
    post('a5', 'r/vermont', 'Where to take her for Sunday brunch?', 4),
    post('a6', 'r/burlington', 'Best tacos? (article)', 3, { kind: 'link' }),
    post('gone1', 'r/burlington', 'Best bagels?', 6),
    post('a7', 'r/burlington', 'Best wings?', 7, { nsfw: true }),
    post('a8', 'r/burlington', 'Best burger?', (MAX_AGE_DAYS + 1) * 24),
    post('a9', 'r/nba', 'Best wings in Boston?', 3),
    { ...post('a10', 'r/burlington', 'Best pho?', 3), url: 'javascript:alert(1)' },
    post('a2', 'r/burlington', 'Best ramen', 2),
  ] };
  const got = asksFrom(intake, NOW);
  assert.deepEqual(got.map((a) => a.title), ['Best ramen', 'Where to get good dumplings in Winooski?', 'Sushi recs']);
  assert.deepEqual(got.map((a) => a.sid), ['r-burlington', 'r-vermont', 'r-burlington']);
  assert.equal(got[2].comments, 12);
  assert.equal(got[0].comments, null);
  assert.equal(got[0].k, got[0].url);
  assert.equal(got[0].d, Math.floor((NOW - 2 * 3600000) / 1000));
});
test('asksFrom survives a missing or broken intake', () => {
  assert.deepEqual(asksFrom(null, NOW), []);
  assert.deepEqual(asksFrom({ posts: 'nope' }, NOW), []);
  assert.deepEqual(asksFrom({ posts: [null, {}, { title: 3 }] }, NOW), []);
});

test('directoryFrom: the food, coffee and drink questions from the real directory', () => {
  const d = directoryFrom(BEST);
  assert.ok(d.length >= 100, 'about a hundred questions, got ' + d.length);
  assert.deepEqual([...new Set(d.map((q) => q.group))].sort(), ['coffee', 'drinks', 'food']);
  assert.equal(new Set(d.map((q) => q.k)).size, d.length, 'every card has its own key');
  for (const q of d) {
    assert.ok(!/worst/i.test(q.q), 'nothing negative: ' + q.q);
    assert.ok(q.threads.length && q.threads.every((t) => /^https:\/\/www\.reddit\.com\/r\/burlington\/comments\//.test(t.url)), q.q);
  }
  for (let i = 1; i < d.length; i++) assert.ok(d[i - 1].threads.length >= d[i].threads.length, 'most asked first');
  /* Stephen's examples, from the Btown Eats archive */
  const nachos = d.find((q) => q.q === 'Best Nachos');
  assert.ok(nachos && nachos.threads.some((t) => t.url.includes('/1rkq7if/')), 'Best Nachos links its thread');
  assert.ok(d.find((q) => q.q === 'Coziest Bars' && q.group === 'drinks'), 'Coziest Bars is a drinks card');
  assert.ok(d.find((q) => q.q === 'Best Cheap Places for Food').threads.some((t) => t.url.includes('/1r0d4j5/')), 'Cheap eats joins its card');
  /* the Seven Daysies pick, exactly as the directory has it */
  const bakery = d.find((q) => q.q === 'Best Bakery');
  assert.equal(bakery.sd.pick, 'August First (bread) · Mirabelles Bakery (sweets)');
  assert.equal(bakery.sd.year, 2026);
  assert.ok(/^https:\/\/community\.sevendaysvt\.com\//.test(bakery.sd.url));
  const pho = d.find((q) => q.q === 'Best Pho');
  assert.equal(pho.sd.pick, 'Pho Hong (best Vietnamese restaurant)');
  /* "Best Bagel" and "Best Bagels" are one card with both threads */
  assert.equal(d.filter((q) => /^Best Bagels?$/.test(q.q)).length, 1);
  assert.equal(d.find((q) => /^Best Bagels?$/.test(q.q)).threads.length, 2);
});
test('directoryFrom: the merged card keeps the group of the question still being asked', () => {
  const d = directoryFrom(BEST);
  const em = d.filter((q) => /espresso martini/i.test(q.q));
  assert.equal(em.length, 1);
  assert.equal(em[0].group, 'drinks');
});
test('directoryFrom survives a missing directory', () => {
  assert.deepEqual(directoryFrom(null), []);
  assert.deepEqual(directoryFrom({ categories: [{ id: 'coffee', entries: [{ question: 'Best Coffee', sources: [{ thread_url: 'javascript:x' }] }] }] }), []);
});
