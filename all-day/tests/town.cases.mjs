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
//   - the forms that write nowhere say so, and send nothing
//   - New here's ticks stay on the phone, and not in the demo
//   - screenshots of every tab at 390 and 1280, light and dark

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TABS = ['alerts', 'cityhall', 'streets', 'guides', 'work'];
const COMBOS = [
  { viewport: { width: 390, height: 844 }, scheme: 'light' }, { viewport: { width: 390, height: 844 }, scheme: 'dark' },
  { viewport: { width: 1280, height: 800 }, scheme: 'light' }, { viewport: { width: 1280, height: 800 }, scheme: 'dark' },
];
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

export async function townCases(h) {
  const { browser, base, group, check, newPage, settle, goTab, pageRules, SHOTS, REPO } = h;
  const { default: cfg } = await import(path.join(REPO, 'all-day/js/apps/town.js'));
  const json = async (f) => JSON.parse(await readFile(path.join(REPO, f), 'utf8'));
  const sections = (page) => page.evaluate(() => {
    const p = document.querySelector('.panel:not([hidden])');
    return { secs: [...p.querySelectorAll('.shelf-sec')].map((s) => s.querySelector('.sec h2').textContent), text: p.innerText,
      pill: [...document.querySelectorAll('#subnav .secpill .chip')].map((c) => c.textContent.trim()) };
  });

  for (const demo of [false, true]) {
    await group('town: every tab ' + (demo ? 'in the demo' : 'live'), async () => {
      const { ctx, page, errors } = await newPage(browser, base);
      await page.goto(base + '/town/' + (demo ? '?demo=1' : ''));
      await settle(page);
      for (const t of cfg.tabs) {
        if (t.mode !== TABS[0]) await goTab(page, t.mode);
        await page.waitForTimeout(demo ? 200 : 400);
        const s = await sections(page);
        check(JSON.stringify(s.secs) === JSON.stringify(t.top), t.mode + ': one section per top tab, in order', JSON.stringify(s.secs));
        check(s.pill.length === t.top.length && t.top.every((x) => s.pill.includes(x)), t.mode + ': the pill names every top tab', JSON.stringify(s.pill));
        check(!/didn’t load just now|didn’t draw/.test(s.text), t.mode + ': every section drew', (s.text.match(/.{0,60}(didn’t load just now|didn’t draw).{0,20}/) || [''])[0]);
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
    check(/no city trash day/.test(txt) && /802-658-SNOW/.test(txt), 'trash is the hauler’s day, and the ban’s official word is named', '');
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
    if (!a.closings.items.length && !a.closings.district_posts.length) check(/No closings or delays/.test(sch) && /official word/.test(sch), 'Schools: none, said plainly, with the official word', sch.slice(0, 120));
    const plows = await page.$eval('#panel-alerts [data-sec="plows"]', (n) => n.innerText);
    check(/no street plow tracker/i.test(plows), 'Plows: the plain line that the city has no street tracker', '');
    const sh = await page.$eval('#panel-alerts [data-sec="shelters"]', (n) => n.innerText);
    check(/checked by hand/.test(sh) && /COTS Waystation/.test(sh), 'Shelters: the standing list and the by-hand line', '');
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
    check(await page.$$eval('#panel-streets [data-sec="sold"] .lrow[data-k^="wk-"]', (rs) => rs.length > 0 && rs.every((r) => /of \d+ sales? to an out-of-state address/.test(r.innerText))), 'only each week’s out-of-state share', '');
    const heads = await page.$$eval('#panel-streets [data-sec="blotter"] .lrow[data-k^="pr-"] .t', (as) => as.map((a) => a.textContent));
    check(heads.every((x) => /\|\s*\d{2}[A-Z]{2}\d{5,}$|^Police press release/.test(x)), 'blotter headlines are an offence and a case number', heads.join(' / '));
    await ctx.close();
  });

  await group('town: the demo’s states, the board, and the forms', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    const sent = [];
    page.on('request', (r) => { if (r.method() === 'POST' && !/supabase|goatcounter/.test(r.url())) sent.push(r.url()); });
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
    check(vt.length === 3 && vt.every((x) => /^#plans\/b-/.test(x)), 'Vote together: watch parties, each opening in People’s Plans', JSON.stringify(vt));
    check(!(await page.$('#panel-cityhall [data-sec="together"] [data-act="bvote"]')), 'read-only here: no vote or post buttons', '');
    await goTab(page, 'work');
    for (const k of ['listing-form', 'website-form']) {
      await page.click('#panel-work [data-k="' + k + '"] button');
      check(await page.$eval('#panel-work [data-k="' + k + '"] .bf-note', (n) => !n.hidden && /nothing was sent/.test(n.textContent)), k + ': says nothing was sent', '');
    }
    check(!!(await page.$('#panel-work [data-k="listing-form"] select[name="sponsor"]')), 'the listing asks the sponsor question', '');
    check(!sent.length, 'the forms post nowhere', sent.join(', '));
    const shops = await page.$eval('#panel-work [data-sec="shops"]', (n) => n.innerText);
    check(/4 of 5 vintage, thrift and book shops open right now/.test(shops), 'Shops: open now, from each shop’s own hours (the demo’s Saturday at 2 pm: one shop closed at noon)', shops.slice(0, 120));
    const groups = await page.$$eval('#panel-work [data-sec="jobs"] .tdiv > span:first-child', (n) => n.map((x) => x.textContent));
    check(JSON.stringify(groups.slice(0, 3)) === '["Today","This week","Earlier"]', 'Jobs: Today, This week, Earlier', JSON.stringify(groups));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
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
    const pages = await page.$$eval('#panel-guides [data-sec="all"] .lrow a.t', (as) => as.map((a) => a.getAttribute('href')));
    check(['../housing.html', '../contractors.html', '../volunteer.html', '../beaches.html', '../hobbies.html', '../history.html', '../gifts.html'].every((x) => pages.includes(x)), 'All guides opens each guide page', JSON.stringify(pages));
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
