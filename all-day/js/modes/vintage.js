/* Vintage: what is on the racks, where the racks are, trades, the Brief's
   own tees, and outfits worth showing off. Nothing on this tab takes money:
   every "buy" is a link to merch.btownbrief.com, a swap is a trade or a
   giveaway, and the thank-you for passing a find on is a thank-you, never
   points, a prize or a raffle.

   Top to bottom, and the chip row is the table of contents:

   - Fit checks. `fit` posts with an approved photo, newest first, as a row
     of photo tiles at the very top, so the first screen at 390 wide shows
     the fits and the start of Spotted this week. A tile opens the post's
     own board card in a sheet, where the vote ("Love this fit"), share,
     report and delete live. "Post" in the row's head is the same fit
     check form as before; a fit check needs a photo and lasts 60 days.
   - Spotted this week. Vintage board posts of kind `spotted` (boards.js):
     a reader saw something on a rack that wasn't their size and posted it
     so someone else can get it; one plain line under the head says so,
     because a first-time reader asked what it was for. Two up, the shop, size and price, days
     left, the board's vote as "I'd want this", share and report. A post
     lasts three weeks (boards-core.js). The poster can mark their own find
     "Someone got it": boards.put() ticks the post's `got` box, it leaves
     the grid, and the line above the grid thanks everyone: how many finds
     posted here found a home lately (the board's got finds, plus, for this
     month, ones this device took down before the box existed). That line
     is the whole of "thrift points" at launch.
   - Swaps, right under Spotted (Stephen, 2026-10-17: "I should probably
     put that up top"). Board posts of kind `swap`: what I have, what I'd
     take, size.
   - New in. The shops' own Instagram posts from the last two weeks
     (all-day/data/instagram.json, the accounts data/vintage-shops.json
     names), each a photo credited to its account and linked to the post.
     No posts, no section.
   - The shop guide. data/vintage-shops.json (scripts/build_vintage_shops.py
     from data/things.json): every vintage, thrift, consignment and antique
     shop in greater Burlington the Brief's guide has a street address for,
     numbered in walking order downtown and then by drive, with the
     way to the next one when both have coordinates, a map and the shop's
     own site. Used books come last, after the walk. Hours only where someone has read them off the shop's own
     page (the shop's `checked` date and source); a checked shop that posts
     none says to call ahead, and an unchecked one "Hours not checked yet".
     Colour, so the list is not a wall of grey: each kind of shop has its
     colour (thrift, vintage, consignment, antiques, used books), the
     number is a badge in the shop's first kind's colour, and a coloured
     divider names each neighborhood as the walk enters it.
     The Map button beside the head is a picture of the walk drawn here with
     no network; tapping it loads Leaflet and OpenStreetMap tiles (Food's
     stack, the guide's own) into a sheet with every shop as a pin carrying
     its guide number. A pin opens that shop in a sheet. The reader's dot
     shows only once they allow their location, and the map is never moved
     to it, so no tile request carries it; the position is never stored.
   - Make a tee. Stephen's always-in-stock designs from the merch repo
     (all-day/data/merch-designs.json, scripts/build_merch_rail.py), each a
     link to its page in the shop, where the Printify mockups on a model
     live. Then "Send in your design": one image through the photo queue
     with the consent box, a name, a line, and free shirts or store credit
     (never cash): a `design` post, the choice in its `thanks` field.
     Stephen sees it in the photo desk and the boards desk. Approved ones
     show under "Top designs", a row sorted by votes ("I'd wear this").
     The rail's pictures are each design's full artwork on its shirt colour
     (the merch data's first variant), not the small left-chest patch the
     merch data calls `front` (Stephen, 2026-10-17).

   Before the board had those two kinds, a design was a `spotted` post with
   shop "Make a tee" (the choice in its body) and a fit check one with shop
   "Fit check". Those still show where they belong until they end, three
   weeks after they were posted.

   ?demo=1 runs this same file: data/demo/vintage.json adds its finds, swaps
   and fit checks to the demo boards (boards-fake.js) and carries six of the
   real shops and designs, and invented shop posts for New in. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import * as boards from '../boards.js';
import { message } from '../boards-core.js';
import { el, esc, safeHref, ICON, art, section, rail, chips, button, pills, cards, agoShort } from '../ui.js';

const KEY = 'vintage';
const SHOPS_URL = '../data/vintage-shops.json';
const DESIGNS_URL = 'data/merch-designs.json';
const SHOP_URL = 'https://merch.btownbrief.com/';
const FIT = 'Fit check';
const TEE = 'Make a tee';
const HOMES_KEY = 'allday-vintage-homes';     // { 'YYYY-MM': finds this device took down as "someone got it", before the got box }
const NOTE_MAX = 140;
const DAY = 86400000;
const NEW_IN_DAYS = 14;
const NEW_IN_MAX = 12;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const SECTIONS = [['fit', 'Fit checks'], ['spotted', 'Spotted'], ['swaps', 'Swaps'], ['newin', 'New in'], ['shops', 'Shops'], ['tees', 'Make a tee']];
/* the slots, top to bottom: `make` is the design pitch, `sent` the designs
   neighbors sent in, as Top designs */
const SLOTS = ['fit', 'spotted', 'swaps', 'newin', 'shops', 'tees', 'make', 'sent'];

/* the guide's own map stack, as Food loads it (events.html, things-to-do.html):
   Leaflet from unpkg with its integrity hashes, OpenStreetMap's tiles, on the
   first tap of Map and never before */
const LEAFLET = {
  js: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', jsSri: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
  css: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', cssSri: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=',
};
/* OSM's one tile host, as its tile policy now asks (no a/b/c subdomains) */
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const CHURCH_ST = [44.4758, -73.2128];
const WALK_MI = 1;            // the map opens on the shops this close to Church Street: the walk on foot
const FAR_MI = 40;            // a reader further away than this is not "near" any of it

/* a colour per kind of shop: the badge, the kind's name and the map pin */
const KINDS = [['vintage', 'Vintage', /vintage/i], ['thrift', 'Thrift', /thrift|restore/i], ['consign', 'Consignment', /consign/i],
  ['antique', 'Antiques', /antique/i], ['books', 'Used books', /book/i]];
const kindKey = (k) => { const hit = KINDS.find(([, , re]) => re.test(String(k || ''))); return hit ? hit[0] : 'thrift'; };
const kindOf = (s) => kindKey((s.kinds || [])[0]);
const FEEDS = new Set(['spotted', 'swaps', 'sent']);

/* ------------------------------------------------------------------ state */
const S = {
  shops: null, shopsFailed: false, designs: null, designsTotal: null, designsFailed: false,
  spotted: null, swaps: null, fit: null, sent: null, got: 0, off: false, failed: false, homesDemo: 0,
  handles: null, posts: null,
};
let root = null, slots = null, pending = null, ready = false;

/* ---------------------------------------------------------------- loading */
let demoP = null;
const demoFile = () => demoP || (demoP = app.demoData(KEY).then((d) => { seedDemo(d); return d; }));

/* The demo boards (boards-fake.js) already hold three of the finds and one
   swap; the rest of data/demo/vintage.json goes in once, through the fake's
   own nn_post_create, then each post is moved to its place in its three
   weeks so the days-left labels differ. */
let seeded = false;
function seedDemo(d) {
  const f = boards._fake();
  if (!f || seeded) return;
  seeded = true;
  const have = new Set(f.posts.filter((p) => p.board === KEY).map((p) => p.title));
  const people = d.people || [];
  people.forEach(([id, name, hood]) => f.profiles.set(id, { display_name: name, neighborhood: hood, archetype: null }));
  let n = 0;
  const add = (kind, x, meta) => {
    if (x.who == null || have.has(x.title) || !people[x.who]) return;
    /* named like the fake's own demo photos (one palette per photo), which
       the boards tests tell apart from a reader's upload */
    const path = x.photo ? 'submissions/demo-' + x.photo + '.jpg' : null;
    const photo = path && !f.photos.has(path) ? f.addPhoto(path, 'pending') : null;
    n++;
    const row = f.as(people[x.who][0]).call('nn_post_create', {
      p_board: KEY, p_kind: kind, p_title: x.title, p_body: x.body || '', p_place: x.place || '', p_meta: meta, p_photo: photo,
    });
    f.as(null);
    if (photo) f.setPhoto(photo, 'approved');
    const p = f.posts.find((r) => r.id === row.id);
    /* placed as if it were a find with x.days left of its three weeks */
    p.created_at = f.now() + (Number(x.days) || 1) * DAY + 3 * 3600000 - 21 * DAY;
    const life = f.rules.boards[KEY].kinds[kind].days;
    p.expires_at = life ? p.created_at + life * DAY : null;
    for (let i = 0; i < (x.votes || 0); i++) f.votes.add(p.id + '|p_vseed' + n + 'x' + String(i).padStart(3, '0'));
  };
  (d.spotted || []).forEach((x) => add('spotted', x, { shop: x.shop, size: x.size, price: x.price }));
  (d.swaps || []).forEach((x) => add('swap', x, { want: x.want, size: x.size }));
  (d.fit || []).forEach((x) => add('fit', x, {}));
  (d.designsSent || []).forEach((x) => add('design', x, { thanks: x.thanks || 'shirts' }));
}

const tagOf = (p) => String((p.meta && p.meta.shop) || '').trim().toLowerCase();
const SPECIAL = new Set([FIT.toLowerCase(), TEE.toLowerCase()]);
const newest = (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at);

/* Four lists cover the board, one per kind, newest first. The spotted list
   also carries the fit checks and designs from before their kinds, by
   their shop tag, and the finds someone got, which leave the grid. */
let loads = 0;                // only the newest load lands: an older, slower one never overwrites it
function loadPosts() {
  const mine = ++loads;
  const kinds = ['spotted', 'swap', 'design', 'fit'];
  return Promise.all(kinds.map((kind) => boards.list(KEY, { kind, limit: 60 }))).then(([sp, sw, de, fi]) => {
    if (mine !== loads) return false;
    S.off = sp.error === 'off' || sw.error === 'off';
    S.failed = !S.off && !sp.ok;
    S.swapsFailed = !S.off && !sw.ok;
    const finds = sp.posts.filter((p) => !SPECIAL.has(tagOf(p)));
    S.spotted = finds.filter((p) => !(p.meta && p.meta.got === true));
    S.got = finds.length - S.spotted.length;
    S.fit = fi.posts.concat(sp.posts.filter((p) => tagOf(p) === FIT.toLowerCase())).filter((p) => p.photo).sort(newest);
    S.sent = de.posts.concat(sp.posts.filter((p) => tagOf(p) === TEE.toLowerCase())).filter((p) => p.photo).sort(newest);
    S.swaps = sw.posts;
    return true;
  });
}

function postsChanged() {
  return loadPosts().then((fresh) => {
    if (!fresh) return;
    ['fit', 'spotted', 'swaps', 'sent'].forEach(paint);
    if (app.activeTab() === KEY) app.paintSubnav();
    land();
  });
}

function takeShops(j) {
  S.shops = Array.isArray(j && j.shops) ? j.shops : [];
  S.handles = new Set((Array.isArray(j && j.instagram) ? j.instagram : []).map((h) => String(h).replace(/^@/, '').toLowerCase()));
}

function loadLive() {
  data.fetchJSON(SHOPS_URL, 8000).then(takeShops)
    .catch(() => { S.shopsFailed = true; })
    .then(() => { paint('shops'); paint('newin'); fillShopList(); app.paintSubnav(); land(); });
  data.load('instagram', (j) => {
    S.posts = j && Array.isArray(j.posts) ? j.posts.filter((p) => p && p.h && p.u && p.i) : [];
    paint('newin');
    if (app.activeTab() === KEY) app.paintSubnav();
  }, () => { S.posts = []; });
  data.fetchJSON(DESIGNS_URL, 8000).then((j) => { S.designs = Array.isArray(j && j.designs) ? j.designs : []; S.designsTotal = Number(j && j.total) || null; })
    .catch(() => { S.designsFailed = true; })
    .then(() => { paint('tees'); land(); });
  postsChanged();
}

window.addEventListener('allday-boards', (e) => {
  const d = (e && e.detail) || {};
  if (!ready || (d.board && d.board !== KEY)) return;
  postsChanged();
});
app.onAuth(() => { if (ready) postsChanged(); });

/* ---------------------------------------------------------------- helpers */
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const monthKey = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const panel = () => (root ? root.closest('.panel') : null);
function jump(k) { if (slots && slots[k]) app.jumpTo(slots[k]); }

/* An outbound link. In the demo it says where it would go instead. */
function outLink(label, href, cls, aria) {
  const a = el('a', cls || 'btn ghost sm', esc(label) + ' ' + ICON.ext);
  a.href = safeHref(href);
  a.target = '_blank';
  a.rel = 'noopener';
  if (aria) a.setAttribute('aria-label', aria);
  if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast(label + ' opens in the real build'); });
  return a;
}

/* Finds this device took down as "someone got it" this month, before the
   got box (or while nn-ROUND2.sql is not pasted): they are not on the
   board to count, so they are counted here, and the month's end retires
   them. */
function homes() {
  if (app.demo) return S.homesDemo;
  const map = store.read(HOMES_KEY, {});
  return Number(map && map[monthKey()]) || 0;
}
function addHome() {
  if (app.demo) { S.homesDemo++; return; }
  const map = store.read(HOMES_KEY, {});
  const k = monthKey();
  store.write(HOMES_KEY, { [k]: (Number(map && map[k]) || 0) + 1 });
}

/* ---------------------------------------------------------------- render */
function render() {
  root.innerHTML = '';
  slots = Object.create(null);
  SLOTS.forEach((k) => {
    const s = el('div', 'slot');
    s.dataset.sec = k;
    slots[k] = s;
    root.appendChild(s);
    if (FEEDS.has(k)) app.bindFeed(s);
  });
  const list = el('datalist');
  list.id = 'vintage-shop-list';
  root.appendChild(list);
  root.appendChild(el('div', 'spacer'));
  SLOTS.forEach(paint);
  fillShopList();
}

function paint(k) {
  if (!ready || !slots || !slots[k]) return;
  const host = slots[k];
  const y = panel() ? panel().scrollTop : 0;
  host.innerHTML = '';
  ({ fit: paintFit, spotted: paintSpotted, newin: paintNewIn, shops: paintShops, swaps: paintSwaps, tees: paintTees, make: paintMake, sent: paintSent })[k](host);
  if (panel() && app.activeTab() === KEY) panel().scrollTop = y;
}

/* Board posts, two up, on the shell's board card, or in a row (`rail`, its
   class). `vote` names the vote ("I'd want this"); `got` adds "Someone got
   it" to the reader's own. */
function grid(host, posts, o) {
  const g = o.rail ? rail(host, 'feed tight ' + o.rail) : el('div', 'grid2 feed tight');
  g.dataset.grid = o.name;
  const items = posts.map((p) => boards.item(p, { tab: KEY, ratio: 'r11', meta: o.meta }));
  app.know(items);
  items.forEach((it) => {
    if (o.text) it.text = o.text(it.text);
    it.arch = '';                 // the People archetype says nothing on a rack, and a half-width head has no room for it
    const n = cards.board(it);
    if (!n) return;
    const v = n.querySelector('[data-act="bvote"]');
    if (v) { v.setAttribute('aria-label', o.vote); v.title = o.vote; }
    if (o.got && it.mine) {
      const row = el('div', 'linkrow');
      const b = button(ICON.check + ' Someone got it', 'ghost sm');
      b.dataset.act = 'vgot';
      row.appendChild(b);
      n.appendChild(row);
    }
    g.appendChild(n);
  });
  if (!o.rail) host.appendChild(g);
}

const findMeta = (p) => [p.meta.shop, p.meta.size ? 'Size ' + p.meta.size : '', p.meta.price != null ? '$' + p.meta.price : ''].filter(Boolean).join(' · ');
const swapMeta = (p) => [p.meta.want ? 'For ' + p.meta.want : '', p.meta.size ? 'Size ' + p.meta.size : ''].filter(Boolean).join(' · ');
const noMeta = () => '';

function boardNote(host, what, failed) {
  if (S.off) host.appendChild(el('p', 'note pad', esc('Posting opens soon.')));
  else if (failed) host.appendChild(el('p', 'note pad', esc('The board didn’t load.')));
  else host.appendChild(el('p', 'note pad', esc(what)));
}

function addRow(host, label, fn) {
  const r = el('div', 'linkrow addrow');
  r.appendChild(button(ICON.plus + ' ' + esc(label), '', fn));
  host.appendChild(r);
}

/* ------------------------------------------------------- Spotted this week */
function thanksLine() {
  const n = S.got + homes();
  const p = el('p', 'note pad', n ? esc(plural(n, 'find', 'finds') + ' found a home lately.') + ' <b>' + esc('Thank you.') + '</b>' : '');
  p.dataset.thanks = String(n);
  p.hidden = !n;
  return p;
}

function paintSpotted(host) {
  section(host, 'Spotted this week');
  host.appendChild(el('p', 'note pad vwhy', esc('Saw something great that wasn’t your size? Post it so someone else can grab it.')));
  host.appendChild(thanksLine());
  host.appendChild(el('div', 'spacer'));
  if (S.spotted === null) host.appendChild(el('p', 'note pad', esc('Checking the racks…')));
  else if (!S.spotted.length) boardNote(host, 'Nothing spotted right now.', S.failed);
  else grid(host, S.spotted, { name: 'spotted', meta: findMeta, vote: 'I’d want this', got: true });
  addRow(host, 'Post a find', composeFind);
}

function composeFind() {
  boards.compose({
    board: KEY, kind: 'spotted', heading: 'Post a find', title: 'What is it?', titlePlaceholder: '1994 UVM crewneck',
    fields: [
      { key: 'shop', label: 'Shop', placeholder: 'Pick one from the guide, or type it', max: 60 },
      { key: 'size', label: 'Size', placeholder: 'M, 32, 9', max: 12 },
      { key: 'price', label: 'Price', type: 'int', placeholder: '28', hint: 'Whole dollars, no $ sign.' },
    ],
    body: 'Where in the shop', bodyPlaceholder: 'Back rack by the boots',
    notes: ['Up for three weeks. The photo shows once approved.'],
    cta: 'Post the find',
  });
  withShopList();
}

/* The compose sheet's shop field gets the guide's shops as suggestions;
   anything typed is still fine. The field arrives once the reader's profile
   has been asked for, so wait for it. */
function withShopList() {
  const sheet = document.getElementById('sheet');
  if (!sheet) return;
  const hook = () => {
    const i = sheet.querySelector('input[name="m:shop"]');
    if (!i) return false;
    i.setAttribute('list', 'vintage-shop-list');
    i.autocomplete = 'off';
    return true;
  };
  if (hook()) return;
  const mo = new MutationObserver(() => { if (hook()) mo.disconnect(); });
  mo.observe(sheet, { childList: true, subtree: true });
  setTimeout(() => mo.disconnect(), 8000);
}
function fillShopList() {
  const list = document.getElementById('vintage-shop-list');
  if (!list || !S.shops) return;
  list.innerHTML = S.shops.map((s) => '<option value="' + esc(s.name) + '"></option>').join('');
}

/* "Someone got it": the post's got box is ticked, it leaves the grid, and
   the thank-you counts it for everyone. Before nn-ROUND2.sql is pasted
   there is no box to tick, so it comes down and this device counts it. */
app.onAct('vgot', (it) => {
  const done = () => {
    document.querySelectorAll('.card.board[data-k="' + CSS.escape(it.k) + '"]').forEach((n) => n.remove());
    app.toast('Thank you for passing it on.');
  };
  app.confirmBox({
    title: 'Someone got it?',
    body: 'It comes off the board.',
    yes: 'Mark it gone',
    onYes() {
      /* only a server that answered "round one" gets the delete; one that
         could not be asked gets nothing, and the reader can try again */
      boards.roundTwo().then((two) => (two ? boards.put(it.id, { got: true }) : two === false ? { ok: false, error: 'off' } : { ok: false, message: message('offline') })).then((r) => {
        if (r.ok) { done(); return; }          // boards.put tells the tab, which reads the board again
        if (r.error !== 'off') { app.toast(r.message); return; }
        boards.remove(it.id).then((x) => {
          if (!x.ok) { app.toast(x.message); return; }
          addHome();
          done();
          paint('spotted');
        });
      });
    },
  });
});

/* ---------------------------------------------------------- the shop guide */
function monthOf(ym) {
  const m = /^(\d{4})-(\d{2})/.exec(String(ym || ''));
  return m ? MONTHS[Number(m[2]) - 1] + ' ' + m[1] : '';
}
function mapUrl(s) {
  const where = s.address || [s.neighborhood, 'Vermont'].filter(Boolean).join(', ');
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(s.name + ', ' + where);
}
/* The way to the next shop, said only as far as the data goes. */
function legText(s, next) {
  if (!next || !s.next) return '';
  const l = s.next;
  if (l.mode === 'walk') return 'Then about ' + plural(l.minutes, 'minute', 'minutes') + ' on foot to ' + next.name;
  if (l.mode === 'drive') return 'Then ' + l.miles + ' miles to ' + next.name + ': a drive or a bus';
  if (l.same_neighborhood) return 'Then ' + next.name + ', in the same neighborhood';
  return 'Then ' + next.name + (next.neighborhood ? ', ' + next.neighborhood : '');
}

const hasCoords = (s) => Array.isArray(s.coords) && s.coords.length === 2 && s.coords.every(Number.isFinite);
function miles(a, b) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2));
}
/* the divider a shop sits under: its neighborhood on the walk, then Used books */
const groupOf = (s) => (s.after_walk ? 'Used books' : s.neighborhood || '');

/* One shop as a row: the number as a badge in its kind's colour, the name,
   its kinds each in their own colour, hours, street, the blurb and the way
   to the next shop, with Map and Site. The sheet a map pin opens draws the
   same row. */
function shopRow(s, i, next, inSheet) {
  const row = el('div', 'lrow vshop');
  if (!inSheet) row.dataset.k = 's-' + s.id;
  const kinds = (s.kinds || []).map((k) => '<span class="vk k-' + kindKey(k) + '">' + esc(k) + '</span>').join(', ');
  /* the divider above already names the neighborhood; a shop after the walk, or one in a sheet, says it here */
  const hood = (s.after_walk || inSheet) && s.neighborhood ? ' · ' + esc(s.neighborhood) : '';
  // each run of days ("Thu–Fri 10am to 8pm") stays on one line at phone width
  const runs = s.hours ? s.hours.split(' · ').map((r) => '<span style="white-space:nowrap">' + esc(r) + '</span>').join(' · ') : '';
  const hours = s.hours ? '<b>' + runs + '</b>' + (s.hours_note ? esc('. ' + s.hours_note) : '') + (s.verified ? esc(' (checked ' + monthOf(s.verified) + ')') : '')
    : esc(s.checked ? 'No weekly hours posted; call ahead' + (s.phone ? ' at ' + s.phone : '') + (s.hours_note ? '. ' + s.hours_note : '') : 'Hours not checked yet');
  const where = s.address ? s.address.replace(/,\s*VT\s*\d{5}$/, '') : '';
  const leg = inSheet ? '' : legText(s, next);
  row.innerHTML = '<span class="num vbadge k-' + kindOf(s) + '">' + (i + 1) + '</span><div><div class="t">' + esc(s.name) + '</div>' +
    '<div class="s" data-kinds>' + kinds + hood + '</div><div class="s" data-hours>' + hours + '</div>' + (where ? '<div class="s" data-where>' + esc(where) + '</div>' : '') +
    (s.blurb ? '<div class="s">' + esc(s.blurb) + '</div>' : '') + (leg ? '<div class="s" data-leg>' + esc(leg) + '</div>' : '') + '</div>';
  const links = el('div', 'vlinks');
  links.appendChild(outLink('Map', mapUrl(s), 'pillbtn', 'Map for ' + s.name));
  if (s.website) links.appendChild(outLink('Site', s.website, 'pillbtn', s.name + '’s website'));
  row.appendChild(links);
  return row;
}

function paintShops(host) {
  const list = S.shops;
  const pinned = list ? list.filter(hasCoords) : [];
  section(host, 'The shop guide', list && list.length ? '<b>' + esc(plural(list.length, 'shop', 'shops')) + '</b> · walking order' : null, pinned.length ? mapButton(list) : null);
  if (!list) {
    host.appendChild(el('p', 'note pad', esc(S.shopsFailed ? 'The shop guide didn’t load.' : 'Loading the shops…')));
    return;
  }
  const wrap = el('div', 'vshops');
  const have = new Set(list.map(kindOf));
  const keys = el('div', 'vkeys');
  keys.dataset.keys = '';
  keys.innerHTML = KINDS.filter(([k]) => have.has(k)).map(([k, label]) => '<span class="vk k-' + k + '"><i></i>' + esc(label) + '</span>').join('');
  wrap.appendChild(keys);
  list.forEach((s, i) => {
    const g = groupOf(s);
    if (g && (i === 0 || g !== groupOf(list[i - 1]))) {
      const d = el('div', 'tdiv vhood', '<span>' + esc(g) + '</span>');
      d.dataset.hood = g;
      wrap.appendChild(d);
    }
    wrap.appendChild(shopRow(s, i, list[i + 1], false));
  });
  host.appendChild(wrap);
}

/* ---------------------------------------------------------------- the map */
/* The button's picture is the walk itself: a dot per shop around Church
   Street in its kind's colour, drawn here with no tiles and no library, so
   it costs nothing until it is tapped. */
function mapButton(list) {
  const c = CHURCH_ST;
  const W = 72, H = 44, halfLon = 0.012, halfLat = halfLon * Math.cos(c[0] * Math.PI / 180) * H / W;
  const dots = list.filter((s) => hasCoords(s) && Math.abs(s.coords[0] - c[0]) < halfLat && Math.abs(s.coords[1] - c[1]) < halfLon)
    .map((s) => '<circle class="vm-dot k-' + kindOf(s) + '" r="2.4" cx="' + (W / 2 + (s.coords[1] - c[1]) / halfLon * W / 2).toFixed(1) + '" cy="' + (H / 2 - (s.coords[0] - c[0]) / halfLat * H / 2).toFixed(1) + '"/>').join('');
  const b = el('button', 'mapbtn', '<svg class="fm-mini" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><rect class="fm-ground" width="' + W + '" height="' + H + '"/>' +
    '<path class="fm-street" d="M0 ' + H / 2 + 'H' + W + 'M' + W / 2 + ' 0V' + H + '"/>' + dots + '</svg><span>' + esc('Map') + '</span>');
  b.setAttribute('aria-label', 'Map of ' + plural(list.filter(hasCoords).length, 'shop', 'shops'));
  b.addEventListener('click', () => openMap());
  return b;
}

/* Leaflet, once. If Food's map already asked for it, wait for that same
   script rather than run a second copy. Any way it fails (an error, a load
   with no L, or a script that never answers) clears the way for a retry. */
let leafletP = null;
function loadLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (!leafletP) {
    if (!document.querySelector('link[data-leaflet]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = LEAFLET.css; css.integrity = LEAFLET.cssSri; css.crossOrigin = '';
      css.dataset.leaflet = '1';
      document.head.appendChild(css);
    }
    leafletP = new Promise((resolve, reject) => {
      const prior = [...document.querySelectorAll('script')].find((x) => x.src === LEAFLET.js);
      const js = prior || document.createElement('script');
      let wait = 0;
      const fail = () => { clearTimeout(wait); leafletP = null; if (!prior) js.remove(); reject(new Error('no Leaflet')); };
      js.addEventListener('load', () => { if (window.L && window.L.map) { clearTimeout(wait); resolve(window.L); } else fail(); });
      js.addEventListener('error', fail);
      wait = setTimeout(() => (window.L && window.L.map ? resolve(window.L) : fail()), 20000);
      if (prior) return;
      js.src = LEAFLET.js; js.integrity = LEAFLET.jsSri; js.crossOrigin = '';
      document.head.appendChild(js);
    });
  }
  return leafletP;
}

/* The reader's position: asked for only on a tap of Near me (or already
   allowed on an earlier visit), kept in this module for the visit, never
   written down, never sent anywhere. */
let me = null;
function locate() {
  if (me) return Promise.resolve(me);
  if (!navigator.geolocation) return Promise.reject(new Error('no location'));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition((pos) => {
      const at = [pos.coords.latitude, pos.coords.longitude];
      if (!at.every(Number.isFinite)) { reject(new Error('no location')); return; }
      if (miles(at, CHURCH_ST) > FAR_MI) { const e = new Error('far'); e.far = true; reject(e); return; }
      me = at;
      resolve(at);
    }, reject, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });
}

let M = null;                 // the Leaflet map while its sheet is up
let mePin = null;
function dropMap() { if (M) { try { M.remove(); } catch (e) { /* already gone */ } M = null; mePin = null; } }

/* The map sheet: every shop with coordinates as a pin carrying its guide
   number, in its kind's colour. It opens on the shops within a walk of
   Church Street; "All" fits every shop, Essex to Shelburne. `back` is the
   view a pin was tapped from, so "Back to the map" lands where the reader
   left it. */
function openMap(back) {
  const shops = S.shops || [];
  const list = shops.map((s, i) => ({ s, i })).filter(({ s }) => hasCoords(s));
  if (!list.length) return;
  const town = list.filter(({ s }) => miles(s.coords, CHURCH_ST) <= WALK_MI).map(({ s }) => s.coords);
  const every = list.map(({ s }) => s.coords);
  app.sheet('Shop map', (body) => {
    body.appendChild(el('p', 'sheet-note', '<b>' + esc(plural(list.length, 'shop', 'shops')) + '</b>'));
    const box = el('div', 'vmap');
    box.dataset.k = 'map';
    const bar = el('div', 'linkrow');
    let wide = back ? back.wide : town.length < 2;
    const fit = () => { if (M) M.fitBounds(wide ? every : town, { padding: [28, 28] }); };
    const show = () => { if (!M) return; if (back) M.setView(back.c, back.z); else fit(); };
    const span = button(esc(wide ? 'On foot' : 'All ' + list.length), 'ghost sm vspan', () => {
      wide = !wide;
      span.textContent = wide ? 'On foot' : 'All ' + list.length;
      fit();
    });
    span.hidden = town.length < 2 || town.length === list.length;
    const near = button(ICON.pin + ' ' + esc('Near me'), 'ghost sm nearme', () => {
      locate().then(placeMe).catch((e) => app.toast(e && e.far ? 'You’re not near Burlington.' : 'Location is off.'));
    });
    bar.append(span, near);
    body.append(box, bar);
    dropMap();
    loadLeaflet().then((L) => {
      if (!box.isConnected) return;
      M = L.map(box, { zoomControl: true, attributionControl: true });
      show();
      L.tileLayer(TILES, { maxZoom: 19, attribution: TILE_CREDIT }).addTo(M);
      list.forEach(({ s, i }) => {
        const icon = L.divIcon({ className: 'vm-pin k-' + kindOf(s), html: String(i + 1), iconSize: [26, 26], iconAnchor: [13, 13] });
        const pin = L.marker(s.coords, { icon, title: (i + 1) + '. ' + s.name, keyboard: true, riseOnHover: true }).addTo(M);
        pin.bindTooltip(esc(s.name));
        pin.on('click', () => shopSheet(i, M ? { c: M.getCenter(), z: M.getZoom(), wide } : null));
      });
      if (me) placeMe();
      else if (navigator.permissions && navigator.permissions.query) {
        /* already allowed on an earlier visit: no need to ask again */
        navigator.permissions.query({ name: 'geolocation' }).then((p) => { if (p.state === 'granted') locate().then(placeMe).catch(() => {}); }).catch(() => {});
      }
      setTimeout(() => { if (M && box.isConnected) { M.invalidateSize(); show(); } }, 80);
    }).catch(() => {
      if (box.isConnected) box.replaceWith(el('p', 'note pad', esc('The map didn’t load.')));
    });
  });
}

/* the reader's own dot; the map is not moved to it, because turning the
   map to the reader would ask the tile server for their block */
function placeMe() {
  if (!M || !me || !window.L || !M.getContainer().isConnected) return;
  if (mePin) { try { mePin.remove(); } catch (e) { /* gone with its map */ } }
  mePin = window.L.circleMarker(me, { radius: 8, weight: 3, className: 'vm-me', interactive: false }).addTo(M);
  const near = document.querySelector('.sheet-body .nearme');
  if (near) near.hidden = true;
}

/* a pin's shop: its row from the guide, and the way back to the map */
function shopSheet(i, view) {
  const s = (S.shops || [])[i];
  if (!s) return;
  app.sheet(s.name, (body) => {
    const wrap = el('div', 'vshops insheet');
    wrap.appendChild(shopRow(s, i, null, true));
    body.appendChild(wrap);
    const r = el('div', 'linkrow');
    const back = button(esc('Back to the map'), 'ghost sm', () => openMap(view));
    back.dataset.act = 'vmapback';
    r.appendChild(back);
    body.appendChild(r);
  });
}

/* ------------------------------------------------------------------- Swaps */
function paintSwaps(host) {
  section(host, 'Swaps');
  if (S.swaps === null) host.appendChild(el('p', 'note pad', esc('Checking the swap shelf…')));
  else if (!S.swaps.length) boardNote(host, 'No swaps right now.', S.swapsFailed);
  else grid(host, S.swaps, { name: 'swaps', meta: swapMeta, vote: 'I’d take this' });
  addRow(host, 'Post a swap', () => boards.compose({
    board: KEY, kind: 'swap', heading: 'Post a swap', title: 'What you have', titlePlaceholder: 'M crewneck, forest green',
    fields: [
      { key: 'want', label: 'What you’d take for it', placeholder: 'An L flannel, or free', max: 80 },
      { key: 'size', label: 'Size', placeholder: 'M, 32, 9', max: 12 },
    ],
    body: 'More', bodyPlaceholder: 'Condition, and when you can meet', place: 'Neighborhood', placePlaceholder: 'Old North End',
    notes: ['A trade or free, no money. Up for three weeks.'],
    cta: 'Post the swap',
  }));
}

/* -------------------------------------------------------------- Make a tee */
function paintTees(host) {
  const total = S.designsTotal || (S.designs ? S.designs.length : 0);
  section(host, 'Make a tee', total ? '<b>' + esc(plural(total, 'design', 'designs')) + '</b>' : null);
  if (!S.designs) {
    host.appendChild(el('p', 'note pad', esc(S.designsFailed ? 'The designs didn’t load.' : 'Loading the designs…')));
  } else if (S.designs.length) {
    const r = rail(host, 'pad-top');
    S.designs.forEach((d) => {
      const a = el('a', 'vcard w150');
      a.href = safeHref(d.href);
      a.target = '_blank';
      a.rel = 'noopener';
      a.dataset.k = 'd-' + d.id;
      a.setAttribute('aria-label', d.name + ': see it on a model in the shop');
      a.innerHTML = '<span class="c-media r11">' + art('./' + String(d.img || '').replace(/^\.?\//, '')) + '</span>' +
        '<span class="t">' + esc(d.name) + '</span><span class="s">' + esc('See it on a model') + ' ' + ICON.ext + '</span>';
      if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens ' + d.name + ' in the merch shop in the real build'); });
      r.appendChild(a);
    });
  }
  const links = el('div', 'linkrow addrow');
  links.appendChild(outLink(total ? 'All ' + total + ' designs in the shop' : 'The shop', SHOP_URL));
  host.appendChild(links);
}

/* Send in a design: the button here, the form in a sheet like every other
   post. One image of the artist's own work through the photo queue
   (category 'board', consent required), a name, a line, and how they'd be
   thanked: free shirts or store credit. There is no price, no payment and
   no cash option anywhere in it. */
function paintMake(host) {
  const tc = el('div', 'textcard gap');
  tc.dataset.k = 'send';
  tc.innerHTML = '<h3 class="serif">' + esc('Send in your design') + '</h3>';
  const row = el('div', 'row');
  row.appendChild(button(ICON.plus + ' ' + esc('Send in your design'), '', designSheet));
  tc.appendChild(row);
  host.appendChild(tc);
}

function designSheet() {
  app.sheet('Send in your design', (body, card, close) => {
    if (!app.user()) { signInNote(body); return; }
    body.appendChild(photoForm({
      kind: 'design', pick: 'Choose your design', titleLabel: 'What’s it called?', titlePlaceholder: 'Rainy Church Street',
      noteLabel: 'One line about it', notePlaceholder: 'Ink, drawn from the Leunig’s corner',
      consent: 'This is my own artwork, and the Brief may print it on shirts and show it in All Day and the newsletter.',
      choice: [['shirts', 'Free shirts'], ['credit', 'Store credit']], cta: 'Send it to Stephen',
      sent: 'Sent. It shows once approved.', done: close,
    }));
  });
}

/* Top designs: every design neighbors sent in, in a row, most "I'd wear
   this" first (newest first among equals). The order is set when the row
   is drawn, so a card never jumps out from under the reader's vote. */
const byVotes = (a, b) => (Number(b.votes) || 0) - (Number(a.votes) || 0) || newest(a, b);
function paintSent(host) {
  if (!S.sent || !S.sent.length) return;
  host.appendChild(el('div', 'tdiv', '<span>' + esc('Top designs') + '</span>'));
  host.appendChild(el('div', 'spacer'));
  /* how the artist asked to be thanked is for Stephen, not the card (a
     design from before the kind carried it at the end of its body) */
  grid(host, S.sent.slice().sort(byVotes), { name: 'sent', rail: 'vtop', meta: noMeta, vote: 'I’d wear this', text: (t) => String(t || '').replace(/\s*Thanks in: [a-z ]+$/i, '') });
}

/* --------------------------------------------------------------- Fit check */
/* A row of photo tiles at the top. A tile is the post's picture, title and
   first name; tapping it opens the post's own board card in a sheet, so
   the vote, share, report and delete are the board's, as everywhere. */
function paintFit(host) {
  const post = button(ICON.plus + ' ' + esc('Post'), 'ghost sm', fitSheet);
  post.dataset.act = 'vfitpost';
  post.setAttribute('aria-label', 'Post a fit check');
  section(host, 'Fit checks', null, post);
  if (S.fit === null) { host.appendChild(el('p', 'note pad', esc('Loading the fits…'))); return; }
  if (!S.fit.length) { boardNote(host, 'No fit checks yet.', S.failed); return; }
  const items = S.fit.map((p) => boards.item(p, { tab: KEY, ratio: 'r45', meta: noMeta }));
  app.know(items);
  const r = rail(host);
  r.dataset.grid = 'fit';
  items.forEach((it) => {
    if (!it.media) return;
    const a = el('a', 'vcard w150 ftile');
    a.href = it.href;
    a.dataset.k = it.k;
    a.setAttribute('aria-label', it.title + ', by ' + it.author);
    a.innerHTML = '<span class="c-media r45">' + art(it.media) + '</span><span class="t">' + esc(it.title) + '</span>' +
      '<span class="s">' + esc(it.author) + '</span>';
    a.addEventListener('click', (e) => { e.preventDefault(); fitOpen(it.k); });
    r.appendChild(a);
  });
}

/* The fit check's own card, in a sheet. The item is read again by its key,
   so a vote cast here and the board's reload agree. */
function fitOpen(k) {
  const it = app.item(k);
  if (!it) return;
  app.sheet('Fit check', (body) => {
    it.arch = '';
    const n = cards.board(it);
    if (!n) return;
    const v = n.querySelector('[data-act="bvote"]');
    if (v) { v.setAttribute('aria-label', 'Love this fit'); v.title = 'Love this fit'; }
    const feed = el('div', 'feed');
    feed.appendChild(n);
    body.appendChild(feed);
    app.bindFeed(feed);
  });
}

/* ------------------------------------------------------------------ New in */
/* The shops' own Instagram posts from the last two weeks, newest first,
   each credited to its account and linked to the post. A picture whose
   signed link has lapsed is left out rather than shown broken. */
const sigExpiry = (u) => { const m = /[?&]oe=([0-9a-f]+)/i.exec(String(u || '')); return m ? parseInt(m[1], 16) : null; };
const trim = (t, n) => { const v = String(t || '').replace(/\s+/g, ' ').trim(); return v.length > n ? v.slice(0, n - 1).trimEnd() + '…' : v; };
const igKey = (p) => { const m = /\/(?:p|reel)\/([A-Za-z0-9_-]+)/.exec(p.u); return 'ig-' + (m ? m[1] : p.h + '-' + p.ts); };

function newIn() {
  if (!S.posts || !S.handles) return [];
  const nowS = Date.now() / 1000;
  const since = nowS - NEW_IN_DAYS * 86400;
  return S.posts.filter((p) => S.handles.has(String(p.h).toLowerCase()) && Number(p.ts) > since)
    .filter((p) => { const e = sigExpiry(p.i); return e === null || e > nowS; })
    .sort((a, b) => b.ts - a.ts).slice(0, NEW_IN_MAX);
}

function paintNewIn(host) {
  const posts = newIn();
  if (!posts.length) return;
  section(host, 'New in');
  const r = rail(host);
  r.dataset.rail = 'newin';
  posts.forEach((p) => {
    const a = el('a', 'vcard w150');
    a.href = safeHref(p.u);
    a.target = '_blank';
    a.rel = 'noopener';
    a.dataset.k = igKey(p);
    a.setAttribute('aria-label', 'Post by @' + p.h + ' on Instagram');
    a.innerHTML = '<span class="c-media r11">' + art(p.i) + '</span><span class="t">' + esc(trim('@' + p.h, 22)) + '</span>' +
      '<span class="s">' + esc([trim(p.c, 50), Number(p.ts) ? agoShort(p.ts) : ''].filter(Boolean).join(' · ')) + '</span>';
    if (app.demo) a.addEventListener('click', (e) => { e.preventDefault(); app.toast('Opens the post on Instagram in the real build'); });
    r.appendChild(a);
  });
}

function signInNote(body) {
  body.appendChild(el('p', 'sheet-note', esc('Sign in to post.')));
  const r = el('div', 'linkrow');
  r.appendChild(button('Sign in', '', () => app.openSettings()));
  body.appendChild(r);
}

function fitSheet() {
  app.sheet('Post a fit check', (body, card, close) => {
    if (!app.user()) { signInNote(body); return; }
    body.appendChild(photoForm({
      kind: 'fit', pick: 'Choose a photo', titleLabel: 'What are you wearing?', titlePlaceholder: 'All thrifted except the socks',
      noteLabel: 'Where it’s from', notePlaceholder: 'Coat from Barge Canal, tee from the Brief',
      consent: 'I took this photo, and the Brief may show it in All Day and the newsletter.',
      cta: 'Post it', sent: 'Posted. It shows once approved.', done: close,
    }));
  });
}

/* A board post that needs a photo, which compose() can't insist on: the
   fit check and the design. Same queue, same consent, same boards.create(). */
function photoForm(o) {
  const f = el('form', 'bform');
  f.noValidate = true;
  f.dataset.form = o.kind;
  let file = null, choice = null;
  const row = (label, ctl, opt, hint) => {
    const w = el('div', 'bf-row');
    const id = 'vf-' + o.kind + '-' + ctl.name;
    ctl.id = id;
    const l = el('label', 'bf-label', esc(label) + (opt ? ' <span class="bf-opt">optional</span>' : ''));
    l.htmlFor = id;
    w.append(l, ctl);
    if (hint) w.appendChild(el('p', 'bf-hint', esc(hint)));
    return w;
  };
  const text = (name, max, placeholder) => {
    const i = el('input', 'field bf-in');
    i.type = 'text'; i.name = name; i.maxLength = max; i.placeholder = placeholder || ''; i.autocomplete = 'off';
    return i;
  };

  const nameRow = row('Your first name', text('display_name', 32, 'Maya, or Maya R.'), false, 'Neighbors see it.');
  nameRow.hidden = true;
  f.appendChild(nameRow);

  const pickRow = el('div', 'bf-row');
  const input = el('input');
  input.type = 'file'; input.accept = 'image/*'; input.hidden = true; input.name = 'photo';
  const fname = el('span', 'bf-hint', esc('No picture yet'));
  const pick = button(ICON.plus + ' ' + esc(o.pick), 'ghost sm', (e) => { e.preventDefault(); input.click(); });
  pick.type = 'button';
  input.addEventListener('change', () => { file = (input.files && input.files[0]) || null; fname.textContent = file ? file.name : 'No picture yet'; });
  const line = el('div', 'bf-photo');
  line.append(pick, fname);
  pickRow.append(line, input);
  f.appendChild(pickRow);

  f.appendChild(row(o.titleLabel, text('title', 80, o.titlePlaceholder)));
  f.appendChild(row(o.noteLabel, text('note', NOTE_MAX, o.notePlaceholder), true));
  if (o.choice) {
    const w = el('div', 'bf-row');
    w.appendChild(el('div', 'bf-label', esc('If Stephen prints it, you get')));
    const p = pills(o.choice, null, (v) => { choice = v; }, 'wrap');
    p.dataset.choice = '';
    w.appendChild(p);
    f.appendChild(w);
  }
  f.appendChild(el('label', 'consent', '<input type="checkbox" name="consent"> ' + esc(o.consent)));
  const msg = el('p', 'bf-msg');
  msg.setAttribute('role', 'status');
  const go = button(esc(o.cta), '');
  go.type = 'submit';
  const goRow = el('div', 'bf-go');
  goRow.append(go, msg);
  f.appendChild(goRow);

  const say = (t, err) => { msg.textContent = t; msg.classList.toggle('err', !!err); go.disabled = false; };
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const title = String(fd.get('title') || '').replace(/\s+/g, ' ').trim();
    const note = String(fd.get('note') || '').replace(/\s+/g, ' ').trim();
    const name = String(fd.get('display_name') || '').trim();
    if (!file || !file.size) return say(o.kind === 'design' ? 'Choose your design first.' : 'Choose a photo first.', true);
    if (!/^image\//.test(file.type || 'image/')) return say('That file isn’t a picture.', true);
    if (!title) return say(o.kind === 'design' ? 'Give it a name.' : 'Say what you’re wearing.', true);
    if (o.choice && !choice) return say('Pick free shirts or store credit.', true);
    if (!fd.get('consent')) return say(message('no_consent'), true);
    if (!app.user()) return say(message('not_signed_in'), true);   // signed out while the sheet was open
    if (!nameRow.hidden && !name) return say(message('no_name'), true);
    go.disabled = true;
    msg.classList.remove('err');
    msg.textContent = 'Sending the picture…';
    const named = nameRow.hidden ? Promise.resolve({ ok: true }) : boards.setProfile({ display_name: name });
    named.then((n) => (n.ok ? boards.roundTwo().then((two) => ({ ...n, two })) : n)).then((n) => {
      if (!n.ok) return say(n.message, true);
      /* its own kind; on a server still on round one's rules, the old shape:
         a find tagged with the section's name, the choice in the body */
      const post = n.two ? { kind: o.kind, body: note, meta: o.choice ? { thanks: choice } : {} }
        : { kind: 'spotted', body: [note, o.choice ? 'Thanks in: ' + (choice === 'shirts' ? 'free shirts' : 'store credit') : ''].filter(Boolean).join('\n\n'),
          meta: { shop: o.kind === 'design' ? TEE : FIT } };
      return boards.create(KEY, { ...post, title, photo: file, consent: true })
        .then((r) => {
          if (!r.ok) {
            if (r.error === 'no_name') nameRow.hidden = false;
            return say(r.message, true);
          }
          f.reset();
          file = null; choice = null;
          fname.textContent = 'No picture yet';
          f.querySelectorAll('.pills button').forEach((b) => b.classList.remove('on'));
          nameRow.hidden = true;
          say('');
          app.toast(o.sent);
          if (o.done) o.done();
        });
    });
  });
  return f;
}

/* ------------------------------------------------------ put it on a shirt */
/* The old Art tab's "Put it on a shirt" landed here as
   #vintage/b-<art post id> (post ids are uuids, so it never matches a
   Vintage post), and those links still work now that Art is folded. Only
   posts whose maker ticked the shirt box carried that button, so only those
   are looked up: up to three pages of the art board's shirt-yes posts. */
function artForShirt(id, before, page) {
  return boards.list('art', { meta: { shirt: 'yes' }, limit: 60, before }).then((r) => {
    if (!r.ok) return { error: r.message };
    const hit = r.posts.find((p) => p.id === id);
    if (hit || !r.posts.length || page >= 2) return hit || null;
    return artForShirt(id, r.posts[r.posts.length - 1].created_at, page + 1);
  });
}
function shirtSheet(p) {
  app.sheet('Put it on a shirt', (body) => {
    if (p.photo) body.appendChild(el('span', 'c-media r45', art(boards.photoUrl(p.photo))));
    body.appendChild(el('p', 'pick-why', '<b>' + esc(p.title) + '</b>' + esc(' by ' + (p.author || 'a neighbor'))));
    const links = el('div', 'linkrow');
    links.appendChild(outLink('Browse the shop', SHOP_URL));
    body.appendChild(links);
  });
}

/* -------------------------------------------------------------- deep links */
/* #vintage/fit|spotted|swaps|newin|shops|tees jumps to a section; map opens
   the shop map; b-<id> is a post (or an Art post on its way to a shirt),
   s-<id> a shop, d-<id> a design. A key waits for its list to load. */
/* a find comes down when someone gets it or its three weeks end; an Art
   piece can be taken down by its maker: the words fit both */
const GONE = 'That post has gone.';
let route = 0;                // bumped on every landing and leaving, so a slow lookup never opens over the wrong page
function land() {
  if (!pending || !ready) return;
  const k = pending;
  if (SECTIONS.some(([s]) => s === k)) { pending = null; jump(k); return; }
  if (k === 'map') {
    if (!S.shops && !S.shopsFailed) return;
    pending = null;
    jump('shops');
    openMap();
    return;
  }
  const loaded = /^b-/.test(k) ? S.spotted !== null : /^s-/.test(k) ? !!S.shops || S.shopsFailed : /^d-/.test(k) ? !!S.designs || S.designsFailed : true;
  if (!loaded) return;
  pending = null;
  if (app.flashHit(root, k)) return;
  if (/^b-/.test(k)) {
    const at = route;
    artForShirt(k.slice(2), null, 0).then((p) => {
      if (at !== route || app.activeTab() !== KEY) return;
      if (p && p.error) app.toast(p.error);
      else if (p) shirtSheet(p);
      else app.toast(GONE);
    });
    return;
  }
  app.toast('That one has moved on.');
}

app.register(KEY, {
  label: 'Vintage',
  icon: ICON.vintage,
  promise: 'Every thrift and vintage shop around Burlington, fit checks, and what is on the racks this week.',
  mount(r) {
    root = r;
    if (!app.demo) { ready = true; render(); loadLive(); return; }
    /* the demo is all local: draw once, with the demo boards seeded */
    r.innerHTML = '<p class="loading">Loading…</p>';
    demoFile().then((d) => {
      takeShops(d);
      const shift = Math.round(Date.now() / 1000 - Date.parse(d.anchor || '2026-10-16T12:00:00-04:00') / 1000);
      S.posts = (d.instagramPosts || []).map((p) => ({ ...p, ts: Number(p.ts) + shift }));
      S.designs = d.designs || [];
      S.designsTotal = Number(d.designsTotal) || null;
      S.homesDemo = Number(d.homesThisMonth) || 0;
      return loadPosts();
    }).then(() => {
      ready = true;
      render();
      if (app.activeTab() === KEY) app.paintSubnav();
      land();
    }).catch(() => { r.innerHTML = '<div class="errbox"><b>The demo didn’t load.</b></div>'; });
  },
  activate(param) { route++; pending = param || null; land(); },
  refresh() { if (ready) SLOTS.forEach(paint); },
  deactivate() { route++; if (M && !M.getContainer().isConnected) dropMap(); },
  subnav() {
    if (!ready) return null;
    const n = { spotted: S.spotted && S.spotted.length, shops: S.shops && S.shops.length, swaps: S.swaps && S.swaps.length, fit: S.fit && S.fit.length };
    const fresh = newIn().length;
    return chips(SECTIONS.filter(([key]) => key !== 'newin' || fresh).map(([key, label]) => ({ key, label, n: key === 'newin' ? fresh : n[key] || null })), null, (k) => jump(k));
  },
  /* reader posts newer than the last visit: finds, swaps and fit checks */
  newSince(ts) {
    const t = Number(ts) * 1000 || 0;
    return [S.spotted, S.swaps, S.fit].reduce((a, l) => a + (l || []).filter((p) => Date.parse(p.created_at) > t).length, 0);
  },
});
