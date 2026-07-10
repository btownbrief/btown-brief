/* ============================================================
   DEALS — every happy hour & special, by day, live-aware.
   Feeds the Wednesday newsletter section. Depends on food-lib.js.
============================================================ */
(function () {
  'use strict';
  const F = window.BTFood;

  let DEALS = [];
  let RESTAURANTS = {};
  let selectedDay = null; // null = today

  async function init() {
    initDarkMode();
    try {
      const [djson, rjson] = await Promise.all([
        F.fetchJSON('data/deals.json'),
        F.fetchJSON('data/restaurants.json').catch(() => ({ restaurants: [] })),
      ]);
      DEALS = (djson.deals || []).filter(d => !d.retired);
      for (const r of rjson.restaurants || []) RESTAURANTS[r.id] = r;
    } catch (e) {
      document.getElementById('deals-loading').innerHTML = '<p>Couldn’t load the deals. Refresh to try again.</p>';
      return;
    }
    document.getElementById('deals-loading').hidden = true;
    buildDayNav();
    render();
    tickClock();
    let lastDate = F.now().dateStr;
    setInterval(() => {
      const t = F.now();
      if (t.dateStr !== lastDate) { lastDate = t.dateStr; buildDayNav(); }
      render(); tickClock();
    }, 60 * 1000);
  }

  function initDarkMode() {
    const saved = localStorage.getItem('btb-theme');
    if (saved) document.documentElement.dataset.theme = saved;
    document.getElementById('dark-toggle').addEventListener('click', () => {
      const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = cur;
      localStorage.setItem('btb-theme', cur);
    });
  }

  function tickClock() {
    const nowStr = new Intl.DateTimeFormat('en-US', {
      timeZone: F.TZ, weekday: 'long', hour: 'numeric', minute: '2-digit',
    }).format(new Date());
    document.getElementById('deals-clock').textContent = `It’s ${nowStr}.`;
  }

  function buildDayNav() {
    const nav = document.getElementById('deals-day-nav');
    const t = F.now();
    nav.innerHTML = '';
    const mk = (label, day) => {
      const b = document.createElement('button');
      b.className = 'deals-day-btn';
      b.textContent = label;
      b.dataset.day = day ?? '';
      b.addEventListener('click', () => { selectedDay = day; buildDayNav(); render(); });
      if ((selectedDay ?? null) === (day ?? null)) b.classList.add('deals-day-btn-active');
      return b;
    };
    nav.appendChild(mk('Today', null));
    for (let i = 1; i <= 6; i++) {
      const d = F.DAYS[(t.dayIdx + i) % 7];
      nav.appendChild(mk(F.DAY_LABELS[d], d));
    }
  }

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function dealCard(d, live) {
    const r = d.restaurant_id ? RESTAURANTS[d.restaurant_id] : null;
    const link = F.safeUrl(d.link) || F.safeUrl(r?.links?.website) || null;
    const reported = !!F.getReports()[d.id];
    return `
    <article class="deal-card ${live ? 'deal-card-live' : ''}" data-id="${esc(d.id)}">
      ${live ? '<span class="deal-live-pill">ON NOW</span>' : ''}
      <span class="deal-card-business">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(d.business)} ↗</a>` : esc(d.business)}</span>
      <span class="deal-card-title">${esc(d.title)}</span>
      <span class="deal-card-when">${esc(F.dealDaysLabel(d))}${F.dealTimeLabel(d) ? ' · ' + esc(F.dealTimeLabel(d)) : ''}</span>
      <div class="deal-card-foot">
        <span>${d.last_verified ? `Verified ${esc(d.last_verified)}` : 'Unverified'}</span>
        <button class="deal-expired-btn ${reported ? 'deal-expired-done' : ''}" data-deal="${esc(d.id)}" ${reported ? 'disabled' : ''}>
          ${reported ? '✓ reported — thanks' : 'this expired?'}
        </button>
      </div>
    </article>`;
  }

  function render() {
    const t = F.now();
    const day = selectedDay || t.day;
    const isToday = day === t.day;
    const todays = DEALS.filter(d => !d.days || d.days.includes(day));

    const live = isToday ? todays.filter(d => F.dealLiveNow(d, t) && d.type === 'happy-hour') : [];
    const liveIds = new Set(live.map(d => d.id));
    const hh = todays.filter(d => d.type === 'happy-hour' && !liveIds.has(d.id));
    const other = todays.filter(d => d.type !== 'happy-hour');

    const dayName = isToday ? 'today' : F.DAY_LABELS[day];
    setSection('deals-live-wrap', 'deals-live', live, t, true);
    setSection('deals-hh-wrap', 'deals-hh', hh, t, false, `Happy hours ${dayName === 'today' ? 'today' : 'on ' + dayName}`);
    setSection('deals-other-wrap', 'deals-other', other, t, false, `Deals & specials ${dayName === 'today' ? 'today' : 'on ' + dayName}`);
    document.getElementById('deals-empty').hidden = todays.length > 0;
    bindExpired();
  }

  function setSection(wrapId, gridId, deals, t, live, label) {
    const wrap = document.getElementById(wrapId);
    wrap.hidden = deals.length === 0;
    if (label) {
      const el = wrap.querySelector('.deals-section-label');
      el.innerHTML = `${esc(label)} <small>${deals.length}</small>`;
    }
    deals.sort((a, b) => (F.toMin(a.start) ?? 9999) - (F.toMin(b.start) ?? 9999) || a.business.localeCompare(b.business));
    document.getElementById(gridId).innerHTML = deals.map(d => dealCard(d, live)).join('');
  }

  function bindExpired() {
    document.querySelectorAll('.deal-expired-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        const d = DEALS.find(x => x.id === btn.dataset.deal);
        if (!d) return;
        const mailto = F.reportExpired(d);
        btn.textContent = '✓ reported — thanks';
        btn.classList.add('deal-expired-done');
        btn.disabled = true;
        window.location.href = mailto; // opens prefilled email = the review queue
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
