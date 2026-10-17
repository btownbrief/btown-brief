/* People: find your people in Burlington. Top to bottom, and the chip row is
   the table of contents:

   - Who are you here as. The foundation's four archetypes as tiles (New in
     town, Weeknight regular, Trail person, Game night), and under them the
     longer list from Stephen's memo as tags: who you are (a student, just
     graduated, just moved here, older and looking, a woman or LGBTQ and
     finding your people) and what you are into (an athlete, a gamer, a
     runner, and the clubs page's other categories). The tile is the
     profile's archetype (boards.setProfile, so it shows on your plans) when
     you are signed in, and kept on this device either way. The what-you're-
     into tags are the profile's interests when you are signed in (nobody
     sees them there; the directory shows them only if you join it), and
     the who-you-are tags never leave this device. The rest of the tab
     reorders by them: plans for your kind of person first, then the clubs
     and mixers that fit.
   - Open to strangers this week. Readers' plans on the people board (kind
     "plan": what, when, where, how many spots, who it is for, a rough age
     band) sorted soonest first, past ones gone. "I'd go" is the board's vote,
     shown as a going count. Posting needs the email sign-in; reading and
     "I'd go" never do. The compose sheet's "I'm down to put this on Meetup"
     box marks the plan for Stephen's Meetup group (613 members), so he can
     find hosts (the boards desk lists them); the plans that ticked it are
     one chip away.
   - Mixers. Stephen's own Meetup events from all-day/data/whatnow.json:
     his group's URL (burlington-social-activites-group, misspelled at the
     source) or the Btown Brief / Btown Coffee Club name. The newsletter's
     golden rule is that his own events are never missed, so every one in
     the next two weeks shows, with no Meetup interest counts (the other
     golden rule). Then the clubs from data/clubs.json that fit the reader.
   - The quiz. Seven plain questions (weeknights or weekends, outside or in,
     a crowd or three people, talk or do, new here or settled, what you'd
     leave the house for, how you like to meet people). It never asks age,
     gender or orientation. It ends in a suggested archetype the reader can
     take or change, three clubs, the next mixers, and the community channel
     that fits.
   - The directory. Opt in, signed in: first name, neighborhood, archetype
     and what you're into. Never an email or an account id. You see who is
     in it once you are in it yourself; everyone sees how many.
   - Where the talking happens: one card with the two community channels and
     Telegram. Nothing on this tab is a chat.

   Data, live: posts through boards.js (the foundation, never Supabase
   directly), a plan's Meetup box and age band in its own fields (meta
   `meetup`, `ages`, from nn-ROUND2.sql), and the directory through the
   nn_people_ functions in supabase/nn-people.sql. Plans posted before
   round two keep their box and band in nn-people.sql's side table, which
   is still read (nn_people_plan_extras) and still written while the
   server's rules are round one's.

   ?demo=1 runs this same file on data/demo/people.json: its plans are seeded
   into the demo board, its events are moved to the reader's day, and the
   nn_people_ functions answer from a mirror below. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import * as boards from '../boards.js';
import { el, esc, safeHref, ICON, mark, section, chips, pills, button, cards } from '../ui.js';
import { RULES, ARCHETYPE_LABELS, NEIGHBORHOOD_LABELS, message, checkPost } from '../boards-core.js';

const KEY = 'people';
const CLUBS_URL = '../data/clubs.json';
const CLUBS_PAGE = '../clubs.html';
const MEETUP_GROUP = 'https://www.meetup.com/burlington-social-activites-group/';
/* Stephen's own Meetup calendar: Up For It's copy of the group's iCal,
   refreshed every six hours and a month deep (up-for-it/.github/workflows/
   meetup.yml). The events file only looks ten days ahead, so this is what
   makes "every one of his events in the next two weeks" true. */
const MEETUP_FEED = 'https://play.btownbrief.com/up-for-it/data/meetup.json';
const CH_FIND = 'https://www.btownbrief.com/community/channels/music';               // "Find Each Other"; the slug is historical
const CH_PLANS = 'https://www.btownbrief.com/community/channels/meetups-hangouts';   // "Plans & Meetups"
const TELEGRAM_URL = '../telegram.html';
const STORE_KEY = 'allday-people';
const DAY = 86400000;
const MIX_DAYS = 14;          // Stephen's events this far ahead, every one of them
const PAST_GRACE = 3 * 3600000;   // a plan stays up this long after its start
const CLUBS_SHOWN = 4;

/* The People table's rules. nn_people_rules() in supabase/nn-people.sql
   returns this same JSON; the test matrix fails when the two differ. Only
   these interests can ever reach the directory: the who-you-are tags never
   leave the phone. */
export const PEOPLE_RULES = {
  version: 1,
  interests: ['sports', 'running', 'outdoors', 'games', 'music', 'dance', 'books', 'making', 'languages', 'food'],
  interestsMax: 8,
  ages: ['twenties', 'thirties', 'forties', 'fifties', 'any'],
};

/* ---------------------------------------------------------------- words */
const ARCH = [
  ['new', ICON.pin, 'Arrived in the last year or so. Wants the lay of the land and three names.'],
  ['regular', ICON.clock, 'Has a bar, a trivia night and a standing Tuesday. Room for one more.'],
  ['trail', ICON.sun, 'Red Rocks before work, Camel’s Hump on Sunday. Coffee after.'],
  ['games', ICON.games, 'Board games, pickup games, the arcade. Competitive but kind.'],
];
const FOR = { new: 'new in town', regular: 'weeknight regulars', trail: 'trail people', games: 'game night people' };
/* who you are: kept on this device, never sent anywhere */
const WHO = [['student', 'A college student'], ['grad', 'Just graduated'], ['moved', 'Just moved here'], ['older', 'Older, looking for things to do'],
  ['women', 'A woman finding my people'], ['lgbtq', 'LGBTQ, finding my people']];
/* what you are into: the ones the directory may show, if you join it */
const INTO = [['sports', 'An athlete'], ['games', 'A gamer'], ['running', 'A runner'], ['outdoors', 'Outdoorsy'], ['music', 'Into live music'],
  ['dance', 'A dancer'], ['books', 'A reader'], ['making', 'A maker'], ['languages', 'Learning a language'], ['food', 'Into food and drink']];
const INTEREST_WORDS = { sports: 'pickup sports', running: 'running', outdoors: 'the outdoors', games: 'games', music: 'live music', dance: 'dancing',
  books: 'books', making: 'making things', languages: 'languages', food: 'food and drink' };
const AGES = { twenties: 'Mostly 20s', thirties: 'Mostly 30s', forties: 'Mostly 40s', fifties: '50 and up', any: 'Any age' };

/* clubs.json categories each archetype and tag leans toward */
const ARCH_CATS = { new: ['Social', 'Language', 'Other'], regular: ['Games & Puzzles', 'Music', 'Dance'], trail: ['Hiking & Outdoors', 'Running', 'Biking'], games: ['Games & Puzzles', 'Sports & Rec'] };
const TAG_CATS = { sports: ['Sports & Rec'], running: ['Running'], outdoors: ['Hiking & Outdoors', 'Biking'], games: ['Games & Puzzles'], music: ['Music'],
  dance: ['Dance'], books: ['Books'], making: ['Making & Crafts'], languages: ['Language'], food: ['Social'],
  student: ['Social', 'Sports & Rec'], grad: ['Social', 'Sports & Rec'], moved: ['Social'], older: ['Social'] };
/* a few tags are about who a club is for, which only its own words say */
const TAG_TEXT = { women: /wom[ae]n|womxn|nonbinary/i, lgbtq: /queer|lgbt|pride|nonbinary|womxn/i };
/* event titles that fit each archetype and tag */
const ARCH_WORDS = { new: /coffee|mixer|new in town|social|welcome|walk/i, regular: /trivia|music|movie|film|coffee|dinner|drink|karaoke|open mic/i,
  trail: /run|hike|walk|paddle|kayak|bike|ski|basketball|soccer|beach/i, games: /game|trivia|board|puzzle|basketball|pickleball|bowling/i };
const TAG_WORDS = { sports: /basketball|soccer|pickleball|volleyball|kickball|ultimate|frisbee/i, running: /\brun|5k/i, outdoors: /hike|walk|paddle|kayak|beach|trail/i,
  games: /game|trivia|puzzle/i, music: /music|concert|open mic|karaoke/i, dance: /danc|contra|swing/i, books: /book|poet|read/i,
  making: /craft|make|carv|paint/i, languages: /language|french|spanish|conversation/i, food: /coffee|food|dinner|brunch|crawl|drink|lunch/i, moved: /new in town|mixer|coffee/i };

/* Stephen's own events (newsletter AGENTS.md, "Stephen's OWN events are never missed") */
const OWN_URL = /meetup\.com\/burlington-social-activiti?es-group\//i;
const OWN_NAME = /btown brief|btown coffee club|burlington social activities group/i;
export const isOwnEvent = (e) => !!e && (OWN_URL.test(String(e.url || '')) ||
  OWN_NAME.test([e.title, e.venue, (Array.isArray(e.tags) ? e.tags : []).join(' ')].join(' ')));

/* ----------------------------------------------------------------- the quiz */
/* Each answer leans toward archetypes (a) and adds what you're into (t);
   `talk` says which community channel fits. Never age, gender or orientation. */
const QUIZ = [
  { q: 'When are you most free to go out?', o: [
    ['Weeknights', { a: { regular: 2, games: 1 } }], ['Weekends', { a: { trail: 2, new: 1 } }], ['Whenever', { a: { new: 1, regular: 1 } }]] },
  { q: 'Outside or inside?', o: [
    ['Outside, most weather', { a: { trail: 3 }, t: ['outdoors'] }], ['Inside and warm', { a: { games: 2, regular: 1 } }], ['Depends on the day', { a: { new: 1 } }]] },
  { q: 'A big friendly crowd, or three people?', o: [
    ['A big friendly crowd', { a: { new: 2, regular: 1 } }], ['Three or four people', { a: { games: 2, trail: 1 } }], ['One or two others', { a: { trail: 1, regular: 1 } }]] },
  { q: 'Talk, or do something?', o: [
    ['Talk: coffee, a drink', { a: { regular: 2, new: 1 }, talk: true }], ['Do: a game, a run, a project', { a: { games: 1, trail: 1 }, talk: false }], ['A bit of both', { a: { new: 1 } }]] },
  { q: 'New here, or settled?', o: [
    ['Here less than a year', { a: { new: 3 } }], ['A few years', { a: { regular: 1 } }], ['Here a long time', { a: { regular: 2 } }]] },
  { q: 'What would get you out of the house?', o: [
    ['A trail or the lake', { a: { trail: 2 }, t: ['outdoors'] }], ['A game or trivia night', { a: { games: 2 }, t: ['games'] }],
    ['Live music or a dance', { a: { regular: 2 }, t: ['music', 'dance'] }], ['A pickup game or a run', { a: { games: 1, trail: 1 }, t: ['sports', 'running'] }],
    ['A book club or a language table', { a: { regular: 1, new: 1 }, t: ['books', 'languages'] }], ['Making something', { a: { new: 1, regular: 1 }, t: ['making'] }],
    ['Good food with new people', { a: { new: 2 }, t: ['food'] }]] },
  { q: 'How do you like to meet people?', o: [
    ['The same thing every week', { a: { regular: 2 } }], ['Try something once', { a: { new: 2 } }], ['Someone else plans it, I show up', { a: { new: 1, games: 1 }, talk: false }]] },
];
const ORDER = ['new', 'regular', 'trail', 'games'];
export function quizResult(picks) {
  const score = { new: 0, regular: 0, trail: 0, games: 0 };
  const tags = [];
  let talk = null;
  picks.forEach((p, i) => {
    const o = QUIZ[i] && QUIZ[i].o[p] && QUIZ[i].o[p][1];
    if (!o) return;
    Object.entries(o.a || {}).forEach(([k, n]) => { score[k] += n; });
    (o.t || []).forEach((t) => { if (!tags.includes(t)) tags.push(t); });
    if (typeof o.talk === 'boolean' && talk === null) talk = o.talk;
  });
  const arch = ORDER.reduce((best, k) => (score[k] > score[best] ? k : best), ORDER[0]);
  return { arch, tags: tags.slice(0, PEOPLE_RULES.interestsMax), channel: talk ? 'find' : 'plans' };
}
export const QUIZ_TEXT = () => QUIZ.map((x) => [x.q].concat(x.o.map((o) => o[0])).join(' | ')).join('\n');

/* ---------------------------------------------------------------- state */
const S = {
  arch: null, tags: [], quizTags: [],   // the reader's picks (this device)
  intoUp: [],                          // readers whose into-tags this device has squared with their profile once
  prof: undefined,                     // the profile when signed in: undefined not asked, null none
  posts: [], plansState: 'loading',    // 'loading' | 'ok' | 'off' | 'fail'
  events: null, eventsFailed: false, feed: null, clubs: null, clubsFailed: false,
  dir: null,                           // { count, me, people } | { error }
  filter: 'all', q: null,              // the plans chip; the quiz in progress or done
};
let root = null, slots = null, pending = null, demoD = null, plansRun = 0;
const SECS = [['arch', 'Who you are'], ['plans', 'Open to strangers'], ['mix', 'Mixers'], ['quiz', 'Quiz'], ['dir', 'Directory']];

/* the reader's picks, on this device; in the demo, for the visit only */
let memo = {};
const saved = () => (app.demo ? memo : (store.read(STORE_KEY, {}) || {}));
function keep() {
  const v = { arch: S.arch, tags: S.tags, quizTags: S.quizTags, intoUp: S.intoUp };
  if (app.demo) memo = v; else store.write(STORE_KEY, v);
}
(function restore() {
  const v = saved();
  if (ARCHETYPE_LABELS[v.arch]) S.arch = v.arch;
  const known = new Set(WHO.concat(INTO).map((x) => x[0]));
  if (Array.isArray(v.tags)) S.tags = v.tags.filter((t) => known.has(t));
  if (Array.isArray(v.quizTags)) S.quizTags = v.quizTags.filter((t) => PEOPLE_RULES.interests.includes(t));
  if (Array.isArray(v.intoUp)) S.intoUp = v.intoUp.filter((x) => typeof x === 'string').slice(-8);
})();
/* what the directory may show: the into-tags and the quiz's, nothing else */
const shareable = () => PEOPLE_RULES.interests.filter((t) => S.tags.includes(t) || S.quizTags.includes(t)).slice(0, PEOPLE_RULES.interestsMax);

/* ------------------------------------------------- the nn_people_ calls */
const MESSAGES = {
  bad_interest: 'One of those interests isn’t on the list.',
  bad_ages: 'Pick an age band from the list, or none.',
  not_found: 'That plan has gone.',
  off: 'The directory opens soon. Everything else here works.',
};
const fail = (error) => ({ ok: false, error, message: MESSAGES[error] || message(error) });

/* Live: the same POST to PostgREST that boards.js makes, as the reader. A
   function that does not exist yet (nn-people.sql not pasted) answers 404
   PGRST202, which reads as 'off'. */
function rpc(fn, args) {
  if (app.demo) return Promise.resolve().then(() => mirror(fn, args || {})).catch((e) => fail(e.code || 'offline'));
  const signedIn = !!app.user();
  return Promise.resolve(signedIn ? app.token() : null).then((tok) => {
    if (signedIn && !tok) throw new Error('no token');
    return fetch(store.SB_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: Object.assign({ apikey: store.SB_KEY, 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}),
      body: JSON.stringify(args || {}),
    });
  }).then((r) => r.text().then((t) => {
    let j = null;
    try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
    if (r.ok) return { ok: true, data: j };
    if (r.status === 404 && j && j.code === 'PGRST202') return fail('off');
    if (r.status === 401) return fail('not_signed_in');
    return fail(j && typeof j.message === 'string' && /^[a-z_]+$/.test(j.message) ? j.message : 'offline');
  }), () => fail(app.user() ? 'offline' : 'not_signed_in'));
}

/* The demo's copy of nn-people.sql: same names, same arguments, same
   answers and refusals. Directory rows are the demo file's; the reader's own
   row is made when they join. Plan extras are keyed by post id. */
const M = { dir: [], plans: new Map() };
const thrown = (code) => { const e = new Error(code); e.code = code; throw e; };
function checkInterests(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) thrown('bad_interest');
  const out = [];
  list.forEach((t) => { if (!PEOPLE_RULES.interests.includes(t)) thrown('bad_interest'); if (!out.includes(t)) out.push(t); });
  if (out.length > PEOPLE_RULES.interestsMax) thrown('bad_interest');
  return out;
}
async function mirror(fn, a) {
  const u = app.user();
  const prof = async () => { const p = await boards.profile(); if (!p.ok) thrown(p.error); return p.profile; };
  const mine = () => M.dir.find((r) => r.uid === (u && u.id));
  if (fn === 'nn_people_rules') return { ok: true, data: JSON.parse(JSON.stringify(PEOPLE_RULES)) };
  if (fn === 'nn_people_optin') {
    if (!u) thrown('not_signed_in');
    const p = await prof();
    if (!p) thrown('no_name');
    const interests = checkInterests(a.p_interests);
    M.dir = M.dir.filter((r) => r.uid !== u.id);
    if (a.p_on) M.dir.unshift({ uid: u.id, on: true, interests });
    return { ok: true, data: { on: !!a.p_on, interests: a.p_on ? interests : [] } };
  }
  if (fn === 'nn_people_directory') {
    const p = u ? await prof() : null;
    const row = (r) => (r.uid ? { name: p.display_name, neighborhood: p.neighborhood, archetype: p.archetype, interests: r.interests.slice(), me: true }
      : { name: r.name, neighborhood: r.neighborhood, archetype: r.archetype, interests: r.interests.slice(), me: false });
    const on = M.dir.filter((r) => r.on && (!r.uid || p));
    const me = !!(u && p && mine());
    return { ok: true, data: { count: on.length, me, people: me ? on.map(row) : [] } };
  }
  if (fn === 'nn_people_plan_set') {
    if (!u) thrown('not_signed_in');
    const ages = a.p_ages || null;
    if (ages && !PEOPLE_RULES.ages.includes(ages)) thrown('bad_ages');
    const m = await boards.mine();
    if (!m.ok) thrown(m.error);
    if (!m.posts.some((x) => x.id === a.p_post && x.board === 'people')) thrown('not_found');
    if (!a.p_meetup && !ages) M.plans.delete(a.p_post); else M.plans.set(a.p_post, { meetup: !!a.p_meetup, ages });
    return { ok: true, data: { meetup: !!a.p_meetup, ages } };
  }
  if (fn === 'nn_people_plan_extras') {
    const out = {};
    const live = new Set(boards._fake().as(null).nn_posts_list({ p_board: 'people', p_limit: 60 }).map((x) => x.id));
    (Array.isArray(a.p_posts) ? a.p_posts : []).forEach((id) => { if (M.plans.has(id) && live.has(id)) out[id] = { ...M.plans.get(id) }; });
    return { ok: true, data: out };
  }
  thrown('offline');
  return null;
}

/* The demo's plans go onto the demo board as its neighbors, dated the hours
   ago the file says, with their Meetup box and age band in their own
   fields and their going counts as anonymous votes. */
function seedDemo(d) {
  const f = boards._fake();
  if (!f || f.__people) return;
  f.__people = true;
  const clock = f.now;
  try {
    (d.plans || []).forEach((p, i) => {
      const t = Date.now() - (Number(p.ago) || 1) * 3600000;
      f.now = () => t;
      const uid = 'demo-people-' + String(i).padStart(4, '0');
      f.as(uid).nn_profile_set({ p_display_name: p.author.name, p_neighborhood: p.author.neighborhood || null, p_archetype: p.author.archetype || null });
      const meta = { ...(p.meta || {}), ...(p.meetup ? { meetup: true } : {}), ...(p.ages ? { ages: p.ages } : {}) };
      const post = f.nn_post_create({ p_board: 'people', p_kind: 'plan', p_title: p.title, p_body: p.body || '', p_place: p.place || '', p_meta: meta });
      for (let v = 0; v < (Number(p.going) || 0); v++) f.as(null).nn_vote({ p_post: post.id, p_player: 'p_people_' + i + '_' + String(v).padStart(3, '0') });
    });
  } finally {
    f.now = clock;
    f.as(null);
  }
  M.dir = (d.directory || []).map((r) => ({ name: r.name, neighborhood: r.neighborhood || null, archetype: r.archetype || null, interests: (r.interests || []).slice(), on: !!r.on }));
}

/* ---------------------------------------------------------------- time */
/* Everything here is Burlington's clock, wherever the reader is: a plan's
   "7 pm" is 7 pm in Burlington. et() reads a moment as Burlington wall time;
   etWall() turns wall time back into a moment, across daylight saving. Days
   are added as calendar days, never as 24-hour blocks. */
const BTV = 'America/New_York';
const ETP = new Intl.DateTimeFormat('en-US', { timeZone: BTV, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' });
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function et(ms) {
  const o = {};
  ETP.formatToParts(new Date(ms)).forEach((x) => { o[x.type] = x.value; });
  return { y: +o.year, mo: +o.month - 1, d: +o.day, h: +o.hour % 24, mi: +o.minute, dow: WD.indexOf(o.weekday) };
}
export function etWall(y, mo, d, h, mi) {
  const want = Date.UTC(y, mo, d, h, mi);
  let t = want + 5 * 3600000;
  for (let i = 0; i < 3; i++) { const x = et(t); t += want - Date.UTC(x.y, x.mo, x.d, x.h, x.mi); }
  return t;
}
/* a calendar day n days on from y/mo/d, as { y, mo, d, dow } */
const addDays = (y, mo, d, n) => { const u = new Date(Date.UTC(y, mo, d + n, 12)); return { y: u.getUTCFullYear(), mo: u.getUTCMonth(), d: u.getUTCDate(), dow: u.getUTCDay() }; };
const UTC_LABEL = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const dayLabel = (x) => UTC_LABEL.format(new Date(Date.UTC(x.y, x.mo, x.d, 12)));   // "Sat, Oct 18"
const timeWord = (h, mm) => ((h % 12) || 12) + (mm ? ':' + String(mm).padStart(2, '0') : '') + (h < 12 ? ' am' : ' pm');
/* a moment as the compose sheet writes it: "Sat, Oct 18, 7:30 pm" */
export const whenLabel = (ms) => { const x = et(ms); return dayLabel(x) + ', ' + timeWord(x.h, x.mi); };

/* A plan's "when" is words. The compose sheet writes "Sat, Oct 18, 7 pm";
   people also type "Tonight, 7:30 pm" or "Sunday, 8 am", read from the day
   the plan was posted. Returns a moment in ms, or null when it can't tell. */
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DOWS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6 };
export function whenMs(text, createdMs) {
  const t = String(text || '').toLowerCase();
  const b = et(createdMs || Date.now());
  let day = null;
  let m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})\b(?:,? (\d{4}))?/);
  if (m) {
    const mo = MON.indexOf(m[1]), dd = Number(m[2]);
    let y = m[3] ? Number(m[3]) : b.y;
    /* no year: a date well behind the posting day is next year's (December's plan for January) */
    if (!m[3] && Date.UTC(y, mo, dd) - Date.UTC(b.y, b.mo, b.d) < -60 * DAY) y += 1;
    const u = new Date(Date.UTC(y, mo, dd, 12));
    if (u.getUTCDate() !== dd) return null;   // "Feb 30"
    day = { y, mo, d: dd };
  } else if (/\b(today|tonight)\b/.test(t)) day = b;
  else if (/\btomorrow\b/.test(t)) day = addDays(b.y, b.mo, b.d, 1);
  else {
    m = t.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)\b/);
    if (m) day = addDays(b.y, b.mo, b.d, (DOWS[m[1]] - b.dow + 7) % 7);
  }
  if (!day) return null;
  let h = /\b(tonight|evening)\b/.test(t) ? 19 : /\bafternoon\b/.test(t) ? 14 : /\bmorning\b/.test(t) ? 9 : 12, min = 0;
  m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12 && Number(m[2] || 0) < 60) { h = (Number(m[1]) % 12) + (m[3] === 'pm' ? 12 : 0); min = Number(m[2] || 0); }
  return etWall(day.y, day.mo, day.d, h, min);
}

/* the demo: events moved from its anchor day to the reader's, by calendar
   days in Burlington; plans dated hours from now */
function redate(d) {
  const [y, mo, dd] = String(d._anchor || '').split('-').map(Number);
  const now = et(Date.now());
  const days = y ? Math.round((Date.UTC(now.y, now.mo, now.d) - Date.UTC(y, mo - 1, dd)) / DAY) : 0;
  const shift = (iso) => { const x = et(Date.parse(iso)); const n = addDays(x.y, x.mo, x.d, days); return etWall(n.y, n.mo, n.d, x.h, x.mi); };
  (d.events || []).forEach((e) => {
    ['start', 'end'].forEach((k) => { if (e[k]) e[k] = new Date(shift(e[k])).toISOString(); });
    if (e.start) { const x = et(Date.parse(e.start)); e.date = x.y + '-' + String(x.mo + 1).padStart(2, '0') + '-' + String(x.d).padStart(2, '0'); }
  });
  (d.plans || []).forEach((p) => {
    if (p.starts_in == null) return;
    const at = Math.ceil((Date.now() + Number(p.starts_in) * 3600000) / 1800000) * 1800000;   // on the half hour
    p.meta = Object.assign({}, p.meta, { when: whenLabel(at) });
  });
  return d;
}
const EV_DOW = new Intl.DateTimeFormat('en-US', { timeZone: BTV, weekday: 'short' });
const EV_DOM = new Intl.DateTimeFormat('en-US', { timeZone: BTV, day: 'numeric' });
const EV_DAY = new Intl.DateTimeFormat('en-US', { timeZone: BTV, weekday: 'long', month: 'short', day: 'numeric' });
const clock = (dt) => { const x = et(dt.getTime()); return timeWord(x.h, x.mi); };
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

/* -------------------------------------------------------------- loading */

function loadPlans() {
  const run = ++plansRun;
  return boards.list('people', { kind: 'plan', limit: RULES.limits.listMax }).then((r) => {
    if (run !== plansRun) return null;
    if (!r.ok) { S.plansState = r.error === 'off' ? 'off' : 'fail'; S.posts = []; return null; }
    const posts = r.posts;
    const ids = posts.map((p) => p.id);
    /* plans from before round two keep their box and band in the side
       table; a plan lasts 14 days at most, so this read can go after
       2026-11-30 */
    const extras = ids.length ? rpc('nn_people_plan_extras', { p_posts: ids }) : Promise.resolve({ ok: true, data: {} });
    return extras.then((x) => {
      if (run !== plansRun) return;
      const map = x.ok && x.data && typeof x.data === 'object' ? x.data : {};
      posts.forEach((p) => {
        p.meta = p.meta && typeof p.meta === 'object' ? p.meta : {};
        const e = map[p.id] || {};
        /* the plan's Meetup box and age band, in its meta, wherever they were stored */
        p.meta.meetup = p.meta.meetup === true || !!e.meetup;
        if (!p.meta.meetup) delete p.meta.meetup;
        if (!p.meta.ages && AGES[e.ages]) p.meta.ages = e.ages;
        p.at = whenMs(p.meta.when, Date.parse(p.created_at));
      });
      S.posts = posts;
      S.plansState = 'ok';
    });
  }).then(() => { if (run === plansRun) { drawPlans(); app.recount(); land(); } });
}

/* `adopt`: the profile's archetype becomes the tab's. Not while the tab's
   own saves are queued (see write()), whose echo would undo a later tap. */
const who = () => (app.user() ? app.user().id : null);
let profRun = 0, dirRun = 0;
function loadProfile(adopt = true) {
  const run = ++profRun, u = who();
  if (!u) { S.prof = null; return Promise.resolve(); }
  return boards.profile().then((p) => {
    if (run !== profRun || u !== who()) return;
    S.prof = p.ok ? p.profile : null;
    if (!S.prof || !adopt) return;
    /* signed in: the profile's archetype is the one; one picked before
       signing in goes up to it */
    if (S.prof.archetype && S.prof.archetype !== S.arch) { S.arch = S.prof.archetype; keep(); render(); }
    else if (!S.prof.archetype && S.arch) pushArch();
    /* and what you're into. The first time this device meets this reader,
       tags picked here before go up to an empty profile; after that the
       profile is the record, an empty one included (cleared in Settings,
       or on another phone). A server before round two has no interests. */
    if (!Array.isArray(S.prof.interests)) return;
    const into = S.prof.interests.filter((t) => PEOPLE_RULES.interests.includes(t));
    const met = S.intoUp.includes(u);
    if (!met && !into.length && intoTags().length) { pushInterests(); return; }
    if (!met) { S.intoUp = S.intoUp.concat(u).slice(-8); keep(); }
    if (into.join() !== intoTags().join()) {
      S.tags = S.tags.filter((t) => !PEOPLE_RULES.interests.includes(t)).concat(into);
      keep();
      syncDir();
      render();
    }
  });
}

function loadDir() {
  const run = ++dirRun, u = who();
  return rpc('nn_people_directory').then((r) => {
    if (run !== dirRun || u !== who()) return;
    S.dir = r.ok && r.data ? { count: Number(r.data.count) || 0, me: !!r.data.me, people: Array.isArray(r.data.people) ? r.data.people : [] } : { error: r.error, message: r.message };
    drawDir();
  });
}

/* the group calendar's events in the events file's shape (no venue: the
   calendar doesn't carry one) */
function feedEvents(j) {
  return (j && Array.isArray(j.events) ? j.events : []).filter((e) => e && e.title && e.url && Date.parse(e.starts_at)).map((e) => {
    const x = et(Date.parse(e.starts_at));
    return { id: 'm' + ((String(e.url).match(/\/events\/(\w+)/) || [])[1] || slug(e.title)) + '-' + x.mo + '-' + x.d, title: String(e.title), start: e.starts_at,
      url: String(e.url), venue: String(e.location || ''), date: x.y + '-' + String(x.mo + 1).padStart(2, '0') + '-' + String(x.d).padStart(2, '0') };
  });
}
function loadLive() {
  data.load('whatnow', (j) => { S.events = j.events; drawMix(); land(); }, () => { S.eventsFailed = true; drawMix(); land(); });
  data.fetchJSON(MEETUP_FEED, 8000).then((j) => { S.feed = feedEvents(j); }, () => { S.feed = []; }).then(() => { drawMix(); land(); });
  data.fetchJSON(CLUBS_URL, 8000).then((j) => {
    if (!j || !Array.isArray(j.clubs)) throw new Error('bad shape');
    S.clubs = j.clubs;
  }).catch(() => { S.clubsFailed = true; }).then(() => { drawMix(); land(); });
  loadPlans();
  loadProfile().then(loadDir);
}

function loadDemo() {
  return app.demoData(KEY).then((d) => {
    demoD = redate(d);
    seedDemo(demoD);
    S.events = demoD.events;
    S.clubs = demoD.clubs;
    drawMix();
    loadPlans();
    loadProfile().then(loadDir);
  });
}

/* ------------------------------------------------------------- choosing */
/* The tab's writes go one at a time, in the order they were made, so a
   slow early save can never land after a later one. While any is queued,
   a profile change heard from boards.js is our own echo, not news. */
let writes = Promise.resolve(), queued = 0;
function write(fn) {
  queued += 1;
  writes = writes.then(fn).catch(() => {}).then(() => { queued -= 1; });
  return writes;
}
function pushArch() {
  if (!app.user() || !S.prof) return;
  write(() => {
    if (!S.prof) return null;
    return boards.setProfile({ display_name: S.prof.display_name, neighborhood: S.prof.neighborhood, archetype: S.arch || null }).then((r) => {
      if (r.ok) S.prof = r.profile;
      else app.toast(r.message);
    });
  });
}
/* the what-you're-into tags, in the list's order: the profile's interests */
const intoTags = () => PEOPLE_RULES.interests.filter((t) => S.tags.includes(t)).slice(0, PEOPLE_RULES.interestsMax);
function pushInterests() {
  if (!app.user() || !S.prof) return;
  write(() => {
    if (!S.prof) return null;
    return boards.setProfile({ display_name: S.prof.display_name, neighborhood: S.prof.neighborhood, archetype: S.prof.archetype, interests: intoTags() }).then((r) => {
      if (!r.ok) { app.toast(r.message); return; }
      S.prof = r.profile;
      const u = who();
      if (r.interestsSaved !== false && u && !S.intoUp.includes(u)) { S.intoUp = S.intoUp.concat(u).slice(-8); keep(); }
    });
  });
}
function setArch(k, quiet) {
  S.arch = k && ARCHETYPE_LABELS[k] ? k : null;
  keep();
  pushArch();
  render();
  if (!quiet) app.toast(S.arch ? 'You’re here as ' + ARCHETYPE_LABELS[S.arch].toLowerCase() + '. Plans and clubs like that come first.' : 'Cleared. Everything shows in its usual order.');
}
function toggleTag(t) {
  S.tags = S.tags.includes(t) ? S.tags.filter((x) => x !== t) : S.tags.concat(t);
  keep();
  if (PEOPLE_RULES.interests.includes(t)) pushInterests();
  syncDir();
  render();
}
/* in the directory already: what it shows follows what you pick */
function syncDir() {
  if (!S.dir || !S.dir.me) return;
  write(() => rpc('nn_people_optin', { p_on: true, p_interests: shareable() }).then((r) => {
    if (r.ok) loadDir(); else app.toast('The directory didn’t update: ' + r.message);
  }));
}

/* ---------------------------------------------------------------- order */
function clubScore(c, arch, tags) {
  let s = c.featured ? 0.5 : 0;
  if (arch && ARCH_CATS[arch].includes(c.category)) s += 3;
  tags.forEach((t) => {
    if (TAG_CATS[t] && TAG_CATS[t].includes(c.category)) s += 2;
    if (TAG_TEXT[t] && TAG_TEXT[t].test(c.name + ' ' + c.what + ' ' + c.when)) s += 3;
  });
  return s;
}
/* the reader's picks by default; the quiz asks for its own result's */
function clubsFor(n, arch = S.arch, tags = S.tags.concat(S.quizTags)) {
  return (S.clubs || []).filter((c) => c && c.name && c.url).map((c, i) => ({ c, s: clubScore(c, arch, tags), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i).slice(0, n).map((x) => x.c);
}
const fitsEvent = (e, arch, tags) => (arch && ARCH_WORDS[arch].test(e.title)) || (tags || []).some((t) => TAG_WORDS[t] && TAG_WORDS[t].test(e.title));
/* every one of Stephen's events from now to two weeks out, once each */
/* one event, whichever source it came from: the Meetup event number and the day */
const eventKey = (e) => ((String(e.url).match(/\/events\/(\w+)/) || [])[1] || e.url) + '|' + e.date;
function mixers() {
  const now = Date.now(), seen = new Set();
  /* the events file first: it knows the venue */
  return (S.events || []).concat(S.feed || []).filter(isOwnEvent).map((e) => {
    const t = Date.parse(e.start);
    const end = Date.parse(e.end) || t + 2 * 3600000;
    return { e, t, end };
  }).filter((x) => x.t && x.end > now && x.t < now + MIX_DAYS * DAY && x.e.url)
    .filter((x) => { const k = eventKey(x.e); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.t - b.t);
}
function mixerItem(x) {
  const e = x.e, dt = new Date(x.t);
  const where = [e.venue, e.town && e.town !== 'Burlington' ? e.town : ''].filter(Boolean).join(', ') || 'Place on Meetup';
  return {
    k: 'mx-' + String(e.id || slug(e.title + '-' + e.date)), kind: 'event', href: e.url, src: 'Btown Brief IRL', sid: 'meetup:btown-irl', own: true,
    title: e.title, dow: EV_DOW.format(dt), dom: EV_DOM.format(dt), when: e.allDay ? 'All day' : clock(dt), where,
    price: e.free ? 'Free' : typeof e.price === 'string' && e.price ? e.price : 'RSVP on Meetup', open: 'Open on Meetup', at: x.t,
  };
}

/* --------------------------------------------------------------- drawing */
const sec = (host, title, sub, right) => section(host, title, sub ? esc(sub) : '', right);
const feed = (host) => { const f = el('div', 'feed'); host.appendChild(f); return f; };
const linkBtn = (label, href, cls) => {
  const a = el('a', 'btn ' + (cls || 'ghost sm'), esc(label) + ' ' + ICON.ext);
  a.href = safeHref(href);
  if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
  return a;
};

function render() {
  if (!root) return;
  if (!slots) {
    root.innerHTML = '';
    slots = {};
    ['arch', 'plans', 'mix', 'quiz', 'dir', 'talk'].forEach((k) => { const s = el('div'); s.dataset.sec = k; slots[k] = s; root.appendChild(s); });
    root.appendChild(el('div', 'spacer'));
  }
  drawArch(); drawPlans(); drawMix(); drawQuiz(); drawDir(); drawTalk();
}

function drawArch() {
  const s = slots && slots.arch;
  if (!s) return;
  s.innerHTML = '';
  sec(s, 'Who are you here as?', 'Pick one, and anything below that fits. Plans, mixers and clubs like you move up.');
  const grid = el('div', 'arch');
  ARCH.forEach(([k, icon, line]) => {
    const on = S.arch === k;
    const b = el('button', on ? 'on' : '', icon + '<div><b>' + esc(ARCHETYPE_LABELS[k]) + '</b><span>' + esc(line) + '</span></div>');
    b.type = 'button';
    b.dataset.arch = k;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.addEventListener('click', () => setArch(on ? null : k));
    grid.appendChild(b);
  });
  s.appendChild(grid);
  const tagRow = (label, list) => {
    s.appendChild(el('div', 'spacer'));
    s.appendChild(el('p', 'note pad', esc(label)));
    s.appendChild(el('div', 'spacer'));
    const row = chips(list.map(([key, l]) => ({ key, label: l, cls: S.tags.includes(key) ? 'on' : '' })), null, (key) => toggleTag(key));
    row.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c.classList.contains('on') ? 'true' : 'false'));
    row.dataset.tags = label;
    s.appendChild(row);
  };
  tagRow('I’m…', WHO);
  tagRow('I’m into…', INTO);
  s.appendChild(el('p', 'note pad', esc(app.user()
    ? 'The tile is saved to your profile and shows on your plans. What you’re into is saved to your profile too, where nobody sees it; the directory shows it only if you join. Who you are stays on this phone.'
    : 'All of this stays on this phone. Signed in, the tile also shows on your plans.')));
}

/* "I'd go" is the board's vote, painted as a going count */
const goingWords = (n) => (Number(n) > 0 ? plural(Number(n), 'going', 'going') : 'Be the first');
function planMeta(p) {
  const m = p.meta || {};
  return [m.when, m.spots ? plural(m.spots, 'spot', 'spots') : '', AGES[m.ages] || '', FOR[m.arch] ? 'For ' + FOR[m.arch] : '',
    m.meetup ? 'Down for Meetup' : ''].filter(Boolean).join(' · ');
}
function planCard(p) {
  const it = boards.item(p, { tab: KEY, meta: planMeta });
  it.left = null;   // a plan ends when it happens; its "when" says so
  app.know([it]);
  const n = cards.board(it);
  if (!n) return null;
  n.dataset.plan = p.id;
  const b = n.querySelector('[data-act="bvote"]');
  if (b) {
    b.setAttribute('aria-label', 'I’d go');
    b.innerHTML = ICON.check + '<span>I’d go</span><span class="n" hidden>' + esc(it.votes || '') + '</span>';
    b.after(el('span', 'going', esc(goingWords(it.votes))));
  }
  return n;
}
/* boards.js repaints the hidden count; the going words follow it */
let goingWatch = null;
function watchGoing(host) {
  if (goingWatch) goingWatch.disconnect();
  if (!('MutationObserver' in window)) return;
  goingWatch = new MutationObserver(() => host.querySelectorAll('.card.board').forEach((c) => {
    const n = c.querySelector('[data-act="bvote"] .n'), g = c.querySelector('.going');
    const want = goingWords(n ? n.textContent : 0);
    if (g && g.textContent !== want) g.textContent = want;
  }));
  goingWatch.observe(host, { subtree: true, childList: true, characterData: true });
}

function sortedPlans() {
  const now = Date.now();
  const fit = (p) => (S.arch && (p.meta.arch === S.arch || p.author_arch === S.arch) ? 0 : 1);
  return S.posts.filter((p) => p.at == null || p.at > now - PAST_GRACE)
    .filter((p) => S.filter !== 'meetup' || p.meta.meetup)
    .sort((a, b) => fit(a) - fit(b) || (a.at == null) - (b.at == null) || (a.at || 0) - (b.at || 0) || Date.parse(b.created_at) - Date.parse(a.created_at));
}

function drawPlans() {
  const s = slots && slots.plans;
  if (!s) return;
  s.innerHTML = '';
  const post = button(ICON.plus + ' Post a plan', 'ghost sm', planSheet);
  post.dataset.post = '1';
  sec(s, 'Open to strangers this week', 'Real plans from neighbors who said strangers are welcome. Say you’d go and the host sees the count.', post);
  if (S.plansState === 'loading') { s.appendChild(el('p', 'loading', 'Finding this week’s plans…')); return; }
  if (S.plansState !== 'ok') {
    s.appendChild(el('div', 'textcard', '<p>' + esc(S.plansState === 'off' ? 'Plans open soon. Everything else on this tab works.' : message('offline')) + '</p>'));
    return;
  }
  const upcoming = S.posts.filter((p) => p.at == null || p.at > Date.now() - PAST_GRACE);
  const asked = upcoming.filter((p) => p.meta.meetup).length;
  if (!asked) S.filter = 'all';
  if (asked) {
    const row = chips([{ key: 'all', label: 'All plans', n: upcoming.length }, { key: 'meetup', label: 'Down for Meetup', n: asked }], S.filter,
      (k) => { S.filter = k; drawPlans(); });
    row.dataset.filter = '1';
    s.appendChild(row);
  }
  const list = sortedPlans();
  if (list.length) {
    const f = feed(s);
    f.dataset.plans = '1';
    app.bindFeed(f);
    list.forEach((p) => { const n = planCard(p); if (n) f.appendChild(n); });
    watchGoing(f);
  } else {
    const tc = el('div', 'textcard', '<h3 class="serif">No plans yet this week.</h3><p>Going somewhere and happy to have company? Say where and when, and that strangers are welcome.</p>');
    const r = el('div', 'row');
    r.appendChild(button('Post the first plan', '', planSheet));
    tc.appendChild(r);
    s.appendChild(tc);
  }
  if (!app.user()) s.appendChild(el('p', 'note pad', esc('Reading plans and saying you’d go need nothing. Posting one takes the email sign-in: one email, no password.')));
}

function drawMix() {
  const s = slots && slots.mix;
  if (!s) return;
  s.innerHTML = '';
  sec(s, 'Mixers', 'Stephen’s own Btown Brief meetups, open to anyone, then the clubs that fit you.');
  const settled = (S.events || S.eventsFailed) && (app.demo || S.feed);
  if (!mixers().length && !settled) s.appendChild(el('p', 'loading', 'Reading the calendar…'));
  else {
    const all = mixers().map(mixerItem);
    const tags = S.tags.concat(S.quizTags);
    /* the ones that fit come first; none is ever left out */
    const list = S.arch || tags.length ? all.filter((it) => fitsEvent(it, S.arch, tags)).concat(all.filter((it) => !fitsEvent(it, S.arch, tags))) : all;
    if (list.length) {
      app.know(list);
      const f = feed(s);
      f.dataset.mixers = '1';
      app.bindFeed(f);
      list.forEach((it) => { const n = cards.event(it, { noComments: true }); if (n) f.appendChild(n); });
    } else {
      const tc = el('div', 'textcard', '<p>' + esc(S.eventsFailed && !(S.feed || []).length ? 'The calendar didn’t load. The meetups are always on Meetup.' : 'No Btown Brief meetups on the calendar for the next two weeks yet. New ones land on Meetup first.') + '</p>');
      const r = el('div', 'row');
      r.appendChild(linkBtn('The Meetup group', MEETUP_GROUP));
      tc.appendChild(r);
      s.appendChild(tc);
    }
  }
  s.appendChild(el('div', 'sec', '<div><h2>' + esc(S.arch || S.tags.length || S.quizTags.length ? 'Clubs that fit' : 'Clubs to try') + '</h2><p>' +
    esc('Groups that meet every week or month, and welcome new people.') + '</p></div>'));
  if (!S.clubs) { s.appendChild(el('p', S.clubsFailed ? 'note pad' : 'loading', S.clubsFailed ? 'The clubs list didn’t load.' : 'One moment…')); }
  else {
    const g = el('div', 'clubs');
    g.dataset.clubs = '1';
    clubsFor(CLUBS_SHOWN).forEach((c) => g.appendChild(clubRow(c)));
    s.appendChild(g);
  }
  const r = el('div', 'addrow');
  r.appendChild(linkBtn('Every club in town', CLUBS_PAGE));
  s.appendChild(r);
}
function clubRow(c) {
  const a = el('a', 'lrow', mark(c.name, 'round lg') + '<div><div class="t">' + esc(c.name) + '</div><div class="s">' + esc([c.when, c.category].filter(Boolean).join(' · ')) + '</div></div>' + ICON.ext);
  a.href = safeHref(c.url);
  a.target = '_blank';
  a.rel = 'noopener';
  a.dataset.k = 'club:' + slug(c.name);
  a.dataset.cat = c.category || '';
  return a;
}

function drawQuiz() {
  const s = slots && slots.quiz;
  if (!s) return;
  s.innerHTML = '';
  sec(s, 'The quiz', 'Seven questions. A guess at who you are here as, and where to start.');
  const tc = el('div', 'textcard');
  tc.dataset.quiz = S.q ? (S.q.done ? 'done' : 'q' + S.q.i) : 'intro';
  s.appendChild(tc);
  if (!S.q) {
    tc.innerHTML = '<h3 class="serif">Seven questions, then a few places to start.</h3><p>Nothing about your age, your gender or who you date. At the end: a guess at your kind of person, three clubs, the next mixers, and where the conversation is.</p>';
    const r = el('div', 'row');
    r.appendChild(button('Take the quiz', '', () => { S.q = { i: 0, picks: [] }; drawQuiz(); }));
    r.appendChild(el('span', 'fine', 'Answers stay on this phone.'));
    tc.appendChild(r);
    return;
  }
  if (!S.q.done) {
    const step = QUIZ[S.q.i];
    tc.innerHTML = '<span class="eyebrow">' + esc('Question ' + (S.q.i + 1) + ' of ' + QUIZ.length) + '</span><h3 class="serif">' + esc(step.q) + '</h3>';
    const opts = pills(step.o.map((o, i) => [String(i), o[0]]), S.q.picks[S.q.i] != null ? String(S.q.picks[S.q.i]) : null, (v) => {
      S.q.picks[S.q.i] = Number(v);
      if (S.q.i + 1 < QUIZ.length) S.q.i += 1;
      else S.q = { done: true, picks: S.q.picks, result: quizResult(S.q.picks) };
      drawQuiz();
    }, 'wrap');
    opts.dataset.answers = '1';
    tc.appendChild(el('div', 'spacer'));
    tc.appendChild(opts);
    const r = el('div', 'row');
    if (S.q.i > 0) r.appendChild(button('Back', 'ghost sm', () => { S.q.i -= 1; drawQuiz(); }));
    r.appendChild(button('Start over', 'ghost sm', () => { S.q = null; drawQuiz(); }));
    tc.appendChild(r);
    return;
  }
  const res = S.q.result;
  const arch = ARCH.find((a) => a[0] === res.arch);
  tc.innerHTML = '<span class="eyebrow">Your result</span><h3 class="serif">' + esc('Probably: ' + ARCHETYPE_LABELS[res.arch]) + '</h3><p>' + esc(arch[2]) +
    ' ' + esc('It’s a guess, not a box. Take it, or pick another tile at the top.') + '</p>' +
    (res.tags.length ? '<p>' + esc('Into: ' + res.tags.map((t) => INTEREST_WORDS[t]).join(', ') + '.') + '</p>' : '');
  const h = (t) => tc.appendChild(el('p', 'fine', '<b>' + esc(t) + '</b>'));
  const picks = clubsFor(3, res.arch, res.tags);
  if (picks.length) { h('Three clubs to try'); const g = el('div', 'dir'); g.dataset.quizClubs = '1'; picks.forEach((c) => g.appendChild(clubRow(c))); tc.appendChild(g); }
  const mix = mixers().map(mixerItem);
  const fit = mix.filter((it) => fitsEvent(it, res.arch, res.tags)).concat(mix.filter((it) => !fitsEvent(it, res.arch, res.tags))).slice(0, 2);
  if (fit.length) {
    h('The next mixers');
    const g = el('div', 'dir');
    tc.appendChild(g);
    fit.forEach((it) => {
      const a = el('a', 'lrow', '<span class="th bare">' + ICON.people + '</span><div><div class="t">' + esc(it.title) + '</div><div class="s">' +
        esc(EV_DAY.format(new Date(it.at)) + ', ' + it.when + ' · ' + it.where) + '</div></div>' + ICON.ext);
      a.href = safeHref(it.href); a.target = '_blank'; a.rel = 'noopener';
      g.appendChild(a);
    });
  }
  h('Where to talk');
  const ch = res.channel === 'find' ? ['Find Each Other', CH_FIND, 'The community channel for meeting people and saying hello.']
    : ['Plans & Meetups', CH_PLANS, 'The community channel where plans get made.'];
  tc.appendChild(el('p', 'fine', esc(ch[2])));
  const door = el('div', 'row');
  door.dataset.channel = res.channel;
  door.appendChild(linkBtn(ch[0], ch[1]));
  tc.appendChild(door);
  const r = el('div', 'row');
  r.appendChild(button('That’s me', '', () => {
    S.quizTags = res.tags.filter((t) => PEOPLE_RULES.interests.includes(t));
    keep();
    syncDir();
    setArch(res.arch);
  }));
  r.appendChild(button('Take it again', 'ghost sm', () => { S.q = { i: 0, picks: [] }; drawQuiz(); }));
  tc.appendChild(r);
}

function drawDir() {
  const s = slots && slots.dir;
  if (!s) return;
  s.innerHTML = '';
  const d = S.dir;
  const count = d && !d.error ? plural(d.count, 'neighbor is', 'neighbors are') + ' in it.' : '';
  sec(s, 'The directory', 'Opt in to be found: first name, neighborhood, who you are here as and what you’re into. Never your email. ' + count);
  const tc = el('div', 'textcard');
  tc.dataset.dir = !d ? 'loading' : d.error ? 'error' : !app.user() ? 'out' : d.me ? 'in' : 'join';
  const r = el('div', 'row');
  if (!d) { s.appendChild(el('p', 'loading', 'One moment…')); return; }
  if (d.error) {
    tc.innerHTML = '<p>' + esc(d.error === 'off' ? MESSAGES.off : d.message || message('offline')) + '</p>';
    s.appendChild(tc);
    return;
  }
  if (!app.user()) {
    tc.innerHTML = '<p>' + esc('Sign in to see who’s in it and to be seen. One email, no password. You see the directory once you’re in it too.') + '</p>';
    r.appendChild(button('Sign in', '', () => app.openSettings()));
    tc.appendChild(r);
    s.appendChild(tc);
    return;
  }
  if (!d.me) {
    tc.innerHTML = '<p>' + esc('Join and you’ll see everyone else who has. You show as your first name' +
      (S.prof && S.prof.display_name ? ' (' + S.prof.display_name + ')' : '') + ', your neighborhood and tile if you set them, and ' +
      (shareable().length ? shareable().map((t) => INTEREST_WORDS[t]).join(', ') : 'nothing else until you pick what you’re into') + '. Leave any time.') + '</p>';
    if (S.prof) r.appendChild(button('Join the directory', '', join(true)));
    else { tc.appendChild(el('p', 'fine', esc('First, a first name: neighbors see it, nothing else.'))); r.appendChild(button('Add your first name', '', () => boards.profileSheet())); }
    tc.appendChild(r);
    s.appendChild(tc);
    return;
  }
  const me = S.arch;
  const mine = new Set(shareable());
  const rows = d.people.slice().sort((a, b) => (b.me - a.me) || ((b.archetype === me) - (a.archetype === me)) ||
    ((b.interests || []).filter((t) => mine.has(t)).length - (a.interests || []).filter((t) => mine.has(t)).length));
  const g = el('div', 'grid2 dir');
  g.dataset.people = '1';
  rows.forEach((p) => {
    const where = [NEIGHBORHOOD_LABELS[p.neighborhood], ARCHETYPE_LABELS[p.archetype]].filter(Boolean).join(' · ');
    const into = (p.interests || []).map((t) => INTEREST_WORDS[t]).filter(Boolean).join(', ');
    g.appendChild(el('div', 'lrow', mark(p.name, 'round lg') + '<div><div class="t">' + esc(p.name + (p.me ? ' (you)' : '')) + '</div>' +
      (where ? '<div class="s">' + esc(where) + '</div>' : '') + (into ? '<div class="s">' + esc('Into ' + into) + '</div>' : '') + '</div>'));
  });
  s.appendChild(g);
  const foot = el('div', 'addrow');
  foot.appendChild(button('Leave the directory', 'ghost sm', join(false)));
  s.appendChild(foot);
}
function join(on) {
  return (e) => {
    const b = e && e.currentTarget;
    if (b) b.disabled = true;
    rpc('nn_people_optin', { p_on: on, p_interests: shareable() }).then((r) => {
      if (b) b.disabled = false;
      if (!r.ok) { app.toast(r.message); return; }
      app.toast(on ? 'You’re in the directory.' : 'You’ve left the directory.');
      loadDir();
    });
  };
}

function drawTalk() {
  const s = slots && slots.talk;
  if (!s) return;
  s.innerHTML = '';
  sec(s, 'Where the talking happens', '');
  const tc = el('div', 'textcard', '<h3 class="serif">Plans live here. Conversation lives with the community.</h3><p>' +
    esc('Say hello in Find Each Other, make plans in Plans & Meetups, and chat right now on Telegram. Nothing on this tab is a chat.') + '</p>');
  const r = el('div', 'row');
  r.append(linkBtn('Find Each Other', CH_FIND), linkBtn('Plans & Meetups', CH_PLANS), linkBtn('Telegram', TELEGRAM_URL));
  tc.appendChild(r);
  s.appendChild(tc);
}

/* -------------------------------------------------------- posting a plan */
/* The people board's plan, through boards.create (the foundation's checks,
   sign-in and limits). The sheet is the tab's own because a plan has a day
   and time picker and the Meetup box, which boards.compose has no field
   types for; it is boards.compose's form otherwise, in its classes. */
const fieldId = (() => { let n = 0; return () => 'pf' + (++n); })();
function row(label, ctl, hint, required) {
  const w = el('div', 'bf-row');
  ctl.id = ctl.id || fieldId();
  const l = el('label', 'bf-label', esc(label) + (required ? '' : ' <span class="bf-opt">optional</span>'));
  l.htmlFor = ctl.id;
  w.append(l, ctl);
  if (hint) w.appendChild(el('p', 'bf-hint', esc(hint)));
  return w;
}
function field(type, name, o = {}) {
  const i = el(type === 'textarea' ? 'textarea' : 'input', 'field bf-in');
  if (type !== 'textarea') i.type = type;
  i.name = name;
  if (o.max) i.maxLength = o.max;
  if (o.placeholder) i.placeholder = o.placeholder;
  if (type === 'number') { i.inputMode = 'numeric'; i.min = String(o.min || 1); i.max = String(o.maxN || 50); }
  return i;
}
function choose(name, options, value) {
  const s = el('select', 'field bf-in');
  s.name = name;
  options.forEach(([v, label]) => { const o = el('option', null, esc(label)); o.value = v; if (v === value) o.selected = true; s.appendChild(o); });
  return s;
}
function dayOptions() {
  const out = [];
  const now = et(Date.now());
  for (let i = 0; i < 14; i++) {
    const v = dayLabel(addDays(now.y, now.mo, now.d, i));   // "Sat, Oct 18", Burlington's day
    out.push([v, i === 0 ? 'Today, ' + v : i === 1 ? 'Tomorrow, ' + v : v]);
  }
  return out;
}
function timeOptions() {
  const out = [];
  for (let h = 6; h <= 23; h++) [0, 30].forEach((mm) => { const w = timeWord(h, mm); out.push([w, w]); });
  return out;
}

function planSheet() {
  app.sheet('Post a plan', (body, card, close) => {
    const note = (t) => body.appendChild(el('p', 'sheet-note', esc(t)));
    if (!app.user()) {
      note('Posting a plan needs the email sign-in: one email, no password. Reading plans and saying you’d go never do.');
      const r = el('div', 'linkrow');
      r.appendChild(button('Sign in', '', () => app.openSettings()));
      body.appendChild(r);
      return;
    }
    const wait = el('p', 'loading', 'One moment…');
    body.appendChild(wait);
    boards.profile().then((p) => {
      wait.remove();
      if (!p.ok) { note(p.message); return; }
      planForm(body, close, p.profile);
    });
  });
}

function planForm(body, close, prof) {
  const L = RULES.limits;
  const f = el('form', 'bform');
  f.noValidate = true;
  if (!prof) f.appendChild(row('Your first name', field('text', 'display_name', { max: L.nameMax, placeholder: 'Maya, or Maya R.' }), 'Neighbors see it on your plan. Asked once; change it in Settings.', true));
  f.appendChild(row('What’s the plan?', field('text', 'title', { max: L.titleMax, placeholder: 'Trivia at Three Needs, need a fifth' }), null, true));
  f.appendChild(row('Which day', choose('day', [['', 'Pick a day']].concat(dayOptions()), ''), null, true));
  f.appendChild(row('What time', choose('time', [['', 'Pick a time']].concat(timeOptions()), ''), null, true));
  f.appendChild(row('Where', field('text', 'place', { max: L.placeMax, placeholder: 'Somewhere public: a bar, a trailhead, a café' }), null, false));
  f.appendChild(row('Who it’s for', choose('arch', [['', 'Anyone']].concat(RULES.archetypes.map((a) => [a, 'Mostly ' + FOR[a]])), S.arch || ''), null, false));
  f.appendChild(row('Rough ages', choose('ages', [['', 'Not saying']].concat(PEOPLE_RULES.ages.map((a) => [a, AGES[a]])), ''), 'About the group, so people know what to expect. Never required.', false));
  f.appendChild(row('Spots for strangers', field('number', 'spots', { placeholder: 'How many more can come?' }), null, false));
  f.appendChild(row('More', field('textarea', 'body', { max: L.bodyMax, placeholder: 'How to find you, what to bring, the pace' }), null, false));
  const mu = el('label', 'consent', '<input type="checkbox" name="meetup"> ' +
    esc('I’m down to put this on Meetup. Stephen’s Burlington Social Activities Group has 613 members; tick this and he may list it there with you as the host.'));
  f.appendChild(mu);
  f.appendChild(el('p', 'bf-note', esc('A plan lasts until it happens, two weeks at most. Meet somewhere public, and say in More how people will find you.')));
  const msg = el('p', 'bf-msg');
  msg.setAttribute('role', 'status');
  const go = button('Post the plan', '');
  go.type = 'submit';
  const goRow = el('div', 'bf-go');
  goRow.append(go, msg);
  f.appendChild(goRow);
  body.appendChild(f);

  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const say = (code, text) => { msg.textContent = text || MESSAGES[code] || message(code); msg.classList.add('err'); go.disabled = false; };
    const day = String(fd.get('day') || ''), time = String(fd.get('time') || '');
    if (!prof && !String(fd.get('display_name') || '').trim()) return say('no_name');
    if (!day || !time) return say('needs_meta', 'Pick the day and the time.');
    const meta = { when: day + ', ' + time };
    if (fd.get('arch')) meta.arch = String(fd.get('arch'));
    const spots = String(fd.get('spots') || '').trim();
    if (spots) meta.spots = /^\d+$/.test(spots) ? Number(spots) : spots;
    const extra = { meetup: !!fd.get('meetup'), ages: String(fd.get('ages') || '') || null };
    const post = { kind: 'plan', title: fd.get('title'), body: fd.get('body') || '', place: fd.get('place') || '', meta };
    const pre = checkPost(RULES, 'people', post);
    if (!pre.ok) return say(pre.error, pre.error === 'bad_meta' && spots ? 'Spots is a number from 1 to 50.' : null);
    go.disabled = true;
    msg.classList.remove('err');
    msg.textContent = 'Posting…';
    let two = false;
    const named = prof ? Promise.resolve({ ok: true }) : boards.setProfile({ display_name: fd.get('display_name'), archetype: S.arch || null });
    named.then((n) => (n.ok ? boards.roundTwo().then((t) => { two = t; return n; }) : n)).then((n) => {
      if (!n.ok) return say(n.error);
      /* the box and the band are the plan's own fields; on a server still on
         round one's rules they go to nn-people.sql's side table after it */
      if (two && extra.meetup) post.meta.meetup = true;
      if (two && extra.ages) post.meta.ages = extra.ages;
      return boards.create('people', post).then((r) => {
        if (!r.ok) return say(r.error);
        const needs = !two && (extra.meetup || extra.ages);
        const after = needs ? rpc('nn_people_plan_set', { p_post: r.post.id, p_meetup: extra.meetup, p_ages: extra.ages }) : Promise.resolve({ ok: true });
        return after.then((x) => {
          close();
          app.toast(!x.ok ? 'Posted. The Meetup box and age band didn’t save: ' + x.message
            : r.post.status === 'pending' ? 'Posted. It shows once Stephen has had a look.' : extra.meetup ? 'Posted. Stephen will see you’re down for Meetup.' : 'Posted');
          S.filter = 'all';
          loadPlans().then(() => { pending = 'b-' + r.post.id; land(); });
        });
      });
    });
  });
}

/* ------------------------------------------------------------- the tab */
function land() {
  if (!pending || !root) return;
  const k = pending;
  if (SECS.some(([key]) => key === k) || k === 'talk') {
    pending = null;
    app.jumpTo(slots && slots[k]);
    return;
  }
  /* wait for the part of the tab the key belongs to */
  if (/^b-/.test(k) && S.plansState === 'loading') return;
  if (/^mx-/.test(k) && (!(S.events || S.eventsFailed) || !(app.demo || S.feed))) return;
  if (/^club:/.test(k) && !S.clubs && !S.clubsFailed) return;
  pending = null;
  if (!app.flashHit(root, k)) app.toast(/^mx-/.test(k) ? 'That mixer has passed.' : /^b-/.test(k) ? 'That plan has passed.' : 'That card has moved on.');
}

window.addEventListener('allday-boards', (e) => {
  if (!root) return;
  const d = (e && e.detail) || {};
  if (d.board === 'people' || d.what === 'delete' || d.what === 'hidden' || d.what === 'deleteme') loadPlans();
  /* a change made in Settings is adopted; our own saves echoing back are not */
  if (d.what === 'profile' || d.what === 'deleteme') loadProfile(!queued).then(() => { drawArch(); return loadDir(); });
});
app.onAuth(() => {
  if (!root) return;
  S.prof = undefined;
  loadPlans();
  loadProfile().then(() => { drawArch(); drawPlans(); return loadDir(); });
});

app.register(KEY, {
  label: 'People',
  icon: ICON.people,
  promise: 'Find your people: say who you are here as, and say yes to a plan with strangers.',
  mount(r) {
    root = r;
    slots = null;
    render();
    if (app.demo) loadDemo().catch(() => { root.innerHTML = '<div class="errbox"><b>The demo didn’t load.</b> Reload to try again.</div>'; slots = null; });
    else loadLive();
  },
  activate(param) { pending = param || null; land(); },
  refresh() { render(); },
  deactivate() {},
  subnav() {
    if (!root || !slots) return null;
    return chips(SECS.map(([key, label]) => ({ key, label })), null, (k) => app.jumpTo(slots[k]));
  },
  newSince(ts) { return S.posts.filter((p) => Date.parse(p.created_at) / 1000 > ts).length; },
});

/* for the tests: the plans as drawn, with their meta, and the picks */
export const _peek = () => ({ posts: S.posts.map((p) => ({ id: p.id, title: p.title, meta: { ...p.meta }, at: p.at, votes: p.votes })), arch: S.arch, tags: S.tags.slice(), quizTags: S.quizTags.slice() });
