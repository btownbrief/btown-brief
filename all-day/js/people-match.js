/* people-match.js: what the People tab's tiles mean, and which calendar
   events count as mixers. Pure functions, no DOM and no fetching, so the
   tab and the tests read the same table.

   MATCH is the one table behind every tile. A key is an archetype tile
   ('a:new', 'a:regular', 'a:trail', 'a:games') or an "I'm…" / "I'm into…"
   tag. For each:
     kinds  the data/groups.json kinds that fit (league, pickup, games,
            trivia, books, language, music, dance, making, outdoors, social,
            other)
     words  words in a group's name, what, category or newcomer line that fit
            (a 20s group for "Just graduated", a women's league for "A woman
            finding my people")
     run    a run club from data/run-clubs.json fits; fit: a fitness club does
     ev     words in an event's or a plan's title that fit
   The For you strip, the plans, the mixers, the clubs list and the quiz all
   score with it. */
import * as cw from './clubs-week.js';

export const MATCH = {
  'a:new': { kinds: ['social', 'language', 'trivia'], words: /newcomer|new (?:in|to) (?:town|burlington|the area)|first connections/i,
    ev: /mixer|social|coffee club|newcomer|new in town|welcome|meet[- ]?up|happy hour/i },
  'a:regular': { kinds: ['trivia', 'games', 'dance', 'music'], ev: /trivia|quiz|karaoke|open mic|game night|danc|music/i },
  'a:trail': { kinds: ['outdoors'], run: true, words: /hik|trail|ski|outdoor|paddl|climb/i, ev: /\brun\b|hike|walk|paddle|kayak|bike|ski|climb|trail/i },
  'a:games': { kinds: ['games', 'trivia'], ev: /game|trivia|board|puzzle|scrabble|chess|d&d|dungeons|clocktower|bingo|quiz/i },
  student: { kinds: ['social', 'pickup', 'trivia'], words: /20-?somethings|twenty|\b20s\b|young adults|college students|students welcome/i, ev: /mixer|social|trivia|pick-?up|game night/i },
  grad: { kinds: ['social', 'league', 'trivia'], words: /20-?somethings|twenty|\b20s\b|\b30s\b|young (?:adults|professionals)|recent grads?/i,
    ev: /mixer|social|trivia|network|young professionals|happy hour|\btech\b/i },
  moved: { kinds: ['social', 'outdoors'], words: /newcomer|new (?:in|to) (?:town|burlington|the area)|just moved|first connections|beginners? (?:are )?(?:welcome|expected)/i,
    ev: /mixer|social|newcomer|new in town|welcome|coffee club|meet[- ]?up/i },
  older: { kinds: ['books', 'making'], words: /older adults|retire|seniors?\b|\b5[05]\+|old \(and new|bridge|mah-?j/i, ev: /book|bridge|mah-?j|chess|lecture|coffee/i },
  women: { words: /wom[ae]n|womxn|ladies|nonbinary|\bgirls?\b/i, ev: /wom[ae]n|womxn|ladies|nonbinary/i },
  lgbtq: { kinds: ['social'], words: /queer|lgbt|out in the 802|pride|nonbinary|womxn|\btrans\b/i, ev: /queer|lgbt|pride|drag|queeraoke/i },
  sports: { kinds: ['league', 'pickup'], fit: true, ev: /basketball|soccer|pickleball|volleyball|kickball|ultimate|frisbee|hockey|softball|pick-?up/i },
  games: { kinds: ['games', 'trivia'], ev: /game|trivia|board|puzzle|scrabble|chess|d&d|dungeons|clocktower|quiz/i },
  running: { run: true, ev: /\brun\b|\bruns\b|running|\b5k\b/i },
  outdoors: { kinds: ['outdoors'], fit: true, words: /hik|ski\b|skiing|sail|paddl|climb|outdoor/i, ev: /hike|walk|paddle|kayak|beach|trail|ski|climb/i },
  music: { kinds: ['music'], words: /choir|chorus|\bjam\b|band/i, ev: /music|concert|open mic|karaoke|\bjam\b|choir/i },
  dance: { kinds: ['dance'], ev: /danc|contra|swing|salsa|tango|bachata/i },
  books: { kinds: ['books'], ev: /book|poet|read|writ/i },
  making: { kinds: ['making'], ev: /craft|maker|knit|carv|paint|sew|crochet/i },
  languages: { kinds: ['language'], ev: /language|french|spanish|italian|mandarin|irish|conversation/i },
  food: { words: /cookbook|potluck|food (?:club|lovers)|dinner club|supper club|tasting|brewery book/i, ev: /coffee|food|dinner|brunch|crawl|drink|lunch|potluck|tasting/i },
};

/* the groups.json kinds in words, for a row's second line */
export const KIND_WORDS = { league: 'League', pickup: 'Pickup', games: 'Games', trivia: 'Trivia', books: 'Book club', language: 'Language',
  music: 'Music', dance: 'Dance', making: 'Making', outdoors: 'Outdoors', social: 'Social', other: 'Club', run: 'Run club', fit: 'Fitness' };

/* what a group says it is (not its newcomer line, which every group has) */
const textOf = (g) => [g.what, g.category].filter(Boolean).join(' ');

/* How well a groups.json group fits the picked keys; 0 is not at all. A
   word in its name counts most, then a word in what it says it is, then
   its kind. */
export function groupScore(g, keys) {
  if (!g || !Array.isArray(keys) || !keys.length) return 0;
  const text = textOf(g);
  let s = 0;
  keys.forEach((k) => {
    const m = MATCH[k];
    if (!m) return;
    if (m.kinds && m.kinds.includes(g.kind)) s += 3;
    if (m.words && m.words.test(String(g.name || ''))) s += 6;
    else if (m.words && m.words.test(text)) s += 4;
  });
  if (s && g.beginner) s += 0.5;
  if (s && g.featured) s += 2;   // Stephen's own group, whenever it fits at all
  return s;
}
/* a run-clubs.json club: a runner wants run clubs, an athlete fitness */
export function clubScore(c, keys) {
  if (!c || !Array.isArray(keys) || !keys.length) return 0;
  const text = textOf(c);
  let s = 0;
  keys.forEach((k) => {
    const m = MATCH[k];
    if (!m) return;
    if (m.run && cw.isRun(c)) s += 4;
    if (m.fit && cw.isFitness(c)) s += 2;
    if (m.words && (m.run || m.fit || !m.kinds) && m.words.test(String(c.name || '') + ' ' + text)) s += 2;
  });
  return s;
}
export const fitsText = (text, keys) => (keys || []).some((k) => MATCH[k] && MATCH[k].ev && MATCH[k].ev.test(String(text || '')));

/* The For you strip: the best few, a new kind before a second of one it
   has (unless that second fits clearly better), so "A gamer" gets trivia
   AND board games rather than three trivia nights, while "A woman finding
   my people" still gets the women's leagues ahead of a game night. Each answer is { type: 'group' | 'club', it, score, kind }. A
   club whose next meet is this week edges ahead of one that isn't. */
export function bestFor(keys, groups, clubs, n, nowMs) {
  if (!Array.isArray(keys) || !keys.length) return [];
  const now = nowMs || Date.now();
  const all = [];
  (groups || []).forEach((g, i) => {
    if (!g || !g.name || !/^https?:/i.test(String(g.url || ''))) return;
    const s = groupScore(g, keys);
    if (s > 0) all.push({ type: 'group', it: g, score: s, kind: g.kind || 'other', i });
  });
  (clubs || []).forEach((c, i) => {
    if (!c || !c.name || !/^https?:/i.test(String(c.url || ''))) return;
    let s = clubScore(c, keys);
    if (s <= 0) return;
    const next = cw.nextMeet([c], now);
    if (next && next.at < now + 7 * 86400000) s += 0.75;
    all.push({ type: 'club', it: c, score: s, kind: cw.isRun(c) ? 'run' : 'fit', i: 1000 + i, next });
  });
  all.sort((a, b) => b.score - a.score || a.i - b.i);
  const out = [];
  while (out.length < n && all.length) {
    const kinds = new Set(out.map((x) => x.kind));
    const fresh = all.find((x) => !kinds.has(x.kind));
    const pick = fresh && fresh.score >= all[0].score - 1 ? fresh : all[0];
    out.push(pick);
    all.splice(all.indexOf(pick), 1);
  }
  return out;
}

/* ------------------------------------------------------------ mixers */
/* Which events on the guide's calendar are mixers: a place to meet
   strangers. Read off the title (and a game cafe's name), first match
   wins; a Meetup event that matches nothing is still a meetup. Kids',
   teens' and family events, campus-only events and help desks never are. */
export const MIXER_KINDS = [
  ['singles', 'Singles', /singles|speed[- ]?dat|\bdating\b/i],
  ['network', 'Networking', /network|toastmasters|young professionals|\bfounders?\b|startups?|entrepreneur|\btech (?:tuesdays?|meetup|night|jam|happy hour|breakfast)|\bbtv tech|coding club|hack ?night|hackers|developers|bitcoin|women in tech/i],
  ['run', 'Run club', /run club|social run|group run|\b5k run\b|fun run|running club|run (?:&|and) (?:brew|beer)/i],
  ['pickup', 'Pickup', /pick-?up (?:basketball|soccer|volleyball|ultimate|hockey|game)|open gym|drop-?in (?:volleyball|basketball|pickleball|soccer)/i],
  ['language', 'Language table', /(?:french|spanish|italian|irish|mandarin|german|japanese|portuguese|language) conversation|conversation (?:group|circle|table|hour)|pause-caf|language (?:exchange|table)/i],
  ['trivia', 'Trivia', /trivia|pub quiz|quiz night|\bbingo\b/i],
  ['games', 'Games', /game night|board games?|scrabble|chess club|puzzle race|clocktower|mah[- ]?j|d&d|dungeons|commander night|learn (?:&|and) play/i],
  ['dance', 'Dance social', /dance social|social danc|contra dance|swing dance|milonga|salsa (?:night|social)|bachata (?:night|social)|line danc/i],
  ['social', 'Social', /\bmixers?\b|\bsocials?\b|meet[- ]?ups?\b|meet (?:and|&) greet|newcomers?|new (?:in|to) (?:town|burlington|vermont)|welcome (?:night|party)|coffee club|coffee (?:&|and) conversation|happy hour|potluck|community (?:dinner|cooking)|pub crawl|friendsgiving/i],
];
export const MIXER_WORDS = Object.fromEntries(MIXER_KINDS.map(([k, w]) => [k, w]).concat([['meetup', 'Meetup']]));
const NOT_MIXER = /homeschool|\bkids?\b|\bteens?\b|toddler|bab(?:y|ies)|famil|littles|storytime|\btweens?\b|youth|middle grade|grades? \d|intramural|student|\bdads?\b|vaccine|clinic|tech help|webinar|memory caf|peer support|support group|registration|\bclass(?:es)?\b|\bsocial (?:media|security|work)/i;
const NOT_TAGS = ['kids', 'teens', 'family', 'older kids', 'storytime'];
const CAMPUS = /^https?:\/\/(?:[\w-]+\.)*(?:uvm\.edu|champlain\.edu|smcvt\.edu)\//i;
const GAME_CAFE = /boardroom|game (?:cafe|café)/i;

export function mixerKind(e) {
  if (!e || typeof e.title !== 'string' || !/^https?:/i.test(String(e.url || ''))) return null;
  const t = e.title;
  if (NOT_MIXER.test(t) || (Array.isArray(e.tags) && e.tags.some((x) => NOT_TAGS.includes(x))) || CAMPUS.test(e.url)) return null;
  const hit = MIXER_KINDS.find(([, , re]) => re.test(t));
  if (hit) return hit[0];
  if (GAME_CAFE.test(String(e.venue || ''))) return 'games';
  if (/^https?:\/\/(?:www\.)?meetup\.com\//i.test(e.url)) return 'meetup';
  return null;
}

/* ----------------------------------------------------------- handles */
/* Where each handle opens. A service with a public profile page gets a
   link; the rest (a Switch friend code, a Discord or Riot name, a Strava
   name that isn't its number) can only be copied into the app. Every
   value is URI-encoded; the caller still escapes what it prints. */
const enc = encodeURIComponent;
export const HANDLE_LINKS = {
  instagram: (h) => 'https://www.instagram.com/' + enc(h) + '/',
  spotify: (h) => 'https://open.spotify.com/user/' + enc(h),
  strava: (h) => (/^\d+$/.test(h) ? 'https://www.strava.com/athletes/' + h : null),
  letterboxd: (h) => 'https://letterboxd.com/' + enc(h) + '/',
  goodreads: (h) => (/^\d+$/.test(h) ? 'https://www.goodreads.com/user/show/' + h : 'https://www.goodreads.com/' + enc(h)),
  untappd: (h) => 'https://untappd.com/user/' + enc(h),
  xbox: (h) => 'https://account.xbox.com/en-us/profile?gamertag=' + enc(h),
  steam: (h) => (/^\d{17}$/.test(h) ? 'https://steamcommunity.com/profiles/' + h : 'https://steamcommunity.com/id/' + enc(h)),
  chess: (h) => 'https://www.chess.com/member/' + enc(h),
  linkedin: (h) => 'https://www.linkedin.com/in/' + enc(h),
};
export function handleLink(kind, h) {
  const f = HANDLE_LINKS[kind];
  const v = typeof h === 'string' ? h.trim() : '';
  return f && v ? f(v) : null;
}

/* a gathering's `when` starts with its Burlington date: "2026-10-24, 7 pm" */
export function gatheringWhen(when) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:,?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm))?/i.exec(String(when || '').trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const u = new Date(Date.UTC(y, mo - 1, d, 12));
  if (u.getUTCMonth() !== mo - 1 || u.getUTCDate() !== d) return null;
  const date = m[1] + '-' + m[2] + '-' + m[3];
  if (!m[4] || +m[4] < 1 || +m[4] > 12 || +(m[5] || 0) > 59) return { date, at: cw.wall(y, mo, d, 12, 0), allDay: true };
  const h = (+m[4] % 12) + (m[6].toLowerCase() === 'pm' ? 12 : 0);
  return { date, at: cw.wall(y, mo, d, h, +(m[5] || 0)), allDay: false };
}
