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
   Style: illustrated, not pixel art. Smooth shapes, soft shading (light from
   the upper left), a thin warm outline (K.pal.ink, ~0.5 units), round
   joins. Readable at docked size (a person ~14 units tall at ~2-4 px/unit).

   THIS FILE IS A STUB from the v2 kernel: simple shapes so the site runs.
   The art helper replaces it. */

import { BASE, EMIT, WW, HORIZON, GROUND_Y, clamp, lerp, mix, hexRgb, rgbHex, rgba } from './build-site-shared.js';

export const PROPS = ['pallet', 'beam', 'panel', 'bricks', 'barrow', 'pane', 'spool', 'rebar', 'stakes', 'bucket', 'mug', 'thermos',
  'sandwich', 'clipboard', 'cake', 'toolbox', 'shovel', 'tarp', 'flag', 'plant', 'cone', 'truck', 'mixerTruck', 'forklift', 'dog',
  'doghouse', 'snowman', 'sawhorse', 'mixer', 'hook', 'stake', 'lamp'];

export function createArt(K) {
  let key = '';
  function setLight(sky) {
    const w = sky.weather || 'clear';
    let a = typeof sky.sunAltitude === 'number' ? sky.sunAltitude : (sky.isNight ? -15 : 30);
    if (sky.isNight && a > -4) a = -8;
    const d = K.now();
    const hour = sky.hour != null ? sky.hour : d.getHours() + d.getMinutes() / 60;
    const evening = hour >= 12;
    const K1 = [[-12, [0.27, 0.31, 0.5], '#0e1430', '#26305a'], [-5, [0.4, 0.4, 0.6], '#1f2a55', '#5a5e8a'], [0, [0.75, 0.65, 0.7], '#3b4373', evening ? '#f0a676' : '#f1c9a0'],
      [6, [0.98, 0.88, 0.8], '#6f8fc0', evening ? '#f4c08a' : '#f4d6aa'], [15, [1, 0.98, 0.94], '#6aa6d9', '#e6e2d2'], [30, [1, 1, 1], '#6aa6d9', '#d6e8f2']];
    let i = 0; while (i < K1.length - 2 && a > K1[i + 1][0]) i++;
    const k0 = K1[i], k1 = K1[i + 1], t = clamp((a - k0[0]) / (k1[0] - k0[0]), 0, 1);
    let amb = [0, 1, 2].map((j) => lerp(k0[1][j], k1[1][j], t));
    let top = mix(k0[2], k1[2], t), hor = mix(k0[3], k1[3], t);
    const night = clamp((2 - a) / 10, 0, 1);
    if (w !== 'clear') { amb = amb.map((v) => v * 0.88); top = mix(top, '#9fb0c0', 0.5 * (1 - night)); hor = mix(hor, '#c8d0d6', 0.5 * (1 - night)); }
    const month = d.getMonth();
    const snowy = w === 'snow' || sky.snowCover === true || (w !== 'rain' && (month === 0 || month === 1) && sky.snowCover !== false);
    K.light = { night, alt: a, evening, weather: w, snowy, wet: w === 'rain', fog: w === 'fog', ambient: amb.map((v) => Math.round(v * 40) / 40), skyTop: top, skyHor: hor };
    const nk = K.light.ambient.join() + top + hor + snowy + w;
    if (nk === key) return false;
    key = nk;
    const pal = {};
    for (const n in BASE) { const c = hexRgb(BASE[n]); pal[n] = rgbHex([c[0] * K.light.ambient[0], c[1] * K.light.ambient[1], c[2] * K.light.ambient[2]]); }
    Object.assign(pal, EMIT);
    K.pal = pal;
    return true;
  }
  function drawSky(ctx) {
    const c = ctx.canvas, g = ctx.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, K.light.skyTop); g.addColorStop(1, K.light.skyHor);
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
  }
  function drawBackdrop(ctx) {
    K.blit('art:backdrop', 0, HORIZON - 40, WW, GROUND_Y - HORIZON + 40, (g, x0, x1) => {
      g.fillStyle = mix(K.pal.glass, K.light.skyHor, 0.4);
      g.beginPath(); g.moveTo(x0, HORIZON);
      for (let x = x0; x <= x1; x += 4) g.lineTo(x, HORIZON - 12 - 10 * Math.sin(x / 40) * Math.sin(x / 17));
      g.lineTo(x1, HORIZON); g.fill();
      g.fillStyle = mix('#8fadc6', K.light.skyHor, 0.3); g.fillRect(x0, HORIZON, x1 - x0, GROUND_Y - HORIZON - 20);
      g.fillStyle = K.pal.tree; g.fillRect(x0, GROUND_Y - 22, x1 - x0, 22);
    }, { p: 1 });
  }
  function drawWeather() {}
  function drawLights() {}
  function figure(ctx, x, y, o = {}) {
    const c = o.colors || {}, f = o.facing || 1, t = o.t || 0;
    const step = o.pose === 'walk' || o.pose === 'push' ? Math.sin(t * 9) * 2 : 0;
    ctx.lineCap = 'round'; ctx.lineWidth = 1.6;
    ctx.strokeStyle = K.pal.pants; ctx.beginPath(); ctx.moveTo(x - 1, y - 5); ctx.lineTo(x - 1 + step, y); ctx.moveTo(x + 1, y - 5); ctx.lineTo(x + 1 - step, y); ctx.stroke();
    ctx.fillStyle = c.vest || '#f80'; ctx.fillRect(x - 2.5, y - 10, 5, 5.5);
    ctx.fillStyle = c.skin || '#e0ac69'; ctx.beginPath(); ctx.arc(x, y - 12, 2, 0, 7); ctx.fill();
    if (o.hat !== false) { ctx.fillStyle = c.hat || '#f2c230'; ctx.beginPath(); ctx.arc(x, y - 12.8, 2.3, Math.PI, 0); ctx.fill(); ctx.fillRect(x - 2.5 + f, y - 13, 5, 0.8); }
    if (o.carry) { ctx.fillStyle = K.pal.timber; ctx.fillRect(x - 5, y - 11, 10, 1.4); }
  }
  function prop(ctx, name, x, y, o = {}) {
    ctx.fillStyle = name === 'truck' ? K.pal.truck : name === 'pane' ? K.pal.glassHi : K.pal.pallet;
    const w = name === 'truck' || name === 'mixerTruck' ? 30 : 6, h = name === 'truck' || name === 'mixerTruck' ? 14 : 3;
    ctx.fillRect(x - w / 2, y - h, w, h);
  }
  function emote(ctx, x, y, icon) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); ctx.fillStyle = '#333'; ctx.font = '4px sans-serif'; ctx.fillText(icon[0], x - 1.2, y + 1.4); }
  function glow(ctx, x, y, r, a) { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba('#ffbe64', a)); g.addColorStop(1, rgba('#ffa046', 0)); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); }
  return { setLight, drawSky, drawBackdrop, drawWeather, drawLights, figure, prop, emote, glow, step() {} };
}
