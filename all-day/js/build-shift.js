/* build-shift.js — a shift's clock, for The Build (modes/build.js). Pure
   functions over one plain object, so the shift survives a reload (it is
   written to this phone on every change) and the rules can be tested on a
   fake clock.

   The rules, from Stephen's spec (newsletter repo,
   reference/drafts/new-nine-2026-10/the-build/SPEC.md):

   - A shift counts the time the app is open and on screen. Leave the app and
     the builder stops and waits; that time does not count. Come back and the
     tools go up again.
   - The foreman's whistle is the only rule. Somewhere between 15 and 30
     minutes after the last touch (random, so nobody sets a timer for it,
     never under 15 so it never breaks a thought) the whistle blows. Three
     minutes to touch the phone or pick it up.
   - Miss it and the crew knocks off: everything up to the last touch is
     banked, nothing is erased. Keep answering and a shift runs all evening.
   - A touch is any sign someone is there: a tap on the shift screen, the
     phone picked up (DeviceMotion), coming back to the app, a reload.

   The state, as written to the phone:
     { v, id, thing, step, started, worked, since, checkpoint, touched,
       whistleAt, whistleOpen, status, saved }
   worked      ms counted up to `since` (or in all, while it is null)
   since       when the current stretch on screen began, null while away
   checkpoint  what `worked` was at the last touch: the bank if a whistle is missed
   whistleAt   when the next whistle blows (or blew, while it is open)
   status      'on' | 'off' (knocked off, banked) | 'done' (clocked out)
   saved       when this was last written, for recovery */

export const WHISTLE_MIN = 15 * 60000;
export const WHISTLE_MAX = 30 * 60000;
export const WINDOW = 3 * 60000;

/* the next gap after a touch: 15 to 30 minutes, never shorter */
export function gap(rand) {
  const r = Math.min(0.999999, Math.max(0, Number(rand()) || 0));
  return WHISTLE_MIN + Math.floor((WHISTLE_MAX - WHISTLE_MIN) * r);
}

export function start(now, rand, o = {}) {
  return {
    v: 1, id: o.id || null, thing: o.thing || null, step: o.step || '',
    started: now, worked: 0, since: now, checkpoint: 0, touched: now,
    whistleAt: now + gap(rand), whistleOpen: false, status: 'on', saved: now,
  };
}

export const workedAt = (s, now) => s.worked + (s.since != null && s.status === 'on' ? Math.max(0, now - s.since) : 0);
export const minutes = (ms) => Math.max(0, Math.floor(ms / 60000));

/* the crew knocks off: back to the last touch */
function knockOff(s) {
  s.worked = s.checkpoint;
  s.since = null;
  s.whistleOpen = false;
  s.status = 'off';
}

/* Every second or so while the shift screen is up. Returns 'whistle' when
   the whistle blows, 'missed' when its three minutes run out, else null. */
export function tick(s, now) {
  if (!s || s.status !== 'on' || s.since == null) return null;
  if (s.whistleOpen && now >= s.whistleAt + WINDOW) { knockOff(s); return 'missed'; }
  if (!s.whistleOpen && now >= s.whistleAt) {
    s.whistleOpen = true;
    /* a phone asleep past the whole window (a laptop lid, a frozen tab)
       wakes to a missed whistle, not an open one */
    if (now >= s.whistleAt + WINDOW) { knockOff(s); return 'missed'; }
    return 'whistle';
  }
  return null;
}

/* Someone touched the phone. Returns true when that answered an open whistle. */
export function touch(s, now, rand) {
  if (!s || s.status !== 'on') return false;
  const answered = s.whistleOpen;
  if (s.since == null) s.since = now;
  s.worked = workedAt(s, now);
  s.since = now;
  s.checkpoint = s.worked;
  s.touched = now;
  s.whistleOpen = false;
  s.whistleAt = now + gap(rand);
  return answered;
}

/* The app went to the background. Leaving it took a hand on the phone, so
   the time so far is banked, unless a whistle was already waiting (a screen
   that locked itself mid-whistle is not a person). */
export function hide(s, now) {
  if (!s || s.status !== 'on' || s.since == null) return;
  s.worked = workedAt(s, now);
  s.since = null;
  if (!s.whistleOpen) s.checkpoint = s.worked;
}

/* Back in the app. The time away never counted; coming back is a touch,
   unless a whistle that was waiting ran out meanwhile. Returns 'missed',
   'answered' or 'back'. */
export function show(s, now, rand) {
  if (!s || s.status !== 'on' || s.since != null) return null;
  if (s.whistleOpen && now >= s.whistleAt + WINDOW) { knockOff(s); return 'missed'; }
  s.since = now;
  return touch(s, now, rand) ? 'answered' : 'back';
}

/* After a reload, a crash or a closed tab: the time up to the last write
   counted (the screen was up, the whistle was running), the gap after it is
   unknown and never counts, and the whistle kept its real-world schedule. A
   whistle that blew and ran out in the gap knocks the crew off at the last
   touch; otherwise the reload itself is a touch. Returns 'missed' or 'back'. */
export function recover(s, now, rand) {
  if (!s || s.status !== 'on') return null;
  const at = Math.min(now, s.saved || now);
  if (s.since != null) { s.worked = s.worked + Math.max(0, at - s.since); s.since = null; }
  if (now >= s.whistleAt + WINDOW) { knockOff(s); return 'missed'; }
  s.since = now;
  touch(s, now, rand);
  return 'back';
}

/* Clock out: whoever tapped it is right there, so everything counts. */
export function end(s, now) {
  if (!s) return 0;
  if (s.status === 'on') { s.worked = workedAt(s, now); s.since = null; s.whistleOpen = false; }
  s.status = 'done';
  return s.worked;
}

/* is this a shift object we can trust off the phone's storage? */
export function valid(s) {
  return !!s && typeof s === 'object' && s.v === 1 && ['on', 'off', 'done'].includes(s.status) &&
    [s.started, s.worked, s.checkpoint, s.touched, s.whistleAt].every((n) => typeof n === 'number' && isFinite(n)) &&
    (s.since == null || (typeof s.since === 'number' && isFinite(s.since)));
}

/* a DeviceMotion reading that means the phone was picked up: the pull on it
   moved well away from where it rested */
export function pickedUp(rest, g, threshold = 3) {
  if (!rest || !g) return false;
  const d = Math.hypot((g.x || 0) - rest.x, (g.y || 0) - rest.y, (g.z || 0) - rest.z);
  return d > threshold;
}
