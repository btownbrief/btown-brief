/* habits-fake.js — an in-memory copy of supabase/sz-SETUP.sql, for ?demo=1
   and for scripts/test-habits-core.mjs.

   Same function names, same arguments, same answers, same refusal codes, in
   the same order of checks, built on the same rules (habits-core.js). It
   saves nothing and calls nothing. The clock is injected so a test can walk
   past midnight; the caller is set with as(userId) so a test can be any
   member, or nobody. Pods, goals and seasons are plain arrays a test (or
   the demo seed) fills in, the way Stephen fills them in the database. */

import { HABIT_RULES, IMPORT_DAYS, dayKey, addDays, daysBetween, isKey, checkHabit, checkMe } from './habits-core.js';

const fail = (code) => { const e = new Error(code); e.code = code; return e; };
let seq = 0;
const newId = () => '00000000-0000-4000-8000-5a' + (++seq).toString(16).padStart(10, '0');
/* what one habit in sz_import_local's list may carry, and nothing else: no
   id, no owner, so a list can never reach a habit that already exists */
const IMPORT_KEYS = ['text', 'frequency', 'n', 'shared', 'archived', 'taps'];
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
export const byOrder = (a, b) => (Number(b.is_goal) - Number(a.is_goal)) || (a.position - b.position) || (a.created_at - b.created_at) || (a.id < b.id ? -1 : 1);

export class FakeHabits {
  constructor({ now, rules } = {}) {
    this.now = now || (() => Date.now());
    this.rules = rules || HABIT_RULES;
    this.uid = null;
    this.members = new Map();   // uid -> { name, phone, city, pod, email_opt_out }
    this.habits = [];           // rows, as sz_habits holds them (created_at in ms)
    this.taps = new Map();      // `${habit}|${date}` -> { habit, user, date, source }
    this.goals = [];            // { id, user_id, locked_at }
    this.seasons = [];          // { id, city, name, status, signup_opens, kickoff_at, party_at, stripe_link } (ISO strings)
  }

  as(uid) { this.uid = uid || null; return this; }
  _newId() { return newId(); }
  _need() { if (!this.uid) throw fail('not_signed_in'); return this.uid; }
  _today() { return dayKey(this.now()); }
  _json(h) {
    return { id: h.id, text: h.text, frequency: h.frequency, n: h.n, is_goal: h.is_goal, shared: h.shared, position: h.position,
      created_at: new Date(h.created_at).toISOString() };
  }
  _mine(id) { return this.habits.find((h) => h.id === id && h.user_id === this.uid) || null; }
  _active(uid) { return this.habits.filter((h) => h.user_id === uid && !h.is_goal && !h.archived_at); }
  _range(from, to) {
    if (!from || !to || to < from || daysBetween(from, to) > this.rules.limits.tapsRangeMaxDays) throw fail('bad_range');
  }

  /* The one door, named like the SQL functions, taking their arguments.
     Returns what the RPC returns; throws an Error whose .code is the SQL
     exception's message. */
  call(fn, a = {}) {
    if (typeof this[fn] !== 'function' || !/^sz_/.test(fn)) throw fail('no_function');
    return this[fn](a);
  }

  sz_rules() { return JSON.parse(JSON.stringify(this.rules)); }

  /* ------------------------------------------------------------------ you */
  sz_me_get() {
    const m = this.members.get(this._need());
    return m ? { name: m.name, phone: m.phone, city: m.city, email_opt_out: !!m.email_opt_out } : null;
  }
  sz_me_set({ p_name, p_phone }) {
    const u = this._need();
    const c = checkMe(this.rules, { name: p_name, phone: p_phone });
    if (!c.ok) throw fail(c.error);
    const had = this.members.get(u);
    this.members.set(u, { city: 'burlington', pod: null, email_opt_out: false, ...had, name: c.me.name, phone: c.me.phone });
    return this.sz_me_get();
  }
  sz_delete_me() {
    const u = this._need();
    const mine = new Set(this.habits.filter((h) => h.user_id === u).map((h) => h.id));
    for (const [k, t] of this.taps) if (mine.has(t.habit)) this.taps.delete(k);
    this.habits = this.habits.filter((h) => h.user_id !== u);
    this.goals = this.goals.filter((g) => g.user_id !== u);
    this.members.delete(u);
    return { deleted: true };
  }

  /* --------------------------------------------------------------- habits */
  sz_habits_get() {
    const u = this._need();
    return this.habits.filter((h) => h.user_id === u && !h.archived_at).sort(byOrder).map((h) => this._json(h));
  }
  sz_habit_add({ p_text, p_frequency, p_n = null, p_shared = false }) {
    const u = this._need();
    const c = checkHabit(this.rules, { text: p_text, frequency: p_frequency, n: p_n, shared: p_shared });
    if (!c.ok) throw fail(c.error);
    const active = this._active(u);
    if (active.length >= this.rules.limits.habitsMax) throw fail('too_many_habits');
    const h = { id: this._newId(), user_id: u, goal_id: null, text: c.habit.text, frequency: c.habit.frequency, n: c.habit.n,
      is_goal: false, shared: !!p_shared, position: Math.max(0, ...active.map((x) => x.position)) + 1, archived_at: null, created_at: this.now() };
    this.habits.push(h);
    return this._json(h);
  }
  sz_habit_set({ p_habit, p_text = null, p_frequency = null, p_n = null, p_shared = null, p_position = null, p_archived = null }) {
    const u = this._need();
    const h = this._mine(p_habit);
    if (!h) throw fail('not_found');
    if (p_text != null || p_frequency != null || p_n != null) {
      const freq = p_frequency == null ? h.frequency : p_frequency;
      const c = checkHabit(this.rules, { text: p_text == null ? h.text : p_text, frequency: freq, n: freq === 'n_per_week' ? (p_n == null ? h.n : p_n) : null });
      if (!c.ok) throw fail(c.error);
      const goal = h.is_goal && this.goals.find((g) => g.id === h.goal_id);
      if (goal && goal.locked_at && (c.habit.text !== h.text || c.habit.frequency !== h.frequency || c.habit.n !== h.n)) throw fail('locked');
      Object.assign(h, { text: c.habit.text, frequency: c.habit.frequency, n: c.habit.n });
    }
    if (p_shared != null) h.shared = !!p_shared;
    if (p_archived === true && !h.archived_at) {
      if (h.is_goal) throw fail('goal_habit');
      h.archived_at = this.now();
    } else if (p_archived === false && h.archived_at) {
      const active = this._active(u);
      if (active.length >= this.rules.limits.habitsMax) throw fail('too_many_habits');
      h.archived_at = null;
      h.position = Math.max(0, ...active.map((x) => x.position)) + 1;
    }
    if (p_position != null && !h.archived_at && !h.is_goal) {
      const rest = this._active(u).filter((x) => x.id !== h.id).sort(byOrder);
      const k = Math.max(1, Math.min(p_position, rest.length + 1));
      rest.splice(k - 1, 0, h);
      rest.forEach((x, i) => { x.position = i + 1; });
    }
    return this._json(h);
  }

  /* The habits this phone kept before its reader signed in, with their
     taps, moved to the account once (sz-ROUND3.sql). Refused when the
     account already has a habit or a tap of any kind, so it happens at the
     first sign-in only. Everything is checked before anything is written:
     the list (at most habitsMax), each habit as sz_habit_add checks it,
     and each tap a real date, today or up to IMPORT_DAYS back. */
  sz_import_local({ p_habits }) {
    const u = this._need();
    if (this.habits.some((h) => h.user_id === u) || [...this.taps.values()].some((t) => t.user === u)) throw fail('already_synced');
    const L = this.rules.limits;
    if (!Array.isArray(p_habits) || p_habits.length > L.habitsMax) throw fail('bad_import');
    const today = this._today(), from = addDays(today, -IMPORT_DAYS);
    const bad = () => { throw fail('bad_import'); };
    const rows = p_habits.map((x) => {
      if (!isObj(x) || Object.keys(x).some((k) => !IMPORT_KEYS.includes(k))) bad();
      if (typeof x.text !== 'string' || typeof x.frequency !== 'string') bad();
      if (x.n != null && !Number.isInteger(x.n)) bad();
      if ((x.shared != null && typeof x.shared !== 'boolean') || (x.archived != null && typeof x.archived !== 'boolean')) bad();
      const c = checkHabit(this.rules, { text: x.text, frequency: x.frequency, n: x.n, shared: x.shared });
      if (!c.ok) bad();
      const taps = x.taps == null ? [] : x.taps;
      if (!Array.isArray(taps) || taps.length > IMPORT_DAYS + 1) bad();
      if (taps.some((d) => !isKey(d) || d > today || d < from)) bad();
      return { habit: c.habit, archived: x.archived === true, taps };
    });
    rows.forEach((r, i) => {
      const h = { id: this._newId(), user_id: u, goal_id: null, text: r.habit.text, frequency: r.habit.frequency, n: r.habit.n,
        is_goal: false, shared: r.habit.shared, position: i + 1, archived_at: r.archived ? this.now() : null, created_at: this.now() };
      this.habits.push(h);
      r.taps.forEach((d) => { const k = h.id + '|' + d; if (!this.taps.has(k)) this.taps.set(k, { habit: h.id, user: u, date: d, source: 'app' }); });
    });
    return this.sz_habits_get();
  }

  /* ----------------------------------------------------------------- taps */
  _tappable(p_habit, p_date) {
    this._need();
    const h = this._mine(p_habit);
    if (!h || h.archived_at) throw fail('not_found');
    if (!p_date || p_date !== this._today()) throw fail('not_today');
    return h;
  }
  sz_tap({ p_habit, p_date }) {
    const h = this._tappable(p_habit, p_date);
    const k = h.id + '|' + p_date;
    if (!this.taps.has(k)) this.taps.set(k, { habit: h.id, user: h.user_id, date: p_date, source: 'app' });
    return { habit: h.id, date: p_date, tapped: true };
  }
  sz_untap({ p_habit, p_date }) {
    const h = this._tappable(p_habit, p_date);
    this.taps.delete(h.id + '|' + p_date);
    return { habit: h.id, date: p_date, tapped: false };
  }
  sz_taps_get({ p_from, p_to }) {
    const u = this._need();
    this._range(p_from, p_to);
    const mine = new Set(this.habits.filter((h) => h.user_id === u).map((h) => h.id));
    return [...this.taps.values()].filter((t) => mine.has(t.habit) && t.date >= p_from && t.date <= p_to)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.habit < b.habit ? -1 : 1))
      .map((t) => ({ habit: t.habit, date: t.date, source: t.source }));
  }
  sz_pod_habits({ p_from, p_to }) {
    const u = this._need();
    this._range(p_from, p_to);
    const me = this.members.get(u);
    if (!me || !me.pod) return [];
    return [...this.members.entries()].filter(([id, m]) => id !== u && m.pod === me.pod)
      .sort(([ia, a], [ib, b]) => (a.name < b.name ? -1 : a.name > b.name ? 1 : ia < ib ? -1 : 1))
      .map(([id, m]) => ({
        name: m.name,
        habits: this.habits.filter((h) => h.user_id === id && !h.archived_at && (h.shared || h.is_goal)).sort(byOrder)
          .map((h) => ({ ...this._json(h), taps: [...this.taps.values()].filter((t) => t.habit === h.id && t.date >= p_from && t.date <= p_to).map((t) => t.date).sort() })),
      }));
  }

  /* -------------------------------------------------------------- seasons */
  sz_season_next({ p_city = 'burlington' } = {}) {
    const t = this.now();
    const next = this.seasons.filter((s) => s.city === (p_city || 'burlington') && (s.status === 'upcoming' || s.status === 'open') && Date.parse(s.kickoff_at) > t)
      .sort((a, b) => Date.parse(a.kickoff_at) - Date.parse(b.kickoff_at) || (a.id < b.id ? -1 : 1))[0];
    return next ? { id: next.id, name: next.name, city: next.city, status: next.status, signup_opens: next.signup_opens || null,
      kickoff_at: next.kickoff_at, party_at: next.party_at || null, stripe_link: next.stripe_link || null } : null;
  }

  /* the operator's hand, for tests: a tap on any date, as Stephen can */
  addTap(habit, date, source) {
    const h = this.habits.find((x) => x.id === habit);
    if (h) this.taps.set(habit + '|' + date, { habit, user: h.user_id, date, source: source || 'app' });
  }
}

/* The demo: a member with three habits and three weeks of taps, and a
   season starting in a little over three weeks. Dates are counted back from
   today, so the demo always looks lived in. Taps leave gaps on purpose. */
export function seedDemo(f, uid) {
  const t = f.now();
  const today = dayKey(t);
  f.members.set(uid, { name: 'Alex', phone: '802-555-0142', city: 'burlington', pod: null, email_opt_out: false });
  const add = (text, frequency, n, shared, position) => {
    const h = { id: newId(), user_id: uid, goal_id: null, text, frequency, n, is_goal: false, shared, position, archived_at: null, created_at: t - 30 * 86400000 };
    f.habits.push(h);
    return h.id;
  };
  const walk = add('Morning walk', 'daily', null, true, 1);
  const read = add('Read twenty pages', 'weekdays', null, false, 2);
  const gym = add('Gym', 'n_per_week', 3, false, 3);
  for (let i = 1; i <= 21; i++) {
    const d = addDays(today, -i);
    if (i !== 9 && i !== 16) f.addTap(walk, d);
    if (i % 7 !== 3) f.addTap(read, d);
    if (i % 2 === 1) f.addTap(gym, d);
  }
  f.addTap(walk, today);
  const kick = new Date(t + 23 * 86400000);
  f.seasons.push({ id: 'demo-season-0', city: 'burlington', name: 'Season 0', status: 'open', signup_opens: new Date(t - 86400000).toISOString(),
    kickoff_at: kick.toISOString(), party_at: new Date(kick.getTime() + 56 * 86400000).toISOString(), stripe_link: null });
  return f;
}

