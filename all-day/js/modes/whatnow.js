/* whatnow.js — the middle button, and the only one that asks a question.

   Every other tab in this app is a place to browse. This one answers "what
   should I do, right now", which is the question the paper exists for and the
   reason it sits dead centre of the bar in its own colour.

   THE BUCKETING HAPPENS HERE, NOT IN THE PAYLOAD. all-day/data/whatnow.json
   is a flat list of the next ten days, rebuilt once a morning. It deliberately
   does not carry "tonight" or "this weekend", because a file written at 6am
   cannot know what time you opened the app — a payload that said "tonight"
   would be lying by dinner. The windows below are computed against the
   reader's clock every render.

   ON now → tonight → tomorrow. The first card is one event, chosen rather
   than listed: the nearest thing that has not started yet, preferring free
   and preferring something with a real start time over an all-day listing.
   A wall of forty events is a calendar, and the calendar already exists —
   this tab points at it from the bottom.

   Three doors out, on purpose. The full calendar, the day planner and the
   arcade are all better at their jobs than a phone tab is; the value here is
   the next few hours. The arcade earns its place because its outdoor half —
   claim a block, run a challenge — is the answer that still works on a
   Tuesday in February when the calendar has nothing on it. */

import * as store from './../store.js';
import * as data from './../wire.js';
import * as app from './../app.js';
import { el, esc, safeHref, chip, heading, shelfHead, scrollHint,
         tabStamp, stampOf, ICON } from './../ui.js';

const EVENTS_URL = '../events.html';
const PLANNER_URL = 'https://play.btownbrief.com/burlington-days/';
const ARCADE_URL = 'https://play.btownbrief.com/';

const state = { root: null, wn: null, cat: null, freeOnly: false };

export function mount(root) {
  state.root = root;
  root.innerHTML = '<p class="loading">Looking outside…</p>';
  data.load('whatnow', (json) => { state.wn = json; render(); }, () => {
    root.innerHTML = '';
    root.appendChild(el('div', 'errbox',
      '<b>Couldn’t reach the calendar.</b><br>It is rebuilt every morning.'));
  });
}

export function activate() {}
export function refresh() { if (state.wn) render(); }
export function deactivate() { app.closePeek(); }

/* ------------------------------------------------------------- windows */

const events = () => (state.wn && Array.isArray(state.wn.events)) ? state.wn.events : [];
const startOf = (e) => new Date(e.s);

/* An all-day listing has no useful clock, so it is never "starting soon" —
   it belongs to its day, not to an hour. */
const timed = (e) => !e.a;

function inWindow(e, fromMs, toMs) {
  const t = startOf(e).getTime();
  return t >= fromMs && t < toMs;
}

function endOfToday() {
  const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime();
}

function filtered(list) {
  let out = list;
  if (state.cat) out = out.filter((e) => e.c === state.cat);
  if (state.freeOnly) out = out.filter((e) => e.f);
  return out;
}

function clock(e) {
  if (e.a) return 'All day';
  return startOf(e).toLocaleTimeString('en-US',
    { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
}

function dayLabelFor(iso) {
  const d = new Date(iso + 'T12:00:00');
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const days = Math.round((d - today) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

/* The greeting is the only place this app talks like a person, so it is tied
   to the actual hour rather than being decorative. */
function greeting(now) {
  const h = now.getHours();
  if (h < 5) return 'Still up?';
  if (h < 11) return 'What now?';
  if (h < 16) return 'What now?';
  if (h < 21) return 'What tonight?';
  return 'What, tonight?';
}

/* ------------------------------------------------------------- pieces */

function pickCard(e) {
  const a = el('a', 'wn-pick');
  a.href = safeHref(e.u);
  a.target = '_blank';
  a.rel = 'noopener';
  const mins = Math.round((startOf(e) - Date.now()) / 60000);
  let when;
  if (e.a) when = 'Today · all day';
  else if (mins <= 0) when = 'On now';
  else if (mins < 60) when = 'Starts in ' + mins + ' min';
  else if (mins < 300) when = clock(e) + ' · in ' + Math.round(mins / 60) + 'h';
  else when = dayLabelFor(e.d) + ' · ' + clock(e);
  a.innerHTML =
    '<span class="wn-when">' + esc(when) + '</span>' +
    '<span class="wn-title">' + esc(e.t) + '</span>' +
    '<span class="wn-where">' + esc(e.v || '') + (e.w ? ', ' + esc(e.w) : '') +
      (e.f ? ' · <b class="wn-free">Free</b>' : (e.p ? ' · ' + esc(e.p) : '')) + '</span>';
  return a;
}

function row(e) {
  const a = el('a', 'wn-row');
  a.href = safeHref(e.u);
  a.target = '_blank';
  a.rel = 'noopener';
  a.innerHTML =
    '<span class="wn-row-time">' + esc(clock(e)) + '</span>' +
    '<span class="wn-row-body">' +
      '<span class="wn-row-t">' + esc(e.t) + '</span>' +
      '<span class="wn-row-v">' + esc(e.v || '') + (e.w ? ', ' + esc(e.w) : '') +
        (e.f ? ' · Free' : (e.p ? ' · ' + esc(e.p) : '')) + '</span>' +
    '</span>';
  return a;
}

function doors(root) {
  const box = el('div', 'wn-doors');
  const door = (href, title, sub) => {
    const a = el('a', 'wn-door');
    a.href = safeHref(href);
    if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
    a.innerHTML =
      '<span><span class="wn-door-t">' + esc(title) + '</span>' +
      '<span class="wn-door-s">' + esc(sub) + '</span></span>' + ICON.ext;
    return a;
  };
  box.appendChild(door(EVENTS_URL, 'The whole calendar',
    'Every event, filterable, further out than this'));
  box.appendChild(door(PLANNER_URL, 'Build a day',
    'Burlington Days turns a mood into an itinerary'));
  /* The arcade's outdoor half belongs here rather than under games: claiming a
     block or running a challenge is an answer to "what now", and it is the one
     that still works when the calendar is empty. */
  box.appendChild(door(ARCADE_URL, 'Play something',
    'The arcade — and five games you go outside for'));
  root.appendChild(box);
}

/* -------------------------------------------------------------- render */

export function render() {
  const root = state.root;
  root.innerHTML = '';
  const now = new Date();
  const nowMs = now.getTime();
  const all = events();

  tabStamp(root, stampOf(state.wn && state.wn.generated), 'the calendar, every morning');

  const soon = filtered(all.filter((e) => timed(e) && inWindow(e, nowMs - 45 * 60000, nowMs + 5 * 3600000)));
  const restToday = filtered(all.filter((e) => e.d === todayIso() &&
    (e.a || startOf(e).getTime() >= nowMs + 5 * 3600000)));
  const later = filtered(all.filter((e) => e.d > todayIso()));

  const free = all.filter((e) => e.f).length;
  const hero = el('div', 'wn-hero');
  hero.innerHTML =
    '<h2 class="wn-q">' + esc(greeting(now)) + '</h2>' +
    '<p class="wn-sub">' +
      (soon.length
        ? '<b>' + soon.length + '</b> thing' + (soon.length === 1 ? '' : 's') + ' in the next few hours.'
        : 'Nothing starting right now — here is what is next.') +
      ' <span class="count">' + all.length + ' over ten days · ' + free + ' free</span>' +
    '</p>';
  root.appendChild(hero);

  /* One answer, then the list. The pick prefers something free and something
     that has not started, because "on now, free, four minutes away" is a
     better answer than the alphabetically first thing today. */
  const candidates = soon.length ? soon : (restToday.length ? restToday : later);
  const pick = [...candidates].sort((x, y) => {
    const sx = startOf(x).getTime(), sy = startOf(y).getTime();
    const fx = sx >= nowMs ? 0 : 1, fy = sy >= nowMs ? 0 : 1;
    if (fx !== fy) return fx - fy;
    if (!!y.f !== !!x.f) return (y.f ? 1 : 0) - (x.f ? 1 : 0);
    return sx - sy;
  })[0];
  if (pick) root.appendChild(pickCard(pick));

  /* Two controls only: what kind of thing, and whether it costs money. Every
     other dimension is already on the card. */
  const cats = Object.keys((state.wn && state.wn.counts) || {})
    .sort((a, b) => state.wn.counts[b] - state.wn.counts[a]);
  const chips = el('div', 'chips');
  chips.appendChild(chip('Anything', !state.cat && !state.freeOnly, () => {
    state.cat = null; state.freeOnly = false; render();
  }));
  chips.appendChild(chip('Free', state.freeOnly, () => {
    state.freeOnly = !state.freeOnly; render();
  }));
  cats.slice(0, 10).forEach((c) => chips.appendChild(
    chip(esc(c.replace('-', ' ')) + ' <span class="n">' + state.wn.counts[c] + '</span>',
      state.cat === c, () => { state.cat = state.cat === c ? null : c; render(); })));
  root.appendChild(chips);
  scrollHint(chips);

  const list = el('div', 'wn-list');
  const seen = new Set(pick ? [pick.u] : []);
  const push = (e) => { if (!seen.has(e.u)) { seen.add(e.u); list.appendChild(row(e)); } };

  if (soon.length) {
    root.appendChild(el('p', 'wn-day', 'Next few hours'));
    root.appendChild(list);
    soon.forEach(push);
  } else {
    root.appendChild(list);
  }

  let day = null;
  restToday.concat(later).slice(0, 90).forEach((e) => {
    if (e.d !== day) {
      day = e.d;
      const h = el('p', 'wn-day', dayLabelFor(e.d));
      list.appendChild(h);
    }
    push(e);
  });

  if (!list.querySelector('.wn-row') && !pick) {
    root.appendChild(el('p', 'empty', 'Nothing matches that. Try Anything.'));
  }

  doors(root);
}

function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
         '-' + String(d.getDate()).padStart(2, '0');
}
