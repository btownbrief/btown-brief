/* boards-core.js — the rules every board follows, in one place.

   No DOM, no fetch, no clock: time is an argument. Three things obey these
   rules and must agree: this file (the compose sheet checks a post before it
   is sent), supabase/nn-SETUP.sql (the server checks it again, because the
   anon key is public), and js/boards-fake.js (the demo and the tests).

   The RULES object below is copied, as JSON, into nn_rules() in the SQL.
   scripts/test-boards-core.mjs fails if the two ever differ, so a change
   here is a change there: edit both, run the test.

   Vocabulary. A BOARD is one tab's shelf of reader posts (vintage, art,
   people, watch). A KIND is the sort of post on that board ("spotted",
   "swap"). META is the kind's own small fields (size, price, shop), each
   with a type the server checks. A post with a photo sends the picture
   through the fleet's photo queue (photos-lib.js, photo-admin.html); the
   post shows its photo only once that queue approves it. */

export const RULES = {
  version: 1,
  limits: {
    nameMax: 32,
    titleMax: 80,
    bodyMax: 600,
    placeMax: 80,
    metaKeysMax: 8,
    metaTextMax: 80,
    postsPerDay: 20,
    waitingMax: 5,
    reportsToHide: 2,
    reportsPerDay: 10,
    listDefault: 30,
    listMax: 60,
    expiredKeepDays: 7,
    deletedKeepDays: 30,
  },
  neighborhoods: ['downtown', 'old-north-end', 'new-north-end', 'south-end', 'hill', 'waterfront', 'winooski',
    'south-burlington', 'essex', 'shelburne', 'colchester', 'elsewhere'],
  archetypes: ['new', 'regular', 'trail', 'games'],
  reasons: ['spam', 'unkind', 'unsafe', 'other'],
  boards: {
    people: {
      premod: false,
      kinds: { plan: { days: 14, photo: 'none', needs: ['when'] } },
      meta: {
        when: { type: 'text', max: 60 },
        arch: { type: 'enum', values: ['new', 'regular', 'trail', 'games'] },
        spots: { type: 'int', min: 1, max: 50 },
      },
    },
    vintage: {
      premod: false,
      kinds: {
        spotted: { days: 21, photo: 'optional', needs: ['shop'] },
        swap: { days: 21, photo: 'optional', needs: ['want'] },
      },
      meta: {
        shop: { type: 'text', max: 60 },
        size: { type: 'text', max: 12 },
        price: { type: 'int', min: 0, max: 10000 },
        want: { type: 'text', max: 80 },
      },
    },
    art: {
      premod: false,
      kinds: {
        photo: { days: null, photo: 'required', needs: [] },
        art: { days: null, photo: 'required', needs: [] },
        notice: { days: 30, photo: 'none', needs: [] },
      },
      meta: {
        medium: { type: 'text', max: 40 },
        shirt: { type: 'enum', values: ['yes', 'no'] },
      },
    },
    watch: {
      premod: false,
      kinds: {
        rating: { days: null, photo: 'none', needs: ['stars'] },
        pick: { days: 30, photo: 'none', needs: [] },
      },
      meta: {
        year: { type: 'int', min: 1888, max: 2100 },
        stars: { type: 'int', min: 1, max: 5 },
        where: { type: 'text', max: 40 },
      },
    },
  },
};

/* Words people see, keyed the same way. Not part of the server's copy. */
export const NEIGHBORHOOD_LABELS = {
  downtown: 'Downtown', 'old-north-end': 'Old North End', 'new-north-end': 'New North End', 'south-end': 'South End',
  hill: 'Hill Section / UVM', waterfront: 'Waterfront', winooski: 'Winooski', 'south-burlington': 'South Burlington',
  essex: 'Essex / Williston', shelburne: 'Shelburne', colchester: 'Colchester', elsewhere: 'Elsewhere in Chittenden',
};
export const ARCHETYPE_LABELS = { new: 'New in town', regular: 'Weeknight regular', trail: 'Trail person', games: 'Game night' };
export const REASON_LABELS = { spam: 'Spam, or not from around here', unkind: 'Rude or unkind', unsafe: 'Not safe', other: 'Something else' };
export const BOARD_LABELS = { people: 'People', vintage: 'Vintage', art: 'Art', watch: 'Watchlist' };

/* Every refusal is a short code, the same from the server, the fake and the
   checks below. message() turns one into a sentence a reader can act on. */
export const MESSAGES = {
  not_signed_in: 'Sign in first. It’s in Settings, and it takes one email.',
  no_name: 'Add your first name before you post. Neighbors see it on your post.',
  bad_name: 'A first name, up to 32 characters, with no @ in it.',
  bad_neighborhood: 'Pick a neighborhood from the list, or none.',
  bad_archetype: 'Pick one of the four, or none.',
  bad_board: 'That board isn’t open.',
  bad_kind: 'That kind of post isn’t open on this board.',
  bad_title: 'A title, up to 80 characters.',
  bad_body: 'Keep it under 600 characters.',
  bad_place: 'Keep the place under 80 characters.',
  bad_meta: 'One of the details isn’t right. Check the fields and try again.',
  needs_meta: 'Fill in the required details first.',
  no_consent: 'Tick the box first: we only show photos you took and said we could use.',
  bad_photo: 'That photo didn’t go through. Try another one.',
  photo_required: 'This one needs a photo.',
  photo_not_allowed: 'This kind of post doesn’t take a photo.',
  rate_day: 'That’s 20 posts today. Try again tomorrow.',
  rate_waiting: 'You have 5 posts waiting for a look. Give those a day first.',
  banned: 'Posting is switched off for this account.',
  not_found: 'That post has gone.',
  own_post: 'You can’t report your own post. Delete it instead.',
  already_reported: 'You’ve already reported this one. Thanks.',
  rate_reports: 'That’s a lot of reports today. Thanks; we’ll take it from here.',
  bad_reason: 'Pick a reason.',
  bad_voter: 'Couldn’t count that vote.',
  off: 'Posting is coming soon. Everything else here works.',
  offline: 'Couldn’t reach the boards. Try again in a moment.',
};
export const message = (code) => MESSAGES[code] || MESSAGES.offline;

/* ---------------------------------------------------------------- text */
/* The server runs the same three steps with regexp_replace, in this order:
   drop control characters, drop links, squeeze the spaces. A post is plain
   words; links in a reader post are how spam arrives. */
const CONTROL = /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const LINKS = /https?:\/\/\S+|www\.\S+/gi;

export function clean(s, multiline) {
  let t = String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(CONTROL, '').replace(LINKS, '');
  t = multiline ? t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n') : t.replace(/\s+/g, ' ');
  return t.trim();
}
/* Lengths in characters as a person counts them (an emoji is one), which is
   what Postgres's char_length counts too. */
export const len = (s) => [...String(s)].length;

/* -------------------------------------------------------------- profile */
export function checkProfile(rules, input) {
  const name = clean(input && input.display_name);
  if (!name || len(name) > rules.limits.nameMax || name.includes('@')) return { ok: false, error: 'bad_name' };
  const hood = input.neighborhood || null;
  if (hood && !rules.neighborhoods.includes(hood)) return { ok: false, error: 'bad_neighborhood' };
  const arch = input.archetype || null;
  if (arch && !rules.archetypes.includes(arch)) return { ok: false, error: 'bad_archetype' };
  return { ok: true, profile: { display_name: name, neighborhood: hood, archetype: arch } };
}

/* ---------------------------------------------------------------- posts */
function checkMeta(rules, board, kindRule, meta) {
  const schema = rules.boards[board].meta;
  if (meta == null) meta = {};
  if (typeof meta !== 'object' || Array.isArray(meta)) return { error: 'bad_meta' };
  const keys = Object.keys(meta);
  if (keys.length > rules.limits.metaKeysMax) return { error: 'bad_meta' };
  const out = {};
  for (const k of keys) {
    const f = schema[k];
    if (!f) return { error: 'bad_meta' };
    const v = meta[k];
    if (v == null || v === '') continue;          // an empty optional field is no field
    if (f.type === 'text') {
      if (typeof v !== 'string') return { error: 'bad_meta' };
      const t = clean(v);
      if (len(t) > (f.max || rules.limits.metaTextMax)) return { error: 'bad_meta' };
      if (t) out[k] = t;
    } else if (f.type === 'int') {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < f.min || v > f.max) return { error: 'bad_meta' };
      out[k] = v;
    } else if (f.type === 'enum') {
      if (!f.values.includes(v)) return { error: 'bad_meta' };
      out[k] = v;
    } else return { error: 'bad_meta' };
  }
  for (const k of kindRule.needs || []) if (out[k] == null) return { error: 'needs_meta' };
  return { meta: out };
}

/* A post as typed, checked the way the server checks it, in the server's
   order, so both refuse the same post with the same code. The photo is a
   storage path from the photo queue, or null. */
export const PHOTO_PATH = /^submissions\/[A-Za-z0-9-]+\.jpg$/;
export function checkPost(rules, board, input) {
  const b = rules.boards[board];
  if (!b) return { ok: false, error: 'bad_board' };
  const kindRule = input && b.kinds[input.kind];
  if (!kindRule) return { ok: false, error: 'bad_kind' };
  const title = clean(input.title);
  if (!title || len(title) > rules.limits.titleMax) return { ok: false, error: 'bad_title' };
  const body = clean(input.body, true);
  if (len(body) > rules.limits.bodyMax) return { ok: false, error: 'bad_body' };
  const place = clean(input.place);
  if (len(place) > rules.limits.placeMax) return { ok: false, error: 'bad_place' };
  const m = checkMeta(rules, board, kindRule, input.meta);
  if (m.error) return { ok: false, error: m.error };
  const photo = input.photo_path || null;
  if (photo && kindRule.photo === 'none') return { ok: false, error: 'photo_not_allowed' };
  if (!photo && kindRule.photo === 'required') return { ok: false, error: 'photo_required' };
  if (photo && !PHOTO_PATH.test(photo)) return { ok: false, error: 'bad_photo' };
  return { ok: true, post: { kind: input.kind, title, body, place, meta: m.meta, photo_path: photo } };
}

/* -------------------------------------------------------------- the clock */
const DAY = 86400000;
/* When a new post stops showing, or null for never. */
export function expiresAt(rules, board, kind, nowMs) {
  const d = rules.boards[board] && rules.boards[board].kinds[kind] && rules.boards[board].kinds[kind].days;
  return d ? nowMs + d * DAY : null;
}
export const startsPending = (rules, board) => !!(rules.boards[board] && rules.boards[board].premod);
export const photoRequired = (rules, board, kind) => !!(rules.boards[board] && rules.boards[board].kinds[kind] && rules.boards[board].kinds[kind].photo === 'required');

/* The two posting limits. `today` counts the reader's posts in the last 24
   hours; `waiting` counts theirs not yet showing: held for a look, or with
   a photo the photo queue has not approved. */
export function rateError(rules, today, waiting) {
  if (today >= rules.limits.postsPerDay) return 'rate_day';
  if (waiting >= rules.limits.waitingMax) return 'rate_waiting';
  return null;
}

/* "19d left", "8h left", "ends soon"; null when the post never expires. */
export function leftLabel(expiresMs, nowMs) {
  if (expiresMs == null) return null;
  const left = expiresMs - nowMs;
  if (left <= 0) return 'ended';
  if (left < 3600000) return 'ends soon';
  if (left < DAY) return Math.floor(left / 3600000) + 'h left';
  return Math.floor(left / DAY) + 'd left';
}

/* An anonymous voter is the device's btown-player-id; a signed-in one is
   their account, written u:<id> so the two can never collide. */
export const PLAYER_ID = /^[A-Za-z0-9_-]{6,64}$/;
export const voterFor = (uid, player) => (uid ? 'u:' + uid : PLAYER_ID.test(String(player || '')) ? String(player) : null);
