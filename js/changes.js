/* ============================================================
   SINCE YOU CHECKED — front-end
   Reads data/changes/changes.json (written by scripts/changes/update.py),
   remembers the visitor's last visit in localStorage, and renders every
   tracked change since then, grouped by category, biggest first.
============================================================ */

(function () {
  "use strict";

  var STORE_KEY = "btb-since-you-checked";
  var GRACE_MIN = 30;          // reloads within 30 min keep the same window
  var FALLBACK_HOURS = 24;     // first visit: "in the last 24 hours"
  var MAX_FALLBACK_LINES = 10; // quiet-state "before you checked" list

  // Mirrors CATEGORIES in scripts/changes/common.py
  var CATS = {
    weather:  { icon: "🌩", label: "Weather" },
    roads:    { icon: "🚧", label: "Roads & Transit" },
    lake:     { icon: "🏖", label: "The Lake" },
    cityhall: { icon: "🏛", label: "City Hall" },
    food:     { icon: "🍽", label: "Food & Drink" },
    events:   { icon: "🎭", label: "Events" },
    news:     { icon: "📰", label: "News" },
    chatter:  { icon: "💬", label: "Chatter" }
  };

  // ---- visit bookkeeping -------------------------------------------------

  function loadVisit() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null; }
    catch (e) { return null; }
  }

  function saveVisit(v) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch (e) {}
  }

  /* Returns { cutoff: Date|null, firstVisit: bool }.
     cutoff is when the visitor last checked; reloads inside the grace
     window keep showing the same "since" so refreshing doesn't zero it. */
  function resolveVisit(now) {
    var prev = loadVisit();
    if (!prev || !prev.last) {
      saveVisit({ last: now.toISOString(), shownCutoff: null });
      return { cutoff: null, firstVisit: true };
    }
    var last = new Date(prev.last);
    var withinGrace = (now - last) < GRACE_MIN * 60 * 1000;
    var cutoff = withinGrace && prev.shownCutoff ? new Date(prev.shownCutoff) : last;
    saveVisit({ last: now.toISOString(), shownCutoff: cutoff.toISOString() });
    return { cutoff: cutoff, firstVisit: false };
  }

  // ---- formatting --------------------------------------------------------

  function agoPhrase(from, to) {
    var mins = Math.max(0, Math.round((to - from) / 60000));
    if (mins < 2) return "moments";
    if (mins < 60) return mins + " minutes";
    var hrs = Math.round(mins / 60);
    if (hrs < 48) return hrs + (hrs === 1 ? " hour" : " hours");
    var days = Math.round(hrs / 24);
    return days + " days";
  }

  function relTime(iso, now) {
    var t = new Date(iso);
    var mins = Math.round((now - t) / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return mins + "m ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    if (hrs < 48) return "yesterday";
    return t.toLocaleDateString([], { weekday: "short" }) + " " +
           t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function esc(s) {
    // attribute-safe: quotes must be encoded too, textContent alone isn't enough
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* Feed content is untrusted: only link out to http(s) or same-site pages. */
  function safeUrl(u) {
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    if (/^[\w./-]+\.html$/.test(u)) return u; // relative page like events.html
    return "";
  }

  // ---- rendering ---------------------------------------------------------

  function lineHtml(ev, now) {
    var url = safeUrl(ev.url);
    var head = url
      ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(ev.headline) + "</a>"
      : esc(ev.headline);
    var html = '<li class="syc-line' + (ev.priority >= 3 ? " is-big" : "") + '">' +
      '<div class="syc-line-headline">' + head + "</div>";
    if (ev.detail) html += '<div class="syc-line-detail">' + esc(ev.detail) + "</div>";
    html += '<div class="syc-line-meta">' + esc(relTime(ev.ts, now)) +
      " · " + esc(ev.sourceName || ev.source) + "</div></li>";
    return html;
  }

  function groupHtml(cat, events, now) {
    var meta = CATS[cat] || { icon: "•", label: cat };
    var n = events.length;
    return '<section class="syc-group" aria-label="' + esc(meta.label) + '">' +
      '<div class="syc-group-head">' +
        '<span class="syc-group-icon">' + meta.icon + "</span>" +
        '<span class="syc-group-label">' + esc(meta.label) + "</span>" +
        '<span class="syc-group-count">' + n + (n === 1 ? " change" : " changes") + "</span>" +
      "</div><ul class=\"syc-lines\">" +
      events.map(function (ev) { return lineHtml(ev, now); }).join("") +
      "</ul></section>";
  }

  function render(events, now) {
    // group by category
    var groups = {};
    events.forEach(function (ev) {
      (groups[ev.category] = groups[ev.category] || []).push(ev);
    });
    // biggest first: highest priority inside the group, then group size
    var order = Object.keys(groups).sort(function (a, b) {
      var pa = Math.max.apply(null, groups[a].map(function (e) { return e.priority; }));
      var pb = Math.max.apply(null, groups[b].map(function (e) { return e.priority; }));
      if (pb !== pa) return pb - pa;
      return groups[b].length - groups[a].length;
    });
    order.forEach(function (cat) {
      groups[cat].sort(function (a, b) {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.ts < b.ts ? 1 : -1;
      });
    });
    document.getElementById("syc-groups").innerHTML =
      order.map(function (cat) { return groupHtml(cat, groups[cat], now); }).join("");
  }

  // ---- boot --------------------------------------------------------------

  function boot(data) {
    var now = new Date();
    var visit = resolveVisit(now);
    var events = (data.events || []).slice();
    var cutoff = visit.cutoff || new Date(now - FALLBACK_HOURS * 3600 * 1000);

    var since = events.filter(function (ev) { return new Date(ev.ts) > cutoff; });

    var statsEl = document.getElementById("syc-stats");
    var subEl = document.getElementById("syc-sub");
    var quietEl = document.getElementById("syc-quiet");
    var noteEl = document.getElementById("syc-window-note");

    var n = since.length;
    if (visit.firstVisit) {
      statsEl.innerHTML = "First time here? <span class=\"syc-big\">" + n +
        "</span> thing" + (n === 1 ? "" : "s") + " changed in the last 24 hours.";
      subEl.textContent = "This page remembers when you last looked and shows only what's new. Come back tomorrow and it picks up right where you left off.";
    } else {
      statsEl.innerHTML = "You last checked <strong>" + esc(agoPhrase(cutoff, now)) +
        " ago</strong>. Since then: <span class=\"syc-big\">" + n +
        "</span> change" + (n === 1 ? "" : "s") + ".";
      subEl.textContent = n
        ? "Biggest first. Every line links to the source."
        : "";
    }

    if (data.generated) {
      document.getElementById("syc-updated").textContent =
        "Sources last checked " + relTime(data.generated, now) + ".";
    }

    if (n) {
      render(since, now);
    } else {
      quietEl.hidden = false;
      var recent = events.sort(function (a, b) { return a.ts < b.ts ? 1 : -1; })
                         .slice(0, MAX_FALLBACK_LINES);
      render(recent, now);
    }

    noteEl.innerHTML = 'Showing changes since your last visit. ' +
      '<button type="button" id="syc-reset">Show the last 24 hours instead</button>';
    document.getElementById("syc-reset").addEventListener("click", function () {
      var dayAgo = new Date(now - FALLBACK_HOURS * 3600 * 1000);
      saveVisit({ last: now.toISOString(), shownCutoff: dayAgo.toISOString() });
      location.reload();
    });

    document.getElementById("syc-page").hidden = false;
  }

  fetch("data/changes/changes.json", { cache: "no-store" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(boot)
    .catch(function (err) {
      console.error("[since-you-checked]", err);
      document.getElementById("syc-error").hidden = false;
    });
})();
