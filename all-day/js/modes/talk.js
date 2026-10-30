/* talk.js — People · Talk (wave 1, 2026-10-29; APP-MAP row 38). Where the
   talking happens, which is never in this app (Stephen, Oct 29: no in-app
   chat; Telegram and the Beehiiv community carry conversation).

   - Telegram: the Meetup group's chat, where plans get floated, and the
     guide's Telegram page for anyone new to the app.
   - Community: the Btown Brief community on Beehiiv, its everyday-life
     room and the two channels the You tab already points at.
   - Ask a regular: not built. The idea is a question anyone can ask and
     regulars answer, posted as `idea`-kind posts with answers as replies,
     but the boards have no replies yet (boards.js: posts, votes, reports,
     no threads), so it names what will come. On ?demo=1 it shows a few
     invented questions as a preview, marked as such. */

import * as app from '../app.js';
import { el, esc } from '../ui.js';
import * as kit from './people-kit.js';

const KEY = 'talk';
const GROUP_CHAT = 'https://t.me/+pULrkkS4vjBiZjEx';
const COMMUNITY = 'https://www.btownbrief.com/community';
const CH_FIND = 'https://www.btownbrief.com/community/channels/music';               // "Find Each Other"; the slug is historical
const CH_PLANS = 'https://www.btownbrief.com/community/channels/meetups-hangouts';   // "Plans & Meetups"
const S = { asks: [] };

function load() {
  if (app.demo) return kit.demo('talk').then((d) => { S.asks = Array.isArray(d.asks) ? d.asks : []; });
  return null;
}

const mode = kit.tab({
  key: KEY, label: 'Talk', icon: 'comment',
  promise: 'Ask a regular, and the town’s group chats.',
  load,
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
    { key: 'ask', label: 'Ask a regular',
      draw(b) {
        kit.soon(b, null, ['Ask anything about living here. People who’ve been here for years answer.'], 'ask');
        if (!S.asks.length) return;
        b.appendChild(el('p', 'subh pad', '<b>Examples</b>'));
        kit.rowList(b, S.asks.map((q, i) => {
          const r = el('div', 'lrow');
          r.dataset.k = 'ask-' + i;
          r.innerHTML = '<span></span><div><div class="t">' + esc(q.q) + '</div><div class="s">' + esc(q.a) + '</div></div><span class="going">' + esc(q.n + (q.n === 1 ? ' answer' : ' answers')) + '</span>';
          return r;
        }));
      } },
  ],
});
app.register(KEY, mode);
