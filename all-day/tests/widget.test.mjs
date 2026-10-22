// The home-screen widget (all-day/widget/btown-widget.js) under a strict
// stand-in for Scriptable (scriptable-mock.mjs): every size draws without
// an error, taps go to the right tab, the phone re-applies the weather
// page's 90-minute rule, and with no signal it draws the last good copy
// and says Offline. It makes one request, to the widget file, and no other.
//
//   node --test all-day/tests/widget.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runWidget, texts, urls } from './scriptable-mock.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = await readFile(path.join(HERE, '../widget/btown-widget.js'), 'utf8');
const DATA_URL = 'https://guide.btownbrief.com/all-day/data/widget.json';
const APP = 'https://guide.btownbrief.com/all-day/';
const MIN = 60000, HOUR = 60 * MIN;

/* a widget.json in build_widget.py's shape, dated to the real clock */
export function sample(now = Date.now(), over = {}) {
  const iso = (ms) => new Date(ms).toISOString();
  const top = Math.floor(now / HOUR) * HOUR;
  return {
    v: 1, updated: iso(now - 10 * MIN), app: APP,
    weather: {
      temp: 52, sky: 'Sunny', from: 'airport', hi: 55, lo: 31, rain: 'Dry through tonight',
      obs: { temp: 52, sky: 'Sunny', at: iso(now - 30 * MIN) },
      hours: [0, 1, 2, 3].map((i) => ({ t: iso(top + i * HOUR), temp: 60 + i, sky: 'Partly Sunny' })),
      link: 'https://guide.btownbrief.com/weather.html',
    },
    wire: [
      { title: 'Scott and Janoo differ on healthcare, school consolidation and taxes in first debate', src: 'Vermont Public', url: 'https://x.test/1', link: APP + '#wire/a1' },
      { title: 'CSWD drop-off center fire tied to improper disposal', src: 'WCAX', url: 'https://x.test/2', link: APP + '#wire/a2' },
      { title: '5 takeaways from the first debate of the campaign', src: 'VTDigger', url: 'https://x.test/3', link: APP + '#wire/a3' },
    ],
    tonight: [
      { title: 'Gaelic Storm', time: '7 pm', venue: 'Higher Ground', start: iso(now + 2 * HOUR), end: null, url: 'https://e.test/1', link: APP + '#whatnow/tonight' },
      { title: 'Bored Teachers', time: '7:30 pm', venue: 'The Flynn', start: iso(now + 2.5 * HOUR), end: null, url: 'https://e.test/2', link: APP + '#whatnow/tonight' },
    ],
    game: { title: "UVM Women's Soccer vs UAlbany", when: 'Today 6 pm', start: iso(now + 5 * HOUR), all_day: false, home: true, tv: 'ESPN+', url: 'https://u.test', link: 'https://guide.btownbrief.com/sports.html' },
    ...over,
  };
}

const online = (data) => (url) => { if (url !== DATA_URL) throw new Error('unexpected ' + url); return data; };

for (const family of ['small', 'medium', 'large', 'extraLarge', 'accessoryRectangular', 'accessoryInline', 'accessoryCircular']) {
  test(family + ': draws, sets the widget once, completes, one request only', async () => {
    const { log, widget } = await runWidget(SRC, { family, respond: online(sample()) });
    assert.equal(log.set.length, 1);
    assert.equal(log.completed, 1);
    assert.deepEqual(log.requests, [DATA_URL]);
    assert.ok(widget.url.startsWith(APP), widget.url);
    assert.ok(widget.refreshAfterDate instanceof Date);
    const all = texts(widget).join(' | ');
    assert.match(all, /52°/);
    assert.doesNotMatch(all, /undefined|null|NaN/);
  });
}

test('small: the weather and tonight’s top pick, and the tap opens Tonight', async () => {
  const { widget } = await runWidget(SRC, { family: 'small', respond: online(sample()) });
  const all = texts(widget);
  assert.ok(all.includes('All Day'));
  assert.ok(all.includes('Sunny · H 55°  L 31°'), all.join(' | '));
  assert.ok(all.includes('TONIGHT') && all.includes('Gaelic Storm') && all.includes('7 pm · Higher Ground'), all.join(' | '));
  assert.equal(widget.url, APP + '#whatnow/tonight');
});

test('medium: two Wire headlines that open their stories, tonight’s first pick, the rain line', async () => {
  const { widget } = await runWidget(SRC, { family: 'medium', respond: online(sample()) });
  const all = texts(widget);
  assert.ok(all.includes('THE WIRE') && all.includes('TONIGHT'));
  assert.ok(all.some((x) => /^Scott and Janoo/.test(x)) && all.some((x) => /^CSWD/.test(x)) && !all.some((x) => /^5 takeaways/.test(x)));
  assert.ok(all.includes('Dry through tonight') && all.includes('H 55°  L 31°'));
  const u = urls(widget);
  assert.ok(u.includes(APP + '#wire/a1') && u.includes(APP + '#wire/a2') && u.includes(APP + '#wire') && u.includes(APP + '#whatnow/tonight'), u.join(' '));
  assert.ok(u.includes('https://guide.btownbrief.com/weather.html'));
});

test('medium with nothing on tonight shows a third headline instead', async () => {
  const { widget } = await runWidget(SRC, { family: 'medium', respond: online(sample(Date.now(), { tonight: [] })) });
  const all = texts(widget);
  assert.ok(all.some((x) => /^5 takeaways/.test(x)) && !all.includes('TONIGHT'));
});

test('large: three headlines with their outlets, two picks, the next game', async () => {
  const { widget } = await runWidget(SRC, { family: 'large', respond: online(sample()) });
  const all = texts(widget);
  for (const s of ['THE WIRE', 'Vermont Public', 'WCAX', 'VTDigger', 'TONIGHT', 'Gaelic Storm · Higher Ground', 'Bored Teachers · The Flynn', 'NEXT GAME', "UVM Women's Soccer vs UAlbany"]) {
    assert.ok(all.includes(s), s + ' in ' + all.join(' | '));
  }
  assert.ok(all.some((x) => /^Today \d{1,2}(:\d\d)? (am|pm) · Home · ESPN\+$/.test(x)), all.join(' | '));
  assert.ok(all.some((x) => /^Updated \d/.test(x)));
  assert.ok(urls(widget).includes('https://guide.btownbrief.com/sports.html'));
});

test('offline with a saved copy: draws it and says Offline', async () => {
  const saved = sample();
  const { widget, log } = await runWidget(SRC, { family: 'medium', cache: saved });
  const all = texts(widget);
  assert.deepEqual(log.requests, [DATA_URL]);
  assert.ok(all.some((x) => /^Offline · \d/.test(x)), all.join(' | '));
  assert.ok(all.some((x) => /^Scott and Janoo/.test(x)));
  for (const family of ['small', 'large', 'accessoryRectangular']) {
    const r = await runWidget(SRC, { family, cache: saved });
    assert.ok(texts(r.widget).some((x) => /^Offline/.test(x)), family);
  }
  /* a copy from another day names the day */
  const old = sample(Date.now(), { updated: new Date(Date.now() - 2 * 86400000).toISOString() });
  const r = await runWidget(SRC, { family: 'medium', cache: old });
  assert.ok(texts(r.widget).some((x) => /^Offline · (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d/.test(x)), texts(r.widget).join(' | '));
});

test('offline the very first time: one plain Offline widget, no error', async () => {
  for (const family of ['small', 'medium', 'large', 'accessoryInline']) {
    const { widget, log } = await runWidget(SRC, { family });
    assert.equal(log.set.length, 1, family);
    assert.equal(widget.url, APP);
    if (family !== 'accessoryInline') assert.ok(texts(widget).includes(family.startsWith('accessory') ? '–' : 'Offline'), family + ': ' + texts(widget).join('|'));
  }
});

test('a good fetch is saved on the phone for next time; a bad file is not', async () => {
  const { log } = await runWidget(SRC, { family: 'small', respond: online(sample()) });
  assert.ok(JSON.parse(log.files.get('/docs/btown-brief-widget.json')).updated);
  const bad = await runWidget(SRC, { family: 'small', respond: () => ({ oops: 1 }), cache: sample() });
  assert.ok(texts(bad.widget).some((x) => /^Offline/.test(x)));
});

test('opened in the Scriptable app: a medium preview', async () => {
  const { log } = await runWidget(SRC, { runsInWidget: false, respond: online(sample()) });
  assert.deepEqual(log.presented, ['medium']);
  assert.equal(log.set.length, 0);
  assert.equal(log.completed, 1);
});

test('the 90-minute rule runs again on the phone', async () => {
  const { api } = await runWidget(SRC, { noMain: true });
  const now = Date.now();
  const w = sample(now).weather;
  w.obs.at = new Date(now - 89 * MIN).toISOString();
  assert.equal(api.weatherNow(w, now).temp, 52);
  w.obs.at = new Date(now - 91 * MIN).toISOString();
  assert.equal(api.weatherNow(w, now).temp, 60);        // this hour's forecast row
  assert.equal(api.weatherNow(w, now + HOUR).temp, 61);  // and an hour later, the next one
  assert.equal(api.weatherNow({ temp: 40, sky: 'Cloudy', hours: [] }, now).temp, 40);
  assert.equal(api.weatherNow(null, now), null);
});

test('a show that has started or ended drops off, and so does a played game', async () => {
  const { api } = await runWidget(SRC, { noMain: true });
  const now = Date.now(), iso = (ms) => new Date(ms).toISOString();
  const list = [
    { title: 'Started an hour ago', start: iso(now - HOUR) },
    { title: 'Started three hours ago', start: iso(now - 3 * HOUR) },
    { title: 'Ended', start: iso(now - HOUR), end: iso(now - MIN) },
    { title: 'Later', start: iso(now + HOUR) },
  ];
  assert.deepEqual(api.tonightNow(list, now).map((e) => e.title), ['Started an hour ago', 'Later']);
  assert.equal(api.gameNow({ title: 'g', start: iso(now - 3 * HOUR) }, now), null);
  assert.ok(api.gameNow({ title: 'g', start: iso(now - 2 * HOUR) }, now));
});

test('times read the app’s way, in Burlington', async () => {
  const { api } = await runWidget(SRC, { noMain: true });
  assert.equal(api.clock(Date.parse('2026-10-22T23:00:00Z')), '7 pm');
  assert.equal(api.clock(Date.parse('2026-10-22T23:30:00Z')), '7:30 pm');
  const now = Date.parse('2026-10-22T16:00:00Z');
  assert.equal(api.gameWhen({ start: '2026-10-22T22:00:00Z' }, now), 'Today 6 pm');
  assert.equal(api.gameWhen({ start: '2026-10-23T23:00:00Z' }, now), 'Tomorrow 7 pm');
  assert.equal(api.gameWhen({ start: '2026-10-24T18:00:00Z', all_day: true }, now), 'Sat');
  assert.equal(api.skySymbol('Rain Showers', now), 'cloud.rain.fill');
  assert.equal(api.skySymbol('Sunny', now), 'sun.max.fill');
});

test('the mock is strict: a property Scriptable lacks throws', async () => {
  await assert.rejects(runWidget(SRC.replace('x.lineLimit = lines', 'x.lineLimt = lines'), { family: 'small', respond: online(sample()) }), /has no property lineLimt/);
});
