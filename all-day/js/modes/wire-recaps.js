/* wire-recaps.js — the Wire's Recaps: the packed summaries Grok writes from
   X through the day (Stephen, 2026-10-19: "I love these recaps ... How can
   we highlight these packed recaps better?").

   The pipeline (scripts/wire_inbox.py, curate_wire.py; contract in PR #362)
   puts them on each day's payload:
     recaps         every recap posted that day, newest first: { id, kind,
                    title, posted_at, intro, basis, label, bullets: [{ id,
                    text, url, note, sport? }] }
     recaps_latest  the newest recap of each kind, newest first
     recap_kinds    every kind there can be, in order, with its fixed title
   Nothing here rewrites a recap's words; they are drawn as they came.

   Two places draw them:
     - Recaps mode (News · Photos · Square · Recaps): the day's recaps, each a
       big card with its kind, its time, where it came from ("From X trending
       summaries" or "From posts on X", never "AI"), the intro and the
       bullets as rows, a headline that links out and its one line. Five
       bullets show; "Show all N" opens the rest, with the Collapse bar.
     - the strip on News, after the top stories: the newest recap of each
       kind as a small card, tapping into Recaps at that recap. A bullet the
       river already carries (same id) is not repeated on the small card.

   modes/wire.js owns the tab, the day pager and the banner, and hands this
   file a ctx through init(). */

import * as app from '../app.js';
import { el, esc, safeHref, ICON, button, rail } from '../ui.js';

const OPEN = 5;            // bullets on a card before "Show all N"
const MINI = 2;            // bullets on a small card in News' strip
/* where a recap's words came from; a label that says AI is not used */
const FROM = { trending: 'From X trending summaries', accounts: 'From posts on X' };
const SAYS_AI = /\b(?:A\.?I\.?|artificial intelligence|grok|generated|model)\b/i;
const SPORT = { nba: 'NBA', nfl: 'NFL', nhl: 'NHL', mlb: 'MLB', tennis: 'Tennis', college: 'College', local: 'Vermont', soccer: 'Soccer' };
const isUrl = (u) => /^https?:\/\//i.test(String(u || ''));
const trim = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

let ctx = null;
/* ctx, from modes/wire.js:
     clock(ms)        "9:56 am", Burlington time
     open(id)         Recaps mode at that recap (the strip's small cards)
     all()            Recaps mode at its top (the strip's "All" button) */
export function init(c) { ctx = c; }

/* ------------------------------------------------------------- the data */
const CACHE = new WeakMap();
/* A payload's recaps as cards read them, newest first, each once. A recap
   without an id or a single linkable bullet is left out. */
export function recapsOf(p) {
  if (!p || typeof p !== 'object') return [];
  if (CACHE.has(p)) return CACHE.get(p);
  const titles = Object.create(null);
  (Array.isArray(p.recap_kinds) ? p.recap_kinds : []).forEach((k) => { if (k && k.kind) titles[k.kind] = trim(k.title); });
  const ids = new Set();
  const list = (Array.isArray(p.recaps) ? p.recaps : []).map((r) => {
    if (!r || typeof r !== 'object' || !r.id || ids.has(String(r.id))) return null;
    const bullets = (Array.isArray(r.bullets) ? r.bullets : [])
      .filter((b) => b && trim(b.text) && isUrl(b.url))
      .map((b) => ({ id: String(b.id || ''), text: trim(b.text), url: String(b.url), note: trim(b.note), sport: SPORT[b.sport] || '' }));
    if (!bullets.length) return null;
    ids.add(String(r.id));
    const label = trim(r.label);
    return { id: String(r.id), kind: String(r.kind || ''), title: trim(r.title) || titles[r.kind] || 'Recap', at: Date.parse(r.posted_at) || 0,
      intro: trim(r.intro), from: label && !SAYS_AI.test(label) ? label : FROM[r.basis] || FROM.accounts, bullets };
  }).filter(Boolean).sort((a, b) => b.at - a.at);
  CACHE.set(p, list);
  return list;
}
/* the newest of each kind, newest first: the payload's recaps_latest, read
   from the list itself so the two can never disagree */
export function latestOf(p) {
  const kinds = new Set();
  return recapsOf(p).filter((r) => !kinds.has(r.kind) && (kinds.add(r.kind), true));
}
/* the kinds a day has, in the payload's own order, for the banner's chips */
export function kindsOf(p) {
  const list = recapsOf(p);
  const order = (Array.isArray(p && p.recap_kinds) ? p.recap_kinds : []).map((k) => k && k.kind);
  const n = Object.create(null);
  list.forEach((r) => { n[r.kind] = (n[r.kind] || 0) + 1; });
  return Object.keys(n).sort((a, b) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)))
    .map((kind) => ({ key: kind, label: list.find((r) => r.kind === kind).title, n: n[kind] }));
}
export const find = (p, id) => recapsOf(p).find((r) => r.id === id) || null;

/* ------------------------------------------------------------- the card */
const bulletRow = (b) => '<li><a class="rc-b" href="' + esc(safeHref(b.url)) + '" target="_blank" rel="noopener">' +
  '<span class="rc-bt">' + esc(b.text) + '</span>' +
  (b.note || b.sport ? '<span class="rc-bn">' + (b.sport ? '<b>' + esc(b.sport) + '</b>' : '') + esc(b.note) + '</span>' : '') + '</a></li>';
function headHtml(r, tag, share) {
  return '<div class="rc-head"><' + tag + ' class="rc-t">' + esc(r.title) + '</' + tag + '><span class="rc-when">' + esc(r.at ? ctx.clock(r.at) : '') + '</span>' +
    (share ? '<button type="button" class="act sh rc-share" aria-label="Share this recap">' + ICON.share + '</button>' : '') + '</div>' +
    '<' + (tag === 'span' ? 'span' : 'p') + ' class="rc-from">' + esc(r.from) + '</' + (tag === 'span' ? 'span' : 'p') + '>';
}
/* A recap, big. o.open: every bullet, with the Collapse bar under them;
   o.onToggle(open) is the reader asking for that. */
export function card(r, o = {}) {
  const box = el('article', 'rcap');
  box.dataset.k = 'rc:' + r.id;
  box.dataset.kind = r.kind;
  const many = r.bullets.length > OPEN;
  const open = !!o.open && many;
  box.innerHTML = headHtml(r, 'h3', true) + (r.intro ? '<p class="rc-intro">' + esc(r.intro) + '</p>' : '') +
    '<ol class="rc-list">' + (open ? r.bullets : r.bullets.slice(0, OPEN)).map(bulletRow).join('') + '</ol>';
  /* Share sends the recap itself (#wire/recaps/<id>); its headlines are X's posts */
  box.querySelector('.rc-share').addEventListener('click', () => app.share('wire', 'recaps/' + r.id, r.title));
  if (many && !open) {
    const all = button('Show all ' + r.bullets.length + ' ' + ICON.down, 'ghost rc-all', () => o.onToggle(true));
    all.type = 'button';
    all.setAttribute('aria-label', 'Show all ' + r.bullets.length + ' in ' + r.title);
    box.appendChild(all);
  }
  if (open) {
    /* DESIGN §9.3's one sticky exception: the bar rides the bottom of the
       screen while this list is on it */
    const bar = el('div', 'collapsebar');
    const b = button(ICON.up + ' Collapse', '', (e) => { e.preventDefault(); e.stopPropagation(); o.onToggle(false); });
    b.type = 'button';
    b.dataset.collapse = '1';
    b.setAttribute('aria-label', 'Collapse ' + r.title);
    bar.appendChild(b);
    box.appendChild(bar);
  }
  return box;
}

/* ------------------------------------------------------- News' strip */
/* The newest recap of each kind as small cards in a row that scrolls
   sideways, ending in "All recaps". Stephen's rule for every horizontal
   row: "See as a list" lays the same cards out down the page, with the
   Collapse bar to fold them back. `inRiver` is the set of ids the river
   already shows. Returns the section, or null with no recaps. */
let listed = false;          // the reader asked for the list; kept for the visit
export function strip(p, inRiver) {
  const list = latestOf(p);
  if (!list.length) return null;
  const wrap = el('section', 'rc-strip' + (listed ? ' listed' : ''));
  wrap.setAttribute('aria-label', 'Recaps');
  const head = el('div', 'sec');
  head.innerHTML = '<div><h2>Recaps</h2></div>';
  const tog = button('', 'ghost sm rc-listbtn', () => setListed(!listed));
  tog.type = 'button';
  head.appendChild(tog);
  wrap.appendChild(head);
  const track = rail(wrap, 'rc-rail');
  const bar = el('div', 'collapsebar');
  const fold = button(ICON.up + ' Collapse', '', (e) => { e.preventDefault(); e.stopPropagation(); setListed(false); app.jumpTo(head); tog.focus({ preventScroll: true }); });
  fold.type = 'button';
  fold.dataset.collapse = '1';
  fold.setAttribute('aria-label', 'Collapse the recaps');
  bar.appendChild(fold);
  wrap.appendChild(bar);
  const setListed = (on) => {
    listed = on;
    wrap.classList.toggle('listed', on);
    tog.textContent = on ? 'See as a row' : 'See as a list';
    tog.setAttribute('aria-pressed', on ? 'true' : 'false');
    bar.hidden = !on;
  };
  setListed(listed);
  list.forEach((r) => {
    const b = el('button', 'rc-mini');
    b.type = 'button';
    b.dataset.recap = r.id;
    b.dataset.kind = r.kind;
    const fresh = r.bullets.filter((x) => !(x.id && inRiver.has(x.id)));
    b.innerHTML = headHtml(r, 'span') + (r.intro ? '<span class="rc-intro">' + esc(r.intro) + '</span>' : '') +
      (fresh.length ? '<span class="rc-mlist">' + fresh.slice(0, MINI).map((x) => '<span class="rc-mb">' + esc(x.text) + '</span>').join('') + '</span>' : '') +
      '<span class="rc-n">' + esc(r.bullets.length + (r.bullets.length === 1 ? ' headline' : ' headlines')) + ICON.right + '</span>';
    b.setAttribute('aria-label', r.title + ', ' + (r.at ? ctx.clock(r.at) : '') + ', ' + r.bullets.length + ' headlines');
    b.addEventListener('click', () => ctx.open(r.id));
    track.appendChild(b);
  });
  const all = el('button', 'rc-mini rc-end', '<span class="rc-t">All recaps</span>' + ICON.arrow);
  all.type = 'button';
  all.addEventListener('click', () => ctx.all());
  track.appendChild(all);
  return wrap;
}
