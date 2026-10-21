/* build-site.js — The Build's job site: Watershed going up on Lakeside Ave,
   drawn and animated on one <canvas>.

   "The animation is the product." Focus Friend is a bean that knits while
   you leave your phone alone; this is a crew raising a real Burlington
   building while you leave yours alone. Your builder is always on a specific
   job that finishes and leaves a mark (a timber post set, a course of brick,
   a window glazed), neighbours on shift are on the site with you, the
   foreman steps out of the trailer for the whistle, and the light follows
   Burlington's sun.

   How it is drawn: the whole scene lives in a small low-resolution buffer
   (about 210 to 400 pixels wide) that the browser scales up with
   `image-rendering: pixelated`. Pixel art at this size costs almost nothing
   to draw, so it can run all evening on an old phone. The sky, the building
   and the sprites are cached and only redrawn when they change; a frame is a
   handful of image copies plus the moving figures. 30fps at most while the
   canvas is on screen, nothing at all while it is hidden or scrolled away.
   Reduced motion draws still frames that still change: every few seconds
   the crew jumps to the next step of their jobs.

   Art: drawn here, in code, from the developer's public rendering (three
   volumes: a ribbed rust wing, a rust block with a charcoal top floor and a
   brick corner block, a dark glass slot between them; storefront glass at
   the street; Lake Champlain and the Adirondacks behind). Our drawing, not
   theirs. Research notes: newsletter/reference/drafts/new-nine-2026-10/
   the-build/research-site-animation.md.

   API (builder C imports this):
     const site = createSite(canvas, { reducedMotion })
     site.setTown({ total_minutes, floors_done, floor_progress, windows_lit, floors?, topped_out? })
     site.setCrew([{ id, look:{ hat, vest }, task, name? }])   neighbours on shift
     site.setYou({ state: 'working'|'paused'|'off'|'away', look, task })
     site.whistle(true|false)
     site.setSky({ sunAltitude, isNight, weather: 'clear'|'cloud'|'rain'|'snow'|'fog' })
     site.dropMaterial(kind)          'lumber'|'brick'|'glass'|'copper'|'nails'
     site.cutaway(true|false, { your_minutes })
     site.destroy()
   Extras for the preview page and tests: site.advance(seconds) runs the
   simulation forward without drawing in between; site.stats() returns frame
   timings; site.render() draws one frame now.

   Vocabulary: tasks are build-core's BUILD_RULES.tasks (haul, frame, brick,
   wire, window, roof, lunch); hats and vests take build-core's colour names
   (yellow, white, orange, blue, red, green / orange, lime, yellow, pink,
   blue), the app's token names (amber, lake, brick, park) or a #hex. Anything
   else is hashed onto the palette, so a new colour never breaks the site.
   sunAltitude is in degrees (negative below the horizon). */

/* ================================================================ palette */
const BASE = {
  outline: '#2b1d1a',
  rust: '#b46545', rustMid: '#9f5b3b', rustGroove: '#7a442d', rustBack: '#a35a3d', rustBackGroove: '#6e3d29',
  brick: '#8a5340', brickDark: '#5e3a30', mortar: '#a77a64', brickSpeck: '#9c5f49',
  charcoal: '#3a3430', charcoalLine: '#2a2522',
  timber: '#c8a27a', timberShade: '#9a7550', timberDark: '#7a5a3c',
  concrete: '#aaa59b', concreteShade: '#87827a',
  coping: '#cfc6b6', roof: '#918577',
  glass: '#6f8ca6', glassHi: '#a9c4d8', glassDark: '#2e3b48', glassDarkHi: '#4d6274',
  interior: '#3b302a', interiorDeep: '#2a221e',
  copper: '#d9824a', pipe: '#5f8fbf',
  grass: '#7d9a4f', grassDark: '#62803d',
  dirt: '#b59d7c', dirtDark: '#9c8566', dirtSpeck: '#c9b392', gravel: '#a49a8b',
  sidewalk: '#cfc8ba', sidewalkLine: '#b7af9f', asphalt: '#4a4f5a', asphaltLine: '#e8d77a',
  treeDark: '#3e5a35', tree: '#4f6f3f', treeLight: '#6b8a4a', trunk: '#5a4632',
  autumnA: '#c4572e', autumnB: '#d99a3a',
  mill: '#9a5a44', millDark: '#7a4536', millWin: '#5c6d78', millRoof: '#6d6a66',
  trailer: '#e6dfcf', trailerShade: '#c4bba7', trailerTrim: '#8f8574', door: '#6b4a3a', step: '#7d776c',
  scaffold: '#9aa3ab', scaffoldDark: '#6c757d', plank: '#c79a5c', netting: '#e07a2e',
  crane: '#e8b923', craneDark: '#b88e14', cable: '#3a3a3a', weight: '#7d7d7d',
  fork: '#f0a020', forkDark: '#b8740f', tire: '#26262a', mast: '#4a4a4f',
  fence: '#8c949b', fenceMesh: '#a8b0b6', sign: '#f2efe6', signInk: '#2f6fb2',
  pallet: '#a8875a', palletDark: '#7b6142',
  dumpster: '#3f6e4f', dumpsterDark: '#2c5038', john: '#3d7bd9', johnDark: '#2a5aa8',
  pants: '#3b4660', pantsShade: '#2c3449', boots: '#4a3426', shirt: '#5a6a8a', shirtFore: '#6b5a8a',
  hair: '#3d2b20', mug: '#f4f1e8', coffee: '#6b4a3a', sandwich: '#e8c27a', bread: '#c99a5c',
  white: '#f4f1e8', snow: '#eef3f7', snowShade: '#b9c6d8', ice: '#d6e2ec',
  solar: '#2c3e63', solarHi: '#5574a8', evergreen: '#2f6b3a', evergreenLight: '#3f8a4a', flag: '#d9443a',
  marker: '#ffcf3a', markerShade: '#d99a1a', hiYou: '#ffcf3a',
};
/* Things that make their own light: never darkened at night. */
const EMIT = {
  lamp: '#ffe9a8', lampGlow: '#ffb347', winLit: '#f6d58e', winLitDeep: '#e9b765', craneRed: '#ff4a3d',
  doorLit: '#f3cf86', moon: '#f2efe0', star: '#e8ecf7', sun: '#fff1c4', sunLow: '#ffc27a',
};
const HATS = { yellow: '#f2c230', white: '#f4f1e8', orange: '#f07f2a', blue: '#3d7bd9', red: '#d9443a', green: '#3fae5a',
  amber: '#f2b134', lake: '#2f6fb2', brick: '#b55a3c', park: '#2f8a5a', pink: '#ff7fae', lime: '#b8e03a' };
const VESTS = { orange: '#ff8a2a', lime: '#c8f03c', yellow: '#f5e23a', pink: '#ff6fa8', blue: '#4c95ff',
  amber: '#f7b84a', lake: '#4c95ff', brick: '#ff7a4a', park: '#5fd08a', green: '#5fd08a', red: '#ff5a4a', white: '#e8e8e0' };
const SKINS = ['#f1c9a0', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#b9774e'];

const WW = 640, WH = 480;                     // the world, in site pixels
const SUN_X = 268;                            // where the evening sun sets, behind the Adirondacks

export const SITE_TASKS = ['haul', 'frame', 'brick', 'wire', 'window', 'roof', 'lunch'];
export const SITE_MATERIALS = ['lumber', 'brick', 'glass', 'copper', 'nails'];

/* ================================================================ helpers */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function hash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h >>> 0; }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbHex([r, g, b]) { return '#' + ((1 << 24) | (clamp(Math.round(r), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(b), 0, 255)).toString(16).slice(1); }
function mix(a, b, t) { const x = hexRgb(a), y = hexRgb(b); return rgbHex([lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)]); }
function lookColor(v, table, id, salt) {
  if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) return v;
  if (typeof v === 'string' && table[v]) return table[v];
  const vals = Object.values(table); return vals[hash(String(id) + salt) % vals.length];
}

/* A tiny 3x5 pixel font for names on hover and the site sign. */
const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', ' ': '000000000000000', '.': '000000000000010', "'": '010010000000000', '-': '000000111000000',
};
function textWidth(s) { return s.length * 4 - 1; }
function drawText(ctx, s, x, y, color) {
  ctx.fillStyle = color;
  for (let i = 0; i < s.length; i++) {
    const g = FONT[s[i].toUpperCase()] || FONT[' '];
    for (let j = 0; j < 15; j++) if (g[j] === '1') ctx.fillRect(x + i * 4 + (j % 3), y + ((j / 3) | 0), 1, 1);
  }
}

/* ============================================================ the figures
   9 wide, 14 tall, facing right, feet on the bottom row. Letters are
   roles that the look and the light colour in: H hat, h hat shade, b brim,
   S skin, s skin shade, E eye, r hair, V vest, v vest shade, R reflective
   stripe, T shirt sleeve, P pants, p pants shade, B boots, M mug, C coffee,
   K steel, k handle, L lumber, l lumber shade, Y brick, G glass, g glass
   shine, W wire spool copper, w sandwich, o outline. */
const HEAD = [
  '.........',
  '...hHH...',
  '..hHHHHH.',
  '..bbbbbbb',
  '...sSES..',
  '...sSSS..',
];
const HEAD_FRONT = [
  '.........',
  '...hHHH..',
  '..hHHHHH.',
  '.bbbbbbbb',
  '..SESES..',
  '..sSSSS..',
];
const HEAD_BACK = [
  '.........',
  '...hHHH..',
  '..hHHHHH.',
  '.bbbbbbb.',
  '..sssss..',
  '...sss...',
];
const HEAD_HATOFF = [
  '.........',
  '.........',
  '...rrr...',
  '..rrrrr..',
  '...rSES..',
  '...sSSS..',
];
const HEAD_FRONT_HATOFF = [
  '.........',
  '.........',
  '..rrrrr..',
  '..rrrrr..',
  '..SESES..',
  '..sSSSS..',
];
const BODY = ['...vVVT..', '...VRRT..', '...vVVT..', '...pPPS..'];
const BODY_FRONT = ['..TVVVT..', '..TRRRT..', '..TVVVT..', '..SPPPS..'];
const BODY_BACK = ['..TvvvT..', '..TRRRT..', '..TvvvT..', '..SpppS..'];
const LEGS = {
  stand: ['...pPP...', '...p.P...', '...p.P...', '...BBBB..'],
  walkA: ['...pPP...', '..pp.PP..', '..p...P..', '.BB...BB.'],
  walkB: ['...pPP...', '...pPP...', '....PP...', '...BBB...'],
  front: ['..pPPP...', '..p..P...', '..p..P...', '.BB..BB..'],
  climbA: ['..pPPP...', '..p..P...', '..p......', '.BB......'],
  climbB: ['..pPPP...', '..p..P...', '.....P...', '.....BB..'],
  sit: ['...pPPPP.', '.....p.P.', '.....p.P.', '.....BBB.'],
  bend: ['...pPP...', '...p.P...', '..pp.PP..', '..BB.BB..'],
};
/* Extra pixels per pose, [x, y, role], drawn over head/body/legs. */
const ARMS = {
  stand: [],
  carry: [[6, 6, 'T'], [7, 5, 'S'], [2, 5, 'L'], [3, 5, 'L'], [4, 5, 'L'], [5, 5, 'L'], [6, 5, 'L'], [7, 4, 'L'], [8, 4, 'l'], [1, 5, 'l']],
  hammerUp: [[6, 6, 'T'], [7, 5, 'T'], [7, 4, 'S'], [7, 3, 'k'], [7, 2, 'k'], [6, 1, 'K'], [7, 1, 'K'], [8, 1, 'K']],
  hammerDown: [[6, 7, 'T'], [7, 8, 'S'], [8, 8, 'k'], [8, 9, 'K'], [8, 10, 'K']],
  trowelA: [[6, 7, 'T'], [7, 8, 'S'], [8, 8, 'K'], [8, 9, 'K']],
  trowelB: [[6, 7, 'T'], [7, 7, 'S'], [8, 6, 'K'], [8, 7, 'K']],
  drillA: [[6, 7, 'T'], [7, 7, 'S'], [8, 7, 'K'], [8, 6, 'K']],
  drillB: [[6, 7, 'T'], [7, 7, 'S'], [8, 7, 'K'], [8, 6, 'K'], [8, 5, 'g']],
  pullA: [[6, 6, 'T'], [7, 6, 'S'], [8, 6, 'W'], [8, 7, 'W']],
  pullB: [[6, 7, 'T'], [7, 8, 'S'], [8, 8, 'W'], [8, 9, 'W']],
  glass: [[6, 6, 'T'], [7, 6, 'S'], [6, 2, 'G'], [7, 2, 'G'], [8, 2, 'g'], [6, 3, 'G'], [7, 3, 'g'], [8, 3, 'G'], [6, 4, 'g'], [7, 4, 'G'], [8, 4, 'G'], [6, 5, 'G'], [7, 5, 'G'], [8, 5, 'G']],
  bricks: [[6, 7, 'T'], [7, 8, 'S'], [7, 9, 'Y'], [8, 9, 'Y'], [7, 10, 'Y'], [8, 10, 'Y']],
  spool: [[6, 7, 'T'], [7, 8, 'S'], [7, 9, 'W'], [8, 9, 'W'], [7, 10, 'W'], [8, 10, 'W']],
  mug: [[6, 7, 'T'], [7, 8, 'S'], [7, 7, 'M'], [8, 7, 'M'], [7, 8, 'M'], [8, 8, 'C']],
  drink: [[6, 6, 'T'], [7, 5, 'S'], [6, 4, 'M'], [7, 4, 'M']],
  sandwich: [[6, 7, 'T'], [7, 6, 'S'], [6, 5, 'w'], [7, 5, 'w']],
  wave: [[6, 6, 'T'], [7, 5, 'T'], [7, 4, 'S'], [7, 3, 'S']],
  hatInHand: [[6, 7, 'T'], [6, 8, 'S'], [6, 9, 'H'], [7, 9, 'H'], [5, 10, 'h'], [6, 10, 'b'], [7, 10, 'b'], [8, 10, 'b']],
  signalA: [[6, 6, 'T'], [7, 5, 'T'], [8, 4, 'S'], [2, 6, 'T'], [1, 5, 'T'], [0, 4, 'S']],
  signalB: [[6, 6, 'T'], [7, 6, 'T'], [8, 6, 'S'], [2, 6, 'T'], [1, 6, 'T'], [0, 6, 'S']],
  measure: [[6, 7, 'T'], [7, 7, 'S'], [8, 7, 'Y'], [8, 8, 'M']],
  climb: [[2, 5, 'T'], [2, 4, 'S'], [6, 6, 'T'], [6, 5, 'S']],
  climbB: [[2, 6, 'T'], [2, 5, 'S'], [6, 5, 'T'], [6, 4, 'S']],
  frontArms: [],
  frontWave: [[7, 5, 'T'], [7, 4, 'S'], [7, 3, 'S']],
  frontRaise: [[7, 5, 'T'], [7, 4, 'T'], [7, 3, 'S'], [7, 2, 'S'], [6, 4, 'K']],
  frontMug: [[6, 9, 'M'], [7, 9, 'M'], [6, 10, 'M'], [7, 10, 'C']],
  sweepA: [[6, 7, 'T'], [7, 8, 'S'], [8, 9, 'k'], [8, 10, 'k'], [8, 11, 'k'], [7, 12, 'Y'], [8, 12, 'Y'], [9, 12, 'Y']],
  sweepB: [[6, 7, 'T'], [7, 8, 'S'], [7, 9, 'k'], [6, 10, 'k'], [5, 11, 'k'], [4, 12, 'Y'], [5, 12, 'Y'], [6, 12, 'Y']],
  plantA: [[6, 7, 'T'], [7, 8, 'S'], [8, 9, 'k'], [8, 10, 'K']],
};
/* pose -> [head, body, legs, arms] */
const POSES = {
  stand: [HEAD, BODY, 'stand', 'stand'], walkA: [HEAD, BODY, 'walkA', 'stand'], walkB: [HEAD, BODY, 'walkB', 'stand'],
  carryA: [HEAD, BODY, 'walkA', 'carry'], carryB: [HEAD, BODY, 'walkB', 'carry'], carry: [HEAD, BODY, 'stand', 'carry'],
  glassA: [HEAD, BODY, 'walkA', 'glass'], glassB: [HEAD, BODY, 'walkB', 'glass'], glass: [HEAD, BODY, 'stand', 'glass'],
  bricksA: [HEAD, BODY, 'walkA', 'bricks'], bricksB: [HEAD, BODY, 'walkB', 'bricks'],
  spoolA: [HEAD, BODY, 'walkA', 'spool'], spoolB: [HEAD, BODY, 'walkB', 'spool'],
  mugA: [HEAD, BODY, 'walkA', 'mug'], mugB: [HEAD, BODY, 'walkB', 'mug'], mug: [HEAD, BODY, 'stand', 'mug'],
  hammerUp: [HEAD, BODY, 'stand', 'hammerUp'], hammerDown: [HEAD, BODY, 'stand', 'hammerDown'],
  trowelA: [HEAD, BODY, 'bend', 'trowelA'], trowelB: [HEAD, BODY, 'bend', 'trowelB'],
  drillA: [HEAD, BODY, 'stand', 'drillA'], drillB: [HEAD, BODY, 'stand', 'drillB'],
  pullA: [HEAD, BODY, 'stand', 'pullA'], pullB: [HEAD, BODY, 'bend', 'pullB'],
  drink: [HEAD, BODY, 'stand', 'drink'], wave: [HEAD, BODY, 'stand', 'wave'],
  signalA: [HEAD, BODY, 'stand', 'signalA'], signalB: [HEAD, BODY, 'stand', 'signalB'],
  measure: [HEAD, BODY, 'bend', 'measure'], bend: [HEAD, BODY, 'bend', 'trowelA'],
  sweepA: [HEAD, BODY, 'stand', 'sweepA'], sweepB: [HEAD, BODY, 'walkB', 'sweepB'], plant: [HEAD, BODY, 'bend', 'plantA'],
  climbA: [HEAD_BACK, BODY_BACK, 'climbA', 'climb'], climbB: [HEAD_BACK, BODY_BACK, 'climbB', 'climbB'],
  sitA: [HEAD, BODY, 'sit', 'sandwich'], sitB: [HEAD, BODY, 'sit', 'stand'], sitMug: [HEAD, BODY, 'sit', 'drink'],
  front: [HEAD_FRONT, BODY_FRONT, 'front', 'frontArms'], frontWave: [HEAD_FRONT, BODY_FRONT, 'front', 'frontWave'],
  frontRaise: [HEAD_FRONT, BODY_FRONT, 'front', 'frontRaise'], frontMug: [HEAD_FRONT, BODY_FRONT, 'front', 'frontMug'],
  hatoffA: [HEAD_HATOFF, BODY, 'walkA', 'hatInHand'], hatoffB: [HEAD_HATOFF, BODY, 'walkB', 'hatInHand'],
  hatoff: [HEAD_HATOFF, BODY, 'stand', 'hatInHand'], frontHatoff: [HEAD_FRONT_HATOFF, BODY_FRONT, 'front', 'frontArms'],
};

/* ================================================================ the site */
export function createSite(canvas, opts = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const reduced = opts.reducedMotion != null ? !!opts.reducedMotion
    : (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const nowDate = opts.now || (() => new Date());
  canvas.style.imageRendering = 'pixelated';

  /* ---------------------------------------------------------- state */
  const S = {
    town: { total_minutes: 0, floors_done: 0, floor_progress: 0, windows_lit: 0, floors: 6, topped_out: false },
    sky: { sunAltitude: 30, isNight: false, weather: 'clear', hour: null },
    whistle: false, cut: false, yourMinutes: 0,
    marks: new Set(), solar: 0, trees: 0, baseStack: 0,
    piles: { lumber: 3, brick: 2, glass: 2, copper: 1, nails: 1 },
    deliveries: [], particles: [], t: 0, toppedAt: null,
  };
  let W = 0, H = 0, L = null;            // logical size and layout
  let pal = {}, palKey = '', ambient = [1, 1, 1], night = 0, snowy = false;
  let bgCache = null, bldCache = null, fgCache = null, bgDirty = true, bldDirty = true;
  const spriteCache = new Map();
  const agents = new Map();              // id -> agent (crew + you)
  let you = null;
  let destroyed = false, raf = 0, lastFrame = 0, visible = true, onScreen = true, rmTimer = 0;
  const stats = { frames: 0, total: 0, max: 0, last: 0, samples: [] };
  let hover = null, hoverUntil = 0;
  const R = rng(hash('watershed'));

  /* -------------------------------------------------------- the light */
  function setLight() {
    const sk = S.sky, w = sk.weather || 'clear';
    let a = typeof sk.sunAltitude === 'number' ? sk.sunAltitude : (sk.isNight ? -15 : 30);
    if (sk.isNight && a > -4) a = -8;
    const hour = sk.hour != null ? sk.hour : nowDate().getHours() + nowDate().getMinutes() / 60;
    const evening = hour >= 12;
    S.evening = evening; S.alt = a;
    /* key frames: altitude -> [ambient rgb, sky top, sky horizon] */
    const K = evening ? [
      [-12, [0.27, 0.31, 0.5], '#0e1430', '#26305a'],
      [-5, [0.38, 0.38, 0.58], '#1f2a55', '#5a5e8a'],
      [0, [0.72, 0.6, 0.66], '#3b4373', '#f0a676'],
      [6, [0.95, 0.82, 0.76], '#6f8fc0', '#f4c08a'],
      [15, [1, 0.97, 0.93], '#6aa6d9', '#e6e2d2'],
      [30, [1, 1, 1], '#6aa6d9', '#d6e8f2'],
    ] : [
      [-12, [0.27, 0.31, 0.5], '#0e1430', '#26305a'],
      [-5, [0.42, 0.42, 0.6], '#2a3566', '#7a7aa8'],
      [0, [0.8, 0.72, 0.78], '#4a5c8f', '#f1c9a0'],
      [6, [1.04, 0.95, 0.86], '#78a8d6', '#f4d6aa'],
      [15, [1.02, 0.99, 0.95], '#6aa6d9', '#e4e6dc'],
      [30, [1, 1, 1], '#6aa6d9', '#d6e8f2'],
    ];
    let i = 0; while (i < K.length - 2 && a > K[i + 1][0]) i++;
    const k0 = K[i], k1 = K[i + 1], t = clamp((a - k0[0]) / (k1[0] - k0[0]), 0, 1);
    let amb = [0, 1, 2].map((j) => lerp(k0[1][j], k1[1][j], t));
    let top = mix(k0[2], k1[2], t), hor = mix(k0[3], k1[3], t);
    night = clamp((2 - a) / 10, 0, 1);    // 0 day … 1 full night (work lights on from dusk)
    const wx = { cloud: [[0.86, 0.88, 0.93], '#9fb0c0', '#c8d0d6', 0.55], rain: [[0.74, 0.77, 0.85], '#7d8a98', '#a8b2bb', 0.7],
      fog: [[0.88, 0.89, 0.92], '#c3c9cd', '#d6dadc', 0.75], snow: [[0.9, 0.92, 0.98], '#b8c3cf', '#dfe5ea', 0.65] }[w];
    if (wx) {
      amb = amb.map((v, j) => v * lerp(1, wx[0][j], 1 - night * 0.6));
      top = mix(top, mix(wx[1], '#1a2030', night * 0.85), wx[3]);
      hor = mix(hor, mix(wx[2], '#2a3040', night * 0.85), wx[3]);
    }
    ambient = amb.map((v) => Math.round(v * 40) / 40);
    const month = nowDate().getMonth();
    snowy = w === 'snow' || (sk.snowCover != null ? !!sk.snowCover : false) || (w !== 'rain' && (month === 0 || month === 1) && sk.snowCover !== false);
    S.skyTop = top; S.skyHor = hor; S.weather = w;
    const key = ambient.join(',') + '|' + top + hor + '|' + snowy + w;
    if (key === palKey) return;
    palKey = key;
    pal = {};
    for (const k in BASE) pal[k] = shade(BASE[k]);
    for (const k in EMIT) pal[k] = EMIT[k];
    pal.skyTop = top; pal.skyHor = hor;
    spriteCache.clear(); bgDirty = true; bldDirty = true;
  }
  function shade(hex) { const c = hexRgb(hex); return rgbHex([c[0] * ambient[0], c[1] * ambient[1], c[2] * ambient[2]]); }

  /* ------------------------------------------------- world + camera
     The site is a fixed world (WW x WH site pixels). The canvas is a camera
     onto it: a resize changes only how much of the world shows and how big a
     site pixel is, never the scene, so nobody restarts their job when the
     panel expands to full screen. Small frames zoom in on the action instead
     of shrinking everything. */
  const cam = { x: 0, y: 0, tx: 0, ty: 0, snap: true };
  function layout() {
    const r = canvas.getBoundingClientRect();
    const cw = Math.max(1, r.width || canvas.clientWidth || 300), ch = Math.max(1, r.height || canvas.clientHeight || 200);
    /* CSS px per site pixel: show at least 214 x 172 of the world, and no
       more than 260 tall (a tall phone zooms in rather than showing sky) */
    let s = Math.min(ch / 172, cw / 214);
    s = Math.max(s, ch / 260, cw / WW, ch / WH, 0.5);
    const nW = clamp(Math.round(cw / s), 40, WW), nH = clamp(Math.round(ch / s), 40, WH);
    if (nW === W && nH === H && L) return false;
    W = nW; H = nH;
    canvas.width = W; canvas.height = H;
    if (!L) buildWorld();
    aimCamera(0); cam.x = clamp(cam.x, 0, WW - W); cam.y = clamp(cam.y, 0, WH - H);
    if (cam.snap) { cam.x = cam.tx; cam.y = cam.ty; cam.snap = false; }
    return true;
  }
  function aimCamera(dt) {
    if (!L) return;
    /* what must be in view: the building and its crew, you, and the foreman
       when he's out for the whistle */
    const b0 = L.towerX - 4, b1 = L.craneX + 8;
    const meX = you && !you.gone && you.x > L.gateX - 20 ? you.x : null;
    const foremanOut = S.whistle || foreman.phase !== 'in';
    const doorX = L.trailerX + L.trailerW - 6;
    let lo = Math.min(b0, L.trailerX - 4), hi = b1;
    if (meX != null) { lo = Math.min(lo, meX - 14); hi = Math.max(hi, meX + 14); }
    let cx;
    if (hi - lo <= W) cx = (lo + hi) / 2;
    else {
      const bc = (L.bx + L.BW / 2);
      const p = foremanOut ? doorX + 10 : meX != null ? meX : bc;
      cx = foremanOut && meX != null && Math.abs(meX - doorX) < W - 30 ? (meX + doorX) / 2 : lerp(p, bc, foremanOut ? 0.15 : 0.3);
      if (foremanOut) cx = clamp(cx, doorX - W / 2 + 18, doorX + W / 2 - 24);
    }
    cam.tx = clamp(Math.round(cx - W / 2), 0, WW - W);
    /* vertical: street at the bottom when there's room, else keep the
       working level (and you) in view and crop the yard */
    const lvTop = (topped() ? L.roofY - 20 : L.fBottom[Math.min(activeFloor() + 1, L.floors)] - 12);
    let top = lvTop;
    if (you && !you.gone && you.y) top = Math.min(top, you.y - 22);
    let ty = WH - H;
    if (top < ty) ty = Math.max(0, Math.min(top, L.groundY + 18 - H));
    cam.ty = clamp(Math.round(ty), 0, WH - H);
    if (dt > 0 && !reduced) {
      const k = Math.min(1, dt * 1.8);
      cam.x += (cam.tx - cam.x) * k; cam.y += (cam.ty - cam.y) * k;
      if (Math.abs(cam.tx - cam.x) < 0.3) cam.x = cam.tx;
      if (Math.abs(cam.ty - cam.y) < 0.3) cam.y = cam.ty;
    } else if (dt === 0 && reduced) { cam.x = cam.tx; cam.y = cam.ty; }
  }
  function buildWorld() {
    const floors = clamp(S.town.floors | 0 || 6, 2, 12);
    const yard = 34;
    const groundY = WH - yard;
    /* bays: left wing 3, middle 4, glass slot, brick corner 3 */
    const bays = [];
    let x = 0;
    for (let i = 0; i < 3; i++) { bays.push({ x, w: 11, vol: 'L' }); x += 11; }
    for (let i = 0; i < 4; i++) { bays.push({ x, w: 11, vol: 'M' }); x += 11; }
    bays.push({ x, w: 6, vol: 'G' }); x += 6;
    for (let i = 0; i < 3; i++) { bays.push({ x, w: 10, vol: 'C' }); x += 10; }
    const BW = x;
    const bx = 302;
    const fh = (f) => (f === 0 ? 17 : 13);
    const fBottom = []; let y = groundY;
    for (let f = 0; f <= floors; f++) { fBottom.push(y); y -= fh(f); }
    const roofY = fBottom[floors];
    bays.forEach((b) => { b.ax = bx + b.x; b.cx = bx + b.x + (b.w >> 1); });
    const lanes = [groundY + 4, groundY + 7, groundY + 10, groundY + 13];
    const street = groundY + yard - 7;
    const gateX = 190;                        // gate posts at gateX and gateX + 12
    const trailerX = 222;
    L = {
      floors, groundY, bays, BW, bx, fh, fBottom, roofY, lanes, street, gateX, trailerX,
      trailerW: 28, trailerH: 13,
      towerX: bx - 8,                         // scaffold stair tower, 6 wide, ladder at towerX+3
      craneX: bx + BW + 4,
      millX: bx + BW + 16,
      pileX: { lumber: trailerX + 30, brick: trailerX + 41, glass: trailerX + 50, copper: trailerX + 36, nails: trailerX + 47 },
      lightX: gateX + 26,
      johnX: gateX + 16,
      deliverX: gateX + 16,
      forkPark: bx - 14,
      horizon: groundY - 50,
    };
    bgCache = bldCache = null; bgDirty = bldDirty = true;
  }

  /* ------------------------------------------------- the build state */
  const NB = 11, SUBS = 3;
  const CELLS = NB * (3 + SUBS);              // frame, wire, wall x3, window
  function activeFloor() { return S.town.topped_out || S.town.floors_done >= L.floors ? L.floors : clamp(S.town.floors_done | 0, 0, L.floors); }
  function topped() { return activeFloor() >= L.floors; }
  function cellIndex(phase, b, sub = 0) {
    if (phase === 'frame') return b;
    if (phase === 'wire') return NB + b;
    if (phase === 'wall') return NB * 2 + sub * NB + b;
    return NB * (2 + SUBS) + b;                // window
  }
  function cellKey(phase, b, sub = 0) { return activeFloor() + ':' + cellIndex(phase, b, sub); }
  function baseline() { return Math.floor(clamp(+S.town.floor_progress || 0, 0, 1) * CELLS); }
  function done(phase, b, sub = 0) { return cellIndex(phase, b, sub) < baseline() || S.marks.has(cellKey(phase, b, sub)); }
  function wallLevel(b) { let s = 0; while (s < SUBS && done('wall', b, s)) s++; return s; }
  function extraMarks() { const k = baseline(), f = activeFloor() + ':'; let n = 0; for (const m of S.marks) if (m.startsWith(f) && +m.slice(f.length) >= k) n++; return n; }
  const MARK_CAP = 12;                         // how far the crew on screen may run ahead of the town's hours
  function canDo(phase, b) {
    if (done(phase === 'wall' ? 'wall' : phase, b, phase === 'wall' ? wallLevel(b) : 0)) return false;
    if (phase === 'frame') return true;
    if (!done('frame', b)) return false;
    if (phase === 'wire') return true;
    if (phase === 'wall') return wallLevel(b) < SUBS && (wallLevel(b) > 0 || done('wire', b) || S.town.floors_done === 0);
    if (phase === 'window') return wallLevel(b) >= SUBS;
    return false;
  }
  function addMark(phase, b) {
    if (topped()) return false;
    if (extraMarks() >= MARK_CAP) return false;
    if (!canDo(phase, b)) return false;
    const sub = phase === 'wall' ? wallLevel(b) : 0;
    S.marks.add(cellKey(phase, b, sub));
    bldDirty = true; saveMarks();
    return true;
  }
  const MARKS_KEY = 'bd-site-marks';
  function saveMarks() { try { localStorage.setItem(MARKS_KEY, JSON.stringify({ f: activeFloor(), m: [...S.marks], solar: S.solar, trees: S.trees })); } catch (e) { /* private mode: marks just don't survive a reload */ } }
  function loadMarks() {
    try {
      const v = JSON.parse(localStorage.getItem(MARKS_KEY) || 'null');
      if (v && Array.isArray(v.m)) { v.m.forEach((m) => S.marks.add(String(m))); S.solar = v.solar | 0; S.trees = v.trees | 0; }
    } catch (e) { /* nothing saved, or storage blocked */ }
  }
  function pruneMarks() { const f = activeFloor() + ':'; for (const m of [...S.marks]) if (!m.startsWith(f)) S.marks.delete(m); }

  /* which bay a phase should go to next, near x, not taken by someone else */
  function pickBay(phase, nearX, taken) {
    let best = -1, bd = 1e9;
    for (let b = 0; b < NB; b++) {
      if (taken.has(phase + b)) continue;
      if (!canDo(phase, b)) continue;
      const d = Math.abs(L.bays[b].cx - nearX) + (phase === 'wall' && L.bays[b].vol === 'C' ? -6 : 0);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  function reserved(except) { const s = new Set(); for (const a of agents.values()) if (a !== except && a.target) s.add(a.target); return s; }

  /* ============================================================ agents */
  function makeAgent(id, me) {
    const seed = hash(id);
    return { id, me, seed, r: rng(seed), look: {}, colors: null, task: null, name: null,
      x: 0, y: 0, level: 'g', facing: 1, pose: 'stand', t: 0, anim: 0, plan: [], act: null, carry: null,
      state: 'working', gone: false, lane: L ? L.lanes[seed % L.lanes.length] : 0, target: null, sinceBreak: 0, coffee: false, dropped: null };
  }
  function colorsFor(a) {
    const look = a.look || {};
    return { H: lookColor(look.hat, HATS, a.id, 'h'), V: lookColor(look.vest, VESTS, a.id, 'v'),
      S: look.skin && /^#/.test(look.skin) ? look.skin : SKINS[a.seed % SKINS.length], hair: ['#3d2b20', '#1f1a17', '#7a4a2a', '#c9a36a', '#8a8a8a'][(a.seed >> 4) % 5] };
  }
  function laneY(a) { return a.lane; }
  function levelY(level) {
    if (level === 'g') return null;
    const f = activeFloor();
    if (level === 'w') return f >= L.floors ? L.roofY : L.fBottom[f];
    if (level === 'beam') return L.fBottom[Math.min(f + 1, L.floors)] + 3;
    return null;
  }
  function yFor(a) { return a.level === 'g' ? (a.street ? L.street - 1 : laneY(a)) : levelY(a.level); }
  function workLevel() { return activeFloor() === 0 ? 'g' : 'w'; }
  function ladderX() { return L.towerX + 3; }

  /* the job each task means at the current stage of the building */
  function phaseOf(task) {
    if (topped()) return { frame: 'solar', roof: 'solar', brick: 'plant', window: 'plant', wire: 'sweep', haul: 'haul', lunch: 'lunch' }[task] || 'sweep';
    return { frame: 'frame', roof: 'crane', brick: 'wall', wire: 'wire', window: 'window', haul: 'haul', lunch: 'lunch' }[task] || 'frame';
  }
  const MATERIAL = { frame: 'lumber', wall: 'brick', wire: 'copper', window: 'glass', solar: 'glass' };
  const CARRY_POSE = { lumber: 'carry', brick: 'bricks', copper: 'spool', glass: 'glass', mug: 'mug', nails: 'bricks' };

  function stationTask(a) {
    const t = SITE_TASKS.includes(a.task) ? a.task : SITE_TASKS[a.seed % 6];
    return t;
  }
  function walkTo(plan, a, level, x) {
    /* moves between levels go by the ladder */
    plan.push({ k: 'goto', level, x });
  }
  function planFor(a) {
    const plan = [];
    if (a.state === 'away') {
      plan.push({ k: 'goto', level: 'g', x: L.trailerX - 4 + (a.me ? 0 : (a.seed % 5)) });
      plan.push({ k: 'idle', pose: 'sitMug', dur: 6 + a.r() * 6, sit: true });
      plan.push({ k: 'idle', pose: 'sitB', dur: 3 + a.r() * 4, sit: true, look: 'lake' });
      return plan;
    }
    if (a.state === 'off') { plan.push({ k: 'leave' }); return plan; }
    const task = stationTask(a);
    let phase = phaseOf(task);
    const wl = workLevel();
    /* a short break now and then: coffee, a look at the lake, a stretch */
    if (a.sinceBreak > 140 + (a.seed % 60) && phase !== 'lunch') {
      a.sinceBreak = 0;
      const kinds = ['drink', 'lake', 'wipe'];
      const k = kinds[(a.r() * kinds.length) | 0];
      if (k === 'drink') plan.push({ k: 'idle', pose: 'drink', dur: 3 + a.r() * 2 });
      else if (k === 'lake') plan.push({ k: 'idle', pose: 'stand', dur: 4 + a.r() * 3, face: -1 });
      else plan.push({ k: 'idle', pose: 'front', dur: 2.5 });
      return plan;
    }
    if (phase === 'lunch') {
      if (activeFloor() > 0 && !topped()) {
        const beams = L.bays.map((b, i) => i).filter((i) => done('frame', i) && L.bays[i].vol !== 'G');
        if (beams.length) {
          const b = beams[a.seed % beams.length];
          walkTo(plan, a, 'w', L.bays[b].cx);
          plan.push({ k: 'hop', level: 'beam' });
          plan.push({ k: 'idle', pose: 'sitA', dur: 25 + a.r() * 30, sit: true, chew: true });
          plan.push({ k: 'idle', pose: 'sitMug', dur: 10 + a.r() * 10, sit: true });
          plan.push({ k: 'idle', pose: 'sitB', dur: 15 + a.r() * 20, sit: true, look: 'lake' });
          plan.push({ k: 'hop', level: 'w' });
          return plan;
        }
      }
      const px = L.pileX.lumber + 2 + (a.seed % 6);
      walkTo(plan, a, 'g', px);
      plan.push({ k: 'idle', pose: 'sitA', dur: 30 + a.r() * 30, sit: true, chew: true });
      plan.push({ k: 'idle', pose: 'sitB', dur: 15 + a.r() * 15, sit: true, look: 'lake' });
      return plan;
    }
    if (phase === 'haul') {
      const kinds = ['lumber', 'brick', 'glass', 'copper'];
      const m = kinds[(a.r() * kinds.length) | 0];
      walkTo(plan, a, 'g', L.pileX[m] + 2);
      plan.push({ k: 'pick', item: m });
      walkTo(plan, a, 'g', L.towerX - 3 - (a.seed % 4));
      plan.push({ k: 'drop', to: 'base' });
      plan.push({ k: 'idle', pose: 'stand', dur: 1 + a.r() * 2 });
      return plan;
    }
    if (phase === 'sweep') {
      const lv = topped() ? 'w' : wl;
      const x0 = L.bx + 6 + ((a.r() * (L.BW - 12)) | 0);
      walkTo(plan, a, lv, x0);
      plan.push({ k: 'work', pose: ['sweepA', 'sweepB'], dur: 8 + a.r() * 6, rate: 3 });
      walkTo(plan, a, lv, clamp(x0 + (a.r() < 0.5 ? -14 : 14), L.bx + 4, L.bx + L.BW - 4));
      plan.push({ k: 'work', pose: ['sweepA', 'sweepB'], dur: 6 + a.r() * 6, rate: 3 });
      return plan;
    }
    if (phase === 'solar') {
      walkTo(plan, a, 'g', L.pileX.glass + 2); plan.push({ k: 'pick', item: 'glass' });
      const x0 = L.bx + 12 + ((S.solar * 7) % (L.BW - 24));
      walkTo(plan, a, 'w', x0);
      plan.push({ k: 'work', pose: ['drillA', 'drillB'], dur: 10 + a.r() * 5, rate: 6, mark: 'solar' });
      return plan;
    }
    if (phase === 'plant') {
      const x0 = L.bx + 6 + ((S.trees * 23 + a.seed) % (L.BW - 8));
      walkTo(plan, a, 'g', x0);
      plan.push({ k: 'work', pose: ['plant', 'bend'], dur: 10 + a.r() * 5, rate: 2, mark: 'tree' });
      plan.push({ k: 'idle', pose: 'stand', dur: 2 });
      return plan;
    }
    if (phase === 'crane') {
      /* signal the crane: the deck panel it lowers frames a bay */
      const taken = reserved(a);
      const b = pickBay('frame', a.x, taken);
      if (b >= 0) {
        a.target = 'frame' + b;
        walkTo(plan, a, wl, L.bays[b].cx - 4);
        plan.push({ k: 'crane', bay: b });
        plan.push({ k: 'work', pose: ['hammerUp', 'hammerDown'], dur: 5 + a.r() * 3, rate: 4, cell: ['frame', b] });
        return plan;
      }
      phase = 'frame';
    }
    /* frame / wall / wire / window, or whatever the building needs next */
    const order = [phase, 'frame', 'wire', 'wall', 'window'];
    const taken = reserved(a);
    let ph = null, b = -1;
    for (const p of order) { b = pickBay(p, a.x || L.bx, taken); if (b >= 0) { ph = p; break; } }
    if (b < 0 || extraMarks() >= MARK_CAP) {
      /* nothing the town's hours have opened up yet: check the work */
      const x0 = L.bx + 6 + ((a.r() * (L.BW - 12)) | 0);
      walkTo(plan, a, wl, x0);
      plan.push({ k: 'work', pose: ['measure', 'measure'], dur: 4 + a.r() * 3, rate: 1 });
      plan.push({ k: 'work', pose: a.r() < 0.5 ? ['sweepA', 'sweepB'] : ['hammerUp', 'hammerDown'], dur: 6 + a.r() * 5, rate: 3 });
      return plan;
    }
    a.target = ph + b;
    const mat = MATERIAL[ph];
    const needTrip = a.level === 'g' || a.r() < 0.25;
    if (needTrip && mat) {
      walkTo(plan, a, 'g', L.pileX[mat] + 2);
      plan.push({ k: 'pick', item: mat });
    }
    const vol = L.bays[b].vol;
    const pose = ph === 'frame' ? ['hammerUp', 'hammerDown'] : ph === 'wire' ? ['pullA', 'pullB']
      : ph === 'wall' ? (vol === 'C' ? ['trowelA', 'trowelB'] : ['drillA', 'drillB']) : ['drillA', 'drillB'];
    const workX = L.bays[b].cx + (ph === 'window' || ph === 'wall' ? -5 : -4);
    walkTo(plan, a, wl, workX);
    plan.push({ k: 'face', dir: 1 });
    plan.push({ k: 'use' });
    plan.push({ k: 'work', pose, dur: 6 + a.r() * 5, rate: ph === 'frame' ? 4 : ph === 'wire' ? 2 : 3, cell: [ph, b] });
    return plan;
  }

  /* expand 'goto' into walks and climbs */
  function expandGoto(a, act) {
    const out = [];
    const from = a.level, to = act.level;
    const sameColumn = (from === to) || (from === 'g' && to === 'w' && activeFloor() === 0) || (from === 'w' && to === 'g' && activeFloor() === 0);
    if (sameColumn) { out.push({ k: 'walk', x: act.x }); if (from !== to) out.push({ k: 'setLevel', level: to }); return out; }
    if (from === 'beam') out.push({ k: 'hop', level: 'w' });
    if (from !== 'g' && to === 'g') {
      out.push({ k: 'walk', x: ladderX() }); out.push({ k: 'climb', level: 'g' }); out.push({ k: 'walk', x: act.x });
    } else {
      out.push({ k: 'walk', x: ladderX() }); out.push({ k: 'climb', level: 'w' }); out.push({ k: 'walk', x: act.x });
    }
    return out;
  }

  const WALK = 11, CLIMB = 9;
  function step(a, dt) {
    if (a.gone) return;
    a.t += dt; a.anim += dt;
    if (!a.act) {
      if (!a.plan.length) { a.target = null; a.plan = planFor(a); }
      a.act = a.plan.shift(); a.actT = 0;
      if (!a.act) return;
      if (a.act.k === 'goto') { a.plan.unshift(...expandGoto(a, a.act)); a.act = null; return; }
    }
    const act = a.act; a.actT += dt;
    const fin = () => { a.act = null; };
    switch (act.k) {
      case 'walk': {
        const d = act.x - a.x;
        if (Math.abs(d) < 0.6) { a.x = act.x; fin(); break; }
        a.facing = d > 0 ? 1 : -1;
        a.x += Math.sign(d) * Math.min(Math.abs(d), WALK * dt * (a.state === 'off' ? 0.8 : 1));
        a.y = yFor(a);
        const f = ((a.anim * 6) | 0) % 2 ? 'B' : 'A';
        a.pose = (a.state === 'off' ? 'hatoff' : a.carry ? (CARRY_POSE[a.carry] || 'carry') : a.coffee ? 'mug' : 'walk') + f;
        a.bob = f === 'B' ? -1 : 0;
        break;
      }
      case 'climb': {
        const ty = act.level === 'g' ? laneY(a) : levelY(act.level);
        a.x = ladderX(); a.y += Math.sign(ty - a.y) * Math.min(Math.abs(ty - a.y), CLIMB * dt);
        a.pose = ((a.anim * 5) | 0) % 2 ? 'climbB' : 'climbA'; a.bob = 0;
        if (Math.abs(ty - a.y) < 0.5) { a.y = ty; a.level = act.level; fin(); }
        break;
      }
      case 'walkY': {
        const ty = act.street ? L.street - 1 : laneY(a);
        const d = ty - a.y;
        a.pose = (a.state === 'off' ? 'hatoff' : a.coffee ? 'mug' : 'walk') + (((a.anim * 6) | 0) % 2 ? 'B' : 'A');
        a.y += Math.sign(d) * Math.min(Math.abs(d), WALK * 0.7 * dt);
        if (Math.abs(d) < 0.5) { a.y = ty; a.street = act.street; fin(); }
        break;
      }
      case 'setLevel': a.level = act.level; a.y = yFor(a); fin(); break;
      case 'hop': a.level = act.level; a.y = yFor(a); fin(); break;
      case 'face': a.facing = act.dir; fin(); break;
      case 'use': if (a.carry && a.carry !== 'mug') { a.usedCarry = a.carry; a.carry = null; } fin(); break;
      case 'pick': a.pose = 'bend'; a.bob = 0; if (a.actT > 0.5) { a.carry = act.item; a.coffee = false; fin(); } break;
      case 'drop':
        a.pose = 'bend'; a.bob = 0;
        if (a.actT > 0.5) { if (act.to === 'base') { S.baseStack = Math.min(6, S.baseStack + 1); bldDirty = true; } a.carry = null; fin(); }
        break;
      case 'crane':
        a.pose = ((a.actT * 1.5) | 0) % 2 ? 'signalB' : 'signalA'; a.bob = 0; a.facing = 1;
        if (!crane.busy) craneJob(L.bays[act.bay].cx, levelY('w'));
        if (crane.delivered || a.actT > 22) { crane.delivered = false; fin(); }
        break;
      case 'work': {
        const rate = act.rate || 3;
        const ph = ((a.actT * rate) | 0) % 2;
        a.pose = act.pose[ph]; a.bob = 0;
        if (act.cell && ph !== a.lastPh && ph === 1) spark(a, act.cell[0]);
        a.lastPh = ph;
        if (a.actT >= act.dur) {
          if (act.cell) addMark(act.cell[0], act.cell[1]);
          if (act.mark === 'solar' && S.solar < 24) { S.solar++; bldDirty = true; saveMarks(); }
          if (act.mark === 'tree' && S.trees < 9) { S.trees++; bldDirty = true; saveMarks(); }
          a.sinceBreak += act.dur + 10; a.target = null; fin();
        }
        break;
      }
      case 'idle':
        a.bob = 0;
        if (act.face) a.facing = act.face;
        if (act.chew) a.pose = ((a.actT * 0.8) | 0) % 3 === 2 ? 'sitB' : 'sitA';
        else if (act.pose === 'stand' && a.actT % 5 > 4.7) a.pose = 'front';
        else a.pose = act.pose;
        if (act.sit) a.sitting = true;
        if (a.actT >= act.dur) { a.sitting = false; fin(); }
        break;
      case 'leave': {
        /* knock off: tools down, hat off, out the gate. Not sad, shift's over. */
        if (a.level !== 'g') { a.plan.unshift(...expandGoto(a, { level: 'g', x: ladderX() }), { k: 'leave' }); a.act = null; break; }
        a.carry = null;
        if (a.actT < 0.8) { a.pose = 'frontHatoff'; a.bob = 0; break; }
        a.plan.unshift({ k: 'walk', x: L.gateX + 6 }, { k: 'idle', pose: 'wave', dur: 0.9, face: 1 }, { k: 'walkY', street: true }, { k: 'walk', x: L.gateX - 70 }, { k: 'gone' });
        a.act = null;
        break;
      }
      case 'gone': a.gone = true; fin(); break;
      case 'pauseHold': {
        /* tools down, turn around, look at you. A blink, a small shrug. */
        a.bob = 0;
        const cyc = a.actT % 6;
        a.pose = cyc > 5.6 ? 'stand' : 'front';
        a.blink = (a.actT % 3.7) > 3.55;
        break;
      }
      default: fin();
    }
  }

  function placeAtStation(a) {
    /* drop straight into a sensible spot (first draw, resize) */
    a.act = null; a.plan = []; a.target = null;
    a.lane = L.lanes[a.seed % L.lanes.length];
    if (a.state === 'away') { a.level = 'g'; a.x = L.trailerX - 4; a.y = laneY(a); return; }
    const task = stationTask(a), phase = phaseOf(task);
    const wl = workLevel();
    if (phase === 'haul' || phase === 'plant' || wl === 'g') { a.level = 'g'; a.x = L.bx - 20 + (a.seed % Math.max(10, L.BW)); }
    else { a.level = wl; a.x = L.bx + 4 + (a.seed % (L.BW - 8)); }
    a.y = yFor(a);
  }
  function enterFromGate(a, withCoffee) {
    /* along the Lakeside Ave sidewalk, in through the gate */
    a.level = 'g'; a.street = true; a.x = L.gateX - 40 - (a.seed % 50); a.y = L.street - 1;
    a.act = null; a.plan = []; a.gone = false; a.carry = null;
    a.coffee = !!withCoffee;
    a.plan.push({ k: 'walk', x: L.gateX + 6 }, { k: 'walkY', street: false });
    if (withCoffee) a.plan.push({ k: 'walk', x: L.gateX + 22 + (a.seed % 30) }, { k: 'idle', pose: 'drink', dur: 2 + a.r() * 2 });
    else a.plan.push({ k: 'walk', x: L.gateX + 16 + (a.seed % 20) });
    a.plan.push({ k: 'idle', pose: 'stand', dur: 0.3 });
  }

  /* --------------------------------------------------- particles */
  function spark(a, phase) {
    if (reduced || S.particles.length > 60) return;
    const x = a.x + a.facing * 4, y = a.y - 7;
    const col = phase === 'wall' ? pal.dirtSpeck : phase === 'wire' ? pal.copper : '#ffe9a8';
    for (let i = 0; i < 2; i++) S.particles.push({ x, y, vx: (R() - 0.5) * 12 + a.facing * 6, vy: -8 - R() * 8, life: 0.35, c: col, g: 40 });
  }
  function weatherParticles(dt) {
    /* snow and rain fall in the camera's view, in world coordinates */
    const w = S.weather;
    if (w !== 'snow' && w !== 'rain') return;
    const want = w === 'snow' ? Math.round(W * H / 700) : Math.round(W * H / 500);
    let n = 0; for (const p of S.particles) if (p.wx) n++;
    for (; n < want; n++) {
      const x = cam.x + R() * (W + 20) - 10, y = cam.y + R() * H;
      S.particles.push(w === 'snow'
        ? { wx: 1, x, y, vx: -2 + R() * 2, vy: 7 + R() * 6, life: 1e9, c: pal.snow, sway: R() * 6, land: R() }
        : { wx: 2, x, y, vx: -14, vy: 70 + R() * 30, life: 1e9, c: '#b8c6d6', land: R() });
    }
  }
  function stepParticles(dt) {
    weatherParticles(dt);
    const ps = S.particles;
    const keep = (S.weather === 'snow' ? 1 : S.weather === 'rain' ? 2 : 0);
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.g) p.vy += p.g * dt;
      p.x += (p.vx + (p.sway ? Math.sin((S.t + p.sway) * 1.3) * 2 : 0)) * dt; p.y += p.vy * dt;
      if (p.wx) {
        const floor = Math.min(cam.y + H, L.groundY + 2 + p.land * (WH - L.groundY));
        if (p.y > floor || p.x < cam.x - 12 || p.x > cam.x + W + 12) {
          if (p.wx === keep) { p.y = cam.y - 2 - R() * 10; p.x = cam.x + R() * (W + 20) - 10; continue; }
          ps.splice(i, 1); continue;
        }
        continue;
      }
      if (p.life <= 0) ps.splice(i, 1);
    }
    /* breath on a cold day */
    if (snowy && !reduced && R() < dt * 0.8) {
      const list = [...agents.values()].filter((a) => !a.gone && a.x > cam.x && a.x < cam.x + W);
      const a = list[(R() * list.length) | 0];
      if (a) S.particles.push({ x: a.x + a.facing * 3, y: a.y - 10 + (a.bob || 0), vx: a.facing * 3, vy: -2, life: 1.2, c: 'rgba(240,244,250,0.7)', puff: 1 });
    }
  }

  /* ------------------------------------------------------ the crane */
  const crane = { trolley: 0, hook: 0, busy: false, phase: 'idle', load: null, tx: 0, ty: 0, delivered: false, idleT: 0, beam: false };
  function craneJob(tx, ty, beam) {
    crane.busy = true; crane.phase = 'toPile'; crane.tx = tx; crane.ty = ty; crane.load = null; crane.beam = !!beam;
  }
  function stepCrane(dt) {
    if (!L) return;
    const jibY = craneJibY();
    const pileX = L.pileX.lumber + 3;
    if (!crane.trolley) { crane.trolley = L.bx + L.BW * 0.5; crane.hook = jibY + 10; }
    const speedX = 9, speedY = 12;
    const moveX = (x) => { const d = x - crane.trolley; crane.trolley += Math.sign(d) * Math.min(Math.abs(d), speedX * dt); return Math.abs(d) < 0.5; };
    const moveY = (y) => { const d = y - crane.hook; crane.hook += Math.sign(d) * Math.min(Math.abs(d), speedY * dt); return Math.abs(d) < 0.5; };
    const top = jibY + 6;
    switch (crane.phase) {
      case 'idle': {
        crane.idleT += dt;
        const working = [...agents.values()].some((a) => !a.gone && a.state === 'working');
        if (working && !topped() && crane.idleT > 35) { crane.idleT = 0; craneJob(L.bays[(R() * NB) | 0].cx, levelY('w') || L.groundY); }
        if (!crane.busy) { moveY(top + 6); }
        break;
      }
      case 'toPile': if (moveY(top) && moveX(pileX)) crane.phase = 'downPile'; break;
      case 'downPile': if (moveY(L.groundY - 6)) { crane.load = crane.beam ? 'beam' : 'panel'; crane.phase = 'upPile'; } break;
      case 'upPile': if (moveY(Math.min(top, crane.ty - 30))) crane.phase = 'toTarget'; break;
      case 'toTarget': if (moveX(crane.tx)) crane.phase = 'downTarget'; break;
      case 'downTarget': if (moveY(crane.ty - (crane.beam ? 4 : 9))) { crane.phase = 'release'; crane.relT = 0; } break;
      case 'release':
        crane.relT += dt;
        if (crane.relT > 1.2) { crane.load = null; crane.delivered = true; crane.phase = 'up'; if (crane.beam) { S.beamSet = true; bldDirty = true; } }
        break;
      case 'up': if (moveY(top + 6)) { crane.phase = 'idle'; crane.busy = false; } break;
      default: crane.phase = 'idle';
    }
  }
  function craneJibY() { return Math.max(6, L.roofY - 22); }

  /* ---------------------------------------------------- the forklift */
  const fork = { x: 0, dir: 1, lift: 0, load: null, phase: 'park', t: 0 };
  function stepFork(dt) {
    if (!L) return;
    if (!fork.x) { fork.x = L.forkPark; fork.dir = -1; }
    const go = (x) => { const d = x - fork.x; if (Math.abs(d) < 0.6) return true; fork.dir = d > 0 ? 1 : -1; fork.x += Math.sign(d) * Math.min(Math.abs(d), 14 * dt); return false; };
    fork.t += dt;
    switch (fork.phase) {
      case 'park':
        if (S.deliveries.length) { fork.phase = 'toDelivery'; break; }
        if (fork.t > 25 && [...agents.values()].some((a) => !a.gone && a.state === 'working')) { fork.t = 0; fork.phase = 'shuttle'; fork.sx = L.pileX.lumber + 16; }
        break;
      case 'shuttle': if (go(fork.sx)) { fork.phase = 'back'; } break;
      case 'back': if (go(L.forkPark)) { fork.dir = -1; fork.phase = 'park'; fork.t = 0; } break;
      case 'toDelivery': {
        const d = S.deliveries[0];
        if (go(d.x + 13)) { fork.dir = -1; fork.lift += dt * 8; if (fork.lift >= 3) { fork.load = d.kind; S.deliveries.shift(); fork.phase = 'toPile'; } }
        break;
      }
      case 'toPile': {
        const px = L.pileX[fork.load] || L.pileX.lumber;
        if (go(px - 13)) { fork.dir = 1; fork.lift -= dt * 8; if (fork.lift <= 0) { fork.lift = 0; S.piles[fork.load] = Math.min(5, (S.piles[fork.load] || 0) + 1); fork.load = null; fork.phase = 'back'; bgDirty = true; } }
        break;
      }
      default: fork.phase = 'park';
    }
  }

  /* ---------------------------------------------------- the foreman */
  const foreman = { phase: 'in', t: 0, pose: 'frontMug', dx: 0 };
  function stepForeman(dt) {
    foreman.t += dt;
    const f = foreman;
    switch (f.phase) {
      case 'in': f.dx = 0; f.pose = (f.t % 9) > 7.8 ? 'drink' : 'frontMug'; if (S.whistle) { f.phase = 'out'; f.t = 0; } break;
      case 'out': f.dx = Math.min(6, f.t * 10); f.pose = f.t % 0.3 < 0.15 ? 'walkA' : 'walkB'; if (f.t > 0.6) { f.phase = 'raise'; f.t = 0; } break;
      case 'raise': f.dx = 6; f.pose = 'frontRaise'; if (!S.whistle) { f.phase = 'nod'; f.t = 0; } break;
      case 'nod': f.dx = 6; f.pose = 'front'; f.nod = ((f.t * 4) | 0) % 2 === 1 && f.t < 1.2; if (f.t > 1.5) { f.phase = 'back'; f.t = 0; f.nod = false; } break;
      case 'back': f.dx = Math.max(0, 6 - f.t * 10); f.pose = f.t % 0.3 < 0.15 ? 'walkA' : 'walkB'; if (f.t > 0.6) { f.phase = 'in'; f.t = 0; } if (S.whistle) { f.phase = 'raise'; } break;
      default: f.phase = 'in';
    }
  }

  /* ============================================================ drawing */
  function sprite(pose, colors, facing, extra) {
    const key = pose + facing + colors.H + colors.V + colors.S + colors.hair + (extra || '') + palKey;
    let c = spriteCache.get(key);
    if (c) return c;
    const def = POSES[pose] || POSES.stand;
    const g = def[0].concat(def[1], LEGS[def[2]]).map((r) => r.split(''));
    for (const [x, y, role] of ARMS[def[3]] || []) if (g[y] && x < 9) g[y][x] = role;
    if (extra === 'blink') for (const row of g) for (let i = 0; i < 9; i++) if (row[i] === 'E') row[i] = 'S';
    c = document.createElement('canvas'); c.width = 9; c.height = 14;
    const x2 = c.getContext('2d');
    const role = {
      H: shade(colors.H), h: shade(mix(colors.H, '#000000', 0.25)), b: shade(mix(colors.H, '#000000', 0.38)),
      S: shade(colors.S), s: shade(mix(colors.S, '#3a2010', 0.22)), E: pal.outline, r: shade(colors.hair),
      V: shade(colors.V), v: shade(mix(colors.V, '#000000', 0.2)), R: shade('#eef0ea'), T: pal.shirt,
      P: pal.pants, p: pal.pantsShade, B: pal.boots, M: pal.mug, C: pal.coffee, K: shade('#8b939b'), k: pal.timberDark,
      L: pal.timber, l: pal.timberShade, Y: pal.brick, G: shade('#a9c4d8'), g: shade('#e6f0f6'), W: pal.copper,
      w: pal.sandwich, o: pal.outline,
    };
    for (let y = 0; y < 14; y++) for (let x = 0; x < 9; x++) {
      const ch = g[y][x]; if (ch === '.' || !role[ch]) continue;
      x2.fillStyle = role[ch]; x2.fillRect(facing < 0 ? 8 - x : x, y, 1, 1);
    }
    spriteCache.set(key, c);
    return c;
  }

  /* ---- background: sky, Adirondacks, lake, shore, the old mill ---- */
  function drawBackground() {
    if (!bgCache) { bgCache = document.createElement('canvas'); }
    bgCache.width = WW; bgCache.height = WH;
    const c = bgCache.getContext('2d');
    const hz = L.horizon;
    const g = c.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, pal.skyTop); g.addColorStop(1, pal.skyHor);
    c.fillStyle = g; c.fillRect(0, 0, WW, hz + 1);
    /* stars and moon at night */
    if (night > 0.7 && S.weather === 'clear') {
      const r = rng(7);
      for (let i = 0; i < WW * hz / 260; i++) { c.fillStyle = r() < 0.2 ? EMIT.star : 'rgba(232,236,247,0.55)'; c.fillRect((r() * WW) | 0, (r() * (hz - 20)) | 0, 1, 1); }
    }
    /* the evening sun goes down behind the Adirondacks (we look west, over the lake) */
    const sunUp = S.evening && S.alt > -2 && S.alt < 14 && S.weather === 'clear';
    if (sunUp) {
      const sx = SUN_X, sy = Math.round(hz - 4 - S.alt * 2.2);
      const sg = c.createRadialGradient(sx, sy, 1, sx, sy, 26);
      sg.addColorStop(0, 'rgba(255,220,150,0.55)'); sg.addColorStop(1, 'rgba(255,200,140,0)');
      c.fillStyle = sg; c.fillRect(sx - 26, sy - 26, 52, 52);
      c.fillStyle = S.alt < 5 ? EMIT.sunLow : EMIT.sun; c.beginPath(); c.arc(sx, sy, 4, 0, 7); c.fill();
    }
    /* the Adirondacks: two ridgelines, far and near, softened by haze */
    const fog = S.weather === 'fog' ? 0.75 : S.weather === 'rain' ? 0.45 : S.weather === 'cloud' ? 0.2 : 0;
    const farC = mix(shade('#94acc5'), pal.skyHor, 0.35 + fog * 0.6), nearC = mix(shade('#6e7e95'), pal.skyHor, 0.12 + fog * 0.7);
    const ridge = (seed, amp, base, col, snowcap) => {
      const r = rng(seed); const pts = []; let v = 0, dv = 0;
      for (let x = 0; x <= WW; x++) { dv += (r() - 0.5) * 0.5; dv *= 0.92; v += dv; v *= 0.985; pts.push(base - amp * (0.55 + 0.45 * Math.sin(x / 37 + seed) * Math.sin(x / 13 + seed * 2)) + v); }
      c.fillStyle = col;
      for (let x = 0; x < WW; x++) { const top = Math.round(pts[x]); c.fillRect(x, top, 1, hz - top + 1); }
      if (snowcap) { c.fillStyle = mix(pal.snow, col, 0.25); for (let x = 0; x < WW; x++) { const top = Math.round(pts[x]); if (top < base - amp * 0.75) c.fillRect(x, top, 1, 2); } }
    };
    ridge(11, 16, hz - 4, farC, snowy);
    ridge(23, 9, hz, nearC, snowy);
    /* the lake */
    const lakeTop = hz + 1, lakeBot = L.groundY - 22;
    const lakeC = mix(shade('#8fadc6'), pal.skyHor, 0.25 + fog * 0.4);
    c.fillStyle = lakeC; c.fillRect(0, lakeTop, WW, lakeBot - lakeTop);
    c.fillStyle = mix(lakeC, pal.skyHor, 0.45); c.fillRect(0, lakeTop, WW, 1);
    if (snowy) { c.fillStyle = shade(BASE.ice); c.fillRect(0, lakeBot - 2, WW, 2); }
    /* far shore, then the near trees along the rail line */
    const r2 = rng(5);
    const treeTop = lakeBot - 5;
    for (let x = 0; x < WW; x++) {
      const h = 5 + Math.round(3 * Math.sin(x / 5.3) + 2 * Math.sin(x / 2.1 + 1) + r2() * 2);
      c.fillStyle = x % 7 < 3 ? pal.treeDark : pal.tree; c.fillRect(x, treeTop + 6 - h, 1, L.groundY - (treeTop + 6 - h));
    }
    const month = nowDate().getMonth();
    if (!snowy && (month === 9 || month === 10)) {   // October on the trees, like the rendering
      for (let i = 0; i < WW / 3; i++) { c.fillStyle = r2() < 0.5 ? pal.autumnA : pal.autumnB; const x = (r2() * WW) | 0; c.fillRect(x, treeTop + 1 + ((r2() * 5) | 0), 2, 2); }
    }
    if (snowy) { c.fillStyle = pal.snow; for (let x = 0; x < WW; x += 2) if (r2() < 0.6) c.fillRect(x, treeTop + 2 + ((r2() * 4) | 0), 2, 1); }
    /* grass bank behind the site */
    c.fillStyle = snowy ? pal.snow : pal.grass; c.fillRect(0, L.groundY - 8, WW, 8);
    c.fillStyle = snowy ? pal.snowShade : pal.grassDark; c.fillRect(0, L.groundY - 8, WW, 1);
    /* the old brick mill next door, frame right (Lakeside's 1894 cotton mill) */
    drawMill(c);
    /* the site: gravel and dirt */
    const gy = L.groundY;
    c.fillStyle = snowy ? pal.snow : pal.dirt; c.fillRect(0, gy, WW, WH - gy);
    const r3 = rng(9);
    for (let i = 0; i < WW * (WH - gy) / 14; i++) { c.fillStyle = snowy ? (r3() < 0.5 ? pal.snowShade : pal.white) : (r3() < 0.5 ? pal.dirtDark : pal.dirtSpeck); c.fillRect((r3() * WW) | 0, gy + ((r3() * (WH - gy)) | 0), 1, 1); }
    /* tire tracks from the gate */
    c.fillStyle = snowy ? pal.snowShade : pal.dirtDark;
    for (let x = 0; x < L.bx; x += 2) { c.fillRect(x, gy + 9, 1, 1); c.fillRect(x + 1, gy + 12, 1, 1); }
    /* sidewalk and Lakeside Ave */
    const st = L.street;
    c.fillStyle = pal.sidewalk; c.fillRect(0, st - 2, WW, 2);
    c.fillStyle = pal.asphalt; c.fillRect(0, st, WW, WH - st);
    c.fillStyle = shade('#e8e2d0'); for (let x = 0; x < WW; x += 9) c.fillRect(x, st + 3, 4, 1);
    if (snowy) { c.fillStyle = pal.snowShade; for (let x = 0; x < WW; x += 3) c.fillRect(x, st, 2, 1); }
    /* yard props that don't move: dumpster, port-a-john, light tower */
    const dx = L.johnX;
    if (dx > 18) {
      c.fillStyle = pal.john; c.fillRect(dx, gy - 8, 6, 11); c.fillStyle = pal.johnDark; c.fillRect(dx, gy - 9, 6, 1); c.fillRect(dx + 4, gy - 4, 1, 2);
    }
    drawPiles(c);
    bgDirty = false;
  }
  function drawMill(c) {
    const mx = L.millX, gy = L.groundY;
    if (mx > WW - 8) return;
    const w = WW - mx + 4, h = 26;
    c.fillStyle = pal.millRoof;
    for (let x = mx; x < mx + w; x += 6) { c.fillRect(x, gy - h - 3, 5, 1); c.fillRect(x, gy - h - 2, 6, 2); }
    c.fillStyle = pal.mill; c.fillRect(mx, gy - h, w, h);
    c.fillStyle = pal.millDark; c.fillRect(mx, gy - h, 1, h);
    for (let row = 0; row < 3; row++) for (let x = mx + 3; x < mx + w - 2; x += 5) {
      const lit = night > 0.6 && hash('m' + x + row) % 5 === 0;
      c.fillStyle = lit ? EMIT.winLitDeep : pal.millWin; c.fillRect(x, gy - h + 3 + row * 8, 2, 5);
      c.fillStyle = pal.millDark; c.fillRect(x, gy - h + 2 + row * 8, 2, 1);
    }
    if (snowy) { c.fillStyle = pal.snow; for (let x = mx; x < mx + w; x += 6) c.fillRect(x, gy - h - 3, 5, 1); }
    /* the old stack */
    const sx = Math.min(WW - 6, mx + w - 12);
    c.fillStyle = pal.millDark; c.fillRect(sx, gy - h - 22, 4, 22);
    c.fillStyle = pal.mill; c.fillRect(sx - 1, gy - h - 23, 6, 2);
  }
  function drawPiles(c) {
    const gy = L.groundY;
    const P = L.pileX;
    /* lumber: a stack of boards */
    for (let i = 0; i < S.piles.lumber; i++) { c.fillStyle = i % 2 ? pal.timberShade : pal.timber; c.fillRect(P.lumber - 1, gy + 3 - i * 2, 10, 2); c.fillStyle = pal.timberDark; c.fillRect(P.lumber - 1, gy + 4 - i * 2, 10, 1); }
    c.fillStyle = pal.palletDark; c.fillRect(P.lumber - 1, gy + 5, 10, 1);
    /* brick on a pallet */
    for (let i = 0; i < Math.min(3, S.piles.brick); i++) { c.fillStyle = pal.brick; c.fillRect(P.brick, gy + 2 - i * 3, 7, 3); c.fillStyle = pal.mortar; c.fillRect(P.brick, gy + 3 - i * 3, 7, 1); c.fillRect(P.brick + 3, gy + 2 - i * 3, 1, 1); }
    c.fillStyle = pal.pallet; c.fillRect(P.brick - 1, gy + 5, 9, 1);
    /* glass on its A-frame rack */
    c.fillStyle = pal.timberDark; c.fillRect(P.glass + 3, gy - 6, 1, 11);
    for (let i = 0; i < Math.min(4, S.piles.glass + 1); i++) { c.fillStyle = i % 2 ? pal.glassHi : pal.glass; c.fillRect(P.glass + 4 + i, gy - 5 + i, 1, 10 - i); c.fillRect(P.glass + 2 - i, gy - 5 + i, 1, 10 - i); }
    /* copper wire spools */
    for (let i = 0; i < Math.min(3, S.piles.copper + 1); i++) { const x = P.copper + i * 4 - 2; c.fillStyle = pal.timberShade; c.fillRect(x, gy + 6, 4, 4); c.fillStyle = pal.copper; c.fillRect(x + 1, gy + 6, 2, 4); }
    if (snowy) { c.fillStyle = pal.snow; c.fillRect(P.lumber - 1, gy + 3 - (S.piles.lumber - 1) * 2 - 1, 10, 1); c.fillRect(P.brick, gy + 1 - (Math.min(3, S.piles.brick) - 1) * 3, 7, 1); }
  }

  /* ----------------------------------------- Watershed, as built so far */
  function wallColor(vol, f, top) {
    if (vol === 'C') return [pal.brick, pal.mortar];
    if (vol === 'G') return [pal.glassDark, pal.glassDarkHi];
    if (top) return [pal.charcoal, pal.charcoalLine];
    return vol === 'L' ? [pal.rustBack, pal.rustBackGroove] : [pal.rust, pal.rustGroove];
  }
  function windowRect(b, f) {
    const bay = L.bays[b], top = L.fBottom[f + 1], h = L.fh(f);
    if (bay.vol === 'G') return null;
    if (f === 0) {
      if (bay.vol === 'M') return [bay.ax + 1, top + 3, bay.w - 2, h - 3];       // storefront
      if (bay.vol === 'C') return [bay.ax + 2, top + 4, bay.w - 4, h - 6];
      return [bay.ax + 3, top + 4, 5, h - 7];
    }
    if (bay.vol === 'C') return [bay.ax + (b % 2 ? 1 : 3), top + 3, 6, 7];
    return [bay.ax + 3, top + 3, 5, 7];
  }
  function drawWall(c, b, f, fromY, toY) {
    /* cladding for bay b, floor f, rows fromY..toY (absolute), no window */
    const bay = L.bays[b], top = L.fBottom[f + 1];
    const topFloor = f === L.floors - 1 && bay.vol !== 'C';
    const [col, line] = wallColor(bay.vol, f, topFloor);
    c.fillStyle = col; c.fillRect(bay.ax, fromY, bay.w, toY - fromY);
    c.fillStyle = line;
    if (bay.vol === 'C') {
      for (let y = fromY; y < toY; y++) if ((y - top) % 3 === 2) c.fillRect(bay.ax, y, bay.w, 1);
      c.fillStyle = pal.brickSpeck;
      for (let y = fromY; y < toY; y++) for (let x = bay.ax; x < bay.ax + bay.w; x++) if (hash(x * 977 + y) % 9 === 0 && (y - top) % 3 !== 2) c.fillRect(x, y, 1, 1);
    } else if (bay.vol === 'G') {
      if (fromY <= top + 1 && toY > top + 1) c.fillRect(bay.ax, top + 1, bay.w, 1);
      c.fillStyle = pal.glassDarkHi; c.fillRect(bay.ax + 1, fromY, 1, toY - fromY);
    } else if (!topFloor) {
      for (let x = bay.ax + 1; x < bay.ax + bay.w; x += 3) c.fillRect(x, fromY, 1, toY - fromY);
    } else {
      for (let x = bay.ax + 2; x < bay.ax + bay.w; x += 4) c.fillRect(x, fromY, 1, toY - fromY);
    }
  }
  function litWindows() {
    /* which windows a post has lit: the same ones every time */
    const n = Math.max(0, S.town.windows_lit | 0);
    const slots = [];
    const af = activeFloor();
    for (let f = 0; f < Math.min(af, L.floors); f++) for (let b = 0; b < NB; b++) if (L.bays[b].vol !== 'G') slots.push(f * 100 + b);
    slots.sort((p, q) => hash('w' + p) - hash('w' + q));
    return new Set(slots.slice(0, n));
  }
  function drawWindow(c, rect, lit, b, f, glazed) {
    const [x, y, w, h] = rect;
    if (!glazed) { c.fillStyle = pal.interior; c.fillRect(x, y, w, h); c.fillStyle = pal.interiorDeep; c.fillRect(x, y, w, 1); return; }
    if (lit && night > 0.35) {
      c.fillStyle = EMIT.winLit; c.fillRect(x, y, w, h);
      c.fillStyle = EMIT.winLitDeep; c.fillRect(x, y + h - 2, w, 2);
      /* someone's lamp, someone's plant: posts are people */
      const k = hash('l' + b + f) % 3;
      c.fillStyle = shade('#3f6b3a'); if (k === 0) c.fillRect(x + 1, y + h - 3, 2, 2);
      c.fillStyle = shade('#6b4a3a'); if (k === 1) c.fillRect(x + w - 2, y + 1, 1, h - 3);
      return;
    }
    c.fillStyle = night > 0.5 ? mix(pal.glassDark, '#1a2238', 0.3) : pal.glass; c.fillRect(x, y, w, h);
    c.fillStyle = night > 0.5 ? pal.glassDarkHi : pal.glassHi; c.fillRect(x, y, 1, Math.min(3, h)); c.fillRect(x + 1, y, 1, 1);
    if (lit) {   // by day, a lit window shows as a plant on the sill and a warm curtain
      c.fillStyle = shade('#e8d2a8'); c.fillRect(x + w - 2, y, 2, h - 1);
      c.fillStyle = shade('#4f8a3f'); c.fillRect(x + 1, y + h - 2, 2, 2); c.fillStyle = shade('#a4553a'); c.fillRect(x + 1, y + h - 1, 2, 1);
    }
    if (f > 0 && L.bays[b].vol !== 'C') { c.fillStyle = pal.rustGroove; c.fillRect(x - 1, y + h, w + 2, 1); }
  }
  function drawBuilding() {
    if (!bldCache) bldCache = document.createElement('canvas');
    bldCache.width = WW; bldCache.height = WH;
    const c = bldCache.getContext('2d');
    c.clearRect(0, 0, WW, WH);
    const af = activeFloor(), isTop = topped();
    const lit = litWindows();
    const gy = L.groundY;
    /* the slab */
    c.fillStyle = pal.concreteShade; c.fillRect(L.bx - 2, gy, L.BW + 4, 2);
    for (let f = 0; f < Math.min(af, L.floors); f++) {
      for (let b = 0; b < NB; b++) {
        const top = L.fBottom[f + 1], bot = L.fBottom[f];
        drawWall(c, b, f, top, bot);
        const wr = windowRect(b, f);
        if (wr) drawWindow(c, wr, lit.has(f * 100 + b), b, f, true);
      }
      /* floor line where the timber floors meet */
      if (f > 0) { c.fillStyle = shade('#00000000'.slice(0, 7)); }
    }
    /* ground floor: timber canopy over the storefront, the entry */
    if (af > 0) {
      const m0 = L.bays.find((q) => q.vol === 'M'), m3 = L.bays.filter((q) => q.vol === 'M').pop();
      c.fillStyle = pal.timber; c.fillRect(m0.ax - 1, L.fBottom[1] + 1, m3.ax + m3.w - m0.ax + 2, 2);
      c.fillStyle = pal.timberShade; c.fillRect(m0.ax - 1, L.fBottom[1] + 3, m3.ax + m3.w - m0.ax + 2, 1);
    }
    /* the floor under construction */
    if (!isTop) drawActiveFloor(c, af);
    /* roof line of what's built */
    const roofTop = L.fBottom[af];
    if (af > 0) {
      const builtTop = L.fBottom[Math.min(af, L.floors)];
      c.fillStyle = isTop ? pal.coping : pal.timber; c.fillRect(L.bx, builtTop - 1, L.BW, 1);
      if (isTop) {
        const cvol = L.bays.filter((q) => q.vol === 'C');
        const cx0 = cvol[0].ax, cw = cvol[cvol.length - 1].ax + cvol[cvol.length - 1].w - cx0;
        c.fillStyle = pal.brick; c.fillRect(cx0, builtTop - 3, cw, 2); c.fillStyle = pal.coping; c.fillRect(cx0, builtTop - 4, cw, 1);
        /* the timber penthouse box */
        const m = L.bays.find((q) => q.vol === 'M');
        c.fillStyle = pal.timberShade; c.fillRect(m.ax + 6, builtTop - 7, 16, 6);
        c.fillStyle = pal.timber; for (let x = m.ax + 6; x < m.ax + 22; x += 2) c.fillRect(x, builtTop - 7, 1, 6);
        c.fillStyle = pal.charcoal; c.fillRect(m.ax + 5, builtTop - 8, 18, 1);
        /* solar panels, laid by the roof crew */
        for (let i = 0; i < S.solar; i++) {
          const x = L.bx + 2 + (i % 12) * 5 + (i >= 12 ? 60 : 0); if (x + 4 > L.bx + L.BW || (x > m.ax + 3 && x < m.ax + 24)) continue;
          c.fillStyle = pal.solar; c.fillRect(x, builtTop - 3, 4, 2); c.fillStyle = pal.solarHi; c.fillRect(x, builtTop - 3, 4, 1);
        }
        if (snowy) { c.fillStyle = pal.snow; c.fillRect(L.bx, builtTop - 2, L.BW, 1); }
        drawToppingOut(c, builtTop);
      } else if (snowy) { c.fillStyle = pal.snow; c.fillRect(L.bx, roofTop - 1, L.BW, 1); }
    }
    /* street trees, planted after topping out (and two that were always there) */
    drawStreetTrees(c);
    /* scaffold stair tower and the platform at the working level */
    drawScaffold(c, af, isTop);
    /* staging pile at the base of the tower */
    for (let i = 0; i < S.baseStack; i++) { c.fillStyle = i % 2 ? pal.timberShade : pal.timber; c.fillRect(L.towerX - 12, gy + 3 - i * 2, 8, 2); }
    /* the crane: mast, jib, counter-jib (trolley and hook move, drawn per frame) */
    drawCraneStatic(c);
    /* survey stakes on an empty lot */
    if (af === 0 && baseline() === 0 && !S.marks.size) {
      for (let b = 0; b < NB; b += 2) { const x = L.bays[b].ax; c.fillStyle = pal.timberShade; c.fillRect(x, gy - 3, 1, 4); c.fillStyle = pal.netting; c.fillRect(x + 1, gy - 3, 2, 1); }
    }
    if (S.cut) drawCutaway(c, af);
    bldDirty = false;
  }
  function drawActiveFloor(c, f) {
    const top = L.fBottom[f + 1], bot = L.fBottom[f];
    for (let b = 0; b < NB; b++) {
      const bay = L.bays[b];
      if (!done('frame', b)) {
        /* nothing yet: a chalk line on the deck */
        continue;
      }
      /* posts and the beam (concrete at street level, timber above) */
      const post = f === 0 ? pal.concrete : pal.timber, postD = f === 0 ? pal.concreteShade : pal.timberShade;
      c.fillStyle = post; c.fillRect(bay.ax, top, 1, bot - top); c.fillRect(bay.ax + bay.w - 1, top, 1, bot - top);
      c.fillStyle = postD; c.fillRect(bay.ax, top, bay.w, 2);
      c.fillStyle = post; c.fillRect(bay.ax, top, bay.w, 1);
      if (done('wire', b)) {
        c.fillStyle = pal.copper; c.fillRect(bay.ax + 1, top + 5, bay.w - 2, 1); c.fillRect(bay.ax + 3, top + 5, 1, 4);
        c.fillStyle = pal.pipe; c.fillRect(bay.ax + bay.w - 3, top + 2, 1, bot - top - 2);
      }
      const lv = wallLevel(b);
      if (lv > 0) {
        const wallTop = top + 2, hgt = bot - wallTop;
        const from = bot - Math.round(hgt * lv / SUBS);
        drawWall(c, b, f, from, bot);
        const wr = windowRect(b, f);
        if (wr) {
          const [x, y, w, h] = wr;
          const y0 = Math.max(y, from);
          if (y0 < y + h) {
            if (done('window', b) && lv >= SUBS) drawWindow(c, wr, false, b, f, true);
            else { c.fillStyle = pal.interior; c.fillRect(x, y0, w, y + h - y0); }
          }
        }
      }
    }
    /* chalk marks for the bays still to frame: where the next post goes */
    c.fillStyle = mix(pal.timber, pal.white, 0.4);
    for (let b = 0; b < NB; b++) if (!done('frame', b)) c.fillRect(L.bays[b].ax, bot - 1, 2, 1);
  }
  function drawStreetTrees(c) {
    const gy = L.groundY;
    const spots = [];
    for (let i = 0; i < S.trees; i++) spots.push(L.bx + 6 + ((i * 23 + 7) % (L.BW - 8)));
    for (const x of spots) {
      c.fillStyle = pal.trunk; c.fillRect(x, gy - 4, 1, 6);
      c.fillStyle = snowy ? pal.snowShade : (nowDate().getMonth() === 9 ? pal.autumnA : pal.treeLight);
      c.fillRect(x - 2, gy - 9, 5, 5); c.fillRect(x - 1, gy - 10, 3, 1);
    }
  }
  function drawToppingOut(c, y) {
    /* the last beam, signed, with a little tree on it and a flag */
    if (!S.beamSet && !reduced && S.toppedAt != null && S.t - S.toppedAt < 30) return;
    const cx = L.bays.find((q) => q.vol === 'C').ax + 8;
    c.fillStyle = pal.timberDark; c.fillRect(cx - 9, y - 6, 18, 2);
    c.fillStyle = pal.timber; c.fillRect(cx - 9, y - 6, 18, 1);
    c.fillStyle = pal.evergreen; c.fillRect(cx - 1, y - 16, 3, 10); c.fillRect(cx - 2, y - 12, 5, 6); c.fillRect(cx - 3, y - 9, 7, 3);
    c.fillStyle = pal.evergreenLight; c.fillRect(cx, y - 16, 1, 3); c.fillRect(cx - 1, y - 12, 1, 2);
    c.fillStyle = pal.timberDark; c.fillRect(cx + 7, y - 15, 1, 9);
    c.fillStyle = pal.flag; c.fillRect(cx + 8, y - 15, 4, 3); c.fillStyle = pal.white; c.fillRect(cx + 8, y - 14, 4, 1);
    /* the names on the beam: a row of tiny marks */
    c.fillStyle = pal.outline; for (let x = cx - 8; x < cx + 8; x += 2) if (hash('n' + x) % 3) c.fillRect(x, y - 5, 1, 1);
  }
  function drawScaffold(c, af, isTop) {
    const gy = L.groundY;
    const lv = isTop ? L.roofY : L.fBottom[af];
    if (af === 0 && !isTop) return;
    const tx = L.towerX, ty = lv - 7;
    c.fillStyle = pal.scaffoldDark; c.fillRect(tx, ty, 1, gy - ty); c.fillRect(tx + 6, ty, 1, gy - ty);
    c.fillStyle = pal.scaffold;
    for (let y = gy - 1; y > ty; y -= 6) { c.fillRect(tx, y, 7, 1); }
    /* ladder rungs */
    c.fillStyle = pal.scaffoldDark; c.fillRect(tx + 2, ty + 3, 1, gy - ty - 3); c.fillRect(tx + 4, ty + 3, 1, gy - ty - 3);
    c.fillStyle = pal.scaffold; for (let y = gy - 2; y > ty + 3; y -= 2) c.fillRect(tx + 2, y, 3, 1);
    /* platform + guard rail along the working level */
    c.fillStyle = pal.plank; c.fillRect(tx, lv, L.BW + 9, 1);
    c.fillStyle = pal.scaffoldDark; c.fillRect(tx, lv + 1, L.BW + 9, 1);
    c.fillStyle = mix(pal.netting, pal.scaffold, 0.15);
    c.fillRect(tx, lv - 6, 1, 6); c.fillRect(L.bx + L.BW, lv - 6, 1, 6);
    c.fillRect(tx, lv - 6, 7, 1);
    /* a strip of orange safety netting on the tower */
    c.fillStyle = pal.netting; c.fillRect(tx, gy - 5, 7, 1);
  }
  function drawCraneStatic(c) {
    const x = L.craneX, gy = L.groundY, jy = craneJibY();
    if (x + 5 > WW + 3) return;
    c.fillStyle = pal.craneDark; c.fillRect(x, jy, 1, gy - jy); c.fillRect(x + 4, jy, 1, gy - jy);
    c.fillStyle = pal.crane;
    for (let y = gy - 1; y > jy; y -= 4) { c.fillRect(x, y, 5, 1); c.fillRect(x + 1, y - 1, 1, 1); c.fillRect(x + 2, y - 2, 1, 1); c.fillRect(x + 3, y - 3, 1, 1); }
    /* base */
    c.fillStyle = pal.concreteShade; c.fillRect(x - 2, gy, 9, 2);
    /* cab + slewing unit */
    c.fillStyle = pal.crane; c.fillRect(x - 1, jy - 3, 7, 4);
    c.fillStyle = pal.glassHi; c.fillRect(x - 1, jy - 2, 3, 2);
    /* jib reaches back over the yard, counter-jib to the right */
    const jx0 = Math.max(2, L.pileX.lumber - 6);
    c.fillStyle = pal.crane; c.fillRect(jx0, jy - 1, x - jx0, 1); c.fillRect(jx0, jy + 1, x - jx0, 1);
    c.fillStyle = pal.craneDark; for (let xx = jx0; xx < x; xx += 3) c.fillRect(xx, jy, 1, 1);
    c.fillRect(x + 5, jy - 1, 12, 1); c.fillRect(x + 5, jy + 1, 12, 1);
    c.fillStyle = pal.weight; c.fillRect(x + 11, jy + 1, 6, 4);
    /* the tower top (A-frame) and its tie lines */
    c.fillStyle = pal.crane; c.fillRect(x + 2, jy - 9, 1, 6);
    c.fillStyle = mix(pal.cable, pal.skyHor, 0.4);
    for (let i = 1; i < 26; i++) c.fillRect(Math.round(x + 2 - i * (x + 2 - jx0) / 26 * 0.55), Math.round(jy - 9 + i * 8 / 26), 1, 1);
    for (let i = 1; i < 8; i++) c.fillRect(x + 2 + i * 2, jy - 9 + i, 1, 1);
    if (snowy) { c.fillStyle = pal.snow; c.fillRect(jx0, jy - 2, x - jx0, 1); }
  }
  function drawCutaway(c, af) {
    /* your part of it: the front comes off, and the pieces you built glow */
    const top = L.fBottom[Math.min(af + (topped() ? 0 : 1), L.floors)];
    c.fillStyle = 'rgba(20,16,14,0.72)'; c.fillRect(L.bx, top, L.BW, L.groundY - top);
    const pieces = [];
    const maxF = Math.min(af + (topped() ? 0 : 1), L.floors);
    for (let f = 0; f < maxF; f++) {
      const t = L.fBottom[f + 1], bt = L.fBottom[f];
      c.fillStyle = shade('#5a4a3c'); c.fillRect(L.bx, bt - 1, L.BW, 1);
      for (let b = 0; b < NB; b++) {
        if (f === af && !done('frame', b)) continue;
        const bay = L.bays[b];
        pieces.push({ k: 'post', x: bay.ax, y: t, h: bt - t });
        pieces.push({ k: 'wire', x: bay.ax + 1, y: t + 5, w: bay.w - 2 });
        pieces.push({ k: 'stud', x: bay.ax + 4, y: t + 2, h: bt - t - 2 });
        pieces.push({ k: 'pipe', x: bay.ax + bay.w - 3, y: t + 2, h: bt - t - 2 });
        pieces.push({ k: 'wall', x: bay.ax + 1, y: bt - 3, w: bay.w - 2 });
      }
    }
    const mine = new Set();
    const n = Math.min(pieces.length, Math.ceil(Math.max(0, S.yourMinutes) / 12));
    const order = pieces.map((p, i) => i).sort((p, q) => hash('y' + p) - hash('y' + q));
    for (let i = 0; i < n; i++) mine.add(order[i]);
    pieces.forEach((p, i) => {
      const me = mine.has(i);
      const col = me ? EMIT.lamp : p.k === 'wire' ? shade('#7a5a40') : p.k === 'pipe' ? shade('#4a5a6a') : shade('#6a5644');
      c.fillStyle = col;
      if (p.k === 'post' || p.k === 'stud' || p.k === 'pipe') c.fillRect(p.x, p.y, 1, p.h);
      else c.fillRect(p.x, p.y, p.w, 1);
      if (me) { c.fillStyle = 'rgba(255,207,58,0.25)'; if (p.h) c.fillRect(p.x - 1, p.y, 3, p.h); else c.fillRect(p.x, p.y - 1, p.w, 3); }
    });
  }

  /* --------------------------------------------- the trailer + foreman */
  function drawTrailer(c) {
    const x = L.trailerX, gy = L.groundY, w = L.trailerW, h = L.trailerH, y = gy - h - 1;
    c.fillStyle = pal.tire; c.fillRect(x + 3, gy - 1, 3, 2); c.fillRect(x + w - 7, gy - 1, 3, 2);
    c.fillStyle = pal.trailerShade; c.fillRect(x, y, w, h);
    c.fillStyle = pal.trailer; c.fillRect(x, y, w, h - 1);
    c.fillStyle = pal.trailerTrim; c.fillRect(x, y, w, 1); c.fillRect(x, y + h - 1, w, 1);
    for (let xx = x + 2; xx < x + w; xx += 3) { c.fillStyle = pal.trailerShade; c.fillRect(xx, y + 1, 1, h - 2); }
    const lit = night > 0.4;
    c.fillStyle = lit ? EMIT.winLit : pal.glass; c.fillRect(x + 3, y + 3, 6, 4); c.fillRect(x + 11, y + 3, 4, 4);
    c.fillStyle = pal.trailerTrim; c.fillRect(x + 3, y + 7, 6, 1); c.fillRect(x + 11, y + 7, 4, 1);
    /* the door, on the side that faces the building */
    const dx = x + w - 9;
    c.fillStyle = lit ? EMIT.doorLit : pal.interior; c.fillRect(dx, y + 1, 6, h - 2);
    c.fillStyle = pal.door; c.fillRect(dx + 6, y + 1, 1, h - 2);
    /* steps */
    c.fillStyle = pal.step; c.fillRect(dx - 1, gy - 1, 8, 1); c.fillRect(dx, gy - 2, 6, 1);
    if (snowy) { c.fillStyle = pal.snow; c.fillRect(x - 1, y - 1, w + 2, 1); }
    /* "WATERSHED" on the site sign by the gate, where there's room */
    return dx;
  }
  function drawForeman(c, doorX) {
    const f = foreman, gy = L.groundY;
    const look = { H: HATS.white, V: '#ff8a2a', S: SKINS[4], hair: '#8a8a8a' };
    const inDoor = f.phase === 'in';
    const x = doorX - 1 + Math.round(f.dx), y = gy - 2 - (inDoor ? 1 : 0) - 13 + (f.nod ? 1 : 0);
    const facing = (f.phase === 'back') ? -1 : 1;
    c.drawImage(sprite(f.pose, look, facing), x, y);
    if (f.phase === 'raise' && !reduced) {
      /* the whistle: a couple of little sound marks that pulse */
      const on = ((S.t * 3) | 0) % 2 === 0;
      if (on) { c.fillStyle = night > 0.5 ? EMIT.lamp : pal.white; c.fillRect(x + 10, y + 1, 1, 1); c.fillRect(x + 11, y, 1, 1); c.fillRect(x + 11, y + 3, 1, 1); c.fillRect(x + 12, y + 2, 1, 1); c.fillRect(x + 13, y + 1, 1, 1); c.fillRect(x + 13, y + 4, 1, 1); }
    } else if (f.phase === 'raise') {
      c.fillStyle = pal.white; c.fillRect(x + 10, y + 1, 1, 1); c.fillRect(x + 11, y, 1, 1); c.fillRect(x + 12, y + 2, 1, 1);
    }
  }

  function drawForklift(c) {
    const x = Math.round(fork.x), gy = L.groundY + 6, d = fork.dir;
    /* body */
    const bx = d > 0 ? x : x - 12;
    c.fillStyle = pal.forkDark; c.fillRect(bx, gy - 4, 10, 4);
    c.fillStyle = pal.fork; c.fillRect(bx, gy - 5, 10, 3); c.fillRect(d > 0 ? bx : bx + 6, gy - 9, 4, 4);
    /* overhead guard */
    c.fillStyle = pal.mast; c.fillRect(d > 0 ? bx + 5 : bx + 1, gy - 13, 4, 1); c.fillRect(d > 0 ? bx + 8 : bx + 1, gy - 13, 1, 8); c.fillRect(d > 0 ? bx + 5 : bx + 4, gy - 13, 1, 8);
    /* driver */
    const look = { H: HATS.yellow, V: VESTS.lime, S: SKINS[2], hair: '#1f1a17' };
    const spr = sprite('sitB', look, d);
    c.drawImage(spr, 0, 0, 9, 9, d > 0 ? bx + 2 : bx + 1, gy - 15, 9, 9);
    /* mast + forks at the front */
    const mx = d > 0 ? bx + 10 : bx - 1;
    c.fillStyle = pal.mast; c.fillRect(mx, gy - 14, 1, 13);
    const fy = gy - 2 - Math.round(fork.lift);
    c.fillStyle = pal.mast; c.fillRect(d > 0 ? mx + 1 : mx - 5, fy, 5, 1);
    if (fork.load) drawPallet(c, d > 0 ? mx + 1 : mx - 6, fy - 1, fork.load);
    /* wheels */
    c.fillStyle = pal.tire; c.fillRect(bx + 1, gy - 1, 3, 2); c.fillRect(bx + 7, gy - 1, 3, 2);
  }
  function drawPallet(c, x, y, kind) {
    c.fillStyle = pal.pallet; c.fillRect(x, y, 6, 1);
    const col = { lumber: pal.timber, brick: pal.brick, glass: pal.glassHi, copper: pal.copper, nails: shade('#8b939b') }[kind] || pal.timber;
    c.fillStyle = col; c.fillRect(x, y - 3, 6, 3);
    c.fillStyle = mix(col, '#000000', 0.25); c.fillRect(x, y - 1, 6, 1);
  }

  function drawCraneMoving(c) {
    const jy = craneJibY();
    const tx = Math.round(crane.trolley), hy = Math.round(crane.hook);
    if (L.craneX + 5 > WW + 3) return;
    c.fillStyle = pal.craneDark; c.fillRect(tx - 1, jy + 2, 3, 1);
    c.fillStyle = pal.cable; c.fillRect(tx, jy + 3, 1, hy - jy - 3);
    c.fillStyle = pal.craneDark; c.fillRect(tx - 1, hy, 3, 2);
    if (crane.load === 'panel') { c.fillStyle = pal.timberShade; c.fillRect(tx - 5, hy + 2, 11, 2); c.fillStyle = pal.timber; c.fillRect(tx - 5, hy + 2, 11, 1); }
    if (crane.load === 'beam') {
      c.fillStyle = pal.timberDark; c.fillRect(tx - 9, hy + 2, 18, 2);
      c.fillStyle = pal.evergreen; c.fillRect(tx - 1, hy - 8, 3, 10); c.fillRect(tx - 2, hy - 4, 5, 6);
    }
    /* red light on the top at night */
    if (night > 0.5 && ((S.t * 1.2) | 0) % 2 === 0) { c.fillStyle = EMIT.craneRed; c.fillRect(L.craneX + 2, jy - 10, 1, 1); c.fillRect(Math.max(2, L.pileX.lumber - 6), jy - 2, 1, 1); }
  }

  /* glows: a pool of warm light, cached */
  let glowSprite = null;
  function glow(c, x, y, r, a) {
    if (!glowSprite) {
      glowSprite = document.createElement('canvas'); glowSprite.width = glowSprite.height = 64;
      const g = glowSprite.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,190,100,1)'); gr.addColorStop(0.4, 'rgba(255,170,80,0.45)'); gr.addColorStop(1, 'rgba(255,160,70,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    }
    c.globalAlpha = a; c.globalCompositeOperation = 'lighter';
    c.drawImage(glowSprite, x - r, y - r, r * 2, r * 2);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
  function drawLights(c) {
    if (night < 0.35) return;
    const k = clamp((night - 0.35) / 0.4, 0, 1);
    const gy = L.groundY;
    /* light tower in the yard */
    const lx = L.lightX;
    c.fillStyle = pal.mast; c.fillRect(lx, gy - 22, 1, 24); c.fillRect(lx - 2, gy + 1, 5, 1);
    c.fillStyle = EMIT.lamp; c.fillRect(lx - 2, gy - 24, 2, 2); c.fillRect(lx + 1, gy - 24, 2, 2);
    glow(c, lx + 8, gy - 4, 34, 0.3 * k);
    /* clamp lights on the platform */
    const af = activeFloor(), lv = topped() ? L.roofY : L.fBottom[af];
    if (af > 0 || topped()) {
      for (let i = 0; i < 3; i++) {
        const x = L.bx + Math.round((i + 0.5) * L.BW / 3);
        c.fillStyle = EMIT.lamp; c.fillRect(x, lv - 7, 2, 1);
        glow(c, x + 1, lv - 4, 18, 0.35 * k);
      }
    } else glow(c, L.bx + L.BW / 2, gy - 2, 30, 0.3 * k);
    /* the foreman's doorway */
    glow(c, L.trailerX + L.trailerW - 6, gy - 6, 12, 0.35 * k);
    /* lit windows bloom a little */
    const lit = litWindows();
    for (const s of lit) { const f = (s / 100) | 0, b = s % 100; const wr = windowRect(b, f); if (wr) glow(c, wr[0] + wr[2] / 2, wr[1] + wr[3] / 2, 7, 0.18 * k); }
  }

  function drawClouds(c) {
    /* in view coordinates, drifting, with a touch of parallax */
    const w = S.weather;
    const n = w === 'cloud' || w === 'rain' || w === 'snow' ? 6 : w === 'fog' ? 0 : 3;
    const skyH = L.horizon - 30 - cam.y;            // sky visible above the mountains
    if (night > 0.7 && w === 'clear') {
      const mx = W - 26, my = Math.max(8, Math.min(18, skyH - 10));
      if (skyH > 14) {
        c.fillStyle = EMIT.moon; c.fillRect(mx - 2, my - 3, 4, 7); c.fillRect(mx - 3, my - 2, 6, 5);
        c.fillStyle = pal.skyTop; c.fillRect(mx, my - 3, 2, 5); c.fillRect(mx + 1, my - 2, 2, 4);
      }
    }
    if (skyH < 8) return;
    const col = night > 0.6 ? mix(pal.skyTop, '#8090b0', 0.25) : mix(shade('#ffffff'), pal.skyHor, w === 'clear' ? 0.1 : 0.45);
    const shadeC = mix(col, pal.skyTop, 0.3);
    for (let i = 0; i < n; i++) {
      const r = rng(31 + i), cw = 14 + ((r() * 20) | 0), cy = 4 + ((r() * Math.max(6, skyH - 6)) | 0);
      const x = (((r() * (W + 60)) + S.t * (0.6 + r() * 0.8) - cam.x * 0.3) % (W + 60) + (W + 60)) % (W + 60) - 40;
      c.fillStyle = shadeC; c.fillRect(Math.round(x), cy + 2, cw, 2);
      c.fillStyle = col; c.fillRect(Math.round(x) + 2, cy, cw - 4, 3); c.fillRect(Math.round(x) + 5, cy - 2, Math.round(cw / 3), 2);
    }
  }
  function drawLake(c) {
    /* glints on the water (world coordinates), and in summer the kitesurfers */
    const lakeTop = L.horizon + 2, lakeBot = L.groundY - 23;
    if (lakeBot - lakeTop < 2 || reduced) return;
    const r = rng(((S.t * 2) | 0));
    c.fillStyle = night > 0.6 ? 'rgba(200,210,240,0.35)' : 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 6; i++) c.fillRect(Math.round(cam.x + r() * W), lakeTop + ((r() * (lakeBot - lakeTop)) | 0), 2, 1);
    if (S.evening && S.alt > -2 && S.alt < 14 && S.weather === 'clear') {
      c.fillStyle = 'rgba(255,200,130,0.7)';
      for (let y = lakeTop; y < lakeBot; y++) if (r() < 0.7) c.fillRect(SUN_X - 2 + ((r() * 5) | 0), y, 2, 1);
    }
    const m = nowDate().getMonth();
    if (m >= 5 && m <= 8 && night < 0.3 && S.weather === 'clear') {
      for (let i = 0; i < 3; i++) {
        const kx = Math.round(440 + i * 34 + Math.sin(S.t / 9 + i) * 10), ky = lakeTop + 2 + (i % 2);
        c.fillStyle = '#2b1d1a'; c.fillRect(kx, ky, 1, 1);
        c.fillStyle = ['#3d7bd9', '#d9443a', '#f2c230'][i]; c.fillRect(kx - 3, ky - 6, 3, 1); c.fillRect(kx - 4, ky - 5, 1, 1);
      }
    }
  }
  function drawFence(c) {
    /* the chain-link along Lakeside Ave, with a gap for the gate */
    const st = L.street - 2, y = st - 6;
    c.fillStyle = pal.fence;
    for (let x = 0; x < WW; x += 8) if (x <= L.gateX || x >= L.gateX + 12) c.fillRect(x, y, 1, 7);
    c.fillRect(0, y, L.gateX, 1); c.fillRect(L.gateX + 12, y, WW, 1);
    c.fillStyle = 'rgba(168,176,182,0.35)';
    for (let x = 0; x < WW; x += 2) if (x < L.gateX || x > L.gateX + 12) c.fillRect(x, y + 2 + (x % 4 === 0 ? 0 : 2), 1, 1);
    /* the gate posts */
    c.fillStyle = pal.fence; c.fillRect(L.gateX, y - 1, 1, 8); c.fillRect(L.gateX + 12, y - 1, 1, 8);
    /* the site sign */
    const label = 'WATERSHED', tw = textWidth(label);
    const sx = Math.min(WW - tw - 6, Math.max(L.gateX + 18, L.bx + 6)), sy = y - 1;
    if (sx + tw + 4 < WW) {
      c.fillStyle = pal.sign; c.fillRect(sx, sy, tw + 4, 8);
      c.fillStyle = pal.trailerTrim; c.fillRect(sx, sy + 8, tw + 4, 1);
      drawText(c, label, sx + 2, sy + 2, shade('#2f6fb2'));
    }
    if (snowy) { c.fillStyle = pal.snow; c.fillRect(0, y - 1, L.gateX, 1); c.fillRect(L.gateX + 12, y - 1, WW, 1); }
  }

  function drawAgent(c, a) {
    if (a.gone || a.x < cam.x - 10 || a.x > cam.x + W + 10) return;
    const look = a.colors || (a.colors = colorsFor(a));
    const spr = sprite(a.pose || 'stand', look, a.facing, a.blink ? 'blink' : '');
    const x = Math.round(a.x) - 4, y = Math.round(a.y) - 13 + (a.bob || 0) + (a.sitting && a.level === 'beam' ? 0 : 0);
    c.drawImage(spr, x, y);
    /* tools set down beside you when you pick the phone up */
    if (a.me && a.dropped && a.state === 'paused') drawPallet(c, Math.round(a.dropped.x), Math.round(a.dropped.y), a.dropped.kind);
    if (a.me && a.state !== 'off') {
      /* your marker: a little gold chevron that breathes */
      const by = y - 4 - (reduced ? 0 : (((S.t * 1.5) | 0) % 2));
      c.fillStyle = pal.outline; c.fillRect(x + 2, by - 1, 5, 1);
      c.fillStyle = EMIT.lamp === pal.marker ? pal.marker : BASE.marker; c.fillRect(x + 2, by, 5, 1); c.fillRect(x + 3, by + 1, 3, 1); c.fillRect(x + 4, by + 2, 1, 1);
    }
  }
  function drawLabel(c, a, text) {
    const tw = textWidth(text), x = clamp(Math.round(a.x) - (tw >> 1) - 2, Math.round(cam.x) + 1, Math.round(cam.x) + W - tw - 5), y = Math.round(a.y) - 24;
    c.fillStyle = 'rgba(22,25,29,0.82)'; c.fillRect(x, y, tw + 4, 9);
    drawText(c, text, x + 2, y + 2, '#f7f4ee');
  }

  function render() {
    if (destroyed || !L) return;
    const t0 = performance.now();
    if (bgDirty || !bgCache) drawBackground();
    if (bldDirty || !bldCache) drawBuilding();
    const c = ctx;
    c.imageSmoothingEnabled = false;
    const cx = Math.round(cam.x), cy = Math.round(cam.y);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(bgCache, cx, cy, W, H, 0, 0, W, H);
    drawClouds(c);
    c.setTransform(1, 0, 0, 1, -cx, -cy);
    drawLake(c);
    c.drawImage(bldCache, cx, cy, W, H, cx, cy, W, H);
    const doorX = drawTrailer(c);
    drawForeman(c, doorX);
    for (const d of S.deliveries) drawPallet(c, d.x, L.groundY + 6 - (d.bounce > 0 ? Math.round(d.bounce) : 0), d.kind);
    /* figures, back to front */
    const list = [...agents.values()].filter((a) => !a.gone).sort((p, q) => p.y - q.y);
    let forkDrawn = false;
    for (const a of list) {
      if (!forkDrawn && a.y > L.groundY + 6) { drawForklift(c); forkDrawn = true; }
      drawAgent(c, a);
    }
    if (!forkDrawn) drawForklift(c);
    drawCraneMoving(c);
    /* particles */
    for (const p of S.particles) {
      c.fillStyle = p.c;
      if (p.wx === 2) c.fillRect(Math.round(p.x), Math.round(p.y), 1, 3);
      else if (p.puff) c.fillRect(Math.round(p.x), Math.round(p.y), 2, 1);
      else c.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    drawFence(c);
    drawLights(c);
    if (hover && performance.now() < hoverUntil) {
      const a = agents.get(hover);
      if (a && !a.gone) drawLabel(c, a, a.me ? 'YOU' : (a.name || '').split(' ')[0].toUpperCase().slice(0, 10));
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (S.weather === 'fog') { c.fillStyle = 'rgba(214,218,222,0.28)'; c.fillRect(0, 0, W, Math.max(0, L.groundY - cy)); }
    const ms = performance.now() - t0;
    stats.frames++; stats.total += ms; stats.max = Math.max(stats.max, ms); stats.last = ms;
    if (stats.samples.length < 4000) stats.samples.push(ms);
  }

  /* ============================================================ the loop */
  function tick(dt) {
    dt = Math.min(dt, 0.25);
    S.t += dt;
    for (const a of agents.values()) step(a, dt);
    for (const [id, a] of agents) if (a.gone && !a.me) agents.delete(id);
    stepCrane(dt); stepFork(dt); stepForeman(dt); stepParticles(dt);
    aimCamera(dt);
    for (const d of S.deliveries) if (d.bounce > 0) d.bounce = Math.max(0, d.bounce - dt * 20);
    if (S.toppedAt != null && !S.beamSet && !crane.busy && !reduced) craneJob(L.bays.find((q) => q.vol === 'C').ax + 8, L.roofY, true);
  }
  function frame(ts) {
    raf = 0;
    if (destroyed || !visible || !onScreen) return;
    raf = requestAnimationFrame(frame);
    if (ts - lastFrame < 1000 / 30 - 2) return;   // 30fps cap
    const dt = lastFrame ? (ts - lastFrame) / 1000 : 1 / 30;
    lastFrame = ts;
    if (layout()) { /* size changed */ }
    tick(dt);
    render();
  }
  function start() {
    if (destroyed) return;
    if (reduced) {
      /* still frames that still change state: jump the crew ahead every few seconds */
      if (!rmTimer && visible && onScreen) rmTimer = setInterval(() => { layout(); advanceSteps(8); render(); }, 6000);
      layout(); render();
      return;
    }
    if (!raf && visible && onScreen) { lastFrame = 0; raf = requestAnimationFrame(frame); }
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf); raf = 0;
    if (rmTimer) clearInterval(rmTimer); rmTimer = 0;
  }
  function advanceSteps(seconds) {
    const n = Math.ceil(seconds / 0.1);
    for (let i = 0; i < n; i++) tick(0.1);
  }
  /* when anything changes and we're not animating, draw one frame */
  function poke() { if (reduced || !raf) { if (L) render(); } }

  const onVis = () => { visible = document.visibilityState !== 'hidden'; if (visible) start(); else stop(); };
  document.addEventListener('visibilitychange', onVis);
  let io = null;
  if (typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver((es) => { onScreen = es.some((e) => e.isIntersecting); if (onScreen) start(); else stop(); });
    io.observe(canvas);
  }
  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => { if (layout()) poke(); }); ro.observe(canvas); }

  /* names on hover (or a tap): first name, or just the hard hat */
  const onPointer = (e) => {
    if (!L) return;
    const r = canvas.getBoundingClientRect();
    const x = Math.round(cam.x) + (e.clientX - r.left) / r.width * W, y = Math.round(cam.y) + (e.clientY - r.top) / r.height * H;
    let best = null, bd = 9;
    for (const a of agents.values()) {
      if (a.gone) continue;
      const d = Math.abs(a.x - x) + Math.abs(a.y - 7 - y) * 0.7;
      if (d < bd && (a.me || a.name)) { bd = d; best = a; }
    }
    hover = best ? best.id : null; hoverUntil = performance.now() + 2500;
    poke();
  };
  canvas.addEventListener('pointermove', onPointer);
  canvas.addEventListener('pointerdown', onPointer);

  /* ============================================================ the API */
  setLight(); loadMarks(); layout(); pruneMarks();
  let firstCrew = true;

  const api = {
    setTown(t = {}) {
      const prevTop = topped(), prevF = activeFloor(), prevBase = baseline(), prevLit = S.town.windows_lit;
      Object.assign(S.town, {
        total_minutes: +t.total_minutes || 0,
        floors_done: Math.max(0, t.floors_done | 0),
        floor_progress: clamp(+t.floor_progress || 0, 0, 1),
        windows_lit: Math.max(0, (t.windows_lit != null ? t.windows_lit : t.posts_lit) | 0),
        floors: t.floors ? clamp(t.floors | 0, 2, 12) : S.town.floors,
        topped_out: !!t.topped_out,
      });
      if (L && L.floors !== S.town.floors) { L = null; layout(); }
      if (activeFloor() !== prevF) { pruneMarks(); saveMarks(); for (const a of agents.values()) { a.plan = []; a.act = null; a.target = null; if (a.level !== 'g') { a.level = workLevel(); a.y = yFor(a); } } }
      if (!prevTop && topped()) { S.toppedAt = S.t; S.beamSet = reduced || !L; }
      if (topped() && S.toppedAt == null) { S.toppedAt = -1e9; S.beamSet = true; }
      if (prevBase !== baseline() || prevLit !== S.town.windows_lit || activeFloor() !== prevF || prevTop !== topped()) bldDirty = true;
      poke();
    },
    setCrew(list = []) {
      const morning = (() => { const h = S.sky.hour != null ? S.sky.hour : nowDate().getHours(); return h >= 6 && h < 10; })();
      const seen = new Set();
      for (const p of (Array.isArray(list) ? list : []).slice(0, 30)) {
        if (!p || p.me) continue;
        const id = 'c:' + (p.id != null ? p.id : (p.name || seen.size));
        seen.add(id);
        let a = agents.get(id);
        if (!a) {
          a = makeAgent(id, false);
          agents.set(id, a);
          a.look = p.look || {}; a.colors = null; a.task = p.task; a.name = p.name || null;
          if (firstCrew && !morning) placeAtStation(a);
          else enterFromGate(a, morning);
        } else {
          if (a.state === 'off') { a.state = 'working'; enterFromGate(a, false); }
          if (a.task !== p.task) { a.task = p.task; a.plan = []; if (a.act && a.act.k === 'work') a.act = null; }
          a.look = p.look || {}; a.colors = null; a.name = p.name || null;
        }
      }
      for (const [id, a] of agents) if (!a.me && !seen.has(id) && a.state !== 'off') { a.state = 'off'; a.plan = []; a.act = null; }
      firstCrew = false;
      poke();
    },
    setYou(y = {}) {
      const state = ['working', 'paused', 'off', 'away'].includes(y.state) ? y.state : 'away';
      if (!you) { you = makeAgent('you', true); agents.set('you', you); you.state = state; you.look = y.look || {}; you.task = y.task; if (state === 'off') { you.gone = true; } else placeAtStation(you); }
      const prev = you.state;
      you.look = y.look || you.look; you.colors = null;
      if (y.task && y.task !== you.task) { you.task = y.task; if (state === 'working' && prev === 'working') { you.plan = []; } }
      you.state = state;
      if (prev === state) { poke(); return; }
      if (state === 'paused') {
        /* tools down, right where they are */
        if (you.carry && you.carry !== 'mug') { you.dropped = { kind: you.carry === 'copper' ? 'copper' : you.carry, x: you.x + you.facing * 3, y: you.y }; you.carry = null; }
        const climbing = you.act && you.act.k === 'climb';
        you.plan = climbing ? [you.act] : []; you.act = null;
        you.plan.push({ k: 'pauseHold' });
      } else if (state === 'working') {
        if (prev === 'off' || prev === 'away' || you.gone) {
          if (you.gone || prev === 'off') enterFromGate(you, false);
          else { you.plan = [{ k: 'idle', pose: 'stand', dur: 0.6 }]; you.act = null; }
        } else {
          /* pick the bucket back up and carry on */
          you.act = null; you.plan = [];
          if (you.dropped) { you.plan.push({ k: 'pick', item: you.dropped.kind }); you.dropped = null; }
        }
      } else if (state === 'off') {
        you.dropped = null; you.plan = [{ k: 'leave' }]; you.act = null;
      } else if (state === 'away') {
        you.gone = false; if (prev === 'off') enterFromGate(you, false);
        you.plan = []; you.act = null;
      }
      you.gone = state === 'off' ? you.gone : false;
      poke();
    },
    whistle(on) { S.whistle = !!on; if (reduced) { foreman.phase = on ? 'raise' : 'in'; foreman.dx = on ? 6 : 0; foreman.pose = on ? 'frontRaise' : 'frontMug'; } poke(); },
    setSky(sky = {}) {
      S.sky = { ...S.sky, ...sky };
      if (sky.sunAltitude == null && sky.isNight != null) S.sky.sunAltitude = sky.isNight ? -15 : 30;
      setLight(); poke();
    },
    dropMaterial(kind) {
      const k = SITE_MATERIALS.includes(kind) ? kind : 'lumber';
      if (S.deliveries.length < 4) S.deliveries.push({ kind: k, x: L ? L.deliverX + S.deliveries.length * 7 : 10, bounce: reduced ? 0 : 6 });
      if (reduced) { S.deliveries.shift(); S.piles[k] = Math.min(5, (S.piles[k] || 0) + 1); bgDirty = true; }
      poke();
    },
    cutaway(on, o = {}) { S.cut = !!on; S.yourMinutes = +(o && o.your_minutes) || 0; bldDirty = true; poke(); },
    destroy() {
      destroyed = true; stop();
      document.removeEventListener('visibilitychange', onVis);
      if (io) io.disconnect(); if (ro) ro.disconnect();
      canvas.removeEventListener('pointermove', onPointer); canvas.removeEventListener('pointerdown', onPointer);
      agents.clear(); spriteCache.clear(); bgCache = bldCache = null;
    },
    /* preview + tests */
    advance(seconds) { advanceSteps(+seconds || 0); if (L) render(); },
    render() { layout(); render(); },
    stats() {
      const s = stats.samples.slice().sort((p, q) => p - q);
      const pct = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0);
      return { frames: stats.frames, avgMs: stats.frames ? stats.total / stats.frames : 0, p50: pct(0.5), p95: pct(0.95), maxMs: stats.max, size: [W, H], agents: agents.size, running: !!raf };
    },
    resetStats() { stats.frames = 0; stats.total = 0; stats.max = 0; stats.samples = []; },
  };
  start();
  return api;
}
