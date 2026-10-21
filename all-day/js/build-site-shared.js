/* build-site-shared.js — the job site's shared ground truth: the world's
   layout (zones and named spots), the base palette, the vocabularies every
   module agrees on, and small helpers. Every build-site-*.js module imports
   this; nothing here draws or holds state.

   World units: one unit is about one v1 site pixel. A person is ~14 units
   tall, a floor 13 (the ground floor 17). x runs west → east along Lakeside
   Ave; y runs down. The yard is a strip of depth between the back line
   (GROUND_Y, where the building and the sheds stand) and the fence (YARD_FRONT);
   a figure's feet y inside that strip is its depth, and things are drawn back
   to front by feet y. The lake and the Adirondacks are behind (smaller y). */

export const WW = 900;          // world width
export const WH = 570;          // world height (sky at 0)
export const GROUND_Y = 450;    // back line of the yard: the building, sheds, trailer stand here
export const YARD_FRONT = 498;  // inside face of the fence
export const STREET_Y = 503;    // top of Lakeside Ave's travel lanes
export const HORIZON = 398;     // far shore of the lake

/* Zones, west to east. x0..x1 are world x; `spots` are named places other
   modules walk to (feet positions). Keep names stable: the crew, the
   director and the building all refer to them. */
export const ZONES = {
  street:   { x0: 0, x1: WW, label: 'Lakeside Ave' },
  gate:     { x0: 62, x1: 82, spots: { in: [72, 492], out: [72, 512] } },
  staging:  { x0: 84, x1: 172, label: 'deliveries', spots: { truck: [128, 478], spotter: [92, 488], drop: [150, 470], drop2: [112, 470] } },
  office:   { x0: 176, x1: 216, label: 'site trailer', spots: { door: [209, 463], step: [206, 468], foreman: [212, 470], pot: [200, 466] } },
  canteen:  { x0: 218, x1: 264, label: 'coffee and lunch', spots: { urn: [228, 466], table: [246, 474], seat1: [238, 476], seat2: [252, 476], seat3: [244, 482], awning: [240, 470] } },
  lumber:   { x0: 268, x1: 360, label: 'lumber yard and prefab shed', spots: { rack: [278, 470], saw: [300, 474], trestle: [326, 476], panels: [348, 470], hook: [326, 466] } },
  masonry:  { x0: 364, x1: 402, label: 'brick and stone', spots: { bricks: [372, 470], mixer: [390, 474], barrow: [384, 486] } },
  pad:      { x0: 404, x1: 530, label: 'Watershed', spots: { tower: [406, 470], base: [470, 470], front: [470, 488] } },
  crane:    { x0: 532, x1: 548, spots: { mast: [538, 452] } },
  tools:    { x0: 552, x1: 630, label: 'toolshed', spots: { shed: [566, 470], john: [596, 466], dumpster: [614, 470] } },
  sidegate: { x0: 634, x1: 646, spots: { in: [640, 492], out: [640, 512] } },
  bench:    { x0: 650, x1: 720, label: 'lakeside bench', spots: { seat: [676, 470], seat2: [688, 470], tree: [706, 466], view: [668, 466] } },
  mill:     { x0: 724, x1: WW, label: 'the old mill' },
};

/* The building's footprint (Watershed) on the pad, and its massing. */
export const BUILDING = {
  x0: 410, x1: 523,             // 113 units wide: left wing, middle block, glass slot, brick corner
  floors: 6, groundFloorH: 17, floorH: 13,
  towerX: 402,                  // scaffold stair tower (ladder at towerX + 3)
  craneX: 534,                  // tower crane mast
};
/* Bays across the front: 3 in the rust left wing (L), 4 in the rust middle
   block (M), the dark glass slot (G), 3 in the brick corner (C). */
export const BAYS = (() => {
  const out = []; let x = BUILDING.x0;
  for (let i = 0; i < 3; i++) { out.push({ i: out.length, x, w: 11, vol: 'L' }); x += 11; }
  for (let i = 0; i < 4; i++) { out.push({ i: out.length, x, w: 11, vol: 'M' }); x += 11; }
  out.push({ i: out.length, x, w: 6, vol: 'G' }); x += 6;
  for (let i = 0; i < 3; i++) { out.push({ i: out.length, x, w: 10, vol: 'C' }); x += 10; }
  for (const b of out) b.cx = b.x + b.w / 2;
  return out;
})();
export function floorBottom(f) { return GROUND_Y - (f <= 0 ? 0 : BUILDING.groundFloorH + (f - 1) * BUILDING.floorH); }
export function floorHeight(f) { return f === 0 ? BUILDING.groundFloorH : BUILDING.floorH; }

/* Vocabularies (shared with build-core.js). */
export const SITE_TASKS = ['haul', 'frame', 'brick', 'wire', 'window', 'roof', 'lunch'];
export const SITE_MATERIALS = ['lumber', 'brick', 'glass', 'copper', 'nails'];
/* What people carry. The art module draws each; the crew and director pick. */
export const CARRY = ['beam', 'panel', 'bricks', 'barrow', 'pane', 'paneL', 'paneR', 'spool', 'rebar', 'stakes', 'bucket', 'mug', 'thermos', 'sandwich', 'clipboard', 'cake', 'toolbox', 'shovel', 'tarp', 'snowball', 'flag', 'plant', 'hat'];
/* Poses the art module animates. `t` is seconds into the pose; cycles loop. */
export const POSES = ['stand', 'walk', 'run', 'climb', 'hammer', 'drill', 'trowel', 'saw', 'measure', 'pullwire', 'shovel', 'rake', 'kneel', 'pour', 'push', 'lift', 'signal', 'guide', 'sweep', 'plant', 'sit', 'sitbeam', 'drink', 'eat', 'wave', 'clap', 'point', 'look', 'shrug', 'huddle', 'throw', 'pet', 'crouch', 'stretch', 'cheer', 'nod', 'raise', 'sleep', 'bend'];
/* Wordless thought/feeling icons over a head. */
export const EMOTES = ['heart', 'note', 'bang', 'question', 'dots', 'zzz', 'star', 'sweat', 'coffee', 'idea', 'sun', 'cake'];

export const HATS = { yellow: '#f2c230', white: '#f4f1e8', orange: '#f07f2a', blue: '#3d7bd9', red: '#d9443a', green: '#3fae5a',
  amber: '#f2b134', lake: '#2f6fb2', brick: '#b55a3c', park: '#2f8a5a', pink: '#ff7fae', lime: '#b8e03a' };
export const VESTS = { orange: '#ff8a2a', lime: '#c8f03c', yellow: '#f5e23a', pink: '#ff6fa8', blue: '#4c95ff',
  amber: '#f7b84a', lake: '#4c95ff', brick: '#ff7a4a', park: '#5fd08a', green: '#5fd08a', red: '#ff5a4a', white: '#e8e8e0' };
export const SKINS = ['#f1c9a0', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#b9774e'];
export const HAIRS = ['#3d2b20', '#1f1a17', '#7a4a2a', '#c9a36a', '#8a8a8a'];

/* Base palette (daylight). The art module lights these into K.pal for the
   current sun and weather; modules draw with K.pal[name]. Add, never rename. */
export const BASE = {
  ink: '#2b1d1a',
  rust: '#b46545', rustMid: '#9f5b3b', rustGroove: '#7a442d', rustBack: '#a35a3d',
  brick: '#8a5340', brickDark: '#5e3a30', mortar: '#a77a64',
  charcoal: '#3a3430', timber: '#c8a27a', timberShade: '#9a7550', timberDark: '#7a5a3c',
  concrete: '#b4afa5', concreteShade: '#8d887f', rebar: '#7a4f3a', formwork: '#c9a66b',
  coping: '#cfc6b6', roof: '#918577',
  glass: '#6f8ca6', glassHi: '#a9c4d8', glassDark: '#2e3b48',
  interior: '#3b302a', copper: '#d9824a', pipe: '#5f8fbf',
  grass: '#7d9a4f', grassDark: '#62803d', dirt: '#b59d7c', dirtDark: '#9c8566', mud: '#8a7258', gravel: '#a49a8b',
  sidewalk: '#cfc8ba', asphalt: '#4a4f5a', lane: '#e3c95a',
  tree: '#4f6f3f', treeDark: '#3e5a35', treeLight: '#6b8a4a', trunk: '#5a4632', autumnA: '#c4572e', autumnB: '#d99a3a',
  mill: '#9a5a44', millDark: '#7a4536',
  trailer: '#e6dfcf', trailerShade: '#c4bba7', trailerTrim: '#8f8574', door: '#6b4a3a', awning: '#2f6fb2', awningStripe: '#f4f1e8',
  scaffold: '#9aa3ab', plank: '#c79a5c', netting: '#e07a2e',
  crane: '#e8b923', craneDark: '#b88e14', cable: '#3a3a3a',
  truck: '#d9443a', truckDark: '#a3302a', fork: '#f0a020', tire: '#26262a', steel: '#8b939b',
  fence: '#8c949b', sign: '#f2efe6', signInk: '#2f6fb2',
  pallet: '#a8875a', shed: '#6f7f6a', shedRoof: '#4a4f55', john: '#3d7bd9', dumpster: '#3f6e4f',
  pants: '#3b4660', boots: '#4a3426', shirt: '#5a6a8a',
  white: '#f4f1e8', snow: '#eef3f7', snowShade: '#b9c6d8', ice: '#d6e2ec',
  solar: '#2c3e63', evergreen: '#2f6b3a', flag: '#d9443a', dog: '#a8743f', bandana: '#d9443a',
};
/* Things that make their own light: never darkened at night. */
export const EMIT = { lamp: '#ffe9a8', lampGlow: '#ffb347', winLit: '#f6d58e', winLitDeep: '#e9b765', craneRed: '#ff4a3d', doorLit: '#f3cf86', moon: '#f2efe0', star: '#e8ecf7', sun: '#fff1c4', sunLow: '#ffc27a', candle: '#ffd36b' };

/* ---------------------------------------------------------------- helpers */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export function hash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h >>> 0; }
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function hexRgb(h) { const n = parseInt(String(h).slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgbHex([r, g, b]) { return '#' + ((1 << 24) | (clamp(Math.round(r), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(b), 0, 255)).toString(16).slice(1); }
export function mix(a, b, t) { const x = hexRgb(a), y = hexRgb(b); return rgbHex([lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)]); }
export function rgba(hex, a) { const c = hexRgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
export function lookColor(v, table, id, salt) {
  if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) return v;
  if (typeof v === 'string' && table[v]) return table[v];
  const vals = Object.values(table); return vals[hash(String(id) + salt) % vals.length];
}
/* A person's colours from a look ({ hat, vest, skin? }) and an id. */
export function colorsFor(id, look = {}) {
  const seed = hash(id);
  return { hat: lookColor(look.hat, HATS, id, 'h'), vest: lookColor(look.vest, VESTS, id, 'v'),
    skin: look.skin && /^#/.test(look.skin) ? look.skin : SKINS[seed % SKINS.length], hair: HAIRS[(seed >>> 4) % HAIRS.length] };
}
/* Local calendar day as YYYY-MM-DD: the director's seed, so every phone sees the same day. */
export function dayKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
