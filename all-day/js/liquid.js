/* liquid.js — THE LIQUID, ported from the old app's ui.js by way of the
   design prototype, with its physics intact. A toggle's fill is a body of
   water: pick the other side and the slab pours across the bar. The leading
   edge springs ahead, the trailing edge lags so the liquid stretches,
   droplets fly and cling blobs hang at the broken edge when it lands, and
   the boundary settles into a lapping wave. Local is green water,
   Everything is red; both colours are read from the tokens at draw time.

   One body of water per key, shared by every canvas that shows it, so the
   Wire's switch and On Air's switch are the same lake. Skipped entirely
   under prefers-reduced-motion; the CSS fill still works without it.
   ui.js builds the switch itself (localSwitch); this file only pours.

   Since 2026-10-19 (Stephen: "have that effect for the main ones I want
   people switching through across the tabs") any switch can pour:
   liquify(bar, { key, idx, colors }) with one colour token per segment
   (the Wire's News · Photos · Square, On Air's TV · Podcasts · Playlists
   and Feed · Topics). The bar's buttons are the segments, in order; the
   bar is built again on each pick and liquified again, and the same key
   carries the water across.

   One rAF loop for every body of water, and the water stays alive while
   it is on screen and the reader is using the app: the edge laps and
   bubbles rise, as they did in the old app. (The first version went still
   five seconds after a pick, mid-wave, and Stephen saw it as "frozen at
   times".) A pick churns and splashes at the full frame rate; the steady
   lap is drawn 30 times a second. Half a minute after the last touch,
   scroll or key, the lap eases flat and the loop stops until the next
   one; it stops while the page is hidden, and a bar off screen is skipped.

   The water is clipped to the pill inside the canvas, not only by the
   bar's rounded overflow: Safari does not always clip a canvas layer to a
   parent's rounded corners when the parent has a backdrop filter or is
   mid-transform (the floating pills shrink as you scroll), and the colour
   then showed outside the outline. */

const liquids = new Map();
let raf = 0;
const LAP = 5;           // seconds a pick churns and laps hard before the steady lap
const CALM = 30;         // seconds after the last touch, scroll or key before the water rests
const STEADY = 1 / 30;   // the steady lap's frame interval
const nowS = () => performance.now() / 1000;
let touched = nowS();    // the reader's last touch, scroll or key
let level = 1;           // how far the steady lap moves: 1 while the reader is here, easing to 0 (flat)
let lastFrame = 0;
let epoch = 0;           // bumps on a theme change, so each colour token is read again

const hasFaces = () => { for (const s of liquids.values()) if (s.faces.length) return true; return false; };
function kick() { if (!raf && !document.hidden && hasFaces()) raf = requestAnimationFrame(frame); }
function nudge(sec) { const now = nowS(); liquids.forEach((s) => { s.until = Math.max(s.until, now + sec); }); kick(); }

/* a bar that appears, or changes size, gets measured and painted again */
const sized = 'ResizeObserver' in window ? new ResizeObserver((es) => {
  const now = nowS();
  es.forEach((e) => liquids.forEach((s) => s.faces.forEach((f) => { if (f.bar === e.target) { f.pad = null; s.until = Math.max(s.until, now + 0.25); } })));
  kick();
}) : null;
/* a bar scrolled off screen is not drawn */
const seen = 'IntersectionObserver' in window ? new IntersectionObserver((es) => {
  es.forEach((e) => liquids.forEach((s) => s.faces.forEach((f) => { if (f.bar === e.target) f.vis = e.isIntersecting; })));
  kick();
}) : null;
/* the reader's touch, scroll or key keeps the water moving (scroll does
   not bubble, but every element's scroll passes the window on capture) */
const poke = () => { touched = nowS(); kick(); };
['pointerdown', 'touchstart', 'keydown', 'wheel', 'scroll'].forEach((t) => window.addEventListener(t, poke, { capture: true, passive: true }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const now = nowS();
  touched = now; lastFrame = 0;
  liquids.forEach((s) => { s.lastT = now; });
  kick();
});
/* a theme change repaints the water in that theme's colours */
const themed = () => { epoch++; nudge(0.3); };
try { new MutationObserver(themed).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); } catch (e) { /* the next pick repaints */ }
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themed); } catch (e) { /* an old Safari: the next pick repaints */ }

/* the shared control: the water takes segment idx's colour token (a
   name like '--liq-news'; tokens.css holds the colours) */
export function liquify(bar, { key, idx, colors }) {
  if (!bar || !Array.isArray(colors) || !colors[idx]) return;
  attach(bar, { key, n: colors.length, idx, prop: colors[idx], fallback: '#16704E' });
}

const cssVar = (node, prop, fallback) => (getComputedStyle(node).getPropertyValue(prop).trim() || fallback);
function rgbOf(c) {
  if (!c) return null;
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) { let h = hex[1]; if (h.length === 3) h = h.replace(/./g, (ch) => ch + ch); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  const n = c.match(/\d+(\.\d+)?/g);
  return n && n.length >= 3 ? [+n[0], +n[1], +n[2]] : null;
}
function mixColor(a, b, t) {
  const pa = rgbOf(a), pb = rgbOf(b);
  if (!pa || !pb) return t < 0.5 ? a : b;
  const m = (i) => Math.round(pa[i] + (pb[i] - pa[i]) * t);
  return 'rgb(' + m(0) + ',' + m(1) + ',' + m(2) + ')';
}
/* The water sits inside the switch's padding, where the buttons are, so
   it never reaches the rim: the canvas is placed on that inner box, and
   its corners are the inner radius (a pill's is half its height). */
function boxOf(f) {
  if (!f.pad) {
    const cs = getComputedStyle(f.bar);
    const n = (v) => parseFloat(v) || 0;
    const [t, r, b, l] = [n(cs.paddingTop), n(cs.paddingRight), n(cs.paddingBottom), n(cs.paddingLeft)];
    f.pad = [t, r, b, l];
    Object.assign(f.canvas.style, { left: l + 'px', top: t + 'px', width: 'calc(100% - ' + (l + r) + 'px)', height: 'calc(100% - ' + (t + b) + 'px)' });
    const rad = parseFloat(cs.borderTopLeftRadius);
    f.radius = Number.isFinite(rad) && !/%/.test(cs.borderTopLeftRadius) ? Math.max(0, rad - n(cs.borderTopWidth) - t) : Infinity;
  }
  return { W: Math.max(0, f.bar.clientWidth - f.pad[1] - f.pad[3]), H: Math.max(0, f.bar.clientHeight - f.pad[0] - f.pad[2]), l: f.pad[3] };
}

export function attach(bar, { key, n, idx, prop, fallback }) {
  if (idx < 0 || !(n > 0)) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  /* one canvas per bar: a bar liquified again keeps its canvas */
  let canvas = bar.querySelector(':scope > canvas.lsw-canvas'), ctx = null;
  try {
    if (!canvas) { canvas = document.createElement('canvas'); canvas.className = 'lsw-canvas'; canvas.setAttribute('aria-hidden', 'true'); bar.insertBefore(canvas, bar.firstChild); }
    ctx = canvas.getContext('2d');
  } catch (e) { ctx = null; }
  if (!ctx) { if (canvas) canvas.remove(); return; }
  bar.classList.add('liquid');
  let s = liquids.get(key);
  if (!s) {
    s = { n, idx: null, L: 0, R: 0, vL: 0, vR: 0, dir: 1, churn: 0, drops: [], blobs: [], bubbles: [], bubbleAt: 0,
      propFrom: prop, propTo: prop, colorT: 1, phase: Math.random() * 20, splashed: true, splashed2: true, lastT: 0, faces: [], until: 0, paintedAt: 0, rested: false };
    liquids.set(key, s);
  }
  s.n = n;
  const first = s.idx === null;
  const flipped = !first && s.idx !== idx;
  if (first) { s.L = idx / n; s.R = (idx + 1) / n; s.vL = 0; s.vR = 0; }
  else if (flipped) { s.dir = idx > s.idx ? 1 : -1; s.propFrom = s.propTo; s.colorT = 0; s.churn = 1; s.splashed = false; s.splashed2 = false; }
  s.propTo = prop;
  s.idx = idx;
  /* this bar's old face goes (a bar liquified again). A face whose bar has
     left the page goes at the next frame; one built but not yet on the page
     (a tab often liquifies a bar before it inserts it) waits for it. */
  liquids.forEach((o) => { o.faces = o.faces.filter((f) => f.canvas !== canvas); });
  const now = nowS();
  s.faces.push({ bar, canvas, ctx, fallback, from: null, to: null, props: '', epoch: -1, radius: null, slots: [...bar.querySelectorAll('button')], drawn: false, born: now, placed: false, vis: true, pad: null });
  if (sized) sized.observe(bar);
  if (seen) seen.observe(bar);
  if (!raf) s.lastT = now;
  s.until = Math.max(s.until, now + (first ? 0.5 : LAP));
  s.rested = false;
  kick();
}

/* keep a face while its canvas is on the page, or for a while before it
   first gets there; a face that has gone hands its bitmap back (Safari
   caps the memory all canvases may hold, and each pick builds a new bar) */
function keeps(now) {
  return (f) => {
    if (f.canvas.isConnected) { f.placed = true; return true; }
    if (!f.placed && now - f.born < 10) return true;
    if (sized) sized.unobserve(f.bar);
    if (seen) seen.unobserve(f.bar);
    f.canvas.width = 0; f.canvas.height = 0;
    /* were the bar put back without being liquified again, the plain fill shows */
    f.bar.classList.remove('liquid');
    return false;
  };
}

/* the chosen segment on the inner box (W wide, starting x0 in from the
   bar's padding edge): from halfway across the gap before it to halfway
   across the gap after, the ends to the ends */
function slotBounds(face, s, W, x0) {
  const sl = face.slots, b = sl[s.idx], prev = sl[s.idx - 1], next = sl[s.idx + 1];
  if (!b || !W) return [s.idx / s.n, (s.idx + 1) / s.n];
  const l = s.idx === 0 || !prev ? 0 : ((prev.offsetLeft + prev.offsetWidth + b.offsetLeft) / 2 - x0) / W;
  const r = s.idx === s.n - 1 || !next ? 1 : ((b.offsetLeft + b.offsetWidth + next.offsetLeft) / 2 - x0) / W;
  return [Math.max(0, Math.min(1, l)), Math.max(0, Math.min(1, r))];
}

function frame() {
  raf = 0;
  if (document.hidden) return;
  const now = nowS();
  const dt0 = lastFrame ? Math.min(0.1, now - lastFrame) : 0;
  lastFrame = now;
  /* the steady lap follows the reader: up quickly on a touch, flat slowly after CALM */
  level = Math.max(0, Math.min(1, level + (now - touched < CALM ? dt0 / 0.6 : -dt0 / 1.5)));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const fits = (f) => { const bx = boxOf(f); return f.canvas.width === Math.round(bx.W * dpr) && f.canvas.height === Math.round(bx.H * dpr); };
  let alive = false;
  liquids.forEach((s) => {
    s.faces = s.faces.filter(keeps(now));
    const shown = s.faces.filter((f) => f.vis !== false && f.bar.clientWidth > 0 && f.bar.clientHeight > 0);
    if (!shown.length) { s.lastT = now; return; }
    const busy = now < s.until || s.churn > 0.01 || s.drops.length > 0 || s.blobs.length > 0 || Math.abs(s.vL) + Math.abs(s.vR) > 0.002 || s.colorT < 1;
    const still = !busy && level <= 0;
    /* each canvas reads the colour tokens where it sits (the mast and the paper differ) */
    const props = s.propFrom + '|' + s.propTo;
    const fresh = shown.every((f) => f.drawn && f.epoch === epoch && f.props === props && fits(f));
    if (!still) alive = true;
    /* still water already painted: nothing to do */
    if (still && fresh && s.rested) { s.lastT = now; return; }
    /* the steady lap at 30 a second; a pour at the full rate */
    if (!busy && !still && fresh && now - s.paintedAt < STEADY - 0.004) return;
    const dt = Math.min(0.05, Math.max(0, now - s.lastT));
    s.lastT = now; s.paintedAt = now; s.rested = still;
    shown.forEach((f) => { if (f.epoch !== epoch || f.props !== props) { f.from = cssVar(f.bar, s.propFrom, f.fallback); f.to = cssVar(f.bar, s.propTo, f.fallback); f.epoch = epoch; f.props = props; } });
    const lead = shown[0];
    const lb = boxOf(lead), W = lb.W, H = lb.H;
    const [tL, tR] = slotBounds(lead, s, W, lb.l);
    if (still) { s.bubbles.length = 0; s.L = tL; s.R = tR; s.vL = 0; s.vR = 0; }
    else step(s, W, H, dt, now, tL, tR);
    /* each canvas at its own size, the water on its own segment */
    shown.forEach((f) => {
      const fb = boxOf(f), fW = fb.W, fH = fb.H;
      if (!fits(f)) { f.canvas.width = Math.round(fW * dpr); f.canvas.height = Math.round(fH * dpr); }
      const [fl, fr] = f === lead ? [tL, tR] : slotBounds(f, s, fW, fb.l);
      f.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      f.ctx.clearRect(0, 0, fW, fH);
      paint(s, f.ctx, { fill: mixColor(f.from, f.to, s.colorT), W: fW, H: fH, tL: fl, tR: fr, oL: fl - tL, oR: fr - tR, kx: fW / W, ky: fH / H, r: f.radius });
      f.drawn = true;
    });
  });
  if (alive) raf = requestAnimationFrame(frame);
}

function edgeFns(s, g) {
  const amp = (target) => (target <= 0.001 || target >= 0.999 ? 0 : 2.4 * level) + s.churn * 8;
  const wave = (yy, ph, a) =>
    a * (Math.sin(yy * 0.18 + s.phase * 2.4 + ph) * 0.5 + Math.sin(yy * 0.07 - s.phase * 1.6 + ph * 1.7) * 0.32 + Math.sin(yy * 0.31 + s.phase * 4.2 + ph * 2.3) * 0.18) +
    s.churn * 5 * Math.sin(yy * 0.045 + s.phase * 1.1 + ph * 3.1) * Math.max(0, Math.sin(yy * 0.02 + ph));
  const aL = amp(g.tL), aR = amp(g.tR);
  return { aL, aR, left: (yy) => (s.L + g.oL) * g.W + wave(yy, 0.9, aL), right: (yy) => (s.R + g.oR) * g.W + wave(yy, 3.7, aR) };
}

function step(s, W, H, dt, now, tL, tR) {
  s.phase += dt;
  const spring = (p, v, target, k, c) => { v += (k * (target - p) - c * v) * dt; return [p + v * dt, v]; };
  const goingRight = s.dir > 0;
  [s.L, s.vL] = spring(s.L, s.vL, tL, goingRight ? 64 : 130, goingRight ? 9 : 10);
  [s.R, s.vR] = spring(s.R, s.vR, tR, goingRight ? 130 : 64, goingRight ? 10 : 9);
  const lead = goingRight ? s.R : s.L, leadV = goingRight ? s.vR : s.vL, leadT = goingRight ? tR : tL;
  if (s.churn > 0.4 && Math.abs(leadV) > 0.8 && Math.random() < 0.6) {
    s.drops.push({ x: lead * W, y: H * (0.2 + Math.random() * 0.6), vx: leadV * W * (0.5 + Math.random() * 0.5), vy: -20 + Math.random() * 40, r: 1 + Math.random() * 1.6, life: 0.3 + Math.random() * 0.25 });
  }
  if (!s.splashed && s.churn > 0.5 && Math.abs(lead - leadT) < 0.045 && Math.abs(leadV) > 0.35) {
    s.splashed = true;
    const bx = leadT * W;
    for (let i = 0; i < 12; i++) {
      s.drops.push({ x: bx, y: H * (0.15 + Math.random() * 0.7), vx: (goingRight ? 1 : -1) * (20 + Math.random() * 80) * (Math.random() < 0.25 ? -0.45 : 1), vy: -30 + Math.random() * 55, r: 1.4 + Math.random() * 3.1, life: 0.55 + Math.random() * 0.5 });
    }
    for (let i = 0; i < 9; i++) {
      const maxLife = 0.7 + Math.random() * 0.9;
      s.blobs.push({ edge: goingRight ? 'R' : 'L', y: H * (0.1 + Math.random() * 0.8), off: (Math.random() < 0.6 ? 1 + Math.random() * 4 : 6 + Math.random() * 9), r: 2 + Math.random() * 4, life: maxLife, maxLife, slide: 4 + Math.random() * 9 });
    }
  }
  const trail = goingRight ? s.L : s.R, trailV = goingRight ? s.vL : s.vR, trailT = goingRight ? tL : tR;
  if (!s.splashed2 && s.churn > 0.3 && Math.abs(trail - trailT) < 0.04 && Math.abs(trailV) > 0.25) {
    s.splashed2 = true;
    for (let i = 0; i < 6; i++) {
      const maxLife = 0.6 + Math.random() * 0.8;
      s.blobs.push({ edge: goingRight ? 'L' : 'R', y: H * (0.1 + Math.random() * 0.8), off: (Math.random() < 0.6 ? 1 + Math.random() * 3 : 5 + Math.random() * 7), r: 1.6 + Math.random() * 3.2, life: maxLife, maxLife, slide: 4 + Math.random() * 8 });
    }
  }
  s.churn = Math.max(0, s.churn - dt * 0.7);
  s.colorT = Math.min(1, s.colorT + dt * 2.2);
  const slabL = Math.min(s.L, s.R) * W, slabR = Math.max(s.L, s.R) * W;
  /* bubbles rise while the reader is here (and through a pour) */
  if ((level > 0.5 || now < s.until - 0.6) && now > s.bubbleAt && slabR - slabL > 30) {
    s.bubbleAt = now + 0.35 + Math.random() * 0.8 - Math.min(0.5, s.churn * 0.5);
    s.bubbles.push({ x: slabL + 12 + Math.random() * (slabR - slabL - 24), y: H - 4, r: 0.9 + Math.random() * 1.7, vy: 9 + Math.random() * 9, ph: Math.random() * Math.PI * 2 });
  }
  for (let i = s.blobs.length - 1; i >= 0; i--) { const b = s.blobs[i]; b.life -= dt; if (b.life <= 0) { s.blobs.splice(i, 1); continue; } b.y = Math.min(H - 3, b.y + b.slide * dt); b.off = Math.max(0, b.off - dt * 4); }
  for (let i = s.drops.length - 1; i >= 0; i--) { const d = s.drops[i]; d.life -= dt; if (d.life <= 0) { s.drops.splice(i, 1); continue; } d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 150 * dt; }
  for (let i = s.bubbles.length - 1; i >= 0; i--) { const b = s.bubbles[i]; b.y -= b.vy * dt; b.x += Math.sin(s.phase * 2.4 + b.ph) * 5 * dt; if (b.y < 6 || b.x < slabL + 4 || b.x > slabR - 4) s.bubbles.splice(i, 1); }
}

/* the pill's own outline, as the clip for everything the water draws */
function capsule(x, W, H, r) {
  const k = Math.max(0, Math.min(r, H / 2, W / 2));
  x.beginPath();
  x.moveTo(k, 0);
  x.arcTo(W, 0, W, H, k); x.arcTo(W, H, 0, H, k); x.arcTo(0, H, 0, 0, k); x.arcTo(0, 0, W, 0, k);
  x.closePath();
  x.clip();
}

/* g: this canvas's colour (fill), its size (W, H), its segment (tL, tR), the offset of that
   segment from the lead canvas's (oL, oR), the scale from the lead
   canvas's pixels (kx, ky) and the corner radius (r) */
function paint(s, x, g) {
  const { W, H, kx, ky } = g;
  const ox = (g.oL + g.oR) / 2 * W;   // the lead canvas's pixels, moved onto this canvas's segment
  const fill = g.fill;
  const { aL, aR, left: leftEdge, right: rightEdge } = edgeFns(s, g);
  x.save();
  capsule(x, W, H, g.r);
  x.beginPath();
  for (let yy = 0; yy <= H; yy += 3) x.lineTo(leftEdge(yy), yy);
  for (let yy = H; yy >= 0; yy -= 3) x.lineTo(rightEdge(yy), yy);
  x.closePath(); x.fillStyle = fill; x.fill();
  const crest = (edgeFn, a) => {
    if (a <= 0.1) return;
    x.beginPath();
    for (let yy = 0; yy <= H; yy += 3) x.lineTo(edgeFn(yy), yy);
    x.strokeStyle = 'rgba(255,255,255,' + Math.min(0.5, 0.22 + s.churn * 0.3).toFixed(3) + ')';
    x.lineWidth = 1.4; x.stroke();
  };
  crest(leftEdge, aL); crest(rightEdge, aR);
  for (const b of s.blobs) {
    const k = b.life / b.maxLife;
    const by = b.y * ky;
    const ex = b.edge === 'R' ? rightEdge(by) : leftEdge(by);
    const dir = b.edge === 'R' ? 1 : -1;
    x.fillStyle = fill; x.beginPath(); x.arc(ex + dir * b.off * kx, by, b.r * Math.min(1, k * 1.6), 0, Math.PI * 2); x.fill();
  }
  const g2 = x.createLinearGradient((s.phase * 14) % W - W * 0.3, 0, (s.phase * 14) % W + W * 0.3, H);
  g2.addColorStop(0, 'rgba(255,255,255,0)'); g2.addColorStop(0.5, 'rgba(255,255,255,0.10)'); g2.addColorStop(1, 'rgba(255,255,255,0)');
  x.save(); x.beginPath();
  for (let yy = 0; yy <= H; yy += 3) x.lineTo(leftEdge(yy), yy);
  for (let yy = H; yy >= 0; yy -= 3) x.lineTo(rightEdge(yy), yy);
  x.closePath(); x.clip(); x.fillStyle = g2; x.fillRect(0, 0, W, H); x.restore();
  const nearEdge = (dx, dy) => { const dl = dx - leftEdge(dy), dr = rightEdge(dy) - dx; if (dl >= 0 && dr >= 0) return 0; const gap = dl < 0 ? -dl : -dr; return gap < 9 ? (dl < 0 ? leftEdge(dy) : rightEdge(dy)) : null; };
  for (const d of s.drops) {
    const dx = d.x * kx + ox, dy = d.y * ky;
    x.globalAlpha = Math.min(1, d.life * 2.5); x.fillStyle = fill;
    const sp = Math.hypot(d.vx, d.vy), stretch = Math.min(1.8, 1 + sp / 260);
    x.save(); x.translate(dx, dy); x.rotate(Math.atan2(d.vy, d.vx));
    x.beginPath(); x.ellipse(0, 0, d.r * stretch, d.r / Math.sqrt(stretch), 0, 0, Math.PI * 2); x.fill(); x.restore();
    const e = nearEdge(dx, dy);
    if (e !== null && e !== 0) { x.beginPath(); x.arc((dx + e) / 2, dy, d.r * 0.55, 0, Math.PI * 2); x.fill(); }
  }
  x.globalAlpha = 1;
  for (const b of s.bubbles) {
    const by = b.y * ky;
    x.globalAlpha = Math.min(1, (b.y - 6) / 8); x.strokeStyle = 'rgba(255,255,255,0.38)'; x.lineWidth = 0.9; x.fillStyle = 'rgba(255,255,255,0.13)';
    x.beginPath(); x.arc(b.x * kx + ox, by, b.r, 0, Math.PI * 2); x.fill(); x.stroke();
  }
  x.globalAlpha = 1;
  x.restore();
}

/* for the tests: is the loop running, and how far the steady lap moves;
   rest() is the reader gone quiet (as CALM seconds without a touch) */
export const _state = () => ({ running: !!raf, level, keys: [...liquids.keys()] });
export function _rest() { touched = -Infinity; kick(); }
