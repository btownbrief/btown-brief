/* Currents — the wire: one fetch per payload, shared by every tab.

   Ports js/pulse.js loadData/retryLive/checkFresh:
   - prod: live branch first, same-origin snapshot as fallback (that fallback
     is only as fresh as main's daily sync, so a fallback marks the app STALE
     and keeps retrying live on a [8s, 20s, 60s] backoff)
   - dev (localhost/file:): same-origin first so you can work offline
   - pulse-top / pulse-youtube / currents-pools have NO same-origin copy —
     they fail soft and their strips simply do not render
   - every 10 minutes a poll re-checks the live branch. It NEVER re-renders
     underneath a reader: the swap goes through Currents.freshGate(), which
     the shell answers with either "apply now" (barely scrolled) or a
     "↑ fresh" pill.

   The app lives at /currents/, the snapshots at /data/ — hence the ../ .  */
(function () {
  'use strict';
  var LIVE = 'https://raw.githubusercontent.com/btownbrief/btown-brief/';
  var FILES = {
    pulse:            { live: LIVE + 'pulse-data/data/pulse.json',              local: '../data/pulse.json',    poll: true },
    'btown-tv':       { live: LIVE + 'btown-tv/data/btown-tv.json',             local: '../data/btown-tv.json', poll: true },
    'pulse-top':      { live: LIVE + 'pulse-top/data/pulse-top.json',           local: null,                    poll: true },
    'pulse-youtube':  { live: LIVE + 'pulse-youtube/data/pulse-youtube.json',   local: null },
    'currents-pools': { live: LIVE + 'currents-pools/data/currents-pools.json', local: null },
  };
  var STALE_RETRIES = [8000, 20000, 60000];
  var POLL_MS = 600000;

  var cache = {}, subs = {}, fails = {}, inflight = {}, dead = {}, stale = {};

  function isLocalDev() {
    return location.protocol === 'file:' ||
      /^(localhost|127\.|0\.0\.0\.0)$/.test(location.hostname);
  }

  function req(url, timeoutMs, asText) {
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctl && setTimeout(function () { ctl.abort(); }, timeoutMs || 8000);
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return asText ? res.text() : res.json();
    }).finally(function () { if (timer) clearTimeout(timer); });
  }
  function fetchJSON(url, ms) { return req(url, ms, false); }
  function fetchText(url, ms) { return req(url, ms, true); }

  var SHAPE = {
    pulse: function (j) { return j && Array.isArray(j.sources) && Array.isArray(j.items); },
    'pulse-top': function (j) { return j && Array.isArray(j.picks); },
    'btown-tv': function (j) { return j && (j.pick || Array.isArray(j.shelves)); },
    'pulse-youtube': function (j) { return j && Array.isArray(j.videos); },
    'currents-pools': function (j) { return j && j.pools && typeof j.pools === 'object'; },
  };
  function wellFormed(key, json) {
    var check = SHAPE[key];
    return check ? !!check(json) : !!json;
  }
  function emit(key, json) {
    (subs[key] || []).forEach(function (cb) { try { cb(json); } catch (e) {} });
  }
  function settle(key, json, isStale) {
    delete dead[key];
    cache[key] = json;
    stale[key] = !!isStale;
    delete inflight[key];
    emit(key, json);
    if (isStale) {
      Currents.showStale();
      setTimeout(function () { retryLive(key, 0); }, STALE_RETRIES[0]);
    }
    else if (!anyStale()) Currents.hideStale();
  }
  /* A dead key is dead for now, not forever: a blip while the app was
     starting used to disable that feed until a full reload, which hits the
     three no-fallback payloads hardest. The poll retries it. */
  var DEAD_FOR = 120000;
  function bust(key) {
    dead[key] = Date.now();
    delete inflight[key];
    (fails[key] || []).forEach(function (cb) { try { cb(); } catch (e) {} });
  }
  function isDead(key) { return dead[key] && Date.now() - dead[key] < DEAD_FOR; }
  function anyStale() {
    return Object.keys(stale).some(function (k) { return stale[k]; });
  }

  /* a live payload that arrives after the first render must not yank the
     page out from under a reader — the shell decides when it lands */
  function offerFresh(key, json) {
    if (!cache[key] || json.generated === cache[key].generated) {
      if (stale[key]) { stale[key] = false; if (!anyStale()) Currents.hideStale(); }
      return;
    }
    Currents.freshGate(function () {
      cache[key] = json;
      stale[key] = false;
      if (!anyStale()) Currents.hideStale();
      emit(key, json);
    });
  }

  function retryLive(key, attempt) {
    var spec = FILES[key];
    if (!spec || !stale[key]) return;
    fetchJSON(spec.live, 8000).then(function (json) {
      if (stale[key] && wellFormed(key, json)) offerFresh(key, json);
    }).catch(function () {
      var next = attempt + 1;
      if (next < STALE_RETRIES.length) {
        setTimeout(function () { retryLive(key, next); }, STALE_RETRIES[next]);
      }
    });
  }

  function start(key) {
    var spec = FILES[key], local = isLocalDev();
    var first  = local && spec.local ? spec.local : spec.live;
    var second = local ? (spec.local ? spec.live : null) : spec.local;
    inflight[key] = true;
    fetchJSON(first, 8000)
      .then(function (json) {
        if (!wellFormed(key, json)) throw new Error('bad shape');
        settle(key, json, false);
      })
      .catch(function () {
        if (!second) { bust(key); return; }
        /* stale means production had to fall back to main's snapshot;
           local dev reading its own snapshot is just… local dev */
        fetchJSON(second, 8000)
          .then(function (json) {
            if (!wellFormed(key, json)) throw new Error('bad shape');
            settle(key, json, !local);
          })
          .catch(function () { bust(key); });
      });
  }

  window.Currents = window.Currents || {};

  /* onOk may fire more than once — once on load, again when a fresh payload
     is accepted. Tabs must be able to re-render from it. */
  window.Currents.load = function (key, onOk, onFail) {
    var spec = FILES[key];
    if (!spec) { if (onFail) onFail(); return; }
    if (onOk) (subs[key] = subs[key] || []).push(onOk);
    if (onFail) (fails[key] = fails[key] || []).push(onFail);
    if (cache[key]) { if (onOk) onOk(cache[key]); return; }
    if (isDead(key)) { if (onFail) onFail(); return; }
    if (!inflight[key]) start(key);
  };

  /* default gate: apply immediately. The shell replaces this with the
     scroll-aware "↑ fresh" pill once it boots. */
  window.Currents.freshGate = function (apply) { apply(); };
  window.Currents.isStale = function () { return anyStale(); };
  window.Currents.fetchJSON = fetchJSON;
  window.Currents.fetchText = fetchText;
  window.Currents.isLocalDev = isLocalDev;
  /* placeholders so a payload landing before shell.js cannot throw */
  window.Currents.showStale = window.Currents.showStale || function () {};
  window.Currents.hideStale = window.Currents.hideStale || function () {};

  setInterval(function () {
    if (document.hidden || isLocalDev()) return;
    Object.keys(FILES).forEach(function (key) {
      if (cache[key]) {
        if (!FILES[key].poll) return;
        fetchJSON(FILES[key].live, 8000)
          .then(function (json) { if (wellFormed(key, json)) offerFresh(key, json); })
          .catch(function () {});
      } else if (dead[key] && !inflight[key] && (subs[key] || []).length) {
        /* nobody ever got this payload — try again for the tabs waiting on it */
        delete dead[key];
        start(key);
      }
    });
  }, POLL_MS);
})();
