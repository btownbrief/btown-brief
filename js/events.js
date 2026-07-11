/* ============================================================
   EVENTS PAGE — time-aware buckets + full filterable calendar
   Data: data/events/events.json (built by scripts/events/update.py)
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

  const state = {
    events: [],          // active events, hydrated with Date objects
    ongoing: [],         // long-running exhibits/series (tag "ongoing")
    meta: null,
    view: 'list',
    daysShown: 10,
    map: null,
    mapLayer: null,
    activeBucket: null,
    filters: { when: 'week', q: '', cat: '', town: '', price: '', age: '' },
  };

  /* ---------------- utilities ---------------- */

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function dkey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  }

  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

  function fmtTime(d) {
    let h = d.getHours() % 12 || 12;
    const m = d.getMinutes();
    const ap = d.getHours() < 12 ? 'AM' : 'PM';
    return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`;
  }

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function dayLabel(dateStr, todayKey, tomorrowKey) {
    const d = new Date(dateStr + 'T12:00:00');
    const cal = `${DAY_NAMES[d.getDay()]}, ${MON_NAMES[d.getMonth()]} ${d.getDate()}`;
    if (dateStr === todayKey) return `Today — ${cal}`;
    if (dateStr === tomorrowKey) return `Tomorrow — ${cal}`;
    return cal;
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
      .filter((e) => e.status === 'active')
      .map((e) => {
        e._start = new Date(e.start);
        e._search = `${e.title} ${e.venue || ''} ${e.town || ''} ${e.description || ''}`.toLowerCase();
        return e;
      });
    // long-running exhibits/series live in their own strip, not day groups
    state.ongoing = active.filter((e) => (e.tags || []).includes('ongoing'));
    state.events = active.filter((e) => !(e.tags || []).includes('ongoing'));
    $('ev-loading').hidden = true;
    if (payload.generated) {
      const g = new Date(payload.generated);
      $('ev-generated').textContent =
        `Calendar refreshed ${MON_NAMES[g.getMonth()]} ${g.getDate()}, ${fmtTime(g)}`;
    }
    initFilters();
    readParams();
    renderBuckets();
    renderCalendar();
  }

  /* ---------------- buckets ---------------- */

  function bucketDefs() {
    const now = new Date();
    const todayKey = dkey(now);
    const late = now.getHours() >= 22;      // after 10pm: pivot to tomorrow
    const refKey = late ? dkey(addDays(now, 1)) : todayKey;
    const evening = now.getHours() >= 16;
    const dayWord = late ? 'tomorrow' : (evening ? 'tonight' : 'today');

    const onRef = state.events.filter((e) => e.date === refKey);
    // "still attendable": all-day, or hasn't started more than an hour ago
    const alive = onRef.filter((e) => e.allDay || e._start >= new Date(now - 3600e3));
    const tonight = alive.filter((e) => e.allDay || e._start.getHours() >= 16 || late || !evening);
    const in2h = late ? [] : onRef.filter((e) => !e.allDay &&
      e._start >= now && e._start <= new Date(+now + 2 * 3600e3));

    const defs = [
      { key: 'tonight', label: late ? 'Tomorrow' : (evening ? 'Tonight' : 'Today'), list: tonight },
      { key: 'in2h', label: 'Starting in the next 2 hours', list: in2h },
      { key: 'free', label: `Free ${dayWord}`, list: tonight.filter((e) => e.free === true) },
      { key: 'music', label: 'Live music', list: alive.filter((e) => e.category === 'music') },
      { key: 'social', label: 'Actually social', list: alive.filter((e) => (e.tags || []).includes('social')),
        hint: 'showing up alone is normal' },
      { key: 'outside', label: 'Outside', list: alive.filter((e) => e.indoorOutdoor === 'outdoor') },
      { key: 'under15', label: 'Under $15', list: tonight.filter((e) => e.free === true ||
        (e.minPrice != null && e.minPrice > 0 && e.minPrice < 15)) },
    ];
    return { defs: defs.filter((d) => d.list.length > 0), refKey, dayWord, tonightCount: tonight.length };
  }

  function renderBuckets() {
    const { defs, dayWord, tonightCount } = bucketDefs();
    const now = new Date();
    $('ev-hero-sub').textContent =
      `${DAY_NAMES[now.getDay()]} ${now.getHours() >= 17 ? 'evening' : now.getHours() >= 12 ? 'afternoon' : 'morning'} in Burlington` +
      (tonightCount ? ` · ${tonightCount} things ${dayWord}` : '');

    const wrap = $('ev-buckets');
    wrap.innerHTML = '';
    defs.forEach((d) => {
      const btn = document.createElement('button');
      btn.className = 'ev-bucket';
      btn.setAttribute('role', 'listitem');
      btn.innerHTML =
        `<span class="ev-bucket-n">${d.list.length}</span>` +
        `<span class="ev-bucket-label">${esc(d.label)}</span>` +
        (d.hint ? `<span class="ev-bucket-hint">${esc(d.hint)}</span>` : '');
      btn.addEventListener('click', () => toggleBucket(d, btn));
      wrap.appendChild(btn);
    });
  }

  function toggleBucket(def, btn) {
    const panel = $('ev-bucket-panel');
    if (state.activeBucket === def.key) { closeBucket(); return; }
    state.activeBucket = def.key;
    document.querySelectorAll('.ev-bucket').forEach((b) => b.removeAttribute('data-open'));
    btn.setAttribute('data-open', 'true');
    $('ev-bucket-panel-title').textContent = `${def.label} · ${def.list.length}`;
    const list = $('ev-bucket-panel-list');
    list.innerHTML = '';
    def.list.slice().sort((a, b) => (a.allDay ? -1 : b.allDay ? 1 : a._start - b._start))
      .forEach((e) => list.appendChild(card(e)));
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeBucket() {
    state.activeBucket = null;
    $('ev-bucket-panel').hidden = true;
    document.querySelectorAll('.ev-bucket').forEach((b) => b.removeAttribute('data-open'));
  }

  /* ---------------- filtering ---------------- */

  function initFilters() {
    const cats = new Set(), towns = new Set();
    state.events.forEach((e) => { if (e.category) cats.add(e.category); if (e.town) towns.add(e.town); });
    const catSel = $('ev-f-category');
    Object.keys(CATEGORY_LABELS).filter((c) => cats.has(c)).forEach((c) => {
      catSel.insertAdjacentHTML('beforeend',
        `<option value="${c}">${CATEGORY_LABELS[c]}</option>`);
    });
    const townSel = $('ev-f-town');
    ['Burlington', ...[...towns].filter((t) => t !== 'Burlington').sort()].forEach((t) => {
      if (towns.has(t)) townSel.insertAdjacentHTML('beforeend',
        `<option value="${esc(t)}">${esc(t)}</option>`);
    });
  }

  function readParams() {
    const p = new URLSearchParams(location.search);
    if (p.get('when')) state.filters.when = p.get('when');
    if (p.get('cat')) { state.filters.cat = p.get('cat'); $('ev-f-category').value = p.get('cat'); }
    if (p.get('town')) { state.filters.town = p.get('town'); $('ev-f-town').value = p.get('town'); }
    if (p.get('price')) { state.filters.price = p.get('price'); $('ev-f-price').value = p.get('price'); }
    syncWhenPills();
  }

  function whenRange() {
    const now = new Date();
    const t = dkey(now);
    switch (state.filters.when) {
      case 'today': return [t, t];
      case 'tomorrow': { const k = dkey(addDays(now, 1)); return [k, k]; }
      case 'weekend': {
        // upcoming Fri–Sun; if we're already inside the weekend, start today
        const dow = now.getDay(); // 0 Sun … 5 Fri, 6 Sat
        if (dow === 0) return [t, t];                       // Sunday: what's left
        const start = dow >= 5 ? now : addDays(now, 5 - dow);
        const sun = addDays(start, 7 - start.getDay());     // that weekend's Sunday
        return [dkey(start), dkey(sun)];
      }
      case 'week': return [t, dkey(addDays(now, 6))];
      default: return [t, '9999-12-31'];
    }
  }

  function filtered() {
    const [lo, hi] = whenRange();
    const f = state.filters;
    const now = new Date();
    const todayKey = dkey(now);
    return state.events.filter((e) => {
      if (e.date < lo || e.date > hi) return false;
      // today: hide things that started more than an hour ago
      if (e.date === todayKey && !e.allDay && e._start < new Date(+now - 3600e3)) return false;
      if (f.cat && e.category !== f.cat) return false;
      if (f.town && e.town !== f.town) return false;
      if (f.price === 'free' && e.free !== true) return false;
      if (f.price === 'under15' && !(e.free === true ||
        (e.minPrice != null && e.minPrice < 15))) return false;
      if (f.age === 'allages' && /\b(18|21)\s*\+/.test(e.age || '')) return false;
      if (f.age === '21' && !/\b(18|21)\s*\+/.test(e.age || '')) return false;
      if (f.q && !e._search.includes(f.q)) return false;
      return true;
    });
  }

  /* ---------------- event card ---------------- */

  function badge(text, cls) { return `<span class="ev-badge ${cls || ''}">${esc(text)}</span>`; }

  function card(e) {
    const el = document.createElement('article');
    el.className = 'ev-card';
    const time = e.allDay ? 'All day' : fmtTime(e._start);
    const badges = [];
    if (e.free === true) badges.push(badge('Free', 'ev-badge-free'));
    else if (e.price) badges.push(badge(e.price.length > 14 ? '$' : e.price, 'ev-badge-price'));
    if (e.category && e.category !== 'other')
      badges.push(badge(CATEGORY_LABELS[e.category] || e.category, 'ev-badge-cat ev-cat-' + e.category));
    if (e.age) badges.push(badge(e.age, 'ev-badge-age'));
    if (e.signals && e.signals.staff_pick) badges.push(badge('7D pick', 'ev-badge-pick'));
    if (e.recurring) badges.push(badge('Recurring', 'ev-badge-rec'));

    el.innerHTML =
      `<div class="ev-card-time">${esc(time)}</div>` +
      `<div class="ev-card-main">` +
        `<h3 class="ev-card-title">${esc(e.title)}</h3>` +
        `<p class="ev-card-where">${esc(e.venue || '')}${e.venue && e.town ? ' · ' : ''}${esc(e.town || '')}</p>` +
        `<div class="ev-card-badges">${badges.join('')}</div>` +
        `<div class="ev-card-detail" hidden></div>` +
      `</div>` +
      `<div class="ev-card-chev" aria-hidden="true">›</div>`;

    el.addEventListener('click', (ev) => {
      if (ev.target.closest('a')) return;
      const det = el.querySelector('.ev-card-detail');
      if (det.hidden) { det.innerHTML = detailHtml(e); det.hidden = false; el.dataset.open = 'true'; }
      else { det.hidden = true; delete el.dataset.open; }
    });
    return el;
  }

  function detailHtml(e) {
    const rows = [];
    if (e.description) rows.push(`<p class="ev-d-desc">${esc(e.description)}</p>`);
    if (e.recurring) rows.push(`<p class="ev-d-row">↻ ${esc(e.recurring)}</p>`);
    if (e.address) rows.push(`<p class="ev-d-row">📍 ${esc(e.address)}</p>`);
    if (e.price && e.price.length > 14) rows.push(`<p class="ev-d-row">🎟 ${esc(e.price)}</p>`);
    const links = (e.sources && e.sources.length ? e.sources : [{ source: e.source, url: e.url }])
      .map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(sourceLabel(s.source))} ↗</a>`);
    rows.push(`<p class="ev-d-links">${links.join(' · ')}</p>`);
    return rows.join('');
  }

  const SOURCE_LABELS = {
    sevendays: 'Seven Days', helloburlington: 'Hello Burlington', loveburlington: 'Love Burlington',
    flynn: 'The Flynn', higherground: 'Higher Ground', vcc: 'Vermont Comedy Club',
    fletcherfree: 'Fletcher Free Library', sblibrary: 'South Burlington Library',
    winooskilibrary: 'Winooski Library', eventbrite: 'Eventbrite', meetup: 'Meetup',
    uvm: 'UVM', uvmbored: 'UVM Bored', bca: 'Burlington City Arts', echo: 'ECHO',
    shelburnemuseum: 'Shelburne Museum', farmersmarket: 'Farmers Market',
    churchst: 'Church St Marketplace', parksrec: 'Burlington Parks & Rec',
    sbrec: 'South Burlington Rec', greenfc: 'Vermont Green FC', breweries: 'Venue site',
    champlainvalley: 'Champlain Valley calendar', facebook: 'Facebook', instagram: 'Instagram',
  };
  function sourceLabel(s) { return SOURCE_LABELS[s] || s || 'Source'; }

  /* ---------------- calendar list ---------------- */

  function renderCalendar() {
    const evs = filtered();
    const now = new Date();
    const todayKey = dkey(now), tomorrowKey = dkey(addDays(now, 1));

    // group by date
    const groups = new Map();
    evs.forEach((e) => {
      if (!groups.has(e.date)) groups.set(e.date, []);
      groups.get(e.date).push(e);
    });
    const dates = [...groups.keys()].sort();

    const listEl = $('ev-list');
    listEl.innerHTML = '';
    const shown = dates.slice(0, state.daysShown);
    shown.forEach((dateStr) => {
      const g = document.createElement('section');
      g.className = 'ev-day';
      g.innerHTML = `<h3 class="ev-day-head">${esc(dayLabel(dateStr, todayKey, tomorrowKey))}` +
        `<span class="ev-day-n">${groups.get(dateStr).length}</span></h3>`;
      const frag = document.createDocumentFragment();
      groups.get(dateStr)
        .sort((a, b) => (a.allDay && b.allDay) ? a.title.localeCompare(b.title)
          : a.allDay ? -1 : b.allDay ? 1 : a._start - b._start)
        .forEach((e) => frag.appendChild(card(e)));
      g.appendChild(frag);
      listEl.appendChild(g);
    });

    renderOngoing();

    $('ev-more').hidden = dates.length <= state.daysShown;
    $('ev-empty').hidden = evs.length > 0;
    $('ev-count').textContent = evs.length
      ? `${evs.length} event${evs.length === 1 ? '' : 's'} · ${dates.length} day${dates.length === 1 ? '' : 's'}`
      : '';

    const f = state.filters;
    $('ev-clear').hidden = !(f.q || f.cat || f.town || f.price || f.age);

    if (state.view === 'map') renderMap(evs);
  }

  /* ---------------- ongoing strip ---------------- */

  function renderOngoing() {
    const wrap = $('ev-ongoing');
    if (!wrap) return;
    const f = state.filters;
    const todayKey = dkey(new Date());
    const list = state.ongoing.filter((e) =>
      (e.ongoingUntil || e.date) >= todayKey &&
      (!f.cat || e.category === f.cat) &&
      (!f.town || e.town === f.town) &&
      (!f.q || e._search.includes(f.q)));
    if (!list.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    $('ev-ongoing-count').textContent = list.length;
    const box = $('ev-ongoing-list');
    box.innerHTML = '';
    list.sort((a, b) => (a.ongoingUntil || '').localeCompare(b.ongoingUntil || ''))
      .forEach((e) => {
        const until = e.ongoingUntil
          ? ` — through ${MON_NAMES[new Date(e.ongoingUntil + 'T12:00:00').getMonth()]} ${new Date(e.ongoingUntil + 'T12:00:00').getDate()}`
          : '';
        const row = document.createElement('a');
        row.className = 'ev-ongoing-row';
        row.href = e.url;
        row.target = '_blank';
        row.rel = 'noopener';
        row.innerHTML = `<span class="ev-ongoing-title">${esc(e.title)}</span>` +
          `<span class="ev-ongoing-meta">${esc(e.venue || e.town || '')}${esc(until)}</span>`;
        box.appendChild(row);
      });
  }

  /* ---------------- map ---------------- */

  function renderMap(evs) {
    const mappable = evs.filter((e) => e.lat != null && e.lng != null);
    if (!state.map) {
      state.map = L.map('ev-map', { scrollWheelZoom: false })
        .setView([44.4759, -73.2121], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(state.map);
      state.mapLayer = L.layerGroup().addTo(state.map);
    }
    state.mapLayer.clearLayers();

    // group by venue location
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
      const items = list.slice(0, 8).map((e) =>
        `<li>${esc(e.date.slice(5).replace('-', '/'))}${e.allDay ? '' : ' ' + fmtTime(e._start)} — ` +
        `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a></li>`).join('');
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

  /* ---------------- wiring ---------------- */

  function syncWhenPills() {
    document.querySelectorAll('#ev-when-pills .ev-pill').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.when === state.filters.when));
    });
  }

  function wire() {
    $('ev-bucket-close').addEventListener('click', closeBucket);

    document.querySelectorAll('#ev-when-pills .ev-pill').forEach((b) => {
      b.addEventListener('click', () => {
        state.filters.when = b.dataset.when;
        state.daysShown = 10;
        syncWhenPills();
        renderCalendar();
      });
    });

    let qTimer;
    $('ev-search').addEventListener('input', (ev) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        state.filters.q = ev.target.value.trim().toLowerCase();
        renderCalendar();
      }, 180);
    });

    [['ev-f-category', 'cat'], ['ev-f-town', 'town'], ['ev-f-price', 'price'], ['ev-f-age', 'age']]
      .forEach(([id, key]) => {
        $(id).addEventListener('change', (ev) => {
          state.filters[key] = ev.target.value;
          renderCalendar();
        });
      });

    $('ev-clear').addEventListener('click', () => {
      state.filters = { ...state.filters, q: '', cat: '', town: '', price: '', age: '' };
      $('ev-search').value = '';
      ['ev-f-category', 'ev-f-town', 'ev-f-price', 'ev-f-age'].forEach((id) => { $(id).value = ''; });
      renderCalendar();
    });

    $('ev-more').addEventListener('click', () => {
      state.daysShown += 10;
      renderCalendar();
    });

    $('ev-view-list').addEventListener('click', () => setView('list'));
    $('ev-view-map').addEventListener('click', () => setView('map'));

    $('dark-toggle').addEventListener('click', () => {
      const root = document.documentElement;
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    });

    // refresh time-aware buckets if the tab sits open across a time boundary
    setInterval(() => { if (!state.activeBucket) renderBuckets(); }, 5 * 60e3);
  }

  function setView(v) {
    state.view = v;
    $('ev-view-list').setAttribute('aria-selected', String(v === 'list'));
    $('ev-view-map').setAttribute('aria-selected', String(v === 'map'));
    $('ev-list').hidden = v !== 'list';
    document.querySelector('.ev-more-wrap').hidden = v === 'map';
    $('ev-map-wrap').hidden = v !== 'map';
    if (v === 'map') renderMap(filtered());
  }

  wire();
  load();
})();
