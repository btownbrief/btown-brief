/* build-site.js — The Build's job site: Watershed going up on Lakeside Ave,
   a little enclosed world of builders, drawn and animated on one <canvas>.

   "The animation is the product." Focus Friend is a bean that knits while
   you leave your phone alone; this is a crew raising a real Burlington
   building while you leave yours alone. Glance down at any moment and your
   builder is in the middle of a real, multi-step job: at the lumber yard
   measuring and cutting a joist, carrying it over, climbing, setting it,
   nailing it home. Neighbours on shift are on the site too, each with a name
   tag and a job of their own, and what they build stays on the building.
   The building starts as an empty fenced lot and grows from things you
   watched being made and brought over. Small things happen around the work
   (a stray dog, a rain shower, geese), and only true milestones (the first
   pour, a floor finished, topping out) get a short moment of their own.

   This file is the kernel: the public API, the camera, the frame loop, a
   cache for layers that rarely change, and the wiring between modules.
     build-site-shared.js    layout, palette, vocabularies, helpers
     build-site-art.js       light and palette, the figure, props, sky, backdrop, weather, lights
     build-site-world.js     the yard's zones and structures, the street and passers-by
     build-site-building.js  the building's stages, from empty lot to topping out; the jobs it needs
     build-site-crew.js      builders, the foreman, vehicles, the multi-step jobs and logistics
     build-site-director.js  ambient life around the work, milestone moments, arcs across days

   API (builder C imports this; unchanged from v1, plus optional extras):
     const site = createSite(canvas, { reducedMotion, now })
     site.setTown({ total_minutes, floors_done, floor_progress, windows_lit, floors?, topped_out? })
     site.setCrew([{ id, look:{ hat, vest }, task, name? }])    name = the tag shown (nickname or first name); omit for just a hard hat
     site.setYou({ state: 'working'|'paused'|'off'|'away', look, task, name? })
     site.whistle(true|false)
     site.setSky({ sunAltitude, isNight, weather, hour?, snowCover? })
     site.dropMaterial(kind)
     site.cutaway(true|false, { your_minutes })
     site.destroy()
   Optional (v2):
     site.setClock(date|ms|null)     the site's clock (null = real time); the preview's "fast-forward a day"
     site.follow(id|null)            pan to a neighbour for a while ('you' for yourself); a tap on a figure does this too
     site.vignettes()                [{ id, title, kind }] the director knows
     site.playVignette(id)           start one now (preview, tests)
     site.onFollow = (info|null) => {}   optional callback: { id, name, job } while following someone
   Preview and tests: site.advance(seconds), site.render(), site.stats(), site.resetStats().

   Camera rules: it shows your builder (or the building when you're not on
   site). A tap on a neighbour follows them for a while. Nothing else moves
   it, except a milestone moment (first pour, a floor done, topping out):
   a few seconds, a gentle drift, a tap skips it, and never in the first
   minute of a shift or while the whistle is up.

   Cost: everything that rarely changes (backdrop, structures, the building)
   is drawn once into cached chunks at the current zoom and copied each
   frame; a frame draws the moving people and things in vector. 30fps at
   most while on screen, nothing while hidden or scrolled away. Reduced
   motion draws a still every few seconds, and the stills move the work on. */

import { WW, WH, GROUND_Y, STREET_Y, BUILDING, ZONES, clamp, hash, rng } from './build-site-shared.js';
import { createArt } from './build-site-art.js';
import { createWorld } from './build-site-world.js';
import { createBuilding } from './build-site-building.js';
import { createCrew } from './build-site-crew.js';
import { createDirector } from './build-site-director.js';

export { SITE_TASKS, SITE_MATERIALS } from './build-site-shared.js';

export function createSite(canvas, opts = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const reduced = opts.reducedMotion != null ? !!opts.reducedMotion
    : (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  canvas.style.imageRendering = 'auto';

  /* ------------------------------------------------------------ kernel
     K is shared by every module:
       S        public inputs as last set (town, you, crew, whistle, sky, cut, yourMinutes)
       t        simulation seconds since start (monotonic; advance() moves it)
       now()    the site's Date (real time, or the preview's clock)
       reduced  true under reduced motion
       view     { W, H } world units on screen, z = backing px per unit, dpr
       cam      { x, y } world position of the view's top-left
       light    { night 0..1, alt, evening, weather, snowy, wet, fog, ambient[3] } (set by art)
       pal      lit colours by BASE name (set by art)
       gen      bumps when zoom or light changes (caches re-render)
       moment(x, y, seconds)   a milestone moment asks for the camera (the kernel may refuse; returns bool)
       lights   this frame's light sources: push { x, y, r, a, color? } while drawing at night
                (work lights, lit windows, a lamp); art.drawLights() paints them last
       on/emit  a tiny event bus
       blit(...) cached layers (see below)
       R        the kernel's random source (use rng(hash(...)) for anything that must be the same on every phone) */
  const listeners = new Map();
  const K = {
    S: { town: { total_minutes: 0, floors_done: 0, floor_progress: 0, windows_lit: 0, floors: BUILDING.floors, topped_out: false },
      you: { state: 'away', look: {}, task: null, name: null }, crew: [], whistle: false,
      sky: { sunAltitude: 30, isNight: false, weather: 'clear' }, cut: false, yourMinutes: 0 },
    t: 0, lights: [], reduced, view: { W: 180, H: 150, z: 4, dpr: 1 }, cam: { x: 330, y: 330, tx: 330, ty: 330 }, light: {}, pal: {}, gen: 0,
    R: rng(hash('watershed') ^ (Date.now() & 0xffff)),
    clockFixed: null, shiftStartT: null,
    now() { return this.clockFixed != null ? new Date(this.clockFixed + this.t * 1000) : (opts.now ? opts.now() : new Date()); },
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); },
    emit(name, data) { const s = listeners.get(name); if (s) for (const fn of [...s]) { try { fn(data); } catch (e) { console.error(e); } } },
    moment, blit, drop,
  };

  /* modules */
  K.art = createArt(K);
  K.world = createWorld(K);
  K.building = createBuilding(K);
  K.crew = createCrew(K);
  K.director = createDirector(K);
  const modules = [K.art, K.world, K.building, K.crew, K.director];

  /* -------------------------------------------------- the layer cache
     blit(key, x, y, w, h, draw, { ver, p })
       Draws the world rectangle (x, y, w, h) from a cache, rendering it at
       the current zoom the first time it is seen (and again when the zoom,
       the light or `ver` changes). draw(g, x0, x1) paints world coordinates
       into it; the transform is already set and x0..x1 is the chunk being
       painted. Wide layers are split into chunks no wider than 1024 backing
       pixels and only chunks in view are rendered. p is parallax (1 = moves
       with the ground, 0.3 = far away): the layer is drawn shifted by
       cam.x * (1 - p). Call it while drawing, with the main ctx in world
       transform. Things that change often (a moving person) should not be
       cached. */
  const caches = new Map();
  let cachePixels = 0;
  const CACHE_BUDGET = 14e6;
  function blit(key, x, y, w, h, draw, o = {}) {
    const z = K.view.z, p = o.p == null ? 1 : o.p, ver = o.ver || 0;
    let e = caches.get(key);
    if (!e || e.x !== x || e.y !== y || e.w !== w || e.h !== h) { if (e) drop(key); e = { x, y, w, h, chunks: new Map() }; caches.set(key, e); }
    const camX = K.camPx ? K.camPx.x : K.cam.x, camY = K.camPx ? K.camPx.y : K.cam.y;
    const shift = camX * (1 - p);
    if (y > camY + K.view.H || y + h < camY) return;
    const cw = Math.max(8, Math.floor(1024 / z));
    const v0 = camX - shift - 2, v1 = camX - shift + K.view.W + 2;
    const i0 = Math.max(0, Math.floor((v0 - x) / cw)), i1 = Math.min(Math.ceil(w / cw) - 1, Math.floor((v1 - x) / cw));
    const stamp = K.gen + ':' + ver;
    for (let i = i0; i <= i1; i++) {
      const cx0 = x + i * cw, cx1 = Math.min(x + w, cx0 + cw + 1);   // 1 unit of overlap hides the seam
      let c = e.chunks.get(i);
      if (!c || c.stamp !== stamp) {
        if (!c) { c = { cv: document.createElement('canvas') }; e.chunks.set(i, c); } else cachePixels -= c.cv.width * c.cv.height;
        c.cv.width = Math.max(1, Math.ceil((cx1 - cx0) * z)); c.cv.height = Math.max(1, Math.ceil(h * z));
        cachePixels += c.cv.width * c.cv.height;
        const g = c.cv.getContext('2d');
        g.setTransform(z, 0, 0, z, -cx0 * z, -y * z);
        draw(g, cx0, cx1);
        c.stamp = stamp;
      }
      c.used = K.t;
      ctx.drawImage(c.cv, cx0 + shift, y, c.cv.width / z, c.cv.height / z);
    }
    if (cachePixels > CACHE_BUDGET) trimCaches();
  }
  function drop(key) { const e = caches.get(key); if (!e) return; for (const c of e.chunks.values()) cachePixels -= c.cv.width * c.cv.height; caches.delete(key); }
  function trimCaches() {
    const all = [];
    for (const [k, e] of caches) for (const [i, c] of e.chunks) all.push([c.used || 0, k, i, c]);
    all.sort((a, b) => a[0] - b[0]);
    for (const [, k, i, c] of all) { if (cachePixels < CACHE_BUDGET * 0.7) break; if (c.used === K.t) continue; cachePixels -= c.cv.width * c.cv.height; caches.get(k).chunks.delete(i); }
  }

  /* ------------------------------------------------------ the camera */
  let cssW = 0, cssH = 0;
  const cam = K.cam;
  let camSnap = true;
  let follow = null;            // { id, until }
  let mom = null;               // { x, y, until }
  function moment(x, y, seconds = 6) {
    /* a milestone asks for the camera; refused in the first minute of a
       shift, while the whistle is up, or under reduced motion */
    if (reduced || K.S.whistle) return false;
    if (K.shiftStartT != null && K.t - K.shiftStartT < 60) return false;
    mom = { x, y, until: K.t + clamp(seconds, 2, 8) };
    return true;
  }
  function layout() {
    const r = canvas.getBoundingClientRect();
    const cw = Math.max(1, r.width || canvas.clientWidth || 300), ch = Math.max(1, r.height || canvas.clientHeight || 200);
    /* backing resolution: the screen's, up to 2x, and at most ~1.3M pixels
       (a phone gets full sharpness; a big desktop panel a touch less) */
    let dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    const rr = canvas.getBoundingClientRect();
    const area = Math.max(1, (rr.width || 300) * (rr.height || 200));
    dpr = Math.max(0.75, Math.min(dpr, Math.sqrt(1.3e6 / area)));
    if (cw === cssW && ch === cssH && dpr === K.view.dpr && canvas.width > 1) return false;
    cssW = cw; cssH = ch;
    let s = Math.min(ch / 150, cw / 180);                 // CSS px per world unit
    s = Math.max(s, ch / 210, cw / WW, ch / WH, 0.5);
    const W = cw / s, H = ch / s;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const z = canvas.width / W;
    if (Math.abs(z - K.view.z) > 1e-6) K.gen++;
    K.view = { W, H, z, dpr };
    aim(0);
    if (camSnap) { cam.x = cam.tx; cam.y = cam.ty; camSnap = false; }
    cam.x = clamp(cam.x, 0, WW - W); cam.y = clamp(cam.y, 0, WH - H);
    K.emit('resize', K.view);
    return true;
  }
  function aim(dt) {
    const { W, H } = K.view;
    if (mom && mom.until < K.t) mom = null;
    if (follow && (follow.until < K.t || !K.crew.posOf(follow.id))) { follow = null; if (api.onFollow) api.onFollow(null); }
    const me = K.crew.youPos ? K.crew.youPos() : null;
    const fp = follow ? K.crew.posOf(follow.id) : null;
    const bx0 = BUILDING.towerX - 6, bx1 = BUILDING.craneX + 8;
    let cx, fy = null;
    const door = ZONES.office.spots.foreman;
    if (K.S.whistle) {
      /* the whistle is on the site: the trailer door is in view, with you if you fit */
      cx = me && Math.abs(me.x - door[0]) < W - 50 ? (me.x + door[0]) / 2 : door[0] + W * 0.2; fy = me ? Math.min(me.y, door[1]) : door[1];
    } else if (mom) { cx = mom.x; fy = mom.y; }
    else if (fp) { cx = fp.x; fy = fp.y; }
    else if (me) {
      /* keep you in view; centre the building when you both fit */
      const lo = Math.min(me.x - 20, bx0), hi = Math.max(me.x + 20, bx1);
      cx = hi - lo <= W ? (lo + hi) / 2 : me.x; fy = me.y;
    } else cx = (bx0 + bx1) / 2;
    const want = clamp(cx - W / 2, 0, WW - W);
    /* a dead zone: the camera follows when the action nears an edge, so a
       builder pacing a bay doesn't swing the whole site */
    if (camSnap || mom || fp || K.S.whistle || Math.abs(want - cam.tx) > W * 0.16) cam.tx = want;
    cam.tx = clamp(cam.tx, 0, WW - W);
    /* vertical: the focus (you, whoever you follow, or the working level)
       sits about two thirds down, so a tall phone shows ground and street
       under the action rather than a sky of nothing; the top of the work
       stays in view. A dead zone keeps a climb from bobbing the camera. */
    const workTop = (K.building.topY ? K.building.topY() : GROUND_Y - 60) - 18;
    const anchor = fy != null ? fy : Math.min(GROUND_Y + 8, workTop + 60);
    let ty = anchor - 0.64 * H;
    if (workTop < ty && (fy == null || fy > workTop + 30)) ty = Math.max(workTop, anchor + 20 - H);
    ty = clamp(ty, 0, WH - H);
    const rel = (anchor - cam.ty) / H;
    if (camSnap || mom || fp || K.S.whistle || rel < 0.4 || rel > 0.86 || Math.abs(ty - cam.ty) > H * 0.25) cam.ty = ty;
    cam.ty = clamp(cam.ty, 0, WH - H);
    if (dt > 0 && !reduced) {
      const k = Math.min(1, dt * (mom ? 0.9 : 1.6));
      cam.x += (cam.tx - cam.x) * k; cam.y += (cam.ty - cam.y) * k;
      if (Math.abs(cam.tx - cam.x) < 0.05) cam.x = cam.tx;
      if (Math.abs(cam.ty - cam.y) < 0.05) cam.y = cam.ty;
    } else if (reduced) { cam.x = cam.tx; cam.y = cam.ty; }
  }

  /* ------------------------------------------------------ the frame */
  const stats = { frames: 0, total: 0, max: 0, samples: [], tick: 0, ticks: 0 };
  let destroyed = false, raf = 0, lastFrame = 0, visible = true, onScreen = true, rmTimer = 0;

  function tick(dt) {
    dt = Math.min(dt, 0.25);
    K.t += dt;
    for (const m of modules) if (m.step) { try { m.step(dt); } catch (e) { report(e); } }
    aim(dt);
  }
  let reported = 0;
  function report(e) { if (reported++ < 5) console.error('build-site:', e); }
  function safe(fn) { try { fn(); } catch (e) { report(e); } }
  function render() {
    if (destroyed) return;
    const t0 = performance.now();
    const { z } = K.view;
    const ox = Math.round(cam.x * z), oy = Math.round(cam.y * z);
    K.camPx = { x: ox / z, y: oy / z };
    K.lights = [];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    safe(() => K.art.drawSky(ctx));                       // screen space
    ctx.setTransform(z, 0, 0, z, -ox, -oy);               // world space, snapped to whole pixels
    safe(() => K.art.drawBackdrop(ctx));
    safe(() => K.world.drawBack(ctx));
    safe(() => K.building.draw(ctx));
    const list = [];
    for (const m of modules) if (m.collect) safe(() => m.collect(list));
    list.sort((a, b) => a.y - b.y);
    for (const d of list) { ctx.save(); safe(() => d.draw(ctx)); ctx.restore(); }
    safe(() => K.world.drawFront(ctx));
    safe(() => K.art.drawWeather(ctx));
    safe(() => K.art.drawLights(ctx));
    if (K.crew.drawTags) safe(() => K.crew.drawTags(ctx, follow && follow.id));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const ms = performance.now() - t0;
    stats.frames++; stats.total += ms; stats.max = Math.max(stats.max, ms);
    if (stats.samples.length < 4000) stats.samples.push(ms);
  }
  function frame(ts) {
    raf = 0;
    if (destroyed || !visible || !onScreen) return;
    raf = requestAnimationFrame(frame);
    if (ts - lastFrame < 1000 / 30 - 2) return;           // 30fps cap
    const dt = lastFrame ? (ts - lastFrame) / 1000 : 1 / 30;
    lastFrame = ts;
    layout();
    const t0 = performance.now();
    tick(dt);
    stats.tick += performance.now() - t0; stats.ticks++;
    render();
  }
  function start() {
    if (destroyed) return;
    if (reduced) {
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
  function advanceSteps(seconds) { const n = Math.ceil(seconds / 0.1); for (let i = 0; i < n; i++) tick(0.1); }
  function poke() { if (reduced || !raf) { layout(); render(); } }

  const onVis = () => { visible = document.visibilityState !== 'hidden'; if (visible) start(); else stop(); };
  document.addEventListener('visibilitychange', onVis);
  let io = null;
  if (typeof IntersectionObserver === 'function') { io = new IntersectionObserver((es) => { onScreen = es.some((e) => e.isIntersecting); if (onScreen) start(); else stop(); }); io.observe(canvas); }
  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => { if (layout()) poke(); }); ro.observe(canvas); }

  /* a tap: skip a moment, or follow whoever is under the finger */
  const onTap = (e) => {
    if (mom) { mom = null; poke(); return; }
    const r = canvas.getBoundingClientRect();
    const x = K.cam.x + (e.clientX - r.left) / r.width * K.view.W, y = K.cam.y + (e.clientY - r.top) / r.height * K.view.H;
    const hit = K.crew.hit ? K.crew.hit(x, y) : null;
    api.follow(hit ? hit.id : null);
  };
  canvas.addEventListener('pointerdown', onTap);

  /* ============================================================ the API */
  K.art.setLight(K.S.sky);

  const api = {
    setTown(t = {}) {
      /* a partial update changes only what it names: the tab lights a
         window after a post with setTown({ windows_lit }) alone */
      const T = K.S.town, has = (k) => t[k] != null;
      if (has('total_minutes')) T.total_minutes = +t.total_minutes || 0;
      if (has('floors_done')) T.floors_done = Math.max(0, t.floors_done | 0);
      if (has('floor_progress')) T.floor_progress = clamp(+t.floor_progress || 0, 0, 1);
      if (has('windows_lit') || has('posts_lit')) T.windows_lit = Math.max(0, (has('windows_lit') ? t.windows_lit : t.posts_lit) | 0);
      if (has('floors')) T.floors = clamp(t.floors | 0, 2, 12);
      if (has('topped_out')) T.topped_out = !!t.topped_out;
      K.building.setTown(T);
      poke();
    },
    setCrew(list = []) {
      K.S.crew = (Array.isArray(list) ? list : []).filter((p) => p && !p.me).slice(0, 30);
      K.crew.setCrew(K.S.crew);
      poke();
    },
    setYou(y = {}) {
      const state = ['working', 'paused', 'off', 'away'].includes(y.state) ? y.state : 'away';
      const prev = K.S.you.state;
      K.S.you = { state, look: y.look || K.S.you.look || {}, task: y.task || K.S.you.task, name: y.name != null ? y.name : K.S.you.name };
      if (state === 'working' && prev !== 'working' && prev !== 'paused') K.shiftStartT = K.t;
      K.crew.setYou(K.S.you);
      poke();
    },
    whistle(on) { K.S.whistle = !!on; if (on) mom = null; K.crew.whistle(!!on); poke(); },
    setSky(sky = {}) {
      K.S.sky = { ...K.S.sky, ...sky };
      if (sky.sunAltitude == null && sky.isNight != null) K.S.sky.sunAltitude = sky.isNight ? -15 : 30;
      if (K.art.setLight(K.S.sky)) K.gen++;
      poke();
    },
    dropMaterial(kind) { K.crew.deliver(kind); poke(); },
    cutaway(on, o = {}) { K.S.cut = !!on; K.S.yourMinutes = +(o && o.your_minutes) || 0; K.building.cutaway(K.S.cut, K.S.yourMinutes); poke(); },
    destroy() {
      destroyed = true; stop();
      document.removeEventListener('visibilitychange', onVis);
      if (io) io.disconnect(); if (ro) ro.disconnect();
      canvas.removeEventListener('pointerdown', onTap);
      for (const m of modules) if (m.destroy) m.destroy();
      for (const k of [...caches.keys()]) drop(k);
    },
    /* v2, optional */
    setClock(d) {
      K.clockFixed = d == null ? null : (d instanceof Date ? d.getTime() : +d) - K.t * 1000;
      K.emit('clock', K.now());
      poke();
    },
    follow(id) {
      if (id == null || !K.crew.posOf(id)) { follow = null; if (api.onFollow) api.onFollow(null); poke(); return false; }
      follow = { id, until: K.t + 14 };
      if (api.onFollow) api.onFollow(K.crew.info ? K.crew.info(id) : { id });
      poke(); return true;
    },
    onFollow: null,
    vignettes() { return K.director.list ? K.director.list() : []; },
    playVignette(id) { const ok = K.director.play ? K.director.play(id) : false; poke(); return ok; },
    /* preview + tests */
    advance(seconds) { advanceSteps(+seconds || 0); render(); },
    render() { layout(); render(); },
    stats() {
      const s = stats.samples.slice().sort((p, q) => p - q);
      const pct = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0);
      return { frames: stats.frames, avgMs: stats.frames ? stats.total / stats.frames : 0, tickMs: stats.ticks ? stats.tick / stats.ticks : 0,
        p50: pct(0.5), p95: pct(0.95), maxMs: stats.max, size: [Math.round(K.view.W), Math.round(K.view.H)], town: { ...K.S.town }, z: +K.view.z.toFixed(2),
        cam: [Math.round(cam.x), Math.round(cam.y)], agents: K.crew.count ? K.crew.count() : 0, running: !!raf, cachePx: cachePixels,
        /* crew: [id, x, y, state, act|'gone'] for each figure (the v1 shape the tab and tests read); crewDebug: everything */
        crew: crewRows(), crewDebug: K.crew.debug ? K.crew.debug() : null, you: K.crew.youPos ? K.crew.youPos() : null,
        story: K.director.debug ? K.director.debug() : null, stage: K.building.stage ? K.building.stage() : null,
        following: follow ? follow.id : null, moment: !!mom };
    },
    resetStats() { stats.frames = 0; stats.total = 0; stats.max = 0; stats.samples = []; stats.tick = 0; stats.ticks = 0; },
  };
  function crewRows() {
    const d = K.crew.debug ? K.crew.debug() : null;
    const list = d && Array.isArray(d.agents) ? d.agents : [];
    return list.filter((a) => !a.hidden).map((a) => [a.id, a.x, a.y, a.state, a.gone ? 'gone' : (a.act || a.pose || '-')]);
  }
  layout();
  start();
  return api;
}
