/* Community photo gallery + submission.
   Live mode: reads/writes the shared Supabase project via the RPCs in
   db/photos.sql — submissions land in a moderation queue (pending),
   hearts are one-per-visitor-per-photo, photo of the week surfaces
   automatically. Fallback mode (schema not run yet, or offline): shows
   data/photos/manifest.json if it exists and turns the form into a
   pre-filled email to Stephen — still moderated, just by inbox. */
(function () {
  'use strict';

  var esc = window.BTBC.esc;
  var track = window.BTBC.track;
  var BTBP = window.BTBP;

  var liveMode = false;
  var photos = [];
  var votedIds = {};
  try { votedIds = JSON.parse(localStorage.getItem('btb-photos-voted') || '{}'); } catch (e) {}

  var state = { category: '', area: '', sort: 'new' };

  var catLabel = {};
  BTBP.CATEGORIES.forEach(function (c) { catLabel[c.id] = c.label; });

  /* ---------- filters UI ---------- */
  function buildFilters() {
    var chips = document.getElementById('cat-chips');
    var all = [{ id: '', label: 'All' }].concat(BTBP.CATEGORIES);
    chips.innerHTML = all.map(function (c) {
      return '<label class="quick-chip"><input type="radio" name="cat" value="' + esc(c.id) + '"' +
        (c.id === state.category ? ' checked' : '') + '><span>' + esc(c.label) + '</span></label>';
    }).join('');
    chips.addEventListener('change', function (e) {
      if (e.target.name === 'cat') { state.category = e.target.value; render(); }
    });

    var areaSel = document.getElementById('area-filter');
    BTBP.AREAS.forEach(function (a) {
      var opt = document.createElement('option');
      opt.value = a; opt.textContent = a;
      areaSel.appendChild(opt);
    });
    areaSel.addEventListener('change', function () { state.area = areaSel.value; render(); });

    document.getElementById('sort-select').addEventListener('change', function (e) {
      state.sort = e.target.value; render();
    });

    // submit form selects
    var cat = document.getElementById('ph-category');
    cat.innerHTML = '<option value="" disabled selected>Pick one</option>' +
      BTBP.CATEGORIES.map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.label) + '</option>';
      }).join('');
    var area = document.getElementById('ph-area');
    area.innerHTML = '<option value="" disabled selected>Pick one</option>' +
      BTBP.AREAS.map(function (a) {
        return '<option value="' + esc(a) + '">' + esc(a) + '</option>';
      }).join('');
  }

  /* ---------- gallery ---------- */
  function cardHTML(p) {
    var voted = votedIds[p.id];
    var meta = [];
    if (p.spot) meta.push(esc(p.spot));
    else if (p.area) meta.push(esc(p.area));
    if (p.taken_on) meta.push(esc(p.taken_on));
    return (
      '<figure class="ph-card" data-id="' + esc(p.id) + '">' +
        '<button class="ph-card-imgbtn" type="button" aria-label="View larger">' +
          '<img src="' + esc(p.url) + '" alt="' + esc(p.caption || 'Community photo') + '" loading="lazy">' +
          (p.label ? '<span class="ph-label">' + esc(p.label) + '</span>' : '') +
        '</button>' +
        '<figcaption>' +
          (p.caption ? '<p class="ph-card-caption">' + esc(p.caption) + '</p>' : '') +
          '<div class="ph-card-meta">' +
            '<span class="ph-card-info">' +
              '<span class="ph-card-credit">📷 ' + esc(p.credit || 'Anonymous') + '</span>' +
              (meta.length ? '<span class="ph-card-where">' + meta.join(' · ') + '</span>' : '') +
            '</span>' +
            (liveMode
              ? '<button class="ph-heart' + (voted ? ' voted' : '') + '" type="button" data-id="' + esc(p.id) + '"' +
                ' aria-label="Heart this photo">♥ <span class="ph-heart-n">' + (p.votes || 0) + '</span></button>'
              : '') +
          '</div>' +
        '</figcaption>' +
      '</figure>'
    );
  }

  function visiblePhotos() {
    var list = photos.filter(function (p) {
      return (!state.category || p.category === state.category) &&
             (!state.area || p.area === state.area);
    });
    if (state.sort === 'votes') {
      list = list.slice().sort(function (a, b) { return (b.votes || 0) - (a.votes || 0); });
    }
    return list;
  }

  function render() {
    var grid = document.getElementById('ph-grid');
    var count = document.getElementById('ph-count');
    var list = visiblePhotos();

    if (!photos.length) {
      grid.innerHTML = '<p class="page-empty">No photos yet — the gallery is brand new. Yours could be the very first. 👇</p>';
      count.textContent = '';
      return;
    }
    if (!list.length) {
      grid.innerHTML = '<p class="page-empty">Nothing here yet for that filter. Got one? Scroll down and share it.</p>';
    } else {
      grid.innerHTML = list.map(cardHTML).join('');
    }
    count.textContent = list.length + ' photo' + (list.length === 1 ? '' : 's') +
      (liveMode ? ' — tap ♥ on your favorites; the weekly winner runs in the newsletter' : '');
  }

  /* ---------- photo of the week ---------- */
  function renderPotw(p) {
    if (!p) return;
    document.getElementById('potw-img').src = p.url;
    document.getElementById('potw-img').alt = p.caption || 'Photo of the week';
    document.getElementById('potw-caption').textContent = p.caption || '';
    document.getElementById('potw-credit').textContent = '📷 ' + (p.credit || 'Anonymous') +
      (p.spot || p.area ? ' · ' + (p.spot || p.area) : '');
    document.getElementById('potw').hidden = false;
  }

  /* ---------- load ---------- */
  BTBP.getApproved().then(function (res) {
    liveMode = res.live;
    photos = res.photos;
    render();
    BTBP.getPotw().then(renderPotw).catch(function () {});
  });

  /* ---------- hearts ---------- */
  document.getElementById('ph-grid').addEventListener('click', function (e) {
    var heart = e.target.closest('.ph-heart');
    if (heart && liveMode) {
      var id = heart.getAttribute('data-id');
      if (votedIds[id] || heart.disabled) return;
      heart.disabled = true;
      heart.classList.add('voted');
      BTBP.vote(id, window.BTBC.visitorId()).then(function (n) {
        // only remember the vote once the server confirmed it
        votedIds[id] = true;
        localStorage.setItem('btb-photos-voted', JSON.stringify(votedIds));
        heart.querySelector('.ph-heart-n').textContent = n;
        var p = photos.filter(function (x) { return x.id === id; })[0];
        if (p) p.votes = n;
        track('photo-vote');
      }).catch(function () {
        heart.classList.remove('voted');
        heart.disabled = false;
      });
      return;
    }
    var imgbtn = e.target.closest('.ph-card-imgbtn');
    if (imgbtn) {
      var card = imgbtn.closest('.ph-card');
      var p = photos.filter(function (x) { return x.id === card.getAttribute('data-id'); })[0];
      if (p) openLightbox(p);
    }
  });

  /* ---------- lightbox ---------- */
  var lightbox = document.getElementById('ph-lightbox');
  function openLightbox(p) {
    document.getElementById('ph-lightbox-img').src = p.url;
    document.getElementById('ph-lightbox-img').alt = p.caption || 'Community photo';
    document.getElementById('ph-lightbox-caption').textContent =
      (p.caption ? p.caption + ' ' : '') + '— 📷 ' + (p.credit || 'Anonymous');
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeLightbox() {
    lightbox.hidden = true;
    document.body.style.overflow = '';
  }
  document.getElementById('ph-lightbox-close').addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', function (e) { if (e.target === lightbox) closeLightbox(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !lightbox.hidden) closeLightbox();
  });

  /* ---------- submitting ---------- */
  document.getElementById('ph-file').addEventListener('change', function (e) {
    var f = e.target.files[0];
    document.getElementById('ph-file-hint').textContent = f
      ? '✓ ' + f.name + ' (' + (f.size / 1048576).toFixed(1) + ' MB — will be resized before upload)'
      : 'JPEG, PNG, HEIC — it gets resized before upload, so full-size is fine.';
  });

  document.getElementById('ph-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    var status = document.getElementById('ph-status');
    var btn = document.getElementById('ph-submit-btn');
    var file = form.photo.files[0];
    if (!file || !form.permission.checked) return;

    var fields = {
      caption: form.caption.value.trim(),
      category: form.category.value,
      area: form.area.value,
      spot: form.spot.value.trim(),
      taken_on: form.taken_on.value.trim(),
      credit: form.credit.value.trim(),
      permission: form.permission.checked,
      ai: form.ai.checked,
    };

    status.hidden = false;
    status.className = 'pl-form-status';
    status.textContent = 'Uploading…';
    btn.disabled = true;

    BTBP.submit(file, fields).then(function () {
      status.className = 'pl-form-status ok';
      status.textContent = '🎉 Got it! Your photo is in the review queue — it usually appears within a day.';
      form.reset();
      document.getElementById('ph-file-hint').textContent = 'JPEG, PNG, HEIC — it gets resized before upload, so full-size is fine.';
      btn.disabled = false;
      track('photo-submit');
    }).catch(function (err) {
      var body = 'Caption: ' + fields.caption + '\nSubject: ' + fields.category +
        '\nWhere: ' + fields.area + (fields.spot ? ' (' + fields.spot + ')' : '') +
        '\nWhen (roughly): ' + fields.taken_on +
        '\nCredit me as: ' + (fields.credit || 'Anonymous') +
        '\nAI or heavily edited: ' + (fields.ai ? 'yes' : 'no') +
        '\n\nOK to publish in the Btown Brief: YES' +
        '\n\n(Attach the photo before sending!)';
      status.className = 'pl-form-status err';
      status.innerHTML = esc(err && err.message ? err.message : 'The upload service isn’t reachable') +
        ' — <a href="mailto:BtownBrief@gmail.com?subject=' +
        encodeURIComponent('Community photo') + '&body=' + encodeURIComponent(body) +
        '">click here to send it by email instead</a> (remember to attach the photo).';
      btn.disabled = false;
    });
  });

  buildFilters();
})();
