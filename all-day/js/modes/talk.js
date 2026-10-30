/* talk.js — People · Talk (wave 1, 2026-10-29; APP-MAP row 38). Where the
   talking happens, which is never in this app (Stephen, Oct 29: no in-app
   chat; Telegram and the Beehiiv community carry conversation).

   - Telegram: the Meetup group's chat, where plans get floated, and the
     guide's Telegram page for anyone new to the app.
   - Community: the Btown Brief community on Beehiiv, its everyday-life
     room and the two channels the You tab already points at.
   - Ask a regular: questions are the Square board's `ask` posts (the same
     ones the Wire's Square shows), with "Me too" as the vote and a post
     button. The boards have no replies yet (a shell ask in the wave 1
     report), so each question's answer goes to the group chat. */

import * as app from '../app.js';
import { el } from '../ui.js';
import * as kit from './people-kit.js';

const KEY = 'talk';
const GROUP_CHAT = 'https://t.me/+pULrkkS4vjBiZjEx';
const COMMUNITY = 'https://www.btownbrief.com/community';
const CH_FIND = 'https://www.btownbrief.com/community/channels/music';               // "Find Each Other"; the slug is historical
const CH_PLANS = 'https://www.btownbrief.com/community/channels/meetups-hangouts';   // "Plans & Meetups"
const S = { asks: [], r: null };

function load() { return (app.demo ? kit.demo('talk') : Promise.resolve()).then(reload); }
function reload() { return kit.listBoard('square', { kind: 'ask' }).then((r) => { S.r = r; S.asks = r.posts; }); }
const TOPIC = { food: 'Food', outdoors: 'Outdoors', pets: 'Pets', events: 'Events', home: 'Home', 'lost-found': 'Lost & found', recommend: 'A recommendation', other: 'Something else' };
function answer() {
  const r = el('div', 'linkrow');
  r.appendChild(kit.linkBtn('Answer in the group chat', GROUP_CHAT, 'ghost sm'));
  return r;
}

const mode = kit.tab({
  key: KEY, label: 'Talk', icon: 'comment', boards: ['square'],
  promise: 'Ask a regular, and the town’s group chats.',
  load, reload,
  count: (ts) => kit.newer(S.asks, ts),
  sections: [
    { key: 'telegram', label: 'Telegram',
      draw(b) {
        /* DESIGN.md §10.7: the button is the paragraph */
        const r = el('div', 'linkrow chlinks');
        r.dataset.card = 'telegram';
        r.append(kit.linkBtn('Join the group chat', GROUP_CHAT, 'pkey'), kit.linkBtn('The Meetup group', kit.MEETUP_GROUP, 'ghost sm'));
        b.appendChild(r);
        b.appendChild(kit.outRow('New to Telegram?', '', kit.TELEGRAM_PAGE, 'telegram-page'));
      } },
    { key: 'community', label: 'Community',
      draw(b) {
        const r = el('div', 'linkrow chlinks');
        r.dataset.card = 'community';
        r.appendChild(kit.linkBtn('Join the community', COMMUNITY, 'pkey'));
        b.appendChild(r);
        kit.rowList(b, [kit.outRow('Find Each Other', '', CH_FIND, 'ch-find'), kit.outRow('Plans & Meetups', '', CH_PLANS, 'ch-plans')]);
      } },
    { key: 'ask', label: 'Ask a regular', newest: () => kit.newest(S.asks),
      draw(b) {
        b.appendChild(kit.postButton('Ask a question', { board: 'square', kind: 'ask', heading: 'Ask a regular', title: 'Your question', titlePlaceholder: 'Where do I get a bike tuned up this week?',
          fields: [{ key: 'topic', label: 'About', type: 'enum', options: Object.entries(TOPIC) }], body: 'More detail' }));
        if (S.r && !S.r.ok) { kit.boardNote(b, S.r); return; }
        if (!S.asks.length) { b.appendChild(el('p', 'note pad', 'No questions yet.')); return; }
        kit.feed(b, S.asks, { tab: KEY, vote: 'Me too', meta: (p) => TOPIC[(p.meta || {}).topic] || '', after: answer });
      } },
  ],
});
app.register(KEY, mode);
