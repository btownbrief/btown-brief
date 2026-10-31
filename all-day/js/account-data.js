/* account-data.js — the reader's data that lives outside the boards goes
   with the account in every app.

   Settings' "Delete my account and posts" (boards.deleteMe) runs the hooks
   other modules register with boards.onDeleteMe. Habits (sz_delete_me) and
   The Build (bd_delete_me) register theirs when their modes load, which was
   fine while every reader was in All Day. A reader can also delete the
   account from Town, where neither mode is loaded, and their habits, taps, thing, hours and builder would
   stay behind on the server, keyed to an account that no longer exists.

   So this module, loaded by main.js in every app, registers the server side
   of both deletions whenever the app does NOT load that mode. When the mode
   is loaded, its own hook does the call and clears its screen, and this
   module stays out of the way so nothing is deleted twice. The rules are the
   modes' own: signed out there is nothing on the server to delete; in the
   demo there is no server; a 404 PGRST202 means that SQL was never pasted,
   which boards.deleteMe treats as nothing to delete ('off'); any other
   refusal stops the deletion so Settings never says "Deleted" with
   something left behind. */

import * as app from './app.js';
import * as store from './store.js';
import * as boards from './boards.js';

const OWNED = [
  { mode: 'habits', fn: 'sz_delete_me' },
  { mode: 'build', fn: 'bd_delete_me' },
];

const fail = (error) => ({ ok: false, error });

/* The same call Habits and The Build make, without their screens. */
function rpc(fn) {
  if (app.demo) return Promise.resolve({ ok: true });
  if (!app.user()) return Promise.resolve({ ok: true });
  return Promise.resolve(app.token()).then((tok) => {
    if (!tok) throw new Error('no token');
    return fetch(store.SB_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: store.SB_KEY, 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: '{}',
    });
  }).then((r) => r.text().then((t) => {
    let j = null;
    try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
    if (r.ok) return { ok: true };
    if (r.status === 404 && j && j.code === 'PGRST202') return fail('off');
    if (r.status === 401) return fail('not_signed_in');
    return fail(j && typeof j.message === 'string' && /^[a-z_]+$/.test(j.message) ? j.message : 'offline');
  }), () => fail('offline'));
}

const loaded = new Set(app.modes());
OWNED.filter((o) => !loaded.has(o.mode)).forEach((o) => boards.onDeleteMe(() => rpc(o.fn)));

/* for the tests: which deletions this app handles here rather than in a mode */
export const handledHere = () => OWNED.filter((o) => !loaded.has(o.mode)).map((o) => o.fn);
