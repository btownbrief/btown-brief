/* ============================================================
   RESTAURANTS — one-tap answers to Burlington's repeated
   food questions, computed live against the current time.
   Depends on js/food-lib.js (window.BTFood).
============================================================ */
(function () {
  'use strict';
  const F = window.BTFood;

  let RESTAURANTS = [];
  let DEALS = [];
  let state = { view: 'open-now', search: '', hood: '', cat: '' };

  /* --- Views: each is one tap, evaluated at render time --- */
  const VIEWS = [
    { id: 'open-now', icon: '🟢', label: 'Open Now',
      explain: 'Everything with verified hours that’s open at this minute.',
      test: (r, t) => F.isOpenAt(r.hours, t.day, t.minutes) },
    { id: 'open-late', icon: '🌙', label: 'Open Late',
      explain: 'Open until 11 PM or later tonight.',
      test: (r, t) => { const c = F.latestCloseTonight(r.hours, t.day); return c !== null && c >= 23 * 60; } },
    { id: 'kitchen-10', icon: '🍳', label: 'Kitchen After 10',
      explain: 'Kitchens confirmed serving food after 10 PM tonight. “Likely” = open late but kitchen close unverified.',
      test: (r, t) => kitchenAfter10(r, t) !== false && kitchenAfter10(r, t) !== null },
    { id: 'patio-now', icon: '☀️', label: 'Patios Right Now',
      explain: 'Outdoor seating at places open at this minute.',
      test: (r, t) => r.patio === true && F.isOpenAt(r.hours, t.day, t.minutes) },
    { id: 'happy-hour', icon: '🍹', label: 'Happy Hour Now',
      explain: 'Happy hours running at this minute (tap a card for the deal).',
      test: (r, t) => dealsFor(r).some(d => d.type === 'happy-hour' && F.dealLiveNow(d, t)) },
    { id: 'deals-today', icon: '🏷️', label: 'Deals Today',
      explain: 'Every special that applies today — tap a card for details, or see the full Deals page.',
      test: (r, t) => dealsFor(r).some(d => F.dealAppliesToday(d, t)) },
    { id: 'under-15', icon: '💸', label: 'Under $15',
      explain: 'A real meal for under fifteen bucks.',
      test: (r) => r.under_15 === true },
    { id: 'new', icon: '✨', label: 'New in Burlington',
      explain: 'Opened in the last 18 months.',
      test: (r, t) => { const m = F.monthsSince(r.opened, t); return m !== null && m <= 18; } },
    { id: 'closing', icon: '⏳', label: 'Closing Soon',
      explain: 'Announced closings — go while you can.',
      test: (r) => !!r.closing },
    { id: 'groups', icon: '👥', label: 'Good for 8',
      explain: 'Can seat a party of eight without a miracle. Call ahead anyway.',
      test: (r) => r.groups_8 === true },
    { id: 'walkable', icon: '🚶', label: 'Walk from Church St',
      explain: 'Within about a 10-minute walk of the Marketplace.',
      test: (r) => F.walkableFromChurchSt(r) },
    { id: 'quiet', icon: '🤫', label: 'Quiet Enough to Talk',
      explain: 'You can hold a conversation at dinner. Editor’s calls — tell us where we’re wrong.',
      test: (r) => r.quiet_talk === true },
    { id: 'solo', icon: '🍜', label: 'Actually Good Alone',
      explain: 'Bar or counter seating where eating solo feels right.',
      test: (r) => r.solo_friendly === true },
    { id: 'tv', icon: '📺', label: 'Watch the Game',
      explain: 'TVs on and the sound up (or at least the score).',
      test: (r) => r.tv_sports === true },
    { id: 'all', icon: '📋', label: 'Everything',
      explain: '',
      test: () => true },
  ];

  /* Kitchen after 10: true (confirmed), 'likely' (open ≥11 PM, kitchen
     unverified), false (kitchen confirmed earlier), null (no signal). */
  function kitchenAfter10(r, t) {
    const kc = F.kitchenCloseTonight(r, t.day);
    if (kc !== null) return kc > 22 * 60;
    const c = F.latestCloseTonight(r.hours, t.day);
    if (c !== null && c >= 23 * 60 && (r.serves_food === true || r.category === 'Restaurant')) return 'likely';
    return null;
  }

  const dealsByRestaurant = {};
  function dealsFor(r) { return dealsByRestaurant[r.id] || []; }

  /* --- Boot --- */
  async function init() {
    initDarkMode();
    try {
      const [rjson, djson] = await Promise.all([
        F.fetchJSON('data/restaurants.json'),
        F.fetchJSON('data/deals.json').catch(() => ({ deals: [] })),
      ]);
      RESTAURANTS = rjson.restaurants.filter(r => !r.closed);
      DEALS = djson.deals || [];
      for (const d of DEALS) {
        if (!d.restaurant_id) continue;
        (dealsByRestaurant[d.restaurant_id] = dealsByRestaurant[d.restaurant_id] || []).push(d);
      }
    } catch (e) {
      document.getElementById('food-loading').innerHTML =
        '<p>Couldn’t load the restaurant data. Refresh to try again.</p>';
      return;
    }
    document.getElementById('food-loading').hidden = true;
    buildFilters();
    buildRail();
    bindUI();
    render();
    tickClock();
    setInterval(() => { buildRail(); render(); tickClock(); }, 60 * 1000); // stay live
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
    document.getElementById('food-clock').textContent = `It’s ${nowStr} in Burlington.`;
  }

  /* --- View rail --- */
  function buildRail() {
    const rail = document.getElementById('view-rail');
    const t = F.now();
    rail.innerHTML = '';
    for (const v of VIEWS) {
      const btn = document.createElement('button');
      btn.className = 'view-chip' + (state.view === v.id ? ' view-chip-active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', state.view === v.id ? 'true' : 'false');
      btn.dataset.view = v.id;
      const n = RESTAURANTS.filter(r => v.test(r, t)).length;
      btn.innerHTML = `<span class="view-chip-icon">${v.icon}</span>` +
        `<span class="view-chip-label">${v.label}</span>` +
        (v.id !== 'all' ? `<span class="view-chip-count">${n}</span>` : '');
      btn.addEventListener('click', () => { state.view = v.id; buildRail(); render(); });
      rail.appendChild(btn);
    }
    // Randomize Dinner: an action, not a filter — pinned at the end
    const rnd = document.createElement('button');
    rnd.className = 'view-chip view-chip-shuffle';
    rnd.innerHTML = '<span class="view-chip-icon">🎲</span><span class="view-chip-label">Randomize Dinner</span>';
    rnd.addEventListener('click', openShuffle);
    rail.appendChild(rnd);
  }

  function buildFilters() {
    const hoods = [...new Set(RESTAURANTS.map(r => r.neighborhood).filter(Boolean))].sort();
    const cats = [...new Set(RESTAURANTS.map(r => r.category).filter(Boolean))].sort();
    fillSelect('food-hood', 'All neighborhoods', hoods);
    fillSelect('food-cat', 'All types', cats);
  }
  function fillSelect(id, blank, opts) {
    const el = document.getElementById(id);
    el.innerHTML = '';
    const mk = (val, label) => {
      const o = document.createElement('option');
      o.value = val; o.textContent = label;
      el.appendChild(o);
    };
    mk('', blank);
    opts.forEach(o => mk(o, o));
  }

  function bindUI() {
    document.getElementById('food-search').addEventListener('input', (e) => { state.search = e.target.value.trim().toLowerCase(); render(); });
    document.getElementById('food-hood').addEventListener('change', (e) => { state.hood = e.target.value; render(); });
    document.getElementById('food-cat').addEventListener('change', (e) => { state.cat = e.target.value; render(); });
    document.getElementById('food-clear').addEventListener('click', () => {
      state = { view: 'all', search: '', hood: '', cat: '' };
      document.getElementById('food-search').value = '';
      document.getElementById('food-hood').value = '';
      document.getElementById('food-cat').value = '';
      buildRail(); render();
    });
    document.getElementById('detail-close').addEventListener('click', closeDetail);
    document.getElementById('detail-overlay').addEventListener('click', closeDetail);
    document.getElementById('shuffle-close').addEventListener('click', closeShuffle);
    document.getElementById('shuffle-again').addEventListener('click', spin);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDetail(); closeShuffle(); } });
  }

  /* --- Rendering --- */
  function currentSet() {
    const t = F.now();
    const view = VIEWS.find(v => v.id === state.view) || VIEWS[VIEWS.length - 1];
    let list = RESTAURANTS.filter(r => view.test(r, t));
    if (state.hood) list = list.filter(r => r.neighborhood === state.hood);
    if (state.cat) list = list.filter(r => r.category === state.cat);
    if (state.search) {
      list = list.filter(r =>
        [r.name, r.category, r.neighborhood, ...(r.cuisine || [])]
          .filter(Boolean).join(' ').toLowerCase().includes(state.search));
    }
    // Open places first within any view, then alphabetical
    list.sort((a, b) => {
      const ao = F.isOpenAt(a.hours, t.day, t.minutes) ? 0 : 1;
      const bo = F.isOpenAt(b.hours, t.day, t.minutes) ? 0 : 1;
      return ao - bo || a.name.localeCompare(b.name);
    });
    return { list, t, view };
  }

  function render() {
    const { list, t, view } = currentSet();
    const grid = document.getElementById('food-grid');
    const explainer = document.getElementById('view-explainer');
    explainer.textContent = view.explain || '';
    explainer.hidden = !view.explain;
    document.getElementById('food-count').textContent =
      `${list.length} ${list.length === 1 ? 'place' : 'places'}`;
    document.getElementById('food-empty').hidden = list.length > 0;
    grid.innerHTML = list.map(r => cardHTML(r, t)).join('');
    grid.querySelectorAll('.food-card').forEach(el => {
      el.addEventListener('click', () => openDetail(el.dataset.id));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(el.dataset.id); }
      });
    });
  }

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function cardHTML(r, t) {
    const st = F.statusLine(r.hours, t);
    const stClass = st.open === null ? 'st-unknown' : st.open ? (st.closingSoon ? 'st-soon' : 'st-open') : 'st-closed';
    const todaysDeals = dealsFor(r).filter(d => F.dealAppliesToday(d, t));
    const liveHH = todaysDeals.find(d => d.type === 'happy-hour' && F.dealLiveNow(d, t));
    const k10 = kitchenAfter10(r, t);
    const tags = [];
    if (r.patio) tags.push('☀️ Patio');
    if (r.quiet_talk) tags.push('🤫 Quiet');
    if (r.solo_friendly) tags.push('🍜 Solo-friendly');
    if (r.tv_sports) tags.push('📺 TVs');
    if (r.groups_8) tags.push('👥 Groups');
    const m = F.monthsSince(r.opened, t);
    const isNew = m !== null && m <= 18;
    return `
    <article class="food-card ${st.open ? '' : 'food-card-closed'}" data-id="${esc(r.id)}" role="listitem" tabindex="0">
      <div class="food-card-top">
        <span class="food-card-price">${esc(r.price || '')}</span>
        ${isNew ? '<span class="food-badge food-badge-new">NEW</span>' : ''}
        ${r.closing ? '<span class="food-badge food-badge-closing">CLOSING</span>' : ''}
      </div>
      <h3 class="food-card-name">${esc(r.name)}</h3>
      <p class="food-card-meta">${esc((r.cuisine?.length ? r.cuisine : [r.category]).slice(0, 2).join(' · '))} · ${esc(r.neighborhood || '')}</p>
      <p class="food-card-status ${stClass}">${esc(st.text)}${state.view === 'kitchen-10' && k10 === 'likely' ? ' · kitchen unverified' : ''}</p>
      ${liveHH ? `<p class="food-card-deal">🍹 ${esc(liveHH.title)} <span class="deal-when">${esc(F.dealTimeLabel(liveHH))}</span></p>`
        : todaysDeals.length ? `<p class="food-card-deal">🏷️ ${esc(todaysDeals[0].title)}${todaysDeals.length > 1 ? ` +${todaysDeals.length - 1} more` : ''}</p>` : ''}
      ${tags.length ? `<p class="food-card-tags">${tags.map(esc).join(' &nbsp; ')}</p>` : ''}
    </article>`;
  }

  /* --- Detail drawer --- */
  function openDetail(id) {
    const r = RESTAURANTS.find(x => x.id === id);
    if (!r) return;
    const t = F.now();
    const st = F.statusLine(r.hours, t);
    const editorial = ['patio', 'quiet_talk', 'solo_friendly', 'tv_sports', 'groups_8']
      .filter(k => r[k] === true);
    const labels = { patio: '☀️ Patio', quiet_talk: '🤫 Quiet enough to talk', solo_friendly: '🍜 Good alone', tv_sports: '📺 Game-watching', groups_8: '👥 Good for 8' };
    const hoursRows = F.DAYS.map(d => {
      const w = (r.hours && r.hours[d]) || [];
      const isToday = d === t.day;
      const txt = w.length ? w.map(([o, c]) => `${F.fmtTime(o)}–${F.fmtTime(c)}`).join(', ') : 'Closed';
      const kc = r.kitchen_close && r.kitchen_close[d];
      return `<tr class="${isToday ? 'hours-today' : ''}"><td>${F.DAY_LABELS[d]}</td><td>${txt}${kc ? `<span class="kitchen-note"> · kitchen til ${F.fmtTime(kc)}</span>` : ''}</td></tr>`;
    }).join('');
    const todaysDeals = dealsFor(r).filter(d => F.dealAppliesToday(d, t));
    const otherDeals = dealsFor(r).filter(d => !F.dealAppliesToday(d, t));
    const dealHTML = (d) => `
      <div class="drawer-deal ${F.dealLiveNow(d, t) && F.dealAppliesToday(d, t) ? 'drawer-deal-live' : ''}">
        <span class="drawer-deal-title">${d.type === 'happy-hour' ? '🍹' : '🏷️'} ${esc(d.title)}</span>
        <span class="drawer-deal-when">${esc(F.dealDaysLabel(d))}${F.dealTimeLabel(d) ? ' · ' + esc(F.dealTimeLabel(d)) : ''}</span>
        ${d.last_verified ? `<span class="drawer-deal-verified">verified ${esc(d.last_verified)}</span>` : ''}
      </div>`;
    document.getElementById('detail-content').innerHTML = `
      <div class="drawer-food">
        <p class="drawer-kicker">${esc((r.cuisine?.length ? r.cuisine : [r.category]).join(' · '))} · ${esc(r.price || '')}</p>
        <h2 class="drawer-name">${esc(r.name)}</h2>
        <p class="drawer-status ${st.open ? 'st-open' : 'st-closed'}">${esc(st.text)}</p>
        ${r.blurb ? `<p class="drawer-blurb">${esc(r.blurb)}</p>` : ''}
        <table class="drawer-hours"><tbody>${hoursRows}</tbody></table>
        ${r.hours_confidence === 'conflict' ? '<p class="drawer-note">⚠️ Our sources disagree on these hours — we’re verifying. Call before a special trip.</p>'
          : r.hours_confidence === 'unverified' ? '<p class="drawer-note">Hours not yet verified against the restaurant directly.</p>' : ''}
        ${editorial.length ? `<div class="drawer-tags">${editorial.map(k => `<span class="drawer-tag">${labels[k]}</span>`).join('')}</div>
          <p class="drawer-editorial-note">Vibe calls are the editor’s — <a href="mailto:stephenvdavis@gmail.com?subject=Vibe%20check%3A%20${encodeURIComponent(r.name)}">disagree?</a></p>` : ''}
        ${todaysDeals.length || otherDeals.length ? `<h3 class="drawer-h3">Deals</h3>${[...todaysDeals, ...otherDeals].map(dealHTML).join('')}` : ''}
        <div class="drawer-links">
          ${F.safeUrl(r.links?.website) ? `<a class="btn-outline" href="${esc(F.safeUrl(r.links.website))}" target="_blank" rel="noopener">Website ↗</a>` : ''}
          ${F.safeUrl(r.links?.google_maps) ? `<a class="btn-outline" href="${esc(F.safeUrl(r.links.google_maps))}" target="_blank" rel="noopener">Directions ↗</a>` : ''}
        </div>
        <p class="drawer-address">${esc(r.address || '')}</p>
      </div>`;
    document.getElementById('detail-drawer').hidden = false;
    const ov = document.getElementById('detail-overlay');
    ov.setAttribute('aria-hidden', 'false');
    ov.classList.add('open');
    document.body.classList.add('drawer-open');
  }
  function closeDetail() {
    document.getElementById('detail-drawer').hidden = true;
    const ov = document.getElementById('detail-overlay');
    ov.setAttribute('aria-hidden', 'true');
    ov.classList.remove('open');
    document.body.classList.remove('drawer-open');
  }

  /* --- Randomize Dinner --- */
  let spinTimer = null;
  function dinnerPool() {
    const t = F.now();
    // Before 4 PM: anywhere serving dinner tonight (open at 7 PM). After: open now.
    const dinnerCheck = t.minutes < 16 * 60
      ? (r) => F.isOpenAt(r.hours, t.day, 19 * 60)
      : (r) => F.isOpenAt(r.hours, t.day, t.minutes);
    return RESTAURANTS.filter(r =>
      ['Restaurant'].includes(r.category) || (r.serves_food !== false && (r.cuisine || []).length)
    ).filter(dinnerCheck);
  }
  function openShuffle() {
    document.getElementById('shuffle-overlay').hidden = false;
    document.body.classList.add('drawer-open');
    spin();
  }
  function closeShuffle() {
    clearInterval(spinTimer);
    document.getElementById('shuffle-overlay').hidden = true;
    document.body.classList.remove('drawer-open');
  }
  function spin() {
    const pool = dinnerPool();
    const nameEl = document.getElementById('shuffle-name');
    const metaEl = document.getElementById('shuffle-meta');
    const actions = document.getElementById('shuffle-actions');
    actions.hidden = true;
    metaEl.textContent = '';
    if (!pool.length) {
      nameEl.textContent = 'Everything’s closed 😴';
      metaEl.textContent = 'Burlington sleeps. Try Kitchen After 10 tomorrow.';
      return;
    }
    clearInterval(spinTimer);
    let ticks = 0;
    const total = 22 + Math.floor(Math.random() * 8);
    spinTimer = setInterval(() => {
      ticks++;
      const r = pool[Math.floor(Math.random() * pool.length)];
      nameEl.textContent = r.name;
      if (ticks >= total) {
        clearInterval(spinTimer);
        land(r);
      }
    }, 70 + ticks * 2);
  }
  function land(r) {
    const t = F.now();
    const st = F.statusLine(r.hours, t);
    document.getElementById('shuffle-name').textContent = r.name;
    document.getElementById('shuffle-meta').textContent =
      `${(r.cuisine?.length ? r.cuisine : [r.category]).join(' · ')} · ${r.neighborhood || ''} · ${st.text}`;
    const go = document.getElementById('shuffle-go');
    go.href = F.safeUrl(r.links?.google_maps) || F.safeUrl(r.links?.website) || '#';
    document.getElementById('shuffle-actions').hidden = false;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
