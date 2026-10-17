// All Day — the shell's test matrix.
//
//   NODE_PATH=~/btownbrief/btownbrief.github.io/smoke/node_modules node all-day/tests/allday.spec.mjs
//   ONLY=shellFixes,boards …same…   (just those groups, while iterating)
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
// real contract and dated to the real clock, On Air's btown-tv and
// wire-audio files are the demo payloads re-dated to the real clock (the
// clip itself is two seconds of silence from tests/fixtures), the arcade's
// champions.json is the Games demo's, every leaderboard RPC answers an empty
// board unless a group says otherwise, pulse.json and games-catalog.json are
// the repo's own, and third-party pictures get a 1px PNG.

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

/* ------------------------------------------------------------ On Air's data */
/* btown-tv.json, tv-editions.json and the wire-audio index in their real
   shapes: the demo file's payloads, moved from its _anchor to today in
   Burlington. `audio` picks the clip state: 'today', 'yesterday' or 'none'. */
const onairCache = new Map();
async function onairFiles(opts = {}) {
  const audio = opts.audio || 'today';
  const key = audio + etKey(Date.now());
  if (onairCache.has(key)) return onairCache.get(key);
  const d = JSON.parse(await readFile(path.join(APP, 'data/demo/onair.json'), 'utf8'));
  const today = etKey(Date.now());
  const days = Math.round((Date.parse(today) - Date.parse(d._anchor)) / 86400000);
  const shift = (date) => dayMinus(date, -days);
  const secs = days * 86400;
  const tv = d.tv;
  tv.edition = shift(tv.edition);
  const vids = [tv.pick, ...tv.pick_more, ...tv.live, ...tv.shelves.flatMap((x) => [...x.items, ...(x.more || [])])];
  vids.forEach((v) => { v.d += secs; delete v.art; });
  d.tvEditions.editions.forEach((e) => {
    e.edition = shift(e.edition);
    [e.pick, ...e.shelves.flatMap((x) => x.items)].forEach((v) => { if (v) delete v.art; });
  });
  const clips = d.audio.clips.map((c) => ({ ...c, date: shift(c.date), file: shift(c.date) + '.mp3', script: shift(c.date) + '.txt', made: new Date().toISOString() }));
  const index = { v: 1, updated: new Date().toISOString(), clips: audio === 'none' ? [] : audio === 'yesterday' ? clips.slice(1) : clips };
  const files = { 'btown-tv.json': JSON.stringify(tv), 'tv-editions.json': JSON.stringify(d.tvEditions), 'index.json': JSON.stringify(index) };
  clips.forEach((c) => { files[c.script] = d.audio._script; });
  const out = { files, tv, index, today, mp3: await readFile(path.join(HERE, 'fixtures/silence.mp3')) };
  onairCache.set(key, out);
  return out;
}

/* the Games demo file: its champions.json answers the live champions fetch */
let gamesDemoP = null;
const gamesDemo = () => (gamesDemoP = gamesDemoP || readFile(path.join(APP, 'data/demo/games.json'), 'utf8').then(JSON.parse));

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
  const onair = await onairFiles(opts.onair);
  await page.route(/raw\.githubusercontent\.com\/btownbrief\/btown-brief\/(btown-tv|wire-audio)\/data\/(?:audio\/)?([\w.-]+)$/, (r) => {
    const name = r.request().url().match(/([\w.-]+)$/)[1];
    if (/\.mp3$/.test(name) && onair.index.clips.some((c) => c.file === name)) return r.fulfill({ status: 200, body: onair.mp3, contentType: 'audio/mpeg' });
    const f = onair.files[name];
    return f ? r.fulfill({ status: 200, body: f, contentType: /\.txt$/.test(name) ? 'text/plain' : 'application/json' }) : r.fulfill({ status: 404, body: '' });
  });
  const champions = opts.champions || (await gamesDemo()).champions;
  await page.route(/raw\.githubusercontent\.com\/btownbrief\/btownbrief\.github\.io\/champions-data\/data\/champions\.json$/,
    (r) => r.fulfill({ status: 200, body: JSON.stringify(champions), contentType: 'application/json' }));
  await page.route(/supabase\.co/, (r) => {
    const u = r.request().url();
    supabase.push(r.request().method() + ' ' + u.replace(/^https:\/\/[^/]+/, ''));
    if (/\/auth\/v1\/settings/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ external: { email: opts.authEmail !== false } }) });
    /* opts.auth(path, body, headers) answers Supabase Auth: { status, body } or undefined for the default */
    const ap = (u.match(/\/auth\/v1\/([\w?=&_-]+)/) || [])[1];
    if (ap && opts.auth) {
      const out = opts.auth(ap, JSON.parse(r.request().postData() || '{}'), r.request().headers());
      if (out !== undefined) return new Promise((res) => setTimeout(res, out.delay || 0))
        .then(() => r.fulfill({ status: out.status || 200, contentType: 'application/json', body: JSON.stringify(out.body || {}) })).catch(() => {});
    }
    /* a stored session trades its refresh token for a fresh access token on each visit */
    if (ap && /^token/.test(ap)) return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ access_token: 'a.b.c', refresh_token: 'r-next', expires_in: 3600, token_type: 'bearer', user: { id: 'u-1' } }) });
    const fn = (u.match(/\/rest\/v1\/rpc\/(\w+)/) || [])[1];
    if (fn && opts.rpc) {
      const out = opts.rpc(fn, JSON.parse(r.request().postData() || '{}'), r.request().headers());
      if (out && out.hang) return undefined;   // never answers: a stalled request
      const wrapped = out && typeof out.status === 'number';   // { status: 404, body } is an HTTP answer; a row may have its own status field
      if (out !== undefined) return r.fulfill({ status: wrapped ? out.status : 200, contentType: 'application/json', body: JSON.stringify(wrapped ? out.body : out) });
    }
    if (fn) return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
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
const LIVE = new Set(['wire', 'whatnow', 'onair', 'games', 'food', 'vintage']);

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
          if (demo && combo === COMBOS[3] && (tab === 'wire' || tab === 'onair' || tab === 'games')) await page.screenshot({ path: path.join(SHOTS, 'demo-' + tab + '-desktop.png') });
          if (!demo && combo === COMBOS[0] && (tab === 'wire' || tab === 'food' || tab === 'onair' || tab === 'games' || tab === 'vintage')) await page.screenshot({ path: path.join(SHOTS, 'live-' + tab + '.png') });
          if (!demo && combo === COMBOS[1] && (tab === 'onair' || tab === 'games')) await page.screenshot({ path: path.join(SHOTS, 'live-' + tab + '-dark.png') });
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
    const cases = [['wire', 'w13'], ['wire', 'y4'], ['watch', 'fm3'], ['food', 'r-demo-all-night-diner'], ['people', 'pp2'], ['whatnow', 'e-tn3'], ['vintage', 's-junktiques'], ['art', 'aw6'], ['onair', 'yt:demo-tv-003'], ['games', 'g:trivia-ladder'], ['games', 'champ:btown-riddle']];
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

/* ---------------------------------------------------------------- On Air */
const onairText = (page) => page.$eval('#panel-onair', (p) => p.innerText);
const podRows = (page) => page.$$eval('#panel-onair [data-show]', (rs) => rs.map((r) => [r.dataset.show, r.dataset.national || '']));
const tvCards = (page) => page.$$eval('#panel-onair [data-slot="tv"] .vcard', (cs) => cs.map((c) => [c.dataset.k, c.dataset.wider || '']));

async function onAir(browser, base) {
  await group('On Air, demo', async () => {
    const { ctx, page, errors, supabase } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#onair');
    await settle(page);
    await page.waitForSelector('#panel-onair [data-sec="past"]', { timeout: 8000 });
    check(await page.evaluate(() => document.querySelector('audio').paused && !document.querySelector('#panel-onair iframe')), 'nothing autoplays: the shell’s audio is paused and no frame is loaded', '');
    const toc = await page.$$eval('#subnav .chip', (cs) => cs.map((c) => c.innerText.trim()));
    check(JSON.stringify(toc) === JSON.stringify(['Out loud', 'Btown TV', 'Live', 'Podcasts', 'Past nights']), 'the chip row is a table of contents: Out loud, Btown TV, Live, Podcasts, Past nights', JSON.stringify(toc));
    const order = await page.$$eval('#panel-onair [data-sec]', (s) => s.map((x) => x.dataset.sec));
    check(JSON.stringify(order) === JSON.stringify(['brief', 'tv', 'live', 'pods', 'past']), 'the sections run in that order', JSON.stringify(order));
    await page.click('#subnav .chip[data-chip="pods"]');
    await page.waitForTimeout(600);
    check(await page.$eval('#panel-onair [data-sec="pods"]', (h) => { const r = h.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight / 2; }), 'a chip scrolls to its section', '');

    const localRows = await podRows(page);
    const localTv = await tvCards(page);
    check(localRows[0] && localRows[0][0] === 'btown-brief', 'Local: the Brief’s own show is first in Podcasts', JSON.stringify(localRows.slice(0, 3)));
    check(localRows.length > 2 && localRows.every((r) => !r[1]), 'Local: every local show, no national ones', JSON.stringify(localRows));
    check(localTv.length > 0 && localTv.every((c) => !c[1]), 'Local: Btown TV shows only the local picks', JSON.stringify(localTv));
    check((await page.$$eval('#panel-onair [data-slot="tv"] .vcard .s', (s) => s.map((x) => x.textContent))).some((t) => /reason|matters|Watch this first/.test(t)), 'each pick carries its reason', '');

    await toTop(page);
    await page.click('#subnav .localsw-half:not(.on)');
    await page.waitForTimeout(250);
    const everyRows = await podRows(page);
    const everyTv = await tvCards(page);
    check(everyTv.filter((c) => c[1]).length === 3 && everyTv.length === localTv.length + 3, 'Everything adds exactly three wider picks (' + localTv.length + ' + 3)', JSON.stringify(everyTv));
    check(JSON.stringify(everyTv.slice(0, localTv.length)) === JSON.stringify(localTv), 'and the local picks still lead', '');
    check(everyRows.filter((r) => r[1]).length === 2 && everyRows.length === localRows.length + 2, 'Everything adds exactly two national podcasts', JSON.stringify(everyRows));
    check(everyRows[0][0] === 'btown-brief', 'Everything: the Brief’s own show is still first', JSON.stringify(everyRows[0]));
    check(await page.$eval('#panel-onair [data-sec="tv"] h2', (h) => h.textContent) === 'Tonight, local and beyond', 'the TV head says local and beyond', '');

    /* a show opens in place, its newest episodes with a play pill each */
    const showId = everyRows[1][0];
    await page.click('#panel-onair [data-show="' + showId + '"] .t');
    const eps = await page.$$eval('#panel-onair [data-eps="' + showId + '"] .lrow', (r) => r.length);
    check(eps > 0 && eps <= 5, 'a show opens in place to its newest episodes (' + eps + ')', eps);
    check(await page.$eval('#panel-onair [data-show="' + showId + '"]', (r) => r.getAttribute('aria-expanded')) === 'true', 'and says it is open', '');

    /* Past nights opens that night's edition */
    await page.click('#panel-onair [data-night] .c-media');
    await page.waitForSelector('.sheet-card', { timeout: 3000 });
    check(await page.$$eval('.sheet-body .card.video', (c) => c.length) > 0 && /Play it on your TV/.test(await page.$eval('.sheet-body', (b) => b.innerText)), 'a past night opens its videos and its TV playlist', '');
    await page.keyboard.press('Escape');

    /* a reaction in the demo lives for the visit only */
    await page.click('#panel-onair [data-slot="tv"] .vcard [data-react="more"]');
    check(await page.$eval('#panel-onair [data-slot="tv"] .vcard [data-react="more"]', (b) => b.classList.contains('on')), 'demo: “more like this” lights', '');
    check(await page.evaluate(() => !localStorage.getItem('btown-tv-reacts')), 'demo: a reaction never reaches localStorage', '');
    check(!supabase.length, 'demo: no Supabase call', supabase.join(', '));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('On Air, live', async () => {
    const { files, tv, index, today } = await onairFiles();
    const { ctx, page, errors, supabase } = await newPage(browser, base);
    await page.goto(base + '/all-day/#onair');
    await page.waitForSelector('#panel-onair .audio', { timeout: 15000 });
    await page.waitForSelector('#panel-onair [data-sec="past"]', { timeout: 15000 });
    check(await page.evaluate(() => document.querySelector('audio').paused && document.getElementById('player').hidden), 'nothing autoplays', '');
    const eyebrow = await page.$eval('#panel-onair .audio .eyebrow', (e) => e.textContent);
    check(/^Today · /.test(eyebrow) && / · 3:27$/.test(eyebrow), 'today’s clip: the card says today and its length', eyebrow);
    check((await podRows(page))[0][0] === 'btown-brief', 'live: the Brief’s own show is first in Podcasts', '');
    check((await tvCards(page)).length === tv.shelves.find((x) => x.key === 'vt').items.length + 1, 'live: tonight’s local picks, the pick and the Burlington & Vermont shelf', '');
    await page.click('#panel-onair .btn.more:text("Read it instead")');
    await page.waitForFunction(() => /Good morning/.test(document.querySelector('.sheet-body')?.innerText || ''), null, { timeout: 4000 }).catch(() => {});
    check(/Good morning/.test(await page.$eval('.sheet-body', (b) => b.innerText)), '“Read it instead” shows the script the voice read', '');
    await page.keyboard.press('Escape');

    /* the player: the clip plays in the shell's one player and survives a tab switch */
    await page.click('#panel-onair .audio .pb');
    await page.waitForSelector('#player:not([hidden])', { timeout: 3000 }).catch(() => {});
    const src = await page.evaluate(() => document.querySelector('audio').getAttribute('src'));
    check(src === 'https://raw.githubusercontent.com/btownbrief/btown-brief/wire-audio/data/audio/' + today + '.mp3', 'play loads today’s MP3 from the wire-audio branch into the shell’s player', src);
    await goTab(page, 'wire');
    await goTab(page, 'food');
    check(await page.$('#player:not([hidden])') !== null && /news in/.test(await page.$eval('#p-title', (t) => t.textContent)), 'the player survives a tab switch', '');
    await goTab(page, 'onair');

    /* a reaction writes tv.html's key, tells Supabase, and survives a reload */
    const first = (await tvCards(page))[0][0];
    const vid = first.slice(3);
    await page.click('#panel-onair [data-k="' + first + '"] [data-react="watched"]');
    check(/Tomorrow’s edition/.test(await page.$eval('#toast', (t) => t.textContent)), 'a reaction says what it teaches', '');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('btown-tv-reacts') || '{}'));
    check(stored[vid] === 'watched', 'it is written to btown-tv-reacts, the key tv.html used', JSON.stringify(stored));
    check(supabase.some((x) => /\/rpc\/tv_react$/.test(x)), 'and sent to tv_react, so the editor sees it', supabase.join(', '));
    await page.reload();
    await page.waitForSelector('#panel-onair [data-k="' + first + '"] [data-react="watched"]', { timeout: 15000 });
    check(await page.$eval('#panel-onair [data-k="' + first + '"] [data-react="watched"]', (b) => b.classList.contains('on') && b.getAttribute('aria-pressed') === 'true'), 'a reaction persists across a reload', '');

    /* not for me: the editor's next local one steps in on the next draw */
    const bench = tv.shelves.find((x) => x.key === 'vt').more[0];
    const victim = (await tvCards(page))[1][0];
    await page.click('#panel-onair [data-k="' + victim + '"] [data-react="skip"]');
    await page.reload();
    await page.waitForSelector('#panel-onair [data-slot="tv"] .vcard', { timeout: 15000 });
    const after = (await tvCards(page)).map((c) => c[0]);
    check(!after.includes(victim) && after.includes('yt:' + bench.id), '“not for me” gives its place to the editor’s bench', JSON.stringify(after));
    check(/Stepped in/.test(await page.$eval('#panel-onair [data-k="yt:' + bench.id + '"]', (c) => c.innerText)), 'and the newcomer says so', '');
    await page.evaluate(() => localStorage.removeItem('btown-tv-reacts'));
    check(!errors.length, 'no console errors', errors.slice(0, 5).join(' | '));
    await ctx.close();
  });

  await group('On Air, Live is cameras', async () => {
    const JAZZ = ['Peaceful Autumn Village in Vermont with Relaxing Jazz 🍂 Smooth Jazz & Falling Leaves for Slow Days',
      'Peaceful Autumn Village in Vermont 🍂 Smooth & Relaxing Jazz at a Cozy Café for Slow Days ☕'];
    const { tv } = await onairFiles();
    check(JAZZ.every((t) => tv.live.some((v) => v.t === t)), 'the fixture carries the two jazz streams the live search found on 2026-10-16', '');
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/#onair');
    await page.waitForSelector('#panel-onair [data-slot="live"] .vcard', { timeout: 15000 });
    const titles = () => page.$$eval('#panel-onair [data-slot="live"] .vcard .t', (t) => t.map((x) => x.textContent));
    const local = await titles();
    check(local.includes('Church Street Market Place Live Stream') && local.includes('The lake, from ECHO') && local.includes('The ferry dock at King Street'),
      'Local: the pinned Church Street camera and the lake cams', JSON.stringify(local));
    check(!JAZZ.some((t) => local.includes(t)), 'Local: no “Relaxing Jazz” ambience streams', JSON.stringify(local));
    check(!local.some((t) => /football|Documentaries/.test(t)), 'Local: nothing off the Vermont shelf or the pinned roster', JSON.stringify(local));
    await toTop(page);
    await page.click('#subnav .localsw-half:not(.on)');
    await page.waitForTimeout(250);
    const every = await titles();
    check(!JAZZ.some((t) => every.includes(t)), 'Everything: still no ambience streams', JSON.stringify(every));
    check(every.some((t) => /football/.test(t)) && every.some((t) => /Documentaries/.test(t)), 'Everything: the other live streams come back', JSON.stringify(every));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('On Air, the audio card', async () => {
    for (const audio of ['none', 'yesterday']) {
      const { ctx, page, errors } = await newPage(browser, base, { onair: { audio } });
      await page.goto(base + '/all-day/#onair');
      await page.waitForSelector('#panel-onair [data-sec="tv"]', { timeout: 15000 });
      await page.waitForSelector('#panel-onair [data-sec="past"]', { timeout: 15000 });
      await page.waitForTimeout(300);
      const card = await page.$('#panel-onair .audio');
      const toc = await page.$$eval('#subnav .chip', (cs) => cs.map((c) => c.dataset.chip));
      if (audio === 'none') {
        check(!card && !toc.includes('brief') && !(await page.$('#panel-onair [data-sec="brief"]')), 'no clip: no audio card, no section, no chip', JSON.stringify(toc));
      } else {
        const y = dayMinus(etKey(Date.now()), 1);
        const eyebrow = await page.$eval('#panel-onair .audio .eyebrow', (e) => e.textContent);
        check(card && eyebrow.startsWith(nameOf(y)), 'no clip today: the latest one, with its date (' + nameOf(y) + ')', eyebrow);
        check(/Today’s lands at 7 am/.test(await onairText(page)), 'and it says when today’s lands', '');
      }
      check(!errors.length, audio + ': no console errors', errors.join(' | '));
      await ctx.close();
    }
  });
}

/* ------------------------------------------------------------ interactions */
/* -------------------------------------------------------------- Games */
const gmPanel = '#panel-games';
const gmText = (page) => page.$eval(gmPanel, (p) => p.innerText);
const CHAT = 'https://www.btownbrief.com/community/channels/photo-wall';
/* the repo's own catalog, with every game's dates moved so the newest went
   live `newest` days ago */
async function catalogAged(newest) {
  const cat = JSON.parse(await readFile(path.join(REPO, 'data/games-catalog.json'), 'utf8'));
  const today = etKey(Date.now());
  cat.games.forEach((g, i) => { g.first_seen = g.live_since = dayMinus(today, newest + i); });
  return cat;
}
const ROWS = (names) => names.map((n, i) => ({ name: n, score: 1000 - i * 10, player_id: '00000000-0000-4000-8000-' + String(i).padStart(12, '0') }));
const findMe = async (page, name) => {
  await page.fill(gmPanel + ' [data-you] input', name);
  await page.click(gmPanel + ' [data-you] button[type="submit"]');
  await page.waitForSelector(gmPanel + ' [data-you="found"], ' + gmPanel + ' [data-you="none"]', { timeout: 6000 });
};

async function theGames(browser, base) {
  await group('Games, live', async () => {
    const asked = [];
    const rpc = (fn, body) => {
      if (fn !== 'get_leaderboard') return undefined;
      asked.push(body);
      if (body.p_game === 'btown-wordle') return ROWS(['Ada W.', 'Cy F.', 'Juniper', 'Max T.', 'Lou B.', 'Ivy R.', 'Mo J.']);
      if (body.p_game === 'trivia-ladder') return ROWS(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', ' juniper ']);
      if (body.p_game === 'filed') return { status: 500, body: { message: 'boom' } };
      return [];
    };
    const { ctx, page, errors, supabase } = await newPage(browser, base, { rpc });
    await page.goto(base + '/all-day/#games');
    await page.waitForSelector(gmPanel + ' [data-you="ask"]', { timeout: 15000 });
    await page.waitForFunction((p) => !/Loading \d+ boards/.test(document.querySelector(p).innerText), gmPanel, { timeout: 15000 });
    const cat = JSON.parse(await readFile(path.join(REPO, 'data/games-catalog.json'), 'utf8'));
    const boards = cat.games.filter((g) => g.live && g.leaderboard).map((g) => g.slug);
    const month = etKey(Date.now()).slice(0, 7);
    check(asked.length === boards.length && asked.every((a) => a.p_month === month && boards.includes(a.p_game)),
      'one get_leaderboard call per live board, for this month in Burlington', asked.length + ' of ' + boards.length);
    check(!supabase.some((u) => /room_create|room_join|submit_score/.test(u)), 'the tab only ever reads', supabase.filter((u) => /room_|submit/.test(u)).join(', '));
    check(await page.$$eval(gmPanel + ' [data-me]', (n) => n.length) === 0, 'before a name, no row is marked as yours', '');
    const groups = await page.$$eval(gmPanel + ' [data-group]', (b) => b.map((x) => x.textContent));
    check(groups.length >= 3 && !groups.includes('Yours'), 'the boards come in the arcade’s own sections', groups.join(' / '));
    await page.click(gmPanel + ' [data-group="daily-puzzles"]');
    check(await page.$(gmPanel + ' [data-board="btown-wordle"]') !== null, 'a board with scores draws its rows', '');
    check(/No scores yet this month:/.test(await gmText(page)), 'boards with no scores yet are named in one line', '');
    await page.click(gmPanel + ' [data-group="arcade-action"]');
    check(/FILED!? \(didn’t load\)/i.test(await gmText(page)), 'a board that failed says so, and the rest still draw', '');

    await findMe(page, 'Nobody Here');
    const none = await page.$eval(gmPanel + ' [data-you]', (n) => n.innerText);
    check(/No score this month is under/.test(none) && /Nobody Here/.test(none), 'a name on no board says so plainly', none);
    check(await page.$$eval(gmPanel + ' [data-me]', (n) => n.length) === 0, 'and marks nothing', '');

    await page.click(gmPanel + ' [data-you] button');
    await findMe(page, 'Juniper');
    check(await page.$eval(gmPanel + ' [data-group].on', (b) => b.dataset.group) === 'yours', 'with a name on the boards, Yours opens first', '');
    const marked = await page.$$eval(gmPanel + ' [data-me]', (n) => n.map((x) => x.closest('[data-board]')?.dataset.board + ':' + x.querySelector('.rank').textContent));
    check(JSON.stringify(marked.sort()) === JSON.stringify(['btown-wordle:3', 'trivia-ladder:15']), 'after the name, the reader’s rows are marked, matched without case or spaces', JSON.stringify(marked));
    check(/outside the top ten/.test(await page.$eval(gmPanel + ' [data-board="trivia-ladder"] [data-me]', (n) => n.innerText)), 'a place past tenth is shown, and called that', '');
    const said = await page.$eval(gmPanel + ' [data-you]', (n) => n.innerText);
    check(/on 2 boards/.test(said) && /2 players use that name/.test(said), 'two different players under one name: it says some marks may be someone else’s', said);
    check(await page.evaluate(() => localStorage.getItem('allday-arcade-name')) === '"Juniper"', 'the name stays on this device', '');
    await page.reload();
    await page.waitForSelector(gmPanel + ' [data-you="found"]', { timeout: 15000 });
    check(true, 'and is still there after a reload', '');
    await page.click(gmPanel + ' [data-you] button:nth-of-type(2)');
    await page.waitForSelector(gmPanel + ' [data-you="ask"]');
    check(await page.$$eval(gmPanel + ' [data-me]', (n) => n.length) === 0, 'Forget it takes the marks away', '');

    const host = await page.$$eval(gmPanel + ' [data-pick]', (b) => b.map((x) => x.dataset.pick));
    const rooms = cat.games.filter((g) => g.rooms).map((g) => g.slug);
    check(rooms.length && JSON.stringify(host) === JSON.stringify(rooms), 'Challenge offers exactly the games the catalog says can host', host.join(', '));
    await page.click(gmPanel + ' [data-pick="' + rooms[rooms.length - 1] + '"]');
    const href = await page.$eval(gmPanel + ' [data-host]', (a) => [a.dataset.host, a.href, a.target]);
    check(href[0] === rooms[rooms.length - 1] && href[1] === 'https://play.btownbrief.com/' + rooms[rooms.length - 1] + '/' && href[2] === '', 'picking a game points Host at that game on the arcade, in the same tab', JSON.stringify(href));
    const doors = await page.$$eval(gmPanel + ' [data-door]', (a) => a.map((x) => [x.dataset.door, x.getAttribute('href')]));
    check(JSON.stringify(doors) === JSON.stringify([['community', CHAT], ['telegram', '../telegram.html']]), 'the chat door opens the Btown Arcade channel, with Telegram beside it', JSON.stringify(doors));
    check(await page.$(gmPanel + ' [data-chat] input, ' + gmPanel + ' [data-chat] textarea') === null, 'no chat is built here', '');
    const champs = await page.$$eval(gmPanel + ' [data-champs] [data-k]', (n) => n.length);
    check(champs === (await gamesDemo()).champions.games.length, 'Champions: the reigning champ on every board', champs);
    check(await page.$$eval(gmPanel + ' [data-royalty] .r', (n) => n.length) === 5, 'and the five all-arcade leaders', '');
    /* the one board stubbed to fail logs its 500, once per load; nothing else may */
    const other = errors.filter((e) => !/status of 500/.test(e));
    check(!other.length, 'no console errors beyond the board stubbed to fail', other.join(' | '));
    await ctx.close();
  });

  await group('Games, challenge fails soft', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/#games/challenge:queen-city-chess');
    await page.waitForSelector(gmPanel + ' [data-refused]', { timeout: 15000 });
    check(/can’t host a room right now/.test(await page.$eval(gmPanel + ' [data-refused]', (n) => n.textContent)), 'a game off the allowlist: that game can’t host a room right now', '');
    check(await page.$$eval(gmPanel + ' [data-pick]', (b) => b.length) > 0, 'and the ones that can are still offered', '');
    await page.goto(base + '/all-day/#games/challenge:church-street-checkers');
    await page.waitForFunction((p) => document.querySelector(p + ' [data-host]')?.dataset.host === 'church-street-checkers', gmPanel, { timeout: 8000 }).catch(() => {});
    check(await page.$eval(gmPanel + ' [data-host]', (a) => a.dataset.host) === 'church-street-checkers' && !(await page.$(gmPanel + ' [data-refused]')), 'an allowlisted game from a link is picked', '');
    await ctx.close();
    const cat = await catalogAged(40);
    cat.games.forEach((g) => { g.rooms = false; });
    const w = await newPage(browser, base, { routes: [[/\/data\/games-catalog\.json/, cat]] });
    await w.page.goto(base + '/all-day/#games/challenge');
    await w.page.waitForSelector(gmPanel + ' [data-challenge]', { timeout: 15000 });
    check(/No game can host a room right now/.test(await w.page.$eval(gmPanel + ' [data-challenge]', (n) => n.innerText)), 'with no game able to host, it says so instead of offering a dead button', '');
    check(!errors.length && !w.errors.length, 'no console errors', errors.concat(w.errors).join(' | '));
    await w.ctx.close();
  });

  await group('Games, one board stalls', async () => {
    const t = Date.now();
    const { ctx, page, errors } = await newPage(browser, base, { rpc: (fn, body) => (fn === 'get_leaderboard' && body.p_game === 'filed' ? { hang: true } : undefined) });
    await page.goto(base + '/all-day/#games/challenge');
    await page.waitForSelector(gmPanel + ' [data-sec="challenge"]', { timeout: 15000 });
    const landed = await page.waitForFunction((p) => { const r = document.querySelector(p + ' [data-sec="challenge"]').getBoundingClientRect(); return r.top >= 0 && r.top < 260; }, gmPanel, { timeout: 5000 }).then(() => true, () => false);
    check(landed && Date.now() - t < 7500, 'a deep link that needs only the catalog lands while a board is still stuck', (Date.now() - t) + 'ms');
    await page.waitForFunction((p) => /FILED!? \(didn’t load\)/i.test(document.querySelector(p).innerText), gmPanel, { timeout: 15000 }).catch(() => {});
    check(/FILED!? \(didn’t load\)/i.test(await gmText(page)), 'the stuck board gives up and says it didn’t load; the rest drew', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Games, new this month', async () => {
    const old = await catalogAged(31);
    const a = await newPage(browser, base, { routes: [[/\/data\/games-catalog\.json/, old]] });
    await a.page.goto(base + '/all-day/#games/new');
    await a.page.waitForSelector(gmPanel + ' [data-sec="new"]', { timeout: 15000 });
    check(/Nothing new this month/.test(await gmText(a.page)) && !(await a.page.$(gmPanel + ' [data-k^="new:"]')), 'nothing within 30 days: “nothing new this month”', '');
    await a.ctx.close();
    const fresh = await catalogAged(3);
    const b = await newPage(browser, base, { routes: [[/\/data\/games-catalog\.json/, fresh]] });
    await b.page.goto(base + '/all-day/#games/new');
    await b.page.waitForSelector(gmPanel + ' [data-k^="new:"]', { timeout: 15000 });
    const keys = await b.page.$$eval(gmPanel + ' [data-k^="new:"]', (n) => n.map((x) => x.dataset.k));
    const want = fresh.games.filter((g) => g.live && g.live_since > dayMinus(etKey(Date.now()), 30)).map((g) => 'new:' + g.slug);
    check(JSON.stringify(keys) === JSON.stringify(want), 'within 30 days: those games, newest first', keys.length + ' vs ' + want.length);
    check(b.page.url().endsWith('#games/new'), 'a #games/new link lands there', b.page.url());
    check(!a.errors.length && !b.errors.length, 'no console errors', a.errors.concat(b.errors).join(' | '));
    await b.ctx.close();
  });

  await group('Games, demo', async () => {
    const { ctx, page, errors, supabase } = await newPage(browser, base, { viewport: { width: 1280, height: 800 }, scheme: 'dark' });
    await page.goto(base + '/all-day/?demo=1#games');
    await page.waitForSelector(gmPanel + ' [data-you="ask"]', { timeout: 15000 });
    const chipsAt = await page.$$eval('#subnav .chip', (c) => c.map((x) => x.textContent));
    check(JSON.stringify(chipsAt) === JSON.stringify(['This month', 'Challenge', 'New', 'Party night', 'Champions']), 'the chip row is the table of contents', chipsAt.join(' / '));
    check(await page.$$eval(gmPanel + ' [data-me]', (n) => n.length) === 0, 'before a name, nothing is marked', '');
    await findMe(page, 'Juniper');
    check(await page.$$eval(gmPanel + ' [data-me]', (n) => n.length) === 3, 'the demo reader is on three boards', '');
    check(await page.evaluate(() => localStorage.getItem('allday-arcade-name')) === null, 'the demo keeps the name to the visit', '');
    const newRows = await page.$$eval(gmPanel + ' [data-k^="new:"]', (n) => n.length);
    check(newRows === 3, 'three new games', newRows);
    check(await page.$$eval(gmPanel + ' [data-k^="party:"]', (n) => n.length) >= 1, 'Party night lists its games', '');
    await page.click('#subnav .chip[data-chip="champs"]');
    await page.waitForTimeout(700);
    check(await page.evaluate(() => { const r = document.querySelector('#panel-games [data-sec="champs"]').getBoundingClientRect(); return r.top >= 0 && r.top < 300; }), 'a chip scrolls to its section', '');
    await page.screenshot({ path: path.join(SHOTS, 'demo-games-desktop-dark.png') });
    check(!supabase.length, 'the demo never calls Supabase', supabase.join(', '));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });
}

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
   Angeles, so "today after 5 pm" has to be Burlington's, not the reader's.
   The fixtures and the page share one frozen instant, 6:30 pm in Burlington
   today, so the test cannot straddle midnight or a clock change. */
const etOffset = (ms) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' }).formatToParts(new Date(ms)).find((x) => x.type === 'timeZoneName');
  const m = p && /GMT([+-]\d{2}:\d{2})/.exec(p.value);
  return m ? m[1] : '-05:00';
};
function tonightFiles(now) {
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
    const day = etKey(Date.now());
    const frozen = Date.parse(day + 'T18:30:00' + etOffset(Date.parse(day + 'T12:00:00Z')));
    const files = tonightFiles(frozen);
    const routes = [[/\/all-day\/data\/whatnow\.json/, files.events], [/\/all-day\/data\/music\.json/, files.music]];
    const { ctx, page, errors } = await newPage(browser, base, { timezoneId: 'America/Los_Angeles', routes });
    await page.clock.setFixedTime(frozen);
    await page.goto(base + '/all-day/#whatnow/tonight');
    await page.waitForSelector(wnPanel + ' [data-sec="tonight"]', { timeout: 15000 });
    const keys = await page.$$eval(wnPanel + ' .card.event', (c) => c.map((x) => x.dataset.k));
    const ok = new Set(['e-ok-1700', 'e-ok-dup', 'e-ok-2345']);
    check(keys.length === 3 && keys.every((k) => ok.has(k)), 'Tonight lists only items after 5 pm today in America/New_York', keys.join(', '));
    check(keys.includes('e-ok-2345'), 'tonight’s late listing is there', keys.join(', '));
    check(!keys.includes('e-ok-dup2'), 'a listing posted twice shows once', keys.join(', '));
    const today = etParts(frozen).day;
    check(await page.$$eval(wnPanel + ' .card.event .dom', (d) => d.map((x) => x.textContent)).then((d) => d.every((x) => Number(x) === Number(today))), 'every date tile is today in Burlington', '');
    const artists = await page.$$eval(wnPanel + ' .artist', (a) => a.map((x) => x.innerText.replace(/\s+/g, ' ')));
    check(artists.length === 2 && /Tonight Band/.test(artists[0]) && /Tonight/.test(artists[0]) && /Later Band/.test(artists[1]), 'Playing this week: tonight’s and this week’s artists, soonest first, not next week’s', JSON.stringify(artists));
    check(/Played every porch party last summer\./.test(artists[0]) && /Folk/.test(artists[1]), 'the old Music tab’s why lines come along (the genre when there is no why)', '');
    check(await page.$(wnPanel + ' iframe') === null, 'nothing is embedded until you ask', '');
    await page.click(wnPanel + ' .artist .listen');
    const src = await page.$eval(wnPanel + ' .artist iframe', (f) => f.src);
    check(/bandcamp\.com\/EmbeddedPlayer\/album=1234567\//.test(src) && !/autoplay/.test(src), 'Listen builds that artist’s Bandcamp player, which does not autoplay', src);
    const frame = await page.$eval(wnPanel + ' .artist iframe', (f) => ({ cls: f.className, r: getComputedStyle(f).borderRadius, h: Math.round(f.getBoundingClientRect().height), w: f.getBoundingClientRect().width === f.parentElement.getBoundingClientRect().width - parseFloat(getComputedStyle(f.parentElement).paddingLeft) - parseFloat(getComputedStyle(f.parentElement).paddingRight) }));
    check(frame.cls === 'embed bandcamp' && frame.r === '12px' && frame.h === 120 && frame.w, 'the player is the shell’s .embed: full width, the media radius, its own height', JSON.stringify(frame));
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
    await page.click(wnPanel + ' .chips.themes .chip[data-chip="eat"]');
    await page.evaluate(() => { location.hash = 'whatnow/m5'; });
    check(await flashes(page, 'm5'), 'a mission link lands even while the list is filtered to another theme', '');
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

    /* the demo moved to a winter evening keeps Burlington's wall clock:
       its 5:45 pm walk is still 5:45 pm, and sunset still reads 6:06 */
    const w = await newPage(browser, base);
    await w.page.clock.setFixedTime(Date.parse('2026-12-10T18:00:00-05:00'));
    await w.page.goto(base + '/all-day/?demo=1#whatnow/tonight');
    await w.page.waitForSelector(wnPanel + ' [data-sec="tonight"]', { timeout: 15000 });
    const wk = await w.page.$$eval(wnPanel + ' .card.event', (c) => c.map((x) => x.dataset.k));
    check(wk.includes('e-tn4') && wk.includes('e-tn3'), 'in December the demo’s 5:45 pm and 6 pm listings are still tonight', wk.join(', '));
    check(/6:06 sunset/.test(await w.page.$eval(wnPanel + ' .wx', (x) => x.innerText.replace(/\s+/g, ' '))), 'and its sunset still reads 6:06', '');
    check(!w.errors.length, 'no console errors', w.errors.join(' | '));
    await w.ctx.close();
  });
}

/* -------------------------------------------------------------- Food */
/* The expected answers are worked out here, from the same files the tab
   reads, with a small copy of food-lib's hours rules: the tab gets them
   through food-lib itself, so the two meeting is the check. */
const FDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const fMin = (s) => { if (!s) return null; const [h, m] = s.split(':').map(Number); return h * 60 + m; };
function fOpenAt(hours, day, mins) {
  for (const [o, c] of hours[day] || []) { const a = fMin(o), b = fMin(c); if (b > a ? mins >= a && mins < b : mins >= a) return true; }
  for (const [o, c] of hours[FDAYS[(FDAYS.indexOf(day) + 6) % 7]] || []) { const a = fMin(o), b = fMin(c); if (b <= a && mins < b) return true; }
  return false;
}
function fLatest(hours, day) {
  let l = null;
  for (const [o, c] of hours[day] || []) { const a = fMin(o), b = fMin(c); const e = b > a ? b : b + 1440; if (l === null || e > l) l = e; }
  return l;
}
async function foodData() {
  const R = JSON.parse(await readFile(path.join(REPO, 'data/restaurants.json'), 'utf8')).restaurants;
  const D = JSON.parse(await readFile(path.join(REPO, 'data/deals.json'), 'utf8')).deals;
  /* one row per place: duplicates by Google id or id fold into the record with the blurb */
  const worth = (r) => (r.blurb ? 4 : 0) + (r.hours_confidence === 'google' ? 2 : 0) + (r.place_id ? 1 : 0);
  const keep = new Map();
  R.filter((r) => r.id && r.name && !r.closed && !(r.closing && /temporar/i.test(r.closing.note || ''))).forEach((r) => {
    const k = r.place_id || 'id:' + r.id;
    const had = keep.get(k) || keep.get('id:' + r.id);
    if (!had) { const e = { r, aka: new Set([r.id]) }; keep.set(k, e); keep.set('id:' + r.id, e); return; }
    had.aka.add(r.id); if (worth(r) > worth(had.r)) had.r = r; keep.set('id:' + r.id, had);
  });
  const places = [...new Set(keep.values())].map(({ r, aka }) => ({ ...r, aka: [...aka] }));
  const deals = D.filter((d) => d.id && d.title && d.business && !d.retired && !d.conflict && /^\d{4}-\d{2}-\d{2}$/.test(String(d.last_verified || '')));
  return { places, deals };
}
function foodExpect({ places, deals }, day, mins) {
  const has = (r) => r.hours && Object.keys(r.hours).length && r.hours_confidence !== 'unverified';
  const open = (r) => has(r) && fOpenAt(r.hours, day, mins);
  const today = (d) => !d.days || d.days.includes(day);
  const at = (r) => deals.filter((d) => r.aka.includes(d.restaurant_id));
  const tests = {
    open, late: (r) => has(r) && (fLatest(r.hours, day) ?? -1) >= 1380, patio: (r) => r.patio === true && open(r),
    hh: (r) => at(r).some((d) => d.type === 'happy-hour' && today(d)), cheap: (r) => r.under_15 === true, deal: (r) => at(r).some(today),
  };
  const out = {};
  for (const k of Object.keys(tests)) out[k] = places.filter(tests[k]).map((r) => r.id);
  return out;
}

const foodPanel = '#panel-food';
async function foodFilter(page, k) {
  await page.click(foodPanel + ' .chips.filters .chip[data-chip="' + k + '"]');
  const more = await page.$(foodPanel + ' [data-sec="open"] .btn.more');
  if (more) await more.click();
  return page.evaluate((p) => ({
    rows: [...document.querySelectorAll(p + ' [data-sec="open"] .lrow.place')].map((r) => r.dataset.k.slice(2)),
    n: Number(document.querySelector(p + ' .chips.filters .chip.on .n')?.textContent),
  }), foodPanel);
}

/* An Instagram payload in the builder's shape: three food reels (one about
   to lapse), a food photo, and a reel from an account that is not food. */
function foodInstagram(withVideo) {
  const now = Math.floor(Date.now() / 1000);
  const oe = (s) => (now + s).toString(16).toUpperCase();
  const post = (h, code, hrsAgo, extra) => ({ h, ts: now - hrsAgo * 3600, i: 'https://scontent.example/' + code + '.jpg?stp=dst-jpg_e15_p480x480&oe=' + oe(4 * 86400),
    u: 'https://www.instagram.com/p/' + code + '/', w: 480, c: 'A post from ' + h, s: 'do', ...extra });
  const reel = (h, code, hrsAgo, life, f) => post(h, code, hrsAgo, { v: 1, ...(withVideo ? { vu: 'https://scontent.example/' + code + '.mp4?oe=' + oe(life), ve: now + life, vd: 12.4 } : {}), ...(f ? { f: 1 } : {}) });
  const posts = [reel('foambrewers', 'FoodReelA', 2, 30 * 3600, true), reel('eatvermont', 'FoodReelB', 5, 20 * 3600, true),
    reel('haymakerbunsbtv', 'FoodReelLapsing', 1, 600, true), post('waterworksvt', 'FoodPhoto', 3, { f: 1 }),
    reel('sunsetwatchersclub', 'NotFoodReel', 1, 30 * 3600, false)];
  return { generated: new Date().toISOString(), expires_hint_days: 4, handles: [...new Set(posts.map((p) => p.h))], posts };
}

async function theFood(browser, base) {
  const fd = await foodData();
  /* Friday, October 16, 2026, in Burlington; the reader is in Los Angeles */
  const NINE = Date.parse('2026-10-16T21:00:00-04:00');
  const ELEVEN = Date.parse('2026-10-16T23:00:00-04:00');
  const at9 = foodExpect(fd, 'fri', 21 * 60);
  const at11 = foodExpect(fd, 'fri', 23 * 60);
  const pick = fd.places.find((r) => r.place_id && r.hours_confidence === 'google' && (r.hours.fri || []).length === 1 &&
    r.hours.fri[0][1] === '22:00' && r.hours.fri[0][0] <= '20:00');

  await group('Food, Open now on a frozen Burlington clock (live, a reader in Los Angeles)', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { timezoneId: 'America/Los_Angeles' });
    await page.clock.setFixedTime(NINE);
    await page.goto(base + '/all-day/#food');
    await page.waitForSelector(foodPanel + ' .lrow.place', { timeout: 15000 });
    check(!!pick, 'the data has a place that closes at 10 pm on Fridays', '');
    const nine = await foodFilter(page, 'open');
    check(nine.rows.includes(pick.id), '9 pm Friday: ' + pick.name + ' is open', nine.rows.length);
    const row = await page.$eval(foodPanel + ' [data-k="r-' + pick.id + '"]', (r) => r.innerText);
    check(/Open until 10 pm/.test(row), 'and says it is open until 10 pm', row);
    check(nine.rows.length === at9.open.length && nine.n === at9.open.length, '9 pm: Open now lists exactly the places open then (' + at9.open.length + ')', nine.rows.length + ' rows, chip ' + nine.n);
    check(new Set(nine.rows).size === nine.rows.length, 'no place shows twice', '');
    await page.screenshot({ path: path.join(SHOTS, 'live-food-9pm.png') });

    /* every filter chip: its count, and the rows it draws, are the expected set */
    for (const k of ['late', 'patio', 'hh', 'cheap', 'deal', 'open']) {
      const got = await foodFilter(page, k);
      const want = at9[k];
      check(got.rows.length === want.length && got.n === want.length && want.every((id) => got.rows.includes(id)),
        'the ' + k + ' chip shows its ' + want.length + ' places and says so', got.rows.length + ' rows, chip ' + got.n);
    }
    const counts = new Set(['open', 'late', 'patio', 'hh', 'cheap', 'deal'].map((k) => at9[k].length));
    check(counts.size >= 4, 'the chips really do change the count', [...counts].join(', '));

    /* the Google link is the place's own, by its Google place id */
    await page.click(foodPanel + ' [data-k="r-' + pick.id + '"] .open');
    await page.waitForSelector('.sheet-body a.google');
    const g = await page.$eval('.sheet-body a.google', (a) => ({ href: a.href, text: a.textContent, target: a.target }));
    check(g.href.includes('query_place_id=' + encodeURIComponent(pick.place_id)) && /^https:\/\/www\.google\.com\/maps\//.test(g.href) && g.target === '_blank',
      '“Full reviews on Google” opens the place by its place id', g.href);
    check(/Full reviews on Google/.test(g.text), 'and says what it is', g.text);
    const sheet = await page.$eval('.sheet-body', (b) => b.innerText);
    check(/Today, Friday/.test(sheet) && /10 pm/.test(sheet), 'the sheet gives today’s hours in Burlington’s clock', sheet.slice(0, 200));
    check(!/[★☆]|\b\d(\.\d)?\s*(stars?|\/\s*5)\b|\brating\b/i.test(sheet), 'no stars, scores or ratings in the sheet', '');
    await page.keyboard.press('Escape');
    await page.click('.sheet-head .iconbtn').catch(() => {});

    /* two hours later the same place has closed and the list says so */
    await page.clock.setFixedTime(ELEVEN);
    await page.reload();
    await page.waitForSelector(foodPanel + ' .lrow.place', { timeout: 15000 });
    const eleven = await foodFilter(page, 'open');
    check(!eleven.rows.includes(pick.id), '11 pm Friday: ' + pick.name + ' has left Open now', '');
    check(eleven.rows.length === at11.open.length, '11 pm: Open now lists exactly the places open then (' + at11.open.length + ')', eleven.rows.length);
    check(at11.open.length < at9.open.length, 'fewer places are open at 11 than at 9', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Food, the deals deck (demo, noon)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.clock.setFixedTime(Date.parse('2026-10-16T12:00:00-04:00'));
    await page.goto(base + '/all-day/?demo=1#food/deals');
    await page.waitForSelector(foodPanel + ' .deck', { timeout: 15000 });
    const card = () => page.$eval(foodPanel + ' .deck', (d) => ({ k: d.dataset.k, eyebrow: d.querySelector('.eyebrow').textContent, h: d.querySelector('h3').textContent,
      verified: d.querySelector('.verified')?.textContent || '', on: d.querySelectorAll('.segs i.on').length, segs: d.querySelectorAll('.segs i').length }));
    const first = await card();
    check(first.k === 'd-demo-diner-coffee' && /^Happening now/.test(first.eyebrow), 'the deal happening now comes first', JSON.stringify(first));
    check(first.verified === 'Verified Oct 14', 'the card carries its verified date', first.verified);
    check(first.segs === 7 && first.on === 1, 'progress bars on top: six deals and the end card, the first lit', first.on + '/' + first.segs);
    await page.click(foodPanel + ' .deck .hit.r');
    const second = await card();
    check(second.k === 'd-demo-bistro-oysters' && second.on === 2 && /^Later today · 3 pm–5 pm$/.test(second.eyebrow), 'a tap on the right side turns to the next deal, the next one to start', JSON.stringify(second));
    check(/^Verified /.test(second.verified), 'its verified date is showing', second.verified);
    await page.click(foodPanel + ' .deck .hit.l');
    check((await card()).k === first.k, 'a tap on the left side goes back', '');
    const seen = [];
    for (let i = 0; i < 6; i++) { const c = await card(); seen.push(c); await page.click(foodPanel + ' .deck .hit.r'); }
    check(seen.every((c) => /^Verified [A-Z][a-z]{2} \d{1,2}$/.test(c.verified)), 'every deal card has its verified date', seen.map((c) => c.verified).join(', '));
    const end = await card();
    check(end.k === 'deals-end' && /That’s today/i.test(end.eyebrow), 'after the last deal, the deck says that’s today', JSON.stringify(end));
    await page.click(foodPanel + ' .deck .hit.r');
    check((await card()).k === first.k, 'and the next tap starts over', '');
    await page.evaluate(() => document.querySelector('#panel-food .deck').scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: path.join(SHOTS, 'demo-food-deck.png') });

    /* a Friday 10 pm to 2 am deal is still on at 12:30 on Saturday morning */
    await page.clock.setFixedTime(Date.parse('2026-10-17T00:30:00-04:00'));
    await page.reload();
    await page.waitForSelector(foodPanel + ' .deck', { timeout: 15000 });
    const late = await card();
    check(late.k === 'd-demo-taco-late' && late.eyebrow === 'Happening now · until 2 am', 'an overnight deal is still happening after midnight, and leads', JSON.stringify(late));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Food, kitchens in their own words (live)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    const ig = foodInstagram(true);
    const mp4 = [];
    await page.route(/\/all-day\/data\/instagram\.json/, (r) => r.fulfill({ status: 200, body: JSON.stringify(ig), contentType: 'application/json' }));
    await page.route(/scontent\.example\/.*\.mp4/, (r) => { mp4.push(r.request().url()); return r.fulfill({ status: 200, body: '', contentType: 'video/mp4' }); });
    await page.goto(base + '/all-day/#food/kitchens');
    await page.waitForSelector(foodPanel + ' .vcard.clip', { timeout: 15000 });
    const keys = await page.$$eval(foodPanel + ' [data-sec="kitchens"] .vcard', (c) => c.map((x) => x.dataset.k));
    check(JSON.stringify(keys) === JSON.stringify(['ig-FoodReelA', 'ig-FoodReelB']), 'the rail holds the food reels, newest first; a reel about to lapse and a non-food account are left out', keys.join(', '));
    check(await page.$$eval('video', (v) => v.length) === 0 && !mp4.length, 'before a tap: no video on the page and nothing fetched', mp4.join(', '));
    check(await page.$eval('#vbox', (b) => b.hidden), 'and the video box is closed', '');
    await page.click(foodPanel + ' [data-k="ig-FoodReelA"]');
    await page.waitForSelector('#vbox:not([hidden]) #vbox-frame video', { timeout: 4000 }).catch(() => {});
    const box = await page.evaluate(() => {
      const v = document.querySelector('#vbox-frame video');
      return v && { src: v.getAttribute('src'), controls: v.controls, autoplay: v.autoplay, open: document.getElementById('vbox-open').textContent, href: document.getElementById('vbox-open').href,
        frames: document.querySelectorAll('video').length, inBox: !!v.closest('#vbox') };
    });
    check(box && box.inBox && box.frames === 1 && box.src === ig.posts[0].vu, 'a tap plays the reel in the shell’s one video box', JSON.stringify(box));
    check(box && box.controls && !box.autoplay, 'with controls, and no autoplay attribute: the tap is what started it', JSON.stringify(box));
    check(box && /Open on Instagram/.test(box.open) && box.href === ig.posts[0].u, 'the box links to the post on Instagram', JSON.stringify(box));
    await page.screenshot({ path: path.join(SHOTS, 'live-food-clip.png') });
    await page.click('#vbox-close');
    const after = await page.evaluate(() => ({ videos: document.querySelectorAll('video').length, open: document.getElementById('vbox-open').textContent, ar: document.getElementById('vbox-frame').style.aspectRatio }));
    check(after.videos === 0 && /Open in YouTube/.test(after.open) && !after.ar, 'closing gives the box back as the shell left it', JSON.stringify(after));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();

    const p2 = await newPage(browser, base);
    await p2.page.route(/\/all-day\/data\/instagram\.json/, (r) => r.fulfill({ status: 200, body: JSON.stringify(foodInstagram(false)), contentType: 'application/json' }));
    await p2.page.goto(base + '/all-day/#food/kitchens');
    await p2.page.waitForSelector(foodPanel + ' [data-sec="kitchens"] .sec', { timeout: 15000 });
    await p2.page.waitForFunction((p) => !document.querySelector(p + ' [data-sec="kitchens"] .loading'), foodPanel);
    const txt = await p2.page.$eval(foodPanel + ' [data-sec="kitchens"]', (s) => s.innerText);
    const tiles = await p2.page.$$eval(foodPanel + ' [data-sec="kitchens"] .vcard', (c) => c.map((x) => x.dataset.k + (x.classList.contains('clip') ? ':clip' : '')));
    check(/No new videos from the kitchens/.test(txt) && tiles.length === 4 && !tiles.some((t) => /clip|NotFood/.test(t)),
      'with no videos it says so and shows the food accounts’ latest photos', tiles.join(', '));
    check(!p2.errors.length, 'no console errors', p2.errors.join(' | '));
    await p2.ctx.close();
  });

  await group('Food, the Weekly Bite and Feature a dish (live)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    const dish = { id: '11111111-2222-3333-4444-555555555555', storage_path: 'submissions/aaaa-bbbb.jpg', caption: 'The pho with extra basil, worth the walk', category: 'dish',
      area: 'Old North End', spot: pick.name, taken_on: '', credit: 'Sam', display_label: null, approved_on: '2026-10-15', votes: 7 };
    const sunset = { ...dish, id: '99999999-2222-3333-4444-555555555555', storage_path: 'submissions/cccc.jpg', caption: 'A sunset', category: 'sunsets', spot: '' };
    await page.route(/\/rest\/v1\/rpc\/btb_photos_get/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([sunset, dish]) }));
    const photo = await readFile(path.join(REPO, 'assets/icon-192.png'));   // a real picture: the resize step decodes it
    const sent = [];
    page.on('request', (q) => { if (q.method() === 'POST' && /supabase\.co\/(storage|rest\/v1\/rpc\/btb_photos_submit)/.test(q.url())) sent.push({ url: q.url(), body: q.postData() }); });
    await page.goto(base + '/all-day/#food');
    await page.waitForSelector(foodPanel + ' .hero[data-k="bite"]', { timeout: 15000 });
    const hero = await page.$eval(foodPanel + ' .hero[data-k="bite"]', (h) => h.innerText);
    check(/featured, not reviewed/i.test(hero) && hero.includes(dish.caption) && hero.includes(pick.name) && /sent in by Sam/.test(hero),
      'the Weekly Bite is the newest approved dish: its line, the place, the reader', hero);
    check(!/\b7\b/.test(hero) && !/vote|score|rating|★/i.test(hero), 'featured, never rated: no votes or score on it', hero);
    await page.click(foodPanel + ' .hero .btn:text("The place")');
    check(await page.$eval('.sheet-head h2', (h) => h.textContent) === pick.name, '“The place” opens the place it came from', '');
    await page.click('.sheet-head .iconbtn');

    /* the form: we feature, we don't review; nothing goes without consent */
    const form = foodPanel + ' form.dish';
    const add = await page.$eval(foodPanel + ' [data-sec="add"]', (s) => s.innerText);
    check(/We feature, we don’t review\./.test(add), 'the form says we feature, we don’t review', '');
    check(!/\b(rate|rating|stars? (out of|\/))\b/i.test(add), 'nothing on the form asks for a rating', '');
    await page.setInputFiles(form + ' input[type=file]', { name: 'dish.png', mimeType: 'image/png', buffer: photo });
    await page.fill(form + ' input[name=line]', 'The cold sesame noodles, every time');
    await page.fill(form + ' input[name=place]', pick.name);
    await page.click(form + ' .send');
    await page.waitForTimeout(400);
    const err = await page.$eval(form + ' .err', (e) => (e.hidden ? '' : e.textContent));
    check(/Tick the box/.test(err), 'without the consent box it refuses, and says why', err);
    check(!sent.length, 'and nothing was uploaded or queued', JSON.stringify(sent));
    await page.fill(form + ' input[name=line]', 'Worst noodles in town');
    await page.check(form + ' input[name=consent]');
    await page.click(form + ' .send');
    await page.waitForTimeout(200);
    check(/only feature what you’d recommend/.test(await page.$eval(form + ' .err', (e) => e.textContent)) && !sent.length, 'a line that reads as a takedown is turned back before it is sent', '');
    await page.fill(form + ' input[name=line]', 'The cold sesame noodles, every time');
    await page.click(form + ' .send');
    await page.waitForSelector('#toast:not([hidden])', { timeout: 6000 }).catch(() => {});
    const rpc = sent.find((x) => /btb_photos_submit/.test(x.url));
    const args = rpc ? JSON.parse(rpc.body) : {};
    check(sent.some((x) => /\/storage\/v1\/object\/btb-photos\/submissions\//.test(x.url)), 'with consent, the photo uploads to the photo queue’s bucket', JSON.stringify(sent.map((x) => x.url)));
    check(args.p_category === 'dish' && args.p_permission === true && args.p_spot === pick.name && args.p_caption === 'The cold sesame noodles, every time' && /^p_/.test(args.p_voter || ''),
      'and goes to the moderation queue as a dish, with consent, the place and the line', JSON.stringify(args));
    check(/Sent/.test(await page.$eval('#toast', (t) => t.textContent)), 'the reader is told it is in the queue', await page.$eval(form + ' .err', (e) => e.textContent));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();

    /* nobody approved yet: the slot invites the first one; the demo never sends */
    const d = await newPage(browser, base);
    await d.page.goto(base + '/all-day/#food');
    await d.page.waitForSelector(foodPanel + ' [data-k="bite"]', { timeout: 15000 });
    check(/starts with you/.test(await d.page.$eval(foodPanel + ' [data-k="bite"]', (h) => h.innerText)), 'with no dish approved, the Bite invites the first one', '');
    await d.ctx.close();
    const m = await newPage(browser, base);
    await m.page.goto(base + '/all-day/?demo=1#food/add');
    await m.page.waitForSelector(foodPanel + ' form.dish', { timeout: 15000 });
    await m.page.setInputFiles(form + ' input[type=file]', { name: 'dish.png', mimeType: 'image/png', buffer: PNG });
    await m.page.fill(form + ' input[name=line]', 'Morning buns');
    await m.page.fill(form + ' input[name=place]', 'Old North End bakery');
    await m.page.click(form + ' .send');
    check(/Tick the box/.test(await m.page.$eval(form + ' .err', (e) => e.textContent)), 'demo: the consent box is required there too', '');
    await m.page.check(form + ' input[name=consent]');
    await m.page.click(form + ' .send');
    check(/Demo: nothing was sent/.test(await m.page.$eval('#toast', (t) => t.textContent)) && !m.supabase.length, 'demo: nothing is sent anywhere', m.supabase.join(', '));
    check(!m.errors.length, 'no console errors', m.errors.join(' | '));
    await m.ctx.close();
  });

  await group('Food, deep links and the chip row', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { viewport: { width: 1280, height: 800 }, scheme: 'dark' });
    await page.goto(base + '/all-day/?demo=1#food/r-demo-noodle-counter');
    check(await flashes(page, 'r-demo-noodle-counter'), '#food/r-<id> lands on the place and flashes it', '');
    check(await page.$eval('.sheet-head h2', (h) => h.textContent).catch(() => '') === 'The noodle counter on Bank', 'and opens its sheet', '');
    await page.keyboard.press('Escape');
    await page.click('.sheet-head .iconbtn').catch(() => {});
    await toTop(page);
    const toc = await page.$$eval('#subnav .chip', (c) => c.map((x) => x.dataset.chip));
    check(JSON.stringify(toc) === JSON.stringify(['bite', 'open', 'deals', 'kitchens', 'add']), 'the chip row is the table of contents: Bite, Open now, Deals, Kitchens, Feature a dish', toc.join(', '));
    await page.click('#subnav .chip[data-chip="add"]');
    await page.waitForTimeout(700);
    const top = await page.$eval(foodPanel + ' [data-sec="add"]', (s) => s.getBoundingClientRect().top);
    check(top >= 0 && top < 260, 'a chip scrolls to its section', top);
    await page.screenshot({ path: path.join(SHOTS, 'demo-food-desktop-dark.png') });
    await page.goto(base + '/all-day/?demo=1#food/late');
    await page.reload();
    await page.waitForSelector(foodPanel + ' .chips.filters', { timeout: 15000 });
    check(await page.$eval(foodPanel + ' .chips.filters .chip.on', (c) => c.dataset.chip) === 'late', '#food/late opens Open now on the Open late filter', '');
    await page.goto(base + '/all-day/?demo=1#food/d-demo-pub-trivia');
    await page.reload();
    check(await flashes(page, 'd-demo-pub-trivia'), '#food/d-<id> turns the deck to that deal', '');
    await page.goto(base + '/all-day/?demo=1#food/r-not-a-place');
    await page.reload();
    await page.waitForSelector('#toast:not([hidden])', { timeout: 6000 }).catch(() => {});
    check(/isn’t in the guide/.test(await page.$eval('#toast', (t) => t.textContent)), 'an unknown place says so', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });
}

/* ------------------------------------------------------------- accounts */
/* The sign-in row's three states, live, with Supabase Auth answered here. */
const SESSION = (o = {}) => JSON.stringify({ access_token: 'a.b.c', refresh_token: 'r1', expires_at: o.expires || 4102444800, user: { id: 'u-1', ...(o.user || {}) } });
async function settingsText(page) {
  if (await page.$eval('#sheet', (x) => !x.hidden)) { await page.keyboard.press('Escape'); await page.waitForTimeout(50); }
  await page.click('#settings-btn');
  await page.waitForFunction(() => { const b = document.querySelector('.sheet-body'); return b && !/Checking…|One moment…/.test(b.innerText); }, null, { timeout: 6000 }).catch(() => {});
  return page.$eval('.sheet-body', (b) => b.innerText);
}
async function accounts(browser, base) {
  await group('accounts: the sign-in row, three states', async () => {
    const off = await newPage(browser, base, { authEmail: false });
    await off.page.goto(base + '/all-day/');
    await settle(off.page);
    check(/Sign in\s+Coming soon/.test(await settingsText(off.page)), 'Auth off in the project: "Sign in · Coming soon"', '');
    await off.ctx.close();

    const out = await newPage(browser, base);
    await out.page.goto(base + '/all-day/');
    await settle(out.page);
    const t = await settingsText(out.page);
    check(await out.page.$('.signin input[type=email]') !== null && /posting on a board and reporting do/.test(t), 'signed out: the email field, and what it is for', t.slice(0, 200));
    await out.ctx.close();

    /* the emailed link lands with tokens in the hash; /auth/v1/user names the reader */
    const seen = [];
    const inn = await newPage(browser, base, {
      auth: (p, body, h) => { seen.push(p + ' ' + (h.authorization || '')); if (/^user/.test(p)) return { body: { id: 'u-1', email: 'reader@example.com', aud: 'authenticated' } }; if (/^logout/.test(p)) return { status: 204 }; return undefined; },
      rpc: (fn) => (fn === 'nn_profile_get' ? { display_name: 'Maya R.', neighborhood: null, archetype: null } : undefined),
    });
    /* a token shaped like Supabase's: a JWT whose claims carry the email */
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const jwt = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: 'u-1', email: 'reader@example.com', role: 'authenticated', exp: 4102444800 }) + '.c2ln';
    await inn.page.goto(base + '/all-day/#access_token=' + jwt + '&refresh_token=r1&expires_in=3600&token_type=bearer&type=magiclink');
    await inn.page.waitForSelector('#toast:not([hidden])', { timeout: 6000 });
    check(/You’re signed in/.test(await inn.page.$eval('#toast', (x) => x.textContent)), 'the link signs the reader in, and says so without the address', '');
    check(await inn.page.evaluate(() => location.hash) === '#wire', 'the tokens leave the address bar', '');
    check(seen.some((x) => x === 'user Bearer ' + jwt), 'the token is checked with Supabase', seen.join(', '));
    const stored = await inn.page.evaluate(() => Object.keys(localStorage).map((k) => k + '=' + localStorage.getItem(k)));
    check(stored.length && !stored.some((v) => /@|eyJ|%40/.test(v)), 'nothing in localStorage holds an "@" or a JWT after sign-in', stored.filter((v) => /@|eyJ|%40/.test(v)).join(' | '));
    const kept = await inn.page.evaluate(() => localStorage.getItem('allday-auth'));
    check(kept && !/@/.test(kept) && JSON.stringify(Object.keys(JSON.parse(kept)).sort()) === '["refresh_token","user"]' && JSON.parse(kept).user.id === 'u-1',
      'storage keeps only the refresh token and the account id: no email, no access token (whose claims carry it)', kept);
    const t2 = await settingsText(inn.page);
    check(/Signed in\s+as Maya R\./.test(t2) && /Your profile/.test(t2) && /Your posts/.test(t2) && /Delete my account and posts/.test(t2), 'signed in: the name, profile, posts, delete', t2.slice(0, 300));
    check(!/reader@example\.com/.test(await inn.page.content()), 'the email is nowhere on the page', '');
    await inn.page.click('.sheet-body .sheet-row button:has-text("Sign out")');
    await inn.page.waitForTimeout(150);
    check(await inn.page.evaluate(() => localStorage.getItem('allday-auth')) === null && await inn.page.$('.signin input[type=email]') !== null, 'Sign out forgets the session and shows the email field again', '');
    check(seen.some((x) => /^logout/.test(x)), 'and tells Supabase', seen.join(', '));
    check(!inn.errors.length, 'no console errors', inn.errors.join(' | '));
    await inn.ctx.close();
  });

  await group('accounts: sessions refresh once, and an old email is dropped', async () => {
    let refreshes = 0;
    const { ctx, page, errors } = await newPage(browser, base, {
      auth: (p, body) => {
        if (/^token/.test(p)) { refreshes++; return body.refresh_token === 'r1' ? { body: { access_token: 'n.e.w', refresh_token: 'r2', expires_in: 3600, user: { id: 'u-1', email: 'reader@example.com' } } } : { status: 400, body: { error: 'invalid_grant' } }; }
        return undefined;
      },
    });
    await page.goto(base + '/all-day/?x=1');
    await page.evaluate((s) => localStorage.setItem('allday-auth', s), SESSION({ expires: Math.floor(Date.now() / 1000) + 60, user: { email: 'reader@example.com' } }));
    await page.goto(base + '/all-day/');
    await settle(page);
    const toks = await page.evaluate(() => import('/all-day/js/app.js').then((app) => Promise.all([app.token(), app.token(), app.token()])));
    check(toks.every((t) => t === 'n.e.w'), 'a session about to run out is refreshed', JSON.stringify(toks));
    check(refreshes === 1, 'once, however many callers ask at the same moment', refreshes);
    const kept = JSON.parse(await page.evaluate(() => localStorage.getItem('allday-auth')));
    check(kept.refresh_token === 'r2' && !('email' in kept.user) && !('access_token' in kept), 'the new refresh token is kept; the old saved email and access token are gone', JSON.stringify(kept));
    await page.evaluate((s) => localStorage.setItem('allday-auth', s), SESSION({ expires: Math.floor(Date.now() / 1000) + 60 }).replace('"r1"', '"spent"'));
    await page.reload();
    await settle(page);
    check(await page.evaluate(() => localStorage.getItem('allday-auth')) === null && await page.evaluate(() => import('/all-day/js/app.js').then((a) => a.user())) === null,
      'a refused refresh signs out quietly', '');
    check(refreshes === 2, 'one try for the spent token, no retries', refreshes);
    const real = errors.filter((e) => !/Failed to load resource: the server responded with a status of 400/.test(e));
    check(!real.length, 'no console errors beyond the browser logging the refused refresh', real.join(' | '));
    await ctx.close();
  });

  await group('accounts: a slow refresh cannot sign a reader back in', async () => {
    const { ctx, page, errors } = await newPage(browser, base, {
      auth: (p) => (/^token/.test(p) ? { delay: 900, body: { access_token: 'late.tok.en', refresh_token: 'r-late', expires_in: 3600, user: { id: 'u-1' } } } : undefined),
    });
    await page.goto(base + '/all-day/?x=1');
    await page.evaluate((s) => localStorage.setItem('allday-auth', s), SESSION());
    await page.goto(base + '/all-day/');
    await settle(page);
    const heard = await page.evaluate(() => import('/all-day/js/app.js').then((app) => {
      const seen = [];
      app.onAuth((u) => seen.push(u));
      app.signOut();                       // while the visit's refresh is still on its way
      return new Promise((res) => setTimeout(() => res({ seen, user: app.user(), kept: localStorage.getItem('allday-auth') }), 1400));
    }));
    check(heard.user === null && heard.kept === null, 'after Sign out the late answer is dropped: still signed out, nothing stored', JSON.stringify(heard));
    check(heard.seen.length === 1 && heard.seen[0] === null, 'and onAuth heard the sign-out once, nothing after', JSON.stringify(heard.seen));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('accounts: another tab switching accounts never borrows the old token', async () => {
    const sent = [];
    const { ctx, page, errors } = await newPage(browser, base, {
      auth: (p, body) => { if (/^token/.test(p)) { sent.push(body.refresh_token); return { body: { access_token: 'tok-' + body.refresh_token, refresh_token: body.refresh_token + '+', expires_in: 3600, user: { id: 'x' } } }; } return undefined; },
    });
    await page.goto(base + '/all-day/?x=1');
    await page.evaluate((s) => localStorage.setItem('allday-auth', s), SESSION());
    await page.goto(base + '/all-day/');
    await settle(page);
    const a = await page.evaluate(() => import('/all-day/js/app.js').then((app) => app.token()));
    check(a === 'tok-r1', 'tab one holds the first account’s token', a);
    const two = await ctx.newPage();
    await two.goto(base + '/all-day/?x=2');
    await two.evaluate(() => localStorage.setItem('allday-auth', JSON.stringify({ refresh_token: 'rB', user: { id: 'u-2' } })));
    await page.waitForTimeout(200);
    const b = await page.evaluate(() => import('/all-day/js/app.js').then((app) => app.token().then((t) => ({ t, id: app.user() && app.user().id }))));
    check(b.id === 'u-2' && b.t === 'tok-rB', 'after the other tab signs in as someone else, tab one drops the old token and fetches the new account’s', JSON.stringify(b));
    check(sent.includes('rB'), 'with the new account’s refresh token', sent.join(', '));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('accounts: before the SQL is pasted, posting says so', async () => {
    const missing = { status: 404, body: { code: 'PGRST202', message: 'Could not find the function' } };
    const { ctx, page, errors } = await newPage(browser, base, { rpc: (fn) => (/^nn_/.test(fn) ? missing : undefined) });
    await page.goto(base + '/all-day/?x=1');
    await page.evaluate((s) => localStorage.setItem('allday-auth', s), SESSION());
    await page.goto(base + '/all-day/');
    await settle(page);
    check(/Signed in\s+Posting is coming soon\./.test(await settingsText(page)), 'Settings: "Signed in · Posting is coming soon."', '');
    await page.keyboard.press('Escape');
    await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.compose({ board: 'vintage', kind: 'spotted', heading: 'Post a find' })));
    await page.waitForFunction(() => !/One moment/.test(document.querySelector('.sheet-body').innerText));
    check(/Posting is coming soon\. Everything else here works\./.test(await page.$eval('.sheet-body', (b) => b.innerText)), 'the compose sheet says the same, and offers no form', '');
    const l = await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.list('vintage').then((r) => ({ ok: r.ok, n: r.posts.length, err: r.error, status: b.status() }))));
    check(!l.ok && l.n === 0 && l.err === 'off' && l.status === 'off', 'a list resolves empty with "off", never throws', JSON.stringify(l));
    const real = errors.filter((e) => !/Failed to load resource: the server responded with a status of 404/.test(e));
    check(!real.length, 'no console errors beyond the browser logging the 404s (the reader sees none)', real.join(' | '));
    await ctx.close();
  });
}

/* --------------------------------------------------------------- boards */
/* The tab-facing API, driven in ?demo=1 against boards-fake.js, plus the
   live wire format. A test host feed is drawn at the top of the Vintage tab,
   the way a tab will draw one. */
const VMETA = (p) => [p.meta.shop, p.meta.size, p.meta.price != null ? '$' + p.meta.price : ''].filter(Boolean).join(' · ');
async function drawBoard(page, board, extra) {
  await page.evaluate(async ({ board, extra }) => {
    const B = await import('/all-day/js/boards.js');
    const app = await import('/all-day/js/app.js');
    let host = document.getElementById('board-test');
    if (!host) {
      host = document.createElement('div');
      host.className = 'feed';
      host.id = 'board-test';
      document.querySelector('.panel:not([hidden]) .panel-body').prepend(host);
      app.bindFeed(host);
    }
    host.innerHTML = '';
    const r = await B.list(board, extra || {});
    const meta = (p) => [p.meta.shop, p.meta.size, p.meta.price != null ? '$' + p.meta.price : ''].filter(Boolean).join(' · ');
    B.put(host, r.posts, { meta: board === 'vintage' ? meta : undefined });
  }, { board, extra });
}
const COMPOSE = { board: 'vintage', kind: 'spotted', heading: 'Post a find', title: 'What did you spot?',
  fields: [{ key: 'shop', label: 'Shop' }, { key: 'size', label: 'Size' }, { key: 'price', label: 'Price', type: 'int' }],
  notes: ['A find lasts three weeks, then it is gone.'] };
async function openCompose(page, o) {
  await page.evaluate((o) => import('/all-day/js/boards.js').then((b) => b.compose(o)), o || COMPOSE);
  await page.waitForSelector('.sheet-body form.bform, .sheet-body .linkrow', { timeout: 4000 });
}
const fakeOf = (page, fn) => page.evaluate(`import('/all-day/js/boards.js').then((B) => { const f = B._fake(); return (${fn})(f); })`);

async function boards(browser, base) {
  await group('boards: the profile, set and read (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#vintage');
    await settle(page);
    await openCompose(page);
    check(/Posting needs the email sign-in/.test(await page.$eval('.sheet-body', (b) => b.innerText)) && await page.$('.sheet-body form') === null, 'signed out, compose asks for sign-in and shows no form', '');
    await page.click('.sheet-body .linkrow button:has-text("Sign in")');
    await page.waitForSelector('.sheet-body .sheet-row button:has-text("Sign in")');
    await page.click('.sheet-body .sheet-row button:has-text("Sign in")');
    await page.waitForFunction(() => /Add your first name before you post/.test(document.querySelector('.sheet-body').innerText));
    check(true, 'Settings → Sign in signs into the demo account, which has no name yet', '');
    await page.click('.sheet-body .sheet-row button:has-text("Edit")');
    await page.waitForSelector('.sheet-body form.bform input[name=display_name]');
    await page.fill('input[name=display_name]', 'me@example.com');
    await page.click('.bform button[type=submit]');
    check(/no @ in it/.test(await page.$eval('.bf-msg', (m) => m.textContent)), 'an email as a name is refused', '');
    await page.fill('input[name=display_name]', '  Maya   R. ');
    await page.selectOption('select[name=neighborhood]', 'old-north-end');
    await page.click('.bform .pills button:has-text("Trail person")');
    await page.click('.bform button[type=submit]');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached' });
    const p = await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.profile()));
    check(p.ok && JSON.stringify(p.profile) === JSON.stringify({ display_name: 'Maya R.', neighborhood: 'old-north-end', archetype: 'trail' }), 'saved, tidied, and read back', JSON.stringify(p));
    check(/Signed in\s+as Maya R\./.test(await settingsText(page)), 'Settings names the reader by first name', '');
    await page.click('.sheet-body .sheet-row button:has-text("Edit")');
    await page.waitForSelector('input[name=display_name]');
    check(await page.$eval('input[name=display_name]', (i) => i.value) === 'Maya R.' && await page.$eval('select[name=neighborhood]', (s) => s.value) === 'old-north-end' &&
      await page.$eval('.bform .pills button.on', (b) => b.textContent) === 'Trail person', 'the profile sheet opens on what was saved', '');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'demo-profile.png') });
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('boards: compose refuses, then posts (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#vintage');
    await settle(page);
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    const before = await fakeOf(page, (f) => f.posts.length);
    await openCompose(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'demo-compose.png') });
    check(await page.$('input[name=display_name]') !== null, 'a reader with no name is asked for one in the sheet', '');
    await page.fill('input[name=title]', '1994 UVM crewneck');
    await page.fill('input[name="m:shop"]', 'Battery Street Jeans');
    await page.click('.bform button[type=submit]');
    check(/Add your first name before you post/.test(await page.$eval('.bf-msg', (m) => m.textContent)), 'no name: refused, with the reason', '');
    await page.fill('input[name=display_name]', 'Kara');
    await page.setInputFiles('.bform input[type=file]', { name: 'find.jpg', mimeType: 'image/jpeg', buffer: PNG });
    check(/find\.jpg/.test(await page.$eval('.bf-photo', (x) => x.textContent)), 'the chosen photo is named', '');
    await page.click('.bform button[type=submit]');
    check(/Tick the box first/.test(await page.$eval('.bf-msg', (m) => m.textContent)), 'a photo without the consent box: refused', '');
    const sent = await fakeOf(page, (f) => ({ posts: f.posts.length, photos: [...f.photos.keys()].filter((k) => !/^submissions\/demo-[a-z]+\.jpg$/.test(k)).length }));
    check(sent.posts === before && sent.photos === 0, 'and nothing was sent: no post, no photo', JSON.stringify(sent));
    await page.setInputFiles('.bform input[type=file]', []);
    await page.fill('input[name="m:size"]', 'L');
    await page.fill('input[name="m:price"]', '28');
    await page.fill('textarea[name=body]', 'Back rack by the boots. https://spam.example');
    await page.click('.bform button[type=submit]');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached', timeout: 4000 });
    check(/^Posted$/.test(await page.$eval('#toast', (t) => t.textContent)), 'posted, and the toast says so', await page.$eval('#toast', (t) => t.textContent));
    await drawBoard(page, 'vintage', { kind: 'spotted' });
    const card = await page.$eval('#board-test .card.board', (c) => ({ title: c.querySelector('.b-title').textContent, meta: c.querySelector('.b-meta') && c.querySelector('.b-meta').textContent,
      text: c.querySelector('.c-text').textContent, who: c.querySelector('.c-src').textContent, left: c.querySelector('.tag-left') && c.querySelector('.tag-left').textContent,
      del: !!c.querySelector('[data-act=bdelete]'), rep: !!c.querySelector('[data-act=breport]') }));
    check(card.title === '1994 UVM crewneck' && card.meta === 'Battery Street Jeans · L · $28', 'it is first on the board, with the tab’s meta line', JSON.stringify(card));
    check(card.who === 'Kara' && card.text === 'Back rack by the boots.' && /^2[01]d left$/.test(card.left), 'by first name, the link stripped, three weeks to run', JSON.stringify(card));
    check(card.del && !card.rep, 'your own post offers delete, not report', JSON.stringify(card));
    await pageRules(page, 'boards', 390);
    await page.screenshot({ path: path.join(SHOTS, 'demo-board-cards.png') });
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('boards: votes, reports, delete, expiry (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { viewport: { width: 1280, height: 800 }, scheme: 'dark' });
    await page.goto(base + '/all-day/?demo=1#vintage');
    await settle(page);
    await drawBoard(page, 'vintage');
    const first = '#board-test .card.board:first-child';
    const n0 = Number(await page.$eval(first + ' [data-act=bvote] .n', (n) => n.textContent || 0));
    await page.click(first + ' [data-act=bvote]');
    await page.waitForTimeout(100);
    const v1 = await page.$eval(first + ' [data-act=bvote]', (b) => ({ n: Number(b.querySelector('.n').textContent || 0), on: b.getAttribute('aria-pressed') }));
    check(v1.n === n0 + 1 && v1.on === 'true', 'signed out, a vote counts (the device’s vote) and the arrow fills', JSON.stringify([n0, v1]));
    await drawBoard(page, 'vintage');
    check(await page.$eval(first + ' [data-act=bvote]', (b) => b.getAttribute('aria-pressed')) === 'true', 'and it is still yours when the board redraws', '');
    await page.click(first + ' [data-act=bvote]');
    await page.waitForTimeout(100);
    check(Number(await page.$eval(first + ' [data-act=bvote] .n', (n) => n.textContent || 0)) === n0, 'unvote takes it back', '');
    await page.click(first + ' [data-act=breport]');
    check(/Reporting needs the email sign-in/.test(await page.$eval('#toast', (t) => t.textContent)), 'signed out, report asks for sign-in', '');

    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    const target = await page.$eval(first, (c) => c.dataset.k.slice(2));
    await fakeOf(page, `(f) => { f.as('demo-0000-4000-8000-0000000other').call('nn_report', { p_post: '${target}', p_reason: 'spam' }); return 1; }`);
    await page.click(first + ' [data-act=breport]');
    await page.waitForSelector('.sheet-card[aria-label="Report this post"]');
    await page.click('.sheet-body .sheet-row:nth-child(3) button');
    await page.waitForTimeout(150);
    check(/It’s down until Stephen has a look/.test(await page.$eval('#toast', (t) => t.textContent)), 'the second report takes it down, and says so', await page.$eval('#toast', (t) => t.textContent));
    check(!(await page.$('#board-test .card.board[data-k="b-' + target + '"]')), 'its card leaves the board at once', '');
    await drawBoard(page, 'vintage');
    check(!(await page.$('#board-test .card.board[data-k="b-' + target + '"]')), 'and it is not listed again', '');
    const again = await page.evaluate((id) => import('/all-day/js/boards.js').then((b) => b.vote(id)), target);
    check(!again.ok && again.error === 'not_found', 'a hidden post cannot be voted on', JSON.stringify(again));

    const mine = await page.evaluate(() => import('/all-day/js/boards.js').then(async (b) => {
      await b.setProfile({ display_name: 'Sam' });
      const r = await b.create('watch', { kind: 'rating', title: 'Winter Light', meta: { stars: 5, year: 2024 } });
      return r.post.id;
    }));
    await drawBoard(page, 'watch');
    await page.click('#board-test .card.board[data-k="b-' + mine + '"] [data-act=bdelete]');
    await page.click('#confirm [data-yes]');
    await page.waitForTimeout(150);
    check(!(await page.$('#board-test .card.board[data-k="b-' + mine + '"]')) && /Deleted/.test(await page.$eval('#toast', (t) => t.textContent)), 'delete-own asks, then removes it', '');
    const still = await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.mine()));
    check(still.ok && !still.posts.length, 'and Your posts no longer has it', JSON.stringify(still.posts.map((p) => p.title)));

    const old = await page.$eval('#board-test .card.board:first-child', (c) => c.dataset.k.slice(2));
    await fakeOf(page, `(f) => { f.posts.find((p) => p.id === '${old}').expires_at = Date.now() - 1000; return 1; }`);
    await drawBoard(page, 'watch');
    check(!(await page.$('#board-test .card.board[data-k="b-' + old + '"]')), 'an expired post is not listed', '');
    await pageRules(page, 'boards', 1280);
    await page.screenshot({ path: path.join(SHOTS, 'demo-board-desktop-dark.png') });
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('boards: Your posts, and delete my account (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { motion: 'reduce' });
    await page.goto(base + '/all-day/?demo=1#art');
    await settle(page);
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.evaluate(() => import('/all-day/js/boards.js').then(async (b) => {
      await b.setProfile({ display_name: 'Jess' });
      await b.create('vintage', { kind: 'swap', title: 'Two band tees for denim', meta: { want: 'Denim, 32' } });
    }));
    await openCompose(page, { board: 'art', kind: 'photo', heading: 'Add a photo', title: 'What is it?', body: false, notes: ['Photos are checked before they show.'] });
    await page.fill('input[name=title]', 'Oakledge, low water');
    await page.click('.bform button[type=submit]');
    check(/This one needs a photo/.test(await page.$eval('.bf-msg', (m) => m.textContent)), 'an Art photo without a photo: refused', '');
    await page.setInputFiles('.bform input[type=file]', { name: 'dawn.jpg', mimeType: 'image/jpeg', buffer: PNG });
    await page.check('.bform input[name=consent]');
    await page.click('.bform button[type=submit]');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached', timeout: 4000 });
    check(/The photo shows once it’s been checked/.test(await page.$eval('#toast', (t) => t.textContent)), 'with a photo and consent: posted, the photo waits for the queue', await page.$eval('#toast', (t) => t.textContent));
    const orphan = await page.evaluate(() => import('/all-day/js/boards.js').then(async (b) => {
      const f = b._fake();
      const ban = f.bans; ban.set('demo-0000-4000-8000-00000000me00', Date.now());
      const r = await b.create('art', { kind: 'art', title: 'Refused', photo: new Blob(['x']), consent: true });
      ban.delete('demo-0000-4000-8000-00000000me00');
      await new Promise((res) => setTimeout(res, 50));
      const last = [...f.photos.entries()].pop();
      return { error: r.error, path: last[0], status: last[1].status };
    }));
    check(orphan.error === 'banned' && orphan.status === 'removed', 'a photo whose post is refused is taken back out of the queue', JSON.stringify(orphan));
    const listed = await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.list('art').then((r) => r.posts.some((p) => p.title === 'Oakledge, low water'))));
    check(!listed, 'an Art post is not on the wall until its photo is approved', '');
    await settingsText(page);
    await page.click('.sheet-body .sheet-row button:has-text("Open")');
    await page.waitForSelector('.sheet-row.mine');
    const rows = await page.$$eval('.sheet-row.mine', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')));
    check(rows.length === 2 && /Oakledge, low water.*Art · Live · photo waiting for a check/.test(rows[0]) && /Two band tees.*Vintage · Live · 2[01]d left/.test(rows[1]), 'Your posts lists both, with where each stands', JSON.stringify(rows));
    await page.screenshot({ path: path.join(SHOTS, 'demo-your-posts.png') });
    await settingsText(page);
    await page.click('.sheet-body button:has-text("Delete my account and posts")');
    check(/Your email sign-in is shared/.test(await page.$eval('#confirm', (c) => c.innerText)), 'delete asks first, and says the shared sign-in stays', '');
    await page.click('#confirm [data-yes]');
    await page.waitForTimeout(200);
    const after = await fakeOf(page, `(f) => ({ posts: f.posts.filter((p) => p.user_id === 'demo-0000-4000-8000-00000000me00').length, profile: f.profiles.has('demo-0000-4000-8000-00000000me00') })`);
    check(after.posts === 0 && !after.profile, 'everything of theirs is gone', JSON.stringify(after));
    check(/Deleted\. You’re signed out\./.test(await page.$eval('#toast', (t) => t.textContent)) && await page.evaluate(() => import('/all-day/js/app.js').then((a) => a.user())) === null, 'and they are signed out', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('boards: what goes over the wire (live)', async () => {
    const calls = [];
    const post = { id: '0000aaaa-0000-4000-8000-000000000001', board: 'vintage', kind: 'spotted', title: 'Red barn jacket', body: '', place: '', meta: { shop: 'Old Gold', size: 'M', price: 45 },
      photo: 'submissions/abcd-1234.jpg', author: 'Kara', author_arch: null, created_at: new Date(Date.now() - 3600000).toISOString(), expires_at: new Date(Date.now() + 20 * 86400000).toISOString(), votes: 3, voted: false, mine: false };
    const { ctx, page, errors } = await newPage(browser, base, {
      rpc: (fn, args, h) => {
        if (!/^nn_/.test(fn)) return undefined;
        calls.push({ fn, args, auth: h.authorization || null });
        if (fn === 'nn_posts_list') return [post];
        if (fn === 'nn_vote') return { votes: 4, voted: true };
        if (fn === 'nn_report') return { status: 400, body: { code: 'P0001', message: 'already_reported' } };
        if (fn === 'nn_profile_get') return { display_name: 'Maya', neighborhood: null, archetype: null };
        return undefined;
      },
    });
    await page.goto(base + '/all-day/#wire');
    await settle(page);
    await drawBoard(page, 'vintage', { kind: 'spotted', meta: { size: 'M' } });
    const list = calls.find((c) => c.fn === 'nn_posts_list');
    check(list && list.auth === null && list.args.p_board === 'vintage' && JSON.stringify(list.args.p_filter) === '{"kind":"spotted","meta":{"size":"M"}}' && /^p_/.test(list.args.p_player),
      'signed out: the list goes with the device’s player id and no token', JSON.stringify(list));
    const img = await page.$eval('#board-test .card.board .c-media img', (i) => i.getAttribute('src'));
    check(img === 'https://jnouvwxomrcffqwilqkq.supabase.co/storage/v1/object/public/btb-photos/submissions/abcd-1234.jpg', 'an approved photo is drawn from the public bucket', img);
    await page.click('#board-test [data-act=bvote]');
    await page.waitForTimeout(200);
    check(await page.$eval('#board-test [data-act=bvote] .n', (n) => n.textContent) === '4', 'the vote adopts the server’s count', '');
    check(calls.some((c) => c.fn === 'nn_vote' && c.auth === null && c.args.p_post === post.id), 'signed out, nn_vote goes without a token', '');
    await page.evaluate((s) => localStorage.setItem('allday-auth', s), SESSION());
    await page.reload();
    await settle(page);
    await drawBoard(page, 'vintage');
    await page.click('#board-test [data-act=breport]');
    await page.waitForSelector('.sheet-card[aria-label="Report this post"]');
    await page.click('.sheet-body .sheet-row:first-of-type button');
    await page.waitForTimeout(250);
    check(/already reported this one/.test(await page.$eval('#toast', (t) => t.textContent)), 'a refusal from the server becomes its sentence', await page.$eval('#toast', (t) => t.textContent));
    check(calls.some((c) => c.fn === 'nn_report' && c.auth === 'Bearer a.b.c' && c.args.p_reason === 'spam'), 'signed in, a report carries the reader’s token', JSON.stringify(calls.filter((c) => c.fn === 'nn_report')));
    check(!calls.some((c) => /@/.test(JSON.stringify(c.args))), 'no call carries an email', '');
    const real = errors.filter((e) => !/Failed to load resource: the server responded with a status of 400/.test(e));
    check(!real.length, 'no console errors beyond the browser logging the refusal', real.join(' | '));
    await ctx.close();
  });
}

async function boardPhotos(browser, base) {
  await group('boards: a Vintage photo stays out of the gallery; an Art photo joins it (live)', async () => {
    const sent = [];
    const { ctx, page, errors } = await newPage(browser, base, {
      rpc: (fn, args) => {
        if (fn === 'btb_photos_submit') { sent.push(args); return null; }
        if (fn === 'nn_profile_get') return { display_name: 'Kara', neighborhood: 'downtown', archetype: null };
        if (fn === 'nn_post_create') return { id: '0000bbbb-0000-4000-8000-00000000000' + sent.length, board: args.p_board, kind: args.p_kind, title: args.p_title, status: 'approved' };
        return undefined;
      },
    });
    await page.goto(base + '/all-day/?x=1');
    await page.evaluate((s) => localStorage.setItem('allday-auth', s), SESSION());
    await page.goto(base + '/all-day/#vintage');
    await settle(page);
    const r = await page.evaluate(() => import('/all-day/js/boards.js').then(async (b) => {
      const c = document.createElement('canvas'); c.width = 8; c.height = 8; c.getContext('2d').fillRect(0, 0, 8, 8);
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      const file = new File([blob], 'find.png', { type: 'image/png' });
      const v = await b.create('vintage', { kind: 'spotted', title: 'Red barn jacket', meta: { shop: 'Old Gold' }, photo: file, consent: true });
      const a = await b.create('art', { kind: 'photo', title: 'North Beach at dawn', photo: file, consent: true });
      return [v.ok, a.ok];
    }));
    check(r[0] && r[1], 'both posts go through', JSON.stringify(r));
    const [v, a] = sent;
    check(v && v.p_category === 'board' && v.p_spot === 'All Day · Vintage' && v.p_permission === true && v.p_area === 'Downtown / Church St',
      'Vintage files its photo as category "board", which the gallery leaves out', JSON.stringify(v));
    check(a && a.p_category === 'other' && a.p_spot === 'All Day · Art', 'Art files its photo as "other": it joins the gallery', JSON.stringify(a));
    check(sent.every((x) => /^submissions\/[A-Za-z0-9-]+\.jpg$/.test(x.p_path) && x.p_name === 'Kara' && !/@/.test(JSON.stringify(x))), 'resized to a jpeg, credited by first name, no email', JSON.stringify(sent.map((x) => x.p_path)));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });
}

/* -------------------------------------------------------------- Vintage */
/* The Vintage tab on boards.js: finds, swaps and fit checks in ?demo=1
   against boards-fake.js, the shop guide and the designs rail from the
   repo's own built files, and the live wire format. */
const vintageShops = () => readFile(path.join(REPO, 'data/vintage-shops.json'), 'utf8').then(JSON.parse);
const vintageDesigns = () => readFile(path.join(APP, 'data/merch-designs.json'), 'utf8').then(JSON.parse);
const vslot = (k) => '.panel:not([hidden]) [data-sec="' + k + '"]';
const thanksOf = (page) => page.$eval(vslot('spotted') + ' [data-thanks]', (p) => ({ n: Number(p.dataset.thanks), text: p.textContent }));
async function vintageDemo(browser, base, opts) {
  const o = await newPage(browser, base, opts);
  await o.page.goto(base + '/all-day/?demo=1#vintage');
  await settle(o.page);
  await o.page.waitForSelector(vslot('spotted') + ' [data-grid="spotted"]');
  return o;
}
const signInAs = (page, name) => page.evaluate((n) => import('/all-day/js/auth.js').then((a) => a.demoSignIn())
  .then(() => import('/all-day/js/boards.js')).then((b) => b.setProfile({ display_name: n })), name);

async function theVintage(browser, base) {
  await group('Vintage, signed out: the finds show, posting asks for the sign-in (demo)', async () => {
    const { ctx, page, errors, supabase } = await vintageDemo(browser, base);
    const grids = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.panel:not([hidden]) [data-grid]')].map((g) => [g.dataset.grid, g.querySelectorAll('.card.board').length])));
    check(grids.spotted === 8 && grids.swaps === 3 && grids.fit === 3 && grids.sent === 1, 'eight finds, three swaps, three fit checks and one design sent in, from the demo', JSON.stringify(grids));
    const lefts = await page.$$eval(vslot('spotted') + ' .card.board', (cs) => cs.map((c) => (c.querySelector('.tag-left') || {}).textContent || ''));
    check(lefts.every((t) => /^\d+d left$/.test(t)) && new Set(lefts).size > 4, 'every find shows its days left, and they differ', JSON.stringify(lefts));
    const votes = await page.$$eval(vslot('spotted') + ' [data-act=bvote]', (bs) => bs.map((b) => b.getAttribute('aria-label')));
    check(votes.every((v) => v === 'I’d want this'), 'the vote on a find is “I’d want this”', JSON.stringify(votes.slice(0, 2)));
    check(!(await page.$(vslot('spotted') + ' [data-act=vgot]')), 'nobody signed in owns a find, so no “Someone got it”', '');
    const chipsRow = await page.$$eval('#subnav .chip', (cs) => cs.map((c) => c.dataset.chip));
    check(JSON.stringify(chipsRow) === JSON.stringify(['spotted', 'shops', 'swaps', 'tees', 'fit']), 'the chip row is the table of contents: Spotted, Shops, Swaps, Make a tee, Fit check', JSON.stringify(chipsRow));
    await page.click('#subnav .chip[data-chip="swaps"]');
    await page.waitForTimeout(700);
    const swapTop = await page.$eval(vslot('swaps'), (s) => Math.round(s.getBoundingClientRect().top));
    check(swapTop >= 0 && swapTop < 300, 'a chip scrolls its section up under the mast', swapTop);
    await page.click(vslot('spotted') + ' .addrow button');
    await page.waitForSelector('.sheet-body .linkrow');
    check(/Posting needs the email sign-in/.test(await page.$eval('.sheet-body', (b) => b.innerText)) && !(await page.$('.sheet-body form')), 'Post a find, signed out: the sign-in note and no form', '');
    await page.click('.sheet-head .iconbtn');
    await page.click(vslot('fit') + ' .addrow button');
    await page.waitForSelector('.sheet-body .linkrow');
    check(/Posting needs the email sign-in/.test(await page.$eval('.sheet-body', (b) => b.innerText)) && !(await page.$('.sheet-body form')), 'Post a fit check, signed out: the same', '');
    await page.click('.sheet-head .iconbtn');
    await page.click(vslot('make') + ' .textcard button');
    await page.waitForSelector('.sheet-body .linkrow');
    check(/Posting needs the email sign-in/.test(await page.$eval('.sheet-body', (b) => b.innerText)) && !(await page.$('.sheet-body form')), 'Send in your design, signed out: the same', '');
    await page.click('.sheet-head .iconbtn');
    await pageRules(page, 'vintage', 390);
    check(!errors.length, 'no console errors', errors.join(' | '));
    check(!supabase.length, 'demo mode never calls Supabase', supabase.join(', '));
    await ctx.close();
  });

  await group('Vintage, a find posts with its fields and shows days left; “Someone got it” thanks you (demo)', async () => {
    const { ctx, page, errors } = await vintageDemo(browser, base, { viewport: { width: 1280, height: 800 }, scheme: 'dark' });
    await signInAs(page, 'Kara');
    const t0 = await thanksOf(page);
    await page.click(vslot('spotted') + ' .addrow button');
    await page.waitForSelector('.sheet-body form.bform input[name="m:shop"]');
    await page.waitForFunction(() => document.querySelector('.sheet-body input[name="m:shop"]').getAttribute('list') === 'vintage-shop-list');
    const list = await page.$$eval('#vintage-shop-list option', (os) => os.map((o) => o.value));
    const shops = (await readFile(path.join(APP, 'data/demo/vintage.json'), 'utf8').then(JSON.parse)).shops.map((s) => s.name);
    check(JSON.stringify(list) === JSON.stringify(shops), 'the shop field suggests the guide’s shops; anything typed still goes', JSON.stringify(list));
    const fields = await page.$$eval('.sheet-body .bf-label', (ls) => ls.map((l) => l.textContent.replace(/\s+/g, ' ').trim()));
    check(fields.includes('Shop') && fields.includes('Size optional') && fields.includes('Price optional'), 'the fields are the kind’s: shop (needed), size and price (optional)', JSON.stringify(fields));
    check(/Your photo goes to Stephen first/.test(await page.$eval('.sheet-body', (b) => b.innerText)), 'the sheet says the photo goes to Stephen first', '');
    await page.fill('.sheet-body input[name=title]', 'Corduroy chore coat');
    await page.click('.sheet-body .bform button[type=submit]');
    check(/Fill in the required details first/.test(await page.$eval('.sheet-body .bf-msg', (m) => m.textContent)), 'no shop: refused, with the reason', '');
    await page.fill('.sheet-body input[name="m:shop"]', 'A stall at the Saturday market');
    await page.fill('.sheet-body input[name="m:size"]', 'M');
    await page.fill('.sheet-body input[name="m:price"]', '32');
    await page.click('.sheet-body .bform button[type=submit]');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached', timeout: 4000 });
    await page.waitForFunction(() => /Corduroy chore coat/.test(document.querySelector('.panel:not([hidden]) [data-sec="spotted"] .card.board .b-title').textContent));
    const card = await page.$eval(vslot('spotted') + ' .card.board', (c) => ({ title: c.querySelector('.b-title').textContent, meta: c.querySelector('.b-meta').textContent,
      left: c.querySelector('.tag-left').textContent, got: !!c.querySelector('[data-act=vgot]'), del: !!c.querySelector('[data-act=bdelete]'), who: c.querySelector('.c-src').textContent }));
    check(card.title === 'Corduroy chore coat' && card.meta === 'A stall at the Saturday market · Size M · $32', 'it leads Spotted, with its shop (typed, not from the guide), size and price', JSON.stringify(card));
    check(/^2[01]d left$/.test(card.left) && card.who === 'Kara', 'three weeks to run, by first name', JSON.stringify(card));
    check(card.got && card.del, 'your own find offers “Someone got it” and delete', JSON.stringify(card));
    const id = await page.$eval(vslot('spotted') + ' .card.board', (c) => c.dataset.k.slice(2));
    await page.click(vslot('spotted') + ' .card.board [data-act=vgot]');
    check(/Someone got it\?/.test(await page.$eval('#confirm', (c) => c.innerText)), '“Someone got it” asks first', '');
    await page.click('#confirm [data-yes]');
    await page.waitForFunction((n) => Number(document.querySelector('.panel:not([hidden]) [data-thanks]').dataset.thanks) === n + 1, t0.n);
    const t1 = await thanksOf(page);
    check(t1.n === t0.n + 1 && new RegExp(t1.n + ' finds you posted found a home this month').test(t1.text), 'the thank-you line counts one more find gone home', JSON.stringify([t0, t1]));
    check(/No points and no prizes/.test(t1.text) && !/raffle|enter to win|\bearn|\bdraw\b/i.test(t1.text), 'a thank-you, not points, prizes or a raffle', t1.text);
    check(!(await page.$(vslot('spotted') + ' .card.board[data-k="b-' + id + '"]')), 'and the find leaves the board', '');
    const gone = await fakeOf(page, `(f) => f.posts.some((p) => p.id === '${id}')`);
    check(gone === false, 'the post is gone from the board, not just hidden here', '');
    await pageRules(page, 'vintage', 1280);
    await page.screenshot({ path: path.join(SHOTS, 'demo-vintage-desktop-dark.png') });
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Vintage, the design form: consent first, and no price or cash anywhere (demo)', async () => {
    const { ctx, page, errors } = await vintageDemo(browser, base, { motion: 'reduce' });
    await signInAs(page, 'Nora');
    await page.click(vslot('make') + ' .textcard button');
    const f = '.sheet-body form[data-form="design"]';
    await page.waitForSelector(f);
    const card = (await page.$eval(vslot('make'), (s) => s.innerText)) + '\n' + (await page.$eval('.sheet-body', (b) => b.innerText));
    check(!/\$\s?\d|\bcash\b|\bprice\b|\bcommission\b|\braffle\b/i.test(card), 'the design pitch and form show no price and no cash', card.slice(0, 160));
    const opts = await page.$$eval(f + ' .pills button', (bs) => bs.map((b) => b.textContent));
    check(JSON.stringify(opts) === JSON.stringify(['Free shirts', 'Store credit']), 'the artist’s choice is free shirts or store credit, and nothing else', JSON.stringify(opts));
    const before = await fakeOf(page, (x) => ({ posts: x.posts.length, photos: x.photos.size }));
    await page.click(f + ' button[type=submit]');
    check(/Choose your design first/.test(await page.$eval(f + ' .bf-msg', (m) => m.textContent)), 'no image: refused', '');
    await page.setInputFiles(f + ' input[type=file]', { name: 'rain.png', mimeType: 'image/png', buffer: PNG });
    await page.fill(f + ' input[name=title]', 'Rainy Church Street');
    await page.fill(f + ' input[name=note]', 'Ink, from the corner by the steeple');
    await page.click(f + ' button[type=submit]');
    check(/Pick free shirts or store credit/.test(await page.$eval(f + ' .bf-msg', (m) => m.textContent)), 'no choice: refused', '');
    await page.click(f + ' .pills button:has-text("Free shirts")');
    await page.click(f + ' button[type=submit]');
    check(/Tick the box first/.test(await page.$eval(f + ' .bf-msg', (m) => m.textContent)), 'no consent: refused, with the reason', '');
    const mid = await fakeOf(page, (x) => ({ posts: x.posts.length, photos: x.photos.size }));
    check(JSON.stringify(mid) === JSON.stringify(before), 'and nothing was sent: no post, no photo', JSON.stringify([before, mid]));
    await page.check(f + ' input[name=consent]');
    await page.click(f + ' button[type=submit]');
    await page.waitForFunction(() => /^Sent\./.test(document.querySelector('#toast').textContent), null, { timeout: 4000 });
    const sent = await fakeOf(page, `(x) => { const p = x.posts[x.posts.length - 1]; return { kind: p.kind, shop: p.meta.shop, title: p.title, body: p.body, photo: x._photoState(p.photo_path), n: x.posts.length }; }`);
    check(sent.n === before.posts + 1 && sent.kind === 'spotted' && sent.shop === 'Make a tee' && sent.title === 'Rainy Church Street', 'sent: a Vintage post tagged “Make a tee”, until there is a design kind', JSON.stringify(sent));
    check(/Thanks in: free shirts/.test(sent.body) && sent.photo === 'pending', 'it carries the artist’s choice for Stephen, and its picture waits in the photo queue', JSON.stringify(sent));
    check(await page.$eval('#sheet', (x) => x.hidden), 'the sheet closes once it is sent', '');
    const sentText = await page.$eval(vslot('sent'), (s) => s.innerText);
    check(!/Thanks in/.test(sentText), 'how an artist asked to be thanked never shows on the public card', sentText.slice(0, 120));
    await pageRules(page, 'vintage', 390);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Vintage, the shop guide walks in order and invents no hours (live)', async () => {
    const file = await vintageShops();
    const things = JSON.parse(await readFile(path.join(REPO, 'data/things.json'), 'utf8'));
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/#vintage');
    await settle(page);
    await page.waitForSelector(vslot('shops') + ' .lrow');
    const rows = await page.$$eval(vslot('shops') + ' .lrow', (rs) => rs.map((r) => ({ k: r.dataset.k, num: r.querySelector('.num').textContent, name: r.querySelector('.t').textContent,
      hours: r.querySelector('[data-hours]').textContent, map: r.querySelector('a.pillbtn').href })));
    check(file.count >= 6, 'the guide has at least six shops (' + file.count + ')', file.count);
    check(rows.length === file.shops.length && rows.every((r, i) => r.k === 's-' + file.shops[i].id && r.num === String(i + 1)), 'every shop in the file, numbered in its walking order', JSON.stringify(rows.map((r) => r.name)));
    const ROUTE = ['Downtown / Church St', 'Waterfront', 'South End', 'Hill Section', 'Old North End', 'New North End', 'Winooski', 'South Burlington', 'Shelburne', 'Colchester', 'Essex / Essex Jct'];
    const ranks = file.shops.map((s) => ROUTE.indexOf(s.neighborhood));
    check(ranks.every((r, i) => i === 0 || r >= ranks[i - 1]), 'the walk goes downtown, the South End, the Old North End, Winooski, then Essex', JSON.stringify(file.shops.map((s) => s.neighborhood)));
    const byId = Object.fromEntries(things.map((t) => [t.id, t]));
    check(file.shops.every((s) => byId[s.id] && byId[s.id].group === 'Shopping' && byId[s.id].name === s.name), 'every shop is one of things.json’s Shopping entries: none invented', '');
    const invented = file.shops.filter((s) => s.hours && !(byId[s.id].blurb || '').toLowerCase().includes(s.hours.split(' ')[0].toLowerCase()));
    check(!invented.length, 'every hour comes from the shop’s own things.json entry', JSON.stringify(invented.map((s) => s.name)));
    const shown = rows.map((r, i) => (file.shops[i].hours ? r.hours.startsWith(file.shops[i].hours) : r.hours === 'Hours not checked yet'));
    check(shown.every(Boolean), 'hours show only where the guide has them; the rest say “Hours not checked yet”', JSON.stringify(rows.map((r) => r.hours)));
    check(rows.every((r) => /^https:\/\/www\.google\.com\/maps\/search\//.test(r.map)), 'Map opens a search on Google Maps', rows[0].map);
    check(file.shops.every((s) => Array.isArray(s.gaps)) && file.gaps, 'gaps are marked in the file for Stephen to fill', JSON.stringify(file.gaps));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();

    /* the walk between two shops, from a file that has coordinates for both */
    const fixture = { count: 3, gaps: {}, shops: [
      { id: 'a', name: 'Shop A', kinds: ['Vintage'], neighborhood: 'Downtown / Church St', address: '1 Main St', coords: [44.4759, -73.2121], hours: null, blurb: 'A.', gaps: ['hours'], next: { miles: 0.5, minutes: 10, mode: 'walk' } },
      { id: 'b', name: 'Shop B', kinds: ['Thrift'], neighborhood: 'South End', address: null, coords: null, hours: null, blurb: 'B.', gaps: ['address', 'coords', 'hours'], next: { unknown: true } },
      { id: 'c', name: 'Shop C', kinds: ['Antiques'], neighborhood: 'Essex / Essex Jct', address: null, coords: null, hours: null, blurb: 'C.', gaps: [], next: null },
    ] };
    const two = await newPage(browser, base, { routes: [[/\/data\/vintage-shops\.json/, fixture]] });
    await two.page.goto(base + '/all-day/#vintage');
    await settle(two.page);
    await two.page.waitForSelector(vslot('shops') + ' .lrow');
    const legs = await two.page.$$eval(vslot('shops') + ' .lrow', (rs) => rs.map((r) => (r.querySelector('[data-leg]') || {}).textContent || ''));
    check(legs[0] === 'Then about 10 minutes on foot to Shop B' && legs[1] === 'Then Shop C, Essex / Essex Jct' && legs[2] === '', 'the walk to the next shop where both have coordinates; only the next stop where they don’t', JSON.stringify(legs));
    await two.ctx.close();
  });

  await group('Vintage, the designs rail links to the merch site (live)', async () => {
    const d = await vintageDesigns();
    const big = [];
    for (const x of d.designs) { const b = await readFile(path.join(APP, x.img)); if (b.length >= 60000) big.push(x.img); }
    check(d.designs.length >= 6 && !big.length, d.designs.length + ' previews in all-day/assets/merch, each under 60 KB', big.join(', '));
    const { ctx, page, errors } = await newPage(browser, base, { viewport: { width: 1280, height: 800 } });
    await page.goto(base + '/all-day/#vintage/tees');
    await settle(page);
    await page.waitForSelector(vslot('tees') + ' a.vcard');
    const cardsOut = await page.$$eval(vslot('tees') + ' a.vcard', (as) => as.map((a) => ({ href: a.href, name: a.querySelector('.t').textContent, target: a.target, img: a.querySelector('img').getAttribute('src') })));
    check(cardsOut.length === d.designs.length && cardsOut.every((c, i) => c.href === 'https://merch.btownbrief.com/#/p/huba/d/' + d.designs[i].id && c.name === d.designs[i].name),
      'every design links to its own page on merch.btownbrief.com, where it is shown on a model', JSON.stringify(cardsOut.slice(0, 2)));
    check(cardsOut.every((c) => c.target === '_blank' && /^\.\/assets\/merch\/\d+\.webp$/.test(c.img)), 'they open in a new tab, with the small local preview', JSON.stringify(cardsOut[0]));
    const loaded = await page.$$eval(vslot('tees') + ' a.vcard img', (is) => Promise.all(is.slice(0, 4).map((i) => (i.complete ? i.naturalWidth : new Promise((r) => { i.onload = () => r(i.naturalWidth); i.onerror = () => r(0); })))));
    check(loaded.every((w) => w > 0), 'the previews load', JSON.stringify(loaded));
    const all = await page.$eval(vslot('tees') + ' .addrow a', (a) => ({ href: a.href, text: a.textContent.trim() }));
    check(all.href === 'https://merch.btownbrief.com/' && new RegExp('All ' + d.total + ' designs').test(all.text), 'and “All ' + d.total + ' designs in the shop” goes to the shop', JSON.stringify(all));
    const money = await page.$eval(vslot('tees'), (s) => s.innerText);
    check(!/\$\s?\d|buy now|checkout|add to (cart|bag)/i.test(money), 'nothing on the rail takes money or names a price', money.slice(0, 100));
    await pageRules(page, 'vintage', 1280);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Vintage, live posts land in their sections (live)', async () => {
    const at = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const ends = (d) => new Date(Date.now() + d * 86400000 + 3600000).toISOString();
    const base0 = { body: '', place: '', author: 'Kara', author_arch: 'regular', votes: 2, voted: false, mine: false };
    const spotted = [
      { ...base0, id: '0000cccc-0000-4000-8000-000000000001', board: 'vintage', kind: 'spotted', title: 'Barn jacket', meta: { shop: 'Junktiques Collective', size: 'M', price: 45 }, photo: 'submissions/abcd-1.jpg', created_at: at(2), expires_at: ends(20) },
      { ...base0, id: '0000cccc-0000-4000-8000-000000000002', board: 'vintage', kind: 'spotted', title: 'My Sunday fit', meta: { shop: 'Fit check' }, photo: 'submissions/abcd-2.jpg', created_at: at(3), expires_at: ends(19) },
      { ...base0, id: '0000cccc-0000-4000-8000-000000000003', board: 'vintage', kind: 'spotted', title: 'Fit, photo still waiting', meta: { shop: 'Fit check' }, photo: null, created_at: at(4), expires_at: ends(19) },
      { ...base0, id: '0000cccc-0000-4000-8000-000000000004', board: 'vintage', kind: 'spotted', title: 'Lake ink', body: 'Pen and ink\n\nThanks in: store credit', meta: { shop: 'Make a tee' }, photo: 'submissions/abcd-4.jpg', created_at: at(5), expires_at: ends(18) },
    ];
    const swap = { ...base0, id: '0000cccc-0000-4000-8000-000000000005', board: 'vintage', kind: 'swap', title: 'Band tees', meta: { want: 'Denim', size: 'M' }, photo: null, created_at: at(6), expires_at: ends(17) };
    const artPost = { ...base0, id: '0000dddd-0000-4000-8000-000000000001', board: 'art', kind: 'art', title: 'Camel’s Hump in gouache', author: 'Dev', meta: { shirt: 'yes' }, photo: 'submissions/art-1.jpg', created_at: at(8), expires_at: null };
    const calls = [];
    const { ctx, page, errors } = await newPage(browser, base, {
      rpc: (fn, args) => {
        if (!/^nn_/.test(fn)) return undefined;
        calls.push({ fn, args });
        if (fn === 'nn_posts_list' && args.p_board === 'art') return args.p_filter.meta && args.p_filter.meta.shirt === 'yes' ? [artPost] : [];
        if (fn === 'nn_posts_list') return args.p_filter.kind === 'swap' ? [swap] : spotted;
        return undefined;
      },
    });
    await page.goto(base + '/all-day/#vintage');
    await settle(page);
    await page.waitForSelector(vslot('spotted') + ' [data-grid="spotted"]');
    const lists = calls.filter((c) => c.fn === 'nn_posts_list').map((c) => c.args.p_board + ':' + c.args.p_filter.kind + ':' + c.args.p_limit).sort();
    check(JSON.stringify(lists) === '["vintage:spotted:60","vintage:swap:60"]', 'two lists: spotted and swap, the server’s most', JSON.stringify(lists));
    const titles = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.panel:not([hidden]) [data-grid]')].map((g) => [g.dataset.grid, [...g.querySelectorAll('.b-title')].map((t) => t.textContent)])));
    check(JSON.stringify(titles) === JSON.stringify({ spotted: ['Barn jacket'], swaps: ['Band tees'], sent: ['Lake ink'], fit: ['My Sunday fit'] }),
      'a find in Spotted, a swap in Swaps, a design in Sent in, a fit check with its photo in Fit check, and one whose photo still waits nowhere', JSON.stringify(titles));
    const img = await page.$eval(vslot('spotted') + ' .card.board .c-media img', (i) => i.getAttribute('src'));
    check(/\/storage\/v1\/object\/public\/btb-photos\/submissions\/abcd-1\.jpg$/.test(img), 'an approved photo comes from the public bucket', img);
    check(await page.$eval(vslot('swaps') + ' .b-meta', (m) => m.textContent) === 'For Denim · Size M', 'a swap says what it is for, and the size', '');
    await page.goto(base + '/all-day/#vintage/b-0000cccc-0000-4000-8000-000000000004');
    check(await flashes(page, 'b-0000cccc-0000-4000-8000-000000000004'), 'a shared post’s link lands on it and flashes', '');
    await page.goto(base + '/all-day/#vintage/b-0000cccc-0000-4000-8000-00000000dead');
    await page.waitForSelector('#toast:not([hidden])', { timeout: 6000 }).catch(() => {});
    check(/That post has gone/.test(await page.$eval('#toast', (t) => t.textContent)), 'a post that has gone says so', await page.$eval('#toast', (t) => t.textContent));
    await page.goto(base + '/all-day/#vintage/b-0000dddd-0000-4000-8000-000000000001');
    await page.waitForSelector('.sheet-card[aria-label="Put it on a shirt"]', { timeout: 6000 }).catch(() => {});
    const shirt = await page.$eval('.sheet-body', (b) => ({ text: b.innerText, img: (b.querySelector('img') || {}).src || '' })).catch(() => ({ text: '', img: '' }));
    check(/Camel’s Hump in gouache by Dev/.test(shirt.text) && /said yes to a shirt/.test(shirt.text) && /submissions\/art-1\.jpg$/.test(shirt.img), 'Art’s “Put it on a shirt” link opens the piece here, picture, title and maker', JSON.stringify(shirt));
    check(!/\$\s?\d|\bprice\b/i.test(shirt.text), 'and it names no price', shirt.text);
    check(calls.some((c) => c.fn === 'nn_posts_list' && c.args.p_board === 'art' && JSON.stringify(c.args.p_filter) === '{"meta":{"shirt":"yes"}}'), 'it looks only among Art posts whose maker said yes to a shirt', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });
}

/* ---------------------------------------------------------- shell fixes */
/* The small shell changes the tab sessions asked for, one check each. */
async function shellFixes(browser, base) {
  await group('shell fixes: a rail never snaps flush to the edge', async () => {
    for (const width of [390, 1280]) {
      const { ctx, page, errors } = await newPage(browser, base, { viewport: { width, height: 844 } });
      await page.goto(base + '/all-day/?demo=1#onair');
      await page.waitForSelector('#panel-onair .rail > *', { timeout: 15000 });
      const r = await page.evaluate(() => {
        const rail = [...document.querySelectorAll('#panel-onair .rail')].find((x) => x.scrollWidth > x.clientWidth + 40);
        if (!rail) return null;
        const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter'));
        const pad = parseFloat(getComputedStyle(rail).scrollPaddingLeft);
        rail.children[1].scrollIntoView({ inline: 'start', block: 'nearest' });
        const left = rail.children[1].getBoundingClientRect().left - rail.getBoundingClientRect().left;
        return { gutter, pad, left: Math.round(left) };
      });
      check(r && r.pad === r.gutter, width + ': .rail carries scroll-padding of one gutter', JSON.stringify(r));
      check(r && Math.abs(r.left - r.gutter) <= 1, width + ': a card scrolled to the start stops at the gutter', JSON.stringify(r));
      check(!errors.length, width + ': no console errors', errors.join(' | '));
      await ctx.close();
    }
  });

  await group('shell fixes: a new address closes an open sheet', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#wire');
    await settle(page);
    await page.click('#settings-btn');
    check(await page.$eval('#sheet', (s) => !s.hidden), 'Settings is open', '');
    await page.evaluate(() => { location.hash = '#food'; });
    await page.waitForFunction(() => document.querySelector('#tab-food').getAttribute('aria-selected') === 'true');
    check(await page.$eval('#sheet', (s) => s.hidden && !s.children.length), 'a hash change to another tab closes it', '');
    await page.click('#saved-btn');
    await page.evaluate(() => { location.hash = '#food/open'; });
    await page.waitForTimeout(200);
    check(await page.$eval('#sheet', (s) => s.hidden), 'and a deep link inside the same tab does too', '');
    await page.goto(base + '/all-day/#whatnow/missions');
    await page.waitForSelector(wnPanel + ' .lrow[data-k="m5"] .open', { timeout: 15000 });
    await page.click(wnPanel + ' .lrow[data-k="m5"] .open');
    await page.waitForSelector('.sheet-card h2');
    await page.evaluate(() => { location.hash = '#wire'; });
    await page.waitForTimeout(200);
    check(await page.$eval('#sheet', (s) => s.hidden), 'a tab’s own sheet (a mission) closes when you leave', '');
    await page.goBack();
    await page.waitForTimeout(200);
    check(await page.$eval('#sheet', (s) => s.hidden) && await page.$eval('#tab-whatnow', (b) => b.getAttribute('aria-selected')) === 'true', 'and Back lands on the tab, not a ghost sheet', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('shell fixes: app.showClip plays a file video in the one box', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.route(/clips\.example\/.*\.mp4/, (r) => r.fulfill({ status: 200, body: '', contentType: 'video/mp4' }));
    await page.goto(base + '/all-day/#wire');
    await settle(page);
    const food = await readFile(path.join(APP, 'js/modes/food.js'), 'utf8');
    check(!/MutationObserver|getElementById\('vbox/.test(food), 'Food no longer reaches into the video box itself', '');
    await page.evaluate(() => import('/all-day/js/app.js').then((app) => app.showClip({ src: 'https://clips.example/a.mp4', poster: 'https://clips.example/a.jpg',
      title: '@foam · the new IPA', href: 'https://www.instagram.com/reel/AAA/', vertical: true })));
    const open = await page.evaluate(() => {
      const v = document.querySelector('#vbox-frame video'), f = document.getElementById('vbox-frame'), r = f.getBoundingClientRect();
      return { shown: !document.getElementById('vbox').hidden, src: v && v.getAttribute('src'), controls: v && v.controls, auto: v && v.autoplay,
        tall: r.height > r.width, label: document.getElementById('vbox-open').textContent, href: document.getElementById('vbox-open').href,
        title: document.getElementById('vbox-title').textContent, audioPaused: document.getElementById('audio').paused };
    });
    check(open.shown && open.src === 'https://clips.example/a.mp4' && open.controls && !open.auto, 'it opens the box with a <video>, controls on, no autoplay attribute', JSON.stringify(open));
    check(open.tall, 'vertical: the box stands 9:16', JSON.stringify(open));
    check(/^Open on Instagram/.test(open.label) && open.href === 'https://www.instagram.com/reel/AAA/' && open.title === '@foam · the new IPA', 'the link names Instagram and points at the post', JSON.stringify(open));
    await page.keyboard.press('Escape');
    const shut = await page.evaluate(() => ({ hidden: document.getElementById('vbox').hidden, videos: document.querySelectorAll('video').length,
      vertical: document.getElementById('vbox-frame').classList.contains('vertical'), label: document.getElementById('vbox-open').textContent }));
    check(shut.hidden && !shut.videos && !shut.vertical && /^Open in YouTube/.test(shut.label), 'Escape closes it and gives the box back to YouTube', JSON.stringify(shut));
    await page.evaluate(() => import('/all-day/js/app.js').then((app) => app.showClip({ src: 'https://clips.example/b.mp4', href: 'https://example.org/clip' })));
    const flat = await page.evaluate(() => { const r = document.getElementById('vbox-frame').getBoundingClientRect(); return { wide: r.width > r.height, label: document.getElementById('vbox-open').textContent }; });
    check(flat.wide && /^Open the original/.test(flat.label), 'not vertical: 16:9, and an unknown host is "Open the original"', JSON.stringify(flat));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('shell fixes: chips inside a tab wrap on a wide screen', async () => {
    for (const width of [390, 1280]) {
      const { ctx, page, errors } = await newPage(browser, base, { viewport: { width, height: 800 } });
      await page.goto(base + '/all-day/#whatnow/missions');
      await page.waitForSelector(wnPanel + ' .chips.themes .chip', { timeout: 15000 });
      const r = await page.$eval(wnPanel + ' .chips.themes', (c) => {
        const tops = new Set([...c.querySelectorAll('.chip')].map((b) => Math.round(b.getBoundingClientRect().top)));
        return { wrap: getComputedStyle(c).flexWrap, rows: tops.size, over: c.scrollWidth - c.clientWidth };
      });
      if (width >= 900) check(r.wrap === 'wrap' && r.over <= 1, '1280: the theme chips wrap, nothing to scroll sideways', JSON.stringify(r));
      else check(r.wrap === 'nowrap' && r.rows === 1, '390: they stay one row that scrolls', JSON.stringify(r));
      check(!errors.length, width + ': no console errors', errors.join(' | '));
      await ctx.close();
    }
  });

  await group('shell fixes: an emoji thumb is drawn at the emoji size', async () => {
    const tokens = await readFile(path.join(APP, 'css/tokens.css'), 'utf8');
    const want = (tokens.match(/--fs-emoji:\s*(\d+)px/) || [])[1];
    check(!!want, 'tokens.css has --fs-emoji', '');
    const { ctx, page } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#games');
    await page.waitForSelector('#panel-games .lrow .th.bare', { timeout: 15000 });
    const fs = await page.$eval('#panel-games .lrow .th.bare', (t) => getComputedStyle(t).fontSize);
    check(fs === want + 'px', 'a game’s emoji in a list row is ' + want + 'px, not body size', fs);
    await ctx.close();
  });

  await group('shell fixes: old Listen and TV links land in On Air', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    const landed = async (hash) => {
      await page.goto(base + '/all-day/?demo=1' + hash);
      await page.waitForFunction(() => document.querySelector('#tab-onair')?.getAttribute('aria-selected') === 'true', null, { timeout: 15000 }).catch(() => {});
      return page.evaluate(() => ({ on: document.querySelector('#tab-onair').getAttribute('aria-selected') === 'true', hash: location.hash }));
    };
    let r = await landed('#listen');
    check(r.on && r.hash === '#onair', '#listen opens On Air, and the address says #onair', JSON.stringify(r));
    r = await landed('#watch/yt:dQw4w9WgXcQ');
    check(r.on && r.hash === '#onair/yt:dQw4w9WgXcQ', '#watch/yt:<id> opens On Air with the same video key', JSON.stringify(r));
    r = await landed('#listen/brief');
    check(r.on && r.hash === '#onair/brief', '#listen/<key> keeps its key', JSON.stringify(r));
    await page.goto(base + '/all-day/?demo=1#watch');
    await settle(page);
    check(await page.$eval('#tab-watch', (b) => b.getAttribute('aria-selected')) === 'true', 'a plain #watch is still the Watchlist', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('shell fixes: the offline shell carries the new modules', async () => {
    const sw = await readFile(path.join(APP, 'sw.js'), 'utf8');
    const main = await readFile(path.join(APP, 'js/main.js'), 'utf8');
    check(/VERSION = 'all-day-v44'/.test(sw), 'sw.js VERSION is bumped once, to v44', (sw.match(/VERSION = '[^']+'/) || [''])[0]);
    const listed = [...sw.matchAll(/'\.\/(js\/[\w/.-]+\.js)'/g)].map((m) => m[1]);
    for (const f of ['js/boards.js', 'js/boards-core.js', 'js/boards-fake.js']) check(listed.includes(f), f + ' is in the offline list', '');
    const imported = [...main.matchAll(/import '\.\/([\w/.-]+\.js)'/g)].map((m) => 'js/' + m[1]);
    check(imported.every((f) => listed.includes(f)), 'every module main.js imports is in the offline list', imported.filter((f) => !listed.includes(f)).join(', '));
  });

  await group('shell fixes: third-party players use the shared .embed', async () => {
    for (const f of ['modes/onair.js', 'modes/whatnow.js', 'modes/food.js']) {
      const src = (await readFile(path.join(APP, 'js', f), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
      const made = src.match(/el\('iframe'[^)]*\)|createElement\('iframe'\)/g) || [];
      check(made.every((m) => /'embed (spotify|bandcamp)'/.test(m)), f + ': every iframe it builds is an .embed', made.join(' '));
      check(!/\.(width|height|frameBorder)\s*=|setAttribute\('(frameborder|seamless)'/.test(src), f + ': and sizes none by hand', '');
    }
    const { ctx, page } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#onair');
    await settle(page);
    const sp = await page.evaluate(() => {
      const f = document.createElement('iframe'); f.className = 'embed spotify';
      document.querySelector('#panel-onair .panel-body').appendChild(f);
      const cs = getComputedStyle(f); const out = { h: cs.height, r: cs.borderRadius, b: cs.borderTopWidth, d: cs.display }; f.remove(); return out;
    });
    check(sp.h === '152px' && sp.r === '12px' && sp.b === '0px' && sp.d === 'block', '.embed.spotify is Spotify’s 152px, the media radius, no border', JSON.stringify(sp));
    await ctx.close();
  });
}

/* ----------------------------------------------------------------- run */
const t0 = Date.now();
await mkdir(SHOTS, { recursive: true });
await staticChecks();
const { base, proc } = await serve();
const browser = await chromium.launch();
/* ONLY=shellFixes,boards runs just those groups while iterating; the full
   matrix is the one that counts. */
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const run = (fn) => (!ONLY.length || ONLY.includes(fn.name) ? fn(browser, base) : null);
try {
  await run(matrix);
  await run(deepLinks);
  await run(theWire);
  await run(theWhatNow);
  await run(theFood);
  await run(onAir);
  await run(theGames);
  await run(interactions);
  await run(shellFixes);
  await run(accounts);
  await run(boards);
  await run(boardPhotos);
  await run(theVintage);
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
