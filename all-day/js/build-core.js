/* build-core.js — The Build's rules, its shift clock, and the one API the
   tab talks to.

   Three things obey the same rules and must agree, as with Habits: this
   file, supabase/bd-SETUP.sql (the server checks everything again, because
   the anon key is public) and js/build-fake.js (the demo, the tests, and,
   through js/build-local.js, a reader who has not signed in). BUILD_RULES
   is copied as JSON into bd_rules() in bd-SETUP.sql; scripts/test-build-core.mjs
   fails if they differ (`node scripts/test-build-core.mjs --write-sql`
   copies it across).

   No DOM and no clock of its own: time comes in as now(), chance as
   random(), storage as an object with get/set/remove, and the network as a
   `server` with call(fn, args). So the whistle can be tested with a fake
   clock, and the same API runs live, in the demo and signed out.

   ------------------------------------------------------------ the API
   The tab gets it in one line (build-local.js wires the three backends):

     import { openBuild } from '../build-local.js';
     const build = openBuild({ demo: app.demo, user: () => app.user(), token: () => app.token(),
                               url: store.SB_URL, key: store.SB_KEY, config });   // config: data/build-config.json

   Every method resolves { ok: true, ... } or { ok: false, error, message }
   and never rejects (shift.status() alone is synchronous). `message` is a
   sentence to show as is.

     build.thing.get()                 -> { thing, done }  thing: { id, title, why, for_whom, partner,
                                          target_date 'YYYY-MM-DD'|null, status 'active'|'paused',
                                          why_public, created_at, has_posts } or null; done: [{ id, title, done_at }]
     build.thing.set({ title, why, for_whom, partner, target_date, why_public })
                                       -> { thing }   makes your thing when you have none, else changes it;
                                          a field left out stays, '' clears it (title cannot be cleared)
     build.thing.finish() / pause() / resume()  -> { thing }   finish: status done; name the next one with set()
     build.things.public()             -> { things: [{ id, title, why|null, name|null, last_kind, last_at 'YYYY-MM-DD' }] }
                                          neighbours' things with at least one post, newest post first, at most 20
                                          (the starter door). why only when the owner turned why_public on for that
                                          thing; name only when their builder's first_name_public is on. Public: it
                                          works signed out too (thing.listPublic() is the same call)
     build.shift.start(step)           -> { shift }   step: the next step, one line, or '' (private, never sent
                                          to anyone but you)
     build.shift.heartbeat({ task })   -> { shift }   every 60 s while the page is visible; keeps you on the site
                                          for the town (signed in), and is the clock's proof the page is alive
     build.shift.touch() / whistleAnswered()  -> { shift }  any touch on the phone during a shift (the
                                          whistle's answer is one); restarts the 15 to 30 minute whistle
     build.shift.pause() / resume()    -> { shift }   page hidden / visible again (resume is a touch)
     build.shift.status()              -> shift | null, synchronous: see shiftStatus() below
     build.shift.end({ note })         -> { shift: { id, minutes, kind, day, ... }, minutes }  banks it; also the
                                          way to close a 'missed' shift. A shift under a minute is not kept
                                          (shift null, minutes 0).
     build.shift.recover()             -> { shift }   after a reload: the shift kept on this phone, settled to now
                                          (a dead page pauses it; an unanswered whistle has knocked it off)
     build.logIt({ minutes, note, day }) -> { shift }  work away from the phone; day defaults to today, up to
                                          7 days back
     build.post.create({ kind, line, photo, minutes, stuck_reason, help_need, brief_ok, shift })
                                       -> { post }   kind progress|stuck|found|finished; photo is a photo-queue
                                          path; minutes optional; stuck_reason and help_need on Stuck only;
                                          shift: the id end() gave, marked posted
     build.post.remove(id)             -> {}
     build.feed.list({ before, limit, kind, brief }) -> { posts }   newest first (feedPost below)
     build.nice.toggle(id)             -> { nice, niced }
     build.help.offer(postId, line)    -> { help: { id, status } }
     build.help.respond(helpId, yes)   -> { help: { id, status } }  on yes the intro email goes to both sides
     build.help.list()                 -> { incoming: [{ id, post, post_line, name, line, status, created_at }],
                                            outgoing: [{ id, post, post_line, name, line, status, created_at }] }
     build.report({ post } | { help }, reason)  -> { hidden }   reason: spam|unkind|unsafe|other
     build.block.add({ post } | { help }) -> {}    block.list() -> { blocks: [{ id, name }] }  block.remove(id) -> {}
     build.town.get()                  -> { town }  { total_minutes, week_minutes, habit_drops, build_minutes,
                                          posts_lit, windows_lit, on_shift_count, on_shift: [{ id, look: { hat, vest },
                                          task, name?, me? }], floors, floors_done, floor_progress 0..1, topped_out, season }
     build.record.get()                -> { days: [{ day, minutes, logged }], weeks: [{ week, minutes }],
                                          total_minutes, season_minutes }   yours alone (season_minutes: the cutaway)
     build.shelf.get(thingId?)         -> { posts }  your posts for this thing (default: your current one), oldest first
     build.builder.get()               -> { builder: { hat, vest, first_name, first_name_public } } or null
     build.builder.set({ hat, vest, first_name, first_name_public }) -> { builder }
     build.importLocal()               -> { moved }  at sign-in: this phone's thing, hours and look go to the account once
     build.deleteMine()                -> {}         for Settings' "Delete my account and posts"
     build.status()                    'unknown' | 'live' | 'off' (bd-SETUP.sql not pasted) | 'demo'

   Signed out, the thing, shifts, Log it, your record, your shelf (empty) and
   your builder all work on this phone (build-local.js). The town, the feed
   and public things are read from the server (they are public). Posting,
   Nice, I can help, reports and blocks need sign-in ('not_signed_in').
   Presence is handled inside shift.*: signed in, start/heartbeat put you on
   the site and end takes you off; you go stale after three minutes anyway.

   Privacy: the server never hands back an email, an account id, a shift's
   times or a heartbeat; only first names (and only those a builder chose
   to show on the site), counts, and the posts people chose to post. */

export const BUILD_RULES = {
  version: 1,
  tz: 'America/New_York',
  postKinds: ['progress', 'stuck', 'found', 'finished'],
  thingStatuses: ['active', 'paused', 'done'],
  shiftKinds: ['shift', 'logged'],
  stuckReasons: ['unclear', 'too_big', 'missing', 'unsure'],
  helpNeeds: ['hand', 'tool', 'smaller', 'different'],
  helpStatuses: ['offered', 'accepted', 'declined'],
  reasons: ['spam', 'unkind', 'unsafe', 'other'],
  hats: ['yellow', 'white', 'orange', 'blue', 'red', 'green'],
  vests: ['orange', 'lime', 'yellow', 'pink', 'blue'],
  tasks: ['haul', 'frame', 'brick', 'wire', 'window', 'roof', 'lunch'],
  limits: {
    titleMax: 80, whyMax: 280, forMax: 80, partnerMax: 80, stepMax: 80, noteMax: 200, lineMax: 200, helpLineMax: 140, nameMax: 32,
    shiftMaxMinutes: 720, logMaxMinutes: 720, logBackDays: 7, dayMaxMinutes: 1440, shiftLateDays: 14, postMinutesMax: 100000,
    postsPerDay: 20, offersPerDay: 10, reportsPerDay: 10, reportsToHide: 2,
    feedDefault: 30, feedMax: 60, onShiftMax: 120, publicThingsMax: 20, doneShown: 20, recordDays: 370,
    staleSeconds: 180, importShiftsMax: 1000, importDays: 400,
  },
};

/* The clock's numbers. Not on the server: it never sees a whistle. */
export const SHIFT = {
  whistleMinMs: 15 * 60000,    // never sooner than 15 minutes after the last touch
  whistleMaxMs: 30 * 60000,    // never later than 30
  windowMs: 3 * 60000,         // three minutes to answer it
  beatMs: 60000,               // heartbeat while the page is visible
  aliveMs: 150000,             // a page silent longer than this was asleep, hidden or gone
  taskMs: 9 * 60000,           // a builder moves to the next job about this often
};

/* data/build-config.json, for when it cannot be read (and the tests). The
   file is what Stephen tunes; scripts/test-build-core.mjs keeps the two the same. */
export const BUILD_CONFIG = {
  version: 1,
  hours_per_floor: 25,
  floors: 6,
  roof: true,
  habit_drop_minutes: 5,
  season: { building: 'watershed', starts: null, topping_out_date: null, party_url: null },
};

/* --------------------------------------------------------------------- days */
const DAYF = new Intl.DateTimeFormat('en-CA', { timeZone: BUILD_RULES.tz, year: 'numeric', month: '2-digit', day: '2-digit' });
/* The Burlington calendar date of an instant, 'YYYY-MM-DD'. */
export function dayKey(ms) {
  const o = {};
  DAYF.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
  return o.year + '-' + o.month + '-' + o.day;
}
const keyMs = (key) => { const [y, m, d] = String(key).split('-').map(Number); return Date.UTC(y, m - 1, d, 12); };
export const isKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && new Date(keyMs(k)).toISOString().slice(0, 10) === k;
export const addDays = (key, n) => new Date(keyMs(key) + n * 86400000).toISOString().slice(0, 10);
export const weekStart = (key) => addDays(key, -((new Date(keyMs(key)).getUTCDay() + 6) % 7));

/* -------------------------------------------------------------- the checks */
/* Tidy words the way bd_clean() does, in the same order: drop control
   characters, drop links, squeeze the spaces. */
export function clean(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
const nameOk = (s, max) => s.length <= max && !s.includes('@');

/* A thing, new or changed: the stored row's fields, merged with what came
   in (undefined/null keeps, '' clears). Same order of checks as bd_thing_set. */
export function checkThing(rules, had, input) {
  const L = rules.limits;
  const pick = (k) => (input && input[k] != null ? clean(input[k]) : (had ? had[k] || '' : ''));
  const title = pick('title');
  if (!title || title.length > L.titleMax) return { ok: false, error: 'bad_title' };
  const why = pick('why');
  if (why.length > L.whyMax) return { ok: false, error: 'bad_why' };
  const for_whom = pick('for_whom');
  if (for_whom.length > L.forMax) return { ok: false, error: 'bad_for' };
  const partner = pick('partner');
  if (partner.length > L.partnerMax) return { ok: false, error: 'bad_partner' };
  let target_date = had ? had.target_date || null : null;
  if (input && input.target_date != null) {
    const t = String(input.target_date).trim();
    if (t === '') target_date = null;
    else if (!isKey(t)) return { ok: false, error: 'bad_date' };
    else target_date = t;
  }
  const why_public = input && typeof input.why_public === 'boolean' ? input.why_public : !!(had && had.why_public);
  return { ok: true, thing: { title, why, for_whom, partner, target_date, why_public } };
}

/* Your builder's look and name. Same as bd_builder_set. */
export function checkBuilder(rules, had, input) {
  const hat = input && input.hat != null ? input.hat : (had ? had.hat : rules.hats[0]);
  if (!rules.hats.includes(hat)) return { ok: false, error: 'bad_look' };
  const vest = input && input.vest != null ? input.vest : (had ? had.vest : rules.vests[0]);
  if (!rules.vests.includes(vest)) return { ok: false, error: 'bad_look' };
  const first_name = input && input.first_name != null ? clean(input.first_name) : (had ? had.first_name || '' : '');
  if (!nameOk(first_name, rules.limits.nameMax)) return { ok: false, error: 'bad_name' };
  const first_name_public = input && typeof input.first_name_public === 'boolean' ? input.first_name_public : !!(had && had.first_name_public);
  return { ok: true, builder: { hat, vest, first_name, first_name_public } };
}

/* A post. Same order of checks as bd_post_create. */
export function checkPost(rules, input) {
  const L = rules.limits;
  const kind = input && input.kind;
  if (!rules.postKinds.includes(kind)) return { ok: false, error: 'bad_kind' };
  const line = clean(input.line);
  if (!line || line.length > L.lineMax) return { ok: false, error: 'bad_line' };
  const stuck_reason = input.stuck_reason == null || input.stuck_reason === '' ? null : input.stuck_reason;
  const help_need = input.help_need == null || input.help_need === '' ? null : input.help_need;
  if ((stuck_reason || help_need) && kind !== 'stuck') return { ok: false, error: 'bad_stuck' };
  if (stuck_reason && !rules.stuckReasons.includes(stuck_reason)) return { ok: false, error: 'bad_stuck' };
  if (help_need && !rules.helpNeeds.includes(help_need)) return { ok: false, error: 'bad_stuck' };
  let minutes = input.minutes == null || input.minutes === '' ? null : Number(input.minutes);
  if (minutes != null && (!Number.isInteger(minutes) || minutes < 1 || minutes > L.postMinutesMax)) return { ok: false, error: 'bad_minutes' };
  const photo = input.photo == null || input.photo === '' ? null : String(input.photo);
  if (photo && !/^submissions\/[A-Za-z0-9-]+\.jpg$/.test(photo)) return { ok: false, error: 'bad_photo' };
  return { ok: true, post: { kind, line, stuck_reason, help_need, minutes, photo, brief_ok: !!input.brief_ok } };
}

/* ------------------------------------------------------------- the building */
/* How far the town has got: floors done (the roof is the last "floor" when
   config.roof), how far into the next, and whether it has topped out. Town
   minutes and habit drops come from bd_town; the rule is the config's. */
export function floorsOf(town, config = BUILD_CONFIG) {
  /* data/build-config.json spells it HOURS_PER_FLOOR (Stephen edits that file by hand) */
  const per = Math.max(1, Number(config.hours_per_floor || config.HOURS_PER_FLOOR) || BUILD_CONFIG.hours_per_floor) * 60;
  const floors = Math.max(1, Number(config.floors) || BUILD_CONFIG.floors) + (config.roof === false ? 0 : 1);
  const total = Math.max(0, Number(town && town.total_minutes) || 0);
  const drops = Math.max(0, Number(town && town.habit_drops) || 0) * Math.max(0, Number(config.habit_drop_minutes) || 0);
  const build = total + drops;
  const done = Math.min(floors, Math.floor(build / per));
  return { build_minutes: build, floors, floors_done: done, floor_progress: done >= floors ? 1 : (build - done * per) / per, topped_out: done >= floors };
}

/* --------------------------------------------------------------- the shift */
/* A shift lives on this phone (whoever is signed in) until it ends, so a
   reload, a dead battery or a lost signal never loses it. The record:

     { v, id, thing, step, started, state 'working'|'paused'|'missed',
       worked   ms banked in closed stretches
       seg      when the open working stretch began (working only)
       beat     the last heartbeat: the page was alive and visible then
       touch    the last touch
       checkpoint  worked ms at the last touch: what a missed whistle keeps
       whistle_at  when the whistle blows (15 to 30 minutes after the touch)
       whistles answered, missed_at, seed }

   The rules, in order (settle() applies them at any instant):
   - Working, the page alive: the stretch runs. Time after the whistle blows
     counts only once it is answered.
   - The whistle unanswered for its three minutes while the page was alive:
     missed. The crew knocks off and the shift keeps what it had at the last
     touch, nothing more, nothing erased.
   - The page went quiet (hidden without a pause(), asleep, killed) before
     that: paused, keeping time up to its last heartbeat (or the whistle, if
     it had blown). Coming back is a touch.
   - A shift never banks more than shiftMaxMinutes. */
const rnd = (random) => { const r = Number(random()); return Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999999) : 0.5; };
export const whistleGap = (random) => SHIFT.whistleMinMs + Math.floor(rnd(random) * (SHIFT.whistleMaxMs - SHIFT.whistleMinMs + 1));
const capMs = (rules) => rules.limits.shiftMaxMinutes * 60000;

export function newShift({ id, thing = null, step = '', now, random, rules = BUILD_RULES }) {
  const s = clean(step).slice(0, rules.limits.stepMax);
  return { v: 1, id, thing, step: s, started: now, state: 'working', worked: 0, seg: now, beat: now, touch: now, checkpoint: 0,
    whistle_at: now + whistleGap(random), whistles: 0, missed_at: null, seed: Math.floor(rnd(random) * 1000) };
}

export function settle(rec, now, rules = BUILD_RULES) {
  if (!rec || rec.state !== 'working') return rec;
  const r = { ...rec };
  const alive = now - r.beat <= SHIFT.aliveMs;
  const end = alive ? now : r.beat;
  const deadline = r.whistle_at + SHIFT.windowMs;
  if (end >= deadline) {
    r.state = 'missed'; r.worked = r.checkpoint; r.seg = null; r.missed_at = deadline;
  } else if (!alive) {
    r.worked += Math.max(0, Math.min(end, r.whistle_at) - r.seg); r.seg = null; r.state = 'paused';
  }
  if (r.worked > capMs(rules)) r.worked = capMs(rules);
  if (r.checkpoint > capMs(rules)) r.checkpoint = capMs(rules);
  return r;
}

/* What the tab draws, at `now`:
     state      'working' | 'whistle' (blowing, answer by whistle_ends) | 'paused' | 'missed'
     worked_ms  banked so far, the clock on the end screen; minutes, the same whole
     task       the job your builder is on (BUILD_RULES.tasks), for the site and presence */
export function shiftStatus(rec, now, rules = BUILD_RULES) {
  const r = settle(rec, now, rules);
  if (!r) return null;
  let worked = r.worked;
  let state = r.state;
  if (state === 'working') {
    worked += Math.max(0, Math.min(now, r.whistle_at) - r.seg);
    if (now >= r.whistle_at) state = 'whistle';
  }
  worked = Math.min(worked, capMs(rules));
  const tasks = rules.tasks;
  return { id: r.id, thing: r.thing, step: r.step, started: r.started, state, worked_ms: worked, minutes: Math.floor(worked / 60000),
    whistle_at: r.whistle_at, whistle_ends: r.whistle_at + SHIFT.windowMs, whistles: r.whistles, missed_at: r.missed_at,
    task: tasks[(r.seed + Math.floor(worked / SHIFT.taskMs)) % tasks.length] };
}

/* A touch: the whistle answered (or the phone touched before it blew), or
   the page back in front. Restarts the whistle's 15 to 30 minutes. */
export function touchShift(rec, now, random, rules = BUILD_RULES) {
  const r = settle(rec, now, rules);
  if (!r || r.state === 'missed') return r;
  const out = { ...r };
  if (out.state === 'working') {
    if (now >= out.whistle_at) out.whistles++;
    out.worked = Math.min(out.worked + Math.max(0, now - out.seg), capMs(rules));
  }
  out.state = 'working';
  out.seg = now; out.beat = now; out.touch = now; out.checkpoint = out.worked;
  out.whistle_at = now + whistleGap(random);
  return out;
}

/* The page went to the back: tools down. Time stops; a whistle that was
   blowing and not answered gives back the minutes since it blew. */
export function pauseShift(rec, now, rules = BUILD_RULES) {
  const r = settle(rec, now, rules);
  if (!r || r.state !== 'working') return r;
  return { ...r, state: 'paused', worked: Math.min(r.worked + Math.max(0, Math.min(now, r.whistle_at) - r.seg), capMs(rules)), seg: null };
}

/* The heartbeat: the page is alive and in front. */
export function beatShift(rec, now, rules = BUILD_RULES) {
  const r = settle(rec, now, rules);
  if (!r || r.state !== 'working') return r;
  return { ...r, beat: now };
}

/* Ending it is a touch (it answers a blowing whistle), then the clock stops. */
export function finishShift(rec, now, random, rules = BUILD_RULES) {
  const r = touchShift(rec, now, random, rules);
  if (!r) return null;
  return { id: r.id, thing: r.thing, step: r.step, started: r.started, ended: Math.max(now, r.started), minutes: Math.floor(Math.min(r.worked, capMs(rules)) / 60000), missed: r.state === 'missed' };
}

/* ------------------------------------------------------------------ words */
const MESSAGES = {
  not_signed_in: 'Sign in first.',
  off: 'The Build opens soon.',
  offline: 'Couldn’t reach the server. Try again in a moment.',
  bad_title: 'A name for your thing, up to 80 letters.',
  bad_why: 'Why it matters, in up to 280 letters.',
  bad_for: 'Who it’s for, in up to 80 letters.',
  bad_partner: 'Who’s in it with you, in up to 80 letters.',
  bad_date: 'That date doesn’t look right.',
  no_thing: 'Name your thing first.',
  bad_status: 'That didn’t work.',
  bad_look: 'Pick a hat and a vest.',
  bad_name: 'A first name, up to 32 letters, no @.',
  no_name: 'Add a first name to your builder first.',
  bad_minutes: 'Between a minute and twelve hours.',
  bad_day: 'Pick a day in the last week.',
  bad_shift: 'That shift didn’t add up.',
  too_much: 'That’s more hours than the day had.',
  bad_kind: 'Pick what kind of post it is.',
  bad_line: 'One line, up to 200 letters.',
  bad_stuck: 'That didn’t work.',
  bad_photo: 'That photo couldn’t be used. Try another.',
  rate_day: 'That’s a lot of posts for one day. Try again tomorrow.',
  rate_offers: 'That’s a lot of offers for one day. Try again tomorrow.',
  rate_reports: 'That’s a lot of reports for one day.',
  banned: 'Posting is off for this account.',
  not_found: 'That’s gone.',
  own_post: 'That one’s yours.',
  not_stuck: 'Only Stuck posts take offers.',
  already_offered: 'You’ve already offered.',
  bad_help_line: 'One line, up to 140 letters.',
  already_answered: 'Already answered.',
  bad_reason: 'Pick a reason.',
  already_reported: 'Already reported. Thanks.',
  bad_target: 'That didn’t work.',
  already_synced: 'This account already has a thing and hours.',
  bad_import: 'Couldn’t move this phone’s hours.',
  no_shift: 'No shift running.',
  shift_running: 'A shift is already running.',
  bad_task: 'That didn’t work.',
  bad_range: 'Couldn’t load that stretch.',
};
export const message = (code) => MESSAGES[code] || MESSAGES.offline;

/* ------------------------------------------------------ talking to Supabase */
/* One server, live: a POST to PostgREST as the reader (with their token
   when signed in), the way boards.js does it. Resolves { ok, data } or
   { ok: false, error }; a function that does not exist yet (bd-SETUP.sql not
   pasted) is 'off'. fetch is passed in so the tests can stand in for it. */
export function liveServer({ url, key, user, token, fetch: f }) {
  const doFetch = f || ((...a) => globalThis.fetch(...a));
  const srv = {
    state: 'unknown',
    call(fn, args) {
      const signedIn = !!(user && user());
      return Promise.resolve(signedIn ? token() : null).then((tok) => {
        if (signedIn && !tok) throw new Error('no token');
        return doFetch(url + '/rest/v1/rpc/' + fn, {
          method: 'POST',
          headers: Object.assign({ apikey: key, 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}),
          body: JSON.stringify(args || {}),
        });
      }).then((r) => r.text().then((t) => {
        let j = null;
        try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
        if (r.ok) { srv.state = 'live'; return { ok: true, data: j }; }
        if (r.status === 404 && j && j.code === 'PGRST202') { srv.state = 'off'; return { ok: false, error: 'off' }; }
        if (r.status === 401) return { ok: false, error: 'not_signed_in' };
        const code = j && typeof j.message === 'string' && /^[a-z_]+$/.test(j.message) ? j.message : 'offline';
        if (code !== 'offline') srv.state = 'live';
        return { ok: false, error: code };
      }), () => ({ ok: false, error: 'offline' }));
    },
    /* The intro email (supabase/functions/bd-intro): fire and forget. The
       function trusts nothing from here; it sends only for an accepted
       offer that has not had its email. */
    intro(helpId) {
      try {
        doFetch(url + '/functions/v1/bd-intro', { method: 'POST',
          headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ help_id: helpId }) }).catch(() => {});
      } catch (e) { /* no network: the next sweep sends it */ }
    },
  };
  return srv;
}

/* A FakeBuild (or LocalBuild) as a server: same answers, as promises. */
export function fakeServer(fake, uid) {
  return {
    state: 'demo',
    call(fn, args) {
      return Promise.resolve().then(() => ({ ok: true, data: fake.as(uid ? uid() : null).call(fn, args || {}) }))
        .catch((e) => ({ ok: false, error: (e && e.code) || 'offline' }));
    },
    intro(helpId) { if (typeof fake.sendIntro === 'function') fake.sendIntro(helpId); },
  };
}

/* ------------------------------------------------------------ the API */
/* The doors a phone answers itself when nobody is signed in, and the ones
   anyone may ask the server. Everything else needs a person. */
export const LOCAL_DOORS = new Set(['bd_rules', 'bd_thing_get', 'bd_thing_set', 'bd_thing_status', 'bd_shift_add', 'bd_log_add',
  'bd_my_record', 'bd_shelf', 'bd_builder_get', 'bd_builder_set']);
export const PUBLIC_DOORS = new Set(['bd_rules', 'bd_town', 'bd_feed', 'bd_public_things']);
const SHIFT_KEY = 'allday-build-shift';
const OUTBOX_KEY = 'allday-build-outbox';

export function memoryStorage(initial = null) {
  let v = initial;
  return { get: () => v, set: (x) => { v = x; return true; }, remove: () => { v = null; return true; } };
}
const uuid = (random) => {
  try { if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* older phones */ }
  const h = () => Math.floor(rnd(random) * 16).toString(16);
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, h);
};

/* server:   the server, live (liveServer) or the demo's (fakeServer)
   local:    a fakeServer over this phone's LocalBuild, for signed out
   uid():    the signed-in reader's id, or null
   storage:  { shift, outbox }: where the running shift and unsent hours wait
   config:   data/build-config.json */
export function createBuild({ server, local, uid = () => null, storage = {}, config = BUILD_CONFIG, now = () => Date.now(), random = Math.random, rules = BUILD_RULES } = {}) {
  const shiftStore = storage.shift || memoryStorage();
  const outStore = storage.outbox || memoryStorage();
  const cfg = { ...BUILD_CONFIG, ...(config || {}), season: { ...BUILD_CONFIG.season, ...((config && config.season) || {}) } };
  const fail = (error) => ({ ok: false, error, message: message(error) });
  const who = () => { const u = uid(); return u ? (typeof u === 'object' ? u.id : u) : null; };

  /* one call, to whoever answers it */
  function call(fn, args) {
    if (who()) return server.call(fn, args);
    if (LOCAL_DOORS.has(fn) && local) return local.call(fn, args);
    if (PUBLIC_DOORS.has(fn)) return server.call(fn, args);
    return Promise.resolve({ ok: false, error: 'not_signed_in' });
  }
  const ask = (fn, args, shape) => call(fn, args).then((r) => (r.ok ? Object.assign({ ok: true }, shape ? shape(r.data) : {}) : fail(r.error)));

  /* ------------------------------------------------ the shift on this phone */
  const readJson = (st) => { try { const raw = st.get(); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };
  const writeJson = (st, v) => { try { return v == null ? st.remove() : st.set(JSON.stringify(v)); } catch (e) { return false; } };
  let mem = undefined;   // the shift, when storage refuses to keep it
  const loadShift = () => {
    if (mem !== undefined) return mem;
    const r = readJson(shiftStore);
    return r && r.v === 1 && typeof r.id === 'string' && Number.isFinite(r.started) ? r : null;
  };
  const saveShift = (r) => { if (writeJson(shiftStore, r) === false) mem = r; else mem = undefined; };

  /* hours not yet on the server: a shift or a log that ended offline (or
     signed out, for later). Each carries its own id, so sending twice is
     harmless (bd_shift_add answers the first). */
  const outbox = () => { const o = readJson(outStore); return Array.isArray(o) ? o : []; };
  const setOutbox = (o) => writeJson(outStore, o.length ? o : null);
  function send(item) {
    if (item.kind === 'logged') {
      return call('bd_log_add', { p_client_id: item.client_id, p_minutes: item.minutes, p_note: item.note, p_day: item.day, p_thing: item.thing });
    }
    return call('bd_shift_add', { p_client_id: item.client_id, p_started: new Date(item.started).toISOString(), p_ended: new Date(item.ended).toISOString(),
      p_minutes: item.minutes, p_step: item.step, p_note: item.note, p_thing: item.thing });
  }
  /* Send what waits. A refusal that is not about the network is final (the
     server will never take it), so it leaves the box; offline stays. */
  let flushing = null;
  function flush() {
    if (flushing) return flushing;
    const box = outbox();
    if (!box.length) return Promise.resolve();
    flushing = box.reduce((p, item) => p.then(() => send(item).then((r) => {
      if (r.ok || (r.error !== 'offline' && r.error !== 'not_signed_in' && r.error !== 'off')) setOutbox(outbox().filter((x) => x.client_id !== item.client_id));
    })), Promise.resolve()).then(() => { flushing = null; }, () => { flushing = null; });
    return flushing;
  }

  let lastBeat = 0;
  function presence(task) {
    if (!who()) return;
    lastBeat = now();
    call('bd_presence_beat', { p_task: task }).catch(() => {});
  }
  function presenceEnd() { if (who()) call('bd_presence_end', {}).catch(() => {}); lastBeat = 0; }

  const status = () => shiftStatus(loadShift(), now(), rules);
  const shiftOk = () => ({ ok: true, shift: status() });

  const shift = {
    status,
    /* A knocked-off shift still on the phone is banked first (Start is
       "they walk back on"); a working or paused one must be ended or resumed. */
    start(step) {
      const cur = loadShift();
      if (cur && settle(cur, now(), rules).state !== 'missed') return Promise.resolve(fail('shift_running'));
      return (cur ? shift.end({}) : Promise.resolve()).then(() => thing.get()).then((t) => {
        const r = newShift({ id: uuid(random), thing: t.ok && t.thing ? t.thing.id : null, step, now: now(), random, rules });
        saveShift(r);
        const s = status();
        presence(s.task);
        return { ok: true, shift: s };
      });
    },
    heartbeat(o = {}) {
      const r = loadShift();
      if (!r) return Promise.resolve({ ok: true, shift: null });
      const next = beatShift(r, now(), rules);
      saveShift(next);
      const s = status();
      if (s.state === 'working' || s.state === 'whistle') {
        if (now() - lastBeat >= SHIFT.beatMs - 10000) presence(rules.tasks.includes(o.task) ? o.task : s.task);
      } else if (s.state === 'missed') presenceEnd();
      return Promise.resolve(shiftOk());
    },
    touch() {
      const r = loadShift();
      if (!r) return Promise.resolve(fail('no_shift'));
      saveShift(touchShift(r, now(), random, rules));
      return Promise.resolve(shiftOk());
    },
    whistleAnswered() { return shift.touch(); },
    pause() {
      const r = loadShift();
      if (!r) return Promise.resolve(fail('no_shift'));
      saveShift(pauseShift(r, now(), rules));
      return Promise.resolve(shiftOk());
    },
    resume() {
      const r = loadShift();
      if (!r) return Promise.resolve(fail('no_shift'));
      const next = touchShift(r, now(), random, rules);
      saveShift(next);
      const s = status();
      if (s.state === 'working') presence(s.task);
      return Promise.resolve({ ok: true, shift: s });
    },
    recover() {
      const r = loadShift();
      if (!r) { flush(); return Promise.resolve({ ok: true, shift: null }); }
      saveShift(settle(r, now(), rules));
      flush();
      return Promise.resolve(shiftOk());
    },
    end({ note } = {}) {
      const r = loadShift();
      if (!r) return Promise.resolve(fail('no_shift'));
      const f = finishShift(r, now(), random, rules);
      saveShift(null);
      presenceEnd();
      if (f.minutes < 1) return Promise.resolve({ ok: true, shift: null, minutes: 0, missed: f.missed });
      const item = { client_id: f.id, kind: 'shift', thing: f.thing, started: f.started, ended: f.ended, minutes: f.minutes,
        step: f.step, note: clean(note).slice(0, rules.limits.noteMax), day: dayKey(f.started) };
      return keep(item).then((res) => Object.assign(res, { minutes: f.minutes, missed: f.missed }));
    },
  };

  /* Hours go to whoever answers now; if the network is down they wait in
     the outbox and the answer says so (shift.pending). */
  function keep(item) {
    setOutbox(outbox().filter((x) => x.client_id !== item.client_id).concat([item]));
    return send(item).then((r) => {
      if (r.ok) {
        setOutbox(outbox().filter((x) => x.client_id !== item.client_id));
        return { ok: true, shift: r.data };
      }
      if (r.error === 'offline' || r.error === 'off') {
        return { ok: true, shift: { id: null, client_id: item.client_id, kind: item.kind, minutes: item.minutes, day: item.day, pending: true } };
      }
      setOutbox(outbox().filter((x) => x.client_id !== item.client_id));
      return fail(r.error);
    });
  }

  function logIt({ minutes, note, day } = {}) {
    const m = Number(minutes);
    if (!Number.isInteger(m) || m < 1 || m > rules.limits.logMaxMinutes) return Promise.resolve(fail('bad_minutes'));
    const today = dayKey(now());
    const d = day == null || day === '' ? today : String(day);
    if (!isKey(d) || d > today || d < addDays(today, -rules.limits.logBackDays)) return Promise.resolve(fail('bad_day'));
    return thing.get().then((t) => keep({ client_id: uuid(random), kind: 'logged', thing: t.ok && t.thing ? t.thing.id : null,
      minutes: m, note: clean(note).slice(0, rules.limits.noteMax), day: d }));
  }

  /* ------------------------------------------------------------ the thing */
  const thing = {
    get: () => ask('bd_thing_get', {}, (d) => ({ thing: d ? d.thing : null, done: (d && d.done) || [] })),
    set: (o = {}) => ask('bd_thing_set', { p_title: o.title ?? null, p_why: o.why ?? null, p_for: o.for_whom ?? null, p_partner: o.partner ?? null,
      p_target: o.target_date === undefined ? null : (o.target_date === null ? '' : o.target_date), p_why_public: typeof o.why_public === 'boolean' ? o.why_public : null },
    (d) => ({ thing: d })),
    finish: () => ask('bd_thing_status', { p_status: 'done' }, (d) => ({ thing: d })),
    pause: () => ask('bd_thing_status', { p_status: 'paused' }, (d) => ({ thing: d })),
    resume: () => ask('bd_thing_status', { p_status: 'active' }, (d) => ({ thing: d })),
    listPublic: (o = {}) => ask('bd_public_things', { p_limit: o.limit || rules.limits.publicThingsMax }, (d) => ({ things: d || [] })),
  };
  const things = { public: (o) => thing.listPublic(o) };

  /* ---------------------------------------------------------------- posts */
  const post = {
    create(o = {}) {
      const c = checkPost(rules, o);
      if (!c.ok) return Promise.resolve(fail(c.error));
      return ask('bd_post_create', { p_kind: c.post.kind, p_line: c.post.line, p_photo: c.post.photo, p_minutes: c.post.minutes,
        p_stuck_reason: c.post.stuck_reason, p_help_need: c.post.help_need, p_brief_ok: c.post.brief_ok, p_shift: o.shift || null }, (d) => ({ post: d }));
    },
    remove: (id) => ask('bd_post_delete', { p_post: id }),
  };
  const feed = {
    list: (o = {}) => ask('bd_feed', { p_before: o.before || null, p_limit: o.limit || rules.limits.feedDefault,
      p_kind: o.kind || null, p_brief: o.brief ? true : null }, (d) => ({ posts: d || [] })),
  };
  const nice = { toggle: (id) => ask('bd_nice', { p_post: id }, (d) => ({ nice: d.nice, niced: d.niced })) };
  const help = {
    offer(postId, line) {
      const l = clean(line);
      if (!l || l.length > rules.limits.helpLineMax) return Promise.resolve(fail('bad_help_line'));
      return ask('bd_help_offer', { p_post: postId, p_line: l }, (d) => ({ help: d }));
    },
    respond(helpId, yes) {
      return ask('bd_help_respond', { p_help: helpId, p_yes: !!yes }, (d) => ({ help: d })).then((r) => {
        if (r.ok && r.help && r.help.status === 'accepted' && server.intro) server.intro(helpId);
        return r;
      });
    },
    list: () => ask('bd_help_list', {}, (d) => ({ incoming: (d && d.incoming) || [], outgoing: (d && d.outgoing) || [] })),
  };
  const target = (t) => (t && t.post ? ['post', t.post] : t && t.help ? ['help', t.help] : [null, null]);
  function report(t, reason) {
    const [k, id] = target(t);
    if (!k) return Promise.resolve(fail('bad_target'));
    return ask('bd_report', { p_kind: k, p_target: id, p_reason: reason }, (d) => ({ hidden: !!(d && d.hidden) }));
  }
  const block = {
    add(t) { const [k, id] = target(t); return k ? ask('bd_block', { p_kind: k, p_target: id }) : Promise.resolve(fail('bad_target')); },
    list: () => ask('bd_blocks_get', {}, (d) => ({ blocks: d || [] })),
    remove: (id) => ask('bd_unblock', { p_block: id }),
  };

  /* ---------------------------------------------------- the town and you */
  const town = {
    get() {
      return call('bd_town', { p_since: cfg.season.starts || null }).then((r) => {
        if (!r.ok) return fail(r.error);
        const t = r.data || {};
        const f = floorsOf(t, cfg);
        return { ok: true, town: { total_minutes: t.total_minutes || 0, week_minutes: t.week_minutes || 0, habit_drops: t.habit_drops || 0,
          posts_lit: t.posts_lit || 0, windows_lit: t.posts_lit || 0, on_shift_count: t.on_shift_count || 0, on_shift: t.on_shift || [],
          ...f, season: cfg.season } };
      });
    },
  };
  const record = {
    get() {
      const to = dayKey(now()), from = addDays(to, -(rules.limits.recordDays - 1));
      return flush().then(() => call('bd_my_record', { p_from: from, p_to: to })).then((r) => {
        if (!r.ok) return fail(r.error);
        /* hours still waiting to be sent count on your own record already */
        const by = new Map(((r.data && r.data.days) || []).map((d) => [d.day, { ...d }]));
        for (const x of outbox()) {
          if (x.day < from || x.day > to) continue;
          const d = by.get(x.day) || { day: x.day, minutes: 0, logged: 0 };
          d.minutes += x.minutes; if (x.kind === 'logged') d.logged += x.minutes;
          by.set(x.day, d);
        }
        const days = [...by.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
        const weeks = new Map();
        for (const d of days) { const w = weekStart(d.day); weeks.set(w, (weeks.get(w) || 0) + d.minutes); }
        const since = cfg.season.starts;
        return { ok: true, days, weeks: [...weeks.entries()].map(([week, minutes]) => ({ week, minutes })),
          total_minutes: days.reduce((a, d) => a + d.minutes, 0),
          season_minutes: days.filter((d) => !since || d.day >= since).reduce((a, d) => a + d.minutes, 0) };
      });
    },
  };
  const shelf = { get: (thingId) => ask('bd_shelf', { p_thing: thingId || null }, (d) => ({ posts: d || [] })) };
  const builder = {
    get: () => ask('bd_builder_get', {}, (d) => ({ builder: d })),
    set: (o = {}) => ask('bd_builder_set', { p_hat: o.hat ?? null, p_vest: o.vest ?? null, p_first_name: o.first_name ?? null,
      p_first_name_public: typeof o.first_name_public === 'boolean' ? o.first_name_public : null }, (d) => ({ builder: d })),
  };

  /* At sign-in: this phone's thing, hours and look move to the account
     once, then the phone forgets them. An account that already has a thing
     or hours keeps its own, and the phone keeps its copy. */
  function importLocal() {
    if (!who() || !local || !local.snapshot) return Promise.resolve(fail('not_signed_in'));
    const snap = local.snapshot();
    if (!snap) return Promise.resolve({ ok: true, moved: false });
    return call('bd_import_local', { p_data: snap }).then((r) => {
      if (!r.ok) return fail(r.error);
      local.forget();
      return { ok: true, moved: true };
    });
  }

  return {
    thing, things, shift, logIt, post, feed, nice, help, report, block, town, record, shelf, builder, importLocal, flush,
    deleteMine: () => ask('bd_delete_me', {}),
    status: () => server.state || 'unknown',
    config: cfg,
    rules,
  };
}
