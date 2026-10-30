/* reddit-lib.js — what the Reddit tab shows, worked out from the shared Reddit
   intake and the Best of r/burlington list. Pure shapers, no DOM, so node can
   test them (scripts/test-reddit-lib.mjs).

   freshFrom(intake, nowMs)
     r/burlington and r/vermont, newest first. A thread shows once the Mac
     reader has confirmed it (nsfw is false, not null: posts only RSS saw may
     be removed ones), it passes held(), and it has earned its place: under
     six hours old, or a score of 2, or 3 comments. The same story posted to
     both subs shows once, the bigger copy.

   held(title, flair)
     Titles this tab never prints: a private person's name, a username, a
     phone number, an email address, a street address, or anything about an
     arrest, a crime or an accusation. Name-shaped words alone are too noisy
     here (half of the sub's titles are businesses and bands), so a name is a
     common first name followed by a capitalised word that is not a place, an
     initial and a surname, or a title such as Officer or Prosecutor followed
     by one. An address is a number, up to three words and a street suffix; a
     preposition or a unit of distance or time among those words makes it an
     ordinary phrase, such as a 5 mile trail. A miss costs one tile.

   questionsFrom(bestOf, intake, nowMs)
     One card per recurring question. A thread in the intake that asks one
     joins its card; a new question gets a card of its own. Threads carry
     the time they were asked: exact from the intake, the year worked out
     from the thread's id for older ones. Asked this week floats to the top.
     Every row is a thread's own title and link: nothing here is an answer. */

import { isFoodAsk } from './food-asks.js';

const HOUR = 3600000, DAY = 24 * HOUR;
export const SUBS = ['r/burlington', 'r/vermont'];
export const MAX_AGE_DAYS = 14;   // the store holds 10; past this, a stalled reader empties the tab instead of aging it
export const isHot = (p) => (p.comments || 0) >= 75 || (p.score || 0) >= 150;

const OUTLETS = { 'sevendaysvt.com': 'Seven Days', 'vtdigger.org': 'VTDigger', 'wcax.com': 'WCAX', 'mynbc5.com': 'NBC5',
  'vermontpublic.org': 'Vermont Public', 'burlingtonfreepress.com': 'Free Press', 'youtube.com': 'YouTube', 'youtu.be': 'YouTube' };
function outlet(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return OUTLETS[host] || host;
  } catch (e) { return ''; }
}
const when = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; };

/* ------------------------------------------------------------ the filter */
const FIRST = new Set(('aaron abby adam adrian aiden alan albert alex alexa alexis alice alicia alison allison alyssa amanda amber amy andrea andrew andy angela anita ann anna anne annie anthony april arthur ashley audrey austin barbara becky ben benjamin beth betty blake bob bobby brad bradley brandon brenda brett brian briana bridget brittany brooke bruce bryan caleb cameron carl carla carly carol caroline carolyn carrie catherine cathy charles charlie charlotte chelsea cheryl chloe chris christina christine christopher cindy claire clara cody colin colleen connor corey courtney craig crystal cynthia dale dan dana daniel danielle danny darren dave david dawn dean deb deborah debra denise dennis derek diana diane dominic don donald donna doug douglas drew dylan ed eddie edward eileen elaine eleanor elizabeth ellen emily emma eric erica erik erin ethan eugene eva evan evelyn fiona frances francis frank fred gabriel gail gary gavin george gerald gina glenn gloria gordon greg gregory hannah harold harry heather helen henry holly howard ian irene isaac isabel jack jackie jacob jacqueline jake james jamie jan jane janet janice jared jason jay jean jeff jeffrey jen jenna jennifer jenny jeremy jerry jesse jessica jill jim jimmy joan joann joanne jody joe joel john johnny jon jonathan jordan jose joseph josh joshua joyce juan judith judy julia julie justin karen kari karl kate katherine kathleen kathryn kathy katie katrina kayla keith kelly ken kenneth kenny kevin kim kimberly kirk kristen kristin kristina kurt kyle larry laura lauren laurie lawrence leah lee leo leon leslie lila linda lindsay lindsey lisa liz logan lori louis louise lucas lucy luke lydia lynn madison maggie mandy marc marcus margaret maria marie marilyn marissa marjorie mark marshall martha martin marty mary mason matt matthew maureen max megan melanie melissa meredith mia michael michele michelle miguel mike mindy miranda misty mitch mitchell molly monica morgan nancy naomi natalie nate nathan nathaniel neil nicholas nick nicole nina noah nora norman olivia oscar owen pam pamela pat patricia patrick paul paula peggy penny pete peter phil philip phillip rachel ralph randy ray raymond rebecca regina renee rhonda richard rick ricky rita rob robert roberta robin rod rodney roger ron ronald rory ross roy ruby russell ruth ryan sally sam samantha samuel sandra sandy sara sarah scott sean seth shane shannon sharon shawn sheila shelby sherry shirley sophia sophie stacey stacy stan stanley stella stephanie stephen steve steven stuart sue susan suzanne sydney tamara tammy tanya tara taylor ted teresa terri terry theresa thomas tiffany tim timothy tina todd tom tommy toni tony tracey tracy travis trevor troy tyler valerie vanessa vera veronica vicki vicky victor victoria vincent virginia walter wanda wayne wendy wesley whitney william willie wyatt yvonne zach zachary zoe').split(' '));
/* the second word that says this is a place, a business or a thing, not a surname */
const NOT_SURNAME = new Set(('street st ave avenue road rd drive lane park hill peak mountain lake pond river beach bay island trail bridge farm farms house hall center centre school college university hospital clinic church library market store shop shops bar cafe bakery brewery pub pizza kitchen diner deli inn hotel show band trio quartet concert festival fair night day week ave').split(' '));
const PUBLIC = /\b(Phil Scott|Bernie Sanders|Becca Balint|Peter Welch|Emma Mulvaney-Stanak|Miro Weinberger|Amanda Janoo|Donald Trump|Joe Biden|Kamala Harris)\b/g;
const NAMED = /\b([A-Z][A-Za-z]+)(?=\s+(?:[A-Z]\.\s+)?([A-Z][A-Za-z’'-]+))/g;
const INITIAL = /(?<![\w.])[A-Z]\.\s+([A-Z][A-Za-z’'-]+)/g;
const ROLE = /\b(?:officer|deputy|sgt|sergeant|detective|prosecutor|judge|mr|mrs|ms|dr|professor|principal|superintendent|councilor|coach|pastor|reverend|rev)\.?\s+([A-Za-z]+)/gi;
const CRIME = /\b(accus\w*|alleg\w*|arrest\w*|embezzl\w*|stole|fraud\w*|indict\w*|charged|convict\w*|assault\w*|abus\w*|molest\w*|rape\w*|rapist|pedophil\w*|predator\w*|stalk\w*|harass\w*|murder\w*|homicide|shooting|stabb\w*|sentenced|misconduct|scammer)\b/i;
const MINOR = /\b1[0-7][- ]?(?:year|yr|yo)\b/i;
const CONTACT = /\bu\/[A-Za-z0-9_-]+|\b[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b|(?<!\d)\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}(?!\d)|\b\d+[a-z]?\s+(?:(?!(?:at|in|on|of|the|an?|to|by|for|from|near|and|or|with|mi|miles?|km|acres?|min|minutes?|hrs?|hours?|days?|weeks?|months?|yrs?|years?)\s)[a-z.'’-]+\s+){1,3}?(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|pl|place|pkwy|parkway|ter|terrace|cir|circle|way|blvd|boulevard|hts|heights|xing|crossing|sq|square|aly|alley|rdg|ridge|hl|hill|bch|grn|grv|park|trl|trail)\b/i;
const BAD_FLAIR = /misleading|removed/i;

export function namesPerson(title) {
  const t = String(title || '').replace(PUBLIC, ' ');
  for (const m of t.matchAll(NAMED)) {
    if (FIRST.has(m[1].toLowerCase()) && !NOT_SURNAME.has(m[2].toLowerCase())) return true;
  }
  for (const m of t.matchAll(INITIAL)) {
    if (!NOT_SURNAME.has(m[1].toLowerCase())) return true;
  }
  return [...t.matchAll(ROLE)].some((m) => /^[A-Z][a-z]/.test(m[1]));
}
export const held = (title, flair) => namesPerson(title) || CRIME.test(String(title || '')) ||
  MINOR.test(String(title || '')) || CONTACT.test(String(title || '')) || BAD_FLAIR.test(String(flair || ''));

/* ----------------------------------------------------------------- Fresh */
const sameKey = (p) => String(p.out || p.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function usable(p, nowMs) {
  const ts = when(p.created);
  if (!ts || !SUBS.includes(p.sub) || p.nsfw !== false || (p.score || 0) < 0) return false;
  return nowMs - ts <= MAX_AGE_DAYS * DAY && !held(p.title, p.flair);
}
export function freshFrom(intake, nowMs) {
  const best = new Map();
  ((intake && intake.posts) || []).forEach((p) => {
    if (!p || !usable(p, nowMs)) return;
    const young = nowMs - when(p.created) < 6 * HOUR;
    if (!young && (p.score || 0) < 2 && (p.comments || 0) < 3) return;
    const k = sameKey(p), had = best.get(k);
    if (!had || (p.score || 0) > (had.score || 0)) best.set(k, p);
  });
  return [...best.values()].map((p) => ({ id: String(p.id), sub: p.sub, title: p.title, url: p.url, ts: when(p.created),
    seen: when(p.first_seen) || when(p.created), score: p.score || 0, comments: p.comments || 0, flair: p.flair || '',
    outlet: p.out ? outlet(p.out) : '', hot: isHot(p) })).sort((a, b) => b.ts - a.ts);
}
/* the mirror's listing of a sub, in the intake's post shape, for the bar's count */
export function postsFromListings(doc) {
  const out = [];
  ['r/burlington/new', 'r/vermont/new'].forEach((key) => {
    const kids = doc && doc.listings && doc.listings[key] && doc.listings[key].data && doc.listings[key].data.data && doc.listings[key].data.data.children;
    (kids || []).forEach((c) => {
      const d = c && c.data;
      if (!d || d.stickied || !d.created_utc) return;
      const created = new Date(d.created_utc * 1000).toISOString();
      out.push({ id: d.id, sub: key.replace('/new', ''), title: d.title, url: d.url, created, first_seen: created, nsfw: !!d.over_18,
        score: d.score, comments: d.num_comments, flair: d.link_flair_text, out: d.url_overridden_by_dest || null });
    });
  });
  return out;
}
export const newCount = (posts, base) => posts.filter((p) => Math.max(p.ts, p.seen) > base).length;

/* ------------------------------------------------------------- Questions */
export const CATS = [['food', 'Food'], ['coffee', 'Coffee'], ['nightlife', 'Nightlife'], ['todo', 'Things to do'], ['services', 'Services'],
  ['grooming', 'Grooming'], ['housing', 'Housing'], ['moving', 'Moving here'], ['outdoors', 'Outdoors'], ['shopping', 'Shopping'],
  ['health', 'Health'], ['pets', 'Pets'], ['cars', 'Cars'], ['around', 'Around town']];
const LIST_CATS = { 'food-restaurants': 'food', coffee: 'coffee', 'bars-breweries': 'nightlife', cannabis: 'shopping', 'grocery-retail-shopping': 'shopping',
  'grooming-beauty': 'grooming', 'tattoos-piercing': 'grooming', 'health-wellness': 'health', pets: 'pets', 'housing-rentals': 'housing', automotive: 'cars',
  'home-practical-services': 'services', 'sports-outdoors-recreation': 'outdoors', 'arts-culture-entertainment': 'todo', 'visiting-dating-misc': 'todo',
  'travel-transit': 'moving', 'jobs-work': 'moving', 'hotels-lodging': 'moving' };
const WORDS = [
  ['coffee', /\b(coffee|espresso|lattes?|cafes?|cafés?)\b/i],
  ['nightlife', /\b(bars?|pubs?|brewery|breweries|cocktails?|beers?|karaoke|nightlife)\b/i],
  ['grooming', /\b(hair|haircuts?|barbers?|salons?|nails?|waxing|tattoos?|piercings?)\b/i],
  ['health', /\b(doctors?|dentists?|therapists?|acupuncture|primary care|clinics?|chiropractors?|massage|pharmacy|docs?)\b/i],
  ['pets', /\b(dogs?|cats?|vets?|groomers?|kennels?|pets?|puppy|kitten)\b/i],
  ['housing', /\b(apartments?|rent|renting|landlords?|lease|housing|roommates?|sublets?)\b/i],
  ['moving', /\b(moving|move to|new to|relocat\w*|visiting|hotels?|airport|amtrak|jobs?|hiring)\b/i],
  ['cars', /\b(cars?|mechanics?|tires?|auto|oil change|inspection|truck)\b/i],
  ['services', /\b(plumbers?|electricians?|contractors?|stoves?|install\w*|repairs?|tailors?|mending|alterations?|cleaners?|landscap\w*|movers?|handyman|chimney|roofers?)\b/i],
  ['outdoors', /\b(hik\w+|trails?|ski\w*|gyms?|soccer|basketball|hockey|bik\w+|swim\w*|climb\w*|golf|sledding)\b/i],
  ['todo', /\b(things to do|music|movies?|trivia|events?|classes|class|clubs?|groups?|date ideas?)\b/i],
  ['shopping', /\b(buy|sell|sells|stores?|shops?|costumes?|gifts?|thrift\w*|gift cards?)\b/i],
];
export function catOf(title) {
  if (isFoodAsk(title)) return /\b(coffee|espresso|lattes?|cafes?|cafés?)\b/i.test(title) ? 'coffee' : 'food';
  const hit = WORDS.find(([, re]) => re.test(title));
  return hit ? hit[0] : 'around';
}
export const isAsk = (title) => {
  const t = String(title || '').trim();
  if (/\b(tickets?|vote|votes|voting|election|ballots?|janoo|scott)\b/i.test(t) || /^(psa|reminder|lost|found)\b/i.test(t)) return false;
  return /\?\s*$/.test(t) || /^(best|where|anyone|any|does|looking for|recommend\w*|recs?|who|what|how)\b/i.test(t) || /\b(recs|recommendations?|suggestions?)\b/i.test(t);
};

const SKIP = new Set(('best good great nice top where what who which how is are the a an in on of for to and or with near around at place places spot spots get find burlington btv vermont vt area town any anyone most your you new').split(' '));
const stem = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 1).map(stem);
const tokens = (s) => words(s).filter((w) => !SKIP.has(w));

/* Reddit's ids count up. Three threads of known date give the year of any
   other, which is all a card says of an old thread. */
const ANCHORS = [[parseInt('12r1lpn', 36), 1681800000000], [parseInt('1kuadqb', 36), 1748000000000], [parseInt('1xj518e', 36), 1793331659000]];
export function askedAt(url) {
  const m = String(url || '').match(/\/comments\/([a-z0-9]+)/i);
  if (!m) return 0;
  const n = parseInt(m[1], 36);
  const hi = ANCHORS.findIndex(([a]) => n <= a);
  const [[a0, t0], [a1, t1]] = hi > 0 ? [ANCHORS[hi - 1], ANCHORS[hi]] : (hi === 0 ? ANCHORS.slice(0, 2) : ANCHORS.slice(1, 3));
  return t0 + (n - a0) / (a1 - a0) * (t1 - t0);
}

/* a question with no subject of its own needs to ask outright */
const PLAIN_ASK = /^(best|where|any|anyone|looking|recommend|is|does|who)\b/i;
const GENERIC = new Set(['store', 'shop', 'restaurant', 'bar', 'food', 'thing', 'way']);
const fits = (c, have, title) => c.toks.length && c.toks.every((t) => have.has(t)) &&
  (c.toks.length > 1 || !GENERIC.has(c.toks[0]) || /^best\b/i.test(title));

const rank = (a, b) => (b.week - a.week) || (a.week ? b.last - a.last : 0) || (b.n - a.n) || (b.last - a.last) || a.q.localeCompare(b.q);

export function questionsFrom(bestOf, intake, nowMs) {
  const cards = new Map();
  ((bestOf && bestOf.categories) || []).forEach((c) => {
    const cat = LIST_CATS[c.id] || 'around';
    (c.entries || []).forEach((e) => {
      if (e.status === 'comment-suggestion') return;
      const toks = tokens(e.question), key = cat + ':' + (toks.join(' ') || e.id);
      const card = cards.get(key) || { k: 'q-' + e.id, q: e.question, cat, toks, threads: [] };
      cards.set(key, card);
      (e.sources || []).forEach((s) => {
        if (!held(s.label) && !card.threads.some((t) => t.url === s.thread_url)) card.threads.push({ title: s.label, url: s.thread_url, ts: askedAt(s.thread_url), exact: false });
      });
    });
  });
  const list = [...cards.values()].filter((c) => c.threads.length);
  ((intake && intake.posts) || []).forEach((p) => {
    if (!p || p.sub !== 'r/burlington' || !usable(p, nowMs) || p.out || !isAsk(p.title)) return;
    const have = new Set(words(p.title));
    let match = null;
    list.forEach((c) => { if (fits(c, have, p.title) && (!match || c.toks.length > match.toks.length)) match = c; });
    const thread = { title: p.title, url: p.url, ts: when(p.created), exact: true };
    if (match) {
      match.threads = match.threads.filter((t) => t.url !== p.url);
      match.threads.push(thread);
      return;
    }
    const cat = catOf(p.title);
    if (cat !== 'around' || PLAIN_ASK.test(p.title)) list.push({ k: 'q-n-' + p.id, q: p.title, cat, toks: [], threads: [thread] });
  });
  list.forEach((c) => {
    c.threads.sort((a, b) => b.ts - a.ts);
    c.n = c.threads.length;
    c.last = c.threads[0].ts;
    c.week = c.threads[0].exact && nowMs - c.last <= 7 * DAY ? 1 : 0;
  });
  return list.sort(rank);
}

/* one question a day, the same for everyone: the most-asked take turns */
export function questionOfDay(cards, nowMs) {
  const pool = cards.filter((c) => c.n >= 3).sort((a, b) => a.k.localeCompare(b.k));
  return pool.length ? pool[Math.floor((nowMs - 4 * HOUR) / DAY) % pool.length] : null;
}
export function search(cards, text) {
  const want = words(text);
  if (!want.length) return cards;
  return cards.filter((c) => {
    const have = words(c.q + ' ' + c.threads.map((t) => t.title).join(' ')).join(' ');
    return want.every((w) => have.includes(w));
  });
}
