/* boards-fake.js — an in-memory copy of supabase/nn-SETUP.sql with
   nn-ROUND2.sql over it, for ?demo=1 and for scripts/test-boards-core.mjs.

   Same function names, same arguments, same answers, same refusal codes, in
   the same order of checks, built on the same rules (boards-core.js). It
   saves nothing and calls nothing. The clock is injected so a test can walk
   a post past its end; the caller is set with as(userId) so a test can be
   any reader, or nobody.

   The photo queue (btb_photos, photo-admin.html) is mirrored as a map of
   storage path to { status, board, at }: board says the photo was filed from
   an All Day board (spot "All Day · …"), at is when it arrived. addPhoto()
   and setPhoto() stand in for a reader uploading and Stephen approving.
   The bucket's picture files are a map of path to upload time (addFile);
   a photo-queue row needs no file here, but a stray file is one with no
   row and no post (nn_mod_photo_sweep). */

import { RULES, checkProfile, checkPost, mergeMeta, expiresAt, startsPending, photoRequired, oneVote, rateError, voterFor, isoWeek, lastWeeks } from './boards-core.js';

const fail = (code) => { const e = new Error(code); e.code = code; return e; };
const DAY = 86400000;
let seq = 0;
const newId = () => '00000000-0000-4000-8000-' + (++seq).toString(16).padStart(12, '0');

export class FakeBoards {
  constructor({ now, rules, modSecret } = {}) {
    this.now = now || (() => Date.now());
    this.rules = rules || RULES;
    this.modSecret = modSecret || null;   // null: the passphrase line has not been run
    this.uid = null;
    this.profiles = new Map();   // uid -> { display_name, neighborhood, archetype, interests }
    this.posts = [];             // rows, as nn_posts holds them
    this.votes = new Set();      // `${postId}|${voter}`
    this.voteAt = new Map();     // the same key -> when it was cast; a vote seeded without one counts from its post's time
    this.reports = [];           // { post_id, reporter, reason, at }
    this.bans = new Map();       // uid -> at
    this.missions = new Map();   // uid -> Set of keys
    this.photos = new Map();     // storage path -> { status: 'pending' | 'approved' | 'rejected' | 'removed', board, at }
    this.files = new Map();      // the bucket: storage path -> when it was uploaded
  }

  as(uid) { this.uid = uid || null; return this; }
  addPhoto(path, status, o = {}) {
    this.photos.set(path, { status: status || 'pending', board: o.board !== false, at: o.at == null ? this.now() : o.at });
    return path;
  }
  setPhoto(path, status) { const p = this.photos.get(path); if (p) p.status = status; }
  addFile(path, at) { this.files.set(path, at == null ? this.now() : at); return path; }
  /* the Storage API's remove, as the stray policies let a reader use it */
  removeFiles(paths) { return (paths || []).filter((p) => this._stray(p) && this.files.delete(p)); }

  /* --------------------------------------------------------------- helpers */
  _t() { return this.now(); }
  _photoState(path) {
    if (!path) return 'none';
    const p = this.photos.get(path);
    if (!p) return 'missing';
    return p.status === 'approved' ? 'approved' : p.status === 'pending' ? 'pending' : 'rejected';
  }
  /* nn_photo_claimable: a board's own photo, still waiting, from the last day */
  _claimable(path) {
    const p = path && this.photos.get(path);
    return !!p && p.status === 'pending' && p.board && p.at > this._t() - DAY;
  }
  _listable(p) {
    return p.status === 'approved' && (p.expires_at == null || p.expires_at > this._t()) &&
      (!p.photo_req || this._photoState(p.photo_path) === 'approved');
  }
  _count(id) { let n = 0; for (const k of this.votes) if (k.startsWith(id + '|')) n++; return n; }
  _json(p, voter, uid) {
    const pr = this.profiles.get(p.user_id);
    return {
      id: p.id, board: p.board, kind: p.kind, title: p.title, body: p.body, place: p.place, meta: { ...p.meta },
      photo: this._photoState(p.photo_path) === 'approved' ? p.photo_path : null,
      author: pr ? pr.display_name : 'A neighbor', author_arch: pr ? pr.archetype : null,
      created_at: new Date(p.created_at).toISOString(), expires_at: p.expires_at == null ? null : new Date(p.expires_at).toISOString(),
      votes: this._count(p.id), voted: !!voter && this.votes.has(p.id + '|' + voter), mine: !!uid && p.user_id === uid,
    };
  }
  _sweep() {
    const t = this._t(), L = this.rules.limits;
    const gone = new Set(this.posts.filter((p) => (p.expires_at != null && p.expires_at < t - L.expiredKeepDays * DAY) ||
      (p.status === 'deleted' && (p.decided_at || p.created_at) < t - L.deletedKeepDays * DAY)).map((p) => p.id));
    this._drop(gone);
    this._photoSweep();
  }
  _drop(ids) {
    if (!ids.size) return;
    this.posts = this.posts.filter((p) => !ids.has(p.id));
    for (const k of [...this.votes]) if (ids.has(k.split('|')[0])) this._unvoteKey(k);
    this.reports = this.reports.filter((r) => !ids.has(r.post_id));
  }
  _unvoteKey(k) { this.votes.delete(k); this.voteAt.delete(k); }
  /* nn_photo_orphan: a day-old file under submissions/ no queue row or post names */
  _stray(path) {
    const at = this.files.get(path);
    return at != null && /^submissions\/[A-Za-z0-9-]+\.jpg$/.test(path) && at <= this._t() - DAY &&
      !this.photos.has(path) && !this.posts.some((p) => p.photo_path === path);
  }
  /* nn_photo_sweep: board photos still waiting a day and an hour on, taken by no post */
  _photoSweep() {
    let n = 0;
    for (const [path, ph] of this.photos) {
      if (ph.status === 'pending' && ph.board && ph.at < this._t() - DAY - 3600000 && !this.posts.some((p) => p.photo_path === path)) { ph.status = 'removed'; n++; }
    }
    return n;
  }
  _photoRemove(path) { const p = path && this.photos.get(path); if (p && p.board) p.status = 'removed'; }
  _need() { if (!this.uid) throw fail('not_signed_in'); return this.uid; }
  _find(id) { return this.posts.find((p) => p.id === id) || null; }

  /* The one door, named like the SQL functions, taking their arguments.
     Returns what the RPC returns; throws an Error whose .code is the SQL
     exception's message. */
  call(fn, a = {}) {
    if (typeof this[fn] !== 'function' || !/^nn_/.test(fn)) throw fail('no_function');
    return this[fn](a);
  }

  /* -------------------------------------------------------------- profiles */
  nn_rules() { return JSON.parse(JSON.stringify(this.rules)); }
  nn_profile_get() {
    const u = this._need();
    const p = this.profiles.get(u);
    return p ? { ...p, interests: (p.interests || []).slice() } : null;
  }
  /* Two calls in the SQL, one here: without p_interests (the round-one
     call) the reader's interests stay as they are; a list replaces them. */
  nn_profile_set({ p_display_name, p_neighborhood = null, p_archetype = null, p_interests }) {
    const u = this._need();
    const r = checkProfile(this.rules, { display_name: p_display_name, neighborhood: p_neighborhood, archetype: p_archetype, interests: p_interests });
    if (!r.ok) throw fail(r.error);
    const had = this.profiles.get(u);
    const profile = { ...r.profile, interests: r.profile.interests || (had && had.interests ? had.interests.slice() : []) };
    this.profiles.set(u, profile);
    return { ...profile, interests: profile.interests.slice() };
  }

  /* ---------------------------------------------------------------- posts */
  nn_post_create({ p_board, p_kind, p_title, p_body = '', p_place = '', p_meta = {}, p_photo = null }) {
    const u = this._need();
    if (this.bans.has(u)) throw fail('banned');
    if (!this.profiles.has(u)) throw fail('no_name');
    const photo = p_photo || null;
    const r = checkPost(this.rules, p_board, { kind: p_kind, title: p_title, body: p_body, place: p_place, meta: p_meta, photo_path: photo });
    if (!r.ok) throw fail(r.error);
    if (photo && (!this._claimable(photo) || this.posts.some((p) => p.photo_path === photo))) throw fail('bad_photo');
    this._sweep();
    const t = this._t();
    const today = this.posts.filter((p) => p.user_id === u && p.created_at > t - DAY).length;
    const waiting = this.posts.filter((p) => p.user_id === u && (p.status === 'pending' || (p.photo_path && this._photoState(p.photo_path) === 'pending'))).length;
    const rate = rateError(this.rules, today, waiting);
    if (rate) throw fail(rate);
    const row = {
      id: newId(), board: p_board, user_id: u, kind: p_kind, title: r.post.title, body: r.post.body, photo_path: photo,
      photo_req: photoRequired(this.rules, p_board, p_kind), meta: r.post.meta, place: r.post.place,
      expires_at: expiresAt(this.rules, p_board, p_kind, t), status: startsPending(this.rules, p_board) ? 'pending' : 'approved',
      reports: 0, created_at: t, decided_at: null,
    };
    this.posts.push(row);
    return { ...this._json(row, 'u:' + u, u), status: row.status };
  }

  nn_posts_list({ p_board, p_limit = null, p_before = null, p_filter = {}, p_player = null, p_sort = 'new' }) {
    const L = this.rules.limits;
    if (!this.rules.boards[p_board]) throw fail('bad_board');
    const voter = voterFor(this.uid, p_player);
    const lim = Math.min(Math.max(p_limit == null ? L.listDefault : p_limit, 1), L.listMax);
    const f = p_filter && typeof p_filter === 'object' && !Array.isArray(p_filter) ? p_filter : {};
    const before = p_before ? Date.parse(p_before) : null;
    const top = p_sort === 'top';
    const metaOk = (m) => !f.meta || typeof f.meta !== 'object' || Array.isArray(f.meta) || Object.entries(f.meta).every(([k, v]) => JSON.stringify(m[k]) === JSON.stringify(v));
    return this.posts
      .filter((p) => p.board === p_board && this._listable(p) && (f.kind == null || p.kind === f.kind) && metaOk(p.meta) &&
        (before == null || top || p.created_at < before))
      .map((p) => ({ p, o: top ? this._count(p.id) : 0 }))
      .sort((a, b) => b.o - a.o || b.p.created_at - a.p.created_at)
      .slice(0, lim)
      .map(({ p }) => this._json(p, voter, this.uid));
  }

  nn_post_mine() {
    const u = this._need();
    return this.posts.filter((p) => p.user_id === u && p.status !== 'deleted')
      .sort((a, b) => b.created_at - a.created_at)
      .map((p) => ({ ...this._json(p, 'u:' + u, u), status: p.status, photo_state: this._photoState(p.photo_path),
        photo_path: p.photo_path, ended: p.expires_at != null && p.expires_at <= this._t() }));
  }

  nn_post_delete_own({ p_post }) {
    const u = this._need();
    const p = this.posts.find((x) => x.id === p_post && x.user_id === u);
    if (!p) throw fail('not_found');
    this._drop(new Set([p.id]));
    this._photoRemove(p.photo_path);
    return { deleted: true };
  }

  nn_post_meta_set({ p_post, p_meta }) {
    const u = this._need();
    if (this.bans.has(u)) throw fail('banned');
    const p = this.posts.find((x) => x.id === p_post && x.user_id === u && x.status !== 'deleted');
    if (!p) throw fail('not_found');
    const m = mergeMeta(this.rules, p.board, p.kind, p.meta, p_meta);
    if (m.error) throw fail(m.error);
    p.meta = m.meta;
    if (startsPending(this.rules, p.board) && p.status === 'approved') p.status = 'pending';
    return { ...this._json(p, 'u:' + u, u), status: p.status };
  }

  nn_photo_abandon({ p_path }) {
    if (this._claimable(p_path) && !this.posts.some((p) => p.photo_path === p_path)) { this._photoRemove(p_path); return { removed: true }; }
    return { removed: false };
  }

  /* ---------------------------------------------------------------- votes */
  _votable(p_post, p_player) {
    const voter = voterFor(this.uid, p_player);
    if (!voter) throw fail('bad_voter');
    const p = this._find(p_post);
    if (!p || !this._listable(p)) throw fail('not_found');
    return voter;
  }
  nn_vote({ p_post, p_player = null }) {
    const voter = this._votable(p_post, p_player);
    const p = this._find(p_post);
    const moved = [];
    if (oneVote(this.rules, p.board, p.kind)) {
      /* every other pick that has not ended, a hidden one included */
      this.posts.filter((o) => o.id !== p.id && o.board === p.board && o.kind === p.kind && (o.expires_at == null || o.expires_at > this._t()) && this.votes.has(o.id + '|' + voter))
        .forEach((o) => { this._unvoteKey(o.id + '|' + voter); moved.push(o.id); });
    }
    const k = p_post + '|' + voter;
    if (!this.votes.has(k)) { this.votes.add(k); this.voteAt.set(k, this._t()); }
    return { votes: this._count(p_post), voted: true, moved };
  }
  nn_unvote({ p_post, p_player = null }) {
    const voter = this._votable(p_post, p_player);
    this._unvoteKey(p_post + '|' + voter);
    return { votes: this._count(p_post), voted: false };
  }
  nn_votes_by_week({ p_board, p_weeks = 8 }) {
    if (!this.rules.boards[p_board]) throw fail('bad_board');
    const n = Math.min(Math.max(p_weeks == null ? 8 : p_weeks, 1), this.rules.limits.weeksMax);
    const weeks = new Set(lastWeeks(this._t(), n));
    const live = new Map(this.posts.filter((p) => p.board === p_board && this._listable(p)).map((p) => [p.id, p]));
    const counts = new Map();
    for (const k of this.votes) {
      const id = k.split('|')[0];
      const p = live.get(id);
      if (!p) continue;
      const at = this.voteAt.has(k) ? this.voteAt.get(k) : p.created_at;
      if (at > this._t()) continue;
      const week = isoWeek(at);
      if (!weeks.has(week)) continue;
      const key = id + '|' + week;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts].map(([key, votes]) => { const [post, week] = key.split('|'); return { post, week, votes }; })
      .sort((a, b) => (a.week < b.week ? 1 : a.week > b.week ? -1 : 0) || b.votes - a.votes || (a.post < b.post ? -1 : a.post > b.post ? 1 : 0));
  }

  /* -------------------------------------------------------------- reports */
  nn_report({ p_post, p_reason }) {
    const u = this._need();
    const L = this.rules.limits;
    if (this.bans.has(u)) throw fail('banned');
    if (!this.rules.reasons.includes(p_reason || '')) throw fail('bad_reason');
    const p = this._find(p_post);
    if (!p || !this._listable(p)) throw fail('not_found');
    if (p.user_id === u) throw fail('own_post');
    if (this.reports.some((r) => r.post_id === p_post && r.reporter === u)) throw fail('already_reported');
    if (this.reports.filter((r) => r.reporter === u && r.at > this._t() - DAY).length >= L.reportsPerDay) throw fail('rate_reports');
    this.reports.push({ post_id: p_post, reporter: u, reason: p_reason, at: this._t() });
    p.reports += 1;
    if (p.reports >= L.reportsToHide) p.status = 'pending';
    return { hidden: p.reports >= L.reportsToHide };
  }

  /* --------------------------------------------------------- your account */
  nn_delete_me() {
    const u = this._need();
    const mine = this.posts.filter((p) => p.user_id === u);
    mine.forEach((p) => this._photoRemove(p.photo_path));
    this._drop(new Set(mine.map((p) => p.id)));
    for (const k of [...this.votes]) if (k.endsWith('|u:' + u)) this._unvoteKey(k);
    /* their reports stop counting: each post is recounted from the reports
       that remain since Stephen last cleared it */
    this.reports = this.reports.filter((r) => r.reporter !== u);
    this.posts.filter((p) => p.reports > 0).forEach((p) => {
      p.reports = this.reports.filter((r) => r.post_id === p.id && (p.cleared_at == null || r.at > p.cleared_at)).length;
    });
    this.missions.delete(u);
    this.profiles.delete(u);
    return { deleted: true };
  }

  /* ------------------------------------------------------------- missions */
  /* signed-in only, as the SQL grants them; the table takes keys m1..m999 */
  nn_mission_set({ p_key, p_done }) {
    this._need();
    if (!/^m[0-9]{1,3}$/.test(String(p_key))) throw fail('bad_key');
    const s = this.missions.get(this.uid) || new Set();
    if (p_done) s.add(p_key); else s.delete(p_key);
    this.missions.set(this.uid, s);
    return null;
  }
  nn_missions_done() { const u = this._need(); return [...(this.missions.get(u) || [])].map((key) => ({ key })); }

  /* ----------------------------------------------------------- moderation */
  _modOk(secret) { return !!this.modSecret && !!secret && secret === this.modSecret; }
  _modRow(p, extra) {
    return { ...this._json(p, null, null), status: p.status, reports: p.reports, user_id: p.user_id, ...extra };
  }
  nn_mod_list({ p_secret }) {
    if (!this._modOk(p_secret)) return { error: 'bad_secret' };
    this._sweep();
    const newest = (a, b) => b.created_at - a.created_at;
    const reasons = (p) => this.reports.filter((r) => r.post_id === p.id).map((r) => r.reason);
    const photo = (p) => ({ photo_path: p.photo_path, photo_state: this._photoState(p.photo_path) });
    return {
      waiting: this.posts.filter((p) => p.status === 'pending').sort(newest).map((p) => this._modRow(p, { ...photo(p), reasons: reasons(p) })),
      reported: this.posts.filter((p) => p.status === 'approved' && p.reports > 0).sort((a, b) => b.reports - a.reports || newest(a, b))
        .map((p) => this._modRow(p, { ...photo(p), reasons: reasons(p) })),
      hidden: this.posts.filter((p) => p.status === 'hidden').sort(newest).slice(0, 50).map((p) => this._modRow(p)),
      recent: this.posts.filter((p) => p.status === 'approved').sort(newest).slice(0, 50).map((p) => this._modRow(p, photo(p))),
      bans: [...this.bans].map(([user_id, at]) => ({ user_id, created_at: new Date(at).toISOString(), name: (this.profiles.get(user_id) || {}).display_name || null })),
    };
  }
  nn_mod_act({ p_secret, p_post, p_action }) {
    if (!this._modOk(p_secret)) return { error: 'bad_secret' };
    const p = this._find(p_post);
    if (!p) return { error: 'not_found' };
    const t = this._t();
    if (p_action === 'approve') Object.assign(p, { status: 'approved', reports: 0, decided_at: t, cleared_at: t });
    else if (p_action === 'hide') Object.assign(p, { status: 'hidden', decided_at: t });
    else if (p_action === 'delete') Object.assign(p, { status: 'deleted', decided_at: t });
    else if (p_action === 'ban') {
      if (!this.bans.has(p.user_id)) this.bans.set(p.user_id, t);
      this.posts.filter((x) => x.user_id === p.user_id && (x.status === 'approved' || x.status === 'pending'))
        .forEach((x) => Object.assign(x, { status: 'hidden', decided_at: t }));
    } else return { error: 'bad_action' };
    return { ok: true };
  }
  nn_mod_unban({ p_secret, p_user }) {
    if (!this._modOk(p_secret)) return { error: 'bad_secret' };
    this.bans.delete(p_user);
    return { ok: true };
  }
  nn_mod_photo_sweep({ p_secret }) {
    if (!this._modOk(p_secret)) return { error: 'bad_secret' };
    const abandoned = this._photoSweep();
    const strays = [...this.files].filter(([path]) => this._stray(path)).sort((a, b) => a[1] - b[1]).slice(0, 100).map(([path]) => path);
    return { abandoned, strays };
  }
  /* nn-people.sql's side table is People's own mirror (people.js); here a
     plan's Meetup box is the one in its meta */
  nn_people_meetup_list({ p_secret }) {
    if (!this._modOk(p_secret)) return { error: 'bad_secret' };
    return {
      plans: this.posts.filter((p) => p.board === 'people' && this._listable(p) && p.meta.meetup === true)
        .sort((a, b) => b.created_at - a.created_at)
        .map((p) => ({ id: p.id, title: p.title, when: p.meta.when || null, place: p.place, spots: p.meta.spots == null ? null : p.meta.spots,
          ages: p.meta.ages || null, author: (this.profiles.get(p.user_id) || {}).display_name || 'A neighbor', going: this._count(p.id),
          created_at: new Date(p.created_at).toISOString(), expires_at: p.expires_at == null ? null : new Date(p.expires_at).toISOString() })),
    };
  }
}

/* ------------------------------------------------------------- the demo */
/* A handful of invented neighbors and their posts on each board, dated
   relative to now, so a tab built on boards.js has something to draw in
   ?demo=1. Every name, shop and film here is made up. Demo photos are
   storage paths named after a placeholder palette (submissions/demo-dawn.jpg
   draws the "dawn" gradient); boards.js never fetches them. */
export const DEMO_ME = 'demo-0000-4000-8000-00000000me00';
export function seedDemo(fake) {
  const t = fake.now();
  const H = 3600000;
  const people = [
    ['demo-0000-4000-8000-00000000maya', 'Maya R.', 'old-north-end', 'trail'],
    ['demo-0000-4000-8000-00000000dev0', 'Dev K.', 'south-end', 'games'],
    ['demo-0000-4000-8000-00000000kara', 'Kara M.', 'downtown', 'regular'],
    ['demo-0000-4000-8000-00000000tom0', 'Tom A.', 'new-north-end', 'new'],
    ['demo-0000-4000-8000-00000000jess', 'Jess T.', 'hill', null],
  ];
  people.forEach(([id, name, hood, arch]) => fake.profiles.set(id, { display_name: name, neighborhood: hood, archetype: arch, interests: [] }));
  const add = (who, board, kind, title, o = {}) => {
    const created = t - (o.ago || 1) * H;
    if (o.photo) fake.addPhoto(o.photo, 'approved');
    fake.posts.push({
      id: newId(), board, user_id: people[who][0], kind, title, body: o.body || '', photo_path: o.photo || null,
      photo_req: photoRequired(fake.rules, board, kind), meta: o.meta || {}, place: o.place || '',
      expires_at: expiresAt(fake.rules, board, kind, created), status: 'approved', reports: 0, created_at: created, decided_at: null,
    });
    const p = fake.posts[fake.posts.length - 1];
    for (let i = 0; i < (o.votes || 0); i++) fake.votes.add(p.id + '|p_seed' + String(i).padStart(4, '0'));
  };
  add(2, 'vintage', 'spotted', '1994 UVM crewneck', { ago: 4, meta: { shop: 'Battery Street Jeans', size: 'L', price: 28 }, photo: 'submissions/demo-neon.jpg', votes: 12, body: 'Back rack by the boots. Barely worn.' });
  add(3, 'vintage', 'spotted', 'Red barn jacket', { ago: 30, meta: { shop: 'Old Gold', size: 'M', price: 45 }, photo: 'submissions/demo-cherry.jpg', votes: 7 });
  add(0, 'vintage', 'spotted', 'Suede boots, barely scuffed', { ago: 60, meta: { shop: 'Dirt Chic', size: '9', price: 60 }, photo: 'submissions/demo-sand.jpg', votes: 4 });
  add(4, 'vintage', 'swap', 'Two band tees for anything denim', { ago: 20, meta: { want: 'Denim, size 32', size: 'M' }, place: 'South End', votes: 2 });
  add(4, 'art', 'photo', 'North Beach, 6:52 am', { ago: 10, photo: 'submissions/demo-dawn.jpg', meta: { shirt: 'yes' }, votes: 41 });
  add(1, 'art', 'art', 'Camel’s Hump from the Intervale', { ago: 26, photo: 'submissions/demo-pine.jpg', meta: { medium: 'Gouache' }, votes: 18 });
  add(2, 'art', 'notice', 'Looking for a model for a Saturday shoot at Oakledge', { ago: 5, body: 'Two hours, golden light, prints for you after.', votes: 3 });
  add(0, 'people', 'plan', 'Sunday trail run, 5 to 8 miles', { ago: 2, meta: { when: 'Sunday, 8 am', arch: 'trail', spots: 6 }, place: 'Red Rocks Park', body: 'Easy pace, coffee after is not optional.', votes: 3 });
  add(1, 'people', 'plan', 'Pickup soccer, need four more', { ago: 4, meta: { when: 'Sunday, 10 am', arch: 'games', spots: 4, meetup: true, ages: 'thirties' }, place: 'Leddy Park', votes: 7 });
  add(3, 'people', 'plan', 'A slow walk through the Intervale', { ago: 6, meta: { when: 'Saturday, 9 am', arch: 'new' }, place: 'Intervale Center', body: 'Two months in, know nobody, like trees. Will bring a thermos.', votes: 1 });
  add(2, 'watch', 'rating', 'Winter Light', { ago: 8, meta: { stars: 5, year: 2024, where: 'The Roxy' }, body: 'Go see it on the big screen while you can.', votes: 9 });
  add(4, 'watch', 'rating', 'Causeway', { ago: 28, meta: { stars: 4, year: 2024 }, votes: 5 });
  add(1, 'watch', 'pick', 'The Long Lake, Friday at the Roxy', { ago: 3, meta: { where: 'The Roxy' }, body: 'Who’s in? Meeting in the lobby at 6:50.', votes: 4 });
  return fake;
}
