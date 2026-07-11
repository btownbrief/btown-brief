/* The Photo Desk — Stephen's phone-first moderation queue.
   Passphrase-gated via the security-definer RPCs in db/photos.sql
   (only the bcrypt hash lives in the database; the passphrase is
   remembered on this device after the first unlock). */
(function () {
  'use strict';

  var BTBP = window.BTBP;
  // sessionStorage on purpose: a persisted plaintext passphrase on a public
  // site would be readable by any future same-origin XSS. Re-enter per visit.
  var PASS_KEY = 'btb-photo-admin-pass';
  var pass = sessionStorage.getItem(PASS_KEY) || '';

  var catLabel = {};
  BTBP.CATEGORIES.forEach(function (c) { catLabel[c.id] = c.label; });

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    } catch (e) { return ''; }
  }

  /* ---------- gate ---------- */
  document.getElementById('pa-gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('pa-pass');
    var status = document.getElementById('pa-gate-status');
    status.className = 'pa-status';
    status.textContent = 'Checking…';
    tryUnlock(input.value).catch(function (err) {
      status.className = 'pa-status err';
      status.textContent = /passphrase/.test(err.message || '')
        ? 'That passphrase didn’t work.'
        : 'Couldn’t reach the queue: ' + (err.message || 'network error') +
          '. Has db/photos.sql been run yet?';
    });
  });

  function tryUnlock(candidate) {
    return BTBP.rpc('btb_photos_admin_list', { p_pass: candidate }).then(function (data) {
      pass = candidate;
      sessionStorage.setItem(PASS_KEY, pass);
      document.getElementById('pa-gate').hidden = true;
      document.getElementById('pa-desk').hidden = false;
      renderAll(data);
    });
  }

  /* ---------- queue ---------- */
  function refresh() {
    return BTBP.rpc('btb_photos_admin_list', { p_pass: pass }).then(renderAll);
  }

  function renderAll(data) {
    renderQueue(data.pending || []);
    renderRecent(data.recent || []);
    document.getElementById('pa-pending-count').textContent = (data.pending || []).length;
  }

  function queueCardHTML(p) {
    var meta = [
      catLabel[p.category] || p.category,
      p.area + (p.spot ? ' · ' + p.spot : ''),
      p.taken_on ? 'Taken: ' + p.taken_on : '',
      'By: ' + (p.credit || 'Anonymous'),
      'Via ' + p.submitted_via + ' · ' + fmtDate(p.created_at),
    ].filter(Boolean);
    return (
      '<div class="pa-card" data-id="' + esc(p.id) + '">' +
        '<img src="' + esc(BTBP.photoUrl(p.storage_path)) + '" alt="" loading="lazy">' +
        '<div class="pa-card-body">' +
          (p.caption ? '<p class="pa-card-caption">“' + esc(p.caption) + '”</p>' : '<p class="pa-card-caption" style="color:var(--ink-4)">No caption</p>') +
          '<div class="pa-card-meta">' +
            meta.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('') +
            (p.ai_disclosed ? '<span class="pa-flag">Submitter says: AI or heavily edited</span>' : '') +
          '</div>' +
          '<div class="pa-actions">' +
            '<select class="pa-label-select" aria-label="Public label">' +
              '<option value=""' + (p.ai_disclosed ? '' : ' selected') + '>No label</option>' +
              '<option value="AI-generated"' + (p.ai_disclosed ? ' selected' : '') + '>Label: AI-generated</option>' +
              '<option value="Heavily edited">Label: heavily edited</option>' +
            '</select>' +
            '<button class="pa-btn pa-btn-approve" data-act="approved" type="button">✓ Approve</button>' +
            '<button class="pa-btn pa-btn-reject" data-act="rejected" type="button">✕ Reject</button>' +
          '</div>' +
          '<p class="pa-status"></p>' +
        '</div>' +
      '</div>'
    );
  }

  function renderQueue(pending) {
    var el = document.getElementById('pa-queue');
    el.innerHTML = pending.length
      ? pending.map(queueCardHTML).join('')
      : '<p class="page-empty">Queue’s clear. ✨</p>';
  }

  document.getElementById('pa-queue').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var card = btn.closest('.pa-card');
    var status = card.querySelector('.pa-status');
    var label = card.querySelector('.pa-label-select').value;
    card.querySelectorAll('.pa-btn').forEach(function (b) { b.disabled = true; });
    status.className = 'pa-status';
    status.textContent = 'Saving…';
    BTBP.rpc('btb_photos_moderate', {
      p_pass: pass,
      p_photo: card.getAttribute('data-id'),
      p_status: btn.getAttribute('data-act'),
      p_label: label,
    }).then(function () {
      card.style.opacity = '0.4';
      refresh();
    }).catch(function (err) {
      status.className = 'pa-status err';
      status.textContent = err.message || 'That didn’t save — try again.';
      card.querySelectorAll('.pa-btn').forEach(function (b) { b.disabled = false; });
    });
  });

  /* ---------- recent decisions ---------- */
  function recentRowHTML(p) {
    var flip = p.status === 'approved'
      ? '<button class="pa-btn pa-btn-undo" data-flip="removed" type="button">Remove</button>'
      : '<button class="pa-btn pa-btn-undo" data-flip="approved" type="button">Approve</button>';
    return (
      '<div class="pa-recent-row" data-id="' + esc(p.id) + '">' +
        '<img src="' + esc(BTBP.photoUrl(p.storage_path)) + '" alt="" loading="lazy">' +
        '<div class="pa-recent-info">' +
          '<span class="st-' + esc(p.status) + '">' + esc(p.status) + '</span> · ' +
          esc(p.caption ? p.caption.slice(0, 60) : '(no caption)') +
          '<br><span style="color:var(--ink-3)">' +
          esc((p.credit || 'Anonymous') + ' · ' + (catLabel[p.category] || p.category) +
              ' · ♥ ' + (p.votes || 0) +
              (p.display_label ? ' · labeled: ' + p.display_label : '')) +
          '</span>' +
        '</div>' +
        flip +
      '</div>'
    );
  }

  function renderRecent(recent) {
    var el = document.getElementById('pa-recent');
    el.innerHTML = recent.length
      ? recent.map(recentRowHTML).join('')
      : '<p class="page-empty">No decisions yet.</p>';
  }

  document.getElementById('pa-recent').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-flip]');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '…';
    BTBP.rpc('btb_photos_moderate', {
      p_pass: pass,
      p_photo: btn.closest('.pa-recent-row').getAttribute('data-id'),
      p_status: btn.getAttribute('data-flip'),
      p_label: null,
    }).then(refresh).catch(function () {
      btn.disabled = false;
      btn.textContent = btn.getAttribute('data-flip') === 'approved' ? 'Approve' : 'Remove';
    });
  });

  /* ---------- add a photo I was sent ---------- */
  var addCat = document.getElementById('pa-add-category');
  addCat.innerHTML = '<option value="" disabled selected>Pick one</option>' +
    BTBP.CATEGORIES.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.label) + '</option>';
    }).join('');
  var addArea = document.getElementById('pa-add-area');
  addArea.innerHTML = '<option value="" disabled selected>Pick one</option>' +
    BTBP.AREAS.map(function (a) {
      return '<option value="' + esc(a) + '">' + esc(a) + '</option>';
    }).join('');

  document.getElementById('pa-add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var status = document.getElementById('pa-add-status');
    var btn = document.getElementById('pa-add-btn');
    var file = document.getElementById('pa-add-file').files[0];
    if (!file) return;
    status.className = 'pa-status';
    status.textContent = 'Uploading…';
    btn.disabled = true;

    BTBP.resizeImage(file).then(BTBP.uploadBlob).then(function (path) {
      return BTBP.rpc('btb_photos_add', {
        p_pass: pass,
        p_path: path,
        p_caption: document.getElementById('pa-add-caption').value.trim(),
        p_category: addCat.value,
        p_area: addArea.value,
        p_spot: document.getElementById('pa-add-spot').value.trim(),
        p_taken: document.getElementById('pa-add-taken').value.trim(),
        p_credit: document.getElementById('pa-add-credit').value.trim(),
        p_via: document.getElementById('pa-add-via').value,
        p_ai: document.getElementById('pa-add-ai').checked,
        p_note: document.getElementById('pa-add-note').value.trim(),
      });
    }).then(function () {
      status.className = 'pa-status ok';
      status.textContent = '✓ Added and live in the gallery.';
      document.getElementById('pa-add-form').reset();
      btn.disabled = false;
      refresh();
    }).catch(function (err) {
      status.className = 'pa-status err';
      status.textContent = err.message || 'Upload failed — try again.';
      btn.disabled = false;
    });
  });

  /* ---------- auto-unlock if remembered ---------- */
  if (pass) {
    tryUnlock(pass).catch(function () {
      sessionStorage.removeItem(PASS_KEY);
      pass = '';
    });
  }
})();
