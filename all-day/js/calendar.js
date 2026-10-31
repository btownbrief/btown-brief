/* calendar.js — The Calendar: the block that puts the full events calendar
   (events.html) at the top of What Now and in People's This week.

   A headline tile on the mast's navy: how many events are on in the next 14
   days, set big; seven days with their counts; the best of tonight and
   tomorrow as a feed, folded to two rows, each with its star and share; one
   big button; and See more beside it, for the rest of the feed and the
   categories with their counts. A day opens the calendar on that day (?date=), a chip on
   that filter (?cat=), a row or a shared link on that event (?e=).

   All of it comes from data/calendar.json (scripts/build_whatnow.py, every
   morning). It counts what events.html lists, so a number here is the number
   the calendar opens on. Everything is worked out against the clock as it
   paints, in Burlington's time: a day that has gone drops out, today loses
   what has finished, and a past event never shows, however old the file is.
   It paints again when the phone comes back to an open app, and the file is
   fetched again once it is a few hours old or if it failed. With no file, or
   nothing left in it, the block is simply not there.

     load()           the payload or null; refetched as above, never rejects
     mount(slot, o)   paints the block into slot, now or when the file lands
                      o.name  'whatnow' | 'people', its own folded state
                      o.strip false leaves out the seven days, where the tab
                              has its own strip right under the block
     repaint()        again, against the clock: a tab calls it on the way back

   ?demo=1 reads data/demo/calendar.json, its dates moved to today. */

import * as app from './app.js';
import * as data from './wire.js';
import * as store from './store.js';
import { el, esc, safeHref, ICON } from './ui.js';

const FILE = 'data/calendar.json';
const PAGE = '../events.html';
const TZ = 'America/New_York';
const SPAN = 14;
const STRIP = 7;
const FOLDED = 2;
const PER_DAY = 4;          // best of tonight, best of tomorrow, opened
const CHIPS = 8;
const KEEP = 3 * 3600000;   // how long a file stands before a tab asks again
const EVENING = 16;         // the calendar's own line for tonight

const WORDS = {
  title: 'The Calendar',
  count: 'events in the next 14 days',
  full: 'Full calendar',
  more: 'See more',
  less: 'See less',
  today: 'Today',
  tonight: 'Tonight',
  tomorrow: 'Tomorrow',
  free: 'Free',
  dows: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};
/* the first five always, while they have anything on, then the biggest of the rest */
const CATS = { music: 'Music', 'food-drink': 'Food', art: 'Art', family: 'Family', sports: 'Sports', comedy: 'Comedy', theater: 'Theater', film: 'Film',
  outdoors: 'Outdoors', market: 'Markets', games: 'Games', learning: 'Classes', wellness: 'Wellness', words: 'Books', community: 'Community' };
const LEAD = ['music', 'food-drink', 'art', 'family', 'sports'];

/* ------------------------------------------------------------------ clock */
const partsFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function et(ms) {
  const o = {};
  partsFmt.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
  return { date: o.year + '-' + o.month + '-' + o.day, hour: Number(o.hour), minute: Number(o.minute) };
}
const noon = (d) => { const [y, m, n] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, n, 12)); };
const addDays = (d, n) => { const t = noon(d); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const fmtTime = (t) => { const h = t.hour % 12 || 12; return h + (t.minute ? ':' + String(t.minute).padStart(2, '0') : '') + (t.hour < 12 ? ' am' : ' pm'); };

/* ------------------------------------------------------------------ load */
let file = null;
let fetched = 0;
let loading = null;
const slots = new Set();

/* the demo file is dated by its anchor; its dates and times move to today */
function redate(d) {
  const shift = Math.round((noon(et(Date.now()).date) - noon(d.anchor)) / 86400000);
  const ms = shift * 86400000;
  return {
    days: d.days.map((x) => ({ ...x, date: addDays(x.date, shift),
      ends: x.ends && Object.fromEntries(Object.entries(x.ends).map(([k, v]) => [k, v.map((t) => t + ms / 1000)])) })),
    picks: d.picks.map((p) => ({ ...p, date: addDays(p.date, shift), start: new Date(Date.parse(p.start) + ms).toISOString(), end: p.end + ms / 1000 })),
  };
}
const usable = (j) => (j && Array.isArray(j.days) && Array.isArray(j.picks) ? j : null);

const fresh = () => !!file && Date.now() - fetched < KEEP;

/* a failed fetch keeps what it had, and the next one tries again */
export function load() {
  if (loading) return loading;
  if (fresh()) return Promise.resolve(file);
  const got = app.demo ? app.demoData('calendar').then(redate) : data.fetchJSON(FILE, 8000);
  loading = got.then((j) => {
    const u = usable(j);
    if (u) { file = u; fetched = Date.now(); }
    return file;
  }).catch(() => file).finally(() => { loading = null; });
  return loading;
}

/* ---------------------------------------------------------------- numbers */
/* a day's categories as they stand: today less what has finished */
function dayCats(d, now) {
  const left = {};
  Object.keys(d.cats || {}).forEach((c) => {
    const gone = d.ends && Array.isArray(d.ends[c]) ? d.ends[c].filter((t) => t * 1000 <= now).length : 0;
    left[c] = Math.max(0, (Number(d.cats[c]) || 0) - gone);
  });
  return left;
}
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

function shape(j, now) {
  const today = et(now).date;
  const last = addDays(today, SPAN - 1);
  const byDay = Object.create(null);
  j.days.forEach((d) => { if (d && d.date >= today && d.date <= last) byDay[d.date] = dayCats(d, now); });
  const strip = [];
  for (let i = 0; i < STRIP; i++) {
    const date = addDays(today, i);
    strip.push({ date, n: byDay[date] ? sum(byDay[date]) : 0 });
  }
  const cats = {};
  Object.values(byDay).forEach((c) => Object.keys(c).forEach((k) => { cats[k] = (cats[k] || 0) + c[k]; }));
  return { today, strip, total: sum(cats), cats: chipsOf(cats), feed: feedOf(j.picks, now, today) };
}

function chipsOf(cats) {
  const known = (k) => CATS[k] && cats[k] > 0;
  const rest = Object.keys(cats).filter((k) => known(k) && !LEAD.includes(k)).sort((a, b) => cats[b] - cats[a]);
  return LEAD.filter(known).concat(rest).slice(0, CHIPS).map((key) => ({ key, label: CATS[key], n: cats[key] }));
}

/* tonight's best and tomorrow's: the file has them best first. Stephen's own
   event is always in, whatever the hour. Each night reads in time order;
   folded, its best stands for it: his own, then a staff pick, then the best
   with a photo. One night alone folds to its best two. */
function feedOf(picks, now, today) {
  const tomorrow = addDays(today, 1);
  const hour = (p) => et(Date.parse(p.start)).hour;
  const live = picks.filter((p) => p && p.id && p.title && Date.parse(p.start) && Number(p.end) * 1000 > now);
  const on = live.filter((p) => p.date === today);
  const night = on.some((p) => hour(p) >= EVENING);
  const first = (night ? on.filter((p) => p.own || hour(p) >= EVENING) : on).slice(0, PER_DAY);
  const second = live.filter((p) => p.date === tomorrow).slice(0, PER_DAY);
  const inTime = (a, b) => Date.parse(a.start) - Date.parse(b.start);
  const open = first.slice().sort(inTime).concat(second.slice().sort(inTime));
  const lead = (list) => list.find((p) => p.own) || list.find((p) => p.pick) || list.find((p) => p.image) || list[0];
  const only = first.length ? first : second;
  const folded = first.length && second.length ? [lead(first), lead(second)]
    : [lead(only), ...only.filter((p) => p !== lead(only))].filter(Boolean).slice(0, FOLDED).sort(inTime);
  return { open, folded, today, tomorrow };
}

/* ------------------------------------------------------------------ paint */
const link = (o = {}) => {
  const p = new URLSearchParams(o).toString();
  return PAGE + (p ? '?' + p : '');
};

function strip(days, today) {
  const box = el('div', 'days calstrip');
  box.dataset.calStrip = '1';
  days.forEach((d) => {
    const wd = d.date === today ? WORDS.today : WORDS.dows[noon(d.date).getUTCDay()];
    const dd = Number(d.date.slice(8));
    const a = el('a', d.n ? '' : 'none', '<span class="wd">' + esc(wd) + '</span><span class="dd">' + dd + '</span><span class="n">' + (d.n || '') + '</span>');
    a.href = link({ date: d.date });
    a.dataset.day = d.date;
    a.setAttribute('aria-label', wd + ' ' + dd + ': ' + d.n + (d.n === 1 ? ' event' : ' events'));
    box.appendChild(a);
  });
  return box;
}

const dayWord = (p, f) => (p.date === f.tomorrow ? WORDS.tomorrow : et(Date.parse(p.start)).hour >= EVENING ? WORDS.tonight : WORDS.today);
/* the time on a tile of the event's own colour, where it has no photo */
function timeTile(p) {
  const [hm, ap] = fmtTime(et(Date.parse(p.start))).split(' ');
  return '<span class="caltm" data-cat="' + esc(p.category) + '"><b>' + esc(hm) + '</b>' + esc(ap) + '</span>';
}
const cleanTitle = (s) => String(s).replace(/^['‘’"“]+|['‘’"“]+$/g, '');

function row(p, f) {
  const k = 'cal-' + p.id;
  const title = cleanTitle(p.title);
  const place = p.venue || p.town || '';
  const href = link({ e: p.id });
  const saved = store.isSaved(k);
  const r = el('div', 'calrow');
  r.dataset.k = k;
  const pic = /^https:/i.test(String(p.image || ''));
  const thumb = pic ? '<img src="' + esc(safeHref(p.image)) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : timeTile(p);
  const line = dayWord(p, f) + (pic ? ' ' + fmtTime(et(Date.parse(p.start))) : '') + (place ? ' · ' + place : '');
  r.innerHTML = '<a class="calopen" href="' + esc(href) + '"><span class="calth">' + thumb + '</span><span class="calt"><b>' + esc(title) + '</b>' +
    '<span class="s">' + esc(line) + '</span></span></a>' +
    '<span class="calacts"><button class="act sh" data-act="share" aria-label="Share">' + ICON.share + '</button>' +
    '<button class="act star' + (saved ? ' on' : '') + '" data-act="save" aria-label="Save" aria-pressed="' + saved + '">' + ICON.star + '</button></span>';
  const img = r.querySelector('img');
  if (img) img.addEventListener('error', () => { img.closest('.calth').innerHTML = timeTile(p); });
  const url = new URL(href, location.href).href;
  app.know([{ k, href: url, shareUrl: url, kind: 'event', title, src: place || 'Calendar', sid: 'venue:' + (place || 'calendar').toLowerCase() }]);
  return r;
}

function chips(cats) {
  const box = el('div', 'calchips');
  box.dataset.calChips = '1';
  cats.forEach((c) => {
    const a = el('a', 'chip', '<span>' + esc(c.label) + '</span><span class="n">' + c.n + '</span>');
    a.href = link({ cat: c.key, when: 'twoweeks' });
    a.dataset.cat = c.key;
    box.appendChild(a);
  });
  return box;
}

function paint(s) {
  const { node, o } = s;
  node.innerHTML = '';
  const j = file ? shape(file, Date.now()) : null;
  if (!j || !j.total) { node.hidden = true; return; }
  node.hidden = false;
  const box = el('section', 'cal');
  box.dataset.calBlock = o.name;
  box.setAttribute('aria-label', WORDS.title);
  box.appendChild(el('div', 'calhead', '<b class="caln">' + j.total.toLocaleString('en-US') + '</b><div><h2>' + esc(WORDS.title) + '</h2><p>' + esc(WORDS.count) + '</p></div>'));
  if (o.strip !== false) box.appendChild(strip(j.strip, j.today));
  const rows = s.open ? j.feed.open : j.feed.folded;
  if (rows.length) {
    const feed = el('div', 'calfeed');
    rows.forEach((p) => feed.appendChild(row(p, j.feed)));
    app.bindFeed(feed);
    box.appendChild(feed);
  }
  if (s.open) box.appendChild(chips(j.cats));
  const foot = el('div', 'calfoot');
  if (j.feed.open.length > FOLDED || j.cats.length) {
    const more = el('button', 'calmore', esc(s.open ? WORDS.less : WORDS.more));
    more.type = 'button';
    more.dataset.calMore = '1';
    more.setAttribute('aria-expanded', s.open ? 'true' : 'false');
    more.addEventListener('click', () => { s.open = !s.open; paint(s); const b = s.node.querySelector('[data-cal-more]'); if (b) b.focus({ preventScroll: true }); });
    foot.appendChild(more);
  }
  const go = el('a', 'calgo', '<span>' + esc(WORDS.full) + '</span>' + ICON.arrow);
  go.href = link();
  go.dataset.calFull = '1';
  foot.appendChild(go);
  box.appendChild(foot);
  node.appendChild(box);
}

export function mount(node, o = {}) {
  const s = { node, o, open: false };
  const old = [...slots].find((x) => x.o.name === o.name);
  if (old) { s.open = old.open; slots.delete(old); }
  slots.add(s);
  node.hidden = true;
  if (file) paint(s);
  if (!fresh()) load().then(() => { if (slots.has(s)) paint(s); });
}

const paintAll = () => slots.forEach((s) => { if (s.node.isConnected) paint(s); });
export function repaint() {
  paintAll();
  if (!fresh()) load().then(paintAll);
}

/* the phone back on an open app, or the back button back from the calendar */
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') repaint(); });
window.addEventListener('pageshow', (e) => { if (e.persisted) repaint(); });
