/* dating.js — People · Dating & Friends (wave 1, 2026-10-29). Two lanes,
   dating and friends, real life and online (the bar's Real life / Online
   switch; Stephen's memo: "matchmaking, singles, friends, real life plus
   online"). No chat in the app: Telegram and the community carry the talk.

   Real life:
   - Singles: readers' plans on the people board whose words say singles
     (people-match.js's SINGLES, the same test the You tab's Dating uses),
     and the button to post one, a plan for going out as a group.
   - Friends: the friend-finder lane, plans whose words say they're after
     friends (FRIENDS below) and aren't singles plans. A post is the same
     plan kind; its lane is read off its words, because the people board
     has no lane field (adding one is a shell change: boards-core.js RULES
     and nn-APPS.sql, Stephen's paste). The post button says to put
     "friends" in the title.
   - Events: the calendar's singles nights and friend-making mixers
     (people-match.js's mixerKind: singles and socials), the next two weeks.
   - Pitch a friend: the night in a line. When Stephen's Meetup calendar
     (Up For It's copy, the feed the You tab reads) has a Pitch a Friend
     event coming, its date, place and RSVP; otherwise the Meetup group.
     No date is invented here.
   Online:
   - Posts: the local ways to meet someone online and the dating headlines,
     from the hand-checked data/dating-pets.json. */

import * as app from '../app.js';
import { el, esc, safeHref, ICON } from '../ui.js';
import { SINGLES, mixerKind } from '../people-match.js';
import { whenMs, whenLabel } from './people.js';
import * as kit from './people-kit.js';

const KEY = 'dating';
const FRIENDS = /\bfriends?\b|\bpals?\b|\bbuddy\b|\bnew (?:in|to) (?:town|burlington)\b|\bmeet (?:new )?people\b|\bfind (?:my|our) people\b|\bcrew\b/i;
const PAST_GRACE = 3 * 3600000;
const NEWS_DAYS = 180;
const NEWS_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
const MEETUP_FEED = 'https://play.btownbrief.com/up-for-it/data/meetup.json';
const PITCH = /pitch[- ]?a[- ]?friend|friend pitch/i;
/* "RSVP on Meetup" only ever opens one of the group's own event pages */
const MEETUP_EVENT = /^https:\/\/(?:www\.)?meetup\.com\/burlington-social-activites-group\/events\/[\w-]+\/?$/;
const S = { posts: [], r: null, events: null, dp: null, pitch: null };
/* the next Pitch a Friend night on Stephen's Meetup calendar, or null */
function nextPitch(list) {
  const now = Date.now();
  return (list || []).map((e) => ({ title: String(e.title || ''), at: Date.parse(e.starts_at), where: String(e.location || ''), url: String(e.url || '') }))
    .filter((e) => PITCH.test(e.title) && e.at > now && MEETUP_EVENT.test(e.url)).sort((a, b) => a.at - b.at)[0] || null;
}

const words = (p) => [p.title, p.body, p.place].filter(Boolean).join(' ');
const upcoming = () => S.posts.filter((p) => { const at = whenMs((p.meta || {}).when, Date.parse(p.created_at)); return at == null || at > Date.now() - PAST_GRACE; });
const singles = () => upcoming().filter((p) => SINGLES.test(words(p)));
const friends = () => upcoming().filter((p) => FRIENDS.test(words(p)) && !SINGLES.test(words(p)));
const meta = (p) => { const m = p.meta || {}; return [m.when, m.spots ? m.spots + (m.spots === 1 ? ' spot' : ' spots') : ''].filter(Boolean).join(' · '); };

function load() {
  return Promise.all([
    app.demo ? kit.demo('dating').then((d) => {
      S.pitch = nextPitch((d.meetup || []).map((e) => ({ ...e, starts_at: kit.wallISO(kit.dayFromToday(e.day), e.time) })));
      return d.events || [];
    }) : kit.json(MEETUP_FEED).then((j) => { S.pitch = nextPitch(j && j.events); return null; }),
    kit.datingPets().then((j) => { S.dp = j; }),
  ]).then(([demoEvents]) => Promise.all([kit.events(demoEvents, (e) => { S.events = e; mode.redraw(); }).then((e) => { S.events = e; }), reload()]));
}
function reload() { return kit.listBoard('people', { kind: 'plan' }).then((r) => { S.r = r; S.posts = r.posts; }); }

function lane(host, list, empty) {
  if (S.r && !S.r.ok) { kit.boardNote(host, S.r); return; }
  if (!list.length) { host.appendChild(el('p', 'note pad', empty)); return; }
  kit.feed(host, list, { tab: KEY, meta, noLeft: true, vote: 'I’d go' });
}
function planButton(label, placeholder, word) {
  return kit.postButton(label, { board: 'people', kind: 'plan', heading: label, title: 'What’s the plan', titlePlaceholder: placeholder,
    fields: [{ key: 'when', label: 'When', placeholder: 'Friday, 8 pm' }, { key: 'spots', label: 'Spots', type: 'int', placeholder: '3' }],
    place: 'Where', placePlaceholder: 'A bar, a show, a trail', body: 'Anything to know', notes: ['Say “' + word + '” in the title.'] });
}

const calendarItems = () => kit.eventItems(S.events || [], (e) => { const k = mixerKind(e); return k === 'singles' || k === 'social' || SINGLES.test(e.title); }, 'dt-');

const mode = kit.tab({
  key: KEY, label: 'Dating', icon: 'heart', mixed: true, fresh: true, boards: ['people'],
  promise: 'Friends and dating, in real life and online.',
  load, reload,
  posts: () => S.posts,
  count: (ts) => kit.newer(singles().concat(friends()), ts),
  sections: [
    { key: 'singles', label: 'Singles', world: 'irl', newest: () => kit.newest(singles()),
      draw(b) {
        b.appendChild(planButton('Post a singles plan', 'Going out with a few single friends, join us', 'singles'));
        lane(b, singles(), 'No singles plans yet.');
      } },
    { key: 'friends', label: 'Friends', world: 'irl', newest: () => kit.newest(friends()),
      draw(b) {
        b.appendChild(planButton('Post a friends plan', 'Looking for friends to try the climbing gym with', 'friends'));
        lane(b, friends(), 'No friend posts yet.');
      } },
    { key: 'events', label: 'Events', world: 'irl', newest: () => (calendarItems().length ? kit.calendarAt() : 0),
      draw(b) {
        if (S.events === null) { b.appendChild(el('p', 'note pad', 'Didn’t load.')); return; }
        kit.eventList(b, calendarItems(), 'Nothing in the next two weeks.');
        b.appendChild(kit.outRow('Every mixer', '', '#people/mix', 'to-mix'));
      } },
    { key: 'pitch', label: 'Pitch a friend', world: 'irl', newest: () => 0,
      draw(b) {
        const p = S.pitch;
        const tc = kit.textCard(b, p ? whenLabel(p.at) : null, [
          ...(p && p.where ? [p.where] : []),
          'Bring a single friend and sell them to the room: two minutes each, their best qualities, worst habits and one good story. Then everyone mingles.',
        ], [p ? kit.linkBtn('RSVP on Meetup', p.url, 'pkey') : kit.linkBtn('See it on Meetup', kit.MEETUP_GROUP, 'pkey')], 'pitch');
        if (p) tc.dataset.next = String(p.at);
      } },
    { key: 'posts', label: 'Posts', world: 'online', newest: () => 0,
      draw(b) {
        if (!S.dp) { b.appendChild(el('p', 'note pad', 'Didn’t load.')); return; }
        kit.rowList(b, (S.dp.dating.ways || []).filter((w) => w && w.name && /^https:\/\//.test(String(w.url || ''))).map((w) => kit.outRow(w.name, w.line, w.url, 'dw:' + w.id)));
        const cut = Date.now() - NEWS_DAYS * kit.DAY;
        const news = (S.dp.dating.news || []).filter((n) => n && n.title && /^https:\/\//.test(String(n.url || '')) && /^\d{4}-\d{2}-\d{2}$/.test(String(n.date)) &&
          (n.evergreen || Date.parse(n.date + 'T12:00:00Z') > cut)).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 4);
        if (!news.length) return;
        b.appendChild(el('p', 'subh pad', '<b>Dating news</b>'));
        kit.rowList(b, news.map((n) => {
          const a = el('a', 'lrow news', '<div><div class="t">' + esc(n.title) + '</div><div class="s">' + esc(n.outlet + ' · ' + NEWS_DAY.format(new Date(n.date + 'T12:00:00Z'))) + '</div></div>' + ICON.ext);
          a.href = safeHref(n.url);
          a.target = '_blank';
          a.rel = 'noopener';
          a.dataset.k = 'dn:' + n.date + ':' + n.title.slice(0, 24);
          return a;
        }));
      } },
  ],
});
app.register(KEY, mode);
export const _peek = () => ({ singles: singles().map((p) => p.title), friends: friends().map((p) => p.title), events: calendarItems().map((e) => e.title) });
