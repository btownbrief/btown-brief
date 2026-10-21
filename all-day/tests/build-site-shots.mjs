// The Build's job site: screenshots of every state, and the frame-time check.
//
//   NODE_PATH=~/btownbrief/btownbrief.github.io/smoke/node_modules node all-day/tests/build-site-shots.mjs [outDir]
//   (pictures go to outDir, default the system temp folder; nothing in the repo is rewritten)
//   ONLY=perf …same…        just the frame-time check
//   ONLY=shots …same…       just the pictures
//
// Serves the repo locally, opens tests/build-site-preview.html, sets each
// state through window.preview, lets the simulation run, and saves a PNG of
// the canvas per state and frame size. Then it measures frame time with the
// CPU throttled 4x (DevTools' "older phone" setting) on the busiest scenes,
// checks that a hidden page draws nothing, and that reduced motion still
// changes between still frames. Exits 1 if a check fails.

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'build-site-shots'));
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
let failed = 0;
const say = (ok, msg) => { if (!ok) failed++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); };

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const URL_ = `http://127.0.0.1:${port}/all-day/tests/build-site-preview.html?shot=1`;

const SIZES = { docked: [390, 340], half: [390, 422], full: [390, 780], desk: [1440, 620] };
const DAY = { sunAltitude: 38, hour: 13, weather: 'clear' };
const STATES = {
  day: { ...DAY, floors_done: 2, floor_progress: 0.4, crew: 7, you: 'working', task: 'brick', windows_lit: 8 },
  morning: { sunAltitude: 9, hour: 7.5, weather: 'clear', floors_done: 3, floor_progress: 0.2, crew: 9, you: 'working', task: 'frame', windows_lit: 6, arrive: true },
  dusk: { sunAltitude: 2, hour: 18.5, weather: 'clear', floors_done: 3, floor_progress: 0.6, crew: 5, you: 'working', task: 'window', windows_lit: 14 },
  night: { sunAltitude: -18, hour: 23, weather: 'clear', floors_done: 4, floor_progress: 0.3, crew: 6, you: 'working', task: 'wire', windows_lit: 22 },
  whistle: { ...DAY, floors_done: 2, floor_progress: 0.5, crew: 5, you: 'working', task: 'frame', whistle: true, windows_lit: 8 },
  paused: { ...DAY, floors_done: 2, floor_progress: 0.5, crew: 5, you: 'paused', task: 'brick', windows_lit: 8 },
  off: { ...DAY, sunAltitude: 12, hour: 17, floors_done: 2, floor_progress: 0.5, crew: 4, you: 'off', task: 'haul', windows_lit: 8 },
  snow: { sunAltitude: 18, hour: 12, weather: 'snow', floors_done: 1, floor_progress: 0.7, crew: 5, you: 'working', task: 'frame', windows_lit: 4 },
  topped: { sunAltitude: 25, hour: 16, weather: 'clear', floors_done: 6, floor_progress: 0, topped_out: true, crew: 10, you: 'working', task: 'roof', windows_lit: 40 },
  toppednight: { sunAltitude: -15, hour: 21, weather: 'clear', floors_done: 6, floor_progress: 0, topped_out: true, crew: 4, you: 'working', task: 'lunch', windows_lit: 40 },
  empty: { ...DAY, floors_done: 0, floor_progress: 0, crew: 0, you: 'away', task: 'haul', windows_lit: 0 },
  cutaway: { ...DAY, floors_done: 3, floor_progress: 0.4, crew: 4, you: 'working', task: 'wire', cut: true, your_minutes: 600, windows_lit: 8 },
};
const SETTLE = { off: 14, paused: 6, whistle: 3, morning: 4 };

const browser = await chromium.launch();
try {
  if (want('shots')) {
    await mkdir(OUT, { recursive: true });
    const only = (process.env.STATES || '').split(',').filter(Boolean);
    const sizes = (process.env.SIZES || 'docked,full,desk').split(',');
    for (const [name, st] of Object.entries(STATES)) {
      if (only.length && !only.includes(name)) continue;
      for (const sz of sizes) {
        const [w, h] = SIZES[sz];
        const page = await browser.newPage({ viewport: { width: Math.max(w, 400), height: Math.max(h, 400) }, deviceScaleFactor: sz === 'desk' ? 1 : 2 });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* fine */ } });
        await page.goto(URL_);
        await page.waitForFunction(() => window.preview && window.site);
        const base = { whistle: false, cut: false, topped_out: false, your_minutes: 0, rm: false };
        if (st.arrive) {
          await page.evaluate(([b, s, w2, h2]) => { window.preview.set({ ...b, ...s, crew: 0, w: w2, h: h2 }); window.site.advance(1); window.preview.set({ crew: s.crew }); }, [base, st, w, h]);
          await page.evaluate(() => window.site.advance(5));
        } else {
          /* the crew works a while first so the marks show */
          await page.evaluate(([b, s, w2, h2]) => { window.preview.set({ ...b, ...s, whistle: false, you: s.you === 'working' ? 'working' : 'working', w: w2, h: h2 }); window.site.advance(90); }, [base, st, w, h]);
          if (st.you !== 'working' || st.whistle) await page.evaluate(([s]) => { window.preview.set({ you: s.you, whistle: !!s.whistle }); }, [st]);
          await page.evaluate((t) => window.site.advance(t), SETTLE[name] || 1);
        }
        await page.waitForTimeout(250);
        const file = path.join(OUT, `site-${name}-${sz}.png`);
        await page.locator('#site').screenshot({ path: file });
        say(!errors.length, `${name} ${sz} ${errors.length ? errors.join(' | ') : ''}`);
        await page.close();
      }
    }
  }

  if (want('perf')) {
    console.log('\nframe time, CPU throttled 4x (render work per frame, inside the 30fps cap)');
    for (const [label, sz, st] of [
      ['full 390x780 night snow, 24 on shift', SIZES.full, { sunAltitude: -15, hour: 22, weather: 'snow', floors_done: 3, floor_progress: 0.5, crew: 24, you: 'working', task: 'brick', windows_lit: 20 }],
      ['docked 390x340 day, 12 on shift', SIZES.docked, { ...DAY, floors_done: 2, floor_progress: 0.4, crew: 12, you: 'working', task: 'frame', windows_lit: 8 }],
      ['desktop 1440x620 rain, 30 on shift', SIZES.desk, { sunAltitude: 20, hour: 15, weather: 'rain', floors_done: 4, floor_progress: 0.2, crew: 30, you: 'working', task: 'wire', windows_lit: 30 }],
    ]) {
      const page = await browser.newPage({ viewport: { width: Math.max(sz[0], 400), height: Math.max(sz[1], 400) }, deviceScaleFactor: 3 });
      const cdp = await page.context().newCDPSession(page);
      await page.goto(URL_);
      await page.waitForFunction(() => window.preview && window.site);
      await page.evaluate(([s, w, h]) => { window.preview.set({ ...s, w, h }); window.site.advance(20); }, [st, sz[0], sz[1]]);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.site.resetStats());
      /* real frames, measured by rAF: interval between frames the page actually got */
      const intervals = await page.evaluate(() => new Promise((res) => {
        const xs = []; let last = 0; const t0 = performance.now();
        const f = (ts) => { if (last) xs.push(ts - last); last = ts; if (performance.now() - t0 < 6000) requestAnimationFrame(f); else res(xs); };
        requestAnimationFrame(f);
      }));
      const s = await page.evaluate(() => window.site.stats());
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const fps = s.frames / 6;
      console.log(`  ${label}: drawn ${fps.toFixed(1)} fps, simulation ${s.tickMs.toFixed(2)} ms + render avg ${s.avgMs.toFixed(2)} ms, p95 ${s.p95.toFixed(2)} ms, max ${s.maxMs.toFixed(1)} ms (view ${s.size.join('x')}, ${s.agents} figures)`);
      say(s.p95 < 16, `p95 render under 16 ms at 4x throttle (${s.p95.toFixed(2)})`);
      say(fps <= 31, `capped at 30fps (${fps.toFixed(1)})`);
      void intervals;
      await page.close();
    }

    /* hidden: zero frames */
    {
      const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
      await page.goto(URL_);
      await page.waitForFunction(() => window.preview && window.site);
      await page.waitForTimeout(500);
      const n = await page.evaluate(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        const a = window.site.stats().frames; await new Promise((r) => setTimeout(r, 1500)); return window.site.stats().frames - a;
      });
      say(n === 0, `hidden page draws nothing (${n} frames in 1.5 s)`);
      const back = await page.evaluate(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
        const a = window.site.stats().frames; await new Promise((r) => setTimeout(r, 1000)); return window.site.stats().frames - a;
      });
      say(back > 10, `visible again: animates (${back} frames in 1 s)`);
      /* off screen (scrolled away): zero frames too */
      const off = await page.evaluate(async () => {
        const c = document.getElementById('site'); c.style.marginTop = '3000px';
        await new Promise((r) => setTimeout(r, 300));
        const a = window.site.stats().frames; await new Promise((r) => setTimeout(r, 1200)); const n2 = window.site.stats().frames - a;
        c.style.marginTop = ''; return n2;
      });
      say(off === 0, `scrolled out of view draws nothing (${off} frames)`);
      /* resize keeps the scene */
      const kept = await page.evaluate(async () => {
        window.preview.set({ crew: 8, you: 'working' }); window.site.advance(30);
        const before = window.site.stats().agents;
        window.preview.size(390, 780); await new Promise((r) => setTimeout(r, 300));
        window.preview.size(1440, 620); await new Promise((r) => setTimeout(r, 300));
        window.preview.size(390, 340); await new Promise((r) => setTimeout(r, 300));
        return [before, window.site.stats().agents];
      });
      say(kept[0] === kept[1], `resize keeps every figure (${kept.join(' -> ')})`);
      await page.close();
    }

    /* reduced motion: still frames that still change */
    {
      const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
      await page.goto(URL_);
      await page.waitForFunction(() => window.preview && window.site);
      await page.evaluate(() => window.preview.set({ rm: true, crew: 6, you: 'working' }));
      const a = await page.evaluate(() => document.getElementById('site').toDataURL());
      const f0 = await page.evaluate(() => window.site.stats().frames);
      await page.waitForTimeout(6500);
      const b = await page.evaluate(() => document.getElementById('site').toDataURL());
      const f1 = await page.evaluate(() => window.site.stats().frames);
      say(f1 - f0 <= 3, `reduced motion draws stills, not animation (${f1 - f0} frames in 6.5 s)`);
      say(a !== b, 'reduced motion: the still changes as the crew works');
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall ok');
process.exit(failed ? 1 : 0);
