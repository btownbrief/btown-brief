/* build-fake.js — an in-memory copy of supabase/bd-SETUP.sql, for ?demo=1,
   for scripts/test-build-core.mjs, and (through build-local.js) for a
   reader who has not signed in.

   Same function names, same arguments, same answers, same refusal codes,
   in the same order of checks, built on the same rules (build-core.js). It
   saves nothing and calls nothing. The clock is injected so a test can walk
   past midnight or past three minutes; the caller is set with as(userId) so
   a test can be anyone, or nobody. Photos (the photo queue), bans and habit
   taps are plain fields a test or the demo seed fills in, the way the
   other apps' tables fill them on the live project. */

import { BUILD_RULES, dayKey, addDays, isKey, weekStart, clean, checkThing, checkBuilder, checkPost } from './build-core.js';

const fail = (code) => { const e = new Error(code); e.code = code; return e; };
let seq = 0;
const newId = () => '00000000-0000-4000-8000-bd' + (++seq).toString(16).padStart(10, '0');
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const CLIENT_ID = /^[A-Za-z0-9-]{8,64}$/;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

export class FakeBuild {
  constructor({ now, rules } = {}) {
    this.now = now || (() => Date.now());
    this.rules = rules || BUILD_RULES;
    this.uid = null;
    this.builders = new Map();   // uid -> { hat, vest, name, first_name_public }
    this.things = [];            // { id, user_id, title, why, for_whom, partner, target_date, status, why_public, created_at, done_at }
    this.shifts = [];            // { id, user_id, client_id, thing_id, kind, started, ended, day, minutes, step, note, posted }
    this.posts = [];             // { id, user_id, thing_id, shift_id, kind, line, photo_path, minutes, stuck_reason, help_need, brief_ok, reports, created_at, hidden_at }
    this.nices = new Set();      // `${post}|${user}`
    this.helps = [];             // { id, post_id, helper_id, line, status, created_at, decided_at, intro_sent_at }
    this.presence = new Map();   // uid -> { public_id, task, started_at, heartbeat, pinned }
    this.reports = [];           // { kind, target, by, reason, created_at }
    this.blocks = [];            // { id, user_id, blocked_id, created_at }
    this.bans = new Set();       // nn_bans: may not post
    this.photos = new Map();     // btb_photos: path -> { status, spot, at }
    this.habitTaps = [];         // sz_taps dates, for the town's habit drops
    this.intros = [];            // what bd-intro would have sent: { help_id, poster, helper } (never an email)
  }

  as(uid) { this.uid = uid || null; return this; }
  _newId() { return newId(); }
  _need() { if (!this.uid) throw fail('not_signed_in'); return this.uid; }
  _today() { return dayKey(this.now()); }
  call(fn, a = {}) {
    if (typeof this[fn] !== 'function' || !/^bd_/.test(fn)) throw fail('no_function');
    return this[fn](a || {});
  }

  /* ------------------------------------------------------------ helpers */
  _current(u) {
    return this.things.filter((t) => t.user_id === u && t.status !== 'done').sort((a, b) => b.created_at - a.created_at)[0] || null;
  }
  _visible(p) { return !!p && p.hidden_at == null; }
  _blocked(a, b) { return !!a && !!b && this.blocks.some((x) => (x.user_id === a && x.blocked_id === b) || (x.user_id === b && x.blocked_id === a)); }
  _name(u) { const b = this.builders.get(u); return b && b.first_name ? b.first_name : null; }
  _photoState(path) {
    if (!path) return 'none';
    const p = this.photos.get(path);
    if (!p) return 'missing';
    return p.status === 'approved' ? 'approved' : p.status === 'pending' ? 'pending' : 'rejected';
  }
  _photoClaimable(path) {
    const p = this.photos.get(path);
    return !!p && p.status === 'pending' && /^All Day · /.test(p.spot || '') && p.at > this.now() - 86400000;
  }
  _photoRemove(path) { const p = this.photos.get(path); if (p && /^All Day · /.test(p.spot || '')) p.status = 'removed'; }
  addPhoto(path, status = 'pending', o = {}) { this.photos.set(path, { status, spot: o.spot || 'All Day · Build', at: o.at == null ? this.now() : o.at }); return path; }
  _dayTotal(u, day) { return this.shifts.filter((s) => s.user_id === u && s.day === day).reduce((a, s) => a + s.minutes, 0); }
  _thingJson(t) {
    if (!t) return null;
    return { id: t.id, title: t.title, why: t.why, for_whom: t.for_whom, partner: t.partner, target_date: t.target_date, status: t.status,
      why_public: t.why_public, created_at: iso(t.created_at), done_at: iso(t.done_at),
      has_posts: this.posts.some((p) => p.thing_id === t.id && this._visible(p)) };
  }
  _shiftJson(s) { return { id: s.id, client_id: s.client_id, kind: s.kind, day: s.day, minutes: s.minutes, thing: s.thing_id, posted: s.posted }; }
  _postJson(p, u) {
    const t = p.thing_id && this.things.find((x) => x.id === p.thing_id);
    const mine = !!u && p.user_id === u;
    const out = { id: p.id, kind: p.kind, line: p.line, photo: this._photoState(p.photo_path) === 'approved' ? p.photo_path : null,
      minutes: p.minutes, stuck_reason: p.stuck_reason, help_need: p.help_need, brief_ok: p.brief_ok, thing: t ? t.title : null,
      author: this._name(p.user_id) || 'A neighbor', created_at: iso(p.created_at),
      nice: [...this.nices].filter((k) => k.startsWith(p.id + '|')).length,
      niced: !!u && this.nices.has(p.id + '|' + u), mine,
      offered: !!u && !mine && this.helps.some((h) => h.post_id === p.id && h.helper_id === u),
      offers_waiting: mine ? this.helps.filter((h) => h.post_id === p.id && h.status === 'offered' && !this._blocked(u, h.helper_id)).length : 0 };
    return out;
  }
  _clientId(id) { if (typeof id !== 'string' || !CLIENT_ID.test(id)) throw fail('bad_shift'); return id; }

  bd_rules() { return JSON.parse(JSON.stringify(this.rules)); }

  /* ------------------------------------------------------------ builder */
  bd_builder_get() {
    const b = this.builders.get(this._need());
    return b ? { ...b } : null;
  }
  bd_builder_set({ p_hat = null, p_vest = null, p_first_name = null, p_first_name_public = null }) {
    const u = this._need();
    const c = checkBuilder(this.rules, this.builders.get(u), { hat: p_hat, vest: p_vest, first_name: p_first_name, first_name_public: p_first_name_public });
    if (!c.ok) throw fail(c.error);
    this.builders.set(u, c.builder);
    return { ...c.builder };
  }

  /* -------------------------------------------------------------- thing */
  bd_thing_get() {
    const u = this._need();
    const done = this.things.filter((t) => t.user_id === u && t.status === 'done').sort((a, b) => b.done_at - a.done_at || (a.id < b.id ? 1 : -1))
      .slice(0, this.rules.limits.doneShown).map((t) => ({ id: t.id, title: t.title, done_at: iso(t.done_at) }));
    return { thing: this._thingJson(this._current(u)), done };
  }
  bd_thing_set({ p_title = null, p_why = null, p_for = null, p_partner = null, p_target = null, p_why_public = null }) {
    const u = this._need();
    const cur = this._current(u);
    const c = checkThing(this.rules, cur, { title: p_title, why: p_why, for_whom: p_for, partner: p_partner, target_date: p_target, why_public: p_why_public });
    if (!c.ok) throw fail(c.error);
    if (cur) { Object.assign(cur, c.thing); return this._thingJson(cur); }
    const t = { id: this._newId(), user_id: u, ...c.thing, status: 'active', created_at: this.now(), done_at: null };
    this.things.push(t);
    return this._thingJson(t);
  }
  bd_thing_status({ p_status }) {
    const u = this._need();
    if (!this.rules.thingStatuses.includes(p_status)) throw fail('bad_status');
    const cur = this._current(u);
    if (!cur) throw fail('no_thing');
    cur.status = p_status;
    if (p_status === 'done') cur.done_at = this.now();
    return this._thingJson(cur);
  }

  /* ------------------------------------------------------------- shifts */
  _mineThing(u, id) { return id && this.things.some((t) => t.id === id && t.user_id === u) ? id : null; }
  bd_shift_add({ p_client_id, p_started, p_ended, p_minutes, p_step = '', p_note = '', p_thing = null }) {
    const u = this._need();
    const cid = this._clientId(p_client_id);
    const had = this.shifts.find((s) => s.user_id === u && s.client_id === cid);
    if (had) return this._shiftJson(had);
    const L = this.rules.limits;
    const st = Date.parse(p_started), en = Date.parse(p_ended);
    const t = this.now();
    if (!Number.isFinite(st) || !Number.isFinite(en) || en < st || en > t + 300000 || st < t - L.shiftLateDays * 86400000) throw fail('bad_shift');
    const m = Number(p_minutes);
    if (!Number.isInteger(m) || m < 1 || m > Math.min(L.shiftMaxMinutes, Math.ceil((en - st) / 60000))) throw fail('bad_minutes');
    const day = dayKey(st);
    if (this._dayTotal(u, day) + m > L.dayMaxMinutes) throw fail('too_much');
    const s = { id: this._newId(), user_id: u, client_id: cid, thing_id: this._mineThing(u, p_thing), kind: 'shift', started: st, ended: en, day,
      minutes: m, step: clean(p_step).slice(0, L.stepMax), note: clean(p_note).slice(0, L.noteMax), posted: false, created_at: t };
    this.shifts.push(s);
    return this._shiftJson(s);
  }
  bd_log_add({ p_client_id, p_minutes, p_note = '', p_day = null, p_thing = null }) {
    const u = this._need();
    const cid = this._clientId(p_client_id);
    const had = this.shifts.find((s) => s.user_id === u && s.client_id === cid);
    if (had) return this._shiftJson(had);
    const L = this.rules.limits;
    const m = Number(p_minutes);
    if (!Number.isInteger(m) || m < 1 || m > L.logMaxMinutes) throw fail('bad_minutes');
    const today = this._today();
    const day = p_day == null ? today : p_day;
    if (!isKey(day) || day > today || day < addDays(today, -L.logBackDays)) throw fail('bad_day');
    if (this._dayTotal(u, day) + m > L.dayMaxMinutes) throw fail('too_much');
    const s = { id: this._newId(), user_id: u, client_id: cid, thing_id: this._mineThing(u, p_thing), kind: 'logged', started: null, ended: null, day,
      minutes: m, step: '', note: clean(p_note).slice(0, L.noteMax), posted: false, created_at: this.now() };
    this.shifts.push(s);
    return this._shiftJson(s);
  }
  bd_my_record({ p_from, p_to }) {
    const u = this._need();
    if (!isKey(p_from) || !isKey(p_to) || p_to < p_from || addDays(p_from, this.rules.limits.recordDays - 1) < p_to) throw fail('bad_range');
    const by = new Map();
    for (const s of this.shifts) {
      if (s.user_id !== u || s.day < p_from || s.day > p_to) continue;
      const d = by.get(s.day) || { day: s.day, minutes: 0, logged: 0 };
      d.minutes += s.minutes; if (s.kind === 'logged') d.logged += s.minutes;
      by.set(s.day, d);
    }
    return { days: [...by.values()].sort((a, b) => (a.day < b.day ? -1 : 1)) };
  }
  bd_shelf({ p_thing = null }) {
    const u = this._need();
    const id = p_thing ? this._mineThing(u, p_thing) : (this._current(u) || {}).id;
    if (!id) return [];
    return this.posts.filter((p) => p.user_id === u && p.thing_id === id).sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1))
      .map((p) => ({ ...this._postJson(p, u), hidden: p.hidden_at != null }));
  }

  /* -------------------------------------------------------------- posts */
  bd_post_create({ p_kind, p_line, p_photo = null, p_minutes = null, p_stuck_reason = null, p_help_need = null, p_brief_ok = false, p_shift = null }) {
    const u = this._need();
    if (this.bans.has(u)) throw fail('banned');
    if (!this._name(u)) throw fail('no_name');
    const c = checkPost(this.rules, { kind: p_kind, line: p_line, photo: p_photo, minutes: p_minutes, stuck_reason: p_stuck_reason, help_need: p_help_need, brief_ok: p_brief_ok });
    if (!c.ok) throw fail(c.error);
    if (c.post.photo && (!this._photoClaimable(c.post.photo) || this.posts.some((p) => p.photo_path === c.post.photo))) throw fail('bad_photo');
    const t = this.now();
    if (this.posts.filter((p) => p.user_id === u && p.created_at > t - 86400000).length >= this.rules.limits.postsPerDay) throw fail('rate_day');
    const cur = this._current(u);
    const sh = p_shift && this.shifts.find((s) => s.id === p_shift && s.user_id === u);
    if (sh) sh.posted = true;
    const p = { id: this._newId(), user_id: u, thing_id: cur ? cur.id : null, shift_id: sh ? sh.id : null, kind: c.post.kind, line: c.post.line,
      photo_path: c.post.photo, minutes: c.post.minutes, stuck_reason: c.post.stuck_reason, help_need: c.post.help_need, brief_ok: c.post.brief_ok,
      reports: 0, created_at: t, hidden_at: null };
    this.posts.push(p);
    return this._postJson(p, u);
  }
  bd_post_delete({ p_post }) {
    const u = this._need();
    const p = this.posts.find((x) => x.id === p_post && x.user_id === u);
    if (!p) throw fail('not_found');
    this._dropPost(p);
    return { deleted: true };
  }
  _dropPost(p) {
    if (p.photo_path) this._photoRemove(p.photo_path);
    this.posts = this.posts.filter((x) => x.id !== p.id);
    for (const k of [...this.nices]) if (k.startsWith(p.id + '|')) this.nices.delete(k);
    const hs = new Set(this.helps.filter((h) => h.post_id === p.id).map((h) => h.id));
    this.helps = this.helps.filter((h) => !hs.has(h.id));
    this.reports = this.reports.filter((r) => !((r.kind === 'post' && r.target === p.id) || (r.kind === 'help' && hs.has(r.target))));
  }
  bd_feed({ p_before = null, p_limit = null, p_kind = null, p_brief = null } = {}) {
    const u = this.uid;
    const L = this.rules.limits;
    const n = Math.max(1, Math.min(Number(p_limit) || L.feedDefault, L.feedMax));
    const before = p_before ? Date.parse(p_before) : null;
    return this.posts.filter((p) => this._visible(p) && !this._blocked(u, p.user_id) && (!p_kind || p.kind === p_kind) && (!p_brief || p.brief_ok)
      && (before == null || p.created_at < before))
      .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : -1)).slice(0, n).map((p) => this._postJson(p, u));
  }
  bd_nice({ p_post }) {
    const u = this._need();
    const p = this.posts.find((x) => x.id === p_post);
    if (!this._visible(p) || this._blocked(u, p.user_id)) throw fail('not_found');
    if (p.user_id === u) throw fail('own_post');
    const k = p.id + '|' + u;
    if (this.nices.has(k)) this.nices.delete(k); else this.nices.add(k);
    return { nice: [...this.nices].filter((x) => x.startsWith(p.id + '|')).length, niced: this.nices.has(k) };
  }

  /* -------------------------------------------------------------- help */
  bd_help_offer({ p_post, p_line }) {
    const u = this._need();
    if (this.bans.has(u)) throw fail('banned');
    if (!this._name(u)) throw fail('no_name');
    const p = this.posts.find((x) => x.id === p_post);
    if (!this._visible(p) || this._blocked(u, p.user_id)) throw fail('not_found');
    if (p.user_id === u) throw fail('own_post');
    if (p.kind !== 'stuck') throw fail('not_stuck');
    const line = clean(p_line);
    if (!line || line.length > this.rules.limits.helpLineMax) throw fail('bad_help_line');
    if (this.helps.some((h) => h.post_id === p.id && h.helper_id === u)) throw fail('already_offered');
    const t = this.now();
    if (this.helps.filter((h) => h.helper_id === u && h.created_at > t - 86400000).length >= this.rules.limits.offersPerDay) throw fail('rate_offers');
    const h = { id: this._newId(), post_id: p.id, helper_id: u, line, status: 'offered', created_at: t, decided_at: null, intro_sent_at: null };
    this.helps.push(h);
    return { id: h.id, status: h.status };
  }
  bd_help_respond({ p_help, p_yes }) {
    const u = this._need();
    const h = this.helps.find((x) => x.id === p_help);
    const p = h && this.posts.find((x) => x.id === h.post_id);
    if (!h || !p || p.user_id !== u) throw fail('not_found');
    if (h.status !== 'offered') throw fail('already_answered');
    h.status = p_yes === true ? 'accepted' : 'declined';
    h.decided_at = this.now();
    return { id: h.id, status: h.status };
  }
  bd_help_list() {
    const u = this._need();
    const row = (h, other) => {
      const p = this.posts.find((x) => x.id === h.post_id);
      return { id: h.id, post: h.post_id, post_line: p ? p.line : '', name: this._name(other) || 'A neighbor', line: h.line, status: h.status, created_at: iso(h.created_at) };
    };
    const newest = (a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : -1);
    const mine = new Set(this.posts.filter((p) => p.user_id === u).map((p) => p.id));
    return {
      incoming: this.helps.filter((h) => mine.has(h.post_id) && h.status !== 'declined' && !this._blocked(u, h.helper_id)).sort(newest).map((h) => row(h, h.helper_id)),
      outgoing: this.helps.filter((h) => h.helper_id === u).sort(newest).map((h) => row(h, (this.posts.find((p) => p.id === h.post_id) || {}).user_id)),
    };
  }
  /* What supabase/functions/bd-intro does, without the emails: once per
     accepted offer, never for one already sent. */
  sendIntro(helpId) {
    const h = this.helps.find((x) => x.id === helpId && x.status === 'accepted' && x.intro_sent_at == null);
    if (!h) return false;
    const p = this.posts.find((x) => x.id === h.post_id);
    if (!p || this._blocked(p.user_id, h.helper_id)) return false;
    h.intro_sent_at = this.now();
    this.intros.push({ help_id: h.id, poster: p.user_id, helper: h.helper_id });
    return true;
  }

  /* --------------------------------------------------- reports and blocks */
  bd_report({ p_kind, p_target, p_reason }) {
    const u = this._need();
    const L = this.rules.limits;
    if (!this.rules.reasons.includes(p_reason)) throw fail('bad_reason');
    if (p_kind !== 'post' && p_kind !== 'help') throw fail('bad_target');
    let p = null, h = null;
    if (p_kind === 'post') {
      p = this.posts.find((x) => x.id === p_target);
      if (!this._visible(p)) throw fail('not_found');
      if (p.user_id === u) throw fail('own_post');
    } else {
      h = this.helps.find((x) => x.id === p_target);
      const hp = h && this.posts.find((x) => x.id === h.post_id);
      if (!h || !hp || (hp.user_id !== u && h.helper_id !== u)) throw fail('not_found');
      p = hp;
    }
    if (this.reports.some((r) => r.kind === p_kind && r.target === p_target && r.by === u)) throw fail('already_reported');
    const t = this.now();
    if (this.reports.filter((r) => r.by === u && r.created_at > t - 86400000).length >= L.reportsPerDay) throw fail('rate_reports');
    this.reports.push({ kind: p_kind, target: p_target, by: u, reason: p_reason, created_at: t });
    if (p_kind === 'post') {
      p.reports += 1;
      if (p.reports >= L.reportsToHide && p.hidden_at == null) p.hidden_at = t;
      return { hidden: p.hidden_at != null };
    }
    /* an offer the poster reports is declined; either side's report waits for Stephen */
    if (p.user_id === u && h.status === 'offered') { h.status = 'declined'; h.decided_at = t; return { hidden: true }; }
    return { hidden: false };
  }
  _other(u, kind, target) {
    if (kind === 'post') { const p = this.posts.find((x) => x.id === target); return this._visible(p) ? p.user_id : null; }
    if (kind === 'help') {
      const h = this.helps.find((x) => x.id === target);
      const p = h && this.posts.find((x) => x.id === h.post_id);
      if (!h || !p) return null;
      if (p.user_id === u) return h.helper_id;
      if (h.helper_id === u) return p.user_id;
    }
    return null;
  }
  bd_block({ p_kind, p_target }) {
    const u = this._need();
    if (p_kind !== 'post' && p_kind !== 'help') throw fail('bad_target');
    const other = this._other(u, p_kind, p_target);
    if (!other) throw fail('not_found');
    if (other === u) throw fail('own_post');
    if (!this.blocks.some((b) => b.user_id === u && b.blocked_id === other)) {
      this.blocks.push({ id: this._newId(), user_id: u, blocked_id: other, created_at: this.now() });
    }
    /* offers waiting between the two of you are declined */
    const t = this.now();
    for (const h of this.helps) {
      const p = this.posts.find((x) => x.id === h.post_id);
      if (h.status === 'offered' && p && ((p.user_id === u && h.helper_id === other) || (p.user_id === other && h.helper_id === u))) { h.status = 'declined'; h.decided_at = t; }
    }
    return { blocked: true };
  }
  bd_blocks_get() {
    const u = this._need();
    return this.blocks.filter((b) => b.user_id === u).sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : -1))
      .map((b) => ({ id: b.id, name: this._name(b.blocked_id) || 'A neighbor' }));
  }
  bd_unblock({ p_block }) {
    const u = this._need();
    const b = this.blocks.find((x) => x.id === p_block && x.user_id === u);
    if (!b) throw fail('not_found');
    this.blocks = this.blocks.filter((x) => x !== b);
    return { unblocked: true };
  }

  /* ----------------------------------------------------------- presence */
  _fresh(p) { return p.pinned || p.heartbeat > this.now() - this.rules.limits.staleSeconds * 1000; }
  bd_presence_beat({ p_task }) {
    const u = this._need();
    if (!this.rules.tasks.includes(p_task)) throw fail('bad_task');
    const had = this.presence.get(u);
    const t = this.now();
    if (had && this._fresh(had)) { had.task = p_task; had.heartbeat = t; }
    else this.presence.set(u, { public_id: this._newId(), task: p_task, started_at: t, heartbeat: t, pinned: false });
    return { on: true };
  }
  bd_presence_end() { this.presence.delete(this._need()); return { on: false }; }

  /* ------------------------------------------------------------ the town */
  bd_town({ p_since = null } = {}) {
    const u = this.uid;
    const since = isKey(p_since) ? p_since : null;
    const today = this._today();
    const wk = weekStart(today);
    const from = since && since > wk ? since : wk;
    const sum = (f) => this.shifts.filter(f).reduce((a, s) => a + s.minutes, 0);
    const fresh = [...this.presence.entries()].filter(([, p]) => this._fresh(p))
      .sort(([, a], [, b]) => a.started_at - b.started_at || (a.public_id < b.public_id ? -1 : 1));
    const R = this.rules;
    return {
      total_minutes: sum((s) => !since || s.day >= since),
      week_minutes: sum((s) => s.day >= from),
      today_minutes: sum((s) => s.day === today),
      habit_drops: this.habitTaps.filter((d) => !since || d >= since).length,
      posts_lit: this.posts.filter((p) => this._visible(p) && (!since || dayKey(p.created_at) >= since)).length,
      on_shift_count: fresh.length,
      on_shift: fresh.slice(0, R.limits.onShiftMax).map(([id, p]) => {
        const b = this.builders.get(id);
        return { id: p.public_id, look: { hat: b ? b.hat : R.hats[0], vest: b ? b.vest : R.vests[0] }, task: p.task,
          name: b && b.first_name_public && b.first_name ? b.first_name : null, me: !!u && id === u };
      }),
    };
  }
  /* Neighbours' things that have at least one post (the starter door),
     newest post first: the thing's id and title, its why only when its
     owner turned why_public on, the owner's first name only when their
     builder shows it, and the kind and Burlington day of its newest post. */
  bd_public_things({ p_limit = null } = {}) {
    const u = this.uid;
    const L = this.rules.limits;
    const n = Math.max(1, Math.min(Number(p_limit) || L.publicThingsMax, L.publicThingsMax));
    const lastOf = (t) => this.posts.filter((p) => p.thing_id === t.id && this._visible(p))
      .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : -1))[0];
    return this.things.filter((t) => t.status !== 'done' && t.user_id !== u && !this.bans.has(t.user_id) && !this._blocked(u, t.user_id))
      .map((t) => ({ t, last: lastOf(t) })).filter((x) => x.last)
      .sort((a, b) => b.last.created_at - a.last.created_at || (a.t.id < b.t.id ? -1 : 1)).slice(0, n)
      .map(({ t, last }) => {
        const b = this.builders.get(t.user_id);
        return { id: t.id, title: t.title, why: t.why_public && t.why ? t.why : null,
          name: b && b.first_name_public && b.first_name ? b.first_name : null, last_kind: last.kind, last_at: dayKey(last.created_at) };
      });
  }

  /* ------------------------------------------------------- your account */
  bd_import_local({ p_data }) {
    const u = this._need();
    if (this.things.some((t) => t.user_id === u) || this.shifts.some((s) => s.user_id === u)) throw fail('already_synced');
    const v = checkImport(this.rules, p_data, this._today());
    if (!v) throw fail('bad_import');
    let thingId = null;
    if (v.thing) {
      thingId = this._newId();
      this.things.push({ id: thingId, user_id: u, ...v.thing.fields, status: v.thing.status, created_at: this.now(), done_at: null });
    }
    if (v.builder && !this.builders.has(u)) this.builders.set(u, v.builder);
    for (const s of v.shifts) {
      this.shifts.push({ id: this._newId(), user_id: u, client_id: s.client_id, thing_id: s.on_thing ? thingId : null, kind: s.kind, started: null, ended: null,
        day: s.day, minutes: s.minutes, step: s.step, note: s.note, posted: false, created_at: this.now() });
    }
    return { moved: true, shifts: v.shifts.length };
  }
  bd_delete_me() {
    const u = this._need();
    for (const p of this.posts.filter((x) => x.user_id === u)) this._dropPost(p);
    for (const k of [...this.nices]) if (k.endsWith('|' + u)) this.nices.delete(k);
    const mine = new Set(this.helps.filter((h) => h.helper_id === u).map((h) => h.id));
    this.helps = this.helps.filter((h) => !mine.has(h.id));
    this.reports = this.reports.filter((r) => r.by !== u && !(r.kind === 'help' && mine.has(r.target)));
    for (const p of this.posts) {
      p.reports = this.reports.filter((r) => r.kind === 'post' && r.target === p.id).length;
    }
    this.blocks = this.blocks.filter((b) => b.user_id !== u && b.blocked_id !== u);
    this.presence.delete(u);
    this.shifts = this.shifts.filter((s) => s.user_id !== u);
    this.things = this.things.filter((t) => t.user_id !== u);
    this.builders.delete(u);
    return { deleted: true };
  }
}

/* What bd_import_local takes, checked as the SQL checks it: an object with
   at most these keys; a thing as bd_thing_set checks one; a look as
   bd_builder_set does; at most importShiftsMax hours, each a real day in the
   last importDays, none in the future, each within its kind's limit, and no
   day over dayMaxMinutes. Returns the clean copy, or null. */
export function checkImport(rules, d, today) {
  const L = rules.limits;
  if (!isObj(d) || Object.keys(d).some((k) => !['thing', 'shifts', 'builder'].includes(k))) return null;
  let thing = null;
  if (d.thing != null) {
    if (!isObj(d.thing)) return null;
    const c = checkThing(rules, null, d.thing);
    if (!c.ok) return null;
    const status = d.thing.status == null ? 'active' : d.thing.status;
    if (status !== 'active' && status !== 'paused') return null;
    thing = { fields: c.thing, status };
  }
  let builder = null;
  if (d.builder != null) {
    if (!isObj(d.builder)) return null;
    const c = checkBuilder(rules, null, d.builder);
    if (!c.ok) return null;
    builder = c.builder;
  }
  const list = d.shifts == null ? [] : d.shifts;
  if (!Array.isArray(list) || list.length > L.importShiftsMax) return null;
  const from = addDays(today, -L.importDays);
  const perDay = new Map();
  const seen = new Set();
  const shifts = [];
  for (const s of list) {
    if (!isObj(s) || typeof s.client_id !== 'string' || !CLIENT_ID.test(s.client_id) || seen.has(s.client_id)) return null;
    if (!rules.shiftKinds.includes(s.kind)) return null;
    const max = s.kind === 'logged' ? L.logMaxMinutes : L.shiftMaxMinutes;
    if (!Number.isInteger(s.minutes) || s.minutes < 1 || s.minutes > max) return null;
    if (!isKey(s.day) || s.day > today || s.day < from) return null;
    perDay.set(s.day, (perDay.get(s.day) || 0) + s.minutes);
    if (perDay.get(s.day) > L.dayMaxMinutes) return null;
    seen.add(s.client_id);
    shifts.push({ client_id: s.client_id, kind: s.kind, day: s.day, minutes: s.minutes, on_thing: s.on_thing === true && !!thing,
      step: clean(s.step).slice(0, L.stepMax), note: clean(s.note).slice(0, L.noteMax) });
  }
  return { thing, builder, shifts };
}

/* ---------------------------------------------------------------- the demo */
/* A lived-in town: about thirty neighbours with builders and hours over the
   last three weeks, six on shift right now (pinned, so they never go
   stale in the demo), posts of all four kinds, and you (uid) with a thing,
   a few weeks of hours, a Stuck post with an offer waiting for your answer,
   and a neighbour's Stuck post you could help with. Dates count back from
   today, so it always looks current. */
const NAMES = ['Maya', 'Theo', 'Priya', 'Sam', 'Jo', 'Ines', 'Marcus', 'Lena', 'Owen', 'Rosa', 'Abdi', 'Kate', 'Dev', 'Hana', 'Eli', 'Mara',
  'Tom', 'Nia', 'Ben', 'Lucia', 'Will', 'Ava', 'Raj', 'Greta', 'Finn', 'Zoe', 'Malik', 'Ruth', 'Cal', 'Iris'];
const THINGS = [
  ['Finish the screenplay', 'I have started it four times.'], ['Run the Vermont City Marathon in May', 'My dad ran it at 50. I am 49.'],
  ['Fix my own bike', 'Tired of paying someone to true a wheel.'], ['Make three real friends here', 'Two years in and I still eat lunch alone.'],
  ['Learn to make bread that rises', null], ['Build a canoe', 'The lake is right there.'], ['Write ten songs', 'One for every year I said I would.'],
  ['Paint the kitchen', null], ['Read the whole Burlington Free Press archive on the 1927 flood', 'My great-grandmother lived through it.'],
  ['Get my pilot license', 'Small planes, big lake.'], ['Knit a sweater that fits', null], ['Plant a pollinator garden', 'Bees, mostly.'],
];
const LINES = {
  progress: ['Outlined chapter three. It is mostly arrows.', 'Ran 9 miles on the bike path. Slow, but all of it.', 'Primed two walls. The third is tomorrow.',
    'Sanded the ribs on the canoe. My arms say no more.', 'Second loaf rose. A little.', 'Wrote a bridge that finally works.'],
  stuck: ['Can’t get the derailleur to shift onto the big cog. Need someone to show me.', 'Chapter four keeps turning into chapter three.',
    'Too big for the time I have. Every weeknight is gone by 8.'],
  found: ['The Fletcher Free has a sewing machine you can borrow.', 'Old North End Community Center has open woodshop Tuesdays.',
    'Found a running group that waits for the slow people.', 'The Burlington Bike Project will lend you a stand.'],
  finished: ['Finished the sweater. It fits. Mostly.', 'Painted the kitchen. 6h 40m over two weekends.'],
};

export function seedDemo(f, uid) {
  const t = f.now();
  const today = dayKey(t);
  const R = f.rules;
  const hoursAgo = (h) => t - h * 3600000;
  const people = NAMES.map((name, i) => {
    const id = 'demo-build-' + String(i).padStart(2, '0');
    f.builders.set(id, { hat: R.hats[i % R.hats.length], vest: R.vests[(i * 3) % R.vests.length], first_name: name, first_name_public: i % 3 !== 2 });
    return id;
  });
  /* hours over the last three weeks: everyone some, a few a lot */
  people.forEach((id, i) => {
    for (let d = 0; d < 21; d++) {
      if ((i + d) % 3 !== 0) continue;
      const day = addDays(today, -d);
      const minutes = 25 + ((i * 37 + d * 11) % 110);
      f.shifts.push({ id: f._newId(), user_id: id, client_id: 'demo-' + id + '-' + d, thing_id: null, kind: d % 4 === 0 ? 'logged' : 'shift',
        started: null, ended: null, day, minutes, step: '', note: '', posted: false, created_at: t });
    }
  });
  /* things, for the starter door */
  people.slice(0, THINGS.length).forEach((id, i) => {
    f.things.push({ id: f._newId(), user_id: id, title: THINGS[i][0], why: THINGS[i][1] || '', for_whom: '', partner: '', target_date: null,
      status: 'active', why_public: !!THINGS[i][1], created_at: t - (30 - i) * 86400000, done_at: null });
  });
  const thingOf = (id) => (f.things.find((x) => x.user_id === id) || {}).id || null;
  const post = (id, kind, line, h, extra = {}) => {
    const p = { id: f._newId(), user_id: id, thing_id: thingOf(id), shift_id: null, kind, line, photo_path: null, minutes: null, stuck_reason: null,
      help_need: null, brief_ok: false, reports: 0, created_at: hoursAgo(h), hidden_at: null, ...extra };
    f.posts.push(p);
    return p;
  };
  LINES.progress.forEach((l, i) => post(people[i], 'progress', l, 2 + i * 7, { minutes: i % 2 ? 95 + i * 10 : null }));
  LINES.found.forEach((l, i) => post(people[6 + i], 'found', l, 5 + i * 9));
  LINES.finished.forEach((l, i) => post(people[10 + i], 'finished', l, 20 + i * 30, { brief_ok: true }));
  const bike = post(people[2], 'stuck', LINES.stuck[0], 3, { stuck_reason: 'missing', help_need: 'hand' });
  post(people[0], 'stuck', LINES.stuck[1], 26, { stuck_reason: 'unclear' });
  /* Nice on a few */
  f.posts.forEach((p, i) => { for (let k = 0; k < (i * 5) % 9; k++) f.nices.add(p.id + '|' + people[(i + k + 3) % people.length]); });
  f.helps.push({ id: f._newId(), post_id: bike.id, helper_id: people[8], line: 'I’ve got a stand and a Tuesday.', status: 'accepted',
    created_at: hoursAgo(2), decided_at: hoursAgo(1), intro_sent_at: hoursAgo(1) });
  /* six on shift right now */
  people.slice(12, 18).forEach((id, i) => f.presence.set(id, { public_id: f._newId(), task: R.tasks[i % R.tasks.length], started_at: t - (i + 1) * 600000, heartbeat: t, pinned: true }));
  /* a season of habit taps, for the pallets */
  for (let d = 0; d < 21; d++) for (let k = 0; k < 6 + (d % 4); k++) f.habitTaps.push(addDays(today, -d));

  /* you */
  if (uid) {
    f.builders.set(uid, { hat: 'orange', vest: 'lime', first_name: 'Alex', first_name_public: true });
    const mine = { id: f._newId(), user_id: uid, title: 'Fix up the old Raleigh', why: 'It was my mom’s, and it’s been in the basement since 2019.',
      for_whom: 'My niece, when it’s done', partner: '', target_date: addDays(today, 40), status: 'active', why_public: false, created_at: t - 18 * 86400000, done_at: null };
    f.things.push(mine);
    for (let d = 1; d < 18; d++) {
      if (d % 3 === 1) continue;
      f.shifts.push({ id: f._newId(), user_id: uid, client_id: 'demo-me-' + d, thing_id: mine.id, kind: d % 5 === 0 ? 'logged' : 'shift', started: null, ended: null,
        day: addDays(today, -d), minutes: 30 + (d * 17) % 70, step: '', note: '', posted: false, created_at: t });
    }
    post(uid, 'progress', 'Got the old tires off. One of them was mostly dust.', 70, { minutes: 80 });
    const stuck = post(uid, 'stuck', 'The rear brake caliper is seized. I don’t know if it’s worth saving.', 6, { stuck_reason: 'missing', help_need: 'tool' });
    f.helps.push({ id: f._newId(), post_id: stuck.id, helper_id: people[4], line: 'I restore old Raleighs. Bring it by Saturday?', status: 'offered',
      created_at: hoursAgo(1), decided_at: null, intro_sent_at: null });
  }
  return f;
}
