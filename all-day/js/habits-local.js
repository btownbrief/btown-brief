/* habits-local.js — the Habits tab for a reader who has not signed in: the
   same doors as the server (supabase/sz-SETUP.sql) and the demo
   (habits-fake.js), answered on this phone and kept in its localStorage.

   It IS the fake, for one reader who is always signed in as "this phone",
   so the rules cannot drift: same checks, same refusal codes, same order,
   same today-only taps on the New York day (habits-core.js). What it adds
   is keeping: every change is written to one key, LOCAL_KEY, as versioned
   JSON, and read back before every call (so two tabs agree). Taps older
   than IMPORT_DAYS are let go on the next write.

   Only the tracker's doors open here. The season tile asks the server
   (sz_season_next is public), and anything that needs a person (the member
   row, pods, deleting an account) refuses with not_signed_in.

   At sign-in, snapshot() is the list sz_import_local takes, and forget()
   lets go of exactly the habits the account took, nothing added since
   (modes/habits.js). An account that already had habits takes only some
   of a phone's (no archived ones, no past days); then the phone keeps its
   copy and remembers which habits went to that account (merged), so they
   are never sent twice.

   Every storage touch is wrapped: a phone that refuses to store (private
   mode, a full disk) keeps the habits in memory for the visit, and stops
   reading the key back, so nothing done this visit is lost to it. A copy
   written by a newer version of this file is never overwritten: it is read
   as empty and every change is refused until the page reloads with the new
   code. */

import { IMPORT_DAYS, dayKey, addDays, isKey, checkHabit } from './habits-core.js';
import { FakeHabits, byOrder } from './habits-fake.js';

export const LOCAL_KEY = 'allday-habits-local';
export const LOCAL_VERSION = 1;
const ME = 'this-phone';
/* the doors a phone answers itself; the rest need a person */
export const LOCAL_DOORS = new Set(['sz_rules', 'sz_habits_get', 'sz_habit_add', 'sz_habit_set', 'sz_tap', 'sz_untap', 'sz_taps_get']);
const WRITES = new Set(['sz_habit_add', 'sz_habit_set', 'sz_tap', 'sz_untap']);

const fail = (code) => { const e = new Error(code); e.code = code; return e; };
const randomId = () => {
  try { if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* older phones */ }
  return 'l-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
};

/* Where the JSON lives. The browser's, under LOCAL_KEY; or memory, for the
   demo (which keeps nothing) and the tests. */
export function browserStorage(key = LOCAL_KEY) {
  return {
    get() { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(key, v); return true; } catch (e) { return false; } },
    remove() { try { localStorage.removeItem(key); } catch (e) { /* nothing to do */ } },
  };
}
export function memoryStorage(initial = null) {
  let v = initial;
  return { get: () => v, set: (x) => { v = x; return true; }, remove: () => { v = null; } };
}

export class LocalHabits extends FakeHabits {
  constructor({ now, rules, storage } = {}) {
    super({ now, rules });
    this.storage = storage || memoryStorage();
    this.uid = ME;
    this.newer = false;   // the stored copy is from a newer version: read-only
    this.memOnly = false; // a write was refused: memory is the copy for this visit
    this.merged = {};     // account id -> ids of this phone's habits already added to it
    this._read();
  }

  /* always this phone's reader */
  as() { return this; }
  _newId() { return randomId(); }

  call(fn, a = {}) {
    if (!LOCAL_DOORS.has(fn)) throw fail('not_signed_in');
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
    let d = null;
    this.habits = [];
    this.taps = new Map();
    this.merged = {};
    this.newer = false;
    if (!raw) return;
    try { d = JSON.parse(raw); } catch (e) { d = null; }
    if (!d || typeof d !== 'object') return;
    if (typeof d.v === 'number' && d.v > LOCAL_VERSION) { this.newer = true; return; }
    if (d.v !== LOCAL_VERSION || !Array.isArray(d.habits)) return;
    const ids = new Set();
    for (const x of d.habits) {
      if (!x || typeof x.id !== 'string' || ids.has(x.id)) continue;
      const c = checkHabit(this.rules, x);
      if (!c.ok) continue;
      ids.add(x.id);
      this.habits.push({ id: x.id, user_id: ME, goal_id: null, text: c.habit.text, frequency: c.habit.frequency, n: c.habit.n,
        is_goal: false, shared: c.habit.shared, position: Number.isFinite(x.position) ? x.position : 0,
        archived_at: Number.isFinite(x.archived_at) ? x.archived_at : null, created_at: Number.isFinite(x.created_at) ? x.created_at : 0 });
    }
    const taps = d.taps && typeof d.taps === 'object' ? d.taps : {};
    for (const id of Object.keys(taps)) {
      if (!ids.has(id) || !Array.isArray(taps[id])) continue;
      for (const k of taps[id]) if (isKey(k)) this.taps.set(id + '|' + k, { habit: id, user: ME, date: k, source: 'app' });
    }
    const merged = d.merged && typeof d.merged === 'object' ? d.merged : {};
    for (const u of Object.keys(merged)) if (Array.isArray(merged[u])) this.merged[u] = merged[u].filter((id) => ids.has(id));
  }
  _write() {
    const from = addDays(dayKey(this.now()), -IMPORT_DAYS);
    const taps = {};
    for (const t of this.taps.values()) {
      if (t.date < from) continue;
      (taps[t.habit] = taps[t.habit] || []).push(t.date);
    }
    Object.values(taps).forEach((l) => l.sort());
    const habits = this.habits.map((h) => ({ id: h.id, text: h.text, frequency: h.frequency, n: h.n, shared: h.shared,
      position: h.position, archived_at: h.archived_at, created_at: h.created_at }));
    if (!habits.length) { this.storage.remove(); this.merged = {}; return; }
    if (!this.storage.set(JSON.stringify({ v: LOCAL_VERSION, habits, taps, merged: this.merged }))) this.memOnly = true;
  }

  /* ------------------------------------------------------- moving to an account */
  has() { this._read(); return this.habits.length > 0; }

  /* What goes to an account at sign-in, as { list, ids, whole }:
     list   what sz_import_local takes: your habits in your order, then the
            archived ones, newest first, at most habitsMax in all; each with
            its taps from the last IMPORT_DAYS days, and nothing that names
            this phone
     ids    this phone's ids for those, in the same order, for forget()
     whole  true when list is everything the phone has
     Habits already added to account `uid` by an earlier merge are left out. */
  snapshot(uid) {
    this._read();
    const today = dayKey(this.now()), from = addDays(today, -IMPORT_DAYS);
    const done = new Set((uid && this.merged[uid]) || []);
    const mine = this.habits.filter((h) => !done.has(h.id));
    const active = mine.filter((h) => !h.archived_at).sort(byOrder);
    const archived = mine.filter((h) => h.archived_at).sort((a, b) => b.archived_at - a.archived_at);
    const all = active.concat(archived);
    const sent = all.slice(0, this.rules.limits.habitsMax);
    return {
      ids: sent.map((h) => h.id),
      whole: sent.length === this.habits.length,
      list: sent.map((h) => ({
        text: h.text, frequency: h.frequency, n: h.n, shared: !!h.shared, archived: !!h.archived_at,
        taps: [...this.taps.values()].filter((t) => t.habit === h.id && t.date >= from && t.date <= today).map((t) => t.date).sort(),
      })),
    };
  }
  toImport() { return this.snapshot().list; }

  /* Let go of these habits and their taps: the account has them now.
     Anything else (added since, or more than one call could carry) stays. */
  forget(ids) {
    this._read();
    if (this.newer) return;
    const gone = new Set(ids);
    this.habits = this.habits.filter((h) => !gone.has(h.id));
    for (const [k, t] of this.taps) if (gone.has(t.habit)) this.taps.delete(k);
    for (const u of Object.keys(this.merged)) this.merged[u] = this.merged[u].filter((id) => !gone.has(id));
    this._write();
  }

  /* These habits were added to account `uid`, but the phone keeps them (an
     account that already had habits takes no past days). */
  markMerged(uid, ids) {
    this._read();
    if (this.newer) return;
    this.merged[uid] = [...new Set([...(this.merged[uid] || []), ...ids])];
    this._write();
  }
  /* habits the phone has that account `uid` has not had yet */
  pendingFor(uid) {
    this._read();
    const done = new Set(this.merged[uid] || []);
    return this.habits.some((h) => !done.has(h.id));
  }

  /* Forget everything. A newer version's copy stays. */
  clear() {
    this._read();
    if (this.newer) return;
    this.storage.remove();
    this.habits = [];
    this.taps = new Map();
    this.merged = {};
  }
}
