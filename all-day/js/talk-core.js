/* talk-core.js — what Talk deals, worked out from the deck and the Wire. No
   DOM, so node can test it.

   stories(today, muted)
     Today's edition as cards: its picks and river for Headlines, its sports
     lanes for Sports, the local half of both for Local. Only outlets' stories
     (no posts, threads or newsletters), and only what people can talk about
     over dinner: fit() is held(), the guard the Reddit tab uses, plus a list
     of crime, deaths, tragedy and disaster words and a title that is only a
     name. Obituary pages go by their address. A miss costs one card.

   queue(bubble, deck, news, used)
     The cards a group has not used, in the order they will be dealt. Heavy
     cards are dealt only in Deep, the Stay Awhile rule that they appear only
     when someone asked for deep water. Mix takes one from each bubble in turn.

   normal(raw), addGroup, removeGroup, startOver, markUsed
     What a phone remembers: { groups, on, used: { groupId: { cardId: time } } }.
     Every reader has the default group, so a card is always used by someone. */

import { held } from './reddit-lib.js';

export const BUBBLES = [['mix', 'Mix'], ['head', 'Headlines'], ['sports', 'Sports'], ['local', 'Local'],
  ['ice', 'Icebreakers'], ['deep', 'Deep'], ['debate', 'Debates']];
export const DEFAULT_GROUP = 'everyone';
export const GROUP_COLORS = 6;           // --talk-g1 to --talk-g6
const MIX_ORDER = ['ice', 'head', 'debate', 'sports', 'deep'];
const STORY_CHANNELS = new Set(['local', 'world']);
const LEFT_TOPICS = new Set(['public-safety', 'courts', 'markets']);
const MAX_TITLE = 130;                   // past this it is a post, not a headline

const HEAVY = /\b(kill(?:s|ed|ing|er|ers)?|dead|dies?|died|dying|deaths?|deadly|fatal\w*|pass(?:es|ed)? away|obituar\w*|tributes?|funeral|mourn\w*|memorial|vigil|remembers|tragic|tragedy|tragedies|victims?|suicid\w*|overdos\w*|drown\w*|missing|crash\w*|collision|wreck\w*|rollover|injur\w*|hospitali[sz]ed|critical condition|rescued|wildfires?|fires?|burn|blaze|inferno|hurricanes?|typhoons?|tornado\w*|earthquakes?|tsunami|floods?|flooding|landslides?|avalanche|disasters?|catastroph\w*|evacuat\w*|explosions?|bombs?|bombing|blast|attacks?|attacked|ambush\w*|airstrikes?|missiles?|drones?|troops|invasion|massacre|genocid\w*|battered|wars?|gunman|gunmen|gunfire|guns?|shot|shoots?|shooter|knife|hostages?|terror\w*|crimes?|criminal|robber\w*|burglar\w*|theft|kidnap\w*|trafficking|sexual|prison|jail\w*|inmates?|detainees?|police|lawsuit|sued|trial|verdict|guilty|cancer|dementia|miscarriages?|outbreak|epidemic|pandemic|flesh-eating|cruel\w*|hate|plead\w*|plea|suspects?|suspected|cited|looting|riot\w*|violen\w*|execution|espionage|sabotage|shackled|blood clots?|fuck\w*|epstein)\b/i;

/* "Maria Lopez is back" or just "Maria Lopez": whoever it is, a person. Words
   that open a sentence are not a first name. */
const BARE_NAME = /^(?!(?:The|A|An|This|That|These|Those|Our|Your|My|Why|How|What|When|Where|Who|New|Old)\b)[A-Z][a-z'-]+ [A-Z][a-z'-]+(?:\s+(?:is|has)\b|[\s.!?…]*$)/;

export function fit(title, topic) {
  const t = String(title || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  return !LEFT_TOPICS.has(topic) && !held(t) && !HEAVY.test(t) && !BARE_NAME.test(t);
}

function card(it, b, sources) {
  if (!it || !it.id || !it.title || !/^https?:/i.test(String(it.url || '')) || /obituar/i.test(it.url)) return null;
  if (!STORY_CHANNELS.has(it.ch) || it.own || it.title.length > MAX_TITLE || !fit(it.title, it.topic)) return null;
  const src = it.name || (sources[it.src] && sources[it.src].name) || '';
  if (!src) return null;
  return { id: String(it.id), q: it.title, b, src, sid: it.src || src, url: it.url, local: !!it.local, d: (Date.parse(it.posted_at) || 0) / 1000, story: true };
}

export function stories(today, muted = {}) {
  const p = today && typeof today === 'object' ? today : {};
  const sources = p.sources && typeof p.sources === 'object' ? p.sources : {};
  const lanes = p.sports && typeof p.sports === 'object' && !Array.isArray(p.sports) ? p.sports : {};
  const river = (Array.isArray(p.updates) ? p.updates : []).flatMap((u) => (u && Array.isArray(u.items) ? u.items : []));
  const picks = (Array.isArray(p.picks) ? p.picks : []).slice().sort((a, b) => (a.rank || 99) - (b.rank || 99));
  const once = (list) => { const seen = new Set(); return list.filter((c) => c && !muted[c.sid] && !seen.has(c.id) && seen.add(c.id)); };
  const byNew = (a, b) => b.d - a.d;
  const head = once(picks.concat(river.slice()).filter((it) => it && it.topic !== 'sports').map((it) => card(it, 'head', sources)));
  const laneCards = Object.keys(lanes).flatMap((chip) => (Array.isArray(lanes[chip]) ? lanes[chip] : []).map((it) => {
    const c = card(it, 'sports', sources);
    if (c && chip === 'local') c.local = true;
    return c;
  }));
  const sports = once(laneCards.concat(river.filter((it) => it && it.topic === 'sports').map((it) => card(it, 'sports', sources))));
  return { head, sports: sports.filter((c) => c.local).sort(byNew).concat(sports.filter((c) => !c.local).sort(byNew)) };
}

export function deckCards(json) {
  const list = json && Array.isArray(json.cards) ? json.cards : [];
  return list.filter((c) => c && c.id && c.q && ['ice', 'deep', 'debate'].includes(c.b));
}

export function shuffle(list, rnd = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* one from each list in turn, until they run out */
function turns(lists) {
  const out = [];
  const left = lists.map((l) => l.slice());
  while (left.some((l) => l.length)) left.forEach((l) => { if (l.length) out.push(l.shift()); });
  return out;
}

export function queue(bubble, deck, news, used = {}, rnd = Math.random) {
  const open = (c) => !used[c.id];
  const fromDeck = (b) => shuffle(deck.filter((c) => c.b === b && open(c) && (!c.heavy || bubble === 'deep')), rnd);
  const head = (news.head || []).filter(open), sports = (news.sports || []).filter(open);
  if (bubble === 'head') return head;
  if (bubble === 'sports') return sports;
  if (bubble === 'local') {
    const seen = new Set();
    const local = head.concat(sports).filter((c) => c.local && !seen.has(c.id) && seen.add(c.id));
    return turns([shuffle(deck.filter((c) => c.local && !c.heavy && open(c)), rnd), local]);
  }
  if (bubble !== 'mix') return fromDeck(bubble);
  const pools = { ice: fromDeck('ice'), debate: fromDeck('debate'), deep: fromDeck('deep'), head, sports };
  const seen = new Set();
  return turns(MIX_ORDER.map((k) => pools[k])).filter((c) => !seen.has(c.id) && seen.add(c.id));
}

/* ---------------------------------------------------------------- groups */
const map = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export function normal(raw) {
  const r = map(raw);
  const groups = (Array.isArray(r.groups) ? r.groups : []).filter((g) => g && g.id && g.id !== DEFAULT_GROUP && typeof g.name === 'string' && g.name.trim());
  const all = [{ id: DEFAULT_GROUP, name: '', color: 1 }].concat(groups.map((g) => ({ id: String(g.id), name: g.name, color: Number(g.color) || 1 })));
  return { groups: all, on: all.some((g) => g.id === r.on) ? r.on : DEFAULT_GROUP, used: map(r.used) };
}
export const groupOf = (T) => T.groups.find((g) => g.id === T.on);
export const usedBy = (T, id = T.on) => map(T.used[id]);
export const usedCount = (T, id = T.on) => Object.keys(usedBy(T, id)).length;

export function addGroup(T, name, color) {
  const clean = String(name || '').trim().slice(0, 24);
  if (!clean) return null;
  const id = 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  T.groups.push({ id, name: clean, color: Number(color) || 1 });
  T.on = id;
  return id;
}
export function removeGroup(T, id) {
  if (id === DEFAULT_GROUP) return;
  T.groups = T.groups.filter((g) => g.id !== id);
  delete T.used[id];
  if (T.on === id) T.on = DEFAULT_GROUP;
}
export function startOver(T, id = T.on) { delete T.used[id]; }
export function markUsed(T, cardId, at = Date.now()) {
  T.used[T.on] = { ...usedBy(T), [cardId]: Math.floor(at / 1000) };
}
