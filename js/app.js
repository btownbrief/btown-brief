/* ============================================================
   THINGS TO DO IN BURLINGTON — app.js
   Handles: data loading, List mode, filtering, search,
            detail drawer, dark mode, mode switching.
   No framework, no build step.
============================================================ */

(function () {
  'use strict';

  // Shared namespace — guides.js reads BTV.things and BTV.filterThings
  window.BTV = window.BTV || {};

  /* ----------------------------------------------------------
     STATE
  ---------------------------------------------------------- */
  const state = {
    things: [],
    taxonomy: {},
    events: [],
    calendar: [],
    eventsWeek: { days: [] },
    sponsors: [],
    faq: [],
    photos: [],
    reddit: { posts: [] },
    newsletter: {},
    filters: {
      group: [], category: [], neighborhood: [],
      cost_tier: [], season: [], time_of_day: [],
      indoor_outdoor: [], good_for: [], vibe: [],
      freeOnly: false, hasGuide: false,
    },
    search: '',
    sort: 'featured',
    openDetailId: null,
    _leafletMap: null,
    _leafletMarker: null,
  };

  /* ----------------------------------------------------------
     DATA LOADING
  ---------------------------------------------------------- */
  async function loadData() {
    try {
      const [things, taxonomy, events, guides] = await Promise.all([
        fetchJSON('data/things.json'),
        fetchJSON('data/taxonomy.json'),
        fetchJSON('data/events.json'),
        fetchJSON('data/guides.json'),
      ]);
      // Optional data — the site works fine if any of these are missing.
      const [sponsors, faq, photos, reddit, newsletter, calendar] = await Promise.all([
        fetchJSON('data/sponsors.json').catch(() => []),
        fetchJSON('data/faq.json').catch(() => []),
        fetchJSON('data/photos.json').catch(() => []),
        fetchJSON('data/reddit.json').catch(() => ({ posts: [] })),
        fetchJSON('data/newsletter.json').catch(() => ({})),
        fetchJSON('data/calendar.json').catch(() => []),
      ]);
      const eventsWeek = await fetchJSON('data/events-week.json').catch(() => ({ days: [] }));
      state.things = things || [];
      state.taxonomy = taxonomy || {};
      state.events = events || [];
      state.calendar = calendar || [];
      state.eventsWeek = eventsWeek || { days: [] };
      state.sponsors = sponsors || [];
      state.faq = faq || [];
      state.photos = photos || [];
      state.reddit = reddit || { posts: [] };
      state.newsletter = newsletter || {};
      window.BTV.things = state.things;
      window.BTV.taxonomy = state.taxonomy;
      window.BTV.guides = guides || [];
      window.BTV.filterThings = filterThings;
      window.BTV.openDetail = openDetail;
      init();
    } catch (err) {
      console.error('Failed to load data:', err);
      showDataError();
    }
  }

  async function fetchJSON(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return res.json();
  }

  function showDataError() {
    const loading = document.getElementById('loading-state');
    if (loading) {
      loading.innerHTML = '<p>Could not load data. <strong>Run a local server:</strong> open a terminal in this folder and run <code>python3 -m http.server 8000</code>, then visit <a href="http://localhost:8000">localhost:8000</a>.</p>';
      loading.style.maxWidth = '520px';
    }
  }

  /* ----------------------------------------------------------
     INIT
  ---------------------------------------------------------- */
  function init() {
    // Hide loading, show content
    hide('loading-state');

    renderEventsWeek();
    renderEvents();
    renderNewsletterBar();
    renderFilters();
    renderList();
    renderCommunity();
    setupEventListeners();

    // Init guides.js if loaded
    if (typeof window.BTV.initGuides === 'function') {
      window.BTV.initGuides();
    }
    // Guides carousel on the List view
    if (typeof window.BTV.renderGuidesRail === 'function') {
      window.BTV.renderGuidesRail();
    }
  }

  /* ----------------------------------------------------------
     EVENTS STRIP
  ---------------------------------------------------------- */
  // Events This Week — curated day-by-day picks pulled from the newsletter
  // (data/events-week.json). Days already past are hidden client-side, so
  // Monday's picks drop off on Tuesday, etc., without waiting for a refresh.
  function renderEventsWeek() {
    const data  = state.eventsWeek || { days: [] };
    const strip = document.getElementById('week-strip');
    const list  = document.getElementById('week-list');
    if (!strip || !list) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const pad = n => String(n).padStart(2, '0');
    const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

    const days = (data.days || []).filter(d => {
      if (!d.date) return true;
      const dt = new Date(d.date + 'T00:00:00');
      return isNaN(dt) || dt >= today;
    });
    if (days.length === 0) return;

    const url = data.issue_url || 'https://www.btownbrief.com';

    // Trim the redundant leading weekday and keep a compact one-liner —
    // the full paragraph lives in the newsletter behind the link.
    const shorten = (text, label) => {
      let t = String(text || '').replace(
        new RegExp('^' + label + '\\b[\\s,]*', 'i'), '').trim();
      t = t.charAt(0).toUpperCase() + t.slice(1);
      if (t.length > 96) t = t.slice(0, 96).replace(/\s+\S*$/, '') + '…';
      return t;
    };

    list.innerHTML = days.map(d => {
      const isToday = d.date === todayIso;
      const dateLabel = isToday ? 'Today' : (d.label || '');
      return `
        <div class="event-card" role="listitem">
          <span class="event-date">${esc(dateLabel)}</span>
          <span class="event-name">${esc(shorten(d.text, d.label || ''))}</span>
          <a class="event-link" href="${esc(url)}" target="_blank" rel="noopener" aria-label="Read the full picks in the Brief">→</a>
        </div>
      `;
    }).join('');

    strip.hidden = false;
  }

  // Upcoming events — reads data/calendar.json (the 6-month calendar),
  // hides anything already past, sorts soonest-first, shows the next dozen.
  function renderEvents() {
    const source = (state.calendar && state.calendar.length) ? state.calendar : state.events;
    if (!source || source.length === 0) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcoming = source
      .filter(e => !e.hidden)
      .filter(e => {
        if (!e.date) return true;
        const d = new Date(e.date);
        return isNaN(d) || d >= today;
      })
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
      .slice(0, 12);

    if (upcoming.length === 0) return;

    const strip = document.getElementById('events-strip');
    const list  = document.getElementById('events-list');
    if (!strip || !list) return;

    list.innerHTML = upcoming.map(e => `
      <div class="event-card" role="listitem">
        <span class="event-date">${esc(e.date_display || e.date)}</span>
        <span class="event-name">${esc(e.name)}</span>
        ${e.note ? `<span class="event-note">${esc(e.note)}</span>` : ''}
        ${e.link ? `<a class="event-link" href="${esc(e.link)}" target="_blank" rel="noopener" aria-label="More about ${esc(e.name)}">→</a>` : ''}
      </div>
    `).join('');

    strip.hidden = false;
  }

  /* ----------------------------------------------------------
     NEWSLETTER TEASER BAR
     Teasers only — title + date + link, never full content.
  ---------------------------------------------------------- */
  function renderNewsletterBar() {
    const issueEl   = document.getElementById('newsletter-issue');
    const previewEl = document.getElementById('newsletter-preview');
    const barLink   = document.getElementById('newsletter-bar');
    const briefLink = document.getElementById('weather-brief-link');
    const n = state.newsletter;
    if (!issueEl || !n || !n.title) return;

    let dateStr = '';
    if (n.date) {
      const d = new Date(n.date);
      if (!isNaN(d)) {
        dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
    }
    issueEl.textContent = dateStr ? `${n.title} · ${dateStr}` : n.title;

    // Auto-pulled intro/preview from the newsletter (via the refresh Action)
    if (previewEl && n.preview) {
      previewEl.textContent = n.preview;
      previewEl.hidden = false;
    }

    // Whole bar links to the latest issue; the weather menu shares the link.
    if (n.url) {
      if (barLink) barLink.href = n.url;
      if (briefLink) briefLink.href = n.url;
    }
  }

  /* ----------------------------------------------------------
     COMMUNITY SECTION (photos, Reddit, FAQ) + SPONSORS
     Everything here collapses cleanly when its data is empty.
  ---------------------------------------------------------- */
  function renderCommunity() {
    renderPhotos();
    renderReddit();
    renderFAQ();
    renderSponsorFooter();
  }

  function renderPhotos() {
    const strip = document.getElementById('photo-strip');
    const emptyNote = document.getElementById('photos-empty');
    const photos = (state.photos || []).slice().sort((a, b) =>
      String(b.date || '').localeCompare(String(a.date || ''))
    );
    if (!strip) return;
    if (photos.length === 0) return; // keep the invite note visible

    strip.innerHTML = photos.slice(0, 8).map(p => `
      <figure class="photo-card">
        <img src="${esc(p.image)}" alt="${esc(p.caption || 'Community photo of Burlington')}" loading="lazy">
        <figcaption>
          ${p.caption ? `<span class="photo-caption">${esc(p.caption)}</span>` : ''}
          ${p.credit ? `<span class="photo-credit">📷 ${esc(p.credit)}</span>` : ''}
        </figcaption>
      </figure>
    `).join('');
    strip.hidden = false;
    if (emptyNote) emptyNote.hidden = true;
  }

  function renderReddit() {
    const block = document.getElementById('reddit-block');
    const list  = document.getElementById('reddit-list');
    const posts = (state.reddit && state.reddit.posts) || [];
    if (!block || !list || posts.length === 0) return;

    list.innerHTML = posts.map(p => `
      <a class="reddit-post" href="${esc(p.url)}" target="_blank" rel="noopener">
        <span class="reddit-score" aria-label="${esc(p.score)} upvotes">▲ ${esc(p.score)}</span>
        <span class="reddit-title">${esc(p.title)}</span>
      </a>
    `).join('');
    block.hidden = false;
  }

  function renderFAQ() {
    const block = document.getElementById('faq-block');
    const list  = document.getElementById('faq-list');
    const faq = state.faq || [];
    if (!block || !list || faq.length === 0) return;

    list.innerHTML = faq.map((item, i) => `
      <details class="faq-item" ${i === 0 ? 'open' : ''}>
        <summary>${esc(item.question)}</summary>
        <div class="faq-answer">
          <p>${esc(item.answer)}</p>
          ${(item.reddit_links || []).map(l =>
            `<a class="faq-reddit-link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || 'How locals answered')} →</a>`
          ).join('')}
        </div>
      </details>
    `).join('');
    block.hidden = false;
  }

  function activeSponsors(placement) {
    return (state.sponsors || []).filter(s => s.active && s.placement === placement);
  }

  function renderSponsorFooter() {
    const el = document.getElementById('sponsor-footer');
    const sponsors = activeSponsors('footer');
    if (!el || sponsors.length === 0) return;

    el.innerHTML = `
      <span class="sponsor-label">Sponsored</span>
      <div class="sponsor-row">
        ${sponsors.map(s => `
          <a class="sponsor-item" href="${esc(s.url)}" target="_blank" rel="noopener sponsored">
            ${s.image ? `<img src="${esc(s.image)}" alt="${esc(s.name)}" loading="lazy">` : esc(s.name)}
          </a>
        `).join('')}
      </div>
    `;
    el.hidden = false;
  }

  // In-list sponsor card, injected every N cards (placement: "list")
  function renderSponsorCard(s) {
    return `
      <article class="card card-sponsor" role="listitem">
        <div class="card-body">
          <span class="sponsor-label">Sponsored</span>
          <a class="sponsor-item" href="${esc(s.url)}" target="_blank" rel="noopener sponsored">
            ${s.image ? `<img src="${esc(s.image)}" alt="${esc(s.name)}" loading="lazy">` : `<h3 class="card-name">${esc(s.name)}</h3>`}
          </a>
        </div>
      </article>
    `;
  }

  /* ----------------------------------------------------------
     FILTER PANEL
  ---------------------------------------------------------- */
  function renderFilters() {
    const container = document.getElementById('filter-sections');
    if (!container || !state.taxonomy) return;

    const sections = [
      { key: 'group',         label: 'Category',      values: state.taxonomy.group },
      { key: 'neighborhood',  label: 'Neighborhood',  values: state.taxonomy.neighborhood },
      { key: 'cost_tier',     label: 'Price',         values: state.taxonomy.cost_tier },
      { key: 'good_for',      label: 'Good for',      values: state.taxonomy.good_for },
      { key: 'vibe',          label: 'Vibe',          values: state.taxonomy.vibe },
      { key: 'season',        label: 'Season',        values: state.taxonomy.season },
      { key: 'indoor_outdoor',label: 'Setting',       values: state.taxonomy.indoor_outdoor },
    ];

    container.innerHTML = sections.map((sec, i) => `
      <div class="filter-section">
        <button
          class="filter-section-toggle"
          aria-expanded="${i < 3 ? 'true' : 'false'}"
          aria-controls="filter-body-${sec.key}"
          data-filter-key="${sec.key}"
        >
          <span>${sec.label}</span>
          <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <div class="filter-section-body" id="filter-body-${sec.key}" ${i >= 3 ? 'hidden' : ''}>
          ${(sec.values || []).map(val => `
            <label class="filter-chip ${isFilterActive(sec.key, val) ? 'active' : ''}">
              <input type="checkbox" data-filter="${sec.key}" value="${val}" ${isFilterActive(sec.key, val) ? 'checked' : ''}>
              ${esc(val)}
            </label>
          `).join('')}
        </div>
      </div>
    `).join('');

    // Collapse toggles
    container.querySelectorAll('.filter-section-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!expanded));
        const body = document.getElementById(btn.getAttribute('aria-controls'));
        if (body) body.hidden = expanded;
      });
    });

    // Checkbox changes
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const key = cb.dataset.filter;
        const val = cb.value;
        if (cb.checked) {
          if (!state.filters[key].includes(val)) state.filters[key].push(val);
        } else {
          state.filters[key] = state.filters[key].filter(v => v !== val);
        }
        updateFilterChipState();
        renderList();
        updateActiveFilterCount();
      });
    });
  }

  function isFilterActive(key, val) {
    return state.filters[key] && state.filters[key].includes(val);
  }

  function updateFilterChipState() {
    document.querySelectorAll('.filter-chip').forEach(chip => {
      const cb = chip.querySelector('input');
      if (cb) chip.classList.toggle('active', cb.checked);
    });
  }

  function updateActiveFilterCount() {
    const count = getTotalActiveFilters();
    const badge = document.getElementById('active-filter-count');
    const btn = document.getElementById('filter-toggle');
    if (badge) {
      badge.hidden = count === 0;
      badge.textContent = count;
    }
    if (btn) btn.classList.toggle('active', count > 0);
  }

  function getTotalActiveFilters() {
    const fieldCounts = ['group','category','neighborhood','cost_tier','good_for','vibe','season','time_of_day','indoor_outdoor']
      .reduce((n, k) => n + (state.filters[k] ? state.filters[k].length : 0), 0);
    return fieldCounts + (state.filters.freeOnly ? 1 : 0) + (state.filters.hasGuide ? 1 : 0);
  }

  function clearAllFilters() {
    ['group','category','neighborhood','cost_tier','season','time_of_day','indoor_outdoor','good_for','vibe'].forEach(k => {
      state.filters[k] = [];
    });
    state.filters.freeOnly = false;
    state.filters.hasGuide = false;
    state.search = '';

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    const searchClear = document.getElementById('search-clear');
    if (searchClear) searchClear.hidden = true;

    const freeOnly = document.getElementById('free-only');
    const hasGuide = document.getElementById('has-guide');
    if (freeOnly) freeOnly.checked = false;
    if (hasGuide) hasGuide.checked = false;

    // Re-render filters to reset chip states
    renderFilters();
    updateActiveFilterCount();
    renderList();
  }

  /* ----------------------------------------------------------
     FILTER LOGIC  (also exported to BTV.filterThings)
  ---------------------------------------------------------- */
  function filterThings(things, filters, search) {
    let result = things;

    // Text search: name, blurb, neighborhood, vibe, good_for
    if (search && search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(t =>
        (t.name || '').toLowerCase().includes(q) ||
        (t.blurb || '').toLowerCase().includes(q) ||
        (t.neighborhood || '').toLowerCase().includes(q) ||
        (t.category || '').toLowerCase().includes(q) ||
        (t.group || '').toLowerCase().includes(q) ||
        (t.vibe || []).some(v => v.toLowerCase().includes(q)) ||
        (t.good_for || []).some(g => g.toLowerCase().includes(q))
      );
    }

    // Quick toggles
    if (filters.freeOnly) result = result.filter(t => t.cost_tier === 'Free');
    if (filters.hasGuide) result = result.filter(t => t.has_guide);

    // Taxonomy fields: AND across fields, OR within a field
    const arrayFields = ['group','category','neighborhood','cost_tier','good_for','vibe','season','time_of_day'];
    for (const field of arrayFields) {
      const active = filters[field];
      if (active && active.length > 0) {
        result = result.filter(t => {
          const val = t[field];
          if (!val) return false;
          if (Array.isArray(val)) return val.some(v => active.includes(v));
          return active.includes(val);
        });
      }
    }

    // Indoor/outdoor (single-value field)
    if (filters.indoor_outdoor && filters.indoor_outdoor.length > 0) {
      result = result.filter(t => {
        if (!t.indoor_outdoor) return false;
        if (filters.indoor_outdoor.includes('Both')) return true;
        if (filters.indoor_outdoor.includes(t.indoor_outdoor)) return true;
        if (t.indoor_outdoor === 'Both') return true;
        return false;
      });
    }

    return result;
  }

  /* ----------------------------------------------------------
     SORT LOGIC
  ---------------------------------------------------------- */
  function sortThings(things, sort) {
    const arr = [...things];
    if (sort === 'alpha') {
      return arr.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (sort === 'neighborhood') {
      return arr.sort((a, b) => {
        const n = (a.neighborhood || 'z').localeCompare(b.neighborhood || 'z');
        return n !== 0 ? n : a.name.localeCompare(b.name);
      });
    }
    // featured: guides first, then alphabetical
    return arr.sort((a, b) => {
      if (a.has_guide && !b.has_guide) return -1;
      if (!a.has_guide && b.has_guide) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  /* ----------------------------------------------------------
     RENDER LIST
  ---------------------------------------------------------- */
  function renderList() {
    const filtered = filterThings(state.things, state.filters, state.search);
    const sorted = sortThings(filtered, state.sort);

    const grid = document.getElementById('cards-grid');
    const countEl = document.getElementById('result-count');
    const emptyEl = document.getElementById('empty-state');

    if (!grid) return;

    if (sorted.length === 0) {
      grid.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      if (countEl) countEl.textContent = '';
      return;
    }

    if (emptyEl) emptyEl.hidden = true;
    if (countEl) {
      const total = state.things.length;
      countEl.textContent = sorted.length === total
        ? `${total} places`
        : `Showing ${sorted.length} of ${total}`;
    }

    // Inject in-list sponsor cards (placement "list") every 12 entries
    const listSponsors = activeSponsors('list');
    const parts = [];
    sorted.forEach((t, i) => {
      parts.push(renderCard(t));
      if (listSponsors.length > 0 && (i + 1) % 12 === 0) {
        parts.push(renderSponsorCard(listSponsors[((i + 1) / 12 - 1) % listSponsors.length]));
      }
    });
    grid.innerHTML = parts.join('');

    // Card click → open detail
    grid.querySelectorAll('.card').forEach(card => {
      card.addEventListener('click', () => openDetail(card.dataset.id));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDetail(card.dataset.id);
        }
      });
    });

    // Website links open the site, not the drawer
    grid.querySelectorAll('.card-website-link').forEach(link => {
      link.addEventListener('click', e => e.stopPropagation());
    });

    // Guide links (stop propagation so they don't open the drawer)
    grid.querySelectorAll('.card-guide-link').forEach(link => {
      link.addEventListener('click', e => {
        e.stopPropagation();
        const id = link.dataset.guideId;
        if (id && typeof window.BTV.showGuide === 'function') {
          switchMode('guides');
          window.BTV.showGuide(id);
        }
      });
    });
  }

  function renderCard(t) {
    const costClass = costTierClass(t.cost_tier);
    const vibes = (t.vibe || []).slice(0, 3).map(v => `<span class="vibe-tag">${esc(v)}</span>`).join('');
    const guideLink = t.has_guide
      ? `<button class="card-guide-link" data-guide-id="${t.guide_id || t.id}" aria-label="Read guide for ${esc(t.name)}">Read guide →</button>`
      : '';
    const websiteLink = t.website
      ? `<a class="card-website-link" href="${esc(t.website)}" target="_blank" rel="noopener" aria-label="Website for ${esc(t.name)}">Website ↗</a>`
      : '';

    return `
      <article class="card" data-id="${t.id}" data-group="${esc(t.group || '')}" role="listitem" tabindex="0" aria-label="${esc(t.name)}">
        <div class="card-stripe" aria-hidden="true"></div>
        <div class="card-body">
          <div class="card-meta-top">
            <span class="cost-badge ${costClass}">${esc(t.cost_tier || '?')}</span>
            <span class="card-neighborhood">${esc(t.neighborhood || '')}</span>
          </div>
          <h3 class="card-name">${esc(t.name)}</h3>
          <p class="card-blurb">${esc(t.blurb || '')}</p>
          ${vibes ? `<div class="card-vibes" aria-label="Vibes">${vibes}</div>` : ''}
        </div>
        <div class="card-footer">
          <span class="card-category-label">${esc(t.group || '')}${t.category ? ' · ' + t.category : ''}</span>
          <span class="card-footer-links">${websiteLink}${guideLink}</span>
        </div>
      </article>
    `;
  }

  function costTierClass(tier) {
    if (tier === 'Free') return 'free';
    if (tier === '$')   return 'tier-1';
    if (tier === '$$')  return 'tier-2';
    if (tier === '$$$') return 'tier-3';
    return '';
  }

  /* ----------------------------------------------------------
     DETAIL DRAWER
  ---------------------------------------------------------- */
  function openDetail(id) {
    const thing = state.things.find(t => t.id === id);
    if (!thing) return;

    state.openDetailId = id;
    const content = document.getElementById('detail-content');
    const drawer  = document.getElementById('detail-drawer');
    const overlay = document.getElementById('detail-overlay');
    if (!content || !drawer) return;

    content.innerHTML = buildDetailHTML(thing);
    drawer.hidden = false;
    overlay.classList.add('open');
    drawer.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';

    // Focus the close button
    requestAnimationFrame(() => {
      const closeBtn = document.getElementById('detail-close');
      if (closeBtn) closeBtn.focus();
    });

    // Init Leaflet map if coords exist
    initDetailMap(thing);

    // Guide link in detail
    const guideBtn = content.querySelector('.js-detail-guide');
    if (guideBtn) {
      guideBtn.addEventListener('click', () => {
        closeDetail();
        const guideId = guideBtn.dataset.guideId;
        if (guideId && typeof window.BTV.showGuide === 'function') {
          switchMode('guides');
          window.BTV.showGuide(guideId);
        }
      });
    }
  }

  function closeDetail() {
    const drawer  = document.getElementById('detail-drawer');
    const overlay = document.getElementById('detail-overlay');
    if (drawer) drawer.hidden = true;
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
    state.openDetailId = null;

    // Clean up Leaflet
    if (state._leafletMap) {
      state._leafletMap.remove();
      state._leafletMap = null;
      state._leafletMarker = null;
    }
  }

  function buildDetailHTML(t) {
    const costClass = costTierClass(t.cost_tier);
    const allTags = [
      ...(t.good_for || []),
      ...(t.vibe || []),
      ...(t.season || []),
      ...(t.time_of_day || []),
      t.indoor_outdoor,
    ].filter(Boolean);

    const tagsHTML = allTags.map(tag => `<span class="detail-tag">${esc(tag)}</span>`).join('');

    const mapHTML = (t.coords && Array.isArray(t.coords) && t.coords[0])
      ? `<div id="detail-map" class="detail-map" aria-label="Map showing ${esc(t.name)}"></div>`
      : '';

    const addressRow = t.address
      ? `<div class="detail-info-row">
           <svg class="detail-info-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
           <span class="detail-info-text">${esc(t.address)}</span>
         </div>` : '';

    const costRow = t.cost_note
      ? `<div class="detail-info-row">
           <svg class="detail-info-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
           <span class="detail-info-text">${esc(t.cost_note)}</span>
         </div>` : '';

    const guideBtn = t.has_guide
      ? `<button class="btn-secondary js-detail-guide" data-guide-id="${t.guide_id || t.id}">Read the guide →</button>`
      : '';

    const websiteBtn = t.website
      ? `<a class="btn-primary" href="${t.website}" target="_blank" rel="noopener">Visit website ↗</a>`
      : '';

    return `
      <div class="detail-group-stripe ${t.group ? '' : ''}" data-group="${esc(t.group || '')}" style="background: var(--group-${groupKey(t.group)})"></div>
      <div class="detail-main">
        <div class="detail-cost-row">
          <span class="cost-badge ${costClass}">${esc(t.cost_tier || '?')}</span>
          <span class="card-category-label">${esc(t.group || '')}${t.category ? ' · ' + t.category : ''}</span>
        </div>
        <h2 class="detail-name">${esc(t.name)}</h2>
        <p class="detail-neighborhood">${esc(t.neighborhood || '')}</p>
        <p class="detail-blurb">${esc(t.blurb || '')}</p>

        ${t.why_special ? `
          <p class="detail-section-label">What makes it worth it</p>
          <blockquote class="detail-why-special">${esc(t.why_special)}</blockquote>
        ` : ''}

        ${tagsHTML ? `<div class="detail-tags-row" aria-label="Tags">${tagsHTML}</div>` : ''}

        ${(addressRow || costRow) ? `<div class="detail-info-block">${addressRow}${costRow}</div>` : ''}

        ${mapHTML}

        <div class="detail-actions">
          ${websiteBtn}
          ${guideBtn}
        </div>
      </div>
    `;
  }

  function groupKey(group) {
    const map = {
      'Food & Drink': 'food',
      'Outdoors': 'outdoors',
      'Culture': 'culture',
      'Live & Events': 'events',
      'Do & Play': 'play',
      'Shopping': 'shopping',
    };
    return map[group] || 'food';
  }

  function initDetailMap(thing) {
    if (!thing.coords || !Array.isArray(thing.coords) || !thing.coords[0]) return;
    if (typeof L === 'undefined') return;

    requestAnimationFrame(() => {
      const mapEl = document.getElementById('detail-map');
      if (!mapEl) return;

      // Cleanup old map
      if (state._leafletMap) {
        state._leafletMap.remove();
        state._leafletMap = null;
      }

      const map = L.map(mapEl, {
        center: thing.coords,
        zoom: 15,
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const marker = L.marker(thing.coords).addTo(map);
      marker.bindPopup(`<strong>${thing.name}</strong>${thing.address ? '<br>' + thing.address : ''}`).openPopup();

      state._leafletMap = map;
      state._leafletMarker = marker;
    });
  }

  /* ----------------------------------------------------------
     SURPRISE ME
  ---------------------------------------------------------- */
  function surpriseMe() {
    const filtered = filterThings(state.things, state.filters, state.search);
    if (filtered.length === 0) return;
    const pick = filtered[Math.floor(Math.random() * filtered.length)];
    openDetail(pick.id);
  }

  /* ----------------------------------------------------------
     DARK MODE
  ---------------------------------------------------------- */
  function toggleDarkMode() {
    const html = document.documentElement;
    const isDark = html.getAttribute('data-theme') === 'dark';
    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  }

  /* ----------------------------------------------------------
     MODE SWITCHING (List ↔ Guides)
  ---------------------------------------------------------- */
  function switchMode(mode) {
    const modeList   = document.getElementById('mode-list');
    const modeGuides = document.getElementById('mode-guides');
    const btnList    = document.getElementById('btn-list');
    const btnGuides  = document.getElementById('btn-guides');

    if (mode === 'list') {
      modeList.hidden = false;
      modeGuides.hidden = true;
      btnList.setAttribute('aria-pressed', 'true');
      btnGuides.setAttribute('aria-pressed', 'false');
    } else {
      modeList.hidden = true;
      modeGuides.hidden = false;
      btnList.setAttribute('aria-pressed', 'false');
      btnGuides.setAttribute('aria-pressed', 'true');
      if (typeof window.BTV.showGuideIndex === 'function') {
        window.BTV.showGuideIndex();
      }
    }
  }

  /* ----------------------------------------------------------
     EVENT LISTENERS
  ---------------------------------------------------------- */
  let searchTimer;

  function setupEventListeners() {
    // Mode buttons
    document.getElementById('btn-list')?.addEventListener('click', () => switchMode('list'));
    document.getElementById('btn-guides')?.addEventListener('click', () => switchMode('guides'));

    // Dark mode
    document.getElementById('dark-toggle')?.addEventListener('click', toggleDarkMode);

    // Search
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear');
    searchInput?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.search = searchInput.value;
        if (searchClear) searchClear.hidden = !state.search;
        renderList();
      }, 200);
    });
    searchClear?.addEventListener('click', () => {
      searchInput.value = '';
      state.search = '';
      searchClear.hidden = true;
      searchInput.focus();
      renderList();
    });

    // Sort
    document.getElementById('sort-select')?.addEventListener('change', e => {
      state.sort = e.target.value;
      renderList();
    });

    // Quick toggles
    document.getElementById('free-only')?.addEventListener('change', e => {
      state.filters.freeOnly = e.target.checked;
      updateActiveFilterCount();
      renderList();
    });

    // Surprise me
    document.getElementById('surprise-btn')?.addEventListener('click', surpriseMe);

    // Top 100 banner → Guides mode, Top 100 guide
    document.getElementById('top100-btn')?.addEventListener('click', () => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const go = () => {
        switchMode('guides');
        if (typeof window.BTV.showGuide === 'function') window.BTV.showGuide('top-100');
      };
      if (reduced) { go(); return; }
      document.body.classList.add('mode-transition');
      setTimeout(() => {
        go();
        document.body.classList.remove('mode-transition');
      }, 180);
    });

    // Clear filters
    document.getElementById('clear-all-filters')?.addEventListener('click', clearAllFilters);
    document.getElementById('empty-clear-btn')?.addEventListener('click', clearAllFilters);

    // Filter panel toggle (mobile)
    document.getElementById('filter-toggle')?.addEventListener('click', openFilterPanel);
    document.getElementById('filter-close')?.addEventListener('click', closeFilterPanel);
    document.getElementById('filter-overlay')?.addEventListener('click', closeFilterPanel);

    // Detail close
    document.getElementById('detail-close')?.addEventListener('click', closeDetail);
    document.getElementById('detail-overlay')?.addEventListener('click', closeDetail);

    // Keyboard: Escape closes overlays
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (state.openDetailId) closeDetail();
        else closeFilterPanel();
      }
    });
  }

  function openFilterPanel() {
    const panel   = document.getElementById('filter-panel');
    const overlay = document.getElementById('filter-overlay');
    const btn     = document.getElementById('filter-toggle');
    panel?.classList.add('open');
    overlay?.classList.add('open');
    btn?.setAttribute('aria-expanded', 'true');
    // Focus first filter option
    panel?.querySelector('button')?.focus();
  }

  function closeFilterPanel() {
    const panel   = document.getElementById('filter-panel');
    const overlay = document.getElementById('filter-overlay');
    const btn     = document.getElementById('filter-toggle');
    panel?.classList.remove('open');
    overlay?.classList.remove('open');
    btn?.setAttribute('aria-expanded', 'false');
  }

  /* ----------------------------------------------------------
     UTILITY
  ---------------------------------------------------------- */
  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function hide(id) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }

  // Expose internals for guides.js
  window.BTV.switchMode = switchMode;
  window.BTV.esc = esc;

  /* ----------------------------------------------------------
     BOOTSTRAP
  ---------------------------------------------------------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadData);
  } else {
    loadData();
  }

})();
