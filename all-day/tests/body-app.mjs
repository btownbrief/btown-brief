// Body's tabs (wave 1 of the eight apps, 2026-10-29): Today (Habits beside
// Stephen's template), Train, Recover, Fuel, Coach and Together. Run from
// allday.spec.mjs as the group theBody (ONLY=theBody while iterating); the
// shell's helpers come in as `h` so this file adds no second harness.
//
// Screenshots: body-<tab>-<390|1280>-<light|dark>.png in tests/shots/, demo.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TABS = ['template', 'train', 'recover', 'fuel', 'coach', 'together'];
const LABELS = ['Today', 'Train', 'Recover', 'Fuel', 'Coach', 'Together'];
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
  const T = await json('together.json');
  const MD = await readFile(path.join(REPO, 'data/body/how-i-do-it.md'), 'utf8');
  const panel = (k) => '#panel-' + k;
  const sec = (k, s) => panel(k) + ' [data-sec="' + s + '"]';
  const ready = (page, k) => page.waitForSelector(panel(k) + ' [data-body="' + k + '"]', { timeout: 10000 });
  const text = (page, sel) => page.$eval(sel, (n) => n.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
  const toast = async (page) => { await page.waitForSelector('#toast:not([hidden])', { timeout: 6000 }).catch(() => {}); return page.$eval('#toast', (t) => t.textContent).catch(() => ''); };

  await group('Body: the config hosts Habits in Today, beside the template, and every tab is built', async () => {
    const { default: cfg } = await import('../js/apps/body.js');
    check(JSON.stringify(cfg.tabs.map((t) => t.mode)) === JSON.stringify(TABS), 'six tabs, each a built mode', cfg.tabs.map((t) => t.mode).join(', '));
    check(JSON.stringify(cfg.tabs.map((t) => t.label)) === JSON.stringify(LABELS), 'the map’s words', '');
    check(JSON.stringify(cfg.hosted) === JSON.stringify({ habits: 'template' }), 'Habits lives in Today’s cell', JSON.stringify(cfg.hosted));
    check(tpl.habits.length === 16, 'the template has sixteen habits', tpl.habits.length);
  });

  await group('Body, Today: Habits first, the Template beside it with each why, one tap copies all sixteen (demo, 390)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/body/?demo=1');
    await page.waitForSelector(panel('habits') + ' .hb-addbtn', { timeout: 10000 });
    check(await page.$eval(panel('habits'), (p) => !p.hidden), 'the bare app opens on the habits tracker', '');
    check(await page.$eval('#tab-template', (b) => b.getAttribute('aria-selected')) === 'true' && (await text(page, '#mast-title')) === 'Today', 'the Today cell is lit and the mast says Today', '');
    check(!!(await page.$('#subnav [data-side="habits"]')) && !!(await page.$('#subnav [data-side="template"]')) && !!(await page.$('#subnav .chip[data-chip="forests"]')),
      'the switch, Habits | Template, sits over Habits’ own chips', await text(page, '#subnav'));
    await page.click('#subnav [data-side="template"]');
    await page.waitForSelector(panel('template') + ' [data-template="stephen"]', { timeout: 6000 });
    check(await page.evaluate(() => location.hash) === '#template/stephen', 'Template has its own link', await page.evaluate(() => location.hash));
    const rows = await page.$$eval(panel('template') + ' .lrow', (rs) => rs.map((r) => [r.querySelector('.t').textContent, r.querySelector('.s').textContent]));
    check(rows.length === 16 && rows.every((r, i) => r[0] === tpl.habits[i].text && r[1] === tpl.habits[i].why), 'all sixteen, each with its one-line why right under its name', JSON.stringify(rows.slice(0, 2)));
    const order = await page.$eval(panel('template'), (p) => [...p.querySelectorAll('.lrow, [data-copy-all]')].map((n) => (n.matches('[data-copy-all]') ? 'copy' : 'row')));
    check(order.indexOf('copy') === 16, 'the whys come first, the Copy all button after them', order.join(','));
    await page.screenshot({ path: path.join(SHOTS, 'body-template-390-light.png') });
    await page.click('[data-copy-all]');
    await page.waitForFunction(() => document.querySelectorAll('#panel-habits .hb-row').length === 16, null, { timeout: 30000 }).catch(() => {});
    const names = await page.$$eval(panel('habits') + ' .hb-row', (rs) => rs.map((r) => [r.querySelector('.hb-name').textContent, r.querySelector('.hb-meta').innerText.replace(/\s+/g, ' ')]));
    check(names.length === 16 && names.every((n, i) => n[0] === tpl.habits[i].text), 'one tap: all sixteen on the tracker, in order', JSON.stringify(names.map((n) => n[0])));
    const fq = (x) => (x.frequency === 'n_per_week' ? x.n + ' a week' : x.frequency === 'daily' ? 'Daily' : 'Weekdays');
    check(names.every((n, i) => n[1].includes(fq(tpl.habits[i]))), 'with their frequencies (Floss 3 a week, Sprints 1 a week)', JSON.stringify(names.slice(0, 3)));
    check(/Added 16 habits/.test(await toast(page)), 'the toast says so', '');
    check(!(await page.$(panel('habits') + ' .hb-form')), 'the Add form is closed again', '');
    /* again: nothing twice */
    await page.click('#subnav [data-side="template"]');
    await page.waitForSelector('[data-copy-all]:not([disabled])');
    await page.click('[data-copy-all]');
    await page.waitForFunction(() => /already/.test(document.querySelector('#toast').textContent), null, { timeout: 15000 }).catch(() => {});
    check(/Nothing new to add\. 16 were already on your list/.test(await page.$eval('#toast', (t) => t.textContent)) && (await page.$$(panel('habits') + ' .hb-row')).length === 16,
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
    await page.click(panel('template') + ' .lrow[data-k="t-6"] .pillbtn');
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
    await page.goto(base + '/body/?demo=1');
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
    check(g.every((x) => (x.v === '1' ? /Verified [A-Z][a-z]{2} \d+/.test(x.s) : /Unverified/.test(x.s))), 'each says Verified with the date, or Unverified', '');
    const edge = G.gyms.find((x) => /\$\d/.test(x.day_pass || '') && x.verified);
    const er = g.find((x) => x.id === edge.id);
    check(er && er.s.includes(edge.address) && er.s.includes((edge.day_pass.match(/\$\d+/) || [''])[0]), 'a row has its address and day pass', er && er.s);
    check(g.findIndex((x) => x.v === '0') > g.findLastIndex((x) => x.v === '1'), 'verified places first', '');
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
    await page.click(sec('train', 'log') + ' .addrow .btn');
    await page.fill('.sheet-card input[name="machine"]', first.machine);
    await page.dispatchEvent('.sheet-card input[name="machine"]', 'input');
    check(/Last time, .*90 lb/.test(await text(page, '.sheet-card .bf-hint')), 'typing the machine shows last time’s line', await text(page, '.sheet-card .bf-hint'));
    await page.click('.sheet-card .iconbtn');
    await page.click(sec('train', 'log') + ' .lrow .act.del');
    check((await page.$$(sec('train', 'log') + ' .lrow')).length === 0 && /Deleted/.test(await toast(page)), 'a line can be deleted, with Undo', '');
    const book = await text(page, sec('train', 'book'));
    check(!/\$/.test(book) && /Not offered yet/.test(book) && (await page.$eval(sec('train', 'book') + ' [data-book]', (b) => b.dataset.book)) === 'unpriced', 'Book Stephen shows no price until one is set', book);
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
    check((await page.$$(sec('recover', 'sleep') + ' .hb-gate a[href^="http"]')).length >= 1, 'with its sources', '');
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
    check((await page.$$(sec('fuel', 'supplements') + ' .hb-gate a[href^="http"]')).length >= F.supplements.items.length, 'each with its sources', '');
    check((await page.$$(sec('fuel', 'less') + ' [data-less]')).length === 0 && !!(await page.$(sec('fuel', 'less') + ' form.fu-less')), 'Less of: nothing preset, the form to set one', '');
    await page.fill(sec('fuel', 'less') + ' input[name="name"]', 'Late-night snacks');
    await page.selectOption(sec('fuel', 'less') + ' select[name="limit"]', '1');
    await page.click(sec('fuel', 'less') + ' form button[type="submit"]');
    await page.click(sec('fuel', 'less') + ' [data-less] .pillbtn');
    await page.click(sec('fuel', 'less') + ' [data-less] .pillbtn');
    check(/2\/1/.test(await text(page, sec('fuel', 'less') + ' [data-less]')) && /Over your limit/.test(await text(page, sec('fuel', 'less') + ' [data-less]')), 'counting past the limit says so', await text(page, sec('fuel', 'less') + ' [data-less]'));
    check(!errors.length, 'no console errors', errors.slice(0, 3).join(' | '));
    await ctx.close();
  });

  await group('Body, Coach: How I do it from the page, Capture, and a Chat that only says what is coming (live, 390)', async () => {
    const { ctx, page, errors, supabase } = await newPage(browser, base);
    const asked = [];
    page.on('request', (r) => { if (!r.url().startsWith(base) && !/fonts\./.test(r.url())) asked.push(r.url()); });
    await page.goto(base + '/body/#coach');
    await ready(page, 'coach');
    const heads = (MD.match(/^## .+$/gm) || []).map((x) => x.slice(3).trim());
    const got = await page.$$eval(sec('coach', 'how') + ' .tdiv span:first-child', (n) => n.map((x) => x.textContent));
    check(JSON.stringify(got) === JSON.stringify(heads), 'every heading of how-i-do-it.md, in order', JSON.stringify(got));
    const how = await page.$eval(sec('coach', 'how'), (n) => n.innerHTML);
    check(!/\*\*|&lt;|##/.test(how) && /<b>Brush my teeth<\/b>/.test(how), 'the Markdown is drawn (bold, lists), none of it left showing', '');
    check(/Copy the list to Today/.test(await text(page, sec('coach', 'how'))), 'and it links to the template', '');
    check((await page.$$(sec('coach', 'capture') + ' .lrow')).length >= 5, 'Capture: the steps', '');
    const chat = await text(page, sec('coach', 'chat'));
    check(/The coach is coming/.test(chat) && /Nothing here talks to a model yet/.test(chat), 'Chat says the coach is coming and what it will do', chat.slice(0, 120));
    check(!asked.some((u) => /anthropic|openai|x\.ai/.test(u)), 'no model is asked', asked.join(' '));
    check(!errors.length, 'no console errors', errors.slice(0, 3).join(' | '));
    void supabase;
    await ctx.close();
  });

  await group('Body, Together: the clubs’ week, workouts and recovery to join in one tap, Adult Social Sports (demo, 390)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/body/?demo=1#together');
    await ready(page, 'together');
    check((await page.$$(sec('together', 'runs') + ' .days button')).length === 7 && (await page.$$(sec('together', 'fitness') + ' .days button')).length === 7, 'Run clubs and Fitness: this week’s seven days', '');
    const meets = await page.$$(sec('together', 'runs') + ' .lrow.meet');
    check(meets.length > 0, 'a day’s meets', meets.length);
    const work = await page.$$eval(sec('together', 'work') + ' [data-session]', (n) => n.map((x) => x.innerText));
    const rec = await page.$$eval(sec('together', 'recover') + ' [data-session]', (n) => n.map((x) => x.innerText));
    check(work.length >= 1 && work.every((t) => /Workout|Run|Ride|Climb/.test(t)) && !work.some((t) => /courts at 6/.test(t)), 'Work out: workouts and runs, not the pickup basketball', JSON.stringify(work.map((t) => t.slice(0, 40))));
    check(rec.length >= 1 && rec.every((t) => /Recovery|Yoga/.test(t)), 'Recover: the recovery sessions', '');
    const going = () => page.$eval(sec('together', 'work') + ' [data-session] .going', (g) => g.textContent);
    const g0 = await going();
    await page.click(sec('together', 'work') + ' [data-session] [data-act="bvote"]');
    await page.waitForFunction((g) => document.querySelector('[data-sec="work"] [data-session] .going').textContent !== g, g0, { timeout: 4000 }).catch(() => {});
    const g1 = await going();
    check(parseInt(g1, 10) === parseInt(g0, 10) + 1 && /I’m in/.test(await text(page, sec('together', 'work') + ' [data-act="bvote"]')), 'one tap on I’m in, one more going', g0 + ' → ' + g1);
    await page.click(sec('together', 'work') + ' .addrow .btn');
    await page.waitForSelector('.sheet-card', { timeout: 4000 });
    check(/Post a workout/.test(await text(page, '.sheet-card')), 'Post a workout opens the board’s compose sheet', await text(page, '.sheet-card h2'));
    await page.click('.sheet-card .iconbtn');
    check(await page.$eval(sec('together', 'ass') + ' a.btn', (a) => a.href) === T.adult_social_sports.url && /Relaunching/.test(await text(page, sec('together', 'ass'))),
      'Adult Social Sports: the group’s link, and that it is relaunching', '');
    await page.click(sec('together', 'runs') + ' .lrow.meet .open');
    await page.waitForURL(/\/people\/\?demo=1#people\//, { timeout: 8000 }).catch(() => {});
    check(/\/people\/\?demo=1#people\//.test(page.url()), 'a meet opens its club in People', page.url());
    check(!errors.length, 'no console errors', errors.slice(0, 3).join(' | '));
    await ctx.close();
  });

  await group('Body, live with no posts and no SQL: every tab still says something true (live, 1280)', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { viewport: { width: 1280, height: 800 } });
    await page.goto(base + '/body/#together');
    await ready(page, 'together');
    check(/Nobody has posted a workout yet/.test(await text(page, sec('together', 'work'))), 'Work out, empty: an invitation to post', '');
    check(!errors.length, 'no console errors', errors.slice(0, 3).join(' | '));
    await ctx.close();
  });

  /* every tab, both widths, both themes, demo: the page rules and a screenshot */
  for (const combo of COMBOS) {
    await group('Body, every tab at ' + combo.viewport.width + ', ' + combo.scheme + ' (demo)', async () => {
      const { ctx, page, errors } = await newPage(browser, base, combo);
      await page.goto(base + '/body/?demo=1');
      await page.waitForSelector(panel('habits') + ' .hb-addbtn', { timeout: 10000 });
      for (const k of TABS) {
        const shown = k === 'template' ? 'template' : k;
        await page.evaluate((h) => { location.hash = h; }, k === 'template' ? 'template/stephen' : k);
        await page.waitForSelector(panel(shown) + ':not([hidden]) ' + (k === 'template' ? '[data-template]' : '[data-body]'), { timeout: 10000 });
        await page.evaluate((id) => document.querySelector(id).scrollTo(0, 0), panel(shown));
        await sleep(350);
        await pageRules(page, 'body ' + k, combo.viewport.width);
        await page.screenshot({ path: path.join(SHOTS, 'body-' + k + '-' + combo.viewport.width + '-' + combo.scheme + '.png') });
      }
      check(!errors.length, 'no console errors', errors.slice(0, 3).join(' | '));
      await ctx.close();
    });
  }
}
