/* ============================================================
   SECOND SIGHT — the ghost layer inside Btown Out Loud.
   At a story stop, hold the phone up: the historical photograph floats
   over the live camera, a compass arrow guides you to the stored bearing,
   the ghost gets stronger as your heading matches, and you line it up by
   hand (that is the game). No camera? The same photo, the same slider.

   Pure maths up top (tested in sight.test.mjs); the DOM part below is
   loaded lazily by app.js the first time someone taps "Second Sight".
   Not world-tracked AR: GPS + compass + camera, the way location AR
   actually works in a browser on a phone in 2026.
   ============================================================ */

/* ---------- pure ---------- */
/** Signed difference from `heading` to `target`, in (-180, 180]. Positive = turn right. */
export function headingDiff(target, heading) {
  if (typeof target !== 'number' || typeof heading !== 'number' || Number.isNaN(target) || Number.isNaN(heading)) return null;
  let d = ((target - heading) % 360 + 540) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}
/** Ghost opacity for a heading error: full strength within ±8°, fading to `floor` at ±60° and beyond. */
export function opacityFor(diffDeg, { floor = 0.25, max = 0.85, full = 8, fade = 60 } = {}) {
  if (diffDeg == null) return floor;
  const a = Math.abs(diffDeg);
  if (a <= full) return max;
  if (a >= fade) return floor;
  return max - (max - floor) * ((a - full) / (fade - full));
}
/** Is the heading close enough to count as lined up? */
export function matched(diffDeg, tol = 12) { return diffDeg != null && Math.abs(diffDeg) <= tol; }
/** A demo heading that sweeps ±sweep° around `bearing`, passing through it every `period` ms, and holding on it for `hold` ms each pass. */
export function demoHeading(bearing, tMs, { sweep = 50, period = 9000, hold = 2000 } = {}) {
  const cycle = period + hold;
  const u = ((tMs % cycle) + cycle) % cycle;
  if (u >= period) return (bearing + 360) % 360;
  return (bearing + Math.sin((u / period) * Math.PI * 2) * sweep + 360) % 360;
}
/** Where to draw a `sw`×`sh` image so it covers a `vw`×`vh` viewport (like object-fit: cover). */
export function coverRect(sw, sh, vw, vh) {
  const s = Math.max(vw / sw, vh / sh);
  const w = sw * s, h = sh * s;
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}
/** Compass heading (degrees clockwise from north) from a DeviceOrientation event, or null. */
export function headingFromEvent(e) {
  if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) return e.webkitCompassHeading; // iOS: already true-north-ish
  if (e.absolute && typeof e.alpha === 'number') return (360 - e.alpha) % 360;   // Android absolute alpha is counter-clockwise
  return null;
}
/** Does this device have what the camera view needs? (feature detection only; permission comes later) */
export function capabilities(win = globalThis) {
  const nav = win.navigator || {};
  const camera = Boolean(nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function');
  const orientation = 'DeviceOrientationEvent' in win;
  const needsPermission = orientation && typeof win.DeviceOrientationEvent.requestPermission === 'function';
  return { camera, orientation, needsPermission };
}

/* ---------- the view ---------- */
export function openSight(pin, { demo = false, onClose = null, count = null } = {}) {
  const sight = pin.sight;
  if (!sight) return null;
  const caps = capabilities();
  const root = document.getElementById('sight');
  const els = {
    video: root.querySelector('#sight-video'), fake: root.querySelector('#sight-fake'), img: root.querySelector('#sight-img'),
    canvas: root.querySelector('#sight-canvas'), arrow: root.querySelector('#sight-arrow'), guide: root.querySelector('#sight-guide'),
    slider: root.querySelector('#sight-opacity'), then: root.querySelector('#sight-then'), capture: root.querySelector('#sight-capture'),
    close: root.querySelector('#sight-close'), title: root.querySelector('#sight-title'), credit: root.querySelector('#sight-credit'),
    stand: root.querySelector('#sight-stand'), lineup: root.querySelector('#sight-lineup'), status: root.querySelector('#sight-status'),
    calib: root.querySelector('#sight-calibrate'), share: root.querySelector('#sight-share'), result: root.querySelector('#sight-result'),
    resultImg: root.querySelector('#sight-result-img'), resultClose: root.querySelector('#sight-result-close'), resultSave: root.querySelector('#sight-result-save'),
  };
  let stream = null, heading = null, forced = null, userOpacity = null, thenOnly = false, raf = 0, stopOrient = null, t0 = performance.now(), closed = false;
  let lastMatchedAt = 0;

  els.title.textContent = `${pin.title}, ${sight.year}`;
  els.credit.textContent = `${sight.title} · ${sight.credit} · ${sight.license}`;
  els.credit.href = sight.source_url;
  els.stand.textContent = sight.stand_at || pin.stand_at || '';
  els.lineup.textContent = sight.line_up || '';
  els.img.src = sight.image;
  els.img.alt = sight.title;
  els.slider.value = 0;      // 0 = follow the compass; the user can override
  els.fake.hidden = true; els.video.hidden = true;
  els.result.hidden = true;
  root.hidden = false;
  document.body.classList.add('ol-sight-open');
  root.dataset.mode = 'loading';

  const setStatus = (t) => { els.status.textContent = t; };

  // camera
  async function startCamera() {
    if (demo) {
      els.fake.hidden = false; root.dataset.mode = 'demo';
      setStatus('Demo street: a fake camera and a fake compass sweep.');
      return;
    }
    if (!caps.camera) { root.dataset.mode = 'slider'; setStatus('No camera here, so this is the photo and the slider.'); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1920 } }, audio: false });
      els.video.srcObject = stream; els.video.hidden = false;
      await els.video.play().catch(() => {});
      root.dataset.mode = 'camera';
      setStatus('Hold the phone up and turn until the arrow points straight up.');
    } catch (e) {
      root.dataset.mode = 'slider';
      setStatus('Camera not available (denied, or an installed-app quirk on iPhone). Open this page in Safari for the camera; the slider works here.');
    }
  }
  // compass
  async function startCompass() {
    if (demo) { root.dataset.compass = 'demo'; return; }
    if (!caps.orientation) { root.dataset.compass = 'none'; return; }
    if (caps.needsPermission) {
      try { const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') { root.dataset.compass = 'denied'; return; } }
      catch { root.dataset.compass = 'denied'; return; }
    }
    const evName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    const handler = (e) => { const h = headingFromEvent(e); if (h != null) heading = h; };
    window.addEventListener(evName, handler, true);
    stopOrient = () => window.removeEventListener(evName, handler, true);
    root.dataset.compass = 'on';
    setTimeout(() => { if (heading == null && !closed) { root.dataset.compass = 'silent'; setStatus('No compass reading yet. Wave the phone in a figure eight, or just use the slider.'); } }, 3000);
  }

  function frame(now) {
    if (closed) return;
    const h = forced != null ? forced : (demo ? demoHeading(sight.bearing, now - t0) : heading);
    const diff = headingDiff(sight.bearing, h);
    const auto = opacityFor(diff);
    const op = thenOnly ? 1 : (userOpacity != null ? userOpacity : auto);
    els.img.style.opacity = op.toFixed(3);
    if (diff == null) { els.arrow.hidden = true; }
    else {
      els.arrow.hidden = false;
      els.arrow.style.transform = `rotate(${diff}deg)`;
      const m = matched(diff);
      root.dataset.matched = String(m);
      if (m) { if (!lastMatchedAt) lastMatchedAt = now; els.guide.textContent = 'Lined up. Slide the ghost, or hold it here.'; }
      else { lastMatchedAt = 0; els.guide.textContent = `Turn ${diff > 0 ? 'right' : 'left'} ${Math.round(Math.abs(diff))}°`; }
    }
    raf = requestAnimationFrame(frame);
  }

  // controls
  els.slider.oninput = () => { const v = Number(els.slider.value); userOpacity = v === 0 ? null : v / 100; thenOnly = false; els.then.setAttribute('aria-pressed', 'false'); };
  els.then.onclick = () => { thenOnly = !thenOnly; els.then.setAttribute('aria-pressed', String(thenOnly)); };
  els.calib.onclick = () => { userOpacity = null; els.slider.value = 0; thenOnly = false; els.then.setAttribute('aria-pressed', 'false'); };
  els.capture.onclick = () => { const url = composite(); if (url) { els.resultImg.src = url; els.result.hidden = false; if (count) count('sight_capture', pin.id); } };
  els.resultClose.onclick = () => { els.result.hidden = true; };
  els.resultSave.onclick = async () => {
    const a = document.createElement('a'); a.href = els.resultImg.src; a.download = `second-sight-${pin.id}.png`; a.click();
  };
  els.share.onclick = async () => {
    try {
      const blob = await (await fetch(els.resultImg.src)).blob();
      const file = new File([blob], `second-sight-${pin.id}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: `${pin.title}, then and now`, text: `${pin.title}, ${sight.year} over today. Btown Out Loud.` });
      else els.resultSave.click();
      if (count) count('sight_share', pin.id);
    } catch { /* cancelled */ }
  };
  els.close.onclick = close;
  function close() {
    if (closed) return; closed = true;
    cancelAnimationFrame(raf);
    if (stopOrient) stopOrient();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    els.video.srcObject = null;
    root.hidden = true; root.dataset.mode = ''; root.dataset.matched = 'false';
    document.body.classList.remove('ol-sight-open');
    if (onClose) onClose();
  }

  /** Draw what is on screen into a PNG: the live frame (or demo field), the ghost at its current opacity, a credit strip. No upload. */
  function composite() {
    const c = els.canvas; const w = root.clientWidth, h = root.clientHeight;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext('2d'); ctx.scale(scale, scale);
    const mode = root.dataset.mode;
    if (mode === 'camera' && els.video.videoWidth) {
      const r = coverRect(els.video.videoWidth, els.video.videoHeight, w, h);
      ctx.drawImage(els.video, r.x, r.y, r.w, r.h);
    } else if (mode === 'demo') {
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#9fc2e0'); g.addColorStop(0.62, '#e5e2da'); g.addColorStop(0.63, '#6b5a4a'); g.addColorStop(1, '#3a3028');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    } else { ctx.fillStyle = '#13243B'; ctx.fillRect(0, 0, w, h); }
    if (els.img.naturalWidth) {
      const r = coverRect(els.img.naturalWidth, els.img.naturalHeight, w, h);
      ctx.globalAlpha = Number(els.img.style.opacity || 0.5);
      ctx.drawImage(els.img, r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
    }
    // credit strip: the terms of showing a photo from an archive
    const strip = 56; ctx.fillStyle = 'rgba(19,36,59,0.88)'; ctx.fillRect(0, h - strip, w, strip);
    ctx.fillStyle = '#F3EFE8'; ctx.font = '600 15px "DM Sans", system-ui, sans-serif'; ctx.textBaseline = 'middle';
    ctx.fillText(`${pin.title}, ${sight.year} · Btown Out Loud`, 14, h - strip + 19);
    ctx.font = '400 11px "DM Sans", system-ui, sans-serif'; ctx.fillStyle = '#BFC9D6';
    ctx.fillText(truncate(ctx, `${sight.credit} · ${sight.license}`, w - 28), 14, h - strip + 39);
    try { return c.toDataURL('image/png'); } catch { return null; }
  }
  function truncate(ctx, s, maxW) { while (s.length > 8 && ctx.measureText(s).width > maxW) s = s.slice(0, -4) + '…'; return s; }

  startCamera(); startCompass();
  raf = requestAnimationFrame(frame);
  if (count) count('sight_open', pin.id);
  const api = { close, setHeading: (h) => { forced = h; heading = h; }, release: () => { forced = null; }, composite, get mode() { return root.dataset.mode; } };
  return api;
}
