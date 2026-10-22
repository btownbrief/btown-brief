// Pictures of the home-screen widget and its setup page, for review.
//
//   NODE_PATH=~/btownbrief/btownbrief.github.io/smoke/node_modules node all-day/tests/widget-shots.mjs <out-dir>
//
// Writes, into <out-dir> (nothing in the repo changes):
//   wave9-widget-medium.png       the medium widget, drawn from the repo's own
//                                 all-day/data/widget.json
//   wave9-widget-sizes.png        small, medium and large side by side
//   wave9-widget-page-light.png   the setup page at 390, light
//   wave9-widget-page-dark.png    the same, dark
//   wave9-widget-settings.png     Settings, scrolled to the Home screen widget row
//
// The widget pictures run the real script (all-day/widget/btown-widget.js)
// under tests/scriptable-mock.mjs and draw the tree it builds with
// toHTML(), so they show the layout code's stacks, sizes and colours. They
// are an approximation of iOS's rendering, not a screenshot of a phone.

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import path from 'node:path';
import { runWidget, toHTML } from './scriptable-mock.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const OUT = path.resolve(process.argv[2] || path.join(HERE, 'shots'));
await mkdir(OUT, { recursive: true });

const SRC = await readFile(path.join(REPO, 'all-day/widget/btown-widget.js'), 'utf8');
const DATA = JSON.parse(await readFile(path.join(REPO, 'all-day/data/widget.json'), 'utf8'));
const draw = async (family) => (await runWidget(SRC, { family, respond: () => DATA })).widget;
const page = (body, bg) => '<!doctype html><meta charset="utf-8"><body style="margin:0;padding:28px;background:' + bg +
  ';display:flex;gap:28px;align-items:flex-start;justify-content:center">' + body + '</body>';

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
const base = 'http://127.0.0.1:' + port;
for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/all-day/')).ok) break; } catch (e) { /* not up */ } await new Promise((r) => setTimeout(r, 100)); }

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 460, height: 260 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.setContent(page(toHTML(await draw('medium'), 'medium'), '#E9E4DA'));
  await p.screenshot({ path: path.join(OUT, 'wave9-widget-medium.png'), fullPage: true });
  await p.setViewportSize({ width: 1060, height: 480 });
  await p.setContent(page(toHTML(await draw('small'), 'small', 'Small') + toHTML(await draw('medium'), 'medium', 'Medium') +
    toHTML(await draw('large'), 'large', 'Large'), '#E9E4DA'));
  await p.screenshot({ path: path.join(OUT, 'wave9-widget-sizes.png'), fullPage: true });
  await ctx.close();

  for (const scheme of ['light', 'dark']) {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const pg = await c.newPage();
    await pg.goto(base + '/all-day/widget/');
    await pg.waitForSelector('#preview:not([hidden])', { timeout: 6000 }).catch(() => {});
    await pg.waitForTimeout(400);
    await pg.screenshot({ path: path.join(OUT, 'wave9-widget-page-' + scheme + '.png'), fullPage: true });
    await c.close();
  }

  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const pg = await c.newPage();
  await pg.route(/gc\.zgo\.at|goatcounter\.com|facebook\.net/, (r) => r.fulfill({ status: 200, body: '', contentType: 'text/javascript' }));
  await pg.goto(base + '/all-day/?demo=1');
  await pg.waitForTimeout(1500);
  await pg.click('#settings-btn');
  await pg.waitForSelector('.sheet-body a[data-widget]');
  await pg.$eval('.sheet-body a[data-widget]', (a) => a.scrollIntoView({ block: 'center' }));
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: path.join(OUT, 'wave9-widget-settings.png') });
  await c.close();
} finally {
  await browser.close();
  server.kill();
}
console.log('Shots in ' + OUT);
