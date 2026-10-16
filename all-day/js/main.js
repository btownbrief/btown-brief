/* main.js — the entry point. Imports the shell, then the nine tabs (each one
   calls app.register() as it loads), then starts the router.

   Modules make the boot order deterministic: app.js has evaluated before any
   tab imports it, and every register() has run before start() routes. The
   tab bar's order is TABS in app.js, not the order of these lines.

   The old tabs (reddit, ig, photos, music, wander, listen) are still in
   modes/ until the cutover deletes them; nothing imports them. */

import * as app from './app.js';

import './modes/wire.js';
import './modes/watch.js';
import './modes/food.js';
import './modes/people.js';
import './modes/whatnow.js';
import './modes/vintage.js';
import './modes/art.js';
import './modes/onair.js';
import './modes/games.js';

app.start();
