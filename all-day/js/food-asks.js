/* food-asks.js — what Burlington asks Reddit about food, for the Food tab.

   Two pure shapers, no DOM, so node can test them (scripts/test-food-asks.mjs):

   asksFrom(intake, nowMs)
     The shared Reddit intake (scripts/reddit_intake.py, hourly, on the
     orphan reddit-data branch: r/burlington and r/vermont, titles, links and
     times only, a 10-day store) narrowed to the threads that ask for a food
     or drink recommendation, newest first. r/vermont counts only when the
     title names a Burlington-area place. Link posts (articles), removed
     posts, NSFW posts and anything negative are left out. Nothing from a
     thread is copied but its title.

   directoryFrom(bestOf)
     data/best-of-reddit.json's food, coffee and drink questions ("Best
     Nachos", "Coziest Bars"), one card per question, with their thread
     links and the Seven Daysies pick where the directory has one. The same
     question asked under two spellings ("Best Bagel", "Best Bagels") is one
     card. Most-asked first.

   Classifying is title rules only: an ask (best, recs, looking for, where
   to…, or a short question) about a food or drink word. Cheap and visible;
   a miss costs one thread, never a wrong claim, because every row is the
   thread's own title and links to it. */

const DAY = 86400000;
export const MAX_AGE_DAYS = 14;   // the store holds 10; past this, a stalled bridge empties the list instead of aging it

/* a kind of food or drink, a dish, a cuisine or a place to eat or drink */
const FOOD = new RegExp('\\b(' + [
  'food', 'foods', 'foodie', 'eat', 'eats', 'eating', 'eatery', 'eateries', 'dine', 'dining', 'meal', 'meals', 'snacks?',
  'breakfast', 'brunch', 'lunch', 'dinner', 'dessert', 'desserts', 'takeout', 'take-out', 'buffet', 'all[- ]you[- ]can[- ]eat',
  'restaurants?', 'cafes?', 'caf\u00e9s?', 'diners?', 'bakery', 'bakeries', 'deli', 'delis', 'food trucks?', 'pubs?', 'bars?',
  'taverns?', 'speakeasy', 'brewery', 'breweries', 'winery', 'distillery', 'happy hours?',
  'coffee', 'espresso', 'latte', 'lattes', 'cappuccino', 'matcha', 'chai', 'tea', 'boba', 'bubble tea', 'smoothies?', 'kombucha',
  'beers?', 'ipa', 'stout', 'cocktails?', 'mocktails?', 'wine', 'cider', 'martini', 'margaritas?',
  'pizza', 'pizzas', 'burgers?', 'sandwich', 'sandwiches', 'hoagies?', 'subs? shop', 'bagels?', 'donuts?', 'doughnuts?', 'pastry',
  'pastries', 'croissants?', 'bread', 'cakes?', 'cupcakes?', 'cookies?', 'pies?', 'ice cream', 'gelato', 'creemees?', 'fudge',
  'bbq', 'barbecue', 'wings', 'tacos?', 'burritos?', 'nachos', 'quesadillas?', 'sushi', 'ramen', 'pho', 'noodles?', 'dumplings?',
  'momos?', 'curry', 'banh mi', 'b\u00e1nh m\u00ec', 'bahn mi', 'falafel', 'gyros?', 'kebabs?', 'shawarma', 'poutine', 'fries',
  'steak', 'steakhouse', 'seafood', 'oysters?', 'lobster', 'fish', 'chicken', 'salad', 'salads', 'soup', 'soups', 'hot pot',
  'mac and cheese', 'cheese', 'cheesesteak', 'butcher', 'maple', 'syrup',
  'vegan', 'vegetarian', 'gluten[- ]free', 'halal', 'kosher',
  'thai', 'indian', 'chinese', 'mexican', 'italian', 'korean', 'japanese', 'vietnamese', 'ethiopian', 'nepali', 'greek',
  'mediterranean', 'middle eastern', 'french', 'cuban', 'caribbean',
].join('|') + ')(?![a-z0-9\\u00c0-\\u024f])', 'i');   /* a plain \b would not end after an accented letter (café) */

/* a place to eat or drink: a question about one is an ask on its own ("Bars to watch hockey?") */
const VENUE = /\b(restaurants?|caf[e\u00e9]s?|diners?|bakery|bakeries|delis?|food trucks?|pubs?|bars?|taverns?|brewery|breweries|places? to eat|spots? to eat)(?![a-z0-9\u00c0-\u024f])/i;

const ASK = new RegExp([
  '\\bbest\\b', '\\brecc?s\\b', '\\brecc?omm?end\\w*', '\\bsuggest\\w*', '\\bfavou?rites?\\b', '\\bfaves?\\b', '\\bgo-?to\\b',
  '\\blooking for\\b', '\\bin search of\\b', '\\biso\\b', '\\btrying to find\\b', '\\bcraving\\b', '\\bhidden gems?\\b',
  '\\bmust[- ]try\\b', '\\bworth (it|trying|going)\\b',
  "\\bwhere(?:'s|\u2019s| (?:to|can|do|does|should|is|are|would|has|have))\\b",
  '\\bwho (has|makes|sells|serves|does)\\b',
  '\\bany(?:one| one)? (?:good|know|have|recs?|suggest\\w*)\\b',
  '\\b(places?|spots?) (to|for|that|with)\\b',
  '\\bopen (late|early)\\b', '\\blate[- ]night\\b',
].join('|'), 'i');

/* a sale, a job, an announcement, a lost cat, a charity drive: not an ask */
const NOT_ASK = /\b(for sale|hiring|now open|is open|reopen\w*|grand opening|giveaway|discount|coupon|promo code|fundraiser|food (drive|bank|shelf|shelves|pantry)|donat\w*|charity|recall|inspection|lost|stolen|missed connection|join us|come (by|try|visit|see))\b/i;
/* the tab features, it never knocks: no "worst", no warnings */
const NEGATIVE = /\b(worst|overrated|avoid|terrible|awful|gross|disgusting|food poisoning|sick from|rip-?off|scam)\b/i;

/* r/vermont counts only when the title is about the Burlington area */
const AREA = /\b(burlington|btv|winooski|so ?bu|south burlington|essex|colchester|williston|shelburne|chittenden|church st(reet)?|old north end|hinesburg|jericho|milton|richmond)\b/i;

const words = (t) => t.split(/\s+/).filter(Boolean).length;

/* Is this title somebody asking where to eat or drink? */
export function isFoodAsk(title) {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  if (!t || !FOOD.test(t) || NOT_ASK.test(t) || NEGATIVE.test(t)) return false;
  if (ASK.test(t)) return true;
  if (/\?/.test(t) && VENUE.test(t)) return true;
  /* "Apple Cider Donuts?": the thing itself and a question mark */
  return /\?\s*$/.test(t) && words(t) <= 4;
}

export const burlingtonArea = (title) => AREA.test(String(title || ''));

const SUB_IDS = { 'r/burlington': 'r-burlington', 'r/vermont': 'r-vermont' };
const REDDIT = /^https:\/\/(www\.|old\.)?reddit\.com\/r\/[A-Za-z0-9_]+\/comments\/[a-z0-9]+\//i;

/* The intake's posts that are food asks, newest first. Each one:
   { k, url, title, sub, sid, d (epoch seconds), comments (number or null) } */
export function asksFrom(intake, nowMs) {
  const now = Number(nowMs) || Date.now();
  const posts = intake && Array.isArray(intake.posts) ? intake.posts : [];
  const gone = intake && intake.removed && typeof intake.removed === 'object' ? intake.removed : {};
  const seen = new Set();
  const out = [];
  posts.forEach((p) => {
    if (!p || typeof p.title !== 'string' || typeof p.url !== 'string' || !REDDIT.test(p.url)) return;
    const sub = String(p.sub || '').toLowerCase();
    if (!SUB_IDS[sub] || gone[p.id] || p.nsfw === true || p.kind === 'link') return;
    const ms = Date.parse(p.created || '');
    if (!Number.isFinite(ms) || ms > now + 3600000 || now - ms > MAX_AGE_DAYS * DAY) return;
    if (!isFoodAsk(p.title)) return;
    if (sub === 'r/vermont' && !burlingtonArea(p.title)) return;
    if (seen.has(p.url)) return;
    seen.add(p.url);
    const n = Number(p.comments);
    out.push({ k: p.url, url: p.url, title: p.title.replace(/\s+/g, ' ').trim(), sub, sid: SUB_IDS[sub], d: Math.floor(ms / 1000),
      comments: p.comments == null || !Number.isFinite(n) || n < 0 ? null : n });
  });
  return out.sort((a, b) => b.d - a.d);
}

/* ------------------------------------------------------------ directory */
export const GROUPS = [['food', 'Food', ['food-restaurants']], ['coffee', 'Coffee', ['coffee']], ['drinks', 'Drinks', ['bars-breweries']]];

/* "Best Bagels" and "Best Bagel", "Doughnuts" and "Donuts": one question */
const sameKey = (q) => String(q || '').toLowerCase().replace(/^best\s+/, '').replace(/doughnut/g, 'donut')
  .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').map((w) => w.replace(/s$/, '')).join(' ');

export function directoryFrom(bestOf) {
  const cats = bestOf && Array.isArray(bestOf.categories) ? bestOf.categories : [];
  const rows = [];
  GROUPS.forEach(([group, , ids]) => {
    cats.filter((c) => c && ids.includes(c.id)).forEach((c) => (Array.isArray(c.entries) ? c.entries : []).forEach((e) => {
      if (e && typeof e.question === 'string') rows.push({ group, e });
    }));
  });
  /* the questions still being asked first, so a merged card keeps their group */
  rows.sort((a, b) => (a.e.status === 'active' ? 0 : 1) - (b.e.status === 'active' ? 0 : 1));
  const by = new Map();
  rows.forEach(({ group, e }) => {
    if (NEGATIVE.test(e.question)) return;
    const threads = (Array.isArray(e.sources) ? e.sources : [])
      .filter((s) => s && REDDIT.test(String(s.thread_url || '')))
      .map((s) => ({ url: s.thread_url, label: String(s.label || '').trim() || 'The thread', year: Number(s.year) || null }));
    if (!threads.length) return;
    const key = sameKey(e.question);
    let q = by.get(key);
    if (!q) {
      q = { k: 'q-' + e.id, id: e.id, q: e.question, group, threads: [], sd: null };
      by.set(key, q);
    }
    threads.forEach((t) => { if (!q.threads.some((x) => x.url === t.url)) q.threads.push(t); });
    if (!q.sd && e.sevendays_note && /^https:\/\//.test(String(e.sevendays_url || ''))) {
      const m = /^Seven Daysies (\d{4}):\s*(.+)$/.exec(e.sevendays_note);
      if (m) q.sd = { year: Number(m[1]), pick: m[2].trim(), winner: m[2].replace(/\s*\([^)]*\)\s*$/, '').trim(), url: e.sevendays_url };
    }
  });
  const newest = (q) => Math.max(...q.threads.map((t) => t.year || 0));
  const list = [...by.values()];
  list.forEach((q) => q.threads.sort((a, b) => (b.year || 0) - (a.year || 0)));
  return list.sort((a, b) => b.threads.length - a.threads.length || newest(b) - newest(a) || a.q.localeCompare(b.q));
}
