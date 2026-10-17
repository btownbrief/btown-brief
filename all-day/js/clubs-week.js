/* clubs-week.js: the run and fitness clubs' week, from data/run-clubs.json.
   Pure functions, no DOM and no fetching, shared by People (the week strip,
   the club sheet) and What Now (the window cards, the Move with people chip),
   and tested in node by scripts/test-clubs-week.mjs.

   Everything is Burlington's clock (America/New_York), wherever the reader
   is: a club's "wed 17:30" is 5:30 pm on a Burlington Wednesday. Days are
   counted as calendar days and every time is made from its wall clock on its
   own day, so a week that crosses a daylight-saving change keeps 5:30 pm at
   5:30 pm. Months here are 1 to 12, as in the data's `months` field.

   A meet is on a given day when its weekday matches and its season allows
   that day: the meet's `months` (or, when it has none, its club's), and every
   `from` / `until` on the club and on the meet. A club with none of these
   runs all year. The free-text `season` is for people and is never read. */

export const TZ = 'America/New_York';
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR = 3600000;
const PARTS = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' });
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* a moment as Burlington wall time: { y, mo (1-12), d, h, mi, dow (0 = Sunday) } */
export function et(ms) {
  const o = {};
  PARTS.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, dow: WD.indexOf(o.weekday) };
}

/* Burlington wall time back to a moment. Starts from a guess five hours
   behind UTC and corrects by what the guess reads as, which settles in two
   steps on either side of a daylight-saving change. */
export function wall(y, mo, d, h, mi) {
  const want = Date.UTC(y, mo - 1, d, h, mi);
  let t = want + 5 * HOUR;
  for (let i = 0; i < 3; i++) { const x = et(t); t += want - Date.UTC(x.y, x.mo - 1, x.d, x.h, x.mi); }
  return t;
}

/* the calendar day n days on: noon UTC never slips a day */
export function addDays(day, n) {
  const u = new Date(Date.UTC(day.y, day.mo - 1, day.d + n, 12));
  return { y: u.getUTCFullYear(), mo: u.getUTCMonth() + 1, d: u.getUTCDate(), dow: u.getUTCDay() };
}
export const dateKey = (day) => day.y + '-' + String(day.mo).padStart(2, '0') + '-' + String(day.d).padStart(2, '0');
const dayOf = (ms) => { const x = et(ms); return { y: x.y, mo: x.mo, d: x.d, dow: x.dow }; };
const midnight = (day) => wall(day.y, day.mo, day.d, 0, 0);

/* "18:00" → "6 pm", "17:30" → "5:30 pm" (the plan composer's own words) */
export function timeLabel(hhmm) {
  const m = TIME_RE.exec(String(hhmm || ''));
  if (!m) return '';
  const h = +m[1], mi = +m[2];
  return ((h % 12) || 12) + (mi ? ':' + m[2] : '') + (h < 12 ? ' am' : ' pm');
}

/* -------------------------------------------------------------- seasons */
const monthsOf = (x) => (Array.isArray(x && x.months) && x.months.length ? x.months.map(Number) : null);
const dateOf = (v) => (typeof v === 'string' && DATE_RE.test(v) ? v : null);

/* is this club's meet on, on this calendar day? */
export function inSeason(club, meet, day) {
  const months = monthsOf(meet) || monthsOf(club);
  if (months && !months.includes(day.mo)) return false;
  const key = dateKey(day);
  for (const x of [club, meet]) {
    if (!x) continue;
    const from = dateOf(x.from), until = dateOf(x.until);
    if (from && key < from) return false;
    if (until && key > until) return false;
  }
  return true;
}

/* ---------------------------------------------------------- occurrences */
const usable = (c) => !!(c && typeof c === 'object' && typeof c.id === 'string' && c.id && typeof c.name === 'string' && c.name && Array.isArray(c.meets));

/* One meet on one day: the club, the meet, the moment it starts and a
   stable key ("rc-<club>-<date>-<hhmm>"), the deep link's and the row's. */
function occurrence(club, meet, day) {
  const m = TIME_RE.exec(String(meet.time || ''));
  const at = wall(day.y, day.mo, day.d, +m[1], +m[2]);
  return { k: 'rc-' + club.id + '-' + dateKey(day) + '-' + m[1] + m[2], club, meet, at, date: dateKey(day), dow: day.dow, time: timeLabel(meet.time) };
}

/* every meet on one calendar day, in time order (then by club name) */
export function meetsOn(clubs, day, keep) {
  const out = [];
  (Array.isArray(clubs) ? clubs : []).forEach((club) => {
    if (!usable(club) || (keep && !keep(club))) return;
    club.meets.forEach((meet) => {
      if (!meet || meet.day !== DOW[day.dow] || !TIME_RE.test(String(meet.time || ''))) return;
      if (!inSeason(club, meet, day)) return;
      out.push(occurrence(club, meet, day));
    });
  });
  return out.sort((a, b) => a.at - b.at || a.club.name.localeCompare(b.club.name));
}

/* The week from today: seven Burlington days, today first, each with its
   meets in time order. A meet today that has already started is kept and
   marked `past`, so the caller decides. */
export function weekStrip(clubs, nowMs, keep) {
  const today = dayOf(nowMs);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(today, i);
    const meets = meetsOn(clubs, day, keep).map((o) => ({ ...o, past: o.at < nowMs }));
    out.push({ key: dateKey(day), y: day.y, mo: day.mo, d: day.d, dow: day.dow, wd: WD[day.dow], today: i === 0, tomorrow: i === 1, meets });
  }
  return out;
}

/* every meet starting at or after fromMs and before toMs, soonest first */
export function meetsInWindow(clubs, fromMs, toMs, keep) {
  if (!(toMs > fromMs)) return [];
  const out = [];
  let day = dayOf(fromMs);
  const last = dateKey(dayOf(toMs));
  for (let i = 0; i < 60 && dateKey(day) <= last; i++, day = addDays(day, 1)) {
    meetsOn(clubs, day, keep).forEach((o) => { if (o.at >= fromMs && o.at < toMs) out.push(o); });
  }
  return out.sort((a, b) => a.at - b.at || a.club.name.localeCompare(b.club.name));
}

/* the next meet from fromMs on, within four weeks, or null */
export function nextMeet(clubs, fromMs, keep) {
  return meetsInWindow(clubs, fromMs, fromMs + 28 * 24 * HOUR, keep)[0] || null;
}

/* What Now's three windows:
   now       starting in the next three hours
   tonight   from 4 pm today (or now, if later) to midnight
   tomorrow  all of tomorrow */
export const EVENING_HOUR = 16;
export function windowFor(name, nowMs) {
  const today = dayOf(nowMs);
  const tomorrow = addDays(today, 1);
  if (name === 'tonight') return { from: Math.max(nowMs, wall(today.y, today.mo, today.d, EVENING_HOUR, 0)), to: midnight(tomorrow) };
  if (name === 'tomorrow') return { from: midnight(tomorrow), to: midnight(addDays(tomorrow, 1)) };
  return { from: nowMs, to: nowMs + 3 * HOUR };
}

/* ----------------------------------------------------------------- words */
/* Run clubs and everything else (hikes, rides, pickup, rowing...). */
export const isRun = (club) => !!club && club.kind === 'run';
export const isFitness = (club) => !!club && club.kind !== 'run';

/* a place on a map: its coordinates when it has them, else its address;
   a start point that moves has none */
export function mapUrl(meet) {
  if (!meet) return '';
  const lat = Number(meet.lat), lng = Number(meet.lng);
  if (meet.lat != null && meet.lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    return 'https://www.google.com/maps/search/?api=1&query=' + lat + '%2C' + lng;
  }
  const a = typeof meet.address === 'string' ? meet.address.trim() : '';
  return a ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(a) : '';
}

/* A long field cut to one line: the club's own quoted words, or as many
   whole sentences as fit, up to the first semicolon (a pace that runs on),
   without the quote marks the data keeps for what a club said, then trimmed
   to `max` with an ellipsis. */
export function oneLine(text, max = 90) {
  let s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  /* a club's own words in quotes come whole; otherwise as many whole
     sentences as fit ("First trail run? Tell the leader..." keeps both) */
  const q = /^["“]([^"“”]+)["”]/.exec(s);
  if (q) s = q[1];
  else {
    const parts = s.match(/.+?[.!?]["'”’]*(?=\s|$)|.+$/g) || [s];
    let out = parts[0].trim();
    for (let i = 1; i < parts.length && (out + ' ' + parts[i].trim()).length <= max; i++) out += ' ' + parts[i].trim();
    s = out;
  }
  s = s.split(/;\s/)[0];
  s = s.replace(/["“”]/g, '').replace(/^['‘’]+|['‘’]+$/g, '').trim();
  if (s.length > max) s = s.slice(0, max - 1).replace(/[\s,;:.-]+\S*$/, '').trimEnd() + '…';
  return s;
}

/* The demo's clubs (all-day/data/demo/run-clubs.json) keep a few meets
   relative to the moment the demo opens, so What Now's Now always has one:
   `in_hours: 1.5` becomes the Burlington weekday and time an hour and a half
   from now, rounded up to the quarter hour. Returns a copy. */
export function redateDemo(doc, nowMs) {
  const out = JSON.parse(JSON.stringify(doc || {}));
  (Array.isArray(out.clubs) ? out.clubs : []).forEach((c) => (Array.isArray(c.meets) ? c.meets : []).forEach((m) => {
    if (typeof m.in_hours !== 'number') return;
    const at = Math.ceil((nowMs + m.in_hours * HOUR) / (15 * 60000)) * 15 * 60000;
    const x = et(at);
    m.day = DOW[x.dow];
    m.time = String(x.h).padStart(2, '0') + ':' + String(x.mi).padStart(2, '0');
    delete m.in_hours;
  }));
  return out;
}
