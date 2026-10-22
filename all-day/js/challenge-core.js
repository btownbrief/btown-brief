/* challenge-core.js — the No-algorithm challenge's rules, with no page in
   them, so the tests can run them as they are (challenge.js draws them).

   The challenge (Stephen, 2026-10-22, launched in the newsletter of 10-23):
   five days of using All Day instead of the feeds that pick for you, a one
   tap check-in each day on how it felt, a roundup at the end, and a short
   form that tells Stephen what people missed, what would make them switch
   and which kind of person they are, so he can make versions of the app.

   Everything but the form stays on this phone, in one localStorage key. The
   form goes to Supabase through one security-definer door,
   nn_challenge_send (supabase/nn-CHALLENGE.sql), which checks it again with
   the same lists as below. Change both together; the spec reads the SQL file
   and fails when they differ. */

export const KEY = 'allday-challenge';
export const VERSION = 1;
export const DAYS = 5;
/* A newsletter reader (a Beehiiv link) who has not joined sees the invite
   card on the Wire until this Burlington date. The #challenge link itself
   works for good. */
export const INVITE_UNTIL = '2026-11-15';

/* how today felt without the feeds; 'caved' is the one that breaks the run */
export const FEELINGS = [
  ['great', 'Great'],
  ['calmer', 'Calmer'],
  ['same', 'Same'],
  ['itchy', 'Itchy'],
  ['caved', 'I caved'],
];
export const FEEL_LINE = {
  great: 'felt great', calmer: 'felt calmer', same: 'felt about the same', itchy: 'felt itchy', caved: 'was a slip',
};

export const MISSED = [
  ['friends', 'Friends’ posts'],
  ['messages', 'DMs and group chats'],
  ['groups', 'Facebook groups'],
  ['events', 'Event invites'],
  ['news', 'Breaking news'],
  ['creators', 'Creators I follow'],
  ['memes', 'Memes'],
  ['video', 'Short videos'],
  ['market', 'Marketplace'],
  ['sports', 'Sports'],
  ['nothing', 'Honestly, nothing'],
];

/* the kinds of person, so Stephen can make versions of the app for each */
export const ARCHETYPES = [
  ['nightowl', 'Night owl', 'Shows, bars, live music'],
  ['foodie', 'Foodie', 'New spots, deals, brunch'],
  ['newshound', 'News hound', 'City Hall and local news'],
  ['joiner', 'Joiner', 'Clubs, run groups, meetups'],
  ['outdoors', 'Outdoorsy', 'Lake, trails, sunsets'],
  ['homebody', 'Homebody', 'TV, podcasts, games'],
  ['maker', 'Thrifter or maker', 'Vintage, art, markets'],
  ['parent', 'Parent', 'Things to do with kids'],
  ['newcomer', 'New in town', 'Still learning Btown'],
  ['student', 'Student', 'Campus life, cheap fun'],
  ['other', 'None of these', ''],
];

/* the longest each written answer may be, in characters (the SQL's too) */
export const LIMITS = { missed_other: 300, switch_for: 1000, archetype_words: 120 };
export const SOURCES = ['newsletter', 'link', 'app'];

const FEEL_KEYS = new Set(FEELINGS.map((f) => f[0]));
const MISSED_KEYS = new Set(MISSED.map((m) => m[0]));
const ARCH_KEYS = new Set(ARCHETYPES.map((a) => a[0]));
const isKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);
const keyMs = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d, 12); };
export const daysBetween = (a, b) => Math.round((keyMs(b) - keyMs(a)) / 86400000);
export const addDays = (k, n) => new Date(keyMs(k) + n * 86400000).toISOString().slice(0, 10);

export function newId() {
  try { if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* older phones */ }
  return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8);
}
export const isId = (s) => typeof s === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(s);

/* Tidy a reader's words the way nn_challenge_clean does in SQL: control
   characters out, runs of spaces squeezed, trimmed, cut to the limit. */
export function clean(s, max, multiline) {
  let t = String(s == null ? '' : s).replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, ' ');
  t = t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return t.slice(0, max).trim();
}

/* A stored copy can be anything (an old version, a half write, devtools);
   this always hands back a usable state. */
export function normalize(raw) {
  const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const s = {
    v: VERSION,
    cid: isId(d.cid) ? d.cid : null,
    joined: isKey(d.joined) ? d.joined : null,
    source: SOURCES.includes(d.source) ? d.source : null,
    arrived: d.arrived === true,
    dismissed: d.dismissed === true,
    closed: d.closed === true,
    feel: {},
    sent: Number.isFinite(d.sent) ? d.sent : 0,
    draft: draftOf(d.draft),
  };
  if (s.joined && d.feel && typeof d.feel === 'object') {
    for (const k of Object.keys(d.feel)) {
      if (!isKey(k) || !FEEL_KEYS.has(d.feel[k])) continue;
      const n = daysBetween(s.joined, k);
      if (n >= 0 && n < DAYS) s.feel[k] = d.feel[k];
    }
  }
  return s;
}
function draftOf(x) {
  const d = x && typeof x === 'object' ? x : {};
  return {
    missed: Array.isArray(d.missed) ? [...new Set(d.missed.filter((m) => MISSED_KEYS.has(m)))] : [],
    missed_other: typeof d.missed_other === 'string' ? d.missed_other.slice(0, LIMITS.missed_other) : '',
    switch_for: typeof d.switch_for === 'string' ? d.switch_for.slice(0, LIMITS.switch_for) : '',
    archetype: ARCH_KEYS.has(d.archetype) ? d.archetype : '',
    archetype_words: typeof d.archetype_words === 'string' ? d.archetype_words.slice(0, LIMITS.archetype_words) : '',
  };
}

/* Which day of the five today is: 1 on the day you joined, 0 before you
   join, past DAYS once it is over. */
export const dayOf = (s, today) => (s.joined ? daysBetween(s.joined, today) + 1 : 0);

/* 'none' not joined; 'on' days one to five; 'done' once day five is logged
   or a sixth day has come */
export function phase(s, today) {
  const n = dayOf(s, today);
  if (!n) return 'none';
  if (n > DAYS || (n === DAYS && s.feel[today])) return 'done';
  return 'on';
}

/* Does the Wire show the card? A joined reader until they close the
   roundup; an invited one until they say Not now. */
export function showCard(s, today) {
  if (s.joined) return !s.closed;
  return s.arrived && !s.dismissed;
}

export function join(s, today, source) {
  return Object.assign({}, s, { joined: today, feel: {}, closed: false, dismissed: false,
    source: s.source || source || 'app', cid: s.cid || newId() });
}
export function quit(s) { return Object.assign({}, s, { joined: null, feel: {}, closed: false, dismissed: true }); }

/* Log today's feeling. Only today, and only inside the five days. */
export function checkIn(s, today, feel) {
  if (!FEEL_KEYS.has(feel)) return s;
  const n = dayOf(s, today);
  if (n < 1 || n > DAYS) return s;
  return Object.assign({}, s, { feel: Object.assign({}, s.feel, { [today]: feel }) });
}

/* The five days as the roundup draws them. */
export function summary(s, today) {
  const days = [];
  const n = dayOf(s, today);
  for (let i = 0; i < DAYS; i++) {
    const key = s.joined ? addDays(s.joined, i) : null;
    days.push({ day: i + 1, key, feel: key ? s.feel[key] || null : null, today: i + 1 === n, past: i + 1 < n });
  }
  const logged = days.filter((d) => d.feel).length;
  const free = days.filter((d) => d.feel && d.feel !== 'caved').length;
  return { day: n, days, logged, free };
}

/* The roundup's headline. */
export function headline(sum) {
  if (!sum.logged) return 'Your five days are up';
  if (sum.free === DAYS) return 'Five for five without the feeds';
  return 'You made it ' + sum.free + ' of ' + DAYS + ' days without the feeds';
}

/* The form, checked the way the server will check it. Returns the RPC's
   arguments, or { error } with the one thing to fix. */
export function feedbackArgs(s, draft, today) {
  if (!isId(s.cid)) return { error: 'no_id' };
  const d = draftOf(draft);
  const args = {
    p_cid: s.cid,
    p_source: s.source || 'app',
    p_joined: s.joined,
    p_day: Math.max(0, Math.min(DAYS + 1, dayOf(s, today))),
    p_feelings: summary(s, today).days.filter((x) => x.feel).map((x) => x.day + ':' + x.feel),
    p_missed: d.missed,
    p_missed_other: clean(d.missed_other, LIMITS.missed_other),
    p_switch_for: clean(d.switch_for, LIMITS.switch_for, true),
    p_archetype: d.archetype || null,
    p_archetype_words: clean(d.archetype_words, LIMITS.archetype_words),
  };
  if (!args.p_missed.length && !args.p_missed_other && !args.p_switch_for && !args.p_archetype && !args.p_archetype_words) return { error: 'empty' };
  return { args };
}
