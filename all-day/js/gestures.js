/* gestures.js — swipe right to save, swipe left to mute. Holding is Safari's.

   Thresholds ported from pulse.js unchanged, because they are tuned and the
   numbers ARE the feature:

     24px   horizontal travel before a swipe is recognised at all
     72px   travel that commits it
     14px   vertical travel that cancels it — this is what keeps a scroll
            from turning into a save
     550ms  press-and-hold
     400ms  after a gesture, clicks on that row are swallowed, so a swipe
            never also opens the article

   Holding a row is deliberately NOT ours. On iPhone, long-pressing a link
   makes Safari render a live preview of the page itself, which is better
   than anything we could put in a card — it is the real article, not a
   two-sentence RSS blurb. Both earlier passes stole that gesture: v1 muted
   on hold, v2 opened a card. Muting is destructive and rare, so it lives on
   a left swipe that asks first, and the hold is handed back to the browser.

   Pointer Events only, so one code path covers touch, pen and mouse. One
   browser default still has to be pre-empted — anchors are natively
   draggable, which fights a swipe — but only while a swipe is actually
   running, so a plain long-press reaches the browser untouched.

   The row translates but the action label does not: the label is an
   absolutely-positioned child that counter-translates, so no caller has to
   change its markup to get this. */

const START = 24;
const COMMIT = 72;
const CANCEL_Y = 14;
const CLICK_DEAD_MS = 400;

export function bindGestures(root, handlers) {
  let row = null;
  let x0 = 0;
  let y0 = 0;
  let dx = 0;
  let active = false;
  let deadRow = null;
  let deadUntil = 0;
  let pid = null;

  function paint(px) {
    if (!row) return;
    const clamped = Math.max(-130, Math.min(130, px));
    row.style.setProperty('--swipe', clamped + 'px');
    row.classList.add('is-swiping');
    row.classList.toggle('will-commit', Math.abs(px) >= COMMIT);
    let hint = row.querySelector('.fi-hint');
    if (!hint) {
      hint = document.createElement('span');
      hint.className = 'fi-hint';
      row.appendChild(hint);
    }
    hint.textContent = px > 0 ? 'Save →' : '← Mute';
    hint.dataset.side = px > 0 ? 'left' : 'right';
  }

  function clear() {
    if (row) {
      row.style.removeProperty('--swipe');
      row.classList.remove('is-swiping', 'will-commit');
      const hint = row.querySelector('.fi-hint');
      if (hint) hint.remove();
    }
    row = null;
    active = false;
    dx = 0;
    pid = null;
  }

  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const r = e.target.closest('.fi');
    if (!r || !r.dataset.k) return;
    // A tap that starts on a control is that control's business.
    if (e.target.closest('button, a.act, .vote')) return;

    row = r;
    pid = e.pointerId;
    x0 = e.clientX;
    y0 = e.clientY;
    dx = 0;
    active = false;

  });

  root.addEventListener('pointermove', (e) => {
    if (!row || e.pointerId !== pid) return;
    const mx = e.clientX - x0;
    const my = e.clientY - y0;

    if (!active) {
      /* Any vertical travel past the threshold cancels, even when the finger
         has moved further sideways. A diagonal drag is far more often a
         scroll that wandered than a deliberate swipe, and wrongly muting a
         source mid-scroll is the failure that would make someone stop
         trusting the gesture entirely. Once a swipe IS active, vertical stops
         mattering — you have already committed to the horizontal. */
      if (Math.abs(my) > CANCEL_Y) { clear(); return; }
      if (Math.abs(mx) < START) return;
      active = true;
      try { row.setPointerCapture(pid); } catch (err) { /* capture is optional */ }
    }

    dx = mx;
    paint(dx);
    e.preventDefault();
  }, { passive: false });

  function finish() {
    if (!row) return;
    const committed = Math.abs(dx) >= COMMIT;
    const dir = dx;
    const target = row;
    const key = row.dataset.k;
    if (active) {
      deadRow = target;
      deadUntil = Date.now() + CLICK_DEAD_MS;
    }
    clear();
    if (!committed) return;
    if (dir > 0) handlers.onSave(key, target);
    else if (handlers.onMute) handlers.onMute(key, target);
  }

  ['pointerup', 'pointercancel'].forEach((ev) =>
    root.addEventListener(ev, (e) => { if (e.pointerId === pid) finish(); }));
  root.addEventListener('pointerleave', () => { if (row && !active) clear(); });

  // Anchors drag natively, which fights a swipe. Only block it once a swipe
  // is actually running — `active`, not merely touched — so a plain
  // long-press still reaches Safari and gets its own link preview.
  root.addEventListener('dragstart', (e) => { if (active && e.target.closest('.fi')) e.preventDefault(); });
  root.addEventListener('contextmenu', (e) => { if (active && e.target.closest('.fi')) e.preventDefault(); });

  // Swallow the click a swipe would otherwise also fire — but only on the row
  // the gesture happened on, so the rest of the page stays live.
  root.addEventListener('click', (e) => {
    if (!deadRow || Date.now() > deadUntil) return;
    if (e.target.closest('.fi') === deadRow) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}
