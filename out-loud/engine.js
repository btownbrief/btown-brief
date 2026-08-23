/* ============================================================
   BTOWN OUT LOUD — geofence engine (pure, DOM-free)

   The contract: everything that decides *which story plays when*
   lives here, takes plain data in, returns plain data out, and is
   covered by engine.test.mjs. app.js only feeds it positions and
   acts on the returned actions. Same rule as the card/board games'
   engines: no DOM, no Date.now(), no randomness — the caller passes
   timestamps in.

   step(state, position, pins, opts) -> { state, actions }
     position: { lat, lng, accuracy (m), speed (m/s|null), ts (ms) }
     pin:      { id, lat, lng, radius_m, enabled }
     actions:  [{ type: 'play', id }, { type: 'queue', id },
                { type: 'suppress', reason }]        (reason: 'accuracy'|'speed')

   storyEnded(state, id, pins, ts) -> { state, actions }
     Pops the next queued story if the walker is still near it.

   Trigger rules (from the blueprint):
   - enter at radius_m, leave at radius_m * EXIT_FACTOR (hysteresis)
   - one story at a time; others queue, nearest first
   - cooldown: a story heard in the last COOLDOWN_MS won't auto-play
   - speed gate: no auto-trigger above MAX_SPEED_MPS
   - accuracy gate: no auto-trigger when accuracy > pin radius (or MAX_ACCURACY_M)
   ============================================================ */

export const DEFAULTS = Object.freeze({
  exitFactor: 1.6,          // 70 m enter → 112 m exit
  cooldownMs: 24 * 60 * 60 * 1000,
  maxSpeedMps: 2.5,         // brisk walk ≈ 1.7; jog ≈ 3
  maxAccuracyM: 100,
  minRadiusM: 30,
});

const EARTH_R = 6371000;
export function haversineM(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function createState() {
  return {
    active: null,            // id of the story playing now
    queue: [],               // ids waiting, in priority order
    inside: {},              // id -> true while within the exit radius
    lastPlayed: {},          // id -> ts of the last auto/manual play
    lastPosition: null,
  };
}

function radiusOf(pin, opts) {
  return Math.max(opts.minRadiusM, Number(pin.radius_m) || 70);
}

/* Distances to every enabled pin, nearest first. */
export function rank(position, pins) {
  return pins
    .filter((p) => p.enabled !== false)
    .map((p) => ({ pin: p, dist: haversineM(position, p) }))
    .sort((a, b) => a.dist - b.dist);
}

export function step(prev, position, pins, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const state = {
    ...prev,
    inside: { ...prev.inside },
    lastPlayed: { ...prev.lastPlayed },
    queue: prev.queue.slice(),
    lastPosition: position,
  };
  const actions = [];
  const ranked = rank(position, pins);

  // 1. Update inside/outside with hysteresis, regardless of gates — leaving
  //    should always be noticed so re-entry can trigger later.
  const entered = [];
  for (const { pin, dist } of ranked) {
    const r = radiusOf(pin, opts);
    if (state.inside[pin.id]) {
      if (dist >= r * opts.exitFactor) {
        delete state.inside[pin.id];
        state.queue = state.queue.filter((id) => id !== pin.id);
      }
    } else if (dist <= r) {
      state.inside[pin.id] = true;
      entered.push({ pin, dist, r });
    }
  }

  // 2. Gates apply only to auto-triggering. A gated entry is forgotten so it
  //    can fire once the gate clears (e.g. accuracy improves while standing there).
  const acc = Number(position.accuracy);
  const spd = position.speed == null ? null : Number(position.speed);
  let gate = null;
  if (spd != null && Number.isFinite(spd) && spd > opts.maxSpeedMps) gate = 'speed';
  if (Number.isFinite(acc) && acc > opts.maxAccuracyM) gate = gate || 'accuracy';

  if (gate) {
    for (const e of entered) delete state.inside[e.pin.id];
    if (entered.length) actions.push({ type: 'suppress', reason: gate });
    return { state, actions };
  }

  // 3. Candidates: newly entered, not on cooldown, accuracy good enough for
  //    this pin's radius, not already active/queued.
  const ts = Number(position.ts) || 0;
  const candidates = entered.filter(({ pin, r }) => {
    if (Number.isFinite(acc) && acc > r) { delete state.inside[pin.id]; return false; }
    const last = state.lastPlayed[pin.id];
    if (last != null && ts - last < opts.cooldownMs) return false;
    if (state.active === pin.id) return false;
    if (state.queue.includes(pin.id)) return false;
    return true;
  });
  if (Number.isFinite(acc) && entered.some(({ pin, r }) => acc > r) && !candidates.length) {
    actions.push({ type: 'suppress', reason: 'accuracy' });
  }

  // 4. Play the nearest if idle; queue the rest nearest-first.
  for (const { pin } of candidates) {
    if (state.active == null) {
      state.active = pin.id;
      state.lastPlayed[pin.id] = ts;
      actions.push({ type: 'play', id: pin.id });
    } else {
      state.queue.push(pin.id);
      actions.push({ type: 'queue', id: pin.id });
    }
  }
  return { state, actions };
}

/* The player tells us a story finished (or was skipped). Play the next queued
   story the walker is still near; drop the ones they've walked away from. */
export function storyEnded(prev, endedId, pins, ts, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const state = { ...prev, queue: prev.queue.slice(), lastPlayed: { ...prev.lastPlayed } };
  const actions = [];
  if (state.active === endedId || endedId == null) state.active = null;
  if (state.active != null) return { state, actions };

  const byId = new Map(pins.map((p) => [p.id, p]));
  while (state.queue.length) {
    const id = state.queue.shift();
    const pin = byId.get(id);
    if (!pin || pin.enabled === false) continue;
    const pos = state.lastPosition;
    const near = pos ? haversineM(pos, pin) <= radiusOf(pin, opts) * opts.exitFactor : false;
    if (!near) continue;
    state.active = id;
    state.lastPlayed[id] = Number(ts) || 0;
    actions.push({ type: 'play', id });
    break;
  }
  return { state, actions };
}

/* Manual play from the list — the engine still needs to know, so auto-play
   doesn't double up and cooldown is honoured afterwards. */
export function manualPlay(prev, id, ts) {
  const state = { ...prev, queue: prev.queue.filter((q) => q !== id), lastPlayed: { ...prev.lastPlayed } };
  state.active = id;
  state.lastPlayed[id] = Number(ts) || 0;
  return { state, actions: [{ type: 'play', id }] };
}

/* Replay a recorded track — used by tests and by ?replay= in the app. */
export function replay(track, pins, options = {}, onEnd = null) {
  let state = createState();
  const events = [];
  for (const pos of track) {
    const r = step(state, pos, pins, options);
    state = r.state;
    for (const a of r.actions) events.push({ ts: pos.ts, ...a });
    if (onEnd && state.active && onEnd(state.active, pos)) {
      const e = storyEnded(state, state.active, pins, pos.ts, options);
      state = e.state;
      for (const a of e.actions) events.push({ ts: pos.ts, ...a, via: 'ended' });
    }
  }
  return { state, events };
}
