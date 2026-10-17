// clubs.html smoke: it renders, the week and browse views work, the filters
// and search narrow the list, reader-sent groups are drawn as text, and the
// "Add your group" form validates before it posts.
//
//   NODE_PATH=~/btownbrief/btownbrief.github.io/smoke/node_modules node tests/clubs-page.smoke.mjs
//   SHOTS=/some/dir …same…   (also saves screenshots there)
//
// Borrows the arcade smoke run's Playwright through NODE_PATH, as
// all-day/tests/allday.spec.mjs does (NODE_PATH only reaches CommonJS,
// hence createRequire). Serves the repo with `python3 -m http.server` on a
// free port and the real data files. Nothing leaves the machine: Supabase
// is answered here, and fonts, analytics and the arcade nav are stubbed.
// The clock is fixed to Saturday 2026-10-17, 9am in Burlington.

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SHOTS || '';
const NOW = new Date('2026-10-17T13:00:00Z');

let passed = 0;
const failed = [];
function check(cond, what, detail) {
  if (cond) passed++;
  else failed.push(what + (detail === undefined ? '' : ' :: ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300)));
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

const READER = [{
  id: '5a1f0c3e-0000-4000-8000-000000000001', name: '<img src=x onerror="window.__xss=1">Reader chess night',
  kind: 'games', when: 'Thursdays 7pm', where: '<b>Fletcher Free</b>', url: 'javascript:alert(1)', approved_at: '2026-10-16T12:00:00Z',
}];

async function newPage(browser, viewport, posts) {
  const ctx = await browser.newContext({ viewport, colorScheme: 'light' });
  await ctx.clock.install({ time: NOW });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // Playwright tries the newest route first: the catch-all goes in first
  await page.route(/supabase\.co/, (r) => r.fulfill({ status: 204, body: '' }));
  await page.route(/supabase\.co\/rest\/v1\/rpc\/groups_public/, (r) => r.fulfill({ json: READER }));
  await page.route(/supabase\.co\/rest\/v1\/rpc\/groups_submit/, (r) => { posts.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ json: { ok: true } }); });
  await page.route(/fonts\.(googleapis|gstatic)\.com|goatcounter|gc\.zgo\.at|facebook\.(net|com)|play\.btownbrief\.com/, (r) =>
    r.fulfill({ status: 200, contentType: /\.js/.test(r.request().url()) ? 'application/javascript' : 'text/css', body: '' }));
  return { ctx, page, errors };
}

// nothing pokes out past the right edge (the page has no overflow clip to hide it)
const overflowing = (page) => page.evaluate(() => [...document.querySelectorAll('.gx-card, .gx-row, .gx-row-body *, .gx-card *, .gx-run, .gx-add, .gx-day')]
  .filter((e) => e.offsetParent && !e.closest('.gx-kinds') && e.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
  .slice(0, 3).map((e) => e.className + ': ' + (e.textContent || '').slice(0, 40)));

const minutes = (t) => {
  const m = /^(\d+)(?::(\d+))?(am|pm)$/.exec(t.trim());
  if (!m) return 9999;
  return ((+m[1] % 12) + (m[3] === 'pm' ? 12 : 0)) * 60 + (+m[2] || 0);
};

async function main() {
  const groups = JSON.parse(await readFile(path.join(REPO, 'data/groups.json'), 'utf8')).groups;
  const runClubs = JSON.parse(await readFile(path.join(REPO, 'data/run-clubs.json'), 'utf8')).clubs;
  const port = await freePort();
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { await fetch(base + '/clubs.html'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  const browser = await chromium.launch();
  try {
    /* ---------------------------------------------------- phone, light */
    const posts = [];
    const { ctx, page, errors } = await newPage(browser, { width: 390, height: 844 }, posts);
    await page.goto(base + '/clubs.html');
    await page.waitForSelector('.gx-day');
    await page.waitForFunction(() => /groups/.test(document.getElementById('gx-stats').textContent));

    check((await page.locator('.gx-day').count()) === 7, 'the week has seven days');
    check((await page.locator('.gx-day').first().textContent()).includes('Today'), 'the week starts today');
    const runRows = await page.locator('#gx-run-list li a').count();
    check(runRows >= 1, 'run clubs lead the page with this week’s runs', runRows);
    check(await page.locator('.gx-run a[href="/all-day/#people/clubs"]').count() === 1, 'the run band links into All Day’s run week');
    check(await page.evaluate(() => document.querySelector('#gx-run').compareDocumentPosition(document.querySelector('#gx-tools')) === Node.DOCUMENT_POSITION_FOLLOWING),
      'run clubs come before everything else');

    // every day: rows in time order
    for (let d = 0; d < 7; d++) {
      await page.locator('.gx-day').nth(d).click();
      const times = await page.locator('.gx-row-time').allTextContents();
      const mins = times.map(minutes);
      check(mins.every((m, i) => i === 0 || mins[i - 1] <= m), `day ${d}: meets in time order`, times);
      const n = +(await page.locator('.gx-day').nth(d).locator('.gx-day-n').textContent());
      check(n === times.length, `day ${d}: the tile count matches the list`, [n, times.length]);
    }
    // a row opens to its card
    await page.locator('.gx-day').nth(3).click();
    if (await page.locator('.gx-row summary').count()) {
      await page.locator('.gx-row summary').first().click();
      check(await page.locator('.gx-row details[open] .gx-actions a').count() >= 1, 'a row opens to how to join');
    }
    const over = await overflowing(page);
    check(over.length === 0, 'nothing in an open row pokes past the edge at 390', over);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'no sideways scroll at 390 (week)',
      await page.evaluate(() => document.documentElement.scrollWidth));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'clubs-week-390.png'), fullPage: false });

    /* browse */
    await page.locator('.gx-seg[data-view="browse"]').click();
    await page.waitForSelector('.gx-card');
    const cards = await page.locator('.gx-card').count();
    check(cards === groups.length + runClubs.length + READER.length, 'browse shows every group, run club and approved reader group',
      [cards, groups.length, runClubs.length]);
    check(/view=browse/.test(page.url()), 'the view is in the URL', page.url());
    check((await page.locator('.gx-section').first().textContent()).startsWith('Run clubs'), 'Run clubs is the first section');
    const featured = page.locator('.gx-card-featured');
    check(await featured.count() === 1 && /Burlington Social Activities/i.test(await featured.textContent()), 'Stephen’s own group is featured');
    await page.locator('.gx-card .gx-more summary').first().click();
    const over2 = await overflowing(page);
    check(over2.length === 0, 'no card pokes past the edge at 390', over2);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'no sideways scroll at 390 (browse)',
      await page.evaluate(() => document.documentElement.scrollWidth));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'clubs-browse-390.png'), fullPage: false });

    /* the reader group is text, never markup */
    const reader = page.locator('.gx-card', { hasText: 'Reader chess night' });
    await page.waitForFunction(() => document.querySelectorAll('.gx-tag-reader').length > 0, null, { timeout: 5000 }).catch(() => {});
    check(await reader.count() === 1, 'the approved reader group shows');
    check(await reader.count() === 1 && (await reader.locator('.gx-name').textContent()).startsWith('<img'), 'its name is drawn as text');
    check(await reader.locator('img, b').count() === 0, 'no markup from a reader reaches the page');
    check(await reader.locator('a[href^="javascript"]').count() === 0, 'a javascript: link is dropped');
    check(await page.evaluate(() => window.__xss === undefined), 'nothing a reader sent ran');

    /* kinds */
    const pickup = page.locator('.gx-kind-chip[data-kind="pickup"]');
    const pickupCount = +(await pickup.locator('.gx-count').textContent());
    await pickup.click();
    const kinds = await page.locator('.gx-card').evaluateAll((els) => els.map((e) => e.dataset.k));
    check(kinds.length === pickupCount && kinds.every((k) => k === 'pickup'), 'the Pickup chip shows pickup only, as many as it says', [kinds.length, pickupCount]);
    check(/kind=pickup/.test(page.url()), 'the kind is in the URL');
    await page.locator('.gx-kind-chip[data-kind="all"]').click();

    /* free and beginner */
    await page.locator('label:has(#gx-free)').click();
    const free = await page.locator('.gx-card').evaluateAll((els) => els.map((e) => !!e.querySelector('.gx-tag-free')));
    check(free.length > 0 && free.every(Boolean), 'Free shows only free groups', free.length);
    await page.locator('label:has(#gx-free)').click();
    await page.locator('label:has(#gx-beginner)').click();
    const beg = await page.locator('.gx-card').evaluateAll((els) => els.map((e) => !!e.querySelector('.gx-tag-new')));
    check(beg.length > 0 && beg.every(Boolean), 'Beginner friendly shows only beginner-friendly groups', beg.length);
    await page.locator('label:has(#gx-beginner)').click();

    /* search */
    await page.fill('#gx-q', 'chess');
    await page.waitForTimeout(250);
    const hits = await page.locator('.gx-card').allTextContents();
    check(hits.length > 0 && hits.every((t) => /chess/i.test(t)), 'search narrows to matching groups', hits.length);
    await page.fill('#gx-q', 'zzzz-nothing');
    await page.waitForTimeout(250);
    check(/Nothing matches/.test(await page.locator('#gx-list').textContent()), 'an empty search says so');
    await page.fill('#gx-q', '');
    await page.waitForTimeout(250);

    /* the form */
    await page.locator('#gx-form button[type="submit"]').click();
    const errs = await page.locator('.gx-err').evaluateAll((els) => els.filter((e) => e.textContent).map((e) => e.dataset.for));
    check(['name', 'kind', 'when', 'where', 'email'].every((k) => errs.includes(k)), 'an empty form names every required box', errs);
    check(posts.length === 0, 'nothing is sent while the form has problems');
    await page.fill('#gx-f-name', 'Sunday pickup soccer');
    await page.selectOption('#gx-f-kind', 'pickup');
    await page.fill('#gx-f-when', 'Sundays 10am');
    await page.fill('#gx-f-where', 'Starr Farm Park');
    await page.fill('#gx-f-url', 'javascript:alert(1)');
    await page.fill('#gx-f-email', 'not-an-email');
    await page.locator('#gx-form button[type="submit"]').click();
    const errs2 = await page.locator('.gx-err').evaluateAll((els) => els.filter((e) => e.textContent).map((e) => e.dataset.for));
    check(errs2.join() === 'url,email', 'a bad link and a bad email are caught', errs2);
    await page.fill('#gx-f-url', 'www.example.org/soccer');
    await page.fill('#gx-f-email', 'organizer@example.org');
    await page.fill('#gx-f-note', 'Bring a light and a dark shirt.');
    await page.locator('#gx-form button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('gx-form-msg').classList.contains('gx-good'));
    check(posts.length === 1, 'a good form posts once', posts.length);
    const p = posts[0] || {};
    check(p.p_name === 'Sunday pickup soccer' && p.p_kind === 'pickup' && p.p_when === 'Sundays 10am' && p.p_where === 'Starr Farm Park' &&
      p.p_url === 'https://www.example.org/soccer' && p.p_email === 'organizer@example.org' && /^[A-Za-z0-9_-]{8,64}$/.test(p.p_device || ''),
      'it sends the fields, the link given https://, and a device id', p);
    check(await page.inputValue('#gx-f-name') === '', 'the form clears after sending');
    // the hidden box only a bot fills
    await page.fill('#gx-f-name', 'Spam spam');
    await page.selectOption('#gx-f-kind', 'other');
    await page.fill('#gx-f-when', 'Always');
    await page.fill('#gx-f-where', 'Online');
    await page.fill('#gx-f-email', 'bot@example.org');
    await page.evaluate(() => { document.getElementById('gx-f-company').value = 'ACME'; });
    await page.locator('#gx-form button[type="submit"]').click();
    await page.waitForTimeout(200);
    check(posts.length === 1, 'a filled honeypot is thanked and never sent', posts.length);
    if (SHOTS) {
      await page.locator('#add').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOTS, 'clubs-form-390.png') });
    }
    check(errors.length === 0, 'no console errors (phone)', errors);
    await ctx.close();

    /* -------------------------------------------- desktop, dark, deep link */
    const posts2 = [];
    const d = await newPage(browser, { width: 1280, height: 800 }, posts2);
    await d.page.emulateMedia({ colorScheme: 'dark' });
    await d.page.goto(base + '/clubs.html?view=browse&kind=games&q=chess');
    await d.page.waitForSelector('.gx-card');
    await d.page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    check(await d.page.inputValue('#gx-q') === 'chess', 'a linked search fills the box');
    const dk = await d.page.locator('.gx-card').evaluateAll((els) => els.map((e) => e.dataset.k));
    check(dk.length > 0 && dk.every((k) => k === 'games'), 'a linked kind and search land filtered', dk);
    const target = groups.find((g) => g.kind === 'trivia') || groups[0];
    await d.page.goto(base + '/clubs.html#g-' + target.id);
    await d.page.waitForSelector('#g-' + target.id + '.gx-flash');
    check(true, 'a #g- link opens browse and flashes that card');
    await d.page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await d.page.waitForTimeout(900);   // body eases its background over --duration-base
    const bg = await d.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(bg !== 'rgb(251, 248, 242)', 'dark mode repaints the page', bg);
    if (SHOTS) await d.page.screenshot({ path: path.join(SHOTS, 'clubs-desktop-dark.png') });
    check(d.errors.length === 0, 'no console errors (desktop)', d.errors);
    await d.ctx.close();
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`clubs-page smoke: ${passed} passed, ${failed.length} failed`);
  failed.forEach((f) => console.log('  FAIL ' + f));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
