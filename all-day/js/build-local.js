/* build-local.js — The Build for a reader who has not signed in, and the
   one call that wires the tab's API (openBuild).

   LocalBuild IS the fake (build-fake.js), for one reader who is always
   "this phone", so the rules cannot drift: same checks, same refusal codes,
   same order. What it adds is keeping: your thing, your hours and your
   builder are written to one key, LOCAL_KEY, as versioned JSON, and read
   back before every call (so two tabs agree). Hours older than importDays
   are let go on the next write. Posts, Nice, help, reports and blocks need
   a person, so they never reach it (build-core.js LOCAL_DOORS).

   At sign-in, snapshot() is what bd_import_local takes, and forget() lets
   go of it once the account has it. Every storage touch is wrapped, as in
   habits-local.js: a phone that refuses to store keeps everything in memory
   for the visit, and a copy written by a newer version is never overwritten. */

import { BUILD_RULES, dayKey, addDays, isKey, checkThing, checkBuilder, createBuild, liveServer, fakeServer, memoryStorage } from './build-core.js';
import { FakeBuild, seedDemo } from './build-fake.js';
import { DEMO_ME } from './boards-fake.js';

export { memoryStorage };
export const LOCAL_KEY = 'allday-build-local';
export const SHIFT_KEY = 'allday-build-shift';
export const OUTBOX_KEY = 'allday-build-outbox';
export const LOCAL_VERSION = 1;
const ME = 'this-phone';
const WRITES = new Set(['bd_thing_set', 'bd_thing_status', 'bd_shift_add', 'bd_log_add', 'bd_builder_set']);
const fail = (code) => { const e = new Error(code); e.code = code; return e; };
const randomId = () => {
  try { if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* older phones */ }
  return 'l-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
};

/* The browser's localStorage under one key, every touch wrapped. */
export function browserStorage(key = LOCAL_KEY) {
  return {
    get() { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(key, v); return true; } catch (e) { return false; } },
    remove() { try { localStorage.removeItem(key); return true; } catch (e) { return false; } },
  };
}

export class LocalBuild extends FakeBuild {
  constructor({ now, rules, storage } = {}) {
    super({ now, rules });
    this.storage = storage || memoryStorage();
    this.uid = ME;
    this.newer = false;
    this.memOnly = false;
    this._read();
  }

  as() { return this; }
  _newId() { return randomId(); }

  call(fn, a = {}) {
    this._read();
    if (WRITES.has(fn) && this.newer) throw fail('offline');
    const out = super.call(fn, a);
    if (WRITES.has(fn)) this._write();
    return out;
  }

  /* ------------------------------------------------------------ keeping */
  _read() {
    if (this.memOnly) return;
    const raw = this.storage.get();
    this.things = []; this.shifts = []; this.builders = new Map(); this.newer = false;
    if (!raw) return;
    let d = null;
    try { d = JSON.parse(raw); } catch (e) { d = null; }
    if (!d || typeof d !== 'object') return;
    if (typeof d.v === 'number' && d.v > LOCAL_VERSION) { this.newer = true; return; }
    if (d.v !== LOCAL_VERSION) return;
    if (d.builder) { const c = checkBuilder(this.rules, null, d.builder); if (c.ok) this.builders.set(ME, c.builder); }
    const ids = new Set();
    for (const x of Array.isArray(d.things) ? d.things : []) {
      if (!x || typeof x.id !== 'string' || ids.has(x.id) || !this.rules.thingStatuses.includes(x.status)) continue;
      const c = checkThing(this.rules, null, x);
      if (!c.ok) continue;
      ids.add(x.id);
      this.things.push({ id: x.id, user_id: ME, ...c.thing, status: x.status, created_at: Number.isFinite(x.created_at) ? x.created_at : 0,
        done_at: Number.isFinite(x.done_at) ? x.done_at : null });
    }
    const L = this.rules.limits;
    const seen = new Set();
    for (const s of Array.isArray(d.shifts) ? d.shifts : []) {
      if (!s || typeof s.client_id !== 'string' || seen.has(s.client_id) || !this.rules.shiftKinds.includes(s.kind) || !isKey(s.day)) continue;
      if (!Number.isInteger(s.minutes) || s.minutes < 1 || s.minutes > L.shiftMaxMinutes) continue;
      seen.add(s.client_id);
      this.shifts.push({ id: typeof s.id === 'string' ? s.id : s.client_id, user_id: ME, client_id: s.client_id, thing_id: ids.has(s.thing_id) ? s.thing_id : null,
        kind: s.kind, started: Number.isFinite(s.started) ? s.started : null, ended: Number.isFinite(s.ended) ? s.ended : null, day: s.day,
        minutes: s.minutes, step: typeof s.step === 'string' ? s.step : '', note: typeof s.note === 'string' ? s.note : '', posted: false, created_at: 0 });
    }
  }
  _write() {
    const from = addDays(dayKey(this.now()), -this.rules.limits.importDays);
    const b = this.builders.get(ME) || null;
    const things = this.things.map((t) => ({ id: t.id, title: t.title, why: t.why, for_whom: t.for_whom, partner: t.partner, target_date: t.target_date,
      why_public: t.why_public, status: t.status, created_at: t.created_at, done_at: t.done_at }));
    const shifts = this.shifts.filter((s) => s.day >= from).map((s) => ({ id: s.id, client_id: s.client_id, thing_id: s.thing_id, kind: s.kind,
      started: s.started, ended: s.ended, day: s.day, minutes: s.minutes, step: s.step, note: s.note }));
    if (!b && !things.length && !shifts.length) { if (this.storage.remove() === false) this.memOnly = true; return; }
    if (!this.storage.set(JSON.stringify({ v: LOCAL_VERSION, builder: b, things, shifts }))) this.memOnly = true;
  }

  /* nobody else's things live on this phone */
  bd_public_things() { return []; }

  /* ------------------------------------------------- moving to an account */
  has() { this._read(); return this.things.length > 0 || this.shifts.length > 0 || this.builders.has(ME); }

  /* What bd_import_local takes: the current thing (not finished ones), the
     hours of the last importDays days (at most importShiftsMax, newest
     first), and the look. Null when there is nothing to move. */
  snapshot() {
    this._read();
    if (!this.has()) return null;
    const L = this.rules.limits;
    const today = dayKey(this.now()), from = addDays(today, -L.importDays);
    const cur = this._current(ME);
    const shifts = this.shifts.filter((s) => s.day >= from && s.day <= today).sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, L.importShiftsMax)
      .map((s) => ({ client_id: s.client_id, kind: s.kind, day: s.day, minutes: Math.min(s.minutes, s.kind === 'logged' ? L.logMaxMinutes : L.shiftMaxMinutes),
        on_thing: !!cur && s.thing_id === cur.id, step: s.step, note: s.note }));
    return {
      thing: cur ? { title: cur.title, why: cur.why, for_whom: cur.for_whom, partner: cur.partner, target_date: cur.target_date, why_public: cur.why_public, status: cur.status } : null,
      shifts,
      builder: this.builders.get(ME) || null,
    };
  }

  /* The account has it now: the phone lets go of everything. */
  forget() {
    this._read();
    if (this.newer) return;
    this.things = []; this.shifts = []; this.builders = new Map();
    if (this.storage.remove() === false) this.memOnly = true;
  }
}

/* --------------------------------------------------------------- openBuild */
/* The tab's API, wired: live Supabase (or the demo's fake town) for a
   signed-in reader and for the public doors; this phone (LocalBuild) for a
   reader who has not signed in. In the demo nothing is kept between visits.

     demo   app.demo
     user   () => app.user()           ({ id } or null)
     token  () => app.token()          (a promise of the access token)
     url, key  store.SB_URL, store.SB_KEY
     config    data/build-config.json, parsed (optional)
     now, random, fetch, storages      for tests */
let demoTown = null;
export function demoFake(now) {
  if (!demoTown) demoTown = seedDemo(new FakeBuild({ now }), DEMO_ME);
  return demoTown;
}
export function openBuild({ demo = false, user = () => null, token = () => Promise.resolve(null), url, key, config, now, random, fetch,
  localStorage: ls, shiftStorage, outboxStorage, fake } = {}) {
  const uid = () => { const u = user(); return u ? u.id || null : null; };
  const lb = new LocalBuild({ now, storage: ls || (demo ? memoryStorage() : browserStorage(LOCAL_KEY)) });
  const localSrv = fakeServer(lb, null);
  localSrv.snapshot = () => lb.snapshot();
  localSrv.forget = () => lb.forget();
  const server = demo ? fakeServer(fake || demoFake(now), uid) : liveServer({ url, key, user, token, fetch });
  return createBuild({
    server, local: localSrv, uid, config, now, random,
    storage: {
      shift: shiftStorage || (demo ? memoryStorage() : browserStorage(SHIFT_KEY)),
      outbox: outboxStorage || (demo ? memoryStorage() : browserStorage(OUTBOX_KEY)),
    },
  });
}
export { BUILD_RULES };
