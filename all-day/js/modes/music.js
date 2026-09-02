/* music.js — the local scene: who is from here, and who is playing this week.

   Two halves behind one switch, because they are two different errands. The
   ARTISTS half is a directory of Burlington and Vermont acts. The MIXTAPE
   half is the song readers send in, which already had a home — playlist.html
   has been live since July with a Supabase backend, a moderation queue and
   votes, and it has collected zero approved submissions in seven weeks. The
   backend was never the problem. A seven-field form on a page nobody visits
   was. So the same RPCs are reused here, in the app people actually open,
   behind a form that asks for two things.

   WHAT PLAYS, AND WHAT ONLY LINKS. This is a licensing question, not a
   technical one, and the answer differs per service:

     · Rocket Shop sessions play in the app's own player. They are podcast
       enclosures from Big Heavy World's feed — audio published by RSS for
       exactly this, and a full hour of a Vermont band live in studio.
     · Bandcamp plays a whole track, free, to a logged-out visitor, in its
       own iframe. It is also where half this roster actually lives.
     · Spotify and Apple give a logged-out visitor thirty seconds, so they
       are links, not players. Apple's preview asset is licensed strictly as
       store promotion — badge, "courtesy of iTunes" attribution, no caching,
       no background listening — which is not what this tab is.
     · YouTube stays a visible, click-to-play grid. Its Required Minimum
         Functionality forbids a background player and forbids overlaying its
       controls, so it can never drive the dock player.

   The artist card does not carry the Bandcamp iframe. Thirty of them on one
   screen is thirty third-party iframes; the embed lives in the sheet, built
   when someone actually opens an artist.

   NO LOCAL SWITCH, deliberately. Every act on this tab is from Vermont — that
   is the entry requirement for the roster — so the app-wide Local/Everything
   control would have nothing to toggle. A switch that cannot change what you
   see is worse than no switch: it teaches people the control is decorative,
   on the one tab where it happens to be, and they carry that lesson to the
   tabs where it matters. The heading says "60 Vermont artists" instead. */

import * as store from './../store.js';
import * as data from './../wire.js';
import * as app from './../app.js';
import { el, esc, safeHref, rail, seg, chip, heading, shelfHead, scrollHint,
         voteBtn, paintVote, starBtn, tabStamp, stampOf, ICON } from './../ui.js';
import { hydrateVotes } from './../rows.js';

const SB_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
const SB_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3';

const state = {
  root: null,
  music: null,
  view: 'artists',      // 'artists' | 'calendar' | 'mixtape'
  genre: null,
  venue: null,          // a vid from calendar.venues, or null for all
  room: null,           // a bigrooms id when you are inside one room
  mixtape: null,        // null = not asked yet, [] = asked and empty
};

export function mount(root) {
  state.root = root;
  root.innerHTML = '<p class="loading">Warming up the room…</p>';
  data.load('music', (json) => { state.music = json; render(); }, () => {
    root.innerHTML = '';
    root.appendChild(el('div', 'errbox',
      '<b>Couldn’t reach the music.</b><br>The roster is rebuilt every morning.'));
  });
}

export function activate() {}
export function refresh() { if (state.music) render(); }
export function deactivate() { app.closePeek(); }

/* ------------------------------------------------------------------ parts */

const artists = () => (state.music && Array.isArray(state.music.artists)) ? state.music.artists : [];
const playingSoon = () => artists().filter((a) => a.shows && a.shows.length);

/* "Sat 6 Sep" — the calendar shorthand, not a timestamp. */
function showDay(iso) {
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return iso;
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const days = Math.round((d - today) / 86400000);
  if (days === 0) return 'Tonight';
  if (days === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const artOf = (a) => (a.bandcamp && a.bandcamp.art) || null;

function initials(name) {
  /* split on punctuation too, or "Roost.World" reads as a lone R */
  return name.replace(/^the\s+/i, '').split(/[\s._\-/&]+/).filter(Boolean)
    .slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
}

/* The square that leads every artist. Bandcamp cover art when there is one,
   and the initials on a tinted ground when there is not — a grey box reads as
   a broken image, which is the one thing a music page cannot look like. */
function cover(a, cls) {
  const art = artOf(a);
  if (art) {
    const img = el('img', cls);
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.alt = '';
    img.src = art;
    return img;
  }
  const box = el('span', cls + ' m-noart', esc(initials(a.name)));
  /* stable per artist, so the same band is the same colour every visit */
  let h = 0;
  for (let i = 0; i < a.name.length; i++) h = (h * 31 + a.name.charCodeAt(i)) % 360;
  box.style.setProperty('--hue', h);
  return box;
}

/* data-pk is the contract with the shell: it paints every button carrying one
   as play or pause when the audio state changes, so a button pressed inside a
   sheet answers immediately even though the dock is behind it. */
function sessionPlay(a) {
  if (!a.session || !a.session.audio) return null;
  const k = 'rs:' + a.id;
  const live = app.nowPlaying() === k && app.isPlaying();
  const b = el('button', 'm-play' + (live ? ' is-playing' : ''), live ? ICON.pause : ICON.play);
  b.dataset.pk = k;
  b.setAttribute('aria-label', 'Play the Rocket Shop session by ' + a.name);
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    app.toggleAudio({ src: a.session.audio, title: a.name + ' — Rocket Shop session',
                      show: 'Big Heavy World', art: artOf(a) || '', key: k,
                      href: a.session.url || '' });
  });
  return b;
}

/* ------------------------------------------------------------ artist sheet */

function openArtist(a) {
  /* Everything the sheet starts that outlives its own DOM gets unhooked here.
     The Bandcamp iframe is the reason: it is cross-origin, so it cannot be
     asked what it is doing or told to stop, and a hidden sheet that still
     holds one keeps playing underneath whatever you press next. */
  const teardown = [];
  app.sheet(a.name, (body) => {
    const head = el('div', 'm-sheet-head');
    head.append(cover(a, 'm-sheet-art'));
    const meta = el('div', 'm-sheet-meta');
    meta.appendChild(el('h3', null, esc(a.name)));
    const bits = [];
    if (a.genre) bits.push(esc(a.genre));
    if (a.threads >= 3) bits.push(a.threads + ' Reddit threads');
    if (bits.length) meta.appendChild(el('p', 'm-sheet-sub', bits.join(' · ')));
    head.appendChild(meta);
    body.appendChild(head);

    if (a.why) body.appendChild(el('p', 'm-why-big', esc(a.why)));

    if (a.shows && a.shows.length) {
      shelfHead(body, 'Playing', a.shows.length + (a.shows.length === 1 ? ' show' : ' shows') + ' coming up');
      const list = el('div', 'm-shows');
      a.shows.forEach((s) => {
        const row = el('a', 'm-show');
        row.href = safeHref(s.url);
        row.target = '_blank';
        row.rel = 'noopener';
        row.innerHTML =
          '<span class="m-show-when">' + esc(showDay(s.date)) + (s.time ? ' · ' + esc(s.time) : '') + '</span>' +
          '<span class="m-show-where">' + esc(s.venue || '') +
            (s.free ? ' · <b>Free</b>' : (s.price ? ' · ' + esc(s.price) : '')) + '</span>' +
          '<span class="m-show-what">' + esc(s.title || '') + '</span>';
        list.appendChild(row);
      });
      body.appendChild(list);
    }

    if (a.session && a.session.audio) {
      shelfHead(body, 'Live in studio', 'Rocket Shop Radio Hour · Big Heavy World');
      const row = el('div', 'm-session');
      const p = sessionPlay(a);
      const t = el('div', 'm-session-meta');
      t.appendChild(el('span', 'm-session-title', esc(a.session.title || 'Rocket Shop session')));
      if (a.session.date) t.appendChild(el('span', 'm-session-date', esc(a.session.date)));
      row.append(p, t);
      body.appendChild(row);
    }

    /* Bandcamp is built here and only here — one iframe, for the artist you
       actually opened. It plays a whole track to someone who is not logged in,
       which is the only embed on this page that does. */
    if (a.bandcamp && a.bandcamp.album) {
      shelfHead(body, 'Listen', (a.bandcamp.title ? esc(a.bandcamp.title) + ' · ' : '') +
        'a whole track, free — this one plays on Bandcamp, not in the app player');
      /* Bandcamp paints its own player, so it has to be told the theme or a
         white panel glares out of a dark sheet. Read the live state rather
         than the stored setting — 'auto' means whatever the phone is doing. */
      const dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
        (!document.documentElement.hasAttribute('data-theme') &&
          matchMedia('(prefers-color-scheme: dark)').matches);
      const frame = el('iframe', 'm-bc');
      frame.src = 'https://bandcamp.com/EmbeddedPlayer/album=' + encodeURIComponent(a.bandcamp.album) +
                  '/size=large/bgcol=' + (dark ? '181a1f' : 'ffffff') +
                  '/linkcol=' + (dark ? 'e8a33d' : '9a5b00') +
                  '/artwork=small/transparent=true/';
      frame.setAttribute('seamless', '');
      frame.loading = 'lazy';
      frame.title = a.name + ' on Bandcamp';
      body.appendChild(frame);

      /* Reloading the frame is the only way to stop a player we do not own:
         there is no API, and postMessage is not answered. Registering it means
         starting a Rocket Shop session silences Bandcamp first. */
      teardown.push(app.registerForeign(() => {
        const src = frame.getAttribute('src');
        if (!src) return;
        frame.removeAttribute('src');
        frame.setAttribute('src', src);
      }));

      /* And the other direction, which has no event at all: a click inside a
         cross-origin iframe blurs the page and makes the frame the active
         element. It is the only signal Bandcamp gives that someone pressed
         its play button, and it is enough to get our own player out of the
         way. Worst case it pauses a session while you were only reading the
         track list — one tap to resume, against two songs at once. */
      const onBlur = () => { if (document.activeElement === frame) app.pauseAudio(); };
      window.addEventListener('blur', onBlur);
      teardown.push(() => window.removeEventListener('blur', onBlur));
    }

    const links = el('div', 'btns m-links');
    const LABEL = { bandcamp: 'Bandcamp', site: 'Website', instagram: 'Instagram',
                    spotify: 'Spotify', wikipedia: 'Wikipedia', session: 'Session',
                    soundcloud: 'SoundCloud',
                    /* the piece that put them on this roster — provenance a
                       reader can check, on a tab whose whole claim is that a
                       person chose these names */
                    sevendays: 'Seven Days' };
    Object.keys(a.links || {}).forEach((k) => {
      const href = a.links[k];
      if (!href) return;
      const btn = el('a', 'btn btn-quiet', esc(LABEL[k] || k));
      btn.href = safeHref(href);
      btn.target = '_blank';
      btn.rel = 'noopener';
      links.appendChild(btn);
    });
    if (links.childElementCount) body.appendChild(links);
  }, () => teardown.forEach((fn) => { try { fn(); } catch (e) { /* going away anyway */ } }));
}

/* ------------------------------------------------------------ artist cards */

/* The wide card, for the shelf of people playing this week. It leads with the
   show, because that is the reason to look at it. */
function gigCard(a) {
  const k = 'mus:' + a.id;
  const s = a.shows[0];
  const card = el('div', 'm-gig');
  card.dataset.k = k;

  const hit = el('button', 'm-gig-hit');
  hit.appendChild(cover(a, 'm-gig-art'));
  const b = el('span', 'm-gig-body');
  b.innerHTML =
    '<span class="m-gig-when">' + esc(showDay(s.date)) + '</span>' +
    '<span class="m-gig-name">' + esc(a.name) + '</span>' +
    '<span class="m-gig-where">' + esc(s.venue || '') +
      (s.free ? ' · Free' : (s.price ? ' · ' + esc(s.price) : '')) + '</span>';
  hit.appendChild(b);
  hit.addEventListener('click', () => openArtist(a));
  card.appendChild(hit);

  const foot = el('div', 'm-gig-foot');
  const play = sessionPlay(a);
  if (play) foot.appendChild(play);
  foot.appendChild(el('span', 'spacer'));
  foot.append(voteFor(a, k), saveFor(a, k));
  card.appendChild(foot);
  return card;
}

/* The dense row, for the directory. */
function artistRow(a) {
  const k = 'mus:' + a.id;
  const row = el('div', 'm-row');
  row.dataset.k = k;

  const hit = el('button', 'm-row-hit');
  hit.appendChild(cover(a, 'm-row-art'));
  const meta = el('span', 'm-row-meta');
  const tags = [];
  if (a.genre) tags.push(esc(a.genre));
  if (a.shows && a.shows.length) tags.push('<b class="m-soon">' + esc(showDay(a.shows[0].date)) + '</b>');
  meta.innerHTML =
    '<span class="m-row-name">' + esc(a.name) + '</span>' +
    '<span class="m-row-tags">' + tags.join(' · ') + '</span>' +
    (a.why ? '<span class="m-row-why">' + esc(a.why) + '</span>' : '');
  hit.appendChild(meta);
  hit.addEventListener('click', () => openArtist(a));
  row.appendChild(hit);

  const acts = el('div', 'm-row-acts');
  const play = sessionPlay(a);
  if (play) acts.appendChild(play);
  acts.append(voteFor(a, k), saveFor(a, k));
  row.appendChild(acts);
  return row;
}

function recordOf(a) {
  const links = a.links || {};   // the validator only checks the array shape
  return { k: 'mus:' + a.id, kind: 'artist', title: a.name,
           from: a.genre || 'Burlington music',
           href: links.bandcamp || links.site || links.instagram || '',
           art: artOf(a) || '' };
}

function voteFor(a, k) {
  const rec = recordOf(a);
  const v = voteBtn(store.voteCount(k), store.hasVoted(k), store.votesLive());
  v.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    paintVote(v, store.voteCount(k), store.toggleVote(rec));
  });
  return v;
}

function saveFor(a, k) {
  const rec = recordOf(a);
  const s = starBtn(store.isSaved(k));
  s.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    s.classList.toggle('on', store.toggleSaved(rec));
  });
  return s;
}

/* ----------------------------------------------------------------- render */

export function render() {
  const root = state.root;
  root.innerHTML = '';
  tabStamp(root, stampOf(state.music && state.music.generated), 'the roster, every morning');

  /* Two halves of one question — who is from here, and who is playing. The
     mixtape is a third thing and it is the smallest of the three, so it gets
     a way in rather than a third of the control. */
  root.appendChild(seg([['artists', 'Artists'], ['calendar', 'Venue calendar']],
    state.view === 'mixtape' ? '' : state.view,
    (v) => { state.view = v; state.room = null; render(); }));

  /* The jar, and the way into the mixtape. The mixtape is a third view but
     not a third of the control: it is the smallest thing on this tab and a
     segment would give it equal billing with the whole local scene. */
  const tools = el('div', 'm-tools');
  const mix = el('button', 'm-mixlink' + (state.view === 'mixtape' ? ' on' : ''),
    '\u{1F3B5} The mixtape');
  mix.addEventListener('click', () => { state.view = 'mixtape'; render(); });
  tools.append(mix, app.jarBtn('music'));
  root.appendChild(tools);

  if (state.view === 'mixtape') return renderMixtape(root);
  if (state.view === 'calendar') return renderCalendar(root);
  renderArtists(root);
}

/* --------------------------------------------------------------- calendar */
/* The rooms, as a list you can read down. Deliberately text and a date and
   nothing else: a show is a name, a night and a place, and a grid of posters
   is worse at all three.

   The window is sixty days because that is what the events pipeline actually
   holds, and because past it the calendar stops being the scene. At day 61
   the real inventory is Higher Ground and the Flynn and almost nothing else —
   the small rooms have not booked yet, and a longer view would print an empty
   October for Radio Bean as though it had closed. The two big rooms get their
   own calendars instead, at whatever horizon they publish. */

const cal = () => (state.music && state.music.calendar) || null;
const rooms = () => (state.music && Array.isArray(state.music.bigrooms)) ? state.music.bigrooms : [];

function dayHead(iso) {
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return iso;
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const days = Math.round((d - today) / 86400000);
  const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  if (days === 0) return 'Tonight';
  if (days === 1) return 'Tomorrow · ' + label;
  return label;
}

function showLine(e, opts) {
  const row = el(e.url ? 'a' : 'div', 'cal-row');
  if (e.url) { row.href = safeHref(e.url); row.target = '_blank'; row.rel = 'noopener'; }
  const when = e.time || '';
  const price = e.free ? '<b class="cal-free">Free</b>' : (e.price ? esc(e.price) : '');
  row.innerHTML =
    '<span class="cal-when">' + esc(when) + '</span>' +
    '<span class="cal-what">' +
      '<span class="cal-title">' + esc(e.title || '') + '</span>' +
      (opts && opts.hideVenue ? '' :
        '<span class="cal-where">' + esc(e.venue || '') + '</span>') +
      (e.through ? '<span class="cal-run">through ' + esc(dayHead(e.through)) + '</span>' : '') +
    '</span>' +
    (price ? '<span class="cal-price">' + price + '</span>' : '');
  return row;
}

/* One list, grouped by night. Days with nothing in them are simply absent —
   printing "no shows" for a Tuesday is noise, not information. */
function dayList(host, events, opts) {
  const byDay = new Map();
  events.forEach((e) => {
    const list = byDay.get(e.date) || [];
    list.push(e);
    byDay.set(e.date, list);
  });
  [...byDay.keys()].sort().forEach((date) => {
    host.appendChild(el('h4', 'cal-day', esc(dayHead(date))));
    const box = el('div', 'cal-day-rows');
    byDay.get(date).forEach((e) => box.appendChild(showLine(e, opts)));
    host.appendChild(box);
  });
  return byDay.size;
}

function renderRoom(root, room) {
  const back = el('button', 'cal-back', '\u2190 All venues');
  back.addEventListener('click', () => { state.room = null; render(); });
  root.appendChild(back);

  heading(root, {
    eyebrow: 'The full calendar',
    title: room.name,
    sub: room.events.length + (room.events.length === 1 ? ' show' : ' shows') +
      (room.far ? ' · announced through <span class="count">' + esc(dayHead(room.far)) + '</span>' : ''),
  });

  if (room.error || !room.events.length) {
    /* A room that failed to load must not read as a room with nothing on. */
    root.appendChild(el('p', 'errbox', room.error
      ? '<b>Couldn\u2019t reach ' + esc(room.name) + '.</b><br>Their own calendar is the one to trust today.'
      : '<b>Nothing listed yet.</b><br>Check their calendar directly.'));
  } else {
    const box = el('div', 'cal-list');
    dayList(box, room.events, { hideVenue: true });
    root.appendChild(box);
  }

  if (room.site) {
    const go = el('a', 'btn btn-quiet cal-site', esc(room.name) + '\u2019s own calendar ' + ICON.ext);
    go.href = safeHref(room.site);
    go.target = '_blank';
    go.rel = 'noopener';
    root.appendChild(go);
  }
}

function renderCalendar(root) {
  const c = cal();
  const big = rooms();

  if (state.room) {
    const room = big.find((r) => r.id === state.room);
    if (room) return renderRoom(root, room);
    state.room = null;
  }

  if (!c || !Array.isArray(c.events) || !c.events.length) {
    heading(root, { eyebrow: 'Who is playing', title: 'The venue calendar',
      sub: 'Every room we sweep, in one list.' });
    root.appendChild(el('p', 'empty',
      'The calendar is rebuilt every morning and has not landed yet. Try again shortly.'));
    return;
  }

  heading(root, {
    eyebrow: 'Who is playing',
    title: 'The venue calendar',
    sub: c.events.length + ' shows · <span class="count">the next ' +
      (c.window || 60) + ' days</span>',
  });

  /* The two biggest rooms, up top, because they are the two people actually
     look up by name — and because they are the only two that publish months
     ahead, which the combined list cannot show. */
  if (big.length) {
    const cards = el('div', 'cal-rooms');
    big.forEach((r) => {
      const b = el('button', 'cal-room');
      b.innerHTML =
        '<span class="cal-room-name">' + esc(r.name) + '</span>' +
        '<span class="cal-room-n">' + r.events.length + ' shows' +
          (r.far ? ' \u00b7 to ' + esc(dayHead(r.far)) : '') + '</span>';
      b.addEventListener('click', () => { state.room = r.id; render(); });
      cards.appendChild(b);
    });
    root.appendChild(cards);
  }

  const venues = Array.isArray(c.venues) ? c.venues : [];
  if (venues.length > 1) {
    const chips = el('div', 'chips');
    chips.appendChild(chip('Every room', !state.venue, () => { state.venue = null; render(); }));
    venues.forEach((v) => chips.appendChild(
      chip(esc(v.name) + ' <span class="n">' + v.n + '</span>', state.venue === v.id,
        () => { state.venue = state.venue === v.id ? null : v.id; render(); })));
    root.appendChild(chips);
    scrollHint(chips);
  }

  const list = state.venue ? c.events.filter((e) => e.vid === state.venue) : c.events;
  const box = el('div', 'cal-list');
  const days = dayList(box, list);
  shelfHead(root, state.venue
    ? (venues.find((v) => v.id === state.venue) || {}).name || 'That room'
    : 'Every room',
    list.length + (list.length === 1 ? ' show' : ' shows') +
      ' across ' + days + (days === 1 ? ' night' : ' nights'));
  root.appendChild(box);

  root.appendChild(el('p', 'm-credit',
    'Swept twice a day from the venues\u2019 own calendars. A room missing? ' +
    'Put it in the jar.'));
}

function renderArtists(root) {
  const all = artists();
  const soon = playingSoon();

  heading(root, {
    eyebrow: 'From around here',
    title: 'The local scene',
    sub: all.length + ' Vermont artists · <span class="count">' +
         soon.length + ' playing in the next few weeks</span>',
  });

  if (soon.length) {
    shelfHead(root, 'Playing soon', 'Tap for the date, the room and a listen');
    const { track, sync } = rail(root, { label: 'artists playing soon' });
    soon.forEach((a) => track.appendChild(gigCard(a)));
    sync();
  }

  /* Genre is the one control here. Everything else a reader might sort by —
     who is playing, who has a session, how loudly the city recommends them —
     is already on the card, which is where it belongs. */
  /* Ordered by how many artists carry them, not alphabetically: a chip row
     that opens with "alt-country, americana, bluegrass" buries punk and indie,
     which is what most of this roster actually is. */
  const counts = new Map();
  all.forEach((a) => { if (a.genre) counts.set(a.genre, (counts.get(a.genre) || 0) + 1); });
  const genres = [...counts.keys()].sort((x, y) => counts.get(y) - counts.get(x) || x.localeCompare(y));
  if (genres.length > 1) {
    const chips = el('div', 'chips');
    chips.appendChild(chip('All', !state.genre, () => { state.genre = null; render(); }));
    genres.forEach((g) => chips.appendChild(
      chip(esc(g) + ' <span class="n">' + counts.get(g) + '</span>', state.genre === g,
        () => { state.genre = state.genre === g ? null : g; render(); })));
    root.appendChild(chips);
    scrollHint(chips);
  }

  const list = state.genre ? all.filter((a) => a.genre === state.genre) : all;
  shelfHead(root, state.genre ? state.genre : 'Everyone',
    list.length + (list.length === 1 ? ' artist' : ' artists'));

  const holder = el('div', 'm-list');
  list.forEach((a) => holder.appendChild(artistRow(a)));
  root.appendChild(holder);

  if (!list.length) {
    root.appendChild(el('p', 'empty', 'Nobody in that genre yet.'));
  }

  root.appendChild(el('p', 'm-credit',
    'Sessions from the Rocket Shop Radio Hour, courtesy of ' +
    '<a href="https://bigheavyworld.com/" target="_blank" rel="noopener">Big Heavy World</a>. ' +
    'Missing someone? <a href="mailto:steve@btownbrief.com?subject=Add%20an%20artist%20to%20the%20Music%20tab">Tell us</a>.'));

  hydrateVotes(root, [...root.querySelectorAll('[data-k]')].map((n) => n.dataset.k));
}


/* ---------------------------------------------------------------- mixtape */
/* The reader-submitted side, on the tables playlist.html already created:
   btb_playlist_tracks / btb_playlist_votes, with submissions landing in a
   moderation queue. Rounds run a fortnight, keyed by the ISO week of the
   starting Monday and anchored to Monday 2026-01-05 — the same key the SQL
   validates, so this app and that page are looking at the same list. */

function isoWeekKeyOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));   // that week's Thursday
  const week1 = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return d.getFullYear() + '-W' + String(week).padStart(2, '0');
}

function periodKey() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const epoch = new Date(2026, 0, 5);                    // a Monday
  const weeks = Math.round((monday - epoch) / 604800000);
  if (((weeks % 2) + 2) % 2 !== 0) monday.setDate(monday.getDate() - 7);
  return isoWeekKeyOf(monday);
}

function rpc(fn, args) {
  return fetch(SB_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  }).then((r) => (r.ok ? r.text().then((t) => (t ? JSON.parse(t) : null)) : null))
    .catch(() => null);
}

function platform(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    if (h.includes('spotify')) return 'Spotify';
    if (h.includes('music.apple')) return 'Apple Music';
    if (h.includes('youtube') || h === 'youtu.be') return 'YouTube';
    if (h.includes('bandcamp')) return 'Bandcamp';
    if (h.includes('soundcloud')) return 'SoundCloud';
    if (h.includes('tidal')) return 'Tidal';
    return 'Listen';
  } catch (e) { return 'Listen'; }
}

function trackRow(t, live) {
  const row = el('div', 'm-track');
  const body = el('div', 'm-track-body');
  body.innerHTML =
    '<span class="m-track-song">' + esc(t.song || '') + '</span>' +
    '<span class="m-track-by">' + esc(t.artist || platform(t.url || '')) +
      (t.is_local ? ' <b class="m-local">Vermont</b>' : '') + '</span>' +
    (t.why ? '<span class="m-track-why">' + esc(t.why) + '</span>' : '') +
    (t.submitter ? '<span class="m-track-who">— ' + esc(t.submitter) + '</span>' : '');
  row.appendChild(body);

  const go = el('a', 'm-track-go', esc(platform(t.url || '')));
  go.href = safeHref(t.url);
  go.target = '_blank';
  go.rel = 'noopener';
  row.appendChild(go);

  if (live && t.id) {
    const voted = store.read('btb-playlist-voted', {}) || {};
    const b = el('button', 'vote' + (voted[t.id] ? ' on' : ''),
      ICON.up + '<span class="n">' + (t.votes || 0) + '</span>');
    b.setAttribute('aria-label', 'Upvote ' + (t.song || 'this track'));
    b.addEventListener('click', () => {
      if (voted[t.id]) return;
      voted[t.id] = 1;
      store.write('btb-playlist-voted', voted);
      b.classList.add('on');
      const n = b.querySelector('.n');
      if (n) n.textContent = (Number(n.textContent) || 0) + 1;
      rpc('btb_playlist_vote', { p_track: t.id, p_voter: store.playerId() });
    });
    row.appendChild(b);
  }
  return row;
}

function submitSheet() {
  app.sheet('Add a playlist', (body, close) => {
    body.appendChild(el('p', 'm-form-intro',
      'A whole playlist, not a single track — Spotify, Apple Music or YouTube. ' +
      'It goes on the wall once we have read it, usually within a day.'));
    const form = el('form', 'm-form');
    form.innerHTML =
      '<label>Playlist link' +
        '<input type="url" name="url" required maxlength="500" ' +
        'placeholder="A Spotify, Apple Music or YouTube playlist">' +
      '</label>' +
      '<label>What is it?' +
        '<input type="text" name="song" required maxlength="120" ' +
        'placeholder="Songs for a Lake Champlain sunset"></label>' +
      '<label class="m-form-check"><input type="checkbox" name="is_local"> Mostly Vermont artists</label>' +
      '<details><summary>Say why, and sign it</summary>' +
        '<label>Why this one<textarea name="why" maxlength="280" rows="2" placeholder="One or two sentences"></textarea></label>' +
        '<label>Your name<input type="text" name="submitter" maxlength="60" placeholder="First name is plenty"></label>' +
      '</details>' +
      '<p class="ph-form-note m-plerr" hidden></p>' +
      '<button class="btn btn-big" type="submit">Send it in</button>';

    /* A PLAYLIST link, not a track link. Checked before it is sent, because
       the wall is moderated by hand and a stray single spends that pass — and
       the message names the platform it saw rather than refusing generically. */
    const looksLikePlaylist = (u) => {
      let h, path, q;
      try {
        const parsed = new URL(u);
        h = parsed.hostname.replace(/^www\./, '');
        path = parsed.pathname; q = parsed.search;
      } catch (e) { return { ok: false, why: 'That does not look like a link.' }; }
      if (h.indexOf('spotify') !== -1) {
        return /\/playlist\//.test(path) ? { ok: true }
          : { ok: false, why: 'That is a Spotify link, but not a playlist — open the playlist and share that.' };
      }
      if (h.indexOf('music.apple') !== -1) {
        return /\/playlist\//.test(path) ? { ok: true }
          : { ok: false, why: 'That is an Apple Music link, but not a playlist.' };
      }
      if (h.indexOf('youtube') !== -1 || h === 'youtu.be') {
        return (/[?&]list=/.test(q) || /\/playlist/.test(path)) ? { ok: true }
          : { ok: false, why: 'That is a single YouTube video — share the playlist instead.' };
      }
      return { ok: false, why: 'Spotify, Apple Music or YouTube playlists, please.' };
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const btn = form.querySelector('button[type=submit]');
      const err = form.querySelector('.m-plerr');
      const check = looksLikePlaylist((f.get('url') || '').toString().trim());
      if (!check.ok) { err.textContent = check.why; err.hidden = false; return; }
      err.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Sending…';
      rpc('btb_playlist_submit', {
        p_song: (f.get('song') || '').toString().trim(),
        /* the row's `artist` column now carries the platform: the wall is
           playlists, so "who made it" is the submitter, not an artist */
        p_artist: platform((f.get('url') || '').toString().trim()),
        p_url: (f.get('url') || '').toString().trim(),
        p_why: (f.get('why') || '').toString().trim(),
        /* the SQL function's parameter is p_name (db/quick-wins.sql) —
           PostgREST resolves RPCs by named-argument set, so any other name
           404s and the submission silently never lands */
        p_name: (f.get('submitter') || '').toString().trim(),
        p_is_local: !!f.get('is_local'),
        p_week: periodKey(),
      }).then((ok) => {
        close();
        app.toast(ok === null ? 'That didn’t send — try again in a minute'
                              : 'Sent. Thanks — we’ll read it today.');
      });
    });
    body.appendChild(form);
  });
}

function renderMixtape(root) {
  heading(root, {
    eyebrow: 'Sent in by readers',
    title: 'The Burlington mixtape',
    sub: 'Playlists, not singles — what people here actually put on.',
  });

  const add = el('button', 'btn btn-big m-add', 'Add a playlist');
  add.addEventListener('click', submitSheet);
  root.appendChild(add);

  const holder = el('div', 'm-tracks');
  holder.appendChild(el('p', 'loading', 'Reading the wall…'));
  root.appendChild(holder);

  const paint = (rows) => {
    holder.innerHTML = '';
    const live = Array.isArray(rows);
    const list = (live && rows.length) ? rows : [];

    if (live && !rows.length) {
      /* The starter picks were single tracks, and the wall is playlists now —
         showing them would contradict the only thing the form asks for. An
         empty wall still must not read as broken, so the space says what goes
         here instead of sitting blank. */
      shelfHead(holder, 'Nothing on the wall yet', 'Be the first');
    } else if (live) {
      shelfHead(holder, 'This fortnight', rows.length + (rows.length === 1 ? ' song' : ' songs'));
    }

    if (!list.length) {
      holder.appendChild(el('p', 'm-mix-empty',
        'A playlist you actually listen to — the drive to Stowe, the walk down ' +
        'Church Street, closing shift at the bar. Spotify, Apple Music or ' +
        'YouTube. We read every one before it goes up.'));
      return;
    }
    list.forEach((t) => holder.appendChild(trackRow(t, live && !!t.id)));
  };

  /* the theme banner is committed to the repo, so it is always there even
     when the table is empty or unreachable. (The old playlist-page seeds in
     this file are dead since the #229 port — nothing renders them.) */
  data.fetchJSON('../data/playlist.json', 8000).then((j) => {
    if (j && j.theme && j.theme.title) {
      const b = el('div', 'm-theme');
      b.innerHTML = '<span class="eyebrow">This round’s theme</span>' +
        '<span class="m-theme-title">' + esc(j.theme.title) + '</span>' +
        (j.theme.sub ? '<p>' + esc(j.theme.sub) + '</p>' : '');
      root.insertBefore(b, add);
    }
    if (state.mixtape !== null) paint(state.mixtape);
  }).catch(() => {});

  rpc('btb_playlist_get', { p_week: periodKey() }).then((rows) => {
    state.mixtape = Array.isArray(rows) ? rows : [];
    paint(state.mixtape);
  });

  /* The wall's history — the top-voted pick of each earlier fortnight, off
     the same tables. This lived on playlist.html, now retired into this tab;
     rows from that page's single-track era render as "song — artist" and
     playlist-era rows as "name — platform", which is what each one is. */
  const past = el('div', 'm-winners');
  root.appendChild(past);
  rpc('btb_playlist_winners', { p_current: periodKey() }).then((rows) => {
    if (!Array.isArray(rows) || !rows.length) return;
    shelfHead(past, 'Past winners', 'the top pick of each round');
    rows.forEach((t) => {
      const row = el('div', 'm-track');
      const body = el('div', 'm-track-body');
      const votes = Number(t.votes) || 0;
      body.innerHTML =
        '<span class="m-track-song">🏆 ' + esc(t.song || '') + '</span>' +
        '<span class="m-track-by">' + esc(t.artist || platform(t.url || '')) +
          (t.is_local ? ' <b class="m-local">Vermont</b>' : '') + '</span>' +
        '<span class="m-track-who">' + votes + (votes === 1 ? ' vote' : ' votes') +
          (t.submitter ? ' — picked by ' + esc(t.submitter) : '') + '</span>';
      row.appendChild(body);
      const go = el('a', 'm-track-go', esc(platform(t.url || '')));
      go.href = safeHref(t.url);
      go.target = '_blank';
      go.rel = 'noopener';
      row.appendChild(go);
      past.appendChild(row);
    });
  });
}
