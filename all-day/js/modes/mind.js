/* Body · Mind: Lake Breath, and what people are reading and writing about it.

   The sit is first: one circle on one of Stephen's own lake photographs, a
   length and Start. Four seconds in, six out, no holds, the pattern the
   Lake Breath app was built on. It runs full screen with the lake's sound
   (js/lake-sound.js) and keeps the screen on. Leaving the page ends it
   honestly: what was sat counts, 30 seconds or more, and hidden time doesn't.
   A finished sit adds to the count kept on this phone and ticks Today's
   Breathe tile, the same tick the tile gives by hand, so the day's score
   rules don't change.

   Under it, one feed, newest first and read fresh on each open: headlines
   from pulse.json and the Wire that pass onTopic(), and readers' notes from
   the mind board. People narrows it to the notes. Reddit stays out: the
   shared intake carries no meditation subreddit, and the ones it has are
   people's own posts or the wrong subject.

   The mind board needs nn-ROUND5.sql. Until the server's rules carry it, the
   notes, the People pill and the Post button stay out and the sit and the
   headlines work alone. Every note waits for Stephen on the boards desk, as
   the Lake Breath wall's notes did. Every reader-facing word is in COPY. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import * as boards from '../boards.js';
import * as lake from '../lake-sound.js';
import { el, esc, ICON, agoShort, pills, safeHref } from '../ui.js';
import { today, keep, put, seed, mmss } from './body-kit.js';
import { markDone, saveDayScore } from './day.js';

const COPY = {
  label: 'Mind',
  promise: 'Breathe with the lake.',
  name: 'Lake Breath',
  start: 'Start',
  length: 'Length',
  lengthOne: (n) => n + ' min',
  sound: 'Sound',
  count: (n, m) => n + (n === 1 ? ' sit' : ' sits') + ' · ' + m + ' min',
  settle: 'Settle',
  in: 'In',
  out: 'Out',
  end: 'End',
  done: 'Done',
  note: 'Write a note',
  sat: (m) => m + ' min',
  all: 'All',
  people: 'People',
  post: 'Post',
  heading: 'Your sit',
  noteLabel: 'How was it?',
  notePlaceholder: 'Five minutes by the water',
  loading: 'Loading',
  empty: 'Nothing new',
  noneYet: 'No notes yet',
  share: 'Share',
  save: 'Save',
  report: 'Report',
  remove: 'Delete your post',
  source: 'Mind',
  openSource: 'Open the source',
  gone: 'That’s not in Mind any more.',
};
/* the three phrases of the Lake Breath app, one a day, at the end of a sit */
const PHRASES = ['Listen.', 'Choose again.', 'Devote.'];

const KEY = 'mind';
const SITS = 'allday-body-mind-sits';     // { sits, seconds }, on this phone
const SET = 'allday-body-mind';           // { minutes, quiet }
const BOARD = 'mind';
const LENGTHS = [3, 5, 10];               // the Lake Breath app's own
const IN = 4, OUT = 6;
const LEAD = 2500;                        // the circle settles before the first breath
const COUNTS = 30;                        // seconds a sit needs to count
const TZ = 'America/New_York';
const DAY = 86400000;
const WINDOW = 60;                        // days a headline stays in the feed
const MOST = 24;                          // headlines drawn
const EACH = 3;                           // from one source

/* ------------------------------------------------------------ the sky */
/* Stephen's own Lake Champlain photographs (assets/lake), one for the hour
   and the day, so the sky changes with the hours and again tomorrow and
   never mid-sit. x is where the picture's sun sits, for a tall crop. Night
   has no photograph. */
const SKY = {
  day: [['day-sails', 50], ['day-rays', 50], ['day-pine', 62, 'warm']],
  golden: [['golden-dock', 55], ['golden-sail', 55], ['golden-sun', 22], ['golden-streaks', 50, 'cold']],
  dusk: [['dusk-pink', 45], ['dusk-embers', 50], ['dusk-pale', 50, 'cold'], ['dusk-winter', 50, 'cold']],
};
/* Burlington's sunrise and sunset by month, on the wall clock */
const RISE = [7.5, 7, 7, 6.3, 5.5, 5.1, 5.3, 5.9, 6.6, 7.2, 6.9, 7.4];
const SET_SUN = [16.8, 17.4, 18.6, 19.7, 20.3, 20.7, 20.6, 20, 19, 18.2, 16.6, 16.3];
function nyNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', month: 'numeric', hour: 'numeric', minute: 'numeric' })
    .formatToParts(new Date()).map((x) => [x.type, Number(x.value)]));
  return { month: p.month - 1, hour: p.hour + p.minute / 60 };
}
export function skyAt(month, hour) {
  const rise = RISE[month], set = SET_SUN[month];
  if (hour < rise - 0.7 || hour >= set + 1.2) return 'night';
  if (hour < rise + 0.7) return 'dusk';
  if (hour < set - 1.3) return 'day';
  return hour < set + 0.2 ? 'golden' : 'dusk';
}
const dayNumber = () => Math.floor(Date.parse(today() + 'T12:00:00Z') / DAY);
function photo() {
  const { month, hour } = nyNow();
  const phase = skyAt(month, hour);
  if (phase === 'night') return null;
  const cold = month >= 10 || month <= 3;
  const list = SKY[phase].filter(([, , when]) => !when || (when === 'cold') === cold);
  const [file, x] = list[dayNumber() % list.length];
  return { src: 'assets/lake/' + file + '.jpg', x };
}
const skyPic = () => { const p = photo(); return p ? '<img class="tf-pic" src="' + esc(p.src) + '" alt="" decoding="async" style="object-position:' + p.x + '% 50%" onload="this.classList.add(\'on\')" onerror="this.remove()">' : ''; };
const flower = () => '<div class="mi-flower" aria-hidden="true">' + '<i></i>'.repeat(6) + '</div>';

/* ------------------------------------------------- what the feed takes */
/* A word that settles it, or a softer word with a health word beside it, and
   nothing from NEVER. Titles only: tragedy, suicide, crime and politics
   stay out however the rest of the headline reads. */
const SURE = /\b(meditat(e|ing|ions?)|mindful\w*|breathwork|breathing exercises?|mental[- ]health|mental illness|insomnia|sleep (apnea|deprivation|loss|quality|hygiene|disorders?|habits?|schedule|study|research)|(better|more|less|good|poor|bad|lost) sleep|well-?being|screen time|circadian|melatonin|adhd|ptsd|psychotherap\w*|therapists?|your brain)\b/i;
const SOFT = /\b(anxi\w+|stress(ed|ful)?|depress(ion|ed)|sleep|lonely|loneliness|time change|nervous system|calm|mood|emotions?)\b/i;
const HEALTH = /\b(stud(y|ies)|research\w*|scientists?|doctors?|health|mind|linked|tips?|how to|helps?|improves?|disrupts?|tames?|reduces?|wellness|habits?)\b/i;
/* words that mean something else elsewhere: a memory chip, a racing game */
const LOOSE = /\b(memory|the brain|burnout)\b/i;
const PERSON = /\b(anxi\w+|stress(ed|ful)?|depress(ion|ed)|mood|emotions?|mental|mindset|nurses?|teachers?|caregivers?|parents?|employees?|workers)\b/i;
const NEVER = /suicid|self[- ]harm|overdos|kill|murder|homicide|manslaughter|\bdead\b|death|\bdies?\b|\bdied\b|dying|own li(fe|ves)\b|\bhanged\b|\bhanging\b|drown|fatal|shoot|gunm[ae]n|gunfire|massacre|slain|violen|\bshot\b|stab|\brape|sexual|assault|abus|crash|arrest|charged|lawsuit|\bsue[ds]?\b|\btrial\b|sentenc|convict|accused|fraud|judge|\bcourt|settlement|guilty|indict|inmate|prison|\bjail|police|standoff|hostage|\bwar\b|missing|tragedy|tragic|victim|attack|bomb|\bguns?\b|cancer|terminal|9\/11|trump|biden|midterm|election|senate|congress|tariff|market|stocks?\b|\bdeal\b|\bsale\b|% off|coupon|\breview\b|\bai\b|economy|\bcuts?\b|layoffs?|sleep mode|great depression|tropical depression|bereav|stroke|ukrain|gaza|israel|earthquake|chatgpt|computers?\b|products?\b|\bclaims\b|activists?\b|\bsen\.|\balbum\b|\bfilm\b|\bnovel\b/i;
export const onTopic = (title) => { const t = String(title || ''); return !NEVER.test(t) && (SURE.test(t) || (SOFT.test(t) && HEALTH.test(t)) || (LOOSE.test(t) && PERSON.test(t))); };
/* a whole source of the wrong kind: its titles use the same words for other things */
const OFF_TOPICS = new Set(['sports', 'gaming', 'culture', 'business', 'politics', 'courts', 'public-safety', 'markets', 'economy', 'national-politics', 'state-politics', 'arts-culture', 'music', 'media']);
const OFF_CHANNELS = new Set(['reddit', 'x', 'facebook', 'newsletters', 'video', 'sports']);
const REDDIT = /^r\//;                     // older rows carry a subreddit with no channel

const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i += 1) h = (h * 33 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const headline = (title, url, src, ts, pic) => ({ type: 'news', k: 'mi-' + hash(url), title: String(title).replace(/\s+/g, ' ').trim(), url, src, ts, pic: /^https:/.test(pic || '') ? pic : '' });
function fromPulse(p) {
  const sources = new Map(((p && p.sources) || []).map((s) => [s.id, s]));
  const of = (x) => sources.get(x.s) || {};
  const name = (x) => of(x).short || of(x).name || x.s;
  return ((p && p.items) || []).filter((x) => !OFF_CHANNELS.has(x.ch) && !OFF_TOPICS.has(of(x).topic) && !REDDIT.test(name(x)) && onTopic(x.t))
    .map((x) => headline(x.t, x.u, name(x), x.d * 1000, x.i));
}
function fromWire(t) {
  return ((t && t.updates) || []).flatMap((u) => u.items || []).filter((x) => x.title && x.url && !OFF_CHANNELS.has(x.ch) && !OFF_TOPICS.has(x.topic) && !REDDIT.test(x.name || '') && onTopic(x.title))
    .map((x) => headline(x.title, x.url, x.name || x.src, Date.parse(x.posted_at) || 0, x.thumb));
}
/* a tile opens a page to read, never a raw audio file */
const AUDIO = /\.(mp3|m4a)([?#]|$)/i;
/* the same story from both files once, newest first, no source flooding it */
export function pick(rows, now) {
  const seen = new Set(), bySource = new Map();
  return rows.filter((r) => /^https?:/.test(r.url || '') && !AUDIO.test(r.url) && now - r.ts < WINDOW * DAY).sort((a, b) => b.ts - a.ts).filter((r) => {
    const name = r.title.toLowerCase();
    const n = bySource.get(r.src) || 0;
    if (seen.has(r.k) || seen.has(name) || n >= EACH) return false;
    seen.add(r.k); seen.add(name); bySource.set(r.src, n + 1);
    return true;
  }).slice(0, MOST);
}

/* ------------------------------------------------------------ the state */
const S = { root: null, feed: null, tools: null, pulse: null, wire: null, demoNews: [], notes: [], live: false, on: 'all', sit: null, opened: 0, want: null, waiting: null };
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const setting = () => obj(keep(SET, {}));
const minutes = () => { const m = Number(setting().minutes); return LENGTHS.includes(m) ? m : LENGTHS[1]; };
const quiet = () => !!setting().quiet;
const remember = (patch) => put(SET, { ...setting(), ...patch });
const tally = () => { const t = obj(keep(SITS, {})); return { sits: Number(t.sits) || 0, seconds: Number(t.seconds) || 0 }; };

/* ------------------------------------------------------------- the stage */
function stage() {
  const t = tally();
  const s = el('section', 'mi-stage');
  s.innerHTML = skyPic() + '<div class="mi-top"><h2 class="mi-name">' + esc(COPY.name) + '</h2>' +
    '<button class="mi-sound" data-sound aria-label="' + esc(COPY.sound) + '" aria-pressed="' + !quiet() + '">' + (quiet() ? ICON.soundOff : ICON.soundOn) + '</button></div>' +
    '<div class="mi-orbit">' + flower() + '</div>' +
    '<div class="mi-lengths" role="group" aria-label="' + esc(COPY.length) + '">' + LENGTHS.map((m) =>
      '<button data-minutes="' + m + '" aria-pressed="' + (m === minutes()) + '">' + esc(COPY.lengthOne(m)) + '</button>').join('') + '</div>' +
    '<button class="mi-start" data-start>' + esc(COPY.start) + '</button>' +
    (t.sits ? '<p class="mi-count">' + esc(COPY.count(t.sits, Math.round(t.seconds / 60))) + '</p>' : '');
  return s;
}
function paintLengths() {
  S.root.querySelectorAll('[data-minutes]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.minutes) === minutes())));
}
function paintSound() {
  const b = S.root.querySelector('[data-sound]');
  if (!b) return;
  b.innerHTML = quiet() ? ICON.soundOff : ICON.soundOn;
  b.setAttribute('aria-pressed', String(!quiet()));
}

/* --------------------------------------------------------------- the sit */
let wake = null;
function stayAwake(on) {
  if (on) { Promise.resolve(navigator.wakeLock && navigator.wakeLock.request('screen')).then((l) => { if (S.sit) wake = l; else if (l) l.release(); }).catch(() => {}); return; }
  try { if (wake) wake.release(); } catch (e) { /* gone */ }
  wake = null;
}
function clockLeft() {
  const n = S.sit && S.sit.box.querySelector('.mi-left');
  if (n) n.textContent = mmss(Math.max(0, S.sit.seconds - (Date.now() - S.sit.began) / 1000));
}
function breathe(kind) {
  const s = S.sit;
  if (!s) return;
  const secs = kind === 'in' ? IN : OUT;
  s.box.dataset.breath = kind;
  s.word.textContent = kind === 'in' ? COPY.in : COPY.out;
  if (s.sound) { lake.cue(kind, secs); if (s.night) lake.loon(); }
  if (navigator.vibrate) { try { navigator.vibrate(18); } catch (e) { /* no buzz */ } }
  s.turn = setTimeout(() => {
    if (Date.now() - s.began >= s.seconds * 1000) { finish(); return; }
    breathe(kind === 'in' ? 'out' : 'in');
  }, secs * 1000);
}
/* the page behind a sit, out of reach of Tab and Enter until the sit's screen goes */
let held = [];
function hold(box) {
  held = [...document.body.children].filter((n) => n !== box && n.id !== 'toast' && !n.inert);
  held.forEach((n) => { n.inert = true; });
}
function letGo(box) {
  box.remove();
  held.forEach((n) => { n.inert = false; });
  held = [];
  const start = S.root && S.root.querySelector('[data-start]');
  if (start) start.focus({ preventScroll: true });
}
function begin() {
  if (S.sit || document.querySelector('.mi-sit')) return;
  app.silenceForeign();
  if (app.isPlaying()) app.stop();
  const { month, hour } = nyNow();
  const seconds = minutes() * 60;
  const box = el('div', 'mi-sit');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', COPY.name);
  box.innerHTML = skyPic() + '<button class="mi-end" data-end>' + esc(COPY.end) + '</button>' +
    '<div class="mi-orbit">' + flower() + '<span class="mi-word" aria-live="polite">' + esc(COPY.settle) + '</span></div>' +
    '<p class="mi-left">' + esc(mmss(seconds)) + '</p>';
  box.style.setProperty('--mi-in', IN + 's');
  box.style.setProperty('--mi-out', OUT + 's');
  box.addEventListener('click', (e) => { if (e.target.closest('[data-end]')) finish(); });
  document.body.appendChild(box);
  hold(box);
  box.querySelector('[data-end]').focus({ preventScroll: true });
  S.sit = { box, word: box.querySelector('.mi-word'), seconds, began: 0, night: skyAt(month, hour) === 'night', sound: !quiet(), turn: 0, tick: 0 };
  if (S.sit.sound) lake.start(hour);
  stayAwake(true);
  S.sit.turn = setTimeout(() => {
    if (!S.sit) return;
    S.sit.began = Date.now();
    S.sit.tick = setInterval(clockLeft, 500);
    breathe('in');
  }, LEAD);
}
/* the sit ends here however it ends: time up, End, or the page going away */
function finish() {
  const s = S.sit;
  if (!s) return;
  clearTimeout(s.turn);
  clearInterval(s.tick);
  stayAwake(false);
  const sat = s.began ? Math.min(s.seconds, Math.round((Date.now() - s.began) / 1000)) : 0;
  S.sit = null;
  if (sat < COUNTS) { if (s.sound) lake.stop(800); letGo(s.box); return; }
  if (s.sound) lake.bowl();
  const t = tally();
  put(SITS, { sits: t.sits + 1, seconds: t.seconds + sat });
  markDone('breathe');
  saveDayScore();
  const mins = Math.max(1, Math.round(sat / 60));
  s.box.dataset.breath = 'end';
  s.box.querySelector('[data-end]').remove();
  s.box.querySelector('.mi-left').remove();
  s.word.textContent = PHRASES[dayNumber() % PHRASES.length];
  const foot = el('div', 'mi-after', '<p class="mi-sat">' + esc(COPY.sat(mins)) + '</p>');
  const leave = () => { drawStage(); letGo(s.box); };
  const done = el('button', 'mi-start', esc(COPY.done));
  done.addEventListener('click', leave);
  foot.appendChild(done);
  if (S.live) {
    const note = el('button', 'mi-write', esc(COPY.note));
    note.addEventListener('click', () => { leave(); compose(mins); });
    foot.appendChild(note);
  }
  s.box.appendChild(foot);
  done.focus({ preventScroll: true });
}
document.addEventListener('visibilitychange', () => { if (document.hidden && S.sit) finish(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.sit) finish(); });

/* ------------------------------------------------------------- the notes */
function compose(mins) {
  boards.compose({ board: BOARD, kind: 'sit', heading: COPY.heading, title: COPY.noteLabel, titlePlaceholder: COPY.notePlaceholder, body: false, cta: COPY.post,
    meta: mins ? { minutes: mins } : undefined, onPosted: loadNotes });
}
function loadNotes() {
  return boards.hasBoard(BOARD).then((yes) => {
    S.live = yes === true;
    return S.live ? boards.list(BOARD, { limit: 30 }) : { posts: [] };
  }).then((r) => { S.notes = r.posts || []; drawTools(); }).finally(() => arrived('notes'));
}

/* a dead link can only be called dead once everything that could hold it is in */
function arrived(file) {
  if (S.waiting) S.waiting.delete(file);
  drawFeed();
}

/* ------------------------------------------------------------- the tiles */
const stamp = (ts) => (Date.now() - ts < 2 * DAY ? agoShort(ts / 1000) : new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ }));
const actBtn = (act, label, icon, on) => '<button class="act' + (act === 'save' ? ' star' + (on ? ' on' : '') : act === 'share' ? ' sh' : '') + '" data-act="' + act + '" aria-label="' + esc(label) + '"' + (act === 'save' ? ' aria-pressed="' + !!on + '"' : '') + '>' + icon + '</button>';
const head = (tag, when) => '<div class="tf-head"><span class="tf-tag eyebrow">' + esc(tag) + '</span><span class="tf-when">' + esc(when) + '</span></div>';
const titleOf = (t, tag) => '<div class="tf-words"><' + tag + ' class="tf-title">' + esc(t) + '</' + tag + '></div>';
function newsTile(r) {
  const it = { k: r.k, kind: 'post', title: r.title, text: '', href: r.url, src: r.src, ago: stamp(r.ts), open: COPY.openSource };
  app.know([it]);
  const c = el('article', 'card tf tf-mind' + (r.pic ? ' has-pic' : ''));
  c.dataset.k = r.k;
  c.innerHTML = '<div class="tf-frame">' + (r.pic ? '<img class="tf-pic" src="' + esc(safeHref(r.pic)) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : '') +
    head(r.src, stamp(r.ts)) + '<a class="tf-go" href="' + esc(safeHref(r.url)) + '" target="_blank" rel="noopener" data-open aria-label="' + esc(r.title) + '"></a>' +
    '<div class="tf-foot">' + titleOf(r.title, 'h3') + '<span class="tf-acts">' + actBtn('share', COPY.share, ICON.share) + actBtn('save', COPY.save, ICON.star, store.isSaved(r.k)) + '</span></div></div>';
  return c;
}
function noteTile(p) {
  const it = boards.item(p, { tab: KEY, meta: () => '' });
  app.know([it]);
  const c = el('article', 'card board tf tf-note');
  c.dataset.k = it.k;
  const mins = Number(p.meta && p.meta.minutes);
  c.innerHTML = '<div class="tf-frame">' + head(it.author, [mins ? COPY.sat(mins) : '', it.ago].filter(Boolean).join(' · ')) +
    '<div class="tf-foot">' + titleOf(it.title, 'p') + '<span class="tf-acts">' + actBtn('share', COPY.share, ICON.share) +
    (it.mine ? actBtn('bdelete', COPY.remove, ICON.trash) : actBtn('breport', COPY.report, ICON.flag)) + actBtn('save', COPY.save, ICON.star, store.isSaved(it.k)) + '</span></div></div>';
  return c;
}
function rows() {
  const notes = S.notes.map((p) => ({ type: 'note', post: p, ts: Date.parse(p.created_at) || 0 }));
  if (S.on === 'people') return notes;
  const news = app.demo ? S.demoNews : fromPulse(S.pulse).concat(fromWire(S.wire));
  return pick(news, Date.now()).concat(notes).sort((a, b) => b.ts - a.ts);
}

/* ---------------------------------------------------------------- the page */
function drawStage() {
  const old = S.root && S.root.querySelector('.mi-stage');
  if (old) old.replaceWith(stage());
}
function drawTools() {
  const box = S.tools;
  if (!box) return;
  box.innerHTML = '';
  box.hidden = !S.live;
  if (!S.live) { S.on = 'all'; return; }
  box.appendChild(pills([['all', COPY.all], ['people', COPY.people]], S.on, (v) => { S.on = v; drawFeed(); }));
  const post = el('button', 'pillbtn mi-post', ICON.plus + esc(COPY.post));
  post.type = 'button';
  post.addEventListener('click', () => compose(0));
  box.appendChild(post);
}
function drawFeed() {
  const f = S.feed;
  if (!f) return;
  const list = rows();
  f.innerHTML = '';
  list.forEach((r, i) => {
    const c = r.type === 'note' ? noteTile(r.post) : newsTile(r);
    if (i % 2) c.classList.add('alt');
    f.appendChild(c);
  });
  if (!list.length) f.appendChild(el('p', 'mi-empty', esc(S.on === 'people' ? COPY.noneYet : COPY.empty)));
  /* a shared link lands once what it points to has come in, or says it's gone */
  if (!S.want) return;
  if (S.root.querySelector('[data-k="' + CSS.escape(S.want) + '"]')) { app.flashHit(S.root, S.want); S.want = null; return; }
  if (S.waiting && !S.waiting.size) { app.toast(COPY.gone); S.want = null; }
}
function draw() {
  const root = S.root;
  root.innerHTML = '';
  const wrap = el('div', 'mi-wrap');
  wrap.dataset.body = KEY;
  wrap.appendChild(stage());
  S.tools = el('div', 'mi-tools');
  S.feed = el('div', 'mi-feed');
  wrap.append(S.tools, S.feed);
  root.append(wrap, el('div', 'spacer'));
  drawTools();
  drawFeed();
}

/* the demo's news and sit count are its own file's; its notes are boards-fake.js's */
function seedDemo(d) {
  S.demoNews = (d.headlines || []).filter((h) => onTopic(h.title)).map((h) => headline(h.title, h.url, h.src, Date.now() - h.hoursAgo * 3600000));
  seed(SITS, d.sits || {});
}
function load() {
  S.opened = Date.now();
  S.waiting = new Set(app.demo ? ['notes'] : ['pulse', 'today', 'notes']);
  if (app.demo) { app.demoData('mind').then((d) => { seedDemo(d); drawStage(); drawFeed(); return loadNotes(); }).catch(() => {}); return; }
  data.load('pulse', (p) => { S.pulse = p; arrived('pulse'); }, () => arrived('pulse'));
  data.load('today', (t) => { S.wire = t; arrived('today'); }, () => arrived('today'));
  loadNotes();
}
function onTap(e) {
  const len = e.target.closest('[data-minutes]');
  if (len) { remember({ minutes: Number(len.dataset.minutes) }); paintLengths(); return; }
  if (e.target.closest('[data-sound]')) { remember({ quiet: !quiet() }); paintSound(); return; }
  if (e.target.closest('[data-start]')) begin();
}

app.register(KEY, {
  label: COPY.label,
  icon: ICON.mind,
  promise: COPY.promise,
  mount(root) {
    S.root = root;
    app.bindFeed(root, { onPeek() {} });
    root.addEventListener('click', onTap);
    root.addEventListener('load', (e) => { const n = e.target; if (n.classList && n.classList.contains('tf-pic')) n.classList.add('on'); }, true);
    root.addEventListener('error', (e) => { const n = e.target; if (n.classList && n.classList.contains('tf-pic')) { const c = n.closest('.card'); if (c) c.classList.remove('has-pic'); n.remove(); } }, true);
    window.addEventListener('allday-boards', (e) => { const b = e.detail && e.detail.board; if (!b || b === BOARD) loadNotes(); });
    app.onAuth(() => { if (S.feed) loadNotes(); });
    draw();
    load();
  },
  activate(param) {
    if (!S.root) return;
    drawStage();
    /* fresh on each open: the notes, and the live files if they've moved */
    if (Date.now() - S.opened > 60000) {
      S.opened = Date.now();
      if (!app.demo) { data.check('pulse'); data.check('today'); }
      loadNotes();
    }
    S.want = param || null;
    /* the link may be a headline, which People hides */
    if (param) { S.on = 'all'; drawTools(); drawFeed(); }
  },
  deactivate() { if (S.sit) finish(); },
  refresh() { if (S.root) drawFeed(); },
  newSince() { return 0; },
});

/* for tests */
export const _sit = () => (S.sit ? { seconds: S.sit.seconds, began: S.sit.began } : null);
export const _end = (seconds) => { if (S.sit) { S.sit.began = Date.now() - seconds * 1000; finish(); } };
