/* What Now: one answer, then put the phone down.

   A weather line at the top (feels like, the lake when the gage is fresh,
   sunset), then two views behind the chip row: Spin with the Missions list
   right under it (the Missions chip jumps down to the list), and Tonight.

   - Spin. The standalone What Now app's engine (whatnow-engine.js, ported
     verbatim and not touched here) behind one big button. It builds a pool
     of answers that are safe and sensible for the window being planned (now,
     tonight, tomorrow), scores them against the sky and the clock, and picks
     weighted-random from the top. The safety gates live in the engine, where
     the pool is built, so no chip and no respin can reach around them. The
     answer card spells out the engine's reasons; Do it ends the session with
     the app's own line; Another respins. The path chips (I'm broke, get me
     outside, people please, two hours, close by, teach me something) are the
     engine's own constraint keys.
   - Missions. The Top 100+ as missions (data/missions.json, built by
     scripts/build_missions.py): a numbered list, theme chips, Mark done
     (kept on this device, and on the reader's account when signed in, which
     fails soft), and Surprise me, which scrolls the list to a mission you
     have not done and lets it glow, rather than opening a modal. Each row
     carries the mission's one-line teaser under its title (2026-10-19);
     tap a mission for its paragraph and its places, each with a line on
     why it is the pick. A spin that lands on a mission's own place marks
     that row and scrolls the list to it. Marks are kept under each
     mission's stable `mark` (m200 and up), never its rank; old marks kept
     under a rank (m1 to m199, the list before 2026-10-19) move onto the
     mission whose `was` names that rank, once, on the device and on the
     account (see migrateMarks and pullDone).
   - Moving with people. The run and fitness clubs' weekly meets
     (data/run-clubs.json through clubs-week.js, the same week People
     shows) in the window being planned: Now is the next three hours,
     Tonight is 4 pm to midnight, Tomorrow is all of tomorrow. They show as
     rows under the answer, and Tonight's view carries tonight's. The path
     chip Move with people answers only with those meets (it switches the
     other chips off, and they it), and when there are none says so and
     names the next one. A row opens People's club week on that meet.
     The missions list leads with "Run with a club", which opens People's
     week (#people/clubs).
   - Tonight. The local artists with a show tonight or this week
     (all-day/data/music.json), the job the old Music tab did, why lines
     kept, then today's calendar from 5 pm on (all-day/data/whatnow.json, in
     Burlington's clock, not the reader's) as event cards. Listen builds that artist's
     Bandcamp player in place; nothing plays until you press its play button,
     and the shell's player steps aside for it (and silences it in turn).

   - At a glance, on the Spin view (Stephen, 2026-10-17). The weather card
     sits to the right of the Now/Tonight/Tomorrow pills, above Spin: the
     temperature, feels like, today's high and low, a condition icon and the
     next six hours, from the same data/weather/latest.json the guide's
     weather page reads (refreshed hourly on main), and it opens that page.
     Over it, a strip of sky (2026-10-17, Stephen: "recreate it, with how
     the sun moves"): weather.html's sun arc in miniature, the sun or the
     moon where it really is, the sky's colour by the hour and a light
     overlay for what the weather is doing. Under the pills and the card,
     today in two or three plain sentences (latest.json's brief, see
     wxBrief) and a Full weather link to that page (2026-10-19).
     Under the answer, Happening today: the rest of today's calendar from
     data/whatnow.json (the events calendar, trimmed), in Burlington's clock,
     daytime first and then tonight's, each opening its own listing, and a
     link to the full events calendar.
   - Btown Challenges, above the Top 100+: one weekly challenge and three
     evergreen ones from all-day/data/challenges.json, which Stephen edits by
     hand (none of the boards fits a standing challenge, so readers suggest
     one by email instead). The week's pick and the evergreen three turn over
     on Burlington's Monday. Mark done is kept on this device, like a
     mission's.

   ?demo=1 runs this same file on data/demo/whatnow.json, which holds every
   payload in its real shape; its dates are moved to today on load. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import { el, esc, safeHref, ICON, svg, art, section, chips, pills, button, cards, put, meetRow, rail } from '../ui.js';
import * as cw from '../clubs-week.js';
import { loadAll } from '../whatnow-data.js';
import { buildContext, buildPool, pick, fmtTime, outdoorRisks } from '../whatnow-engine.js';
import { sunScore } from '../sun.js';

const KEY = 'whatnow';
const MODES = ['spin', 'missions', 'tonight'];
const MISSIONS_URL = '../data/missions.json';
const RUN_CLUBS_URL = '../data/run-clubs.json';
const MEETS_SHOWN = 3;
const EVENTS_URL = '../events.html';
const WEATHER_URL = '../weather.html';
const CHALLENGES_URL = 'data/challenges.json';
const CH_DONE_KEY = 'allday-challenges';
const CH_MORE = 'https://play.btownbrief.com/challenges/';
const CH_SUGGEST = 'btownbrief@gmail.com';
const CH_SHOWN = 3;                      // evergreen challenges at a time
const TODAY_SHOWN = 8;                   // Happening today, at most
const DAY_SHOWN = 4;                     // of which before 5 pm, at most
const HOURS_SHOWN = 6;
const DONE_KEY = 'allday-missions';
const STABLE = /^m[2-9]\d\d$/;          // a mission's own mark, m200 to m999
const LEGACY = /^m(\d{1,3})$/;           // m1 to m199: a rank, the old way
const SEEN_KEY = 'allday-wn-seen';
const SEEN_MS = 20 * 3600 * 1000;       // about a day, so tomorrow does not open on today's answer
const EVENING = 17;                      // Tonight starts at 5 pm in Burlington
const WEEK = 7;
const REEL_MS = [55, 60, 68, 78, 92, 110, 135, 170, 215, 275, 350];

const WINDOWS = [['now', 'Now'], ['tonight', 'Tonight'], ['tomorrow', 'Tomorrow']];
const PATHS = [['free', 'I’m broke'], ['outside', 'Get me outside'], ['people', 'People, please'],
  ['twohours', 'Two hours'], ['closeby', 'Close by'], ['hobby', 'Teach me something'], ['move', 'Move with people']];
const THEME = { eat: 'Eat', drink: 'Drink', outdoors: 'Outdoors', water: 'Water', culture: 'Culture',
  play: 'Play', family: 'Family', winter: 'Winter', free: 'Free' };

/* Signed-in Mark done goes to the fleet's Supabase project through two
   functions this tab asks for (the SQL is in the pull request). Until they
   exist the calls fail and the device copy is all there is. */
const SB_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
const SB_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3'; // anon, safe to ship

/* ----------------------------------------------------------------- clock */
const TZ = 'America/New_York';
const partsFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dowFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' });
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' });
function et(ms) {
  const o = {};
  partsFmt.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
  return { date: o.year + '-' + o.month + '-' + o.day, hour: Number(o.hour), minute: Number(o.minute), dom: Number(o.day) };
}
const utcNoon = (d) => { const [y, m, n] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, n, 12)); };
const addDays = (d, n) => { const t = utcNoon(d); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const clock = (ms) => fmtTime(new Date(ms));                 // "6:06pm", the engine's own format
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/* ----------------------------------------------------------------- state */
const S = {
  mode: 'spin', theme: 'all', window: 'now', chips: new Set(),
  answer: null, pool: 0, ctx: null, rolling: false, did: false,
  feeds: null, feedsFailed: false, sun: null,
  weather: null, events: null, music: null, missions: null, missionsFailed: false,
  rc: null,                              // data/run-clubs.json's clubs, [] when it did not load
  challenges: null, challengesFailed: false,
};
let root = null, pending = null, ready = false, loaded = null, D = null, reel = 0;
const done = app.demo ? Object.create(null) : { ...readMap(DONE_KEY) };
const chDone = app.demo ? Object.create(null) : { ...readMap(CH_DONE_KEY) };
const seenDemo = Object.create(null);

function readMap(key) { const v = store.read(key, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

/* ---------------------------------------------------------------- loading */
/* Everything is fetched on the first visit to the tab, never before:
   things.json alone is 236 KB. Each piece paints when it lands. */
function load() {
  if (app.demo) {
    return app.demoData(KEY).then((d) => {
      D = redate(d);
      S.weather = D.weather; S.events = D.events; S.music = D.music; S.missions = D.missions; S.challenges = D.challenges || null;
      S.feeds = { ...D.feeds, weather: D.weather, events: D.events };
      return app.demoData('run-clubs').then((j) => { S.rc = cw.redateDemo(j, Date.now()).clubs; }, () => { S.rc = []; });
    });
  }
  /* the wire may hand a payload over again later (a retry after a failed
     first try, or a fresh copy): keep the engine's view of it current and
     repaint the tab if it is showing */
  const sub = (key, take) => new Promise((res) => data.load(key, (j) => { take(j); res(); if (ready) repaint(); }, res));
  const parts = [
    sub('weather', (j) => { S.weather = j; if (S.feeds) S.feeds.weather = j; }),
    sub('whatnow', (j) => { S.events = j; if (S.feeds) S.feeds.events = j; }),
    sub('music', (j) => { S.music = j; }),
    data.fetchJSON(MISSIONS_URL, 8000).then((j) => {
      if (!j || !Array.isArray(j.missions)) throw new Error('bad shape');
      S.missions = j;
      migrateMarks();
    }).catch(() => { S.missionsFailed = true; }).then(pullDone),
    loadAll().then(({ data: feeds }) => { S.feeds = feeds; }).catch(() => { S.feedsFailed = true; }),
    data.fetchJSON(CHALLENGES_URL, 8000).then((j) => {
      if (!j || !Array.isArray(j.weekly) || !Array.isArray(j.evergreen)) throw new Error('bad shape');
      S.challenges = j;
    }).catch(() => { S.challengesFailed = true; }),
    data.fetchJSON(RUN_CLUBS_URL, 8000).then((j) => {
      if (!j || !Array.isArray(j.clubs)) throw new Error('bad shape');
      S.rc = j.clubs;
    }).catch(() => { S.rc = []; }),
  ];
  sunScore(data).then((sun) => { S.sun = sun; paintWx(); });
  return Promise.all(parts);
}

function repaint() {
  if (!root || app.activeTab() !== KEY || S.rolling || (S.mode === 'tonight' && embed)) return;
  const y = panel() ? panel().scrollTop : 0;
  render();
  app.paintSubnav();
  if (panel()) panel().scrollTop = y;
}

/* The demo file is dated 2026-10-16. Its dates move to today (Burlington's)
   and its weather reads as just observed, so the engine and Tonight see a
   live day whenever the demo is opened. */
function redate(d) {
  const shift = Math.round((utcNoon(et(Date.now()).date) - utcNoon(d.anchor || '2026-10-16')) / 86400000);
  /* a Burlington time keeps its wall clock: 5 pm in October is 5 pm in
     December, so the offset is the one in force on the new date */
  const offsetOn = (day) => {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(utcNoon(day)).find((x) => x.type === 'timeZoneName');
    const m = part && /GMT([+-]\d{2}:\d{2})/.exec(part.value);
    return m ? m[1] : '-05:00';
  };
  const walk = (v) => {
    if (typeof v === 'string') {
      if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return v;
      const day = addDays(v.slice(0, 10), shift);
      const m = /^(T[\d:.]+)(-0[45]:00)$/.exec(v.slice(10));
      return day + (m ? m[1] + offsetOn(day) : v.slice(10));
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach((k) => { o[k] = walk(v[k]); }); return o; }
    return v;
  };
  const out = walk(d);
  const now = new Date().toISOString();
  out.weather.updated = now;
  if (out.weather.now) out.weather.now.observed_at = now;
  if (out.weather.lake_gage) out.weather.lake_gage.water_temp_at = now;
  if (out.weather.brief) out.weather.brief.generated = now;
  return out;
}

/* ---------------------------------------------------------------- the tab */
function render() {
  if (!root) return;
  closeBandcamp();
  root.innerHTML = '';
  if (S.mode === 'tonight') {
    const wx = weatherLine(true);
    if (wx) root.appendChild(wx);
    renderTonight();
  } else { renderSpin(); renderToday(); renderChallenges(); renderMissions(); }
}

/* One line: what it feels like, the lake when the gage is fresh, sunset.
   The sunset is sun.js's answer once it has one (the line the Art tab used
   to carry, folded in here on 2026-10-17): after tonight's has gone it is
   tomorrow's, and says so, and its score shows only when it is a real one,
   with a forecast behind it and not the 0.0 an empty forecast comes out
   as. Until sun.js answers, the weather payload's time. On the Spin view
   the weather card carries feels like, so the line leaves it out. */
function weatherLine(withFeels) {
  const w = S.weather;
  if (!w) return null;
  const bits = [];
  const feels = w.now && (w.now.feels_like_f != null ? w.now.feels_like_f : w.now.temp_f);
  if (withFeels && feels != null && Number.isFinite(Number(feels))) bits.push('<span><b>' + esc(Math.round(feels)) + '°</b> feels like</span>');
  const g = w.lake_gage;
  const fresh = g && g.water_temp_f != null && g.water_temp_at && Date.now() - Date.parse(g.water_temp_at) < 24 * 3600000;
  if (fresh) bits.push('<span><b>' + esc(Math.round(g.water_temp_f)) + '°</b> lake</span>');
  const sun = S.sun && S.sun.sunsetMs ? S.sun : null;
  const set = sun ? sun.sunsetMs : w.sun && Date.parse(w.sun.sunset);
  const scored = !!sun && Number.isFinite(sun.score) && sun.score > 0 && !sun.degraded;
  if (set) bits.push('<span><b>' + esc(clock(set).replace(/[ap]m$/, '')) + '</b> sunset' + (sun && !sun.isTonight ? ' tomorrow' : '') +
    (scored ? ', <b class="sc">' + esc(sun.score.toFixed(1)) + '</b>/10' : '') + '</span>');
  if (!bits.length) return null;
  const line = el('div', 'wx', bits.join(''));
  line.setAttribute('aria-label', 'Weather');
  if (withFeels) line.dataset.feels = '1';
  return line;
}

/* sun.js answers late: put its sunset into the line already drawn */
function paintWx() {
  const old = root && root.querySelector('.wx');
  const next = old && weatherLine(old.dataset.feels === '1');
  if (next) old.replaceWith(next);
}

/* ------------------------------------------------------------ the weather card */
/* A condition as one of six small icons, by the forecast's own words */
const WX_ICON = {
  sun: ICON.sun,
  moon: ICON.moon,
  cloud: svg('<path d="M7 18.5h10a3.6 3.6 0 0 0 .5-7.2 5.4 5.4 0 0 0-10.4 1.3A3 3 0 0 0 7 18.5z"/>'),
  partly: svg('<path d="M8.5 3.5v1.6M3.4 8.6H5M4.9 5l1.1 1.1M12 5l-1.1 1.1"/><path d="M5.6 11.4a3.4 3.4 0 0 1 6-3.2"/><path d="M8.5 19.5h9a3.3 3.3 0 0 0 .4-6.6 5 5 0 0 0-9.6 1.2 2.7 2.7 0 0 0 .2 5.4z"/>'),
  rain: svg('<path d="M7 15h10a3.6 3.6 0 0 0 .5-7.2A5.4 5.4 0 0 0 7.1 9.1 3 3 0 0 0 7 15z"/><path d="M9 18l-1 2.5M13 18l-1 2.5M17 18l-1 2.5"/>'),
  snow: svg('<path d="M7 15h10a3.6 3.6 0 0 0 .5-7.2A5.4 5.4 0 0 0 7.1 9.1 3 3 0 0 0 7 15z"/><path d="M8.5 19h.01M12 20.5h.01M15.5 19h.01"/>'),
  storm: svg('<path d="M7 15h10a3.6 3.6 0 0 0 .5-7.2A5.4 5.4 0 0 0 7.1 9.1 3 3 0 0 0 7 15z"/><path d="M12.5 15.5 10.5 19h3l-2 3"/>'),
  fog: svg('<path d="M4 9h16M6 13h12M4 17h16"/>'),
};
function wxKind(text, day) {
  const t = String(text || '').toLowerCase();
  if (/thunder|t-storm|storm/.test(t)) return 'storm';
  if (/snow|flurr|sleet|ice|wintry|freezing/.test(t)) return 'snow';
  if (/rain|shower|drizzle/.test(t)) return 'rain';
  if (/fog|haze|smoke|mist/.test(t)) return 'fog';
  if (/partly|mostly sunny|mostly clear|few clouds|scattered clouds/.test(t)) return day ? 'partly' : 'moon';
  if (/cloud|overcast/.test(t)) return 'cloud';
  return day ? 'sun' : 'moon';
}

/* Daylight by today's sunrise and sunset in Burlington, as minutes of the
   day; without them, 7 am to 6 pm. */
function dayAt(ms) {
  const w = S.weather || {};
  const mins = (iso, dflt) => { const t = Date.parse(iso || ''); if (!t) return dflt; const o = et(t); return o.hour * 60 + o.minute; };
  const rise = mins(w.sun && w.sun.sunrise, 420), set = mins(w.sun && w.sun.sunset, 1080);
  const o = et(ms);
  const m = o.hour * 60 + o.minute;
  return m >= rise && m < set;
}
const hourWord = (h) => (h % 12 || 12) + (h < 12 ? 'a' : 'p');
const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

/* What the card shows, worked out from the payload: null when there is no
   temperature to lead with. The observation stands while it is under three
   hours old; after that the forecast hour now falls in. Today's high is the
   forecast's daytime period that starts today in Burlington, the low its
   night period that starts this afternoon or evening. */
function wxNow(now = Date.now()) {
  const w = S.weather;
  if (!w) return null;
  const hours = (w.hourly && Array.isArray(w.hourly.hours) ? w.hourly.hours : []).filter((h) => h && Date.parse(h.t) && num(h.temp_f) != null);
  const obs = w.now && Date.parse(w.now.observed_at) > now - 3 * 3600000 ? w.now : null;
  const cur = hours.find((h) => { const t = Date.parse(h.t); return t <= now && now < t + 3600000; });
  const temp = obs && num(obs.temp_f) != null ? num(obs.temp_f) : cur ? num(cur.temp_f) : null;
  if (temp == null) return null;
  const feels = obs ? num(obs.feels_like_f) : cur ? num(cur.feels_f) : null;
  const today = et(now).date;
  const periods = w.forecast && Array.isArray(w.forecast.periods) ? w.forecast.periods.filter((p) => p && Date.parse(p.start)) : [];
  const onToday = (p) => et(Date.parse(p.start)).date === today;
  const hi = periods.find((p) => p.is_day && onToday(p));
  const lo = periods.find((p) => !p.is_day && onToday(p) && et(Date.parse(p.start)).hour >= 12);
  const next = hours.filter((h) => Date.parse(h.t) > now).slice(0, HOURS_SHOWN).map((h) => {
    const t = Date.parse(h.t);
    return { label: hourWord(et(t).hour), temp: num(h.temp_f), icon: wxKind(h.short, dayAt(t)), pop: num(h.pop) };
  });
  return {
    temp, feels, hi: hi ? num(hi.temp_f) : null, lo: lo ? num(lo.temp_f) : null,
    icon: wxKind((obs && obs.description) || (cur && cur.short) || '', dayAt(now)),
    said: String((obs && obs.description) || (cur && cur.short) || ''),
    hours: next.length >= 3 ? next : [],
  };
}

/* ------------------------------------------------------------ the sky on the card */
/* The guide's weather page draws the day as a scene (js/sun.js): the sun
   rides an arc from sunrise on the left to sunset on the right, across in
   step with the day's fraction and up by its sine, and after sunset the
   moon takes a lower arc across the night. The card carries that arc in
   miniature: a strip of sky over the temperature, the sun or the moon where
   it really is, the sky's colour by the time of day (data-sky) and a light
   overlay for the condition the card's icon shows (is-cloud, is-rain …).
   Every time here is an absolute instant from the payload's sun block, so
   the reader's own time zone never enters it. */
const SKY = { w: 160, h: 30, left: 12, right: 148, base: 25, top: 6, moonLift: 0.82 };
const DAY_MS = 86400000;
const DAWN_MS = 40 * 60000;              // the colour before sunrise and after sunset
const SUNRISE_MS = 45 * 60000, SUNSET_MS = 30 * 60000, GOLDEN_MS = 100 * 60000;
const SKY_TICK = 60000;
const skyPos = (p, lift) => ({
  x: SKY.left + (SKY.right - SKY.left) * p,
  y: SKY.base - (SKY.base - SKY.top) * Math.sin(Math.PI * p) * lift,
});
const ARC_D = Array.from({ length: 25 }, (_, i) => { const q = skyPos(i / 24, 1); return (i ? 'L' : 'M') + q.x.toFixed(1) + ' ' + q.y.toFixed(1); }).join('');

/* Where the sun or the moon is at `now`, and what colour the sky is: null
   without today's sunrise and sunset. A payload a day or two old (the
   refresh skipped a night) carries its times forward whole days. */
function skyAt(now = Date.now()) {
  const s = S.weather && S.weather.sun;
  let rise = Date.parse((s && s.sunrise) || ''), set = Date.parse((s && s.sunset) || '');
  if (!rise || !set || set <= rise) return null;
  let next = Date.parse((s && s.sunrise_tomorrow) || '') || rise + DAY_MS;
  if (next <= set) next = rise + DAY_MS;
  /* past tomorrow's sunrise: tomorrow's own times first, then whole days */
  const set2 = Date.parse((s && s.sunset_tomorrow) || '');
  if (now >= next) { set = set2 > next ? set2 : set + DAY_MS; rise = next; next = rise + DAY_MS; }
  for (let i = 0; i < 2 && now >= next; i++) { rise += DAY_MS; set += DAY_MS; next += DAY_MS; }
  if (now >= rise && now < set) {
    const p = (now - rise) / (set - rise);
    const phase = now - rise < SUNRISE_MS ? 'sunrise' : set - now <= SUNSET_MS ? 'sunset' : set - now <= GOLDEN_MS ? 'golden' : 'day';
    return { body: 'sun', p, phase, low: Math.sin(Math.PI * p) < 0.3, ...skyPos(p, 1) };
  }
  const from = now < rise ? set - DAY_MS : set, to = now < rise ? rise : next;
  const p = Math.min(1, Math.max(0, (now - from) / (to - from)));
  const phase = now - from < DAWN_MS ? 'dusk' : to - now <= DAWN_MS ? 'dawn' : 'night';
  return { body: 'moon', p, phase, low: false, ...skyPos(p, SKY.moonLift) };
}

/* the overlay on the sky, from the forecast's own words: read as if by day,
   so a partly cloudy night keeps its clouds (the icon shows the moon) */
const SKY_WX = { sun: 'clear', moon: 'clear', partly: 'partly', cloud: 'cloud', rain: 'rain', snow: 'snow', storm: 'storm', fog: 'fog' };

function skyStrip(said) {
  const kind = wxKind(said, true);
  const at = skyAt();
  if (!at) return '';
  const cloud = (x, y, s) => '<path transform="translate(' + x + ' ' + y + ') scale(' + s + ')" d="M0 8h16a4 4 0 0 0 .4-8A6 6 0 0 0 5 1.6 3.4 3.4 0 0 0 0 8z"/>';
  const drops = [18, 34, 50, 66, 82, 98, 114, 130, 146].map((x, i) => '<path d="M' + x + ' ' + (11 + (i % 3) * 3) + 'l-2 5"/>').join('');
  const flakes = [16, 30, 46, 60, 76, 92, 106, 122, 138, 150].map((x, i) => '<circle cx="' + x + '" cy="' + (9 + (i % 4) * 3.5) + '" r="1.1"/>').join('');
  return '<span class="wxsky is-' + SKY_WX[kind] + '" data-sky="' + at.phase + '" aria-hidden="true">' +
    '<svg viewBox="0 0 ' + SKY.w + ' ' + SKY.h + '" preserveAspectRatio="xMidYMid meet" focusable="false">' +
      '<path class="arc" d="' + ARC_D + '"/>' +
      '<rect class="lake" x="0" y="' + SKY.base + '" width="' + SKY.w + '" height="' + (SKY.h - SKY.base) + '"/>' +
      '<rect class="gloom" x="0" y="0" width="' + SKY.w + '" height="' + SKY.base + '"/>' +
      '<circle class="body ' + at.body + (at.low ? ' low' : '') + '" data-body="' + at.body + '" cx="' + at.x.toFixed(1) + '" cy="' + at.y.toFixed(1) + '" r="' + (at.body === 'sun' ? 5 : 4) + '"/>' +
      '<g class="ov cl">' + cloud(24, 3, 1.05) + cloud(96, 1, 1.2) + '<g class="more">' + cloud(58, 7, 0.95) + cloud(126, 6, 1) + '</g></g>' +
      '<g class="ov rn">' + drops + '</g>' +
      '<g class="ov sn">' + flakes + '</g>' +
      '<g class="ov fg"><rect x="0" y="12" width="' + SKY.w + '" height="3"/><rect x="0" y="18" width="' + SKY.w + '" height="3"/></g>' +
    '</svg></span>';
}

/* the strip moves the sun once a minute while the tab is up (not for
   readers who asked for less motion: theirs stays where it was drawn) */
let skyTimer = null;
function paintSky() {
  const strip = root && root.querySelector('.wxcard .wxsky');
  const at = strip && skyAt();
  if (!at) return;
  strip.dataset.sky = at.phase;
  const b = strip.querySelector('.body');
  b.setAttribute('class', 'body ' + at.body + (at.low ? ' low' : ''));
  b.dataset.body = at.body;
  b.setAttribute('cx', at.x.toFixed(1));
  b.setAttribute('cy', at.y.toFixed(1));
  b.setAttribute('r', at.body === 'sun' ? '5' : '4');
}
function skyTick(on) {
  clearInterval(skyTimer);
  skyTimer = null;
  if (on && !matchMedia('(prefers-reduced-motion: reduce)').matches) skyTimer = setInterval(paintSky, SKY_TICK);
}

function weatherCard() {
  const x = wxNow();
  if (!x) return null;
  const a = el('a', 'wxcard');
  a.href = WEATHER_URL;
  a.dataset.wxicon = x.icon;
  const hl = [x.hi != null ? 'H ' + x.hi + '°' : '', x.lo != null ? 'L ' + x.lo + '°' : ''].filter(Boolean).join(' ');
  a.setAttribute('aria-label', [x.said, x.temp + '°', x.feels != null ? 'feels like ' + x.feels + '°' : '', hl.replace('H ', 'high ').replace('L ', 'low ')].filter(Boolean).join(', ') + '. The full forecast');
  a.innerHTML = skyStrip(x.said) + '<span class="wxc-top"><span class="wxc-ic">' + WX_ICON[x.icon] + '</span><b class="wxc-t">' + esc(x.temp) + '°</b>' +
    '<span class="wxc-m">' + (x.feels != null ? '<span class="wxc-feels">Feels ' + esc(x.feels) + '°</span>' : '') +
    (hl ? '<span class="wxc-hl">' + esc(hl) + '</span>' : '') + '</span></span>' +
    (x.hours.length ? '<span class="wxc-hrs">' + x.hours.map((h) => '<span class="wxc-h" data-wxicon="' + esc(h.icon) + '"><i>' + esc(h.label) + '</i>' +
      WX_ICON[h.icon] + '<b>' + esc(h.temp) + '°</b></span>').join('') + '</span>' : '');
  return a;
}

/* Today in plain words, under the card (Stephen, 2026-10-19: "a text brief
   about today's weather and an obvious link to the full weather page").
   The words are latest.json's `brief`, written by rules from the NWS
   forecast at each hourly refresh (scripts/weather_brief.py), the same
   sentences the weather page leads with; they are left out when the brief
   is more than BRIEF_MAX_MS old or was written on another Burlington day,
   so a stalled refresh never says the wrong "tonight".
   The Full weather link shows whenever the card does. */
const BRIEF_MAX_MS = 4 * 3600000;
function wxBriefText(now = Date.now()) {
  const b = S.weather && S.weather.brief;
  if (!b || typeof b.text !== 'string' || !b.text.trim()) return '';
  const age = now - Date.parse(b.generated || '');
  if (!(age >= -3600000 && age < BRIEF_MAX_MS)) return '';
  if (b.date !== et(now).date) return '';      // another Burlington day's today and tonight
  return b.text.trim();
}
function wxBrief() {
  const box = el('div', 'wxbrief');
  const text = wxBriefText();
  if (text) box.appendChild(el('p', 'wxb-t', esc(text)));
  const go = el('a', 'btn sm wxb-go', '<span>Full weather</span>' + ICON.arrow);
  go.href = WEATHER_URL;
  box.appendChild(go);
  return box;
}

/* ------------------------------------------------------------------ Spin */
/* The top of the Spin view: the lake and sunset line across the top (one
   line at 390, sunset score and all), then the window pills on the left and
   the weather card on the right, then Spin under both. */
function renderSpin() {
  const top = el('div', 'wxtop');
  const card = weatherCard();
  const line = weatherLine(!card);
  if (line) top.appendChild(line);
  const tools = el('div', 'toolrow');
  tools.appendChild(pills(WINDOWS, S.window, (v) => { S.window = v; S.answer = null; S.did = false; if (moving()) spin(); else render(); }));
  top.appendChild(tools);
  if (card) { top.appendChild(card); top.appendChild(wxBrief()); }
  root.appendChild(top);

  const s = el('div', 'spin');
  const big = el('button', 'big', ICON.shuffle + '<span>Spin</span>');
  big.addEventListener('click', roll);
  big.disabled = !S.feeds;
  s.appendChild(big);
  if (!S.feeds) s.appendChild(el('p', 'sub', esc(S.feedsFailed ? 'Couldn’t load. Try again later.' : 'Reading the sky…')));
  root.appendChild(s);

  const paths = chips(PATHS.map(([key, label]) => ({ key, label })), null, (k) => {
    if (S.chips.has(k)) S.chips.delete(k);
    else {
      /* Move with people is its own answer: it and the engine's chips take turns */
      if (k === 'move') S.chips.clear(); else S.chips.delete('move');
      S.chips.add(k);
    }
    if (S.answer || S.did || S.chips.has('move')) spin(); else render();
  }, 'paths');
  [...paths.children].forEach((b) => { const on = S.chips.has(b.dataset.chip); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  root.appendChild(paths);

  if (S.did && S.answer) root.appendChild(doneCard(S.answer));
  else if (S.answer || (S.ctx && !S.rolling)) root.appendChild(answerCard());
  if (S.ctx && !S.did) root.appendChild(el('p', 'note pad', esc(poolLine())));
  meetsBlock(S.window);
}

/* ------------------------------------------------------- moving with people */
const moving = () => S.chips.has('move');
const usableClub = (c) => !!c && /^https?:/i.test(String(c.url || ''));
function meetsIn(win) {
  const w = cw.windowFor(win, Date.now());
  return cw.meetsInWindow(S.rc || [], w.from, w.to, usableClub);
}
const nothingWord = (win) => (win === 'tonight' ? 'Nothing else tonight.' : win === 'tomorrow' ? 'Nothing tomorrow.' : 'Nothing in the next few hours.');
/* "Tomorrow", "Wednesday", or nothing for today */
function dayWord(o) {
  const today = et(Date.now()).date;
  return o.date === today ? '' : o.date === addDays(today, 1) ? 'Tomorrow' : dayFmt.format(utcNoon(o.date));
}
const openMeet = (o) => app.go('people', o.k);

/* the window's meets as rows, under the answer (and in Tonight's view) */
function meetsBlock(win) {
  if (!S.rc) return;
  const list = meetsIn(win);
  if (!list.length) return;
  const week = button('The week ' + ICON.arrow, 'ghost sm', () => app.go('people', 'clubs'));
  const head = section(root, 'Move with people', list.length > MEETS_SHOWN ? '<b>' + esc(list.length) + '</b> ' + esc(windowWord(win)) : null, week);
  head.dataset.sec = 'meets';
  const box = el('div', 'meets');
  box.dataset.meets = win;
  list.slice(0, MEETS_SHOWN).forEach((o) => put(box, meetRow(o, openMeet, { day: dayWord(o) })));
  root.appendChild(box);
}

/* a meet as one of Spin's answers, in the engine's candidate shape */
function meetAnswer(o) {
  const mins = Math.round((o.at - Date.now()) / 60000);
  const why = [];
  if (S.window === 'now') why.push(mins < 60 ? 'it starts in ' + Math.max(1, mins) + ' min' : 'it starts at ' + o.time);
  if (/^\s*free\b/i.test(String(o.club.cost || ''))) why.push('it’s free');
  if (/welcome|all (levels|paces)|beginner|new folks|first time|drop.?in/i.test(String(o.club.newcomers || '') + ' ' + String(o.club.level || ''))) why.push('newcomers are welcome');
  return { id: 'meet-' + o.k, kind: 'meet', o, title: o.club.name, venue: o.meet.where, timeLabel: [dayWord(o), o.time].filter(Boolean).join(' '),
    cost: String(o.club.cost || ''), url: o.club.url, what: o.club.what, why_: why };
}
const meetPool = () => meetsIn(S.window).map(meetAnswer);
/* any meet not answered in the last day, else any */
function pickMeet(pool, recent) {
  const fresh = pool.filter((c) => !recent.includes(c.id));
  const from = fresh.length ? fresh : pool;
  return from.length ? from[Math.floor(Math.random() * from.length)] : null;
}

const windowWord = (w = S.window) => (w === 'tonight' ? 'tonight' : w === 'tomorrow' ? 'tomorrow' : 'right now');

function context() {
  const ctx = buildContext(S.feeds, new Date(), S.window);
  ctx.sunsetScore = S.sun ? S.sun.score : null;
  return ctx;
}

/* the reel shows real candidates from the same pool, slows, then the real
   pick lands; reduced motion skips straight to it */
function roll() {
  if (S.rolling || !S.feeds) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { spin(); return; }
  const ctx = context();
  const pool = moving() ? meetPool() : buildPool(S.feeds, ctx, S.chips);
  if (pool.length < 3) { spin(); return; }
  S.rolling = true; S.did = false; S.ctx = ctx; S.pool = pool.length;
  const mine = ++reel;
  let i = 0;
  const step = () => {
    if (mine !== reel) return;
    if (!root || i >= REEL_MS.length) { S.rolling = false; spin(); return; }
    S.answer = pool[Math.floor(Math.random() * pool.length)];
    render();
    setTimeout(step, REEL_MS[i++]);
  };
  step();
}

function spin() {
  if (!S.feeds) return;
  const ctx = context();
  const pool = moving() ? meetPool() : buildPool(S.feeds, ctx, S.chips);
  S.ctx = ctx; S.pool = pool.length; S.did = false;
  const prev = S.answer && S.answer.id;
  const recent = Object.keys(seen());
  if (prev && !recent.includes(prev)) recent.push(prev);
  S.answer = moving() ? pickMeet(pool, recent) : pick(pool, recent);
  if (S.answer) remember(S.answer.id);
  render();
  const m = missionOf(S.answer);
  if (m) showMission(m);
}

/* An answer that is a mission's own place (its first one) is that mission:
   the list below marks the row and scrolls to it. */
function missionOf(c) {
  if (!c || c.kind !== 'thing' || !/^thing-/.test(c.id || '')) return null;
  const id = c.id.slice(6);
  return missions().find((m) => Array.isArray(m.places) && m.places[0] && m.places[0].id === id) || null;
}
function showMission(m) {
  if (S.theme !== 'all' && S.theme !== m.theme) { S.theme = 'all'; render(); }
  app.flashHit(root.querySelector('.missions'), m.k);
}

function seen() {
  const raw = app.demo ? seenDemo : readMap(SEEN_KEY);
  const out = {};
  Object.keys(raw).forEach((k) => { if (Date.now() - raw[k] < SEEN_MS) out[k] = raw[k]; });
  return out;
}
function remember(id) {
  if (!id) return;
  if (app.demo) { seenDemo[id] = Date.now(); return; }
  const m = seen();
  m[id] = Date.now();
  store.write(SEEN_KEY, m);
}

/* The engine's reasons, as a sentence: "Because it starts in 40 min, it's
   free and it's rain-proof." */
function because(c) {
  const why = (c.why_ || []).slice(0, 3);
  if (!why.length) return '';
  const list = why.length === 1 ? why[0] : why.slice(0, -1).join(', ') + ' and ' + why[why.length - 1];
  return 'Because ' + list + '.';
}

/* lifted from the standalone app so the answer reads as it did there */
function metaLine(c) {
  const bits = [];
  if (c.kind === 'meet') {
    bits.push(c.venue, c.timeLabel, trim(c.cost, 28));
  } else if (c.kind === 'event') {
    bits.push(c.venue, c.timeLabel, c.free ? 'free' : (c.minPrice != null && c.minPrice > 0 ? 'from $' + c.minPrice : ''));
  } else if (c.kind === 'thing') {
    bits.push(c.venue, c.costNote || (c.costTier === 'Free' ? 'free' : c.costTier));
  } else if (c.kind === 'sunset') {
    bits.push('be there by ' + c.arriveLabel, c.walkMin != null ? c.walkMin + ' min walk from Church St' : '', 'sun’s down ' + c.sunsetLabel);
  } else if (c.kind === 'beach') {
    bits.push(c.venue, c.beach && c.beach.sampled ? 'water tested clean' : '');
  } else bits.push(c.venue);
  return bits.filter(Boolean).join(' · ');
}
const trim = (s, n) => (!s ? '' : (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s));
function blurbFor(c) {
  if (c.kind === 'thing') return c.blurb || '';
  if (c.kind === 'club' || c.kind === 'meet') return trim(c.what, 160);
  if (c.kind === 'hobby') return trim(c.startLine ? c.what + ' Start: ' + c.startLine : c.what, 280);
  if (c.kind === 'sunset') return c.why || 'Look west. That’s the whole assignment.';
  if (c.kind === 'beach') return 'Towel, water, done. This is what the lake is for.';
  return '';
}

function eyebrow() {
  if (S.window === 'tonight') return 'Tonight';
  if (S.window === 'tomorrow') return 'Tomorrow';
  return 'Right now · ' + clock(Date.now());
}

function answerCard() {
  const r = el('div', 'result' + (S.rolling ? ' rolling' : ''));
  r.setAttribute('aria-live', 'polite');
  const c = S.answer;
  if (!c && moving()) return noMeetCard(r);
  if (!c) {
    const ctx = S.ctx;
    const walkable = ctx && !ctx.darkAtTarget && !ctx.rainT && ctx.tempT != null && ctx.tempT >= 40 && !outdoorRisks(ctx).length;
    r.innerHTML = '<div class="in"><div class="eyebrow">Honestly</div><h3>Nothing fits all that.</h3><p>' +
      esc(walkable ? 'Take the waterfront walk.' : 'Some hours are for staying in.') + '</p></div>';
    return r;
  }
  const blurb = blurbFor(c);
  const why = because(c);
  r.innerHTML = '<div class="in"><div class="eyebrow">' + esc(eyebrow()) + '</div><h3>' + esc(c.title) + '</h3>' +
    (why ? '<p class="because">' + esc(why) + '</p>' : '') +
    '<p class="meta">' + esc(metaLine(c)) + '</p>' + (blurb && !S.rolling ? '<p>' + esc(blurb) + '</p>' : '') + '<div class="row"></div></div>';
  if (!S.rolling) {
    const row = r.querySelector('.row');
    row.append(button('Do it ' + ICON.arrow, 'doit', () => { S.did = true; render(); }), button('Another', 'ghost another', roll));
  }
  return r;
}

/* Move with people and nothing in the window: say so, and name the next one */
function noMeetCard(r) {
  const w = cw.windowFor(S.window, Date.now());
  const next = cw.nextMeet(S.rc || [], w.to, usableClub) || cw.nextMeet(S.rc || [], Date.now(), usableClub);
  r.dataset.nomeet = S.window;
  r.innerHTML = '<div class="in"><div class="eyebrow">Honestly</div><h3>' + esc(nothingWord(S.window)) + '</h3>' +
    (next ? '<p class="meta">' + esc('Next: ' + [next.club.name, [dayWord(next), next.time].filter(Boolean).join(' '), next.meet.where].join(' · ')) + '</p>' : '') +
    '<div class="row"></div></div>';
  const row = r.querySelector('.row');
  if (next) {
    const b = button('That one ' + ICON.arrow, 'doit', () => openMeet(next));
    b.dataset.next = next.k;
    row.appendChild(b);
  }
  row.appendChild(button('The week', 'ghost', () => app.go('people', 'clubs')));
  return r;
}

/* Do it ends the session: the app's own line, and the way to the details. */
function doneCard(c) {
  const r = el('div', 'result did');
  r.innerHTML = '<div class="in"><div class="eyebrow">' + esc(c.title) + '</div><h3>Now put the phone down.</h3><p>' +
    esc(metaLine(c)) + '</p><div class="row"></div></div>';
  const row = r.querySelector('.row');
  if (c.kind === 'meet') row.appendChild(button('The club', 'ghost', () => openMeet(c.o)));
  else if (c.url) row.appendChild(openLink('The details', c.url));
  row.appendChild(button('Spin again later', 'ghost', () => { S.did = false; S.answer = null; render(); }));
  return r;
}

/* "12 things fit right now", and for a thin pool the reason (it's late) */
function poolLine() {
  const ctx = S.ctx;
  const why = [];
  if (S.pool < 8) {
    if (ctx.block === 'Late Night' && S.window === 'now') why.push('it’s late');
    if (ctx.rainT) why.push('it’s raining');
    else if (ctx.tempT != null && ctx.tempT <= 20) why.push('it’s bitter out');
    if (ctx.tempT == null) why.push('the sky can’t be read');
    if (S.chips.size >= 2) why.push('the chips are tight');
  }
  const tail = why.length ? ' · ' + why.slice(0, 2).join(' and ') : '';
  if (moving()) return S.pool ? plural(S.pool, 'meet', 'meets') + ' ' + windowWord() : 'No meets ' + windowWord();
  return (S.pool ? plural(S.pool, 'thing', 'things') + ' fit ' : 'Nothing fits ') + windowWord() + tail;
}

/* --------------------------------------------------------- Happening today */
/* The rest of today's calendar in Burlington's clock: what is still to
   start (or started in the last 15 minutes), plus what is on now and began
   within two hours, daytime first and then tonight's, soonest first. All-day
   listings are exhibits, not plans, and stay on the calendar page. One that
   began last night and is still on (11:30 pm to 1:30 am, at 12:30 am)
   counts as on now. After the last one tonight, tomorrow's take the strip. */
const usableEvent = (e) => !!e && !!e.id && !!e.title && /^(https?:|#)/i.test(String(e.url || '')) && !e.allDay &&
  !(e.status && e.status !== 'active') && !/^\s*(cancel+ed|postponed)\b/i.test(e.title);
function eventsOn(date, now) {
  const evs = S.events && Array.isArray(S.events.events) ? S.events.events : [];
  const seenK = new Set();
  return evs.filter((e) => {
    if (!usableEvent(e)) return false;
    const start = Date.parse(e.start);
    if (!start) return false;
    const end = Date.parse(e.end) || 0;
    const on = end > now && start <= now && start >= now - 2 * 3600000 && date === et(now).date;
    if (et(start).date !== date && !on) return false;
    if (!(start >= now - 15 * 60000 || on)) return false;
    const sig = e.title.toLowerCase().replace(/[^a-z0-9]+/g, '') + '|' + start;
    if (seenK.has(sig)) return false;
    seenK.add(sig);
    return true;
  }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
function happening(now = Date.now()) {
  const muted = store.muted();
  const keep = (e) => !muted['venue:' + (e.venue || e.town || 'calendar').toLowerCase()];
  const today = et(now).date;
  let list = eventsOn(today, now).filter(keep);
  let day = 'today';
  if (!list.length) {
    const next = eventsOn(addDays(today, 1), now).filter(keep);
    if (next.length) { list = next; day = 'tomorrow'; }
  }
  const isNight = (e) => et(Date.parse(e.start)).hour >= EVENING;
  const early = list.filter((e) => !isNight(e)).slice(0, day === 'today' ? DAY_SHOWN : TODAY_SHOWN);
  const late = list.filter(isNight).slice(0, TODAY_SHOWN - early.length);
  return { day, early, late };
}

function todayTile(e, now) {
  const start = Date.parse(e.start);
  const a = el('a', 'tday' + (et(start).hour >= EVENING ? ' night' : ''));
  a.href = safeHref(e.url);
  if (!/^#/.test(e.url)) { a.target = '_blank'; a.rel = 'noopener'; }
  a.dataset.k = 'd-' + e.id;
  const when = start <= now ? 'On now' : clock(start).replace(/(\d)([ap]m)$/, '$1 $2');
  const where = e.venue || e.town || '';
  a.innerHTML = '<span class="tw">' + esc(when) + '</span><span class="tt">' + esc(e.title.replace(/^['‘’"“]+|['‘’"“]+$/g, '')) + '</span>' +
    (where ? '<span class="tv">' + esc(where) + '</span>' : '');
  return a;
}

function renderToday() {
  if (!S.events) return;
  const now = Date.now();
  const { day, early, late } = happening(now);
  const head = section(root, day === 'today' ? 'Happening today' : 'Happening tomorrow');
  head.dataset.sec = 'today';
  if (early.length || late.length) {
    const track = rail(root, 'today');
    early.forEach((e) => track.appendChild(todayTile(e, now)));
    if (late.length && early.length) track.appendChild(el('span', 'tdsep eyebrow', 'Tonight'));
    late.forEach((e) => track.appendChild(todayTile(e, now)));
  } else root.appendChild(el('p', 'note pad', esc('Nothing else today.')));
  const links = el('div', 'linkrow todaylinks');
  links.appendChild(openLink('Full events calendar', EVENTS_URL, true));
  root.appendChild(links);
}

/* ---------------------------------------------------------- Btown Challenges */
const CH_KINDS = { eat: 'Eat', climb: 'Climb', explore: 'Explore', streak: 'Streak' };
const usableChallenge = (c) => !!c && /^[a-z0-9-]{1,60}$/.test(String(c.id || '')) && !!c.title &&
  /^(https?:\/\/|\.\.\/[\w./-]+(\?[\w=&-]*)?$)/i.test(String(c.url || ''));
const chKind = (c) => (CH_KINDS[c.kind] ? c.kind : 'explore');

/* Burlington's week, counted in Mondays since 1970, so the pick turns over
   on Monday wherever the reader is */
function weekNo(now = Date.now()) {
  const d = et(now).date;
  const dow = (utcNoon(d).getUTCDay() + 6) % 7;             // Monday 0
  return { n: Math.floor((utcNoon(addDays(d, -dow)) - utcNoon('1970-01-05')) / (7 * 86400000)), monday: addDays(d, -dow) };
}
function challengesNow() {
  const ch = S.challenges || {};
  const weekly = (Array.isArray(ch.weekly) ? ch.weekly : []).filter(usableChallenge);
  const ever = (Array.isArray(ch.evergreen) ? ch.evergreen : []).filter(usableChallenge);
  const w = weekNo();
  const pinned = weekly.find((c) => c.week === w.monday);
  const loose = weekly.filter((c) => !c.week);
  const week = pinned || (loose.length ? loose[w.n % loose.length] : null);
  const start = ever.length ? (w.n * CH_SHOWN) % ever.length : 0;
  const three = ever.length <= CH_SHOWN ? ever : Array.from({ length: CH_SHOWN }, (_, i) => ever[(start + i) % ever.length]);
  return { week, three };
}
const chDoneOn = (c) => !!chDone[c.id];

function renderChallenges() {
  if (!S.challenges) return;
  const { week, three } = challengesNow();
  if (!week && !three.length) return;
  const mail = 'mailto:' + (/^[^@\s]+@[^@\s]+$/.test(String(S.challenges.suggest || '')) ? S.challenges.suggest : CH_SUGGEST) +
    '?subject=' + encodeURIComponent('A Btown challenge') + '&body=' + encodeURIComponent('The challenge:\n\nWhere:\n\n');
  const suggest = el('a', 'btn ghost sm suggest', ICON.mail + ' Suggest one');
  suggest.href = mail;
  const head = section(root, 'Btown Challenges', null, suggest);
  head.dataset.sec = 'challenges';
  const box = el('div', 'challenges');
  if (week) box.appendChild(weekCard(week));
  three.forEach((c) => box.appendChild(challengeRow(c)));
  root.appendChild(box);
  const more = /^https:\/\//.test(String(S.challenges.more || '')) ? S.challenges.more : CH_MORE;
  const links = el('div', 'linkrow chlinks');
  links.appendChild(openLink('All challenges', more));
  root.appendChild(links);
}

function chLink(c, label) {
  const ours = !/^https?:/i.test(c.url);
  return openLink(label, c.url, ours);
}

function weekCard(c) {
  const on = chDoneOn(c);
  const r = el('div', 'chweek ch-' + chKind(c) + (on ? ' done' : ''));
  r.dataset.k = 'c-' + c.id;
  r.innerHTML = '<div class="eyebrow">This week</div><h3>' + esc(c.title) + '</h3>' + (c.line ? '<p>' + esc(c.line) + '</p>' : '') + '<div class="row"></div>';
  r.querySelector('.row').append(chDoneButton(c), chLink(c, 'Details'));
  return r;
}

function challengeRow(c) {
  const on = chDoneOn(c);
  const r = el('div', 'lrow chal ch-' + chKind(c) + (on ? ' done' : ''));
  r.dataset.k = 'c-' + c.id;
  const meta = [CH_KINDS[chKind(c)], c.where].filter(Boolean).join(' · ');
  const open = el('button', 'open', '<div class="t">' + esc(c.title) + '</div><div class="s">' + esc(meta) + '</div>');
  open.setAttribute('aria-label', c.title + '. Read it');
  open.addEventListener('click', () => challengeSheet(c));
  r.append(el('span', 'num', ICON.trophy), open, chDoneButton(c));
  return r;
}

function chDoneButton(c, after) {
  const on = chDoneOn(c);
  const b = el('button', 'pillbtn markdone' + (on ? ' on' : ''), on ? ICON.check + ' Done' : 'Mark done');
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.setAttribute('aria-label', (on ? 'Done: ' : 'Mark done: ') + c.title);
  b.addEventListener('click', () => { setChDone(c, !chDoneOn(c)); if (after) after(); });
  return b;
}

function setChDone(c, on) {
  if (on) chDone[c.id] = Math.floor(Date.now() / 1000); else delete chDone[c.id];
  if (!app.demo) store.write(CH_DONE_KEY, chDone);
  app.toast(on ? 'Challenge done' : 'Challenge unmarked');
  const y = panel() ? panel().scrollTop : 0;
  render();
  if (panel()) panel().scrollTop = y;
}

function challengeSheet(c) {
  app.sheet(c.title, (body) => {
    const paint = () => {
      body.innerHTML = '';
      body.appendChild(el('p', 'sheet-note', esc([CH_KINDS[chKind(c)], c.where].filter(Boolean).join(' · '))));
      if (c.line) body.appendChild(el('p', 'pick-why', esc(c.line)));
      const btns = el('div', 'linkrow');
      btns.append(chDoneButton(c, paint), chLink(c, 'Details'));
      body.appendChild(btns);
    };
    paint();
  });
}

/* --------------------------------------------------------------- Missions */
const missions = () => (S.missions && Array.isArray(S.missions.missions) ? S.missions.missions.filter((m) => m && m.k && m.title) : []);
/* the key a mark is kept under: the mission's own stable mark, or (an older
   file, the demo) its rank */
const markOf = (m) => (typeof m.mark === 'string' && STABLE.test(m.mark) ? m.mark : m.k);
const isDone = (m) => !!done[markOf(m)];
const doneCount = () => missions().filter(isDone).length;

/* Old marks were kept under a rank (m1 to m199). With a list whose missions
   carry stable marks, each old rank moves onto the mission whose `was`
   names it (several nested into one: any one done marks it done, at the
   latest time), and the old key goes, so it cannot come back later as the
   new mission that happens to hold that rank. An old rank no mission claims
   is dropped. Returns [old, new-or-null] pairs. Runs on every load and does
   nothing once there is nothing old left. */
function legacyMap() {
  const to = new Map();
  missions().forEach((m) => { if (markOf(m) !== m.k) (Array.isArray(m.was) ? m.was : []).forEach((k) => to.set(k, markOf(m))); });
  return to;
}
const isLegacy = (k) => { const x = LEGACY.exec(k); return !!x && Number(x[1]) >= 1 && Number(x[1]) < 200; };
function migrateMarks() {
  if (app.demo || !missions().some((m) => markOf(m) !== m.k)) return [];
  const to = legacyMap(), moved = [];
  Object.keys(done).forEach((k) => {
    if (!isLegacy(k)) return;
    const mk = to.get(k) || null;
    if (mk) done[mk] = Math.max(Number(done[mk]) || 0, Number(done[k]) || 0) || Math.floor(Date.now() / 1000);
    delete done[k];
    moved.push([k, mk]);
  });
  if (moved.length) store.write(DONE_KEY, done);
  return moved;
}

function renderMissions() {
  if (!S.missions) {
    root.appendChild(S.missionsFailed ? el('div', 'errbox', '<b>The missions didn’t load.</b>')
      : el('p', 'loading', 'Loading the missions…'));
    return;
  }
  const all = missions();
  const sur = el('button', 'pillbtn on surprise', ICON.shuffle + ' Surprise me');
  const head = section(root, 'The Top 100+, as missions', null, sur);
  head.dataset.sec = 'missions';
  const themes = (S.missions.themes || Object.keys(THEME)).filter((t) => all.some((m) => m.theme === t));
  if (S.theme !== 'all' && !themes.includes(S.theme)) S.theme = 'all';
  root.appendChild(chips([{ key: 'all', label: 'All', n: all.length }].concat(themes.map((t) => ({ key: t, label: THEME[t] || t, n: all.filter((m) => m.theme === t).length, cls: THEME[t] ? 'th-' + t : '' }))),
    S.theme, (k) => { S.theme = k; history.replaceState(null, '', location.search + '#whatnow/missions'); render(); }, 'themes'));
  const list = all.filter((m) => S.theme === 'all' || m.theme === S.theme);
  const box = el('div', 'missions');
  if (S.theme === 'all') box.appendChild(clubMission());
  const spun = S.rolling ? null : missionOf(S.answer);
  list.forEach((m) => { const r = missionRow(m); if (spun && spun.k === m.k) r.classList.add('spun'); box.appendChild(r); });
  root.appendChild(box);
  sur.addEventListener('click', () => surprise(box));
  root.appendChild(cards.caught({
    title: 'That’s all.',
    buttons: [button(ICON.shuffle + ' Surprise me', '', () => surprise(box))],
  }));
}

/* Not one of the Top 100+, and not numbered: the standing mission, whose
   action is People's club week. The count is the week's run-club meets. */
function clubMission() {
  const r = el('div', 'lrow mission club');
  r.dataset.k = 'run-with-a-club';
  const week = S.rc ? cw.weekStrip(S.rc, Date.now(), (c) => usableClub(c) && cw.isRun(c)).reduce((n, d) => n + d.meets.filter((o) => !o.past).length, 0) : 0;
  const go = () => app.go('people', 'clubs');
  const open = el('button', 'open', '<div class="t">Run with a club</div><div class="s">' + esc(['Outdoors', week ? plural(week, 'run', 'runs') + ' this week' : ''].filter(Boolean).join(' · ')) + '</div>');
  open.setAttribute('aria-label', 'Run with a club. See this week’s runs');
  open.addEventListener('click', go);
  const b = el('button', 'pillbtn', 'This week ' + ICON.arrow);
  b.dataset.clubs = '1';
  b.addEventListener('click', go);
  r.append(el('span', 'num', ICON.people), open, b);
  return r;
}

function missionRow(m) {
  const on = isDone(m);
  const r = el('div', 'lrow mission' + (THEME[m.theme] ? ' th-' + m.theme : '') + (on ? ' done' : ''));
  r.dataset.k = m.k;
  const hoods = [...new Set((m.places || []).map((p) => p.neighborhood).filter((h) => h && h !== 'Greater Burlington'))];
  const meta = [THEME[m.theme] || m.theme, (m.places || []).length > 1 ? plural(m.places.length, 'place', 'places') : '', hoods.slice(0, 2).join(', ')].filter(Boolean).join(' · ');
  const tz = typeof m.teaser === 'string' && m.teaser.trim() ? '<div class="tz">' + esc(m.teaser.trim()) + '</div>' : '';
  const open = el('button', 'open', '<div class="t">' + esc(m.title) + '</div>' + tz + '<div class="s">' + esc(meta) + '</div>');
  open.setAttribute('aria-label', 'Mission ' + m.n + ': ' + m.title + '. Read it');
  open.addEventListener('click', () => missionSheet(m));
  r.append(el('span', 'num', esc(m.n)), open, doneButton(m));
  return r;
}

function doneButton(m, after) {
  const on = isDone(m);
  const b = el('button', 'pillbtn markdone' + (on ? ' on' : ''), on ? ICON.check + ' Done' : 'Mark done');
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.setAttribute('aria-label', (on ? 'Done: ' : 'Mark done: ') + m.title);
  b.addEventListener('click', () => { setDone(m, !isDone(m)); if (after) after(); });
  return b;
}

function setDone(m, on) {
  const k = markOf(m);
  if (on) done[k] = Math.floor(Date.now() / 1000); else delete done[k];
  if (!app.demo) { store.write(DONE_KEY, done); pushDone(k, on); }
  app.toast(on ? 'Mission ' + m.n + ' done' : 'Mission ' + m.n + ' unmarked');
  const y = panel() ? panel().scrollTop : 0;
  render();
  app.paintSubnav();
  if (panel()) panel().scrollTop = y;
}

/* Surprise me: a mission you haven't done (any, once they all are), the list
   scrolled to it, a short glow, and focus on it so a keyboard or a screen
   reader lands there too. Under reduced motion there is no glow and no
   smooth scroll; the focus ring marks it. */
function surprise(box) {
  const rows = [...box.querySelectorAll('.lrow:not(.club)')];
  if (!rows.length) return;
  const open = rows.filter((r) => !r.classList.contains('done'));
  const pool = open.length ? open : rows;
  const r = pool[Math.floor(Math.random() * pool.length)];
  rows.forEach((x) => x.classList.remove('hl'));
  void r.offsetWidth;
  r.classList.add('hl');
  app.jumpTo(r);
  r.querySelector('.open').focus({ preventScroll: true });
  setTimeout(() => r.classList.remove('hl'), 2400);
}

function missionSheet(m) {
  app.sheet(m.n + '. ' + m.title, (body, card, close) => {
    const paint = () => {
      body.innerHTML = '';
      body.appendChild(el('p', 'sheet-note', esc([THEME[m.theme] || m.theme, 'Mission ' + m.n + ' of ' + missions().length].join(' · '))));
      body.appendChild(el('p', 'pick-why', esc(m.paragraph)));
      const places = (m.places || []).filter((p) => p && p.name);
      if (places.length) {
        body.appendChild(el('div', 'sheet-h', esc(places.length === 1 ? 'The place' : 'The places')));
        places.forEach((p) => {
          const row = el('div', 'sheet-row');
          const sub = [p.neighborhood, p.nearby ? 'nearby' : ''].filter(Boolean).join(' · ');
          const why = typeof p.note === 'string' && p.note.trim() ? '<div class="d why">' + esc(p.note.trim()) + '</div>' : '';
          const label = esc(p.name) + why + (sub ? '<div class="d">' + esc(sub) + '</div>' : '');
          if (/^https?:/i.test(p.url || '')) {
            const a = el('a', 't', label);
            a.href = safeHref(p.url); a.target = '_blank'; a.rel = 'noopener';
            if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens ' + p.name + '’s site in the real build'); });
            row.append(a, el('span', 'note', ICON.ext));
          } else row.appendChild(el('div', 't', label));
          body.appendChild(row);
        });
      }
      const btns = el('div', 'linkrow');
      btns.append(doneButton(m, paint), button(ICON.share + ' Share', 'ghost sm', () => app.share(KEY, m.k, m.title)));
      body.appendChild(btns);
    };
    paint();
  });
}

/* Signed in, Mark done also lives on the reader's account. Every call fails
   soft: no session, no function yet, offline, it all leaves the device copy
   standing. Marks from the account are merged in, never subtracted. */
function rpcAs(fn, args) {
  if (app.demo || !app.user()) return Promise.resolve(null);
  return Promise.resolve(app.token()).then((tok) => {
    if (!tok) return null;
    const ctl = 'AbortController' in window ? new AbortController() : null;
    const t = ctl && setTimeout(() => ctl.abort(), 8000);
    return fetch(SB_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
      ...(ctl ? { signal: ctl.signal } : {}),
    }).then((r) => (r.ok ? r.json().catch(() => null) : null)).finally(() => { if (t) clearTimeout(t); });
  }).catch(() => null);
}
const touched = new Set();
const queue = Object.create(null);
function pushDone(k, on) {
  touched.add(k);
  queue[k] = (queue[k] || Promise.resolve()).then(() => rpcAs('nn_mission_set', { p_key: k, p_done: !!on }));
}
/* Runs once the missions file has landed (or failed), so an old mark on the
   account can be read in the new list's terms. An old rank (m1 to m199) is
   moved the way migrateMarks moves the device's: the mission's mark goes
   up and the old row goes, so it is not read again after the reader
   unmarks the new mission. With no stable marks to move to (an older
   missions file, or none at all) the rows are taken as they are. */
function pullDone() {
  rpcAs('nn_missions_done').then((rows) => {
    if (!Array.isArray(rows)) return;
    const stable = missions().some((m) => markOf(m) !== m.k);
    const to = stable ? legacyMap() : null;
    let added = 0;
    rows.forEach((r) => {
      let k = r && (r.key || r.mission);
      if (typeof k !== 'string' || !LEGACY.test(k)) return;
      if (stable && isLegacy(k)) {
        const old = k;
        k = to.get(old) || null;
        if (!touched.has(old)) pushDone(old, false);     // the old row goes
        if (!k || touched.has(k)) return;                 // unclaimed, or the reader just changed it here
        pushDone(k, true);
        touched.delete(k);                                // pushDone notes it; this pull still applies it below
      }
      if (!done[k] && !touched.has(k)) { done[k] = Math.floor(Date.now() / 1000); added++; }
    });
    if (added) { store.write(DONE_KEY, done); if (ready) repaint(); }
  });
}

/* ---------------------------------------------------------------- Tonight */
/* Today's events from 5 pm on, in Burlington's clock. One that has ended,
   or started two hours ago with no end given, has gone. A cancelled one,
   or the same listing twice, is left out. */
function tonight() {
  const evs = S.events && Array.isArray(S.events.events) ? S.events.events : [];
  const now = Date.now();
  const today = et(now).date;
  const seenK = new Set();
  return evs.filter((e) => {
    if (!e || !e.id || !e.title || !e.url || e.allDay || (e.status && e.status !== 'active')) return false;
    if (/^\s*(cancel+ed|postponed)\b/i.test(e.title)) return false;
    const start = Date.parse(e.start);
    if (!start) return false;
    const t = et(start);
    if (t.date !== today || t.hour < EVENING) return false;
    const end = Date.parse(e.end) || 0;
    if (end ? end < now : start < now - 2 * 3600000) return false;
    const sig = e.title.toLowerCase().replace(/[^a-z0-9]+/g, '') + '|' + start;
    if (seenK.has(sig)) return false;
    seenK.add(sig);
    return true;
  }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

const priceOf = (e) => {
  if (e.free) return 'Free';
  const p = String(e.price || '').split(/[;|]/)[0].replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  return trim(p, 36);
};

function eventCard(e) {
  const start = Date.parse(e.start);
  const t = et(start);
  const where = (e.venue || e.town || 'Burlington') + (e.town && e.venue && e.town !== 'Burlington' ? ', ' + e.town : '');
  return {
    k: 'e-' + e.id, href: e.url, kind: 'event', title: e.title.replace(/^['‘’"“]+|['‘’"“]+$/g, ''),
    src: e.venue || e.town || 'Calendar', sid: 'venue:' + (e.venue || e.town || 'calendar').toLowerCase(),
    dow: dowFmt.format(utcNoon(t.date)), dom: String(t.dom), when: clock(start).replace(/(\d)([ap]m)$/, '$1 $2'), where, price: priceOf(e),
  };
}

/* the artists with a show tonight or in the next seven days, soonest first */
function artists() {
  const list = S.music && Array.isArray(S.music.artists) ? S.music.artists : [];
  const today = et(Date.now()).date;
  const last = addDays(today, WEEK - 1);
  return list.map((a) => {
    const shows = (Array.isArray(a.shows) ? a.shows : []).filter((s) => s && s.date >= today && s.date <= last).sort((x, y) => (x.date < y.date ? -1 : 1));
    return shows.length && a.id && a.name ? { a, s: shows[0] } : null;
  }).filter(Boolean).sort((x, y) => (x.s.date < y.s.date ? -1 : x.s.date > y.s.date ? 1 : 0));
}

function renderTonight() {
  const muted = store.muted();
  const list = tonight().map(eventCard).filter((c) => !muted[c.sid]);
  app.know(list);
  /* the artists first: a short shelf, and the old Music tab's whole job,
     which would be lost under a long night of listings */
  const acts = artists();
  if (acts.length) {
    const sec = section(root, 'Playing this week');
    sec.dataset.sec = 'artists';
    const box = el('div', 'artists');
    acts.forEach((x) => box.appendChild(artistRow(x.a, x.s)));
    root.appendChild(box);
  }
  meetsBlock('tonight');
  const head = section(root, 'Tonight', list.length ? '<b>' + esc(plural(list.length, 'thing', 'things')) + '</b> from 5 pm on' : null);
  head.dataset.sec = 'tonight';
  if (!S.events) root.appendChild(el('p', 'loading', 'Loading tonight…'));
  else if (!list.length) root.appendChild(el('p', 'note pad', esc('Nothing else tonight.')));
  const feed = el('div', 'feed');
  list.forEach((c) => put(feed, cards.event(c)));
  root.appendChild(feed);
  app.bindFeed(feed);
  root.appendChild(cards.caught({
    title: 'That’s all.',
    buttons: [openLink('Every event', EVENTS_URL, true)],
  }));
}

function artistRow(a, s) {
  const today = et(Date.now()).date;
  const day = s.date === today ? 'Tonight' : s.date === addDays(today, 1) ? 'Tomorrow' : dayFmt.format(utcNoon(s.date));
  const k = 'a-' + a.id;
  const wrap = el('div', 'artist');
  const r = el('div', 'lrow');
  r.dataset.k = k;
  const pic = a.bandcamp && a.bandcamp.art;
  const show = [s.venue, s.time, s.free ? 'Free' : trim(s.price, 24)].filter(Boolean).join(' · ');
  const why = a.why || (a.genre ? a.genre.charAt(0).toUpperCase() + a.genre.slice(1) : '');
  const name = /^https?:/i.test(s.url || '') ? '<a class="t" href="' + esc(safeHref(s.url)) + '" target="_blank" rel="noopener">' + esc(a.name) + '</a>' : '<div class="t">' + esc(a.name) + '</div>';
  r.innerHTML = (pic ? '<span class="th">' + art(pic) + '</span>' : '<span class="th bare">' + ICON.listen + '</span>') +
    '<div>' + name + '<div class="s"><b>' + esc(day) + '</b> · ' + esc(show) + '</div>' + (why ? '<div class="s">' + esc(why) + '</div>' : '') + '</div>';
  if (app.demo) r.querySelectorAll('a.t').forEach((x) => x.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the show’s page in the real build'); }));
  const album = a.bandcamp && /^\d+$/.test(String(a.bandcamp.album || '')) ? String(a.bandcamp.album) : '';
  if (album) {
    const b = el('button', 'pillbtn listen', ICON.play + ' Listen');
    b.setAttribute('aria-label', 'Listen to ' + a.name + ' on Bandcamp');
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => toggleBandcamp(wrap, b, a, album));
    r.appendChild(b);
  }
  wrap.appendChild(r);
  return wrap;
}

/* One Bandcamp player at a time, built on the tap, never playing until its
   own play button is pressed. Opening it pauses the shell's player; the
   shell playing anything resets it (registerForeign), so two things never
   sound at once. Bandcamp paints its own player, so it is told the theme. */
let embed = null;
function closeBandcamp() {
  if (!embed) return;
  embed.unreg();
  embed.box.remove();
  embed.btn.innerHTML = ICON.play + ' Listen';
  embed.btn.classList.remove('on');
  embed.btn.setAttribute('aria-expanded', 'false');
  embed = null;
}
function toggleBandcamp(wrap, btn, a, album) {
  const same = embed && embed.btn === btn;
  closeBandcamp();
  if (same) return;
  if (app.isPlaying()) app.stop();
  app.closeVideo();
  const doc = document.documentElement;
  const dark = doc.getAttribute('data-theme') === 'dark' || (!doc.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  const box = el('div', 'hero bc');
  if (app.demo) {
    box.appendChild(el('p', 'note', esc('Demo: no player.')));
  } else {
    const f = el('iframe', 'embed bandcamp');
    f.src = 'https://bandcamp.com/EmbeddedPlayer/album=' + encodeURIComponent(album) + '/size=large/bgcol=' + (dark ? '181a1f' : 'ffffff') +
      '/linkcol=' + (dark ? 'e8a33d' : '9a5b00') + '/artwork=small/transparent=true/';
    f.title = a.name + ' on Bandcamp';
    f.loading = 'lazy';
    box.appendChild(f);
  }
  wrap.appendChild(box);
  const unreg = app.registerForeign(() => closeBandcamp());
  embed = { box, btn, unreg };
  btn.innerHTML = ICON.x + ' Close';
  btn.classList.add('on');
  btn.setAttribute('aria-expanded', 'true');
}

/* ------------------------------------------------------------------ bits */
const panel = () => (root ? root.closest('.panel') : null);

/* An "Open ↗" link. Demo links go nowhere, and say so; the events page is ours. */
function openLink(label, href, ours) {
  const a = el('a', 'btn ghost sm', esc(label) + ' ' + ICON.ext);
  a.href = safeHref(href);
  if (!ours) { a.target = '_blank'; a.rel = 'noopener'; }
  if (app.demo && !ours) a.addEventListener('click', (e) => { e.preventDefault(); app.toast(label + ' opens in the real build'); });
  return a;
}

function stopReel() {
  if (!S.rolling) return;
  reel++;
  S.rolling = false;
  S.answer = null;
}

/* Spin and Missions are one view, so moving between them is a scroll;
   Tonight is the other view. */
const jumpMissions = () => { const s = root && root.querySelector('[data-sec="missions"]'); if (s) app.jumpTo(s); };
function setMode(mode) {
  const sameView = mode !== 'tonight' && S.mode !== 'tonight';
  if (!sameView) stopReel();
  S.mode = mode;
  history.replaceState(null, '', location.search + '#whatnow/' + mode);
  app.paintSubnav();
  if (!sameView) render();
  if (mode === 'missions') jumpMissions(); else app.scrollTop();
}

/* #whatnow/spin|missions|tonight picks the mode; #whatnow/m14 opens a
   mission in the list and flashes it; #whatnow/e-<id> a card tonight. */
function land() {
  if (!pending || !ready) return;
  const k = pending; pending = null;
  if (MODES.includes(k)) { if (S.mode !== k) setMode(k); return; }
  const want = /^m\d+$/.test(k) ? 'missions' : /^[ea]-/.test(k) ? 'tonight' : /^c-/.test(k) && S.mode === 'tonight' ? 'spin' : null;
  if (want && (S.mode !== want || (want === 'missions' && S.theme !== 'all'))) { stopReel(); S.mode = want; S.theme = 'all'; app.paintSubnav(); render(); }
  if (!app.flashHit(root, k)) app.toast(want === 'missions' ? 'That mission isn’t on the list any more.' : /^c-/.test(k) ? 'That challenge isn’t up this week.' : 'That one has passed.');
}

app.register(KEY, {
  label: 'What Now',
  icon: ICON.whatnow,
  promise: 'One answer for right now, over a hundred missions for later, and what is on tonight.',
  mount(r) {
    root = r;
    r.innerHTML = '<p class="loading">Reading the sky…</p>';
    loaded = load();
    loaded.then(() => {
      ready = true;
      render();
      if (app.activeTab() === KEY) app.paintSubnav();
      land();
      app.recount();
    }).catch(() => { r.innerHTML = '<div class="errbox"><b>What Now didn’t load.</b></div>'; });
  },
  activate(param) { pending = param || null; land(); paintSky(); skyTick(true); },
  refresh() { if (ready) render(); },
  deactivate() { stopReel(); closeBandcamp(); app.closePeek(); skyTick(false); },
  subnav() {
    if (!ready) return null;
    return chips([
      { key: 'spin', label: 'Spin', icon: ICON.shuffle },
      { key: 'missions', label: 'Missions', n: S.missions ? doneCount() + '/' + missions().length : null },
      { key: 'tonight', label: 'Tonight', n: S.events ? tonight().length : null },
    ], S.mode, (k) => { if (k !== S.mode) setMode(k); else if (k === 'missions') jumpMissions(); else app.scrollTop(true); });
  },
  /* Nothing here is a feed that grows while you are away, so the dot stays off. */
  newSince() { return 0; },
});
