/* build-site-world.js — the yard and its zones, the fence and the gate,
   Lakeside Ave and the people going by.

   A little enclosed world, west to east: the rolling gate and the WATERSHED
   sign; the gravel staging pad (a shipping container, the light tower, the
   glass A-frame, rebar and nail boxes); the site trailer with its steps; the
   canteen (a striped pop-up awning, the coffee urn, a picnic table, string
   lights); the lumber yard (a cantilever rack and the timber stack) and the
   open prefab shed (workbench, pegboard, nail kegs, the CLT panel A-frame;
   the crew draws the sawhorses and the mortar mixer because it works them);
   brick pallets, the sand pile and cement bags; the pad (the building
   module's); the toolshed with its stakes and wire spools, the john, the
   dumpster and a cable-reel table; the side gate; a patch of lawn with a
   bench facing the lake under a big maple; and the old 1894 brick mill next
   door with its sawtooth roof and stack. In front: the chain-link fence (a
   mural of painted panels grows on it as posts come in), the sidewalk,
   Lakeside Ave with its bike lane, the far sidewalk with acorn lamps and
   street trees, and the people going by.

   Everything static is drawn once into K.blit caches (re-rendered when the
   zoom, the light or a stack changes). Stacks people walk in front of and
   behind are depth-sorted through collect(); so are the fence and the people
   on the sidewalk and in the bike lane, so a truck on the street passes in
   front of the fence. drawFront() is only the far-sidewalk foreground (lamps
   and street trees).

   INTERFACE:
     createWorld(K) -> {
       drawBack(ctx)        world space, after the backdrop and before the building: the ground
                            (dirt, gravel, mud, snow) and the street surface, back-line structures
                            (container, light tower, lumber rack, prefab shed, the mill). Cached.
       collect(list)        push { y, draw(ctx) } for things standing in the yard that need depth
                            sorting with people (trailer, canteen, stacks, sheds, john, bench, tree),
                            the fence and both gates, and passers-by on the sidewalk and bike lane
       drawFront(ctx)       the crew's street traffic (K.crew.drawStreet, if it has one), then the far
                            sidewalk's acorn lamps and street trees (in front of everything)
       pile(kind) -> n      how full a material stack is (0..5); take(kind) / add(kind) change it
                            kinds: lumber, panels, brick, glass, copper, nails, rebar, stakes
                            (aliases: beam, formwork -> lumber; panel -> panels; bricks -> brick;
                            pane -> glass; spool -> copper; stake -> stakes)
       spot(zone, name)     [x, y] of a named spot (ZONES in shared, plus EXTRA_SPOTS below)
       step(dt)
       Added in v2 (for the director and the crew):
       cover(kind, on)      pull a tarp over a stack (on) or off; covered(kind) -> bool
       spawn(kind, o)       a passer-by now: 'kid' (a kid and a parent who stop at the fence and
                            wave; o.stopX), 'walk', 'jog', 'dog', 'bike', 'coffee'. Returns its id.
                            K.emit('kid:wave', { id, x, y }) when the kid starts waving.
       cheer(id)            the waving kid sees someone wave back: a hop and a heart
       muralCount() -> n    painted mural panels; muralSpot(i) -> [x, y] (centre of panel i)
       gateOpen() -> 0..1
     }
*/

import { WW, WH, GROUND_Y, YARD_FRONT, STREET_Y, ZONES, EMIT, clamp, mix, rgba, hexRgb, rgbHex, hash, rng, SKINS, HAIRS } from './build-site-shared.js';

/* Spots the shared ZONES don't name (world-only furniture). */
export const EXTRA_SPOTS = {
  staging: { tower: [152, 458], container: [108, 456], nails: [163, 480] },
  canteen: { huddle1: [232, 468], huddle2: [244, 467], huddle3: [256, 468], cups: [233, 466] },
  lumber: { bench: [312, 456], nails: [336, 452] },
  masonry: { sand: [392, 460], bags: [399, 466] },
  tools: { reel: [551, 487], reelL: [544, 487], reelR: [558, 487], spools: [583, 468], stakes: [554, 466] },
  bench: { snowman: [661, 484], leaves: [700, 478], lawn: [684, 486] },
  street: { near: [0, 501], bike: [0, 506.5], far: [0, 521.5] },
};

const SIDEWALK_Y = 501.2, BIKE_Y = 506.6;
/* the far side (a tall phone sees it): far curb, the verge, the bike path */
const FAR_CURB = STREET_Y + 16.2, VERGE_Y = FAR_CURB + 11, PATH_Y0 = FAR_CURB + 18, PATH_Y1 = FAR_CURB + 25;
const PATH_E = (PATH_Y0 + PATH_Y1) / 2 - 1.2, PATH_W = (PATH_Y0 + PATH_Y1) / 2 + 2.2;
const FENCE_END = 722;
const MURAL_X0 = 409, MURAL_N = 14, MURAL_W = 8.2;
const ALIAS = { beam: 'lumber', formwork: 'lumber', panel: 'panels', bricks: 'brick', pane: 'glass', spool: 'copper', stake: 'stakes' };
const JACKETS = ['#3f6e8f', '#8a3f4f', '#4f7a4a', '#c27a2c', '#5a4f7a', '#2f5f6f', '#a34f3a', '#6f6a5a', '#d0a23a', '#3a4a6a', '#b85a7a', '#e6e0d0'];
const UMBRELLAS = ['#d9443a', '#2f6fb2', '#f2c230', '#3fae5a', '#5a4f7a'];
const COATS = ['#8a5a3a', '#2b2622', '#c9a36a', '#e8e2d6', '#6b4a32', '#a8743f'];

export function createWorld(K) {
  const piles = { lumber: 4, panels: 3, brick: 4, glass: 3, copper: 3, nails: 3, rebar: 3, stakes: 3 };
  const tarp = { lumber: 0, panels: 0, brick: 0 };          // 0..1, animates
  const tarpWant = { lumber: false, panels: false, brick: false };
  let gate = 1, lastMural = -1;
  const passers = [];
  let passT = 3, pid = 0;

  /* ------------------------------------------------------- helpers */
  let litGen = -1;
  const litCache = new Map();
  function lit(hex) {
    if (litGen !== K.gen) { litCache.clear(); litGen = K.gen; }
    let v = litCache.get(hex);
    if (!v) { const a = (K.light && K.light.ambient) || [1, 1, 1], c = hexRgb(hex); v = rgbHex([c[0] * a[0], c[1] * a[1], c[2] * a[2]]); litCache.set(hex, v); }
    return v;
  }
  const P = () => K.pal;
  const dark = (c, k = 0.2) => mix(c, K.pal.ink, k);
  const light = (c, k = 0.2) => mix(c, K.pal.white, k);
  const night = () => (K.light && K.light.night) || 0;
  const snowy = () => !!(K.light && K.light.snowy);
  const wet = () => !!(K.light && K.light.wet);
  const month = () => K.now().getMonth();
  const hour = () => { const d = K.now(); return d.getHours() + d.getMinutes() / 60; };
  function season() {
    const m = month();
    if (snowy()) return 'winter';
    if (m === 11 || m <= 2) return 'bare';
    if (m === 3) return 'spring';
    if (m === 9) return 'fall';
    if (m === 10) return 'late';
    return 'summer';
  }
  const seasonCode = () => ['winter', 'bare', 'spring', 'summer', 'fall', 'late'].indexOf(season());
  const working = () => K.S.you.state === 'working' || K.S.you.state === 'paused' || (K.S.crew && K.S.crew.length > 0);

  function rr(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function ink(g, w = 0.45) { g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = w; g.strokeStyle = K.pal.ink; g.stroke(); }
  /* a filled, softly shaded, outlined box (light from the upper left) */
  function box(g, x, y, w, h, c, r = 0.6, o = {}) {
    rr(g, x, y, w, h, r); g.fillStyle = c; g.fill();
    if (o.shade !== false && w > 1.5 && h > 1.5) {
      g.save(); g.clip();
      g.fillStyle = dark(c, o.shadeK || 0.16); g.fillRect(x + w * (o.split || 0.74), y, w, h);
      g.fillStyle = light(c, 0.22); g.fillRect(x, y, w, Math.min(0.8, h * 0.18));
      g.restore();
    }
    if (o.ink !== false) { rr(g, x, y, w, h, r); ink(g, o.lw || 0.45); }
  }
  function shadow(g, cx, y, rx, ry = 1.2, a = 0.2) {
    g.fillStyle = rgba(K.pal.ink, a); g.beginPath(); g.ellipse(cx, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
  }
  function line(g, x0, y0, x1, y1, c, w = 0.4) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.stroke(); }
  /* snow resting on a flat top */
  function snowCap(g, x, y, w, h = 1.2) {
    if (!snowy()) return;
    g.beginPath(); g.moveTo(x - 0.3, y + 0.3);
    g.bezierCurveTo(x - 0.3, y - h, x + w * 0.3, y - h * 1.1, x + w * 0.5, y - h * 0.9);
    g.bezierCurveTo(x + w * 0.7, y - h * 1.1, x + w + 0.3, y - h, x + w + 0.3, y + 0.3);
    g.closePath(); g.fillStyle = K.pal.snow; g.fill();
    g.lineWidth = 0.3; g.strokeStyle = K.pal.snowShade; g.stroke();
  }
  function lights(x, y, r, a, color) {
    if (night() < 0.25) return;
    const c = K.cam, v = K.view;
    if (x + r < c.x || x - r > c.x + v.W || y + r < c.y || y - r > c.y + v.H) return;
    K.lights.push({ x, y, r, a: a * clamp((night() - 0.25) / 0.45, 0, 1), color });
  }

  /* ------------------------------------------------------- the ground */
  function drawGround(g, x0, x1) {
    const pal = P(), sn = snowy(), wt = wet();
    const gy = GROUND_Y, fy = YARD_FRONT;
    /* the bank behind the site */
    g.fillStyle = sn ? pal.snow : pal.grass;
    g.beginPath(); g.moveTo(x0 - 1, gy + 1);
    for (let x = Math.floor(x0 / 3) * 3 - 3; x <= x1 + 3; x += 3) g.lineTo(x, gy - 6 + Math.sin(x * 0.31) * 0.6 + Math.sin(x * 0.083) * 0.9);
    g.lineTo(x1 + 1, gy + 1); g.closePath(); g.fill();
    g.fillStyle = sn ? pal.snowShade : pal.grassDark; g.fillRect(x0, gy - 1.2, x1 - x0, 1.4);
    /* the yard: dirt, packed and a little lighter toward the back */
    const base = sn ? pal.snow : wt ? mix(pal.dirt, pal.mud, 0.55) : pal.dirt;
    const grad = g.createLinearGradient(0, gy, 0, fy);
    grad.addColorStop(0, sn ? pal.snowShade : dark(base, 0.12)); grad.addColorStop(0.18, base); grad.addColorStop(1, sn ? light(base, 0.1) : mix(base, pal.dirtDark, 0.25));
    g.fillStyle = grad; g.fillRect(x0, gy, x1 - x0, fy - gy + 1);
    /* the gravel pad at staging */
    const s0 = 86, s1 = 172;
    if (x1 > s0 && x0 < s1) {
      g.fillStyle = sn ? light(pal.snowShade, 0.35) : wt ? dark(pal.gravel, 0.15) : pal.gravel;
      g.beginPath(); g.moveTo(s0 + 4, gy + 3); g.lineTo(s1 - 2, gy + 3); g.quadraticCurveTo(s1 + 2, gy + 20, s1 - 4, fy - 6); g.lineTo(s0 + 2, fy - 4); g.quadraticCurveTo(s0 - 3, gy + 20, s0 + 4, gy + 3); g.fill();
      const r = rng(31);
      for (let i = 0; i < 260; i++) { const x = s0 + 2 + r() * (s1 - s0 - 6), y = gy + 4 + r() * (fy - gy - 10); if (x < x0 - 1 || x > x1 + 1) continue; g.fillStyle = r() < 0.5 ? dark(pal.gravel, 0.22) : light(pal.gravel, 0.3); g.fillRect(x, y, 0.5, 0.4); }
    }
    /* specks: pebbles and clods, seeded by grid cell so chunks agree */
    for (let cx = Math.floor(x0 / 6); cx <= Math.ceil(x1 / 6); cx++) {
      if (cx * 6 > FENCE_END - 76) break;
      const r = rng(hash('sp' + cx));
      for (let k = 0; k < 5; k++) {
        const x = cx * 6 + r() * 6, y = gy + 2 + r() * (fy - gy - 3);
        g.fillStyle = sn ? (r() < 0.5 ? pal.snowShade : pal.white) : r() < 0.55 ? dark(base, 0.18) : light(base, 0.18);
        g.beginPath(); g.ellipse(x, y, 0.45 + r() * 0.4, 0.28, 0, 0, 6.3); g.fill();
      }
    }
    /* tire ruts in from the gate, along the yard to the pad */
    const rut = (off) => { g.beginPath(); g.moveTo(66 + off, fy + 1); g.bezierCurveTo(70 + off, gy + 36, 92, gy + 30 + off, 130, gy + 30 + off); g.lineTo(404, gy + 30 + off * 0.6); };
    g.lineCap = 'round';
    for (const off of [-2.6, 2.6]) {
      rut(off); g.strokeStyle = sn ? pal.snowShade : rgba(dark(base, 0.3), 0.55); g.lineWidth = 1.5; g.stroke();
      rut(off + 0.55); g.strokeStyle = sn ? rgba(pal.white, 0.6) : rgba(light(base, 0.25), 0.5); g.lineWidth = 0.35; g.stroke();
    }
    /* the mixer truck's tracks, backing in from the side gate to the front of the pad */
    const rut2 = (off) => { g.beginPath(); g.moveTo(642 + off, fy + 1); g.bezierCurveTo(636 + off, gy + 34, 610, gy + 25 + off, 580, gy + 25 + off); g.lineTo(412, gy + 25.5 + off * 0.8); };
    for (const off of [-2.4, 2.4]) {
      rut2(off); g.strokeStyle = sn ? pal.snowShade : rgba(dark(base, 0.28), 0.4); g.lineWidth = 1.3; g.stroke();
    }
    /* weeds along the foot of the fence, and a few offcuts lying about */
    if (!sn) {
      for (let cx = Math.floor(x0 / 4); cx <= Math.ceil(x1 / 4); cx++) {
        if (cx * 4 > 646) break;
        const r = rng(hash('wd' + cx)); if (r() < 0.45) continue;
        const x = cx * 4 + r() * 4, y = fy - 0.6 - r() * 1.6;
        g.strokeStyle = r() < 0.5 ? pal.grassDark : pal.grass; g.lineWidth = 0.35;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - 0.6, y - 1.4 - r()); g.moveTo(x + 0.3, y); g.lineTo(x + 0.5, y - 1.8 - r()); g.moveTo(x + 0.6, y); g.lineTo(x + 1.3, y - 1.1); g.stroke();
      }
    }
    for (const [ox, oy, len, rot] of [[352, 487, 7, 0.1], [446, 491, 5, -0.15], [512, 489, 6, 0.3], [182, 486, 6, -0.2], [596, 488, 5, 0.2]]) {
      if (ox + len < x0 || ox - len > x1) continue;
      g.save(); g.translate(ox, oy); g.rotate(rot);
      box(g, -len / 2, -0.6, len, 1.2, sn ? pal.snowShade : pal.timber, 0.2, { lw: 0.3, shade: false });
      g.restore();
    }
    /* sawdust where the crew cuts (the crew draws its sawhorses and the mortar mixer: they work) */
    if (!sn) for (const [sx, sy, rx] of [[302, 474.4, 4], [291, 481.4, 3], [334, 477, 6]]) { if (sx + rx < x0 || sx - rx > x1) continue; g.fillStyle = rgba(light(pal.timber, 0.35), 0.75); g.beginPath(); g.ellipse(sx, sy, rx, 0.9, 0, 0, 6.3); g.fill(); }
    /* a worn footpath from the canteen to the pad */
    g.beginPath(); g.moveTo(222, gy + 16); g.bezierCurveTo(300, gy + 13, 340, gy + 17, 404, gy + 14);
    g.strokeStyle = sn ? rgba(pal.snowShade, 0.7) : rgba(light(base, 0.22), 0.55); g.lineWidth = 3; g.stroke();
    /* puddles after rain */
    if (wt) {
      const reflect = mix(pal.glassHi, K.light.skyHor || pal.glassHi, 0.5);
      for (const [px, py, rx] of [[96, 479, 6], [140, 483, 4], [205, 482, 5], [262, 480, 7], [318, 482, 4], [372, 483, 5], [560, 476, 6], [600, 486, 4], [76, 494, 4]]) {
        if (px + rx < x0 || px - rx > x1) continue;
        g.fillStyle = dark(base, 0.25); g.beginPath(); g.ellipse(px, py + 0.2, rx + 0.6, 1.5, 0, 0, 6.3); g.fill();
        g.fillStyle = reflect; g.beginPath(); g.ellipse(px, py, rx, 1.1, 0, 0, 6.3); g.fill();
        g.fillStyle = rgba(pal.white, 0.45); g.fillRect(px - rx * 0.5, py - 0.4, rx * 0.5, 0.3);
      }
    }
    /* snow: drifts along the fence */
    if (sn) {
      g.fillStyle = pal.white;
      for (let x = Math.floor(x0 / 9) * 9; x < x1 + 9; x += 9) { g.beginPath(); g.ellipse(x + 4, fy - 1.2, 6, 1.6, 0, 0, 6.3); g.fill(); }
    }
    /* lawn: the bench's corner of the park, and the mill's frontage */
    if (x1 > 646) {
      const lawn = sn ? pal.snow : pal.grass;
      g.fillStyle = lawn;
      g.beginPath(); g.moveTo(650, gy); g.bezierCurveTo(646, gy + 20, 652, fy - 10, 648, fy + 1); g.lineTo(WW, fy + 1); g.lineTo(WW, gy); g.fill();
      for (let cx = Math.max(110, Math.floor(x0 / 5)); cx <= Math.ceil(x1 / 5); cx++) {
        const r = rng(hash('g' + cx));
        for (let k = 0; k < 4; k++) {
          const x = cx * 5 + r() * 5, y = gy + 2 + r() * (fy - gy - 4);
          if (x < 652) continue;
          g.strokeStyle = sn ? pal.snowShade : r() < 0.5 ? pal.grassDark : light(pal.grass, 0.18); g.lineWidth = 0.3;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x - 0.3, y - 0.9); g.moveTo(x + 0.4, y); g.lineTo(x + 0.6, y - 0.8); g.stroke();
        }
      }
      /* a little path from the side gate to the bench */
      g.fillStyle = sn ? pal.snowShade : light(pal.gravel, 0.12);
      g.beginPath(); g.moveTo(636, fy); g.bezierCurveTo(650, fy - 14, 668, 478, 686, 474); g.lineTo(688, 476.5); g.bezierCurveTo(670, 481, 656, fy - 10, 646, fy); g.fill();
      /* the mill's concrete apron */
      g.fillStyle = sn ? pal.snowShade : pal.concrete; g.fillRect(Math.max(x0, 726), gy, x1 - Math.max(x0, 726), 5);
      g.fillStyle = dark(pal.concrete, 0.2); g.fillRect(Math.max(x0, 726), gy + 5, x1 - Math.max(x0, 726), 0.5);
    }
    drawStreet(g, x0, x1);
  }
  function drawStreet(g, x0, x1) {
    const pal = P(), sn = snowy(), wt = wet();
    const sy = STREET_Y, fy = YARD_FRONT;
    const w = x1 - x0;
    /* the near sidewalk */
    g.fillStyle = pal.sidewalk; g.fillRect(x0, fy, w, sy - fy);
    g.fillStyle = dark(pal.sidewalk, 0.1);
    for (let x = Math.floor(x0 / 9) * 9; x < x1; x += 9) g.fillRect(x, fy, 0.25, sy - fy);
    g.fillStyle = light(pal.sidewalk, 0.25); g.fillRect(x0, fy, w, 0.4);
    /* curb */
    g.fillStyle = dark(pal.sidewalk, 0.28); g.fillRect(x0, sy - 0.7, w, 0.9);
    /* asphalt: bike lane, two travel lanes */
    const asph = wt ? dark(pal.asphalt, 0.18) : pal.asphalt;
    g.fillStyle = asph; g.fillRect(x0, sy + 0.2, w, 16);
    g.fillStyle = light(asph, 0.06); g.fillRect(x0, sy + 0.2, w, 5.2);       // the bike lane, a touch lighter
    g.fillStyle = lit('#e8e2d0'); g.fillRect(x0, sy + 5.4, w, 0.4);
    g.fillStyle = pal.lane; g.fillRect(x0, sy + 9.7, w, 0.3); g.fillRect(x0, sy + 10.3, w, 0.3);
    for (let x = Math.floor(x0 / 140) * 140 + 40; x < x1 + 10; x += 140) bikeGlyph(g, x, sy + 2.9, lit('#e8e2d0'));
    if (wt) {
      g.fillStyle = rgba(pal.glassHi, 0.18);
      for (let x = Math.floor(x0 / 23) * 23; x < x1; x += 23) g.fillRect(x + (hash('w' + x) % 9), sy + 2 + (hash('v' + x) % 12), 6 + (hash('u' + x) % 6), 0.35);
    }
    if (sn) {
      g.fillStyle = rgba(pal.snow, 0.8); g.fillRect(x0, sy + 0.2, w, 1.2); g.fillRect(x0, sy + 15, w, 1.2);
      g.fillStyle = rgba(pal.snowShade, 0.5);
      for (const ty of [sy + 3.4, sy + 7.3, sy + 12.4, sy + 14]) g.fillRect(x0, ty, w, 0.6);
    }
    drawFarSide(g, x0, x1);
  }
  /* the far side of Lakeside Ave, which a tall phone shows: the far sidewalk, a grass verge, the
     Burlington bike path, and the lawn beyond it with boulders, shrubs and flowers by season */
  function drawFarSide(g, x0, x1) {
    const pal = P(), sn = snowy(), s = season(), w = x1 - x0;
    const fs = FAR_CURB;
    g.fillStyle = dark(pal.sidewalk, 0.28); g.fillRect(x0, fs, w, 0.6);
    g.fillStyle = pal.sidewalk; g.fillRect(x0, fs + 0.6, w, 4.4);
    g.fillStyle = dark(pal.sidewalk, 0.1); for (let x = Math.floor(x0 / 9) * 9 + 4; x < x1; x += 9) g.fillRect(x, fs + 0.6, 0.25, 4.4);
    g.fillStyle = light(pal.sidewalk, 0.2); g.fillRect(x0, fs + 0.6, w, 0.35);
    /* the verge and the lawn */
    const lawn = sn ? pal.snow : pal.grass;
    const grad = g.createLinearGradient(0, fs + 5, 0, WH);
    grad.addColorStop(0, sn ? pal.snowShade : pal.grassDark); grad.addColorStop(0.12, lawn); grad.addColorStop(1, sn ? light(pal.snow, 0.1) : mix(lawn, pal.treeLight, 0.3));
    g.fillStyle = grad; g.fillRect(x0, fs + 5, w, WH - fs - 5);
    for (let cx = Math.floor(x0 / 5); cx <= Math.ceil(x1 / 5); cx++) {
      const r = rng(hash('fl' + cx));
      for (let k = 0; k < 5; k++) {
        const x = cx * 5 + r() * 5, y = fs + 6 + r() * (WH - fs - 7);
        if (y > PATH_Y0 - 1 && y < PATH_Y1 + 1) continue;
        g.strokeStyle = sn ? pal.snowShade : r() < 0.5 ? pal.grassDark : light(pal.grass, 0.18); g.lineWidth = 0.3;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - 0.3, y - 0.9); g.moveTo(x + 0.4, y); g.lineTo(x + 0.6, y - 0.8); g.stroke();
        /* wildflowers in spring and summer, fallen leaves in the fall */
        if (!sn && r() < 0.18) {
          const c = s === 'fall' || s === 'late' ? [pal.autumnA, pal.autumnB][(cx + k) % 2] : s === 'summer' || s === 'spring' ? [lit('#f4f1e8'), lit('#f2c230'), lit('#c98ad8'), lit('#ff8aa8')][(cx + k) % 4] : null;
          if (c) { g.fillStyle = c; g.beginPath(); g.arc(x + 0.8, y - 0.6, 0.38, 0, 6.3); g.fill(); }
        }
      }
    }
    /* the bike path: paved, a dashed yellow centre line, soft edges */
    g.fillStyle = sn ? light(pal.snowShade, 0.25) : mix(pal.asphalt, pal.sidewalk, 0.35);
    g.fillRect(x0, PATH_Y0, w, PATH_Y1 - PATH_Y0);
    g.fillStyle = sn ? pal.snowShade : dark(pal.grassDark, 0.1); g.fillRect(x0, PATH_Y0 - 0.4, w, 0.5); g.fillRect(x0, PATH_Y1 - 0.1, w, 0.5);
    if (!sn) { g.fillStyle = pal.lane; for (let x = Math.floor(x0 / 7) * 7; x < x1; x += 7) g.fillRect(x, (PATH_Y0 + PATH_Y1) / 2 - 0.15, 3.4, 0.3); }
    else { g.fillStyle = rgba(pal.snowShade, 0.8); g.fillRect(x0, PATH_Y0 + 1.4, w, 0.6); g.fillRect(x0, PATH_Y1 - 2, w, 0.6); }
    /* a post-and-rope fence along the far edge of the lawn */
    const fy2 = PATH_Y1 + 19;
    g.strokeStyle = sn ? pal.snowShade : lit('#c9b48a'); g.lineWidth = 0.35;
    g.beginPath(); for (let x = Math.floor(x0 / 12) * 12; x < x1 + 12; x += 12) { g.moveTo(x, fy2 - 3); g.quadraticCurveTo(x + 6, fy2 - 1.6, x + 12, fy2 - 3); } g.stroke();
    for (let x = Math.floor(x0 / 12) * 12; x < x1 + 12; x += 12) { box(g, x - 0.5, fy2 - 4, 1, 4.2, pal.timberShade, 0.3, { lw: 0.25, shade: false }); if (sn) snowCap(g, x - 0.6, fy2 - 4, 1.2, 0.5); }
    /* lakeshore boulders and low shrubs beyond the path */
    for (let x = Math.floor(x0 / 23) * 23; x < x1 + 23; x += 23) {
      const r = rng(hash('bd' + x)), bx = x + r() * 14, by = PATH_Y1 + 6 + r() * 9;
      if (r() < 0.55) {
        g.beginPath(); g.ellipse(bx, by, 2.6 + r() * 1.6, 1.6 + r() * 0.6, 0, Math.PI, 0); g.closePath();
        g.fillStyle = sn ? pal.snow : lit('#9a9488'); g.fill(); ink(g, 0.3);
        if (!sn) { g.fillStyle = rgba(pal.white, 0.25); g.beginPath(); g.ellipse(bx - 0.8, by - 1, 1, 0.4, 0, 0, 6.3); g.fill(); }
      } else {
        const c = sn ? pal.evergreen : s === 'fall' ? pal.autumnA : s === 'late' || s === 'bare' ? lit('#7a6a52') : pal.treeDark;
        for (const [dx, rr] of [[0, 2.2], [2.4, 2.8], [4.8, 2]]) { g.beginPath(); g.arc(bx + dx, by, rr, Math.PI, 0); g.closePath(); g.fillStyle = c; g.fill(); ink(g, 0.3); }
        if (sn) { g.fillStyle = pal.snow; g.fillRect(bx - 1.8, by - 2.7, 8, 0.7); }
      }
    }
  }
  function bikeGlyph(g, x, y, c) {
    g.strokeStyle = c; g.lineWidth = 0.3;
    g.beginPath(); g.ellipse(x - 1.6, y, 1, 0.5, 0, 0, 6.3); g.moveTo(x + 2.6, y); g.ellipse(x + 1.6, y, 1, 0.5, 0, 0, 6.3); g.stroke();
    g.beginPath(); g.moveTo(x - 1.6, y); g.lineTo(x - 0.2, y - 0.6); g.lineTo(x + 1.6, y); g.moveTo(x - 0.2, y - 0.6); g.lineTo(x + 1, y - 0.9); g.stroke();
  }

  /* ------------------------------------------------ back-line structures */
  function drawContainer(g) {
    const pal = P(), x = 90, y = 437, w = 34, h = 15;
    const c = mix(lit('#3d6f86'), pal.shed, 0.25);
    shadow(g, x + w / 2, GROUND_Y + 1.6, w / 2 + 2, 1.2);
    box(g, x, y, w, h, c, 0.5);
    g.save(); rr(g, x, y, w, h, 0.5); g.clip();
    for (let xx = x + 1.2; xx < x + w; xx += 1.5) { g.fillStyle = dark(c, 0.14); g.fillRect(xx, y + 1, 0.5, h - 2); g.fillStyle = light(c, 0.1); g.fillRect(xx + 0.5, y + 1, 0.3, h - 2); }
    g.fillStyle = rgba(lit('#9a5a3a'), 0.35); g.fillRect(x + 6, y + 1, 1, 6); g.fillRect(x + 19, y + 2, 0.8, 9);   // rust streaks
    g.restore();
    /* the door end with lock bars */
    g.fillStyle = dark(c, 0.1); g.fillRect(x + w - 8, y + 0.8, 7.2, h - 1.6);
    for (const bx of [x + w - 6.5, x + w - 3]) { line(g, bx, y + 1.5, bx, y + h - 1.5, pal.steel, 0.35); box(g, bx - 0.5, y + 7, 1, 1.6, pal.steel, 0.2, { lw: 0.25, shade: false }); }
    g.fillStyle = dark(c, 0.3); g.fillRect(x, y + h - 1.1, w, 1.1);
    snowCap(g, x, y, w, 1.4);
  }
  function drawTower(g) {
    const pal = P(), x = 152, on = night() > 0.3 && working();
    shadow(g, x, GROUND_Y + 1.4, 9, 1.1);
    /* trailer base with outriggers */
    line(g, x - 9, GROUND_Y + 0.5, x - 4, GROUND_Y - 3, pal.steel, 0.5); line(g, x + 9, GROUND_Y + 0.5, x + 4, GROUND_Y - 3, pal.steel, 0.5);
    box(g, x - 6, GROUND_Y - 6, 12, 5, pal.fork, 0.8);
    g.fillStyle = pal.tire; g.beginPath(); g.arc(x - 2.5, GROUND_Y - 0.5, 1.4, 0, 6.3); g.arc(x + 2.5, GROUND_Y - 0.5, 1.4, 0, 6.3); g.fill();
    /* the mast */
    box(g, x - 0.7, GROUND_Y - 40, 1.4, 34, pal.steel, 0.3, { lw: 0.3 });
    /* the lamp bank */
    box(g, x - 6, GROUND_Y - 46, 12, 7, pal.fork, 0.6, { lw: 0.35 });
    for (const [lx, ly] of [[x - 5, GROUND_Y - 45.2], [x + 0.4, GROUND_Y - 45.2], [x - 5, GROUND_Y - 42.2], [x + 0.4, GROUND_Y - 42.2]]) {
      box(g, lx, ly, 4.6, 2.4, on ? EMIT.lamp : pal.glassDark, 0.3, { lw: 0.25, shade: false });
      if (!on) { g.fillStyle = rgba(pal.glassHi, 0.5); g.fillRect(lx + 0.5, ly + 0.4, 1.4, 0.4); }
    }
    snowCap(g, x - 6, GROUND_Y - 46, 12, 1);
  }
  function drawRack(g) {
    const pal = P(), y0 = GROUND_Y;
    for (const ux of [269, 290]) {
      box(g, ux - 0.8, y0 - 21, 1.6, 21, dark(pal.steel, 0.05), 0.2, { lw: 0.3 });
      for (const ay of [y0 - 19, y0 - 13, y0 - 7]) box(g, ux - 1.6, ay, 3.2, 0.9, dark(pal.steel, 0.15), 0.2, { lw: 0.25, shade: false });
    }
    /* long boards on the arms */
    for (const [ay, n] of [[y0 - 19, 2], [y0 - 13, 3], [y0 - 7, 2]]) {
      for (let i = 0; i < n; i++) box(g, 265.5 + i * 0.5, ay - 1.25 * (i + 1), 28 - i, 1.2, i % 2 ? pal.timberShade : pal.timber, 0.25, { lw: 0.25 });
    }
    snowCap(g, 265, y0 - 22, 30, 0.9);
  }
  function drawShed(g) {
    const pal = P(), x0 = 291, x1 = 365, gy = GROUND_Y;
    const wall = mix(pal.timberShade, pal.interior, 0.45);
    /* back wall: vertical boards in the shade of the roof */
    box(g, x0 + 2, gy - 17, x1 - x0 - 4, 17, wall, 0.2, { shade: false });
    g.fillStyle = dark(wall, 0.18); for (let x = x0 + 4.5; x < x1 - 2; x += 2.6) g.fillRect(x, gy - 16.5, 0.3, 16.3);
    g.fillStyle = rgba(pal.ink, 0.25); g.fillRect(x0 + 2, gy - 17, x1 - x0 - 4, 2.2);         // the roof's shadow
    /* pegboard with tool silhouettes */
    const pb = mix(pal.timber, pal.white, 0.15);
    box(g, 300, gy - 13.5, 22, 6, pb, 0.3, { lw: 0.3, shade: false });
    g.fillStyle = rgba(pal.ink, 0.25); for (let x = 301; x < 322; x += 1.2) for (let y = gy - 13; y < gy - 8; y += 1.2) g.fillRect(x, y, 0.2, 0.2);
    g.strokeStyle = dark(pal.steel, 0.25); g.lineWidth = 0.45; g.lineCap = 'round';
    g.beginPath(); g.moveTo(302.5, gy - 12.6); g.lineTo(302.5, gy - 9); g.moveTo(301.4, gy - 12.6); g.lineTo(303.6, gy - 12.6); g.stroke();   // hammer
    g.beginPath(); g.moveTo(305.5, gy - 12.8); g.lineTo(309.5, gy - 9.2); g.stroke();                                                       // saw
    g.beginPath(); g.moveTo(312, gy - 12.8); g.lineTo(312, gy - 9); g.lineTo(315, gy - 9); g.stroke();                                    // square
    g.beginPath(); g.arc(318.5, gy - 11, 1.5, 0, 6.3); g.stroke();                                                                         // tape
    /* the workbench along the back */
    box(g, 298, gy - 6.2, 30, 1.4, pal.timber, 0.3, { lw: 0.35 });
    for (const lx of [299.5, 326]) box(g, lx, gy - 4.8, 1, 4.8, pal.timberShade, 0.2, { lw: 0.25, shade: false });
    box(g, 300, gy - 7.6, 3, 1.4, pal.steel, 0.3, { lw: 0.25 });                 // vise
    box(g, 316, gy - 8.2, 4, 2, lit('#d6b13a'), 0.4, { lw: 0.25 });               // a drill case
    /* nail kegs under the bench */
    for (let i = 0; i < Math.min(3, piles.nails); i++) box(g, 332 + i * 3.4, gy - 3.6, 2.8, 3.6, mix(pal.steel, pal.timber, 0.3), 0.6, { lw: 0.3 });
    /* posts at the back corners */
    for (const px of [x0 + 2.5, x1 - 3.5]) box(g, px, gy - 17, 1.4, 17, pal.timberShade, 0.2, { lw: 0.3 });
    /* the roof: fascia and a sliver of the slope */
    g.fillStyle = pal.shedRoof; g.beginPath(); g.moveTo(x0 - 1, gy - 20.2); g.lineTo(x0 + 1, gy - 22.6); g.lineTo(x1 - 1, gy - 22.6); g.lineTo(x1 + 1, gy - 20.2); g.closePath(); g.fill(); ink(g, 0.35);
    box(g, x0 - 1, gy - 20.4, x1 - x0 + 2, 3.2, pal.timber, 0.3);
    g.fillStyle = dark(pal.timber, 0.35); g.fillRect(x0 - 0.5, gy - 17.2, x1 - x0 + 1, 0.8);
    snowCap(g, x0, gy - 22.6, x1 - x0, 1.6);
    /* a work lamp hanging under the roof */
    line(g, 328, gy - 17.2, 328, gy - 14.6, pal.ink, 0.2);
    g.fillStyle = dark(pal.steel, 0.2); g.beginPath(); g.moveTo(326.6, gy - 13.4); g.lineTo(327.4, gy - 14.8); g.lineTo(328.6, gy - 14.8); g.lineTo(329.4, gy - 13.4); g.closePath(); g.fill(); ink(g, 0.25);
    g.fillStyle = night() > 0.3 ? EMIT.lamp : pal.glassDark; g.beginPath(); g.ellipse(328, gy - 13.3, 1, 0.45, 0, 0, 6.3); g.fill();
  }
  function drawMill(g, x0, x1) {
    const pal = P(), gy = GROUND_Y + 2, top = 404, xa = 726, xb = WW + 2;
    const brick = pal.mill, deep = pal.millDark;
    /* the stack, behind the roof */
    if (x1 > 860) {
      const sx = 868, st = 342;
      g.fillStyle = deep; g.beginPath(); g.moveTo(sx, top + 2); g.lineTo(sx + 1, st); g.lineTo(sx + 7, st); g.lineTo(sx + 8, top + 2); g.closePath(); g.fill(); ink(g, 0.4);
      g.fillStyle = rgba(pal.ink, 0.2); g.beginPath(); g.moveTo(sx + 5, top + 2); g.lineTo(sx + 5.4, st); g.lineTo(sx + 7, st); g.lineTo(sx + 8, top + 2); g.fill();
      g.fillStyle = rgba(light(deep, 0.25), 0.5); for (let y = st + 6; y < top; y += 9) g.fillRect(sx + 1, y, 6.4, 0.35);
      box(g, sx - 0.6, st - 2.6, 9.2, 2.8, brick, 0.3, { lw: 0.35 });
      box(g, sx + 0.2, st - 4, 7.6, 1.6, deep, 0.2, { lw: 0.3 });
      if (snowy()) snowCap(g, sx + 0.2, st - 4, 7.6, 0.8);
    }
    /* the sawtooth roof: glazed north lights facing the lake */
    for (let x = xa; x < xb; x += 14) {
      g.fillStyle = pal.roof; g.beginPath(); g.moveTo(x, top); g.lineTo(x, top - 9); g.lineTo(x + 14, top); g.closePath(); g.fill(); ink(g, 0.35);
      g.fillStyle = mix(pal.glass, pal.glassDark, 0.4); g.fillRect(x + 0.4, top - 8.2, 2.2, 8);
      g.fillStyle = rgba(pal.glassHi, 0.5); g.fillRect(x + 0.6, top - 7.6, 0.5, 6.8);
      if (snowy()) { g.fillStyle = pal.snow; g.beginPath(); g.moveTo(x + 0.2, top - 9); g.lineTo(x + 14, top - 0.2); g.lineTo(x + 12, top); g.lineTo(x + 0.2, top - 7.6); g.closePath(); g.fill(); }
    }
    /* the stair tower */
    box(g, 738, top - 14, 16, 16, brick, 0.2);
    g.fillStyle = pal.roof; g.beginPath(); g.moveTo(736.5, top - 14); g.lineTo(746, top - 22); g.lineTo(755.5, top - 14); g.closePath(); g.fill(); ink(g, 0.4);
    for (const wx of [741.5, 747.5]) { box(g, wx, top - 11, 3, 5, pal.glassDark, 0.8, { lw: 0.3, shade: false }); }
    if (snowy()) { g.fillStyle = pal.snow; g.beginPath(); g.moveTo(737.4, top - 14.2); g.lineTo(746, top - 21.4); g.lineTo(754.6, top - 14.2); g.lineTo(746, top - 18); g.closePath(); g.fill(); }
    /* the long brick front */
    box(g, xa, top, xb - xa, gy - top, brick, 0.2, { shade: false });
    g.fillStyle = rgba(deep, 0.35); for (let y = top + 3; y < gy; y += 1.6) g.fillRect(Math.max(xa, x0), y, Math.min(xb, x1) - Math.max(xa, x0), 0.18);
    /* cornice */
    box(g, xa - 0.5, top - 0.2, xb - xa + 1, 2.4, light(brick, 0.12), 0.2, { lw: 0.35 });
    g.fillStyle = deep; for (let x = xa + 1; x < xb; x += 2.2) g.fillRect(x, top + 2.2, 1, 0.9);
    /* pilasters and windows, three floors */
    const rows = [[top + 6, 8.5], [top + 19, 8.5], [top + 33, 10]];
    for (let bx = xa; bx < xb; bx += 17) {
      g.fillStyle = light(brick, 0.08); g.fillRect(bx, top + 3, 2.2, gy - top - 3);
      g.fillStyle = rgba(pal.ink, 0.18); g.fillRect(bx + 2.2, top + 3, 0.5, gy - top - 3);
      for (let ri = 0; ri < rows.length; ri++) {
        const [wy, wh] = rows[ri];
        for (const ox of [5, 11]) {
          const wx = bx + ox, id = hash('mw' + bx + ':' + ri + ':' + ox);
          if (ri === 2 && bx >= 788 && bx < 806) continue;            // the loading door
          const litW = night() > 0.55 && id % 7 < 2;
          windowArch(g, wx, wy, 4, wh, litW ? (id % 2 ? EMIT.winLit : EMIT.winLitDeep) : mix(pal.glassDark, pal.glass, 0.35), litW);
        }
      }
    }
    /* the loading dock and the entrance */
    box(g, 790, gy - 12, 14, 12, mix(pal.steel, brick, 0.2), 0.3);
    g.fillStyle = dark(pal.steel, 0.25); for (let y = gy - 11; y < gy; y += 1.2) g.fillRect(790.6, y, 12.8, 0.25);
    box(g, 787, gy - 1.6, 20, 1.6, pal.concrete, 0.2, { lw: 0.3 });
    box(g, 840, gy - 10, 6, 10, night() > 0.45 ? EMIT.doorLit : pal.door, 0.3, { lw: 0.35, shade: false });
    box(g, 838, gy - 11.6, 10, 1.6, lit('#2f6f5a'), 0.4, { lw: 0.3 });
    /* shrubs along the mill's foot */
    for (let x = 730; x < xb; x += 13) {
      if (x > 784 && x < 810) continue;
      const c = snowy() ? pal.snow : x % 26 ? pal.treeDark : pal.tree;
      for (const [dx, r] of [[0, 2.6], [3, 3.2], [6, 2.4]]) { g.beginPath(); g.arc(x + dx, gy + 1.8 - r * 0.6, r, Math.PI, 0); g.closePath(); g.fillStyle = c; g.fill(); ink(g, 0.3); }
    }
    /* a bike rack with two bikes on the apron */
    for (const [bx, col] of [[762, lit('#2f6fb2')], [769, lit('#d9443a')]]) parkedBike(g, bx, GROUND_Y + 4.5, col);
  }
  function windowArch(g, x, y, w, h, c, glow) {
    const pal = P();
    g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + 1.2); g.quadraticCurveTo(x + w / 2, y - 0.9, x + w, y + 1.2); g.lineTo(x + w, y + h); g.closePath();
    g.fillStyle = c; g.fill();
    if (!glow) { g.save(); g.clip(); g.fillStyle = rgba(pal.glassHi, 0.35); g.fillRect(x + 0.5, y, 0.6, h); g.restore(); }
    g.strokeStyle = rgba(pal.ink, 0.55); g.lineWidth = 0.18; g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2, y + h); g.moveTo(x, y + h * 0.5); g.lineTo(x + w, y + h * 0.5); g.stroke();
    g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + 1.2); g.quadraticCurveTo(x + w / 2, y - 0.9, x + w, y + 1.2); g.lineTo(x + w, y + h); ink(g, 0.3);
    g.fillStyle = pal.coping; g.fillRect(x - 0.4, y + h, w + 0.8, 0.7);
    g.fillStyle = dark(pal.mill, 0.25); g.beginPath(); g.moveTo(x - 0.3, y + 1.2); g.quadraticCurveTo(x + w / 2, y - 1.4, x + w + 0.3, y + 1.2); g.lineTo(x + w, y + 1.2); g.quadraticCurveTo(x + w / 2, y - 0.9, x, y + 1.2); g.fill();
  }
  function parkedBike(g, x, y, col) {
    const pal = P();
    g.strokeStyle = pal.ink; g.lineWidth = 0.35;
    g.beginPath(); g.arc(x - 2.3, y - 1.6, 1.6, 0, 6.3); g.moveTo(x + 3.9, y - 1.6); g.arc(x + 2.3, y - 1.6, 1.6, 0, 6.3); g.stroke();
    g.strokeStyle = col; g.lineWidth = 0.5;
    g.beginPath(); g.moveTo(x - 2.3, y - 1.6); g.lineTo(x - 0.4, y - 3.6); g.lineTo(x + 1.6, y - 3.6); g.lineTo(x + 2.3, y - 1.6); g.moveTo(x - 0.4, y - 3.6); g.lineTo(x + 0.3, y - 1.6); g.lineTo(x - 2.3, y - 1.6); g.stroke();
    line(g, x - 0.7, y - 4.4, x + 0.3, y - 4.4, pal.ink, 0.45); line(g, x + 1.6, y - 3.6, x + 1.8, y - 4.6, pal.ink, 0.35);
  }

  /* -------------------------------------------- yard furniture (sorted) */
  function drawTrailer(g) {
    const pal = P(), x = 178, w = 36, base = 461, h = 18, top = base - 2 - h;
    const lamp = night() > 0.3, open = !!K.S.whistle;
    shadow(g, x + w / 2, base + 0.4, w / 2 + 2, 1.5);
    /* blocks and skirting */
    box(g, x + 1.5, base - 2.4, w - 3, 2.4, dark(pal.trailerShade, 0.18), 0.3, { shade: false, lw: 0.3 });
    /* the body: horizontal siding */
    box(g, x, top, w, h, pal.trailer, 1.1);
    g.save(); rr(g, x, top, w, h, 1.1); g.clip();
    g.fillStyle = rgba(pal.trailerShade, 0.8); for (let y = top + 2; y < top + h; y += 2) g.fillRect(x, y, w, 0.3);
    g.fillStyle = rgba(pal.ink, 0.12); g.fillRect(x + w - 3, top, 3, h);
    g.fillStyle = lit('#2f6fb2'); g.fillRect(x, top + h - 3.2, w, 0.9);               // a blue stripe along the bottom
    g.restore(); rr(g, x, top, w, h, 1.1); ink(g, 0.45);
    box(g, x - 0.5, top - 1, w + 1, 1.6, pal.trailerTrim, 0.8, { lw: 0.35 });
    /* an air conditioner on the roof */
    box(g, x + 5, top - 3.6, 7, 2.8, light(pal.steel, 0.2), 0.5, { lw: 0.35 });
    g.fillStyle = dark(pal.steel, 0.2); for (let xx = x + 5.8; xx < x + 11.5; xx += 0.9) g.fillRect(xx, top - 3, 0.25, 1.6);
    snowCap(g, x - 0.5, top - 1, w + 1, 1.4); snowCap(g, x + 5, top - 3.6, 7, 0.9);
    /* windows: glass by day, lamplight behind blinds at night */
    for (const [wx, ww] of [[x + 3.5, 9], [x + 15, 6.5]]) {
      box(g, wx - 0.6, top + 3.4, ww + 1.2, 6.4, pal.trailerTrim, 0.4, { lw: 0.3, shade: false });
      box(g, wx, top + 4, ww, 5.2, lamp ? EMIT.winLit : mix(pal.glass, pal.glassDark, 0.2), 0.25, { lw: 0.25, shade: false });
      g.fillStyle = lamp ? rgba(EMIT.winLitDeep, 0.7) : rgba(pal.glassHi, 0.55);
      if (lamp) for (let y = top + 4.6; y < top + 9; y += 1) g.fillRect(wx + 0.2, y, ww - 0.4, 0.3);
      else { g.beginPath(); g.moveTo(wx + 1, top + 9.2); g.lineTo(wx + 3.2, top + 4); g.lineTo(wx + 4.4, top + 4); g.lineTo(wx + 2.2, top + 9.2); g.fill(); }
    }
    /* the door, by the steps; open while the foreman whistles */
    const dx = x + w - 9.5, dt = top + 2.6, dh = h - 3;
    if (open) {
      box(g, dx, dt, 6.5, dh, lamp ? EMIT.doorLit : mix(pal.interior, pal.trailer, 0.2), 0.3, { lw: 0.35, shade: false });
      box(g, dx + 5.6, dt - 0.2, 2, dh + 0.2, pal.door, 0.3, { lw: 0.3 });
    } else {
      box(g, dx, dt, 6.5, dh, pal.door, 0.4);
      box(g, dx + 1.4, dt + 1.6, 3.6, 3, lamp ? EMIT.winLitDeep : mix(pal.glass, pal.glassDark, 0.2), 0.3, { lw: 0.25, shade: false });
      g.fillStyle = pal.steel; g.beginPath(); g.arc(dx + 5.4, dt + dh * 0.55, 0.45, 0, 6.3); g.fill();
    }
    /* a porch light over the door */
    box(g, dx + 2.4, dt - 2, 1.8, 1.2, lamp ? EMIT.lamp : pal.steel, 0.4, { lw: 0.25, shade: false });
    /* metal steps down to the yard, with a rail */
    const sx = dx - 1.2;
    for (let i = 0; i < 3; i++) {
      const ty = base - 1 + i * 2.2, tx = sx - i * 0.4, tw = 8.8 + i * 0.8;
      box(g, tx, ty, tw, 1.2, light(pal.steel, 0.1), 0.2, { lw: 0.3 });
      g.fillStyle = rgba(pal.ink, 0.18); g.fillRect(tx + 0.3, ty + 1.2, tw - 0.6, 1);
    }
    line(g, sx + 9.6, base - 6, sx + 10.4, base + 5.4, dark(pal.steel, 0.2), 0.45);
    line(g, sx + 9.6, base - 6, sx + 7.5, base - 6, dark(pal.steel, 0.2), 0.45);
    if (snowy()) for (let i = 0; i < 3; i++) snowCap(g, sx - i * 0.4, base - 1 + i * 2.2, 8.8 + i * 0.8, 0.6);
  }
  function drawCanteen(g) {
    const pal = P(), x0 = 219, x1 = 263, top = 439.5, vb = 448.6;
    const blue = pal.awning, white = pal.awningStripe;
    /* back legs */
    for (const lx of [x0 + 1.5, x1 - 1.5]) line(g, lx, vb, lx, 457, dark(pal.steel, 0.25), 0.55);
    /* the canopy roof: a shallow pyramid seen from the front, then the scalloped valance */
    g.beginPath(); g.moveTo(x0 - 1, vb - 3.4); g.lineTo(x0 + 9, top - 2.6); g.lineTo(x1 - 9, top - 2.6); g.lineTo(x1 + 1, vb - 3.4); g.closePath();
    g.fillStyle = white; g.fill();
    g.save(); g.clip();
    for (let x = x0 - 2, i = 0; x < x1 + 2; x += 4.4, i++) if (i % 2 === 0) { g.fillStyle = blue; g.beginPath(); g.moveTo(x, vb - 3.4); g.lineTo(x + 4.4, vb - 3.4); g.lineTo(241 + (x + 4.4 - 241) * 0.62, top - 2.6); g.lineTo(241 + (x - 241) * 0.62, top - 2.6); g.closePath(); g.fill(); }
    g.fillStyle = rgba(pal.white, 0.25); g.fillRect(x0, top - 2.6, x1 - x0, 1.2);
    g.restore();
    g.beginPath(); g.moveTo(x0 - 1, vb - 3.4); g.lineTo(x0 + 9, top - 2.6); g.lineTo(x1 - 9, top - 2.6); g.lineTo(x1 + 1, vb - 3.4); g.closePath(); ink(g, 0.4);
    if (snowy()) { g.fillStyle = pal.snow; g.beginPath(); g.moveTo(x0 + 0.5, vb - 3.6); g.lineTo(x0 + 9.4, top - 2.8); g.lineTo(x1 - 9.4, top - 2.8); g.lineTo(x1 - 0.5, vb - 3.6); g.lineTo(x1 - 6, vb - 5.2); g.lineTo(x0 + 6, vb - 5.2); g.closePath(); g.fill(); }
    /* valance: stripes with scallops */
    const n = 10, sw = (x1 - x0 + 2) / n;
    for (let i = 0; i < n; i++) {
      const sx = x0 - 1 + i * sw;
      g.beginPath(); g.moveTo(sx, vb - 3.4); g.lineTo(sx + sw, vb - 3.4); g.lineTo(sx + sw, vb - 0.6); g.quadraticCurveTo(sx + sw / 2, vb + 1.4, sx, vb - 0.6); g.closePath();
      g.fillStyle = i % 2 ? white : blue; g.fill();
    }
    g.fillStyle = rgba(pal.ink, 0.12); g.fillRect(x0 - 1, vb - 1.6, x1 - x0 + 2, 0.6);
    g.beginPath(); g.moveTo(x0 - 1, vb - 3.4); g.lineTo(x1 + 1, vb - 3.4); g.lineTo(x1 + 1, vb - 0.6);
    for (let i = n - 1; i >= 0; i--) { const sx = x0 - 1 + i * sw; g.quadraticCurveTo(sx + sw / 2, vb + 1.4, sx, vb - 0.6); }
    g.closePath(); ink(g, 0.4);
    /* string lights under the valance */
    g.strokeStyle = rgba(pal.ink, 0.6); g.lineWidth = 0.18;
    g.beginPath(); for (let x = x0 + 1; x <= x1 - 1; x += 0.5) { const k = ((x - x0 - 1) % 10.5) / 10.5; const y = vb + 1.6 + Math.sin(k * Math.PI) * 1.6; if (x === x0 + 1) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke();
    const on = night() > 0.3;
    const bulbs = [EMIT.lamp, EMIT.candle, lit('#ff8a6a'), EMIT.winLit];
    for (let i = 0, x = x0 + 2; x < x1 - 1; x += 2.6, i++) {
      const k = ((x - x0 - 1) % 10.5) / 10.5, y = vb + 2.1 + Math.sin(k * Math.PI) * 1.6;
      g.fillStyle = on ? bulbs[i % 4] : mix(pal.white, pal.steel, 0.4); g.beginPath(); g.ellipse(x, y, 0.42, 0.55, 0, 0, 6.3); g.fill();
    }
    /* front legs with feet */
    for (const lx of [x0, x1]) { line(g, lx, vb - 1, lx, 472, dark(pal.steel, 0.1), 0.6); box(g, lx - 1, 471.4, 2, 0.8, pal.steel, 0.2, { lw: 0.25, shade: false }); }
  }
  function drawUrn(g) {
    const pal = P(), y0 = 466;
    shadow(g, 229, y0 + 0.2, 8, 0.9);
    /* folding table */
    box(g, 221.5, y0 - 6.8, 14, 1.2, light(pal.trailer, 0.1), 0.3, { lw: 0.35 });
    line(g, 223, y0 - 5.6, 224.5, y0, dark(pal.steel, 0.2), 0.4); line(g, 224.5, y0 - 5.6, 223, y0, dark(pal.steel, 0.2), 0.4);
    line(g, 232.5, y0 - 5.6, 234, y0, dark(pal.steel, 0.2), 0.4); line(g, 234, y0 - 5.6, 232.5, y0, dark(pal.steel, 0.2), 0.4);
    /* the urn: a steel cylinder with a spigot */
    const ux = 225.4, uy = y0 - 16;
    box(g, ux, uy, 5.4, 9.2, light(pal.steel, 0.15), 1, { split: 0.62, shadeK: 0.22 });
    g.fillStyle = rgba(pal.white, 0.5); g.fillRect(ux + 1, uy + 1, 0.6, 7);
    box(g, ux + 0.4, uy - 1.2, 4.6, 1.4, dark(pal.steel, 0.1), 0.6, { lw: 0.3 });
    g.fillStyle = pal.ink; g.beginPath(); g.arc(ux + 2.7, uy - 1.6, 0.5, 0, 6.3); g.fill();
    box(g, ux + 2, uy + 7.2, 2.2, 1, pal.ink, 0.3, { lw: 0.2, shade: false });
    box(g, ux + 1.6, uy + 3, 2.2, 1.4, lit('#d9443a'), 0.3, { lw: 0.2, shade: false });     // a red label
    /* a stack of cups and a box of donuts */
    for (let i = 0; i < 3; i++) box(g, 231.4, y0 - 8.4 - i * 0.9, 2.2, 1.5, pal.white, 0.3, { lw: 0.22, shade: false });
    box(g, 233.6, y0 - 8.6, 2.2, 1.8, lit('#f0a8b8'), 0.3, { lw: 0.22 });
    snowCap(g, 221.5, y0 - 6.8, 14, 0.5);
  }
  function drawPicnic(g) {
    const pal = P(), t0 = 235.5, t1 = 256.5;
    const wood = mix(pal.timber, pal.timberShade, 0.25);
    shadow(g, 246, 474.4, 13, 1.3);
    /* the far bench, peeking out */
    box(g, t0 + 1, 462.6, t1 - t0 - 2, 1.4, dark(wood, 0.2), 0.3, { lw: 0.3, shade: false });
    /* A-frame legs */
    for (const lx of [239.5, 252.5]) { line(g, lx - 2, 474, lx + 1.5, 468, dark(wood, 0.25), 0.9); line(g, lx + 2, 474, lx - 1.5, 468, dark(wood, 0.25), 0.9); }
    /* the top: plank surface seen from above, then its front edge */
    box(g, t0, 464.3, t1 - t0, 3.2, light(wood, 0.12), 0.4, { lw: 0.35, shade: false });
    g.fillStyle = rgba(pal.ink, 0.18); g.fillRect(t0 + 0.3, 465.3, t1 - t0 - 0.6, 0.18); g.fillRect(t0 + 0.3, 466.3, t1 - t0 - 0.6, 0.18);
    box(g, t0, 467.5, t1 - t0, 1.2, dark(wood, 0.12), 0.25, { lw: 0.35, shade: false });
    /* the near bench */
    box(g, t0 - 2, 470.3, t1 - t0 + 4, 1.6, light(wood, 0.08), 0.35, { lw: 0.35, shade: false });
    box(g, t0 - 2, 471.9, t1 - t0 + 4, 0.9, dark(wood, 0.15), 0.2, { lw: 0.3, shade: false });
    snowCap(g, t0, 464.3, t1 - t0, 0.9); snowCap(g, t0 - 2, 470.3, t1 - t0 + 4, 0.6);
  }
  function drawLumber(g) {
    const pal = P(), n = piles.lumber, x0 = 268.5, w = 23.5, y0 = 470.6;
    shadow(g, x0 + w / 2, y0 + 0.2, w / 2 + 2, 1.1);
    for (const dx of [x0 + 3, x0 + w - 5]) box(g, dx, y0 - 1.6, 2, 1.6, dark(pal.timberShade, 0.2), 0.2, { lw: 0.3, shade: false });
    let y = y0 - 1.6;
    for (let i = 0; i < n; i++) {
      const lh = 2.6, off = (i % 2) * 0.6;
      y -= lh;
      box(g, x0 + off, y, w - off, lh, i % 2 ? pal.timberShade : pal.timber, 0.3, { lw: 0.35 });
      g.fillStyle = rgba(pal.ink, 0.2); g.fillRect(x0 + off + 6, y + 0.3, 0.2, lh - 0.6); g.fillRect(x0 + off + 14, y + 0.3, 0.2, lh - 0.6);
      /* end grain on the near end */
      box(g, x0 + off, y, 2.4, lh, light(pal.timber, 0.25), 0.3, { lw: 0.3, shade: false });
      g.strokeStyle = rgba(pal.timberDark, 0.6); g.lineWidth = 0.15; g.beginPath(); g.arc(x0 + off + 1.2, y + lh / 2, 0.6, 0, 6.3); g.stroke();
      if (i === n - 1 || i === 1) { g.fillStyle = dark(pal.steel, 0.1); g.fillRect(x0 + off + 9, y, 0.5, lh); g.fillRect(x0 + off + 17, y, 0.5, lh); }
    }
    if (!n) { g.fillStyle = rgba(pal.timberDark, 0.5); g.fillRect(x0 + 6, y0 - 2, 0.8, 0.3); g.fillRect(x0 + 12, y0 - 2.4, 1.6, 0.3); }
    snowCap(g, x0, y, w, 1);
    if (tarp.lumber > 0.02) tarpOver(g, x0 - 0.8, y, w + 1.6, y0 - y - 1.2, tarp.lumber);
  }
  function tarpOver(g, x, y, w, h, k) {
    const pal = P(), c = lit('#3d7bd9');
    const top = y - 1, bot = y + h * k + 0.6;
    g.beginPath(); g.moveTo(x, bot); g.lineTo(x - 0.4, top + 1.4); g.quadraticCurveTo(x + w * 0.5, top - 1.4, x + w + 0.4, top + 1.4); g.lineTo(x + w, bot);
    for (let i = 4; i >= 0; i--) g.quadraticCurveTo(x + w * (i + 0.5) / 5, bot + 0.9, x + w * i / 5, bot);
    g.closePath(); g.fillStyle = c; g.fill();
    g.save(); g.clip();
    g.fillStyle = rgba(pal.ink, 0.16); for (let i = 1; i < 5; i++) g.fillRect(x + w * i / 5 - 0.3, top + 1, 0.6, h + 3);
    g.fillStyle = rgba(pal.white, 0.25); g.fillRect(x, top, w, 1.2);
    g.restore();
    g.beginPath(); g.moveTo(x, bot); g.lineTo(x - 0.4, top + 1.4); g.quadraticCurveTo(x + w * 0.5, top - 1.4, x + w + 0.4, top + 1.4); g.lineTo(x + w, bot);
    for (let i = 4; i >= 0; i--) g.quadraticCurveTo(x + w * (i + 0.5) / 5, bot + 0.9, x + w * i / 5, bot);
    g.closePath(); ink(g, 0.4);
    if (k > 0.9) for (const gx of [x + 1, x + w - 1]) { g.fillStyle = lit('#f2efe6'); g.beginPath(); g.arc(gx, bot - 0.6, 0.35, 0, 6.3); g.fill(); }
  }
  function drawPanels(g) {
    const pal = P(), n = piles.panels, cx = 348.5, y0 = 471;
    shadow(g, cx, y0 + 0.2, 9, 1);
    /* the A-frame */
    box(g, cx - 7.5, y0 - 1.2, 15, 1.2, dark(pal.timberShade, 0.15), 0.2, { lw: 0.3, shade: false });
    line(g, cx - 1.6, y0 - 1, cx, y0 - 16, pal.timberDark, 0.7); line(g, cx + 1.6, y0 - 1, cx, y0 - 16, pal.timberDark, 0.7);
    /* CLT panels leaning on both sides: layered edges */
    const lean = (side, i) => {
      const bx = cx + side * (2 + i * 1.5), tx = cx + side * (0.6 + i * 1.5);
      g.beginPath(); g.moveTo(bx, y0 - 1.2); g.lineTo(tx, y0 - 15.4 + i * 0.6); g.lineTo(tx + side * 1.4, y0 - 15.4 + i * 0.6); g.lineTo(bx + side * 1.4, y0 - 1.2); g.closePath();
      g.fillStyle = i % 2 ? pal.timber : light(pal.timber, 0.1); g.fill(); ink(g, 0.3);
      g.strokeStyle = rgba(pal.timberDark, 0.55); g.lineWidth = 0.15;
      g.beginPath(); g.moveTo(bx + side * 0.47, y0 - 1.3); g.lineTo(tx + side * 0.47, y0 - 15.2 + i * 0.6); g.moveTo(bx + side * 0.93, y0 - 1.3); g.lineTo(tx + side * 0.93, y0 - 15.2 + i * 0.6); g.stroke();
    };
    for (let i = 0; i < n; i++) lean(i % 2 ? 1 : -1, i >> 1);
    /* a wide face panel on the left so the stack reads */
    if (n >= 3) { box(g, cx - 9.2, y0 - 12.5, 4.6, 11.3, light(pal.timber, 0.18), 0.3, { lw: 0.35 }); g.fillStyle = rgba(pal.timberDark, 0.3); for (let k = 1; k < 4; k++) g.fillRect(cx - 9 + k * 1.1, y0 - 12.2, 0.15, 10.8); }
    if (tarp.panels > 0.02) tarpOver(g, cx - 10, y0 - 16.4, 20, 14.6, tarp.panels);
  }
  function drawNails(g) {
    const pal = P(), n = piles.nails, x = 156.5, y0 = 479;
    shadow(g, x + 6, y0 + 0.2, 7, 0.8);
    box(g, x, y0 - 1.2, 12, 1.2, pal.pallet, 0.2, { lw: 0.3, shade: false });
    const card = mix(pal.timber, pal.white, 0.25);
    for (let i = 0; i < n; i++) {
      const bx = x + 0.5 + (i % 3) * 3.8, by = y0 - 1.2 - 3 - Math.floor(i / 3) * 3;
      box(g, bx, by, 3.6, 3, card, 0.25, { lw: 0.3 });
      g.fillStyle = lit('#c84a3a'); g.fillRect(bx + 0.7, by + 1, 2.2, 0.6);
    }
  }
  function drawGlass(g) {
    const pal = P(), n = piles.glass, cx = 112, y0 = 470.8;
    shadow(g, cx, y0 + 0.2, 8, 0.9);
    box(g, cx - 7, y0 - 1.3, 14, 1.3, pal.timberShade, 0.2, { lw: 0.3, shade: false });
    const pane = (side, i) => {
      const bx = cx + side * (2.2 + i * 1.6), tx = cx + side * (0.8 + i * 1.6), ty = y0 - 13.6 + i * 1.2;
      g.beginPath(); g.moveTo(bx, y0 - 1.3); g.lineTo(tx, ty); g.lineTo(tx + side * 0.7, ty); g.lineTo(bx + side * 0.7, y0 - 1.3); g.closePath();
      g.fillStyle = rgba(pal.glass, 0.75); g.fill(); g.strokeStyle = rgba(pal.ink, 0.7); g.lineWidth = 0.25; g.stroke();
    };
    for (let i = 0; i < n; i++) pane(i % 2 ? 1 : -1, i >> 1);
    line(g, cx - 1.8, y0 - 1.2, cx, y0 - 14.5, pal.timberDark, 0.7); line(g, cx + 1.8, y0 - 1.2, cx, y0 - 14.5, pal.timberDark, 0.7);
    /* the face of the front pane, with a glint */
    if (n) {
      g.beginPath(); g.moveTo(cx - 9, y0 - 1.4); g.lineTo(cx - 3.6, y0 - 1.4); g.lineTo(cx - 2.4, y0 - 12); g.lineTo(cx - 7.4, y0 - 12); g.closePath();
      g.fillStyle = rgba(mix(pal.glass, pal.glassHi, 0.35), 0.72); g.fill(); g.strokeStyle = rgba(pal.ink, 0.75); g.lineWidth = 0.3; g.stroke();
      g.fillStyle = rgba(pal.white, 0.55); g.beginPath(); g.moveTo(cx - 7.2, y0 - 3); g.lineTo(cx - 6, y0 - 10.5); g.lineTo(cx - 5.2, y0 - 10.5); g.lineTo(cx - 6.4, y0 - 3); g.fill();
      box(g, cx - 9.4, y0 - 6.6, 1.2, 0.8, lit('#d9443a'), 0.2, { lw: 0.2, shade: false });    // a red sticker
    }
  }
  function drawRebar(g) {
    const pal = P(), n = piles.rebar, x = 139, w = 24, y0 = 471;
    shadow(g, x + w / 2, y0 + 0.2, w / 2 + 1, 0.9);
    for (const dx of [x + 3, x + w - 5]) box(g, dx, y0 - 1.4, 2.2, 1.4, dark(pal.timberShade, 0.2), 0.2, { lw: 0.3, shade: false });
    let y = y0 - 1.4;
    for (let i = 0; i < n; i++) {
      y -= 1.8;
      for (let k = 0; k < 3; k++) { line(g, x + (k % 2) * 0.5, y + 0.4 + k * 0.5, x + w - (k % 2), y + 0.4 + k * 0.5, k % 2 ? dark(pal.rebar, 0.15) : pal.rebar, 0.5); }
      for (const tx of [x + 6, x + w - 7]) { g.fillStyle = dark(pal.steel, 0.25); g.fillRect(tx, y + 0.1, 0.5, 1.6); }
    }
    snowCap(g, x, y + 0.2, w, 0.7);
  }
  function drawBricks(g) {
    const pal = P(), n = piles.brick, y0 = 471;
    shadow(g, 375, y0 + 0.2, 11, 1);
    for (const px of [364.5, 375.5]) { box(g, px, y0 - 1.2, 10, 1.2, pal.pallet, 0.2, { lw: 0.3, shade: false }); g.fillStyle = rgba(pal.ink, 0.35); g.fillRect(px + 2, y0 - 0.9, 1.2, 0.8); g.fillRect(px + 6.8, y0 - 0.9, 1.2, 0.8); }
    const slots = [[365, 0], [376, 0], [365, 1], [376, 1], [370.5, 2]];
    let topY = y0 - 1.2;
    for (let i = 0; i < Math.min(n, 5); i++) {
      const [bx, row] = slots[i], by = y0 - 1.2 - (row + 1) * 5.4;
      cube(g, bx, by, 9, 5.4); topY = Math.min(topY, by);
    }
    if (!n) { g.fillStyle = rgba(pal.brick, 0.7); g.fillRect(368, y0 - 1.9, 1.8, 0.7); g.fillRect(379, y0 - 1.9, 1.8, 0.7); }
    snowCap(g, 365, topY, 20, 0.9);
    if (tarp.brick > 0.02) tarpOver(g, 364, topY, 22, y0 - topY - 1.2, tarp.brick);
  }
  function cube(g, x, y, w, h) {
    const pal = P();
    box(g, x, y, w, h, pal.brick, 0.3, { lw: 0.35 });
    g.save(); rr(g, x, y, w, h, 0.3); g.clip();
    g.fillStyle = rgba(pal.mortar, 0.75);
    for (let r = 0, yy = y + 1.1; yy < y + h; yy += 1.1, r++) { g.fillRect(x, yy, w, 0.2); for (let xx = x + (r % 2 ? 1.1 : 0) + 2.2; xx < x + w; xx += 2.2) g.fillRect(xx, yy - 1.1, 0.2, 1.1); }
    g.fillStyle = rgba(pal.white, 0.22); g.fillRect(x + 0.6, y + 0.5, 0.7, h - 1);           // the shrink-wrap's shine
    g.restore();
    g.fillStyle = light(pal.white, 0.1); g.fillRect(x + w * 0.3, y, 0.35, h); g.fillRect(x + w * 0.7, y, 0.35, h);   // strapping
  }
  function drawSand(g) {
    const pal = P(), sand = mix(pal.dirt, lit('#e3c891'), 0.6), y0 = 459.5;
    shadow(g, 392, y0 + 0.2, 9, 0.9);
    g.beginPath(); g.moveTo(383.5, y0); g.bezierCurveTo(386, y0 - 8, 397, y0 - 9, 401, y0); g.closePath();
    g.fillStyle = snowy() ? pal.snow : sand; g.fill();
    g.save(); g.clip(); g.fillStyle = rgba(pal.ink, 0.13); g.beginPath(); g.ellipse(398, y0 - 1, 5, 6, -0.4, 0, 6.3); g.fill(); g.fillStyle = rgba(pal.white, 0.3); g.beginPath(); g.ellipse(388, y0 - 5, 3, 1.4, -0.4, 0, 6.3); g.fill(); g.restore();
    g.beginPath(); g.moveTo(383.5, y0); g.bezierCurveTo(386, y0 - 8, 397, y0 - 9, 401, y0); ink(g, 0.35);
    /* a shovel stuck in it */
    line(g, 394.5, y0 - 6, 397.5, y0 - 13, pal.timberShade, 0.55);
    line(g, 396.8, y0 - 13.2, 398.4, y0 - 12.6, pal.ink, 0.5);
    /* cement bags */
    const bag = mix(pal.white, pal.timber, 0.25);
    for (const [bx, by] of [[386.4, 462.2], [390.6, 462.2], [388.5, 460.5]]) { rr(g, bx - 2, by - 1.7, 4, 1.7, 0.7); g.fillStyle = bag; g.fill(); ink(g, 0.3); g.fillStyle = rgba(lit('#3d7bd9'), 0.7); g.fillRect(bx - 0.6, by - 1.3, 1.2, 0.8); }
  }
  const shedOpen = () => working() && !(night() > 0.8 && !K.S.crew.length);
  function drawToolshed(g) {
    const pal = P(), x = 556, w = 20, base = 462, h = 17, top = base - h;
    const open = shedOpen();
    shadow(g, x + w / 2, base + 0.3, w / 2 + 2, 1.2);
    box(g, x, top, w, h, pal.shed, 0.4);
    g.save(); rr(g, x, top, w, h, 0.4); g.clip(); g.fillStyle = rgba(pal.ink, 0.12); for (let xx = x + 1; xx < x + w; xx += 1.4) g.fillRect(xx, top, 0.3, h); g.restore();
    /* roof */
    g.beginPath(); g.moveTo(x - 1.2, top + 0.6); g.lineTo(x + 2, top - 2.6); g.lineTo(x + w - 2, top - 2.6); g.lineTo(x + w + 1.2, top + 0.6); g.closePath(); g.fillStyle = pal.shedRoof; g.fill(); ink(g, 0.4);
    if (snowy()) snowCap(g, x + 1, top - 2.6, w - 2, 1.2);
    /* doors */
    const dx = x + 4, dw = 12, dh = h - 2.4;
    if (open) {
      box(g, dx, base - dh, dw, dh, pal.interior, 0.2, { shade: false, lw: 0.35 });
      /* shelves, a hard hat, spools and a level */
      g.fillStyle = dark(pal.timberShade, 0.3); g.fillRect(dx + 0.5, base - dh + 4.4, dw - 1, 0.5); g.fillRect(dx + 0.5, base - dh + 9.2, dw - 1, 0.5);
      g.fillStyle = lit('#f2c230'); g.beginPath(); g.arc(dx + 3, base - dh + 4.3, 1.4, Math.PI, 0); g.fill();
      g.fillStyle = pal.copper; g.fillRect(dx + 6.6, base - dh + 2.4, 2, 2); g.fillRect(dx + 9, base - dh + 2.6, 1.6, 1.8);
      g.fillStyle = lit('#3fae5a'); g.fillRect(dx + 1.4, base - dh + 8.2, 6, 1);
      line(g, dx + 9.8, base - 0.6, dx + 10.6, base - dh + 10.4, pal.timberShade, 0.5);     // a shovel handle
      g.fillStyle = dark(pal.steel, 0.2); g.fillRect(dx + 9.2, base - 2, 1.8, 1.6);
      /* doors swung open */
      box(g, dx - 2.6, base - dh, 2.6, dh, light(pal.shed, 0.08), 0.2, { lw: 0.35 });
      box(g, dx + dw, base - dh, 2.6, dh, dark(pal.shed, 0.08), 0.2, { lw: 0.35 });
    } else {
      box(g, dx, base - dh, dw / 2, dh, light(pal.shed, 0.05), 0.2, { lw: 0.35 });
      box(g, dx + dw / 2, base - dh, dw / 2, dh, light(pal.shed, 0.05), 0.2, { lw: 0.35 });
      box(g, dx + dw / 2 - 0.8, base - dh * 0.55, 1.6, 2, pal.steel, 0.3, { lw: 0.25 });
    }
  }
  function drawStakes(g) {
    const pal = P(), n = piles.stakes, x = 553.6, y0 = 466;
    shadow(g, x + 0.5, y0 + 0.2, 2.6, 0.6, 0.15);
    for (let i = 0; i < n * 2; i++) {
      const bx = x - 1.4 + i * 0.6, tx = bx + 1.6;
      line(g, bx, y0, tx, y0 - 9.5 + (i % 3) * 0.6, pal.timber, 0.55);
      g.fillStyle = pal.netting; g.fillRect(tx - 0.35, y0 - 9.5 + (i % 3) * 0.6, 0.7, 1);
    }
  }
  function drawSpools(g) {
    const pal = P(), n = piles.copper, x = 578, y0 = 467;
    shadow(g, x + 5.5, y0 + 0.2, 6.5, 0.8);
    box(g, x, y0 - 1, 11.5, 1, dark(pal.steel, 0.2), 0.2, { lw: 0.3, shade: false });
    const slots = [[x + 2, y0 - 1], [x + 5.8, y0 - 1], [x + 9.6, y0 - 1], [x + 3.9, y0 - 4.8], [x + 7.7, y0 - 4.8]];
    for (let i = 0; i < Math.min(5, n); i++) {
      const [sx, sy] = slots[i];
      box(g, sx - 1.8, sy - 3.8, 3.6, 3.8, pal.timberShade, 1.6, { lw: 0.3, shade: false });
      box(g, sx - 1.1, sy - 3.1, 2.2, 2.4, pal.copper, 0.8, { lw: 0.25 });
      g.fillStyle = rgba(pal.white, 0.35); g.fillRect(sx - 0.7, sy - 2.7, 0.4, 1.6);
    }
  }
  function drawJohn(g) {
    const pal = P(), x = 590.5, w = 11, base = 463, top = base - 18;
    shadow(g, x + w / 2, base + 0.3, w / 2 + 1.2, 1);
    box(g, x, top + 1.4, w, base - top - 1.4, pal.john, 0.4);
    g.beginPath(); g.moveTo(x - 0.4, top + 1.8); g.quadraticCurveTo(x + w / 2, top - 1.2, x + w + 0.4, top + 1.8); g.closePath(); g.fillStyle = light(pal.white, 0.05); g.fill(); ink(g, 0.35);
    snowCap(g, x + 0.5, top + 0.4, w - 1, 1);
    box(g, x + 1.6, top + 3.2, w - 3.2, base - top - 4, light(pal.john, 0.08), 0.3, { lw: 0.3 });
    g.fillStyle = dark(pal.john, 0.4); g.beginPath(); g.arc(x + w / 2, top + 5.4, 1, 0.5, 5.2); g.arc(x + w / 2 + 0.5, top + 5.2, 0.8, 4.9, 0.8, true); g.fill();   // the moon
    box(g, x + w - 3.4, top + 9.5, 0.9, 2.2, pal.steel, 0.3, { lw: 0.2, shade: false });
    box(g, x + w - 3.6, top + 7.4, 1.2, 0.8, lit('#3fae5a'), 0.2, { lw: 0.15, shade: false });
    g.fillStyle = dark(pal.john, 0.3); for (let i = 0; i < 3; i++) g.fillRect(x + 1, top + 2.6 + i * 0.7, 0.4, 0.3);
  }
  function drawDumpster(g) {
    const pal = P(), x0 = 605, x1 = 628, y0 = 470, top = 461.2;
    shadow(g, (x0 + x1) / 2, y0 + 0.3, 13, 1.1);
    /* offcuts sticking out */
    line(g, 609, top + 1, 607.5, top - 4.5, pal.timber, 1.1); line(g, 613, top + 1, 616, top - 3.4, pal.timberShade, 1.4);
    line(g, 620, top + 1, 623.5, top - 5.5, dark(pal.rebar, 0.1), 0.45); line(g, 623.5, top - 5.5, 625, top - 5, dark(pal.rebar, 0.1), 0.45);
    box(g, 616.8, top - 2.4, 4.4, 2.6, mix(pal.timber, pal.white, 0.2), 0.2, { lw: 0.3 });
    const body = () => { g.beginPath(); g.moveTo(x0 - 1, top); g.lineTo(x1 + 1, top); g.lineTo(x1 - 0.6, y0 - 1.2); g.lineTo(x0 + 0.6, y0 - 1.2); g.closePath(); };
    body(); g.fillStyle = pal.dumpster; g.fill();
    g.save(); g.clip(); g.fillStyle = rgba(pal.ink, 0.18); for (let x = x0 + 3; x < x1; x += 4) g.fillRect(x, top, 0.8, 9); g.fillStyle = rgba(pal.white, 0.2); g.fillRect(x0 - 1, top, x1 - x0 + 2, 0.7); g.fillStyle = rgba(lit('#9a5a3a'), 0.35); g.fillRect(x0 + 6, top + 3, 3, 5); g.restore();
    body(); ink(g, 0.4);
    box(g, x0 - 1.4, top - 0.6, x1 - x0 + 2.8, 1.2, dark(pal.dumpster, 0.15), 0.3, { lw: 0.35 });
    for (const wx of [x0 + 2.5, x1 - 2.5]) { g.fillStyle = pal.tire; g.beginPath(); g.arc(wx, y0 - 0.8, 0.9, 0, 6.3); g.fill(); }
    snowCap(g, x0, top - 0.6, x1 - x0, 1.2);
  }
  function drawReel(g) {
    const pal = P(), cx = 551, y0 = 486;
    const wood = mix(pal.timber, pal.timberShade, 0.35);
    shadow(g, cx, y0 + 0.2, 6.5, 1.1);
    box(g, cx - 3.2, y0 - 6, 6.4, 5, dark(wood, 0.15), 0.4, { lw: 0.35 });
    g.fillStyle = rgba(pal.ink, 0.25); for (let k = 0; k < 4; k++) g.fillRect(cx - 3 + k * 1.7, y0 - 5.6, 0.2, 4.2);
    g.beginPath(); g.ellipse(cx, y0 - 0.9, 5.4, 1.2, 0, 0, 6.3); g.fillStyle = dark(wood, 0.25); g.fill(); ink(g, 0.3);
    g.beginPath(); g.ellipse(cx, y0 - 6.6, 5.8, 1.5, 0, 0, 6.3); g.fillStyle = wood; g.fill(); ink(g, 0.35);
    g.beginPath(); g.ellipse(cx, y0 - 6.9, 4.6, 1, 0, 0, 6.3); g.fillStyle = light(wood, 0.15); g.fill();
    g.fillStyle = rgba(pal.ink, 0.5); g.beginPath(); g.arc(cx, y0 - 6.8, 0.5, 0, 6.3); g.fill();
    snowCap(g, cx - 5, y0 - 7.4, 10, 0.7);
  }
  function drawBenchSeat(g) {
    const pal = P(), x0 = 667, x1 = 697, y0 = 470;
    const wood = mix(pal.timber, pal.timberShade, 0.3), iron = mix(pal.ink, pal.steel, 0.35);
    shadow(g, (x0 + x1) / 2, y0 + 0.3, 16, 1.1);
    for (const lx of [x0 + 2, x1 - 2]) line(g, lx, y0, lx, y0 - 4.2, iron, 0.7);
    box(g, x0, y0 - 5.4, x1 - x0, 1.6, light(wood, 0.1), 0.3, { lw: 0.35, shade: false });
    g.fillStyle = rgba(pal.ink, 0.2); g.fillRect(x0 + 0.4, y0 - 4.7, x1 - x0 - 0.8, 0.18);
    snowCap(g, x0, y0 - 5.4, x1 - x0, 0.7);
  }
  function drawBenchBack(g) {
    const pal = P(), x0 = 667, x1 = 697, y0 = 471.2;
    const wood = mix(pal.timber, pal.timberShade, 0.3), iron = mix(pal.ink, pal.steel, 0.35);
    for (const lx of [x0 + 1, x1 - 1]) line(g, lx, y0, lx - 0.4, y0 - 9.2, iron, 0.75);
    for (const sy of [y0 - 9.6, y0 - 7.4]) box(g, x0 - 0.5, sy, x1 - x0 + 1, 1.5, wood, 0.35, { lw: 0.35 });
    snowCap(g, x0 - 0.5, y0 - 9.6, x1 - x0 + 1, 0.6);
  }
  function drawTree(g) {
    const pal = P(), x = 708, y0 = 466, s = season();
    shadow(g, x, y0 + 0.4, 14, 2, 0.16);
    /* trunk and limbs */
    const trunk = pal.trunk;
    g.fillStyle = trunk; g.beginPath(); g.moveTo(x - 2.2, y0); g.quadraticCurveTo(x - 1, y0 - 12, x - 3, y0 - 24); g.lineTo(x - 1.4, y0 - 24); g.quadraticCurveTo(x + 0.2, y0 - 16, x + 1.2, y0 - 14);
    g.quadraticCurveTo(x + 3, y0 - 20, x + 6, y0 - 26); g.lineTo(x + 7, y0 - 25); g.quadraticCurveTo(x + 3.4, y0 - 16, x + 2.4, y0); g.closePath(); g.fill(); ink(g, 0.4);
    g.fillStyle = rgba(pal.ink, 0.2); g.fillRect(x + 0.8, y0 - 12, 1.4, 12);
    const branches = [[x - 2.2, y0 - 22, x - 12, y0 - 34], [x - 2.4, y0 - 24, x - 4, y0 - 40], [x + 5.6, y0 - 25, x + 14, y0 - 36], [x + 5, y0 - 24.4, x + 6, y0 - 42], [x - 1.4, y0 - 18, x - 9, y0 - 24], [x + 3.8, y0 - 20, x + 12, y0 - 25]];
    g.strokeStyle = trunk; g.lineCap = 'round';
    for (const [ax, ay, bx, by] of branches) { g.lineWidth = 0.9; g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo((ax + bx) / 2 + 1, (ay + by) / 2, bx, by); g.stroke(); }
    if (s === 'bare' || s === 'winter') {
      g.lineWidth = 0.4;
      for (const [, , bx, by] of branches) { g.beginPath(); g.moveTo(bx, by); g.lineTo(bx - 2, by - 3); g.moveTo(bx, by); g.lineTo(bx + 2.4, by - 2); g.stroke(); }
      if (s === 'winter') { g.fillStyle = pal.snow; for (const [, , bx, by] of branches) { g.beginPath(); g.ellipse(bx, by - 0.4, 1.8, 0.5, -0.3, 0, 6.3); g.fill(); } }
      return;
    }
    /* the crown: overlapping soft clumps, by season */
    const pick = (i) => {
      if (s === 'fall') return [pal.autumnA, pal.autumnB, lit('#b9893a'), pal.autumnA, lit('#9a6a2a')][i % 5];
      if (s === 'late') return [lit('#9a6a2a'), pal.autumnA, lit('#7a5a3a')][i % 3];
      if (s === 'spring') return [pal.treeLight, lit('#9cbf5a'), pal.tree][i % 3];
      return [pal.tree, pal.treeDark, pal.treeLight][i % 3];
    };
    const clumps = [[x - 10, y0 - 32, 7.5], [x + 11, y0 - 33, 7.5], [x, y0 - 40, 9], [x - 5, y0 - 46, 7], [x + 7, y0 - 45, 7.5], [x - 13, y0 - 41, 5.5], [x + 15, y0 - 40, 5.5], [x + 1, y0 - 30, 7]];
    const sparse = s === 'late';
    if (!sparse) { g.beginPath(); g.ellipse(x + 1, y0 - 38, 18, 12.5, 0, 0, 6.3); g.fillStyle = dark(pick(1), 0.15); g.fill(); ink(g, 0.35); }
    clumps.forEach(([cx, cy, r], i) => {
      if (sparse && i % 2) return;
      const c = pick(i);
      g.beginPath(); g.arc(cx, cy, r, 0, 6.3); g.fillStyle = c; g.fill();
      g.save(); g.clip();
      g.fillStyle = rgba(pal.ink, 0.16); g.beginPath(); g.arc(cx + r * 0.45, cy + r * 0.45, r * 0.95, 0, 6.3); g.fill();
      g.fillStyle = rgba(pal.white, 0.18); g.beginPath(); g.arc(cx - r * 0.4, cy - r * 0.45, r * 0.45, 0, 6.3); g.fill();
      g.restore();
      g.beginPath(); g.arc(cx, cy, r, 0, 6.3); ink(g, 0.35);
    });
    /* fallen leaves */
    if (s === 'fall' || s === 'late') {
      const r = rng(77);
      for (let i = 0; i < 26; i++) { g.fillStyle = pick(i); g.beginPath(); g.ellipse(x - 16 + r() * 34, y0 - 2 + r() * 14, 0.7, 0.35, r() * 3, 0, 6.3); g.fill(); }
    }
  }

  /* ---------------------------------------------------- the fence */
  const RUNS = [[0, 61.4], [82.6, 633.4], [646.6, FENCE_END]];
  const POSTS = (() => { const out = []; for (let x = 1; x < FENCE_END; x += 10) if ((x < 60 || x > 84) && (x < 632 || x > 648)) out.push(x); out.push(61.4, 82.6, 633.4, 646.6, FENCE_END); return out; })();
  function muralCount() { return clamp(Math.floor((K.S.town.windows_lit || 0) / 3), 0, MURAL_N); }
  function drawFence(g, x0, x1) {
    const pal = P(), top = 487, bot = 497.6, sn = snowy();
    /* chain-link: two sets of diagonals, clipped to the runs */
    g.save();
    g.beginPath();
    for (const [a, b] of RUNS) g.rect(a, top, b - a, bot - top);
    g.clip();
    g.strokeStyle = rgba(pal.fence, 0.42); g.lineWidth = 0.16;
    g.beginPath();
    const h = bot - top;
    for (let x = Math.floor((x0 - h) / 1.5) * 1.5; x < x1 + h; x += 1.5) { g.moveTo(x, top); g.lineTo(x + h, bot); g.moveTo(x + h, top); g.lineTo(x, bot); }
    g.stroke();
    g.restore();
    /* rails */
    for (const [a, b] of RUNS) {
      if (b < x0 || a > x1) continue;
      box(g, a, top - 0.5, b - a, 0.9, pal.fence, 0.4, { lw: 0.25, shade: false });
      g.fillStyle = rgba(pal.white, 0.35); g.fillRect(a, top - 0.4, b - a, 0.25);
      line(g, a, bot - 0.2, b, bot - 0.2, dark(pal.fence, 0.2), 0.25);
      if (sn) { g.fillStyle = pal.snow; g.fillRect(a, top - 1.1, b - a, 0.7); }
    }
    /* posts */
    for (const px of POSTS) {
      if (px < x0 - 2 || px > x1 + 2) continue;
      const tall = px === 61.4 || px === 82.6 || px === 633.4 || px === 646.6 || px === FENCE_END;
      box(g, px - 0.45, top - (tall ? 1.6 : 0.8), 0.9, bot - top + (tall ? 2.2 : 1.4), pal.fence, 0.4, { lw: 0.25 });
      g.fillStyle = dark(pal.fence, 0.25); g.beginPath(); g.arc(px, top - (tall ? 1.6 : 0.8), 0.55, Math.PI, 0); g.fill();
      if (sn) snowCap(g, px - 0.6, top - (tall ? 1.6 : 0.8) - 0.3, 1.2, 0.6);
    }
    /* the side gate, closed, a little frame of its own */
    if (x1 > 630 && x0 < 650) {
      box(g, 634.4, top + 0.2, 11.2, bot - top - 1, rgba(pal.fence, 0.12), 0.3, { lw: 0.3, shade: false });
      line(g, 634.6, bot - 1, 645.4, top + 0.6, pal.fence, 0.35);
      box(g, 644.4, top + 4, 1, 1.4, dark(pal.steel, 0.2), 0.2, { lw: 0.2, shade: false });
    }
    /* the site sign by the gate */
    if (x1 > 86 && x0 < 128) siteSign(g, 88, 478.4);
    /* the mural: painted plywood panels on the fence in front of the pad */
    if (x1 > MURAL_X0 - 2 && x0 < MURAL_X0 + MURAL_N * MURAL_W + 2) {
      const painted = muralCount();
      for (let i = 0; i < MURAL_N; i++) muralPanel(g, MURAL_X0 + i * MURAL_W, 489.4, MURAL_W - 0.5, 7.8, i, i < painted);
    }
  }
  function siteSign(g, x, y) {
    const pal = P(), w = 34, h = 11;
    for (const lx of [x + 4, x + w - 4]) box(g, lx - 0.5, y + h - 1, 1, 498 - y - h + 1, dark(pal.steel, 0.1), 0.2, { lw: 0.25, shade: false });
    box(g, x, y, w, h, pal.sign, 0.6, { split: 0.85 });
    g.fillStyle = pal.rust; g.fillRect(x + 0.6, y + h - 1.8, w - 1.2, 1.2);
    /* a tiny Watershed: rust wing, rust middle with a charcoal cap, the brick corner */
    const bx = x + 2, by = y + 2;
    g.fillStyle = pal.rust; g.fillRect(bx, by + 1.4, 2.4, 5.4); g.fillRect(bx + 2.4, by + 0.8, 3, 6);
    g.fillStyle = pal.charcoal; g.fillRect(bx + 2.4, by + 0.8, 3, 1.2);
    g.fillStyle = pal.glassDark; g.fillRect(bx + 5.4, by + 0.8, 0.7, 6);
    g.fillStyle = pal.brick; g.fillRect(bx + 6.1, by + 0.4, 2.4, 6.4);
    g.fillStyle = rgba(pal.glassHi, 0.8); for (let k = 0; k < 4; k++) { g.fillRect(bx + 0.5, by + 2.4 + k * 1.2, 0.5, 0.5); g.fillRect(bx + 3, by + 2.4 + k * 1.2, 0.5, 0.5); g.fillRect(bx + 6.6, by + 1.6 + k * 1.3, 0.6, 0.5); }
    g.fillStyle = pal.signInk; g.font = '800 4.3px system-ui, -apple-system, "Segoe UI", sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillText('WATERSHED', x + 11.6, y + 4.6, w - 13);
    g.fillStyle = rgba(pal.signInk, 0.55); g.fillRect(x + 11.6, y + 7.2, 14, 0.35); g.fillRect(x + 11.6, y + 8, 9, 0.35);
    snowCap(g, x, y, w, 0.9);
  }
  const MURAL_BG = ['#2f6fb2', '#d9822b', '#3fae5a', '#b85a7a', '#f2c230', '#2f8a8a', '#d9443a', '#5a4f9a'];
  function muralPanel(g, x, y, w, h, i, painted) {
    const pal = P();
    if (!painted) {
      box(g, x, y, w, h, mix(pal.white, pal.timber, 0.35), 0.3, { lw: 0.3, shade: false });
      g.fillStyle = rgba(pal.ink, 0.35); for (const [sx, sy] of [[0.8, 0.8], [w - 0.8, 0.8], [0.8, h - 0.8], [w - 0.8, h - 0.8]]) g.fillRect(x + sx - 0.15, y + sy - 0.15, 0.3, 0.3);
      return;
    }
    const id = hash('mural' + i);
    const bgHex = MURAL_BG[id % MURAL_BG.length], bg = lit(bgHex);
    box(g, x, y, w, h, bg, 0.3, { lw: 0.3, shade: false });
    g.save(); rr(g, x, y, w, h, 0.3); g.clip();
    motif(g, x, y, w, h, (id >>> 4) % 12, bgHex);
    g.restore();
    rr(g, x, y, w, h, 0.3); ink(g, 0.3);
  }
  function motif(g, x, y, w, h, k, bgHex) {
    const pal = P(), cx = x + w / 2, cy = y + h / 2;
    const W = lit('#f4f1e8'), Y = lit('#f2c230'), R = lit('#d9443a'), G = lit('#3fae5a'), B = lit('#2f6fb2'), O = lit('#f07f2a');
    const fill = (c) => { g.fillStyle = c; g.fill(); };
    g.beginPath();
    switch (k) {
      case 0: /* the lake and the Adirondacks, a sun */
        g.fillStyle = lit('#9fc4e0'); g.fillRect(x, y, w, h); g.beginPath(); g.moveTo(x, cy + 1); g.lineTo(x + 2.4, cy - 1.6); g.lineTo(x + 4, cy); g.lineTo(x + 5.6, cy - 2.2); g.lineTo(x + w, cy + 1); g.closePath(); fill(lit('#5a6f8f'));
        g.fillStyle = B; g.fillRect(x, cy + 1, w, h); g.beginPath(); g.arc(x + w - 1.6, y + 1.6, 0.9, 0, 6.3); fill(Y); break;
      case 1: /* a heart */
        g.moveTo(cx, cy + 2.2); g.bezierCurveTo(cx - 4, cy - 0.6, cx - 1.6, cy - 3.4, cx, cy - 1.2); g.bezierCurveTo(cx + 1.6, cy - 3.4, cx + 4, cy - 0.6, cx, cy + 2.2); fill(bgHex === '#d9443a' ? W : R); break;
      case 2: /* a maple leaf */
        for (let a = 0; a < 5; a++) { const t = -Math.PI / 2 + (a - 2) * 0.62; g.moveTo(cx, cy + 0.6); g.lineTo(cx + Math.cos(t - 0.25) * 1.6, cy + 0.6 + Math.sin(t - 0.25) * 1.6); g.lineTo(cx + Math.cos(t) * 3, cy + 0.6 + Math.sin(t) * 3); g.lineTo(cx + Math.cos(t + 0.25) * 1.6, cy + 0.6 + Math.sin(t + 0.25) * 1.6); }
        fill(bgHex === '#d9822b' ? R : O); line(g, cx, cy + 0.6, cx, cy + 3, lit('#7a3a1a'), 0.3); break;
      case 3: /* a bike */
        g.strokeStyle = W; g.lineWidth = 0.35; g.arc(cx - 1.8, cy + 1, 1.3, 0, 6.3); g.moveTo(cx + 3.1, cy + 1); g.arc(cx + 1.8, cy + 1, 1.3, 0, 6.3);
        g.moveTo(cx - 1.8, cy + 1); g.lineTo(cx - 0.4, cy - 1); g.lineTo(cx + 1.2, cy - 1); g.lineTo(cx + 1.8, cy + 1); g.stroke(); break;
      case 4: /* the sun */
        g.arc(cx, cy, 1.8, 0, 6.3); fill(bgHex === '#f2c230' ? O : Y); g.strokeStyle = bgHex === '#f2c230' ? O : Y; g.lineWidth = 0.35; g.beginPath(); for (let a = 0; a < 8; a++) { const t = a * Math.PI / 4; g.moveTo(cx + Math.cos(t) * 2.4, cy + Math.sin(t) * 2.4); g.lineTo(cx + Math.cos(t) * 3.2, cy + Math.sin(t) * 3.2); } g.stroke(); break;
      case 5: /* a Vermont cow */
        g.ellipse(cx, cy + 0.6, 2.6, 1.4, 0, 0, 6.3); fill(W); g.beginPath(); g.ellipse(cx + 2.6, cy - 0.2, 0.9, 0.7, 0, 0, 6.3); fill(W);
        g.fillStyle = pal.ink; g.fillRect(cx - 1.4, cy, 1, 0.8); g.fillRect(cx + 0.6, cy + 0.6, 0.8, 0.6); for (const lx of [-1.8, -0.8, 0.8, 1.8]) g.fillRect(cx + lx, cy + 1.8, 0.3, 1.2); break;
      case 6: /* a fish */
        g.ellipse(cx - 0.4, cy, 2.2, 1.2, 0, 0, 6.3); g.moveTo(cx + 1.6, cy); g.lineTo(cx + 3, cy - 1.2); g.lineTo(cx + 3, cy + 1.2); g.closePath(); fill(bgHex === '#d9822b' ? Y : O); g.fillStyle = pal.ink; g.fillRect(cx - 1.8, cy - 0.4, 0.4, 0.4); break;
      case 7: /* a sailboat */
        g.moveTo(cx - 0.2, cy - 3); g.lineTo(cx - 0.2, cy + 1); g.lineTo(cx - 2.6, cy + 1); g.closePath(); fill(W); g.beginPath(); g.moveTo(cx + 0.3, cy - 2.2); g.lineTo(cx + 0.3, cy + 1); g.lineTo(cx + 2.2, cy + 1); g.closePath(); fill(Y);
        g.beginPath(); g.moveTo(cx - 3, cy + 1.4); g.lineTo(cx + 3, cy + 1.4); g.lineTo(cx + 2, cy + 2.6); g.lineTo(cx - 2, cy + 2.6); g.closePath(); fill(R); break;
      case 8: /* the building */
        g.fillStyle = lit('#b46545'); g.fillRect(cx - 2.8, cy - 2, 3.6, 5); g.fillStyle = lit('#3a3430'); g.fillRect(cx - 2.8, cy - 2.6, 3.6, 0.8); g.fillStyle = lit('#8a5340'); g.fillRect(cx + 1.2, cy - 2.8, 1.8, 5.8);
        g.fillStyle = Y; for (let r = 0; r < 3; r++) g.fillRect(cx - 2.2 + (r % 2), cy - 1.2 + r * 1.4, 0.6, 0.6); break;
      case 9: /* a flower */
        for (let a = 0; a < 5; a++) { g.moveTo(cx, cy - 0.6); g.arc(cx + Math.cos(a * 1.257) * 1.3, cy - 0.6 + Math.sin(a * 1.257) * 1.3, 0.9, 0, 6.3); }
        fill(W); g.beginPath(); g.arc(cx, cy - 0.6, 0.6, 0, 6.3); fill(Y); line(g, cx, cy + 0.4, cx, cy + 3.4, G, 0.35); break;
      case 10: /* an apple */
        g.arc(cx, cy + 0.4, 2, 0, 6.3); fill(bgHex === '#d9443a' ? Y : R); line(g, cx, cy - 1.6, cx + 0.3, cy - 2.6, lit('#5a3a1a'), 0.3); g.beginPath(); g.ellipse(cx + 1, cy - 2.2, 0.8, 0.35, -0.4, 0, 6.3); fill(G); break;
      default: /* a star over the water */
        for (let a = 0; a < 10; a++) { const t = -Math.PI / 2 + a * Math.PI / 5, r = a % 2 ? 1 : 2.4; if (a) g.lineTo(cx + Math.cos(t) * r, cy - 0.6 + Math.sin(t) * r); else g.moveTo(cx + Math.cos(t) * r, cy - 0.6 + Math.sin(t) * r); }
        g.closePath(); fill(bgHex === '#f2c230' ? W : Y); g.fillStyle = rgba(W, 0.6); g.fillRect(x, cy + 2.4, w, 0.35);
    }
  }
  /* the rolling gate: slides west along the fence while the site is open */
  function drawGate(ctx) {
    const pal = K.pal, k = gate;
    const x = 62.4 - k * 19.6, w = 20, top = 487.4, bot = 497;
    ctx.strokeStyle = rgba(pal.fence, 0.45); ctx.lineWidth = 0.16;
    ctx.beginPath();
    for (let i = 0; i <= w; i += 1.5) { ctx.moveTo(x + i, top); ctx.lineTo(Math.min(x + w, x + i + (bot - top)), top + Math.min(bot - top, w - i)); }
    ctx.stroke();
    ctx.lineJoin = 'round'; ctx.lineWidth = 0.55; ctx.strokeStyle = pal.fence;
    ctx.strokeRect(x, top, w, bot - top);
    ctx.beginPath(); ctx.moveTo(x, bot); ctx.lineTo(x + w, top); ctx.stroke();
    ctx.lineWidth = 0.2; ctx.strokeStyle = pal.ink; ctx.strokeRect(x - 0.28, top - 0.28, w + 0.56, bot - top + 0.56);
    ctx.fillStyle = pal.tire; ctx.beginPath(); ctx.arc(x + 2, bot + 0.6, 0.7, 0, 6.3); ctx.arc(x + w - 2, bot + 0.6, 0.7, 0, 6.3); ctx.fill();
    ctx.fillStyle = pal.netting; ctx.beginPath(); ctx.moveTo(x + w - 0.3, top - 0.2); ctx.lineTo(x + w + 2, top + 0.6); ctx.lineTo(x + w - 0.3, top + 1.4); ctx.closePath(); ctx.fill();
  }

  /* ------------------------------------------ the far-side foreground */
  /* the far side's furniture, each its own little cache, sorted by depth with the people */
  const LAMP_XS = [], TREE_XS = [], BENCH_XS = [180, 470, 760], LIBRARY_XS = [305, 612];
  for (let x = 70; x < WW; x += 110) LAMP_XS.push(x);
  for (let x = 20; x < WW; x += 95) if (!(x > 396 && x < 540) && !LAMP_XS.some((l) => Math.abs(l - x) < 12) && !BENCH_XS.some((b) => Math.abs(b - x) < 14) && !LIBRARY_XS.some((b) => Math.abs(b - x) < 10)) TREE_XS.push(x);
  const LAMP_Y = FAR_CURB + 3.4;
  function drawLamp(g, x) {
    const pal = P(), y = LAMP_Y, on = night() > 0.35;
    box(g, x - 0.9, y - 1.6, 1.8, 2, dark(pal.steel, 0.35), 0.3, { lw: 0.25, shade: false });
    box(g, x - 0.4, y - 22, 0.8, 21, dark(pal.steel, 0.3), 0.2, { lw: 0.25, shade: false });
    box(g, x - 1.2, y - 22.4, 2.4, 0.8, dark(pal.steel, 0.35), 0.2, { lw: 0.25, shade: false });
    g.beginPath(); g.ellipse(x, y - 24.2, 1.5, 2, 0, 0, 6.3); g.fillStyle = on ? EMIT.lamp : mix(pal.white, pal.glassHi, 0.4); g.fill(); ink(g, 0.3);
    g.beginPath(); g.moveTo(x - 1.4, y - 25.4); g.quadraticCurveTo(x, y - 27.6, x + 1.4, y - 25.4); g.closePath(); g.fillStyle = dark(pal.steel, 0.35); g.fill();
    g.fillStyle = dark(pal.steel, 0.35); g.fillRect(x - 0.2, y - 28.2, 0.4, 1);
    if (snowy()) snowCap(g, x - 1.3, y - 26.6, 2.6, 0.6);
  }
  /* a street tree on the verge: its crown rises over the far lanes */
  function drawStreetTree(g, x) {
    const pal = P(), y = VERGE_Y + 1, s = season();
    shadow(g, x, y + 0.3, 5, 1, 0.16);
    g.fillStyle = pal.trunk; g.beginPath(); g.moveTo(x - 0.9, y); g.lineTo(x - 0.5, y - 10); g.lineTo(x + 0.5, y - 10); g.lineTo(x + 0.9, y); g.closePath(); g.fill(); ink(g, 0.3);
    g.fillStyle = dark(pal.dirt, 0.15); g.beginPath(); g.ellipse(x, y + 0.1, 2.6, 0.6, 0, 0, 6.3); g.fill();
    if (s === 'bare' || s === 'winter') {
      g.strokeStyle = pal.trunk; g.lineCap = 'round';
      for (const [bx, by, ex, ey] of [[x, y - 9, x - 4.5, y - 16], [x, y - 10, x + 0.5, y - 18], [x, y - 8, x + 4.6, y - 15], [x - 2.4, y - 12.6, x - 3.6, y - 17.4], [x + 2.6, y - 12, x + 4.2, y - 17]]) {
        g.lineWidth = 0.5; g.beginPath(); g.moveTo(bx, by); g.lineTo(ex, ey); g.stroke();
        if (s === 'winter') { g.fillStyle = pal.snow; g.beginPath(); g.ellipse(ex, ey, 1.1, 0.35, -0.3, 0, 6.3); g.fill(); }
      }
      return;
    }
    const cs = s === 'fall' ? [pal.autumnA, pal.autumnB, lit('#b9893a')] : s === 'late' ? [lit('#9a6a2a'), pal.autumnA, lit('#7a5a3a')] : s === 'spring' ? [pal.treeLight, lit('#9cbf5a'), pal.tree] : [pal.tree, pal.treeLight, pal.treeDark];
    const off = (x >> 3) % 3;
    for (let i = 0; i < 5; i++) {
      if (s === 'late' && i % 2) continue;
      const dx = [-3.6, 3.4, 0, -2, 2.4][i], dy = [-12.5, -12.8, -16.8, -19, -18.4][i], r = [3.6, 3.6, 4.4, 3, 3][i];
      const c = cs[(i + off) % 3];
      g.beginPath(); g.arc(x + dx, y + dy, r, 0, 6.3); g.fillStyle = c; g.fill();
      g.save(); g.clip(); g.fillStyle = rgba(pal.ink, 0.15); g.beginPath(); g.arc(x + dx + r * 0.45, y + dy + r * 0.45, r, 0, 6.3); g.fill(); g.fillStyle = rgba(pal.white, 0.16); g.beginPath(); g.arc(x + dx - r * 0.4, y + dy - r * 0.45, r * 0.45, 0, 6.3); g.fill(); g.restore();
      g.beginPath(); g.arc(x + dx, y + dy, r, 0, 6.3); ink(g, 0.3);
    }
  }
  /* a bench beside the bike path, facing it (and you) */
  const PBENCH_Y = PATH_Y0 - 0.6;
  function drawPathBench(g, x) {
    const pal = P(), y = PBENCH_Y, wood = mix(pal.timber, pal.timberShade, 0.3), iron = mix(pal.ink, pal.steel, 0.35);
    shadow(g, x, y + 0.2, 7, 0.8, 0.16);
    for (const sy of [y - 9.4, y - 7.4]) box(g, x - 6.5, sy, 13, 1.4, wood, 0.35, { lw: 0.3 });
    for (const lx of [x - 5.5, x + 5.5]) { line(g, lx, y, lx, y - 9.6, iron, 0.6); }
    box(g, x - 7, y - 5.2, 14, 1.4, light(wood, 0.1), 0.3, { lw: 0.3, shade: false });
    snowCap(g, x - 7, y - 5.2, 14, 0.6); snowCap(g, x - 6.5, y - 9.4, 13, 0.5);
  }
  /* a Little Free Library: a birdhouse of books on a post */
  const LIB_Y = PATH_Y0 - 1.4;
  function drawLibrary(g, x) {
    const pal = P(), y = LIB_Y;
    shadow(g, x, y + 0.2, 2.4, 0.6, 0.16);
    box(g, x - 0.5, y - 8, 1, 8, pal.timberShade, 0.2, { lw: 0.3, shade: false });
    box(g, x - 3, y - 13.6, 6, 5.8, lit('#3f7a6a'), 0.4);
    box(g, x - 2.2, y - 12.6, 4.4, 4, mix(pal.glass, pal.glassHi, 0.3), 0.3, { lw: 0.25, shade: false });
    for (let i = 0; i < 5; i++) { g.fillStyle = lit(['#d9443a', '#f2c230', '#2f6fb2', '#3fae5a', '#b85a7a'][i]); g.fillRect(x - 1.9 + i * 0.8, y - 11.4 - (i % 2) * 0.4, 0.6, 2.4 + (i % 2) * 0.4); }
    g.fillStyle = rgba(pal.white, 0.4); g.fillRect(x - 2, y - 12.4, 0.5, 3.6);
    g.beginPath(); g.moveTo(x - 3.8, y - 13.2); g.lineTo(x, y - 16.6); g.lineTo(x + 3.8, y - 13.2); g.closePath(); g.fillStyle = lit('#b5483a'); g.fill(); ink(g, 0.3);
    if (snowy()) { g.fillStyle = pal.snow; g.beginPath(); g.moveTo(x - 3.6, y - 13.5); g.lineTo(x, y - 16.6); g.lineTo(x + 3.6, y - 13.5); g.lineTo(x, y - 15.4); g.closePath(); g.fill(); }
  }
  const FAR_ITEMS = [
    ...LAMP_XS.map((x) => ({ y: LAMP_Y, draw: () => K.blit('w:lamp' + x, x - 3, LAMP_Y - 30, 6, 32, (g) => drawLamp(g, x), { ver: seasonCode() + (night() > 0.35 ? 10 : 0) }) })),
    ...TREE_XS.map((x) => ({ y: VERGE_Y + 1, draw: () => K.blit('w:stree' + x, x - 9, VERGE_Y - 23, 18, 26, (g) => drawStreetTree(g, x), { ver: seasonCode() }) })),
    ...BENCH_XS.map((x) => ({ y: PBENCH_Y, draw: () => K.blit('w:pbench' + x, x - 9, PBENCH_Y - 12, 18, 14, (g) => drawPathBench(g, x), { ver: seasonCode() }) })),
    ...LIBRARY_XS.map((x) => ({ y: LIB_Y, draw: () => K.blit('w:lib' + x, x - 5, LIB_Y - 18, 10, 20, (g) => drawLibrary(g, x), { ver: seasonCode() }) })),
  ];

  /* --------------------------------------------------- passers-by */
  function makePasser(kind, o = {}) {
    const R = K.R, cam = K.cam, W = K.view.W;
    const dir = o.dir || (R() < 0.5 ? 1 : -1);
    const x = o.x != null ? o.x : (dir > 0 ? cam.x - 14 : cam.x + W + 14);
    const pick = (a) => a[(R() * a.length) | 0];
    const q = { id: 'p' + (++pid), kind, dir, x, y: SIDEWALK_Y + (R() - 0.5) * 0.8, t: R() * 3, v: 9 + R() * 2.5,
      colors: { hat: pick(JACKETS), vest: pick(JACKETS), skin: pick(SKINS), hair: pick(HAIRS) }, state: 'go', stopX: o.stopX, wait: 0, emote: null, emoteT: 0 };
    if (kind === 'bike') { q.y = BIKE_Y + (R() - 0.5); q.v = 24 + R() * 10; q.bike = pick(['#2f6fb2', '#d9443a', '#3fae5a', '#f2c230', '#2b2b30', '#e6e0d0']); q.colors.hat = pick(['#f4f1e8', '#d9443a', '#2f6fb2', '#2b2b30', '#3fae5a']); }
    if (kind === 'jog') q.v = 17 + R() * 4;
    if (kind === 'dog') { q.v = 8 + R() * 1.5; q.coat = pick(COATS); }
    if (kind === 'coffee') q.v = 8.5 + R() * 2;
    if (kind === 'kid') {
      q.v = 7.5; q.kid = { colors: { hat: pick(['#f2c230', '#d9443a', '#3fae5a', '#ff7fae']), vest: pick(['#f2c230', '#d9443a', '#3fae5a', '#ff7fae', '#4c95ff']), skin: q.colors.skin, hair: pick(HAIRS) }, cap: R() < 0.5 };
      if (q.stopX == null) q.stopX = cam.x + W * (0.35 + R() * 0.3);
    }
    if (wet() && kind !== 'bike' && kind !== 'jog') q.umbrella = pick(UMBRELLAS);
    return q;
  }
  function spawn(kind, o = {}) {
    if (passers.length >= 6) passers.shift();
    const q = makePasser(kind, o); passers.push(q); return q.id;
  }
  function stepPassers(dt) {
    const late = night() > 0.75, wt = wet(), sn = snowy();
    passT -= dt;
    if (passT <= 0) {
      passT = (late ? 28 : 7) + K.R() * (late ? 40 : 14) + (wt || sn ? 8 : 0);
      if (passers.length < 4) {
        const r = K.R(), h = hour();
        let kind;
        if (late) kind = r < 0.5 ? 'walk' : r < 0.75 ? 'dog' : 'bike';
        else if (h < 9 && r < 0.3) kind = 'coffee';
        else kind = !sn && r < 0.38 ? 'bike' : r < 0.55 && !wt ? 'jog' : r < 0.78 ? 'dog' : r < 0.9 ? 'walk' : 'coffee';
        spawn(kind);
      }
    }
    const cam = K.cam, W = K.view.W;
    for (let i = passers.length - 1; i >= 0; i--) {
      const q = passers[i];
      q.t += dt;
      if (q.emote) { q.emoteT += dt; if (q.emoteT > 2.6) q.emote = null; }
      if (q.state === 'go') {
        q.x += q.dir * q.v * dt;
        if (q.kind === 'kid' && q.stopX != null && (q.x - q.stopX) * q.dir >= 0) { q.state = 'wave'; q.wait = 0; q.stopX = null; K.emit('kid:wave', { id: q.id, x: q.x + q.dir * 3, y: q.y }); }
      } else if (q.state === 'wave') {
        q.wait += dt;
        if (q.wait > (q.cheered ? 9 : 8)) q.state = 'go';
      }
      if (q.x < cam.x - 60 || q.x > cam.x + W + 60) passers.splice(i, 1);
    }
  }
  /* the bike path's own people: cyclists, joggers, dog walkers, a stroller, someone who sits on a
     bench a while or stops at the little library; cross-country skiers when it's snowed */
  const pathers = [];
  let pathT = 2;
  function stepPath(dt) {
    const show = K.cam.y + K.view.H > PATH_Y0 - 2;
    const late = night() > 0.75, wt = wet(), sn = snowy();
    pathT -= dt;
    if (show && pathT <= 0) {
      pathT = (late ? 30 : 6) + K.R() * (late ? 40 : 12) + (wt ? 10 : 0);
      if (pathers.length < 4) {
        const r = K.R();
        const kind = sn ? (r < 0.4 ? 'ski' : r < 0.75 ? 'walk' : 'dog')
          : late ? (r < 0.5 ? 'walk' : r < 0.8 ? 'dog' : 'bike')
          : r < 0.32 ? 'bike' : r < 0.5 && !wt ? 'jog' : r < 0.66 ? 'dog' : r < 0.76 ? 'stroller' : r < 0.88 ? 'bench' : 'library';
        const q = makePasser(kind === 'bench' || kind === 'library' || kind === 'stroller' || kind === 'ski' ? 'walk' : kind);
        q.kind = kind; q.path = true;
        q.y = q.dir > 0 ? PATH_E : PATH_W;
        if (kind === 'bike') { q.y -= 0.3; q.v = 16 + K.R() * 8; }
        if (kind === 'stroller') q.v = 7 + K.R();
        if (kind === 'ski') { q.v = 9; q.colors.hat = '#d9443a'; }
        if (kind === 'bench' || kind === 'library') {
          const xs = kind === 'bench' ? BENCH_XS : LIBRARY_XS;
          const ahead = xs.filter((x) => (x - q.x) * q.dir > 10 && Math.abs(x - (K.cam.x + K.view.W / 2)) < K.view.W * 0.6);
          if (ahead.length) q.stopX = ahead[0]; else q.kind = 'walk';
        }
        pathers.push(q);
      }
    }
    const cam = K.cam, W = K.view.W;
    for (let i = pathers.length - 1; i >= 0; i--) {
      const q = pathers[i];
      q.t += dt;
      if (q.emote) { q.emoteT += dt; if (q.emoteT > 2.4) q.emote = null; }
      if (q.state === 'go') {
        q.x += q.dir * q.v * dt;
        if (q.stopX != null && (q.x - q.stopX) * q.dir >= 0) {
          q.x = q.stopX; q.stopX = null; q.wait = 0;
          if (q.kind === 'bench') { q.state = 'sit'; q.y0 = q.y; q.y = PBENCH_Y + 0.4; q.hold = 14 + K.R() * 14; }
          else { q.state = 'browse'; q.y0 = q.y; q.y = LIB_Y + 1.2; q.hold = 5; }
        }
      } else {
        q.wait += dt;
        if (q.state === 'browse' && !q.emote && q.wait > 3) { q.emote = K.R() < 0.5 ? 'heart' : 'idea'; q.emoteT = 0; }
        if (q.wait > q.hold) { q.state = 'go'; q.y = q.y0; }
      }
      if (q.x < cam.x - 60 || q.x > cam.x + W + 60 || !show) pathers.splice(i, 1);
    }
  }
  function drawStroller(ctx, q) {
    const pal = K.pal, x = q.x + q.dir * 5.6, y = q.y, d = q.dir, c = lit(q.colors.vest);
    ctx.lineWidth = 0.35; ctx.strokeStyle = pal.ink;
    for (const wx of [x - 1.6, x + 1.6]) { ctx.fillStyle = pal.tire; ctx.beginPath(); ctx.arc(wx, y - 0.9, 0.9, 0, 6.3); ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(x - 2.6, y - 2); ctx.lineTo(x + 2.6, y - 2); ctx.quadraticCurveTo(x + 2.8, y - 5, x + d * 0.4, y - 5); ctx.lineTo(x - 2.6, y - 5); ctx.closePath();
    ctx.fillStyle = c; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - d * 2.6, y - 5); ctx.quadraticCurveTo(x - d * 2.8, y - 8, x + d * 0.6, y - 7.6); ctx.lineTo(x + d * 0.4, y - 5); ctx.closePath();
    ctx.fillStyle = dark(c, 0.2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - d * 2.6, y - 4); ctx.lineTo(x - d * 4.4, y - 7.4); ctx.strokeStyle = dark(pal.steel, 0.3); ctx.lineWidth = 0.45; ctx.stroke();
  }
  function drawSkis(ctx, q) {
    const pal = K.pal, x = q.x, y = q.y, slide = Math.sin(q.t * 4) * 1.4;
    ctx.strokeStyle = lit('#d9443a'); ctx.lineWidth = 0.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 4 + slide, y); ctx.lineTo(x + 4 + slide, y); ctx.moveTo(x - 4 - slide, y + 0.4); ctx.lineTo(x + 4 - slide, y + 0.4); ctx.stroke();
    ctx.strokeStyle = dark(pal.steel, 0.3); ctx.lineWidth = 0.25;
    ctx.beginPath(); ctx.moveTo(x - q.dir * 1 + slide, y - 7); ctx.lineTo(x - q.dir * 4 + slide, y + 0.3); ctx.moveTo(x - q.dir * 0.5 - slide, y - 7); ctx.lineTo(x - q.dir * 3.4 - slide, y + 0.3); ctx.stroke();
  }
  function cheer(id) {
    const q = passers.find((p) => p.id === id);
    if (!q || q.cheered) return false;
    q.cheered = true; q.emote = 'heart'; q.emoteT = 0; q.wait = Math.min(q.wait, 3);
    return true;
  }
  function drawPasser(ctx, q) {
    const art = K.art;
    if (q.state === 'sit') { art.figure(ctx, q.x, q.y, { pose: 'sit', t: q.t, facing: 0, colors: q.colors, hat: false, civ: true }); return; }
    if (q.state === 'browse') { art.figure(ctx, q.x, q.y, { pose: 'look', t: q.t, facing: 'away', colors: q.colors, hat: false, civ: true }); if (q.emote) art.emote(ctx, q.x, q.y - 17, q.emote, q.emoteT); return; }
    if (q.kind === 'stroller') { art.figure(ctx, q.x, q.y, { pose: 'walk', t: q.t, facing: q.dir, colors: q.colors, hat: false, civ: true }); drawStroller(ctx, q); return; }
    if (q.kind === 'ski') { drawSkis(ctx, q); art.figure(ctx, q.x, q.y - 0.3, { pose: 'walk', t: q.t * 0.6, facing: q.dir, colors: q.colors, hat: true, civ: true }); return; }
    if (q.kind === 'bike') {
      drawBike(ctx, q);
      art.figure(ctx, q.x, q.y, { pose: 'ride', t: q.t, facing: q.dir, colors: q.colors, hat: true, civ: true });
      return;
    }
    if (q.kind === 'kid') {
      const waving = q.state === 'wave';
      const kx = q.x + q.dir * 3;
      art.figure(ctx, q.x, q.y, { pose: waving ? 'stand' : 'walk', t: q.t, facing: waving ? 0 : q.dir, colors: q.colors, hat: false, civ: true });
      const hop = q.cheered && q.wait < 1.2 ? Math.abs(Math.sin(q.wait * 9)) * 1.6 : 0;
      art.figure(ctx, kx, q.y + 0.4 - hop, { pose: waving ? (q.cheered && q.wait < 1.6 ? 'cheer' : 'wave') : 'walk', t: q.t, facing: waving ? 'away' : q.dir, colors: q.kid.colors, hat: q.kid.cap, scale: 0.66, civ: true });
      if (q.emote) art.emote(ctx, kx, q.y - 13, q.emote, q.emoteT);
      return;
    }
    art.figure(ctx, q.x, q.y, { pose: q.kind === 'jog' ? 'run' : 'walk', t: q.t, facing: q.dir, colors: q.colors, hat: false, carry: q.kind === 'coffee' ? 'mug' : null, civ: true });
    if (q.kind === 'dog') {
      const dx = q.x + q.dir * 7, pal = K.pal;
      ctx.strokeStyle = rgba(pal.ink, 0.8); ctx.lineWidth = 0.22;
      ctx.beginPath(); ctx.moveTo(q.x + q.dir * 1.6, q.y - 7.2); ctx.quadraticCurveTo(q.x + q.dir * 5, q.y - 3.5, dx - q.dir * 1.2, q.y - 4); ctx.stroke();
      art.prop(ctx, 'dog', dx, q.y + 0.3, { facing: q.dir, t: q.t, pose: 'walk', coat: q.coat, scale: 0.9 });
    }
    if (q.umbrella) {
      const pal = K.pal, ux = q.x + q.dir * 0.6, uy = q.y - 17.6;
      ctx.beginPath(); ctx.moveTo(ux - 5, uy + 2.2); ctx.quadraticCurveTo(ux, uy - 3.4, ux + 5, uy + 2.2);
      for (let k = 4; k >= 0; k--) ctx.quadraticCurveTo(ux - 5 + (k + 0.5) * 2, uy + 1.2, ux - 5 + k * 2, uy + 2.2);
      ctx.closePath(); ctx.fillStyle = lit(q.umbrella); ctx.fill(); ctx.lineWidth = 0.35; ctx.strokeStyle = pal.ink; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ux, uy - 0.6); ctx.lineTo(ux, uy + 6.4); ctx.stroke();
    }
  }
  function drawBike(ctx, q) {
    const pal = K.pal, x = q.x, y = q.y, d = q.dir, r = 2.5;
    const a = q.t * q.v / r;
    ctx.lineWidth = 0.4; ctx.strokeStyle = pal.ink;
    for (const wx of [x - 4.2, x + 4.2]) {
      ctx.beginPath(); ctx.arc(wx, y - r, r, 0, 6.3); ctx.stroke();
      ctx.lineWidth = 0.15; ctx.beginPath();
      for (let k = 0; k < 3; k++) { const t = a + k * 1.047; ctx.moveTo(wx - Math.cos(t) * r, y - r - Math.sin(t) * r); ctx.lineTo(wx + Math.cos(t) * r, y - r + Math.sin(t) * r); }
      ctx.stroke(); ctx.lineWidth = 0.4;
    }
    ctx.strokeStyle = lit(q.bike); ctx.lineWidth = 0.6; ctx.lineJoin = 'round';
    const rear = x - 4.2 * d, front = x + 4.2 * d;
    ctx.beginPath(); ctx.moveTo(rear, y - r); ctx.lineTo(x - 0.6 * d, y - 6.2); ctx.lineTo(x + 2.6 * d, y - 6.2); ctx.lineTo(front, y - r);
    ctx.moveTo(x - 0.6 * d, y - 6.2); ctx.lineTo(x, y - r); ctx.lineTo(rear, y - r); ctx.moveTo(x, y - r); ctx.lineTo(x + 2.6 * d, y - 6.2); ctx.stroke();
    ctx.strokeStyle = pal.ink; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x - 1.4 * d, y - 6.9); ctx.lineTo(x + 0.2 * d, y - 6.9); ctx.moveTo(x + 2.6 * d, y - 6.2); ctx.lineTo(x + 3 * d, y - 7.6); ctx.lineTo(x + 2.2 * d, y - 7.8); ctx.stroke();
  }

  /* ------------------------------------------------- the sorted list */
  const S = (key, x, y, w, h, fn, verFn) => ({ key, x, y, w, h, fn, verFn });
  function shedPost(g, x) { const pal = P(); box(g, x - 0.8, 431, 1.6, 34, pal.timberShade, 0.3, { lw: 0.35 }); box(g, x - 1.4, 464.2, 2.8, 0.9, pal.concreteShade, 0.2, { lw: 0.25, shade: false }); }
  function drawCones(g, list) {
    const pal = P();
    for (const [x, y] of list) {
      shadow(g, x, y + 0.2, 2, 0.5, 0.18);
      g.beginPath(); g.moveTo(x - 1.1, y - 0.6); g.lineTo(x - 0.25, y - 5.2); g.lineTo(x + 0.25, y - 5.2); g.lineTo(x + 1.1, y - 0.6); g.closePath(); g.fillStyle = pal.netting; g.fill(); ink(g, 0.3);
      g.fillStyle = pal.white; g.beginPath(); g.moveTo(x - 0.75, y - 2.4); g.lineTo(x - 0.5, y - 3.5); g.lineTo(x + 0.5, y - 3.5); g.lineTo(x + 0.75, y - 2.4); g.closePath(); g.fill();
      box(g, x - 1.8, y - 0.8, 3.6, 0.8, dark(pal.netting, 0.25), 0.2, { lw: 0.3, shade: false });
    }
  }
  function drawHose(g) {
    const pal = P(), x = 584, y = 476, c = lit('#3fae5a');
    shadow(g, x, y + 0.2, 4, 0.8, 0.15);
    g.strokeStyle = c; g.lineWidth = 0.6;
    for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(x, y - 1 - i * 0.5, 3.2 - i * 0.4, 1.1 - i * 0.1, 0, 0, 6.3); g.stroke(); }
    g.beginPath(); g.moveTo(x + 3, y - 1); g.quadraticCurveTo(x + 7, y + 1.5, x + 10, y - 0.5); g.stroke();
    g.fillStyle = pal.steel; g.fillRect(x + 9.6, y - 1.1, 1.2, 0.8);
  }
  const ITEMS = [
    [486.5, S('w:conesL', 398, 478, 12, 10, (g) => drawCones(g, [[401, 486.5], [406, 487.5]]), () => 0)],
    [486.5, S('w:conesR', 526, 478, 8, 10, (g) => drawCones(g, [[530, 486.5]]), () => 0)],
    [476.2, S('w:hose', 579, 472, 14, 6, drawHose, () => 0)],
    [460, S('w:trailer', 174, 436, 46, 33, drawTrailer, () => (K.S.whistle ? 1 : 0) + (night() > 0.3 ? 2 : 0) + seasonCode() * 10)],
    [471, S('w:canteen', 216, 434, 50, 40, drawCanteen, () => (night() > 0.3 ? 1 : 0))],
    [465.5, S('w:urn', 219, 448, 18, 19, drawUrn, () => 0)],
    [474.5, S('w:picnic', 231, 460, 30, 16, drawPicnic, () => 0)],
    [470.6, S('w:lumber', 266, 452, 28, 21, drawLumber, () => piles.lumber * 100 + Math.round(tarp.lumber * 8))],
    [465, S('w:shedpostL', 290, 429, 5, 37, (g) => shedPost(g, 291.6), () => 0)],
    [465, S('w:shedpostR', 361, 429, 5, 37, (g) => shedPost(g, 362.8), () => 0)],
    [471, S('w:panels', 336, 452, 24, 21, drawPanels, () => piles.panels * 100 + Math.round(tarp.panels * 8))],
    [471, S('w:bricks', 362, 452, 26, 21, drawBricks, () => piles.brick * 100 + Math.round(tarp.brick * 8))],
    [459.5, S('w:sand', 382, 444, 22, 24, drawSand, () => 0)],
    [470.8, S('w:glass', 101, 455, 22, 18, drawGlass, () => piles.glass)],
    [471, S('w:rebar', 137, 462, 28, 11, drawRebar, () => piles.rebar)],
    [479, S('w:nails', 155, 470, 15, 11, drawNails, () => piles.nails)],
    [462, S('w:toolshed', 552, 440, 28, 25, drawToolshed, () => (shedOpen() ? 1 : 0))],
    [466, S('w:stakes', 550, 455, 8, 13, drawStakes, () => piles.stakes)],
    [467, S('w:spools', 576, 457, 15, 12, drawSpools, () => piles.copper)],
    [463, S('w:john', 588, 442, 16, 23, drawJohn, () => 0)],
    [470, S('w:dumpster', 602, 453, 30, 19, drawDumpster, () => 0)],
    [486, S('w:reel', 543, 476, 16, 12, drawReel, () => 0)],
    [469, S('w:benchseat', 664, 462, 36, 10, drawBenchSeat, () => 0)],
    [471.2, S('w:benchback', 664, 459, 36, 14, drawBenchBack, () => 0)],
    [466, S('w:tree', 686, 410, 42, 72, drawTree, () => seasonCode())],
  ].map(([y, s]) => ({ y, draw: (ctx) => K.blit(s.key, s.x, s.y, s.w, s.h, (g) => s.fn(g), { ver: s.verFn() }) }));
  function drawHedge(g) {
    const pal = P(), y0 = 497.6, s = season();
    const c = s === 'winter' || s === 'bare' ? pal.evergreen : pal.treeDark;
    g.fillStyle = c;
    g.beginPath(); g.moveTo(FENCE_END, y0);
    for (let x = FENCE_END; x <= WW + 2; x += 3) g.quadraticCurveTo(x + 1.5, y0 - 6.4 - Math.sin(x * 0.7) * 0.8, x + 3, y0 - 5.2);
    g.lineTo(WW + 2, y0); g.closePath(); g.fill(); ink(g, 0.35);
    g.fillStyle = s === 'winter' ? pal.snow : rgba(pal.white, 0.14); g.fillRect(FENCE_END + 1, y0 - 5.6, WW - FENCE_END, 1);
    if (s === 'summer' || s === 'spring') { const r = rng(5); for (let i = 0; i < 40; i++) { g.fillStyle = r() < 0.5 ? lit('#f4f1e8') : lit('#f0a8b8'); g.beginPath(); g.arc(FENCE_END + 2 + r() * (WW - FENCE_END - 4), y0 - 1 - r() * 4.5, 0.35, 0, 6.3); g.fill(); } }
  }
  const HEDGE = { y: YARD_FRONT - 0.2, draw: () => K.blit('w:hedge', FENCE_END - 1, 488, WW - FENCE_END + 3, 11, drawHedge, { ver: seasonCode() }) };
  const FENCE = { y: YARD_FRONT, draw: () => K.blit('w:fence', 0, 476, FENCE_END + 2, 24, drawFence, { ver: muralCount() + seasonCode() * 100 }) };
  const GATE = { y: YARD_FRONT + 0.05, draw: drawGate };
  const STEAM = { y: 465.6, draw: (ctx) => {
    const t = K.t, pal = K.pal;
    ctx.strokeStyle = rgba(pal.white, 0.45); ctx.lineWidth = 0.35; ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const p = (t * 0.35 + i * 0.5) % 1, x = 228.2 + Math.sin(t * 1.3 + i * 2) * 0.8, y = 448 - p * 7;
      ctx.globalAlpha = 1 - p; ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.quadraticCurveTo(x + 1.2, y + 1, x, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } };
  const passEntries = [];

  function collect(list) {
    for (const e of ITEMS) list.push(e);
    list.push(FENCE, GATE, HEDGE);
    /* steam off the urn on cold days and every morning */
    const m = month(), h = hour();
    if ((m >= 9 || m <= 3 || h < 9) && !K.reduced) list.push(STEAM);
    while (passEntries.length < passers.length) { const e = { y: 0, q: null, draw: null }; e.draw = (ctx) => drawPasser(ctx, e.q); passEntries.push(e); }
    for (let i = 0; i < passers.length; i++) { const e = passEntries[i]; e.q = passers[i]; e.y = passers[i].y; list.push(e); }
    /* the far side: the crew's traffic in the travel lanes, then lamps, trees, benches, the little
       library and the people on the bike path, nearer and nearer */
    if (K.cam.y + K.view.H > STREET_Y + 8) {
      list.push(STREET_E);
      for (const e of FAR_ITEMS) list.push(e);
      while (pathEntries.length < pathers.length) { const e = { y: 0, q: null, draw: null }; e.draw = (ctx) => drawPasser(ctx, e.q); pathEntries.push(e); }
      for (let i = 0; i < pathers.length; i++) { const e = pathEntries[i]; e.q = pathers[i]; e.y = pathers[i].y; list.push(e); }
    }
  }
  const STREET_E = { y: FAR_CURB - 0.2, draw: (ctx) => { if (K.crew && K.crew.drawStreet) K.crew.drawStreet(ctx); } };
  const pathEntries = [];

  /* the back line, one tight cache each (a single wide layer was mostly empty pixels) */
  const BACK = [
    ['w:container', 87, 434, 40, 20, (g) => drawContainer(g), () => seasonCode()],
    ['w:tower', 140, 400, 24, 54, (g) => drawTower(g), () => (night() > 0.3 && working() ? 1 : 0) + seasonCode() * 10],
    ['w:rack', 262, 426, 33, 26, (g) => drawRack(g), () => seasonCode()],
    ['w:shed', 287, 424, 82, 30, (g) => drawShed(g), () => seasonCode() + Math.min(3, piles.nails) * 100],
    ['w:mill', 722, 336, WW - 722, 121, (g, x0, x1) => drawMill(g, x0, x1), () => seasonCode()],
  ];
  /* --------------------------------------------------- draw entries */
  function drawBack(ctx) {
    if (K.director && K.director.drawBack) K.director.drawBack(ctx);
    K.blit('w:ground', 0, GROUND_Y - 9, WW, WH - GROUND_Y + 9, drawGround, { ver: seasonCode() });
    for (const b of BACK) K.blit(b[0], b[1], b[2], b[3], b[4], b[5], { ver: b[6]() });
    /* lights of the night */
    if (night() > 0.25) {
      lights(186, 448, 10, 0.5); lights(196, 448, 8, 0.45);
      lights(241, 452, 16, 0.4); lights(328, 438, 12, 0.45);
      if (working()) { lights(152, 406, 52, 0.55); lights(152, 470, 40, 0.3); }
      lights(843, 446, 8, 0.4); lights(780, 425, 10, 0.3);
      if (K.S.whistle) lights(209, 455, 9, 0.5);
    }
  }
  function drawFront(ctx) {
    /* the crew's street traffic is drawn in its place in the sorted list (STREET_E); this is only
       a fallback for a crew that collects nothing (the call does nothing twice in a frame) */
    if (K.crew && K.crew.drawStreet) K.crew.drawStreet(ctx);
    if (night() > 0.3) for (const x of LAMP_XS) { lights(x, LAMP_Y - 24, 18, 0.5); lights(x, LAMP_Y - 4, 14, 0.25); }
  }

  /* --------------------------------------------------- state */
  function step(dt) {
    const h = hour();
    const want = working() || (h >= 6 && h < 19);
    gate += clamp((want ? 1 : 0) - gate, -dt / 3, dt / 3);
    for (const k of Object.keys(tarp)) tarp[k] = clamp(tarp[k] + (tarpWant[k] ? dt / 1.5 : -dt / 2), 0, 1);
    stepPassers(dt);
    stepPath(dt);
    const m = muralCount();
    if (lastMural >= 0 && m > lastMural) K.emit('mural', { i: m - 1, x: MURAL_X0 + (m - 1) * MURAL_W + MURAL_W / 2, y: 493 });
    lastMural = m;
  }
  const norm = (k) => ALIAS[k] || k;
  return {
    drawBack, drawFront, collect, step,
    pile: (k) => piles[norm(k)] || 0,
    take(k) { k = norm(k); if (piles[k] > 0) piles[k]--; return piles[k] || 0; },
    add(k) { k = norm(k); piles[k] = Math.min(5, (piles[k] || 0) + 1); return piles[k]; },
    spot(zone, name) {
      const z = ZONES[zone];
      if (z && z.spots && z.spots[name]) return z.spots[name];
      if (EXTRA_SPOTS[zone] && EXTRA_SPOTS[zone][name]) return EXTRA_SPOTS[zone][name];
      return [z ? (z.x0 + z.x1) / 2 : 0, GROUND_Y + 20];
    },
    cover(k, on) { k = norm(k); if (k in tarpWant) tarpWant[k] = !!on; },
    covered(k) { k = norm(k); return (tarp[k] || 0) > 0.5; },
    spawn, cheer,
    muralCount,
    muralSpot: (i) => [MURAL_X0 + i * MURAL_W + MURAL_W / 2, 493],
    gateOpen: () => gate,
    passers: () => passers.map((q) => ({ id: q.id, kind: q.kind, x: q.x, y: q.y, state: q.state })),
  };
}
