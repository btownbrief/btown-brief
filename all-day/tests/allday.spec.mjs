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
    const OLD = new Set(['sun.js', 'whatnow-engine.js', 'whatnow-data.js']);
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
/* today at h o'clock in Burlington, as ms */
const etAt = (h) => { const key = etKey(Date.now()); const guess = Date.parse(key + 'T' + String(h).padStart(2, '0') + ':00:00Z'); return guess + ((24 + h - Number(etParts(guess).hour)) % 24) * 3600000; };
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
  const picks = ranked.filter((it) => it.local).slice(0, 25).concat(ranked.filter((it) => !it.local).slice(0, 15))
    .map((it, r) => ({ ...it, rank: r + 1, why: r === 2 ? '' : 'Reason ' + (r + 1) + ': why this one matters.' }));
  /* the stories an earlier ranking held and the current one dropped: their
     last rank and reason, newest ranking first, never also in `picks` */
  const morning = new Date(top - (top - bottom) * 0.8).toISOString(), noon = new Date(top - (top - bottom) * 0.4).toISOString();
  const picksEarlier = ranked.filter((it) => it.local).slice(25, 29).concat(ranked.filter((it) => !it.local).slice(15, 17))
    .map((it, i) => ({ ...it, rank: [4, 9, 2, 7, 28, 33][i], why: 'Earlier reason ' + i + ': it led the morning.', ranked_at: i % 2 ? morning : noon }))
    .sort((a, b) => (a.ranked_at === b.ranked_at ? a.rank - b.rank : a.ranked_at < b.ranked_at ? 1 : -1));
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
    counts, picks, picks_earlier: picksEarlier, updates, sources, status: { x: paused, facebook: { ...paused }, reddit: { paused: false, last_post: null } } };
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
    const files = { 'wire-today.json': wireDay(today, 160, o), [y1 + '.json']: wireDay(y1, 90, { ...o, brief: true }), [y2 + '.json']: wireDay(y2, 90, { ...o, brief: false }) };
    files['index.json'] = { v: 1, editions: [y1, y2].map((d) => ({ date: d, count: files[d + '.json'].count, picks: files[d + '.json'].picks.length,
      picks_total: files[d + '.json'].picks.length + files[d + '.json'].picks_earlier.length })) };
    wireCache.set(key, files);
  }
  return wireCache.get(key);
}

/* ------------------------------------------------------------ On Air's data */
/* btown-tv.json, tv-editions.json and the wire-audio index in their real
   shapes: the demo file's payloads, moved from its _anchor to today in
   Burlington. `audio` picks the clip state: 'today', 'yesterday' or 'none'. */
const onairCache = new Map();
const PLAYLIST = /^https:\/\/www\.youtube\.com\/playlist\?list=[A-Za-z0-9_-]+$/;   // onair.js PLAYLIST_RE
/* the Play-on-your-TV row under the Btown TV header: tonight's button, or the fallback past night */
const tvPlay = (page) => page.evaluate(() => {
  const one = (w) => { const a = document.querySelector('#panel-onair [data-tvplay="' + w + '"]'); return a && { href: a.getAttribute('href'), text: a.textContent.trim(), rel: a.rel, target: a.target, icons: a.querySelectorAll('svg').length }; };
  const row = document.querySelector('#panel-onair .tvplay');
  const head = document.querySelector('#panel-onair [data-sec="tv"]');
  const railEl = document.querySelector('#panel-onair [data-slot="tv"] .rail-wrap');
  const before = !!(row && head && railEl && (head.compareDocumentPosition(row) & 4) && (row.compareDocumentPosition(railEl) & 4));
  return { tonight: one('tonight'), past: one('past'), note: row ? row.innerText : '', before };
});
async function onairFiles(opts = {}) {
  const audio = opts.audio || 'today';
  const playlist = opts.playlist || 'all';      // 'all', 'not-tonight' (tonight's upload failed) or 'none'
  const key = audio + playlist + etKey(Date.now());
  if (onairCache.has(key)) return onairCache.get(key);
  const d = JSON.parse(await readFile(path.join(APP, 'data/demo/onair.json'), 'utf8'));
  const today = etKey(Date.now());
  const days = Math.round((Date.parse(today) - Date.parse(d._anchor)) / 86400000);
  const shift = (date) => dayMinus(date, -days);
  const secs = days * 86400;
  const tv = d.tv;
  tv.edition = shift(tv.edition);
  if (playlist !== 'all') delete tv.playlist;
  if (playlist === 'none') d.tvEditions.editions.forEach((e) => { delete e.playlist; });
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
  /* opts.clock (ms) fixes the page's Date while its timers keep running;
     opts.seed makes Math.random a fixed sequence (mulberry32). Together they
     make a random pick from a time-of-day pool the same pick every run. */
  if (opts.clock) await page.clock.setFixedTime(opts.clock);
  if (opts.seed != null) {
    await page.addInitScript((seed) => {
      let a = seed >>> 0;
      Math.random = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }, opts.seed);
  }
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
  /* the People tab's Meetup calendar (Up For It's meetup.json): empty unless a group routes its own */
  await page.route(/play\.btownbrief\.com\/up-for-it\/data\/meetup\.json/, (r) => r.fulfill({ status: 200, body: JSON.stringify({ fetched: new Date().toISOString(), events: [] }), contentType: 'application/json' }));
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
  /* Watch's film list. The films-data branch does not exist until Stephen adds
     the TMDB key, so production fetches it, gets a 404 and reads the baked
     starter list; here the branch answers with that same starter list (a 404
     would log a console error), unless a group passes opts.films: a payload,
     or null for the 404 itself. */
  const films = opts.films === undefined ? await readFile(path.join(APP, 'data/films-seed.json'), 'utf8') : opts.films;
  await page.route(/raw\.githubusercontent\.com\/btownbrief\/btown-brief\/films-data\/data\/films\.json$/, (r) => (films === null
    ? r.fulfill({ status: 404, body: '' })
    : r.fulfill({ status: 200, body: typeof films === 'string' ? films : JSON.stringify(films), contentType: 'application/json' })));
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
const LIVE = new Set(['wire', 'watch', 'whatnow', 'onair', 'games', 'food', 'art', 'vintage', 'people']);

async function matrix(browser, base) {
  for (const combo of COMBOS) {
    for (const demo of [false, true]) {
      const label = combo.viewport.width + ' ' + combo.scheme + (combo.motion === 'reduce' ? ' reduced-motion' : '') + (demo ? ' demo' : ' live');
      await group(label, async () => {
        /* Games' leaderboards are one get_leaderboard per board: answered
           here, so the live screen draws real rows the same way every run */
        const boardsAsked = [];
        const rpc = (fn, body) => {
          if (fn !== 'get_leaderboard') return undefined;
          boardsAsked.push(body.p_game);
          return body.p_game === 'btown-wordle' ? ROWS(['Ada W.', 'Cy F.', 'Juniper', 'Max T.']) : [];
        };
        const { ctx, page, errors, supabase } = await newPage(browser, base, { ...combo, rpc });
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
          if (tab === 'games' && !demo) {
            await page.waitForFunction(() => !/Loading \d+ boards/.test(document.querySelector('#panel-games').innerText), null, { timeout: 15000 });
            check(boardsAsked.length > 0 && boardsAsked.includes('btown-wordle'), 'games: every leaderboard call is answered by the suite, never the network', boardsAsked.join(', '));
          }
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
          if (demo && combo === COMBOS[3] && (tab === 'wire' || tab === 'onair' || tab === 'games' || tab === 'art' || tab === 'people')) await page.screenshot({ path: path.join(SHOTS, 'demo-' + tab + '-desktop.png') });
          if (!demo && combo === COMBOS[0] && (tab === 'wire' || tab === 'watch' || tab === 'food' || tab === 'onair' || tab === 'games' || tab === 'art' || tab === 'vintage' || tab === 'people')) await page.screenshot({ path: path.join(SHOTS, 'live-' + tab + '.png') });
          if (!demo && combo === COMBOS[1] && (tab === 'onair' || tab === 'games' || tab === 'people')) await page.screenshot({ path: path.join(SHOTS, 'live-' + tab + '-dark.png') });
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
    const cases = [['wire', 'w13'], ['wire', 'y4'], ['watch', 'f9003'], ['food', 'r-demo-all-night-diner'], ['people', 'mx-dm2'], ['whatnow', 'e-tn3'], ['vintage', 's-resource-burlington'], ['art', 'b-0000a000-0000-4000-8000-000000000002'], ['onair', 'yt:demo-tv-003'], ['games', 'g:trivia-ladder'], ['games', 'champ:btown-riddle']];
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

    /* What matters today: every local pick, five open, the rest and the
       earlier rankings' picks behind one button */
    const localPicks = today.picks.filter((x) => x.local).map((x) => x.id);
    const localEarlier = today.picks_earlier.filter((x) => x.local);
    check(await page.$$eval('.wm .card', (c) => c.length) === 5, 'one pick card and four ranked rows to start', '');
    check(await page.$$eval('.wm .wm-row', (rs) => rs.filter((r) => !r.querySelector('.why')).length) === 1, 'an empty why draws no reason line', '');
    check(!(await page.$('.wm .wm-row.was')) && !/Earlier today/.test(await page.$eval('.wm', (w) => w.innerText)), 'the earlier picks wait behind the button', '');
    const moreLabel = await page.$eval('.wm .btn.more', (b) => b.textContent);
    const hiddenN = localPicks.length - 5 + localEarlier.length;
    check(moreLabel === hiddenN + ' more picks', 'the button counts the rest of the ranking and the earlier picks (' + hiddenN + ')', moreLabel);
    await page.click('.wm .btn.more');
    const block = await page.$$eval('.wm [data-k]', (c) => c.map((x) => ({ k: x.dataset.k, was: x.classList.contains('was'), num: (x.querySelector('.num') || {}).textContent || '', why: (x.querySelector('.why') || {}).textContent || '' })));
    check(JSON.stringify(block.filter((x) => !x.was).map((x) => x.k)) === JSON.stringify(localPicks), 'opened, the block shows every local pick of the ranking, in order (' + localPicks.length + ')', JSON.stringify(block.map((x) => x.k)));
    const wasRows = block.filter((x) => x.was);
    check(JSON.stringify(wasRows.map((x) => [x.k, x.num, x.why])) === JSON.stringify(localEarlier.map((x) => [x.id, String(x.rank), x.why])),
      'then the earlier picks, newest ranking first, each with its last rank and its reason', JSON.stringify(wasRows));
    const wmText = await page.$eval('.wm', (w) => w.innerText);
    check(/Earlier today, these mattered too/.test(wmText), 'under “Earlier today, these mattered too”', '');
    const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const inWords = (n) => (n < 20 ? ONES[n] : ['', '', 'twenty', 'thirty', 'forty', 'fifty'][Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
    const totalWord = inWords(localPicks.length + localEarlier.length);
    check(wmText.includes('That’s all ' + totalWord + '.'), 'and the list ends “That’s all ' + totalWord + '.”', wmText.slice(-80));

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

    /* yesterday opens with its own What mattered block, as the arrow view draws it */
    const yday = files[y1 + '.json'];
    const yBlock = await page.evaluate((date) => {
      const head = document.querySelector('.panel:not([hidden]) [data-day="' + date + '"]');
      let n = head && head.nextElementSibling;
      while (n && !n.classList.contains('wm') && !n.dataset.day) n = n.nextElementSibling;
      if (!n || !n.classList.contains('wm')) return null;
      return { title: n.querySelector('h2').textContent, keys: [...n.querySelectorAll('[data-k]')].map((x) => x.dataset.k), more: (n.querySelector('.btn.more') || {}).textContent || '' };
    }, y1);
    const yWeek = nameOf(y1).split(',')[0];
    check(yBlock && yBlock.title === 'What mattered ' + yWeek, 'scrolling into yesterday draws “What mattered ' + yWeek + '” under its head', JSON.stringify(yBlock));
    const yPin = await page.evaluate((date) => {
      const n = document.querySelector('.panel:not([hidden]) [data-day="' + date + '"]').nextElementSibling;
      return n && n.matches('.card.pick') ? { k: n.dataset.k, eyebrow: n.querySelector('.eyebrow').textContent } : null;
    }, y1);
    check(yPin && yPin.k === yday.brief.id && /The Brief/i.test(yPin.eyebrow), 'yesterday’s Brief is pinned above its block, as the arrow view pins it', JSON.stringify(yPin));
    const yAll = yday.picks.map((x) => x.id);   /* the switch is on Everything here */
    check(yBlock && JSON.stringify(yBlock.keys) === JSON.stringify(yAll.slice(0, 5)), 'with its picks: the card and four rows, in rank order', JSON.stringify(yBlock && yBlock.keys));
    check(yBlock && yBlock.more === (yAll.length - 5 + yday.picks_earlier.length) + ' more picks', 'and its own button for the rest and the earlier picks', yBlock && yBlock.more);
    await page.click('.panel:not([hidden]) [data-day="' + y1 + '"] ~ .wm .btn.more');
    const yOpen = await page.evaluate((date) => {
      const head = document.querySelector('.panel:not([hidden]) [data-day="' + date + '"]');
      let n = head.nextElementSibling;
      while (n && !n.classList.contains('wm')) n = n.nextElementSibling;
      return { text: n.innerText, keys: [...n.querySelectorAll('[data-k]')].map((x) => x.dataset.k) };
    }, y1);
    check(JSON.stringify(yOpen.keys) === JSON.stringify(yAll.concat(yday.picks_earlier.map((x) => x.id))) && /Earlier that day/.test(yOpen.text),
      'opened in place: the whole ranking, then “Earlier that day” and the earlier picks', JSON.stringify(yOpen.keys));
    const pageKeys = await page.$$eval('.panel:not([hidden]) .feed [data-k]', (c) => c.map((x) => x.dataset.k));
    const dupes = pageKeys.filter((k, i) => pageKeys.indexOf(k) !== i);
    check(!dupes.length, 'no key appears twice on the page, today through the archive (' + pageKeys.length + ' cards)', JSON.stringify(dupes.slice(0, 5)));

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
    const subs = await page.$$eval('#panel-onair [data-sec] p', (p) => p.map((x) => x.textContent));
    check(!subs.length, 'no section carries an explanatory subtitle', JSON.stringify(subs));
    check(!/lands at 7 every morning/.test(await page.$eval('#panel-onair', (p) => p.innerText)), 'no end-of-tab line about when things land', '');
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
    const play = await tvPlay(page);
    check(play.tonight && PLAYLIST.test(play.tonight.href) && play.tonight.href === tv.playlist.url && play.tonight.rel === 'noopener' && play.tonight.target === '_blank',
      'Btown TV: “Play tonight on your TV” opens tonight’s playlist in a new tab', JSON.stringify(play));
    check(play.tonight && play.tonight.text === 'Play tonight on your TV' && play.tonight.icons === 2 && play.before, 'under the Btown TV header, before the rail, with the play and external icons', JSON.stringify(play));
    check((await tvCards(page)).length === tv.shelves.find((x) => x.key === 'vt').items.length + 1, 'live: tonight’s local picks, the pick and the Burlington & Vermont shelf', '');
    await page.click('#panel-onair .btn.more:text("Read it instead")');
    await page.waitForFunction(() => /Morning\./.test(document.querySelector('.sheet-body')?.innerText || ''), null, { timeout: 4000 }).catch(() => {});
    const sheet = await page.$eval('.sheet-body', (b) => b.innerText);
    check(/Out on the water\.\.\./.test(sheet) && !/\[/.test(sheet), 'the transcript hides the voice’s pacing marks ([short pause])', sheet.slice(0, 300));
    check(!/\bAI\b|synthetic|artificial/i.test(sheet + await page.$eval('#panel-onair .audio', (a) => a.innerText)), 'no mention of AI on the card or the transcript', '');
    check(/Read to you every morning at 7\./.test(await page.$eval('#panel-onair .audio', (a) => a.innerText)), 'the card says when it is read', '');
    check(/^Morning\./.test(await page.$eval('.sheet-body .script', (b) => b.innerText)), '“Read it instead” shows the script the voice read', '');
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
    check(local.includes('The boathouse, from the pinned roster'), 'Local: a camera the data marks cam: 1 (refresh_youtube.py LIVE_ROSTER)', JSON.stringify(local));
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

  await group('On Air, Play on your TV', async () => {
    for (const playlist of ['not-tonight', 'none']) {
      const { ctx, page, errors } = await newPage(browser, base, { onair: { playlist } });
      await page.goto(base + '/all-day/#onair');
      await page.waitForSelector('#panel-onair [data-slot="tv"] .vcard', { timeout: 15000 });
      await page.waitForSelector('#panel-onair [data-sec="past"]', { timeout: 15000 });
      const play = await tvPlay(page);
      check(!play.tonight, playlist + ': no playlist tonight, no “Play tonight” button', JSON.stringify(play));
      if (playlist === 'not-tonight') check(play.past && PLAYLIST.test(play.past.href) && /on your TV$/.test(play.past.text) && /isn’t up yet/.test(play.note), 'and a quiet link to the latest night that has one, said plainly', JSON.stringify(play));
      else check(!play.past, 'none anywhere: no link at all', JSON.stringify(play));
      check(!errors.length, playlist + ': no console errors', errors.join(' | '));
      await ctx.close();
    }
    const { ctx, page } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#onair');
    await page.waitForSelector('#panel-onair [data-tvplay="tonight"]', { timeout: 8000 });
    const pages = ctx.pages().length;
    await page.click('#panel-onair [data-tvplay="tonight"]');
    await page.waitForTimeout(300);
    check(ctx.pages().length === pages && /YouTube playlist/.test(await page.$eval('#toast', (t) => t.textContent)), 'demo: the button toasts instead of leaving', '');
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
        check(/Read to you every morning at 7\./.test(await onairText(page)) && !(await page.$('#panel-onair [data-sec="brief"] p')), 'the card says when it is read; the header carries no subtitle', '');
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
    /* the pool depends on the hour and the pick on Math.random, so a real
       clock let "the answer spells out its reason" fail when a late-night
       pick had no reason to give: a Burlington afternoon and a fixed seed */
    const { ctx, page, errors } = await newPage(browser, base, { clock: etAt(14), seed: 20261017 });
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
/* ---------------------------------------------------------------- Watch */
const wPanel = '#panel-watch';
const WATCH_CHAT = 'https://www.btownbrief.com/community/channels/meetups-hangouts';
const W_DAY = 86400000;
const wDayNum = (key) => Math.round(Date.parse(key + 'T12:00:00Z') / W_DAY);
const wToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const wNorm = (t) => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 80);
/* the demo file, moved to today the way watch.js moves it */
async function watchDemo() {
  const d = JSON.parse(await readFile(path.join(APP, 'data/demo/watch.json'), 'utf8'));
  const shift = wDayNum(wToday()) - wDayNum(d._anchor);
  const move = (f) => { const nd = new Date((wDayNum(f.d) + shift) * W_DAY + 12 * 3600000).toISOString().slice(0, 10); return { ...f, d: nd, y: Number(nd.slice(0, 4)) }; };
  d.films.top = d.films.top.map(move);
  return d;
}
/* every demo rating by film id, the board's own two demo ratings included
   (boards-fake.js seeds "Winter Light" 5 stars 8 hours ago and "Causeway" 4
   stars 28 hours ago) */
function watchRatings(d) {
  const by = new Map();
  const add = (id, stars, hours) => { const a = by.get(id) || { n: 0, sum: 0, wn: 0 }; a.n++; a.sum += stars; if (hours < 168) a.wn++; by.set(id, a); };
  d.ratings.forEach(([id, stars, hours]) => add(id, stars, hours));
  const byTitle = (t) => d.films.top.find((f) => f.t === t).id;
  add(byTitle('Winter Light'), 5, 8);
  add(byTitle('Causeway'), 4, 28);
  return by;
}
/* a films.json in the contract build_films.py writes: twelve of the starter
   films as the list, and five on the coming-soon rail */
async function watchFilms() {
  const seed = JSON.parse(await readFile(path.join(APP, 'data/films-seed.json'), 'utf8'));
  const day = (n) => new Date(Date.now() + n * W_DAY).toISOString().slice(0, 10);
  const top = seed.top.slice(0, 12);
  /* a new release, and a re-release TMDB lists under its first year */
  const now = [{ ...seed.top[20], y: Number(day(-10).slice(0, 4)), d: day(-10), where: 'theaters' }, { ...seed.top[21], where: 'theaters', yt: '' }];
  const soon = [{ ...seed.top[22], id: 990001, t: 'Harbor Lights', d: day(9), where: 'theaters' },
    { ...seed.top[23], id: 990002, t: 'Plain Sight', d: day(16), where: 'streaming' },
    { ...seed.top[24], id: 990003, t: 'No Trailer Yet', d: day(30), where: 'theaters', yt: '' }];
  return { v: 1, built: new Date().toISOString(), source: 'TMDB', notice: seed.notice, images: seed.images, top, soon, now };
}
const wTiles = (page) => page.$$eval(wPanel + ' [data-grid] [data-k]', (n) => n.map((x) => x.dataset.k));

async function theWatch(browser, base) {
  await group('Watch, live from films.json', async () => {
    const films = await watchFilms();
    const { ctx, page, errors, supabase } = await newPage(browser, base, { films });
    await page.route(/youtube-nocookie\.com|youtube\.com\/embed/, (r) => r.fulfill({ status: 200, body: '<!doctype html><title>YouTube</title>', contentType: 'text/html' }));
    await page.goto(base + '/all-day/#watch');
    await page.waitForSelector(wPanel + ' [data-grid]', { timeout: 15000 });
    check(!(await page.$(wPanel + ' [data-sec="list"][data-seed]')) && /The 12 best-rated films on TMDB\./.test(await page.$eval(wPanel + ' [data-sec="list"]', (s) => s.innerText)),
      'films.json is the list, and it is not called a starter list', await page.$eval(wPanel + ' [data-sec="list"]', (s) => s.innerText));
    check(JSON.stringify(await wTiles(page)) === JSON.stringify(films.top.map((f) => 'f' + f.id)), 'every film in its TMDB order', '');
    const toc = await page.$$eval('#subnav .chip', (c) => c.map((x) => x.textContent));
    check(JSON.stringify(toc) === JSON.stringify(['Coming soon', 'The list', 'Town', 'Next screening', 'Chat']), 'the chip row is the table of contents', toc.join(' / '));
    const soon = await page.$$eval(wPanel + ' [data-sec="soon"] + .rail-wrap .poster', (n) => n.map((a) => [a.dataset.k, a.querySelector('.s').textContent, !!a.querySelector('.play')]));
    check(soon.length === 5 && soon[0][1] === 'In theaters now' && soon[1][1] === 'Back in theaters' && /· theaters$/.test(soon[2][1]) && /· streaming$/.test(soon[3][1]), 'Coming soon: in theaters now (a 1966 re-release is back in theaters), then what opens, labelled theaters or streaming', JSON.stringify(soon));
    check(JSON.stringify(soon.map((x) => x[2])) === '[true,false,true,true,false]', 'a play disc only where TMDB has a trailer', JSON.stringify(soon));
    const pics = await page.$$eval(wPanel + ' .poster img.pic', (n) => n.slice(0, 3).map((i) => [i.getAttribute('src'), i.loading]));
    check(pics.length && pics.every(([src, lazy]) => /^https:\/\/image\.tmdb\.org\/t\/p\/w342\/[A-Za-z0-9]+\.jpg$/.test(src) && lazy === 'lazy'), 'posters are TMDB paths at w342, loaded lazily', JSON.stringify(pics));
    const box = await page.$eval(wPanel + ' [data-grid] .poster .c-media', (m) => { const r = m.getBoundingClientRect(); return Math.round(r.height / r.width * 100) / 100; });
    check(box === 1.5, 'a poster reserves its 2:3 box', box);
    const credit = await page.$eval(wPanel + ' [data-credit]', (c) => ({ text: c.innerText, logo: c.querySelector('img') && c.querySelector('img').getAttribute('src'), href: c.querySelector('a').href }));
    check(/not endorsed or certified by TMDB/.test(credit.text) && credit.logo === '../assets/img/tmdb.svg' && credit.href === 'https://www.themoviedb.org/', 'TMDB’s logo and notice are on the tab', JSON.stringify(credit));

    /* nothing plays until a tap, and then in the shell's one video box */
    await page.waitForTimeout(400);
    check(await page.$eval('#vbox', (b) => b.hidden) && !(await page.$('#vbox-frame iframe')) && !(await page.$$eval('iframe, video', (n) => n.length)), 'nothing plays before a tap', '');
    const first = films.now[0];
    await page.click(wPanel + ' [data-k="soon:' + first.id + '"]');
    await page.waitForSelector('#vbox:not([hidden]) #vbox-frame iframe', { timeout: 4000 }).catch(() => {});
    const v = await page.evaluate(() => { const f = document.querySelector('#vbox-frame iframe'); return f && { src: f.getAttribute('src'), title: document.getElementById('vbox-title').textContent, frames: document.querySelectorAll('iframe').length }; });
    check(v && v.src === 'https://www.youtube-nocookie.com/embed/' + first.yt + '?autoplay=1&rel=0&playsinline=1' && v.frames === 1 && v.title === first.t + ' · trailer',
      'a tap plays that film’s TMDB trailer in the shell’s video box, and only there', JSON.stringify(v));
    await page.click('#vbox-close');
    check(await page.$eval('#vbox', (b) => b.hidden) && !(await page.$('iframe')), 'closing the box stops it', '');
    await page.click(wPanel + ' [data-k="soon:' + films.now[1].id + '"]');
    await page.waitForSelector('.sheet-body', { timeout: 4000 });
    const back = await page.$eval('.sheet-body', (b) => b.innerText);
    check(/Back in theaters/.test(back) && !/In theaters now/.test(back), 'the re-release’s sheet says it is back in theaters', back.slice(0, 120));
    await page.click('.sheet-head .iconbtn');
    await page.click(wPanel + ' [data-k="soon:990003"]');
    await page.waitForSelector('.sheet-body', { timeout: 4000 });
    check(await page.$eval('#vbox', (b) => b.hidden) && /No trailer on TMDB yet\./.test(await page.$eval('.sheet-body', (b) => b.innerText)), 'a film with no trailer opens its sheet instead, and says so', '');
    await page.click('.sheet-head .iconbtn');
    /* the film sheet's trailer button: the same box */
    await page.click(wPanel + ' [data-k="f' + films.top[1].id + '"]');
    await page.waitForSelector('.sheet-body [data-trailer]');
    const sheet = await page.$eval('.sheet-body', (b) => b.innerText);
    check(sheet.includes(films.top[1].o.slice(0, 40)) && sheet.includes(String(films.top[1].y)) && /\dh \d+m/.test(sheet) && sheet.includes(films.top[1].g[0]),
      'the film sheet: overview, year, runtime, genres', sheet.slice(0, 200));
    check(/not endorsed or certified by TMDB/.test(sheet), 'and TMDB’s notice', '');
    await page.click('.sheet-body [data-trailer]');
    await page.waitForSelector('#vbox:not([hidden]) #vbox-frame iframe', { timeout: 4000 }).catch(() => {});
    check(await page.$eval('#vbox-frame iframe', (f) => f.getAttribute('src')).catch(() => '') === 'https://www.youtube-nocookie.com/embed/' + films.top[1].yt + '?autoplay=1&rel=0&playsinline=1' &&
      await page.$eval('#sheet', (s) => s.hidden), 'Trailer in the sheet closes it and plays in the box', '');
    await page.click('#vbox-close');
    await page.screenshot({ path: path.join(SHOTS, 'live-watch-films.png') });
    check(!supabase.some((u) => /nn_post_create|nn_watch/.test(u)), 'signed out, nothing is posted or synced', supabase.join(', '));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Watch, a re-release is three or more years old (live)', async () => {
    const films = await watchFilms();
    const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric' }).format(new Date()));
    const base0 = films.now[0];
    films.now = [{ ...base0, id: 990011, t: 'Two Years On', y: year - 2, d: (year - 2) + '-05-01' },
      { ...base0, id: 990012, t: 'Three Years On', y: year - 3, d: (year - 3) + '-05-01' },
      { ...base0, id: 990013, t: 'No Year', y: undefined, d: undefined }];
    const { ctx, page, errors } = await newPage(browser, base, { films });
    await page.goto(base + '/all-day/#watch');
    await page.waitForSelector(wPanel + ' [data-sec="soon"] + .rail-wrap .poster', { timeout: 15000 });
    const got = await page.$$eval(wPanel + ' [data-sec="soon"] + .rail-wrap .poster', (n) => n.slice(0, 3).map((a) => a.querySelector('.s').textContent));
    check(JSON.stringify(got) === '["In theaters now","Back in theaters","In theaters now"]', 'two years old is in theaters now, three is back in theaters, no year is in theaters now', JSON.stringify(got));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Watch, the starter list, two dots and a reload (live, signed out)', async () => {
    const { ctx, page, errors, supabase } = await newPage(browser, base);
    await page.goto(base + '/all-day/#watch');
    await page.waitForSelector(wPanel + ' [data-grid]', { timeout: 15000 });
    const head = await page.$eval(wPanel + ' [data-sec="list"]', (s) => ({ seed: s.dataset.seed, text: s.innerText }));
    check(head.seed === '1' && /A starter list: 60 well-known films to begin with\./.test(head.text), 'the seed is labelled as a starter list', head.text);
    check(!(await page.$(wPanel + ' [data-sec="soon"]')), 'with no films.json there is no Coming soon (the seed has none)', '');
    const toc = await page.$$eval('#subnav .chip', (c) => c.map((x) => x.textContent));
    check(JSON.stringify(toc) === JSON.stringify(['The list', 'Town', 'Next screening', 'Chat']), 'and the table of contents leaves it out', toc.join(' / '));
    check((await wTiles(page)).length === 60, 'all sixty films', '');
    const dots = () => page.$$eval(wPanel + ' [data-grid] .poster', (n) => n.map((a) => [a.dataset.k, [...a.querySelectorAll('.seen i')].map((i) => (i.classList.contains('on') ? 1 : 0)).join('')]));
    check((await dots()).every((d) => d[1] === '0'), 'Just me: one dot on every poster, none filled', JSON.stringify((await dots()).slice(0, 3)));

    await page.click(wPanel + ' [data-who] button:has-text("With")');
    await page.waitForSelector('.sheet-body input[name=partner]');
    await page.fill('.sheet-body input[name=partner]', '  Sam  ');
    await page.click('.sheet-body button[type=submit]');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached' });
    check((await dots()).every((d) => d[1] === '00'), 'With Sam: a second dot on every poster', JSON.stringify((await dots()).slice(0, 3)));
    check(await page.$eval(wPanel + ' [data-who] button.on', (b) => b.textContent) === 'With Sam', 'the switch reads With Sam', '');

    const k = (await wTiles(page))[4];
    await page.click(wPanel + ' [data-k="' + k + '"]');
    await page.waitForSelector('.sheet-body [data-seen="them"]');
    await page.click('.sheet-body [data-seen="me"]');
    await page.click('.sheet-body [data-seen="them"]');
    await page.click('.sheet-body [data-want]');
    check(await page.$eval('.sheet-body [data-seen="them"]', (b) => b.getAttribute('aria-pressed')) === 'true' && /^✓ Sam has$/.test(await page.$eval('.sheet-body [data-seen="them"]', (b) => b.textContent)), 'the sheet’s toggles show what is set', '');
    await page.click('.sheet-head .iconbtn');
    const k2 = (await wTiles(page))[7];
    await page.click(wPanel + ' [data-k="' + k2 + '"]');
    await page.waitForSelector('.sheet-body [data-seen="them"]');
    await page.click('.sheet-body [data-seen="them"]');
    await page.click('.sheet-head .iconbtn');
    const d1 = Object.fromEntries(await dots());
    check(d1[k] === '11' && d1[k2] === '01' && Object.values(d1).filter((v) => v !== '00').length === 2, 'both dots on one film, the partner’s on another, the rest empty', JSON.stringify([d1[k], d1[k2]]));
    await page.reload();
    await page.waitForSelector(wPanel + ' [data-grid]', { timeout: 15000 });
    const d2 = Object.fromEntries(await dots());
    check(d2[k] === '11' && d2[k2] === '01' && Object.values(d2).every((v) => v.length === 2), 'after a reload: still With Sam, both dots where they were', JSON.stringify([d2[k], d2[k2]]));
    await page.click(wPanel + ' [data-show] button:has-text("Want to watch")');
    check(JSON.stringify(await wTiles(page)) === JSON.stringify([k]), 'Want to watch shows the one film on the list', JSON.stringify(await wTiles(page)));
    await page.click(wPanel + ' [data-show] button:has-text("Neither of us")');
    check((await wTiles(page)).length === 58 && !(await wTiles(page)).includes(k) && !(await wTiles(page)).includes(k2), 'Neither of us leaves out both seen films', (await wTiles(page)).length);
    await page.click(wPanel + ' [data-show] button:has-text("All")');
    await page.click(wPanel + ' [data-who] button:has-text("Just me")');
    check((await dots()).every((d) => d[1].length === 1) && Object.fromEntries(await dots())[k] === '1', 'Just me again: one dot, and yours is kept', '');

    /* rating, signed out: told it is one email, nothing sent */
    await page.click(wPanel + ' [data-k="' + k + '"]');
    await page.waitForSelector('.sheet-body [data-stars="4"]');
    await page.click('.sheet-body [data-stars="4"]');
    const said = await page.$eval('.sheet-body [data-msg]', (m) => m.textContent);
    check(/one email/.test(said) && await page.$('.sheet-body [data-signin]') !== null, 'signed out, a star says rating is one email to sign in, with the button', said);
    check(!supabase.some((u) => /nn_post_create/.test(u)), 'and nothing is posted', supabase.join(', '));
    await page.click('.sheet-head .iconbtn');

    const doors = await page.$$eval(wPanel + ' [data-door]', (a) => a.map((x) => [x.dataset.door, x.getAttribute('href')]));
    check(JSON.stringify(doors) === JSON.stringify([['community', WATCH_CHAT], ['telegram', '../telegram.html']]), 'Watch chat: a door to the community channel and to Telegram', JSON.stringify(doors));
    check(await page.$(wPanel + ' [data-chat] input, ' + wPanel + ' [data-chat] textarea') === null, 'no chat is built here', '');
    const town = await page.$eval(wPanel + ' [data-slot="town"]', (s) => s.innerText);
    check(/No film has three ratings this week yet/.test(town), 'with no ratings yet, town ratings say so', town);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Watch, a signed-in reader’s dots follow them, and a cleared dot stays cleared (live)', async () => {
    const seed = JSON.parse(await readFile(path.join(APP, 'data/films-seed.json'), 'utf8'));
    const [A, B, C, Dd] = seed.top.map((f) => f.id);
    const server = { partner: 'Sam', seen: new Map([[A, [true, false]], [B, [false, true]]]) };
    const sets = [];
    const rpc = (fn, body) => {
      if (fn === 'nn_watch_seen_get') return { partner: server.partner, seen: [...server.seen].map(([f, v]) => [f, v[0], v[1]]) };
      if (fn === 'nn_watch_seen_set') {
        sets.push(body);
        if (body.p_me || body.p_partner) server.seen.set(body.p_film, [!!body.p_me, !!body.p_partner]); else server.seen.delete(body.p_film);
        if (body.p_partner_name != null) server.partner = body.p_partner_name || null;
        return { film: body.p_film, me: !!body.p_me, partner: !!body.p_partner };
      }
      return undefined;
    };
    const { ctx, page, errors } = await newPage(browser, base, { rpc });
    await page.goto(base + '/all-day/?x=1');
    await page.evaluate(([s, c]) => { localStorage.setItem('allday-auth', s); localStorage.setItem('allday-watch', JSON.stringify({ mode: 'me', seen: { [c]: [1, 0] } })); }, [SESSION(), C]);
    await page.goto(base + '/all-day/#watch');
    await page.waitForSelector(wPanel + ' [data-grid]', { timeout: 15000 });
    await page.waitForFunction((c) => { const w = JSON.parse(localStorage.getItem('allday-watch') || '{}'); return w.syncedFor && !Object.keys(w.dirty || {}).length; }, C, { timeout: 6000 }).catch(() => {});
    const local = () => page.evaluate(() => JSON.parse(localStorage.getItem('allday-watch') || '{}'));
    let w = await local();
    check(JSON.stringify(w.seen) === JSON.stringify({ [A]: [1, 0], [B]: [0, 1], [C]: [1, 0] }) && w.partner === 'Sam', 'signing in joins the phone’s dots with the account’s, and takes the partner’s name', JSON.stringify(w));
    check(sets.length === 1 && sets[0].p_film === C && sets[0].p_me === true && server.seen.has(C), 'only the phone’s own film is sent up', JSON.stringify(sets));
    /* the other phone clears A */
    server.seen.delete(A);
    sets.length = 0;
    await page.reload();
    await page.waitForSelector(wPanel + ' [data-grid]', { timeout: 15000 });
    await page.waitForFunction((a) => !(a in (JSON.parse(localStorage.getItem('allday-watch') || '{}').seen || {})), A, { timeout: 6000 }).catch(() => {});
    w = await local();
    check(!(A in w.seen) && w.seen[B] && w.seen[C], 'a dot cleared on the other phone stays cleared here', JSON.stringify(w.seen));
    check(!sets.length && !server.seen.has(A), 'and is not sent back up', JSON.stringify(sets));
    /* a dot set here is saved to the account at once */
    await page.click(wPanel + ' [data-k="f' + Dd + '"]');
    await page.waitForSelector('.sheet-body [data-seen="me"]');
    await page.click('.sheet-body [data-seen="me"]');
    await page.waitForFunction(() => !Object.keys(JSON.parse(localStorage.getItem('allday-watch') || '{}').dirty || {}).length, null, { timeout: 4000 }).catch(() => {});
    check(server.seen.get(Dd) && server.seen.get(Dd)[0] === true && sets.length === 1, 'a dot set in the sheet goes to the account', JSON.stringify(sets));
    /* "Delete my account and posts": the phone forgets them too, so the next sign-in sends nothing back up */
    await page.evaluate(() => { localStorage.setItem('allday-watch', JSON.stringify({ ...JSON.parse(localStorage.getItem('allday-watch')), want: { 1: 1 } })); });
    await page.reload();
    await page.waitForSelector(wPanel + ' [data-grid]', { timeout: 15000 });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('allday-boards', { detail: { board: null, id: null, what: 'deleteme' } })));
    w = await local();
    check(!Object.keys(w.seen).length && !w.partner && !w.syncedFor && !Object.keys(w.rated || {}).length && w.want && w.want[1] === 1,
      'deleting the account clears this phone’s dots, partner and ratings; the want list stays', JSON.stringify(w));
    check(!(await page.$$eval(wPanel + ' [data-grid] [data-dot].on', (d) => d.length)), 'and the grid shows no dots', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Watch, a missing films branch falls back to the starter list (live)', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { films: null });
    await page.goto(base + '/all-day/#watch');
    await page.waitForSelector(wPanel + ' [data-grid]', { timeout: 15000 });
    check(await page.$(wPanel + ' [data-sec="list"][data-seed]') !== null && (await wTiles(page)).length === 60, 'a 404 from films-data: the starter list, labelled', '');
    check(errors.every((e) => /404/.test(e)), 'and nothing but the 404 itself in the console', errors.join(' | '));
    await ctx.close();
  });

  await group('Watch, filters and the rating sort on frozen data (demo)', async () => {
    const d = await watchDemo();
    const ratings = watchRatings(d);
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#watch');
    await page.waitForSelector(wPanel + ' [data-grid] .rate', { timeout: 15000 });
    check(JSON.stringify(await wTiles(page)) === JSON.stringify(d.films.top.map((f) => 'f' + f.id)), 'all sixty, in list order', '');
    const today = wDayNum(wToday());
    const ago = (f) => today - wDayNum(f.d);
    const windows = { '1m': [0, 31], '6m': [0, 183], '1y': [0, 366], '2y': [0, 731], '5y': [0, 1827], '10y': [0, 3653], '15y': [0, 5479], '20y': [0, 7305], '20p': [7306, Infinity] };
    const homeless = d.films.top.filter((f) => !Object.values(windows).some(([lo, hi]) => ago(f) >= lo && ago(f) <= hi));
    check(!homeless.length, 'every released film falls in at least one dated window', homeless.map((f) => f.t).join(', '));
    for (const [key, [lo, hi]] of Object.entries(windows)) {
      await page.click(wPanel + ' [data-filter="recency"] [data-chip="' + key + '"]');
      const want = d.films.top.filter((f) => ago(f) >= lo && ago(f) <= hi).map((f) => 'f' + f.id);
      const got = await wTiles(page);
      check(want.length && JSON.stringify(got) === JSON.stringify(want), 'recency ' + key + ': ' + want.length + ' films, by release date', JSON.stringify([got.length, want.length]));
    }
    await page.click(wPanel + ' [data-filter="recency"] [data-chip="10y"]');
    await page.click(wPanel + ' [data-filter="genre"] [data-chip="Comedy"]');
    const both = d.films.top.filter((f) => ago(f) <= 3653 && f.g.includes('Comedy')).map((f) => 'f' + f.id);
    check(both.length && JSON.stringify(await wTiles(page)) === JSON.stringify(both), 'genre and recency together: comedies from the last ten years', JSON.stringify(await wTiles(page)));
    const chipN = await page.$eval(wPanel + ' [data-filter="genre"] [data-chip="Drama"] .n', (n) => Number(n.textContent));
    check(chipN === d.films.top.filter((f) => ago(f) <= 3653 && f.g.includes('Drama')).length, 'a genre chip counts within the chosen recency', chipN);
    await page.click(wPanel + ' [data-filter="recency"] [data-chip="any"]');
    await page.click(wPanel + ' [data-filter="genre"] [data-chip="Horror"]');
    check(JSON.stringify(await wTiles(page)) === JSON.stringify(d.films.top.filter((f) => f.g.includes('Horror')).map((f) => 'f' + f.id)), 'Horror alone', '');
    await page.click(wPanel + ' [data-filter="genre"] [data-chip="all"]');

    /* the town rating on posters: only from three ratings, and the sort */
    const rated = d.films.top.filter((f) => (ratings.get(f.id) || { n: 0 }).n >= 3);
    const avg = (f) => ratings.get(f.id).sum / ratings.get(f.id).n;
    const shown = await page.$$eval(wPanel + ' [data-grid] .poster', (n) => n.filter((a) => a.querySelector('.rate')).map((a) => a.dataset.k));
    check(JSON.stringify(shown.sort()) === JSON.stringify(rated.map((f) => 'f' + f.id).sort()), 'a town rating only on films with three or more ratings (' + rated.length + ')', JSON.stringify(shown));
    check(!shown.includes('f' + d.films.top.find((f) => f.t === 'Causeway').id), 'Causeway, with two, shows none', '');
    await page.click(wPanel + ' [data-sort] button:has-text("Town rating")');
    const order = rated.slice().sort((a, b) => avg(b) - avg(a) || ratings.get(b.id).n - ratings.get(a.id).n || d.films.top.indexOf(a) - d.films.top.indexOf(b)).map((f) => 'f' + f.id);
    const sorted = await wTiles(page);
    check(JSON.stringify(sorted.slice(0, rated.length)) === JSON.stringify(order), 'Town rating: the rated films first, highest average first', JSON.stringify([sorted.slice(0, rated.length), order]));
    const rest = d.films.top.filter((f) => !rated.includes(f)).map((f) => 'f' + f.id);
    check(JSON.stringify(sorted.slice(rated.length)) === JSON.stringify(rest), 'then the rest in list order', '');
    await page.click(wPanel + ' [data-sort] button:has-text("List order")');
    check(JSON.stringify(await wTiles(page)) === JSON.stringify(d.films.top.map((f) => 'f' + f.id)), 'List order puts it back', '');
    const soon = await page.$$eval(wPanel + ' [data-sec="soon"] + .rail-wrap .poster', (n) => n.length);
    check(soon === d.films.soon.length + d.films.now.length && soon === 10, 'Coming soon: ten trailers', soon);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Watch, town ratings and the screening vote (demo)', async () => {
    const d = await watchDemo();
    const ratings = watchRatings(d);
    const { ctx, page, errors, supabase } = await newPage(browser, base, { viewport: { width: 1280, height: 800 }, scheme: 'dark' });
    await page.goto(base + '/all-day/?demo=1#watch/town');
    await page.waitForSelector(wPanel + ' [data-slot="town"] .lrow', { timeout: 15000 });
    const rows = await page.$$eval(wPanel + ' [data-slot="town"] .lrow', (n) => n.map((r) => [r.dataset.k, Number(r.dataset.n), r.querySelector('.t').textContent]));
    const want = d.films.top.filter((f) => (ratings.get(f.id) || { wn: 0 }).wn >= 3);
    check(rows.length === want.length && rows.every((r) => r[1] >= 3), 'town ratings this week: only films with three or more this week (' + want.length + ')', JSON.stringify(rows));
    check(JSON.stringify(rows.map((r) => r[0]).sort()) === JSON.stringify(want.map((f) => 'town:' + f.id).sort()), 'exactly those films', '');
    check(!rows.some((r) => /Causeway|Kindling/.test(r[2])), 'Causeway and Kindling, two ratings each this week, are left out', '');
    check(rows.every((r, i) => i === 0 || rows[i - 1][1] >= r[1]), 'most-rated first', '');

    const opts = () => page.$$eval(wPanel + ' [data-ballot] .vote-opt', (n) => n.map((o) => ({ k: o.dataset.k, on: o.getAttribute('aria-pressed'), n: o.querySelector('.l span').textContent, w: parseFloat(o.querySelector('.bar i').style.width) })));
    const before = await opts();
    check(before.length === 5, 'five films on the ballot', JSON.stringify(before));
    check(before.every((o, i) => i === 0 || parseFloat(before[i - 1].n) >= parseFloat(o.n)), 'most votes first', JSON.stringify(before.map((o) => o.n)));
    check(/At five votes Stephen books it, puts it on Meetup/.test(await page.$eval(wPanel + ' [data-sec="vote"]', (s) => s.innerText)), 'it says what five votes does', '');
    const target = before[2];
    await page.click(wPanel + ' [data-k="' + target.k + '"]');
    await page.waitForFunction((k) => document.querySelector('#panel-watch [data-k="' + k + '"]').getAttribute('aria-pressed') === 'true', target.k);
    await page.waitForTimeout(150);
    const after = (await opts()).find((o) => o.k === target.k);
    check(parseFloat(after.n) === parseFloat(target.n) + 1 && after.w > target.w, 'a vote raises its count and its bar', JSON.stringify([target, after]));
    const other = before[3];
    await page.click(wPanel + ' [data-k="' + other.k + '"]');
    await page.waitForFunction((k) => document.querySelector('#panel-watch [data-k="' + k + '"]').getAttribute('aria-pressed') === 'true', other.k);
    await page.waitForTimeout(150);
    const now = await opts();
    check(now.find((o) => o.k === target.k).on === 'false' && parseFloat(now.find((o) => o.k === target.k).n) === parseFloat(target.n), 'one vote each: voting for another takes the first back', JSON.stringify(now));
    const four = before.find((o) => o.n === '4 of 5');
    await page.click(wPanel + ' [data-k="' + four.k + '"]');
    await page.waitForFunction((k) => /going on Meetup/.test(document.querySelector('#panel-watch [data-k="' + k + '"]').innerText), four.k, { timeout: 4000 }).catch(() => {});
    check(/5 · going on Meetup/.test(await page.$eval(wPanel + ' [data-k="' + four.k + '"]', (o) => o.innerText)) &&
      await page.$eval(wPanel + ' [data-k="' + four.k + '"] .bar i', (i) => i.style.width) === '100%', 'the fifth vote fills the bar and says it is going on Meetup', '');
    const scr = await page.$eval(wPanel + ' [data-screening]', (c) => c.innerText);
    check(/The Long Lake, Friday at the Roxy/.test(scr) && /The Roxy/.test(scr), 'a pick with a place is the screening card', scr);
    await page.screenshot({ path: path.join(SHOTS, 'demo-watch-desktop-dark.png') });
    check(!supabase.length, 'the demo never calls Supabase', supabase.join(', '));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Watch, the server keeps one vote each, even one cast on another device (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#watch/vote');
    await page.waitForSelector(wPanel + ' [data-ballot] .vote-opt', { timeout: 15000 });
    const opts = () => page.$$eval(wPanel + ' [data-ballot] .vote-opt', (n) => n.map((o) => ({ k: o.dataset.k, on: o.getAttribute('aria-pressed'), n: parseFloat(o.querySelector('.l span').textContent) })));
    const before = await opts();
    const [a, b] = [before[0], before[1]];
    /* the same reader votes for the first pick somewhere this tab never hears about */
    await page.evaluate((id) => Promise.all([import('/all-day/js/boards.js'), import('/all-day/js/store.js')]).then(([B, st]) => B._fake().as(null).call('nn_vote', { p_post: id, p_player: st.playerId() })), a.k.slice(5));
    await page.click(wPanel + ' [data-k="' + b.k + '"]');
    await page.waitForFunction((k) => document.querySelector('#panel-watch [data-k="' + k + '"]').getAttribute('aria-pressed') === 'true', b.k);
    await page.waitForTimeout(200);
    const now = await opts();
    const counts = await fakeOf(page, `(f) => [f._count('${a.k.slice(5)}'), f._count('${b.k.slice(5)}')]`);
    check(counts[0] === a.n && counts[1] === b.n + 1, 'voting for the second moved the vote off the first, on the server', JSON.stringify([a, b, counts]));
    const na = now.find((o) => o.k === a.k);
    check(na && na.n === a.n && na.on === 'false', 'and the tab shows the first back where it was', JSON.stringify(now));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Watch, a rating posts with stars in meta (demo)', async () => {
    const d = await watchDemo();
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#watch');
    await page.waitForSelector(wPanel + ' [data-grid] .rate', { timeout: 15000 });
    const f = d.films.top.find((x) => x.t === 'Fieldwork');
    await page.click(wPanel + ' [data-k="f' + f.id + '"]');
    await page.waitForSelector('.sheet-body [data-stars="4"]');
    await page.click('.sheet-body [data-stars="4"]');
    check(/one email/.test(await page.$eval('.sheet-body [data-msg]', (m) => m.textContent)), 'signed out: rating asks for the sign-in', '');
    await page.click('.sheet-head .iconbtn');
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    const before = await fakeOf(page, (x) => x.posts.filter((p) => p.board === 'watch' && p.kind === 'rating').length);
    await page.click(wPanel + ' [data-k="f' + f.id + '"]');
    await page.waitForSelector('.sheet-body [data-stars="4"]');
    await page.click('.sheet-body [data-where] button:has-text("In a theater")');
    await page.click('.sheet-body [data-stars="4"]');
    await page.waitForSelector('.sheet-body [data-rate] input[name=display_name]', { timeout: 4000 });
    check(/Add your first name/.test(await page.$eval('.sheet-body [data-msg]', (m) => m.textContent)), 'no first name yet: asked for one, in place', '');
    await page.fill('.sheet-body [data-rate] input[name=display_name]', 'Maya');
    await page.click('.sheet-body [data-rate] button[type=submit]');
    await page.waitForFunction(() => /^Rated 4 stars/.test(document.querySelector('.sheet-body [data-msg]').textContent), null, { timeout: 4000 }).catch(() => {});
    const post = await fakeOf(page, (x) => { const p = x.posts.filter((q) => q.board === 'watch' && q.kind === 'rating').pop(); return { n: x.posts.filter((q) => q.board === 'watch' && q.kind === 'rating').length, title: p.title, meta: p.meta, exp: p.expires_at }; });
    check(post.n === before + 1 && post.title === 'Fieldwork' && JSON.stringify(post.meta) === JSON.stringify({ stars: 4, film: f.id, year: f.y, where: 'In a theater' }) && post.exp === null,
      'a rating post on the watch board: the title, and stars, the film’s TMDB id, year and where in meta; it never expires', JSON.stringify(post));
    check(await page.$$eval('.sheet-body [data-stars].on', (n) => n.length) === 4, 'four stars lit', '');
    /* Fieldwork had one demo rating; with Maya's it has two, still not shown */
    await page.click('.sheet-head .iconbtn');
    await page.waitForTimeout(300);
    check(!(await page.$(wPanel + ' [data-k="f' + f.id + '"] .rate')), 'two ratings: still no town rating on the poster', '');
    /* a new rating replaces the reader's last one */
    await page.click(wPanel + ' [data-k="f' + f.id + '"]');
    await page.waitForSelector('.sheet-body [data-stars="2"]');
    await page.click('.sheet-body [data-stars="2"]');
    await page.waitForFunction(() => /^Rated 2 stars/.test(document.querySelector('.sheet-body [data-msg]').textContent), null, { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(300);
    const mine = await fakeOf(page, (x) => x.posts.filter((q) => q.board === 'watch' && q.kind === 'rating' && q.title === 'Fieldwork').map((q) => q.meta.stars));
    check(JSON.stringify(mine.sort()) === JSON.stringify([2, 5]), 'rating again replaces your last rating: one each, the old one gone', JSON.stringify(mine));
    await page.click('.sheet-head .iconbtn');

    /* a pick from the list */
    await page.click(wPanel + ' [data-suggest]');
    await page.waitForSelector('.sheet-body [data-results] [data-film]');
    await page.fill('.sheet-body input[type=search]', 'orchard');
    await page.waitForTimeout(100);
    const hits = await page.$$eval('.sheet-body [data-film]', (n) => n.map((x) => x.dataset.film));
    const orchard = d.films.top.find((x) => x.t === 'Orchard');
    check(JSON.stringify(hits) === JSON.stringify([String(orchard.id)]), 'the suggest sheet picks a film from the list', JSON.stringify(hits));
    await page.click('.sheet-body [data-film] button');
    await page.waitForFunction(() => [...document.querySelectorAll('#panel-watch [data-ballot] .vote-opt')].some((o) => /Orchard/.test(o.innerText)), null, { timeout: 4000 }).catch(() => {});
    const pick = await fakeOf(page, (x) => { const p = x.posts.filter((q) => q.board === 'watch' && q.kind === 'pick').pop(); return { title: p.title, meta: p.meta, days: Math.round((p.expires_at - p.created_at) / 86400000) }; });
    check(pick.title === 'Orchard' && JSON.stringify(pick.meta) === JSON.stringify({ film: orchard.id, year: orchard.y }) && pick.days === 30, 'it posts a pick (title, TMDB id, year; 30 days) and lands on the ballot', JSON.stringify(pick));
    await page.click(wPanel + ' [data-suggest]');
    await page.fill('.sheet-body input[type=search]', 'orchard');
    await page.waitForTimeout(100);
    const count = await fakeOf(page, (x) => x.posts.filter((q) => q.board === 'watch' && q.kind === 'pick').length);
    await page.click('.sheet-body [data-film] button');
    await page.waitForTimeout(300);
    check(await fakeOf(page, (x) => x.posts.filter((q) => q.board === 'watch' && q.kind === 'pick').length) === count, 'one pick per film: suggesting it again votes for it instead', '');
    await pageRules(page, 'watch', 390);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Watch, deep links (demo)', async () => {
    const d = await watchDemo();
    const { ctx, page, errors } = await newPage(browser, base);
    const far = d.films.top[57];
    await page.goto(base + '/all-day/?demo=1#watch/f' + far.id);
    check(await flashes(page, 'f' + far.id), 'a film far down the list lands and flashes', '');
    await page.goto(base + '/all-day/?demo=1#watch/soon:' + d.films.soon[3].id);
    await page.reload();
    check(await flashes(page, 'soon:' + d.films.soon[3].id), 'a coming-soon poster lands and flashes', '');
    await page.goto(base + '/all-day/?demo=1#watch/f1');
    await page.reload();
    await page.waitForSelector('#toast:not([hidden])', { timeout: 6000 }).catch(() => {});
    check(/moved on/.test(await page.$eval('#toast', (t) => t.textContent)), 'a film that is not on the list says it has moved on', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });
}

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
    B.draw(host, r.posts, { meta: board === 'vintage' ? meta : undefined });
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
    check(p.ok && JSON.stringify(p.profile) === JSON.stringify({ display_name: 'Maya R.', neighborhood: 'old-north-end', archetype: 'trail', interests: [] }), 'saved, tidied, and read back', JSON.stringify(p));
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

  await group('boards: the profile sheet says what you’re into, activities only (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#vintage');
    await settle(page);
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.setProfile({ display_name: 'Maya', interests: ['books'] })));
    await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.profileSheet()));
    await page.waitForSelector('.sheet-body [data-interests] button');
    const pills = await page.$$eval('.sheet-body [data-interests] button', (bs) => bs.map((b) => [b.dataset.k, b.getAttribute('aria-pressed')]));
    check(pills.length === 10 && JSON.stringify(pills.find((x) => x[0] === 'books')) === '["books","true"]', 'the ten activities, with the one already chosen on', JSON.stringify(pills));
    const words = await page.$eval('.sheet-body [data-interests]', (b) => b.parentNode.innerText);
    check(!/LGBTQ|woman|student|gender|\bage\b/i.test(words) && /nobody sees them unless you join/i.test(words), 'activities only, never who someone is, and who sees them is said', words);
    for (const k of ['running', 'games', 'music', 'dance', 'making', 'languages', 'food', 'sports', 'outdoors']) await page.click('.sheet-body [data-interests] button[data-k="' + k + '"]');
    const on = await page.$$eval('.sheet-body [data-interests] button.on', (bs) => bs.length);
    check(on === 8, 'eight at most: books and the first seven tapped; sports and outdoors, the ninth and tenth, do nothing', on);
    await page.click('.sheet-body [data-interests] button[data-k="books"]');
    await page.click('.sheet-body .bform button[type=submit]');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached', timeout: 4000 });
    const saved = await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b._fake().profiles.get(b.demoReader).interests));
    check(JSON.stringify(saved) === '["running","games","music","dance","making","languages","food"]', 'books tapped off, the seven saved to the profile, in the list’s order', JSON.stringify(saved));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('boards desk: People’s Meetup list and the stray-photo sweep (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/mod.html?demo=1');
    await page.fill('#pass', 'demo');
    await page.click('#gate button[type=submit]');
    await page.waitForSelector('#desk:not([hidden]) [data-meetups]');
    await page.waitForSelector('[data-sweep]', { timeout: 4000 }).catch(() => {});
    const sweep = await page.$eval('[data-sweep]', (p) => p.textContent).catch(() => '');
    check(/1 stray picture file cleared from the bucket/.test(sweep), 'opening the desk sweeps stray photos and says what went', sweep);
    await page.click('[data-meetups]');
    await page.waitForSelector('[data-meetup]');
    const rows = await page.$$eval('[data-meetup]', (rs) => rs.map((r) => r.innerText));
    check(rows.length === 1 && /Pickup soccer, need four more/.test(rows[0]) && /Sunday, 10 am · Leddy Park · 4 spots · mostly 30s · hosted by Dev K\. · 7 going/.test(rows[0]),
      'the Meetup button lists the live plans down for Meetup: when, where, spots, ages, host, going', JSON.stringify(rows));
    check(/Copy for Meetup/.test(rows[0]) && !/@/.test(rows[0]), 'each with a copy button, and no email', rows[0]);
    await page.click('#desk [data-action="hide"]');
    await page.waitForTimeout(200);
    check(await page.$$eval('[data-sweep]', (n) => n.length) === 1, 'the sweep runs once a visit, and its note stays through a redraw', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('boards desk: the sweep removes strays through the Storage API, and says when it cannot (live)', async () => {
    for (const ok of [true, false]) {
      const asked = [];
      const { ctx, page, errors } = await newPage(browser, base, {
        rpc: (fn, args) => {
          if (fn === 'nn_mod_list') return { waiting: [], reported: [], hidden: [], recent: [], bans: [] };
          if (fn === 'nn_mod_photo_sweep') return { abandoned: 2, strays: ['submissions/lost-0001.jpg', 'submissions/lost-0002.jpg'] };
          if (fn === 'nn_people_meetup_list') return { status: 404, body: { code: 'PGRST202', message: 'Could not find the function' } };
          return undefined;
        },
      });
      await page.route(/\/storage\/v1\/object\/btb-photos$/, (r) => {
        asked.push({ method: r.request().method(), body: JSON.parse(r.request().postData() || '{}') });
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ok ? [{ name: 'submissions/lost-0001.jpg' }, { name: 'submissions/lost-0002.jpg' }] : []) });
      });
      await page.goto(base + '/all-day/mod.html');
      await page.fill('#pass', 'test-pass');
      await page.click('#gate button[type=submit]');
      await page.waitForSelector('[data-sweep]', { timeout: 6000 }).catch(() => {});
      const sweep = await page.$eval('[data-sweep]', (p) => p.textContent).catch(() => '');
      check(asked.length === 1 && asked[0].method === 'DELETE' && JSON.stringify(asked[0].body) === '{"prefixes":["submissions/lost-0001.jpg","submissions/lost-0002.jpg"]}',
        'the strays go to the Storage API’s remove, by path', JSON.stringify(asked));
      if (ok) check(/2 board photos nobody posted left the photo queue; 2 stray picture files cleared/.test(sweep), 'removed: the note counts both', sweep);
      else check(/2 stray picture files are waiting: the bucket would not let the desk remove them/.test(sweep), 'refused: the note says they are waiting and where to look', sweep);
      if (!ok) {
        await page.click('[data-meetups]');
        await page.waitForSelector('[data-meetups] ~ *, #desk .sheet-note', { timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(200);
        check(/paste all-day\/supabase\/nn-ROUND2\.sql/.test(await page.$eval('#desk', (d) => d.innerText)), 'the Meetup list before the paste says what to paste', '');
      }
      check(!errors.filter((e) => !/404/.test(e)).length, 'no console errors (beyond the 404 of a list not pasted yet)', errors.join(' | '));
      await ctx.close();
    }
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
    check(t1.n === t0.n + 1 && new RegExp(t1.n + ' finds posted here found a home lately').test(t1.text), 'the thank-you line counts one more find gone home', JSON.stringify([t0, t1]));
    check(/No points and no prizes/.test(t1.text) && !/raffle|enter to win|\bearn|\bdraw\b/i.test(t1.text), 'a thank-you, not points, prizes or a raffle', t1.text);
    check(!(await page.$(vslot('spotted') + ' .card.board[data-k="b-' + id + '"]')), 'and the find leaves the grid', '');
    const got = await fakeOf(page, `(f) => { const p = f.posts.find((x) => x.id === '${id}'); return p && { got: p.meta.got, shop: p.meta.shop }; }`);
    check(got && got.got === true && got.shop === 'A stall at the Saturday market', 'the post’s got box is ticked on the board (boards.put), so everyone’s thank-you counts it', JSON.stringify(got));
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
    const sent = await fakeOf(page, `(x) => { const p = x.posts[x.posts.length - 1]; return { kind: p.kind, meta: p.meta, title: p.title, body: p.body, photo: x._photoState(p.photo_path), n: x.posts.length, ends: p.expires_at }; }`);
    check(sent.n === before.posts + 1 && sent.kind === 'design' && sent.title === 'Rainy Church Street' && sent.ends === null, 'sent: a Vintage `design` post, which never ends', JSON.stringify(sent));
    check(JSON.stringify(sent.meta) === '{"thanks":"shirts"}' && sent.body === 'Ink, from the corner by the steeple' && sent.photo === 'pending',
      'the artist’s choice is its `thanks` field, the line is its body, and its picture waits in the photo queue', JSON.stringify(sent));
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
    const invented = file.shops.filter((s) => s.hours && !(byId[s.id].hours && byId[s.id].checked && byId[s.id].checked.date && /^https?:\/\//.test(byId[s.id].checked.source || '')));
    check(!invented.length, 'every hour comes from the shop’s own things.json entry, with the date and page it was checked on', JSON.stringify(invented.map((s) => s.name)));
    const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const drift = file.shops.filter((s) => { const h = byId[s.id].hours; return h ? DAYS.some((d) => !s.week || s.week[d] !== h[d]) : !!(s.week || s.hours); });
    check(!drift.length, 'each shop’s week is its things.json hours, day by day', JSON.stringify(drift.map((s) => s.name)));
    const shown = rows.map((r, i) => {
      const s = file.shops[i];
      return s.hours ? r.hours.startsWith(s.hours) : s.checked ? r.hours.startsWith('No weekly hours posted; call ahead') : r.hours === 'Hours not checked yet';
    });
    check(shown.every(Boolean), 'hours show only where the guide has them; a checked shop without them says call ahead, the rest “Hours not checked yet”', JSON.stringify(rows.map((r) => r.hours)));
    check(rows.every((r) => /^https:\/\/www\.google\.com\/maps\/search\//.test(r.map)), 'Map opens a search on Google Maps', rows[0].map);
    check(file.shops.every((s) => Array.isArray(s.gaps)) && file.gaps, 'gaps are marked in the file for Stephen to fill', JSON.stringify(file.gaps));
    const noStreet = things.filter((t) => t.group === 'Shopping' && !/^\d/.test(t.address || '')).map((t) => t.id);
    check(file.shops.every((s) => /^\d/.test(s.address || '')) && file.left_out.every((s) => noStreet.includes(s.id)),
      'every shop in the walk has a street address; a shop without one is named in left_out instead', JSON.stringify(file.left_out));
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

  /* v 0: the rules could not be read (a server error), so the tab cannot tell which server it has */
  for (const v of [1, 2, 0]) await group('Vintage, live: a fit check and “Someone got it” on a server with rules ' + (v ? 'v' + v : 'that could not be read'), async () => {
    const at = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const mineFind = { id: '0000eeee-0000-4000-8000-000000000001', board: 'vintage', kind: 'spotted', title: 'Plaid wool shirt', body: '', place: '', meta: { shop: 'Old Gold', size: 'L' },
      photo: null, author: 'Kara', author_arch: null, created_at: at(3), expires_at: new Date(Date.now() + 18 * 86400000).toISOString(), votes: 0, voted: false, mine: true };
    const calls = [];
    let got = false, gone = false;
    const { ctx, page, errors } = await newPage(browser, base, {
      rpc: (fn, args) => {
        if (!/^nn_|^btb_/.test(fn)) return undefined;
        calls.push({ fn, args });
        if (fn === 'nn_rules') return v ? { version: v } : { status: 500, body: { message: 'boom' } };
        if (fn === 'nn_profile_get') return { display_name: 'Kara', neighborhood: null, archetype: null };
        if (fn === 'nn_posts_list') return args.p_board === 'vintage' && args.p_filter.kind === 'spotted' && !gone ? [{ ...mineFind, meta: got ? { ...mineFind.meta, got: true } : mineFind.meta }] : [];
        if (fn === 'nn_post_create') return { id: '0000eeee-0000-4000-8000-000000000002', board: 'vintage', kind: args.p_kind, title: args.p_title, body: args.p_body, place: '', meta: args.p_meta,
          photo: null, author: 'Kara', author_arch: null, created_at: at(0), expires_at: null, votes: 0, voted: false, mine: true, status: 'approved' };
        if (fn === 'nn_post_meta_set') {
          if (v === 1) return { status: 404, body: { code: 'PGRST202', message: 'Could not find the function public.nn_post_meta_set' } };
          got = true;
          return { ...mineFind, meta: { ...mineFind.meta, ...args.p_meta }, status: 'approved' };
        }
        if (fn === 'nn_post_delete_own') { gone = true; return { deleted: true }; }
        return undefined;
      },
    });
    await page.goto(base + '/all-day/?x=1');
    await page.evaluate((s) => localStorage.setItem('allday-auth', s), SESSION());
    await page.goto(base + '/all-day/#vintage');
    await settle(page);
    await page.waitForSelector(vslot('spotted') + ' [data-act=vgot]');
    await page.click(vslot('fit') + ' .addrow button');
    const f = '.sheet-body form[data-form="fit"]';
    await page.waitForSelector(f);
    /* a real picture, so photos-lib.js can resize it to a jpeg */
    await page.evaluate(async (sel) => {
      const c = document.createElement('canvas'); c.width = 8; c.height = 8; c.getContext('2d').fillRect(0, 0, 8, 8);
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'fit.png', { type: 'image/png' }));
      const i = document.querySelector(sel);
      i.files = dt.files;
      i.dispatchEvent(new Event('change'));
    }, f + ' input[type=file]');
    await page.fill(f + ' input[name=title]', 'All thrifted except the socks');
    await page.fill(f + ' input[name=note]', 'Coat from Barge Canal');
    await page.check(f + ' input[name=consent]');
    await page.click(f + ' button[type=submit]');
    await page.waitForFunction(() => /^Posted\./.test(document.querySelector('#toast').textContent), null, { timeout: 8000 }).catch(() => {});
    const made = (calls.find((c) => c.fn === 'nn_post_create') || {}).args || { msg: await page.$eval(f + ' .bf-msg', (m) => m.textContent).catch(() => '') };
    if (v === 2) check(made.p_kind === 'fit' && JSON.stringify(made.p_meta) === '{}' && made.p_body === 'Coat from Barge Canal', 'round two: a fit check is a `fit` post', JSON.stringify(made));
    else check(made.p_kind === 'spotted' && JSON.stringify(made.p_meta) === '{"shop":"Fit check"}', (v ? 'round one' : 'unknown') + ': the same fit check is a find tagged “Fit check”, which either server takes', JSON.stringify(made));
    await page.click(vslot('spotted') + ' [data-act=vgot]');
    await page.click('#confirm [data-yes]');
    if (!v) {
      await page.waitForTimeout(600);
      check(!calls.some((c) => c.fn === 'nn_post_delete_own' || c.fn === 'nn_post_meta_set'), 'not knowing the server, “Someone got it” deletes nothing and changes nothing', JSON.stringify(calls.map((c) => c.fn)));
      check(/Couldn’t reach the boards/.test(await page.$eval('#toast', (t) => t.textContent)) && await page.$(vslot('spotted') + ' [data-act=vgot]'), 'it says so, and the find is still there to try again', '');
      await ctx.close();
      return;
    }
    await page.waitForFunction(() => /Thank you for passing it on/.test(document.querySelector('#toast').textContent), null, { timeout: 6000 }).catch(() => {});
    const set = calls.find((c) => c.fn === 'nn_post_meta_set');
    const del = calls.find((c) => c.fn === 'nn_post_delete_own');
    if (v === 2) {
      check(set && set.args.p_post === mineFind.id && JSON.stringify(set.args.p_meta) === '{"got":true}', 'round two: “Someone got it” ticks the find’s got box', JSON.stringify(set && set.args));
      check(!del, 'and the find stays on the board, not deleted', '');
    } else {
      check(!set, 'round one has no box, so nothing asks for one', '');
      check(del && del.args.p_post === mineFind.id, 'and the find comes down as before', JSON.stringify(del && del.args));
    }
    const st = await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.status()));
    check(st === 'live', 'either way the boards stay live', st);
    check(!(await page.$(vslot('spotted') + ' .card.board[data-k="b-' + mineFind.id + '"]')), 'and it leaves the grid', '');
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
      { ...base0, id: '0000cccc-0000-4000-8000-000000000006', board: 'vintage', kind: 'spotted', title: 'Gone wool coat', meta: { shop: 'Old Gold', got: true }, photo: null, created_at: at(7), expires_at: ends(16) },
    ];
    const swap = { ...base0, id: '0000cccc-0000-4000-8000-000000000005', board: 'vintage', kind: 'swap', title: 'Band tees', meta: { want: 'Denim', size: 'M' }, photo: null, created_at: at(6), expires_at: ends(17) };
    const design = { ...base0, id: '0000cccc-0000-4000-8000-000000000007', board: 'vintage', kind: 'design', title: 'Moth on the steeple', body: 'Linocut', meta: { thanks: 'credit' }, photo: 'submissions/abcd-7.jpg', created_at: at(1), expires_at: null };
    const fit = { ...base0, id: '0000cccc-0000-4000-8000-000000000008', board: 'vintage', kind: 'fit', title: 'Head to toe Old Gold', meta: {}, photo: 'submissions/abcd-8.jpg', created_at: at(9), expires_at: ends(50) };
    const byKind = { spotted, swap: [swap], design: [design], fit: [fit] };
    const artPost = { ...base0, id: '0000dddd-0000-4000-8000-000000000001', board: 'art', kind: 'art', title: 'Camel’s Hump in gouache', author: 'Dev', meta: { shirt: 'yes' }, photo: 'submissions/art-1.jpg', created_at: at(8), expires_at: null };
    const calls = [];
    const { ctx, page, errors } = await newPage(browser, base, {
      rpc: (fn, args) => {
        if (!/^nn_/.test(fn)) return undefined;
        calls.push({ fn, args });
        if (fn === 'nn_posts_list' && args.p_board === 'art') return args.p_filter.meta && args.p_filter.meta.shirt === 'yes' ? [artPost] : [];
        if (fn === 'nn_posts_list') return byKind[args.p_filter.kind] || [];
        return undefined;
      },
    });
    await page.goto(base + '/all-day/#vintage');
    await settle(page);
    await page.waitForSelector(vslot('spotted') + ' [data-grid="spotted"]');
    const lists = calls.filter((c) => c.fn === 'nn_posts_list').map((c) => c.args.p_board + ':' + c.args.p_filter.kind + ':' + c.args.p_limit).sort();
    check(JSON.stringify(lists) === '["vintage:design:60","vintage:fit:60","vintage:spotted:60","vintage:swap:60"]', 'four lists, one per kind, the server’s most', JSON.stringify(lists));
    const titles = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.panel:not([hidden]) [data-grid]')].map((g) => [g.dataset.grid, [...g.querySelectorAll('.b-title')].map((t) => t.textContent)])));
    check(JSON.stringify(titles) === JSON.stringify({ spotted: ['Barn jacket'], swaps: ['Band tees'], sent: ['Moth on the steeple', 'Lake ink'], fit: ['My Sunday fit', 'Head to toe Old Gold'] }),
      'a find in Spotted, a swap in Swaps, designs in Sent in and fit checks with their photos in Fit check, newest first, the old tagged ones among them; a fit whose photo still waits, and a find someone got, nowhere', JSON.stringify(titles));
    const thanks = await page.$eval(vslot('spotted') + ' [data-thanks]', (p) => p.dataset.thanks);
    check(thanks === '1', 'the find someone got counts in the thank-you', thanks);
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

/* ------------------------------------------------------------------ Art */
const artPanel = '#panel-art';
const artId = (n) => '0000c000-0000-4000-8000-' + String(n).padStart(12, '0');
const ART_POST = (o) => ({ id: o.id, board: 'art', kind: o.kind || 'photo', title: o.title, body: o.body || '', place: o.place || '', meta: o.meta || { shirt: 'no' },
  photo: o.photo === undefined ? 'submissions/' + o.id.slice(-12) + '.jpg' : o.photo, author: o.author || 'Kara', author_arch: null,
  created_at: o.at, expires_at: o.expires || null, votes: o.votes || 0, voted: false, mine: false });
/* nn_posts_list as the SQL answers it: newest first, before a time, at most p_limit */
const artList = (posts, calls) => (fn, args) => {
  if (fn !== 'nn_posts_list') return undefined;
  if (calls) calls.push(args);
  const before = args.p_before ? Date.parse(args.p_before) : Infinity;
  return posts.filter((p) => Date.parse(p.created_at) < before).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, args.p_limit);
};
const artText = (page, sel) => page.$eval(artPanel + ' ' + sel, (n) => n.textContent);
const artReload = (page) => page.evaluate(() => window.dispatchEvent(new CustomEvent('allday-boards', { detail: { board: 'art', id: null, what: 'test' } })));

async function theArt(browser, base) {
  for (const v of [1, 2]) await group('Art, photo of the week on a frozen Burlington clock (live, a reader in Los Angeles, server rules v' + v + ')', async () => {
    const H = 3600000;
    const posts = [
      ART_POST({ id: artId(1), title: 'Sunday night, 11:30', at: '2026-10-12T03:30:00Z', votes: 50 }),
      ART_POST({ id: artId(2), kind: 'art', title: 'Monday, 12:30 am', at: '2026-10-12T04:30:00Z', votes: 10, meta: { medium: 'Gouache', shirt: 'yes' } }),
      ART_POST({ id: artId(3), title: 'Tuesday afternoon', at: '2026-10-13T16:00:00Z', votes: 9 }),
      ART_POST({ id: artId(4), kind: 'notice', title: 'Open studio Saturday', photo: null, at: '2026-10-13T12:00:00Z', expires: '2026-11-12T12:00:00Z', votes: 40 }),
    ];
    /* one a day back past nine weeks, so the list needs a second page and every week has a winner */
    for (let i = 0; i < 70; i++) posts.push(ART_POST({ id: artId(100 + i), title: 'Day ' + i, at: new Date(Date.parse('2026-10-11T12:00:00Z') - i * 24 * H).toISOString(), votes: i % 4 }));
    const calls = [], weekly = [];
    const list = artList(posts, calls);
    /* round two counts votes by the week they were cast: in the week of Oct 5 (2026-W41) the Sunday-night post got 2 of
       its 50 then, and Saturday's "Day 1" got 5; the rest came later and no longer move that week */
    const rpc = (fn, args) => {
      if (fn === 'nn_rules') return v === 2 ? { version: 2 } : undefined;
      if (fn === 'nn_votes_by_week') { weekly.push(args); return [{ post: artId(101), week: '2026-W41', votes: 5 }, { post: artId(1), week: '2026-W41', votes: 2 }]; }
      return list(fn, args);
    };
    const { ctx, page, errors } = await newPage(browser, base, { timezoneId: 'America/Los_Angeles', rpc });
    await page.clock.setFixedTime(new Date('2026-10-14T14:00:00Z'));   // Wednesday, 10 am in Burlington, 7 am for this reader
    await page.goto(base + '/all-day/#art');
    await settle(page);
    const hero = await page.$eval(artPanel + ' [data-sec="week"]', (s) => ({ eyebrow: s.querySelector('.eyebrow').textContent, title: s.querySelector('h3').textContent,
      votes: s.querySelector('[data-vk] .vn').textContent, shirt: s.querySelector('[data-shirt]') && s.querySelector('[data-shirt]').getAttribute('href') }));
    check(hero.eyebrow === 'Photo of the week' && hero.title === 'Monday, 12:30 am' && hero.votes === '10',
      'the top-voted post since Monday in Burlington wins: 50 votes at 11:30 pm Sunday there is last week’s, though it is Monday in UTC', JSON.stringify(hero));
    check(hero.shirt === '#vintage/' + encodeURIComponent('b-' + artId(2)), 'its maker said yes to a shirt: “Put it on a shirt” goes to #vintage with the post key', JSON.stringify(hero));
    check(calls.length >= 2 && calls.every((c) => c.p_board === 'art' && c.p_limit === 60) && !calls[0].p_before && calls[1].p_before === posts.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[59].created_at,
      'the list is paged, 60 at a time, until the eighth week back is in', JSON.stringify(calls.map((c) => c.p_before)));
    const wins = await page.$$eval(artPanel + ' [data-sec="winners"] .vcard', (cs) => cs.map((c) => [c.querySelector('.t').textContent, c.querySelector('.s').textContent]));
    if (v === 1) {
      check(!weekly.length, 'round one: no counts by week are asked for', JSON.stringify(weekly));
      check(wins.length === 8 && wins[0][0] === 'Week of Oct 5' && /Sunday night, 11:30/.test(wins[0][1]) && wins[7][0] === 'Week of Aug 17',
        'Winners: the past eight weeks, newest first, and the Sunday-night post wins its own week on its votes so far', JSON.stringify(wins));
    } else {
      check(weekly.length && weekly.every((a) => a.p_board === 'art' && a.p_weeks === 9), 'round two: the votes are counted by week for this week and the eight before', JSON.stringify(weekly));
      check(wins.length === 8 && wins[0][0] === 'Week of Oct 5' && /Day 1$/.test(wins[0][1]) && wins[7][0] === 'Week of Aug 17',
        'Winners: the week of Oct 5 goes to the most votes cast that week, settled at Sunday midnight, whatever came later', JSON.stringify(wins));
    }
    check(wins.every((w) => /^Kara · /.test(w[1])), 'each winner carries the maker’s name, and nothing else to win', JSON.stringify(wins[0]));
    const tiles = await page.$$eval(artPanel + ' .grid3 .tile', (ts) => ts.map((t) => t.getAttribute('aria-label')));
    check(/^Tuesday afternoon/.test(tiles[0]) && /^Monday, 12:30 am/.test(tiles[1]) && !tiles.some((t) => /Open studio/.test(t)), 'the wall is newest first, pictures only', tiles.slice(0, 3).join(' | '));
    check(/Open studio Saturday/.test(await artText(page, '[data-sec="board"]')), 'the notice is on the community board instead', '');
    await pageRules(page, 'art', 390);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Art, a vote that overtakes takes the week (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#art');
    await settle(page);
    const heroTitle = () => artText(page, '[data-sec="week"] h3');
    check(await heroTitle() === 'The breakwater light in fog', 'two posts tie on 23 this week, and the one posted first leads', await heroTitle());
    const tile = artPanel + ' .tile[aria-label^="Aurora from the causeway"]';
    check(await page.$eval(tile + ' .vn', (n) => n.textContent) === '23', 'the tile shows its votes', '');
    await page.click(tile);
    await page.waitForSelector('.sheet-card[aria-label="Aurora from the causeway"]');
    await page.click('.sheet-body [data-act="artvote"]');
    await page.waitForFunction(() => document.querySelector('#panel-art [data-sec="week"] h3').textContent === 'Aurora from the causeway', null, { timeout: 3000 }).catch(() => {});
    check(await heroTitle() === 'Aurora from the causeway', 'one vote puts it ahead, and the photo of the week changes', await heroTitle());
    const after = await page.evaluate(() => ({ sheet: document.querySelector('.sheet-body [data-act="artvote"]').getAttribute('aria-pressed'), sheetN: document.querySelector('.sheet-body [data-act="artvote"] .vn').textContent,
      tile: document.querySelector('#panel-art .tile[aria-label^="Aurora"] .vn').textContent, hero: document.querySelector('#panel-art [data-sec="week"] [data-vk] .vn').textContent }));
    check(after.sheet === 'true' && after.sheetN === '24' && after.tile === '24' && after.hero === '24', 'the count is 24 on the sheet, the tile and the hero', JSON.stringify(after));
    check(await fakeOf(page, `(f) => f._count('${'0000a000-0000-4000-8000-000000000002'}')`) === 24, 'and the board counted it', '');
    await page.click('.sheet-body [data-act="artvote"]');
    await page.waitForFunction(() => document.querySelector('#panel-art [data-sec="week"] h3').textContent === 'The breakwater light in fog', null, { timeout: 3000 }).catch(() => {});
    check(await heroTitle() === 'The breakwater light in fog', 'taking the vote back hands the week back', await heroTitle());
    await page.click('.sheet-head .iconbtn');
    await page.click(artPanel + ' [data-sec="week"] button[data-vk]');
    await page.waitForTimeout(150);
    check(await page.$eval(artPanel + ' [data-sec="week"] button[data-vk]', (b) => b.getAttribute('aria-pressed') + ' ' + b.querySelector('.vn').textContent) === 'true 24' && await heroTitle() === 'The breakwater light in fog',
      'the hero’s own Vote button counts too', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Art, the wall opens a tile in a sheet (demo, wide, dark)', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { viewport: { width: 1280, height: 800 }, scheme: 'dark' });
    await page.goto(base + '/all-day/?demo=1#art/wall');
    await settle(page);
    const grid = await page.$$eval(artPanel + ' .grid3 .tile', (ts) => ts.map((t, i) => ({ i, tall: t.classList.contains('tall'), ct: !!t.querySelector('.ct'), lbl: t.querySelector('.lbl') && t.querySelector('.lbl').textContent })));
    check(grid.length === 17 && grid.filter((t) => t.ct).length === 14 && JSON.stringify(grid.filter((t) => t.lbl).map((t) => t.lbl)) === '["Sunset from Waterfront Park","The Church Street lights","Morning coffee on Pine Street"]',
      'fourteen posts with votes and three gallery photos, each labelled with its own caption', JSON.stringify(grid.filter((t) => t.lbl).map((t) => t.lbl)));
    check(JSON.stringify(grid.filter((t) => t.tall).map((t) => t.i)) === '[0,7,10]', 'two tall tiles in every ten, none where it would leave a hole', JSON.stringify(grid.filter((t) => t.tall).map((t) => t.i)));
    const holes = await page.$eval(artPanel + ' .grid3', (g) => {
      const r = [...g.children].map((t) => t.getBoundingClientRect());
      const area = r.reduce((s, x) => s + x.width * x.height, 0);
      const box = g.getBoundingClientRect();
      const last = r.slice(-3).every((x) => Math.abs(x.bottom - r[r.length - 1].bottom) < 2);
      return { fill: area / ((box.width - 32) * box.height), last };
    });
    check(holes.fill > 0.8, 'the grid is filled, no gaps', JSON.stringify(holes));
    await page.click(artPanel + ' .tile[aria-label^="The Flynn marquee"]');
    await page.waitForSelector('.sheet-card[aria-label="The Flynn marquee"]');
    const sh = await page.$eval('.sheet-body', (b) => ({ media: !!b.querySelector('.c-media.r11 .ph'), text: b.innerText,
      acts: [...b.querySelectorAll('[data-act]')].map((x) => x.dataset.act), shirt: b.querySelector('[data-shirt]') && b.querySelector('[data-shirt]').getAttribute('href') }));
    check(sh.media, 'the sheet shows the whole picture in its own shape', JSON.stringify(sh));
    check(/by Priya N\. · Art · Linocut/.test(sh.text) && /Three-color linocut/.test(sh.text), 'with the title, the maker, the medium and their line', sh.text);
    check(JSON.stringify(sh.acts) === '["artvote","share","breport"]' && /^#vintage\/b-/.test(sh.shirt || ''), 'and vote, share, report, and the shirt', JSON.stringify(sh));
    await page.screenshot({ path: path.join(SHOTS, 'demo-art-sheet-desktop-dark.png') });
    await page.click('.sheet-body [data-act="breport"]');
    check(/Reporting needs the email sign-in/.test(await page.$eval('#toast', (t) => t.textContent)), 'report goes to the boards’ own flow (signed out, it asks for sign-in)', '');
    await page.click('.sheet-head .iconbtn');
    await page.click(artPanel + ' .tile:has(.lbl)');
    await page.waitForSelector('.sheet-card');
    const g = await page.$eval('.sheet-body', (b) => ({ text: b.innerText, acts: [...b.querySelectorAll('[data-act]')].map((x) => x.dataset.act) }));
    check(/Photo by Stephen/.test(g.text) && /community gallery/.test(g.text) && JSON.stringify(g.acts) === '["share"]', 'a gallery photo’s sheet: who took it, where, share, and no votes', JSON.stringify(g));
    await page.click('.sheet-head .iconbtn');
    await pageRules(page, 'art', 1280);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Art, a photo post composes with consent and lands pending (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { motion: 'reduce' });
    await page.goto(base + '/all-day/?demo=1#art/add');
    await settle(page);
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.click(artPanel + ' [data-sec="add"] button:has-text("Add art")');
    await page.waitForSelector('.sheet-body form.bform');
    check(await page.$('input[name="m:medium"]') !== null && await page.$('select[name="m:shirt"]') !== null, 'Add art asks for the medium and the shirt', '');
    await page.click('.sheet-head .iconbtn');
    const tiles0 = await page.$$eval(artPanel + ' .grid3 .tile', (t) => t.length);
    await page.click(artPanel + ' [data-sec="add"] button:has-text("Add a photo")');
    await page.waitForSelector('.sheet-body form.bform');
    check(await page.$('input[name="m:medium"]') === null && await page.$('select[name="m:shirt"]') !== null, 'Add a photo asks for the shirt, not a medium', '');
    check(/Stephen approves every photo before it shows/.test(await page.$eval('.bform', (f) => f.innerText)), 'and says Stephen approves photos first', '');
    await page.fill('input[name=display_name]', 'Robin');
    await page.fill('input[name=title]', 'Leddy at dusk');
    await page.fill('textarea[name=body]', 'From the end of the pier.');
    await page.selectOption('select[name="m:shirt"]', 'yes');
    await page.setInputFiles('.bform input[type=file]', { name: 'leddy.jpg', mimeType: 'image/jpeg', buffer: PNG });
    await page.click('.bform button[type=submit]');
    check(/Tick the box first/.test(await page.$eval('.bf-msg', (m) => m.textContent)), 'without the consent box: refused', '');
    await page.check('.bform input[name=consent]');
    await page.click('.bform button[type=submit]');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached', timeout: 4000 });
    check(/The photo shows once it’s been checked/.test(await page.$eval('#toast', (t) => t.textContent)), 'with it: posted, and the toast says the photo waits', await page.$eval('#toast', (t) => t.textContent));
    const row = await fakeOf(page, `(f) => { const p = f.posts.find((x) => x.title === 'Leddy at dusk'); return p && { kind: p.kind, meta: p.meta, body: p.body, photo: f.photos.get(p.photo_path).status }; }`);
    check(row && row.kind === 'photo' && row.meta.shirt === 'yes' && row.body === 'From the end of the pier.' && row.photo === 'pending', 'it is on the board as a photo post, its picture pending in the queue', JSON.stringify(row));
    await page.waitForFunction(() => !document.querySelector('#panel-art .waiting').hidden, null, { timeout: 3000 }).catch(() => {});
    check(await artText(page, '.waiting') === '1 picture of yours is waiting for Stephen’s look.', 'Add yours says one is waiting', await artText(page, '.waiting'));
    check(await page.$$eval(artPanel + ' .grid3 .tile', (t) => t.length) === tiles0 && !(await page.$(artPanel + ' .tile[aria-label^="Leddy at dusk"]')), 'and the wall does not show it yet', '');
    await fakeOf(page, `(f) => { const p = f.posts.find((x) => x.title === 'Leddy at dusk'); f.setPhoto(p.photo_path, 'approved'); return 1; }`);
    await artReload(page);
    await page.waitForSelector(artPanel + ' .tile[aria-label^="Leddy at dusk"]', { timeout: 3000 }).catch(() => {});
    check(/^Leddy at dusk, by Robin/.test(await page.$eval(artPanel + ' .grid3 .tile', (t) => t.getAttribute('aria-label'))), 'once Stephen approves it, it leads the wall, by first name', '');
    check(await page.$eval(artPanel + ' .waiting', (n) => n.hidden), 'and nothing is waiting any more', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Art, the community board, and a notice running out (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#art/board');
    await settle(page);
    const board = () => page.$$eval(artPanel + ' [data-sec="board"] .card.board', (cs) => cs.map((c) => [c.querySelector('.b-title').textContent, (c.querySelector('.tag-left') || {}).textContent || '']));
    const b0 = await board();
    check(b0.length === 4 && /^Looking for a model/.test(b0[0][0]) && b0.every((b) => /^(\d+d|\d+h) left$/.test(b[1])), 'four notices, newest first, each with its days left', JSON.stringify(b0));
    check(/^30d left$|^29d left$/.test(b0[0][1]), 'a new notice has thirty days', b0[0][1]);
    await fakeOf(page, `(f) => { f.posts.find((p) => p.title === 'Free easel, first come').expires_at = Date.now() - 1000; return 1; }`);
    await artReload(page);
    await page.waitForFunction(() => document.querySelectorAll('#panel-art [data-sec="board"] .card.board').length === 3, null, { timeout: 3000 }).catch(() => {});
    const b1 = await board();
    check(b1.length === 3 && !b1.some((b) => /Free easel/.test(b[0])), 'a notice past its thirty days leaves the board', JSON.stringify(b1));
    await page.click(artPanel + ' [data-sec="board"] .sec button:has-text("Post")');
    await page.waitForSelector('.sheet-card[aria-label="Post a notice"]');
    check(/Posting needs the email sign-in/.test(await page.$eval('.sheet-body', (b) => b.innerText)), 'posting a notice asks for the sign-in first', '');
    await page.click('.sheet-head .iconbtn');
    await pageRules(page, 'art', 390);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Art, “Put it on a shirt” goes to Vintage with the post key (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#art');
    await settle(page);
    const key = 'b-0000a000-0000-4000-8000-000000000001';
    check(await page.$eval(artPanel + ' [data-sec="week"] [data-shirt]', (a) => a.getAttribute('href')) === '#vintage/' + key, 'the hero links to #vintage/<its key>', '');
    await page.click(artPanel + ' [data-sec="week"] [data-shirt]');
    await page.waitForFunction(() => document.querySelector('#tab-vintage').getAttribute('aria-selected') === 'true', null, { timeout: 4000 }).catch(() => {});
    check(await page.evaluate(() => location.hash) === '#vintage/' + key && await page.$eval('#tab-vintage', (b) => b.getAttribute('aria-selected')) === 'true', 'and tapping it opens Vintage with that key in the address', await page.evaluate(() => location.hash));
    const found = await page.evaluate((k) => import('/all-day/js/boards.js').then((b) => b.list('art', { meta: { shirt: 'yes' }, limit: 60 }).then((r) => r.posts.find((p) => 'b-' + p.id === k))), key);
    check(found && found.title === 'The breakwater light in fog' && found.photo, 'Vintage can find the picture from the key alone', JSON.stringify(found && found.title));
    await page.goto(base + '/all-day/?demo=1#art');
    await settle(page);
    await page.click(artPanel + ' .tile[aria-label^="Church Street in rain"]');
    await page.waitForSelector('.sheet-card[aria-label="Church Street in rain"]');
    check(!(await page.$('.sheet-body [data-shirt]')), 'a maker who said no gets no shirt button', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Art, the empty wall’s sunset line says a score only when there is one (live)', async () => {
    /* sunset-score.js stands in for the shared module: tomorrow at 6:05 pm, and
       the score the page asks for. A 0.0 is what an empty forecast comes out as. */
    const stub = 'window.BtownSunsetScore = { OPEN_METEO_URL: "https://api.open-meteo.com/v1/forecast?x=1", AIR_URL: "https://air-quality-api.open-meteo.com/v1/air-quality?x=1",' +
      ' selectTarget: function () { return { sunsetMs: Date.parse("2026-10-17T22:05:00Z"), isTonight: false }; },' +
      ' computeScore: function () { return { score: window.__score, degraded: !!window.__degraded }; } };';
    const { ctx, page, errors } = await newPage(browser, base);
    await page.route(/\/js\/sunset-score\.js$/, (r) => r.fulfill({ status: 200, body: stub, contentType: 'text/javascript' }));
    const invite = async (score, degraded) => {
      await page.addInitScript(([s, d]) => { window.__score = s; window.__degraded = d; }, [score, degraded]);
      await page.goto(base + '/all-day/?s=' + score + (degraded ? 'd' : '') + '#art');
      await settle(page);
      await page.waitForFunction(() => /Sunset is at/.test(document.querySelector('#panel-art [data-k="invite"]')?.innerText || ''), null, { timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(200);
      return page.$eval(artPanel + ' [data-k="invite"]', (c) => ({ head: c.querySelector('h3').textContent, text: c.innerText }));
    };
    let r = await invite(0, false);
    check(r.head === 'The wall starts with you' && /Sunset is at 6:05 pm tomorrow\./.test(r.text) && !/scores|out of 10|gray/.test(r.text) && /Best spot: Waterfront Park/.test(r.text),
      'a 0.0 (the forecast missing) is no score: the time and the best spot, and nothing about the sky', r.text);
    r = await invite(6.2, true);
    check(!/scores|out of 10/.test(r.text) && /Sunset is at 6:05 pm tomorrow\./.test(r.text), 'a score worked out without the forecast is not shown either', r.text);
    r = await invite(7.4, false);
    check(r.head === 'Tomorrow’s sunset scores 7.4 out of 10' && /Worth the walk\./.test(r.text), 'a real score of 5 or more is the headline', JSON.stringify(r));
    r = await invite(3.2, false);
    check(r.head === 'The wall starts with you' && /Tomorrow’s sunset scores 3\.2 out of 10\. Probably a quiet one\./.test(r.text), 'under 5, it is said plainly, lower down', r.text);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Art, the gallery fills the wall before anyone posts (live, the SQL not pasted)', async () => {
    const at = (d) => d;
    const rows = [
      ['11111111-0000-4000-8000-000000000001', 'Sunset from Waterfront Park', 'sunsets', 'Waterfront Park', '2026-04-02'],
      ['11111111-0000-4000-8000-000000000002', 'Church Street lights', 'street', 'Church Street', '2026-04-02'],
      ['11111111-0000-4000-8000-000000000003', '', 'other', 'King Street dock', '2026-04-01'],
      ['11111111-0000-4000-8000-000000000004', 'Leddy in June', 'sunsets', 'Leddy Park', '2026-06-20'],
      ['11111111-0000-4000-8000-000000000005', 'Pine Street mural', 'street', 'Pine Street', '2026-08-03'],
      ['11111111-0000-4000-8000-000000000006', 'A board photo', 'other', 'All Day · Art', at('2026-10-10')],
      ['11111111-0000-4000-8000-000000000007', 'Tacos al pastor', 'dish', 'Taco Gordo', '2026-10-01'],
      /* no caption and no spot: the area, else when it was taken, else the day it was approved */
      ['11111111-0000-4000-8000-000000000008', '', 'other', '', '2026-03-20', { area: 'Old North End' }],
      ['11111111-0000-4000-8000-000000000009', '', 'other', '', '2026-03-19', { area: 'Elsewhere', taken_on: 'late May 2026' }],
      ['11111111-0000-4000-8000-00000000000a', '', 'other', '', '2026-03-18', { area: 'Elsewhere' }],
    ].map(([id, caption, category, spot, approved_on, more]) => ({ id, storage_path: 'submissions/' + id.slice(-4) + '.jpg', caption, category, area: 'Downtown / Church St', spot,
      taken_on: '', credit: 'Stephen', display_label: null, approved_on, votes: 3, ...more }));
    const { ctx, page, errors } = await newPage(browser, base, {
      rpc: (fn) => (fn === 'btb_photos_get' ? rows : /^nn_/.test(fn) ? { status: 404, body: { code: 'PGRST202', message: 'Could not find the function' } } : undefined),
    });
    await page.goto(base + '/all-day/#art');
    await settle(page);
    await page.waitForSelector(artPanel + ' .grid3 .tile', { timeout: 6000 }).catch(() => {});
    const tiles = await page.$$eval(artPanel + ' .grid3 .tile', (ts) => ts.map((t) => ({ label: t.getAttribute('aria-label'), lbl: t.querySelector('.lbl') && t.querySelector('.lbl').textContent,
      votes: !!t.querySelector('.ct'), src: t.querySelector('img') && t.querySelector('img').getAttribute('src'), lazy: t.querySelector('img') && t.querySelector('img').getAttribute('loading') })));
    check(tiles.length === 8 && tiles.every((t) => !t.votes && /, from the gallery$/.test(t.label)), 'the eight gallery photos, said to be from the gallery, without votes', JSON.stringify(tiles.map((t) => t.label)));
    check(JSON.stringify(tiles.map((t) => t.lbl)) === '["Pine Street mural","Leddy in June","Sunset from Waterfront Park","Church Street lights","King Street dock","Old North End","late May 2026","March 18, 2026"]',
      'each tile is labelled with its caption, else its spot, area (never "Elsewhere"), when it was taken or the day it was approved', JSON.stringify(tiles.map((t) => t.lbl)));
    check(/^Pine Street mural/.test(tiles[0].label) && tiles.every((t) => /\/storage\/v1\/object\/public\/btb-photos\/submissions\/\w+\.jpg$/.test(t.src) && t.lazy === 'lazy'), 'newest approved first, lazy, from the public bucket', JSON.stringify(tiles[0]));
    check(!tiles.some((t) => /A board photo|Tacos/.test(t.label)), 'a board post’s photo and Food’s dishes stay off the gallery half', '');
    const invite = await page.$eval(artPanel + ' [data-sec="week"]', (s) => ({ text: s.innerText, k: s.querySelector('[data-k]') && s.querySelector('[data-k]').dataset.k }));
    check(invite.k === 'invite' && /Nobody has put a picture on the wall yet/.test(invite.text) && /Best spot: Waterfront Park/.test(invite.text),
      'with no posts at all, the top invites the first, with the best spot for tonight’s light', invite.text);
    await page.click(artPanel + ' .tile');
    await page.waitForSelector('.sheet-card[aria-label="Pine Street mural"]');
    const sh = await page.$eval('.sheet-body', (b) => ({ text: b.innerText, acts: [...b.querySelectorAll('[data-act]')].map((x) => x.dataset.act) }));
    check(/Photo by Stephen · Pine Street, Downtown \/ Church St/.test(sh.text) && JSON.stringify(sh.acts) === '["share"]', 'its sheet credits the photographer and has no vote or report', JSON.stringify(sh));
    await page.click('.sheet-head .iconbtn');
    await page.click(artPanel + ' [data-sec="add"] button:has-text("Add a photo")');
    await page.waitForSelector('.sheet-card[aria-label="Add a photo"]');
    check(/Posting needs the email sign-in/.test(await page.$eval('.sheet-body', (b) => b.innerText)), 'Add a photo, signed out, asks for the sign-in', '');
    await page.click('.sheet-head .iconbtn');
    await pageRules(page, 'art', 390);
    await page.screenshot({ path: path.join(SHOTS, 'live-art-gallery.png') });
    check(!errors.filter((e) => !/status of 404/.test(e)).length, 'no console errors beyond the browser logging the missing function', errors.join(' | '));
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

  await group('cutover: a card in a two-up grid can shrink to its cell', async () => {
    const { ctx, page } = await newPage(browser, base, { viewport: { width: 390, height: 800 } });
    await page.goto(base + '/all-day/?demo=1#wire');
    await settle(page);
    const r = await page.evaluate(() => {
      const g = document.createElement('div'); g.className = 'grid2';
      const a = document.createElement('div'); a.textContent = 'x'.repeat(400); a.style.whiteSpace = 'nowrap'; a.style.overflow = 'hidden';
      g.append(a, document.createElement('div'));
      document.querySelector('#panel-wire .panel-body').appendChild(g);
      const out = { min: getComputedStyle(a).minWidth, over: g.scrollWidth - g.clientWidth };
      g.remove(); return out;
    });
    check(r.min === '0px' && r.over <= 1, '.grid2 > * has min-width 0, so a long line never widens the grid', JSON.stringify(r));
    await ctx.close();
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

  await group('cutover: every old tab’s link lands on the nearest new tab', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    const landed = async (hash, tab) => {
      /* a fresh document each time: a hash-only goto keeps the last case's
         tab mounted, and What Now writing its Tonight view back into the
         address races the legacy rewrite (seen once in a full run) */
      await page.goto('about:blank');
      await page.goto(base + '/all-day/?demo=1' + hash);
      await page.waitForFunction((t) => document.querySelector('#tab-' + t)?.getAttribute('aria-selected') === 'true', tab, { timeout: 15000 }).catch(() => {});
      return page.evaluate((t) => ({ on: document.querySelector('#tab-' + t).getAttribute('aria-selected') === 'true', hash: location.hash }), tab);
    };
    const cases = [
      ['#reddit', 'wire', '#wire/reddit'],
      ['#reddit/https%3A%2F%2Fwww.reddit.com%2Fr%2Fburlington%2Fcomments%2Fabc', 'wire', '#wire/https%3A%2F%2Fwww.reddit.com%2Fr%2Fburlington%2Fcomments%2Fabc'],
      ['#ig', 'wire', '#wire'], ['#ig/ig-C123', 'wire', '#wire'],
      ['#music', 'whatnow', '#whatnow/tonight'], ['#music/mus:old', 'whatnow', '#whatnow/tonight'],
      ['#wander', 'whatnow', '#whatnow'], ['#wander/Moose', 'whatnow', '#whatnow'],
      ['#photos', 'art', '#art'], ['#photos/p-1', 'art', '#art'],
      ['#listen', 'onair', '#onair'], ['#watch/yt:dQw4w9WgXcQ', 'onair', '#onair/yt:dQw4w9WgXcQ'],
      /* not old tabs: an unknown word is the Wire, as before, and nothing throws */
      ['#constructor', 'wire', '#constructor'], ['#igloo', 'wire', '#igloo'], ['#photosx', 'wire', '#photosx'], ['#toString/x', 'wire', '#toString/x'],
    ];
    for (const [from, tab, to] of cases) {
      const r = await landed(from, tab);
      check(r.on && r.hash === to, from + ' opens ' + tab + ', and the address says ' + to, JSON.stringify(r));
    }
    await page.goto(base + '/all-day/?demo=1#reddit');
    await page.waitForSelector('#subnav .chip.on', { timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('#subnav .chip.on')?.dataset.chip === 'reddit', null, { timeout: 5000 }).catch(() => {});
    const on = await page.$eval('#subnav .chip.on', (c) => c.dataset.chip);
    check(on === 'reddit', 'a bare #reddit opens the Wire on its Reddit chip', on);
    await page.goto(base + '/all-day/?demo=1#music');
    await page.waitForFunction(() => document.querySelector('#subnav .chip.on')?.dataset.chip === 'tonight', null, { timeout: 15000 }).catch(() => {});
    check(await page.$eval('#subnav .chip.on', (c) => c.dataset.chip).catch(() => '') === 'tonight', 'an old Music link opens What Now on Tonight', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('shell fixes: the offline shell carries the new modules', async () => {
    const sw = await readFile(path.join(APP, 'sw.js'), 'utf8');
    const main = await readFile(path.join(APP, 'js/main.js'), 'utf8');
    check(/VERSION = 'all-day-v45'/.test(sw), 'sw.js VERSION is bumped once for the cutover, to v45', (sw.match(/VERSION = '[^']+'/) || [''])[0]);
    const listed = [...sw.matchAll(/'\.\/(js\/[\w/.-]+\.js)'/g)].map((m) => m[1]);
    /* the offline list is exactly the modules that exist: none missing, none gone */
    const mods = [];
    const walkJs = async (dir) => { for (const f of await readdir(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) await walkJs(p); else if (f.name.endsWith('.js')) mods.push(path.relative(APP, p).split(path.sep).join('/')); } };
    await walkJs(path.join(APP, 'js'));
    check(mods.every((f) => listed.includes(f)), 'every module in js/ is in the offline list', mods.filter((f) => !listed.includes(f)).join(', '));
    check(listed.every((f) => mods.includes(f)), 'and nothing in the offline list is missing from js/', listed.filter((f) => !mods.includes(f)).join(', '));
    const files = [...sw.matchAll(/'\.\/([\w/.-]+\.[a-z]+)'/g)].map((m) => m[1]);
    const gone = [];
    for (const f of files) { try { await readFile(path.join(APP, f)); } catch (e) { gone.push(f); } }
    check(!gone.length, 'every file in the offline list exists', gone.join(', '));
    check(/pathname\.startsWith\('\/data\/'\)/.test(sw) && /network.first/i.test(sw), 'and /data/ is still network first', '');
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

/* -------------------------------------------------------------- People */
/* The People tab: live on the repo's own calendar and clubs with the boards
   answered locally, and ?demo=1 against boards-fake.js and the tab's own
   mirror of nn-people.sql. */
const peoplePanel = '#panel-people';
const NO_ID_QUESTIONS = /\bages?\b|how old|years? old|\bborn\b|birth|gender|orientation|sexual|straight|\bgay\b|pronoun|\bman\b|\bwoman\b|\bmale\b|female|lgbt/i;
const OWN_URL_T = /meetup\.com\/burlington-social-activiti?es-group\//i;
const OWN_NAME_T = /btown brief|btown coffee club|burlington social activities group/i;
const BTV_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const BTV_LABEL = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
/* a moment as the compose sheet writes it, in Burlington: "Sat, Oct 17, 7:30 pm" */
const btvWhen = (ms) => BTV_LABEL.format(new Date(Math.ceil(ms / 1800000) * 1800000)).replace(/ at |, (?=\d{1,2}:)/, ', ').replace(':00', '').replace(/\s?([AP])M$/, (x, a) => ' ' + a.toLowerCase() + 'm');
const peopleReady = (page) => page.waitForSelector(peoplePanel + ' [data-plans], ' + peoplePanel + ' [data-sec="plans"] .textcard', { timeout: 15000 });
const planCards = (page) => page.$$eval(peoplePanel + ' [data-plans] .card.board', (cs) => cs.map((c) => ({
  k: c.dataset.k, title: c.querySelector('.b-title').textContent, meta: (c.querySelector('.b-meta') || {}).textContent || '',
  who: c.querySelector('.c-head').innerText, going: (c.querySelector('.going') || {}).textContent || '' })));
const clubCats = (page) => page.$$eval(peoplePanel + ' [data-clubs] .lrow', (rs) => rs.map((r) => ({ cat: r.dataset.cat, name: r.querySelector('.t').textContent })));
const peek = (page) => page.evaluate(() => import('/all-day/js/modes/people.js').then((m) => m._peek()));
/* Stephen's own events, as the tab picks them: the repo's calendar plus his Meetup group's feed, every one from now to two weeks out, once each */
async function ownEvents(feed) {
  const w = JSON.parse(await readFile(path.join(APP, 'data/whatnow.json'), 'utf8'));
  const now = Date.now(), seen = new Set();
  const fromFeed = (feed || []).map((e) => ({ title: e.title, url: e.url, start: e.starts_at, date: BTV_DAY.format(new Date(e.starts_at)) }));
  return w.events.concat(fromFeed).filter((e) => OWN_URL_T.test(e.url || '') || OWN_NAME_T.test([e.title, e.venue, (e.tags || []).join(' ')].join(' ')))
    .filter((e) => { const t = Date.parse(e.start); const end = Date.parse(e.end) || t + 7200000; return t && end > now && t < now + 14 * 86400000 && e.url; })
    .filter((e) => { const k = ((e.url.match(/\/events\/(\w+)/) || [])[1] || e.url) + '|' + e.date; if (seen.has(k)) return false; seen.add(k); return true; });
}

async function thePeople(browser, base) {
  await group('People: the rules in the module and the SQL agree', async () => {
    const js = await readFile(path.join(APP, 'js/modes/people.js'), 'utf8');
    const sql = await readFile(path.join(APP, 'supabase/nn-people.sql'), 'utf8');
    const lit = js.match(/export const PEOPLE_RULES = (\{[\s\S]*?\n\});/);
    const mine = lit ? new Function('return ' + lit[1])() : null;
    const theirs = JSON.parse((sql.match(/\$json\$(\{[\s\S]*?\})\$json\$/) || [])[1] || 'null');
    check(mine && theirs && JSON.stringify(mine) === JSON.stringify(theirs), 'PEOPLE_RULES in people.js is nn_people_rules() in nn-people.sql', JSON.stringify(mine) + ' vs ' + JSON.stringify(theirs));
    check(!/boards-fake/.test(js.replace(/\/\*[\s\S]*?\*\//g, '')), 'the tab never imports boards-fake.js; its mirror is its own', '');
  });

  await group('People, live: Stephen’s meetups, the clubs, an empty board', async () => {
    /* his group's feed: one event thirteen days out, past the events file's ten-day reach, and one the events file already has */
    const w = JSON.parse(await readFile(path.join(APP, 'data/whatnow.json'), 'utf8'));
    const thirteen = Date.now() + 13 * 86400000;
    const feed = [{ uid: 'event_999001@meetup.com', title: 'Pick-up Basketball', starts_at: new Date(thirteen).toISOString(), url: 'https://www.meetup.com/burlington-social-activites-group/events/999001/', location: '' }];
    const dup = w.events.find((e) => OWN_URL_T.test(e.url || '') && Date.parse(e.start) > Date.now() + 3600000);
    if (dup) feed.push({ uid: 'dup', title: dup.title, starts_at: new Date(Date.parse(dup.start)).toISOString(), url: dup.url, location: '' });
    const own = await ownEvents(feed);
    const clubs = JSON.parse(await readFile(path.join(REPO, 'data/clubs.json'), 'utf8')).clubs;
    const { ctx, page, errors } = await newPage(browser, base, { rpc: (fn) => (fn === 'nn_people_directory' ? { count: 12, me: false, people: [] } : undefined),
      routes: [[/play\.btownbrief\.com\/up-for-it\/data\/meetup\.json/, { fetched: new Date().toISOString(), events: feed }]] });
    await page.goto(base + '/all-day/#people');
    await peopleReady(page);
    await page.waitForFunction((s) => !document.querySelector(s + ' [data-sec="mix"] .loading'), peoplePanel, { timeout: 10000 });
    const mix = await page.$$eval(peoplePanel + ' [data-mixers] .card.event', (cs) => cs.map((c) => ({ k: c.dataset.k, href: c.querySelector('.c-title').getAttribute('href'), title: c.querySelector('.c-title').textContent, text: c.innerText })));
    check(mix.length === own.length, 'every one of Stephen’s own events in the next two weeks shows (' + own.length + ')', mix.length + ': ' + mix.map((m) => m.title).join(', '));
    check(own.every((e) => mix.some((m) => m.href === e.url)), 'none is missed', own.filter((e) => !mix.some((m) => m.href === e.url)).map((e) => e.title).join(', '));
    check(mix.every((m) => OWN_URL_T.test(m.href) || OWN_NAME_T.test(m.title)), 'and nothing that isn’t his', mix.map((m) => m.href).join(' '));
    check(mix.some((m) => m.href === feed[0].url && /Place on Meetup/.test(m.text)), 'one thirteen days out, only on his Meetup calendar, shows (place: on Meetup, never guessed)', '');
    check(!dup || mix.filter((m) => m.href === dup.url && Date.parse(dup.start)).length === own.filter((e) => e.url === dup.url).length, 'an event in both sources shows once', dup && dup.title);
    check(mix.every((m) => /Open on Meetup/.test(m.text) && !/\bgoing\b|interested|RSVPs?:/i.test(m.text.replace(/RSVP on Meetup/g, ''))), 'each links to Meetup and shows no Meetup interest count', '');
    if (!own.length) check(/No Btown Brief meetups/.test(await panelText(page)), 'with none on the calendar it says so and links the group', '');
    const rows = await clubCats(page);
    check(rows.length === 4 && rows.every((r) => clubs.some((c) => c.name === r.name)), 'four clubs from data/clubs.json', JSON.stringify(rows));
    check(rows[0].name === clubs.find((c) => c.featured).name, 'with nothing picked, the featured club leads', rows[0] && rows[0].name);
    const txt = await panelText(page);
    check(/No plans yet this week/.test(txt), 'an empty board says so and offers the first plan', '');
    check(/Posting one takes the email sign-in/.test(txt), 'signed out, the tab says posting is one email', '');
    check(/12 neighbors are in it/.test(txt) && /Sign in to see who’s in it/.test(txt), 'the directory: the count for anyone, the people after sign-in', '');
    const doors = await page.$$eval(peoplePanel + ' [data-sec="talk"] a.btn', (as) => as.map((a) => [a.textContent.trim(), a.href]));
    check(doors.length === 3 && /^Find Each Other/.test(doors[0][0]) && doors[0][1] === 'https://www.btownbrief.com/community/channels/music' &&
      /^Plans & Meetups/.test(doors[1][0]) && doors[1][1] === 'https://www.btownbrief.com/community/channels/meetups-hangouts' &&
      /^Telegram/.test(doors[2][0]) && doors[2][1] === base + '/telegram.html', 'one door card: Find Each Other, Plans & Meetups, Telegram', JSON.stringify(doors));
    const chipsTxt = await page.$$eval('#subnav .chip', (cs) => cs.map((c) => c.textContent));
    check(JSON.stringify(chipsTxt) === JSON.stringify(['Who you are', 'Open to strangers', 'Mixers', 'Quiz', 'Directory']), 'the chip row is the table of contents', JSON.stringify(chipsTxt));
    await page.click('#subnav .chip[data-chip="quiz"]');
    await page.waitForTimeout(700);
    const top = await page.$eval(peoplePanel + ' [data-sec="quiz"]', (s) => Math.round(s.getBoundingClientRect().top));
    check(top < 260, 'a chip scrolls to its section', top);
    await page.screenshot({ path: path.join(SHOTS, 'live-people-quiz.png') });
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  for (const v of [1, 2]) await group('People, live: a plan, its extras and posting, over the wire (server rules v' + v + ')', async () => {
    const seen = [];
    const now = new Date();
    const post = (id, title, meta, ago) => ({ id, board: 'people', kind: 'plan', title, body: '', place: 'Foam Brewers', meta, photo: null, author: 'Priya N.', author_arch: 'regular',
      created_at: new Date(now - (ago || 1) * 3600000).toISOString(), expires_at: new Date(+now + 13 * 86400000).toISOString(), votes: 3, voted: false, mine: false });
    const later = post('11111111-aaaa-4aaa-8aaa-000000000001', 'Trivia, need a fifth', { when: btvWhen(+now + 5 * 3600000), spots: 2 }, 1);
    const sooner = post('11111111-aaaa-4aaa-8aaa-000000000002', 'Coffee walk', { when: btvWhen(+now + 2 * 3600000), arch: 'new' }, 2);
    const past = post('11111111-aaaa-4aaa-8aaa-000000000003', 'Yesterday’s plan', { when: btvWhen(+now - 26 * 3600000) }, 30);
    let created = null;
    const { ctx, page, errors } = await newPage(browser, base, {
      rpc: (fn, body) => {
        seen.push([fn, body]);
        if (fn === 'nn_rules') return { version: v };
        if (fn === 'nn_posts_list') return body.p_board === 'people' ? [later, sooner, past].concat(created ? [created] : []) : [];
        if (fn === 'nn_people_plan_extras') return { [later.id]: { meetup: true, ages: 'thirties' } };
        if (fn === 'nn_profile_get') return { display_name: 'Robin', neighborhood: null, archetype: null };
        if (fn === 'nn_post_create') { created = post('11111111-aaaa-4aaa-8aaa-000000000009', body.p_title, body.p_meta, 0); created.author = 'Robin'; created.mine = true; return { ...created, status: 'approved' }; }
        if (fn === 'nn_people_plan_set') return { meetup: body.p_meetup, ages: body.p_ages };
        if (fn === 'nn_people_directory') return { count: 0, me: false, people: [] };
        return undefined;
      },
    });
    await page.goto(base + '/all-day/?x=1');
    await page.evaluate((s) => localStorage.setItem('allday-auth', s), SESSION());
    await page.goto(base + '/all-day/#people');
    await page.waitForSelector(peoplePanel + ' [data-plans] .card.board', { timeout: 15000 });
    let cards = await planCards(page);
    check(cards.length === 2 && cards[0].title === 'Coffee walk' && cards[1].title === 'Trivia, need a fifth', 'soonest first, and a plan whose time has passed is gone', JSON.stringify(cards.map((c) => c.title)));
    check(/Down for Meetup/.test(cards[1].meta) && /Mostly 30s/.test(cards[1].meta), 'nn_people_plan_extras puts the Meetup box and age band on the card', cards[1].meta);
    check(cards[1].going === '3 going', 'the vote reads as a going count', cards[1].going);
    const ask = seen.find(([fn]) => fn === 'nn_people_plan_extras');
    check(ask && ask[1].p_posts.length === 3, 'the extras are asked for the plans on the board, by id', JSON.stringify(ask && ask[1]));
    const p = await peek(page);
    check(p.posts.find((x) => x.title === 'Trivia, need a fifth').meta.meetup === true, 'and land in the plan’s meta', JSON.stringify(p.posts));
    check(/Down for Meetup\s*1/.test(await page.$eval(peoplePanel + ' [data-filter]', (r) => r.innerText)), 'the plans asking for Meetup are one chip away, counted', '');
    await page.click(peoplePanel + ' [data-filter] .chip[data-chip="meetup"]');
    cards = await planCards(page);
    check(cards.length === 1 && cards[0].title === 'Trivia, need a fifth', 'that chip shows just them', JSON.stringify(cards.map((c) => c.title)));

    await page.click(peoplePanel + ' [data-post]');
    await page.waitForSelector('.sheet-body form.bform input[name=title]');
    check(await page.$('.sheet-body input[name=display_name]') === null, 'a reader with a name is not asked again', '');
    await page.fill('input[name=title]', 'Sunset paddle from North Beach');
    await page.selectOption('select[name=day]', { index: 2 });
    await page.selectOption('select[name=time]', '6 pm');
    await page.selectOption('select[name=ages]', 'forties');
    await page.fill('input[name=spots]', '3');
    await page.check('input[name=meetup]');
    await page.click('.bform button[type=submit]');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached', timeout: 6000 });
    const make = seen.find(([fn]) => fn === 'nn_post_create');
    const extra = seen.find(([fn]) => fn === 'nn_people_plan_set');
    check(make && make[1].p_board === 'people' && make[1].p_kind === 'plan' && /, 6 pm$/.test(make[1].p_meta.when) && make[1].p_meta.spots === 3,
      'nn_post_create gets a people plan with when and spots', JSON.stringify(make && make[1]));
    if (v === 1) {
      check(make && Object.keys(make[1].p_meta).every((k) => ['when', 'arch', 'spots'].includes(k)), 'on round one’s rules, its meta holds only the keys those rules allow', JSON.stringify(make && make[1].p_meta));
      check(extra && extra[1].p_post === '11111111-aaaa-4aaa-8aaa-000000000009' && extra[1].p_meetup === true && extra[1].p_ages === 'forties',
        'then nn_people_plan_set records the Meetup box and age band for that plan', JSON.stringify(extra && extra[1]));
    } else {
      check(make && make[1].p_meta.meetup === true && make[1].p_meta.ages === 'forties', 'on round two’s rules, the Meetup box and age band are the plan’s own fields', JSON.stringify(make && make[1].p_meta));
      check(!extra, 'and the side table is not written', JSON.stringify(extra));
    }
    check(/Stephen will see you’re down for Meetup/.test(await page.$eval('#toast', (t) => t.textContent)), 'and the toast says so', '');
    check(seen.every(([fn, b]) => !/@/.test(JSON.stringify(b))), 'no call carries an email', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('People, live: a late directory answer never reaches the next reader', async () => {
    /* reader A (in the directory) asks; before the answer lands, another tab signs this browser in as reader B */
    const { ctx, page, errors } = await newPage(browser, base, {
      auth: (p, body) => (/^token/.test(p) ? { body: { access_token: 'tok-' + body.refresh_token, refresh_token: body.refresh_token + '+', expires_in: 3600, user: { id: /^rB/.test(body.refresh_token) ? 'u-2' : 'u-1' } } } : undefined),
      rpc: (fn) => (fn === 'nn_profile_get' ? { display_name: 'Reader', neighborhood: null, archetype: null } : fn === 'nn_people_directory' ? { count: 2, me: false, people: [] } : undefined),
    });
    let first = true;
    await page.route(/\/rest\/v1\/rpc\/nn_people_directory/, async (r) => {
      if (!first) return r.fallback();
      first = false;
      await new Promise((res) => setTimeout(res, 1200));
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 2, me: true, people: [{ name: 'Ana', neighborhood: null, archetype: null, interests: [], me: true }, { name: 'Lee Q.', neighborhood: null, archetype: null, interests: [], me: false }] }) });
    });
    await page.goto(base + '/all-day/?x=1');
    await page.evaluate((s) => localStorage.setItem('allday-auth', s), SESSION());
    const asked = page.waitForRequest(/nn_people_directory/, { timeout: 10000 });
    await page.goto(base + '/all-day/#people');
    await asked;
    const two = await ctx.newPage();
    await two.goto(base + '/all-day/?x=2');
    await two.evaluate(() => localStorage.setItem('allday-auth', JSON.stringify({ refresh_token: 'rB', user: { id: 'u-2' } })));
    await page.waitForTimeout(1800);
    const st = await page.evaluate(() => import('/all-day/js/app.js').then((a) => (a.user() || {}).id));
    const txt = await page.$eval(peoplePanel + ' [data-sec="dir"]', (s) => s.innerText);
    check(st === 'u-2', 'the tab now belongs to reader B', st);
    check(!/Lee Q\./.test(txt) && await page.$(peoplePanel + ' [data-dir="join"]') !== null, 'reader A’s late directory never draws for reader B, who is not in it', txt.slice(0, 160));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('People, demo: who you are reorders the plans and the clubs', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#people');
    await page.waitForSelector(peoplePanel + ' [data-plans] .card.board');
    const before = await planCards(page);
    check(before.length >= 5 && before.every((c) => /\d+ going|Be the first/.test(c.going)), 'the demo’s plans, each with its going count', JSON.stringify(before.map((c) => c.going)));
    await page.click(peoplePanel + ' .arch button[data-arch="trail"]');
    await page.waitForTimeout(150);
    const trail = await planCards(page);
    check(/For trail people|Trail person/.test(trail[0].meta + trail[0].who) && trail[0].title !== before[0].title, 'Trail person: a trail plan moves to the top', trail[0].title);
    const tc = await clubCats(page);
    check(['Hiking & Outdoors', 'Running', 'Biking'].includes(tc[0].cat), 'and a trail club leads the clubs', JSON.stringify(tc));
    check(await page.$eval(peoplePanel + ' .arch button[data-arch="trail"]', (b) => b.getAttribute('aria-pressed')) === 'true', 'the tile says it is picked', '');
    check(/You’re here as trail person/.test(await page.$eval('#toast', (t) => t.textContent)), 'and the toast says what changed', '');
    await page.click(peoplePanel + ' .arch button[data-arch="games"]');
    await page.waitForTimeout(150);
    const games = await planCards(page);
    check(/For game night people|Game night/.test(games[0].meta + games[0].who), 'Game night: a game night plan leads', games[0].title);
    check(['Games & Puzzles', 'Sports & Rec'].includes((await clubCats(page))[0].cat), 'and a games or sports club', '');
    await page.click(peoplePanel + ' [data-tags="I’m…"] .chip[data-chip="women"]');
    await page.waitForTimeout(150);
    const w = await clubCats(page);
    check(/Womxn|Ultimate/.test(w[0].name) && /Womxn|Ultimate/.test(w[1].name), 'a woman finding her people: the two women’s and nonbinary pickup clubs come first', JSON.stringify(w));
    check(await page.$eval(peoplePanel + ' [data-tags="I’m…"] .chip[data-chip="women"]', (b) => b.getAttribute('aria-pressed')) === 'true', 'the tag shows as picked', '');
    const p = await peek(page);
    check(p.arch === 'games' && p.tags.includes('women'), 'the picks are kept for the visit', JSON.stringify(p));
    check(await page.evaluate(() => localStorage.getItem('allday-people')) === null, 'and the demo writes nothing to this device', '');
    await page.click(peoplePanel + ' .arch button[data-arch="games"]');
    await page.waitForTimeout(150);
    check((await planCards(page))[0].title === before[0].title, 'tapping the tile again clears it: back to soonest first', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('People, demo: posting a plan, the Meetup box, I’d go', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#people');
    await page.waitForSelector(peoplePanel + ' [data-plans] .card.board');
    check((await planCards(page)).length >= 5, 'signed out, the plans show', '');
    await page.click(peoplePanel + ' [data-post]');
    await page.waitForSelector('.sheet-body .linkrow');
    check(/Posting a plan needs the email sign-in: one email, no password/.test(await page.$eval('.sheet-body', (b) => b.innerText)) && await page.$('.sheet-body form') === null,
      'signed out, Post a plan gives the sign-in note and no form', '');
    await page.keyboard.press('Escape');
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.waitForTimeout(150);
    await page.click(peoplePanel + ' [data-post]');
    await page.waitForSelector('.sheet-body form.bform input[name=display_name]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, 'demo-people-compose.png') });
    await page.fill('input[name=display_name]', 'Robin');
    await page.fill('input[name=title]', 'Sunset paddle from North Beach');
    await page.click('.bform button[type=submit]');
    check(/Pick the day and the time/.test(await page.$eval('.bf-msg', (m) => m.textContent)), 'no day or time: refused, with the reason', '');
    await page.selectOption('select[name=day]', { index: 2 });
    await page.selectOption('select[name=time]', '6 pm');
    await page.selectOption('select[name=ages]', 'forties');
    await page.fill('input[name=spots]', '99');
    await page.click('.bform button[type=submit]');
    check(/Spots is a number from 1 to 50/.test(await page.$eval('.bf-msg', (m) => m.textContent)), 'the board’s own rule on spots is checked first', '');
    await page.fill('input[name=spots]', '3');
    await page.fill('input[name=place]', 'North Beach');
    await page.check('input[name=meetup]');
    await page.click('.bform button[type=submit]');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached', timeout: 6000 });
    await page.waitForTimeout(300);
    const p = await peek(page);
    const mine = p.posts.find((x) => x.title === 'Sunset paddle from North Beach');
    check(mine && mine.meta.meetup === true && mine.meta.ages === 'forties' && /, 6 pm$/.test(mine.meta.when) && mine.meta.spots === 3,
      'it posts through the compose sheet, and the Meetup box lands in its meta', JSON.stringify(mine));
    const board = await fakeOf(page, `(f) => f.posts.find((x) => x.id === '${mine.id}').meta`);
    check(board.meetup === true && board.ages === 'forties', 'on the board itself: the box and the band are the plan’s own fields', JSON.stringify(board));
    const k = 'b-' + mine.id;
    const sel = peoplePanel + ' [data-plans] .card.board[data-k="' + k + '"]';
    check(await flashes(page, k), 'the new plan is on the tab, scrolled to and flashed', k);
    const card = await page.$eval(sel, (c) => ({ meta: c.querySelector('.b-meta').textContent, going: c.querySelector('.going').textContent, who: c.querySelector('.c-src').textContent,
      del: !!c.querySelector('[data-act=bdelete]'), label: c.querySelector('[data-act=bvote]').getAttribute('aria-label') }));
    check(/Down for Meetup/.test(card.meta) && /Mostly 40s/.test(card.meta) && /3 spots/.test(card.meta), 'its card says Down for Meetup, the band and the spots', card.meta);
    check(card.who === 'Robin' && card.del && card.label === 'I’d go' && card.going === 'Be the first', 'by first name, yours to delete, with I’d go and no one going yet', JSON.stringify(card));
    await page.click(sel + ' [data-act=bvote]');
    await page.waitForFunction((s) => document.querySelector(s + ' .going').textContent === '1 going', sel, { timeout: 3000 }).catch(() => {});
    check(await page.$eval(sel + ' .going', (g) => g.textContent) === '1 going' && await page.$eval(sel + ' [data-act=bvote]', (b) => b.getAttribute('aria-pressed')) === 'true', 'I’d go: the going count goes to 1', '');
    const other = peoplePanel + ' [data-plans] .card.board:not([data-k="' + k + '"])';
    const g0 = Number((await page.$eval(other, (c) => c.querySelector('.going').textContent)).match(/\d+/)[0]);
    await page.click(other + ' [data-act=bvote]');
    await page.waitForTimeout(150);
    check(await page.$eval(other, (c) => c.querySelector('.going').textContent) === (g0 + 1) + ' going', 'on someone else’s plan too: ' + g0 + ' going becomes ' + (g0 + 1), '');
    await page.click(sel + ' [data-act=bvote]');
    await page.waitForTimeout(150);
    check(await page.$eval(sel + ' .going', (g) => g.textContent) === 'Be the first', 'and tapping again takes it back', '');
    await pageRules(page, 'people', 390);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('People, demo: the quiz never asks age, and ends in a suggestion', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { viewport: { width: 1280, height: 800 }, scheme: 'dark' });
    await page.goto(base + '/all-day/?demo=1#people/quiz');
    await page.waitForSelector(peoplePanel + ' [data-plans] .card.board');
    const all = await page.evaluate(() => import('/all-day/js/modes/people.js').then((m) => m.QUIZ_TEXT()));
    check(all.split('\n').length >= 6 && all.split('\n').length <= 8, 'six to eight questions', all.split('\n').length);
    check(!NO_ID_QUESTIONS.test(all), 'no question or answer asks age, gender or orientation', (all.match(NO_ID_QUESTIONS) || [''])[0]);
    await page.click(peoplePanel + ' [data-quiz="intro"] button:has-text("Take the quiz")');
    const route = [1, 0, 1, 1, 1, 0, 0];   // weekends, outside, three or four, do, a few years, a trail, the same thing every week
    const asked = [];
    for (let i = 0; i < route.length; i++) {
      await page.waitForSelector(peoplePanel + ' [data-quiz="q' + i + '"]');
      asked.push(await page.$eval(peoplePanel + ' [data-quiz="q' + i + '"]', (c) => c.innerText));
      await page.click(peoplePanel + ' [data-quiz="q' + i + '"] [data-answers] button:nth-child(' + (route[i] + 1) + ')');
    }
    check(asked.length === 7 && asked.every((t) => !NO_ID_QUESTIONS.test(t)), 'seven questions on the page, none about age, gender or orientation', '');
    await page.waitForSelector(peoplePanel + ' [data-quiz="done"]');
    const res = await page.$eval(peoplePanel + ' [data-quiz="done"]', (c) => ({ text: c.innerText, clubs: c.querySelectorAll('[data-quiz-clubs] .lrow').length,
      channel: c.querySelector('[data-channel] a').getAttribute('href'), mixers: c.querySelectorAll('a.lrow[href*="meetup.com/burlington-social"]').length }));
    check(/Probably: Trail person/.test(res.text) && /a guess, not a box/.test(res.text), 'it ends in a suggested archetype the reader can change', res.text.slice(0, 160));
    check(res.clubs === 3 && res.mixers >= 1, 'with three clubs and the next mixers', JSON.stringify(res));
    check(res.channel === 'https://www.btownbrief.com/community/channels/meetups-hangouts', 'and the community channel that fits (a doer: Plans & Meetups)', res.channel);
    await page.screenshot({ path: path.join(SHOTS, 'demo-people-quiz.png') });
    check((await peek(page)).arch === null, 'nothing changes until the reader says so', '');
    await page.click(peoplePanel + ' [data-quiz="done"] button:has-text("That’s me")');
    await page.waitForTimeout(150);
    const p = await peek(page);
    check(p.arch === 'trail' && JSON.stringify(p.quizTags) === '["outdoors"]', '“That’s me” takes the archetype and what the quiz learned', JSON.stringify(p));
    check(await page.$eval(peoplePanel + ' .arch button[data-arch="trail"]', (b) => b.classList.contains('on')), 'and the tile at the top lights', '');
    await page.click(peoplePanel + ' .arch button[data-arch="new"]');
    check((await peek(page)).arch === 'new', 'the reader can still pick another', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('People, demo: what you’re into follows your profile; who you are never leaves the phone', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#people');
    await page.waitForSelector(peoplePanel + ' [data-plans] .card.board');
    await page.click(peoplePanel + ' [data-tags="I’m into…"] .chip[data-chip="books"]');
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.setProfile({ display_name: 'Robin' })));
    const profileOf = () => page.evaluate(() => import('/all-day/js/boards.js').then((b) => (b._fake().profiles.get(b.demoReader) || {}).interests));
    await page.waitForFunction(() => import('/all-day/js/boards.js').then((b) => ((b._fake().profiles.get(b.demoReader) || {}).interests || []).length === 1), null, { timeout: 4000 }).catch(() => {});
    check(JSON.stringify(await profileOf()) === '["books"]', 'signing in with a name: the into-tag picked on this phone goes up to the profile', JSON.stringify(await profileOf()));
    await page.click(peoplePanel + ' [data-tags="I’m into…"] .chip[data-chip="running"]');
    await page.click(peoplePanel + ' [data-tags="I’m…"] .chip[data-chip="lgbtq"]');
    await page.waitForTimeout(300);
    check(JSON.stringify(await profileOf()) === '["running","books"]', 'a tag tapped on the tab is saved to the profile, in the list’s order', JSON.stringify(await profileOf()));
    check(!/lgbtq/.test(JSON.stringify(await fakeOf(page, (f) => [...f.profiles.values()]))), 'a who-you-are tag never reaches the profile', '');
    await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.setProfile({ display_name: 'Robin', interests: ['music'] })));
    await page.waitForTimeout(300);
    const p = await peek(page);
    check(p.tags.includes('music') && !p.tags.includes('running') && !p.tags.includes('books') && p.tags.includes('lgbtq'), 'a change made in the profile sheet is the tab’s; who you are stays as it was', JSON.stringify(p.tags));
    check(/What you’re into is saved to your profile too/.test(await page.$eval(peoplePanel + ' [data-sec="arch"]', (s) => s.innerText)), 'and the tab says where each kind of tag lives', '');
    await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.setProfile({ display_name: 'Robin', interests: [] })));
    await page.waitForTimeout(400);
    check(!(await peek(page)).tags.some((t) => ['music', 'running', 'books'].includes(t)) && JSON.stringify(await profileOf()) === '[]',
      'cleared in the profile sheet: the tab clears them too, and nothing writes them back', JSON.stringify([(await peek(page)).tags, await profileOf()]));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('People, demo: the directory is opt-in and never shows an email', async () => {
    const demo = JSON.parse(await readFile(path.join(APP, 'data/demo/people.json'), 'utf8'));
    const on = demo.directory.filter((r) => r.on).map((r) => r.name), off = demo.directory.filter((r) => !r.on).map((r) => r.name);
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#people/dir');
    await page.waitForSelector(peoplePanel + ' [data-dir="out"]');
    let txt = await page.$eval(peoplePanel + ' [data-sec="dir"]', (s) => s.innerText);
    check(new RegExp(on.length + ' neighbors are in it').test(txt) && !on.concat(off).some((n) => txt.includes(n)), 'signed out: how many, and nobody by name', txt.slice(0, 200));
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.waitForSelector(peoplePanel + ' [data-dir="join"]');
    check(/Add your first name/.test(await page.$eval(peoplePanel + ' [data-dir="join"]', (c) => c.innerText)), 'signed in with no name: asked for one first', '');
    await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.setProfile({ display_name: 'Robin', neighborhood: 'south-end', archetype: 'trail' })));
    await page.waitForSelector(peoplePanel + ' [data-dir="join"] button:has-text("Join the directory")');
    txt = await page.$eval(peoplePanel + ' [data-sec="dir"]', (s) => s.innerText);
    check(!on.concat(off).some((n) => txt.includes(n)), 'not in it yet: still nobody by name', '');
    await page.click(peoplePanel + ' [data-tags="I’m into…"] .chip[data-chip="running"]');
    await page.click(peoplePanel + ' [data-tags="I’m…"] .chip[data-chip="lgbtq"]');
    await page.click(peoplePanel + ' [data-dir="join"] button:has-text("Join the directory")');
    await page.waitForSelector(peoplePanel + ' [data-people]');
    const rows = await page.$$eval(peoplePanel + ' [data-people] .lrow', (rs) => rs.map((r) => r.innerText));
    txt = await page.$eval(peoplePanel + ' [data-sec="dir"]', (s) => s.innerText);
    check(rows.length === on.length + 1, 'in it: everyone who opted in, and you', rows.length);
    check(on.every((n) => txt.includes(n)) && !off.some((n) => txt.includes(n)), 'only opted-in rows: ' + off.join(' and ') + ' never show', '');
    check(/Robin \(you\)/.test(rows[0]) && /South End/.test(rows[0]) && /Trail person/.test(rows[0]) && /Into running/.test(rows[0]), 'your row: first name, neighborhood, tile, interests', rows[0]);
    check(!/LGBTQ|lgbtq/.test(txt), 'the who-you-are tags never reach the directory', '');
    check(!/@/.test(txt) && !/@/.test(await page.$eval(peoplePanel, (p) => p.innerHTML)), 'no email anywhere on the tab', '');
    await page.click(peoplePanel + ' [data-sec="dir"] button:has-text("Leave the directory")');
    await page.waitForSelector(peoplePanel + ' [data-dir="join"]');
    check(new RegExp(on.length + ' neighbors are in it').test(await page.$eval(peoplePanel + ' [data-sec="dir"]', (s) => s.innerText)), 'leaving takes you out of the count', '');
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
  await run(thePeople);
  await run(onAir);
  await run(theGames);
  await run(theWatch);
  await run(interactions);
  await run(shellFixes);
  await run(accounts);
  await run(boards);
  await run(boardPhotos);
  await run(theArt);
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
