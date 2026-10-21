/* build-site-art.js — how the job site looks: the light and palette, the
   figure, props, sky, the Adirondacks and the lake, weather and lights.

   INTERFACE (the kernel and the other modules rely on exactly this):
     createArt(K) -> {
       setLight(sky) -> bool          sky = { sunAltitude (deg), isNight, weather, hour?, snowCover? }.
                                      Sets K.light = { night 0..1, alt, evening, weather, snowy, wet, fog,
                                      ambient: [r,g,b], skyTop, skyHor } and K.pal (every BASE and EMIT name,
                                      lit). Returns true when the palette changed (the kernel then re-renders caches).
       drawSky(ctx)                   screen space (identity transform), fills the whole canvas
       drawBackdrop(ctx)              world space: mountains, lake, far shore, rail-line trees (cached, parallax)
       drawWeather(ctx)               world space: rain, snow, fog over the view
       drawLights(ctx)                world space: night glows; paints every K.lights entry ({x,y,r,a,color?}) plus its own; called last
       figure(ctx, x, y, o)           a person, feet at (x, y). o = {
                                        pose: one of POSES (shared), t: seconds into the pose (drives cycles),
                                        facing: 1 | -1 | 0 (0 = facing you), colors: colorsFor(id, look),
                                        carry: one of CARRY or null, hat: true (false = hat in hand / hair),
                                        blink: bool, scale: 1, me: bool, name?: string (not drawn here) }
       prop(ctx, name, x, y, o)       a thing, its base at (x, y). Names in PROPS below; o carries options
                                      (facing, load, t, open, lift, colors...).
       emote(ctx, x, y, icon, t)      a small wordless bubble (EMOTES) centred over (x, y)
       glow(ctx, x, y, r, alpha)      additive warm light pool
       step(dt)                       particles, clouds
     }
   Additions (v2 art, optional for callers):
     K.light also carries skyMid, sunX (screen fraction of the evening sun), haze 0..1, month.
     figure o.load       barrow contents ('bricks'|'mortar'|'dirt'|null) for carry 'barrow' / pose 'push'
     figure o.paneW      pane length for carry 'paneL' (the left carrier draws the glass; 'paneR' draws hands only)
     figure o.shadow     false = no ground shadow (a figure on a beam or a ladder never gets one)
     prop o.n            pallet / bricks fullness 0..5 (default 3)
     prop 'hook'         (x, y) is the TOP of the hook block (where the cable meets it); the load hangs below
     glow(..., color)    optional 6th argument, a hex colour
     tones()             the art module's lit colour table (BASE + art extras, with Hi/Sh variants)

   Style: illustrated, not pixel art. Smooth shapes, soft shading (light from
   the upper left), a thin warm outline (ink, ~0.45 units), round joins.
   Readable at docked size (a person ~14 units tall at ~2-4 px/unit).

   Cost: a figure is ~40 vector calls with no allocation; everything static
   (mountains, lake, the tree belt, clouds, glows) is cached. */

import { BASE, EMIT, WW, HORIZON, GROUND_Y, STREET_Y, clamp, lerp, mix, hexRgb, rgbHex, hash, rng } from './build-site-shared.js';

export const PROPS = ['pallet', 'beam', 'panel', 'bricks', 'barrow', 'pane', 'spool', 'rebar', 'stakes', 'bucket', 'mug', 'thermos',
  'sandwich', 'clipboard', 'cake', 'toolbox', 'shovel', 'tarp', 'flag', 'plant', 'cone', 'truck', 'mixerTruck', 'forklift', 'dog',
  'doghouse', 'snowman', 'sawhorse', 'mixer', 'hook', 'stake', 'lamp'];

const TAU = Math.PI * 2;
const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => { t = sat(t); return t * t * (3 - 2 * t); };
const outQ = (t) => { t = sat(t); return 1 - (1 - t) * (1 - t); };
const inQ = (t) => { t = sat(t); return t * t; };
/* where u sits between a and b, 0..1 */
const seg = (u, a, b) => sat((u - a) / (b - a));

/* Art-only daylight colours, lit exactly like BASE. */
const EXTRA = {
  bucket: '#e8742c', drill: '#f0b323', tool: '#3a3f46', toolSteel: '#b9c0c7', tape: '#f2c230', glove: '#d9a24e',
  bread: '#e8c58a', crust: '#c08a4a', lettuce: '#7dbb4a', tomato: '#d9443a', cakeBody: '#f6e2c4', frosting: '#f29bb5',
  paper: '#f7f4ea', osb: '#cfa765', cardboard: '#b88d5a', terracotta: '#c0643f', thermos: '#3f7f5a', tarp: '#3d73c4',
  stripe: '#e9ecec', drum: '#efe7d6', drumStripe: '#e8742c', carrot: '#ef7d2a', coal: '#2a2522',
  mtnFar: '#a7bdd3', mtnMid: '#8396b0', mtnNear: '#62738b', lake: '#8fb0c8', lakeDeep: '#6e90ab',
  pine: '#2f5a3a', pineLight: '#3f7048', bare: '#7b6d62', dogDark: '#7c5530', dogLight: '#d6a56a', cone: '#f07a2a',
  redbox: '#c8402f', cab: '#d9443a', chrome: '#dfe3e6', mortarMix: '#9c968c', soil: '#6b4f36', driverSkin: '#c68642', driverVest: '#ff8a2a',
};
const SHIRTS = ['#5a6a8a', '#8a4a3e', '#56704f', '#8b8f96', '#3f4f6e', '#a8623f', '#6d5a86', '#4f7f86'];
const PANTS = ['#3b4660', '#4c6088', '#7a6248', '#55524c', '#3d4a3c', '#4a5a7a'];
const WEATHERS = ['clear', 'cloud', 'rain', 'snow', 'fog'];

/* Light key frames by sun altitude: [alt, ambient rgb, sky top, sky mid, sky horizon]. We look west over the lake:
   evenings are backlit (the sun goes down behind the Adirondacks), mornings are lit from behind us. */
const EVE = [
  [-14, [0.3, 0.33, 0.52], '#0b1129', '#141c3c', '#222c55'],
  [-6, [0.36, 0.36, 0.56], '#1a2350', '#3a3f72', '#6a5f8e'],
  [-1, [0.62, 0.52, 0.62], '#353d6e', '#9a6f92', '#e98f6c'],
  [3, [0.86, 0.68, 0.62], '#4b4f7d', '#c9839a', '#f4b67a'],
  [8, [0.98, 0.86, 0.76], '#6a8cc0', '#c8a8b0', '#f6cf98'],
  [16, [1, 0.97, 0.92], '#6aa6d9', '#a9cbe6', '#e8e3d2'],
  [32, [1, 1, 1], '#5f9fd6', '#a3cbe8', '#d7e6ee'],
];
const MORN = [
  [-14, [0.3, 0.33, 0.52], '#0b1129', '#141c3c', '#222c55'],
  [-6, [0.4, 0.4, 0.6], '#26325f', '#4a5384', '#7a7aa8'],
  [-1, [0.74, 0.68, 0.76], '#46578a', '#8d88ad', '#efc3a6'],
  [4, [1.02, 0.93, 0.85], '#6e9fd2', '#b6c3d6', '#f5d8b0'],
  [12, [1.02, 0.99, 0.95], '#66a3d8', '#a8cbe6', '#e6e6dc'],
  [32, [1, 1, 1], '#5f9fd6', '#a3cbe8', '#d7e6ee'],
];
/* weather: [ambient multiplier, top, mid, horizon, sky mix, desaturation] */
const WX = {
  cloud: [[0.88, 0.9, 0.94], '#93a4b6', '#b4c0cb', '#cdd4d9', 0.62, 0.18],
  rain: [[0.76, 0.79, 0.86], '#77879a', '#94a0ad', '#aab3bc', 0.75, 0.3],
  fog: [[0.9, 0.91, 0.93], '#c0c6cb', '#cdd2d5', '#d8dcde', 0.82, 0.35],
  snow: [[0.93, 0.95, 1.0], '#aab6c4', '#c6ced8', '#dfe5ea', 0.7, 0.2],
};

export function createArt(K) {
  /* ============================================================ light */
  let key = '', pv = 0;                       // pv: palette version (local caches check it)
  const C = {};                               // art tones: BASE + EXTRA lit, plus <name>Hi / <name>Sh
  let amb = [1, 1, 1], desat = 0;
  function lit(hex) {
    const c = hexRgb(hex);
    let r = c[0] * amb[0], g = c[1] * amb[1], b = c[2] * amb[2];
    if (desat) { const l = r * 0.3 + g * 0.55 + b * 0.15; r = lerp(r, l, desat); g = lerp(g, l, desat); b = lerp(b, l, desat); }
    return rgbHex([r, g, b]);
  }
  function setLight(sky = {}) {
    const w = WEATHERS.includes(sky.weather) ? sky.weather : 'clear';
    let a = typeof sky.sunAltitude === 'number' && isFinite(sky.sunAltitude) ? sky.sunAltitude : (sky.isNight ? -15 : 30);
    if (sky.isNight && a > -4) a = -8;
    a = Math.round(clamp(a, -30, 90) * 2) / 2;    // half a degree: the palette only changes for a real change
    const d = K.now();
    const hour = sky.hour != null && isFinite(sky.hour) ? +sky.hour : d.getHours() + d.getMinutes() / 60;
    const evening = hour >= 12;
    const KF = evening ? EVE : MORN;
    let i = 0; while (i < KF.length - 2 && a > KF[i + 1][0]) i++;
    const k0 = KF[i], k1 = KF[i + 1], t = clamp((a - k0[0]) / (k1[0] - k0[0]), 0, 1);
    let am = [0, 1, 2].map((j) => lerp(k0[1][j], k1[1][j], t));
    let top = mix(k0[2], k1[2], t), mid = mix(k0[3], k1[3], t), hor = mix(k0[4], k1[4], t);
    const night = clamp((2 - a) / 10, 0, 1);
    let ds = 0;
    const wx = WX[w];
    if (wx) {
      am = am.map((v, j) => v * lerp(1, wx[0][j], 1 - night * 0.6));
      const dk = (c, n) => mix(c, n, night * 0.85);
      top = mix(top, dk(wx[1], '#141a2c'), wx[4]); mid = mix(mid, dk(wx[2], '#1c2236'), wx[4]); hor = mix(hor, dk(wx[3], '#283044'), wx[4]);
      ds = wx[5];
    }
    const month = d.getMonth();
    const snowy = sky.snowCover != null ? !!sky.snowCover : (w === 'snow' || (w !== 'rain' && (month === 0 || month === 1)));
    const ambient = am.map((v) => Math.round(v * 40) / 40);
    const haze = w === 'fog' ? 0.8 : w === 'rain' ? 0.5 : w === 'snow' ? 0.45 : w === 'cloud' ? 0.22 : 0;
    K.light = { night, alt: a, evening, weather: w, snowy, wet: w === 'rain', fog: w === 'fog', ambient, skyTop: top, skyMid: mid, skyHor: hor,
      haze, month, sunX: 0.3 };
    const nk = ambient.join() + top + mid + hor + snowy + w + ds + month;
    if (nk === key) return false;
    key = nk; pv++;
    amb = ambient; desat = ds;
    const pal = {};
    for (const n in BASE) pal[n] = lit(BASE[n]);
    Object.assign(pal, EMIT);
    pal.skyTop = top; pal.skyMid = mid; pal.skyHor = hor;
    K.pal = pal;
    for (const n in C) delete C[n];
    const all = Object.assign({}, BASE, EXTRA);
    for (const n in all) {
      C[n] = lit(all[n]);
      C[n + 'Hi'] = lit(mix(all[n], '#fff8ea', 0.3));
      C[n + 'Sh'] = lit(mix(all[n], '#2a2240', 0.3));
    }
    Object.assign(C, EMIT);
    C.inkSoft = lit('#5a4038');
    C.shadow = lit('#2b2230');
    /* reflective stripes catch the work lights at night */
    C.stripeNight = mix(lit(EXTRA.stripe), '#fff2cf', night * 0.7);
    C.snowFlake = mix(lit('#ffffff'), '#e8eef8', 0.3 + night * 0.4);
    lookStr.clear(); toneCache.clear();
    return true;
  }

  /* ============================================================ helpers */
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
  }
  const OUT = 0.45;
  function fillOut(ctx, fill, lw = OUT) { ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = C.ink; ctx.stroke(); }
  function box(ctx, x, y, w, h, r, fill, out = true) { ctx.beginPath(); rr(ctx, x, y, w, h, r); if (out) fillOut(ctx, fill); else { ctx.fillStyle = fill; ctx.fill(); } }
  function disc(ctx, x, y, r, fill, out = true) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); if (out) fillOut(ctx, fill); else { ctx.fillStyle = fill; ctx.fill(); } }
  function oval(ctx, x, y, rx, ry, fill, out = true, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); if (out) fillOut(ctx, fill); else { ctx.fillStyle = fill; ctx.fill(); } }
  function line(ctx, x0, y0, x1, y1, w, col) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke(); }
  /* a stroked bar with an ink outline (limbs, handles, timbers) */
  function bar(ctx, x0, y0, x1, y1, w, col, out = true) {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    if (out) { ctx.lineWidth = w + OUT * 2; ctx.strokeStyle = C.ink; ctx.stroke(); }
    ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke();
  }
  function limb(ctx, ax, ay, jx, jy, ex, ey, w, col) {
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(jx, jy); ctx.lineTo(ex, ey);
    ctx.lineWidth = w + OUT * 2; ctx.strokeStyle = C.ink; ctx.stroke();
    ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke();
  }
  /* two-bone IK: joint for a limb from (ax,ay) toward (bx,by); dir picks the bend side. Writes IK.jx/jy/ex/ey. */
  const IK = { jx: 0, jy: 0, ex: 0, ey: 0 };
  function ik(ax, ay, bx, by, l1, l2, dir) {
    let dx = bx - ax, dy = by - ay, d = Math.sqrt(dx * dx + dy * dy);
    const max = (l1 + l2) * 0.999;
    if (d > max) { bx = ax + dx / d * max; by = ay + dy / d * max; dx = bx - ax; dy = by - ay; d = max; }
    if (d < 0.05) { d = 0.05; dy = 0.05; }
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const mx = ax + dx * a / d, my = ay + dy * a / d;
    IK.jx = mx - dir * dy * h / d; IK.jy = my + dir * dx * h / d; IK.ex = bx; IK.ey = by;
  }

  /* ============================================================ looks (a person's lit colours, cached) */
  const lookObj = new WeakMap();
  const lookStr = new Map();
  const DEFAULT_COLORS = { hat: '#f2c230', vest: '#ff8a2a', skin: '#e0ac69', hair: '#3d2b20' };
  function look(c) {
    if (!c) c = DEFAULT_COLORS;
    let L = lookObj.get(c);
    if (L && L.pv === pv) return L;
    const k = c.hat + c.vest + c.skin + c.hair;
    L = lookStr.get(k);
    if (!L || L.pv !== pv) {
      const seed = hash(k);
      const sk = c.skin || '#e0ac69', hat = c.hat || '#f2c230', vest = c.vest || '#ff8a2a', hair = c.hair || '#3d2b20';
      const shirt = SHIRTS[seed % SHIRTS.length], pants = PANTS[(seed >>> 5) % PANTS.length];
      L = { pv, seed, style: (seed >>> 9) % 5,  // 0,1 short; 2 ponytail; 3 bun; 4 curls
        hat: lit(hat), hatHi: lit(mix(hat, '#ffffff', 0.45)), hatSh: lit(mix(hat, '#3a2030', 0.28)), gloss: lit(mix(hat, '#ffffff', 0.75)),
        vest: lit(vest), vestHi: lit(mix(vest, '#fff6dd', 0.3)), vestSh: lit(mix(vest, '#3a2030', 0.25)),
        skin: lit(sk), skinSh: lit(mix(sk, '#5a2a30', 0.22)), blush: lit(mix(sk, '#ff6f6f', 0.35)),
        hair: lit(hair), hairHi: lit(mix(hair, '#ffffff', 0.18)),
        shirt: lit(shirt), shirtSh: lit(mix(shirt, '#1c1830', 0.28)),
        pants: lit(pants), pantsSh: lit(mix(pants, '#1c1830', 0.3)),
        boots: C.boots, bootsSh: C.bootsSh, glove: C.glove, gloveSh: C.gloveSh };
      lookStr.set(k, L);
    }
    if (typeof c === 'object') lookObj.set(c, L);
    return L;
  }

  /* ============================================================ the figure
     Local frame: feet at (0, 0), y up is negative, +x is the way the figure
     faces (the side view is drawn facing right and mirrored). The rig below
     is filled by a pose each frame (no allocation) and then drawn. */
  const TORSO = 4.3, HEADUP = 1.75, HR = 2.35, HS = 1.18, THIGH = 2.3, SHIN = 2.25, UPPER = 2.05, FORE = 1.95, ANK = -0.8;
  const LEGW = 1.75, ARMW = 1.3, HANDR = 0.62;
  const SIDE = 0, FRONT = 1, BACK = 2;
  const R = {};
  function reset(view) {
    R.view = view; R.hx = 0; R.hy = -5.25; R.lean = 0; R.tx = 0; R.ty = 0; R.hdx = 0; R.hdy = 0; R.tilt = 0; R.sh = 0;
    R.kfk = false; R.kd = -1; R.eyes = 0; R.mouth = 0; R.look = 0; R.drinkUp = 0;
    R.tool = null; R.tAng = 0; R.tool0 = null; R.t0Ang = 0; R.grip = true; R.shadow = true; R.fx = 0; R.fxT = 0; R.item = null;
    R.hatTip = 0;
    if (view === SIDE) {
      R.f0x = -0.45; R.f0y = ANK; R.f1x = 0.55; R.f1y = ANK;
      R.a0x = -0.6; R.a0y = -5.25; R.a1x = 0.8; R.a1y = -5.2; R.e0 = 1; R.e1 = 1;
    } else {
      R.f0x = -0.85; R.f0y = ANK; R.f1x = 0.85; R.f1y = ANK;
      R.a0x = -2.3; R.a0y = -5.3; R.a1x = 2.3; R.a1y = -5.3; R.e0 = 1; R.e1 = -1;
    }
    R.k0x = R.k0y = R.k1x = R.k1y = 0;
  }
  /* a shoulder for the current hip/lean (poses hang hands off the body with this); writes SH */
  const SH = [0, 0];
  function shoulder(i) {
    const ux = Math.sin(R.lean), uy = -Math.cos(R.lean);
    const sx = R.hx + ux * (TORSO - 0.6), sy = R.hy + uy * (TORSO - 0.6) + R.sh;
    const o = R.view === SIDE ? (i ? 0.45 : -0.6) : (i ? 1.85 : -1.85);
    SH[0] = sx - uy * o; SH[1] = sy + ux * o;
    return SH;
  }
  /* walking feet: phase 0..1, stride half-length S, lift H */
  function stride(ph, S, H, i) {
    const u = (ph + (i ? 0.5 : 0)) % 1;
    let x, y;
    if (u < 0.5) { x = S - 4 * S * u; y = ANK; }
    else { const s = (u - 0.5) * 2; x = -S + 2 * S * smooth(s); y = ANK - H * Math.sin(Math.PI * s); }
    if (i) { R.f1x = x + 0.1; R.f1y = y; } else { R.f0x = x - 0.1; R.f0y = y; }
  }
  function breathe(t, amt = 0.1) { const b = Math.sin(t * 1.9) * amt; R.hy += b * 0.3; R.sh = -b * 0.5; return b; }
  function sitBase() { R.hy = -3.35; R.kd = -1; R.f1x = 2.3; R.f1y = ANK; R.f0x = 1.9; R.f0y = ANK; }

  /* poses: fill R from t (seconds). The view is already set. */
  const P = {
    stand(t) { breathe(t); R.hx = Math.sin(t * 0.7) * 0.12; },
    walk(t) {
      const ph = (t / 0.62) % 1;
      stride(ph, 1.45, 0.85, 0); stride(ph, 1.45, 0.85, 1);
      const b = Math.abs(Math.cos(ph * TAU));
      R.hy = -4.95 - 0.42 * b; R.lean = 0.06;
      const sw = Math.sin(ph * TAU);
      if (R.view === SIDE) { R.a1x = 0.5 - sw * 1.3; R.a1y = -5.7 + Math.abs(sw) * 0.25 - 0.42 * b; R.a0x = -0.4 + sw * 1.2; R.a0y = -5.8 + Math.abs(sw) * 0.25 - 0.42 * b; }
      else { R.f0x = -0.85; R.f1x = 0.85; R.a0y += sw * 0.4; R.a1y -= sw * 0.4; }
    },
    run(t) {
      const ph = (t / 0.42) % 1;
      stride(ph, 2.0, 1.4, 0); stride(ph, 2.0, 1.4, 1);
      R.ty = -0.35 * Math.abs(Math.sin(ph * TAU));
      R.hy = -4.9 - 0.25 * Math.abs(Math.cos(ph * TAU)); R.lean = 0.22;
      const sw = Math.sin(ph * TAU);
      let s = shoulder(1); R.a1x = s[0] + 0.9 - sw * 1.5; R.a1y = s[1] + 2.4 - Math.max(0, -sw) * 0.8;
      s = shoulder(0); R.a0x = s[0] + 0.9 + sw * 1.5; R.a0y = s[1] + 2.4 - Math.max(0, sw) * 0.8;
      R.e0 = R.e1 = 1;
    },
    climb(t) {
      const ph = (t / 0.9) % 1, s = Math.sin(ph * TAU);
      R.view = BACK; R.shadow = false; R.grip = false;
      R.tx = s * 0.15;
      R.a0x = -2.5; R.a0y = -12.0 + s * 0.8; R.a1x = 2.5; R.a1y = -12.0 - s * 0.8; R.e0 = 1; R.e1 = -1;
      R.f0x = -0.8; R.f0y = ANK - 1.4 * Math.max(0, -s); R.f1x = 0.8; R.f1y = ANK - 1.4 * Math.max(0, s);
      R.hy = -5.25 + 0.2 * Math.abs(s);
    },
    hammer(t) {
      const u = (t / 0.8) % 1;
      R.grip = false; R.lean = 0.12; R.tool = 'hammer';
      const up = u < 0.55 ? smooth(u / 0.55) : u < 0.66 ? 1 - inQ(seg(u, 0.55, 0.66)) : 0;
      const rec = u >= 0.66 ? Math.sin(seg(u, 0.66, 1) * Math.PI) * 0.25 : 0;
      R.a1x = lerp(2.75, 0.9, up); R.a1y = lerp(-6.5, -11.6, up) - rec;
      R.tAng = lerp(0.15, -2.55, up) - rec * 0.6;
      R.a0x = 3.6; R.a0y = -5.4; R.e0 = 1;
      R.hy = -5.2 + (u > 0.62 && u < 0.72 ? 0.18 : 0);
      if (u > 0.64 && u < 0.76) { R.fx = 1; R.fxT = seg(u, 0.64, 0.76); }
    },
    drill(t) {
      const u = (t / 1.9) % 1, on = u < 0.7;
      R.grip = false; R.lean = 0.1; R.tool = 'drill';
      const j = on ? Math.sin(t * 70) * 0.06 : 0, push = on ? smooth(u / 0.7) * 0.35 : (1 - smooth(seg(u, 0.7, 1))) * 0.35;
      const lift = u < 0.7 ? 0 : Math.sin(seg(u, 0.7, 1) * Math.PI) * 0.9;
      R.a1x = 2.4 + push + j; R.a1y = -7.2 - lift + j; R.tAng = 0; R.a0x = 2.2 + push; R.a0y = -6.0 - lift; R.e0 = 1;
      if (on) { R.fx = 2; R.fxT = t; }
    },
    trowel(t) {
      const u = (t / 1.9) % 1;
      R.grip = false; R.lean = 0.2; R.tool = 'trowel'; R.tool0 = 'brick';
      if (u < 0.3) { const k = smooth(u / 0.3); R.a1x = lerp(3.3, 2.3, k); R.a1y = lerp(-6.6, -4.4, k); R.tAng = lerp(0.2, 0.9, k); }
      else if (u < 0.7) { const k = smooth(seg(u, 0.3, 0.7)); R.a1x = lerp(2.3, 4.4, k); R.a1y = lerp(-4.4, -6.2, Math.min(1, k * 2)); R.tAng = lerp(0.9, 0.05, k); }
      else { const k = seg(u, 0.7, 1); R.a1x = lerp(4.4, 3.3, smooth(k)); R.a1y = -6.4 - Math.abs(Math.sin(k * Math.PI * 3)) * 0.4; R.tAng = 0.2; }
      const place = smooth(seg(u, 0.55, 0.8)) * (1 - smooth(seg(u, 0.9, 1)));
      R.a0x = lerp(1.7, 3.7, place); R.a0y = lerp(-7.0, -6.5, place); R.t0Ang = 0;
    },
    saw(t) {
      const u = (t / 0.55) % 1, s = Math.sin(u * TAU);
      R.grip = false; R.lean = 0.34; R.tool = 'saw'; R.hx = s * 0.15;
      R.a1x = 2.6 + s * 1.2; R.a1y = -5.9 - s * 0.35; R.tAng = 0.55;
      R.a0x = 4.4; R.a0y = -5.0; R.e0 = 1;
      R.fx = 3; R.fxT = t;
    },
    measure(t) {
      const u = (t / 3.2) % 1;
      R.grip = false; R.lean = 0.36; R.tool0 = 'tape';
      const ext = u < 0.45 ? outQ(u / 0.45) : u < 0.8 ? 1 : u < 0.9 ? 1 - inQ(seg(u, 0.8, 0.9)) : 0;
      R.a0x = 1.7; R.a0y = -5.0; R.a1x = 2.2 + ext * 2.6; R.a1y = -4.8 + ext * 0.4 + (u > 0.45 && u < 0.8 ? Math.sin(t * 9) * 0.06 : 0);
      R.hy = -5.2 + ext * 0.4; R.hdy = 0.2;
    },
    pullwire(t) {
      const u = (t / 1.1) % 1;
      R.grip = false; R.lean = -0.04; R.hdy = -0.1;
      wireHand(u); R.a1x = WH[0]; R.a1y = WH[1];
      wireHand((u + 0.5) % 1); R.a0x = WH[0]; R.a0y = WH[1]; R.e0 = R.e1 = 1;
      R.fx = 5; R.fxT = t;
    },
    shovel(t) {
      const u = (t / 2.3) % 1;
      R.grip = false; R.tool = 'shovel';
      /* the shovel is set by the top hand and its angle; the lower hand rides the shaft */
      let gx, gy, ang, lean, dirt = 0;
      if (u < 0.3) { const k = smooth(u / 0.3); gx = 1.0; gy = lerp(-9.2, -8.4, k); ang = 1.25; lean = 0.18; R.f1x = lerp(0.6, 1.9, k); R.f1y = ANK - Math.sin(k * Math.PI) * 1.1; }
      else if (u < 0.55) { const k = smooth(seg(u, 0.3, 0.55)); gx = lerp(1.0, -0.2, k); gy = lerp(-8.4, -6.6, k); ang = lerp(1.25, 0.55, k); lean = lerp(0.18, -0.05, k); dirt = 1; }
      else if (u < 0.72) { const k = outQ(seg(u, 0.55, 0.72)); gx = lerp(-0.2, 0.9, k); gy = lerp(-6.6, -8.4, k); ang = lerp(0.55, -0.05, k); lean = lerp(-0.05, 0.12, k); dirt = k < 0.5 ? 1 : 2; }
      else { const k = smooth(seg(u, 0.72, 1)); gx = lerp(0.9, 1.0, k); gy = lerp(-8.4, -9.2, k); ang = lerp(-0.05, 1.25, k); lean = 0.12 + 0.06 * k; dirt = 2; }
      R.lean = lean; R.a1x = gx; R.a1y = gy; R.tAng = ang;
      R.a0x = gx + Math.cos(ang) * 3.1; R.a0y = gy + Math.sin(ang) * 3.1; R.e0 = 1; R.e1 = 1;
      R.fx = 6; R.fxT = dirt === 2 ? seg(u, 0.62, 0.95) : dirt ? 0 : -1;
    },
    rake(t) {
      const u = (t / 1.3) % 1, s = Math.sin(u * TAU);
      R.grip = false; R.lean = 0.24 + s * 0.04; R.tool = 'rake';
      const hx = 5.4 + s * 1.4;           // rake head on the ground
      R.a1x = 1.0 + s * 0.5; R.a1y = -7.6; R.tAng = Math.atan2(-0.4 - R.a1y, hx - R.a1x);
      R.a0x = R.a1x + Math.cos(R.tAng) * 2.4; R.a0y = R.a1y + Math.sin(R.tAng) * 2.4; R.e0 = 1;
    },
    kneel(t) {
      R.grip = false; R.kfk = true; R.hy = -3.1; R.lean = 0.42; R.hdy = 0.15;
      R.k1x = 0.6; R.k1y = -0.55; R.f1x = -1.7; R.f1y = -0.5;     // near knee down
      R.k0x = 1.9; R.k0y = -2.9; R.f0x = 1.7; R.f0y = ANK;        // far foot planted
      const c = t * TAU / 0.55;
      R.a1x = 3.1 + Math.cos(c) * 0.25; R.a1y = -1.7 + Math.sin(c) * 0.2; R.a0x = 3.6; R.a0y = -1.5;
      R.fx = 7; R.fxT = t;
    },
    pour(t) {
      const u = (t / 3.0) % 1;
      R.grip = false; R.lean = 0.1; R.tool = 'pourBucket';
      const tip = smooth(seg(u, 0, 0.3)) * (1 - smooth(seg(u, 0.85, 1)));
      R.a1x = 2.3 + tip * 0.6; R.a1y = -7.0 + tip * 0.6; R.a0x = 2.9 + tip * 0.4; R.a0y = -5.6 + tip * 0.2;
      R.tAng = tip * 1.5; R.fxT = tip;
    },
    push(t) {
      P.walk(t * 0.85);
      R.grip = false; R.lean = 0.22; R.hy -= 0.05;
      R.a1x = 3.3; R.a1y = -5.5; R.a0x = 3.0; R.a0y = -5.6; R.e0 = R.e1 = 1;
      R.item = 'barrow';
    },
    lift(t) {
      const u = (t / 2.4) % 1;
      const up = u < 0.25 ? 0 : u < 0.6 ? smooth(seg(u, 0.25, 0.6)) : 1;
      R.hy = lerp(-3.4, -5.2, up); R.lean = lerp(0.35, 0.02, up);
      R.f0x = -0.6; R.f1x = 0.9;
      R.a1x = lerp(2.2, 1.9, up); R.a1y = lerp(-1.6, -7.6, up); R.a0x = R.a1x - 0.4; R.a0y = R.a1y + 0.2; R.e0 = R.e1 = 1;
      R.item = 'crate'; R.grip = false;
    },
    signal(t) {
      const mode = Math.floor(t / 3.5) % 2, c = t * TAU * 1.4;
      if (R.view === SIDE) {
        if (mode === 0) { R.a1x = 2.7 + Math.cos(c) * 0.35; R.a1y = -12.3 + Math.sin(c) * 0.35; }
        else { R.a1x = 3.6 + Math.cos(c) * 0.3; R.a1y = -6.3 + Math.sin(c) * 0.3; }
        R.a0x = -0.6; R.a0y = -5.8;
      } else {
        if (mode === 0) { R.a1x = 3.5 + Math.cos(c) * 0.35; R.a1y = -12.2 + Math.sin(c) * 0.35; R.a0x = -2.4; R.a0y = -5.8; }
        else { R.a1x = 4.2; R.a1y = -9.0 + Math.sin(c) * 0.5; R.a0x = -4.2; R.a0y = -9.0 - Math.sin(c) * 0.5; }
      }
      R.hdy = -0.1; R.look = 1;
    },
    guide(t) {
      const sw = Math.sin(t * 1.3) * 0.3;
      R.tx = sw; R.lean = -0.06; R.hdy = -0.15; R.look = 1;
      if (R.view === SIDE) { R.a1x = 3.0; R.a1y = -12.2; R.a0x = 2.2; R.a0y = -12.5; R.e0 = R.e1 = 1; }
      else { R.a1x = 3.4; R.a1y = -12.3; R.a0x = -3.4; R.a0y = -12.3; }
      const st = Math.sin(t * 1.3 + 1) * 0.25; R.f0x -= st; R.f1x += st;
    },
    sweep(t) {
      const u = (t / 1.0) % 1, s = Math.sin(u * TAU);
      R.grip = false; R.lean = 0.16; R.tool = 'broom';
      const hx = 4.6 + s * 1.1;
      R.a1x = 0.9 + s * 0.6; R.a1y = -7.6; R.tAng = Math.atan2(-0.4 - R.a1y, hx - R.a1x);
      R.a0x = R.a1x + Math.cos(R.tAng) * 2.2; R.a0y = R.a1y + Math.sin(R.tAng) * 2.2; R.e0 = 1;
      if (s > 0.2) { R.fx = 8; R.fxT = t; }
    },
    plant(t) {
      R.grip = false; R.hy = -3.0; R.lean = 0.5; R.hdy = 0.2; R.kd = -1;
      R.f1x = 0.9; R.f1y = ANK; R.f0x = -0.5; R.f0y = ANK;
      const p = Math.sin(t * TAU / 0.5);
      R.a1x = 3.0; R.a1y = -1.3 - Math.max(0, p) * 0.7; R.a0x = 3.6; R.a0y = -1.3 - Math.max(0, -p) * 0.7;
      R.item = 'mound';
    },
    sit(t) {
      breathe(t, 0.08); sitBase();
      if (R.view === SIDE) { R.a1x = 2.0; R.a1y = -4.1; R.a0x = 1.6; R.a0y = -4.2; }
      else { R.kfk = true; R.k0x = -1.0; R.k0y = -3.2; R.k1x = 1.0; R.k1y = -3.2; R.f0x = -1.05; R.f0y = ANK; R.f1x = 1.05; R.f1y = ANK; R.a0x = -1.6; R.a0y = -3.8; R.a1x = 1.6; R.a1y = -3.8; }
    },
    sitbeam(t) {
      R.view = FRONT; R.shadow = false; breathe(t, 0.07);
      R.hy = -0.75; R.kfk = true;
      const s0 = Math.sin(t * 2.6), s1 = Math.sin(t * 2.6 + 2.2);
      R.k0x = -0.95; R.k0y = 0.25; R.k1x = 0.95; R.k1y = 0.25;
      R.f0x = -1.0 + s0 * 0.25; R.f0y = 3.0 - Math.abs(s0) * 0.35; R.f1x = 1.0 + s1 * 0.25; R.f1y = 3.0 - Math.abs(s1) * 0.35;
      R.a0x = -2.7; R.a0y = -0.3; R.a1x = 2.7; R.a1y = -0.3;
      const lk = Math.sin(t * 0.45); R.look = lk > 0.6 ? 1 : lk < -0.6 ? -1 : 0;
    },
    drink(t) {
      breathe(t);
      const u = (t / 3.6) % 1, up = smooth(seg(u, 0, 0.15)) * (1 - smooth(seg(u, 0.45, 0.6)));
      if (R.view === SIDE) { R.a1x = lerp(1.8, 1.9, up); R.a1y = lerp(-7.4, -10.4, up); }
      else { R.a1x = lerp(1.6, 0.9, up); R.a1y = lerp(-7.2, -10.2, up); }
      R.tilt = -0.22 * up; R.hdy = -0.1 * up; R.eyes = up > 0.5 ? 1 : 0; R.drinkUp = up;
    },
    eat(t) {
      breathe(t);
      const u = (t / 2.8) % 1, up = smooth(seg(u, 0, 0.18)) * (1 - smooth(seg(u, 0.35, 0.5)));
      if (R.view === SIDE) { R.a1x = lerp(1.8, 1.95, up); R.a1y = lerp(-7.4, -10.0, up); }
      else { R.a1x = lerp(1.6, 0.7, up); R.a1y = lerp(-7.2, -10.0, up); }
      const chew = u > 0.4 && u < 0.85 ? Math.abs(Math.sin(t * 11)) * 0.12 : 0;
      R.hdy = chew; R.mouth = u > 0.15 && u < 0.4 ? 1 : 0; R.drinkUp = up;
    },
    wave(t) {
      breathe(t); R.eyes = 2;
      const s = Math.sin(t * TAU / 0.5);
      if (R.view === SIDE) { R.a1x = 2.9 + s * 0.6; R.a1y = -12.1 + Math.abs(s) * 0.2; R.e1 = 1; }
      else { R.a1x = 3.9 + s * 0.6; R.a1y = -12.0 + Math.abs(s) * 0.2; R.e1 = -1; }
      R.tilt = s * 0.04;
    },
    clap(t) {
      R.eyes = 2; R.mouth = 1;
      const s = Math.abs(Math.sin(t * Math.PI / 0.36));
      if (R.view === SIDE) { R.a1x = 2.0 + s * 0.3; R.a1y = -7.6 - s * 0.4; R.a0x = 2.0 - s * 0.7; R.a0y = -7.5; }
      else { R.a0x = -0.25 - s * 1.4; R.a0y = -7.8; R.a1x = 0.25 + s * 1.4; R.a1y = -7.8; }
      R.hy = -5.25 + (1 - s) * 0.08;
    },
    point(t) {
      breathe(t);
      R.a1x = 4.4; R.a1y = -9.7 + Math.sin(t * 2) * 0.1; R.e1 = 1;
      const s0 = shoulder(0); R.a0x = s0[0] - 0.3; R.a0y = s0[1] + 3.2; R.e0 = -1;
      R.tool = 'finger'; R.tAng = -0.5; R.look = 1;
    },
    look(t) { breathe(t, 0.12); R.hx = Math.sin(t * 0.6) * 0.06; R.tilt = Math.sin(t * 0.37) > 0.8 ? 0.08 : 0; },
    shrug(t) {
      const u = (t / 2.4) % 1, k = smooth(seg(u, 0, 0.18)) * (1 - smooth(seg(u, 0.7, 0.88)));
      R.sh = -0.55 * k; R.tilt = 0.14 * k;
      if (R.view === SIDE) { R.a1x = lerp(0.8, 2.6, k); R.a1y = lerp(-5.6, -7.4, k); R.a0x = lerp(-0.7, 1.4, k); R.a0y = lerp(-5.6, -7.2, k); }
      else { R.a0x = lerp(-2.35, -3.4, k); R.a0y = lerp(-5.75, -7.6, k); R.a1x = lerp(2.35, 3.4, k); R.a1y = lerp(-5.75, -7.6, k); }
    },
    huddle(t) {
      R.tx = Math.sin(t * 38) * 0.1; R.hy = -5.05; R.hdy = 0.25; R.sh = -0.25;
      if (R.view === SIDE) { R.a1x = 1.0; R.a1y = -7.4; R.a0x = 1.3; R.a0y = -7.6; }
      else { R.a0x = 1.0; R.a0y = -7.5; R.a1x = -1.0; R.a1y = -7.2; R.e0 = -1; R.e1 = 1; }
      R.fx = 9; R.fxT = t;
    },
    throw(t) {
      const u = (t / 1.5) % 1;
      R.grip = false;
      if (u < 0.45) { const k = smooth(u / 0.45); R.a1x = lerp(1.6, -1.8, k); R.a1y = lerp(-7.4, -11.4, k); R.lean = lerp(0.05, -0.14, k); }
      else if (u < 0.6) { const k = outQ(seg(u, 0.45, 0.6)); R.a1x = lerp(-1.8, 3.6, k); R.a1y = lerp(-11.4, -9.2, k); R.lean = lerp(-0.14, 0.24, k); }
      else { const k = smooth(seg(u, 0.6, 1)); R.a1x = lerp(3.6, 1.6, k); R.a1y = lerp(-9.2, -7.4, k); R.lean = lerp(0.24, 0.05, k); }
      R.a0x = 2.2; R.a0y = -8.4; R.f1x = 1.0; R.f0x = -0.9;
      R.item = u < 0.52 || u > 0.92 ? 'ballHand' : 'ballFly'; R.fxT = seg(u, 0.52, 0.92);
    },
    pet(t) {
      R.grip = false; R.hy = -3.3; R.lean = 0.32; R.hdy = 0.1; R.eyes = 2;
      R.f1x = 1.0; R.f0x = -0.6;
      const s = Math.sin(t * TAU / 1.1);
      R.a1x = 3.2 + s * 0.55; R.a1y = -2.9 - Math.abs(s) * 0.2; R.a0x = 1.8; R.a0y = -3.3;
    },
    crouch(t) { breathe(t, 0.06); R.hy = -3.3; R.lean = 0.3; R.f1x = 1.0; R.f0x = -0.6; R.a1x = 2.2; R.a1y = -3.6; R.a0x = 1.7; R.a0y = -3.7; R.hdy = 0.15; },
    stretch(t) {
      const u = (t / 3.4) % 1, k = smooth(seg(u, 0, 0.3)) * (1 - smooth(seg(u, 0.62, 0.85)));
      R.lean = -0.12 * k; R.tilt = -0.15 * k; R.eyes = k > 0.6 ? 1 : 0; R.mouth = k > 0.6 ? 1 : 0;
      if (R.view === SIDE) { R.a1x = lerp(0.8, 2.4, k); R.a1y = lerp(-5.2, -12.6, k); R.a0x = lerp(-0.6, -1.6, k); R.a0y = lerp(-5.2, -12.4, k); }
      else { R.a0x = lerp(-2.3, -3.3, k); R.a0y = lerp(-5.3, -12.5, k); R.a1x = lerp(2.3, 3.3, k); R.a1y = lerp(-5.3, -12.5, k); }
      R.hy = -5.25 - 0.2 * k;
    },
    cheer(t) {
      const ph = (t / 0.7) % 1, j = Math.max(0, Math.sin(ph * TAU));
      R.ty = -1.4 * j; R.eyes = 2; R.mouth = 1;
      const sh = Math.sin(t * 20) * 0.15;
      if (R.view === SIDE) { R.a1x = 2.8 + sh; R.a1y = -12.3; R.a0x = -1.6 - sh; R.a0y = -12.2; R.e0 = R.e1 = 1; }
      else { R.a0x = -3.7 + sh; R.a0y = -12.0; R.a1x = 3.7 - sh; R.a1y = -12.0; }
      R.f0y = ANK - j * 0.5; R.f1y = ANK - j * 0.5; R.hy = -5.25 + j * 0.1;
    },
    nod(t) { breathe(t); const n = Math.max(0, Math.sin(t * TAU / 0.8)); R.hdy = n * 0.3; R.tilt = n * 0.16; R.eyes = n > 0.7 ? 2 : 0; },
    raise(t) {
      breathe(t);
      if (R.view === SIDE) { R.a1x = 2.4; R.a1y = -12.6; R.a0x = 2.2; R.a0y = -9.9; R.e0 = 1; }
      else { R.a1x = 3.6; R.a1y = -12.3; R.a0x = 0.6; R.a0y = -9.6; R.e0 = -1; }
      R.mouth = 2; R.tool0 = 'whistle'; R.fx = 10; R.fxT = t;
    },
    sleep(t) {
      sitBase(); const b = Math.sin(t * TAU / 4) * 0.12;
      R.lean = 0.12; R.hdy = 0.55 + b; R.tilt = 0.32; R.eyes = 1; R.hatTip = 0.35; R.hy = -3.35 + b * 0.3;
      if (R.view === SIDE) { R.a1x = 1.7; R.a1y = -4.5; R.a0x = 1.3; R.a0y = -4.6; }
      else { R.kfk = true; R.k0x = -1.0; R.k0y = -3.2; R.k1x = 1.0; R.k1y = -3.2; R.f0x = -1.05; R.f0y = ANK; R.f1x = 1.05; R.f1y = ANK; R.a0x = 0.6; R.a0y = -4.4; R.a1x = -0.6; R.a1y = -4.6; R.e0 = -1; R.e1 = 1; }
    },
    bend(t) {
      const u = Math.min(1, t / 1.2);
      const k = u < 0.45 ? smooth(u / 0.45) : u < 0.6 ? 1 : 1 - smooth(seg(u, 0.6, 1));
      R.lean = 1.05 * k; R.hy = -5.25 + 0.9 * k; R.hx = -0.5 * k; R.f1x = 0.8;
      R.a1x = lerp(0.8, 2.7, k); R.a1y = lerp(-5.6, -0.6, k); R.a0x = lerp(-0.7, 2.2, k); R.a0y = lerp(-5.6, -0.8, k);
      R.grip = k < 0.05;
    },
  };
  const WH = [0, 0];
  function wireHand(k) {
    if (k < 0.5) { const q = smooth(k * 2); WH[0] = lerp(2.0, 1.3, q); WH[1] = lerp(-12.4, -6.9, q); }
    else { const q = smooth((k - 0.5) * 2); WH[0] = lerp(1.3, 2.2, q) - 0.5 * Math.sin((k - 0.5) * 2 * Math.PI); WH[1] = lerp(-6.9, -12.4, q); }
  }
  /* which poses have a facing-you version, and which only exist facing you */
  const FRONT_OK = { stand: 1, look: 1, wave: 1, clap: 1, shrug: 1, huddle: 1, cheer: 1, sit: 1, sitbeam: 1, raise: 1, signal: 1, guide: 1,
    stretch: 1, nod: 1, drink: 1, eat: 1, sleep: 1, walk: 1 };
  const FRONT_ONLY = { sitbeam: 1 };
  const FOOD = { mug: 1, thermos: 1, sandwich: 1 };

  /* carry grips: where the hands go for each carried thing; returns the layer the thing is drawn on */
  function gripFor(carry, view) {
    const side = view === SIDE;
    switch (carry) {
      case 'beam': case 'rebar': case 'shovel':
        if (side) { const s = shoulder(1); R.a1x = s[0] + 0.9; R.a1y = s[1] - 1.1; R.e1 = 1; }
        else { R.a1x = 1.9; R.a1y = -10.7; }
        return 'mid';
      case 'panel': if (side) { R.a1x = 1.4; R.a1y = -9.6; R.a0x = -0.6; R.a0y = -9.8; } else { R.a0x = -2.2; R.a0y = -9.0; R.a1x = 2.2; R.a1y = -9.0; } return 'back';
      case 'bricks': case 'tarp': case 'spool': case 'plant': case 'cake':
        if (side) { R.a1x = 2.2; R.a1y = -6.6; R.a0x = 1.8; R.a0y = -6.8; } else { R.a0x = -1.6; R.a0y = -6.6; R.a1x = 1.6; R.a1y = -6.6; }
        return 'mid';
      case 'pane': if (side) { R.a1x = 3.4; R.a1y = -7.0; R.a0x = 2.4; R.a0y = -9.6; } else { R.a0x = -2.4; R.a0y = -7.0; R.a1x = 2.4; R.a1y = -7.0; } return 'mid';
      case 'paneL': case 'paneR': if (side) { R.a1x = 1.9; R.a1y = -7.0; R.a0x = 1.3; R.a0y = -7.2; } else { R.a0x = -1.0; R.a0y = -7.0; R.a1x = 1.0; R.a1y = -7.0; } return 'mid';
      case 'barrow': R.a1x = 3.3; R.a1y = -5.5; R.a0x = 3.0; R.a0y = -5.6; R.lean = Math.max(R.lean, 0.2); return 'mid';
      case 'stakes': if (side) { R.a1x = 1.3; R.a1y = -6.4; } else { R.a1x = 2.4; R.a1y = -6.4; } return 'hand';
      case 'clipboard': if (side) { R.a1x = 1.8; R.a1y = -7.2; R.a0x = 1.6; R.a0y = -7.8; } else { R.a0x = -0.8; R.a0y = -7.2; R.a1x = 1.2; R.a1y = -7.4; } return 'mid';
      case 'mug': case 'thermos': case 'sandwich': case 'snowball': case 'hat':
        if (side) { R.a1x = 1.8; R.a1y = -7.3; } else { R.a1x = 1.9; R.a1y = -7.0; } return 'hand';
      case 'bucket': case 'toolbox': if (side) { R.a1x = 0.9; R.a1y = -5.3; } else { R.a1x = 2.5; R.a1y = -5.4; } return 'hand';
      case 'flag': if (side) { R.a1x = 1.4; R.a1y = -8.4; } else { R.a1x = 2.2; R.a1y = -8.4; } return 'hand';
      default: return null;
    }
  }

  const fig = { x: 0, y: 0, f: 1, s: 1 };           // what is being drawn (world placement, for lights)
  let curL = null;
  function figure(ctx, x, y, o = {}) {
    const pose = P[o.pose] ? o.pose : 'stand';
    const t = o.t || 0, s = o.scale || 1;
    let f = o.facing === -1 ? -1 : o.facing === 0 ? 0 : 1;
    const L = curL = look(o.colors);
    let view = SIDE;
    if (f === 0) { if (FRONT_OK[pose]) view = FRONT; f = 1; }
    if (FRONT_ONLY[pose]) view = FRONT;
    reset(view);
    P[pose](t);
    view = R.view;
    let carry = o.carry || null;
    const hatOff = o.hat === false;
    if (!carry && hatOff && (pose === 'walk' || pose === 'stand' || pose === 'look' || pose === 'run')) carry = 'hat';
    if (pose === 'push' && !carry) carry = 'barrow';
    let layer = null;
    if (carry && (R.grip || (carry === 'barrow' && pose === 'push'))) layer = gripFor(carry, view);
    else if (carry && pose === 'climb' && (carry === 'beam' || carry === 'rebar' || carry === 'shovel' || carry === 'spool')) layer = 'backpack';
    if ((pose === 'drink' || pose === 'eat') && (!carry || FOOD[carry])) layer = 'hand';
    if (pose === 'sitbeam' && carry && FOOD[carry]) {
      const u = (t / 4.2) % 1, up = smooth(seg(u, 0, 0.15)) * (1 - smooth(seg(u, 0.4, 0.55)));
      R.a1x = lerp(2.2, 0.9, up); R.a1y = lerp(-1.2, -5.0, up); R.drinkUp = up; layer = 'hand';
    }
    if (carry === 'barrow' && pose === 'walk') R.lean = 0.2;
    fig.x = x; fig.y = y; fig.f = f; fig.s = s;
    ctx.save();
    ctx.translate(x, y);
    if (o.shadow !== false && R.shadow && R.ty > -2) { ctx.globalAlpha = 0.2 + 0.05 * R.ty; oval(ctx, 0.3 * f, 0.1, 3.4 * s, 0.85 * s, C.shadow, false); ctx.globalAlpha = 1; }
    ctx.scale(f * s, s);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    drawRig(ctx, L, f, carry, layer, o, t, hatOff || carry === 'hat');
    ctx.restore();
  }

  /* where a local point lands in the world (lights pushed while drawing) */
  const wx = (lx) => fig.x + lx * fig.f * fig.s, wy = (ly) => fig.y + ly * fig.s;
  const STRIPES = [1.75, 2.85];

  function drawRig(ctx, L, f, carry, layer, o, t, bare) {
    const view = R.view, side = view === SIDE;
    const ux = Math.sin(R.lean), uy = -Math.cos(R.lean), px = -uy, py = ux;
    const ox = R.tx, oy = R.ty;
    const hx = R.hx + ox, hy = R.hy + oy;
    const scx = hx + ux * TORSO, scy = hy + uy * TORSO + R.sh;
    const hcx = hx + ux * (TORSO + HEADUP) + R.hdx, hcy = hy + uy * (TORSO + HEADUP) + R.hdy;
    /* arm roots, hip roots */
    const sOff = side ? 0.45 : 1.85, sOff0 = side ? -0.6 : -1.85;
    const s1x = scx - ux * 0.6 + px * sOff, s1y = scy - uy * 0.6 + py * sOff;
    const s0x = scx - ux * 0.6 + px * sOff0, s0y = scy - uy * 0.6 + py * sOff0;
    const hOff = side ? 0.3 : 0.82;
    const h1x = hx + px * hOff, h1y = hy + py * hOff, h0x = hx - px * hOff, h0y = hy - py * hOff;
    const a0x = R.a0x + ox, a0y = R.a0y + oy, a1x = R.a1x + ox, a1y = R.a1y + oy;
    const f0x = R.f0x + ox, f0y = R.f0y + oy, f1x = R.f1x + ox, f1y = R.f1y + oy;

    if (layer === 'back') drawCarry(ctx, carry, 'back', o, t, view);

    /* far arm (side view) */
    if (side) drawArm(ctx, s0x, s0y, a0x, a0y, R.e0, L.shirtSh, L, R.tool0, R.t0Ang, true);
    /* legs */
    drawLeg(ctx, h0x, h0y, f0x, f0y, 0, side ? L.pantsSh : L.pants, L, view);
    drawLeg(ctx, h1x, h1y, f1x, f1y, 1, L.pants, L, view);
    if (R.item === 'barrow' || carry === 'barrow') drawBarrow(ctx, 4.6 + ox, oy, o.load != null ? o.load : null, (o.t || 0) * 6, true);
    /* seat of the pants */
    bar(ctx, hx, hy + 0.3, hx + ux * 0.9, hy + uy * 0.9, side ? 3.3 : 3.7, L.pants);
    /* torso (the vest) */
    const tw = side ? 3.9 : 4.5;
    const b0x = hx + ux * 1.35, b0y = hy + uy * 1.35, b1x = hx + ux * (TORSO - 0.45), b1y = hy + uy * (TORSO - 0.45) + R.sh * 0.6;
    bar(ctx, b0x, b0y, b1x, b1y, tw, L.vest);
    /* soft light from the upper left: a highlight on the lit side (world left = local -f), shade on the other */
    const hl = -f;
    ctx.globalAlpha = 0.55;
    line(ctx, b0x + hl * 0.95 * px + ux * 0.2, b0y + hl * 0.95 * py + uy * 0.2, b1x + hl * 0.95 * px, b1y + hl * 0.95 * py, 1.0, L.vestHi);
    ctx.globalAlpha = 0.5;
    line(ctx, b0x - hl * 1.2 * px, b0y - hl * 1.2 * py, b1x - hl * 1.2 * px, b1y - hl * 1.2 * py, 0.9, L.vestSh);
    ctx.globalAlpha = 1;
    /* shirt at the collar */
    if (view !== BACK) {
      const cx = b1x + px * (side ? 1.05 : 0) + ux * 1.25, cy = b1y + py * (side ? 1.05 : 0) + uy * 1.25;
      ctx.beginPath(); ctx.moveTo(cx - px * 0.8, cy - py * 0.8); ctx.lineTo(cx - ux * 1.3, cy - uy * 1.3); ctx.lineTo(cx + px * 0.8, cy + py * 0.8);
      ctx.lineWidth = 0.75; ctx.strokeStyle = L.shirt; ctx.stroke();
    }
    /* reflective stripes */
    const stc = C.stripeNight;
    ctx.lineCap = 'butt';
    for (let i = 0; i < 2; i++) {
      const d = STRIPES[i], cx = hx + ux * d, cy = hy + uy * d, hw = tw / 2 - 0.05;
      line(ctx, cx - px * hw, cy - py * hw, cx + px * hw, cy + py * hw, 0.48, stc);
    }
    if (side) line(ctx, b1x + px * 0.75 + ux * 1.1, b1y + py * 0.75 + uy * 1.1, hx + ux * 2.55 + px * 0.75, hy + uy * 2.55 + py * 0.75, 0.45, stc);
    else { line(ctx, b1x - px * 0.95 + ux * 1.25, b1y - py * 0.95 + uy * 1.25, hx + ux * 2.55 - px * 0.95, hy + uy * 2.55 - py * 0.95, 0.45, stc); line(ctx, b1x + px * 0.95 + ux * 1.25, b1y + py * 0.95 + uy * 1.25, hx + ux * 2.55 + px * 0.95, hy + uy * 2.55 + py * 0.95, 0.45, stc); }
    ctx.lineCap = 'round';
    if (view === FRONT) line(ctx, b1x + ux * 0.9, b1y + uy * 0.9, hx + ux * 0.4, hy + uy * 0.4, 0.22, L.vestSh);
    if (layer === 'backpack') drawCarry(ctx, carry, 'backpack', o, t, view, scx, scy);

    /* front view: hanging arms go before the head, raised ones after */
    /* arms go behind the big head unless the hand is at the face (drinking, eating, the whistle) */
    const held = layer === 'mid' || layer === 'hand';
    const a0late = atFace(a0x, a0y, hcx, hcy, held), a1late = atFace(a1x, a1y, hcx, hcy, held);
    if ((side || view === FRONT) && !a1late) drawArm(ctx, s1x, s1y, a1x, a1y, R.e1, L.shirt, L, R.tool, R.tAng, false);
    if (view === FRONT && !a0late) drawArm(ctx, s0x, s0y, a0x, a0y, R.e0, L.shirt, L, R.tool0, R.t0Ang, false);
    /* head */
    drawHead(ctx, hcx, hcy, L, view, f, bare, o);
    if (view === BACK) { drawArm(ctx, s0x, s0y, a0x, a0y, R.e0, L.shirt, L, null, 0, false); drawArm(ctx, s1x, s1y, a1x, a1y, R.e1, L.shirt, L, null, 0, false); }
    if (layer === 'mid') drawCarry(ctx, carry, 'mid', o, t, view, scx, scy);
    if (R.item === 'crate') drawItem(ctx, 'crate', a1x, a1y);
    if (R.item === 'mound') drawItem(ctx, 'mound', 3.3 + ox, 0);
    if (view === FRONT) {
      if (a0late) drawArm(ctx, s0x, s0y, a0x, a0y, R.e0, L.shirt, L, R.tool0, R.t0Ang, false);
      if (a1late) drawArm(ctx, s1x, s1y, a1x, a1y, R.e1, L.shirt, L, R.tool, R.tAng, false);
    } else if (side && a1late) drawArm(ctx, s1x, s1y, a1x, a1y, R.e1, L.shirt, L, R.tool, R.tAng, false);
    if (layer === 'hand') drawCarry(ctx, carry, 'hand', o, t, view);
    /* effects */
    if (R.fx) drawFx(ctx, R.fx, R.fxT, a1x, a1y, hcx, hcy, view);
    else if (K.light.snowy && view !== BACK && !K.reduced) drawFx(ctx, 9, K.t * 0.8 + (L.seed % 50) * 0.11, a1x, a1y, hcx, hcy, view);
    if (R.item === 'ballFly') drawItem(ctx, 'ballFly', 3.6, -9.2);
    else if (R.item === 'ballHand' && (!carry || carry === 'snowball')) drawHandItem(ctx, 'snowball', a1x, a1y, t, view, o);
  }

  function atFace(x, y, hcx, hcy, held) { return (Math.abs(x - hcx) < 2.3 && y > hcy - 2.4 && y < hcy + 3.0) || (held && y > hcy + 2.0); }
  function drawLeg(ctx, hx, hy, fx, fy, i, col, L, view) {
    let jx, jy;
    if (R.kfk) { jx = (i ? R.k1x : R.k0x) + R.tx; jy = (i ? R.k1y : R.k0y) + R.ty; }
    else { ik(hx, hy, fx, fy, THIGH, SHIN, view === SIDE ? R.kd : (i ? -0.25 : 0.25)); jx = IK.jx; jy = IK.jy; fx = IK.ex; fy = IK.ey; }
    limb(ctx, hx, hy, jx, jy, fx, fy, LEGW, col);
    /* boot */
    const bc = i || view !== SIDE ? L.boots : L.bootsSh;
    ctx.beginPath();
    if (view === SIDE) { ctx.moveTo(fx - 0.45, fy + 0.15); ctx.lineTo(fx + 0.95, fy + 0.35); }
    else { ctx.moveTo(fx - 0.35, fy + 0.3); ctx.lineTo(fx + 0.35, fy + 0.3); }
    const bw = view === SIDE ? 1.35 : 1.5;
    ctx.lineWidth = bw + OUT * 2; ctx.strokeStyle = C.ink; ctx.stroke(); ctx.lineWidth = bw; ctx.strokeStyle = bc; ctx.stroke();
  }
  function drawArm(ctx, sx, sy, hx, hy, dir, col, L, tool, ang, far) {
    /* raised arms keep their elbows out and down, never across the face */
    if (hy < sy - 1.0) {
      ik(sx, sy, hx, hy, UPPER, FORE, 1); const ax = IK.jx, ay = IK.jy;
      ik(sx, sy, hx, hy, UPPER, FORE, -1);
      const out = R.view === SIDE ? (ay > IK.jy) : (Math.abs(ax) > Math.abs(IK.jx));
      if (out) ik(sx, sy, hx, hy, UPPER, FORE, 1);
    } else ik(sx, sy, hx, hy, UPPER, FORE, dir);
    const ex = IK.ex, ey = IK.ey;
    limb(ctx, sx, sy, IK.jx, IK.jy, ex, ey, ARMW, col);
    if (tool) drawTool(ctx, tool, ex, ey, ang);
    disc(ctx, ex, ey, HANDR, far ? L.gloveSh : L.glove);
  }

  function drawHead(ctx, cx, cy, L, view, f, bare, o) {
    ctx.save();
    ctx.translate(cx, cy);
    if (R.tilt) ctx.rotate(R.tilt);
    ctx.scale(HS, HS);
    const side = view === SIDE, st = L.style;
    /* hair behind (ponytail, bun) */
    if (st === 2 && view !== FRONT) { ctx.beginPath(); ctx.ellipse(side ? -2.3 : 0, side ? 0.6 : 1.4, 0.75, 1.25, side ? 0.5 : 0, 0, TAU); fillOut(ctx, L.hair); }
    if (st === 3) disc(ctx, side ? -1.9 : 0, side ? -0.4 : -0.15, 0.95, L.hair);
    /* the head: a shade disc, the lit face offset up-left */
    disc(ctx, 0, 0, HR, view === BACK ? L.hair : L.skinSh);
    if (view !== BACK) { ctx.beginPath(); ctx.arc(-0.22 * f, -0.2, HR - 0.32, 0, TAU); ctx.fillStyle = L.skin; ctx.fill(); }
    else { ctx.beginPath(); ctx.arc(0, 1.0, 1.6, 0.15 * Math.PI, 0.85 * Math.PI); ctx.closePath(); ctx.fillStyle = L.skinSh; ctx.fill(); }
    /* hair on the head */
    ctx.fillStyle = L.hair;
    if (side) {
      ctx.beginPath(); ctx.arc(0, 0, HR, 0.62 * Math.PI, 1.45 * Math.PI); ctx.quadraticCurveTo(-0.6, -0.9, -0.95, 0.6); ctx.closePath(); ctx.fill();
      if (st === 4) { disc(ctx, -1.6, 0.9, 0.7, L.hair, false); disc(ctx, -1.9, -0.1, 0.65, L.hair, false); }
      disc(ctx, -0.55, 0.35, 0.5, L.skinSh, false);           // an ear
    } else if (view === FRONT) {
      ctx.beginPath(); ctx.arc(0, 0, HR, 0.8 * Math.PI, 1.25 * Math.PI); ctx.lineTo(-1.2, -0.6); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(0, 0, HR, 1.75 * Math.PI, 0.2 * Math.PI); ctx.lineTo(1.2, -0.6); ctx.closePath(); ctx.fill();
    }
    if (bare) {
      /* hat off: the full head of hair */
      ctx.beginPath(); ctx.arc(0, -0.15, HR + 0.12, Math.PI * 1.02, Math.PI * 1.98); ctx.quadraticCurveTo(side ? 1.4 : 0, -1.0, -HR, -0.2); ctx.closePath(); fillOut(ctx, L.hair, 0.35);
      ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(-0.5, -1.4, 1.0, Math.PI * 1.1, Math.PI * 1.6); ctx.lineWidth = 0.35; ctx.strokeStyle = L.hairHi; ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (view !== BACK) drawFace(ctx, L, view, o);
    if (!bare) drawHat(ctx, L, view, R.hatTip);
    ctx.restore();
  }
  function drawFace(ctx, L, view, o) {
    const side = view === SIDE;
    const lk = R.look * 0.25;
    const e1x = side ? 1.55 : 0.85 + lk, e0x = side ? 0.42 : -0.85 + lk, ey = 0.15;
    const blink = o.blink != null ? !!o.blink : ((K.t * 0.31 + (L.seed % 97) * 0.07) % 3.3) < 0.1;
    const eyes = R.eyes || (blink ? 1 : 0);
    /* cheeks */
    ctx.globalAlpha = 0.55;
    if (side) disc(ctx, 1.25, 0.95, 0.5, L.blush, false);
    else { disc(ctx, -1.35, 0.9, 0.5, L.blush, false); disc(ctx, 1.35, 0.9, 0.5, L.blush, false); }
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.ink; ctx.strokeStyle = C.ink;
    if (eyes === 0) {
      ctx.beginPath(); ctx.ellipse(e1x, ey, 0.3, 0.38, 0, 0, TAU); ctx.ellipse(e0x, ey, side ? 0.24 : 0.3, side ? 0.33 : 0.38, 0, 0, TAU); ctx.fill();
    } else {
      ctx.lineWidth = 0.26; ctx.beginPath();
      if (eyes === 1) { ctx.moveTo(e1x - 0.32, ey + 0.05); ctx.lineTo(e1x + 0.32, ey + 0.05); ctx.moveTo(e0x - 0.28, ey + 0.05); ctx.lineTo(e0x + 0.28, ey + 0.05); }
      else { ctx.moveTo(e1x - 0.32, ey + 0.15); ctx.quadraticCurveTo(e1x, ey - 0.35, e1x + 0.32, ey + 0.15); ctx.moveTo(e0x - 0.28, ey + 0.15); ctx.quadraticCurveTo(e0x, ey - 0.3, e0x + 0.28, ey + 0.15); }
      ctx.stroke();
    }
    /* mouth */
    const mx = side ? 1.25 : lk, my = 1.25;
    if (R.mouth === 1) { ctx.beginPath(); ctx.ellipse(mx, my, 0.32, 0.36, 0, 0, TAU); ctx.fill(); }
    else if (R.mouth === 2) { ctx.beginPath(); ctx.arc(mx + 0.1, my - 0.05, 0.22, 0, TAU); ctx.fill(); }
    else { ctx.lineWidth = 0.22; ctx.beginPath(); ctx.arc(mx, my - 0.35, 0.38, 0.25 * Math.PI, 0.75 * Math.PI); ctx.stroke(); }
  }
  function drawHat(ctx, L, view, tip) {
    const side = view === SIDE;
    ctx.save();
    if (tip) { ctx.translate(0.6, 0); ctx.rotate(tip); }
    const dx = side ? 0.12 : 0, dy = -0.32;
    /* dome: the shade, then the lit dome offset up-left */
    ctx.beginPath(); ctx.ellipse(dx, dy, 2.6, 2.5, 0, Math.PI, TAU); ctx.closePath(); fillOut(ctx, L.hatSh);
    ctx.beginPath(); ctx.ellipse(dx - 0.18, dy - 0.05, 2.32, 2.3, 0, Math.PI * 1.02, Math.PI * 1.9); ctx.quadraticCurveTo(dx + 0.6, dy - 0.3, dx - 2.4, dy - 0.05); ctx.closePath(); ctx.fillStyle = L.hat; ctx.fill();
    /* the ridge */
    ctx.beginPath();
    if (side) ctx.ellipse(dx - 0.05, dy, 1.75, 2.0, 0, Math.PI * 1.12, Math.PI * 1.88);
    else { ctx.moveTo(dx, dy - 2.45); ctx.lineTo(dx, dy - 0.4); }
    ctx.lineWidth = 0.5; ctx.strokeStyle = L.hatHi; ctx.stroke();
    /* gloss */
    ctx.globalAlpha = 0.85; oval(ctx, dx - 1.25, dy - 1.45, 0.5, 0.28, L.gloss, false, -0.6); ctx.globalAlpha = 1;
    /* brim */
    ctx.beginPath();
    if (side) { ctx.moveTo(dx - 2.75, dy - 0.05); ctx.lineTo(dx + 2.55, dy - 0.05); ctx.quadraticCurveTo(dx + 3.6, dy + 0.05, dx + 3.3, dy + 0.45); ctx.lineTo(dx - 2.6, dy + 0.5); ctx.quadraticCurveTo(dx - 3.0, dy + 0.25, dx - 2.75, dy - 0.05); }
    else rr(ctx, dx - 3.0, dy - 0.2, 6.0, 0.72, 0.36);
    fillOut(ctx, L.hat);
    ctx.globalAlpha = 0.6; line(ctx, dx - (side ? 2.4 : 2.6), dy + 0.42, dx + (side ? 3.0 : 2.6), dy + 0.42, 0.24, L.hatSh); ctx.globalAlpha = 1;
    /* snow settles on the hat while it snows */
    if (K.light.weather === 'snow') { ctx.beginPath(); ctx.ellipse(dx - 0.1, dy - 2.05, 1.7, 0.75, 0, Math.PI, TAU); ctx.quadraticCurveTo(dx, dy - 1.75, dx - 1.8, dy - 2.05); ctx.fillStyle = C.snowFlake; ctx.fill(); }
    ctx.restore();
  }

  /* ---------------------------------------------------------- tools in hand (local frame, at the hand) */
  function drawTool(ctx, tool, x, y, a) {
    const ca = Math.cos(a), sa = Math.sin(a);
    switch (tool) {
      case 'hammer': {
        const hx = x + ca * 2.5, hy = y + sa * 2.5;
        bar(ctx, x - ca * 0.5, y - sa * 0.5, hx, hy, 0.42, C.timber);
        bar(ctx, hx - sa * 0.7, hy + ca * 0.7, hx + sa * 0.55, hy - ca * 0.55, 0.7, C.steel);
        break;
      }
      case 'drill': {
        box(ctx, x - 0.9, y - 1.7, 2.6, 1.15, 0.45, C.drill);
        bar(ctx, x - 0.1, y - 0.8, x - 0.2, y + 0.4, 0.75, C.tool);
        box(ctx, x - 0.75, y + 0.25, 1.3, 0.6, 0.2, C.tool);
        bar(ctx, x + 1.7, y - 1.15, x + 2.8, y - 1.15, 0.22, C.toolSteel, false);
        break;
      }
      case 'trowel': {
        const bx = x + ca * 1.0, by = y + sa * 1.0;
        bar(ctx, x - ca * 0.3, y - sa * 0.3, bx, by, 0.45, C.timberShade);
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + ca * 0.6 - sa * 0.8, by + sa * 0.6 + ca * 0.8); ctx.lineTo(bx + ca * 2.3, by + sa * 2.3); ctx.lineTo(bx + ca * 0.6 + sa * 0.25, by + sa * 0.6 - ca * 0.25); ctx.closePath();
        fillOut(ctx, C.toolSteel, 0.3);
        break;
      }
      case 'saw': {
        const L1 = 4.2;
        ctx.beginPath(); ctx.moveTo(x + ca * 0.5 - sa * 0.5, y + sa * 0.5 + ca * 0.5); ctx.lineTo(x + ca * L1 - sa * 0.25, y + sa * L1 + ca * 0.25);
        ctx.lineTo(x + ca * L1 + sa * 0.35, y + sa * L1 - ca * 0.35); ctx.lineTo(x + ca * 0.5 + sa * 0.9, y + sa * 0.5 - ca * 0.9); ctx.closePath();
        fillOut(ctx, C.toolSteel, 0.3);
        box(ctx, x - 0.6, y - 0.6, 1.3, 1.2, 0.4, C.redbox);
        break;
      }
      case 'shovel': {
        const L1 = 8.6, bx = x + ca * (L1 - 2.2), by = y + sa * (L1 - 2.2), tx = x + ca * L1, ty = y + sa * L1;
        bar(ctx, x - ca * 0.4, y - sa * 0.4, bx, by, 0.45, C.timberShade);
        bar(ctx, x - ca * 0.6 - sa * 0.5, y - sa * 0.6 + ca * 0.5, x - ca * 0.6 + sa * 0.5, y - sa * 0.6 - ca * 0.5, 0.4, C.tool);
        ctx.beginPath(); ctx.moveTo(bx - sa * 0.75, by + ca * 0.75); ctx.lineTo(bx + sa * 0.75, by - ca * 0.75);
        ctx.quadraticCurveTo(tx + sa * 0.8, ty - ca * 0.8, tx, ty); ctx.quadraticCurveTo(tx - sa * 0.8, ty + ca * 0.8, bx - sa * 0.75, by + ca * 0.75); ctx.closePath();
        fillOut(ctx, C.steel, 0.35);
        if (R.fx === 6 && R.fxT === 0) disc(ctx, tx - ca * 1.0 - sa * 0.4, ty - sa * 1.0 - 0.5, 0.9, C.dirtDark, false);
        break;
      }
      case 'rake': case 'broom': {
        const L1 = 9.5, tx = x + ca * L1, ty = y + sa * L1;
        bar(ctx, x - ca * 0.5, y - sa * 0.5, tx, ty, 0.42, C.timberShade);
        ctx.save(); ctx.translate(tx, ty);
        if (tool === 'rake') {
          ctx.rotate(-0.15);
          bar(ctx, -1.6, 0, 1.6, 0, 0.45, C.tool);
          ctx.beginPath(); for (let i = -1.5; i <= 1.55; i += 0.5) { ctx.moveTo(i, 0); ctx.lineTo(i + 0.15, 0.7); }
          ctx.lineWidth = 0.22; ctx.strokeStyle = C.tool; ctx.stroke();
        } else {
          ctx.rotate(-0.1);
          box(ctx, -1.8, -0.3, 3.6, 0.65, 0.2, C.timberDark);
          ctx.beginPath(); for (let i = -1.6; i <= 1.65; i += 0.4) { ctx.moveTo(i, 0.3); ctx.lineTo(i, 0.95); }
          ctx.lineWidth = 0.25; ctx.strokeStyle = C.trunk; ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case 'brick': box(ctx, x - 0.4, y - 1.2, 2.0, 0.95, 0.15, C.brick); break;
      case 'tape': {
        const ex = R.a1x + R.tx, ey = R.a1y + R.ty;
        if (Math.abs(ex - x) > 0.9) line(ctx, x + 0.7, y + 0.4, ex, ey + 0.3, 0.3, C.tapeHi);
        box(ctx, x - 0.75, y - 0.75, 1.5, 1.5, 0.45, C.tape);
        disc(ctx, x, y, 0.35, C.tool, false);
        break;
      }
      case 'pourBucket': {
        ctx.save(); ctx.translate(x + 0.6, y + 0.6); ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(-1.1, -1.1); ctx.lineTo(1.1, -1.1); ctx.lineTo(0.85, 1.2); ctx.lineTo(-0.85, 1.2); ctx.closePath(); fillOut(ctx, C.bucket, 0.35);
        ctx.restore();
        if (R.fxT > 0.3) { const sx = x + 2.1, sy = y + 0.2; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(sx + 0.8, sy + 1.0, sx + 0.9, -0.1); ctx.lineWidth = 0.6 * R.fxT; ctx.strokeStyle = C.mortarMix; ctx.stroke(); ctx.globalAlpha = 1; }
        break;
      }
      case 'finger': line(ctx, x, y, x + ca * 0.9, y + sa * 0.9, 0.35, C.glove); break;
      case 'whistle': box(ctx, x - 0.2, y - 0.75, 1.2, 0.55, 0.25, C.chrome); break;
    }
  }

  /* ---------------------------------------------------------- effects: impact ticks, dust, sawdust, breath */
  function drawFx(ctx, kind, k, hx, hy, cx, cy, view) {
    switch (kind) {
      case 1: { // hammer impact
        const ix = R.a1x + Math.cos(R.tAng) * 2.1 + 0.6, iy = R.a1y + Math.sin(R.tAng) * 2.1;
        ctx.globalAlpha = 1 - k; ctx.beginPath();
        for (let i = 0; i < 3; i++) { const a = -1.2 + i * 0.8; ctx.moveTo(ix + Math.cos(a) * (0.6 + k), iy + Math.sin(a) * (0.6 + k)); ctx.lineTo(ix + Math.cos(a) * (1.3 + k * 1.4), iy + Math.sin(a) * (1.3 + k * 1.4)); }
        ctx.lineWidth = 0.3; ctx.strokeStyle = C.white; ctx.stroke(); ctx.globalAlpha = 1;
        break;
      }
      case 2: { // drill dust
        const ph = (k * 3) % 1;
        ctx.globalAlpha = 0.7 * (1 - ph); disc(ctx, hx + 3.0 + ph * 0.6, hy - 1.0 + ph * 1.6, 0.25 + ph * 0.2, C.concreteHi, false); ctx.globalAlpha = 1;
        break;
      }
      case 3: { // sawdust falling from the cut
        for (let i = 0; i < 3; i++) { const ph = (k * 1.3 + i / 3) % 1; ctx.globalAlpha = 1 - ph; disc(ctx, 4.9 + i * 0.25, -4.4 + ph * 4.2, 0.18, C.timberHi, false); }
        ctx.globalAlpha = 1;
        break;
      }
      case 5: { // the wire, hand over hand, with a slack loop to the coil
        const top = R.a1y < R.a0y;
        const ax = (top ? R.a1x : R.a0x) + R.tx, ay = top ? R.a1y : R.a0y, bx = (top ? R.a0x : R.a1x) + R.tx, by = top ? R.a0y : R.a1y;
        ctx.beginPath(); ctx.moveTo(3.4, -16.5); ctx.lineTo(ax, ay); ctx.lineTo(bx, by); ctx.quadraticCurveTo(bx - 0.5, -1.0, 2.4, -0.4);
        ctx.lineWidth = 0.32; ctx.strokeStyle = C.copper; ctx.stroke();
        ctx.beginPath(); ctx.ellipse(3.2, -0.45, 1.3, 0.45, 0, 0, TAU); ctx.lineWidth = 0.4; ctx.stroke();
        break;
      }
      case 6: { // a shovelful of dirt flying
        if (k > 0 && k < 1) { const x = 5.5 + k * 3.5, y = -4.5 - Math.sin(k * Math.PI) * 2.5 + k * 3.5; ctx.globalAlpha = 1 - k * 0.5; disc(ctx, x, y, 0.6, C.dirtDark, false); disc(ctx, x + 0.6, y + 0.4, 0.35, C.dirt, false); ctx.globalAlpha = 1; }
        break;
      }
      case 7: { // a tie twist glint
        if (Math.sin(k * 11) > 0.85) { ctx.globalAlpha = 0.9; disc(ctx, 3.3, -1.3, 0.25, C.white, false); ctx.globalAlpha = 1; }
        break;
      }
      case 8: { // broom dust
        const ph = (k * 1.7) % 1; ctx.globalAlpha = 0.45 * (1 - ph);
        disc(ctx, 6.3 + ph * 1.5, -0.6 - ph * 0.9, 0.5 + ph * 0.6, C.dirtHi, false); ctx.globalAlpha = 1;
        break;
      }
      case 9: { // breath in the cold
        const ph = (k / 2.4) % 1;
        if (ph < 0.6) { const q = ph / 0.6; ctx.globalAlpha = 0.55 * (1 - q); disc(ctx, cx + (view === SIDE ? 2.6 : 0.4) + q * 1.4, cy + 0.9 - q * 1.2, 0.4 + q * 0.7, C.snowFlake, false); ctx.globalAlpha = 1; }
        break;
      }
      case 10: { // whistle blasts
        const ph = (k * 1.6) % 1;
        if (ph < 0.55) {
          const wxp = R.a0x + R.tx + 1.4, wyp = R.a0y + R.ty - 0.6;
          ctx.globalAlpha = 1 - ph; ctx.beginPath();
          for (let i = 0; i < 3; i++) { const r = 0.9 + i * 0.6 + ph * 0.8; ctx.moveTo(wxp + Math.cos(-0.5) * r, wyp + Math.sin(-0.5) * r); ctx.arc(wxp, wyp, r, -0.5, 0.5); }
          ctx.lineWidth = 0.28; ctx.strokeStyle = C.white; ctx.stroke(); ctx.globalAlpha = 1;
        }
        break;
      }
    }
  }
  /* pose-owned items (not carries) */
  function drawItem(ctx, what, x, y) {
    switch (what) {
      case 'crate': box(ctx, x - 1.0, y - 2.0, 3.2, 2.6, 0.3, C.cardboard); line(ctx, x - 0.9, y - 1.2, x + 2.1, y - 1.2, 0.25, C.cardboardSh); break;
      case 'mound': ctx.beginPath(); ctx.ellipse(x, y, 2.0, 0.9, 0, Math.PI, TAU); ctx.closePath(); fillOut(ctx, C.soil, 0.35); break;
      case 'ballFly': {
        const k = R.fxT; if (k <= 0 || k >= 1) break;
        disc(ctx, x + k * 9, y - Math.sin(k * Math.PI) * 3 + k * 4, 0.55, C.snowFlake);
        break;
      }
    }
  }

  /* ---------------------------------------------------------- carried things */
  function drawCarry(ctx, carry, layer, o, t, view, scx, scy) {
    const side = view === SIDE;
    const a1x = R.a1x + R.tx, a1y = R.a1y + R.ty;
    switch (carry) {
      case 'beam': case 'rebar': {
        if (layer === 'backpack') { ctx.save(); ctx.translate(scx, scy + 1.5); ctx.rotate(-0.9); drawTimber(ctx, -7, 0, 7, 0, carry); ctx.restore(); break; }
        if (side) { const y0 = a1y + 0.75; drawTimber(ctx, -6.5, y0 - 0.6, 9.0, y0 + 0.5, carry); }
        else { const y0 = -10.9 + R.ty; drawTimber(ctx, -1.5, y0, 6.5, y0 + 0.1, carry); }
        break;
      }
      case 'shovel': {
        if (layer === 'backpack') { ctx.save(); ctx.translate(scx, scy + 1); ctx.rotate(-0.7); drawTool(ctx, 'shovel', -4, 0, 0); ctx.restore(); break; }
        drawTool(ctx, 'shovel', a1x + 0.6, a1y + 0.3, side ? -2.75 : -2.3);
        break;
      }
      case 'spool': {
        if (layer === 'backpack') { drawSpool(ctx, scx, scy + 1.5, 1.8); break; }
        drawSpool(ctx, side ? 2.3 : 0, -7.2 + R.ty, 1.9);
        break;
      }
      case 'panel': drawPanel(ctx, side ? -2.2 : -3.8, -13.6, side ? 7.4 : 7.6, 9.5); break;
      case 'bricks': {
        const bx = side ? 0.8 : -1.6, by = (side ? -6.6 : -6.4) + R.ty;
        for (let i = 0; i < 4; i++) box(ctx, bx + (i % 2) * 0.25, by - (i + 1) * 0.95, 3.2, 0.95, 0.15, i % 2 ? C.brick : C.brickHi);
        break;
      }
      case 'tarp': { const bx = side ? 0.9 : -1.8, by = -6.6 + R.ty; box(ctx, bx, by - 2.2, 3.6, 2.4, 0.7, C.tarp); line(ctx, bx + 0.4, by - 1.1, bx + 3.2, by - 1.1, 0.25, C.tarpSh); break; }
      case 'plant': drawPlant(ctx, side ? 2.2 : 0, -6.0 + R.ty, 0.28, true); break;
      case 'cake': drawCake(ctx, side ? 2.2 : 0, -6.4 + R.ty, t); break;
      case 'pane': if (side) drawGlass(ctx, 1.6, -11.6, 3.0, 8.6, 0); else drawGlass(ctx, -2.8, -11.0, 5.6, 7.6, 0); break;
      case 'paneL': case 'paneR': {
        /* the pane runs from this carrier toward the other one; only paneL draws the glass */
        const ld = (carry === 'paneL' ? 1 : -1) * fig.f;
        if (carry === 'paneL') { const len = o.paneW || 12; drawGlass(ctx, ld > 0 ? 1.0 : -1.0 - len, -11.8, len, 7.2, 0); }
        break;
      }
      case 'clipboard': {
        ctx.save(); ctx.translate(side ? 1.5 : 0.2, -8.4 + R.ty); ctx.rotate(side ? 0.35 : 0.1);
        box(ctx, -1.2, -1.6, 2.4, 3.2, 0.25, C.timberShade); box(ctx, -0.95, -1.25, 1.9, 2.6, 0.1, C.paper, false);
        box(ctx, -0.5, -1.85, 1.0, 0.5, 0.15, C.steel, false);
        ctx.beginPath(); for (let i = 0; i < 3; i++) { ctx.moveTo(-0.7, -0.6 + i * 0.6); ctx.lineTo(0.6, -0.6 + i * 0.6); } ctx.lineWidth = 0.15; ctx.strokeStyle = C.inkSoft; ctx.stroke();
        ctx.restore();
        break;
      }
      case 'barrow': break;   // drawn with the legs
      default: if (layer === 'hand') drawHandItem(ctx, carry, a1x, a1y, t, view, o);
    }
  }
  function drawHandItem(ctx, carry, x, y, t, view, o) {
    let item = carry;
    if (!item && o.pose === 'drink') item = 'mug';
    if (!item && o.pose === 'eat') item = 'sandwich';
    if (!item) return;
    const up = R.drinkUp || 0;
    switch (item) {
      case 'mug': {
        ctx.save(); ctx.translate(x + 0.4, y - 0.6); ctx.rotate(-up * 0.9);
        box(ctx, -0.75, -0.9, 1.5, 1.8, 0.3, C.white);
        ctx.beginPath(); ctx.arc(0.85, 0, 0.5, -1.4, 1.4); ctx.lineWidth = 0.35; ctx.strokeStyle = C.ink; ctx.stroke();
        ctx.restore();
        if (up < 0.1) drawSteam(ctx, x + 0.4, y - 1.8, t);
        break;
      }
      case 'thermos': {
        ctx.save(); ctx.translate(x + 0.3, y - 0.8); ctx.rotate(-up * 0.8);
        box(ctx, -0.6, -1.7, 1.2, 3.2, 0.4, C.thermos); box(ctx, -0.65, -2.2, 1.3, 0.7, 0.25, C.steel);
        ctx.restore();
        break;
      }
      case 'sandwich': {
        ctx.save(); ctx.translate(x + 0.5, y - 0.6); ctx.rotate(-0.3 - up * 0.4);
        ctx.beginPath(); ctx.moveTo(-1.0, 0.7); ctx.lineTo(1.0, 0.7); ctx.lineTo(0, -0.9); ctx.closePath(); fillOut(ctx, C.bread, 0.3);
        line(ctx, -0.75, 0.3, 0.75, 0.3, 0.3, C.lettuce); line(ctx, -0.55, 0.0, 0.55, 0.0, 0.22, C.tomato);
        ctx.restore();
        break;
      }
      case 'snowball': disc(ctx, x + 0.3, y - 0.5, 0.65, C.snowFlake); break;
      case 'hat': {
        const L = curL;
        ctx.save(); ctx.translate(x + 0.5, y - 0.4); ctx.rotate(-0.25); ctx.scale(0.75, 0.75);
        ctx.beginPath(); ctx.ellipse(0, 0, 2.5, 2.3, 0, Math.PI, TAU); ctx.closePath(); fillOut(ctx, L.hat);
        box(ctx, -2.9, -0.15, 5.8, 0.7, 0.35, L.hat);
        ctx.globalAlpha = 0.8; oval(ctx, -1.2, -1.4, 0.45, 0.25, L.gloss, false, -0.6); ctx.globalAlpha = 1;
        ctx.restore();
        break;
      }
      case 'bucket': drawBucket(ctx, x, y + 0.2, 'mortar'); break;
      case 'toolbox': {
        box(ctx, x - 1.8, y + 0.6, 3.6, 2.0, 0.35, C.redbox);
        ctx.beginPath(); ctx.moveTo(x - 0.8, y + 0.7); ctx.lineTo(x - 0.6, y - 0.1); ctx.lineTo(x + 0.6, y - 0.1); ctx.lineTo(x + 0.8, y + 0.7); ctx.lineWidth = 0.35; ctx.strokeStyle = C.ink; ctx.stroke();
        line(ctx, x - 1.7, y + 1.3, x + 1.7, y + 1.3, 0.2, C.redboxSh);
        break;
      }
      case 'stakes': {
        for (let i = 0; i < 4; i++) { const ox = i * 0.45 - 0.7; bar(ctx, x + ox - 1.6, y + 2.0, x + ox + 2.0, y - 2.4, 0.42, C.timber); }
        for (let i = 0; i < 4; i++) { const ox = i * 0.45 - 0.7; line(ctx, x + ox + 1.9, y - 2.2, x + ox + 2.6, y - 2.0 + Math.sin(t * 6 + i) * 0.3, 0.35, C.frosting); }
        break;
      }
      case 'flag': bar(ctx, x, y + 2.0, x - 0.2, y - 9.0, 0.35, C.timberShade); drawFlagCloth(ctx, x - 0.2, y - 9.0, 3.6, 2.2, t); break;
      case 'cake': drawCake(ctx, x, y, t); break;
    }
    void view;
  }
  function drawSteam(ctx, x, y, t) {
    ctx.globalAlpha = 0.5; ctx.beginPath();
    for (let i = 0; i < 2; i++) {
      const ph = (t * 0.6 + i * 0.5) % 1, sx = x - 0.3 + i * 0.6;
      ctx.moveTo(sx, y - ph * 1.5); ctx.bezierCurveTo(sx + 0.5, y - 0.6 - ph * 1.5, sx - 0.5, y - 1.0 - ph * 1.5, sx, y - 1.6 - ph * 1.5);
    }
    ctx.lineWidth = 0.25; ctx.strokeStyle = C.snowFlake; ctx.stroke(); ctx.globalAlpha = 1;
  }

  /* ============================================================ shared drawings (carries and props) */
  function drawTimber(ctx, x0, y0, x1, y1, kind) {
    if (kind === 'rebar') {
      for (let i = 0; i < 3; i++) bar(ctx, x0, y0 + i * 0.32 - 0.3, x1, y1 + i * 0.32 - 0.3, 0.28, C.rebar, i === 0);
      const mx = (x0 + x1) / 2;
      line(ctx, mx - 2, lerp(y0, y1, 0.37) - 0.6, mx - 2, lerp(y0, y1, 0.37) + 0.5, 0.25, C.steel);
      line(ctx, mx + 2, lerp(y0, y1, 0.63) - 0.6, mx + 2, lerp(y0, y1, 0.63) + 0.5, 0.25, C.steel);
      return;
    }
    bar(ctx, x0, y0, x1, y1, 1.25, C.timber);
    ctx.globalAlpha = 0.7; line(ctx, x0 + 0.3, y0 - 0.32, x1 - 0.3, y1 - 0.32, 0.35, C.timberHi); ctx.globalAlpha = 1;
    disc(ctx, x1, y1, 0.55, C.timberHi, false);
  }
  function drawPanel(ctx, x, y, w, h) {
    box(ctx, x, y, w, h, 0.3, C.osb);
    ctx.globalAlpha = 0.55; ctx.beginPath();
    for (let i = 1; i < 4; i++) { ctx.moveTo(x + (w * i) / 4, y + 0.3); ctx.lineTo(x + (w * i) / 4, y + h - 0.3); }
    ctx.lineWidth = 0.3; ctx.strokeStyle = C.osbSh; ctx.stroke();
    ctx.beginPath(); for (let i = 0; i < 6; i++) { const r = (i * 37) % 10 / 10, q = ((i * 53) % 10) / 10; ctx.moveTo(x + 0.6 + r * (w - 1.5), y + 0.8 + q * (h - 1.6)); ctx.lineTo(x + 1.2 + r * (w - 1.5), y + 0.9 + q * (h - 1.6)); }
    ctx.lineWidth = 0.22; ctx.strokeStyle = C.osbHi; ctx.stroke();
    ctx.globalAlpha = 1;
  }
  function drawGlass(ctx, x, y, w, h, tilt) {
    ctx.save(); if (tilt) { ctx.translate(x + w / 2, y + h); ctx.rotate(tilt); ctx.translate(-x - w / 2, -y - h); }
    ctx.globalAlpha = 0.55; ctx.beginPath(); rr(ctx, x, y, w, h, 0.2); ctx.fillStyle = C.glassHi; ctx.fill();
    ctx.globalAlpha = 0.9; ctx.lineWidth = 0.3; ctx.strokeStyle = C.glass; ctx.stroke();
    ctx.globalAlpha = 0.75; ctx.beginPath(); ctx.moveTo(x + w * 0.2, y + h * 0.75); ctx.lineTo(x + w * 0.55, y + h * 0.18); ctx.moveTo(x + w * 0.45, y + h * 0.85); ctx.lineTo(x + w * 0.7, y + h * 0.42);
    ctx.lineWidth = 0.35; ctx.strokeStyle = C.white; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.restore();
  }
  function drawSpool(ctx, cx, cy, r) {
    disc(ctx, cx, cy, r, C.plank);
    disc(ctx, cx, cy, r * 0.72, C.copper, false);
    ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, TAU); ctx.moveTo(cx + r * 0.38, cy); ctx.arc(cx, cy, r * 0.38, 0, TAU); ctx.lineWidth = 0.18; ctx.strokeStyle = C.copperSh; ctx.stroke(); ctx.globalAlpha = 1;
    disc(ctx, cx, cy, r * 0.22, C.plankSh, false);
  }
  function drawBucket(ctx, x, y, content) {
    ctx.beginPath(); ctx.moveTo(x - 1.15, y); ctx.lineTo(x + 1.15, y); ctx.lineTo(x + 0.9, y + 2.4); ctx.lineTo(x - 0.9, y + 2.4); ctx.closePath(); fillOut(ctx, C.bucket, 0.35);
    line(ctx, x - 1.05, y + 0.5, x + 1.05, y + 0.5, 0.2, C.bucketSh);
    if (content) { ctx.beginPath(); ctx.ellipse(x, y + 0.05, 1.0, 0.25, 0, 0, TAU); ctx.fillStyle = content === 'mortar' ? C.mortarMix : C.dirt; ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(x - 1.1, y); ctx.quadraticCurveTo(x, y - 1.2, x + 1.1, y); ctx.lineWidth = 0.2; ctx.strokeStyle = C.steel; ctx.stroke();
  }
  function drawCake(ctx, x, y, t) {
    box(ctx, x - 1.8, y - 1.6, 3.6, 1.8, 0.4, C.cakeBody);
    ctx.beginPath(); ctx.moveTo(x - 1.8, y - 1.0); for (let i = 1; i <= 6; i++) ctx.quadraticCurveTo(x - 1.8 + i * 0.6 - 0.3, y - 0.5, x - 1.8 + i * 0.6, y - 1.0);
    ctx.lineTo(x + 1.8, y - 1.5); ctx.lineTo(x - 1.8, y - 1.5); ctx.closePath(); ctx.fillStyle = C.frosting; ctx.fill();
    line(ctx, x, y - 1.6, x, y - 2.8, 0.35, C.white);
    const fl = 0.85 + Math.sin(t * 17) * 0.15;
    oval(ctx, x + Math.sin(t * 9) * 0.05, y - 3.25, 0.28 * fl, 0.5 * fl, EMIT.candle, false);
    if (K.light.night > 0.2) K.lights.push({ x: wx(x), y: wy(y - 3.2), r: 9, a: 0.55, color: '#ffc46b' });
  }
  function drawPlant(ctx, x, y, g, pot) {
    if (pot) { ctx.beginPath(); ctx.moveTo(x - 1.2, y - 1.6); ctx.lineTo(x + 1.2, y - 1.6); ctx.lineTo(x + 0.9, y + 0.4); ctx.lineTo(x - 0.9, y + 0.4); ctx.closePath(); fillOut(ctx, C.terracotta, 0.35); }
    const base = pot ? y - 1.6 : y, h = 1.2 + g * 4.6;
    bar(ctx, x, base, x, base - h, 0.25 + g * 0.3, C.trunk);
    const cr = 0.9 + g * 1.7, col = treeTone(Math.floor(x * 7 + 3)), cy = base - h - cr * 0.4;
    ctx.beginPath(); ctx.arc(x, cy - cr * 0.35, cr, 0, TAU); ctx.moveTo(x - cr * 0.7 + cr * 0.75, cy + cr * 0.25); ctx.arc(x - cr * 0.7, cy + cr * 0.25, cr * 0.75, 0, TAU);
    ctx.moveTo(x + cr * 0.75 + cr * 0.72, cy + cr * 0.3); ctx.arc(x + cr * 0.75, cy + cr * 0.3, cr * 0.72, 0, TAU); fillOut(ctx, col.sh, 0.35);
    ctx.beginPath(); ctx.arc(x - 0.15, cy - cr * 0.45, cr * 0.82, 0, TAU); ctx.moveTo(x - cr * 0.75 + cr * 0.55, cy + cr * 0.05); ctx.arc(x - cr * 0.75, cy + cr * 0.05, cr * 0.55, 0, TAU); ctx.fillStyle = col.c; ctx.fill();
    ctx.globalAlpha = 0.9; disc(ctx, x - cr * 0.4, cy - cr * 0.75, cr * 0.38, col.hi, false); ctx.globalAlpha = 1;
  }
  function drawFlagCloth(ctx, x, y, w, h, t) {
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let i = 1; i <= 4; i++) ctx.lineTo(x + (w * i) / 4, y + Math.sin(t * 6 - i * 0.9) * 0.35 * (i / 4));
    for (let i = 4; i >= 0; i--) ctx.lineTo(x + (w * i) / 4, y + h + Math.sin(t * 6 - i * 0.9) * 0.35 * (i / 4));
    ctx.closePath(); fillOut(ctx, C.flag, 0.3);
  }
  function drawBarrow(ctx, x, y, load, spin, pushed) {
    /* x is where the handles end (at the hands); the barrow runs forward to the wheel */
    const lift = pushed ? 1 : 0;
    const wx0 = x + 5.6, wy0 = y - 1.3;
    const hy = y - 5.4 * lift - 1.5 * (1 - lift);
    bar(ctx, x - 1.4, hy, wx0, wy0, 0.45, C.steel);
    bar(ctx, x + 1.4, lerp(hy, wy0, 0.3) + 0.2, x + 1.2, lerp(hy, wy0, 0.3) + 2.4 - lift * 1.2, 0.4, C.steel);
    ctx.beginPath(); ctx.moveTo(x + 0.4, hy - 1.2 + lift * 0.4); ctx.lineTo(x + 6.6, wy0 - 3.2); ctx.lineTo(x + 5.0, wy0 - 0.7); ctx.lineTo(x + 1.8, lerp(hy, wy0, 0.4) + 0.6); ctx.closePath();
    fillOut(ctx, C.dumpster, 0.4);
    if (load) {
      const ly = (hy - 1.2 + wy0 - 3.2) / 2 + 0.2;
      if (load === 'bricks') { for (let i = 0; i < 3; i++) box(ctx, x + 1.4 + i * 1.5, ly - 1.4 - (i === 1 ? 0.5 : 0), 1.4, 0.9, 0.1, i % 2 ? C.brick : C.brickHi); }
      else { ctx.beginPath(); ctx.ellipse(x + 3.7, ly - 0.4, 2.8, 1.3, -0.1, Math.PI, TAU); ctx.closePath(); fillOut(ctx, load === 'mortar' ? C.mortarMix : C.dirtDark, 0.35); }
    }
    disc(ctx, wx0, wy0, 1.3, C.tire);
    disc(ctx, wx0, wy0, 0.5, C.steel, false);
    ctx.beginPath(); ctx.moveTo(wx0 + Math.cos(spin) * 0.95, wy0 + Math.sin(spin) * 0.95); ctx.lineTo(wx0 - Math.cos(spin) * 0.95, wy0 - Math.sin(spin) * 0.95);
    ctx.lineWidth = 0.22; ctx.strokeStyle = C.steelSh; ctx.stroke();
  }

  /* tree crowns: a deterministic seasonal colour per tree */
  function season() {
    const m = K.light.month != null ? K.light.month : K.now().getMonth();
    if (K.light.snowy || m === 11 || m <= 2) return 'winter';
    if (m === 8) return 'early';
    if (m === 9) return 'fall';
    if (m === 10) return 'late';
    if (m === 3 || m === 4) return 'spring';
    return 'summer';
  }
  const AUTUMN = ['#c4572e', '#d99a3a', '#b9893a', '#d06a2a', '#a8452e', '#e0b040'];
  const toneCache = new Map();
  function treeTone(seed) {
    const sn = season(), r = ((seed * 2654435761) >>> 0) % 13, k = sn + r;
    let c = toneCache.get(k);
    if (c) return c;
    const q = r / 13;
    let base;
    if (sn === 'fall' && q < 0.72) base = AUTUMN[Math.floor(q / 0.72 * AUTUMN.length) % AUTUMN.length];
    else if (sn === 'early' && q < 0.25) base = AUTUMN[r % 3 + 1];
    else if (sn === 'late') base = q < 0.35 ? AUTUMN[2] : q < 0.55 ? '#9a6a3a' : '#8a7a5a';
    else if (sn === 'spring') base = q < 0.5 ? '#8fb85a' : '#7aa54a';
    else if (sn === 'winter') base = '#7b6d62';
    else base = q < 0.4 ? BASE.tree : q < 0.7 ? '#5a7d44' : BASE.treeLight;
    c = { c: lit(base), hi: lit(mix(base, '#fff2c8', 0.3)), sh: lit(mix(base, '#1e2a30', 0.35)) };
    toneCache.set(k, c);
    return c;
  }

  /* ============================================================ props */
  const MIRROR = { truck: 1, mixerTruck: 1, forklift: 1, dog: 1, barrow: 1, mixer: 1, shovel: 1 };
  function prop(ctx, name, x, y, o = {}) {
    const fn = PR[name];
    if (!fn) return;
    const f = o.facing === -1 && MIRROR[name] ? -1 : 1;
    ctx.save(); ctx.translate(x, y);
    if (f < 0) ctx.scale(-1, 1);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    fig.x = x; fig.y = y; fig.f = f; fig.s = 1;
    fn(ctx, o, o.t != null ? o.t : K.t);
    ctx.restore();
  }
  function groundShadow(ctx, w, a = 0.2) { ctx.globalAlpha = a; oval(ctx, 0, 0.15, w, Math.max(0.6, w * 0.12), C.shadow, false); ctx.globalAlpha = 1; }
  function palletBase(ctx, w) {
    box(ctx, -w / 2, -1.3, w, 0.55, 0.12, C.pallet);
    box(ctx, -w / 2 + 0.4, -0.8, 1.0, 0.8, 0.1, C.palletSh); box(ctx, -0.5, -0.8, 1.0, 0.8, 0.1, C.palletSh); box(ctx, w / 2 - 1.4, -0.8, 1.0, 0.8, 0.1, C.palletSh);
  }
  function wheel(ctx, x, y, r, spin) {
    disc(ctx, x, y, r, C.tire);
    disc(ctx, x, y, r * 0.55, C.steel, false);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) { const a = spin + i * Math.PI / 2; ctx.moveTo(x + Math.cos(a) * r * 0.2, y + Math.sin(a) * r * 0.2); ctx.lineTo(x + Math.cos(a) * r * 0.48, y + Math.sin(a) * r * 0.48); }
    ctx.lineWidth = 0.3; ctx.strokeStyle = C.steelSh; ctx.stroke();
    disc(ctx, x, y, r * 0.16, C.chrome, false);
  }
  function palletLoad(ctx, kind, n, w) {
    const k = Math.max(0, Math.min(5, n == null ? 3 : n));
    if (!k) return;
    switch (kind) {
      case 'brick': {
        const h = 0.9 * k + 0.4;
        box(ctx, -w / 2 + 0.3, -1.3 - h, w - 0.6, h, 0.25, C.brick);
        ctx.beginPath();
        for (let i = 1; i <= k; i++) { const yy = -1.3 - i * 0.9 + 0.2; ctx.moveTo(-w / 2 + 0.4, yy); ctx.lineTo(w / 2 - 0.4, yy); }
        for (let i = 0; i < k; i++) for (let j = 0; j < 4; j++) { const xx = -w / 2 + 0.3 + (j + (i % 2) * 0.5 + 0.5) * (w - 0.6) / 4.5, yy = -1.3 - i * 0.9 - 0.2; ctx.moveTo(xx, yy); ctx.lineTo(xx, yy - 0.7); }
        ctx.lineWidth = 0.18; ctx.strokeStyle = C.mortar; ctx.stroke();
        ctx.globalAlpha = 0.35; line(ctx, -w / 2 + 0.9, -1.6 - h + 0.6, -w / 2 + 1.6, -1.6, 0.5, C.white); ctx.globalAlpha = 1;
        break;
      }
      case 'glass': {
        bar(ctx, -w / 2 + 1.2, -1.3, -w / 2 + 2.6, -9, 0.5, C.steel); bar(ctx, w / 2 - 1.2, -1.3, w / 2 - 2.6, -9, 0.5, C.steel);
        for (let i = 0; i < k; i++) drawGlass(ctx, -w / 2 + 1.0 + i * 0.35, -9.0 + i * 0.15, w - 2.4, 7.6, 0);
        break;
      }
      case 'copper': {
        for (let i = 0; i < Math.min(2, k); i++) drawSpool(ctx, -w / 4 + i * (w / 2), -3.3, 2.0);
        for (let i = 0; i < Math.max(0, k - 2); i++) bar(ctx, -w / 2 + 0.4, -5.6 - i * 0.45, w / 2 - 0.4, -5.6 - i * 0.45, 0.4, C.copper, i === 0);
        break;
      }
      case 'nails': {
        const bw = (w - 0.8) / 3;
        for (let i = 0; i < k; i++) { const bx = -w / 2 + 0.4 + (i % 3) * bw, by = -1.3 - Math.floor(i / 3) * 1.8; box(ctx, bx, by - 1.8, bw - 0.2, 1.8, 0.2, C.cardboard); line(ctx, bx + 0.3, by - 1.2, bx + bw - 0.5, by - 1.2, 0.2, C.cardboardSh); }
        break;
      }
      default: { // lumber
        for (let i = 0; i < k; i++) {
          const yy = -1.3 - i * 1.0;
          box(ctx, -w / 2 + 0.2, yy - 0.95, w - 0.4, 0.95, 0.15, i % 2 ? C.timber : C.timberHi);
          line(ctx, w / 2 - 0.3, yy - 0.9, w / 2 - 0.3, yy - 0.05, 0.3, C.timberShade);
        }
        ctx.globalAlpha = 0.8; line(ctx, -w / 4, -1.3, -w / 4, -1.3 - k * 1.0, 0.3, C.signInk); line(ctx, w / 4, -1.3, w / 4, -1.3 - k * 1.0, 0.3, C.signInk); ctx.globalAlpha = 1;
      }
    }
  }
  function cab(ctx, x, h) {
    /* a rounded cab facing +x, its rear wall at x */
    ctx.beginPath();
    ctx.moveTo(x, -2.2); ctx.lineTo(x, -h + 1.2); ctx.quadraticCurveTo(x, -h, x + 1.4, -h);
    ctx.lineTo(x + 6.2, -h); ctx.quadraticCurveTo(x + 7.6, -h + 0.2, x + 8.6, -h + 4.6);
    ctx.lineTo(x + 11.0, -h + 5.6); ctx.quadraticCurveTo(x + 12.0, -h + 6.0, x + 12.0, -h + 7.2); ctx.lineTo(x + 12.0, -2.2); ctx.closePath();
    fillOut(ctx, C.cab, 0.5);
    ctx.globalAlpha = 0.5; line(ctx, x + 1.0, -h + 0.9, x + 6.0, -h + 0.9, 0.5, C.cabHi); ctx.globalAlpha = 1;
    /* window with the driver */
    ctx.beginPath(); ctx.moveTo(x + 2.4, -h + 1.4); ctx.lineTo(x + 6.0, -h + 1.4); ctx.quadraticCurveTo(x + 6.9, -h + 1.6, x + 7.6, -h + 4.6); ctx.lineTo(x + 2.4, -h + 4.6); ctx.closePath();
    fillOut(ctx, C.glassDark, 0.35);
    disc(ctx, x + 4.6, -h + 3.8, 1.0, C.driverSkin, false);
    ctx.beginPath(); ctx.ellipse(x + 4.6, -h + 3.3, 1.1, 1.0, 0, Math.PI, TAU); ctx.closePath(); ctx.fillStyle = C.crane; ctx.fill();
    ctx.globalAlpha = 0.5; line(ctx, x + 6.0, -h + 1.8, x + 6.8, -h + 3.9, 0.4, C.glassHi); ctx.globalAlpha = 1;
    /* door seam, handle, mirror */
    line(ctx, x + 1.6, -h + 5.2, x + 1.6, -2.6, 0.2, C.cabSh);
    line(ctx, x + 2.4, -h + 6.0, x + 3.4, -h + 6.0, 0.35, C.chrome);
    bar(ctx, x + 8.0, -h + 2.2, x + 8.6, -h + 2.6, 0.5, C.tool);
    /* bumper, grille, headlight */
    box(ctx, x + 10.6, -3.4, 1.8, 1.4, 0.4, C.chrome);
    line(ctx, x + 11.6, -h + 7.6, x + 11.6, -3.8, 0.8, C.cabSh);
    const night = K.light.night;
    disc(ctx, x + 11.4, -h + 6.6, 0.55, night > 0.3 ? EMIT.lamp : C.chrome);
    if (night > 0.3) K.lights.push({ x: wx(x + 13.5), y: wy(-h + 6.8), r: 12, a: 0.5 });
  }
  const PALLET_KINDS = { brick: 1, lumber: 1, glass: 1, copper: 1, nails: 1 };
  const PR = {
    pallet(ctx, o) { const w = 9; groundShadow(ctx, 5); palletLoad(ctx, o.kind || 'lumber', o.n, w); palletBase(ctx, w); },
    beam(ctx, o) { const len = o.len || 16; groundShadow(ctx, len / 2, 0.15); drawTimber(ctx, -len / 2, -0.7, len / 2, -0.7, 'beam'); },
    panel(ctx, o) { if (o.flat) box(ctx, -4, -1.0, 8, 1.0, 0.2, C.osb); else { groundShadow(ctx, 3.5); ctx.save(); ctx.rotate(-0.12); drawPanel(ctx, -3.6, -9.4, 7.2, 9.4); ctx.restore(); } },
    bricks(ctx, o) { groundShadow(ctx, 2.6); const n = o.n == null ? 3 : o.n; for (let i = 0; i < n; i++) box(ctx, -1.8 + (i % 2) * 0.4, -0.95 - i * 0.95, 3.2, 0.95, 0.15, i % 2 ? C.brick : C.brickHi); },
    barrow(ctx, o) { groundShadow(ctx, 4); drawBarrow(ctx, -3.2, 0, o.load || null, 0, false); },
    pane(ctx, o) { const w = o.w || 6; groundShadow(ctx, w / 2, 0.12); drawGlass(ctx, -w / 2, -8.5, w, 8.5, o.tilt || 0); },
    spool(ctx, o) { groundShadow(ctx, 2.5); const r = o.r || 2.6; drawSpool(ctx, 0, -r, r); },
    rebar(ctx, o) { const len = o.len || 14; drawTimber(ctx, -len / 2, -0.6, len / 2, -0.6, 'rebar'); },
    stakes(ctx) { groundShadow(ctx, 2.5); for (let i = 0; i < 4; i++) { bar(ctx, -2.5, -0.4 - i * 0.4, 2.5, -0.4 - i * 0.4, 0.42, C.timber, true); line(ctx, 2.2, -0.4 - i * 0.4, 2.8, -0.2 - i * 0.4, 0.4, C.frosting); } },
    bucket(ctx, o) { groundShadow(ctx, 1.4); drawBucket(ctx, 0, -2.4, o.load || 'mortar'); },
    mug(ctx, o, t) { box(ctx, -0.7, -1.7, 1.4, 1.7, 0.3, C.white); ctx.beginPath(); ctx.arc(0.8, -0.85, 0.45, -1.4, 1.4); ctx.lineWidth = 0.3; ctx.strokeStyle = C.ink; ctx.stroke(); drawSteam(ctx, 0, -2.0, t); },
    thermos(ctx) { box(ctx, -0.6, -3.2, 1.2, 3.2, 0.4, C.thermos); box(ctx, -0.65, -3.7, 1.3, 0.7, 0.25, C.steel); },
    sandwich(ctx) { ctx.beginPath(); ctx.moveTo(-1.2, 0); ctx.lineTo(1.2, 0); ctx.lineTo(0, -1.0); ctx.closePath(); fillOut(ctx, C.bread, 0.3); line(ctx, -0.9, -0.25, 0.9, -0.25, 0.25, C.lettuce); },
    clipboard(ctx) { box(ctx, -1.2, -0.5, 2.4, 0.5, 0.15, C.timberShade); box(ctx, -0.9, -0.6, 1.8, 0.2, 0.05, C.paper, false); },
    cake(ctx, o, t) { drawCake(ctx, 0, 0, t); },
    toolbox(ctx) { groundShadow(ctx, 2); box(ctx, -1.8, -2.0, 3.6, 2.0, 0.35, C.redbox); ctx.beginPath(); ctx.moveTo(-0.8, -1.9); ctx.lineTo(-0.6, -2.7); ctx.lineTo(0.6, -2.7); ctx.lineTo(0.8, -1.9); ctx.lineWidth = 0.35; ctx.strokeStyle = C.ink; ctx.stroke(); line(ctx, -1.7, -1.3, 1.7, -1.3, 0.2, C.redboxSh); },
    shovel(ctx, o) { if (o.lying) drawTool(ctx, 'shovel', -4.3, -0.4, 0); else drawTool(ctx, 'shovel', -1.6, -8.6, 1.38); },
    tarp(ctx, o, t) {
      const w = o.w || 10;
      if (!o.open) { box(ctx, -2, -1.6, 4, 1.6, 0.5, C.tarp); line(ctx, -1.6, -0.8, 1.6, -0.8, 0.25, C.tarpSh); return; }
      const h = o.h || 5, fl = Math.sin(t * 3) * 0.3;
      groundShadow(ctx, w / 2 + 0.5);
      ctx.beginPath(); ctx.moveTo(-w / 2 - 0.6, 0.1); ctx.quadraticCurveTo(-w / 2 - 0.2, -h * 0.9, -w / 4, -h); ctx.quadraticCurveTo(0, -h - 0.4 + fl * 0.3, w / 4, -h);
      ctx.quadraticCurveTo(w / 2 + 0.2, -h * 0.9, w / 2 + 0.6 + fl, 0.1); ctx.closePath(); fillOut(ctx, C.tarp);
      ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(-w / 4, -h + 0.4); ctx.quadraticCurveTo(-w / 3, -h / 2, -w / 4 - 0.4, -0.3); ctx.moveTo(w / 6, -h + 0.3); ctx.quadraticCurveTo(w / 5, -h / 2, w / 6 + 0.5, -0.2);
      ctx.lineWidth = 0.3; ctx.strokeStyle = C.tarpSh; ctx.stroke(); ctx.globalAlpha = 0.6; line(ctx, -w / 3, -h + 0.5, -w / 8, -h + 0.2, 0.5, C.tarpHi); ctx.globalAlpha = 1;
      line(ctx, -w / 2 - 0.4, -0.4, -w / 2 - 1.6, 0.1, 0.2, C.ink); line(ctx, w / 2 + 0.6 + fl, -0.4, w / 2 + 1.8, 0.1, 0.2, C.ink);
    },
    flag(ctx, o, t) { const h = o.h || 10; line(ctx, 0, 0, 0, -h, 0.35, C.steel); drawFlagCloth(ctx, 0, -h, 3.8, 2.4, t); },
    plant(ctx, o) {
      const g = clamp(o.growth == null ? 1 : o.growth, 0, 1);
      if (g < 0.15) { line(ctx, 0, 0, 0, -1.2, 0.25, C.grassDark); oval(ctx, -0.5, -1.2, 0.5, 0.28, C.lettuce, false, -0.4); oval(ctx, 0.5, -1.3, 0.5, 0.28, C.lettuce, false, 0.4); return; }
      groundShadow(ctx, 1 + g * 2); if (g > 0.4 && !o.pot) line(ctx, -0.9, 0, -0.9, -3.5, 0.25, C.timber); drawPlant(ctx, 0, 0, g, !!o.pot);
    },
    cone(ctx) { groundShadow(ctx, 1.4); box(ctx, -1.4, -0.45, 2.8, 0.45, 0.15, C.cone); ctx.beginPath(); ctx.moveTo(-1.0, -0.4); ctx.lineTo(-0.25, -3.6); ctx.lineTo(0.25, -3.6); ctx.lineTo(1.0, -0.4); ctx.closePath(); fillOut(ctx, C.cone, 0.35); line(ctx, -0.6, -1.8, 0.6, -1.8, 0.5, C.white); },
    truck(ctx, o, t) {
      const spin = o.wheelT || 0;
      groundShadow(ctx, 18, 0.22);
      ctx.translate(-19, 0);
      box(ctx, 1.0, -4.0, 28, 1.6, 0.3, C.tool);
      box(ctx, 0.5, -6.0, 23.5, 2.2, 0.4, C.steel);
      ctx.globalAlpha = 0.6; line(ctx, 1.0, -5.4, 23.5, -5.4, 0.3, C.steelHi); ctx.globalAlpha = 1;
      bar(ctx, 22.8, -6, 22.8, -11.2, 0.6, C.steelSh);   // headache rack
      if (o.load && PALLET_KINDS[o.load]) { ctx.save(); ctx.translate(11.5, -6.0); palletLoad(ctx, o.load, o.n == null ? 4 : o.n, 16); palletBase(ctx, 16); ctx.restore(); }
      cab(ctx, 24.0, 13.5);
      bar(ctx, 23.6, -9.0, 23.6, -15.2, 0.6, C.chrome);   // exhaust
      wheel(ctx, 6.0, -2.4, 2.4, spin); wheel(ctx, 11.0, -2.4, 2.4, spin); wheel(ctx, 31.0, -2.4, 2.4, spin);
      box(ctx, 0.0, -5.2, 0.8, 1.2, 0.2, C.flag);
      if (o.reverse) { disc(ctx, 0.4, -3.2, 0.45, EMIT.lamp); K.lights.push({ x: wx(-19.5), y: wy(-3), r: 7, a: 0.6, color: '#fff3d6' }); }
      const beacon = o.reverse && Math.sin(t * 9) > 0;
      box(ctx, 27.2, -14.6, 1.4, 0.8, 0.3, beacon ? '#ffb02e' : C.fork);
      if (beacon) K.lights.push({ x: wx(9), y: wy(-14), r: 6, a: 0.5, color: '#ffae3a' });
    },
    mixerTruck(ctx, o, t) {
      const spin = o.wheelT || 0;
      groundShadow(ctx, 18, 0.22);
      ctx.translate(-19, 0);
      box(ctx, 1.0, -4.0, 28, 1.6, 0.3, C.tool);
      /* the drum: a tilted barrel, turning */
      const drumPath = () => { ctx.beginPath(); ctx.moveTo(2.2, -9.0); ctx.quadraticCurveTo(3.0, -14.6, 9.0, -15.0); ctx.lineTo(16.0, -14.6); ctx.quadraticCurveTo(22.6, -13.0, 22.4, -9.0);
        ctx.quadraticCurveTo(21.0, -5.4, 16.0, -5.0); ctx.lineTo(8.0, -5.0); ctx.quadraticCurveTo(2.0, -5.4, 2.2, -9.0); ctx.closePath(); };
      ctx.save(); drumPath();
      ctx.fillStyle = C.drum; ctx.fill(); ctx.clip();
      const ph = ((t * 0.9) % 1) * 4.4;
      ctx.beginPath(); for (let i = -2; i < 6; i++) { const xx = 1 + i * 4.4 + ph; ctx.moveTo(xx, -16); ctx.lineTo(xx + 3.6, -4); ctx.lineTo(xx + 5.2, -4); ctx.lineTo(xx + 1.6, -16); ctx.closePath(); }
      ctx.fillStyle = C.drumStripe; ctx.fill();
      ctx.globalAlpha = 0.35; ctx.fillStyle = C.drumSh; ctx.fillRect(0, -8.0, 24, 4); ctx.globalAlpha = 0.5; ctx.fillStyle = C.drumHi; ctx.fillRect(0, -14.6, 24, 1.6); ctx.globalAlpha = 1;
      ctx.restore();
      drumPath(); ctx.lineWidth = 0.5; ctx.strokeStyle = C.ink; ctx.stroke();
      bar(ctx, 21.0, -5.0, 22.6, -9.8, 0.8, C.steel);
      bar(ctx, 4.0, -5.0, 3.0, -8.0, 0.8, C.steel);
      ctx.beginPath(); ctx.moveTo(2.4, -9.6); ctx.quadraticCurveTo(-0.6, -9.6, -1.4, -6.2); ctx.lineWidth = 1.1 + OUT * 2; ctx.strokeStyle = C.ink; ctx.stroke(); ctx.lineWidth = 1.1; ctx.strokeStyle = C.steel; ctx.stroke();
      cab(ctx, 24.0, 13.5);
      wheel(ctx, 6.0, -2.4, 2.4, spin); wheel(ctx, 11.0, -2.4, 2.4, spin); wheel(ctx, 31.0, -2.4, 2.4, spin);
      box(ctx, 0.6, -5.4, 0.8, 1.2, 0.2, C.flag);
      if (o.reverse) { disc(ctx, 0.9, -3.3, 0.45, EMIT.lamp); K.lights.push({ x: wx(-19), y: wy(-3), r: 7, a: 0.6, color: '#fff3d6' }); }
    },
    forklift(ctx, o, t) {
      const lift = clamp(o.lift || 0, 0, 1), spin = o.wheelT || 0;
      groundShadow(ctx, 8, 0.22);
      bar(ctx, 6.2, -1.5, 6.2, -14.0, 0.7, C.tool); bar(ctx, 7.0, -1.5, 7.0, -14.0, 0.7, C.tool);
      const fy = -1.0 - lift * 9.5;
      bar(ctx, 7.4, fy, 7.4, fy - 3.2, 0.5, C.steelSh);
      bar(ctx, 7.4, fy, 12.0, fy, 0.45, C.steelSh);
      if (o.load && PALLET_KINDS[o.load]) { ctx.save(); ctx.translate(10.6, fy - 0.2); ctx.scale(0.8, 0.8); palletLoad(ctx, o.load, o.n == null ? 2 : o.n, 8); palletBase(ctx, 8); ctx.restore(); }
      ctx.beginPath(); ctx.moveTo(-5.4, -2.0); ctx.lineTo(-5.4, -5.4); ctx.quadraticCurveTo(-5.4, -7.2, -3.6, -7.2); ctx.lineTo(1.2, -7.2); ctx.lineTo(2.4, -5.0); ctx.lineTo(5.8, -5.0); ctx.lineTo(5.8, -2.0); ctx.closePath();
      fillOut(ctx, C.fork, 0.45);
      ctx.globalAlpha = 0.5; line(ctx, -4.6, -6.5, 0.6, -6.5, 0.45, C.forkHi); ctx.globalAlpha = 1;
      box(ctx, -6.0, -6.6, 1.6, 4.8, 0.6, C.tool);   // counterweight
      /* the driver */
      box(ctx, -2.4, -9.2, 2.2, 2.4, 0.5, C.driverVest);
      disc(ctx, -1.2, -10.8, 1.2, C.driverSkin);
      ctx.beginPath(); ctx.ellipse(-1.15, -11.3, 1.35, 1.2, 0, Math.PI, TAU); ctx.closePath(); fillOut(ctx, C.crane, 0.35);
      bar(ctx, 0.0, -8.6, 2.8, -7.2, 0.45, C.shirt);
      /* the overhead guard */
      ctx.beginPath(); ctx.moveTo(-4.2, -7.2); ctx.lineTo(-4.2, -13.2); ctx.lineTo(3.6, -13.2); ctx.lineTo(4.6, -5.0);
      ctx.lineWidth = 0.55 + OUT * 2; ctx.strokeStyle = C.ink; ctx.stroke(); ctx.lineWidth = 0.55; ctx.strokeStyle = C.tool; ctx.stroke();
      wheel(ctx, 3.6, -1.9, 1.9, spin); wheel(ctx, -3.6, -1.6, 1.6, spin);
      const blink = Math.sin(t * 6) > 0.3;
      disc(ctx, -0.4, -13.8, 0.45, blink ? '#ffb02e' : C.fork);
      if (blink && K.light.night > 0.3) K.lights.push({ x: wx(-0.4), y: wy(-13.8), r: 5, a: 0.5, color: '#ffae3a' });
    },
    dog(ctx, o, t) {
      const pose = o.pose || 'walk';
      groundShadow(ctx, 3, 0.18);
      const D = C.dog, Dd = C.dogDark, Dl = C.dogLight;
      if (pose === 'sleep') {
        const b = Math.sin(t * 1.6) * 0.12;
        ctx.beginPath(); ctx.ellipse(0, -1.4 - b, 3.0, 1.5 + b, 0, 0, TAU); fillOut(ctx, D);
        ctx.beginPath(); ctx.moveTo(-2.6, -0.6); ctx.quadraticCurveTo(-3.6, -0.2, -2.0, 0.0); ctx.lineWidth = 0.7; ctx.strokeStyle = Dd; ctx.stroke();
        disc(ctx, 2.2, -1.0, 1.2, D); oval(ctx, 3.2, -0.7, 0.8, 0.5, Dl);
        disc(ctx, 3.9, -0.8, 0.22, C.ink, false);
        oval(ctx, 1.7, -1.3, 0.7, 0.4, Dd, false, 0.6);
        line(ctx, 2.2, -1.1, 2.7, -1.0, 0.18, C.ink);
        if (o.bandana) { ctx.beginPath(); ctx.moveTo(1.2, -1.9); ctx.lineTo(1.3, -0.4); ctx.lineTo(0.6, -1.0); ctx.closePath(); fillOut(ctx, C.bandana, 0.25); }
        return;
      }
      const sit = pose === 'sit';
      const ph = pose === 'walk' ? (t / 0.45) % 1 : 0;
      const wag = pose === 'wag' ? Math.sin(t * 22) : Math.sin(t * 5) * 0.4;
      const bob = pose === 'walk' ? Math.abs(Math.sin(ph * TAU)) * 0.25 : 0;
      const leg = (x0, ofs, near) => { const a = pose === 'walk' ? Math.sin((ph + ofs) * TAU) * 0.8 : 0; bar(ctx, x0, -2.0 - bob, x0 + a, -0.3, 0.75, near ? D : Dd); };
      if (sit) {
        ctx.beginPath(); ctx.ellipse(-0.8, -2.2, 2.0, 1.9, -0.6, 0, TAU); fillOut(ctx, D);
        bar(ctx, 1.0, -2.5, 1.1, -0.3, 0.75, Dd); bar(ctx, 1.6, -2.5, 1.7, -0.3, 0.75, D);
        oval(ctx, -1.6, -0.6, 1.3, 0.6, D);
      } else {
        leg(-1.8, 0.5, false); leg(1.6, 0, false);
        ctx.beginPath(); ctx.ellipse(0, -2.7 - bob, 3.0, 1.5, 0, 0, TAU); fillOut(ctx, D);
        ctx.globalAlpha = 0.6; oval(ctx, -0.4, -3.4 - bob, 1.8, 0.45, Dl, false); ctx.globalAlpha = 1;
        leg(-1.3, 0, true); leg(2.1, 0.5, true);
      }
      /* tail */
      const tx0 = sit ? -2.4 : -2.8, ty0 = sit ? -1.0 : -3.2 - bob;
      ctx.beginPath(); ctx.moveTo(tx0, ty0); ctx.quadraticCurveTo(tx0 - 1.0, ty0 - 1.2 - wag * 0.2, tx0 - 0.6 + wag * 0.7, ty0 - 2.2);
      ctx.lineWidth = 0.7 + OUT * 2; ctx.strokeStyle = C.ink; ctx.stroke(); ctx.lineWidth = 0.7; ctx.strokeStyle = D; ctx.stroke();
      /* head */
      const hx = sit ? 1.0 : 2.8, hy = sit ? -5.0 : -4.4 - bob;
      disc(ctx, hx, hy, 1.45, D);
      oval(ctx, hx + 1.3, hy + 0.45, 0.95, 0.65, Dl);
      disc(ctx, hx + 2.15, hy + 0.25, 0.32, C.ink, false);
      disc(ctx, hx + 0.55, hy - 0.3, 0.24, C.ink, false);
      ctx.globalAlpha = 0.9; disc(ctx, hx + 0.48, hy - 0.37, 0.08, C.white, false); ctx.globalAlpha = 1;
      const ear = pose === 'walk' ? Math.sin(ph * TAU) * 0.15 : 0;
      ctx.beginPath(); ctx.ellipse(hx - 0.6, hy + 0.1, 0.55, 1.05, 0.35 + ear, 0, TAU); fillOut(ctx, Dd, 0.3);
      if (pose === 'wag' || sit) { ctx.beginPath(); ctx.ellipse(hx + 1.6, hy + 1.05, 0.28, 0.4, 0, 0, TAU); ctx.fillStyle = C.frosting; ctx.fill(); }
      if (o.bandana) { ctx.beginPath(); ctx.moveTo(hx - 1.1, hy + 0.9); ctx.lineTo(hx + 0.7, hy + 1.3); ctx.lineTo(hx - 0.4, hy + 2.3); ctx.closePath(); fillOut(ctx, C.bandana, 0.25); }
    },
    doghouse(ctx) {
      groundShadow(ctx, 4);
      ctx.beginPath(); ctx.moveTo(-3.2, 0); ctx.lineTo(-3.2, -4.4); ctx.lineTo(3.2, -4.4); ctx.lineTo(3.2, 0); ctx.closePath(); fillOut(ctx, C.timber);
      ctx.globalAlpha = 0.5; ctx.beginPath(); for (let i = 1; i < 4; i++) { ctx.moveTo(-3.0, -i * 1.1); ctx.lineTo(3.0, -i * 1.1); } ctx.lineWidth = 0.2; ctx.strokeStyle = C.timberShade; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.moveTo(-1.3, 0); ctx.lineTo(-1.3, -2.0); ctx.arc(0, -2.0, 1.3, Math.PI, TAU); ctx.lineTo(1.3, 0); ctx.closePath(); fillOut(ctx, C.interior, 0.35);
      ctx.beginPath(); ctx.moveTo(-4.2, -4.0); ctx.lineTo(0, -7.6); ctx.lineTo(4.2, -4.0); ctx.lineTo(3.6, -3.6); ctx.lineTo(0, -6.7); ctx.lineTo(-3.6, -3.6); ctx.closePath(); fillOut(ctx, C.truck);
      if (K.light.snowy) { ctx.beginPath(); ctx.moveTo(-4.0, -4.3); ctx.lineTo(0, -7.7); ctx.lineTo(4.0, -4.3); ctx.lineTo(3.0, -4.6); ctx.lineTo(0, -7.0); ctx.lineTo(-3.0, -4.6); ctx.closePath(); ctx.fillStyle = C.snow; ctx.fill(); }
    },
    snowman(ctx, o, t) {
      groundShadow(ctx, 3.2);
      const ball = (y, r) => { disc(ctx, 0, y, r, C.snowShade); disc(ctx, -r * 0.12, y - r * 0.12, r * 0.86, C.snow, false); };
      ball(-2.9, 3.0); ball(-7.3, 2.2); ball(-10.8, 1.6);
      bar(ctx, 1.8, -7.6, 4.6, -9.4, 0.3, C.trunk); bar(ctx, -1.8, -7.6, -4.4, -8.6, 0.3, C.trunk); line(ctx, 4.0, -9.0, 4.6, -8.4, 0.25, C.trunk);
      disc(ctx, -0.55, -11.1, 0.22, C.coal, false); disc(ctx, 0.55, -11.1, 0.22, C.coal, false);
      ctx.beginPath(); ctx.moveTo(0, -10.7); ctx.lineTo(1.9, -10.4); ctx.lineTo(0, -10.2); ctx.closePath(); ctx.fillStyle = C.carrot; ctx.fill();
      for (let i = 0; i < 3; i++) disc(ctx, 0, -5.2 - i * 0.9, 0.2, C.coal, false);
      bar(ctx, -1.5, -9.3, 1.5, -9.3, 0.8, C.flag); bar(ctx, 1.0, -9.2, 1.4 + Math.sin(t * 2) * 0.2, -7.4, 0.7, C.flag);
      /* a hard hat, of course */
      ctx.beginPath(); ctx.ellipse(0, -12.0, 1.8, 1.7, 0, Math.PI, TAU); ctx.closePath(); fillOut(ctx, C.crane);
      box(ctx, -2.1, -12.2, 4.2, 0.55, 0.27, C.crane);
      ctx.globalAlpha = 0.8; oval(ctx, -0.8, -13.1, 0.35, 0.2, C.white, false, -0.6); ctx.globalAlpha = 1;
    },
    sawhorse(ctx, o) {
      groundShadow(ctx, 3.6);
      for (const x of [-2.6, 2.6]) { bar(ctx, x - 1.0, 0, x, -4.2, 0.45, C.timberShade); bar(ctx, x + 1.0, 0, x, -4.2, 0.45, C.timber); }
      box(ctx, -3.8, -4.8, 7.6, 0.8, 0.2, C.timber);
      if (o.board) drawTimber(ctx, -6, -5.4, 6, -5.4, 'beam');
    },
    mixer(ctx, o, t) {
      groundShadow(ctx, 3.6);
      bar(ctx, -4.8, -1.8, -1.0, -2.6, 0.5, C.steel);
      bar(ctx, -0.6, -2.4, 2.6, -2.4, 0.6, C.steel);
      wheel(ctx, 0.8, -1.5, 1.5, 0);
      ctx.save(); ctx.translate(0.6, -5.4); ctx.rotate(-0.35);
      ctx.beginPath(); ctx.moveTo(-2.6, -1.4); ctx.lineTo(2.6, -1.4); ctx.quadraticCurveTo(2.9, 2.6, 0, 2.8); ctx.quadraticCurveTo(-2.9, 2.6, -2.6, -1.4); ctx.closePath(); fillOut(ctx, C.bucket);
      ctx.beginPath(); ctx.ellipse(0, -1.4, 2.6, 0.7, 0, 0, TAU); fillOut(ctx, C.mortarMix, 0.35);
      const a = t * 4;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * 1.9, -1.4 + Math.sin(a) * 0.45); ctx.lineTo(-Math.cos(a) * 1.9, -1.4 - Math.sin(a) * 0.45); ctx.lineWidth = 0.35; ctx.strokeStyle = C.steelSh; ctx.stroke();
      ctx.globalAlpha = 0.5; line(ctx, -1.8, -0.4, -1.2, 1.6, 0.4, C.bucketHi); ctx.globalAlpha = 1;
      ctx.restore();
    },
    hook(ctx, o, t) {
      /* (0,0) is where the cable meets the block; everything hangs below */
      box(ctx, -1.3, 0, 2.6, 2.4, 0.6, C.crane);
      disc(ctx, 0, 1.0, 0.55, C.craneDark, false);
      ctx.beginPath(); ctx.moveTo(0, 2.4); ctx.lineTo(0, 3.6); ctx.arc(-0.7, 3.6, 0.7, 0, Math.PI * 0.85);
      ctx.lineWidth = 0.5 + OUT * 2; ctx.strokeStyle = C.ink; ctx.stroke(); ctx.lineWidth = 0.5; ctx.strokeStyle = C.steel; ctx.stroke();
      if (!o.load) return;
      ctx.rotate(Math.sin(t * 0.9) * 0.05);
      const ly = 7.5;
      ctx.beginPath(); ctx.moveTo(0, 3.6); ctx.lineTo(-5.0, ly); ctx.moveTo(0, 3.6); ctx.lineTo(5.0, ly); ctx.lineWidth = 0.22; ctx.strokeStyle = C.cable; ctx.stroke();
      switch (o.load) {
        case 'beam': drawTimber(ctx, -8, ly + 0.6, 8, ly + 0.6, 'beam'); break;
        case 'rebar': drawTimber(ctx, -8, ly + 0.4, 8, ly + 0.4, 'rebar'); break;
        case 'panel': drawPanel(ctx, -5.2, ly, 10.4, 7.0); break;
        case 'pane': drawGlass(ctx, -5.2, ly, 10.4, 6.5, 0); break;
        case 'bricks': case 'brick': ctx.translate(0, ly + 6.2); palletLoad(ctx, 'brick', 4, 10); palletBase(ctx, 10); break;
        default: ctx.translate(0, ly + 6.2); palletLoad(ctx, o.load, 3, 10); palletBase(ctx, 10);
      }
    },
    stake(ctx, o, t) {
      bar(ctx, 0, 0.3, 0, -4.0, 0.45, C.timber);
      ctx.beginPath(); ctx.moveTo(0.1, -3.8); ctx.quadraticCurveTo(1.0, -3.6 + Math.sin(t * 5) * 0.4, 1.8, -3.2 + Math.sin(t * 5 + 1) * 0.5);
      ctx.lineWidth = 0.4; ctx.strokeStyle = C.frosting; ctx.stroke();
    },
    lamp(ctx, o) {
      groundShadow(ctx, 3);
      const on = o.on != null ? !!o.on : K.light.night > 0.3;
      box(ctx, -2.6, -2.4, 5.2, 1.6, 0.4, C.fork);
      wheel(ctx, -1.4, -0.9, 0.9, 0); wheel(ctx, 1.4, -0.9, 0.9, 0);
      bar(ctx, 0, -2.4, 0, -17.5, 0.5, C.steel);
      bar(ctx, -2.6, -17.6, 2.6, -17.6, 0.4, C.steelSh);
      box(ctx, -2.0, -19.0, 1.6, 1.3, 0.3, on ? EMIT.lamp : C.chrome); box(ctx, 0.4, -19.0, 1.6, 1.3, 0.3, on ? EMIT.lamp : C.chrome);
      if (on) K.lights.push({ x: wx(0), y: wy(-14), r: 34, a: 0.42 });
    },
  };

  /* ============================================================ emotes */
  function outBack(k) { const c1 = 2.2, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); }
  function emote(ctx, x, y, icon, t = 1) {
    const pop = t < 0.22 ? outBack(t / 0.22) : 1;
    if (pop <= 0.01) return;
    ctx.save(); ctx.translate(x, y - 3.4 + Math.sin(t * 2.2) * 0.3); ctx.scale(pop, pop);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const bub = K.light.night > 0.4 ? '#e9e6dc' : '#fffdf6';
    ctx.beginPath(); rr(ctx, -3.3, -3.0, 6.6, 5.6, 2.4);
    ctx.moveTo(-0.9, 2.5); ctx.lineTo(0, 3.9); ctx.lineTo(0.9, 2.5);
    ctx.fillStyle = bub; ctx.fill(); ctx.lineWidth = 0.4; ctx.strokeStyle = C.ink; ctx.stroke();
    ctx.fillStyle = bub; ctx.fillRect(-0.85, 2.0, 1.7, 0.6);
    drawIcon(ctx, icon, t);
    ctx.restore();
  }
  function star(ctx, x, y, R1, R2, rot) { ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = rot - Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R2 : R1; if (i) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); }
  function drawIcon(ctx, icon, t) {
    switch (icon) {
      case 'heart': { const b = 1 + Math.max(0, Math.sin(t * 6)) * 0.08; ctx.save(); ctx.scale(b, b); ctx.beginPath(); ctx.moveTo(0, 1.6); ctx.bezierCurveTo(-3.0, -0.4, -1.6, -2.6, 0, -1.0); ctx.bezierCurveTo(1.6, -2.6, 3.0, -0.4, 0, 1.6); ctx.fillStyle = '#e8506a'; ctx.fill(); ctx.globalAlpha = 0.7; disc(ctx, -1.1, -0.9, 0.35, '#ffd0d8', false); ctx.restore(); break; }
      case 'note': { oval(ctx, -0.9, 1.1, 0.75, 0.55, '#4a5bd0', false, -0.3); oval(ctx, 1.3, 0.6, 0.75, 0.55, '#4a5bd0', false, -0.3); ctx.beginPath(); ctx.moveTo(-0.2, 1.0); ctx.lineTo(-0.2, -1.8); ctx.lineTo(2.0, -2.3); ctx.lineTo(2.0, 0.5); ctx.lineWidth = 0.45; ctx.strokeStyle = '#4a5bd0'; ctx.stroke(); break; }
      case 'bang': box(ctx, -0.55, -2.2, 1.1, 2.9, 0.5, '#e8503a', false); disc(ctx, 0, 1.5, 0.6, '#e8503a', false); break;
      case 'question': { ctx.beginPath(); ctx.arc(0, -0.9, 1.2, Math.PI * 1.05, Math.PI * 0.45); ctx.quadraticCurveTo(0, 0.2, 0, 0.7); ctx.lineWidth = 0.75; ctx.strokeStyle = '#3a6fd0'; ctx.stroke(); disc(ctx, 0, 1.75, 0.45, '#3a6fd0', false); break; }
      case 'dots': { for (let i = 0; i < 3; i++) { const a = Math.max(0, Math.sin(t * 5 - i * 0.8)); disc(ctx, -1.7 + i * 1.7, -a * 0.4, 0.55, a > 0.5 ? '#2b1d1a' : '#9a8f86', false); } break; }
      case 'zzz': { ctx.beginPath(); const z = (x, y, s) => { ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.lineTo(x + s, y + s); }; const k = (t * 0.8) % 1; z(-1.2, 0.8, 0.8); z(0.9, -0.6 - k * 0.3, 0.6); z(2.0, -1.8 - k * 0.3, 0.4); ctx.lineWidth = 0.4; ctx.strokeStyle = '#5a6ab0'; ctx.stroke(); break; }
      case 'star': star(ctx, 0, 0, 2.2, 0.95, Math.sin(t * 2) * 0.2); ctx.fillStyle = '#f5b82e'; ctx.fill(); ctx.lineWidth = 0.3; ctx.strokeStyle = '#c98a1a'; ctx.stroke(); break;
      case 'sweat': { ctx.beginPath(); ctx.moveTo(0, -2.0); ctx.quadraticCurveTo(1.6, 0.3, 0, 1.6); ctx.quadraticCurveTo(-1.6, 0.3, 0, -2.0); ctx.fillStyle = '#6fb8ea'; ctx.fill(); ctx.globalAlpha = 0.8; disc(ctx, -0.4, 0.4, 0.3, '#e8f6ff', false); ctx.globalAlpha = 1; break; }
      case 'coffee': { box(ctx, -1.5, -0.6, 2.4, 2.3, 0.45, '#f4efe6'); ctx.beginPath(); ctx.arc(1.0, 0.5, 0.6, -1.3, 1.3); ctx.lineWidth = 0.35; ctx.strokeStyle = C.ink; ctx.stroke(); oval(ctx, -0.3, -0.5, 1.0, 0.25, '#7a4a2a', false); ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.moveTo(-0.7, -1.2); ctx.quadraticCurveTo(-0.2, -1.8, -0.7, -2.4); ctx.moveTo(0.2, -1.2); ctx.quadraticCurveTo(0.7, -1.8, 0.2, -2.4); ctx.lineWidth = 0.3; ctx.strokeStyle = '#9a8f86'; ctx.stroke(); ctx.globalAlpha = 1; break; }
      case 'idea': { ctx.globalAlpha = 0.6 + Math.max(0, Math.sin(t * 4)) * 0.4; ctx.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI * 0.9 + i * Math.PI * 0.2; ctx.moveTo(Math.cos(a) * 1.9, -0.5 + Math.sin(a) * 1.9); ctx.lineTo(Math.cos(a) * 2.5, -0.5 + Math.sin(a) * 2.5); } ctx.lineWidth = 0.3; ctx.strokeStyle = '#f0a020'; ctx.stroke(); ctx.globalAlpha = 1; disc(ctx, 0, -0.5, 1.3, '#ffd84a'); box(ctx, -0.6, 0.7, 1.2, 0.9, 0.2, '#9aa3ab'); break; }
      case 'sun': { ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + t * 0.5; ctx.moveTo(Math.cos(a) * 1.5, Math.sin(a) * 1.5); ctx.lineTo(Math.cos(a) * 2.2, Math.sin(a) * 2.2); } ctx.lineWidth = 0.35; ctx.strokeStyle = '#f0a020'; ctx.stroke(); disc(ctx, 0, 0, 1.15, '#ffc93a', false); break; }
      case 'cake': box(ctx, -1.8, -0.4, 3.6, 2.0, 0.35, '#f6e2c4'); box(ctx, -1.8, -0.5, 3.6, 0.8, 0.35, '#f29bb5', false); line(ctx, 0, -0.5, 0, -1.6, 0.3, '#ffffff'); oval(ctx, 0, -2.0, 0.25, 0.42, '#ffb23a', false); break;
      default: disc(ctx, 0, 0, 1, C.ink, false);
    }
  }

  /* ============================================================ glows and lights */
  const glowCache = new Map();
  function glowSprite(color) {
    let g = glowCache.get(color);
    if (g) return g;
    g = document.createElement('canvas'); g.width = g.height = 64;
    const c = g.getContext('2d'), gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    const [r, gg, b] = hexRgb(color);
    gr.addColorStop(0, `rgba(${r},${gg},${b},1)`); gr.addColorStop(0.35, `rgba(${r},${gg},${b},0.42)`); gr.addColorStop(0.7, `rgba(${r},${gg},${b},0.1)`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
    glowCache.set(color, g);
    return g;
  }
  function glow(ctx, x, y, r, a, color = '#ffbe64') {
    if (!(a > 0.003) || !(r > 0)) return;
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  let vig = null;
  function vignette() {
    if (vig) return vig;
    vig = document.createElement('canvas'); vig.width = vig.height = 64;
    const c = vig.getContext('2d'), gr = c.createRadialGradient(32, 30, 12, 32, 32, 46);
    gr.addColorStop(0, 'rgba(6,8,22,0)'); gr.addColorStop(1, 'rgba(6,8,22,0.85)');
    c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
    return vig;
  }
  function drawLights(ctx) {
    const n = K.light.night || 0;
    if (n < 0.2) return;
    const k = clamp((n - 0.2) / 0.5, 0, 1);
    ctx.globalCompositeOperation = 'lighter';
    const ls = K.lights;
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];
      if (!l || !(l.r > 0)) continue;
      ctx.globalAlpha = Math.min(1, (l.a == null ? 0.4 : l.a) * k);
      ctx.drawImage(glowSprite(l.color || '#ffbe64'), l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    /* a gentle vignette */
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.45 * k; ctx.drawImage(vignette(), 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  /* ============================================================ sky (screen space) */
  let skyStrip = null, skyPv = -1;
  const SKY_TOP = HORIZON - 230;           // world y where the sky gradient reaches its top colour
  const CAM = [0, 0, 1, 1, 1];
  function camera() { const cp = K.camPx || K.cam; CAM[0] = cp.x; CAM[1] = cp.y; CAM[2] = K.view.z; CAM[3] = K.view.W; CAM[4] = K.view.H; return CAM; }
  function drawSky(ctx) {
    const cv = ctx.canvas, cm = camera(), cx = cm[0], cy = cm[1], z = cm[2], W = cm[3];
    if (!skyStrip) { skyStrip = document.createElement('canvas'); skyStrip.width = 1; skyStrip.height = 256; }
    if (skyPv !== pv) {
      skyPv = pv;
      const g = skyStrip.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, K.light.skyTop); gr.addColorStop(0.55, K.light.skyMid || mix(K.light.skyTop, K.light.skyHor, 0.5)); gr.addColorStop(1, K.light.skyHor);
      g.fillStyle = gr; g.fillRect(0, 0, 1, 256);
    }
    const y0 = (SKY_TOP - cy) * z, y1 = (HORIZON - cy) * z;
    ctx.fillStyle = K.light.skyTop; if (y0 > 0) ctx.fillRect(0, 0, cv.width, Math.ceil(y0));
    ctx.drawImage(skyStrip, 0, 0, 1, 256, 0, y0, cv.width, y1 - y0);
    ctx.fillStyle = K.light.skyHor; if (y1 < cv.height) ctx.fillRect(0, Math.floor(y1), cv.width, cv.height - Math.floor(y1));
    if (y1 <= 0) return;
    const L = K.light;
    ctx.save();
    /* stars (night) */
    if (L.night > 0.55 && (L.weather === 'clear' || L.weather === 'cloud')) {
      const a = clamp((L.night - 0.55) / 0.35, 0, 1) * (L.weather === 'clear' ? 1 : 0.35);
      ctx.setTransform(z, 0, 0, z, 0, -cy * z);
      ctx.fillStyle = EMIT.star;
      for (let i = 0; i < STARS.length; i += 3) {
        const sx = ((STARS[i] * (W + 60) - cx * 0.05) % (W + 60) + W + 60) % (W + 60) - 30, sy = SKY_TOP - 120 + STARS[i + 1] * (HORIZON - 50 - SKY_TOP + 120);
        ctx.globalAlpha = a * (0.55 + 0.45 * Math.sin(K.t * (0.8 + STARS[i + 2]) + i)) * (STARS[i + 2] > 0.8 ? 1 : 0.6);
        const s = STARS[i + 2] > 0.85 ? 0.75 : 0.45;
        ctx.fillRect(sx, sy, s, s);
      }
      ctx.globalAlpha = 1;
      if (L.weather === 'clear') {
        const mx = W * 0.78, my = Math.max(cy + 14, HORIZON - 95);
        glow(ctx, mx, my, 16, 0.18 * a, '#c8d4ff');
        ctx.drawImage(moonSprite(), mx - 3.5, my - 3.5, 7, 7);
      }
    }
    /* the evening sun, low over the Adirondacks (the mountains are drawn over it) */
    if (L.evening && L.alt > -3 && L.alt < 16 && L.weather !== 'fog' && L.weather !== 'rain') {
      const sx = W * L.sunX, sy = HORIZON - 9 - L.alt * 2.2;
      ctx.setTransform(z, 0, 0, z, 0, -cy * z);
      const wk = L.weather === 'clear' ? 1 : 0.4;
      glow(ctx, sx, sy, 60, 0.35 * wk, '#ffb26a');
      glow(ctx, sx, sy, 22, 0.55 * wk, '#ffd9a0');
      ctx.globalAlpha = wk; disc(ctx, sx, sy, 4.2, L.alt < 6 ? EMIT.sunLow : EMIT.sun, false); ctx.globalAlpha = 1;
    }
    drawClouds(ctx, cx, cy, z, W);
    ctx.restore();
  }
  const STARS = (() => { const r = rng(77), a = []; for (let i = 0; i < 80; i++) a.push(r(), r(), r()); return a; })();
  let moon = null, moonPv = -1;
  function moonSprite() {
    if (moon && moonPv === pv) return moon;
    moonPv = pv; moon = moon || document.createElement('canvas'); moon.width = moon.height = 48;
    const c = moon.getContext('2d'); c.clearRect(0, 0, 48, 48);
    c.fillStyle = EMIT.moon; c.beginPath(); c.arc(24, 24, 20, 0, TAU); c.fill();
    c.globalAlpha = 0.25; c.fillStyle = '#c9c4b0'; c.beginPath(); c.arc(17, 18, 4, 0, TAU); c.arc(28, 30, 3, 0, TAU); c.fill(); c.globalAlpha = 1;
    c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(33, 18, 18, 0, TAU); c.fill(); c.globalCompositeOperation = 'source-over';
    return moon;
  }

  /* clouds: a few cached puffs drifting slowly with a touch of parallax */
  const CLOUDS = (() => { const r = rng(31), a = []; for (let i = 0; i < 9; i++) a.push({ x: r() * 640, y: r(), w: 16 + r() * 22, sp: 0.25 + r() * 0.5, shape: i % 5 }); return a; })();
  let cloudSprites = [], cloudKey = '';
  function cloudSprite(i, z) {
    const k = pv + ':' + z.toFixed(2);
    if (cloudKey !== k) { cloudKey = k; cloudSprites = []; }
    if (cloudSprites[i]) return cloudSprites[i];
    const r = rng(100 + i), w = 36, h = 14, cv = document.createElement('canvas');
    cv.width = Math.ceil(w * z); cv.height = Math.ceil(h * z);
    const g = cv.getContext('2d'); g.scale(z, z);
    const L = K.light, dusk = L.evening && L.alt < 12 && L.alt > -6 ? clamp(1 - Math.abs(L.alt - 3) / 9, 0, 1) : 0;
    const body = mix(lit('#ffffff'), L.skyHor, L.weather === 'clear' ? 0.15 : 0.45);
    const under = mix(mix(body, L.skyTop, 0.35), '#f09a7a', dusk * 0.6);
    const top = mix(body, '#ffffff', 0.25 * (1 - L.night));
    const puffs = [];
    const n = 4 + Math.floor(r() * 3);
    for (let j = 0; j < n; j++) { const px = 6 + (j / (n - 1)) * 24 + (r() - 0.5) * 3, pr = 3 + r() * 3.5 * Math.sin(Math.PI * (j + 0.5) / n) + 1; puffs.push([px, h - 3 - pr * 0.6, pr]); }
    g.fillStyle = under; for (const [px, py, pr] of puffs) { g.beginPath(); g.arc(px, py + 0.8, pr, 0, TAU); g.fill(); }
    g.fillStyle = body; for (const [px, py, pr] of puffs) { g.beginPath(); g.arc(px - 0.3, py - 0.2, pr * 0.92, 0, TAU); g.fill(); }
    g.fillStyle = top; for (const [px, py, pr] of puffs) { g.beginPath(); g.arc(px - pr * 0.3, py - pr * 0.35, pr * 0.5, 0, TAU); g.fill(); }
        cloudSprites[i] = cv;
    return cv;
  }
  function drawClouds(ctx, cx, cy, z, W) {
    const w = K.light.weather;
    if (w === 'fog') return;
    const n = w === 'clear' ? 4 : 9, p = 0.2, span = 700;
    ctx.setTransform(z, 0, 0, z, 0, -cy * z);
    ctx.globalAlpha = K.light.night > 0.6 ? 0.55 : 0.95;
    for (let i = 0; i < n; i++) {
      const c = CLOUDS[i];
      const lx = ((c.x + K.t * c.sp - cx * p) % span + span) % span - 60;
      if (lx > W + 4 || lx < -50) continue;
      const big = w === 'clear' ? 1 : 1.4, cw = c.w * big, ch = cw * 14 / 36;
      ctx.drawImage(cloudSprite(c.shape, z * big), lx, HORIZON - 20 - c.y * 110 - ch, cw, ch);
    }
    ctx.globalAlpha = 1;
  }

  /* ============================================================ backdrop (world space, cached) */
  const gauss = (x, list) => { let m = 0; for (const [px, h, w] of list) { const d = x - px, v = h * Math.exp(-(d * d) / (2 * w * w)); if (v > m) m = v; } return m; };
  const FAR_PK = [[60, 16, 30], [190, 23, 34], [255, 15, 18], [380, 26, 38], [480, 17, 26], [600, 22, 34], [720, 16, 30], [840, 20, 32]];
  const MID_PK = [[30, 9, 22], [150, 12, 26], [300, 10, 22], [430, 13, 28], [540, 9, 18], [650, 11, 24], [790, 10, 26]];
  const NEAR_PK = [[95, 6, 34], [340, 7, 46], [560, 6, 32], [760, 7, 40]];
  const hFar = (x) => 8.5 + 2.2 * Math.sin(x / 53) + 1.2 * Math.sin(x / 23 + 2) + 0.4 * Math.sin(x / 7.1) + gauss(x, FAR_PK) * 0.62;
  const hMid = (x) => 4.4 + 1.4 * Math.sin(x / 31 + 1) + 0.7 * Math.sin(x / 11) + 0.3 * Math.sin(x / 4.3) + gauss(x, MID_PK) * 0.72;
  const hNear = (x) => 1.8 + 0.9 * Math.sin(x / 17 + 3) + 0.35 * Math.sin(x / 5.3) + gauss(x, NEAR_PK) * 0.7;
  function ridgeColors() {
    const L = K.light, hz = L.skyHor, f = L.haze;
    const sil = L.evening ? clamp((14 - L.alt) / 14, 0, 1) * (1 - L.night) : 0;
    return {
      far: mix(mix(lit(EXTRA.mtnFar), hz, 0.4 + f * 0.5), '#6f6a92', sil * 0.6),
      mid: mix(mix(lit(EXTRA.mtnMid), hz, 0.24 + f * 0.6), '#5a5680', sil * 0.6),
      near: mix(mix(lit(EXTRA.mtnNear), hz, 0.12 + f * 0.65), '#4a4766', sil * 0.65),
      hz,
      rim: L.night > 0.6 ? mix(hz, '#8090c0', 0.3) : sil > 0.2 ? mix('#ffc890', hz, 0.3) : mix(lit('#ffffff'), hz, 0.4),
    };
  }
  const CAP = [];
  function ridge(g, x0, x1, fn, col, haze, base, snow, capH, rim) {
    const gr = g.createLinearGradient(0, base - 34, 0, base);
    gr.addColorStop(0, col); gr.addColorStop(1, mix(col, haze, 0.38));
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(x0 - 2, base + 1);
    for (let x = x0 - 2; x <= x1 + 2; x += 1.5) g.lineTo(x, base - fn(x));
    g.lineTo(x1 + 2, base + 1); g.closePath(); g.fill();
    /* a soft rim of light along the crest */
    g.globalAlpha = 0.35; g.strokeStyle = rim; g.lineWidth = 0.5; g.lineJoin = 'round';
    g.beginPath(); for (let x = x0 - 2; x <= x1 + 2; x += 1.5) { if (x === x0 - 2) g.moveTo(x, base - fn(x) + 0.3); else g.lineTo(x, base - fn(x) + 0.3); } g.stroke();
    g.globalAlpha = 1;
    if (snow) {
      g.fillStyle = mix(lit('#f2f6fa'), col, 0.18);
      g.beginPath();
      let open = false;
      const close = () => { for (let i = CAP.length - 2; i >= 0; i -= 2) g.lineTo(CAP[i], CAP[i + 1]); g.closePath(); CAP.length = 0; open = false; };
      for (let x = x0 - 2; x <= x1 + 2; x += 1) {
        const h = fn(x), d = h - capH;
        if (d > 0) {
          const depth = Math.min(d, 1.5 + d * 0.55) * (0.7 + 0.3 * Math.sin(x * 0.45) * Math.sin(x * 0.17));
          if (!open) { g.moveTo(x, base - capH); open = true; }
          g.lineTo(x, base - h);
          CAP.push(x, base - h + depth);
        } else if (open) close();
      }
      if (open) close();
      g.fill();
    }
  }
  /* the rail-line tree belt: fixed positions so chunks agree */
  const TREES = (() => {
    const r = rng(5), a = [];
    for (let pass = 0; pass < 2; pass++) for (let x = -6 + pass * 3; x < WW + 8; x += 4.2 + r() * 3.2) {
      a.push({ x, y: GROUND_Y - 14 + pass * 4 + r() * 2, r: 3.4 + r() * 2.2 - pass * 0.6, pine: r() < 0.16, seed: Math.floor(r() * 1e6) });
    }
    return a;
  })();
  function drawTree(g, tr, winter, snowy) {
    const { x, y, r } = tr;
    if (tr.pine || (winter && tr.seed % 3 === 0)) {
      const h = r * 2.6;
      g.fillStyle = C.trunk; g.fillRect(x - 0.3, y - 0.5, 0.6, 2.5);
      for (let k = 0; k < 3; k++) {
        const ty = y - h + k * h * 0.28, hw = r * (0.45 + k * 0.28);
        g.beginPath(); g.moveTo(x, ty - h * 0.12); g.lineTo(x + hw, ty + h * 0.36); g.lineTo(x - hw, ty + h * 0.36); g.closePath();
        g.fillStyle = k % 2 ? C.pine : C.pineLight; g.fill();
        if (snowy) { g.beginPath(); g.moveTo(x, ty - h * 0.12); g.lineTo(x + hw * 0.5, ty + h * 0.12); g.lineTo(x - hw * 0.55, ty + h * 0.14); g.closePath(); g.fillStyle = C.snow; g.fill(); }
      }
      return;
    }
    if (winter) {
      /* a bare maple */
      g.strokeStyle = C.bare; g.lineCap = 'round';
      g.lineWidth = 0.7; g.beginPath(); g.moveTo(x, y + 2); g.lineTo(x, y - r * 0.9); g.stroke();
      g.lineWidth = 0.4; g.beginPath();
      for (let k = 0; k < 4; k++) { const a = -Math.PI / 2 + (k - 1.5) * 0.45, by = y - r * 0.2 - k * 0.4; g.moveTo(x, by); g.lineTo(x + Math.cos(a) * r, by + Math.sin(a) * r); }
      g.stroke();
      g.globalAlpha = 0.35; g.fillStyle = C.bare; g.beginPath(); g.arc(x, y - r * 0.5, r * 0.85, 0, TAU); g.fill(); g.globalAlpha = 1;
      if (snowy) { g.fillStyle = C.snow; g.fillRect(x - r * 0.6, y - r * 0.9, r * 0.5, 0.35); g.fillRect(x + 0.2, y - r * 1.0, r * 0.5, 0.35); }
      return;
    }
    const c = treeTone(tr.seed);
    g.fillStyle = C.trunk; g.fillRect(x - 0.35, y, 0.7, 2.5);
    g.fillStyle = c.sh; g.beginPath(); g.arc(x + 0.5, y + 0.4, r, 0, TAU); g.moveTo(x - r * 0.55 + r * 0.7, y + 0.7); g.arc(x - r * 0.55, y + 0.7, r * 0.7, 0, TAU); g.fill();
    g.fillStyle = c.c; g.beginPath(); g.arc(x, y - 0.1, r * 0.92, 0, TAU); g.moveTo(x - r * 0.6 + r * 0.62, y + 0.4); g.arc(x - r * 0.6, y + 0.4, r * 0.62, 0, TAU); g.moveTo(x + r * 0.55 + r * 0.55, y + 0.5); g.arc(x + r * 0.55, y + 0.5, r * 0.55, 0, TAU); g.fill();
    g.fillStyle = c.hi; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.38, r * 0.42, 0, TAU); g.fill();
  }
  function drawBackdrop(ctx) {
    const L = K.light, rc = ridgeColors(), m = L.month, wintery = m >= 10 || m <= 3;
    const sn = season(), sver = sn.length * 7 + (L.snowy ? 1 : 0);
    /* the Adirondacks: high peaks far off (snowcapped in the cold months), then the middle ridges, then the near shore hills */
    K.blit('art:far', 0, HORIZON - 46, WW, 48, (g, x0, x1) => ridge(g, x0, x1, hFar, rc.far, rc.hz, HORIZON, L.snowy || wintery, 16, rc.rim), { p: 0.18, ver: sver });
    K.blit('art:mid', 0, HORIZON - 28, WW, 30, (g, x0, x1) => ridge(g, x0, x1, hMid, rc.mid, rc.hz, HORIZON, L.snowy, 9, rc.rim), { p: 0.3, ver: sver });
    K.blit('art:near', 0, HORIZON - 11, WW, 13, (g, x0, x1) => {
      ridge(g, x0, x1, hNear, rc.near, rc.hz, HORIZON, false, 0, rc.rim);
      /* the far shore: a thin dark tree line at the water */
      g.fillStyle = mix(rc.near, '#1e2a26', 0.3);
      g.beginPath(); g.moveTo(x0 - 2, HORIZON + 0.6);
      for (let x = x0 - 2; x <= x1 + 2; x += 1) g.lineTo(x, HORIZON - 0.6 - 0.5 * Math.abs(Math.sin(x * 0.9)) - 0.4 * Math.abs(Math.sin(x * 2.3)));
      g.lineTo(x1 + 2, HORIZON + 0.6); g.closePath(); g.fill();
    }, { p: 0.45, ver: sver });
    /* Lake Champlain */
    const lakeBot = GROUND_Y - 16;
    K.blit('art:lake', 0, HORIZON, WW, lakeBot - HORIZON, (g, x0, x1) => {
      const lc = mix(lit(EXTRA.lake), L.skyHor, 0.35 + L.haze * 0.35), ld = mix(lit(EXTRA.lakeDeep), L.skyTop, 0.2 + L.haze * 0.3);
      const gr = g.createLinearGradient(0, HORIZON, 0, lakeBot);
      gr.addColorStop(0, mix(lc, L.skyHor, 0.35)); gr.addColorStop(0.35, lc); gr.addColorStop(1, ld);
      g.fillStyle = gr; g.fillRect(x0, HORIZON, x1 - x0, lakeBot - HORIZON);
      /* a light band at the far shore and a few wind lines */
      g.fillStyle = mix(lc, '#ffffff', 0.35 * (1 - L.night)); g.globalAlpha = 0.7; g.fillRect(x0, HORIZON + 1.2, x1 - x0, 0.7);
      g.globalAlpha = 0.25; g.fillRect(x0, HORIZON + 4.5, x1 - x0, 0.4);
      const r = rng(Math.floor(x0) + 9);
      g.globalAlpha = 0.3; g.fillStyle = mix(lc, '#ffffff', 0.3);
      for (let i = 0; i < (x1 - x0) / 9; i++) { const yy = HORIZON + 3 + r() * (lakeBot - HORIZON - 6); g.fillRect(x0 + r() * (x1 - x0), yy, 3 + r() * 9, 0.3); }
      g.globalAlpha = 1;
      if (L.snowy) { g.fillStyle = mix(C.ice, lc, 0.3); g.fillRect(x0, lakeBot - 2.5, x1 - x0, 2.5); }
    }, { p: 1, ver: sver });
    if (!K.reduced) drawShimmer(ctx, lakeBot);
    /* the tree belt along the rail line */
    K.blit('art:trees', 0, GROUND_Y - 30, WW, 30, (g, x0, x1) => {
      g.fillStyle = mix(C.treeDark, '#202820', 0.25);
      g.fillRect(x0, GROUND_Y - 12, x1 - x0, 12);
      for (const tr of TREES) if (tr.x > x0 - 8 && tr.x < x1 + 8) drawTree(g, tr, sn === 'winter', L.snowy);
    }, { p: 0.9, ver: sver + 100 });
  }
  function drawShimmer(ctx, lakeBot) {
    const cm = camera(), cx = cm[0], W = cm[3], L = K.light, t = K.t;
    ctx.fillStyle = mix(lit('#ffffff'), L.skyHor, 0.3);
    for (let i = 0; i < 26; i++) {
      const r1 = (i * 0.618) % 1, r2 = (i * 0.377 + 0.13) % 1;
      const a = Math.sin(t * (0.7 + r2) + i * 2.1);
      if (a < 0.4) continue;
      ctx.globalAlpha = (a - 0.4) * 0.55 * (1 - L.night * 0.7);
      ctx.fillRect(cx + ((r1 * W + t * 0.6 * (r2 - 0.5)) % W + W) % W, HORIZON + 3 + r2 * (lakeBot - HORIZON - 8), 1.6 + r2 * 2.2, 0.35);
    }
    /* sun glitter under the evening sun, a moon path at night */
    let gx = null, amt = 0;
    if (L.evening && L.alt > -2 && L.alt < 16 && L.weather === 'clear') { gx = cx + W * L.sunX; ctx.fillStyle = EMIT.sunLow; amt = 0.85; }
    else if (L.night > 0.7 && L.weather === 'clear') { gx = cx + W * 0.78; ctx.fillStyle = '#dfe6ff'; amt = 0.5; }
    if (gx != null) {
      for (let i = 0; i < 22; i++) {
        const r2 = (i * 0.377 + 0.31) % 1, r1 = (i * 0.618 + 0.2) % 1;
        const a = Math.sin(t * (1.2 + r2 * 1.5) + i * 1.7);
        if (a < 0.1) continue;
        const y = HORIZON + 1.5 + r2 * r2 * (lakeBot - HORIZON - 4), spread = 2 + (y - HORIZON) * 0.35;
        ctx.globalAlpha = a * amt * (1 - r2 * 0.5);
        ctx.fillRect(gx + (r1 - 0.5) * spread * 2, y, 1.2 + (1 - r2) * 2.6, 0.4);
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ============================================================ weather (world space) */
  const NR = 120, rainX = new Float32Array(NR), rainY = new Float32Array(NR), rainS = new Float32Array(NR);
  const NS = 110, snX = new Float32Array(NS), snY = new Float32Array(NS), snS = new Float32Array(NS), snP = new Float32Array(NS);
  const NSP = 16, spX = new Float32Array(NSP), spY = new Float32Array(NSP), spA = new Float32Array(NSP);
  { const r = rng(91); for (let i = 0; i < NR; i++) { rainX[i] = r(); rainY[i] = r(); rainS[i] = 0.8 + r() * 0.5; } for (let i = 0; i < NS; i++) { snX[i] = r(); snY[i] = r(); snS[i] = 0.5 + r() * 0.8; snP[i] = r() * TAU; } for (let i = 0; i < NSP; i++) spA[i] = 1 + r(); }
  const wr = rng(4242);
  function step(dt) {
    const L = K.light; if (!L || !L.weather) return;
    const H = K.view.H || 150, W = K.view.W || 180;
    if (L.weather === 'rain') {
      for (let i = 0; i < NR; i++) { rainY[i] += dt * 95 * rainS[i] / H; if (rainY[i] > 1) { rainY[i] -= 1; rainX[i] = wr(); } }
      for (let i = 0; i < NSP; i++) { spA[i] += dt * 3.2; if (spA[i] > 1) { spA[i] = 0; const cp = K.camPx || K.cam; spX[i] = cp.x + wr() * W; spY[i] = GROUND_Y + 2 + wr() * (STREET_Y + 16 - GROUND_Y); } }
    } else if (L.weather === 'snow') {
      for (let i = 0; i < NS; i++) { snY[i] += dt * 7 * snS[i] / H; if (snY[i] > 1) { snY[i] -= 1; snX[i] = wr(); } }
    }
  }
  let fogSprite = null;
  function drawWeather(ctx) {
    const L = K.light, cm = camera(), cx = cm[0], cy = cm[1], W = cm[3], H = cm[4];
    if (L.weather === 'rain') {
      ctx.globalAlpha = 0.45; ctx.beginPath();
      for (let i = 0; i < NR; i++) { const x = cx + rainX[i] * (W + 10) - 5, y = cy + rainY[i] * (H + 8) - 6; ctx.moveTo(x, y); ctx.lineTo(x - 0.9, y + 3.6 * rainS[i]); }
      ctx.lineWidth = 0.22; ctx.strokeStyle = C.rainDrop || (C.rainDrop = mix(lit('#dfe8f2'), '#8090b0', L.night * 0.4)); ctx.lineCap = 'round'; ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < NSP; i++) { const a = spA[i]; if (a >= 1) continue; const r = 0.4 + a * 1.1; ctx.moveTo(spX[i] - r, spY[i]); ctx.quadraticCurveTo(spX[i], spY[i] - r * 0.9, spX[i] + r, spY[i]); }
      ctx.globalAlpha = 0.5; ctx.lineWidth = 0.2; ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (L.weather === 'snow') {
      ctx.fillStyle = C.snowFlake; ctx.beginPath();
      const t = K.t, w = W + 10;
      for (let i = 0; i < NS; i++) {
        const x = cx + ((snX[i] * w + Math.sin(t * 0.9 + snP[i]) * 1.6 - cx * 0.15 * snS[i]) % w + w) % w - 5, y = cy + snY[i] * (H + 6) - 3;
        const r = 0.22 + snS[i] * 0.28; ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
      }
      ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
    } else if (L.weather === 'fog') {
      if (!fogSprite) {
        fogSprite = document.createElement('canvas'); fogSprite.width = 128; fogSprite.height = 32;
        const c = fogSprite.getContext('2d'), gr = c.createRadialGradient(64, 64, 4, 64, 64, 62);
        gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        c.setTransform(1, 0, 0, 0.25, 0, 0); c.fillStyle = gr; c.fillRect(0, 0, 128, 128);
      }
      const t = K.t;
      ctx.globalAlpha = 0.16 + 0.1 * (1 - L.night); ctx.fillStyle = L.skyHor; ctx.fillRect(cx, cy, W, H);
      for (let b = 0; b < 3; b++) {
        const by = b === 0 ? HORIZON + 6 : b === 1 ? GROUND_Y - 22 : GROUND_Y + 30, a = b === 0 ? 0.55 : b === 1 ? 0.42 : 0.22, sp = b === 0 ? 2.0 : b === 1 ? 1.4 : 1.1;
        for (let j = 0; j < 3; j++) {
          const x = cx + (((j * 160 + t * sp * (b + 1) - cx * 0.3) % 480) + 480) % 480 - 160;
          ctx.globalAlpha = a * (1 - L.night * 0.5); ctx.drawImage(fogSprite, x, by - 14, 150, 30);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  return { setLight, drawSky, drawBackdrop, drawWeather, drawLights, figure, prop, emote, glow, step, tones: () => C };
}
