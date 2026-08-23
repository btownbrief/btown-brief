// node --test out-loud/engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, step, storyEnded, manualPlay, replay, haversineM, DEFAULTS } from './engine.js';

// ~1e-5 deg lat ≈ 1.11 m. Helper: offset a point by metres north/east.
const base = { lat: 44.47840, lng: -73.21190 }; // top of Church Street
function at(north, east, extra = {}) {
  const lat = base.lat + north / 111320;
  const lng = base.lng + east / (111320 * Math.cos((base.lat * Math.PI) / 180));
  return { lat, lng, accuracy: 10, speed: 1.2, ts: 0, ...extra };
}
const pinA = { id: 'a', lat: base.lat, lng: base.lng, radius_m: 70 };
const pinB = { ...pinA, id: 'b', lat: at(150, 0).lat }; // 150 m north of A
const pins = [pinA, pinB];

test('haversine is sane', () => {
  const d = haversineM(base, at(100, 0));
  assert.ok(Math.abs(d - 100) < 1, `got ${d}`);
});

test('entering a radius plays once; jitter inside does not re-trigger', () => {
  let s = createState();
  let r = step(s, at(-200, 0, { ts: 1 }), pins); s = r.state;         // far away (south, away from B)
  assert.deepEqual(r.actions, []);
  r = step(s, at(-60, 0, { ts: 2 }), pins); s = r.state;              // enter A
  assert.deepEqual(r.actions, [{ type: 'play', id: 'a' }]);
  r = step(s, at(-85, 0, { ts: 3 }), pins); s = r.state;              // bounce to 85 m (> 70, < 112)
  assert.deepEqual(r.actions, []);
  r = step(s, at(-50, 0, { ts: 4 }), pins); s = r.state;              // back in — still inside, no replay
  assert.deepEqual(r.actions, []);
  assert.equal(s.active, 'a');
});

test('hysteresis: leave past exit radius, then re-enter is blocked by cooldown, allowed after', () => {
  let s = createState();
  let r = step(s, at(-60, 0, { ts: 1000 }), pins); s = r.state;
  r = storyEnded(s, 'a', pins, 2000); s = r.state;                    // finished A
  r = step(s, at(-130, 0, { ts: 3000 }), pins); s = r.state;          // left (130 > 112)
  assert.equal(s.inside.a, undefined);
  r = step(s, at(-60, 0, { ts: 4000 }), pins); s = r.state;           // back within cooldown
  assert.deepEqual(r.actions, []);
  r = step(s, at(-130, 0, { ts: 5000 }), pins); s = r.state;
  const later = 1000 + DEFAULTS.cooldownMs + 1;
  r = step(s, at(-60, 0, { ts: later }), pins); s = r.state;
  assert.deepEqual(r.actions, [{ type: 'play', id: 'a' }]);
});

test('one at a time: second entry queues, plays when the first ends if still near', () => {
  let s = createState();
  let r = step(s, at(0, 0, { ts: 1 }), pins); s = r.state;            // A plays
  r = step(s, at(100, 0, { ts: 2 }), pins); s = r.state;              // 100 m from A (inside exit), 50 m from B → B queues
  assert.deepEqual(r.actions, [{ type: 'queue', id: 'b' }]);
  r = storyEnded(s, 'a', pins, 3); s = r.state;
  assert.deepEqual(r.actions, [{ type: 'play', id: 'b' }]);
  assert.equal(s.active, 'b');
});

test('queued story is dropped if the walker has moved on', () => {
  let s = createState();
  let r = step(s, at(0, 0, { ts: 1 }), pins); s = r.state;            // A plays
  r = step(s, at(100, 0, { ts: 2 }), pins); s = r.state;              // B queues
  r = step(s, at(-100, 0, { ts: 3 }), pins); s = r.state;             // walked south, 250 m from B → B leaves
  r = storyEnded(s, 'a', pins, 4); s = r.state;
  assert.deepEqual(r.actions, []);
  assert.equal(s.active, null);
});

test('nearest wins when two radii are entered in one step', () => {
  const close = [{ id: 'x', lat: base.lat, lng: base.lng, radius_m: 90 }, { id: 'y', lat: at(40, 0).lat, lng: base.lng, radius_m: 90 }];
  const r = step(createState(), at(35, 0, { ts: 1 }), close);          // 35 m from x, 5 m from y
  assert.deepEqual(r.actions, [{ type: 'play', id: 'y' }, { type: 'queue', id: 'x' }]);
});

test('speed gate suppresses auto-play and forgets the entry so it can fire later', () => {
  let s = createState();
  let r = step(s, at(0, 0, { ts: 1, speed: 9 }), pins); s = r.state;   // driving past
  assert.deepEqual(r.actions, [{ type: 'suppress', reason: 'speed' }]);
  assert.equal(s.active, null);
  r = step(s, at(0, 0, { ts: 2, speed: 1.0 }), pins); s = r.state;     // stopped and standing there
  assert.deepEqual(r.actions, [{ type: 'play', id: 'a' }]);
});

test('accuracy gate: worse than the pin radius → no auto-play, fires when accuracy improves', () => {
  let s = createState();
  let r = step(s, at(0, 0, { ts: 1, accuracy: 95 }), pins); s = r.state;
  assert.deepEqual(r.actions, [{ type: 'suppress', reason: 'accuracy' }]);
  r = step(s, at(0, 0, { ts: 2, accuracy: 20 }), pins); s = r.state;
  assert.deepEqual(r.actions, [{ type: 'play', id: 'a' }]);
});

test('null speed (desktop / iOS without heading) is not a gate', () => {
  const r = step(createState(), at(0, 0, { ts: 1, speed: null }), pins);
  assert.deepEqual(r.actions, [{ type: 'play', id: 'a' }]);
});

test('disabled pins are ignored', () => {
  const r = step(createState(), at(0, 0, { ts: 1 }), [{ ...pinA, enabled: false }]);
  assert.deepEqual(r.actions, []);
});

test('manual play sets active + cooldown so auto-play does not double up', () => {
  let s = createState();
  let r = manualPlay(s, 'a', 1); s = r.state;
  r = step(s, at(0, 0, { ts: 2 }), pins); s = r.state;
  assert.deepEqual(r.actions, []);
  assert.equal(s.active, 'a');
});

test('replay: a walk north past A then B fires both in order', () => {
  const track = [];
  for (let i = 0; i <= 30; i++) track.push(at(-200 + i * 15, 0, { ts: i * 1000 }));
  // end each story ~20 s after it starts
  const starts = {};
  const { events } = replay(track, pins, {}, (id, pos) => {
    starts[id] = starts[id] ?? pos.ts;
    return pos.ts - starts[id] >= 20000;
  });
  const plays = events.filter((e) => e.type === 'play').map((e) => e.id);
  assert.deepEqual(plays, ['a', 'b']);
});

test('state is not mutated in place', () => {
  const s = createState();
  const frozen = JSON.stringify(s);
  step(s, at(0, 0, { ts: 1 }), pins);
  assert.equal(JSON.stringify(s), frozen);
});
