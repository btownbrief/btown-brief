/* lake-sound.js — Lake Breath's lake, synthesized, for Body · Mind. No sound
   files: a rumble, a slow swell, crest laps, a pad voiced by Burlington's
   hour, a soft cue at each turn of the breath, and a bowl at the end. At
   night, once in a while, something like a loon far out on the water. Ported
   from the Lake Breath app's sound.js; its four audio modes are one switch
   here, in the tab. */

let ctx = null, master = null, verb = null, dry = null, wet = null, layers = null, loonAt = 0, sleepTimer = 0, quietTimer = 0;

function noise(color, seconds) {
  const rate = ctx.sampleRate;
  const buf = ctx.createBuffer(2, rate * seconds, rate);
  for (let ch = 0; ch < 2; ch += 1) {
    const d = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < d.length; i += 1) {
      const w = Math.random() * 2 - 1;
      if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
  }
  return buf;
}
function impulse(seconds, decay) {
  const rate = ctx.sampleRate;
  const buf = ctx.createBuffer(2, rate * seconds, rate);
  for (let ch = 0; ch < 2; ch += 1) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i += 1) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, decay);
  }
  return buf;
}
const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
/* adds its swing to a param's own value and never sets the base */
function lfo(freq, depth, param) {
  const o = ctx.createOscillator();
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = depth;
  o.connect(g).connect(param);
  o.start();
  return o;
}
function pad(root, L) {
  [[1, 0.030], [1.5, 0.018], [2, 0.014], [2.997, 0.006]].forEach(([ratio, amp]) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = root * ratio;
    L.oscs.push(lfo(0.05 + Math.random() * 0.06, 4, o.detune));
    const g = ctx.createGain();
    g.gain.value = amp;
    L.oscs.push(lfo(0.02 + Math.random() * 0.03, amp * 0.5, g.gain));
    o.connect(g).connect(wet);
    o.start();
    L.oscs.push(o);
  });
}
function lake(root) {
  const L = layers = { oscs: [], nodes: [] };
  const brown = noise('brown', 3), white = noise('white', 3);
  const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 240;
  const bed = ctx.createGain(); bed.gain.value = 0.055;
  const rumble = loop(brown);
  L.oscs.push(lfo(0.031, 0.012, bed.gain));
  rumble.connect(low).connect(bed).connect(dry);
  const mid = ctx.createBiquadFilter(); mid.type = 'lowpass'; mid.frequency.value = 520;
  const swell = ctx.createGain(); swell.gain.value = 0.045;
  const pan = ctx.createStereoPanner();
  const wave = loop(brown);
  L.oscs.push(lfo(0.082, 320, mid.frequency), lfo(0.082, 0.035, swell.gain), lfo(0.053, 0.018, swell.gain), lfo(0.017, 0.3, pan.pan));
  wave.connect(mid).connect(swell).connect(pan).connect(dry);
  swell.connect(wet);
  const high = ctx.createBiquadFilter(); high.type = 'highpass'; high.frequency.value = 1600;
  const lap = ctx.createGain(); lap.gain.value = 0.008;
  const lapPan = ctx.createStereoPanner(); lapPan.pan.value = 0.1;
  const laps = loop(white);
  L.oscs.push(lfo(0.082, 0.010, lap.gain), lfo(0.023, 0.35, lapPan.pan));
  laps.connect(high).connect(lap).connect(lapPan).connect(dry);
  L.nodes.push(rumble, wave, laps, low, bed, mid, swell, pan, high, lap, lapPan);
  pad(root, L);
}
function quiet() {
  if (!layers) return;
  const L = layers;
  layers = null;
  L.oscs.forEach((o) => { try { o.stop(); } catch (e) { /* never started */ } });
  L.nodes.forEach((n) => { try { if (n.stop) n.stop(); n.disconnect(); } catch (e) { /* gone */ } });
}

/* from a tap: browsers open the sound only inside one */
export function start(hour) {
  clearTimeout(sleepTimer);
  clearTimeout(quietTimer);
  loonAt = performance.now() / 1000 + 90;
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.ratio.value = 3;
      master.connect(comp).connect(ctx.destination);
      verb = ctx.createConvolver();
      verb.buffer = impulse(3.2, 2.6);
      const room = ctx.createGain(); room.gain.value = 0.5;
      verb.connect(room).connect(master);
      master.gain.value = 0.7;
      /* the lake's own two sends, so it can go while a bowl rings on */
      dry = ctx.createGain();
      wet = ctx.createGain();
      dry.connect(master);
      wet.connect(verb);
    }
    ctx.resume();
    quiet();
    const t = ctx.currentTime;
    [dry, wet].forEach((g) => { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 2); });
    lake(hour < 6 ? 98 : hour < 11 ? 146.8 : hour < 18 ? 130.8 : 110);
  } catch (e) { /* no sound on this phone; the sit doesn't need it */ }
}
/* the lake goes out; a bowl left ringing rings on until the sleep */
export function stop(ms, sleepAfter) {
  if (!ctx) return;
  const t = ctx.currentTime;
  [dry, wet].forEach((g) => { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.setTargetAtTime(0.0001, t, ms / 4000); });
  clearTimeout(sleepTimer);
  clearTimeout(quietTimer);
  quietTimer = setTimeout(quiet, ms);
  sleepTimer = setTimeout(() => ctx.suspend(), sleepAfter || ms + 200);
}
/* an inhale rises, an exhale settles, both through the reverb */
export function cue(kind, seconds) {
  if (!layers || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.02;
  const o = ctx.createOscillator(), g = ctx.createGain();
  const base = kind === 'out' ? 392 : 440;
  o.type = 'sine';
  o.frequency.setValueAtTime(base, t);
  o.frequency.linearRampToValueAtTime(kind === 'out' ? base * 0.8 : base * 1.12, t + seconds * 0.9);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(kind === 'out' ? 0.05 : 0.04, t + Math.min(0.7, seconds * 0.35));
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  o.connect(g).connect(wet);
  o.start(t);
  o.stop(t + seconds + 0.2);
}
/* the session's receipt: inharmonic partials with long decays, as the lake goes */
export function bowl() {
  if (!ctx) return;
  if (ctx.state !== 'running') { stop(2500, 10000); return; }
  const t = ctx.currentTime + 0.03;
  [[1, 0.32, 9], [2.71, 0.10, 6.5], [5.42, 0.045, 4.5], [1.005, 0.18, 8]].forEach(([ratio, amp, dur]) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 261.6 * ratio;
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(verb);
    o.start(t);
    o.stop(t + dur + 0.2);
  });
  stop(2500, 10000);
}
export function loon() {
  if (!layers || ctx.state !== 'running') return;
  const now = performance.now() / 1000;
  if (now < loonAt) return;
  loonAt = now + 90 + Math.random() * 150;
  const t = ctx.currentTime + 0.05;
  const o = ctx.createOscillator(), g = ctx.createGain(), vib = ctx.createOscillator(), depth = ctx.createGain();
  vib.frequency.value = 5.5;
  depth.gain.value = 9;
  vib.connect(depth).connect(o.detune);
  o.type = 'sine';
  o.frequency.setValueAtTime(690, t);
  o.frequency.linearRampToValueAtTime(740, t + 0.5);
  o.frequency.linearRampToValueAtTime(560, t + 1.8);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.022, t + 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
  o.connect(g).connect(wet);
  o.start(t); o.stop(t + 2.3);
  vib.start(t); vib.stop(t + 2.3);
}
