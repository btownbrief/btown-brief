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
   ui.js builds the switch itself (localSwitch); this file only pours. */

const liquids = new Map();
let raf = 0, wake = false;

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

export function attach(bar, { key, n, idx, prop, fallback }) {
  if (idx < 0 || !(n > 0)) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let canvas, ctx;
  try { canvas = document.createElement('canvas'); ctx = canvas.getContext('2d'); if (!ctx) return; } catch (e) { return; }
  canvas.className = 'lsw-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  bar.classList.add('liquid');
  bar.insertBefore(canvas, bar.firstChild);
  let s = liquids.get(key);
  if (!s) {
    s = { n, idx: null, L: 0, R: 0, vL: 0, vR: 0, dir: 1, churn: 0, drops: [], blobs: [], bubbles: [], bubbleAt: 0,
      colorFrom: null, colorTo: null, colorT: 1, phase: Math.random() * 20, splashed: true, splashed2: true, lastT: 0, faces: [] };
    liquids.set(key, s);
  }
  s.n = n;
  const first = s.idx === null;
  const flipped = !first && s.idx !== idx;
  if (first) { s.L = idx / n; s.R = (idx + 1) / n; s.vL = 0; s.vR = 0; }
  else if (flipped) { s.dir = idx > s.idx ? 1 : -1; s.colorFrom = s.colorTo; s.colorTo = null; s.colorT = 0; s.churn = 1; s.splashed = false; s.splashed2 = false; }
  s.idx = idx;
  s.faces = s.faces.filter((f) => f.canvas.isConnected && f.canvas !== canvas);
  s.faces.push({ bar, canvas, ctx, prop, fallback, color: null, slots: [...bar.querySelectorAll('button')] });
  s.lastT = performance.now() / 1000;
  if (!raf) raf = requestAnimationFrame(frame);
}

function slotBounds(face, s, W) {
  const b = face.slots[s.idx];
  if (!b || !W) return [s.idx / s.n, (s.idx + 1) / s.n];
  const gap = 4;
  const l = s.idx === 0 ? 0 : (b.offsetLeft - gap / 2) / W;
  const r = s.idx === s.n - 1 ? 1 : (b.offsetLeft + b.offsetWidth + gap / 2) / W;
  return [Math.max(0, Math.min(1, l)), Math.max(0, Math.min(1, r))];
}

function frame() {
  raf = 0;
  const now = performance.now() / 1000;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let alive = false;
  liquids.forEach((s) => {
    s.faces = s.faces.filter((f) => f.canvas.isConnected);
    if (!s.faces.length) return;
    alive = true;
    const shown = s.faces.filter((f) => f.bar.clientWidth > 0 && f.bar.clientHeight > 0);
    if (!shown.length) { s.lastT = now; return; }
    const W = shown[0].bar.clientWidth, H = shown[0].bar.clientHeight;
    const dt = Math.min(0.05, Math.max(0, now - s.lastT));
    s.lastT = now;
    const [tL, tR] = slotBounds(shown[0], s, W);
    const face = shown[0];
    /* the token is read per face per frame cheaply enough; a flip changes the prop */
    const want = cssVar(face.bar, face.prop, face.fallback);
    if (face.color !== want) face.color = want;
    if (s.colorTo !== face.color) { if (s.colorT >= 1 || !s.colorFrom) s.colorFrom = face.color; s.colorTo = face.color; }
    step(s, W, H, dt, now, tL, tR);
    shown.forEach((f) => {
      if (f.canvas.width !== W * dpr || f.canvas.height !== H * dpr) { f.canvas.width = W * dpr; f.canvas.height = H * dpr; }
      f.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      f.ctx.clearRect(0, 0, W, H);
      paint(s, f.ctx, W, H, tL, tR);
    });
  });
  if (!alive) return;
  if (!document.hidden) raf = requestAnimationFrame(frame);
  else if (!wake) {
    wake = true;
    document.addEventListener('visibilitychange', () => {
      wake = false;
      if (document.hidden || raf) return;
      liquids.forEach((s) => { s.lastT = performance.now() / 1000; });
      raf = requestAnimationFrame(frame);
    }, { once: true });
  }
}

function edgeFns(s, W, tL, tR) {
  const amp = (target) => (target <= 0.001 || target >= 0.999 ? 0 : 2.4) + s.churn * 8;
  const wave = (yy, ph, a) =>
    a * (Math.sin(yy * 0.18 + s.phase * 2.4 + ph) * 0.5 + Math.sin(yy * 0.07 - s.phase * 1.6 + ph * 1.7) * 0.32 + Math.sin(yy * 0.31 + s.phase * 4.2 + ph * 2.3) * 0.18) +
    s.churn * 5 * Math.sin(yy * 0.045 + s.phase * 1.1 + ph * 3.1) * Math.max(0, Math.sin(yy * 0.02 + ph));
  const aL = amp(tL), aR = amp(tR);
  return { aL, aR, left: (yy) => s.L * W + wave(yy, 0.9, aL), right: (yy) => s.R * W + wave(yy, 3.7, aR) };
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
  if (now > s.bubbleAt && slabR - slabL > 30) {
    s.bubbleAt = now + 0.35 + Math.random() * 0.8 - Math.min(0.5, s.churn * 0.5);
    s.bubbles.push({ x: slabL + 12 + Math.random() * (slabR - slabL - 24), y: H - 4, r: 0.9 + Math.random() * 1.7, vy: 9 + Math.random() * 9, ph: Math.random() * Math.PI * 2 });
  }
  for (let i = s.blobs.length - 1; i >= 0; i--) { const b = s.blobs[i]; b.life -= dt; if (b.life <= 0) { s.blobs.splice(i, 1); continue; } b.y = Math.min(H - 3, b.y + b.slide * dt); b.off = Math.max(0, b.off - dt * 4); }
  for (let i = s.drops.length - 1; i >= 0; i--) { const d = s.drops[i]; d.life -= dt; if (d.life <= 0) { s.drops.splice(i, 1); continue; } d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 150 * dt; }
  for (let i = s.bubbles.length - 1; i >= 0; i--) { const b = s.bubbles[i]; b.y -= b.vy * dt; b.x += Math.sin(s.phase * 2.4 + b.ph) * 5 * dt; if (b.y < 6 || b.x < slabL + 4 || b.x > slabR - 4) s.bubbles.splice(i, 1); }
}

function paint(s, x, W, H, tL, tR) {
  const fill = mixColor(s.colorFrom || '#16704E', s.colorTo || '#16704E', s.colorT);
  const { aL, aR, left: leftEdge, right: rightEdge } = edgeFns(s, W, tL, tR);
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
    const ex = b.edge === 'R' ? rightEdge(b.y) : leftEdge(b.y);
    const dir = b.edge === 'R' ? 1 : -1;
    x.fillStyle = fill; x.beginPath(); x.arc(ex + dir * b.off, b.y, b.r * Math.min(1, k * 1.6), 0, Math.PI * 2); x.fill();
  }
  const g = x.createLinearGradient((s.phase * 14) % W - W * 0.3, 0, (s.phase * 14) % W + W * 0.3, H);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.save(); x.beginPath();
  for (let yy = 0; yy <= H; yy += 3) x.lineTo(leftEdge(yy), yy);
  for (let yy = H; yy >= 0; yy -= 3) x.lineTo(rightEdge(yy), yy);
  x.closePath(); x.clip(); x.fillStyle = g; x.fillRect(0, 0, W, H); x.restore();
  const nearEdge = (d) => { const dl = d.x - leftEdge(d.y), dr = rightEdge(d.y) - d.x; if (dl >= 0 && dr >= 0) return 0; const gap = dl < 0 ? -dl : -dr; return gap < 9 ? (dl < 0 ? leftEdge(d.y) : rightEdge(d.y)) : null; };
  for (const d of s.drops) {
    x.globalAlpha = Math.min(1, d.life * 2.5); x.fillStyle = fill;
    const sp = Math.hypot(d.vx, d.vy), stretch = Math.min(1.8, 1 + sp / 260);
    x.save(); x.translate(d.x, d.y); x.rotate(Math.atan2(d.vy, d.vx));
    x.beginPath(); x.ellipse(0, 0, d.r * stretch, d.r / Math.sqrt(stretch), 0, 0, Math.PI * 2); x.fill(); x.restore();
    const e = nearEdge(d);
    if (e !== null && e !== 0) { x.beginPath(); x.arc((d.x + e) / 2, d.y, d.r * 0.55, 0, Math.PI * 2); x.fill(); }
  }
  x.globalAlpha = 1;
  for (const b of s.bubbles) {
    x.globalAlpha = Math.min(1, (b.y - 6) / 8); x.strokeStyle = 'rgba(255,255,255,0.38)'; x.lineWidth = 0.9; x.fillStyle = 'rgba(255,255,255,0.13)';
    x.beginPath(); x.arc(b.x, b.y, b.r, 0, Math.PI * 2); x.fill(); x.stroke();
  }
  x.globalAlpha = 1;
}
