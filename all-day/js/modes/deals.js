/* deals.js — Eat's Deals tab (wave 1, 2026-10-29). Top tabs: Today ·
   Happy hour · Under $10.

   - Today: food.js's deck, moved here as it was: today's deals verified in
     the last 60 days with no open conflict between sources, happening now
     first, then later today by start time, then the untimed ones. Tap the
     right side (or the ›) for the next card, the left for the previous;
     the verified date on every card.
   - Happy hour: today's happy hours as a list by start time, the one on now
     marked, each with its window and its verified date.
   - Under $10: the deals whose own words put the price at $10 or less ("$5
     margaritas", "$10 for 2 tacos"), any day this week, today's first. A
     "$5 off" is a discount, not a price, so it stays out; so does a deal
     with no dollar figure. Read off the title, so it is only as good as the
     title, and the card says which days.

   The Dine card and first-visit perks on the map are not built: nothing is
   shown for them until they exist.

   Deep links: #deals/today|hh|cheap jumps to a section; #deals/d-<id> turns
   the deck to that deal (or flashes its row). The data, the engine and the
   place's sheet are eat-lib.js's, shared with Open now and Bites. */

import './eat-open.js';
import * as app from '../app.js';
import { el, esc, ICON, art, section, button } from '../ui.js';
import { sectionBar } from '../sections.js';
import * as E from './eat-lib.js';

const KEY = 'deals';
const DECK_MAX = 12;
const CHEAP_MAX = 10;
const STALE_MS = 5 * 60000;
const SECTIONS = [['today', 'Today'], ['hh', 'Happy hour'], ['cheap', 'Under $10']];
const DAY_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const S = { deal: 0, drawn: 0 };
let root = null, slots = null, pending = null, ready = false;
const F = () => E.F;

/* ------------------------------------------------------------------ Today */
function deck(t) {
  /* a Thursday 10 pm to 1 am deal is still on at 12:30 Friday morning */
  const out = (E.S.deals || []).filter((d) => F().dealAppliesToday(d, t) || F().dealLiveNow(d, t)).map((d) => {
    const s = F().toMin(d.start), e = F().toMin(d.end);
    const live = F().dealLiveNow(d, t);
    const over = !live && !d.all_day && s !== null && e !== null && e > s && t.minutes >= e;
    return over ? null : { d, live, s, e, r: E.S.byId[d.restaurant_id] || null };
  }).filter(Boolean);
  const rank = (x) => (x.live ? 0 : x.s !== null && x.s > t.minutes ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || (a.s == null ? 9999 : a.s) - (b.s == null ? 9999 : b.s) || a.d.business.localeCompare(b.d.business));
}

function eyebrowOf(x) {
  const span = x.d.start && x.d.end ? E.clock(x.d.start) + '–' + E.clock(x.d.end) : '';
  if (x.live) return 'Happening now · ' + (x.d.all_day ? 'all day' : 'until ' + E.clock(x.d.end));
  if (span) return 'Later today · ' + span;
  return 'Today';
}

function paintToday(host) {
  const t = E.now();
  const all = deck(t);
  const cards = all.slice(0, DECK_MAX);
  const every = E.outLink('See all deals', E.DEALS_PAGE, 'btn ghost sm alldeals', true);
  section(host, 'Deals today', all.length ? '<b>' + esc(E.plural(all.length, 'deal', 'deals')) + '</b> · now first' : null, every);
  if (!cards.length) {
    host.appendChild(el('p', 'note pad', esc(E.S.staleDeals ? 'No recently verified deals today.' : 'No deals on today.')));
    return;
  }
  if (S.deal > cards.length) S.deal = 0;
  const box = el('div', 'deck deals');
  box.setAttribute('role', 'region');
  box.setAttribute('aria-roledescription', 'deck');
  box.setAttribute('aria-label', 'Deals today');
  const n = cards.length + 1;
  const go = (i) => { S.deal = (i + n) % n; draw(); };
  const draw = () => {
    const i = S.deal;
    const segs = '<div class="segs">' + Array.from({ length: n }, (_, j) => '<i class="' + (j <= i ? 'on' : '') + '"></i>').join('') + '</div>';
    const hits = '<button class="hit l" aria-label="Previous deal"></button><button class="hit r" aria-label="Next deal"></button>' +
      '<button class="next" tabindex="-1" aria-hidden="true">' + ICON.right + '</button>';
    if (i === cards.length) {
      box.dataset.k = 'deals-end';
      box.innerHTML = E.tint('deals-end') + segs + '<div class="body"><h3>' + esc('That’s all.') + '</h3><div class="row"></div></div>' + hits;
      box.querySelector('.row').append(E.outLink('All the deals', E.DEALS_PAGE, 'btn ghost sm', true), button('Start over', 'ghost sm', () => go(0)));
    } else {
      const x = cards[i];
      box.dataset.k = 'd-' + x.d.id;
      const where = [x.d.business, x.r && x.r.neighborhood].filter(Boolean).join(' · ');
      const pic = x.r ? E.thumbOf(E.foodOf(x.r)) : '';
      box.innerHTML = (pic ? art(pic) : E.tint(x.d.id)) + segs + '<div class="body"><div class="eyebrow">' + esc(eyebrowOf(x)) + '</div><h3>' + esc(x.d.title) + '</h3>' +
        '<p>' + esc(where) + '</p><p class="verified">' + esc(E.verified(x.d.last_verified, t)) + '</p><div class="row"></div></div>' + hits;
      const row = box.querySelector('.row');
      if (x.r) row.appendChild(button('The place', 'ghost sm', () => E.placeSheet(x.r)));
      if (/^https?:/i.test(x.d.link || '')) row.appendChild(E.outLink('Details', x.d.link));
    }
    box.querySelector('.hit.l').addEventListener('click', () => go(S.deal - 1));
    box.querySelector('.hit.r').addEventListener('click', () => go(S.deal + 1));
    box.querySelector('.next').addEventListener('click', () => go(S.deal + 1));
  };
  draw();
  box.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { go(S.deal + 1); box.querySelector('.hit.r').focus(); }
    else if (e.key === 'ArrowLeft') { go(S.deal - 1); box.querySelector('.hit.l').focus(); }
  });
  host.appendChild(box);
}

/* a deal as a list row: what, where, when, verified; a tap opens the place */
function dealRow(d, t, sub, cls) {
  const r = E.S.byId[d.restaurant_id] || null;
  const row = el('div', 'lrow place' + (cls ? ' ' + cls : ''));
  row.dataset.k = 'd-' + d.id;
  const b = el('button', 'open', '<div class="t">' + esc(d.title) + '</div><div class="s">' + esc([d.business, r && r.neighborhood].filter(Boolean).join(' · ')) + '</div>' +
    '<div class="s">' + sub + '</div>');
  b.setAttribute('aria-label', d.title + ' at ' + d.business);
  if (r) b.addEventListener('click', () => E.placeSheet(r));
  else if (/^https?:/i.test(d.link || '')) b.addEventListener('click', () => window.open(d.link, '_blank', 'noopener'));
  const pic = r ? E.thumbOf(E.foodOf(r)) : '';
  row.append(pic ? el('span', 'th', art(pic)) : el('span', 'th', E.tint(d.id)), b);
  return row;
}

/* ------------------------------------------------------------- Happy hour */
function happyHours(t) {
  return deck(t).filter((x) => x.d.type === 'happy-hour');
}
function paintHH(host) {
  const t = E.now();
  const list = happyHours(t);
  section(host, 'Happy hour', list.length ? '<b>' + esc(E.plural(list.length, 'happy hour', 'happy hours')) + '</b> · today, by start time' : null);
  if (!list.length) { host.appendChild(el('p', 'note pad', esc('No happy hours left today.'))); return; }
  const box = el('div', 'places');
  list.forEach((x) => {
    const when = x.live ? '<span class="ok">' + esc('On now · until ' + E.clock(x.d.end)) + '</span>'
      : esc(x.d.start && x.d.end ? E.clock(x.d.start) + '–' + E.clock(x.d.end) : 'Today');
    box.appendChild(dealRow(x.d, t, when + ' · ' + esc(E.verified(x.d.last_verified, t)), 'hh'));
  });
  host.appendChild(box);
}

/* -------------------------------------------------------------- Under $10 */
/* the price a deal's own words give it, or null: the first dollar figure
   that is not a discount ("$5 off", "$2 more") */
export function priceOf(title) {
  const re = /\$\s?(\d+(?:\.\d{1,2})?)(?!\s*(?:off|more|extra|discount|savings?)\b)/gi;
  const m = re.exec(String(title || ''));
  if (!m) return null;
  const after = String(title).slice(m.index + m[0].length, m.index + m[0].length + 6);
  if (/^\d|^\s*off/i.test(after)) return null;
  return Number(m[1]);
}
function cheapDeals(t) {
  const today = t.day;
  const order = (d) => {
    const days = Array.isArray(d.days) && d.days.length ? d.days : DAY_ORDER;
    if (days.includes(today)) return 0;
    return Math.min(...days.map((x) => (DAY_ORDER.indexOf(x) - DAY_ORDER.indexOf(today) + 7) % 7));
  };
  return (E.S.deals || []).map((d) => ({ d, p: priceOf(d.title) }))
    .filter((x) => x.p !== null && x.p <= CHEAP_MAX)
    .sort((a, b) => order(a.d) - order(b.d) || a.p - b.p || a.d.business.localeCompare(b.d.business));
}
function paintCheap(host) {
  const t = E.now();
  const list = cheapDeals(t);
  section(host, 'Under $10', list.length ? '<b>' + esc(E.plural(list.length, 'deal', 'deals')) + '</b> · $10 or less, today’s first' : null);
  if (!list.length) { host.appendChild(el('p', 'note pad', esc('No deals at $10 or less this week.'))); return; }
  const box = el('div', 'places');
  list.forEach(({ d }) => {
    const when = E.deal12([F().dealDaysLabel(d), F().dealTimeLabel(d)].filter(Boolean).join(' · '));
    const on = F().dealAppliesToday(d, t);
    box.appendChild(dealRow(d, t, (on ? '<span class="ok">' + esc('Today') + '</span> · ' : '') + esc([when, E.verified(d.last_verified, t)].filter(Boolean).join(' · ')), 'cheap'));
  });
  host.appendChild(box);
  host.appendChild(el('p', 'note pad', esc('Read off each deal’s own words. Check with the place before you go.')));
}

/* ---------------------------------------------------------------- render */
function render() {
  root.innerHTML = '';
  slots = Object.create(null);
  SECTIONS.forEach(([k]) => {
    const s = el('div', 'slot');
    s.dataset.sec = k;
    slots[k] = s;
    root.appendChild(s);
  });
  SECTIONS.forEach(([k]) => paint(k));
  root.appendChild(el('div', 'spacer'));
  S.drawn = Date.now();
}
function paint(k) {
  if (!ready || !slots || !slots[k]) return;
  slots[k].innerHTML = '';
  ({ today: paintToday, hh: paintHH, cheap: paintCheap })[k](slots[k]);
}
const jump = (k) => { if (slots && slots[k]) app.jumpTo(slots[k]); };

function land() {
  if (!pending || !ready) return;
  const k = pending; pending = null;
  if (SECTIONS.some(([s]) => s === k)) { jump(k); return; }
  if (/^d-/.test(k)) {
    const i = deck(E.now()).slice(0, DECK_MAX).findIndex((x) => 'd-' + x.d.id === k);
    if (i >= 0) { S.deal = i; paint('today'); app.flashHit(slots.today, k); return; }
    if (app.flashHit(root, k)) return;
    app.toast('That deal isn’t on today.');
    return;
  }
  if (!app.flashHit(root, k)) app.toast('That one has moved on.');
}

/* the place pictures arrive later: the cards and rows take them */
E.onData((what) => { if (ready && (what === 'kitchens' || what === 'dishes')) SECTIONS.forEach(([k]) => paint(k)); });

app.register(KEY, {
  label: 'Deals',
  icon: ICON.tag,
  promise: 'Today’s deals, happy hours, and what’s $10 or less.',
  mount(r) {
    root = r;
    r.innerHTML = '<p class="loading">Finding today’s deals…</p>';
    E.core().then(() => {
      ready = true;
      render();
      if (app.activeTab() === KEY) app.paintSubnav();
      land();
    }).catch(() => { r.innerHTML = '<div class="errbox"><b>Deals didn’t load.</b></div>'; });
  },
  activate(param) {
    pending = param || null;
    /* the deck is about this minute: coming back later redraws it */
    if (ready && Date.now() - S.drawn > STALE_MS) { SECTIONS.forEach(([k]) => paint(k)); S.drawn = Date.now(); }
    land();
  },
  refresh() { if (ready) SECTIONS.forEach(([k]) => paint(k)); },
  deactivate() {},
  subnav() {
    if (!ready) return null;
    const t = E.now();
    const n = { today: deck(t).length, hh: happyHours(t).length, cheap: cheapDeals(t).length };
    return sectionBar({ key: 'sec-eat-deals', title: 'Deals', color: '--app-eat-pop', find: (k) => slots && slots[k], onPick: jump,
      items: SECTIONS.map(([key, label]) => ({ key, label, n: n[key] })) });
  },
  keepSubnav: true,
  /* deals verified since the last visit: the one thing here that changes */
  newSince(ts) {
    if (!E.S.deals) return 0;
    const day = E.btvDay(Number(ts || 0) * 1000);
    return E.S.deals.filter((d) => d.last_verified > day).length;
  },
});
