/* gestures.js — swipe to save, swipe to dig, hold to mute.

   Ported from pulse.js with its thresholds intact, because they are tuned and
   the numbers are the feature:

     24px   horizontal travel before a swipe is recognised at all
     72px   travel that commits it
     14px   vertical travel that cancels it — this is what keeps a scroll from
            turning into a save
     550ms  press-and-hold that mutes a source
     400ms  after a gesture, clicks on that row are swallowed, so a swipe
            never also opens the article

   Pointer Events only, so one code path covers touch, pen and mouse. Two
   browser defaults have to be preempted: anchors are natively draggable, and
   Android fires its long-press menu before our hold timer.

   The row translates but the action label does not — the label is injected as
   an absolutely-positioned child and only .fi-body and .fi-thumb move, so no
   mode has to change its markup to get this. */

const START = 24;
const COMMIT = 72;
const CANCEL_Y = 14;
const HOLD_MS = 550;
const CLICK_DEAD_MS = 400;

export function bindGestures(root, handlers) {
  let row = null;
  let x0 = 0;
  let y0 = 0;
  let dx = 0;
  let active = false;      // past START, we own this pointer
  let holdTimer = 0;
  let deadRow = null;
  let deadUntil = 0;
  let pid = null;

  function labelFor(dir) {
    return dir > 0 ? 'Save →' : '← Dig';
  }

  function paint(px) {
    if (!row) return;
    const clamped = Math.max(-120, Math.min(120, px));
    row.style.setProperty('--swipe', clamped + 'px');
    row.classList.toggle('is-swiping', true);
    row.classList.toggle('will-commit', Math.abs(px) >= COMMIT);
    let hint = row.querySelector('.fi-hint');
    if (!hint) {
      hint = document.createElement('span');
      hint.className = 'fi-hint';
      row.appendChild(hint);
    }
    hint.textContent = labelFor(px);
    hint.dataset.side = px > 0 ? 'left' : 'right';
  }

  function clear() {
    clearTimeout(holdTimer);
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
    if (e.target.closest('button, a.disc')) return;

    row = r;
    pid = e.pointerId;
    x0 = e.clientX;
    y0 = e.clientY;
    dx = 0;
    active = false;

    if (handlers.onHold) {
      holdTimer = setTimeout(() => {
        if (!row || active) return;
        const held = row;
        clear();
        deadRow = held;
        deadUntil = Date.now() + CLICK_DEAD_MS;
        handlers.onHold(held.dataset.k, held);
      }, HOLD_MS);
    }
  });

  root.addEventListener('pointermove', (e) => {
    if (!row || e.pointerId !== pid) return;
    const mx = e.clientX - x0;
    const my = e.clientY - y0;

    if (!active) {
      /* Any vertical travel over the threshold cancels, even when the finger
         has moved further sideways. A diagonal drag is far more often a
         scroll that wandered than a deliberate swipe, and wrongly saving
         something during a scroll is the failure that would make people stop
         trusting the gesture. Once a swipe is active, vertical stops
         mattering — you have already committed to the horizontal. */
      if (Math.abs(my) > CANCEL_Y) { clear(); return; }
      if (Math.abs(mx) < START) return;
      active = true;
      clearTimeout(holdTimer);
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
    if (committed) {
      if (dir > 0) handlers.onSave(key, target);
      else if (handlers.onDig) handlers.onDig(key, target);
    }
  }

  ['pointerup', 'pointercancel'].forEach((ev) =>
    root.addEventListener(ev, (e) => { if (e.pointerId === pid) finish(); }));
  root.addEventListener('pointerleave', () => { if (row && !active) clear(); });

  // Anchors drag natively; Android's long-press menu beats our hold timer.
  root.addEventListener('dragstart', (e) => { if (e.target.closest('.fi')) e.preventDefault(); });
  root.addEventListener('contextmenu', (e) => { if (row && e.target.closest('.fi')) e.preventDefault(); });

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
