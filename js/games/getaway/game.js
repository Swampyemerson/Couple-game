// Getaway orchestrator: loading, renderer + dynamic resolution, lobby (host settings, live to
// the guest), the round timeline on the shared clock, the fixed-step chase (cars, traffic,
// PITs, spikes, oil, bust / escape authority), pause / resume, practice vs AI and split screen,
// camera, HUD, audio and the test hook. Design notes: docs/games/getaway.md.
import { DT, MAX_STEPS, MAX_STEPS_SLOW, CAR, DAMAGE, RULES, NITRO, CAM, TRAFFIC } from './tune.js';
import { sanitizeSetup, stepRule, loadSaved, saveSetup, fmt, DEFAULTS } from './rules.js';
import { createGeo } from './geo.js';
import { newCar, placeCar, stepCar, carContact, resolveCar, resolvePair, contactImpulse, applyImpulse, judgePit, pitEffect } from './car.js';
import { makePalette, makeUniforms, setGfxTier } from './gfx.js';
import { buildWorld } from './world.js';
import { createCarView, createWheels, createTrafficView } from './cars.js';
import { createRenderer, createGpuPacer, gfxSetting, setGfxSetting, TIERS as GFX_TIERS } from './render.js';
import { createTraffic } from './traffic.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { newPad, readPad, createKeys, createTouch, createTilt } from './input.js';
import { createHud, makeMapImage, loadingCard, errorCard, lobbyCard, settingsSheet, introCard, resultCard, finalCard, pauseCard, howToCard, bindTap, esc } from './hud.js';
import { createLink } from './link.js';
import { createDriver, AI_LEVELS, AI_LEVEL_LABELS } from './ai.js';
import { MAPS } from './maps/index.js';
import { liveryFor, liveryRows, checkUnlocks, LIVERIES } from './liveries.js';
import { recordRound, recordMatch, recordsLine, fmtSec, dayKey, dayOfYear, DAILY, dailyScore, dailyText, dailyKey, dailyBoard } from './records.js';

const AB = ['a', 'b'];
const PH = { loading: 0, lobby: 1, intro: 2, count: 3, chase: 4, result: 5, final: 6, wait: 7 };
const PZ = { hidden: 1, gl: 2, menu: 4 };
const STALE_MS = 400; // the partner's newest sample older than this (or 2.2× its usual interval): its car is a ghost (not solid, drawn faded) until the stream resumes
const F_BOOST = 1; const F_BRAKE = 2; const F_HAND = 4; const F_SPIN = 8; const F_FLAT = 16; const F_SIREN = 32; const F_SKID = 64; const F_WATER = 128;
const DEV_KEY = 'getaway.device.v1';
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapA = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const other = (w) => (w === 'a' ? 'b' : 'a');
const MAP_IDS = MAPS.map((m) => m.id);
// The match flow (ms). Round 0 gets the full intro card and a 3-2-1; later rounds a short intro only
// when the start spot moves (every 2 rounds), else straight into a 2-1 with a role stamp. The result
// card shows at +700 ms and the next round starts at +4.5 s (+6 s with news), sooner when both players tap it away.
// result: the between-round card auto-advances this long after the round ends (tap skips after
// skipAfter); resultHold when either phone's card has a record, streak or unlock line to read
const FLOW = { intro: 3400, introMove: 2000, count0: 3000, count: 2000, result: 4500, resultHold: 6000, card: 700, skipAfter: 1200, finalCard: 4200, rematchLead: 700, sudden: 45 };
const MAP_SPAN = 900; // m across the zoomed map's longer side
const QUICK = { rounds: 2, roundTime: 60, spikes: 2, tiebreak: 'sudden' }; // the lobby's 'Quick chase' preset (a match in under 4 min)
const strHash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

export function createGame(el, api) {
  const live = api.mode === 'live';
  const isHost = live ? !!api.isHost : true;
  const me = live ? api.me : 'a';
  const TUNE = (typeof window !== 'undefined' && window.__gtwTune) || {};
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const phoneish = coarse && Math.min(screen.width, screen.height) < 600;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let dead = false;
  const timers = []; const offs = [];
  const later = (fn, ms) => { const t = setTimeout(() => { if (!dead) fn(); }, ms); timers.push(t); if (timers.length > 200) timers.splice(0, 100); return t; };

  // ── DOM ──
  const root = document.createElement('div');
  root.className = 'g-gtw' + (coarse ? ' touch' : '');
  root.innerHTML = '<div class="gtw-gl"></div><div class="gtw-surface"></div>';
  el.appendChild(root);
  const glWrap = root.querySelector('.gtw-gl'); const surface = root.querySelector('.gtw-surface');
  root.style.setProperty('--me', `var(--p-${live ? api.me : 'a'})`);
  const device = Object.assign({ steer: 'slider', localMode: 'ai', practiceRole: 'runner', cam: null, sens: 'normal', dead: 'normal', tiltZero: null, aiLevel: 'normal', seenHow: false, livery: { runner: 0, cop: 0 }, music: 'on', emotes: 'on' }, lsGet(DEV_KEY, {}));
  if (!device.livery || typeof device.livery !== 'object') device.livery = { runner: 0, cop: 0 };
  // shared per-person data (bests, unlocks, careers): core's api.data() / setData(); absent in old shells
  const gdata = () => (typeof api.data === 'function' ? api.data() || {} : {});
  const gset = (patch) => { if (typeof api.setData === 'function' && Object.keys(patch).length) api.setData(patch); };
  /** The livery person w's car is drawn with for `kind`: my pick if I've earned it; the partner's as told over the link; the AI plain. */
  function liveryOf(w, kind) {
    if (S.liveryForce) return P2[w].livery[kind] | 0; // tests / screenshots
    if (live ? w === me : w === human()) return liveryFor(gdata(), personOf(w), kind, device.livery[kind]);
    if (live) return P2[w].livery[kind] | 0;
    return 0;
  }
  if (!AI_LEVELS.includes(device.aiLevel)) device.aiLevel = 'normal';
  const STEER_RANGE = { low: 96, normal: 72, high: 54 }; const TILT_RANGE = { low: 32, normal: 24, high: 17 }; const DEAD = { small: 0.03, normal: 0.06, large: 0.12 };
  const steerCfg = () => ({ range: STEER_RANGE[device.sens] || 72, tiltRange: TILT_RANGE[device.sens] || 24, dead: DEAD[device.dead] ?? 0.06 });
  if (!['split', 'ai', 'daily'].includes(device.localMode) || (coarse && device.localMode === 'split')) device.localMode = 'ai';
  if (phoneish && device.localMode === 'split') device.localMode = 'ai';
  const audio = createAudio({ getCtx: typeof api.audio === 'function' ? () => api.audio() : null, mutedFn: typeof api.muted === 'function' ? () => api.muted() : null });

  // ── state ──
  const S = {
    phase: 'loading', setup: sanitizeSetup({ ...(loadSaved() || {}), first: 'a' }, MAP_IDS.filter((id) => !MAPS.find((m) => m.id === id).stub).concat(MAP_IDS)), setupVer: 0,
    sheet: false, match: null, R: null, paused: false, pausedAt: 0, resumeAt: 0, reasons: 0, partnerPz: 0, partnerReady: false,
    localMode: live ? 'live' : device.localMode, practiceRole: device.practiceRole, mapId: null, mapIdx: -1, loading: false,
    stats: null, lastNow: 0, slowT: 0, slowK: 1, tSec: 0, ending: false, finalShown: false,
  };
  if (!MAPS.find((m) => m.id === S.setup.map && !m.stub)) S.setup.map = MAPS.find((m) => !m.stub).id;
  { // the last open died while building a map (iOS kills a tab that runs out of memory): open on
    // the lightest map, and on a phone drop to low graphics unless the player chose a level
    const crashed = lsGet('getaway.loading.v1', null);
    const light = MAPS.find((m) => !m.stub);
    if (crashed && Date.now() - (crashed.t || 0) < 3 * 86400e3) {
      const m = MAPS.find((x) => x.id === crashed.map);
      if (crashed.map !== light.id) { S.setup.map = light.id; S.crashNote = `${m ? m.name : 'That map'} didn’t finish loading last time, so we opened ${light.name}.`; }
      if (phoneish && gfxSetting() === 'auto') { setGfxSetting('low'); S.crashNote = (S.crashNote || 'The game closed while loading last time.') + ' Graphics are on Low (Settings).'; }
    }
    try { localStorage.removeItem('getaway.loading.v1'); } catch { /* ignore */ }
  }
  const split = () => !live && S.localMode === 'split';
  const ai = () => !live && (S.localMode === 'ai' || S.localMode === 'daily'); // (the Daily chase is a practice round vs a Hard AI cop)
  const daily = () => !!(S.match && S.match.daily);
  const human = () => (live ? me : 'a');
  const aiW = 'b';
  // (cached arrays: viewers() is called several times a frame and inside the substep loop)
  const VIEWERS_AB = ['a', 'b']; const VIEWERS_A = ['a']; const VIEWERS_B = ['b'];
  const viewers = () => (split() && hud2 && S.R ? VIEWERS_AB : human() === 'a' ? VIEWERS_A : VIEWERS_B);
  const isViewer = (w) => w === human() || (split() && hud2 && !!S.R);
  const nameOf = (w) => (ai() ? (w === human() ? 'You' : 'AI') : api.name(w));
  // whose records / liveries a car slot is: live and split their own; practice: the device's owner
  const owner = api.owner === 'a' || api.owner === 'b' ? api.owner : 'a';
  const personOf = (w) => (live || split() ? w : owner);

  // players
  function mkPlayer(w) {
    return { w, car: newCar('runner'), pad: newPad(), inp: { steer: 0, gas: 0, brake: 0, hand: false, nitro: false }, driver: null, auto: false, view: null, rig: null,
      prevRL: [0, 0, 0], prevRR: [0, 0, 0], smokeT: 0, dustT: 0, sparkT: 0, oilLeft: 1, spikesLeft: 0, lastHit: 0, stats: { top: 0, near: 0, pits: 0, spikes: 0, hits: 0, topBoost: 0 }, livery: { runner: 0, cop: 0 },
      remote: { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, r: 0, st: 0, hp: 100, fl: 0, es: 0, nt: 0, lv: -1, rpm: 0, ph: 0, rd: -1, pz: 0, ry: 0, sv: 0, tp: 0, sl: 0 },
      shown: { x: 0, z: 0, y: 0, yaw: 0, init: false }, hpSeen: 100, nearIds: new Map(), esc: 0, escPeak: 0, escPeakT: 0, escMax: 0, stopT: 0, spikeHit: new Set(), oilHit: new Set(), losT: 0, los: true, seenT: 0, cover: false, lastSeen: null, hurtT: 0 };
  }
  const P2 = { a: mkPlayer('a'), b: mkPlayer('b') };
  const local = (w) => !live || w === me;
  const roleOf = (w) => (S.R ? (S.R.runner === w ? 'runner' : 'cop') : (w === S.setup.first ? 'runner' : 'cop'));
  const runnerW = () => (S.R ? S.R.runner : S.setup.first);
  const copW = () => other(runnerW());
  const rules = () => (S.match ? S.match.rules : S.setup.rules);

  // ── net ──
  const link = createLink(api, { delay: 100, onLink: () => onLinked(), onUnlink: () => { addReason('stale'); } });
  const clock = () => link.now();
  // test-only contact log (live car-vs-car contacts, my trajectory, bumps received)
  const TLOG = typeof window !== 'undefined' && window.__gtwTest ? { contacts: [], traj: [], bumpsIn: [], bumpsOut: [] } : null;
  let partnerHere = live ? !!api.partnerHere : true;
  if (live) offs.push(api.onPartnerHere((h) => { partnerHere = !!h; }));

  // ── 3D ──
  let THREE = null; let renderer = null; let P = null; let U = null; let world = null; let geo = null; let fx = null; let traffic = null; let mapImg = null;
  let carViews = null; let wheels = null; let trafficMeshes = null; let cams = {}; let farCam = null; let ready3D = false; let glLost = false; let raf = 0;
  let W = 1; let H = 1; let baseDpr = Math.min(window.devicePixelRatio || 1, 2); let scale = TUNE.maxDpr ? 1 : 0.85; let minScale = 0.55; let gfx = null;
  const perf = { dts: new Float32Array(600), work: new Float32Array(600), n: 0, calls: 0, tris: 0, maxCalls: 0, maxTris: 0, scaleDowns: 0, scaleUps: 0, programs0: 0, ewma: 16.7, lowFor: 0, checkT: 0, frames: 0, level: 0, resizes: 0, sinceDown: 1e9, sinceUp: 1e9, sinceStep: 1e9, hold: 20, fakeMs: 0 };
  const hud = createHud(root, { name: (w) => nameOf(w) }, { split: false, touch: coarse });
  let hud2 = null; // split-screen HUD (two views)
  const H0 = () => (split() && hud2 ? hud2 : hud);
  let input = null; let touchIn = null; let tilt = null;

  if (!live && phoneish && device.localMode === 'split') device.localMode = 'ai';

  async function load() {
    hud.card(loadingCard('Starting the engine…', 0.05, human()), 'solid');
    try { THREE = await api.three(); } catch (e) {
      if (dead) return;
      hud.card(errorCard('Couldn’t load the 3D engine. Check your connection. (' + ((e && e.message) || 'network') + ')'), 'solid');
      return;
    }
    if (dead) return;
    try { init3D(); } catch (e) {
      console.error(e);
      hud.card(errorCard('This device couldn’t start WebGL graphics. Try another browser, or restart the app.'), 'solid');
      return;
    }
    await loadMap(!live && S.localMode === 'daily' && !S.crashNote ? dailyMap() : S.setup.map); // on failure loadMap shows the error card; a retry boots from there
  }
  /** The first map is in: the lobby and the frame loop start. */
  function bootDone() {
    if (ready3D || dead) return;
    ready3D = true;
    toLobby();
    if (S.crashNote) { const n = S.crashNote; S.crashNote = null; later(() => hud.view().hint(n, 6000), 400); }
    raf = requestAnimationFrame(frame);
  }

  function init3D() {
    P = makePalette(api.tokens());
    hud.setPalette(P);
    U = makeUniforms(THREE, P);
    // graphics tier (low / mid / high), MSAA and the pixel-ratio cap come from render.js
    setupRenderer();
    farCam = new THREE.PerspectiveCamera(60, 1, 5, 60000);
    for (const w of AB) cams[w] = { cam: new THREE.PerspectiveCamera(60, 1, 1, 700), x: 0, y: 20, z: 0, d: 8, yaw: 0, fov: 60, shake: 0, mode: device.cam || null, look: 0, init: false };
    resize();
    const ro = new ResizeObserver(() => resize()); ro.observe(root); offs.push(() => ro.disconnect());
    const keys = createKeys({ split: false, me: human(), pads: { a: P2.a.pad, b: P2.b.pad }, onAct: (w, a) => onAct(w, a), enabled: () => !dead && !S.sheet });
    input = keys;
    touchIn = createTouch({ surface, root, pad: P2[human()].pad, onAct: (a) => onAct(human(), a), enabled: () => !dead, steerEl: root.querySelector('.gtw-steer'), stats: inputStats, cfg: steerCfg, onSteer: () => { if (!device.steered) { device.steered = true; lsSet(DEV_KEY, device); root.classList.add('steered'); } } });
    root.classList.toggle('steered', !!device.steered); // (the dashed STEER hint fades once you've steered; How to play brings it back)
    tilt = createTilt(P2[human()].pad, steerCfg);
    if (device.tiltZero != null) tilt.setZero(device.tiltZero);
    // tilt needs a permission prompt from a tap on iOS; elsewhere it can come back on by itself
    if (device.steer === 'tilt' && !(window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === 'function')) tilt.enable();
    root.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
    window.addEventListener('keydown', unlockKey);
    offs.push(() => window.removeEventListener('keydown', unlockKey));
    document.addEventListener('visibilitychange', onVis); offs.push(() => document.removeEventListener('visibilitychange', onVis));
    offs.push(bindTap(root, '[data-l]', onClick));
  }
  function setupRenderer() {
    gfx = createRenderer(THREE, { phoneish, coarse, tune: TUNE });
    renderer = gfx.renderer; baseDpr = gfx.dpr; minScale = gfx.cfg.minScale; if (!TUNE.maxDpr) scale = 1;
    renderer.info.autoReset = false;
    renderer.autoClear = false;
    renderer.setPixelRatio(Math.min(baseDpr * scale, TUNE.maxDpr || 9));
    renderer.domElement.className = 'gtw-cv';
    glWrap.appendChild(renderer.domElement);
    renderer.domElement.addEventListener('webglcontextlost', onLost, false);
    renderer.domElement.addEventListener('webglcontextrestored', onRestored, false);
  }
  /** Use a graphics tier from now on (world rebuilds pick it up; MSAA stays as created). */
  function applyTier(t) {
    const tier = GFX_TIERS[t] ? t : 'mid';
    setGfxTier(tier); if (gfx) { gfx.tier = tier; gfx.cfg = { ...GFX_TIERS[tier], msaa: gfx.cfg.msaa }; }
    baseDpr = Math.min(window.devicePixelRatio || 1, GFX_TIERS[tier].dpr); minScale = GFX_TIERS[tier].minScale;
    if (!TUNE.maxDpr) scale = 1;
    resize();
  }
  const autoTier = () => (gfx && gfx.info && (gfx.info.software || !gfx.info.webgl2) ? 'low' : phoneish || coarse ? 'mid' : 'high');
  const mapQuality = () => { const t = gfx ? gfx.tier : phoneish ? 'mid' : 'high'; return t === 'low' ? 'low' : t === 'mid' || phoneish ? 'mid' : 'high'; };
  /** Throw the WebGL context away and start a fresh one (the phone dropped ours), then rebuild the map. */
  function rebuildGraphics(lower) {
    S.glStuck = false;
    disposeWorld();
    try { renderer.domElement.remove(); renderer.dispose(); } catch { /* ignore */ }
    if (lower) setGfxSetting('low');
    try { setupRenderer(); } catch (e) { console.error(e); hud.card(errorCard('This phone couldn’t restart the graphics. Close the game and open it again.', { title: 'Graphics trouble' }), 'solid'); return; }
    glLost = false; resize();
    const id = S.mapId || S.setup.map; S.mapId = null;
    loadMap(id).then((ok) => { if (ok) { delReason('gl'); if (S.phase === 'lobby') renderLobby(true); } });
  }
  const unlockKey = () => audio.unlock();
  const inputStats = { ignored: 0 };

  function setSplitKeys(on) {
    if (input) input.destroy();
    input = createKeys({ split: on, me: human(), pads: { a: P2.a.pad, b: P2.b.pad }, onAct: (w, a) => onAct(w || human(), a), enabled: () => !dead && !S.sheet });
    root.classList.toggle('split', on);
    if (on && !hud2) {
      hud2 = createHud(root, { name: (w) => nameOf(w) }, { split: true, touch: false });
      hud2.setPalette(P);
      // (its buttons are inside root, so root's tap binding covers them)
    }
    if (hud2) hud2.root.hidden = !on;
    hud.root.querySelector('.gtw-view.full').hidden = on;
  }

  // ── map loading ──
  let loadSeq = 0;
  const LOAD_KEY = 'getaway.loading.v1'; // set while a map builds: still there at the next open = it crashed
  const LOAD_SLOW = TUNE.loadSlow || 20000; const LOAD_FAIL = TUNE.loadFail || 75000;
  /** Free the current world (and everything built against its materials) before building another:
   *  a phone never holds two maps at once. */
  function disposeWorld() {
    if (carViews) {
      for (const v of Object.values(carViews)) { detach(v.group); v.dispose(); }
      if (wheels) { detach(wheels.mesh); wheels.dispose(); }
      if (trafficMeshes) { for (const m of trafficMeshes.meshes) detach(m); trafficMeshes.dispose(); }
      carViews = null; wheels = null; trafficMeshes = null;
    }
    if (fx) { for (const m of [fx.puffs, fx.sparks, fx.skids, fx.strips, fx.oils, fx.lines]) detach(m); fx.dispose(); fx = null; }
    if (world) { world.dispose(); world = null; }
    traffic = null; mapImg = null; S.mapId = null;
  }
  /**
   * Load a map behind the loading card. Never hangs silently: errors and a watchdog end on an
   * error card (Retry / lower quality / Dockside); the host can cancel a big map from the lobby.
   * Resolves true once that map is in.
   */
  async function loadMap(id) {
    const entry = MAPS.find((m) => m.id === id && !m.stub) || MAPS.find((m) => !m.stub);
    if (S.mapId === entry.id && world) return true;
    const seq0 = loadSeq + 1;
    S.loadFail = null;
    lsSet(LOAD_KEY, { map: entry.id, t: Date.now() });
    S.loadAt = performance.now(); S.loadProg = performance.now();
    const dog = setInterval(() => {
      if (dead || loadSeq !== seq0 || !S.loading) { clearInterval(dog); return; }
      const idle = performance.now() - S.loadProg;
      if (idle > LOAD_FAIL) { clearInterval(dog); loadSeq++; loadFailed(entry, new Error('timeout')); } else if (idle > LOAD_SLOW && !S.loadSlow) { S.loadSlow = true; if (S.loadShow) S.loadShow(); }
    }, 1000);
    timers.push(dog);
    let ok = false;
    try { await loadMapRaw(entry.id); ok = !dead && loadSeq === seq0 && S.mapId === entry.id && !!world; } catch (e) {
      console.error('getaway: map load failed', e);
      if (!dead && loadSeq === seq0) loadFailed(entry, e);
    }
    clearInterval(dog);
    if (!ok) return false;
    try { localStorage.removeItem(LOAD_KEY); } catch { /* ignore */ }
    S.lastGood = entry.id;
    if (isHost && S.setup.map === entry.id) saveSetup(S.setup); // remembered only once it has loaded
    if (!ready3D) bootDone();
    return true;
  }
  function loadFailed(entry, e) {
    S.loading = false; S.loadingCard = true;
    const timeout = e && e.message === 'timeout';
    S.loadFail = entry.id;
    try { localStorage.removeItem(LOAD_KEY); } catch { /* ignore */ }
    const btns = [['loadretry', 'Try again', 'gtw-go']];
    if (!gfx || gfx.tier !== 'low') btns.push(['loadlow', 'Try lower quality']);
    const dock = MAPS.find((m) => !m.stub);
    if (isHost && entry.id !== dock.id) btns.push(['loaddock', `Play ${dock.name} instead`]);
    hud.card(errorCard(timeout ? `${entry.name} is taking far too long to load on this ${phoneish ? 'phone' : 'device'}.` : `${entry.name} didn’t load. That’s usually memory: a lower quality setting helps.`, { title: 'Map trouble', buttons: btns, detail: timeout ? '' : String((e && e.message) || '').slice(0, 120) }), 'solid');
  }
  async function loadMapRaw(id) {
    const seq = ++loadSeq;
    const entry = MAPS.find((m) => m.id === id && !m.stub) || MAPS.find((m) => !m.stub);
    if (S.mapId === entry.id && world) return;
    S.loading = true; S.loadSlow = false;
    if (S.failLoads > 0) { S.failLoads--; await new Promise((r) => setTimeout(r, 50)); throw new Error('test: forced load failure'); }
    const tip = Math.floor(Math.random() * 6);
    const canCancel = () => isHost && S.phase === 'lobby' && entry.id !== (MAPS.find((m) => !m.stub) || {}).id;
    let lastPct = 0; let lastText = '';
    const showLoad = (pct, text) => {
      lastPct = Math.max(lastPct, pct); lastText = text || lastText; S.loadProg = performance.now();
      if (seq === loadSeq && (S.phase === 'loading' || S.loadingCard)) hud.card(loadingCard(lastText, lastPct, human(), { cancel: canCancel(), tip, slow: S.loadSlow }), 'solid');
    };
    S.loadShow = () => showLoad(lastPct, lastText);
    S.loadingCard = true; // every map load shows the loading card (and pauses rendering)
    showLoad(0.08, `Loading ${entry.name}…`);
    await new Promise((r) => setTimeout(r, 16));
    if (dead || seq !== loadSeq) return;
    const t0 = performance.now();
    if (typeof entry.prepare === 'function' && !entry.__prepared) {
      // the map generates its layout in slices (≤ ~70 ms each) before anything reads it
      let sliceT = performance.now();
      const slice = () => { const n = performance.now(); if (n - sliceT < 12) return Promise.resolve(); return new Promise((r) => setTimeout(() => { sliceT = performance.now(); r(); }, 0)); };
      showLoad(0.09, `Surveying ${entry.name}…`);
      try { await entry.prepare({ THREE, slice, seeded: (n) => { let a = (n >>> 0) || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }, quality: mapQuality(), palette: P, dark: P.dark }); } catch (e) { console.error('getaway: map prepare failed', e); }
      entry.__prepared = true;
      if (dead || seq !== loadSeq) return;
    }
    const L = { prepare: Math.round(performance.now() - t0) }; let lt = performance.now();
    // the old map goes before the new one is built (memory: one world at a time)
    disposeWorld();
    showLoad(0.1, `Mapping the streets of ${entry.name}…`);
    const g = createGeo(entry);
    // the road graph (AI routes, traffic junctions) in slices: it's 30–200 ms in one go
    while (g.buildNav(8) < 1) { await new Promise((r) => setTimeout(r, 0)); if (dead || seq !== loadSeq) return; }
    L.geo = Math.round(performance.now() - lt);
    const w = await buildWorld(THREE, entry, g, P, U, { quality: mapQuality(), onProgress: (p, t) => showLoad(0.1 + p * 0.8, t), dead: () => dead || seq !== loadSeq, budget: TUNE.sliceMs || 12 });
    if (dead || seq !== loadSeq || !w) { if (w) w.dispose(); return; }
    if (world) disposeWorld(); // (a racing load got in first)
    // (S.mapId only once the GPU warm-up below is done: until then the map isn't "in")
    world = w; geo = g; S.mapIdx = MAPS.indexOf(entry); S.mapEntry = entry;
    dynApply(); // a fresh world's shadow map takes the current quality rung
    const alive = () => !dead && seq === loadSeq && world === w;
    const yieldFrame = () => new Promise((r) => { let done = false; const go = () => { if (!done) { done = true; setTimeout(r, 0); } }; requestAnimationFrame(go); setTimeout(go, 60); });
    U.uSiren.value.w = 0;
    renderer.setClearColor(new THREE.Color().fromArray(world.fogC), 1);
    for (const k of AB) { cams[k].cam.far = world.fogFar + 80; cams[k].cam.updateProjectionMatrix(); }
    lt = performance.now();
    mapImg = makeMapImage(geo, entry, P, phoneish ? 1100 : 1400);
    L.mapImage = Math.round(performance.now() - lt);
    showLoad(0.91, 'Starting the engines…');
    await yieldFrame(); if (!alive()) return;
    lt = performance.now();
    carViews = { runA: createCarView(THREE, P, U, 'runner', P.a, world.mats), runB: createCarView(THREE, P, U, 'runner', P.b, world.mats), cop: createCarView(THREE, P, U, 'cop', null, world.mats), cop2: createCarView(THREE, P, U, 'cop', null, world.mats) };
    wheels = createWheels(THREE, P, world.mats, 8);
    // traffic: four silhouettes × near / mid detail + far boxes, tinted per instance (cars.js)
    trafficMeshes = createTrafficView(THREE, P, world.mats, TRAFFIC.max, world.cfg ? { nearR: world.cfg.carNear, midR: world.cfg.carMid } : {});
    // (the world's caster scene: what the car shadow map renders; it's a child of world.scene)
    for (const v of Object.values(carViews)) world.casters.add(v.group);
    world.casters.add(wheels.mesh); for (const m of trafficMeshes.meshes) world.casters.add(m);
    fx = createFx(THREE, world.scene, P, U, world.mats);
    traffic = createTraffic(geo, entry.id, rules().traffic);
    S.loadMs = Math.round(performance.now() - t0);
    S.buildStats = world.stats;
    L.cars = Math.round(performance.now() - lt);
    await yieldFrame(); if (!alive()) return;
    lt = performance.now();
    // shaders + geometry to the GPU in frame-sized slices behind the card (one go is 1–2 s on a phone)
    let shown = 0; const wu = await warmUp(entry, alive, yieldFrame, (k) => { S.loadProg = performance.now(); if (S.loadProg - shown > 150) { shown = S.loadProg; showLoad(0.92 + 0.08 * k); } });
    if (!wu) return;
    L.warmUp = Math.round(performance.now() - lt); L.warmBusy = wu.busy; L.warmMaxMs = wu.maxMs; L.warmSlices = wu.slices; L.warmMax = wu.maxWhat; L.warmGap = wu.maxGap; L.warmGapAt = wu.gapWhat; L.readyAt = Math.round(performance.now()); L.startAt = Math.round(t0);
    S.mapId = entry.id;
    S.buildStats = { ...world.stats, load: L };
    S.loading = false; S.loadingCard = false;
    // nav grid for the AI, in the background
    navBuild();
    if (S.phase === 'lobby') { hud.card(null); renderLobby(true); }
    if (S.pendingRound) { const d = S.pendingRound; S.pendingRound = null; applyRound(d); }
  }
  function navBuild() {
    if (!geo || geo.navReady()) return;
    const g0 = geo;
    const step = () => { if (dead || geo !== g0) return; if (g0.buildNav(4) < 1) later(step, 16); };
    step();
  }

  /**
   * Get the new map onto the GPU before it's shown: every shader program compiled, every geometry
   * and texture uploaded. Done in slices with a frame in between (the loading card stays up), so no
   * single task blocks for long: on iOS one big first render of a whole map is 1–2 s of frozen page.
   * Slices: programs a few objects at a time (renderer.compile on a view of the scene), then each
   * program's first draw on its own (the driver builds the pipeline there: in SwiftShader 50–250 ms
   * a program, and several in one slice were the load's longest block), then the geometry a few MB
   * at a time (a 1×1 render of just those meshes), then the light dressing and shadow pass, then
   * one full render. Resolves null if the load was overtaken. Meanwhile the canvas is out of the
   * document and each slice waits on a fence, polled (render.js createGpuPacer): the GPU's share of
   * a slice no longer freezes the page at the next compositing step.
   */
  let pacer = null; // render.js createGpuPacer: the warm-up's canvas out of the document + fences
  async function warmUp(entry, alive, yieldFrame, onStep) {
    if (!pacer || pacer.renderer !== renderer) pacer = createGpuPacer(renderer);
    const gate = pacer; const tok = {};
    gate.detach(tok);
    try { return await warmRun(entry, alive, yieldFrame, onStep, gate); } finally { if (pacer === gate && gate.renderer === renderer) gate.attach(tok); } // (a rebuilt renderer's old canvas stays out)
  }
  async function warmRun(entry, alive, yieldFrame, onStep, gate) {
    const budget = TUNE.warmMs || 24; const stat = { busy: 0, maxMs: 0, slices: 0, maxWhat: '', maxGap: 0, gapWhat: '' };
    let t0 = performance.now(); let what = '';
    // upload slice size adapts to how fast the GPU swallowed the last one (the frame after it):
    // aim for ~70 ms a slice; grows on a fast GPU, shrinks on a slow one (or SwiftShader)
    let cap = 0.4e6; let sent = 0; const most = 12; const capMax = phoneish ? 4e6 : 8e6;
    const cut = async (k) => {
      const t1 = performance.now(); const d = t1 - t0; stat.busy += d; stat.slices++; if (d > stat.maxMs) { stat.maxMs = Math.round(d); stat.maxWhat = what; }
      if (onStep) onStep(k);
      const fs = gate.fence(); // (the GPU finishes this slice before the next goes: polled, not waited on)
      await yieldFrame(); if (fs) await gate.drain(fs); t0 = performance.now();
      const gap = t0 - t1; if (gap > stat.maxGap) { stat.maxGap = Math.round(gap); stat.gapWhat = what; }
      if (what === 'upload' && sent > 5e4) cap = Math.max(1.5e5, Math.min(capMax, cap * 0.4 + 0.6 * sent * (70 / Math.max(gap, 10))));
      return alive();
    };
    const list = world.warmList();
    const far = []; world.farScene.traverse((o) => { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) far.push(o); });
    for (const c of world.chunks) c.group.visible = true;
    const cam = cams[human()].cam;
    const p = (entry.spawns && entry.spawns[0]) ? entry.spawns[0].runner : { x: 0, z: 0 };
    cam.position.set(p.x, 30, p.z + 40); cam.lookAt(p.x, 0, p.z); cam.updateMatrixWorld();
    const fxOn = () => {
      fx.setSpeedLines(0.5, 1); fx.puff(p.x, 1, p.z, 0, 0, 0, 1, 0, 0.1, 1, 1, 1); fx.spark(p.x, 1, p.z, 1, 1, 1, 0.1);
      fx.setStrips([{ x: p.x, y: 0, z: p.z, yaw: 0, len: 6, k: 1 }]); fx.setOils([{ x: p.x, y: 0, z: p.z, r: 2, k: 1 }]);
      for (const m of trafficMeshes.meshes) { m.count = 1; m.visible = true; }
      if (fx.crash) fx.crash(p.x, 1, p.z, 0, 0, 0, 1);
      fx.update(0.016, cam);
    };
    fxOn();
    for (const m of list) m.visible = true;
    // 1) programs: renderer.compile over a view of the scene that lists only this slice's objects
    //    (same fog / lights / environment, so the cache keys match the real render's)
    const progs = (sc, objs) => {
      const view = Object.create(sc);
      const batch = [null];
      view.traverse = (cb) => { for (const o of batch) cb(o); };
      return async () => {
        for (let i = 0; i < objs.length; i++) {
          batch[0] = objs[i];
          what = 'compile';
          try { renderer.compile(view, cam); } catch (e) { console.warn('getaway: warm-up compile', e); }
          if (performance.now() - t0 > budget && !(await cut(0.3 * i / objs.length))) return false;
        }
        return true;
      };
    };
    if (!(await progs(world.scene, list)())) return null;
    if (!(await progs(world.farScene, far)())) return null;
    // 1b) first draws, one program per slice: drivers (and SwiftShader) build a program's pipeline
    //     lazily at its first draw — 50–250 ms each in software GL — and several in one slice were
    //     the longest block of the whole load. One object per program, a 1×1 viewport, 3 vertices.
    const firstDraw = async (sc, objs) => {
      const seen = new Set(); const pick = [];
      for (const o of objs) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        let key = '';
        for (const m of ms) { const pp = m && renderer.properties.get(m).programs; if (pp) key += [...pp.values()].map((q) => q.id).join(',') + ';'; }
        if (!key || seen.has(key)) continue;
        seen.add(key); pick.push(o);
      }
      const vis = objs.map((o) => o.visible);
      for (const o of objs) o.visible = false;
      // one program per slice: grouping the cheap ones (doubling while the frame after a slice
      // stayed short) put two heavy ones together again and brought the stall back
      const per = 1;
      for (let i = 0; i < pick.length;) {
        what = 'firstdraw';
        const on = pick.slice(i, i + per); i += on.length;
        const fc = on.map((o) => o.frustumCulled); const dr = on.map((o) => (o.geometry && o.geometry.drawRange ? o.geometry.drawRange.count : null));
        on.forEach((o, k) => { o.visible = true; o.frustumCulled = false; if (dr[k] != null) o.geometry.drawRange.count = 3; });
        try { renderer.setViewport(0, 0, 1, 1); renderer.render(sc, cam); } catch (e) { console.warn('getaway: warm-up first draw', e); }
        on.forEach((o, k) => { o.visible = false; o.frustumCulled = fc[k]; if (dr[k] != null) o.geometry.drawRange.count = dr[k]; });
        if (!(await cut(0.3))) { objs.forEach((q, k) => { q.visible = vis[k]; }); return false; }
      }
      objs.forEach((q, k) => { q.visible = vis[k]; });
      return true;
    };
    if (!(await firstDraw(world.scene, list))) return null;
    if (!(await firstDraw(world.farScene, far))) return null;
    // 2) geometry (and textures): render a slice of meshes at a time (see cap above) into a 1×1 viewport
    const bytes = (m) => { const g = m.geometry; if (!g || !g.attributes) return 0; let b = g.index && g.index.array ? g.index.array.byteLength : 0; for (const k in g.attributes) { const a = g.attributes[k]; if (a && a.array) b += a.array.byteLength; } return b; };
    const upload = async (sc, objs, base) => {
      const vis = objs.map((o) => o.visible);
      for (const o of objs) o.visible = false;
      for (let i = 0; i < objs.length;) {
        let b = 0; const on = [];
        while (i < objs.length && (on.length === 0 || (b < cap && on.length < most && performance.now() - t0 < budget))) { const o = objs[i++]; o.visible = vis[i - 1]; b += bytes(o); on.push(o); }
        sent = b;
        what = 'upload';
        // (what's behind the camera too; one triangle each: the buffers go up whole, the GPU barely draws)
        const fc = on.map((o) => o.frustumCulled); const dr = on.map((o) => o.geometry && o.geometry.drawRange && o.geometry.drawRange.count);
        for (const o of on) { o.frustumCulled = false; if (o.geometry && o.geometry.drawRange) o.geometry.drawRange.count = 3; }
        try { renderer.setViewport(0, 0, 1, 1); renderer.render(sc, cam); } catch (e) { console.warn('getaway: warm-up upload', e); }
        on.forEach((o, k) => { o.visible = false; o.frustumCulled = fc[k]; if (o.geometry && o.geometry.drawRange) o.geometry.drawRange.count = dr[k]; });
        if (!(await cut(base + 0.3 * i / objs.length))) { objs.forEach((o, k) => { o.visible = vis[k]; }); return false; }
      }
      objs.forEach((o, k) => { o.visible = vis[k]; });
      return true;
    };
    if (!(await upload(world.scene, list, 0.3))) return null;
    if (!(await upload(world.farScene, far, 0.6))) return null;
    // 3) the light dressing and the shadow pass (their own programs + render target)
    fxOn();
    what = 'lights';
    if (world.warm) world.warm(renderer, cam);
    if (!(await cut(0.8))) return null;
    // 4) anything left (state-dependent variants): one full render, then tidy up
    what = 'final';
    try { renderer.compile(world.scene, cam); renderer.compile(world.farScene, cam); } catch (e) { console.warn(e); }
    // (a 1×1 viewport and the view's usual culling: all state set up, no full-screen software-GL frame)
    try { world.update(cam, 0, 0); } catch (e) { console.warn(e); }
    renderer.setViewport(0, 0, 1, 1);
    try { renderer.clear(); renderer.render(world.farScene, cam); renderer.render(world.scene, cam); } catch (e) { console.warn(e); }
    renderer.setViewport(0, 0, W, H);
    fx.setSpeedLines(0, 1); fx.setStrips([]); fx.setOils([]); fx.clear();
    for (const m of trafficMeshes.meshes) { m.count = 0; m.visible = false; }
    if (!(await cut(1))) return null;
    perf.programs0 = renderer.info.programs ? renderer.info.programs.length : 0;
    perf.programNames0 = renderer.info.programs.map((q) => q.name + ':' + q.cacheKey.length + ':' + q.id);
    stat.busy = Math.round(stat.busy);
    return stat;
  }

  function resize() {
    if (!renderer) return;
    const r = root.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    renderer.setPixelRatio(Math.min(baseDpr * scale, TUNE.maxDpr || 9));
    renderer.setSize(W, H, false);
    root.classList.toggle('portrait', H > W);
    root.classList.toggle('short', H < 520 && W > H);
    if (fx) fx.setSpeedLines(0, W / H);
  }
  function onLost(e) {
    e.preventDefault(); glLost = true; addReason('gl');
    // iOS often never gives a dropped context back: offer a reload instead of waiting forever
    later(() => { if (!glLost || dead) return; S.glStuck = true; if (!S.R || S.phase === 'lobby' || S.phase === 'loading') hud.card(errorCard('The phone ran short of memory and dropped the graphics.', { title: 'Graphics paused', buttons: [['glreload', 'Reload graphics', 'gtw-go'], ['loadlow', 'Reload at low quality']] }), 'solid'); }, TUNE.glStuck || 2500);
  }
  function onRestored() {
    glLost = false; resize(); delReason('gl');
    if (S.glStuck) { S.glStuck = false; if (S.phase === 'lobby') renderLobby(true); }
    // the world's GPU-only geometry has no CPU copy left to re-upload: rebuild it (world.js `released`)
    if (world && world.released && S.mapId) { const id = S.mapId; S.mapId = null; loadMap(id); }
  }
  function onVis() { if (document.hidden) addReason('hidden'); else delReason('hidden'); }

  // ── pause reasons (mine) ──
  const reasonBits = { hidden: PZ.hidden, gl: PZ.gl, menu: PZ.menu };
  const softReasons = new Set();
  function addReason(r) { if (reasonBits[r]) S.reasons |= reasonBits[r]; else softReasons.add(r); }
  function delReason(r) { if (reasonBits[r]) S.reasons &= ~reasonBits[r]; else softReasons.delete(r); }

  // ── lobby ──
  /** Back to the lobby. rematch: a 'Rematch!' card instead, while the host starts the next match on
   *  the loaded map (frame loop: autoStart) — no remount, no map rebuild. */
  function toLobby(rematch = false) {
    S.phase = 'lobby'; S.match = null; S.R = null; S.paused = false; S.ending = false; S.finalShown = false; S.finalDone = false; S.pauseCard = null; S.result = null;
    S.menu = false; S.appMenu = false; delReason('menu'); S.slowT = 0; S.stopT = 0; S.hitSlowT = 0;
    for (const w of AB) { const p = P2[w]; p.pad.auto = null; p.auto = false; }
    S.rematchCard = rematch; S.rematchAt = performance.now(); S.autoStart = rematch && isHost ? performance.now() : 0;
    if (rematch) hud.card(pauseCard('Rematch!', isHost ? (live ? `Same map, roles swap. Waiting for ${api.name(other(me))}…` : 'Same map. Here we go…') : `${api.name(other(me))} is starting it…`), 'dim');
    else { hud.card(null); renderLobby(true); }
    api.setStatus(null);
    if (isHost && live) link.send('setup', S.setup);
  }
  /** The app's Rematch: true = handled in place (the world stays built); false = remount. */
  function onRematch() {
    if (dead || !ready3D || !world || S.loading || glLost || S.glStuck) return false;
    if (live && (!partnerHere || !link.ready)) return false;
    if (S.phase !== 'final' && S.phase !== 'lobby') return !!S.R; // the host's new match got here first: keep it
    if (isHost && !ai() && S.match && S.match.first) S.setup = sanitizeSetup({ ...S.setup, first: other(S.match.first) }, MAP_IDS, S.setup.first);
    toLobby(true);
    return true;
  }
  /** The app's ≡ sheet: over a running chase it pauses like the ‖ button (live: both phones). */
  function onMenu(open) {
    if (open) { if (S.R && !S.R.over && S.phase !== 'lobby' && S.phase !== 'final' && !S.menu) { S.appMenu = true; S.menu = true; addReason('menu'); if (H0().mapOpen) closeMap(); } }
    else if (S.appMenu) { S.appMenu = false; S.menu = false; S.sheet = false; renderSheet(); delReason('menu'); }
  }
  let lobbyKey = '';
  function renderLobby(force = false) {
    if (S.phase !== 'lobby' || S.loadingCard || S.glStuck || S.rematchCard) return;
    const pl = live && P2[other(me)].remote; const partnerLoading = !!(pl && partnerHere && pl.ph === PH.lobby && pl.sv !== S.mapIdx + 1);
    const portraitPhone = phoneish && H > W;
    const ns = live || S.localMode === 'split' ? '' : 'ai_';
    const records = recordsLine(gdata(), ns, (w) => (ns ? (w === owner ? 'You' : api.name(w)) : api.name(w)), ns ? [owner] : ['a', 'b']);
    const dl = !live ? dailyInfo() : null;
    const key = JSON.stringify([S.setup, S.sheet, S.localMode, S.practiceRole, S.partnerReady, partnerHere, partnerLoading, device.aiLevel, device.steer, device.sens, device.dead, device.cam, device.seenHow, S.meReady, portraitPhone, gfxSetting(), S.loading, device.livery, S.sheet && liveryRows(gdata(), live ? me : personOf(human()), device.livery), records, dl]);
    if (!force && key === lobbyKey) return;
    lobbyKey = key;
    hud.card(lobbyCard({ name: nameOf }, {
      maps: MAPS, setup: S.setup, canEdit: isHost, local: !live, localMode: S.localMode, practiceRole: S.practiceRole,
      splitOK: !coarse && !phoneish, waitingFor: 'a', partnerReady: S.partnerReady, me: human(), meReady: !!S.meReady,
      levels: AI_LEVELS, levelLabels: AI_LEVEL_LABELS, aiLevel: device.aiLevel, partnerHere, partnerName: live ? api.name(other(me)) : '', partnerLoading,
      portraitPhone, newcomer: !device.seenHow, loading: S.loading, records, daily: dl,
    }), 'clear bottom');
    drawPlans();
    renderSheet();
  }
  /** The lobby's Daily chase panel: today's map, the rules, today's board. */
  function dailyInfo() {
    const id = dailyMap(); const m = MAPS.find((x) => x.id === id) || {};
    const real = MAPS.filter((x) => !x.stub); const want = real[dayOfYear() % real.length];
    const b = dailyBoard(gdata()); const rt = DAILY.roundTime;
    const board = AB.filter((w) => b[w] > 0).sort((x, y) => b[y] - b[x]).map((w) => ({ w, name: api.name(w), text: dailyText(b[w], rt) }));
    return { mapId: id, title: `Today: ${m.name || 'Dockside'}`, short: `Today: ${m.name || 'Dockside'}, same start for both of you.`, how: 'One 2:00 run as the runner vs a Hard AI cop. Survive, or lose the heat for a bonus. Your best try today counts.', board, note: want && want.id !== id ? `${want.name} is today’s map; Low graphics plays ${m.name} instead.` : '' };
  }
  /** The bottom sheet: settings or the how-to-play card (lobby and pause menu). */
  function renderSheet() {
    if (S.sheet === 'how') { hud.showSheet(howToCard({ touch: coarse, split: split() })); return; }
    const inMatch = !!S.R && S.phase !== 'lobby';
    const gs = gfxSetting();
    hud.showSheet(S.sheet ? settingsSheet(inMatch ? null : S.setup.rules, { canEdit: isHost, live, device: { touch: coarse, steer: device.steer, sens: device.sens, dead: device.dead, gfx: gs, cam: device.cam || rules().camera, music: device.music, emotes: device.emotes, live, liveries: liveryRows(gdata(), live ? me : personOf(human()), device.livery), gfxNote: gs === 'auto' && gfx ? `Auto picked ${({ low: 'Low', mid: 'Medium', high: 'High' })[gfx.tier] || gfx.tier} for this ${phoneish ? 'phone' : 'device'}` : '' } }) : null);
  }
  function drawPlans() {
    hud.over.querySelectorAll('canvas[data-plan]').forEach((cv) => {
      const id = cv.dataset.plan; const g = cv.getContext('2d');
      g.fillStyle = P && P.dark ? '#1d2230' : '#e9e4d2'; g.fillRect(0, 0, cv.width, cv.height);
      if (mapImg && S.mapId === id) { const s = Math.min(cv.width / mapImg.cv.width, cv.height / mapImg.cv.height); g.drawImage(mapImg.cv, (cv.width - mapImg.cv.width * s) / 2, (cv.height - mapImg.cv.height * s) / 2, mapImg.cv.width * s, mapImg.cv.height * s); }
      else { g.fillStyle = '#8885'; g.font = '900 20px sans-serif'; g.textAlign = 'center'; g.fillText(S.loading ? '…' : '?', cv.width / 2, cv.height / 2 + 7); }
    });
  }
  function setSetup(next, send = true) {
    const ok = MAP_IDS;
    const prevMap = S.setup.map;
    S.setup = sanitizeSetup(next, ok, S.setup.first);
    S.setupVer++;
    // (the map is remembered only once it has loaded, so a map that crashes the phone isn't reopened)
    if (isHost) saveSetup({ ...S.setup, map: S.lastGood && S.setup.map !== S.mapId ? S.lastGood : S.setup.map });
    if (send && isHost && live) link.send('setup', S.setup);
    if (S.setup.map !== prevMap && !(MAPS.find((m) => m.id === S.setup.map) || {}).stub) loadMap(S.setup.map).then(() => renderLobby(true));
    if (traffic && geo && (traffic.density !== S.setup.rules.traffic || traffic.mapId !== S.mapId)) traffic = createTraffic(geo, S.mapId, S.setup.rules.traffic);
    renderLobby(true);
  }
  link.on('setup', (d) => { if (!isHost && d && S.phase === 'lobby') setSetup(clone(d), false); });
  link.on('ready', (d) => { if (isHost) { S.partnerReady = !!(d && d.on); renderLobby(true); } });

  function onClick(t) {
    if (!t || !t.dataset) return;
    audio.unlock();
    const k = t.dataset.l;
    switch (k) {
      case 'start': if (device.steer === 'tilt' && tilt && !tilt.on) tilt.enable(); hostStart(); break; // (tilt permission needs a tap)
      case 'ready': link.send('ready', { on: (S.meReady = !S.meReady) }); if (device.steer === 'tilt' && tilt && !tilt.on) tilt.enable(); renderLobby(true); audio.tick(); break;
      case 'settings': S.sheet = 'settings'; renderLobby(true); renderSheet(); audio.tick(); break;
      case 'howto': S.sheet = 'how'; if (device.steered) { device.steered = false; lsSet(DEV_KEY, device); root.classList.remove('steered'); } renderLobby(true); renderSheet(); audio.tick(); break;
      case 'howclose': if (!device.seenHow) { device.seenHow = true; lsSet(DEV_KEY, device); } S.sheet = false; renderLobby(true); renderSheet(); audio.tick(); break;
      case 'sheetclose': S.sheet = false; renderLobby(true); renderSheet(); audio.tick(); break;
      case 'ailevel': if (AI_LEVELS.includes(t.dataset.v)) { device.aiLevel = t.dataset.v; lsSet(DEV_KEY, device); renderLobby(true); audio.tick(); } break;
      case 'dev': setDevice(t.dataset.k, t.dataset.v); audio.tick(); break;
      case 'calib': if (tilt) { device.tiltZero = tilt.calibrate(); lsSet(DEV_KEY, device); H0().view(human()).hint('Tilt set: hold it like this for straight ahead.', 1800); audio.tick(); } break;
      case 'pmenu': openMenu(); break;
      case 'quit': if (!live) { S.menu = false; delReason('menu'); S.sheet = false; renderSheet(); toLobby(); audio.tick(); } break;
      case 'loadcancel': cancelLoad(); audio.tick(); break;
      case 'loadretry': { const id = S.loadFail || S.setup.map; S.loadFail = null; S.mapId = null; loadMap(id).then((ok) => { if (ok && S.phase === 'lobby') { S.loadingCard = false; renderLobby(true); } }); break; }
      case 'loadlow': { const id = S.loadFail || S.mapId || S.setup.map; S.loadFail = null; setGfxSetting('low'); if (glLost || S.glStuck) { rebuildGraphics(true); break; } applyTier('low'); S.mapId = null; loadMap(id).then((ok) => { if (ok && S.phase === 'lobby') { S.loadingCard = false; renderLobby(true); } }); break; }
      case 'loaddock': { const d = MAPS.find((m) => !m.stub); S.loadFail = null; if (isHost) { S.setup = sanitizeSetup({ ...S.setup, map: d.id }, MAP_IDS, S.setup.first); S.setupVer++; if (live) link.send('setup', S.setup); } loadMap(d.id).then((ok) => { if (ok && S.phase === 'lobby') { S.loadingCard = false; renderLobby(true); } }); break; }
      case 'glreload': rebuildGraphics(false); break;
      case 'map': {
        if (!isHost) return;
        const i = MAP_IDS.indexOf(S.setup.map); const n = MAP_IDS.length;
        const j = (i + (+t.dataset.dir) + n) % n;
        setSetup({ ...S.setup, map: MAP_IDS[j] }); audio.tick(); break;
      }
      case 'first': if (isHost) { setSetup({ ...S.setup, first: t.dataset.v }); audio.tick(); } break;
      case 'rule': if (isHost) { setSetup({ ...S.setup, rules: stepRule(S.setup.rules, t.dataset.k, +t.dataset.step) }); audio.tick(); } break;
      case 'lmode': {
        if (!['ai', 'split', 'daily'].includes(t.dataset.v) || (t.dataset.v === 'split' && (coarse || phoneish))) break;
        S.localMode = t.dataset.v; device.localMode = S.localMode; lsSet(DEV_KEY, device);
        // the Daily chase has its own map: have it built before Start (and the lobby's back after)
        const want = S.localMode === 'daily' ? dailyMap() : S.setup.map;
        if (want !== S.mapId && !S.loading) loadMap(want).then((ok) => { if (ok && S.phase === 'lobby') { S.loadingCard = false; renderLobby(true); } });
        renderLobby(true); audio.tick(); break;
      }
      case 'prole': S.practiceRole = t.dataset.v; device.practiceRole = S.practiceRole; lsSet(DEV_KEY, device); renderLobby(true); audio.tick(); break;
      case 'steer':
        device.steer = t.dataset.v; lsSet(DEV_KEY, device);
        if (device.steer === 'tilt') tilt.enable().then((r) => { if (r !== 'ok') { device.steer = 'slider'; lsSet(DEV_KEY, device); hud.view().hint(r === 'denied' ? 'Motion access was refused, so the slider stays.' : 'This device has no tilt sensor.'); } renderLobby(true); renderSheet(); });
        else { tilt.disable(); renderLobby(true); renderSheet(); }
        break;
      case 'skip': skipResult(); break;
      case 'finskip': if (performance.now() - (S.finalAt || 0) > 1200) { audio.tick(); finishNow(); } break;
      case 'quick': if (isHost) { setSetup({ ...S.setup, rules: { ...S.setup.rules, ...QUICK } }); audio.tick(); H0().view(human()).hint('Quick chase: 2 rounds of 1:00, 2 spike strips, sudden death if level', 2400); } break;
      case 'resume': S.menu = false; S.sheet = false; renderSheet(); delReason('menu'); if (glLost) return; delReason('tap'); audio.tick(); break;
      default:
    }
  }

  /** A per-device setting from the sheet (steering, sensitivity, dead zone, graphics, camera). */
  function setDevice(k, v) {
    if (k === 'steer') { onClick({ dataset: { l: 'steer', v } }); return; }
    if (k === 'sens' && ['low', 'normal', 'high'].includes(v)) device.sens = v;
    else if (k === 'dead' && ['small', 'normal', 'large'].includes(v)) device.dead = v;
    else if (k === 'cam' && (v === 'near' || v === 'far')) { device.cam = v; for (const w of AB) cams[w].mode = v; }
    else if ((k === 'music' || k === 'emotes') && (v === 'on' || v === 'off')) { device[k] = v; if (k === 'music') audio.setMusic(v === 'on'); }
    else if ((k === 'liveryrunner' || k === 'liverycop') && LIVERIES[k.slice(6)][v | 0]) { const kind = k.slice(6); if (!liveryFor(gdata(), live ? me : personOf(human()), kind, v | 0) && (v | 0)) return; device.livery[kind] = v | 0; sendLivery(); }
    else if (k === 'gfx') {
      setGfxSetting(v);
      const t = v === 'auto' ? autoTier() : v;
      if (gfx && t !== gfx.tier) {
        applyTier(t);
        // the map is rebuilt for the new level now in the lobby; mid-match it waits for the next map load
        if (S.phase === 'lobby' && S.mapId) { const id = S.mapId; S.mapId = null; S.sheet = false; renderSheet(); loadMap(id).then((ok) => { if (ok && S.phase === 'lobby') { S.loadingCard = false; renderLobby(true); } }); }
        else H0().view(human()).hint('New graphics level applies from the next map load.', 2400);
      }
    }
    lsSet(DEV_KEY, device);
    renderLobby(true); renderSheet();
  }
  /** Host: stop loading a big map and go back to the last one that loaded. */
  function cancelLoad() {
    if (!S.loading || !isHost || S.phase !== 'lobby') return;
    loadSeq++;
    const dock = MAPS.find((m) => !m.stub).id;
    const back = S.lastGood && S.lastGood !== S.setup.map ? S.lastGood : dock;
    S.setup = sanitizeSetup({ ...S.setup, map: back }, MAP_IDS, S.setup.first); S.setupVer++;
    if (live) link.send('setup', S.setup);
    if (world && S.mapId === back) { S.loading = false; S.loadingCard = false; renderLobby(true); return; }
    S.loading = false;
    loadMap(back).then((ok) => { if (ok && S.phase === 'lobby') { S.loadingCard = false; renderLobby(true); } });
  }
  /** The in-game menu (pause). Live: pauses both phones. */
  function openMenu() {
    if (!S.R || S.R.over || S.phase === 'lobby' || S.phase === 'final') return;
    S.menu = true; addReason('menu'); audio.tick();
  }

  // ── match start ──
  /** Host: start a match. lead: ms before round 0 begins; quiet: no hints when it can't yet (rematch). */
  function hostStart(lead, quiet = false) {
    if (!isHost || S.phase !== 'lobby' || S.loading || !ready3D) return false;
    const hint = (t) => { if (!quiet) hud.view().hint(t); };
    const daily = !live && S.localMode === 'daily';
    const mapId = daily ? dailyMap() : S.setup.map;
    const entry = MAPS.find((m) => m.id === mapId);
    if (!entry || entry.stub) { hint('That map is still being built. Pick another one.'); return false; }
    if (live) {
      const ps = P2[other(me)].remote;
      if (!partnerHere || !link.ready) { hint(`Waiting for ${api.name(other(me))}…`); return false; }
      if (ps.ph !== PH.lobby || ps.sv !== S.mapIdx + 1) { hint(`${api.name(other(me))} is still loading the map…`); return false; }
    }
    S.rematchCard = false;
    // the Daily chase: today's map, start and seed for both of you; one 2:00 round as the runner vs a Hard AI cop
    const first = daily ? human() : ai() ? (S.practiceRole === 'runner' ? human() : aiW) : S.setup.first;
    const seed = daily ? (strHash('getaway-daily:' + dayKey()) % 2147483646) + 1 : ((Math.random() * 2147483646) | 0) + 1;
    const rules0 = daily ? { ...DEFAULTS, roundTime: DAILY.roundTime, rounds: 1, tiebreak: 'time' } : { ...S.setup.rules };
    const match = { id: Math.random().toString(36).slice(2, 9), map: mapId, rules: rules0, first, seed, rounds: daily ? 1 : TUNE.rounds || S.setup.rules.rounds, scores: { a: 0, b: 0 }, hist: [], mode: S.localMode, daily: daily ? dayKey() : null, aiLevel: daily ? 'hard' : device.aiLevel };
    const R = nextRound(match, 0, null, lead);
    if (live) link.urgent('match', { match, R });
    applyMatch(match, R);
    return true;
  }
  /** Today's Daily chase map (the same for both of you): the real maps in turn by day of the year. */
  function dailyMap() {
    const real = MAPS.filter((m) => !m.stub);
    const m = real[dayOfYear() % real.length];
    // a phone on Low graphics plays the lightest map instead (noted in the lobby)
    return gfx && gfx.tier === 'low' && phoneish ? real[0].id : m.id;
  }
  /** Round idx of a match. sd: the sudden-death decider ({ runner }). lead: ms until it begins. */
  function nextRound(match, idx, sd = null, lead = live ? 700 : 150) {
    const spawns = (MAPS.find((m) => m.id === match.map) || MAPS[0]).spawns || [];
    const sp = spawns.length ? (match.seed + Math.floor(idx / 2)) % spawns.length : 0;
    const runner = sd ? sd.runner : idx % 2 === 0 ? match.first : other(match.first);
    const at = clock() + lead;
    // the intro card only when it tells you something new: round 0, a new start spot, the decider
    const moved = idx === 0 || !!sd || Math.floor(idx / 2) !== Math.floor((idx - 1) / 2);
    const intro = !moved ? 0 : TUNE.intro != null ? TUNE.intro : idx === 0 ? FLOW.intro : FLOW.introMove;
    const count = TUNE.count != null ? TUNE.count : idx === 0 ? FLOW.count0 : FLOW.count;
    const t0 = at + intro + count;
    const endAt = t0 + (TUNE.roundMs || (sd ? FLOW.sudden : match.rules.roundTime) * 1000);
    return { idx, runner, spawn: sp, at, t0, endAt, intro, sd: sd ? 1 : 0 };
  }
  function applyMatch(match, R) {
    S.rematchCard = false; S.autoStart = 0; S.finalShown = false; S.finalDone = false; S.result = null;
    S.match = { ...match, rules: sanitizeSetup({ rules: match.rules }, MAP_IDS).rules };
    S.sheet = false; hud.showSheet(null);
    setSplitKeys(split());
    if (S.mapId !== match.map) { S.pendingRound = R; S.phase = 'wait'; S.loadingCard = true; loadMap(match.map); return; }
    if (!traffic || traffic.density !== S.match.rules.traffic || traffic.mapId !== S.mapId) traffic = createTraffic(geo, S.mapId, S.match.rules.traffic);
    applyRound(R);
  }
  const detach = (o) => { if (o && o.parent) o.parent.remove(o); };
  const clone = (o) => JSON.parse(JSON.stringify(o)); // room payloads arrive frozen
  link.on('match', (d) => { if (!isHost && d && d.match) applyMatch(clone(d.match), clone(d.R)); });
  link.on('round', (d) => { if (!isHost && d && S.match && d.R) { const c = clone(d); S.match.scores = c.scores || S.match.scores; S.match.hist = c.hist || S.match.hist; applyRound(c.R); } });

  function applyRound(R) {
    if (S.R && S.R.idx === R.idx && !S.R.over) return;
    S.R = { ...R, over: false, result: null, spikes: [], oils: [], seq: 0 };
    S.phase = 'wait'; S.ending = false; S.final15 = false; S.dailyPassed = false; S.copBoxT = 0; S.dailyRv = S.match && S.match.daily ? dailyRival() : null;
    S.slowT = 0; S.slowK = 1;
    S.paused = false; S.resumeAt = 0; S.pausedAt = 0; // a pause never carries into a new round
    const entry = S.mapEntry;
    const sp = (entry.spawns && entry.spawns[R.spawn]) || { runner: { x: 0, z: 0, yaw: 0 }, cop: { x: 0, z: 80, yaw: 0 } };
    const rules0 = rules();
    for (const w of AB) {
      const p = P2[w]; const role = roleOf(w);
      const c = newCar(role);
      const s = role === 'runner' ? sp.runner : sp.cop;
      placeCar(c, s.x, s.z, s.yaw, geo);
      c.nitro = role === 'runner' ? NITRO[rules0.nitro].start : NITRO.cop.start;
      p.car = c; p.esc = 0; p.escPeak = 0; p.escPeakT = 0; p.escMax = 0; p.seenT = 0; p.cover = false; p.stopT = 0; p.oilLeft = role === 'runner' ? 1 : 0; p.spikesLeft = role === 'cop' && !R.sd ? rules0.spikes : 0;
      p.stats = { top: 0, near: 0, pits: 0, spikes: 0, hits: 0, topBoost: 0 };
      p.spikeHit.clear(); p.oilHit.clear(); p.nearIds.clear(); p.hpSeen = 100; p.lastSeen = null; p.los = true; p.shown.init = false; p.corr = null;
      p.prevRL[0] = NaN; p.prevRR[0] = NaN;
      if (p.rig) p.rig = null;
      cams[w].init = false; cams[w].mode = cams[w].mode || rules0.camera;
      p.driver = null;
      if (ai() && w === aiW) { p.driver = createDriver(geo, role, { seed: S.match.seed + R.idx, level: S.match.aiLevel || device.aiLevel || 'normal' }); p.pad.auto = p.driver.out; }
      else if (p.auto) { p.driver = createDriver(geo, role, { seed: 7 + R.idx, level: 'hard' }); p.pad.auto = p.driver.out; }
      else p.pad.auto = null;
    }
    if (traffic) traffic.clearWrecks();
    // no civilian car on the spawn points for the first seconds of the chase (traffic time 600 is
    // the go; the same zones on both devices)
    if (traffic && traffic.setClear) traffic.setClear([sp.runner, sp.cop].map((q) => ({ x: q.x, z: q.z, r: 30, t1: 606 })));
    world.resetProps();
    fx.clear();
    hud.card(null);
    if (touchIn) touchIn.reset();
    api.setStatus(null);
    api.setScore(S.match.scores);
  }

  // ── rounds: end + next ──
  function endRound(outcome, reason, extra) {
    const R = S.R; if (!R || R.over || S.ending) return;
    S.ending = true;
    const rw = R.runner;
    const st = P2[rw].stats; const cs = P2[other(rw)].stats;
    const rc = posOf(rw); const cc = posOf(other(rw));
    // (local modes count a PIT on both cars' stats; live each device counts its own: never sum them)
    const res = { idx: R.idx, outcome, reason, at: clock(), stats: { top: Math.max(st.top, P2[rw].car.topSpeed), near: st.near, pits: Math.max(cs.pits, st.pits), spikes: st.spikes }, ran: Math.max(0, clock() - R.t0), hp: Math.round(Math.max(0, P2[rw].car.hp)), escMax: Math.round(P2[rw].escMax * 100) / 100, d: Math.round(Math.hypot(rc.x - cc.x, rc.z - cc.z)), ...(extra || {}) };
    if (live) link.urgent('end', res);
    applyEnd(res);
  }
  link.on('end', (d) => { if (d && S.R && d.idx === S.R.idx) applyEnd(clone(d)); });
  /** The people whose records this device keeps (each phone writes only its own person's keys). */
  const recPeople = () => (live ? [me] : split() ? AB : [human()]);
  const recNs = () => (live || split() ? '' : 'ai_');
  function applyEnd(res) {
    const R = S.R; if (!R || R.over || res.idx !== R.idx) return;
    R.over = true; R.result = res; S.phase = 'result'; R.endWall = performance.now(); S.skipMe = false; S.skipThem = false; S.final15 = false;
    const winner = res.outcome === 'busted' ? other(R.runner) : R.runner;
    S.match.scores[winner]++;
    const st = res.stats || {};
    S.match.hist.push({ runner: R.runner, outcome: res.outcome, reason: res.reason, ran: res.ran, hp: +res.hp || 0, escMax: +res.escMax || 0, pits: st.pits | 0, top: +st.top || 0, near: st.near | 0, spikes: st.spikes | 0, sd: !!R.sd });
    api.setScore(S.match.scores);
    const vs = viewers();
    const left = Math.max(0, R.endAt - res.at);
    // the stamp: the ending's own words (a buzzer with the cop on the bumper is a photo finish)
    const photo = res.outcome === 'escaped' && res.reason === 'time' && res.d >= 0 && res.d <= 15;
    let head; let cls = res.outcome === 'busted' ? 'bad' : R.runner;
    if (res.outcome === 'busted') head = res.reason === 'water' ? 'SPLASH!' : left < 10000 && res.reason !== 'quit' ? 'LAST SECOND BUST!' : 'BUSTED!';
    else head = photo ? (res.d <= 7 ? 'BY A BUMPER!' : 'PHOTO FINISH!') : res.reason === 'heat' ? 'VANISHED!' : 'ESCAPED!';
    if (head.length > 9) cls += ' sm';
    for (const w of vs) { const v = H0().view(w); const copSide = w !== R.runner && !split(); v.stamp(copSide && res.reason === 'heat' ? 'LOST THEM' : head, copSide && res.reason === 'heat' ? 'bad' : cls); v.flash(); }
    if ((photo || res.reason === 'heat') && !reduced) S.slowT = Math.max(S.slowT || 0, 0.75);
    const youWon = live ? winner === me : ai() ? winner === human() : true;
    audio.stamp(); if (photo && audio.sting) audio.sting(); later(() => (youWon ? audio.win() : audio.lose()), 300);
    // the other side's line (automatic trash talk): a heat escape under the cop's nose, a streak
    if (res.outcome === 'escaped' && res.reason === 'heat' && res.d < 60) for (const w of vs) if (w !== R.runner) later(() => H0().view(w).hint('SO CLOSE: they slipped away ' + res.d + ' m from you', 2400), 900);
    const done = matchDecided();
    const sd = !done && S.match.hist.length >= S.match.rounds;
    const next = done ? 'Final whistle…' : sd ? `All square: sudden death, ${nameOf(suddenRunner())} runs` : `Next: ${nameOf(other(R.runner))} runs`;
    // records + livery unlocks for the people on this device (records.js, liveries.js)
    const lines = []; const unlocks = []; let newRec = null; let streak = 0;
    const ns = recNs();
    for (const w of recPeople()) {
      const role = w === R.runner ? 'runner' : 'cop';
      const p = P2[w];
      const ev = { role, won: winner === w, outcome: res.outcome, reason: res.reason, t: res.ran / 1000, pits: role === 'cop' ? (live ? p.stats.pits : st.pits) : 0, top: role === 'runner' ? (+st.top || p.stats.top) * 3.6 : 0, topBoost: p.stats.topBoost, near: role === 'runner' ? st.near | 0 : 0 };
      const pw = personOf(w);
      const r = recordRound(gdata(), pw, ns, ev, ns ? null : other(pw));
      gset(r.patch);
      if (S.match.daily && role === 'runner') { // today's Daily chase score (the best of today's tries)
        const sc0 = dailyScore(res.outcome, res.reason, res.ran / 1000, S.match.rules.roundTime); const dk = dailyKey(pw, S.match.daily);
        const prev = gdata()[dk] | 0; const patch = {};
        if (sc0 > prev) patch[dk] = sc0;
        if (sc0 > (gdata()[`${pw}_daily_best`] | 0)) patch[`${pw}_daily_best`] = sc0;
        gset(patch);
        const rv = dailyRival(); if (rv) lines.push({ t: sc0 > rv.score ? `You beat ${rv.name}’s ${dailyText(rv.score)} today` : sc0 === rv.score ? `Level with ${rv.name} today` : `${rv.name} still leads today: ${dailyText(rv.score)}`, hot: sc0 > rv.score });
        else if (prev) lines.push({ t: sc0 > prev ? `Your best today (was ${dailyText(prev)})` : `Your best today: ${dailyText(prev)}`, hot: sc0 > prev });
      }
      const who = split() ? `${nameOf(w)}: ` : '';
      if (r.news.length) { lines.push({ t: who + r.news[0].text, hot: true }); newRec = newRec || r.news[0]; }
      else if (r.held) lines.push({ t: `${who}${nameOf(other(w))} still holds ${r.held.label.toLowerCase()}, ${r.held.text}` });
      if (r.streak >= 2) { streak = Math.max(streak, r.streak); if (r.streak >= 3) lines.push({ t: `${who}${r.streak} rounds in a row`, hot: true }); }
      const u = checkUnlocks(gdata(), pw); gset(u.patch); for (const x of u.pops) unlocks.push({ ...x, w });
    }
    if (newRec) later(() => { for (const w of vs) H0().view(w).stamp('NEW RECORD!', 'good sm'); if (audio.fanfare) audio.fanfare(); }, 1000);
    else if (streak >= 3) later(() => { for (const w of vs) if (winner === w || !live) H0().view(w).stamp(`STREAK ×${streak}`, 'good sm'); audio.win(); }, 1000);
    if (unlocks.length) later(() => { for (const w of vs) H0().view(w).stamp('UNLOCKED!', 'good sm'); audio.win(); }, newRec || streak >= 3 ? 2000 : 1000);
    S.resultInfo = { lines, unlocks, next, photo, head };
    // the card stays up long enough to read; longer when it has news (either phone's news: the
    // other phone hears 'hold', and the host's advance waits for the later of the two)
    const news = !!newRec || streak >= 3 || unlocks.length > 0 || lines.some((l) => l.hot);
    R.advAt = R.endWall + (TUNE.result ?? (news || R.holdWant ? FLOW.resultHold : FLOW.result));
    if (news && live && TUNE.result == null) link.urgent('hold', { idx: R.idx });
    later(() => { if (S.R === R) { R.cardShown = true; showResultCard(); } }, Math.min(FLOW.card, TUNE.result != null ? TUNE.result / 2 : FLOW.card));
    if (isHost) { const adv = () => { if (S.R !== R || R.proceeded) return; const left = R.advAt - performance.now(); if (left > 40) later(adv, left); else proceed(R); }; later(adv, R.advAt - performance.now()); }
  }
  link.on('hold', (d) => {
    const R = S.R; if (!d || !R || d.idx !== R.idx || TUNE.result != null) return;
    if (!R.over) { R.holdWant = true; return; } // (the partner's end arrived first)
    const at = R.endWall + FLOW.resultHold; if (at <= R.advAt) return;
    R.advAt = at; if (R.cardShown && S.phase === 'result') showResultCard();
  });
  function showResultCard() {
    const R = S.R; if (!R || !R.result || !S.resultInfo) return;
    const res = R.result; const I = S.resultInfo;
    const wait = S.skipMe ? (live && !S.skipThem ? `Waiting for ${api.name(other(me))}…` : 'Starting…') : live && S.skipThem ? `${api.name(other(me))} is ready · tap to go` : 'Tap to continue';
    const adv = R.advAt ? { total: R.advAt - R.endWall, left: Math.max(0, R.advAt - performance.now()) } : null; // the auto-advance bar
    hud.card(resultCard({ name: nameOf }, { adv, outcome: res.outcome, reason: res.reason, runner: R.runner, stats: res.stats, scores: S.match.scores, next: I.next, local: !live, me: human(), ran: res.ran, unlocks: I.unlocks, lines: I.lines, head: !split() && human() !== R.runner && res.reason === 'heat' ? 'LOST THEM' : I.head, queue: !!res.queue, d: res.d, wait, ai: ai() || !!S.match.daily, daily: S.match.daily ? dailyLine(res) : '' }), 'dim');
  }
  /** Tap on the result card: practice / split goes on at once; live when both phones have tapped. */
  function skipResult() {
    const R = S.R; if (!R || !R.over || S.phase !== 'result' || S.skipMe) return;
    if (performance.now() - (R.endWall || 0) < (TUNE.skipAfter ?? FLOW.skipAfter)) return;
    S.skipMe = true; audio.tick();
    if (live) link.urgent('skip', { idx: R.idx });
    if (isHost && (!live || S.skipThem)) proceed(R);
    else showResultCard();
  }
  link.on('skip', (d) => {
    const R = S.R; if (!d || !R || d.idx !== R.idx || !R.over) return;
    S.skipThem = true;
    if (isHost && S.skipMe) proceed(R); else if (S.phase === 'result') showResultCard();
  });
  /** Host: on to the next round (or the decider, or the final). Once per round. */
  function proceed(R) {
    if (S.R !== R || dead || R.proceeded) return;
    R.proceeded = true;
    if (matchDecided()) finalize(); else startNext();
  }
  function matchDecided() {
    const m = S.match; const played = m.hist.length; const left = m.rounds - played;
    const d = Math.abs(m.scores.a - m.scores.b);
    if (played > m.rounds) return true; // the decider has been played
    if (left <= 0 && d === 0 && m.rules.tiebreak === 'sudden' && !m.daily) return false; // level: sudden death
    return left <= 0 || d > left;
  }
  /** The decider's runner: whoever spent less time on the run (escapes count as the full clock). */
  function suddenRunner() {
    const run = { a: 0, b: 0 };
    for (const h of S.match.hist) run[h.runner] += h.outcome === 'escaped' ? 1e6 : (h.ran || 0);
    return run.a === run.b ? other(S.match.first) : run.a < run.b ? 'a' : 'b';
  }
  function startNext() {
    const idx = S.R.idx + 1;
    const R = nextRound(S.match, idx, idx >= S.match.rounds ? { runner: suddenRunner() } : null);
    if (live) link.urgent('round', { R, scores: S.match.scores, hist: S.match.hist });
    applyRound(R);
  }
  function finalize() {
    const m = S.match; let winner = null;
    if (m.scores.a !== m.scores.b) winner = m.scores.a > m.scores.b ? 'a' : 'b';
    let tbWhy = '';
    if (winner === null) { // tiebreak: an escape beats a bust; between escapes, health left + 50 × how far the heat meter got; between busts, the longer run
      const run = { a: 0, b: 0 }; for (const h of m.hist) run[h.runner] += h.outcome === 'escaped' ? 1e6 + (h.hp || 0) + 50 * (h.escMax || 0) : (h.ran || 0) / 1000;
      if (run.a !== run.b) { winner = run.a > run.b ? 'a' : 'b'; tbWhy = Math.max(run.a, run.b) >= 1e6 ? 'health left after the escapes' : 'longest time on the run'; }
    }
    const fin = { scores: m.scores, winner, tie: m.scores.a === m.scores.b, tbWhy, sd: m.hist.some((h) => h.sd) };
    if (live) link.urgent('final', fin);
    applyFinal(fin);
  }
  link.on('final', (d) => { if (d) applyFinal(clone(d)); });
  function applyFinal(fin) {
    if (S.finalShown) return; S.finalShown = true;
    S.phase = 'final';
    const daily = !!S.match.daily;
    // match wins + unlocks for the people on this device
    const ns = recNs(); const unlocks = [];
    if (!daily) for (const w of recPeople()) { const pw = personOf(w); gset(recordMatch(gdata(), pw, ns, fin.winner === w)); const u = checkUnlocks(gdata(), pw); gset(u.patch); for (const x of u.pops) unlocks.push(x); }
    if (unlocks.length) later(() => { for (const w of viewers()) H0().view(w).stamp('UNLOCKED!', 'good sm'); }, 1500);
    const sc = `${fin.scores.a}–${fin.scores.b}`;
    const sum = matchSummary();
    let res;
    const tb = fin.sd && fin.winner ? ' in sudden death' : fin.tie && fin.winner ? ' on the tiebreak' : '';
    const tbSub = fin.sd ? 'Decided by sudden death' : `Tiebreak: ${typeof fin.tbWhy === 'string' && fin.tbWhy ? fin.tbWhy : 'longest time on the run'}`;
    if (daily) { const h = S.match.hist[0] || {}; const sc0 = dailyScore(h.outcome, h.reason, (h.ran || 0) / 1000, S.match.rules.roundTime); res = { winner: null, text: `Daily chase: ${dailyText(sc0, S.match.rules.roundTime)}`, sub: dailyBoardText(), record: false }; }
    else if (ai()) res = { winner: null, text: fin.winner === human() ? `You beat the ${aiLabel()} AI${tb}, ${sc}` : fin.winner ? `The AI won${tb}, ${sc}` : `Practice: ${sc}`, sub: [tb ? tbSub : `vs ${aiLabel()} AI`, sum.line].filter(Boolean).join(' · '), record: false };
    else res = { winner: fin.winner, text: fin.winner ? (tb ? `${api.name(fin.winner)} wins${tb}, ${sc}` : `${api.name(fin.winner)} wins ${Math.max(fin.scores.a, fin.scores.b)}–${Math.min(fin.scores.a, fin.scores.b)}`) : `All square, ${sc}`, sub: [tb ? tbSub : 'Getaway', sum.line].filter(Boolean).join(' · '), score: { a: fin.scores.a, b: fin.scores.b } };
    S.result = res;
    const head = daily ? 'DAILY DONE' : fin.winner ? (nameOf(fin.winner) === 'You' ? 'YOU WIN!' : `${nameOf(fin.winner).toUpperCase()} WINS`) : 'DRAW';
    for (const w of viewers()) H0().view(w).stamp(head, (fin.winner || '') + (head.length > 9 ? ' sm' : ''));
    if (fin.winner && (live ? fin.winner === me : ai() ? fin.winner === human() : true)) later(() => audio.win(), 250);
    // Getaway's own match card (round by round, the two columns, the MVP), then the app's end card
    S.finalAt = performance.now();
    const ms = TUNE.final ?? FLOW.finalCard;
    later(() => { if (S.phase === 'final' && !S.finalDone) hud.card(finalCard({ name: nameOf }, { hist: S.match.hist, scores: fin.scores, winner: fin.winner, rounds: S.match.rounds, sum, daily: daily ? res.text : '', dailySub: daily ? res.sub : '', ai: ai(), tb: tb ? tbSub : '' }), 'dim'); }, Math.min(900, ms / 2));
    later(finishNow, ms + 900);
  }
  function finishNow() {
    if (S.phase !== 'final' || S.finalDone || dead) return;
    S.finalDone = true; hud.card(null);
    try { api.finish(S.result); } catch (e) { console.error(e); }
  }
  const aiLabel = () => (AI_LEVEL_LABELS[S.match && S.match.aiLevel] || AI_LEVEL_LABELS[device.aiLevel] || 'Normal');
  /** Per-person match totals and the MVP line (finalCard, and the app card's sub line). */
  function matchSummary() {
    const m = S.match; const T = { a: { pits: 0, top: 0, near: 0, ran: 0, spikes: 0, esc: 0, heat: 0, busts: 0, pitted: 0 }, b: { pits: 0, top: 0, near: 0, ran: 0, spikes: 0, esc: 0, heat: 0, busts: 0, pitted: 0 } };
    for (const h of m.hist) {
      const r = T[h.runner]; const c = T[other(h.runner)];
      r.top = Math.max(r.top, Math.round((h.top || 0) * 3.6)); r.near += h.near | 0; r.ran += h.outcome === 'escaped' ? 0 : (h.ran || 0); r.pitted += h.pits | 0;
      if (h.outcome === 'escaped') { r.esc++; if (h.reason === 'heat') r.heat++; } else if (h.reason !== 'quit') c.busts++;
      c.pits += h.pits | 0; c.spikes += h.spikes | 0;
    }
    // the MVP: the match's most distinctive feat
    const cands = [];
    for (const w of ai() ? [human()] : AB) { // (practice: the MVP line is about you, not the AI)
      const t = T[w]; const n = nameOf(w);
      if (t.heat >= 2) cands.push({ w, s: 50 + t.heat, t: `HOUDINI · ${n} lost the heat ${t.heat} times` });
      if (t.pits >= 3) cands.push({ w, s: 40 + t.pits, t: `BUMPER CAR · ${n} landed ${t.pits} PITs` });
      if (t.spikes >= 2) cands.push({ w, s: 35 + t.spikes, t: `ROADBLOCK · ${n} spiked them ${t.spikes} times` });
      if (t.esc >= 1 && t.pitted === 0 && m.hist.some((h) => h.runner === w)) cands.push({ w, s: 30 + t.esc, t: `UNTOUCHABLE · ${n} was never PITed` });
      if (t.near >= 5) cands.push({ w, s: 20 + t.near, t: `THREAD THE NEEDLE · ${n}: ${t.near} near misses` });
      if (t.top >= 160) cands.push({ w, s: 10 + t.top / 100, t: `LEAD FOOT · ${n} hit ${t.top} km/h` });
    }
    cands.sort((x, y) => y.s - x.s);
    const mvp = cands[0] || null;
    return { T, mvp, line: mvp ? mvp.t : '' };
  }
  function dailyLine(res) {
    const sc0 = dailyScore(res.outcome, res.reason, res.ran / 1000, S.match.rules.roundTime);
    return `Daily chase: ${dailyText(sc0, S.match.rules.roundTime)}`;
  }
  /** The partner's Daily chase score today, for the line to beat ({ name, score } or null). */
  function dailyRival() {
    const b = dailyBoard(gdata(), S.match && S.match.daily || dayKey()); const q = other(owner);
    return b[q] > 0 ? { name: api.name(q), score: b[q] } : null;
  }
  function dailyBoardText() {
    const b = dailyBoard(gdata()); const rt = DAILY.roundTime;
    const bits = AB.filter((w) => b[w] > 0).map((w) => `${api.name(w)} ${dailyText(b[w], rt)}`);
    return bits.length ? `Today: ${bits.join(' · ')}` : 'Today’s board is empty';
  }

  // ── pause / resume ──
  link.on('pause', (d) => { if (!isHost && d && S.R) { S.paused = true; S.pausedAt = d.at; S.resumeAt = 0; } });
  link.on('resume', (d) => { if (!isHost && d && S.R && d.idx === S.R.idx) { S.R.t0 = d.t0; S.R.endAt = d.endAt; S.resumeAt = d.at; S.paused = true; } });
  link.on('endat', (d) => { if (d && S.R && d.idx === S.R.idx) { S.R.endAt = d.endAt; if (d.ot && !S.R.ot) { S.R.ot = 1; overtimeFx(); } } });
  function hostPauseCheck(now) {
    if (!S.R || S.R.over || (S.phase !== 'chase' && S.phase !== 'count' && S.phase !== 'intro')) return;
    const p = P2[other(human())];
    let want = S.reasons !== 0 || softReasons.has('stale') || softReasons.has('tap');
    if (live) want = want || !partnerHere || (p.remote.pz !== 0) || link.silence > (TUNE.silent || RULES.silentPause);
    if (want) {
      if (!S.paused || S.resumeAt) { S.paused = true; S.pausedAt = S.resumeAt && now < S.resumeAt ? S.pausedAt : now; S.resumeAt = 0; if (live) link.urgent('pause', { at: S.pausedAt }); }
    } else if (S.paused && !S.resumeAt) {
      const resumeAt = now + (TUNE.resume ?? 3000);
      const shift = resumeAt - S.pausedAt;
      // only shift the clocks if the pause happened after the chase started
      const R = S.R;
      if (S.pausedAt >= R.at) { if (S.pausedAt < R.t0) { R.t0 += shift; R.endAt += shift; } else { R.t0 += shift; R.endAt += shift; } R.at = Math.min(R.at, now); }
      S.resumeAt = resumeAt;
      if (live) link.urgent('resume', { idx: R.idx, at: resumeAt, t0: R.t0, endAt: R.endAt });
    }
    if (S.paused && S.resumeAt && now >= S.resumeAt) { S.paused = false; S.resumeAt = 0; }
  }
  function guestPauseCheck(now) { if (S.paused && S.resumeAt && now >= S.resumeAt) { S.paused = false; S.resumeAt = 0; } }

  function sendLivery() { if (live) link.send('livery', { r: liveryOf(me, 'runner'), c: liveryOf(me, 'cop') }); }
  link.on('livery', (d) => { if (!live || !d) return; const L = P2[other(me)].livery; L.runner = LIVERIES.runner[d.r | 0] ? d.r | 0 : 0; L.cop = LIVERIES.cop[d.c | 0] ? d.c | 0 : 0; });
  function onLinked() {
    sendLivery();
    // a (re)linked partner: the host re-sends the lobby setup or the current round
    if (!isHost) return;
    if (S.phase === 'lobby') link.send('setup', S.setup);
    else if (S.match && S.R) link.send('match', { match: { ...S.match }, R: { idx: S.R.idx, runner: S.R.runner, spawn: S.R.spawn, at: S.R.at, t0: S.R.t0, endAt: S.R.endAt, intro: S.R.intro, sd: S.R.sd } });
    delReason('stale');
  }

  // ── actions ──
  function onAct(w, a) {
    audio.unlock();
    if (a === 'esc') {
      if (H0().mapOpen) closeMap(); else if (S.sheet) { S.sheet = false; renderSheet(); renderLobby(true); } else if (S.menu) onClick({ dataset: { l: 'resume' } });
      else if (S.R && !S.R.over && S.phase !== 'lobby' && S.phase !== 'final') openMenu();
      else return false; // nothing of ours open: the app's Escape closes the game
      return true;
    }
    if (a === 'pause') { if (H0().mapOpen) closeMap(); if (S.menu) onClick({ dataset: { l: 'resume' } }); else openMenu(); return; }
    if (a === 'cam') { const c = cams[w]; c.mode = (c.mode || rules().camera) === 'near' ? 'far' : 'near'; device.cam = c.mode; lsSet(DEV_KEY, device); audio.tick(); return; }
    if (a === 'horn') { sendEmote(w); return; }
    if (a === 'look') { cams[w].look = cams[w].look ? 0 : 1; later(() => { cams[w].look = 0; }, 1600); return; }
    if (a === 'map') { if (H0().mapOpen) closeMap(); else openMap(w); return; }
    if (a === 'act') {
      if (!S.R || S.R.over) return;
      if (roleOf(w) === 'cop') { if (H0().mapOpen) closeMap(); else openMap(w); } else dropOil(w);
    }
  }
  // ── emotes (live): one tap sends the next line of my role's list; one per 4 s ──
  const EMOTES = { runner: ['HONK', 'Catch me!', 'lol'], cop: ['HONK', 'Pull over!', 'lol'] };
  const EMOTE_OK = new Set([...EMOTES.runner, ...EMOTES.cop]);
  const emoteNext = (w) => { const L = EMOTES[roleOf(w)]; return L[(S.emoteK || 0) % L.length]; };
  function sendEmote(w) {
    if (!live || !S.R || device.emotes === 'off' || S.phase === 'lobby' || S.phase === 'final') return;
    const t = performance.now(); if (t - (S.emoteT || 0) < 4000) return;
    S.emoteT = t; const txt = emoteNext(w); S.emoteK = (S.emoteK || 0) + 1;
    link.urgent('emote', { k: txt });
    H0().view(w).hint(`You: ${txt}`, 1200); audio.honk();
  }
  link.on('emote', (d) => {
    if (!d || !EMOTE_OK.has(d.k) || device.emotes === 'off' || !S.R) return;
    const o = other(me); S.bubble = { w: o, text: d.k, until: performance.now() + 1600 };
    const oc = P2[o].car; const mc = P2[me].car; const far = Math.hypot(oc.x - mc.x, oc.z - mc.z) > 120;
    if (far || S.phase !== 'chase') H0().view(me).hint(`${api.name(o)}: ${d.k}`, 1600);
    audio.honk(far);
  });
  // ── the runner's style chain: near misses, drifts, a cop on your oil; chained within 3 s ──
  const STYLE_TIERS = [[10, 'UNTOUCHABLE'], [6, 'SMOOTH'], [3, 'SLICK']];
  function addStyle(w, pts, what) {
    const p = P2[w]; const t = performance.now();
    if (!p.style || t - p.style.t > 3000) p.style = { n: 0, t, tier: 0 };
    p.style.n += pts; p.style.t = t;
    const tier = STYLE_TIERS.findIndex((x) => p.style.n >= x[0]); const lvl = tier < 0 ? 0 : 3 - tier;
    if (lvl > p.style.tier) { p.style.tier = lvl; p.car.nitro = Math.min(1, p.car.nitro + 0.05 * lvl); p.nitroPulseT = 0.3; }
    if (isViewer(w)) H0().view(w).hint(p.style.n >= 3 ? `${what} ×${p.style.n} ${STYLE_TIERS[tier][1]}` : what, 1100);
  }
  let mapFor = null;
  function openMap(w) {
    if (!mapImg) return;
    mapFor = w;
    const cop = S.R && !S.R.over && roleOf(w) === 'cop' && S.phase === 'chase';
    const sub = () => (cop ? (P2[w].spikesLeft > 0 ? `Tap a road ahead of them to drop a spike strip · ${P2[w].spikesLeft} left · within 400 m of you` : 'No spike strips left') : 'Landmarks and where you are');
    H0().openMap({
      img: mapImg, title: cop ? 'Spike strips' : (S.mapEntry ? S.mapEntry.name : 'Map'), sub: sub(),
      marks: (g, toPx, dpr, k) => drawMarks(g, toPx, dpr, k, w, true),
      // the cop's map zooms to a 900 m window ahead of the cruiser (roads 6–8 px wide, the 400 m range
      // fills it; 'Whole map' toggles); the runner's map follows its car the same way
      view: S.R && !S.R.over && S.phase === 'chase' ? () => { const c = P2[w].car; const span = MAP_SPAN; const ah = cop ? span * 0.15 : 0; return { cx: c.x + Math.sin(c.yaw) * ah, cz: c.z - Math.cos(c.yaw) * ah, span }; } : null,
      onTap: (x, z) => { if (!cop) return undefined; const r = placeSpike(w, x, z); if (r === true) { H0().mapSub(sub()); H0().redrawMap(); } return r; },
      onClose: closeMap,
    });
    S.mapT = 0;
  }
  function closeMap() { H0().closeMap(); mapFor = null; }

  const nq = { road: -1 };
  /** Cop places a spike strip at the road nearest (x, z). Returns true or an error message. */
  function placeSpike(w, x, z) {
    const R = S.R; const p = P2[w];
    if (!R || R.over || S.phase !== 'chase' || roleOf(w) !== 'cop') return 'Spikes go down during the chase';
    if (p.spikesLeft <= 0) return 'No spike strips left';
    geo.nearestRoad(x, z, nq, RULES.spikeSnap, (r) => !r.bridge);
    if (nq.road < 0 || nq.d > RULES.spikeSnap) return 'Tap closer to a road';
    const road = geo.roads[nq.road];
    const sx = nq.px; const sz = nq.pz;
    const c = p.car;
    if (Math.hypot(sx - c.x, sz - c.z) > RULES.spikeRange) return 'Too far: strips go within 400 m of you';
    const rc = carOf(R.runner);
    if (Math.hypot(sx - rc.x, sz - rc.z) < spikeNoRunnerR()) return 'Too close to them: drop it further ahead';
    for (const s of R.spikes) if (Math.hypot(s.x - sx, s.z - sz) < 14) return 'There’s already a strip there';
    const yaw = Math.atan2(nq.tx, -nq.tz);
    const s = { id: `${w}${++R.seq}`, x: sx, z: sz, yaw, len: Math.max(4, road.width - 0.8), y: geo.ground(sx, sz), at: clock() + RULES.spikeDeploy, by: w, gone: false };
    p.spikesLeft--;
    addSpike(s);
    if (live) link.urgent('spike', s);
    audio.spikeDrop();
    return true;
  }
  function addSpike(s) {
    if (!S.R || S.R.spikes.find((x) => x.id === s.id)) return;
    S.R.spikes.push({ ...s, gone: !!s.gone });
    // the runner: a strip landing ahead on the road it's on gets a warning (a chirp, a hint and a
    // flash on the minimap mark), so a strip beyond the reveal radius isn't an invisible rule
    const rw = runnerW(); if (!local(rw) || s.by === rw) return;
    const c = P2[rw].car; const dx = s.x - c.x; const dz = s.z - c.z; const d = Math.hypot(dx, dz);
    if (d > RULES.spikeWarn || dx * Math.sin(c.yaw) - dz * Math.cos(c.yaw) < 0) return;
    geo.nearestRoad(c.x, c.z, nq, 30); const myRoad = nq.road; geo.nearestRoad(s.x, s.z, nq, 30);
    if (myRoad < 0 || nq.road !== myRoad) return;
    P2[rw].spikeWarnT = 1.6;
    if (isViewer(rw)) { H0().view(rw).hint('SPIKES AHEAD', 1400); if (audio.spikeWarn) audio.spikeWarn(); else audio.beep(true); }
  }
  /** No-drop radius round the runner, scaled by its speed (2.5 s of travel; 25 m floor). */
  const spikeNoRunnerR = () => { const rc = S.R ? P2[S.R.runner].car : null; return Math.max(RULES.spikeNoRunner, rc ? RULES.spikeNoRunnerT * Math.hypot(rc.vx || 0, rc.vz || 0) : 0); };
  /** Reveal radius for the runner, scaled by its speed (4 s of travel; 120 m floor). */
  const spikeRevealR = (w) => { const c = P2[w].car; return Math.max(RULES.spikeReveal, RULES.spikeRevealT * Math.hypot(c.vx || 0, c.vz || 0)); };
  link.on('spike', (d) => { if (d && S.R) addSpike(clone(d)); });
  link.on('spikehit', (d) => { if (!d || !S.R) return; const s = S.R.spikes.find((x) => x.id === d.id); if (s) s.gone = true; const cw = copW(); P2[cw].stats.spikes++; for (const v of viewers()) if (v === cw) H0().view(v).stamp('SPIKED!', 'bad'); });
  function dropOil(w) {
    const p = P2[w]; const R = S.R;
    if (!R || R.over || S.phase !== 'chase' || p.oilLeft <= 0) { H0().view(w).hint('No oil left this round', 1400); return; }
    p.oilLeft--;
    const c = p.car; const fx0 = Math.sin(c.yaw); const fz0 = -Math.cos(c.yaw);
    const o = { id: `${w}o${++R.seq}`, x: c.x - fx0 * 4.2, z: c.z - fz0 * 4.2, y: c.y, at: clock(), r: RULES.oilR, rot: c.yaw };
    R.oils.push(o);
    if (live) link.urgent('oil', o);
    audio.oil();
  }
  link.on('oil', (d) => { if (d && S.R && !S.R.oils.find((x) => x.id === d.id)) S.R.oils.push(clone(d)); });
  // hits reported by the victim (the runner's device judges PITs and rams on the runner)
  link.on('hit', (d) => {
    if (!d || !S.R) return;
    const w = human();
    if (d.kind === 'pit') {
      P2[w].stats.pits++; H0().view(w).stamp('PIT!', w); audio.pit(); if (!(d.push < DAMAGE.pitSlowMo)) slowMo(d.push);
      // the attacker's own moment: a jolt and a puff at the contact (the stamp alone read as nothing)
      cams[w].shake = Math.min(1, cams[w].shake + 0.5);
      const c = P2[w].car; if (typeof d.px === 'number') fx.puff(d.px, c.y + 0.6, d.pz, 0, 1.2, 0, 0.7, 2.0, 0.6, 0.85, 0.83, 0.8);
    } else if (d.kind === 'ram') { H0().view(w).stamp('RAMMED', 'bad'); cams[w].shake = Math.min(1, cams[w].shake + 0.4); }
  });
  // car vs car over the network: the runner's device sees the contact and works out one impulse
  // for both cars; the cop's device applies its half when this arrives
  link.on('bump', (d) => {
    if (!d || !S.R || S.phase !== 'chase' || typeof d.j !== 'number') return;
    const t = performance.now(); // (link.urgent's copies are deduped by id)
    if (TLOG) TLOG.bumpsIn.push({ t: clock(), v: d.v || 0 });
    const c = P2[me].car; const j = Math.min(30, Math.max(0, d.j));
    applyImpulse(c, -j, d.nx, d.nz, c.x + (d.px - (d.ox ?? c.x)), c.z + (d.pz - (d.oz ?? c.z)), 1);
    { // the runner got +j n at time d.at: my picture of it carries that until its samples do
      const po = P2[other(me)]; po.bumpAt = t;
      const tb = typeof d.at === 'number' ? d.at : link.now(); const rm = po.remote;
      const dr = rm ? (((d.px - rm.x) * (j * d.nz) - (d.pz - rm.z) * (j * d.nx)) / CAR.inertia) * 0.8 : 0;
      addCorr(po, tb, tb, j * d.nx, j * d.nz, Number.isFinite(dr) ? dr : 0, 0, 0);
    }
    const v = d.v || 0;
    if (v > 2) { if (d.dmg > 0 && roleOf(me) === 'cop') damage(me, d.dmg, 'ram'); hitStop(v); crashFx(d.px, c.y + 0.7, d.pz, v, me); }
  });
  // traffic knocked and props broken on the other device
  link.on('knock', (d) => { if (d && traffic && typeof d.id === 'number') traffic.setWreck(d.id, d); });
  link.on('knocks', (l) => { if (Array.isArray(l) && traffic) for (const d of l) if (d && typeof d.id === 'number') traffic.setWreck(d.id, d); });
  link.on('brks', (l) => { if (Array.isArray(l)) for (const d of l) brkIn(d); });
  link.on('brk', brkIn);
  function brkIn(d) {
    if (!d || !geo || !world || typeof d.i !== 'number') return;
    const o = geo.solids[d.i]; if (!o || o.broken) return;
    o.broken = true; world.breakSolid(d.i, +d.vx || 0, +d.vz || 0);
  }
  /** A PIT's slow-motion moment: 0.45 s at the PIT threshold, up to 0.75 s for a hard shove. */
  function slowMo(push = DAMAGE.pitSlowMo) { if (reduced) return; S.slowT = Math.max(S.slowT || 0, RULES.pitSlowMo + (RULES.pitSlowMoMax - RULES.pitSlowMo) * clamp((push - DAMAGE.pitPush) / 4, 0, 1)); }
  /** Hit-stop: the simulation holds for 60–90 ms on a hard wall hit or ram (drawing continues), and
   *  a hit over hitSlowV m/s is followed by a quarter second at half speed. Quartered under reduced motion. */
  function hitStop(v) {
    if (!(v >= RULES.hitStopMin)) return;
    const k = reduced ? 0.25 : 1;
    const t = (RULES.hitStop0 + (RULES.hitStop1 - RULES.hitStop0) * clamp((v - RULES.hitStopMin) / (RULES.hitStopMax - RULES.hitStopMin), 0, 1)) * k;
    S.stopT = Math.max(S.stopT || 0, t);
    if (v >= RULES.hitSlowV) S.hitSlowT = Math.max(S.hitSlowT || 0, RULES.hitSlowT * k);
  }

  // ── the cars ──
  const carOf = (w) => P2[w].car;

  /** Fixed-step physics for every car this device simulates. */
  const remoteSnap = { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, r: 0 };
  const ct = { pen: 0, nx: 0, nz: 0, px: 0, pz: 0, ia: 0, ib: 0 };
  const ct2 = { pen: 0, nx: 0, nz: 0, px: 0, pz: 0, ia: 0, ib: 0 };
  const snapA = { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, r: 0 }; const snapB = { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, r: 0 };
  const copy = (o, c) => { o.x = c.x; o.z = c.z; o.y = c.y; o.yaw = c.yaw; o.vx = c.vx; o.vz = c.vz; o.r = c.r; return o; };
  let aiAcc = 0; let aiTicks = 0; const AI_TICKS_MAX = 2;
  function simStep(dt, now, tT, kSub = 0) {
    const rules0 = rules();
    // the AI drivers think at 30 Hz of simulated time (slow motion slows them too), at most twice a
    // frame: a 125 ms frame used to run 3.75 ticks of planning on top of its 15 substeps. The time
    // past the cap carries into the next think (≤ 0.1 s): dropping it ran the AI's clocks (its
    // stuck and queue timers) at half speed on a slow phone, and it sat twice as long in a jam.
    aiAcc += dt;
    if (aiTicks >= AI_TICKS_MAX) { if (aiAcc > 0.1) aiAcc = 0.1; }
    else if (aiAcc >= 1 / 30 - 1e-6) {
      const aiDt = aiAcc; aiAcc = 0; aiTicks++;
      for (const w of AB) {
        const p = P2[w]; if (!p.driver || !local(w)) continue;
        const o = posOf(other(w)); const role = roleOf(w);
        const out = p.driver.update(aiDt, p.car, o, { los: p.los, traffic, tT, spikes: role === 'runner' ? visibleStrips(w, now) : null, spikesLeft: p.spikesLeft, oilLeft: p.oilLeft, hit: p.aiHit, viewer: ai() ? P2[human()].car : null, esc: P2[runnerW()].esc, heat: heatDist() });
        p.aiHit = false;
        if (out.spike && role === 'cop') aiSpike(w, out.spike);
        if (out.oil && role === 'runner') dropOil(w);
        if (out.warp) placeCar(p.car, out.warp.x, out.warp.z, out.warp.yaw, geo);
      }
    }
    for (const w of AB) {
      if (!local(w)) continue;
      const p = P2[w]; const c = p.car; const role = roleOf(w);
      readPad(p.pad, p.inp, dt);
      const prevX = c.x; const prevZ = c.z;
      stepCar(c, p.inp, dt, geo, role === 'cop' ? CAR.cop : CAR.runner, role === 'cop' ? NITRO.cop : NITRO[rules0.nitro]);
      // the final 15 s: both tanks refill twice as fast (a boost each for the finale)
      if (S.final15 && !c.boost) { const nt = role === 'cop' ? NITRO.cop : NITRO[rules0.nitro]; if (nt.regen > 0 && c.nitro < 1) c.nitro = Math.min(1, c.nitro + nt.regen * dt); }
      if (c.speed > p.stats.top) p.stats.top = c.speed;
      if (role === 'runner') { if (c.slip > 3 && c.speed > 12) p.driftT = (p.driftT || 0) + dt; else { if (p.driftT > 1) addStyle(w, 1, 'Drift!'); p.driftT = 0; } }
      if (c.boost && c.speed * 3.6 > p.stats.topBoost) p.stats.topBoost = c.speed * 3.6;
      // world collision events
      for (const ev of c.ev) {
        if (ev.t === 'wall') { if (ev.dmg > 0) damage(w, ev.dmg * rules0.damage, 'wall'); if (isViewer(w)) hitStop(ev.v); crashFx(ev.x, c.y + 0.6, ev.z, ev.v, w); }
        else if (ev.t === 'scrape') { if (isViewer(w) && audio.scrape) audio.scrape(ev.v); for (let k = 0; k < 2; k++) fx.spark(ev.x, c.y + 0.5, ev.z, (Math.random() - 0.5) * 4, 1 + Math.random() * 2, (Math.random() - 0.5) * 4, 0.25); }
        else if (ev.t === 'break') {
          world.breakSolid(ev.solid, ev.vx, ev.vz); if (isViewer(w) || !live) audio.knock(); breakFx(ev.x, c.y, ev.z);
          if (!ev.soft && !ev.flimsy) damage(w, 2 * rules0.damage, 'break');
          if (live) queueBrk(ev.solid, ev.vx, ev.vz);
        } else if (ev.t === 'kerb') { // the verge: a low thump and a puff of dust
          if (isViewer(w) && audio.kerb) audio.kerb(ev.v);
          fx.puff(c.x - Math.sin(c.yaw) * 1.5, c.y + 0.2, c.z + Math.cos(c.yaw) * 1.5, 0, 0.8, 0, 0.5, 1.2, 0.4, 0.62, 0.55, 0.42);
        }
      }
      c.ev.length = 0;
      if (tT != null) trafficContact(w, c, tT);
      // spikes (the runner's device decides; the cop is immune to its own strips)
      if (role === 'runner' && S.R) {
        for (const s of S.R.spikes) {
          if (s.gone || p.spikeHit.has(s.id) || now < s.at) continue;
          if (Math.abs(s.x - c.x) > 30 || Math.abs(s.z - c.z) > 30) continue;
          if (sweptStrip(s, prevX, prevZ, c.x, c.z)) {
            p.spikeHit.add(s.id); s.gone = true;
            if (c.flat > 0) damage(w, DAMAGE.spikeExtra * rules0.damage, 'spike');
            c.flat = 1; p.stats.spikes++;
            { // the pop has a body: a 12% speed scrub, a nose tug towards the flat, a heave dip, a jolt
              const sideOf = (c.x - s.x) * Math.cos(c.yaw) + (c.z - s.z) * Math.sin(c.yaw) >= 0 ? 1 : -1; // which side of the strip's centre the car crossed
              c.vx *= 0.88; c.vz *= 0.88; c.r += sideOf * 0.55; c.hv -= 1.6; c.rv += sideOf * 0.6; c.pv += 0.25;
              cams[w].shake = Math.min(1, cams[w].shake + 0.6); p.hurtT = Math.max(p.hurtT, 0.35);
            }
            if (live) link.urgent('spikehit', { id: s.id });
            else P2[other(w)].stats.spikes++;
            for (const v of viewers()) H0().view(v).stamp('SPIKED!', 'bad');
            audio.pop();
            for (let k = 0; k < 14; k++) fx.spark(c.x, c.y + 0.3, c.z, (Math.random() - 0.5) * 10, 3 + Math.random() * 4, (Math.random() - 0.5) * 10, 0.5);
          }
        }
      }
      // oil (the cop's device decides for the cop)
      if (role === 'cop' && S.R) {
        for (const o of S.R.oils) {
          if (p.oilHit.has(o.id) || now - o.at > RULES.oilT * 1000) continue;
          // the slick is drawn as an ellipse r × 0.8 r along the dropping car's heading (+ ~half a car)
          const rot = o.rot || 0; const dx = c.x - o.x; const dz = c.z - o.z;
          const la = dx * Math.sin(rot) - dz * Math.cos(rot); const lb = dx * Math.cos(rot) + dz * Math.sin(rot);
          const ra = o.r + 0.6; const rb = o.r * 0.8 + 0.6;
          if ((la * la) / (ra * ra) + (lb * lb) / (rb * rb) < 1) { p.oilHit.add(o.id); c.oilT = RULES.oilSlide; c.r += ((o.id.length + Math.round(o.x)) & 1 ? -1 : 1) * RULES.oilKick; cams[w].shake = Math.min(1, cams[w].shake + 0.3); if (isViewer(w)) { H0().view(w).stamp('OIL!', 'bad'); audio.oil(); } if (local(other(w))) addStyle(other(w), 3, 'Oiled them!'); }
        }
      }
    }
    // car vs car
    if (live) {
      const w = me; const o = other(me); const c = P2[w].car; const po = P2[o];
      if (po.shown.init && po.predOk && !po.stale) {
        // against the partner's best estimate *now*: the raw prediction advanced along its arc
        // to this substep (the drawn car is only a smoothed copy of it)
        const rs = remoteSnap; const sub = (performance.now() - po.predAt) / 1000;
        // (this substep is kSub s before the frame time the prediction is for)
        const k = Math.min(0.12, Math.max(-0.12, sub + kSub));
        rs.vx = po.remote.vx; rs.vz = po.remote.vz; rs.r = po.remote.r; rs.y = po.remote.y;
        rs.yaw = po.remote.yaw + rs.r * k; { const h = rs.r * k * 0.5; const ch = Math.cos(h); const sh = Math.sin(h); rs.x = po.remote.x + (rs.vx * ch - rs.vz * sh) * k; rs.z = po.remote.z + (rs.vx * sh + rs.vz * ch) * k; } // along the arc
        // (the cop's device leaves contacts to the runner's: it only steps in when the cars are
        // deep inside each other, e.g. the bump message got lost; the drawn runner is pushed out)
        const cn = carContact(c, rs, ct);
        if (cn > 0 && roleOf(w) !== 'runner' && ct.pen <= 0.45) { po.pushX = (po.pushX || 0) - ct.nx * Math.min(ct.pen, 0.3) * 0.5; po.pushZ = (po.pushZ || 0) - ct.nz * Math.min(ct.pen, 0.3) * 0.5; }
        if (cn > 0 && (roleOf(w) === 'runner' || (ct.pen > 0.45 && !(po.bumpAt && performance.now() - po.bumpAt < 250)))) {
          if (TLOG) TLOG.contacts.push({ t: now + kSub * 1000, pen: Math.round(ct.pen * 100) / 100, role: roleOf(w), x: c.x, z: c.z, yaw: c.yaw, rx: rs.x, rz: rs.z, ryaw: rs.yaw });
          const pre = copy(snapA, c);
          if (roleOf(w) === 'runner') {
            // authority: one impulse for both cars; mine now, the cop's on my picture of it now
            // (until its samples show it) and on the real car by message. Every impulse goes to
            // the cop (a scrape's small ones summed), so both cars always get
            // equal and opposite pushes and my picture of the cop never keeps driving into me.
            const vrel = resolveCar(c, rs, ct, 1, 1, 0.5);
            p2Hit(o);
            if (ct.j > 0) {
              const tb = link.now(); const jn = -ct.j;
              const dr = (((ct.px - rs.x) * (jn * ct.nz) - (ct.pz - rs.z) * (jn * ct.nx)) / CAR.inertia) * 0.8;
              const corr = Math.min(ct.pen * 0.5, 0.35); // the cop's share of the separation (picture only)
              const pb = bumpPend; pb.jx += ct.j * ct.nx; pb.jz += ct.j * ct.nz; pb.px = ct.px; pb.pz = ct.pz; pb.ox = rs.x; pb.oz = rs.z; pb.v = Math.max(pb.v, vrel); if (!pb.at) pb.at = tb;
              let res = null;
              if (vrel > 0.3) { res = carHit(w, o, pre, rs, ct, vrel); if (res) { pb.dmg += res.copDmg; pb.now = true; } }
              if (res && TLOG) TLOG.bumpsOut.push({ t: now + kSub * 1000, v: vrel });
              // the cop's samples show it from about when it arrives there (+ the wait for a plain message)
              const wait0 = pb.now ? 0 : Math.max(0, 150 - (performance.now() - pb.sentAt));
              addCorr(po, tb, tb + wait0 + (link.rtt || 0) / 2 + 30, jn * ct.nx, jn * ct.nz, dr, -ct.nx * corr, -ct.nz * corr);
            }
          } else {
            // the cop's device: no impulse of its own, just don't sit inside the runner
            const corr = Math.min(ct.pen * 0.5, 0.2); c.x += ct.nx * corr; c.z += ct.nz * corr;
            const vn = (c.vx - rs.vx) * ct.nx + (c.vz - rs.vz) * ct.nz;
            if (vn < 0) { c.vx -= vn * ct.nx * 0.5; c.vz -= vn * ct.nz * 0.5; }
            p2Hit(o);
          }
          // the drawn partner car gets pushed out of mine too (decays back to the prediction)
          po.pushX = (po.pushX || 0) - ct.nx * Math.min(ct.pen, 0.3) * 0.5; po.pushZ = (po.pushZ || 0) - ct.nz * Math.min(ct.pen, 0.3) * 0.5;
        }
      }
      if (bumpPend.at) flushBump(false);
    } else {
      const a = P2.a.car; const b = P2.b.car;
      if (carContact(a, b, ct) > 0) {
        copy(snapA, a); copy(snapB, b);
        const vrel = resolvePair(a, b, ct, 1, 1);
        P2.a.aiHit = true; P2.b.aiHit = true;
        if (vrel > 0.3) {
          ct2.pen = ct.pen; ct2.nx = -ct.nx; ct2.nz = -ct.nz; ct2.px = ct.px; ct2.pz = ct.pz; ct2.ia = ct.ib; ct2.ib = ct.ia;
          const rw = runnerW();
          if (rw === 'a') carHit('a', 'b', snapA, snapB, ct, vrel, true); else carHit('b', 'a', snapB, snapA, ct2, vrel, true);
        }
      }
    }
  }
  // the runner's impulses on the cop not sent yet (summed): a hit goes at once as an urgent message,
  // the small pushes of a scrape or a shove follow as one plain message per 150 ms (message budget)
  const bumpPend = { jx: 0, jz: 0, px: 0, pz: 0, ox: 0, oz: 0, v: 0, dmg: 0, at: 0, now: false, sentAt: 0 };
  function flushBump(force) {
    const pb = bumpPend; const j = Math.hypot(pb.jx, pb.jz);
    if (!pb.at || (!pb.now && !force && performance.now() - pb.sentAt < 150)) return;
    if (j > 0.01 || pb.dmg > 0) {
      const nx = j > 0.01 ? pb.jx / j : 0; const nz = j > 0.01 ? pb.jz / j : 0;
      link[pb.now ? 'urgent' : 'send']('bump', { j: Math.round(j * 100) / 100, nx: Math.round(nx * 1000) / 1000, nz: Math.round(nz * 1000) / 1000, px: Math.round(pb.px * 100) / 100, pz: Math.round(pb.pz * 100) / 100, ox: Math.round(pb.ox * 100) / 100, oz: Math.round(pb.oz * 100) / 100, v: Math.round(pb.v * 10) / 10, dmg: Math.round(pb.dmg * 10) / 10, at: Math.round(pb.at) });
      pb.sentAt = performance.now();
    }
    pb.jx = 0; pb.jz = 0; pb.v = 0; pb.dmg = 0; pb.at = 0; pb.now = false;
  }
  /** An impulse this device applied to its picture of the partner's car (live) that the partner's
   *  streamed samples don't show yet. tb: when it happened, tE: from when the partner's samples
   *  include it (shared clock). It stays in the prediction until the sample the prediction is
   *  based on is from after tE, so the picture never snaps back to driving through the contact. */
  function addCorr(po, tb, tE, dvx, dvz, dr, ox, oz) {
    const L = po.corr || (po.corr = []);
    if (L.length >= 16) L.shift();
    L.push({ tb, tE, dvx, dvz, dr, ox, oz });
    // the current prediction gets it right away (the frame's next substeps collide against it)
    const r = po.remote; if (!r) return;
    const el = Math.max(0, link.now() - tb) / 1000;
    r.vx += dvx; r.vz += dvz; r.r = (r.r || 0) + dr; r.yaw += dr * el; r.x += dvx * el + ox; r.z += dvz * el + oz;
  }
  function applyCorr(po, pr) {
    const L = po.corr; if (!L || !L.length) return;
    const now = link.now(); const base = Math.min(now - link.delay, link.latestTime());
    for (let i = L.length - 1; i >= 0; i--) {
      const e = L[i];
      if (base >= e.tE + 25 || now - e.tb > 1500) { L.splice(i, 1); continue; }
      const el = Math.max(0, now - e.tb) / 1000;
      pr.vx += e.dvx; pr.vz += e.dvz; pr.r += e.dr; pr.yaw += e.dr * el; pr.x += e.dvx * el + e.ox; pr.z += e.dvz * el + e.oz;
    }
  }
  function p2Hit(o) { P2[me].aiHit = true; void o; }
  /** Strips the runner w can see right now (for the AI runner). */
  function visibleStrips(w, now) { if (!S.R) return null; const l = []; for (const st of S.R.spikes) if (!st.gone && stripVisible(st, now, w)) l.push(st); return l; }
  /** A car-car contact on the runner's side (live: the runner's device; local: once per contact).
   *  w = the car whose device judges (the runner when it's involved), pre = its pose before the
   *  impulse, op = the other car. The runner decides PITs (tiered: nudge / PIT / hard PIT with
   *  slow motion) and ram damage; the cop's ram damage goes along in the bump. Effects by closing
   *  speed: under 2 m/s nothing, 2–6 a scrape, above a crash. Returns { copDmg } or null. */
  function carHit(w, o, pre, op, c0, vrel, local2) {
    const p = P2[w]; const c = p.car; const role = roleOf(w);
    const rules0 = rules();
    const pairKey = performance.now();
    if (p.lastHit > pairKey - 400 && vrel < 6) return null; // still in the same scrape
    p.lastHit = pairKey;
    let pit = 0; let copDmg = 0;
    if (role === 'runner' && S.phase === 'chase') pit = judgePit(pre, op, c0);
    const tier = role === 'runner' && S.phase === 'chase' ? c0.pitTier : 0;
    const copW0 = role === 'runner' ? o : w;
    if (tier >= 1) {
      const ef = pitEffect(c0.pitPush, tier, Math.hypot(pre.vx, pre.vz));
      const side = pit || (((c0.px - pre.x) * Math.cos(pre.yaw) + (c0.pz - pre.z) * Math.sin(pre.yaw)) >= 0 ? 1 : -1);
      c.r += side * ef.kick;
      if (ef.spin) c.spinT = Math.max(c.spinT, ef.spin);
      if (ef.cut) c.cutT = Math.max(c.cutT, ef.cut);
      damage(w, DAMAGE.pit * ef.dmgK * rules0.damage, tier === 2 ? 'pit' : 'nudge');
      if (tier === 2) {
        p.stats.pits++;
        if (live) link.urgent('hit', { kind: 'pit', at: clock(), push: Math.round(c0.pitPush * 10) / 10, px: Math.round(c0.px * 10) / 10, pz: Math.round(c0.pz * 10) / 10 });
        else { P2[o].stats.pits++; cams[o].shake = Math.min(1, cams[o].shake + 0.5); }
        for (const v of viewers()) H0().view(v).stamp('PIT!', o);
        audio.pit();
        if (c0.pitPush >= DAMAGE.pitSlowMo) slowMo(c0.pitPush);
        if (c0.pitPush >= 6 && isViewer(w)) later(() => H0().view(w).hint('THAT’S GOTTA HURT', 1600), 500);
      }
    } else if (vrel > DAMAGE.ramMin) {
      // a ram: capped (one head-on used to cost half the runner's health) and blame-split by who
      // closed: a runner that brake-checks or drives head-on takes 40–100%, a runner rammed from
      // behind while queued takes the capped full amount; the cop always takes 0.6×
      let dmg = Math.min(DAMAGE.ramCap, (vrel - DAMAGE.ramMin) * DAMAGE.ramK) * rules0.damage;
      const copC = role === 'runner' ? op : pre; const runC = role === 'runner' ? pre : op;
      const nx = role === 'runner' ? c0.nx : -c0.nx; const nz = role === 'runner' ? c0.nz : -c0.nz; // from the cop to the runner
      const copClosing = Math.max(0, copC.vx * nx + copC.vz * nz); const runClosing = Math.max(0, -(runC.vx * nx + runC.vz * nz));
      const share = clamp(DAMAGE.ramBlameMin + (1 - DAMAGE.ramBlameMin) * (copClosing / Math.max(0.1, copClosing + runClosing)), DAMAGE.ramBlameMin, 1);
      const runDmg = dmg * share;
      damage(w, role === 'cop' ? dmg * 0.6 : runDmg, 'ram');
      copDmg = Math.round(dmg * 0.6 * 10) / 10;
      if (local2 || !live) damage(copW0 === w ? o : copW0, copDmg, 'ram');
      if (runDmg >= 8) { // a big hit never reads as random: it's stamped with its number
        const rw0 = role === 'runner' ? w : o;
        for (const v of viewers()) if (v === rw0) H0().view(v).stamp(`RAMMED −${Math.round(runDmg)}`, 'bad');
        if (live && role === 'runner') link.urgent('hit', { kind: 'ram', at: clock(), dmg: Math.round(runDmg) });
      }
      dmg = runDmg; void dmg;
    }
    if (role === 'runner' || !live) hitStop(vrel);
    crashFx(c0.px, c.y + 0.7, c0.pz, vrel, w);
    return { copDmg: live ? copDmg : 0 };
  }
  function damage(w, d, why) {
    const p = P2[w]; const c = p.car;
    if (!S.R || S.R.over || S.phase !== 'chase' || d <= 0) return;
    const role = roleOf(w);
    c.hp = role === 'cop' ? Math.max(DAMAGE.copMinHp, c.hp - d) : Math.max(0, c.hp - d);
    if (d > 3) { p.hurtT = 0.35; const cr = cams[w]; cr.shake = Math.min(1, cr.shake + d / 25); cr.rollKick = (cr.rollKick || 0) + (((Math.round(d * 10)) & 1) ? -1 : 1) * 0.06 * Math.min(1, d / 25); }
    // every hit of 3+ lands as a number: on my health chip, and on the attacker's screen in its colour
    if (d >= 3) for (const v of viewers()) { if (v === w) H0().view(v).dmg(d, role === 'cop' ? 'cop' : ''); else if (role === 'runner' && why !== 'wall' && why !== 'traffic') H0().view(v).dmg(d, 'them'); }
    if (why === 'nudge') for (const v of viewers()) H0().view(v).stamp('NUDGE', 'sm');
  }
  function crashFx(x, y, z, v, w) {
    if (v < 2) return; // a lean or a rub: nothing
    if (v < 6) { // a scrape: a few sparks and a scrape, no crash
      for (let k = 0; k < 3; k++) fx.spark(x, y, z, (Math.random() - 0.5) * 6, 1 + Math.random() * 3, (Math.random() - 0.5) * 6, 0.3);
      if ((isViewer(w) || dist2(x, z) < 900) && audio.scrape) audio.scrape(v);
      return;
    }
    const n = Math.min(18, 4 + v * 0.6);
    for (let k = 0; k < n; k++) fx.spark(x, y, z, (Math.random() - 0.5) * 12, 2 + Math.random() * 5, (Math.random() - 0.5) * 12, 0.35 + Math.random() * 0.3);
    if (v > 9) fx.puff(x, y, z, 0, 1, 0, 0.8, 2.4, 0.7, 0.85, 0.83, 0.8);
    if (v > 7 && fx.crash) { const c = P2[w].car; fx.crash(x, y, z, c.vx || 0, c.vz || 0, c.y || 0, Math.min(14, Math.round(v * 0.5)), roleOf(w) === 'cop' ? P.copBody : P[w]); }
    if (isViewer(w) || dist2(x, z) < 3600) audio.crash(v);
  }
  function breakFx(x, y, z) { for (let k = 0; k < 5; k++) fx.puff(x + (Math.random() - 0.5) * 2, y + 1 + Math.random() * 2, z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, 1.5, (Math.random() - 0.5) * 3, 0.6, 1.4, 0.6, 0.55, 0.62, 0.42); }
  function dist2(x, z) { const c = P2[human()].car; return (c.x - x) ** 2 + (c.z - z) ** 2; }
  /** Did a wheel axle sweep across strip s between two car positions? */
  function sweptStrip(s, x0, z0, x1, z1) {
    const c = Math.cos(Math.PI - s.yaw); const sn = Math.sin(Math.PI - s.yaw);
    // strip local: x across (half len/2), z along the road (half 0.45); world→local: lx = dx c − dz s, lz = dx s + dz c
    const hx = s.len / 2 + CAR.wid / 2 - 0.3; const hz = 0.45 + 1.4; // the axles are ±1.4 m from the centre; a wheel (not the centre) over the end counts
    const ax = x0 - s.x; const az = z0 - s.z; const bx = x1 - s.x; const bz = z1 - s.z;
    const l0x = ax * c - az * sn; const l0z = ax * sn + az * c; const l1x = bx * c - bz * sn; const l1z = bx * sn + bz * c;
    let t0 = 0; let t1 = 1; const dx = l1x - l0x; const dz = l1z - l0z;
    for (const [p0, d, h] of [[l0x, dx, hx], [l0z, dz, hz]]) {
      if (Math.abs(d) < 1e-9) { if (p0 < -h || p0 > h) return false; continue; }
      let a = (-h - p0) / d; let b = (h - p0) / d; if (a > b) { const t = a; a = b; b = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return false;
    }
    return true;
  }

  // ── traffic ──
  // Contacts are checked in every 120 Hz step at that step's traffic time (no deep overlaps), a
  // car only leaves its lane as a wreck at a closing speed over 2 m/s (below: just a nudge), and
  // a knock is sent to the partner so both phones see the same wreck. Cars growing in or
  // shrinking out at road ends (sc < 0.95) never collide.
  const tPose = { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, r: 0, vf: 0, hl: 2.3, hw: 0.95, sc: 1, speed: 0, id: 0, wreck: false, sched: 0 };
  // Candidates once per frame (every civilian within CAND_R of each local car: the ones that can
  // touch it in the next 125 ms), then each substep poses only those (≤ 5 instead of ~100).
  const CAND_R = 15; const CAND_MAX = 24;
  const cand = { a: new Int32Array(CAND_MAX), b: new Int32Array(CAND_MAX) }; const candN = { a: 0, b: 0 };
  let candW = 'a';
  const candFn = (id, pose, wreck) => { if (candN[candW] < CAND_MAX && (wreck || pose.sc > 0.3)) cand[candW][candN[candW]++] = id; };
  function trafficCandidates(tT) {
    for (const w of AB) {
      candN[w] = 0;
      if (!local(w) || !traffic || !traffic.total) continue;
      const c = P2[w].car; candW = w;
      traffic.each(c.x, c.z, CAND_R, tT, candFn);
    }
  }
  function trafficContact(w, c, tT) {
    const n = candN[w]; if (!n) return;
    const ids = cand[w]; const pose = tPose;
    for (let q = 0; q < n; q++) {
      const id = ids[q];
      if (!traffic.poseOf(id, tT, pose) || pose.sc < 0.95) continue;
      pose.r = 0;
      if (carContact(c, pose, ct) <= 0) continue;
      const v = resolveCar(c, pose, ct, 1, 0.8, 1);
      P2[w].aiHit = true; // an AI driver pressed against a car backs off quickly (its watchdog)
      if (v > TRAFFIC.knockMin) {
        const k = traffic.knock(id, pose, -ct.nx * ct.j * 0.85, -ct.nz * ct.j * 0.85, ((id & 7) - 3.5) * 0.04 * v);
        if (live) queueKnock(id, k);
        if (v > 9) damage(w, (v - 9) * 0.8 * rules().damage, 'traffic');
        if (P2[w].tHit !== id || v > 6) crashFx(ct.px, c.y + 0.7, ct.pz, v, w);
        P2[w].tHit = id;
      }
    }
  }
  // knocks and broken props go to the partner as one urgent list per frame (a queue of 3–4 cars
  // hit in one frame used to be 9–12 sends in one tick)
  const knockQ = []; let knockN = 0; const brkQ = []; let brkN = 0;
  function queueKnock(id, k) {
    for (let q = 0; q < knockN; q++) if (knockQ[q].id === id) { const o = knockQ[q]; o.x = Math.round(k.x * 100) / 100; o.z = Math.round(k.z * 100) / 100; o.yaw = Math.round(k.yaw * 1000) / 1000; o.vx = Math.round(k.vx * 100) / 100; o.vz = Math.round(k.vz * 100) / 100; o.r = Math.round(k.r * 100) / 100; return; }
    if (knockN >= 12) return;
    const o = knockQ[knockN] || (knockQ[knockN] = { id: 0, x: 0, z: 0, yaw: 0, vx: 0, vz: 0, r: 0 }); knockN++;
    o.id = id; o.x = Math.round(k.x * 100) / 100; o.z = Math.round(k.z * 100) / 100; o.yaw = Math.round(k.yaw * 1000) / 1000; o.vx = Math.round(k.vx * 100) / 100; o.vz = Math.round(k.vz * 100) / 100; o.r = Math.round(k.r * 100) / 100;
  }
  function queueBrk(i, vx, vz) { if (brkN >= 12) return; const o = brkQ[brkN] || (brkQ[brkN] = { i: 0, vx: 0, vz: 0 }); brkN++; o.i = i; o.vx = Math.round(vx * 10) / 10; o.vz = Math.round(vz * 10) / 10; }
  function flushKnocks() {
    if (!live) { knockN = 0; brkN = 0; return; }
    if (knockN) { link.urgent('knocks', knockQ.slice(0, knockN), true); knockN = 0; }
    if (brkN) { link.urgent('brks', brkQ.slice(0, brkN), true); brkN = 0; }
  }
  const carsOfViewers = () => { const vs = viewers(); viewCars.length = vs.length; for (let q = 0; q < vs.length; q++) viewCars[q] = P2[vs[q]].car; return viewCars; };
  const viewCars = [];
  /** Near misses (per frame): passing close at speed tops up the runner's nitro. */
  function trafficStep(dt, tT) {
    if (!traffic || !traffic.total) return;
    for (const w of AB) {
      if (!local(w) || roleOf(w) !== 'runner') continue;
      const p = P2[w]; const c = p.car;
      if (c.speed <= 14) continue;
      // (the frame's candidate list: every car within 15 m)
      const n = candN[w]; const ids = cand[w]; const pose = tPose;
      for (let q = 0; q < n; q++) {
        const id = ids[q];
        if (!traffic.poseOf(id, tT, pose) || pose.wreck || pose.sc < 0.95) continue;
        const dx = pose.x - c.x; const dz = pose.z - c.z; const d2 = dx * dx + dz * dz;
        if (d2 >= 3.8 * 3.8 || d2 <= 2.4 * 2.4) continue;
        const rvx = c.vx - pose.vx; const rvz = c.vz - pose.vz;
        if (rvx * rvx + rvz * rvz <= 144) continue;
        const last = p.nearIds.get(id) || 0;
        if (performance.now() - last > 2500) {
          p.nearIds.set(id, performance.now());
          p.stats.near++;
          c.nitro = Math.min(1, c.nitro + NITRO.nearMiss); p.nitroPulseT = 0.3;
          addStyle(w, 1, 'Near miss!'); if (isViewer(w)) audio.nearMiss();
        }
      }
    }
    // civilians wait behind the players' cars and wrecks and pull over for the siren
    const obs = trafficObs;
    for (let q = 0; q < 2; q++) { const w = AB[q]; const c = posOf(w); const o = obs[q]; o.x = c.x; o.z = c.z; o.yaw = c.yaw; o.siren = roleOf(w) === 'cop' && S.phase === 'chase'; o.speed = Math.hypot(c.vx || 0, c.vz || 0); }
    traffic.yieldTo(dt, tT, obs);
  }
  const trafficObs = [{ x: 0, z: 0, yaw: 0, siren: false, speed: 0 }, { x: 0, z: 0, yaw: 0, siren: false, speed: 0 }];

  // ── runner authority: bust / escape ──
  function runnerChecks(dt, now) {
    const R = S.R; const rw = R.runner;
    if (!local(rw) || R.over || S.ending) return;
    const p = P2[rw]; const c = p.car; const cop = live ? P2[other(rw)].shown : P2[other(rw)].car;
    const d = Math.hypot(cop.x - c.x, cop.z - c.z);
    if (c.hp <= 0) return endRound('busted', 'hp');
    if (c.water) return endRound('busted', 'water');
    // boxed in: stopped with the cop right there and the cop stopped too (or touching): a cop flying
    // past at 12 m doesn't count. Queued behind a civilian it takes 4 s, not 3. The HUD counts it down.
    const copV = Math.hypot(cop.vx || 0, cop.vz || 0);
    if (c.speed < RULES.bustStop && d < RULES.bustNear && (copV < BOX.copSlow || d < BOX.touch)) {
      if (p.stopT === 0) p.boxQueue = queuedAhead(rw, c, (now - R.t0) / 1000 + 600);
      p.stopT += dt; p.boxT = p.boxQueue ? BOX.queueT : RULES.bustT;
      if (p.stopT >= p.boxT) return endRound('busted', 'boxed', p.boxQueue ? { queue: 1 } : null);
    } else p.stopT = 0;
    // losing the heat: the meter moves every round. Beyond the heat distance and hidden (no line
    // of sight, or under cover) it fills in heatT s; beyond 60% of it ('Breaking away') at a third
    // of the rate; otherwise it drains at heatDecay × the fill rate, but never below half its
    // peak of the last heatMemory s, and a line of sight that flickers back for under heatFlicker s
    // doesn't count as spotted. (It used to need > heat AND no LOS and drained 2.5× faster: in 18
    // sampled practice rounds it reached 0 in 15.)
    const heat = heatDist();
    const T = TUNE.heatT || RULES.heatT;
    const hidden = !p.los || p.cover || p.seenT < RULES.heatFlicker;
    const dec = RULES.heatDecay / T;
    const rate = d > heat && hidden ? 1 / T : d > heat * RULES.heatBreak ? RULES.heatBreakK / T : hidden ? 0 : -dec;
    p.esc = clamp(p.esc + rate * dt, 0, 1);
    if (p.esc >= p.escPeak) { p.escPeak = p.esc; p.escPeakT = 0; } else { p.escPeakT += dt; if (p.escPeakT > RULES.heatMemory) p.escPeak = p.esc; }
    if (p.esc < p.escPeak * 0.5) p.esc = p.escPeak * 0.5;
    if (p.esc > p.escMax) p.escMax = p.esc;
    if (p.esc >= 1) { S.dbgEnd = { d, heat, los: p.los, cop: { x: cop.x, z: cop.z }, me: { x: c.x, z: c.z } }; return endRound('escaped', 'heat'); }
    if (now >= R.endAt) {
      // overtime: still spinning from a PIT at the buzzer, the round runs 2 s on (a last-second PIT can still bust)
      if (c.spinT > 0 && !R.ot) { R.ot = 1; R.endAt = now + 2000; if (live) link.urgent('endat', { idx: R.idx, endAt: R.endAt, ot: 1 }); overtimeFx(); return; }
      return endRound('escaped', 'time');
    }
  }
  const BOX = { copSlow: 6, touch: 5.5, queueT: 4, queueAhead: 11.5, queueLat: 2.2 };
  function overtimeFx() { for (const v of viewers()) H0().view(v).stamp('OVERTIME!', 'bad sm'); audio.beep(true); }
  /** A civilian car right in front of mine (a queue at a signal): the boxed-in clock is longer. */
  function queuedAhead(w, c, tT) {
    if (!traffic || !traffic.total) return false;
    const n = candN[w]; const ids = cand[w]; const fx0 = Math.sin(c.yaw); const fz0 = -Math.cos(c.yaw);
    for (let q = 0; q < n; q++) {
      if (!traffic.poseOf(ids[q], tT, tPose) || tPose.sc < 0.95) continue;
      const dx = tPose.x - c.x; const dz = tPose.z - c.z; const along = dx * fx0 + dz * fz0; const lat = Math.abs(dx * fz0 - dz * fx0);
      if (along > 0 && along < BOX.queueAhead && lat < BOX.queueLat) return true;
    }
    return false;
  }
  /** The heat distance: the setting, or the map's own when the setting is at its default. */
  const heatDist = () => { const r = rules().heat; const m = S.mapEntry && S.mapEntry.heat; const h = r === DEFAULTS.heat && m > 0 ? Math.max(60, Math.min(400, m)) : r; return S.R && S.R.sd ? Math.round(h * 0.75) : h; }; // (sudden death: a quarter closer)
  /** Cop-side fallback: the runner's device went quiet right at the buzzer. */
  function copFallback(now) {
    const R = S.R; if (!live || !isHost || R.over || local(R.runner)) return;
    if (now > R.endAt + 3500 && link.silence < 1500) endRound('escaped', 'time');
  }

  // ── line of sight (8 Hz) ──
  let losT = 0;
  function updateLos(dt) {
    losT -= dt; if (losT > 0) return; losT = 0.12;
    const a = posOf('a'); const b = posOf('b');
    const los = geo.lineOfSight(a.x, a.z, a.y, b.x, b.z, b.y);
    for (const w of AB) {
      const p = P2[w];
      if (p.los && !los) { const o = posOf(other(w)); p.lastSeen = { x: o.x, z: o.z, t: performance.now() }; }
      p.seenT = los && p.los ? p.seenT + 0.12 : 0;
      p.los = los;
      // cover: under a bridge deck, or on a road the map flags `cover: true` (counts as out of sight)
      p.cover = S.R && roleOf(w) === 'runner' ? underCover(posOf(w)) : false;
    }
  }
  function underCover(c) {
    if (c.level >= 0) return false;
    geo.nearestRoad(c.x, c.z, nq, 14, (r) => r.cover || r.bridge);
    if (nq.road < 0) return false;
    const r = geo.roads[nq.road];
    if (nq.d > r.hw) return false;
    if (r.cover) return true;
    return nq.s > 14 && nq.s < r.len - 14 && geo.deckY(r, nq.s) - c.y > 2.5;
  }
  const posOf = (w) => (local(w) ? P2[w].car : P2[w].shown);

  // ── remote car ──
  const pred = { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, r: 0, st: 0, hp: 100, fl: 0, es: 0, nt: 0, lv: -1, rpm: 0, ph: 0, rd: -1, pz: 0, ry: 0, sv: 0, tp: 0, sl: 0, gk: 1 };
  const ctR = { pen: 0, nx: 0, nz: 0, px: 0, pz: 0, ia: 0, ib: 0 };
  function updateRemote(dt) {
    if (!live) return;
    const o = other(me); const p = P2[o];
    if (!link.predict(pred)) { p.predOk = false; return; }
    // right after a bump the partner's streamed samples are from before it: carry the impulse in
    // the prediction until they show it
    applyCorr(p, pred);
    for (const k in pred) p.remote[k] = pred[k];
    p.predOk = true; p.predAt = performance.now();
    const sh = p.shown;
    // drawn = prediction + an error offset that decays to zero (no steady lag behind the truth)
    // a stalled stream (the partner's phone hitched): the newest sample older than STALE_MS makes
    // the partner's car a ghost (not solid on either phone, drawn faded by cars.js via p.stale)
    // until a fresh sample arrives, and a 12–40 m prediction error slews over 250 ms instead of snapping
    const age = link.sampleAge; // (a hitch is a gap well above the partner's own cadence: a phone streaming at 3 fps is slow, not stalled)
    if (age > Math.max(STALE_MS, link.sampleGap * 2.2)) { p.stale = true; p.freshAt = 0; }
    else if (p.stale) {
      // the stream is back: still a ghost for one more sample interval (until the interpolation
      // has samples from after the stall on both sides) and until the cars are apart (turning
      // solid inside my car, driven into the ghost meanwhile, would be a violent shove)
      const tn = performance.now(); if (!p.freshAt) p.freshAt = tn;
      if (tn - p.freshAt > Math.max(120, link.sampleGap * 1.5) && carContact(P2[me].car, pred, ctR) <= 0) p.stale = false;
    }
    S.linkStale = p.stale;
    const err = sh.init ? Math.hypot(pred.x - sh.x, pred.z - sh.z) : Infinity;
    if (!sh.init || err > 40) { sh.x = pred.x; sh.z = pred.z; sh.y = pred.y; sh.yaw = pred.yaw; sh.ox = 0; sh.oz = 0; sh.oy = 0; sh.oyaw = 0; sh.init = true; p.pushX = 0; p.pushZ = 0; }
    else {
      sh.ox = sh.x - (sh.px ?? pred.x); sh.oz = sh.z - (sh.pz ?? pred.z); sh.oyaw = wrapA(sh.yaw - (sh.pyaw ?? pred.yaw));
      const k = Math.exp(-dt * (err > 12 ? 4 : 10));
      sh.ox *= k; sh.oz *= k; sh.oyaw *= k;
      sh.x = pred.x + sh.ox; sh.z = pred.z + sh.oz; sh.y += (pred.y - sh.y) * Math.min(1, dt * 14); sh.yaw = pred.yaw + sh.oyaw;
    }
    // pushed out of my car on contact (decays)
    if (p.pushX || p.pushZ) { const pl = Math.hypot(p.pushX, p.pushZ); if (pl > 0.6) { p.pushX *= 0.6 / pl; p.pushZ *= 0.6 / pl; } sh.x += p.pushX; sh.z += p.pushZ; const k = Math.exp(-dt * 8); p.pushX *= k; p.pushZ *= k; if (Math.abs(p.pushX) + Math.abs(p.pushZ) < 0.01) { p.pushX = 0; p.pushZ = 0; } }
    sh.px = pred.x; sh.pz = pred.z; sh.pyaw = pred.yaw;
    sh.vx = pred.vx; sh.vz = pred.vz; sh.r = pred.r;
    // mirror what we need for visuals
    const c = p.car;
    c.x = sh.x; c.z = sh.z; c.y = sh.y; c.yaw = sh.yaw; c.vx = pred.vx; c.vz = pred.vz; c.hp = pred.hp; c.rpm = pred.rpm; c.steer = pred.st;
    c.speed = Math.hypot(pred.vx, pred.vz); c.flat = pred.fl & F_FLAT ? 1 : 0; c.boost = !!(pred.fl & F_BOOST); c.skid = !!(pred.fl & F_SKID);
    c.braking = !!(pred.fl & F_BRAKE); c.slip = pred.sl; c.nitro = pred.nt; c.wheel += c.speed * dt / 0.36;
    c.vf = c.vx * Math.sin(c.yaw) - c.vz * Math.cos(c.yaw);
    p.esc = pred.es;
    if (pred.lv >= 0 !== (c.level >= 0)) c.level = pred.lv;
  }
  const pubS = { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, r: 0, st: 0, hp: 100, fl: 0, es: 0, nt: 0, lv: -1, rpm: 0, ph: 0, rd: -1, pz: 0, ry: 0, sv: 0, tp: 0, sl: 0, gk: 1 };
  function publish() {
    if (!live) return;
    const p = P2[me]; const c = p.car;
    pubS.x = Math.round(c.x * 100) / 100; pubS.z = Math.round(c.z * 100) / 100; pubS.y = Math.round(c.y * 100) / 100;
    pubS.yaw = Math.round(c.yaw * 1000) / 1000; pubS.vx = Math.round(c.vx * 100) / 100; pubS.vz = Math.round(c.vz * 100) / 100; pubS.r = Math.round(c.r * 1000) / 1000;
    pubS.st = Math.round(c.steer * 100) / 100; pubS.hp = Math.round(c.hp * 10) / 10;
    pubS.fl = (c.boost ? F_BOOST : 0) | (c.braking ? F_BRAKE : 0) | (c.hand ? F_HAND : 0) | (c.spinT > 0 ? F_SPIN : 0) | (c.flat > 0 ? F_FLAT : 0) | (S.phase === 'chase' && roleOf(me) === 'cop' ? F_SIREN : 0) | (c.skid ? F_SKID : 0) | (c.water ? F_WATER : 0);
    pubS.es = Math.round(p.esc * 100) / 100; pubS.nt = Math.round(c.nitro * 100) / 100; pubS.lv = c.level; pubS.rpm = Math.round(c.rpm * 100) / 100;
    pubS.ph = PH[S.phase] ?? 0; pubS.rd = S.R ? S.R.idx : -1; pubS.pz = S.reasons; pubS.ry = S.meReady ? 1 : 0; pubS.sv = S.loading ? 0 : S.mapIdx + 1; pubS.tp = Math.round(p.stats.top * 10) / 10; pubS.sl = Math.round(c.slip * 10) / 10; pubS.gk = Math.round(simRate * 100) / 100;
    link.publish(pubS);
  }

  // ── phase from the shared clock ──
  function updatePhase(now) {
    const R = S.R;
    if (!R || S.phase === 'final' || S.phase === 'lobby' || S.phase === 'loading') return;
    if (R.over) { S.phase = 'result'; return; }
    const intro = R.intro != null ? R.intro : TUNE.intro ?? FLOW.intro;
    let ph;
    if (now < R.at) ph = 'wait';
    else if (now < R.at + intro && now < R.t0) ph = 'intro';
    else if (now < R.t0) ph = 'count';
    else ph = 'chase';
    if (ph !== S.phase) {
      const prev = S.phase; S.phase = ph;
      if (ph === 'intro') {
        const spw = S.mapEntry.spawns && S.mapEntry.spawns[R.spawn];
        const lm = (spw && spw.where) || nearestLandmark(P2[R.runner].car);
        hud.card(introCard({ name: nameOf }, { map: S.mapEntry, round: R.idx, rounds: S.match.rounds, runner: R.runner, me: human(), landmark: lm, roundTime: Math.round((R.endAt - R.t0) / 1000), local: !live }), 'clear bottom');
      }
      if (ph === 'count') {
        hud.card(null);
        // no intro card this round: the role swap is a stamp over the countdown
        if (prev !== 'intro' && R.idx > 0) { for (const w of viewers()) H0().view(w).stamp(split() ? `${nameOf(R.runner).toUpperCase()} RUNS` : roleOf(w) === 'cop' ? 'YOU’RE THE COP' : 'YOU’RE RUNNING', (roleOf(w) === 'cop' && !split() ? 'bad' : R.runner) + ' sm'); audio.whoosh(); }
      }
      if (ph === 'chase') {
        hud.card(null);
        const db = daily() ? dailyRival() : null;
        for (const w of viewers()) { const v = H0().view(w); v.count('GO'); later(() => v.count(''), 700); v.hint(db ? `Beat ${db.name}: ${dailyText(db.score, S.match.rules.roundTime)}` : R.sd ? (roleOf(w) === 'cop' ? 'Sudden death! Bust them and it’s yours.' : 'Sudden death! Survive 0:45 and it’s yours.') : roleOf(w) === 'cop' ? (rules().spikes ? 'Bust them! Tap the map to drop spike strips.' : 'Bust them! Get alongside and PIT their back corner.') : 'Go! Lose the cop or survive the clock.', 3200); }
        audio.beep(true);
      }
      void prev;
    }
    // the final 15 seconds: a stamp, a heartbeat that quickens (frame), the siren yelping within 60 m
    const f15 = ph === 'chase' && !R.over && R.endAt - now < 15000 && R.endAt > now;
    if (f15 !== !!S.final15) { S.final15 = f15; if (f15) { for (const w of viewers()) H0().view(w).stamp('FINAL 15', 'bad sm'); S.beatT = 0; } }
    if (ph === 'count') {
      const n = Math.ceil((R.t0 - now) / 1000);
      for (const w of viewers()) { const v = H0().view(w); const t = n > 0 && n <= 3 ? String(n) : ''; if (v.els.count.textContent !== t) { v.count(t); if (t) audio.beep(false); } }
    }
  }
  function nearestLandmark(c) {
    const L = (S.mapEntry && S.mapEntry.landmarks) || []; let best = null; let bd = Infinity;
    for (const l of L) { if (l.far) continue; const d = Math.hypot(l.x - c.x, l.z - c.z); if (d < bd) { bd = d; best = l; } }
    return best ? best.name : '';
  }

  // ── camera ──
  const tmpV = { x: 0, y: 0, z: 0 };
  function updateCam(w, dt, now) {
    const cr = cams[w]; const cam = cr.cam; const p = P2[w]; const c = p.car;
    const lobby = S.phase === 'lobby' || S.phase === 'loading' || S.phase === 'wait' && !S.R;
    if (lobby || !S.R) {
      // title orbit around the first landmark (or the map centre)
      const L = S.mapEntry && S.mapEntry.landmarks && (S.mapEntry.landmarks.find((l) => l.home) || S.mapEntry.landmarks.find((l) => !l.far));
      const B = geo.bounds; const cx = L ? L.x : (B.x0 + B.x1) / 2; const cz = L ? L.z : (B.z0 + B.z1) / 2;
      const a = now / 1000 * 0.06; const r = 210;
      cam.fov = 55; cam.position.set(cx + Math.sin(a) * r, geo.ground(cx, cz) + 95, cz + Math.cos(a) * r); cam.lookAt(cx, geo.ground(cx, cz) + 10, cz);
      cam.updateProjectionMatrix(); cr.init = false; cr.see = false;
      return;
    }
    const intro = S.phase === 'intro' || S.phase === 'wait';
    if (intro) {
      const R = S.R; const rc = P2[R.runner].car;
      const a = ((now - R.at) / 1000) * 0.32 + 0.6; let r = 26;
      // keep the orbit out of buildings: pull in to the first wall between the car and the camera
      const tb = geo.segBlocked(rc.x, rc.z, rc.x + Math.sin(a) * r, rc.z + Math.cos(a) * r, 1.5, true);
      if (tb < 1) r = Math.max(6, r * tb - 1.5);
      cam.fov = 58; cam.position.set(rc.x + Math.sin(a) * r, rc.y + 3 + r * 0.24, rc.z + Math.cos(a) * r); cam.lookAt(rc.x, rc.y + 1.2, rc.z);
      cam.updateProjectionMatrix(); cr.init = false; cr.see = false;
      return;
    }
    const mode = CAM[cr.mode || rules().camera] || CAM.near;
    cr.see = true; // chase view: traffic / poles between the lens and my car dither away (gfx.js GTW_SEE)
    // follow the velocity a little when sliding, so drifts read from behind
    let hy = c.yaw;
    if (c.speed > 4) { const vy = Math.atan2(c.vx, -c.vz); const d = wrapA(vy - c.yaw); if (Math.abs(d) < 2) hy = c.yaw + d * 0.45; }
    if (cr.look) hy += Math.PI;
    const portraitK = cr.aspect < 1 ? 1.3 : 1;
    if (!cr.init) { cr.yaw = hy; cr.d = mode.dist * portraitK; cr.x = c.x - Math.sin(hy) * cr.d; cr.z = c.z + Math.cos(hy) * cr.d; cr.y = c.y + mode.height; cr.fov = CAM.fov; cr.init = true; }
    cr.yaw += wrapA(hy - cr.yaw) * Math.min(1, dt * (cr.look ? 20 : 5.5));
    const fx0 = Math.sin(cr.yaw); const fz0 = -Math.cos(cr.yaw);
    // The rig is smoothed in the car's frame (yaw above, and a 1-D follow distance here), not in
    // world space: a world-space spring lags v/k metres at speed and used to ride a hard clamp
    // above 140 km/h. Throttle pushes the lens out (up to +1 m), braking dives in (up to 1.8 m).
    const push = Math.max(-1.8, Math.min(1.0, (c.accF || 0) * CAM.accPull));
    let dGoal = (mode.dist + Math.min(2.2, c.speed * 0.03) + push) * portraitK;
    // pull in when a building is in the way
    const tx = c.x - fx0 * dGoal; const tz = c.z - fz0 * dGoal;
    const t = geo.segBlocked(c.x, c.z, tx, tz, 3);
    if (t < 1) dGoal = Math.max(3.2, dGoal * t - 0.8);
    cr.d += (dGoal - cr.d) * Math.min(1, dt * (dGoal < cr.d ? 9 : 6)); // in faster than out (occlusion must snap)
    const gx = c.x - fx0 * cr.d; const gz = c.z - fz0 * cr.d;
    const gy = Math.max(c.y + mode.height * portraitK + (t < 1 ? 1.2 : 0), geo.ground(gx, gz) + 1.4);
    cr.x = gx; cr.z = gz; cr.y += (gy - cr.y) * Math.min(1, dt * 6);
    let sx = 0; let sy = 0;
    // a hit: ±0.9 / 0.6 m of jitter with a 0.2 s half-life (was 0.5 / 0.35 and 0.14 s: ~1° for 0.3 s) and a roll kick
    const shk = reduced ? cr.shake * 0.25 : cr.shake;
    if (cr.shake > 0.01) { sx = (Math.random() - 0.5) * shk * 0.9; sy = (Math.random() - 0.5) * shk * 0.6; cr.shake *= Math.max(0, 1 - dt * 3.5); }
    cam.position.set(cr.x + sx, cr.y + sy, cr.z);
    tmpV.x = c.x + fx0 * mode.ahead; tmpV.y = c.y + mode.look; tmpV.z = c.z + fz0 * mode.ahead;
    cam.lookAt(tmpV.x, tmpV.y, tmpV.z);
    if (cr.rollKick) { cam.rotateZ(cr.rollKick * (reduced ? 0.25 : 1)); cr.rollKick *= Math.max(0, 1 - dt * 4); if (Math.abs(cr.rollKick) < 0.001) cr.rollKick = 0; }
    const portrait = cams[w].aspect < 1;
    const base = portrait ? CAM.portraitFov : CAM.fov;
    const fT = base + CAM.fovSpeed * Math.pow(Math.min(1, c.speed / 46), 1.5) + (c.boost ? CAM.fovNitro : 0);
    cr.fov += (fT - cr.fov) * Math.min(1, dt * (fT > cr.fov ? 6 : 3)); // a quick lunge wider on nitro, a slow settle back
    if (Math.abs(cam.fov - cr.fov) > 0.05) { cam.fov = cr.fov; cam.updateProjectionMatrix(); }
  }

  // ── drawing ──
  const dummy = { m: null };
  function drawCars(dt) {
    const rw = runnerW(); const cw = copW();
    const vRun = rw === 'a' ? carViews.runA : carViews.runB; const vOther = rw === 'a' ? carViews.runB : carViews.runA;
    vOther.group.visible = false; carViews.cop2.group.visible = false;
    const inGame = !!S.R;
    let slot = 0;
    for (const [w, v] of [[rw, vRun], [cw, carViews.cop]]) {
      const c = P2[w].car;
      v.group.visible = inGame;
      if (inGame) { const lk = liveryOf(w, w === rw ? 'runner' : 'cop'); if (lk !== v.livery) v.setLivery(lk); }
      if (!inGame) { for (let k = 0; k < 4; k++) wheels.set(slot, k, 0, -100, 0, 0, 0, 0, 0, false); slot++; continue; }
      v.pose(c.x, c.y, c.z, c.yaw, local(w) ? c.pitch : 0, local(w) ? c.roll : 0, c.flat);
      if (v.update) v.update(c, dt); // lights, lean, dirt, damage (cars.js)
      const steerA = c.steer * 0.45;
      for (let k = 0; k < 4; k++) wheels.set(slot, k, c.x, c.y, c.z, c.yaw, steerA, c.wheel, c.flat, true);
      slot++;
    }
    wheels.commit();
    // lightbar + siren tint
    const cc = P2[cw].car;
    const on = inGame && (S.phase === 'chase' || S.phase === 'count');
    const f = carViews.cop.flash(dt, on);
    if (f >= 0) {
      const sy = Math.sin(cc.yaw); const cy = Math.cos(cc.yaw);
      U.uSiren.value.set(cc.x + sy * 0.4, cc.y + 1.8, cc.z - cy * 0.4, P.dark ? 1 : 0.3);
      U.uSirenCol.value.setRGB(f === 0 ? 1 : 0.15, f === 0 ? 0.12 : 0.35, f === 0 ? 0.15 : 1);
    } else U.uSiren.value.w = 0;
    // my headlights at night
    if (P.dark && inGame) { const c = P2[human()].car; U.uHead.value.set(c.x + Math.sin(c.yaw) * 2.2, c.y + 0.7, c.z - Math.cos(c.yaw) * 2.2, 1); U.uHeadDir.value.set(Math.sin(c.yaw), -0.08, -Math.cos(c.yaw)).normalize(); }
    else U.uHead.value.w = 0;
  }
  function carFx(dt) {
    if (!S.R) return;
    for (const w of AB) {
      const p = P2[w]; const c = p.car;
      const sy = Math.sin(c.yaw); const cy = Math.cos(c.yaw); const fx0 = sy; const fz0 = -cy; const rx = cy; const rz = sy;
      // skid marks from the rear wheels
      const rlx = c.x - fx0 * 1.38 - rx * 0.86; const rlz = c.z - fz0 * 1.38 - rz * 0.86;
      const rrx = c.x - fx0 * 1.38 + rx * 0.86; const rrz = c.z - fz0 * 1.38 + rz * 0.86;
      if (c.skid && c.surf !== 'grass' && c.surf !== 'dirt' && c.surf !== 'sand' && !Number.isNaN(p.prevRL[0])) {
        fx.skid(p.prevRL[0], c.y, p.prevRL[2], rlx, c.y, rlz, 0.3);
        fx.skid(p.prevRR[0], c.y, p.prevRR[2], rrx, c.y, rrz, 0.3);
        if (Math.random() < dt * 10) fx.puff(rrx, c.y + 0.3, rrz, -c.vx * 0.1, 0.6, -c.vz * 0.1, 0.3, 1.2, 0.7, 0.92, 0.92, 0.92);
      }
      p.prevRL[0] = rlx; p.prevRL[2] = rlz; p.prevRR[0] = rrx; p.prevRR[2] = rrz;
      // dust off-road
      if ((c.surf === 'grass' || c.surf === 'dirt' || c.surf === 'sand') && c.speed > 6) {
        p.dustT -= dt;
        if (p.dustT <= 0) { p.dustT = 0.05; const col = c.surf === 'grass' ? [0.62, 0.6, 0.46] : c.surf === 'sand' ? [0.92, 0.84, 0.64] : [0.72, 0.6, 0.44]; fx.puff(rrx, c.y + 0.3, rrz, -c.vx * 0.12 + (Math.random() - 0.5) * 2, 0.8, -c.vz * 0.12, 0.35, 1.3, 0.8, col[0], col[1], col[2]); }
      }
      // damage smoke + fire
      const hpK = roleOf(w) === 'runner' ? c.hp : c.hp + 15;
      if (hpK < DAMAGE.smoke) {
        p.smokeT -= dt;
        if (p.smokeT <= 0) {
          p.smokeT = hpK < DAMAGE.fire ? 0.05 : 0.12;
          const hx = c.x + fx0 * 1.6; const hz = c.z + fz0 * 1.6;
          const g = hpK < DAMAGE.fire ? 0.2 : 0.45;
          fx.puff(hx, c.y + 1.2, hz, -c.vx * 0.2, 2.2, -c.vz * 0.2, 0.4, 1.8, 1.4, g, g, g + 0.02);
          if (hpK < DAMAGE.fire) fx.puff(hx, c.y + 1.1, hz, -c.vx * 0.1, 1.5, -c.vz * 0.1, 0.45, 0.4, 0.35, 1, 0.45 + Math.random() * 0.3, 0.1);
        }
      }
      // rims on the road
      if (c.flat > 0 && c.speed > 5) { p.sparkT -= dt; if (p.sparkT <= 0) { p.sparkT = 0.06; fx.spark(rlx, c.y + 0.1, rlz, -c.vx * 0.3 + (Math.random() - 0.5) * 3, 2, -c.vz * 0.3 + (Math.random() - 0.5) * 3, 0.3); } }
      // nitro flames
      if (c.boost) { const ex = c.x - fx0 * 2.4; const ez = c.z - fz0 * 2.4; fx.puff(ex, c.y + 0.35, ez, -fx0 * 6, 0.3, -fz0 * 6, 0.22, 0.2, 0.18, 0.3, 0.75, 1); }
    }
  }
  function drawTraffic(tT) {
    if (!traffic || !trafficMeshes) return;
    const tv = trafficMeshes;
    const vs = viewers();
    const c0 = cams[vs[0]].cam.position;
    tv.begin(c0, vs.map((w) => cams[w].cam));
    // the nearest cars to any viewer first, so every car that can be hit is drawn
    if (traffic.total && S.mapEntry) {
      selV.length = 0; for (const w of vs) { const cp = cams[w].cam.position; const cc = P2[w].car; selV.push({ x: (cp.x + cc.x) / 2, z: (cp.z + cc.z) / 2 }); }
      const n = traffic.select(selV, tT, TRAFFIC.max, TRAFFIC.near, selOut);
      for (let i = 0; i < n; i++) tv.add(selOut[i].id, selOut[i]);
    }
    tv.end();
  }
  let dm = null; let tc = null; const selV = []; const selOut = [];
  function drawStrips(now) {
    const R = S.R; const list = stripList; list.length = 0;
    if (R) {
      for (const s of R.spikes) {
        if (s.gone) continue;
        if (!stripVisible(s, now)) continue;
        const k = clamp((now - (s.at - RULES.spikeDeploy)) / RULES.spikeDeploy, 0.05, 1);
        s.k = k; list.push(s);
      }
    }
    fx.setStrips(list);
    const ol = oilList; ol.length = 0;
    if (R) for (const o of R.oils) { const age = (now - o.at) / 1000; if (age < RULES.oilT) { o.k = clamp(age * 3, 0.1, 1) * (age > RULES.oilT - 2 ? (RULES.oilT - age) / 2 : 1); ol.push(o); } }
    fx.setOils(ol);
  }
  const stripList = []; const oilList = [];
  /** The runner only sees strips once close (setting); the cop always. Split screen: all. */
  function stripVisible(s, now, w = human()) {
    if (split() || !S.R) return true;
    if (roleOf(w) === 'cop') return true;
    if (rules().spikeSee === 'always') return now >= s.at;
    const c = P2[w].car;
    return Math.hypot(s.x - c.x, s.z - c.z) < spikeRevealR(w);
  }

  // ── minimap + map marks ──
  function drawMarks(g, toPx, dpr, k, w, full) {
    const R = S.R; const now = clock();
    const L = (S.mapEntry && S.mapEntry.landmarks) || [];
    for (const lm of L) {
      if (lm.far && !full) continue;
      let lx = lm.x; let lz = lm.z;
      if (lm.far) { const B = geo.bounds; lx = clamp(lx, B.x0 + 30, B.x1 - 30); lz = clamp(lz, B.z0 + 30, B.z1 - 30); }
      const [x, y] = toPx(lx, lz); hud.drawLandmark(g, x, y, lm, dpr * (full ? 1 : 0.8)); if (full) { g.font = `800 ${11 * dpr}px system-ui, sans-serif`; g.fillStyle = P.dark ? '#eee' : '#1b1a20'; g.strokeStyle = P.dark ? '#000' : '#fff'; g.lineWidth = 3 * dpr; const nm = lm.far ? lm.name + ' →' : lm.name; g.strokeText(nm, x + 9 * dpr, y + 4 * dpr); g.fillText(nm, x + 9 * dpr, y + 4 * dpr); } }
    if (!R) return;
    const myRole = roleOf(w); const o = other(w);
    // spikes
    for (const s of R.spikes) {
      if (s.gone) continue;
      if (myRole === 'runner' && !split() && !(rules().spikeSee === 'always' ? now >= s.at : Math.hypot(s.x - P2[w].car.x, s.z - P2[w].car.z) < spikeRevealR(w))) continue;
      const [x, y] = toPx(s.x, s.z); hud.drawSpike(g, x, y, s.yaw, dpr * (full ? 1.1 : 0.9), now < s.at);
    }
    if (full && myRole === 'cop' && S.phase === 'chase') {
      const c = P2[w].car; const [cx, cy] = toPx(c.x, c.z);
      g.beginPath(); g.arc(cx, cy, RULES.spikeRange * k, 0, Math.PI * 2); g.setLineDash([6 * dpr, 6 * dpr]); g.lineWidth = 2 * dpr; g.strokeStyle = '#e2333f'; g.stroke(); g.setLineDash([]);
      if (otherVisible(w)) { const rc = posOf(o); const [rx, ry] = toPx(rc.x, rc.z); g.beginPath(); g.arc(rx, ry, Math.max(4 * dpr, spikeNoRunnerR() * k), 0, Math.PI * 2); g.fillStyle = 'rgba(226,51,63,.18)'; g.fill(); }
    }
    // other car
    const showO = otherVisible(w);
    const oc = posOf(o);
    if (showO) { const [x, y] = toPx(oc.x, oc.z); hud.drawArrow(g, x, y, oc.yaw, roleOf(o) === 'cop' ? (Math.floor(performance.now() / 250) % 2 ? '#e2333f' : '#2f6bff') : cssInk(o), (full ? 9 : 7) * dpr); }
    else if (P2[w].lastSeen && myRole === 'cop') {
      const ls = P2[w].lastSeen; const age = (performance.now() - ls.t) / 1000;
      if (age < 12) { const [x, y] = toPx(ls.x, ls.z); g.beginPath(); g.arc(x, y, (6 + (age % 1.2) * 8) * dpr, 0, Math.PI * 2); g.strokeStyle = `rgba(226,51,63,${Math.max(0, 1 - age / 12)})`; g.lineWidth = 2 * dpr; g.stroke(); g.font = `900 ${9 * dpr}px system-ui`; g.fillStyle = '#e2333f'; g.fillText('last seen', x + 8 * dpr, y - 6 * dpr); }
    }
    const mc = P2[w].car; const [mx, my] = toPx(mc.x, mc.z);
    hud.drawArrow(g, mx, my, mc.yaw, myRole === 'cop' ? (Math.floor(performance.now() / 250) % 2 ? '#e2333f' : '#2f6bff') : cssInk(w), (full ? 10 : 8) * dpr, true);
  }
  const inkCss = {};
  function cssInk(w) { if (!inkCss[w]) { const c = P[w]; inkCss[w] = `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`; } return inkCss[w]; }
  /** Does viewer w see the other car on the map? The runner always sees the cop (sirens); the
   *  cop depends on the radar setting. */
  function otherVisible(w) {
    if (!S.R) return false;
    if (roleOf(w) === 'runner' || split()) return true;
    const r = rules().radar;
    if (r === 'always') return true;
    const o = posOf(other(w)); const c = P2[w].car; const d = Math.hypot(o.x - c.x, o.z - c.z);
    if (r === 'los') return P2[w].los || d < 60;
    return d < 35;
  }

  // ── HUD per frame ──
  let miniT = 0; let hudT = 0;
  function updateHud(dt, now) {
    hudT -= dt; miniT -= dt;
    const playing = !!S.R && !split() && (S.phase === 'count' || S.phase === 'chase');
    if (S.playingCls !== playing) { S.playingCls = playing; root.classList.toggle('playing', playing); }
    const vs = viewers(); const R = S.R;
    for (const w of vs) {
      const v = H0().view(w); const p = P2[w]; const c = p.car; const role = roleOf(w);
      const inGame = !!R && S.phase !== 'lobby';
      v.showPlay(inGame && S.phase !== 'final' && S.phase !== 'intro' && S.phase !== 'wait', inGame && S.phase !== 'final');
      if (!inGame) continue;
      if (hudT <= 0) {
        v.scores(S.match.scores.a, S.match.scores.b);
        const pips = []; for (let i = 0, nP = Math.max(S.match.rounds, R.idx + 1); i < nP; i++) { const h = S.match.hist[i]; pips.push(h ? (h.outcome === 'busted' ? other(h.runner) : h.runner) : i === R.idx ? 'now' : ''); }
        v.pips(pips);
        v.role(role, w);
        v.health(c.hp, role);
      }
      const left = R.over && R.result ? Math.max(0, R.endAt - R.result.at) : S.phase === 'chase' ? R.endAt - now : R.endAt - R.t0;
      v.clock(S.paused && S.pausedAt > R.t0 ? R.endAt - S.pausedAt : left, daily() ? 'Daily chase' : R.sd ? 'Sudden death' : `Round ${R.idx + 1}/${S.match.rounds}`, S.phase === 'chase' && left < 15000);
      // the Daily chase: the partner's time today is the line to beat
      if (S.dailyRv && !S.dailyPassed && S.phase === 'chase' && !R.over && S.dailyRv.score < S.match.rules.roundTime && (now - R.t0) / 1000 >= S.dailyRv.score) { S.dailyPassed = true; v.stamp(`PASSED ${S.dailyRv.name.toUpperCase()}!`, 'good sm'); audio.win(); }
      // heat meter
      const rp = P2[R.runner];
      const d = Math.hypot(posOf('a').x - posOf('b').x, posOf('a').z - posOf('b').z);
      if (role === 'runner') { const hd = heatDist(); v.heat(rp.esc, p.los && !p.cover ? (d > hd * RULES.heatBreak ? 'Breaking away' : 'Spotted') : d > hd ? 'Losing them' : 'Too close', `${Math.round(d)} m`, p.los && !p.cover && d <= hd * RULES.heatBreak, S.phase === 'chase'); }
      else v.heat(rp.esc, rp.esc > 0.02 ? 'Slipping away' : 'On their tail', `${Math.round(d)} m`, rp.esc > 0.3, S.phase === 'chase');
      v.speed(c.speed * 3.6);
      v.nitro(c.nitro, c.boost, role === 'cop' || rules().nitro !== 'off');
      if (hudT <= 0) v.tools(role === 'cop' ? `<span class="${p.spikesLeft ? '' : 'off'}">SPIKES ${p.spikesLeft}</span>` : `<span class="${p.oilLeft ? '' : 'off'}">OIL ${p.oilLeft}</span>`);
      // vignette: siren behind the runner, red when hurt
      p.hurtT -= dt;
      const copClose = role === 'runner' && S.phase === 'chase' && d < 45;
      v.vignette(p.hurtT > 0 ? 'hurt' : copClose ? 'siren' : '');
      // the other car's tag + off-screen arrow (live: the partner; practice: the AI)
      if ((live && w === me) || (ai() && w === human())) tagFor(w, v);
      // boxed in: the runner's 3·2·1 to get moving; the cop's 'hold them'
      boxHud(w, v, role, p, d, dt);
      // a hit on the other car lands as a number too (live: from its streamed health)
      if (S.phase === 'chase' && !R.over && role === 'cop' && !local(R.runner) && w === human()) { const rp2 = P2[R.runner]; const hp = rp2.car.hp; if (hp < rp2.hpSeen - 2.5) { v.dmg(rp2.hpSeen - hp, 'them'); rp2.hpSeen = hp; } else if (hp > rp2.hpSeen) rp2.hpSeen = hp; }
      if (miniT <= 0 && mapImg) v.mini(mapImg, c.x, c.z, (g, toPx, dpr, k) => drawMarks(g, toPx, dpr, k, w, false));
      if (!split() && w === human()) hud.setHorn(live && device.emotes !== 'off' && S.phase === 'chase', emoteNext(w));
      if (!split() && w === human()) hud.setAct(role, role === 'cop' ? p.spikesLeft > 0 && S.phase === 'chase' : p.oilLeft > 0 && S.phase === 'chase', role === 'cop' ? p.spikesLeft : p.oilLeft);
    }
    if (hudT <= 0) hudT = 0.2;
    if (miniT <= 0) miniT = 1 / 15;
    if (H0().mapOpen && (S.mapT = (S.mapT || 0) - dt) <= 0) { S.mapT = 0.2; H0().redrawMap(); }
    // pause card
    if (S.paused && S.R && !S.R.over) {
      const sec = S.resumeAt ? Math.max(0, Math.ceil((S.resumeAt - now) / 1000)) : 0;
      // (rebuilt only when what it says changes: no template + escaping every paused frame)
      const pk = (S.resumeAt ? sec + 1 : 0) * 256 + (glLost ? 1 : 0) + (S.glStuck ? 2 : 0) + (S.menu ? 4 : 0) + (partnerHere ? 8 : 0) + (live && link.silence > 2000 ? 16 : 0) + ((S.reasons & PZ.hidden) ? 32 : 0) + (live && P2[other(me)].remote.pz ? 64 : 0);
      if (pk === S.pauseKey && S.pauseCard && hud._card === S.pauseCard) return;
      S.pauseKey = pk;
      const t = S.resumeAt ? `Back in ${sec}…` : glLost || S.glStuck ? 'Graphics paused' : S.menu ? 'Paused' : live && (!partnerHere || link.silence > 2000) ? `Waiting for ${api.name(other(me))}` : 'Paused';
      const sub = S.resumeAt ? 'Get ready' : S.glStuck ? 'The phone ran short of memory and dropped the graphics.' : glLost ? 'One moment…' : S.menu ? (live ? `The chase is paused for ${api.name(other(me))} too.` : '') : live && !partnerHere ? 'The chase carries on when they’re back.' : (S.reasons & PZ.hidden) ? '' : live && P2[other(me)].remote.pz ? `${api.name(other(me))} paused the chase.` : '';
      let btns = null;
      if (S.glStuck) btns = [['glreload', 'Reload graphics'], ['loadlow', 'Reload at low quality']];
      else if (S.menu && !S.resumeAt) { btns = [['resume', 'Resume'], ['settings', 'Settings'], ['howto', 'How to play']]; if (!live) btns.push(['quit', 'Quit to the lobby']); }
      const pc = pauseCard(t, sub, btns);
      hud.card(pc, 'dim');
      S.pauseCard = pc;
    } else if (S.pauseCard) {
      // Only take down the card we put up: Quit/Restart may already have replaced it with the lobby.
      if (hud._card === S.pauseCard) hud.card(null);
      S.pauseCard = null; S.pauseKey = -1;
    }
  }
  /** Boxed-in countdown on the HUD (runner: get moving; cop: hold them). */
  function boxHud(w, v, role, p, d, dt) {
    const R = S.R;
    if (S.phase !== 'chase' || !R || R.over || S.paused) { v.boxed(null); return; }
    if (role === 'runner') {
      if (local(w) && p.stopT > 0.25) { const T = p.boxT || RULES.bustT; const n = Math.max(1, Math.ceil(T - p.stopT)); if (v.boxN !== n || v.boxQ !== !!p.boxQueue) { v.boxN = n; v.boxQ = !!p.boxQueue; v.boxS = `${p.boxQueue ? 'BOXED IN TRAFFIC' : 'BOXED IN'} · MOVE! ${n}`; } v.boxed(1 - p.stopT / T, v.boxS, ''); } else v.boxed(null);
      return;
    }
    // the cop: the runner's own clock when it's on this device, else my estimate from what I see
    const rp = P2[R.runner]; let t = 0; let T = RULES.bustT;
    if (local(R.runner)) { t = rp.stopT; T = rp.boxT || RULES.bustT; } else {
      const stopped = rp.car.speed < RULES.bustStop && d < RULES.bustNear && (P2[w].car.speed < BOX.copSlow || d < BOX.touch);
      S.copBoxT = stopped ? (S.copBoxT || 0) + dt : 0; t = S.copBoxT;
    }
    if (t > 0.25) { const n = Math.max(1, Math.ceil(T - t)); if (v.boxN !== n) { v.boxN = n; v.boxS = `HOLD THEM · ${n}`; } v.boxed(1 - t / T, v.boxS, 'cop'); } else v.boxed(null);
  }
  const proj = { x: 0, y: 0, z: 0 };
  function tagFor(w, v) {
    const o = other(w); const oc = P2[o].car; const cam = cams[w].cam;
    if (!S.R || S.phase === 'intro' || S.phase === 'wait') { v.tag(0, 0, false); v.edgeArrow(0, 0, 0, false); return; }
    if (!live && !otherVisible(w)) { v.tag(0, 0, false); v.edgeArrow(0, 0, 0, false); return; } // (practice: the AI runner's tag follows the radar rule)
    vec.set(oc.x, oc.y + 2.4, oc.z).project(cam);
    const d = Math.hypot(oc.x - P2[w].car.x, oc.z - P2[w].car.z);
    const vw = W; const vh = H;
    const on = vec.z < 1 && Math.abs(vec.x) < 1 && Math.abs(vec.y) < 1 && d < 300;
    const bub = S.bubble && S.bubble.w === o && performance.now() < S.bubble.until ? S.bubble : null;
    const dm = Math.round(d); if (v.tagD !== dm || v.tagO !== o || v.tagB !== bub) { v.tagD = dm; v.tagO = o; v.tagB = bub; v.tagS = bub ? `${nameOf(o)}: ${bub.text}` : `${nameOf(o)} · ${dm} m`; }
    v.tag((vec.x * 0.5 + 0.5) * vw, (-vec.y * 0.5 + 0.5) * vh, on, v.tagS, bub ? 'emote' : roleOf(o) === 'cop' ? 'cop' : '');
    void proj;
    // off-screen: an edge arrow towards them (when close)
    if (!on && d < 160 && otherVisible(w)) {
      let x = vec.x; let y = vec.y; if (vec.z > 1) { x = -x; y = -y; }
      const a = Math.atan2(x, y); const m = Math.max(Math.abs(x), Math.abs(y)) || 1;
      v.edgeArrow(clamp((x / m) * 0.5 + 0.5, 0.06, 0.94) * vw, clamp((-y / m) * 0.5 + 0.5, 0.12, 0.88) * vh, a, true);
    } else v.edgeArrow(0, 0, 0, false);
  }
  let vec = null;

  // ── frame ──
  let acc = 0; let lastTs = 0; let lastWall = 0; let lobbyT = 0;
  // simulated seconds per wall second, smoothed over ~0.3 s (streamed as gk: the partner dead-
  // reckons my car with it); 1 while the phone keeps up, less under 8 fps or in slow motion
  let simRate = 1;
  function frame(ts) {
    if (dead) return;
    raf = requestAnimationFrame(frame);
    // (up to 125 ms a frame the simulation keeps up with the shared clock: a phone at 8+ fps still
    // runs in real time, so the partner's prediction of its car stays true; longer gaps are dropped)
    const wallDt = lastTs ? (ts - lastTs) / 1000 : 0.016; lastTs = ts;
    const dtReal = Math.min(0.125, wallDt); let simDt = dtReal;
    if (!ready3D || !world) return;
    if (S.loading && S.loadingCard) return; // a map is building behind the loading card: leave it the main thread
    if (window.__gtwTest) { const fl = window.__gtwFrames || (window.__gtwFrames = []); fl.push(performance.now()); if (fl.length > 4000) fl.splice(0, 2000); } // tests: tell rendered frames from load work
    const w0 = performance.now();
    const now = clock();
    if (!vec) { vec = new THREE.Vector3(); dm = new THREE.Object3D(); tc = new THREE.Color(); }
    // pause bookkeeping
    if (isHost || !live) hostPauseCheck(now); else guestPauseCheck(now);
    if (!live && S.paused === false && (S.reasons || softReasons.size)) { /* handled by hostPauseCheck */ }
    updatePhase(now);
    if (S.phase === 'lobby' && (lobbyT -= dtReal) <= 0) { lobbyT = 0.5; renderLobby(false); } // (partner arriving / loading, records: keyed, cheap)
    // a rematch in place: the host starts the next match as soon as both are back in the lobby
    if (S.rematchCard) {
      if (S.autoStart && S.phase === 'lobby' && hostStart(FLOW.rematchLead, true)) S.autoStart = 0;
      else if (performance.now() - S.rematchAt > 15000) { S.rematchCard = false; S.autoStart = 0; renderLobby(true); }
    }
    updateRemote(dtReal);
    // slow motion after a PIT; a hard hit's quarter second at half speed; the hit-stop itself
    // (60–90 ms with the simulation held while the frame still draws: the frame of impact lands)
    let tsK = 1;
    if (S.slowT > 0) { S.slowT -= dtReal; tsK = RULES.slowMoScale; }
    else if (S.hitSlowT > 0) { S.hitSlowT -= dtReal; tsK = RULES.hitSlowK; }
    let stopped = false;
    if (S.stopT > 0) { S.stopT -= dtReal; stopped = true; }
    const chase = S.phase === 'chase' && !S.paused && S.R && !S.R.over;
    // run the traffic simulation up to the round start a few ms per frame (no hitch at the go)
    if (!chase && traffic && traffic.warm) traffic.warm(600.5, 4);
    if (chase) {
      // traffic time of each step: the steps cover the frame up to now (slow motion slows traffic too)
      const tT = (now - S.R.t0) / 1000 + 600;
      if (!stopped) {
        acc += dtReal * tsK;
        let n = 0;
        // a slow frame (> 50 ms: a hot phone after a thermal throttle) steps at 1/60 with at most 8
        // substeps and lets the shared clock slip the rest (the partner's prediction tolerates 220 ms),
        // so a 125 ms frame costs ~4 substeps' worth of JS instead of 15
        const slow = dtReal > 0.05; const step = slow ? DT * 2 : DT; const maxN = slow ? MAX_STEPS_SLOW : MAX_STEPS;
        aiTicks = 0;
        if (acc >= step) trafficCandidates(tT);
        const nSteps = Math.min(maxN, Math.floor(acc / step));
        while (acc >= step && n < maxN) { simStep(step, now, tT - (nSteps - 1 - n) * step * tsK, -(nSteps - 1 - n) * step * tsK); acc -= step; n++; }
        if (n >= maxN) acc = 0;
        simDt = n * step;
        if (n > 0) flushKnocks();
        if (TLOG && live) { const c = P2[me].car; const pr = P2[other(me)]; TLOG.traj.push({ t: now, x: c.x, z: c.z, yaw: c.yaw, px: pr.remote.x, pz: pr.remote.z, nc: pr.corr ? pr.corr.length : 0 }); if (TLOG.traj.length > 2400) TLOG.traj.splice(0, 600); }
        trafficStep(dtReal * tsK, tT);
        traffic.stepWrecks(dtReal, carsOfViewers());
        updateLos(dtReal);
        runnerChecks(dtReal * tsK, now);
        S.stopTT = tT;
      }
      copFallback(now);
    } else {
      acc = 0;
      if (S.R && !S.R.over && S.phase !== 'chase') {
        // countdown: hold the cars (but let them rev)
        for (const w of AB) { const p = P2[w]; readPad(p.pad, p.inp, dtReal); p.car.rpm += ((p.inp.gas ? 0.9 : 0.2) - p.car.rpm) * Math.min(1, dtReal * 6); }
      }
      if (S.R && S.R.over) { const dk = dtReal * tsK; for (const w of AB) if (local(w)) { const c = P2[w].car; c.vx *= Math.max(0, 1 - dk * 1.5); c.vz *= Math.max(0, 1 - dk * 1.5); c.r *= Math.max(0, 1 - dk * 2); c.x += c.vx * dk; c.z += c.vz * dk; c.yaw += c.r * dk; c.speed = Math.hypot(c.vx, c.vz); } }
    }
    // (a hitch over 0.25 s isn't a rate: that time is dropped from the shared clock anyway)
    if (wallDt > 0 && wallDt < 0.25) { const inst = !chase ? 1 : stopped ? 0 : Math.min(1.2, simDt / wallDt); simRate += (inst - simRate) * Math.min(1, wallDt / 0.3); }
    S.tSec += dtReal;
    // visuals
    const tT = S.R ? (now - S.R.t0) / 1000 + 600 : now / 1000;
    drawCars(dtReal);
    drawTraffic(S.paused && S.R ? (S.pausedAt - S.R.t0) / 1000 + 600 : stopped && S.stopTT ? S.stopTT : tT);
    drawStrips(now);
    if (!S.paused) carFx(dtReal);
    fx.update(dtReal, cams[human()].cam);
    if (S.mapEntry && typeof S.mapEntry.animate === 'function') { try { S.mapEntry.animate(S.tSec, animCars); animCars[0].x = P2.a.car.x; animCars[0].z = P2.a.car.z; animCars[1].x = P2.b.car.x; animCars[1].z = P2.b.car.z; } catch (e) { if (!S.animErr) { S.animErr = true; console.warn('getaway: map.animate failed', e); } } }
    // audio
    const mc = P2[human()].car; const oc = P2[other(human())].car;
    if (S.R && (S.phase === 'chase' || S.phase === 'count' || S.phase === 'result')) {
      meA.rpm = mc.rpm; meA.gas = P2[human()].inp.gas; meA.slip = mc.slip; meA.speed = mc.speed; meA.flat = mc.flat; meA.boost = mc.boost; meA.offroad = mc.surf === 'grass' || mc.surf === 'dirt' || mc.surf === 'sand';
      themA.rpm = oc.rpm; themA.dist = Math.hypot(oc.x - mc.x, oc.z - mc.z);
      { // Doppler (closing speed along the line between us) and stereo pan (bearing vs my camera)
        const dx = oc.x - mc.x; const dz = oc.z - mc.z; const d = Math.hypot(dx, dz) || 1;
        themA.vrel = -((oc.vx - mc.vx) * dx + (oc.vz - mc.vz) * dz) / d;
        const cy = cams[human()].yaw || mc.yaw; themA.pan = (dx * Math.cos(cy) + dz * Math.sin(cy)) / d;
      }
      const cop = P2[copW()].car; const iAmCop = roleOf(human()) === 'cop';
      sirenA.on = S.phase === 'chase' && !S.paused; sirenA.dist = iAmCop ? 30 : themA.dist; sirenA.yelpR = S.final15 ? 60 : 40;
      if (S.final15 && !S.paused && S.R) { S.beatT -= dtReal; if (S.beatT <= 0) { const k = clamp(1 - (S.R.endAt - now) / 15000, 0, 1); S.beatT = 60 / (72 + 38 * k); if (audio.heartbeat) audio.heartbeat(k); } }
      sirenA.vrel = iAmCop ? 0 : themA.vrel; sirenA.pan = iAmCop ? 0 : themA.pan; void cop;
      audio.engine(S.paused ? null : meA, S.paused ? null : themA, sirenA, dtReal);
      // the pursuit bed: closer, hotter and later is louder and faster (records.js-free, audio.js music)
      if (S.phase === 'chase' && !S.paused && !S.R.over && device.music !== 'off') {
        const rp = P2[S.R.runner]; const I = clamp(0.35 * (1 - themA.dist / 200) + 0.4 * rp.esc + (S.R.endAt - now < 20000 ? 0.25 : 0), 0, 1);
        audio.music(I);
        if (rp.esc > 0.5 && !S.riserOn) { S.riserOn = true; if (audio.riser) audio.riser(); } else if (rp.esc < 0.35) S.riserOn = false;
      } else audio.music(null);
      if (mc.boost && !S.wasBoost) audio.nitro();
      S.wasBoost = mc.boost;
    } else { audio.engine(null, null, null, dtReal); audio.music(null); }
    // render
    const vs = viewers();
    renderer.info.reset();
    renderer.setScissorTest(vs.length > 1);
    for (let i = 0; i < vs.length; i++) {
      const w = vs[i]; const cr = cams[w];
      const vw = vs.length > 1 ? Math.floor(W / 2) : W; const vx = vs.length > 1 ? i * Math.floor(W / 2) : 0;
      cr.aspect = vw / H;
      if (Math.abs(cr.cam.aspect - cr.aspect) > 1e-3) { cr.cam.aspect = cr.aspect; cr.cam.updateProjectionMatrix(); }
      updateCam(w, dtReal, now);
      world.update(cr.cam, dtReal, S.tSec);
      // the sight cone for see-through materials: from this view's camera to its car (radius 2.4 m
      // at the car, about its silhouette from behind)
      { const sc = P2[w].car; if (cr.see) U.uSee.value.set(sc.x, sc.y + 0.75, sc.z, 2.4); else U.uSee.value.w = 0; }
      renderer.setViewport(vx, 0, vw, H); renderer.setScissor(vx, 0, vw, H);
      farCam.position.copy(cr.cam.position); farCam.quaternion.copy(cr.cam.quaternion); farCam.fov = cr.cam.fov; farCam.aspect = cr.cam.aspect; farCam.updateProjectionMatrix();
      const c = P2[w].car;
      const sl = S.phase === 'chase' && !reduced ? clamp((c.speed - 24) / 20, 0, 1) * 0.85 + (c.boost ? 0.35 : 0) : 0;
      fx.setSpeedLines(sl, cr.aspect);
      if (S.drawHold) continue; // (tests: the canvas keeps its last picture, see the hook)
      if (world.preRender) world.preRender(renderer, cr.cam); // car shadow map (render.js)
      renderer.clear();
      renderer.render(world.farScene, farCam);
      renderer.clearDepth();
      renderer.render(world.scene, cr.cam);
    }
    const info = renderer.info.render;
    perf.calls = info.calls; perf.tris = info.triangles;
    if (S.phase === 'chase') { perf.maxCalls = Math.max(perf.maxCalls, perf.calls); perf.maxTris = Math.max(perf.maxTris, perf.tris); }
    updateHud(dtReal, now);
    publish();
    // dynamic resolution
    const work = performance.now() - w0;
    const i = perf.n % 600; perf.dts[i] = dtReal * 1000; perf.work[i] = work; perf.n++;
    dynRes(dtReal);
    lastWall = w0;
  }
  void lastWall;
  const meA = { rpm: 0, gas: 0, slip: 0, speed: 0, flat: 0, boost: false, offroad: false }; const themA = { rpm: 0, dist: 999, vrel: 0, pan: 0 }; const sirenA = { on: false, dist: 999, vrel: 0, pan: 0, yelpR: 40 };
  const animCars = [{ x: 0, z: 0 }, { x: 0, z: 0 }];
  // Dynamic quality: a ladder of levers, cheapest first, with hysteresis so a phone sitting at the
  // 60 fps edge doesn't pulse (every resize() re-makes the drawable + MSAA buffers: a hitch).
  //   0 full · 1 shadow map at cfg.shadowLow · 2 scale 0.85 · 3 scale minScale · 4 shadow off
  // Down: EWMA frame time > 18.4 ms (two rungs above 26 ms), one rung per 1.2 s. Up: < 15.4 ms for
  // 8 s straight and ≥ `hold` s after the last step down; a step down that follows a step up within
  // the hold doubles it (a phone at the edge converges to the lower rung instead of oscillating).
  const DYN = { down: 18.4, hard: 26, up: 15.4, settle: 1.2, upAfter: 8, hold: 20, holdMax: 160 };
  function dynApply() {
    const cfg = (gfx && gfx.cfg) || {}; const sh = world && world.shadow; const n = perf.level;
    if (sh) { sh.setSize(n >= 1 ? (cfg.shadowLow || sh.full) : sh.full); sh.enabled = n < 4; perf.shadowOff = n >= 4; }
  }
  function dynLevel(n) {
    n = Math.max(0, Math.min(4, n)); if (n === perf.level) return;
    const was = scale;
    scale = n >= 3 ? minScale : n >= 2 ? Math.max(minScale, 0.85) : 1;
    perf.level = n; dynApply();
    if (scale !== was) { perf.resizes++; resize(); }
  }
  /** Tests: back to the top rung with a settled controller. */
  function dynReset() { dynLevel(0); perf.ewma = 16; perf.lowFor = 0; perf.sinceDown = perf.sinceUp = perf.sinceStep = 1e9; perf.hold = DYN.hold; perf.resizes = 0; perf.scaleDowns = 0; perf.scaleUps = 0; }
  function dynRes(dt) {
    if (TUNE.maxDpr && !TUNE.dynRes) return;
    const k = TUNE.dynK || 1; // tests: time scale
    const ms = TUNE.dynRes && perf.fakeMs > 0 ? perf.fakeMs : dt * 1000; // tests: a synthetic frame time
    const a = 1 - Math.exp(-dt / 0.3); perf.ewma += (ms - perf.ewma) * a; // ~0.3 s time constant whatever the frame rate
    perf.checkT += dt; perf.sinceDown += dt; perf.sinceStep += dt; perf.sinceUp += dt;
    if (perf.checkT < 0.25) return; perf.checkT = 0;
    if (perf.ewma > DYN.down) {
      perf.lowFor = 0;
      if (perf.level < 4 && perf.sinceStep >= DYN.settle * k) {
        if (perf.sinceUp < perf.hold * k) perf.hold = Math.min(DYN.holdMax, perf.hold * 2); // bounced: back off
        dynLevel(perf.level + (perf.ewma > DYN.hard ? 2 : 1)); perf.scaleDowns++; perf.sinceStep = 0; perf.sinceDown = 0;
      }
    } else if (perf.ewma < DYN.up) {
      perf.lowFor += 0.25;
      if (perf.level > 0 && perf.lowFor >= DYN.upAfter * k && perf.sinceDown >= perf.hold * k) { dynLevel(perf.level - 1); perf.scaleUps++; perf.lowFor = 0; perf.sinceStep = 0; perf.sinceUp = 0; }
    } else perf.lowFor = 0;
  }
  /** The AI cop drops a strip where its driver predicted the runner's route (ai.js). */
  function aiSpike(w, at) { if (at) placeSpike(w, at.x, at.z); }

  // ── partner presence: lobby info ──
  if (live) {
    link.on('__noop', () => {});
    offs.push(api.onPartnerState((s) => {
      if (!s) return;
      const p = P2[other(me)];
      if (typeof s.ph === 'number') p.remote.ph = s.ph;
      if (typeof s.sv === 'number') p.remote.sv = s.sv;
      if (typeof s.pz === 'number') p.remote.pz = s.pz;
      if (typeof s.ry === 'number' && isHost && S.partnerReady !== !!s.ry) { S.partnerReady = !!s.ry; renderLobby(true); }
    }));
  }

  // ── keyboard legend ──
  function legendHTML() {
    if (coarse) return '';
    if (split()) return '<b>Left</b> <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive · <kbd>Space</kbd> drift · <kbd>⇧</kbd> nitro · <kbd>E</kbd> spike/oil · <kbd>Q</kbd> look back<br><b>Right</b> <kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd> · <kbd>⇧</kbd> drift · <kbd>Enter</kbd> nitro · <kbd>/</kbd> spike/oil · <kbd>.</kbd> look back';
    return '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive · <kbd>Space</kbd> drift · <kbd>Shift</kbd> nitro<br><kbd>E</kbd> spike strip / oil · <kbd>M</kbd> map · <kbd>C</kbd> camera · <kbd>B</kbd> look back';
  }
  // (phones have no keyboard legend: no timer at all; setLegend diffs, so a laptop writes only on change)
  if (!coarse) timers.push(setInterval(() => { if (!dead) hud.setLegend(S.R && !S.R.over && S.phase === 'chase' ? legendHTML() : ''); }, 500));

  load();

  // ── test hook ──
  if (typeof window !== 'undefined' && window.__gtwTest) {
    window.__getaway = {
      clock() { return clock(); },
      contactLog(clear) { const o = JSON.parse(JSON.stringify(TLOG)); if (clear) { TLOG.contacts.length = 0; TLOG.traj.length = 0; TLOG.bumpsIn.length = 0; TLOG.bumpsOut.length = 0; } return o; },
      get ready() { return ready3D && !S.loading; },
      state() {
        const R = S.R;
        const car = (w) => { const c = P2[w].car; return { x: c.x, z: c.z, y: c.y, yaw: c.yaw, speed: c.speed, vf: c.vf, hp: c.hp, flat: c.flat, spinT: c.spinT, nitro: c.nitro, level: c.level, surf: c.surf, water: c.water, top: c.topSpeed, role: roleOf(w), esc: P2[w].esc, los: P2[w].los, spikesLeft: P2[w].spikesLeft, oilLeft: P2[w].oilLeft, stats: { ...P2[w].stats } }; };
        return {
          phase: S.phase, paused: S.paused, resumeAt: S.resumeAt, reasons: S.reasons, setup: S.setup, setupVer: S.setupVer, mapId: S.mapId, loading: S.loading,
          match: S.match && { scores: { ...S.match.scores }, hist: S.match.hist.slice(), rounds: S.match.rounds, map: S.match.map, rules: S.match.rules },
          R: R && { idx: R.idx, spawn: R.spawn, runner: R.runner, at: R.at, t0: R.t0, endAt: R.endAt, over: R.over, result: R.result, spikes: R.spikes.map((s) => ({ id: s.id, x: s.x, z: s.z, yaw: s.yaw, gone: s.gone, at: s.at })), oils: R.oils.length },
          a: car('a'), b: car('b'), now: clock(), dbgEnd: S.dbgEnd || null, rtt: link.rtt, linked: link.ready, result: S.result || null, localMode: S.localMode, me: human(),
          partnerSeen: live ? { ...P2[other(me)].remote, shown: { ...P2[other(me)].shown } } : null, sent: link.sent,
        };
      },
      perf() {
        const n = Math.min(perf.n, 600); const d = Array.from(perf.dts.slice(0, n)).sort((x, y) => x - y); const wk = Array.from(perf.work.slice(0, n)).sort((x, y) => x - y);
        const q = (a, k) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * k))] : 0);
        return { p50: q(d, 0.5), p95: q(d, 0.95), work50: q(wk, 0.5), work95: q(wk, 0.95), calls: perf.calls, tris: perf.tris, maxCalls: perf.maxCalls, maxTris: perf.maxTris, scale, scaleDowns: perf.scaleDowns, scaleUps: perf.scaleUps, level: perf.level, resizes: perf.resizes, hold: perf.hold, ewma: perf.ewma, shadow: world && world.shadow ? { size: world.shadow.size, on: world.shadow.enabled } : null, programs0: perf.programs0, programs: renderer.info.programs.length, load: S.loadMs, build: S.buildStats, geoms: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
      },
      resetPerf() { perf.n = 0; perf.maxCalls = 0; perf.maxTris = 0; perf.resizes = 0; perf.scaleDowns = 0; perf.scaleUps = 0; },
      /** Tests (TUNE.dynRes): feed the dynamic-quality controller a synthetic frame time (0 = real). */
      fakeFrame(ms, reset) { perf.fakeMs = ms; if (reset) dynReset(); },
      /** The chase camera rig of my view (distance / yaw / fov), for camera tests. */
      /** Screenshots / tests: draw person w's cars with these liveries regardless of unlocks. */
      testLivery(w, runner, cop) { S.liveryForce = true; P2[w].livery.runner = runner | 0; P2[w].livery.cop = cop | 0; },
      camRig() { const cr = cams[human()]; return { d: cr.d, yaw: cr.yaw, fov: cr.fov, x: cr.x, y: cr.y, z: cr.z }; },
      start() { hostStart(); },
      /** Rebuild the world (even for the same map): map-switch regression tests. */
      async reloadMap(id) { S.mapId = null; await loadMap(id || S.setup.map); return S.mapId; },
      setRules(r) { if (!isHost) return null; setSetup({ ...S.setup, rules: { ...S.setup.rules, ...r } }); return S.setup; },
      setSetup(s) { if (!isHost) return null; setSetup({ ...S.setup, ...s }); return S.setup; },
      setLocalMode(m, role) { S.localMode = m; if (role) S.practiceRole = role; renderLobby(true); },
      /** Drive my car with the AI (bots for tests). */
      auto(w, on) { const p = P2[w || human()]; p.auto = !!on; if (on && S.R) { p.driver = createDriver(geo, roleOf(w || human()), { seed: 99, level: 'hard' }); p.pad.auto = p.driver.out; } else if (!on && !(ai() && (w || human()) === aiW)) { p.driver = null; p.pad.auto = null; } },
      /** Fixed inputs for car w: { steer, gas, brake, hand, nitro } (null = release). */
      hold(w, inp) { const p = P2[w || human()]; p.driver = null; p.pad.auto = inp ? { steer: 0, gas: 0, brake: 0, hand: false, nitro: false, ...inp } : null; },
      teleport(w, x, z, yaw, v = 0) { const c = P2[w].car; placeCar(c, x, z, yaw, geo); c.vx = Math.sin(yaw) * v; c.vz = -Math.cos(yaw) * v; c.speed = v; },
      setCar(w, o) { Object.assign(P2[w].car, o); },
      aiState(w) { const d = P2[w].driver; if (!d) return null; const D = d.state; return { level: d.level, mode: D.mode, vWant: D.vWant, vT: D.vT, vCurve: D.vCurve, tFree: D.tFree, tLeadV: D.tLeadV, creep: D.creep, revT: D.revT, turnT: D.turnT, kT: D.kT, stuckLvl: D.stuckLvl, jamT: D.jamT, pinT: D.pinT, offRoute: D.offRoute, routeLeft: D.routeLeft, alpha: D.alpha, laneShift: D.laneShift, laneTarget: D.laneTarget, tFree: D.tFree, fails: D.fails, stats: { ...D.stats }, inp: { ...d.out } }; },
      placeSpike(w, x, z) { return placeSpike(w, x, z); },
      endNow(outcome, reason) { endRound(outcome, reason); },
      shortenRound(ms) { if (isHost && S.R) { S.R.endAt = clock() + ms; if (live) link.urgent('endat', { idx: S.R.idx, endAt: S.R.endAt }); } },
      trafficHash(t) { return traffic ? traffic.hash(t) : 0; },
      trafficCount() { return traffic ? traffic.total : 0; },
      trafficNear(x, z, r, t) { const out = []; if (traffic) traffic.each(x, z, r, t, (id, p) => out.push({ id, x: p.x, z: p.z, yaw: p.yaw, vx: p.vx, vz: p.vz }), true); return out; },
      roadPoint(i, s) { const r = geo.roads[i]; const o = {}; geo.sampleRoad(r, s, o); return { x: o.x, z: o.z, yaw: Math.atan2(o.tx, -o.tz), len: r.len, name: r.name, width: r.width }; },
      roads() { return geo.roads.map((r) => ({ name: r.name, kind: r.kind, len: r.len, width: r.width, bridge: r.bridge })); },
      solids() { return geo.solids.map((s) => ({ i: s.i, kind: s.kind, x: s.x, z: s.z, hw: s.hw, hd: s.hd, rot: s.rot, h: s.h, broken: s.broken })); },
      surface(x, z) { return geo.surfaceAt(x, z); },
      navReady() { return geo && geo.navReady(); },
      maps() { return MAPS.map((m) => ({ id: m.id, name: m.name, stub: !!m.stub })); },
      openMap() { openMap(human()); }, closeMap() { closeMap(); },
      mapTap(x, z) { return placeSpike(human(), x, z); },
      landmarks() { return (S.mapEntry && S.mapEntry.landmarks) || []; },
      view(w) { const c = cams[w || human()]; return { x: c.cam.position.x, y: c.cam.position.y, z: c.cam.position.z, fov: c.cam.fov, mode: c.mode }; },
      setCam(w, x, y, z, tx, ty, tz) { const c = cams[w || human()].cam; c.position.set(x, y, z); c.lookAt(tx, ty, tz); },
      pauseReason(r, on) { if (on) addReason(r); else delReason(r); },
      /** Screenshot tests: on = the game runs (clock, phases, cars, HUD) but draws nothing, so the canvas
       *  keeps its last picture: software GL spends 1–3 s a frame, which starved clicks and timers. */
      drawHold(on) { S.drawHold = !!on; },
      loseContext(noRestore) { const ext = renderer.getContext().getExtension('WEBGL_lose_context'); if (ext) { ext.loseContext(); if (!noRestore) setTimeout(() => ext.restoreContext(), 400); return true; } return false; },
      /** The next n map loads throw (error-card tests). */
      failLoad(n = 1) { S.failLoads = n; },
      ui() { return { sheet: S.sheet, menu: !!S.menu, loadFail: S.loadFail, glStuck: !!S.glStuck, loading: S.loading, tier: gfx && gfx.tier, card: hud.over.hidden ? null : (hud.over.querySelector('h2') || {}).textContent || hud.over.className, device: { ...device } }; },
      worldStats() { return world ? { ...world.stats, chunks: world.chunks.length, visible: world.chunks.filter((c) => c.group.visible).length, broken: world.brokenCount() } : null; },
      inputStats: () => ({ ...inputStats }),
      internals: { P2, S, get geo() { return geo; }, get world() { return world; }, get renderer() { return renderer; }, get carViews() { return carViews; }, link },
      /** Render a fixed view and count draw calls / triangles (perf budgets per map). */
      measureView(x, z, yaw, mode = 'near') {
        const cr = cams[human()]; const cam = cr.cam; const md = CAM[mode];
        const y = geo.ground(x, z);
        cam.position.set(x - Math.sin(yaw) * md.dist, y + md.height, z + Math.cos(yaw) * md.dist);
        cam.lookAt(x + Math.sin(yaw) * md.ahead, y + md.look, z - Math.cos(yaw) * md.ahead);
        cam.fov = cr.aspect < 1 ? CAM.portraitFov : CAM.fov; cam.updateProjectionMatrix();
        world.update(cam, 0, 0);
        renderer.info.reset(); renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H);
        farCam.position.copy(cam.position); farCam.quaternion.copy(cam.quaternion); farCam.fov = cam.fov; farCam.aspect = cam.aspect; farCam.updateProjectionMatrix();
        renderer.clear(); renderer.render(world.farScene, farCam); renderer.clearDepth(); renderer.render(world.scene, cam);
        return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
      },
    };
  }

  return {
    onRematch, onMenu,
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
      offs.forEach((f) => { try { f(); } catch { /* ignore */ } });
      try { link.destroy(); } catch { /* ignore */ }
      if (input) input.destroy(); if (touchIn) touchIn.destroy(); if (tilt) tilt.disable();
      try { audio.destroy(); } catch { /* ignore */ }
      if (world) world.dispose();
      if (fx) fx.dispose();
      if (carViews) for (const v of Object.values(carViews)) v.dispose();
      if (wheels) wheels.dispose();
      if (trafficMeshes) trafficMeshes.dispose();
      if (renderer) { renderer.dispose(); try { renderer.forceContextLoss(); } catch { /* ignore */ } }
      hud.destroy(); if (hud2) hud2.destroy();
      root.remove();
      if (typeof window !== 'undefined' && window.__getaway) delete window.__getaway;
    },
  };
}
