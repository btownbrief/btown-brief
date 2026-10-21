/* TEMPORARY stand-ins while builders A (data) and B (the site) are not
   merged. A's API comes from its worktree through an untracked symlink (_a);
   the site is a placeholder drawing. Deleted before the PR. Not shipped. */

export function createSite(canvas) {
  const ctx = canvas.getContext('2d');
  let town = { floors_done: 0, floor_progress: 0 }, crew = [], you = { state: 'off' }, whistle = false, night = false, cut = false, raf = 0;
  const draw = () => {
    raf = 0;
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!r.width) return;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    const w = canvas.width, h = canvas.height;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, night ? '#0b1530' : '#7fb3dd'); g.addColorStop(1, night ? '#24345a' : '#dcecf6');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = night ? '#1d2a2a' : '#7a8f6a'; ctx.fillRect(0, h * 0.82, w, h * 0.18);
    const floors = 7, fh = h * 0.09, bw = w * 0.5, bx = w * 0.25, base = h * 0.82;
    for (let f = 0; f < floors; f++) {
      const y = base - (f + 1) * fh;
      const done = f < town.floors_done ? 1 : f === town.floors_done ? town.floor_progress : 0;
      ctx.strokeStyle = night ? '#55606e' : '#9a8b78'; ctx.strokeRect(bx, y, bw, fh);
      ctx.fillStyle = cut ? '#e0a64b' : f === 0 ? '#a4553a' : '#c9a27a'; ctx.fillRect(bx, y + fh * (1 - done), bw, fh * done);
    }
    crew.forEach((c, i) => { ctx.fillStyle = '#f2a93b'; ctx.beginPath(); ctx.arc(bx + ((i * 37 * dpr) % bw), base - 6 * dpr - (i % 3) * fh, 4 * dpr, 0, 7); ctx.fill(); });
    if (you.state !== 'off') { ctx.fillStyle = you.state === 'working' ? '#2f6fb2' : '#d9644f'; ctx.fillRect(w * 0.15, base - 14 * dpr, 8 * dpr, 14 * dpr); }
    ctx.fillStyle = '#5b4a3a'; ctx.fillRect(w * 0.8, base - 24 * dpr, 30 * dpr, 24 * dpr);
    if (whistle) { ctx.fillStyle = '#ffd36b'; ctx.beginPath(); ctx.arc(w * 0.8 + 15 * dpr, base - 34 * dpr, 6 * dpr, 0, 7); ctx.fill(); }
  };
  const ask = () => { if (!raf) raf = requestAnimationFrame(draw); };
  const ro = 'ResizeObserver' in window ? new ResizeObserver(ask) : null;
  if (ro) ro.observe(canvas);
  ask();
  return {
    setTown(t) { town = { ...town, ...t }; ask(); },
    setCrew(c) { crew = c || []; ask(); },
    setYou(y) { you = { ...you, ...y }; ask(); },
    whistle(on) { whistle = !!on; ask(); },
    setSky(s) { night = !!(s && s.isNight); ask(); },
    dropMaterial() { ask(); },
    cutaway(on) { cut = !!on; ask(); },
    destroy() { if (ro) ro.disconnect(); cancelAnimationFrame(raf); },
  };
}
