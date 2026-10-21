/* build-site-crew.js — the people and machines on the site, and the work.

   Every builder on shift (you and each neighbour) is always in the middle of
   a real, multi-step job the building actually needs next: fetch the
   material from its zone, prepare it there (measure and cut a joist, mix
   mortar), carry it over (a beam on the shoulder, a wheelbarrow of bricks,
   two people walking a pane of glass), climb, set it, fasten it. Each step
   reads at a glance and the finished piece stays on the building.

   INTERFACE:
     createCrew(K) -> {
       setCrew(list)            [{ id, look, task, name? }] neighbours on shift (task is a preference)
       setYou(you)              { state: working|paused|off|away, look, task, name? }
       whistle(on)              the foreman steps out of the trailer and raises a hand / nods and goes back in
       deliver(kind)            a material delivery (truck or forklift) for dropMaterial
       step(dt)
       collect(list)            push { y, draw } for every figure and vehicle
       drawTags(ctx, followId)  name tags over heads (small, quiet; the followed one shows its job)
       youPos() -> {x, y}|null  your builder's feet, null when not on site
       posOf(id) -> {x, y}|null 'you' or a neighbour's id
       hit(x, y) -> { id, name, me }|null   who is under a tap
       info(id) -> { id, name, job }        job in plain words: the step they're on
                                            ('cutting a joist at the lumber yard'), else the job
                                            ('framing the 2nd floor'). v2 adds { work, me }: work = the job's label
       count(), debug()
       For the director (ambient life; never interrupt a job in progress):
       idle() -> [agent ids between jobs or on a break]
       borrow(id, actions, onDone) -> bool  run a short scripted errand when the agent is between steps
       actions: { k:'goto', x, y, level? } { k:'pose', pose, dur, carry? } { k:'face', dir } { k:'emote', icon, dur } { k:'wait', dur }
     }
   Added in v2 (optional for the kernel and the world):
       drawStreet(ctx)          what's on Lakeside Ave below the fence line (trucks pulling in, builders
                                walking out the gate). World's drawFront should call it right after the
                                street surface; if nothing does, drawTags draws it first so it still shows.
       crane() -> { x, y, hookY, load, phase }   the crane's trolley and hook (director, tests)
     Events: K.emit('crew:done', { id, job, kind }) when a builder finishes a piece;
             K.emit('crew:topbeam', { x, y }) when the crane sets the last beam at topping out.

   How the work runs. Each builder keeps a queue of small actions (goto, do a
   pose for a while, wait for something, sync with a partner). plan() picks
   the next job from K.building.jobs() (their task preference first, near
   their own stretch of the building so the crew spreads out), claims it,
   and expands it into a chain of steps for its kind (CHAINS below). Every
   step sets a plain-language line (a.say) that info() and the follow tag
   show. Shared things are resources with tiny state machines: the tower
   crane, the material hoist by the stair tower, the wheelbarrow, the mortar
   mixer, the saw and trestle stations, the mixer truck, the delivery truck
   and the forklift (driven by the yard hand, a figure with no name tag), the
   excavator. */

import { GROUND_Y, ZONES, BUILDING, BAYS, EMIT, SITE_TASKS, colorsFor, hash, rng, clamp, lerp } from './build-site-shared.js';
import * as ART from './build-site-art.js';

const WALK = 11.5, CLIMB = 8, LADDER_GAP = 14;   // a climber keeps a body and a name tag's length behind the one ahead
const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];
const spot = (z, s) => ZONES[z].spots[s];
/* where each material is kept (the world's piles) */
const PILE_AT = { lumber: ['lumber', 'rack'], panels: ['lumber', 'panels'], brick: ['masonry', 'bricks'], glass: ['staging', 'drop2'], copper: ['tools', 'spools'],
  nails: ['staging', 'nails'], stakes: ['tools', 'stakes'], rebar: ['staging', 'drop'] };
const NEED_PILE = { beam: 'lumber', panel: 'panels', formwork: 'lumber', bricks: 'brick', pane: 'glass', spool: 'copper', rebar: 'rebar', stakes: 'stakes' };
const NEED_CARRY = { beam: 'beam', panel: 'panel', formwork: 'beam', bricks: 'bricks', pane: 'pane', spool: 'spool', rebar: 'rebar', stakes: 'stakes', shovel: 'shovel' };
/* tools a builder keeps between jobs of the same kind, and where they go back */
const TOOL_HOME = { shovel: ['tools', 'shed'], spool: ['tools', 'spools'], toolbox: ['tools', 'shed'], clipboard: ['office', 'step'], mallet: ['tools', 'stakes'], bucket: ['tools', 'shed'] };
const PLACE = { lumber: 'the lumber yard', masonry: 'the brick yard', staging: 'the staging area', tools: 'the toolshed' };
const HEAVY = { beam: 1, panel: 1, barrow: 1, rebar: 1, paneL: 1, paneR: 1, pane: 1, bricks: 1 };
/* task preference -> job kinds they reach for first */
const PREF = { frame: ['post', 'beam', 'deck', 'stud', 'form', 'stake', 'canopy', 'frame'], brick: ['brick', 'pour', 'column', 'dig'],
  wire: ['wire', 'rebar', 'string'], window: ['glaze', 'storefront', 'clad'], roof: ['solar', 'deck', 'beam', 'clad'],
  haul: ['rebar', 'dig', 'clear', 'backfill', 'strip', 'tree', 'planter'], lunch: [] };
const EARLY = { lot: 1, stakes: 1, dig: 1, rebar: 1, pour: 1, cure: 1 };
const NO_CRANE = { lot: 1, stakes: 1, dig: 1, rebar: 1, pour: 1 };   // the tower crane goes up during cure
const FACE_YOU = { look: 1, cheer: 1, wave: 1, sitbeam: 1 };
/* names art may not draw yet, and what to show meanwhile (dropped when art exports POSES_DRAWN / CARRY_DRAWN) */
const POSE_FALLBACK = {};      // art draws jackhammer, ride, rustPanel, solar and mallet now
const CARRY_FALLBACK = {};
const SIT = { sit: 1, sitbeam: 1, kneel: 1, crouch: 1 };
const FOREMAN_COLORS = { hat: '#f4f1e8', vest: '#ff8a2a', skin: '#ffdbac', hair: '#8a8a8a' };
const DRIVER_COLORS = { hat: '#3d7bd9', vest: '#f5e23a', skin: '#c68642', hair: '#1f1a17' };
const CRANE_TIP = 296, CRANE_TAIL = 590;
const PARK_FORK = [172, 489], PARK_EXC = [596, 490];
const MIX_Y = GROUND_Y + 24;     // the mixer truck works along the front of the pad
const SAPLINGS = [[582, 477], [588, 479], [594, 477]];
const EMPTY = {};

export function createCrew(K) {
  const agents = new Map();
  const R = rng(hash('crew') ^ ((Date.now() / 1000) & 0xffff));
  const artProps = Array.isArray(ART.PROPS) ? ART.PROPS : [];
  const hasProp = (n) => artProps.includes(n);
  const B = () => K.building;
  const stage = () => (B().stage ? B().stage() : { phase: 'frame', floor: 0 });
  const floorsN = () => clamp((K.S.town.floors | 0) || BUILDING.floors, 2, 12);
  const levelY = (lv) => B().levelY(lv);
  const ladderX = () => B().ladder().x;
  const hour = () => { const d = K.now(); return d.getHours() + d.getMinutes() / 60; };
  let frameNo = 0;
  const statics = [];         // yard equipment (sawhorses, trestles, the mortar mixer)

  /* ================================================================ agents */
  function make(id, me, npc) {
    const seed = hash(id);
    const a = { id, me: !!me, npc: !!npc, seed, r: rng(seed ^ 0x9e3779b9), look: {}, colors: colorsFor(id), name: null, task: null,
      x: 0, y: 0, level: 'ground', lane: GROUND_Y + 6 + (seed % 6) * 2.3, facing: 1, pose: 'stand', poseT: 0, t: (seed % 97) / 10,
      carry: null, hat: true, held: null, emote: null, hidden: false, speed: WALK * (0.9 + (seed % 7) / 30), pace: 0.9 + ((seed >>> 5) % 9) / 36,
      plan: [], act: null, actT: 0, job: null, role: null, pair: null, say: '', state: 'working', gone: false, entering: false,
      workT: 0, breakAt: 140 + (seed % 150), vehicle: null, borrowed: null, hold: null, spotting: null, doing: null, dust: 0,
      tagText: '', tagW: 0, light: { x: 0, y: 0, r: 0, a: 0 },
      fig: { pose: 'stand', t: 0, facing: 1, colors: null, carry: null, hat: true, blink: false, me: !!me } };
    a.item = { y: 0, draw: (ctx) => drawAgent(ctx, a) };
    return a;
  }
  const homeX = (a) => BAYS[(a.seed >>> 3) % BAYS.length].cx;
  function setPose(a, p) { if (a.pose !== p) { a.pose = p; a.poseT = 0; } }
  function where(level) {
    if (level === 'ground' || level == null) { const p = stage().phase; return p === 'frame' ? 'the ground floor' : p === 'finish' ? 'the street' : 'the lot'; }
    return level >= floorsN() ? 'the roof' : 'the ' + ORD[level + 1] + ' floor';
  }
  const scaffoldUp = () => { const L = B().ladder ? B().ladder() : null; return !!L && L.top < levelY('ground') - 0.5; };
  function workLevel() { const s = stage(); if (!scaffoldUp()) return 'ground'; return s.phase === 'frame' && s.floor > 0 ? s.floor : s.phase === 'finish' ? floorsN() : 'ground'; }

  /* ---------------------------------------------------- action builders */
  const go = (x, y, level, say) => ({ k: 'goto', x, y, level: level == null ? 'ground' : level, say });
  const call = (fn) => ({ k: 'call', fn });
  const mark = (carry, fn) => ({ k: 'mark', carry, fn });
  function D(a, pose, dur, o) { const x = { k: 'do', pose, dur: dur * a.pace * (0.88 + a.r() * 0.24) }; if (o) Object.assign(x, o); return x; }
  function W(until, o) { return Object.assign({ k: 'wait', until, max: 30 }, o); }
  const pick = (a, arr) => arr[(a.r() * arr.length) | 0];
  /* each builder stands at their own spot around a shared place, so a crowd fans out */
  const spread = (a) => (((a.seed >>> 2) % 9) - 4) * 1.4;
  /* a small, human pause between steps: a glance at you, a stretch, a breath */
  function breath(a, p = 0.3) {
    if (a.r() > p) return [];
    const k = a.r();
    if (k < 0.35) return [D(a, 'look', 0.9, { face: 0 })];
    if (k < 0.55) return [D(a, 'stretch', 1.5)];
    if (k < 0.75) return [D(a, 'stand', 0.7)];
    if (k < 0.9) return [D(a, 'stand', 1.1, { emote: 'sweat', emoteDur: 1.2 })];
    return [D(a, 'point', 0.9)];
  }

  /* --------------------------------------------- materials and deliveries */
  const uses = {};
  const truckQueue = [];
  let truckForced = false;
  function order(kind) {
    if (!kind || truckQueue.includes(kind) || (truck.state !== 'gone' && truck.load.includes(kind))) return;
    truckQueue.push(kind);
  }
  const pileOf = (kind) => (K.world.pile ? K.world.pile(kind) : 3);
  function use(kind) {
    if (!kind) return;
    uses[kind] = (uses[kind] || 0) + 1;
    if (uses[kind] % 3 === 0 && K.world.take) K.world.take(kind);
    if (pileOf(kind) <= 1) order(kind);
  }
  const wspot = (z, s) => (K.world.spot ? K.world.spot(z, s) : spot(z, s));
  /* pick up material at its pile: wait a little if it's empty (a truck is on the way) */
  function fetch(a, need, carry, say, opt = {}) {
    const kind = NEED_PILE[need] || need;
    const pa = PILE_AT[kind] || ['staging', 'drop'];
    const at = opt.at || wspot(pa[0], pa[1]);
    const zone = opt.place || PLACE[pa[0]] || 'the yard';
    const dx = opt.dx != null ? opt.dx : spread(a);
    return [
      go(at[0] + dx, at[1] + 3.5 + ((a.seed >>> 6) % 4) * 1.6, 'ground', opt.walkSay || 'heading to ' + zone),
      W(() => pileOf(kind) > 0, { pose: 'look', max: 8, lateSay: 'waiting on a ' + kind + ' delivery', start: () => { if (pileOf(kind) <= 0) order(kind); } }),
      D(a, opt.pose || 'bend', opt.dur || 1, { say, then: () => use(kind) }),
      D(a, 'lift', 0.55, { carry }),
    ];
  }
  function toolFrom(a, tool, say) {
    if (a.carry === tool) return [];
    const h = TOOL_HOME[tool] ? wspot(...TOOL_HOME[tool]) : wspot('tools', 'shed');
    return [go(h[0] - 3 + spread(a) * 0.5, h[1] + 4, 'ground', say || 'getting a ' + tool + ' from the toolshed'), D(a, 'bend', 0.8), D(a, 'lift', 0.4, { carry: tool })];
  }

  /* ----------------------------------------------- shared yard equipment */
  const stations = { saw: [[300, 474], [289, 481]], trestle: [[326, 476], [343, 482]] };
  const stationUse = { saw: [null, null], trestle: [null, null] };
  function station(name, a) {
    const u = stationUse[name];
    let i = u.indexOf(a.id); if (i < 0) i = u.indexOf(null); if (i < 0) i = a.seed % u.length;
    u[i] = a.id; return stations[name][i];
  }
  function freeStations(a) { for (const n in stationUse) { const u = stationUse[n]; for (let i = 0; i < u.length; i++) if (u[i] === a.id) u[i] = null; } }
  /* the wheelbarrow: parked at `at` (home, by the hoist, beside a job), or null while someone pushes it */
  const barrow = { home: spot('masonry', 'barrow'), at: spot('masonry', 'barrow'), user: null, load: null };
  const barrowPos = () => barrow.at || barrow.home;
  const mixer = { spinUntil: 0, t: 0, truck: null };
  /* glass the forklift stages by the hoist while windows go in upstairs (the glass rack is clear across the yard) */
  const glassStage = { n: 0 };
  const glassStageAt = () => { const h = B().hoist && B().hoist(); return h ? [h.x - 17, GROUND_Y + 19] : null; };
  const glassSource = (j) => (up(j) && glassStage.n > 0 && glassStageAt() ? glassStageAt() : null);

  /* ============================================================== CHAINS
     One per building part (job.part; job.kind when a part is unknown).
     Each ends in finish(); a 'mark' sits where the material is in hand and
     the builder heads for the building (a builder placed mid-job on first
     load starts there). The building draws the piece itself as work() rises,
     so a carried piece is put down (carry cleared) the moment work starts. */
  function finish(a, j) {
    return call(() => {
      if (a.role !== 'mate') B().complete(j.id);
      a.job = null; a.role = null; a.held = null; a.req = null; a.workT += 25; freeStations(a);
      K.emit('crew:done', { id: a.id, job: j.id, kind: j.kind, part: j.part });
    });
  }
  /* where to stand: the job's own feet position (a pair uses job.spots), facing the piece */
  function standAt(a, j, idx) {
    let x = j.x, y = j.level === 'ground' ? j.y : null;
    if (idx != null && j.spots && j.spots[idx]) { x = j.spots[idx][0]; if (j.level === 'ground') y = j.spots[idx][1]; }
    const ax = j.at ? j.at[0] : j.x;
    const face = Math.abs(ax - x) > 0.6 ? Math.sign(ax - x) : (((a.seed ^ hash(j.id)) & 1) ? 1 : -1);
    return { x, y, face };
  }
  function toJob(a, j, say, idx) {
    const s = standAt(a, j, idx);
    return [go(s.x, s.y, j.level, say), { k: 'face', dir: s.face }];
  }
  const up = (j) => j.level !== 'ground';
  /* a material run: load the hoist at the bottom, climb the ladder, take it off at the landing */
  function hoistRun(a, j, carry, load, say) {
    const h = B().hoist ? B().hoist() : null;
    if (!h || !up(j)) return null;
    const bx = h.x - 5;
    return [
      go(bx - 1 + spread(a) * 0.3, GROUND_Y + 6, 'ground', say || 'carrying it to the hoist'), { k: 'face', dir: 1 },
      W(() => !hoist.req || hoist.req.who === a.id, { pose: 'stand', max: 40, lateSay: 'waiting on the hoist' }),
      D(a, 'lift', 0.8, { say: 'loading the hoist', start: () => hoistLoad(a, j, load, h), then: () => { a.carry = null; hoistSend(a); } }),
      go(bx - 2, null, j.level, 'climbing up to ' + where(j.level)), { k: 'face', dir: 1 },
      W(() => landed(a.id) || !sent(a.id), { prep: PREP.hoist, max: 30 }),
      D(a, 'lift', 0.8, { carry, say: 'taking it off the hoist', start: () => takeLanded(a.id) }),
    ];
  }
  /* carry something up: by the hoist when there is one, else up the ladder */
  function carryUp(a, j, carry, load, say) {
    return hoistRun(a, j, carry, load) || toJobSteps(a, j, say);
  }
  const toJobSteps = (a, j, say) => toJob(a, j, say);

  function chClear(a, j) {
    const d = wspot('tools', 'dumpster');
    return [
      ...toolFrom(a, 'shovel'),
      mark('shovel'),
      ...toJob(a, j, 'walking out to the old parking lot'),
      D(a, 'jackhammer', 3.6, { carry: null, work: [0, 0.45], say: j.label || 'breaking up the old asphalt', start: () => { a.dust = 3.6; } }),
      D(a, 'shovel', 2.8, { work: [0.45, 0.85], say: 'shovelling up the broken asphalt' }),
      D(a, 'lift', 0.7, { carry: 'bucket', work: [0.85, 1] }),
      finish(a, j),
      go(d[0] - 7, d[1] + 3, 'ground', 'hauling old asphalt to the dumpster'), { k: 'face', dir: 1 },
      D(a, 'throw', 0.9, { carry: null, say: 'tipping it in the dumpster' }),
    ];
  }
  function chStake(a, j) {
    return [
      ...fetch(a, 'stakes', 'stakes', 'grabbing survey stakes at the toolshed'),
      mark('stakes'),
      ...toJob(a, j, 'walking the stakes out to the lot'),
      D(a, 'hammer', 3, { carry: 'mallet', work: [0, 0.7], say: j.label || 'driving a survey stake' }),
      D(a, 'measure', 1.8, { carry: null, work: [0.7, 1], say: 'checking the stake is plumb' }),
      finish(a, j),
    ];
  }
  function chString(a, j) {
    const ax = j.at ? j.at[0] : j.x, dir = ax >= j.x ? 1 : -1;
    return [
      ...toJob(a, j, 'heading out to run a string line'),
      D(a, 'kneel', 2.2, { carry: null, work: [0, 0.25], say: 'tying a string line to the stake' }),
      { k: 'walk', x: j.x + dir * 12 },
      { k: 'face', dir: -dir },
      D(a, 'pullwire', 2.6, { work: [0.25, 0.7], say: 'pulling the string line tight' }),
      { k: 'walk', x: j.x + dir * 20 },
      D(a, 'kneel', 2.2, { work: [0.7, 1], say: 'tying it off at the next stake' }),
      finish(a, j),
    ];
  }
  function chDig(a, j) {
    /* the excavator when it's free (one builder drives it), otherwise a shovel */
    if (j.part !== 'backfill' && (a.vehicle === exc || (exc.state === 'parked' && !exc.driver && !exc.reserved && a.r() < 0.75))) {
      const out = [];
      if (a.vehicle !== exc) {
        exc.reserved = a.id;
        out.push(go(exc.x + 5, exc.y - 1, 'ground', 'heading over to the excavator'), D(a, 'climb', 0.8, { say: 'climbing into the excavator', then: () => mount(a, exc) }));
      }
      out.push({ k: 'drive', x: j.x + 13, y: GROUND_Y + 23, say: 'driving the excavator over' },
        { k: 'dig', dur: 9 * a.pace, say: (j.label || 'digging out a footing') + ' with the excavator' }, finish(a, j));
      return out;
    }
    const bf = j.part === 'backfill';
    return [
      ...toolFrom(a, 'shovel'),
      mark('shovel'),
      ...toJob(a, j, bf ? 'walking the shovel out front' : 'walking the shovel over to the dig'),
      D(a, 'shovel', 3.2, { carry: null, work: [0, 0.35], say: j.label || 'digging out the foundation' }),
      D(a, 'stand', 0.9, { emote: 'sweat', emoteDur: 1, say: 'catching their breath' }),
      D(a, 'shovel', 3, { work: [0.35, 0.7], say: j.label || 'digging out the foundation' }),
      D(a, bf ? 'rake' : 'shovel', 2.6, { work: [0.7, 1], say: bf ? 'raking the gravel level' : 'squaring off the trench' }),
      call(() => { a.carry = 'shovel'; }), finish(a, j),
    ];
  }
  function chRebar(a, j) {
    return [
      ...fetch(a, 'rebar', 'rebar', 'picking up a bundle of rebar in the staging area'),
      mark('rebar'),
      ...toJob(a, j, 'carrying rebar over to the footings'),
      D(a, 'bend', 0.8, { carry: null, work: [0, 0.1], say: 'laying the bars in the footing' }),
      D(a, 'kneel', 4, { work: [0.1, 0.65], say: j.label || 'tying rebar for the footings' }),
      ...breath(a, 0.25),
      D(a, 'kneel', 2.6, { work: [0.65, 1], say: j.label || 'tying rebar for the footings' }),
      finish(a, j),
    ];
  }
  function chForm(a, j) {
    return [
      ...fetch(a, 'formwork', 'beam', 'picking up form boards at the lumber yard'),
      mark('beam'),
      ...toJob(a, j, 'carrying form boards over to the pad'),
      D(a, 'bend', 0.9, { carry: null, work: [0, 0.15], say: 'standing the forms up' }),
      D(a, 'hammer', 4, { work: [0.15, 1], say: j.label || 'nailing up the forms' }),
      finish(a, j),
    ];
  }
  function chStrip(a, j) {
    const rk = wspot('lumber', 'rack');
    return [
      mark(null),
      ...toJob(a, j, 'heading over to strip the forms'),
      D(a, 'hammer', 2.6, { carry: null, work: [0, 0.45], say: 'prying the forms off the new concrete' }),
      D(a, 'bend', 1.4, { work: [0.45, 0.85], say: 'stacking the form boards' }),
      D(a, 'lift', 0.8, { work: [0.85, 1], then: () => { a.carry = 'beam'; } }),
      finish(a, j),
      go(rk[0] + 4 + spread(a) * 0.5, rk[1] + 5, 'ground', 'carrying form boards back to the lumber yard'),
      D(a, 'bend', 0.7, { carry: null, say: 'stacking the boards on the rack' }),
    ];
  }
  function chPour(a, j) {
    const out = [];
    if (mixer.truck.state === 'gone' && !spotterBusy('mixer')) {
      const g = spot('sidegate', 'in');
      out.push(go(g[0] - 3, g[1] - 2, 'ground', 'heading to the side gate for the mixer truck'),
        call(() => { a.spotting = 'mixer'; callMixer(); }),
        W(() => mixer.truck.state === 'onsite' || mixer.truck.state === 'leaving' || mixer.truck.state === 'gone', { max: 45, say: 'waving the mixer truck in at the side gate',
          prep: [['wave', 'waving the mixer truck in at the side gate'], ['signal', 'spotting the mixer truck back through the gate'], ['point', 'pointing it toward the pad']] }),
        call(() => { a.spotting = null; }));
    }
    const s = standAt(a, j);
    out.push(mark(null), go(s.x - 5, j.y, 'ground', 'walking over to the pour'), { k: 'face', dir: 1 },
      call(() => enqueuePour(a, j)),
      W(() => mixer.truck.serving && mixer.truck.serving.a === a && mixer.truck.atPour, { max: 60, prep: PREP.pour, timeout: () => donePour(a) }),
      D(a, 'point', 0.8, { say: 'calling for concrete' }),
      D(a, 'rake', 4.6, { carry: null, work: [0, 0.6], say: 'raking concrete into the forms', start: () => { mixer.truck.flow = true; } }),
      call(() => donePour(a)),
      D(a, 'rake', 2.6, { work: [0.6, 0.85], say: 'screeding the pour flat' }),
      D(a, 'trowel', 2.4, { work: [0.85, 1], say: 'floating the concrete smooth' }),
      finish(a, j));
    return out;
  }
  /* a concrete column: build the form, then the crane swings the pour bucket over from the mixer truck */
  function chColumn(a, j) {
    let req = null;
    const top = j.at ? j.at[1] - 9 : GROUND_Y - 17;
    return [
      call(() => { mixer.truck.need = K.t + 90; crane.wanted = K.t + 150; if (mixer.truck.state === 'gone') callMixer(); }),
      ...fetch(a, 'formwork', 'beam', 'picking up column forms at the lumber yard'),
      mark('beam', () => { mixer.truck.need = K.t + 60; }),
      ...toJob(a, j, 'carrying the column forms over'),
      D(a, 'bend', 0.8, { carry: null, work: [0, 0.1], say: 'standing the column form up' }),
      D(a, 'hammer', 3.4, { work: [0.1, 0.45], say: 'nailing the column form tight' }),
      call(() => { mixer.truck.need = K.t + 60; req = craneRequest(a, 'cbucket', () => mixerBucketAt(), [j.at ? j.at[0] : j.x, top], false); req.back = true; req.fast = 1.6; a.req = req; }),
      W(() => !req || req.dead || req.state === 'set', { prep: PREP.bucket, max: 80, timeout: () => { if (req) craneCancel(req); } }),
      D(a, 'guide', 2.6, { work: [0.45, 0.95], say: 'guiding the pour bucket over the column', start: () => { if (req) req.pouring = true; } }),
      D(a, 'signal', 0.8, { work: [0.95, 1], say: 'signalling the crane away', then: () => { if (req) craneRelease(req); } }),
      finish(a, j),
    ];
  }
  /* posts, beams, CLT deck panels: rig it at the yard, the crane flies it, guide it down, fasten it */
  /* busy hands while something else is on its way: every few seconds, the next bit of real prep */
  const PREP = {
    yard: (noun) => [['bend', 'checking the slings on the ' + noun], ['measure', 'measuring the ' + noun + ' against the plans'], ['signal', 'signalling the crane operator'], ['look', 'watching the hook swing over']],
    deck: (noun) => [['measure', 'marking the bolt holes while the crane swings over'], ['drill', 'pre-drilling the bolt holes'], ['bend', 'clearing a spot for the ' + noun], ['signal', 'guiding the crane operator in'], ['look', 'watching the ' + noun + ' come over']],
    hoist: [['look', 'watching the hoist come up'], ['bend', 'clearing a spot on the deck'], ['measure', 'measuring the opening']],
    pour: [['rake', 'raking the forms level'], ['bend', 'checking the form ties'], ['point', 'calling the mixer truck over'], ['look', 'watching the chute']],
    bucket: [['hammer', 'tapping the column form tight'], ['measure', 'checking the form is plumb'], ['signal', 'calling the crane over'], ['look', 'watching the pour bucket swing over']],
    pane: [['measure', 'measuring the window opening'], ['bend', 'laying out the glazing tools'], ['look', 'watching for a hand with the glass']],
  };
  /* posts, beams, CLT deck panels: rig it at the yard, the crane flies it, guide it down, fasten it.
     The crane never keeps anyone standing: prep while it comes, a glulam post or beam goes up by hand
     if the crane is tied up, and if the builder isn't there yet the crane lands the piece on the deck. */
  function chLifted(a, j, pair) {
    const deck = j.part === 'deck', post = j.part === 'post';
    const noun = deck ? 'CLT panel' : post ? 'glulam post' : 'glulam beam';
    const pick = deck ? wspot('lumber', 'panels') : wspot('lumber', 'rack');
    const wh = where(j.level);
    let req = null;
    const out = [
      go(pick[0] + 2 + spread(a) * 0.4, pick[1] + 6, 'ground', 'heading to the ' + (deck ? 'panel rack' : 'timber stack') + ' to rig a ' + noun),
      call(() => { crane.wanted = K.t + 150; }),
      D(a, 'bend', 1.2, { say: 'rigging a ' + noun + ' for the crane', then: () => {
        use(deck ? 'panels' : 'lumber');
        const ax = j.at ? j.at[0] : j.x, ay = post ? levelY(j.level) : j.at ? j.at[1] : levelY(j.level);
        req = craneRequest(a, deck ? 'panel' : 'beam', [pick[0], pick[1] - 2], [ax, ay], false); req.part = j.part; req.floorY = levelY(j.level); if (post) req.hang = 14.5; a.req = req; } }),
      W(() => !req || req.dead || req.state === 'atPick', { prep: PREP.yard(noun), max: deck ? 150 : 15, timeout: (aa) => {
        if (deck) { if (req) craneCancel(req); return; }
        /* the crane is tied up: a glulam post or beam goes up by hand */
        if (req) craneCancel(req);
        aa.plan = liftedByHand(aa, j);
      } }),
      D(a, 'guide', 1.2, { say: 'hooking the ' + noun + ' to the crane', then: () => { if (req && !req.dead) req.attached = true; } }),
      D(a, 'signal', 1, { face: 1, say: 'signalling the crane operator' }),
    ];
    if (pair) out.push(call(() => { pair.req = req; }));
    const s = standAt(a, j, pair ? 0 : null);
    out.push(go(s.x, s.y, j.level, up(j) ? 'climbing up to meet the ' + noun : 'walking over to meet the ' + noun), { k: 'face', dir: s.face },
      W(() => !req || req.dead || req.state === 'set' || req.landed, { prep: PREP.deck(noun), max: 45, timeout: () => { if (req) craneCancel(req); } }));
    if (pair) out.push({ k: 'sync', key: pair.key + 'L', n: 2, max: 20, prep: PREP.deck(noun) });
    out.push(call(() => {
      /* landed on the deck while they were on the way: swing it into place by hand */
      if (req && req.landed) a.plan.unshift(...settle(a, j, req, noun));
      else a.plan.unshift(
        D(a, post ? 'lift' : 'guide', 2.6, { carry: null, work: [0, 0.8], say: post ? 'pushing the post upright' : 'guiding the ' + noun + ' down onto ' + (deck ? 'the beams' : 'the posts'),
          start: () => { if (req) req.handed = true; }, tick: (aa, k) => { if (req) req.a = k; } }),
        D(a, 'signal', 0.8, { say: 'signalling the crane to slack off', then: () => { if (req) craneRelease(req); } }));
    }),
      D(a, post ? 'drill' : deck ? 'drill' : 'hammer', 3.2, { work: [0.8, 1], say: post ? 'drilling the post\'s base plate' : deck ? 'screwing the panel down' : 'bolting the beam home on ' + wh }));
    if (pair) out.push({ k: 'sync', key: pair.key + 'E', n: 2, max: 20 });
    out.push(finish(a, j));
    if (pair) out.push(call(() => { a.pair = null; }));
    return out;
  }
  /* a landed piece: lift it off the deck and set it (the building draws it in place from 0.8) */
  function settle(a, j, req, noun) {
    return [
      D(a, 'bend', 0.8, { say: 'picking up the ' + noun + ' the crane landed', start: () => { req.landed = false; landedPieces.delete(req); }, carry: j.part === 'deck' ? 'panel' : 'beam' }),
      D(a, 'lift', 1.6, { say: j.part === 'post' ? 'standing the post up' : 'lifting it into place', then: () => { a.carry = null; } }),
      D(a, 'stand', 0.2, { work: [0.8, 0.8] }),
    ];
  }
  /* the crane is busy: carry the post or beam up the ladder on a shoulder */
  function liftedByHand(a, j) {
    const post = j.part === 'post', wh = where(j.level), noun = post ? 'glulam post' : 'glulam beam';
    return [
      D(a, 'lift', 0.9, { carry: 'beam', say: 'shouldering the ' + noun + ' (the crane is busy)' }),
      mark('beam'),
      ...toJob(a, j, up(j) ? 'carrying the ' + noun + ' up the stair tower' : 'carrying the ' + noun + ' over'),
      D(a, 'lift', 1.8, { say: post ? 'standing the post up' : 'lifting the beam onto the posts' }),
      D(a, 'stand', 0.2, { carry: null, work: [0.8, 0.8] }),
      D(a, post ? 'drill' : 'hammer', 3.2, { work: [0.8, 1], say: post ? 'drilling the post\'s base plate' : 'bolting the beam home on ' + wh }),
      finish(a, j),
    ];
  }
  /* the second builder on a CLT panel: up to the other end, help guide it, screw it down */
  function liftMateChain(a, pair) {
    const j = pair.j, s = standAt(a, j, 1);
    return [
      go(s.x, s.y, j.level, up(j) ? 'climbing up to land a CLT panel' : 'heading over to land a CLT panel'), { k: 'face', dir: s.face },
      W(() => !pair.req || pair.req.dead || pair.req.state === 'set' || pair.req.landed, { prep: PREP.deck('CLT panel'), max: 60 }),
      { k: 'sync', key: pair.key + 'L', n: 2, max: 20, prep: PREP.deck('CLT panel') },
      D(a, 'guide', 2.6, { carry: null, say: 'guiding the CLT panel down', dur: 2.6 }),
      D(a, 'stand', 0.8, { say: 'holding it square' }),
      D(a, 'drill', 3.2, { say: 'screwing the panel down' }),
      { k: 'sync', key: pair.key + 'E', n: 2, max: 20, prep: [['measure', 'checking the panel is flush']] },
      call(() => { a.job = null; a.role = null; a.pair = null; }),
    ];
  }
  function chStud(a, j) {
    const wh = where(j.level);
    return [
      ...fetch(a, 'beam', 'beam', 'picking up studs at the lumber yard'),
      mark('beam'),
      ...toJob(a, j, up(j) ? 'carrying studs up to ' + wh : 'carrying studs over to Watershed'),
      D(a, 'bend', 0.7, { carry: null, work: [0, 0.1], say: 'laying out the studs' }),
      D(a, 'hammer', 4.2, { work: [0.1, 0.8], say: j.label || 'framing a stud wall' }),
      ...breath(a, 0.25),
      D(a, 'hammer', 1.8, { work: [0.8, 1], say: 'nailing the top plate on' }),
      finish(a, j),
    ];
  }
  function chWire(a, j) {
    const wh = where(j.level), out = [];
    const fy = up(j) ? levelY(j.level) : j.y;
    if (a.carry !== 'spool') out.push(...fetch(a, 'spool', 'spool', 'getting a spool of wire from the toolshed'));
    out.push(mark('spool'),
      go(j.x - 6, up(j) ? null : j.y, j.level, 'carrying a spool of wire over'), { k: 'face', dir: 1 },
      D(a, 'bend', 0.5, { carry: null, held: { name: 'spool', x: j.x - 9, y: fy } }),
      D(a, 'pullwire', 3.2, { work: [0, 0.35], say: 'pulling wire through the studs on ' + wh }),
      { k: 'walk', x: j.x - 1 },
      D(a, 'pullwire', 3, { work: [0.35, 0.7], say: 'pulling wire through the studs on ' + wh }),
      { k: 'walk', x: j.x + 4 },
      D(a, 'pullwire', 2.6, { work: [0.7, 0.92], say: 'pulling wire hand over hand' }),
      D(a, 'look', 0.9, { work: [0.92, 1], face: 0, say: 'checking the run' }),
      { k: 'walk', x: j.x - 7 },
      D(a, 'bend', 0.5, { held: null, carry: 'spool', say: 'picking up the spool' }),
      finish(a, j));
    return out;
  }
  function chBrick(a, j) {
    const wh = where(j.level), hu = up(j) && B().hoist && B().hoist();
    const mx = spot('masonry', 'mixer'), bk = spot('masonry', 'bricks');
    const mixing = mixer.spinUntil > K.t + 2;
    const out = mixing ? [
      go(mx[0] + 7 + spread(a) * 0.4, mx[1] + 3, 'ground', 'heading to the brick yard'), { k: 'face', dir: -1 },
      D(a, 'pour', 1.6, { say: 'scooping mortar from the mixer', carry: 'bucket' }),
    ] : [
      go(mx[0] - 7, mx[1] + 2, 'ground', 'heading to the brick yard'), { k: 'face', dir: 1 },
      D(a, 'shovel', 3.4, { say: 'shovelling sand into the mortar mixer', start: () => { mixer.spinUntil = K.t + 12; } }),
      D(a, 'look', 1, { say: 'watching the mortar turn' }),
      D(a, 'pour', 1.4, { say: 'tipping mortar into a bucket', carry: 'bucket' }),
    ];
    const useBarrow = !barrow.user;
    if (useBarrow) {
      barrow.user = a.id;
      const bp = barrowPos();
      out.push(go(bp[0] - 6, bp[1], 'ground', 'carrying the mortar to the wheelbarrow'), { k: 'face', dir: 1 },
        D(a, 'bend', 0.6, { carry: null, then: () => { barrow.load = 'mortar'; } }),
        D(a, 'push', 0.4, { carry: 'barrow', start: () => { barrow.at = null; } }),
        go(bk[0] + 4, bk[1] + 8, 'ground', 'wheeling the barrow to the brick stack'), { k: 'face', dir: -1 },
        D(a, 'bend', 0.4, { carry: null, held: { name: 'barrow', x: bk[0] - 2, y: bk[1] + 8, o: { load: 'mortar', facing: -1 } } }),
        D(a, 'lift', 3, { say: 'loading bricks into the wheelbarrow', then: () => { use('brick'); if (a.held) a.held.o = { load: 'bricks', facing: -1 }; } }),
        D(a, 'push', 0.4, { held: null, carry: 'barrow', then: () => { barrow.load = 'bricks'; } }),
        mark('barrow', () => { barrow.user = a.id; barrow.at = null; barrow.load = 'bricks'; }));
      if (hu) {
        const tb = [hu.x - 13, GROUND_Y + 9];
        out.push(go(tb[0] - 3, tb[1], 'ground', 'wheeling bricks over to the hoist'), { k: 'face', dir: 1 },
          D(a, 'bend', 0.6, { carry: null, then: () => { barrow.at = [tb[0], tb[1]]; } }),
          D(a, 'lift', 0.6, { carry: 'bricks', say: 'stacking bricks on the hoist' }),
          ...hoistRun(a, j, 'bricks', 'bricks'),
          ...toJob(a, j, 'carrying bricks along ' + wh));
      } else if (up(j)) {
        const tb = [BUILDING.towerX - 4, GROUND_Y + 12];
        out.push(go(tb[0] - 3, tb[1], 'ground', 'wheeling bricks over to Watershed'), { k: 'face', dir: 1 },
          D(a, 'bend', 0.6, { carry: null, then: () => { barrow.at = [tb[0], tb[1]]; } }),
          D(a, 'lift', 0.8, { carry: 'bricks', say: 'loading a hod of bricks' }),
          ...toJob(a, j, 'carrying a hod of bricks up the tower'));
      } else {
        const s = standAt(a, j);
        out.push(go(s.x - s.face * 6, j.y + 3, 'ground', 'wheeling bricks over to Watershed'), { k: 'face', dir: s.face },
          D(a, 'bend', 0.6, { carry: null, then: () => { barrow.at = [a.x + a.facing * 2.5, a.y + 1.5]; } }),
          { k: 'walk', x: s.x, y: j.y }, { k: 'face', dir: s.face });
      }
    } else {
      out.push(D(a, 'bend', 0.5, { carry: null, say: 'setting the bucket down' }),
        ...fetch(a, 'bricks', 'bricks', 'picking up a stack of bricks', { dx: 6 + spread(a) }),
        ...(hoistRun(a, j, 'bricks', 'bricks', 'carrying bricks to the hoist') || []),
        mark('bricks'),
        ...toJob(a, j, up(j) ? 'carrying bricks along ' + wh : 'carrying bricks over to Watershed'));
    }
    out.push(
      D(a, 'bend', 0.5, { carry: null }),
      D(a, 'trowel', 3, { work: [0, 0.3], say: 'buttering the bed with mortar on ' + wh }),
      D(a, 'bend', 2.8, { work: [0.3, 0.75], say: 'laying a course of brick on ' + wh }),
      ...breath(a, 0.2),
      D(a, 'trowel', 2.6, { work: [0.75, 1], say: 'striking the joints' }),
      finish(a, j));
    if (useBarrow) {
      out.push(call(() => {
        if (barrow.user !== a.id) return;
        const p = barrowPos();
        a.plan.unshift(go(p[0] - 6, p[1], 'ground', 'fetching the wheelbarrow'), { k: 'face', dir: 1 },
          D(a, 'push', 0.4, { carry: 'barrow', start: () => { barrow.at = null; barrow.load = null; } }),
          go(barrow.home[0] - 6, barrow.home[1], 'ground', 'wheeling the barrow back to the brick yard'),
          D(a, 'bend', 0.5, { carry: null, then: () => { barrow.at = barrow.home; barrow.user = null; barrow.load = null; } }));
      }));
    }
    return out;
  }
  function chClad(a, j) {
    const wh = where(j.level), charcoal = /charcoal/.test(j.label || '');
    return [
      ...fetch(a, 'panel', 'rustPanel', 'picking up a ' + (charcoal ? 'charcoal' : 'rust') + ' panel at the prefab shed', { at: wspot('lumber', 'panels'), place: 'the prefab shed', pose: 'lift' }),
      ...(hoistRun(a, j, 'rustPanel', 'panel', 'carrying the panel to the hoist') || []),
      mark('rustPanel'),
      ...toJob(a, j, up(j) ? 'carrying the panel along ' + wh : 'carrying a panel over to Watershed'),
      D(a, 'lift', 1.5, { say: 'holding the panel in place on ' + wh }),
      D(a, 'drill', 4.2, { carry: null, work: [0, 1], say: j.label || 'drilling the cladding home on ' + wh }),
      ...breath(a, 0.25),
      finish(a, j),
    ];
  }
  /* glass: two builders walk a pane over together; one guides, one drills */
  function newPair(lead, mate, j) {
    const pair = { key: lead.id + '>' + j.id + ':' + ((R() * 1e6) | 0), lead, mate, j, up: up(j), req: null };
    lead.pair = pair; mate.pair = pair; mate.job = j; mate.role = 'mate';
    B().claim(j.id, mate.id);
    return pair;
  }
  function pairChain(a, pair, lead) {
    return pair.j.part === 'deck' ? (lead ? chLifted(a, pair.j, pair) : liftMateChain(a, pair)) : glazeChain(a, pair, lead);
  }
  function chPair(a, j) {
    const mate = findMate(a);
    if (!mate) return j.part === 'deck' ? (crane.erect >= 1 ? chLifted(a, j, null) : chLifted(a, j, null)) : chGlazeSolo(a, j, true);
    const pair = newPair(a, mate, j);
    mate.plan = []; mate.act = null; mate.held = null; mate.doing = 'job';
    mate.plan.push(...prefix(mate, null), ...pairChain(mate, pair, false));
    return pairChain(a, pair, true);
  }
  function glazeChain(a, pair, lead) {
    const j = pair.j, wh = where(j.level), k = pair.key, staged = glassSource(j), rack = staged || wspot('staging', 'drop2');
    const carry = lead ? 'paneL' : 'paneR', off = lead ? -4.5 : 4.5;
    const S = (n, o) => Object.assign({ k: 'sync', key: k + n, n: 2, max: lead ? 40 : 60, prep: n === 1 ? PREP.pane : PREP.hoist }, o);
    const out = [
      go(rack[0] + off, rack[1] + 6, 'ground', 'heading to the glass rack'), { k: 'face', dir: lead ? 1 : -1 },
      S(1, lead ? { max: 70, say: 'waiting for a hand with the glass', timeout: () => { soloAfterTimeout(a, pair); } } : null),
      D(a, 'lift', 0.9, { carry, say: staged ? 'lifting a pane off the stack by the hoist' : 'lifting a pane of glass off the rack', dur: 0.9, then: lead ? () => { if (staged) glassStage.n = Math.max(0, glassStage.n - 1); else use('glass'); } : null }),
    ];
    const h = pair.up && B().hoist ? B().hoist() : null;
    if (h) {
      const bx = h.x - 5;
      out.push({ k: 'walk', x: bx + (lead ? -9 : 0), y: GROUND_Y + 6, pair: 1, say: 'walking a pane of glass over to the hoist' }, { k: 'face', dir: 1 }, S(2));
      if (lead) {
        out.push(W(() => !hoist.req || hoist.req.who === a.id, { pose: 'stand', max: 40, lateSay: 'waiting on the hoist' }),
          D(a, 'lift', 0.9, { say: 'easing the pane onto the hoist', dur: 0.9, start: () => hoistLoad(a, j, 'pane', h), then: () => { a.carry = null; hoistSend(a); } }),
          S(3),
          go(bx - 9, null, j.level, 'climbing up to ' + wh),
          W(() => landed(a.id) || !sent(a.id), { prep: PREP.hoist, max: 30 }),
          S(4),
          D(a, 'lift', 0.8, { carry, dur: 0.8, say: 'taking the pane off the hoist', start: () => takeLanded(a.id) }));
      } else {
        out.push(W(() => sent(pair.lead.id), { pose: 'guide', max: 45, say: 'steadying the pane onto the hoist', then: () => { a.carry = null; } }),
          call(() => { a.carry = null; }),
          S(3),
          D(a, 'stand', 1.6),
          go(bx, null, j.level, 'climbing up to ' + wh),
          S(4),
          D(a, 'lift', 0.8, { carry, dur: 0.8 }));
      }
    }
    /* the pane is set between the two stand spots: the west one is always paneL */
    const s = standAt(a, j, lead ? 0 : 1);
    out.push({ k: 'walk', x: s.x, y: up(j) ? null : s.y, pair: 1, say: 'walking the pane over to the window' },
      { k: 'face', dir: lead ? 1 : -1 },
      S(5),
      D(a, 'guide', 2, { carry: null, work: lead ? [0, 0.4] : null, say: j.label || 'setting a window on ' + wh, dur: 2 }));
    if (lead) out.push(D(a, 'drill', 3.6, { work: [0.4, 1], say: 'drilling the window frame in', dur: 3.6 }), S(6), finish(a, j));
    else out.push(D(a, 'guide', 3.6, { say: 'holding the pane steady', dur: 3.6 }), S(6), call(() => { a.job = null; a.role = null; }));
    out.push(call(() => { a.pair = null; }));
    return out;
  }
  /* the partner never showed: carry on alone */
  function soloAfterTimeout(a, pair) {
    if (a.pair !== pair) return;
    const m = pair.mate;
    a.pair = null;
    if (m && m.pair === pair) { m.pair = null; abort(m); }
    a.plan = chGlazeSolo(a, pair.j, false);
  }
  function chGlazeSolo(a, j, waitForMate) {
    const wh = where(j.level), staged = glassSource(j), rack = staged || wspot('staging', 'drop2');
    const out = [go(rack[0] - 3 + spread(a) * 0.4, rack[1] + 6, 'ground', staged ? 'heading to the glass stack by the hoist' : 'heading to the glass rack'), { k: 'face', dir: 1 }];
    if (waitForMate) {
      const p = { lead: a, j, open: true, until: K.t + 90, mate: null, build: null };
      pendingPairs.push(p);
      out.push(W(() => !p.open || !!p.mate, { prep: PREP.pane, max: 7 }),
        call(() => {
          p.open = false;
          const i = pendingPairs.indexOf(p); if (i >= 0) pendingPairs.splice(i, 1);
          if (p.mate && p.build) a.plan = p.build();
        }));
    }
    out.push(D(a, 'lift', 1, { carry: 'pane', say: j.part === 'storefront' ? 'lifting a storefront frame off the rack' : 'lifting a pane of glass off the rack', then: () => { if (staged && glassStage.n > 0) glassStage.n--; else use('glass'); } }),
      ...(hoistRun(a, j, 'pane', 'pane', 'carrying the pane to the hoist') || []),
      mark('pane'),
      ...toJob(a, j, 'carrying the pane over carefully'),
      D(a, 'lift', 1.6, { say: 'lifting it into the opening' }),
      D(a, 'guide', 1.6, { carry: null, work: [0, 0.35], say: j.label || 'setting a window on ' + wh }),
      D(a, 'drill', 3.6, { work: [0.35, 1], say: 'drilling the frame in' }),
      finish(a, j));
    return out;
  }
  function chCanopy(a, j) {
    return [
      ...fetch(a, 'beam', 'beam', 'picking a canopy timber off the rack'),
      mark('beam'),
      ...toJob(a, j, 'carrying a canopy timber over'),
      D(a, 'lift', 1.6, { say: 'lifting the timber up to the canopy' }),
      D(a, ((a.seed >>> 3) & 1) ? 'drill' : 'hammer', 3.8, { carry: null, work: [0, 1], say: j.label || 'hanging the timber canopy' }),
      finish(a, j),
    ];
  }
  function chSolar(a, j) {
    return [
      ...fetch(a, 'panel', 'solar', 'picking up a solar panel at the prefab shed', { at: wspot('lumber', 'panels'), place: 'the prefab shed' }),
      ...(hoistRun(a, j, 'solar', 'panel', 'carrying the solar panel to the hoist') || []),
      mark('solar'),
      ...toJob(a, j, 'carrying the panel across the roof'),
      D(a, 'kneel', 1.8, { carry: null, work: [0, 0.3], say: j.label || 'laying a solar panel on the roof' }),
      D(a, 'drill', 3.6, { work: [0.3, 1], say: 'bolting the solar panel down' }),
      finish(a, j),
    ];
  }
  function chPlant(a, j) {
    const y = j.y || GROUND_Y + 10, x = j.x;
    const sp = SAPLINGS[a.seed % SAPLINGS.length], pl = j.part === 'planter';
    return [
      ...toolFrom(a, 'shovel'),
      mark('shovel'),
      go(x - 4, y, 'ground', pl ? 'heading to the planters by the door' : 'walking out to the sidewalk'), { k: 'face', dir: 1 },
      D(a, 'shovel', 3.2, { carry: null, work: [0, 0.4], say: pl ? 'turning the soil in a planter' : 'digging a hole for a street tree' }),
      D(a, 'bend', 0.5, { held: { name: 'shovel', x: x - 1, y, o: { stuck: true } } }),
      go(sp[0] - 4, sp[1] + 2, 'ground', pl ? 'fetching some plants' : 'fetching a sapling'), D(a, 'bend', 0.8), D(a, 'lift', 0.4, { carry: 'plant' }),
      go(x - 4, y, 'ground', pl ? 'carrying the plants over' : 'carrying the sapling over'), { k: 'face', dir: 1 },
      D(a, 'plant', 2.6, { carry: null, work: [0.4, 0.75], say: j.label || 'planting a street tree' }),
      D(a, 'shovel', 2.4, { held: null, work: [0.75, 1], say: pl ? 'firming the soil' : 'backfilling around the tree' }),
      call(() => { a.carry = 'shovel'; }),
      finish(a, j),
    ];
  }
  /* after topping out: washing windows, sweeping, watering, raking leaves, shovelling snow, paint, wreaths */
  function chUpkeep(a, j) {
    const out = [];
    const tool = j.carry === 'bucket' ? 'bucket' : j.needs === 'shovel' ? 'shovel' : null;
    if (tool) out.push(...toolFrom(a, tool, 'getting a ' + tool + ' from the toolshed'));
    else if (j.carry === 'plant') { const sp = SAPLINGS[a.seed % SAPLINGS.length]; out.push(go(sp[0] - 4, sp[1] + 2, 'ground', 'fetching a wreath'), D(a, 'bend', 0.8), D(a, 'lift', 0.4, { carry: 'plant' })); }
    const pose = j.pose || 'sweep', d = Math.max(6, (j.dur || 12) * 0.55);
    const keep = pose === 'pour' || pose === 'trowel' || pose === 'guide';
    out.push(mark(tool || null), ...toJob(a, j, 'heading out front'),
      D(a, pose, d * 0.6, { carry: keep ? tool || j.carry || null : null, work: [0, 0.6], say: j.label || 'keeping the place nice' }),
      ...breath(a, 0.3),
      D(a, pose, d * 0.4, { work: [0.6, 1], say: j.label || 'keeping the place nice', then: () => { if (j.carry === 'plant') a.carry = null; } }),
      finish(a, j));
    return out;
  }
  function chGeneric(a, j) {
    const out = [];
    if (j.needs && NEED_PILE[j.needs]) out.push(...fetch(a, j.needs, NEED_CARRY[j.needs] || null, 'fetching ' + j.needs));
    out.push(mark(NEED_CARRY[j.needs] || null), ...toJob(a, j, 'heading to ' + where(j.level)),
      D(a, 'hammer', Math.max(4, (j.dur || 10) * 0.5), { carry: null, work: [0, 1], say: j.label || 'working on ' + where(j.level) }), finish(a, j));
    return out;
  }
  function chainFor(a, j) {
    switch (j.part) {
      case 'clear': return chClear(a, j);
      case 'stake': return chStake(a, j);
      case 'string': return chString(a, j);
      case 'dig': case 'backfill': return chDig(a, j);
      case 'rebar': return chRebar(a, j);
      case 'form': return chForm(a, j);
      case 'strip': return chStrip(a, j);
      case 'pour': return chPour(a, j);
      case 'column': return chColumn(a, j);
      case 'post': case 'beam': return chLifted(a, j, null);
      case 'deck': return j.crew > 1 ? chPair(a, j) : chLifted(a, j, null);
      case 'stud': return chStud(a, j);
      case 'wire': return chWire(a, j);
      case 'clad': return chClad(a, j);
      case 'brick': return chBrick(a, j);
      case 'storefront': case 'glaze': return j.crew > 1 ? chPair(a, j) : chGlazeSolo(a, j, false);
      case 'canopy': return chCanopy(a, j);
      case 'solar': return chSolar(a, j);
      case 'tree': case 'planter': return chPlant(a, j);
      default: break;
    }
    if (j.kind === 'upkeep' || j.pose) return chUpkeep(a, j);
    switch (j.kind) {
      case 'stake': return chStake(a, j);
      case 'dig': return chDig(a, j);
      case 'rebar': return chRebar(a, j);
      case 'form': return chForm(a, j);
      case 'pour': return chPour(a, j);
      case 'frame': return j.lift ? chLifted(a, j, null) : chStud(a, j);
      case 'deck': return chLifted(a, j, null);
      case 'wire': return chWire(a, j);
      case 'brick': return chBrick(a, j);
      case 'clad': return chClad(a, j);
      case 'glaze': return j.crew > 1 ? chPair(a, j) : chGlazeSolo(a, j, false);
      case 'solar': return chSolar(a, j);
      case 'plant': return chPlant(a, j);
      default: return chGeneric(a, j);
    }
  }

  /* --------------------------------------------------- pairs (glass, CLT panels) */
  const pendingPairs = [];
  function free(b) {
    return b && !b.gone && !b.npc && b.state === 'working' && !b.job && !b.borrowed && !b.vehicle && !b.hold && !b.entering && !b.pair
      && b.doing !== 'break' && !(b.act && b.act.k === 'climb');
  }
  function findMate(a) {
    let best = null, bd = 1e9;
    for (const b of agents.values()) {
      if (b === a || b.me || !free(b)) continue;
      const d = Math.abs(b.x - a.x) + (b.level === a.level ? 0 : 40);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  function joinPending(a) {
    for (let i = 0; i < pendingPairs.length; i++) {
      const p = pendingPairs[i];
      if (!p.open || p.mate || p.lead.gone || p.until < K.t) { pendingPairs.splice(i--, 1); continue; }
      p.mate = a; pendingPairs.splice(i, 1);
      const pair = newPair(p.lead, a, p.j);
      p.build = () => pairChain(p.lead, pair, true);
      a.doing = 'job';
      a.plan.push(...prefix(a, null), ...pairChain(a, pair, false));
      return true;
    }
    return false;
  }
  function breakPair(a) {
    const p = a.pair; if (!p) return;
    a.pair = null;
    const o = p.lead === a ? p.mate : p.lead;
    if (o && o.pair === p) { o.pair = null; abort(o); }
  }

  /* -------------------------------------------- breaks, lunch, fillers */
  function breakChain(a, lunch) {
    a.doing = 'break';
    const h = hour(), s = stage();
    const lunchTime = h >= 11.75 && h < 13.25;
    const out = [];
    if (lunch || (lunchTime && (a.task === 'lunch' || a.r() < 0.75)) || (a.task === 'lunch' && a.r() < 0.4)) {
      a.lunchDay = K.now().toDateString();
      if (s.phase === 'frame' && s.floor >= 1) {
        const f = s.floor, x = BUILDING.x0 + 6 + ((a.seed * 7) % (BUILDING.x1 - BUILDING.x0 - 12));
        out.push(go(x, null, f, 'heading up for lunch'), D(a, 'sitbeam', 14, { carry: 'sandwich', face: (a.seed & 1) ? 1 : -1, say: 'eating lunch on a beam' }),
          D(a, 'eat', 3), D(a, 'sitbeam', 12), D(a, 'eat', 2.5), D(a, 'sitbeam', 10, { then: () => { a.carry = null; } }));
      } else {
        const seat = spot('canteen', pick(a, ['seat1', 'seat2', 'seat3']));
        out.push(go(seat[0], seat[1], 'ground', 'heading to the canteen for lunch'), D(a, 'sit', 6, { carry: 'sandwich', face: (a.seed & 1) ? 1 : -1, say: 'eating lunch at the canteen' }),
          D(a, 'eat', 3), D(a, 'sit', 10), D(a, 'eat', 2.5), D(a, 'sit', 8), D(a, 'bend', 0.5, { carry: null }));
      }
      return out;
    }
    const k = a.r();
    if (k < 0.45) {
      const urn = spot('canteen', 'urn');
      out.push(go(urn[0] + 3 + spread(a), urn[1] + 3 + ((a.seed >>> 6) % 4) * 1.5, 'ground', 'grabbing a coffee at the canteen'), D(a, 'bend', 0.9, { carry: 'mug' }),
        D(a, 'drink', 2.4, { say: 'having a coffee at the canteen' }), D(a, 'stand', 3, { face: (a.seed & 1) ? 1 : -1 }), D(a, 'drink', 2), D(a, 'look', 1.2, { face: 0 }),
        D(a, 'bend', 0.6, { carry: null }));
    } else if (k < 0.7) {
      const v = spot('bench', 'view');
      out.push(go(v[0] + (a.seed % 8), v[1] + 4, 'ground', 'taking a minute by the lake'), D(a, 'stand', 4.5, { face: 1, say: 'looking out at the lake' }),
        D(a, 'stretch', 1.6), D(a, 'stand', 2.5, { face: -1 }));
    } else if (k < 0.85) {
      const jn = spot('tools', 'john');
      out.push(go(jn[0], jn[1] + 2, 'ground', 'on a quick break'), call(() => { a.hidden = true; }), D(a, 'stand', 7, { say: 'on a quick break' }),
        call(() => { a.hidden = false; }), D(a, 'stretch', 1.2));
    } else {
      out.push(D(a, 'stretch', 1.8, { say: 'stretching their back' }), D(a, 'drink', 1.6, { carry: 'thermos', say: 'a sip from the thermos' }), D(a, 'stand', 0.6, { carry: null }));
    }
    return out;
  }
  function filler(a) {
    a.doing = 'filler';
    const lv = workLevel(), wh = where(lv), pref = a.task;
    const kinds = pref === 'haul' ? ['offcuts', 'bricks', 'tools', 'offcuts', 'sweep']
      : pref === 'brick' ? ['bricks', 'sweep', 'measure'] : pref === 'wire' ? ['tools', 'plans', 'sweep']
        : pref === 'frame' || pref === 'roof' ? ['measure', 'sweep', 'offcuts'] : ['sweep', 'measure', 'plans', 'offcuts', 'tools'];
    let k = pick(a, kinds);
    if (k === a.lastFiller) k = kinds[(kinds.indexOf(k) + 1) % kinds.length];
    a.lastFiller = k;
    const bx = () => BUILDING.x0 + 6 + a.r() * (BUILDING.x1 - BUILDING.x0 - 12);
    const gy = lv === 'ground' ? GROUND_Y + 7 : null;
    if (k === 'offcuts') {
      const s = spot('lumber', 'saw'), d = spot('tools', 'dumpster');
      return [go(s[0] + 3, s[1] + 4, 'ground', 'gathering offcuts at the lumber yard'), D(a, 'bend', 1.4), D(a, 'lift', 0.5, { carry: 'beam' }),
        go(d[0] - 7, d[1] + 3, 'ground', 'carrying offcuts to the dumpster'), { k: 'face', dir: 1 }, D(a, 'throw', 0.9, { carry: null, say: 'tossing offcuts in the dumpster' }), ...breath(a, 0.5)];
    }
    if (k === 'bricks') {
      const b = spot('masonry', 'bricks');
      return [go(b[0] + 2, b[1] + 4, 'ground', 'heading to the brick yard'), D(a, 'bend', 2, { say: 'restacking bricks at the brick yard' }), D(a, 'lift', 0.6, { carry: 'bricks' }),
        { k: 'walk', x: b[0] + 10, y: b[1] + 3 }, D(a, 'bend', 1, { carry: null, say: 'restacking bricks at the brick yard' }), ...breath(a, 0.4)];
    }
    if (k === 'tools') {
      const s = spot('tools', 'shed');
      return [go(s[0] + 3, s[1] + 4, 'ground', 'heading to the toolshed'), D(a, 'bend', 2.4, { say: 'sorting tools at the toolshed' }), D(a, 'lift', 0.5, { carry: 'toolbox' }),
        go(BUILDING.towerX - 2, GROUND_Y + 8, 'ground', 'bringing a toolbox to the tower'), D(a, 'bend', 0.6, { carry: null }), ...breath(a, 0.4)];
    }
    if (k === 'plans') {
      const s = spot('office', 'step');
      return [go(s[0] + 6, s[1] + 4, 'ground', 'heading to the site trailer'), D(a, 'bend', 0.5, { carry: 'clipboard' }), D(a, 'look', 3, { face: 0, say: 'checking the plans at the site trailer' }),
        D(a, 'point', 1.4), D(a, 'bend', 0.5, { carry: null })];
    }
    if (k === 'measure') {
      return [go(bx(), gy, lv, 'checking the work on ' + wh), D(a, 'measure', 3, { say: 'measuring for the next piece on ' + wh }), D(a, 'point', 1.2), ...breath(a, 0.4)];
    }
    const x = bx();
    return [go(x, gy, lv, 'heading to ' + wh), D(a, 'sweep', 5, { say: 'sweeping up on ' + wh }),
      { k: 'walk', x: clamp(x + (a.r() < 0.5 ? -10 : 10), BUILDING.x0 + 3, BUILDING.x1 - 3), y: gy }, D(a, 'sweep', 4)];
  }

  /* ----------------------------------------------- choosing the next job */
  function pickJob(a) {
    const list = B().jobs();
    if (!list || !list.length) return null;
    const pref = PREF[a.task] || [], home = homeX(a);
    let best = null, bs = 1e9;
    for (let i = 0; i < list.length; i++) {
      const j = list[i];
      let s = i * 2.2 + Math.abs(j.x - home) * 0.32 + a.r() * 8;
      if (pref.includes(j.part) || pref.includes(j.kind)) s -= 40;
      /* spread out: the yard a job draws from, and the bay it's in */
      const src = NEED_PILE[j.needs] || j.part;
      for (const b of agents.values()) if (b !== a && b.job) { if ((NEED_PILE[b.job.needs] || b.job.part) === src) s += 7; if (Math.abs(b.job.x - j.x) < 5 && b.job.level === j.level) s += 9; }
      if ((a.carry === 'shovel' && j.needs === 'shovel') || (a.carry === 'spool' && j.needs === 'spool')) s -= 18;
      if (a.vehicle === exc && j.kind === 'dig') s -= 200;
      if (s < bs) { bs = s; best = j; }
    }
    if (!best || !B().claim(best.id, a.id)) return null;
    const st = stage();
    a.job = Object.assign({}, best, { stage: st.phase + ':' + st.floor }); a.role = 'lead';
    return a.job;
  }
  /* put away what the next job doesn't need; climb out of a machine; hat on */
  function prefix(a, j) {
    const out = [];
    if (a.vehicle === exc && !(j && j.kind === 'dig')) out.push({ k: 'drive', x: PARK_EXC[0], y: PARK_EXC[1], say: 'parking the excavator' }, call(() => dismount(a)));
    if (!a.hat) out.push(D(a, 'stand', 0.6, { hat: true, carry: a.carry === 'hat' ? null : a.carry, say: 'putting the hard hat on' }));
    const c = a.carry;
    if (c && c !== 'hat' && !(j && ((c === 'shovel' && j.needs === 'shovel') || (c === 'spool' && j.needs === 'spool')))) {
      const home = TOOL_HOME[c] ? wspot(...TOOL_HOME[c]) : null;
      if (home) out.push(go(home[0] + 3, home[1] + 4, 'ground', 'putting the ' + (c === 'spool' ? 'wire' : c) + ' back'), D(a, 'bend', 0.6, { carry: null }));
      else out.push(D(a, 'bend', 0.5, { carry: null }));
    }
    return out;
  }

  /* ================================================================ plan */
  function plan(a) {
    if (a.borrowed) { const cb = a.borrowed.done; a.borrowed = null; if (cb) { try { cb(a.id); } catch (e) { console.error(e); } } }
    a.doing = null;
    if (a.npc) return planYard(a);
    if (a.state === 'away') { a.plan.push(...awayChain(a)); return; }
    if (a.state === 'off') { a.plan.push(...leaveChain(a)); return; }
    if (a.state !== 'working') return;
    if (joinPending(a)) return;
    if (a.workT >= a.breakAt && !a.vehicle) {
      a.workT = 0; a.breakAt = 150 + a.r() * 170;
      a.plan.push(...prefix(a, null), ...breakChain(a));
      return;
    }
    /* lunch, most days between quarter to twelve and quarter past one */
    const h = hour();
    if (h >= 11.75 && h < 13.25 && !a.vehicle && a.workT > 40 && a.lunchDay !== K.now().toDateString() && a.r() < 0.35) {
      a.workT = 0;
      a.plan.push(...prefix(a, null), ...breakChain(a, true));
      return;
    }
    const j = a.task === 'haul' && a.r() < 0.2 ? null : pickJob(a);
    if (j) {
      a.doing = 'job';
      const c = chainFor(a, j);
      a.plan.push(...prefix(a, j), ...c);
      return;
    }
    a.plan.push(...prefix(a, null), ...filler(a));
    a.workT += 8;
  }
  function awayChain(a) {
    a.doing = 'break';
    const seat = spot('canteen', a.me ? 'seat1' : pick(a, ['seat2', 'seat3']));
    const out = [];
    const near = Math.abs(a.x - seat[0]) < 2 && Math.abs(a.y - seat[1]) < 2;
    if (!near) {
      if (a.level !== 'ground') out.push(go(ladderX(), null, 'ground', 'climbing down the stair tower'));
      if (a.carry && a.carry !== 'thermos') out.push(D(a, 'bend', 0.5, { carry: null }));
      if (!a.hat) out.push(D(a, 'stand', 0.5, { hat: true }));
      out.push(go(seat[0], seat[1], 'ground', 'heading to the canteen'), D(a, 'bend', 0.5, { carry: 'thermos', say: 'pouring a cup from the thermos' }));
    }
    out.push(D(a, 'sit', 8, { carry: 'thermos', face: 1, say: 'on a break at the canteen, looking at the lake' }), D(a, 'drink', 2.4), D(a, 'sit', 9, { face: 1 }), D(a, 'look', 1.4, { face: 0 }));
    return out;
  }
  function leaveChain(a) {
    a.doing = 'leave';
    const out = [];
    if (a.vehicle === exc) out.push(D(a, 'stand', 0.3), call(() => dismount(a)));
    if (a.level !== 'ground') out.push(go(ladderX(), null, 'ground', 'climbing down the stair tower'));
    out.push(D(a, 'bend', 0.6, { carry: null, held: null, say: 'putting the tools down' }),
      D(a, 'stand', 1, { face: 0, hat: false, carry: 'hat', say: 'knocking off for the day' }));
    const side = a.x > (ZONES.gate.spots.in[0] + ZONES.sidegate.spots.in[0]) / 2;
    const g = side ? ZONES.sidegate.spots : ZONES.gate.spots;
    out.push(go(g.in[0], g.in[1], 'ground', side ? 'heading out the side gate' : 'heading out the gate'), D(a, 'wave', 1.3, { face: 0, say: 'waving goodnight' }),
      { k: 'walk', x: g.out[0], y: g.out[1], say: 'heading home along Lakeside Ave' }, { k: 'walk', x: side ? 980 : -70, y: g.out[1] }, { k: 'gone' });
    return out;
  }
  function enter(a, coffee) {
    abort(a);
    a.act = null;
    a.gone = false; a.hidden = false; a.level = 'ground'; a.hat = true; a.held = null; a.entering = true; a.workT = 0;
    const side = !a.me && (a.seed & 3) === 0;
    const g = side ? ZONES.sidegate.spots : ZONES.gate.spots;
    a.x = g.out[0] + (side ? 55 + (a.seed % 40) : -(45 + (a.seed % 40))); a.y = g.out[1];
    a.carry = coffee ? 'mug' : null; a.facing = side ? -1 : 1;
    a.say = 'walking in along Lakeside Ave';
    a.plan = [{ k: 'walk', x: g.out[0], y: g.out[1] }, { k: 'walk', x: g.in[0], y: g.in[1], say: 'coming in the gate' }];
    if (coffee) {
      const t = spot('canteen', 'table');
      a.plan.push(go(t[0] + (a.seed % 9) - 4, t[1] + 4, 'ground', 'bringing a coffee in'), D(a, 'drink', 2.2, { say: 'finishing a coffee before the shift' }),
        D(a, 'stand', 1.4, { face: 0 }), D(a, 'bend', 0.6, { carry: null, say: 'setting the cup down' }));
    } else a.plan.push({ k: 'walk', x: g.in[0] + (side ? -12 : 12), y: g.in[1] - 6 });
    a.plan.push(call(() => { a.entering = false; }));
  }
  function morning() { const h = hour(); return h >= 6 && h < 10; }

  /* release a builder's job and everything they were holding (a climb in progress finishes first) */
  function abort(a) {
    if (a.job) { B().release(a.job.id, a.id); a.job = null; a.role = null; }
    if (a.pair) breakPair(a);
    for (const p of pendingPairs) if (p.lead === a) p.open = false;
    if (barrow.user === a.id) {
      if (a.carry === 'barrow') { barrow.at = [a.x + a.facing * 6, Math.max(a.y, GROUND_Y + 8)]; a.carry = null; }
      else if (!barrow.at) barrow.at = barrow.home;
      barrow.user = null;
    }
    if (hoist.req && hoist.req.who === a.id && hoist.req.state === 'loading') hoist.req = null;
    takeLanded(a.id);
    for (const r of crane.queue.slice()) if (r.who === a.id) craneCancel(r);
    if (crane.cur && crane.cur.who === a.id) craneCancel(crane.cur);
    a.req = null;
    donePour(a);
    freeStations(a);
    if (exc.reserved === a.id) exc.reserved = null;
    if (a.vehicle) dismount(a);
    if (a.borrowed) { const cb = a.borrowed.done; a.borrowed = null; if (cb) { try { cb(a.id); } catch (e) { console.error(e); } } }
    if (a.carry === 'paneL' || a.carry === 'paneR' || a.carry === 'pane') a.carry = null;
    const keep = a.act && a.act.k === 'climb' ? a.act : null;
    a.plan = []; a.act = keep; a.held = null; a.hold = null; a.hidden = false; a.spotting = null; a.entering = false; a.doing = null;
  }

  /* place a builder straight into a job on first load, sometimes mid-way */
  function teleport(a, g) {
    a.level = g.level; a.x = g.x;
    a.y = g.level === 'ground' ? (g.y != null ? g.y : a.lane) : levelY(g.level);
  }
  function placeMid(a) {
    a.level = 'ground'; a.x = homeX(a) - 20 + (a.seed % 40); a.y = a.lane; a.gone = false;
    a.plan = []; a.act = null; a.workT = a.seed % 100;
    plan(a);
    const mi = a.plan.findIndex((x) => x.k === 'mark');
    if (a.job && mi >= 0 && a.r() < 0.6) {
      const m = a.plan[mi];
      a.plan.splice(0, mi + 1);
      a.carry = m.carry || null;
      if (m.fn) m.fn(a);
      const gi = a.plan.findIndex((x) => x.k === 'goto');
      if (gi >= 0) { teleport(a, a.plan[gi]); a.say = a.plan[gi].say || ''; a.plan.splice(0, gi + 1); }
      return;
    }
    const gi = a.plan.findIndex((x) => x.k === 'goto');
    if (gi >= 0 && a.plan.slice(0, gi).every((x) => x.k !== 'call')) { teleport(a, a.plan[gi]); a.say = a.plan[gi].say || ''; a.plan.splice(0, gi + 1); }
  }

  /* ================================================================ step */
  function route(a, g) {
    const out = [];
    const L = g.level;
    const gy = (y) => (y != null ? y : a.lane);
    if (a.level === L) { out.push({ k: 'walk', x: g.x, y: L === 'ground' ? gy(g.y) : null }); return out; }
    const lx = ladderX();
    const climbing = !!g.say && /^climbing/.test(g.say);
    const down = L === 'ground' || (a.level !== 'ground' && L < a.level);
    out.push({ k: 'walk', x: lx - 2.5, y: a.level === 'ground' ? levelY('ground') + 1.5 : null, say: climbing ? 'heading for the stair tower' : g.say });
    out.push({ k: 'ladder', up: !down, max: 90, lateSay: 'waiting for the ladder' });
    out.push({ k: 'climb', level: L, up: !down, say: down ? 'climbing down the stair tower' : climbing ? g.say : L >= floorsN() ? 'climbing up to the roof' : 'climbing up to ' + where(L) });
    out.push({ k: 'walk', x: g.x, y: L === 'ground' ? gy(g.y) : null, say: climbing ? 'walking along ' + where(L) : g.say });
    return out;
  }
  function begin(a, x) {
    if (x.say) a.say = x.say;
    if ('carry' in x) a.carry = x.carry;
    if ('held' in x) a.held = x.held;
    if (x.face != null) a.facing = x.face;
    if (x.hat != null) a.hat = x.hat;
    if (x.emote) a.emote = { icon: x.emote, until: a.t + (x.emoteDur || 2) };
    if (x.start) x.start(a);
  }
  function next(a) {
    if (!a.plan.length) plan(a);
    const x = a.plan.shift();
    if (!x) return false;
    if (x.k === 'goto') { if (x.say) a.say = x.say; a.plan.unshift(...route(a, x)); return true; }
    if (x.k === 'mark') return true;
    if (x.k === 'call') { if (x.say) a.say = x.say; x.fn(a); return true; }
    if (x.k === 'face') { a.facing = x.dir; return true; }
    if (x.k === 'emote') { a.emote = { icon: x.icon, until: a.t + (x.dur || 2) }; return true; }
    if (x.k === 'resume') { a.act = x.act; a.actT = x.actT; return true; }
    a.act = x; a.actT = 0;
    begin(a, x);
    if (x.k === 'sync') barrier(x.key, x.n).add(a.id);
    return true;
  }
  const barriers = new Map();
  function barrier(key, n) { let b = barriers.get(key); if (!b) { b = new Set(); b.n = n; b.t = K.t; b.done = 0; barriers.set(key, b); } return b; }

  function walk(a, x, dt) {
    const ty = a.level === 'ground' ? (x.y != null ? x.y : a.y) : levelY(a.level);
    const dx = x.x - a.x, dy = ty - a.y;
    const d = Math.sqrt(dx * dx + dy * dy * 1.8);
    let sp = a.speed * dt * (HEAVY[a.carry] ? 0.82 : 1) * (a.state === 'off' ? 0.85 : 1);
    if (x.pair && a.pair) sp = WALK * 0.85 * dt;
    if (d <= sp || d < 0.05) { a.x = x.x; a.y = ty; a.act = null; return; }
    a.x += dx / d * sp; a.y += dy / d * sp;
    if (Math.abs(dx) > 0.05) a.facing = dx > 0 ? 1 : -1;
    setPose(a, a.carry === 'barrow' ? 'push' : 'walk');
  }
  function climb(a, x, dt) {
    const ty = levelY(x.level);
    a.x = ladderX();
    const d = ty - a.y;
    setPose(a, 'climb');
    if (Math.abs(d) <= CLIMB * dt) { a.y = ty; a.level = x.level; a.act = null; return; }
    /* one at a time up the ladder: keep a body's length behind whoever is ahead */
    for (const b of agents.values()) {
      if (b === a || !b.act || b.act.k !== 'climb' || b.act.up !== x.up) continue;
      const ahead = x.up ? a.y - b.y : b.y - a.y;
      if ((ahead > 0 || (ahead === 0 && b.id < a.id)) && ahead < LADDER_GAP) { a.poseT -= dt; return; }
    }
    a.y += Math.sign(d) * CLIMB * dt;
  }
  /* may this builder start up (or down) the ladder now? Down-goers go first; nobody passes on it */
  function ladderFree(a, upward) {
    const gy = levelY('ground');
    for (const b of agents.values()) {
      if (b === a || b.gone || !b.act) continue;
      if (b.act.k === 'climb') {
        if (b.act.up !== upward) return false;
        if (upward ? gy - b.y < LADDER_GAP : b.y - a.y < LADDER_GAP && b.y >= a.y) return false;
      } else if (upward && b.act.k === 'ladder' && !b.act.up) return false;
    }
    return true;
  }
  function stepAgent(a, dt) {
    if (a.gone) return;
    a.poseT += dt; a.t += dt;
    if (a.dust > 0) a.dust -= dt;
    if (a.me && a.state === 'paused' && !(a.act && a.act.k === 'climb')) { hold(a, dt); return; }
    if (a.hold) unhold(a);
    if (a.react && K.t >= a.react.at) react1(a);
    let guard = 0;
    while (!a.act && guard++ < 12) if (!next(a)) break;
    if (!a.act) { setPose(a, 'stand'); return; }
    const x = a.act;
    a.actT += dt;
    switch (x.k) {
      case 'walk': walk(a, x, dt); break;
      case 'climb': climb(a, x, dt); break;
      case 'do':
        setPose(a, x.pose);
        if (x.work && a.job && a.role !== 'mate') B().work(a.job.id, lerp(x.work[0], x.work[1], clamp(a.actT / x.dur, 0, 1)));
        if (x.tick) x.tick(a, clamp(a.actT / x.dur, 0, 1));
        if (a.actT >= x.dur) { a.act = null; if (x.then) x.then(a); }
        break;
      case 'wait':
        if (x.lateSay && a.actT > 0.4) a.say = x.lateSay;
        if (x.prep && a.actT > 0.5) prep(a, x);
        else setPose(a, !x.pose || x.pose === 'stand' ? (a.actT % 6 > 5.1 ? 'look' : 'stand') : x.pose);
        if (x.face != null && !x.prep) a.facing = x.face;
        if (x.until(a)) { a.act = null; if (x.then) x.then(a); }
        else if (a.actT >= (x.max || 30)) { a.act = null; if (x.timeout) x.timeout(a); }
        break;
      case 'sync': {
        const b = barrier(x.key, x.n);
        if (b.size >= b.n) { a.act = null; b.done++; if (b.done >= b.n) barriers.delete(x.key); }
        else {
          if (x.prep && a.actT > 0.5 && a.carry !== 'paneL' && a.carry !== 'paneR') prep(a, x);
          else setPose(a, a.carry === 'paneL' || a.carry === 'paneR' ? 'stand' : (a.actT % 5 > 3.8 ? 'look' : 'stand'));
          if (a.actT > (x.max || 30)) { a.act = null; barriers.delete(x.key); if (x.timeout) x.timeout(a); }
        }
        break;
      }
      case 'drive': {
        const v = a.vehicle;
        if (!v) { a.act = null; break; }
        if (moveV(v, x.x, x.y, 9, dt, false, true)) { a.act = null; v.facing = x.face || -1; }
        a.x = v.x; a.y = v.y; a.level = 'ground';
        break;
      }
      case 'dig': {
        const v = a.vehicle;
        if (!v) { a.act = null; break; }
        v.digT += dt; v.digging = true;
        if (a.job) B().work(a.job.id, clamp(a.actT / x.dur, 0, 1));
        if (a.actT >= x.dur) { a.act = null; v.digging = false; }
        break;
      }
      case 'fdrive': {
        const tgt = typeof x.to === 'function' ? x.to() : x.to;
        if (!tgt) { a.act = null; break; }
        if (moveV(fork, tgt[0], tgt[1], 14, dt, false, true)) { a.act = null; if (tgt[2]) fork.facing = tgt[2]; }
        break;
      }
      case 'flift': {
        const d = x.to - fork.lift;
        if (Math.abs(d) <= dt * 4) { fork.lift = x.to; a.act = null; } else fork.lift += Math.sign(d) * dt * 4;
        break;
      }
      case 'ladder': {
        if (x.since == null) x.since = K.t;
        if (x.lateSay && a.actT > 0.6) a.say = x.lateSay;
        /* first come, first up: the rest wait in a short line beside the ladder */
        let idx = 0;
        for (const b of agents.values()) if (b !== a && b.act && b.act.k === 'ladder' && b.act.up === x.up && b.level === a.level && (b.act.since < x.since || (b.act.since === x.since && b.id < a.id))) idx++;
        if (idx === 0 && (ladderFree(a, x.up) || a.actT > (x.max || 90))) { a.act = null; next(a); break; }   // onto the ladder this tick, so the next in line sees it
        const tx = ladderX() + (x.up ? -2.5 - idx * 3.6 : 3 + idx * 3.6), d = tx - a.x;
        if (Math.abs(d) > 0.2) { a.x += Math.sign(d) * Math.min(Math.abs(d), WALK * 0.6 * dt); a.facing = Math.sign(d); setPose(a, 'walk'); }
        else { setPose(a, idx ? 'stand' : 'look'); a.facing = idx ? 1 : 0; }
        break;
      }
      case 'gone': a.gone = true; a.act = null; break;
      default: a.act = null;
    }
    if (a.vehicle) { a.x = a.vehicle.x; a.y = a.vehicle.y; }
  }

  /* the director's reactions: glance up and cheer for a moment at a safe point, then carry on */
  const REACT = { cheer: ['cheer', 1.6], look: ['look', 1.2], wave: ['wave', 1.4], clap: ['clap', 1.6] };
  function react1(a) {
    const x = a.act;
    const safe = !x || x.k === 'walk' && !x.pair || x.k === 'wait' || x.k === 'ladder' || (x.k === 'do' && !x.work && !a.pair);
    if (!safe) { if (K.t > a.react.at + 6) a.react = null; return; }
    const [pose, dur] = REACT[a.react.kind] || REACT.cheer;
    a.react = null;
    if (x) a.plan.unshift({ k: 'face', dir: a.facing || 1 }, { k: 'resume', act: x, actT: a.actT });
    a.act = { k: 'do', pose, dur: dur * (0.85 + a.r() * 0.3), face: 0 }; a.actT = 0;
    begin(a, a.act);
  }
  /* waiting on the crane, the hoist, the mixer or a partner: cycle through real prep, a plain line each */
  function prep(a, x) {
    const list = x.prep, k = Math.floor((a.actT - 0.5) / 2.8 + (a.seed % 3)) % list.length;
    if (x.prepK !== k) { x.prepK = k; a.say = list[k][1]; if (list[k][0] === 'look' || list[k][0] === 'signal') a.facing = a.facing || 1; }
    setPose(a, list[k][0]);
  }
  /* paused: tools down, turn, look at you; a blink, a small shrug, waiting dots */
  function hold(a, dt) {
    if (!a.hold) {
      a.hold = { t: 0, carry: a.carry, held: a.held, act: a.act, actT: a.actT, say: a.say };
      a.act = null;
      if (a.carry && a.carry !== 'paneL' && a.carry !== 'paneR' && a.carry !== 'hat' && !a.vehicle) {
        a.held = { name: a.carry, x: a.x + a.facing * 4, y: a.y, o: { down: true, load: barrow.load, facing: a.facing || 1 } };
        a.carry = null;
      }
      if (a.vehicle) a.vehicle.digging = false;
    }
    const h = a.hold;
    h.t += dt;
    a.say = 'waiting for you';
    if (a.vehicle) { setPose(a, 'sit'); return; }
    const c = h.t % 6.5;
    setPose(a, h.t < 0.5 ? 'bend' : c > 4 && c < 4.9 ? 'shrug' : 'look');
    if (h.t >= 0.5) a.facing = 0;
  }
  function unhold(a) {
    const h = a.hold; a.hold = null;
    if (h.act) a.plan.unshift({ k: 'resume', act: h.act, actT: h.actT });
    if (h.carry && h.carry !== a.carry) a.plan.unshift({ k: 'do', pose: 'bend', dur: 0.5, carry: h.carry, held: h.held, say: 'picking the tools back up' });
    else a.held = h.held;
    if (a.facing === 0) a.facing = 1;
    a.say = h.say;
  }

  /* ============================================================ vehicles */
  function moveV(v, tx, ty, speed, dt, rev, stop = true) {
    const dx = tx - v.x, dy = ty - v.y, d = Math.hypot(dx, dy);
    v.moving = false;
    if (d < 0.05) { v.x = tx; v.y = ty; v.vel = 0; return true; }
    const want = stop ? Math.min(speed, 1.2 + d * 1.4) : speed;
    v.vel = (v.vel || 0) + clamp(want - (v.vel || 0), -speed * 2.5 * dt, speed * 1.1 * dt);
    const s = Math.min(d, Math.max(0.4, v.vel) * dt);
    v.x += dx / d * s; v.y += dy / d * s; v.moving = true; v.rev = !!rev;
    if (!rev && Math.abs(dx) > 0.02) v.facing = dx > 0 ? 1 : -1;
    v.odo = (v.odo || 0) + s * (rev ? -1 : 1);
    if (s >= d - 1e-6) { v.x = tx; v.y = ty; return true; }
    return false;
  }
  function follow(v, dt) {
    const p = v.route[0];
    if (!p) return true;
    if (moveV(v, p.x, p.y, p.speed || v.speed, dt, p.rev, v.route.length === 1)) { v.route.shift(); if (p.then) p.then(v); }
    return !v.route.length;
  }
  function mount(a, v) {
    a.vehicle = v; v.driver = a.id; if (v === exc) exc.reserved = null;
    a.x = v.x; a.y = v.y; a.hidden = true; a.level = 'ground';
  }
  function dismount(a) {
    const v = a.vehicle; if (!v) return;
    v.driver = null; v.digging = false; a.vehicle = null; a.hidden = false;
    a.x = v.x + (v === fork ? 6 : 9); a.y = v.y - 1;
  }
  const camL = () => K.cam.x, camR = () => K.cam.x + K.view.W;
  function anyoneWorking() { for (const a of agents.values()) if (!a.npc && !a.gone && a.state === 'working') return true; return false; }
  function spotterBusy(what) { for (const a of agents.values()) if (a.spotting === what) return true; return false; }
  function spotterReady(what) { for (const a of agents.values()) if (a.spotting === what && a.act && a.act.k === 'wait') return true; return false; }

  /* -- the delivery truck: along Lakeside Ave, backs in through the gate with
        the yard hand spotting, the forklift unloads it, it pulls out */
  const truck = { kind: 'truck', state: 'gone', x: -100, y: 511, facing: -1, vel: 0, route: [], load: [], t: 0, cool: 4, speed: 28, rev: false, waitT: 0, moving: false };
  function dispatchTruck() {
    const load = truckQueue.splice(0, 2);
    if (!load.length) return;
    truck.load = load; truck.state = 'arrive'; truck.t = 0;
    truck.x = clamp(camR() + 50, 220, 980); truck.y = 511; truck.facing = -1; truck.vel = 24;
    truck.route = [{ x: 34, y: 511, speed: 28 }];
  }
  function stepTruck(dt) {
    truck.t += dt;
    switch (truck.state) {
      case 'gone':
        truck.moving = false;
        truck.cool -= dt;
        if (truck.cool <= 0 && truckQueue.length && (anyoneWorking() || truckForced)) { truckForced = false; dispatchTruck(); }
        break;
      case 'arrive': if (follow(truck, dt)) { truck.state = 'waitSpot'; truck.waitT = 0; } break;
      case 'waitSpot':
        truck.waitT += dt;
        if (spotterReady('truck') || truck.waitT > 9) { truck.state = 'backIn'; truck.route = [{ x: 66, y: 501, rev: true, speed: 8 }, { x: 100, y: 487, rev: true, speed: 8 }, { x: 128, y: 478, rev: true, speed: 6 }]; }
        break;
      case 'backIn': if (follow(truck, dt)) { truck.state = 'parked'; truck.t = 0; } break;
      case 'parked':
        if (!truck.load.length && fork.load == null && truck.t > 2) {
          truck.state = 'leave';
          truck.route = [{ x: 102, y: 486, speed: 6 }, { x: 68, y: 500, speed: 7 }, { x: 30, y: 511, speed: 10 }, { x: Math.min(camL() - 60, -60), y: 511, speed: 28 }];
        }
        if (truck.t > 90) truck.load.length = 0;          // nobody came to unload: it leaves (never stuck)
        break;
      case 'leave': if (follow(truck, dt)) { truck.state = 'gone'; truck.cool = 8; } break;
      default: truck.state = 'gone';
    }
  }

  /* -- the forklift and the yard hand who drives it (and spots the trucks) */
  const fork = { kind: 'forklift', x: PARK_FORK[0], y: PARK_FORK[1], facing: -1, vel: 0, lift: 0, load: null, driver: null, shuttleT: 30, moving: false };
  function pileTarget(kind, from) {
    const p = PILE_AT[kind] ? wspot(...PILE_AT[kind]) : spot('staging', 'drop');
    const dir = p[0] >= from ? 1 : -1;
    return [p[0] - dir * 9, GROUND_Y + 34, dir];
  }
  function planYard(a) {
    const mounted = a.vehicle === fork;
    const mountSteps = () => (a.vehicle === fork ? [] : [go(fork.x + 6, fork.y - 1, 'ground', 'heading back to the forklift'), D(a, 'climb', 0.6, { then: () => mount(a, fork) })]);
    if (truck.state === 'arrive' || truck.state === 'waitSpot' || truck.state === 'backIn') {
      const sp = spot('staging', 'spotter');
      if (mounted) a.plan.push(D(a, 'stand', 0.4, { then: () => dismount(a) }));
      a.plan.push(go(sp[0], sp[1], 'ground', 'heading over to spot the truck'),
        call(() => { a.spotting = 'truck'; }),
        W(() => truck.state === 'backIn' || truck.state === 'parked' || truck.state === 'gone', { pose: 'wave', face: -1, max: 40, say: 'waving the truck in' }),
        W(() => truck.state === 'parked' || truck.state === 'gone', { pose: 'signal', face: -1, max: 40, say: 'spotting the truck back through the gate' }),
        call(() => { a.spotting = null; }));
      return;
    }
    if (truck.state === 'parked' && truck.load.length) {
      a.plan.push(...mountSteps(),
        { k: 'fdrive', to: () => [truck.x + 26, GROUND_Y + 34, -1], say: 'driving the forklift to the truck' },
        { k: 'flift', to: 3.5, say: 'lifting a pallet off the truck' },
        call(() => { fork.load = truck.load.shift() || null; }),
        { k: 'flift', to: 1.2 },
        { k: 'fdrive', to: () => (fork.load ? pileTarget(fork.load, fork.x) : null), say: 'moving a pallet to the stacks' },
        { k: 'flift', to: 0, say: 'setting the pallet down' },
        call(() => { if (fork.load && K.world.add) K.world.add(fork.load); fork.load = null; }));
      return;
    }
    if (!mounted) { a.plan.push(...mountSteps()); return; }
    const gs = glassStageAt(), part = stage().part;
    if (gs && (part === 'glaze' || part === 'storefront') && glassStage.n < 2 && pileOf('glass') > 0) {
      a.plan.push({ k: 'fdrive', to: () => pileTarget('glass', fork.x), say: 'fetching a crate of glass for the hoist' }, { k: 'flift', to: 2.5 },
        call(() => { fork.load = 'glass'; use('glass'); }), { k: 'flift', to: 1 },
        { k: 'fdrive', to: [gs[0] + 11, GROUND_Y + 34, -1], say: 'staging glass by the hoist' }, { k: 'flift', to: 0 },
        call(() => { fork.load = null; glassStage.n = Math.min(4, glassStage.n + 3); }),
        { k: 'fdrive', to: [PARK_FORK[0], PARK_FORK[1], -1] });
      return;
    }
    if (Math.hypot(fork.x - PARK_FORK[0], fork.y - PARK_FORK[1]) > 1) { a.plan.push({ k: 'fdrive', to: [PARK_FORK[0], PARK_FORK[1], -1], say: 'parking the forklift' }); return; }
    fork.shuttleT -= 4;
    if (fork.shuttleT <= 0 && anyoneWorking()) {
      fork.shuttleT = 45 + a.r() * 50;
      const k = pick(a, ['lumber', 'brick', 'glass']), d = spot('staging', 'drop');
      a.plan.push({ k: 'fdrive', to: [d[0] + 10, GROUND_Y + 34, -1], say: 'shuttling pallets around the yard' }, { k: 'flift', to: 2.5 },
        call(() => { fork.load = k; }), { k: 'flift', to: 1 },
        { k: 'fdrive', to: () => pileTarget(k, fork.x) }, { k: 'flift', to: 0 }, call(() => { fork.load = null; }),
        { k: 'fdrive', to: [PARK_FORK[0], PARK_FORK[1], -1] });
      return;
    }
    a.plan.push(D(a, 'sit', 4, { say: 'waiting on the next delivery' }));
  }

  /* -- the mixer truck: in from the west, backs through the side gate, its
        chute follows the pour along the front of the pad */
  mixer.truck = { kind: 'mixerTruck', state: 'gone', x: -100, y: 511, facing: 1, vel: 0, route: [], queue: [], serving: null, atPour: false, flow: false, spin: 0, idleT: 0, waitT: 0, speed: 28, moving: false };
  function callMixer() {
    const m = mixer.truck;
    if (m.state !== 'gone') return;
    m.state = 'arrive'; m.x = clamp(camL() - 60, -80, 560); m.y = 511; m.facing = 1; m.vel = 24;
    m.route = [{ x: 694, y: 511, speed: 28 }];
  }
  function enqueuePour(a, j) {
    const m = mixer.truck;
    if (m.state === 'gone') callMixer();
    if (!m.queue.some((q) => q.a === a) && !(m.serving && m.serving.a === a)) m.queue.push({ a, j });
  }
  function donePour(a) {
    const m = mixer.truck;
    if (m.serving && m.serving.a === a) { m.serving = null; m.atPour = false; m.flow = false; }
    if (m.queue.length) m.queue = m.queue.filter((q) => q.a !== a);
  }
  function stepMixer(dt) {
    const m = mixer.truck;
    if (m.state !== 'gone') m.spin += dt * (m.flow ? 3.2 : 1.2);
    switch (m.state) {
      case 'gone': m.moving = false; break;
      case 'arrive': if (follow(m, dt)) { m.state = 'waitSpot'; m.waitT = 0; } break;
      case 'waitSpot':
        m.waitT += dt;
        if (spotterReady('mixer') || m.waitT > (spotterBusy('mixer') ? 8 : 2.5)) { m.state = 'backIn'; m.route = [{ x: 668, y: 501, rev: true, speed: 8 }, { x: 638, y: 491, rev: true, speed: 8 }, { x: 604, y: MIX_Y, rev: true, speed: 8 }]; }
        break;
      case 'backIn': if (follow(m, dt)) { m.state = 'onsite'; m.idleT = 0; } break;
      case 'onsite': {
        m.moving = false;
        if (!m.serving && m.queue.length) { let i = m.queue.findIndex((q) => q.a.me); if (i < 0) i = 0; m.serving = m.queue.splice(i, 1)[0]; m.atPour = false; }
        if (m.serving && (m.serving.a.gone || m.serving.a.job !== m.serving.j)) { m.serving = null; m.atPour = false; m.flow = false; }
        if (m.serving) {
          m.idleT = 0;
          const tx = m.serving.j.x + 20.5;
          if (!m.atPour && moveV(m, tx, MIX_Y, 7, dt, tx < m.x)) m.atPour = true;
          m.facing = 1;
        } else {
          /* columns: wait where the crane can reach the chute to fill its pour bucket */
          if (m.need > K.t) { m.idleT = 0; if (Math.abs(m.x - 522) > 0.1) moveV(m, 522, MIX_Y, 6, dt, 522 < m.x); m.facing = 1; }
          else m.idleT += dt;
          if (m.idleT > 14 && !m.queue.length) { m.state = 'leaving'; m.route = [{ x: 606, y: MIX_Y, speed: 7 }, { x: 640, y: 492, speed: 7 }, { x: 676, y: 508, speed: 8 }, { x: Math.max(camR() + 70, 760), y: 511, speed: 28 }]; }
        }
        break;
      }
      case 'leaving': m.flow = false; if (follow(m, dt)) { m.state = 'gone'; m.serving = null; m.queue = []; } break;
      default: m.state = 'gone';
    }
  }

  /* -- the excavator: on site for the early stages, one builder drives it */
  const exc = { kind: 'excavator', state: 'parked', x: PARK_EXC[0], y: PARK_EXC[1], facing: -1, vel: 0, route: [], driver: null, reserved: null, digT: 0, digging: false, speed: 7, moving: false };
  function stepExc(dt) {
    const early = !!EARLY[stage().phase];
    if (exc.state === 'gone') { if (early) { exc.state = 'parked'; exc.x = PARK_EXC[0]; exc.y = PARK_EXC[1]; exc.facing = -1; } return; }
    if (!early && exc.state !== 'leaving') {
      if (exc.driver) { const a = agents.get(exc.driver); if (a) abort(a); }
      exc.state = 'leaving'; exc.reserved = null;
      exc.route = [{ x: 630, y: 492, speed: 6 }, { x: 650, y: 506, speed: 6 }, { x: Math.max(camR() + 60, 780), y: 511, speed: 16 }];
    }
    if (exc.state === 'leaving') { if (follow(exc, dt)) exc.state = 'gone'; return; }
    if (!exc.driver) exc.moving = false;
    if (!exc.digging) exc.digT = Math.max(0, exc.digT - dt);
  }

  /* -- the material hoist (the building draws its mast and the landing cage; a load rides up it) */
  const hoist = { y: GROUND_Y - 1, req: null, landing: [], x: 527, top: GROUND_Y };
  function hoistLoad(a, j, load, h) { hoist.req = { who: a.id, level: j.level, load, state: 'loading', x: h.x, top: h.y }; hoist.x = h.x; hoist.top = h.y; }
  function hoistSend(a) { if (hoist.req && hoist.req.who === a.id) hoist.req.state = 'up'; }
  /* a load waits at the landing until its builder climbs up for it; the cage goes back down for the next */
  const landed = (id) => hoist.landing.some((l) => l.who === id);
  const sent = (id) => landed(id) || (!!hoist.req && hoist.req.who === id && hoist.req.state === 'up');
  function takeLanded(id) { const i = hoist.landing.findIndex((l) => l.who === id); if (i >= 0) hoist.landing.splice(i, 1); }
  function stepHoist(dt) {
    const r = hoist.req, base = GROUND_Y - 1;
    if (!r) { hoist.y = base; return; }
    if (r.state === 'up') {
      const ty = (r.top != null ? r.top : levelY(r.level)) - 1;
      if (Math.abs(hoist.y - ty) <= dt * 9) { hoist.landing.push({ who: r.who, load: r.load }); hoist.req = null; hoist.y = base; }
      else hoist.y += Math.sign(ty - hoist.y) * dt * 9;
    }
    if (hoist.req && hoist.req.state === 'loading' && !agents.has(hoist.req.who)) hoist.req = null;
    if (hoist.landing.length > 6) hoist.landing.shift();
  }

  /* -- the tower crane: mast by the building, jib over the pad and the prefab shed. It isn't
        there on the empty lot: it goes up section by section while the foundation cures. */
  const crane = { x: (BUILDING.x0 + BUILDING.x1) / 2, hy: 0, load: null, queue: [], cur: null, sway: 0, swayV: 0, vx: 0, idleT: 0, returning: false, jib: 0, erect: 0, built: false };
  function jibY() { return Math.round(Math.min(GROUND_Y - 44, (B().topY ? B().topY() : GROUND_Y - 60) - 13)); }
  /* where the hook's top sits above a load's base (the art hangs loads 7.5 below the hook top) */
  const HANG = { panel: 15, beam: 9.5, rebar: 9, pane: 15, topbeam: 9.5, cbucket: 14 };
  function mixerBucketAt() { const m = mixer.truck; return m.state === 'onsite' && !m.moving && !m.serving ? [m.x - 21, MIX_Y - 3] : null; }
  function craneRequest(a, load, from, to, auto) {
    const r = { who: a ? a.id : null, load, from, to, state: 'queued', attached: !!auto, auto: !!auto, released: false, dead: false, t: 0, a: 0 };
    crane.queue.push(r);
    return r;
  }
  function craneCancel(r) {
    r.dead = true;
    const i = crane.queue.indexOf(r); if (i >= 0) crane.queue.splice(i, 1);
    if (crane.cur === r) { crane.cur = null; crane.load = null; crane.returning = true; }
  }
  function craneRelease(r) { r.released = true; }
  function stepCraneErect(dt) {
    const want = !NO_CRANE[stage().phase] || crane.wanted > K.t;
    if (!want) { crane.erect = 0; crane.built = false; return; }
    if (crane.erect >= 1) return;
    /* a fresh page on a site that's already up: the crane is simply there */
    if (K.t < 4 || K.reduced) { crane.erect = 1; return; }
    crane.erect = Math.min(1, crane.erect + dt / 28);
    if (crane.erect >= 1) { crane.built = true; K.emit('crew:crane', { x: BUILDING.craneX }); }
  }
  function stepCrane(dt) {
    stepCraneErect(dt);
    const jy = jibY();
    crane.jib = jy;
    if (crane.erect < 1) { crane.hy = jy + 9; crane.load = null; return; }
    if (!crane.hy) crane.hy = jy + 9;
    const top = jy + 7;
    const x0 = crane.x;
    let r = crane.cur;
    if (!r && crane.queue.length) {
      /* your builder first, then whoever has waited longest (the queue is in arrival order) */
      let i = crane.queue.findIndex((q) => q.who === 'you');
      if (i < 0) i = 0;
      r = crane.cur = crane.queue.splice(i, 1)[0]; r.state = 'toPick'; crane.returning = false;
    }
    const fast = r && r.fast ? (r.fast === true ? 2.2 : r.fast) : 1;
    const mx = (x, sp0 = 24) => { const sp = sp0 * fast; const d = x - crane.x; const v = Math.min(sp, 1 + Math.abs(d) * 1.5) * dt; if (Math.abs(d) <= v + 0.02) { crane.x = x; return true; } crane.x += Math.sign(d) * v; return false; };
    const my = (y, sp0 = 16) => { const sp = sp0 * fast; const d = y - crane.hy; const v = Math.min(sp, 1 + Math.abs(d) * 1.6) * dt; if (Math.abs(d) <= v + 0.02) { crane.hy = y; return true; } crane.hy += Math.sign(d) * v; return false; };
    if (!r) {
      crane.idleT += dt;
      if (my(top + 2, 6)) crane.returning = false;
      if (crane.idleT > 18) mx(BUILDING.x1 - 18, 5);
    } else {
      crane.idleT = 0; r.t += dt;
      const h = r.hang || HANG[r.load] || 10;
      const from = typeof r.from === 'function' ? r.from() : r.from;
      switch (r.state) {
        case 'toPick': { if (!from) { if (r.t > 90) craneCancel(r); break; } const ux = my(top), xx = mx(from[0]); if (ux && xx) r.state = 'lower'; if (r.t > 90) craneCancel(r); break; }
        case 'lower': if (!from) { r.state = 'toPick'; break; } if (my(from[1] - h)) { r.state = 'atPick'; r.t = 0; r.pick = from; } break;
        case 'atPick':
          if (r.attached || (r.auto && r.t > 1) || (r.load === 'cbucket' && r.t > 1.6)) { crane.load = r.load; r.state = 'lift'; }
          else if (r.t > 70) craneCancel(r);
          break;
        case 'lift': { const ux = my(top); if (crane.hy < top + 22) { if (mx(r.to[0]) && ux) r.state = 'down'; } break; }   // swing over as soon as it clears
        case 'travel': if (mx(r.to[0])) r.state = 'down'; break;
        case 'down': if (my(r.to[1] - h - (r.part === 'deck' ? 9 : r.part === 'beam' ? 7 : 0))) { r.state = 'set'; r.t = 0; } break;
        case 'set': {
          /* handed over: the building draws the piece settling as the crew guides it; the hook follows its slings */
          if (r.handed) {
            crane.load = null;
            const e = r.a * r.a * (3 - 2 * r.a);
            const hy = r.part === 'deck' ? r.to[1] - 6.2 - 9 * (1 - e) : r.part === 'beam' ? r.to[1] - 7.6 - 7 * (1 - e) : r.to[1] - (r.hang || 10);
            my(hy, 6);
          }
          /* nobody there yet: set it down on the deck and go serve the next one (a lift cycle stays ~25 s) */
          if (!r.handed && !r.auto && r.load !== 'cbucket' && r.t > 4) {
            r.landed = true; crane.load = null; landedPieces.add(r); r.state = 'done';
            break;
          }
          if (r.released || (r.auto && r.t > 2.5) || r.t > 70) {
            r.state = r.back && r.pick ? 'back' : 'done';
            if (r.state === 'done') crane.load = null;
            if (r.onSet) r.onSet();
          }
          break;
        }
        case 'back': if (my(top) && mx(r.pick[0])) r.state = 'backDown'; break;
        case 'backDown': if (my(r.pick[1] - (HANG[r.load] || 10))) { crane.load = null; r.state = 'done'; } break;
        case 'done': if (my(top)) crane.cur = null; break;
        default: crane.cur = null;
      }
    }
    const v = (crane.x - x0) / Math.max(dt, 1e-3);
    const acc = (v - crane.vx) / Math.max(dt, 1e-3); crane.vx = v;
    crane.swayV += (-crane.sway * 2.2 - crane.swayV * 0.5 - clamp(acc, -60, 60) * 0.006) * dt;
    crane.sway = clamp(crane.sway + crane.swayV * dt, -0.3, 0.3);
  }
  const landedPieces = new Set();
  K.on('milestone', (m) => {
    if (!m || m.kind !== 'topped') return;
    /* topping out: the crane hoists the last beam, with a little tree on it, rigged beside the building */
    crane.erect = 1;
    const tb = B().topBeam ? B().topBeam() : { x: (BUILDING.x0 + BUILDING.x1) / 2 + 20, y: B().levelY(floorsN()) };
    const r = craneRequest(null, 'topbeam', [BUILDING.x1 - 6, GROUND_Y + 4], [tb.x, tb.y + 0.9], true);
    r.fast = true;
    crane.queue.splice(crane.queue.indexOf(r), 1); crane.queue.unshift(r);
    r.onSet = () => K.emit('crew:topbeam', { x: r.to[0], y: r.to[1] });
  });

  /* the yard hand: drives the forklift, spots the trucks (no name tag) */
  const yard = make('npc:yard', false, true);
  yard.colors = colorsFor('npc:yard', { hat: 'white', vest: 'orange' });
  agents.set(yard.id, yard);
  mount(yard, fork);

  /* ============================================================ the foreman */
  const foreman = { phase: 'in', t: 0, x: spot('office', 'door')[0], y: spot('office', 'door')[1] };
  function stepForeman(dt) {
    const f = foreman; f.t += dt;
    const door = spot('office', 'door'), out = spot('office', 'foreman');
    const ox = out[0] + 5, oy = out[1] + 1;
    switch (f.phase) {
      case 'in': f.x = door[0]; f.y = door[1]; if (K.S.whistle) { f.phase = 'out'; f.t = 0; } break;
      case 'out': { const k = Math.min(1, f.t / 0.8); f.x = lerp(door[0], ox, k); f.y = lerp(door[1], oy, k); if (k >= 1) { f.phase = 'raise'; f.t = 0; } break; }
      case 'raise': f.x = ox; f.y = oy; if (!K.S.whistle) { f.phase = 'nod'; f.t = 0; } break;
      case 'nod': if (K.S.whistle) { f.phase = 'raise'; f.t = 0; } else if (f.t > 1.6) { f.phase = 'back'; f.t = 0; } break;
      case 'back': { const k = Math.min(1, f.t / 0.8); f.x = lerp(ox, door[0], k); f.y = lerp(oy, door[1], k); if (K.S.whistle) { f.phase = 'out'; f.t = 0; } else if (k >= 1) { f.phase = 'in'; f.t = 0; } break; }
      default: f.phase = 'in';
    }
  }
  const foremanFig = { pose: 'stand', t: 0, facing: 0, colors: FOREMAN_COLORS, carry: 'mug', hat: true, blink: false, me: false };
  function drawForeman(ctx) {
    const f = foreman, o = foremanFig;
    o.t = f.t; o.blink = (f.t % 4.3) > 4.15;
    if (f.phase === 'in') { o.pose = (f.t % 9) > 7.4 ? 'drink' : 'stand'; o.facing = 0; o.carry = 'mug'; }
    else if (f.phase === 'out' || f.phase === 'back') { o.pose = 'walk'; o.facing = f.phase === 'out' ? 1 : -1; o.carry = null; }
    else if (f.phase === 'raise') { o.pose = 'raise'; o.facing = 0; o.carry = null; }
    else { o.pose = 'nod'; o.facing = 0; o.carry = null; }
    if (f.phase !== 'in') { const st = spot('office', 'step'); K.art.prop(ctx, 'mug', st[0] - 1, st[1] - 0.5, EMPTY); }
    K.art.figure(ctx, f.x, f.y, o);
    if (f.phase === 'in' && o.pose === 'stand') steam(ctx, f.x + 2.6, f.y - 9.5, f.t);
    if (f.phase === 'raise') rings(ctx, f.x + 3.2, f.y - 17, f.t);
  }
  function steam(ctx, x, y, t) {
    ctx.strokeStyle = K.pal.white; ctx.lineWidth = 0.35; ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const k = (t * 0.6 + i * 0.5) % 1;
      ctx.globalAlpha = 0.5 * (1 - k);
      const yy = y - k * 4, xx = x + i * 0.8;
      ctx.beginPath(); ctx.moveTo(xx, yy); ctx.quadraticCurveTo(xx + 0.9 * Math.sin(t * 3 + i), yy - 1, xx, yy - 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  /* the whistle's sound rings around the raised hand */
  function rings(ctx, x, y, t) {
    ctx.strokeStyle = (K.light.night || 0) > 0.5 ? EMIT.lamp : K.pal.white; ctx.lineCap = 'round'; ctx.lineWidth = 0.5;
    for (let i = 0; i < 3; i++) {
      const k = (t * 1.1 + i / 3) % 1;
      ctx.globalAlpha = 0.85 * (1 - k);
      ctx.beginPath(); ctx.arc(x, y, 2 + k * 6, -Math.PI * 0.85, -Math.PI * 0.15); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ============================================================ drawing */
  const POSES_DRAWN = Array.isArray(ART.POSES_DRAWN) ? ART.POSES_DRAWN : null;
  const CARRY_DRAWN = Array.isArray(ART.CARRY_DRAWN) ? ART.CARRY_DRAWN : null;
  function drawPose(p) { return p in POSE_FALLBACK && !(POSES_DRAWN && POSES_DRAWN.includes(p)) ? POSE_FALLBACK[p] : p; }
  function drawCarry(c) { return c && c in CARRY_FALLBACK && !(CARRY_DRAWN && CARRY_DRAWN.includes(c)) ? CARRY_FALLBACK[c] : c; }
  function blinkOf(a) { return ((a.t + (a.seed % 7)) % 4.1) < 0.13; }
  function drawAgent(ctx, a) {
    if (a.held) K.art.prop(ctx, a.held.name, a.held.x, a.held.y, a.held.o || EMPTY);
    if (a.hidden) return;
    const o = a.fig;
    o.pose = drawPose(a.pose); o.t = a.poseT; o.facing = FACE_YOU[a.pose] ? 0 : a.facing;
    o.colors = a.colors; o.carry = drawCarry(a.carry); o.hat = a.hat; o.blink = blinkOf(a); o.me = a.me;
    o.load = a.carry === 'barrow' ? barrow.load : null;
    o.paneW = a.carry === 'paneL' && a.pair && a.pair.mate ? clamp(Math.abs(a.pair.mate.x - a.x) - 2, 4, 14) : 8;
    o.shadow = !(a.pose === 'climb' || a.pose === 'sitbeam');
    K.art.figure(ctx, a.x, a.y, o);
    if (a.hold) K.art.emote(ctx, a.x, a.y - 23, 'dots', a.hold.t);
    else if (a.emote && a.t < a.emote.until) K.art.emote(ctx, a.x, a.y - 23, a.emote.icon, a.t);
    if (a.dust > 0 && a.pose === 'saw') sawdust(ctx, a);
  }
  function sawdust(ctx, a) {
    ctx.fillStyle = K.pal.timber;
    for (let i = 0; i < 4; i++) {
      const k = (a.t * 2.3 + i * 0.27) % 1;
      ctx.globalAlpha = 1 - k;
      ctx.fillRect(a.x + a.facing * 5 + (i - 1.5) * 0.7, a.y - 4 + k * 4, 0.5, 0.5);
    }
    ctx.globalAlpha = 1;
  }
  const forkO = { facing: -1, lift: 0, load: null, wheelT: 0 }, truckO = { facing: -1 }, mixO = { facing: 1 };
  const vehFig = { pose: 'sit', t: 0, facing: 1, colors: null, carry: null, hat: true, blink: false, me: false };
  function drawFork(ctx) {
    const d = fork.driver ? agents.get(fork.driver) : null;
    /* the art draws the forklift's driver itself; the yard hand is hidden while he drives */
    forkO.facing = fork.facing; forkO.lift = clamp(fork.lift / 3.5, 0, 1); forkO.load = fork.load; forkO.wheelT = fork.odo || 0; forkO.driver = d ? d.colors : null;
    K.art.prop(ctx, 'forklift', fork.x, fork.y, forkO);
    void d;
  }
  function drawTruck(ctx) {
    truckO.facing = truck.facing; truckO.load = truck.load[0] || null; truckO.n = 2 + truck.load.length; truckO.wheelT = truck.odo || 0; truckO.reverse = truck.rev && truck.moving; truckO.driver = DRIVER_COLORS;
    K.art.prop(ctx, 'truck', truck.x, truck.y, truckO);
  }
  function drawMixerTruck(ctx) {
    const m = mixer.truck;
    if (m.state === 'onsite' && m.serving && m.atPour) {
      /* the chute from the back of the drum out over the forms */
      const rx = m.x - 20.5, ry = m.y - 6.4, tx = m.serving.j.x, ty = (m.serving.j.y || GROUND_Y + 6) + 1;
      ctx.lineCap = 'round';
      ctx.strokeStyle = K.pal.ink; ctx.lineWidth = 1.9; ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(tx + 2, ty - 2); ctx.stroke();
      ctx.strokeStyle = K.pal.steel; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(tx + 2, ty - 2); ctx.stroke();
      if (m.flow) {
        ctx.strokeStyle = K.pal.concrete; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(rx - 0.5, ry - 0.3); ctx.lineTo(tx + 2, ty - 2.3); ctx.lineTo(tx + 1.5, ty + 0.5); ctx.stroke();
        ctx.fillStyle = K.pal.concreteShade; ctx.beginPath(); ctx.ellipse(tx + 1, ty + 0.6, 2.4 + Math.sin(m.spin * 2) * 0.3, 0.8, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    mixO.facing = m.facing; mixO.t = m.spin; mixO.wheelT = m.odo || 0; mixO.reverse = m.rev && m.moving; mixO.driver = DRIVER_COLORS;
    K.art.prop(ctx, 'mixerTruck', m.x, m.y, mixO);
  }
  function drawExc(ctx) {
    const e = exc, d = e.driver ? agents.get(e.driver) : null;
    /* the bucket cycle: reach out and down, curl, lift, dump */
    const k = (e.digT % 3.2) / 3.2;
    let boom = 0.55, stick = 1.0, bucket = 0.3;
    if (e.digging || e.digT > 0) {
      if (k < 0.35) { const q = k / 0.35; boom = lerp(0.55, 0.12, q); stick = lerp(1.0, 1.45, q); bucket = lerp(0.3, -0.4, q); }
      else if (k < 0.6) { const q = (k - 0.35) / 0.25; boom = 0.12; stick = lerp(1.45, 1.1, q); bucket = lerp(-0.4, 1.3, q); }
      else if (k < 0.85) { const q = (k - 0.6) / 0.25; boom = lerp(0.12, 0.75, q); stick = lerp(1.1, 0.8, q); bucket = 1.3; }
      else { const q = (k - 0.85) / 0.15; boom = lerp(0.75, 0.55, q); stick = lerp(0.8, 1.0, q); bucket = lerp(1.3, -0.3, q); }
    }
    if (hasProp('excavator')) K.art.prop(ctx, 'excavator', e.x, e.y, { facing: e.facing, boom, stick, bucket, t: e.odo || 0, driver: d ? d.colors : null, moving: e.moving });
    else drawExcavator(ctx, e, boom, stick, bucket, d);
    if (d && d.hold) K.art.emote(ctx, e.x, e.y - 22, 'dots', d.hold.t);
    if (e.digging && k > 0.86 && k < 0.98) {
      ctx.fillStyle = K.pal.dirtDark;
      const bx = e.x + e.facing * 8, by = e.y - 12 + (k - 0.86) * 60;
      for (let i = 0; i < 3; i++) ctx.fillRect(bx + i * 0.9 - 1, by + i * 0.6, 0.8, 0.8);
    }
  }
  /* a small excavator in the house style (art can take it over as prop 'excavator');
     local +x is forward, the arm reaches forward */
  function drawExcavator(ctx, e, boom, stick, bucket, d) {
    ctx.save(); ctx.translate(e.x, e.y); ctx.scale(e.facing || 1, 1);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = K.pal.ink; ctx.lineWidth = 0.45;
    ctx.fillStyle = K.pal.tire; rr(ctx, -9, -3.4, 18, 3.4, 1.7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = K.pal.steel;
    const o = (((e.odo || 0) % 3) + 3) % 3;
    for (let i = -7.5; i <= 7.5; i += 3) { ctx.beginPath(); ctx.arc(i + (o - 1.5) * 0.2, -1.7, 0.7, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = K.pal.fork; rr(ctx, -7, -8.4, 13.5, 5, 1); ctx.fill(); ctx.stroke();
    ctx.fillStyle = K.pal.craneDark; rr(ctx, -8.6, -8, 3.4, 4.2, 1); ctx.fill(); ctx.stroke();
    ctx.fillStyle = K.pal.fork; rr(ctx, -4.5, -15, 6.5, 7, 1.2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = (K.light.night || 0) > 0.5 ? EMIT.winLit : K.pal.glassHi; rr(ctx, -2.2, -14.2, 3.6, 3.8, 0.6); ctx.fill();
    if (d) {
      ctx.fillStyle = d.colors.skin; ctx.beginPath(); ctx.arc(-0.4, -11.8, 1.1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = d.colors.hat; ctx.beginPath(); ctx.arc(-0.4, -12.4, 1.25, Math.PI, 0); ctx.fill();
    }
    /* boom up and forward from the pivot, stick hanging down to the bucket */
    const px = 3, py = -8.5;
    const ex = px + Math.cos(boom) * 8, ey = py - Math.sin(boom) * 8;
    const sx = ex + Math.cos(stick) * 7, sy = ey + Math.sin(stick) * 7;
    ctx.strokeStyle = K.pal.ink; ctx.lineWidth = 2.1;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.lineTo(sx, sy); ctx.stroke();
    ctx.strokeStyle = K.pal.fork; ctx.lineWidth = 1.35;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.lineTo(sx, sy); ctx.stroke();
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(bucket);
    ctx.fillStyle = K.pal.steel; ctx.strokeStyle = K.pal.ink; ctx.lineWidth = 0.45;
    ctx.beginPath(); ctx.moveTo(-0.6, -0.6); ctx.lineTo(2.6, 0.2); ctx.quadraticCurveTo(2.4, 2.6, -0.2, 2.4); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.restore();
  }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  /* crane: the lattice is cached (K.blit); trolley, cable, hook and load move */
  function drawCraneStatic(g, jy) {
    const mx = BUILDING.craneX, top = jy - 14;
    const tip = CRANE_TIP, tail = CRANE_TAIL;
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.fillStyle = K.pal.concreteShade; g.fillRect(mx - 3, GROUND_Y - 1.5, 10, 3);
    /* mast: two rails and a zigzag */
    g.strokeStyle = K.pal.craneDark; g.lineWidth = 0.55;
    g.beginPath();
    for (let y = GROUND_Y - 1, i = 0; y > jy + 3; y -= 4, i++) { g.moveTo(mx + (i % 2 ? 4 : 0), y); g.lineTo(mx + (i % 2 ? 0 : 4), Math.max(jy + 3, y - 4)); }
    g.stroke();
    g.strokeStyle = K.pal.crane; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(mx, GROUND_Y - 1); g.lineTo(mx, jy + 2); g.moveTo(mx + 4, GROUND_Y - 1); g.lineTo(mx + 4, jy + 2); g.stroke();
    /* turntable and the operator's cab */
    g.fillStyle = K.pal.craneDark; g.fillRect(mx - 1, jy + 1, 6, 2);
    g.fillStyle = K.pal.crane; g.strokeStyle = K.pal.ink; g.lineWidth = 0.4;
    rr(g, mx - 6.5, jy + 1.5, 6, 6, 1); g.fill(); g.stroke();
    g.fillStyle = K.pal.glassHi; rr(g, mx - 5.8, jy + 2.4, 3.6, 2.8, 0.5); g.fill();
    /* tower head */
    g.strokeStyle = K.pal.crane; g.lineWidth = 0.7;
    g.beginPath(); g.moveTo(mx, jy); g.lineTo(mx + 2, top); g.lineTo(mx + 4, jy); g.stroke();
    /* jib: bottom chord, sloping top chord, zigzag */
    const tY = (xx) => jy - lerp(1.6, 4.2, (xx - tip) / (mx - tip));
    g.strokeStyle = K.pal.craneDark; g.lineWidth = 0.4;
    g.beginPath();
    for (let x = mx, i = 0; x > tip + 2; x -= 5, i++) {
      const x2 = Math.max(tip, x - 5);
      if (i % 2) { g.moveTo(x, jy); g.lineTo(x2, tY(x2)); } else { g.moveTo(x, tY(x)); g.lineTo(x2, jy); }
    }
    g.stroke();
    g.strokeStyle = K.pal.crane; g.lineWidth = 0.75;
    g.beginPath(); g.moveTo(mx + 4, jy); g.lineTo(tip, jy); g.moveTo(mx, jy - 4.2); g.lineTo(tip, jy - 1.6); g.lineTo(tip, jy); g.stroke();
    /* counter-jib + counterweights */
    g.beginPath(); g.moveTo(mx + 4, jy); g.lineTo(tail, jy); g.moveTo(mx + 4, jy - 2.5); g.lineTo(tail, jy - 1.2); g.stroke();
    g.fillStyle = K.pal.concrete; g.strokeStyle = K.pal.ink; g.lineWidth = 0.35;
    for (let i = 0; i < 3; i++) { rr(g, tail - 13 + i * 4.2, jy + 0.3, 3.8, 6, 0.5); g.fill(); g.stroke(); }
    /* pendant ties */
    g.strokeStyle = K.pal.cable; g.lineWidth = 0.25;
    g.beginPath(); g.moveTo(mx + 2, top); g.lineTo(lerp(tip, mx, 0.35), tY(lerp(tip, mx, 0.35))); g.moveTo(mx + 2, top); g.lineTo(tail, jy - 1.2); g.stroke();
  }
  const craneItem = { y: GROUND_Y - 0.5, draw: (ctx) => drawCrane(ctx) };
  const hookO = { load: null };
  function drawCrane(ctx) {
    if (crane.erect <= 0) return;
    const jy = crane.jib || jibY(), mx0 = BUILDING.craneX;
    if (crane.erect < 1) {
      /* going up: the mast rises section by section with its climbing frame, then the jib swings out */
      const e1 = clamp(crane.erect / 0.72, 0, 1), sec = 4;
      const h = Math.ceil(((GROUND_Y - jy) * e1) / sec) * sec, topY = GROUND_Y - h;
      ctx.save(); ctx.beginPath(); ctx.rect(mx0 - 8, topY, 18, h + 3); ctx.clip();
      ctx.translate(0, topY - jy - 2 > 0 ? 0 : 0);
      drawCraneStatic(ctx, jy);
      ctx.restore();
      if (e1 < 1) {
        ctx.fillStyle = K.pal.crane; ctx.strokeStyle = K.pal.ink; ctx.lineWidth = 0.35;
        rr(ctx, mx0 - 1.2, topY - 3.2, 6.4, 3.4, 0.4); ctx.fill(); ctx.stroke();
      } else {
        const f = clamp((crane.erect - 0.72) / 0.28, 0, 1);
        ctx.save(); ctx.beginPath(); ctx.rect(mx0 - (mx0 - CRANE_TIP + 2) * f, jy - 16, (mx0 - CRANE_TIP + 2) * f + (CRANE_TAIL - mx0 + 2) * f + 4, 24); ctx.clip();
        drawCraneStatic(ctx, jy);
        ctx.restore();
      }
      return;
    }
    /* two thin cached layers (jib, mast): one big mostly-empty layer cost ~70 ms a frame at desktop zoom */
    K.blit('crew:crane:jib', CRANE_TIP - 2, jy - 16, CRANE_TAIL - CRANE_TIP + 4, 24, (g) => drawCraneStatic(g, jy), { ver: jy });
    K.blit('crew:crane:mast', mx0 - 8, jy + 8, 18, GROUND_Y - jy - 4, (g) => drawCraneStatic(g, jy), { ver: jy });
    const tx = crane.x;
    ctx.fillStyle = K.pal.craneDark; ctx.strokeStyle = K.pal.ink; ctx.lineWidth = 0.35;
    rr(ctx, tx - 2.4, jy + 0.2, 4.8, 1.8, 0.5); ctx.fill(); ctx.stroke();
    const len = crane.hy - jy;
    const hx = tx + Math.sin(crane.sway + Math.sin(K.t * 0.9) * 0.015) * len * 0.5;
    ctx.strokeStyle = K.pal.cable; ctx.lineWidth = 0.25;
    ctx.beginPath(); ctx.moveTo(tx - 0.7, jy + 2); ctx.lineTo(hx - 0.4, crane.hy); ctx.moveTo(tx + 0.7, jy + 2); ctx.lineTo(hx + 0.4, crane.hy); ctx.stroke();
    const L = crane.load, cur = crane.cur;
    const post = L === 'beam' && cur && cur.part === 'post';
    hookO.load = L === 'topbeam' ? 'beam' : L === 'cbucket' || post ? null : L;
    K.art.prop(ctx, 'hook', hx, crane.hy + 2.2, hookO);
    if (L === 'topbeam') {
      K.art.prop(ctx, hasProp('tree') ? 'tree' : 'plant', hx + 4.5, crane.hy + 7.9, topTreeO);
      K.art.prop(ctx, 'flag', hx - 5.5, crane.hy + 7.9, topFlagO);
    } else if (L === 'cbucket') drawBucketLoad(ctx, hx, crane.hy, cur);
    else if (post) drawPostLoad(ctx, hx, crane.hy);
    /* red light on top: blinks, and glows at night */
    const night = K.light.night || 0;
    const on = (K.t % 1.6) < 1.1;
    ctx.fillStyle = on ? EMIT.craneRed : K.pal.truckDark;
    ctx.beginPath(); ctx.arc(mx0 + 2, jy - 14.6, 0.7, 0, Math.PI * 2); ctx.fill();
    if (night > 0.25 && on) K.lights.push({ x: mx0 + 2, y: jy - 14.6, r: 5, a: 0.8 * night, color: EMIT.craneRed });
    if (night > 0.3 && anyoneWorking()) K.lights.push({ x: mx0 - 4, y: jy + 6, r: 60, a: 0.2 * night, color: EMIT.lamp });
  }
  const topTreeO = { small: true }, topFlagO = { h: 6 };
  /* the concrete pour bucket (a cone with a gate at the bottom), and a glulam post hanging upright */
  function drawBucketLoad(ctx, hx, hy, r) {
    const y0 = hy + 3.6;
    ctx.strokeStyle = K.pal.cable; ctx.lineWidth = 0.2;
    ctx.beginPath(); ctx.moveTo(hx, y0); ctx.lineTo(hx - 2.4, y0 + 2.6); ctx.moveTo(hx, y0); ctx.lineTo(hx + 2.4, y0 + 2.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hx - 3, y0 + 2.6); ctx.lineTo(hx + 3, y0 + 2.6); ctx.lineTo(hx + 1.1, y0 + 8.8); ctx.lineTo(hx - 1.1, y0 + 8.8); ctx.closePath();
    ctx.fillStyle = K.pal.steel; ctx.fill(); ctx.strokeStyle = K.pal.ink; ctx.lineWidth = 0.35; ctx.stroke();
    ctx.fillStyle = K.pal.concrete; ctx.fillRect(hx - 2.8, y0 + 2.6, 5.6, 0.7);
    if (r && r.pouring && r.state === 'set') {
      ctx.strokeStyle = K.pal.concreteShade; ctx.lineWidth = 0.9; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(hx, y0 + 9); ctx.lineTo(hx + Math.sin(K.t * 7) * 0.15, y0 + 13); ctx.stroke();
    }
  }
  function drawPostLoad(ctx, hx, hy) {
    const y0 = hy + 3.6, h = 11;
    ctx.strokeStyle = K.pal.cable; ctx.lineWidth = 0.2; ctx.beginPath(); ctx.moveTo(hx, y0); ctx.lineTo(hx, y0 + 0.8); ctx.stroke();
    ctx.fillStyle = K.pal.timber; ctx.strokeStyle = K.pal.ink; ctx.lineWidth = 0.3;
    rr(ctx, hx - 0.8, y0 + 0.8, 1.6, h, 0.2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = K.pal.timberShade; ctx.fillRect(hx + 0.3, y0 + 1, 0.4, h - 0.4);
  }
  /* a load riding the building's material hoist up to the landing */
  const hoistItem = { y: GROUND_Y - 0.2, draw: (ctx) => drawHoist(ctx) };
  const hoistLoadO = { w: 4.6, len: 6, n: 2 };
  function drawHoist(ctx) {
    const r = hoist.req, x = hoist.x + 1.4;
    if (r && r.load && r.state === 'up') {
      const y = hoist.y;
      ctx.fillStyle = K.pal.scaffold; ctx.strokeStyle = K.pal.ink; ctx.lineWidth = 0.3;
      rr(ctx, x - 2.8, y - 0.9, 5.6, 1, 0.25); ctx.fill(); ctx.stroke();
      K.art.prop(ctx, hoistProp(r.load), x, y - 0.9, hoistLoadO);
    }
    for (let i = 0; i < hoist.landing.length && i < 3; i++) K.art.prop(ctx, hoistProp(hoist.landing[i].load), x - i * 1.6, hoist.top - 1 - i * 0.4, hoistLoadO);
  }
  const glassO = { kind: 'glass', n: 2 }, flatO = { flat: true }, shortO = { len: 10 };
  const glassItem = { y: 0, draw: (ctx) => { const gs = glassStageAt(); if (!gs) return; glassO.n = Math.min(4, glassStage.n + 1); K.art.prop(ctx, 'pallet', gs[0], gs[1], glassO); } };
  const hoistProp = (l) => (l === 'panel' || l === 'pane' || l === 'bricks' ? l : 'beam');
  /* yard equipment: sawhorses, trestles, the mortar mixer */
  function buildStatics() {
    const add = (x, y, draw) => statics.push({ x, y, draw });
    for (const s of stations.saw) add(s[0], s[1] - 0.1, (ctx) => K.art.prop(ctx, 'sawhorse', s[0], s[1], EMPTY));
    for (const s of stations.trestle) add(s[0], s[1] - 0.1, (ctx) => { K.art.prop(ctx, 'sawhorse', s[0] - 4, s[1], EMPTY); K.art.prop(ctx, 'sawhorse', s[0] + 4, s[1], EMPTY); });
    const m = spot('masonry', 'mixer');
    const mo = { t: 0, spinning: false };
    add(m[0], m[1], (ctx) => { mo.t = mixer.t; mo.spinning = mixer.spinUntil > K.t; K.art.prop(ctx, 'mixer', m[0], m[1], mo); });
  }
  const barrowItem = { y: 0, draw: (ctx) => { const p = barrowPos(); barrowO.load = barrow.load; K.art.prop(ctx, 'barrow', p[0], p[1], barrowO); } };
  const barrowO = { load: null, facing: 1 };
  const saplingO = { potted: true };
  const saplingItem = { y: SAPLINGS[0][1], draw: (ctx) => { for (const s of SAPLINGS) K.art.prop(ctx, 'plant', s[0], s[1], saplingO); } };

  /* ---------------------------------------------------------- collect */
  function inView(x, m = 40) { return x > K.cam.x - m && x < K.cam.x + K.view.W + m; }
  const foremanItem = { y: 0, draw: drawForeman };
  function collect(list) {
    frameNo++;
    const night = K.light.night || 0;
    if (!statics.length) buildStatics();
    for (const s of statics) if (inView(s.x, 20)) list.push(s);
    if (barrow.at) { barrowItem.y = barrow.at[1]; if (inView(barrow.at[0])) list.push(barrowItem); }
    if (stage().phase === 'finish' && inView(SAPLINGS[1][0])) list.push(saplingItem);
    list.push(craneItem);
    for (const r of landedPieces) {
      if (r.dead || !agents.has(r.who)) { landedPieces.delete(r); continue; }
      if (!r.item) r.item = { y: 0, draw: (ctx) => K.art.prop(ctx, r.load === 'panel' ? 'panel' : 'beam', r.to[0] + 3, r.landY, r.load === 'panel' ? flatO : shortO) };
      r.landY = r.floorY != null ? r.floorY : r.to[1];
      r.item.y = r.landY - 0.1; if (inView(r.to[0])) list.push(r.item);
    }
    if (glassStage.n > 0) { const gs = glassStageAt(); if (gs && inView(gs[0])) { glassItem.y = gs[1]; list.push(glassItem); } }
    if (hoist.req || hoist.landing.length) { hoistItem.y = hoist.landing.length ? hoist.top : GROUND_Y - 0.2; list.push(hoistItem); }
    for (const a of agents.values()) {
      if (a.gone || a.vehicle) continue;
      if (a.hidden && !a.held) continue;
      if (!inView(a.x, 30)) continue;
      a.item.y = a.y;
      list.push(a.item);      // the world sorts the fence and the sidewalk in the same list
      if (night > 0.3 && !a.hidden && a.state === 'working' && !a.npc) {
        const L = a.light, busy = a.act && a.act.k === 'do' && a.job;
        L.x = a.x + (a.facing || 1) * (busy ? 3 : 1.5); L.y = a.y - (busy ? 7 : 12); L.r = busy ? 15 : 6; L.a = (busy ? 0.42 : 0.38) * night;
        K.lights.push(L);
      }
    }
    vehicle(list, fork, fork.item || (fork.item = { y: 0, draw: drawFork }));
    if (truck.state !== 'gone') vehicle(list, truck, truck.item || (truck.item = { y: 0, draw: drawTruck }));
    if (mixer.truck.state !== 'gone') vehicle(list, mixer.truck, mixer.truck.item || (mixer.truck.item = { y: 0, draw: drawMixerTruck }));
    if (exc.state !== 'gone') vehicle(list, exc, exc.item || (exc.item = { y: 0, draw: drawExc }));
    foremanItem.y = foreman.y;
    if (inView(foreman.x)) list.push(foremanItem);
    if (night > 0.3 && foreman.phase !== 'in') K.lights.push({ x: foreman.x, y: foreman.y - 8, r: 8, a: 0.35 * night });
  }
  function vehicle(list, v, item) {
    if (!inView(v.x, 45)) return;
    item.y = v.y;
    list.push(item);
    const night = K.light.night || 0;
    if (night > 0.3 && v.moving) K.lights.push({ x: v.x + (v.rev ? -v.facing : v.facing) * 15, y: v.y - 5, r: 14, a: 0.4 * night, color: v.rev ? EMIT.lampGlow : undefined });
  }
  /* kept for the interface: street traffic now sorts with the world's fence and sidewalk in collect() */
  function drawStreet() {}

  /* ---------------------------------------------------------- name tags */
  const placed = [];
  const tagOrder = [];
  function tagTextOf(a, followId) {
    const base = a.me ? (a.name || 'You') : a.name;
    if (!base && followId !== a.id) return '';
    const nm = base ? String(base).trim().slice(0, 16) : 'Neighbour';
    if (followId === a.id) { let j = a.job ? a.job.label : a.say; if (j && j.length > 34) j = j.slice(0, 33).replace(/[ ,]+\S*$/, '') + '…'; return j ? nm + ' · ' + j : nm; }
    return nm;
  }
  function overlaps(x, y, w, h) {
    for (let i = 0; i < placed.length; i += 4) {
      if (x < placed[i] + placed[i + 2] + 0.6 && x + w + 0.6 > placed[i] && y < placed[i + 1] + placed[i + 3] && y + h > placed[i + 1]) return true;
    }
    return false;
  }
  function drawTags(ctx, followId) {
    ctx.font = '600 3.7px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    placed.length = 0; tagOrder.length = 0;
    for (const a of agents.values()) {
      if (a.gone || a.npc || (a.hidden && !a.vehicle)) continue;
      if (!a.name && !a.me && followId !== a.id) continue;
      if (!inView(a.x, 10)) continue;
      tagOrder.push(a);
    }
    /* a quiet neighbourhood, not a crowd of labels: you, whoever you follow,
       and the few nearest the middle of the action (lead, 2026-10-21) */
    const me = agents.get('you'), cp = K.camPx || K.cam;
    const cx = me && !me.gone && inView(me.x, 0) ? me.x : cp.x + K.view.W / 2;
    tagOrder.sort((p, q) => (q.me - p.me) || ((q.id === followId) - (p.id === followId)) || (Math.abs(p.x - cx) - Math.abs(q.x - cx)));
    const cap = Math.max(4, Math.floor(K.view.W / 30));
    let shown = 0;
    const night = K.light.night || 0;
    for (const a of tagOrder) {
      if (!(a.me || a.id === followId) && shown >= cap) break;
      const text = tagTextOf(a, followId);
      if (!text) continue;
      if (text !== a.tagText) { a.tagText = text; a.tagW = ctx.measureText(text).width; }
      const w = a.tagW + 3.4, h = 5.2;
      const headY = a.vehicle ? a.y - (a.vehicle === exc ? 19 : 15) : a.y - (SIT[a.pose] ? 15 : 19.5);
      const x = a.x - w / 2;
      let y = headY - h;
      const important = a.me || a.id === followId;
      let ok = !overlaps(x, y, w, h);
      if (!ok) { y -= h + 0.8; ok = !overlaps(x, y, w, h); }
      if (!ok && !important) continue;
      placed.push(x, y, w, h);
      if (!important) shown++;
      ctx.fillStyle = a.me ? 'rgba(255,207,58,0.95)' : a.id === followId ? 'rgba(22,25,29,0.86)' : (night > 0.5 ? 'rgba(10,12,16,0.62)' : 'rgba(22,25,29,0.55)');
      rr(ctx, x, y, w, h, 2.2); ctx.fill();
      if (a.me) { ctx.beginPath(); ctx.moveTo(a.x - 1.2, y + h); ctx.lineTo(a.x, y + h + 1.3); ctx.lineTo(a.x + 1.2, y + h); ctx.fill(); }
      ctx.fillStyle = a.me ? '#2b1d1a' : '#f7f4ee';
      ctx.fillText(text, a.x, y + h / 2 + 0.2);
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }

  /* ============================================================ the API */
  let stageKey = '';
  function checkStage() {
    const s = stage(), k = s.phase + ':' + s.floor;
    if (k === stageKey) return;
    const was = stageKey; stageKey = k;
    if (!was) return;
    /* the town moved the building on: jobs from the old stage are gone */
    for (const a of agents.values()) if (a.job && a.job.stage !== k && a.state === 'working') abort(a);
  }
  function stepAll(dt) {
    checkStage();
    if (mixer.spinUntil > K.t) mixer.t += dt;
    stepForeman(dt);
    for (const a of agents.values()) {
      /* one builder's bad step never freezes the site: they drop the job and pick a new one */
      try { stepAgent(a, dt); } catch (e) { console.error(e); try { abort(a); a.act = null; } catch (e2) { a.plan = []; a.act = null; } }
    }
    for (const [id, a] of agents) if (a.gone && !a.me && !a.npc) { abort(a); agents.delete(id); }
    stepCrane(dt); stepHoist(dt); stepTruck(dt); stepMixer(dt); stepExc(dt);
    if (barriers.size > 40) for (const [k, b] of barriers) if (K.t - b.t > 120) barriers.delete(k);
  }
  function deliver(kind) {
    const k = ({ lumber: 'lumber', brick: 'brick', bricks: 'brick', glass: 'glass', copper: 'copper', nails: 'nails', rebar: 'rebar', stakes: 'stakes' })[kind] || 'lumber';
    if (K.reduced) { if (K.world.add) K.world.add(k); return; }
    if (!truckQueue.includes(k)) truckQueue.push(k);
    truckForced = true;
    if (truck.state === 'gone') truck.cool = 0;
  }
  const taskOk = (t) => SITE_TASKS.includes(t);

  const api = {
    setCrew(list) {
      const seen = new Set();
      for (const p of list) {
        const id = 'c:' + (p.id != null ? p.id : p.name); seen.add(id);
        let a = agents.get(id);
        const fresh = !a;
        if (!a) { a = make(id, false); agents.set(id, a); }
        a.look = p.look || {}; a.colors = colorsFor(id, a.look); a.name = p.name ? String(p.name) : null;
        a.task = taskOk(p.task) ? p.task : null;
        if (fresh) { if (K.t < 5) placeMid(a); else enter(a, morning()); }
        else if (a.state === 'off') {
          a.state = 'working';
          if (a.gone) enter(a, morning());
          else abort(a);
        }
      }
      for (const [id, a] of agents) if (!a.me && !a.npc && !seen.has(id) && a.state !== 'off') { abort(a); a.state = 'off'; }
    },
    setYou(y) {
      let a = agents.get('you');
      const fresh = !a;
      if (!a) { a = make('you', true); agents.set('you', a); }
      a.look = y.look || {}; a.colors = colorsFor('you', a.look); a.name = y.name ? String(y.name) : null;
      a.task = taskOk(y.task) ? y.task : null;
      const prev = fresh ? null : a.state, st = y.state;
      a.state = st;
      if (fresh) {
        if (st === 'working' || st === 'paused') placeMid(a);
        else if (st === 'away') { const s = spot('canteen', 'seat1'); a.x = s[0]; a.y = s[1]; a.carry = 'thermos'; }
        else a.gone = true;
        return;
      }
      if (prev === st) return;
      if (st === 'paused' && prev === 'working') return;     // stepAgent sets the tools down and turns to you
      if (st === 'working' && prev === 'paused') return;     // the hold lets go; they pick the tools back up
      if (a.hold) { if (a.hold.carry && !a.carry) a.carry = a.hold.carry; a.hold = null; }
      if (a.gone && (st === 'working' || st === 'away' || st === 'paused')) { enter(a, st !== 'away' && morning()); return; }
      abort(a);
      if (st === 'working' && a.carry === 'thermos') a.plan.push(D(a, 'bend', 0.6, { carry: null, say: 'putting the thermos down' }));
    },
    /* the director: everyone on site glances up and cheers (or looks, waves, claps) for a moment */
    react(kind) {
      let n = 0;
      for (const a of agents.values()) {
        if (a.gone || a.npc || a.vehicle || a.borrowed || a.hold || (a.state !== 'working' && a.state !== 'away')) continue;
        a.react = { kind: REACT[kind] ? kind : 'cheer', at: K.t + a.r() * 0.7 }; n++;
      }
      return n;
    },
    ids() { const out = []; for (const a of agents.values()) if (!a.npc && !a.gone) out.push(a.id); return out; },
    whistle(on) { if (!on && foreman.phase === 'raise') { foreman.phase = 'nod'; foreman.t = 0; } },
    deliver,
    step: stepAll,
    collect, drawTags, drawStreet,
    youPos() { const a = agents.get('you'); return a && !a.gone && a.state !== 'away' ? { x: a.x, y: a.y } : null; },
    posOf(id) { const a = agents.get(id); return a && !a.gone ? { x: a.x, y: a.y } : null; },
    hit(x, y) {
      let best = null, bd = 9;
      for (const a of agents.values()) {
        if (a.gone || a.npc || (a.hidden && !a.vehicle)) continue;
        const top = a.vehicle ? 20 : 16;
        if (y < a.y - top - 6 || y > a.y + 2) continue;
        const d = Math.abs(a.x - x) + Math.abs(a.y - 7 - y) * 0.35;
        if (d < bd) { bd = d; best = a; }
      }
      return best ? { id: best.id, name: best.me ? (best.name || 'You') : best.name, me: best.me } : null;
    },
    info(id) {
      const a = agents.get(id);
      if (!a) return null;
      const work = a.job ? a.job.label : null;
      const job = a.state === 'off' ? 'heading home' : a.say || work || 'between jobs';
      return { id, name: a.me ? (a.name || 'You') : a.name, job, work, me: a.me };
    },
    count: () => { let n = 0; for (const a of agents.values()) if (!a.npc && !a.gone) n++; return n; },
    debug: () => ({
      agents: [...agents.values()].map((a) => ({ id: a.id, x: Math.round(a.x), y: Math.round(a.y), level: a.level, state: a.state, pose: a.pose, carry: a.carry,
        job: a.job ? a.job.id : null, kind: a.job ? a.job.kind : null, role: a.role, say: a.say, act: a.act ? a.act.k : null, doing: a.doing,
        gone: a.gone, hidden: a.hidden, vehicle: a.vehicle ? a.vehicle.kind : null, name: a.name })),
      crane: { erect: +crane.erect.toFixed(2), x: Math.round(crane.x), hookY: Math.round(crane.hy), jib: crane.jib, load: crane.load, state: crane.cur ? crane.cur.state : 'idle', queue: crane.queue.length },
      truck: { state: truck.state, x: Math.round(truck.x), y: Math.round(truck.y), load: truck.load.slice(), queue: truckQueue.slice() },
      mixer: { state: mixer.truck.state, x: Math.round(mixer.truck.x), y: Math.round(mixer.truck.y), serving: mixer.truck.serving ? mixer.truck.serving.a.id : null, queue: mixer.truck.queue.length, atPour: mixer.truck.atPour, flow: mixer.truck.flow },
      fork: { x: Math.round(fork.x), y: Math.round(fork.y), lift: +fork.lift.toFixed(1), load: fork.load, driver: fork.driver },
      exc: { state: exc.state, x: Math.round(exc.x), y: Math.round(exc.y), driver: exc.driver, digging: exc.digging },
      hoist: { y: Math.round(hoist.y), req: hoist.req ? hoist.req.state : null, who: hoist.req ? hoist.req.who : null, landing: hoist.landing.map((l) => l.who + ':' + l.load) },
      barrow: { user: barrow.user, at: barrow.at },
      foreman: foreman.phase,
      pending: pendingPairs.length,
    }),
    crane: () => ({ x: crane.x, y: crane.jib, hookY: crane.hy, load: crane.load, phase: crane.cur ? crane.cur.state : 'idle' }),
    /* tests and the preview: run one job's chain on a builder now (job as from building.jobs()) */
    testJob(id, job, mateId) {
      const a = agents.get(id);
      if (!a || !job || a.npc) return false;
      abort(a);
      const st = stage();
      a.job = Object.assign({ crew: 1, level: 'ground', y: GROUND_Y + 6, label: job.kind }, job, { stage: st.phase + ':' + st.floor });
      a.role = 'lead'; a.doing = 'job';
      const m = mateId ? agents.get(mateId) : null;
      if (m && a.job.crew > 1) {
        abort(m);
        const pair = newPair(a, m, a.job);
        m.doing = 'job'; m.plan.push(...prefix(m, null), ...pairChain(m, pair, false));
        a.plan.push(...prefix(a, a.job), ...pairChain(a, pair, true));
        return true;
      }
      a.plan.push(...prefix(a, a.job), ...chainFor(a, a.job));
      return true;
    },
    idle: () => {
      const out = [];
      for (const a of agents.values()) if (!a.me && free(a)) out.push(a.id);
      for (const a of agents.values()) if (!a.me && !a.npc && !a.gone && a.state === 'working' && a.doing === 'break' && !a.borrowed && !a.job && !out.includes(a.id)) out.push(a.id);
      return out;
    },
    borrow(id, actions, onDone) {
      const a = agents.get(id);
      if (!a || a.me || a.npc || a.gone || a.job || a.state !== 'working' || a.borrowed || a.vehicle || a.pair || a.entering) return false;
      if (!Array.isArray(actions) || !actions.length) return false;
      const keepCarry = a.carry;
      abort(a);
      a.carry = HEAVY[keepCarry] ? null : keepCarry;
      for (const x of actions) {
        if (!x) continue;
        if (x.k === 'goto') a.plan.push(go(x.x, x.y, x.level == null ? 'ground' : x.level, x.say));
        else if (x.k === 'pose') { const d = { k: 'do', pose: x.pose || 'stand', dur: +x.dur || 1, say: x.say }; if ('carry' in x) d.carry = x.carry; a.plan.push(d); }
        else if (x.k === 'face') a.plan.push({ k: 'face', dir: x.dir });
        else if (x.k === 'emote') a.plan.push({ k: 'emote', icon: x.icon, dur: x.dur });
        else if (x.k === 'wait') a.plan.push({ k: 'do', pose: 'stand', dur: +x.dur || 1, say: x.say });
      }
      a.plan.push({ k: 'do', pose: 'stand', dur: 0.3, carry: null });
      a.borrowed = { done: onDone || null };
      a.doing = 'borrowed';
      a.say = (actions.find((x) => x && x.say) || {}).say || 'taking a short break';
      return true;
    },
  };
  /* tests opt in with window.__buildSiteDebug = true before load */
  if (typeof window !== 'undefined' && window.__buildSiteDebug) { window.__buildCrew = api; window.__buildK = K; }
  return api;
}
