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
import { FakeHabits } from '../js/habits-fake.js';

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
const TABS = ['wire', 'watch', 'food', 'people', 'whatnow', 'vintage', 'habits', 'onair', 'games'];
const LABELS = ['Wire', 'Watch', 'Food', 'People', 'What Now', 'Vintage', 'Habits', 'On Air', 'Games'];
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
    const stickies = bare.match(/[^{}]*\{[^{}]*sticky[^{}]*\}/g) || [];
    check(stickies.length === 1 && /^\s*\.collapsebar \{/.test(stickies[0]), 'nothing is position: sticky but the Collapse bar under an opened list', stickies.map((x) => x.trim().slice(0, 40)).join(' | '));

    const js = [];
    const walk = async (dir) => { for (const f of await readdir(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) await walk(p); else if (/\.(js|css|html)$/.test(f.name)) js.push(p); } };
    await walk(path.join(APP, 'js')); await walk(path.join(APP, 'css'));
    const NEW = ['app.js', 'ui.js', 'store.js', 'auth.js', 'liquid.js', 'main.js', 'wire.js', 'wire-demo.js', 'wire-photos.js', 'wire-square.js', 'watch.js', 'food.js', 'people.js', 'whatnow.js', 'vintage.js', 'habits.js', 'habits-core.js', 'habits-fake.js', 'photo-wall.js', 'onair.js', 'games.js', 'clubs-week.js', 'people-match.js', 'tokens.css', 'app.css'];
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
/* tag_wire.py's topics, for opts.topics; 'world' and 'tech' have no chip */
const WIRE_TOPICS = ['city-government', 'world', 'public-safety', 'state-politics', 'tech', 'arts-culture', 'weather', 'business', 'music'];
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
    /* a thread's link is its subreddit's, as tag_wire.py's input has it:
       some r/burlington, some r/news (the Square keeps only the first) */
    if (ch === 'reddit') it.url = 'https://www.reddit.com/r/' + (i % 2 ? 'burlington' : 'news') + '/comments/' + tag + i + '/x/';
    if (opts.topics) it.topic = WIRE_TOPICS[i % WIRE_TOPICS.length];
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
  /* one list by importance, local and national interleaved as the editor
     ranks them (Stephen, 2026-10-17): every third slot national, so the
     Everything view's top five mix both */
  const locals = ranked.filter((it) => it.local).slice(0, 25), nationals = ranked.filter((it) => !it.local).slice(0, 15);
  const mixed = [];
  while (locals.length || nationals.length) mixed.push((mixed.length % 3 === 1 && nationals.length) || !locals.length ? nationals.shift() : locals.shift());
  const picks = mixed.map((it, r) => ({ ...it, rank: r + 1, why: r === 2 ? '' : 'Reason ' + (r + 1) + ': why this one matters.' }));
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
  const o = { inbox: !!opts.inbox, brief: opts.brief !== false, topics: !!opts.topics };
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
   Burlington. `audio` picks the clip state: 'today' (the newest edition is
   today's), 'older' (only the edition before it), 'none', or 'recap' (the
   retired daily recap's v1 index, whose clips carry no kind). */
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
/* The clip: the fixture's two seconds of silence, its audio frames repeated
   thirty times (about a minute), so a test can resume past the 30-second mark
   and still be ten seconds from the end. The ID3 tag and the LAME Info frame
   are dropped (the Info frame would claim 78 frames and the old length), so
   the browser reads the length from the bitrate, as it does for a CBR file. */
function longSilence(mp3) {
  const id3 = mp3.subarray(0, 3).toString() === 'ID3' ? 10 + ((mp3[6] << 21) | (mp3[7] << 14) | (mp3[8] << 7) | mp3[9]) : 0;
  let i = id3 + 4;
  while (i < mp3.length - 1 && !(mp3[i] === 0xff && (mp3[i + 1] & 0xe0) === 0xe0)) i++;   // the frame after the Info frame
  const frames = mp3.subarray(i);
  return Buffer.concat(Array.from({ length: 30 }, () => frames));
}
/* raw.githubusercontent.com answers a Range request with 206 and the slice
   (curl -r 0-1 on a real clip, 2026-10-17); the test server does the same */
function fulfillBytes(r, body, type) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(r.request().headers().range || '');
  if (!m || (!m[1] && !m[2])) return r.fulfill({ status: 200, body, contentType: type, headers: { 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' } });
  const start = m[1] ? Number(m[1]) : Math.max(0, body.length - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), body.length - 1) : body.length - 1;
  if (start >= body.length) return r.fulfill({ status: 416, body: '', headers: { 'content-range': 'bytes */' + body.length } });
  return r.fulfill({ status: 206, body: body.subarray(start, end + 1), contentType: type,
    headers: { 'accept-ranges': 'bytes', 'content-range': 'bytes ' + start + '-' + end + '/' + body.length, 'access-control-allow-origin': '*' } });
}
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
  let clips = d.audio.clips.map((c) => ({ ...c, date: shift(c.date), file: shift(c.date) + '.mp3', script: shift(c.date) + '.txt', made: new Date().toISOString() }));
  if (audio === 'recap') clips = clips.map(({ kind, ...c }) => c);
  const index = { v: audio === 'recap' ? 1 : 2, updated: new Date().toISOString(), clips: audio === 'none' ? [] : audio === 'older' ? clips.slice(1) : clips };
  const files = { 'btown-tv.json': JSON.stringify(tv), 'tv-editions.json': JSON.stringify(d.tvEditions), 'index.json': JSON.stringify(index) };
  const out = { files, tv, index, today, clips, mp3: longSilence(await readFile(path.join(HERE, 'fixtures/silence.mp3'))) };
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
    /* opts.geo: a position the reader has allowed; without it, location is refused */
    ...(opts.geo ? { geolocation: opts.geo, permissions: ['geolocation'] } : {}),
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
    if (/\.mp3$/.test(name) && onair.index.clips.some((c) => c.file === name)) return fulfillBytes(r, onair.mp3, 'audio/mpeg');
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
  /* Watch's time machine and showtimes, on the same branch: empty unless a
     group passes opts.tm / opts.showtimes (a payload, or null for a 404) */
  const wExtra = { 'time-machine.json': opts.tm === undefined ? { v: 1, titles: {}, months: [] } : opts.tm,
    'showtimes.json': opts.showtimes === undefined ? { v: 1, theaters: [] } : opts.showtimes };
  await page.route(/raw\.githubusercontent\.com\/btownbrief\/btown-brief\/films-data\/data\/(time-machine|showtimes)\.json$/, (r) => {
    const body = wExtra[r.request().url().match(/([\w-]+\.json)$/)[1]];
    return body === null ? r.fulfill({ status: 404, body: '' }) : r.fulfill({ status: 200, body: JSON.stringify(body), contentType: 'application/json' });
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
      if ((cs.position === 'fixed' || cs.position === 'sticky') && !n.matches('.collapsebar')) bad.fixed.push(n.className);
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
  /* the Wire keeps the dateline, the Local switch and its chips on rows of
     their own under the News · Photos · Square switch (Stephen, 2026-10-17:
     the chips "underneath the local and everything") */
  const rows = /^wire/.test(tab) ? 3 : 2;
  check(r.subRows <= rows, tab + ': at most ' + rows + ' subnav rows', r.subRows);
}

/* --------------------------------------------------------------- the matrix */
const COMBOS = [
  { viewport: { width: 390, height: 844 }, scheme: 'light', motion: 'no-preference' },
  { viewport: { width: 390, height: 844 }, scheme: 'dark', motion: 'no-preference' },
  { viewport: { width: 390, height: 844 }, scheme: 'light', motion: 'reduce' },
  { viewport: { width: 1280, height: 800 }, scheme: 'light', motion: 'no-preference' },
  { viewport: { width: 1280, height: 800 }, scheme: 'dark', motion: 'reduce' },
];
const PAPER = { light: 'rgb(247, 244, 238)', dark: 'rgb(12, 21, 32)' };
/* tabs that are built: live, they draw their screen instead of the promise */
const LIVE = new Set(['wire', 'watch', 'whatnow', 'onair', 'games', 'food', 'habits', 'vintage', 'people']);

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
        const statusBar = await page.evaluate(() => ({
          meta: document.querySelector('meta[name="theme-color"]').content,
          lake: getComputedStyle(document.documentElement).getPropertyValue('--lake').trim()
        }));
        check(statusBar.meta === statusBar.lake, 'phone status bar matches the navy mast', JSON.stringify(statusBar));
        if (combo.viewport.width >= 900) {
          const rail = await page.evaluate(() => { const r = document.querySelector('#tabbar').getBoundingClientRect(); return { w: r.width, h: r.height }; });
          check(rail.w === 208 && rail.h > 600, 'the tab bar is a 208px left rail', JSON.stringify(rail));
          const titleColor = await page.$eval('.mast-title', n => getComputedStyle(n).color);
          check(titleColor === 'rgb(247, 244, 238)', 'desktop tab title stays cream on the navy mast', titleColor);
          const over = await page.$$eval('#tabbar button[data-tab]', (bs) => bs.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.dataset.tab));
          check(!over.length, 'no tab label overflows the rail', over.join(', '));
        } else {
          const cells = await page.$$eval('#tabbar button[data-tab]', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return [b.dataset.tab, Math.round(r.width), Math.round(r.height), b.scrollWidth <= b.clientWidth + 1]; }));
          check(cells.every((c) => c[2] >= 44), 'tab targets are at least 44px tall', JSON.stringify(cells));
          check(cells.every((c) => c[3]), 'no tab label overflows its cell', JSON.stringify(cells.filter((c) => !c[3])));
          const wn = cells.find((c) => c[0] === 'whatnow');
          check(wn[1] > cells[0][1], 'What Now gets the wider cell', JSON.stringify(cells));
          check(new Set(cells.map((c) => c[2])).size === 1, 'the disc grows no cell: all nine the same height', JSON.stringify(cells));
        }
        /* What Now is the bar's centre: its icon in a filled disc, its label bold (Stephen, 2026-10-17) */
        const disc = await page.$eval('#tab-whatnow .i', (i) => { const c = getComputedStyle(i), r = i.getBoundingClientRect();
          return { radius: c.borderTopLeftRadius, bg: c.backgroundColor, w: Math.round(r.width), h: Math.round(r.height), weight: getComputedStyle(i.nextElementSibling).fontWeight }; });
        check(disc.radius === '50%' && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(disc.bg) && disc.w === disc.h && disc.weight === '700', 'What Now’s icon sits in a filled disc, its label bold', JSON.stringify(disc));
        if (!demo && combo.motion !== 'reduce') await page.locator('#tabbar').screenshot({ path: path.join(SHOTS, 'tabbar-' + combo.viewport.width + '-' + combo.scheme + '.png') });
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
          if (demo && combo === COMBOS[3] && (tab === 'wire' || tab === 'onair' || tab === 'games' || tab === 'habits' || tab === 'people')) await page.screenshot({ path: path.join(SHOTS, 'demo-' + tab + '-desktop.png') });
          if (!demo && combo === COMBOS[0] && (tab === 'wire' || tab === 'watch' || tab === 'food' || tab === 'onair' || tab === 'games' || tab === 'habits' || tab === 'vintage' || tab === 'people')) await page.screenshot({ path: path.join(SHOTS, 'live-' + tab + '.png') });
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
    const cases = [['wire', 'w13'], ['wire', 'y4'], ['watch', 'f9003'], ['food', 'r-demo-all-night-diner'], ['people', 'mx-dm2'], ['whatnow', 'e-tn3'], ['vintage', 's-battery-street-jeans'], ['habits', 'next-season'], ['onair', 'yt:demo-tv-003'], ['games', 'g:trivia-ladder'], ['games', 'champ:btown-riddle']];
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

    /* the chips: kinds only, X and Facebook hidden while paused, no Video,
       Instagram before Newsletters; Unfiltered is a button beside the switch */
    const chipsNow = await page.$$eval('#subnav .chip', (cs) => cs.map((c) => [c.dataset.chip, (c.querySelector('.n') || {}).textContent || '']));
    check(JSON.stringify(chipsNow.map((c) => c[0])) === JSON.stringify(['all', 'reddit', 'instagram', 'newsletters']), 'X and Facebook chips are hidden while paused; no Video chip', JSON.stringify(chipsNow));
    check(chipsNow.filter((c) => !['all', 'instagram'].includes(c[0])).every((c) => Number(c[1]) === today.counts.local[c[0]]), 'chip counts are counts.local', JSON.stringify(chipsNow));
    const layout = await page.evaluate(() => {
      const sub = document.querySelector('#subnav');
      const kids = [...sub.children].map((n) => n.className.split(' ')[0] + (n.classList.contains('w-chips') ? '.w-chips' : ''));
      const sw = sub.querySelector('.localsw').getBoundingClientRect(), ch = sub.querySelector('.chips').getBoundingClientRect();
      return { kids, below: ch.top >= sw.bottom - 1, raw: !!sub.querySelector('.toolband:not(.w-chips) .w-raw') };
    });
    check(JSON.stringify(layout.kids) === JSON.stringify(['wmodes', 'dateline', 'toolband', 'toolband.w-chips']) && layout.below && layout.raw,
      'under the mast: News · Photos · Square, the dateline, the Local switch with Unfiltered, then the chips on their own row', JSON.stringify(layout));

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
    for (const [k, n] of chipsNow.filter((c) => !['all', 'instagram'].includes(c[0]))) {
      await chipTo(page, k);
      await drawToday(page);
      const got = (await todayKeys(page)).length;
      check(got === Number(n), 'the ' + k + ' chip shows exactly its count today (' + n + ')', got);
    }
    await chipTo(page, 'all');
    await page.click('#subnav .localsw-half:not(.on)');
    await page.waitForTimeout(150);
    const every = await page.$$eval('#subnav .chip', (cs) => cs.map((c) => [c.dataset.chip, (c.querySelector('.n') || {}).textContent || '']));
    check(every.filter((c) => !['all', 'instagram'].includes(c[0])).every((c) => Number(c[1]) === today.counts.everything[c[0]]), 'on Everything the chips are counts.everything', JSON.stringify(every));
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
    const sumAfter = after.filter((c) => !['all', 'instagram'].includes(c[0])).reduce((a, c) => a + c[1], 0);
    const sumBefore = every.filter((c) => !['all', 'instagram'].includes(c[0])).reduce((a, c) => a + Number(c[1]), 0);
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

  await group('the Wire, What matters flips through earlier days', async () => {
    const files = wireFiles();
    const today = files['wire-today.json'];
    const [y1, y2] = files['index.json'].editions.map((e) => e.date);
    const PREV = '.panel:not([hidden]) .wm-top [aria-label="Earlier day\'s picks"]';
    const NEXT = '.panel:not([hidden]) .wm-top [aria-label="Later day\'s picks"]';
    const top = () => page.$eval('.panel:not([hidden]) .wm-top', (w) => ({
      title: w.querySelector('h2').textContent, sub: (w.querySelector('.sec p') || {}).textContent || '', showing: w.dataset.showing,
      keys: [...w.querySelectorAll('[data-k]')].map((x) => x.dataset.k),
      prev: w.querySelector('[aria-label="Earlier day\'s picks"]').disabled, next: w.querySelector('[aria-label="Later day\'s picks"]').disabled }));
    /* the river as drawn: every card outside the block, up to the first earlier-day head */
    const river = () => page.evaluate(() => {
      const out = [];
      for (const n of document.querySelectorAll('.panel:not([hidden]) .feed [data-k], .panel:not([hidden]) .feed [data-day]')) {
        if (n.dataset.day) break;
        if (!n.closest('.wm-top')) out.push(n.dataset.k);
      }
      return out;
    });
    const showing = (date) => page.waitForFunction((d) => document.querySelector('.panel:not([hidden]) .wm-top')?.dataset.showing === d, date, { timeout: 6000 }).catch(() => {});
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/');
    await page.waitForSelector('.panel:not([hidden]) .wm-top', { timeout: 15000 });
    await page.click('#subnav .localsw-half:not(.on)');
    await page.waitForTimeout(150);
    const tk = today.date;
    const t0 = await top();
    const localOf = Object.fromEntries(today.picks.map((x) => [x.id, x.local]));
    const five = t0.keys.slice(0, 5).map((k) => localOf[k]);
    check(five.length === 5 && five.some((x) => x === true) && five.some((x) => x === false), 'on Everything the top five mix local and national', JSON.stringify(five));
    check(JSON.stringify(t0.keys.slice(0, 5)) === JSON.stringify(today.picks.slice(0, 5).map((x) => x.id)), 'in the editor’s one ranking, as given', JSON.stringify(t0.keys.slice(0, 5)));
    check(t0.title === 'What matters today' && t0.showing === tk && !t0.prev && t0.next, 'today: ‹ is live, › is disabled', JSON.stringify(t0));
    const sizes = await page.$$eval('.panel:not([hidden]) .wm-top .wm-nav .nav', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return [r.width, r.height]; }));
    check(sizes.length === 2 && sizes.every(([w, h]) => w >= 44 && h >= 44), 'the arrows are 44px targets', JSON.stringify(sizes));
    const riverBefore = await river();
    check(riverBefore.length > 20, 'the river is drawn under the block (' + riverBefore.length + ')', riverBefore.length);

    await page.click(PREV);
    await showing(y1);
    const t1 = await top();
    const yday = files[y1 + '.json'];
    const yWeek = nameOf(y1).split(',')[0];
    check(t1.title === 'What mattered ' + yWeek && t1.sub.startsWith(nameOf(y1).split(', ')[1]) && /Today$/.test(t1.sub), '‹ reads “What mattered ' + yWeek + '”, its date under it and a Today link', JSON.stringify([t1.title, t1.sub]));
    check(JSON.stringify(t1.keys.slice(0, 5)) === JSON.stringify(yday.picks.slice(0, 5).map((x) => x.id)), '‹ flips the block in place to yesterday’s picks', JSON.stringify(t1.keys.slice(0, 5)));
    check(!t1.prev && !t1.next, 'yesterday: both arrows live', JSON.stringify(t1));
    check(await page.$eval('.panel:not([hidden]) .wm-top', (w) => getComputedStyle(w).animationName) === 'wm-in', 'with a short fade when motion is allowed', '');
    check(JSON.stringify(await river()) === JSON.stringify(riverBefore), 'the river below does not change', '');
    check(await page.$eval('#subnav .dl b', (b) => b.textContent) === nameOf(tk), 'the dateline stays on today', await page.$eval('#subnav .dl b', (b) => b.textContent));
    check(await page.$eval('#subnav .dl b', () => !/#wire\/\d/.test(location.hash)), 'and the address does not change', '');
    await page.waitForTimeout(300);   /* past the fade */
    await page.screenshot({ path: path.join(SHOTS, 'live-wire-matters-flipped.png') });

    await page.click(PREV);
    await showing(y2);
    const t2 = await top();
    check(JSON.stringify(t2.keys.slice(0, 5)) === JSON.stringify(files[y2 + '.json'].picks.slice(0, 5).map((x) => x.id)) && t2.prev && !t2.next, 'the oldest edition: its picks, ‹ disabled, › live', JSON.stringify(t2));
    await page.click(NEXT);
    await showing(y1);
    await page.click(NEXT);
    await showing(tk);
    const t3 = await top();
    check(t3.title === 'What matters today' && JSON.stringify(t3.keys) === JSON.stringify(t0.keys) && t3.next && !t3.prev, '› › returns to today’s picks, › disabled again', JSON.stringify(t3));
    check(JSON.stringify(await river()) === JSON.stringify(riverBefore), 'and the river is still the same', '');

    await page.click(PREV);
    await showing(y1);
    await page.click('.panel:not([hidden]) .wm-top .wm-today');
    await showing(tk);
    check((await top()).title === 'What matters today', 'the Today link returns', '');

    /* flipped, the Local switch keeps the day and shows its local picks only, in order */
    await page.click(PREV);
    await showing(y1);
    await page.click('#subnav .localsw-half:not(.on)');
    await page.waitForTimeout(150);
    const tl = await top();
    const yLocal = yday.picks.filter((x) => x.local).map((x) => x.id);
    check(tl.showing === y1 && JSON.stringify(tl.keys.slice(0, 5)) === JSON.stringify(yLocal.slice(0, 5)), 'on Local the flipped block shows that day’s local picks, in their order', JSON.stringify(tl.keys.slice(0, 5)));
    await page.reload();
    await page.waitForSelector('.panel:not([hidden]) .wm-top', { timeout: 15000 });
    check((await top()).showing === tk, 'a reload opens on today: the block remembers nothing', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();

    /* before the day's first ranking: the block stands, says so, and still flips back */
    {
      const v = await newPage(browser, base);
      const bare = { ...today, picks: [], picks_earlier: [] };
      await v.page.route(/wire-data\/data\/wire-today\.json$/, (r) => r.fulfill({ status: 200, body: JSON.stringify(bare), contentType: 'application/json' }));
      await v.page.goto(base + '/all-day/');
      await v.page.waitForSelector('.panel:not([hidden]) .wm-top', { timeout: 15000 });
      await v.page.waitForFunction(() => { const b = document.querySelector('.panel:not([hidden]) .wm-top [aria-label="Earlier day\'s picks"]'); return b && !b.disabled; }, null, { timeout: 6000 }).catch(() => {});
      check(/No local picks yet today\./.test(await v.page.$eval('.panel:not([hidden]) .wm-top', (w) => w.innerText)), 'no picks yet: the block says so', '');
      await v.page.click(PREV);
      await v.page.waitForFunction((d) => document.querySelector('.panel:not([hidden]) .wm-top')?.dataset.showing === d, y1, { timeout: 6000 }).catch(() => {});
      check(await v.page.$eval('.panel:not([hidden]) .wm-top h2', (h) => h.textContent) === 'What mattered ' + yWeek, 'and ‹ still reaches yesterday’s picks', '');
      check(!v.errors.length, 'no console errors with no picks yet', v.errors.join(' | '));
      await v.ctx.close();
    }

    /* both themes, 390 and 1280: the head fits, nothing scrolls sideways; reduced motion: no fade */
    for (const [w, h] of [[390, 844], [1280, 800]]) {
      for (const scheme of ['light', 'dark']) {
        const v = await newPage(browser, base, { viewport: { width: w, height: h }, scheme, motion: 'reduce' });
        await v.page.goto(base + '/all-day/');
        await v.page.waitForSelector('.panel:not([hidden]) .wm-top', { timeout: 15000 });
        await v.page.click(PREV);
        await v.page.waitForFunction((d) => document.querySelector('.panel:not([hidden]) .wm-top')?.dataset.showing === d, y1, { timeout: 6000 }).catch(() => {});
        const m = await v.page.$eval('.panel:not([hidden]) .wm-top', (wm) => {
          const sec = wm.querySelector('.sec').getBoundingClientRect();
          const nav = [...wm.querySelectorAll('.wm-nav .nav')].map((b) => b.getBoundingClientRect());
          const today = wm.querySelector('.wm-today').getBoundingClientRect();
          return { fits: nav.every((r) => r.right <= sec.right + 1 && r.left >= sec.left - 1), today: today.width > 0, anim: getComputedStyle(wm).animationName,
            wide: document.documentElement.scrollWidth <= innerWidth, h2: wm.querySelector('h2').getBoundingClientRect().height };
        });
        check(m.fits && m.today && m.wide, w + ' ' + scheme + ': the flipped head fits, with its Today link', JSON.stringify(m));
        check(m.anim === 'none', w + ' ' + scheme + ': reduced motion, no fade', m.anim);
        if (w === 390) await v.page.screenshot({ path: path.join(SHOTS, 'live-wire-matters-' + scheme + '.png') });
        check(!v.errors.length, w + ' ' + scheme + ': no console errors', v.errors.join(' | '));
        await v.ctx.close();
      }
    }
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
    await page.click('#subnav .w-raw');
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

  /* Stephen, 2026-10-17: each source its own colour, local green again, a
     faint tint on every other row, bigger thumbnails (on the right, the
     better read on the real paper) */
  await group('the Wire, source colours, the local tint, alternate rows and thumbnails (live)', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { wire: { inbox: true, brief: false } });
    await page.goto(base + '/all-day/');
    await page.waitForSelector('.panel:not([hidden]) .wm', { timeout: 15000 });
    const dots = await page.$$eval('#subnav .chip', (cs) => cs.map((c) => [c.dataset.chip, c.querySelector('.sdot') ? getComputedStyle(c.querySelector('.sdot')).backgroundColor : '']));
    const by = Object.fromEntries(dots);
    check(['x', 'facebook', 'reddit', 'instagram', 'newsletters'].every((k) => by[k]) && !by.all, 'every source chip carries a coloured dot; All does not', JSON.stringify(dots));
    check(new Set(['x', 'facebook', 'reddit', 'instagram', 'newsletters'].map((k) => by[k])).size === 5, 'and the five colours differ', JSON.stringify(by));
    await drawToday(page);
    const look = await page.evaluate(() => {
      const feed = document.querySelector('#panel-wire .feed.wire');
      const accent = (sel) => { const n = feed.querySelector(sel); return n ? getComputedStyle(n).boxShadow : ''; };
      const dot = (k) => getComputedStyle(document.querySelector('#subnav .chip[data-chip="' + k + '"] .sdot')).backgroundColor;
      const rows = [...feed.querySelectorAll(':scope > .card.row')];
      /* consecutive plain rows inside one update alternate */
      let alt = true, pairs = 0;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].previousElementSibling !== rows[i - 1]) continue;
        pairs++;
        if (rows[i].classList.contains('w-alt') === rows[i - 1].classList.contains('w-alt')) alt = false;
      }
      const thumb = feed.querySelector('.card.row.has-thumb');
      const t = thumb.querySelector('.c-thumb').getBoundingClientRect(), ti = thumb.querySelector('.c-title').getBoundingClientRect();
      return { x: accent('.card.w-src-x'), xDot: dot('x'), fb: accent('.card.w-src-facebook'), fbDot: dot('facebook'), reddit: accent('.card.w-src-reddit'), plain: accent('.card.row:not([class*="w-src-"])'),
        alt, pairs, altBg: rows.find((r) => r.classList.contains('w-alt') && !r.classList.contains('w-local')) ? getComputedStyle(rows.find((r) => r.classList.contains('w-alt') && !r.classList.contains('w-local'))).backgroundColor : '',
        thumb: { w: Math.round(t.width), h: Math.round(t.height), right: t.left > ti.left }, localName: getComputedStyle(feed.querySelector('.card.row .c-src.is-local')).color,
        anyTint: !!feed.querySelector('.card.w-local') };
    });
    check(look.x.includes('inset') && look.x.includes(look.xDot) && look.fb.includes(look.fbDot) && look.reddit.includes('inset') && look.plain === 'none',
      'a card from X, Facebook or Reddit carries its chip’s colour as a left accent; a plain headline does not', JSON.stringify(look));
    check(look.alt && look.pairs > 10 && look.altBg && look.altBg !== 'rgba(0, 0, 0, 0)', 'every other row has a faint tint (' + look.pairs + ' pairs)', JSON.stringify([look.alt, look.pairs, look.altBg]));
    check(look.thumb.w === 72 && look.thumb.h === 72 && look.thumb.right, 'thumbnails are 72px, on the right of the title', JSON.stringify(look.thumb));
    check(look.localName === 'rgb(22, 112, 78)' && !look.anyTint, 'on Local a local source is green, and no row is tinted green', JSON.stringify(look));
    await toTop(page);
    await page.click('#subnav .localsw-half:not(.on)');
    await page.waitForTimeout(200);
    await drawToday(page);
    const ev = await page.evaluate(() => {
      const feed = document.querySelector('#panel-wire .feed.wire');
      const loc = feed.querySelector('.card.row.w-local:not(.w-alt)'), nat = [...feed.querySelectorAll('.card.row:not(.w-local):not(.w-alt)')].find((r) => !r.querySelector('.c-src.is-local'));
      return { loc: loc && getComputedStyle(loc).backgroundColor, nat: nat && getComputedStyle(nat).backgroundColor, natGreen: !!(nat && nat.querySelector('.is-local')) };
    });
    check(ev.loc && ev.nat && ev.loc !== ev.nat && /rgba\(22, 112, 78|srgb 0\.086\d* 0\.439\d* 0\.305\d*/.test(ev.loc), 'on Everything a local story is tinted green, a national one is not', JSON.stringify(ev));
    await page.screenshot({ path: path.join(SHOTS, 'live-wire-colours.png') });
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('the Wire, a headline is read when it is opened, never when it is scrolled past (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#wire');
    await page.waitForSelector('#panel-wire .card.row', { timeout: 15000 });
    for (let i = 0; i < 12; i++) { await page.evaluate(() => { const p = document.querySelector('#panel-wire'); p.scrollTop += 700; }); await page.waitForTimeout(80); }
    await page.evaluate(() => { document.querySelector('#panel-wire').scrollTop = 0; });
    await page.waitForTimeout(200);
    check(!(await page.$('#panel-wire .is-read')), 'scrolling the whole paper marks nothing read', await page.$$eval('#panel-wire .is-read', (n) => n.map((x) => x.dataset.k).join(',')));
    const k = await page.$eval('#panel-wire .feed.wire > .card.row', (c) => c.dataset.k);
    const w0 = await page.$eval('#panel-wire .feed.wire > .card.row .c-title', (t) => getComputedStyle(t).fontWeight);
    await page.click('#panel-wire .feed.wire > .card.row .c-title');
    await page.waitForTimeout(150);
    const after = await page.evaluate((key) => ({ read: [...document.querySelectorAll('#panel-wire .is-read')].map((n) => n.dataset.k),
      w: getComputedStyle(document.querySelector('#panel-wire [data-k="' + key + '"] .c-title')).fontWeight }), k);
    check(after.read.length >= 1 && after.read.every((x) => x === k) && after.w !== w0, 'opening it greys that headline, and only it', JSON.stringify([after, w0]));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('the Wire, You left off here (live)', async () => {
    const files = wireFiles();
    const today = files['wire-today.json'];
    const order = today.updates.flatMap((u) => u.items).map((it) => it.id);
    const at = Math.floor(Date.now() / 1000) - 3600;
    /* the bookmark: the story at the top when the reader last left */
    const mark = order[30];
    const v = await newPage(browser, base);
    await v.page.addInitScript(([m, d, a]) => {
      try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('allday-wire-left', JSON.stringify({ date: d, k: m, at: a })); sessionStorage.setItem('seeded', '1'); } } catch (e) { /* about:blank */ }
    }, [mark, today.date, at]);
    await v.page.goto(base + '/all-day/');
    await v.page.waitForSelector('.panel:not([hidden]) .wm', { timeout: 15000 });
    await drawToday(v.page);
    const m = await v.page.evaluate(() => {
      const n = document.querySelector('#panel-wire .newline.w-left');
      if (!n) return null;
      let c = n.nextElementSibling;
      while (c && !c.dataset.k) c = c.nextElementSibling;
      return { text: n.textContent, next: c && c.dataset.k, n: document.querySelectorAll('#panel-wire .newline.w-left').length, since: [...document.querySelectorAll('#panel-wire .newline')].filter((x) => /new since/.test(x.textContent)).length };
    });
    const drawnRiver = await v.page.evaluate(() => [...document.querySelectorAll('#panel-wire .feed.wire > [data-k]')].map((n) => n.dataset.k));
    const firstAtOrBelow = drawnRiver.find((k) => order.indexOf(k) >= order.indexOf(mark));
    check(m && m.n === 1 && /^You left off here · \d{1,2}:\d{2} [ap]m$/.test(m.text), 'one “You left off here” bookmark, with the time the reader left', JSON.stringify(m));
    check(m && m.next === firstAtOrBelow && order.indexOf(m.next) >= order.indexOf(mark), 'it sits above the story that was on top then: everything above it came in since', JSON.stringify([m && m.next, firstAtOrBelow, mark]));
    check(m && !m.since, 'and the older “new since you were here” line gives way to it', '');
    await toTop(v.page);
    await v.page.click('#tab-watch');
    await v.page.waitForTimeout(200);
    const saved = await v.page.evaluate(() => JSON.parse(localStorage.getItem('allday-wire-left') || 'null'));
    check(saved && saved.k === order[0] && saved.date === today.date && Math.abs(saved.at - Date.now() / 1000) < 60, 'leaving the Wire moves the bookmark to the top story now', JSON.stringify(saved));
    await v.page.goto('about:blank');
    await v.page.goto(base + '/all-day/#wire');
    await v.page.waitForSelector('.panel:not([hidden]) .wm', { timeout: 15000 });
    await drawToday(v.page);
    check(!(await v.page.$('#panel-wire .newline.w-left')), 'nothing new since: no bookmark', '');
    check(!v.errors.length, 'no console errors', v.errors.join(' | '));
    await v.ctx.close();
  });

  await group('the Wire, What matters: Morning · Midday · Evening (live)', async () => {
    const files = wireFiles();
    const base0 = files['wire-today.json'];
    const iso = (h, m) => new Date(etAt(h) + (m || 0) * 60000).toISOString();
    const T = { morning: iso(6, 5), midday: iso(12, 5), evening: iso(18, 5) };
    const t6 = Date.parse(T.morning) / 1000;
    const today = JSON.parse(JSON.stringify(base0));
    today.picks.forEach((p) => { p.ranked_at = T.evening; });
    today.picks_earlier.forEach((p, i) => { p.ranked_at = i % 2 ? T.morning : T.midday; });
    const v = await newPage(browser, base);
    await v.page.route(/wire-data\/data\/wire-today\.json$/, (r) => r.fulfill({ status: 200, body: JSON.stringify(today), contentType: 'application/json' }));
    await v.page.goto(base + '/all-day/');
    await v.page.waitForSelector('.panel:not([hidden]) .wm-top .wm-slots', { timeout: 15000 });
    await v.page.click('#subnav .localsw-half:not(.on)');
    await v.page.waitForTimeout(150);
    const slots = () => v.page.$$eval('.panel:not([hidden]) .wm-top .wm-slot', (bs) => bs.map((b) => ({ k: b.dataset.slot, on: b.getAttribute('aria-pressed'), dis: b.disabled, t: b.innerText.replace(/\s+/g, ' ').trim() })));
    const s0 = await slots();
    check(JSON.stringify(s0.map((b) => b.k)) === '["morning","midday","evening"]' && s0[2].on === 'true' && s0.every((b) => !b.dis), 'three rankings, Morning · Midday · Evening, the current one chosen', JSON.stringify(s0));
    check(/^Morning 6:05 am$/.test(s0[0].t) && /^Midday 12:05 pm$/.test(s0[1].t) && /^Evening 6:05 pm$/.test(s0[2].t), 'each with the time it was ranked', JSON.stringify(s0.map((b) => b.t)));
    const cur = await v.page.$$eval('.panel:not([hidden]) .wm-top [data-k]', (n) => n.map((x) => x.dataset.k));
    check(JSON.stringify(cur.slice(0, 5)) === JSON.stringify(today.picks.slice(0, 5).map((x) => x.id)), 'the current ranking shows as before', '');
    await v.page.click('.panel:not([hidden]) .wm-top .wm-slot[data-slot="morning"]');
    await v.page.waitForTimeout(150);
    const mo = await v.page.$eval('.panel:not([hidden]) .wm-top', (w) => {
      const more = w.querySelector('.btn.more');
      if (more) more.click();
      return { stood: (w.querySelector('.wm-stood') || {}).textContent || '', pick: !!w.querySelector('.card.pick'),
        rows: [...w.querySelectorAll('.wm-row')].map((r) => [r.dataset.k, r.querySelector('.num').textContent]) };
    });
    const rows = await v.page.$$eval('.panel:not([hidden]) .wm-top .wm-row', (rs) => rs.map((r) => [r.dataset.k, r.querySelector('.num').textContent]));
    const dropped = today.picks_earlier.filter((p) => p.ranked_at === T.morning);
    const byId = Object.fromEntries(today.picks.map((p) => [p.id, p]));
    check(mo.stood === 'As it stood at 6:05 am' && !mo.pick, 'Morning: the list as it stood at 6:05 am', JSON.stringify(mo).slice(0, 200));
    check(dropped.every((p) => rows.some(([k, n]) => k === p.id && n === String(p.rank))), 'the stories that ranking held and later dropped, each at its rank then', JSON.stringify(rows.slice(0, 12)));
    check(rows.every(([k]) => dropped.some((p) => p.id === k) || (byId[k] && Date.parse(byId[k].posted_at) / 1000 <= t6)), 'and the rest are today’s picks that were already posted by then', JSON.stringify(rows.filter(([k]) => !dropped.some((p) => p.id === k)).slice(0, 5)));
    check((await slots())[0].on === 'true', 'Morning is chosen', '');
    await v.page.click('.panel:not([hidden]) .wm-top .wm-slot[data-slot="evening"]');
    await v.page.waitForTimeout(150);
    check(!!(await v.page.$('.panel:not([hidden]) .wm-top .card.pick')) && !(await v.page.$('.panel:not([hidden]) .wm-top .wm-stood')), 'Evening brings the current ranking back', '');
    /* flipping to another day starts on its current ranking */
    await v.page.click('.panel:not([hidden]) .wm-top .wm-slot[data-slot="midday"]');
    await v.page.click('.panel:not([hidden]) .wm-top [aria-label="Earlier day\'s picks"]');
    await v.page.waitForFunction(() => !!document.querySelector('.panel:not([hidden]) .wm-top .wm-today'), null, { timeout: 6000 }).catch(() => {});
    check(!(await v.page.$('.panel:not([hidden]) .wm-top .wm-stood')), 'an earlier day opens on its own last ranking', '');
    await v.page.screenshot({ path: path.join(SHOTS, 'live-wire-slots.png') });
    check(!v.errors.length, 'no console errors', v.errors.join(' | '));
    await v.ctx.close();
  });

  await group('the Wire, the Instagram chip reads the local accounts as a list (live)', async () => {
    const now = Date.now();
    const hex = (sec) => Math.floor(sec).toString(16);
    const ok = '&oe=' + hex(now / 1000 + 3 * 86400);
    const ig = { generated: new Date(now).toISOString(), posts: [
      { h: 'lakelight', ts: Math.round(now / 1000) - 1800, i: 'https://scontent.example.com/a.jpg?x=1' + ok, u: 'https://www.instagram.com/p/ListOne/', c: 'Fog on the lake <b>at dawn</b>\nsecond line', s: 'see' },
      { h: 'wakingwindows', ts: Math.round(now / 1000) - 900, i: 'https://scontent.example.com/b.jpg?x=1' + ok, u: 'https://www.instagram.com/p/ListTwo/', c: 'Friday: three bands', s: 'do' },
      { h: 'lakelight', ts: Math.round(now / 1000) - 3600, i: 'https://scontent.example.com/c.jpg?oe=' + hex(now / 1000 - 3600), u: 'https://www.instagram.com/p/ListLapsed/', c: 'Lapsed', s: 'see' },
    ] };
    const v = await newPage(browser, base);
    await v.page.route(/\/all-day\/data\/instagram\.json$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ig) }));
    await v.page.goto(base + '/all-day/');
    await v.page.waitForSelector('.panel:not([hidden]) .wm', { timeout: 15000 });
    await v.page.waitForFunction(() => (document.querySelector('#subnav .chip[data-chip="instagram"] .n') || {}).textContent === '2', null, { timeout: 6000 }).catch(() => {});
    check(await v.page.$eval('#subnav .chip[data-chip="instagram"] .n', (n) => n.textContent) === '2', 'the Instagram chip counts the posts whose picture still works (2)', '');
    await v.page.click('#subnav .chip[data-chip="instagram"]');
    await v.page.waitForSelector('#panel-wire .card.row.w-src-instagram', { timeout: 6000 }).catch(() => {});
    const list = await v.page.$$eval('#panel-wire .card.row', (cs) => cs.map((c) => ({ k: c.dataset.k, t: c.querySelector('.c-title').textContent, src: c.querySelector('.c-src').textContent, ig: c.classList.contains('w-src-instagram'), thumb: !!c.querySelector('.c-thumb') })));
    check(JSON.stringify(list.map((x) => x.k)) === '["ig:ListTwo","ig:ListOne"]' && list.every((x) => x.ig && x.thumb), 'newest first, each with its picture and the Instagram colour', JSON.stringify(list));
    check(list[1].t === 'Fog on the lake <b>at dawn</b>' && list[1].src === '@lakelight', 'the title is the caption’s first line, as text; the source is the account', JSON.stringify(list[1]));
    check(!/<b>at dawn/.test(await v.page.$eval('#panel-wire .feed', (f) => f.innerHTML)), 'captions are escaped', '');
    check(!(await v.page.$('#panel-wire .wm')) && v.page.url().endsWith('#wire/instagram'), 'no What matters here, and the address says #wire/instagram', v.page.url());
    await v.page.click('#panel-wire .caught .btn');
    /* two posts are too few for Photos' Instagram chip (four), so they are under All */
    const igSt = await pmOn(v.page) && await pmState(v.page);
    check(igSt && igSt.cat === 'all' && ['ig:ListOne', 'ig:ListTwo'].every((k) => igSt.list.some((x) => x.k === k)), 'its end opens the same posts as photos', JSON.stringify(igSt && igSt.cat));
    check(!v.errors.length, 'no console errors', v.errors.join(' | '));
    await v.ctx.close();
  });

  /* the topic row (Stephen, 2026-10-18: "add some tags ... like sports or
     like politics"): tag_wire.py's topics, grouped, under the source chips */
  await group('the Wire, the topic row (live)', async () => {
    const files = wireFiles({ topics: true });
    const today = files['wire-today.json'];
    const items = today.updates.flatMap((u) => u.items);
    const GROUP = { 'city-government': 't:politics', 'state-politics': 't:politics', 'public-safety': 't:safety', 'arts-culture': 't:arts', music: 't:arts', weather: 't:weather', business: 't:business' };
    const { ctx, page, errors } = await newPage(browser, base, { wire: { topics: true } });
    await page.goto(base + '/all-day/');
    await page.waitForSelector('.panel:not([hidden]) .wm', { timeout: 15000 });
    await page.waitForSelector('#subnav .w-topics', { timeout: 8000 }).catch(() => {});
    const row = await page.evaluate(() => {
      const sub = document.querySelector('#subnav');
      const t = sub.querySelector('.w-topics');
      if (!t) return null;
      const src = sub.querySelector('.w-chips:not(.w-topics)');
      const cs = t.querySelector('.chips');
      return { last: sub.lastElementChild === t, below: t.getBoundingClientRect().top >= src.getBoundingClientRect().bottom - 1,
        chips: [...t.querySelectorAll('.chip')].map((c) => [c.dataset.chip, c.querySelector('span').textContent, (c.querySelector('.n') || {}).textContent || '', c.classList.contains('on')]),
        oneRow: new Set([...t.querySelectorAll('.chip')].map((c) => Math.round(c.getBoundingClientRect().top))).size === 1, scrolls: getComputedStyle(cs).overflowX,
        pageW: document.documentElement.scrollWidth };
    });
    check(row && row.last && row.below, 'the topics sit on their own row under the source chips', JSON.stringify(row));
    const want = { 't:politics': 0, 't:safety': 0, 't:business': 0, 't:arts': 0, 't:weather': 0 };
    items.forEach((it) => { if (it.local && GROUP[it.topic]) want[GROUP[it.topic]]++; });
    const order = ['t:politics', 't:safety', 't:business', 't:arts', 't:weather'];
    check(row && JSON.stringify(row.chips.map((c) => c[0])) === JSON.stringify(['all'].concat(order)) && row.chips[0][1] === 'All topics' && row.chips[0][3],
      'All topics first and on, then only the topics this day has, in a fixed order', JSON.stringify(row && row.chips));
    check(row && row.chips.slice(1).every(([k, , n]) => Number(n) === want[k]), 'each topic counts what this reader sees (Local)', JSON.stringify([row && row.chips, want]));
    check(row && row.oneRow && row.scrolls === 'auto' && row.pageW <= 390, 'one row that scrolls sideways; the page does not', JSON.stringify(row));
    await page.click('#subnav .w-topics .chip[data-chip="t:politics"]');
    await page.waitForTimeout(200);
    const shown = await page.$$eval('#panel-wire .feed [data-k]', (n) => n.map((x) => x.dataset.k));
    const topicOf = Object.fromEntries(items.map((it) => [it.id, it.topic]));
    const todays = shown.filter((k) => k in topicOf);
    check(todays.length > 0 && todays.every((k) => GROUP[topicOf[k]] === 't:politics'), 'Politics narrows the river to city and state politics', JSON.stringify(todays.slice(0, 6).map((k) => topicOf[k])));
    check(!(await page.$('#panel-wire .wm')), 'with a topic on, the river stands alone: no What matters', '');
    check(!(await page.$$eval('#panel-wire .feed .eyebrow', (n) => n.some((e) => /The Brief/i.test(e.textContent)))), 'and no Brief pinned above it', '');
    check(await page.$eval('#subnav .w-chips:not(.w-topics) .chip.on', (c) => c.dataset.chip) === 'all', 'the source chips are untouched', '');
    /* the Instagram list has no topics: the row goes, and the topic with it */
    await chipTo(page, 'instagram');
    await page.waitForTimeout(150);
    check(!(await page.$('#subnav .w-topics')), 'on the Instagram chip there is no topic row', '');
    await chipTo(page, 'all');
    await page.waitForTimeout(150);
    check(await page.$eval('#subnav .w-topics .chip.on', (c) => c.dataset.chip) === 'all' && !!(await page.$('#panel-wire .wm')), 'and back on All, the topic is All topics again', '');
    /* a topic with nothing under a source chip is left out, and a picked
       one goes back to All topics */
    await page.click('#subnav .w-topics .chip[data-chip="t:politics"]');
    await page.waitForTimeout(150);
    const redditTopics = new Set(items.filter((it) => it.local && it.ch === 'reddit' && GROUP[it.topic]).map((it) => GROUP[it.topic]));
    await chipTo(page, 'reddit');
    await page.waitForTimeout(150);
    const rRow = await page.$$eval('#subnav .w-topics .chip', (cs) => cs.map((c) => c.dataset.chip + (c.classList.contains('on') ? '*' : '')));
    check(JSON.stringify(rRow.filter((k) => k !== 'all' && k !== 'all*').map((k) => k.replace('*', '')).sort()) === JSON.stringify([...redditTopics].sort())
      && rRow.includes(redditTopics.has('t:politics') ? 't:politics*' : 'all*'), 'under Reddit, only Reddit’s topics; Politics stays picked only if Reddit has some', JSON.stringify([rRow, [...redditTopics]]));
    await chipTo(page, 'all');
    await page.click('#subnav .w-topics .chip[data-chip="all"]').catch(() => {});
    await page.waitForTimeout(200);
    check(!!(await page.$('#panel-wire .wm')), 'All topics brings What matters back', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('the Wire, Square (demo)', async () => {
    const sqState = (page) => page.evaluate(() => import('/all-day/js/modes/wire-square.js').then((m) => m._state()));
    const { ctx, page, errors, supabase } = await newPage(browser, base, { motion: 'reduce' });
    await page.goto(base + '/all-day/?demo=1#wire');
    await settle(page);
    await page.click('#subnav .wmode[data-view="square"]');
    await page.waitForSelector('#panel-wire .sq-compose', { timeout: 8000 }).catch(() => {});
    check(page.url().endsWith('#wire/square') && await page.evaluate(() => localStorage.getItem('allday-wire-view')) === 'square', 'Square opens in the tab, in the address, and is kept', page.url());
    const head = await page.$eval('#panel-wire .sq-compose', (b) => ({ h2: b.querySelector('h2').textContent, kinds: [...b.querySelectorAll('[data-compose]')].map((x) => x.dataset.compose) }));
    check(head.h2 === 'The Square' && JSON.stringify(head.kinds) === '["post","show","ask","free","pets"]', 'it opens with the five ways to post', JSON.stringify(head));
    const st = await sqState(page);
    const cards = await page.$$eval('#panel-wire .sq-feed > .card', (cs) => cs.map((c) => ({ k: c.dataset.k, board: c.classList.contains('board'), out: c.classList.contains('sq-out'),
      chip: (c.querySelector('.sq-chip') || {}).textContent || '', img: !!c.querySelector('img, .ph'), link: (c.querySelector('a[data-open]') || {}).href || '', src: [...c.classList].find((x) => /^w-src-/.test(x)) || '' })));
    check(cards.filter((c) => c.board).length === 5 && cards.filter((c) => c.out).length >= 4, 'neighbors’ posts as full cards, Facebook and Reddit as compact ones', JSON.stringify(cards.map((c) => c.k)));
    check(cards.filter((c) => c.out).every((c) => c.chip && !c.img && /^https?:/.test(c.link) && /w-src-(facebook|reddit)/.test(c.src)), 'a compact card: its source chip in its colour, the link out, never a copied picture', JSON.stringify(cards.filter((c) => c.out).slice(0, 3)));
    check(cards[0].board, 'a neighbor’s post sorts ahead of outside talk of the same age', JSON.stringify(cards.slice(0, 3)));
    const chipKeys = await page.$$eval('#subnav .chip', (cs) => cs.map((c) => c.dataset.chip));
    check(JSON.stringify(chipKeys) === '["all","post","show","ask","free","pets","facebook","reddit"]', 'the kinds of post as chips', JSON.stringify(chipKeys));
    await page.click('#subnav .chip[data-chip="pets"]');
    await page.waitForTimeout(150);
    check(JSON.stringify((await sqState(page)).list.map((x) => x.type)) === '["pets"]', 'Pets narrows it to the pets', '');
    await page.click('#subnav .chip[data-chip="all"]');
    /* opened, an outside thread stays read through a redraw */
    const outK = await page.$eval('#panel-wire .sq-out', (c) => c.dataset.k);
    await page.click('#panel-wire .sq-out[data-k="' + outK + '"] a[data-open]');
    await page.waitForTimeout(150);
    await chipTo(page, 'pets');
    await chipTo(page, 'all');
    await page.waitForTimeout(150);
    check(await page.$eval('#panel-wire .sq-out[data-k="' + outK + '"]', (c) => c.classList.contains('is-read')) && await page.$$eval('#panel-wire .sq-out.is-read', (n) => n.length) === 1,
      'an outside thread you opened stays read through a redraw, and only it', outK);
    await toTop(page);
    await page.click('#panel-wire [data-compose="ask"]');
    await page.waitForSelector('.sheet-card[aria-label="Ask Burlington"]', { timeout: 4000 }).catch(() => {});
    check(/Sign in to post\./.test(await page.$eval('.sheet-body', (b) => b.innerText)), 'signed out, posting asks for the sign-in', '');
    await page.click('.sheet-head .iconbtn');
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.click('#panel-wire [data-compose="ask"]');
    await page.waitForSelector('.sheet-body form.bform', { timeout: 4000 }).catch(() => {});
    await page.fill('input[name=title]', 'Who fixes old radios?');
    const nameField = await page.$('input[name=display_name]');
    if (nameField) await nameField.fill('Robin');
    await page.click('.bform button[type=submit]');
    await page.waitForSelector('#panel-wire .card.board:has-text("Who fixes old radios?")', { timeout: 4000 }).catch(() => {});
    check(!!(await page.$('#panel-wire .card.board:has-text("Who fixes old radios?")')), 'an ask, posted, is in the Square', '');
    check(st.list.length === cards.length, 'the state agrees with the page', st.list.length + ' vs ' + cards.length);
    await page.reload();
    await settle(page);
    check(!!(await page.$('#panel-wire .sq-compose')), 'a reload opens on the Square again', '');
    check(!supabase.length, 'demo mode never calls Supabase', supabase.join(', '));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();

    /* live, before nn-ROUND4.sql: no Square, and a kept Square opens on News */
    const live = await newPage(browser, base);
    await live.page.addInitScript(() => localStorage.setItem('allday-wire-view', 'square'));
    await live.page.goto(base + '/all-day/');
    await live.page.waitForSelector('.panel:not([hidden]) .wm', { timeout: 15000 });
    await live.page.waitForTimeout(400);
    check(JSON.stringify(await live.page.$$eval('#subnav .wmode', (bs) => bs.map((b) => b.dataset.view))) === '["news","photos"]', 'live before the Square’s SQL: the switch says News and Photos only', '');
    check(!(await live.page.$('#panel-wire .sq-compose')), 'and a kept Square opens on News', '');
    check(!live.errors.length, 'no console errors', live.errors.join(' | '));
    await live.ctx.close();

    /* live, once it is pasted (rules version 3): the Square is there, and a
       long outside feed is drawn in chunks, each thread once */
    const now = Math.round(Date.now() / 1000);
    const files = wireFiles({ inbox: true, brief: false });
    const fbToday = files['wire-today.json'].updates.flatMap((u) => u.items).find((it) => it.ch === 'facebook');
    /* the Unfiltered wire also follows national subreddits; only the
       Burlington and Vermont ones are the Square's (Stephen, 2026-10-18) */
    const subs = [['r-vermont', 'vermont'], ['goodburlington', 'GoodBurlington'], ['r-news', 'news'], ['technology', 'technology'], ['jokes', 'Jokes'], ['world-news', 'worldnews']];
    const pulse = { v: 1, generated: new Date().toISOString(),
      sources: [{ id: 'r-burlington', name: 'r/burlington', short: 'r/burlington', topic: 'local', local: 1, site: 'https://www.reddit.com/r/burlington/' }]
        .concat(subs.map(([id, sub]) => ({ id, name: 'r/' + sub, short: 'r/' + sub, site: 'https://www.reddit.com/r/' + sub + '/', ...(/vermont|burlington/i.test(sub) ? { local: 1 } : {}) }))),
      items: Array.from({ length: 120 }, (_, i) => ({ t: 'Thread ' + i, u: 'https://www.reddit.com/r/burlington/comments/t' + i + '/', d: now - i * 600, s: 'r-burlington', ch: 'reddit', local: true }))
        .concat(subs.map(([id, sub], i) => ({ t: 'Elsewhere ' + sub, u: 'https://www.reddit.com/r/' + sub + '/comments/e' + i + '/', d: now - 30 - i, s: id, ch: 'reddit', local: /vermont|burlington/i.test(sub) }))),
      inbox: { facebook: { paused: false, items: [{ u: fbToday.url.replace('https://', 'https://www.') + '/', d: now - 100, from: 'ONE', name: 'ONE', summary: 'The same post again', ch: 'facebook', local: true }] } } };
    const on = await newPage(browser, base, { wire: { inbox: true, brief: false }, rpc: (fn) => (fn === 'nn_rules' ? { version: 3 } : fn === 'nn_posts_list' ? [] : undefined) });
    await on.page.route(/\/data\/pulse\.json$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pulse) }));
    await on.page.goto(base + '/all-day/#wire/square');
    await on.page.waitForSelector('#panel-wire .sq-compose', { timeout: 15000 }).catch(() => {});
    await on.page.waitForSelector('#panel-wire .sq-out', { timeout: 8000 }).catch(() => {});
    check(!!(await on.page.$('#subnav .wmode[data-view="square"]')) && !!(await on.page.$('#panel-wire .sq-compose')), 'live with the Square’s SQL: #wire/square opens it', '');
    const ost = await on.page.evaluate(() => import('/all-day/js/modes/wire-square.js').then((m) => m._state()));
    const first = await on.page.$$eval('#panel-wire .sq-out', (n) => n.length);
    check(ost.list.length > 100 && first <= 40, 'a long feed draws its first screenful only (' + first + ' of ' + ost.list.length + ')', '');
    check(ost.list.filter((x) => x.type === 'facebook').length === files['wire-today.json'].updates.flatMap((u) => u.items).filter((it) => it.ch === 'facebook').length,
      'a Facebook post in both today’s paper and the Unfiltered inbox shows once', JSON.stringify(ost.counts));
    const sqKeys = new Set(ost.list.map((x) => x.k));
    check(sqKeys.has('https://www.reddit.com/r/vermont/comments/e0/') && sqKeys.has('https://www.reddit.com/r/GoodBurlington/comments/e1/') && ['news', 'technology', 'Jokes', 'worldnews'].every((sub) => ![...sqKeys].some((k) => k.includes('/r/' + sub + '/'))),
      'Reddit in the Square: r/burlington, r/vermont and r/GoodBurlington, never r/news, r/technology, r/Jokes or r/worldnews', JSON.stringify([...sqKeys].filter((k) => /reddit/.test(k) && !/r\/burlington/.test(k))));
    const todayReddit = files['wire-today.json'].updates.flatMap((u) => u.items).filter((it) => it.ch === 'reddit');
    check(todayReddit.some((it) => /\/r\/news\//.test(it.url)) && todayReddit.every((it) => sqKeys.has(it.id) === /\/r\/burlington\//.test(it.url)),
      'today’s paper’s threads too: the r/burlington ones in, the r/news ones out', JSON.stringify(todayReddit.map((it) => [it.id, it.url.split('/')[4], sqKeys.has(it.id)])));
    check(!on.errors.length, 'no console errors', on.errors.join(' | '));
    await on.ctx.close();
  });
}

/* ------------------------------------------------------------ Photo mode */
/* The Wire's Photo mode (modes/wire-photos.js): the list ⟷ photos switch,
   kept on the phone; one feed of every picture, newest first, the photo of
   the week first; the picture sheet; Add a photo; the old #art and #photos. */
const pmPanel = '#panel-wire';
const pmState = (page) => page.evaluate(() => import('/all-day/js/modes/wire-photos.js').then((m) => m._state()));
const pmCards = (page) => page.$$eval(pmPanel + ' .card.pm', (cs) => cs.map((c) => ({ k: c.dataset.k, cap: c.querySelector('.pm-cap').textContent,
  pic: !!c.querySelector('.pm-pic img.pic, .pm-pic .ph'), eyebrow: (c.querySelector('.eyebrow') || {}).textContent || '' })));
const pmOn = (page) => page.waitForSelector(pmPanel + ' .card.pm', { timeout: 15000 }).then(() => true, () => false);
const viewPressed = (page) => page.$$eval('#subnav .wmode', (bs) => bs.map((b) => b.dataset.view + ':' + b.getAttribute('aria-pressed')).join(' '));
/* draw the whole feed: scroll to the bottom until the end card is in */
async function pmAll(page) {
  for (let i = 0; i < 60 && !(await page.$(pmPanel + ' .caught')); i++) {
    await page.evaluate(() => { const p = document.querySelector('#panel-wire'); p.scrollTop = p.scrollHeight; });
    await page.waitForTimeout(80);
  }
}
const PM_POST = (o) => ({ id: o.id, board: 'art', kind: o.kind || 'photo', title: o.title, body: o.body || '', place: '', meta: o.meta || { shirt: 'no' },
  photo: o.photo === undefined ? 'submissions/' + o.id.slice(-12) + '.jpg' : o.photo, author: o.author || 'Kara', author_arch: null,
  created_at: o.at, expires_at: null, votes: o.votes || 0, voted: false, mine: false });

async function thePhotos(browser, base) {
  await group('Photo mode: the News · Photos · Square switch, in words, kept on the phone (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#wire');
    await settle(page);
    const sw = await page.$$eval('#subnav > .wmodes .wmode', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { v: b.dataset.view, t: b.textContent, w: Math.round(r.width), h: Math.round(r.height), p: b.getAttribute('aria-pressed') }; }));
    check(JSON.stringify(sw.map((b) => b.t)) === '["News","Photos","Square"]' && sw.every((b) => b.w >= 88 && b.h >= 32), 'the switch says News, Photos, Square in words, a third of the row each', JSON.stringify(sw));
    check(sw[0].p === 'true' && sw[1].p === 'false' && sw[2].p === 'false', 'it opens on News, said by aria-pressed', JSON.stringify(sw));
    check(await page.$eval('#subnav > :first-child', (n) => n.classList.contains('wmodes')), 'and it is the first row under the mast', '');
    check(!(await page.$('#subnav .viewsw, #subnav .viewsw-b')), 'the old list and photo icons are gone', '');
    await page.click('#subnav .wmode[data-view="photos"]');
    check(await pmOn(page), 'Photos turns the paper into the photo feed', '');
    check(await viewPressed(page) === 'news:false photos:true square:false', 'and the switch says so', await viewPressed(page));
    check(await page.evaluate(() => location.hash) === '#wire/photos', 'the address says #wire/photos', await page.evaluate(() => location.hash));
    check(await page.evaluate(() => localStorage.getItem('allday-wire-view')) === 'photos', 'the choice is kept on the phone', '');
    check(await page.$eval('#subnav', (s) => s.querySelectorAll(':scope > .dateline, :scope > .toolband, :scope > .chips').length) === 2, 'Photo mode: the switch, then the Local band and the kinds of picture', '');
    check(!(await page.$(pmPanel + ' .wm, ' + pmPanel + ' .card.row')), 'the paper’s list is gone', '');
    await page.reload();
    await settle(page);
    check(await pmOn(page) && await viewPressed(page) === 'news:false photos:true square:false', 'a reload opens on the photos again', await viewPressed(page));
    await page.goto(base + '/all-day/?demo=1');
    await settle(page);
    check(await pmOn(page), 'and so does a bare visit to the app', '');
    await page.click('#subnav .wmode[data-view="news"]');
    await page.waitForSelector(pmPanel + ' .wm', { timeout: 8000 }).catch(() => {});
    check(!(await page.$(pmPanel + ' .card.pm')) && !!(await page.$(pmPanel + ' .wm')), 'News brings the paper back', '');
    check(await page.evaluate(() => location.hash) === '#wire' && await page.evaluate(() => localStorage.getItem('allday-wire-view')) === null, 'the address is #wire again, and the phone forgets Photos', await page.evaluate(() => location.hash));
    check(await page.evaluate(() => document.activeElement && document.activeElement.dataset.view) === 'news', 'focus stays on the switch', '');
    await page.reload();
    await settle(page);
    check(!(await page.$(pmPanel + ' .card.pm')) && await viewPressed(page) === 'news:true photos:false square:false', 'a reload opens on News', await viewPressed(page));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Photo mode: the feed, its sources, never the news, and the photo of the week (demo)', async () => {
    const { ctx, page, errors, supabase } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#wire/photos');
    await settle(page);
    await pmOn(page);
    await pmAll(page);
    const cs = await pmCards(page);
    const st = await pmState(page);
    check(cs.length > 20 && cs.length === st.list.length, 'every picture is drawn, down to the end', cs.length + ' of ' + st.list.length);
    check(cs.every((c) => c.pic), 'every card carries a picture', JSON.stringify(cs.filter((c) => !c.pic).map((c) => c.k)));
    const keys = await page.$$eval(pmPanel + ' [data-k]', (n) => n.map((x) => x.dataset.k));
    check(new Set(keys).size === keys.length, 'no key twice on the page', keys.length + ' keys');
    check(cs[0].k === 'b-0000a000-0000-4000-8000-000000000001' && /Photo of the week/i.test(cs[0].eyebrow) && st.lead === cs[0].k,
      'the photo of the week leads: of two at 23 votes this week, the one posted first', JSON.stringify(cs[0]));
    check(cs.slice(1).every((c) => !c.eyebrow), 'and only it says so', '');
    const ds = st.list.slice(1).map((v) => v.d);
    check(ds.every((d, i) => !i || ds[i - 1] >= d), 'the rest run newest first', JSON.stringify(ds.slice(0, 8)));
    const from = st.list.reduce((o, v) => { o[v.from] = (o[v.from] || 0) + 1; return o; }, {});
    check(from.board === 16 && from.gallery === 3 && from.instagram === 10 && from.square === 2 && Object.keys(from).length === 4,
      'from neighbors’ posts (16), the gallery (3), Instagram (10) and the Square’s photos (2), nothing else', JSON.stringify(from));
    check(keys.every((k) => /^(b-|g-|ig:)/.test(k)), 'Photos is not news: no story, Facebook or Reddit picture', JSON.stringify(keys.filter((k) => !/^(b-|g-|ig:)/.test(k))));
    const ig = cs.find((c) => c.k === 'ig:DemoBeach2');
    check(ig && ig.cap === 'First frost on the dunes at North Beach', 'an Instagram post’s caption is its first line', JSON.stringify(ig));
    check(cs.find((c) => c.k === 'ig:DemoChurch5').cap === '@demo_churchst', 'no caption: the account', '');
    check((await page.$eval(pmPanel + ' .caught', (c) => c.innerText)).includes('Post a photo'), 'the feed ends, with Post a photo', '');
    /* no Local / Everything: every picture here is Burlington's */
    check(!(await page.$('#subnav .localsw')), 'no Local / Everything switch on Photos', '');
    check((await page.$eval('#subnav .pm-n .s', (s) => s.textContent)) === cs.length + ' photos', 'the band counts what is shown', await page.$eval('#subnav .pm-n .s', (s) => s.textContent));
    check(!errors.length, 'no console errors', errors.join(' | '));
    check(!supabase.length, 'demo mode never calls Supabase', supabase.join(', '));
    await ctx.close();
  });

  await group('Photo mode: the kinds of picture, and Pets of Burlington (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#wire/photos');
    await settle(page);
    await pmOn(page);
    const chipsNow = await page.$$eval('#subnav .chip', (cs) => cs.map((c) => [c.dataset.chip, (c.querySelector('.n') || {}).textContent || '', c.querySelector('span').textContent]));
    const st0 = await pmState(page);
    /* a kind with fewer than four pictures gets no chip: in the demo, the
       vibe checks, posters, food and pets are each too few */
    const kinds = ['instagram', 'vibe', 'posters', 'food', 'pets', 'posted'];
    check(JSON.stringify(chipsNow.map((c) => c[0])) === JSON.stringify(['all'].concat(kinds.filter((k) => (st0.counts[k] || 0) >= 4))) && kinds.some((k) => st0.counts[k] > 0 && st0.counts[k] < 4),
      'the chips in order, a kind with fewer than four pictures left out', JSON.stringify([chipsNow, st0.counts]));
    check(chipsNow.slice(1).every(([k, n]) => Number(n) === st0.counts[k]), 'each counts what this reader sees', JSON.stringify([chipsNow, st0.counts]));
    const of = (k) => st0.list.find((v) => v.k === k);
    check(JSON.stringify(of('ig:DemoShow8').cats.sort()) === '["instagram","posters"]', 'an organiser’s post (the DO half) is an event poster', JSON.stringify(of('ig:DemoShow8')));
    check(JSON.stringify(of('ig:DemoBar7').cats.sort()) === '["food","instagram","posters","vibe"]', 'a bar that organises: vibe check, food and poster', JSON.stringify(of('ig:DemoBar7')));
    check(JSON.stringify(of('ig:DemoCat9').cats.sort()) === '["instagram","pets","vibe"]' && JSON.stringify(of('ig:DemoLake1').cats) === '["instagram"]', 'the cat lounge is pets and a vibe check; a lake photographer is just Instagram', '');
    check(of('g-demo-g3').cats.includes('food') && JSON.stringify(of('g-demo-g1').cats) === '["posted"]', 'a gallery photo takes its queue category (food), else it is only posted here', JSON.stringify([of('g-demo-g3'), of('g-demo-g1')]));
    for (const [k] of chipsNow.slice(1)) {
      await page.evaluate(() => { document.querySelector('#panel-wire').scrollTop = 0; });
      await page.click('#subnav .chip[data-chip="' + k + '"]');
      await page.waitForTimeout(120);
      const st = await pmState(page);
      const good = st.list.length === st0.counts[k] && st.list.every((v) => v.cats.includes(k)) && (k !== 'instagram' || st.list.every((v) => v.from === 'instagram'))
        && (k !== 'posted' || st.list.every((v) => ['board', 'gallery', 'square'].includes(v.from)));
      check(good && st.cat === k, 'the ' + k + ' chip shows only its ' + st0.counts[k], JSON.stringify(st.list.map((v) => [v.k, v.from])).slice(0, 200));
      check(!(await page.$(pmPanel + ' .pm-pets')), k + ': no pets row outside All', '');
    }
    await page.click('#subnav .chip[data-chip="all"]');
    await page.waitForTimeout(120);
    const pets = await page.$eval(pmPanel + ' .pm-pets', (b) => ({ h: b.querySelector('h3').textContent, tiles: [...b.querySelectorAll('[data-pet]')].map((t) => t.dataset.pet),
      before: !!(b.compareDocumentPosition(document.querySelector('#panel-wire .pm-feed')) & 4), after: !!(document.querySelector('#panel-wire .pm-head').compareDocumentPosition(b) & 4) }));
    check(pets.h === 'Pets of Burlington' && pets.tiles.length === st0.counts.pets && pets.before && pets.after, 'All opens with Pets of Burlington, between the header and the feed', JSON.stringify(pets));
    check(st0.counts.pets < 4 && !(await page.$(pmPanel + ' .pm-pets [data-pets]')), 'too few pets for a chip: no “See all”', '');
    await page.click(pmPanel + ' .pm-pets [data-pet="' + pets.tiles[0] + '"]');
    await page.waitForSelector('.sheet-card', { timeout: 4000 }).catch(() => {});
    check(!!(await page.$('.sheet-card')), 'a pet opens in its sheet', '');
    await page.click('.sheet-head .iconbtn');
    await page.screenshot({ path: path.join(SHOTS, 'demo-wire-photos-pets.png') });
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Photo mode: an Instagram account’s kind comes from the roster (live)', async () => {
    const now = Date.now();
    const ok = '&oe=' + Math.floor(now / 1000 + 3 * 86400).toString(16);
    const post = (h, n, extra) => ({ h, ts: Math.round(now / 1000) - n * 60, i: 'https://scontent.example.com/' + n + '.jpg?x=1' + ok, u: 'https://www.instagram.com/p/Roster' + n + '/', c: h, ...extra });
    const ig = { generated: new Date(now).toISOString(), posts: [post('queencitycatlounge', 1, { s: 'see' }), post('foambrewers', 2, { s: 'do', f: 1 }), post('theresnoaincreemee', 3, { s: 'see', f: 1 }),
      post('atasteofabyssinia', 4, { s: 'see' }), post('jackthurstonvt', 5, { s: 'see' }),
      post('passion4pawsvt', 6, { s: 'do', category: 'pets' }), post('new_kitchen', 7, { s: 'do', category: 'food' }),
      post('new_venue', 8, { s: 'do', category: 'venue' }), post('new_event', 9, { s: 'do', category: 'events' })] };
    const v = await newPage(browser, base);
    await v.page.route(/\/all-day\/data\/instagram\.json$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ig) }));
    await v.page.goto(base + '/all-day/#wire/photos');
    await settle(v.page);
    await pmOn(v.page);
    const st = await pmState(v.page);
    const cats = Object.fromEntries(st.list.filter((x) => x.from === 'instagram').map((x) => [x.url.split('/').slice(-2)[0], x.cats.sort().join(' ')]));
    check(cats.Roster1 === 'food instagram pets vibe', 'a cat café is pets and a vibe check (photo_categories), and food (the directory)', JSON.stringify(cats));
    check(cats.Roster2 === 'food instagram posters vibe', 'a brewery that organises: food, poster and vibe check', JSON.stringify(cats));
    check(cats.Roster3 === 'instagram', 'an account the food directory says is not food is not food', JSON.stringify(cats));
    check(cats.Roster4 === 'food instagram', 'a restaurant in the food directory is food', JSON.stringify(cats));
    check(cats.Roster5 === 'instagram', 'a photographer is just Instagram', JSON.stringify(cats));
    check(cats.Roster6 === 'instagram pets', 'the new roster adds pets without mislabeling them event posters', JSON.stringify(cats));
    check(cats.Roster7 === 'food instagram', 'new food categories work without the legacy food flag', JSON.stringify(cats));
    check(cats.Roster8 === 'instagram vibe', 'venue posts enter Vibe checks', JSON.stringify(cats));
    check(cats.Roster9 === 'instagram posters', 'event accounts enter Event posters', JSON.stringify(cats));
    check(!v.errors.length, 'no console errors', v.errors.join(' | '));
    await v.ctx.close();
  });

  /* builder 2's contract (2026-10-18): each Instagram post carries its own
     `kind`, and the chips read it ahead of the account's category */
  await group('Photo mode: each Instagram post’s own kind picks its chip (live)', async () => {
    const now = Date.now();
    const ok = '&oe=' + Math.floor(now / 1000 + 3 * 86400).toString(16);
    let n = 0;
    const post = (h, kind) => { n++; return { h, ts: Math.round(now / 1000) - n * 60, i: 'https://scontent.example.com/k' + n + '.jpg?x=1' + ok, u: 'https://www.instagram.com/p/Kind' + n + '/', c: h + ' ' + kind, s: 'see', kind }; };
    const posts = [post('queencitycatlounge', 'food')];   // a cat café's latte: food, not pets
    ['vibe', 'vibe', 'vibe', 'vibe', 'poster', 'poster', 'poster', 'food', 'food', 'food', 'pets', 'pets', 'pets', 'pets', 'scenic', 'other']
      .forEach((kind, i) => posts.push(post('acct' + i, kind)));
    const ig = { generated: new Date(now).toISOString(), posts };
    const v = await newPage(browser, base);
    await v.page.route(/\/all-day\/data\/instagram\.json$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ig) }));
    await v.page.goto(base + '/all-day/#wire/photos');
    await settle(v.page);
    await pmOn(v.page);
    const st0 = await pmState(v.page);
    const catOf = Object.fromEntries(st0.list.map((x) => [x.url.split('/').slice(-2)[0], x.cats.sort().join(' ')]));
    check(catOf.Kind1 === 'food instagram', 'the post’s kind wins over its account’s (a cat café’s food post is food, not pets or a vibe check)', JSON.stringify(catOf));
    check(catOf.Kind16 === 'instagram' && catOf.Kind17 === 'instagram', 'scenic and other are just Instagram', JSON.stringify(catOf));
    check(st0.counts.vibe === 4 && st0.counts.posters === 3 && st0.counts.food === 4 && st0.counts.pets === 4, 'each kind counted', JSON.stringify(st0.counts));
    const chipKeys = await v.page.$$eval('#subnav .chip', (cs) => cs.map((c) => c.dataset.chip));
    check(JSON.stringify(chipKeys) === '["all","instagram","vibe","food","pets"]', 'three posters is too few for a chip; nobody posted here, so no Posted here', JSON.stringify(chipKeys));
    for (const k of chipKeys.slice(1)) {
      await v.page.evaluate(() => { document.querySelector('#panel-wire').scrollTop = 0; });
      await v.page.click('#subnav .chip[data-chip="' + k + '"]');
      await v.page.waitForTimeout(120);
      const st = await pmState(v.page);
      check(st.cat === k && st.list.length === st0.counts[k] && st.list.every((x) => x.cats.includes(k)), 'the ' + k + ' chip shows only its ' + st0.counts[k], JSON.stringify(st.list.map((x) => x.k)));
    }
    await v.page.click('#subnav .chip[data-chip="all"]');
    await v.page.waitForTimeout(120);
    await v.page.click(pmPanel + ' .pm-pets [data-pets]');
    await v.page.waitForTimeout(150);
    check((await pmState(v.page)).cat === 'pets' && await v.page.$eval('#subnav .chip.on', (c) => c.dataset.chip) === 'pets', 'enough pets for a chip: “See all” is the Pets chip', '');
    check(!v.errors.length, 'no console errors', v.errors.join(' | '));
    await v.ctx.close();
  });

  await group('Photo mode: a picture opens in its sheet, and a vote counts (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#wire/photos');
    await settle(page);
    await pmOn(page);
    const key = 'b-0000a000-0000-4000-8000-000000000002';
    await pmAll(page);
    await page.evaluate((k) => document.querySelector('#panel-wire [data-k="' + k + '"]').scrollIntoView(), key);
    check(await page.$eval(pmPanel + ' [data-k="' + key + '"] [data-act="photovote"] .vn', (n) => n.textContent) === '23', 'a neighbor’s picture shows its board votes', '');
    await page.click(pmPanel + ' [data-k="' + key + '"] .pm-pic');
    await page.waitForSelector('.sheet-card[aria-label="Aurora from the causeway"]', { timeout: 4000 }).catch(() => {});
    const sh = await page.$eval('.sheet-body', (b) => ({ media: !!b.querySelector('.c-media .ph'), text: b.innerText, acts: [...b.querySelectorAll('[data-act]')].map((x) => x.dataset.act), shirt: !!b.querySelector('[data-shirt]') }));
    check(sh.media && /by Ben S\. · Photo/.test(sh.text) && /Eleven at night/.test(sh.text), 'the sheet: the big picture, its maker and their line', sh.text);
    check(JSON.stringify(sh.acts) === '["photovote","share","breport"]' && sh.shirt, 'vote, share, report, and the shirt the maker said yes to', JSON.stringify(sh));
    await page.click('.sheet-body [data-act="photovote"]');
    await page.waitForTimeout(200);
    const after = await page.evaluate((k) => ({ sheet: document.querySelector('.sheet-body [data-act="photovote"] .vn').textContent, pressed: document.querySelector('.sheet-body [data-act="photovote"]').getAttribute('aria-pressed'),
      card: document.querySelector('#panel-wire [data-k="' + k + '"] [data-act="photovote"] .vn').textContent, on: document.querySelector('#panel-wire [data-k="' + k + '"] [data-act="photovote"]').classList.contains('on') }), key);
    check(after.sheet === '24' && after.pressed === 'true' && after.card === '24' && after.on, 'one vote: 24 on the sheet and on the card', JSON.stringify(after));
    check(await fakeOf(page, `(f) => f._count('${key.slice(2)}')`) === 24, 'and the board counted it', '');
    await page.click('.sheet-head .iconbtn');
    await page.click(pmPanel + ' [data-k="' + key + '"] [data-act="photovote"]');
    await page.waitForTimeout(200);
    check(await page.$eval(pmPanel + ' [data-k="' + key + '"] [data-act="photovote"]', (b) => b.getAttribute('aria-pressed') + ' ' + b.querySelector('.vn').textContent) === 'false 23', 'the card’s own arrow takes it back', '');
    /* an Instagram post: its sheet has the way to the original */
    await page.evaluate(() => document.querySelector('#panel-wire [data-k="ig:DemoLake1"]').scrollIntoView());
    await page.click(pmPanel + ' [data-k="ig:DemoLake1"] .pm-cap');
    await page.waitForSelector('.sheet-card', { timeout: 4000 }).catch(() => {});
    const ig = await page.$eval('.sheet-body', (b) => ({ text: b.innerText, acts: [...b.querySelectorAll('[data-act]')].map((x) => x.dataset.act), open: (b.querySelector('a[data-open]') || {}).textContent || '' }));
    check(/@demo_lakelight/.test(ig.text) && /Open on Instagram/.test(ig.open) && JSON.stringify(ig.acts) === '["up","share"]', 'an Instagram post’s sheet: the account, vote, share and Open on Instagram', JSON.stringify(ig));
    const igTitle = await page.$eval('.sheet-card', (c) => c.getAttribute('aria-label'));
    check(/^Glass-calm at the breakwater this morning\. Not a single ripple until the ferry came…$/.test(igTitle) && /until the ferry came through\./.test(ig.text),
      'titled by its caption, cut at a word, the whole caption under the picture', igTitle);
    await page.click('.sheet-body [data-act="up"]');
    check(await page.$eval('.sheet-body [data-act="up"]', (b) => b.getAttribute('aria-pressed')) === 'true' && await page.$eval(pmPanel + ' [data-k="ig:DemoLake1"] [data-act="up"]', (b) => b.getAttribute('aria-pressed')) === 'true',
      'its vote is the Wire’s own, on the sheet and the card', '');
    await page.click('.sheet-body a[data-open]');
    check(/in the real build/.test(await page.$eval('#toast', (t) => t.textContent)), 'the demo’s Open link only toasts', '');
    await page.click('.sheet-head .iconbtn');
    /* a gallery photo */
    await pmAll(page);
    await page.click(pmPanel + ' [data-k="g-demo-g1"] .pm-pic');
    await page.waitForSelector('.sheet-card[aria-label="Sunset from Waterfront Park"]', { timeout: 4000 }).catch(() => {});
    check(/Photo by Stephen · Waterfront Park, Waterfront/.test(await page.$eval('.sheet-body', (b) => b.innerText)), 'a gallery photo’s sheet credits who took it and where', await page.$eval('.sheet-body', (b) => b.innerText));
    await page.click('.sheet-head .iconbtn');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Photo mode: Post a photo opens the submission sheet, moderated as before (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { motion: 'reduce' });
    await page.goto(base + '/all-day/?demo=1#wire/photos');
    await settle(page);
    await pmOn(page);
    const head = await page.$eval(pmPanel + ' .pm-head', (h) => ({ h2: h.querySelector('h2').textContent, p: h.querySelector('p').textContent, b: h.querySelector('[data-post]').textContent.trim() }));
    check(head.h2 === 'Burlington in photos' && head.p === 'Local Instagram plus photos people post here.' && head.b === 'Post a photo to the Burlington feed',
      'the feed opens under “Burlington in photos”, one line, and the Post a photo to the Burlington feed button', JSON.stringify(head));
    await page.click(pmPanel + ' .pm-head [data-post]');
    await page.waitForSelector('.sheet-card[aria-label="Post a photo"]', { timeout: 4000 }).catch(() => {});
    check(/Sign in to post\./.test(await page.$eval('.sheet-body', (b) => b.innerText)), 'signed out, the sheet asks for the sign-in', '');
    await page.click('.sheet-head .iconbtn');
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.click(pmPanel + ' .pm-head [data-post]');
    await page.waitForSelector('.sheet-body form.bform', { timeout: 4000 }).catch(() => {});
    const kinds = await page.$$eval('select[name="m:medium"] option', (o) => o.map((x) => x.value).filter(Boolean));
    check(JSON.stringify(kinds) === '["Vibe check","Event poster","Food","Pets","Other"]' && await page.$('input[name="m:medium"]') === null && await page.$('select[name="m:shirt"]') !== null,
      'Post a photo asks what it is (vibe check, event poster, food, pets, other) and about the shirt, never a medium', JSON.stringify(kinds));
    check(/Photos show once approved\./.test(await page.$eval('.bform', (f) => f.innerText)), 'and says, in one line, that photos show once approved', '');
    const before = (await pmState(page)).list.length;
    await page.fill('input[name=display_name]', 'Robin');
    await page.fill('input[name=title]', 'Leddy at dusk');
    await page.selectOption('select[name="m:medium"]', 'Pets');
    await page.selectOption('select[name="m:shirt"]', 'no');
    await page.setInputFiles('.bform input[type=file]', { name: 'leddy.jpg', mimeType: 'image/jpeg', buffer: PNG });
    await page.check('.bform input[name=consent]');
    await page.click('.bform button[type=submit]');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached', timeout: 4000 }).catch(() => {});
    check(/shows once approved/.test(await page.$eval('#toast', (t) => t.textContent)), 'posted: the toast says it waits for approval', await page.$eval('#toast', (t) => t.textContent));
    const row = await fakeOf(page, `(f) => { const p = f.posts.find((x) => x.title === 'Leddy at dusk'); return p && { board: p.board, kind: p.kind, medium: p.meta.medium, photo: f.photos.get(p.photo_path).status }; }`);
    check(row && row.board === 'art' && row.kind === 'photo' && row.medium === 'Pets' && row.photo === 'pending', 'it is on the art board as a photo post with its kind, its picture pending in the queue', JSON.stringify(row));
    await page.waitForTimeout(300);
    check(!(await page.$(pmPanel + ' .pm-cap:has-text("Leddy at dusk")')) && (await pmState(page)).list.length === before, 'and the feed does not show it yet', '');
    await fakeOf(page, `(f) => { const p = f.posts.find((x) => x.title === 'Leddy at dusk'); f.setPhoto(p.photo_path, 'approved'); return 1; }`);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('allday-boards', { detail: { board: 'art', id: null, what: 'test' } })));
    await page.waitForSelector(pmPanel + ' .pm-cap:has-text("Leddy at dusk")', { timeout: 4000 }).catch(() => {});
    check(!!(await page.$(pmPanel + ' .pm-cap:has-text("Leddy at dusk")')), 'once Stephen approves it, it is in the feed', '');
    const st = await pmState(page);
    check(st.pets.length === 4 && !!(await page.$(pmPanel + ' .pm-pets [data-pet]')), 'and, posted as Pets, it joins Pets of Burlington', JSON.stringify(st.pets));
    await pmAll(page);
    await page.click(pmPanel + ' .caught .btn:has-text("Add art")');
    await page.waitForSelector('.sheet-card[aria-label="Add art"]', { timeout: 4000 }).catch(() => {});
    check(await page.$('input[name="m:medium"]') !== null, 'the feed’s end offers Add art, which asks for the medium', '');
    await page.click('.sheet-head .iconbtn');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Photo mode: deep links land in it (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    const open = async (hash) => {
      await page.goto('about:blank');
      await page.goto(base + '/all-day/?demo=1' + hash);
      await settle(page);
      await pmOn(page);
      await page.waitForTimeout(300);
      return page.evaluate(() => ({ hash: location.hash, photos: !!document.querySelector('#panel-wire .card.pm'), sheet: document.querySelector('#sheet:not([hidden]) .sheet-card')?.getAttribute('aria-label') || '',
        toast: document.querySelector('#toast')?.textContent || '' }));
    };
    for (const [from, to] of [['#wire/photos', '#wire/photos'], ['#art', '#wire/photos'], ['#photos', '#wire/photos'], ['#art/wall', '#wire/photos'], ['#photos/p-1', '#wire/photos']]) {
      const r = await open(from);
      check(r.photos && r.hash === to && !r.sheet, from + ' opens Photo mode, and the address says ' + to, JSON.stringify(r));
    }
    let r = await open('#art/b-0000a000-0000-4000-8000-000000000002');
    check(r.hash === '#wire/photos/b-0000a000-0000-4000-8000-000000000002' && r.sheet === 'Aurora from the causeway', 'an old #art/<key> opens that picture’s sheet in Photo mode', JSON.stringify(r));
    check(await flashes(page, 'b-0000a000-0000-4000-8000-000000000002') || await page.$eval(pmPanel + ' [data-k="b-0000a000-0000-4000-8000-000000000002"]', (n) => n.getBoundingClientRect().top < innerHeight), 'and its card is on screen behind it', '');
    r = await open('#wire/photos/g-demo-g3');
    check(r.sheet === 'Morning coffee on Pine Street', 'a gallery photo far down the feed: drawn and opened', JSON.stringify(r));
    r = await open('#wire/ig:DemoNight6');
    check(r.photos && /Moonrise over the Adirondacks/.test(r.sheet), 'a shared Instagram key (#wire/ig:…) opens in Photo mode', JSON.stringify(r));
    r = await open('#wire/photos/b-0000a000-0000-4000-8000-00000000ffff');
    check(r.photos && !r.sheet && /moved on/.test(r.toast), 'a picture that is gone says so', JSON.stringify(r));
    check(await page.$$eval(pmPanel + ' .card.pm', (c) => c.length) <= 10, 'and only the first screenful is drawn looking for it', '');
    /* the phone remembers Photos, but a story's link is the paper's */
    await page.goto(base + '/all-day/?demo=1#wire/w3');
    await settle(page);
    await page.waitForSelector(pmPanel + ' .card.row, ' + pmPanel + ' .wm', { timeout: 8000 }).catch(() => {});
    check(!(await page.$(pmPanel + ' .card.pm')) && await flashes(page, 'w3'), 'a story’s link opens the list on that story, though Photos is kept', '');
    check(await page.evaluate(() => localStorage.getItem('allday-wire-view')) === 'photos', 'and the kept choice is unchanged', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  for (const combo of COMBOS) {
    const label = combo.viewport.width + ' ' + combo.scheme + (combo.motion === 'reduce' ? ' reduced-motion' : '');
    await group('Photo mode at ' + label + ' (demo)', async () => {
      const { ctx, page, errors } = await newPage(browser, base, combo);
      await page.goto(base + '/all-day/?demo=1#wire/photos');
      await settle(page);
      await pmOn(page);
      await pageRules(page, 'wire photos', combo.viewport.width);
      const m = await page.evaluate(() => {
        const pic = document.querySelector('#panel-wire .card.pm .pm-pic').getBoundingClientRect();
        const feed = document.querySelector('#panel-wire .pm-feed').getBoundingClientRect();
        const b = document.querySelector('#subnav .wmode');
        return { pw: Math.round(pic.width), ph: Math.round(pic.height), fw: Math.round(feed.width), tr: getComputedStyle(b).transitionDuration,
          bg: getComputedStyle(document.body).backgroundColor, on: getComputedStyle(document.querySelector('#subnav .wmode.on')).backgroundColor };
      });
      check(Math.abs(m.ph - m.pw * 5 / 4) <= 2, 'the picture reserves its 4:5 box', JSON.stringify(m));
      check(combo.viewport.width < 900 ? m.pw === combo.viewport.width : m.fw <= 468, combo.viewport.width < 900 ? 'full width on a phone' : 'a narrow column on a wide screen', JSON.stringify(m));
      check(m.bg === PAPER[combo.scheme], 'the ' + combo.scheme + ' paper', m.bg);
      if (combo.motion === 'reduce') check(/^0s/.test(m.tr), 'reduced motion: the switch does not animate', m.tr);
      if (combo === COMBOS[0]) await page.screenshot({ path: path.join(SHOTS, 'demo-wire-photos.png') });
      if (combo === COMBOS[4]) await page.screenshot({ path: path.join(SHOTS, 'demo-wire-photos-desktop-dark.png') });
      check(!errors.length, 'no console errors', errors.join(' | '));
      await ctx.close();
    });
  }

  await group('Photo mode on live payloads: each source, once, while its picture works, and never the news (live)', async () => {
    const now = Date.now();
    const hex = (sec) => Math.floor(sec).toString(16);
    const today = wireFiles({})['wire-today.json'];
    const items = today.updates.flatMap((u) => u.items);
    const dupe = items.find((it) => it.thumb && it.local && it.ch === 'local');
    const ig = { generated: new Date(now).toISOString(), posts: [
      { h: 'lakelight', ts: Math.round(now / 1000) - 1800, i: 'https://scontent.example.com/a.jpg?stp=x&oe=' + hex(now / 1000 + 3 * 86400) + '&oh=1', u: 'https://www.instagram.com/p/LiveOne/', w: 480, c: 'Fog on the lake <b>at dawn</b>\nsecond line', s: 'see' },
      { h: 'lakelight', ts: Math.round(now / 1000) - 3600, i: 'https://scontent.example.com/b.jpg?oe=' + hex(now / 1000 - 3600), u: 'https://www.instagram.com/p/LiveLapsed/', w: 480, c: 'Lapsed', s: 'see' },
      { h: 'javascript', ts: Math.round(now / 1000) - 60, i: 'javascript:alert(1)', u: 'https://www.instagram.com/p/LiveBad/', c: 'x', s: 'see' },
    ] };
    const pulse = { v: 1, generated: new Date(now).toISOString(),
      sources: [{ id: 'seven-days', name: 'Seven Days', short: 'Seven Days', topic: 'local', local: 1 }, { id: 'ap', name: 'AP', short: 'AP', topic: 'news' },
        { id: 'r-burlington', name: 'r/burlington', short: 'r/burlington', topic: 'local', local: 1 }, { id: 'frequency', name: 'The Frequency', short: 'The Frequency', topic: 'local', local: 1 }],
      items: [
        { t: 'Seven Days picture', u: 'https://example.org/live/sd1', d: Math.round(now / 1000) - 900, i: 'https://example.org/live/sd1.jpg', s: 'seven-days', ch: 'local', local: true },
        { t: 'The same story again', u: dupe.url.replace('https://', 'https://www.') + '/?utm_source=x', d: Math.round(now / 1000) - 800, i: 'https://example.org/live/dupe.jpg', s: 'seven-days', ch: 'local', local: true },
        { t: 'A national picture', u: 'https://example.org/live/ap1', d: Math.round(now / 1000) - 700, i: 'https://example.org/live/ap1.jpg', s: 'ap', ch: 'world', local: false },
        { t: 'A podcast episode', u: 'https://example.org/live/pod1', d: Math.round(now / 1000) - 600, i: 'https://example.org/live/pod.jpg', s: 'frequency', ch: 'local', local: true, du: 900, dn: 'x' },
        { t: 'A Reddit picture', u: 'https://www.reddit.com/r/burlington/comments/live1/', d: Math.round(now / 1000) - 500, i: 'https://i.redd.it/live1.jpg', s: 'r-burlington', ch: 'reddit', local: true },
        { t: 'A Reddit question', u: 'https://www.reddit.com/r/burlington/comments/live2/', d: Math.round(now / 1000) - 400, s: 'r-burlington', ch: 'reddit', local: true },
        { t: 'Morning show, Monday', u: 'https://example.org/live/show1', d: Math.round(now / 1000) - 1000, i: 'https://example.org/live/show-logo.png', s: 'seven-days', ch: 'local', local: true },
        { t: 'Morning show, Tuesday', u: 'https://example.org/live/show2', d: Math.round(now / 1000) - 1100, i: 'https://example.org/live/show-logo.png', s: 'seven-days', ch: 'local', local: true },
        { t: 'A picture from last month', u: 'https://example.org/live/old', d: Math.round(now / 1000) - 30 * 86400, i: 'https://example.org/live/old.jpg', s: 'seven-days', ch: 'local', local: true },
      ],
      inbox: { facebook: { paused: false, items: [
        { u: 'https://facebook.com/groups/1/permalink/2/', d: Math.round(now / 1000) - 300, from: 'ONE Neighbors', name: 'ONE Neighbors', summary: 'A lost cat on North Street', kind: 'post', ch: 'facebook', local: true, i: 'https://example.org/live/cat.jpg' },
        { u: 'https://facebook.com/groups/1/permalink/3/', d: Math.round(now / 1000) - 200, from: 'ONE Neighbors', name: 'ONE Neighbors', summary: 'No picture here', kind: 'post', ch: 'facebook', local: true },
      ] } } };
    const posts = [
      PM_POST({ id: '0000e000-0000-4000-8000-000000000001', title: 'Older, more votes', at: new Date(now - 120000).toISOString(), votes: 9 }),
      PM_POST({ id: '0000e000-0000-4000-8000-000000000002', title: 'Newest, fewer votes', at: new Date(now - 60000).toISOString(), votes: 2 }),
      PM_POST({ id: '0000e000-0000-4000-8000-000000000003', kind: 'notice', title: 'A notice', photo: null, at: new Date(now - 30000).toISOString(), votes: 40 }),
    ];
    const gallery = [{ id: 'live-g1', storage_path: 'submissions/g1.jpg', caption: 'Sunset "<script>"', category: 'sunsets', area: 'Waterfront', spot: 'Waterfront Park', credit: 'Ana', approved_on: '2026-10-01', votes: 3 },
      { id: 'live-g2', storage_path: 'submissions/g2.jpg', caption: 'A dish', category: 'dish', area: 'Old North End', credit: 'Sam', approved_on: '2026-10-01' }];
    /* one a day back over two months: the board pages, sixty at a time, to its end */
    for (let i = 0; i < 63; i++) posts.push(PM_POST({ id: '0000e000-0000-4000-8000-0000000001' + String(i).padStart(2, '0'), title: 'Day ' + i, at: new Date(now - (i + 2) * 86400000).toISOString(), votes: 1 }));
    const lists = [];
    const rpc = (fn, args) => {
      if (fn === 'nn_posts_list') {
        if (args.p_board !== 'art') return [];
        lists.push(args.p_before);
        const before = args.p_before ? Date.parse(args.p_before) : Infinity;
        return posts.filter((p) => Date.parse(p.created_at) < before).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, args.p_limit);
      }
      if (fn === 'btb_photos_get') return gallery;
      return undefined;
    };
    const { ctx, page, errors } = await newPage(browser, base, { rpc });
    await page.route(/\/all-day\/data\/instagram\.json$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ig) }));
    await page.route(/\/data\/pulse\.json$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pulse) }));
    await page.goto(base + '/all-day/#wire/photos');
    await settle(page);
    check(await pmOn(page), 'live, #wire/photos opens the photo feed', '');
    await pmAll(page);
    const st = await pmState(page);
    const keys = st.list.map((v) => v.k);
    const from = st.list.reduce((o, v) => { o[v.from] = (o[v.from] || 0) + 1; return o; }, {});
    check(st.lead === 'b-0000e000-0000-4000-8000-000000000001' && keys[0] === st.lead, 'the photo of the week leads on its votes, ahead of a newer post', JSON.stringify(keys.slice(0, 3)));
    check(!keys.includes('b-0000e000-0000-4000-8000-000000000003'), 'a notice has no picture and stays out', '');
    check(keys.includes('g-live-g1') && !keys.includes('g-live-g2'), 'the gallery’s photos, but not Food’s dishes', '');
    check(keys.includes('ig:LiveOne') && !keys.includes('ig:LiveLapsed') && !keys.includes('ig:LiveBad'), 'Instagram: a working picture, never a lapsed or a non-web one', JSON.stringify(keys.filter((k) => /^ig:/.test(k))));
    /* Stephen, 2026-10-18: "I don't want to see the news here" */
    check(keys.every((k) => /^(b-|g-|ig:)/.test(k)) && !keys.includes(dupe.id) && !keys.includes('https://example.org/live/sd1'),
      'no story’s lead image, no outlet’s, no Reddit or Facebook picture: Photos is not news', JSON.stringify(keys.filter((k) => !/^(b-|g-|ig:)/.test(k))));
    check(lists.length === 2 && !lists[0] && lists[1], 'the art board is paged to its end', JSON.stringify(lists));
    check(from.board === 65 && from.gallery === 1 && from.instagram === 1 && Object.keys(from).length === 3, 'every source gives its pictures', JSON.stringify(from));
    const html = await page.$eval(pmPanel + ' .pm-feed', (f) => f.innerHTML);
    check(!/<script>|<b>at dawn/.test(html), 'captions are escaped', '');
    const igCard = await page.$eval(pmPanel + ' [data-k="ig:LiveOne"]', (c) => ({ alt: c.querySelector('img.pic').alt, cap: c.querySelector('.pm-cap').textContent, href: c.querySelector('.pm-pic').getAttribute('href'),
      loading: c.querySelector('img.pic').getAttribute('loading') }));
    check(igCard.alt === 'Fog on the lake <b>at dawn</b> second line' && igCard.cap === 'Fog on the lake <b>at dawn</b>' && igCard.href === 'https://www.instagram.com/p/LiveOne/' && igCard.loading === 'lazy',
      'the picture’s alt text is its caption, lazy; one line under it', JSON.stringify(igCard));
    const keysAll = await page.$$eval(pmPanel + ' [data-k]', (n) => n.map((x) => x.dataset.k));
    check(new Set(keysAll).size === keysAll.length, 'no key twice on the page', '');
    const far = await page.evaluate(() => { const img = document.querySelector('#panel-wire .card.pm img.pic'); return { src: img.getAttribute('src'), kept: img.dataset.src || '' }; });
    check(!far.src && /^https:/.test(far.kept), 'at the bottom of the feed, the first card has let go of its picture', JSON.stringify(far));
    await page.evaluate(() => { document.querySelector('#panel-wire').scrollTop = 0; });
    await page.waitForFunction(() => !!document.querySelector('#panel-wire .card.pm img.pic').getAttribute('src'), null, { timeout: 4000 }).catch(() => {});
    check(!!(await page.$eval(pmPanel + ' .card.pm img.pic', (i) => i.getAttribute('src'))), 'and takes it back on the way up', '');
    /* a broken picture takes its card with it */
    const k1 = 'ig:LiveOne';
    /* The failed request must belong to a visible, loaded image. An offscreen
       lazy image can defer the bad URL without ever emitting an error. */
    await page.locator(pmPanel + ' [data-k="' + k1 + '"]').evaluate(n => n.scrollIntoView({block:'center',behavior:'instant'}));
    await page.waitForFunction(k => {
      const c=[...document.querySelectorAll('#panel-wire [data-k]')].find(n=>n.dataset.k===k);
      const img=c && c.querySelector('img.pic');
      return img && img.getAttribute('src') && !img.dataset.src && img.complete;
    }, k1);
    await page.evaluate((k) => { const img = [...document.querySelectorAll('#panel-wire [data-k]')].find((n) => n.dataset.k === k).querySelector('img.pic'); img.src = 'data:image/png;base64,broken'; }, k1);
    await page.waitForFunction(k => ![...document.querySelectorAll('#panel-wire [data-k]')].some(n=>n.dataset.k===k), k1, {timeout:4000}).catch(()=>{});
    check(!(await page.$$eval(pmPanel + ' [data-k]', (n, k) => n.some((x) => x.dataset.k === k), k1)), 'a picture that will not load takes its card with it', '');
    check(!errors.filter((e) => !/ERR_INVALID_URL|Failed to load resource/.test(e)).length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });
}

/* ---------------------------------------------------------------- On Air */
const onairText = (page) => page.$eval('#panel-onair', (p) => p.innerText);
const podRows = (page) => page.$$eval('#panel-onair [data-show]', (rs) => rs.map((r) => [r.dataset.show, r.dataset.national || '']));
const tvCards = (page) => page.$$eval('#panel-onair [data-slot="tv"] [data-rail="picks"] .vcard', (cs) => cs.map((c) => [c.dataset.k, c.dataset.wider || '']));
const tvRest = (page) => page.$$eval('#panel-onair [data-slot="tv"] [data-rail="rest"] .vcard', (cs) => cs.map((c) => c.dataset.k));
const tvHead = (page) => page.$eval('#panel-onair [data-sec="tv"]', (h) => {
  const b = (l) => { const x = h.querySelector('.wm-nav [aria-label="' + l + '"]'); if (!x) return null; const r = x.getBoundingClientRect(); return { disabled: x.disabled, w: Math.round(r.width), h: Math.round(r.height) }; };
  return { title: h.querySelector('h2').textContent, sub: h.querySelector('p') ? h.querySelector('p').innerText : '', showing: h.dataset.showing,
    prev: b('Earlier night'), next: b('Later night'), focus: document.activeElement && document.activeElement.getAttribute('aria-label') };
});

async function onAir(browser, base) {
  await group('On Air, demo', async () => {
    const { ctx, page, errors, supabase } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#onair');
    await settle(page);
    await page.waitForSelector('#panel-onair [data-sec="past"]', { timeout: 8000 });
    check(await page.evaluate(() => document.querySelector('audio').paused && !document.querySelector('#panel-onair iframe')), 'nothing autoplays: the shell’s audio is paused and no frame is loaded', '');
    const toc = await page.$$eval('#subnav .chip', (cs) => cs.map((c) => c.innerText.trim()));
    check(JSON.stringify(toc) === JSON.stringify(['Btown TV', 'Live', 'Past nights', 'Out loud', 'Podcasts', 'Playlists']), 'the chip row is a table of contents: Btown TV, Live, Past nights, Out loud, Podcasts, Playlists', JSON.stringify(toc));
    const order = await page.$$eval('#panel-onair [data-sec]', (s) => s.map((x) => x.dataset.sec));
    check(JSON.stringify(order) === JSON.stringify(['tv', 'live', 'past', 'brief', 'pods', 'lists']), 'what changes daily first: tonight, live and past nights, then the Brief out loud, then podcasts (Stephen, 2026-10-18: not videos, podcasts, videos)', JSON.stringify(order));
    check(await page.$eval('#panel-onair [data-sec="tv"]', (h) => h.getBoundingClientRect().top < 260), 'Btown TV tonight opens the tab, high on the first screen', '');
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
    check(localTv.length > 0 && localTv.every((c) => !c[1]), 'Local: the picks rail is only the local picks', JSON.stringify(localTv));
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
    check(eyebrow === 'Today’s edition · 21 min', 'today’s edition: the card says so and how long it runs', eyebrow);
    check((await podRows(page))[0][0] === 'btown-brief', 'live: the Brief’s own show is first in Podcasts', '');
    const repoLists = JSON.parse(await readFile(path.join(APP, 'data/playlists.json'), 'utf8'));
    const realLists = [...repoLists.stephen, ...repoLists.readers].filter((p) => !/^\s*TODO/i.test(p.url)).length;
    if (!realLists) check(!(await page.$('#panel-onair [data-sec="lists"]')) && !(await page.$$eval('#subnav .chip', (cs) => cs.map((c) => c.dataset.chip))).includes('lists'),
      'live: data/playlists.json is still TODO placeholders, so no Playlists section and no chip', '');
    const play = await tvPlay(page);
    check(play.tonight && PLAYLIST.test(play.tonight.href) && play.tonight.href === tv.playlist.url && play.tonight.rel === 'noopener' && play.tonight.target === '_blank',
      'Btown TV: “Play tonight on your TV” opens tonight’s playlist in a new tab', JSON.stringify(play));
    check(play.tonight && play.tonight.text === 'Play tonight on your TV' && play.tonight.icons === 2 && play.before, 'under the Btown TV header, before the rail, with the play and external icons', JSON.stringify(play));
    check((await tvCards(page)).length === tv.shelves.find((x) => x.key === 'vt').items.length + 1, 'live: tonight’s local picks, the pick and the Burlington & Vermont shelf', '');
    const cardText = await page.$eval('#panel-onair .audio', (a) => a.innerText);
    check(/The intro and the local news, word for word\. New every Monday and Friday\./.test(cardText), 'the card says what it is (the newsletter itself) and when a new one comes', cardText);
    check(!/\bAI\b|synthetic|artificial|recap|summary/i.test(cardText), 'no mention of AI, and nothing calls it a recap', cardText);
    const ed = await page.$eval('#panel-onair .audio [data-newsletter]', (a) => a.getAttribute('href'));
    check(ed === index.clips[0].url, '“Read this edition” opens that edition’s own page', ed);
    check(!(await page.$('#panel-onair .brieflinks, #panel-onair .audio .wave')), 'no transcript button and no waveform: the card is one row and its controls', '');

    /* the player: the clip plays in the shell's one player and survives a tab switch */
    await page.click('#panel-onair .audio .pb');
    await page.waitForSelector('#player:not([hidden])', { timeout: 3000 }).catch(() => {});
    const src = await page.evaluate(() => document.querySelector('audio').getAttribute('src'));
    check(src === 'https://raw.githubusercontent.com/btownbrief/btown-brief/wire-audio/data/audio/' + today + '.mp3', 'play loads today’s MP3 from the wire-audio branch into the shell’s player', src);
    await page.waitForFunction(() => document.querySelector('audio').playbackRate === 1.25, null, { timeout: 3000 }).catch(() => {});
    const sped = await page.evaluate(() => { const a = document.querySelector('audio'); return [a.playbackRate, a.preservesPitch]; });
    check(sped[0] === 1.25 && sped[1] === true, 'the Brief plays at 1.25x by default, pitch kept', JSON.stringify(sped));
    await page.click('#panel-onair .audio [data-rate="1.5"]');
    check(await page.evaluate(() => document.querySelector('audio').playbackRate) === 1.5, '1.5x speeds up the playing clip at once, no reload', '');
    await page.click('#panel-onair .audio [data-rate="1.25"]');
    await goTab(page, 'wire');
    await goTab(page, 'food');
    check(await page.$('#player:not([hidden])') !== null && /’s Brief, read aloud/.test(await page.$eval('#p-title', (t) => t.textContent)), 'the player survives a tab switch', '');
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

  await group('On Air, more of the edition and past nights', async () => {
    const d = JSON.parse(await readFile(path.join(APP, 'data/demo/onair.json'), 'utf8'));
    const all = [d.tv.pick, ...d.tv.shelves.flatMap((x) => x.items)].map((v) => 'yt:' + v.id);
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#onair');
    await settle(page);
    await page.waitForSelector('#panel-onair [data-sec="past"]', { timeout: 8000 });
    const picks = (await tvCards(page)).map((c) => c[0]);
    const rest = await tvRest(page);
    const face = picks.concat(rest);
    check(face.length === all.length && new Set(face).size === face.length && all.every((k) => face.includes(k)),
      'Local: the whole edition is on the face, each video once (' + picks.length + ' picks + ' + rest.length + ' more = ' + all.length + ')', face.length + ' of ' + all.length);
    const one = await page.$eval('#panel-onair [data-slot="tv"]', (slot) => {
      const wraps = [...slot.children].filter((c) => c.classList.contains('rail-wrap'));
      const picks = slot.querySelector('[data-rail="picks"]').closest('.rail-wrap');
      const rest = slot.querySelector('[data-rail="rest"]').closest('.rail-wrap');
      /* between the two rails only their "See as a list" rows */
      let between = picks.nextElementSibling;
      const mid = [];
      while (between && between !== rest) { mid.push(between.className); between = between.nextElementSibling; }
      return { heads: slot.querySelectorAll('.sec').length, dividers: slot.querySelectorAll('.tdiv').length, next: between === rest && mid.every((c) => /^railmode/.test(c)), wraps: wraps.length,
        big: Math.round(picks.querySelector('.vcard').getBoundingClientRect().width), small: Math.round(rest.querySelector('.vcard').getBoundingClientRect().width) };
    });
    check(one.heads === 1 && !one.dividers && one.next && one.wraps === 2, 'one section: one header, the rest of the night straight under the picks, no second header', JSON.stringify(one));
    check(one.big > one.small + 60, 'the picks big on top, the rest smaller below', JSON.stringify(one));
    /* the whole edition: a filled card under the section, with the count, that opens every video */
    const n = all.length;
    const whole = await page.$eval('#panel-onair [data-slot="tv"] .wholeed', (b) => {
      const r = b.getBoundingClientRect();
      const rest = document.querySelector('#panel-onair [data-rail="rest"]').closest('.rail-wrap');
      return { text: b.innerText.replace(/\s+/g, ' ').trim(), w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, last: b === b.parentElement.lastElementChild,
        after: !!(rest.compareDocumentPosition(b) & 4), covers: b.querySelectorAll('.fan .th').length, filled: getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)', tag: b.tagName };
    });
    check(whole.text === 'Watch the whole edition All ' + n + ' videos from tonight', 'the whole edition says what it is and how many: “All ' + n + ' videos from tonight”', JSON.stringify(whole));
    check(whole.tag === 'BUTTON' && whole.w >= whole.vw - 32 - 1 && whole.h >= 64 && whole.filled && whole.covers === 3, 'a full-width filled card, three covers fanned on it, not a ghost button', JSON.stringify(whole));
    check(whole.last && whole.after, 'right under the section: after the second rail, the last thing in the Btown TV block', JSON.stringify(whole));
    await page.click('#panel-onair .wholeed');
    await page.waitForSelector('.sheet-card', { timeout: 3000 });
    check(await page.$$eval('.sheet-body .card.video', (c) => c.length) === n, 'it opens all ' + n + ' videos', '');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const grid = await page.$$eval('#panel-onair [data-rail="rest"] .vcard', (cs) => {
      const rows = new Set(cs.map((c) => Math.round(c.getBoundingClientRect().top)));
      const seen = cs.filter((c) => { const r = c.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }).length;
      const partial = cs.filter((c) => { const r = c.getBoundingClientRect(); return r.left < innerWidth && r.right > innerWidth; }).length;
      const narrow = cs.filter((c) => c.getBoundingClientRect().width < 140).length;
      return { rows: rows.size, seen, partial, narrow };
    });
    check(grid.rows === 2 && !grid.narrow, 'the second rail is two rows deep, every cover full width', JSON.stringify(grid));
    check(grid.seen >= 4 && grid.partial >= 1, 'at 390 wide, four whole covers on screen and the next ones peeking (was one and a half)', JSON.stringify(grid));
    check(await page.$eval('#panel-onair [data-rail="rest"]', (r) => r.scrollWidth > r.clientWidth + 100), 'and it scrolls sideways for the rest', '');

    /* ‹ › on the header: tonight, then back through the archive, then home */
    let h = await tvHead(page);
    check(h.title === 'Btown TV tonight' && h.showing === 'tonight' && !h.sub, 'tonight: the header as before, no subtitle', JSON.stringify(h));
    check(h.prev && h.next && h.prev.w >= 44 && h.prev.h >= 44 && h.next.w >= 44 && h.next.h >= 44, 'the arrows are 44 px targets with labels', JSON.stringify(h));
    check(h.next.disabled && !h.prev.disabled, 'tonight: “Later night” is disabled, “Earlier night” is not', JSON.stringify(h));
    await page.click('#panel-onair [data-sec="tv"] [aria-label="Earlier night"]');
    h = await tvHead(page);
    const nights = d.tvEditions.editions.length;   // the demo archive holds tonight and the nights before
    const yKey = await page.evaluate(() => document.querySelector('#panel-onair [data-sec="tv"]').dataset.showing);
    const yNight = d.tvEditions.editions[1];
    const yIds = [yNight.pick, ...yNight.shelves.flatMap((x) => x.items)].map((v) => 'yt:' + v.id).sort();
    const shown = (await tvCards(page)).map((c) => c[0]).concat(await tvRest(page)).sort();
    check(h.title === 'Btown TV last night' && /· Tonight$/.test(h.sub) && h.showing === dayMinus(etKey(Date.now()), 1), 'one back: last night’s edition, its date and a way back to tonight', JSON.stringify(h));
    check(JSON.stringify(shown) === JSON.stringify(yIds), 'and that night’s videos, in place', JSON.stringify(shown));
    check(!h.next.disabled && !h.prev.disabled && h.focus === 'Earlier night', 'both arrows live now, focus stays on the one pressed', JSON.stringify(h));
    check(await page.$('#panel-onair [data-sec="tv"] + .tvplay [data-tvplay="night"]') !== null, 'with that night’s own TV playlist', '');
    for (let i = 2; i < nights; i++) await page.click('#panel-onair [data-sec="tv"] [aria-label="Earlier night"]');
    h = await tvHead(page);
    check(h.prev.disabled && !h.next.disabled && h.focus === 'Later night', 'the oldest night: “Earlier night” disabled, focus moves to the other arrow', JSON.stringify(h));
    await page.click('#panel-onair [data-sec="tv"] [aria-label="Later night"]');
    check((await tvHead(page)).showing === dayMinus(etKey(Date.now()), nights - 2), '“Later night” steps forward one', '');
    await page.click('#panel-onair [data-sec="tv"] [data-tonight]');
    h = await tvHead(page);
    check(h.showing === 'tonight' && h.title === 'Btown TV tonight' && h.next.disabled && !h.sub, '“Tonight” comes back', JSON.stringify(h));
    check(!!yKey && await page.$('#panel-onair [data-sec="past"]') !== null, 'Past nights stays below', '');
    await toTop(page);
    await page.click('#subnav .localsw-half:not(.on)');
    await page.waitForTimeout(250);
    await page.click('#panel-onair [data-sec="tv"] [aria-label="Earlier night"]');
    check((await tvHead(page)).title === 'Last night, local and beyond', 'Everything: “Last night, local and beyond”', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  /* Stephen, 2026-10-18: the rails felt small and hard to read next to
     YouTube; "at least having a button, so it changes to just scrolling down" */
  await group('On Air, see as a list', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#onair');
    await settle(page);
    await page.waitForSelector('#panel-onair [data-sec="past"]', { timeout: 8000 });
    const rails = await page.$$eval('#panel-onair .rail[data-rail]', (rs) => rs.map((r) => r.dataset.rail));
    check(JSON.stringify(rails) === JSON.stringify(['picks', 'rest', 'live', 'past']), 'every video rail can turn: tonight’s picks, the rest of the night, Live and Past nights', JSON.stringify(rails));
    const tops = await page.$$eval('#panel-onair .railmode:not(.foot) [data-railmode]', (bs) => bs.map((b) => b.textContent + '|' + b.getAttribute('aria-pressed') + '|' + Math.round(b.getBoundingClientRect().height)));
    check(tops.length === 4 && tops.every((t) => /^See as a list\|false\|\d+$/.test(t) && Number(t.split('|')[2]) >= 30), 'sideways by default, “See as a list” above each rail', JSON.stringify(tops));
    check(!(await page.$$eval('#panel-onair .railmode.foot', (fs) => fs.filter((f) => !f.hidden).length)), 'no button at the foot of a sideways row', '');
    const names = await page.$$eval('#panel-onair .railmode:not(.foot) [data-railmode]', (bs) => bs.map((b) => b.getAttribute('aria-label')));
    check(new Set(names).size === 4 && names.every((n) => n.startsWith('See as a list: ')), 'each button names its rail for a screen reader, the visible words first', JSON.stringify(names));
    const measure = () => page.$eval('#panel-onair [data-rail="rest"]', (r) => {
      const cs = [...r.querySelectorAll(':scope > .vcard')];
      const boxes = cs.map((c) => c.getBoundingClientRect());
      const first = cs[0];
      const media = first.querySelector('.c-media').getBoundingClientRect();
      const t = first.querySelector('.t');
      return { list: r.classList.contains('aslist'), sideways: r.scrollWidth > r.clientWidth + 4, n: cs.length,
        down: boxes.every((b, i) => !i || b.top >= boxes[i - 1].bottom - 1), inside: boxes.every((b) => b.left >= 0 && b.right <= innerWidth + 0.5),
        title: parseFloat(getComputedStyle(t).fontSize), beside: media.right <= t.getBoundingClientRect().left + 0.5 && media.width >= 140,
        bar: getComputedStyle(r.parentElement.querySelector('.rail-bar')).display };
    });
    const before = await measure();
    await page.click('#panel-onair .railmode:not(.foot) [data-railmode="rest"]');
    const after = await measure();
    check(before.sideways && !before.list && after.list && !after.sideways && after.down && after.inside, 'the rest of the night becomes a list you scroll down, every card on screen', JSON.stringify({ before, after }));
    check(after.beside && after.title > before.title, 'the thumbnail beside a bigger title (' + before.title + ' to ' + after.title + ' px)', JSON.stringify(after));
    check(after.bar === 'none', 'and the sideways progress bar goes', after.bar);
    const words = await page.$$eval('#panel-onair [data-railmode="rest"]', (bs) => bs.map((b) => b.textContent + '|' + b.getAttribute('aria-pressed') + '|' + !b.closest('.railmode').hidden));
    check(JSON.stringify(words) === JSON.stringify(['See as a row|true|true', 'See as a row|true|true']), '“See as a row” above it, and again at its foot', JSON.stringify(words));
    check(await page.$eval('#panel-onair [data-rail="picks"]', (r) => !r.classList.contains('aslist')), 'the other rails keep their own setting', '');
    check(await page.evaluate(() => localStorage.getItem('allday-onair-lists')) === '{"rest":1}', 'remembered on this phone', '');
    await page.reload();
    await page.waitForSelector('#panel-onair [data-sec="past"]', { timeout: 8000 });
    check(await page.$eval('#panel-onair [data-rail="rest"]', (r) => r.classList.contains('aslist')), 'still a list after a reload', '');
    await page.$eval('#panel-onair .railmode.foot [data-railmode="rest"]', (b) => b.scrollIntoView({ block: 'center' }));
    await page.click('#panel-onair .railmode.foot [data-railmode="rest"]');
    await page.waitForTimeout(700);
    const back = await page.evaluate(() => {
      const top = document.querySelector('#panel-onair .railmode:not(.foot) [data-railmode="rest"]');
      const r = top.getBoundingClientRect();
      return { list: document.querySelector('#panel-onair [data-rail="rest"]').classList.contains('aslist'), seen: r.top >= 0 && r.bottom <= innerHeight, focus: document.activeElement === top };
    });
    check(!back.list && back.seen && back.focus, 'the button at the foot folds it back and brings you to the top of it', JSON.stringify(back));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('On Air, speed and the newsletter', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#onair');
    await page.waitForSelector('#panel-onair .audio .speed', { timeout: 8000 });
    const speeds = () => page.$$eval('#panel-onair .audio [data-rate]', (b) => b.map((x) => x.textContent + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')));
    check(JSON.stringify(await speeds()) === JSON.stringify(['1x', '1.25x*', '1.5x']), 'three speeds on the card, 1.25x unless chosen', JSON.stringify(await speeds()));
    check(await page.$eval('#panel-onair .audio .speed', (g) => g.getAttribute('role') === 'group' && !!g.getAttribute('aria-label')), 'a labelled group', '');
    await page.click('#panel-onair .audio [data-rate="1.5"]');
    check(JSON.stringify(await speeds()) === JSON.stringify(['1x', '1.25x', '1.5x*']), '1.5x picked', JSON.stringify(await speeds()));
    check(await page.evaluate(() => localStorage.getItem('allday-brief-rate')) === '1.5', 'and remembered on this phone', '');
    await page.reload();
    await page.waitForSelector('#panel-onair .audio .speed', { timeout: 8000 });
    check(JSON.stringify(await speeds()) === JSON.stringify(['1x', '1.25x', '1.5x*']), 'still 1.5x after a reload', JSON.stringify(await speeds()));
    const link = await page.$eval('#panel-onair [data-newsletter]', (a) => ({ text: a.textContent.trim(), href: a.href, target: a.target, rel: a.rel, icons: a.querySelectorAll('svg').length }));
    check(link.text === 'Read this edition' && link.href === 'https://www.btownbrief.com/p/friday-october-16th' && link.target === '_blank' && link.rel === 'noopener' && link.icons === 1,
      '“Read this edition” opens the edition the clip reads, in a new tab', JSON.stringify(link));
    const card = await page.$eval('#panel-onair .audio', (c) => {
      const r = c.getBoundingClientRect();
      const kids = [...c.querySelectorAll('.pb, [data-rate], [data-newsletter]')].map((x) => x.getBoundingClientRect());
      return { h: Math.round(r.height), left: r.left, right: r.right, vw: innerWidth, inside: kids.every((b) => b.left >= r.left && b.right <= r.right + 0.5 && b.height >= 30) };
    });
    check(card.h <= 190 && card.left >= 15 && card.right <= card.vw - 15 && card.inside, 'a small card (Stephen, 2026-10-18): at 390 wide it is under 190 px tall, the play button, speeds and link all inside it', JSON.stringify(card));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('On Air, the audio card', async () => {
    for (const audio of ['none', 'recap', 'older']) {
      const { ctx, page, errors } = await newPage(browser, base, { onair: { audio } });
      await page.goto(base + '/all-day/#onair');
      await page.waitForSelector('#panel-onair [data-sec="tv"]', { timeout: 15000 });
      await page.waitForSelector('#panel-onair [data-sec="past"]', { timeout: 15000 });
      await page.waitForTimeout(300);
      const card = await page.$('#panel-onair .audio');
      const toc = await page.$$eval('#subnav .chip', (cs) => cs.map((c) => c.dataset.chip));
      if (audio === 'none') {
        check(!card && !toc.includes('brief') && !(await page.$('#panel-onair [data-sec="brief"]')), 'no clip: no audio card, no section, no chip', JSON.stringify(toc));
      } else if (audio === 'recap') {
        check(!card && !toc.includes('brief'), 'the retired daily recap’s clips (no kind) never show, even before the first edition run prunes them', JSON.stringify(toc));
      } else {
        const { clips } = await onairFiles({ audio });
        const y = clips[1].date;
        const month = nameOf(y).split(', ')[1];
        const eyebrow = await page.$eval('#panel-onair .audio .eyebrow', (e) => e.textContent);
        check(card && eyebrow === month + ' edition · 20 min', 'no edition today: the latest one, with its date (' + month + ')', eyebrow);
        const title = await page.$eval('#panel-onair .audio h3', (e) => e.textContent);
        check(title === nameOf(y).split(', ')[0] + '’s Brief, read aloud', 'titled by its weekday', title);
        check(!(await page.$('#panel-onair [data-sec="brief"] p')), 'the header carries no subtitle', '');
      }
      check(!errors.length, audio + ': no console errors', errors.join(' | '));
      await ctx.close();
    }
  });

  /* Stephen, 2026-10-17: "the audio doesn't play; when you click the play
     button, nothing happens." These start real playback of the clip, at the
     real URL shape, served as raw.githubusercontent.com serves it (audio/mpeg,
     byte ranges), and watch the clock move: a src attribute is not a sound. */
  const RAW_CLIP = /^https:\/\/raw\.githubusercontent\.com\/btownbrief\/btown-brief\/wire-audio\/data\/audio\/\d{4}-\d{2}-\d{2}\.mp3$/;
  const watchPlay = (page) => page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    window.__plays = [];
    HTMLMediaElement.prototype.play = function () {
      const p = play.call(this);
      const rec = { src: this.currentSrc || this.src, state: 'pending' };
      window.__plays.push(rec);
      p.then(() => { rec.state = 'resolved'; }, (e) => { rec.state = 'rejected ' + (e && e.name); });
      return p;
    };
  });
  const audioState = (page) => page.evaluate(() => { const a = document.getElementById('audio'); return { src: a.getAttribute('src'), t: a.currentTime, d: a.duration, paused: a.paused, ended: a.ended, rate: a.playbackRate, err: a.error && a.error.code, plays: window.__plays }; });
  const clockPast = (page, s) => page.waitForFunction((s) => { const a = document.getElementById('audio'); return !a.paused && a.currentTime > s; }, s, { timeout: 8000 }).then(() => true, () => false);

  await group('On Air, the Brief plays', async () => {
    for (const audio of ['today', 'older']) {
      const { ctx, page, errors } = await newPage(browser, base, { onair: { audio } });
      await watchPlay(page);
      const types = [];
      page.on('response', (r) => { if (/\.mp3$/.test(r.url())) types.push(r.status() + ' ' + (r.headers()['content-type'] || '')); });
      await page.goto(base + '/all-day/#onair');
      await page.waitForSelector('#panel-onair .audio .pb', { timeout: 15000 });
      await page.waitForSelector('#panel-onair [data-sec="past"]', { timeout: 15000 });
      const date = (await onairFiles({ audio })).clips[audio === 'today' ? 0 : 1].date;
      await page.tap('#panel-onair .audio .pb').catch(() => page.click('#panel-onair .audio .pb'));
      const moved = await clockPast(page, 0.5);
      const st = await audioState(page);
      check(RAW_CLIP.test(st.src) && st.src.endsWith('/' + date + '.mp3'), audio + ': the play button loads ' + date + '.mp3 from the wire-audio branch', st.src);
      check(st.plays.length && st.plays[st.plays.length - 1].state === 'resolved', audio + ': the play promise resolves', JSON.stringify(st.plays));
      check(moved && !st.err, audio + ': and the clip is actually playing: its clock moves past half a second', JSON.stringify(st));
      check(types.length && types.every((t) => /^20[06] audio\/mpeg$/.test(t)), audio + ': served as audio/mpeg', JSON.stringify(types));
      check(st.rate === 1.25, audio + ': at the Brief’s 1.25x', st.rate);
      check(await page.$eval('#panel-onair .audio .pb', (b) => b.classList.contains('is-playing')) && await page.$('#player:not([hidden])') !== null, audio + ': the button turns to pause and the player is up', '');
      await page.click('#panel-onair .audio .pb');
      check((await audioState(page)).paused, audio + ': a second tap pauses', '');
      check(!errors.length, audio + ': no console errors', errors.join(' | '));
      await ctx.close();
    }

    /* the same tap in WebKit, Safari's engine, as an iPhone (touch, 390 wide),
       when the borrowed Playwright has it; the rest of the suite is Chromium */
    {
      let wk = null;
      try { wk = await require('playwright').webkit.launch(); } catch (e) { wk = null; }
      if (!wk) check(true, 'WebKit: not installed with the borrowed Playwright, skipped', '');
      else {
        const { ctx, page, errors } = await newPage(wk, base);
        await watchPlay(page);
        await page.goto(base + '/all-day/#onair');
        await page.waitForSelector('#panel-onair .audio .pb', { timeout: 15000 });
        await page.waitForSelector('#panel-onair [data-sec="past"]', { timeout: 15000 });
        await page.click('#panel-onair .audio .pb');
        const moved = await clockPast(page, 0.5);
        const st = await audioState(page);
        check(moved && RAW_CLIP.test(st.src) && st.plays.some((p) => p.state === 'resolved') && st.rate === 1.25, 'WebKit: the play button starts the clip at 1.25x and its clock moves', JSON.stringify(st));
        check(!errors.length, 'WebKit: no console errors', errors.join(' | '));
        await ctx.close();
        await wk.close();
      }
    }

    /* the bug as it was: a clip heard to its end came back parked at its
       end, so the next play ran out at once and looked like a dead button */
    const today = etKey(Date.now());
    {
      const { ctx, page, errors } = await newPage(browser, base);
      await watchPlay(page);
      await page.addInitScript((k) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('allday-heard', JSON.stringify({ [k]: 59 })); } }, 'brief:' + today);
      await page.goto(base + '/all-day/#onair');
      await page.waitForSelector('#panel-onair .audio .pb', { timeout: 15000 });
      await page.click('#panel-onair .audio .pb');
      const moved = await clockPast(page, 0.3);
      await page.waitForTimeout(1200);
      const st = await audioState(page);
      check(st.d > 50, 'the test clip runs about a minute', st.d);
      check(moved && !st.paused && !st.ended && st.t < 10, 'heard to its last second, it starts again from the top instead of running out at once', JSON.stringify(st));
      /* to the end: the place is forgotten */
      await page.evaluate(() => { const a = document.getElementById('audio'); a.currentTime = a.duration - 0.4; });
      await page.waitForFunction(() => document.getElementById('audio').ended, null, { timeout: 8000 }).catch(() => {});
      const heard = await page.evaluate((k) => JSON.parse(localStorage.getItem('allday-heard') || '{}')[k], 'brief:' + today);
      check(heard === 0, 'played to the end, its place is cleared, so tomorrow’s visit and the next tap start at 0:00', heard);
      check(!(await page.$eval('#panel-onair .audio .pb', (b) => b.classList.contains('is-playing'))), 'and the button is a play button again', '');
      await page.click('#panel-onair .audio .pb');
      check(await clockPast(page, 0.3) && (await audioState(page)).t < 5, 'pressing play again after the end plays it from the top', JSON.stringify(await audioState(page)));
      check(!errors.length, 'no console errors', errors.join(' | '));
      await ctx.close();
    }
    {
      /* a reader who stopped part way still picks up where they were */
      const { ctx, page, errors } = await newPage(browser, base);
      await page.addInitScript((k) => localStorage.setItem('allday-heard', JSON.stringify({ [k]: 40 })), 'brief:' + today);
      await page.goto(base + '/all-day/#onair');
      await page.waitForSelector('#panel-onair .audio .pb', { timeout: 15000 });
      await page.click('#panel-onair .audio .pb');
      const at = await page.waitForFunction(() => { const a = document.getElementById('audio'); return !a.paused && a.currentTime > 40 && a.currentTime; }, null, { timeout: 8000 }).then((h) => h.jsonValue(), () => null);
      check(at && at < 45, 'part way through (40 s), it resumes there', at);
      check(!errors.length, 'resume: no console errors', errors.join(' | '));
      await ctx.close();
    }
    {
      /* a clip that will not load says so instead of doing nothing */
      const { ctx, page } = await newPage(browser, base);
      await page.route(RAW_CLIP, (r) => r.fulfill({ status: 404, body: '' }));
      await page.goto(base + '/all-day/#onair');
      await page.waitForSelector('#panel-onair .audio .pb', { timeout: 15000 });
      await page.click('#panel-onair .audio .pb');
      await page.waitForFunction(() => /didn’t start/.test(document.getElementById('toast')?.textContent || ''), null, { timeout: 6000 }).catch(() => {});
      check(/The audio didn’t start\. Tap play to try again\./.test(await page.$eval('#toast', (t) => t.textContent)), 'a clip that fails to load says so in a toast', await page.$eval('#toast', (t) => t.textContent));
      await page.waitForFunction(() => !document.querySelector('#panel-onair .audio .pb').classList.contains('is-playing'), null, { timeout: 3000 }).catch(() => {});
      check(!(await page.$eval('#panel-onair .audio .pb', (b) => b.classList.contains('is-playing'))), 'and the button goes back to play', '');
      await ctx.close();
    }
    /* the service worker (not registered today, so this is the source) never answers for sound */
    const sw = await readFile(path.join(APP, 'sw.js'), 'utf8');
    const guard = sw.indexOf("req.destination === 'audio'");
    check(guard > 0 && /req\.headers\.has\('range'\)/.test(sw) && guard < sw.indexOf('if (isWire(url))'), 'sw.js lets audio, video and byte ranges past before the raw.githubusercontent.com branch', '');
  });

  await group('On Air, playlists', async () => {
    /* demo: Stephen's first, then readers', newest first; Spotify and YouTube
       play in a sheet, Apple Music and SoundCloud go out */
    {
      const { ctx, page, errors } = await newPage(browser, base);
      await page.goto(base + '/all-day/?demo=1#onair');
      await page.waitForSelector('#panel-onair [data-sec="lists"]', { timeout: 8000 });
      const rows = await page.$$eval('#panel-onair [data-slot="lists"] .plrow', (rs) => rs.map((r) => [r.dataset.service, r.dataset.own || '', r.querySelector('.t').textContent]));
      const d = JSON.parse(await readFile(path.join(APP, 'data/demo/onair.json'), 'utf8')).playlists;
      const want = [...d.stephen.map((p) => [p.service, '1', p.title]), ...[...d.readers].sort((a, b) => (a.added < b.added ? 1 : -1)).map((p) => [p.service, '', p.title])];
      check(JSON.stringify(rows) === JSON.stringify(want), 'Stephen’s playlists first, then readers’, newest first', JSON.stringify(rows));
      check(await page.$$eval('#panel-onair [data-slot="lists"] [data-own] .tag-own', (t) => t.map((x) => x.textContent)).then((t) => t.length === d.stephen.length && t.every((x) => x === 'Stephen’s pick')), 'his are marked “Stephen’s pick”', '');
      check(/From readers/.test(await page.$eval('#panel-onair [data-slot="lists"]', (s) => s.innerText)), 'readers’ under their own divider', '');
      const outs = await page.$$eval('#panel-onair [data-slot="lists"] a[data-playlist]', (as) => as.map((a) => [a.closest('.plrow').dataset.service, a.target, a.rel, a.getAttribute('href')]));
      check(outs.length === 2 && outs.every((o) => /^(apple|soundcloud)$/.test(o[0]) && o[1] === '_blank' && o[2] === 'noopener' && /^https:\/\/(music\.apple|soundcloud)\.com\//.test(o[3])), 'Apple Music and SoundCloud open on their own sites, in a new tab', JSON.stringify(outs));
      const share = await page.$eval('#panel-onair [data-share-playlist]', (a) => ({ href: a.getAttribute('href'), text: a.textContent.trim() }));
      check(share.text === 'Share your playlist' && /^mailto:btownbrief@gmail\.com\?subject=A%20playlist%20for%20On%20Air&body=Playlist%20link/.test(share.href), '“Share your playlist” opens an email to the Brief, filled in', JSON.stringify(share));
      await page.click('#panel-onair .plrow[data-service="spotify"] .pillbtn');
      await page.waitForSelector('.sheet-card', { timeout: 3000 });
      check(/Spotify’s player/.test(await page.$eval('.sheet-body', (b) => b.innerText)) && !(await page.$('.sheet-body iframe')), 'demo: a Spotify playlist opens its sheet, and says the player comes in the real build', '');
      await page.keyboard.press('Escape');
      check(!errors.length, 'demo: no console errors', errors.join(' | '));
      await ctx.close();
    }
    /* live, from data/playlists.json: only real playlist links show, and the file cannot inject anything */
    {
      const SP = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
      const YT = 'https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG';
      const file = {
        stephen: [
          { title: 'Fall in the Old North End', by: 'Stephen', service: 'spotify', url: SP, note: 'Porch songs.', added: '2026-10-12' },
          { title: 'TODO: the playlist’s name', by: 'Stephen', service: 'youtube', url: 'TODO: paste the YouTube playlist link', note: 'TODO', added: 'TODO' },
          { title: 'Burlington bands, live', by: 'Stephen', service: 'youtube', url: YT, note: '', added: '2026-10-09' },
        ],
        readers: [
          { title: '<img src=x onerror="window.__xss=1">Mine', by: '<b>Sam</b>', service: 'spotify', url: 'https://open.spotify.com/playlist/0123456789abcdefABCDEF', note: '<script>window.__xss=2</script>', added: '2026-10-16' },
          { title: 'Script link', by: 'X', service: 'spotify', url: 'javascript:window.__xss=3', note: '', added: '2026-10-15' },
          { title: 'Quote break', by: 'X', service: 'spotify', url: SP + '"><img src=x onerror=window.__xss=4>', note: '', added: '2026-10-15' },
          { title: 'Plain http', by: 'X', service: 'youtube', url: 'http://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', note: '', added: '2026-10-15' },
          { title: 'Wrong service', by: 'X', service: 'apple', url: SP, note: '', added: '2026-10-15' },
          { title: 'Unknown service', by: 'X', service: 'myspace', url: 'https://myspace.com/x', note: '', added: '2026-10-15' },
          { title: 'Inherited service', by: 'X', service: 'constructor', url: 'https://example.com/anything', note: '', added: '2026-10-15' },
          { title: 'A video, not a playlist', by: 'X', service: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', note: '', added: '2026-10-15' },
        ],
      };
      const { ctx, page, errors } = await newPage(browser, base, { routes: [[/\/all-day\/data\/playlists\.json/, file]] });
      await page.route(/open\.spotify\.com\/embed|youtube-nocookie\.com\/embed/, (r) => r.fulfill({ status: 200, body: '<!doctype html><title>player</title>', contentType: 'text/html' }));
      await page.goto(base + '/all-day/#onair');
      await page.waitForSelector('#panel-onair [data-sec="lists"]', { timeout: 15000 });
      await page.waitForSelector('#panel-onair [data-sec="past"]', { timeout: 15000 });
      const rows = await page.$$eval('#panel-onair [data-slot="lists"] .plrow', (rs) => rs.map((r) => r.querySelector('.t').textContent));
      check(JSON.stringify(rows) === JSON.stringify(['Fall in the Old North End', 'Burlington bands, live', '<img src=x onerror="window.__xss=1">Mine']),
        'only real playlist links show: a TODO placeholder, javascript:, a broken quote, http, the wrong service, an unknown or inherited one (“constructor”) and a single video are all left out', JSON.stringify(rows));
      await page.waitForTimeout(300);
      const xss = await page.evaluate(() => ({ flag: window.__xss || 0, imgs: document.querySelectorAll('#panel-onair [data-slot="lists"] img').length, scripts: document.querySelectorAll('#panel-onair [data-slot="lists"] script, #panel-onair [data-slot="lists"] b').length }));
      check(!xss.flag && !xss.imgs && !xss.scripts, 'a title, a name and a note from the file are text, never markup', JSON.stringify(xss));
      check(await page.$$eval('#subnav .chip', (cs) => cs.map((c) => c.dataset.chip)).then((c) => c.indexOf('lists') === c.indexOf('pods') + 1), 'the Playlists chip sits after Podcasts', '');

      /* play the Brief, then open a playlist: one sound at a time */
      await page.click('#panel-onair .audio .pb');
      await clockPast(page, 0.2);
      await page.click('#panel-onair .plrow[data-service="spotify"] .t');
      await page.waitForSelector('.sheet-body iframe', { timeout: 3000 }).catch(() => {});
      const sp = await page.evaluate(() => { const f = document.querySelector('.sheet-body iframe'); const r = f && f.getBoundingClientRect(); return f && { src: f.src, h: Math.round(r.height), title: f.title, link: document.querySelector('.sheet-body a.btn')?.getAttribute('href') }; });
      check(sp && sp.src === 'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M?theme=0' && sp.h >= 300, 'a tap on a Spotify playlist opens Spotify’s player for it in a sheet', JSON.stringify(sp));
      check(sp && sp.link === SP, 'with a link out to Spotify', JSON.stringify(sp));
      check(await page.evaluate(() => document.getElementById('audio').paused && document.getElementById('player').hidden), 'opening a player stops the Brief: one sound at a time', '');
      await page.keyboard.press('Escape');
      await page.click('#panel-onair .plrow[data-service="youtube"] .pillbtn');
      await page.waitForSelector('.sheet-body iframe', { timeout: 3000 }).catch(() => {});
      const yt = await page.evaluate(() => { const f = document.querySelector('.sheet-body iframe'); const r = f && f.getBoundingClientRect(); return f && { src: f.src, ratio: r.width / r.height }; });
      check(yt && yt.src === 'https://www.youtube-nocookie.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG&rel=0&playsinline=1' && Math.abs(yt.ratio - 16 / 9) < 0.05, 'a YouTube playlist plays in YouTube’s player, 16:9', JSON.stringify(yt));
      await page.keyboard.press('Escape');
      check(!errors.length, 'live: no console errors', errors.join(' | '));
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
    const lb = gmPanel + ' [data-board="trivia-ladder"]';
    const label = await page.$eval(lb, (b) => b.parentNode.querySelector('.gm-lb-label').textContent);
    check(label === 'Top scores · Trivia Ladder' && await page.$eval(lb, (b) => !!b.parentNode.querySelector('.lrow .t')), 'a board hangs under its game’s headline, labelled “Top scores” with the game’s name', label);
    check(await page.$$eval(lb + ' .r', (n) => n.length) === 5, 'five rows to start', '');
    await page.click(gmPanel + ' [data-more="trivia-ladder"]');
    check(await page.$$eval(lb + ' .r', (n) => n.length) === 10 && !(await page.$(gmPanel + ' [data-more="trivia-ladder"]')), 'and “Show top 10” opens the rest of the top ten', '');
    check(/No scores yet:/.test(await gmText(page)), 'boards with no scores yet are named in one line', '');
    await page.click(gmPanel + ' [data-group="arcade-action"]');
    check(/FILED!? \(didn’t load\)/i.test(await gmText(page)), 'a board that failed says so, and the rest still draw', '');

    await findMe(page, 'Nobody Here');
    const none = await page.$eval(gmPanel + ' [data-you]', (n) => n.innerText);
    check(/No score this month under/.test(none) && /Nobody Here/.test(none), 'a name on no board says so plainly', none);
    check(await page.$$eval(gmPanel + ' [data-me]', (n) => n.length) === 0, 'and marks nothing', '');

    await page.click(gmPanel + ' [data-you] button');
    await findMe(page, 'Juniper');
    check(await page.$eval(gmPanel + ' [data-group].on', (b) => b.dataset.group) === 'yours', 'with a name on the boards, Yours opens first', '');
    const marked = await page.$$eval(gmPanel + ' [data-me]', (n) => n.map((x) => x.closest('[data-board]')?.dataset.board + ':' + x.querySelector('.rank').textContent));
    check(JSON.stringify(marked.sort()) === JSON.stringify(['btown-wordle:3', 'trivia-ladder:15']), 'after the name, the reader’s rows are marked, matched without case or spaces', JSON.stringify(marked));
    check(/outside the top ten/.test(await page.$eval(gmPanel + ' [data-board="trivia-ladder"] [data-me]', (n) => n.innerText)), 'a place past tenth is shown, and called that', '');
    const said = await page.$eval(gmPanel + ' [data-you]', (n) => n.innerText);
    check(/on 2 boards/.test(said) && /2 players use that name\.$/.test(said.split('\n')[0].trim()), 'two different players under one name: it says so, in one count', said);
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
    /* live, before nn-ROUND4.sql: the arcade still leads, the board is empty and offers no posting */
    check(await page.$eval(gmPanel + ' [data-sec]', (n) => n.dataset.sec) === 'quiz' && await page.$$eval(gmPanel + ' [data-sec]', (n) => n[1].dataset.sec) === 'arcade' && await page.$$eval(gmPanel + ' .gm-cab', (n) => n.length) === 5, 'live: the News Quiz, then the arcade’s cabinets, come first', '');
    check(/Nobody’s posted yet/.test(await page.$eval(gmPanel + ' [data-slot="playing"]', (n) => n.innerText)) && !(await page.$(gmPanel + ' [data-say]')) && !(await page.$(gmPanel + ' [data-addlfg]')), 'live, older server: an empty poll and no posting until the board can take it', '');
    check(supabase.some((u) => /nn_posts_list/.test(u)) && !supabase.some((u) => /nn_handles_recent/.test(u)), 'it reads the games board; signed out, it never asks for gamertags', supabase.filter((u) => /nn_/.test(u)).join(', '));
    check(!!(await page.$(gmPanel + ' [data-tags="out"]')), 'signed out: the gamertags ask for a sign-in', '');
    /* the one board stubbed to fail logs its 500, once per load; nothing else may */
    const other = errors.filter((e) => !/status of 500/.test(e));
    check(!other.length, 'no console errors beyond the board stubbed to fail', other.join(' | '));
    await ctx.close();
  });

  await group('Games, challenge fails soft', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    /* a one-player game: never on the allowlist, whatever the Hangout adds */
    await page.goto(base + '/all-day/#games/challenge:pothole-patrol');
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
    check(/No room games right now/.test(await w.page.$eval(gmPanel + ' [data-challenge]', (n) => n.innerText)) && !(await w.page.$(gmPanel + ' [data-challenge] [data-host]')), 'with no game able to host, it says so instead of offering a dead button', '');
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
    await a.page.waitForSelector(gmPanel + ' [data-sec="arcade"]', { timeout: 15000 });
    await a.page.waitForSelector('#toast:not([hidden])', { timeout: 6000 }).catch(() => {});
    check(/Nothing new this month/.test(await a.page.$eval('#toast', (t) => t.textContent)), 'nothing within 30 days: #games/new says “nothing new this month”', '');
    check(!(await a.page.$(gmPanel + ' [data-arcade] [data-chip="new"]')) && !(await a.page.$(gmPanel + ' .gm-new')), 'and there is no New chip and no New tag', '');
    await a.ctx.close();
    const fresh = await catalogAged(3);
    const b = await newPage(browser, base, { routes: [[/\/data\/games-catalog\.json/, fresh]] });
    await b.page.goto(base + '/all-day/#games/new');
    await b.page.waitForSelector(gmPanel + ' [data-arcade] [data-chip="new"].on', { timeout: 15000 });
    await b.page.click(gmPanel + ' [data-allgames]');
    const keys = await b.page.$$eval(gmPanel + ' .gm-grid .gm-cab', (n) => n.map((x) => x.dataset.k));
    const want = fresh.games.filter((g) => g.live && g.slug !== 'news-quiz' && g.live_since > dayMinus(etKey(Date.now()), 30)).map((g) => 'cab:' + g.slug);
    check(keys.length > 4 && JSON.stringify(keys) === JSON.stringify(want), 'within 30 days: the New chip holds those games, newest first, every one after “All”', keys.length + ' vs ' + want.length);
    check(await b.page.$$eval(gmPanel + ' .gm-grid .gm-cab .gm-new', (n) => n.length) === want.length, 'and each wears a New tag', '');
    check(b.page.url().endsWith('#games/new'), 'a #games/new link lands there', b.page.url());
    check(!a.errors.length && !b.errors.length, 'no console errors', a.errors.concat(b.errors).join(' | '));
    await b.ctx.close();
  });

  await group('Games, the arcade up front', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#games');
    await page.waitForSelector(gmPanel + ' .gm-cab.feat', { timeout: 15000 });
    const order = await page.$$eval(gmPanel + ' [data-sec]', (n) => n.map((x) => x.dataset.sec));
    check(JSON.stringify(order.slice(0, 6)) === JSON.stringify(['quiz', 'arcade', 'playing', 'lfg', 'tags', 'vr']) && order.indexOf('board') > order.indexOf('challenge'),
      'the News Quiz, then the games, then the people, then VR; the leaderboard below', order.join(' / '));
    const demo = await gamesDemo();
    const live = demo.catalog.games.filter((g) => g.live);
    const cabs = await page.$$eval(gmPanel + ' .gm-cab', (n) => n.map((x) => ({ k: x.dataset.k, play: x.querySelector('.gm-acts a').href, scr: x.querySelector('.gm-scr').href, inv: x.querySelector('[data-invite]').getAttribute('href') })));
    check(cabs.length === 5 && cabs[0].k === 'cab:pothole-patrol', 'one wide cabinet (the newest game) and four more', cabs.map((c) => c.k).join(', '));
    /* the newest game is a row with a small picture, not a banner; every cabinet with a picture shows a real one */
    const feat = await page.$eval(gmPanel + ' .gm-cab.feat', (n) => { const c = n.getBoundingClientRect(), s = n.querySelector('.gm-scr').getBoundingClientRect(); return { cw: c.width, sw: s.width, sh: s.height, ch: c.height }; });
    check(feat.sw < feat.cw / 2 && feat.sh <= 120, 'the newest game’s picture sits beside its words, small', JSON.stringify(feat));
    const grid = await page.$eval(gmPanel + ' .gm-grid .gm-scr', (n) => { const b = n.getBoundingClientRect(); return b.height / b.width; });
    check(grid < 0.7, 'the grid’s screens are shorter than 4:3', String(grid));
    const shots = await readdir(path.join(APP, 'assets/games'));
    await page.click(gmPanel + ' [data-allgames]');
    await page.waitForFunction((p) => [...document.querySelectorAll(p + ' .gm-scr.shot img')].every((i) => i.complete), gmPanel, { timeout: 8000 }).catch(() => {});
    const pics = await page.$$eval(gmPanel + ' .gm-cab, ' + gmPanel + ' .gm-quiz', (n) => n.map((x) => { const i = x.querySelector('.gm-scr img'); return { slug: x.dataset.slug, img: i ? i.getAttribute('src') : '', w: i ? i.naturalWidth : 0, emo: !!x.querySelector('.gm-emo'), alt: i ? i.getAttribute('alt') : null }; }));
    const want = (slug) => shots.includes(slug + '.webp');
    check(pics.length > 5 && pics.every((p) => (want(p.slug) ? p.img === 'assets/games/' + p.slug + '.webp' && p.w === 480 && !p.emo && p.alt === '' : !p.img && p.emo)),
      'a game with a gameplay picture shows it (480 wide, loaded, decorative); one without keeps its emoji', JSON.stringify(pics.filter((p) => (want(p.slug) ? p.w !== 480 : !p.emo))));
    check(pics.filter((p) => p.img).length >= pics.length - 2, 'nearly every demo cabinet has a picture', pics.filter((p) => !p.img).map((p) => p.slug).join(', '));
    const src = await readFile(path.join(APP, 'js/modes/games.js'), 'utf8');
    const listed = [...(/const SHOTS = new Set\(\[([\s\S]*?)\]\)/.exec(src) || ['', ''])[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]).sort();
    check(JSON.stringify(listed) === JSON.stringify(shots.filter((f) => f.endsWith('.webp')).map((f) => f.replace(/\.webp$/, '')).sort()) && shots.every((f) => f.endsWith('.webp')),
      'SHOTS in games.js names exactly the pictures in assets/games', listed.length + ' listed, ' + shots.length + ' files');
    await page.click(gmPanel + ' [data-arcade] [data-chip="all"]');
    /* a picture that doesn't load falls back to the game's emoji, New tag and all */
    const miss = await newPage(browser, base, { routes: [[/\/assets\/games\/pothole-patrol\.webp/, 'not a picture']] });   // answered as JSON: the image can't decode
    await miss.page.goto(base + '/all-day/?demo=1#games');
    await miss.page.waitForSelector(gmPanel + ' .gm-cab.feat .gm-emo', { timeout: 8000 }).catch(() => {});
    const fb = await miss.page.$eval(gmPanel + ' .gm-cab.feat .gm-scr', (n) => ({ img: !!n.querySelector('img'), emo: !!n.querySelector('.gm-emo'), shot: n.classList.contains('shot'), tag: !!n.querySelector('.gm-new') }));
    check(!fb.img && fb.emo && !fb.shot && fb.tag, 'a picture that fails to load gives way to the emoji, New tag kept', JSON.stringify(fb));
    await miss.ctx.close();
    check(cabs.every((c) => c.play === 'https://play.btownbrief.com/' + c.k.slice(4) + '/' && c.scr === c.play), 'the screen and Play both open the game on the arcade', JSON.stringify(cabs[0]));
    const body = decodeURIComponent(cabs[0].inv.replace(/^sms:\?&body=/, ''));
    check(/^sms:\?&body=/.test(cabs[0].inv) && body === 'Play Pothole Patrol with me? https://play.btownbrief.com/pothole-patrol/', 'Invite is a text message with the game’s link and no number', cabs[0].inv);
    check(/Dev K\./.test(await page.$eval(gmPanel + ' .gm-cab.feat', (n) => n.innerText)), 'a cabinet shows this month’s champ', '');
    await page.click(gmPanel + ' [data-allgames]');
    check(await page.$$eval(gmPanel + ' .gm-cab', (n) => n.length) === live.length, '“All n games” opens every live game', '');
    const chipKeys = await page.$$eval(gmPanel + ' [data-arcade] .chip', (n) => n.map((x) => x.dataset.chip));
    check(chipKeys[0] === 'all' && chipKeys[1] === 'new' && chipKeys.includes('out') && chipKeys.includes('board-card'), 'chips: All, New, the arcade’s sections, Out in Burlington', chipKeys.join(', '));
    await page.click(gmPanel + ' [data-arcade] [data-chip="out"]');
    const out = await page.$$eval(gmPanel + ' .gm-cab', (n) => n.map((x) => x.dataset.slug));
    check(JSON.stringify(out.sort()) === JSON.stringify(live.filter((g) => g.where === 'out').map((g) => g.slug).sort()) && !(await page.$(gmPanel + ' .gm-cab.feat')), 'Out in Burlington: only the games that need real streets', out.join(', '));
    await page.click(gmPanel + ' [data-arcade] [data-chip="party-night"]');
    check(JSON.stringify(await page.$$eval(gmPanel + ' .gm-cab', (n) => n.map((x) => x.dataset.slug))) === '["btown-party"]', 'Party Night is a chip now, with its game', '');
    /* the old links still land: #games/party opens that chip, new:<slug> flashes the cabinet */
    await page.goto(base + '/all-day/?demo=1#games/new:tap-the-maple');
    check(await flashes(page, 'cab:tap-the-maple'), 'an old #games/new:<slug> link lands on the cabinet', '');
    await page.goto(base + '/all-day/?demo=1#games/party');
    await page.reload();
    await page.waitForSelector(gmPanel + ' [data-arcade] [data-chip="party-night"].on', { timeout: 8000 }).catch(() => {});
    check(!!(await page.$(gmPanel + ' [data-arcade] [data-chip="party-night"].on')), '#games/party opens the arcade on Party Night', '');
    /* on a screen without touch, Invite hands the words to the share sheet, or copies them */
    await page.evaluate(() => { window.__copied = null; Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; });
    await page.click(gmPanel + ' .gm-cab [data-invite]');
    check(/with me\? https:\/\/play\.btownbrief\.com\/btown-party\/$/.test(await page.evaluate(() => window.__copied || '')), 'without touch, Invite copies the same words', await page.evaluate(() => window.__copied));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Games, the News Quiz leads', async () => {
    /* live: the repo's own catalog lists the quiz; the demo's does not, and the card is there either way */
    for (const demo of [false, true]) {
      const { ctx, page, errors } = await newPage(browser, base);
      await page.goto(base + '/all-day/' + (demo ? '?demo=1' : '') + '#games');
      await page.waitForSelector(gmPanel + ' .gm-quiz', { timeout: 15000 });
      await page.waitForSelector(gmPanel + ' [data-sec="arcade"]', { timeout: 15000 });
      const tag = demo ? 'demo: ' : 'live: ';
      const q = await page.$eval(gmPanel + ' .gm-quiz', (n) => ({
        name: n.querySelector('.gm-name').textContent, pitch: n.querySelector('.gm-pitch').textContent, k: n.dataset.k,
        hrefs: [...n.querySelectorAll('a')].filter((a) => !a.dataset.invite).map((a) => a.href), play: n.querySelector('.pillbtn.on').textContent,
        top: n.getBoundingClientRect().top,
        arcadeTop: document.querySelector('#panel-games [data-sec="arcade"]').getBoundingClientRect().top,
      }));
      check(q.name === 'News Quiz' && q.hrefs.length === 2 && q.hrefs.every((h) => h === 'https://play.btownbrief.com/news-quiz/'), tag + 'the News Quiz card opens the quiz on the arcade, from its picture and its button', JSON.stringify(q));
      check(q.play === 'Take the quiz' && /^Five questions from this week’s Brief\./.test(q.pitch) && q.pitch.length < 60, tag + 'one short line says what it is, and the button says what it does', q.pitch);
      check(q.top < q.arcadeTop && await page.$eval(gmPanel + ' [data-sec]', (n) => n.dataset.sec) === 'quiz', tag + 'it sits above the arcade, first on the tab', JSON.stringify(q));
      await page.goto(base + '/all-day/' + (demo ? '?demo=1' : '') + '#games/cab:news-quiz');
      await page.reload();
      /* live, the champions file can land after the catalog and redraw the card mid-flash (cabinets do the same), so only the demo, which has everything at once, can watch the flash */
      check(demo ? await flashes(page, 'cab:news-quiz') : q.k === 'cab:news-quiz' && !!(await page.$(gmPanel + ' .gm-quiz[data-k="cab:news-quiz"]')), tag + 'an old #games/cab:news-quiz link still lands on the card', q.k);
      await page.click(gmPanel + ' [data-allgames]').catch(() => {});
      check(await page.$$eval(gmPanel + ' .gm-cab[data-slug="news-quiz"]', (n) => n.length) === 0 && await page.$$eval(gmPanel + ' [data-arcade] .chip', (n) => n.every((c) => c.dataset.chip !== 'news-quiz')), tag + 'and it is not also an arcade cabinet', '');
      check(!errors.length, tag + 'no console errors', errors.join(' | '));
      await ctx.close();
    }
    /* a retired quiz (the catalog says it is not live) is not featured */
    const cat = await catalogAged(40);
    cat.games.forEach((g) => { if (g.slug === 'news-quiz') g.live = false; });
    const w = await newPage(browser, base, { routes: [[/\/data\/games-catalog\.json/, cat]] });
    await w.page.goto(base + '/all-day/#games');
    await w.page.waitForSelector(gmPanel + ' .gm-cab', { timeout: 15000 });
    check(!(await w.page.$(gmPanel + ' .gm-quiz')), 'a quiz the catalog has retired is not featured', '');
    await w.ctx.close();
  });

  await group('Games, one row per name', async () => {
    const rows = (list) => list.map(([name, score], i) => ({ name, score, player_id: '00000000-0000-4000-8000-' + String(i).padStart(12, '0') }));
    const rpc = (fn, body) => {
      if (fn !== 'get_leaderboard') return undefined;
      /* the same people over and over, in other cases and with stray spaces; the first of each is the best */
      if (body.p_game === 'btown-wordle') return rows([['ADA W.', 900], ['Cy F.', 800], ['ada w.', 700], ['Juniper', 600], [' cy   f. ', 500], ['Ada  W.', 400], ['Max T.', 300]]);
      /* twelve rows, but only seven different players: the top ten must fill from the players behind the repeats */
      if (body.p_game === 'trivia-ladder') return rows([['P1', 990], ['p1', 980], ['P2', 970], ['P2 ', 960], ['P3', 950], ['P4', 940], ['P5', 930], ['p5', 920], ['P6', 910], ['P7', 900], ['P8', 890], ['P9', 880], ['P10', 870], ['P11', 860], ['P12', 850], ['p12', 840]]);
      if (body.p_game === 'btown-riddle') return rows([['R1', 700], ['r1', 690], ['R2', 680], ['R3', 670], ['R4', 660], ['R5', 650], ['R6', 640], ['R7', 630]]);
      return [];
    };
    const champions = JSON.parse(JSON.stringify((await gamesDemo()).champions));
    champions.royalty = ['Priya N.', 'priya n.', 'Dev K.', 'Kara M.', 'KARA M.', 'Ivy R.', 'Ada W.', 'Max T.'].map((name, i) => ({ name, crowns: 5 - i % 4, podiums: 6, boards: 7 }));
    const { ctx, page, errors } = await newPage(browser, base, { rpc, champions });
    await page.goto(base + '/all-day/#games');
    await page.waitForSelector(gmPanel + ' [data-you="ask"]', { timeout: 15000 });
    await page.waitForFunction((p) => !/Loading \d+ boards/.test(document.querySelector(p).innerText), gmPanel, { timeout: 15000 });
    await page.click(gmPanel + ' [data-group="daily-puzzles"]');
    const board = (slug) => page.$$eval(gmPanel + ' [data-board="' + slug + '"] .r', (n) => n.map((r) => r.querySelector('.rank').textContent + ' ' + r.querySelector('.t').textContent.trim() + ' ' + r.querySelector('.sc').textContent));
    check(JSON.stringify(await board('btown-wordle')) === JSON.stringify(['1 ADA W. 900', '2 Cy F. 800', '3 Juniper 600', '4 Max T. 300']),
      'each name once, best score first, in the best row’s own spelling, whatever the case or spacing', JSON.stringify(await board('btown-wordle')));
    const names = await board('trivia-ladder');
    check(names.length === 5 && names.join('|') === ['1 P1 990', '2 P2 970', '3 P3 950', '4 P4 940', '5 P5 930'].join('|'), 'a repeat takes no place on the board: ranks run 1, 2, 3 with no gaps', names.join(' | '));
    await page.click(gmPanel + ' [data-more="trivia-ladder"]');
    const ten = await board('trivia-ladder');
    check(ten.length === 10 && ten[9] === '10 P10 870', 'the top ten fills from the players behind the repeats', ten.join(' | '));
    check(await page.$eval(gmPanel + ' [data-more="btown-riddle"]', (b) => b.textContent.trim()) === 'Show all 7' && await page.$eval(gmPanel + ' [data-more="trivia-ladder"]', () => true).catch(() => false) === false, 'a board of six to nine players offers “Show all 7”, not a top ten it does not have', '');
    /* the reader's own rows are counted on the deduped board, so the rank they see is the rank they have */
    await findMe(page, 'ada w.');
    const me = await page.$$eval(gmPanel + ' [data-me]', (n) => n.map((x) => x.querySelector('.rank').textContent));
    check(JSON.stringify(me) === '["1"]', 'a name that repeated is found once, at its best place', JSON.stringify(me));
    check(/on 1 board this month, best 1st/.test(await page.$eval(gmPanel + ' [data-you]', (n) => n.innerText)) && !/players use that name/.test(await page.$eval(gmPanel + ' [data-you]', (n) => n.innerText)), 'and it is not counted as several players', '');
    const royal = await page.$$eval(gmPanel + ' [data-royalty] .r .t', (n) => n.map((x) => x.textContent.trim()));
    check(JSON.stringify(royal) === JSON.stringify(['Priya N.', 'Dev K.', 'Kara M.', 'Ivy R.', 'Ada W.']), 'the all-arcade leaders show each name once too', JSON.stringify(royal));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Games, what people are playing', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#games/playing');
    await page.waitForSelector(gmPanel + ' .gm-poll', { timeout: 15000 });
    const rows = await page.$$eval(gmPanel + ' .gm-poll', (n) => n.map((x) => ({ t: x.querySelector('.t').innerText, n: Number(x.querySelector('.gm-metoo .n').textContent || 0) })));
    check(rows.length === 8 && rows.every((r, i) => !i || rows[i - 1].n >= r.n), 'a poll: the most “me too”s first, eight before “more”', JSON.stringify(rows.map((r) => r.n)));
    check(/EA Sports FC 26/.test(rows[0].t) && /PS5/.test(rows[0].t), 'each row is the game and its platform', rows[0].t);
    await page.click(gmPanel + ' [data-plats] [data-chip="vr"]');
    const vr = await page.$$eval(gmPanel + ' .gm-poll .t', (n) => n.map((x) => x.innerText));
    check(vr.length === 2 && vr.every((t) => /VR/.test(t)), 'a platform chip narrows the poll', vr.join(' / '));
    const first = gmPanel + ' .gm-poll:first-child [data-metoo]';
    const before = Number(await page.$eval(first + ' .n', (n) => n.textContent || 0));
    await page.click(first);
    await page.waitForTimeout(200);
    check(await page.$eval(first, (b) => b.getAttribute('aria-pressed')) === 'true' && Number(await page.$eval(first + ' .n', (n) => n.textContent)) === before + 1, '“Me too” is a vote, signed out too', '');
    const widths = () => page.$$eval(gmPanel + ' .gm-poll', (n) => n.map((x) => parseFloat(x.style.getPropertyValue('--w'))));
    const w1 = await widths();
    await page.click(first);
    await page.waitForTimeout(200);
    check(Number(await page.$eval(first + ' .n', (n) => n.textContent || 0)) === before, 'and a second tap takes it back', '');
    const w0 = await widths();
    check(w0[0] === 100 && w1[0] === 100 && w1[1] < w0[1] && w0.every((w, i) => !i || w <= w0[i - 1]), 'each bar is drawn against the most-played game, and it moves with a vote', JSON.stringify([w0, w1]));
    /* signed out, the line asks you to sign in instead of posting */
    await page.fill(gmPanel + ' [data-say] input', 'Hades II');
    await page.selectOption(gmPanel + ' [data-say] select', 'pc');
    await page.click(gmPanel + ' [data-say] button[type="submit"]');
    await page.waitForSelector('#sheet:not([hidden])', { timeout: 4000 }).catch(() => {});
    check(!!(await page.$('#sheet:not([hidden])')), 'signed out, Post opens Settings to sign in', '');
    await page.click('#sheet .sheet-head .iconbtn');
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.setProfile({ display_name: 'Juniper' })));
    await page.waitForTimeout(300);
    await page.fill(gmPanel + ' [data-say] input', '<img src=x onerror="window.__xss=1">Hades II');
    await page.selectOption(gmPanel + ' [data-say] select', 'pc');
    await page.click(gmPanel + ' [data-say] button[type="submit"]');
    await page.waitForFunction((p) => [...document.querySelectorAll(p + ' .gm-poll .t')].some((t) => /Hades II/.test(t.innerText)), gmPanel, { timeout: 6000 }).catch(() => {});
    const mine = await page.$$eval(gmPanel + ' .gm-poll', (n) => n.filter((x) => /Hades II/.test(x.innerText)).map((x) => ({ img: !!x.querySelector('img'), del: !!x.querySelector('[data-act="bdelete"]'), t: x.querySelector('.t').innerText })));
    check(mine.length === 1 && !mine[0].img && /<img/.test(mine[0].t) && mine[0].del, 'posted: it shows as text, never markup, with a delete on your own row', JSON.stringify(mine));
    check(await page.evaluate(() => !window.__xss), 'and nothing ran', '');
    /* Balatro has the fewest "me too"s: ninth, behind "more" on a fresh visit */
    const k = await page.$$eval(gmPanel + ' .gm-poll', (n) => n.find((x) => /Balatro/.test(x.innerText)).dataset.k);
    await page.goto(base + '/all-day/?demo=1#games/' + k);
    await page.reload();
    check(await flashes(page, k), 'a #games/b-<id> link lands on its row, even one behind “more”', k);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Games, looking for a group', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#games/lfg');
    await page.waitForSelector(gmPanel + ' [data-lfg]', { timeout: 15000 });
    const cards = await page.$$eval(gmPanel + ' [data-lfg]', (n) => n.map((c) => ({ vote: c.querySelector('[data-act="bvote"]').innerText.trim(), meta: c.querySelector('.b-meta').innerText, inv: c.querySelector('[data-invite]').getAttribute('href'), k: c.dataset.k })));
    check(cards.length === 4 && cards.every((c) => /^I’m in/.test(c.vote)), 'each group is a board card whose vote reads “I’m in”', cards.map((c) => c.vote).join(' / '));
    const v = cards.find((c) => /Valorant/.test(c.meta));
    const body = decodeURIComponent(v.inv.replace(/^sms:\?&body=/, ''));
    check(/^Want in\? Valorant on PC, Weeknights after 9\. http:\/\/[^ ]+\?demo=1#games\/b-[\w-]+$/.test(body) && body.endsWith('#games/' + encodeURIComponent(v.k)), 'Invite by text: the game, the platform, when, and the link back to the post', body);
    check(!/[\n\r]/.test(body) && /^sms:\?&body=[^&#]*$/.test(v.inv), 'the message is encoded whole: no raw &, # or line break can end it', v.inv);
    check(!(await page.$(gmPanel + ' [data-addlfg]')) === false, '“Find a group” is offered', '');
    await page.click(gmPanel + ' [data-addlfg]');
    await page.waitForSelector('#sheet:not([hidden])', { timeout: 4000 });
    check(/Sign in to post/.test(await page.$eval('#sheet', (n) => n.innerText)), 'signed out, it asks for a sign-in first', '');
    /* a post built to break the invite: a direction override, a line break, and an emoji right at the 60-character cut */
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.setProfile({ display_name: 'Juniper' })
      .then(() => b.create('games', { kind: 'lfg', title: 'Bad invite', meta: { game: 'a'.repeat(59) + String.fromCodePoint(0x1F3AE), platform: 'pc', when: 'now' + String.fromCharCode(0x202E) + 'evil\nline' } }))));
    await page.waitForFunction((p) => [...document.querySelectorAll(p + ' [data-lfg]')].some((c) => /Bad invite/.test(c.innerText)), gmPanel, { timeout: 6000 }).catch(() => {});
    const bad = await page.$$eval(gmPanel + ' [data-lfg]', (n) => n.filter((c) => /Bad invite/.test(c.innerText)).map((c) => c.querySelector('[data-invite]').getAttribute('href')));
    check(bad.length === 1 && !/%E2%80%AE|%0A|%0D/i.test(bad[0]) && decodeURIComponent(bad[0]).includes(String.fromCodePoint(0x1F3AE)), 'an invite drops direction overrides and line breaks, and keeps an emoji whole', bad.join(''));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Games, gamertags', async () => {
    const { ctx, page, errors, supabase } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#games/tags');
    await page.waitForSelector(gmPanel + ' [data-tags="out"]', { timeout: 15000 });
    check(/Sign in/.test(await page.$eval(gmPanel + ' [data-tags="out"]', (n) => n.innerText)) && !(await page.$(gmPanel + ' .gm-h')), 'signed out: one line and Sign in, and no handles', '');
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.waitForSelector(gmPanel + ' [data-tags="ok"]', { timeout: 6000 });
    const people = await page.$$eval(gmPanel + ' .gm-tag', (n) => n.map((x) => ({ name: x.querySelector('.t').innerText, kinds: [...x.querySelectorAll('.gm-h')].map((h) => h.dataset.kind) })));
    const kinds = new Set(people.flatMap((p) => p.kinds));
    check(people.length >= 3 && [...kinds].every((k) => ['psn', 'xbox', 'steam', 'switch', 'discord', 'epic', 'riot', 'chess'].includes(k)), 'signed in: members with gaming handles, and only their gaming handles', JSON.stringify(people));
    const text = await page.$eval(gmPanel + ' [data-sec="tags"]', (n) => n.parentNode.innerText);
    check(!/maya\.outside|kara\.thrifts|strava|Instagram/i.test(text), 'no Instagram, Strava or other non-gaming handle shows here', '');
    check(!people.some((p) => /Tom A\./.test(p.name)), 'a member whose switch is off is not listed', '');
    check(!/DevKplays/.test(await page.evaluate(() => JSON.stringify(localStorage))), 'nothing here keeps a handle on the device', '');
    await page.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; });
    await page.click(gmPanel + ' .gm-h[data-kind="psn"]');
    check(await page.evaluate(() => window.__copied) === 'DevKplays', 'a handle chip copies the handle', await page.evaluate(() => window.__copied));
    await page.click(gmPanel + ' [data-addtag]');
    await page.waitForFunction(() => [...document.querySelectorAll('#sheet [data-handles] details')].some((d) => d.open && /Games/.test(d.querySelector('summary').textContent)), null, { timeout: 6000 }).catch(() => {});
    const fold = await page.evaluate(() => [...document.querySelectorAll('#sheet [data-handles] details')].map((d) => d.querySelector('summary').textContent + ':' + d.open));
    check(fold.includes('Games:true') && await page.evaluate(() => document.activeElement && document.activeElement.name === 'h:psn'), '“Add your gamertag” opens the profile at its Games fold, on the first box', fold.join(', '));
    check(!supabase.length, 'the demo never calls Supabase', supabase.join(', '));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Games, VR corner', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#games/vr');
    await page.waitForSelector(gmPanel + ' [data-invr]', { timeout: 15000 });
    const picks = await page.$$eval(gmPanel + ' .gm-vr', (n) => n.map((x) => [x.querySelector('.t').textContent, x.querySelector('a').href, x.querySelector('a').target]));
    check(picks.length === 3 && picks.every(([, h, t]) => /^https:\/\/www\.meta\.com\/experiences\/[a-z0-9-]+\/\d+\/$/.test(h) && t === '_blank'), 'three picks, each on its official Meta store page', JSON.stringify(picks));
    check(/Thrill of the Fight/.test(picks[0][0]) && /Eleven Table Tennis/.test(picks[1][0]) && /GOLF\+/.test(picks[2][0]), 'boxing, ping pong and golf: Stephen’s three', picks.map((p) => p[0]).join(' / '));
    check(!/First Encounters|VR at home|Quest 3/.test(await page.$eval(gmPanel + ' [data-slot="vr"]', (n) => n.innerText)), 'no mixed-reality starter and no headset ad', '');
    check(!/\$\d|sale|% off/i.test(await page.$eval(gmPanel + ' [data-slot="vr"]', (n) => n.innerText)), 'no prices and no sale claims', '');
    check(await page.$eval(gmPanel + ' [data-invr]', (b) => b.dataset.invr) === '2', 'it counts the neighbors who posted a VR game', '');
    await page.click(gmPanel + ' [data-invr]');
    check(await page.$eval(gmPanel + ' [data-plats] .chip.on', (b) => b.dataset.chip) === 'vr', 'and that count opens the poll on VR', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Games, demo', async () => {
    const { ctx, page, errors, supabase } = await newPage(browser, base, { viewport: { width: 1280, height: 800 }, scheme: 'dark' });
    await page.goto(base + '/all-day/?demo=1#games');
    await page.waitForSelector(gmPanel + ' [data-you="ask"]', { timeout: 15000 });
    await page.waitForSelector(gmPanel + ' .gm-poll', { timeout: 15000 });
    const chipsAt = await page.$$eval('#subnav .chip', (c) => c.map((x) => x.textContent));
    check(JSON.stringify(chipsAt) === JSON.stringify(['Arcade', 'Playing', 'Groups', 'Gamertags', 'VR', 'Challenge', 'Leaderboard', 'Champions']), 'the chip row is the table of contents', chipsAt.join(' / '));
    check(await page.$$eval(gmPanel + ' [data-me]', (n) => n.length) === 0, 'before a name, nothing is marked', '');
    await findMe(page, 'Juniper');
    check(await page.$$eval(gmPanel + ' [data-me]', (n) => n.length) === 3, 'the demo reader is on three boards', '');
    check(await page.evaluate(() => localStorage.getItem('allday-arcade-name')) === null, 'the demo keeps the name to the visit', '');
    check(await page.$eval(gmPanel + ' [data-arcade] [data-chip="new"] .n', (n) => n.textContent) === '3', 'three new games', '');
    /* finding the name scrolled down the page, which tucks the subnav away; back to the top */
    await page.evaluate(() => document.querySelector('#panel-games').scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.click('#subnav .chip[data-chip="champs"]');
    await page.waitForFunction(() => { const r = document.querySelector('#panel-games [data-sec="champs"]').getBoundingClientRect(); return r.top >= 0 && r.top < 300; }, null, { timeout: 4000 }).catch(() => {});
    check(await page.evaluate(() => { const r = document.querySelector('#panel-games [data-sec="champs"]').getBoundingClientRect(); return r.top >= 0 && r.top < 300; }), 'a chip scrolls to its section', '');
    await page.evaluate(() => document.querySelector('#panel-games').scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'demo-games-desktop-dark.png') });
    check(!supabase.length, 'the demo never calls Supabase', supabase.join(', '));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Games, 390 shots', async () => {
    /* the tab top to bottom at phone width, signed in, for the PR */
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#games');
    await page.waitForSelector(gmPanel + ' .gm-poll', { timeout: 15000 });
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.waitForSelector(gmPanel + ' [data-tags="ok"]', { timeout: 6000 }).catch(() => {});
    for (const key of ['arcade', 'playing', 'lfg', 'tags', 'vr']) {
      await page.evaluate((k) => { const s = document.querySelector('#panel-games [data-sec="' + k + '"]'); const p = document.querySelector('#panel-games'); p.scrollTo(0, s.getBoundingClientRect().top + p.scrollTop - 100); }, key);
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(SHOTS, 'demo-games-390-' + key + '.png') });
    }
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

    /* Center the story before dragging: a floating bar can cover a row that
       Playwright considers visible at the viewport's bottom edge. */
    const rowAt = async (i) => { const l = page.locator('.panel:not([hidden]) .card.row').nth(i); await l.evaluate(n => n.scrollIntoView({block:'center',behavior:'instant'})); await page.waitForTimeout(250); return l.boundingBox(); };
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
    check(!/feels like/.test(wx) && /61° lake/.test(wx) && /6:06 sunset/.test(wx), 'the weather line: the lake and sunset (feels like is on the card)', wx);
    check(await page.$eval(wnPanel + ' .wx', (w) => w.getBoundingClientRect().height < 40), 'the weather line is one line at 390', '');
    check(await page.$$eval(wnPanel + ' .chips.paths .chip', (c) => c.map((x) => x.innerText).join('|')) === 'I’m broke|Get me outside|People, please|Two hours|Close by|Teach me something|Move with people', 'the seven path chips', '');
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
    check(/^(\d+ things? fit|Nothing fits) right now/.test(await page.$eval(wnPanel + ' .note.pad', (n) => n.textContent)), 'the pool line says how many things fit', '');
    await page.screenshot({ path: path.join(SHOTS, 'live-whatnow-spin.png') });
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('What Now, the missions under the spinner (demo)', async () => {
    /* Stephen, 2026-10-17: the missions live under the Spin button, no tap
       to get in. A spin that lands on a mission's own place marks that row
       and scrolls the list to it; the Missions chip is a jump down to it. */
    const { ctx, page, errors } = await newPage(browser, base, { clock: etAt(19), seed: 7, motion: 'reduce' });
    await page.goto(base + '/all-day/?demo=1#whatnow');
    await page.waitForSelector(wnPanel + ' .spin .big:not([disabled])', { timeout: 15000 });
    const order = await page.evaluate(() => {
      const p = document.querySelector('#panel-whatnow');
      const spin = p.querySelector('.spin'), list = p.querySelector('.missions');
      return { both: !!spin && !!list, below: !!spin && !!list && !!(spin.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING), rows: p.querySelectorAll('.lrow.mission:not(.club)').length, club: !!p.querySelector('.missions > .lrow.club:first-child') };
    });
    check(order.both && order.below && order.rows === 6, 'Spin opens with the whole missions list right below it', JSON.stringify(order));
    check(order.club, 'and “Run with a club” leads the list, unnumbered', JSON.stringify(order));
    check(await page.$eval('#subnav .chip.on', (b) => /Spin/.test(b.innerText)), 'and the Spin chip is the one lit', '');
    let hit = '';
    for (let i = 0; i < 40 && hit !== 'A flight at the cider bar'; i++) {
      await page.click(wnPanel + ' .spin .big');
      await page.waitForSelector(wnPanel + ' .result h3');
      hit = await page.$eval(wnPanel + ' .result h3', (h) => h.textContent);
    }
    check(hit === 'A flight at the cider bar', 'the demo spins onto mission 2’s first place', hit);
    const spun = await page.waitForFunction(() => {
      const r = document.querySelector('#panel-whatnow .lrow.spun');
      if (!r) return false;
      const b = r.getBoundingClientRect();
      return b.top >= 0 && b.bottom <= innerHeight ? r.dataset.k : false;
    }, null, { timeout: 4000 }).then((h) => h.jsonValue(), () => null);
    check(spun === 'm2', 'the spin marks its mission in the list and scrolls to it', spun);
    check(await page.$$eval(wnPanel + ' .lrow.spun', (r) => r.length) === 1, 'only that one row is marked', '');
    /* scrolled down to the mission, the mast has stepped away: back up, and it returns */
    await page.evaluate(() => document.querySelector('#panel-whatnow').scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.click('#subnav .chip[data-chip="spin"]');
    await page.click('#subnav .chip[data-chip="missions"]');
    await page.waitForTimeout(300);
    /* the demo's six missions make a short page: the list comes up as far as the panel scrolls */
    const head = await page.$eval(wnPanel + ' [data-sec="missions"]', (h) => { const p = h.closest('.panel');
      /* the mast may slide away once the panel scrolls, so measure from the top against its height, as app.jumpTo() does */
      return { y: Math.round(h.getBoundingClientRect().top), mast: document.querySelector('#mast').offsetHeight, end: p.scrollTop >= p.scrollHeight - p.clientHeight - 2, top: p.scrollTop }; });
    check(head.top > 0 && head.y >= 0 && (head.y <= head.mast + 40 || head.end), 'the Missions chip jumps down to the list, just under the mast', JSON.stringify(head));
    check(await page.$(wnPanel + ' .result h3') !== null, 'and the answer is still there above it', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('What Now, Missions (live)', async () => {
    const real = JSON.parse(await readFile(path.join(REPO, 'data/missions.json'), 'utf8'));
    /* one mission per Top 100+ entry, however long the list runs */
    const ranked = JSON.parse(await readFile(path.join(REPO, 'data/guides.json'), 'utf8')).find((g) => g.id === 'top-100').items.length;
    const N = real.missions.length;
    check(ranked > 100 && real.count === ranked && N === ranked, 'data/missions.json holds a mission for every Top 100+ entry (' + ranked + ')', N);
    const words = real.missions.map((m) => m.paragraph.split(/\s+/).length);
    check(words.every((n) => n >= 60 && n <= 120), 'every paragraph is 60 to 120 words', words.filter((n) => n < 60 || n > 120).join(', '));
    check(real.missions.every((m) => !/[—–!]/.test(m.paragraph) && real.themes.includes(m.theme) && m.places.length), 'no dashes or exclamation points, a known theme, at least one place', '');
    check(real.needs_check === real.missions.filter((m) => m.needs_check).length, 'needs_check is counted honestly (' + real.needs_check + ')', '');

    const { ctx, page, errors, supabase } = await newPage(browser, base);
    await page.goto(base + '/all-day/#whatnow/missions');
    await page.waitForSelector(wnPanel + ' .lrow.mission', { timeout: 15000 });
    const nums = await page.$$eval(wnPanel + ' .lrow.mission:not(.club) .num', (n) => n.map((x) => Number(x.textContent)));
    check(nums.length === N && nums.every((n, i) => n === i + 1), 'all of them, numbered 1 to ' + N, nums.length);
    check(/^The Top 100\+, as missions/.test(await page.$eval(wnPanel + ' [data-sec="missions"]', (h) => h.textContent.trim())), 'under the Top 100+ name', '');
    const themeChip = await page.$eval(wnPanel + ' .chips.themes .chip[data-chip="drink"] .n', (n) => Number(n.textContent));
    await page.click(wnPanel + ' .chips.themes .chip[data-chip="drink"]');
    const shown = await page.$$eval(wnPanel + ' .lrow.mission:not(.club) .s', (s) => s.map((x) => x.textContent));
    check(!(await page.$(wnPanel + ' .lrow.club')), 'a theme shows its own missions only, not the club one', '');
    check(shown.length === themeChip && shown.every((t) => /^Drink/.test(t)), 'a theme chip filters to its missions, and its count is right (' + themeChip + ')', shown.length);
    await page.click(wnPanel + ' .chips.themes .chip[data-chip="all"]');
    await page.click(wnPanel + ' .lrow[data-k="m7"] .markdone');
    check(await page.$eval(wnPanel + ' .lrow[data-k="m7"]', (r) => r.classList.contains('done')), 'Mark done marks it', '');
    await page.reload();
    await page.waitForSelector(wnPanel + ' .lrow.mission', { timeout: 15000 });
    check(await page.$eval(wnPanel + ' .lrow[data-k="m7"]', (r) => r.classList.contains('done')), 'a mission marked done survives a reload', '');
    check(new RegExp('1/' + N + '\\b').test(await page.$eval('#subnav .chip[data-chip="missions"]', (b) => b.innerText)), 'and the Missions chip counts it: 1/' + N, '');
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
    check(await page.$$eval(wnPanel + ' .lrow.mission:not(.club)', (r) => r.length) === 6, 'the demo carries six missions', '');
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

  await group('What Now, at a glance: the weather card and Happening today (demo, 2 pm)', async () => {
    /* Stephen, 2026-10-17: a weather preview in the open spot right of the
       window pills, above Spin, and a preview of the events calendar */
    const { ctx, page, errors } = await newPage(browser, base, { clock: etAt(14), seed: 3 });
    await page.goto(base + '/all-day/?demo=1#whatnow');
    await page.waitForSelector(wnPanel + ' .spin .big:not([disabled])', { timeout: 15000 });
    const card = await page.$eval(wnPanel + ' .wxcard', (a) => ({ href: a.getAttribute('href'), t: a.querySelector('.wxc-t').textContent, feels: a.querySelector('.wxc-feels')?.textContent,
      hl: a.querySelector('.wxc-hl')?.textContent, icon: a.dataset.wxicon, hrs: [...a.querySelectorAll('.wxc-h i')].map((i) => i.textContent), label: a.getAttribute('aria-label') }));
    check(card.t === '61°' && card.feels === 'Feels 59°' && card.hl === 'H 62° L 48°', 'the card: the temperature, feels like, today’s high and low', JSON.stringify(card));
    check(card.icon === 'sun' && /^Clear, 61°/.test(card.label), 'a condition icon, and the card says it all to a screen reader', card.icon + ' / ' + card.label);
    check(card.hrs.join(' ') === '3p 4p 5p 6p 7p 8p', 'the next six hours, from the hour after now', card.hrs.join(' '));
    check(card.href === '../weather.html', 'the card opens the guide’s weather page', card.href);
    const box = await page.evaluate(() => {
      const p = document.querySelector('#panel-whatnow');
      const r = (s) => p.querySelector(s).getBoundingClientRect();
      const c = r('.wxcard'), pills = r('.wxtop .pills'), big = r('.spin .big'), wx = r('.wxtop .wx');
      return { cardLeft: c.left, cardRight: c.right, cardTop: c.top, cardBottom: c.bottom, pillsRight: pills.right, pillsTop: pills.top, pillsBottom: pills.bottom, wxBottom: wx.bottom, bigTop: big.top, bigW: big.width, vw: innerWidth, scroll: document.documentElement.scrollWidth };
    });
    check(box.cardLeft > box.vw / 2 && box.cardRight <= box.vw - 15 && box.pillsRight <= box.cardLeft && box.pillsTop >= box.cardTop && box.pillsBottom <= box.cardBottom && box.wxBottom <= box.cardTop,
      'at 390 the card sits to the right, beside the pills and under the lake and sunset line, overlapping nothing', JSON.stringify(box));
    check(box.cardBottom <= box.bigTop && box.bigW >= 350 && box.scroll <= box.vw, 'above Spin, which keeps its full width, and nothing scrolls sideways', JSON.stringify(box));

    const today = await page.evaluate(() => {
      const p = document.querySelector('#panel-whatnow');
      const sec = p.querySelector('[data-sec="today"]');
      const tiles = [...p.querySelectorAll('.rail.today > *')].map((t) => (t.classList.contains('tdsep') ? '|' + t.textContent : t.dataset.k + ' ' + t.querySelector('.tw').textContent));
      const full = p.querySelector('.todaylinks a');
      const spin = p.querySelector('.spin'), ch = p.querySelector('[data-sec="challenges"]');
      return { title: sec && sec.querySelector('h2').textContent, tiles, full: full && full.textContent.trim(), fullHref: full && full.getAttribute('href'),
        order: !!(spin && sec && ch && (spin.compareDocumentPosition(sec) & 4) && (sec.compareDocumentPosition(ch) & 4)), href: p.querySelector('.rail.today a').getAttribute('href') };
    });
    check(today.title === 'Happening today' && today.order, 'Happening today sits under Spin and above the challenges', JSON.stringify(today));
    check(today.tiles.join(', ') === 'd-pm1 4:30 pm, |Tonight, d-tn4 5:45 pm, d-tn3 6 pm, d-tn1 8 pm, d-tn2 9:30 pm, d-tn5 11:30 pm',
      'the rest of today in time order, the morning’s gone, then tonight’s under a Tonight mark', today.tiles.join(', '));
    check(today.href === '#whatnow/e-pm1', 'a tile opens its own listing', today.href);
    check(/^Full events calendar/.test(today.full) && /\/events\.html$/.test(today.fullHref), 'and a link to the full events calendar', JSON.stringify(today));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await page.screenshot({ path: path.join(SHOTS, 'demo-whatnow-glance-390.png') });
    await ctx.close();

    /* dark, and wide: the card holds its shape */
    const d = await newPage(browser, base, { clock: etAt(14), scheme: 'dark', viewport: { width: 1280, height: 800 } });
    await d.page.goto(base + '/all-day/?demo=1#whatnow');
    await d.page.waitForSelector(wnPanel + ' .wxcard', { timeout: 15000 });
    const dk = await d.page.$eval(wnPanel + ' .wxcard', (a) => ({ bg: getComputedStyle(a).backgroundColor, ink: getComputedStyle(a).color, h: a.getBoundingClientRect().height }));
    check(dk.bg !== 'rgba(0, 0, 0, 0)' && dk.h < 140, 'dark and 1280: the card keeps its fill and its height, sky and all', JSON.stringify(dk));
    await d.page.screenshot({ path: path.join(SHOTS, 'demo-whatnow-glance-desktop-dark.png') });
    check(!d.errors.length, 'no console errors', d.errors.join(' | '));
    await d.ctx.close();
  });

  await group('What Now, at a glance on Burlington’s clock (live, a reader in Los Angeles)', async () => {
    /* 2 pm in Burlington is 11 am in Los Angeles: the hours, today, tonight
       and the high and low are all Burlington's */
    const day = etKey(Date.now());
    const off = etOffset(Date.parse(day + 'T12:00:00Z'));
    const frozen = Date.parse(day + 'T14:00:00' + off);
    const at = (d, hm) => d + 'T' + hm + ':00' + off;
    const ev = (id, title, d, start, end, extra) => ({ id, title, date: d, start: at(d, start), ...(end ? { end: at(d, end) } : {}), url: 'https://example.com/' + id,
      category: 'music', allDay: false, venue: 'Hall ' + id, town: 'Burlington', free: true, ...(extra || {}) });
    const events = [
      ev('gone', 'This morning', day, '09:00', '10:00'),
      ev('on', 'Started at one', day, '13:00', '16:00'),
      ev('long', 'All afternoon fair', day, '10:00', '17:00'),
      ev('soon', 'Half past two', day, '14:30', null),
      ev('xss', '<img src=x onerror="window.__wnxss=1">Bad title', day, '15:00', null),
      ev('cxl', 'Cancelled: the show', day, '15:30', null),
      ev('allday', 'An exhibit', day, '00:00', null, { allDay: true }),
      ev('eve', 'Seven o’clock', day, '19:00', null),
      ev('late', 'Late set', day, '23:30', null),
      ev('yday', 'Last night late', dayMinus(day, 1), '23:30', null),
      ev('tmrw', 'Just after midnight', dayMinus(day, -1), '00:30', null),
    ];
    const hours = Array.from({ length: 12 }, (_, i) => ({ t: at(day, String(12 + i).padStart(2, '0') + ':00'), temp_f: 40 + i, feels_f: 35 + i, pop: i === 3 ? 70 : 5, short: i === 3 ? 'Rain Showers Likely' : 'Partly Sunny' }));
    const weather = {
      updated: new Date(frozen).toISOString(),
      now: { observed_at: new Date(frozen - 20 * 60000).toISOString(), description: 'Mostly Cloudy', temp_f: 41, feels_like_f: 33 },
      forecast: { periods: [
        { name: 'Overnight', start: at(day, '02:00'), is_day: false, temp_f: 25, short: 'Clear' },
        { name: 'Today', start: at(day, '06:00'), is_day: true, temp_f: 44, short: 'Mostly Sunny' },
        { name: 'Tonight', start: at(day, '18:00'), is_day: false, temp_f: 30, short: 'Clear' },
        { name: 'Tomorrow', start: at(dayMinus(day, -1), '06:00'), is_day: true, temp_f: 52, short: 'Sunny' }] },
      hourly: { hours },
      sun: { sunrise: at(day, '07:10'), sunset: at(day, '18:05') },
    };
    const routes = [[/\/all-day\/data\/whatnow\.json/, { generated: new Date(frozen).toISOString(), days: 10, counts: {}, events }], [/\/data\/weather\/latest\.json/, weather]];
    const { ctx, page, errors } = await newPage(browser, base, { timezoneId: 'America/Los_Angeles', routes });
    await page.clock.setFixedTime(frozen);
    await page.goto(base + '/all-day/#whatnow');
    await page.waitForSelector(wnPanel + ' .wxcard', { timeout: 15000 });
    const card = await page.$eval(wnPanel + ' .wxcard', (a) => ({ t: a.querySelector('.wxc-t').textContent, feels: a.querySelector('.wxc-feels')?.textContent, hl: a.querySelector('.wxc-hl')?.textContent,
      icon: a.dataset.wxicon, hrs: [...a.querySelectorAll('.wxc-h')].map((h) => h.querySelector('i').textContent + ':' + h.dataset.wxicon + ':' + h.querySelector('b').textContent) }));
    check(card.t === '41°' && card.feels === 'Feels 33°' && card.icon === 'cloud', 'the card leads with the fresh observation, mostly cloudy', JSON.stringify(card));
    check(card.hl === 'H 44° L 30°', 'today’s high, and tonight’s low rather than last night’s', card.hl);
    check(card.hrs.join(' ') === '3p:rain:43° 4p:partly:44° 5p:partly:45° 6p:partly:46° 7p:moon:47° 8p:moon:48°', 'the next six hours in Burlington’s clock, with rain where it is forecast and the moon after the 6:05 sunset', card.hrs.join(' '));
    await page.waitForSelector(wnPanel + ' .rail.today', { timeout: 15000 });
    const tiles = await page.$$eval(wnPanel + ' .rail.today > *', (t) => t.map((x) => (x.classList.contains('tdsep') ? '|' : x.dataset.k + ' ' + x.querySelector('.tw').textContent)));
    check(tiles.join(', ') === 'd-on On now, d-soon 2:30 pm, d-xss 3 pm, |, d-eve 7 pm, d-late 11:30 pm',
      'today in Burlington: on now, then what’s next, then tonight; not the morning, the all-afternoon fair, the all-day exhibit, the cancelled show, last night or tomorrow', tiles.join(', '));
    const xss = await page.evaluate(() => ({ fired: !!window.__wnxss, imgs: document.querySelectorAll('#panel-whatnow .rail.today img').length,
      text: document.querySelector('#panel-whatnow [data-k="d-xss"] .tt').textContent }));
    check(!xss.fired && !xss.imgs && /^<img src=x/.test(xss.text), 'a title with markup in it prints as text', JSON.stringify(xss));
    check(await page.$eval(wnPanel + ' [data-k="d-soon"]', (a) => a.target === '_blank' && a.rel === 'noopener' && a.href === 'https://example.com/soon'), 'a tile opens its listing in a new tab', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();

    /* late at night, with nothing left today, tomorrow's take the strip */
    const late = Date.parse(day + 'T23:50:00' + off);
    const l = await newPage(browser, base, { timezoneId: 'America/Los_Angeles', routes });
    await l.page.clock.setFixedTime(late);
    await l.page.goto(base + '/all-day/#whatnow');
    await l.page.waitForSelector(wnPanel + ' [data-sec="today"]', { timeout: 15000 });
    const lt = await l.page.evaluate(() => ({ h: document.querySelector('#panel-whatnow [data-sec="today"] h2').textContent,
      k: [...document.querySelectorAll('#panel-whatnow .rail.today [data-k]')].map((t) => t.dataset.k) }));
    check(lt.h === 'Happening tomorrow' && lt.k.join(',') === 'd-tmrw', 'after the last one tonight, the strip turns to tomorrow', JSON.stringify(lt));
    check(!l.errors.length, 'no console errors', l.errors.join(' | '));
    await l.ctx.close();

    /* just after Burlington midnight: last night's late set is still on, and
       with nothing after it and nothing tomorrow the strip says so */
    const midnight = Date.parse(dayMinus(day, -1) + 'T00:30:00' + etOffset(Date.parse(dayMinus(day, -1) + 'T12:00:00Z')));
    const mEvents = [ev('night', 'Still going', day, '23:30', null, { end: new Date(midnight + 3600000).toISOString() })];
    const m = await newPage(browser, base, { timezoneId: 'America/Los_Angeles', routes: [[/\/all-day\/data\/whatnow\.json/, { generated: new Date(frozen).toISOString(), days: 10, counts: {}, events: mEvents }], routes[1]] });
    await m.page.clock.setFixedTime(midnight);
    await m.page.goto(base + '/all-day/#whatnow');
    await m.page.waitForSelector(wnPanel + ' [data-sec="today"]', { timeout: 15000 });
    const mt = await m.page.evaluate(() => ({ h: document.querySelector('#panel-whatnow [data-sec="today"] h2').textContent,
      k: [...document.querySelectorAll('#panel-whatnow .rail.today [data-k]')].map((t) => t.dataset.k + ' ' + t.querySelector('.tw').textContent) }));
    check(mt.h === 'Happening today' && mt.k.join(',') === 'd-night On now', 'at 12:30 am, last night’s late set still on shows as on now', JSON.stringify(mt));
    check(!m.errors.length, 'no console errors', m.errors.join(' | '));
    await m.ctx.close();
    const e2 = await newPage(browser, base, { timezoneId: 'America/Los_Angeles', routes: [[/\/all-day\/data\/whatnow\.json/, { generated: new Date(frozen).toISOString(), days: 10, counts: {}, events: [] }], routes[1]] });
    await e2.page.clock.setFixedTime(frozen);
    await e2.page.goto(base + '/all-day/#whatnow');
    await e2.page.waitForSelector(wnPanel + ' [data-sec="today"]', { timeout: 15000 });
    const et2 = await e2.page.evaluate(() => document.querySelector('#panel-whatnow [data-sec="today"]').parentElement.innerText);
    check(/Happening today/.test(et2) && /Nothing else today\./.test(et2) && !/Happening tomorrow/.test(et2), 'nothing today and nothing tomorrow: Happening today, “Nothing else today.”', '');
    check(!e2.errors.length, 'no console errors', e2.errors.join(' | '));
    await e2.ctx.close();
  });

  await group('What Now, Btown Challenges (live)', async () => {
    const real = JSON.parse(await readFile(path.join(APP, 'data/challenges.json'), 'utf8'));
    const all = real.weekly.concat(real.evergreen);
    const kinds = ['eat', 'climb', 'explore', 'streak'];
    check(real.weekly.length >= 4 && real.evergreen.length >= 3, 'challenges.json holds weekly and evergreen challenges', real.weekly.length + ' / ' + real.evergreen.length);
    check(all.every((c) => /^[a-z0-9-]+$/.test(c.id) && c.title && c.line && kinds.includes(c.kind) && /^(https:\/\/|\.\.\/[\w.-]+\.html$)/.test(c.url)), 'every one has an id, a title, a line, a known kind and a page', '');
    check(new Set(all.map((c) => c.id)).size === all.length, 'no id twice', '');
    check(all.every((c) => !/[—–!]/.test(c.title + c.line)), 'no dashes or exclamation points', '');
    for (const c of all.filter((x) => /^\.\.\//.test(x.url))) {
      const f = await readFile(path.join(REPO, c.url.slice(3))).then(() => true, () => false);
      check(f, c.id + ': its guide page exists (' + c.url + ')', '');
    }
    /* which weekly one is up, worked out here the way the tab does: Burlington's Monday */
    const key = etKey(Date.now());
    const [y, m, d] = key.split('-').map(Number);
    const noon = Date.UTC(y, m - 1, d, 12);
    const dow = (new Date(noon).getUTCDay() + 6) % 7;
    const monday = new Date(noon - dow * 86400000).toISOString().slice(0, 10);
    const wk = Math.floor((noon - dow * 86400000 - Date.UTC(1970, 0, 5, 12)) / (7 * 86400000));
    const loose = real.weekly.filter((c) => !c.week);
    const want = real.weekly.find((c) => c.week === monday) || loose[wk % loose.length];

    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/#whatnow');
    await page.waitForSelector(wnPanel + ' [data-sec="challenges"]', { timeout: 15000 });
    const got = await page.evaluate(() => {
      const p = document.querySelector('#panel-whatnow');
      const ch = p.querySelector('[data-sec="challenges"]'), mi = p.querySelector('[data-sec="missions"]');
      return { above: !!(ch && mi && (ch.compareDocumentPosition(mi) & 4)), week: p.querySelector('.chweek h3')?.textContent, weekK: p.querySelector('.chweek')?.dataset.k,
        rows: [...p.querySelectorAll('.lrow.chal')].map((r) => r.dataset.k), suggest: ch.querySelector('a.suggest')?.getAttribute('href'),
        more: p.querySelector('.chlinks a')?.getAttribute('href') };
    });
    check(got.above, 'Btown Challenges sits above the Top 100+', JSON.stringify(got));
    check(got.week === want.title && got.weekK === 'c-' + want.id, 'this week’s challenge is the one for Burlington’s week', got.week + ' vs ' + want.title);
    check(got.rows.length === 3 && got.rows.every((k) => real.evergreen.some((c) => 'c-' + c.id === k)), 'and three evergreen ones under it', got.rows.join(', '));
    check(/^mailto:btownbrief@gmail\.com\?subject=/.test(got.suggest || ''), 'Suggest one writes to btownbrief@gmail.com', got.suggest);
    check(got.more === 'https://play.btownbrief.com/challenges/', 'All challenges opens the challenge board', got.more);
    const k = got.rows[1];
    await page.click(wnPanel + ' .lrow.chal[data-k="' + k + '"] .markdone');
    check(await page.$eval(wnPanel + ' .lrow.chal[data-k="' + k + '"]', (r) => r.classList.contains('done')), 'Mark done ticks it', '');
    await page.click(wnPanel + ' .chweek .markdone');
    await page.reload();
    await page.waitForSelector(wnPanel + ' [data-sec="challenges"]', { timeout: 15000 });
    check(await page.$eval(wnPanel + ' .lrow.chal[data-k="' + k + '"]', (r) => r.classList.contains('done')) && await page.$eval(wnPanel + ' .chweek', (r) => r.classList.contains('done')),
      'and both survive a reload, on this device', '');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('allday-challenges') || '{}'));
    check(stored[k.slice(2)] && stored[want.id], 'kept under allday-challenges, like the missions’ marks', JSON.stringify(stored));
    await page.click(wnPanel + ' .lrow.chal[data-k="' + k + '"] .open');
    await page.waitForSelector('.sheet-card');
    const sheet = await page.$eval('.sheet-card', (c) => ({ h: c.querySelector('h2').textContent, link: c.querySelector('a.btn')?.href }));
    const c1 = real.evergreen.find((c) => 'c-' + c.id === k);
    check(sheet.h === c1.title && sheet.link === c1.url, 'tapping one opens its line and its page', JSON.stringify(sheet));
    await page.keyboard.press('Escape');
    await page.evaluate((kk) => { location.hash = 'whatnow/' + kk; }, got.weekK);
    check(await flashes(page, got.weekK), '#whatnow/c-<id> lands on the challenge', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('What Now, challenges and colour (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { clock: etAt(11) });
    await page.goto(base + '/all-day/?demo=1#whatnow');
    await page.waitForSelector(wnPanel + ' [data-sec="challenges"]', { timeout: 15000 });
    const ks = await page.$$eval(wnPanel + ' .challenges [data-k]', (r) => r.map((x) => x.dataset.k));
    check(ks.length === 4 && !ks.includes('c-demo-bad'), 'a challenge without a real page never shows', ks.join(', '));
    await page.evaluate(() => { const h = document.querySelector('#panel-whatnow [data-sec="challenges"]'); h.closest('.panel').scrollBy(0, h.getBoundingClientRect().top - 120); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, 'demo-whatnow-challenges-390.png') });
    await page.click(wnPanel + ' .chweek .markdone');
    check(await page.$eval(wnPanel + ' .chweek', (r) => r.classList.contains('done')), 'demo: Mark done ticks', '');
    check(!(await page.evaluate(() => localStorage.getItem('allday-challenges'))), 'and never reaches localStorage', '');
    const colour = await page.evaluate(() => {
      const p = document.querySelector('#panel-whatnow');
      const dot = getComputedStyle(p.querySelector('.chips.themes .chip.th-water'), '::before').backgroundColor;
      const num = getComputedStyle(p.querySelector('.lrow.mission.th-drink .num')).color;
      const plain = getComputedStyle(p.querySelector('.lrow.mission .num')).color;
      const week = getComputedStyle(p.querySelector('.chweek')).backgroundColor;
      return { dot, num, week, ink3: plain };
    });
    check(colour.dot !== 'rgba(0, 0, 0, 0)' && colour.week !== 'rgba(0, 0, 0, 0)', 'theme chips carry a colour dot, and the week’s challenge a tint', JSON.stringify(colour));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
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
    const card = () => page.$eval(foodPanel + ' .deck', (d) => ({ k: d.dataset.k, eyebrow: (d.querySelector('.eyebrow') || {}).textContent || '', h: d.querySelector('h3').textContent,
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
    check(end.k === 'deals-end' && await page.$eval('#panel-food .deck h3', (h) => h.textContent) === 'That’s all.', 'after the last deal, the deck says that’s all', JSON.stringify(end));
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
    check(!/No new videos from the kitchens/.test(txt) && tiles.length === 4 && !tiles.some((t) => /clip|NotFood/.test(t)),
      'with no videos it shows the food accounts’ latest photos, and no explanation', tiles.join(', '));
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
    check(/^The Weekly Bite$/im.test(hero) && !/featured, not reviewed/i.test(hero) && hero.includes(dish.caption) && hero.includes(pick.name) && /sent in by Sam/.test(hero),
      'the Weekly Bite is the newest approved dish: its line, the place, the reader', hero);
    check(!/\b7\b/.test(hero) && !/vote|score|rating|★/i.test(hero), 'featured, never rated: no votes or score on it', hero);
    await page.click(foodPanel + ' .hero .btn:text("The place")');
    check(await page.$eval('.sheet-head h2', (h) => h.textContent) === pick.name, '“The place” opens the place it came from', '');
    await page.click('.sheet-head .iconbtn');

    /* the form: we feature, we don't review; nothing goes without consent */
    const form = foodPanel + ' form.dish';
    const add = await page.$eval(foodPanel + ' [data-sec="add"]', (s) => s.innerText);
    check(!/We feature, we don’t review|No stars, no scores/.test(add), 'the form carries no policy paragraph (the negative-word check still refuses)', add.slice(0, 160));
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

    /* both kinds of dish: one you loved somewhere, or one you made at home */
    const kinds = await page.$eval(form, (f) => ({ line: f.querySelector('p.note').textContent, pills: [...f.querySelectorAll('.where .pills button')].map((b) => [b.textContent, b.classList.contains('on')]) }));
    check(kinds.line === 'A dish you loved somewhere, or one you made at home.', 'the form says it covers both', kinds.line);
    check(JSON.stringify(kinds.pills) === '[["At a place",true],["Made at home",false]]', 'and asks which: At a place (the default) or Made at home', JSON.stringify(kinds.pills));
    await page.click(form + ' .where button:has-text("Made at home")');
    check(await page.$eval(form + ' input[name=place]', (i) => i.closest('.row').hidden), 'made at home: the place field goes away', '');
    await page.setInputFiles(form + ' input[type=file]', { name: 'dish.png', mimeType: 'image/png', buffer: photo });
    await page.fill(form + ' input[name=line]', 'Sunday sauce, my grandmother’s way');
    await page.check(form + ' input[name=consent]');
    const before = sent.length;
    await page.click(form + ' .send');
    for (let i = 0; i < 60 && !sent.slice(before).some((x) => /btb_photos_submit/.test(x.url)); i++) await page.waitForTimeout(100);
    const rpc2 = sent.slice(before).find((x) => /btb_photos_submit/.test(x.url));
    const args2 = rpc2 ? JSON.parse(rpc2.body) : {};
    check(args2.p_category === 'dish' && args2.p_spot === 'Made at home' && args2.p_area === 'Greater Burlington' && args2.p_caption === 'Sunday sauce, my grandmother’s way',
      'a home dish needs no place: it goes to the same queue with “Made at home” in the place field (no SQL change)', JSON.stringify(args2));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();

    /* a home dish as the Weekly Bite: made at home, no neighborhood, no place button */
    const hm = await newPage(browser, base);
    const homeDish = { ...dish, id: '31111111-2222-3333-4444-555555555555', caption: 'Sunday sauce', spot: 'Made at home', area: 'Greater Burlington' };
    await hm.page.route(/\/rest\/v1\/rpc\/btb_photos_get/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([homeDish]) }));
    await hm.page.goto(base + '/all-day/#food');
    await hm.page.waitForSelector(foodPanel + ' .hero[data-k="bite"]', { timeout: 15000 });
    const hh = await hm.page.$eval(foodPanel + ' .hero[data-k="bite"]', (h) => ({ p: h.querySelector('p').textContent, place: [...h.querySelectorAll('.btn')].some((b) => b.textContent === 'The place') }));
    check(hh.p === 'Made at home · sent in by Sam' && !hh.place, 'a home dish as the Bite reads “Made at home”, with no area and no place button', JSON.stringify(hh));
    check(!hm.errors.length, 'no console errors', hm.errors.join(' | '));
    await hm.ctx.close();

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
    await page.waitForTimeout(1200);
    /* the last section of a short page cannot reach the top; then the panel is scrolled to its end */
    const top = await page.$eval(foodPanel + ' [data-sec="add"]', (s) => { const p = s.closest('.panel'); return { top: Math.round(s.getBoundingClientRect().top), end: p.scrollTop >= p.scrollHeight - p.clientHeight - 2 }; });
    check(top.top >= 0 && (top.top < 260 || top.end), 'a chip scrolls to its section', JSON.stringify(top));
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

  /* ------------------------------------------------ the map, sorts, directory */
  const demo = JSON.parse(await readFile(path.join(APP, 'data/demo/food.json'), 'utf8'));
  const DR = demo.restaurants.restaurants;
  const CH = [44.4758, -73.2128];
  const mi = (a, b) => { const R = 3958.8, rad = Math.PI / 180, dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    return 2 * R * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2)); };
  const WIN = { breakfast: [420, 600], lunch: [660, 840], dinner: [1020, 1260] };
  const serves = (r, meal, day) => (r.hours[day] || []).some(([o, c]) => { const a = fMin(o), b0 = fMin(c), b = b0 > a ? b0 : b0 + 1440, [x, y] = WIN[meal]; return Math.min(b, y) - Math.max(a, x) >= (y - x) / 2; });
  const NOON = Date.parse('2026-10-16T12:00:00-04:00');   // a Friday
  const rowIds = (page) => page.$$eval(foodPanel + ' [data-sec="open"] .lrow.place', (rs) => rs.map((r) => r.dataset.k.slice(2)));
  const showAll = async (page) => { const more = await page.$(foodPanel + ' [data-sec="open"] .btn.more'); if (more) await more.click(); };
  const sortTo = async (page, k) => { await page.selectOption(foodPanel + ' select.fsort', k); await page.waitForTimeout(150); await showAll(page); return rowIds(page); };
  /* Leaflet itself is not on this machine, and the page loads it with an
     integrity hash a stand-in cannot match: the stand-in answers the pinned
     URL, the integrity setter records what was asked for and lets it in, and
     the fake L records what the map was told to draw. */
  const fakeLeaflet = `window.__sri = [];
    Object.defineProperty(HTMLScriptElement.prototype, 'integrity', { configurable: true, set(v) { window.__sri.push(v); }, get() { return ''; } });
    Object.defineProperty(HTMLLinkElement.prototype, 'integrity', { configurable: true, set(v) { window.__sri.push(v); }, get() { return ''; } });`;
  const FAKE_L = `window.L = (() => {
    const maps = [];
    const layer = (kind, at, o) => ({ kind, at, o, addTo(m) { m.layers.push(this); return this; }, bindTooltip(t) { this.tip = t; return this; },
      on(ev, fn) { this['on' + ev] = fn; return this; }, remove() { this.gone = true; } });
    return { maps, map(el, opts) { const m = { el, opts, layers: [], view: null, setView(c, z) { this.view = c; this.zoom = z; return this; }, setZoom(z) { this.zoom = z; return this; },
      invalidateSize() {}, remove() { this.removed = true; }, getContainer() { return el; } }; maps.push(m); return m; },
      tileLayer(u, o) { return layer('tiles', u, o); }, circleMarker(c, o) { return layer('pin', c, o); } };
  })();`;
  const withLeaflet = async (page, asked) => {
    await page.addInitScript(fakeLeaflet);
    await page.route(/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.(js|css)$/, (r) => { asked.push(r.request().url());
      return /\.js$/.test(r.request().url()) ? r.fulfill({ status: 200, body: FAKE_L, contentType: 'text/javascript' }) : r.fulfill({ status: 200, body: '', contentType: 'text/css' }); });
  };
  const mapState = (page) => page.evaluate(() => { const m = window.L && window.L.maps && window.L.maps[window.L.maps.length - 1]; if (!m) return null;
    return { view: m.view, inSheet: !!m.el.closest('.sheet-body'), tiles: m.layers.filter((l) => l.kind === 'tiles').map((l) => ({ u: l.at, attr: l.o.attribution })),
      pins: m.layers.filter((l) => l.kind === 'pin' && !/fm-me/.test(l.o.className)).map((l) => ({ at: l.at, tip: l.tip, cls: l.o.className })),
      me: m.layers.filter((l) => l.kind === 'pin' && /fm-me/.test(l.o.className) && !l.gone).map((l) => l.at) }; });

  await group('Food, the map with location refused (demo, noon)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    const asked = [], out = [];
    await withLeaflet(page, asked);
    page.on('request', (q) => { if (!q.url().startsWith(base)) out.push(q.url()); });
    await page.clock.setFixedTime(NOON);
    await page.goto(base + '/all-day/?demo=1#food/open');
    await page.waitForSelector(foodPanel + ' .lrow.place', { timeout: 15000 });
    await page.waitForTimeout(300);
    const btn = await page.evaluate((p) => { const b = document.querySelector(p + ' [data-sec="open"] .sec .mapbtn'); const sec = b && b.closest('.sec');
      const r = b && b.getBoundingClientRect(), s = sec && sec.getBoundingClientRect();
      return b && { label: b.getAttribute('aria-label'), text: b.innerText, dots: b.querySelectorAll('.fm-dot').length, here: b.querySelectorAll('.fm-here').length,
        right: Math.round(s.right - r.right), last: sec.lastElementChild === b, sub: sec.querySelector('p').textContent }; }, foodPanel);
    const open = DR.filter((r) => fOpenAt(r.hours, 'fri', 720));
    check(btn && btn.last && btn.right <= 20 && /Map/.test(btn.text), 'a Map button sits at the far right of the Open now head', JSON.stringify(btn));
    check(btn && btn.dots >= 6 && btn.dots <= open.length && btn.here === 1, 'its preview is the list as dots around Church Street', JSON.stringify(btn));
    check(btn && btn.label === 'Map of ' + open.length + ' places', 'and it says how many places it maps', btn && btn.label);
    check(!asked.length && !out.some((u) => /unpkg|tile\.openstreetmap/.test(u)) && await page.evaluate(() => !window.L), 'before a tap: no Leaflet, no tiles, nothing fetched', out.join(', '));
    await page.click(foodPanel + ' .mapbtn');
    await page.waitForFunction(() => window.L && window.L.maps && window.L.maps.length, null, { timeout: 6000 }).catch(() => {});
    const m = await mapState(page);
    check(asked.some((u) => /leaflet\.js$/.test(u)) && asked.some((u) => /leaflet\.css$/.test(u)), 'a tap loads Leaflet 1.9.4 and its stylesheet', asked.join(', '));
    check(await page.evaluate(() => window.__sri.includes('sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=') && window.__sri.includes('sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=')),
      'with the integrity hashes the guide’s own map pages use', await page.evaluate(() => window.__sri.join(', ')));
    check(m && m.inSheet && await page.$eval('.sheet-head h2', (h) => h.textContent) === 'Map', 'the map opens in a sheet', JSON.stringify(m && m.inSheet));
    check(m && m.tiles.length === 1 && m.tiles[0].u === 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' && /OpenStreetMap/.test(m.tiles[0].attr), 'on OpenStreetMap’s tiles, credited', JSON.stringify(m && m.tiles));
    check(m && JSON.stringify(m.view) === JSON.stringify(CH), 'with no location it is centred on Church Street', JSON.stringify(m && m.view));
    check(m && m.pins.length === open.length && m.pins.every((p) => /fm-pin open/.test(p.cls)) && !m.me.length, 'a pin for each place open now, and no reader pin', JSON.stringify(m && m.pins.length));
    const noodle = DR.find((r) => r.id === 'demo-noodle-counter');
    check(m && m.pins.some((p) => p.tip === noodle.name && JSON.stringify(p.at) === JSON.stringify(noodle.coords)), 'each pin is a place, at its own spot, named', '');
    await page.click('.sheet-body .nearme');
    await page.waitForSelector('#toast:not([hidden])', { timeout: 6000 }).catch(() => {});
    check(/Location is off/.test(await page.$eval('#toast', (t) => t.textContent)) && !(await mapState(page)).me.length, 'Near me, refused: says so, and the map stays on Church Street', '');
    await page.evaluate((name) => { const m = window.L.maps[window.L.maps.length - 1]; m.layers.find((l) => l.tip === name).onclick(); }, noodle.name);
    check(await page.$eval('.sheet-head h2', (h) => h.textContent) === noodle.name, 'a pin opens its place', '');
    await page.click('.sheet-head .iconbtn');
    /* Closest to me, refused: back to Church Street, said once */
    await page.selectOption(foodPanel + ' select.fsort', 'me');
    await page.waitForTimeout(400);
    check(await page.$eval(foodPanel + ' select.fsort', (s) => s.value) === 'near' && /Location is off\. Sorted from Church St\./.test(await page.$eval('#toast', (t) => t.textContent)),
      'Closest to me, refused: the list stays nearest Church Street and says why', '');
    await page.goto(base + '/all-day/?demo=1#food/map');
    await page.reload();
    await page.waitForSelector('.sheet-head h2', { timeout: 15000 }).catch(() => {});
    check(await page.$eval('.sheet-head h2', (h) => h.textContent).catch(() => '') === 'Map', '#food/map opens the map', '');
    await page.screenshot({ path: path.join(SHOTS, 'demo-food-map.png') });
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Food, the map and Closest to me with location allowed (demo, noon)', async () => {
    const ME = { latitude: 44.4885, longitude: -73.2205 };   // up North Ave, by the pho shop
    const { ctx, page, errors } = await newPage(browser, base, { geo: ME });
    const asked = [], sent = [];
    await withLeaflet(page, asked);
    page.on('request', (q) => sent.push(q.url() + ' ' + (q.postData() || '')));
    await page.addInitScript(() => { const g = navigator.geolocation, ask = g.getCurrentPosition.bind(g); window.__geo = 0; g.getCurrentPosition = (...a) => { window.__geo++; return ask(...a); }; });
    await page.clock.setFixedTime(NOON);
    await page.goto(base + '/all-day/?demo=1#food/open');
    await page.waitForSelector(foodPanel + ' .lrow.place', { timeout: 15000 });
    check(await page.evaluate(() => window.__geo) === 0, 'nothing asks for the location on load', '');
    const ids = await sortTo(page, 'me');
    const d = ids.map((id) => mi(DR.find((r) => r.id === id).coords, [ME.latitude, ME.longitude]));
    check(ids.length && d.every((x, i) => !i || x >= d[i - 1] - 1e-9) && ids[0] === 'demo-pho-shop', 'Closest to me: allowed, the list runs from the reader outward', ids.slice(0, 4).join(', '));
    check(/closest to you/.test(await page.$eval(foodPanel + ' [data-sec="open"] .sec p', (p) => p.textContent)), 'and the head says so', '');
    await page.click(foodPanel + ' .mapbtn');
    await page.waitForFunction(() => window.L && window.L.maps && window.L.maps.length, null, { timeout: 6000 }).catch(() => {});
    const m = await mapState(page);
    check(m && m.me.length === 1 && JSON.stringify(m.me[0]) === JSON.stringify([ME.latitude, ME.longitude]), 'the map puts the reader on it', JSON.stringify(m && m.me));
    check(m && JSON.stringify(m.view) === JSON.stringify(CH), 'but stays centred on Church Street, so no tile request is for the reader’s own block', JSON.stringify(m && m.view));
    check(await page.$eval('.sheet-body .nearme', (b) => b.hidden), 'and Near me steps aside', '');
    await page.screenshot({ path: path.join(SHOTS, 'demo-food-map-me.png') });
    const lat = String(ME.latitude), lon = String(ME.longitude);
    check(await page.evaluate(() => window.__geo) >= 1, 'it was asked for only once the reader picked Closest to me', '');
    check(!sent.some((x) => x.includes(lat) || x.includes(lon)), 'the position is never sent anywhere', sent.filter((x) => x.includes(lat) || x.includes(lon)).join(', '));
    const stored = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)) + JSON.stringify(Object.entries(sessionStorage)) + document.cookie);
    check(!stored.includes(lat) && !stored.includes(lon), 'and never stored', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();

    /* a reader nowhere near Burlington is not "near" anything here */
    const far = await newPage(browser, base, { geo: { latitude: 34.05, longitude: -118.25 } });
    await far.page.clock.setFixedTime(NOON);
    await far.page.goto(base + '/all-day/?demo=1#food/open');
    await far.page.waitForSelector(foodPanel + ' .lrow.place', { timeout: 15000 });
    await far.page.selectOption(foodPanel + ' select.fsort', 'me');
    await far.page.waitForSelector('#toast:not([hidden])', { timeout: 6000 }).catch(() => {});
    check(/not near Burlington/.test(await far.page.$eval('#toast', (t) => t.textContent)) && await far.page.$eval(foodPanel + ' select.fsort', (s) => s.value) === 'near',
      'a reader in Los Angeles is told, and the list stays on Church Street', '');
    await far.ctx.close();
  });

  await group('Food, the sorts and the meal toggle (demo, noon)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.clock.setFixedTime(NOON);
    await page.goto(base + '/all-day/?demo=1#food/open');
    await page.waitForSelector(foodPanel + ' .lrow.place', { timeout: 15000 });
    const opts = await page.$$eval(foodPanel + ' select.fsort option', (o) => o.map((x) => x.value + ':' + x.textContent));
    check(JSON.stringify(opts) === JSON.stringify(['near:Nearest Church St', 'me:Closest to me', 'late:Open latest', 'price:Price', 'new:Newest']), 'the sort offers nearest, closest to me, open latest, price, newest', opts.join(', '));
    const by = (id) => DR.find((r) => r.id === id);
    const near = await sortTo(page, 'near');
    const nd = near.map((id) => mi(by(id).coords, CH));
    check(near.length === DR.filter((r) => fOpenAt(r.hours, 'fri', 720)).length && nd.every((x, i) => !i || x >= nd[i - 1] - 1e-9), 'Nearest Church St: the default, nearest first', near.join(', '));
    const late = await sortTo(page, 'late');
    const lc = late.map((id) => fLatest(by(id).hours, 'fri'));
    check(lc.every((x, i) => !i || x <= lc[i - 1]) && lc[0] > lc[lc.length - 1], 'Open latest: the latest close tonight first', lc.join(', '));
    const price = await sortTo(page, 'price');
    const pr = price.map((id) => ({ $: 1, $$: 2, $$$: 3, $$$$: 4 }[by(id).price] || 9));
    const rows = await page.$$eval(foodPanel + ' [data-sec="open"] .lrow.place', (rs) => rs.map((r) => r.innerText));
    check(pr.every((x, i) => !i || x >= pr[i - 1]) && pr[0] === 1 && pr[pr.length - 1] === 3, 'Price: cheapest first', pr.join(', '));
    check(/ · \$ · /.test(rows[0]), 'and each row shows its price', rows[0]);
    const fresh = await sortTo(page, 'new');
    check(fresh[0] === 'demo-pho-shop' && fresh[1] === 'demo-dumpling-house', 'Newest: the most recently opened first', fresh.slice(0, 3).join(', '));
    check(/opened Oct 2026/.test(await page.$eval(foodPanel + ' [data-k="r-demo-pho-shop"]', (r) => r.innerText)), 'and says when it opened', '');
    await sortTo(page, 'near');

    /* Breakfast / Lunch / Dinner: read off today's hours, on top of the chip */
    await page.click(foodPanel + ' .chips.filters .chip[data-chip="cheap"]');
    const seen = {};
    for (const meal of ['breakfast', 'lunch', 'dinner']) {
      await page.click(foodPanel + ' .pills.meals button:text-is("' + meal[0].toUpperCase() + meal.slice(1) + '")');
      await page.waitForTimeout(120);
      await showAll(page);
      const got = (await rowIds(page)).sort();
      const want = DR.filter((r) => r.under_15 === true && serves(r, meal, 'fri')).map((r) => r.id).sort();
      seen[meal] = got.join(',');
      const n = Number(await page.$eval(foodPanel + ' .chips.filters .chip.on .n', (c) => c.textContent));
      check(JSON.stringify(got) === JSON.stringify(want) && n === want.length, meal + ': the places open for it today (' + want.length + '), and the chip counts them', got.join(', ') + ' / ' + want.join(', '));
    }
    check(new Set(Object.values(seen)).size === 3 && seen.breakfast.includes('demo-old-north-bakery') && !seen.dinner.includes('demo-old-north-bakery'),
      'the three meals really differ: the bakery is breakfast, not dinner', JSON.stringify(seen));
    await page.click(foodPanel + ' .pills.meals button:text-is("Any time")');
    await page.waitForTimeout(120);
    await showAll(page);
    check((await rowIds(page)).length === DR.filter((r) => r.under_15 === true).length, 'Any time puts them all back', '');
    await page.evaluate(() => document.querySelector('#panel-food [data-sec="open"]').scrollIntoView());
    await page.screenshot({ path: path.join(SHOTS, 'demo-food-sorts.png') });
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Food, Deals today: smaller, a › arrow, See all deals (demo, noon)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.clock.setFixedTime(NOON);
    await page.goto(base + '/all-day/?demo=1#food/deals');
    await page.waitForSelector(foodPanel + ' .deck', { timeout: 15000 });
    const k = () => page.$eval(foodPanel + ' .deck', (d) => d.dataset.k);
    const box = await page.$eval(foodPanel + ' .deck', (d) => { const r = d.getBoundingClientRect(), n = d.querySelector('.next').getBoundingClientRect();
      return { h: Math.round(r.height), w: Math.round(r.width), next: n.width > 20 && n.right <= r.right && n.left > r.left + r.width / 2 && getComputedStyle(d.querySelector('.next')).visibility === 'visible' }; });
    check(box.h < 300 && box.h < box.w, 'the deck is a strip now, wider than it is tall', JSON.stringify(box));
    check(box.next, 'with a visible › arrow on its right side', JSON.stringify(box));
    const first = await k();
    await page.click(foodPanel + ' .deck .next');
    const second = await k();
    check(first === 'd-demo-diner-coffee' && second === 'd-demo-bistro-oysters', 'the arrow turns to the next deal', first + ' → ' + second);
    const all = await page.$eval(foodPanel + ' [data-sec="deals"] .sec a.alldeals', (a) => ({ text: a.textContent.trim(), href: a.getAttribute('href'), target: a.target, last: a.parentElement.lastElementChild === a }));
    check(all.text === 'See all deals' && new URL(all.href).pathname === '/restaurants.html' && new URL(all.href).search === '?view=deals' && !all.target && all.last, '“See all deals” sits in the head and opens the guide’s deals page', JSON.stringify(all));
    const bg = await page.$eval(foodPanel + ' .deck', (d) => d.querySelector(':scope > .ph') && !d.querySelector(':scope > .ph[style*="--mark"]'));
    check(bg, 'a deal at a place with its own food picture shows it behind the card', '');
    await page.evaluate(() => document.querySelector('#panel-food [data-sec="deals"]').scrollIntoView());
    await page.screenshot({ path: path.join(SHOTS, 'demo-food-deals.png') });
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Food, the directory: Their food, with and without Instagram (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.clock.setFixedTime(NOON);
    await page.goto(base + '/all-day/?demo=1#food/open');
    await page.waitForSelector(foodPanel + ' .lrow.place .theirs', { timeout: 15000 });
    await showAll(page);
    const btns = await page.$$eval(foodPanel + ' [data-sec="open"] .lrow.place', (rs) => Object.fromEntries(rs.map((r) => [r.dataset.k.slice(2),
      { theirs: !!r.querySelector('.theirs'), menuAfter: !!r.querySelector('.theirs + a.pillbtn'), pic: !!r.querySelector('.th:not(.bare) .ph, .th:not(.bare) img') }])));
    check(btns['demo-noodle-counter'].theirs && btns['demo-noodle-counter'].menuAfter, 'a place with its own posts has “Their food” beside Menu', JSON.stringify(btns['demo-noodle-counter']));
    check(btns['demo-dumpling-house'].theirs, 'a place with no Instagram but a reader’s dish has it too', JSON.stringify(btns['demo-dumpling-house']));
    check(!btns['demo-pub-on-main'].theirs && !btns['demo-pub-on-main'].pic, 'a place with neither has no button and keeps its initials', JSON.stringify(btns['demo-pub-on-main']));
    check(btns['demo-noodle-counter'].pic && btns['demo-dumpling-house'].pic, 'and a place with food to show leads its row with it', '');
    await page.click(foodPanel + ' [data-k="r-demo-noodle-counter"] .theirs');
    await page.waitForSelector('.sheet-body .fgrid');
    const a = await page.evaluate(() => ({ title: document.querySelector('.sheet-head h2').textContent, tiles: [...document.querySelectorAll('.sheet-body .ftile')].map((t) => t.dataset.k + (t.classList.contains('clip') ? ':clip' : '')),
      insta: document.querySelector('.sheet-body a.insta')?.getAttribute('href'), text: document.querySelector('.sheet-body').innerText }));
    check(a.title === 'The noodle counter on Bank' && a.tiles[0] === 'dish-demo-dish-2' && a.tiles.includes('ig-DemoReel1:clip'), 'Their food: the reader’s dish first, then its own reels and posts', JSON.stringify(a.tiles));
    check(a.insta === 'https://www.instagram.com/demo_noodles/' && /sent in by Theo/.test(a.text), 'with its Instagram and the reader’s credit', JSON.stringify(a));
    await page.click('.sheet-body .ftile.clip');
    await page.waitForSelector('#vbox:not([hidden])', { timeout: 4000 }).catch(() => {});
    check(await page.$eval('#vbox', (b) => !b.hidden) && await page.$eval('#sheet', (s) => s.hidden), 'a reel there plays in the one video box, the sheet out of its way', '');
    await page.click('#vbox-close');
    await page.click(foodPanel + ' [data-k="r-demo-dumpling-house"] .theirs');
    await page.waitForSelector('.sheet-body .fgrid');
    const b = await page.evaluate(() => ({ tiles: [...document.querySelectorAll('.sheet-body .ftile')].map((t) => t.dataset.k), insta: !!document.querySelector('.sheet-body a.insta') }));
    check(JSON.stringify(b.tiles) === JSON.stringify(['dish-demo-dish-1']) && !b.insta, 'no Instagram: its submitted dish still shows, and no Instagram link', JSON.stringify(b));
    await page.screenshot({ path: path.join(SHOTS, 'demo-food-their-food.png') });

    /* the owner path: a short sheet and a mailto, no form */
    await page.click('.sheet-body .owner');
    await page.waitForSelector('.sheet-body a.mailto');
    const o = await page.evaluate(() => ({ title: document.querySelector('.sheet-head h2').textContent, href: document.querySelector('.sheet-body a.mailto').getAttribute('href'),
      forms: document.querySelectorAll('.sheet-body form, .sheet-body input, .sheet-body textarea').length, text: document.querySelector('.sheet-body').innerText.trim() }));
    check(o.title === 'Feature your restaurant' && o.href === 'mailto:btownbrief@gmail.com?subject=' + encodeURIComponent('Feature my restaurant: The dumpling house'), '“Feature your restaurant” opens a mailto with a subject', o.href);
    check(!o.forms && o.text.split('\n').filter(Boolean).length <= 2 && o.text.length < 90, 'no form and no paragraph', JSON.stringify(o.text));
    await page.click('.sheet-head .iconbtn');
    const foot = await page.$eval(foodPanel + ' [data-sec="open"] .addrow .owner', (x) => x.textContent).catch(() => '');
    check(foot === 'Feature your restaurant', 'and owners find it under the list too', foot);
    /* not food is gone from In their own words */
    const rail = await page.$$eval(foodPanel + ' [data-sec="kitchens"] .vcard', (c) => c.map((x) => x.dataset.k));
    check(rail.length && !rail.includes('ig-DemoTalk1'), 'an account the directory marks not-food never reaches In their own words', rail.join(', '));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Food, the directory over the wire (live)', async () => {
    const dir = JSON.parse(await readFile(path.join(APP, 'data/food-directory.json'), 'utf8'));
    check(dir.not_food.theresnoaincreemee && !Object.values(dir.places).includes('theresnoaincreemee'), 'the directory names the creemee podcast as not food', '');
    const { ctx, page, errors } = await newPage(browser, base);
    const ig = foodInstagram(true);
    const now = Math.floor(Date.now() / 1000);
    ig.posts.push({ ...ig.posts[3], h: 'theresnoaincreemee', u: 'https://www.instagram.com/p/PodcastPost/', ts: now - 600, f: 1 });
    await page.route(/\/all-day\/data\/instagram\.json/, (r) => r.fulfill({ status: 200, body: JSON.stringify(ig), contentType: 'application/json' }));
    const bare = fd.places.find((r) => r.hours_confidence === 'google' && !r.aka.some((id) => dir.places[id]) && r.name !== pick.name);
    const dish = { id: '21111111-2222-3333-4444-555555555555', storage_path: 'submissions/dddd.jpg', caption: 'The breakfast sandwich, every Saturday', category: 'dish',
      area: 'Burlington', spot: bare.name, taken_on: '', credit: 'Jo', display_label: null, approved_on: '2026-10-15', votes: 0 };
    await page.route(/\/rest\/v1\/rpc\/btb_photos_get/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([dish]) }));
    /* the posts arrive after the list; a place opened once they are in has them */
    await page.goto(base + '/all-day/#food/kitchens');
    await page.waitForSelector(foodPanel + ' [data-sec="kitchens"] .vcard', { timeout: 15000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => { location.hash = '#food/r-waterworks'; });
    await page.waitForSelector('.sheet-head h2', { timeout: 15000 });
    await page.waitForSelector('.sheet-body .theirs', { timeout: 8000 }).catch(() => {});
    await page.click('.sheet-body .theirs');
    await page.waitForSelector('.sheet-body .fgrid', { timeout: 4000 }).catch(() => {});
    const w = await page.evaluate(() => ({ tiles: [...document.querySelectorAll('.sheet-body .ftile')].map((t) => t.dataset.k), insta: document.querySelector('.sheet-body a.insta')?.getAttribute('href') }));
    check(w.tiles.includes('ig-FoodPhoto') && w.insta === 'https://www.instagram.com/waterworksvt/', 'Waterworks: its own post from instagram.json, by the handle its website links', JSON.stringify(w));
    await page.click('.sheet-head .iconbtn');
    await page.waitForSelector(foodPanel + ' [data-sec="bite"] .hero', { timeout: 8000 }).catch(() => {});
    await page.evaluate((id) => { location.hash = '#food/r-' + id; }, bare.id);
    await page.waitForFunction((n) => document.querySelector('.sheet-head h2')?.textContent === n, bare.name, { timeout: 15000 }).catch(() => {});
    await page.waitForSelector('.sheet-body .theirs', { timeout: 8000 }).catch(() => {});
    const has = !!(await page.$('.sheet-body .theirs'));
    if (has) await page.click('.sheet-body .theirs');
    await page.waitForSelector('.sheet-body .fgrid', { timeout: 4000 }).catch(() => {});
    const b = await page.evaluate(() => ({ tiles: [...document.querySelectorAll('.sheet-body .ftile')].map((t) => t.dataset.k), insta: !!document.querySelector('.sheet-body a.insta') }));
    check(has && JSON.stringify(b.tiles) === JSON.stringify(['dish-' + dish.id]) && !b.insta, bare.name + ', no Instagram: the dish a reader sent in is its food', JSON.stringify(b));
    await page.click('.sheet-head .iconbtn');
    const rail = await page.$$eval(foodPanel + ' [data-sec="kitchens"] .vcard', (c) => c.map((x) => x.dataset.k));
    check(!rail.includes('ig-PodcastPost') && rail.includes('ig-FoodReelA'), 'the podcast stays out of In their own words even tagged food', rail.join(', '));
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
    check(await out.page.$('.signin input[type=email]') !== null && /An email link, no password\./.test(t), 'signed out: the email field, and one line on how it works', t.slice(0, 200));
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
    check(/Posting is coming soon\./.test(await page.$eval('.sheet-body', (b) => b.innerText)), 'the compose sheet says the same, and offers no form', '');
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
const WATCH_TELEGRAM = 'https://t.me/+39fLB9cqY684ZmVh';
const TV_BASE = 50000000;
const W_DAY = 86400000;
const wDayNum = (key) => Math.floor(Date.parse(key + 'T12:00:00Z') / W_DAY);
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
    check(!(await page.$(wPanel + ' [data-sec="list"][data-seed]')) && /12 of 12 to go/.test(await page.$eval(wPanel + ' [data-sec="list"]', (s) => s.innerText)),
      'films.json is the list, and its subtitle is only the count to go', await page.$eval(wPanel + ' [data-sec="list"]', (s) => s.innerText));
    check(JSON.stringify(await wTiles(page)) === JSON.stringify(films.top.map((f) => 'f' + f.id)), 'every film in its TMDB order', '');
    const toc = await page.$$eval('#subnav .chip', (c) => c.map((x) => x.textContent));
    check(JSON.stringify(toc) === JSON.stringify(['Coming soon', 'Theaters', 'The list', 'Town', 'Next screening', 'Chat']), 'the chip row is the table of contents', toc.join(' / '));
    check(!(await page.$(wPanel + ' [data-kind]')), 'a films.json with no shows has no Movies / TV switch', '');
    const soon = await page.$$eval(wPanel + ' [data-sec="soon"] + .rail-wrap .poster', (n) => n.map((a) => [a.dataset.k, a.querySelector('.s').textContent, !!a.querySelector('.play')]));
    check(soon.length === 5 && soon[0][1] === 'In theaters now' && soon[1][1] === 'Back in theaters' && /· theaters$/.test(soon[2][1]) && /· streaming$/.test(soon[3][1]), 'Coming soon: in theaters now (a 1966 re-release is back in theaters), then what opens, labelled theaters or streaming', JSON.stringify(soon));
    check(JSON.stringify(soon.map((x) => x[2])) === '[true,false,true,true,false]', 'a play disc only where TMDB has a trailer', JSON.stringify(soon));
    const pics = await page.$$eval(wPanel + ' .poster img.pic', (n) => n.slice(0, 3).map((i) => [i.getAttribute('src'), i.loading]));
    check(pics.length && pics.every(([src, lazy]) => /^https:\/\/image\.tmdb\.org\/t\/p\/w342\/[A-Za-z0-9]+\.jpg$/.test(src) && lazy === 'lazy'), 'posters are TMDB paths at w342, loaded lazily', JSON.stringify(pics));
    const box = await page.$eval(wPanel + ' [data-grid] .poster .c-media', (m) => { const r = m.getBoundingClientRect(); return Math.round(r.height / r.width * 100) / 100; });
    check(box === 1.5, 'a poster reserves its 2:3 box', box);
    const credit = await page.$eval(wPanel + ' [data-credit]', (c) => ({ text: c.innerText, logo: c.querySelector('img') && c.querySelector('img').getAttribute('src'), href: c.querySelector('a').href }));
    check(!credit.text.trim() && credit.logo === '../assets/img/tmdb.svg' && credit.href === 'https://www.themoviedb.org/', 'TMDB’s logo mark is on the tab, and only the mark', JSON.stringify(credit));
    const about = await settingsText(page);
    check(/not endorsed or certified by TMDB/.test(about) && await page.$('.sheet-body [data-credit="tmdb"] img[src="../assets/img/tmdb.svg"]') !== null, 'TMDB’s logo and notice are in Settings, About', about.slice(-260));
    await page.keyboard.press('Escape');

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
    check(await page.$eval('#vbox', (b) => b.hidden) && /No trailer yet\./.test(await page.$eval('.sheet-body', (b) => b.innerText)), 'a film with no trailer opens its sheet instead, and says so', '');
    await page.click('.sheet-head .iconbtn');
    /* the film sheet's trailer button: the same box */
    await page.click(wPanel + ' [data-k="f' + films.top[1].id + '"]');
    await page.waitForSelector('.sheet-body [data-trailer]');
    const sheet = await page.$eval('.sheet-body', (b) => b.innerText);
    check(sheet.includes(films.top[1].o.slice(0, 40)) && sheet.includes(String(films.top[1].y)) && /\dh \d+m/.test(sheet) && sheet.includes(films.top[1].g[0]),
      'the film sheet: overview, year, runtime, genres', sheet.slice(0, 200));
    check(await page.$('.sheet-body [data-credit] img[alt="TMDB"]') !== null && !/not endorsed/.test(sheet), 'and TMDB’s mark (the notice is in Settings)', '');
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
    check(head.seed === '1' && /60 of 60 to go/.test(head.text), 'the seed list is marked as the seed, and counts what is left', head.text);
    check(!(await page.$(wPanel + ' [data-sec="soon"]')), 'with no films.json there is no Coming soon (the seed has none)', '');
    const toc = await page.$$eval('#subnav .chip', (c) => c.map((x) => x.textContent));
    check(JSON.stringify(toc) === JSON.stringify(['Theaters', 'The list', 'Town', 'Next screening', 'Chat']), 'and the table of contents leaves it out', toc.join(' / '));
    check((await wTiles(page)).length === 60, 'all sixty films', '');
    const dots = () => page.$$eval(wPanel + ' [data-grid] .poster', (n) => n.map((a) => [a.dataset.k, [...a.querySelectorAll('.seen i')].map((i) => (i.classList.contains('on') ? 1 : 0)).join('')]));
    check((await dots()).every((d) => d[1] === '0'), 'alone: one dot on every poster, none filled', JSON.stringify((await dots()).slice(0, 3)));
    const sw = await page.$eval(wPanel + ' [data-who]', (b) => ({ label: b.querySelector('label').textContent.trim(), role: b.querySelector('input[data-with]').getAttribute('role'),
      on: b.querySelector('input[data-with]').checked, line: b.querySelector('.note').textContent, legend: !!b.querySelector('[data-legend]') }));
    check(sw.label === 'Watching with someone' && sw.role === 'switch' && !sw.on, 'the partner mode is a switch that says what it is: Watching with someone, off', JSON.stringify(sw));
    check(sw.line === 'Mark what each of you has seen, and find films neither of you has.' && !sw.legend, 'one line says what it is for; no legend while it is off', JSON.stringify(sw));
    check(!/Just me|With partner/.test(await page.$eval(wPanel + ' [data-slot="list"]', (n) => n.innerText)), 'the old “With partner / Just me” words are gone', '');

    await page.click(wPanel + ' [data-who] input[data-with]');
    await page.waitForSelector('.sheet-body input[name=partner]');
    await page.fill('.sheet-body input[name=partner]', '  Sam  ');
    await page.click('.sheet-body button[type=submit]');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached' });
    check((await dots()).every((d) => d[1] === '00'), 'With Sam: a second dot on every poster', JSON.stringify((await dots()).slice(0, 3)));
    const on = await page.$eval(wPanel + ' [data-who]', (b) => ({ on: b.querySelector('input[data-with]').checked,
      legend: [...b.querySelectorAll('[data-legend] .wwho')].map((w) => w.textContent + ':' + [...w.querySelectorAll('i')].map((i) => (i.classList.contains('on') ? 1 : 0)).join('')) }));
    check(on.on && JSON.stringify(on.legend) === '["You:10","Sam:01"]', 'on: the legend names the two dots, first yours, second Sam’s', JSON.stringify(on));

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
    await page.click(wPanel + ' [data-who] [data-rename]');
    await page.waitForSelector('.sheet-body input[name=partner]');
    check(await page.$eval('.sheet-body input[name=partner]', (i) => i.value) === 'Sam', 'Change name opens the name, filled in', '');
    await page.click('.sheet-head .iconbtn');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached' });
    await page.click(wPanel + ' [data-who] input[data-with]');
    check((await dots()).every((d) => d[1].length === 1) && Object.fromEntries(await dots())[k] === '1' && !(await page.$(wPanel + ' [data-legend]')),
      'switched off: one dot, yours is kept, and the legend goes', '');

    /* rating, signed out: told it is one email, nothing sent */
    await page.click(wPanel + ' [data-k="' + k + '"]');
    await page.waitForSelector('.sheet-body [data-stars="4"]');
    await page.click('.sheet-body [data-stars="4"]');
    const said = await page.$eval('.sheet-body [data-msg]', (m) => m.textContent);
    check(/Sign in to rate/.test(said) && await page.$('.sheet-body [data-signin]') !== null, 'signed out, a star says to sign in, with the button', said);
    check(!supabase.some((u) => /nn_post_create/.test(u)), 'and nothing is posted', supabase.join(', '));
    await page.click('.sheet-head .iconbtn');

    const doors = await page.$$eval(wPanel + ' [data-door]', (a) => a.map((x) => [x.dataset.door, x.getAttribute('href')]));
    check(JSON.stringify(doors) === JSON.stringify([['telegram', WATCH_TELEGRAM], ['community', WATCH_CHAT]]), 'Watch chat: Talk opens the Telegram watch chat first, the community second', JSON.stringify(doors));
    const talk = await page.$$eval(wPanel + ' [data-door]', (a) => a.map((x) => [x.textContent.trim(), x.className, x.target]));
    check(talk[0][0] === 'Talk' && !/ghost/.test(talk[0][1]) && /ghost sm/.test(talk[1][1]) && talk.every((t) => t[2] === '_blank'), 'Talk is the big button; the community is the smaller one', JSON.stringify(talk));
    check(!(await page.$eval(wPanel + ' [data-slot="chat"]', (s) => s.querySelector('p'))), 'and no paragraph', '');
    check(await page.$(wPanel + ' [data-chat] input, ' + wPanel + ' [data-chat] textarea') === null, 'no chat is built here', '');
    const town = await page.$eval(wPanel + ' [data-slot="town"]', (s) => s.innerText);
    check(/No ratings this week yet/.test(town), 'with no ratings yet, town ratings say so', town);
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
    await page.click(wPanel + ' [data-sort] [data-chip="town"]');
    const order = rated.slice().sort((a, b) => avg(b) - avg(a) || ratings.get(b.id).n - ratings.get(a.id).n || d.films.top.indexOf(a) - d.films.top.indexOf(b)).map((f) => 'f' + f.id);
    const sorted = await wTiles(page);
    check(JSON.stringify(sorted.slice(0, rated.length)) === JSON.stringify(order), 'Town favorites: the rated films first, highest average first', JSON.stringify([sorted.slice(0, rated.length), order]));
    const pool = [...new Set([...d.films.top, ...d.films.trend, ...d.films.now].map((f) => 'f' + f.id))];
    const rest = pool.filter((k) => !rated.some((f) => 'f' + f.id === k));
    check(JSON.stringify(sorted.slice(rated.length)) === JSON.stringify(rest.slice(0, 60 - rated.length)), 'then the rest in list order', JSON.stringify(sorted.slice(rated.length).slice(-4)));
    await page.click(wPanel + ' [data-slot="list"] .addrow button');
    const all = await wTiles(page);
    check(JSON.stringify(all.slice(-2)) === JSON.stringify(['f9201', 'f9202']), 'and the trending films not on the list come last', JSON.stringify(all.slice(-3)));
    check(await page.$eval(wPanel + ' [data-sort] [data-chip="town"]', (c) => c.getAttribute('aria-pressed')) === 'true', 'and the Town favorites chip is the one on', '');
    await page.click(wPanel + ' [data-sort] [data-chip="top"]');
    check(JSON.stringify(await wTiles(page)) === JSON.stringify(d.films.top.map((f) => 'f' + f.id)), 'Top rated puts it back', '');
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
    const want = [...ratings].filter(([, a]) => a.wn >= 3).map(([id]) => id);
    check(rows.length === want.length && rows.every((r) => r[1] >= 3), 'town ratings this week: only titles with three or more this week (' + want.length + ')', JSON.stringify(rows));
    check(JSON.stringify(rows.map((r) => r[0]).sort()) === JSON.stringify(want.map((id) => 'town:' + id).sort()), 'exactly those titles', '');
    check(rows.some((r) => r[0] === 'town:' + (TV_BASE + 7003) && /^Cold Case Vermont/.test(r[2])), 'a show the town rated is among them', JSON.stringify(rows));
    check(!rows.some((r) => /Causeway|Kindling/.test(r[2])), 'Causeway and Kindling, two ratings each this week, are left out', '');
    check(rows.every((r, i) => i === 0 || rows[i - 1][1] >= r[1]), 'most-rated first', '');

    const opts = () => page.$$eval(wPanel + ' [data-ballot] .vote-opt', (n) => n.map((o) => ({ k: o.dataset.k, on: o.getAttribute('aria-pressed'), n: o.querySelector('.l span').textContent, w: parseFloat(o.querySelector('.bar i').style.width) })));
    const before = await opts();
    check(before.length === 5, 'five films on the ballot', JSON.stringify(before));
    check(before.every((o, i) => i === 0 || parseFloat(before[i - 1].n) >= parseFloat(o.n)), 'most votes first', JSON.stringify(before.map((o) => o.n)));
    check(before.every((o) => / of 5$|going on Meetup/.test(o.n)) && !/At five votes/.test(await page.$eval(wPanel + ' [data-sec="vote"]', (s) => s.innerText)), 'each film shows its count out of five, and no rule paragraph', JSON.stringify(before.map((o) => o.n)));
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
    check(/Sign in to rate/.test(await page.$eval('.sheet-body [data-msg]', (m) => m.textContent)), 'signed out: rating asks for the sign-in', '');
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

  await group('Watch, Movies and TV (demo)', async () => {
    const d = await watchDemo();
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#watch');
    await page.waitForSelector(wPanel + ' [data-kind]', { timeout: 15000 });
    const kinds = await page.$$eval(wPanel + ' [data-kind] button', (n) => n.map((b) => [b.textContent, b.classList.contains('on')]));
    check(JSON.stringify(kinds) === '[["Movies",true],["TV",false]]', 'a Movies / TV switch at the top, on Movies', JSON.stringify(kinds));
    check(await page.$eval(wPanel, (p) => p.querySelector('[data-slot]').dataset.slot) === 'kind', 'and it is the first thing on the tab', '');
    await page.click(wPanel + ' [data-kind] button:has-text("TV")');
    await page.waitForFunction(() => /On TV now/.test(document.querySelector('#panel-watch [data-sec="soon"]')?.innerText || ''), null, { timeout: 4000 }).catch(() => {});
    check(JSON.stringify(await wTiles(page)) === JSON.stringify(d.films.tv_top.map((f) => 'tv' + f.id)), 'TV: the top shows, in TMDB order', JSON.stringify((await wTiles(page)).slice(0, 4)));
    const air = await page.$$eval(wPanel + ' [data-sec="soon"] + .rail-wrap .poster', (n) => n.map((a) => [a.querySelector('.t').textContent, a.querySelector('.s').textContent]));
    check(air[0][1] === 'New season 2' && /^Season 4 · [A-Z][a-z]{2} \d+$/.test(air[1][1]) && air[2][1] === 'Airing now', 'On TV now: a new season, one coming, then airing', JSON.stringify(air));
    check(!(await page.$(wPanel + ' [data-sec="theaters"]')) && !(await page.$(wPanel + ' [data-cta]')), 'no theaters and no screening call on TV', '');
    const toc = await page.$$eval('#subnav .chip', (c) => c.map((x) => x.textContent));
    check(JSON.stringify(toc) === JSON.stringify(['On TV now', 'Back then', 'The list', 'Town', 'Next screening', 'Chat']), 'the table of contents follows', toc.join(' / '));
    const dots = await page.$eval(wPanel + ' [data-grid] [data-k="tv7001"]', (a) => [...a.querySelectorAll('.seen i')].map((i) => (i.classList.contains('on') ? 1 : 0)).join(''));
    check(dots === '11', 'a show carries the same two dots', dots);
    await page.click(wPanel + ' [data-grid] [data-k="tv7003"]');
    await page.waitForSelector('.sheet-body [data-stars="5"]');
    const sheet = await page.$eval('.sheet-body', (b) => b.innerText);
    check(/\d+ seasons? · \d+m episodes/.test(sheet) && sheet.includes('Crime'), 'the show sheet: seasons, episode length, genres', sheet.slice(0, 120));
    await page.click('.sheet-head .iconbtn');
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.setProfile({ display_name: 'Maya' })));
    await page.click(wPanel + ' [data-grid] [data-k="tv7005"]');
    await page.waitForSelector('.sheet-body [data-stars="4"]');
    await page.click('.sheet-body [data-stars="4"]');
    await page.waitForFunction(() => /^Rated 4 stars/.test(document.querySelector('.sheet-body [data-msg]').textContent), null, { timeout: 4000 }).catch(() => {});
    const post = await fakeOf(page, (x) => { const p = x.posts.filter((q) => q.board === 'watch' && q.kind === 'rating').pop(); return { title: p.title, meta: p.meta }; });
    check(post.title === 'Static Line' && post.meta.film === TV_BASE + 7005 && post.meta.stars === 4, 'a show’s rating carries TV_BASE plus its TMDB id, in the same film field', JSON.stringify(post));
    await page.click('.sheet-head .iconbtn');
    await page.click(wPanel + ' [data-kind] button:has-text("Movies")');
    check(JSON.stringify(await wTiles(page)) === JSON.stringify(d.films.top.map((f) => 'f' + f.id)), 'and back to the films', '');
    await page.goto(base + '/all-day/?demo=1#watch/tv7010');
    await page.reload();
    check(await flashes(page, 'tv7010'), 'a show deep link switches to TV and flashes', '');
    check(await page.$eval(wPanel + ' [data-kind] button.on', (b) => b.textContent) === 'TV', 'on TV', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Watch, the ranking you choose (demo)', async () => {
    const d = await watchDemo();
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#watch/list');
    await page.waitForSelector(wPanel + ' [data-sort]', { timeout: 15000 });
    const labels = await page.$$eval(wPanel + ' [data-sort] .chip', (n) => n.map((c) => [c.dataset.chip, c.textContent.trim(), c.getAttribute('aria-pressed')]));
    check(JSON.stringify(labels.map((l) => l[1])) === JSON.stringify(['Top rated', 'Trending', 'Town favorites', 'Newest', 'By genre', 'Shuffle']), 'six orders, by name', JSON.stringify(labels));
    check(labels.filter((l) => l[2] === 'true').map((l) => l[0]).join() === 'top', 'Top rated is on: the label is the order', '');
    const sec = await page.$eval(wPanel + ' [data-slot="list"]', (s) => s.innerText);
    check(!/ordered|sorted|ranked by|in order of/i.test(sec), 'and no sentence explains the order', '');
    const pick = async (k) => { await page.click(wPanel + ' [data-sort] [data-chip="' + k + '"]'); await page.waitForTimeout(60); };
    await pick('trend');
    check(JSON.stringify(await wTiles(page)) === JSON.stringify(d.films.trend.map((f) => 'f' + f.id)), 'Trending: TMDB’s week, in its order', JSON.stringify(await wTiles(page)));
    await pick('new');
    const today = wToday();
    const pool = [...new Map([...d.films.top, ...d.films.trend, ...d.films.now].map((f) => [f.id, f])).values()];
    const moveD = (f) => { const nd = new Date((wDayNum(f.d) + wDayNum(today) - wDayNum(d._anchor)) * W_DAY + 12 * 3600000).toISOString().slice(0, 10); return nd; };
    const newest = pool.map((f) => ({ ...f, d: moveD(f) })).filter((f) => f.d <= today).sort((a, b) => b.d.localeCompare(a.d) || a.t.localeCompare(b.t)).map((f) => 'f' + f.id);
    check(JSON.stringify(await wTiles(page)) === JSON.stringify(newest.slice(0, 60)), 'Newest: everything released, newest first', JSON.stringify((await wTiles(page)).slice(0, 5)));
    await pick('genre');
    const shelves = await page.$$eval(wPanel + ' [data-shelf]', (n) => n.map((x) => x.dataset.shelf));
    check(shelves.length > 5 && !(await page.$(wPanel + ' [data-filter="genre"]')) && !(await page.$(wPanel + ' [data-grid]')), 'By genre: a shelf per genre, and no genre chips', JSON.stringify(shelves));
    const drama = await page.$$eval(wPanel + ' [data-genre="Drama"] .poster', (n) => n.map((a) => a.dataset.id));
    check(JSON.stringify(drama) === JSON.stringify(d.films.top.filter((f) => f.g.includes('Drama')).slice(0, 20).map((f) => String(f.id))), 'each shelf ranked as Top rated', JSON.stringify(drama.slice(0, 4)));
    const counts = await page.$$eval(wPanel + ' [data-genre]', (n) => n.map((r) => Number(r.closest('.rail-wrap').previousElementSibling.querySelector('.s').textContent.split(' ')[0])));
    check(counts.every((c, i) => i === 0 || counts[i - 1] >= c), 'the biggest genre first', JSON.stringify(counts));
    await pick('shuffle');
    const s1 = await wTiles(page);
    const seen = new Set(Object.entries(d.dots).filter(([, v]) => v[0] || v[1]).map(([id]) => 'f' + id));
    check(s1.length && s1.every((k) => !seen.has(k)) && JSON.stringify(s1) !== JSON.stringify(pool.map((f) => 'f' + f.id).filter((k) => !seen.has(k)).slice(0, s1.length)), 'Shuffle: only what you have not seen, in a new order', JSON.stringify(s1.slice(0, 5)));
    await pick('shuffle');
    const s2 = await wTiles(page);
    check(JSON.stringify(s2) !== JSON.stringify(s1) && JSON.stringify([...s2].sort()) === JSON.stringify([...s1].sort()), 'tap it again for another order of the same films', '');
    await page.click(wPanel + ' [data-show] button:has-text("All")');
    check(JSON.stringify(await wTiles(page)) === JSON.stringify(s2), 'a redraw keeps the order', '');
    await pageRules(page, 'watch', 390);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Watch, the time machine (demo)', async () => {
    const d = await watchDemo();
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#watch');
    await page.waitForSelector(wPanel + ' [data-sec="back"]', { timeout: 15000 });
    const thisMonth = wToday().slice(0, 7);
    const mi = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
    const mo = (i) => Math.floor(i / 12) + '-' + String((i % 12) + 1).padStart(2, '0');
    const shift = mi(thisMonth) - mi(d._anchor.slice(0, 7));
    const months = new Map(d.tm.months.map((m) => [mo(mi(m.m) + shift), m]));
    const yearAgo = mo(mi(thisMonth) - 12);
    const name = (m) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(m + '-15T12:00:00Z'));
    const shown = () => page.evaluate(() => { const b = document.querySelector('#panel-watch [data-slot="back"]'); return { m: b.querySelector('[data-month]').dataset.month, title: b.querySelector('.dateline b').textContent, ids: [...b.querySelectorAll('[data-back] .poster')].map((a) => a.dataset.id) }; });
    let s = await shown();
    const ids = (m, kind) => (kind === 'tv' ? months.get(m).tv.map((k) => String(TV_BASE + Number(k.slice(1)))) : [...months.get(m).theaters, ...months.get(m).streaming].map((k) => k.slice(1)));
    check(s.m === yearAgo && s.title === name(yearAgo), 'Back then opens a year ago: ' + name(yearAgo), JSON.stringify(s));
    const bhead = await page.$eval(wPanel + ' [data-sec="back"]', (h) => ({ title: h.querySelector('h2').textContent, sub: (h.querySelector('p') || {}).textContent, sub2: h.closest('[data-slot]').querySelector('.dateline .s').textContent }));
    check(bhead.title === 'Back then' && bhead.sub === 'Rotten Tomatoes’ front page, month by month' && bhead.sub2 === '', 'it says what it is: Rotten Tomatoes’ front page, month by month', JSON.stringify(bhead));
    const n0 = s.ids.length;
    const allBtn = () => page.$eval(wPanel + ' [data-back-all]', (b) => [b.textContent, b.dataset.backAll, b.getAttribute('aria-expanded')]);
    check(JSON.stringify(await allBtn()) === JSON.stringify(['Show all ' + n0, 'closed', 'false']) && await page.$(wPanel + ' [data-slot="back"] .rail[data-back]') !== null,
      'a rail, with a Show all button', JSON.stringify(await allBtn()));
    await page.click(wPanel + ' [data-back-all]');
    const grid = await page.evaluate(() => { const g = document.querySelector('#panel-watch [data-slot="back"] [data-back]'); const r = [...g.querySelectorAll('.poster')].map((a) => a.getBoundingClientRect());
      return { grid: g.classList.contains('wgrid'), rail: !!g.closest('.rail-wrap'), wrap: g.scrollWidth <= g.clientWidth + 1, rows: new Set(r.map((x) => Math.round(x.top))).size, n: r.length }; });
    check(grid.grid && !grid.rail && grid.wrap && grid.n === n0 && grid.rows > 1, 'Show all opens every title in a wrapping grid that scrolls down', JSON.stringify(grid));
    check(JSON.stringify(await allBtn()) === JSON.stringify(['Show less', 'open', 'true']), 'and the button says Show less', JSON.stringify(await allBtn()));
    await page.click(wPanel + ' [data-slot="back"] .dateline .nav[aria-label="Earlier day"]');
    check(await page.$(wPanel + ' [data-slot="back"] .wgrid[data-back]') !== null, 'it stays a grid from month to month', '');
    await page.click(wPanel + ' [data-slot="back"] .dateline .nav[aria-label="Later day"]');
    await page.click(wPanel + ' [data-back-all]');
    check(await page.$(wPanel + ' [data-slot="back"] .rail[data-back]') !== null && (await allBtn())[1] === 'closed', 'Show less folds it back into the rail', '');
    /* Stephen, 2026-10-18: a long opened list must be easy to fold back. The
       Collapse bar rides just above the tab bar while the grid is on screen. */
    await page.click(wPanel + ' [data-back-all]');
    const bar = await page.evaluate(() => {
      const panel = document.querySelector('#panel-watch');
      const g = document.querySelector('#panel-watch [data-slot="back"] .wgrid[data-back]');
      panel.scrollTop += g.getBoundingClientRect().bottom - innerHeight - 160;   // the grid's end 160px below the screen
      const b = g.parentElement.querySelector('.collapsebar [data-collapse]');
      const r = b.getBoundingClientRect(), tb = document.querySelector('.tabbar').getBoundingClientRect(), gr = g.getBoundingClientRect();
      return { pos: getComputedStyle(b.parentElement).position, gap: Math.round(tb.top - r.bottom), gridOn: gr.top < r.top && gr.bottom > r.bottom, label: b.getAttribute('aria-label'), text: b.textContent.trim() };
    });
    check(bar.pos === 'sticky' && bar.gap >= 8 && bar.gap <= 20 && bar.gridOn && bar.text === 'Collapse' && bar.label === 'Collapse Back then',
      'mid-grid, a Collapse bar sits just above the tab bar', JSON.stringify(bar));
    await page.click(wPanel + ' [data-slot="back"] [data-collapse]');
    await page.waitForTimeout(700);
    const folded = await page.evaluate(() => { const h = document.querySelector('#panel-watch [data-sec="back"]').getBoundingClientRect().top;
      return { rail: !!document.querySelector('#panel-watch [data-slot="back"] .rail[data-back]'), bar: !!document.querySelector('#panel-watch .collapsebar'), top: Math.round(h), ok: h >= 0 && h < innerHeight / 2 }; });
    check(folded.rail && !folded.bar && folded.ok && (await allBtn())[1] === 'closed', 'Collapse folds it into the rail and lands on Back then’s head', JSON.stringify(folded));
    check(JSON.stringify(s.ids) === JSON.stringify(ids(yearAgo)), 'that month’s big films, theaters then streaming', JSON.stringify(s.ids));
    await page.click(wPanel + ' [data-slot="back"] .dateline .nav[aria-label="Earlier day"]');
    s = await shown();
    check(s.m === mo(mi(yearAgo) - 1), '‹ is a month earlier', s.m);
    await page.click(wPanel + ' [data-slot="back"] .dateline .nav[aria-label="Later day"]');
    await page.click(wPanel + ' [data-slot="back"] .dateline .nav[aria-label="Later day"]');
    check((await shown()).m === mo(mi(yearAgo) + 1), '› a month later', (await shown()).m);
    const cur = (await shown()).m;
    const four = String(Number(thisMonth.slice(0, 4)) - 4);
    await page.click(wPanel + ' [data-years] [data-chip="' + four + '"]');
    s = await shown();
    check(s.m === four + cur.slice(4) && JSON.stringify(s.ids) === JSON.stringify(ids(s.m)), 'a year chip keeps the month: ' + name(four + cur.slice(4)), s.m);
    const years = await page.$$eval(wPanel + ' [data-years] .chip', (n) => n.map((c) => c.dataset.chip));
    const Y = Number(thisMonth.slice(0, 4));
    check(JSON.stringify(years) === JSON.stringify([Y, Y - 1, Y - 2, Y - 3, Y - 4, Y - 5].map(String)), 'the years run back five', JSON.stringify(years));
    const oldest = [...months.keys()].sort()[0];
    await page.goto(base + '/all-day/?demo=1#watch/back:' + oldest);
    await page.reload();
    await page.waitForSelector(wPanel + ' [data-slot="back"] [data-month="' + oldest + '"]', { timeout: 6000 }).catch(() => {});
    s = await shown();
    check(s.m === oldest && await page.$eval(wPanel + ' [data-slot="back"] .nav[aria-label="Earlier day"]', (b) => b.disabled), 'a deep link to the oldest month lands there, and ‹ stops', JSON.stringify(s));
    await page.click(wPanel + ' [data-kind] button:has-text("TV")');
    await page.waitForTimeout(100);
    s = await shown();
    check(s.ids.length && JSON.stringify(s.ids) === JSON.stringify(ids(s.m, 'tv')), 'on TV it shows the month’s shows', JSON.stringify(s));
    await page.click(wPanel + ' [data-slot="back"] [data-back] .poster');
    await page.waitForSelector('.sheet-body [data-seen="me"]', { timeout: 4000 });
    check(await page.$('.sheet-body [data-want]') !== null, 'a title from back then opens the same sheet: seen, want, rate', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Watch, in theaters near you and the screening call (demo, 10 am)', async () => {
    const d = await watchDemo();
    const { ctx, page, errors } = await newPage(browser, base, { clock: etAt(10) });
    await page.goto(base + '/all-day/?demo=1#watch');
    await page.waitForSelector(wPanel + ' [data-sec="theaters"]', { timeout: 15000 });
    await page.waitForSelector(wPanel + ' [data-showing] .lrow', { timeout: 6000 }).catch(() => {});
    const order = await page.$$eval(wPanel + ' [data-slot]', (n) => n.map((x) => x.dataset.slot));
    check(order.indexOf('cta') === order.indexOf('soon') + 1, 'the screening call sits right under Coming soon', order.join(','));
    const cta = await page.$eval(wPanel + ' [data-cta="vote"]', (b) => b.textContent.trim());
    check(cta === 'Vote for the next screening', 'it says what it does, and nothing else', cta);
    const host = await page.$$eval(wPanel + ' [data-host]', (n) => n.map((p) => ({ slot: p.closest('[data-slot]').dataset.slot, text: p.textContent, href: p.querySelector('a').getAttribute('href'),
      target: p.querySelector('a').target, link: p.querySelector('a').textContent })));
    check(JSON.stringify(host.map((h) => h.slot)) === '["cta","vote"]' && host.every((h) => h.text === 'Steve hosts a movie night with a mixer after. Pick the next film.'),
      'one line says who is screening, on the call and atop the ballot', JSON.stringify(host));
    check(host.every((h) => h.href === 'https://www.meetup.com/burlington-social-activites-group/' && h.target === '_blank' && h.link === 'Steve hosts a movie night'),
      'and it links to his Meetup group', JSON.stringify(host));
    const order2 = await page.$eval(wPanel + ' [data-slot="vote"]', (v) => [...v.children].map((c) => c.dataset.sec ? 'sec' : c.dataset.host ? 'host' : c.dataset.ballot ? 'ballot' : c.className));
    check(order2[0] === 'sec' && order2[1] === 'host', 'the line sits right under the ballot’s title', JSON.stringify(order2));
    const names = await page.$$eval(wPanel + ' [data-theater] button', (n) => n.map((b) => [b.textContent, b.classList.contains('on')]));
    check(JSON.stringify(names.map((x) => x[0])) === '["Partizanfilm","Majestic 10","Essex Cinemas"]', 'the three theaters', JSON.stringify(names));
    check(names.find((x) => x[1])[0] === 'Partizanfilm', 'Partizanfilm, the local one, leads even while it is closed (Stephen, 2026-10-18)', JSON.stringify(names));
    const rows = () => page.$$eval(wPanel + ' [data-showing] .lrow', (n) => n.map((r) => [r.querySelector('.t').textContent, r.querySelector('[data-times]').textContent, !!r.querySelector('.pillbtn')]));
    const pz = d.showtimes.theaters[0];
    const back = new Date((wDayNum(pz.back) + wDayNum(wToday()) - wDayNum(d._anchor)) * W_DAY + 12 * 3600000).toISOString().slice(0, 10);
    const backLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(back + 'T12:00:00Z'));
    check(await page.$eval(wPanel + ' [data-status]', (p) => p.textContent) === 'Burlington · Back ' + backLabel, 'Partizanfilm: Back ' + backLabel, await page.$eval(wPanel + ' [data-status]', (p) => p.textContent));
    let r = await rows();
    check(JSON.stringify(r.map((x) => x[0])) === '["Lantern Season","Small Hours"]', 'and the first day back’s schedule', JSON.stringify(r));
    check(await page.$eval(wPanel + ' [data-showtimes]', (a) => a.getAttribute('href')) === 'https://www.partizanfilm.org/', 'its Showtimes button', '');
    await page.click(wPanel + ' [data-theater] button:has-text("Majestic")');
    r = await rows();
    check(JSON.stringify(r) === JSON.stringify([['Low Tide', '10:50 am · 1:25 · 4:00 · 6:35 · 9:10 · 11:58 pm', true], ['Hollow Pines', '11:00 am · 1:40 · 7:00 · 11:55 pm', true], ['Street Brawler', '12:00 · 5:30 · 11:59 pm', false]]),
      'Majestic 10: the rest of today’s times, by first show; a title the tab knows gets a trailer button', JSON.stringify(r));
    check(await page.$eval(wPanel + ' [data-status]', (p) => p.textContent) === 'Williston · Today', 'the town and the day', '');
    const st = await page.$eval(wPanel + ' [data-showtimes]', (a) => [a.getAttribute('href'), a.target, a.textContent.trim()]);
    check(st[0] === 'https://www.majestic10.com/movies' && st[1] === '_blank' && st[2] === 'Showtimes', 'a Showtimes button to its own page', JSON.stringify(st));
    await page.click(wPanel + ' [data-theater] button:has-text("Essex")');
    await page.click(wPanel + ' [data-showing] .lrow .t');
    await page.waitForSelector('.sheet-body [data-trailer]', { timeout: 4000 });
    check(/The Long Lake/.test(await page.$eval('.sheet-head', (h) => h.textContent)), 'a known title opens its film sheet', '');
    await page.click('.sheet-head .iconbtn');
    await page.click(wPanel + ' [data-cta="vote"]');
    const pos = await page.waitForFunction(() => { const v = document.querySelector('#panel-watch [data-sec="vote"]').getBoundingClientRect().top; return v > 0 && v < innerHeight / 2; }, null, { timeout: 4000 }).then(() => true, () => false);
    check(pos, 'the call scrolls the ballot into view', '');
    await pageRules(page, 'watch', 390);
    await page.click(wPanel + ' [data-theater] button:has-text("Majestic")');
    await page.evaluate(() => document.querySelector('#panel-watch').scrollTo(0, 0));
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(SHOTS, 'demo-watch-390-top.png') });
    await page.evaluate(() => document.querySelector('#panel-watch [data-sec="theaters"]').scrollIntoView());
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, 'demo-watch-390-theaters.png') });
    await page.evaluate(() => document.querySelector('#panel-watch [data-sec="back"]').scrollIntoView());
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, 'demo-watch-390-back-then.png') });
    await page.evaluate(() => document.querySelector('#panel-watch [data-sec="list"]').scrollIntoView());
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, 'demo-watch-390-list.png') });
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Watch, showtimes, the time machine and TV from the films-data branch (live)', async () => {
    const films = await watchFilms();
    const seed = JSON.parse(await readFile(path.join(APP, 'data/films-seed.json'), 'utf8'));
    films.tv_top = seed.top.slice(30, 50).map((f, i) => ({ ...f, id: 1400 + i, t: 'Show ' + i, sn: 2 }));
    films.tv_trend = films.tv_top.slice(0, 3);
    films.tv_air = [{ ...films.tv_top[4], ns: 3, d: wToday() }];
    films.trend = seed.top.slice(40, 45);
    const today = wToday();
    const m = (n) => { const [y, mm] = today.split('-').map(Number); const i = y * 12 + mm - 1 - n; return Math.floor(i / 12) + '-' + String((i % 12) + 1).padStart(2, '0'); };
    const t0 = seed.top[0], t1 = seed.top[55];
    const tm = { v: 1, images: 'https://image.tmdb.org/t/p/', titles: {
      ['m' + t0.id]: { id: t0.id, k: 'movie', t: t0.t, y: t0.y, d: t0.d, g: t0.g, o: '', p: t0.p },
      ['m' + t1.id]: { id: t1.id, k: 'movie', t: '<img src=x onerror=alert(1)>', y: t1.y, d: t1.d, g: [], o: '', p: '/../../evil.jpg' },
      t1399: { id: 1399, k: 'tv', t: 'A Show', y: 2011, d: '2011-04-17', g: ['Drama'], o: '', p: '/sh.jpg' },
      m42: { id: 99, k: 'movie', t: 'Key and id disagree', y: 2020, d: '2020-01-01', g: [], o: '', p: '' } },
      months: [{ m: m(12), src: 'rt', theaters: ['m' + t0.id, 'm42'], streaming: ['m' + t1.id], tv: ['t1399'] }, { m: m(13), src: 'tmdb', theaters: ['m' + t0.id], tv: [] }, { m: 'not-a-month', theaters: ['m' + t0.id] }] };
    const showtimes = { v: 1, days: [today], theaters: [
      { id: 'majestic10', name: 'Majestic 10', town: 'Williston', url: 'https://www.majestic10.com/movies', ok: true, closed: false, back: '',
        days: { [today]: [{ t: films.now[0].t, id: films.now[0].id, p: films.now[0].p, times: ['23:59'] }, { t: '<b>Bold</b> Title', p: '/x.jpg', times: ['23:59', 'bad'] }] } },
      { id: 'essex', name: 'Essex Cinemas', town: 'Essex', url: 'https://evil.example/', ok: false, closed: false, back: '', days: {} },
      { id: 'nowhere', name: 'Elsewhere', town: 'Nowhere', url: 'https://x.example/', ok: true, days: {} }] };
    const { ctx, page, errors } = await newPage(browser, base, { films, tm, showtimes, clock: etAt(12) });
    await page.goto(base + '/all-day/#watch');
    await page.waitForSelector(wPanel + ' [data-sec="back"]', { timeout: 15000 });
    const back = await page.$$eval(wPanel + ' [data-back] .poster', (n) => n.map((a) => [a.dataset.id, a.querySelector('.t').textContent, a.querySelector('img') && a.querySelector('img').getAttribute('src')]));
    check(back.length === 2 && back[0][0] === String(t0.id) && back[0][2] === 'https://image.tmdb.org/t/p/w342' + t0.p, 'Back then: TMDB posters at w342, a key that disagrees with its id left out', JSON.stringify(back));
    check(back[1][1] === '<img src=x onerror=alert(1)>' && !back[1][2] && !(await page.$(wPanel + ' [data-back] img[src="x"]')), 'a title is text, never markup, and a bad poster path is dropped', JSON.stringify(back[1]));
    check(await page.$eval(wPanel + ' [data-slot="back"] .dateline b', (b) => b.textContent) === new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(m(12) + '-15T12:00:00Z')), 'and the month is named', '');
    check(!(await page.$(wPanel + ' [data-back-all]')), 'two titles fit the rail: no Show all', '');
    await page.click(wPanel + ' [data-slot="back"] .dateline .nav[aria-label="Earlier day"]');
    check(await page.$eval(wPanel + ' [data-slot="back"] .dateline .s', (n) => n.textContent) === 'Most popular on TMDB', 'a month the archive missed says it is TMDB’s most popular, not the front page', '');
    await page.click(wPanel + ' [data-slot="back"] .dateline .nav[aria-label="Later day"]');
    const th = await page.$$eval(wPanel + ' [data-theater] button', (n) => n.map((b) => b.textContent));
    check(JSON.stringify(th) === '["Partizanfilm","Majestic 10","Essex Cinemas"]', 'theaters are the known three, whatever the file adds', JSON.stringify(th));
    const rows = await page.$$eval(wPanel + ' [data-showing] .lrow', (n) => n.map((r) => [r.querySelector('.t').textContent, r.querySelector('[data-times]').textContent, r.querySelector('img') && r.querySelector('img').getAttribute('src')]));
    check(rows.length === 2 && rows[1][0] === '<b>Bold</b> Title' && rows[1][1] === '11:59 pm' && rows[1][2] === 'https://image.tmdb.org/t/p/w185/x.jpg' && !(await page.$(wPanel + ' [data-showing] b')),
      'Majestic 10 from showtimes.json: escaped titles, bad times dropped, TMDB posters at w185', JSON.stringify(rows));
    await page.click(wPanel + ' [data-theater] button:has-text("Essex")');
    check(!(await page.$(wPanel + ' [data-showing] .lrow')) && await page.$eval(wPanel + ' [data-showtimes]', (a) => a.getAttribute('href')) === 'https://www.essexcinemas.com/vermont/essex/essex-cinemas-9/showtimes',
      'a theater that did not read: no rows, and its own Showtimes page (never the file’s link)', '');
    await page.click(wPanel + ' [data-theater] button:has-text("Partizanfilm")');
    check(await page.$eval(wPanel + ' [data-status]', (p) => p.textContent) === 'Burlington' && !(await page.$(wPanel + ' [data-showing] .lrow')), 'a theater missing from the file: just its button', '');
    await page.click(wPanel + ' [data-kind] button:has-text("TV")');
    await page.waitForTimeout(100);
    check(JSON.stringify((await wTiles(page)).slice(0, 2)) === '["tv1400","tv1401"]', 'live TV shelves from films.json', JSON.stringify((await wTiles(page)).slice(0, 2)));
    await page.click(wPanel + ' [data-grid] [data-k="tv1400"]');
    await page.waitForSelector('.sheet-body a[href*="themoviedb"]');
    check(await page.$eval('.sheet-body a[href*="themoviedb"]', (a) => a.getAttribute('href')) === 'https://www.themoviedb.org/tv/1400', 'a show links to its TMDB TV page', '');
    await page.click('.sheet-head .iconbtn');
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('allday-watch') || '{}').kind);
    await page.reload();
    await page.waitForSelector(wPanel + ' [data-kind] button.on', { timeout: 15000 });
    check(kept === 'tv' && await page.$eval(wPanel + ' [data-kind] button.on', (b) => b.textContent) === 'TV', 'the switch is remembered on this phone', String(kept));
    /* a title only the time machine knows: the link waits for it, then opens its sheet */
    await page.goto(base + '/all-day/#watch/f' + t1.id);
    await page.reload();
    await page.waitForSelector('.sheet-head', { timeout: 6000 }).catch(() => {});
    const head = await page.$eval('.sheet-head', (h) => h.textContent).catch(() => '');
    check(head.includes('<img src=x onerror=alert(1)>') && !(await page.$('.sheet-head img')), 'a deep link to a title from back then opens its sheet once the time machine arrives', head);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Watch, no time machine or showtimes yet (live)', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { films: await watchFilms(), tm: null, showtimes: null });
    await page.goto(base + '/all-day/#watch');
    await page.waitForSelector(wPanel + ' [data-sec="theaters"]', { timeout: 15000 });
    await page.waitForTimeout(500);
    check(!(await page.$(wPanel + ' [data-sec="back"]')), 'no time-machine file: no Back then', '');
    const btns = await page.$$eval(wPanel + ' [data-showtimes]', (n) => n.map((a) => a.getAttribute('href')));
    check(JSON.stringify(btns) === '["https://www.partizanfilm.org/"]' && !(await page.$(wPanel + ' [data-showing] .lrow')), 'no showtimes file: the theater rows still offer their Showtimes button', JSON.stringify(btns));
    check(errors.every((e) => /404/.test(e)), 'nothing but the two 404s in the console', errors.join(' | '));
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
    check(/Sign in to post\./.test(await page.$eval('.sheet-body', (b) => b.innerText)) && await page.$('.sheet-body form') === null, 'signed out, compose asks for sign-in and shows no form', '');
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
    check(p.ok && JSON.stringify(p.profile) === JSON.stringify({ display_name: 'Maya R.', neighborhood: 'old-north-end', archetype: 'trail', interests: [], handles: {}, handles_public: false }), 'saved, tidied, and read back', JSON.stringify(p));
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
    check(/Sign in to report/.test(await page.$eval('#toast', (t) => t.textContent)), 'signed out, report asks for sign-in', '');

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
    await page.goto(base + '/all-day/?demo=1#vintage');
    await settle(page);
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    /* signing in redraws the tab, and an evaluate that awaits the setup across that
       redraw can lose its promise ("Resulting promise was garbage collected", seen on
       2026-10-17) even though the setup ran. Start the setup in the page without
       awaiting it there, then wait for its done flag, so it runs exactly once. */
    await settle(page);
    await page.evaluate(() => {
      window.__boardsSetup = 'running';
      import('/all-day/js/boards.js').then(async (b) => {
        await b.setProfile({ display_name: 'Jess' });
        await b.create('vintage', { kind: 'swap', title: 'Two band tees for denim', meta: { want: 'Denim, 32' } });
        window.__boardsSetup = 'done';
      }, (e) => { window.__boardsSetup = 'failed: ' + e; });
    });
    await page.waitForFunction(() => window.__boardsSetup !== 'running', null, { timeout: 15000 });
    check(await page.evaluate(() => window.__boardsSetup) === 'done', 'the demo profile and swap post are set up', await page.evaluate(() => String(window.__boardsSetup)));
    await openCompose(page, { board: 'art', kind: 'photo', heading: 'Add a photo', title: 'What is it?', body: false, notes: ['Photos are checked before they show.'] });
    await page.fill('input[name=title]', 'Oakledge, low water');
    await page.click('.bform button[type=submit]');
    check(/This one needs a photo/.test(await page.$eval('.bf-msg', (m) => m.textContent)), 'an Art photo without a photo: refused', '');
    await page.setInputFiles('.bform input[type=file]', { name: 'dawn.jpg', mimeType: 'image/jpeg', buffer: PNG });
    await page.check('.bform input[name=consent]');
    await page.click('.bform button[type=submit]');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached', timeout: 4000 });
    check(/The photo shows once approved/.test(await page.$eval('#toast', (t) => t.textContent)), 'with a photo and consent: posted, the photo waits for the queue', await page.$eval('#toast', (t) => t.textContent));
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
    const habitsGone = await page.evaluate(() => import('/all-day/js/modes/habits.js').then((h) => { const f = h._fake(); return !f.members.has('demo-0000-4000-8000-00000000me00') && !f.habits.some((x) => x.user_id === 'demo-0000-4000-8000-00000000me00'); }));
    check(habitsGone, 'and so are their habits and taps (sz_delete_me)', '');
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
    check(!/LGBTQ|woman|student|gender|\bage\b/i.test(words) && /Private unless you join the directory/i.test(words), 'activities only, never who someone is, and who sees them is said', words);
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

  await group('boards: handles on the profile sheet, and the three new boards (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#vintage');
    await settle(page);
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.setProfile({ display_name: 'Maya' })));
    await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.profileSheet()));
    await page.waitForSelector('.sheet-body [data-handles] input[name="h:strava"]', { state: 'attached' });
    const H = '.sheet-body [data-handles]';
    const shape = await page.$eval(H, (w) => ({
      groups: [...w.querySelectorAll('details > summary')].map((x) => x.textContent),
      open: [...w.querySelectorAll('details')].map((d) => d.open),
      inputs: w.querySelectorAll('input[name^="h:"]').length,
      labelled: [...w.querySelectorAll('input[name^="h:"]')].every((i) => w.querySelector('label[for="' + i.id + '"]')),
      sw: (() => { const i = w.querySelector('input[name=handles_public]'); return i && [i.type, i.getAttribute('role'), i.checked, i.parentNode.textContent.trim()]; })(),
      hints: w.querySelectorAll('.bf-hint, .bf-note').length,
    }));
    check(JSON.stringify(shape.groups) === '["Social","Fitness","Games"]' && shape.inputs === 16 && shape.labelled, 'sixteen handle boxes, each labelled, in Social, Fitness and Games', JSON.stringify(shape));
    check(JSON.stringify(shape.open) === '[false,false,false]', 'folded while empty', JSON.stringify(shape.open));
    check(JSON.stringify(shape.sw) === '["checkbox","switch",false,"Show my handles in the directory"]' && shape.hints === 0, 'one switch, off, and no subtext', JSON.stringify(shape));
    await page.click(H + ' details:nth-of-type(1) > summary');
    await page.click(H + ' details:nth-of-type(2) > summary');
    await page.fill(H + ' input[name="h:instagram"]', 'instagram.com/maya');
    await page.fill(H + ' input[name="h:strava"]', '@maya_runs');
    await page.click('.sheet-body .bform button[type=submit]');
    await page.waitForTimeout(150);
    const err = await page.$eval('.sheet-body .bf-msg', (m) => m.textContent);
    check(/^Instagram: .*no link and no @/.test(err) && await page.$eval(H + ' input[name="h:instagram"]', (i) => i.getAttribute('aria-invalid')) === 'true', 'a link is refused, naming the box', err);
    await page.fill(H + ' input[name="h:instagram"]', 'maya.outside');
    await page.check(H + ' input[name=handles_public]');
    await page.click('.sheet-body .bform button[type=submit]');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached', timeout: 4000 });
    const saved = await fakeOf(page, (f) => { const p = f.profiles.get('demo-0000-4000-8000-00000000me00'); return { handles: p.handles, pub: p.handles_public }; });
    check(JSON.stringify(saved) === '{"handles":{"instagram":"maya.outside","strava":"maya_runs"},"pub":true}', 'saved without the @, the switch on', JSON.stringify(saved));
    await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.profileSheet()));
    await page.waitForSelector(H + ' input[name="h:strava"]', { state: 'attached' });
    const again = await page.$eval(H, (w) => [w.querySelector('input[name="h:strava"]').value, w.querySelector('input[name=handles_public]').checked, [...w.querySelectorAll('details')].map((d) => d.open)]);
    check(JSON.stringify(again) === '["maya_runs",true,[true,true,false]]', 'the sheet opens on what was saved, the folds with handles open', JSON.stringify(again));
    await page.$eval(H, (w) => w.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, 'demo-handles.png') });
    const recent = await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.handlesRecent(['strava'], 5)));
    check(recent.ok && recent.people.length >= 2 && recent.people[0].display_name === 'Maya' && recent.people[0].me === true &&
      recent.people.every((x) => Object.keys(x.handles).every((k) => k === 'strava')) && !/@|user_id/.test(JSON.stringify(recent)), 'handlesRecent: newest first, only the kinds asked for, no account ids', JSON.stringify(recent).slice(0, 300));
    const lists = await page.evaluate(() => import('/all-day/js/boards.js').then((b) => Promise.all(['games', 'square', 'gatherings'].map((x) => b.list(x).then((r) => r.posts.length)))));
    check(lists.every((n) => n >= 3), 'the demo has posts on Games, the Square and Gatherings', JSON.stringify(lists));
    const g = await page.evaluate(() => import('/all-day/js/boards.js').then(async (b) => {
      const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const meta = { when: day(3) + ', 7 pm', place: 'Leddy Park', kind: 'pickup', link: 'https://example.com/ultimate' };
      const past = await b.create('gatherings', { kind: 'gathering', title: 'Ultimate', meta: { ...meta, when: day(-2) } });
      const ok = await b.create('gatherings', { kind: 'gathering', title: 'Ultimate', meta });
      return [past.error, ok.ok && ok.post.status, ok.ok && ok.post.meta.link];
    }));
    check(JSON.stringify(g) === '["bad_date","pending","https://example.com/ultimate"]', 'a gathering in the past is refused; a coming one waits for Stephen, its link kept', JSON.stringify(g));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('boards: handles over the wire, and before round four (live)', async () => {
    const calls = [];
    let v = 3;
    const { ctx, page, errors } = await newPage(browser, base, {
      rpc: (fn, args, h) => {
        if (!/^nn_/.test(fn)) return undefined;
        calls.push({ fn, args, auth: h.authorization || null });
        if (fn === 'nn_rules') return { version: v };
        if (fn === 'nn_profile_get') return v >= 3 ? { display_name: 'Maya', neighborhood: 'south-end', archetype: null, interests: ['running'], handles: {}, handles_public: false }
          : { display_name: 'Maya', neighborhood: 'south-end', archetype: null, interests: ['running'] };
        if (fn === 'nn_profile_set') return { display_name: args.p_display_name, neighborhood: args.p_neighborhood, archetype: args.p_archetype, interests: ['running'],
          ...('p_handles' in args ? { handles: args.p_handles, handles_public: !!args.p_handles_public } : {}) };
        if (fn === 'nn_handles_recent') return v >= 3 ? [{ display_name: 'Sam', neighborhood: null, handles: { strava: 'sam_rides' }, updated_at: new Date().toISOString(), me: false }]
          : { status: 404, body: { code: 'PGRST202', message: 'Could not find the function public.nn_handles_recent' } };
        return undefined;
      },
    });
    await page.goto(base + '/all-day/?x=1');
    await page.evaluate((s) => localStorage.setItem('allday-auth', s), SESSION());
    await page.goto(base + '/all-day/#wire');
    await settle(page);
    const r = await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.setHandles({ strava: 'maya_runs', psn: '' }, true)));
    const set = calls.find((c) => c.fn === 'nn_profile_set');
    check(r.ok && set && JSON.stringify(set.args) === JSON.stringify({ p_display_name: 'Maya', p_neighborhood: 'south-end', p_archetype: null, p_interests: null, p_handles: { strava: 'maya_runs' }, p_handles_public: true })
      && /^Bearer /.test(set.auth || ''), 'setHandles sends round four’s call, keeping the rest of the profile, with the reader’s token', JSON.stringify(set));
    check(r.ok && JSON.stringify(r.profile.handles) === '{"strava":"maya_runs"}' && r.profile.handles_public === true && JSON.stringify(r.profile.interests) === '["running"]', 'and the profile comes back whole', JSON.stringify(r));
    const bad = await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.setHandles({ strava: 'strava.com/athletes/1' })));
    check(bad.error === 'bad_handle' && bad.key === 'strava' && calls.filter((c) => c.fn === 'nn_profile_set').length === 1, 'a bad handle never leaves the phone', JSON.stringify(bad));
    const rec = await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.handlesRecent(['strava'], 5)));
    const hr = calls.find((c) => c.fn === 'nn_handles_recent');
    check(rec.ok && rec.people[0].display_name === 'Sam' && JSON.stringify(hr.args) === '{"p_kinds":["strava"],"p_limit":5}', 'handlesRecent asks for the kinds and the limit', JSON.stringify(hr));
    /* a server with round two only */
    v = 2;
    calls.length = 0;
    await page.reload();
    await settle(page);
    const off = await page.evaluate(() => import('/all-day/js/boards.js').then(async (b) => [await b.setHandles({ strava: 'maya_runs' }, true), await b.handlesRecent([]), b.status(),
      await b.setProfile({ display_name: 'Maya', interests: ['running'], handles: { strava: 'maya_runs' } }), await b.roundFour()]));
    check(off[0].error === 'off' && off[1].error === 'off' && off[2] !== 'off', 'before round four: handles are “off”, the boards are not', JSON.stringify(off.slice(0, 3)));
    const set2 = calls.filter((c) => c.fn === 'nn_profile_set');
    check(set2.length === 1 && !('p_handles' in set2[0].args) && JSON.stringify(set2[0].args.p_interests) === '["running"]' && off[3].handlesSaved === false && off[4] === false,
      'setProfile saves the rest with round two’s call and says the handles wait', JSON.stringify(set2));
    check(!errors.filter((e) => !/status of 404/.test(e)).length, 'no console errors beyond the browser logging the 404', errors.join(' | '));
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
    const grids = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.panel:not([hidden]) [data-grid]')].map((g) => [g.dataset.grid, g.querySelectorAll('.card.board, .ftile').length])));
    check(grids.spotted === 8 && grids.swaps === 3 && grids.fit === 3 && grids.sent === 3, 'eight finds, three swaps, three fit checks and three designs sent in, from the demo', JSON.stringify(grids));
    const lefts = await page.$$eval(vslot('spotted') + ' .card.board', (cs) => cs.map((c) => (c.querySelector('.tag-left') || {}).textContent || ''));
    check(lefts.every((t) => /^\d+d left$/.test(t)) && new Set(lefts).size > 4, 'every find shows its days left, and they differ', JSON.stringify(lefts));
    const votes = await page.$$eval(vslot('spotted') + ' [data-act=bvote]', (bs) => bs.map((b) => b.getAttribute('aria-label')));
    check(votes.every((v) => v === 'I’d want this'), 'the vote on a find is “I’d want this”', JSON.stringify(votes.slice(0, 2)));
    check(!(await page.$(vslot('spotted') + ' [data-act=vgot]')), 'nobody signed in owns a find, so no “Someone got it”', '');
    const chipsRow = await page.$$eval('#subnav .chip', (cs) => cs.map((c) => c.dataset.chip));
    check(JSON.stringify(chipsRow) === JSON.stringify(['fit', 'spotted', 'swaps', 'newin', 'shops', 'tees']), 'the chip row is the table of contents: Fit checks, Spotted, Swaps (up top, by Spotted), New in, Shops, Make a tee', JSON.stringify(chipsRow));
    await page.click('#subnav .chip[data-chip="tees"]');
    /* a smooth scroll, and the fourteen shops above Make a tee make it a long one */
    await page.waitForFunction((sel) => { const t = document.querySelector(sel).getBoundingClientRect().top; return t >= 0 && t < 300; }, vslot('tees'), { timeout: 4000 }).catch(() => {});
    const teeTop = await page.$eval(vslot('tees'), (s) => Math.round(s.getBoundingClientRect().top));
    check(teeTop >= 0 && teeTop < 300, 'a chip scrolls its section up under the mast', teeTop);
    await page.click(vslot('spotted') + ' .addrow button');
    await page.waitForSelector('.sheet-body .linkrow');
    check(/Sign in to post\./.test(await page.$eval('.sheet-body', (b) => b.innerText)) && !(await page.$('.sheet-body form')), 'Post a find, signed out: the sign-in note and no form', '');
    await page.click('.sheet-head .iconbtn');
    await page.click(vslot('fit') + ' [data-act=vfitpost]');
    await page.waitForSelector('.sheet-body .linkrow');
    check(/Sign in to post\./.test(await page.$eval('.sheet-body', (b) => b.innerText)) && !(await page.$('.sheet-body form')), 'Post a fit check, signed out: the same', '');
    await page.click('.sheet-head .iconbtn');
    await page.click(vslot('make') + ' .textcard button');
    await page.waitForSelector('.sheet-body .linkrow');
    check(/Sign in to post\./.test(await page.$eval('.sheet-body', (b) => b.innerText)) && !(await page.$('.sheet-body form')), 'Send in your design, signed out: the same', '');
    await page.click('.sheet-head .iconbtn');
    await pageRules(page, 'vintage', 390);
    check(!errors.length, 'no console errors', errors.join(' | '));
    check(!supabase.length, 'demo mode never calls Supabase', supabase.join(', '));
    await ctx.close();
  });

  await group('Vintage, fit checks and Spotted share the first screen at 390; a tile opens the fit’s own card; New in is the shops’ own posts (demo)', async () => {
    const { ctx, page, errors } = await vintageDemo(browser, base, { viewport: { width: 390, height: 844 } });
    await page.waitForSelector(vslot('fit') + ' .ftile');
    const top = await page.evaluate(() => {
      const q = (k) => document.querySelector('.panel:not([hidden]) [data-sec="' + k + '"]');
      return { vh: innerHeight, order: [...q('fit').parentElement.children].map((c) => c.dataset.sec).filter(Boolean),
        fitHead: q('fit').querySelector('.sec h2').textContent, fitBottom: q('fit').querySelector('.ftile').getBoundingClientRect().bottom,
        spotHead: q('spotted').querySelector('.sec h2').textContent, spotHeadBottom: q('spotted').querySelector('.sec').getBoundingClientRect().bottom,
        spotCard: q('spotted').querySelector('.card.board').getBoundingClientRect().top };
    });
    check(JSON.stringify(top.order.slice(0, 4)) === '["fit","spotted","swaps","newin"]' && top.fitHead === 'Fit checks' && top.spotHead === 'Spotted this week', 'Fit checks leads the tab, then Spotted this week, then Swaps (moved up from the bottom), then New in', JSON.stringify(top));
    const why = await page.$eval(vslot('spotted') + ' .sec + p', (p) => p.textContent).catch(() => '');
    check(why === 'Saw something great that wasn’t your size? Post it so someone else can grab it.', 'one plain line under Spotted this week says what it is for', why);
    check(top.fitBottom <= top.vh && top.spotHeadBottom <= top.vh && top.spotCard < top.vh, 'at 390 by 844 the fit tiles, the Spotted head and the first find are all on the first screen', JSON.stringify(top));
    const tiles = await page.$$eval(vslot('fit') + ' .ftile', (ts) => ts.map((t) => ({ k: t.dataset.k, pic: !!t.querySelector('.c-media.r45 .ph, .c-media.r45 img'), t: t.querySelector('.t').textContent, s: t.querySelector('.s').textContent })));
    check(tiles.length === 3 && tiles.every((t) => t.pic && /^b-/.test(t.k) && t.t && t.s), 'each fit check is a photo tile with its title and first name', JSON.stringify(tiles));
    await page.click(vslot('fit') + ' .ftile');
    await page.waitForSelector('.sheet-body .card.board');
    const open = await page.$eval('.sheet-body .card.board', (c) => ({ k: c.dataset.k, title: c.querySelector('.b-title').textContent, vote: c.querySelector('[data-act=bvote]').getAttribute('aria-label'), rep: !!c.querySelector('[data-act=breport]'), media: !!c.querySelector('.c-media') }));
    check(open.k === tiles[0].k && open.title === tiles[0].t && open.vote === 'Love this fit' && open.rep && open.media, 'a tile opens the post’s own card: the photo, “Love this fit”, share and report', JSON.stringify(open));
    await page.click('.sheet-body .card.board [data-act=bvote]');
    await page.waitForTimeout(300);
    check(await page.$eval('.sheet-body .card.board [data-act=bvote]', (b) => b.getAttribute('aria-pressed')) === 'true', 'and the vote works from the sheet', '');
    await page.click('.sheet-head .iconbtn');
    const d = await readFile(path.join(APP, 'data/demo/vintage.json'), 'utf8').then(JSON.parse);
    const fresh = d.instagramPosts.filter((x) => d.instagram.includes(x.h) && Date.parse(d.anchor) / 1000 - x.ts < 14 * 86400).sort((a, b) => b.ts - a.ts);
    const ig = await page.$$eval(vslot('newin') + ' [data-rail=newin] a.vcard', (as) => as.map((a) => ({ href: a.getAttribute('href'), who: a.querySelector('.t').textContent, s: a.querySelector('.s').textContent })));
    check(ig.length === fresh.length && ig.length >= 3 && ig.every((x, i) => x.href === fresh[i].u && x.who === '@' + fresh[i].h), 'New in: the shops’ own posts from the last two weeks, newest first, each credited to its account and linked to the post', JSON.stringify(ig));
    check(!ig.some((x) => /DemoVin5|DemoVin6/.test(x.href)), 'a three-week-old post and an account that is not a shop stay off', JSON.stringify(ig.map((x) => x.href)));
    const chipN = await page.$eval('#subnav .chip[data-chip="newin"] .n', (n) => n.textContent);
    check(chipN === String(fresh.length), 'the New in chip counts them', chipN);
    await pageRules(page, 'vintage', 390);
    await page.screenshot({ path: path.join(SHOTS, 'demo-vintage-top-390.png') });
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Vintage, New in reads the shops’ accounts from the guide and leaves the rest out (live)', async () => {
    const file = await vintageShops();
    const shopHandle = file.instagram.find((h) => h !== 'burlingtonvintagemarket') || file.instagram[0];
    const now = Math.floor(Date.now() / 1000);
    const lapsed = (now - 3600).toString(16);
    const posts = [
      { h: shopHandle, ts: now - 7200, i: 'https://scontent.example/a.jpg', u: 'https://www.instagram.com/p/LiveVin1/', w: 480, c: 'New rack', s: 'do' },
      { h: 'not_a_thrift_shop', ts: now - 3600, i: 'https://scontent.example/b.jpg', u: 'https://www.instagram.com/p/LiveVin2/', w: 480, c: 'Brunch', s: 'see' },
      { h: shopHandle, ts: now - 20 * 86400, i: 'https://scontent.example/c.jpg', u: 'https://www.instagram.com/p/LiveVin3/', w: 480, c: 'Old', s: 'do' },
      { h: shopHandle, ts: now - 600, i: 'https://scontent.example/d.jpg?oe=' + lapsed, u: 'https://www.instagram.com/p/LiveVin4/', w: 480, c: 'Picture link lapsed', s: 'do' },
    ];
    const { ctx, page, errors } = await newPage(browser, base, { routes: [[/\/all-day\/data\/instagram\.json/, { generated: new Date().toISOString(), handles: [], posts }]] });
    await page.route(/scontent\.example/, (r) => r.fulfill({ status: 200, body: PNG, contentType: 'image/png' }));
    await page.goto(base + '/all-day/#vintage');
    await settle(page);
    await page.waitForSelector(vslot('newin') + ' [data-rail=newin] a.vcard', { timeout: 6000 }).catch(() => {});
    const ig = await page.$$eval(vslot('newin') + ' [data-rail=newin] a.vcard', (as) => as.map((a) => ({ href: a.href, target: a.target })));
    check(file.instagram.length >= 1 && ig.length === 1 && ig[0].href === 'https://www.instagram.com/p/LiveVin1/' && ig[0].target === '_blank', 'only the guide’s own account’s fresh post shows, opening Instagram in a new tab', JSON.stringify(ig));
    check(!errors.length, 'no console errors', errors.join(' | '));
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
    check(/The photo shows once approved\./.test(await page.$eval('.sheet-body', (b) => b.innerText)), 'the sheet says, in one line, the photo shows once approved', '');
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
    check(t1.n === t0.n + 1 && new RegExp(t1.n + ' finds found a home lately').test(t1.text), 'the thank-you line counts one more find gone home', JSON.stringify([t0, t1]));
    check(/Thank you\./.test(t1.text) && !/raffle|enter to win|\bearn|\bdraw\b|points|prizes/i.test(t1.text), 'a thank-you, and nothing about points, prizes or a raffle', t1.text);
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
    const ROUTE = ['Downtown / Church St', 'Waterfront', 'South End', 'Hill Section', 'Old North End', 'New North End', 'Winooski', 'Colchester', 'Essex / Essex Jct', 'Williston', 'South Burlington', 'Shelburne', 'Greater Burlington'];
    const walk = file.shops.filter((s) => !s.after_walk);
    const ranks = walk.map((s) => ROUTE.indexOf(s.neighborhood));
    check(ranks.every((r) => r >= 0) && ranks.every((r, i) => i === 0 || r >= ranks[i - 1]), 'the walk goes downtown, the South End, the Old North End and Winooski, then drives Colchester, Essex, Williston, South Burlington, Shelburne', JSON.stringify(walk.map((s) => s.neighborhood)));
    const firstAfter = file.shops.findIndex((s) => s.after_walk);
    check(firstAfter > 0 && file.shops.slice(firstAfter).every((s) => s.after_walk) && file.shops[firstAfter - 1].next === null && file.shops.find((s) => s.id === 'speaking-volumes').after_walk,
      'used books (Speaking Volumes) come last, after the walk, with no leg into them', JSON.stringify(file.shops.slice(firstAfter - 1).map((s) => s.name)));
    const towns = new Set(walk.map((s) => s.neighborhood));
    check(['Essex / Essex Jct', 'Williston', 'South Burlington', 'Shelburne'].every((t) => towns.has(t)) && file.shops.some((s) => /plato/i.test(s.name)), 'greater Burlington, not just the city: Essex, Williston (Plato’s Closet), South Burlington, Shelburne', JSON.stringify([...towns]));
    const byId = Object.fromEntries(things.map((t) => [t.id, t]));
    check(file.shops.every((s) => byId[s.id] && byId[s.id].group === 'Shopping' && byId[s.id].name === s.name), 'every shop is one of things.json’s Shopping entries: none invented', '');
    const records = things.filter((t) => t.category === 'Record Store').map((t) => t.id);
    check(records.includes('burlington-records') && !file.shops.some((s) => records.includes(s.id)), 'a record store is not a thrift: Burlington Records stays in things.json and out of the guide', JSON.stringify(records));
    check(file.shops.every((s) => byId[s.id].checked && /^https?:\/\//.test(byId[s.id].checked.source) && byId[s.id].checked.note), 'every shop in the guide has a checked record: the date, the page and what was read there', JSON.stringify(file.shops.filter((s) => !byId[s.id].checked).map((s) => s.name)));
    const byAddr = {};
    file.shops.forEach((s) => { (byAddr[s.address] = byAddr[s.address] || []).push(s.id); });
    const twice = Object.values(byAddr).filter((ids) => ids.length > 1 && ids.sort().join() !== 'barge-canal-market,speaking-volumes');
    check(new Set(file.shops.map((s) => s.id)).size === file.shops.length && !twice.length, 'no shop twice: every id and every address once (Barge Canal Market and Speaking Volumes share 377 Pine St)', JSON.stringify(twice));
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
    const builder = await readFile(path.join(REPO, 'scripts/build_merch_rail.py'), 'utf8');
    check(/variant\.get\("file"\)/.test(builder) && !/front\.get\("prev"\)|design\.get\("front"\)/.test(builder),
      'each preview is the full design (the merch data’s variant art), not the small left-chest patch it calls `front`', '');
    const { ctx, page, errors } = await newPage(browser, base, { viewport: { width: 1280, height: 800 } });
    await page.goto(base + '/all-day/#vintage/tees');
    await settle(page);
    await page.waitForSelector(vslot('tees') + ' a.vcard');
    const cardsOut = await page.$$eval(vslot('tees') + ' a.vcard', (as) => as.map((a) => ({ href: a.href, name: a.querySelector('.t').textContent, target: a.target, img: a.querySelector('img').getAttribute('src') })));
    check(cardsOut.length === d.designs.length && cardsOut.every((c, i) => c.href === 'https://merch.btownbrief.com/#/p/huba/d/' + d.designs[i].id && c.name === d.designs[i].name),
      'every design links to its own page on merch.btownbrief.com, where it is shown on a model', JSON.stringify(cardsOut.slice(0, 2)));
    check(cardsOut.every((c) => c.target === '_blank' && /^\.\/assets\/merch\/\d+\.webp$/.test(c.img)), 'they open in a new tab, with the small local preview', JSON.stringify(cardsOut[0]));
    await page.$eval(vslot('tees'), (s) => s.scrollIntoView());   /* the previews load lazily, and Fit checks now sits above the rail */
    const loaded = await page.$$eval(vslot('tees') + ' a.vcard img', (is) => Promise.all(is.slice(0, 4).map((i) => (i.complete ? i.naturalWidth : new Promise((r) => { i.onload = () => r(i.naturalWidth); i.onerror = () => r(0); setTimeout(() => r(i.naturalWidth), 6000); })))));
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
    await page.click(vslot('fit') + ' [data-act=vfitpost]');
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
    const titles = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.panel:not([hidden]) [data-grid]')].map((g) => [g.dataset.grid, [...g.querySelectorAll('.b-title, .ftile .t')].map((t) => t.textContent)])));
    check(JSON.stringify(titles) === JSON.stringify({ fit: ['My Sunday fit', 'Head to toe Old Gold'], spotted: ['Barn jacket'], swaps: ['Band tees'], sent: ['Moth on the steeple', 'Lake ink'] }),
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
    check(/Camel’s Hump in gouache by Dev/.test(shirt.text) && !/Art wall/.test(shirt.text) && /submissions\/art-1\.jpg$/.test(shirt.img), 'an old Art “Put it on a shirt” link still opens the piece here, picture, title and maker, with no button to a wall that has gone', JSON.stringify(shirt));
    check(!/\$\s?\d|\bprice\b/i.test(shirt.text), 'and it names no price', shirt.text);
    check(calls.some((c) => c.fn === 'nn_posts_list' && c.args.p_board === 'art' && JSON.stringify(c.args.p_filter) === '{"meta":{"shirt":"yes"}}'), 'it looks only among Art posts whose maker said yes to a shirt', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  /* --------------------------------------------- colour in the shop guide */
  /* The kind a shop's colour comes from: its first kind, as vintage.js reads it */
  const vKind = (k) => (/vintage/i.test(k) ? 'vintage' : /thrift|restore/i.test(k) ? 'thrift' : /consign/i.test(k) ? 'consign' : /antique/i.test(k) ? 'antique' : /book/i.test(k) ? 'books' : 'thrift');
  /* contrast of two computed colours (rgb() or color(srgb …)), WCAG's formula */
  const CONTRAST = `(() => {
    const lum = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c); const n = /color\\(srgb ([^)]+)\\)/.exec(c);
      const v = m ? m[1].split(/[\\s,\\/]+/).filter(Boolean).slice(0, 3).map((x) => Number(x) / 255) : n[1].split(/[\\s\\/]+/).filter(Boolean).slice(0, 3).map(Number);
      const f = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2]); };
    return (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  })()`;
  for (const scheme of ['light', 'dark']) await group('Vintage, the shop guide in colour: a badge per kind, the kinds in colour, a divider per neighborhood (live, ' + scheme + ')', async () => {
    const file = await vintageShops();
    const { ctx, page, errors } = await newPage(browser, base, { scheme });
    await page.goto(base + '/all-day/#vintage/shops');
    await settle(page);
    await page.waitForSelector(vslot('shops') + ' .lrow.vshop');
    const g = await page.evaluate(([sel, contrast]) => {
      const ratio = eval(contrast);
      const probe = document.createElement('i'); probe.style.color = 'var(--paper)'; document.body.appendChild(probe);
      const paper = getComputedStyle(probe).color; probe.remove();
      const host = document.querySelector(sel);
      const rows = [...host.querySelectorAll('.lrow.vshop')].map((r) => { const b = r.querySelector('.num.vbadge'), cs = getComputedStyle(b);
        return { cls: b.className, bg: cs.backgroundColor, ink: cs.color, contrast: ratio(cs.backgroundColor, cs.color), weight: Number(getComputedStyle(r.querySelector('.t')).fontWeight),
          kinds: [...r.querySelectorAll('[data-kinds] .vk')].map((k) => ({ cls: k.className, text: k.textContent, contrast: ratio(getComputedStyle(k).color, paper) })) }; });
      const hoods = [...host.querySelectorAll('.tdiv.vhood')].map((d) => { const cs = getComputedStyle(d); return { name: d.dataset.hood, line: cs.borderBottomColor, w: cs.borderBottomWidth, ink: cs.color }; });
      const plain = getComputedStyle(host.querySelector('.lrow.vshop')).borderBottomColor;
      const keys = [...host.querySelectorAll('[data-keys] .vk')].map((k) => ({ text: k.textContent, dot: getComputedStyle(k.querySelector('i')).backgroundColor }));
      return { rows, hoods, plain, keys, order: [...host.querySelector('.vshops').children].map((c) => (c.classList.contains('vhood') ? 'h:' + c.dataset.hood : c.classList.contains('vshop') ? 'r' : '')).filter(Boolean) };
    }, [vslot('shops'), CONTRAST]);
    check(g.rows.length === file.shops.length && g.rows.every((r, i) => r.cls.includes('k-' + vKind(file.shops[i].kinds[0]))), 'every number is a badge in its shop’s first kind’s colour', JSON.stringify(g.rows.slice(0, 3).map((r) => r.cls)));
    const byKind = {};
    g.rows.forEach((r) => { byKind[/k-(\w+)/.exec(r.cls)[1]] = r.bg; });
    check(Object.keys(byKind).length === 5 && new Set(Object.values(byKind)).size === 5, 'five kinds, five colours: thrift, vintage, consignment, antiques, used books', JSON.stringify(byKind));
    check(g.rows.every((r) => r.contrast >= 4.5), 'every badge’s number reads on its colour (4.5:1 or better)', JSON.stringify(g.rows.map((r) => r.contrast.toFixed(1))));
    check(g.rows.every((r) => r.weight >= 700), 'the shop’s name is a touch bolder', JSON.stringify(g.rows.slice(0, 2).map((r) => r.weight)));
    const allKinds = g.rows.flatMap((r) => r.kinds);
    check(allKinds.length && allKinds.every((k) => /k-\w+/.test(k.cls) && k.contrast >= 4.5) && g.rows.every((r, i) => r.kinds.map((k) => k.text).join() === file.shops[i].kinds.join()),
      'each kind is named in its own colour, readable on the page', JSON.stringify(allKinds.filter((k) => k.contrast < 4.5)));
    const groups = file.shops.map((s) => (s.after_walk ? 'Used books' : s.neighborhood)).filter((x, i, a) => !i || x !== a[i - 1]);
    check(JSON.stringify(g.hoods.map((h) => h.name)) === JSON.stringify(groups), 'a divider names each neighborhood as the walk enters it, Used books last', JSON.stringify(g.hoods.map((h) => h.name)));
    check(g.order[0] === 'h:' + groups[0] && g.order.filter((x) => x === 'r').length === file.shops.length, 'the first shop sits under its neighborhood', g.order.slice(0, 3).join(','));
    check(g.hoods.every((h) => h.w === '2px' && h.line !== g.plain && h.line === g.hoods[0].line), 'the dividers are one colour, not the grey hairline between shops', JSON.stringify([g.hoods[0], g.plain]));
    check(JSON.stringify(g.keys.map((k) => k.text)) === JSON.stringify(['Vintage', 'Thrift', 'Consignment', 'Antiques', 'Used books']) && new Set(g.keys.map((k) => k.dot)).size === 5,
      'a key under the head names the five colours', JSON.stringify(g.keys));
    await pageRules(page, 'vintage', 390);
    await page.$eval(vslot('shops'), (s) => s.scrollIntoView());
    await page.screenshot({ path: path.join(SHOTS, 'live-vintage-guide-' + scheme + '.png') });
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  /* ------------------------------------------------------------- the shop map */
  /* Leaflet is not on this machine, as for Food: the stand-in answers the
     pinned URL, the integrity setter records the hashes, and the fake L
     records what the map was told: markers with their number icons, the
     bounds it was fitted to, any setView. */
  const vFakeSri = `window.__sri = [];
    Object.defineProperty(HTMLScriptElement.prototype, 'integrity', { configurable: true, set(v) { window.__sri.push(v); }, get() { return ''; } });
    Object.defineProperty(HTMLLinkElement.prototype, 'integrity', { configurable: true, set(v) { window.__sri.push(v); }, get() { return ''; } });`;
  const V_FAKE_L = `window.L = (() => {
    const maps = [];
    const layer = (kind, at, o) => ({ kind, at, o, addTo(m) { m.layers.push(this); return this; }, bindTooltip(t) { this.tip = t; return this; },
      on(ev, fn) { this['on' + ev] = fn; return this; }, remove() { this.gone = true; } });
    return { maps, map(el, opts) { const m = { el, opts, layers: [], fits: [], views: [], fitBounds(b, o) { this.fits.push(b); return this; }, setView(c, z) { this.views.push(c); return this; },
      setZoom(z) { this.views.push(z); return this; }, getCenter() { return [44.47, -73.15]; }, getZoom() { return 12; },
      invalidateSize() {}, remove() { this.removed = true; }, getContainer() { return el; } }; maps.push(m); return m; },
      tileLayer(u, o) { return layer('tiles', u, o); }, circleMarker(c, o) { return layer('dot', c, o); }, marker(c, o) { return layer('pin', c, o); },
      divIcon(o) { return { divIcon: o }; } };
  })();`;
  const vWithLeaflet = async (page, asked) => {
    await page.addInitScript(vFakeSri);
    await page.route(/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.(js|css)$/, (r) => { asked.push(r.request().url());
      return /\.js$/.test(r.request().url()) ? r.fulfill({ status: 200, body: V_FAKE_L, contentType: 'text/javascript' }) : r.fulfill({ status: 200, body: '', contentType: 'text/css' }); });
  };
  const vMap = (page) => page.evaluate(() => { const m = window.L && window.L.maps && window.L.maps[window.L.maps.length - 1]; if (!m) return null;
    return { inSheet: !!m.el.closest('.sheet-body'), fits: m.fits, views: m.views, tiles: m.layers.filter((l) => l.kind === 'tiles').map((l) => ({ u: l.at, attr: l.o.attribution })),
      pins: m.layers.filter((l) => l.kind === 'pin').map((l) => ({ at: l.at, tip: l.tip, title: l.o.title, html: l.o.icon.divIcon.html, cls: l.o.icon.divIcon.className })),
      me: m.layers.filter((l) => l.kind === 'dot' && /vm-me/.test(l.o.className) && !l.gone).map((l) => l.at) }; });
  const VCH = [44.4758, -73.2128];
  const vMi = (a, b) => { const R = 3958.8, rad = Math.PI / 180, dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    return 2 * R * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2)); };

  await group('Vintage, the shop map: a picture by the guide’s head, every shop a numbered pin, a pin opens its shop (live, location refused)', async () => {
    const file = await vintageShops();
    const pinned = file.shops.map((s, i) => ({ s, i })).filter(({ s }) => Array.isArray(s.coords) && s.coords.length === 2);
    const town = pinned.filter(({ s }) => vMi(s.coords, VCH) <= 1).map(({ s }) => s.coords);
    const { ctx, page, errors } = await newPage(browser, base);
    const asked = [], out = [];
    await vWithLeaflet(page, asked);
    page.on('request', (q) => { if (!q.url().startsWith(base)) out.push(q.url()); });
    await page.goto(base + '/all-day/#vintage/shops');
    await settle(page);
    await page.waitForSelector(vslot('shops') + ' .sec .mapbtn');
    const btn = await page.evaluate((sel) => { const b = document.querySelector(sel + ' .sec .mapbtn'), sec = b.closest('.sec');
      return { last: sec.lastElementChild === b, head: sec.querySelector('h2').textContent, label: b.getAttribute('aria-label'), text: b.innerText,
        dots: [...b.querySelectorAll('.vm-dot')].map((d) => d.getAttribute('class')), fills: new Set([...b.querySelectorAll('.vm-dot')].map((d) => getComputedStyle(d).fill)).size }; }, vslot('shops'));
    check(btn.last && btn.head === 'The shop guide' && /Map/.test(btn.text), 'a Map button sits beside “The shop guide”', JSON.stringify(btn));
    check(btn.dots.length >= 8 && btn.dots.every((c) => /vm-dot k-\w+/.test(c)) && btn.fills >= 3, 'its picture is the walk as dots, each in its kind’s colour', JSON.stringify(btn));
    check(btn.label === 'Map of ' + pinned.length + ' shops' && pinned.length === file.shops.length, 'it maps every shop in the guide (' + pinned.length + ')', btn.label);
    check(!asked.length && !out.some((u) => /unpkg|tile\.openstreetmap/.test(u)) && await page.evaluate(() => !window.L), 'before a tap: no Leaflet, no tiles, nothing fetched', out.join(', '));
    await page.click(vslot('shops') + ' .mapbtn');
    await page.waitForFunction(() => window.L && window.L.maps && window.L.maps.length && window.L.maps[0].layers.length, null, { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(150);
    const m = await vMap(page);
    check(asked.some((u) => /leaflet\.js$/.test(u)) && asked.some((u) => /leaflet\.css$/.test(u)), 'a tap loads Leaflet 1.9.4 and its stylesheet', asked.join(', '));
    check(await page.evaluate(() => window.__sri.includes('sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=') && window.__sri.includes('sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=')),
      'with the integrity hashes Food and the guide’s own map pages use', await page.evaluate(() => window.__sri.join(', ')));
    check(m && m.inSheet && await page.$eval('.sheet-head h2', (h) => h.textContent) === 'Shop map', 'the map opens in a sheet', JSON.stringify(m && m.inSheet));
    check(m && m.tiles.length === 1 && m.tiles[0].u === 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' && /OpenStreetMap/.test(m.tiles[0].attr), 'on OpenStreetMap’s tiles from its one tile host, credited', JSON.stringify(m && m.tiles));
    check(m && m.pins.length === pinned.length && m.pins.every((p, n) => { const { s, i } = pinned[n];
      return p.html === String(i + 1) && p.title === (i + 1) + '. ' + s.name && JSON.stringify(p.at) === JSON.stringify(s.coords) && p.cls === 'vm-pin k-' + vKind(s.kinds[0]); }),
      'every shop is a pin at its own spot, carrying its number from the guide, in its kind’s colour', JSON.stringify(m && m.pins.slice(0, 2)));
    check(m && m.fits.length >= 1 && m.fits.every((f) => JSON.stringify(f) === JSON.stringify(town)) && !m.views.length && !m.me.length,
      'it opens on the ' + town.length + ' shops a walk away, with no reader pin and no location asked', JSON.stringify(m && { fits: m.fits.length, first: m.fits[0] && m.fits[0].length, views: m.views }));
    await page.click('.sheet-body .vspan');
    const wide = await vMap(page);
    check(/^On foot$/.test(await page.$eval('.sheet-body .vspan', (b) => b.textContent)) && wide.fits.length && wide.fits[wide.fits.length - 1].length === pinned.length,
      '“All ' + pinned.length + '” fits every shop, Essex to Shelburne', JSON.stringify(wide.fits.map((f) => f.length)));
    await page.click('.sheet-body .nearme');
    await page.waitForSelector('#toast:not([hidden])', { timeout: 6000 }).catch(() => {});
    check(/Location is off/.test(await page.$eval('#toast', (t) => t.textContent)) && !(await vMap(page)).me.length, 'Near me, refused: says so, and no dot', '');
    const pick = pinned.find(({ i }) => i === 11) || pinned[pinned.length - 1];
    await page.evaluate((title) => { const m = window.L.maps[window.L.maps.length - 1]; m.layers.find((l) => l.o && l.o.title === title).onclick(); }, (pick.i + 1) + '. ' + pick.s.name);
    const sheet = await page.evaluate(() => ({ h: document.querySelector('.sheet-head h2').textContent, num: (document.querySelector('.sheet-body .vbadge') || {}).textContent,
      cls: (document.querySelector('.sheet-body .vbadge') || {}).className, text: document.querySelector('.sheet-body').innerText, back: !!document.querySelector('.sheet-body [data-act=vmapback]') }));
    check(sheet.h === pick.s.name && sheet.num === String(pick.i + 1) && sheet.cls.includes('k-' + vKind(pick.s.kinds[0])) && sheet.back, 'a pin opens its shop: the same number, its colour, and the way back to the map', JSON.stringify(sheet));
    check(sheet.text.includes(pick.s.neighborhood) && (!pick.s.address || sheet.text.includes(pick.s.address.replace(/,\s*VT\s*\d{5}$/, ''))), 'with the shop’s neighborhood and street', sheet.text.slice(0, 160));
    await page.click('.sheet-body [data-act=vmapback]');
    await page.waitForTimeout(200);
    const backTo = await vMap(page);
    check(await page.$eval('.sheet-head h2', (h) => h.textContent) === 'Shop map' && backTo.pins.length === pinned.length, 'Back to the map puts the map back up', '');
    check(JSON.stringify(backTo.views[0]) === '[44.47,-73.15]' && !backTo.fits.length && await page.$eval('.sheet-body .vspan', (b) => b.textContent) === 'On foot',
      'where the reader left it: the same view, still on All', JSON.stringify({ views: backTo.views, fits: backTo.fits.length }));
    await page.screenshot({ path: path.join(SHOTS, 'live-vintage-map.png') });
    await page.goto(base + '/all-day/#vintage/map');
    await page.reload();
    await page.waitForSelector('.sheet-head h2', { timeout: 15000 }).catch(() => {});
    check(await page.$eval('.sheet-head h2', (h) => h.textContent).catch(() => '') === 'Shop map', '#vintage/map opens the map', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Vintage, the shop map with location allowed: the reader’s dot, and the map stays put (live)', async () => {
    const ME = { latitude: 44.4801, longitude: -73.2101 };   // up Church Street, by City Hall Park
    const { ctx, page, errors } = await newPage(browser, base, { geo: ME });
    const asked = [], sent = [];
    await vWithLeaflet(page, asked);
    page.on('request', (q) => sent.push(q.url() + ' ' + (q.postData() || '')));
    await page.addInitScript(() => { const g = navigator.geolocation, ask = g.getCurrentPosition.bind(g); window.__geo = 0; g.getCurrentPosition = (...a) => { window.__geo++; return ask(...a); }; });
    await page.goto(base + '/all-day/#vintage/shops');
    await settle(page);
    await page.waitForSelector(vslot('shops') + ' .sec .mapbtn');
    check(await page.evaluate(() => window.__geo) === 0, 'nothing asks for the location on load', '');
    await page.click(vslot('shops') + ' .mapbtn');
    await page.waitForFunction(() => { const m = window.L && window.L.maps && window.L.maps[0]; return m && m.layers.some((l) => l.kind === 'dot'); }, null, { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(200);
    const m = await vMap(page);
    check(m && m.me.length === 1 && JSON.stringify(m.me[0]) === JSON.stringify([ME.latitude, ME.longitude]), 'allowed before, the map shows the reader’s dot', JSON.stringify(m && m.me));
    const first = m && JSON.stringify(m.fits[0]);
    check(m && !m.views.length && m.fits.every((f) => JSON.stringify(f) === first) && !m.fits.some((f) => JSON.stringify(f).includes(String(ME.latitude))),
      'but the map is never moved to the reader: it stays on the shops', JSON.stringify(m && { views: m.views, fits: m.fits.length }));
    check(await page.$eval('.sheet-body .nearme', (b) => b.hidden), 'and Near me steps aside', '');
    const lat = String(ME.latitude), lon = String(ME.longitude);
    check(!sent.some((x) => x.includes(lat) || x.includes(lon)), 'the position is never sent anywhere', sent.filter((x) => x.includes(lat) || x.includes(lon)).join(', '));
    const stored = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)) + JSON.stringify(Object.entries(sessionStorage)) + document.cookie);
    check(!stored.includes(lat) && !stored.includes(lon), 'and never stored', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Vintage, Top designs: the designs neighbors sent in, most “I’d wear this” first, and the vote works (demo)', async () => {
    const { ctx, page, errors } = await vintageDemo(browser, base);
    const row = await page.evaluate((sel) => { const host = document.querySelector(sel);
      const r = host.querySelector('[data-grid=sent]');
      return { head: host.querySelector('.tdiv').textContent, rail: r.classList.contains('rail') && r.classList.contains('vtop'),
        cards: [...r.querySelectorAll('.card.board')].map((c) => ({ k: c.dataset.k, title: c.querySelector('.b-title').textContent, n: Number(c.querySelector('[data-act=bvote] .n').textContent) || 0, label: c.querySelector('[data-act=bvote]').getAttribute('aria-label') })) }; }, vslot('sent'));
    check(row.head === 'Top designs' && row.rail, 'the designs sent in are a row called Top designs', JSON.stringify(row.head));
    check(JSON.stringify(row.cards.map((c) => c.title)) === JSON.stringify(['Champ in the chop, linocut', 'Rainy Church Street, ink', 'Old North End porches']) && row.cards.every((c, i) => !i || c.n <= row.cards[i - 1].n),
      'sorted by votes, most first', JSON.stringify(row.cards));
    check(row.cards.every((c) => c.label === 'I’d wear this'), 'the vote on a design is “I’d wear this”', JSON.stringify(row.cards.map((c) => c.label)));
    const last = row.cards[row.cards.length - 1];
    await page.$eval(vslot('sent'), (s) => s.scrollIntoView());
    await page.click(vslot('sent') + ' .card.board[data-k="' + last.k + '"] [data-act=bvote]');
    await page.waitForTimeout(400);
    const after = await page.$eval(vslot('sent') + ' .card.board[data-k="' + last.k + '"] [data-act=bvote]', (b) => ({ on: b.getAttribute('aria-pressed'), n: Number(b.querySelector('.n').textContent) }));
    check(after.on === 'true' && after.n === last.n + 1, 'a tap on “I’d wear this” counts one more', JSON.stringify([last, after]));
    const id = last.k.slice(2);
    const votes = await fakeOf(page, `(f) => f._count('${id}')`);
    check(votes === last.n + 1, 'and the board has it', String(votes));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });
}

/* --------------------------------------------------------------- Habits */
const hbPanel = '#panel-habits';
const HB_ME = 'demo-0000-4000-8000-00000000me00';
/* the rows as the reader sees them: name, the meta line, the dots, done today */
const hbRows = (page) => page.$$eval(hbPanel + ' .hb-row', (rs) => rs.map((r) => ({ id: r.dataset.id, name: r.querySelector('.hb-name').textContent,
  meta: r.querySelector('.hb-meta').innerText.replace(/\s+/g, ' ').trim(), dots: [...r.querySelectorAll('.hb-dots .d')].map((d) => d.className.replace(/^d /, '')),
  on: r.querySelector('.hb-tap').getAttribute('aria-pressed') === 'true', tap: Math.round(r.querySelector('.hb-tap').getBoundingClientRect().height) })));
const hbFake = (page, fn) => page.evaluate(`import('/all-day/js/modes/habits.js').then((H) => { const f = H._fake(); return (${fn})(f); })`);
const hbSignIn = async (page) => {
  await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
  await page.waitForSelector(hbPanel + ' .hb-row, ' + hbPanel + ' .hb-me', { timeout: 6000 });
};
/* a chip under the mast: scrolled down, the mast tucks away, so back to the top first */
const hbChip = async (page, key) => {
  await page.evaluate(() => document.querySelector('#panel-habits').scrollTo(0, 0));
  await page.waitForFunction((k) => { const c = document.querySelector('#subnav .chip[data-chip="' + k + '"]'); return c && c.getBoundingClientRect().top > 0; }, key, { timeout: 4000 }).catch(() => {});
  await page.click('#subnav .chip[data-chip="' + key + '"]');
};
/* today's column in the seven dots: Monday 0 … Sunday 6, in Burlington */
const hbTodayCol = () => (new Date(Date.parse(etKey(Date.now()) + 'T12:00:00Z')).getUTCDay() + 6) % 7;
/* a tap, measured in the page: the row must show it before the click returns */
const hbTap = (page, name) => page.evaluate((name) => {
  const row = () => [...document.querySelectorAll('#panel-habits .hb-row')].find((r) => r.querySelector('.hb-name').textContent === name);
  const t0 = performance.now();
  row().querySelector('.hb-tap').click();
  const after = row();
  return { ms: performance.now() - t0, on: after.querySelector('.hb-tap').getAttribute('aria-pressed') === 'true', meta: after.querySelector('.hb-meta').innerText.replace(/\s+/g, ' ').trim() };
}, name);

async function theHabits(browser, base) {
  await group('Habits, Today in the demo: signed out, then add a habit, tap it, see the streak and the dots (390)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#habits');
    await settle(page);
    await page.waitForSelector(hbPanel + ' .hb-addbtn', { timeout: 6000 });
    const out = await page.$eval(hbPanel, (p) => ({ tile: p.querySelector('.hb-tile').innerText.replace(/\s+/g, ' '), buttons: [...p.querySelectorAll('button')].map((b) => b.textContent.trim()),
      rows: p.querySelectorAll('.hb-row').length, notes: [...p.querySelectorAll('p')].map((x) => x.textContent).filter((t) => !/^Season 0 ·/.test(t)) }));
    check(/Next season starts in 23 days/.test(out.tile) && /Sign up/.test(out.tile), 'the between-seasons tile: when the next season starts, and a sign-up button', out.tile);
    check(JSON.stringify(out.buttons) === '["Got it","?","Walk outside","Read the Brief","Try a new Burlington place","Add habit","Sign up"]' && out.rows === 0 && JSON.stringify(out.notes) === '["Plant your first tree."]',
      'signed out, a first visit: what the page does, the forest’s “?”, three starter habits, Add habit, then the season tile; no sign-in wall', JSON.stringify(out));
    check(await page.$eval(hbPanel + ' .hb', (b) => b.firstElementChild.className) === 'hb-help' && /Grow a forest/.test(await page.$eval(hbPanel + ' .hb-help', (x) => x.innerText)),
      'a first visit opens on what the page does, front and centre', '');
    check(!!(await page.$(hbPanel + ' .hb-forest .fr-tree.is-empty svg')) && !(await page.$(hbPanel + ' .hb-sharebtn')), 'an empty forest: a ghost sapling, and nothing to share yet', '');
    check(!(await page.$(hbPanel + ' .hb-today')) && !(await page.$(hbPanel + ' .hb-heat')), 'no habits, no numbers: no today line and no heat map', '');
    check(JSON.stringify(await page.$$eval('#subnav .chip', (c) => c.map((x) => x.textContent))) === '["Today","Forests","Goal","Season","Wall"]', 'the chips: Today, Forests, Goal, Season, Wall', '');
    await page.click(hbPanel + ' .hb-tile .hb-go');
    await page.waitForSelector('.sheet-card[aria-label="Settings"]', { timeout: 4000 }).catch(() => {});
    check(!!(await page.$('.sheet-card[aria-label="Settings"]')) && /Sign in to join a season/.test(await page.$eval('#toast', (t) => t.textContent)),
      'the season is signed-in only, and says so only when Sign up is tapped', '');
    await page.keyboard.press('Escape');

    await hbSignIn(page);
    let rows = await hbRows(page);
    check(JSON.stringify(rows.map((r) => r.name)) === '["Morning walk","Read twenty pages","Gym"]', 'signed in: the demo’s three habits, in order', JSON.stringify(rows.map((r) => r.name)));
    check(rows.every((r) => r.dots.length === 7) && rows.every((r) => r.tap >= 48), 'each row: seven dots and a tap target at least 48px', JSON.stringify(rows.map((r) => [r.dots.length, r.tap])));
    check(rows[0].on && /^\d+ days · Daily · Shared$/.test(rows[0].meta) && /^\d+ weeks? · 3 a week$/.test(rows[2].meta), 'the streak, how often, and shared', JSON.stringify(rows.map((r) => r.meta)));
    await page.evaluate(() => document.querySelector('.panel:not([hidden])').scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, 'demo-habits-today.png') });

    /* add one */
    await page.click(hbPanel + ' .hb-addbtn');
    await page.click(hbPanel + ' .hb-form button[type=submit]');
    check(/A name for the habit/.test(await page.$eval(hbPanel + ' .hb-form .bf-msg', (m) => m.textContent)), 'a habit with no name: refused, in one line', '');
    check(await page.$eval(hbPanel + ' .hb-form .hb-n', (s) => s.hidden), 'times a week is hidden until N a week is chosen', '');
    check(!(await page.$eval(hbPanel + ' .hb-form input[name=shared]', (c) => c.checked)), 'shared with the pod is off by default', '');
    await page.fill(hbPanel + ' .hb-form input[name=text]', 'Stretch');
    await page.click(hbPanel + ' .hb-form button[type=submit]');
    await page.waitForFunction(() => document.querySelectorAll('#panel-habits .hb-row').length === 4, null, { timeout: 4000 }).catch(() => {});
    rows = await hbRows(page);
    const st = rows[3];
    check(st && st.name === 'Stretch' && st.meta === 'Daily' && !st.on, 'it lands at the bottom: Daily, no streak yet, not done', JSON.stringify(st));
    check(st && st.dots[hbTodayCol()] === 'today', 'today’s dot is today’s, in Burlington', JSON.stringify(st && st.dots));

    /* tap it */
    let t = await hbTap(page, 'Stretch');
    check(t.on && t.ms < 100, 'a tap shows at once (' + Math.round(t.ms) + ' ms)', JSON.stringify(t));
    check(t.meta === '1 day · Daily', 'the streak ticks up to 1 day', t.meta);
    rows = await hbRows(page);
    check(rows[3].dots[hbTodayCol()] === 'done', 'and today’s dot fills', JSON.stringify(rows[3].dots));
    await page.waitForTimeout(100);
    const today = etKey(Date.now());
    check(await hbFake(page, `(f) => f.taps.has('${st.id}|${today}')`), 'the server has the tap, for today in Burlington', '');
    t = await hbTap(page, 'Stretch');
    check(!t.on && t.meta === 'Daily', 'tapping again un-marks it', JSON.stringify(t));
    await page.waitForTimeout(100);
    check(!(await hbFake(page, `(f) => f.taps.has('${st.id}|${today}')`)), 'and the server deletes the tap', '');

    /* N a week, shared */
    await page.click(hbPanel + ' .hb-addbtn');
    await page.fill(hbPanel + ' .hb-form input[name=text]', 'Floss');
    await page.click(hbPanel + ' .hb-form .hb-freq [data-freq="n_per_week"]');
    await page.selectOption(hbPanel + ' .hb-form .hb-n', '4');
    await page.check(hbPanel + ' .hb-form input[name=shared]');
    await page.click(hbPanel + ' .hb-form button[type=submit]');
    await page.waitForFunction(() => document.querySelectorAll('#panel-habits .hb-row').length === 5, null, { timeout: 4000 }).catch(() => {});
    rows = await hbRows(page);
    check(rows[4] && rows[4].meta === '4 a week · Shared' && rows[4].dots.every((d) => d !== 'missed'), 'an N-a-week habit: no set days, so no missed rings', JSON.stringify(rows[4]));
    check(!!(await page.$(hbPanel + ' .hb-addbtn')), 'five habits and the Add habit row stays: there is no limit to meet', '');
    check(!/up to|at most|limit/i.test(await page.$eval(hbPanel, (x) => x.innerText)), 'and the tab never mentions a limit', '');
    await pageRules(page, 'habits', 390);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Habits, the numbers: today on top, the heat map, a habit’s month and best streak (demo, 390, Wednesday Oct 14)', async () => {
    /* noon on Wednesday 2026-10-14 in Burlington; the demo's taps count back from it */
    const { ctx, page, errors } = await newPage(browser, base, { clock: Date.parse('2026-10-14T16:00:00Z') });
    await page.goto(base + '/all-day/?demo=1#habits');
    await settle(page);
    /* the walk also ran for the fourteen days before its first missed day: a best streak longer than today's */
    await hbFake(page, `(f) => { const h = f.habits.find((x) => x.text === 'Morning walk'); for (let i = 22; i <= 30; i++) { const d = new Date(Date.UTC(2026, 9, 14 - i, 12)).toISOString().slice(0, 10); f.addTap(h.id, d); } return true; }`);
    await hbSignIn(page);
    const order = await page.$eval(hbPanel + ' .hb', (b) => [...b.children].map((c) => c.className.split(' ')[0]));
    check(order[0] === 'hb-help' && order[1] === 'hb-today' && order[2] === 'hb-forest' && order[3] === 'hb-list' && order.indexOf('hb-heat') > order.indexOf('hb-add') && order[order.length - 1] === 'hb-tile',
      'the first visit’s help, then today, the forest, the habits, the weeks behind them; the season tile last', JSON.stringify(order));
    const today = () => page.$eval(hbPanel + ' .hb-today', (t) => ({ text: [...t.querySelectorAll('.hb-stat')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()),
      now: t.querySelector('.hb-bar').getAttribute('aria-valuenow'), max: t.querySelector('.hb-bar').getAttribute('aria-valuemax') }));
    let t = await today();
    check(JSON.stringify(t.text) === '["1 of 3 Today","100% Last 7 days"]' && t.now === '1' && t.max === '3', 'Wednesday: the walk done, reading and the gym still to do; every due day of the last week done', JSON.stringify(t));
    const heat = () => page.$$eval(hbPanel + ' .hb-grid .c', (cs) => cs.map((c) => [c.dataset.day, c.className.replace(/^c /, '')]));
    let cells = await heat();
    const cell = (day) => (cells.find((c) => c[0] === day) || [])[1];
    check(cells.length === 16 * 7 && cells[0][0] === '2026-06-29' && cells[cells.length - 1][0] === '2026-10-18', 'sixteen weeks, Monday to Sunday, ending this week', JSON.stringify([cells.length, cells[0], cells[cells.length - 1]]));
    check(cell('2026-10-14') === 'l2 now' && cell('2026-10-13') === 'l4' && cell('2026-10-15') === 'later' && cell('2026-09-01') === 'none',
      'today half done and marked, yesterday all done, tomorrow blank, before the habits began nothing', JSON.stringify(['10-14 ' + cell('2026-10-14'), '10-13 ' + cell('2026-10-13'), '10-15 ' + cell('2026-10-15'), '09-01 ' + cell('2026-09-01')]));
    const tr = await hbTap(page, 'Read twenty pages');
    t = await today();
    cells = await heat();
    check(tr.on && tr.ms < 100 && JSON.stringify(t.text) === '["2 of 3 Today","100% Last 7 days"]' && t.now === '2' && cell('2026-10-14') === 'l4 now',
      'a tap moves today’s count and today’s square in the same click (' + Math.round(tr.ms) + ' ms)', JSON.stringify([t, cell('2026-10-14')]));
    await hbTap(page, 'Gym');
    t = await today();
    check(JSON.stringify(t.text) === '["3 of 3 All done today","100% Last 7 days"]' && t.now === '3', 'all three: “All done today”, and the bar full', JSON.stringify(t));
    await page.evaluate(() => document.querySelector('.panel:not([hidden])').scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, 'demo-habits-numbers.png'), fullPage: false });

    /* the walk's own sheet */
    await page.click(hbPanel + ' .hb-row:nth-child(1) .hb-name');
    await page.waitForSelector('.sheet-card[aria-label="Morning walk"] .hb-cal', { timeout: 4000 });
    const sheet = () => page.$eval('.sheet-body', (b) => ({ stats: [...b.querySelectorAll('.hb-stats .hb-stat')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()),
      month: b.querySelector('.hb-cal .hb-h').textContent, prev: b.querySelector('[data-m="-1"]').disabled, next: b.querySelector('[data-m="1"]').disabled,
      pads: b.querySelectorAll('.hb-month .c.pad').length, days: [...b.querySelectorAll('.hb-month .c:not(.pad)')].map((c) => [c.dataset.day, c.className.replace(/^c /, '')]) }));
    let sh = await sheet();
    const st = (day) => (sh.days.find((d) => d[0] === day) || [])[1];
    check(JSON.stringify(sh.stats) === '["9 days Streak","14 days Best","93% Last 30 days"]', 'the streak, the best streak and the last thirty days', JSON.stringify(sh.stats));
    check(sh.month === 'October 2026' && sh.pads === 3 && sh.days.length === 31 && !sh.prev && sh.next, 'this month: the 1st is a Thursday, and no month after it', JSON.stringify([sh.month, sh.pads, sh.days.length, sh.prev, sh.next]));
    check(st('2026-10-14') === 'done' && st('2026-10-05') === 'missed' && st('2026-10-15') === 'later', 'today done, a missed day a ring, the rest of the month to come', JSON.stringify([st('2026-10-14'), st('2026-10-05'), st('2026-10-15')]));
    await page.click('.sheet-body [data-m="-1"]');
    sh = await sheet();
    check(sh.month === 'September 2026' && sh.prev && !sh.next && st('2026-09-28') === 'missed' && st('2026-09-14') === 'done' && st('2026-09-13') === 'off',
      'a month back: the walk began on the 14th, so nothing earlier is missed, and there is no month before it', JSON.stringify([sh.month, sh.prev, sh.next, st('2026-09-28'), st('2026-09-14'), st('2026-09-13')]));
    check(await page.evaluate(() => document.activeElement && document.activeElement.dataset.m === '1'), 'the focus stays on the month buttons', '');
    check(!!(await page.$('.sheet-body .hb-edit input[name=text]')), 'and the edit form under it', '');
    await page.waitForTimeout(450);   // the sheet's rise
    await page.screenshot({ path: path.join(SHOTS, 'demo-habits-sheet.png') });
    await page.keyboard.press('Escape');
    await pageRules(page, 'habits', 390);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Habits, swipe to archive with Undo, drag and keys to reorder, edit (demo, 1280, dark)', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { viewport: { width: 1280, height: 800 }, scheme: 'dark' });
    await page.goto(base + '/all-day/?demo=1#habits');
    await settle(page);
    await hbSignIn(page);
    /* the help and the forest stand over the list: put the help away and bring the list into view */
    await page.click(hbPanel + ' .hb-help .hb-go');
    await page.$eval(hbPanel + ' .hb-list', (l) => l.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(100);
    /* swipe Gym to the left */
    const box = await page.$eval(hbPanel + ' .hb-row:nth-child(3) .hb-name', (n) => { const r = n.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
    await page.mouse.move(box.x + 200, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y, { steps: 4 });
    await page.mouse.move(box.x + 60, box.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForSelector('#toast:not([hidden])', { timeout: 4000 }).catch(() => {});
    let rows = await hbRows(page);
    check(JSON.stringify(rows.map((r) => r.name)) === '["Morning walk","Read twenty pages"]' && /Archived Gym/.test(await page.$eval('#toast', (x) => x.textContent)), 'a swipe left archives it, and the toast says so', JSON.stringify(rows.map((r) => r.name)));
    check(await hbFake(page, `(f) => !!f.habits.find((h) => h.text === 'Gym').archived_at`), 'archived on the server, taps kept', '');
    await page.click('#toast button');
    await page.waitForFunction(() => document.querySelectorAll('#panel-habits .hb-row').length === 3, null, { timeout: 4000 }).catch(() => {});
    rows = await hbRows(page);
    check(rows.length === 3 && rows[2].name === 'Gym' && /weeks?/.test(rows[2].meta), 'Undo brings it back, with its streak', JSON.stringify(rows.map((r) => r.name + ' ' + r.meta)));
    /* a short swipe does nothing */
    const b2 = await page.$eval(hbPanel + ' .hb-row:nth-child(2) .hb-name', (n) => { const r = n.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
    await page.mouse.move(b2.x + 200, b2.y); await page.mouse.down(); await page.mouse.move(b2.x + 160, b2.y, { steps: 4 }); await page.mouse.up();
    check((await hbRows(page)).length === 3 && !(await page.$('.sheet-card .hb-cal')), 'a short swipe neither archives nor opens the habit', '');

    /* drag the first row below the last */
    const g = await page.$eval(hbPanel + ' .hb-row:nth-child(1) .hb-grip', (n) => { const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: n.closest('.hb-row').offsetHeight }; });
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(g.x, g.y + (g.h * 2.4) * i / 12);
    await page.mouse.up();
    await page.waitForTimeout(150);
    rows = await hbRows(page);
    check(JSON.stringify(rows.map((r) => r.name)) === '["Read twenty pages","Gym","Morning walk"]', 'dragged by its grip, the first habit goes to the bottom', JSON.stringify(rows.map((r) => r.name)));
    const order = await hbFake(page, `(f) => f.as('${HB_ME}').sz_habits_get().map((h) => h.text)`);
    check(JSON.stringify(order) === '["Read twenty pages","Gym","Morning walk"]', 'and the server keeps the order', JSON.stringify(order));
    await page.focus(hbPanel + ' .hb-row:nth-child(1) .hb-grip');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    rows = await hbRows(page);
    check(JSON.stringify(rows.map((r) => r.name)) === '["Gym","Read twenty pages","Morning walk"]', 'the grip moves a habit with the arrow keys too', JSON.stringify(rows.map((r) => r.name)));
    check(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('hb-grip') && /Read twenty/.test(document.activeElement.getAttribute('aria-label'))), 'and keeps the focus on it', '');

    /* edit */
    await page.click(hbPanel + ' .hb-row:nth-child(1) .hb-name');
    await page.waitForSelector('.sheet-card[aria-label="Gym"] .hb-edit', { timeout: 4000 });
    check(await page.$eval('.sheet-body .hb-n', (s) => !s.hidden && s.value === '3'), 'the habit’s sheet has the edit form, on what the habit is: 3 a week', '');
    await page.fill('.sheet-body input[name=text]', 'Gym, or a long run');
    await page.click('.sheet-body .hb-freq [data-freq="weekdays"]');
    await page.click('.sheet-body button[type=submit]');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached', timeout: 4000 });
    rows = await hbRows(page);
    check(rows[0].name === 'Gym, or a long run' && /Weekdays$/.test(rows[0].meta), 'renamed, and now weekdays', JSON.stringify(rows[0]));
    await pageRules(page, 'habits', 1280);
    await page.screenshot({ path: path.join(SHOTS, 'demo-habits-desktop-dark.png') });
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Habits, twenty habits: the list scrolls, and swipe, drag and keys still work (demo, 390)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#habits');
    await settle(page);
    /* seventeen more on the server before signing in: twenty in all */
    await hbFake(page, `(f) => { f.as('${HB_ME}'); for (let i = 4; i <= 20; i++) f.sz_habit_add({ p_text: 'Habit ' + i, p_frequency: 'daily' }); f.as(null); }`);
    /* and a full history behind every one: 369 days of taps, most days, the most the tab loads */
    await hbFake(page, `(f) => { const now = Date.now(); f.habits.forEach((h, j) => { for (let i = 1; i <= 369; i++) if ((i + j) % 5) f.addTap(h.id, new Date(now - i * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })); }); return true; }`);
    await hbSignIn(page);
    let rows = await hbRows(page);
    const names0 = rows.map((r) => r.name);
    check(rows.length === 20 && names0[3] === 'Habit 4' && names0[19] === 'Habit 20', 'twenty habits, in order', JSON.stringify(names0));
    /* every tap repaints the row, today's numbers and the heat map: still at once with twenty habits and a year of taps */
    const ms = [];
    for (let i = 0; i < 4; i++) ms.push((await hbTap(page, 'Habit 5')).ms);
    check(Math.max(...ms.slice(1)) < 100, 'twenty habits and a year of taps: a tap still shows at once (' + ms.map(Math.round).join(', ') + ' ms)', JSON.stringify(ms));
    check(await page.$$eval(hbPanel + ' .hb-grid .c', (c) => c.length) === 112 && !(await hbRows(page)).find((r) => r.name === 'Habit 5').on, 'the heat map is all there, and four taps leave it as it was', '');
    check(rows.every((r) => r.dots.length === 7 && r.tap >= 48), 'every row keeps its seven dots and its 48px tap', '');
    const scroll = () => page.$eval(hbPanel, (p) => ({ top: Math.round(p.scrollTop), max: p.scrollHeight - p.clientHeight }));
    check((await scroll()).max > 600, 'the list is longer than the screen, and the panel scrolls', JSON.stringify(await scroll()));
    check(!!(await page.$(hbPanel + ' .hb-addbtn')), 'the Add habit row is still there at twenty', '');
    const order = () => hbFake(page, `(f) => f.as('${HB_ME}').sz_habits_get().filter((h) => !h.is_goal).map((h) => h.text)`);

    /* swipe a row far down the list */
    const at = async (name, sel) => page.evaluate(([name, sel]) => {
      const r = [...document.querySelectorAll('#panel-habits .hb-row')].find((x) => x.querySelector('.hb-name').textContent === name);
      r.scrollIntoView({ block: 'center' });
      const b = r.querySelector(sel).getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, left: b.left };
    }, [name, sel]);
    const sb = await at('Habit 17', '.hb-name');
    await page.mouse.move(sb.left + 220, sb.y);
    await page.mouse.down();
    await page.mouse.move(sb.left + 180, sb.y, { steps: 4 });
    await page.mouse.move(sb.left + 80, sb.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForSelector('#toast:not([hidden])', { timeout: 4000 }).catch(() => {});
    rows = await hbRows(page);
    check(rows.length === 19 && !rows.some((r) => r.name === 'Habit 17') && /Archived Habit 17/.test(await page.$eval('#toast', (x) => x.textContent)), 'a swipe left on the seventeenth row archives it', JSON.stringify(rows.length));
    await page.click('#toast button');
    await page.waitForFunction(() => document.querySelectorAll('#panel-habits .hb-row').length === 20, null, { timeout: 4000 }).catch(() => {});
    rows = await hbRows(page);
    check(rows.length === 20 && rows[19].name === 'Habit 17', 'Undo brings it back, at the bottom', JSON.stringify(rows.map((r) => r.name).slice(-3)));

    /* drag a row from the top of the list to the bottom: held above the tab bar, the list scrolls under it */
    await page.evaluate(() => document.querySelector('#panel-habits').scrollTo(0, 0));
    const g = await at('Habit 4', '.hb-grip');
    const vh = page.viewportSize().height;
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(g.x, g.y + (vh - 70 - g.y) * i / 10);
    await page.waitForFunction(() => { const p = document.querySelector('#panel-habits'); return p.scrollTop >= p.scrollHeight - p.clientHeight - 1; }, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(150);
    const s1 = await scroll();
    await page.mouse.up();
    await page.waitForTimeout(150);
    rows = await hbRows(page);
    const k4 = rows.findIndex((r) => r.name === 'Habit 4');
    check(s1.top > 300, 'held near the bottom, the drag scrolls the list (' + s1.top + 'px)', JSON.stringify(s1));
    check(k4 >= 15, 'and Habit 4 travels down the list, to row ' + (k4 + 1), JSON.stringify(rows.map((r) => r.name)));
    check(rows.length === 20 && new Set(rows.map((r) => r.name)).size === 20, 'no row lost or doubled on the way', '');
    check(JSON.stringify(await order()) === JSON.stringify(rows.map((r) => r.name)), 'and the server keeps the order', JSON.stringify(await order()));

    /* and back up: held under the mast, the list scrolls the other way */
    const g2 = await at('Habit 20', '.hb-grip');
    const k20 = (await hbRows(page)).findIndex((r) => r.name === 'Habit 20');
    await page.mouse.move(g2.x, g2.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(g2.x, g2.y + (30 - g2.y) * i / 10);
    await page.waitForFunction(() => document.querySelector('#panel-habits').scrollTop <= 0, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(150);
    rows = await hbRows(page);
    const k20b = rows.findIndex((r) => r.name === 'Habit 20');
    check((await scroll()).top === 0 && k20b <= 4 && k20b < k20, 'dragged up past the top, Habit 20 goes from row ' + (k20 + 1) + ' to row ' + (k20b + 1), JSON.stringify(rows.map((r) => r.name)));
    const o2 = await order();
    check(JSON.stringify(o2) === JSON.stringify(rows.map((r) => r.name)), 'and the server keeps that order too', JSON.stringify(o2) + ' vs ' + JSON.stringify(rows.map((r) => r.name)));

    /* the arrow keys, far down the list */
    const last = rows[19].name, before = rows[18].name;
    await page.focus(hbPanel + ' .hb-row:nth-child(20) .hb-grip');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    rows = await hbRows(page);
    check(rows[18].name === last && rows[19].name === before, 'the grip’s arrow keys move the last of twenty up one', JSON.stringify(rows.map((r) => r.name).slice(-2)));
    check(await page.evaluate((n) => document.activeElement && document.activeElement.classList.contains('hb-grip') && document.activeElement.closest('.hb-row').querySelector('.hb-name').textContent === n, last), 'and keeps the focus on it', '');

    /* and a twenty-first, through the form */
    await page.click(hbPanel + ' .hb-addbtn');
    await page.fill(hbPanel + ' .hb-form input[name=text]', 'Habit 21');
    await page.click(hbPanel + ' .hb-form button[type=submit]');
    await page.waitForFunction(() => document.querySelectorAll('#panel-habits .hb-row').length === 21, null, { timeout: 4000 }).catch(() => {});
    rows = await hbRows(page);
    check(rows.length === 21 && rows[20].name === 'Habit 21', 'a twenty-first habit adds like any other', JSON.stringify(rows.length));
    await pageRules(page, 'habits', 390);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Habits, no name or phone for the tracker: they are asked when you join a season (demo)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#habits');
    await settle(page);
    await hbFake(page, `(f) => { f.members.delete('${HB_ME}'); return true; }`);
    await hbSignIn(page);
    check(!(await page.$(hbPanel + ' .hb-me')) && (await hbRows(page)).length === 3, 'no member yet: the habits, and no form in the way', '');
    await page.click(hbPanel + ' .hb-addbtn');
    await page.fill(hbPanel + ' .hb-form input[name=text]', 'Stretch');
    await page.click(hbPanel + ' .hb-form button[type=submit]');
    await page.waitForFunction(() => document.querySelectorAll('#panel-habits .hb-row').length === 4, null, { timeout: 4000 }).catch(() => {});
    check((await hbRows(page)).length === 4 && await hbFake(page, `(f) => !f.members.has('${HB_ME}')`), 'a habit adds with no name given', '');
    await page.click(hbPanel + ' .hb-tile .hb-go');
    await page.waitForSelector('.sheet-card[aria-label="Join Season 0"]', { timeout: 4000 }).catch(() => {});
    check(!!(await page.$('.sheet-body .hb-me input[name=name]')) && !!(await page.$('.sheet-body .hb-me input[name=phone]')), 'Sign up asks a first name and a phone', '');
    await page.fill('.sheet-body .hb-me input[name=name]', 'Alex');
    await page.fill('.sheet-body .hb-me input[name=phone]', 'call me');
    await page.click('.sheet-body .hb-me button[type=submit]');
    check(/phone number/.test(await page.$eval('.sheet-body .hb-me .bf-msg', (m) => m.textContent)), 'a phone that is not one: refused', '');
    await page.fill('.sheet-body .hb-me input[name=phone]', '(802) 555-0142');
    await page.click('.sheet-body .hb-me button[type=submit]');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached', timeout: 4000 }).catch(() => {});
    check(await hbFake(page, `(f) => f.members.get('${HB_ME}') && f.members.get('${HB_ME}').phone === '(802) 555-0142'`) && /Sign-up opens/.test(await page.$eval('#toast', (t) => t.textContent)),
      'saved, and on to the sign-up', '');
    await page.evaluate(() => import('/all-day/js/app.js').then((a) => a.signOut()));
    await page.waitForFunction(() => !document.querySelector('#panel-habits .hb-row') && document.querySelector('#panel-habits .hb-addbtn'), null, { timeout: 4000 });
    await hbSignIn(page);
    await page.click(hbPanel + ' .hb-tile .hb-go');
    await page.waitForTimeout(150);
    check(!(await page.$('.sheet-card[aria-label="Join Season 0"]')) && (await hbRows(page)).length === 4, 'signed in again: not asked twice', '');
    /* the tile sits under the habits now, and scrolling down to it tucks the mast away: back up to the chips */
    await page.evaluate(() => document.querySelector('#panel-habits').scrollTo(0, 0));
    await page.waitForFunction(() => { const c = document.querySelector('#subnav .chip[data-chip="season"]'); return c && c.getBoundingClientRect().top > 0; }, null, { timeout: 4000 }).catch(() => {});
    await page.click('#subnav .chip[data-chip="season"]');
    check(await page.$eval(hbPanel, (p) => p.innerText.trim()) === 'Season 0 is coming' && /#habits\/season$/.test(await page.evaluate(() => location.hash)), 'Season: one line, and the address says where', '');
    await page.goto(base + '/all-day/?demo=1#habits/wall');
    await settle(page);
    check(await page.$eval(hbPanel, (p) => p.innerText.trim()) === 'Season 0 is coming' && await page.$eval('#subnav .chip.on', (c) => c.dataset.chip) === 'wall', '#habits/wall opens the Wall chip', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Habits, the day turns at midnight New York, not the phone’s (demo, a reader in Tokyo)', async () => {
    /* Wednesday 11:59 pm in Burlington is Thursday lunchtime in Tokyo */
    const { ctx, page, errors } = await newPage(browser, base, { timezoneId: 'Asia/Tokyo', clock: Date.parse('2026-10-15T03:59:00Z') });
    await page.goto(base + '/all-day/?demo=1#habits');
    await settle(page);
    await hbSignIn(page);
    let rows = await hbRows(page);
    check(rows[1].dots[2] === 'today' && rows[1].dots[3] === 'later', 'at 11:59 pm New York it is still Wednesday', JSON.stringify(rows[1].dots));
    check(rows[0].dots[2] === 'done', 'and the morning walk tapped “today” is Wednesday’s', JSON.stringify(rows[0].dots));
    await page.clock.setFixedTime(Date.parse('2026-10-15T04:01:00Z'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(100);
    rows = await hbRows(page);
    check(rows[1].dots[2] !== 'today' && rows[1].dots[3] === 'today', 'two minutes later it is Thursday: the day turned at midnight New York', JSON.stringify(rows[1].dots));
    check(!rows[1].on && !(await hbTap(page, 'Read twenty pages')).meta.includes('NaN'), 'a fresh day starts untapped', '');
    await page.waitForTimeout(100);
    check(await hbFake(page, `(f) => [...f.taps.keys()].some((k) => k.endsWith('|2026-10-15'))`), 'and a tap now is Thursday’s', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  /* live, the account a real Supabase would keep: the fake behind the RPC
     doors, signed in as u-1 when the request carries a token */
  const hbAccount = () => {
    const f = new FakeHabits();
    const calls = [];
    const rpc = (fn, args, headers) => {
      if (!/^sz_/.test(fn)) return undefined;
      calls.push(fn);
      if (fn === 'sz_season_next') return null;
      try { return f.as(/^Bearer /.test((headers && headers.authorization) || '') ? 'u-1' : null).call(fn, args || {}) ?? null; }
      catch (e) { return { status: 400, body: { code: 'P0001', message: e.code || 'boom' } }; }
    };
    return { f, calls, rpc };
  };
  for (const [width, scheme] of [[390, 'light'], [1280, 'dark']]) {
    await group('Habits, signed out it just works on this phone, and signing in moves it to the account once (live, ' + width + ', ' + scheme + ')', async () => {
      const acct = hbAccount();
      const { ctx, page, errors } = await newPage(browser, base, { viewport: { width, height: 844 }, scheme, rpc: acct.rpc });
     
      await page.goto(base + '/all-day/#habits');
      await settle(page);
      await page.waitForSelector(hbPanel + ' .hb-addbtn', { timeout: 6000 });
      check(await page.$eval(hbPanel + ' .hb-empty', (e) => e.textContent).catch(() => '') === 'Plant your first tree.' && !(await page.$(hbPanel + ' .hb-row')) && !(await page.$(hbPanel + ' .hb-sync')) && !(await page.$(hbPanel + ' .hb-gate')),
        'a first visit: one line, the starters and Add habit, nothing seeded, no sign-in wall', '');
      const add = async (name, freq, n) => {
        const k = (await hbRows(page)).length;
        await page.click(hbPanel + ' .hb-addbtn');
        await page.fill(hbPanel + ' .hb-form input[name=text]', name);
        if (freq) await page.click(hbPanel + ' .hb-form .hb-freq [data-freq="' + freq + '"]');
        if (n) await page.selectOption(hbPanel + ' .hb-form .hb-n', String(n));
        await page.click(hbPanel + ' .hb-form button[type=submit]');
        await page.waitForFunction((k) => document.querySelectorAll('#panel-habits .hb-row').length === k + 1, k, { timeout: 4000 }).catch(() => {});
      };
      await add('Walk');
      await add('Read', 'weekdays');
      await add('Gym', 'n_per_week', 3);
      const tw = await hbTap(page, 'Walk');
      const tg = await hbTap(page, 'Gym');
      check(tw.on && tg.on && tw.ms < 100 && tw.meta === '1 day · Daily' && /^1 week · 3 a week$|^3 a week$/.test(tg.meta), 'three habits, two tapped, at once (' + Math.round(tw.ms) + ' ms)', JSON.stringify([tw, tg]));
      check(!acct.calls.some((c) => c !== 'sz_season_next' && c !== 'sz_forests_public'), 'and nothing personal went to the server (the season and the public forests only)', acct.calls.join(', '));
      const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('allday-habits-local') || 'null'));
      check(kept && kept.v === 1 && kept.habits.length === 3 && Object.values(kept.taps).flat().length === 2, 'kept on this phone, under one versioned key', JSON.stringify(kept).slice(0, 200));
      check(await page.$eval(hbPanel + ' .hb-sync', (b) => b.textContent).catch(() => '') === 'Sync across devices', 'one quiet line under the list: Sync across devices', '');
      await pageRules(page, 'habits', width);
      if (width === 390) await page.screenshot({ path: path.join(SHOTS, 'live-habits-signed-out.png') });

      await page.reload();
      await page.waitForSelector(hbPanel + ' .hb-row', { timeout: 6000 });
      let rows = await hbRows(page);
      check(JSON.stringify(rows.map((r) => [r.name, r.on])) === '[["Walk",true],["Read",false],["Gym",true]]' && rows[0].meta === '1 day · Daily' && rows[0].dots[hbTodayCol()] === 'done',
        'after a reload: the same three, the same two tapped, the streak and the dot', JSON.stringify(rows.map((r) => [r.name, r.on, r.meta])));
      await page.click(hbPanel + ' .hb-sync');
      await page.waitForSelector('.sheet-card[aria-label="Settings"]', { timeout: 4000 }).catch(() => {});
      check(!!(await page.$('.sheet-card[aria-label="Settings"]')), 'Sync across devices opens the sign-in', '');
      await page.keyboard.press('Escape');

      /* sign in: the phone's habits move to the account, once. The Settings
         sheet asked whether sign-in is on; its answer tells every tab, so
         let it land first, or this page would start the move before the reload */
      await page.waitForFunction(() => import('/all-day/js/auth.js').then((a) => a.status() !== 'checking'), null, { timeout: 4000 }).catch(() => {});
      await page.evaluate(() => localStorage.setItem('allday-auth', JSON.stringify({ refresh_token: 'r', user: { id: 'u-1' } })));
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('#panel-habits .hb-row').length === 3 && !localStorage.getItem('allday-habits-local'), null, { timeout: 6000 }).catch(() => {});
      const today = etKey(Date.now());
      const server = acct.f.as('u-1').sz_habits_get();
      const serverTaps = acct.f.sz_taps_get({ p_from: today, p_to: today }).map((t) => server.find((h) => h.id === t.habit).text).sort();
      check(JSON.stringify(server.map((h) => [h.text, h.frequency, h.n])) === '[["Walk","daily",null],["Read","weekdays",null],["Gym","n_per_week",3]]' && JSON.stringify(serverTaps) === '["Gym","Walk"]',
        'signed in: the account has the three habits and the two taps', JSON.stringify(server.map((h) => h.text)) + ' ' + JSON.stringify(serverTaps));
      check(acct.calls.filter((c) => c === 'sz_import_local').length === 1 && !acct.calls.includes('sz_habit_add'), 'in one sz_import_local call', acct.calls.join(', '));
      check(await page.evaluate(() => localStorage.getItem('allday-habits-local')) === null, 'and the phone forgets them: the account is the one copy', '');
      rows = await hbRows(page);
      check(JSON.stringify(rows.map((r) => [r.name, r.on])) === '[["Walk",true],["Read",false],["Gym",true]]' && !(await page.$(hbPanel + ' .hb-sync')),
        'the list is the account’s now, and the sync line is gone', JSON.stringify(rows.map((r) => [r.name, r.on])));
      await page.reload();
      await page.waitForSelector(hbPanel + ' .hb-row', { timeout: 6000 });
      check((await hbRows(page)).length === 3 && acct.calls.filter((c) => c === 'sz_import_local').length === 1, 'a reload signed in imports nothing again', acct.calls.join(', '));

      /* sign out: the account keeps them, the phone's own list is empty */
      await page.evaluate(() => import('/all-day/js/app.js').then((a) => a.signOut()));
      await page.waitForFunction(() => !document.querySelector('#panel-habits .hb-row') && document.querySelector('#panel-habits .hb-addbtn'), null, { timeout: 4000 }).catch(() => {});
      check((await hbRows(page)).length === 0 && await page.$eval(hbPanel + ' .hb-empty', (e) => e.textContent).catch(() => '') === 'Plant your first tree.' && acct.f.as('u-1').sz_habits_get().length === 3,
        'signed out again: an empty list here, the three still on the account', '');
      await pageRules(page, 'habits', width);
      check(!errors.length, 'no console errors', errors.join(' | '));
      await ctx.close();
    });
  }

  await group('Habits, signing in to an account that already has habits adds this phone’s by name, never twice (demo, 390)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#habits');
    await settle(page);
    await page.waitForSelector(hbPanel + ' .hb-addbtn', { timeout: 6000 });
    for (const name of ['Stretch', 'Gym', 'Stretch']) {
      const k = (await hbRows(page)).length;
      await page.click(hbPanel + ' .hb-addbtn');
      await page.fill(hbPanel + ' .hb-form input[name=text]', name);
      await page.click(hbPanel + ' .hb-form button[type=submit]');
      await page.waitForFunction((k) => document.querySelectorAll('#panel-habits .hb-row').length === k + 1, k, { timeout: 4000 }).catch(() => {});
    }
    await hbTap(page, 'Stretch');
    check(await page.evaluate(() => localStorage.getItem('allday-habits-local')) === null, 'the demo keeps the phone’s habits in memory only', '');
    await hbSignIn(page);
    await page.waitForFunction(() => document.querySelectorAll('#panel-habits .hb-row').length === 6, null, { timeout: 4000 }).catch(() => {});
    let rows = await hbRows(page);
    check(JSON.stringify(rows.map((r) => r.name)) === '["Morning walk","Read twenty pages","Gym","Stretch","Gym","Stretch"]' && rows[3].on && !rows[5].on && rows[4].meta === 'Daily',
      'the demo account had three: Stretch joins them with today’s tap, the phone’s two Stretches stay two, and a daily Gym is not the account’s 3-a-week Gym', JSON.stringify(rows.map((r) => [r.name, r.on, r.meta])));
    await page.evaluate(() => import('/all-day/js/app.js').then((a) => a.signOut()));
    await page.waitForFunction(() => !document.querySelector('#panel-habits .hb-row'), null, { timeout: 4000 }).catch(() => {});
    check((await hbRows(page)).length === 0, 'everything came across, so signed out the phone’s list is empty', '');

    /* an archived habit cannot come across to an account that has habits: the phone keeps its copy, and never sends one twice */
    await page.click(hbPanel + ' .hb-addbtn');
    await page.fill(hbPanel + ' .hb-form input[name=text]', 'Floss');
    await page.click(hbPanel + ' .hb-form button[type=submit]');
    await page.waitForSelector(hbPanel + ' .hb-row', { timeout: 4000 });
    await page.click(hbPanel + ' .hb-addbtn');
    await page.fill(hbPanel + ' .hb-form input[name=text]', 'Old habit');
    await page.click(hbPanel + ' .hb-form button[type=submit]');
    await page.waitForFunction(() => document.querySelectorAll('#panel-habits .hb-row').length === 2, null, { timeout: 4000 }).catch(() => {});
    await page.click(hbPanel + ' .hb-row:nth-child(2) .hb-name');
    await page.waitForSelector('.sheet-card[aria-label="Old habit"] .hb-edit', { timeout: 4000 });
    await page.click('.sheet-body button:has-text("Archive")');
    await page.waitForFunction(() => document.querySelectorAll('#panel-habits .hb-row').length === 1, null, { timeout: 4000 }).catch(() => {});
    await hbSignIn(page);
    await page.waitForFunction(() => document.querySelectorAll('#panel-habits .hb-row').length === 7, null, { timeout: 4000 }).catch(() => {});
    rows = await hbRows(page);
    check(rows.length === 7 && rows[6].name === 'Floss', 'Floss joins the account', JSON.stringify(rows.map((r) => r.name)));
    await page.evaluate(() => import('/all-day/js/app.js').then((a) => a.signOut()));
    await page.waitForSelector(hbPanel + ' .hb-row', { timeout: 4000 }).catch(() => {});
    check(JSON.stringify((await hbRows(page)).map((r) => r.name)) === '["Floss"]', 'and with the archived habit left behind, the phone keeps its copy', JSON.stringify((await hbRows(page)).map((r) => r.name)));
    await hbSignIn(page);
    await page.waitForTimeout(200);
    rows = await hbRows(page);
    check(rows.filter((r) => r.name === 'Floss').length === 1 && rows.length === 7, 'signing in again sends nothing twice', JSON.stringify(rows.map((r) => r.name)));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  /* live: the sz_ doors answered here as the SQL would, for one reader */
  const hbServer = (o = {}) => {
    const st = { taps: new Set(o.taps || []), calls: [], hangTap: !!o.hangTap, refuse: o.refuse || null };
    const habit = { id: '11111111-aaaa-4000-8000-000000000001', text: 'Stretch', frequency: 'daily', n: null, is_goal: false, shared: false, position: 1, created_at: '2026-10-01T12:00:00Z' };
    st.rpc = (fn, args) => {
      if (!/^sz_/.test(fn)) return undefined;
      st.calls.push(fn + (args.p_date ? ' ' + args.p_date : ''));
      if (o.off || (o.forestOff && /^sz_forest/.test(fn))) return { status: 404, body: { code: 'PGRST202', message: 'Could not find the function' } };
      if (fn === 'sz_season_next') return o.season === undefined ? null : o.season;
      if (fn === 'sz_me_get') return { name: 'Maya', phone: '802-555-0100', city: 'burlington', email_opt_out: false };
      if (fn === 'sz_habits_get') return [habit];
      if (fn === 'sz_taps_get') return [...st.taps].map((d) => ({ habit: habit.id, date: d, source: 'app' }));
      if (fn === 'sz_tap' || fn === 'sz_untap') {
        if (st.refuse) return { status: 400, body: { code: 'P0001', message: st.refuse } };
        if (fn === 'sz_tap' && st.hangTap) return { hang: true };
        if (fn === 'sz_tap') st.taps.add(args.p_date); else st.taps.delete(args.p_date);
        return { habit: habit.id, date: args.p_date, tapped: fn === 'sz_tap' };
      }
      return undefined;
    };
    return st;
  };
  const signedIn = (page) => page.addInitScript(() => { if (!localStorage.getItem('allday-auth')) localStorage.setItem('allday-auth', JSON.stringify({ refresh_token: 'r', user: { id: 'u-1' } })); });

  await group('Habits, live: no season, a season, and before the paste', async () => {
    let srv = hbServer({ season: null });
    let p = await newPage(browser, base, { rpc: (fn, a) => srv.rpc(fn, a) });
    await p.page.goto(base + '/all-day/#habits');
    await settle(p.page);
    await p.page.waitForSelector(hbPanel + ' .hb-addbtn', { timeout: 6000 });
    await p.page.waitForTimeout(150);
    check(!(await p.page.$(hbPanel + ' .hb-tile')) && !/No season/.test(await p.page.$eval(hbPanel, (x) => x.innerText)), 'no season scheduled: no box at all', '');
    check(!srv.calls.some((c) => /^sz_(me|habits|taps)/.test(c)), 'signed out, nothing personal is asked for', srv.calls.join(', '));
    await pageRules(p.page, 'habits', 390);
    check(!p.errors.length, 'no console errors', p.errors.join(' | '));
    await p.ctx.close();

    const kick = new Date(Date.now() + 5 * 86400000 + 3600000).toISOString();
    srv = hbServer({ season: { id: 's1', name: 'Season 0', city: 'burlington', status: 'open', signup_opens: null, kickoff_at: kick, party_at: null, stripe_link: 'https://buy.stripe.com/test_x' } });
    p = await newPage(browser, base, { rpc: (fn, a) => srv.rpc(fn, a) });
    await signedIn(p.page);
    await p.page.goto(base + '/all-day/#habits');
    await p.page.waitForSelector(hbPanel + ' .hb-row', { timeout: 6000 });
    const days = Math.round((Date.parse(etKey(Date.parse(kick)) + 'T12:00:00Z') - Date.parse(etKey(Date.now()) + 'T12:00:00Z')) / 86400000);
    check(new RegExp('Next season starts in ' + days + ' days').test(await p.page.$eval(hbPanel + ' .hb-tile', (t) => t.innerText)), 'a season to come: in ' + days + ' Burlington days', '');
    const popup = p.page.waitForEvent('popup', { timeout: 4000 }).catch(() => null);
    await p.page.click(hbPanel + ' .hb-tile .hb-go');
    const pop = await popup;
    check(pop && /buy\.stripe\.com\/test_x/.test(pop.url()), 'signed in, Sign up opens the season’s payment link', pop ? pop.url() : 'no popup');
    if (pop) await pop.close();
    await p.ctx.close();

    srv = hbServer({ off: true });
    p = await newPage(browser, base, { rpc: (fn, a) => srv.rpc(fn, a) });
    await signedIn(p.page);
    await p.page.goto(base + '/all-day/#habits');
    await p.page.waitForSelector(hbPanel + ' .hb-empty', { timeout: 6000 }).catch(() => {});
    check(await p.page.$eval(hbPanel + ' .hb-empty', (e) => e.textContent).catch(() => '') === 'Habits open soon.' && !(await p.page.$(hbPanel + ' .hb-tile')),
      'before sz-SETUP.sql is pasted: one line, and no empty season box', '');
    await p.ctx.close();

    /* the habits are pasted, the forest's sharing is not: the forest grows, sharing stays out of sight */
    srv = hbServer({ forestOff: true, taps: [etKey(Date.now())] });
    p = await newPage(browser, base, { rpc: (fn, a) => srv.rpc(fn, a) });
    await signedIn(p.page);
    await p.page.goto(base + '/all-day/#habits');
    await p.page.waitForSelector(hbPanel + ' .hb-row', { timeout: 6000 });
    await p.page.waitForFunction(() => !document.querySelector('#subnav .chip[data-chip="forests"]'), null, { timeout: 4000 }).catch(() => {});
    check(!!(await p.page.$(hbPanel + ' .fr-tree[data-id] svg.tree')) && /1 leaf/.test(await p.page.$eval(hbPanel + ' .fr-tree[data-id]', (t) => t.innerText)),
      'before sz-FOREST.sql is pasted: the tree still grows, from the habit’s own taps', '');
    check(!(await p.page.$(hbPanel + ' .hb-sharebtn')) && !(await p.page.$('#subnav .chip[data-chip="forests"]')) && !!(await p.page.$(hbPanel + ' .hb-q')),
      'and Share and the Forests chip stay hidden; the “?” stays', JSON.stringify(await p.page.$$eval('#subnav .chip', (c) => c.map((x) => x.dataset.chip))));
    check(srv.calls.some((c) => c === 'sz_forest_get') && srv.calls.some((c) => c === 'sz_forests_public'), 'it asked, and took the missing doors as “not yet”', srv.calls.join(', '));
    check(!p.errors.filter((e) => !/404/.test(e)).length, 'no console errors but the expected 404s', p.errors.join(' | '));
    await p.ctx.close();
  });

  await group('Habits, live: a refresh never loses a tap, and a refused one is taken back', async () => {
    const today = etKey(Date.now());
    const srv = hbServer({ hangTap: true });
    const { ctx, page, errors } = await newPage(browser, base, { rpc: (fn, a) => srv.rpc(fn, a) });
    await signedIn(page);
    await page.goto(base + '/all-day/#habits');
    await page.waitForSelector(hbPanel + ' .hb-row', { timeout: 6000 });
    const t = await hbTap(page, 'Stretch');
    check(t.on && t.ms < 100 && t.meta === '1 day · Daily', 'tapped while the server is slow: shown at once', JSON.stringify(t));
    const kept = await page.evaluate(() => localStorage.getItem('allday-habits-pending'));
    check(kept && JSON.parse(kept)['u-1'][0].op === 'tap' && JSON.parse(kept)['u-1'][0].date === today, 'the tap is written to this phone before the server answers', kept);
    srv.hangTap = false;
    await page.reload();
    await page.waitForSelector(hbPanel + ' .hb-row', { timeout: 6000 });
    const r = (await hbRows(page))[0];
    check(r.on && r.meta === '1 day · Daily', 'after a refresh the tap is still there', JSON.stringify(r));
    await page.waitForFunction(() => !localStorage.getItem('allday-habits-pending') || localStorage.getItem('allday-habits-pending') === '{}', null, { timeout: 4000 }).catch(() => {});
    check(srv.taps.has(today) && srv.calls.filter((c) => c === 'sz_tap ' + today).length >= 2, 'and it is sent again, and lands', srv.calls.join(', '));
    check(['{}', null].includes(await page.evaluate(() => localStorage.getItem('allday-habits-pending'))), 'then the phone forgets it', '');
    srv.refuse = 'not_today';
    const u = await hbTap(page, 'Stretch');
    check(!u.on, 'un-tapped at once', JSON.stringify(u));
    await page.waitForSelector('#toast:not([hidden])', { timeout: 4000 }).catch(() => {});
    const back = (await hbRows(page))[0];
    check(back.on && /Only today can be marked/.test(await page.$eval('#toast', (x) => x.textContent)), 'the server refused: the tap comes back, and the toast says why', JSON.stringify(back));
    check(!errors.filter((e) => !/status of 400/.test(e)).length, 'no console errors beyond the refusal', errors.join(' | '));
    await ctx.close();
  });
  await group('Habits, live: deleting the account deletes the habits first, and stops if it cannot', async () => {
    const asked = [];
    let refuse = true;
    const { ctx, page } = await newPage(browser, base, { rpc: (fn) => {
      asked.push(fn);
      if (fn === 'sz_delete_me') return refuse ? { status: 500, body: { message: 'boom' } } : { deleted: true };
      if (fn === 'nn_delete_me') return { deleted: true };
      if (fn === 'nn_profile_get') return { display_name: 'Maya', neighborhood: null, archetype: null };
      return undefined;
    } });
    await signedIn(page);
    await page.goto(base + '/all-day/#wire');
    await settle(page);
    await settingsText(page);
    await page.click('.sheet-body button:has-text("Delete my account and posts")');
    await page.click('#confirm [data-yes]');
    await page.waitForSelector('#toast:not([hidden])', { timeout: 4000 }).catch(() => {});
    check(asked.includes('sz_delete_me') && !asked.includes('nn_delete_me') && !/Deleted/.test(await page.$eval('#toast', (t) => t.textContent))
      && await page.evaluate(() => import('/all-day/js/app.js').then((a) => !!a.user())), 'the habits could not be deleted: nothing else is, the reader stays signed in, and it says so', asked.join(', '));
    refuse = false;
    asked.length = 0;
    await settingsText(page);
    await page.click('.sheet-body button:has-text("Delete my account and posts")');
    await page.click('#confirm [data-yes]');
    await page.waitForFunction(() => /Deleted/.test(document.querySelector('#toast').textContent), null, { timeout: 4000 }).catch(() => {});
    check(asked.indexOf('sz_delete_me') >= 0 && asked.indexOf('sz_delete_me') < asked.indexOf('nn_delete_me'), 'then: the habits first, then the posts and profile', asked.join(', '));
    await ctx.close();
  });

  await group('Habits, the forest: a tree per habit, a leaf per tap, flowers, help, starters (demo, 390)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#habits');
    await settle(page);
    await page.waitForSelector(hbPanel + ' .hb-help', { timeout: 6000 });
    /* the "?" explains the page any time */
    await page.click(hbPanel + ' .hb-q');
    await page.waitForSelector('.sheet-card[aria-label="How Habits works"]', { timeout: 4000 }).catch(() => {});
    check((await page.$$eval('.sheet-body .hb-helpl li', (l) => l.length)) === 4, 'the “?” opens How Habits works: four lines', '');
    await page.keyboard.press('Escape');
    await page.click('.sheet-card .iconbtn[aria-label="Close"]').catch(() => {});
    /* a starter is one tap: a habit, and its tree */
    await page.click(hbPanel + ' .hb-start:has-text("Walk outside")');
    await page.waitForSelector(hbPanel + ' .hb-row', { timeout: 4000 });
    let rows = await hbRows(page);
    check(rows.length === 1 && rows[0].name === 'Walk outside' && rows[0].meta === 'Daily' && !(await page.$(hbPanel + ' .hb-starts')), 'a starter adds a daily habit in one tap, and the starters step aside', JSON.stringify(rows));
    check(await page.$eval(hbPanel + ' .fr-tree[data-id]', (b) => b.getAttribute('aria-label') + '|' + b.querySelector('svg').getAttribute('aria-hidden')) === 'Walk outside: 0 leaves|true', 'and plants its tree: no leaves yet (one name for the button, the picture itself decorative)', '');
    const t1 = await page.evaluate(() => {
      const t0 = performance.now();
      document.querySelector('#panel-habits .hb-row .hb-tap').click();
      const tr = document.querySelector('#panel-habits .fr-tree[data-id]');
      return { ms: performance.now() - t0, label: tr.getAttribute('aria-label'), fresh: !!tr.querySelector('.tr-new') };
    });
    check(t1.label === 'Walk outside: 1 leaf' && t1.fresh && t1.ms < 100, 'a tap grows a leaf, in the same click (' + Math.round(t1.ms) + ' ms)', JSON.stringify(t1));
    await page.click(hbPanel + ' .hb-help .hb-go');
    check(!(await page.$(hbPanel + ' .hb-help')), 'Got it puts the help away', '');

    /* signed in: the demo's three habits, three trees */
    await hbSignIn(page);
    const trees = () => page.$$eval(hbPanel + ' .fr-tree[data-id]', (ts) => ts.map((t) => ({ id: t.dataset.id, label: t.getAttribute('aria-label'),
      petals: t.querySelectorAll('.tr-pet').length, name: t.querySelector('.fr-name').textContent })));
    let tr = await trees();
    rows = await hbRows(page);
    check(JSON.stringify(tr.map((t) => t.name)) === JSON.stringify(rows.map((r) => r.name)), 'one tree per habit, in the list’s order', JSON.stringify(tr.map((t) => t.name)));
    const want = await page.evaluate(() => Promise.all([import('/all-day/js/modes/habits.js'), import('/all-day/js/forest.js'), import('/all-day/js/habits-core.js')]).then(([H, F, C]) => {
      const f = H._fake(), today = C.dayKey(Date.now());
      return f.habits.filter((h) => h.user_id === 'demo-0000-4000-8000-00000000me00' && !h.archived_at).sort((a, b) => a.position - b.position).map((h) => {
        const taps = [...f.taps.values()].filter((t) => t.habit === h.id).map((t) => t.date);
        const best = C.bestStreak(h, F.inWindow(taps, today), Date.now());
        return { id: h.id, leaves: F.leavesOf(taps, today), blooms: F.bloomsOf(h.frequency, best), svg: F.tree(F.seedOf(h.id), F.leavesOf(taps, today), F.bloomsOf(h.frequency, best)) };
      });
    }));
    check(want.length === tr.length && want.length === 4 && want.every((w, i) => tr[i].label.endsWith(': ' + w.leaves + (w.leaves === 1 ? ' leaf' : ' leaves') + (w.blooms ? ', ' + w.blooms + (w.blooms === 1 ? ' flower' : ' flowers') : ''))),
      'each tree has a leaf for every day done in the last 370', JSON.stringify([tr.map((t) => t.label), want.map((w) => [w.leaves, w.blooms])]));
    check(tr[0].petals === want[0].blooms && want[0].blooms >= 1, 'the morning walk’s week-long streak has bloomed: ' + want[0].blooms + ' flower', JSON.stringify(tr[0]));
    const same = await page.$eval(hbPanel + ' .fr-tree[data-id="' + want[2].id + '"] svg', (s, svg) => { const d = document.createElement('div'); d.innerHTML = svg; return d.firstElementChild.outerHTML === s.outerHTML; }, want[2].svg);
    check(same, 'a tree is the same drawing wherever it is made: its seed, its leaves, its flowers', '');
    /* the habit's sheet has it big */
    await page.click(hbPanel + ' .fr-tree[data-id="' + want[1].id + '"]');
    await page.waitForSelector('.sheet-body .hb-bigtree svg', { timeout: 4000 }).catch(() => {});
    check(!!(await page.$('.sheet-card[aria-label="Read twenty pages"] .hb-bigtree svg')) && !!(await page.$('.sheet-body .hb-stats')), 'tapping a tree opens its habit, with the tree big on top', '');
    await page.click('.sheet-card .iconbtn[aria-label="Close"]');
    await page.evaluate(() => document.querySelector('.panel:not([hidden])').scrollTo(0, 0));
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SHOTS, 'demo-habits-forest.png') });
    await pageRules(page, 'habits', 390);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();

    /* reduced motion: the new leaf is simply there */
    const r = await newPage(browser, base, { motion: 'reduce' });
    await r.page.goto(base + '/all-day/?demo=1#habits');
    await settle(r.page);
    await hbSignIn(r.page);
    await hbTap(r.page, 'Read twenty pages');
    const anim = await r.page.$eval(hbPanel + ' .fr-tree .tr-new', (n) => getComputedStyle(n).animationName).catch(() => 'missing');
    check(anim === 'none', 'reduced motion: the new leaf does not grow in, it is just there', anim);
    await r.ctx.close();
  });

  await group('Habits, sharing a forest: any name, names or just the trees, the gallery, a link (demo, 390)', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#habits');
    await settle(page);
    await page.waitForSelector(hbPanel + ' .hb-addbtn', { timeout: 6000 });
    await page.click(hbPanel + ' .hb-start:has-text("Read the Brief")');
    await page.waitForSelector(hbPanel + ' .hb-sharebtn', { timeout: 4000 });
    await page.click(hbPanel + ' .hb-sharebtn');
    await page.waitForSelector('.sheet-card[aria-label="Settings"]', { timeout: 4000 }).catch(() => {});
    check(!!(await page.$('.sheet-card[aria-label="Settings"]')) && /Sign in to share your forest/.test(await page.$eval('#toast', (t) => t.textContent)), 'signed out, Share asks for a sign-in first', '');
    await page.keyboard.press('Escape');
    await page.click('.sheet-card .iconbtn[aria-label="Close"]').catch(() => {});
    await hbSignIn(page);
    await page.waitForFunction(() => document.querySelectorAll('#panel-habits .hb-row').length >= 3, null, { timeout: 4000 }).catch(() => {});
    const ids = await hbFake(page, `(f) => f.habits.filter((h) => h.user_id === '${HB_ME}' && !h.archived_at).sort((a, b) => a.position - b.position).map((h) => [h.text, h.id])`);
    await page.click(hbPanel + ' .hb-sharebtn');
    await page.waitForSelector('.sheet-card[aria-label="Share your forest"]', { timeout: 4000 });
    const form = await page.$eval('.sheet-body .hb-sharef', (f) => ({ pub: f.querySelector('input[name=public]').checked, name: f.querySelector('input[name=fname]').value,
      trees: [...f.querySelectorAll('input[name=tree]')].map((c) => c.checked), show: f.querySelector('.hb-show .on').textContent, hint: f.querySelector('.bf-hint').textContent }));
    check(form.pub && form.name === 'Alex' && form.trees.length === ids.length && form.trees.every(Boolean) && form.show === 'Just the trees' && form.hint === 'Anyone can see it. Change it or stop anytime.',
      'the share sheet: public, the first name to start, every tree, just the trees, and one line on who sees it', JSON.stringify(form));
    await page.fill('.sheet-body input[name=fname]', 'alex@example.com');
    await page.click('.sheet-body .hb-sharef button[type=submit]');
    check(/no @/.test(await page.$eval('.sheet-body .hb-sharef .bf-msg', (m) => m.textContent)), 'an email is never a name: refused', '');
    await page.fill('.sheet-body input[name=fname]', '  Night   Walker ');
    await page.uncheck('.sheet-body input[name=tree][value="' + ids.find((x) => x[0] === 'Gym')[1] + '"]');
    await page.click('.sheet-body .hb-sharef button[type=submit]');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached', timeout: 4000 }).catch(() => {});
    const saved = await hbFake(page, `(f) => { const x = f.forests.get('${HB_ME}'); return x && { name: x.name, pub: x.public, names: x.show_names, n: f.as('${HB_ME}').sz_forest_get().habits.length }; }`);
    check(saved && saved.name === 'Night Walker' && saved.pub && !saved.names && saved.n === ids.length - 1 && /in Forests/.test(await page.$eval('#toast', (t) => t.textContent)),
      'saved: under the name typed, tidied, public, trees only, without the Gym', JSON.stringify(saved));
    check(await page.$eval(hbPanel + ' .hb-fhead', (h) => h.innerText.replace(/\s+/g, ' ').trim()) === 'Your forest Public Sharing ?', 'the forest says it is public', await page.$eval(hbPanel + ' .hb-fhead', (h) => h.innerText));

    /* the gallery */
    await hbChip(page, 'forests');
    await page.waitForSelector(hbPanel + ' .fr-card', { timeout: 4000 });
    const cards = await page.$$eval(hbPanel + ' .fr-card', (cs) => cs.map((c) => ({ k: c.dataset.k, who: c.querySelector('.fr-who').innerText.replace(/\s+/g, ' ').trim(), sum: c.querySelector('.fr-sum').textContent,
      names: [...c.querySelectorAll('.fr-name')].map((n) => n.textContent), trees: c.querySelectorAll('svg.tree').length })));
    const me = cards.find((c) => /Night Walker/.test(c.who));
    check(cards.length === 4 && me && /You$/.test(me.who) && !me.names.length && me.trees === ids.length - 1, 'Forests: four forests, mine marked You, its trees without their names', JSON.stringify(cards));
    const maya = cards.find((c) => c.who === 'Maya');
    check(maya && JSON.stringify(maya.names) === '["Morning pages","Swim"]' && /^2 trees · \d+ leaves$/.test(maya.sum), 'a forest that shows names shows them, with its trees and leaves counted', JSON.stringify(maya));
    check(!/@|example\.com|802-555/.test(await page.$eval(hbPanel, (p) => p.innerText)), 'no email or phone anywhere in the gallery', '');
    check(/#habits\/forests$/.test(await page.evaluate(() => location.hash)), 'and the address says Forests', '');
    await page.evaluate(() => document.querySelector('.panel:not([hidden])').scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, 'demo-habits-forests.png') });
    await pageRules(page, 'habits', 390);
    await page.click(hbPanel + ' .fr-card[data-k="' + maya.k + '"] .fr-open');
    await page.waitForSelector('.sheet-card[aria-label="Maya"] .hb-grove.fr-all', { timeout: 4000 }).catch(() => {});
    check((await page.$$eval('.sheet-body .hb-grove.fr-all .fr-tree', (t) => t.length)) === 2 && /leaves/.test(await page.$eval('.sheet-body', (b) => b.innerText)), 'a forest opens in a sheet, each tree with its leaves', '');
    await page.click('.sheet-card .iconbtn[aria-label="Close"]');

    /* stop sharing */
    await hbChip(page, 'today');
    await page.click(hbPanel + ' .hb-sharebtn');
    await page.waitForSelector('.sheet-card[aria-label="Share your forest"]', { timeout: 4000 });
    check(!!(await page.$('.sheet-body button:has-text("Send link")')), 'once public, the sheet has a link to send', '');
    await page.uncheck('.sheet-body input[name=public]');
    await page.click('.sheet-body .hb-sharef button[type=submit]');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached', timeout: 4000 }).catch(() => {});
    check(/private/.test(await page.$eval('#toast', (t) => t.textContent)) && !(await hbFake(page, `(f) => f.forests.get('${HB_ME}').public`)) && !(await page.$(hbPanel + ' .hb-pub')), 'stop sharing: private again, and the tag is gone', '');
    await hbChip(page, 'forests');
    await page.waitForFunction(() => document.querySelectorAll('#panel-habits .fr-card').length === 3, null, { timeout: 4000 }).catch(() => {});
    check((await page.$$eval(hbPanel + ' .fr-card', (c) => c.length)) === 3 && !!(await page.$(hbPanel + ' .hb-shareyours')), 'and it leaves the gallery, which offers Share yours', '');
    check(!errors.length, 'no console errors', errors.join(' | '));

    /* a shared link lands on that forest */
    const theo = await hbFake(page, `(f) => f.forests.get('demo-forest-theo').id`);
    await ctx.close();
    const d = await newPage(browser, base);
    await d.page.goto(base + '/all-day/?demo=1#habits/f-' + theo);
    check(await flashes(d.page, 'f-' + theo), '#habits/f-<id> opens Forests on that forest and flashes it', '');
    await d.page.goto(base + '/all-day/?demo=1#habits/f-00000000-0000-4000-8000-000000000000');
    await d.page.waitForFunction(() => /private now/.test(document.querySelector('#toast').textContent), null, { timeout: 4000 }).catch(() => {});
    check(/private now/.test(await d.page.$eval('#toast', (t) => t.textContent)), 'a link to a forest no longer public says so', '');
    check(!d.errors.length, 'no console errors', d.errors.join(' | '));
    await d.ctx.close();
  });
}

/* ---------------------------------------------- What Now's sunset line */
/* The Art tab carried "Sunset is at 6:05 pm"; when Art was folded the line
   moved into What Now's weather line, which now asks sun.js. */
async function sunsetLine(browser, base) {
  await group('What Now, the sunset in the weather line says a score only when there is one (live)', async () => {
    /* sunset-score.js stands in for the shared module: tomorrow at 6:05 pm, and
       the score the page asks for. A 0.0 is what an empty forecast comes out as. */
    const stub = 'window.BtownSunsetScore = { OPEN_METEO_URL: "https://api.open-meteo.com/v1/forecast?x=1", AIR_URL: "https://air-quality-api.open-meteo.com/v1/air-quality?x=1",' +
      ' selectTarget: function () { return { sunsetMs: Date.parse("2026-10-17T22:05:00Z"), isTonight: false }; },' +
      ' computeScore: function () { return { score: window.__score, degraded: !!window.__degraded }; } };';
    const { ctx, page, errors } = await newPage(browser, base);
    await page.route(/\/js\/sunset-score\.js$/, (r) => r.fulfill({ status: 200, body: stub, contentType: 'text/javascript' }));
    const line = async (score, degraded) => {
      await page.addInitScript(([s, d]) => { window.__score = s; window.__degraded = d; }, [score, degraded]);
      await page.goto(base + '/all-day/?s=' + score + (degraded ? 'd' : '') + '#whatnow');
      await settle(page);
      await page.waitForFunction(() => /6:05 sunset tomorrow/.test(document.querySelector('#panel-whatnow .wx')?.innerText.replace(/\s+/g, ' ') || ''), null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(150);
      return page.$eval(wnPanel + ' .wx', (w) => ({ text: w.innerText.replace(/\s+/g, ' '), h: w.getBoundingClientRect().height })).catch(() => ({ text: '', h: 0 }));
    };
    let r = await line(0, false);
    check(/6:05 sunset tomorrow/.test(r.text) && !/\/10/.test(r.text), 'a 0.0 (the forecast missing) is no score: the time, and that it is tomorrow’s', r.text);
    r = await line(6.2, true);
    check(/6:05 sunset tomorrow/.test(r.text) && !/\/10/.test(r.text), 'a score worked out without the forecast is not shown either', r.text);
    r = await line(7.4, false);
    check(/6:05 sunset tomorrow/.test(r.text) && /6:05 sunset tomorrow, 7\.4\/10/.test(r.text), 'a real score is shown beside the time', r.text);
    check(r.h > 0 && r.h < 40, 'and the line stays one line at 390', r.h + ' ' + r.text);
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
      ['#photos', 'wire', '#wire/photos'], ['#photos/p-1', 'wire', '#wire/photos'],
      /* Art was folded into the Wire's Photo mode: its links land there, a picture's key with them */
      ['#art', 'wire', '#wire/photos'], ['#art/b-0000a000-0000-4000-8000-000000000002', 'wire', '#wire/photos/b-0000a000-0000-4000-8000-000000000002'], ['#art/wall', 'wire', '#wire/photos'],
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
    /* every branch that touches the shell bumps sw.js once; check "at least" so merges never clash on the number */
    check(Number((sw.match(/VERSION = 'all-day-v(\d+)'/) || [])[1]) >= 52, 'sw.js VERSION is bumped past Vintage (v51) for Watch, to v52 or later', (sw.match(/VERSION = '[^']+'/) || [''])[0]);
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
      check(made.every((m) => /'embed (spotify|bandcamp|yt)\b/.test(m)), f + ': every iframe it builds is an .embed', made.join(' '));
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
const clubCats = (page) => page.$$eval(peoplePanel + ' [data-clubs] .lrow', (rs) => rs.map((r) => ({ kind: r.dataset.kind, name: r.querySelector('.t').textContent })));
/* the For you strip under the tiles: its rows, or null when it isn't showing */
const forYou = (page) => page.evaluate((s) => { const b = document.querySelector(s + ' [data-sec="foryou"]'); if (!b || b.hidden || !b.querySelector('[data-foryou]')) return null;
  return [...b.querySelectorAll('.lrow')].map((r) => ({ kind: r.dataset.kind, name: r.querySelector('.t').textContent })); }, peoplePanel);
const mixRows = (page) => page.$$eval(peoplePanel + ' [data-mix-day] .lrow', (rs) => rs.map((r) => ({ k: r.dataset.k, kind: r.dataset.kind, reader: r.dataset.reader === '1',
  title: r.querySelector('.t').textContent, href: r.getAttribute('href'), text: r.innerText })));
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
    const { ctx, page, errors } = await newPage(browser, base, { rpc: (fn) => (fn === 'nn_people_directory' ? { count: 12, me: false, people: [] } : undefined),
      routes: [[/play\.btownbrief\.com\/up-for-it\/data\/meetup\.json/, { fetched: new Date().toISOString(), events: feed }]] });
    await page.goto(base + '/all-day/#people');
    await peopleReady(page);
    await page.waitForFunction((s) => !document.querySelector(s + ' [data-sec="mix"] .loading'), peoplePanel, { timeout: 10000 });
    const mix = await page.$$eval(peoplePanel + ' [data-mixers] .owntile', (cs) => cs.map((c) => ({ k: c.dataset.k, href: c.getAttribute('href'), title: c.querySelector('b').textContent, text: c.innerText })));
    check(mix.length === own.length, 'every one of Stephen’s own events in the next two weeks shows, first, as a short row (' + own.length + ')', mix.length + ': ' + mix.map((m) => m.title).join(', '));
    check(own.every((e) => mix.some((m) => m.href === e.url)), 'none is missed', own.filter((e) => !mix.some((m) => m.href === e.url)).map((e) => e.title).join(', '));
    check(mix.every((m) => OWN_URL_T.test(m.href) || OWN_NAME_T.test(m.title)), 'and nothing that isn’t his', mix.map((m) => m.href).join(' '));
    check(mix.some((m) => m.href === feed[0].url && /Place on Meetup/.test(m.text)), 'one thirteen days out, only on his Meetup calendar, shows (place: on Meetup, never guessed)', '');
    check(!dup || mix.filter((m) => m.href === dup.url && Date.parse(dup.start)).length === own.filter((e) => e.url === dup.url).length, 'an event in both sources shows once', dup && dup.title);
    check(mix.every((m) => !/\bgoing\b|interested|RSVPs?:/i.test(m.text)), 'and no Meetup interest count', '');
    /* the calendar's mixers: the next seven days from all-day/data/whatnow.json */
    const PM = await import(path.join(APP, 'js/people-match.js'));
    const today = BTV_DAY.format(new Date());
    const calToday = w.events.filter((e) => e.date === today && PM.mixerKind(e) && !(OWN_URL_T.test(e.url) || OWN_NAME_T.test([e.title, e.venue, (e.tags || []).join(' ')].join(' '))));
    const strip = await page.$$eval(peoplePanel + ' [data-sec="mix"] .mixdays button', (bs) => bs.map((b) => ({ day: b.dataset.day, n: b.querySelector('.n').textContent, on: b.classList.contains('on') })));
    check(strip.length === 7 && strip[0].day === today, 'the mixers: seven days from today', JSON.stringify(strip.map((d) => d.day)));
    const weekN = strip.reduce((n, d) => n + Number(d.n || 0), 0);
    check(weekN >= 10, 'with the calendar’s mixers counted on each (' + weekN + ' this week)', JSON.stringify(strip));
    const busy = strip.find((d) => d.on);
    await page.click(peoplePanel + ' [data-sec="mix"] .mixdays button[data-day="' + busy.day + '"]');
    const rows = await mixRows(page);
    check(rows.length === Number(busy.n) && rows.every((r) => /^https?:/.test(r.href) && r.kind !== 'own'), 'a day’s rows: each links to its event page, none of them his', JSON.stringify(rows.slice(0, 3)));
    check(rows.every((r) => !/\b(kids?|toddler|teens?|storytime|homeschool)\b/i.test(r.title)), 'and no kids’ or teens’ event is a mixer', rows.map((r) => r.title).join(' | '));
    if (busy.day === today) check(rows.length <= calToday.length, 'today’s are the calendar’s, past ones gone', rows.length + ' of ' + calToday.length);
    const cal = await page.$eval(peoplePanel + ' [data-sec="mix"] [data-calendar]', (a) => ({ href: a.href, text: a.textContent.trim() }));
    check(cal.href === base + '/events.html' && /^Full events calendar/.test(cal.text), 'a clear Full events calendar link to the guide’s events page', JSON.stringify(cal));
    const host = await page.$eval(peoplePanel + ' [data-host]', (c) => ({ text: c.innerText, mail: c.querySelector('a.btn').getAttribute('href'), ps: c.querySelectorAll('p').length }));
    check(/Host something with the crew/.test(host.text) && /^mailto:btownbrief@gmail\.com\?subject=/.test(host.mail) && host.ps === 2, 'the host card: a title, two short lines and a prefilled email to Stephen', JSON.stringify(host));
    const order = await page.$$eval(peoplePanel + ' [data-sec]', (ss) => ss.map((x) => x.dataset.sec));
    check(order.indexOf('host') === order.indexOf('mix') + 1, 'right under the mixers', order.join(' '));
    const steve = await page.$eval(peoplePanel + ' [data-host] a.btn', (a) => [a.textContent.trim(), decodeURIComponent(a.getAttribute('href'))]);
    check(steve[0] === 'Email Steve' && /Hi Steve,/.test(steve[1]) && !/Stephen/.test(steve.join(' ')), 'it says Steve, not Stephen (Stephen, 2026-10-18)', JSON.stringify(steve));
    if (!own.length) check(/No Btown Brief meetups/.test(await panelText(page)), 'with none on the calendar it says so and links the group', '');
    const groupsJson = JSON.parse(await readFile(path.join(REPO, 'data/groups.json'), 'utf8')).groups;
    const crows = await clubCats(page);
    check(crows.length === 6 && crows.every((r) => groupsJson.some((c) => c.name === r.name)), 'six clubs from data/groups.json', JSON.stringify(crows));
    check(crows[0].name === groupsJson.find((c) => c.featured).name, 'with nothing picked, the featured club leads', crows[0] && crows[0].name);
    check(await forYou(page) === null, 'and nothing picked, no For you strip', '');
    const txt = await panelText(page);
    check(/No plans yet this week/.test(txt), 'an empty board says so and offers the first plan', '');
    check(!/email sign-in|one email/.test(txt), 'signed out, the tab says nothing about sign-in (the Post sheet does)', '');
    check(/12 neighbors in it/.test(txt) && await page.$(peoplePanel + ' [data-dir="out"] button') !== null, 'People here: the count for anyone, a Sign in button for the people', '');
    check(/Sign in to see who’s here\./.test(await page.$eval(peoplePanel + ' [data-dir="out"]', (c) => c.innerText)), 'signed out: one line and the button', '');
    const doors = await page.$$eval(peoplePanel + ' [data-sec="talk"] a.btn', (as) => as.map((a) => [a.textContent.trim(), a.href]));
    check(doors.length === 3 && /^Find Each Other/.test(doors[0][0]) && doors[0][1] === 'https://www.btownbrief.com/community/channels/music' &&
      /^Plans & Meetups/.test(doors[1][0]) && doors[1][1] === 'https://www.btownbrief.com/community/channels/meetups-hangouts' &&
      /^Telegram/.test(doors[2][0]) && doors[2][1] === base + '/telegram.html', 'one door card: Find Each Other, Plans & Meetups, Telegram', JSON.stringify(doors));
    const chipsTxt = await page.$$eval('#subnav .chip', (cs) => cs.map((c) => c.textContent));
    check(JSON.stringify(chipsTxt) === JSON.stringify(['Who you are', 'Run clubs', 'Open to strangers', 'Mixers', 'Clubs', 'Quiz', 'People here']), 'the chip row is the table of contents', JSON.stringify(chipsTxt));
    await page.evaluate(() => document.querySelector('#panel-people').scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.click('#subnav .chip[data-chip="quiz"]');
    await page.waitForTimeout(1200);
    const top = await page.$eval(peoplePanel + ' [data-sec="quiz"]', (s) => { const p = s.closest('.panel'); return { top: Math.round(s.getBoundingClientRect().top), end: p.scrollTop >= p.scrollHeight - p.clientHeight - 2 }; });
    check(top.top < 260 || top.end, 'a chip scrolls to its section', JSON.stringify(top));
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
    check(/^Posted/.test(await page.$eval('#toast', (t) => t.textContent)), 'and the toast says it posted', '');
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
    check(tc[0].kind === 'outdoors', 'and an outdoors club leads the clubs', JSON.stringify(tc));
    check(await page.$eval(peoplePanel + ' .arch button[data-arch="trail"]', (b) => b.getAttribute('aria-pressed')) === 'true', 'the tile says it is picked', '');
    check(/You’re here as trail person/.test(await page.$eval('#toast', (t) => t.textContent)), 'and the toast says what changed', '');
    const fy = await forYou(page);
    check(fy && fy.length === 3 && fy.some((r) => r.kind === 'run') && fy.some((r) => r.kind === 'outdoors'), 'For you appears under the tiles: a run club and an outdoors group among three', JSON.stringify(fy));
    await page.click(peoplePanel + ' .arch button[data-arch="games"]');
    await page.waitForTimeout(150);
    const games = await planCards(page);
    check(/For game night people|Game night|trivia|game/i.test(games[0].meta + games[0].who + games[0].title), 'Game night: a game plan leads', games[0].title);
    check(['games', 'trivia'].includes((await clubCats(page))[0].kind), 'and a games or trivia club', '');
    await page.click(peoplePanel + ' [data-tags="I’m…"] .chip[data-chip="women"]');
    await page.waitForTimeout(150);
    const w = await clubCats(page);
    check(/Wom/.test(w[0].name) && /Wom/.test(w[1].name), 'a woman finding her people: the two women’s pickup groups come first', JSON.stringify(w));
    check(await page.$eval(peoplePanel + ' [data-tags="I’m…"] .chip[data-chip="women"]', (b) => b.getAttribute('aria-pressed')) === 'true', 'the tag shows as picked', '');
    const p = await peek(page);
    check(p.arch === 'games' && p.tags.includes('women'), 'the picks are kept for the visit', JSON.stringify(p));
    check(await page.evaluate(() => localStorage.getItem('allday-people')) === null, 'and the demo writes nothing to this device', '');
    await page.click(peoplePanel + ' [data-tags="I’m…"] .chip[data-chip="women"]');
    await page.click(peoplePanel + ' .arch button[data-arch="games"]');
    await page.waitForTimeout(150);
    check((await planCards(page))[0].title === before[0].title, 'tapping the tile again clears it: back to soonest first', '');
    check(await forYou(page) === null, 'and with nothing picked the For you strip goes', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  /* the tile table: each tile's For you strip, right under the tiles, at once */
  await group('People, demo: every tile does something, and the mapping holds', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { clock: SAT_1PM });
    await page.goto(base + '/all-day/?demo=1#people');
    await page.waitForSelector(peoplePanel + ' [data-plans] .card.board');
    await page.waitForSelector(peoplePanel + ' [data-sec="clubs"] .days button');
    const order = await secOrder(page);
    check(order.indexOf('foryou') === order.indexOf('arch') + 1, 'the strip’s place is directly under the tiles', order.join(' '));
    const tap = async (sel) => { await page.click(peoplePanel + ' ' + sel); await page.waitForTimeout(120); };
    const want = {
      running: (fy) => fy[0].kind === 'run',
      languages: (fy) => fy[0].kind === 'language',
      games: (fy) => fy.some((r) => r.kind === 'trivia') && fy.some((r) => r.kind === 'games'),
      grad: (fy) => fy.some((r) => /Twenty-Somethings|Btown Brief IRL/.test(r.name)) && fy[0].kind === 'social',
      moved: (fy) => fy.some((r) => /Newcomers|Btown Brief IRL/.test(r.name)),
      lgbtq: (fy) => fy[0].name === 'Out and About Vermont',
      older: (fy) => fy[0].name === 'Second Wind Social Club',
      books: (fy) => fy.every((r) => r.kind === 'books'),
      food: (fy) => fy[0].name === 'Cookbook Club',
      sober: (fy) => fy.length >= 1 && fy.every((r) => ['books', 'outdoors', 'making', 'games', 'run', 'fit'].includes(r.kind)),
    };
    /* the labels: LGBTQ+ with its plus, and a Sober tile beside it */
    const whoLabels = await page.$$eval(peoplePanel + ' [data-tags="I’m…"] .chip', (cs) => cs.map((c) => ({ k: c.dataset.chip, t: c.textContent.trim() })));
    check(whoLabels.some((c) => c.k === 'lgbtq' && /^LGBTQ\+/.test(c.t)) && whoLabels.some((c) => c.k === 'sober' && c.t === 'Sober'), 'the tags read “LGBTQ+” and “Sober”', JSON.stringify(whoLabels));
    check(!(await panelText(page)).match(/LGBTQ(?!\+)/), 'and nowhere on the tab is it LGBTQ without the plus', '');
    /* a tap shows: the tile turns selected, and the strip says what it is showing */
    await tap('[data-tags] .chip[data-chip="lgbtq"]');
    check(await page.$eval(peoplePanel + ' [data-tags] .chip[data-chip="lgbtq"]', (b) => b.classList.contains('on') && b.getAttribute('aria-pressed') === 'true'), 'a tapped tile turns selected (on, pressed)', '');
    check(await page.$eval(peoplePanel + ' [data-sec="foryou"] .sec', (h) => h.querySelector('h2').textContent + ' | ' + h.querySelector('p').textContent) === 'For you | Groups and clubs for LGBTQ+.', 'and the strip says what it is showing', '');
    await tap('[data-tags] .chip[data-chip="sober"]');
    check(/for LGBTQ\+ and Sober\.$/.test(await page.$eval(peoplePanel + ' [data-sec="foryou"] .sec p', (p) => p.textContent)), 'two picked: the line names both', '');
    await tap('[data-tags] .chip[data-chip="lgbtq"]');
    /* Sober: nothing built around drinking, and an explicit sober / recovery event counts */
    const dry = await forYou(page);
    check(dry && dry.every((r) => !/brew|brews|pint|beer|\bbar\b/i.test(r.name)), 'Sober: no brewery run, no book club at the bars', JSON.stringify(dry));
    const PMs = await import(path.join(APP, 'js/people-match.js'));
    check(PMs.fitsText('Sober Saturday: alcohol-free hike', ['sober']) && PMs.fitsText('Recovery book circle', ['sober']) && !PMs.fitsText('Wine walk', ['sober']) &&
      !PMs.fitsText('Coffee and cocktails', ['sober']) && !PMs.fitsText('Book club at the brewery', ['sober']), 'Sober on events: sober and recovery events fit, wine walks and brewery nights do not', '');
    await tap('[data-tags] .chip[data-chip="sober"]');
    for (const [k, ok] of Object.entries(want)) {
      const sel = '[data-tags] .chip[data-chip="' + k + '"]';
      await tap(sel);
      const fy = await forYou(page);
      check(fy && fy.length >= 1 && ok(fy), '“' + k + '”: For you shows ' + (fy ? fy.map((r) => r.name).join(', ') : 'nothing'), JSON.stringify(fy));
      await tap(sel);
      check(await forYou(page) === null, '“' + k + '” off again: the strip goes', '');
    }
    for (const a of ['new', 'regular', 'trail', 'games']) {
      await tap('.arch button[data-arch="' + a + '"]');
      const fy = await forYou(page);
      check(fy && fy.length >= 2, 'the ' + a + ' tile: For you rows at once', JSON.stringify(fy));
      await tap('.arch button[data-arch="' + a + '"]');
    }
    /* a run club in the strip opens its sheet; a group opens its page */
    await tap('[data-tags] .chip[data-chip="running"]');
    await page.click(peoplePanel + ' [data-foryou] .lrow[data-kind="run"]');
    await page.waitForSelector('.sheet-body[data-club-sheet]');
    check(true, 'a run club in For you opens the club’s sheet', '');
    await page.keyboard.press('Escape');
    const href = await page.$eval(peoplePanel + ' [data-foryou]', (b) => (b.querySelector('a.lrow') || {}).target || '');
    check(href === '' || href === '_blank', 'and a group row is a link out', href);
    /* mixers that fit move up and say so */
    await tap('[data-tags] .chip[data-chip="running"]');
    await tap('[data-tags] .chip[data-chip="grad"]');
    await page.click(peoplePanel + ' [data-sec="mix"] .mixdays button[data-day="2026-10-17"]');
    const rows = await mixRows(page);
    check(rows.length && /For you/.test(rows[0].text), 'a mixer that fits what you picked leads its day, marked For you', JSON.stringify(rows.map((r) => r.title)));
    await pageRules(page, 'people', 390);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  /* the group chat card: near the top, and only for a real t.me link. The constant lives in people.js; the test swaps it in the served file. */
  await group('People: the group chat card shows only for a real t.me link, at the top', async () => {
    const withChat = async (value) => {
      const c = await newPage(browser, base, { clock: SAT_1PM });
      await c.page.route(/\/all-day\/js\/modes\/people\.js(\?.*)?$/, async (route) => {
        const res = await route.fetch();
        const body = (await res.text()).replace(/const GROUP_CHAT_URL = '[^']*';/, "const GROUP_CHAT_URL = '" + value + "';");
        await route.fulfill({ response: res, body });
      });
      await c.page.goto(base + '/all-day/?demo=1#people');
      await c.page.waitForSelector(peoplePanel + ' [data-sec="arch"] .arch');
      return c;
    };
    const card = (page) => page.evaluate((s) => { const x = document.querySelector(s + ' [data-sec="chat"]'); const a = x && x.querySelector('a.btn');
      return { hidden: !x || x.hidden || !x.querySelector('[data-chat]'), href: a ? a.getAttribute('href') : null, text: x ? x.innerText : '' }; }, peoplePanel);
    const todo = await withChat('TODO');
    const t = await card(todo.page);
    check(t.hidden && !t.href, 'with the TODO value the card is hidden', JSON.stringify(t));
    await todo.ctx.close();
    const bad = await withChat('https://example.com/join');
    check((await card(bad.page)).hidden, 'a link that is not t.me is hidden too', '');
    await bad.ctx.close();
    const live = await withChat('https://t.me/+AbCdEf12345');
    const l = await card(live.page);
    check(!l.hidden && l.href === 'https://t.me/+AbCdEf12345' && /Join the group chat/.test(l.text) && /Join on Telegram/.test(l.text), 'with a real-looking t.me link the card shows, linking it', JSON.stringify(l));
    const order = await secOrder(live.page);
    check(order[0] === 'chat' && order[1] === 'arch', 'and it is the first thing on the tab, above who you are', order.join(' '));
    check(await live.page.$eval(peoplePanel + ' [data-chat]', (c) => c.querySelectorAll('p').length) === 1, 'a title, one line and a button', '');
    await live.ctx.close();
    /* as shipped: the file's own value is a real t.me link, and it is not the movie / TV watch chat */
    const js = await readFile(path.join(APP, 'js/modes/people.js'), 'utf8');
    const shipped = (js.match(/const GROUP_CHAT_URL = '([^']*)';/) || [])[1] || '';
    const watch = ((await readFile(path.join(APP, 'js/modes/watch.js'), 'utf8')).match(/const TELEGRAM_URL = '([^']*)';/) || [])[1];
    const real = await newPage(browser, base, { clock: SAT_1PM });
    await real.page.goto(base + '/all-day/?demo=1#people');
    await real.page.waitForSelector(peoplePanel + ' [data-sec="arch"] .arch');
    const r = await card(real.page);
    check(/^https:\/\/t\.me\//.test(shipped) && shipped !== watch && !r.hidden && r.href === shipped, 'as shipped: a real group-chat link, not the watch chat, and the card shows', JSON.stringify({ shipped, r }));
    await real.ctx.close();
  });

  await group('People, demo: mixers from everywhere, and the readers’ gatherings', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { clock: SAT_1PM });
    await page.goto(base + '/all-day/?demo=1#people/mix');
    await page.waitForSelector(peoplePanel + ' [data-sec="mix"] .mixdays button');
    const own = await page.$$eval(peoplePanel + ' [data-mixers] .owntile', (cs) => cs.map((c) => c.dataset.k));
    check(own.length >= 3 && own.every((k) => /^mx-dm/.test(k)), 'Stephen’s own lead the section, as a short row', own.join(' '));
    /* Stephen, 2026-10-18: a button opens the row into a list that scrolls down, and a Collapse bar folds it back */
    const ownBtn = () => page.$eval(peoplePanel + ' [data-own-all]', (b) => [b.textContent, b.dataset.ownAll, b.getAttribute('aria-expanded')]);
    check(JSON.stringify(await ownBtn()) === JSON.stringify(['Show all ' + own.length, 'closed', 'false']) && !!(await page.$(peoplePanel + ' .rail[data-mixers]')), 'his row has a Show all button', JSON.stringify(await ownBtn()));
    await page.click(peoplePanel + ' [data-own-all]');
    const list = await page.evaluate(() => { const l = document.querySelector('#panel-people .ownlist[data-mixers]'); if (!l) return null;
      const r = [...l.querySelectorAll('.owntile')].map((t) => t.getBoundingClientRect());
      return { n: r.length, rail: !!l.closest('.rail-wrap'), down: r.every((x, i) => !i || x.top >= r[i - 1].bottom), left: new Set(r.map((x) => Math.round(x.left))).size, wide: r.every((x) => x.width > 300),
        bar: (l.parentElement.querySelector('.collapsebar [data-collapse]') || {}).ariaLabel || '' }; });
    check(list && list.n === own.length && !list.rail && list.down && list.left === 1 && list.wide && list.bar === 'Collapse Btown Brief IRL',
      'Show all stacks every one, full width, in a list that scrolls down, with a Collapse bar', JSON.stringify(list));
    check(JSON.stringify(await ownBtn()) === JSON.stringify(['Show less', 'open', 'true']), 'and the button says Show less', JSON.stringify(await ownBtn()));
    await page.click(peoplePanel + ' [data-sec="mix"] [data-collapse]');
    await page.waitForTimeout(700);
    const back = await page.evaluate(() => { const h = document.querySelector('#panel-people [data-sec="mix"] .sec').getBoundingClientRect().top;
      return { rail: !!document.querySelector('#panel-people .rail[data-mixers]'), bar: !!document.querySelector('#panel-people .collapsebar'), ok: h >= 0 && h < innerHeight / 2,
        focus: (document.activeElement && document.activeElement.dataset.ownAll) || '' }; });
    check(back.rail && !back.bar && back.ok && back.focus === 'closed', 'Collapse folds it back into the row, lands on the Mixers head, and the keyboard is on Show all', JSON.stringify(back));
    const days = await page.$$eval(peoplePanel + ' [data-sec="mix"] .mixdays button', (bs) => bs.map((b) => [b.dataset.day, b.querySelector('.wd').textContent, b.querySelector('.n').textContent]));
    check(days[0][0] === '2026-10-17' && days[0][1] === 'Today' && days.length === 7, 'seven days, today first', JSON.stringify(days));
    let rows = await mixRows(page);
    check(rows.some((r) => /Singles Mixer/.test(r.title) && /Singles/.test(r.text)), 'today: the singles mixer, named for its kind', JSON.stringify(rows.map((r) => r.title)));
    check(!rows.some((r) => /Coffee Club/.test(r.title)), 'and his own are not listed twice', '');
    await page.click(peoplePanel + ' [data-sec="mix"] .mixdays button[data-day="2026-10-21"]');
    rows = await mixRows(page);
    check(rows.some((r) => /BTV Tech Tuesday/.test(r.title) && /Networking/.test(r.text)), 'a tech meetup counts', JSON.stringify(rows.map((r) => r.title)));
    /* the readers' gatherings: the approved ones, marked */
    await page.click(peoplePanel + ' [data-sec="mix"] .mixdays button[data-day="2026-10-19"]');
    rows = await mixRows(page);
    const g = rows.find((r) => r.reader);
    check(g && /Pickup ultimate at Leddy/.test(g.title) && /Reader-posted/.test(g.text), 'an approved reader gathering is on its day, marked reader-posted', JSON.stringify(rows.map((r) => r.title + (r.reader ? ' (reader)' : ''))));
    const all = [];
    for (const [d] of days) { await page.click(peoplePanel + ' [data-sec="mix"] .mixdays button[data-day="' + d + '"]'); all.push(...(await mixRows(page))); }
    check(!all.some((r) => /fiddle jam/i.test(r.title)), 'one still waiting for Stephen never shows', '');
    check(!all.some((r) => /Toddler|Wolf Kahn/.test(r.title)), 'a toddler music time and an exhibit are not mixers', '');
    check(all.some((r) => /Spanish Conversation/.test(r.title)) && all.some((r) => /Run Club Social/.test(r.title)) && all.some((r) => /Founders/.test(r.title)), 'a language table, a run club social and a networking night all are', '');
    check(all.some((r) => r.reader && r.href && /^https:\/\/example\.com/.test(r.href)), 'a gathering with its own link links out', '');
    await page.click(peoplePanel + ' [data-sec="mix"] .mixdays button[data-day="2026-10-19"]');
    await page.click(peoplePanel + ' [data-mix-day] button.lrow[data-reader="1"]');
    await page.waitForSelector('.sheet-body[data-gathering]');
    check(/Leddy Park/.test(await page.$eval('.sheet-body', (b) => b.innerText)), 'one without a link opens its own sheet: when, where, what', '');
    await page.keyboard.press('Escape');
    await page.goto(base + '/all-day/?demo=1#people/mc-dc6');
    check(await flashes(page, 'mc-dc6'), 'a calendar mixer’s link picks its day and flashes it', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('People, demo: the plans filter by Meetup, age and activity', async () => {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/all-day/?demo=1#people/plans');
    await page.waitForSelector(peoplePanel + ' [data-plans] .card.board');
    const chipsTxt = await page.$$eval(peoplePanel + ' [data-filter] .chip', (cs) => cs.map((c) => c.dataset.chip));
    check(chipsTxt[0] === 'all' && chipsTxt.includes('meetup') && chipsTxt.includes('age:twenties') && chipsTxt.includes('act:games') && chipsTxt.includes('act:outdoors'),
      'chips: all, Meetup, the age bands and the activities the plans have', chipsTxt.join(' '));
    const all = (await planCards(page)).length;
    await page.click(peoplePanel + ' [data-filter] .chip[data-chip="age:twenties"]');
    let cards = await planCards(page);
    check(cards.length && cards.length < all && cards.every((c) => /Mostly 20s|Any age/.test(c.meta)), '20s: the plans for their 20s, and any age', JSON.stringify(cards.map((c) => c.meta)));
    await page.click(peoplePanel + ' [data-filter] .chip[data-chip="act:games"]');
    cards = await planCards(page);
    check(cards.every((c) => /Mostly 20s|Any age/.test(c.meta) && /game|trivia/i.test(c.title)), 'and an activity on top of it', JSON.stringify(cards.map((c) => c.title)));
    check((await peek(page)).fAge === 'twenties' && (await peek(page)).fAct === 'games', 'both held', '');
    await page.click(peoplePanel + ' [data-filter] .chip[data-chip="all"]');
    check((await planCards(page)).length === all, 'All plans clears them', '');
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
    check(/Sign in to post\./.test(await page.$eval('.sheet-body', (b) => b.innerText)) && await page.$('.sheet-body form') === null,
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
    check(/^Seven quick questions to find your people\.$/.test(await page.$eval(peoplePanel + ' [data-quiz="intro"] h3', (h) => h.textContent)), 'the quiz says what it is in one line', '');
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
      mixers: c.querySelectorAll('[data-quiz-mixer] .lrow').length, post: !!c.querySelector('[data-quiz-post]') }));
    check(/Probably: Trail person/.test(res.text) && !/a guess, not a box/.test(res.text) && await page.$(peoplePanel + ' [data-quiz="done"] button') !== null, 'it ends in a suggested archetype the reader can take or not', res.text.slice(0, 160));
    check(res.clubs === 3 && res.mixers === 1 && res.post, 'with your three groups, your best upcoming mixer and Post a plan', JSON.stringify(res));
    await page.screenshot({ path: path.join(SHOTS, 'demo-people-quiz.png') });
    check((await peek(page)).arch === null, 'nothing changes until the reader says so', '');
    await page.click(peoplePanel + ' [data-quiz="done"] button:has-text("That’s me")');
    await page.waitForTimeout(150);
    const p = await peek(page);
    check(p.arch === 'trail' && JSON.stringify(p.quizTags) === '["outdoors"]', '“That’s me” takes the archetype and what the quiz learned', JSON.stringify(p));
    check(await page.$eval(peoplePanel + ' .arch button[data-arch="trail"]', (b) => b.classList.contains('on')), 'and the tile at the top lights', '');
    await page.click(peoplePanel + ' .arch button[data-arch="new"]');
    check((await peek(page)).arch === 'new', 'the reader can still pick another', '');
    /* Post a plan, filled in for a trail person */
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.waitForTimeout(150);
    await page.click(peoplePanel + ' [data-quiz-post]');
    await page.waitForSelector('.sheet-body form.bform[data-pre] input[name=title]');
    const pre = await page.evaluate(() => { const f = document.querySelector('form.bform'); return { title: f.title.value, arch: f.arch.value, day: f.day.value }; });
    check(pre.title === 'Sunset walk on the bike path' && pre.arch === 'trail' && pre.day === '', 'Post a plan opens the composer filled in for your kind of thing (the day is yours to pick)', JSON.stringify(pre));
    await page.keyboard.press('Escape');
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
    check(!/stays on this phone|saved to your profile/.test(await page.$eval(peoplePanel + ' [data-sec="arch"]', (s) => s.innerText)) && /People tile and quiz[^.]*stay on this phone/.test(await settingsText(page)),
      'where each kind of tag lives is said once, in Settings, not on the tab', '');
    await page.keyboard.press('Escape');
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
    check(new RegExp(on.length + ' neighbors in it').test(txt) && !on.concat(off).some((n) => txt.includes(n)), 'signed out: how many, and nobody by name', txt.slice(0, 200));
    check(await page.$(peoplePanel + ' [data-sec="dir"] .hchip') === null, 'and no handles', '');
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.waitForSelector(peoplePanel + ' [data-dir="join"]');
    check(/Add your first name/.test(await page.$eval(peoplePanel + ' [data-dir="join"]', (c) => c.innerText)), 'signed in with no name: asked for one first', '');
    await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.setProfile({ display_name: 'Robin', neighborhood: 'south-end', archetype: 'trail' })));
    await page.waitForSelector(peoplePanel + ' [data-dir="join"] button:has-text("Join the directory")');
    txt = await page.$eval(peoplePanel + ' [data-sec="dir"]', (s) => s.innerText);
    check(!on.concat(off).some((n) => txt.includes(n)), 'not in it yet: nobody from the directory by name', '');
    await page.click(peoplePanel + ' [data-tags="I’m into…"] .chip[data-chip="running"]');
    await page.click(peoplePanel + ' [data-tags="I’m…"] .chip[data-chip="lgbtq"]');
    await page.click(peoplePanel + ' [data-dir="join"] button:has-text("Join the directory")');
    await page.waitForSelector(peoplePanel + ' [data-dir="in"]');
    await page.waitForSelector(peoplePanel + ' [data-people]');
    const rows = await page.$$eval(peoplePanel + ' [data-people] .lrow', (rs) => rs.map((r) => r.innerText));
    txt = await page.$eval(peoplePanel + ' [data-sec="dir"]', (s) => s.innerText);
    check(on.every((n) => rows.some((r) => r.includes(n))), 'in it: everyone who opted in', rows.length);
    check(!off.some((n) => txt.includes(n)), 'only opted-in rows: ' + off.join(' and ') + ' never show', '');
    check(/Robin \(you\)/.test(rows[0]) && /South End/.test(rows[0]) && /Trail person/.test(rows[0]) && /Running/.test(rows[0]), 'your row first: first name, neighborhood, tile, interests', rows[0]);
    check(!/LGBTQ|lgbtq/.test(txt), 'the who-you-are tags never reach the directory', '');
    const html = await page.$eval(peoplePanel, (p) => { const c = p.cloneNode(true); c.querySelectorAll('[data-host]').forEach((x) => x.remove()); return c.innerHTML + c.innerText; });
    check(!/@/.test(html), 'no email anywhere on the tab (Stephen’s own, on the host card, aside)', (html.match(/.{20}@.{20}/) || [''])[0]);
    await page.click(peoplePanel + ' [data-sec="dir"] button:has-text("Leave the directory")');
    await page.waitForSelector(peoplePanel + ' [data-dir="join"]');
    check(new RegExp(on.length + ' neighbors in it').test(await page.$eval(peoplePanel + ' [data-sec="dir"]', (s) => s.innerText)), 'leaving takes you out of the count', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('People, demo: People here shows handles that open the app, only switched-on ones', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { viewport: { width: 390, height: 844 } });
    await page.goto(base + '/all-day/?demo=1#people/dir');
    await page.waitForSelector(peoplePanel + ' [data-dir="out"]');
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.waitForSelector(peoplePanel + ' [data-joined] .jtile');
    const fake = await fakeOf(page, (f) => [...f.profiles.values()].filter((p) => p.handles && Object.keys(p.handles).length).map((p) => ({ name: p.display_name, pub: !!p.handles_public, at: p.updated_at || 0 })));
    const pub = fake.filter((p) => p.pub).sort((a, b) => b.at - a.at).map((p) => p.name), priv = fake.filter((p) => !p.pub).map((p) => p.name);
    const joined = await page.$$eval(peoplePanel + ' [data-joined] .jtile > b', (bs) => bs.map((b) => b.textContent));
    check(joined.length === Math.min(8, pub.length) && joined.every((n, i) => n === pub[i]), 'Just joined: the newest handles, newest first', JSON.stringify([joined, pub]));
    const txt = await page.$eval(peoplePanel + ' [data-sec="dir"]', (s) => s.innerText);
    check(pub.every((n) => txt.includes(n)) && !priv.some((n) => txt.includes(n)), 'everyone with the switch on is here; ' + priv.join(', ') + ' (switch off) never are', '');
    const chips = await page.$$eval(peoplePanel + ' [data-people] .hchip', (cs) => cs.map((c) => ({ k: c.dataset.handle, tag: c.tagName, href: c.getAttribute('href') || '', target: c.target || '', text: c.textContent })));
    const by = (k) => chips.find((c) => c.k === k);
    check(by('instagram') && by('instagram').href === 'https://www.instagram.com/maya.outside/' && by('instagram').target === '_blank', 'Instagram opens the profile', JSON.stringify(by('instagram')));
    check(by('letterboxd') && /^https:\/\/letterboxd\.com\/\w+\/$/.test(by('letterboxd').href), 'Letterboxd too', '');
    check(by('steam') && by('steam').href === 'https://steamcommunity.com/id/devk_btv', 'and Steam', '');
    check(by('xbox') && by('xbox').href === 'https://account.xbox.com/en-us/profile?gamertag=SamiH%232087', 'an Xbox gamertag, encoded', by('xbox') && by('xbox').href);
    check(['discord', 'riot', 'switch', 'beli', 'epic', 'psn'].every((k) => !by(k) || (by(k).tag === 'BUTTON' && !by(k).href)), 'a name with no profile page (Discord, Riot, Switch, PSN, Epic, Beli) is a copy button', JSON.stringify(chips.filter((c) => c.tag === 'BUTTON').map((c) => c.k)));
    await page.click(peoplePanel + ' [data-people] .hchip[data-handle="discord"]');
    await page.waitForFunction(() => /Copied|Discord:/.test(document.querySelector('#toast').textContent), null, { timeout: 3000 }).catch(() => {});
    check(/Copied .+ Discord|Discord: /.test(await page.$eval('#toast', (t) => t.textContent)), 'tapping it copies the name and says so', await page.$eval('#toast', (t) => t.textContent));
    await page.evaluate(() => import('/all-day/js/boards.js').then((b) => b.setProfile({ display_name: 'Robin' })));
    await page.waitForTimeout(300);
    await page.click(peoplePanel + ' [data-add-handles]');
    await page.waitForSelector('.sheet-body [data-handles] details[open]');
    const opened = await page.$$eval('.sheet-body [data-handles] details', (ds) => ds.every((d) => d.open));
    check(opened, 'Add your handles opens the profile sheet at its Handles, every fold open', '');
    await page.fill('.sheet-body input[name="h:spotify"]', 'robin.listens');
    await page.check('.sheet-body input[name="handles_public"]');
    await page.click('.sheet-body .bform button[type=submit]');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached', timeout: 6000 });
    await page.waitForFunction(() => /Robin \(you\)/.test(document.querySelector('#panel-people [data-joined]')?.innerText || ''), null, { timeout: 4000 }).catch(() => {});
    check(/^Robin \(you\)/.test(await page.$eval(peoplePanel + ' [data-joined] .jtile > b', (b) => b.textContent)), 'saved with the switch on: you lead Just joined', '');
    await page.$eval(peoplePanel + ' [data-sec="dir"]', (s) => s.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SHOTS, 'demo-people-here-390.png') });
    await pageRules(page, 'people', 390);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  /* what comes off the wire is data: a handle row or an event title with markup in it draws as text */
  await group('People, live: handles and event titles are text, never markup', async () => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    const w = JSON.parse(await readFile(path.join(APP, 'data/whatnow.json'), 'utf8'));
    const today = BTV_DAY.format(new Date());
    const later = new Date(Date.now() + 3 * 3600000);
    const ev = { id: 'evil1', title: 'Trivia night ' + evil, start: later.toISOString(), date: BTV_DAY.format(later), end: new Date(+later + 3600000).toISOString(),
      url: 'https://example.com/trivia', category: 'games', allDay: false, venue: 'The Bar ' + evil, town: 'Burlington', tags: [] };
    const wn = { ...w, events: [ev].concat(w.events.filter((e) => e.date !== today)) };
    const { ctx, page, errors } = await newPage(browser, base, {
      routes: [[/all-day\/data\/whatnow\.json/, wn]],
      rpc: (fn) => {
        if (fn === 'nn_profile_get') return { display_name: 'Robin', neighborhood: null, archetype: null };
        if (fn === 'nn_people_directory') return { count: 1, me: false, people: [] };
        if (fn === 'nn_handles_recent') return [{ display_name: 'Eve ' + evil, neighborhood: 'downtown', updated_at: '2026-10-17', me: false,
          handles: { instagram: 'eve"><script>window.__pwned=2</script>', steam: 'javascript:alert(1)', strava: 'eve_runs', discord: 'eve' } }];
        return undefined;
      },
    });
    await page.goto(base + '/all-day/?x=1');
    await page.evaluate((s) => localStorage.setItem('allday-auth', s), SESSION());
    await page.goto(base + '/all-day/#people/dir');
    await page.waitForSelector(peoplePanel + ' [data-people] .lrow', { timeout: 15000 });
    const row = await page.$eval(peoplePanel + ' [data-people] .lrow', (r) => ({ text: r.innerText, imgs: r.querySelectorAll('img').length, chips: [...r.querySelectorAll('.hchip')].map((c) => c.dataset.handle) }));
    check(/Eve <img src=x/.test(row.text) && row.imgs === 0, 'a name with markup in it is printed as text', row.text.slice(0, 80));
    check(row.chips.join() === 'strava,discord', 'a handle that isn’t its service’s shape is dropped, the rest kept', row.chips.join());
    await page.click(peoplePanel + ' [data-sec="mix"] .mixdays button[data-day="' + ev.date + '"]');
    const mrow = await page.$eval(peoplePanel + ' [data-mix-day] .lrow[data-k="mc-evil1"]', (r) => ({ text: r.innerText, imgs: r.querySelectorAll('img').length }));
    check(/Trivia night <img/.test(mrow.text) && mrow.imgs === 0, 'an event title with markup is text too', mrow.text.slice(0, 80));
    check(await page.evaluate(() => window.__pwned) === undefined, 'and nothing ran', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });
}

/* ------------------------------------------------------------- run clubs */
/* data/run-clubs.json through clubs-week.js, in People (the week strip, the
   club sheet, "I'm going") and What Now (the window rows, Move with people,
   the club mission). The demo's clubs are invented; two of its meets sit
   1.25 and 2.5 hours after the moment it opens. Every group here freezes the
   clock at a Burlington Saturday, October 17, 2026, so the week is known. */
const SAT_1PM = Date.parse('2026-10-17T13:00:00-04:00');
const clubRows = (page, sel) => page.$$eval(sel + ' .lrow.meet', (rs) => rs.map((r) => ({ k: r.dataset.k, club: r.dataset.club, at: Number(r.dataset.at),
  name: r.querySelector('.t').textContent, time: r.querySelector('.tm').innerText.replace(/\s+/g, ' ').trim(), lines: [...r.querySelectorAll('.s')].map((x) => x.textContent),
  oneLine: [...r.querySelectorAll('.s.one')].every((x) => getComputedStyle(x).whiteSpace === 'nowrap' && x.getBoundingClientRect().height < 22),
  map: (r.querySelector('a.map') || {}).href || '' })));
const clubsSec = peoplePanel + ' [data-sec="clubs"]';
const secOrder = (page) => page.$$eval(peoplePanel + ' [data-sec]', (ss) => ss.map((x) => x.dataset.sec));
/* the same, without the group-chat card on top (it is first, and only there while the link is real) */
const secOrderBelowChat = async (page) => (await secOrder(page)).filter((k) => k !== 'chat');

async function theClubs(browser, base) {
  await group('Run clubs, People: the week strip, the sheet and I’m going (demo, 390)', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { clock: SAT_1PM });
    await page.goto(base + '/all-day/?demo=1#people');
    await page.waitForSelector(clubsSec + ' .days button');
    check(await page.$eval(clubsSec + ' .sec h2', (h) => h.textContent) === 'Run clubs this week', 'the section is “Run clubs this week”, a title and nothing under it',
      await page.$eval(clubsSec + ' .sec', (h) => h.innerText));
    check(!(await page.$(clubsSec + ' .sec p')), 'no subtitle', '');
    const order = await secOrder(page);
    check(order.indexOf('clubs') === order.indexOf('foryou') + 1 && order.indexOf('foryou') === order.indexOf('arch') + 1 && order.indexOf('clubs') < order.indexOf('plans'), 'it sits near the top, under who you are (and For you)', order.join(' '));
    const every = await page.$eval(clubsSec + ' [data-every-club] a', (a) => ({ text: a.textContent.trim(), href: a.href }));
    check(/^Every club and league in town/.test(every.text) && every.href === base + '/clubs.html', 'right under the week: Every club and league in town, to clubs.html', JSON.stringify(every));
    const days = await page.$$eval(clubsSec + ' .days button', (bs) => bs.map((b) => ({ day: b.dataset.day, wd: b.querySelector('.wd').textContent, n: b.querySelector('.n').textContent, on: b.classList.contains('on') })));
    check(days.length === 7 && days[0].day === '2026-10-17' && days[0].wd === 'Today', 'seven days, starting today in Burlington', JSON.stringify(days.map((d) => d.day)));
    check(days.map((d) => d.wd).join(' ') === 'Today Sun Mon Tue Wed Thu Fri', 'one of each weekday, in order', days.map((d) => d.wd).join(' '));
    check(days[0].on, 'today is the day showing', '');
    let rows = await clubRows(page, clubsSec);
    check(rows.length === 1 && rows[0].name === 'Red Rocks Trail Run' && rows[0].time === '2:15 pm', 'today: what is still to come (the 8 am run has gone)', JSON.stringify(rows.map((r) => r.name + ' ' + r.time)));
    await page.click(clubsSec + ' .days button[data-day="2026-10-19"]');
    rows = await clubRows(page, clubsSec);
    check(rows.map((r) => r.name).join(' | ') === 'Sunrise Striders | Old North End Social Run' && rows[0].at < rows[1].at, 'Monday’s runs, in time order', JSON.stringify(rows.map((r) => r.name)));
    const one = rows[1];
    check(one.time === '6:15 pm' && /^Foam Brewers · All paces/.test(one.lines[0]) && one.lines[1] === 'Never run with a group before? Perfect.' && one.lines[0] === 'Foam Brewers · All paces', 'a row: the club, the time, the place and the pace, the newcomer line', JSON.stringify(one));
    check(rows.every((r) => r.oneLine), 'each line under the name is one line', '');
    check(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=44\.4789%2C-73\.2196$/.test(one.map), 'the place is a map link', one.map);
    await page.click(clubsSec + ' .days button[data-day="2026-10-22"]');
    rows = await clubRows(page, clubsSec);
    check(rows.map((r) => r.name).join('|') === 'Lakefront Run Crew', 'a club out of season (Summer Track Nights) is never on the strip', JSON.stringify(rows.map((r) => r.name)));
    await page.click(clubsSec + ' [data-rc-kind] button:has-text("Fitness")');
    check(await page.$eval(clubsSec + ' .sec h2', (h) => h.textContent) === 'Fitness this week', 'the switch: Fitness this week', '');
    rows = await clubRows(page, clubsSec);
    check(rows.length && rows.every((r) => r.club !== 'red-rocks-trail-run' && r.club !== 'lakefront-run-crew'), 'and no run club in it', JSON.stringify(rows.map((r) => r.name)));
    check(rows.map((r) => r.name).join('|') === 'Yoga on the Green|Queen City Pickup', 'today’s fitness: yoga, then pickup', JSON.stringify(rows.map((r) => r.name)));
    await page.click(clubsSec + ' [data-rc-kind] button:has-text("Run")');

    /* a runner: the week stays put under the tiles, and For you brings a run club up to the tiles */
    await page.click(peoplePanel + ' [data-tags="I’m into…"] .chip[data-chip="running"]');
    await page.waitForTimeout(150);
    const o2 = await secOrderBelowChat(page);
    check(o2[0] === 'arch' && o2[1] === 'foryou' && o2[2] === 'clubs', 'A runner: nothing jumps; For you, then the club week, right under the tiles', o2.join(' '));
    check(((await forYou(page)) || [])[0]?.kind === 'run', 'and For you leads with a run club', JSON.stringify(await forYou(page)));
    await page.evaluate(() => document.querySelector('#panel-people').scrollTo(0, 0));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SHOTS, 'clubs-people-390.png') });
    await page.click(peoplePanel + ' [data-tags="I’m into…"] .chip[data-chip="running"]');
    await page.waitForTimeout(150);

    /* the sheet */
    await page.click(clubsSec + ' [data-rc-kind] button:has-text("Run")');
    await page.click(clubsSec + ' .days button[data-day="2026-10-19"]');
    await page.click(clubsSec + ' .lrow.meet[data-club="old-north-end-social-run"] .open');
    await page.waitForSelector('.sheet-body[data-club-sheet="old-north-end-social-run"]');
    const sheet = await page.$eval('.sheet-card', (c) => ({ title: c.querySelector('.sheet-head h2').textContent, what: c.querySelector('.pick-why').textContent,
      meets: [...c.querySelectorAll('[data-meet]')].map((m) => m.innerText.replace(/\s+/g, ' ')), facts: [...c.querySelectorAll('[data-fact]')].map((f) => f.dataset.fact),
      links: [...c.querySelectorAll('[data-links] a')].map((a) => a.textContent.trim()), going: [...c.querySelectorAll('button')].filter((b) => /I’m going/.test(b.textContent)).length }));
    check(sheet.title === 'Old North End Social Run' && /brewery/.test(sheet.what), 'tapping the row opens the club’s sheet: its name and what it is', JSON.stringify(sheet));
    check(sheet.meets.length === 2 && /^Mondays, 6:15 pm/.test(sheet.meets[0]) && /^Fridays, 5:30 pm/.test(sheet.meets[1]) && sheet.meets.every((m) => /Foam Brewers/.test(m)), 'every meet, by weekday, with its place', JSON.stringify(sheet.meets));
    check(sheet.facts.join(' ') === 'pace cost season newcomers', 'pace, cost, season, newcomers', sheet.facts.join(' '));
    check(sheet.links.join(' ') === 'Site Instagram Meetup', 'its links: site, Instagram, Meetup (no Strava, so none)', sheet.links.join(' '));
    check(sheet.going === 1, 'and one button, I’m going', '');
    await page.click('.sheet-card button:has-text("I’m going")');
    await page.waitForSelector('.sheet-body .linkrow');
    check(/Sign in to post\./.test(await page.$eval('.sheet-body', (b) => b.innerText)), 'signed out, I’m going asks for the sign-in like any plan', '');
    await page.keyboard.press('Escape');
    await page.evaluate(() => import('/all-day/js/auth.js').then((a) => a.demoSignIn()));
    await page.waitForTimeout(150);
    await page.click(clubsSec + ' .lrow.meet[data-club="old-north-end-social-run"] .open');
    await page.click('.sheet-card button:has-text("I’m going")');
    await page.waitForSelector('.sheet-body form.bform[data-pre] input[name=title]');
    const pre = await page.evaluate(() => { const f = document.querySelector('form.bform'); return { title: f.title.value, day: f.day.value, time: f.time.value, place: f.place.value,
      times: [...f.time.options].map((o) => o.value) }; });
    check(pre.title === 'Old North End Social Run' && pre.day === 'Mon, Oct 19' && pre.time === '6:15 pm' && pre.place === 'Foam Brewers, Burlington',
      'I’m going opens the plan composer with the meet filled in: title, day, time, place', JSON.stringify({ ...pre, times: undefined }));
    const i = pre.times.indexOf('6:15 pm');
    check(i > 0 && pre.times[i - 1] === '6 pm' && pre.times[i + 1] === '6:30 pm', 'a time off the half hour joins the list in its place', pre.times.slice(i - 1, i + 2).join(', '));
    await page.fill('input[name=display_name]', 'Robin');
    await page.click('.bform button[type=submit]');
    await page.waitForSelector('#sheet[hidden]', { state: 'attached', timeout: 6000 });
    await page.waitForTimeout(300);
    const mine = (await peek(page)).posts.find((x) => x.title === 'Old North End Social Run');
    check(mine && mine.meta.when === 'Mon, Oct 19, 6:15 pm', 'and it posts as an open-to-strangers plan for that meet', JSON.stringify(mine));
    check(await page.$(peoplePanel + ' [data-plans] .card.board[data-k="b-' + (mine && mine.id) + '"]') !== null, 'the plan is on the board', '');
    await pageRules(page, 'people', 390);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Run clubs, People: deep links (demo, 1280, dark)', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { clock: SAT_1PM, viewport: { width: 1280, height: 800 }, scheme: 'dark' });
    await page.goto(base + '/all-day/?demo=1#people/clubs');
    await page.waitForSelector(clubsSec + ' .lrow.meet');
    await page.waitForTimeout(700);
    await page.click(peoplePanel + ' [data-tags="I’m into…"] .chip[data-chip="sports"]');
    check(await page.$eval(clubsSec + ' .sec h2', (h) => h.textContent) === 'Fitness this week', 'an athlete who never touched the switch lands on Fitness', '');
    await page.click(peoplePanel + ' [data-tags="I’m into…"] .chip[data-chip="sports"]');
    await page.$eval(clubsSec, (s) => s.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    const y = await page.$eval(clubsSec, (s) => Math.round(s.getBoundingClientRect().top));
    check(y < 260, '#people/clubs lands on the club week', y);
    await page.goto(base + '/all-day/?demo=1#people/rc-old-north-end-social-run-2026-10-19-1815');
    await page.waitForSelector('.sheet-body[data-club-sheet="old-north-end-social-run"]', { timeout: 8000 });
    check(await page.$eval(clubsSec + ' .days button.on', (b) => b.dataset.day) === '2026-10-19', 'a meet’s link picks its day', '');
    check(await page.$(clubsSec + ' .lrow.meet[data-k="rc-old-north-end-social-run-2026-10-19-1815"]') !== null, 'shows its row', '');
    check(await page.$('.sheet-card [data-going="rc-old-north-end-social-run-2026-10-19-1815"]') !== null, 'and opens its sheet, I’m going set to that meet', '');
    await page.keyboard.press('Escape');
    await page.goto(base + '/all-day/?demo=1#people/club-lake-rowers');
    await page.waitForSelector('.sheet-body[data-club-sheet="lake-rowers"]', { timeout: 8000 });
    check(await page.$eval(clubsSec + ' .sec h2', (h) => h.textContent) === 'Fitness this week', 'a club’s link opens its sheet, on its side of the switch', '');
    await page.keyboard.press('Escape');
    await page.goto(base + '/all-day/?demo=1#people/rc-red-rocks-trail-run-2026-10-10-1415');
    await page.waitForFunction(() => /That one has passed/.test(document.querySelector('#toast').textContent), null, { timeout: 6000 }).catch(() => {});
    check(/That one has passed/.test(await page.$eval('#toast', (t) => t.textContent)), 'a meet that has gone says so', '');
    await pageRules(page, 'people', 1280);
    await page.screenshot({ path: path.join(SHOTS, 'clubs-people-desktop-dark.png') });
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Run clubs, What Now: a meet in each window, Move with people, the mission (demo, 390, dark)', async () => {
    const { ctx, page, errors } = await newPage(browser, base, { clock: SAT_1PM, scheme: 'dark', motion: 'reduce', seed: 11 });
    await page.goto(base + '/all-day/?demo=1#whatnow');
    await page.waitForSelector(wnPanel + ' .spin .big:not([disabled])', { timeout: 15000 });
    await page.waitForSelector(wnPanel + ' [data-meets="now"] .lrow.meet');
    let rows = await clubRows(page, wnPanel + ' [data-meets="now"]');
    check(rows.map((r) => r.name).join('|') === 'Red Rocks Trail Run|Yoga on the Green', 'Now: the meets starting in the next three hours', JSON.stringify(rows.map((r) => r.name + ' ' + r.time)));
    check(rows.every((r) => r.at >= SAT_1PM && r.at < SAT_1PM + 3 * 3600000), 'all of them inside the window', JSON.stringify(rows.map((r) => r.at)));
    check(await page.$eval(wnPanel + ' [data-sec="meets"] h2', (h) => h.textContent) === 'Move with people', 'under a plain title', '');
    await page.$eval(wnPanel + ' [data-sec="meets"]', (s) => s.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SHOTS, 'clubs-whatnow-390.png') });
    await page.evaluate(() => document.querySelector('#panel-whatnow').scrollTo(0, 0));
    await page.waitForTimeout(250);
    await page.click(wnPanel + ' .toolrow .pills button:has-text("Tonight")');
    rows = await clubRows(page, wnPanel + ' [data-meets="tonight"]');
    check(rows.map((r) => r.name + ' ' + r.time).join('|') === 'Queen City Pickup 6 pm', 'Tonight: from 4 pm on', JSON.stringify(rows.map((r) => r.name + ' ' + r.time)));
    await page.click(wnPanel + ' .toolrow .pills button:has-text("Tomorrow")');
    rows = await clubRows(page, wnPanel + ' [data-meets="tomorrow"]');
    check(rows.map((r) => r.name).join('|') === 'Sunday Long Run|Lake Rowers' && rows.every((r) => /^Tomorrow · /.test(r.lines[0])), 'Tomorrow: Sunday’s, saying tomorrow', JSON.stringify(rows.map((r) => r.lines[0])));
    await page.click(wnPanel + ' .toolrow .pills button:has-text("Now")');

    /* Move with people */
    await page.click(wnPanel + ' .chip[data-chip="free"]');
    await page.click(wnPanel + ' .chip[data-chip="move"]');
    await page.waitForSelector(wnPanel + ' .result:not(.rolling) h3');
    const a1 = await page.$eval(wnPanel + ' .result', (r) => ({ h: r.querySelector('h3').textContent, eb: r.querySelector('.eyebrow').textContent, meta: r.querySelector('.meta').textContent, why: (r.querySelector('.because') || {}).textContent || '' }));
    check(['Red Rocks Trail Run', 'Yoga on the Green'].includes(a1.h), 'Move with people answers with a meet in the window', JSON.stringify(a1));
    check(/^Right now · /.test(a1.eb) && /starts (in \d+ min|at \d)/.test(a1.why), 'for right now, and says when it starts', JSON.stringify(a1));
    const on = await page.$$eval(wnPanel + ' .chips.paths .chip.on', (cs) => cs.map((c) => c.dataset.chip));
    check(on.join() === 'move', 'it takes the other chips off', on.join());
    check(/^2 meets right now$/.test(await page.$eval(wnPanel + ' .note.pad', (n) => n.textContent)), 'the pool line counts meets', await page.$eval(wnPanel + ' .note.pad', (n) => n.textContent));
    await page.click(wnPanel + ' .result .another');
    await page.waitForSelector(wnPanel + ' .result:not(.rolling) h3');
    const a2 = await page.$eval(wnPanel + ' .result h3', (h) => h.textContent);
    check(a2 !== a1.h && ['Red Rocks Trail Run', 'Yoga on the Green'].includes(a2), 'Another gives the other one', a1.h + ' → ' + a2);
    await page.click(wnPanel + ' .toolrow .pills button:has-text("Tomorrow")');
    await page.waitForSelector(wnPanel + ' .result:not(.rolling) h3');
    const a3 = await page.$eval(wnPanel + ' .result', (r) => ({ h: r.querySelector('h3').textContent, eb: r.querySelector('.eyebrow').textContent }));
    check(['Sunday Long Run', 'Lake Rowers'].includes(a3.h) && a3.eb === 'Tomorrow', 'on Tomorrow it answers with tomorrow’s', JSON.stringify(a3));
    await page.click(wnPanel + ' .result .doit');
    check(await page.$eval(wnPanel + ' .result h3', (h) => h.textContent) === 'Now put the phone down.', 'Do it ends the session as any answer does', '');
    await page.click(wnPanel + ' .chip[data-chip="move"]');
    await page.click(wnPanel + ' .toolrow .pills button:has-text("Now")');

    /* the mission */
    const first = await page.$eval(wnPanel + ' .missions > .lrow', (r) => ({ club: r.classList.contains('club'), t: r.querySelector('.t').textContent, s: r.querySelector('.s').textContent }));
    check(first.club && first.t === 'Run with a club' && /^Outdoors · \d+ runs this week$/.test(first.s), 'the missions lead with “Run with a club”', JSON.stringify(first));
    await page.click(wnPanel + ' .missions .lrow.club [data-clubs]');
    await page.waitForFunction(() => location.hash === '#people/clubs' && !document.querySelector('#panel-people').hidden, null, { timeout: 6000 });
    await page.waitForSelector(clubsSec + ' .lrow.meet');
    await page.waitForTimeout(700);
    const y = await page.$eval(clubsSec, (s) => Math.round(s.getBoundingClientRect().top));
    check(y < 260, 'and its action opens People’s club week (#people/clubs)', y);

    /* a row opens that meet in People */
    await page.click('#tab-whatnow');
    await page.waitForSelector(wnPanel + ' [data-meets="now"] .lrow.meet');
    await page.click(wnPanel + ' [data-meets="now"] .lrow.meet[data-club="red-rocks-trail-run"] .open');
    await page.waitForSelector('.sheet-body[data-club-sheet="red-rocks-trail-run"]', { timeout: 8000 });
    check(/^#people\/rc-red-rocks-trail-run-2026-10-17-1415$/.test(await page.evaluate(() => location.hash)), 'a row opens the meet on People, its sheet up', await page.evaluate(() => location.hash));
    await page.keyboard.press('Escape');
    await page.click('#tab-whatnow');
    await pageRules(page, 'whatnow', 390);
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });

  await group('Run clubs, What Now: nothing in the window says so and names the next (live, 1280)', async () => {
    const demo = JSON.parse(await readFile(path.join(APP, 'data/demo/run-clubs.json'), 'utf8'));
    demo.clubs = demo.clubs.filter((c) => !c.meets.some((m) => typeof m.in_hours === 'number'));
    const { ctx, page, errors } = await newPage(browser, base, { clock: SAT_1PM, viewport: { width: 1280, height: 800 }, routes: [[/\/data\/run-clubs\.json$/, demo]] });
    await page.goto(base + '/all-day/#whatnow');
    await page.waitForSelector(wnPanel + ' .spin .big:not([disabled])', { timeout: 15000 });
    check(!(await page.$(wnPanel + ' [data-meets="now"]')), 'no meet in the next three hours: no rows', '');
    await page.click(wnPanel + ' .chip[data-chip="move"]');
    await page.waitForSelector(wnPanel + ' .result[data-nomeet="now"]');
    const r = await page.$eval(wnPanel + ' .result', (x) => ({ h: x.querySelector('h3').textContent, meta: x.querySelector('.meta').textContent }));
    check(r.h === 'Nothing in the next few hours.', 'Move with people: “Nothing in the next few hours.”', JSON.stringify(r));
    check(r.meta === 'Next: Queen City Pickup · 6 pm · Miller Center gym', 'and the next one', r.meta);
    await page.click(wnPanel + ' .result [data-next]');
    await page.waitForSelector('.sheet-body[data-club-sheet="queen-city-pickup"]', { timeout: 8000 });
    check(await page.$eval(clubsSec + ' .sec h2', (h) => h.textContent) === 'Fitness this week', 'which opens on People, on Fitness, its sheet up', '');
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();
  });
}

/* New geography labels and the support link must stay usable on a narrow phone. */
async function lakePalette(browser, base) {
  for (const scheme of ['light', 'dark']) await group('Lake and Sunset content ' + scheme, async () => {
    const {ctx, page} = await newPage(browser, base, {scheme, viewport:{width:375,height:844}, motion:'reduce'});
    try {
      await page.goto(base + '/all-day/?demo=1#wire'); await settle(page);
      const local = await page.$$eval('#panel-wire .geo-tag', ns => ns.map(n => n.textContent));
      check(local.length > 0 && local.every(x => x === 'Local'), 'Local view labels its stories Local', local.join(','));
      await page.click('.mast .localsw-half:last-child'); await settle(page);
      const tags = await page.$$eval('#panel-wire .geo-tag', ns => ns.map(n => n.textContent));
      check(tags.includes('Local') && tags.includes('National'), 'Everything distinguishes local and national stories', tags.join(','));
      const audit = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#panel-wire .card.fi')];
        const lum = rgb => rgb.map(n => { n/=255; return n<=.04045 ? n/12.92 : ((n+.055)/1.055)**2.4; }).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
        const ratio = (a,b) => { const x=lum(a), y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
        const rgb = s => (s.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
        const badges = [...document.querySelectorAll('#panel-wire .geo-tag')];
        return { missing: rows.filter(r => !r.querySelector('.geo-tag')).map(r=>r.dataset.k),
          overflow: rows.filter(r => r.scrollWidth > r.clientWidth+1).map(r=>r.dataset.k),
          contrast: badges.map(n => { const s=getComputedStyle(n); return ratio(rgb(s.color),rgb(s.backgroundColor)); }),
          transition: getComputedStyle(document.querySelector('#tabbar button')).transitionDuration };
      });
      check(!audit.missing.length, 'every Wire story carries a geography label', audit.missing.join(','));
      check(!audit.overflow.length, 'geography labels fit the existing metadata area at 375px', audit.overflow.join(','));
      check(audit.contrast.every(n=>n>=4.5), 'Local and National labels meet 4.5:1 contrast', JSON.stringify(audit.contrast));
      check(audit.transition === '0s', 'reduced motion disables new tab feedback', audit.transition);
      await page.click('#settings-btn');
      const tip = await page.$eval('[data-tip]', a=>({href:a.href,text:a.innerText,rel:a.rel}));
      check(tip.href==='https://ko-fi.com/btownbrief' && /Tip jar/.test(tip.text) && /noopener/.test(tip.rel), 'Settings restores the existing Btown Brief tip jar', JSON.stringify(tip));
    } finally { await ctx.close(); }
  });
}

/* A floating bar must never cover the last row, even with an iPhone safe area. */
async function lakeSunset(browser, base) {
  for (const scheme of ['light', 'dark']) for (const width of [375, 390, 430]) await group('floating bar ' + width + ' ' + scheme, async () => {
    const { ctx, page } = await newPage(browser, base, {scheme, viewport:{width,height:844}, motion:'reduce'});
    try {
      await page.goto(base + '/all-day/?demo=1'); await settle(page);
      await page.evaluate(() => document.documentElement.style.setProperty('--safe-b', '34px'));
      for (const tab of TABS) {
        await goTab(page, tab);
        await page.evaluate(() => { const p=document.querySelector('.panel:not([hidden])'); p.scrollTop=p.scrollHeight; });
        const size=await page.evaluate(() => {
          const bar=document.querySelector('#tabbar'),r=bar.getBoundingClientRect();
          const body=document.querySelector('.panel:not([hidden]) .panel-body');
          const cells=[...bar.querySelectorAll('button')];
          return {left:r.left,right:innerWidth-r.right,bottom:innerHeight-r.bottom,
            clearance:r.top-body.getBoundingClientRect().bottom,
            labels:cells.every(b=>b.scrollWidth<=b.clientWidth+1), hits:cells.every(b=>b.clientHeight>=44)};
        });
        check(size.left>=5 && size.right>=5 && size.bottom>=42, tab + ': pill floats above safe area', JSON.stringify(size));
        check(size.labels && size.hits, tab + ': all nine labels fit, targets at least 44px tall', JSON.stringify(size));
        check(size.clearance>=12, tab + ': last content clears the bar', JSON.stringify(size));
      }
    } finally { await ctx.close(); }
  });
}

/* ------------------------------------------------------------- the weather */
/* Stephen, 2026-10-17: "radar that shows the showers actively moving", and
   weather.html's sun recreated on What Now's card, changing with the weather.
   weather.html is the guide's page, not a tab: its radar is tested here with
   a stand-in Leaflet and a capabilities file in NOAA's shape, its live feeds
   answered locally. */
async function theWeather(browser, base) {
  const MIN = 60000;
  /* NOAA's GetCapabilities in its real shape: a scan every two minutes for
     the last two hours and a bit, the newest four minutes old */
  const capsFor = (now) => {
    const times = [];
    for (let t = now - 130 * MIN; t <= now - 4 * MIN; t += 2 * MIN) times.push(new Date(t).toISOString().replace(/\.\d+Z$/, '.000Z'));
    return '<?xml version="1.0" encoding="UTF-8"?><WMS_Capabilities version="1.3.0"><Capability><Layer><Layer queryable="1"><Name>conus_bref_qcd</Name>' +
      '<Dimension name="time" default="' + times[times.length - 1] + '" units="ISO8601" nearestValue="1">' + times.join(',') + '</Dimension></Layer></Layer></Capability></WMS_Capabilities>';
  };
  const FAKE_RADAR_L = `window.L = (() => {
    const maps = [];
    /* a frame answers load (or error, for a URL window.__frameFail matches) a moment after it is added */
    const layer = (kind, at, o) => ({ kind, at, o, op: o && o.opacity, h: {}, on(ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); return this; },
      addTo(m) { m.layers.push(this); if (kind === 'frame') setTimeout(() => (this.h[window.__frameFail && window.__frameFail.test(at) ? 'error' : 'load'] || []).forEach((f) => f()), 15); return this; },
      setOpacity(v) { this.op = v; return this; } });
    const ll = (lat, lng) => ({ lat, lng });
    return { maps, Browser: { mobile: false },
      CRS: { EPSG3857: { project: (p) => ({ x: p.lng * 111319.49, y: p.lat * 111319.49 }) } },
      map(el, opts) { const m = { el, opts, layers: [], handlers: {}, shift: 0,
        on(ev, fn) { this.handlers[ev] = fn; return this; },
        getBounds() { const s = this.shift; return { getSouthWest: () => ll(43 + s, -75), getNorthEast: () => ll(46 + s, -71) }; },
        getSize() { return { x: 358, y: 340 }; },
        removeLayer(l) { l.gone = true; this.layers = this.layers.filter((x) => x !== l); return this; } };
        maps.push(m); return m; },
      tileLayer(u, o) { return layer('tiles', u, o); }, circleMarker(c, o) { return layer('pin', c, o); },
      imageOverlay(u, b, o) { return layer('frame', u, o); } };
  })();`;
  const sriSpy = `window.__sri = [];
    Object.defineProperty(HTMLScriptElement.prototype, 'integrity', { configurable: true, set(v) { window.__sri.push(v); }, get() { return ''; } });
    Object.defineProperty(HTMLLinkElement.prototype, 'integrity', { configurable: true, set(v) { window.__sri.push(v); }, get() { return ''; } });`;
  /* weather.html with its outside world answered here: Leaflet, NOAA, the
     live NWS reads the page makes on top of latest.json, the fleet nav */
  const weatherPage = async (opts, caps) => {
    const w = await newPage(browser, base, opts);
    w.asked = [];
    await w.page.addInitScript(sriSpy);
    await w.page.route(/play\.btownbrief\.com\/nav\.js/, (r) => r.fulfill({ status: 200, body: '', contentType: 'text/javascript' }));
    await w.page.route(/api\.weather\.gov/, (r) => r.fulfill({ status: 200, body: '{}', contentType: 'application/geo+json' }));
    await w.page.route(/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.(js|css)$/, (r) => { w.asked.push(r.request().url());
      return /\.js$/.test(r.request().url()) ? r.fulfill({ status: 200, body: FAKE_RADAR_L, contentType: 'text/javascript' }) : r.fulfill({ status: 200, body: '', contentType: 'text/css' }); });
    await w.page.route(/opengeo\.ncep\.noaa\.gov\/.*GetCapabilities/i, (r) => { w.asked.push(r.request().url());
      const body = typeof caps === 'function' ? caps() : caps;
      return body === null ? r.fulfill({ status: 503, body: '' }) : r.fulfill({ status: 200, body, contentType: 'text/xml' }); });
    return w;
  };
  const radarState = (page) => page.evaluate(() => {
    const m = window.L && window.L.maps && window.L.maps[0];
    /* in frame order (the newest is added to the map first) */
    const when = (l) => decodeURIComponent((l.at.match(/TIME=([^&]+)/) || [])[1] || '');
    const fr = m ? m.layers.filter((l) => l.kind === 'frame').sort((a, b) => (when(a) < when(b) ? -1 : 1)) : [];
    return { frames: window.btownRadar ? window.btownRadar.frames() : null, idx: window.btownRadar ? window.btownRadar.index() : null,
      playing: window.btownRadar ? window.btownRadar.playing() : null,
      center: m && m.opts.center, zoom: m && m.opts.zoom, wheel: m && m.opts.scrollWheelZoom,
      tiles: m ? m.layers.filter((l) => l.kind === 'tiles').map((l) => l.at + ' ' + l.o.attribution) : [],
      overlays: fr.map((l) => ({ u: l.at, op: l.op, attr: l.o.attribution || '' })),
      time: document.getElementById('radar-time').textContent, stamp: document.getElementById('radar-stamp').textContent,
      scrub: document.getElementById('radar-scrub').value, max: document.getElementById('radar-scrub').max,
      pressed: document.getElementById('radar-play').getAttribute('aria-pressed'), label: document.getElementById('radar-play').getAttribute('aria-label'),
      controls: !document.getElementById('radar-controls').hidden, fail: !document.getElementById('radar-fail').hidden,
      links: [...document.querySelectorAll('#radar .radar-links a')].map((a) => a.textContent + ' ' + a.href + ' ' + a.target) };
  });
  const clockET = (ms) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(ms)).replace(' AM', ' am').replace(' PM', ' pm');

  await group('Weather page: the radar mounts lazily and moves (390, a stand-in Leaflet)', async () => {
    const NOW = Math.floor(Date.now() / MIN) * MIN;
    const w = await weatherPage({ clock: NOW, viewport: { width: 390, height: 480 }, dpr: 2 }, capsFor(NOW));
    const { page, errors } = w;
    await page.goto(base + '/weather.html');
    await page.waitForSelector('#radar', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(400);
    const top = await page.$eval('#radar', (s) => s.getBoundingClientRect().top - innerHeight);
    check(top > 300 && !w.asked.length && await page.evaluate(() => !window.L && !window.btownRadar),
      'far below the fold: no Leaflet, no NOAA, nothing fetched', top + ' / ' + w.asked.join(', '));

    await page.$eval('#radar', (s) => s.scrollIntoView());
    await page.waitForFunction(() => window.btownRadar, null, { timeout: 8000 }).catch(() => {});
    const order = await page.evaluate(() => window.L.maps[0].layers.filter((l) => l.kind === 'frame').map((l) => l.at.match(/TIME=([^&]+)/)[1]));
    await page.waitForFunction(() => window.btownRadar.ready(), null, { timeout: 8000 }).catch(() => {});
    const s = await radarState(page);
    check(w.asked.some((u) => /leaflet\.js$/.test(u)) && w.asked.some((u) => /leaflet\.css$/.test(u)) && w.asked.some((u) => /GetCapabilities/.test(u)),
      'in view, it loads Leaflet 1.9.4 and NOAA’s frame list', w.asked.join(', '));
    check(await page.evaluate(() => window.__sri.join(' ')) === 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY= sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
      'with the integrity hashes events.html and Food pin', await page.evaluate(() => window.__sri.join(' ')));
    const want = Array.from({ length: 13 }, (_, i) => new Date(NOW - 4 * MIN - (12 - i) * 10 * MIN).toISOString().replace(/\.\d+Z$/, '.000Z'));
    check(s.frames && s.frames.join(',') === want.join(','), 'thirteen frames, ten minutes apart, the newest last', JSON.stringify(s.frames));
    check(String(s.center) === '44.4759,-73.2121' && s.zoom === 7 && s.wheel === false, 'centred on Burlington at zoom 7; the wheel scrolls the page', JSON.stringify([s.center, s.zoom, s.wheel]));
    check(s.tiles.length === 1 && /tile\.openstreetmap\.org/.test(s.tiles[0]) && /OpenStreetMap/.test(s.tiles[0]), 'OpenStreetMap under it, credited', s.tiles.join(' | '));
    check(s.overlays.length === 13 && s.overlays.every((o, i) => o.u.includes('LAYERS=conus_bref_qcd') && o.u.includes('TIME=' + encodeURIComponent(want[i])) &&
      /BBOX=-8348[0-9]{3},4786[0-9]{3},-7903[0-9]{3},5120[0-9]{3}/.test(o.u) && /WIDTH=\d+&HEIGHT=\d+/.test(o.u)),
      'one image per frame for the whole view, at its time', s.overlays.slice(0, 2).map((o) => o.u).join(' | '));
    check(/NOAA MRMS/.test(s.overlays.map((o) => o.attr).join(' ')), 'the radar credited to NOAA MRMS on the map', s.overlays.map((o) => o.attr).join('|'));
    check(s.overlays.filter((o) => o.op > 0).length === 1 && s.overlays[12].op > 0 && s.idx === 12, 'it opens on the newest frame, the only one showing', JSON.stringify(s.overlays.map((o) => o.op)));
    check(decodeURIComponent(order[0]) === want[12], 'the newest frame is asked for first, the other twelve after it', order.join(', '));
    check(s.overlays.every((o) => /WIDTH=358&HEIGHT=340/.test(o.u)), 'one image pixel per screen pixel (MRMS is a 1 km grid), even on a 2x screen', (s.overlays[0] || {}).u);
    check(s.time === clockET(NOW - 4 * MIN) && s.stamp === 'Latest, 4 min ago', 'the frame’s time in Burlington’s clock, and how old it is', s.time + ' / ' + s.stamp);
    check(s.controls && s.playing === true && s.pressed === 'true' && s.label === 'Pause' && s.max === '12', 'it loops by default: Pause showing, the scrubber spans the frames', JSON.stringify(s));
    check(s.links.length === 2 && /NWS Burlington radar https:\/\/radar\.weather\.gov\/station\/kcxx\/standard _blank/.test(s.links[0]) && /Windy radar https:\/\/www\.windy\.com\/.*radar.*_blank/.test(s.links[1]),
      'and the two radars worth opening under the map', s.links.join(' | '));

    /* the loop: it holds the newest frame, then starts over */
    await page.waitForFunction(() => window.btownRadar.index() >= 1 && window.btownRadar.index() < 12, null, { timeout: 6000 }).catch(() => {});
    const moved = await radarState(page);
    check(moved.idx >= 1 && moved.idx < 12 && moved.overlays.filter((o) => o.op > 0).length === 1 && moved.overlays[moved.idx].op > 0 && moved.time === clockET(Date.parse(moved.frames[moved.idx])),
      'the frames move: one showing at a time, its time under the map', JSON.stringify({ idx: moved.idx, time: moved.time }));
    await page.screenshot({ path: path.join(SHOTS, 'weather-radar-390.png') });

    /* pause holds the frame */
    await page.click('#radar-play');
    const p1 = await radarState(page);
    await page.waitForTimeout(1300);
    const p2 = await radarState(page);
    check(p1.playing === false && p1.pressed === 'false' && p1.label === 'Play' && p2.idx === p1.idx, 'Pause stops it on the frame it was on', JSON.stringify([p1.idx, p2.idx, p1.label]));

    /* the scrubber picks a frame, and stays paused */
    await page.click('#radar-play');
    await page.$eval('#radar-scrub', (r) => { r.value = '3'; r.dispatchEvent(new Event('input', { bubbles: true })); });
    const sc = await radarState(page);
    check(sc.idx === 3 && sc.playing === false && sc.overlays[3].op > 0 && sc.overlays.filter((o) => o.op > 0).length === 1 &&
      sc.time === clockET(Date.parse(want[3])) && sc.stamp === (94) + ' min ago', 'scrubbing pauses and shows that frame, its time and age', JSON.stringify({ idx: sc.idx, time: sc.time, stamp: sc.stamp }));
    await page.focus('#radar-scrub');
    await page.keyboard.press('ArrowRight');
    check((await radarState(page)).idx === 4, 'the arrow keys step it', '');

    /* a pan asks for the frames again at the new view, once, and drops the old */
    await page.evaluate(() => { const m = window.L.maps[0]; m.shift = 1; m.handlers.moveend(); m.handlers.moveend(); });
    await page.waitForTimeout(450);
    const pan = await radarState(page);
    check(pan.overlays.length === 13 && pan.overlays.every((o) => /BBOX=-8348[0-9]{3},4898[0-9]{3}/.test(o.u)) && pan.overlays[4].op > 0,
      'a pan redraws the thirteen at the new view, on the same frame', pan.overlays.length + ' ' + (pan.overlays[0] || {}).u);

    /* the page's own picture of the radar, in dark */
    check(!errors.length, 'no console errors', errors.join(' | '));
    await w.ctx.close();
  });

  await group('Weather page: the radar for reduced motion, a fresh list, and when NOAA is down', async () => {
    const NOW = Math.floor(Date.now() / MIN) * MIN;
    /* the second read of the frame list, ten minutes on, has newer scans */
    let reads = 0;
    const r = await weatherPage({ motion: 'reduce', scheme: 'dark' }, () => capsFor(NOW + (reads++ ? 12 * MIN : 0)));
    await r.page.clock.install({ time: NOW });
    await r.page.goto(base + '/weather.html');
    await r.page.waitForSelector('#radar', { state: 'visible', timeout: 15000 });
    await r.page.$eval('#radar', (s) => s.scrollIntoView());
    await r.page.waitForFunction(() => window.btownRadar && window.btownRadar.ready(), null, { timeout: 8000 }).catch(() => {});
    await r.page.waitForTimeout(1500);
    const s = await radarState(r.page);
    check(s.playing === false && s.idx === 12 && s.label === 'Play', 'reduced motion: it waits on the newest frame for a tap', JSON.stringify({ playing: s.playing, idx: s.idx }));
    await r.page.clock.fastForward('11:00');
    await r.page.waitForFunction((t) => window.btownRadar.frames()[12] === t, new Date(NOW + 8 * MIN).toISOString().replace(/\.\d+Z$/, '.000Z'), { timeout: 5000 }).catch(() => {});
    await r.page.waitForTimeout(400);
    const f2 = await radarState(r.page);
    check(reads === 2 && f2.frames[12] === new Date(NOW + 8 * MIN).toISOString().replace(/\.\d+Z$/, '.000Z') && f2.idx === 12 && f2.overlays.length === 13 && /^Latest/.test(f2.stamp),
      'ten minutes on screen: it reads the list again and moves to the new newest frame', JSON.stringify({ reads, last: f2.frames && f2.frames[12], idx: f2.idx, stamp: f2.stamp }));
    await r.page.click('#radar-play');
    const s2 = await radarState(r.page);
    check(s2.playing === true && s2.idx === 0, 'and Play from the newest starts at the oldest', JSON.stringify({ playing: s2.playing, idx: s2.idx }));
    check(!r.errors.length, 'no console errors', r.errors.join(' | '));
    await r.ctx.close();

    const f = await weatherPage({}, null);
    await f.page.goto(base + '/weather.html');
    await f.page.waitForSelector('#radar', { state: 'visible', timeout: 15000 });
    await f.page.$eval('#radar', (s) => s.scrollIntoView());
    await f.page.waitForSelector('#radar.is-failed', { timeout: 8000 }).catch(() => {});
    const fs = await radarState(f.page);
    check(fs.fail && !fs.controls && fs.links.length === 2 && await f.page.$eval('#radar-map', (m) => m.hidden), 'NOAA down: the map steps aside, a line says so, the two radars stay', JSON.stringify(fs));
    check(!f.errors.filter((e) => !/503/.test(e)).length, 'no console errors beyond the 503 itself', f.errors.join(' | '));
    await f.ctx.close();

    /* the list loads but NOAA's images do not: the same, not an empty map that seems to play */
    const NOW2 = Math.floor(Date.now() / MIN) * MIN;
    const g = await weatherPage({ clock: NOW2 }, capsFor(NOW2));
    await g.page.addInitScript(() => { window.__frameFail = /GetMap/; });
    await g.page.goto(base + '/weather.html');
    await g.page.waitForSelector('#radar', { state: 'visible', timeout: 15000 });
    await g.page.$eval('#radar', (s) => s.scrollIntoView());
    await g.page.waitForSelector('#radar.is-failed', { timeout: 8000 }).catch(() => {});
    const gs = await radarState(g.page);
    check(gs.fail && !gs.controls && gs.playing === false && await g.page.$eval('#radar-map', (m) => m.hidden), 'images failing: the map steps aside and nothing pretends to play', JSON.stringify({ fail: gs.fail, controls: gs.controls, playing: gs.playing }));
    check(!g.errors.length, 'no console errors', g.errors.join(' | '));
    await g.ctx.close();
  });

  /* ---- What Now's card: weather.html's sun arc in miniature ---- */
  const SKY = { left: 12, right: 148, base: 25, top: 6 };
  const arcAt = (p, lift) => ({ x: SKY.left + (SKY.right - SKY.left) * p, y: SKY.base - (SKY.base - SKY.top) * Math.sin(Math.PI * p) * lift });
  const skyOf = (page) => page.$eval(wnPanel + ' .wxcard', (a) => {
    const s = a.querySelector('.wxsky'), b = s && s.querySelector('.body');
    const vis = (sel) => { const n = s.querySelector(sel); return n ? Number(getComputedStyle(n).opacity) > 0 : false; };
    return s && { sky: s.dataset.sky, cls: s.className.replace('wxsky ', ''), body: b.dataset.body, low: b.classList.contains('low'), x: Number(b.getAttribute('cx')), y: Number(b.getAttribute('cy')),
      clouds: vis('.cl'), rain: vis('.rn'), snow: vis('.sn'), fog: vis('.fg'), icon: a.dataset.wxicon,
      rainAnim: getComputedStyle(s.querySelector('.rn')).animationName, h: a.getBoundingClientRect().height, sh: s.getBoundingClientRect().height,
      bg: getComputedStyle(s).backgroundImage };
  });
  const near = (a, b) => Math.abs(a - b) < 0.11;
  const close = (a, b) => Math.abs(a - b) < 0.35;   // the page's clock runs on while the test reads it

  await group('What Now, the sky on the weather card: the sun where it really is (demo, 2 pm)', async () => {
    /* an installed clock, so the minute timer can be run forward */
    const { ctx, page, errors } = await newPage(browser, base);
    await page.clock.install({ time: etAt(14) });
    await page.goto(base + '/all-day/?demo=1#whatnow');
    await page.waitForSelector(wnPanel + ' .wxcard .wxsky', { timeout: 15000 });
    const t0 = await page.evaluate(() => Date.now());
    const s = await skyOf(page);
    /* the demo's day, moved to today: sunrise 7:09, sunset 6:06 */
    const day = etKey(Date.now()), off = etOffset(etAt(12));
    const rise = Date.parse(day + 'T07:09:00' + off), set = Date.parse(day + 'T18:06:00' + off);
    const want = arcAt((t0 - rise) / (set - rise), 1);
    check(s.body === 'sun' && close(s.x, want.x) && close(s.y, want.y), 'at 2 pm the sun is on its arc, 63% of the way from sunrise to sunset', JSON.stringify({ got: [s.x, s.y], want: [want.x.toFixed(1), want.y.toFixed(1)] }));
    check(s.sky === 'day' && s.cls === 'is-clear' && !s.clouds && !s.rain && !s.snow && !s.fog && /gradient/.test(s.bg), 'a clear day sky: no clouds, nothing falling', JSON.stringify(s));
    check(s.sh <= 30 && s.h < 140, 'the strip is 30px; the card stays compact', s.sh + ' / ' + s.h);
    const box = await page.evaluate(() => { const p = document.querySelector('#panel-whatnow'); const c = p.querySelector('.wxcard').getBoundingClientRect(), big = p.querySelector('.spin .big').getBoundingClientRect();
      return { right: c.right, bottom: c.bottom, bigTop: big.top, vw: innerWidth, scroll: document.documentElement.scrollWidth }; });
    check(box.right <= box.vw - 15 && box.bottom <= box.bigTop && box.scroll <= box.vw, 'at 390 it still sits above Spin with nothing sideways', JSON.stringify(box));
    await (await page.$(wnPanel + ' .wxtop')).screenshot({ path: path.join(SHOTS, 'demo-whatnow-sky-390.png') });

    /* the minute hand: the tab moves the sun while it is up */
    await page.clock.fastForward('02:00:00');
    const t1 = await page.evaluate(() => Date.now());
    const later = await skyOf(page);
    const want4 = arcAt((t1 - rise) / (set - rise), 1);
    check(close(later.x, want4.x) && close(later.y, want4.y) && later.x > s.x + 20, 'two hours on, the sun has moved down the arc without a redraw', JSON.stringify({ got: [later.x, later.y], want: [want4.x.toFixed(1), want4.y.toFixed(1)] }));
    check(!errors.length, 'no console errors', errors.join(' | '));
    await ctx.close();

    /* reduced motion: drawn where it is, and nothing falls */
    const r = await newPage(browser, base, { motion: 'reduce' });
    await r.page.clock.install({ time: etAt(14) });
    await r.page.goto(base + '/all-day/?demo=1#whatnow');
    await r.page.waitForSelector(wnPanel + ' .wxcard .wxsky', { timeout: 15000 });
    const r1 = await skyOf(r.page);
    await r.page.clock.fastForward('02:00:00');
    const r2 = await skyOf(r.page);
    check(close(r1.x, want.x) && r2.x === r1.x && r2.y === r1.y, 'reduced motion: the sun at its real place, held there', JSON.stringify([r1.x, r2.x]));
    check(!r.errors.length, 'no console errors', r.errors.join(' | '));
    await r.ctx.close();
  });

  await group('What Now, the sky on the weather card: the hour’s colour and the weather’s overlay (live, a reader in Los Angeles)', async () => {
    const day = etKey(Date.now());
    const off = etOffset(Date.parse(day + 'T12:00:00Z'));
    const at = (d, hm) => d + 'T' + hm + ':00' + off;
    const tomorrow = dayMinus(day, -1);
    const sun = { sunrise: at(day, '07:10'), sunset: at(day, '18:05'), sunrise_tomorrow: at(tomorrow, '07:11'), sunset_tomorrow: at(tomorrow, '18:03') };
    const payload = (frozen, said, sunBlock) => ({
      updated: new Date(frozen).toISOString(),
      now: { observed_at: new Date(frozen - 20 * MIN).toISOString(), description: said, temp_f: 41, feels_like_f: 35 },
      forecast: { periods: [] },
      hourly: { hours: Array.from({ length: 8 }, (_, i) => ({ t: new Date(frozen + (i + 1) * 3600000).toISOString(), temp_f: 40, feels_f: 35, pop: 10, short: said })) },
      sun: sunBlock || sun,
    });
    const rise = Date.parse(sun.sunrise), set = Date.parse(sun.sunset), next = Date.parse(sun.sunrise_tomorrow);
    const cases = [
      ['06:45', 'Light Rain', 'dawn', 'is-rain', 'moon', { rain: true, clouds: true }],
      ['07:30', 'Thunderstorm', 'sunrise', 'is-storm', 'sun', { rain: true, clouds: true }],
      ['12:00', 'Partly Cloudy', 'day', 'is-partly', 'sun', { clouds: true }],
      ['16:45', 'Snow', 'golden', 'is-snow', 'sun', { snow: true, clouds: true }],
      ['17:50', 'Fog/Mist', 'sunset', 'is-fog', 'sun', { fog: true }],
      ['18:30', 'Mostly Cloudy', 'dusk', 'is-cloud', 'moon', { clouds: true }],
      ['22:00', 'Clear', 'night', 'is-clear', 'moon', {}],
      ['02:00', 'Partly Cloudy', 'night', 'is-partly', 'moon', { clouds: true }],
    ];
    for (const [hm, said, sky, cls, body, ov] of cases) {
      const frozen = Date.parse(at(day, hm));
      const routes = [[/\/all-day\/data\/whatnow\.json/, { generated: new Date(frozen).toISOString(), days: 10, counts: {}, events: [] }], [/\/data\/weather\/latest\.json/, payload(frozen, said)]];
      const { ctx, page, errors } = await newPage(browser, base, { timezoneId: 'America/Los_Angeles', routes });
      await page.clock.setFixedTime(frozen);
      await page.goto(base + '/all-day/#whatnow');
      await page.waitForSelector(wnPanel + ' .wxcard .wxsky', { timeout: 15000 });
      const s = await skyOf(page);
      let want;
      if (body === 'sun') want = arcAt((frozen - rise) / (set - rise), 1);
      else want = frozen < rise ? arcAt((frozen - (set - 86400000)) / (rise - (set - 86400000)), 0.82) : arcAt((frozen - set) / (next - set), 0.82);
      const ovOk = ['clouds', 'rain', 'snow', 'fog'].every((k) => !!ov[k] === s[k]);
      check(s.sky === sky && s.cls === cls && s.body === body && near(s.x, want.x) && near(s.y, want.y) && ovOk,
        hm + ' Burlington, “' + said + '”: a ' + sky + ' sky, ' + cls + ', the ' + body + ' on its arc', JSON.stringify({ s, want }));
      if (hm === '07:30' || hm === '17:50') check(s.low, hm + ': the sun low and orange near the horizon', '');
      if (hm === '12:00') check(!s.low && s.rainAnim === 'none', 'noon: the sun high, nothing falling', '');
      if (hm === '06:45') check(s.rainAnim !== 'none', 'rain falls (when motion is allowed)', s.rainAnim);
      if (hm === '22:00' || hm === '07:30') await (await page.$(wnPanel + ' .wxtop')).screenshot({ path: path.join(SHOTS, 'live-whatnow-sky-' + hm.replace(':', '') + '.png') });
      check(!errors.length, 'no console errors', errors.join(' | '));
      await ctx.close();
    }

    /* a payload a day old (the hourly refresh missed the night): its sun
       times carry forward a day rather than calling 2 pm night */
    const frozen = Date.parse(at(day, '14:00'));
    const y = dayMinus(day, 1);
    const old = { sunrise: at(y, '07:10'), sunset: at(y, '18:05'), sunrise_tomorrow: at(day, '07:10') };
    const routes = [[/\/all-day\/data\/whatnow\.json/, { generated: new Date(frozen).toISOString(), days: 10, counts: {}, events: [] }], [/\/data\/weather\/latest\.json/, payload(frozen, 'Sunny', old)]];
    const { ctx, page, errors } = await newPage(browser, base, { timezoneId: 'America/Los_Angeles', routes });
    await page.clock.setFixedTime(frozen);
    await page.goto(base + '/all-day/#whatnow');
    await page.waitForSelector(wnPanel + ' .wxcard .wxsky', { timeout: 15000 });
    const s = await skyOf(page);
    const want = arcAt((frozen - rise) / (set - rise), 1);
    check(s.body === 'sun' && s.sky === 'day' && near(s.x, want.x) && near(s.y, want.y), 'yesterday’s sun times still put today’s 2 pm sun in the right place', JSON.stringify({ s, want }));
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
  await run(lakeSunset);
  await run(lakePalette);
  await run(deepLinks);
  await run(theWire);
  await run(thePhotos);
  await run(theWhatNow);
  await run(theFood);
  await run(thePeople);
  await run(theClubs);
  await run(onAir);
  await run(theGames);
  await run(theWatch);
  await run(interactions);
  await run(shellFixes);
  await run(accounts);
  await run(boards);
  await run(boardPhotos);
  await run(theHabits);
  await run(sunsetLine);
  await run(theVintage);
  await run(theWeather);
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
