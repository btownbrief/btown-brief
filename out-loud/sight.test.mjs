// Second Sight maths: heading difference, opacity curve, match window, demo sweep, cover rect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { headingDiff, opacityFor, matched, demoHeading, coverRect, headingFromEvent, capabilities } from './sight.js';

test('headingDiff is signed and wraps', () => {
  assert.equal(headingDiff(0, 350), 10);      // turn right 10
  assert.equal(headingDiff(350, 0), -10);     // turn left 10
  assert.equal(headingDiff(90, 270), 180);
  assert.equal(headingDiff(45, 45), 0);
  assert.equal(headingDiff(355, 5), -10);
  assert.equal(headingDiff(5, 355), 10);
  assert.equal(headingDiff(NaN, 5), null);
  assert.equal(headingDiff(5, null), null);
});
test('opacity is strongest when lined up and never below the floor', () => {
  assert.equal(opacityFor(0), 0.85);
  assert.equal(opacityFor(8), 0.85);
  assert.equal(opacityFor(-60), 0.25);
  assert.equal(opacityFor(179), 0.25);
  assert.equal(opacityFor(null), 0.25);
  const mid = opacityFor(34);
  assert.ok(mid > 0.25 && mid < 0.85, `mid ${mid}`);
  assert.ok(opacityFor(20) > opacityFor(40), 'monotonic');
});
test('matched within 12 degrees', () => {
  assert.equal(matched(0), true); assert.equal(matched(12), true); assert.equal(matched(-12.5), false); assert.equal(matched(null), false);
});
test('demo heading sweeps through the bearing and holds on it', () => {
  const b = 355;
  assert.equal(demoHeading(b, 0), b);                 // starts on the bearing
  const quarter = demoHeading(b, 9000 / 4);
  assert.ok(Math.abs(headingDiff(b, quarter)) > 40, 'swings away');
  assert.equal(demoHeading(b, 9000 + 500), b);        // the hold
  const vals = new Set(); for (let t = 0; t < 11000; t += 250) vals.add(Math.round(demoHeading(b, t)));
  assert.ok(vals.size > 12, 'actually moves');
  for (const v of vals) assert.ok(v >= 0 && v < 360);
});
test('coverRect covers the viewport like object-fit: cover', () => {
  const r = coverRect(1200, 943, 390, 844);
  assert.ok(r.h >= 844 - 1e-9 && r.w >= 390 - 1e-9);
  assert.ok(Math.abs(r.h - 844) < 1e-6, 'height-limited image fills height');
  assert.ok(r.x < 0 && Math.abs(r.y) < 1e-6);
  const r2 = coverRect(943, 1200, 390, 844);
  assert.ok(Math.abs(r2.w - 390) < 1e-6 || Math.abs(r2.h - 844) < 1e-6);
});
test('headingFromEvent prefers the iOS compass, converts Android alpha, rejects the rest', () => {
  assert.equal(headingFromEvent({ webkitCompassHeading: 90, alpha: 10 }), 90);
  assert.equal(headingFromEvent({ absolute: true, alpha: 90 }), 270);
  assert.equal(headingFromEvent({ absolute: false, alpha: 90 }), null);
  assert.equal(headingFromEvent({}), null);
});
test('capabilities feature-detects without touching real APIs', () => {
  assert.deepEqual(capabilities({ navigator: {} }), { camera: false, orientation: false, needsPermission: false });
  const fake = { navigator: { mediaDevices: { getUserMedia() {} } }, DeviceOrientationEvent: { requestPermission() {} } };
  assert.deepEqual(capabilities(fake), { camera: true, orientation: true, needsPermission: true });
});
