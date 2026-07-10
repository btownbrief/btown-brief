/* ============================================================
   FOOD & DRINK — shared engine
   Hours math, open-now logic, deal matching. All times are
   America/New_York; hours use 24h "HH:MM" strings. A closing
   time earlier than its opening time means it crosses midnight.
   Loaded before restaurants.js / deals.js.
============================================================ */
window.BTFood = (function () {
  'use strict';

  const TZ = 'America/New_York';
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAY_LABELS = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };

  // Church Street Marketplace center — anchor for "walkable"
  const CHURCH_ST = [44.4758, -73.2128];
  const WALKABLE_MILES = 0.55;

  /* Only http(s) links from scraped data may become hrefs. */
  function safeUrl(u) {
    if (!u) return null;
    try {
      const parsed = new URL(u, location.href);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : null;
    } catch { return null; }
  }

  async function fetchJSON(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
    return res.json();
  }

  /* --- "now" in Burlington, regardless of viewer's timezone --- */
  function now() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, weekday: 'short', hour: 'numeric', minute: 'numeric',
      hour12: false, year: 'numeric', month: 'numeric', day: 'numeric',
    }).formatToParts(new Date());
    const get = (t) => parts.find(p => p.type === t)?.value;
    const dayIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    const hour = Number(get('hour')) % 24;
    const minute = Number(get('minute'));
    return {
      day: DAYS[dayIdx],
      dayIdx,
      minutes: hour * 60 + minute,  // minutes since midnight, local Burlington
      dateStr: `${get('year')}-${String(get('month')).padStart(2, '0')}-${String(get('day')).padStart(2, '0')}`,
    };
  }

  function toMin(hhmm) {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }

  function fmtTime(hhmm) {
    let [h, m] = hhmm.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return m ? `${h}:${String(m).padStart(2, '0')} ${ampm}` : `${h} ${ampm}`;
  }

  function prevDay(day) { return DAYS[(DAYS.indexOf(day) + 6) % 7]; }
  function nextDay(day) { return DAYS[(DAYS.indexOf(day) + 1) % 7]; }

  /* A window [open, close] on `day`; close < open ⇒ spills past midnight. */
  function windowsFor(hours, day) {
    return (hours && hours[day]) || [];
  }

  /* Is the place open at `minutes` on `day`? Checks today's windows and
     yesterday's windows that cross midnight. */
  function isOpenAt(hours, day, minutes) {
    for (const [o, c] of windowsFor(hours, day)) {
      const om = toMin(o), cm = toMin(c);
      if (cm > om ? (minutes >= om && minutes < cm) : (minutes >= om)) return true;
    }
    for (const [o, c] of windowsFor(hours, prevDay(day))) {
      const om = toMin(o), cm = toMin(c);
      if (cm <= om && minutes < cm) return true; // spillover window still open
    }
    return false;
  }

  /* Closing time (as "HH:MM") of the window active right now, or null. */
  function closingTime(hours, day, minutes) {
    for (const [o, c] of windowsFor(hours, day)) {
      const om = toMin(o), cm = toMin(c);
      if (cm > om ? (minutes >= om && minutes < cm) : (minutes >= om)) return c;
    }
    for (const [o, c] of windowsFor(hours, prevDay(day))) {
      const om = toMin(o), cm = toMin(c);
      if (cm <= om && minutes < cm) return c;
    }
    return null;
  }

  /* Next opening: scans up to 7 days forward. Returns {day, time} or null. */
  function nextOpening(hours, day, minutes) {
    for (let i = 0; i < 8; i++) {
      const d = DAYS[(DAYS.indexOf(day) + i) % 7];
      for (const [o] of windowsFor(hours, d)) {
        const om = toMin(o);
        if (i > 0 || om > minutes) return { day: d, time: o, daysAhead: i };
      }
    }
    return null;
  }

  /* Human status line: "Open · closes 10 PM" / "Closed · opens 11 AM" /
     "Closed · opens 8 AM Saturday" / "Hours unknown" */
  function statusLine(hours, t) {
    if (!hours || !Object.keys(hours).length) return { open: null, text: 'Hours unverified' };
    if (isOpenAt(hours, t.day, t.minutes)) {
      const c = closingTime(hours, t.day, t.minutes);
      const cm = toMin(c);
      const minsLeft = cm > t.minutes ? cm - t.minutes : (1440 - t.minutes) + cm;
      const soon = minsLeft <= 60;
      return { open: true, closingSoon: soon, text: soon ? `Closes soon · ${fmtTime(c)}` : `Open · closes ${fmtTime(c)}` };
    }
    const nx = nextOpening(hours, t.day, t.minutes);
    if (!nx) return { open: false, text: 'Closed' };
    const when = nx.daysAhead === 0 ? '' : nx.daysAhead === 1 ? ' tomorrow' : ` ${DAY_LABELS[nx.day]}`;
    return { open: false, text: `Closed · opens ${fmtTime(nx.time)}${when}` };
  }

  /* Latest close tonight (for Open Late): the close time of any window that
     starts today, expressed in minutes where past-midnight adds 1440. */
  function latestCloseTonight(hours, day) {
    let latest = null;
    for (const [o, c] of windowsFor(hours, day)) {
      const om = toMin(o), cm = toMin(c);
      const eff = cm > om ? cm : cm + 1440;
      if (latest === null || eff > latest) latest = eff;
    }
    return latest; // e.g. 23:00 → 1380; 1:00 AM → 1500; null if closed today
  }

  /* Kitchen close tonight in effective minutes, using kitchen_close map
     when known, else null (unknown ≠ closed). */
  function kitchenCloseTonight(r, day) {
    const kc = r.kitchen_close && r.kitchen_close[day];
    if (!kc) return null;
    // A kitchen can't be serving on a day the place isn't open at all
    // (unless we have no hours data to judge by).
    if (r.hours && Object.keys(r.hours).length && !windowsFor(r.hours, day).length) return null;
    const m = toMin(kc);
    return m < 360 ? m + 1440 : m; // before 6 AM ⇒ past midnight
  }

  function haversineMiles(a, b) {
    const R = 3958.8, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function walkableFromChurchSt(r) {
    return !!r.coords && haversineMiles(r.coords, CHURCH_ST) <= WALKABLE_MILES;
  }

  /* --- Deals --- */
  function dealAppliesToday(deal, t) {
    return !deal.days || deal.days.includes(t.day);
  }

  /* Happy hour live right now. Untimed deals are "applies today", never
     "live" — only an explicit all_day flag or a real window counts. Windows
     that cross midnight also match in the early hours of the NEXT day. */
  function dealLiveNow(deal, t) {
    const s = toMin(deal.start), e = toMin(deal.end);
    if (deal.all_day) return dealAppliesToday(deal, t);
    if (s === null || e === null) return false;
    if (e > s) return dealAppliesToday(deal, t) && t.minutes >= s && t.minutes < e;
    // overnight window: before midnight it belongs to today, after to yesterday
    if (t.minutes >= s) return dealAppliesToday(deal, t);
    if (t.minutes < e) return !deal.days || deal.days.includes(prevDay(t.day));
    return false;
  }

  function dealTimeLabel(deal) {
    if (deal.all_day) return 'All day';
    if (deal.start && deal.end) return `${fmtTime(deal.start)}–${fmtTime(deal.end)}`;
    return '';
  }

  function dealDaysLabel(deal) {
    if (!deal.days || deal.days.length === 7) return 'Every day';
    const idx = deal.days.map(d => DAYS.indexOf(d)).sort((a, b) => a - b);
    // Render contiguous runs as ranges: Mon–Fri
    const short = (i) => DAYS[i][0].toUpperCase() + DAYS[i].slice(1, 3);
    const runs = [];
    let start = idx[0], prev = idx[0];
    for (let i = 1; i <= idx.length; i++) {
      if (i < idx.length && idx[i] === prev + 1) { prev = idx[i]; continue; }
      runs.push(start === prev ? short(start) : `${short(start)}–${short(prev)}`);
      if (i < idx.length) { start = idx[i]; prev = idx[i]; }
    }
    return runs.join(', ');
  }

  /* Months since "YYYY-MM" */
  function monthsSince(ym, t) {
    if (!ym) return null;
    const [y, m] = ym.split('-').map(Number);
    const [ty, tm] = t.dateStr.split('-').map(Number);
    return (ty - y) * 12 + (tm - m);
  }

  /* "Expired" reports queue in localStorage + prefilled mailto */
  const REPORT_KEY = 'bt-deal-reports';
  function getReports() {
    try { return JSON.parse(localStorage.getItem(REPORT_KEY) || '{}'); } catch { return {}; }
  }
  function reportExpired(deal) {
    const q = getReports();
    q[deal.id] = { at: new Date().toISOString(), business: deal.business, title: deal.title };
    localStorage.setItem(REPORT_KEY, JSON.stringify(q));
    const subj = encodeURIComponent(`[Deals] Expired: ${deal.business} — ${deal.title}`);
    const body = encodeURIComponent(
      `Reporting this deal as expired/changed:\n\n` +
      `Business: ${deal.business}\nDeal: ${deal.title}\n` +
      `Last verified: ${deal.last_verified || 'unknown'}\nDeal id: ${deal.id}\n\n(Sent from the deals page.)`
    );
    return `mailto:stephenvdavis@gmail.com?subject=${subj}&body=${body}`;
  }

  return {
    TZ, DAYS, DAY_LABELS, fetchJSON, safeUrl, now, toMin, fmtTime,
    isOpenAt, closingTime, nextOpening, statusLine, latestCloseTonight,
    kitchenCloseTonight, walkableFromChurchSt, haversineMiles,
    dealAppliesToday, dealLiveNow, dealTimeLabel, dealDaysLabel,
    monthsSince, getReports, reportExpired, prevDay, nextDay,
  };
})();
