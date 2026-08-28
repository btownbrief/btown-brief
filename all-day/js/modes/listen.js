/* modes/listen.js — the shows.

   Podcasts ride the same wire as the headlines: sources flagged pod:1, items
   carrying an audio enclosure. Adding a feed to the Inoreader Podcasts folder
   makes it appear here on its own — no roster file to maintain.

   Three things this has that listen.html never did, all of them the point of
   putting it in a shell:

     · Playback survives leaving the tab, because the audio element belongs to
       the app, not to this page.
     · Every episode remembers where you stopped.
     · The lock screen works.

   Note the filter on `a`: some pod-flagged sources also publish articles on
   the same feed, and those belong on the wire, not in a show. */

import { get } from '../wire.js';
import * as store from '../store.js';
import { esc, safeUrl, agoLong, ago } from '../ui.js';

const FIRST_EPISODES = 3;
const MORE_EPISODES = 12;

let root = null;
let ctx = null;
let shows = [];
let expanded = {};
let state = { q: '', ready: false };

export default {
  mount(el, context) {
    root = el;
    ctx = context;

    root.innerHTML =
      '<div class="wrap">' +
        '<div class="page-head">' +
          '<h1>In your ears</h1>' +
          '<p class="sub" id="ls-sub">Tuning in…</p>' +
        '</div>' +
        '<div class="searchwrap" id="ls-searchwrap" hidden>' +
          '<input class="searchbox" id="ls-search" type="search" placeholder="Search shows and episodes" autocomplete="off">' +
        '</div>' +
        '<div id="ls-body"><p class="loading">Tuning in…</p></div>' +
      '</div>';

    const search = root.querySelector('#ls-search');
    let t = 0;
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { state.q = search.value.trim().toLowerCase(); render(); }, 130);
    });

    root.querySelector('#ls-body').addEventListener('click', onClick);

    // Repaint the playing row whenever the shell's player changes.
    ctx.player.onChange(() => paintPlaying());

    get('pulse')
      .then((res) => {
        build(res.data);
        state.ready = true;
        render();
      })
      .catch(() => {
        root.querySelector('#ls-body').innerHTML =
          '<div class="empty"><b>Couldn\'t reach the wire</b>Try a refresh.</div>';
      });
  },

  focusSearch() {
    const w = root.querySelector('#ls-searchwrap');
    w.hidden = !w.hidden;
    if (!w.hidden) root.querySelector('#ls-search').focus();
  },
};

function build(data) {
  const pods = (data.sources || []).filter((s) => s.pod);
  const byId = {};
  pods.forEach((s) => { byId[s.id] = { src: s, eps: [] }; });

  (data.items || []).forEach((it) => {
    if (!it.a) return;             // an article on a podcast feed is not an episode
    const show = byId[it.s];
    if (show) show.eps.push(it);
  });

  shows = Object.values(byId)
    .filter((s) => s.eps.length)
    .map((s) => {
      s.eps.sort((a, b) => b.d - a.d);
      s.latest = s.eps[0].d;
      const withArt = s.eps.find((e) => e.i);
      s.art = withArt ? safeUrl(withArt.i) : '';
      s.local = !!s.src.local;
      return s;
    })
    // Freshest show first, silent feeds last.
    .sort((a, b) => b.latest - a.latest);
}

function matches(show) {
  if (!state.q) return true;
  if ((show.src.name || '').toLowerCase().indexOf(state.q) >= 0) return true;
  return show.eps.some((e) => (e.t || '').toLowerCase().indexOf(state.q) >= 0);
}

function render() {
  if (!state.ready) return;
  const list = shows.filter(matches);
  const locals = list.filter((s) => s.local);
  const nationals = list.filter((s) => !s.local);

  root.querySelector('#ls-sub').textContent =
    shows.length + ' shows · ' + shows.reduce((n, s) => n + s.eps.length, 0) +
    ' episodes · freshest first';

  let html = '';
  if (!list.length) {
    html = '<div class="empty"><b>No shows match that</b>Try fewer words.</div>';
  } else {
    if (locals.length) {
      html += '<h2 class="sec">From here</h2><div class="pods">' +
        locals.map(showHTML).join('') + '</div>';
    }
    if (nationals.length) {
      html += '<h2 class="sec">Further afield</h2><div class="pods">' +
        nationals.map(showHTML).join('') + '</div>';
    }
  }
  root.querySelector('#ls-body').innerHTML = html;
  paintPlaying();
}

function showHTML(show) {
  const s = show.src;
  const shown = expanded[s.id] ? show.eps.slice(0, MORE_EPISODES) : show.eps.slice(0, FIRST_EPISODES);
  const left = show.eps.length - shown.length;
  const site = safeUrl(s.site);

  return '<article class="pod card" data-show="' + esc(s.id) + '">' +
    '<header class="pod-head">' +
      (show.art
        ? '<img class="pod-art" src="' + esc(show.art) + '" alt="" loading="lazy" decoding="async">'
        : '<span class="pod-art">🎙</span>') +
      '<div class="pod-id">' +
        '<h3 class="pod-name">' + esc(s.short || s.name) + '</h3>' +
        '<p class="pod-meta">' + show.eps.length + ' episode' + (show.eps.length === 1 ? '' : 's') +
          ' · latest ' + esc(agoLong(show.latest)) + '</p>' +
      '</div>' +
      (site ? '<a class="pod-site" href="' + esc(site) + '" target="_blank" rel="noopener" ' +
        'aria-label="Show site">↗</a>' : '') +
    '</header>' +
    '<ol class="pod-eps">' + shown.map((e) => epHTML(e, show)).join('') + '</ol>' +
    (left > 0
      ? '<button class="pod-more" data-expand="' + esc(s.id) + '">' + left + ' older episode' +
        (left === 1 ? '' : 's') + ' ↓</button>'
      : '') +
  '</article>';
}

function epHTML(e, show) {
  const audio = safeUrl(e.a);
  const k = store.keyOf(e.a);
  ctx.index(k, { k, kind: 'episode', t: e.t, u: e.u || e.a, s: show.src.short, d: e.d, i: e.i || show.art });

  const resume = ctx.player.resumeLabel(k);
  const page = safeUrl(e.u);
  const on = store.isSaved(k);

  return '<li class="ep" data-ep="' + esc(k) + '">' +
    '<button class="ep-play" data-play="' + esc(k) + '" data-src="' + esc(audio) + '" ' +
      'data-title="' + esc(e.t) + '" data-sub="' + esc(show.src.short || '') + '" ' +
      'data-art="' + esc(e.i ? safeUrl(e.i) : show.art) + '" aria-label="Play">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2l11 6.8-11 6.8z"/></svg>' +
    '</button>' +
    '<div class="ep-body">' +
      (page
        ? '<a class="ep-t" href="' + esc(page) + '" target="_blank" rel="noopener">' + esc(e.t) + '</a>'
        : '<span class="ep-t">' + esc(e.t) + '</span>') +
      '<div class="ep-m"><span>' + esc(ago(e.d)) + '</span>' +
        (resume ? '<span class="ep-resume">' + esc(resume) + '</span>' : '') + '</div>' +
    '</div>' +
    '<button class="ep-save" data-save="' + esc(k) + '" aria-pressed="' + (on ? 'true' : 'false') +
      '">' + (on ? 'Saved' : 'Save') + '</button>' +
  '</li>';
}

function onClick(e) {
  const more = e.target.closest('[data-expand]');
  if (more) {
    expanded[more.getAttribute('data-expand')] = true;
    render();
    return;
  }
  const play = e.target.closest('[data-play]');
  if (play) {
    ctx.player.play({
      key: play.getAttribute('data-play'),
      src: play.getAttribute('data-src'),
      title: play.getAttribute('data-title'),
      sub: play.getAttribute('data-sub'),
      art: play.getAttribute('data-art'),
    });
  }
}

/* Mark the row that is currently loaded, so you can always find your place. */
function paintPlaying() {
  if (!root) return;
  const now = ctx.player.nowPlaying();
  root.querySelectorAll('.ep').forEach((li) => {
    const on = !!(now && now.key === li.getAttribute('data-ep'));
    li.classList.toggle('is-playing', on);
  });
}
