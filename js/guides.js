/* ============================================================
   THINGS TO DO IN BURLINGTON — guides.js
   Handles: Guide index, roundup pages, itinerary pages.
   Reads from BTV.guides, BTV.things, BTV.filterThings.
============================================================ */

(function () {
  'use strict';

  // Wait for app.js to expose BTV globals
  function init() {
    window.BTV = window.BTV || {};
    window.BTV.initGuides   = initGuides;
    window.BTV.showGuide    = showGuide;
    window.BTV.showGuideIndex = showGuideIndex;
    window.BTV.renderGuidesRail = renderGuidesRail;
  }

  function typeBadge(g) {
    return g.type === 'place' ? 'Place guide'
      : g.type === 'itinerary' ? 'Itinerary'
      : g.type === 'ranked' ? 'Ranked list'
      : 'Roundup';
  }

  /* Horizontal guides carousel shown on the List view */
  function renderGuidesRail() {
    const wrap = document.getElementById('guides-rail-wrap');
    const rail = document.getElementById('guides-rail');
    const guides = (window.BTV.guides || []).filter(g => g.id !== 'top-100');
    if (!wrap || !rail || guides.length === 0) return;

    rail.innerHTML = guides.map(g => `
      <button class="rail-card ${getCoverClass(g)}" data-guide-id="${esc(g.id)}" role="listitem" aria-label="${esc(g.title)}">
        <span class="rail-card-type">${typeBadge(g)}</span>
        <span class="rail-card-title">${esc(g.title)}</span>
      </button>
    `).join('');

    rail.querySelectorAll('.rail-card').forEach(card => {
      card.addEventListener('click', () => {
        if (typeof window.BTV.switchMode === 'function') window.BTV.switchMode('guides');
        showGuide(card.dataset.guideId);
      });
    });
    wrap.hidden = false;
  }

  function initGuides() {
    showGuideIndex();
  }

  /* ----------------------------------------------------------
     GUIDE INDEX
  ---------------------------------------------------------- */
  function showGuideIndex() {
    const view = document.getElementById('guides-view');
    if (!view) return;

    const guides = window.BTV.guides || [];

    view.innerHTML = `
      <div class="guides-header">
        <h1>Guides to Burlington</h1>
        <p>Deep dives, themed roundups, and the perfect itinerary — all drawn from the same living list.</p>
      </div>
      <div class="guides-grid">
        ${guides.map(g => renderGuideCard(g)).join('')}
      </div>
    `;

    view.querySelectorAll('.guide-card').forEach(card => {
      card.addEventListener('click', () => showGuide(card.dataset.guideId));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          showGuide(card.dataset.guideId);
        }
      });
    });
  }

  function renderGuideCard(g) {
    const coverClass = getCoverClass(g);

    return `
      <div class="guide-card" data-guide-id="${esc(g.id)}" role="button" tabindex="0" aria-label="${esc(g.title)}">
        <div class="guide-card-cover ${coverClass}">
          <span class="guide-card-type-badge">${typeBadge(g)}</span>
        </div>
        <div class="guide-card-body">
          <h3 class="guide-card-title">${esc(g.title)}</h3>
          <p class="guide-card-desc">${esc(g.tagline || '')}</p>
          <span class="guide-card-cta">Read guide →</span>
        </div>
      </div>
    `;
  }

  function getCoverClass(g) {
    if (g.cover_class) return g.cover_class;
    if (g.type === 'place') return 'guide-card-cover-place';
    if (g.type === 'itinerary') return 'guide-card-cover-night';
    // Guess from filter
    const filter = g.filter || {};
    if (filter.cost_tier && filter.cost_tier.includes('Free')) return 'guide-card-cover-free';
    if (filter.good_for && filter.good_for.includes('Family & Kids')) return 'guide-card-cover-family';
    if (filter.good_for && filter.good_for.includes('Date Night')) return 'guide-card-cover-date';
    if (filter.good_for && filter.good_for.includes('Cheap Eats')) return 'guide-card-cover-food';
    if (filter.indoor_outdoor && filter.indoor_outdoor.includes('Outdoor')) return 'guide-card-cover-outdoor';
    if (filter.category && filter.category.includes('Brewery & Cidery')) return 'guide-card-cover-food';
    if (filter.group && filter.group.includes('Outdoors')) return 'guide-card-cover-outdoor';
    if (filter.group && filter.group.includes('Live & Events')) return 'guide-card-cover-night';
    return 'guide-card-cover-roundup';
  }

  /* ----------------------------------------------------------
     INDIVIDUAL GUIDE
  ---------------------------------------------------------- */
  function showGuide(id) {
    const guides = window.BTV.guides || [];
    const guide = guides.find(g => g.id === id);
    if (!guide) { showGuideIndex(); return; }

    if (guide.type === 'roundup') renderRoundup(guide);
    else if (guide.type === 'itinerary') renderItinerary(guide);
    else if (guide.type === 'ranked') renderRanked(guide);
    else if (guide.type === 'place') renderPlaceGuide(guide);
    else renderRoundup(guide);

    // Scroll to top of guides view
    const view = document.getElementById('guides-view');
    if (view) view.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* --- Roundup --- */
  function renderRoundup(guide) {
    const things = window.BTV.things || [];
    const filterFn = window.BTV.filterThings;
    if (!filterFn) return;

    // Build a filters object matching app.js structure
    const baseFilters = buildFiltersFromGuideFilter(guide.filter || {});
    let results = filterFn(things, baseFilters, '');

    // Sort
    if (guide.sort === 'local-first') {
      // Burlington-proper neighborhoods first, out-of-town last.
      const RANK = {
        'Downtown / Church St': 0, 'Old North End': 1, 'New North End': 2,
        'South End': 3, 'Waterfront': 4, 'Hill Section': 5, 'UVM / University': 6,
        'Winooski': 7, 'South Burlington': 8, 'Shelburne': 9, 'Colchester': 10,
        'Essex / Essex Jct': 11, 'Williston': 12, 'Greater Burlington': 13
      };
      const rank = t => (t.neighborhood in RANK ? RANK[t.neighborhood] : 99);
      results = [...results].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    } else if (guide.sort === 'neighborhood') {
      results = [...results].sort((a, b) =>
        (a.neighborhood || '').localeCompare(b.neighborhood || '') || a.name.localeCompare(b.name)
      );
    } else {
      results = [...results].sort((a, b) => {
        if (a.has_guide && !b.has_guide) return -1;
        if (!a.has_guide && b.has_guide) return 1;
        return a.name.localeCompare(b.name);
      });
    }

    const view = document.getElementById('guides-view');
    if (!view) return;

    view.innerHTML = `
      <div class="guides-view">
        ${backBtn()}
        <div class="guide-page-header">
          <p class="guide-page-type">Roundup guide</p>
          <h1 class="guide-page-title">${esc(guide.title)}</h1>
          <div class="guide-page-intro">${formatIntro(guide.intro || '')}</div>
          <span class="guide-auto-note">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M21.5 2v6h-6"/><path d="M2.5 12A10 10 0 0 1 19 4.6"/><path d="M2.5 22v-6h6"/><path d="M21.5 12A10 10 0 0 1 5 19.4"/></svg>
            Updated automatically · ${results.length} place${results.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div class="roundup-list">
          ${results.map(t => renderRoundupItem(t)).join('')}
        </div>
      </div>
    `;

    view.querySelectorAll('.roundup-item').forEach(item => {
      item.addEventListener('click', e => {
        // Don't intercept guide-link clicks
        if (e.target.closest('.roundup-item-guide-link')) return;
        if (typeof window.BTV.openDetail === 'function') {
          window.BTV.openDetail(item.dataset.id);
        }
      });
    });

    view.querySelectorAll('.roundup-item-guide-link').forEach(link => {
      link.addEventListener('click', e => {
        e.stopPropagation();
        showGuide(link.dataset.guideId);
      });
    });

    view.querySelector('.guide-back-btn')?.addEventListener('click', showGuideIndex);
  }

  function renderRoundupItem(t) {
    const costClass = costTierClass(t.cost_tier);
    const guideLink = t.has_guide
      ? `<button class="roundup-item-guide-link" data-guide-id="${esc(t.guide_id || t.id)}">Guide →</button>`
      : '';

    return `
      <div class="roundup-item" data-id="${esc(t.id)}" data-group="${esc(t.group || '')}">
        <div class="roundup-item-accent" aria-hidden="true"></div>
        <div class="roundup-item-body">
          <div class="roundup-item-meta">
            <span class="cost-badge ${costClass}">${esc(t.cost_tier || '')}</span>
            <span class="card-neighborhood">${esc(t.neighborhood || '')}</span>
          </div>
          <h3 class="roundup-item-name">${esc(t.name)}</h3>
          <p class="roundup-item-blurb">${esc(t.blurb || '')}</p>
        </div>
        ${guideLink}
      </div>
    `;
  }

  /* --- Itinerary ---
     Rich items: { time, title, body, things: [ids] }.
     Plain string ids still supported (legacy). --- */
  function renderItinerary(guide) {
    const things = window.BTV.things || [];
    const byId = id => things.find(t => t.id === id);

    const items = (guide.items || []).map((item, i) => {
      if (typeof item === 'string') {
        const t = byId(item);
        return t ? { time: 'Stop ' + (i + 1), title: t.name, body: t.blurb || '', things: [t.id] } : null;
      }
      return item;
    }).filter(Boolean);

    const view = document.getElementById('guides-view');
    if (!view) return;

    view.innerHTML = `
      <div class="guides-view">
        ${backBtn()}
        <div class="guide-page-header">
          <p class="guide-page-type">Itinerary</p>
          <h1 class="guide-page-title">${esc(guide.title)}</h1>
          <div class="guide-page-intro">${formatIntro(guide.intro || '')}</div>
        </div>
        <div class="itin-list">
          ${items.map(item => {
            const places = (item.things || []).map(byId).filter(Boolean);
            const chips = places.map(placeChip).join('');
            return `
              <article class="itin-exp">
                <div class="itin-rail">
                  <span class="itin-time">${esc(item.time || '')}</span>
                  <span class="itin-dot" aria-hidden="true"></span>
                </div>
                <div class="itin-exp-body">
                  <h3 class="itin-exp-title">${esc(item.title)}</h3>
                  <p class="itin-exp-text">${esc(item.body || '')}</p>
                  ${chips ? `<div class="ranked-chips" aria-label="Places for this stop">${chips}</div>` : ''}
                </div>
              </article>
            `;
          }).join('')}
        </div>
      </div>
    `;

    bindChips(view);
    view.querySelector('.guide-back-btn')?.addEventListener('click', showGuideIndex);
  }

  /* Shared place-chip helpers (itinerary + ranked) */
  function placeChip(p) {
    return `<button class="ranked-chip" data-id="${esc(p.id)}">
        <span class="ranked-chip-name">${esc(p.name)}</span>
        <span class="ranked-chip-meta">${esc(p.neighborhood || '')}${p.cost_tier ? ' · ' + esc(p.cost_tier) : ''}</span>
      </button>`;
  }

  function bindChips(scope) {
    scope.querySelectorAll('.ranked-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        if (typeof window.BTV.openDetail === 'function') {
          window.BTV.openDetail(chip.dataset.id);
        }
      });
    });
  }

  /* --- Ranked list (Top 100) ---
     Items are experiences: { title, body, things: [ids] }.
     Plain string ids are still supported for backward compat. --- */
  function renderRanked(guide) {
    const things = window.BTV.things || [];
    const byId = id => things.find(t => t.id === id);

    // Normalize: string id → minimal experience object
    const items = (guide.items || []).map(item => {
      if (typeof item === 'string') {
        const t = byId(item);
        return t ? { title: t.name, body: t.blurb || '', things: [t.id] } : null;
      }
      return item;
    }).filter(Boolean);

    const view = document.getElementById('guides-view');
    if (!view) return;

    view.innerHTML = `
      <div class="guides-view">
        ${backBtn()}
        <div class="guide-page-header">
          <p class="guide-page-type">Ranked list</p>
          <h1 class="guide-page-title">${esc(guide.title)}</h1>
          <div class="guide-page-intro">${formatIntro(guide.intro || '')}</div>
          <span class="guide-auto-note">${items.length} experiences · drawn from ${things.length} places on the living list</span>
        </div>
        <div class="ranked-exp-list">
          ${items.map((item, i) => {
            const places = (item.things || []).map(byId).filter(Boolean);
            const chips = places.map(placeChip).join('');
            return `
              <article class="ranked-exp">
                <div class="ranked-num" aria-hidden="true">${i + 1}</div>
                <div class="ranked-exp-body">
                  <h3 class="ranked-exp-title">${esc(item.title)}</h3>
                  <p class="ranked-exp-text">${esc(item.body || '')}</p>
                  ${chips ? `<div class="ranked-chips" aria-label="Places for this entry">${chips}</div>` : ''}
                </div>
              </article>
            `;
          }).join('')}
        </div>
      </div>
    `;

    bindChips(view);
    view.querySelector('.guide-back-btn')?.addEventListener('click', showGuideIndex);
  }

  /* --- Place Guide --- */
  function renderPlaceGuide(guide) {
    const things = window.BTV.things || [];
    const thing = things.find(t => t.id === guide.thing_id);

    const view = document.getElementById('guides-view');
    if (!view) return;

    const sectionsHTML = (guide.sections || []).map(sec => {
      if (sec.pairs) {
        const pairItems = sec.pairs.map(pid => {
          const p = things.find(t => t.id === pid);
          if (!p) return '';
          return `<div class="roundup-item" data-id="${esc(p.id)}" data-group="${esc(p.group || '')}">
            <div class="roundup-item-accent"></div>
            <div class="roundup-item-body">
              <h4 class="roundup-item-name">${esc(p.name)}</h4>
              <p class="roundup-item-blurb">${esc(p.blurb || '')}</p>
            </div>
          </div>`;
        }).join('');
        return `<h3 style="font-family:var(--font-display);font-size:var(--text-lg);margin:var(--space-6) 0 var(--space-3);color:var(--ink)">${esc(sec.heading)}</h3>
                <div class="roundup-list">${pairItems}</div>`;
      }
      return `
        <h3 style="font-family:var(--font-display);font-size:var(--text-lg);margin:var(--space-6) 0 var(--space-3);color:var(--ink)">${esc(sec.heading)}</h3>
        <div style="font-size:var(--text-base);color:var(--ink-2);line-height:1.75;max-width:680px">${formatIntro(sec.body || '')}</div>
      `;
    }).join('');

    view.innerHTML = `
      <div class="guides-view" style="max-width:800px">
        ${backBtn()}
        <div class="guide-page-header">
          <p class="guide-page-type">Place guide</p>
          <h1 class="guide-page-title">${esc(guide.title)}</h1>
          ${thing ? `<p style="font-size:var(--text-sm);color:var(--ink-3);margin-top:var(--space-2)">${esc(thing.neighborhood || '')} · ${esc(thing.cost_tier || '')}${thing.cost_note ? ' · ' + thing.cost_note : ''}</p>` : ''}
          <div class="guide-page-intro" style="margin-top:var(--space-5)">${formatIntro(guide.intro || '')}</div>
        </div>
        <div class="guide-place-content">
          ${sectionsHTML}
        </div>
        ${thing ? `<div style="margin-top:var(--space-8)">
          <button class="btn-primary js-open-detail" data-id="${esc(thing.id)}" style="cursor:pointer">See full details →</button>
        </div>` : ''}
      </div>
    `;

    view.querySelector('.guide-back-btn')?.addEventListener('click', showGuideIndex);

    view.querySelectorAll('.roundup-item').forEach(item => {
      item.addEventListener('click', () => {
        if (typeof window.BTV.openDetail === 'function') {
          window.BTV.openDetail(item.dataset.id);
        }
      });
    });

    view.querySelector('.js-open-detail')?.addEventListener('click', e => {
      if (typeof window.BTV.openDetail === 'function') {
        window.BTV.openDetail(e.currentTarget.dataset.id);
      }
    });
  }

  /* ----------------------------------------------------------
     HELPERS
  ---------------------------------------------------------- */
  function backBtn() {
    return `<button class="guide-back-btn" aria-label="Back to guide index">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      All guides
    </button>`;
  }

  function formatIntro(text) {
    // Split on double newlines for paragraphs; escape HTML within each
    return text.split(/\n\n+/).map(p =>
      `<p style="margin-bottom:var(--space-4)">${esc(p.trim())}</p>`
    ).join('');
  }

  function buildFiltersFromGuideFilter(filterDef) {
    const empty = {
      group: [], category: [], neighborhood: [], cost_tier: [],
      season: [], time_of_day: [], indoor_outdoor: [], good_for: [], vibe: [],
      freeOnly: false, hasGuide: false,
    };
    for (const key of Object.keys(filterDef)) {
      if (Array.isArray(filterDef[key])) {
        empty[key] = filterDef[key];
      }
    }
    return empty;
  }

  function costTierClass(tier) {
    if (tier === 'Free') return 'free';
    if (tier === '$')   return 'tier-1';
    if (tier === '$$')  return 'tier-2';
    if (tier === '$$$') return 'tier-3';
    return '';
  }

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Bootstrap
  init();
})();
