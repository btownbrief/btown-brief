// The Games tab's cabinet pictures: a real moment of play from each game.
//
//   NODE_PATH=~/btownbrief/btownbrief.github.io/smoke/node_modules node all-day/tests/game-shots.mjs
//   ONLY=pothole-patrol,queen-city-chess …same…   (just those)
//
// For every live game in data/games-catalog.json it opens the game from its
// own checkout next to this repo (~/btownbrief/<slug>/, served locally; a
// game with no plain checkout, one that is built first, is opened on
// play.btownbrief.com instead), starts it the way a player would (the bot
// game, or Start), plays a second or two, and keeps a 4:3 cut of the screen
// around the board or the play area: all-day/assets/games/<slug>.webp,
// 480x360, about 12 KB. Every request but a GET is refused, service workers
// and analytics are blocked, and a game sees only its own folder, so a run
// never posts a score, opens a room or counts a visit.
// Look at every picture before committing them; a game whose start screen
// changes may need its line in STEPS.

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const OUT = path.join(REPO, 'all-day/assets/games');
const GAMES = process.env.GAMES_DIR || path.join(os.homedir(), 'btownbrief');
const LIVE = 'https://play.btownbrief.com/';
const W = 480, H = 360;
const failed = [];

/* how each game starts: buttons tried in order, every round, until none is left */
const START = ['#botBtn', '[data-mode=bot]', '.bot-btn[data-mode]', '#easyBtn.wood-btn', '#startBtn', '#btn-play', '#passBtn', '[data-mode=pass]'];
const WORDS = /^\s*(take today|climb today|start|play|tap to (start|play)|let'?s (go|play)|begin|new game|deal|got it|ok|continue)/i;
/* what a game needs beyond that: clicks (selector or [x, y] as fractions of
   the screen), keys, a key to hold, text to type, and where to cut (focus: a selector, or a
   0..1 height on the screen) */
/* no picture: these need a live room or a sign-in to show anything, so they keep their emoji */
const SKIP = new Set(['btown-party', 'caption-this', 'up-for-it']);
const STEPS = {
  'btown-wordle': { keys: ['Escape'], click: ['.modal-close, .close, [aria-label="Close"]'], type: ['lake', 'snow'] },
  'maple-scramble': { keys: ['Escape'], click: ['button.close >> visible=true'], focus: 0.8 },
  'lake-breath': { keys: [], taps: false, focus: 0.45 },
  'street-yeet': { click: ['button:has-text("PLAY") >> visible=true'], wait: 1500 },
  'church-street-runner': { click: ['#startBtn'], wait: 1500 },
  'heads-up-btown': { click: ['text=I’m ready', 'text=I\'m ready'], wait: 1500 },
  'front-porch-dominoes': { click: ['text=2', 'text=Show my hand'], focus: 0.8 },
  'north-star-hop': { click: ['text=Polaris'] },
  'four-in-a-rowboat': { click: [[0.5, 0.5], [0.36, 0.5], [0.5, 0.5]], wait: 900 },
  'church-street-zombies': { keys: [], taps: false, click: ['#start'], wait: 1500, hold: 'w' },
};

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const exists = (p) => access(p).then(() => true, () => false);

async function shoot(browser, slug, url) {
  const S = STEPS[slug] || {};
  /* no service worker (its requests could slip past the routes below) */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const local = new URL(url).origin;
  await ctx.route('**/*', (r) => {
    const req = r.request(), u = new URL(req.url());
    /* reads only, anywhere: a GET never posts a score or opens a room, and a game
       that lists this week's photos from Supabase can still show them */
    if (req.method() !== 'GET') return r.abort();
    if (/gc\.zgo\.at|goatcounter|\/ticker\.js|connect\.facebook|googletagmanager/.test(req.url())) return r.abort();
    /* the local server holds every checkout; a game sees only its own */
    if (u.origin === local && !u.pathname.startsWith('/' + slug + '/')) return r.abort();
    return r.continue();
  });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(1200);
    for (let round = 0; round < 3; round++) {
      const hit = await page.evaluate(([sels, words]) => {
        const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !e.disabled; };
        let b = null;
        for (const sel of sels) { b = [...document.querySelectorAll(sel)].find(vis); if (b) break; }
        const re = new RegExp(words, 'i');
        b = b || [...document.querySelectorAll('button, [role=button]')].filter(vis).find((x) => re.test((x.innerText || '').trim()));
        if (!b) return '';
        b.click();
        return (b.innerText || b.id || '?').trim().slice(0, 24);
      }, [START, WORDS.source]);
      if (!hit) break;
      await page.waitForTimeout(700);
    }
    for (const k of S.keys || []) await page.keyboard.press(k);
    for (const c of S.click || []) {
      if (Array.isArray(c)) await page.mouse.click(390 * c[0], 700 * c[1]);
      else await page.locator(c).first().click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(S.wait || 500);
    }
    if (S.hold) { await page.keyboard.down(S.hold); await page.waitForTimeout(1200); await page.keyboard.up(S.hold); }
    for (const t of S.type || []) { await page.keyboard.type(t, { delay: 70 }); await page.keyboard.press('Enter'); await page.waitForTimeout(1600); }
    /* a second or two of play: taps on the canvas, a few keys */
    const cv = await page.evaluate(() => {
      const r = [...document.querySelectorAll('canvas')].map((x) => x.getBoundingClientRect()).filter((b) => b.width > 100 && b.height > 100).sort((a, b) => b.width * b.height - a.width * a.height)[0];
      return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
    });
    for (let i = 0; i < 6; i++) {
      if (cv && S.taps !== false) await page.mouse.click(cv.x + cv.w * (0.3 + 0.4 * Math.random()), cv.y + cv.h * (0.35 + 0.4 * Math.random()));
      if (!S.keys) await page.keyboard.press(['Space', 'ArrowRight', 'ArrowLeft', 'ArrowUp'][i % 4]);
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(400);
    if (process.env.FULL) await page.screenshot({ path: path.join(process.env.FULL, slug + '.png') });
    /* the cut: centred on the play area (the biggest canvas, board or hand on the screen) */
    const focus = typeof S.focus === 'number' ? S.focus * 700 : await page.evaluate((sel) => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 120 && r.height > 80 && r.bottom > 0 && r.top < innerHeight && r.width * r.height < innerWidth * innerHeight * 0.9; };
      const list = [...document.querySelectorAll(sel || 'canvas, svg, [class*=board], [id*=board], [class*=grid], [id*=grid], [class*=hand], [class*=table], [class*=card], [class*=question]')].filter(vis);
      const b = list.map((e) => e.getBoundingClientRect()).sort((a, c) => c.width * c.height - a.width * a.height)[0];
      return b ? (Math.max(0, b.top) + Math.min(innerHeight, b.bottom)) / 2 : innerHeight / 2;
    }, typeof S.focus === 'string' ? S.focus : null);
    const h = 390 * H / W;
    const y = Math.max(0, Math.min(700 - h, focus - h / 2));
    const png = await page.screenshot({ clip: { x: 0, y, width: 390, height: h } });
    /* the browser's own encoder makes the webp: no image tool to install */
    const webp = await page.evaluate(async ([b64, w, hh]) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = w; c.height = hh;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, w, hh);
      return c.toDataURL('image/webp', 0.72).split(',')[1];
    }, [png.toString('base64'), W, H]);
    await writeFile(path.join(OUT, slug + '.webp'), Buffer.from(webp, 'base64'));
    console.log('  ok   ' + slug + (url.startsWith(LIVE) ? ' (from the arcade)' : ''));
  } catch (e) {
    failed.push(slug);
    console.log('  FAIL ' + slug + ' (its old picture, if any, is unchanged): ' + String(e && e.message || e).split('\n')[0]);
  }
  await ctx.close();
}

const cat = JSON.parse(await readFile(path.join(REPO, 'data/games-catalog.json'), 'utf8'));
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const slugs = cat.games.filter((g) => g.live === true && /^[a-z0-9-]{1,40}$/.test(g.slug) && !SKIP.has(g.slug) && (!ONLY.length || ONLY.includes(g.slug))).map((g) => g.slug);
await mkdir(OUT, { recursive: true });
const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: GAMES, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch();
try {
  for (const slug of slugs) {
    /* a checkout with a build step (Vite) is only playable once built: use the arcade's copy */
    const local = await exists(path.join(GAMES, slug, 'index.html')) && !(await exists(path.join(GAMES, slug, 'vite.config.js')));
    await shoot(browser, slug, local ? 'http://127.0.0.1:' + port + '/' + slug + '/' : LIVE + slug + '/');
  }
} finally {
  await browser.close();
  server.kill();
}
if (failed.length) { console.log(failed.length + ' failed: ' + failed.join(', ')); process.exitCode = 1; }
