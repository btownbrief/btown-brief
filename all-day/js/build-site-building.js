/* build-site-building.js — Watershed, from an empty fenced lot to topping
   out, and the jobs it needs next.

   Town hours map to stages. Each floor is an ordered list of real pieces
   (a survey stake, a footing's rebar mat, a glulam post, a course of brick,
   a window), each with a share of the floor's progress; the town's
   floor_progress says how many are done, and the one it is part-way through
   is drawn part-way. floors_done 0 covers the beginning:

     floor_progress   what you see
     0.00 – 0.04      the old parking lot (cracked asphalt, faded stripes, wheel stops,
                      grass in the cracks, a puddle), broken up and hauled off quarter by quarter
     0.04 – 0.11      survey stakes with pink flagging tape, then yellow string lines
     0.11 – 0.23      excavation, bay by bay: the pit deepens, the spoil berm grows behind it
     0.23 – 0.31      rebar mats and column dowels in each footing
     0.31 – 0.36      plywood footing forms with kickers along the front
     0.36 – 0.44      the foundation pour, bay by bay: wet glossy concrete rising in the forms
                      ('pour' milestone when the town finishes it)
     0.44 – 0.50      curing: forms stripped, the slab dries pale, backfill gravel along the front
     0.50 – 0.58      concrete podium columns (a plywood form rises, then the bare column)
     0.58 – 0.70      glulam beams and CLT deck panels over the ground floor
     0.70 – 0.80      studs, then wire and pipe through them
     0.80 – 0.96      rust panels on the wing, brick on the corner, the storefront frames, glass
     0.96 – 1.00      the timber canopy over the storefront
   Each later floor (mass timber): glulam posts 0–.10, beams .10–.19, CLT deck
   .19–.31, studs .31–.43, wire .43–.53, cladding .53–.88 (ribbed rust panels;
   brick courses on the corner block; charcoal on the top floor of the wing and
   the middle; the dark glass slot), windows .88–1. Topped out: parapets, the
   timber penthouse box, the last beam with a little evergreen and a flag;
   then solar panels, street trees and planters (this phone's crew does those).

   The work on screen can run a little ahead of the town's hours (the crew
   you're watching finishes real pieces), up to a cap; the further ahead, the
   slower and more careful the work (jobs' dur grows). The town's numbers stay
   the truth, and local pieces are kept on this phone.

   INTERFACE:
     createBuilding(K) -> {
       setTown(T)                     T = K.S.town
       cutaway(on, yourMinutes)
       stage() -> { phase, floor, progress, label, part }    phase: 'lot'|'stakes'|'dig'|'rebar'|'pour'|'cure'|'frame'|'finish'
                                      part: the step inside the phase ('post', 'beam', 'deck', 'stud', 'wire', 'wall', 'glaze', ...)
       jobs() -> [job]                open jobs, in the order the building needs them. job = {
                                        id, kind, part, x, y (feet where a worker stands), level ('ground' | floor index
                                        to climb to), needs (material to bring, or null), crew (1, or 2 for a pane or a
                                        CLT panel), dur (seconds of work), label ('setting a window, 3rd floor'), cell,
                                        at: [x, y] (the piece itself, to aim a tool or the crane at),
                                        spots: [[x, y], [x, y]] (two places to stand when crew is 2),
                                        lift: true when the crane brings it (posts, beams, CLT panels) }
                                      kinds: stake, dig, rebar, form, pour, frame, deck, wire, brick, clad, glaze, solar, plant
                                      parts: clear, stake, string, dig, rebar, form, pour, strip, backfill, column, post, beam,
                                        deck, stud, wire, clad, brick, storefront, glaze, canopy, solar, tree, planter
                                      needs: stakes, shovel, rebar, formwork, beam, panel, bricks, spool, pane, null
       needs() -> [{ key, label }]    the jobs your builder can line up (SITE_JOBS keys), in the order the
                                      building needs them, 'haul' last ('Frame the 3rd floor', 'Haul materials')
       claim(id, who) -> bool         up to job.crew people may claim one job
       release(id, who?)              a released half-done piece stays drawn, faded, and resumes where it was
       work(id, amount 0..1)          partial progress you can see (a course half laid, a post rising,
                                      a wire being pulled, a window sliding in)
       complete(id) -> bool           the piece is done and stays
       topY()                         the top of the work (camera, climbing)
       levelY(level)                  feet y on that level (ground = GROUND_Y + 4)
       ladder() -> { x, top }         where workers climb (the stair tower's ladder) and the working deck
       draw(ctx)                      the structure (cached with K.blit, ver bumps on change) + in-progress pieces
       collect(list)                  depth-sorted bits in front of people: the working-level guardrail and
                                      work lamps, street trees and planters
       step(dt)
       Additions (v2 building):
       hoist() -> { x, y } | null     the material hoist's landing at the working level (null when no scaffold)
       liftTarget() -> { x, y, id } | null   where the crane is setting a piece right now (a claimed post,
                                      beam or CLT panel still in the air)
       piece(id) -> job | null        any piece of the current stage, done or not
       debugPieces(), debug()
     }
     emits K.emit('milestone', { kind: 'pour'|'floor'|'topped', floor, x, y }) when the town crosses one,
     and K.emit('piece', { id, part, x, y }) when a piece is completed on this phone. */

import { GROUND_Y, BUILDING, BAYS, EMIT, JOB_OF_PART, jobLabel, floorBottom, clamp, hash, mix, rgba, ease, hexRgb, rgbHex } from './build-site-shared.js';

const NB = BAYS.length;
const GY = GROUND_Y, X0 = BUILDING.x0, X1 = BUILDING.x1, MIDX = (X0 + X1) / 2;
const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];
const LOCAL_CAP = 14;          // pieces the crew on screen may finish ahead of the town's hours
const KEY = 'bd-site-v2-pieces';

/* the ground around the footprint */
const PIT_B = GY - 3, PIT_F = GY + 6, PIT_D = 5;     // the pit's back rim, front rim, how much far wall shows
const LOT0 = BUILDING.towerX + 2, LOT1 = X1 + 7, LOTQ = (LOT1 - LOT0) / 4;
const LINES = BAYS.map((b) => b.x).concat([X1]);      // the bay lines: posts and columns stand on these
const SEGS = 6, SEGW = (X1 - X0) / SEGS, QW = (X1 - X0) / 4;
const TOWER0 = BUILDING.towerX + 0.3, TOWER1 = BUILDING.towerX + 7.6;
const LADDER_X = BUILDING.towerX + 3;
const HOIST_X = X1 + 1.2;
const CANOPY_Y = GY - 15.2;
const LAMPS = [436, 490];
const FOOT = { L: 'west wing', M: 'middle', G: 'glass slot', C: 'corner' };
const SEG_NAME = ['the west end', 'the west wing', 'the middle', 'the middle block\'s east side', 'the glass slot', 'the corner'];
const Q_NAME = ['the west end', 'the west wing', 'the middle', 'the corner'];
const STAKES = [[X0 - 1.5, PIT_B - 1], [MIDX, PIT_B - 1], [X1 + 1.5, PIT_B - 1], [X0 - 1.5, PIT_F + 1.5], [MIDX, PIT_F + 1.5], [X1 + 1.5, PIT_F + 1.5]];
const STAKE_NAME = ['the back west corner', 'the middle of the back line', 'the back east corner', 'the front west corner', 'the middle of the front line', 'the front east corner'];
const STRINGS = [[[3, 4], [4, 5]], [[0, 1], [1, 2]], [[0, 3], [2, 5]]];
const STRING_NAME = ['along the front', 'along the back', 'across the ends'];
const SOLAR_X = [412.5, 418.5, 424.5, 430.5, 436.5, 470.5, 476.5, 482];
const TREE_X = [415, 438, 461, 497, 519];
const PLANTER_X = [427, 450, 473, 507];
/* drawing order inside the cached layer */
const RANK = { clear: 0, stake: 1, string: 2, dig: 3, rebar: 4, pour: 5, form: 6, strip: 7, backfill: 8,
  stud: 10, wire: 11, column: 12, post: 13, beam: 14, deck: 15, clad: 16, brick: 16, storefront: 16, glaze: 17, canopy: 18,
  solar: 19, tree: 30, planter: 30 };
const DUR = { clear: 14, stake: 10, string: 12, dig: 18, rebar: 16, form: 16, pour: 18, strip: 12, backfill: 16, column: 20,
  post: 16, beam: 16, deck: 18, stud: 18, wire: 16, clad: 18, brick: 24, storefront: 18, glaze: 16, canopy: 14, solar: 14, tree: 16, planter: 14 };
const LIFTED = { post: 1, beam: 1, deck: 1 };
/* the town's stages inside floors_done 0 */
const PHASE_OF = { clear: 'lot', stake: 'stakes', string: 'stakes', dig: 'dig', rebar: 'rebar', form: 'rebar', pour: 'pour', strip: 'cure', backfill: 'cure' };
const PHASE_LABEL = { lot: 'clearing the old parking lot', stakes: 'staking out the lot', dig: 'digging the foundation',
  rebar: 'tying rebar and setting forms', pour: 'pouring the foundation', cure: 'stripping the forms and backfilling' };

const fl = (f) => (f === 0 ? 'ground floor' : ORD[f + 1] + ' floor');
const segOf = (x) => clamp(Math.floor((x - X0) / SEGW), 0, SEGS - 1);

/* the window opening in bay b on floor f: [x, y, w, h] (null for the glass slot) */
function winRect(f, b) {
  const bay = BAYS[b], top = floorBottom(f + 1);
  if (bay.vol === 'G') return null;
  if (f === 0) {
    if (bay.vol === 'M') return [bay.x + 1, top + 5.4, bay.w - 2, GY - 0.6 - (top + 5.4)];
    if (bay.vol === 'C') return [bay.x + 1.5, top + 4.6, bay.w - 3, 11];
    return [bay.x + 2.5, top + 4.6, bay.w - 5, 9];
  }
  if (bay.vol === 'C') return [bay.x + 2, top + 3, bay.w - 4, 7.2];
  return [bay.x + 3, top + 3.2, bay.w - 6, 6.8];
}

/* a small seeded random for hand-placed details (cracks, pebbles) */
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

export function createBuilding(K) {
  let T = K.S.town;
  let ver = 1, vBase = 1, vWork = 1, t = 0;   // ver: the state; vBase / vWork: the two cached layers
  const local = new Set();     // ids completed on this phone, ahead of the town
  const claims = new Map();    // id -> Set(who)
  const partial = new Map();   // id -> amount 0..1 (kept when released: the half-done piece stays)
  let cut = false, yourMin = 0;
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && Array.isArray(v.ids)) v.ids.forEach((i) => local.add(i)); } catch (e) { /* storage blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ ids: [...local] })); } catch (e) { /* fine */ } };

  const floors = () => clamp(T.floors | 0 || BUILDING.floors, 2, 12);
  const topped = () => !!T.topped_out || (T.floors_done | 0) >= floors();
  const curKey = () => (topped() ? 'top' : clamp(T.floors_done | 0, 0, floors() - 1));

  /* ------------------------------------------------------------ the pieces */
  const lists = new Map();
  const byId = new Map();
  function listFor(key) {
    const F = floors(), mk = key + '/' + F;
    let L = lists.get(mk);
    if (!L) { L = buildList(key, F); lists.set(mk, L); for (const p of L) byId.set(p.id, p); }
    return L;
  }
  /* Upkeep: once the finish work is done the crew keeps the place nice. Open-ended, low priority:
     each job comes back after a cool-down; some only in their season (leaves in the fall, snow on a
     snow day, wreaths in December). Wreaths stay up (kept on this phone); the rest leave no trace. */
  let upList = null;
  const upDone = new Map();          // id -> t when last done (this visit)
  function upkeep() {
    if (upList) return upList;
    const L = [], gy = GY + 4;
    const add = (o) => L.push(Object.assign({ kind: 'upkeep', level: 'ground', needs: null, crew: 1, floor: 'top', cell: null, up: true, c0: 1, c1: 1, w: 0 }, o));
    for (let b = 0; b < NB; b++) {
      const r = winRect(0, b); if (!r) continue;
      const v = BAYS[b].vol;
      add({ id: 'top:wash' + b, part: 'wash', b, x: r[0] + r[2] / 2, y: gy, at: [r[0] + r[2] / 2, r[1] + r[3] / 2], pose: 'guide', carry: 'bucket', dur: 14, cool: 150,
        label: v === 'M' ? 'washing the storefront glass' : v === 'C' ? 'washing the shop windows on the corner' : 'washing the ground-floor windows' });
    }
    for (let i = 0; i < 4; i++) add({ id: 'top:sweep' + i, part: 'sweep', i, x: X0 + 12 + i * 29, y: GY + 7, at: [X0 + 12 + i * 29, GY + 7], pose: 'sweep', dur: 14, cool: 90, label: 'sweeping the sidewalk out front' });
    for (let i = 0; i < 4; i++) add({ id: 'top:waterp' + i, part: 'water', i, tx: PLANTER_X[i], ty: GY + 4, x: PLANTER_X[i] - 4, y: GY + 8, at: [PLANTER_X[i], GY + 5], pose: 'pour', carry: 'bucket', dur: 10, cool: 180,
      season: (m) => m >= 3 && m <= 9, label: 'watering the planters' });
    for (let i = 0; i < TREE_X.length; i++) add({ id: 'top:watert' + i, part: 'water', i, tx: TREE_X[i], ty: GY + 8.5, x: TREE_X[i] - 4, y: GY + 10, at: [TREE_X[i], GY + 8], pose: 'pour', carry: 'bucket', dur: 10, cool: 200,
      season: (m) => m >= 4 && m <= 8, label: 'watering the street trees' });
    for (let i = 0; i < TREE_X.length; i++) add({ id: 'top:rake' + i, part: 'rake', i, x: TREE_X[i] + 3, y: GY + 10, at: [TREE_X[i] + 1, GY + 10], pose: 'rake', dur: 14, cool: 100,
      season: (m) => m === 9 || m === 10, label: 'raking leaves under the street trees' });
    for (let i = 0; i < 4; i++) add({ id: 'top:snow' + i, part: 'snow', i, x: X0 + 14 + i * 28, y: GY + 7, at: [X0 + 14 + i * 28, GY + 7], pose: 'shovel', needs: 'shovel', dur: 14, cool: 70,
      when: () => !!(K.light && K.light.snowy), label: 'shoveling snow off the sidewalk' });
    const posts = [BAYS[3].x - 0.7, BAYS[6].x + BAYS[6].w + 0.7];
    posts.forEach((x, i) => add({ id: 'top:paint' + i, part: 'paint', i, px: x, x: x + (i ? 3 : -3), y: gy, at: [x, GY - 6], pose: 'trowel', carry: 'bucket', dur: 16, cool: 320,
      label: 'touching up the paint on the canopy posts' }));
    add({ id: 'top:paint2', part: 'paint', i: 2, px: BAYS[0].x + 1, x: BAYS[0].x + 4, y: gy, at: [BAYS[0].x + 1, GY - 6], pose: 'trowel', carry: 'bucket', dur: 16, cool: 320, label: 'touching up the trim by the west door' });
    for (let m = 0; m < 4; m++) { const b = BAYS[3 + m]; add({ id: 'top:wreath' + m, part: 'wreath', m, x: b.cx, y: gy, at: [b.cx, CANOPY_Y - 2.6], pose: 'raise', carry: 'plant', dur: 12, cool: Infinity,
      season: (mo) => mo === 11, label: 'hanging a wreath over the storefront' }); }
    for (const q of L) { q.rank = { wash: 25, paint: 25, wreath: 25 }[q.part] || 30; byId.set(q.id, q); }
    upList = L;
    return L;
  }
  function upOpen(p) {
    if (p.season && !p.season(K.now().getMonth())) return false;
    if (p.when && !p.when()) return false;
    if (p.part === 'wreath') return !local.has(p.id);
    const d = upDone.get(p.id);
    return d == null || t - d > p.cool * (0.7 + (hash(p.id) % 60) / 100);   // jittered so they don't all come due at once
  }
  function buildList(key, F) {
    const L = [];
    const pre = key === 'top' ? 'top:' : 'f' + key + ':';
    const id = (s) => pre + s;
    const add = (group, share, items) => {
      const w = share / items.length;
      for (const it of items) L.push(Object.assign({ group, w, crew: 1, level: 'ground', needs: null, after: null, cell: null, floor: key }, it));
    };
    const gy = GY + 4;
    const bayIdx = BAYS.map((b) => b.i);
    /* beams, CLT deck, studs, wire for floor f (the ground floor and the timber floors share these) */
    const floorFrame = (f, sBeam, sDeck, sStud, sWire) => {
      const lv = f === 0 ? 'ground' : f, y = f === 0 ? gy : floorBottom(f), top = floorBottom(f + 1), roof = f === F - 1;
      const postId = (i) => id((f === 0 ? 'column' : 'post') + i);
      add('beam', sBeam, bayIdx.map((b) => ({ id: id('beam' + b), kind: 'frame', part: 'beam', b, cell: b, x: BAYS[b].cx, y, level: lv, needs: 'beam', at: [BAYS[b].cx, top + 2.3],
        label: f === 0 ? 'setting a glulam beam over the ground floor' : 'setting a glulam beam, ' + fl(f), after: [postId(b), postId(b + 1)] })));
      add('deck', sDeck, bayIdx.map((b) => ({ id: id('deck' + b), kind: 'deck', part: 'deck', b, cell: b, x: BAYS[b].cx, y, level: lv, needs: 'panel', crew: 2, at: [BAYS[b].cx, top],
        label: roof ? 'landing a CLT roof panel' : 'landing a CLT floor panel over the ' + fl(f), after: [id('beam' + b)] })));
      add('stud', sStud, bayIdx.map((b) => ({ id: id('stud' + b), kind: 'frame', part: 'stud', b, cell: b, x: BAYS[b].cx, y, level: lv, needs: 'beam', at: [BAYS[b].cx, (top + floorBottom(f)) / 2],
        label: BAYS[b].vol === 'M' && f === 0 ? 'framing the storefront\'s back wall' : 'framing a stud wall, ' + fl(f), after: [id('deck' + b)] })));
      add('wire', sWire, bayIdx.map((b) => ({ id: id('wire' + b), kind: 'wire', part: 'wire', b, cell: b, x: BAYS[b].cx, y, level: lv, needs: 'spool', at: [BAYS[b].cx, top + 5],
        label: 'pulling wire through the ' + fl(f) + ' studs', after: [id('stud' + b)] })));
    };
    if (key === 'top') {
      const ry = floorBottom(F);
      add('solar', 0.45, SOLAR_X.map((x, i) => ({ id: id('solar' + i), kind: 'solar', part: 'solar', i, x: x + 2.5, y: ry, level: F, needs: 'panel', at: [x + 2.5, ry - 3], label: 'laying a solar panel on the roof' })));
      add('tree', 0.35, TREE_X.map((x, i) => ({ id: id('tree' + i), kind: 'plant', part: 'tree', i, x: x + 3, y: GY + 10, needs: 'shovel', at: [x, GY + 4], label: 'planting a street tree out front' })));
      add('planter', 0.2, PLANTER_X.map((x, i) => ({ id: id('planter' + i), kind: 'plant', part: 'planter', i, x: x + 4, y: GY + 9, needs: 'shovel', at: [x, GY + 6], label: 'planting a planter by the door' })));
    } else if (key === 0) {
      const clearLabel = ['breaking up the old asphalt at the west end', 'pulling up the old wheel stops', 'breaking up the old asphalt in the middle', 'hauling off old asphalt by the corner'];
      add('clear', 0.04, [0, 1, 2, 3].map((q) => ({ id: id('clear' + q), kind: 'dig', part: 'clear', q, x: LOT0 + (q + 0.5) * LOTQ, y: q % 2 ? 446 : 452, needs: 'shovel', at: [LOT0 + (q + 0.5) * LOTQ, 449], label: clearLabel[q] })));
      const allClear = [0, 1, 2, 3].map((q) => id('clear' + q));
      add('stake', 0.045, STAKES.map(([x, y], s) => ({ id: id('stake' + s), kind: 'stake', part: 'stake', s, x: x + (s % 3 === 2 ? 2.5 : -2.5), y: y + 1, needs: 'stakes', at: [x, y - 3], label: 'driving a survey stake at ' + STAKE_NAME[s], after: allClear })));
      add('string', 0.025, STRINGS.map((segs, i) => ({ id: id('string' + i), kind: 'stake', part: 'string', i, x: i === 2 ? X0 - 4 : MIDX - 20 + i * 8, y: i === 1 ? PIT_B : PIT_F + 3, at: [MIDX, i === 1 ? PIT_B - 3 : PIT_F - 1],
        label: 'running a string line ' + STRING_NAME[i], after: [...new Set(segs.flat())].map((s) => id('stake' + s)) })));
      const strings = [0, 1, 2].map((i) => id('string' + i));
      add('dig', 0.12, bayIdx.map((b) => ({ id: id('dig' + b), kind: 'dig', part: 'dig', b, cell: b, x: BAYS[b].cx, y: GY + 1, needs: 'shovel', at: [BAYS[b].cx, GY], label: 'digging out the ' + FOOT[BAYS[b].vol] + ' footing', after: strings })));
      add('rebar', 0.08, bayIdx.map((b) => ({ id: id('rebar' + b), kind: 'rebar', part: 'rebar', b, cell: b, x: BAYS[b].cx, y: GY + 2, needs: 'rebar', at: [BAYS[b].cx, GY + 2], label: 'tying rebar for the ' + FOOT[BAYS[b].vol] + ' footing', after: [id('dig' + b)] })));
      const segBays = (s) => bayIdx.filter((b) => BAYS[b].x < X0 + (s + 1) * SEGW && BAYS[b].x + BAYS[b].w > X0 + s * SEGW);
      add('form', 0.05, [0, 1, 2, 3, 4, 5].map((s) => ({ id: id('form' + s), kind: 'form', part: 'form', s, x: X0 + (s + 0.5) * SEGW, y: PIT_F + 3.5, needs: 'formwork', at: [X0 + (s + 0.5) * SEGW, PIT_F],
        label: 'setting footing forms at ' + SEG_NAME[s], after: segBays(s).map((b) => id('rebar' + b)) })));
      add('pour', 0.08, bayIdx.map((b) => {
        const ss = [0, 1, 2, 3, 4, 5].filter((s) => segBays(s).includes(b));
        return { id: id('pour' + b), kind: 'pour', part: 'pour', b, cell: b, x: BAYS[b].cx, y: PIT_F + 3, at: [BAYS[b].cx, GY], label: 'pouring the ' + FOOT[BAYS[b].vol] + ' footing',
          after: [id('rebar' + b), ...ss.map((s) => id('form' + s))] };
      }));
      add('strip', 0.035, [0, 1, 2, 3, 4, 5].map((s) => ({ id: id('strip' + s), kind: 'form', part: 'strip', s, x: X0 + (s + 0.5) * SEGW, y: PIT_F + 3.5, at: [X0 + (s + 0.5) * SEGW, PIT_F + 1],
        label: 'stripping the forms at ' + SEG_NAME[s], after: segBays(s).map((b) => id('pour' + b)) })));
      add('backfill', 0.025, [0, 1, 2, 3].map((q) => ({ id: id('backfill' + q), kind: 'dig', part: 'backfill', q, x: X0 + (q + 0.5) * QW, y: PIT_F + 5, needs: 'shovel', at: [X0 + (q + 0.5) * QW, PIT_F + 3],
        label: 'backfilling along the front at ' + Q_NAME[q], after: [0, 1, 2, 3, 4, 5].filter((s) => X0 + s * SEGW < X0 + (q + 1) * QW && X0 + (s + 1) * SEGW > X0 + q * QW).map((s) => id('strip' + s)) })));
      add('column', 0.08, LINES.map((x, i) => ({ id: id('column' + i), kind: 'pour', part: 'column', i, x: x + (i === LINES.length - 1 ? -3 : 3), y: gy, needs: 'formwork', at: [x, GY - 8],
        label: 'pouring a concrete column, ground floor', after: [id('strip' + segOf(clamp(x, X0, X1 - 0.1)))] })));
      floorFrame(0, 0.045, 0.055, 0.05, 0.05);
      /* walls: rust on the wing, brick on the corner, storefront frames in the middle */
      const walls = [];
      for (const b of bayIdx) {
        const v = BAYS[b].vol;
        if (v === 'M') walls.push({ id: id('wall' + b + '.0'), kind: 'clad', part: 'storefront', b, k: 0, cell: b, x: BAYS[b].cx, y: gy, needs: 'panel', label: 'framing the storefront', after: [id('wire' + b)] });
        else if (v !== 'G') for (let k = 0; k < 3; k++) walls.push({ id: id('wall' + b + '.' + k), kind: v === 'C' ? 'brick' : 'clad', part: v === 'C' ? 'brick' : 'clad', b, k, cell: b, x: BAYS[b].cx + (k - 1) * 2, y: gy,
          needs: v === 'C' ? 'bricks' : 'panel', label: v === 'C' ? 'laying brick on the corner, ground floor' : 'hanging rust panels, ground floor', after: [k ? id('wall' + b + '.' + (k - 1)) : id('wire' + b)] });
      }
      add('wall', 0.11, walls);
      add('glaze', 0.07, bayIdx.map((b) => {
        const v = BAYS[b].vol;
        const last = v === 'G' ? id('wire' + b) : v === 'M' ? id('wall' + b + '.0') : id('wall' + b + '.2');
        return { id: id('glaze' + b), kind: 'glaze', part: 'glaze', b, cell: b, x: BAYS[b].cx, y: gy, needs: 'pane', crew: 2,
          label: v === 'M' ? 'setting storefront glass' : v === 'C' ? 'setting a shop window on the corner' : v === 'G' ? 'glazing the glass slot, ground floor' : 'setting a window, ground floor', after: [last] };
      }));
      add('canopy', 0.04, bayIdx.filter((b) => BAYS[b].vol === 'M').map((b, m) => ({ id: id('canopy' + m), kind: 'frame', part: 'canopy', m, b, cell: b, x: BAYS[b].cx, y: gy, needs: 'beam', at: [BAYS[b].cx, CANOPY_Y],
        label: 'hanging the timber canopy over the storefront', after: [id('glaze' + b)] })));
    } else {
      const f = key, lv = f, y = floorBottom(f), top = f === F - 1;
      add('post', 0.1, LINES.map((x, i) => ({ id: id('post' + i), kind: 'frame', part: 'post', i, x: x + (i === LINES.length - 1 ? -2.5 : 2.5), y, level: lv, needs: 'beam', at: [x, y - 6],
        label: 'setting a glulam post, ' + fl(f) })));
      floorFrame(f, 0.09, 0.12, 0.12, 0.1);
      const walls = [];
      for (const b of bayIdx) {
        const v = BAYS[b].vol;
        if (v === 'G') continue;
        for (let k = 0; k < 3; k++) walls.push({ id: id('wall' + b + '.' + k), kind: v === 'C' ? 'brick' : 'clad', part: v === 'C' ? 'brick' : 'clad', b, k, cell: b, x: BAYS[b].cx + (k - 1) * 2, y, level: lv,
          needs: v === 'C' ? 'bricks' : 'panel', label: v === 'C' ? 'laying brick on the corner, ' + fl(f) : top ? 'hanging charcoal panels on the top floor' : 'hanging rust panels, ' + fl(f),
          after: [k ? id('wall' + b + '.' + (k - 1)) : id('wire' + b)] });
      }
      add('wall', 0.35, walls);
      add('glaze', 0.12, bayIdx.map((b) => ({ id: id('glaze' + b), kind: 'glaze', part: 'glaze', b, cell: b, x: BAYS[b].cx, y, level: lv, needs: 'pane', crew: 2,
        label: BAYS[b].vol === 'G' ? 'glazing the glass slot, ' + fl(f) : 'setting a window, ' + fl(f), after: [BAYS[b].vol === 'G' ? id('wire' + b) : id('wall' + b + '.2')] })));
    }
    let c = 0;
    const tot = L.reduce((s, p) => s + p.w, 0);
    for (const p of L) {
      p.w /= tot; p.c0 = c; c += p.w; p.c1 = c; p.rank = RANK[p.part]; p.dur = DUR[p.part] || 14;
      if (!p.at) p.at = [p.x, p.level === 'ground' ? p.y : p.y - 6];
      if (p.after && !p.after.length) p.after = null;
    }
    L[L.length - 1].c1 = 1;
    const spans = {};
    for (const p of L) { const s = spans[p.group] || (spans[p.group] = [p.c0, p.c1]); s[0] = Math.min(s[0], p.c0); s[1] = Math.max(s[1], p.c1); }
    L.spans = spans;
    L.drawOrder = L.slice().sort((a, b) => a.rank - b.rank);
    return L;
  }

  /* --------------------------------------------------------- the state */
  let S = null, Sver = -1;
  function st() {
    if (S && Sver === ver) return S;
    const key = curKey(), F = floors(), list = listFor(key);
    const P = key === 'top' ? 0 : clamp(T.floor_progress || 0, 0, 1);
    const done = new Set();
    for (const p of list) if (p.c1 <= P + 1e-9 || local.has(p.id)) done.add(p.id);
    const fin = key === 'top' ? F : key;                       // floors fully built
    const solarLeft = key === 'top' && list.some((p) => p.part === 'solar' && !done.has(p.id));
    const work = key === 'top' ? (solarLeft ? F : null) : key; // the level the work is on
    S = { key, F, list, done, P, fin, work, scaffold: work != null && work >= 1 };
    Sver = ver;
    return S;
  }
  let tpMemo = null, tpKey = '';
  function townPartial() {
    const s = st(), k = Sver + ':' + s.P;
    if (k === tpKey) return tpMemo;
    tpKey = k; tpMemo = null;
    if (s.key === 'top') return null;
    for (const p of s.list) if (p.c0 < s.P - 1e-9 && p.c1 > s.P + 1e-9) { if (!s.done.has(p.id)) tpMemo = { p, a: (s.P - p.c0) / p.w }; break; }
    return tpMemo;
  }
  function stage() {
    const s = st();
    if (s.key === 'top') return { phase: 'finish', floor: s.F, progress: 1, label: 'topped out', part: 'finish' };
    const L = s.list, P = s.P;
    let cur = L[L.length - 1];
    for (const p of L) if (p.c1 > P + 1e-9) { cur = p; break; }
    const g = cur.group;
    if (s.key === 0 && PHASE_OF[g]) {
      const ph = PHASE_OF[g];
      let a = 1, b = 0;
      for (const k in L.spans) if (PHASE_OF[k] === ph) { a = Math.min(a, L.spans[k][0]); b = Math.max(b, L.spans[k][1]); }
      return { phase: ph, floor: 0, progress: clamp((P - a) / (b - a), 0, 1), label: PHASE_LABEL[ph], part: g };
    }
    const a = s.key === 0 ? L.spans.column[0] : 0;
    const nth = 'the ' + fl(s.key);
    const lab = { column: 'pouring the columns on ' + nth, post: 'framing ' + nth, beam: 'framing ' + nth, deck: 'decking over ' + nth, stud: 'studs and wiring on ' + nth,
      wire: 'studs and wiring on ' + nth, wall: 'cladding ' + nth, glaze: 'setting windows on ' + nth, canopy: 'the storefront canopy' }[g] || nth;
    return { phase: 'frame', floor: s.key, progress: clamp((P - a) / (1 - a), 0, 1), label: lab, part: g };
  }
  function ahead() {
    const s = st(); let n = 0;
    for (const id of local) { const p = byId.get(id); if (p && p.floor === s.key && p.c1 > s.P + 1e-9) n++; }
    return n;
  }
  function view(p, pace) {
    const j = { id: p.id, kind: p.kind, part: p.part, x: p.x, y: p.y, level: p.level, needs: p.needs, crew: p.crew, dur: Math.round(p.dur * pace),
      label: p.label, cell: p.cell, at: p.at, lift: !!LIFTED[p.part] };
    if (p.pose) j.pose = p.pose;       // upkeep: a hint for the crew's generic chain
    if (p.carry) j.carry = p.carry;
    if (p.crew > 1) j.spots = [[p.x - 3, p.y], [p.x + 3, p.y]];
    return j;
  }
  function jobs() {
    const s = st(), n = ahead();
    if (s.key !== 'top' && n >= LOCAL_CAP) return [];
    const pace = s.key === 'top' ? 1 : 1 + 2.5 * Math.pow(n / LOCAL_CAP, 1.5);
    const out = [];
    for (const p of s.list) {
      if (s.done.has(p.id)) continue;
      if (p.after && !p.after.every((a) => s.done.has(a))) continue;
      const c = claims.get(p.id);
      if (c && c.size >= p.crew) continue;
      out.push(view(p, pace));
    }
    if (s.key === 'top' && s.list.every((p) => s.done.has(p.id))) {
      for (const p of upkeep()) { const c = claims.get(p.id); if (upOpen(p) && !(c && c.size >= p.crew)) out.push(view(p, 1)); }
    }
    return out;
  }
  /* the jobs your builder can line up (SITE_JOBS keys), in the order the
     building needs them: every trade with a piece still to do on this stage,
     then haul (always). Topped out and finished: keeping the place nice. */
  function needs() {
    const s = st(), out = [], seen = new Set();
    const floor = s.key === 'top' ? 'roof' : fl(s.key);
    const add = (k) => { if (k && !seen.has(k)) { seen.add(k); out.push({ key: k, label: jobLabel(k, floor) }); } };
    for (const p of s.list) if (!s.done.has(p.id)) add(JOB_OF_PART[p.part]);
    if (s.key === 'top' && !out.length) add('upkeep');
    add('haul');
    return out;
  }
  function claim(id, who) {
    const s = st(), p = byId.get(id);
    if (!p || p.floor !== s.key || s.done.has(id) || (p.up && !upOpen(p))) return false;
    let c = claims.get(id);
    if (!c) { c = new Set(); claims.set(id, c); }
    if (c.has(who)) return true;
    if (c.size >= p.crew || (s.key !== 'top' && !c.size && ahead() >= LOCAL_CAP)) { if (!c.size) claims.delete(id); return false; }
    c.add(who);
    return true;
  }
  function release(id, who) {
    const c = claims.get(id);
    if (!c) return;
    if (who != null) c.delete(who); else c.clear();
    if (!c.size) claims.delete(id);
  }
  function work(id, a) {
    const p = byId.get(id);
    if (!p || p.floor !== st().key) return;
    partial.set(id, Math.max(partial.get(id) || 0, clamp(+a || 0, 0, 1)));
  }
  function complete(id) {
    const s = st(), p = byId.get(id);
    if (!p || p.floor !== s.key || s.done.has(id)) return false;
    if (p.up) {
      if (!upOpen(p)) return false;
      upDone.set(id, t); claims.delete(id); partial.delete(id);
      if (p.part === 'wreath') { local.add(id); save(); vBase++; }
      if (p.part === 'snow') vWork++;
      K.emit('piece', { id, part: p.part, x: p.at[0], y: p.at[1] });
      return true;
    }
    local.add(id); claims.delete(id); partial.delete(id); ver++; vWork++; save();
    if (s.key === 'top') vBase++;          // the roof crew's scaffold comes down when the last panel is in
    K.emit('piece', { id, part: p.part, x: p.at[0], y: p.at[1] });
    return true;
  }

  let prev = null, sigB = '', sigW = '';
  /* topping out: the last beam shows when the crew's crane sets it ('crew:topbeam'), or 25 s after
     the milestone if nobody does; at once under reduced motion or when the town loads topped */
  let beamUp = false, toppedAt = null;
  K.on('crew:topbeam', () => { if (!beamUp && topped()) { beamUp = true; vBase++; } });
  function setTown(tt) {
    T = tt;
    const now = { f: T.floors_done | 0, p: T.floor_progress || 0, topped: topped() };
    if (prev) {
      const pourEnd = listFor(0).spans.pour[1];
      const poured = (x) => x.topped || x.f > 0 || x.p >= pourEnd - 1e-9;
      if (!poured(prev) && poured(now)) K.emit('milestone', { kind: 'pour', floor: 0, x: MIDX, y: GY });
      if (now.f > prev.f && !now.topped) K.emit('milestone', { kind: 'floor', floor: now.f, x: MIDX, y: floorBottom(now.f) });
      if (!prev.topped && now.topped) K.emit('milestone', { kind: 'topped', floor: floors(), x: MIDX, y: floorBottom(floors()) });
    }
    if (!now.topped) { beamUp = false; toppedAt = null; }
    else if (!beamUp && toppedAt == null) {
      if (!prev || !prev.topped) { if (!prev || K.reduced || t < 3) beamUp = true; else toppedAt = t; }
    }
    prev = now;
    /* forget pieces from floors already passed (never from later ones: a town that reads 0 for a
       moment must not wipe this phone's work) */
    const key = curKey(), kf = key === 'top' ? 99 : key;
    let dropped = false;
    for (const i of [...local]) {
      const m = /^f(\d+):/.exec(i);
      if (m && +m[1] < kf) { local.delete(i); dropped = true; }
    }
    if (dropped) save();
    listFor(key);
    for (const i of [...partial.keys()]) { const p = byId.get(i); if (!p || p.floor !== key) partial.delete(i); }
    for (const i of [...claims.keys()]) { const p = byId.get(i); if (!p || p.floor !== key) claims.delete(i); }
    /* re-render only when what's drawn changes (the piece in progress is drawn live) */
    const L = listFor(key), P = key === 'top' ? 0 : clamp(T.floor_progress || 0, 0, 1);
    let n = 0; for (const p of L) if (p.c1 <= P + 1e-9) n++;
    const nb = key + ':' + (T.windows_lit | 0) + ':' + floors(), nw = key + ':' + n + ':' + floors();
    if (nb !== sigB) { sigB = nb; ver++; vBase++; vWork++; }
    if (nw !== sigW) { sigW = nw; ver++; vWork++; }
  }

  /* --------------------------------------------------------- colours */
  let C = null, Cpal = null;
  function cols() {
    const p = K.pal;
    if (C && Cpal === p) return C;
    Cpal = p;
    const am = (K.light && K.light.ambient) || [1, 1, 1];
    const sh = (h) => { const c = hexRgb(h); return rgbHex([c[0] * am[0], c[1] * am[1], c[2] * am[2]]); };
    const E = (n) => p[n] || EMIT[n];
    const wet = mix(p.concreteShade, p.glassDark, 0.32);
    C = {
      night: (K.light && K.light.night) || 0, snowy: !!(K.light && K.light.snowy), wet: !!(K.light && K.light.wet),
      ink: p.ink, white: p.white,
      rust: p.rust, rustRib: mix(p.rust, p.white, 0.14), rustGroove: mix(p.rust, p.rustGroove, 0.55), rustEdge: p.rustGroove, rustL: p.rustBack, rustLRib: mix(p.rustBack, p.white, 0.17),
      brick: p.brick, brickAlt: mix(p.brick, p.brickDark, 0.35), brickLit: mix(p.brick, p.white, 0.1), brickDark: p.brickDark, mortar: p.mortar,
      char: p.charcoal, charLine: mix(p.charcoal, p.white, 0.13), charDark: mix(p.charcoal, p.ink, 0.45),
      timber: p.timber, timberLit: mix(p.timber, p.white, 0.3), timberShade: p.timberShade, timberDark: p.timberDark, clt: mix(p.timber, p.white, 0.16), stud: mix(p.timber, p.white, 0.22),
      concrete: p.concrete, concreteLit: mix(p.concrete, p.white, 0.2), concreteShade: p.concreteShade, slab: mix(p.concrete, p.dirt, 0.6), slabFace: mix(p.concreteShade, p.dirtDark, 0.45),
      wetC: wet, wetHi: mix(wet, p.white, 0.4),
      form: p.formwork, formDark: mix(p.formwork, p.timberDark, 0.5), rebar: p.rebar,
      dirt: p.dirt, dirtLit: mix(p.dirt, p.white, 0.12), pitWall: mix(p.dirtDark, p.mud, 0.35), pitFloor: mix(p.mud, p.ink, 0.25), pitShade: mix(p.mud, p.ink, 0.45), dirtDark: p.dirtDark, mud: p.mud, gravel: p.gravel, gravelDark: mix(p.gravel, p.ink, 0.3), fill: mix(p.gravel, p.dirt, 0.4),
      asph: mix(p.asphalt, p.gravel, 0.5), asphDark: mix(p.asphalt, p.ink, 0.15), asphLit: mix(p.asphalt, p.gravel, 0.75), stripe: mix(p.white, p.asphalt, 0.35),
      grass: p.grass, grassDark: p.grassDark,
      glass: p.glass, glassHi: p.glassHi, glassDark: p.glassDark, glassNight: mix(p.glassDark, p.ink, 0.25), frame: mix(p.brickDark, p.charcoal, 0.5), eyebrow: mix(p.brickDark, p.rustGroove, 0.35),
      interior: p.interior, interiorDeep: mix(p.interior, p.ink, 0.45), interiorSoft: mix(p.interior, p.glass, 0.28),
      copper: p.copper, pipe: p.pipe, pipeRed: sh('#c0503a'), box: mix(p.steel, p.white, 0.2),
      coping: p.coping, steel: p.steel, steelDark: mix(p.steel, p.ink, 0.4),
      scaffold: p.scaffold, scaffoldDark: mix(p.scaffold, p.ink, 0.38), plank: p.plank, net: p.netting, rail: mix(p.crane, p.scaffold, 0.35),
      solar: p.solar, solarHi: mix(p.solar, p.white, 0.35), solarLine: mix(p.solar, p.white, 0.15),
      evergreen: p.evergreen, evergreenLit: mix(p.evergreen, p.white, 0.2), flag: p.flag,
      tape: sh('#ff4f9a'), mason: sh('#f4e04a'),
      plant: sh('#4f8a3f'), plantDark: sh('#36602f'), pot: sh('#b0603e'), curtain: sh('#efe2c8'), curtain2: sh('#c9d8e2'), flower1: sh('#e2566a'), flower2: sh('#f2c94c'),
      tree: p.tree, treeDark: p.treeDark, treeLight: p.treeLight, trunk: p.trunk, autumnA: p.autumnA, autumnB: p.autumnB,
      snow: p.snow, snowShade: p.snowShade, ice: p.ice,
      sky: (K.light && /^#[0-9a-f]{6}$/i.test(K.light.skyHor || '')) ? K.light.skyHor : p.glassHi,
      winLit: E('winLit'), winLitDeep: E('winLitDeep'), lamp: E('lamp'), lampGlow: E('lampGlow'),
    };
    C.sil = mix(C.winLitDeep, '#2b1d1a', 0.74);
    C.silSoft = mix(C.winLitDeep, '#2b1d1a', 0.4);
    return C;
  }

  /* --------------------------------------------------------- drawing helpers */
  function rr(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
  function outline(g, w) { g.lineWidth = w || 0.4; g.strokeStyle = C.ink; g.lineJoin = 'round'; g.stroke(); }
  function box(g, x, y, w, h, fill, inkW) { g.fillStyle = fill; g.fillRect(x, y, w, h); if (inkW) { g.lineWidth = inkW; g.strokeStyle = C.ink; g.strokeRect(x, y, w, h); } }
  function snowCap(g, x, y, w) {
    if (!C.snowy) return;
    rr(g, x - 0.2, y - 0.9, w + 0.4, 1.1, 0.5); g.fillStyle = C.snow; g.fill();
    g.fillStyle = C.snowShade; g.fillRect(x, y, w, 0.25);
  }
  function line(g, x0, y0, x1, y1, col, w) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineWidth = w; g.strokeStyle = col; g.stroke(); }

  /* --------------------------------------------------------- the lot and the foundation */
  const LOT_Y0 = PIT_B - 2, LOT_Y1 = PIT_F + 3.4;
  function lotClip(g) { rr(g, LOT0, LOT_Y0, LOT1 - LOT0, LOT_Y1 - LOT_Y0, 2.4); }
  function drawLot(g, cleared) {
    const y0 = LOT_Y0, y1 = LOT_Y1;
    lotClip(g); g.fillStyle = C.snowy ? C.snow : C.asph; g.fill();
    g.save(); lotClip(g); g.clip();
    for (let q = 0; q < 4; q++) {
      const qx = LOT0 + q * LOTQ;
      if (cleared(q)) { bare(g, qx, qx + LOTQ, y0, y1, q); continue; }
      const R = seeded(hash('lot' + q));
      g.fillStyle = C.snowy ? C.snowShade : C.asphLit; g.globalAlpha = 0.4;
      for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(qx + R() * LOTQ, y0 + 2 + R() * (y1 - y0 - 4), 2 + R() * 4, 0.8 + R() * 1.2, 0, 0, 7); g.fill(); }
      g.globalAlpha = 1;
      /* angled stalls, faded stripes, wheel stops */
      for (let x = LOT0 + 3; x < LOT1; x += 10.5) {
        if (x < qx || x >= qx + LOTQ) continue;
        g.beginPath(); g.moveTo(x, y0 + 1.6); g.lineTo(x + 0.55, y0 + 1.6); g.lineTo(x + 2.2, y1 - 1.2); g.lineTo(x + 1.65, y1 - 1.2); g.closePath();
        g.fillStyle = C.snowy ? C.asphLit : C.stripe; g.globalAlpha = C.snowy ? 0.35 : 0.8; g.fill(); g.globalAlpha = 1;
        if (x + 6 < LOT1 - 2) { rr(g, x + 3, y0 + 1.4, 3.2, 0.95, 0.3); g.fillStyle = C.concrete; g.fill(); g.fillStyle = C.concreteShade; g.fillRect(x + 3, y0 + 2.05, 3.2, 0.3); }
      }
      /* cracks with grass coming up through them */
      for (let k = 0; k < 2; k++) {
        let x = qx + 2 + R() * (LOTQ - 4), y = y0 + 2 + R() * (y1 - y0 - 4);
        g.beginPath(); g.moveTo(x, y);
        const pts = [];
        for (let i = 0; i < 5; i++) { x += (R() - 0.3) * 4; y += (R() - 0.5) * 2; g.lineTo(x, y); pts.push([x, y]); }
        g.lineWidth = 0.28; g.strokeStyle = C.asphDark; g.stroke();
        if (!C.snowy) for (const [px, py] of pts) if (R() < 0.55) tuft(g, px, py, 0.8 + R() * 0.6);
      }
      if (!C.snowy) for (let i = 0; i < 3; i++) tuft(g, qx + R() * LOTQ, y0 + 0.9 + R() * 0.8, 1 + R() * 0.6);
      if (q === 2) {   /* the puddle */
        g.beginPath(); g.ellipse(qx + 12, y1 - 5.6, 5.4, 1.5, 0, 0, 7); g.fillStyle = C.snowy ? C.ice : mix(C.sky, C.asph, 0.25); g.fill();
        g.beginPath(); g.ellipse(qx + 10.6, y1 - 6, 2.2, 0.45, 0, 0, 7); g.fillStyle = C.snowy ? C.white : mix(C.sky, C.white, 0.35); g.fill();
      }
      if (q === 0 && C.wet) { g.beginPath(); g.ellipse(qx + 20, y0 + 4.5, 3, 0.8, 0, 0, 7); g.fillStyle = mix(C.sky, C.asph, 0.3); g.fill(); }
    }
    g.restore();
    /* soft edges: a lip of broken asphalt along the front, grass creeping in at the ends */
    g.fillStyle = C.snowy ? C.snowShade : C.asphDark; g.globalAlpha = 0.5; g.fillRect(LOT0 + 2, y1 - 0.5, LOT1 - LOT0 - 4, 0.5); g.globalAlpha = 1;
    if (!C.snowy) for (const [x, y] of [[LOT0 + 0.5, y0 + 3], [LOT0 + 1.2, y1 - 2], [LOT1 - 1, y0 + 4], [LOT1 - 0.6, y1 - 3], [LOT0 + 40, y0 + 0.6], [LOT1 - 30, y0 + 0.5]]) { g.beginPath(); g.ellipse(x, y, 2.2, 1.1, 0, 0, 7); g.fillStyle = C.grass; g.fill(); tuft(g, x, y + 0.6, 1.1); }
  }
  function tuft(g, x, y, s) {
    g.beginPath();
    g.moveTo(x - 0.7 * s, y); g.quadraticCurveTo(x - 0.5 * s, y - 0.9 * s, x - 0.9 * s, y - 1.5 * s);
    g.quadraticCurveTo(x - 0.1 * s, y - 0.8 * s, x, y - 1.9 * s);
    g.quadraticCurveTo(x + 0.2 * s, y - 0.8 * s, x + 0.9 * s, y - 1.4 * s);
    g.quadraticCurveTo(x + 0.4 * s, y - 0.6 * s, x + 0.7 * s, y);
    g.closePath(); g.fillStyle = C.grass; g.fill();
    g.fillStyle = C.grassDark; g.fillRect(x - 0.6 * s, y - 0.3, 1.2 * s, 0.3);
  }
  function bare(g, x0, x1, y0, y1, q) {
    g.fillStyle = C.snowy ? C.snow : C.dirt; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    if (C.snowy) return;
    const R = seeded(hash('bare' + q));
    g.lineWidth = 0.35; g.strokeStyle = C.dirtDark;
    for (const yy of [y0 + 4.5, y0 + 6.2, y1 - 3.2, y1 - 1.6]) { g.beginPath(); g.moveTo(x0, yy); g.bezierCurveTo(x0 + 8, yy - 0.6, x1 - 8, yy + 0.6, x1, yy - 0.2); g.stroke(); }
    g.fillStyle = C.dirtDark;
    for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(x0 + R() * (x1 - x0), y0 + 1 + R() * (y1 - y0 - 2), 0.5 + R() * 0.4, 0.3, 0, 0, 7); g.fill(); }
  }
  function drawClear(g, q, a) {   /* breaking up the asphalt: bare ground spreads, chunks pile at the edge */
    const x0 = LOT0 + q * LOTQ, xe = x0 + LOTQ * a;
    g.save(); lotClip(g); g.clip();
    bare(g, x0, xe, LOT_Y0, LOT_Y1, q);
    g.restore();
    const R = seeded(hash('chunk' + q));
    for (let i = 0; i < 6; i++) {
      const cx = xe - 1 + R() * 2.5, cy = LOT_Y0 + 1.5 + R() * (LOT_Y1 - LOT_Y0 - 3);
      g.beginPath(); g.moveTo(cx - 1.1, cy + 0.5); g.lineTo(cx - 0.6, cy - 0.6); g.lineTo(cx + 0.9, cy - 0.4); g.lineTo(cx + 1.2, cy + 0.5); g.closePath();
      g.fillStyle = i % 2 ? C.asph : C.asphLit; g.fill(); outline(g, 0.2);
    }
  }
  function drawStake(g, s, a) {
    const [x, y] = STAKES[s], h = 4.2 + 2.6 * (1 - ease(a));
    rr(g, x - 0.38, y - h, 0.76, h, 0.15); g.fillStyle = C.timber; g.fill(); outline(g, 0.22);
    g.fillStyle = C.timberLit; g.fillRect(x - 0.38, y - h, 0.25, h);
    if (a >= 0.75) {   /* pink flagging tape, tied on */
      const ty = y - h + 0.5, wv = Math.sin(s * 1.7) * 0.4;
      g.beginPath(); g.moveTo(x + 0.3, ty); g.quadraticCurveTo(x + 1.4, ty - 0.4 + wv, x + 2.6, ty + 0.2 + wv); g.lineTo(x + 2.4, ty + 0.9 + wv); g.quadraticCurveTo(x + 1.3, ty + 0.5 + wv, x + 0.3, ty + 0.7); g.closePath();
      g.fillStyle = C.tape; g.fill();
    }
  }
  function drawString(g, i, a) {
    const segs = STRINGS[i];
    let total = 0;
    for (const [p, q] of segs) total += Math.hypot(STAKES[q][0] - STAKES[p][0], STAKES[q][1] - STAKES[p][1]);
    let left = total * a;
    g.beginPath();
    for (const [p, q] of segs) {
      if (left <= 0) break;
      const [ax, ay] = STAKES[p], [bx, by] = STAKES[q], len = Math.hypot(bx - ax, by - ay), k = Math.min(1, left / len);
      g.moveTo(ax, ay - 3.2); g.lineTo(ax + (bx - ax) * k, ay - 3.2 + (by - ay) * k);
      left -= len;
    }
    g.lineWidth = 0.24; g.strokeStyle = C.mason; g.stroke();
  }
  function bayX(b) { const bay = BAYS[b]; let x = bay.x, w = bay.w; if (b === 0) { x += 0.6; w -= 0.6; } if (b === NB - 1) w -= 0.6; return [x, w]; }
  function drawPit(g, b, d) {
    const [x, w] = bayX(b), wh = PIT_D * d;
    g.fillStyle = mix(C.dirtDark, C.pitFloor, d); g.fillRect(x, PIT_B, w, PIT_F - PIT_B);   // the floor
    g.fillStyle = C.pitShade; g.fillRect(x, PIT_F - 1.1 * d, w, 1.1 * d);                    // shadow under the near edge
    g.fillStyle = C.pitWall; g.fillRect(x, PIT_B, w, wh);                                    // the far wall, facing us
    g.fillStyle = C.dirtDark; g.fillRect(x, PIT_B + wh * 0.4, w, 0.3); g.fillRect(x, PIT_B + wh * 0.72, w, 0.25);
    g.fillStyle = C.dirtLit; g.fillRect(x, PIT_B - 0.2, w, 0.5); g.fillRect(x, PIT_F - 0.3, w, 0.5);   // lit rims
    if (C.snowy) { g.fillStyle = C.snow; g.fillRect(x, PIT_F - 0.4, w, 0.4); g.fillRect(x, PIT_B + wh, w, 0.5); }
  }
  function drawBerm(g, vol) {
    if (vol <= 0.01) return;
    const H = 7.5 * vol, x0 = X0 + 3, x1 = X1 - 3;
    g.beginPath(); g.moveTo(x0 - 2, PIT_B + 0.2);
    for (let x = x0; x <= x1; x += 2) {
      const taper = Math.min(1, (x - x0) / 12, (x1 - x) / 12);
      g.lineTo(x, PIT_B - H * taper * (0.78 + 0.22 * Math.sin(x * 0.37) * Math.sin(x * 0.11 + 1)));
    }
    g.lineTo(x1 + 2, PIT_B + 0.2); g.closePath();
    g.fillStyle = C.snowy ? C.snow : C.dirt; g.fill(); outline(g, 0.3);
    g.save(); g.clip();
    g.fillStyle = C.snowy ? C.snowShade : C.dirtDark; g.globalAlpha = 0.5;
    g.fillRect(x0, PIT_B - 1.4, x1 - x0, 1.6); g.globalAlpha = 1;
    const R = seeded(hash('berm'));
    for (let i = 0; i < 26; i++) { g.beginPath(); g.ellipse(x0 + R() * (x1 - x0), PIT_B - R() * H, 0.35 + R() * 0.3, 0.25, 0, 0, 7); g.fillStyle = i % 3 ? C.dirtDark : C.gravel; g.fill(); }
    g.restore();
  }
  function drawRebar(g, b, a) {
    const [x, w] = bayX(b), y0 = PIT_B + PIT_D + 0.5, y1 = PIT_F - 0.8;
    const k1 = clamp(a / 0.5, 0, 1), k2 = clamp((a - 0.5) / 0.5, 0, 1);
    g.lineWidth = 0.3; g.strokeStyle = C.rebar; g.beginPath();
    for (let i = 0; i < 3; i++) { const yy = y0 + (y1 - y0) * (i + 0.5) / 3; g.moveTo(x + 0.4, yy); g.lineTo(x + 0.4 + (w - 0.8) * k1, yy); }
    const n = Math.floor((w - 0.8) / 1.5);
    for (let i = 0; i < n * k2; i++) { const xx = x + 1 + i * 1.5; g.moveTo(xx + 0.3, y0); g.lineTo(xx - 0.3, y1); }
    g.stroke();
    if (a >= 1) {   /* column dowels sticking up, hooked */
      g.lineWidth = 0.32; g.beginPath();
      for (const xx of [x + 0.9, x + w - 0.9]) { g.moveTo(xx, y1 - 1); g.lineTo(xx, PIT_B - 2); g.lineTo(xx + 0.7, PIT_B - 2.4); }
      g.stroke();
    }
  }
  function drawForm(g, s, a) {
    const x0 = X0 + s * SEGW, w = SEGW * a;
    if (w <= 0) return;
    g.fillStyle = C.form; g.fillRect(x0, PIT_F - 0.4, w, 2.6);           // front plywood
    g.fillStyle = C.formDark; g.fillRect(x0, PIT_F + 1.9, w, 0.3);
    for (let x = x0 + 1.2; x < x0 + w; x += 3.1) g.fillRect(x, PIT_F - 0.4, 0.4, 2.6);
    g.lineWidth = 0.3; g.strokeStyle = C.formDark; g.beginPath();      // kickers to little stakes
    for (let x = x0 + 2.4; x < x0 + w; x += 6.2) { g.moveTo(x, PIT_F + 0.2); g.lineTo(x + 1.6, PIT_F + 3.4); g.moveTo(x + 1.6, PIT_F + 2.6); g.lineTo(x + 1.6, PIT_F + 3.8); }
    g.stroke();
    g.fillStyle = C.form; g.fillRect(x0, PIT_B - 1.3, w, 1.5);           // back boards
    g.fillStyle = C.formDark; g.fillRect(x0, PIT_B - 1.3, w, 0.3);
    g.lineWidth = 0.22; g.strokeStyle = C.ink; g.strokeRect(x0, PIT_F - 0.4, w, 2.6);
  }
  function drawStrip(g, s, a) {   /* the forms come off left to right: paint back what was under them */
    const x0 = X0 + s * SEGW, w = SEGW * a;
    g.fillStyle = C.concreteShade; g.fillRect(x0, PIT_F, w, 1.6);
    g.fillStyle = C.dirt; g.fillRect(x0, PIT_F + 1.6, w, 2.6);
    g.fillStyle = C.concreteLit; g.fillRect(x0, PIT_F - 0.4, w, 0.4);
    g.fillStyle = C.dirt; g.fillRect(x0, PIT_B - 1.3, w, 1.3);
  }
  function drawPour(g, b, a, wet, stripped) {
    const [x, w] = bayX(b);
    const y = a >= 1 ? PIT_B : PIT_B + PIT_D * (1 - ease(a));
    g.fillStyle = wet ? C.wetC : C.concrete; g.fillRect(x, y, w, PIT_F - y);
    if (wet) {   /* the gloss on fresh concrete */
      g.fillStyle = C.wetHi;
      g.fillRect(x + 1, y + 0.5, w * 0.45, 0.3); g.fillRect(x + w * 0.35, y + (PIT_F - y) * 0.55, w * 0.5, 0.25);
      if (a < 1) g.fillRect(x, y, w, 0.35);
    } else {
      g.fillStyle = C.slab; g.fillRect(x, GY, w, PIT_F - GY);        // the apron in front of the face: dusty, jointed
      g.fillStyle = C.concreteLit; g.globalAlpha = 0.6; g.fillRect(x, y, w, 0.4); g.fillRect(x, PIT_F - 0.5, w, 0.5); g.globalAlpha = 1;
      g.fillStyle = C.slabFace; g.beginPath(); g.moveTo(x + w - 0.1, GY); g.lineTo(x + w + 0.6, PIT_F); g.lineTo(x + w + 0.45, PIT_F); g.lineTo(x + w - 0.25, GY); g.fill();
    }
    if (stripped) { g.fillStyle = C.slabFace; g.fillRect(x, PIT_F, w, 1.4); g.fillStyle = C.dirtDark; g.fillRect(x, PIT_F + 1.2, w, 0.25); }
    if (C.snowy && !wet) { g.fillStyle = C.snow; g.fillRect(x, y, w, PIT_F - y); }
  }
  function drawBackfill(g, q, a) {   /* gravel along the front, its edge raked out into the yard */
    const x0 = X0 + q * QW - (q === 0 ? 5 : 0), w = (QW + (q === 0 || q === 3 ? 5 : 0)) * a, y0 = PIT_F + 1.4;
    if (w <= 0) return;
    const R = seeded(hash('gr' + q));
    g.fillStyle = C.snowy ? C.snow : C.fill;
    g.beginPath(); g.moveTo(x0, y0);
    g.lineTo(x0 + w, y0);
    for (let x = x0 + w; x >= x0; x -= 2.2) g.lineTo(x, y0 + 1.6 + R() * 1.4);
    g.closePath(); g.fill();
    if (C.snowy) return;
    g.fillStyle = C.gravelDark;
    for (let i = 0; i < 16 * a; i++) g.fillRect(x0 + R() * w, y0 + 0.2 + R() * 1.8, 0.4, 0.3);
  }
  function drawFoundation(g, done, built) {
    if (!built) drawLot(g, (q) => done('f0:clear' + q));   // once built, the world's yard is the ground
    let dug = 0, back = 0, anyPour = false;
    for (let b = 0; b < NB; b++) { if (done('f0:dig' + b)) { dug++; drawPit(g, b, 1); } if (done('f0:pour' + b)) anyPour = true; }
    for (let q = 0; q < 4; q++) if (done('f0:backfill' + q)) back++;
    drawBerm(g, dug / NB - back / 4);
    for (let b = 0; b < NB; b++) if (done('f0:rebar' + b) && !done('f0:pour' + b)) drawRebar(g, b, 1);
    for (let b = 0; b < NB; b++) if (done('f0:pour' + b)) { const s = segOf(BAYS[b].cx); drawPour(g, b, 1, !done('f0:strip' + s), done('f0:strip' + s)); }
    for (let s = 0; s < SEGS; s++) if (done('f0:form' + s) && !done('f0:strip' + s)) drawForm(g, s, 1);
    for (let q = 0; q < 4; q++) if (done('f0:backfill' + q)) drawBackfill(g, q, 1);
    if (!anyPour) {
      for (let s = 0; s < 6; s++) if (done('f0:stake' + s)) drawStake(g, s, 1);
      for (let i = 0; i < 3; i++) if (done('f0:string' + i)) drawString(g, i, 1);
    }
  }

  /* --------------------------------------------------------- the frame */
  function postX(i) { return clamp(LINES[i] - 0.8, X0, X1 - 1.6); }
  function drawPost(g, f, i, a) {
    const top = floorBottom(f + 1) + 1.4, bot = floorBottom(f), x = postX(i), h = bot - top;
    const th = (1 - ease(Math.min(1, a / 0.75))) * 1.2 * (i % 2 ? -1 : 1);
    g.save(); g.translate(x + 0.8, bot); if (th) g.rotate(th);
    rr(g, -0.8, -h, 1.6, h, 0.2); g.fillStyle = C.timber; g.fill(); outline(g, 0.3);
    g.fillStyle = C.timberLit; g.fillRect(-0.8, -h, 0.45, h);
    g.fillStyle = C.timberShade; g.fillRect(0.45, -h, 0.35, h);
    if (a >= 0.92) { g.fillStyle = C.charDark; g.fillRect(-0.9, -0.9, 1.8, 0.9); g.fillRect(-0.9, -h, 1.8, 0.7); }
    g.restore();
  }
  function drawColumn(g, i, a) {
    const top = floorBottom(1) + 1.4, bot = GY, x = clamp(LINES[i] - 1.1, X0, X1 - 2.2), h = bot - top;
    if (a < 1) {
      const fh = h * Math.min(1, a / 0.5);
      rr(g, x - 0.4, bot - fh, 3, fh, 0.2); g.fillStyle = C.form; g.fill(); outline(g, 0.25);
      g.fillStyle = C.formDark; for (let y = bot - 2.5; y > bot - fh; y -= 3) g.fillRect(x - 0.4, y, 3, 0.35);
      if (a > 0.5) { g.fillStyle = C.wetC; g.fillRect(x, bot - fh - 0.4, 2.2, 0.6); g.fillStyle = C.wetHi; g.fillRect(x + 0.3, bot - fh - 0.4, 0.9, 0.2); }
      return;
    }
    rr(g, x, top, 2.2, h, 0.2); g.fillStyle = C.concrete; g.fill(); outline(g, 0.3);
    g.fillStyle = C.concreteLit; g.fillRect(x, top, 0.6, h);
    g.fillStyle = C.concreteShade; g.fillRect(x + 1.7, top, 0.5, h);
  }
  /* slings and the crane's line while a piece settles in, but only when the real tower crane's
     trolley is over it (the crew flies pieces with it); otherwise the piece is guided in by hand */
  function lift(g, x, y, a) {
    if (a >= 0.6 || !K.crew || !K.crew.crane) return;
    const c = K.crew.crane();
    if (!c || c.load || Math.abs(c.x - x) > 6 || !(c.y < y - 6)) return;
    line(g, c.x, c.y + 2, x, y - 5, C.steelDark, 0.25);
    g.beginPath(); g.moveTo(x - 3.5, y); g.lineTo(x, y - 5); g.lineTo(x + 3.5, y); g.lineWidth = 0.2; g.strokeStyle = C.steelDark; g.stroke();
  }
  function drawBeam(g, f, b, a) {
    const bay = BAYS[b], y = floorBottom(f + 1) + 1.4 - 3 * (1 - ease(a)), x = bay.x - 0.2, w = bay.w + 0.4;
    if (a < 1) lift(g, x + w / 2, y, a);
    rr(g, x, y, w, 1.9, 0.25); g.fillStyle = C.timber; g.fill(); outline(g, 0.3);
    g.fillStyle = C.timberLit; g.fillRect(x, y, w, 0.4);
    g.fillStyle = C.timberShade; g.fillRect(x, y + 1.45, w, 0.45);
  }
  function drawDeck(g, f, b, a) {
    const bay = BAYS[b], y = floorBottom(f + 1) - 0.4 - 3 * (1 - ease(a)), x = bay.x - 0.3, w = bay.w + 0.6;
    if (a < 1) lift(g, x + w / 2, y, a);
    rr(g, x, y, w, 1.8, 0.2); g.fillStyle = C.clt; g.fill(); outline(g, 0.28);
    g.fillStyle = C.timberShade; g.fillRect(x + 0.2, y + 0.6, w - 0.4, 0.18); g.fillRect(x + 0.2, y + 1.2, w - 0.4, 0.18);
    g.fillStyle = C.timberLit; g.fillRect(x, y, w, 0.3);
  }
  function drawRoom(g, f, b) {   /* once the deck is over a bay, it's a room: darker inside */
    const bay = BAYS[b], top = floorBottom(f + 1) + 1.4, bot = floorBottom(f);
    g.fillStyle = C.interiorSoft; g.fillRect(bay.x, top, bay.w, bot - top);
    g.fillStyle = C.interior; g.fillRect(bay.x, top, bay.w, 1.2);
  }
  function drawStuds(g, f, b, a) {
    const bay = BAYS[b], top = floorBottom(f + 1) + 3.3, bot = floorBottom(f), r = winRect(f, b);
    const xs = [];
    for (let x = bay.x + 1; x < bay.x + bay.w - 0.6; x += 2.1) xs.push(x);
    const n = a >= 1 ? xs.length : Math.ceil(a * xs.length);
    if (!n) return;
    const xe = Math.min(bay.x + bay.w - 0.6, xs[n - 1] + 0.42);
    g.fillStyle = C.stud;
    g.fillRect(bay.x + 0.6, bot - 0.5, xe - bay.x - 0.6, 0.5);
    if (a >= 1) g.fillRect(bay.x + 0.6, top, bay.w - 1.2, 0.45);
    for (let i = 0; i < n; i++) {
      const x = xs[i];
      if (r && x > r[0] - 0.3 && x < r[0] + r[2] + 0.1) {   // cut around the window: cripples and a header
        if (bot - (r[1] + r[3]) > 0.8) g.fillRect(x, r[1] + r[3] + 0.5, 0.42, bot - (r[1] + r[3]) - 0.5);
        if (r[1] - 0.8 - top > 0.4) g.fillRect(x, top, 0.42, r[1] - 0.8 - top);
      } else g.fillRect(x, top, 0.42, bot - top);
    }
    if (r && a >= 1) { g.fillStyle = C.timberShade; g.fillRect(r[0] - 0.4, r[1] - 0.9, r[2] + 0.8, 0.8); g.fillStyle = C.stud; g.fillRect(r[0] - 0.4, r[1] + r[3], r[2] + 0.8, 0.5); }
  }
  function drawWire(g, f, b, a) {
    const bay = BAYS[b], top = floorBottom(f + 1), bot = floorBottom(f), y = top + 5.1;
    const x0 = bay.x + 0.6, x1 = x0 + (bay.w - 1.2) * a;
    line(g, x0, y, x1, y, C.copper, 0.42);
    if (a < 1) {   /* the slack being pulled */
      g.beginPath(); g.moveTo(x1, y); g.quadraticCurveTo(x1 + 1, y + 2.4, x1 + 2, y + 0.6); g.lineWidth = 0.35; g.strokeStyle = C.copper; g.stroke();
      return;
    }
    const bx = bay.x + 2.3;
    line(g, bx + 0.5, y, bx + 0.5, bot - 4, C.copper, 0.35);
    box(g, bx, bot - 4.4, 1.1, 1.3, C.box, 0.2);
    line(g, bay.x + bay.w - 1.8, top + 3.6, bay.x + bay.w - 1.8, bot, C.pipe, 0.5);
    line(g, bay.x + bay.w - 2.6, top + 3.6, bay.x + bay.w - 2.6, bot, C.pipeRed, 0.35);
  }

  /* --------------------------------------------------------- the skin */
  function bandRange(f, k) { const top = floorBottom(f + 1), bot = floorBottom(f), hh = (bot - top) / 3; return [bot - (k + 1) * hh, bot - k * hh]; }
  function rustFill(g, x, y, w, h, vol, topFloor) {
    if (topFloor) {
      g.fillStyle = C.char; g.fillRect(x, y, w, h);
      g.fillStyle = C.charLine; for (let xx = Math.ceil(x) + 0.2; xx < x + w - 0.1; xx += 1) g.fillRect(xx, y, 0.3, h);
      return;
    }
    const L = vol === 'L';
    g.fillStyle = L ? C.rustL : C.rust; g.fillRect(x, y, w, h);
    const x0 = Math.ceil(x / 1.5) * 1.5;
    g.fillStyle = C.rustGroove; for (let xx = x0 + 0.95; xx < x + w - 0.2; xx += 1.5) g.fillRect(xx, y, 0.3, h);
    g.fillStyle = L ? C.rustLRib : C.rustRib; for (let xx = x0 + 0.4; xx < x + w - 0.2; xx += 1.5) g.fillRect(xx, y, 0.28, h);
  }
  /* brick courses from the bottom of the band up; a is how much is laid. Returns the top of the laid part. */
  function brickFill(g, x, y0, y1, w, a) {
    const rows = Math.max(1, Math.round((y1 - y0) / 1.1)), rh = (y1 - y0) / rows;
    const full = a >= 1 ? rows : Math.floor(a * rows), frac = a >= 1 ? 0 : a * rows - full;
    g.fillStyle = C.mortar;
    g.fillRect(x, y1 - full * rh, w, full * rh);
    if (frac > 0) g.fillRect(x, y1 - (full + 1) * rh, w * frac, rh);
    const tones = [C.brick, C.brickAlt, C.brickLit];
    for (let r = 0; r < full + (frac > 0 ? 1 : 0); r++) {
      const yy = y1 - (r + 1) * rh, gi = Math.round((GY - yy) / rh), off = (gi % 2) * 1.2;
      const lim = r === full ? x + w * frac : x + w;
      for (let bx = Math.floor((x - off) / 2.4) * 2.4 + off; bx < lim; bx += 2.4) {
        const xa = Math.max(x, bx + 0.12), xb = Math.min(lim, bx + 2.28);
        if (xb <= xa) continue;
        const hv = hash(gi * 131 + Math.round(bx * 10)) % 7;
        g.fillStyle = tones[hv < 4 ? 0 : hv < 6 ? 1 : 2];
        g.fillRect(xa, yy + 0.12, xb - xa, rh - 0.24);
      }
    }
    return y1 - full * rh;
  }
  function opening(g, r, y0, y1, dy) {   /* the window hole in a band, until the glass goes in */
    if (!r) return;
    const ya = Math.max(r[1], y0), yb = Math.min(r[1] + r[3], y1);
    if (yb <= ya) return;
    g.fillStyle = C.interiorDeep; g.fillRect(r[0], ya + (dy || 0), r[2], yb - ya);
  }
  function drawWall(g, f, b, k, a, F) {
    const bay = BAYS[b], [y0, y1] = bandRange(f, k), r = winRect(f, b), topFloor = f === F - 1 && f > 0;
    if (bay.vol === 'C') {
      const cov = brickFill(g, bay.x, y0, y1, bay.w, a);
      opening(g, r, cov, y1);
      if (a >= 1 && k === 2 && f > 0) { g.fillStyle = C.brickDark; g.fillRect(bay.x, y0, bay.w, 0.7); }
      return;
    }
    const dy = a >= 1 ? 0 : (1 - ease(Math.min(1, a / 0.5))) * (y1 - y0) * 0.9;
    rustFill(g, bay.x, y0 + dy, bay.w, y1 - y0, bay.vol, topFloor);
    opening(g, r, y0, y1, dy);
    g.fillStyle = topFloor ? C.charDark : C.rustEdge; g.fillRect(bay.x, y0 + dy, bay.w, 0.3);
    if (a < 1 && a > 0.5) {   /* screws going in */
      g.fillStyle = C.coping;
      const n = Math.floor((a - 0.5) / 0.5 * 5);
      for (let i = 0; i < n; i++) { g.fillRect(bay.x + 1 + i * (bay.w - 2) / 4, y0 + 0.6, 0.35, 0.35); g.fillRect(bay.x + 1 + i * (bay.w - 2) / 4, y1 - 0.9, 0.35, 0.35); }
    }
  }
  function drawStorefront(g, b, a) {
    const bay = BAYS[b], r = winRect(0, b), top = floorBottom(1);
    const n = a >= 1 ? 7 : Math.floor(a * 7.99);
    if (n >= 1) { rustFill(g, bay.x, top, bay.w, GY - top, 'M', false); g.fillStyle = C.rustEdge; g.fillRect(bay.x, r[1] - 0.9, bay.w, 0.3); }
    if (n >= 2) opening(g, r, r[1], r[1] + r[3]);
    g.fillStyle = C.frame;
    const m = [() => g.fillRect(r[0] - 0.5, r[1] - 0.6, r[2] + 1, 0.6), () => g.fillRect(r[0] - 0.5, r[1] - 0.6, 0.6, r[3] + 0.6), () => g.fillRect(r[0] + r[2] - 0.1, r[1] - 0.6, 0.6, r[3] + 0.6),
      () => g.fillRect(r[0], r[1] + 3.2, r[2], 0.4), () => g.fillRect(r[0] + r[2] / 2 - 0.2, r[1], 0.4, r[3])];
    for (let i = 2; i < Math.min(n, 7); i++) m[i - 2]();
  }
  function glassAt(g, x, y, w, h) {
    const night = C.night > 0.45;
    g.fillStyle = night ? C.glassNight : C.glass; g.fillRect(x, y, w, h);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + w * 0.55, y); g.lineTo(x, y + h * 0.7); g.closePath();
    g.fillStyle = night ? C.glassDark : C.glassHi; g.globalAlpha = night ? 0.5 : 0.75; g.fill(); g.globalAlpha = 1;
  }
  function drawLife(g, r, life, lit) {
    const [x, y, w, h] = r;
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    if (lit && C.night > 0.45) {
      g.fillStyle = C.winLit; g.fillRect(x, y, w, h);
      g.fillStyle = C.winLitDeep; g.fillRect(x, y + h * 0.66, w, h * 0.34);
      g.fillStyle = C.sil;
      const sx = y + h;
      switch (life) {
        case 0: {   // a lamp
          line(g, x + w - 1.5, sx, x + w - 1.5, sx - 3, C.sil, 0.3);
          g.beginPath(); g.moveTo(x + w - 2.6, sx - 3); g.lineTo(x + w - 0.4, sx - 3); g.lineTo(x + w - 0.9, sx - 4.5); g.lineTo(x + w - 2.1, sx - 4.5); g.closePath(); g.fillStyle = C.lamp; g.fill();
          break; }
        case 1: {   // a plant on the sill
          g.fillRect(x + 0.7, sx - 1.3, 1.5, 1.3);
          for (const [dx, dy, rx] of [[1.1, -2.4, 0.8], [0.4, -2.0, 0.6], [1.9, -2.2, 0.7], [1.4, -3.1, 0.55]]) { g.beginPath(); g.ellipse(x + dx, sx + dy, rx, rx * 0.7, 0, 0, 7); g.fill(); }
          break; }
        case 2: {   // a cat in the window
          const cx = x + 1.9;
          g.beginPath(); g.ellipse(cx, sx - 1.0, 1.1, 1.0, 0, 0, 7); g.fill();
          g.beginPath(); g.arc(cx + 0.5, sx - 2.3, 0.65, 0, 7); g.fill();
          g.beginPath(); g.moveTo(cx - 0.05, sx - 2.6); g.lineTo(cx + 0.1, sx - 3.4); g.lineTo(cx + 0.45, sx - 2.9); g.moveTo(cx + 0.6, sx - 2.9); g.lineTo(cx + 0.95, sx - 3.4); g.lineTo(cx + 1.1, sx - 2.6); g.fill();
          g.beginPath(); g.moveTo(cx - 0.9, sx - 0.3); g.quadraticCurveTo(cx - 2.2, sx - 0.4, cx - 1.7, sx - 1.8); g.lineWidth = 0.35; g.strokeStyle = C.sil; g.stroke();
          break; }
        case 3: {   // someone at a desk
          g.beginPath(); g.arc(x + w / 2, sx - 2.7, 0.9, 0, 7); g.fill();
          g.beginPath(); g.ellipse(x + w / 2, sx - 0.2, 1.9, 1.6, 0, Math.PI, 0); g.fill();
          break; }
        case 4: {   // curtains, tied back
          g.fillStyle = C.silSoft;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + w * 0.32, y); g.quadraticCurveTo(x + w * 0.1, y + h * 0.55, x + w * 0.24, y + h); g.lineTo(x, y + h); g.fill();
          g.beginPath(); g.moveTo(x + w, y); g.lineTo(x + w * 0.68, y); g.quadraticCurveTo(x + w * 0.9, y + h * 0.55, x + w * 0.76, y + h); g.lineTo(x + w, y + h); g.fill();
          break; }
        default: {  // a bookshelf
          for (let i = 0; i < 5; i++) { const hh = (hash(i + life * 7) % 3) * 0.3; g.fillRect(x + 0.4 + i * 0.55, sx - 1.4 - hh, 0.42, 1.4 + hh); }
          g.fillRect(x + 0.2, sx - 0.2, 3, 0.2);
        }
      }
    } else {
      glassAt(g, x, y, w, h);
      if (lit) {   /* by day: someone's curtain, someone's plant */
        if (life % 2) { g.fillStyle = life % 3 ? C.curtain : C.curtain2; g.fillRect(x + w - 1.6, y, 1.6, h); g.fillStyle = C.ink; g.globalAlpha = 0.15; g.fillRect(x + w - 1.0, y, 0.2, h); g.globalAlpha = 1; }
        else { g.fillStyle = C.pot; g.fillRect(x + 0.6, y + h - 1.2, 1.4, 1.2); g.fillStyle = C.plant; g.beginPath(); g.ellipse(x + 1.3, y + h - 2.1, 1.0, 0.9, 0, 0, 7); g.fill(); g.fillStyle = C.plantDark; g.beginPath(); g.ellipse(x + 1.6, y + h - 1.8, 0.6, 0.5, 0, 0, 7); g.fill(); }
      }
    }
    g.restore();
  }
  function drawGlaze(g, f, b, a, lit, life, F) {
    const bay = BAYS[b];
    if (bay.vol === 'G') {   /* the dark glass slot, full height, a panel per floor */
      const top = floorBottom(f + 1), bot = floorBottom(f), h = bot - top, dy = (1 - ease(a)) * -h;
      const nt = C.night > 0.45;
      g.save(); g.beginPath(); g.rect(bay.x, top, bay.w, h); g.clip();
      g.fillStyle = nt ? C.glassNight : C.glassDark; g.fillRect(bay.x, top + dy, bay.w, h);
      g.fillStyle = nt ? mix(C.winLitDeep, C.glassNight, 0.6) : C.glass; g.globalAlpha = 0.6; g.fillRect(bay.x + 1, top + dy, 0.6, h); g.fillRect(bay.x + 3.4, top + dy, 0.35, h); g.globalAlpha = 1;
      g.fillStyle = C.charDark; g.fillRect(bay.x, top + dy, bay.w, 0.5); g.fillRect(bay.x + bay.w / 2 - 0.15, top + dy, 0.3, h);
      if (nt && a >= 1) { g.fillStyle = rgba(C.winLit, 0.35); g.fillRect(bay.x + 0.8, top + h * 0.35, bay.w - 1.6, 1.2); }   // the stair light
      g.restore();
      return;
    }
    const r = winRect(f, b);
    if (a < 1) {
      g.save(); g.beginPath(); g.rect(r[0], r[1], r[2], r[3]); g.clip();
      glassAt(g, r[0] + (1 - ease(a)) * (r[2] + 1), r[1], r[2], r[3]);
      g.restore();
      g.lineWidth = 0.5; g.strokeStyle = C.frame; g.strokeRect(r[0], r[1], r[2], r[3]);
      return;
    }
    drawLife(g, r, life, lit);
    g.lineWidth = 0.55; g.strokeStyle = C.frame; g.strokeRect(r[0], r[1], r[2], r[3]);
    g.fillStyle = C.frame;
    if (f === 0 && bay.vol === 'M') { g.fillRect(r[0], r[1] + 3.2, r[2], 0.4); g.fillRect(r[0] + r[2] / 2 - 0.2, r[1], 0.4, r[3]); }
    else if (f === 0) g.fillRect(r[0] + r[2] / 2 - 0.2, r[1], 0.4, r[3]);
    else g.fillRect(r[0], r[1] + r[3] * 0.3, r[2], 0.35);
    if (bay.vol === 'M' && f > 0 && f < F - 1) { g.fillStyle = C.eyebrow; g.fillRect(r[0] - 0.8, r[1] - 1.2, r[2] + 1.6, 0.85); }
    g.fillStyle = C.coping; g.fillRect(r[0] - 0.6, r[1] + r[3], r[2] + 1.2, 0.6);
    snowCap(g, r[0] - 0.6, r[1] + r[3], r[2] + 1.2);
  }
  function drawCanopy(g, m, a) {
    const bay = BAYS[3 + m], x = bay.x - (m === 0 ? 1.2 : 0), w = bay.w + (m === 0 ? 1.2 : 0) + (m === 3 ? 1.2 : 0), y = CANOPY_Y;
    g.fillStyle = C.timberShade; g.fillRect(x, y, w * Math.min(1, a * 2), 1.8);
    g.fillStyle = C.timberLit;
    for (let xx = x + 0.3; xx < x + w * a - 0.2; xx += 0.9) g.fillRect(xx, y + 0.1, 0.45, 1.5);
    if (a >= 1) {
      g.fillStyle = C.interiorDeep; g.globalAlpha = 0.45; g.fillRect(x, y + 1.8, w, 1); g.globalAlpha = 1;
      g.lineWidth = 0.28; g.strokeStyle = C.ink; g.strokeRect(x, y, w, 1.8);
      g.fillStyle = C.charDark;
      if (m === 0) g.fillRect(x + 0.5, y + 1.8, 0.5, GY - y - 1.8);
      if (m === 3) g.fillRect(x + w - 1, y + 1.8, 0.5, GY - y - 1.8);
      snowCap(g, x, y, w);
    }
  }

  /* --------------------------------------------------------- the roof */
  const CB = (() => { const c = BAYS.filter((q) => q.vol === 'C'); return [c[0].x, c[c.length - 1].x + c[c.length - 1].w]; })();
  const GB = BAYS.find((q) => q.vol === 'G');
  function drawRoof(g, F) {
    const ry = floorBottom(F), [cx0, cx1] = CB, G = GB;
    /* parapets: charcoal over the wing and the middle, brick on the corner, glass over the slot */
    box(g, X0, ry - 1.8, G.x - X0, 1.8, C.char, 0.3);
    g.fillStyle = C.coping; g.fillRect(X0 - 0.3, ry - 2.3, G.x - X0 + 0.3, 0.6);
    box(g, G.x, ry - 3.2, G.w, 3.2, C.night > 0.45 ? C.glassNight : C.glassDark, 0.3);
    brickFill(g, cx0, ry - 3.4, ry, cx1 - cx0, 1);
    g.lineWidth = 0.3; g.strokeStyle = C.ink; g.strokeRect(cx0, ry - 3.4, cx1 - cx0, 3.4);
    g.fillStyle = C.coping; g.fillRect(cx0 - 0.3, ry - 4.1, cx1 - cx0 + 0.6, 0.7);
    snowCap(g, X0 - 0.3, ry - 2.3, G.x - X0 + 0.3); snowCap(g, cx0 - 0.3, ry - 4.1, cx1 - cx0 + 0.6);
    /* the timber penthouse box */
    const px = 449, pw = 18, ph = 7, py = ry - 1.8 - ph;
    g.fillStyle = C.timberShade; g.fillRect(px, py, pw, ph);
    g.fillStyle = C.timber; for (let x = px + 0.3; x < px + pw - 0.2; x += 0.9) g.fillRect(x, py, 0.5, ph);
    box(g, px + 3, py + 2, 2.4, ph - 2, C.interiorDeep, 0.2);
    if (C.night > 0.45) { g.fillStyle = C.winLit; g.fillRect(px + 9, py + 2, 5, 2.4); } else glassAt(g, px + 9, py + 2, 5, 2.4);
    g.lineWidth = 0.3; g.strokeStyle = C.ink; g.strokeRect(px, py, pw, ph);
    box(g, px - 0.9, py - 0.9, pw + 1.8, 0.9, C.char, 0.25);
    snowCap(g, px - 0.9, py - 0.9, pw + 1.8);
    /* the last beam, signed, with a little evergreen on it: once the crane has set it */
    if (!beamUp) return;
    const bx = cx0 + 3, by = ry - 4.1 - 1.9;
    rr(g, bx, by, 21, 1.9, 0.25); g.fillStyle = C.timber; g.fill(); outline(g, 0.3);
    g.fillStyle = C.timberLit; g.fillRect(bx, by, 21, 0.4);
    g.fillStyle = C.timberDark; for (let x = bx + 1; x < bx + 20; x += 1.3) if (hash('sig' + x) % 3) g.fillRect(x, by + 0.8, 0.7, 0.25);
    const tx = bx + 7;
    for (const [w, y0, y1] of [[4.2, by - 3.2, by], [3.4, by - 5.6, by - 2.4], [2.4, by - 8, by - 4.8]]) {
      g.beginPath(); g.moveTo(tx - w, y1); g.lineTo(tx, y0); g.lineTo(tx + w, y1); g.closePath(); g.fillStyle = C.evergreen; g.fill(); outline(g, 0.25);
      g.beginPath(); g.moveTo(tx - w * 0.7, y1 - 0.3); g.lineTo(tx, y0 + 0.3); g.lineTo(tx - w * 0.15, y1 - 0.3); g.closePath(); g.fillStyle = C.evergreenLit; g.fill();
    }
    if (C.snowy) { g.fillStyle = C.snow; g.beginPath(); g.moveTo(tx - 1, by - 7); g.lineTo(tx, by - 8); g.lineTo(tx + 1, by - 7); g.fill(); }
    line(g, bx + 17, by, bx + 17, by - 8, C.timberDark, 0.35);
  }
  function drawFlag(g, F) {
    const x = CB[0] + 3 + 17, y = floorBottom(F) - 4.1 - 1.9 - 8;
    const w1 = Math.sin(t * 5) * 0.35, w2 = Math.sin(t * 5 + 1.3) * 0.35;
    g.beginPath(); g.moveTo(x + 0.1, y); g.quadraticCurveTo(x + 1.8, y - 0.3 + w1, x + 3.6, y + 0.2 + w2); g.lineTo(x + 3.6, y + 2.2 + w2); g.quadraticCurveTo(x + 1.8, y + 1.8 + w1, x + 0.1, y + 2.1); g.closePath();
    g.fillStyle = C.flag; g.fill(); g.lineWidth = 0.2; g.strokeStyle = C.ink; g.stroke();
    g.fillStyle = C.white; g.fillRect(x + 0.2, y + 0.9 + w1 * 0.5, 3.3, 0.35);
  }
  function drawSolar(g, i, a, F) {
    const x = SOLAR_X[i], ry = floorBottom(F) - 1.8, k = ease(a);
    if (k <= 0) return;
    g.beginPath(); g.moveTo(x, ry); g.lineTo(x + 4.6, ry); g.lineTo(x + 5.3, ry - 2.6 * k); g.lineTo(x + 0.7, ry - 2.6 * k); g.closePath();
    g.fillStyle = C.solar; g.fill(); outline(g, 0.22);
    line(g, x + 0.7, ry - 2.6 * k, x + 5.3, ry - 2.6 * k, C.solarHi, 0.3);
    line(g, x + 2.65, ry, x + 3.0, ry - 2.6 * k, C.solarLine, 0.18);
    if (C.snowy && a >= 1) { g.fillStyle = C.snow; g.fillRect(x + 0.7, ry - 2.9, 4.6, 0.5); }
  }
  function drawTree(g, i, a) {
    const x = TREE_X[i], y = GY + 9, s = 0.35 + 0.65 * ease(a), m = K.now().getMonth();
    g.beginPath(); g.ellipse(x, y, 1.6, 0.5, 0, 0, 7); g.fillStyle = C.dirtDark; g.fill();
    g.fillStyle = C.trunk; g.fillRect(x - 0.4 * s, y - 7 * s, 0.8 * s, 7 * s);
    const bareTree = m === 11 || m <= 2, fallTree = m === 9 || m === 10;
    if (bareTree) {
      g.lineWidth = 0.3; g.strokeStyle = C.trunk; g.beginPath();
      g.moveTo(x, y - 6 * s); g.lineTo(x - 2.4 * s, y - 10 * s); g.moveTo(x, y - 7 * s); g.lineTo(x + 2.2 * s, y - 10.5 * s); g.moveTo(x, y - 7 * s); g.lineTo(x + 0.3, y - 11.5 * s); g.stroke();
      if (C.snowy) { g.fillStyle = C.snow; g.fillRect(x - 2.5 * s, y - 10.2 * s, 1.2, 0.35); g.fillRect(x + 1.3 * s, y - 10.6 * s, 1.2, 0.35); }
      return;
    }
    const c1 = fallTree ? (i % 2 ? C.autumnA : C.autumnB) : C.tree, c2 = fallTree ? mix(c1, C.white, 0.18) : C.treeLight;
    for (const [dx, dy, r, c] of [[-1.4, -9.6, 2.6, c1], [1.5, -9.9, 2.5, c1], [0, -11.6, 2.7, c1], [-0.7, -11.2, 1.5, c2]]) {
      g.beginPath(); g.arc(x + dx * s, y + dy * s, r * s, 0, 7); g.fillStyle = c; g.fill();
      if (c === c1) outline(g, 0.22);
    }
  }
  function drawPlanter(g, i, a) {
    const x = PLANTER_X[i], y = GY + 7;
    box(g, x - 2.7, y - 2.4, 5.4, 2.4, C.timberShade, 0.25);
    g.fillStyle = C.timber; for (let xx = x - 2.5; xx < x + 2.6; xx += 1.1) g.fillRect(xx, y - 2.4, 0.6, 2.4);
    const s = ease(a);
    if (s <= 0) return;
    for (const [dx, r, c] of [[-1.5, 1.1, C.plant], [0.1, 1.4, C.plantDark], [1.6, 1.0, C.plant]]) { g.beginPath(); g.arc(x + dx, y - 2.4 - r * 0.5 * s, r * s, Math.PI, 0); g.fillStyle = c; g.fill(); }
    if (a >= 1 && !C.snowy) { g.fillStyle = i % 2 ? C.flower1 : C.flower2; for (const dx of [-1.6, 0.4, 1.5]) g.fillRect(x + dx, y - 3.7, 0.5, 0.5); }
    if (C.snowy) snowCap(g, x - 2.7, y - 2.4, 5.4);
  }

  /* --------------------------------------------------------- upkeep */
  function drawWash(g, b, a) {   /* a squeegee sheen crossing the glass */
    const r = winRect(0, b); if (!r) return;
    const x = r[0] + r[2] * (a * 1.3 - 0.15);
    g.save(); g.beginPath(); g.rect(r[0], r[1], r[2], r[3]); g.clip();
    g.beginPath(); g.moveTo(x, r[1]); g.lineTo(x + 1.6, r[1]); g.lineTo(x - 0.6, r[1] + r[3]); g.lineTo(x - 2.2, r[1] + r[3]); g.closePath();
    g.fillStyle = rgba(C.white, 0.55); g.fill();
    g.fillStyle = rgba(C.glassHi, 0.35); g.fillRect(r[0], r[1], Math.max(0, x - r[0] - 1), r[3]);
    g.restore();
  }
  function drawDust(g, x, y, a) {
    if (a >= 1) return;
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.9 + i / 3) % 1;
      g.beginPath(); g.arc(x + i * 1.6 + k * 3, y - 0.6 - k * 2.2, 0.6 + k * 1.1, 0, 7); g.fillStyle = rgba(C.dirtLit, 0.45 * (1 - k)); g.fill();
    }
  }
  function drawWater(g, x, y, tx, ty, a) {
    if (a >= 1) return;
    g.fillStyle = rgba(C.pipe, 0.85);
    for (let i = 0; i < 5; i++) {
      const k = (t * 1.6 + i / 5) % 1;
      g.beginPath(); g.arc(x + (tx - x) * k, y + (ty - y) * k - Math.sin(k * Math.PI) * 2.5, 0.3, 0, 7); g.fill();
    }
  }
  function drawLeaves(g, x, y, a) {
    const s = ease(a);
    if (s <= 0 || a >= 1) return;
    g.beginPath(); g.ellipse(x, y, 2.6 * s + 0.6, 1.1 * s + 0.3, 0, Math.PI, 0); g.fillStyle = C.autumnA; g.fill();
    g.beginPath(); g.ellipse(x + 0.8, y - 0.2, 1.4 * s + 0.3, 0.7 * s + 0.2, 0, Math.PI, 0); g.fillStyle = C.autumnB; g.fill();
  }
  function drawShoveled(g, i, a) {   /* a cleared path along the sidewalk */
    if (!C.snowy) return;
    const x0 = X0 + 4 + i * 28, w = 28 * a;
    g.fillStyle = C.slab; g.fillRect(x0, GY + 6.6, w, 1.6);
    g.fillStyle = C.snowShade; g.fillRect(x0, GY + 6.4, w, 0.3); g.fillRect(x0, GY + 8.1, w, 0.3);
  }
  function drawPaint(g, x, a) {
    if (a >= 1) return;
    const h = (GY - CANOPY_Y - 2) * a;
    g.fillStyle = mix(C.charDark, C.white, 0.15); g.fillRect(x - 0.3, GY - h, 0.7, h);
    g.fillStyle = rgba(C.white, 0.5); g.fillRect(x - 0.2, GY - h, 0.2, h);
  }
  function drawWreath(g, m, a) {
    const b = BAYS[3 + m], x = b.cx, y = CANOPY_Y - 2.4, r = 1.5 * (0.4 + 0.6 * ease(a));
    g.beginPath(); g.arc(x, y, r, 0, 7); g.lineWidth = 0.9; g.strokeStyle = C.evergreen; g.stroke();
    g.beginPath(); g.arc(x - 0.3, y - 0.3, r, Math.PI * 0.9, Math.PI * 1.6); g.lineWidth = 0.35; g.strokeStyle = C.evergreenLit; g.stroke();
    if (a >= 0.7) { g.fillStyle = C.flag; g.beginPath(); g.moveTo(x - 0.9, y + r + 0.2); g.lineTo(x, y + r - 0.4); g.lineTo(x + 0.9, y + r + 0.2); g.lineTo(x, y + r + 0.8); g.fill(); }
  }
  function wreathsUp() { return K.now().getMonth() === 11; }

  /* --------------------------------------------------------- scaffold, hoist, netting */
  function drawScaffold(g, lvl) {
    const yT = floorBottom(lvl), top = yT - 6.6;
    /* orange safety netting wraps the tower's lower lifts */
    const ny = Math.max(top, floorBottom(1));
    g.fillStyle = rgba(C.net, 0.3); g.fillRect(TOWER0, ny, TOWER1 - TOWER0, GY - ny);
    g.save(); g.beginPath(); g.rect(TOWER0, ny, TOWER1 - TOWER0, GY - ny); g.clip();
    g.lineWidth = 0.15; g.strokeStyle = rgba(C.net, 0.55); g.beginPath();
    for (let d = -10; d < GY - ny + 2; d += 1.6) { g.moveTo(TOWER0, ny + d); g.lineTo(TOWER1, ny + d + 7.3); g.moveTo(TOWER1, ny + d); g.lineTo(TOWER0, ny + d + 7.3); }
    g.stroke(); g.restore();
    /* uprights, ledgers, braces */
    g.fillStyle = C.scaffoldDark; g.fillRect(TOWER0, top, 0.55, GY - top); g.fillRect(TOWER1 - 0.55, top, 0.55, GY - top);
    const lv = []; for (let k = 0; k <= lvl; k++) lv.push(floorBottom(k));
    g.fillStyle = C.scaffold;
    for (let k = 1; k < lv.length; k++) { g.fillRect(TOWER0, lv[k] - 0.5, TOWER1 - TOWER0, 0.7); g.fillRect(TOWER0, (lv[k] + lv[k - 1]) / 2, TOWER1 - TOWER0, 0.4); }
    g.lineWidth = 0.28; g.strokeStyle = C.scaffold; g.beginPath();
    for (let k = 1; k < lv.length; k++) { if (k % 2) { g.moveTo(TOWER0, lv[k - 1]); g.lineTo(TOWER1, lv[k]); } else { g.moveTo(TOWER1, lv[k - 1]); g.lineTo(TOWER0, lv[k]); } }
    g.stroke();
    /* the ladder */
    g.fillStyle = C.scaffoldDark; g.fillRect(LADDER_X - 0.95, top + 1, 0.35, GY - top - 1); g.fillRect(LADDER_X + 0.6, top + 1, 0.35, GY - top - 1);
    g.fillStyle = C.scaffold; for (let y = GY - 1; y > top + 1.5; y -= 1.3) g.fillRect(LADDER_X - 0.95, y, 1.9, 0.3);
    g.fillStyle = C.concreteShade; g.fillRect(TOWER0 - 0.8, GY - 0.4, 1.8, 0.6); g.fillRect(TOWER1 - 1, GY - 0.4, 1.8, 0.6);
    /* the working platform along the face, and a catch net under it */
    g.fillStyle = rgba(C.net, 0.22); g.fillRect(X0, yT + 0.9, X1 - X0 + 1, 2);
    g.lineWidth = 0.12; g.strokeStyle = rgba(C.net, 0.5); g.beginPath();
    for (let x = X0; x < X1; x += 1.4) { g.moveTo(x, yT + 0.9); g.lineTo(x + 1.4, yT + 2.9); g.moveTo(x + 1.4, yT + 0.9); g.lineTo(x, yT + 2.9); }
    g.stroke();
    box(g, TOWER0, yT, X1 + 1.5 - TOWER0, 0.9, C.plank, 0.22);
    g.fillStyle = C.scaffoldDark; for (let x = X0 + 4; x < X1; x += 13) { g.beginPath(); g.moveTo(x, yT + 0.9); g.lineTo(x + 1.6, yT + 0.9); g.lineTo(x, yT + 2.4); g.fill(); }
    snowCap(g, TOWER0, yT, X1 + 1.5 - TOWER0);
    /* the material hoist on the east end: mast, and its cage at the landing */
    const hx = HOIST_X;
    g.fillStyle = C.steel; g.fillRect(hx + 3.2, top - 3, 0.5, GY - top + 3); g.fillRect(hx + 5, top - 3, 0.5, GY - top + 3);
    g.lineWidth = 0.2; g.strokeStyle = C.steel; g.beginPath();
    for (let y = GY; y > top - 2; y -= 2.2) { g.moveTo(hx + 3.2, y); g.lineTo(hx + 5.5, y - 1.1); g.lineTo(hx + 3.2, y - 2.2); }
    g.stroke();
    box(g, hx + 2.6, top - 4, 3.6, 1.4, C.steelDark, 0.2);
    const cy = yT - 7;
    box(g, hx, cy, 5.8, 7, rgba(C.steelDark, 0.35), 0.3);
    g.lineWidth = 0.14; g.strokeStyle = C.steel; g.beginPath();
    for (let x = hx + 1; x < hx + 5.8; x += 1.1) { g.moveTo(x, cy); g.lineTo(x, cy + 7); }
    g.stroke();
    g.fillStyle = C.rail; g.fillRect(hx - 0.2, cy + 3.2, 6.2, 0.45); g.fillRect(hx - 0.2, cy, 6.2, 0.6);
    box(g, hx - 0.5, GY - 4, 7, 4, rgba(C.steel, 0.25), 0.2);
  }
  function drawRail(g, lvl) {
    const yT = floorBottom(lvl), x1 = X1 + 1.5;
    g.fillStyle = C.rail;
    const posts = [TOWER0 + 0.1]; for (let x = X0 + 3; x < x1 - 2; x += 13) posts.push(x); posts.push(x1 - 0.5);
    for (const x of posts) g.fillRect(x, yT - 6.2, 0.5, 6.2);
    g.fillRect(TOWER0, yT - 6.2, x1 - TOWER0, 0.45); g.fillRect(TOWER0, yT - 3.2, x1 - TOWER0, 0.35);
    g.fillStyle = C.plank; g.fillRect(TOWER0, yT - 1, x1 - TOWER0, 1);
    g.lineWidth = 0.15; g.strokeStyle = C.ink; g.strokeRect(TOWER0, yT - 1, x1 - TOWER0, 1);
    for (const x of LAMPS) { box(g, x - 0.8, yT - 7.4, 1.6, 1.2, C.steelDark, 0.15); if (C.night > 0.3) { g.fillStyle = C.lamp; g.fillRect(x - 0.6, yT - 6.4, 1.2, 0.4); } }
    snowCap(g, TOWER0, yT - 6.2, x1 - TOWER0);
  }

  /* --------------------------------------------------------- finished floors */
  function litSet(fin) {
    const slots = [];
    for (let f = 0; f < fin; f++) for (let b = 0; b < NB; b++) if (winRect(f, b)) slots.push(f * 100 + b);
    slots.sort((p, q) => hash('w' + p) - hash('w' + q));
    return new Set(slots.slice(0, Math.max(0, T.windows_lit | 0)));
  }
  const lifeOf = (f, b) => hash('life' + f + ':' + b) % 6;
  function drawFloorDone(g, f, F, lit) {
    for (let b = 0; b < NB; b++) {
      const v = BAYS[b].vol;
      if (v === 'G') { drawGlaze(g, f, b, 1, false, 0, F); continue; }
      if (f === 0 && v === 'M') drawStorefront(g, b, 1);
      else for (let k = 0; k < 3; k++) drawWall(g, f, b, k, 1, F);
      drawGlaze(g, f, b, 1, lit.has(f * 100 + b), lifeOf(f, b), F);
    }
    if (f === 0) for (let m = 0; m < 4; m++) drawCanopy(g, m, 1);
  }
  function shellOutline(g, fin) {
    if (!fin) return;
    const top = floorBottom(fin), G = GB, [cx0] = CB;
    /* light from the upper left: a soft sheen on the west faces, shade on the east */
    if (C.night < 0.5) {
      const gr = g.createLinearGradient(X0, 0, X1, 0);
      gr.addColorStop(0, 'rgba(255,240,220,0.08)'); gr.addColorStop(0.5, 'rgba(255,240,220,0)'); gr.addColorStop(1, 'rgba(40,20,10,0.10)');
      g.fillStyle = gr; g.fillRect(X0, top, X1 - X0, GY - top);
    }
    g.fillStyle = rgba(C.ink, 0.35); g.fillRect(G.x, top, 0.7, GY - top);
    g.fillStyle = rgba(C.ink, 0.18); g.fillRect(BAYS[3].x - 0.4, top, 0.6, GY - top);
    for (let f = 1; f < fin; f++) { g.fillStyle = rgba(C.ink, 0.22); g.fillRect(X0, floorBottom(f) - 0.25, G.x - X0, 0.4); }
    g.lineWidth = 0.45; g.strokeStyle = C.ink;
    g.strokeRect(X0, top, G.x - X0, GY - top); g.strokeRect(cx0, top, X1 - cx0, GY - top);
  }
  /* the cutaway: the front comes off the finished floors; your part glows */
  let cutGlow = [];
  function drawCut(g, fin) {
    cutGlow = [];
    if (!fin) return;
    const items = [];
    for (let f = 0; f < fin; f++) {
      const top = floorBottom(f + 1), bot = floorBottom(f);
      for (let i = 0; i < LINES.length; i++) items.push({ k: 'post', f, x: f ? postX(i) : clamp(LINES[i] - 1.1, X0, X1 - 2.2), y: top + 1.4, w: f ? 1.6 : 2.2, h: bot - top - 1.4 });
      for (let b = 0; b < NB; b++) {
        const bay = BAYS[b];
        items.push({ k: 'beam', f, x: bay.x, y: top + 1.4, w: bay.w, h: 1.9 });
        items.push({ k: 'wire', f, x: bay.x + 0.6, y: top + 5, w: bay.w - 1.2, h: 0.45 });
        items.push({ k: 'pipe', f, x: bay.x + bay.w - 2, y: top + 3.4, w: 0.5, h: bot - top - 3.4 });
        items.push({ k: 'stud', f, x: bay.x + 3.2, y: top + 3.3, w: 0.42, h: bot - top - 3.3 });
      }
    }
    const order = items.map((_, i) => i).sort((p, q) => hash('y' + p) - hash('y' + q));
    const mine = new Set(order.slice(0, Math.min(items.length, Math.ceil(Math.max(0, yourMin) / 12))));
    for (let f = 0; f < fin; f++) {
      const top = floorBottom(f + 1), bot = floorBottom(f);
      const gr = g.createLinearGradient(0, top, 0, bot);
      gr.addColorStop(0, C.interiorDeep); gr.addColorStop(1, C.interior);
      g.fillStyle = gr; g.fillRect(X0, top, X1 - X0, bot - top);
      g.fillStyle = C.clt; g.fillRect(X0, top - 0.3, X1 - X0, 1.7);
      g.fillStyle = C.timberShade; g.fillRect(X0, top + 0.5, X1 - X0, 0.2);
      g.fillStyle = mix(C.steel, C.interior, 0.4); g.fillRect(X0 + 2, top + 3.4, X1 - X0 - 4, 1.1);   // a duct
    }
    items.forEach((it, i) => {
      const me = mine.has(i);
      if (me) { g.fillStyle = rgba(C.lamp, 0.3); g.fillRect(it.x - 0.8, it.y - 0.8, it.w + 1.6, it.h + 1.6); }
      g.fillStyle = me ? C.lamp : it.k === 'wire' ? C.copper : it.k === 'pipe' ? C.pipe : it.k === 'stud' ? mix(C.stud, C.interior, 0.4) : it.f === 0 && it.k === 'post' ? C.concrete : C.timber;
      g.fillRect(it.x, it.y, it.w, it.h);
    });
    g.lineWidth = 0.45; g.strokeStyle = C.ink; g.strokeRect(X0, floorBottom(fin), X1 - X0, GY - floorBottom(fin));
    for (const i of mine) { const it = items[i]; if (cutGlow.length < 12) cutGlow.push({ x: it.x + it.w / 2, y: it.y + it.h / 2, r: 6, a: 0.3, color: C.lamp }); }
  }

  /* --------------------------------------------------------- the cached layer */
  let lights = [];
  /* Two cached layers: the base (the ground once it's done, the finished floors, the roof, the
     scaffold) changes only when a floor finishes, the light changes or a post lights a window;
     the work strip (the floor going up, or the foundation) re-renders when a piece is finished. */
  function paintBase(g) {
    const s = st(), F = s.F;
    cols();
    const lit = litSet(s.fin);
    lights = [];
    g.lineCap = 'butt'; g.lineJoin = 'round';
    if (s.key !== 0) drawFoundation(g, () => true, true);
    if (cut) drawCut(g, s.fin);
    else { for (let f = 0; f < s.fin; f++) drawFloorDone(g, f, F, lit); shellOutline(g, s.fin); }
    if (s.key === 'top') drawRoof(g, F);
    if (s.key === 'top' && wreathsUp()) for (let m = 0; m < 4; m++) if (local.has('top:wreath' + m)) drawWreath(g, m, 1);
    if (s.scaffold) drawScaffold(g, s.work);
    /* night: every lit window is a little light */
    if (C.night > 0.3 && !cut) {
      for (const k of lit) {
        const f = Math.floor(k / 100), b = k % 100, r = winRect(f, b);
        if (r) lights.push({ x: r[0] + r[2] / 2, y: r[1] + r[3] / 2, r: 4 + r[2] * 0.5, a: 0.3, color: C.winLit });
      }
    }
    if (C.night > 0.3 && s.scaffold) for (const x of LAMPS) lights.push({ x, y: floorBottom(s.work) - 6, r: 22, a: 0.32, color: C.lampGlow });
    if (cut) for (const l of cutGlow) lights.push(l);
  }
  function paintWork(g) {
    const s = st(), done = (id) => s.done.has(id), F = s.F;
    cols();
    g.lineCap = 'butt'; g.lineJoin = 'round';
    if (s.key === 0) drawFoundation(g, done, [0, 1, 2, 3].every((q) => done('f0:backfill' + q)));
    if (s.key !== 'top') {
      const f = s.key;
      for (let b = 0; b < NB; b++) if (done('f' + f + ':deck' + b)) drawRoom(g, f, b);
      for (const p of s.list.drawOrder) if (p.rank >= 10 && p.rank < 30 && s.done.has(p.id)) drawPiece(g, p, 1, F);
      if (s.fin > 0) snowCap(g, X0, floorBottom(s.fin) - 0.2, X1 - X0);
    } else for (const p of s.list) if (p.part === 'solar' && s.done.has(p.id)) drawSolar(g, p.i, 1, F);
  }
  function workRegion() {
    const s = st(), x = X0 - 6, w = X1 - X0 + 9;
    if (s.key === 'top') { const y = floorBottom(s.F) - 6; return [x, y, w, 7]; }
    if (s.key === 0) { const y = floorBottom(1) - 3; return [LOT0 - 2, y, LOT1 - LOT0 + 4, GY + 13 - y]; }
    const y = floorBottom(s.key + 1) - 2;
    return [x, y, w, floorBottom(s.key) + 1 - y];
  }
  function drawPiece(g, p, a, F) {
    switch (p.part) {
      case 'clear': if (a < 1) drawClear(g, p.q, a); break;
      case 'stake': drawStake(g, p.s, a); break;
      case 'string': drawString(g, p.i, a); break;
      case 'dig': drawPit(g, p.b, a); break;
      case 'rebar': drawRebar(g, p.b, a); break;
      case 'form': drawForm(g, p.s, a); break;
      case 'pour': drawPour(g, p.b, a, true, false); break;
      case 'strip': if (a < 1) drawStrip(g, p.s, a); break;
      case 'backfill': drawBackfill(g, p.q, a); break;
      case 'column': drawColumn(g, p.i, a); break;
      case 'post': drawPost(g, p.floor, p.i, a); break;
      case 'beam': drawBeam(g, p.floor, p.b, a); break;
      case 'deck': drawDeck(g, p.floor, p.b, a); break;
      case 'stud': drawStuds(g, p.floor, p.b, a); break;
      case 'wire': drawWire(g, p.floor, p.b, a); break;
      case 'clad': case 'brick': drawWall(g, p.floor, p.b, p.k, a, F); break;
      case 'storefront': drawStorefront(g, p.b, a); break;
      case 'glaze': drawGlaze(g, p.floor, p.b, a, false, 0, F); break;
      case 'canopy': drawCanopy(g, p.m, a); break;
      case 'solar': drawSolar(g, p.i, a, F); break;
      case 'tree': drawTree(g, p.i, a); break;
      case 'planter': drawPlanter(g, p.i, a); break;
      case 'wash': drawWash(g, p.b, a); break;
      case 'sweep': drawDust(g, p.x + 3, p.y, a); break;
      case 'water': drawWater(g, p.x + 2, p.y - 8, p.tx, p.ty, a); break;
      case 'rake': drawLeaves(g, p.at[0], p.at[1], a); break;
      case 'snow': drawShoveled(g, p.i, a); break;
      case 'paint': drawPaint(g, p.px, a); break;
      case 'wreath': drawWreath(g, p.m, a); break;
      default:
    }
  }
  function region() {
    const F = floors(), y = floorBottom(F) - 40, x = BUILDING.towerX - 3;
    return [x, y, HOIST_X + 9 - x, GY + 13 - y];
  }
  /* pieces being worked on right now, drawn over the cache each frame: [piece, amount, alpha, ...] */
  const live = [];
  function liveList() {
    live.length = 0;
    const s = st();
    for (const [id, a] of partial) {
      const p = byId.get(id);
      if (p && p.floor === s.key && !s.done.has(id) && a > 0) live.push(p, a, claims.has(id) ? 1 : 0.55);
    }
    const tp = townPartial();
    if (tp) {
      const i = live.indexOf(tp.p);
      if (i >= 0) { if (tp.a > live[i + 1]) { live[i + 1] = tp.a; live[i + 2] = 1; } } else live.push(tp.p, tp.a, 1);
    }
    return live;
  }
  function draw(ctx) {
    const s = st();
    cols();
    const [x, y, w, h] = region();
    K.blit('building', x, y, w, h, paintBase, { ver: vBase });
    const r = workRegion();
    K.blit('building:work', r[0], r[1], r[2], r[3], paintWork, { ver: vWork });
    const L = liveList();
    for (let i = 0; i < L.length; i += 3) {
      const p = L[i];
      if (p.rank >= 30) continue;          // street trees and planters sort with people
      if (L[i + 2] < 1) ctx.globalAlpha = L[i + 2];
      drawPiece(ctx, p, L[i + 1], s.F);
      ctx.globalAlpha = 1;
    }
    if (s.key === 'top' && beamUp) drawFlag(ctx, s.F);
    for (let i = 0; i < lights.length; i++) K.lights.push(lights[i]);
  }

  /* depth-sorted things in front of people */
  const paintRail = (g) => { cols(); drawRail(g, st().work); };
  const railItem = { y: 0, draw: () => {
    const s = st(), yT = floorBottom(s.work);
    K.blit('building:rail', TOWER0 - 1, yT - 8.5, X1 + 5 - TOWER0, 9, paintRail, { ver: s.work });
  } };
  const paintStreet = (g) => {
    const s = st(); cols();
    if (C.snowy) for (const p of upkeep()) if (p.part === 'snow' && upDone.has(p.id) && t - upDone.get(p.id) < 1800) drawShoveled(g, p.i, 1);
    for (const p of s.list) if (p.rank >= 30 && s.done.has(p.id)) drawPiece(g, p, 1, s.F);
  };
  const streetItem = { y: GY + 8.5, draw: (ctx) => {
    const s = st();
    K.blit('building:street', LOT0 - 2, GY - 6, LOT1 - LOT0 + 4, 17, paintStreet, { ver: vWork });
    const L = liveList();
    for (let i = 0; i < L.length; i += 3) if (L[i].rank >= 30) { if (L[i + 2] < 1) ctx.globalAlpha = L[i + 2]; drawPiece(ctx, L[i], L[i + 1], s.F); ctx.globalAlpha = 1; }
  } };
  function collect(list) {
    const s = st();
    if (s.scaffold) { railItem.y = floorBottom(s.work) + 0.3; list.push(railItem); }
    if (s.key === 'top') list.push(streetItem);
  }

  function topY() {
    const s = st();
    if (s.key === 'top') return floorBottom(s.F) - 16;
    if (s.key === 0 && s.P < s.list.spans.column[0] && !s.list.some((p) => p.part === 'column' && (s.done.has(p.id) || partial.has(p.id)))) return GY - 14;
    return floorBottom(s.key + 1) - 2;
  }
  function levelY(level) { return level === 'ground' || level == null ? GY + 4 : floorBottom(+level); }
  function ladder() { const s = st(); return { x: LADDER_X, top: s.scaffold ? floorBottom(s.work) : GY + 4 }; }

  return {
    setTown, stage, jobs, needs, claim, release, work, complete, draw, collect, topY, levelY, ladder,
    cutaway(on, m) { const c = !!on, mm = Math.round(+m || 0); if (c !== cut || (c && mm !== yourMin)) { cut = c; yourMin = mm; ver++; vBase++; } },
    step(dt) { t += dt; if (!beamUp && toppedAt != null && t - toppedAt > 25) { beamUp = true; vBase++; } },
    hoist() { const s = st(); return s.scaffold ? { x: HOIST_X + 2.9, y: floorBottom(s.work) } : null; },
    liftTarget() {
      const key = st().key;
      for (const [id, c] of claims) {
        const p = byId.get(id);
        if (!p || !c.size || !LIFTED[p.part] || p.floor !== key) continue;
        if ((partial.get(id) || 0) < 0.8) return { x: p.at[0], y: p.at[1], id };
      }
      return null;
    },
    topBeam() { return { x: CB[0] + 13.5, y: floorBottom(floors()) - 4.1 }; },
    piece(id) { const p = byId.get(id); return p && p.floor === st().key ? view(p, 1) : null; },
    debugPieces: () => ({ local: local.size, open: jobs().length, ahead: ahead() }),
    debug: () => { const s = st(); return { key: s.key, P: s.P, done: s.done.size, of: s.list.length, local: local.size, ahead: ahead(), partial: partial.size, claims: claims.size, ver }; },
  };
}
