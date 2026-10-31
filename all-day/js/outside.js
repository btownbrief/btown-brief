/* outside.js: what it's like out, from data/weather/latest.json, for the top
   of Town's Now and Body's Today. Pure functions, no DOM and no fetching.

   chips(w, now) is the temperature, the lake and the next sunrise or sunset.
   Each leaves itself out when the file doesn't have it or has gone stale, so
   a missing file is an empty list and the hero simply has fewer chips.

   bestHour(w, now) is the driest, calmest daylight hour left today, or
   tomorrow's once today has none. */

export const WEATHER_URL = '../data/weather/latest.json';
const TZ = 'America/New_York';
const HOUR = 3600000;
const NOW_FRESH = 3 * HOUR;     // an hours-old reading isn't "now"
const LAKE_FRESH = 24 * HOUR;
const AIR_LINE = 100;           // the index only earns a chip above this

const COPY = {
  temp: (n) => n + '°',
  lake: (n) => 'Lake ' + n + '°',
  sunset: (t) => 'Sunset ' + t,
  sunrise: (t) => 'Sunrise ' + t,
  best: (t) => 'Best hour ' + t,
  bestTomorrow: (t) => 'Best hour tomorrow ' + t,
  air: (n) => 'Air ' + n,
};

const when = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0; };
const fresh = (iso, now, ms) => { const t = when(iso); return !!t && now - t < ms; };
const CLOCK = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hourCycle: 'h12' });
const HOURLY = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h12' });
/* '5:44' */
const clock = (ms) => CLOCK.format(new Date(ms)).replace(/\s*[AP]M$/i, '');
/* '3 PM' */
const hourLabel = (ms) => HOURLY.format(new Date(ms)).replace(/\s+/, ' ');

function nextSun(sun, now) {
  const all = [['sunrise', COPY.sunrise], ['sunset', COPY.sunset], ['sunrise_tomorrow', COPY.sunrise], ['sunset_tomorrow', COPY.sunset]]
    .map(([k, word]) => [when(sun[k]), word]).filter(([t]) => t > now).sort((a, b) => a[0] - b[0]);
  return all.length ? all[0][1](clock(all[0][0])) : '';
}

export function chips(w, now = Date.now()) {
  if (!w || typeof w !== 'object') return [];
  const out = [];
  const n = w.now || {};
  if (Number.isFinite(n.temp_f) && fresh(n.observed_at, now, NOW_FRESH)) out.push(COPY.temp(Math.round(n.temp_f)));
  const g = w.lake_gage || {};
  if (Number.isFinite(g.water_temp_f) && fresh(g.water_temp_at, now, LAKE_FRESH)) out.push(COPY.lake(Math.round(g.water_temp_f)));
  const sun = w.sun ? nextSun(w.sun, now) : '';
  if (sun) out.push(sun);
  return out;
}

/* fewer is better: rain counts most, then wind, then cloud, then the cold */
const badness = (h) => (Number(h.pop) || 0) * 2 + (Number(h.wind_mph) || 0) * 1.5 + (Number(h.sky) || 0) * 0.05 + Math.max(0, 60 - (Number(h.temp_f) || 60)) * 0.2;

function pick(hours, from, to) {
  return hours.map((h) => ({ h, at: when(h.t) }))
    .filter((x) => x.at && x.at + HOUR > from && x.at + HOUR <= to)
    .sort((a, b) => badness(a.h) - badness(b.h) || a.at - b.at)[0] || null;
}

export function bestHour(w, now = Date.now()) {
  const hours = w && w.hourly && Array.isArray(w.hourly.hours) ? w.hourly.hours : [];
  const sun = (w && w.sun) || {};
  const rise = when(sun.sunrise), set = when(sun.sunset);
  const today = rise && set ? pick(hours, Math.max(now, rise), set) : null;
  if (today) return { at: today.at, tomorrow: false };
  const later = pick(hours, Math.max(now, when(sun.sunrise_tomorrow)), when(sun.sunset_tomorrow));
  return later ? { at: later.at, tomorrow: true } : null;
}

/* Body's two extras: the hour, and the air when it is worth saying */
export function moreChips(w, now = Date.now()) {
  const out = [];
  const best = bestHour(w, now);
  if (best) out.push((best.tomorrow ? COPY.bestTomorrow : COPY.best)(hourLabel(best.at)));
  const aqi = Number(w && w.air && w.air.aqi);
  if (aqi > AIR_LINE) out.push(COPY.air(Math.round(aqi)));
  return out;
}
