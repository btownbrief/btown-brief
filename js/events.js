/* ============================================================
   EVENTS PAGE — time-aware lenses, picks, sticky day strip,
   a time-railed list, chips for filters, month + map views.
   Data: data/events/events.json (built by scripts/events/update.py)
         data/weather/latest.json (for the header weather chip)
   All "what day / what hour is it" logic runs in Burlington time
   (America/New_York), whatever timezone the visitor is in.
============================================================ */
(function () {
  'use strict';

  const CATEGORY_LABELS = {
    'music': 'Live music', 'comedy': 'Comedy', 'theater': 'Theater & dance',
    'art': 'Art', 'film': 'Film', 'food-drink': 'Food & drink',
    'outdoors': 'Outdoors', 'sports': 'Sports', 'family': 'Family & kids',
    'community': 'Community', 'learning': 'Talks & classes', 'market': 'Markets & fairs',
    'games': 'Trivia & games', 'wellness': 'Wellness', 'words': 'Books & words',
    'other': 'Other',
  };
  const CAT_ORDER = ['music', 'comedy', 'food-drink', 'family', 'outdoors', 'market', 'art',
    'theater', 'film', 'games', 'words', 'learning', 'community', 'wellness', 'sports', 'other'];
  const WHENS = ['all', 'today', 'tomorrow', 'weekend', 'week', 'twoweeks', 'month', 'day'];

  /* Quick filters: multi-select toggles. Each is a plain predicate. */
  const QUICK = [
    { key: 'free',     label: 'Free',       test: (e) => e.free === true },
    { key: 'under15',  label: 'Under $15',  test: (e) => e.free === true || (e.minPrice != null && e.minPrice < 15) },
    { key: 'kids',     label: 'Kids',       test: (e) => e.category === 'family' || hasTag(e, 'kids') || hasTag(e, 'family') || hasTag(e, 'teens') },
    { key: 'outdoors', label: 'Outside',    test: (e) => e.indoorOutdoor === 'outdoor' || e.category === 'outdoors' },
    { key: 'social',   label: 'Social',     test: (e) => hasTag(e, 'social'), title: 'Showing up alone is normal' },
    { key: 'oneoff',   label: 'One-offs',   test: (e) => !hasTag(e, 'series'), title: 'Hide the weekly regulars (trivia, karaoke, open mics)' },
  ];
  const QUICK_BY_KEY = Object.fromEntries(QUICK.map((q) => [q.key, q]));

  const state = {
    events: [],          // active events, hydrated
    ongoing: [],         // long-running exhibits/series (tag "ongoing")
    byId: new Map(),
    meta: null,
    view: 'list',
    daysShown: 7,
    map: null,
    mapLayer: null,
    openId: null,
    // soon = starting in the next 2 hours; evening = 4pm or later (the "tonight" lens)
    filters: { when: 'all', day: null, q: '', cat: '', town: '', quick: new Set(), soon: false, evening: false },
  };

  /* ---------------- utilities ---------------- */

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function hasTag(e, t) { return (e.tags || []).includes(t); }

  /* Only http(s) links leave this page. Feed data is aggregated from 25+
     outside calendars, so a URL field is not trusted just because it exists. */
  function safeUrl(u) {
    if (!u) return '';
    try {
      const x = new URL(String(u).trim(), location.href);
      return (x.protocol === 'http:' || x.protocol === 'https:') ? x.href : '';
    } catch (e) { return ''; }
  }

  /* ---- Burlington time ---- */
  const TZ = 'America/New_York';
  const PARTS_FMT = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const DOW_IDX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  /* Calendar parts of an instant, as seen in Burlington. */
  function nyParts(d) {
    const o = {};
    PARTS_FMT.formatToParts(d).forEach((p) => { o[p.type] = p.value; });
    return {
      y: +o.year, mo: +o.month - 1, d: +o.day, h: (+o.hour) % 24, min: +o.minute,
      dow: DOW_IDX[o.weekday], key: `${o.year}-${o.month}-${o.day}`,
    };
  }
  /* Calendar facts about a YYYY-MM-DD key — no timezone involved. */
  function kparts(k) {
    const [y, m, d] = k.split('-').map(Number);
    return { y, mo: m - 1, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
  }
  function keyOf(y, mo, d) { return `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
  function addDaysKey(k, n) {
    const { y, mo, d } = kparts(k);
    const x = new Date(Date.UTC(y, mo, d + n));
    return keyOf(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  }
  function dkey(d) { return nyParts(d).key; }

  function fmtHM(h24, m) {
    const h = h24 % 12 || 12;
    const ap = h24 < 12 ? 'AM' : 'PM';
    return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`;
  }
  function fmtTime(d) { const p = nyParts(d); return fmtHM(p.h, p.min); }
  function fmtRange(e) {
    if (e.allDay) return 'All day';
    const s = fmtHM(e._h, e._m);
    if (!e._end || e._end <= e._start) return s;
    const ep = nyParts(e._end);
    const endStr = fmtHM(ep.h, ep.min);
    const sap = e._h < 12 ? 'AM' : 'PM', eap = ep.h < 12 ? 'AM' : 'PM';
    if (sap === eap && ep.key === e.date) return `${s.replace(' ' + sap, '')}–${endStr}`;   // "7–9:30 PM"
    return `${s} – ${endStr}`;
  }

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  function relDay(k, todayKey, tomorrowKey) {
    if (k === todayKey) return 'Today';
    if (k === tomorrowKey) return 'Tomorrow';
    const p = kparts(k);
    return `${DAY_SHORT[p.dow]} ${p.d}`;
  }
  function longDay(k) { const p = kparts(k); return `${DAY_NAMES[p.dow]}, ${MON_NAMES[p.mo]} ${p.d}`; }
  function shortDay(k) { const p = kparts(k); return `${DAY_SHORT[p.dow]} ${MON_NAMES[p.mo]} ${p.d}`; }

  /* Short, scannable price. Simple strings ("$20", "$17-23") are shown as-is
     in whole dollars; anything multi-tier falls back to the pipeline's
     minPrice as "From $x"; prose with no number shows "$" (or the short phrase). */
  function shortPrice(e) {
    if (e.free === true) return { text: 'Free', cls: 'is-free' };
    const p = (e.price || '').trim();
    const whole = (n) => String(Math.round(parseFloat(n)));
    const simple = p.match(/^\$?\s?(\d+(?:\.\d{1,2})?)(?:\s?(?:-|–|—|to)\s?\$?\s?(\d+(?:\.\d{1,2})?))?\.?$/);
    if (simple) return { text: simple[2] ? `$${whole(simple[1])}–${whole(simple[2])}` : `$${whole(simple[1])}`, cls: '' };
    if (e.minPrice != null && e.minPrice > 0) return { text: `From $${whole(e.minPrice)}`, cls: '' };
    if (!p) return { text: '', cls: 'is-unknown' };
    if (/\$\s?\d/.test(p)) return { text: '$', cls: 'is-unknown' };
    return { text: p.length <= 12 ? p.replace(/\.$/, '') : '$', cls: 'is-unknown' };
  }

  function pickKind(e) {
    const s = e.signals || {};
    if (s.own_group) return 'own';
    if (s.staff_pick) return '7d';
    return null;
  }

  /* ---------------- data load ---------------- */

  async function load() {
    let payload;
    try {
      const res = await fetch('data/events/events.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      payload = await res.json();
    } catch (e) {
      $('ev-loading').textContent =
        'The calendar hasn’t collected its first data yet. Check back soon.';
      return;
    }
    state.meta = payload;
    const active = (payload.events || [])
      .filter((e) => e.status === 'active' && e.start && e.date)
      .map((e) => {
        e._start = new Date(e.start);
        e._end = e.end ? new Date(e.end) : null;
        const p = nyParts(e._start);
        e._h = p.h; e._m = p.min;
        e._search = `${e.title} ${e.venue || ''} ${e.town || ''} ${e.description || ''}`.toLowerCase();
        return e;
      });
    state.ongoing = active.filter((e) => hasTag(e, 'ongoing'));
    state.events = active.filter((e) => !hasTag(e, 'ongoing'));
    state.events.forEach((e) => state.byId.set(e.id, e));
    $('ev-loading').hidden = true;
    if (payload.generated) {
      const g = nyParts(new Date(payload.generated));
      $('ev-generated').textContent =
        `Calendar refreshed ${MON_NAMES[g.mo]} ${g.d}, ${fmtHM(g.h, g.min)}`;
    }
    initTowns();
    readParams();
    const deep = state.openId;
    renderHero();
    renderPicks();
    setView(state.view);
    renderAll();
    if (deep) openEvent(deep, { scroll: true });
  }

  function loadWeather() {
    fetch('data/weather/latest.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((w) => {
        if (!w || !w.now || typeof w.now.temp_f !== 'number') return;
        const desc = (w.now.description || '').toLowerCase();
        const icon = /thunder/.test(desc) ? '⛈' : /rain|shower|drizzle/.test(desc) ? '🌧'
          : /snow|flurr/.test(desc) ? '❄' : /fog|haze|mist|smoke/.test(desc) ? '🌫'
          : /cloud|overcast/.test(desc) ? '☁' : '☀';
        let sunBit = '';
        const now = new Date();
        if (w.sun && w.sun.sunset) {
          const ss = new Date(w.sun.sunset);
          if (now < ss) sunBit = `sunset ${fmtTime(ss)}`;
          else if (w.sun.sunrise_tomorrow) sunBit = `sunrise ${fmtTime(new Date(w.sun.sunrise_tomorrow))}`;
        }
        const el = $('ev-wx');
        el.innerHTML = `<span aria-hidden="true">${icon}</span><b>${Math.round(w.now.temp_f)}°</b>` +
          `<span>${esc(w.now.description || '')}</span>` +
          (sunBit ? `<span class="ev-wx-sep">·</span><span>${esc(sunBit)}</span>` : '');
        el.hidden = false;
      })
      .catch(() => {});
  }

  /* ---------------- time helpers ---------------- */

  function nowCtx() {
    const now = new Date();
    const np = nyParts(now);
    const todayKey = np.key;
    const late = np.h >= 22;                    // after 10pm: pivot to tomorrow
    const refKey = late ? addDaysKey(todayKey, 1) : todayKey;
    const evening = np.h >= 16;
    const dayWord = late ? 'tomorrow' : (evening ? 'tonight' : 'today');
    return { now, np, todayKey, tomorrowKey: addDaysKey(todayKey, 1), late, refKey, evening, dayWord };
  }

  /* An event with no end time is assumed to run ~2 hours. */
  function endOf(e) { return e._end && e._end > e._start ? e._end : new Date(+e._start + 2 * 3600e3); }
  /* Still worth listing today: all-day, or not over yet. */
  function stillOn(e, now) { return e.allDay || endOf(e) > now; }
  function isLive(e, now) { return !e.allDay && e._start <= now && endOf(e) > now; }

  /* ---------------- hero: right-now lenses ---------------- */

  function lensDefs() {
    const c = nowCtx();
    const onRef = state.events.filter((e) => e.date === c.refKey);
    const alive = onRef.filter((e) => stillOn(e, c.now));
    // "tonight" = 4pm-or-later starts (or all-day) once we're into the evening;
    // earlier in the day it's simply everything still on. Same rule as the
    // `evening` filter, so the count and the click agree.
    const useEvening = c.evening && !c.late;
    const tonight = useEvening ? alive.filter((e) => e.allDay || e._h >= 16) : alive;
    const in2h = c.late ? [] : onRef.filter((e) => !e.allDay &&
      e._start >= c.now && e._start <= new Date(+c.now + 2 * 3600e3));
    const base = { soon: false, evening: useEvening, cat: '', quick: [] };
    const defs = [
      { key: 'tonight', label: c.late ? 'tomorrow' : (c.evening ? 'tonight' : 'today'), list: tonight, want: { ...base } },
      { key: 'soon', label: 'starting soon', list: in2h, want: { ...base, evening: false, soon: true } },
      { key: 'free', label: `free ${c.dayWord}`, list: tonight.filter(QUICK_BY_KEY.free.test), want: { ...base, quick: ['free'] } },
      { key: 'music', label: 'live music', list: alive.filter((e) => e.category === 'music'), want: { ...base, evening: false, cat: 'music' } },
      { key: 'social', label: 'social', list: alive.filter(QUICK_BY_KEY.social.test), want: { ...base, evening: false, quick: ['social'] } },
      { key: 'outdoors', label: 'outside', list: alive.filter(QUICK_BY_KEY.outdoors.test), want: { ...base, evening: false, quick: ['outdoors'] } },
      { key: 'under15', label: 'under $15', list: tonight.filter(QUICK_BY_KEY.under15.test), want: { ...base, quick: ['under15'] } },
    ];
    return { defs: defs.filter((d) => d.list.length > 0), ctx: c, tonightCount: tonight.length };
  }

  function renderHero() {
    const { defs, ctx, tonightCount } = lensDefs();
    const h = ctx.np.h;
    $('ev-hero-sub').textContent =
      `${DAY_NAMES[ctx.np.dow]} ${h >= 17 ? 'evening' : h >= 12 ? 'afternoon' : 'morning'} in Burlington` +
      (tonightCount ? ` · ${tonightCount} things ${ctx.dayWord}` : '');

    const wrap = $('ev-now');
    wrap.innerHTML = '';
    if (!defs.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    wrap.insertAdjacentHTML('beforeend', '<span class="ev-now-label">Right now</span>');
    defs.forEach((d) => {
      const btn = document.createElement('button');
      btn.className = 'ev-now-chip';
      btn.type = 'button';
      btn.setAttribute('role', 'listitem');
      btn.dataset.lens = d.key;
      btn.innerHTML = `<b>${d.list.length}</b><span>${esc(d.label)}</span>`;
      btn.addEventListener('click', () => {
        resetFilters();
        const f = state.filters;
        f.when = 'day'; f.day = ctx.refKey;
        f.soon = d.want.soon; f.evening = d.want.evening; f.cat = d.want.cat;
        f.quick = new Set(d.want.quick);
        setView('list');
        renderAll();
        $('ev-bar').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      wrap.appendChild(btn);
    });
    syncLensChips(defs, ctx);
  }

  function syncLensChips(defs, ctx) {
    const f = state.filters;
    const chips = document.querySelectorAll('.ev-now-chip');
    if (!defs) { chips.forEach((b) => b.setAttribute('aria-pressed', 'false')); return; }
    const byKey = Object.fromEntries(defs.map((d) => [d.key, d]));
    chips.forEach((b) => {
      const d = byKey[b.dataset.lens];
      let on = !!d && f.when === 'day' && f.day === ctx.refKey && !f.q && !f.town;
      if (on) {
        const q = [...f.quick].sort().join(',');
        on = f.soon === d.want.soon && f.evening === d.want.evening && f.cat === d.want.cat &&
          q === d.want.quick.slice().sort().join(',');
      }
      b.setAttribute('aria-pressed', String(on));
    });
  }

  /* ---------------- picks ---------------- */

  function renderPicks() {
    const c = nowCtx();
    const hi = addDaysKey(c.todayKey, 13);
    const picks = state.events
      .filter((e) => pickKind(e) && e.date >= c.todayKey && e.date <= hi && (e.date !== c.todayKey || stillOn(e, c.now)))
      .sort((a, b) => a._start - b._start)
      .slice(0, 10);
    const sec = $('ev-picks');
    if (picks.length < 2) { sec.hidden = true; return; }
    sec.hidden = false;
    $('ev-picks-sub').textContent = 'Seven Days staff picks + Steve’s own Meetup, next two weeks';
    const row = $('ev-picks-row');
    row.innerHTML = '';
    picks.forEach((e) => {
      const kind = pickKind(e);
      const btn = document.createElement('button');
      btn.className = 'ev-pick-card';
      btn.type = 'button';
      btn.innerHTML =
        `<span class="ev-pick-tag${kind === 'own' ? ' is-own' : ''}">${kind === 'own' ? 'Steve’s Meetup' : '7 Days pick'}</span>` +
        `<span class="ev-pick-title">${esc(e.title)}</span>` +
        `<span class="ev-pick-meta"><b>${esc(relDay(e.date, c.todayKey, c.tomorrowKey))}</b> · ${esc(e.allDay ? 'All day' : fmtHM(e._h, e._m))}` +
        `${e.venue ? ' · ' + esc(e.venue) : ''}</span>`;
      btn.addEventListener('click', () => openEvent(e.id, { scroll: true }));
      row.appendChild(btn);
    });
  }

  /* ---------------- filters ---------------- */

  function initTowns() {
    const towns = new Set();
    state.events.forEach((e) => { if (e.town) towns.add(e.town); });
    const townSel = $('ev-f-town');
    ['Burlington', ...[...towns].filter((t) => t !== 'Burlington').sort()].forEach((t) => {
      if (towns.has(t)) townSel.insertAdjacentHTML('beforeend',
        `<option value="${esc(t)}">${esc(t)}</option>`);
    });
  }

  function resetFilters() {
    const f = state.filters;
    f.when = 'all'; f.day = null; f.cat = ''; f.town = ''; f.quick = new Set(); f.soon = false; f.evening = false;
    f.q = ''; $('ev-search').value = '';
    $('ev-f-town').value = '';
    state.daysShown = 7;
  }

  function readParams() {
    const p = new URLSearchParams(location.search);
    const f = state.filters;
    const when = p.get('when');
    if (when && WHENS.includes(when) && when !== 'day') f.when = when;
    if (p.get('d') && /^\d{4}-\d{2}-\d{2}$/.test(p.get('d'))) { f.when = 'day'; f.day = p.get('d'); }
    if (p.get('cat') && CATEGORY_LABELS[p.get('cat')]) f.cat = p.get('cat');
    if (p.get('town')) { f.town = p.get('town'); $('ev-f-town').value = f.town; if ($('ev-f-town').value !== f.town) f.town = ''; }
    if (p.get('q')) { f.q = p.get('q').toLowerCase(); $('ev-search').value = p.get('q'); }
    if (p.get('price') === 'free') f.quick.add('free');          // legacy links
    if (p.get('price') === 'under15') f.quick.add('under15');
    (p.get('quick') || '').split(',').filter((k) => QUICK_BY_KEY[k]).forEach((k) => f.quick.add(k));
    if (p.get('soon') === '1') f.soon = true;
    if (p.get('tonight') === '1') f.evening = true;
    if (['month', 'map'].includes(p.get('view'))) state.view = p.get('view');
    if (p.get('e')) state.openId = p.get('e');
  }

  function writeParams() {
    const f = state.filters;
    const p = new URLSearchParams();
    if (f.when === 'day' && f.day) p.set('d', f.day);
    else if (f.when && f.when !== 'all') p.set('when', f.when);
    if (f.cat) p.set('cat', f.cat);
    if (f.town) p.set('town', f.town);
    if (f.q) p.set('q', f.q);
    if (f.quick.size) p.set('quick', [...f.quick].join(','));
    if (f.soon) p.set('soon', '1');
    if (f.evening) p.set('tonight', '1');
    if (state.view !== 'list') p.set('view', state.view);
    if (state.openId) p.set('e', state.openId);
    const qs = p.toString();
    const url = location.pathname + (qs ? '?' + qs : '') + location.hash;
    try { history.replaceState(null, '', url); } catch (e) { /* file:// etc. */ }
  }

  function weekendRange(c) {
    // upcoming Fri–Sun; if we're already inside the weekend, start today
    const dow = c.np.dow;
    if (dow === 0) return [c.todayKey, c.todayKey];
    const start = dow >= 5 ? c.todayKey : addDaysKey(c.todayKey, 5 - dow);
    const sun = addDaysKey(start, 7 - kparts(start).dow);
    return [start, sun];
  }

  function whenRange(c) {
    const t = c.todayKey;
    switch (state.filters.when) {
      case 'today': return [t, t];
      case 'tomorrow': return [c.tomorrowKey, c.tomorrowKey];
      case 'weekend': return weekendRange(c);
      case 'week': return [t, addDaysKey(t, 6)];
      case 'twoweeks': return [t, addDaysKey(t, 13)];
      case 'month': return [t, addDaysKey(t, 29)];
      case 'day': return state.filters.day ? [state.filters.day, state.filters.day] : [t, '9999-12-31'];
      default: return [t, '9999-12-31'];
    }
  }

  /* Everything EXCEPT the date window. Split out so day-strip counts and the
     month grid can count honestly whatever range is selected. */
  function matchesNonDate(e, opts = {}) {
    const f = state.filters;
    if (!opts.ignoreCat && f.cat && e.category !== f.cat) return false;
    if (f.town && e.town !== f.town) return false;
    for (const k of f.quick) {
      if (opts.ignoreQuick === k) continue;
      if (!QUICK_BY_KEY[k].test(e)) return false;
    }
    if (f.q && !e._search.includes(f.q)) return false;
    return true;
  }

  function inDateWindow(e, lo, hi, c) {
    if (e.date < lo || e.date > hi) return false;
    if (e.date === c.todayKey && !stillOn(e, c.now)) return false;
    if (state.filters.soon) {
      if (e.allDay || e._start < c.now || e._start > new Date(+c.now + 2 * 3600e3)) return false;
    }
    if (state.filters.evening && !e.allDay && e._h < 16) return false;
    return true;
  }

  function filtered(opts) {
    const c = nowCtx();
    const [lo, hi] = whenRange(c);
    return state.events.filter((e) => inDateWindow(e, lo, hi, c) && matchesNonDate(e, opts));
  }

  /* ---------------- day strip ---------------- */

  function dayTabs() {
    const c = nowCtx();
    const f = state.filters;
    // counts per date, honoring every non-date filter + the today grace rule
    // (not the soon/evening lenses — picking a day clears those on purpose)
    const counts = new Map();
    state.events.forEach((e) => {
      if (e.date < c.todayKey) return;
      if (e.date === c.todayKey && !stillOn(e, c.now)) return;
      if (!matchesNonDate(e)) return;
      counts.set(e.date, (counts.get(e.date) || 0) + 1);
    });
    let total = 0; counts.forEach((n) => { total += n; });
    const [wkLo, wkHi] = weekendRange(c);
    let wk = 0; counts.forEach((n, k) => { if (k >= wkLo && k <= wkHi) wk += n; });
    const dow = c.np.dow;

    const tabs = [
      { id: 'all', label: 'Upcoming', n: total, on: f.when === 'all' || ['week', 'twoweeks', 'month'].includes(f.when) },
      { id: 'today', label: 'Today', n: counts.get(c.todayKey) || 0, on: f.when === 'today' || (f.when === 'day' && f.day === c.todayKey), today: true, day: c.todayKey },
      { id: 'tomorrow', label: 'Tomorrow', n: counts.get(c.tomorrowKey) || 0, on: f.when === 'tomorrow' || (f.when === 'day' && f.day === c.tomorrowKey), day: c.tomorrowKey },
      { id: 'weekend', label: dow >= 5 || dow === 0 ? 'This weekend' : 'Weekend', n: wk, on: f.when === 'weekend', sep: true },
    ];
    for (let i = 2; i <= 13; i++) {
      const k = addDaysKey(c.todayKey, i);
      const p = kparts(k);
      tabs.push({ id: 'day:' + k, label: `${DAY_SHORT[p.dow]} ${p.d}`, n: counts.get(k) || 0,
        on: f.when === 'day' && f.day === k, day: k, sep: i === 2 });
    }
    return tabs;
  }

  function renderDays() {
    const wrap = $('ev-days');
    wrap.innerHTML = '';
    dayTabs().forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ev-daytab' + (t.today ? ' is-now' : '') + (t.sep ? ' is-sep' : '') + (t.n === 0 ? ' is-empty' : '');
      b.setAttribute('aria-pressed', String(!!t.on));
      b.dataset.tab = t.id;
      b.innerHTML = `<span class="ev-daytab-l">${esc(t.label)}</span><span class="ev-daytab-n">${t.n}</span>`;
      b.addEventListener('click', () => {
        const f = state.filters;
        f.soon = false; f.evening = false;
        if (t.id === 'all') { f.when = 'all'; f.day = null; }
        else if (t.id === 'weekend') { f.when = 'weekend'; f.day = null; }
        else { f.when = 'day'; f.day = t.day; }
        state.daysShown = 7;
        setView('list');
        renderAll();
      });
      wrap.appendChild(b);
    });
    const sel = wrap.querySelector('[aria-pressed="true"]');
    if (sel && wrap.scrollWidth > wrap.clientWidth) {
      const left = sel.offsetLeft - 12;
      if (left < wrap.scrollLeft || sel.offsetLeft + sel.offsetWidth > wrap.scrollLeft + wrap.clientWidth - 28)
        wrap.scrollTo({ left: Math.max(0, left), behavior: 'auto' });
    }
  }

  /* ---------------- chips ---------------- */

  function renderChips() {
    const f = state.filters;
    const c = nowCtx();
    const [lo, hi] = whenRange(c);
    const inWin = state.events.filter((e) => inDateWindow(e, lo, hi, c));

    // quick chips — each counted as if it were the only quick filter
    const qw = $('ev-quick');
    qw.innerHTML = '';
    QUICK.forEach((q) => {
      const n = inWin.filter((e) => q.test(e) && matchesNonDate(e, { ignoreQuick: q.key })).length;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ev-chip' + (q.key === 'free' ? ' ev-chip-free' : '') + (n === 0 && !f.quick.has(q.key) ? ' is-zero' : '');
      b.setAttribute('aria-pressed', String(f.quick.has(q.key)));
      if (q.title) b.title = q.title;
      b.innerHTML = `${esc(q.label)}<span class="ev-chip-n">${n}</span>`;
      b.addEventListener('click', () => {
        if (f.quick.has(q.key)) f.quick.delete(q.key); else f.quick.add(q.key);
        state.daysShown = 7;
        renderAll();
      });
      qw.appendChild(b);
    });

    // category chips — single select, counted against everything but category
    const cw = $('ev-cats');
    cw.innerHTML = '';
    const catCounts = new Map();
    inWin.forEach((e) => { if (matchesNonDate(e, { ignoreCat: true })) catCounts.set(e.category || 'other', (catCounts.get(e.category || 'other') || 0) + 1); });
    const allN = [...catCounts.values()].reduce((a, b) => a + b, 0);
    const mk = (key, label, n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ev-chip' + (key ? ' ev-cat-' + key : '') + (n === 0 && f.cat !== key ? ' is-zero' : '');
      b.setAttribute('aria-pressed', String(f.cat === key));
      b.innerHTML = (key ? '<span class="ev-dot" aria-hidden="true"></span>' : '') + `${esc(label)}<span class="ev-chip-n">${n}</span>`;
      b.addEventListener('click', () => { f.cat = (f.cat === key) ? '' : key; state.daysShown = 7; renderAll(); });
      return b;
    };
    cw.appendChild(mk('', 'All', allN));
    CAT_ORDER.forEach((k) => {
      const n = catCounts.get(k) || 0;
      if (!n && f.cat !== k && !state.events.some((e) => e.category === k)) return;
      cw.appendChild(mk(k, CATEGORY_LABELS[k], n));
    });
    $('ev-f-town').dataset.on = String(!!f.town);
  }

  /* ---------------- rows ---------------- */

  function row(e, c) {
    const el = document.createElement('article');
    el.className = 'ev-row';
    el.id = 'e-' + e.id;
    el.dataset.id = e.id;

    const live = e.date === c.todayKey && isLive(e, c.now);
    let timeHtml;
    if (e.allDay) timeHtml = '<span class="ev-t-allday">All day</span>';
    else {
      const h = e._h % 12 || 12;
      timeHtml = `<span class="ev-t-h">${h}${e._m ? ':' + String(e._m).padStart(2, '0') : ''}</span>` +
        `<span class="ev-t-ap">${e._h < 12 ? 'AM' : 'PM'}</span>`;
    }
    if (live) timeHtml = '<span class="ev-live" title="Happening now" aria-label="Happening now"></span>' + timeHtml;

    const meta = [];
    if (e.venue) meta.push(`<span class="ev-row-venue">${esc(e.venue)}</span>`);
    if (e.town && e.town !== 'Burlington') meta.push(`<span>${esc(e.town)}</span>`);
    else if (!e.venue && e.town) meta.push(`<span>${esc(e.town)}</span>`);
    if (e.category && e.category !== 'other')
      meta.push(`<span class="ev-row-cat ev-cat-${esc(e.category)}"><span class="ev-dot" aria-hidden="true"></span>${esc(CATEGORY_LABELS[e.category] || e.category)}</span>`);
    const flags = [];
    if (hasTag(e, 'series')) flags.push('<span class="ev-row-flag" title="A weekly regular">↻ regular</span>');
    if (e.age && !/all ages/i.test(e.age)) flags.push(`<span class="ev-row-flag">${esc(e.age)}</span>`);
    const metaHtml = meta.join('<span class="ev-sep">·</span>') + (flags.length ? ' ' + flags.join(' ') : '');

    const price = shortPrice(e);
    const kind = pickKind(e);
    const side =
      (price.text ? `<span class="ev-price ${price.cls}">${esc(price.text)}</span>` : '') +
      (kind ? `<span class="ev-pick-badge${kind === 'own' ? ' is-own' : ''}">${kind === 'own' ? 'Steve’s' : 'Pick'}</span>` : '');

    el.innerHTML =
      `<div class="ev-row-time">${timeHtml}</div>` +
      `<div class="ev-row-main">` +
        `<h3 class="ev-row-title"><button type="button" class="ev-row-tbtn" aria-expanded="false" aria-controls="d-${esc(e.id)}">${esc(e.title)}</button></h3>` +
        `<p class="ev-row-meta">${metaHtml}</p>` +
      `</div>` +
      `<div class="ev-row-side">${side}</div>`;

    // the title is the real (keyboard-reachable) toggle; the rest of the row
    // is a bigger click target for the same thing, minus links and buttons
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.ev-row-tbtn')) { toggleRow(el, e); return; }
      if (ev.target.closest('a, button, .ev-row-detail')) return;
      toggleRow(el, e);
    });
    return el;
  }

  function setOpen(el, open) {
    el.classList.toggle('is-open', open);
    const b = el.querySelector('.ev-row-tbtn');
    if (b) b.setAttribute('aria-expanded', String(open));
  }

  function toggleRow(el, e) {
    const open = el.classList.contains('is-open');
    if (open) {
      el.querySelector('.ev-row-detail')?.remove();
      setOpen(el, false);
      if (state.openId === e.id) state.openId = null;
    } else {
      // one open card at a time — collapse any other
      document.querySelectorAll('.ev-row.is-open').forEach((o) => {
        if (o === el) return;
        o.querySelector('.ev-row-detail')?.remove();
        setOpen(o, false);
      });
      const det = document.createElement('div');
      det.className = 'ev-row-detail';
      det.id = 'd-' + e.id;
      det.innerHTML = detailHtml(e);
      wireDetail(det, e);
      el.appendChild(det);
      setOpen(el, true);
      state.openId = e.id;
    }
    writeParams();
  }

  function openEvent(id, { scroll } = {}) {
    const e = state.byId.get(id);
    if (!e) return;
    let el = document.getElementById('e-' + id);
    if (!el) {
      // not in the current view: show its day, then find it
      resetFilters();
      state.filters.when = 'day';
      state.filters.day = e.date;
      setView('list');
      renderAll();
      el = document.getElementById('e-' + id);
      if (!el) return;
    }
    if (!el.classList.contains('is-open')) toggleRow(el, e);
    if (scroll) {
      const y = el.getBoundingClientRect().top + window.scrollY - (60 + 58 + 52);
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
  }

  function detailHtml(e) {
    const parts = [];
    if (e.description) parts.push(`<p class="ev-d-desc">${esc(e.description)}</p>`);
    const rows = [];
    rows.push(`<span class="ev-d-row-k" aria-hidden="true">🕒</span><span>${esc(`${longDay(e.date)} · ${fmtRange(e)}`)}</span>`);
    if (e.recurring) rows.push(`<span class="ev-d-row-k" aria-hidden="true">↻</span><span>${esc(e.recurring)}</span>`);
    const place = [e.venue, e.address].filter(Boolean).join(' — ');
    if (place) {
      const q = encodeURIComponent(e.address || `${e.venue}, ${e.town || 'Burlington'} VT`);
      rows.push(`<span class="ev-d-row-k" aria-hidden="true">📍</span><span>${esc(place)} <a href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">map ↗</a></span>`);
    }
    if (e.price && !(e.free === true && /^free\.?$/i.test(e.price.trim()))) rows.push(`<span class="ev-d-row-k" aria-hidden="true">🎟</span><span>${esc(e.price)}</span>`);
    if (e.age) rows.push(`<span class="ev-d-row-k" aria-hidden="true">🪪</span><span>${esc(e.age)}</span>`);
    parts.push(`<div class="ev-d-rows">${rows.map((r) => `<p class="ev-d-row">${r}</p>`).join('')}</div>`);

    const main = safeUrl(e.url);
    const links = (e.sources && e.sources.length ? e.sources : [{ source: e.source, url: e.url }])
      .map((s) => ({ label: sourceLabel(s.source), url: safeUrl(s.url) }))
      .filter((s) => s.url)
      .map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)} ↗</a>`);
    parts.push(
      `<div class="ev-d-actions">` +
        (main ? `<a class="ev-act ev-act-primary" href="${esc(main)}" target="_blank" rel="noopener">Details &amp; tickets ↗</a>` : '') +
        `<a class="ev-act" data-act="gcal" href="${esc(gcalUrl(e))}" target="_blank" rel="noopener">+ Google Cal</a>` +
        `<a class="ev-act" data-act="ics" href="${esc(icsUrl(e))}" download="${esc(slug(e.title))}.ics">+ Apple / .ics</a>` +
        `<button class="ev-act" data-act="share" type="button">Share</button>` +
        (links.length ? `<span class="ev-d-sources">via ${links.join(' · ')}</span>` : '') +
      `</div>`);
    return parts.join('');
  }

  function wireDetail(det, e) {
    det.querySelector('[data-act="share"]')?.addEventListener('click', async () => {
      const url = location.origin + location.pathname + '?e=' + encodeURIComponent(e.id);
      const text = `${e.title} — ${DAY_SHORT[kparts(e.date).dow]} ${fmtRange(e)}${e.venue ? ' at ' + e.venue : ''}`;
      if (navigator.share) {
        try { await navigator.share({ title: e.title, text, url }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
      }
      try { await navigator.clipboard.writeText(url); toast('Link copied'); }
      catch (err) { toast(url); }
    });
  }

  const SOURCE_LABELS = {
    sevendays: 'Seven Days', helloburlington: 'Hello Burlington', loveburlington: 'Love Burlington',
    flynn: 'The Flynn', higherground: 'Higher Ground', vcc: 'Vermont Comedy Club',
    fletcherfree: 'Fletcher Free Library', sblibrary: 'South Burlington Library',
    winooskilibrary: 'Winooski Library', brownell: 'Brownell Library', eventbrite: 'Eventbrite', meetup: 'Meetup',
    uvm: 'UVM', uvmbored: 'UVM Bored', bca: 'Burlington City Arts', echo: 'ECHO',
    shelburnemuseum: 'Shelburne Museum', farmersmarket: 'Farmers Market',
    churchst: 'Church St Marketplace', parksrec: 'Burlington Parks & Rec',
    sbrec: 'South Burlington Rec', greenfc: 'Vermont Green FC', breweries: 'Venue site',
    champlainvalley: 'Champlain Valley calendar', facebook: 'Facebook', instagram: 'Instagram',
    fpf: 'Front Porch Forum',
  };
  function sourceLabel(s) { return SOURCE_LABELS[s] || s || 'Source'; }

  /* ---------------- calendar links ---------------- */

  function pad2(n) { return String(n).padStart(2, '0'); }
  function utcStamp(d) {
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + 'T' +
      pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + '00Z';
  }
  function dateStamp(k) { return k.replace(/-/g, ''); }
  function slug(s) { return String(s || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'event'; }
  function locStr(e) { return [e.venue, e.address || e.town].filter(Boolean).join(', '); }
  function calDetails(e) { return [(e.description || '').slice(0, 800), safeUrl(e.url)].filter(Boolean).join('\n\n'); }

  function gcalUrl(e) {
    const p = new URLSearchParams();
    p.set('action', 'TEMPLATE');
    p.set('text', e.title);
    p.set('dates', e.allDay ? `${dateStamp(e.date)}/${dateStamp(addDaysKey(e.date, 1))}` : `${utcStamp(e._start)}/${utcStamp(endOf(e))}`);
    if (locStr(e)) p.set('location', locStr(e));
    p.set('details', calDetails(e));
    p.set('ctz', TZ);
    return 'https://calendar.google.com/calendar/render?' + p.toString();
  }

  /* RFC 5545: TEXT values escape \ ; , and newlines; lines fold at 75 octets. */
  function icsText(s) {
    return String(s || '').replace(/\r\n?/g, '\n').replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  }
  function icsFold(line) {
    const enc = new TextEncoder();
    const out = [];
    let cur = '', bytes = 0;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (bytes + b > 75) { out.push(cur); cur = ' '; bytes = 1; }
      cur += ch; bytes += b;
    }
    out.push(cur);
    return out.join('\r\n');
  }
  function icsUrl(e) {
    const url = safeUrl(e.url);
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Btown Brief//Events//EN', 'BEGIN:VEVENT',
      `UID:${e.id}@guide.btownbrief.com`,
      `DTSTAMP:${utcStamp(new Date())}`,
      e.allDay ? `DTSTART;VALUE=DATE:${dateStamp(e.date)}` : `DTSTART:${utcStamp(e._start)}`,
      e.allDay ? `DTEND;VALUE=DATE:${dateStamp(addDaysKey(e.date, 1))}` : `DTEND:${utcStamp(endOf(e))}`,
      `SUMMARY:${icsText(e.title)}`,
    ];
    if (locStr(e)) lines.push(`LOCATION:${icsText(locStr(e))}`);
    const desc = calDetails(e);
    if (desc) lines.push(`DESCRIPTION:${icsText(desc)}`);
    if (url) lines.push(`URL:${url.replace(/[\r\n\s]/g, '')}`);
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(lines.map(icsFold).join('\r\n'));
  }

  /* ---------------- list ---------------- */

  function renderList() {
    const evs = filtered();
    const c = nowCtx();
    const f = state.filters;

    const groups = new Map();
    evs.forEach((e) => {
      if (!groups.has(e.date)) groups.set(e.date, []);
      groups.get(e.date).push(e);
    });
    const dates = [...groups.keys()].sort();

    const listEl = $('ev-list');
    listEl.innerHTML = '';
    const shown = dates.slice(0, state.daysShown);
    shown.forEach((k) => {
      const g = document.createElement('section');
      g.className = 'ev-day';
      const p = kparts(k);
      const rel = k === c.todayKey ? 'Today' : k === c.tomorrowKey ? 'Tomorrow' : DAY_NAMES[p.dow];
      const cal = (k === c.todayKey || k === c.tomorrowKey)
        ? `${DAY_NAMES[p.dow]}, ${MON_NAMES[p.mo]} ${p.d}`
        : `${MON_NAMES[p.mo]} ${p.d}`;
      const n = groups.get(k).length;
      g.innerHTML = `<h3 class="ev-day-head"><span>${rel}</span><span class="ev-day-cal">${cal}</span>` +
        `<span class="ev-day-n">${n} event${n === 1 ? '' : 's'}</span></h3>`;
      const frag = document.createDocumentFragment();
      groups.get(k)
        .sort((a, b) => (a.allDay && b.allDay) ? a.title.localeCompare(b.title)
          : a.allDay ? -1 : b.allDay ? 1 : a._start - b._start)
        .forEach((e) => frag.appendChild(row(e, c)));
      g.appendChild(frag);
      listEl.appendChild(g);
    });

    renderOngoing();

    const more = $('ev-more');
    more.hidden = dates.length <= state.daysShown;
    if (!more.hidden) {
      const rest = dates.length - state.daysShown;
      more.textContent = `Show ${Math.min(7, rest)} more day${Math.min(7, rest) === 1 ? '' : 's'} (${rest} left)`;
    }
    $('ev-empty').hidden = evs.length > 0;

    // status line
    let scope;
    if (f.when === 'day' && f.day) scope = f.day === c.todayKey ? 'today' : f.day === c.tomorrowKey ? 'tomorrow' : shortDay(f.day);
    else if (f.when === 'weekend') scope = 'this weekend';
    else if (f.when === 'today') scope = 'today';
    else if (f.when === 'tomorrow') scope = 'tomorrow';
    else scope = `the next ${dates.length} day${dates.length === 1 ? '' : 's'}`;
    $('ev-count').textContent = evs.length
      ? `${evs.length} event${evs.length === 1 ? '' : 's'} ${scope}` +
        (f.soon ? ' · starting in the next 2 hours' : f.evening ? ' · from 4 PM on' : '')
      : '';
    $('ev-clear').hidden = !(f.q || f.cat || f.town || f.quick.size || f.soon || f.evening);

    // keep the open card open across re-renders; forget it if it's no longer shown
    if (state.openId) {
      const el = document.getElementById('e-' + state.openId);
      const e = state.byId.get(state.openId);
      if (el && e) toggleRow(el, e);
      else state.openId = null;
    }
  }

  function renderAll() {
    renderDays();
    renderChips();
    if (state.view === 'list') renderList();
    else if (state.view === 'month') renderMonths();
    else if (state.view === 'map') { renderList(); renderMap(filtered()); }
    const lens = lensDefs();
    syncLensChips(lens.defs, lens.ctx);
    writeParams();
  }

  /* ---------------- ongoing strip ---------------- */

  function renderOngoing() {
    const wrap = $('ev-ongoing');
    if (!wrap) return;
    const f = state.filters;
    const todayKey = dkey(new Date());
    const list = state.ongoing.filter((e) => (e.ongoingUntil || e.date) >= todayKey && matchesNonDate(e));
    if (!list.length || f.soon || f.evening) { wrap.hidden = true; return; }
    wrap.hidden = false;
    $('ev-ongoing-count').textContent = list.length;
    const box = $('ev-ongoing-list');
    box.innerHTML = '';
    list.sort((a, b) => (a.ongoingUntil || '').localeCompare(b.ongoingUntil || ''))
      .forEach((e) => {
        let until = '';
        if (e.ongoingUntil) { const p = kparts(e.ongoingUntil); until = ` — through ${MON_NAMES[p.mo]} ${p.d}`; }
        const href = safeUrl(e.url);
        const a = document.createElement(href ? 'a' : 'span');
        a.className = 'ev-ongoing-row';
        if (href) { a.href = href; a.target = '_blank'; a.rel = 'noopener'; }
        a.innerHTML = `<span class="ev-ongoing-title">${esc(e.title)}</span>` +
          `<span class="ev-ongoing-meta">${esc(e.venue || e.town || '')}${esc(until)}</span>`;
        box.appendChild(a);
      });
  }

  /* ---------------- month grid ---------------- */

  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  function renderMonths() {
    const counts = new Map();
    state.events.forEach((e) => {
      if (!matchesNonDate(e)) return;
      counts.set(e.date, (counts.get(e.date) || 0) + 1);
    });

    const todayKey = dkey(new Date());
    const lo = (state.meta && state.meta.windowStart) || todayKey;
    const hi = (state.meta && state.meta.windowEnd) || todayKey;

    const start = kparts(lo), end = kparts(hi);
    const months = [];
    let y = start.y, mo = start.mo;
    while ((y < end.y || (y === end.y && mo <= end.mo)) && months.length < 4) {
      months.push({ y, mo });
      mo += 1; if (mo > 11) { mo = 0; y += 1; }
    }

    const wrap = $('ev-months');
    wrap.innerHTML = '';
    let busiest = 0;
    counts.forEach((n, k) => { if (k >= lo && k <= hi && n > busiest) busiest = n; });

    months.forEach((m) => {
      const grid = document.createElement('div');
      grid.className = 'ev-month';
      let html = `<h3 class="ev-month-name">${MONTHS[m.mo]} ${m.y}</h3>`;
      html += '<div class="ev-month-grid">';
      DOW.forEach((d) => { html += `<span class="ev-dow" aria-hidden="true">${d}</span>`; });
      const firstDow = new Date(Date.UTC(m.y, m.mo, 1)).getUTCDay();
      const days = new Date(Date.UTC(m.y, m.mo + 1, 0)).getUTCDate();
      for (let i = 0; i < firstDow; i++) html += '<span class="ev-day-cell ev-day-blank"></span>';
      for (let d = 1; d <= days; d++) {
        const key = keyOf(m.y, m.mo, d);
        const n = counts.get(key) || 0;
        const inWindow = key >= lo && key <= hi;
        const isToday = key === todayKey;
        if (!inWindow || !n) {
          html += `<span class="ev-day-cell ev-day-off${isToday ? ' is-today' : ''}"><span class="ev-day-num">${d}</span></span>`;
          continue;
        }
        const heat = busiest ? Math.min(3, Math.ceil((n / busiest) * 3)) : 1;
        html += `<button type="button" class="ev-day-cell ev-day-on heat-${heat}${isToday ? ' is-today' : ''}" ` +
          `data-day="${key}" aria-label="${n} event${n === 1 ? '' : 's'} on ${MONTHS[m.mo]} ${d}">` +
          `<span class="ev-day-num">${d}</span><span class="ev-day-count">${n}</span></button>`;
      }
      html += '</div>';
      grid.innerHTML = html;
      wrap.appendChild(grid);
    });

    wrap.querySelectorAll('.ev-day-on').forEach((b) => {
      b.addEventListener('click', () => {
        state.filters.when = 'day';
        state.filters.day = b.dataset.day;
        state.filters.soon = false; state.filters.evening = false;
        state.daysShown = 7;
        setView('list');
        renderAll();
        $('ev-bar').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    let total = 0;
    counts.forEach((n, k) => { if (k >= lo && k <= hi) total += n; });
    const fl = kparts(lo), fh = kparts(hi);
    $('ev-month-note').textContent =
      `${total} events between ${MON_NAMES[fl.mo]} ${fl.d} and ${MON_NAMES[fh.mo]} ${fh.d}. Click any day to open it.`;
  }

  /* ---------------- map ---------------- */

  function renderMap(evs) {
    if (typeof L === 'undefined') { $('ev-map-note').textContent = 'The map library didn’t load.'; return; }
    const mappable = evs.filter((e) => e.lat != null && e.lng != null);
    if (!state.map) {
      state.map = L.map('ev-map', { scrollWheelZoom: false }).setView([44.4759, -73.2121], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(state.map);
      state.mapLayer = L.layerGroup().addTo(state.map);
    }
    state.mapLayer.clearLayers();

    const byLoc = new Map();
    mappable.forEach((e) => {
      const k = e.lat.toFixed(5) + ',' + e.lng.toFixed(5);
      if (!byLoc.has(k)) byLoc.set(k, []);
      byLoc.get(k).push(e);
    });
    byLoc.forEach((list) => {
      const e0 = list[0];
      const m = L.circleMarker([e0.lat, e0.lng], {
        radius: Math.min(8 + list.length, 18), weight: 2,
        color: '#F2683C', fillColor: '#F2683C', fillOpacity: 0.35,
      });
      const items = list.slice(0, 8).map((e) => {
        const href = safeUrl(e.url);
        const t = href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title);
        return `<li>${esc(e.date.slice(5).replace('-', '/'))}${e.allDay ? '' : ' ' + fmtHM(e._h, e._m)} — ${t}</li>`;
      }).join('');
      m.bindPopup(
        `<strong>${esc(e0.venue || 'Venue')}</strong>` +
        `<ul class="ev-pop-list">${items}</ul>` +
        (list.length > 8 ? `<em>+ ${list.length - 8} more</em>` : ''));
      state.mapLayer.addLayer(m);
    });

    $('ev-map-note').textContent =
      `${mappable.length} of ${evs.length} filtered events have a mapped venue — the rest are in the list view.`;
    setTimeout(() => state.map.invalidateSize(), 60);
  }

  /* ---------------- toast ---------------- */

  let toastTimer;
  function toast(msg) {
    const t = $('ev-toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  /* ---------------- wiring ---------------- */

  function wire() {
    let qTimer;
    $('ev-search').addEventListener('input', (ev) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        state.filters.q = ev.target.value.trim().toLowerCase();
        state.daysShown = 7;
        renderAll();
      }, 180);
    });
    $('ev-f-town').addEventListener('change', (ev) => {
      state.filters.town = ev.target.value;
      state.daysShown = 7;
      renderAll();
    });
    $('ev-clear').addEventListener('click', () => {
      const f = state.filters;
      f.q = ''; f.cat = ''; f.town = ''; f.quick = new Set(); f.soon = false; f.evening = false;
      $('ev-search').value = ''; $('ev-f-town').value = '';
      state.daysShown = 7;
      renderAll();
    });
    $('ev-more').addEventListener('click', () => {
      state.daysShown += 7;
      renderList();
    });
    document.querySelectorAll('[data-view]').forEach((b) => {
      b.addEventListener('click', () => { setView(b.dataset.view); renderAll(); });
    });

    // horizontal strips: keep a keyboard-focused item fully in view (the fade mask hides the edge)
    ['ev-days', 'ev-quick', 'ev-cats', 'ev-now', 'ev-picks-row'].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener('focusin', (ev) => {
        if (ev.target.scrollIntoView) ev.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    });

    $('dark-toggle').addEventListener('click', () => {
      const root = document.documentElement;
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    });

    // refresh the time-aware bits if the tab sits open across a time boundary
    setInterval(() => { renderHero(); renderDays(); }, 5 * 60e3);
  }

  function setView(v) {
    state.view = v;
    document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    $('ev-list').hidden = v !== 'list';
    document.querySelector('.ev-more-wrap').hidden = v !== 'list';
    if (v !== 'list') $('ev-ongoing').hidden = true;
    $('ev-month-wrap').hidden = v !== 'month';
    $('ev-map-wrap').hidden = v !== 'map';
    $('ev-empty').hidden = true;
  }

  wire();
  load();
  loadWeather();
})();
