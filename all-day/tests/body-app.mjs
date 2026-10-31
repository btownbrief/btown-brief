// Body's tabs (wave 1 of the eight apps, 2026-10-29): Today (Habits beside
// Stephen's template), Train, Recover and Fuel. Run from
// allday.spec.mjs as the group theBody (ONLY=theBody while iterating); the
// shell's helpers come in as `h` so this file adds no second harness.
//
// Screenshots: body-<tab>-<390|1280>-<light|dark>.png in tests/shots/, demo.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TABS = ['day', 'template', 'train', 'leagues', 'recover', 'fuel'];
const LABELS = ['Today', 'Habits', 'Train', 'Leagues', 'Recover', 'Fuel'];
const COMBOS = [
  { viewport: { width: 390, height: 844 }, scheme: 'light' }, { viewport: { width: 390, height: 844 }, scheme: 'dark' },
  { viewport: { width: 1280, height: 800 }, scheme: 'light' }, { viewport: { width: 1280, height: 800 }, scheme: 'dark' },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function bodyTests(browser, base, h) {
  const { group, check, newPage, pageRules, SHOTS, REPO } = h;
  const json = async (f) => JSON.parse(await readFile(path.join(REPO, 'data/body', f), 'utf8'));
  const tpl = await json('template-stephen.json');
  const W = await json('workouts.json');
  const G = await json('gyms.json');
  const R = await json('recover.json');
  const SP = await json('recover-spots.json');
  const F = await json('fuel.json');
  const panel = (k) => '#panel-' + k;
  const sec = (k, s) => panel(k) + ' [data-sec="' + s + '"]';
  const ready = (page, k) => page.waitForSelector(panel(k) + ' [data-body="' + k + '"]', { timeout: 10000 });
  const text = (page, sel) => page.$eval(sel, (n) => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
  const toast = async (page) => { await page.waitForSelector('#toast:not([hidden])', { timeout: 6000 }).catch(() => {}); return page.$eval('#toast', (t) => t.textContent).catch(() => ''); };
  const nyDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const daysBack = (n) => { const d = new Date(nyDay() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const scores = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('allday-body-day-score') || '{}'));

  await group('Body, Today: the day as tiles, one tap each, finished ones sink', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.route(/maps\.vcgi\.vermont\.gov/, (r) => r.abort());
    await page.goto(base + '/body/');
    await page.waitForSelector('.dy-wrap');
    await sleep(300);
    const ring = () => page.$eval('.dy-ring b', (n) => n.textContent);
    const order = () => page.$$eval('.dy-tile:not(.dy-live)', (n) => n.map((x) => x.dataset.tile));
    check((await ring()) === '0/6', 'six things to do today', await ring());
    check(JSON.stringify((await order()).slice(0, 3)) === '["water","protein","train"]' || (await order()).length === 8, 'every tile draws', (await order()).join());
    check(!(await page.$('#panel-day input, #panel-day textarea')), 'nothing to type', '');
    const goal = F.defaults.water.goal_oz, tap = F.defaults.water.tap_oz;
    await page.click('[data-add="water"]');
    check((await page.$eval('.dy-water [data-num]', (n) => n.textContent)) === String(tap), 'a tap adds water', '');
    await page.click('#tab-fuel');
    await sleep(500);
    check(new RegExp('^' + tap + ' oz').test(await page.$eval('#panel-fuel [data-water]', (n) => n.innerText)), 'Fuel shows the same water', await page.$eval('#panel-fuel [data-water]', (n) => n.innerText));
    await page.click('#tab-day');
    await sleep(200);
    for (let n = tap; n < goal; n += tap) await page.click('[data-add="water"]');
    check((await ring()) === '1/6' && (await order()).at(-1) === 'water' && !!(await page.$('.dy-water.is-done')), 'at the goal, water is done and sinks to the bottom', (await order()).join());
    await page.click('[data-tick="train"]');
    check((await ring()) === '2/6' && !!(await page.$('.dy-train.is-done')), 'a tick finishes a tile', '');
    await page.click('[data-tick="train"]');
    check((await ring()) === '1/6', 'and a second tap undoes it', '');
    for (const id of ['train', 'sprints', 'stretch']) await page.click('[data-tick="' + id + '"]');
    check(/1 day/.test(await page.$eval('.dy-hero', (n) => n.innerText)), 'four done keeps the streak: 1 day', await page.$eval('.dy-hero', (n) => n.innerText));
    const done = await page.evaluate(() => JSON.parse(localStorage.getItem('allday-body-day')));
    const key = Object.keys(done)[0];
    const back = (n) => { const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
    await page.evaluate(([y, z]) => { const d = JSON.parse(localStorage.getItem('allday-body-day')); d[y] = ['train', 'sprints', 'stretch', 'breathe']; d[z] = ['train']; localStorage.setItem('allday-body-day', JSON.stringify(d)); }, [back(1), back(2)]);
    await page.reload();
    await page.waitForSelector('.dy-wrap');
    await sleep(300);
    check(/2 days/.test(await page.$eval('.dy-hero', (n) => n.innerText)), 'yesterday counts, and a thin day ends the run', await page.$eval('.dy-hero', (n) => n.innerText));
    check((await page.$$('.dy-week i.on')).length === 2, 'the week strip marks both days', '');
    check(!errors.filter((e) => !/ERR_FAILED|Failed to load resource/.test(e)).length, 'no console errors', errors.join(' | ').slice(0, 200));
    await ctx.close();
    const d = await newPage(browser, base);
    await d.page.goto(base + '/body/?demo=1');
    await d.page.waitForSelector('.dy-wrap');
    await sleep(300);
    const before = await d.page.evaluate(() => localStorage.getItem('allday-body-day'));
    await d.page.click('[data-tick="train"]');
    check(!before && !(await d.page.evaluate(() => localStorage.getItem('allday-body-day'))), 'the demo writes nothing', '');
    await d.ctx.close();
  });

  /* Today on stub files: what each case says exists, and everything else 404s */
  const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();
  const DOT = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const WEATHER = () => ({ now: { temp_f: 61, observed_at: inHours(-1) }, lake_gage: { water_temp_f: 54, water_temp_at: inHours(-1) },
    sun: { sunrise: inHours(-5), sunset: inHours(5), sunrise_tomorrow: inHours(19), sunset_tomorrow: inHours(29) },
    air: { aqi: 40 }, hourly: { hours: [[1, 60, 20], [2, 0, 5], [3, 30, 10], [20, 0, 5]].map(([h, pop, wind]) => ({ t: new Date(Math.floor(Date.now() / 3600000) * 3600000 + h * 3600000).toISOString(), pop, wind_mph: wind, sky: 50, temp_f: 60 })) } });
  const ONE_CLUB = { clubs: [{ id: 'c', name: 'Sample Run Club', kind: 'run', url: 'https://example.com/c',
    meets: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => ({ day, time: '23:59', where: 'Sample Green', lat: 44.5, lng: -73.2 })) }] };
  const MOVES = () => ({ events: [{ at: inHours(2), title: 'Open Gym', where: 'The Gym', url: 'https://example.com/g' }, { at: inHours(-2), title: 'Gone Already', where: 'The Gym', url: 'https://example.com/x' }],
    aerials: {}, scene: [{ id: 'dead', h: 'first', pic: base + '/pics/dead.jpg', url: 'https://example.com/1', ts: 1 }, { id: 'ok', h: 'second', pic: base + '/pics/ok.jpg', url: 'https://example.com/2', ts: 1 }] });
  const dayAfter = (n) => daysBack(-n);
  const LEAGUES = () => ({ organizers: [{ id: 'o', name: 'Sample Org', sports: [{ sport: 'Volleyball', signup_open: true, signup_until: dayAfter(5), url: 'https://example.com/v' }, { sport: 'Volleyball', signup_open: true, signup_until: dayAfter(9) }, { sport: 'Soccer', signup_open: true, signup_until: dayAfter(40) }, { sport: 'Tennis', signup_open: false, signup_until: dayAfter(2) }, { sport: 'Pool', signup_open: true }, { sport: 'Cricket', signup_open: true, signup_until: dayAfter(-1) }, { sport: 'Rugby', signup_open: true, ends: dayAfter(-1) }] }] });
  const RACES = () => ({ races: [{ id: '1', name: 'Near Race', day: dayAfter(2), town: 'Burlington', url: 'https://example.com/r' }, { id: '2', name: 'Far Race', day: dayAfter(30), town: 'Burlington', url: 'https://example.com/f' }, { id: '3', name: 'Past Race', day: dayAfter(-1), town: 'Burlington', url: 'https://example.com/p' }, { id: '4', name: 'Too Far Race', day: dayAfter(95), town: 'Burlington', url: 'https://example.com/t' }] });
  async function todayPage(files) {
    const p = await newPage(browser, base);
    const serve = (re, body) => p.page.route(re, (r) => (body ? r.fulfill({ json: body }) : r.fulfill({ status: 404, body: 'no' })));
    await serve(/data\/weather\/latest\.json/, files.weather);
    await serve(/data\/town\/moves\.json/, files.moves);
    await serve(/data\/town\/races\.json/, files.races);
    await serve(/data\/run-clubs\.json/, files.clubs);
    await serve(/data\/body\/leagues\.json/, files.leagues);
    await p.page.route(/\/pics\/ok/, (r) => r.fulfill({ contentType: 'image/gif', body: DOT }));
    await p.page.route(/\/pics\/dead/, (r) => r.fulfill({ status: 403, body: 'no' }));
    await p.page.goto(base + '/body/');
    await p.page.waitForSelector('.dy-wrap');
    await sleep(500);
    return p;
  }
  const chipsOf = (page) => page.$$eval('.dy-hero .tf-chip.wx', (n) => n.map((x) => x.textContent));
  const liveTiles = (page) => page.$$eval('.dy-live', (n) => n.map((x) => x.dataset.tile));
  const scoreBoard = (page) => page.evaluate(() => ({ ring: document.querySelector('.dy-ring b').textContent, streak: document.querySelector('.dy-hero .tf-chip.run')?.textContent || '', week: document.querySelectorAll('.dy-week i.on').length }));

  await group('Body, Today: Outside now, Moving this week, Scene pictures and Races, with the day’s score untouched', async () => {
    const seedDays = (page) => page.evaluate(([y]) => { localStorage.setItem('allday-body-day-score', JSON.stringify({ [y]: 4 })); }, [daysBack(1)]);
    const none = await todayPage({});
    await seedDays(none.page);
    await none.page.reload();
    await none.page.waitForSelector('.dy-wrap');
    await sleep(400);
    await none.page.click('[data-tick="train"]');
    const without = await scoreBoard(none.page);
    check(!(await liveTiles(none.page)).length && !(await chipsOf(none.page)).length, 'no files: no live tiles, no chips, no empty box', JSON.stringify(await liveTiles(none.page)));
    check((await none.page.$$('.dy-tile:not(.dy-live)')).length === 8 && !!(await none.page.$('.dy-hero .dy-ring')), 'and Today still works', '');
    check(!none.errors.filter((e) => !/404|Failed to load/.test(e)).length, 'no console errors', none.errors.join(' | ').slice(0, 200));
    await none.ctx.close();

    const all = await todayPage({ weather: WEATHER(), moves: MOVES(), races: RACES(), clubs: ONE_CLUB, leagues: LEAGUES() });
    await seedDays(all.page);
    await all.page.reload();
    await all.page.waitForSelector('.dy-live');
    await sleep(500);
    await all.page.click('[data-tick="train"]');
    const withAll = await scoreBoard(all.page);
    check(JSON.stringify(withAll) === JSON.stringify(without), 'the ring, the streak and the week read the same with every live tile showing', JSON.stringify([without, withAll]));
    check(JSON.stringify(await liveTiles(all.page)) === '["moves","scene","soon"]', 'the three live tiles, above the tools', (await liveTiles(all.page)).join());
    check((await all.page.$eval('.dy-wrap', (n) => n.children[1].dataset.tile)) === 'moves', 'Moving this week comes first', '');
    const chips = await chipsOf(all.page);
    check(chips[0] === '61°' && chips[1] === 'Lake 54°' && /^Sunset \d/.test(chips[2]) && /^Best hour \d+ [AP]M$/.test(chips[3]) && chips.length === 4, 'Outside now: the four chips, no air chip on a clean day', chips.join(' | '));
    const best = new Date(Math.floor(Date.now() / 3600000) * 3600000 + 2 * 3600000).toLocaleTimeString('en-US', { hour: 'numeric', timeZone: 'America/New_York' });
    check(chips[3] === 'Best hour ' + best, 'the best hour is the driest, calmest one left', chips[3] + ' vs ' + best);
    const moves = await all.page.$$eval('.dy-moves li:not([hidden]) .n', (n) => n.map((x) => x.firstChild.textContent));
    check(moves[0] === 'Open Gym' && moves.includes('Sample Run Club') && !moves.includes('Gone Already') && moves.length === 8, 'clubs and classes together, nothing that has started, eight rows', moves.join());
    check(/Moving this week/.test(await all.page.$eval('.dy-moves h3', (n) => n.textContent)), 'its title', '');
    await all.page.waitForSelector('.dy-scene .tf-pic.on');
    const scene = await all.page.$eval('.dy-scene', (n) => n.innerText);
    check(/@second/.test(scene) && !/@first/.test(scene), 'a dead picture gives way to the next post', scene);
    check((await all.page.$eval('.dy-scene', (n) => n.dataset.k)) === 'dy-scene-ok', 'a star belongs to its post, not to the tile', '');
    const soon = await all.page.$$eval('.dy-soon .n', (n) => n.map((x) => x.firstChild.textContent));
    check(JSON.stringify(soon) === JSON.stringify(['Near Race', 'Sample Org Volleyball', 'Far Race', 'Sample Org Soccer', 'Sample Org Pool']), 'Races and signups: by date, open only, none past or closed, undated last', soon.join());
    check(!soon.includes('Too Far Race') && !soon.includes('Sample Org Tennis'), 'nothing past 90 days, no closed signup', soon.join());
    const soonDays = await all.page.$$eval('.dy-soon .d', (n) => n.map((x) => x.textContent));
    check(soonDays[0] === '2 days', 'a countdown', soonDays.join());
    check(/^[A-Z][a-z]{2} \d{1,2}$/.test(soonDays[2]) && soonDays[4] === 'Open', 'past two weeks the date; a signup with no close says Open', soonDays.join());
    check(!(await all.page.$('.dy-soon [data-more]')), 'five rows: no Show more', '');
    const acts = await all.page.$$eval('.dy-live', (n) => n.map((x) => !!x.querySelector('[data-act="share"]') && !!x.querySelector('[data-act="save"]') && !x.querySelector('[data-act="comment"]')));
    check(acts.every(Boolean), 'share and star, no comments', '');
    check(!(await all.page.$$eval('.dy-live', (n) => n.some((x) => /undefined|NaN/.test(x.innerText)))), 'no undefined', '');
    await pageRules(all.page, 'body/day', 390);
    await all.ctx.close();

    /* the long week: eight then Show more, six then Show more, the score untouched */
    const longMoves = { ...MOVES(), events: Array.from({ length: 19 }, (_, i) => ({ at: inHours(i + 1), title: 'Thing ' + i, where: 'The Gym', url: 'https://example.com/' + i })).concat({ at: inHours(1), title: 'Thing-0!', where: 'The Gym', url: 'https://example.com/twin' }) };
    const longRaces = { races: Array.from({ length: 9 }, (_, i) => ({ id: 'r' + i, name: 'Race ' + i, day: dayAfter(80 - i * 8), town: 'Burlington', url: 'https://example.com/r' + i })) };
    const long = await todayPage({ moves: longMoves, races: longRaces, clubs: { clubs: [] } });
    const shown = (sel) => long.page.$$eval(sel + ' li:not([hidden]) .n', (n) => n.map((x) => x.firstChild.textContent));
    const board = await scoreBoard(long.page);
    check((await long.page.$$('.dy-moves li')).length === 19, 'the same thing listed twice shows once, punctuation or no', '');
    check((await shown('.dy-moves')).length === 8 && (await long.page.$eval('.dy-moves [data-more]', (b) => b.textContent)) === 'Show more', 'Moving: eight rows, then Show more', (await shown('.dy-moves')).join());
    const tall = await long.page.$eval('.dy-moves [data-more]', (b) => b.getBoundingClientRect().height);
    check(tall >= 44, 'Show more is a real target', String(tall));
    await long.page.click('.dy-moves [data-more]');
    check((await shown('.dy-moves')).length === 16 && await long.page.$eval('.dy-moves', (c) => c.contains(document.activeElement) && document.activeElement.tagName === 'A'), 'a tap opens eight more and lands on the first of them', '');
    await long.page.click('[data-tick="train"]');
    check((await shown('.dy-moves')).length === 16, 'ticking a tile keeps them open', '');
    await long.page.click('[data-tick="train"]');
    await long.page.click('.dy-moves [data-more]');
    check((await shown('.dy-moves')).length === 19 && !(await long.page.$('.dy-moves [data-more]')), 'the last rows take the button away', '');
    const raceRows = await shown('.dy-soon');
    check(raceRows.length === 6 && raceRows[0] === 'Race 8' && raceRows[5] === 'Race 3', 'Races: six rows, soonest first', raceRows.join());
    await long.page.click('.dy-soon [data-more]');
    check((await shown('.dy-soon')).length === 9 && !(await long.page.$('.dy-soon [data-more]')), 'Show more opens the rest', '');
    check(JSON.stringify(await scoreBoard(long.page)) === JSON.stringify(board), 'Show more moves neither the ring nor the streak', JSON.stringify(board));
    await pageRules(long.page, 'body/day long', 390);
    await long.ctx.close();

    const onlyLeagues = await todayPage({ leagues: LEAGUES() });
    check((await liveTiles(onlyLeagues.page)).join() === 'soon', 'only the league file: the signups tile and nothing empty', (await liveTiles(onlyLeagues.page)).join());
    await onlyLeagues.ctx.close();

    const friday = await todayPage({ moves: MOVES(), clubs: { clubs: [] } });
    check((await friday.page.$$eval('.dy-moves .n', (n) => n.map((x) => x.firstChild.textContent))).join() === 'Open Gym', 'a day with no clubs still has the events', '');
    await friday.ctx.close();

    const dead = { ...MOVES(), scene: [{ id: 'a', h: 'first', pic: base + '/pics/dead.jpg', url: 'https://example.com/1', ts: 1 }] };
    const gone = await todayPage({ moves: dead });
    check(!(await gone.page.$('.dy-scene')), 'the last dead picture takes the tile', '');
    await gone.ctx.close();

    const late = WEATHER();
    late.sun = { sunrise: inHours(-20), sunset: inHours(-3), sunrise_tomorrow: inHours(8), sunset_tomorrow: inHours(30) };
    const eve = await todayPage({ weather: late });
    check((await chipsOf(eve.page)).some((c) => /^Best hour tomorrow \d+ [AP]M$/.test(c)), 'after sunset the best hour is tomorrow’s', (await chipsOf(eve.page)).join(' | '));
    await eve.ctx.close();

    const smoke = await todayPage({ weather: { ...WEATHER(), air: { aqi: 151 } } });
    check((await chipsOf(smoke.page)).includes('Air 151'), 'bad air earns a chip', (await chipsOf(smoke.page)).join(' | '));
    await smoke.ctx.close();

    const demo = await newPage(browser, base);
    const out = [];
    demo.page.on('request', (r) => { if (/fbcdn|cdninstagram|ytimg|runsignup|data\/town\/|latest\.json/.test(r.url())) out.push(r.url()); });
    await demo.page.goto(base + '/body/?demo=1');
    await demo.page.waitForSelector('.dy-live');
    await sleep(400);
    check(JSON.stringify(await liveTiles(demo.page)) === '["moves","scene","soon"]' && (await chipsOf(demo.page)).length >= 3, 'the demo shows them all', (await liveTiles(demo.page)).join());
    check(!out.length, 'the demo reads no live file', out.slice(0, 2).join(' '));
    check(!demo.errors.length, 'no console errors', demo.errors.join(' | ').slice(0, 200));
    await demo.ctx.close();
  });

  await group('Body, Leagues: whatever closes soonest sits on top', async () => {
    const row = (sport, more) => ({ sport, level: 'Open', season: 'Jan', url: 'https://example.com/' + sport, signup_open: true, ...more });
    const file = { organizers: [
      { id: 'late', name: 'Late Org', town: 'Burlington', sports: [row('Soccer', { signup_until: daysBack(-30) })] },
      { id: 'none', name: 'Open Org', town: 'Burlington', sports: [row('Golf'), row('Golf')] },
      { id: 'soon', name: 'Soon Org', town: 'Burlington', sports: [row('Bowling'), row('Volleyball', { signup_until: daysBack(-6) }), row('Hockey', { signup_until: daysBack(-3) }), row('Darts', { signup_until: daysBack(1) })] },
    ] };
    const { ctx, page } = await newPage(browser, base);
    await page.route(/data\/body\/leagues\.json/, (r) => r.fulfill({ json: file }));
    await page.goto(base + '/body/#leagues');
    await page.waitForSelector('.lg-org');
    const orgs = await page.$$eval('.lg-org', (n) => n.map((x) => x.dataset.org));
    check(orgs.join() === 'soon,late,none', 'the organizer closing soonest leads', orgs.join());
    const sports = await page.$$eval('[data-org="soon"] summary span:first-child', (n) => n.map((x) => x.textContent));
    check(sports.slice(0, 2).join() === 'Hockey,Volleyball', 'and the sport inside it, a past date out of the running', sports.join());
    await ctx.close();
  });

  await group('Body, Today: a streak runs past 61 days', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/body/');
    await page.waitForSelector('.dy-wrap');
    const old = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [daysBack(i + 1), 4]));
    await page.evaluate((v) => localStorage.setItem('allday-body-day-score', JSON.stringify(v)), old);
    await page.reload();
    await page.waitForSelector('.dy-wrap');
    await sleep(300);
    check(/100 days/.test(await page.$eval('.dy-hero', (n) => n.innerText)), 'a hundred won days count', await page.$eval('.dy-hero', (n) => n.innerText));
    for (const id of ['train', 'sprints', 'stretch', 'breathe']) await page.click('[data-tick="' + id + '"]');
    check(/101 days/.test(await page.$eval('.dy-hero', (n) => n.innerText)), 'and today makes 101', await page.$eval('.dy-hero', (n) => n.innerText));
    const kept = await scores(page);
    check(kept[daysBack(100)] === 4 && kept[nyDay()] === 4, 'saving today prunes no day', JSON.stringify(Object.keys(kept).length));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Body, Fuel: a goal met in Fuel saves the day’s score, and a new goal leaves past days alone', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/body/#fuel');
    await ready(page, 'fuel');
    await page.evaluate(([k]) => localStorage.setItem('allday-body-day-score', JSON.stringify({ [k]: 4 })), [daysBack(1)]);
    for (let n = 0; n < F.defaults.water.goal_oz; n += F.defaults.water.tap_oz) await page.click('[data-tap="water"]');
    await sleep(200);
    check((await scores(page))[nyDay()] === 1, 'water at the goal counts without opening Today', JSON.stringify(await scores(page)));
    await page.click(sec('fuel', 'water') + ' details.hb-gate summary');
    await page.selectOption(sec('fuel', 'water') + ' select[name="goal"]', '128');
    await sleep(200);
    const after = await scores(page);
    check(after[nyDay()] === 0, 'a higher goal changes today’s score', JSON.stringify(after));
    check(after[daysBack(1)] === 4, 'and not yesterday’s', JSON.stringify(after));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Body, Leagues: ended leagues leave, closed ones say Details, a failed load has Try again', async () => {
    const row = (sport, more) => ({ sport, level: sport + ' level', season: 'Jan 1 to Feb 1', url: 'https://example.com/' + sport, ...more });
    const file = { organizers: [
      { id: 'mixed', name: 'Mixed', town: 'Burlington', sports: [
        row('Rowing', { ends: '2020-01-01', signup_open: true }),
        row('Running', { ends: '2099-01-01', signup_open: true }),
        row('Tennis', { ends: nyDay(), signup_open: false }),
        row('Golf', { signup_open: false }),
      ] },
      { id: 'over', name: 'Over', town: 'Burlington', sports: [row('Curling', { ends: '2020-01-01', signup_open: true })] },
    ] };
    let up = false;
    const { ctx, page } = await newPage(browser, base);
    await page.route(/data\/body\/leagues\.json/, (r) => (up ? r.fulfill({ json: file }) : r.fulfill({ status: 500, body: 'no' })));
    await page.goto(base + '/body/#leagues');
    await page.waitForSelector('#panel-leagues .hb-gate .btn');
    check(/Didn’t load/.test(await text(page, '#panel-leagues')), 'a failed load says so', await text(page, '#panel-leagues'));
    up = true;
    await page.click('#panel-leagues .hb-gate .btn');
    await page.waitForSelector('.lg-wrap');
    check(!(await page.$('#panel-leagues .hb-gate')), 'Try again loads it', '');
    const sports = await page.$$eval('.lg-sport summary', (n) => n.map((x) => x.textContent).sort());
    check(JSON.stringify(sports) === '["Golf","Running","Tennis"]', 'a league past its end leaves, one ending today and one with no end stay', sports.join());
    check(!(await page.$('[data-org="over"]')), 'an organizer with nothing left leaves', '');
    check(!(await page.$('#subnav .secpill .chip:has-text("Curling")')), 'and so does a sport with nothing left', '');
    await page.$$eval('.lg-sport', (n) => n.forEach((d) => { d.open = true; }));
    const go = await page.$$eval('.lg-go', (n) => Object.fromEntries(n.map((a) => [a.getAttribute('href').split('/').pop(), a.textContent.trim()])));
    check(go.Running === 'Sign up' && go.Tennis === 'Details' && go.Golf === 'Details', 'Sign up only while signup is open', JSON.stringify(go));
    await ctx.close();
  });

  await group('Body, Leagues: Sign up turns to Details the day after signup_until, on Burlington’s calendar', async () => {
    const row = (sport, more) => ({ sport, season: 'Jan 1 to Feb 1', url: 'https://example.com/' + sport, ...more });
    const file = { organizers: [{ id: 'dated', name: 'Dated', town: 'Burlington', sports: [
      row('Rowing', { signup: 'Open through Nov 20', signup_open: true, signup_until: '2026-11-20' }),
      row('Running', { signup: 'Open now', signup_open: true }),
      row('Golf', { signup_open: false, signup_until: '2099-01-01' }),
    ] }] };
    const at = async (iso) => {
      const { ctx, page } = await newPage(browser, base, { timezoneId: 'Asia/Tokyo' });
      await page.clock.setFixedTime(new Date(iso));
      await page.route(/data\/body\/leagues\.json/, (r) => r.fulfill({ json: file }));
      await page.goto(base + '/body/#leagues');
      await page.waitForSelector('.lg-wrap');
      await page.$$eval('.lg-sport', (n) => n.forEach((d) => { d.open = true; }));
      const go = await page.$$eval('.lg-go', (n) => Object.fromEntries(n.map((a) => [a.getAttribute('href').split('/').pop(), a.textContent.trim()])));
      await ctx.close();
      return go;
    };
    const last = await at('2026-11-21T04:59:00Z');
    check(last.Rowing === 'Sign up', 'Sign up through the last minute of the date in Burlington', JSON.stringify(last));
    const after = await at('2026-11-21T05:00:00Z');
    check(after.Rowing === 'Details', 'Details from midnight in Burlington', JSON.stringify(after));
    check(after.Running === 'Sign up', 'a row with no date keeps Sign up', JSON.stringify(after));
    check(last.Golf === 'Details', 'a date never opens a closed row', JSON.stringify(last));
  });

  await group('Body, Leagues: the file prints no conflict, and every row has its end and sign-up state', async () => {
    const L = await json('leagues.json');
    const rows = L.organizers.flatMap((o) => o.sports);
    check(!/at signup|on Game On|listed as|Now through/.test(JSON.stringify(L)), 'no conflict text and no "Now through"', '');
    check(rows.every((x) => x.ends === undefined || /^\d{4}-\d{2}-\d{2}$/.test(x.ends)), 'ends is a date or absent', '');
    check(rows.every((x) => !x.season || x.ends || /^(Started|Fall 2026)/.test(x.season)), 'a row with dates has an end', rows.filter((x) => x.season && !x.ends).map((x) => x.season).join());
    check(rows.every((x) => typeof x.signup_open === 'boolean'), 'signup_open on every row', '');
    check(rows.every((x) => !x.signup_open || !/closed|full since|was due|were due/i.test(x.signup || '')), 'no row says closed and open at once', '');
    const DATE = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b/g;
    const dated = rows.filter((x) => x.signup_open && (x.signup || '').match(DATE));
    const shown = (k) => new Date(k + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const lastDate = (x) => [...x.signup.matchAll(DATE)].at(-1)[0];
    check(dated.length > 0 && dated.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.signup_until || '') && shown(x.signup_until) === lastDate(x)), 'every open row with a date in its sign-up text has that date as signup_until', dated.filter((x) => shown(x.signup_until || '2000-01-01') !== lastDate(x)).map((x) => x.signup).join(' | '));
    check(rows.filter((x) => x.signup_until !== undefined).length === dated.length, 'and no other row has one', '');
  });

  await group('Body, Leagues: each organizer with its sports inside, and a filter by sport', async () => {
    const L = await json('leagues.json');
    const live = (o) => o.sports.filter((x) => !x.ends || x.ends >= nyDay());
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/body/#leagues');
    await page.waitForSelector('.lg-wrap');
    check((await page.$$('.lg-org')).length === L.organizers.filter((o) => live(o).length).length, 'every organizer with a running league has a tile', '');
    const game = L.organizers.find((o) => o.id === 'game-on-vt');
    const rows = await page.$$eval('[data-org="game-on-vt"] .lg-sport summary', (n) => n.map((x) => x.textContent));
    check(rows.length === new Set(live(game).map((x) => x.sport)).size, 'one small row per sport, not one tile per league', rows.join());
    await page.click('[data-org="game-on-vt"] .lg-sport summary');
    check(await page.$eval('[data-org="game-on-vt"] .lg-sport', (d) => d.open && !!d.querySelector('.lg-go')), 'a row opens to dates, cost and the sign-up link', '');
    await page.click('#subnav .secpill .chip:has-text("Basketball")');
    await sleep(250);
    const orgs = await page.$$eval('.lg-org', (n) => n.map((x) => x.dataset.org));
    check(orgs.length === L.organizers.filter((o) => live(o).some((x) => x.sport === 'Basketball')).length, 'the filter leaves only organizers with that sport', orgs.join());
    check(!/verified|unconfirmed|\bchecked\b/i.test(await page.$eval('#panel-leagues', (n) => n.innerText)), 'no verified labels', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Body: the config hosts Habits in Today, beside the template, and every tab is built', async () => {
    const { default: cfg } = await import('../js/apps/body.js');
    check(JSON.stringify(cfg.tabs.map((t) => t.mode)) === JSON.stringify(TABS), 'six tabs, each a built mode', cfg.tabs.map((t) => t.mode).join(', '));
    check(JSON.stringify(cfg.tabs.map((t) => t.label)) === JSON.stringify(LABELS), 'the map’s words', '');
    check(JSON.stringify(cfg.hosted) === JSON.stringify({ habits: 'template', season: 'template', build: 'template' }), 'Habits, the season and The Build live in Today’s cell', JSON.stringify(cfg.hosted));
    check(tpl.habits.length === 15, 'the template has fifteen habits', tpl.habits.length);
  });

  await group('Body, Today: Habits first, the Template beside it with each why, one tap copies them all (demo, 390)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/body/?demo=1#habits');
    await page.waitForSelector(panel('habits') + ' .hb-addbtn', { timeout: 10000 });
    check(await page.$eval(panel('habits'), (p) => !p.hidden), '#habits opens the tracker', '');
    check(await page.$eval('#tab-template', (b) => b.getAttribute('aria-selected')) === 'true' && (await text(page, '#mast-title')) === 'Habits', 'the Habits cell is lit and the mast says Habits', '');
    check(JSON.stringify(await page.$$eval('#subnav .bd-sideswitch button', (b) => b.map((x) => x.dataset.side))) === '["habits","season","template","build"]' && !!(await page.$('#subnav .chip[data-chip="forests"]')),
      'the switch, Habits · Season · Template · Build, sits over Habits’ own chips', await text(page, '#subnav'));
    await page.click('#subnav [data-side="template"]');
    await page.waitForSelector(panel('template') + ' [data-template="stephen"]', { timeout: 6000 });
    check(await page.evaluate(() => location.hash) === '#template/stephen', 'Template has its own link', await page.evaluate(() => location.hash));
    const rows = await page.$$eval(panel('template') + ' .lrow', (rs) => rs.map((r) => [r.querySelector('.t').textContent, r.querySelector('.s').textContent]));
    check(rows.length === tpl.habits.length && rows.every((r, i) => r[0] === tpl.habits[i].text && r[1] === tpl.habits[i].why), 'all fifteen, each with its one-line why right under its name', JSON.stringify(rows.slice(0, 2)));
    const order = await page.$eval(panel('template'), (p) => [...p.querySelectorAll('.lrow, [data-copy-all]')].map((n) => (n.matches('[data-copy-all]') ? 'copy' : 'row')));
    check(order.indexOf('copy') === tpl.habits.length, 'the whys come first, the Copy all button after them', order.join(','));
    await page.screenshot({ path: path.join(SHOTS, 'body-template-390-light.png') });
    await page.click('[data-copy-all]');
    await page.waitForFunction(() => document.querySelectorAll('#panel-habits .hb-row').length === 15, null, { timeout: 30000 }).catch(() => {});
    const names = await page.$$eval(panel('habits') + ' .hb-row', (rs) => rs.map((r) => [r.querySelector('.hb-name').textContent, r.querySelector('.hb-meta').innerText.replace(/\s+/g, ' ')]));
    check(names.length === tpl.habits.length && names.every((n, i) => n[0] === tpl.habits[i].text), 'one tap: all fifteen on the tracker, in order', JSON.stringify(names.map((n) => n[0])));
    const fq = (x) => (x.frequency === 'n_per_week' ? x.n + ' a week' : x.frequency === 'daily' ? 'Daily' : 'Weekdays');
    check(names.every((n, i) => n[1].includes(fq(tpl.habits[i]))), 'with their frequencies (Floss 3 a week, Sprints 1 a week)', JSON.stringify(names.slice(0, 3)));
    check(/Added 15 habits/.test(await toast(page)), 'the toast says so', '');
    check(!(await page.$(panel('habits') + ' .hb-form')), 'the Add form is closed again', '');
    /* again: nothing twice */
    await page.click('#subnav [data-side="template"]');
    await page.waitForSelector('[data-copy-all]:not([disabled])');
    await page.click('[data-copy-all]');
    await page.waitForFunction(() => /already/.test(document.querySelector('#toast').textContent), null, { timeout: 15000 }).catch(() => {});
    check(/Nothing new to add\. 15 were already on your list/.test(await page.$eval('#toast', (t) => t.textContent)) && (await page.$$(panel('habits') + ' .hb-row')).length === 15,
      'a second tap adds nothing twice', await page.$eval('#toast', (t) => t.textContent));
    /* the bar's Today goes back to Habits */
    await page.click('#subnav [data-side="template"]');
    await page.waitForSelector(panel('template') + ':not([hidden])');
    await page.click('#tab-train');
    await page.click('#tab-template');
    await page.waitForFunction(() => !document.querySelector('#panel-habits').hidden);
    check(true, 'the bar’s Today lands on Habits', '');
    check(!errors.length, 'no console errors', errors.slice(0, 3).join(' | '));
    await ctx.close();
  });

  await group('Body, Today: the template goes through the tracker’s own doors, signed out (this phone, kept) and signed in (demo account)', async () => {
    let { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/body/#template/stephen');
    await page.waitForSelector('[data-copy-all]', { timeout: 10000 });
    /* one habit alone, by its own Add */
    await page.click(panel('template') + ' .lrow[data-k="t-5"] .pillbtn');
    await page.waitForFunction(() => document.querySelectorAll('#panel-habits .hb-row').length === 1, null, { timeout: 15000 }).catch(() => {});
    const one = await page.$$eval(panel('habits') + ' .hb-row .hb-name', (n) => n.map((x) => x.textContent));
    check(JSON.stringify(one) === '["Gym"]', 'Add on one row adds just that habit', JSON.stringify(one));
    const local = await page.evaluate(() => JSON.parse(localStorage.getItem('allday-habits-local') || 'null'));
    check(local && JSON.stringify(local).includes('"Gym"'), 'signed out, it is kept on this phone (habits-local)', '');
    await page.reload();
    await page.waitForSelector(panel('habits') + ' .hb-row', { timeout: 10000 });
    check((await page.$$(panel('habits') + ' .hb-row')).length === 1, 'and is still there after a reload', '');
    check(!errors.length, 'no console errors (live)', errors.slice(0, 3).join(' | '));
    await ctx.close();
    ({ ctx, page, errors } = await newPage(browser, base));
    await page.goto(base + '/body/?demo=1#habits');
    await page.waitForSelector(panel('habits') + ' .hb-addbtn', { timeout: 10000 });
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.waitForFunction(() => !document.querySelector('#panel-habits .hb-sync'), null, { timeout: 6000 }).catch(() => {});
    await sleep(500);
    const before = await page.$$eval(panel('habits') + ' .hb-row', (r) => r.length);
    await page.goto(base + '/body/?demo=1#template/stephen');
    await page.waitForSelector('[data-copy-all]:not([disabled])');
    await page.click('[data-copy-all]');
    await page.waitForFunction(() => /Added|Nothing/.test(document.querySelector('#toast').textContent), null, { timeout: 30000 }).catch(() => {});
    const onServer = await page.evaluate(() => import('/all-day/js/modes/habits.js').then((H) => H._fake().as('demo-0000-4000-8000-00000000me00').call('sz_habits_get', {})))
      .then((l) => l.map((x) => x.text)).catch((e) => ['ERR ' + e.message]);
    check(tpl.habits.every((x) => onServer.includes(x.text)), 'signed in, every habit lands on the account (the demo’s server)', JSON.stringify(onServer.slice(0, 4)) + ' before ' + before);
    check(!errors.length, 'no console errors (signed in)', errors.slice(0, 3).join(' | '));
    await ctx.close();
  });

  await group('Body, Today: The Build lives in Today’s cell, its links land there, and a habit tapped done still reaches the site (demo, 390)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/body/?demo=1#build');
    await page.waitForSelector(panel('build') + ':not([hidden])', { timeout: 10000 });
    check(await page.$eval('#tab-template', (b) => b.getAttribute('aria-selected')) === 'true', '#build opens The Build with Today lit', '');
    check(!(await page.$('#tab-build')), 'The Build has no cell of its own', '');
    check(JSON.stringify(await page.$$eval('#subnav .bd-sideswitch button', (b) => b.map((x) => x.dataset.side))) === '["habits","season","template","build"]' && !!(await page.$('#subnav .bd-whatis')),
      'one switch over it, Habits · Season · Template · Build, and its “?”', await text(page, '#subnav'));
    await page.click('#subnav [data-side="habits"]');
    await page.waitForSelector(panel('habits') + ':not([hidden]) .hb-addbtn', { timeout: 6000 });
    await page.click(panel('habits') + ' .hb-start');
    await page.waitForSelector(panel('habits') + ' .hb-row', { timeout: 6000 });
    await page.click(panel('habits') + ' .hb-row .hb-tap');
    await sleep(100);
    const owed = await page.evaluate(() => import('/all-day/js/modes/build.js').then((m) => m._state().pallets));
    check(owed >= 1, 'a habit tapped done owes the site a pallet (build.js’s own bridge)', owed);
    await page.click('#subnav [data-side="build"]');
    await page.waitForSelector(panel('build') + ':not([hidden])');
    const st = await page.evaluate(() => import('/all-day/js/modes/build.js').then((m) => m._state()));
    check(st.side === 'build' && (await page.evaluate(() => location.hash)) === '#build', 'the switch goes back to The Build', JSON.stringify({ side: st.side }));
    check(!errors.length, 'no console errors', errors.slice(0, 3).join(' | '));
    await ctx.close();
    /* from another app, #build and #habits open in Body */
    const p2 = await newPage(browser, base);
    await p2.page.goto(base + '/out/?demo=1#habits');
    await p2.page.waitForURL(/\/body\/\?demo=1#habits/, { timeout: 8000 }).catch(() => {});
    check(/\/body\/\?demo=1#habits/.test(p2.page.url()), 'a #habits link from Out opens in Body', p2.page.url());
    await p2.ctx.close();
  });

  await group('Body, Season: the rules (show-up rate, the board order, the vague-goal nudge)', async () => {
    const { ctx, page } = await newPage(browser, base);
    await page.goto(base + '/body/?demo=1#season');
    const r = await page.evaluate(() => import('/all-day/js/modes/season.js').then((m) => ({
      before: m.showUp({ reviews: 0, attended: 0, weeksGone: 0, eventsHeld: 0 }),
      wk3: m.showUp({ reviews: 2, attended: 1, weeksGone: 2, eventsHeld: 1 }),
      capped: m.showUp({ reviews: 8, attended: 3, weeksGone: 12, eventsHeld: 3 }),
      order: m.boardRows({ week: 3, events_held: 1, rows: [
        { name: 'A', frequency: 'daily', taps: [], reviews: 0, attended: 0 },
        { name: 'B', frequency: 'n_per_week', n: 1, taps: [], reviews: 2, attended: 1 }] }, Date.now()).map((x) => x.name + ':' + x.show),
      vague: [m.vague('Get fit'), m.vague('Run a 10K'), m.vague('Finish the screenplay by December'), m.vague('')],
    })));
    check(r.before === null, 'before kickoff the show-up rate is blank, not 0%', r.before);
    check(r.wk3 === 100, '2 reviews + 1 event over 2 weeks + 1 event is 100%', r.wk3);
    check(r.capped === 100, 'weeks are capped at eight', r.capped);
    check(JSON.stringify(r.vague) === '[true,false,false,false]', 'a goal with no number or date gets the nudge; a real one does not', JSON.stringify(r.vague));
    check(r.order.length === 2, 'the board works its rows out in the app', JSON.stringify(r.order));
    await ctx.close();
  });

  await group('Body, Season: signed out, the season and the Wall; signed in, the goal tile, Done, milestones, the review, the board, finishing and a card on the Wall (demo, 390)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/body/?demo=1#season');
    await ready(page, 'season');
    check(await page.$eval('#tab-template', (b) => b.getAttribute('aria-selected')) === 'true', 'Season sits in the Today cell', '');
    check(/Party in \d+ days/.test(await text(page, sec('season', 'top'))), 'signed out: where the season stands', await text(page, sec('season', 'top')));
    check(!!(await page.$(sec('season', 'goal') + ' .btn')) && /Sign in/.test(await text(page, sec('season', 'goal'))), 'and a Sign in where your goal would be', '');
    check((await page.$$(sec('season', 'events') + ' [data-event]')).length === 3, 'the three events', '');
    check(!(await page.$(sec('season', 'board'))), 'no city board for a stranger', '');
    check((await page.$$(sec('season', 'wall') + ' [data-wall]')).length === 3, 'the Wall is public', '');
    await page.screenshot({ path: path.join(SHOTS, 'body-season-signedout-390-light.png') });
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.waitForSelector(sec('season', 'top') + ' .sz-done', { timeout: 8000 });
    const done = sec('season', 'top') + ' .sz-done';
    const s0 = await text(page, '.sz-streak');
    check(await page.$eval(done, (b) => b.getAttribute('aria-pressed')) === 'false' && (await page.$eval(done, (b) => b.getBoundingClientRect().height)) >= 64, 'the Done button, 64px or more, not yet done', '');
    await page.click(done);
    check(await page.$eval(done, (b) => b.getAttribute('aria-pressed')) === 'true' && /Done today/.test(await text(page, done)), 'one tap: done today', await text(page, done));
    await sleep(150);
    const stored = await page.evaluate(() => import('/all-day/js/modes/season.js').then((m) => m._fake().db.myTaps));
    const todayKey = await page.evaluate(() => import('/all-day/js/habits-core.js').then((h) => h.dayKey(Date.now())));
    check(stored.includes(todayKey), 'the tap reaches the server', JSON.stringify(stored.slice(-2)));
    check(/\(you\)/.test(await text(page, sec('season', 'board') + ' [data-board="me"]')), 'and the board follows', '');
    const s1 = await text(page, '.sz-streak');
    check(s1 !== s0 || /\d/.test(s1), 'the streak shows', s0 + ' → ' + s1);
    await page.click(done);
    await page.waitForSelector('.confirm-card', { timeout: 3000 }).catch(() => {});
    check(!!(await page.$('.confirm-card')), 'un-doing today asks first', '');
    await page.click('.confirm-card button:has-text("Undo")').catch(() => {});
    check(await page.$eval(done, (b) => b.getAttribute('aria-pressed')) === 'false', 'and then un-does it', '');
    check(/Ana|Ben|Caro/.test(await text(page, '.sz-pod')), 'the pod’s streaks under it', await text(page, '.sz-pod'));
    await page.screenshot({ path: path.join(SHOTS, 'body-season-390-light.png') });
    /* the goal, locked: milestones tick */
    check((await page.$$(sec('season', 'goal') + ' [data-milestone]')).length === 3 && !(await page.$(sec('season', 'goal') + ' form.sz-goal')), 'after kickoff the goal is read only, with three milestones', '');
    await page.click(sec('season', 'goal') + ' [data-milestone="2"] .pillbtn');
    await page.waitForFunction(() => document.querySelector('[data-milestone="2"]')?.classList.contains('done'), null, { timeout: 3000 }).catch(() => {});
    check(await page.$eval(sec('season', 'goal') + ' [data-milestone="2"]', (r) => r.classList.contains('done')), 'a milestone ticks', '');
    /* the review */
    await page.fill(sec('season', 'review') + ' input[name="said"]', 'Three runs');
    await page.fill(sec('season', 'review') + ' input[name="did"]', 'Three runs and a long one');
    await page.fill(sec('season', 'review') + ' input[name="next"]', 'Taper');
    await page.click(sec('season', 'review') + ' button[type="submit"]');
    await page.waitForFunction(() => /Sent/.test(document.querySelector('[data-sec="review"] .bf-msg').textContent), null, { timeout: 3000 }).catch(() => {});
    check(/Sent/.test(await text(page, sec('season', 'review') + ' .bf-msg')), 'this week’s review sends', '');
    /* the board */
    const me = await text(page, sec('season', 'board') + ' [data-board="me"]');
    check(/\(you\)/.test(me) && await page.$eval(sec('season', 'board') + ' [data-board="me"]', (r) => r.classList.contains('spun')), 'the board marks your row', me);
    const board = await text(page, sec('season', 'board'));
    check(!/10K|screenplay|novel/i.test(board.replace(/Your pod.*/, '')), 'the board shows no one’s goal', '');
    check(!!(await page.$(sec('season', 'board') + ' [data-pod]')), 'your pod under it', '');
    /* finishing: a card on the Wall */
    await page.click(sec('season', 'goal') + ' .sz-finish .btn');
    await page.waitForSelector(sec('season', 'goal') + ' form.sz-card', { timeout: 3000 });
    await page.fill(sec('season', 'goal') + ' input[name="line1"]', 'Three runs a week');
    await page.fill(sec('season', 'goal') + ' input[name="line2"]', '58:40 at Shelburne');
    await page.fill(sec('season', 'goal') + ' input[name="line3"]', 'From couch to 10K');
    await page.click(sec('season', 'goal') + ' form.sz-card button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('[data-sec="wall"] [data-wall="w-me"]'), null, { timeout: 4000 }).catch(() => {});
    check(/58:40 at Shelburne/.test(await text(page, sec('season', 'wall') + ' [data-wall]')), 'publishing puts your card first on the Wall', await text(page, sec('season', 'wall') + ' [data-wall]'));
    check(!errors.length, 'no console errors', errors.slice(0, 3).join(' | '));
    await ctx.close();
  });

  await group('Body, Season: before kickoff, declare your goal, saved as you type (demo, 390)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/body/?demo=1#season');
    await ready(page, 'season');
    await page.evaluate(() => import('/all-day/js/modes/season.js').then((m) => { const d = m._fake().db; d.season.kickoff_at = new Date(Date.now() + 5 * 86400000).toISOString(); d.season.status = 'open'; d.goal.text = ''; d.goal.habit = null; }));
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.waitForSelector(sec('season', 'goal') + ' form.sz-goal', { timeout: 8000 });
    check(/Starts in 5 days/.test(await text(page, sec('season', 'top'))), 'the countdown to kickoff', await text(page, sec('season', 'top')));
    await page.fill(sec('season', 'goal') + ' input[name="text"]', 'Get fit');
    check(/number or a date/.test(await text(page, sec('season', 'goal') + ' .bf-hint')), 'a vague goal gets one soft line', '');
    await page.fill(sec('season', 'goal') + ' input[name="text"]', 'Swim a mile by August');
    await page.fill(sec('season', 'goal') + ' input[name="habit"]', 'Swim 30 minutes');
    await page.selectOption(sec('season', 'goal') + ' select[name="frequency"]', 'n_per_week');
    await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-sec="goal"] .bf-msg').textContent), null, { timeout: 4000 }).catch(() => {});
    const g = await page.evaluate(() => import('/all-day/js/modes/season.js').then((m) => m._fake().db.goal));
    check(g.text === 'Swim a mile by August' && g.habit && g.habit.text === 'Swim 30 minutes' && g.habit.frequency === 'n_per_week', 'every change saves, the goal habit with it', JSON.stringify({ t: g.text, h: g.habit }));
    check(/Locks /.test(await text(page, sec('season', 'goal'))), 'it says when it locks, once, where you write', '');
    check(!(await page.$(sec('season', 'review'))) && !(await page.$(sec('season', 'board'))), 'no review and no board before kickoff', '');
    check(!errors.length, 'no console errors', errors.slice(0, 3).join(' | '));
    await ctx.close();
  });

  await group('Body, Season, live before the SQL is pasted: the next season from the tracker’s own door, and Sign in (live, 390)', async () => {
    const off = { status: 404, body: { code: 'PGRST202', message: 'not found' } };
    const next = { id: 's0', name: 'Season 0', city: 'burlington', status: 'open', kickoff_at: new Date(Date.now() + 23 * 86400000).toISOString() };
    const { ctx, page, errors } = await newPage(browser, base, { rpc: (fn) => (fn === 'sz_season_next' ? next : /^sz_(season_get|wall_list|goal_get|board)$/.test(fn) ? off : undefined) });
    await page.goto(base + '/body/#season');
    await ready(page, 'season');
    check(/Season 0/.test(await text(page, sec('season', 'top'))) && /Starts in 2[23] days/.test(await text(page, sec('season', 'top'))), 'the countdown, from sz_season_next', await text(page, sec('season', 'top')));
    check(/Sign in to join/.test(await text(page, sec('season', 'top'))), 'and Sign in to join', '');
    check(!(await page.$(sec('season', 'wall'))) && !(await page.$(sec('season', 'goal'))), 'nothing else until the season’s doors are open', '');
    /* the doors not pasted yet answer 404 on purpose */
    const real = errors.filter((e) => !/status of 404/.test(e));
    check(!real.length, 'no console errors but the expected 404s', real.slice(0, 3).join(' | '));
    await ctx.close();
  });

  await group('Body, Train: gyms with what each has and when it was checked, three routines to follow, sprints, a log kept on the phone, Book Stephen unpriced (live, 390)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/body/#train');
    await ready(page, 'train');
    const gyms = () => page.$$eval(sec('train', 'gyms') + ' .lrow', (rs) => rs.map((r) => ({ id: r.dataset.gym, v: r.dataset.verified, s: r.innerText })));
    let g = await gyms();
    check(g.length === 10, 'ten gyms to start', g.length);
    await page.click(sec('train', 'gyms') + ' .addrow .btn');
    g = await gyms();
    check(g.length === G.gyms.length, 'Show all: every one of the ' + G.gyms.length, g.length);
    const edge = G.gyms.find((x) => /\$\d/.test(x.day_pass || '') && x.verified);
    const er = g.find((x) => x.id === edge.id);
    check(er && er.s.includes(edge.address.replace(/,?\s*VT\s*\d{5}.*$/, '')) && er.s.includes((edge.day_pass.match(/\$\d+/) || [''])[0]), 'a row has its address and day pass', er && er.s);
    await page.click(sec('train', 'gyms') + ' .chip[data-chip="Winooski"]');
    g = await gyms();
    check(g.length === G.gyms.filter((x) => x.town === 'Winooski').length && g.length > 0, 'a town chip narrows the list', g.length);
    await page.click(sec('train', 'gyms') + ' .lrow .open');
    await page.waitForSelector('.sheet-card [data-gym]', { timeout: 4000 }).catch(() => {});
    check(/Address/.test(await text(page, '.sheet-card')), 'a gym’s row opens all of it', '');
    await page.keyboard.press('Escape');
    await page.click('.sheet-card .iconbtn').catch(() => {});
    for (const r of W.routines) {
      const n = (r.days || [{ exercises: r.exercises }]).reduce((m, d) => m + d.exercises.length, 0);
      const got = await page.$$eval(sec('train', r.id) + ' .lrow', (x) => x.length);
      check(got === n, r.name + ': every machine, ' + n, got);
    }
    const first = W.routines[0].exercises[0];
    const fr = await text(page, sec('train', 'beginner') + ' .lrow');
    check(fr.includes(first.machine) && fr.includes(first.sets + '×') && fr.includes('Stop with ' + first.left + ' left in the tank'), 'a machine: its sets, reps and effort', fr);
    await page.click(sec('train', 'beginner') + ' .lrow .open');
    check(await page.$eval(sec('train', 'beginner') + ' .lrow', (r) => r.classList.contains('done')), 'tapping a machine ticks it off', '');
    /* the log */
    await page.click(sec('train', 'beginner') + ' .lrow .pillbtn');
    await page.waitForSelector('.sheet-card form.tr-log');
    check(await page.$eval('.sheet-card input[name="machine"]', (i) => i.value) === first.machine, 'Log from a machine starts on that machine', '');
    await page.fill('.sheet-card input[name="weight"]', '90 lb');
    await page.fill('.sheet-card input[name="reps"]', '12, 11');
    await page.selectOption('.sheet-card select[name="left"]', '2');
    await page.click('.sheet-card form.tr-log button[type="submit"]');
    await page.waitForFunction(() => document.querySelectorAll('[data-sec="log"] .lrow').length === 1, null, { timeout: 4000 }).catch(() => {});
    const line = await text(page, sec('train', 'log') + ' .lrow');
    check(line.includes(first.machine) && line.includes('90 lb') && line.includes('2 left'), 'the line is in the Log', line);
    await page.reload();
    await ready(page, 'train');
    check((await page.$$(sec('train', 'log') + ' .lrow')).length === 1, 'kept on this phone through a reload', '');
    check(/Last time .*90 lb/.test(await text(page, sec('train', 'beginner') + ' .lrow')), 'the machine’s row shows last time’s line', await text(page, sec('train', 'beginner') + ' .lrow'));
    await page.click(sec('train', 'log') + ' .addrow .btn');
    await page.fill('.sheet-card input[name="machine"]', first.machine);
    await page.dispatchEvent('.sheet-card input[name="machine"]', 'input');
    check(/Last time, .*90 lb/.test(await text(page, '.sheet-card .bf-hint')), 'typing the machine shows last time’s line', await text(page, '.sheet-card .bf-hint'));
    await page.click('.sheet-card .iconbtn');
    await page.click(sec('train', 'log') + ' .lrow .act.del');
    check((await page.$$(sec('train', 'log') + ' .lrow')).length === 0 && /Deleted/.test(await toast(page)), 'a line can be deleted, with Undo', '');
    await page.click(sec('train', 'sprints') + ' [data-play-sprints]');
    await page.waitForSelector('.sheet-card [data-player] .hb-num');
    const a1 = await text(page, '.sheet-card .hb-num');
    await sleep(1300);
    const a2 = await text(page, '.sheet-card .hb-num');
    check(a1 !== a2 && /^\d+:\d\d$/.test(a2), 'the sprint timer counts down', a1 + ' → ' + a2);
    await page.click('.sheet-card button:has-text("Skip")');
    check(/2 of /.test(await text(page, '.sheet-card .hb-stat.r')), 'Skip moves to the next step', await text(page, '.sheet-card .hb-stat.r'));
    await page.click('.sheet-card .iconbtn');
    check(!errors.length, 'no console errors', errors.slice(0, 3).join(' | '));
    await ctx.close();
  });

  await group('Body, Recover: three routines that play through, the spots, the breathing timer, sleep and trackers (demo, 390)', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { clock: undefined });
    await page.goto(base + '/body/?demo=1#recover');
    await ready(page, 'recover');
    for (const [k, tab] of [['stretch', 'Stretch'], ['yoga', 'Yoga'], ['roll', 'Roll']]) {
      const r = R.routines.find((x) => x.tab === tab);
      check((await page.$$(sec('recover', k) + ' .lrow')).length === r.moves.length, tab + ': every move', '');
    }
    await page.click(sec('recover', 'stretch') + ' [data-play]');
    await page.waitForSelector('.sheet-card [data-player] .hb-num');
    check((await text(page, '.sheet-card')).includes(R.routines[0].moves[0].name) && /Next/.test(await text(page, '.sheet-card')), 'Play shows the move, its countdown and what’s next', '');
    await page.click('.sheet-card button[data-play="pause"]');
    const p1 = await text(page, '.sheet-card .hb-num');
    await sleep(1100);
    check(p1 === await text(page, '.sheet-card .hb-num') && /Resume/.test(await text(page, '.sheet-card [data-play="pause"]')), 'Pause holds the clock', p1);
    await page.click('.sheet-card .iconbtn');
    check((await page.$$(sec('recover', 'sauna') + ' [data-spot]')).length === SP.spots.length, 'Sauna & cold: all ' + SP.spots.length + ' spots', '');
    check((await text(page, sec('recover', 'sauna'))).includes('Gyms with a sauna'), 'and the gyms with a sauna', '');
    /* breathe */
    await page.click(sec('recover', 'breathe') + ' .pills button:nth-child(1)');
    check(/3 rounds/.test(await text(page, sec('recover', 'breathe') + ' .br-live')), 'a preset sets the rounds', await text(page, sec('recover', 'breathe') + ' .br-live'));
    await page.click(sec('recover', 'breathe') + ' [data-breathe-go]');
    await page.waitForFunction(() => document.querySelector('.br-live').dataset.breathe === 'inhale');
    check(/Breathe in through your nose/.test(await text(page, '.br-live')) && /1 of 3/.test(await text(page, '.br-live')), 'it shows the phase, the count and the round', await text(page, '.br-live'));
    await page.waitForFunction(() => document.querySelector('.br-live').dataset.breathe === 'top_up', null, { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelector('.br-live').dataset.breathe === 'exhale', null, { timeout: 4000 }).catch(() => {});
    check(/out through your mouth/.test(await text(page, '.br-live')), 'in, a sip more, then the long breath out', await text(page, '.br-live'));
    await page.click(sec('recover', 'breathe') + ' summary');
    await page.selectOption(sec('recover', 'breathe') + ' select[name="exhale"]', '4');
    await page.click(sec('recover', 'breathe') + ' [data-breathe-go]');
    check(/longer than both breaths in/.test(await text(page, sec('recover', 'breathe') + ' .bf-msg')), 'the breath out must be longer than both in', '');
    check((await page.$$(sec('recover', 'sleep') + ' .lrow[data-k^="tk-"]')).length === R.sleep.trackers.length, 'Sleep: every tracker, side by side', '');
    check(!errors.length, 'no console errors', errors.slice(0, 3).join(' | '));
    await ctx.close();
  });

  await group('Body, Fuel: water and protein taps kept by the day, MacroFactor, the basics, supplements with sources, a less-of counter that starts empty (live, 390)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/body/#fuel');
    await ready(page, 'fuel');
    check(await page.$eval('[data-water]', (n) => n.dataset.water) === '0', 'water starts at zero', '');
    await page.click('[data-tap="water"]');
    await page.click('[data-tap="water"]');
    check(await page.$eval('[data-water]', (n) => n.dataset.water) === String(2 * F.defaults.water.tap_oz), 'two taps, ' + 2 * F.defaults.water.tap_oz + ' oz', '');
    await page.click('[data-tap="shake"]');
    await page.click('[data-tap="creatine"]');
    check(await page.$eval('[data-protein]', (n) => n.dataset.protein) === String(F.defaults.protein_shake.grams_per_shake) && /Creatine done today/.test(await text(page, '[data-tap="creatine"]')),
      'a shake adds its grams, creatine ticks', '');
    await page.reload();
    await ready(page, 'fuel');
    check(await page.$eval('[data-water]', (n) => n.dataset.water) === String(2 * F.defaults.water.tap_oz) && await page.$eval('[data-protein]', (n) => n.dataset.protein) === '30',
      'kept on this phone through a reload', '');
    check((await page.$$(sec('fuel', 'water') + ' .days button')).length === 7, 'the last seven days under it', '');
    const cal = await text(page, sec('fuel', 'calories'));
    check(F.calories.photo_steps.every((s) => cal.includes(s)) && !!(await page.$(sec('fuel', 'calories') + ' a[href="' + F.calories.app.url + '"]')), 'Calories: MacroFactor’s steps and its link', '');
    await page.fill(sec('fuel', 'basics') + ' input[name="weight"]', '180');
    check(/117 to 162 g/.test(await text(page, sec('fuel', 'basics') + ' .fu-calc')), 'the protein calculator: 180 lb is 117 to 162 g', await text(page, sec('fuel', 'basics') + ' .fu-calc'));
    const sup = await text(page, sec('fuel', 'supplements'));
    check(sup.includes(F.doctor_line) && F.supplements.items.every((x) => sup.includes(x.name)), 'Supplements: the doctor line and each one', '');
    check((await page.$$(sec('fuel', 'less') + ' [data-less]')).length === 0 && !!(await page.$(sec('fuel', 'less') + ' form.fu-less')), 'Less of: nothing preset, the form to set one', '');
    await page.fill(sec('fuel', 'less') + ' input[name="name"]', 'Late-night snacks');
    await page.selectOption(sec('fuel', 'less') + ' select[name="limit"]', '1');
    await page.click(sec('fuel', 'less') + ' .fu-gives .chip[data-chip="Bored"]');
    await page.fill(sec('fuel', 'less') + ' input[name="swap"]', 'A cup of tea');
    await page.click(sec('fuel', 'less') + ' form button[type="submit"]');
    const lr = await text(page, sec('fuel', 'less') + ' [data-less]');
    check(/Instead A cup of tea.*Gives you Bored/.test(lr), 'the swap shows first, then what it gives you', lr);
    await page.click(sec('fuel', 'less') + ' [data-less] .pillbtn');
    check(/^Instead: A cup of tea/.test(await toast(page)), 'a slip shows the swap first', '');
    await page.click(sec('fuel', 'less') + ' [data-less] .pillbtn');
    check(/2\/1/.test(await text(page, sec('fuel', 'less') + ' [data-less]')) && /Over your limit/.test(await text(page, sec('fuel', 'less') + ' [data-less]')), 'counting past the limit says so', await text(page, sec('fuel', 'less') + ' [data-less]'));
    check(!errors.length, 'no console errors', errors.slice(0, 3).join(' | '));
    await ctx.close();
  });

  await group('Body, live with no posts and no SQL: every tab still says something true (live, 1280)', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { viewport: { width: 1280, height: 800 } });
    await page.goto(base + '/body/#train');
    await ready(page, 'train');
    check(!errors.length, 'no console errors', errors.slice(0, 3).join(' | '));
    await ctx.close();
  });

  /* every tab, both widths, both themes, demo: the page rules and a screenshot */
  for (const combo of COMBOS) {
    await group('Body, every tab at ' + combo.viewport.width + ', ' + combo.scheme + ' (demo)', async () => {
      const { ctx, page, errors } = await newPage(browser, base, combo);
      await page.goto(base + '/body/?demo=1#habits');
      await page.waitForSelector(panel('habits') + ' .hb-addbtn', { timeout: 10000 });
      for (const k of TABS) {
        const shown = k === 'template' ? 'template' : k;
        await page.evaluate((h) => { location.hash = h; }, k === 'template' ? 'template/stephen' : k);
        await page.waitForSelector(panel(shown) + ':not([hidden]) ' + (k === 'template' ? '[data-template]' : k === 'day' ? '.dy-wrap' : k === 'leagues' ? '.lg-wrap' : '[data-body]'), { timeout: 10000 });
        await page.evaluate((id) => document.querySelector(id).scrollTo(0, 0), panel(shown));
        await sleep(350);
        await pageRules(page, 'body ' + k, combo.viewport.width);
        await page.screenshot({ path: path.join(SHOTS, 'body-' + k + '-' + combo.viewport.width + '-' + combo.scheme + '.png') });
      }
      /* the season, signed in, at its goal tile */
      await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
      await page.evaluate(() => { location.hash = 'season'; });
      await page.waitForSelector(panel('season') + ':not([hidden]) .sz-done', { timeout: 10000 });
      await page.evaluate(() => document.querySelector('#panel-season').scrollTo(0, 0));
      await sleep(350);
      await pageRules(page, 'body season', combo.viewport.width);
      await page.screenshot({ path: path.join(SHOTS, 'body-season-' + combo.viewport.width + '-' + combo.scheme + '.png') });
      check(!errors.length, 'no console errors', errors.slice(0, 3).join(' | '));
      await ctx.close();
    });
  }
}
