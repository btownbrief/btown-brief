/* Currents — Wander: the Wikipedia rabbit hole, read inside the app.

   Two screens on one hash. #read is the doorway; #read/{Title} is the
   reader, so Back walks the hole in reverse and the trail chips show how
   deep you went.

   Endpoints (all verified, all CORS-open):
     REST   page/summary/{t}, page/mobile-html/{t}, page/random/summary,
            feed/featured/{Y}/{M}/{D}
     ACTION opensearch (suggest), list=geosearch (near here — always live,
            never baked into the nightly pools), generator=search with
            gsrsearch=morelike:{t} for "keep falling".
   /related/ is dead (403). Do not reach for it.

   The sanitizer below is the load-bearing part. Every rule was checked
   against a real mobile-html payload; the comments say what breaks when
   one is dropped.                                                          */
(function () {
  'use strict';
  var REST = 'https://en.wikipedia.org/api/rest_v1/';
  var ACTION = 'https://en.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*&';
  var HERE = '44.48|-73.21';                       /* Burlington City Hall-ish */
  /* namespaces that must not become in-app links: the reader only renders
     mainspace, so these degrade to plain text */
  var NS_PLAIN = /^(Special|File|Image|Media|Wikipedia|Help|Category|Template|Talk|Portal|Draft|User|Module|MediaWiki|Book)(\s+talk)?:/i;
  var POOL_LABEL = {
    'weird-stuff': 'Weird stuff', trending: 'What everyone is reading',
    'on-this-day': 'On this day', 'near-here': 'Near here',
  };
  var state = { el: null, trail: [], pools: null, near: null, at: null, suggestTimer: null, peeked: false };

  Currents.register('read', {
    mount: function (el) {
      state.el = el;
      state.trail = Currents.storeJSON(Currents.stateKey('trail')) || [];
    },
    activate: function (param) { route(param); },
    deactivate: function () { clearTimeout(state.suggestTimer); },
  });

  function route(param) {
    if (!state.el) return;
    if (param) openReader(param);
    else { state.at = null; renderDoorway(); }
  }

  function esc(s) { return Currents.esc(s); }
  function go(title) { location.hash = 'read/' + encodeURIComponent(title); }
  function pretty(t) { return String(t || '').replace(/_/g, ' '); }

  function saved() { return Currents.storeJSON(Currents.stateKey('wiki-saved')) || []; }
  function isSaved(t) { return saved().indexOf(t) !== -1; }
  function toggleSaved(t) {
    var list = saved(), at = list.indexOf(t);
    if (at >= 0) list.splice(at, 1); else list.unshift(t);
    if (list.length > 60) list.pop();
    Currents.storeJSON(Currents.stateKey('wiki-saved'), list);
    Currents.toast(at >= 0 ? 'Removed' : 'Saved');
    return at < 0;
  }

  function pushTrail(title) {
    if (state.trail[state.trail.length - 1] === title) return;
    state.trail = state.trail.filter(function (t) { return t !== title; });
    state.trail.push(title);
    if (state.trail.length > 40) state.trail = state.trail.slice(-40);
    Currents.storeJSON(Currents.stateKey('trail'), state.trail);
  }

  /* ---------- the doorway ---------- */
  function renderDoorway() {
    var el = state.el;
    el.innerHTML =
      '<section class="wander-doorway">' +
        '<h2>Take me somewhere</h2>' +
        '<p>Six million articles. One tap and you are seven deep — still inside the app, ' +
          'with a trail of where you went.</p>' +
        '<button class="w-btn w-btn-big" id="w-random">🎲 Take me somewhere</button>' +
        '<div class="w-search">' +
          '<input id="w-q" type="search" autocomplete="off" placeholder="…or look something up">' +
          '<div class="w-suggest" id="w-sug" hidden></div>' +
        '</div>' +
      '</section>' +
      '<div id="w-trail-wrap"></div>' +
      '<div id="w-saved-wrap"></div>' +
      '<div id="w-pools"></div>';

    document.getElementById('w-random').addEventListener('click', takeMeSomewhere);
    var q = document.getElementById('w-q');
    q.addEventListener('input', function () {
      clearTimeout(state.suggestTimer);
      var term = q.value.trim();
      if (term.length < 2) { hideSuggest(); return; }
      state.suggestTimer = setTimeout(function () { suggest(term); }, 220);
    });
    q.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var first = document.querySelector('#w-sug button');
      if (first) first.click();
    });

    renderTrail();
    renderSavedShelf();
    Currents.load('currents-pools', function (json) {
      state.pools = (json && json.pools) || null;
      renderPools();
    }, function () { renderPools(); });   /* pools are optional — near-here still draws */
    loadNear();
  }

  function hideSuggest() {
    var s = document.getElementById('w-sug');
    if (s) { s.hidden = true; s.innerHTML = ''; }
  }
  function suggest(term) {
    Currents.fetchJSON(ACTION + 'action=opensearch&limit=8&search=' + encodeURIComponent(term), 8000)
      .then(function (r) {
        var box = document.getElementById('w-sug');
        if (!box) return;
        var titles = (r && r[1]) || [], descs = (r && r[2]) || [];
        if (!titles.length) { hideSuggest(); return; }
        box.innerHTML = '';
        titles.forEach(function (t, i) {
          var b = document.createElement('button');
          b.innerHTML = '<span>' + esc(t) + '</span>' +
            (descs[i] ? '<span class="feed-src">' + esc(descs[i]) + '</span>' : '');
          b.addEventListener('click', function () { hideSuggest(); go(t); });
          box.appendChild(b);
        });
        box.hidden = false;
      }).catch(hideSuggest);
  }

  /* weighted draw across whatever pools actually loaded; a bare random
     article is the floor, not the plan */
  function takeMeSomewhere() {
    var buckets = [];
    if (state.pools) {
      if (len(state.pools['weird-stuff'])) buckets.push({ w: 4, list: state.pools['weird-stuff'] });
      if (len(state.pools.trending)) buckets.push({ w: 2, list: state.pools.trending });
      if (len(state.pools['on-this-day'])) buckets.push({ w: 2, list: state.pools['on-this-day'] });
    }
    if (len(state.near)) buckets.push({ w: 2, list: state.near });
    var total = buckets.reduce(function (n, b) { return n + b.w; }, 0);
    if (!total) { randomArticle(); return; }
    var roll = Math.random() * total, pick = buckets[0];
    for (var i = 0; i < buckets.length; i++) {
      roll -= buckets[i].w;
      if (roll <= 0) { pick = buckets[i]; break; }
    }
    var entry = pick.list[Math.floor(Math.random() * pick.list.length)];
    go(titleOf(entry));
  }
  function len(a) { return Array.isArray(a) ? a.length : 0; }
  function titleOf(e) { return (e && e.t) || e; }

  function randomArticle() {
    Currents.fetchJSON(REST + 'page/random/summary', 10000).then(function (s) {
      if (s && s.titles) go(s.titles.canonical || s.titles.normalized);
    }).catch(function () { Currents.toast('Wikipedia is not answering — try again'); });
  }

  function renderTrail(into) {
    var wrap = into || document.getElementById('w-trail-wrap');
    if (!wrap) return;
    if (!state.trail.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = '<p class="c-kicker">Where you have been</p>';
    var row = document.createElement('div');
    row.className = 'trail';
    state.trail.slice().reverse().slice(0, 14).forEach(function (t) {
      var chip = document.createElement('button');
      chip.className = 'trail-chip' + (t === state.at ? ' is-here' : '');
      chip.textContent = pretty(t);
      chip.addEventListener('click', function () { go(t); });
      row.appendChild(chip);
    });
    var clear = document.createElement('button');
    clear.className = 'trail-chip trail-clear';
    clear.textContent = 'Clear';
    clear.addEventListener('click', function () {
      state.trail = [];
      Currents.storeJSON(Currents.stateKey('trail'), []);
      renderTrail(wrap);
    });
    row.appendChild(clear);
    wrap.appendChild(row);
  }

  function renderSavedShelf() {
    var wrap = document.getElementById('w-saved-wrap');
    if (!wrap) return;
    var list = saved();
    if (!list.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = '<p class="c-kicker">Saved articles</p>';
    var row = document.createElement('div');
    row.className = 'trail';
    list.forEach(function (t) {
      var chip = document.createElement('button');
      chip.className = 'trail-chip is-saved';
      chip.textContent = '★ ' + pretty(t);
      chip.addEventListener('click', function () { go(t); });
      row.appendChild(chip);
    });
    wrap.appendChild(row);
  }

  /* near-here is deliberately live: the nightly pool builder has no idea
     the reader is in Burlington, and this list is 20 items and instant */
  function loadNear() {
    Currents.fetchJSON(ACTION + 'action=query&list=geosearch&gscoord=' +
      encodeURIComponent(HERE) + '&gsradius=10000&gslimit=20', 8000)
      .then(function (r) {
        var g = (r.query && r.query.geosearch) || [];
        state.near = g.map(function (p) {
          return { t: p.title, d: Math.round(p.dist) + ' m from City Hall' };
        });
        renderPools();
      }).catch(function () {});
  }

  function renderPools() {
    var el = document.getElementById('w-pools');
    if (!el) return;
    el.innerHTML = '';
    var all = {};
    if (state.pools) Object.keys(state.pools).forEach(function (k) { all[k] = state.pools[k]; });
    if (len(state.near)) all['near-here'] = state.near;
    var keys = ['weird-stuff', 'near-here', 'trending', 'on-this-day'].filter(function (k) { return len(all[k]); });
    Object.keys(all).forEach(function (k) { if (keys.indexOf(k) === -1 && len(all[k])) keys.push(k); });
    if (!keys.length) return;
    keys.forEach(function (key) {
      var sec = document.createElement('section');
      sec.className = 'w-sec';
      sec.innerHTML = '<p class="c-kicker">' + esc(POOL_LABEL[key] || key.replace(/-/g, ' ')) + '</p>';
      var rail = document.createElement('div');
      rail.className = 'w-shelf';
      all[key].slice(0, 14).forEach(function (entry) {
        var title = titleOf(entry);
        var card = document.createElement('button');
        card.className = 'c-card w-door';
        card.innerHTML = '<span class="feed-title">' + esc(pretty(title)) + '</span>' +
          (entry && entry.d ? '<span class="p-why">' + esc(entry.d) + '</span>' : '');
        card.addEventListener('click', function () { go(title); });
        rail.appendChild(card);
      });
      sec.appendChild(rail);
      el.appendChild(sec);
    });
  }

  /* ---------- the reader ---------- */
  function openReader(title) {
    var el = state.el;
    state.at = title;
    el.innerHTML = '<p class="c-loading">Opening ' + esc(pretty(title)) + '…</p>';
    el.scrollTop = 0;
    var summary = null;
    Currents.fetchJSON(REST + 'page/summary/' + encodeURIComponent(title), 10000)
      .then(function (s) {
        summary = s;
        var canonical = s && s.titles && s.titles.canonical;
        /* redirects resolve here; replaceState (not a new hash) so Back
           does not bounce between the alias and the real title */
        if (canonical && canonical !== title) {
          title = canonical;
          state.at = title;
          try { history.replaceState(null, '', '#read/' + encodeURIComponent(title)); } catch (e) {}
        }
        return Currents.fetchText(REST + 'page/mobile-html/' + encodeURIComponent(title), 20000);
      })
      .then(function (raw) {
        pushTrail(title);
        renderArticle(title, raw, summary);
      })
      .catch(function () { readerError(title); });
  }

  function readerError(title) {
    state.el.innerHTML =
      '<div class="c-error"><p><b>' + esc(pretty(title)) + '</b> would not open — either ' +
        'Wikipedia has no such article or the connection dropped.</p>' +
        '<div class="l-btns"><button class="w-btn" id="w-retry">Try again</button>' +
        '<button class="w-btn w-btn-quiet" id="w-home">Back to the doorway</button></div></div>';
    document.getElementById('w-retry').addEventListener('click', function () { openReader(title); });
    document.getElementById('w-home').addEventListener('click', function () { Currents.go('read'); });
  }

  /* ---------- THE SANITIZER ---------- */
  function unwrap(node, keepChildren) {
    var parent = node.parentNode;
    if (!parent) return;
    if (keepChildren) {
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
    }
    parent.removeChild(node);
  }

  function sanitizeMobileHTML(raw) {
    var doc = new DOMParser().parseFromString(raw, 'text/html');

    /* rule 8: the lead image lives in <head>, which is about to go */
    var leadMeta = doc.querySelector('meta[property="mw:leadImage"]');
    var leadImg = leadMeta ? leadMeta.getAttribute('content') : null;

    /* rule 1: every post-lead <section> ships style="display: none" —
       the page's own JS reveals them. Miss this and the article renders as
       a single paragraph and looks broken. */
    doc.querySelectorAll('section[style]').forEach(function (s) {
      if (/display\s*:\s*none/i.test(s.getAttribute('style') || '')) s.removeAttribute('style');
    });

    /* rule 2: body inner only. The <base href="//en.wikipedia.org/wiki/">
       dies with the head — any relative URL that leaked past us would
       otherwise resolve against wikipedia.org and break our own chrome. */
    var body = doc.body;

    /* rule 3: nothing executable, nothing that restyles our page */
    body.querySelectorAll('script, style, link, meta, iframe, form, input, object, embed, template, noscript')
      .forEach(function (n) { n.remove(); });
    body.querySelectorAll('*').forEach(function (n) {
      [].slice.call(n.attributes).forEach(function (a) {
        if (/^on/i.test(a.name)) n.removeAttribute(a.name);
        else if (/^(href|src|srcset|action|formaction|xlink:href)$/i.test(a.name) &&
                 /^\s*(javascript|data):/i.test(a.value)) n.removeAttribute(a.name);
      });
    });

    /* rule 6 (before rule 5 on purpose): every citation is an <a> pointing
       at ./ThisArticle#cite_note-N. Left alone, rule 5 would turn all 700
       of them into in-app links back to the page you are already on. */
    body.querySelectorAll('sup.mw-ref').forEach(function (sup) {
      var note = document.createElement('sup');
      note.className = 'wikinote';
      note.textContent = '†';
      sup.replaceWith(note);
    });
    body.querySelectorAll('.mw-references-wrap, ol.mw-references, .reflist, .references, .pcs-ref, [id^="cite_note"]')
      .forEach(function (n) { n.remove(); });

    /* rule 4: //host/... → https://host/... */
    body.querySelectorAll('[href], [src], [srcset]').forEach(function (n) {
      ['href', 'src', 'srcset'].forEach(function (attr) {
        var v = n.getAttribute(attr);
        if (v && v.slice(0, 2) === '//') n.setAttribute(attr, 'https:' + v);
      });
    });

    /* rule 5: Parsoid ./Title → in-app, namespace → plain, redlink → text.
       Unwrapping keeps CHILD NODES, never textContent: File: links wrap
       images, and textContent would silently delete every picture. */
    body.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (/\/w\/index\.php\?|action=edit|redlink=1/.test(href) || a.classList.contains('new')) {
        unwrap(a, true);
        return;
      }
      var m = href.match(/^(?:\.\/|\/wiki\/)([^?#]+)/);
      if (m) {
        var target = decodeURIComponent(m[1]).replace(/_/g, ' ');
        if (NS_PLAIN.test(target)) {
          var span = document.createElement('span');
          span.className = 'plain-link';
          while (a.firstChild) span.appendChild(a.firstChild);
          a.replaceWith(span);
        } else {
          /* mw-redirect links stay clickable — REST resolves redirects */
          a.setAttribute('data-wiki', target);
          a.setAttribute('href', '#read/' + encodeURIComponent(target));
          a.removeAttribute('target');
        }
      } else if (/^https?:\/\//i.test(href)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener');
      } else {
        a.removeAttribute('href');            /* bare #anchors go nowhere useful here */
      }
    });

    /* rule 7: furniture out, wide tables kept but boxed so they can scroll */
    body.querySelectorAll(
      'table.infobox, .infobox, .navbox, .metadata, .mw-empty-elt, .mw-editsection, ' +
      '.pcs-edit-section-link, .mw-kartographer-map, .mw-kartographer-container, ' +
      '.pcs-fold-hr, .hatnote-container'
    ).forEach(function (n) { n.remove(); });
    body.querySelectorAll('table').forEach(function (t) {
      if (t.closest('.table-wrap')) return;
      var wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      t.parentNode.insertBefore(wrap, t);
      wrap.appendChild(t);
    });

    return { html: body.innerHTML, leadImg: leadImg };
  }

  function renderArticle(title, raw, summary) {
    var el = state.el;
    var clean = sanitizeMobileHTML(raw);
    var hero = clean.leadImg ||
      (summary && summary.originalimage && summary.originalimage.source) ||
      (summary && summary.thumbnail && summary.thumbnail.source);
    el.innerHTML = '';

    var trailWrap = document.createElement('div');
    trailWrap.className = 'reader-trail';
    el.appendChild(trailWrap);
    renderTrail(trailWrap);

    if (hero) {
      var h = document.createElement('img');
      h.className = 'reader-hero';
      h.loading = 'lazy';
      h.alt = '';
      h.src = hero;
      h.addEventListener('error', function () { h.remove(); });
      el.appendChild(h);
    }

    var art = document.createElement('article');
    art.className = 'reader';
    art.innerHTML = clean.html;
    el.appendChild(art);
    wireLinks(art);

    var acts = document.createElement('div');
    acts.className = 'l-btns reader-acts';
    acts.innerHTML =
      '<button class="w-btn w-btn-quiet" id="w-save">' + (isSaved(title) ? '★ Saved' : '☆ Save') + '</button>' +
      '<button class="w-btn w-btn-quiet" id="w-worm">🌀 Wormhole</button>' +
      '<a class="w-btn w-btn-quiet" target="_blank" rel="noopener" href="https://en.wikipedia.org/wiki/' +
        encodeURIComponent(title) + '">Sources on Wikipedia ↗</a>';
    el.appendChild(acts);
    document.getElementById('w-save').addEventListener('click', function (e) {
      e.target.textContent = toggleSaved(title) ? '★ Saved' : '☆ Save';
    });
    document.getElementById('w-worm').addEventListener('click', takeMeSomewhere);

    keepFalling(title, el);
  }

  function wireLinks(art) {
    art.querySelectorAll('a[data-wiki]').forEach(function (a) {
      var target = a.getAttribute('data-wiki');
      var holdTimer = null;
      a.addEventListener('click', function (e) {
        /* a press-and-hold peek must not also navigate */
        if (state.peeked) { e.preventDefault(); state.peeked = false; }
      });
      a.addEventListener('pointerdown', function () {
        clearTimeout(holdTimer);
        holdTimer = setTimeout(function () { state.peeked = true; peek(target); }, 420);
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
        a.addEventListener(ev, function () { clearTimeout(holdTimer); });
      });
    });
  }

  function keepFalling(title, el) {
    var sec = document.createElement('section');
    sec.className = 'w-sec';
    sec.innerHTML = '<p class="c-kicker">Keep falling</p>';
    var rail = document.createElement('div');
    rail.className = 'w-shelf';
    sec.appendChild(rail);
    el.appendChild(sec);
    Currents.fetchJSON(ACTION + 'action=query&generator=search&gsrsearch=' +
      encodeURIComponent('morelike:' + title) +
      '&gsrlimit=8&prop=pageimages|description&piprop=thumbnail&pithumbsize=320', 10000)
      .then(function (r) {
        var pages = (r.query && r.query.pages) || [];
        if (!pages.length) { sec.remove(); return; }
        pages.sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
        pages.forEach(function (p) {
          var card = document.createElement('button');
          card.className = 'c-card w-door';
          card.innerHTML =
            (p.thumbnail ? '<img loading="lazy" src="' + esc(p.thumbnail.source) + '" alt="">' : '') +
            '<span class="feed-title">' + esc(p.title) + '</span>' +
            (p.description ? '<span class="p-why">' + esc(p.description) + '</span>' : '');
          card.addEventListener('click', function () { go(p.title); });
          rail.appendChild(card);
        });
      }).catch(function () { sec.remove(); });
  }

  /* ---------- press-and-hold peek ---------- */
  function peek(title) {
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
    var old = document.querySelector('.peek-card');
    if (old) old.remove();
    Currents.fetchJSON(REST + 'page/summary/' + encodeURIComponent(title), 8000).then(function (s) {
      var box = document.createElement('div');
      box.className = 'c-card peek-card';
      box.innerHTML =
        (s.thumbnail ? '<img class="peek-thumb" src="' + esc(s.thumbnail.source) + '" alt="">' : '') +
        '<div><div class="feed-title">' + esc(s.title) + '</div>' +
          '<div class="peek-blurb">' + esc((s.extract || '').slice(0, 220)) + '</div>' +
          '<button class="w-btn peek-open">Open</button></div>';
      document.body.appendChild(box);
      function close() {
        box.remove();
        document.removeEventListener('pointerdown', elsewhere, true);
      }
      function elsewhere(e) { if (!box.contains(e.target)) close(); }
      setTimeout(function () { document.addEventListener('pointerdown', elsewhere, true); }, 0);
      box.querySelector('.peek-open').addEventListener('click', function () {
        close();
        go(title);
      });
      setTimeout(function () { if (box.isConnected) close(); }, 8000);
    }).catch(function () {});
  }
})();
