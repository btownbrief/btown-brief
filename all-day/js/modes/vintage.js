/* Vintage: what is on the racks, where the racks are, trades, the Brief's
   own tees, and outfits worth showing off. Nothing on this tab takes money:
   every "buy" is a link to merch.btownbrief.com, a swap is a trade or a
   giveaway, and the thank-you for passing a find on is a thank-you, never
   points, a prize or a raffle.

   Top to bottom, and the chip row is the table of contents:

   - Spotted this week. Vintage board posts of kind `spotted` (boards.js):
     a reader saw something on a rack that wasn't their size and posted it
     so someone else can get it. Two up, the shop, size and price, days
     left, the board's vote as "I'd want this", share and report. A post
     lasts three weeks (boards-core.js). The poster can mark their own find
     "Someone got it": boards.put() ticks the post's `got` box, it leaves
     the grid, and the line above the grid thanks everyone: how many finds
     posted here found a home lately (the board's got finds, plus, for this
     month, ones this device took down before the box existed). That line
     is the whole of "thrift points" at launch.
   - The shop guide. data/vintage-shops.json (scripts/build_vintage_shops.py
     from data/things.json): every vintage, thrift, consignment, antique and
     record shop the Brief's guide knows, numbered in walking order, with the
     way to the next one when both have coordinates, a map and the shop's
     own site. Hours only where someone has read them off the shop's own
     page (the shop's `checked` date and source); a checked shop that posts
     none says to call ahead, and an unchecked one "Hours not checked yet".
   - Swaps. Board posts of kind `swap`: what I have, what I'd take, size.
   - Make a tee. Stephen's always-in-stock designs from the merch repo
     (all-day/data/merch-designs.json, scripts/build_merch_rail.py), each a
     link to its page in the shop, where the Printify mockups on a model
     live. Then "Send in your design": one image through the photo queue
     with the consent box, a name, a line, and free shirts or store credit
     (never cash): a `design` post, the choice in its `thanks` field.
     Stephen sees it in the photo desk and the boards desk. Approved ones
     show under "Sent in".
   - Fit check. `fit` posts with an approved photo, newest first; a fit
     check needs a photo and lasts 60 days.

   Before the board had those two kinds, a design was a `spotted` post with
   shop "Make a tee" (the choice in its body) and a fit check one with shop
   "Fit check". Those still show where they belong until they end, three
   weeks after they were posted.

   ?demo=1 runs this same file: data/demo/vintage.json adds its finds, swaps
   and fit checks to the demo boards (boards-fake.js) and carries six of the
   real shops and designs. */

import * as app from '../app.js';
import * as store from '../store.js';
import * as data from '../wire.js';
import * as boards from '../boards.js';
import { message } from '../boards-core.js';
import { el, esc, safeHref, ICON, art, section, rail, chips, button, pills, cards } from '../ui.js';

const KEY = 'vintage';
const SHOPS_URL = '../data/vintage-shops.json';
const DESIGNS_URL = 'data/merch-designs.json';
const SHOP_URL = 'https://merch.btownbrief.com/';
const FIT = 'Fit check';
const TEE = 'Make a tee';
const HOMES_KEY = 'allday-vintage-homes';     // { 'YYYY-MM': finds this device took down as "someone got it", before the got box }
const NOTE_MAX = 140;
const DAY = 86400000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const SECTIONS = [['spotted', 'Spotted'], ['shops', 'Shops'], ['swaps', 'Swaps'], ['tees', 'Make a tee'], ['fit', 'Fit check']];
/* the slots, top to bottom: `make` is the design pitch, `sent` the designs
   neighbors sent in */
const SLOTS = ['spotted', 'shops', 'swaps', 'tees', 'make', 'sent', 'fit'];
const FEEDS = new Set(['spotted', 'swaps', 'sent', 'fit']);

/* ------------------------------------------------------------------ state */
const S = {
  shops: null, shopsFailed: false, designs: null, designsTotal: null, designsFailed: false,
  spotted: null, swaps: null, fit: null, sent: null, got: 0, off: false, failed: false, homesDemo: 0,
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
    ['spotted', 'swaps', 'sent', 'fit'].forEach(paint);
    if (app.activeTab() === KEY) app.paintSubnav();
    land();
  });
}

function loadLive() {
  data.fetchJSON(SHOPS_URL, 8000).then((j) => { S.shops = Array.isArray(j && j.shops) ? j.shops : []; })
    .catch(() => { S.shopsFailed = true; })
    .then(() => { paint('shops'); fillShopList(); app.paintSubnav(); land(); });
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
  ({ spotted: paintSpotted, shops: paintShops, swaps: paintSwaps, tees: paintTees, make: paintMake, sent: paintSent, fit: paintFit })[k](host);
  if (panel() && app.activeTab() === KEY) panel().scrollTop = y;
}

/* Board posts, two up, on the shell's board card. `vote` names the vote
   ("I'd want this"); `got` adds "Someone got it" to the reader's own. */
function grid(host, posts, o) {
  const g = el('div', 'grid2 feed tight');
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
  host.appendChild(g);
}

const findMeta = (p) => [p.meta.shop, p.meta.size ? 'Size ' + p.meta.size : '', p.meta.price != null ? '$' + p.meta.price : ''].filter(Boolean).join(' · ');
const swapMeta = (p) => [p.meta.want ? 'For ' + p.meta.want : '', p.meta.size ? 'Size ' + p.meta.size : ''].filter(Boolean).join(' · ');
const noMeta = () => '';

function boardNote(host, what, failed) {
  if (S.off) host.appendChild(el('p', 'note pad', esc('Posting opens soon: the board is still being set up. Everything else here works.')));
  else if (failed) host.appendChild(el('p', 'note pad', esc('The board didn’t load. Try again in a bit.')));
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
  const p = el('p', 'note pad', n
    ? '<b>' + esc('Thank you.') + '</b> ' + esc(plural(n, 'find', 'finds') + ' posted here found a home lately. No points and no prizes, just the right size in the right hands.')
    : esc('When someone gets a find you posted, tap “Someone got it” on it and it comes off the board. No points and no prizes: just a thank-you, right here.'));
  p.dataset.thanks = String(n);
  return p;
}

function paintSpotted(host) {
  section(host, 'Spotted this week', esc('Seen on a rack, not your size, posted so someone else can get it. A find lasts three weeks; tap the arrow if you’d want it.'));
  host.appendChild(thanksLine());
  host.appendChild(el('div', 'spacer'));
  if (S.spotted === null) host.appendChild(el('p', 'note pad', esc('Checking the racks…')));
  else if (!S.spotted.length) boardNote(host, 'Nothing spotted right now. Seen something good that wasn’t your size? Post it.', S.failed);
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
    notes: ['Your photo goes to Stephen first. The find shows right away; its photo joins it once he okays it.',
      'A find lasts three weeks. When someone gets it, tap “Someone got it” on your post.'],
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
    body: 'Nice. It comes off the board now, and the find counts toward the thank-you.',
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

function paintShops(host) {
  const list = S.shops;
  const checked = list ? list.filter((s) => s.hours).length : 0;
  section(host, 'The shop guide', list && list.length
    ? esc(plural(list.length, 'shop', 'shops') + ' in walking order, neighborhood by neighborhood from Church Street out. ' +
      (checked ? 'Hours where we have checked them; call ahead for the rest.' : 'Hours aren’t checked yet; call ahead.'))
    : esc('Every vintage, thrift and record shop in the Brief’s guide.'));
  if (!list) {
    host.appendChild(el('p', 'note pad', esc(S.shopsFailed ? 'The shop guide didn’t load. Try again in a bit.' : 'Loading the shops…')));
    return;
  }
  list.forEach((s, i) => {
    const row = el('div', 'lrow');
    row.dataset.k = 's-' + s.id;
    const facts = [(s.kinds || []).join(', '), s.neighborhood].filter(Boolean).join(' · ');
    const hours = s.hours ? '<b>' + esc(s.hours) + '</b>' + (s.verified ? esc(' (checked ' + monthOf(s.verified) + ')') : '')
      : esc(s.checked ? 'No hours posted; call ahead' + (s.phone ? ' at ' + s.phone : '') : 'Hours not checked yet');
    const leg = legText(s, list[i + 1]);
    row.innerHTML = '<span class="num">' + (i + 1) + '</span><div><div class="t">' + esc(s.name) + '</div>' +
      '<div class="s">' + esc(facts) + '</div><div class="s" data-hours>' + hours + (s.address ? esc(' · ' + s.address) : '') + '</div>' +
      (s.blurb ? '<div class="s">' + esc(s.blurb) + '</div>' : '') + (leg ? '<div class="s" data-leg>' + esc(leg) + '</div>' : '') + '</div>';
    row.appendChild(outLink('Map', mapUrl(s), 'pillbtn', 'Map for ' + s.name));
    if (s.website) row.appendChild(outLink('Site', s.website, 'pillbtn', s.name + '’s website'));
    host.appendChild(row);
  });
  host.appendChild(el('p', 'note pad', esc('Missing a shop, or know the hours? The guide is the Brief’s own; reply to any issue and it joins the walk.')));
}

/* ------------------------------------------------------------------- Swaps */
function paintSwaps(host) {
  section(host, 'Swaps', esc('Trade it or give it away. No money changes hands: say what you’d take, or “free”.'));
  if (S.swaps === null) host.appendChild(el('p', 'note pad', esc('Checking the swap shelf…')));
  else if (!S.swaps.length) boardNote(host, 'No swaps up right now. Got something good that doesn’t fit?', S.swapsFailed);
  else grid(host, S.swaps, { name: 'swaps', meta: swapMeta, vote: 'I’d take this' });
  addRow(host, 'Post a swap', () => boards.compose({
    board: KEY, kind: 'swap', heading: 'Post a swap', title: 'What you have', titlePlaceholder: 'M crewneck, forest green',
    fields: [
      { key: 'want', label: 'What you’d take for it', placeholder: 'An L flannel, or free', max: 80 },
      { key: 'size', label: 'Size', placeholder: 'M, 32, 9', max: 12 },
    ],
    body: 'More', bodyPlaceholder: 'Condition, and when you can meet', place: 'Neighborhood', placePlaceholder: 'Old North End',
    notes: ['No money changes hands on a swap: a trade, or free to a good home.', 'A swap lasts three weeks. Delete it once it’s gone.'],
    cta: 'Post the swap',
  }));
}

/* -------------------------------------------------------------- Make a tee */
function paintTees(host) {
  const total = S.designsTotal || (S.designs ? S.designs.length : 0);
  section(host, 'Make a tee', esc((total ? total + ' Burlington designs by Stephen, and yours next. ' : 'Burlington designs by Stephen, and yours next. ') +
    'Tap one to see it on a model in the shop.'));
  if (!S.designs) {
    host.appendChild(el('p', 'note pad', esc(S.designsFailed ? 'The designs didn’t load. They’re all in the shop.' : 'Loading the designs…')));
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

/* Send in a design: the pitch here, the form in a sheet like every other
   post. One image of the artist's own work through the photo queue
   (category 'board', consent required), a name, a line, and how they'd be
   thanked: free shirts or store credit. There is no price, no payment and
   no cash option anywhere in it. */
const DESIGN_PITCH = 'One image of your own artwork, a name and a line about it. Stephen looks at every one. If he prints yours, he ships it, and you pick how you’re thanked: free shirts, or store credit in the shop. Nothing to pay, ever.';
function paintMake(host) {
  const tc = el('div', 'textcard gap');
  tc.dataset.k = 'send';
  tc.innerHTML = '<h3 class="serif">' + esc('Send in your design') + '</h3><p>' + esc(DESIGN_PITCH) + '</p>';
  const row = el('div', 'row');
  row.appendChild(button(ICON.plus + ' ' + esc('Send in your design'), '', designSheet));
  tc.appendChild(row);
  host.appendChild(tc);
}

function designSheet() {
  app.sheet('Send in your design', (body, card, close) => {
    if (!app.user()) { signInNote(body); return; }
    body.appendChild(el('p', 'sheet-note', esc(DESIGN_PITCH)));
    body.appendChild(photoForm({
      kind: 'design', pick: 'Choose your design', titleLabel: 'What’s it called?', titlePlaceholder: 'Rainy Church Street',
      noteLabel: 'One line about it', notePlaceholder: 'Ink, drawn from the Leunig’s corner',
      consent: 'This is my own artwork, and the Brief may print it on shirts and show it in All Day and the newsletter. It’s checked before it shows.',
      choice: [['shirts', 'Free shirts'], ['credit', 'Store credit']], cta: 'Send it to Stephen',
      sent: 'Sent. Stephen looks at every design; it shows under Sent in once he has.', done: close,
    }));
  });
}

function paintSent(host) {
  if (!S.sent || !S.sent.length) return;
  host.appendChild(el('div', 'tdiv', '<span>' + esc('Sent in') + '</span><span class="s">' + esc('designs from neighbors, approved') + '</span>'));
  host.appendChild(el('div', 'spacer'));
  /* how the artist asked to be thanked is for Stephen, not the card (a
     design from before the kind carried it at the end of its body) */
  grid(host, S.sent, { name: 'sent', meta: noMeta, vote: 'I’d wear this', text: (t) => String(t || '').replace(/\s*Thanks in: [a-z ]+$/i, '') });
}

/* --------------------------------------------------------------- Fit check */
function paintFit(host) {
  section(host, 'Fit check', esc('Show off a find, or a tee from the shop. Newest first.'));
  if (S.fit === null) host.appendChild(el('p', 'note pad', esc('Loading the fits…')));
  else if (!S.fit.length) boardNote(host, 'No fit checks yet. Thrifted something great? Show it.', S.failed);
  else grid(host, S.fit, { name: 'fit', meta: noMeta, vote: 'Love this fit' });
  addRow(host, 'Post a fit check', fitSheet);
}

function signInNote(body) {
  body.appendChild(el('p', 'sheet-note', esc('Posting needs the email sign-in: one email, no password. Reading and voting never do.')));
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
      consent: 'I took this photo, and the Brief may show it in All Day and the newsletter. Photos are checked before they show.',
      cta: 'Post it', sent: 'Posted. It shows once Stephen has checked the photo.', done: close,
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

  const nameRow = row('Your first name', text('display_name', 32, 'Maya, or Maya R.'), false, 'Neighbors see it on your post. Asked once.');
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
/* The Art tab's "Put it on a shirt" lands here as #vintage/b-<art post id>
   (post ids are uuids, so it never matches a Vintage post). Only posts
   whose maker ticked the shirt box carry that button, so only those are
   looked up: up to three pages of the Art wall's shirt-yes posts. */
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
    body.appendChild(el('p', 'sheet-note', esc((p.author || 'The maker') + ' said yes to a shirt. Stephen picks neighbors’ art for the shop and prints it; the maker gets free shirts or store credit, never cash. Votes on the Art wall put it at the top of his list.')));
    const links = el('div', 'linkrow');
    links.appendChild(button('Vote for it on the Art wall', '', () => app.go('art', 'b-' + p.id)));
    links.appendChild(outLink('Browse the shop', SHOP_URL));
    body.appendChild(links);
  });
}

/* -------------------------------------------------------------- deep links */
/* #vintage/spotted|shops|swaps|tees|fit jumps to a section; b-<id> is a
   post (or an Art post on its way to a shirt), s-<id> a shop, d-<id> a
   design. A key waits for its list to load. */
/* a find comes down when someone gets it or its three weeks end; an Art
   piece can be taken down by its maker: the words fit both */
const GONE = 'That post has gone.';
let route = 0;                // bumped on every landing and leaving, so a slow lookup never opens over the wrong page
function land() {
  if (!pending || !ready) return;
  const k = pending;
  if (SECTIONS.some(([s]) => s === k)) { pending = null; jump(k); return; }
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
  promise: 'Every vintage shop in town, what is on the racks this week, and tees designed by neighbors.',
  mount(r) {
    root = r;
    if (!app.demo) { ready = true; render(); loadLive(); return; }
    /* the demo is all local: draw once, with the demo boards seeded */
    r.innerHTML = '<p class="loading">Loading…</p>';
    demoFile().then((d) => {
      S.shops = d.shops || [];
      S.designs = d.designs || [];
      S.designsTotal = Number(d.designsTotal) || null;
      S.homesDemo = Number(d.homesThisMonth) || 0;
      return loadPosts();
    }).then(() => {
      ready = true;
      render();
      if (app.activeTab() === KEY) app.paintSubnav();
      land();
    }).catch(() => { r.innerHTML = '<div class="errbox"><b>The demo didn’t load.</b> Reload to try again.</div>'; });
  },
  activate(param) { route++; pending = param || null; land(); },
  refresh() { if (ready) SLOTS.forEach(paint); },
  deactivate() { route++; },
  subnav() {
    if (!ready) return null;
    const n = { spotted: S.spotted && S.spotted.length, shops: S.shops && S.shops.length, swaps: S.swaps && S.swaps.length, fit: S.fit && S.fit.length };
    return chips(SECTIONS.map(([key, label]) => ({ key, label, n: n[key] || null })), null, (k) => jump(k));
  },
  /* reader posts newer than the last visit: finds, swaps and fit checks */
  newSince(ts) {
    const t = Number(ts) * 1000 || 0;
    return [S.spotted, S.swaps, S.fit].reduce((a, l) => a + (l || []).filter((p) => Date.parse(p.created_at) > t).length, 0);
  },
});
