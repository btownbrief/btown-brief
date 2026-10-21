/* TEMPORARY stand-ins for builders A (data) and B (the site) while their
   branches are not merged. Deleted before the PR. Not shipped. */

const DAY = 86400000;
const NAMES = ['Maya', 'Kai', 'Jo', 'Sam', 'Priya', 'Theo', 'Ruth', 'Ada', 'Cy', 'Lou', 'Nina', 'Ben'];
const TASKS = ['brick', 'wire', 'haul', 'frame', 'window', 'roof', 'lunch'];

export function createBuild({ demo, user } = {}) {
  const me = () => (user && user() ? user().id : null);
  const now = () => Date.now();
  const S = {
    thing: null, shifts: [], posts: [], nice: new Map(), help: [], builder: { hat: 'amber', vest: 'lake', first_name_public: true },
  };
  if (demo) {
    const t0 = now();
    [['progress', 'Kai', 'Trued the back wheel. Took three tries.', 190, null], ['stuck', 'Maya', 'Can’t get the derailleur to shift onto the big ring', 0, 'a hand'],
      ['found', 'Jo', 'The Fletcher Free has a sewing machine you can borrow', 0, null], ['finished', 'Priya', 'Finished act two', 250, null],
      ['progress', 'Theo', 'Wrote the first page. It is bad. It exists.', 75, null]].forEach(([kind, name, line, hours, need], i) => {
      S.posts.push({ id: 'dp' + i, user: 'u-' + name, name, kind, line, hours_minutes: hours || null, help_need: need, created: new Date(t0 - (i + 1) * 3.3 * 3600000).toISOString(), nice: 3 + i * 2, mine_nice: false, thing_title: '' });
    });
    S.help.push({ id: 'h1', post: 'dp1', helper_name: 'Ben', line: 'I’ve got a stand and a Tuesday', status: 'offered' });
  }
  const ok = (v) => Promise.resolve(v);
  return {
    thing: {
      get: () => ok(S.thing),
      set: (t) => { S.thing = { id: (S.thing && S.thing.id) || 't1', status: 'active', created: new Date().toISOString(), ...(S.thing || {}), ...t }; return ok(S.thing); },
      finish: () => { if (S.thing) S.thing.status = 'done'; return ok(S.thing); },
      pause: () => { if (S.thing) S.thing.status = 'paused'; return ok(S.thing); },
    },
    shift: {
      start: (step) => ok({ id: 's' + now(), step }),
      heartbeat: () => ok(true),
      whistleAnswered: () => ok(true),
      end: ({ note, banked_minutes, id }) => { S.shifts.push({ id, kind: 'shift', ended: new Date().toISOString(), banked_minutes, note }); return ok(true); },
      recover: () => ok(null),
    },
    logIt: ({ minutes, note }) => { S.shifts.push({ kind: 'logged', ended: new Date().toISOString(), banked_minutes: minutes, note }); return ok(true); },
    post: { create: (p) => { const r = { id: 'mp' + now(), user: me(), name: 'You', mine: true, created: new Date().toISOString(), nice: 0, ...p }; S.posts.unshift(r); return ok(r); } },
    feed: { list: () => ok(S.posts.map((p) => ({ ...p, offers: S.help.filter((h) => h.post === p.id) }))) },
    nice: { toggle: (id) => { const p = S.posts.find((x) => x.id === id); if (p) { p.mine_nice = !p.mine_nice; p.nice += p.mine_nice ? 1 : -1; } return ok(p); } },
    help: {
      offer: (post, line) => { S.help.push({ id: 'h' + now(), post, helper_name: 'You', line, status: 'offered' }); return ok(true); },
      respond: (id, yes) => { const h = S.help.find((x) => x.id === id); if (h) h.status = yes ? 'accepted' : 'declined'; return ok(h); },
    },
    town: { get: () => ok({ total_minutes: 2460 * 60, week_minutes: 41 * 60, floors_done: 1, floor_progress: 0.4, posts_lit: S.posts.length,
      on_shift: demo ? NAMES.slice(0, 9).map((n, i) => ({ id: 'c' + i, look: { hat: ['amber', 'lake', 'brick'][i % 3], vest: 'park' }, task: TASKS[i % TASKS.length], name: n })) : [] }) },
    record: { get: () => ok(Array.from({ length: 14 }, (_, i) => ({ day: new Date(now() - i * DAY).toISOString().slice(0, 10), shift_minutes: demo ? [65, 0, 40, 120, 0, 30, 90][i % 7] : 0, logged_minutes: demo && i % 3 === 0 ? 45 : 0 }))) },
    shelf: { get: () => ok(S.posts.filter((p) => p.mine)) },
    builder: { get: () => ok(S.builder), set: (b) => { Object.assign(S.builder, b); return ok(S.builder); } },
    report: () => ok(true),
    block: () => ok(true),
    habitDrop: () => ok(true),
  };
}

export function createSite(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  let town = { floors_done: 0, floor_progress: 0, windows_lit: 0 }, crew = [], you = { state: 'off' }, whistle = false, night = false, cut = false, raf = 0;
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
    const floors = 6, fh = h * 0.1, bw = w * 0.5, bx = w * 0.25, base = h * 0.82;
    for (let f = 0; f < floors; f++) {
      const y = base - (f + 1) * fh;
      const done = f < town.floors_done ? 1 : f === town.floors_done ? town.floor_progress : 0;
      ctx.strokeStyle = night ? '#55606e' : '#9a8b78'; ctx.strokeRect(bx, y, bw, fh);
      ctx.fillStyle = cut ? '#e0a64b' : f === 0 ? '#a4553a' : '#c9a27a'; ctx.fillRect(bx, y + fh * (1 - done), bw, fh * done);
    }
    crew.forEach((c, i) => { ctx.fillStyle = '#f2a93b'; ctx.beginPath(); ctx.arc(bx + ((i * 37) % bw), base - 6 * dpr - (i % 3) * fh, 4 * dpr, 0, 7); ctx.fill(); });
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
