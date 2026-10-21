/* build-site-building.js — Watershed, from an empty fenced lot to topping
   out, and the jobs it needs next.

   Town hours map to stages. floors_done 0 with floor_progress 0..1 covers the
   beginning: survey stakes, excavation, rebar and forms, the foundation pour,
   then ground-floor framing. Each later floor is framed, wired, clad (rust
   panels, or brick on the corner) and glazed. topped_out puts the last beam
   and the little tree on the roof; then solar panels and street trees.

   The work on screen can run a little ahead of the town's hours (the crew
   you're watching finishes real pieces), up to a cap; the town's numbers stay
   the truth, and local pieces are kept on this phone.

   INTERFACE:
     createBuilding(K) -> {
       setTown(T)                     T = K.S.town
       cutaway(on, yourMinutes)
       stage() -> { phase, floor, progress, label }    phase: 'lot'|'stakes'|'dig'|'rebar'|'pour'|'cure'|'frame'|'finish'
       jobs() -> [job]                open jobs, in the order the building needs them. job = {
                                        id, kind, x, y (feet where a worker stands), level ('ground' | floor index
                                        to climb to), needs (material to bring, or null), crew (1, or 2 for a pane),
                                        dur (seconds of work), label ('framing the 2nd floor'), cell }
                                      kinds: stake, dig, rebar, form, pour, frame, deck, wire, brick, clad, glaze, solar, plant
                                      needs: stakes, shovel, rebar, formwork, beam, panel, bricks, spool, pane, null
       claim(id, who) -> bool; release(id)
       work(id, amount 0..1)          partial progress you can see (a course half laid)
       complete(id) -> bool           the piece is done and stays
       topY()                         the top of the work (camera, climbing)
       levelY(level)                  feet y on that level (ground = GROUND_Y + 4)
       ladder() -> { x, top }         where workers climb
       draw(ctx)                      the structure (cache with K.blit, ver bumps on change)
       collect(list)                  depth-sorted bits in front of people (scaffold rails), optional
       step(dt)
     }
     emits K.emit('milestone', { kind: 'pour'|'floor'|'topped', floor, x, y }) when the town crosses one.
   THIS FILE IS A STUB from the v2 kernel (simple shapes, the full job model).
   The building helper replaces the drawing and deepens the stages. */

import { GROUND_Y, BUILDING, BAYS, floorBottom, floorHeight, clamp, hash } from './build-site-shared.js';

const NB = BAYS.length;
const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];
const LOCAL_CAP = 14;          // pieces the crew on screen may finish ahead of the town's hours
const KEY = 'bd-site-v2-pieces';

/* the foundation stages inside floors_done 0, as slices of floor_progress */
const FOUNDATION = [['stakes', 0.08], ['dig', 0.22], ['rebar', 0.34], ['pour', 0.42], ['cure', 0.48]];

export function createBuilding(K) {
  let T = K.S.town;
  let ver = 1;
  const local = new Set();     // ids completed on this phone, ahead of the town
  const claims = new Map();
  const partial = new Map();
  let cut = false, yourMin = 0;
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && Array.isArray(v.ids)) v.ids.forEach((i) => local.add(i)); } catch (e) { /* storage blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ ids: [...local] })); } catch (e) { /* fine */ } };

  const floors = () => clamp(T.floors | 0 || BUILDING.floors, 2, 12);
  const topped = () => !!T.topped_out || T.floors_done >= floors();
  function stage() {
    if (topped()) return { phase: 'finish', floor: floors(), progress: 1, label: 'topped out' };
    const f = clamp(T.floors_done | 0, 0, floors() - 1), p = T.floor_progress || 0;
    if (f === 0) {
      let a = 0;
      for (const [name, b] of FOUNDATION) { if (p < b) return { phase: name, floor: 0, progress: (p - a) / (b - a), label: name }; a = b; }
      return { phase: 'frame', floor: 0, progress: (p - 0.48) / 0.52, label: 'the ground floor' };
    }
    return { phase: 'frame', floor: f, progress: p, label: 'the ' + ORD[f + 1] + ' floor' };
  }
  /* all the pieces of the current stage, in build order */
  function pieces() {
    const s = stage(), out = [];
    const gy = GROUND_Y + 4;
    if (s.phase === 'finish') {
      for (let i = 0; i < 12; i++) out.push({ id: 'solar' + i, kind: 'solar', x: BUILDING.x0 + 8 + i * 8, y: floorBottom(floors()), level: floors(), needs: 'pane', crew: 1, dur: 14, label: 'laying solar panels on the roof' });
      for (let i = 0; i < 6; i++) out.push({ id: 'tree' + i, kind: 'plant', x: BUILDING.x0 + 6 + i * 20, y: gy + 26, level: 'ground', needs: 'shovel', crew: 1, dur: 16, label: 'planting street trees' });
      return out;
    }
    if (s.phase !== 'frame') {
      const kind = { stakes: 'stake', dig: 'dig', rebar: 'rebar', pour: 'pour', cure: 'form' }[s.phase];
      const needs = { stake: 'stakes', dig: 'shovel', rebar: 'rebar', pour: null, form: null }[kind];
      const label = { stake: 'staking out the lot', dig: 'digging the foundation', rebar: 'tying rebar for the footings', pour: 'pouring the foundation', form: 'stripping the forms' }[kind];
      for (let b = 0; b < NB; b++) out.push({ id: kind + b, kind, x: BAYS[b].cx, y: gy + 2, level: 'ground', needs, crew: 1, dur: 12, label });
      return out;
    }
    const f = s.floor, lv = f === 0 ? 'ground' : f, y = f === 0 ? gy : floorBottom(f);
    const nth = s.label;
    for (let b = 0; b < NB; b++) out.push({ id: f + ':frame' + b, kind: 'frame', x: BAYS[b].cx, y, level: lv, needs: f === 0 ? 'beam' : 'panel', crew: 1, dur: 16, label: 'framing ' + nth, cell: b });
    for (let b = 0; b < NB; b++) out.push({ id: f + ':wire' + b, kind: 'wire', x: BAYS[b].cx, y, level: lv, needs: 'spool', crew: 1, dur: 14, label: 'running wire on ' + nth, cell: b, after: f + ':frame' + b });
    for (let b = 0; b < NB; b++) {
      const brick = BAYS[b].vol === 'C';
      for (let k = 0; k < 3; k++) out.push({ id: f + ':wall' + b + '.' + k, kind: brick ? 'brick' : 'clad', x: BAYS[b].cx, y, level: lv, needs: brick ? 'bricks' : 'panel', crew: 1, dur: 16, label: (brick ? 'laying brick on ' : 'cladding ') + nth, cell: b, after: k ? f + ':wall' + b + '.' + (k - 1) : f + ':wire' + b });
    }
    for (let b = 0; b < NB; b++) if (BAYS[b].vol !== 'G') out.push({ id: f + ':glaze' + b, kind: 'glaze', x: BAYS[b].cx, y, level: lv, needs: 'pane', crew: 2, dur: 14, label: 'setting windows on ' + nth, cell: b, after: f + ':wall' + b + '.2' });
    return out;
  }
  function baselineCount(list) { return Math.floor(clamp(stage().progress, 0, 1) * list.length); }
  function doneSet() {
    const list = pieces(), n = baselineCount(list), s = new Set();
    list.forEach((p, i) => { if (i < n || local.has(p.id)) s.add(p.id); });
    return s;
  }
  function jobs() {
    const list = pieces(), d = doneSet();
    const ahead = list.filter((p, i) => i >= baselineCount(list) && local.has(p.id)).length;
    if (ahead >= LOCAL_CAP) return [];
    return list.filter((p) => !d.has(p.id) && (!p.after || d.has(p.after)) && !claims.has(p.id));
  }
  function complete(id) {
    if (local.has(id)) return false;
    local.add(id); claims.delete(id); partial.delete(id); ver++; save();
    K.emit('piece', { id });
    return true;
  }
  let lastStage = null;
  function setTown(t) {
    const before = stage();
    T = t; ver++;
    const after = stage();
    if (lastStage) {
      if (before.phase !== 'pour' && after.phase === 'cure' && after.floor === 0) K.emit('milestone', { kind: 'pour', floor: 0, x: (BUILDING.x0 + BUILDING.x1) / 2, y: GROUND_Y });
      if (after.floor > before.floor && !topped()) K.emit('milestone', { kind: 'floor', floor: after.floor, x: (BUILDING.x0 + BUILDING.x1) / 2, y: floorBottom(after.floor) });
      if (!lastStage.topped && topped()) K.emit('milestone', { kind: 'topped', floor: floors(), x: (BUILDING.x0 + BUILDING.x1) / 2, y: floorBottom(floors()) });
    }
    lastStage = { ...after, topped: topped() };
    /* drop local pieces from stages already passed */
    const ids = new Set(pieces().map((p) => p.id));
    for (const i of [...local]) if (!ids.has(i)) local.delete(i);
  }
  function draw(ctx) {
    const s = stage(), d = doneSet();
    const builtTo = s.phase === 'finish' ? floors() : s.phase === 'frame' ? s.floor : 0;
    K.blit('building', BUILDING.x0 - 12, floorBottom(floors()) - 30, BUILDING.x1 - BUILDING.x0 + 24, GROUND_Y - floorBottom(floors()) + 46, (g) => {
      g.fillStyle = K.pal.concreteShade; g.fillRect(BUILDING.x0 - 2, GROUND_Y, BUILDING.x1 - BUILDING.x0 + 4, 3);
      for (let f = 0; f < builtTo; f++) {
        for (const b of BAYS) { g.fillStyle = b.vol === 'C' ? K.pal.brick : b.vol === 'G' ? K.pal.glassDark : f === floors() - 1 ? K.pal.charcoal : K.pal.rust; g.fillRect(b.x, floorBottom(f + 1), b.w, floorHeight(f)); if (b.vol !== 'G') { g.fillStyle = K.pal.glass; g.fillRect(b.x + 3, floorBottom(f + 1) + 3, 5, 7); } }
      }
      if (s.phase === 'frame') {
        const f = s.floor;
        for (const b of BAYS) {
          const id = (k) => f + ':' + k;
          if (d.has(id('frame' + b.i))) { g.fillStyle = f ? K.pal.timber : K.pal.concrete; g.fillRect(b.x, floorBottom(f + 1), 1, floorHeight(f)); g.fillRect(b.x, floorBottom(f + 1), b.w, 1.5); }
          for (let k = 0; k < 3; k++) if (d.has(id('wall' + b.i + '.' + k))) { g.fillStyle = b.vol === 'C' ? K.pal.brick : K.pal.rust; const h = floorHeight(f) / 3; g.fillRect(b.x, floorBottom(f) - (k + 1) * h, b.w, h); }
          if (d.has(id('glaze' + b.i))) { g.fillStyle = K.pal.glass; g.fillRect(b.x + 3, floorBottom(f + 1) + 3, 5, 7); }
        }
      } else {
        g.fillStyle = K.pal.dirtDark;
        const k = { stakes: 0, dig: 1, rebar: 2, pour: 3, cure: 4 }[s.phase];
        if (k >= 1) g.fillRect(BUILDING.x0, GROUND_Y, BUILDING.x1 - BUILDING.x0, 4);
        if (k >= 4) { g.fillStyle = K.pal.concrete; g.fillRect(BUILDING.x0, GROUND_Y - 1, BUILDING.x1 - BUILDING.x0, 4); }
        for (const p of pieces()) if (d.has(p.id)) { g.fillStyle = s.phase === 'stakes' ? K.pal.netting : s.phase === 'rebar' ? K.pal.rebar : K.pal.concrete; g.fillRect(p.x - 1, GROUND_Y - 3, 2, 4); }
      }
      if (s.phase === 'finish') { g.fillStyle = K.pal.evergreen; const x = BAYS[9].cx, y = floorBottom(floors()); g.beginPath(); g.moveTo(x, y - 12); g.lineTo(x - 4, y - 2); g.lineTo(x + 4, y - 2); g.fill(); }
    }, { ver: ver + (cut ? 1e6 : 0) });
  }
  return {
    setTown, stage, jobs, complete, draw,
    cutaway(on, m) { cut = on; yourMin = m; ver++; void yourMin; },
    claim(id, who) { if (claims.has(id)) return false; claims.set(id, who); return true; },
    release(id) { claims.delete(id); },
    work(id, a) { partial.set(id, a); },
    topY() { const s = stage(); return floorBottom(s.phase === 'finish' ? floors() : s.phase === 'frame' ? s.floor + 1 : 0) - (s.phase === 'frame' ? 0 : 10); },
    levelY(level) { return level === 'ground' ? GROUND_Y + 4 : floorBottom(level); },
    ladder() { const s = stage(); return { x: BUILDING.towerX + 3, top: floorBottom(s.phase === 'finish' ? floors() : s.phase === 'frame' ? s.floor : 0) }; },
    collect() {}, step() {},
    debugPieces: () => ({ local: local.size, open: jobs().length }),
  };
  void hash;
}
