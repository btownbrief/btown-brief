/* onair-sports.js: On Air's Sports side (Stephen, 2026-10-22: "I love the
   NBA ... the only stuff that matters is like the clips and like the
   highlights ... easily link the highlights to upcoming games"; "NBA first,
   then NFL, I don't really care about the other ones"; and local hoops:
   UVM men and women, the ABA teams, the leagues you can join, his Wednesday
   pickup).

   One small pill picks the league: NBA | NFL | Local hoops. Top to bottom:
     NBA / NFL
       Games       tonight's (or the next day with games), then the last
                   night's (the last week's, for the NFL) results, each with
                   "Highlights" when the league's own channel has posted that
                   game, then "Coming up" in an All N list
       Highlights  the nightly recap or the week's top plays first, full
                   width, then every game's full highlights as rows; they play
                   in On Air's own player, one after the next
       Starting 5  the NBA's daily newsletter: today's edition, its five
                   stories, and a link to read it on NBA.com (NBA only)
       From X      Grok's Sports recap bullets for the league, read from the
                   Wire's own wire-today.json (never a second pipeline);
                   credited to X, never "AI"
       On Reddit   r/nba or r/nfl, the day's top posts
       Headlines   the Wire's sports lane for the league
     Local hoops
       UVM basketball (men's and women's next games and last results), the
       ABA teams (Burlington Revolution, Vermont Coyotes), and Play
       basketball: Stephen's Wednesday pickup first, then the leagues and
       pickup nights, and the People tab's whole list.

   Data: all-day/data/onair-sports.json (scripts/gather_onair_sports.py,
   every three hours) and the Wire's wire-today.json. modes/onair.js owns the
   side, the switch, the player and the "All N" lists, and hands this file a
   ctx through init(). Nothing here has a colour of its own: a team's dot
   takes ESPN's team colour as a custom property. */

import * as app from '../app.js';
import { el, esc, safeHref, ICON, divider, agoShort } from '../ui.js';
import { recapsOf } from './wire-recaps.js';

export const LEAGUES = [['nba', 'NBA'], ['nfl', 'NFL'], ['hoops', 'Local hoops']];
const SHOW = { games: 4, coming: 4, hl: 5, x: 5, reddit: 5, news: 5, play: 6 };
const STARTING5 = 'https://www.nba.com/starting5';
const UVM_SCHEDULE = { m: 'https://uvmathletics.com/sports/mens-basketball/schedule', w: 'https://uvmathletics.com/sports/womens-basketball/schedule' };
const PEOPLE_CLUBS = '#people/groups';
const ALL_SPORTS = '../sports.html';
const HEX = /^[0-9a-f]{6}$/i;
const ID = /^[A-Za-z0-9_-]{11}$/;
const arr = (v) => (Array.isArray(v) ? v : []);
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const https = (u) => /^https:\/\/[^\s"'<>]+$/.test(String(u || ''));

let ctx = null;
/* ctx, from modes/onair.js:
     sec(host, title, sub, key)       a section head with data-sec
     openable(host, key, label, list, show, make, cls)   N rows and "All N"
     row(it, list), feature(it, list) On Air's two video shapes
     openPlayer(list, at, title)      the player sheet
     todayKey(), etDay(ms), addDays(day, n), weekday(day), clock(ms) */
export function init(c) { ctx = c; }

/* ---------------------------------------------------------------- shapes */
const k = {
  game: (lg, g) => 'sp:' + lg + ':g' + g.id,
  clip: (c) => 'yt:' + c.id,
};
const dayLabel = (day) => (day === ctx.todayKey() ? 'Today' : day === ctx.addDays(ctx.todayKey(), 1) ? 'Tomorrow' :
  day === ctx.addDays(ctx.todayKey(), -1) ? 'Yesterday' : ctx.weekday(day));
const shortDay = (day) => { const [, m, d] = day.split('-').map(Number); return ctx.weekday(day).slice(0, 3) + ', ' + ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'][m - 1] + ' ' + d; };

/* a highlight as On Air's video item: it plays in the player, Next follows */
function clipItem(c, lg) {
  if (!c || !ID.test(String(c.id)) || !c.t) return null;
  const sec = Math.max(0, Math.round(Number(c.sec) || 0));
  return {
    k: k.clip(c), kind: 'video', yt: c.id, title: String(c.t).slice(0, 140), src: String(c.ch || lg.toUpperCase()).slice(0, 40), sid: 'yt:' + lg,
    href: 'https://www.youtube.com/watch?v=' + c.id,
    media: app.demo && c.art ? String(c.art) : 'https://i.ytimg.com/vi/' + c.id + '/hqdefault.jpg',
    dur: String(c.dur || ''), sec, len: '', why: '', via: '', viaUrl: '', ago: Number(c.d) ? agoShort(Number(c.d)) : '', d: Number(c.d) || 0,
    sport: lg, game: String(c.game || ''), clipKind: c.kind,
  };
}
const clipsOf = (S, lg) => arr(S && S.leagues && S.leagues[lg] && S.leagues[lg].clips).map((c) => clipItem(c, lg)).filter(Boolean);
const gamesOf = (S, lg) => arr(S && S.leagues && S.leagues[lg] && S.leagues[lg].games)
  .filter((g) => g && g.id && g.away && g.home && /^\d{4}-\d{2}-\d{2}$/.test(String(g.day)) && Number(g.start))
  .sort((a, b) => a.start - b.start);

/* ----------------------------------------------------------------- games */
function team(t, done) {
  const dot = HEX.test(String(t.color || '')) ? ' style="--tc:#' + t.color + '"' : '';
  return '<span class="sp-team' + (done && t.win ? ' won' : '') + '"><i class="sp-dot"' + dot + '></i><span class="sp-nick">' + esc(t.nick || t.name) + '</span>' +
    (done && t.score !== '' && t.score != null ? '<b class="sp-score">' + esc(t.score) + '</b>' : '') + '</span>';
}
function gameRow(g, lg, hl) {
  const done = g.state === 'post';
  const live = g.state === 'in';
  const a = el('article', 'sp-game' + (live ? ' live' : ''));
  a.dataset.k = k.game(lg, g);
  const when = done ? 'Final' : live ? (g.detail || 'Live') : ctx.clock(g.start * 1000);
  const meta = [g.day !== ctx.todayKey() && !done ? dayLabel(g.day) : '', when, arr(g.tv).join(', ')].filter(Boolean).join(' · ');
  const clip = hl && hl.find((c) => c.yt === g.hl);
  a.innerHTML = '<div class="sp-match">' + team(g.away, done || live) + '<span class="sp-at">' + (g.neutral ? 'vs' : '@') + '</span>' + team(g.home, done || live) + '</div>' +
    '<div class="sp-gfoot"><span class="s">' + (live ? '<span class="tag tag-live">Live</span> ' : '') + esc(meta) + '</span>' +
    (clip ? '<button type="button" class="pillbtn sp-hl" data-hl="' + esc(clip.k) + '" aria-label="Watch the highlights of ' + esc(g.away.nick + ' at ' + g.home.nick) + '">' + ICON.play + ' Highlights</button>' : '') +
    (https(g.url) ? '<a class="sp-box" href="' + esc(safeHref(g.url)) + '" target="_blank" rel="noopener" aria-label="' + esc(g.away.nick + ' at ' + g.home.nick) + ' on ESPN">ESPN ' + ICON.ext + '</a>' : '') + '</div>';
  return a;
}

function drawGames(host, S, lg, hl) {
  const games = gamesOf(S, lg);
  if (!games.length) return false;
  const today = ctx.todayKey();
  const now = games.filter((g) => g.day === today);
  const past = games.filter((g) => g.day < today && g.state === 'post');
  const later = games.filter((g) => g.day > today && g.state !== 'post');
  /* the last results: the NBA's last night with games, the NFL's last week */
  let last = [];
  let lastTitle = '';
  if (past.length) {
    /* newest first: the late games, Sunday night, then back */
    const end = past[past.length - 1];
    if (lg === 'nfl' && end.week) {
      last = past.filter((g) => g.week === end.week);
      lastTitle = 'Week ' + end.week + ' results';
    } else {
      last = past.filter((g) => g.day === end.day);
      lastTitle = end.day === ctx.addDays(today, -1) ? 'Last night' : dayLabel(end.day);
    }
  }
  last = last.slice().reverse();
  const head = now.length ? 'Tonight' : later.length ? 'Next up · ' + dayLabel(later[0].day) : lastTitle;
  const h = ctx.sec(host, head, now.length ? plural(now.length, 'game', 'games') : '', 'sp-games');
  h.dataset.openHead = 'sp:' + lg + ':' + (now.length ? 'now' : later.length ? 'next' : 'last');
  const make = (g) => gameRow(g, lg, hl);
  if (now.length) ctx.openable(host, 'sp:' + lg + ':now', 'Tonight', now, 8, make, 'sp-games');
  else if (later.length) {
    const first = later.filter((g) => g.day === later[0].day);
    ctx.openable(host, 'sp:' + lg + ':next', 'Next up', first, SHOW.games, make, 'sp-games');
  }
  if (last.length && (now.length || later.length)) {
    const d = divider(host, lastTitle);
    d.dataset.openHead = 'sp:' + lg + ':last';
    ctx.openable(host, 'sp:' + lg + ':last', lastTitle, last, SHOW.games, make, 'sp-games');
  } else if (last.length) {
    ctx.openable(host, 'sp:' + lg + ':last', lastTitle, last, SHOW.games, make, 'sp-games');
  }
  return true;
}

/* the rest of the week, after the highlights: the games not shown above */
function drawComing(host, S, lg, hl) {
  const games = gamesOf(S, lg);
  const today = ctx.todayKey();
  const later = games.filter((g) => g.day > today && g.state !== 'post');
  const now = games.some((g) => g.day === today);
  const coming = now ? later : later.filter((g) => g.day !== (later[0] || {}).day);
  if (!coming.length) return false;
  const h = ctx.sec(host, 'Coming up', plural(coming.length, 'game', 'games'), 'sp-coming');
  h.dataset.openHead = 'sp:' + lg + ':coming';
  ctx.openable(host, 'sp:' + lg + ':coming', 'Coming up', coming, SHOW.coming, (g) => gameRow(g, lg, hl), 'sp-games');
  return true;
}

/* ------------------------------------------------------------ highlights */
function drawHighlights(host, S, lg, list) {
  if (!list.length) return false;
  ctx.sec(host, 'Highlights', '', 'sp-hl');
  /* the night's (or week's) whole story first, full width; then the games */
  const lead = list.find((it) => it.clipKind === 'recap') || list.find((it) => it.clipKind === 'top');
  const rest = list.filter((it) => it !== lead);
  const order = lead ? [lead].concat(rest) : rest;
  if (lead) host.appendChild(ctx.feature(lead, order));
  if (rest.length) ctx.openable(host, 'sp:' + lg + ':hl', 'Highlights', rest, SHOW.hl, (it) => ctx.row(it, order), 'oa-rows');
  app.know(order);
  return true;
}

/* ----------------------------------------------------------- Starting 5 */
function drawStarting5(host, S) {
  const e = S && S.leagues && S.leagues.nba && S.leagues.nba.starting5;
  if (!e || !https(e.url) || !e.t) return false;
  const day = Number(e.d) ? ctx.etDay(e.d * 1000) : '';
  if (day && day < ctx.addDays(ctx.todayKey(), -2)) return false;
  ctx.sec(host, 'Starting 5', day ? (day === ctx.todayKey() ? 'Today' : dayLabel(day)) : '', 'sp-s5');
  const box = el('article', 'sp-s5');
  const stories = arr(e.stories).filter((s) => typeof s === 'string' && s).slice(0, 5);
  box.innerHTML = '<a class="sp-s5t" href="' + esc(safeHref(e.url)) + '" target="_blank" rel="noopener">' + esc(String(e.t).replace(/^Starting 5:\s*/, '')) + '</a>' +
    (stories.length ? '<ol class="sp-s5l">' + stories.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>' : '') +
    '<div class="sp-links"><a class="btn sm" href="' + esc(safeHref(e.url)) + '" target="_blank" rel="noopener">Read it on NBA.com ' + ICON.ext + '</a>' +
    '<a class="btn ghost sm" href="' + STARTING5 + '" target="_blank" rel="noopener">Get it by email ' + ICON.ext + '</a></div>';
  host.appendChild(box);
  return true;
}

/* ---------------------------------------------------------------- From X */
function xBullets(today, lg) {
  const recaps = recapsOf(today).filter((r) => r.kind === 'sports');
  const seen = new Set();
  const out = [];
  recaps.forEach((r) => r.bullets.forEach((b) => {
    if (b.sport !== lg.toUpperCase() || seen.has(b.id || b.url)) return;
    seen.add(b.id || b.url);
    out.push({ ...b, at: r.at });
  }));
  return out;
}
function linkRow(o) {
  const a = el('a', 'sp-link');
  a.href = safeHref(o.url);
  a.target = '_blank';
  a.rel = 'noopener';
  a.innerHTML = (o.tag ? '<span class="sp-tag">' + esc(o.tag) + '</span>' : '') + '<span class="sp-lt">' + esc(o.text) + '</span>' +
    (o.meta ? '<span class="s">' + esc(o.meta) + '</span>' : '');
  if (o.out) {
    const w = el('div', 'sp-linkrow');
    w.appendChild(a);
    const c = el('a', 'pillbtn sp-out', 'Clip ' + ICON.ext);
    c.href = safeHref(o.out);
    c.target = '_blank';
    c.rel = 'noopener';
    c.setAttribute('aria-label', 'The clip: ' + o.text);
    w.appendChild(c);
    return w;
  }
  return a;
}
function drawX(host, today, lg) {
  const list = xBullets(today, lg);
  if (!list.length) return false;
  const at = Math.max(...list.map((b) => b.at || 0));
  ctx.sec(host, 'From X', at ? ctx.clock(at) : '', 'sp-x');
  ctx.openable(host, 'sp:' + lg + ':x', 'From X', list, SHOW.x, (b) => linkRow({ url: b.url, text: b.text, meta: b.note }), 'sp-links-list');
  return true;
}

/* ------------------------------------------------------------- On Reddit */
const big = (n) => (n >= 1000 ? (Math.round(n / 100) / 10) + 'k' : String(n));
function drawReddit(host, S, lg) {
  const L = S && S.leagues && S.leagues[lg];
  const list = arr(L && L.reddit).filter((p) => p && p.t && https(p.url) && /^https:\/\/www\.reddit\.com\/r\//.test(p.url));
  if (!list.length) return false;
  ctx.sec(host, 'On r/' + lg, '', 'sp-reddit');
  ctx.openable(host, 'sp:' + lg + ':reddit', 'r/' + lg, list, SHOW.reddit, (p) => linkRow({
    url: p.url, text: p.t, tag: p.flair || '', out: https(p.out) ? p.out : '',
    meta: [Number.isInteger(p.score) ? big(p.score) + ' upvotes' : '', Number.isInteger(p.comments) ? big(p.comments) + ' comments' : ''].filter(Boolean).join(' · '),
  }), 'sp-links-list');
  return true;
}

/* ------------------------------------------------------------- Headlines */
function drawNews(host, today, lg) {
  const lane = today && today.sports && typeof today.sports === 'object' ? arr(today.sports[lg]) : [];
  const list = lane.filter((it) => it && it.title && https(it.url)).sort((a, b) => (Date.parse(b.posted_at) || 0) - (Date.parse(a.posted_at) || 0));
  if (!list.length) return false;
  ctx.sec(host, 'Headlines', '', 'sp-news');
  ctx.openable(host, 'sp:' + lg + ':news', 'Headlines', list, SHOW.news, (it) => linkRow({
    url: it.url, text: it.title, meta: [it.name, Date.parse(it.posted_at) ? agoShort(Date.parse(it.posted_at) / 1000) : ''].filter(Boolean).join(' · '),
  }), 'sp-links-list');
  return true;
}

/* ----------------------------------------------------------- Local hoops */
function uvmRow(g) {
  const a = el('a', 'sp-link sp-uvm');
  a.href = safeHref(https(g.url) ? g.url : UVM_SCHEDULE[g.side]);
  a.target = '_blank';
  a.rel = 'noopener';
  const done = !!g.result;
  const when = shortDay(g.day) + (g.start && !done ? ' · ' + ctx.clock(g.start * 1000) : '');
  a.innerHTML = (done ? '<span class="sp-tag' + (g.result === 'W' ? ' win' : '') + '">' + esc(g.result + ' ' + (g.score || '')) + '</span>' : '') +
    '<span class="sp-lt">' + esc(g.t) + '</span><span class="s">' + esc([when, g.tv || ''].filter(Boolean).join(' · ')) + '</span>';
  return a;
}
function drawUVM(host, L) {
  const games = arr(L && L.uvm).filter((g) => g && g.t && /^\d{4}-\d{2}-\d{2}$/.test(String(g.day)) && (g.side === 'm' || g.side === 'w'));
  if (!games.length) return false;
  ctx.sec(host, 'UVM basketball', '', 'sp-uvm');
  const today = ctx.todayKey();
  [['m', 'Men'], ['w', 'Women']].forEach(([side, label]) => {
    const mine = games.filter((g) => g.side === side);
    const last = mine.filter((g) => g.result).slice(-1);
    const next = mine.filter((g) => !g.result && g.day >= today).slice(0, 2);
    if (!last.length && !next.length) return;
    divider(host, label);
    const box = el('div', 'sp-links-list');
    last.concat(next).forEach((g) => box.appendChild(uvmRow(g)));
    host.appendChild(box);
    const all = el('a', 'sp-more', 'Full schedule ' + ICON.ext);
    all.href = UVM_SCHEDULE[side];
    all.target = '_blank';
    all.rel = 'noopener';
    host.appendChild(all);
  });
  return true;
}
function drawTeams(host, L) {
  const teams = arr(L && L.teams).filter((t) => t && t.name && https(t.url));
  if (!teams.length) return false;
  ctx.sec(host, 'The pros', '', 'sp-teams');
  const today = ctx.todayKey();
  teams.forEach((t) => {
    const c = el('article', 'sp-card');
    const g = arr(t.games).find((x) => x && String(x.date) >= today);
    const next = g ? 'Next: ' + shortDay(g.date) + (g.time ? ', ' + g.time : '') + ' ' + (g.home ? 'vs ' : 'at ') + g.vs : (t.note || '');
    c.innerHTML = '<h3 class="t">' + esc(t.name) + '</h3><p class="s">' + esc([t.league, t.where].filter(Boolean).join(' · ')) + '</p>' +
      (next ? '<p class="sp-next">' + esc(next) + '</p>' : '') +
      '<div class="sp-links"><a class="btn ghost sm" href="' + esc(safeHref(t.url)) + '" target="_blank" rel="noopener">Schedule ' + ICON.ext + '</a>' +
      (https(t.watch) ? '<a class="btn ghost sm" href="' + esc(safeHref(t.watch)) + '" target="_blank" rel="noopener">Watch ' + ICON.ext + '</a>' : '') + '</div>';
    host.appendChild(c);
  });
  return true;
}
function drawPlay(host, L) {
  const p = L && L.pickup;
  const play = arr(L && L.play).filter((x) => x && x.name && /^https?:\/\//.test(String(x.url || '')));
  if (!p && !play.length) return false;
  ctx.sec(host, 'Play basketball', '', 'sp-play');
  if (p && https(p.url)) {
    const nxt = p.next && Number(p.next.start) && https(p.next.url) ? p.next : null;
    const c = el('article', 'sp-card sp-ours');
    c.innerHTML = '<h3 class="t">' + esc(p.name || 'Btown Brief pickup') + '</h3><p class="s">' + esc([p.when, p.where].filter(Boolean).join(' · ')) + '</p>' +
      (nxt ? '<p class="sp-next">Next: ' + esc(shortDay(ctx.etDay(nxt.start * 1000)) + ', ' + ctx.clock(nxt.start * 1000)) + '</p>' : '') +
      '<div class="sp-links"><a class="btn sm" href="' + esc(safeHref(nxt ? nxt.url : p.url)) + '" target="_blank" rel="noopener">Join on Meetup ' + ICON.ext + '</a></div>';
    host.appendChild(c);
  }
  if (play.length) {
    ctx.openable(host, 'sp:hoops:play', 'Play basketball', play, SHOW.play, (x) => linkRow({
      url: x.url, text: x.name, meta: [x.when, x.where, x.cost].filter(Boolean).join(' · '),
    }), 'sp-links-list');
  }
  const out = el('div', 'sp-links pad');
  out.innerHTML = '<a class="btn sp-people" href="' + PEOPLE_CLUBS + '">' + ICON.people + ' Every club and league in town</a>' +
    '<a class="btn ghost sm" href="' + ALL_SPORTS + '">All Burlington sports ' + ICON.ext + '</a>';
  host.appendChild(out);
  return true;
}

/* ------------------------------------------------------------------ draw */
/* host: the side's slot. S: onair-sports.json or null; today: the Wire's
   wire-today.json or null. Returns whether anything was drawn. */
export function draw(host, lg, S, today) {
  host.innerHTML = '';
  if (lg === 'hoops') {
    const L = S && S.local;
    const any = [drawUVM, drawTeams, drawPlay].map((f) => f(host, L)).some(Boolean);
    return any;
  }
  const hl = clipsOf(S, lg);
  const parts = [
    drawGames(host, S, lg, hl),
    drawHighlights(host, S, lg, hl),
    lg === 'nba' ? drawStarting5(host, S) : false,
    drawX(host, today, lg),
    drawReddit(host, S, lg),
    drawComing(host, S, lg, hl),
    drawNews(host, today, lg),
  ];
  return parts.some(Boolean);
}

/* a game's Highlights button: that game's clip in the player, then the rest */
export function onClick(e, S) {
  const b = e.target.closest('[data-hl]');
  if (!b) return false;
  e.preventDefault();
  const row = b.closest('[data-k]');
  const lg = row ? String(row.dataset.k).split(':')[1] : 'nba';
  const list = clipsOf(S, lg).filter((it) => it.clipKind === 'game');
  const at = list.findIndex((it) => it.k === b.dataset.hl);
  if (at < 0) return true;
  app.know(list);
  ctx.openPlayer(list, at, 'Highlights');
  return true;
}

/* everything a deep link might name: the clips, for app.item */
export function items(S) {
  return ['nba', 'nfl'].flatMap((lg) => clipsOf(S, lg));
}
