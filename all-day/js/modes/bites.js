/* bites.js — Eat's Bites tab (wave 1, 2026-10-29). Top tabs: Weekly Bite ·
   In their own words · Photos · Menus · Asked on Reddit, freshest first
   (the shell's `fresh` rule; food.js did the same by hand).

   Moved from food.js as they were:
   - The Weekly Bite: the newest approved reader "dish" photo, featured,
     never rated; with none yet, the slot invites the first.
   - In their own words: the kitchens' own reels (a tap plays one in the
     shell's video box), else their latest photos.
   - Asked on Reddit: the r/burlington threads asking where to eat or drink,
     newest first, then Best of r/burlington's most-asked questions; the
     answers stay in the threads.
   - Feature a dish: the form, under Photos (one photo, one line, where it
     is from, the consent box; nothing shows until Stephen approves it).
   New here:
   - Photos: every approved reader dish, newest first, as a grid; a dish
     from a place we know opens that place's food.
   - Menus: the Small Bites menus (data/small-bites.json) as a link shelf,
     A to Z, with a search box; each link opens the place's own menu.

   Deep links: #bites/bite|kitchens|photos|menus|asks|best|add jumps;
   q-<id> opens a Best of question; a thread's URL flashes its ask;
   ig-<code> a kitchen's post; dish-<id> a reader dish; mn-<id> a menu. */

import './eat-open.js';
import * as app from '../app.js';
import * as store from '../store.js';
import { el, esc, safeHref, ICON, art, section, listRail, collapseBar, pills, button, agoShort, cards as feedCards, put } from '../ui.js';
import { GROUPS } from '../food-asks.js';
import { sectionBar } from '../sections.js';
import * as E from './eat-lib.js';

const KEY = 'bites';
const RAIL_MAX = 12;
const DISH_FIRST = 9;
const MENU_FIRST = 12;
const Q_FIRST = 12;
const ASKS_STALE = 15 * 60000;
const SUB_URL = 'https://www.reddit.com/r/burlington/';
const SECTIONS = [['bite', 'Weekly Bite'], ['kitchens', 'In their own words'], ['photos', 'Photos'], ['menus', 'Menus'], ['asks', 'Asked on Reddit']];
const AREA_OF = { 'Essex': 'Essex / Essex Jct', 'Burlington': 'Greater Burlington' };
const cap = (x) => (x ? String(x).charAt(0).toUpperCase() + String(x).slice(1) : '');
const NEGATIVE = /\b(worst|terrible|awful|gross|disgusting|overpriced|bland|rude|avoid|never again|inedible|mid)\b/i;

const S = { dishAll: false, menuQ: '', menuAll: false, bestGroup: 'all', bestAll: false };
let root = null, slots = null, pending = null, ready = false;

/* ------------------------------------------------------- the Weekly Bite */
function paintBite(host) {
  if (E.S.dish === undefined) { host.appendChild(el('p', 'loading', 'Finding this week’s bite…')); return; }
  const p = E.S.dish;
  if (!p) {
    const tc = el('div', 'textcard gap', '<h3 class="serif">The Weekly Bite starts with you</h3>');
    tc.dataset.k = 'bite';
    const row = el('div', 'row');
    row.appendChild(button('Feature a dish ' + ICON.arrow, '', () => jump('add')));
    tc.appendChild(row);
    host.appendChild(tc);
    return;
  }
  const place = E.placeByName(p.spot);
  const hero = el('div', 'hero');
  hero.dataset.k = 'bite';
  const home = p.spot === E.HOME;
  const where = [p.spot, p.area && p.area !== 'Elsewhere' && !home ? p.area : ''].filter(Boolean).join(' · ');
  hero.innerHTML = '<span class="c-media r45" data-zoom>' + art(p.url) + '</span>' +
    '<span class="eyebrow">' + esc('The Weekly Bite') + '</span>' +
    '<h3>' + esc(E.trim(p.caption, E.LINE_MAX) || p.spot || 'This week’s dish') + '</h3>' +
    '<p>' + esc([where, p.credit ? 'sent in by ' + p.credit : '', p.label || ''].filter(Boolean).join(' · ')) + '</p>';
  const row = el('div', 'row');
  if (place) row.appendChild(button('The place', 'ghost', () => E.placeSheet(place)));
  row.appendChild(button('Feature yours', 'ghost', () => jump('add')));
  hero.appendChild(row);
  hero.querySelector('[data-zoom]').addEventListener('click', () => app.lightbox({ media: p.url, title: p.caption, text: p.caption }));
  host.appendChild(hero);
}

/* ------------------------------------------------------- In their own words */
function paintKitchens(host) {
  if (!E.S.posts || !E.S.foodSet || !E.S.dir) {
    section(host, 'In their own words');
    host.appendChild(E.S.igFailed ? el('p', 'note pad', esc('Didn’t load. Try again later.')) : el('p', 'loading', 'Loading the kitchens…'));
    return;
  }
  const nowS = Date.now() / 1000;
  const food = E.kitchenFood();
  const clipsList = food.filter((p) => E.hasClip(p, nowS)).slice(0, RAIL_MAX);
  section(host, 'In their own words');
  if (!food.length) { host.appendChild(el('p', 'note pad', 'Nothing new this week.')); return; }
  /* three reels or more make a row of reels; fewer, and every post shows as a
     picture (a reel among them still plays) */
  if (clipsList.length >= 3) {
    const r = listRail(host, { name: 'eat-clips', label: 'In their own words', cells: 140 });
    clipsList.forEach((p) => r.appendChild(clipCard(p)));
    return;
  }
  const r = listRail(host, { name: 'eat-kphotos', label: 'In their own words', cells: 140 });
  food.slice(0, RAIL_MAX).forEach((p) => r.appendChild(photoCard(p, nowS)));
}

function clipCard(p) {
  const c = el('a', 'vcard vert clip');
  c.href = safeHref(p.u);
  c.dataset.k = E.keyOf(p);
  c.innerHTML = '<span class="c-media">' + art(p.i) + '<span class="play">' + ICON.play + '</span>' + (p.vd ? '<span class="dur">' + esc(E.mmss(p.vd)) + '</span>' : '') + '</span>' +
    '<span class="t">' + esc(E.who(p)) + '</span><span class="s">' + esc([E.trim(p.c, 60), E.when(p)].filter(Boolean).join(' · ')) + '</span>';
  c.setAttribute('aria-label', 'Play the video from ' + E.who(p));
  c.addEventListener('click', (e) => { e.preventDefault(); E.openClip(p); });
  return c;
}

function photoCard(p, nowS) {
  const clip = E.hasClip(p, nowS || Date.now() / 1000);
  const c = el('a', 'vcard w150');
  c.href = safeHref(p.u);
  c.target = '_blank';
  c.rel = 'noopener';
  c.dataset.k = E.keyOf(p);
  c.innerHTML = '<span class="c-media r11">' + art(p.i) + (clip ? '<span class="play">' + ICON.play + '</span>' : '') + '</span><span class="t">' + esc(E.who(p)) + '</span><span class="s">' + esc([E.trim(p.c, 50), E.when(p)].filter(Boolean).join(' · ')) + '</span>';
  if (clip) c.addEventListener('click', (e) => { e.preventDefault(); E.openClip(p); });
  else if (app.demo) c.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the post on Instagram in the real build'); });
  return c;
}

/* ------------------------------------------------------------------ Photos */
/* every approved reader dish, newest first, then the form to send one */
function paintPhotos(host) {
  const list = E.S.dishes || [];
  section(host, 'Photos');
  if (E.S.dish === undefined) host.appendChild(el('p', 'loading', 'Loading the photos…'));
  else if (!list.length) host.appendChild(el('p', 'note pad', esc('No reader photos yet.')));
  else {
    const grid = el('div', 'fgrid');
    const shown = S.dishAll ? list : list.slice(0, DISH_FIRST);
    shown.forEach((d) => {
      const t = E.dishTile(d);
      const r = E.placeByName(d.spot);
      if (r) { t.addEventListener('click', (e) => { e.stopImmediatePropagation(); E.foodSheet(r); }, true); t.setAttribute('aria-label', (E.trim(d.caption, 60) || 'A dish') + ', at ' + r.name); }
      grid.appendChild(t);
    });
    host.appendChild(grid);
    if (list.length > shown.length) host.appendChild(button('All ' + list.length + ' ' + ICON.arrow, 'ghost more', () => { S.dishAll = true; paint('photos'); }));
  }
  const add = el('div', 'slot');
  add.dataset.sec = 'add';
  host.appendChild(add);
  paintAdd(add);
}

function paintAdd(host) {
  section(host, 'Feature a dish');
  const tc = el('div', 'textcard');
  tc.dataset.k = 'add-form';
  const form = el('form', 'dish');
  form.noValidate = true;
  const names = (E.S.places || []).map((r) => '<option value="' + esc(r.name) + '"></option>').join('');
  form.innerHTML =
    '<div class="row where"></div>' +
    '<div class="row"><button type="button" class="btn ghost pick">' + ICON.plus + ' ' + esc('Choose a photo') + '</button><span class="note fname">' + esc('No photo yet') + '</span>' +
      '<input type="file" name="file" accept="image/*" hidden></div>' +
    '<div class="row"><input class="field" name="line" maxlength="' + E.LINE_MAX + '" placeholder="' + esc('One line: what it is, and why') + '" aria-label="One line about the dish" autocomplete="off"></div>' +
    '<div class="row placerow"><input class="field" name="place" list="eat-places" maxlength="120" placeholder="' + esc('The place') + '" aria-label="The place" autocomplete="off">' +
      '<datalist id="eat-places">' + names + '</datalist></div>' +
    '<div class="row"><input class="field" name="credit" maxlength="60" placeholder="' + esc('Your first name, for the credit (optional)') + '" aria-label="Your name for the credit" autocomplete="given-name"></div>' +
    '<div class="row"><label class="consent"><input type="checkbox" name="consent"> ' + esc('I took this photo, and the Brief may feature it on the site and in the newsletter.') + '</label></div>' +
    '<div class="row"><button type="submit" class="btn send">' + esc('Send it in') + '</button></div>' +
    '<p class="note err" role="alert" hidden></p>';
  form.dataset.where = 'place';
  const placeRow = form.querySelector('.placerow');
  const where = pills([['place', 'At a place'], ['home', 'Made at home']], 'place', (v) => {
    form.dataset.where = v;
    placeRow.hidden = v === 'home';
  });
  where.setAttribute('role', 'group');
  where.setAttribute('aria-label', 'Where the dish is from');
  form.querySelector('.where').appendChild(where);
  const file = form.querySelector('input[type=file]');
  form.querySelector('.pick').addEventListener('click', () => file.click());
  file.addEventListener('change', () => { form.querySelector('.fname').textContent = file.files[0] ? file.files[0].name : 'No photo yet'; });
  form.addEventListener('submit', (e) => { e.preventDefault(); submitDish(form); });
  tc.appendChild(form);
  host.appendChild(tc);
}

function submitDish(form) {
  const err = form.querySelector('.err');
  const say = (msg) => { err.textContent = msg; err.hidden = !msg; };
  const fd = new FormData(form);
  const file = form.querySelector('input[type=file]').files[0];
  const line = String(fd.get('line') || '').replace(/\s+/g, ' ').trim();
  const home = form.dataset.where === 'home';
  const place = home ? E.HOME : String(fd.get('place') || '').replace(/\s+/g, ' ').trim();
  const credit = String(fd.get('credit') || '').replace(/\s+/g, ' ').trim();
  if (!file || !file.size) return say('Choose a photo first.');
  if (!/^image\//.test(file.type || 'image/')) return say('That file isn’t a photo.');
  if (!line) return say('Add one line about it.');
  if (NEGATIVE.test(line)) return say('We only feature what you’d recommend.');
  if (!place) return say('Which place is it from?');
  if (!fd.get('consent')) return say('Tick the box first.');
  say('');
  const send = form.querySelector('.send');
  if (app.demo) {
    form.reset();
    form.querySelector('.fname').textContent = 'No photo yet';
    app.toast('Demo: nothing was sent.');
    return;
  }
  send.disabled = true;
  send.textContent = 'Sending…';
  const r = E.placeByName(place);
  E.script(E.PHOTOS_LIB).then(async () => {
    const P = window.BTBP;
    const hood = r && r.neighborhood ? (AREA_OF[r.neighborhood] || r.neighborhood) : '';
    const area = P.AREAS.includes(hood) ? hood : 'Greater Burlington';
    const blob = await P.resizeImage(file);
    const path = await P.uploadBlob(blob);
    await P.rpc('btb_photos_submit', {
      p_path: path, p_caption: line.slice(0, E.LINE_MAX), p_category: 'dish', p_area: area, p_spot: place.slice(0, 120),
      p_taken: '', p_name: credit.slice(0, 60), p_permission: true, p_ai: false, p_voter: store.playerId(),
    });
  }).then(() => {
    form.reset();
    form.querySelector('.fname').textContent = 'No photo yet';
    send.disabled = false;
    send.textContent = 'Send it in';
    say('');
    app.toast('Sent. It shows once reviewed.');
  }).catch((e) => {
    send.disabled = false;
    send.textContent = 'Send it in';
    const m = String((e && e.message) || '');
    say(/category|check constraint/i.test(m) ? 'The dish queue isn’t open yet. Try again soon.'
      : /waiting for review|queue is full/i.test(m) ? m.charAt(0).toUpperCase() + m.slice(1) + '.'
        : 'That didn’t send. Try again in a minute.');
  });
}

/* ------------------------------------------------------------------- Menus */
/* the Small Bites menus as a shelf of links, A to Z; each opens the place's
   own menu. Where we know the place, its name opens its sheet too. */
function paintMenus(host) {
  if (!E.S.menuList) {
    section(host, 'Menus');
    host.appendChild(E.S.menusFailed ? el('p', 'note pad', esc('Didn’t load. Try again later.')) : el('p', 'loading', 'Loading the menus…'));
    return;
  }
  const all = E.S.menuList.slice().sort((a, b) => a.name.localeCompare(b.name));
  section(host, 'Menus');
  const tools = el('div', 'toolrow foodtools');
  const q = el('input', 'field menu-q');
  q.type = 'search';
  q.placeholder = 'Find a menu';
  q.setAttribute('aria-label', 'Find a menu');
  q.value = S.menuQ;
  tools.appendChild(q);
  host.appendChild(tools);
  const box = el('div', 'menu-list');
  host.appendChild(box);
  const draw = () => {
    box.innerHTML = '';
    const want = S.menuQ.trim().toLowerCase();
    const list = all.filter((m) => !want || m.name.toLowerCase().includes(want));
    const shown = S.menuAll || want ? list : list.slice(0, MENU_FIRST);
    const grid = el('div', 'qgrid menus');
    shown.forEach((m) => {
      const a = E.outLink(m.name, m.url, 'qcard');
      a.innerHTML = '<span class="t">' + esc(m.name) + '</span><span class="s">' + esc(E.trim([cap((m.cuisine || [])[0]), m.walk ? m.walk + ' min walk' : ''].filter(Boolean).join(' · ') || 'Menu', 40)) + ' ' + ICON.ext + '</span>';
      a.dataset.k = 'mn-' + m.id;
      a.setAttribute('aria-label', 'Menu for ' + m.name);
      grid.appendChild(a);
    });
    box.appendChild(grid);
    if (!list.length) box.appendChild(el('p', 'note pad', esc('No menu by that name.')));
    else if (list.length > shown.length) box.appendChild(button('All ' + list.length + ' ' + ICON.arrow, 'ghost more', () => { S.menuAll = true; draw(); }));
    else if (S.menuAll && !want && list.length > MENU_FIRST) box.appendChild(collapseBar('the menus', () => { S.menuAll = false; draw(); jump('menus'); }));
  };
  q.addEventListener('input', () => { S.menuQ = q.value; S.menuAll = false; draw(); });
  draw();
}

/* --------------------------------------------------------- Asked on Reddit */
const askItem = (a) => ({ k: a.k, kind: 'headline', href: a.url, title: a.title, src: a.sub, sid: a.sid, local: true,
  ago: agoShort(a.d), d: a.d, comments: a.comments == null ? '' : a.comments, open: 'Open the thread' });

function paintAsks(host) {
  const sub = E.outLink('r/burlington', SUB_URL, 'btn ghost sm');
  if (!E.S.asks) {
    section(host, 'Asked on Reddit', null, sub);
    host.appendChild(E.S.asksFailed ? el('p', 'note pad', esc('Didn’t load. Try again later.')) : el('p', 'loading', 'Loading the threads…'));
  } else {
    const list = E.asksShown();
    section(host, 'Asked on Reddit', null, sub);
    if (!list.length) host.appendChild(el('p', 'note pad', esc(E.S.asks.length ? 'You muted these subreddits.' : 'No new food questions.')));
    else {
      const items = app.know(list.map(askItem));
      const feed = el('div', 'feed asks');
      items.forEach((it) => put(feed, feedCards.row(it, { noComments: it.comments === '', greenLocal: true })));
      app.bindFeed(feed);
      host.appendChild(feed);
    }
  }
  const best = el('div', 'slot');
  best.dataset.sec = 'best';
  host.appendChild(best);
  paintBest(best);
}

function paintBest(host) {
  if (!E.S.best) {
    section(host, 'Best of r/burlington');
    host.appendChild(E.S.bestFailed ? el('p', 'note pad', esc('Didn’t load. Try again later.')) : el('p', 'loading', 'Loading the questions…'));
    return;
  }
  if (S.bestGroup !== 'all' && !E.S.best.some((q) => q.group === S.bestGroup)) S.bestGroup = 'all';
  const list = E.S.best.filter((q) => S.bestGroup === 'all' || q.group === S.bestGroup);
  section(host, 'Best of r/burlington');
  const kinds = [['all', 'All']].concat(GROUPS.filter(([g]) => E.S.best.some((q) => q.group === g)).map(([g, label]) => [g, label]));
  const tools = el('div', 'toolrow foodtools');
  const p = pills(kinds, S.bestGroup, (v) => { S.bestGroup = v; S.bestAll = false; repaintBest(); }, 'kinds');
  p.setAttribute('role', 'group');
  p.setAttribute('aria-label', 'Food, coffee or drinks');
  tools.appendChild(p);
  host.appendChild(tools);
  const grid = el('div', 'qgrid');
  const shown = S.bestAll ? list : list.slice(0, Q_FIRST);
  shown.forEach((q) => grid.appendChild(qCard(q)));
  host.appendChild(grid);
  if (list.length > shown.length) host.appendChild(button('All ' + list.length + ' ' + ICON.arrow, 'ghost more', () => { S.bestAll = true; repaintBest(); }));
  else if (S.bestAll && list.length > Q_FIRST) host.appendChild(collapseBar('the questions', () => { S.bestAll = false; repaintBest(); jump('best'); }));
}
function repaintBest() {
  const host = slots && slots.asks && slots.asks.querySelector('[data-sec="best"]');
  if (!host) return;
  host.innerHTML = '';
  paintBest(host);
}

function qCard(q) {
  const a = el('a', 'qcard', '<span class="t">' + esc(q.q) + '</span><span class="s">' +
    esc([q.sd ? 'Seven Daysies: ' + q.sd.pick : '', E.plural(q.threads.length, 'thread', 'threads')].filter(Boolean).join(' · ')) + '</span>');
  a.href = safeHref(q.threads[0].url);
  a.target = '_blank';
  a.rel = 'noopener';
  a.dataset.k = q.k;
  a.setAttribute('aria-label', q.q + ', ' + E.plural(q.threads.length, 'thread', 'threads') + ' on r/burlington');
  a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    e.preventDefault();
    qSheet(q);
  });
  return a;
}
function sheetLink(title, sub, href) {
  const a = el('a', 't', esc(title) + ' ' + ICON.ext + '<div class="d">' + esc(sub) + '</div>');
  a.href = safeHref(href);
  a.target = '_blank';
  a.rel = 'noopener';
  if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the page in the real build'); });
  const row = el('div', 'sheet-row');
  row.appendChild(a);
  return row;
}
function qSheet(q) {
  app.sheet(q.q, (body) => {
    body.appendChild(el('div', 'sheet-h', esc(q.threads.length === 1 ? 'Asked on r/burlington' : 'Asked on r/burlington ' + q.threads.length + ' times')));
    q.threads.forEach((t) => body.appendChild(sheetLink(t.label, ['r/burlington', t.year].filter(Boolean).join(' · '), t.url)));
    if (q.sd) {
      body.appendChild(el('div', 'sheet-h', esc('Seven Daysies ' + q.sd.year)));
      body.appendChild(sheetLink(q.sd.pick, 'Seven Days readers’ pick', q.sd.url));
    }
    const links = el('div', 'linkrow');
    links.appendChild(button(ICON.share + ' Share', 'ghost sm', () => app.share(KEY, q.k, q.q)));
    body.appendChild(links);
  });
}

/* ---------------------------------------------------------------- render */
function render() {
  root.innerHTML = '';
  slots = Object.create(null);
  const feed = el('div', 'bites');
  SECTIONS.forEach(([k]) => {
    const s = el('div', 'slot');
    s.dataset.sec = k;
    slots[k] = s;
    feed.appendChild(s);
  });
  root.appendChild(feed);
  SECTIONS.forEach(([k]) => paint(k));
  root.appendChild(el('div', 'spacer'));
}
function paint(k) {
  if (!ready || !slots || !slots[k]) return;
  /* the form is drawn once: a redraw would eat what was typed */
  if (k === 'photos' && slots.photos.querySelector('form.dish')) {
    const keep = slots.photos.querySelector('[data-sec="add"]');
    keep.remove();
    slots.photos.innerHTML = '';
    const tmp = el('div');
    paintPhotosHead(tmp);
    slots.photos.append(...tmp.childNodes, keep);
    return;
  }
  slots[k].innerHTML = '';
  ({ bite: paintBite, kitchens: paintKitchens, photos: paintPhotos, menus: paintMenus, asks: paintAsks })[k](slots[k]);
}
/* Photos without its form, for a redraw that keeps the form */
function paintPhotosHead(host) {
  paintPhotos(host);
  const add = host.querySelector('[data-sec="add"]');
  if (add) add.remove();
}
const jump = (k) => {
  if (!slots) return;
  const n = slots[k] || (slots.photos && k === 'add' ? slots.photos.querySelector('[data-sec="add"]') : null) || (slots.asks && k === 'best' ? slots.asks.querySelector('[data-sec="best"]') : null);
  if (n) app.jumpTo(n);
};

/* how fresh each section is, for the pill's freshest-first order and dots */
function newestOf(k) {
  if (k === 'bite') { const d = E.S.dish; return d ? Date.parse(d.approved_on || '') / 1000 || null : null; }
  if (k === 'photos') return newestOf('bite');
  if (k === 'kitchens') { const f = E.kitchenFood()[0]; return f ? Number(f.ts) || null : null; }
  if (k === 'asks') { const a = E.asksShown()[0]; return a ? a.d : null; }
  return null;
}

function land() {
  if (!pending || !ready) return;
  const k = pending; pending = null;
  if (SECTIONS.some(([s]) => s === k) || k === 'add' || k === 'best') { jump(k); return; }
  if (/^q-/.test(k)) {
    if (!E.S.best && !E.S.bestFailed) { pending = k; return; }
    const q = (E.S.best || []).find((x) => x.k === k);
    if (!q) { app.toast('That question isn’t in the list any more.'); return; }
    if (!slots.asks.querySelector('[data-k="' + CSS.escape(k) + '"]')) { S.bestGroup = 'all'; S.bestAll = true; repaintBest(); }
    app.flashHit(root, k);
    qSheet(q);
    return;
  }
  if (/^https:\/\/(www\.|old\.)?reddit\.com\//.test(k)) {
    const a = (E.S.asks || []).find((x) => x.k === k);
    if ((!E.S.asks && !E.S.asksFailed) || (!a && E.S.asksLoading)) { pending = k; return; }
    if (a && store.isMuted(a.sid)) { app.toast('You muted ' + a.sub + '.'); return; }
    if (!app.flashHit(root, k)) app.toast('That thread has moved on.');
    return;
  }
  if (/^ig-/.test(k) && !E.S.posts && !E.S.igFailed) { pending = k; return; }
  if (/^dish-/.test(k) && E.S.dish === undefined) { pending = k; return; }
  if (/^dish-/.test(k) && !slots.photos.querySelector('[data-k="' + CSS.escape(k) + '"]')) { S.dishAll = true; paint('photos'); }
  if (/^mn-/.test(k) && !E.S.menuList && !E.S.menusFailed) { pending = k; return; }
  if (/^mn-/.test(k) && !slots.menus.querySelector('[data-k="' + CSS.escape(k) + '"]')) { S.menuQ = ''; S.menuAll = true; paint('menus'); }
  if (!app.flashHit(root, k)) app.toast('That one has moved on.');
}

E.onData((what) => {
  if (!ready) return;
  const map = { dishes: ['bite', 'photos'], kitchens: ['kitchens'], menus: ['menus'], asks: ['asks'], best: ['asks'] };
  (map[what] || []).forEach(paint);
  if (map[what]) { if (app.activeTab() === KEY) app.paintSubnav(); app.recount(); land(); }
});

app.register(KEY, {
  label: 'Bites',
  icon: ICON.bowl,
  promise: 'Every kitchen’s photos, posts and menus in one row.',
  mount(r) {
    root = r;
    r.innerHTML = '<p class="loading">Setting the table…</p>';
    E.core().then(() => {
      ready = true;
      render();
      if (app.activeTab() === KEY) app.paintSubnav();
      land();
    }).catch(() => { r.innerHTML = '<div class="errbox"><b>Bites didn’t load.</b></div>'; });
  },
  activate(param) {
    pending = param || null;
    if (ready && !app.demo && Date.now() - E.S.asksAt > ASKS_STALE) E.loadAsks();
    land();
  },
  refresh() { if (ready) ['bite', 'kitchens', 'asks'].forEach(paint); },
  deactivate() { app.closeVideo(); },
  subnav() {
    if (!ready) return null;
    return sectionBar({ key: 'sec-eat-bites', title: 'Bites', color: '--app-eat-pop', fresh: true, find: (k) => slots && slots[k], onPick: jump,
      items: SECTIONS.map(([key, label]) => ({ key, label, newest: newestOf(key), n: key === 'asks' && E.S.asks ? E.asksShown().length : null })) });
  },
  keepSubnav: true,
  /* the Reddit asks and the kitchens' posts grow while you are away */
  newSince(ts) {
    const base = Number(ts || 0);
    const asks = E.asksShown().filter((a) => a.d > base).length;
    const posts = E.kitchenFood().filter((p) => Number(p.ts) > base).length;
    return asks + posts;
  },
});
