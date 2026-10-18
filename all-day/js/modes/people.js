/* People: find your people in Burlington. Top to bottom, and the chip row is
   the table of contents:

   - Who are you here as. The foundation's four archetypes as tiles (New in
     town, Weeknight regular, Trail person, Game night), and under them the
     longer list from Stephen's memo as tags: who you are (a student, just
     graduated, just moved here, older and looking, a woman, LGBTQ+ or sober and
     finding your people) and what you are into (an athlete, a gamer, a
     runner, and the clubs page's other categories). The tile is the
     profile's archetype (boards.setProfile, so it shows on your plans) when
     you are signed in, and kept on this device either way. The what-you're-
     into tags are the profile's interests when you are signed in (nobody
     sees them there; the directory shows them only if you join it), and
     the who-you-are tags never leave this device.
   - For you. The moment anything above is picked, a strip right under the
     tiles with the three best groups for it (people-match.js's MATCH table,
     over data/groups.json and data/run-clubs.json), one per kind first; and
     the rest of the tab reorders: plans, mixers and clubs that fit come
     first. Unpicking everything takes the strip away.
   - Run clubs this week (and Fitness this week, behind a Run / Fitness
     switch): data/run-clubs.json through clubs-week.js, seven Burlington
     days from today as a strip, the chosen day's meets in time order as
     rows. A row opens the club's sheet, whose "I'm going" opens the plan
     composer filled in. Under it, "Every club and league in town" opens
     clubs.html. #people/clubs lands on it; #people/rc-<club>-<date>-<hhmm>
     (What Now's cards) picks that day, flashes the row and opens the sheet;
     #people/club-<id> opens the sheet.
   - Open to strangers this week. Readers' plans on the people board (kind
     "plan": what, when, where, how many spots, who it is for, a rough age
     band) sorted soonest first, past ones gone, the ones that fit the
     reader first. Chips filter by Meetup, by age band and by activity (the
     activity is read off the plan's words with MATCH; the board has no
     field for it). "I'd go" is the board's vote, shown as a going count.
   - Mixers. Stephen's own Meetup events first, as a short row (Show all
     opens it into a list with a Collapse bar; "Steve" on the page) (the
     newsletter's golden rule: his own events are never missed, with no
     Meetup interest counts), then a seven-day strip of every mixer on the
     guide's events calendar (all-day/data/whatnow.json, which
     refresh-allday rebuilds daily: socials, singles, networking and tech
     meetups, trivia and game nights, run club socials, pickup, language
     tables, other Meetup groups; people-match.js's mixerKind) and the
     readers' approved gatherings, marked as reader-posted. A link to the
     full events calendar, and a card asking people to host.
   - Clubs. data/groups.json's groups that fit the reader, or a featured one
     and a fresh handful each visit, and the clubs page.
   - The quiz. Seven plain questions; it never asks age, gender or
     orientation. It ends in a suggested archetype, your three groups, your
     best upcoming mixer and a plan composer filled in for your kind of
     thing.
   - People here. Signed in: the people who switched their handles on
     (boards.handlesRecent: first name, neighborhood, handles that open the
     app), newest first in a "Just joined" row, and the opt-in directory
     (first name, neighborhood, archetype, what you're into). Never an email
     or an account id. Signed out: one line and Sign in.
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
import { el, esc, safeHref, ICON, mark, section, chips, pills, button, cards, meetRow, rail } from '../ui.js';
import * as cw from '../clubs-week.js';
import { MATCH, KIND_WORDS, bestFor, fitsText, mixerKind, MIXER_WORDS, handleLink, gatheringWhen } from '../people-match.js';
import { RULES, ARCHETYPE_LABELS, NEIGHBORHOOD_LABELS, HANDLE_LABELS, message, checkPost } from '../boards-core.js';

const KEY = 'people';
const GROUPS_URL = '../data/groups.json';
const CLUBS_PAGE = '../clubs.html';
const EVENTS_PAGE = '../events.html';   // the guide's full events calendar
/* Becoming a host starts with an email to Stephen; coffee, then the calendar */
const HOST_MAIL = 'mailto:btownbrief@gmail.com?subject=' + encodeURIComponent('I’d like to host something with the crew') + '&body=' +
  encodeURIComponent('Hi Steve,\n\nI’d like to host something for the Btown Brief crew.\n\nWhat I’d host:\nWhen:\nWhere:\n\nA good time for coffee:\n');
const RUN_CLUBS_URL = '../data/run-clubs.json';
const MEETUP_GROUP = 'https://www.meetup.com/burlington-social-activites-group/';
/* Stephen's own Meetup calendar: Up For It's copy of the group's iCal,
   refreshed every six hours and a month deep (up-for-it/.github/workflows/
   meetup.yml). The events file only looks ten days ahead, so this is what
   makes "every one of his events in the next two weeks" true. */
const MEETUP_FEED = 'https://play.btownbrief.com/up-for-it/data/meetup.json';
const CH_FIND = 'https://www.btownbrief.com/community/channels/music';               // "Find Each Other"; the slug is historical
const CH_PLANS = 'https://www.btownbrief.com/community/channels/meetups-hangouts';   // "Plans & Meetups"
const TELEGRAM_URL = '../telegram.html';
/* Stephen's general group chat. The card at the top of the tab shows only
   while this is a real https://t.me/ link; set it to '' or 'TODO' and the
   card hides. Never the movie / TV watch chat. */
const GROUP_CHAT_URL = 'https://t.me/+pULrkkS4vjBiZjEx';
const chatLink = (u) => (/^https:\/\/t\.me\/\+?[\w-]{4,}\/?$/.test(String(u || '')) ? String(u) : '');
const STORE_KEY = 'allday-people';
const DAY = 86400000;
const MIX_DAYS = 14;          // Stephen's events this far ahead, every one of them
const CAL_DAYS = 7;           // the calendar's mixers: today and the six days after
const PAST_GRACE = 3 * 3600000;   // a plan stays up this long after its start
const CLUBS_SHOWN = 6;
const FOR_YOU = 3;
const HANDLES_SHOWN = 40, JUST_JOINED = 8;

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
  ['women', 'A woman finding my people'], ['lgbtq', 'LGBTQ+, finding my people'], ['sober', 'Sober']];
/* the short name of each tile, for the line over the For you strip */
const TAG_NAME = { student: 'college students', grad: 'recent grads', moved: 'people new to town', older: 'older adults', women: 'women',
  lgbtq: 'LGBTQ+', sober: 'Sober' };
/* what you are into: the ones the directory may show, if you join it */
const INTO = [['sports', 'An athlete'], ['games', 'A gamer'], ['running', 'A runner'], ['outdoors', 'Outdoorsy'], ['music', 'Into live music'],
  ['dance', 'A dancer'], ['books', 'A reader'], ['making', 'A maker'], ['languages', 'Learning a language'], ['food', 'Into food and drink']];
const INTEREST_WORDS = { sports: 'pickup sports', running: 'running', outdoors: 'the outdoors', games: 'games', music: 'live music', dance: 'dancing',
  books: 'books', making: 'making things', languages: 'languages', food: 'food and drink' };
const AGES = { twenties: 'Mostly 20s', thirties: 'Mostly 30s', forties: 'Mostly 40s', fifties: '50 and up', any: 'Any age' };

const AGE_CHIP = { twenties: '20s', thirties: '30s', forties: '40s', fifties: '50+' };
const ACT_CHIP = { sports: 'Sports', running: 'Running', outdoors: 'Outdoors', games: 'Games', music: 'Music', dance: 'Dancing', books: 'Books',
  making: 'Making', languages: 'Languages', food: 'Food & drink' };
/* the plan the quiz suggests posting, by what it learned (first tag, else the archetype) */
const PLAN_IDEAS = { new: 'Coffee and a walk, new in town', regular: 'Trivia night, need a team', trail: 'Saturday hike, who’s in?',
  games: 'Board game night, need players', running: 'Easy group run, all paces', sports: 'Pickup game, need a few more',
  outdoors: 'Sunset walk on the bike path', music: 'Live music this week, who’s going?', dance: 'Going dancing, come along',
  books: 'Bookstore browse, then coffee', making: 'Craft night, bring a project', languages: 'Language swap over coffee', food: 'Trying a new spot, join me' };
const GATH_WORDS = { pickup: 'Pickup', league: 'League', 'board-games': 'Board games', run: 'Run', social: 'Social', music: 'Music', other: 'Gathering' };

/* Stephen's own events (newsletter AGENTS.md, "Stephen's OWN events are never missed") */
const OWN_URL = /meetup\.com\/burlington-social-activiti?es-group\//i;
const OWN_NAME = /btown brief|btown coffee club|burlington social activities group/i;
export const isOwnEvent = (e) => !!e && (OWN_URL.test(String(e.url || '')) ||
  OWN_NAME.test([e.title, e.venue, (Array.isArray(e.tags) ? e.tags : []).join(' ')].join(' ')));

/* ----------------------------------------------------------------- the quiz */
/* Each answer leans toward archetypes (a) and adds what you're into (t).
   Never age, gender or orientation. */
const QUIZ = [
  { q: 'When are you most free to go out?', o: [
    ['Weeknights', { a: { regular: 2, games: 1 } }], ['Weekends', { a: { trail: 2, new: 1 } }], ['Whenever', { a: { new: 1, regular: 1 } }]] },
  { q: 'Outside or inside?', o: [
    ['Outside, most weather', { a: { trail: 3 }, t: ['outdoors'] }], ['Inside and warm', { a: { games: 2, regular: 1 } }], ['Depends on the day', { a: { new: 1 } }]] },
  { q: 'A big friendly crowd, or three people?', o: [
    ['A big friendly crowd', { a: { new: 2, regular: 1 } }], ['Three or four people', { a: { games: 2, trail: 1 } }], ['One or two others', { a: { trail: 1, regular: 1 } }]] },
  { q: 'Talk, or do something?', o: [
    ['Talk: coffee, a drink', { a: { regular: 2, new: 1 } }], ['Do: a game, a run, a project', { a: { games: 1, trail: 1 } }], ['A bit of both', { a: { new: 1 } }]] },
  { q: 'New here, or settled?', o: [
    ['Here less than a year', { a: { new: 3 } }], ['A few years', { a: { regular: 1 } }], ['Here a long time', { a: { regular: 2 } }]] },
  { q: 'What would get you out of the house?', o: [
    ['A trail or the lake', { a: { trail: 2 }, t: ['outdoors'] }], ['A game or trivia night', { a: { games: 2 }, t: ['games'] }],
    ['Live music or a dance', { a: { regular: 2 }, t: ['music', 'dance'] }], ['A pickup game or a run', { a: { games: 1, trail: 1 }, t: ['sports', 'running'] }],
    ['A book club or a language table', { a: { regular: 1, new: 1 }, t: ['books', 'languages'] }], ['Making something', { a: { new: 1, regular: 1 }, t: ['making'] }],
    ['Good food with new people', { a: { new: 2 }, t: ['food'] }]] },
  { q: 'How do you like to meet people?', o: [
    ['The same thing every week', { a: { regular: 2 } }], ['Try something once', { a: { new: 2 } }], ['Someone else plans it, I show up', { a: { new: 1, games: 1 } }]] },
];
const ORDER = ['new', 'regular', 'trail', 'games'];
export function quizResult(picks) {
  const score = { new: 0, regular: 0, trail: 0, games: 0 };
  const tags = [];
  picks.forEach((p, i) => {
    const o = QUIZ[i] && QUIZ[i].o[p] && QUIZ[i].o[p][1];
    if (!o) return;
    Object.entries(o.a || {}).forEach(([k, n]) => { score[k] += n; });
    (o.t || []).forEach((t) => { if (!tags.includes(t)) tags.push(t); });
  });
  const arch = ORDER.reduce((best, k) => (score[k] > score[best] ? k : best), ORDER[0]);
  return { arch, tags: tags.slice(0, PEOPLE_RULES.interestsMax) };
}
export const QUIZ_TEXT = () => QUIZ.map((x) => [x.q].concat(x.o.map((o) => o[0])).join(' | ')).join('\n');

/* ---------------------------------------------------------------- state */
const S = {
  arch: null, tags: [], quizTags: [],   // the reader's picks (this device)
  intoUp: [],                          // readers whose into-tags this device has squared with their profile once
  prof: undefined,                     // the profile when signed in: undefined not asked, null none
  posts: [], plansState: 'loading',    // 'loading' | 'ok' | 'off' | 'fail'
  events: null, eventsFailed: false, feed: null, groups: null, groupsFailed: false,
  gath: [], gathDone: false,           // approved reader gatherings (the gatherings board)
  mixDay: null,                        // the day picked on the mixers' strip, for the visit
  ownAll: false,                       // his own mixers opened from the row into a list, for the visit
  dir: null,                           // { count, me, people } | { error }
  handles: null,                       // signed in: { state: 'loading' | 'ok' | 'off' | 'fail', people }
  filter: 'all', fAge: null, fAct: null, // the plans' chips: Meetup, an age band, an activity
  q: null,                             // the quiz in progress or done
  rc: null, rcFailed: false,           // data/run-clubs.json's clubs
  rcKind: null, rcDay: null,           // the Run / Fitness switch and the day picked on the strip, for the visit
};
let root = null, slots = null, pending = null, demoD = null, plansRun = 0;
const SECS = [['arch', 'Who you are'], ['clubs', 'Run clubs'], ['plans', 'Open to strangers'], ['mix', 'Mixers'], ['groups', 'Clubs'], ['quiz', 'Quiz'], ['dir', 'People here']];
/* every tile and tag the reader has picked, as MATCH keys: the archetype
   as 'a:<tile>', then the tags, then what the quiz learned */
const picks = () => (S.arch ? ['a:' + S.arch] : []).concat(S.tags, S.quizTags.filter((t) => !S.tags.includes(t))).filter((k) => MATCH[k]);
const quizKeys = (res) => ['a:' + res.arch].concat(res.tags).filter((k) => MATCH[k]);

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
  off: 'The directory opens soon.',
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

/* The people who switched their handles on, newest first: the foundation
   answers only a signed-in reader, and only with switched-on profiles. A
   handle that isn't the shape its service allows is dropped here too. */
let hRun = 0;
const HANDLE_RE = Object.fromEntries(Object.entries(RULES.handles).map(([k, p]) => [k, new RegExp(p)]));
const handleRow = (p) => {
  const h = {};
  Object.entries(p && p.handles && typeof p.handles === 'object' ? p.handles : {}).forEach(([k, v]) => {
    if (HANDLE_LABELS[k] && HANDLE_RE[k] && typeof v === 'string' && HANDLE_RE[k].test(v.trim())) h[k] = v.trim();
  });
  return { name: String(p.display_name || '').trim(), neighborhood: NEIGHBORHOOD_LABELS[p.neighborhood] ? p.neighborhood : null, handles: h,
    day: typeof p.updated_at === 'string' ? p.updated_at : '', me: p.me === true };
};
function loadHandles() {
  const run = ++hRun, u = who();
  if (!u) { S.handles = null; drawDir(); return Promise.resolve(); }
  if (!S.handles) S.handles = { state: 'loading', people: [] };
  return boards.handlesRecent(null, HANDLES_SHOWN).then((r) => {
    if (run !== hRun || u !== who()) return;
    S.handles = r.ok ? { state: 'ok', people: r.people.map(handleRow).filter((p) => p.name && Object.keys(p.handles).length) }
      : { state: r.error === 'off' ? 'off' : 'fail', people: [] };
    drawDir();
  });
}

/* the gatherings board's approved posts (premoderated: the list only ever
   has the approved ones); before round four the board isn't there */
let gRun = 0;
function loadGatherings() {
  const run = ++gRun;
  return boards.list('gatherings', { kind: 'gathering', limit: RULES.limits.listMax }).then((r) => {
    if (run !== gRun) return;
    S.gath = r.ok ? r.posts : [];
    S.gathDone = true;
    drawMix();
    land();
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
  data.fetchJSON(GROUPS_URL, 8000).then((j) => {
    if (!j || !Array.isArray(j.groups)) throw new Error('bad shape');
    S.groups = j.groups;
  }).catch(() => { S.groupsFailed = true; }).then(() => { drawForYou(); drawGroups(); drawQuiz(); land(); });
  data.fetchJSON(RUN_CLUBS_URL, 8000).then((j) => {
    if (!j || !Array.isArray(j.clubs)) throw new Error('bad shape');
    S.rc = j.clubs;
  }).catch(() => { S.rcFailed = true; }).then(() => { drawClubs(); drawForYou(); land(); });
  loadPlans();
  loadGatherings();
  loadProfile().then(() => Promise.all([loadDir(), loadHandles()]));
}

function loadDemo() {
  return app.demoData(KEY).then((d) => {
    demoD = redate(d);
    seedDemo(demoD);
    S.events = demoD.events;
    S.groups = demoD.groups;
    render();
    app.demoData('run-clubs').then((j) => { S.rc = cw.redateDemo(j, Date.now()).clubs; }, () => { S.rcFailed = true; }).then(() => { drawClubs(); drawForYou(); land(); });
    loadPlans();
    loadGatherings();
    loadProfile().then(() => Promise.all([loadDir(), loadHandles()]));
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
  if (!quiet) app.toast(S.arch ? 'You’re here as ' + ARCHETYPE_LABELS[S.arch].toLowerCase() : 'Cleared');
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
/* The clubs list: with picks, the groups that fit best (one per kind
   first); without, the featured one and a fresh handful each visit. */
const shuffleSeed = Math.random();
const spin = (s) => { let h = 2166136261; for (const c of String(s) + shuffleSeed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };
const usableGroup = (g) => !!g && !!g.name && /^https?:/i.test(String(g.url || ''));
function groupsFor(n, keys = picks()) {
  const list = (S.groups || []).filter(usableGroup);
  if (keys.length) {
    const fit = bestFor(keys, list, [], n).map((x) => x.it);
    if (fit.length) return fit;
  }
  const featured = list.filter((g) => g.featured);
  return featured.concat(list.filter((g) => !g.featured).sort((a, b) => spin(a.id || a.name) - spin(b.id || b.name))).slice(0, n);
}
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
    k: 'mx-' + String(e.id || slug(e.title + '-' + e.date)), href: e.url, own: true,
    title: e.title, dow: EV_DOW.format(dt), dom: EV_DOM.format(dt), when: e.allDay ? 'All day' : clock(dt), where, at: x.t, date: e.date,
  };
}

/* The calendar's mixers, today and the six days after, and the readers'
   approved gatherings, as one list of rows: { k, title, href, date, at,
   allDay, where, kind, label, reader, post }. Stephen's own are left out
   here (they lead the section in their own row); the same event listed
   twice (same day, start and venue, or same day and title) shows once. */
const DAY_KEY = (ms) => cw.dateKey(cw.et(ms));
function weekKeys(now) {
  const t = cw.et(now);
  const out = [];
  for (let i = 0; i < CAL_DAYS; i++) out.push(cw.dateKey(cw.addDays({ y: t.y, mo: t.mo, d: t.d }, i)));
  return out;
}
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/s\b/g, '').trim();
function calMixers(now = Date.now()) {
  const days = new Set(weekKeys(now));
  const seen = new Set(), out = [];
  (S.events || []).forEach((e) => {
    if (!e || isOwnEvent(e)) return;
    const kind = mixerKind(e);
    if (!kind || !days.has(e.date)) return;
    const allDay = !!e.allDay || !/T\d/.test(String(e.start || ''));
    const [y, mo, d] = String(e.date).split('-').map(Number);
    const at = allDay ? cw.wall(y, mo, d, 0, 0) : Date.parse(e.start);
    if (!at) return;
    const end = allDay ? cw.wall(y, mo, d, 23, 59) : (Date.parse(e.end) || at + 2 * 3600000);
    if (end <= now) return;
    const venue = String(e.venue || '').trim();
    const k1 = e.date + '|' + at + '|' + venue.toLowerCase(), k2 = e.date + '|' + norm(e.title);
    if ((venue && seen.has(k1)) || seen.has(k2)) return;
    seen.add(k1); seen.add(k2);
    out.push({ k: 'mc-' + String(e.id || slug(e.title + '-' + e.date)), title: String(e.title), href: e.url, date: e.date, at, allDay,
      where: [venue, e.town && e.town !== 'Burlington' ? e.town : ''].filter(Boolean).join(', '), kind, label: MIXER_WORDS[kind], reader: false });
  });
  (S.gath || []).forEach((p) => {
    const m = p && p.meta && typeof p.meta === 'object' ? p.meta : {};
    const w = gatheringWhen(m.when);
    if (!w || !days.has(w.date)) return;
    if ((w.allDay ? cw.wall(...w.date.split('-').map(Number), 23, 59) : w.at + 2 * 3600000) <= now) return;
    const link = /^https?:\/\//i.test(String(m.link || '')) ? String(m.link) : null;
    out.push({ k: 'g-' + p.id, title: String(p.title || ''), href: link, date: w.date, at: w.at, allDay: w.allDay,
      where: String(m.place || p.place || ''), kind: 'reader', label: GATH_WORDS[m.kind] || 'Gathering', reader: true, post: p });
  });
  return out.sort((a, b) => a.at - b.at || a.title.localeCompare(b.title));
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
    ['chat', 'arch', 'foryou', 'clubs', 'plans', 'mix', 'host', 'groups', 'quiz', 'dir', 'talk'].forEach((k) => { const s = el('div'); s.dataset.sec = k; slots[k] = s; root.appendChild(s); });
    root.appendChild(el('div', 'spacer'));
  }
  drawChat(); drawArch(); drawForYou(); drawClubs(); drawPlans(); drawMix(); drawHost(); drawGroups(); drawQuiz(); drawDir(); drawTalk();
}

/* The group chat, first thing on the tab: a title, one line, one button.
   Nothing shows until GROUP_CHAT_URL is a real t.me link. */
function drawChat() {
  const s = slots && slots.chat;
  if (!s) return;
  s.innerHTML = '';
  const url = chatLink(GROUP_CHAT_URL);
  s.hidden = !url;
  if (!url) return;
  const tc = el('div', 'textcard chatcard', '<h3 class="serif">Join the group chat</h3><p>Ask what’s on, find someone to go with, meet people here.</p>');
  tc.dataset.chat = '1';
  const r = el('div', 'row');
  r.appendChild(linkBtn('Join on Telegram', url, 'btn'));
  tc.appendChild(r);
  s.appendChild(tc);
  s.appendChild(el('div', 'spacer'));
}

function drawArch() {
  const s = slots && slots.arch;
  if (!s) return;
  s.innerHTML = '';
  sec(s, 'Who are you here as?');
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
}

/* -------------------------------------------------------------- for you */
/* Right under the tiles: the three best groups for what is picked, the
   moment anything is. A group opens its own page; a run or fitness club
   opens its sheet. Nothing picked, nothing here. */
const NEXT_WORDS = new Intl.DateTimeFormat('en-US', { timeZone: BTV, weekday: 'short' });
function nextWords(o) {
  if (!o) return '';
  const today = DAY_KEY(Date.now()), tomorrow = cw.dateKey(cw.addDays(cw.et(Date.now()), 1));
  return (o.date === today ? 'Today' : o.date === tomorrow ? 'Tomorrow' : NEXT_WORDS.format(new Date(o.at))) + ' ' + o.time;
}
/* a group, or a run club, as one list row */
function matchRow(x, key) {
  const it = x.it;
  const next = x.type === 'club' ? x.next : cw.nextMeet([it], Date.now());
  const sub = [KIND_WORDS[x.kind] || 'Club', next ? nextWords(next) : (it.town || '')].filter(Boolean).join(' · ');
  const inner = mark(it.name, 'round lg') + '<div><div class="t">' + esc(it.name) + '</div><div class="s one">' + esc(sub) + '</div></div>';
  let r;
  if (x.type === 'club') {
    r = el('button', 'lrow mixrow', inner + ICON.right);
    r.type = 'button';
    r.addEventListener('click', () => clubSheet(it, next));
  } else {
    r = el('a', 'lrow', inner + ICON.ext);
    r.href = safeHref(it.url);
    r.target = '_blank';
    r.rel = 'noopener';
  }
  r.dataset.k = key + ':' + (it.id || slug(it.name));
  r.dataset.kind = x.kind;
  return r;
}
function drawForYou() {
  const s = slots && slots.foryou;
  if (!s) return;
  s.innerHTML = '';
  const keys = picks();
  s.hidden = !keys.length;
  if (!keys.length) return;
  /* say what the strip is showing, in the names of what is picked */
  const names = keys.map((k) => (k.startsWith('a:') ? ARCHETYPE_LABELS[k.slice(2)] : TAG_NAME[k] || INTEREST_WORDS[k] || k));
  const list = names.length < 3 ? names.join(' and ') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  sec(s, 'For you', 'Groups and clubs for ' + list + '.');
  const box = el('div', 'foryou');
  box.dataset.foryou = keys.join(' ');
  s.appendChild(box);
  if (!S.groups && !S.groupsFailed) { box.appendChild(el('p', 'loading', 'One moment…')); return; }
  const best = bestFor(keys, (S.groups || []).filter(usableGroup), (S.rc || []).filter(usableClub), FOR_YOU, Date.now());
  if (!best.length) { box.appendChild(el('p', 'note', 'Nothing yet for that.')); return; }
  best.forEach((x) => box.appendChild(matchRow(x, 'fy')));
}

/* ------------------------------------------------------ the club week */
const usableClub = (c) => !!c && /^https?:/i.test(String(c.url || ''));
const runClub = (c) => usableClub(c) && cw.isRun(c);
const fitClub = (c) => usableClub(c) && cw.isFitness(c);
/* Run unless the reader picked something other than running and nothing of it */
function rcKind() {
  if (S.rcKind) return S.rcKind;
  const t = S.tags.concat(S.quizTags);
  return !t.includes('running') && (t.includes('sports') || t.includes('outdoors')) ? 'fit' : 'run';
}
const DAY_WORD = { mon: 'Mondays', tue: 'Tuesdays', wed: 'Wednesdays', thu: 'Thursdays', fri: 'Fridays', sat: 'Saturdays', sun: 'Sundays' };
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function drawClubs() {
  const s = slots && slots.clubs;
  if (!s) return;
  s.innerHTML = '';
  const kind = rcKind();
  const sw = pills([['run', 'Run'], ['fit', 'Fitness']], kind, (v) => { S.rcKind = v; S.rcDay = null; drawClubs(); });
  sw.dataset.rcKind = kind;
  sec(s, kind === 'run' ? 'Run clubs this week' : 'Fitness this week', '', sw);
  /* the clubs page, right under the week, whatever state the week is in */
  const every = () => { const r = el('div', 'addrow'); r.dataset.everyClub = '1'; r.appendChild(linkBtn('Every club and league in town', CLUBS_PAGE, 'ghost')); s.appendChild(r); };
  if (!S.rc) { s.appendChild(el('p', S.rcFailed ? 'note pad' : 'loading', S.rcFailed ? 'The clubs didn’t load.' : 'One moment…')); every(); return; }
  const now = Date.now();
  const week = cw.weekStrip(S.rc, now, kind === 'run' ? runClub : fitClub).map((d) => ({ ...d, meets: d.meets.filter((o) => !o.past) }));
  if (!week.some((d) => d.key === S.rcDay)) S.rcDay = (week.find((d) => d.meets.length) || week[0]).key;
  const days = el('div', 'days');
  days.dataset.week = week[0].key;
  week.forEach((d) => {
    const on = d.key === S.rcDay;
    const b = el('button', (on ? 'on' : '') + (d.meets.length ? '' : ' none'),
      '<span class="wd">' + esc(d.today ? 'Today' : d.wd) + '</span><span class="dd">' + esc(d.d) + '</span><span class="n">' + esc(d.meets.length || '') + '</span>');
    b.type = 'button';
    b.dataset.day = d.key;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-label', (d.today ? 'Today' : d.wd) + ' ' + d.d + ': ' + plural(d.meets.length, 'meet', 'meets'));
    b.addEventListener('click', () => { S.rcDay = d.key; drawClubs(); });
    days.appendChild(b);
  });
  s.appendChild(days);
  const day = week.find((d) => d.key === S.rcDay);
  const list = el('div', 'meets');
  list.dataset.meets = day.key;
  day.meets.forEach((o) => { const r = meetRow(o, (x) => clubSheet(x.club, x)); if (r) list.appendChild(r); });
  if (list.children.length) s.appendChild(list);
  else s.appendChild(el('p', 'note pad', esc(day.today ? 'Nothing left today.' : 'Nothing this day.')));
  every();
}

/* The club's sheet: what it is, every meet, the facts, its links, and the
   one button. `o` is the meet the reader tapped (or the club's next one). */
function clubSheet(c, o) {
  const next = o || cw.nextMeet([c], Date.now());
  app.sheet(c.name, (body) => {
    body.classList.add('clubsheet');
    body.dataset.clubSheet = c.id;
    if (c.what) body.appendChild(el('p', 'pick-why', esc(c.what)));
    const today = cw.dateKey(cw.et(Date.now()));
    /* a meet whose dated run is over is not one of its meets any more */
    const meets = (Array.isArray(c.meets) ? c.meets : []).filter((m) => m && DAY_WORD[m.day] && !(typeof m.until === 'string' && m.until < today))
      .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || String(a.time).localeCompare(String(b.time)));
    if (meets.length) {
      body.appendChild(el('div', 'sheet-h', esc(meets.length === 1 ? 'The meet' : 'The meets')));
      meets.forEach((m) => {
        const row = el('div', 'sheet-row');
        row.dataset.meet = m.day + '-' + m.time;
        const sub = [m.where, spanWords(m), m.season ? m.season : '', m.note].filter(Boolean).join(' · ');
        row.appendChild(el('div', 't', '<b>' + esc(DAY_WORD[m.day] + ', ' + cw.timeLabel(m.time)) + '</b>' + (sub ? '<div class="d">' + esc(sub) + '</div>' : '')));
        const map = cw.mapUrl(m);
        if (map) row.appendChild(linkBtn('Map', map, 'ghost sm'));
        body.appendChild(row);
      });
    } else if (c.schedule_note) body.appendChild(el('p', 'sheet-note', esc(c.schedule_note)));
    [['Pace', c.level], ['Cost', c.cost], ['Season', c.season], ['Newcomers', c.newcomers]].forEach(([label, v]) => {
      if (!v || !String(v).trim()) return;
      const row = el('div', 'sheet-row');
      row.dataset.fact = label.toLowerCase();
      row.appendChild(el('div', 't', '<b>' + esc(label) + '</b><div class="d">' + esc(v) + '</div>'));
      body.appendChild(row);
    });
    const links = el('div', 'linkrow');
    links.dataset.links = '1';
    [['Site', c.url], ['Instagram', c.instagram], ['Meetup', c.meetup], ['Strava', c.strava]].forEach(([label, href]) => {
      if (/^https?:/i.test(String(href || '')) && !(label === 'Site' && (href === c.instagram || href === c.meetup || href === c.strava))) links.appendChild(linkBtn(label, href));
    });
    if (links.children.length) body.appendChild(links);
    if (next) {
      const go = el('div', 'linkrow go');
      const b = button(ICON.check + ' I’m going', '', () => planSheet(planFor(c, next)));
      b.dataset.going = next.k;
      go.appendChild(b);
      body.appendChild(go);
    }
  });
}

/* a meet's own dates, in words: "Nov 30 to Dec 14", "until Oct 28", "from Nov 7" */
const SHORT_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
function spanWords(m) {
  const w = (k) => (typeof m[k] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m[k]) ? SHORT_DAY.format(new Date(m[k] + 'T12:00:00Z')) : '');
  const a = w('from'), b = w('until');
  return a && b ? a + ' to ' + b : b ? 'until ' + b : a ? 'from ' + a : '';
}

/* the plan a club's meet makes: its name, its day and time, its place */
function planFor(c, o) {
  const x = et(o.at);
  const m = o.meet || {};
  const town = String(m.address || '').split(',').slice(1).join(',').trim();
  const place = (m.where || '') + (town && !String(m.where || '').includes(town) ? ', ' + town : '');
  return { title: String(c.name).slice(0, RULES.limits.titleMax), day: dayLabel(x), time: timeWord(x.h, x.mi), place: place.slice(0, RULES.limits.placeMax) };
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

/* what a plan is, read off its words: the into-tags whose MATCH words it uses */
const planText = (p) => [p.title, p.body, p.place].filter(Boolean).join(' ');
const planActs = (p) => Object.keys(ACT_CHIP).filter((k) => fitsText(planText(p), [k]));
const ageFits = (p, a) => !a || p.meta.ages === a || p.meta.ages === 'any';
const upcomingPlans = () => S.posts.filter((p) => p.at == null || p.at > Date.now() - PAST_GRACE);
function sortedPlans() {
  const keys = picks();
  /* for you: your tile's plans, or a plan whose words fit what you picked */
  const fit = (p) => ((S.arch && (p.meta.arch === S.arch || p.author_arch === S.arch)) || fitsText(planText(p), keys) ? 0 : 1);
  return upcomingPlans()
    .filter((p) => S.filter !== 'meetup' || p.meta.meetup)
    .filter((p) => ageFits(p, S.fAge))
    .filter((p) => !S.fAct || planActs(p).includes(S.fAct))
    .sort((a, b) => fit(a) - fit(b) || (a.at == null) - (b.at == null) || (a.at || 0) - (b.at || 0) || Date.parse(b.created_at) - Date.parse(a.created_at));
}

function drawPlans() {
  const s = slots && slots.plans;
  if (!s) return;
  s.innerHTML = '';
  const post = button(ICON.plus + ' Post a plan', 'ghost sm', () => planSheet());
  post.dataset.post = '1';
  sec(s, 'Open to strangers this week', '', post);
  if (S.plansState === 'loading') { s.appendChild(el('p', 'loading', 'Finding this week’s plans…')); return; }
  if (S.plansState !== 'ok') {
    s.appendChild(el('div', 'textcard', '<p>' + esc(S.plansState === 'off' ? 'Plans open soon.' : message('offline')) + '</p>'));
    return;
  }
  const upcoming = upcomingPlans();
  const asked = upcoming.filter((p) => p.meta.meetup).length;
  if (!asked) S.filter = 'all';
  /* the chips: Meetup, each age band and each activity the plans have */
  const ages = Object.keys(AGE_CHIP).map((a) => [a, upcoming.filter((p) => p.meta.ages === a).length]).filter(([a, n]) => n || S.fAge === a);
  const acts = Object.keys(ACT_CHIP).map((a) => [a, upcoming.filter((p) => planActs(p).includes(a)).length]).filter(([a, n]) => n || S.fAct === a);
  if (!ages.some(([a]) => a === S.fAge)) S.fAge = null;
  if (!acts.some(([a]) => a === S.fAct)) S.fAct = null;
  if (asked || (upcoming.length > 1 && (ages.length || acts.length))) {
    const none = S.filter === 'all' && !S.fAge && !S.fAct;
    const items = [{ key: 'all', label: 'All plans', n: upcoming.length, cls: none ? 'on' : '' }]
      .concat(asked ? [{ key: 'meetup', label: 'Down for Meetup', n: asked, cls: S.filter === 'meetup' ? 'on' : '' }] : [])
      .concat(ages.map(([a, n]) => ({ key: 'age:' + a, label: AGE_CHIP[a], n, cls: S.fAge === a ? 'on' : '' })))
      .concat(acts.map(([a, n]) => ({ key: 'act:' + a, label: ACT_CHIP[a], n, cls: S.fAct === a ? 'on' : '' })));
    const row = chips(items, null, (k) => {
      if (k === 'all') { S.filter = 'all'; S.fAge = null; S.fAct = null; }
      else if (k === 'meetup') S.filter = S.filter === 'meetup' ? 'all' : 'meetup';
      else if (/^age:/.test(k)) S.fAge = S.fAge === k.slice(4) ? null : k.slice(4);
      else if (/^act:/.test(k)) S.fAct = S.fAct === k.slice(4) ? null : k.slice(4);
      drawPlans();
    });
    row.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c.classList.contains('on') ? 'true' : 'false'));
    row.dataset.filter = '1';
    s.appendChild(row);
  }
  const list = sortedPlans();
  if (!list.length && upcoming.length) {
    s.appendChild(el('p', 'note pad', 'No plans like that yet.'));
    return;
  }
  if (list.length) {
    const f = feed(s);
    f.dataset.plans = '1';
    app.bindFeed(f);
    list.forEach((p) => { const n = planCard(p); if (n) f.appendChild(n); });
    watchGoing(f);
  } else {
    const tc = el('div', 'textcard', '<h3 class="serif">No plans yet this week.</h3>');
    const r = el('div', 'row');
    r.appendChild(button('Post the first plan', '', () => planSheet()));
    tc.appendChild(r);
    s.appendChild(tc);
  }
}

/* Mixers: Stephen's own first as a short row, then the week's mixers from
   the whole calendar and the readers' gatherings, one day at a time. */
function ownTile(it) {
  const a = el('a', 'owntile', '<span class="eyebrow">' + esc(it.dow + ' ' + it.dom) + '</span><b>' + esc(it.title) + '</b><span class="s">' +
    esc(it.when + ' · ' + it.where) + '</span>');
  a.href = safeHref(it.href);
  a.target = '_blank';
  a.rel = 'noopener';
  a.dataset.k = it.k;
  return a;
}
function mixRow(it, fits) {
  const [hm, ap] = it.allDay ? ['All', 'day'] : timeWord(cw.et(it.at).h, cw.et(it.at).mi).split(' ');
  const sub = [it.where, it.label].filter(Boolean).join(' · ');
  const inner = '<span class="th tm"><b>' + esc(hm) + '</b><span>' + esc(ap || '') + '</span></span>' +
    '<div><div class="t">' + esc(it.title) + '</div><div class="s one">' + esc(sub) + '</div>' +
    (it.reader || fits ? '<div class="s tags">' + (it.reader ? '<span class="tag tag-local">Reader-posted</span>' : '') +
      (fits ? '<span class="tag tag-own">For you</span>' : '') + '</div>' : '') + '</div>';
  let r;
  if (it.href) {
    r = el('a', 'lrow meet mixrow', inner + ICON.ext);
    r.href = safeHref(it.href);
    r.target = '_blank';
    r.rel = 'noopener';
  } else {
    r = el('button', 'lrow meet mixrow', inner + ICON.right);
    r.type = 'button';
    r.addEventListener('click', () => gatheringSheet(it));
  }
  r.dataset.k = it.k;
  r.dataset.kind = it.kind;
  if (it.reader) r.dataset.reader = '1';
  return r;
}
/* a reader's gathering with no link of its own: its sheet says the rest */
function gatheringSheet(it) {
  const p = it.post || {};
  app.sheet(it.title, (body) => {
    body.dataset.gathering = p.id || '';
    const when = (it.allDay ? '' : clock(new Date(it.at)) + ', ') + EV_DAY.format(new Date(it.at));
    body.appendChild(el('p', 'sheet-note', esc([when, it.where, it.label].filter(Boolean).join(' · '))));
    if (p.body) body.appendChild(el('p', 'pick-why', esc(p.body)));
    if (p.author) body.appendChild(el('p', 'sheet-note', esc('Posted by ' + p.author)));
  });
}
function drawMix() {
  const s = slots && slots.mix;
  if (!s) return;
  s.innerHTML = '';
  const full = linkBtn('Full events calendar', EVENTS_PAGE);
  full.dataset.calendar = '1';
  sec(s, 'Mixers', '', full);
  const settled = (S.events || S.eventsFailed) && (app.demo || S.feed);
  const keys = picks();
  /* his own, every one in the next two weeks */
  const own = mixers().map(mixerItem);
  if (!own.length && !settled) { s.appendChild(el('p', 'loading', 'Reading the calendar…')); return; }
  const ownWrap = el('div');
  ownWrap.dataset.own = '1';
  s.appendChild(ownWrap);
  if (own.length) {
    /* the row, or every one of them in a list that scrolls down; a
       Collapse bar stays in reach while the list is on screen */
    const head = el('div', 'subrow');
    head.appendChild(el('p', 'subh', '<b>Btown Brief IRL</b>'));
    const many = own.length > 1;
    if (!many) S.ownAll = false;
    if (many) {
      const t = button(S.ownAll ? 'Show less' : 'Show all ' + own.length, 'ghost sm', () => {
        S.ownAll = !S.ownAll;
        drawMix();
        if (!S.ownAll) jumpBack();
        ownToggle();
      });
      t.type = 'button';
      t.dataset.ownAll = S.ownAll ? 'open' : 'closed';
      t.setAttribute('aria-expanded', S.ownAll ? 'true' : 'false');
      head.appendChild(t);
    }
    ownWrap.appendChild(head);
    let track;
    if (S.ownAll && many) {
      const wrap = el('div', 'expwrap');
      track = el('div', 'ownlist');
      wrap.append(track, collapseBar('Btown Brief IRL', () => { S.ownAll = false; drawMix(); jumpBack(true); ownToggle(); }));
      ownWrap.appendChild(wrap);
    } else track = rail(ownWrap);
    track.dataset.mixers = '1';
    own.forEach((it) => track.appendChild(ownTile(it)));
  } else {
    const r = el('div', 'addrow');
    r.appendChild(linkBtn('The Btown Brief Meetup group', MEETUP_GROUP));
    ownWrap.appendChild(r);
  }
  /* the week, from the whole calendar */
  if (S.eventsFailed && !(S.gath || []).length) { s.appendChild(el('p', 'note pad', 'The calendar didn’t load.')); return; }
  const now = Date.now();
  const all = calMixers(now);
  const days = weekKeys(now);
  if (!days.includes(S.mixDay)) S.mixDay = days.find((d) => all.some((x) => x.date === d)) || days[0];
  const strip = el('div', 'days mixdays');
  strip.dataset.week = days[0];
  days.forEach((d, i) => {
    const [y, mo, dd] = d.split('-').map(Number);
    const day = cw.addDays({ y, mo, d: dd }, 0);
    const n = all.filter((x) => x.date === d).length;
    const on = d === S.mixDay;
    const wd = i === 0 ? 'Today' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day.dow];
    const b = el('button', (on ? 'on' : '') + (n ? '' : ' none'), '<span class="wd">' + esc(wd) + '</span><span class="dd">' + esc(dd) + '</span><span class="n">' + esc(n || '') + '</span>');
    b.type = 'button';
    b.dataset.day = d;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-label', wd + ' ' + dd + ': ' + plural(n, 'mixer', 'mixers'));
    b.addEventListener('click', () => { S.mixDay = d; drawMix(); });
    strip.appendChild(b);
  });
  s.appendChild(strip);
  const list = el('div', 'meets');
  list.dataset.mixDay = S.mixDay;
  const today = all.filter((x) => x.date === S.mixDay);
  /* the ones that fit what you picked first, the rest in time order */
  const fits = (x) => keys.length && fitsText(x.title + ' ' + x.label, keys);
  today.filter(fits).concat(today.filter((x) => !fits(x))).forEach((x) => list.appendChild(mixRow(x, fits(x))));
  if (list.children.length) s.appendChild(list);
  else s.appendChild(el('p', 'note pad', 'Nothing on this day.'));
}

/* folding his own back into the row: back to the Mixers head when it has
   scrolled away, or always, from the Collapse bar */
function jumpBack(always) {
  const h = slots && slots.mix && slots.mix.querySelector('.sec');
  if (h && (always || h.getBoundingClientRect().top < 0)) app.jumpTo(h);
}
/* the redraw took the pressed button away: keep the keyboard on its toggle */
function ownToggle() {
  const t = slots && slots.mix && slots.mix.querySelector('[data-own-all]');
  if (t) t.focus({ preventScroll: true });
}
/* the bar under an opened list: it rides the bottom of the screen while the
   list is in view, so a long list folds back up from anywhere in it */
function collapseBar(what, onCollapse) {
  const bar = el('div', 'collapsebar');
  const b = button(ICON.up + ' Collapse', '', onCollapse);
  b.type = 'button';
  b.dataset.collapse = '1';
  b.setAttribute('aria-label', 'Collapse ' + what);
  bar.appendChild(b);
  return bar;
}

/* Become a host: Stephen's ask, two lines and the email */
function drawHost() {
  const s = slots && slots.host;
  if (!s) return;
  s.innerHTML = '';
  const tc = el('div', 'textcard hostcard', '<h3 class="serif">Host something with the crew</h3>' +
    '<p>Anyone can host a meetup. Coffee first, then your event goes on the calendar.</p><p>Hosting makes you part of the crew.</p>');
  tc.dataset.host = '1';
  const r = el('div', 'row');
  const a = el('a', 'btn', ICON.mail + ' Email Steve');
  a.href = HOST_MAIL;
  r.appendChild(a);
  tc.appendChild(r);
  s.appendChild(el('div', 'spacer'));
  s.appendChild(tc);
}

/* Clubs: the ones that fit, or a featured one and a fresh handful */
function drawGroups() {
  const s = slots && slots.groups;
  if (!s) return;
  s.innerHTML = '';
  const keys = picks();
  sec(s, keys.length ? 'Clubs that fit' : 'Clubs to try');
  if (!S.groups) { s.appendChild(el('p', S.groupsFailed ? 'note pad' : 'loading', S.groupsFailed ? 'The clubs list didn’t load.' : 'One moment…')); }
  else {
    const g = el('div', 'clubs');
    g.dataset.clubs = '1';
    groupsFor(CLUBS_SHOWN, keys).forEach((c) => g.appendChild(clubRow(c)));
    s.appendChild(g);
  }
  const r = el('div', 'addrow');
  r.appendChild(linkBtn('Every club and league in town', CLUBS_PAGE));
  s.appendChild(r);
}
function clubRow(c) {
  const next = cw.nextMeet([c], Date.now());
  const sub = [KIND_WORDS[c.kind] || 'Club', next ? nextWords(next) : c.town].filter(Boolean).join(' · ');
  const a = el('a', 'lrow', mark(c.name, 'round lg') + '<div><div class="t">' + esc(c.name) + '</div><div class="s">' + esc(sub) + '</div></div>' + ICON.ext);
  a.href = safeHref(c.url);
  a.target = '_blank';
  a.rel = 'noopener';
  a.dataset.k = 'club:' + (c.id || slug(c.name));
  a.dataset.kind = c.kind || '';
  return a;
}

function drawQuiz() {
  const s = slots && slots.quiz;
  if (!s) return;
  s.innerHTML = '';
  sec(s, 'The quiz');
  const tc = el('div', 'textcard');
  tc.dataset.quiz = S.q ? (S.q.done ? 'done' : 'q' + S.q.i) : 'intro';
  s.appendChild(tc);
  if (!S.q) {
    tc.innerHTML = '<h3 class="serif">Seven quick questions to find your people.</h3>';
    const r = el('div', 'row');
    r.appendChild(button('Take the quiz', '', () => { S.q = { i: 0, picks: [] }; drawQuiz(); }));
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
  tc.innerHTML = '<span class="eyebrow">Your result</span><h3 class="serif">' + esc('Probably: ' + ARCHETYPE_LABELS[res.arch]) + '</h3><p>' + esc(arch[2]) + '</p>' +
    (res.tags.length ? '<p>' + esc('Into: ' + res.tags.map((t) => INTEREST_WORDS[t]).join(', ') + '.') + '</p>' : '');
  const h = (t) => tc.appendChild(el('p', 'fine', '<b>' + esc(t) + '</b>'));
  const keys = quizKeys(res);
  /* your three groups: the For you strip's choice for the quiz's answer */
  const best = bestFor(keys, (S.groups || []).filter(usableGroup), (S.rc || []).filter(usableClub), 3, Date.now());
  if (best.length) {
    h('Your groups');
    const g = el('div', 'dir');
    g.dataset.quizClubs = '1';
    best.forEach((x) => g.appendChild(matchRow(x, 'qz')));
    tc.appendChild(g);
  }
  /* your best mixer: the soonest that fits, Stephen's own first when one does */
  const own = mixers().map(mixerItem).map((it) => ({ ...it, allDay: false, kind: 'own', label: 'Btown Brief IRL' }));
  const cal = calMixers();
  const fitIt = (x) => fitsText(x.title + ' ' + (x.label || ''), keys);
  const soonest = (list) => list.slice().sort((a, b) => a.at - b.at)[0];
  const one = soonest(own.filter(fitIt)) || soonest(cal.filter(fitIt)) || soonest(own) || soonest(cal);
  if (one) {
    h('Your best mixer');
    const g = el('div', 'dir');
    g.dataset.quizMixer = '1';
    const row = mixRow({ ...one, where: [EV_DAY.format(new Date(one.at)), one.where].filter(Boolean).join(' · '), label: one.label }, false);
    row.dataset.k = 'qz:' + one.k;
    g.appendChild(row);
    tc.appendChild(g);
  }
  const post = el('div', 'row');
  const idea = PLAN_IDEAS[res.tags[0]] || PLAN_IDEAS[res.arch];
  const pb = button(ICON.plus + ' Post a plan', '', () => planSheet({ title: idea, arch: res.arch }));
  pb.dataset.quizPost = '1';
  post.appendChild(pb);
  tc.appendChild(post);
  const r = el('div', 'row');
  r.appendChild(button('That’s me', 'ghost sm', () => {
    S.quizTags = res.tags.filter((t) => PEOPLE_RULES.interests.includes(t));
    keep();
    syncDir();
    setArch(res.arch);
  }));
  r.appendChild(button('Take it again', 'ghost sm', () => { S.q = { i: 0, picks: [] }; drawQuiz(); }));
  tc.appendChild(r);
}

/* People here. Signed out: one line and Sign in. Signed in: Add your
   handles, the directory's join or leave, the newest handles in a row, and
   everyone: the people with their handles on and, once you are in the
   directory yourself, its members. The two lists are never joined into one
   row: a first name and a neighborhood are not a person, so matching on
   them could pin one reader's handles to another's interests. */
function peopleRows() {
  const d = S.dir && !S.dir.error && S.dir.me ? S.dir.people : [];
  const hs = S.handles && S.handles.state === 'ok' ? S.handles.people : [];
  const rows = hs.map((h, i) => ({ name: h.name, neighborhood: h.neighborhood, archetype: null, interests: [], handles: h.handles, me: h.me, i }))
    .concat(d.map((p, i) => ({ name: p.name, neighborhood: p.neighborhood, archetype: p.archetype, interests: p.interests || [], handles: {}, me: !!p.me, i: 1000 + i })));
  const mine = new Set(shareable());
  const shared = (r) => r.interests.filter((t) => mine.has(t)).length;
  return rows.sort((a, b) => (b.me - a.me) || ((b.archetype === S.arch && !!S.arch) - (a.archetype === S.arch && !!S.arch)) || shared(b) - shared(a) || a.i - b.i);
}
/* a handle: a link that opens the service when it has a profile page, a copy button when it hasn't */
function handleChip(kind, v, name) {
  const label = HANDLE_LABELS[kind];
  const href = handleLink(kind, v);
  const inner = '<b>' + esc(label) + '</b><span>' + esc(v) + '</span>';
  let c;
  if (href) {
    c = el('a', 'hchip', inner);
    c.href = safeHref(href);
    c.target = '_blank';
    c.rel = 'noopener';
    c.setAttribute('aria-label', name + ' on ' + label + ': ' + v);
  } else {
    c = el('button', 'hchip', inner);
    c.type = 'button';
    c.setAttribute('aria-label', 'Copy ' + name + '’s ' + label + ': ' + v);
    c.addEventListener('click', () => {
      const done = () => app.toast('Copied ' + name + '’s ' + label);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done, () => app.toast(label + ': ' + v));
      else app.toast(label + ': ' + v);
    });
  }
  c.dataset.handle = kind;
  return c;
}
function handleChips(h, name, max) {
  const box = el('div', 'hchips');
  Object.keys(HANDLE_LABELS).filter((k) => h[k]).slice(0, max || 99).forEach((k) => box.appendChild(handleChip(k, h[k], name)));
  return box;
}
function personRow(p) {
  const where = [NEIGHBORHOOD_LABELS[p.neighborhood], ARCHETYPE_LABELS[p.archetype]].filter(Boolean).join(' · ');
  const r = el('div', 'lrow prow', mark(p.name, 'round lg'));
  const body = el('div', null, '<div class="t">' + esc(p.name + (p.me ? ' (you)' : '')) + '</div>' + (where ? '<div class="s">' + esc(where) + '</div>' : ''));
  const into = (p.interests || []).filter((t) => INTEREST_WORDS[t]);
  if (into.length) body.appendChild(el('div', 'ptags', into.map((t) => '<span class="ptag">' + esc(ACT_CHIP[t] || INTEREST_WORDS[t]) + '</span>').join('')));
  if (Object.keys(p.handles).length) body.appendChild(handleChips(p.handles, p.name));
  r.append(body, el('span'));
  return r;
}
function openHandles() {
  if (!app.user()) { app.openSettings(); return; }
  boards.profileSheet();
  /* the sheet draws once the profile answers; open its handle folds and bring them up */
  const t0 = Date.now();
  const tick = () => {
    const hw = document.querySelector('.sheet-body [data-handles]');
    if (hw) {
      hw.querySelectorAll('details').forEach((x) => { x.open = true; });
      hw.scrollIntoView({ block: 'start' });
      return;
    }
    if (Date.now() - t0 < 6000) setTimeout(tick, 60);
  };
  tick();
}
function drawDir() {
  const s = slots && slots.dir;
  if (!s) return;
  s.innerHTML = '';
  const d = S.dir;
  const count = d && !d.error ? plural(d.count, 'neighbor', 'neighbors') + ' in it' : '';
  sec(s, 'People here', count);
  const tc = el('div', 'textcard');
  tc.dataset.dir = !d ? 'loading' : !app.user() ? 'out' : d.error ? 'error' : d.me ? 'in' : 'join';
  const r = el('div', 'row');
  if (!app.user()) {
    tc.innerHTML = '<p>Sign in to see who’s here.</p>';
    r.appendChild(button('Sign in', '', () => app.openSettings()));
    tc.appendChild(r);
    s.appendChild(tc);
    return;
  }
  if (!d) { s.appendChild(el('p', 'loading', 'One moment…')); return; }
  /* signed in: the two buttons */
  const add = button(ICON.plus + ' Add your handles', '', openHandles);
  add.dataset.addHandles = '1';
  r.appendChild(add);
  if (d.error) tc.appendChild(el('p', null, esc(d.error === 'off' ? MESSAGES.off : d.message || message('offline'))));
  else if (d.me) r.appendChild(button('Leave the directory', 'ghost sm', join(false)));
  else if (S.prof) {
    /* the one line at the moment of joining: what neighbors will see */
    tc.appendChild(el('p', null, esc('Neighbors will see your first name, neighborhood, tile and interests.')));
    r.appendChild(button('Join the directory', 'ghost', join(true)));
  } else r.appendChild(button('Add your first name', 'ghost', () => boards.profileSheet()));
  tc.appendChild(r);
  s.appendChild(tc);
  const hs = S.handles && S.handles.state === 'ok' ? S.handles.people : [];
  if (S.handles && S.handles.state === 'loading') { s.appendChild(el('p', 'loading', 'One moment…')); return; }
  /* Just joined: the newest handles, a row you can swipe */
  if (hs.length) {
    s.appendChild(el('p', 'subh pad', '<b>Just joined</b>'));
    const track = rail(s);
    track.dataset.joined = '1';
    hs.slice(0, JUST_JOINED).forEach((p) => {
      const t = el('div', 'jtile', mark(p.name, 'round lg') + '<b>' + esc(p.name + (p.me ? ' (you)' : '')) + '</b>' +
        '<span class="s">' + esc(NEIGHBORHOOD_LABELS[p.neighborhood] || '') + '</span>');
      t.appendChild(handleChips(p.handles, p.name, 2));
      track.appendChild(t);
    });
  }
  const rows = peopleRows();
  if (rows.length) {
    const g = el('div', 'dir plist');
    g.dataset.people = '1';
    rows.forEach((p) => g.appendChild(personRow(p)));
    s.appendChild(g);
  }
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
  const tc = el('div', 'textcard');
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

function planSheet(pre) {
  pre = pre && typeof pre === 'object' && typeof pre.title === 'string' ? pre : null;
  app.sheet('Post a plan', (body, card, close) => {
    const note = (t) => body.appendChild(el('p', 'sheet-note', esc(t)));
    if (!app.user()) {
      note('Sign in to post.');
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
      planForm(body, close, p.profile, pre);
    });
  });
}

function planForm(body, close, prof, pre) {
  const L = RULES.limits;
  const f = el('form', 'bform');
  f.noValidate = true;
  if (pre) f.dataset.pre = '1';
  if (!prof) f.appendChild(row('Your first name', field('text', 'display_name', { max: L.nameMax, placeholder: 'Maya, or Maya R.' }), 'Neighbors see it.', true));
  f.appendChild(row('What’s the plan?', field('text', 'title', { max: L.titleMax, placeholder: 'Trivia at Three Needs, need a fifth' }), null, true));
  f.appendChild(row('Which day', choose('day', [['', 'Pick a day']].concat(dayOptions()), ''), null, true));
  f.appendChild(row('What time', choose('time', [['', 'Pick a time']].concat(timeOptions()), ''), null, true));
  f.appendChild(row('Where', field('text', 'place', { max: L.placeMax, placeholder: 'Somewhere public: a bar, a trailhead, a café' }), null, false));
  f.appendChild(row('Who it’s for', choose('arch', [['', 'Anyone']].concat(RULES.archetypes.map((a) => [a, 'Mostly ' + FOR[a]])), S.arch || ''), null, false));
  f.appendChild(row('Rough ages', choose('ages', [['', 'Not saying']].concat(PEOPLE_RULES.ages.map((a) => [a, AGES[a]])), ''), null, false));
  f.appendChild(row('Spots for strangers', field('number', 'spots', { placeholder: 'How many more can come?' }), null, false));
  /* a club's meet ("I'm going"): its title, day, time and place, filled in */
  if (pre) {
    const set = (name, v) => { const n = f.elements[name]; if (n && v) n.value = v; };
    const t = f.elements.time;
    if (pre.time && t && ![...t.options].some((o) => o.value === pre.time)) {
      const o = el('option', null, esc(pre.time));
      o.value = pre.time;
      const mins = (w) => { const m = /^(\d{1,2})(?::(\d{2}))? (am|pm)$/.exec(w); return m ? ((+m[1] % 12) + (m[3] === 'pm' ? 12 : 0)) * 60 + +(m[2] || 0) : -1; };
      const later = [...t.options].find((x) => x.value && mins(x.value) > mins(pre.time));
      t.insertBefore(o, later || null);
    }
    set('title', pre.title); set('day', pre.day); set('time', pre.time); set('place', pre.place);
    if (pre.arch && RULES.archetypes.includes(pre.arch)) set('arch', pre.arch);
  }
  f.appendChild(row('More', field('textarea', 'body', { max: L.bodyMax, placeholder: 'How to find you, what to bring, the pace' }), null, false));
  const mu = el('label', 'consent', '<input type="checkbox" name="meetup"> ' +
    esc('Steve may put this on Meetup, with me as host.'));
  f.appendChild(mu);
  f.appendChild(el('p', 'bf-note', esc('Up until it happens, two weeks at most. Meet somewhere public.')));
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
            : r.post.status === 'pending' ? 'Posted. It shows once approved.' : 'Posted');
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
  if (SECS.some(([key]) => key === k) || k === 'talk' || k === 'host') {
    pending = null;
    app.jumpTo(slots && slots[k]);
    return;
  }
  /* a club's meet (What Now's cards) or a club: wait for the club week */
  if (/^(rc|club)-/.test(k)) {
    if (!S.rc && !S.rcFailed) return;
    pending = null;
    landClub(k);
    return;
  }
  /* wait for the part of the tab the key belongs to */
  if (/^b-/.test(k) && S.plansState === 'loading') return;
  if (/^mx-/.test(k) && (!(S.events || S.eventsFailed) || !(app.demo || S.feed))) return;
  if (/^(mc|g)-/.test(k)) {
    if (!(S.events || S.eventsFailed)) return;
    /* a calendar mixer or a gathering: show its day first */
    const hit = calMixers().find((x) => x.k === k);
    if (!hit && /^g-/.test(k) && gRun && !S.gathDone) return;
    if (hit && hit.date !== S.mixDay) { S.mixDay = hit.date; drawMix(); }
  }
  if (/^club:/.test(k) && !S.groups && !S.groupsFailed) return;
  pending = null;
  if (!app.flashHit(root, k)) app.toast(/^(mx|mc|g)-/.test(k) ? 'That mixer has passed.' : /^b-/.test(k) ? 'That plan has passed.' : 'That card has moved on.');
}

function landClub(k) {
  if (/^club-/.test(k)) {
    const c = (S.rc || []).find((x) => usableClub(x) && x.id === k.slice(5));
    if (!c) { app.toast('That club has moved on.'); return; }
    S.rcKind = cw.isRun(c) ? 'run' : 'fit';
    drawClubs();
    app.jumpTo(slots.clubs);
    clubSheet(c);
    return;
  }
  const o = cw.weekStrip(S.rc || [], Date.now(), usableClub).flatMap((d) => d.meets).find((x) => x.k === k && !x.past);
  if (!o) { app.toast('That one has passed.'); app.jumpTo(slots.clubs); return; }
  S.rcKind = cw.isRun(o.club) ? 'run' : 'fit';
  S.rcDay = o.date;
  drawClubs();
  app.flashHit(slots.clubs, k);
  clubSheet(o.club, o);
}

window.addEventListener('allday-boards', (e) => {
  if (!root) return;
  const d = (e && e.detail) || {};
  if (d.board === 'people' || d.what === 'delete' || d.what === 'hidden' || d.what === 'deleteme') loadPlans();
  if (d.board === 'gatherings' || d.what === 'delete' || d.what === 'hidden' || d.what === 'deleteme') loadGatherings();
  /* a change made in Settings is adopted; our own saves echoing back are not */
  if (d.what === 'profile' || d.what === 'deleteme') loadProfile(!queued).then(() => { drawArch(); drawForYou(); return Promise.all([loadDir(), loadHandles()]); });
});
app.onAuth(() => {
  if (!root) return;
  S.prof = undefined;
  S.handles = null;
  S.dir = null;   // the last reader's directory is never drawn for the next one
  loadPlans();
  drawDir();
  loadProfile().then(() => { drawArch(); drawForYou(); drawPlans(); return Promise.all([loadDir(), loadHandles()]); });
});

app.register(KEY, {
  label: 'People',
  icon: ICON.people,
  promise: 'Find your people: say who you are here as, and say yes to a plan with strangers.',
  mount(r) {
    root = r;
    slots = null;
    render();
    if (app.demo) loadDemo().catch(() => { root.innerHTML = '<div class="errbox"><b>The demo didn’t load.</b></div>'; slots = null; });
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
export const _peek = () => ({ posts: S.posts.map((p) => ({ id: p.id, title: p.title, meta: { ...p.meta }, at: p.at, votes: p.votes })), arch: S.arch, tags: S.tags.slice(), quizTags: S.quizTags.slice(),
  rcKind: rcKind(), rcDay: S.rcDay, mixDay: S.mixDay, fAge: S.fAge, fAct: S.fAct, keys: picks() });
