/* ============================================================
   THINGS TO DO IN BURLINGTON — weather.js
   Live current conditions for the header, via Open-Meteo
   (no API key, free, CORS-enabled).
   Swappable: replace fetchWeather() to use another source
   (e.g. api.weather.gov) without touching the rest of the app.
============================================================ */

(function () {
  'use strict';

  var LAT = 44.4759;
  var LON = -73.2121;

  // WMO weather codes → { label, icon }
  function describe(code) {
    if (code === 0) return { label: 'Clear', icon: '☀' };
    if (code === 1 || code === 2) return { label: 'Partly cloudy', icon: '⛅' };
    if (code === 3) return { label: 'Cloudy', icon: '☁' };
    if (code === 45 || code === 48) return { label: 'Fog', icon: '☁' };
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { label: 'Rain', icon: '🌧' };
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: 'Snow', icon: '❄' };
    if (code >= 95) return { label: 'Thunderstorm', icon: '⛈' };
    return { label: 'Weather', icon: '☁' };
  }

  function fetchWeather() {
    var url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + LAT + '&longitude=' + LON
      + '&current=temperature_2m,weather_code,is_day'
      + '&temperature_unit=fahrenheit';
    return fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var cur = data && data.current;
        if (!cur || typeof cur.temperature_2m !== 'number') throw new Error('bad payload');
        return { temp: Math.round(cur.temperature_2m), code: cur.weather_code, isDay: cur.is_day !== 0 };
      });
  }

  function render(weather) {
    var el = document.getElementById('weather-indicator');
    var wrap = document.getElementById('weather-wrap');
    if (!el) return;
    var desc = describe(weather.code);
    el.innerHTML = '<span class="weather-icon" aria-hidden="true">' + desc.icon + '</span>'
      + '<span class="weather-temp">' + weather.temp + '°</span>'
      + '<span class="weather-label">' + desc.label + '</span>'
      + '<span class="weather-caret" aria-hidden="true">▾</span>';
    el.title = desc.label + ', ' + weather.temp + '°F in Burlington';
    el.setAttribute('aria-label', 'Current weather: ' + desc.label + ', ' + weather.temp + ' degrees Fahrenheit. Tap for forecast links.');
    if (wrap) wrap.hidden = false;
    wireMenu();
  }

  var menuWired = false;
  function wireMenu() {
    if (menuWired) return;
    var btn = document.getElementById('weather-indicator');
    var menu = document.getElementById('weather-menu');
    if (!btn || !menu) return;
    menuWired = true;

    function close() { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    function open() { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu.hidden) open(); else close();
    });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  /* ----------------------------------------------------------
     AMBIENT WEATHER LAYER
     A full-screen, non-interactive canvas that lets you *feel*
     the current weather while scrolling: drifting snow, rain
     streaks (light or heavy), or a soft sun glow. Subtle by
     design — low alpha, capped particle counts — and skipped
     entirely when the user prefers reduced motion.
  ---------------------------------------------------------- */
  function initAmbient(weather) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var code = weather.code;
    var kind = null;      // 'rain' | 'snow' | 'sun'
    var intensity = 1;    // rain/snow density multiplier

    if ((code >= 51 && code <= 57) || code === 61 || code === 80) { kind = 'rain'; intensity = 0.4; }  // drizzle / light rain
    else if (code === 63 || code === 81) { kind = 'rain'; intensity = 0.8; }
    else if (code === 65 || code === 82 || code >= 95) { kind = 'rain'; intensity = 1.3; }
    else if ((code >= 66 && code <= 77) || code === 85 || code === 86) { kind = 'snow'; intensity = 1; }
    else if (code === 0 && weather.isDay) { kind = 'sun'; }
    else if ((code === 1 || code === 2) && weather.isDay) { kind = 'sun'; intensity = 0.5; }
    if (!kind) return;

    var canvas = document.createElement('canvas');
    canvas.id = 'weather-ambient';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');

    var W, H, particles = [];
    function resize() {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
      seed();
    }

    function isDark() {
      return document.documentElement.getAttribute('data-theme') === 'dark';
    }

    function seed() {
      particles = [];
      if (kind === 'sun') return;
      var per = kind === 'rain' ? 22000 : 16000;
      var count = Math.min(220, Math.round((W * H) / per * intensity));
      for (var i = 0; i < count; i++) {
        particles.push(kind === 'rain' ? {
          x: Math.random() * W, y: Math.random() * H,
          len: 9 + Math.random() * 13,
          speed: 9 + Math.random() * 7,
          drift: 1.2 + Math.random() * 0.8,
        } : {
          x: Math.random() * W, y: Math.random() * H,
          r: 1 + Math.random() * 2.4,
          speed: 0.5 + Math.random() * 1.1,
          phase: Math.random() * Math.PI * 2,
          sway: 0.3 + Math.random() * 0.7,
        });
      }
    }

    var t = 0, running = true;
    function frame() {
      if (!running) return;
      t += 0.016;
      ctx.clearRect(0, 0, W, H);
      var dark = isDark();

      if (kind === 'sun') {
        // Soft warm glow breathing in the top corner — dusk-lake gold.
        var pulse = 0.10 + 0.045 * Math.sin(t * 0.35);
        var g = ctx.createRadialGradient(W * 0.85, -H * 0.1, 0, W * 0.85, -H * 0.1, Math.max(W, H) * 0.75);
        var warm = dark ? '244,166,90' : '242,150,60';
        g.addColorStop(0, 'rgba(' + warm + ',' + (pulse * intensity) + ')');
        g.addColorStop(1, 'rgba(' + warm + ',0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      } else if (kind === 'rain') {
        ctx.strokeStyle = dark ? 'rgba(150,195,225,0.30)' : 'rgba(70,120,150,0.26)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var i = 0; i < particles.length; i++) {
          var p = particles[i];
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.drift, p.y + p.len);
          p.y += p.speed;
          p.x -= p.drift;
          if (p.y > H) { p.y = -p.len; p.x = Math.random() * (W + 40); }
        }
        ctx.stroke();
      } else { // snow
        ctx.fillStyle = dark ? 'rgba(235,240,248,0.55)' : 'rgba(150,170,195,0.45)';
        for (var j = 0; j < particles.length; j++) {
          var s = particles[j];
          ctx.beginPath();
          ctx.arc(s.x + Math.sin(t + s.phase) * 14 * s.sway, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
          s.y += s.speed;
          if (s.y > H + 4) { s.y = -4; s.x = Math.random() * W; }
        }
      }
      requestAnimationFrame(frame);
    }

    document.addEventListener('visibilitychange', function () {
      var wasRunning = running;
      running = !document.hidden;
      if (running && !wasRunning) requestAnimationFrame(frame);
    });
    window.addEventListener('resize', resize);

    resize();
    requestAnimationFrame(frame);
  }

  // Preview hook: append ?wx=sun|rain|lightrain|snow|storm to the URL
  // to force an ambient mode for testing, regardless of real weather.
  function forcedWeather() {
    var m = /[?&]wx=(\w+)/.exec(window.location.search);
    if (!m) return null;
    var codes = { sun: 0, lightrain: 51, rain: 63, storm: 95, snow: 73 };
    if (!(m[1] in codes)) return null;
    return { temp: 65, code: codes[m[1]], isDay: true };
  }

  function init() {
    var forced = forcedWeather();
    if (forced) {
      render(forced);
      initAmbient(forced);
      return;
    }
    fetchWeather().then(function (weather) {
      render(weather);
      initAmbient(weather);
    }).catch(function () {
      // Fail silently — the indicator just stays hidden, no ambient layer.
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
