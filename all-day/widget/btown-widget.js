// Btown Brief: All Day on your home screen.
// A widget for the free Scriptable app (iPhone and iPad). Small, medium and
// large sizes, plus the lock screen.
//
// Setup: guide.btownbrief.com/all-day/widget/
//
// What it does: once every half hour or so (iOS decides), it reads one
// small public file, guide.btownbrief.com/all-day/data/widget.json, and
// draws it. That is the only request it makes. No account, no tracking, and
// nothing about you or your phone is sent anywhere. The last good copy is
// kept on this phone, so with no signal it shows that and says Offline.

const DATA_URL = 'https://guide.btownbrief.com/all-day/data/widget.json';
const APP_URL = 'https://guide.btownbrief.com/all-day/';
const CACHE_NAME = 'btown-brief-widget.json';
const TZ = 'America/New_York';
const OBS_MAX_AGE = 90 * 60000;         // the weather page's rule: older than this, use the forecast hour
const REFRESH_MS = 30 * 60000;

// All Day's Lake and Sunset palette (all-day/css/tokens.css)
const PAL = {
  lake: '#0E2A47',
  lakeDeep: '#081B30',
  ink: '#F7F4EE',
  muted: '#B9CDE0',
  sunset: '#F5B04B',
  green: '#3FAE7A',
  line: '#234563',
};

// ---------------------------------------------------------------- data

async function fetchData() {
  const req = new Request(DATA_URL);
  req.timeoutInterval = 12;
  const j = await req.loadJSON();
  if (!j || typeof j !== 'object' || !j.updated) throw new Error('not the widget file');
  return j;
}

function cachePath() {
  const fm = FileManager.local();
  return { fm, path: fm.joinPath(fm.documentsDirectory(), CACHE_NAME) };
}

function readCache() {
  try {
    const { fm, path } = cachePath();
    return fm.fileExists(path) ? JSON.parse(fm.readString(path)) : null;
  } catch (e) { return null; }
}

function writeCache(j) {
  try { const { fm, path } = cachePath(); fm.writeString(path, JSON.stringify(j)); } catch (e) { /* a full phone: draw anyway */ }
}

// The fresh file, or the last good copy marked offline, or nothing.
async function load() {
  try {
    const j = await fetchData();
    writeCache(j);
    return { data: j, offline: false };
  } catch (e) {
    return { data: readCache(), offline: true };
  }
}

// ------------------------------------------------------- time rules
// The file can be an hour or more old by the time it is drawn, so the
// rules that depend on the clock run again here.

const t = (iso) => { const n = Date.parse(iso); return isFinite(n) ? n : NaN; };

// Right now: the airport reading under 90 minutes old, else this hour's forecast.
function weatherNow(w, now) {
  if (!w) return null;
  const obs = w.obs;
  if (obs && obs.temp != null && now - t(obs.at) <= OBS_MAX_AGE) return { temp: obs.temp, sky: obs.sky || '' };
  const hour = (w.hours || []).find((h) => h && h.temp != null && t(h.t) + 3600000 > now);
  if (hour) return { temp: hour.temp, sky: hour.sky || '' };
  return w.temp != null ? { temp: w.temp, sky: w.sky || '' } : null;
}

// Tonight's picks still worth going to: not over, not started long ago.
function tonightNow(list, now) {
  return (list || []).filter((e) => {
    if (!e || !e.title) return false;
    const end = t(e.end);
    return isFinite(end) ? end > now : t(e.start) > now - 2 * 3600000;
  });
}

function gameNow(g, now) {
  return g && g.title && t(g.start) > now - 2.5 * 3600000 ? g : null;
}

function clock(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
    .replace(':00', '').replace(' AM', ' am').replace(' PM', ' pm');
}

function dayKey(ms) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });
}

function gameWhen(g, now) {
  const s = t(g.start);
  const d = dayKey(s);
  const day = d === dayKey(now) ? 'Today' : d === dayKey(now + 86400000) ? 'Tomorrow'
    : new Date(s).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' });
  return g.all_day ? day : day + ' ' + clock(s);
}

function skySymbol(sky, now) {
  const s = String(sky || '').toLowerCase();
  const hour = Number(new Date(now).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false })) % 24;
  const night = hour < 7 || hour >= 18;
  if (/thunder/.test(s)) return 'cloud.bolt.rain.fill';
  if (/snow|flurr|sleet|ice/.test(s)) return 'cloud.snow.fill';
  if (/rain|shower|drizzle/.test(s)) return 'cloud.rain.fill';
  if (/fog|haze|smoke/.test(s)) return 'cloud.fog.fill';
  if (/partly|mostly sunny|mostly clear/.test(s)) return night ? 'cloud.moon.fill' : 'cloud.sun.fill';
  if (/cloud|overcast/.test(s)) return 'cloud.fill';
  return night ? 'moon.stars.fill' : 'sun.max.fill';
}

// ------------------------------------------------------------ drawing

const col = (hex) => new Color(hex);

function text(parent, str, size, weight, color, lines) {
  const x = parent.addText(String(str));
  x.font = weight === 'heavy' ? Font.heavySystemFont(size)
    : weight === 'bold' ? Font.boldSystemFont(size)
      : weight === 'semibold' ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  x.textColor = col(color || PAL.ink);
  if (lines) x.lineLimit = lines;
  return x;
}

function eyebrow(parent, str) {
  return text(parent, String(str).toUpperCase(), 10, 'bold', PAL.sunset, 1);
}

function glyph(parent, sky, now, size) {
  if (typeof SFSymbol === 'undefined') return;
  const sym = SFSymbol.named(skySymbol(sky, now));
  if (!sym || !sym.image) return;
  const img = parent.addImage(sym.image);
  img.imageSize = new Size(size, size);
  img.tintColor = col(PAL.sunset);
}

function stamp(parent, data, offline, now) {
  const at = t(data && data.updated);
  // a copy from another day says which day
  const when = !isFinite(at) ? '' : (dayKey(at) === dayKey(now) ? '' : new Date(at).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' }) + ' ') + clock(at);
  const label = offline ? 'Offline' + (when ? ' · ' + when : '') : when ? 'Updated ' + when : '';
  if (label) text(parent, label, 9, offline ? 'semibold' : 'regular', offline ? PAL.sunset : PAL.muted, 1);
}

function header(parent, data, offline, now, withStamp) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  text(row, 'All Day', 12, 'heavy', PAL.sunset, 1);
  if (withStamp) { row.addSpacer(); stamp(row, data, offline, now); }
  return row;
}

function hiLo(w) {
  const bits = [];
  if (w.hi != null) bits.push('H ' + w.hi + '°');
  if (w.lo != null) bits.push('L ' + w.lo + '°');
  return bits.join('  ');
}

function base(url) {
  const w = new ListWidget();
  const g = new LinearGradient();
  g.colors = [col(PAL.lake), col(PAL.lakeDeep)];
  g.locations = [0, 1];
  g.startPoint = new Point(0, 0);
  g.endPoint = new Point(1, 1);
  w.backgroundGradient = g;
  w.setPadding(14, 14, 14, 14);
  w.url = url;
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MS);
  return w;
}

function weatherBlock(parent, w, cur, now, big) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.spacing = 6;
  glyph(row, cur.sky, now, big ? 30 : 22);
  text(row, cur.temp + '°', big ? 40 : 30, 'heavy', PAL.ink, 1);
  if (w.link) row.url = w.link;
  return row;
}

function headline(parent, h, size, lines) {
  const s = parent.addStack();
  s.layoutVertically();
  if (h.link) s.url = h.link;
  text(s, h.title, size, 'semibold', PAL.ink, lines);
  return s;
}

function tonightRow(parent, e, size) {
  const s = parent.addStack();
  s.layoutHorizontally();
  s.spacing = 6;
  if (e.link) s.url = e.link;
  text(s, e.time, size, 'bold', PAL.sunset, 1);
  text(s, e.title + (e.venue ? ' · ' + e.venue : ''), size, 'regular', PAL.ink, 1);
  return s;
}

function emptyWidget(now) {
  const w = base(APP_URL);
  header(w, null, true, now, false);
  w.addSpacer();
  text(w, 'Offline', 16, 'bold', PAL.ink, 1);
  w.addSpacer();
  return w;
}

function small(data, offline, now) {
  const w0 = data.weather;
  const cur = weatherNow(w0, now);
  const pick = tonightNow(data.tonight, now)[0];
  const head = !pick && (data.wire || [])[0];
  const w = base(pick ? pick.link || APP_URL + '#whatnow/tonight' : head ? head.link || APP_URL : APP_URL);
  header(w, data, offline, now, false);
  if (cur) {
    w.addSpacer(4);
    weatherBlock(w, w0, cur, now, false);
    text(w, [cur.sky, hiLo(w0)].filter(Boolean).join(' · '), 11, 'regular', PAL.muted, 1);
  }
  w.addSpacer();
  if (pick) {
    eyebrow(w, 'Tonight');
    text(w, pick.title, 13, 'semibold', PAL.ink, 2);
    text(w, pick.time + (pick.venue ? ' · ' + pick.venue : ''), 10, 'regular', PAL.muted, 1);
  } else if (head) {
    eyebrow(w, 'The Wire');
    text(w, head.title, 12, 'semibold', PAL.ink, 3);
  } else if (w0 && w0.rain) {
    text(w, w0.rain, 11, 'regular', PAL.ink, 2);
  }
  if (offline) stamp(w, data, offline, now);
  return w;
}

function medium(data, offline, now) {
  const w0 = data.weather;
  const cur = weatherNow(w0, now);
  const w = base(APP_URL);
  const row = w.addStack();
  row.layoutHorizontally();
  row.topAlignContent();

  const left = row.addStack();
  left.layoutVertically();
  left.size = new Size(104, 0);
  header(left, data, offline, now, false);
  if (cur) {
    left.addSpacer(4);
    weatherBlock(left, w0, cur, now, false);
    text(left, cur.sky, 11, 'regular', PAL.muted, 1);
    if (hiLo(w0)) text(left, hiLo(w0), 11, 'semibold', PAL.ink, 1);
    if (w0.rain) { left.addSpacer(3); text(left, w0.rain, 10, 'regular', PAL.muted, 2); }
  }
  left.addSpacer();
  stamp(left, data, offline, now);

  row.addSpacer(12);
  const right = row.addStack();
  right.layoutVertically();
  right.spacing = 4;
  const picks = tonightNow(data.tonight, now);
  const heads = (data.wire || []).slice(0, picks.length ? 2 : 3);
  if (heads.length) {
    const top = right.addStack();
    top.layoutVertically();
    top.spacing = 4;
    top.url = APP_URL + '#wire';
    eyebrow(top, 'The Wire');
    heads.forEach((h) => headline(top, h, 12, 2));
  }
  right.addSpacer();
  if (picks.length) {
    eyebrow(right, 'Tonight');
    tonightRow(right, picks[0], 11);
  }
  return w;
}

function large(data, offline, now) {
  const w0 = data.weather;
  const cur = weatherNow(w0, now);
  const w = base(APP_URL);
  header(w, data, offline, now, true);
  w.addSpacer(6);
  if (cur) {
    const row = w.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    weatherBlock(row, w0, cur, now, true);
    row.addSpacer(12);
    const side = row.addStack();
    side.layoutVertically();
    text(side, cur.sky, 13, 'semibold', PAL.ink, 1);
    if (hiLo(w0)) text(side, hiLo(w0), 12, 'regular', PAL.muted, 1);
    if (w0.rain) text(side, w0.rain, 12, 'regular', PAL.muted, 2);
    if (w0.link) side.url = w0.link;
    w.addSpacer(8);
  }

  const heads = (data.wire || []).slice(0, 3);
  if (heads.length) {
    const box = w.addStack();
    box.layoutVertically();
    box.spacing = 4;
    box.url = APP_URL + '#wire';
    eyebrow(box, 'The Wire');
    heads.forEach((h) => {
      const s = headline(box, h, 13, 2);
      if (h.src) text(s, h.src, 10, 'regular', PAL.muted, 1);
    });
    w.addSpacer(8);
  }

  const picks = tonightNow(data.tonight, now).slice(0, 2);
  if (picks.length) {
    const box = w.addStack();
    box.layoutVertically();
    box.spacing = 4;
    box.url = APP_URL + '#whatnow/tonight';
    eyebrow(box, 'Tonight');
    picks.forEach((e) => tonightRow(box, e, 12));
    w.addSpacer(8);
  }

  const g = gameNow(data.game, now);
  if (g) {
    const box = w.addStack();
    box.layoutVertically();
    box.spacing = 2;
    if (g.link) box.url = g.link;
    eyebrow(box, 'Next game');
    text(box, g.title, 12, 'semibold', PAL.ink, 1);
    text(box, [gameWhen(g, now), g.home ? 'Home' : 'Away', g.tv].filter(Boolean).join(' · '), 11, 'regular', PAL.muted, 1);
  }
  w.addSpacer();
  return w;
}

// The lock screen: a temperature, and on the wide one tonight's first pick.
function accessory(data, family, offline, now) {
  const w = new ListWidget();
  w.url = APP_URL;
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MS);
  const cur = weatherNow(data.weather, now);
  const temp = cur ? cur.temp + '°' : '–';
  if (family === 'accessoryCircular') {
    w.addSpacer();
    const x = w.addText(temp); x.font = Font.boldSystemFont(18); x.centerAlignText();
    w.addSpacer();
    return w;
  }
  if (family === 'accessoryInline') {
    w.addText(cur ? temp + ' ' + cur.sky : 'All Day');
    return w;
  }
  const a = w.addText(cur ? temp + ' ' + cur.sky : 'All Day'); a.font = Font.boldSystemFont(14); a.lineLimit = 1;
  const pick = tonightNow(data.tonight, now)[0];
  const line = pick ? pick.time + ' ' + pick.title : data.weather && data.weather.rain;
  if (line) { const b = w.addText(line); b.font = Font.systemFont(12); b.lineLimit = 2; }
  if (offline) { const c = w.addText('Offline'); c.font = Font.systemFont(10); }
  return w;
}

function build(data, family, offline, now) {
  now = now || Date.now();
  if (!data) return /^accessory/.test(family || '') ? accessory({}, family, true, now) : emptyWidget(now);
  if (/^accessory/.test(family || '')) return accessory(data, family, offline, now);
  if (family === 'large' || family === 'extraLarge') return large(data, offline, now);
  if (family === 'medium') return medium(data, offline, now);
  return small(data, offline, now);
}

async function main() {
  const { data, offline } = await load();
  const family = config.runsInWidget ? config.widgetFamily : 'medium';
  const widget = build(data, family, offline, Date.now());
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
  Script.complete();
}

// for the tests in the repo, which run this file under a stand-in for Scriptable
if (typeof module !== 'undefined' && module) module.exports = { build, load, weatherNow, tonightNow, gameNow, gameWhen, clock, skySymbol, main };
if (typeof __BTOWN_NO_MAIN__ === 'undefined') await main();
