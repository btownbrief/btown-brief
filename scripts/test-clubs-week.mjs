// The run clubs' week (all-day/js/clubs-week.js): People's strip and What
// Now's windows read it, so its clock has to be Burlington's on every day of
// the year, wherever the machine running it is.
//
//   node --test scripts/test-clubs-week.mjs
//
// The machine's own zone is set to Auckland before anything runs, so a
// function that leaned on local time would fail here.

process.env.TZ = 'Pacific/Auckland';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as cw from '../all-day/js/clubs-week.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = JSON.parse(readFileSync(path.join(ROOT, 'data/run-clubs.json'), 'utf8')).clubs;
const DEMO = JSON.parse(readFileSync(path.join(ROOT, 'all-day/data/demo/run-clubs.json'), 'utf8'));

/* an instant from a Burlington wall time with its offset spelled out */
const at = (iso) => Date.parse(iso);
const meet = (day, time, extra = {}) => ({ day, time, where: 'Somewhere', address: '', lat: 44.47, lng: -73.21, note: '', ...extra });
const club = (id, meets, extra = {}) => ({ id, name: id.replace(/-/g, ' '), kind: 'run', what: 'Runs.', url: 'https://example.org/' + id, meets, ...extra });

test('the machine is not in Burlington', () => {
  assert.notEqual(new Date(at('2026-10-17T12:00:00-04:00')).getHours(), 12);
});

test('timeLabel speaks the plan composer’s words', () => {
  assert.equal(cw.timeLabel('18:00'), '6 pm');
  assert.equal(cw.timeLabel('17:30'), '5:30 pm');
  assert.equal(cw.timeLabel('07:05'), '7:05 am');
  assert.equal(cw.timeLabel('00:00'), '12 am');
  assert.equal(cw.timeLabel('12:15'), '12:15 pm');
  assert.equal(cw.timeLabel('6pm'), '');
});

test('wall time becomes the right moment on both sides of each daylight-saving change', () => {
  assert.equal(cw.wall(2026, 10, 31, 17, 30), at('2026-10-31T17:30:00-04:00'));
  assert.equal(cw.wall(2026, 11, 1, 17, 30), at('2026-11-01T17:30:00-05:00'));
  assert.equal(cw.wall(2026, 11, 1, 0, 0), at('2026-11-01T00:00:00-04:00'));
  assert.equal(cw.wall(2027, 3, 13, 18, 0), at('2027-03-13T18:00:00-05:00'));
  assert.equal(cw.wall(2027, 3, 14, 18, 0), at('2027-03-14T18:00:00-04:00'));
  const x = cw.et(at('2026-11-01T17:30:00-05:00'));
  assert.deepEqual([x.y, x.mo, x.d, x.h, x.mi, x.dow], [2026, 11, 1, 17, 30, 0]);
});

test('the strip is seven Burlington days from today, each in time order', () => {
  const clubs = [
    club('late', [meet('sat', '18:30')]),
    club('early', [meet('sat', '07:30'), meet('sun', '08:00')]),
    club('mid', [meet('sat', '12:00'), meet('fri', '17:45')]),
  ];
  /* 11 pm Friday in Burlington is already Saturday in UTC and in Auckland */
  const fri = cw.weekStrip(clubs, at('2026-10-16T23:00:00-04:00'));
  assert.equal(fri[0].key, '2026-10-16');
  assert.equal(fri[0].wd, 'Fri');
  assert.ok(fri[0].today && fri[1].tomorrow);
  assert.deepEqual(fri.map((d) => d.key), ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']);
  assert.deepEqual(fri[1].meets.map((o) => o.club.id), ['early', 'mid', 'late']);
  assert.deepEqual(fri[1].meets.map((o) => o.time), ['7:30 am', '12 pm', '6:30 pm']);
  assert.equal(fri[0].meets[0].past, true, 'Friday’s 5:45 pm has gone by 11 pm');
  assert.equal(fri[1].meets[0].past, false);
  assert.equal(fri[1].meets[0].k, 'rc-early-2026-10-17-0730');
  /* the same week seen from Saturday morning starts on Saturday */
  assert.equal(cw.weekStrip(clubs, at('2026-10-17T06:00:00-04:00'))[0].key, '2026-10-17');
});

test('a week across the November change keeps every day once and every meet at its wall time', () => {
  const clubs = [club('wed', [meet('wed', '17:30')]), club('daily', ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => meet(d, '06:00')))];
  const week = cw.weekStrip(clubs, at('2026-10-30T12:00:00-04:00'));
  assert.deepEqual(week.map((d) => d.key), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
  week.forEach((d) => {
    const six = d.meets.find((o) => o.club.id === 'daily');
    const x = cw.et(six.at);
    assert.deepEqual([x.h, x.mi, x.d], [6, 0, d.d], 'daily 6 am on ' + d.key);
  });
  const wed = week[5].meets.find((o) => o.club.id === 'wed');
  assert.equal(wed.at, at('2026-11-04T17:30:00-05:00'));
  /* and the March change */
  const spring = cw.weekStrip(clubs, at('2027-03-12T09:00:00-05:00'));
  assert.equal(spring[2].key, '2027-03-14');
  assert.equal(spring[2].meets[0].at, at('2027-03-14T06:00:00-04:00'));
  assert.equal(spring[1].meets[0].at, at('2027-03-13T06:00:00-05:00'));
});

test('seasons: months, a meet’s own months, from and until (inclusive)', () => {
  const clubs = [
    club('summer', [meet('wed', '18:00')], { months: [5, 6, 7, 8, 9] }),
    club('winter', [meet('wed', '18:00')], { months: [12, 1, 2] }),
    club('track', [meet('tue', '17:45'), meet('thu', '17:45', { months: [6, 7, 8] })]),
    club('ends', [meet('wed', '18:30')], { until: '2026-10-28' }),
    club('starts', [meet('fri', '11:00')], { months: [10, 11, 12, 1, 2, 3, 4, 5], from: '2026-11-06' }),
    club('indoor', [meet('wed', '17:30', { from: '2026-10-14', until: '2027-03-10' })]),
    club('override', [meet('mon', '18:00', { months: [10] })], { months: [5, 6] }),
  ];
  const ids = (from, to) => cw.meetsInWindow(clubs, at(from), at(to)).map((o) => o.club.id + ' ' + o.date);
  assert.deepEqual(ids('2026-10-19T00:00:00-04:00', '2026-10-26T00:00:00-04:00'),
    ['override 2026-10-19', 'track 2026-10-20', 'indoor 2026-10-21', 'ends 2026-10-21']);
  assert.deepEqual(ids('2026-10-28T00:00:00-04:00', '2026-10-29T00:00:00-04:00'), ['indoor 2026-10-28', 'ends 2026-10-28'], 'until is the last day, kept');
  assert.deepEqual(ids('2026-11-04T00:00:00-05:00', '2026-11-07T00:00:00-05:00'), ['indoor 2026-11-04', 'starts 2026-11-06'], 'from is the first day, kept');
  assert.deepEqual(ids('2026-07-01T00:00:00-04:00', '2026-07-03T00:00:00-04:00'), ['summer 2026-07-01', 'ends 2026-07-01', 'track 2026-07-02'], 'until alone has no start');
  assert.deepEqual(ids('2027-01-06T00:00:00-05:00', '2027-01-07T00:00:00-05:00'), ['indoor 2027-01-06', 'winter 2027-01-06']);
  assert.deepEqual(ids('2027-03-17T00:00:00-04:00', '2027-03-18T00:00:00-04:00'), [], 'after the indoor series, and out of the summer and winter months');
});

test('windows: now is three hours, tonight is from 4 pm, tomorrow is the whole day', () => {
  const clubs = [club('a', [meet('sat', '07:30'), meet('sat', '16:00'), meet('sat', '18:00'), meet('sun', '00:30'), meet('sun', '08:00'), meet('sun', '23:45'), meet('mon', '00:00')])];
  const w = (name, now) => { const x = cw.windowFor(name, at(now)); return cw.meetsInWindow(clubs, x.from, x.to).map((o) => o.date + ' ' + o.time); };
  assert.deepEqual(w('now', '2026-10-17T15:30:00-04:00'), ['2026-10-17 4 pm', '2026-10-17 6 pm']);
  assert.deepEqual(w('now', '2026-10-17T15:00:00-04:00'), ['2026-10-17 4 pm'], 'six o’clock is the window’s far edge, left out');
  assert.deepEqual(w('now', '2026-10-17T16:00:00-04:00'), ['2026-10-17 4 pm', '2026-10-17 6 pm'], 'a meet starting this minute is in');
  assert.deepEqual(w('now', '2026-10-17T16:01:00-04:00'), ['2026-10-17 6 pm'], 'one that started a minute ago is not');
  assert.deepEqual(w('now', '2026-10-17T22:00:00-04:00'), ['2026-10-18 12:30 am'], 'Now runs past midnight');
  assert.deepEqual(w('tonight', '2026-10-17T09:00:00-04:00'), ['2026-10-17 4 pm', '2026-10-17 6 pm']);
  assert.deepEqual(w('tonight', '2026-10-17T17:00:00-04:00'), ['2026-10-17 6 pm'], 'tonight starts now once it is past 4');
  assert.deepEqual(w('tonight', '2026-10-17T23:00:00-04:00'), []);
  assert.deepEqual(w('tomorrow', '2026-10-17T23:00:00-04:00'), ['2026-10-18 12:30 am', '2026-10-18 8 am', '2026-10-18 11:45 pm'], 'tomorrow ends at midnight');
  /* the night the clocks go back is a 25-hour day, and tomorrow is all of it */
  const x = cw.windowFor('tomorrow', at('2026-10-31T12:00:00-04:00'));
  assert.equal(x.to - x.from, 25 * 3600000);
  const y = cw.windowFor('tomorrow', at('2027-03-13T12:00:00-05:00'));
  assert.equal(y.to - y.from, 23 * 3600000);
});

test('nextMeet finds the next one, days away if it must', () => {
  const clubs = [club('wed', [meet('wed', '17:30')]), club('summer', [meet('mon', '18:00')], { months: [6] })];
  const n = cw.nextMeet(clubs, at('2026-10-22T09:00:00-04:00'));
  assert.equal(n.club.id, 'wed');
  assert.equal(n.date, '2026-10-28');
  assert.equal(cw.nextMeet([club('summer', [meet('mon', '18:00')], { months: [6] })], at('2026-10-22T09:00:00-04:00')), null);
});

test('a filter picks run clubs or the rest', () => {
  const clubs = [club('run', [meet('sat', '08:00')]), club('ride', [meet('sat', '09:00')], { kind: 'bike' })];
  const day = cw.weekStrip(clubs, at('2026-10-17T06:00:00-04:00'))[0];
  assert.equal(day.meets.length, 2);
  assert.deepEqual(cw.weekStrip(clubs, at('2026-10-17T06:00:00-04:00'), cw.isRun)[0].meets.map((o) => o.club.id), ['run']);
  assert.deepEqual(cw.weekStrip(clubs, at('2026-10-17T06:00:00-04:00'), cw.isFitness)[0].meets.map((o) => o.club.id), ['ride']);
});

test('broken entries are skipped, never thrown on', () => {
  const clubs = [null, 'x', { id: 'no-meets', name: 'No meets' }, club('bad', [null, meet('sat', '6pm'), meet('saturday', '08:00'), meet('sat', '08:00')]), club('', [meet('sat', '08:00')])];
  assert.deepEqual(cw.weekStrip(clubs, at('2026-10-17T06:00:00-04:00'))[0].meets.map((o) => o.club.id), ['bad']);
  assert.deepEqual(cw.meetsInWindow(clubs, 10, 5), []);
});

test('mapUrl and oneLine', () => {
  assert.equal(cw.mapUrl(meet('sat', '08:00', { lat: 44.4917, lng: -73.1858 })), 'https://www.google.com/maps/search/?api=1&query=44.4917%2C-73.1858');
  assert.equal(cw.mapUrl(meet('sat', '08:00', { lat: null, lng: null, address: '1 Main St, Winooski' })), 'https://www.google.com/maps/search/?api=1&query=1%20Main%20St%2C%20Winooski');
  assert.equal(cw.mapUrl(meet('sat', '08:00', { lat: null, lng: null })), '');
  assert.equal(cw.oneLine('"All are welcome." New runners are pointed to the FAQ.'), 'All are welcome.');
  assert.equal(cw.oneLine('about 3 miles at a 10:30 to 10:45 pace; no pets'), 'about 3 miles at a 10:30 to 10:45 pace');
  assert.equal(cw.oneLine("'Beginners and all levels welcome.'"), 'Beginners and all levels welcome.');
  assert.equal(cw.oneLine(''), '');
  const long = cw.oneLine('word '.repeat(40), 30);
  assert.ok(long.length <= 30 && long.endsWith('…'), long);
  /* every newcomer line in the real file fits on one line */
  REAL.forEach((c) => {
    const s = cw.oneLine(c.newcomers);
    assert.ok(s.length <= 90 && !/["“”]/.test(s), c.id + ': ' + s);
    if (String(c.newcomers || '').trim()) assert.ok(s.length > 3, c.id);
  });
});

test('the real directory, the week of October 17, 2026', () => {
  const week = cw.weekStrip(REAL, at('2026-10-17T09:00:00-04:00'));
  const ids = new Set(week.flatMap((d) => d.meets.map((o) => o.club.id)));
  ['winooski-run-club', 'burlington-hash-house-harriers', 'long-trail-running-club', 'gmaa', 'vermont-dodgeball', 'btown-brief-pickup-basketball'].forEach((id) => assert.ok(ids.has(id), id + ' runs this week'));
  ['fleet-feet-frosty-turtles', 'catamount-trail-running-series', 'skirack-run-club', 'miller-center-drop-in-pickleball', 'vermont-womxns-pickup-soccer', 'gmbc-wednesday-training-ride'].forEach((id) => assert.ok(!ids.has(id), id + ' is out of season'));
  assert.ok(!week.flatMap((d) => d.meets).some((o) => o.club.id === 'gmaa' && o.meet.day === 'thu'), 'GMAA’s summer track Thursday is off');
  week.forEach((d) => d.meets.forEach((o, i) => { if (i) assert.ok(o.at >= d.meets[i - 1].at, d.key + ' in order'); }));
  /* November: the hash has finished, the Miller Center has reopened */
  const nov = new Set(cw.weekStrip(REAL, at('2026-11-07T09:00:00-05:00')).flatMap((d) => d.meets.map((o) => o.club.id)));
  assert.ok(!nov.has('burlington-hash-house-harriers') && nov.has('miller-center-drop-in-pickleball') && !nov.has('winooski-run-club'));
});

test('redateDemo moves the relative meets to the reader’s day, and keeps the rest', () => {
  const now = at('2026-10-17T23:20:00-04:00');
  const out = cw.redateDemo(DEMO, now);
  assert.notEqual(out, DEMO);
  const rel = DEMO.clubs.flatMap((c, i) => c.meets.map((m, j) => [i, j, m])).filter(([, , m]) => typeof m.in_hours === 'number');
  assert.ok(rel.length >= 1, 'the demo has a relative meet');
  rel.forEach(([i, j, m]) => {
    const r = out.clubs[i].meets[j];
    assert.equal(r.in_hours, undefined);
    const o = cw.meetsInWindow(out.clubs, now, now + (m.in_hours + 0.25) * 3600000).find((x) => x.club.id === out.clubs[i].id && x.meet === r);
    assert.ok(o, 'relative meet ' + out.clubs[i].id + ' lands ' + m.in_hours + 'h on');
  });
  assert.ok(cw.meetsInWindow(out.clubs, cw.windowFor('now', now).from, cw.windowFor('now', now).to).length >= 1, 'the demo always has something Now');
  /* every demo meet is a real shape */
  out.clubs.forEach((c) => c.meets.forEach((m) => assert.match(m.time, /^([01]\d|2[0-3]):[0-5]\d$/)));
});
