// All Day — the shell's test matrix.
//
//   NODE_PATH=~/btownbrief/btownbrief.github.io/smoke/node_modules node all-day/tests/allday.spec.mjs
//
// No project here installs Playwright, so this borrows the arcade smoke
// run's copy (1.62, Chromium already cached in ~/Library/Caches/ms-playwright)
// through NODE_PATH. NODE_PATH only reaches CommonJS, hence createRequire.
// It serves the repo with `python3 -m http.server` on a free port, runs the
// matrix, saves a ?demo=1 screenshot per tab to all-day/tests/shots/, prints
// a report and exits 1 on any failure.
//
// The matrix (DESIGN.md section 9 rule 12):
//   - the rules that can be read from the source: tokens only in tokens.css,
//     no uppercase outside the caps roles, no monospace, nothing sticky
//   - every tab mounts with no console errors, live and ?demo=1
//   - 390x844 and 1280x800, light and dark, prefers-reduced-motion
//   - deep links land and flash; an unknown key says so
//   - the GoatCounter tab-landing events fire once per landing
//   - save, swipe, hold to peek, Settings and sign-in fail soft
//
// Network: nothing leaves the machine but Google Fonts. GoatCounter and the
// Meta pixel are stubbed, Supabase is answered locally, pulse-top.json comes
// from tests/fixtures, the Wire's wire-data files are built below in the
// real contract and dated to the real clock, pulse.json is the repo's own
// snapshot, and third-party pictures get a 1px PNG.

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('Playwright not found. Run with NODE_PATH=~/btownbrief/btownbrief.github.io/smoke/node_modules');
  process.exit(2);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const REPO = path.resolve(APP, '..');
const SHOTS = path.join(HERE, 'shots');
const TABS = ['wire', 'watch', 'food', 'people', 'whatnow', 'vintage', 'art', 'onair', 'games'];
const LABELS = ['Wire', 'Watch', 'Food', 'People', 'What Now', 'Vintage', 'Art', 'On Air', 'Games'];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/* ------------------------------------------------------------- reporting */
const results = [];
let current = '';
function check(ok, name, detail) {
  results.push({ ok: !!ok, name: (current ? current + ' › ' : '') + name, detail: ok ? '' : String(detail || '') });
  return !!ok;
}
async function group(name, fn) {
  const prev = current; current = name;
  try { await fn(); } catch (e) { check(false, 'threw', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e); }
  current = prev;
}

/* ---------------------------------------------------------------- server */
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
async function serve() {
  const port = await freePort();
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(base + '/all-day/'); if (r.ok) return { base, proc }; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('http.server did not start');
}

/* ------------------------------------------------------- static checks */
async function staticChecks() {
  await group('source rules', async () => {
    const css = await readFile(path.join(APP, 'css/app.css'), 'utf8');
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const colours = bare.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![-\w])(white|black)(?![-\w])/g) || [];
    check(!colours.length, 'app.css has no colour literals (tokens.css only)', colours.join(' '));
    const sizes = [...bare.matchAll(/font-size:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((v) => !/^var\(--fs-[a-z-]+\)$/.test(v));
    check(!sizes.length, 'every font-size is a --fs token', sizes.join(', '));
    const radii = [...bare.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim())
      .filter((v) => !v.split(/\s+/).every((p) => p === '0' || /^var\(--r-[a-z]+\)$/.test(p)));
    check(!radii.length, 'every border-radius is a --r token', radii.join(', '));
    const fams = [...bare.matchAll(/font-family:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((v) => !/^var\(--(serif|sans)\)$/.test(v));
    check(!fams.length, 'every font-family is --serif or --sans', fams.join(', '));
    const upper = bare.match(/text-transform:\s*uppercase/g) || [];
    check(upper.length === 1 && /\.eyebrow, \.newline, \.soon \{ text-transform: uppercase; \}/.test(bare), 'uppercase lives only in the one caps rule', upper.length + ' rules');
    check(!/sticky/.test(bare), 'nothing is position: sticky', '');

    const js = [];
    const walk = async (dir) => { for (const f of await readdir(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) await walk(p); else if (/\.(js|css|html)$/.test(f.name)) js.push(p); } };
    await walk(path.join(APP, 'js')); await walk(path.join(APP, 'css'));
    const NEW = ['app.js', 'ui.js', 'store.js', 'auth.js', 'liquid.js', 'main.js', 'wire.js', 'wire-demo.js', 'watch.js', 'food.js', 'people.js', 'whatnow.js', 'vintage.js', 'art.js', 'onair.js', 'games.js', 'tokens.css', 'app.css'];
    const OLD = new Set(['reddit.js', 'ig.js', 'photos.js', 'music.js', 'wander.js', 'listen.js', 'rows.js', 'sun.js', 'whatnow-engine.js', 'whatnow-data.js']);
    for (const f of js) {
      const name = path.basename(f);
      const isMode = f.includes(path.sep + 'modes' + path.sep);
      if (OLD.has(name) && (isMode || !['wire.js'].includes(name))) continue;
      if (!NEW.includes(name)) continue;
      const src = await readFile(f, 'utf8');
      check(!/monospace/i.test(src), path.relative(APP, f) + ': no monospace', '');
      if (isMode) {
        const lit = src.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{6}\b|rgba?\(|font-size|text-transform|position:\s*(fixed|sticky)/g) || [];
        check(!lit.length, path.relative(APP, f) + ': no colour, type size, caps or fixed position of its own', lit.join(' '));
      }
    }
  });
}

/* --------------------------------------------------------- the Wire's data */
/* wire-today.json, wire/index.json and two frozen editions in the contract
   curate_wire.py writes, dated to today in Burlington on the real clock so
   "the dateline is today" means something whenever this runs. Today's river
   is long on purpose (160 items, four updates), past the 120 the progressive
   renderer has to get beyond. */
const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function etParts(ms) { const o = {}; ET.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; }); return o; }
const etKey = (ms) => { const o = etParts(ms); return o.year + '-' + o.month + '-' + o.day; };
const dayMinus = (key, n) => { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d - n, 12)).toISOString().slice(0, 10); };
const ETNAME = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
const nameOf = (key) => { const [y, m, d] = key.split('-').map(Number); return ETNAME.format(new Date(Date.UTC(y, m - 1, d, 12))); };
const CHIPS = ['x', 'facebook', 'reddit', 'newsletters', 'video'];
function wireDay(date, n, opts) {
  const now = Date.now();
  const o = etParts(now);
  const sinceMidnight = (Number(o.hour) * 60 + Number(o.minute)) * 60000;
  const isToday = date === etKey(now);
  /* today: spread from just after midnight to a minute ago; earlier days: their own 6 am to 11 pm */
  const top = isToday ? now - 60000 : now - sinceMidnight - (Date.parse(etKey(now)) - Date.parse(date)) + 23 * 3600000;
  const bottom = isToday ? now - sinceMidnight + 60000 : top - 17 * 3600000;
  const tag = date.replace(/-/g, '');
  const items = [];
  for (let i = 0; i < n; i++) {
    let ch = i % 8 === 3 ? 'world' : i % 3 === 1 ? 'world' : 'local';
    if (i % 23 === 5) ch = 'reddit';
    if (i % 29 === 7) ch = 'newsletters';
    if (i % 37 === 11) ch = 'video';
    if (opts.inbox && i % 31 === 13) ch = 'x';
    if (opts.inbox && i % 41 === 17) ch = 'facebook';
    const local = ch !== 'world';
    const src = ch === 'x' ? 'x:@wcax' : ch === 'facebook' ? 'facebook:old-north-end' : ch === 'reddit' ? 'r-burlington' : ch === 'video' ? 'vermont-public-video'
      : ch === 'newsletters' ? 'love-burlington' : local ? ['seven-days', 'vtdigger', 'wcax', 'mynbc5'][i % 4] : ['ap', 'reuters', 'npr'][i % 3];
    const name = { 'x:@wcax': 'WCAX', 'facebook:old-north-end': 'Old North End', 'r-burlington': 'r/burlington', 'vermont-public-video': 'Vermont Public',
      'love-burlington': 'Love Burlington', 'seven-days': 'Seven Days', vtdigger: 'VTDigger', wcax: 'WCAX', mynbc5: 'NBC5', ap: 'AP', reuters: 'Reuters', npr: 'NPR' }[src];
    const it = { id: tag + '-' + String(i).padStart(3, '0'), ch, local, src, name, title: (local ? 'Burlington story ' : 'National story ') + i + ' of ' + nameOf(date),
      url: 'https://example.org/' + tag + '/' + i, posted_at: new Date(top - (top - bottom) * (i / n)).toISOString() };
    if (ch === 'x') it.handle = '@wcax';
    if (ch === 'reddit' || ch === 'facebook') it.comments = 12;
    if (ch === 'video') { it.url = 'https://www.youtube.com/watch?v=dQw4w9WgXc' + (i % 10); it.media = { type: 'video', url: it.url }; }
    if (i % 4 === 0) it.thumb = 'https://example.org/pic/' + tag + '-' + i + '.jpg';
    items.push(it);
  }
  if (opts.brief) items.splice(9, 0, { id: tag + '-brief', ch: 'newsletters', local: true, src: 'btown-brief', name: 'Btown Brief', own: true,
    title: nameOf(date) + ', the Brief', url: 'https://www.btownbrief.com/p/' + tag, posted_at: new Date(top - (top - bottom) * 0.06).toISOString() });
  const labels = [['evening', 'Evening'], ['afternoon', 'Afternoon'], ['midday', 'Midday'], ['morning', 'Morning']];
  const per = Math.ceil(items.length / 4);
  const updates = labels.map(([key, label], u) => {
    const list = items.slice(u * per, (u + 1) * per);
    return { key, label, time: (u ? 11 - u * 3 : 9) + ':05 pm', updated: list[0] ? list[0].posted_at : null,
      lead: list[0] ? { id: list[0].id, why: 'Why update ' + u + ' leads with this.' } : null, items: list };
  }).filter((u) => u.items.length);
  const ranked = items.filter((it) => !it.own && (it.ch === 'local' || it.ch === 'world'));
  const picks = ranked.filter((it) => it.local).slice(0, 15).concat(ranked.filter((it) => !it.local).slice(0, 10))
    .map((it, r) => ({ ...it, rank: r + 1, why: r === 2 ? '' : 'Reason ' + (r + 1) + ': why this one matters.' }));
  const counts = {};
  for (const scope of ['local', 'everything']) {
    const pool = items.filter((it) => scope === 'everything' || it.local);
    counts[scope] = { all: pool.length };
    CHIPS.forEach((c) => { counts[scope][c] = pool.filter((it) => it.ch === c).length; });
  }
  const sources = {};
  items.forEach((it) => { sources[it.src] = { name: it.name, ch: it.ch, site: 'https://example.org/site/' + it.src }; });
  const paused = { paused: !opts.inbox, reason: opts.inbox ? null : 'the inbox reader is not live yet', updated_at: null };
  const day = { v: 1, date, tz: 'America/New_York', final: !isToday, updated: updates[0].updated, checked: new Date(now).toISOString(), count: items.length,
    counts, picks, updates, sources, status: { x: paused, facebook: { ...paused }, reddit: { paused: false, last_post: null } } };
  if (opts.brief) day.brief = items.find((it) => it.own);
  return day;
}
const wireCache = new Map();
function wireFiles(opts = {}) {
  const o = { inbox: !!opts.inbox, brief: opts.brief !== false };
  const key = JSON.stringify(o) + etKey(Date.now());
  if (!wireCache.has(key)) {
    const today = etKey(Date.now());
    const y1 = dayMinus(today, 1), y2 = dayMinus(today, 2);
    const files = { 'wire-today.json': wireDay(today, 160, o), [y1 + '.json']: wireDay(y1, 40, { ...o, brief: true }), [y2 + '.json']: wireDay(y2, 40, { ...o, brief: false }) };
    files['index.json'] = { v: 1, editions: [y1, y2].map((d) => ({ date: d, count: files[d + '.json'].count, picks: files[d + '.json'].picks.length })) };
    wireCache.set(key, files);
  }
  return wireCache.get(key);
}

/* ------------------------------------------------------------- the page */
async function newPage(browser, base, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 390, height: 844 },
    colorScheme: opts.scheme || 'light',
    reducedMotion: opts.motion || 'no-preference',
    deviceScaleFactor: opts.dpr || 1,
    serviceWorkers: 'block',
    ...(opts.timezoneId ? { timezoneId: opts.timezoneId } : {}),
  });
  const page = await ctx.newPage();
  const errors = [];
  const supabase = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const top = await readFile(path.join(HERE, 'fixtures/pulse-top.json'));
  await page.route(/gc\.zgo\.at|goatcounter\.com|facebook\.net|facebook\.com/, (r) => r.fulfill({ status: 200, body: '', contentType: 'text/javascript' }));
  await page.route(/raw\.githubusercontent\.com\/.*pulse-top/, (r) => r.fulfill({ status: 200, body: top, contentType: 'application/json' }));
  /* What Now's sunset score asks Open-Meteo; here it gets nothing usable, so the engine runs ungated, as it does offline */
  await page.route(/open-meteo\.com/, (r) => r.fulfill({ status: 200, body: '{}', contentType: 'application/json' }));
  await page.route(/bandcamp\.com/, (r) => r.fulfill({ status: 200, body: '<!doctype html><title>Bandcamp</title>', contentType: 'text/html' }));
  if (opts.routes) for (const [re, body] of opts.routes) await page.route(re, (r) => r.fulfill({ status: 200, body: JSON.stringify(body), contentType: 'application/json' }));
  const wire = wireFiles(opts.wire);
  await page.route(/raw\.githubusercontent\.com\/btownbrief\/btown-brief\/wire-data\/data\/(?:wire\/)?([\w.-]+\.json)$/, (r) => {
    const f = wire[r.request().url().match(/([\w.-]+\.json)$/)[1]];
    return f ? r.fulfill({ status: 200, body: JSON.stringify(f), contentType: 'application/json' }) : r.fulfill({ status: 404, body: '' });
  });
  await page.route(/supabase\.co/, (r) => {
    const u = r.request().url();
    supabase.push(r.request().method() + ' ' + u.replace(/^https:\/\/[^/]+/, ''));
    if (/\/auth\/v1\/settings/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ external: { email: opts.authEmail !== false } }) });
    if (/\/rest\/v1\/rpc\//.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route((u) => !u.href.startsWith(base) && !/fonts\.(googleapis|gstatic)\.com/.test(u.href), (r) => {
    if (r.request().resourceType() === 'image') return r.fulfill({ status: 200, body: PNG, contentType: 'image/png' });
    return r.fallback();
  });
  /* GoatCounter's own script is stubbed; this records what the app asks it to count */
  await page.addInitScript(() => { window.__gc = []; window.goatcounter = { count: (o) => window.__gc.push(o.path) }; });
  return { ctx, page, errors, supabase };
}

const settle = (page) => page.waitForFunction(() => {
  const p = document.querySelector('.panel:not([hidden]) .panel-body');
  return p && p.children.length && !p.querySelector(':scope > .loading');
}, null, { timeout: 15000 });

async function goTab(page, tab) {
  await page.click('#tab-' + tab);
  await page.waitForFunction((t) => document.querySelector('#tab-' + t)?.getAttribute('aria-selected') === 'true', tab);
  await settle(page);
  await page.waitForTimeout(150);
}

/* the rules that can only be read off the drawn page */
async function pageRules(page, tab, width) {
  const r = await page.evaluate(() => {
    const panel = document.querySelector('.panel:not([hidden])');
    const bad = { fixed: [], upper: [], mono: [], esc: [] };
    panel.querySelectorAll('*').forEach((n) => {
      const cs = getComputedStyle(n);
      if (cs.position === 'fixed' || cs.position === 'sticky') bad.fixed.push(n.className);
      if (cs.textTransform === 'uppercase' && !n.closest('.eyebrow, .newline, .soon')) bad.upper.push(n.className || n.tagName);
      if (/monospace/i.test(cs.fontFamily)) bad.mono.push(n.className);
    });
    if (/&lt;|&amp;lt;|undefined|NaN|\[object Object\]/.test(panel.innerText)) bad.esc.push((panel.innerText.match(/.{0,30}(&lt;|undefined|NaN|\[object Object\]).{0,30}/) || [''])[0]);
    return { bad, docW: document.documentElement.scrollWidth, panelOver: panel.scrollWidth - panel.clientWidth, sub: document.querySelectorAll('#subnav > *').length,
      subRows: document.querySelector('#subnav') ? document.querySelector('#subnav').querySelectorAll(':scope > .dateline, :scope > .toolband, :scope > .chips').length : 0 };
  });
  check(!r.bad.fixed.length, tab + ': nothing fixed or sticky inside the tab', r.bad.fixed.slice(0, 3).join(', '));
  check(!r.bad.upper.length, tab + ': uppercase only in the caps roles', r.bad.upper.slice(0, 3).join(', '));
  check(!r.bad.mono.length, tab + ': no monospace', r.bad.mono.slice(0, 3).join(', '));
  check(!r.bad.esc.length, tab + ': no escaped markup, undefined or NaN on the page', r.bad.esc.join(''));
  check(r.docW <= width && r.panelOver <= 1, tab + ': no sideways scroll at ' + width, 'doc ' + r.docW + ', panel over by ' + r.panelOver);
  check(r.subRows <= 2, tab + ': at most two subnav rows', r.subRows);
}

/* --------------------------------------------------------------- the matrix */
const COMBOS = [
  { viewport: { width: 390, height: 844 }, scheme: 'light', motion: 'no-preference' },
  { viewport: { width: 390, height: 844 }, scheme: 'dark', motion: 'no-preference' },
  { viewport: { width: 390, height: 844 }, scheme: 'light', motion: 'reduce' },
  { viewport: { width: 1280, height: 800 }, scheme: 'light', motion: 'no-preference' },
  { viewport: { width: 1280, height: 800 }, scheme: 'dark', motion: 'reduce' },
];
const PAPER = { light: 'rgb(251, 249, 245)', dark: 'rgb(13, 14, 16)' };
/* tabs that are built: live, they draw their screen instead of the promise */
const LIVE = new Set(['wire', 'whatnow']);

async function matrix(browser, base) {
  for (const combo of COMBOS) {
    for (const demo of [false, true]) {
      const label = combo.viewport.width + ' ' + combo.scheme + (combo.motion === 'reduce' ? ' reduced-motion' : '') + (demo ? ' demo' : ' live');
      await group(label, async () => {
        const { ctx, page, errors, supabase } = await newPage(browser, base, combo);
        await page.goto(base + '/all-day/' + (demo ? '?demo=1' : ''), { waitUntil: 'domcontentloaded' });
        await settle(page);
        const bar = await page.$$eval('#tabbar button[data-tab]', (bs) => bs.map((b) => [b.dataset.tab, b.innerText.trim()]));
        check(JSON.stringify(bar.map((b) => b[0])) === JSON.stringify(TABS), 'nine tabs in order', JSON.stringify(bar));
        check(JSON.stringify(bar.map((b) => b[1])) === JSON.stringify(LABELS), 'the nine labels', JSON.stringify(bar.map((b) => b[1])));
        check(!(await page.$('script[src*="nav.js"], .btnav')), 'the network bar is gone', '');
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        check(bg === PAPER[combo.scheme], 'body is the ' + combo.scheme + ' paper', bg);
        if (combo.viewport.width >= 900) {
          const rail = await page.evaluate(() => { const r = document.querySelector('#tabbar').getBoundingClientRect(); return { w: r.width, h: r.height }; });
          check(rail.w === 208 && rail.h > 600, 'the tab bar is a 208px left rail', JSON.stringify(rail));
        } else {
          const cells = await page.$$eval('#tabbar button[data-tab]', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return [b.dataset.tab, Math.round(r.width), Math.round(r.height), b.scrollWidth <= b.clientWidth + 1]; }));
          check(cells.every((c) => c[2] >= 55), 'tab cells are 56px tall', JSON.stringify(cells));
          check(cells.every((c) => c[3]), 'no tab label overflows its cell', JSON.stringify(cells.filter((c) => !c[3])));
          const wn = cells.find((c) => c[0] === 'whatnow');
          check(wn[1] > cells[0][1], 'What Now gets the wider cell', JSON.stringify(cells));
        }
        if (combo.motion === 'reduce') {
          const still = await page.evaluate(() => ({ canvas: !!document.querySelector('.lsw-canvas'), sw: !!document.querySelector('.localsw'),
            tr: getComputedStyle(document.querySelector('.mast')).transitionDuration }));
          check(still.sw && !still.canvas, 'reduced motion: the switch is a plain fill, no water', JSON.stringify(still));
          check(/^0s/.test(still.tr), 'reduced motion: no transitions', still.tr);
        }
        for (const tab of TABS) {
          if (tab !== 'wire') await goTab(page, tab);
          const state = await page.evaluate(() => {
            const p = document.querySelector('.panel:not([hidden])');
            return { id: p.id, promise: !!p.querySelector('.promise'), h2: p.querySelector('.promise h2')?.textContent || '', cards: p.querySelectorAll('[data-k]').length + p.querySelectorAll('.sec').length + p.querySelectorAll('.spin').length,
              title: document.getElementById('mast-title').textContent, err: !!p.querySelector('.errbox') };
          });
          check(state.id === 'panel-' + tab, tab + ': its panel is the one showing', state.id);
          check(!state.err, tab + ': no error box', '');
          if (!demo && !LIVE.has(tab)) {
            check(state.promise && state.h2 === LABELS[TABS.indexOf(tab)], tab + ': live, it states its promise', JSON.stringify(state));
          } else {
            check(state.cards > 0 && !state.promise, tab + ': it draws its screen', JSON.stringify(state));
          }
          await pageRules(page, tab, combo.viewport.width);
          if (demo && combo === COMBOS[0]) {
            await page.evaluate(() => document.querySelector('.panel:not([hidden])').scrollTo(0, 0));
            await page.waitForTimeout(250);
            await page.screenshot({ path: path.join(SHOTS, 'demo-' + tab + '.png') });
          }
          if (demo && combo === COMBOS[1] && tab === 'wire') await page.screenshot({ path: path.join(SHOTS, 'demo-wire-dark.png') });
          if (demo && combo === COMBOS[3] && (tab === 'wire' || tab === 'onair')) await page.screenshot({ path: path.join(SHOTS, 'demo-' + tab + '-desktop.png') });
          if (!demo && combo === COMBOS[0] && (tab === 'wire' || tab === 'food')) await page.screenshot({ path: path.join(SHOTS, 'live-' + tab + '.png') });
        }
        const gc = await page.evaluate(() => window.__gc);
        check(JSON.stringify(gc) === JSON.stringify(TABS.map((t) => 'all-day-tab-' + t)), 'one GoatCounter tab-landing event per landing', JSON.stringify(gc));
        await page.click('#tab-games');
        await page.waitForTimeout(100);
        check((await page.evaluate(() => window.__gc.length)) === TABS.length, 'tapping the tab you are on counts nothing', '');
        check(!errors.length, 'no console errors', errors.slice(0, 5).join(' | '));
        if (demo) check(!supabase.length, 'demo mode never calls Supabase', supabase.join(', '));
        await ctx.close();
      });
    }
  }
}

/* ------------------------------------------------------------- deep links */
async function flashes(page, key) {
  return page.waitForFunction((k) => {
    const n = [...document.querySelectorAll('.panel:not([hidden]) [data-k]')].find((x) => x.dataset.k === k);
    if (!n || !n.classList.contains('flash')) return false;
    const r = n.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight;
  }, key, { timeout: 6000 }).then(() => true, () => false);
}

async function deepLinks(browser, base) {
  await group('deep links, demo', async () => {
    const cases = [['wire', 'w13'], ['wire', 'y4'], ['watch', 'fm3'], ['food', 'fv2'], ['people', 'pp2'], ['whatnow', 'e-tn3'], ['vintage', 'sp2'], ['art', 'aw6'], ['onair', 'tv3']];
    for (const [tab, key] of cases) {
      const { ctx, page, errors } = await newPage(browser, base);
      await page.goto(base + '/all-day/?demo=1#' + tab + '/' + key);
      check(await flashes(page, key), '#' + tab + '/' + key + ' lands on its card and flashes', '');
      check(!errors.length, '#' + tab + '/' + key + ': no console errors', errors.join(' | '));
      await ctx.close();
    }
    const { ctx, page } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#whatnow/missions');
    await settle(page);
    check(await page.$eval('#subnav .chip.on', (b) => b.innerText).then((t) => /Missions/.test(t)), '#whatnow/missions opens the mode', '');
    await page.goto(base + '/all-day/?demo=1#onair/everything');
    await settle(page);
    check(await page.$eval('.panel:not([hidden]) [data-sec="tv"] h2', (h) => h.textContent) === 'Tonight, local and beyond', '#onair/everything flips the shared switch', '');
    await page.goto(base + '/all-day/?demo=1#wire/nope-not-a-card');
    await page.waitForSelector('#toast:not([hidden])', { timeout: 6000 }).catch(() => {});
    check(/moved on/.test(await page.$eval('#toast', (t) => t.textContent)), 'an unknown key says the card has moved on', '');
    await ctx.close();
  });

  await group('deep links, live Wire', async () => {
    const files = wireFiles();
    const today = files['wire-today.json'];
    const items = today.updates.flatMap((u) => u.items);
    const far = items.filter((it) => !it.local)[50];          /* national, past the first chunk, for a Local reader */
    const y1 = files['index.json'].editions[0].date;
    const old = files[y1 + '.json'].updates[1].items[3];
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/#wire/' + far.id);
    check(await flashes(page, far.id), 'a shared national card far down today lands and flashes for a Local reader', far.id);
    check(await page.evaluate(() => JSON.parse(localStorage.getItem('allday-settings') || '{}').localOnly === false), 'and the switch moved to Everything to show it', '');
    await page.goto(base + '/all-day/#wire/' + old.id);
    await page.reload();
    check(await flashes(page, old.id), 'a card from yesterday’s edition lands and flashes', old.id);
    await page.goto(base + '/all-day/#wire/' + y1);
    await page.reload();
    await page.waitForFunction((n) => document.querySelector('#subnav .dl b')?.textContent === n, nameOf(y1), { timeout: 6000 }).catch(() => {});
    check(await page.$eval('#subnav .dl b', (b) => b.textContent) === nameOf(y1), '#wire/' + y1 + ' opens that edition', await page.$eval('#subnav .dl b', (b) => b.textContent));
    check(/What mattered /.test(await page.$eval('.panel:not([hidden])', (p) => p.innerText)), 'an earlier day reads “What mattered …”', '');
    /* a pre-rebuild link (a URL key) still lands, on the raw wire */
    const pulse = JSON.parse(await readFile(path.join(REPO, 'data/pulse.json'), 'utf8'));
    const ids = new Set(pulse.sources.map((x) => x.id));
    const raw = pulse.items.filter((it) => it.u && it.t && ids.has(it.s)).sort((a, b) => b.d - a.d)[90];
    await page.goto(base + '/all-day/#wire/' + encodeURIComponent(raw.u));
    await page.reload();
    check(await flashes(page, raw.u), 'an old URL link opens Unfiltered and flashes the headline', raw.u);
    await page.goto(base + '/all-day/#wire/nope-not-a-card');
    await page.reload();
    await page.waitForSelector('#toast:not([hidden])', { timeout: 8000 }).catch(() => {});
    check(/moved on/.test(await page.$eval('#toast', (t) => t.textContent)), 'live: an unknown key says the card has moved on', '');
    await page.goto(base + '/all-day/#food/');
    await settle(page);
    check(await page.$eval('#tab-food', (b) => b.getAttribute('aria-selected')) === 'true', '#food/ lands on Food', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('demo mode keeps its hands off the real app', async () => {
    const { ctx, page, supabase } = await newPage(browser, base);
    await page.goto(base + '/all-day/');
    await settle(page);
    const real = { auth: JSON.stringify({ access_token: 'a.b.c', refresh_token: 'r', expires_at: 4102444800, user: { id: 'u1', email: 'reader@example.com' } }),
      settings: JSON.stringify({ localOnly: true }), visit: JSON.stringify({ base: 1700000000, last: 1700000100 }) };
    await page.evaluate((r) => { localStorage.setItem('allday-auth', r.auth); localStorage.setItem('allday-settings', r.settings); localStorage.setItem('allday-visit', r.visit); }, real);
    supabase.length = 0;
    await page.goto(base + '/all-day/?demo=1#wire');
    await settle(page);
    await page.click('#subnav .localsw-half:not(.on)');
    await page.click('#settings-btn');
    const txt = await page.$eval('.sheet-body', (b) => b.innerText);
    check(!/reader@example\.com|Sign out/.test(txt), 'demo Settings does not show the real account', '');
    const after = await page.evaluate(() => ({ auth: localStorage.getItem('allday-auth'), settings: localStorage.getItem('allday-settings'), visit: localStorage.getItem('allday-visit') }));
    check(JSON.stringify(after) === JSON.stringify(real), 'demo leaves the real session, settings and visit untouched', JSON.stringify(after));
    check(!supabase.length, 'demo makes no Supabase call', supabase.join(', '));
    await ctx.close();
  });
}

/* -------------------------------------------------------------- the Wire */
const panelText = (page) => page.$eval('.panel:not([hidden])', (p) => p.innerText);
/* the cards above the first earlier-day head: what today's page drew */
const todayKeys = (page) => page.evaluate(() => {
  const p = document.querySelector('.panel:not([hidden]) .feed');
  const out = [];
  for (const n of p.querySelectorAll('[data-k], [data-day]')) { if (n.dataset.day) break; out.push(n.dataset.k); }
  return out;
});
/* scroll until today is fully drawn (the first earlier-day head is on the page) */
async function drawToday(page) {
  for (let i = 0; i < 30 && !(await page.$('.panel:not([hidden]) [data-day]')); i++) {
    await page.evaluate(() => { const p = document.querySelector('.panel:not([hidden])'); p.scrollTop = p.scrollHeight; });
    await page.waitForTimeout(120);
  }
}

/* back to the top, where the mast (and its chips) is always showing */
async function toTop(page) {
  await page.evaluate(() => { const p = document.querySelector('.panel:not([hidden])'); p.scrollTop = 0; });
  await page.waitForFunction(() => !document.body.classList.contains('chrome-away'));
  await page.waitForTimeout(250);
}
async function chipTo(page, k) {
  await toTop(page);
  await page.click('#subnav .chip[data-chip="' + k + '"]');
  await page.waitForTimeout(80);
}

async function theWire(browser, base) {
  await group('the Wire, live', async () => {
    const files = wireFiles();
    const today = files['wire-today.json'];
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/');
    await page.waitForSelector('#subnav .dl b', { timeout: 15000 });
    await page.waitForSelector('.panel:not([hidden]) .wm', { timeout: 15000 });
    const todayET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
    check(await page.$eval('#subnav .dl b', (b) => b.textContent) === todayET, 'the dateline is today in America/New_York on the real clock (' + todayET + ')', await page.$eval('#subnav .dl b', (b) => b.textContent));
    const sub = await page.$eval('#subnav .dl .s', (b) => b.textContent);
    check(sub.startsWith(today.counts.local.all + ' stories so far · updated '), 'the dateline counts today’s local stories and says when it updated', sub);
    await page.screenshot({ path: path.join(SHOTS, 'live-wire-today.png') });

    /* the chips: kinds only, X and Facebook hidden while paused, Unfiltered last */
    const chipsNow = await page.$$eval('#subnav .chip', (cs) => cs.map((c) => [c.dataset.chip, (c.querySelector('.n') || {}).textContent || '']));
    check(JSON.stringify(chipsNow.map((c) => c[0])) === JSON.stringify(['all', 'reddit', 'newsletters', 'video', '__raw']), 'X and Facebook chips are hidden while paused; Unfiltered is last', JSON.stringify(chipsNow));
    check(chipsNow.filter((c) => !['all', '__raw'].includes(c[0])).every((c) => Number(c[1]) === today.counts.local[c[0]]), 'chip counts are counts.local', JSON.stringify(chipsNow));

    /* the Brief, pinned above What matters today, and nowhere else today */
    const brief = await page.evaluate(() => {
      const c = document.querySelector('.panel:not([hidden]) .feed > .card.pick');
      return c ? { k: c.dataset.k, eyebrow: c.querySelector('.eyebrow').textContent, before: !!(c.compareDocumentPosition(document.querySelector('.wm')) & 4) } : null;
    });
    check(brief && brief.k === today.brief.id && /The Brief/i.test(brief.eyebrow) && brief.before, 'the Brief is pinned above What matters today', JSON.stringify(brief));

    /* What matters today: ten local picks, five open, the rest on request */
    check(await page.$$eval('.wm .card', (c) => c.length) === 5, 'one pick card and four ranked rows to start', '');
    check(await page.$$eval('.wm .wm-row', (rs) => rs.filter((r) => !r.querySelector('.why')).length) === 1, 'an empty why draws no reason line', '');
    await page.click('.wm .btn.more');
    check(await page.$$eval('.wm .card', (c) => c.length) === 10, '“5 more picks” opens six to ten in place', '');
    check(/That’s the ten\./.test(await page.$eval('.wm', (w) => w.innerText)), 'and the list ends “That’s the ten.”', '');

    /* the river leaves the shown picks out and counts add up */
    await drawToday(page);
    const keys = await todayKeys(page);
    check(new Set(keys).size === keys.length, 'nothing shows twice on today’s page', keys.length);
    check(keys.length === today.counts.local.all, 'today’s page draws every local story once: Brief + picks + river = the count', keys.length + ' vs ' + today.counts.local.all);
    for (const [k, n] of chipsNow.filter((c) => !['all', '__raw'].includes(c[0]))) {
      await chipTo(page, k);
      await drawToday(page);
      const got = (await todayKeys(page)).length;
      check(got === Number(n), 'the ' + k + ' chip shows exactly its count today (' + n + ')', got);
    }
    await chipTo(page, 'all');
    await page.click('#subnav .localsw-half:not(.on)');
    await page.waitForTimeout(150);
    const every = await page.$$eval('#subnav .chip', (cs) => cs.map((c) => [c.dataset.chip, (c.querySelector('.n') || {}).textContent || '']));
    check(every.filter((c) => !['all', '__raw'].includes(c[0])).every((c) => Number(c[1]) === today.counts.everything[c[0]]), 'on Everything the chips are counts.everything', JSON.stringify(every));
    check((await page.$eval('#subnav .dl .s', (b) => b.textContent)).startsWith(today.counts.everything.all + ' stories'), 'and the dateline counts everything', '');
    check(await page.$$eval('.wm .card', (c) => c.length) >= 5 && /What matters today/.test(await panelText(page)), 'Everything keeps the picks', '');

    /* the long river: it keeps drawing past 120 and runs into the editions, then really ends */
    let cardsN = 0;
    for (let i = 0; i < 60 && !(await page.$('.panel:not([hidden]) .caught')); i++) {
      await page.evaluate(() => { const p = document.querySelector('.panel:not([hidden])'); p.scrollTop = p.scrollHeight; });
      await page.waitForTimeout(100);
    }
    cardsN = await page.$$eval('.panel:not([hidden]) [data-k]', (c) => c.length);
    check(cardsN > 120, 'the river keeps rendering past 120 items (' + cardsN + ')', cardsN);
    const heads = await page.$$eval('.panel:not([hidden]) [data-day]', (h) => h.map((x) => x.innerText.split('\n')[0]));
    const [y1, y2] = files['index.json'].editions.map((e) => e.date);
    check(heads.length === 2 && heads[0] === 'Yesterday, ' + nameOf(y1) && heads[1] === nameOf(y2), 'today flows into yesterday, then the day before, each with its own head', JSON.stringify(heads));
    check(/whole archive/.test(await page.$eval('.panel:not([hidden]) .caught', (c) => c.innerText)), 'when the editions run out, the end says so', '');
    /* put yesterday's head well above the top of the panel: the dateline names it */
    await page.evaluate(() => {
      const p = document.querySelector('.panel:not([hidden])');
      const h = p.querySelector('[data-day]');
      p.scrollTop += h.getBoundingClientRect().top - p.getBoundingClientRect().top + 400;
    });
    await page.waitForTimeout(250);
    check(await page.$eval('#subnav .dl b', (b) => b.textContent) === nameOf(y1), 'scrolled into yesterday, the dateline names it', await page.$eval('#subnav .dl b', (b) => b.textContent));

    /* a mute leaves the river */
    await toTop(page);
    const victim = await page.$eval('.panel:not([hidden]) .card.row .srcbtn', (b) => b.dataset.src);
    await page.click('.panel:not([hidden]) .card.row .srcbtn');
    await page.waitForSelector('.sheet-card', { timeout: 3000 });
    const sheet = await page.$eval('.sheet-body', (b) => b.innerText);
    check(/Mute/.test(sheet) && /Open the site/.test(sheet) && /stor(y|ies) today/.test(sheet), 'the source sheet: its stories today, Mute, Open the site', sheet.slice(0, 120));
    await page.click('.sheet-body .linkrow .btn:text("Mute")');
    await page.click('#confirm [data-yes]');
    await page.waitForTimeout(200);
    check(!(await page.$('.panel:not([hidden]) [data-src="' + victim + '"]')), 'a muted source leaves the river (' + victim + ')', '');
    const after = await page.$$eval('#subnav .chip', (cs) => cs.map((c) => [c.dataset.chip, Number((c.querySelector('.n') || {}).textContent || 0)]));
    const sumAfter = after.filter((c) => !['all', '__raw'].includes(c[0])).reduce((a, c) => a + c[1], 0);
    const sumBefore = every.filter((c) => !['all', '__raw'].includes(c[0])).reduce((a, c) => a + Number(c[1]), 0);
    check(sumAfter <= sumBefore, 'the chip counts are recounted without the muted source', sumBefore + ' -> ' + sumAfter);
    await toTop(page);
    await page.click('#settings-btn');
    check((await page.$eval('.sheet-body', (b) => b.innerText)).includes('Muted sources'), 'Settings lists mutes', '');
    await page.keyboard.press('Escape');
    check(!errors.length, 'no console errors', errors.slice(0, 5).join(' | '));
    await ctx.close();
  });

  await group('the Wire, walking back', async () => {
    const files = wireFiles();
    const [y1, y2] = files['index.json'].editions.map((e) => e.date);
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/');
    await page.waitForSelector('.panel:not([hidden]) .wm', { timeout: 15000 });
    await page.click('#subnav .dateline .nav[aria-label="Earlier day"]');
    await page.waitForFunction((n) => document.querySelector('#subnav .dl b')?.textContent === n, nameOf(y1), { timeout: 6000 }).catch(() => {});
    await page.waitForSelector('.panel:not([hidden]) .wm', { timeout: 6000 }).catch(() => {});
    check(await page.$eval('#subnav .dl b', (b) => b.textContent) === nameOf(y1) && / · final$/.test(await page.$eval('#subnav .dl .s', (b) => b.textContent)), 'one day back: yesterday, final', await page.$eval('#subnav .dl', (b) => b.innerText));
    check(new RegExp('What mattered ' + nameOf(y1).split(',')[0]).test(await panelText(page)), 'yesterday reads “What mattered ' + nameOf(y1).split(',')[0] + '”', '');
    await page.screenshot({ path: path.join(SHOTS, 'live-wire-yesterday.png') });
    await page.click('#subnav .dateline .nav[aria-label="Earlier day"]');
    await page.waitForFunction((n) => document.querySelector('#subnav .dl b')?.textContent === n, nameOf(y2), { timeout: 6000 }).catch(() => {});
    check(await page.$eval('#subnav .dl b', (b) => b.textContent) === nameOf(y2), 'two days back: ' + nameOf(y2), await page.$eval('#subnav .dl b', (b) => b.textContent));
    check(await page.$eval('#subnav .dateline .nav[aria-label="Earlier day"]', (b) => b.disabled), 'and that is as far as the archive goes', '');
    check(/#wire\/\d{4}-\d{2}-\d{2}$/.test(await page.evaluate(() => location.hash)), 'the edition is in the address, so it can be shared', '');
    await page.click('#subnav .dateline .nav[aria-label="Later day"]');
    await page.click('#subnav .dateline .nav[aria-label="Later day"]');
    await page.waitForTimeout(200);
    check(/so far/.test(await page.$eval('#subnav .dl .s', (b) => b.textContent)), '› › comes back to today', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('the Wire, inbox live and no Brief', async () => {
    const files = wireFiles({ inbox: true, brief: false });
    const today = files['wire-today.json'];
    const { ctx, page, errors } = await newPage(browser, base, { wire: { inbox: true, brief: false } });
    await page.goto(base + '/all-day/');
    await page.waitForSelector('.panel:not([hidden]) .wm', { timeout: 15000 });
    const ch = await page.$$eval('#subnav .chip', (cs) => cs.map((c) => c.dataset.chip));
    check(ch.includes('x') && ch.includes('facebook'), 'the X and Facebook chips come back when the inbox is live', JSON.stringify(ch));
    check(!(await page.$('.panel:not([hidden]) .feed > .card.pick:first-child .eyebrow')) ||
      !/The Brief/i.test(await page.$eval('.panel:not([hidden]) .feed > .card.pick', (c) => c.querySelector('.eyebrow').textContent)), 'no `brief`, no pinned Brief card', '');
    await page.click('#subnav .chip[data-chip="x"]');
    await page.waitForTimeout(100);
    const post = await page.$eval('.panel:not([hidden]) .card.post', (c) => ({ via: c.querySelector('.via:last-of-type')?.textContent, open: c.querySelector('.openlink')?.getAttribute('href') }));
    const xItem = today.updates.flatMap((u) => u.items).find((it) => it.ch === 'x');
    check(post.open === xItem.url, 'an X card links to the original post', JSON.stringify(post));
    await page.click('.panel:not([hidden]) .card.post .srcbtn');
    await page.waitForSelector('.sheet-card', { timeout: 3000 });
    check(/Open on X/.test(await page.$eval('.sheet-body', (b) => b.innerText)), 'an X source sheet opens on X', '');
    await page.keyboard.press('Escape');
    await page.click('#subnav .chip[data-chip="facebook"]');
    await page.waitForTimeout(100);
    check(/Facebook group, via Muse/.test(await page.$eval('.panel:not([hidden]) .card.post', (c) => c.innerText)), 'a Facebook card shows its kind', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('the Wire, Unfiltered', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/');
    await page.waitForSelector('.panel:not([hidden]) .wm', { timeout: 15000 });
    await page.click('#subnav .chip[data-chip="__raw"]');
    await page.waitForSelector('#subnav .chips.outlets', { timeout: 8000 });
    check(/Unfiltered/.test(await page.$eval('#subnav .dl', (d) => d.innerText)) && await page.evaluate(() => location.hash) === '#wire/unfiltered', 'Unfiltered opens inside the tab', '');
    const rows = await page.$$eval('.panel:not([hidden]) .card.row', (r) => r.length);
    check(rows === 60, 'the raw wire draws sixty headlines to start', rows);
    const outlet = await page.$eval('#subnav .chips.outlets .chip:nth-child(2)', (c) => [c.dataset.chip, c.querySelector('span').textContent]);
    await page.click('#subnav .chips.outlets .chip:nth-child(2)');
    await page.waitForTimeout(100);
    const srcs = await page.$$eval('.panel:not([hidden]) .card.row .c-src', (s) => [...new Set(s.map((x) => x.textContent))]);
    check(srcs.length === 1 && srcs[0] === outlet[1], 'an outlet chip narrows the wire to that outlet', JSON.stringify(srcs));
    await page.click('#subnav .chips.outlets .chip:first-child');
    const word = (await page.$eval('.panel:not([hidden]) .card.row .c-title', (t) => t.textContent)).split(/\s+/).find((w) => w.length > 5);
    await page.fill('.panel:not([hidden]) .toolrow input', word);
    await page.waitForTimeout(400);
    const titles = await page.$$eval('.panel:not([hidden]) .card.row .c-title', (t) => t.map((x) => x.textContent.toLowerCase()));
    check(titles.length > 0 && titles.every((t) => t.includes(word.toLowerCase())), 'search keeps only matching headlines (“' + word + '”)', titles.length);
    check(await page.$eval('.panel:not([hidden]) .toolrow input', (i) => document.activeElement === i), 'and the search field keeps the caret', '');
    await page.fill('.panel:not([hidden]) .toolrow input', '');
    await page.waitForTimeout(400);
    await page.click('.panel:not([hidden]) .toolrow .pills button:nth-child(2)');
    check(await page.$$eval('.panel:not([hidden]) .srcsec', (s) => s.length) > 3, 'By outlet draws a section per outlet', '');
    const b = await page.locator('.panel:not([hidden]) .srcsec .card.row').first().boundingBox();
    await page.mouse.move(b.x + 100, b.y + 20);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    check(await page.$('.peek') !== null, 'hold to peek works on the raw wire', '');
    await page.keyboard.press('Escape');
    await page.click('.panel:not([hidden]) .toolrow .pills button:nth-child(1)');
    await page.click('#subnav .btn.back');
    await page.waitForSelector('.panel:not([hidden]) .wm', { timeout: 4000 });
    check(/so far/.test(await page.$eval('#subnav .dl .s', (s) => s.textContent)), '‹ Today’s paper comes back', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });
}

/* ------------------------------------------------------------ interactions */
async function interactions(browser, base) {
  await group('interactions, demo', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#wire');
    await settle(page);
    const row = page.locator('.panel:not([hidden]) .card.row').first();
    const k = await row.getAttribute('data-k');
    await row.locator('[data-act="save"]').click();
    check(await page.$eval('#saved-btn', (b) => b.classList.contains('on')), 'the star saves and lights the mast', '');
    await page.evaluate(() => document.querySelector('.panel:not([hidden])').scrollBy(0, -60));   /* the mast returns on an upward scroll */
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('saved-btn').click());
    check(await page.locator('.sheet-card .sheet-row').count() === 1, 'the Saved sheet lists it', '');
    await page.keyboard.press('Escape');
    check(await page.$('#sheet[hidden]') !== null, 'Escape closes the sheet', '');

    const rowAt = async (i) => { const l = page.locator('.panel:not([hidden]) .card.row').nth(i); await l.scrollIntoViewIfNeeded(); await page.waitForTimeout(250); return l.boundingBox(); };
    const box = await rowAt(1);
    const k2 = await page.locator('.panel:not([hidden]) .card.row').nth(1).getAttribute('data-k');
    await page.mouse.move(box.x + 60, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 60 + i * 12, box.y + box.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(200);
    check(await page.$eval('[data-k="' + k2 + '"] .act.star', (b) => b.classList.contains('on')), 'swipe right past 72px saves', '');

    const b3 = await rowAt(2);
    await page.mouse.move(b3.x + 250, b3.y + b3.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(b3.x + 250 - i * 12, b3.y + b3.height / 2);
    await page.mouse.up();
    await page.waitForSelector('#confirm:not([hidden])', { timeout: 2000 }).catch(() => {});
    check(await page.$('#confirm:not([hidden])') !== null, 'swipe left past 72px asks before muting', '');
    const muted = await page.$eval('#confirm h3', (h) => h.textContent);
    await page.click('#confirm [data-yes]');
    await page.waitForTimeout(200);
    check(/Undo/.test(await page.$eval('#toast', (t) => t.textContent)), 'the mute toast carries Undo', '');
    const away = await page.evaluate(() => document.body.classList.contains('chrome-away'));
    check(away, 'scrolling down sends the mast away', '');
    await page.evaluate(() => document.querySelector('.panel:not([hidden])').scrollBy(0, -200));
    await page.waitForTimeout(300);
    check(!(await page.evaluate(() => document.body.classList.contains('chrome-away'))), 'scrolling up brings it back', '');
    await page.click('#settings-btn');
    check((await page.$eval('.sheet-body', (b) => b.innerText)).includes(muted.replace(/^Mute |\?$/g, '')), 'Settings lists the muted source', muted);
    check(/Sign in/.test(await page.$eval('.sheet-body', (b) => b.innerText)), 'Settings has a Sign in row', '');
    check(/More from the Brief/.test(await page.$eval('.sheet-body', (b) => b.innerText)), 'Settings carries the network bar\'s links', '');
    await page.keyboard.press('Escape');

    const b4 = await rowAt(0);
    await page.mouse.move(b4.x + 100, b4.y + 20);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    check(await page.$('.peek') !== null, 'holding a card for 550ms opens the peek', '');
    await page.keyboard.press('Escape');
    check(await page.$('.peek') === null, 'Escape closes the peek', '');

    await page.click('#theme-btn');
    check(await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark', 'the mast toggle switches to dark', '');
    await page.reload();
    check(await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark', 'the theme survives a reload, painted before first paint', '');
    check(await page.evaluate(() => !JSON.parse(localStorage.getItem('allday-saved') || '[]').length && !localStorage.getItem('allday-voted')), 'demo saves never reach localStorage', '');

    await page.goto(base + '/all-day/?demo=1#onair');
    await settle(page);
    await page.click('.panel:not([hidden]) .audio .pb');
    check(await page.$('#player:not([hidden])') !== null, 'play raises the one player', '');
    await goTab(page, 'food');
    check(await page.$('#player:not([hidden])') !== null, 'the player survives a tab switch', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('scroll memory', async () => {
    const { ctx, page } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#watch');
    await settle(page);
    await page.evaluate(() => document.querySelector('#panel-watch').scrollTo(0, 400));
    await goTab(page, 'food');
    await goTab(page, 'watch');
    const y = await page.evaluate(() => document.querySelector('#panel-watch').scrollTop);
    check(Math.abs(y - 400) < 2, 'each tab keeps its own scroll position', y);
    await ctx.close();
  });

  await group('sign-in fails soft', async () => {
    const off = await newPage(browser, base, { authEmail: false });
    await off.page.goto(base + '/all-day/');
    await settle(off.page);
    await off.page.click('#settings-btn');
    await off.page.waitForFunction(() => !/Checking/.test(document.querySelector('.sheet-body').innerText));
    check(/Coming soon/.test(await off.page.$eval('.sheet-body', (b) => b.innerText)), 'Auth off in the project: the row says coming soon', '');
    check(!off.errors.length, 'no console errors', off.errors.join(' | '));
    await off.ctx.close();
    const on = await newPage(browser, base);
    await on.page.goto(base + '/all-day/');
    await settle(on.page);
    await on.page.click('#settings-btn');
    await on.page.waitForSelector('.signin input[type=email]', { timeout: 4000 }).catch(() => {});
    check(await on.page.$('.signin input[type=email]') !== null, 'Auth on: an email field and Send link', '');
    await on.page.fill('.signin input', 'not an email');
    await on.page.click('.signin button');
    check(/doesn’t look like/.test(await on.page.$eval('.signin + .sheet-note', (n) => n.textContent)), 'a bad address is caught before any request', '');
    check(!on.supabase.some((s) => /otp/.test(s)), 'no link was requested', on.supabase.join(', '));
    check(!on.errors.length, 'no console errors', on.errors.join(' | '));
    await on.ctx.close();
  });

  await group('performance', async () => {
    const { ctx, page } = await newPage(browser, base, { viewport: { width: 390, height: 844 } });
    await page.goto(base + '/all-day/');
    await page.waitForSelector('#subnav .dl b', { timeout: 15000 });
    await page.click('#subnav .localsw-half:not(.on)');   /* Everything: a full page of rows */
    await page.waitForSelector('.panel:not([hidden]) .card.row', { timeout: 15000 });
    await page.waitForTimeout(200);
    const ms = await page.evaluate(() => {
      const chip = document.querySelector('#subnav .chip[data-chip="all"]');
      const t = performance.now();
      chip.click();
      return performance.now() - t;
    });
    const rows = await page.$$eval('.panel:not([hidden]) .card', (c) => c.length);
    check(rows >= 60 && ms < 100, 'the live Wire redraws ' + rows + ' cards in ' + Math.round(ms) + 'ms (budget 100)', Math.round(ms) + 'ms');
    await ctx.close();
  });
}

/* ------------------------------------------------------------- What Now */
/* Tonight's fixtures, dated to today in Burlington on the real clock: what
   must show (5 pm on, today, not over, once) and what must not (morning,
   4:59 pm, all day, cancelled, tomorrow, yesterday). The page runs in Los
   Angeles, so "today after 5 pm" has to be Burlington's, not the reader's. */
const etOffset = (ms) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' }).formatToParts(new Date(ms)).find((x) => x.type === 'timeZoneName');
  const m = p && /GMT([+-]\d{2}:\d{2})/.exec(p.value);
  return m ? m[1] : '-05:00';
};
function tonightFiles() {
  const now = Date.now();
  const today = etKey(now);
  const at = (day, hm) => day + 'T' + hm + ':00' + etOffset(now);
  const ev = (id, title, day, start, end, extra) => ({ id, title, date: day, start: at(day, start), ...(end ? { end: at(day, end) } : {}), url: 'https://example.com/' + id,
    category: 'music', allDay: false, venue: 'Fixture Hall ' + id, town: 'Burlington', free: true, ...(extra || {}) });
  const events = [
    ev('x-morning', 'Morning thing', today, '10:00', '11:00'),
    ev('x-459', 'Starts a minute early', today, '16:59', '23:59'),
    ev('ok-1700', 'Starts at five', today, '17:00', '23:59'),
    ev('ok-dup', 'Listed twice', today, '21:00', '23:59'),
    ev('ok-dup2', 'Listed twice', today, '21:00', '23:59'),
    ev('ok-2345', 'Late one', today, '23:45', null),
    ev('x-allday', 'All day thing', today, '00:00', null, { allDay: true }),
    ev('x-cancel', 'CANCELLED--Evening thing', today, '19:00', '21:00'),
    ev('x-tomorrow', 'Tomorrow night', dayMinus(today, -1), '19:00', '21:00'),
    ev('x-yesterday', 'Last night', dayMinus(today, 1), '20:00', '22:00'),
  ];
  const artist = (id, name, day, why, album) => ({ id, name, genre: 'folk', why, threads: 0, links: {},
    bandcamp: album ? { album, title: name + ' record', art: 'https://f4.bcbits.com/img/a1_2.jpg' } : null,
    shows: [{ date: day, time: '8 PM', venue: 'Fixture Hall', vid: 'fixture', title: name, url: 'https://example.com/' + id, price: '$10', free: false }] });
  const music = { generated: new Date(now).toISOString(), calendar: { window: 60, venues: [] }, bigrooms: [], artists: [
    artist('tonight-band', 'Tonight Band', today, 'Played every porch party last summer.', '1234567'),
    artist('saturday-band', 'Later Band', dayMinus(today, -3), null, '7654321'),
    artist('far-band', 'Far Band', dayMinus(today, -10), 'Not this week.', '1111111'),
  ] };
  return { events: { generated: new Date(now).toISOString(), days: 10, counts: {}, events }, music };
}

const wnPanel = '#panel-whatnow';
async function spinAnswer(page) {
  await page.click(wnPanel + ' .spin .big');
  await page.waitForSelector(wnPanel + ' .result:not(.rolling) h3', { timeout: 8000 });
  return page.$eval(wnPanel + ' .result h3', (h) => h.textContent);
}

async function theWhatNow(browser, base) {
  await group('What Now, Spin (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#whatnow');
    await page.waitForSelector(wnPanel + ' .spin .big:not([disabled])', { timeout: 15000 });
    check(await page.$eval('#subnav .chip.on', (b) => /Spin/.test(b.innerText)), 'the chip row is the mode switch, Spin first', '');
    const wx = await page.$eval(wnPanel + ' .wx', (w) => w.innerText.replace(/\s+/g, ' '));
    check(/59° feels like/.test(wx) && /61° lake/.test(wx) && /6:06 sunset/.test(wx), 'the weather line: feels like, the lake, sunset', wx);
    check(await page.$eval(wnPanel + ' .wx', (w) => w.getBoundingClientRect().height < 40), 'the weather line is one line at 390', '');
    check(await page.$$eval(wnPanel + ' .chips.paths .chip', (c) => c.map((x) => x.innerText).join('|')) === 'I’m broke|Get me outside|People, please|Two hours|Close by|Teach me something', 'the six path chips', '');
    const first = await spinAnswer(page);
    check(first.length > 3, 'Spin returns an answer', first);
    check(/^Because /.test(await page.$eval(wnPanel + ' .result .because', (p) => p.textContent).catch(() => '')), 'the answer spells out its reason', '');
    check(/^Right now · /.test(await page.$eval(wnPanel + ' .result .eyebrow', (e) => e.textContent)), 'the answer says it is for right now', '');
    await page.click(wnPanel + ' .result .another');
    await page.waitForSelector(wnPanel + ' .result:not(.rolling) h3', { timeout: 8000 });
    const second = await page.$eval(wnPanel + ' .result h3', (h) => h.textContent);
    check(second !== first, 'Another changes the answer', first + ' → ' + second);
    await page.click(wnPanel + ' .result .doit');
    check(await page.$eval(wnPanel + ' .result h3', (h) => h.textContent) === 'Now put the phone down.', 'Do it ends the session: “Now put the phone down.”', '');
    await page.click(wnPanel + ' .pills button:has-text("Tomorrow")');
    await spinAnswer(page);
    check(await page.$eval(wnPanel + ' .result .eyebrow', (e) => e.textContent) === 'Tomorrow', 'the window: Tomorrow plans tomorrow', '');
    await page.click(wnPanel + ' .chip[data-chip="hobby"]');
    await page.waitForSelector(wnPanel + ' .result:not(.rolling) h3');
    const hobby = await page.$eval(wnPanel + ' .result h3', (h) => h.textContent);
    check(['Knitting', 'Sailing'].includes(hobby.trim()), 'Teach me something swaps the hat for the hobbies', hobby);
    check(await page.$eval(wnPanel + ' .chip[data-chip="hobby"]', (b) => b.getAttribute('aria-pressed')) === 'true', 'a path chip shows it is on', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('What Now, Spin (live, reduced motion)', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { motion: 'reduce' });
    await page.goto(base + '/all-day/#whatnow');
    await page.waitForSelector(wnPanel + ' .spin .big:not([disabled])', { timeout: 15000 });
    await page.click(wnPanel + ' .spin .big');
    check(await page.$(wnPanel + ' .result:not(.rolling)') !== null, 'reduced motion: the answer lands at once, no reel', '');
    const txt = await page.$eval(wnPanel + ' .result', (r) => r.innerText);
    check(/Do it|Nothing fits all that/.test(txt), 'live: the real engine answers (or says honestly that nothing fits)', txt.slice(0, 80));
    check(/^(Picked from \d+ things? that fit|Nothing in the hat for) right now/.test(await page.$eval(wnPanel + ' .note.pad', (n) => n.textContent)), 'the pool line says what the answer was picked from', '');
    await page.screenshot({ path: path.join(SHOTS, 'live-whatnow-spin.png') });
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('What Now, Missions (live)', async () => {
    const real = JSON.parse(await readFile(path.join(REPO, 'data/missions.json'), 'utf8'));
    check(real.count === 100 && real.missions.length === 100, 'data/missions.json holds 100 missions', real.missions.length);
    const words = real.missions.map((m) => m.paragraph.split(/\s+/).length);
    check(words.every((n) => n >= 60 && n <= 120), 'every paragraph is 60 to 120 words', words.filter((n) => n < 60 || n > 120).join(', '));
    check(real.missions.every((m) => !/[—–!]/.test(m.paragraph) && real.themes.includes(m.theme) && m.places.length), 'no dashes or exclamation points, a known theme, at least one place', '');
    check(real.needs_check === real.missions.filter((m) => m.needs_check).length, 'needs_check is counted honestly (' + real.needs_check + ')', '');

    const { ctx, page, errors, supabase } = await newPage(browser, base);
    await page.goto(base + '/all-day/#whatnow/missions');
    await page.waitForSelector(wnPanel + ' .lrow.mission', { timeout: 15000 });
    const nums = await page.$$eval(wnPanel + ' .lrow.mission .num', (n) => n.map((x) => Number(x.textContent)));
    check(nums.length === 100 && nums.every((n, i) => n === i + 1), 'the hundred, numbered 1 to 100', nums.length);
    const themeChip = await page.$eval(wnPanel + ' .chips.themes .chip[data-chip="drink"] .n', (n) => Number(n.textContent));
    await page.click(wnPanel + ' .chips.themes .chip[data-chip="drink"]');
    const shown = await page.$$eval(wnPanel + ' .lrow.mission .s', (s) => s.map((x) => x.textContent));
    check(shown.length === themeChip && shown.every((t) => /^Drink/.test(t)), 'a theme chip filters to its missions, and its count is right (' + themeChip + ')', shown.length);
    await page.click(wnPanel + ' .chips.themes .chip[data-chip="all"]');
    await page.click(wnPanel + ' .lrow[data-k="m7"] .markdone');
    check(await page.$eval(wnPanel + ' .lrow[data-k="m7"]', (r) => r.classList.contains('done')), 'Mark done marks it', '');
    await page.reload();
    await page.waitForSelector(wnPanel + ' .lrow.mission', { timeout: 15000 });
    check(await page.$eval(wnPanel + ' .lrow[data-k="m7"]', (r) => r.classList.contains('done')), 'a mission marked done survives a reload', '');
    check(/1\/100/.test(await page.$eval('#subnav .chip[data-chip="missions"]', (b) => b.innerText)), 'and the Missions chip counts it: 1/100', '');
    check(!supabase.some((x) => /nn_mission/.test(x)), 'signed out, nothing goes to the account', supabase.join(', '));

    await page.click(wnPanel + ' .surprise');
    const landed = await page.waitForFunction(() => {
      const r = document.querySelector('#panel-whatnow .lrow.hl');
      if (!r) return false;
      const b = r.getBoundingClientRect();
      return b.top >= 0 && b.bottom <= innerHeight ? r.dataset.k : false;
    }, null, { timeout: 4000 }).then((h) => h.jsonValue(), () => null);
    check(!!landed, 'Surprise me scrolls the list to a highlighted mission', '');
    check(landed !== 'm7', 'and it is one you have not done', landed);
    check(await page.evaluate(() => document.activeElement && document.activeElement.closest('.lrow.hl') !== null), 'focus lands on it too', '');
    check(await page.$('.sheet-card') === null, 'no modal: the list itself moves', '');
    await page.screenshot({ path: path.join(SHOTS, 'live-whatnow-surprise.png') });

    await page.click(wnPanel + ' .lrow[data-k="m5"] .open');
    await page.waitForSelector('.sheet-card');
    const sheet = await page.$eval('.sheet-card', (c) => ({ h: c.querySelector('h2').textContent, p: c.querySelector('.pick-why').textContent, links: [...c.querySelectorAll('a.t')].map((a) => a.href) }));
    check(sheet.h.startsWith('5. ') && sheet.p === real.missions[4].paragraph, 'tapping a mission opens its paragraph', sheet.h);
    check(sheet.links.length >= 1 && sheet.links.every((u) => /^https?:/.test(u)), 'with its places, linked to their sites', JSON.stringify(sheet.links));
    await page.screenshot({ path: path.join(SHOTS, 'live-whatnow-mission.png') });
    await page.keyboard.press('Escape');

    /* signed in: the mark also goes to the account, and a failure costs nothing */
    await page.evaluate(() => localStorage.setItem('allday-auth', JSON.stringify({ access_token: 'a.b.c', refresh_token: 'r', expires_at: 4102444800, user: { id: 'u1', email: 'reader@example.com' } })));
    await page.reload();
    await page.waitForSelector(wnPanel + ' .lrow.mission', { timeout: 15000 });
    await page.click(wnPanel + ' .lrow[data-k="m9"] .markdone');
    await page.waitForTimeout(400);
    check(supabase.some((x) => /POST \/rest\/v1\/rpc\/nn_missions_done/.test(x)) && supabase.some((x) => /POST \/rest\/v1\/rpc\/nn_mission_set/.test(x)), 'signed in, marks are read from and written to the account', supabase.filter((x) => /nn_/.test(x)).join(', '));
    check(await page.$eval(wnPanel + ' .lrow[data-k="m9"]', (r) => r.classList.contains('done')), 'and the device copy stands either way', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('What Now, Tonight (live, a reader in Los Angeles)', async () => {
    const files = tonightFiles();
    const routes = [[/\/all-day\/data\/whatnow\.json/, files.events], [/\/all-day\/data\/music\.json/, files.music]];
    const { ctx, page, errors } = await newPage(browser, base, { timezoneId: 'America/Los_Angeles', routes });
    await page.goto(base + '/all-day/#whatnow/tonight');
    await page.waitForSelector(wnPanel + ' [data-sec="tonight"]', { timeout: 15000 });
    const keys = await page.$$eval(wnPanel + ' .card.event', (c) => c.map((x) => x.dataset.k));
    const ok = new Set(['e-ok-1700', 'e-ok-dup', 'e-ok-2345']);
    check(keys.length && keys.every((k) => ok.has(k)), 'Tonight lists only items after 5 pm today in America/New_York', keys.join(', '));
    check(keys.includes('e-ok-2345'), 'tonight’s late listing is there', keys.join(', '));
    check(!keys.includes('e-ok-dup2'), 'a listing posted twice shows once', keys.join(', '));
    const today = etParts(Date.now()).day;
    check(await page.$$eval(wnPanel + ' .card.event .dom', (d) => d.map((x) => x.textContent)).then((d) => d.every((x) => Number(x) === Number(today))), 'every date tile is today in Burlington', '');
    const artists = await page.$$eval(wnPanel + ' .artist', (a) => a.map((x) => x.innerText.replace(/\s+/g, ' ')));
    check(artists.length === 2 && /Tonight Band/.test(artists[0]) && /Tonight/.test(artists[0]) && /Later Band/.test(artists[1]), 'Playing this week: tonight’s and this week’s artists, soonest first, not next week’s', JSON.stringify(artists));
    check(/Played every porch party last summer\./.test(artists[0]) && /Folk/.test(artists[1]), 'the old Music tab’s why lines come along (the genre when there is no why)', '');
    check(await page.$(wnPanel + ' iframe') === null, 'nothing is embedded until you ask', '');
    await page.click(wnPanel + ' .artist .listen');
    const src = await page.$eval(wnPanel + ' .artist iframe', (f) => f.src);
    check(/bandcamp\.com\/EmbeddedPlayer\/album=1234567\//.test(src) && !/autoplay/.test(src), 'Listen builds that artist’s Bandcamp player, which does not autoplay', src);
    await page.click(wnPanel + ' .artist .listen');
    check(await page.$(wnPanel + ' iframe') === null, 'pressing it again takes the player away', '');
    check(await page.$(wnPanel + ' .caught') !== null, 'the list ends, and says so', '');
    await page.screenshot({ path: path.join(SHOTS, 'live-whatnow-tonight.png') });
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('What Now, deep links and wide', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { viewport: { width: 1280, height: 800 }, scheme: 'dark' });
    await page.goto(base + '/all-day/#whatnow/m42');
    check(await flashes(page, 'm42'), '#whatnow/m42 opens Missions and flashes mission 42', '');
    await page.screenshot({ path: path.join(SHOTS, 'live-whatnow-missions-desktop-dark.png') });
    await page.goto(base + '/all-day/?demo=1#whatnow/tonight');
    await page.reload();
    await page.waitForSelector(wnPanel + ' [data-sec="tonight"]', { timeout: 15000 });
    check(await page.$eval('#subnav .chip.on', (b) => /Tonight/.test(b.innerText)), '#whatnow/tonight opens Tonight', '');
    await page.screenshot({ path: path.join(SHOTS, 'demo-whatnow-tonight-desktop-dark.png') });
    await page.goto(base + '/all-day/?demo=1#whatnow/missions');
    await page.reload();
    await page.waitForSelector(wnPanel + ' .lrow.mission', { timeout: 15000 });
    check(await page.$$eval(wnPanel + ' .lrow.mission', (r) => r.length) === 6, 'the demo carries six missions', '');
    await page.click(wnPanel + ' .lrow[data-k="m2"] .markdone');
    await page.reload();
    await page.waitForSelector(wnPanel + ' .lrow.mission', { timeout: 15000 });
    check(!(await page.$eval(wnPanel + ' .lrow[data-k="m2"]', (r) => r.classList.contains('done'))) && !(await page.evaluate(() => localStorage.getItem('allday-missions'))), 'demo marks never reach localStorage', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });
}

/* ----------------------------------------------------------------- run */
const t0 = Date.now();
await mkdir(SHOTS, { recursive: true });
await staticChecks();
const { base, proc } = await serve();
const browser = await chromium.launch();
try {
  await matrix(browser, base);
  await deepLinks(browser, base);
  await theWire(browser, base);
  await theWhatNow(browser, base);
  await interactions(browser, base);
} finally {
  await browser.close();
  proc.kill();
}
const failed = results.filter((r) => !r.ok);
const lines = results.map((r) => (r.ok ? '  ok   ' : '  FAIL ') + r.name + (r.detail ? '\n         ' + r.detail : ''));
console.log(lines.join('\n'));
console.log('\n' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed, ' + Math.round((Date.now() - t0) / 1000) + 's. Shots in ' + path.relative(process.cwd(), SHOTS));
await writeFile(path.join(HERE, 'shots', 'report.txt'), lines.join('\n') + '\n');
process.exit(failed.length ? 1 : 0);
