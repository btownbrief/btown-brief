/* build-site-director.js — the life around the work, and the milestones.

   The work is the story: glance down and your builder is mid-job. The
   director adds light ambient life around it, in the world, never taking the
   camera and never interrupting a job: a stray dog the crew slowly adopts
   over days, geese crossing, a rain shower with tarps, lunch together on a
   beam, a kid on the sidewalk waving, a snowman on a snow day, the late
   crew sharing a thermos. A day's schedule is seeded by the date, so every
   phone in town sees the same day. Arcs persist across days on this phone.

   Milestones (the first pour, a floor done, topping out) get a short moment:
   the director calls K.moment(x, y, seconds), which the kernel may refuse
   (first minute of a shift, the whistle, reduced motion).

   How a day is put together (every rule is in story-bible.md):
     rituals     run whenever their window is open: morning stretch, coffee at
                 ten and three, lunch, the golden-hour bench, the night thermos,
                 huddling under the awning in rain, tarps over the stacks, the
                 snowman on a snow day, watering the pot on the trailer step
     slot beats  every 3 minutes of the clock a seeded draw (dayKey + slot, the
                 same on every phone) may start one small thing: geese, a
                 sailboat, kitesurfers, a kid who waves, a gull after a
                 sandwich, raking leaves
     fixed days  the weekly inspector (a seeded weekday and hour), a birthday
                 cake (a seeded day, mid-afternoon)
     arcs        the stray dog (one step per day you open the site), the pot
                 (grows with the days since it was planted), the fence mural
                 (one painted panel per three posts in town, from world.js)
   Builders only ever come from K.crew.idle() (between jobs, on a break) via
   K.crew.borrow(); if nobody is free, a vignette plays without them or skips.

   INTERFACE:
     createDirector(K) -> {
       step(dt), collect(list)       extra characters and props (dog, geese, kid, cake, snowman, tarp)
       list() -> [{ id, title, kind: 'ambient'|'arc'|'milestone' }]
       play(id) -> bool              start one now (preview "jump to vignette", tests)
       debug() -> { today, active, arcs }
       Added in v2:
       drawBack(ctx)                 the far layer (geese, boats, kites): world.drawBack calls it
                                     before the yard, so they pass behind the building and sheds
     } */

import { GROUND_Y, YARD_FRONT, HORIZON, ZONES, BUILDING, EMIT, clamp, hash, rng, dayKey, rgba, hexRgb, rgbHex, floorBottom, SKINS, HAIRS } from './build-site-shared.js';

const STORE = 'bd-site-story';
const SLOT_MIN = 3;
const DOG_COAT = '#c08a4e';
const go = (x, y, level) => ({ k: 'goto', x, y, level: level == null ? 'ground' : level });
const pose = (p, dur, carry) => (carry === undefined ? { k: 'pose', pose: p, dur } : { k: 'pose', pose: p, dur, carry });
const face = (dir) => ({ k: 'face', dir });
const emote = (icon, dur = 1.6) => ({ k: 'emote', icon, dur });
const wait = (dur) => ({ k: 'wait', dur });
const hold = (what) => ({ k: 'pose', pose: 'stand', dur: 0.05, carry: what });   // pick something up and keep it while walking
const call = (fn) => ({ k: 'call', fn });

export function createDirector(K) {
  /* ------------------------------------------------ persistence */
  let story = { v: 1, days: [], dog: null, pot: null, snow: null, flag: null, done: {} };
  try { const s = JSON.parse(localStorage.getItem(STORE) || 'null'); if (s && s.v === 1) story = { ...story, ...s, done: s.done || {} }; } catch (e) { /* storage blocked: the arcs start fresh */ }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(story)); } catch (e) { /* fine */ } };

  /* ------------------------------------------------ the clock */
  let today = '', slot = -1, clockT = 0, override = { dog: null };
  const now = () => K.now();
  const hour = () => { const d = now(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };
  const month = () => now().getMonth();
  const weekday = () => { const d = now().getDay(); return d >= 1 && d <= 5; };
  const night = () => (K.light && K.light.night) || 0;
  const wet = () => !!(K.light && K.light.wet);
  const snowy = () => !!(K.light && K.light.snowy);
  const dayR = (salt) => rng(hash(today + ':' + salt));
  const dayHash = (salt) => hash(today + ':' + salt);
  const camMid = () => K.cam.x + K.view.W / 2;
  const inView = (x, pad = 0) => x > K.cam.x - pad && x < K.cam.x + K.view.W + pad;

  function newDay() {
    today = dayKey(now());
    if (!story.days.includes(today)) { story.days.push(today); story.days = story.days.slice(-90); }
    if (!story.dog) story.dog = { start: today, days: [] };
    if (!story.dog.days.includes(today)) { story.dog.days.push(today); story.dog.days = story.dog.days.slice(-8); }
    if (!story.pot) story.pot = { planted: today };
    for (const k of Object.keys(story.done)) if (story.done[k] !== today) delete story.done[k];
    save();
  }
  const dogStage = () => override.dog || clamp(story.dog ? story.dog.days.length : 1, 1, 6);
  function potStage() {
    if (!story.pot) return 0;
    const days = Math.max(0, Math.round((Date.parse(today) - Date.parse(story.pot.planted)) / 864e5));
    return clamp(Math.floor(days / 4) + 1, 1, 7);
  }

  /* ------------------------------------------------ borrowing builders */
  const borrowed = new Set();
  function idle() {
    if (!K.crew.idle || K.S.whistle) return [];
    return K.crew.idle().filter((id) => !borrowed.has(id) && id !== 'you' && K.crew.posOf(id));
  }
  function nearestIdle(x, n = 1, maxD = 1e9) {
    return idle().map((id) => [id, Math.abs(K.crew.posOf(id).x - x)]).filter((p) => p[1] <= maxD).sort((a, b) => a[1] - b[1]).slice(0, n).map((p) => p[0]);
  }
  /* run a script on a builder; { k:'call' } steps split it into chained borrows */
  function script(id, steps, onEnd) {
    const segs = [[]];
    for (const s of steps) { if (s.k === 'call') segs.push(s, []); else segs[segs.length - 1].push(s); }
    let i = 0;
    const next = () => {
      while (i < segs.length) {
        const seg = segs[i++];
        if (!Array.isArray(seg)) { try { seg.fn(id); } catch (e) { console.error(e); } continue; }
        if (!seg.length) continue;
        const ok = K.crew.borrow && K.crew.borrow(id, seg, () => { borrowed.delete(id); next(); });
        if (ok) { borrowed.add(id); return true; }
        borrowed.delete(id); if (onEnd) onEnd(id, false); return false;
      }
      if (onEnd) onEnd(id, true);
      return true;
    };
    return next();
  }
  function recruit(n, x, stepsFor, onEnd, maxD) {
    const got = [];
    for (const id of nearestIdle(x, n, maxD)) if (script(id, stepsFor(id, got.length), onEnd)) got.push(id);
    return got;
  }

  /* ------------------------------------------------ the active things */
  const active = new Map();        // id -> instance { step(dt) -> bool, collect?(list), back?(ctx), end?() }
  const marks = [];                // little wordless bubbles the director puts over people and things
  function bubble(x, y, icon, dur = 2.2, followId = null) { marks.push({ x, y, icon, t: 0, dur, followId }); }
  function start(id, force) {
    const v = V[id];
    if (!v || active.has(id)) return false;
    const inst = v.start(force);
    if (!inst) return false;
    inst.t = 0; inst.id = id;
    active.set(id, inst);
    return true;
  }
  function stop(id) { const a = active.get(id); if (!a) return; active.delete(id); if (a.end) try { a.end(); } catch (e) { console.error(e); } }

  /* ------------------------------------------------ small drawing helpers */
  let litGen = -1; const litCache = new Map();
  function lit(hex) {
    if (litGen !== K.gen) { litCache.clear(); litGen = K.gen; }
    let v = litCache.get(hex);
    if (!v) { const a = (K.light && K.light.ambient) || [1, 1, 1], c = hexRgb(hex); v = rgbHex([c[0] * a[0], c[1] * a[1], c[2] * a[2]]); litCache.set(hex, v); }
    return v;
  }
  function drawGoose(ctx, x, y, dir, ph) {
    const pal = K.pal, flap = Math.sin(ph);
    ctx.fillStyle = lit('#5a5048'); ctx.beginPath(); ctx.ellipse(x, y, 1.6, 0.6, 0, 0, 6.3); ctx.fill();
    ctx.strokeStyle = lit('#2a2622'); ctx.lineWidth = 0.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x + dir * 1.2, y - 0.1); ctx.lineTo(x + dir * 2.8, y - 0.5); ctx.stroke();
    ctx.fillStyle = pal.white; ctx.fillRect(x + dir * 2.4 - 0.25, y - 0.55, 0.5, 0.35);
    ctx.strokeStyle = lit('#6e645a'); ctx.lineWidth = 0.45;
    ctx.beginPath(); ctx.moveTo(x - dir * 0.2, y - 0.2); ctx.quadraticCurveTo(x - dir * 0.8, y - 1.6 * flap - 0.4, x - dir * 1.6, y - 2.4 * flap); ctx.stroke();
  }
  function drawGull(ctx, x, y, dir, ph, standing, sandwich) {
    const pal = K.pal, w = lit('#f4f4f0'), g = lit('#9aa4ae');
    if (standing) {
      ctx.fillStyle = w; ctx.beginPath(); ctx.ellipse(x, y - 2, 1.8, 1.1, 0, 0, 6.3); ctx.fill();
      ctx.beginPath(); ctx.arc(x + dir * 1.5, y - 3.2, 0.8, 0, 6.3); ctx.fill();
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x - dir * 0.5, y - 2.2, 1.4, 0.6, 0, 0, 6.3); ctx.fill();
      ctx.strokeStyle = pal.ink; ctx.lineWidth = 0.25; ctx.beginPath(); ctx.ellipse(x, y - 2, 1.8, 1.1, 0, 0, 6.3); ctx.stroke();
      ctx.strokeStyle = lit('#e3a03a'); ctx.lineWidth = 0.35; ctx.beginPath(); ctx.moveTo(x - 0.4, y - 1); ctx.lineTo(x - 0.4, y); ctx.moveTo(x + 0.5, y - 1); ctx.lineTo(x + 0.5, y); ctx.stroke();
    } else {
      const f = Math.sin(ph);
      ctx.strokeStyle = w; ctx.lineWidth = 0.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - 3, y - 1.6 * f); ctx.quadraticCurveTo(x - 1.4, y - 1, x, y); ctx.quadraticCurveTo(x + 1.4, y - 1, x + 3, y - 1.6 * f); ctx.stroke();
      ctx.fillStyle = w; ctx.beginPath(); ctx.ellipse(x, y + 0.2, 1.2, 0.5, 0, 0, 6.3); ctx.fill();
      ctx.strokeStyle = g; ctx.lineWidth = 0.25; ctx.beginPath(); ctx.moveTo(x - 3, y - 1.6 * f); ctx.lineTo(x - 2.2, y - 1.3 * f); ctx.moveTo(x + 3, y - 1.6 * f); ctx.lineTo(x + 2.2, y - 1.3 * f); ctx.stroke();
    }
    ctx.fillStyle = lit('#e3a03a'); ctx.fillRect(x + dir * (standing ? 2.2 : 1.2) - 0.3, y - (standing ? 3.3 : 0.1), 0.7, 0.35);
    if (sandwich) { ctx.fillStyle = lit('#e8c890'); ctx.fillRect(x + dir * (standing ? 2.6 : 1.6) - 0.6, y - (standing ? 3.4 : 0.2), 1.4, 0.9); ctx.fillStyle = lit('#6aa84f'); ctx.fillRect(x + dir * (standing ? 2.6 : 1.6) - 0.6, y - (standing ? 3 : -0.2), 1.4, 0.25); }
  }
  function steam(ctx, x, y) {
    const t = K.t; ctx.strokeStyle = rgba(K.pal.white, 0.5); ctx.lineWidth = 0.3; ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) { const p = (t * 0.4 + i * 0.5) % 1, sx = x + Math.sin(t * 1.5 + i * 2) * 0.6, sy = y - p * 5; ctx.globalAlpha = 1 - p; ctx.beginPath(); ctx.moveTo(sx, sy + 1.6); ctx.quadraticCurveTo(sx + 0.9, sy + 0.8, sx, sy); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------ the stray dog */
  const dog = { on: false, x: -30, y: 501, facing: 1, pose: 'stand', t: 0, tasks: [], task: null, emote: null, bandana: false, follow: null, plan: null, mode: '' };
  function dogTo(x, y, speed = 13) { dog.tasks.push({ k: 'go', x, y, speed }); }
  function dogDo(p, dur, extra) { dog.tasks.push({ k: 'pose', pose: p, dur, ...extra }); }
  function dogCall(fn) { dog.tasks.push({ k: 'call', fn }); }
  function stepDog(dt) {
    if (!dog.on) return;
    dog.t += dt;
    if (dog.emote) { dog.emote.t += dt; if (dog.emote.t > dog.emote.dur) dog.emote = null; }
    if (!dog.task) { dog.task = dog.tasks.shift() || null; if (dog.task) dog.task.t = 0; }
    const a = dog.task;
    if (!a) { if (dog.plan) dog.plan(); else { dog.pose = 'sit'; } return; }
    a.t += dt;
    if (a.k === 'go') {
      const dx = a.x - dog.x, dy = a.y - dog.y, d = Math.hypot(dx, dy);
      if (d < 0.4) { dog.x = a.x; dog.y = a.y; dog.task = null; return; }
      const s = Math.min(d, a.speed * dt);
      dog.x += dx / d * s; dog.y += dy / d * s;
      if (Math.abs(dx) > 0.2) dog.facing = dx > 0 ? 1 : -1;
      dog.pose = a.speed > 10 ? 'trot' : 'walk';
    } else if (a.k === 'pose') {
      dog.pose = a.pose; if (a.facing) dog.facing = a.facing;
      if (a.emote && a.t < dt * 1.5) dog.emote = { icon: a.emote, t: 0, dur: 2 };
      if (a.t >= a.dur) dog.task = null;
    } else if (a.k === 'follow') {
      const p = K.crew.posOf && K.crew.posOf(a.id);
      if (!p || a.t > a.dur) { dog.task = null; return; }
      const tx = p.x - (p.x > dog.x ? 7 : -7), ty = clamp(p.y + 1.5, GROUND_Y + 6, YARD_FRONT - 3);
      const dx = tx - dog.x, dy = ty - dog.y, d = Math.hypot(dx, dy);
      if (d > 1.2) { const s = Math.min(d, (d > 14 ? 15 : 9) * dt); dog.x += dx / d * s; dog.y += dy / d * s; dog.facing = Math.abs(p.x - dog.x) > 1 ? (p.x > dog.x ? 1 : -1) : dog.facing; dog.pose = d > 14 ? 'trot' : 'walk'; }
      else { dog.pose = 'sit'; dog.facing = p.x > dog.x ? 1 : -1; }
    } else if (a.k === 'call') { dog.task = null; try { a.fn(); } catch (e) { console.error(e); } }
  }
  const DOG_ENTRY = { gate: [[72, 501], [72, 491]], side: [[640, 501], [640, 491]] };
  function dogEnter(fromX) {
    const g = Math.abs(fromX - 72) < Math.abs(fromX - 640) ? 'gate' : 'side';
    const dir = fromX < camMid() ? -1 : 1;
    dog.on = true; dog.tasks = []; dog.task = null; dog.plan = null;
    dog.x = (dir < 0 ? K.cam.x - 16 : K.cam.x + K.view.W + 16); dog.y = 501.5;
    if (Math.abs(dog.x - DOG_ENTRY[g][0][0]) > 300) dog.x = DOG_ENTRY[g][0][0] + (dir < 0 ? -60 : 60);
    for (const [x, y] of DOG_ENTRY[g]) dogTo(x, y, 13);
    return g;
  }
  function dogLeave(then) {
    const g = Math.abs(dog.x - 72) < Math.abs(dog.x - 640) ? 'gate' : 'side';
    const [[ox, oy], [ix, iy]] = DOG_ENTRY[g];
    if (dog.y < YARD_FRONT) { dogTo(ix, iy, 12); dogTo(ox, oy, 12); }
    const out = dog.x < camMid() ? K.cam.x - 30 : K.cam.x + K.view.W + 30;
    dogTo(out, 501.5, 13);
    dogCall(() => { dog.on = false; if (then) then(); });
  }
  /* places worth a sniff, nearest the camera first */
  const SNIFF = [[278, 474], [229, 469], [372, 474], [396, 480], [470, 482], [566, 472], [614, 474], [150, 474], [112, 474], [246, 478], [551, 489], [676, 474]];
  const sniffs = (n) => SNIFF.slice().sort((a, b) => Math.abs(a[0] - camMid()) - Math.abs(b[0] - camMid())).slice(0, n);
  const NAP = [258, 474];          // by the canteen, out of the way
  const HOUSE = [187, 470];        // the doghouse, left of the trailer steps

  /* steam off the mugs of anyone standing at the cable-reel table */
  function reelSteam(list) { for (const id of borrowed) { const p = K.crew.posOf(id); if (p && Math.abs(p.x - 551) < 9 && Math.abs(p.y - 488) < 5) list.push({ y: p.y + 0.1, draw: (ctx) => steam(ctx, p.x + 2, p.y - 11) }); } }
  let dogNext = 0;
  /* ------------------------------------------------ vignettes */
  const sky = { geese: null, boat: null, kites: null };
  const table = { sandwich: false, cake: null, gullT: 0 };
  let leafPile = 0, snowmanT = 0;
  const V = {
    /* -------- the far layer -------- */
    geese: { kind: 'ambient', title: 'Geese cross over the lake',
      weight: () => (night() > 0.5 || snowy() ? 0 : [2, 3].includes(month()) || [8, 9, 10].includes(month()) ? 2.4 : month() === 4 ? 1.2 : month() >= 5 && month() <= 7 ? 0.5 : 0.2),
      start() {
        const r = K.R, dir = r() < 0.5 ? 1 : -1, n = 5 + ((r() * 5) | 0);
        const y0 = clamp(K.cam.y + 12 + r() * 18, 340, HORIZON - 8);
        const x0 = dir > 0 ? K.cam.x - 20 : K.cam.x + K.view.W + 20;
        const birds = Array.from({ length: n }, (_, i) => { const side = i % 2 ? 1 : -1, rank = (i + 1) >> 1; return { dx: -dir * rank * 4.2, dy: side * rank * 1.5, ph: r() * 6 }; });
        const g = { x: x0, y: y0, dir, birds, v: 15 + r() * 3 };
        return {
          step(dt) { g.x += g.dir * g.v * dt; g.y += Math.sin(this.t * 0.4) * 0.4 * dt; for (const b of g.birds) b.ph += dt * 7; return g.dir > 0 ? g.x - 50 < K.cam.x + K.view.W : g.x + 50 > K.cam.x; },
          back(ctx) { for (const b of g.birds) drawGoose(ctx, g.x + b.dx, g.y + b.dy, g.dir, b.ph); },
        };
      } },
    sailboat: { kind: 'ambient', title: 'A sailboat on the lake',
      weight: () => (month() >= 4 && month() <= 9 && night() < 0.3 && !wet() && !snowy() ? 1.3 : 0),
      start() {
        const dir = K.R() < 0.5 ? 1 : -1;
        const b = { x: dir > 0 ? K.cam.x - 8 : K.cam.x + K.view.W + 8, y: HORIZON + 7 + K.R() * 7, dir, v: 1.4 + K.R() * 0.8, sail: K.R() < 0.3 ? '#f2c230' : '#f4f1e8' };
        return {
          step(dt) { b.x += b.dir * b.v * dt; return this.t < 240 && (b.dir > 0 ? b.x - 10 < K.cam.x + K.view.W : b.x + 10 > K.cam.x); },
          back(ctx) {
            const pal = K.pal, x = b.x, y = b.y + Math.sin(K.t * 1.2) * 0.15;
            ctx.fillStyle = lit('#3a4a6a'); ctx.beginPath(); ctx.moveTo(x - 2.4, y); ctx.lineTo(x + 2.4, y); ctx.lineTo(x + 1.6, y + 0.9); ctx.lineTo(x - 1.6, y + 0.9); ctx.closePath(); ctx.fill();
            ctx.fillStyle = lit(b.sail); ctx.beginPath(); ctx.moveTo(x, y - 0.3); ctx.lineTo(x, y - 6); ctx.lineTo(x + b.dir * 2.6, y - 0.4); ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.moveTo(x - 0.3, y - 0.3); ctx.lineTo(x - 0.3, y - 4.4); ctx.lineTo(x - b.dir * 1.8, y - 0.4); ctx.closePath(); ctx.fill();
            ctx.strokeStyle = rgba(pal.ink, 0.6); ctx.lineWidth = 0.2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 6.2); ctx.stroke();
            ctx.fillStyle = rgba(pal.white, 0.35); ctx.fillRect(x - 3, y + 1.1, 6, 0.25);
          },
        };
      } },
    kites: { kind: 'ambient', title: 'Kitesurfers out on a windy afternoon',
      weight: () => (month() >= 5 && month() <= 8 && hour() > 12 && hour() < 19 && dayHash('wind') % 3 === 0 && !wet() ? 2 : 0),
      start() {
        const ks = Array.from({ length: 2 + ((K.R() * 2) | 0) }, (_, i) => ({ x: K.cam.x + K.view.W * (0.2 + i * 0.3 + K.R() * 0.1), y: HORIZON + 5 + K.R() * 8, v: (K.R() < 0.5 ? -1 : 1) * (3 + K.R() * 2), ph: K.R() * 6, c: ['#d9443a', '#f2c230', '#3fae5a', '#ff7fae'][i % 4] }));
        return {
          step(dt) { for (const k of ks) { k.x += k.v * dt; if (!inView(k.x, 30)) k.v = -k.v; } return this.t < 150; },
          back(ctx) {
            const pal = K.pal, a = Math.min(1, this.t / 3, (150 - this.t) / 3);
            ctx.globalAlpha = a;
            for (const k of ks) {
              const kx = k.x + Math.sin(K.t * 0.7 + k.ph) * 3 + (k.v > 0 ? 6 : -6), ky = k.y - 16 + Math.sin(K.t * 0.9 + k.ph) * 1.5;
              ctx.strokeStyle = rgba(pal.ink, 0.35); ctx.lineWidth = 0.12; ctx.beginPath(); ctx.moveTo(k.x, k.y - 1.2); ctx.lineTo(kx, ky); ctx.stroke();
              ctx.fillStyle = lit(k.c); ctx.beginPath(); ctx.ellipse(kx, ky, 2.6, 1.2, k.v > 0 ? 0.3 : -0.3, Math.PI, 0); ctx.fill();
              ctx.fillStyle = lit('#2a2622'); ctx.fillRect(k.x - 0.3, k.y - 1.6, 0.6, 1.4);
              ctx.fillStyle = rgba(pal.white, 0.6); ctx.fillRect(k.x - (k.v > 0 ? 2.4 : -0.4), k.y, 2, 0.25);
            }
            ctx.globalAlpha = 1;
          },
        };
      } },
    /* -------- the sidewalk -------- */
    kidwave: { kind: 'ambient', title: 'A kid waves from the sidewalk, a builder waves back',
      weight: () => {
        const h = hour();
        if (night() > 0.5 || !K.world.spawn) return 0;
        if (weekday()) return (h > 7.6 && h < 8.4) || (h > 14.8 && h < 17.6) ? 3 : h > 9 && h < 18 ? 0.5 : 0;
        return h > 9 && h < 18 ? 2.5 : 0;
      },
      start() {
        const stopX = clamp(camMid() + (K.R() - 0.5) * K.view.W * 0.4, 90, 700);
        const kid = K.world.spawn('kid', { stopX });
        let wave = null, answered = false, tick = 0;
        const off = K.on('kid:wave', (e) => { if (e.id === kid && !wave) wave = { x: e.x, t: 0 }; });
        return {
          step(dt) {
            /* someone between jobs comes to the fence to wave back (they have a few seconds to notice) */
            if (wave && !answered && (wave.t += dt) < 6 && (tick -= dt) <= 0) {
              tick = 0.5;
              const ids = nearestIdle(wave.x, 1, 170);
              if (ids.length) {
                answered = true;
                const bx = clamp(wave.x + (K.R() < 0.5 ? -5 : 5), 70, 700);
                script(ids[0], [go(bx, YARD_FRONT - 9), face(0), call(() => K.world.cheer(kid)), pose('wave', 2.6), emote('heart', 1.4), pose('stand', 0.6)]);
              }
            }
            return this.t < 70;
          },
          end: off,
        };
      } },
    /* -------- lunch and its gull -------- */
    gull: { kind: 'ambient', title: 'A gull steals a sandwich off the picnic table',
      weight: () => (lunchTime() && dayHash('gull') % 2 === 0 && !wet() && !snowy() ? 2.2 : 0),
      start(force) {
        table.sandwich = true;
        const s = { x: Math.min(K.cam.x - 10, 200), y: K.cam.y + 10, phase: 'in', t: 0, dir: 1, carrying: false, ph: 0 };
        if (force) start('lunch', true);
        return {
          step(dt) {
            s.t += dt; s.ph += dt * 8;
            if (s.phase === 'in') {
              if (s.t < 4) return true;           // a few seconds to notice the sandwich
              const tx = 249, ty = 465, dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy);
              if (d < 0.8) { s.phase = 'land'; s.t = 0; s.x = tx; s.y = ty; return true; }
              const sp = Math.min(d, (d < 20 ? 12 : 22) * dt); s.x += dx / d * sp; s.y += dy / d * sp + Math.sin(s.t * 2) * 0.3 * dt; s.dir = dx > 0 ? 1 : -1;
            } else if (s.phase === 'land') {
              if (s.t > 1.2 && s.t < 2.4) s.x += 0.6 * dt;                       // a couple of hops toward the sandwich
              if (s.t > 2.6 && !s.carrying) { s.carrying = true; table.sandwich = false; const eater = lunchEaters()[0]; const p = eater && K.crew.posOf(eater); if (p) bubble(p.x, p.y - 17, 'bang', 2, eater); }
              if (s.t > 3.4) { s.phase = 'out'; s.t = 0; s.dir = 1; }
            } else {
              s.x += 22 * dt; s.y -= 14 * dt;
              if (s.t > 1.5 && !this.shared) { this.shared = true; const ids = nearestIdle(249, 1, 120); if (ids.length) script(ids[0], [go(246, 476), face(-1), pose('stand', 1, 'sandwich'), emote('heart', 1.6), pose('stand', 1, null)]); }
              if (s.y < K.cam.y - 20) return false;
            }
            return this.t < 60;
          },
          collect(list) { list.push({ y: s.phase === 'land' ? 474.6 : 499, draw: (ctx) => drawGull(ctx, s.x, s.y, s.dir, s.ph, s.phase === 'land', s.carrying) }); },
          end() { table.sandwich = false; },
        };
      } },
    lunch: { kind: 'ambient', title: 'Lunch together at the picnic table (or on a beam)',
      ritual: () => lunchTime(),
      start(force) {
        const seats = [{ s: ZONES.canteen.spots.seat1, f: 1 }, { s: ZONES.canteen.spots.seat2, f: -1 }, { s: ZONES.canteen.spots.seat3, f: 0 }];
        const used = new Map();
        const beam = beamLevel();
        const beamSpots = beam ? [BUILDING.x0 + 14, BUILDING.x0 + 24, BUILDING.x0 + 34] : [];
        let tick = 0;
        const take = () => {
          for (let i = 0; i < seats.length; i++) if (!used.has('t' + i)) return { key: 't' + i, steps: [go(seats[i].s[0], seats[i].s[1]), face(seats[i].f), pose('eat', 28 + K.R() * 14, 'sandwich'), pose('sit', 6, 'mug'), pose('stand', 0.5, null)] };
          for (let i = 0; i < beamSpots.length; i++) if (!used.has('b' + i)) return { key: 'b' + i, steps: [go(beamSpots[i], floorBottom(beam), beam), face(0), pose('sitbeam', 34 + K.R() * 12, 'sandwich'), pose('sitbeam', 4, null)] };
          return null;
        };
        const recruitOne = () => {
          const seat = take(); if (!seat) return;
          const got = recruit(1, 246, () => seat.steps, (id) => { used.delete(seat.key); eaters.delete(id); });
          if (got.length) { used.set(seat.key, got[0]); eaters.add(got[0]); table.sandwich = true; }
        };
        return {
          step(dt) {
            tick -= dt;
            if (tick <= 0) { tick = force ? 0.5 : 1.5; recruitOne(); }
            if (dog.on && dogStage() >= 3 && !this.begged && used.size) { this.begged = true; dog.tasks = []; dog.task = null; dogTo(244, 479, 12); dogDo('beg', 10, { facing: 1, emote: 'heart' }); dogDo('sit', 8); }
            return force ? this.t < 90 : lunchTime();
          },
          end() { table.sandwich = false; },
        };
      } },
    cake: { kind: 'ambient', title: 'A birthday cake with one candle',
      ritual: () => dayHash('cake') % 17 === 3 && hour() > 14.5 && hour() < 15.5 && !story.done.cake,
      start(force) {
        const c = { phase: 'fetch', slices: 8, t: 0 };
        const bringer = nearestIdle(209, 1)[0];
        const onTable = () => { table.cake = c; c.phase = 'table'; c.t = 0; gather(); };
        const gather = () => recruit(3, 246, (id, i) => { const sx = [238, 254, 246][i]; return [go(sx, 479), face(sx < 246 ? 1 : sx > 246 ? -1 : 0), pose('clap', 3), emote(i === 0 ? 'cake' : 'heart', 1.6), pose('eat', 10), pose('stand', 1)]; });
        if (bringer) script(bringer, [go(206, 469), face(1), pose('stand', 1.6), hold('cake'), go(246, 477), face(0), pose('stand', 0.8, 'cake'), call(onTable), pose('cheer', 2.4, null), emote('cake', 1.8), pose('eat', 10)], (id, ok) => { if (!ok && c.phase === 'fetch') onTable(); });
        else onTable();
        return {
          step(dt) {
            c.t += dt;
            if (c.phase === 'table' && c.t > 18) c.slices = Math.max(0, 8 - Math.floor((c.t - 18) / 4));
            if (c.phase === 'table' && c.slices === 0) { story.done.cake = today; save(); return false; }
            return this.t < 150;
          },
          collect(list) {
            if (table.cake) list.push({ y: 474.7, draw: (ctx) => {
              const c = table.cake;
              if (c.slices > 0) K.art.prop(ctx, 'cake', 246, 465.2, { candle: c.slices >= 8, slices: c.slices, t: K.t });
              if (c.slices < 8) { const pal = K.pal; for (const px of [239.5, 242.5, 250, 253]) { ctx.fillStyle = pal.white; ctx.beginPath(); ctx.ellipse(px, 465.4, 1.1, 0.35, 0, 0, 6.3); ctx.fill(); ctx.fillStyle = lit('#f0a8b8'); ctx.fillRect(px - 0.3, 465, 0.6, 0.3); } }
            } });
          },
          end() { table.cake = null; },
        };
      } },
    /* -------- rituals -------- */
    stretch: { kind: 'ambient', title: 'Morning stretch in front of the pad',
      ritual: () => weekday() && hour() > 6.8 && hour() < 7.4 && night() < 0.9,
      start(force) {
        let n = 0, tick = 0;
        return {
          step(dt) {
            tick -= dt;
            if (tick <= 0 && n < 4) { tick = force ? 0.5 : 1.5; const i = n; if (recruit(1, 460, () => [go(436 + i * 15, 484), face(0), pose('stretch', 4), pose('raise', 3), pose('bend', 3), pose('stretch', 3), emote('sun', 1.4), pose('stand', 1)]).length) n++; }
            return force ? this.t < 60 : V.stretch.ritual();
          },
        };
      } },
    coffee: { kind: 'ambient', title: 'Coffee at ten (and three): mugs at the cable-reel table',
      ritual: () => { const h = hour(); return ((h > 9.75 && h < 10.25) || (h > 14.75 && h < 15.25)) && !active.has('cake'); },
      start(force) {
        let n = 0, tick = 0;
        const reel = [[544, 487], [558, 487], [551, 491]];
        return {
          step(dt) {
            tick -= dt;
            if (tick <= 0 && n < 3) {
              tick = force ? 0.5 : 2.5; const i = n;
              const [rx, ry] = reel[i];
              if (recruit(1, 300, () => [go(229, 468), face(-1), pose('stand', 1.8), hold('mug'), go(rx, ry), face(rx < 551 ? 1 : rx > 551 ? -1 : 0), pose('drink', 16, 'mug'), emote('coffee', 1.6), pose('drink', 8, 'mug'), pose('stand', 0.5, null)]).length) n++;
            }
            return force ? this.t < 100 : V.coffee.ritual();
          },
          collect: reelSteam,
        };
      } },
    sunset: { kind: 'ambient', title: 'Golden hour: someone on a break takes the lakeside bench',
      ritual: () => { const L = K.light || {}; return L.evening && L.alt > -3 && L.alt < 9 && !wet() && !snowy(); },
      start(force) {
        let n = 0, tick = 0;
        const seats = [ZONES.bench.spots.seat, ZONES.bench.spots.seat2];
        return {
          step(dt) {
            tick -= dt;
            if (tick <= 0 && n < 2) { tick = force ? 0.5 : 3; const [sx, sy] = seats[n]; if (recruit(1, 676, () => [go(sx, sy), face('away'), pose('sit', 50 + K.R() * 20), emote('sun', 2), pose('sit', 12)]).length) n++; }
            if (dog.on && dogStage() >= 6 && !this.dogged && n) { this.dogged = true; dog.tasks = []; dog.task = null; dogTo(682, 472, 12); dogDo('sit', 60, { facing: -1 }); }
            return force ? this.t < 100 : V.sunset.ritual();
          },
        };
      } },
    thermos: { kind: 'ambient', title: 'The late crew shares a thermos',
      ritual: () => (night() > 0.7 || hour() >= 21 || hour() < 5),
      start(force) {
        let tick = force ? 0 : 20;
        return {
          step(dt) {
            tick -= dt;
            if (tick <= 0) {
              tick = 200 + K.R() * 120;
              const ids = nearestIdle(551, 2);
              if (ids.length) {
                script(ids[0], [go(544, 487), face(1), pose('drink', 3, 'thermos'), pose('stand', 2, 'thermos'), emote('coffee', 1.6), pose('drink', 14, 'mug'), pose('stand', 0.5, null)]);
                if (ids[1]) script(ids[1], [go(558, 487), face(-1), pose('stand', 4, 'mug'), pose('drink', 14, 'mug'), emote('heart', 1.4), pose('drink', 6, 'mug'), pose('stand', 0.5, null)]);
              }
            }
            return force ? this.t < 60 : V.thermos.ritual();
          },
          collect: reelSteam,
        };
      } },
    shower: { kind: 'ambient', title: 'A rain shower: tarps over the stacks, a huddle under the awning',
      ritual: () => wet(),
      start(force) {
        let restore = null;
        if (force && !wet()) {
          const before = K.S.sky.weather;
          K.S.sky = { ...K.S.sky, weather: 'rain' }; if (K.art.setLight(K.S.sky)) K.gen++;
          restore = () => { if (K.S.sky.weather === 'rain') { K.S.sky = { ...K.S.sky, weather: before }; if (K.art.setLight(K.S.sky)) K.gen++; } };
        }
        const kinds = ['lumber', 'panels', 'brick'];
        const spots = { lumber: [280, 473], panels: [341, 473], brick: [386, 474] };
        let tarper = null, huddleTick = 2, dryT = 0, huddled = 0;
        const tarpRun = (on) => {
          const todo = kinds.filter((k) => K.world.covered(k) !== on);
          if (!todo.length) return;
          const steps = [];
          for (const k of todo) { steps.push(go(spots[k][0], spots[k][1]), face(-1), pose('lift', 1.6), call(() => K.world.cover(k, on))); }
          steps.push(pose('stand', 0.4));
          tarper = recruit(1, 330, () => steps)[0] || null;
        };
        tarpRun(true);
        return {
          step(dt) {
            const raining = wet() && (!force || this.t < 45);
            if (raining) {
              if (this.t > 22) for (const k of kinds) K.world.cover(k, true);     // somebody off-screen got the rest
              huddleTick -= dt;
              if (huddleTick <= 0 && huddled < 3) { huddleTick = force ? 1 : 2; const i = huddled; const [hx, hy] = K.world.spot('canteen', 'huddle' + (i + 1)); if (recruit(1, 240, () => [go(hx, hy), face(i === 1 ? 0 : i ? -1 : 1), pose('huddle', 24 + K.R() * 10), emote('sweat', 1.2), pose('huddle', 8), pose('stand', 0.4)]).length) huddled++; }
              dryT = 0;
              return true;
            }
            if (restore) { restore(); restore = null; }
            dryT += dt;
            if (dryT > 12 && !this.uncovering) { this.uncovering = true; tarpRun(false); }
            if (dryT > 40) { for (const k of kinds) K.world.cover(k, false); return false; }
            return true;
          },
          collect(list) {
            if (!wet()) return;
            list.push({ y: 471.5, draw: (ctx) => {        // drips off the awning's valance
              ctx.fillStyle = rgba(K.pal.glassHi, 0.7);
              for (let i = 0; i < 9; i++) { const x = 220 + i * 5 + (i % 2) * 1.3, p = (K.t * 1.6 + i * 0.37) % 1; ctx.fillRect(x, 449.5 + p * 20, 0.25, 0.9); }
            } });
          },
          end() { if (restore) restore(); void tarper; },
        };
      } },
    snowman: { kind: 'ambient', title: 'A snowman goes up on a snow day, one ball at a time',
      ritual: () => snowy() && night() < 0.55 && (!story.snow || story.snow.stage < 4),
      start(force) {
        if (!story.snow || story.snow.day !== today && story.snow.stage >= 4) {
          const spots = [[452, 487], [205, 485], [661, 484], [586, 484]];
          const [sx, sy] = spots[dayHash('snowman') % spots.length];
          story.snow = { day: today, stage: 0, x: sx, y: sy, hat: null }; save();
        }
        let busy = false, tick = force ? 0 : 3;
        return {
          step(dt) {
            const s = story.snow;
            if (!s || !snowy() || s.stage >= 4) return false;
            tick -= dt;
            if (!busy && tick <= 0) {
              tick = force ? 0.5 : 25;
              const last = s.stage === 3;
              const steps = last
                ? [go(s.x - 5, s.y + 0.5), face(1), pose('raise', 2, 'hat'), call((id) => { s.stage = 4; s.hat = id; save(); }), emote('heart', 1.6), pose('stand', 1, null)]
                : [go(s.x - 5, s.y + 0.5), face(1), pose('crouch', force ? 2.5 : 6), call(() => { s.stage++; save(); }), pose('stand', 0.6)];
              if (recruit(1, s.x, () => steps, () => { busy = false; }).length) busy = true;
            }
            return force ? this.t < 80 : true;
          },
        };
      } },
    leaves: { kind: 'ambient', title: 'Raking leaves under the maple',
      weight: () => ((month() === 9 || month() === 10) && !wet() && !snowy() && night() < 0.4 ? 1.2 : 0),
      start() {
        const [lx, ly] = K.world.spot('bench', 'leaves');
        const got = recruit(1, lx, () => [go(lx - 6, ly), face(1), pose('rake', 10), call(() => { leafPile = 1; }), pose('rake', 10), call(() => { leafPile = 2; }), pose('stand', 1)]);
        if (!got.length) return null;
        return {
          step() {
            if (leafPile >= 2 && dog.on && dogStage() >= 5 && !this.jumped) { this.jumped = true; dog.tasks = []; dog.task = null; dogTo(lx, ly, 15); dogDo('play', 2.5, { emote: 'heart' }); dogCall(() => { leafPile = 0; this.scatter = K.t; }); }
            return this.t < 120;
          },
          collect(list) {
            const self = this;
            list.push({ y: ly + 0.5, draw: (ctx) => {
              const pal = K.pal;
              if (leafPile) { const n = leafPile * 9, r = rng(13); for (let i = 0; i < n; i++) { ctx.fillStyle = [pal.autumnA, pal.autumnB, lit('#9a6a2a')][i % 3]; ctx.beginPath(); ctx.ellipse(lx - 3 + r() * 6, ly - r() * leafPile * 1.4, 0.8, 0.45, r() * 3, 0, 6.3); ctx.fill(); } }
              if (self.scatter && K.t - self.scatter < 2) { const p = (K.t - self.scatter) / 2; for (let i = 0; i < 10; i++) { ctx.fillStyle = [pal.autumnA, pal.autumnB][i % 2]; ctx.fillRect(lx + Math.cos(i * 0.63) * p * 9, ly - 4 * Math.sin(p * Math.PI) - i % 3, 0.8, 0.5); } }
            } });
          },
          end() { leafPile = 0; },
        };
      } },
    fireflies: { kind: 'ambient', title: 'Fireflies by the bench on a summer night',
      ritual: () => month() >= 5 && month() <= 7 && night() > 0.6 && !wet(),
      start(force) {
        const flies = Array.from({ length: 14 }, (_, i) => ({ x: 652 + (hash('ff' + i) % 70), y: 462 + (hash('fy' + i) % 30), ph: (hash('fp' + i) % 100) / 16 }));
        return {
          step() { return force ? this.t < 60 : V.fireflies.ritual(); },
          collect(list) {
            if (!inView(680, 60)) return;
            list.push({ y: 499.5, draw: (ctx) => { for (const f of flies) { const b = Math.max(0, Math.sin(K.t * 1.3 + f.ph)); if (b < 0.4) continue; ctx.fillStyle = rgba('#e8ff9a', b); ctx.beginPath(); ctx.arc(f.x + Math.sin(K.t * 0.5 + f.ph) * 3, f.y + Math.cos(K.t * 0.4 + f.ph) * 2, 0.45, 0, 6.3); ctx.fill(); } } });
          },
        };
      } },
    inspector: { kind: 'ambient', title: 'The weekly inspector walks the site with a clipboard',
      ritual: () => { const w = inspectorSlot(); const h = hour(); return w.today && h > w.h && h < w.h + 0.5 && !story.done.inspector; },
      start() {
        const pal = { hat: '#f4f1e8', vest: '#3a5a7a', skin: SKINS[dayHash('insp') % SKINS.length], hair: HAIRS[(dayHash('insp') >> 3) % HAIRS.length] };
        const route = [[30, 501.5], [72, 501.5], [72, 491], [112, 482], ['look', 2.5, 0], [206, 479], ['nod', 1.5, 1], [372, 479], ['measure', 3, 1], [470, 484], ['look', 3.5, 'away'], ['write', 3, 0], ['nod', 1.2, 0, 'star'], [566, 478], ['look', 2, -1], [640, 491], [640, 501.5], [760, 501.5]];
        const p = { x: route[0][0], y: route[0][1], i: 1, t: 0, pose: 'walk', facing: 1, emote: null };
        return {
          step(dt) {
            p.t += dt;
            if (p.emote) { p.emote.t += dt; if (p.emote.t > 1.8) p.emote = null; }
            const w = route[p.i];
            if (!w) { story.done.inspector = today; save(); return false; }
            if (typeof w[0] === 'string') {
              p.pose = w[0] === 'write' ? 'measure' : w[0]; if (w[2] !== undefined) p.facing = w[2];
              if (w[3] && !p.emote) p.emote = { icon: w[3], t: 0 };
              if (w[0] === 'write' && !p.emote) p.emote = { icon: 'dots', t: 0 };
              if (p.t > w[1]) { p.i++; p.t = 0; }
              return true;
            }
            const dx = w[0] - p.x, dy = w[1] - p.y, d = Math.hypot(dx, dy);
            if (d < 0.4) { p.i++; p.t = 0; return true; }
            const s = Math.min(d, 9 * dt); p.x += dx / d * s; p.y += dy / d * s; p.pose = 'walk'; if (Math.abs(dx) > 0.2) p.facing = dx > 0 ? 1 : -1;
            return this.t < 300;
          },
          collect(list) {
            list.push({ y: p.y, draw: (ctx) => {
              K.art.figure(ctx, p.x, p.y, { pose: p.pose, t: K.t, facing: p.facing, colors: pal, carry: 'clipboard', hat: true, civ: true });
              if (p.emote) K.art.emote(ctx, p.x, p.y - 18, p.emote.icon, p.emote.t);
            } });
          },
        };
      } },
    pot: { kind: 'arc', title: 'The pot on the trailer step gets watered (it grows over weeks)',
      ritual: () => hour() > 7.4 && hour() < 9.5 && !story.done.pot && !snowy(),
      start(force) {
        const got = recruit(1, 200, () => [go(203, 469), face(-1), pose('bend', 2.6, 'bucket'), call(() => { story.done.pot = today; save(); }), emote('heart', 1.4), pose('stand', 0.5, null)]);
        if (!got.length) { if (!force) { story.done.pot = today; save(); } return null; }
        return { step() { return this.t < 60 && !story.done.pot; } };
      } },
    dog: { kind: 'arc', title: 'The stray dog (today’s step of the arc)',
      ritual: () => !dog.on && dogWindow() && K.t > dogNext && dogStage() < 6,
      start(force) { return dogEpisode(dogStage(), force); } },
  };
  for (let s = 1; s <= 6; s++) V['dog:' + s] = { kind: 'arc', title: ['', 'Day 1: a stray watches through the fence', 'Day 2: it comes in and sniffs around', 'Day 3: someone pets it and shares lunch', 'Day 4: a red bandana', 'Day 5: a doghouse by the trailer', 'Day 6 on: naps by the canteen, trots after whoever is hauling'][s],
    start: () => { override.dog = s; dog.on = false; return dogEpisode(s, true); } };
  for (const k of ['pour', 'floor', 'topped']) V['m:' + k] = { kind: 'milestone', title: { pour: 'First pour: the crew cheers around the slab', floor: 'A floor done: claps, and a flag goes up on the deck', topped: 'Topping out: the cheer' }[k],
    start: () => { milestone(fakeMilestone(k)); return null; } };

  function lunchTime() { const h = hour(); return h > 11.75 && h < 13.25; }
  const eaters = new Set();
  const lunchEaters = () => [...eaters];
  function beamLevel() {
    const s = K.building.stage ? K.building.stage() : null;
    if (!s) return 0;
    if (s.phase === 'finish') return 0;
    return s.phase === 'frame' && s.floor >= 1 ? s.floor : 0;
  }
  function inspectorSlot() {
    const d = now(), jan1 = new Date(d.getFullYear(), 0, 1), week = Math.floor((d - jan1) / 6048e5);
    const h = hash('inspector:' + d.getFullYear() + ':' + week);
    return { today: d.getDay() === 1 + (h % 5), h: 9 + ((h >>> 4) % 5) + ((h >>> 9) % 4) * 0.25 };
  }
  function dogWindow() { const h = hour(); return h > 6.8 && h < 18.5 && !snowy(); }

  /* the dog's episode for its stage; returns an instance */
  function dogEpisode(stage, force) {
    if (dog.on && !force) return null;
    dog.bandana = stage >= 5 || (stage === 4 && !!(story.dog && story.dog.bandana));
    const inst = { step() { return dog.on || this.t < 2; }, end() { dogNext = K.t + 200 + K.R() * 160; } };
    if (stage === 1) {
      /* watches the crew through the fence from the sidewalk, then trots on */
      const x = clamp(camMid() + (K.R() - 0.5) * 30, 90, 700);
      dog.on = true; dog.tasks = []; dog.task = null; dog.plan = null;
      dog.x = x < camMid() ? K.cam.x - 14 : K.cam.x + K.view.W + 14; dog.y = 501.5;
      dogTo(x, 500.5, 12); dogDo('sit', 9, { facing: 'away' }); dogDo('stand', 1.5, { emote: 'question' }); dogDo('sit', 8, { facing: 'away' }); dogDo('wag', 3, { facing: 'away' });
      dogTo(x < camMid() ? K.cam.x - 30 : K.cam.x + K.view.W + 30, 501.5, 12); dogCall(() => { dog.on = false; });
      return inst;
    }
    dogEnter(camMid());
    if (stage === 2) {
      for (const [sx, sy] of sniffs(3)) { dogTo(sx, sy, 10); dogDo('sniff', 2.5 + K.R() * 2); }
      dogDo('sit', 3, { emote: 'question' });
      dogLeave();
      return inst;
    }
    /* 3+: someone comes over */
    const [sx, sy] = sniffs(1)[0];
    dogTo(sx, sy, 10); dogDo('sniff', 2);
    dogDo('sit', 1.5);
    dogCall(() => {
      const steps = [go(clamp(dog.x + 6, 70, 700), dog.y), face(-1), pose('crouch', 2, 'sandwich'), call(() => { dog.tasks.unshift({ k: 'pose', pose: 'eat', dur: 3, emote: 'heart' }); dog.task = null; }), pose('pet', 3, null)];
      if (stage === 4) steps.push(call(() => { story.dog.bandana = true; save(); dog.bandana = true; }), pose('pet', 2), emote('heart', 1.4));
      if (stage === 5 && !(story.dog && story.dog.house)) steps.push(go(HOUSE[0] + 6, HOUSE[1] + 1), face(-1), pose('hammer', force ? 5 : 12), call(() => { story.dog.house = true; save(); }), emote('star', 1.4));
      steps.push(pose('stand', 0.5));
      const got = recruit(1, dog.x, () => steps, null, 200);
      if (!got.length) { if (stage === 4) { story.dog.bandana = true; dog.bandana = true; save(); } if (stage === 5) { story.dog.house = true; save(); } }
    });
    dogDo('sit', 8, { facing: 1 }); dogDo('wag', 4, { facing: 1 });
    if (stage >= 5) {
      /* moves in: from now on it stays around all day */
      dogDo('sit', 4);
      dogCall(() => { dog.plan = dogRoutine; });
      return { step() { return dog.on; }, end() {} };
    }
    dogDo('sit', 30); dogTo(NAP[0], NAP[1], 9); dogDo('sleep', 40, { emote: 'zzz' });
    dogLeave();
    return inst;
  }
  /* builders at work on the ground, the ones carrying something first (who the dog trots after) */
  function haulers() {
    let rows = [];
    try {
      const d = K.crew.debug ? K.crew.debug() : null;
      rows = Array.isArray(d) ? d : d && Array.isArray(d.agents) ? d.agents : [];
    } catch (e) { rows = []; }
    const idleNow = new Set(K.crew.idle ? K.crew.idle() : []);
    const out = [], carrying = [];
    for (const r of rows) {
      const id = Array.isArray(r) ? r[0] : r && r.id;
      if (!id || borrowed.has(id) || idleNow.has(id) || (r && r.gone) || (r && r.vehicle)) continue;
      const p = K.crew.posOf(id);
      if (!p || p.y <= GROUND_Y) continue;
      (r && !Array.isArray(r) && r.carry ? carrying : out).push(id);
    }
    return carrying.length ? carrying : out;
  }
  function crewIds() {
    let rows = [];
    try { const d = K.crew.debug ? K.crew.debug() : null; rows = Array.isArray(d) ? d : d && Array.isArray(d.agents) ? d.agents : []; } catch (e) { rows = []; }
    const out = [];
    for (const r of rows) { const id = Array.isArray(r) ? r[0] : r && r.id; if (id && !(r && (r.gone || r.hidden))) out.push(id); }
    return out;
  }
  /* the adopted dog's day: nap by the canteen, trot after someone hauling, sleep in the doghouse at night */
  function dogRoutine() {
    if (dog.tasks.length || dog.task) return;
    const h = hour();
    const hasHouse = story.dog && story.dog.house;
    if ((h < 6.5 || h > 19.5 || night() > 0.7) && hasHouse) { dogTo(HOUSE[0] + 0.5, HOUSE[1] + 3, 9); dogDo('sleep', 60, { facing: 1, emote: 'zzz' }); return; }
    const r = K.R();
    if (r < 0.45) {
      const busy = haulers();
      if (busy.length) { const id = busy[(K.R() * busy.length) | 0]; dog.tasks.push({ k: 'follow', id, dur: 25 + K.R() * 25 }); dogDo('sit', 4); return; }
    }
    if (r < 0.75) { dogTo(NAP[0] + (K.R() - 0.5) * 6, NAP[1] + K.R() * 2, 8); dogDo('sleep', 40 + K.R() * 40, { facing: -1, emote: 'zzz' }); return; }
    const [sx, sy] = sniffs(4)[(K.R() * 4) | 0]; dogTo(sx, sy, 8); dogDo('sniff', 3); dogDo('sit', 6);
  }
  /* the adopted dog is around from the start of the day */
  function ensureResident() {
    if (dogStage() >= 6 && story.dog && !story.dog.house) { story.dog.house = true; story.dog.bandana = true; save(); }
    if (dogStage() >= 6 && !dog.on && (dogWindow() || (story.dog && story.dog.house))) {
      dog.on = true; dog.tasks = []; dog.task = null; dog.bandana = true; dog.plan = dogRoutine;
      const h = hour();
      if ((h < 6.5 || h > 19.5 || night() > 0.7) && story.dog.house) { dog.x = HOUSE[0] + 0.5; dog.y = HOUSE[1] + 3; }
      else { dog.x = NAP[0]; dog.y = NAP[1]; }
    }
  }

  /* ------------------------------------------------ milestones */
  function fakeMilestone(kind) {
    const fl = kind === 'pour' ? 0 : kind === 'topped' ? (K.S.town.floors || BUILDING.floors) : Math.max(1, K.S.town.floors_done | 0);
    return { kind, floor: fl, x: (BUILDING.x0 + BUILDING.x1) / 2, y: kind === 'pour' ? GROUND_Y : floorBottom(fl) };
  }
  const MOMENT = { pour: 6, floor: 6, topped: 8 };
  function milestone(m) {
    if (!m || !MOMENT[m.kind]) return;
    K.moment(m.x, m.kind === 'pour' ? m.y - 10 : m.y + 6, MOMENT[m.kind]);
    if (m.kind === 'floor' || m.kind === 'topped') { story.flag = { floor: m.floor, at: K.t, x: m.kind === 'topped' ? BUILDING.x0 + 3 : BUILDING.x1 - 3 }; save(); }
    const n = m.kind === 'topped' ? 8 : 6;
    const x0 = BUILDING.x0 + 6, span = BUILDING.x1 - BUILDING.x0 - 12;
    recruit(n, m.x, (id, i) => {
      const x = x0 + span * ((i + 0.5) / n), y = m.kind === 'pour' ? 479 + (i % 2) * 2.5 : 481 + (i % 2) * 2;
      const p1 = m.kind === 'floor' ? 'clap' : 'cheer', p2 = m.kind === 'floor' ? 'look' : 'clap';
      return [go(x, y), face('away'), pose(p1, 2.6), emote(i % 3 === 0 ? 'star' : 'heart', 1.6), pose(p2, 2), face(0), pose('cheer', 1.2), pose('stand', 0.5)];
    }, null, 260);
    if (m.kind === 'pour' || m.kind === 'topped') burst = { x: m.x, y: m.y - 4, t: 0 };
    /* everyone on site, working or not, gets a little star or heart over their head (no one stops) */
    let k = 0;
    for (const id of crewIds()) if (!borrowed.has(id)) { const p = K.crew.posOf(id); if (p) marks.push({ x: p.x, y: p.y - 17, icon: k % 3 === 2 ? 'heart' : 'star', t: -0.25 * (k++ % 5), dur: 2.6, followId: id }); }
  }
  let burst = null;
  K.on('milestone', milestone);
  K.on('mural', (e) => bubble(e.x, e.y - 6, 'star', 2.6));

  /* ------------------------------------------------ the scheduler */
  function slotBeat() {
    const d = now(), m = d.getHours() * 60 + d.getMinutes(), s = Math.floor(m / SLOT_MIN);
    if (s === slot) return;
    slot = s;
    if (K.S.whistle) return;
    const r = rng(hash(today + ':slot:' + s));
    const pool = [];
    let total = 1.1;                                   // the weight of "nothing new this slot"
    for (const [id, v] of Object.entries(V)) { if (!v.weight || active.has(id)) continue; const w = v.weight(); if (w > 0) { pool.push([id, w]); total += w; } }
    let x = r() * total;
    for (const [id, w] of pool) { x -= w; if (x <= 0) { start(id); return; } }
  }
  function rituals() {
    if (K.S.whistle) return;
    for (const [id, v] of Object.entries(V)) if (v.ritual && !active.has(id) && v.ritual()) start(id);
  }

  /* ------------------------------------------------ the module */
  let checkT = 0;
  function step(dt) {
    clockT -= dt;
    if (clockT <= 0 || !today) { clockT = 5; const k = dayKey(now()); if (k !== today) { override.dog = null; newDay(); } }
    checkT -= dt;
    if (checkT <= 0) { checkT = 1; slotBeat(); rituals(); ensureResident(); }
    for (const [id, a] of [...active]) { a.t += dt; let alive = false; try { alive = a.step(dt); } catch (e) { console.error(e); } if (!alive) stop(id); }
    try { stepDog(dt); } catch (e) { console.error(e); dog.tasks = []; dog.task = null; }
    for (let i = marks.length - 1; i >= 0; i--) { marks[i].t += dt; if (marks[i].t > marks[i].dur) marks.splice(i, 1); }
    if (burst) { burst.t += dt; if (burst.t > 3) burst = null; }
    if (story.flag && !K.S.town.topped_out && (K.S.town.floors_done | 0) < story.flag.floor) story.flag = null;   // the town moved backwards (the preview): drop the flag
    if (story.snow && !snowy() && K.light && K.light.weather) { story.snow = null; save(); }
  }

  /* things drawn in the yard, depth-sorted */
  /* the art module's dog knows walk, sit, sleep, wag and stand; the richer name rides along as `act` */
  const DOG_POSE = { trot: 'walk', sniff: 'stand', beg: 'sit', eat: 'stand', play: 'wag' };
  const dogO = { facing: 1, t: 0, pose: 'stand', act: 'stand', bandana: false, coat: '' };
  const DOG_E = { y: 0, draw: (ctx) => {
    dogO.facing = dog.facing === 'away' ? 1 : dog.facing; dogO.away = dog.facing === 'away'; dogO.t = dog.pose === 'trot' ? dog.t * 1.6 : dog.t;
    dogO.pose = DOG_POSE[dog.pose] || dog.pose; dogO.act = dog.pose; dogO.bandana = dog.bandana; dogO.coat = lit(DOG_COAT);
    K.art.prop(ctx, 'dog', dog.x, dog.y, dogO);
    if (dog.emote) K.art.emote(ctx, dog.x, dog.y - 9, dog.emote.icon, dog.emote.t);
  } };
  const HOUSE_E = { y: HOUSE[1] - 0.2, draw: (ctx) => K.art.prop(ctx, 'doghouse', HOUSE[0], HOUSE[1], { name: false, snow: snowy() }) };
  const POT_E = { y: ZONES.office.spots.pot[1], draw: (ctx) => drawPot(ctx, ZONES.office.spots.pot[0], ZONES.office.spots.pot[1], potStage()) };
  const SNOWMAN_E = { y: 0, draw: (ctx) => { const s = story.snow; if (s.stage >= 4) K.art.prop(ctx, 'snowman', s.x, s.y, { t: K.t, hat: true }); else drawSnowBalls(ctx, s.x, s.y, s.stage); } };
  /* the snowman going up, a ball at a time (the art module's snowman is the finished one, hat and all) */
  function drawSnowBalls(ctx, x, y, n) {
    const pal = K.pal;
    ctx.fillStyle = rgba(pal.ink, 0.15); ctx.beginPath(); ctx.ellipse(x, y + 0.2, 3.4, 0.8, 0, 0, 6.3); ctx.fill();
    const balls = [[-2.9, 3], [-7.3, 2.2], [-10.8, 1.6]];
    for (let i = 0; i < Math.min(3, n); i++) {
      const [by, r] = balls[i];
      ctx.beginPath(); ctx.arc(x, y + by, r, 0, 6.3); ctx.fillStyle = pal.snowShade; ctx.fill();
      ctx.beginPath(); ctx.arc(x - r * 0.12, y + by - r * 0.12, r * 0.86, 0, 6.3); ctx.fillStyle = pal.snow; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y + by, r, 0, 6.3); ctx.lineWidth = 0.35; ctx.strokeStyle = pal.ink; ctx.stroke();
    }
    if (n >= 3) { ctx.fillStyle = pal.ink; ctx.beginPath(); ctx.arc(x - 0.55, y - 11.1, 0.22, 0, 6.3); ctx.arc(x + 0.55, y - 11.1, 0.22, 0, 6.3); ctx.fill(); ctx.fillStyle = lit('#f07f2a'); ctx.beginPath(); ctx.moveTo(x, y - 10.7); ctx.lineTo(x + 1.9, y - 10.4); ctx.lineTo(x, y - 10.2); ctx.closePath(); ctx.fill(); }
  }
  const FLAG_E = { y: GROUND_Y - 0.5, draw: (ctx) => drawFlag(ctx) };
  const MARKS_E = { y: 600, draw: (ctx) => {
    for (const m of marks) { if (m.t < 0) continue; let x = m.x, y = m.y; if (m.followId) { const p = K.crew.posOf(m.followId); if (p) { x = p.x; y = p.y - 17; } } K.art.emote(ctx, x, y, m.icon, m.t); }
    if (burst) drawBurst(ctx, burst);
  } };
  const TABLE_E = { y: 474.65, draw: (ctx) => { if (table.sandwich && !table.cake) K.art.prop(ctx, 'sandwich', 249, 465.2, { t: K.t }); } };
  function collect(list) {
    if (story.dog && (story.dog.house || dogStage() >= 6)) list.push(HOUSE_E);
    list.push(POT_E);
    if (story.snow && snowy() && story.snow.stage > 0) { SNOWMAN_E.y = story.snow.y; list.push(SNOWMAN_E); }
    if (story.flag) list.push(FLAG_E);
    if (table.sandwich) list.push(TABLE_E);
    if (dog.on) { DOG_E.y = dog.y; list.push(DOG_E); }
    for (const a of active.values()) if (a.collect) a.collect(list);
    if (marks.length || burst) list.push(MARKS_E);
    /* falling leaves off the maple in autumn */
    if ((month() === 9 || month() === 10) && !snowy() && inView(708, 30)) list.push(LEAVES_E);
  }
  const LEAVES_E = { y: 470, draw: (ctx) => {
    const pal = K.pal;
    for (let i = 0; i < 5; i++) {
      const p = (K.t * 0.08 + i * 0.21) % 1, x = 696 + (hash('lf' + i) % 26) + Math.sin(K.t * 1.4 + i) * 2.2, y = 432 + p * 36;
      ctx.globalAlpha = Math.min(1, (1 - p) * 4); ctx.fillStyle = i % 2 ? pal.autumnA : pal.autumnB;
      ctx.beginPath(); ctx.ellipse(x, y, 0.75, 0.4, K.t * 2 + i, 0, 6.3); ctx.fill();
    }
    ctx.globalAlpha = 1;
  } };
  function drawBack(ctx) { for (const a of active.values()) if (a.back) a.back(ctx); }

  function drawPot(ctx, x, y, stage) {
    const pal = K.pal, m = month(), cold = snowy() || m === 11 || m <= 1;
    /* a terracotta pot */
    ctx.fillStyle = lit('#c0683f'); ctx.beginPath(); ctx.moveTo(x - 2, y - 3.4); ctx.lineTo(x + 2, y - 3.4); ctx.lineTo(x + 1.5, y); ctx.lineTo(x - 1.5, y); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 0.3; ctx.strokeStyle = pal.ink; ctx.stroke();
    ctx.fillStyle = lit('#d27a4f'); ctx.fillRect(x - 2.3, y - 3.9, 4.6, 0.9); ctx.strokeRect(x - 2.3, y - 3.9, 4.6, 0.9);
    if (cold) { if (snowy()) { ctx.fillStyle = pal.snow; ctx.beginPath(); ctx.ellipse(x, y - 4, 2.3, 0.8, 0, Math.PI, 0); ctx.fill(); } return; }
    if (stage <= 1) { ctx.fillStyle = lit('#6aa84f'); ctx.fillRect(x - 0.15, y - 5, 0.3, 1.1); ctx.beginPath(); ctx.ellipse(x + 0.5, y - 5, 0.5, 0.25, -0.4, 0, 6.3); ctx.fill(); return; }
    const h = 2 + stage * 1.3, leaf = lit('#5f9a44'), leaf2 = lit('#7ab85a');
    ctx.strokeStyle = leaf; ctx.lineWidth = 0.35; ctx.beginPath(); ctx.moveTo(x, y - 3.9); ctx.lineTo(x, y - 3.9 - h); ctx.stroke();
    for (let i = 0; i < stage + 1; i++) { const ly = y - 4.4 - i * (h / (stage + 1)), s = i % 2 ? 1 : -1; ctx.fillStyle = i % 2 ? leaf : leaf2; ctx.beginPath(); ctx.ellipse(x + s * 1.1, ly, 1.2 + stage * 0.08, 0.55, s * 0.5, 0, 6.3); ctx.fill(); }
    /* a stake once it's tall, flowers then tomatoes in season */
    if (stage >= 4) { ctx.strokeStyle = lit('#9a7550'); ctx.lineWidth = 0.3; ctx.beginPath(); ctx.moveTo(x + 0.8, y - 3.9); ctx.lineTo(x + 0.8, y - 4.6 - h); ctx.stroke(); }
    if (stage >= 5) { const fruit = stage >= 6 && m >= 5 && m <= 9; ctx.fillStyle = fruit ? lit('#d9443a') : lit('#f2c230'); for (const [dx, dy] of [[-1.2, -h * 0.55], [1.3, -h * 0.75], [-0.4, -h * 0.9]]) { ctx.beginPath(); ctx.arc(x + dx, y - 4 + dy, fruit ? 0.6 : 0.35, 0, 6.3); ctx.fill(); } }
  }
  function drawFlag(ctx) {
    const f = story.flag; if (!f) return;
    const top = K.S.town.topped_out || (K.S.town.floors_done | 0) >= (K.S.town.floors || 6);
    const fl = Math.min(f.floor, top ? (K.S.town.floors || 6) : Math.max(f.floor, K.S.town.floors_done | 0));
    const base = floorBottom(fl), x = f.x;
    const rise = clamp((K.t - (f.at || 0)) / 3, 0, 1);
    const pal = K.pal;
    ctx.strokeStyle = pal.steel; ctx.lineWidth = 0.4; ctx.lineCap = 'round';
    ctx.lineWidth = 0.55; ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, base - 17); ctx.stroke();
    ctx.fillStyle = pal.steel; ctx.beginPath(); ctx.arc(x, base - 17.3, 0.5, 0, 6.3); ctx.fill();
    const fy = base - 2.6 - rise * 12, wave = Math.sin(K.t * 3) * 0.6, w2 = Math.sin(K.t * 3 + 1.2) * 0.6;
    ctx.fillStyle = pal.flag; ctx.beginPath(); ctx.moveTo(x + 0.3, fy - 4.4); ctx.quadraticCurveTo(x + 3.2, fy - 5.2 + wave, x + 6.6, fy - 4.4 + w2); ctx.lineTo(x + 6.6, fy - 0.4 + w2); ctx.quadraticCurveTo(x + 3.2, fy - 1.2 + wave, x + 0.3, fy - 0.4); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 0.3; ctx.strokeStyle = pal.ink; ctx.stroke();
    ctx.fillStyle = pal.white; ctx.beginPath(); ctx.moveTo(x + 3.4, fy - 3.6 + wave * 0.6); for (let k = 1; k < 10; k++) { const t = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 0.6 : 1.4; ctx.lineTo(x + 3.4 + Math.cos(t) * r, fy - 2.3 + wave * 0.6 + Math.sin(t) * r); } ctx.closePath(); ctx.fill();
  }
  function drawBurst(ctx, b) {
    /* hats-off sparkle over the slab: a ring of little stars that rise and fade */
    const p = b.t / 3, pal = K.pal;
    ctx.globalAlpha = 1 - p;
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, r = 10 + p * 22, x = b.x + Math.cos(a) * r * 1.6, y = b.y - 8 - p * 10 + Math.sin(a) * r * 0.5;
      ctx.fillStyle = [EMIT.candle, pal.flag, EMIT.winLit, pal.awning][i % 4];
      ctx.beginPath(); for (let k = 0; k < 8; k++) { const t = k * Math.PI / 4, rr = k % 2 ? 0.4 : 1.1; ctx[k ? 'lineTo' : 'moveTo'](x + Math.cos(t) * rr, y + Math.sin(t) * rr); } ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  return {
    step, collect, drawBack,
    list: () => Object.entries(V).map(([id, v]) => ({ id, title: v.title, kind: v.kind })),
    play(id) {
      if (!V[id]) return false;
      if (!today) newDay();
      if (active.has(id)) stop(id);
      if (id === 'dog' || id.startsWith('dog:')) { stop('dog'); for (const k of [...active.keys()]) if (k.startsWith('dog:')) stop(k); dog.on = false; }
      if (id === 'snowman' && story.snow && story.snow.stage >= 4) story.snow = null;
      if (id === 'cake') delete story.done.cake;
      if (id === 'inspector') delete story.done.inspector;
      if (id === 'pot') delete story.done.pot;
      return start(id, true) || id.startsWith('m:');
    },
    debug: () => ({
      today, slot, active: [...active.keys()], borrowed: [...borrowed],
      arcs: { dog: { stage: dogStage(), days: story.dog ? story.dog.days.length : 0, on: dog.on, pose: dog.pose, x: Math.round(dog.x), y: Math.round(dog.y), bandana: dog.bandana, house: !!(story.dog && story.dog.house) },
        pot: potStage(), mural: K.world.muralCount ? K.world.muralCount() : null, snowman: story.snow ? story.snow.stage : null, flag: story.flag ? story.flag.floor : null },
      inspector: inspectorSlot(), cakeDay: dayHash('cake') % 17 === 3, gullDay: dayHash('gull') % 2 === 0,
    }),
  };
}
