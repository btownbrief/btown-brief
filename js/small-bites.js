/* Small Bites — one combined menu for the Church Street walkable zone.
   Data: data/small-bites.json (see README "Small Bites" for the refresh flow).
   Filters work at two levels: place filters (vibe, cuisine, patio) decide which
   restaurants are in play; dish filters (price, diet, search) decide which of
   their items show. A place with zero matching dishes disappears. */

(function () {
  "use strict";

  var DATA_URL = "data/small-bites.json?v=20260802a";
  var ITEM_CAP = 8; // rows shown per place before "Show all"

  var state = {
    q: "",
    prices: new Set(),   // "u10" | "10to15" | "15to25" | "25up"
    diets: new Set(),    // "vegetarian" | "vegan" | "gluten-free"
    kinds: new Set(),    // "restaurant" | "cafe" | "bar" | "sweet" | "patio"
    openNow: false,
    cuisine: "",
    sort: "near",
    expanded: new Set()  // place ids with all rows shown
  };
  var DATA = null;
  var lastShown = [];    // [{r, items}] from the latest render, feeds Feed Me
  // Burlington's clock, via the shared food engine (js/food-lib.js).
  var T = window.BTFood ? BTFood.now() : null;

  var KIND_FROM_CATEGORY = {
    "Restaurant": "restaurant",
    "Cafe & Bakery": "cafe",
    "Bar & Nightlife": "bar",
    "Brewery & Cidery": "bar",
    "Sweet Treats": "sweet"
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function priceBand(p) {
    if (p == null) return null;
    if (p < 10) return "u10";
    if (p < 15) return "10to15";
    if (p < 25) return "15to25";
    return "25up";
  }

  function dietMatch(item, want) {
    var d = item.diet || [];
    if (want === "vegan") return d.indexOf("vegan") >= 0;
    if (want === "vegetarian")
      return d.indexOf("vegan") >= 0 || d.indexOf("vegetarian") >= 0 || d.indexOf("veg-option") >= 0;
    if (want === "gluten-free")
      return d.indexOf("gluten-free") >= 0 || d.indexOf("gf-option") >= 0;
    return true;
  }

  function itemMatches(item, placeNameHit) {
    if (state.q && !placeNameHit) {
      var hay = (item.name + " " + (item.desc || "") + " " + (item.section || "")).toLowerCase();
      if (hay.indexOf(state.q) < 0) return false;
    }
    if (state.prices.size) {
      var band = priceBand(item.price);
      if (!band || !state.prices.has(band)) return false;
    }
    var ok = true;
    state.diets.forEach(function (d) { if (!dietMatch(item, d)) ok = false; });
    return ok;
  }

  function isOpen(r) {
    if (!T || !r.hours || !Object.keys(r.hours).length) return null; // unknown
    return BTFood.isOpenAt(r.hours, T.day, T.minutes);
  }

  function placeMatches(r) {
    if (state.openNow && isOpen(r) !== true) return false; // unknown hours ≠ open
    if (state.cuisine && (r.cuisine || []).indexOf(state.cuisine) < 0) return false;
    if (!state.kinds.size) return true;
    var hit = false;
    state.kinds.forEach(function (k) {
      if (k === "patio" ? r.patio === true : KIND_FROM_CATEGORY[r.category] === k) hit = true;
    });
    // "patio" narrows rather than widens when combined with a type.
    if (state.kinds.has("patio") && r.patio !== true) hit = false;
    return hit;
  }

  function fmtPrice(item) {
    if (item.price != null) {
      var p = item.price;
      return "$" + (p % 1 === 0 ? p : p.toFixed(2));
    }
    return item.price_text ? esc(item.price_text) : "—";
  }

  function dietChips(item) {
    var lbl = { "vegan": "VG", "vegetarian": "V", "veg-option": "V opt",
                "gluten-free": "GF", "gf-option": "GF opt", "dairy-free": "DF" };
    return (item.diet || []).map(function (d) {
      return lbl[d] ? '<span class="diet" title="' + esc(d) + '">' + lbl[d] + "</span>" : "";
    }).join("");
  }

  function fmtDate(iso) {
    if (!iso) return null;
    var m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? Number(m[2]) + "/" + Number(m[3]) + "/" + m[1].slice(2) : iso;
  }

  function shortAddress(a) {
    return a ? esc(a.split(",")[0]) : "";
  }

  function render() {
    var list = document.getElementById("menu-list");
    var itemFiltersOn = !!(state.q || state.prices.size || state.diets.size);

    var shown = [];
    var gaps = [];
    DATA.restaurants.forEach(function (r) {
      if (!placeMatches(r)) return;
      if (r.menu.status === "unavailable") {
        // A place with no fetched menu can't answer a dish-level question.
        if (!itemFiltersOn) gaps.push(r);
        return;
      }
      var nameHit = state.q && r.name.toLowerCase().indexOf(state.q) >= 0;
      var items = r.menu.items.filter(function (it) { return itemMatches(it, nameHit); });
      if (!items.length) {
        if (!itemFiltersOn && !state.q) gaps.push(r);
        return;
      }
      var prices = items.map(function (i) { return i.price; }).filter(function (p) { return p != null; });
      shown.push({ r: r, items: items, min: prices.length ? Math.min.apply(null, prices) : Infinity });
    });

    if (state.sort === "name") shown.sort(function (a, b) { return a.r.name.localeCompare(b.r.name); });
    else if (state.sort === "cheap") shown.sort(function (a, b) { return a.min - b.min; });
    else shown.sort(function (a, b) { return a.r.dist_m - b.r.dist_m; });

    lastShown = shown;
    var dishCount = shown.reduce(function (n, s) { return n + s.items.length; }, 0);
    document.getElementById("match-line").innerHTML =
      "<b>" + dishCount + "</b> dishes · <b>" + shown.length + "</b> places";
    document.getElementById("rail-summary").innerHTML =
      '<span class="hits">' + dishCount + " dishes · " + shown.length + " places</span>";

    if (!shown.length) {
      list.innerHTML = '<p class="empty"><b>Nothing matches that combination.</b><br>' +
        "Loosen a filter — the dietary tags only exist where a menu printed them.</p>";
    } else {
      list.innerHTML = shown.map(renderPlace).join("");
    }

    var gapSection = document.getElementById("gap-section");
    var gapList = document.getElementById("gap-list");
    if (gaps.length) {
      gapSection.hidden = false;
      gapList.innerHTML = gaps.map(function (r) {
        var link = r.website
          ? ' — <a href="' + esc(r.website) + '" rel="noopener">website</a>'
          : "";
        var note = r.menu.note ? ' <span class="gap-note">' + esc(r.menu.note) + "</span>" : "";
        return "<li><b>" + esc(r.name) + "</b> · " + r.walk_min + " min walk" + link + note + "</li>";
      }).join("");
    } else {
      gapSection.hidden = true;
    }
  }

  function statusSpan(r) {
    if (!T) return "";
    var s = BTFood.statusLine(r.hours, T);
    if (s.open === null) return "";
    return '<span class="status ' + (s.open ? "status-open" : "status-closed") + '">' +
      esc(s.text) + "</span>";
  }

  function renderPlace(s) {
    var r = s.r;
    var open = state.expanded.has(r.id);
    var rows = open ? s.items : s.items.slice(0, ITEM_CAP);

    var head = '<div class="place-head"><h2>' +
      (r.website ? '<a href="' + esc(r.menu.url || r.website) + '" rel="noopener">' + esc(r.name) + "</a>" : esc(r.name)) +
      "</h2><span class=\"place-meta\">" +
      "<span>" + r.walk_min + " min walk</span>" +
      (r.price ? "<span>" + esc(r.price) + "</span>" : "") +
      ((r.cuisine || []).length ? "<span>" + esc(r.cuisine.join(" · ")) + "</span>" : "") +
      (r.patio === true ? '<span class="chip patio">Patio</span>' : "") +
      (r.deals.length ? '<span class="chip deal">Deal</span>' : "") +
      (r.menu.status === "partial" ? '<span class="chip gap" title="' + esc(r.menu.note || "") + '">Partial menu</span>' : "") +
      statusSpan(r) +
      "</span></div>";

    var deals = "";
    if (r.deals.length) {
      deals = '<p class="place-deals">' + r.deals.map(function (d) {
        var when = d.days && d.days.length ? " (" + d.days.join("/") + ")" : "";
        var src = d.source === "deals.json"
          ? ' <span class="src">— on file' + (d.last_verified ? ", verified " + fmtDate(d.last_verified) : "") + "</span>"
          : ' <span class="src">— stated on their site</span>';
        return esc(d.text) + when + src;
      }).join("<br>") + "</p>";
    }

    var items = '<ul class="items">' + rows.map(function (it, idx) {
      return '<li class="item" data-key="' + esc(r.id) + ":" + idx + '"><div class="item-row">' +
        '<span class="item-name">' + esc(it.name) + dietChips(it) + "</span>" +
        '<span class="item-leader" aria-hidden="true"></span>' +
        '<span class="item-price">' + fmtPrice(it) + "</span></div>" +
        (it.desc ? '<p class="item-desc">' + esc(it.desc) + "</p>" : "") +
        "</li>";
    }).join("") + "</ul>";

    var more = s.items.length > ITEM_CAP
      ? '<button class="more-btn" data-more="' + esc(r.id) + '">' +
        (open ? "Show fewer" : "Show all " + s.items.length + " dishes") + "</button>"
      : "";

    var foot = '<div class="place-foot">' +
      "<span>" + shortAddress(r.address) + "</span>" +
      (r.menu.fetched ? "<span>menu fetched " + fmtDate(r.menu.fetched) + "</span>" : "") +
      (r.google_maps ? '<a href="' + esc(r.google_maps) + '" rel="noopener">map</a>' : "") +
      "</div>";

    return '<article class="place">' + head + deals + items + more + foot + "</article>";
  }

  /* Feed Me: one random dish from whatever the filters currently allow. */
  function feedMe() {
    var pool = [];
    lastShown.forEach(function (s) {
      s.items.forEach(function (it, idx) { pool.push({ rid: s.r.id, idx: idx }); });
    });
    if (!pool.length) return;
    var pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick.idx >= ITEM_CAP) state.expanded.add(pick.rid);
    render();
    var el = document.querySelector('.item[data-key="' + pick.rid + ":" + pick.idx + '"]');
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    setTimeout(function () { el.classList.remove("flash"); }, 2400);
  }

  function bind() {
    var toggle = document.getElementById("rail-toggle");
    toggle.addEventListener("click", function () {
      var rail = document.querySelector(".rail");
      var open = rail.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    document.querySelectorAll(".pill[data-price],.pill[data-diet],.pill[data-kind],.pill[data-open]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if ("open" in btn.dataset) {
          state.openNow = !state.openNow;
          btn.setAttribute("aria-pressed", state.openNow ? "true" : "false");
          render();
          return;
        }
        var set = btn.dataset.price ? state.prices : btn.dataset.diet ? state.diets : state.kinds;
        var val = btn.dataset.price || btn.dataset.diet || btn.dataset.kind;
        if (set.has(val)) { set.delete(val); btn.setAttribute("aria-pressed", "false"); }
        else { set.add(val); btn.setAttribute("aria-pressed", "true"); }
        render();
      });
    });

    document.getElementById("feed-me").addEventListener("click", feedMe);

    var q = document.getElementById("q");
    var t = null;
    q.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () {
        state.q = q.value.trim().toLowerCase();
        render();
      }, 140);
    });

    document.getElementById("cuisine").addEventListener("change", function (e) {
      state.cuisine = e.target.value;
      render();
    });
    document.getElementById("sort").addEventListener("change", function (e) {
      state.sort = e.target.value;
      render();
    });

    document.getElementById("menu-list").addEventListener("click", function (e) {
      var id = e.target && e.target.dataset && e.target.dataset.more;
      if (!id) return;
      if (state.expanded.has(id)) state.expanded.delete(id);
      else state.expanded.add(id);
      render();
    });
  }

  function fillCuisines() {
    var counts = {};
    DATA.restaurants.forEach(function (r) {
      (r.cuisine || []).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
    });
    var sel = document.getElementById("cuisine");
    Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); })
      .forEach(function (c) {
        var o = document.createElement("option");
        o.value = c;
        o.textContent = c.charAt(0).toUpperCase() + c.slice(1) + " (" + counts[c] + ")";
        sel.appendChild(o);
      });
  }

  function stats() {
    var c = DATA.coverage;
    document.getElementById("stats").innerHTML =
      "<span><b>" + c.places + "</b> places in the zone</span>" +
      "<span><b>" + c.items + "</b> dishes on file</span>" +
      "<span><b>" + (c.menus_ok + c.menus_partial) + "</b> menus fetched, <b>" +
      c.menus_unavailable + "</b> gaps</span>" +
      "<span>updated " + fmtDate(DATA.generated) + "</span>";
  }

  fetch(DATA_URL)
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (json) {
      DATA = json;
      stats();
      fillCuisines();
      bind();
      render();
    })
    .catch(function (err) {
      document.getElementById("stats").textContent = "Couldn't load the menu data.";
      document.getElementById("menu-list").innerHTML =
        '<p class="empty">Couldn\'t load data/small-bites.json (' + esc(err.message) + ").</p>";
    });
})();
