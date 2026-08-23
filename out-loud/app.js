/* ============================================================
   BTOWN OUT LOUD — app wiring
   The engine (engine.js) decides what plays; this file feeds it
   positions and does the browser-y things: map, one persistent
   <audio>, speech fallback, wake lock, pocket mode, list, offline.
   ============================================================ */
import { createState, step, storyEnded, manualPlay, rank, haversineM } from './engine.js';

const DATA_URL = './stories.json';   // inside the SW scope on purpose (offline)
const SUPABASE_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3';
const VISITED_KEY = 'btown-out-loud-visited';
const AUTO_KEY = 'btown-out-loud-autoplay';
const NL_LINK = 'https://btownbrief.com?utm_source=guide&utm_medium=out-loud&utm_campaign=site_capture';

const qs = new URLSearchParams(location.search);
const REPLAY = qs.get('replay');          // ?replay=downtown-loop → simulated walk
const SPIKE = qs.get('spike');            // ?spike=here → two test pins at your first fix
const DEEP_STORY = qs.get('s');           // ?s=nectars → open that story
const DEEP_ROUTE = qs.get('route');       // ?route=downtown-loop
const IS_TEST = Boolean(REPLAY || SPIKE || qs.get('test'));

const $ = (id) => document.getElementById(id);
const els = {
  hero: $('hero'), walk: $('walk'), start: $('btn-start'), stop: $('btn-stop'), pocket: $('btn-pocket'),
  recenter: $('btn-recenter'), auto: $('toggle-auto'), status: $('walk-status'), sub: $('walk-sub'),
  nearby: $('walk-nearby'), list: $('list'), storiesTitle: $('stories-title'), routeNote: $('route-note'),
  endCard: $('end-card'), factCount: $('fact-count'), now: $('now'), nowToggle: $('now-toggle'),
  nowTitle: $('now-title'), nowSub: $('now-sub'), nowKicker: $('now-kicker'), nowRead: $('now-read'),
  nowSkip: $('now-skip'), nowTranscript: $('now-transcript'), nowFill: $('now-fill'), pocketEl: $('pocket'),
  pocketStatus: $('pocket-status'), nudge: $('nudge'), nudgePlay: $('nudge-play'), offline: $('btn-offline'),
  offlineStatus: $('offline-status'), aboutVoice: $('about-voice'),
};
const audio = $('player');

let data = null, pins = [], byId = new Map(), routes = [];
let eng = createState();
let mode = 'browse';
let watchId = null, wakeLock = null, lastPos = null, lastFixAt = 0;
let currentId = null, wantPlaying = false, tts = null, audioCtx = null;
let playToken = 0, watchdog = null, lastEndedId = null, lastNearRender = 0;
let filter = DEEP_ROUTE ? `route:${DEEP_ROUTE}` : 'all';
let map = null, markers = new Map(), youMarker = null, youCircle = null, followYou = true;
let visited = loadJSON(VISITED_KEY, {});
// Cooldown survives reloads (iOS discards backgrounded home-screen apps freely).
for (const [id, v] of Object.entries(visited)) { const t = v.done || v.started; if (t) eng.lastPlayed[id] = t; }
let autoplay = localStorage.getItem(AUTO_KEY) !== 'off';
let replayTimer = null;

/* ---------- boot ---------- */
init().catch((err) => {
  console.error(err);
  toast('Could not load the stories. Try again with a connection.');
});

async function init() {
  const res = await fetch(DATA_URL, { cache: 'no-cache' });
  data = await res.json();
  pins = (data.pins || []).filter((p) => p.enabled !== false && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  routes = data.routes || [];
  if (SPIKE === 'church') pins = [...spikePins({ lat: 44.47845, lng: -73.21195 }), ...pins];
  byId = new Map(pins.map((p) => [p.id, p]));
  els.factCount.textContent = String(pins.length);
  if (data.voice && data.voice.about) els.aboutVoice.textContent = data.voice.about;

  els.auto.checked = autoplay;
  buildRouteChips();
  buildMap();
  renderList();
  wire();
  if ('serviceWorker' in navigator && !IS_TEST) {
    navigator.serviceWorker.register('sw.js').catch(() => null);
  }
  if (DEEP_ROUTE) setFilter(`route:${DEEP_ROUTE}`);
  if (DEEP_STORY && byId.has(DEEP_STORY)) openCard(DEEP_STORY, { scroll: true });
  if (REPLAY) startReplay(REPLAY);
}

function buildRouteChips() {
  const bar = document.querySelector('.ol-filter');
  if (!bar) return;
  bar.querySelectorAll('[data-filter^="route:"]').forEach((b) => b.remove());
  const anchor = bar.querySelector('[data-filter="near"]');
  for (const r of routes) {
    if (!r.steps || !r.steps.some((s) => byId.has(s.pin))) continue;
    const b = document.createElement('button');
    b.className = 'ol-chip'; b.type = 'button'; b.dataset.filter = `route:${r.id}`;
    b.setAttribute('aria-pressed', 'false'); b.textContent = r.title;
    bar.insertBefore(b, anchor);
  }
}

function wire() {
  els.start.addEventListener('click', () => startWalk());
  els.stop.addEventListener('click', () => stopWalk());
  els.pocket.addEventListener('click', () => enterPocket());
  els.recenter.addEventListener('click', () => { followYou = true; if (lastPos && map) map.setView([lastPos.lat, lastPos.lng], Math.max(map.getZoom(), 16)); });
  els.auto.addEventListener('change', () => { autoplay = els.auto.checked; localStorage.setItem(AUTO_KEY, autoplay ? 'on' : 'off'); });
  els.nowToggle.addEventListener('click', () => togglePlay());
  els.nowSkip.addEventListener('click', () => skip());
  els.nowRead.addEventListener('click', () => {
    const show = els.nowTranscript.hidden;
    els.nowTranscript.hidden = !show;
    els.nowRead.textContent = show ? 'Hide' : 'Read';
  });
  els.nudgePlay.addEventListener('click', () => { els.nudge.hidden = true; resume(); });
  els.offline.addEventListener('click', () => saveOffline());
  document.querySelectorAll('.ol-chip').forEach((b) => b.addEventListener('click', () => setFilter(b.dataset.filter)));

  audio.addEventListener('ended', () => {
    if (audio.dataset.silent === '1' || audio.dataset.pending === '1') return; // unlock blip / mid-swap
    onEnded(currentId, { completed: true });
  });
  audio.addEventListener('error', () => {
    const pin = byId.get(currentId);
    if (!pin || audio.dataset.silent === '1' || audio.dataset.pending === '1') return;
    // A missing/broken MP3 must never wedge the walk: read it aloud instead.
    toast('Recording unavailable — reading it instead.');
    speak(pin, () => onEnded(pin.id, { completed: true }));
  });
  audio.addEventListener('timeupdate', () => {
    if (audio.duration) els.nowFill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
  });
  audio.addEventListener('pause', () => syncNowState());
  audio.addEventListener('play', () => syncNowState());

  // Pocket mode: three quick taps to exit (fabric pressure in a pocket can fake two).
  let taps = 0, tapTimer = null;
  els.pocketEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    taps += 1; clearTimeout(tapTimer);
    if (taps >= 3) { taps = 0; exitPocket(); return; }
    tapTimer = setTimeout(() => { taps = 0; }, 900);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (mode === 'walk') requestWakeLock();
    const pin = byId.get(currentId);
    if (!pin || !wantPlaying) return;
    if (pin.audio) { if (audio.paused) audio.play().catch(() => showNudge()); return; }
    // Speech: iOS drops utterances when the page is hidden. If nothing is speaking
    // or pending, treat the story as over so the walk keeps going.
    if (tts && !tts.paused && 'speechSynthesis' in window && !speechSynthesis.speaking && !speechSynthesis.pending) {
      onEnded(currentId, { completed: false, reason: 'lost' });
    }
  });

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => resume());
    navigator.mediaSession.setActionHandler('pause', () => pause());
    navigator.mediaSession.setActionHandler('nexttrack', () => skip());
  }
}

/* ---------- walk mode ---------- */
function startWalk() {
  unlockAudio();
  mode = 'walk';
  els.hero.hidden = true;
  els.walk.hidden = false;
  setStatus('Finding you…', 'Allow location when your phone asks.');
  requestWakeLock();
  count('walk_start');
  if (REPLAY) return; // replay feeds positions itself
  if (!('geolocation' in navigator)) { geoFail('This browser has no location. You can still tap any story below.'); return; }
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(onPosition, (err) => {
    if (err.code === 1) geoFail("Location is off for this site — stories won't start on their own. Tap any story below to play it, or allow location in Settings and try again.");
    else if (err.code === 3 && !lastPos) setStatus('Still looking for a GPS fix…', 'Step outside or near a window; it can take 20–30 seconds.');
    else if (!lastPos) geoFail("Couldn't get a location fix. Tap any story below to play it.");
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 25000 });
}

function stopWalk() {
  mode = 'browse';
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (replayTimer) { clearInterval(replayTimer); replayTimer = null; }
  releaseWakeLock();
  els.walk.hidden = true;
  els.hero.hidden = false;
  exitPocket();
}

function geoFail(msg) {
  setStatus('Browse mode', msg);
  els.walk.classList.add('ol-walk-failed');
}

function onPosition(p) {
  const pos = {
    lat: p.coords.latitude, lng: p.coords.longitude,
    accuracy: p.coords.accuracy, speed: p.coords.speed,
    ts: Date.now(),   // one clock for cooldown math (device geolocation clocks vary)
  };
  handlePosition(pos);
}

function handlePosition(pos) {
  lastPos = pos; lastFixAt = Date.now();
  updateYou(pos);
  if (SPIKE === 'here' && !pins.some((x) => x.id.startsWith('spike-'))) {
    pins = [...spikePins(pos), ...pins];
    byId = new Map(pins.map((x) => [x.id, x]));
    buildMarkers(); renderList();
    toast('Spike: two test pins dropped — one here, one 120 m north.');
  }
  const nearest = rank(pos, pins)[0];
  const accTxt = Number.isFinite(pos.accuracy) ? `±${Math.round(pos.accuracy)} m` : '';
  if (!autoplay) {
    setStatus(`Auto-play is off ${accTxt}`, 'Tap any story to play it.');
  } else {
    const r = step(eng, pos, pins);
    eng = r.state;
    const sup = r.actions.find((a) => a.type === 'suppress');
    if (sup?.reason === 'accuracy') setStatus(`GPS is fuzzy right now ${accTxt}`, "You're near a story — it'll start when the fix sharpens.");
    else if (sup?.reason === 'speed') setStatus('Moving fast', 'Stories wait until you slow to a walk.');
    else if (currentId) setStatus('Playing', `${byId.get(currentId)?.title || ''}`);
    else setStatus(`Listening for stories ${accTxt}`, nearest ? `Nearest: ${nearest.pin.title}, ${fmtDist(nearest.dist)} away.` : '');
    act(r.actions);
  }
  els.nearby.textContent = nearby(pos);
  if (filter === 'near' && Date.now() - lastNearRender > 5000) { lastNearRender = Date.now(); renderList(); }
  els.pocketStatus.textContent = currentId ? `Playing: ${byId.get(currentId)?.title}` : (nearest ? `Listening… nearest story ${fmtDist(nearest.dist)}` : 'Listening…');
}

function nearby(pos) {
  const top = rank(pos, pins).slice(0, 3);
  if (!top.length) return '';
  return 'Nearby: ' + top.map(({ pin, dist }) => `${pin.title} (${fmtDist(dist)})`).join(' · ');
}
function fmtDist(m) { return m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1609).toFixed(1)} mi`; }
function setStatus(a, b) { els.status.textContent = a; els.sub.textContent = b || ''; }

function act(actions) {
  for (const a of actions) {
    if (a.type === 'play') playPin(a.id, 'auto');
    else if (a.type === 'queue') toast(`Up next: ${byId.get(a.id)?.title}`);
  }
}

/* ---------- playback: ONE audio element, unlocked on the first tap ---------- */
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume().catch(() => null);
  } catch (e) { /* no WebAudio — fine, no chime */ }
  try {
    if (!audio.dataset.unlocked) {
      audio.dataset.silent = '1';
      audio.src = silentWav();
      audio.muted = false;
      const p = audio.play();
      if (p && p.then) p.then(() => { audio.dataset.unlocked = '1'; }).catch(() => null);
    }
  } catch (e) { /* ignore */ }
  if ('speechSynthesis' in window) {
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* ignore */ }
  }
}

async function playPin(id, via) {
  const pin = byId.get(id);
  if (!pin) return;
  const token = ++playToken;                 // a newer playPin() wins any race
  stopTts();
  audio.dataset.pending = '1';               // ignore 'ended' from whatever was loaded before
  audio.pause();
  clearTimeout(watchdog);
  currentId = id; wantPlaying = true;
  if (via === 'manual') { const r = manualPlay(eng, id, Date.now()); eng = r.state; }
  renderNow(pin);
  markVisited(id, 'started');
  highlightCard(id);
  if (!IS_TEST) count('play', id);
  await chime();
  if (token !== playToken) return;           // superseded during the chime
  if (pin.audio) {
    audio.dataset.silent = '0';
    audio.src = pin.audio;
    audio.dataset.pending = '0';
    audio.load();
    try { await audio.play(); els.nudge.hidden = true; }
    catch (e) { if (token === playToken) showNudge(); }
  } else {
    audio.dataset.pending = '0';
    speak(pin, () => onEnded(id, { completed: true }));
  }
  setMediaSession(pin);
  armWatchdog(pin);
}

/* If a story neither ends nor errors (lost utterance, stalled download, a
   nudge nobody tapped), end it ourselves so the walk keeps going. */
function armWatchdog(pin) {
  clearTimeout(watchdog);
  const est = pin.duration_s ? pin.duration_s * 1000 : Math.max(60000, ((pin.script || '').split(/\s+/).length / 2.4) * 1000);
  watchdog = setTimeout(() => {
    if (currentId === pin.id) onEnded(pin.id, { completed: false, reason: 'watchdog' });
  }, est + 25000);
}

function onEnded(id, { completed = false } = {}) {
  if (id == null || id !== currentId) return;   // stale: a newer story took over
  clearTimeout(watchdog);
  wantPlaying = false;
  if (completed) markVisited(id, 'done');
  lastEndedId = id;
  const r = storyEnded(eng, id, pins, Date.now());
  eng = r.state;
  els.nowFill.style.width = completed ? '100%' : els.nowFill.style.width;
  if (r.actions.length) { act(r.actions); return; }
  currentId = null;
  els.nowKicker.textContent = completed ? 'Finished' : 'Stopped';
  els.now.dataset.paused = 'true';
  highlightCard(null);
  if (mode === 'walk') setStatus('Listening for stories', 'The next one starts when you reach it.');
  checkRouteDone();
}

function togglePlay() { if (wantPlaying && !isPaused()) pause(); else resume(); }
function isPaused() { const pin = byId.get(currentId); if (!pin) return true; return pin.audio ? audio.paused : !(tts && tts.speaking && !tts.paused); }
function pause() {
  const pin = byId.get(currentId); if (!pin) return;
  wantPlaying = false; clearTimeout(watchdog);
  if (pin.audio) audio.pause(); else if (tts) { speechSynthesis.pause(); tts.paused = true; }
  syncNowState();
}
function resume() {
  if (!currentId && lastEndedId) { unlockAudio(); playPin(lastEndedId, 'manual'); return; }  // replay from the bar
  const pin = byId.get(currentId); if (!pin) return;
  wantPlaying = true;
  if (pin.audio) audio.play().catch(() => showNudge());
  else if (tts && tts.paused) { speechSynthesis.resume(); tts.paused = false; }
  else if (!tts) speak(pin, () => onEnded(pin.id, { completed: true }));
  syncNowState();
  armWatchdog(pin);
}
function skip() {
  const id = currentId; if (!id) return;
  stopTts(); audio.pause();
  const done = Boolean(byId.get(id)?.audio) && audio.duration > 0 && audio.currentTime / audio.duration > 0.6;
  onEnded(id, { completed: done });
}
function syncNowState() { els.now.dataset.paused = String(isPaused()); els.nowToggle.setAttribute('aria-label', isPaused() ? 'Play' : 'Pause'); }
function showNudge() { els.nudge.hidden = false; els.now.dataset.paused = 'true'; }

function renderNow(pin) {
  els.now.hidden = false;
  els.nowKicker.textContent = mode === 'walk' ? 'Now playing' : 'Playing';
  els.nowTitle.textContent = pin.title;
  els.nowSub.textContent = pin.stand_at || pin.tease || '';
  els.nowTranscript.textContent = pin.script || '';
  els.nowFill.style.width = '0%';
  els.now.dataset.paused = 'false';
}

function setMediaSession(pin) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: pin.title, artist: 'Btown Out Loud', album: 'Burlington, Vermont',
      artwork: [{ src: '../assets/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
  } catch (e) { /* ignore */ }
}

/* Speech fallback for stories without an MP3 yet. Sentence-chunked so Chrome
   doesn't cut long utterances; iOS needs the first utterance inside a gesture,
   which unlockAudio() covered. */
function speak(pin, onDone) {
  if (!('speechSynthesis' in window)) { toast('This browser has no voice; read the story below.'); els.nowTranscript.hidden = false; return; }
  const parts = (pin.script || pin.tease || pin.title).match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [pin.title];
  speechSynthesis.cancel();
  const voice = pickVoice();
  let i = 0;
  tts = { speaking: true, paused: false };
  const total = parts.length;
  const next = () => {
    if (!tts || tts.cancelled) return;
    if (i >= total) { tts = null; onDone && onDone(); return; }
    const u = new SpeechSynthesisUtterance(parts[i].trim());
    if (voice) u.voice = voice;
    u.rate = 0.98; u.pitch = 1;
    u.onend = () => { i += 1; els.nowFill.style.width = `${(i / total) * 100}%`; next(); };
    u.onerror = () => { i += 1; next(); };
    speechSynthesis.speak(u);
  };
  next();
}
function stopTts() { if (tts) { tts.cancelled = true; tts = null; } if ('speechSynthesis' in window) speechSynthesis.cancel(); }
function pickVoice() {
  if (!('speechSynthesis' in window)) return null;
  const vs = speechSynthesis.getVoices().filter((v) => /^en(-|_)?(US|GB|CA)?/i.test(v.lang));
  const pref = ['Samantha', 'Ava', 'Allison', 'Google US English', 'Microsoft Aria', 'Daniel', 'Karen'];
  for (const n of pref) { const v = vs.find((x) => x.name.includes(n)); if (v) return v; }
  return vs.find((v) => v.default) || vs[0] || null;
}

/* Two-note chime through WebAudio; silent if WebAudio isn't available. */
function chime() {
  return new Promise((resolve) => {
    if (!audioCtx || audioCtx.state !== 'running') { resolve(); return; }
    try {
      const t0 = audioCtx.currentTime;
      [[659.25, 0], [987.77, 0.16]].forEach(([f, dt]) => {
        const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + dt);
        g.gain.exponentialRampToValueAtTime(0.25, t0 + dt + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.5);
        o.connect(g).connect(audioCtx.destination);
        o.start(t0 + dt); o.stop(t0 + dt + 0.55);
      });
      setTimeout(resolve, 700);
    } catch (e) { resolve(); }
  });
}

/* A real RIFF/WAV of silence, built at runtime (no brittle base64). */
let silentUrl = null;
function silentWav() {
  if (silentUrl) return silentUrl;
  const sampleRate = 8000, seconds = 0.25, n = sampleRate * seconds;
  const buf = new ArrayBuffer(44 + n * 2); const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  silentUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return silentUrl;
}

/* ---------- wake lock + pocket mode ---------- */
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    if (wakeLock && !wakeLock.released) return;
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* low battery or unsupported — the user keeps the screen on themselves */ }
}
function releaseWakeLock() { try { wakeLock && wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; }
function enterPocket() { els.pocketEl.hidden = false; requestWakeLock(); }
function exitPocket() { els.pocketEl.hidden = true; }

/* ---------- map ---------- */
function buildMap() {
  if (typeof L === 'undefined') return;
  map = L.map('map', { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);
  buildMarkers();
  map.on('dragstart', () => { followYou = false; });
}
function buildMarkers() {
  if (!map) return;
  markers.forEach((m) => m.remove()); markers.clear();
  const bounds = [];
  for (const pin of pins) {
    const heard = Boolean(visited[pin.id]?.done);
    const m = L.circleMarker([pin.lat, pin.lng], {
      radius: 9, weight: 2, color: '#fff', fillColor: heard ? '#2E7D8A' : '#F2683C', fillOpacity: 0.95,
    }).addTo(map);
    m.bindPopup(`<strong>${esc(pin.title)}</strong>${esc(pin.tease || '')}<br><button class="ol-btn ol-btn-small ol-btn-primary" data-play="${esc(pin.id)}" type="button">Play</button>`);
    m.on('popupopen', (e) => {
      const btn = e.popup.getElement().querySelector('[data-play]');
      btn && btn.addEventListener('click', () => { unlockAudio(); playPin(pin.id, 'manual'); map.closePopup(); });
    });
    markers.set(pin.id, m);
    bounds.push([pin.lat, pin.lng]);
  }
  const core = pins.filter((p) => ['downtown', 'waterfront', 'old-north-end'].includes(p.hood)).map((p) => [p.lat, p.lng]);
  const fit = core.length >= 3 ? core : bounds;
  if (fit.length) map.fitBounds(fit, { padding: [28, 28], maxZoom: 16 });
}
function updateYou(pos) {
  if (!map) return;
  const ll = [pos.lat, pos.lng];
  if (!youMarker) {
    youMarker = L.circleMarker(ll, { radius: 7, weight: 3, color: '#fff', fillColor: '#2563EB', fillOpacity: 1 }).addTo(map);
    youCircle = L.circle(ll, { radius: pos.accuracy || 20, weight: 1, color: '#2563EB', fillColor: '#2563EB', fillOpacity: 0.08 }).addTo(map);
    map.setView(ll, 16);
  } else {
    youMarker.setLatLng(ll); youCircle.setLatLng(ll); youCircle.setRadius(pos.accuracy || 20);
    if (followYou) map.panTo(ll, { animate: true });
  }
}
function refreshMarker(id) {
  const m = markers.get(id); if (!m) return;
  m.setStyle({ fillColor: visited[id]?.done ? '#2E7D8A' : '#F2683C' });
}

/* ---------- list ---------- */
function currentRoute() { return filter.startsWith('route:') ? routes.find((r) => r.id === filter.slice(6)) : null; }
function setFilter(f) {
  filter = f;
  if (f === 'near' && !lastPos) toast('Tap Start walking first so I know where you are.');
  document.querySelectorAll('.ol-chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === f)));
  renderList();
}
function orderedPins() {
  const route = currentRoute();
  if (route) return route.steps.map((s) => ({ pin: byId.get(s.pin), step: s })).filter((x) => x.pin);
  let list = pins.map((pin) => ({ pin }));
  if (filter === 'unheard') list = list.filter(({ pin }) => !visited[pin.id]?.done);
  if (filter === 'near' && lastPos) list = rank(lastPos, pins).map(({ pin, dist }) => ({ pin, dist }));
  return list;
}
function renderList() {
  const route = currentRoute();
  els.storiesTitle.textContent = route ? route.title : (filter === 'unheard' ? 'Unheard stories' : filter === 'near' ? 'Nearest first' : 'All stories');
  els.routeNote.hidden = !route;
  if (route) els.routeNote.textContent = route.blurb || '';
  const items = orderedPins();
  els.list.innerHTML = items.map(({ pin, step, dist }, i) => cardHTML(pin, step, dist, i, Boolean(route))).join('');
  els.list.querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => { unlockAudio(); playPin(b.dataset.play, 'manual'); }));
  els.list.querySelectorAll('[data-read]').forEach((b) => b.addEventListener('click', () => {
    const body = b.closest('.ol-card').querySelector('[data-body]');
    body.hidden = !body.hidden; b.textContent = body.hidden ? 'Read' : 'Hide';
  }));
  els.list.querySelectorAll('[data-share]').forEach((b) => b.addEventListener('click', () => share(b.dataset.share)));
  if (currentId) highlightCard(currentId);
  checkRouteDone();
}
function cardHTML(pin, step, dist, i, inRoute) {
  const v = visited[pin.id] || {};
  const dur = pin.duration_s ? `${Math.round(pin.duration_s / 60)} min` : (pin.script ? `${Math.max(1, Math.round(pin.script.split(/\s+/).length / 150))} min` : '');
  const srcs = (pin.sources || []).filter((s) => /^https?:\/\//i.test(s.url || '')).map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`).join('');
  return `<li class="ol-card" data-id="${esc(pin.id)}" data-heard="${Boolean(v.done)}">
    <button class="ol-card-play" data-play="${esc(pin.id)}" type="button" aria-label="Play ${esc(pin.title)}">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
    </button>
    <div>
      <h3 class="ol-card-title">${inRoute ? `${i + 1}. ` : ''}${esc(pin.title)}</h3>
      <p class="ol-card-tease">${esc(pin.tease || '')}</p>
      <p class="ol-card-meta">
        ${dur ? `<span>${dur}</span>` : ''}
        ${pin.stand_at ? `<span>${esc(pin.stand_at)}</span>` : ''}
        ${dist != null ? `<span>${fmtDist(dist)} away</span>` : ''}
        ${v.done ? '<span class="ol-heard">✓ heard</span>' : ''}
      </p>
      <div class="ol-card-actions">
        <button class="ol-link-btn" data-read="${esc(pin.id)}" type="button">Read</button>
        <button class="ol-link-btn" data-share="${esc(pin.id)}" type="button">Share</button>
      </div>
    </div>
    <div class="ol-card-body" data-body="${esc(pin.id)}" hidden>
      <div class="ol-transcript">${esc(pin.script || '')}</div>
      ${srcs ? `<details class="ol-sources"><summary>Where this comes from</summary><ul>${srcs}</ul></details>` : ''}
    </div>
    ${inRoute && step && step.directions ? `<p class="ol-directions"><b>Next:</b> ${esc(step.directions)}${step.minutes_to_next ? ` <span>(~${step.minutes_to_next} min)</span>` : ''}</p>` : ''}
  </li>`;
}
function openCard(id, { scroll } = {}) {
  const card = els.list.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!card) return;
  const body = card.querySelector('[data-body]'); const btn = card.querySelector('[data-read]');
  if (body) { body.hidden = false; if (btn) btn.textContent = 'Hide'; }
  if (scroll) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const m = markers.get(id); if (m && map) { map.setView(m.getLatLng(), 17); m.openPopup(); }
}
function highlightCard(id) {
  els.list.querySelectorAll('.ol-card').forEach((c) => { c.dataset.playing = String(id != null && c.dataset.id === id); });
}
function checkRouteDone() {
  const route = currentRoute();
  const done = route && route.steps.every((s) => visited[s.pin]?.done);
  els.endCard.hidden = !done;
}
async function share(id) {
  const pin = byId.get(id);
  const url = `${location.origin}${location.pathname}?s=${encodeURIComponent(id)}`;
  const text = `${pin.title} — a two-minute Burlington story from Btown Out Loud`;
  try {
    if (navigator.share) { await navigator.share({ title: pin.title, text, url }); count('share', id); return; }
    await navigator.clipboard.writeText(url); toast('Link copied.'); count('share', id);
  } catch (e) { /* cancelled */ }
}

/* ---------- visited + counters ---------- */
function markVisited(id, stage) {
  const v = visited[id] || {};
  if (stage === 'started') v.started = Date.now();
  if (stage === 'done') v.done = Date.now();
  visited[id] = v;
  try { localStorage.setItem(VISITED_KEY, JSON.stringify(visited)); } catch (e) { /* full/private */ }
  refreshMarker(id);
  const card = els.list.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (card) card.dataset.heard = String(Boolean(v.done));
}
function loadJSON(k, fb) { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? fb; } catch (e) { return fb; } }

/* Counters: fail-soft, anonymous, only when online. SQL lives in out-loud/SUPABASE.sql. */
function count(kind, story = null) {
  if (IS_TEST || !navigator.onLine) return;
  try {
    fetch(`${SUPABASE_URL}/rest/v1/rpc/out_loud_event`, {
      method: 'POST', keepalive: true,
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_kind: kind, p_story: story }),
    }).catch(() => null);
  } catch (e) { /* ignore */ }
}

/* ---------- offline ---------- */
async function saveOffline() {
  if (!('caches' in window)) { els.offlineStatus.textContent = 'Not available in this browser.'; return; }
  const urls = pins.map((p) => p.audio).filter(Boolean);
  if (!urls.length) { els.offlineStatus.textContent = 'Stories use your phone\'s voice for now — nothing to download yet.'; return; }
  els.offline.disabled = true; els.offlineStatus.textContent = `Saving 0 / ${urls.length}…`;
  try {
    const c = await caches.open('out-loud-audio');
    let n = 0;
    let tried = 0;
    for (const u of urls) {
      try {
        const hit = await c.match(u);
        if (hit) n += 1;
        else { const r = await fetch(u); if (r.ok && r.status === 200) { await c.put(u, r); n += 1; } }
      } catch (e) { /* skip */ }
      tried += 1; els.offlineStatus.textContent = `Saving ${tried} / ${urls.length}…`;
    }
    els.offlineStatus.textContent = n === urls.length ? `Saved all ${n} stories for offline.` : `Saved ${n} of ${urls.length} — try again with better signal.`;
  } catch (e) { els.offlineStatus.textContent = 'Could not save right now.'; }
  els.offline.disabled = false;
}

/* ---------- replay + spike (dev/field tools) ---------- */
function spikePins(pos) {
  const north = (m) => pos.lat + m / 111320;
  return [
    { id: 'spike-here', title: 'Test story A (here)', tease: 'Where you started.', lat: pos.lat, lng: pos.lng, radius_m: 40, enabled: true,
      script: 'This is test story A. You are standing where you tapped Start. If you can hear this, the first trigger works. Now walk about a hundred and twenty meters north, or in any direction, and test story B should start on its own.' },
    { id: 'spike-north', title: 'Test story B (120 m north)', tease: 'The second trigger.', lat: north(120), lng: pos.lng, radius_m: 50, enabled: true,
      script: 'This is test story B. It started without a tap, which means auto-play of a second story works on this phone. Walk back toward A; it should not replay, because each story has a twenty-four hour cooldown.' },
  ];
}
function startReplay(routeId) {
  const route = routes.find((r) => r.id === routeId) || null;
  let order = route ? route.steps.map((s) => byId.get(s.pin)).filter(Boolean) : [];
  if (order.length < 2) order = pins.slice(0, 6);
  if (order.length < 2) { toast('Replay needs at least two pins.'); return; }
  // Synthesize a track: straight lines between pins at 1.4 m/s, 5 s fixes, 12× speed; stories end after 8 s.
  const track = [];
  let t = Date.now();
  for (let i = 0; i < order.length - 1; i++) {
    const a = order[i], b = order[i + 1];
    const d = haversineM(a, b); const steps = Math.max(2, Math.round(d / (1.4 * 5)));
    for (let k = 0; k <= steps; k++) {
      track.push({ lat: a.lat + (b.lat - a.lat) * (k / steps), lng: a.lng + (b.lng - a.lng) * (k / steps), accuracy: 12, speed: 1.4, ts: t });
      t += 5000;
    }
  }
  startWalk();
  let i = 0, startedAt = null;
  replayTimer = setInterval(() => {
    if (i >= track.length) { clearInterval(replayTimer); replayTimer = null; setStatus('Replay finished', ''); return; }
    handlePosition(track[i++]);
    if (currentId) { startedAt = startedAt ?? Date.now(); if (Date.now() - startedAt > 8000) { startedAt = null; skip(); } }
  }, 5000 / 12);
  toast(`Replaying ${route ? route.title : 'stories'} at 12×`);
}

/* ---------- bits ---------- */
let toastTimer = null;
function toast(msg) {
  let t = document.querySelector('.ol-toast');
  if (!t) { t = document.createElement('div'); t.className = 'ol-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Expose a tiny test hook for Playwright / the console.
window.__outLoud = { get state() { return eng; }, get pins() { return pins; }, get current() { return currentId; }, handlePosition, playPin, stopWalk };
