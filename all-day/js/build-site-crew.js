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
       info(id) -> { id, name, job }        job in plain words: 'framing the 2nd floor'
       count(), debug()
       For the director (ambient life; never interrupt a job in progress):
       idle() -> [agent ids between jobs or on a break]
       borrow(id, actions, onDone) -> bool  run a short scripted errand when the agent is between steps
       actions: { k:'goto', x, y } { k:'pose', pose, dur, carry? } { k:'face', dir } { k:'emote', icon, dur } { k:'wait', dur }
     }
   THIS FILE IS A STUB from the v2 kernel: simple fetch -> carry -> work loops.
   The crew helper replaces it. */

import { GROUND_Y, YARD_FRONT, ZONES, BUILDING, SITE_TASKS, colorsFor, hash, rng, clamp } from './build-site-shared.js';

const WALK = 11, CLIMB = 8;
/* where each material comes from */
const SOURCE = { beam: ['lumber', 'rack'], panel: ['lumber', 'panels'], bricks: ['masonry', 'bricks'], spool: ['tools', 'shed'], pane: ['staging', 'drop2'],
  stakes: ['tools', 'shed'], shovel: ['tools', 'shed'], rebar: ['staging', 'drop'], formwork: ['lumber', 'rack'] };
const POSE = { stake: 'hammer', dig: 'shovel', rebar: 'kneel', form: 'hammer', pour: 'rake', frame: 'hammer', deck: 'hammer', wire: 'pullwire', brick: 'trowel', clad: 'drill', glaze: 'guide', solar: 'drill', plant: 'shovel' };

export function createCrew(K) {
  const agents = new Map();
  const foreman = { phase: 'in', t: 0 };
  function make(id, me) {
    const seed = hash(id);
    return { id, me, seed, r: rng(seed), look: {}, colors: colorsFor(id), name: null, task: null, x: 0, y: 0, level: 'ground',
      lane: GROUND_Y + 5 + (seed % 5) * 3, facing: 1, pose: 'stand', poseT: 0, carry: null, plan: [], act: null, job: null, state: 'working', gone: false };
  }
  const laneY = (a) => a.lane;
  function yOn(a) { return a.level === 'ground' ? laneY(a) : K.building.levelY(a.level); }
  function planFor(a) {
    if (a.state === 'away') { const [x] = ZONES.canteen.spots.seat1; return [{ k: 'goto', x, level: 'ground' }, { k: 'pose', pose: 'drink', dur: 8 }]; }
    if (a.state === 'off') return [{ k: 'goto', x: ZONES.gate.spots.in[0], level: 'ground' }, { k: 'goto', x: -20, level: 'ground' }, { k: 'gone' }];
    const jobs = K.building.jobs();
    if (!jobs.length) return [{ k: 'goto', x: BUILDING.x0 + (a.seed % 100), level: 'ground' }, { k: 'pose', pose: 'sweep', dur: 8 }];
    const pref = SITE_TASKS.includes(a.task) ? a.task : null;
    const want = { frame: ['frame', 'deck'], brick: ['brick'], wire: ['wire'], window: ['glaze'], roof: ['solar', 'deck'], haul: [] }[pref] || [];
    const home = BUILDING.x0 + (a.seed % 113);
    const j = jobs.slice().sort((p, q) => (want.includes(q.kind) - want.includes(p.kind)) || Math.abs(p.x - home) - Math.abs(q.x - home))[0];
    if (!K.building.claim(j.id, a.id)) return [{ k: 'pose', pose: 'stand', dur: 1 }];
    a.job = j;
    const plan = [];
    if (j.needs && SOURCE[j.needs]) { const [z, s] = SOURCE[j.needs]; const p = ZONES[z].spots[s]; plan.push({ k: 'goto', x: p[0], level: 'ground' }, { k: 'pose', pose: 'bend', dur: 1.2, then: () => { a.carry = j.needs === 'bricks' ? 'barrow' : j.needs; } }); }
    plan.push({ k: 'goto', x: j.x - 4, level: j.level }, { k: 'face', dir: 1 }, { k: 'pose', pose: POSE[j.kind] || 'hammer', dur: j.dur, then: () => { a.carry = null; K.building.complete(j.id); a.job = null; } });
    return plan;
  }
  function expand(a, act) {
    const out = [];
    if (act.level === a.level || (act.level === 'ground' && a.level === 'ground')) { out.push({ k: 'walk', x: act.x }); return out; }
    const L = K.building.ladder();
    out.push({ k: 'walk', x: L.x }, { k: 'climb', level: act.level }, { k: 'walk', x: act.x });
    return out;
  }
  function step(a, dt) {
    if (a.gone) return;
    a.poseT += dt;
    if (!a.act) { if (!a.plan.length) a.plan = planFor(a); a.act = a.plan.shift(); a.actT = 0; if (!a.act) return; if (a.act.k === 'goto') { a.plan.unshift(...expand(a, a.act)); a.act = null; return; } }
    const act = a.act; a.actT += dt;
    const fin = () => { a.act = null; };
    if (act.k === 'walk') {
      const d = act.x - a.x;
      if (Math.abs(d) < 0.3) { a.x = act.x; return fin(); }
      a.facing = d > 0 ? 1 : -1; a.x += Math.sign(d) * Math.min(Math.abs(d), WALK * dt); a.y = yOn(a);
      setPose(a, a.carry === 'barrow' ? 'push' : 'walk');
    } else if (act.k === 'climb') {
      const ty = act.level === 'ground' ? laneY(a) : K.building.levelY(act.level);
      a.y += Math.sign(ty - a.y) * Math.min(Math.abs(ty - a.y), CLIMB * dt); setPose(a, 'climb');
      if (Math.abs(ty - a.y) < 0.3) { a.y = ty; a.level = act.level; fin(); }
    } else if (act.k === 'face') { a.facing = act.dir; fin(); }
    else if (act.k === 'pose') { setPose(a, act.pose); if (a.job) K.building.work(a.job.id, clamp(a.actT / act.dur, 0, 1)); if (a.actT >= act.dur) { if (act.then) act.then(); fin(); } }
    else if (act.k === 'gone') { a.gone = true; fin(); }
    else if (act.k === 'hold') { setPose(a, 'look'); a.facing = 0; }
    else fin();
  }
  function setPose(a, p) { if (a.pose !== p) { a.pose = p; a.poseT = 0; } }
  function place(a) {
    a.level = 'ground'; a.x = BUILDING.x0 - 30 + (a.seed % 150); a.y = laneY(a);
  }
  function enter(a) { a.level = 'ground'; a.x = ZONES.gate.spots.in[0] - 30; a.y = laneY(a); a.plan = [{ k: 'goto', x: ZONES.gate.spots.in[0] + 20, level: 'ground' }]; a.act = null; a.gone = false; }

  function collect(list) {
    for (const a of agents.values()) {
      if (a.gone) continue;
      list.push({ y: a.y, draw: (ctx) => K.art.figure(ctx, a.x, a.y, { pose: a.pose, t: a.poseT, facing: a.pose === 'look' ? 0 : a.facing, colors: a.colors, carry: a.carry, hat: a.state !== 'off', me: a.me }) });
    }
    const [fx, fy] = ZONES.office.spots.foreman;
    const out = foreman.phase !== 'in';
    list.push({ y: fy, draw: (ctx) => K.art.figure(ctx, fx + (out ? 6 : 0), fy - (out ? 0 : 3), { pose: out ? 'raise' : 'drink', t: foreman.t, facing: 0, colors: { hat: '#f4f1e8', vest: '#ff8a2a', skin: '#ffdbac', hair: '#8a8a8a' }, carry: out ? null : 'mug' }) });
  }
  function drawTags(ctx, followId) {
    ctx.font = '600 4px system-ui, -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const a of agents.values()) {
      if (a.gone || (!a.name && !a.me)) continue;
      const text = a.me ? (a.name || 'You') : a.name;
      const full = followId === a.id && a.job ? text + ' · ' + a.job.label : text;
      const w = ctx.measureText(full).width + 3, x = a.x, y = a.y - 19;
      ctx.fillStyle = a.me ? 'rgba(255,207,58,0.95)' : 'rgba(22,25,29,0.7)';
      ctx.fillRect(x - w / 2, y - 2.6, w, 5.2);
      ctx.fillStyle = a.me ? '#2b1d1a' : '#f7f4ee'; ctx.fillText(full, x, y + 0.2);
    }
    ctx.textAlign = 'start';
  }
  return {
    setCrew(list) {
      const seen = new Set();
      for (const p of list) {
        const id = 'c:' + (p.id != null ? p.id : p.name); seen.add(id);
        let a = agents.get(id);
        if (!a) { a = make(id, false); agents.set(id, a); place(a); }
        a.look = p.look || {}; a.colors = colorsFor(id, a.look); a.name = p.name || null; a.task = p.task; if (a.state === 'off') { a.state = 'working'; enter(a); }
      }
      for (const [id, a] of agents) if (!a.me && !seen.has(id) && a.state !== 'off') { a.state = 'off'; a.plan = []; a.act = null; if (a.job) K.building.release(a.job.id); }
    },
    setYou(y) {
      let a = agents.get('you');
      if (!a) { a = make('you', true); agents.set('you', a); place(a); }
      a.look = y.look || {}; a.colors = colorsFor('you', a.look); a.name = y.name || null; a.task = y.task;
      const prev = a.state; a.state = y.state;
      if (y.state === 'paused') { a.plan = []; a.act = { k: 'hold' }; }
      else if (prev !== y.state) { a.plan = []; a.act = null; if (y.state === 'working' && (prev === 'off' || a.gone)) enter(a); }
    },
    whistle(on) { foreman.phase = on ? 'out' : 'in'; foreman.t = 0; },
    deliver(kind) { K.world.add(kind); },
    step(dt) { foreman.t += dt; for (const a of agents.values()) step(a, dt); for (const [id, a] of agents) if (a.gone && !a.me) agents.delete(id); },
    collect, drawTags,
    youPos() { const a = agents.get('you'); return a && !a.gone && a.state !== 'away' ? { x: a.x, y: a.y } : null; },
    posOf(id) { const a = agents.get(id); return a && !a.gone ? { x: a.x, y: a.y } : null; },
    hit(x, y) { let best = null, bd = 10; for (const a of agents.values()) { if (a.gone) continue; const d = Math.abs(a.x - x) + Math.abs(a.y - 7 - y) * 0.6; if (d < bd) { bd = d; best = a; } } return best ? { id: best.id, name: best.name, me: best.me } : null; },
    info(id) { const a = agents.get(id); return a ? { id, name: a.me ? (a.name || 'You') : a.name, job: a.job ? a.job.label : 'between jobs' } : null; },
    count: () => agents.size,
    debug: () => [...agents.values()].map((a) => [a.id, Math.round(a.x), Math.round(a.y), a.state, a.pose, a.job ? a.job.id : '-']),
    idle: () => [...agents.values()].filter((a) => !a.job && !a.gone && !a.me).map((a) => a.id),
    borrow() { return false; },
  };
  void YARD_FRONT;
}
