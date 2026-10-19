/* forest.js — a habit's tree, drawn from its own taps.

   Stephen, 2026-10-19: "people add a habit and then a tree or branch
   appears. Then as they check off the habit that day another leaf grows."
   So: a habit is a tree. Every day it was done is one leaf. A streak that
   reaches a milestone leaves a flower that stays.

   The tree is generated, never stored: its shape comes from a seed (a hash
   of the habit's id), its size and leaves from how many days it was done in
   the last 370 (the same window the tab loads), and its flowers from the
   best streak in that window. Same three numbers, same tree, wherever it is
   drawn: your Today, the habit's sheet, or someone else's phone looking at
   your shared forest (sz_forest_tree in supabase/sz-FOREST.sql works the
   numbers out on the server with the same rules; scripts/test-sz-forest.mjs
   checks the two agree).

   Leaf k always sits in the same spot, so a tap adds exactly one leaf and
   moves nothing else; the whole tree grows a little with each leaf, up to
   full size at LEAF_FULL. No DOM here: tree() returns SVG markup, coloured
   by classes (app.css .tr-*), so it can be tested in node. */

import { HABIT_RULES, addDays, isKey } from './habits-core.js';

/* the window the leaves are counted over: the history the tab loads */
export const LEAF_DAYS = HABIT_RULES.limits.tapsRangeMaxDays;
const LEAF_FULL = 120;         // leaves at which a tree reaches full size
/* flowers: a streak milestone each, counted in the habit's own unit */
export const BLOOMS_DAYS = [7, 21, 50, 100, 200, 300];
export const BLOOMS_WEEKS = [2, 4, 8, 16, 26, 40];

/* What a share may carry: the same limits sz_forest_set checks. */
export const FOREST_RULES = { nameMax: 32, cohortMax: 32, treesMax: 100, treesShown: 24, galleryMax: 40 };

/* ----------------------------------------------------------------- seeds */
/* FNV-1a, 32 bits, over the id as text. sz_forest_seed() is the same sum. */
export function seedOf(id) {
  const s = String(id == null ? '' : id);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ (s.charCodeAt(i) & 0xff), 16777619) >>> 0;
  return h >>> 0;
}
/* mulberry32: a small, steady random stream from a seed */
function stream(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------- numbers */
/* Days done in the window that ends today: the leaves. */
export function leavesOf(taps, today) {
  const from = addDays(today, -(LEAF_DAYS - 1));
  let n = 0;
  for (const k of taps instanceof Set ? taps : new Set(taps || [])) if (isKey(k) && k >= from && k <= today) n++;
  return n;
}
/* The flowers a best streak has earned. */
export function bloomsOf(frequency, best) {
  const marks = frequency === 'n_per_week' ? BLOOMS_WEEKS : BLOOMS_DAYS;
  return marks.filter((m) => best >= m).length;
}
/* the taps inside the window, for streaks that must agree with the server's */
export function inWindow(taps, today) {
  const from = addDays(today, -(LEAF_DAYS - 1));
  return new Set([...(taps instanceof Set ? taps : new Set(taps || []))].filter((k) => isKey(k) && k >= from && k <= today));
}

/* -------------------------------------------------------------- the shape */
/* A grown tree, in its own units: the trunk starts at (0, 0) and grows up
   (negative y). Branches are listed in the order they appear (inner first);
   leaf slots in the order leaves arrive. Worked out once per seed. */
const MAX_DEPTH = 4;
const SLOTS_MIN = LEAF_DAYS + 10;
const shapes = new Map();
function shape(seed) {
  if (shapes.has(seed)) return shapes.get(seed);
  const R = stream(seed);
  const branches = [];
  const trunk = { depth: 0, parent: -1, at: 0, angle: -Math.PI / 2 + (R() - 0.5) * 0.16, len: 34 + R() * 8, bend: (R() - 0.5) * 0.25 };
  branches.push(trunk);
  /* breadth first, so a tree fills out from the trunk outwards */
  for (let i = 0; i < branches.length; i++) {
    const b = branches[i];
    if (b.depth >= MAX_DEPTH) continue;
    const kids = b.depth === 0 ? 3 + (R() < 0.5 ? 1 : 0) : 2 + (R() < 0.4 ? 1 : 0);
    let side = R() < 0.5 ? 1 : -1;
    for (let k = 0; k < kids; k++) {
      /* one child carries on roughly straight: the leader */
      const leader = k === kids - 1;
      const at = leader ? 1 : (b.depth === 0 ? 0.42 : 0.35) + (1 - (b.depth === 0 ? 0.42 : 0.35)) * ((k + 0.3 + R() * 0.5) / kids);
      const spread = leader ? (R() - 0.5) * 0.35 : side * (0.42 + R() * 0.42);
      side = -side;
      branches.push({ depth: b.depth + 1, parent: i, at, angle: b.angle + spread, len: b.len * (leader ? 0.62 + R() * 0.12 : 0.56 + R() * 0.2), bend: (R() - 0.5) * 0.4 });
    }
  }
  /* where every branch starts and ends, grown */
  branches.forEach((b) => {
    const p = b.parent < 0 ? { x0: 0, y0: 0, x1: 0, y1: 0 } : branches[b.parent];
    b.x0 = b.parent < 0 ? 0 : p.x0 + (p.x1 - p.x0) * b.at;
    b.y0 = b.parent < 0 ? 0 : p.y0 + (p.y1 - p.y0) * b.at;
    b.x1 = b.x0 + Math.cos(b.angle) * b.len;
    b.y1 = b.y0 + Math.sin(b.angle) * b.len;
  });
  /* leaf slots: along the outer part of every branch past the trunk, more on
     a longer one, and one at each tip. A slot's arrival order mixes nearby
     branches, so leaves come in all over the crown, inner branches first. */
  const slots = [];
  const leaf = (j, t, a) => slots.push({ branch: j, t, a, size: 0.85 + R() * 0.3, shade: R() < 0.5 ? 0 : R() < 0.6 ? 1 : 2, order: j + R() * 9 });
  branches.forEach((b, j) => {
    if (b.depth === 0) return;
    const n = Math.max(2, Math.round(b.len / (b.depth >= 3 ? 1.9 : 2.8)));
    for (let s = 0; s < n; s++) {
      const tip = s === n - 1;
      const side = s % 2 ? 1 : -1;
      leaf(j, tip ? 1 : 0.3 + 0.7 * ((s + R() * 0.6) / n), b.angle + (tip ? (R() - 0.5) * 0.5 : side * (0.55 + R() * 0.55)));
    }
  });
  /* never fewer slots than the window holds days: top up the outer twigs */
  const twigs = branches.map((b, j) => j).filter((j) => branches[j].depth >= 2);
  for (let i = 0; slots.length < SLOTS_MIN; i++) {
    const j = twigs[i % twigs.length];
    leaf(j, 0.25 + 0.7 * R(), branches[j].angle + (R() < 0.5 ? 1 : -1) * (0.4 + R() * 0.8));
  }
  slots.sort((x, y) => x.order - y.order);
  /* the first leaf on each branch is when it appears */
  const firstLeaf = branches.map(() => Infinity);
  slots.forEach((s, k) => { for (let j = s.branch; j >= 0; j = branches[j].parent) if (k < firstLeaf[j]) firstLeaf[j] = k; });
  firstLeaf[0] = -1;
  /* how far it reaches when grown, to fit the box */
  let w = 1, h = 1;
  branches.forEach((b) => { w = Math.max(w, Math.abs(b.x1) + 7, Math.abs(b.x0)); h = Math.max(h, -b.y1 + 7); });
  /* flower spots: the tips of the smaller branches, in a fixed order */
  const tips = branches.map((b, j) => ({ j, k: R() })).filter((x) => branches[x.j].depth >= 2).sort((a, b) => a.k - b.k).map((x) => x.j);
  const out = { branches, slots, firstLeaf, w, h, tips };
  if (shapes.size > 300) shapes.clear();
  shapes.set(seed, out);
  return out;
}
/* every leaf the window can hold has a slot */
export const slotsOf = (seed) => shape(seed).slots.length;

/* ---------------------------------------------------------------- drawing */
const VW = 100, VH = 110, GROUND = 102;
const f1 = (n) => (Math.round(n * 10) / 10).toString();
const WIDTH = [4.4, 2.7, 1.7, 1.1, 0.75];

/* One tree as SVG markup.
     seed     seedOf(habit id), or a shared tree's seed from the server
     leaves   days done in the window (leavesOf)
     blooms   flowers earned (bloomsOf)
     opts.label   the accessible name (escaped here)
     opts.fresh   the newest leaf grows in (a tap just now)
     opts.whole   keep the full-grown box instead of one cropped to the tree,
                  for rows drawn at a fixed height (the gallery)
   Beyond the slots the shape has, extra leaves change nothing you can see
   but the count; a shape has well over LEAF_DAYS slots, so that never
   happens inside the window. */
export function tree(seed, leaves, blooms, opts = {}) {
  const S = shape(seed >>> 0);
  const L = Math.max(0, Math.min(S.slots.length, Math.floor(Number(leaves) || 0)));
  const F = Math.max(0, Math.min(6, Math.floor(Number(blooms) || 0)));
  /* grows with its leaves: a sapling at none, full size at LEAF_FULL */
  const grow = 0.5 + 0.5 * Math.min(1, Math.sqrt(L / LEAF_FULL));
  const fit = Math.min((VW / 2 - 3) / S.w, (GROUND - 4) / S.h);
  const k = fit * grow;
  const X = (x) => VW / 2 + x * k, Y = (y) => GROUND + y * k;
  /* the highest thing drawn, so the box can start just above it: a young
     tree stands in a short box, at the same scale as a grown one */
  let top = GROUND - 20;
  const up = (y) => { if (y < top) top = y; return y; };
  const visible = (j) => S.firstLeaf[j] < L;
  /* wood: one path per thickness, each branch a gentle curve */
  const wood = WIDTH.map(() => []);
  S.branches.forEach((b, j) => {
    if (!visible(j)) return;
    const mx = (b.x0 + b.x1) / 2 - Math.sin(b.angle) * b.len * b.bend * 0.25, my = (b.y0 + b.y1) / 2 + Math.cos(b.angle) * b.len * b.bend * 0.25;
    wood[b.depth].push('M' + f1(X(b.x0)) + ' ' + f1(Y(b.y0)) + 'Q' + f1(X(mx)) + ' ' + f1(Y(my)) + ' ' + f1(X(b.x1)) + ' ' + f1(up(Y(b.y1))));
  });
  /* leaves: an almond each, base on the branch, in three greens */
  const shades = [[], [], []];
  let fresh = '';
  const leafLen = 6.2 * Math.max(0.8, Math.min(1.15, 1.25 - L / 600));
  for (let i = 0; i < L; i++) {
    const s = S.slots[i], b = S.branches[s.branch];
    const bx = b.x0 + (b.x1 - b.x0) * s.t, by = b.y0 + (b.y1 - b.y0) * s.t;
    const len = leafLen * s.size * (0.75 + 0.25 * grow);
    const px = X(bx), py = Y(by);
    const qx = px + Math.cos(s.a) * len, qy = up(py + Math.sin(s.a) * len);
    const nx = -Math.sin(s.a) * len * 0.36, ny = Math.cos(s.a) * len * 0.36;
    const mx = (px + qx) / 2, my = (py + qy) / 2;
    const d = 'M' + f1(px) + ' ' + f1(py) + 'Q' + f1(mx + nx) + ' ' + f1(my + ny) + ' ' + f1(qx) + ' ' + f1(qy) + 'Q' + f1(mx - nx) + ' ' + f1(my - ny) + ' ' + f1(px) + ' ' + f1(py) + 'Z';
    if (opts.fresh && i === L - 1) fresh = '<path class="tr-l' + s.shade + ' tr-new" style="transform-origin:' + f1(px) + 'px ' + f1(py) + 'px" d="' + d + '"/>';
    else shades[s.shade].push(d);
  }
  /* flowers: five petals and a middle, at the tips of grown branches */
  let flowers = '';
  const spots = S.tips.filter(visible).slice(0, F);
  spots.forEach((j) => {
    const b = S.branches[j];
    const cx = X(b.x1), cy = Y(b.y1), r = 1.7 * (0.8 + 0.4 * grow);
    up(cy - 2 * r);
    let petals = '';
    for (let p = 0; p < 5; p++) {
      const a = p * 1.2566 + b.angle;
      petals += '<circle cx="' + f1(cx + Math.cos(a) * r) + '" cy="' + f1(cy + Math.sin(a) * r) + '" r="' + f1(r) + '"/>';
    }
    flowers += '<g class="tr-pet">' + petals + '</g><circle class="tr-eye" cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + f1(r * 0.7) + '"/>';
  });
  /* a bud on the sapling's tip until it has a few leaves */
  const t0 = S.branches[0];
  const bud = L < 3 ? '<circle class="tr-l0" cx="' + f1(X(t0.x1)) + '" cy="' + f1(Y(t0.y1)) + '" r="' + f1(2.2) + '"/>' : '';
  const label = opts.label ? ' role="img" aria-label="' + String(opts.label).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]) + '"' : ' aria-hidden="true"';
  const y0 = opts.whole ? 0 : Math.max(0, Math.floor(top - 5));
  return '<svg class="tree" viewBox="0 ' + y0 + ' ' + VW + ' ' + (VH - y0) + '"' + label + ' focusable="false">' +
    '<ellipse class="tr-ground" cx="50" cy="' + (GROUND + 1) + '" rx="' + f1(16 + 20 * grow) + '" ry="3.2"/>' +
    WIDTH.map((w, d) => (wood[d].length ? '<path class="tr-wood" stroke-width="' + f1(w * (0.55 + 0.45 * grow)) + '" d="' + wood[d].join('') + '"/>' : '')).join('') +
    bud +
    shades.map((list, i) => (list.length ? '<path class="tr-l' + i + '" d="' + list.join('') + '"/>' : '')).join('') +
    fresh + flowers + '</svg>';
}

/* The words for a tree: "21 leaves, 1 flower". */
export function treeWords(leaves, blooms) {
  return leaves + (leaves === 1 ? ' leaf' : ' leaves') + (blooms ? ', ' + blooms + (blooms === 1 ? ' flower' : ' flowers') : '');
}

/* A ghost sapling for a forest with no trees yet. */
export function emptyPlot() {
  return '<svg class="tree tr-ghost" viewBox="0 ' + (GROUND - 30) + ' ' + VW + ' ' + (VH - GROUND + 30) + '" aria-hidden="true" focusable="false">' +
    '<ellipse class="tr-ground" cx="50" cy="' + (GROUND + 1) + '" rx="22" ry="3.2"/>' +
    '<path class="tr-wood" stroke-width="2.2" d="M50 ' + GROUND + 'Q49 ' + (GROUND - 9) + ' 50 ' + (GROUND - 16) + '"/>' +
    '<path class="tr-l0" d="M50 ' + (GROUND - 14) + 'Q44 ' + (GROUND - 20) + ' 41 ' + (GROUND - 18) + 'Q45 ' + (GROUND - 13) + ' 50 ' + (GROUND - 14) + 'Z"/>' +
    '<path class="tr-l1" d="M50 ' + (GROUND - 15) + 'Q56 ' + (GROUND - 22) + ' 59 ' + (GROUND - 20) + 'Q55 ' + (GROUND - 14) + ' 50 ' + (GROUND - 15) + 'Z"/></svg>';
}

/* A share before it is sent: { ok, forest } or { ok: false, error }, the
   same checks in the same order as sz_forest_set. */
export function checkForest(input, clean) {
  const name = clean(input && input.name);
  if (!name || name.length > FOREST_RULES.nameMax || name.includes('@')) return { ok: false, error: 'bad_forest_name' };
  const cohort = clean(input && input.cohort);
  if (cohort.length > FOREST_RULES.cohortMax) return { ok: false, error: 'bad_cohort' };
  const habits = Array.isArray(input && input.habits) ? [...new Set(input.habits.map(String))] : null;
  if (habits && habits.length > FOREST_RULES.treesMax) return { ok: false, error: 'bad_forest' };
  return { ok: true, forest: { name, public: !!(input && input.public), show_names: !!(input && input.show_names), habits, cohort: cohort || null } };
}
