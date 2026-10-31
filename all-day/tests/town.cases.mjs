// The Town app's cases (wave 1, 2026-10-29): Alerts, City Hall, Streets,
// Guides and Work. allday.spec.mjs runs them as the theTown group and hands
// in its own helpers, so this file is the Town session's alone.
//
//   - every tab, live and ?demo=1, draws one section per top tab, in the
//     config's order, with no section that failed to draw
//   - the street lookup finds a street's recycling day and ban zone and
//     remembers it on this device (never in the demo)
//   - Signups shows only published dates from today on
//   - City Hall shows a meeting at the portal's own wall time
//   - privacy on Streets: no contractor, buyer or seller names, no
//     per-sale out-of-state flag, blotter headlines without names
//   - the demo's states: a ban headline, a closing, report cards with a
//     status chip, watch parties that open People's Plans
//   - Now: the feed, Guess the price, the filters, and no house number on a home
//   - Now's live top, Tonight, Pictures, Local news and Guess the street
//   - New here's ticks stay on the phone, and not in the demo
//   - screenshots of every tab at 390 and 1280, light and dark

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TABS = ['feed', 'alerts', 'cityhall', 'streets', 'square', 'guides', 'work'];
const COMBOS = [
  { viewport: { width: 390, height: 844 }, scheme: 'light' }, { viewport: { width: 390, height: 844 }, scheme: 'dark' },
  { viewport: { width: 1280, height: 800 }, scheme: 'light' }, { viewport: { width: 1280, height: 800 }, scheme: 'dark' },
];
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
/* a 1x1 picture, and one wide enough to pass for the camera's frame */
const DOT = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const DOT_WIDE = Buffer.from('R0lGODlhQAEBAIAAAAAAAP///yH5BAEAAAAALAAAAABAAQEAAAIDhI8FADs=', 'base64');

export async function townCases(h) {
  const { browser, base, group, check, newPage, settle, goTab, pageRules, SHOTS, REPO } = h;
  const { default: cfg } = await import(path.join(REPO, 'all-day/js/apps/town.js'));
  const json = async (f) => JSON.parse(await readFile(path.join(REPO, f), 'utf8'));
  const sections = (page) => page.evaluate(() => {
    const p = document.querySelector('.panel:not([hidden])');
    return { secs: [...p.querySelectorAll('.shelf-sec')].map((s) => s.querySelector('.sec h2').textContent), text: p.innerText,
      pill: [...document.querySelectorAll('#subnav .secpill .chip')].map((c) => c.textContent.trim()) };
  });

  await group('town: Now opens the app, and Guess the price works', async () => {
    const f = await json('all-day/data/demo/town-feed.json');
    const iso = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const day = (n) => ymd.format(new Date(Date.now() + n * 864e5));
    const stub = { status: { ban: null, ban_url: null, schools: 0, outages: 0 }, median: f.median,
      tonight: { id: 'tonight-x', kind: 'tonight', day: day(0), rows: f.tonight.rows.map((r) => [iso(-r[0]), ...r.slice(1)]) },
      tiles: f.tiles.map((t) => ({ ...t, ts: iso(t.ageHours), day: t.kind === 'city' || t.kind === 'signup' ? day(3) : t.day,
        closed: t.kind === 'sold' ? day(-12) : t.closed, rows: t.kind === 'cityweek' ? t.rows.map((r, n) => [day(n + 1), r[1], r[2]]) : t.kind === 'calendar' ? t.rows.map((r) => [iso(-r[0]), ...r.slice(1)]) : t.rows })) };
    const { ctx, page, errors } = await newPage(browser, base);
    await page.route(/data\/town\/feed\.json/, (r) => r.fulfill({ json: stub }));
    await page.route(/maps\.vcgi\.vermont\.gov/, (r) => r.abort());
    await page.goto(base + '/town/');
    await settle(page);
    await page.waitForSelector('.tf-wrap');
    const first = await page.evaluate(() => ({ tab: document.querySelector('#tabbar button[aria-selected="true"]').dataset.tab,
      hero: document.querySelector('.tf-hero').innerText, kids: [...document.querySelector('.tf-wrap').children].slice(0, 4).map((n) => n.className),
      alarms: document.querySelectorAll('.tf-hero .tf-chip.on').length, tag: document.querySelector('.tf-wrap > .tf .tf-tag').textContent }));
    check(first.tab === 'feed', 'Town opens on Now', first.tab);
    check(/\d+ new/.test(first.hero) && !/since you checked/.test(first.hero) && !/No ban|No school/.test(first.hero) && first.alarms === 0, 'the hero on a first open: the count, and no chip for a clear day', first.hero);
    check(/tf-hero/.test(first.kids[0]) && /tf-tonight/.test(first.kids[1]) && /tf-sold/.test(first.kids[2]) && first.tag === 'Guess the price', 'Tonight, then the day’s house, straight after the hero', JSON.stringify(first));
    const kinds = await page.$$eval('.tf-wrap > .tf', (n) => n.map((x) => x.dataset.id));
    check(kinds.length === f.tiles.length + 1 && new Set(kinds).size === kinds.length, 'every tile once', JSON.stringify(kinds));
    const TOP = '.tf-wrap > article.tf:nth-of-type(2)';
    const opts = () => page.$$eval(TOP + ' .tf-opt', (b) => b.map((x) => Number(x.dataset.pick)));
    const o = await opts();
    check(o.length === 3 && o.every((v, i) => !i || v > o[i - 1]), 'three prices, low to high', JSON.stringify(o));
    check(o.includes(465000), 'one is the real price, rounded', JSON.stringify(o));
    await page.click(TOP + ' .tf-opt[data-pick="465000"]');
    await page.waitForTimeout(800);
    const hit = await page.$eval('[data-id="sold-demo-1"] .tf-guess', (n) => ({ cls: n.firstElementChild.className, text: n.innerText }));
    check(/hit/.test(hit.cls) && /\$462,500/.test(hit.text) && /You got it/.test(hit.text) && /Assessed at \$302,200/.test(hit.text), 'a right guess: the exact price, the verdict, the assessment', JSON.stringify(hit));
    await page.reload();
    await settle(page);
    await page.waitForSelector('.tf-wrap');
    check(!(await page.$('[data-id="sold-demo-1"] .tf-opt')) && /\$462,500/.test(await page.$eval('[data-id="sold-demo-1"]', (n) => n.innerText)), 'a guessed house keeps its price, and asks no more', '');
    const next = await page.$eval(TOP, (n) => n.dataset.id);
    check(next === 'sold-demo-2', 'the next unguessed house takes the top', next);
    const o2 = await opts();
    const real2 = o2.find((v) => v === 1250000);
    await page.click(TOP + ' .tf-opt[data-pick="' + real2 + '"]');
    await page.waitForTimeout(800);
    const two = await page.evaluate(() => ({ chip: document.querySelector('.tf-chip.run').textContent, shown: !document.querySelector('.tf-chip.run').hidden, said: document.querySelector('[data-id="sold-demo-2"] .tf-said').textContent }));
    check(two.shown && two.chip === '2 in a row' && two.said === '2 in a row', 'two right in a row shows in the hero', JSON.stringify(two));
    await page.evaluate(() => localStorage.removeItem('town-feed-guess'));
    await page.reload();
    await settle(page);
    await page.waitForSelector('.tf-opt');
    const wrongPick = (await opts()).find((v) => v !== 465000);
    await page.click(TOP + ' .tf-opt[data-pick="' + wrongPick + '"]');
    await page.waitForTimeout(800);
    const miss = await page.evaluate(() => ({ cls: document.querySelector('[data-id="sold-demo-1"] .tf-result').className, run: localStorage.getItem('town-feed-run'), said: document.querySelector('[data-id="sold-demo-1"] .tf-said').textContent }));
    check(/miss/.test(miss.cls) && miss.run === '0' && miss.said === 'Not this one', 'a wrong guess ends the run and still shows the price', JSON.stringify(miss));
    await page.evaluate(() => localStorage.setItem('town-feed-seen', String(Date.now() - 20 * 3600000)));
    await page.reload();
    await settle(page);
    await page.waitForSelector('.tf-wrap');
    const again = await page.$eval('.tf-tally', (n) => n.innerText);
    check(/new since you checked/.test(again), 'a returning reader’s count says since when', again);
    check(!errors.filter((e) => !/ERR_FAILED|Failed to load resource/.test(e)).length, 'no console errors', errors.join(' | ').slice(0, 200));
    await ctx.close();
  });

  /* a page on a stub feed: the street, the weather and the camera as each case says */
  const nowDay = (n = 0) => ymd.format(new Date(Date.now() + n * 864e5));
  const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();
  const WEATHER = () => ({ now: { temp_f: 47.4, observed_at: inHours(-1) }, lake_gage: { water_temp_f: 53, water_temp_at: inHours(-2) }, sun: { sunrise: inHours(-5), sunset: inHours(2), sunrise_tomorrow: inHours(16), sunset_tomorrow: inHours(26) } });
  const tile = (id, kind, more) => ({ id, kind, ts: inHours(-1), title: id, url: 'https://example.com/' + id, ...more });
  const sale = (id) => tile(id, 'sold', { title: 'House on Sample Street', price: 400000, closed: nowDay(-9), url: null });
  async function feedPage(feed, { weather, cam, query = '' } = {}) {
    const p = await newPage(browser, base);
    await p.page.route(/data\/town\/feed\.json/, (r) => r.fulfill({ json: { status: {}, tiles: [], ...feed } }));
    await p.page.route(/data\/weather\/latest\.json/, (r) => (weather ? r.fulfill({ json: weather }) : r.fulfill({ status: 404, body: 'no' })));
    await p.page.route(/i\.ytimg\.com/, cam || ((r) => r.fulfill({ status: 404, body: 'no' })));
    await p.page.route(/data\/town\/aerials\//, (r) => r.fulfill({ contentType: 'image/gif', body: DOT }));
    await p.page.route(/\/pics\/ok/, (r) => r.fulfill({ contentType: 'image/gif', body: DOT }));
    await p.page.route(/\/pics\/dead/, (r) => r.fulfill({ status: 403, body: 'no' }));
    await p.page.goto(base + '/town/' + query);
    await settle(p.page);
    await p.page.waitForSelector('.tf-wrap');
    await p.page.waitForTimeout(300);
    return p;
  }
  const hero = (page) => page.evaluate(() => ({ chips: [...document.querySelectorAll('.tf-hero .tf-chip:not([hidden])')].map((c) => c.textContent), cams: document.querySelectorAll('.tf-cam').length,
    camOn: !!document.querySelector('.tf-cam.on'), aerial: document.querySelectorAll('.tf-hero img[src*="town-hero"]').length, text: document.querySelector('.tf-hero').innerText }));

  await group('town: the live top, the camera over the aerial and only what’s on', async () => {
    const quiet = await feedPage({ tiles: [tile('a', 'food')], status: { ban: null, schools: 0, outages: 0 } }, { weather: WEATHER(), cam: (r) => r.fulfill({ contentType: 'image/gif', body: DOT_WIDE }) });
    const a = await hero(quiet.page);
    check(/^47°$/.test(a.chips[0]) && a.chips[1] === 'Lake 53°' && /^Sunset \d+:\d\d$/.test(a.chips[2]) && a.chips.length === 3, 'a clear day: the weather and nothing else', a.chips.join(' | '));
    check(a.camOn && a.aerial === 1, 'the camera sits over the aerial', JSON.stringify(a));
    check(/sddefault_live\.jpg\?t=\d+$/.test(await quiet.page.$eval('.tf-cam', (n) => n.src)), 'the picture’s address turns over with the clock', '');
    await quiet.ctx.close();
    const on = await feedPage({ tiles: [tile('a', 'food')], status: { ban: 'Winter parking ban tonight', schools: 2, outages: 130 } }, { weather: WEATHER() });
    const b = await hero(on.page);
    check(JSON.stringify(b.chips.slice(0, 3)) === JSON.stringify(['Winter parking ban tonight', '2 school closings or delays', '130 without power']), 'what’s on comes first', b.chips.join(' | '));
    check(b.cams === 0 && b.aerial === 1, 'a dead camera leaves the aerial', JSON.stringify(b));
    await on.ctx.close();
    const blank = await feedPage({ tiles: [tile('a', 'food')] }, { weather: WEATHER(), cam: (r) => r.fulfill({ contentType: 'image/gif', body: DOT }) });
    check((await hero(blank.page)).cams === 0, 'YouTube’s little blank picture counts as dead', '');
    await blank.ctx.close();
    const dark = await feedPage({ tiles: [tile('a', 'food')] }, {});
    const c = await hero(dark.page);
    check(!c.chips.length && /Nothing new|new/.test(c.text) && c.aerial === 1, 'no weather file: no chips, and the hero stands', JSON.stringify(c));
    await dark.ctx.close();
    const stale = await feedPage({ tiles: [tile('a', 'food')] }, { weather: { ...WEATHER(), now: { temp_f: 47, observed_at: inHours(-9) }, lake_gage: { water_temp_f: 53, water_temp_at: inHours(-30) } } });
    check((await hero(stale.page)).chips.length === 1, 'a stale reading and a stale lake leave out', JSON.stringify(await hero(stale.page)));
    await stale.ctx.close();
    const night = WEATHER();
    night.sun = { sunrise: inHours(-20), sunset: inHours(-3), sunrise_tomorrow: inHours(8), sunset_tomorrow: inHours(18) };
    const late = await feedPage({ tiles: [tile('a', 'food')] }, { weather: night });
    check((await hero(late.page)).chips.some((x) => /^Sunrise \d/.test(x)), 'after sunset, the next sunrise', (await hero(late.page)).chips.join(' | '));
    await late.ctx.close();
  });

  await group('town: Tonight drops what has started, and hands over to tomorrow', async () => {
    const row = (h, name) => [inHours(h), name, 'The Hall', 'https://example.com/' + name];
    /* all still tonight, whatever hour the test runs: fractions of what's left of the day */
    const clock = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const left = 24 - clock.getHours() - clock.getMinutes() / 60;
    const six = [row(left * 0.1, 'One'), row(left * 0.2, 'Two'), row(left * 0.3, 'Three'), row(left * 0.4, 'Four'), row(left * 0.5, 'Five'), row(left + 12, 'Later')];
    /* the build ranks; the tile keeps its top four and puts them in time order */
    const a = await feedPage({ tiles: [tile('a', 'food')], tonight: { id: 'tonight-x', kind: 'tonight', day: nowDay(), rows: [six[4], six[0], six[1], six[3], six[2], six[5]] } }, {});
    const names = () => a.page.$$eval('.tf-tonight .n', (n) => n.map((x) => x.firstChild.textContent));
    check(JSON.stringify(await names()) === '["One","Two","Four","Five"]', 'four rows, the build’s best, in time order', (await names()).join());
    check(!!(await a.page.$('.tf-tonight [data-act="share"]')) && !!(await a.page.$('.tf-tonight [data-act="save"]')), 'share and star', '');
    await a.ctx.close();
    const past = [row(-2, 'Gone'), row(1, 'Left')];
    const b = await feedPage({ tiles: [tile('a', 'food')], tonight: { id: 'tonight-x', kind: 'tonight', day: nowDay(), rows: past } }, {});
    check(JSON.stringify(await b.page.$$eval('.tf-tonight .n', (n) => n.map((x) => x.firstChild.textContent))) === '["Left"]', 'a row that has started leaves', '');
    await b.ctx.close();
    const d = nowDay(1);
    const noon = new Date(new Date(d + 'T12:00:00Z').getTime() + 4 * 3600000).toISOString();
    const c = await feedPage({ tiles: [tile('a', 'food')], tonight: { id: 'tonight-x', kind: 'tonight', day: nowDay(), rows: [row(-1, 'Gone'), [noon, 'Next', 'The Hall', 'https://example.com/n']] } }, {});
    check((await c.page.$eval('.tf-tonight .tf-title', (n) => n.textContent)) === 'Tomorrow', 'all started: tomorrow takes over', '');
    await c.ctx.close();
    const e = await feedPage({ tiles: [tile('a', 'food')], tonight: { id: 'tonight-x', kind: 'tonight', day: nowDay(-1), rows: [row(-30, 'Old')] } }, {});
    check(!(await e.page.$('.tf-tonight')), 'nothing left: no tile, no empty box', '');
    check(!!(await e.page.$('.tf-food')), 'and the feed draws', '');
    await e.ctx.close();
  });

  await group('town: Pictures and News are lanes, and a dead picture takes its whole tile', async () => {
    const { ctx, page, errors } = await feedPage({ tiles: [tile('photo-ok', 'photo', { title: '@sample', pic: base + '/pics/ok.jpg' }), tile('photo-dead', 'photo', { title: '@gone', pic: base + '/pics/dead.jpg' }),
      tile('news-a', 'news', { title: 'A Burlington story', src: 'Seven Days' }), tile('food-a', 'food')] }, {});
    await page.waitForSelector('.tf-photo .tf-pic.on');
    const ids = await page.$$eval('.tf-wrap > .tf', (n) => n.map((x) => x.dataset.id));
    check(ids.includes('photo-ok') && !ids.includes('photo-dead'), 'the tile whose picture fails is gone', ids.join());
    check((await page.$eval('[data-id="news-a"] .tf-tag', (n) => n.textContent)) === 'Seven Days', 'a story wears its outlet', '');
    check(/@sample/.test(await page.$eval('[data-id="photo-ok"]', (n) => n.innerText)) && !!(await page.$('[data-id="photo-ok"] [data-act="save"]')), 'a picture has its account, a star and a share', '');
    await page.click('#subnav .secpill .chip:has-text("Pictures")');
    await page.waitForTimeout(250);
    const lane = await page.$$eval('.tf-wrap > *', (n) => n.map((x) => x.className));
    check(lane.length === 1 && /tf-photo/.test(lane[0]), 'the Pictures lane holds pictures, and the dead one stays gone', lane.join(' | '));
    await page.click('#subnav .secpill .chip:has-text("News")');
    await page.waitForTimeout(250);
    check((await page.$$('.tf-wrap > .tf-news')).length === 1 && !(await page.$('.tf-hero')), 'the News lane', '');
    check(!errors.filter((e) => !/Failed to load resource/.test(e)).length, 'no console errors', errors.join(' | ').slice(0, 200));
    await ctx.close();
  });

  await group('town: Guess the street fills the slot when the houses run out', async () => {
    const street = (more) => ({ id: 'street-' + nowDay(), kind: 'street', day: nowDay(), img: 'x.jpg', answer: 'Oakledge Park', options: ['Oakledge Park', 'Red Rocks Park', 'Sample Beach'], ...more });
    const a = await feedPage({ tiles: [sale('sold-1'), tile('food-1', 'food')], street: street() }, {});
    check(!!(await a.page.$('[data-id="sold-1"] .tf-opt')) && !(await a.page.$('.tf-street')), 'an unguessed house still comes first', '');
    await a.ctx.close();
    const b = await feedPage({ tiles: [tile('food-1', 'food')], street: street() }, {});
    const face = await b.page.evaluate(() => ({ tag: document.querySelector('.tf-street .tf-tag').textContent, opts: [...document.querySelectorAll('.tf-street .tf-opt')].map((x) => x.textContent),
      pic: document.querySelector('.tf-street .tf-pic').getAttribute('src'), order: [...document.querySelector('.tf-wrap').children].map((n) => n.className).slice(0, 2), text: document.querySelector('.tf-street').innerText }));
    check(face.tag === 'Guess the street' && face.opts.length === 3 && /aerials\/x\.jpg$/.test(face.pic) && /tf-street/.test(face.order[1]), 'its tag, three names, the aerial, straight under the hero', JSON.stringify(face));
    check(!!(await b.page.$('.tf-street [data-act="share"]')) && !!(await b.page.$('.tf-street [data-act="save"]')), 'share and star', '');
    await b.page.click('.tf-street .tf-opt[data-place="Red Rocks Park"]');
    await b.page.waitForTimeout(150);
    const miss = await b.page.evaluate(() => ({ text: document.querySelector('.tf-street .tf-guess').innerText, cls: document.querySelector('.tf-street .tf-result').className, run: localStorage.getItem('town-feed-run') }));
    check(/Oakledge Park/.test(miss.text) && /Not this one/.test(miss.text) && /miss/.test(miss.cls) && miss.run === '0', 'a wrong name shows the place and ends the run', JSON.stringify(miss));
    await b.page.reload();
    await settle(b.page);
    await b.page.waitForSelector('.tf-street');
    await b.page.waitForTimeout(200);
    check(!(await b.page.$('.tf-street .tf-opt')) && /Oakledge Park/.test(await b.page.$eval('.tf-street .tf-guess', (n) => n.innerText)), 'guessed stays guessed', '');
    await b.page.evaluate(() => { localStorage.removeItem('town-feed-guess'); localStorage.setItem('town-feed-run', '1'); });
    await b.page.reload();
    await settle(b.page);
    await b.page.waitForSelector('.tf-street .tf-opt');
    await b.page.click('.tf-street .tf-opt[data-place="Oakledge Park"]');
    await b.page.waitForTimeout(150);
    const hit = await b.page.evaluate(() => ({ said: document.querySelector('.tf-street .tf-said').textContent, chip: document.querySelector('.tf-chip.run').textContent, shown: !document.querySelector('.tf-chip.run').hidden }));
    check(hit.said === '2 in a row' && hit.shown && hit.chip === '2 in a row', 'a right name counts on the same run', JSON.stringify(hit));
    await b.ctx.close();
    const c = await feedPage({ tiles: [tile('food-1', 'food')], street: street({ day: nowDay(-1) }) }, {});
    check(!(await c.page.$('.tf-street')), 'yesterday’s file has no street for today', '');
    await c.ctx.close();
    const d = await newPage(browser, base);
    await d.page.route(/data\/town\/feed\.json/, (r) => r.fulfill({ json: { status: {}, street: street(), tiles: [tile('food-1', 'food')] } }));
    await d.page.route(/data\/town\/aerials\//, (r) => r.fulfill({ status: 404, body: 'no' }));
    await d.page.goto(base + '/town/');
    await settle(d.page);
    await d.page.waitForSelector('.tf-food');
    await d.page.waitForTimeout(400);
    check(!(await d.page.$('.tf-street')), 'no aerial, no game', '');
    await d.ctx.close();
    const f = await json('all-day/data/demo/town-feed.json');
    const demo = await newPage(browser, base);
    await demo.page.route(/data\/demo\/town-feed\.json/, (r) => r.fulfill({ json: { ...f, tiles: f.tiles.filter((t) => t.kind !== 'sold') } }));
    await demo.page.goto(base + '/town/?demo=1');
    await settle(demo.page);
    await demo.page.waitForSelector('.tf-street');
    check(!!(await demo.page.$('.tf-street .ph')) && (await demo.page.$$('.tf-street .tf-opt')).length === 3, 'the demo paints its street', '');
    await demo.page.click('.tf-street .tf-opt[data-place="' + f.street.answer + '"]');
    await demo.page.waitForTimeout(150);
    check(/You got it/.test(await demo.page.$eval('.tf-street .tf-guess', (n) => n.innerText)), 'and it plays', '');
    await demo.ctx.close();
  });

  await group('town: the new files print no home and no public-record name', async () => {
    const feed = await json('data/town/feed.json');
    const moves = await json('data/town/moves.json');
    const { races } = await json('data/town/races.json');
    const HOUSE = /\b\d+[a-z]?\s+(?:[A-Z][a-z.]+\s+){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Pl|Place)\b/;
    const texts = [...(feed.tonight ? feed.tonight.rows.flatMap((r) => [r[1], r[2]]) : []), ...feed.tiles.filter((t) => ['news', 'photo', 'calendar'].includes(t.kind)).flatMap((t) => [t.title, ...(t.rows || []).flatMap((r) => [r[1], r[2]])]),
      ...moves.events.flatMap((m) => [m.title, m.where]), ...races.map((r) => r.name)].filter(Boolean);
    const bad = texts.filter((x) => HOUSE.test(x));
    check(texts.length > 0 && !bad.length, 'no street address in any new tile', bad.slice(0, 3).join(' | '));
    check(feed.tiles.filter((t) => t.kind === 'news').every((t) => !/police|arrest|charged|court|suspect/i.test(t.title.replace(/police chief/i, ''))), 'no crime story in Local news', '');
    check(!feed.tiles.some((t) => t.c !== undefined) && !JSON.stringify(moves.scene).includes('"c"'), 'no Instagram caption goes out', '');
    check(races.every((r) => r.street === undefined && r.address === undefined), 'a race keeps only its town', '');
    if (feed.street) check(feed.street.options.includes(feed.street.answer) && feed.street.options.length === 3 && !feed.street.options.some((x) => /^\d/.test(x)), 'Guess the street: named places only', feed.street.options.join());
  });

  await group('town: Now, new marks, caught up, the filters', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    const out = [];
    page.on('request', (r) => { if (/vcgi|supabase/.test(r.url())) out.push(r.url()); });
    await page.goto(base + '/town/?demo=1');
    await settle(page);
    await page.waitForSelector('.tf-wrap');
    const order = await page.$$eval('.tf-wrap > *', (n) => n.map((x) => (x.classList.contains('tf-caught') ? 'caught' : x.classList.contains('tf-hero') ? 'hero' : x.querySelector('.tf-new') ? 'new' : 'old')));
    const at = order.indexOf('caught');
    check(at > 0 && !order.slice(at + 1).includes('new') && order.slice(3, at).every((x) => x === 'new'), 'New tiles first, then “You’re caught up”, then the rest', order.join());
    const hot = await page.$$eval('.tf-wrap > .tf', (n) => n.slice(1, 3).map((x) => x.querySelector('.tf-tag').textContent));
    check(hot[1] === 'Most talked about', 'the busiest thread sits under the day’s house', hot.join());
    const pills = await page.$$eval('#subnav .secpill .chip', (c) => c.map((x) => x.textContent.trim()));
    check(pills[0] === 'Latest' && pills.includes('Homes') && pills.includes('Jobs') && pills.includes('Pictures') && pills.includes('News'), 'the pill: Latest first, then the kinds', pills.join());
    const top = await page.evaluate(() => ({ chips: [...document.querySelectorAll('.tf-hero .tf-chip:not([hidden])')].map((c) => c.textContent), cam: document.querySelectorAll('.tf-cam').length,
      night: [...document.querySelectorAll('.tf-tonight .tf-rows .n')].length, title: document.querySelector('.tf-tonight .tf-title').textContent, rollup: document.querySelector('.tf-calendar .tf-count').innerText,
      photo: !!document.querySelector('.tf-photo .ph'), news: document.querySelector('.tf-news .tf-tag').textContent }));
    check(JSON.stringify(top.chips.slice(0, 3)) === JSON.stringify(['Pretend parking ban tonight', '1 school closing or delay', '40 without power']) && top.chips.includes('54°') && top.chips.includes('Lake 51°') && top.chips.some((c) => /^Sunset \d/.test(c)), 'the demo’s top: a ban, a closing, an outage, the weather', top.chips.join(' | '));
    check(!top.cam, 'the demo makes no call to the camera', '');
    check(top.night >= 3 && /^(Tonight|Tomorrow)$/.test(top.title), 'the demo’s Tonight has its rows', JSON.stringify(top));
    check(/12\s+new on the calendar/.test(top.rollup) && top.photo && top.news === 'Demo Daily', 'the demo has a rollup, a painted picture and a news tile', JSON.stringify(top));
    await page.click('#subnav .secpill .chip[data-chip="homes"], #subnav .secpill .chip:has-text("Homes")');
    await page.waitForTimeout(250);
    const homes = await page.$$eval('.tf-wrap > *', (n) => n.map((x) => x.className));
    check(homes.length === 2 && homes.every((c) => /tf-sold/.test(c)), 'Homes shows only sales, with no hero', homes.join(' | '));
    await page.click('#subnav .secpill .chip:has-text("Latest")');
    await page.waitForTimeout(250);
    check(!!(await page.$('.tf-hero')), 'Latest brings the hero back', '');
    const face = await page.$eval('#panel-feed', (n) => ({ acts: [...n.querySelectorAll('.tf')].every((t) => t.querySelector('[data-act="share"]') && t.querySelector('[data-act="save"]')),
      bad: n.querySelectorAll('[data-act="comment"], [data-act="up"], input, textarea').length, text: n.innerText }));
    check(face.acts, 'every tile has share and star', '');
    check(!face.bad, 'no comments, no votes, nothing to type', String(face.bad));
    check(!/verified|checked on/i.test(face.text.replace('since you checked', '')), 'no verified labels', '');
    await page.click('.tf-chip[href="#alerts/trash"]');
    await page.waitForTimeout(500);
    check((await page.evaluate(() => document.querySelector('#tabbar button[aria-selected="true"]').dataset.tab)) === 'alerts', 'the ban chip opens Alerts', '');
    await page.goto(base + '/town/?demo=1#feed/tf-going-demo-1');
    await settle(page);
    await page.waitForSelector('[data-k="tf-going-demo-1"]');
    await page.waitForTimeout(400);
    check(await page.evaluate(() => { const c = document.querySelector('[data-k="tf-going-demo-1"]').getBoundingClientRect(); return c.top < innerHeight && c.bottom > 0; }), 'a shared tile’s link lands on that tile', '');
    await page.goto(base + '/town/?demo=1#feed/going-demo-1');
    await settle(page);
    await page.waitForTimeout(300);
    check(!/moved on/.test(await page.$eval('#toast', (t) => (t.hidden ? '' : t.textContent))), 'a link saved with the bare id still lands on its tile', '');
    await page.goto(base + '/town/?demo=1#feed/homes');
    await settle(page);
    await page.waitForSelector('.tf-sold');
    check(!(await page.$('.tf-hero')) && (await page.$$('.tf-wrap > .tf')).length === 2, 'a link can open a filter', '');
    check(!out.length, 'the demo calls neither the aerials nor Supabase', out.slice(0, 2).join(' '));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('town: Now’s New marks move only after a real absence', async () => {
    const { ctx, page } = await newPage(browser, base);
    await page.goto(base + '/town/?demo=1');
    await settle(page);
    await page.waitForSelector('.tf-wrap');
    const marks = () => page.$$eval('#panel-feed .tf-new', (n) => n.length);
    const tally = () => page.$eval('.tf-tally', (n) => n.innerText);
    const n = await marks();
    check(n > 0, 'the demo opens with New marks', String(n));
    await goTab(page, 'alerts');
    await goTab(page, 'feed');
    check(await marks() === n, 'a short trip keeps them', String(await marks()));
    await goTab(page, 'alerts');
    await page.evaluate(() => { const real = Date.now; Date.now = () => real() + 11 * 60000; });
    await goTab(page, 'feed');
    check(await marks() === 0 && /Nothing new yet/.test(await tally()), 'eleven minutes away starts a fresh count', await tally());
    await ctx.close();
  });

  await group('town: Settings has a quiet way to ask for a takedown', async () => {
    const { ctx, page } = await newPage(browser, base);
    await page.goto(base + '/town/?demo=1');
    await settle(page);
    await page.click('#settings-btn');
    await page.waitForSelector('[data-takedown]');
    check(/^mailto:btownbrief@gmail\.com/.test(await page.$eval('[data-takedown]', (a) => a.getAttribute('href'))), 'Town’s Settings has the takedown email', '');
    await page.goto(base + '/body/?demo=1');
    await page.waitForTimeout(500);
    await page.click('#settings-btn');
    await page.waitForTimeout(300);
    check(!(await page.$('[data-takedown]')), 'and only Town’s', '');
    await ctx.close();
  });

  await group('town: a meeting’s note shows on its tile and in its row, live and in the demo', async () => {
    const day = (n) => ymd.format(new Date(Date.now() + n * 864e5));
    const notes = (page) => page.evaluate(() => ({ city: document.querySelector('.tf-city .tf-sub').textContent,
      rows: [...document.querySelectorAll('.tf-cityweek .tf-rows li')].map((li) => [li.querySelector('.n').firstChild.textContent, li.querySelector('.tf-sub')?.textContent || '']),
      block: getComputedStyle(document.querySelector('.tf-cityweek .tf-rows .tf-sub')).display }));
    const ts = new Date().toISOString();
    const feed = { status: {}, tiles: [
      { id: 'city-1', kind: 'city', ts, title: 'Pretend Board', day: day(3), agenda: true, sub: 'Moved to Contois', url: 'https://example.com/p' },
      { id: 'city-2', kind: 'city', ts, title: 'Quiet Board', day: day(4), agenda: false, url: 'https://example.com/q' },
      { id: 'cityweek', kind: 'cityweek', ts, n: 2, url: '#cityhall', rows: [[day(1), 'Sample Board', 'https://example.com/a', 'Special'], [day(2), 'Other Board', 'https://example.com/b']] },
    ] };
    const live = await newPage(browser, base);
    await live.page.route(/data\/town\/feed\.json/, (r) => r.fulfill({ json: feed }));
    await live.page.goto(base + '/town/');
    await settle(live.page);
    await live.page.waitForSelector('.tf-cityweek');
    const a = await notes(live.page);
    check(a.city === 'Moved to Contois · Agenda posted', 'the city tile shows its note', a.city);
    check(/^On the calendar$/.test(await live.page.$eval('[data-id="city-2"] .tf-sub', (n) => n.textContent)), 'a tile with no note is unchanged', '');
    check(JSON.stringify(a.rows) === JSON.stringify([['Sample Board', 'Special'], ['Other Board', '']]), 'a row shows its note, a row without one nothing', JSON.stringify(a.rows));
    check(a.block === 'block', 'the note sits under the name', a.block);
    check(!live.errors.length, 'no console errors', live.errors.join(' | '));
    await live.ctx.close();
    const f = await json('all-day/data/demo/town-feed.json');
    const demoFile = { ...f, tiles: f.tiles.map((t) => (t.kind === 'cityweek' ? { ...t, rows: t.rows.map((r, i) => (i ? r : [...r, 'Special'])) } : t.kind === 'city' ? { ...t, sub: 'Moved to Contois' } : t)) };
    const demo = await newPage(browser, base);
    await demo.page.route(/data\/demo\/town-feed\.json/, (r) => r.fulfill({ json: demoFile }));
    await demo.page.goto(base + '/town/?demo=1');
    await settle(demo.page);
    await demo.page.waitForSelector('.tf-cityweek');
    const b = await notes(demo.page);
    check(/^Moved to Contois · /.test(b.city) && b.rows[0][1] === 'Special', 'the demo keeps the note when it redates a row', JSON.stringify(b));
    await demo.ctx.close();
  });

  await group('town: Alerts counts closings at a glance; district posts stay in Schools', async () => {
    const real = await json('data/town/alerts.json');
    const closing = { org: 'A pretend school', status: 'Closed', outlet: 'NBC5', source_url: 'https://example.com/c', posted: new Date().toISOString() };
    const post = (n) => ({ headline: 'District post ' + n, outlet: 'BSD', source_url: 'https://example.com/d' + n, posted: new Date().toISOString() });
    const glance = async (items, district_posts) => {
      const { ctx, page } = await newPage(browser, base);
      const file = { ...real, sections: { ...real.sections, closings: { ...real.sections.closings, items, district_posts } } };
      await page.route(/data\/town\/alerts\.json/, (r) => r.fulfill({ json: file }));
      await page.goto(base + '/town/#alerts');
      await settle(page);
      const out = await page.evaluate(() => ({ top: document.querySelector('#panel-alerts [data-k="at-schools"]').innerText.replace(/\s+/g, ' '),
        rows: [...document.querySelectorAll('#panel-alerts [data-sec="schools"] [data-k^="close-"]')].map((n) => n.innerText.replace(/\s+/g, ' ')) }));
      await ctx.close();
      return out;
    };
    const posts = await glance([], [post(1), post(2)]);
    check(/Schools open, no delays/.test(posts.top) && !/\bSchools\b.*\bSchools\b/.test(posts.top), 'posts alone leave the glance at open', posts.top);
    check(posts.rows.length === 2 && /District post 1/.test(posts.rows[0]), 'and they stay in the Schools section', JSON.stringify(posts.rows));
    const both = await glance([closing], [post(1), post(2)]);
    check(/^1 school closing or delay/.test(both.top), 'the glance counts the closing, not the posts', both.top);
    check(both.rows.length === 3, 'the Schools section lists all three', JSON.stringify(both.rows));
  });

  await group('town: Now on the real feed keeps house numbers out', async () => {
    const f = await json('data/town/feed.json');
    const homes = f.tiles.filter((t) => t.kind === 'sold' && /^(House|Condo|Multi-family|Mobile home) on /.test(t.title));
    check(homes.length > 0 && homes.every((t) => !/\d/.test(t.title)), 'a home is shown by street, never by number', homes.map((t) => t.title).slice(0, 4).join(' | '));
    check(f.tiles.every((t) => t.lat === undefined && t.lon === undefined), 'the feed carries no map points', '');
    const allowed = new Set(['id', 'kind', 'ts', 'title', 'price', 'assessed', 'closed', 'img', 'url', 'where', 'what', 'cost', 'n', 'bars', 'rows', 'day', 'agenda', 'org', 'score', 'comments', 'sub', 'src', 'pic']);
    const extra = [...new Set(f.tiles.flatMap((t) => Object.keys(t)))].filter((k) => !allowed.has(k));
    check(!extra.length, 'the feed carries only the fields the tiles draw', extra.join());
    check(!JSON.stringify(f).match(/buyer|seller|applicant|contractor|description/i), 'no buyer, seller, applicant, contractor or description', '');
    const { ctx, page, errors } = await newPage(browser, base);
    const state = [];
    page.on('request', (r) => { if (/vcgi/.test(r.url())) state.push(r.url()); });
    await page.route(/data\/town\/aerials\/|assets\/aerial\//, (r) => r.abort());
    await page.route(/cdninstagram|fbcdn/, (r) => r.fulfill({ contentType: 'image/gif', body: DOT }));
    await page.goto(base + '/town/');
    await settle(page);
    await page.waitForSelector('.tf-wrap');
    check(!state.length, 'a reader’s phone never calls the state’s server', state[0] || '');
    const n = await page.$$eval('.tf-wrap > .tf:not(.tf-tonight)', (x) => x.length);
    check(n === f.tiles.length, 'every tile in the file draws', n + ' of ' + f.tiles.length);
    await page.evaluate(() => { const p = document.querySelector('.panel:not([hidden])'); p.scrollTo(0, p.scrollHeight); });
    await page.waitForTimeout(600);
    check(!!(await page.$('.tf-frame')) && !(await page.$('.tf-pic.on[src*="aerial"]')), 'a tile whose aerial never comes keeps its colour', '');
    await pageRules(page, 'town/feed', 390);
    check(!errors.filter((e) => !/ERR_FAILED|Failed to load resource/.test(e)).length, 'no console errors', errors.join(' | ').slice(0, 200));
    await ctx.close();
  });

  await group('town: the Square, the Wire’s own, as a seventh tab (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/town/?demo=1');
    await settle(page);
    const bar = await page.$$eval('#tabbar button', (bs) => bs.map((b) => b.textContent.trim()));
    check(JSON.stringify(bar) === '["Now","Alerts","City Hall","Streets","Square","Guides","Jobs"]', 'the bar: seven tabs, Streets in the centre cell', JSON.stringify(bar));
    await goTab(page, 'square');
    await page.waitForSelector('#panel-square .sq-feed', { timeout: 8000 }).catch(() => {});
    const look = await page.evaluate(async () => {
      const m = await import('/all-day/js/modes/wire-square.js');
      const bg = (c) => { const n = document.querySelector('#panel-square .sq-out.' + c + ' .sq-chip'); return n ? getComputedStyle(n).backgroundColor : ''; };
      return { state: m._state(), burlington: bg('w-sub-burlington'), vermont: bg('w-sub-vermont'), facebook: bg('w-src-facebook'),
        compose: !!document.querySelector('#panel-square .sq-compose'), board: document.querySelectorAll('#panel-square .card.board').length,
        link: (document.querySelector('#panel-square .card.board a[href^="#"]') || {}).getAttribute?.('href') || '' };
    });
    check(look.compose && look.board > 0, 'the Square draws here: the five ways to post and the neighbors’ cards', JSON.stringify(look.state.counts));
    check(look.burlington && look.vermont && look.burlington !== look.vermont && look.facebook !== look.vermont, 'r/burlington, r/vermont and Facebook each in its own colour', JSON.stringify([look.burlington, look.vermont, look.facebook]));
    const keys = await page.$$eval('#panel-square .sq-types .chip', (cs) => cs.map((c) => c.dataset.chip));
    check(JSON.stringify(keys) === '["all","post","show","ask","free","pets","facebook","burlington","vermont"]', 'the chips at the top of the tab', JSON.stringify(keys));
    await page.click('#panel-square .sq-types .chip[data-chip="vermont"]');
    await page.waitForTimeout(150);
    const on = await page.evaluate(() => import('/all-day/js/modes/wire-square.js').then((m) => m._state().list.map((x) => x.type)));
    check(on.length > 0 && on.every((t) => t === 'vermont'), 'r/vermont alone', JSON.stringify(on));
    await page.reload();
    await settle(page);
    await page.waitForSelector('#panel-square .sq-types', { timeout: 8000 }).catch(() => {});
    check(await page.$eval('#panel-square .sq-types .chip.on', (c) => c.dataset.chip) === 'vermont', 'the pick is kept through a reload', '');
    await page.goto(base + '/all-day/?demo=1#wire/square');
    await settle(page);
    check((await page.evaluate(() => import('/all-day/js/modes/wire-square.js').then((m) => m.type()))) === 'vermont', 'and All Day’s Wire keeps the same pick', '');
    await page.goto(base + '/town/?demo=1#square/b-nothing-here');
    await settle(page);
    await page.waitForTimeout(200);
    check(/moved on/.test(await page.$eval('#toast', (t) => t.textContent)), 'a link to a post that has gone says so', '');
    check(await page.evaluate(() => localStorage.getItem('allday-square-type')) === 'vermont', 'and a link leaves the kept pick alone', '');
    await page.goto(base + '/town/?demo=1#wire/square');
    await page.waitForURL(/\/all-day\/\?demo=1#wire\/square$/, { timeout: 8000 }).catch(() => {});
    check(/\/all-day\/\?demo=1#wire\/square$/.test(page.url()), '#wire links still go home to All Day’s Wire', page.url());
    await pageRules(page, 'town/square', 390);
    check(!errors.length, 'no console errors', errors.slice(0, 5).join(' | '));
    await ctx.close();
  });

  await group('town: the Square with every live source down, and before its SQL', async () => {
    const { ctx, page } = await newPage(browser, base);
    await page.route(/wire-data\/data\/wire-today\.json|pulse-data\/data\/pulse\.json|data\/wire-today\.json|data\/pulse\.json/, (r) => r.abort());
    await page.goto(base + '/town/#square');
    await settle(page);
    await page.waitForSelector('#panel-square .sq-empty', { timeout: 8000 }).catch(() => {});
    const s = await page.evaluate(() => {
      const p = document.querySelector('#panel-square');
      return { compose: !!p.querySelector('.sq-compose'), empty: !!p.querySelector('.sq-empty'), chips: !!p.querySelector('.sq-types'), feed: !!p.querySelector('.sq-feed'), loading: !!p.querySelector('.loading') };
    });
    check(s.empty && !s.compose && !s.chips && !s.feed && !s.loading, 'a line, no box, no chips and no posting on a board that isn’t open', JSON.stringify(s));
    await ctx.close();
  });

  for (const demo of [false, true]) {
    await group('town: every tab ' + (demo ? 'in the demo' : 'live'), async () => {
      const { ctx, page, errors } = await newPage(browser, base);
      await page.goto(base + '/town/' + (demo ? '?demo=1' : ''));
      await settle(page);
      /* Now and the Square are feeds, with no sections; each has its own group */
      for (const t of cfg.tabs.filter((x) => x.mode !== 'feed' && x.mode !== 'square')) {
        await goTab(page, t.mode);
        await page.waitForTimeout(demo ? 200 : 400);
        const s = await sections(page);
        check(JSON.stringify(s.secs) === JSON.stringify(t.top), t.mode + ': one section per top tab, in order', JSON.stringify(s.secs));
        check(s.pill.length === t.top.length && t.top.every((x) => s.pill.includes(x)), t.mode + ': the pill names every top tab', JSON.stringify(s.pill));
        check(!/Didn’t load|didn’t draw/.test(s.text), t.mode + ': every section drew', (s.text.match(/.{0,60}(Didn’t load|didn’t draw).{0,20}/) || [''])[0]);
        await pageRules(page, 'town/' + t.mode, 390);
      }
      check(!errors.length, 'no console errors', errors.slice(0, 5).join(' | '));
      await ctx.close();
    });
  }

  await group('town: Trash & parking finds your street and remembers it', async () => {
    const rec = (await json('data/town/alerts.json')).sections.recycling.items;
    const want = rec.find((r) => r.street === 'Pine St') || rec[0];
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/town/#alerts/trash');
    await settle(page);
    await page.fill('#panel-alerts input[name="street"]', want.street);
    await page.waitForTimeout(150);
    const got = await page.$$eval('#panel-alerts [data-k="street-lookup"] .lrow', (rs) => rs.map((r) => r.innerText));
    check(got.length >= 1 && got.some((g) => g.includes(want.recycling_day) && g.includes('zone ' + want.parking_ban_zone)), want.street + ': its recycling day and ban zone', JSON.stringify(got));
    check(await page.evaluate(() => JSON.parse(localStorage.getItem('town-street'))) === want.street, 'the street is kept on this device', '');
    await page.reload();
    await settle(page);
    check(await page.$eval('#panel-alerts input[name="street"]', (i) => i.value) === want.street, 'and it is filled in on the next visit', '');
    await page.fill('#panel-alerts input[name="street"]', 'Nowhere Such Rd');
    check(/No street by that name/.test(await page.$eval('#panel-alerts [data-k="street-lookup"]', (n) => n.innerText)), 'an unknown street says so', '');
    const txt = await page.$eval('#panel-alerts [data-sec="trash"]', (n) => n.innerText);
    check(/no city trash day/.test(txt) && /802-658-SNOW/.test(txt), 'trash is the hauler’s day, and the ban’s official word is named', txt.slice(0, 200));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
    const d = await newPage(browser, base);
    await d.page.goto(base + '/town/?demo=1#alerts/trash');
    await settle(d.page);
    await d.page.fill('#panel-alerts input[name="street"]', 'Pine St');
    check(await d.page.evaluate(() => localStorage.getItem('town-street')) === null, 'the demo never writes the street down', '');
    await d.ctx.close();
  });

  await group('town: honest empty states and dated signups', async () => {
    const { ctx, page } = await newPage(browser, base);
    await page.goto(base + '/town/#alerts/signups');
    await settle(page);
    const today = ymd.format(new Date());
    const su = (await json('data/town/signups.json')).programs.filter((p) => p.date_basis === 'published' && ((p.next_opens || '') >= today || (p.next_deadline || '') >= today));
    const rows = await page.$$eval('#panel-alerts [data-sec="signups"] .lrow', (rs) => rs.map((r) => r.dataset.k));
    check(rows.length === su.length && su.every((p) => rows.includes('su-' + p.id)), 'Signups: every published date from today on, and only those', rows.length + ' vs ' + su.length);
    const a = (await json('data/town/alerts.json')).sections;
    const sch = await page.$eval('#panel-alerts [data-sec="schools"]', (n) => n.innerText);
    if (!a.closings.items.length && !a.closings.district_posts.length) check(/No closings or delays/.test(sch) && /As of /.test(sch), 'Schools: none, said plainly, as of when', sch.slice(0, 120));
    const plows = await page.$eval('#panel-alerts [data-sec="plows"]', (n) => n.innerText);
    check(/no street plow tracker/i.test(plows), 'Plows: the plain line that the city has no street tracker', '');
    const sh = await page.$eval('#panel-alerts [data-sec="shelters"]', (n) => n.innerText);
    check(/For a bed tonight, call 2-1-1/.test(sh) && !/checked by hand/.test(sh) && /COTS Waystation/.test(sh), 'Shelters: the standing list and 2-1-1', '');
    await ctx.close();
  });

  await group('town: City Hall shows the portal’s own meeting times', async () => {
    const civic = await json('data/civic.json');
    const m = civic.upcoming.filter((x) => x.agenda_url).sort((x, y) => x.start.localeCompare(y.start))[0];
    const { ctx, page } = await newPage(browser, base);
    await page.goto(base + '/town/#cityhall/meetings');
    await settle(page);
    if (m) {
      const wall = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(m.start));
      const txt = await page.$eval('#panel-cityhall [data-sec="meetings"]', (n) => n.innerText);
      check(txt.includes(m.title) && txt.includes(wall), m.title + ' at ' + wall + ', the portal’s wall time', '');
    }
    const el = await page.$eval('#panel-cityhall [data-sec="elections"]', (n) => n.innerText);
    check(/Tuesday, March 2, 2027/.test(el) && /Monday, January 25, 2027/.test(el) && /confirm/i.test(el), 'Elections: Town Meeting Day 2027 and the filing deadline, to confirm', el.slice(0, 160));
    await page.fill('#panel-cityhall input[name="value"]', '400000');
    const est = await page.$eval('#panel-cityhall [data-k="tax-estimate"]', (n) => n.innerText);
    check(/About \$9,836 a year/.test(est), 'Money: a $400,000 home comes to about $9,836 at the FY27 rates', est.slice(-120));
    await ctx.close();
  });

  await group('town: Streets keeps names out', async () => {
    const s = (await json('data/town/streets.json')).sections;
    const { ctx, page } = await newPage(browser, base);
    await page.goto(base + '/town/#streets');
    await settle(page);
    await page.evaluate(() => document.querySelectorAll('#panel-streets .btn.more').forEach((b) => b.click()));
    const txt = await page.$eval('#panel-streets', (n) => n.innerText);
    const contractors = [...new Set(s.permits.items.map((p) => p.contractor).filter(Boolean))];
    const owners = [...new Set(s.sales.items.flatMap((x) => [x.buyer_entity, x.seller_entity]).filter(Boolean))];
    check(!contractors.some((c) => txt.includes(c)), 'no contractor names on permits', contractors.filter((c) => txt.includes(c)).join(', '));
    check(!owners.some((c) => txt.includes(c)), 'no buyer or seller names on sales', owners.filter((c) => txt.includes(c)).join(', '));
    const saleRows = await page.$$eval('#panel-streets [data-sec="sold"] .lrow[data-k^="sale-"]', (rs) => rs.map((r) => r.innerText));
    check(saleRows.length > 0 && saleRows.every((r) => !/out of state|out-of-state|outside vermont/i.test(r)), 'no out-of-state flag on any sale', saleRows.find((r) => /out/i.test(r)) || '');
    const share = await page.$eval('#panel-streets [data-sec="sold"] .stat', (n) => n.innerText);
    check(/\d+%\s+Buyers from out of state, past year/.test(share), 'out-of-state buyers only as the past year’s share, which the listed sales can’t be matched to', share);
    const heads = await page.$$eval('#panel-streets [data-sec="blotter"] .lrow[data-k^="pr-"]', (rs) => rs.map((r) => [r.querySelector('.t').textContent, r.querySelector('.s').textContent]));
    check(heads.length > 0 && heads.every(([t, sub]) => /^[A-Za-z /&,-]+$/.test(t.trim()) && /case \d{2}[A-Z]{2}\d{5,}/.test(sub)), 'blotter rows are an offence and a case number, one per case', JSON.stringify(heads));
    const cases = (s.blotter.press_releases || []).map((x) => x.case_number);
    check(heads.length === new Set(cases).size, 'an update folds into its case', heads.length + ' rows for ' + new Set(cases).size + ' cases');
    await ctx.close();
  });

  await group('town: a Streets photo that fails leaves no empty box', async () => {
    const { ctx, page } = await newPage(browser, base);
    await page.route(/data\/town\/aerials\//, (r) => r.abort());
    await page.goto(base + '/town/#streets');
    await settle(page);
    await page.waitForSelector('#panel-streets .lrow');
    await page.$$eval('#panel-streets .tl-pic img', (n) => n.forEach((i) => { i.loading = 'eager'; }));
    await page.waitForFunction(() => !document.querySelector('#panel-streets .tl-pic'));
    check(!!(await page.$('#panel-streets [data-sec="sold"] .lrow.meet .th.tm')), 'the row takes the date tile instead', '');
    await ctx.close();
  });

  await group('town: the demo’s states and the board', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/town/?demo=1#alerts');
    await settle(page);
    const al = await page.$eval('#panel-alerts', (n) => n.innerText);
    check(/Ban headline/.test(al) && /Delayed 2 hours/.test(al) && /Warming station open tonight/.test(al), 'Alerts demo: a ban headline, a closing and a warming station', '');
    await goTab(page, 'streets');
    await page.waitForSelector('#panel-streets [data-sec="report"] .card.board');
    const chips = await page.$$eval('#panel-streets [data-sec="report"] .card.board .c-head .tag:last-child', (t) => t.map((x) => x.textContent));
    check(chips.length >= 2 && chips.includes('Fixed') && chips.includes('Still broken'), 'Report: each street report has a status chip', JSON.stringify(chips));
    check(!!(await page.$('#panel-streets [data-sec="report"] a[href="https://www.burlingtonvt.gov/862/Report-a-Concern"]')), 'Report: the city’s See, Click, Fix sits beside the board', '');
    await goTab(page, 'cityhall');
    const vt = await page.$$eval('#panel-cityhall [data-sec="together"] .lrow a.t', (as) => as.map((a) => a.getAttribute('href')));
    check(vt.length === 3 && vt.every((x) => /^#people\/b-/.test(x)), 'Vote together: watch parties, each opening on All Day’s People tab', JSON.stringify(vt));
    check(!(await page.$('#panel-cityhall [data-sec="together"] [data-act="bvote"]')), 'read-only here: no vote or post buttons', '');
    await goTab(page, 'work');
    const groups = await page.$$eval('#panel-work [data-sec="jobs"] .tdiv > span:first-child', (n) => n.map((x) => x.textContent));
    check(JSON.stringify(groups.slice(0, 3)) === '["Today","This week","Earlier"]', 'Jobs: Today, This week, Earlier', JSON.stringify(groups));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('town: the demo writes nothing of its own; a missing file says so; hostile data stays inert', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/town/?demo=1');
    await settle(page);
    const before = await page.evaluate(() => Object.keys(localStorage).sort());
    for (const t of TABS.slice(1)) await goTab(page, t);
    await page.goto(base + '/town/?demo=1#alerts/trash');
    await settle(page);
    await page.fill('#panel-alerts input[name="street"]', 'Pine St');
    await page.goto(base + '/town/?demo=1#guides/newhere');
    await settle(page);
    await page.click('#panel-guides [data-k="new-library"] button');
    /* btown-player-id is the shell's anonymous device id, written by boards.js for any board, demo or not */
    const after = await page.evaluate(() => Object.keys(localStorage).filter((k) => /^town-/.test(k)));
    check(!after.length, 'no town- key is written in the demo', JSON.stringify({ before, after }));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
    const f = await newPage(browser, base);
    await f.page.route(/\/data\/town\/signups\.json$/, (r) => r.fulfill({ status: 404, body: '' }));
    await f.page.goto(base + '/town/#alerts');
    await settle(f.page);
    const t = await f.page.evaluate(() => ['today', 'signups', 'trash'].map((k) => document.querySelector('#panel-alerts [data-sec="' + k + '"]').innerText));
    check(/Didn’t load/.test(t[1]) && !/No signups/.test(t[1]), 'a file that fails says it didn’t load, never “nothing”', JSON.stringify(t.map((x) => x.slice(0, 80))));
    check(/Your street/.test(t[2]), 'and the rest of the tab still works', '');
    await f.ctx.close();
    const h = await newPage(browser, base);
    const real = await json('data/town/feed.json');
    real.tiles.unshift({ id: 'food-bad', kind: 'food', ts: new Date().toISOString(), title: '<img src=x onerror="window.__pwn=1">Agenda posted', url: 'javascript:window.__pwn=1' });
    await h.page.route(/\/data\/town\/feed\.json$/, (r) => r.fulfill({ status: 200, body: JSON.stringify(real), contentType: 'application/json' }));
    await h.page.route(/maps\.vcgi\.vermont\.gov/, (r) => r.abort());
    await h.page.goto(base + '/town/');
    await settle(h.page);
    await h.page.waitForSelector('[data-id="food-bad"]');
    const bad = await h.page.evaluate(() => { const c = document.querySelector('[data-id="food-bad"]'); const a = c.querySelector('.tf-go');
      return { href: a.getAttribute('href'), text: c.querySelector('.tf-title').textContent, img: !!document.querySelector('#panel-feed img[src="x"]'), pwn: !!window.__pwn }; });
    check(bad && bad.href === '#' && /<img/.test(bad.text) && !bad.img && !bad.pwn, 'a javascript: link becomes #, and markup in a headline is shown as text', JSON.stringify(bad));
    await h.ctx.close();
  });

  await group('town: New here’s ticks stay on the phone', async () => {
    const { ctx, page } = await newPage(browser, base);
    await page.goto(base + '/town/#guides/newhere');
    await settle(page);
    await page.click('#panel-guides [data-k="new-library"] button');
    check(JSON.stringify(await page.evaluate(() => JSON.parse(localStorage.getItem('town-newhere')))) === '["library"]', 'a tick is kept on this device', '');
    await page.reload();
    await settle(page);
    check(await page.$eval('#panel-guides [data-k="new-library"]', (r) => r.classList.contains('done')), 'and is still ticked next time', '');
    const pages = await page.$$eval('#panel-guides [data-sec="all"] .lrow a.t', (as) => as.map((a) => new URL(a.href).pathname));
    check(['/housing.html', '/volunteer.html', '/beaches.html', '/hobbies.html', '/history.html', '/gifts.html'].every((x) => pages.includes(x)), 'All guides opens each guide page', JSON.stringify(pages));
    await ctx.close();
  });

  for (const combo of COMBOS) {
    await group('town: screenshots ' + combo.viewport.width + ' ' + combo.scheme, async () => {
      const { ctx, page, errors } = await newPage(browser, base, combo);
      await page.goto(base + '/town/?demo=1');
      await settle(page);
      await page.evaluate(() => document.fonts.ready);
      for (const t of TABS) {
        if (t !== TABS[0]) await goTab(page, t);
        await page.evaluate(() => document.querySelector('.panel:not([hidden])').scrollTo(0, 0));
        await page.waitForTimeout(300);
        await pageRules(page, 'town/' + t, combo.viewport.width);
        await page.screenshot({ path: path.join(SHOTS, 'town-' + t + '-' + combo.viewport.width + '-' + combo.scheme + '.png') });
      }
      check(!errors.length, 'no console errors', errors.join(' | '));
      await ctx.close();
    });
  }
}
