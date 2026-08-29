/* sports.js — what's on, who won, and whether it's worth leaving the house.

   LOCAL AND NATIONAL are the switch, because they are two different reasons to
   open a sports tab: "is there anything to go to" and "did the Sox win". Local
   is UVM, Burlington High and the local pro clubs; National is the five New
   England teams a Vermonter actually follows — Montreal included, because
   Burlington is closer to the Bell Centre than to Fenway.

   MOST DAYS THERE IS NO GAME. That is the real design problem here, not the
   game rows: across the local feeds, more than half of in-season days are
   empty, and two thirds of what does happen lands on Friday or Saturday. So
   the tab never says "no games" and stops — it always answers with the next
   thing, and says how far away it is.

   THE SCORE IS TYPE, NOT DATA, ON THE HERO. A finished game leads with its
   score set in the serif display face; the same score in the list below is
   small and tabular. That split is lifted from how BBC Sport handles it — a
   scoreline on a match page is drawn from their infographic type scale, while
   the fixtures list keeps it as data. It is what stops a tab of numbers
   reading like a spreadsheet.

   A FINISHED GAME DIMS, IT DOES NOT BOLD. The winner is not emphasised; the
   loser's row recedes. Colour does that work rather than opacity, because
   opacity took the text under 4.5:1.

   NO HIGH SCHOOL SCORES EXIST. The district's calendars carry fixtures only.
   The tab says so once rather than showing empty score slots forever. */

import * as store from './../store.js';
import * as data from './../wire.js';
import * as app from './../app.js';
import { el, esc, safeHref, chip, seg, heading, shelfHead, scrollHint,
         tabStamp, stampOf, ICON } from './../ui.js';

const state = { root: null, sports: null, scope: 'local', org: null };

export function mount(root) {
  state.root = root;
  root.innerHTML = '<p class="loading">Checking the scores…</p>';
  data.load('sports', (json) => { state.sports = json; render(); }, () => {
    root.innerHTML = '';
    root.appendChild(el('div', 'errbox',
      '<b>Couldn’t reach the scores.</b><br>They are rebuilt through the day.'));
  });
}

export function activate() {}
export function refresh() { if (state.sports) render(); }
export function deactivate() { app.closePeek(); }

const all = () => (state.sports && Array.isArray(state.sports.games)) ? state.sports.games : [];
const isLocal = (g) => g.level !== 'national';
const scoped = () => all().filter((g) => (state.scope === 'local') === isLocal(g));

/* ------------------------------------------------------------------ parts */

function when(g) {
  if (g.allDay) return 'All day';
  return new Date(g.start).toLocaleTimeString('en-US',
    { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
}

function dayLabel(iso) {
  const d = new Date(iso + 'T12:00:00');
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const n = Math.round((d - today) / 86400000);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return d.toLocaleDateString('en-US',
    { weekday: 'long', month: 'short', day: 'numeric' });
}

/* "in 3 days", "2 weeks away" — the honest answer to an empty week. */
function awayText(iso) {
  const d = new Date(iso + 'T12:00:00');
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const n = Math.round((d - today) / 86400000);
  if (n <= 0) return '';
  if (n === 1) return 'tomorrow';
  if (n < 7) return 'in ' + n + ' days';
  if (n < 14) return 'next week';
  return 'in ' + Math.round(n / 7) + ' weeks';
}

const finished = (g) => !!g.result || g.state === 'post';

/* The hero: the game on now, else the next one, else the last result. */
function lede(list) {
  const now = Date.now();
  const live = list.find((g) => g.live);
  if (live) return live;
  const next = list.find((g) => new Date(g.start).getTime() >= now - 2 * 3600000 && !finished(g));
  if (next) return next;
  const past = list.filter(finished);
  return past.length ? past[past.length - 1] : (list[0] || null);
}

function ledeCard(g) {
  const card = el('div', 'sp-lede' + (g.live ? ' is-live' : ''));
  const bits = [];
  if (g.live) bits.push('<b class="sp-livechip"><i></i>' + esc(g.live) + '</b>');
  else if (finished(g)) bits.push('Final');
  else bits.push(esc(dayLabel(g.date)) + ' · ' + esc(when(g)));
  if (g.venue) bits.push(esc(g.venue));
  card.innerHTML = '<p class="sp-lede-top">' + bits.join(' · ') + '</p>';

  if (finished(g) && g.score) {
    /* the display-type moment — the only place a score is set big */
    const parts = g.score.split('-');
    card.appendChild(el('p', 'sp-score' + (g.result === 'L' ? ' lost' : ''),
      esc(parts[0]) + '<span class="sp-dash">–</span>' + esc(parts[1])));
  }
  card.appendChild(el('h2', 'sp-lede-t', esc(g.title)));

  const sub = [];
  if (g.org) sub.push(esc(g.org));
  if (g.sport) sub.push(esc(g.sport));
  if (!finished(g) && !g.live) {
    const a = awayText(g.date);
    if (a) sub.push(a);
  }
  if (g.tv) sub.push('on ' + esc(g.tv));
  card.appendChild(el('p', 'sp-lede-s', sub.join(' · ')));

  const row = el('div', 'btns');
  if (g.tickets) {
    const t = el('a', 'btn', 'Tickets');
    t.href = safeHref(g.tickets); t.target = '_blank'; t.rel = 'noopener';
    row.appendChild(t);
  }
  if (g.watch || g.url) {
    const w = el('a', 'btn btn-quiet', g.watch ? 'Watch' : 'Details');
    w.href = safeHref(g.watch || g.url); w.target = '_blank'; w.rel = 'noopener';
    row.appendChild(w);
  }
  if (row.childElementCount) card.appendChild(row);
  return card;
}

function gameRow(g) {
  const done = finished(g);
  const a = el(g.url ? 'a' : 'div', 'sp-row' + (done ? ' is-done' : '') +
    (g.status ? ' is-off' : ''));
  if (g.url) { a.href = safeHref(g.url); a.target = '_blank'; a.rel = 'noopener'; }
  /* the whole row announces as one sentence rather than six fragments */
  a.setAttribute('role', 'text');

  /* ONE slot carries the state — time, or score, or the status word. Keeping
     it in a fixed position is what lets the eye run down the column. */
  let slot;
  if (g.status) slot = '<span class="sp-off">' + esc(g.status) + '</span>';
  else if (g.live) slot = '<span class="sp-livedot"><i></i>LIVE</span>';
  else if (done && g.score) slot = '<span class="sp-res sp-' + esc(g.result || '') + '">' +
    esc(g.result || '') + ' ' + esc(g.score) + '</span>';
  else if (done) slot = '<span class="sp-res">Final</span>';
  else slot = esc(when(g));

  a.innerHTML =
    '<span class="sp-when">' + slot + '</span>' +
    '<span class="sp-body">' +
      '<span class="sp-t">' + esc(g.title) + '</span>' +
      '<span class="sp-m">' + esc(g.org || '') +
        (g.sport && g.sport !== g.org ? ' · ' + esc(g.sport) : '') +
        (g.venue && !done ? ' · ' + esc(g.venue) : '') +
        (g.tv ? ' · ' + esc(g.tv) : '') + '</span>' +
    '</span>';
  return a;
}

/* ----------------------------------------------------------------- render */

export function render() {
  const root = state.root;
  root.innerHTML = '';
  tabStamp(root, stampOf(state.sports && state.sports.generated), 'schedules, through the day');

  root.appendChild(seg([['local', 'Local'], ['national', 'National']],
    state.scope, (v) => { state.scope = v; state.org = null; render(); }));
  root.appendChild(el('div', null, '<div style="height:14px"></div>'));

  const list = scoped();
  const orgs = [];
  list.forEach((g) => { if (g.org && !orgs.includes(g.org)) orgs.push(g.org); });

  const now = Date.now();
  const upcoming = list.filter((g) => !finished(g) && new Date(g.start).getTime() >= now - 2 * 3600000);

  heading(root, {
    eyebrow: state.scope === 'local' ? 'Around Burlington' : 'New England',
    title: state.scope === 'local' ? 'Local sports' : 'The teams you follow',
    sub: '<span class="count">' + upcoming.length + ' coming up · ' +
         orgs.length + (orgs.length === 1 ? ' team' : ' teams') + '</span>',
  });

  const shown = state.org ? list.filter((g) => g.org === state.org) : list;
  const head = lede(shown);
  if (head) root.appendChild(ledeCard(head));

  if (orgs.length > 1) {
    const chips = el('div', 'chips');
    chips.appendChild(chip('Everyone', !state.org, () => { state.org = null; render(); }));
    orgs.forEach((o) => chips.appendChild(
      chip(esc(o), state.org === o, () => { state.org = state.org === o ? null : o; render(); })));
    root.appendChild(chips);
    scrollHint(chips);
  }

  /* Upcoming first, then what already happened — a sports tab is asked "what's
     next" more often than "what happened", and the results are two taps of
     scrolling away rather than a separate screen. */
  const future = shown.filter((g) => !finished(g) && new Date(g.start).getTime() >= now - 2 * 3600000);
  const past = shown.filter((g) => finished(g)).reverse();

  if (future.length) {
    const holder = el('div', 'sp-list');
    let day = null;
    future.slice(0, 60).forEach((g) => {
      if (g.date !== day) {
        day = g.date;
        holder.appendChild(el('p', 'sp-day', esc(dayLabel(g.date))));
      }
      holder.appendChild(gameRow(g));
    });
    root.appendChild(holder);
  } else {
    /* Never a bare "no games" — say when the next one is, or why there is none. */
    root.appendChild(el('p', 'empty',
      state.org ? esc(state.org) + ' has nothing scheduled in the next few months.'
                : 'Nothing scheduled right now — the seasons are between.'));
  }

  if (past.length) {
    shelfHead(root, 'Already played', past.length + ' result' + (past.length === 1 ? '' : 's'));
    const holder = el('div', 'sp-list');
    past.slice(0, 30).forEach((g) => holder.appendChild(gameRow(g)));
    root.appendChild(holder);
  }

  /* Teams that exist but have nothing scheduled. Saying "season's over" is a
     better answer than silently dropping a club the reader follows. */
  const dormant = (state.scope === 'local' && state.sports && state.sports.dormant) || [];
  if (dormant.length && !state.org) {
    shelfHead(root, 'Not in season', dormant.length + ' more local ' +
      (dormant.length === 1 ? 'club' : 'clubs'));
    const box = el('div', 'sp-dormant');
    dormant.forEach((t) => {
      const a = el(t.url ? 'a' : 'div', 'sp-dorm');
      if (t.url) { a.href = safeHref(t.url); a.target = '_blank'; a.rel = 'noopener'; }
      a.innerHTML =
        '<span class="sp-dorm-t">' + esc(t.name) +
          (t.sport ? ' <span class="sp-dorm-sport">' + esc(t.sport) + '</span>' : '') + '</span>' +
        (t.note ? '<span class="sp-dorm-n">' + esc(t.note) + '</span>' : '');
      box.appendChild(a);
    });
    root.appendChild(box);
  }

  const notes = (state.sports && state.sports.notes) || [];
  if (notes.length) {
    root.appendChild(el('p', 'sp-note', notes.map(esc).join(' ')));
  }
}
