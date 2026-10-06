// Getaway orchestrator: loading, renderer + dynamic resolution, lobby (host settings, live to
// the guest), the round timeline on the shared clock, the fixed-step chase (cars, traffic,
// PITs, spikes, oil, bust / escape authority), pause / resume, practice vs AI and split screen,
// camera, HUD, audio and the test hook. Design notes: docs/games/getaway.md.
import { DT, MAX_STEPS, CAR, DAMAGE, RULES, NITRO, CAM, TRAFFIC } from './tune.js';
import { sanitizeSetup, stepRule, loadSaved, saveSetup, fmt } from './rules.js';
import { createGeo } from './geo.js';
import { newCar, placeCar, stepCar, carContact, resolveCar, judgePit } from './car.js';
import { makePalette, makeUniforms } from './gfx.js';
import { buildWorld } from './world.js';
import { createCarView, createWheels, buildTrafficGeos } from './cars.js';
import { createTraffic } from './traffic.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { newPad, readPad, createKeys, createTouch, createTilt } from './input.js';
import { createHud, makeMapImage, loadingCard, errorCard, lobbyCard, settingsSheet, introCard, resultCard, pauseCard, esc } from './hud.js';
import { createLink } from './link.js';
import { createDriver } from './ai.js';
import { MAPS } from './maps/index.js';

const AB = ['a', 'b'];
const PH = { loading: 0, lobby: 1, intro: 2, count: 3, chase: 4, result: 5, final: 6, wait: 7 };
const PZ = { hidden: 1, gl: 2, menu: 4 };
const F_BOOST = 1; const F_BRAKE = 2; const F_HAND = 4; const F_SPIN = 8; const F_FLAT = 16; const F_SIREN = 32; const F_SKID = 64; const F_WATER = 128;
const DEV_KEY = 'getaway.device.v1';
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapA = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const other = (w) => (w === 'a' ? 'b' : 'a');
const MAP_IDS = MAPS.map((m) => m.id);

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
  const device = Object.assign({ steer: 'slider', localMode: 'ai', practiceRole: 'runner', cam: null }, lsGet(DEV_KEY, {}));
  if (!coarse && device.localMode !== 'split' && device.localMode !== 'ai') device.localMode = 'ai';
  if (phoneish) device.localMode = 'ai';
  const audio = createAudio({ getCtx: typeof api.audio === 'function' ? () => api.audio() : null, mutedFn: typeof api.muted === 'function' ? () => api.muted() : null });

  // ── state ──
  const S = {
    phase: 'loading', setup: sanitizeSetup({ ...(loadSaved() || {}), first: 'a' }, MAP_IDS.filter((id) => !MAPS.find((m) => m.id === id).stub).concat(MAP_IDS)), setupVer: 0,
    sheet: false, match: null, R: null, paused: false, pausedAt: 0, resumeAt: 0, reasons: 0, partnerPz: 0, partnerReady: false,
    localMode: live ? 'live' : device.localMode, practiceRole: device.practiceRole, mapId: null, mapIdx: -1, loading: false,
    stats: null, lastNow: 0, slowT: 0, slowK: 1, tSec: 0, ending: false, finalShown: false,
  };
  if (!MAPS.find((m) => m.id === S.setup.map && !m.stub)) S.setup.map = MAPS.find((m) => !m.stub).id;
  const split = () => !live && S.localMode === 'split';
  const ai = () => !live && S.localMode === 'ai';
  const human = () => (live ? me : 'a');
  const aiW = 'b';
  const viewers = () => (split() ? ['a', 'b'] : [human()]);
  const nameOf = (w) => (ai() ? (w === human() ? 'You' : 'AI') : api.name(w));

  // players
  function mkPlayer(w) {
    return { w, car: newCar('runner'), pad: newPad(), inp: { steer: 0, gas: 0, brake: 0, hand: false, nitro: false }, driver: null, auto: false, view: null, rig: null,
      prevRL: [0, 0, 0], prevRR: [0, 0, 0], smokeT: 0, dustT: 0, sparkT: 0, oilLeft: 1, spikesLeft: 0, lastHit: 0, stats: { top: 0, near: 0, pits: 0, spikes: 0, hits: 0 },
      remote: { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, r: 0, st: 0, hp: 100, fl: 0, es: 0, nt: 0, lv: -1, rpm: 0, ph: 0, rd: -1, pz: 0, ry: 0, sv: 0, tp: 0, sl: 0 },
      shown: { x: 0, z: 0, y: 0, yaw: 0, init: false }, hpSeen: 100, nearIds: new Map(), esc: 0, stopT: 0, spikeHit: new Set(), oilHit: new Set(), losT: 0, los: true, lastSeen: null, hurtT: 0 };
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
  let partnerHere = live ? !!api.partnerHere : true;
  if (live) offs.push(api.onPartnerHere((h) => { partnerHere = !!h; }));

  // ── 3D ──
  let THREE = null; let renderer = null; let P = null; let U = null; let world = null; let geo = null; let fx = null; let traffic = null; let mapImg = null;
  let carViews = null; let wheels = null; let trafficMeshes = null; let cams = {}; let farCam = null; let ready3D = false; let glLost = false; let raf = 0;
  let W = 1; let H = 1; const baseDpr = Math.min(window.devicePixelRatio || 1, 2); let scale = TUNE.maxDpr ? 1 : 0.85;
  const perf = { dts: new Float32Array(600), work: new Float32Array(600), n: 0, calls: 0, tris: 0, maxCalls: 0, maxTris: 0, scaleDowns: 0, scaleUps: 0, programs0: 0, ewma: 16.7, lowFor: 0, checkT: 0, frames: 0 };
  const hud = createHud(root, { name: (w) => nameOf(w) }, { split: false, touch: coarse });
  let hud2 = null; // split-screen HUD (two views)
  const H0 = () => (split() ? hud2 : hud);
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
    await loadMap(S.setup.map);
    if (dead) return;
    ready3D = true;
    toLobby();
    raf = requestAnimationFrame(frame);
  }

  function init3D() {
    P = makePalette(api.tokens());
    hud.setPalette(P);
    U = makeUniforms(THREE, P);
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false, depth: true });
    renderer.info.autoReset = false;
    renderer.autoClear = false;
    renderer.setPixelRatio(Math.min(baseDpr * scale, TUNE.maxDpr || 9));
    renderer.domElement.className = 'gtw-cv';
    glWrap.appendChild(renderer.domElement);
    renderer.domElement.addEventListener('webglcontextlost', onLost, false);
    renderer.domElement.addEventListener('webglcontextrestored', onRestored, false);
    farCam = new THREE.PerspectiveCamera(60, 1, 5, 60000);
    for (const w of AB) cams[w] = { cam: new THREE.PerspectiveCamera(60, 1, 1, 700), x: 0, y: 20, z: 0, yaw: 0, fov: 60, shake: 0, mode: device.cam || null, look: 0, init: false };
    resize();
    const ro = new ResizeObserver(() => resize()); ro.observe(root); offs.push(() => ro.disconnect());
    const keys = createKeys({ split: false, me: human(), pads: { a: P2.a.pad, b: P2.b.pad }, onAct: (w, a) => onAct(w, a), enabled: () => !dead && !S.sheet });
    input = keys;
    touchIn = createTouch({ surface, root, pad: P2[human()].pad, onAct: (a) => onAct(human(), a), enabled: () => !dead, steerEl: root.querySelector('.gtw-steer'), stats: inputStats });
    tilt = createTilt(P2[human()].pad);
    root.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
    window.addEventListener('keydown', unlockKey);
    offs.push(() => window.removeEventListener('keydown', unlockKey));
    document.addEventListener('visibilitychange', onVis); offs.push(() => document.removeEventListener('visibilitychange', onVis));
    root.addEventListener('click', onClick);
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
      hud2.root.addEventListener('click', onClick);
    }
    if (hud2) hud2.root.hidden = !on;
    hud.root.querySelector('.gtw-view.full').hidden = on;
  }

  // ── map loading ──
  let loadSeq = 0;
  async function loadMap(id) {
    const seq = ++loadSeq;
    const entry = MAPS.find((m) => m.id === id && !m.stub) || MAPS.find((m) => !m.stub);
    if (S.mapId === entry.id && world) return;
    S.loading = true;
    const showLoad = (pct, text) => { if (S.phase === 'loading' || S.loadingCard) hud.card(loadingCard(text, pct, human()), 'solid'); };
    S.loadingCard = S.phase === 'loading' || !!S.match;
    showLoad(0.08, `Loading ${entry.name}…`);
    await new Promise((r) => setTimeout(r, 16));
    if (dead || seq !== loadSeq) return;
    const t0 = performance.now();
    if (typeof entry.prepare === 'function' && !entry.__prepared) {
      // the map generates its layout in slices (≤ ~70 ms each) before anything reads it
      let sliceT = performance.now();
      const slice = () => { const n = performance.now(); if (n - sliceT < 12) return Promise.resolve(); return new Promise((r) => setTimeout(() => { sliceT = performance.now(); r(); }, 0)); };
      showLoad(0.09, `Surveying ${entry.name}…`);
      try { await entry.prepare({ THREE, slice, seeded: (n) => { let a = (n >>> 0) || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }, quality: phoneish ? 'mid' : 'high', palette: P, dark: P.dark }); } catch (e) { console.error('getaway: map prepare failed', e); }
      entry.__prepared = true;
      if (dead || seq !== loadSeq) return;
    }
    const g = createGeo(entry);
    const w = await buildWorld(THREE, entry, g, P, U, { quality: phoneish ? 'mid' : 'high', onProgress: (p, t) => showLoad(0.1 + p * 0.8, t), dead: () => dead || seq !== loadSeq, budget: TUNE.sliceMs || 12 });
    if (dead || seq !== loadSeq || !w) { if (w) w.dispose(); return; }
    // swap worlds: the cars, wheels and traffic meshes are rebuilt against the new world's
    // materials; take them out of the old scene first so its dispose() doesn't free them
    if (carViews) {
      for (const v of Object.values(carViews)) { detach(v.group); v.dispose(); }
      detach(wheels.mesh); wheels.dispose();
      for (const m of [trafficMeshes.paint, trafficMeshes.trim]) { detach(m); m.geometry.dispose(); }
      carViews = null;
    }
    if (fx) { for (const m of [fx.puffs, fx.sparks, fx.skids, fx.strips, fx.oils, fx.lines]) detach(m); fx.dispose(); fx = null; }
    if (world) world.dispose();
    world = w; geo = g; S.mapId = entry.id; S.mapIdx = MAPS.indexOf(entry); S.mapEntry = entry;
    U.uSiren.value.w = 0;
    renderer.setClearColor(new THREE.Color().fromArray(world.fogC), 1);
    for (const k of AB) { cams[k].cam.far = world.fogFar + 80; cams[k].cam.updateProjectionMatrix(); }
    mapImg = makeMapImage(geo, entry, P, phoneish ? 1100 : 1400);
    carViews = { runA: createCarView(THREE, P, U, 'runner', P.a, world.mats), runB: createCarView(THREE, P, U, 'runner', P.b, world.mats), cop: createCarView(THREE, P, U, 'cop', null, world.mats), cop2: createCarView(THREE, P, U, 'cop', null, world.mats) };
    wheels = createWheels(THREE, P, world.mats, 8);
    const tg = buildTrafficGeos(THREE, P);
    // colour-instanced meshes get their own material (its programs differ from the plain ones)
    trafficMeshes = { paint: new THREE.InstancedMesh(tg.paint, world.mats.vcColor, TRAFFIC.max), trim: new THREE.InstancedMesh(tg.trim, world.mats.vc, TRAFFIC.max) };
    trafficMeshes.paint.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(TRAFFIC.max * 3).fill(1), 3);
    for (const m of [trafficMeshes.paint, trafficMeshes.trim]) { m.frustumCulled = false; m.count = 0; }
    for (const v of Object.values(carViews)) world.scene.add(v.group);
    world.scene.add(wheels.mesh); world.scene.add(trafficMeshes.paint); world.scene.add(trafficMeshes.trim);
    fx = createFx(THREE, world.scene, P, U, world.mats);
    traffic = createTraffic(geo, entry.id, rules().traffic);
    S.loadMs = Math.round(performance.now() - t0);
    S.buildStats = world.stats;
    warmUp();
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

  function warmUp() {
    const list = world.warmList();
    for (const m of list) m.visible = true;
    for (const c of world.chunks) c.group.visible = true;
    const cam = cams[human()].cam;
    const p = (S.mapEntry.spawns && S.mapEntry.spawns[0]) ? S.mapEntry.spawns[0].runner : { x: 0, z: 0 };
    cam.position.set(p.x, 30, p.z + 40); cam.lookAt(p.x, 0, p.z);
    fx.setSpeedLines(0.5, 1); fx.puff(p.x, 1, p.z, 0, 0, 0, 1, 0, 0.1, 1, 1, 1); fx.spark(p.x, 1, p.z, 1, 1, 1, 0.1);
    fx.setStrips([{ x: p.x, y: 0, z: p.z, yaw: 0, len: 6, k: 1 }]); fx.setOils([{ x: p.x, y: 0, z: p.z, r: 2, k: 1 }]);
    trafficMeshes.paint.count = 1; trafficMeshes.trim.count = 1;
    fx.update(0.016, cam);
    try { renderer.compile(world.scene, cam); renderer.compile(world.farScene, cam); } catch (e) { console.warn(e); }
    renderer.setViewport(0, 0, W, H);
    try { renderer.clear(); renderer.render(world.farScene, cam); renderer.render(world.scene, cam); } catch (e) { console.warn(e); }
    fx.setSpeedLines(0, 1); fx.setStrips([]); fx.setOils([]); fx.clear();
    trafficMeshes.paint.count = 0; trafficMeshes.trim.count = 0;
    perf.programs0 = renderer.info.programs ? renderer.info.programs.length : 0;
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
  function onLost(e) { e.preventDefault(); glLost = true; addReason('gl'); }
  function onRestored() { glLost = false; resize(); delReason('gl'); }
  function onVis() { if (document.hidden) addReason('hidden'); else delReason('hidden'); }

  // ── pause reasons (mine) ──
  const reasonBits = { hidden: PZ.hidden, gl: PZ.gl, menu: PZ.menu };
  const softReasons = new Set();
  function addReason(r) { if (reasonBits[r]) S.reasons |= reasonBits[r]; else softReasons.add(r); }
  function delReason(r) { if (reasonBits[r]) S.reasons &= ~reasonBits[r]; else softReasons.delete(r); }

  // ── lobby ──
  function toLobby() {
    S.phase = 'lobby'; S.match = null; S.R = null; S.paused = false; S.ending = false; S.finalShown = false;
    for (const w of AB) { const p = P2[w]; p.pad.auto = null; p.auto = false; }
    hud.card(null);
    renderLobby(true);
    api.setStatus(null);
    if (isHost && live) link.send('setup', S.setup);
  }
  let lobbyKey = '';
  function renderLobby(force = false) {
    if (S.phase !== 'lobby' || S.loadingCard) return;
    const key = JSON.stringify([S.setup, S.sheet, S.localMode, S.practiceRole, S.partnerReady, partnerHere]);
    if (!force && key === lobbyKey) return;
    lobbyKey = key;
    hud.card(lobbyCard({ name: nameOf }, {
      maps: MAPS, setup: S.setup, canEdit: isHost, local: !live, localMode: S.localMode, practiceRole: S.practiceRole,
      splitOK: !coarse && !phoneish, waitingFor: 'a', partnerReady: S.partnerReady, me: human(),
    }), 'clear bottom');
    drawPlans();
    hud.showSheet(S.sheet ? settingsSheet(S.setup.rules, { canEdit: isHost, device: { touch: coarse, steer: device.steer } }) : null);
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
    if (isHost) saveSetup(S.setup);
    if (send && isHost && live) link.send('setup', S.setup);
    if (S.setup.map !== prevMap && !(MAPS.find((m) => m.id === S.setup.map) || {}).stub) loadMap(S.setup.map).then(() => renderLobby(true));
    if (traffic && geo) traffic = createTraffic(geo, S.mapId, S.setup.rules.traffic);
    renderLobby(true);
  }
  link.on('setup', (d) => { if (!isHost && d && S.phase === 'lobby') setSetup(clone(d), false); });
  link.on('ready', (d) => { if (isHost) { S.partnerReady = !!(d && d.on); renderLobby(true); } });

  function onClick(e) {
    const t = e.target.closest('[data-l]'); if (!t) return;
    audio.unlock();
    const k = t.dataset.l;
    switch (k) {
      case 'start': hostStart(); break;
      case 'ready': link.send('ready', { on: (S.meReady = !S.meReady) }); t.textContent = S.meReady ? 'Ready ✓' : 'Ready'; audio.tick(); break;
      case 'settings': S.sheet = true; renderLobby(true); audio.tick(); break;
      case 'sheetclose': S.sheet = false; renderLobby(true); audio.tick(); break;
      case 'map': {
        if (!isHost) return;
        const i = MAP_IDS.indexOf(S.setup.map); const n = MAP_IDS.length;
        const j = (i + (+t.dataset.dir) + n) % n;
        setSetup({ ...S.setup, map: MAP_IDS[j] }); audio.tick(); break;
      }
      case 'first': if (isHost) { setSetup({ ...S.setup, first: t.dataset.v }); audio.tick(); } break;
      case 'rule': if (isHost) { setSetup({ ...S.setup, rules: stepRule(S.setup.rules, t.dataset.k, +t.dataset.step) }); audio.tick(); } break;
      case 'lmode': S.localMode = t.dataset.v; device.localMode = S.localMode; lsSet(DEV_KEY, device); renderLobby(true); audio.tick(); break;
      case 'prole': S.practiceRole = t.dataset.v; device.practiceRole = S.practiceRole; lsSet(DEV_KEY, device); renderLobby(true); audio.tick(); break;
      case 'steer':
        device.steer = t.dataset.v; lsSet(DEV_KEY, device);
        if (device.steer === 'tilt') tilt.enable().then((r) => { if (r !== 'ok') { device.steer = 'slider'; lsSet(DEV_KEY, device); hud.view().hint(r === 'denied' ? 'Motion access was refused, so the slider stays.' : 'This device has no tilt sensor.'); } renderLobby(true); });
        else { tilt.disable(); renderLobby(true); }
        break;
      case 'resume': delReason('menu'); if (glLost) return; delReason('tap'); break;
      default:
    }
  }

  // ── match start ──
  function hostStart() {
    if (!isHost || S.phase !== 'lobby' || S.loading || !ready3D) return;
    const entry = MAPS.find((m) => m.id === S.setup.map);
    if (!entry || entry.stub) { hud.view().hint('That map is still being built. Pick another one.'); return; }
    if (live) {
      const ps = P2[other(me)].remote;
      if (!partnerHere || !link.ready) { hud.view().hint(`Waiting for ${api.name(other(me))}…`); return; }
      if (ps.ph !== PH.lobby || ps.sv !== S.mapIdx + 1) { hud.view().hint(`${api.name(other(me))} is still loading the map…`); return; }
    }
    const first = ai() ? (S.practiceRole === 'runner' ? human() : aiW) : S.setup.first;
    const seed = ((Math.random() * 2147483646) | 0) + 1;
    const match = { id: Math.random().toString(36).slice(2, 9), map: S.setup.map, rules: { ...S.setup.rules }, first, seed, rounds: TUNE.rounds || S.setup.rules.rounds, scores: { a: 0, b: 0 }, hist: [], mode: S.localMode };
    const R = nextRound(match, 0);
    if (live) link.urgent('match', { match, R });
    applyMatch(match, R);
  }
  function nextRound(match, idx) {
    const spawns = (MAPS.find((m) => m.id === match.map) || MAPS[0]).spawns || [];
    const sp = spawns.length ? (match.seed + Math.floor(idx / 2)) % spawns.length : 0;
    const runner = idx % 2 === 0 ? match.first : other(match.first);
    const at = clock() + (live ? 700 : 150);
    const intro = TUNE.intro ?? RULES.intro; const count = TUNE.count ?? RULES.countdown;
    const t0 = at + intro + count;
    const endAt = t0 + (TUNE.roundMs || match.rules.roundTime * 1000);
    return { idx, runner, spawn: sp, at, t0, endAt };
  }
  function applyMatch(match, R) {
    S.match = { ...match, rules: sanitizeSetup({ rules: match.rules }, MAP_IDS).rules };
    S.sheet = false; hud.showSheet(null);
    if (split()) setSplitKeys(true);
    if (S.mapId !== match.map) { S.pendingRound = R; S.phase = 'wait'; S.loadingCard = true; loadMap(match.map); return; }
    traffic = createTraffic(geo, S.mapId, S.match.rules.traffic);
    applyRound(R);
  }
  const detach = (o) => { if (o && o.parent) o.parent.remove(o); };
  const clone = (o) => JSON.parse(JSON.stringify(o)); // room payloads arrive frozen
  link.on('match', (d) => { if (!isHost && d && d.match) applyMatch(clone(d.match), clone(d.R)); });
  link.on('round', (d) => { if (!isHost && d && S.match && d.R) { const c = clone(d); S.match.scores = c.scores || S.match.scores; S.match.hist = c.hist || S.match.hist; applyRound(c.R); } });

  function applyRound(R) {
    if (S.R && S.R.idx === R.idx && !S.R.over) return;
    S.R = { ...R, over: false, result: null, spikes: [], oils: [], seq: 0 };
    S.phase = 'wait'; S.ending = false;
    S.slowT = 0; S.slowK = 1;
    const entry = S.mapEntry;
    const sp = (entry.spawns && entry.spawns[R.spawn]) || { runner: { x: 0, z: 0, yaw: 0 }, cop: { x: 0, z: 80, yaw: 0 } };
    const rules0 = rules();
    for (const w of AB) {
      const p = P2[w]; const role = roleOf(w);
      const c = newCar(role);
      const s = role === 'runner' ? sp.runner : sp.cop;
      placeCar(c, s.x, s.z, s.yaw, geo);
      c.nitro = role === 'runner' ? NITRO[rules0.nitro].start : NITRO.cop.start;
      p.car = c; p.esc = 0; p.stopT = 0; p.oilLeft = role === 'runner' ? 1 : 0; p.spikesLeft = role === 'cop' ? rules0.spikes : 0;
      p.stats = { top: 0, near: 0, pits: 0, spikes: 0, hits: 0 };
      p.spikeHit.clear(); p.oilHit.clear(); p.nearIds.clear(); p.hpSeen = 100; p.lastSeen = null; p.los = true; p.shown.init = false;
      p.prevRL[0] = NaN; p.prevRR[0] = NaN;
      if (p.rig) p.rig = null;
      cams[w].init = false; cams[w].mode = cams[w].mode || rules0.camera;
      p.driver = null;
      if (ai() && w === aiW) { p.driver = createDriver(geo, role, { seed: S.match.seed + R.idx }); p.pad.auto = p.driver.out; }
      else if (p.auto) { p.driver = createDriver(geo, role, { seed: 7 + R.idx }); p.pad.auto = p.driver.out; }
      else p.pad.auto = null;
    }
    if (traffic) traffic.clearWrecks();
    world.resetProps();
    fx.clear();
    hud.card(null);
    if (touchIn) touchIn.reset();
    api.setStatus(null);
    api.setScore(S.match.scores);
  }

  // ── rounds: end + next ──
  function endRound(outcome, reason) {
    const R = S.R; if (!R || R.over || S.ending) return;
    S.ending = true;
    const rw = R.runner;
    const st = P2[rw].stats; const cs = P2[other(rw)].stats;
    const res = { idx: R.idx, outcome, reason, at: clock(), stats: { top: Math.max(st.top, P2[rw].car.topSpeed), near: st.near, pits: cs.pits + st.pits, spikes: st.spikes }, ran: Math.max(0, clock() - R.t0) };
    if (live) link.urgent('end', res);
    applyEnd(res);
  }
  link.on('end', (d) => { if (d && S.R && d.idx === S.R.idx) applyEnd(clone(d)); });
  function applyEnd(res) {
    const R = S.R; if (!R || R.over || res.idx !== R.idx) return;
    R.over = true; R.result = res; S.phase = 'result';
    const winner = res.outcome === 'busted' ? other(R.runner) : R.runner;
    S.match.scores[winner]++;
    S.match.hist.push({ runner: R.runner, outcome: res.outcome, reason: res.reason, ran: res.ran });
    api.setScore(S.match.scores);
    const vs = viewers();
    for (const w of vs) {
      const v = H0().view(w);
      v.stamp(res.outcome === 'busted' ? (res.reason === 'water' ? 'SPLASH!' : 'BUSTED!') : 'ESCAPED!', res.outcome === 'busted' ? 'bad' : R.runner);
      v.flash();
    }
    const youWon = live ? winner === me : ai() ? winner === human() : true;
    audio.stamp(); later(() => (youWon ? audio.win() : audio.lose()), 300);
    const done = matchDecided();
    const next = done ? 'Final whistle…' : `Next round: ${nameOf(other(R.runner))} runs.`;
    later(() => { if (S.R === R) hud.card(resultCard({ name: nameOf }, { outcome: res.outcome, reason: res.reason, runner: R.runner, stats: res.stats, scores: S.match.scores, next, local: !live, me: human() }), 'dim'); }, 1100);
    if (isHost) later(() => { if (S.R !== R || dead) return; if (done) finalize(); else startNext(); }, TUNE.result ?? RULES.result);
  }
  function matchDecided() {
    const m = S.match; const played = m.hist.length; const left = m.rounds - played;
    const d = Math.abs(m.scores.a - m.scores.b);
    return left <= 0 || d > left;
  }
  function startNext() {
    const R = nextRound(S.match, S.R.idx + 1);
    if (live) link.urgent('round', { R, scores: S.match.scores, hist: S.match.hist });
    applyRound(R);
  }
  function finalize() {
    const m = S.match; let winner = null;
    if (m.scores.a !== m.scores.b) winner = m.scores.a > m.scores.b ? 'a' : 'b';
    else { // tiebreak: longest total time on the run
      const run = { a: 0, b: 0 }; for (const h of m.hist) run[h.runner] += h.outcome === 'escaped' ? 1e9 : h.ran;
      if (run.a !== run.b) winner = run.a > run.b ? 'a' : 'b';
    }
    const fin = { scores: m.scores, winner, tie: m.scores.a === m.scores.b };
    if (live) link.urgent('final', fin);
    applyFinal(fin);
  }
  link.on('final', (d) => { if (d) applyFinal(clone(d)); });
  function applyFinal(fin) {
    if (S.finalShown) return; S.finalShown = true;
    S.phase = 'final';
    const sc = `${fin.scores.a}–${fin.scores.b}`;
    let res;
    const tb = fin.tie && fin.winner ? ' on the tiebreak' : '';
    if (ai()) res = { winner: null, text: fin.winner === human() ? `You beat the AI${tb}, ${sc}` : fin.winner ? `The AI won${tb}, ${fin.scores.a}–${fin.scores.b}` : `Practice: ${sc}`, sub: tb ? 'Tiebreak: longest time on the run' : 'Practice vs AI' };
    else res = { winner: fin.winner, text: fin.winner ? (tb ? `${api.name(fin.winner)} wins on the tiebreak, ${sc}` : `${api.name(fin.winner)} wins ${Math.max(fin.scores.a, fin.scores.b)}–${Math.min(fin.scores.a, fin.scores.b)}`) : `All square, ${sc}`, sub: tb ? 'Tiebreak: longest time on the run' : 'Getaway', score: { a: fin.scores.a, b: fin.scores.b } };
    S.result = res;
    hud.card(null);
    for (const w of viewers()) H0().view(w).stamp(fin.winner ? `${nameOf(fin.winner).toUpperCase()} WINS` : 'DRAW', fin.winner || '');
    later(() => { try { api.finish(res); } catch (e) { console.error(e); } }, TUNE.final ?? 1600);
  }

  // ── pause / resume ──
  link.on('pause', (d) => { if (!isHost && d && S.R) { S.paused = true; S.pausedAt = d.at; S.resumeAt = 0; } });
  link.on('resume', (d) => { if (!isHost && d && S.R && d.idx === S.R.idx) { S.R.t0 = d.t0; S.R.endAt = d.endAt; S.resumeAt = d.at; S.paused = true; } });
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

  function onLinked() {
    // a (re)linked partner: the host re-sends the lobby setup or the current round
    if (!isHost) return;
    if (S.phase === 'lobby') link.send('setup', S.setup);
    else if (S.match && S.R) link.send('match', { match: { ...S.match }, R: { idx: S.R.idx, runner: S.R.runner, spawn: S.R.spawn, at: S.R.at, t0: S.R.t0, endAt: S.R.endAt } });
    delReason('stale');
  }

  // ── actions ──
  function onAct(w, a) {
    audio.unlock();
    if (a === 'esc') { if (H0().mapOpen) closeMap(); return; }
    if (a === 'cam') { const c = cams[w]; c.mode = (c.mode || rules().camera) === 'near' ? 'far' : 'near'; device.cam = c.mode; lsSet(DEV_KEY, device); audio.tick(); return; }
    if (a === 'look') { cams[w].look = cams[w].look ? 0 : 1; later(() => { cams[w].look = 0; }, 1600); return; }
    if (a === 'map') { if (H0().mapOpen) closeMap(); else openMap(w); return; }
    if (a === 'act') {
      if (!S.R || S.R.over) return;
      if (roleOf(w) === 'cop') { if (H0().mapOpen) closeMap(); else openMap(w); } else dropOil(w);
    }
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
      onTap: (x, z) => { if (!cop) return; const r = placeSpike(w, x, z); if (r !== true) H0().mapSub(r); else { H0().mapSub(sub()); H0().redrawMap(); } },
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
    if (Math.hypot(sx - rc.x, sz - rc.z) < RULES.spikeNoRunner) return 'Too close to them: drop it further ahead';
    for (const s of R.spikes) if (Math.hypot(s.x - sx, s.z - sz) < 14) return 'There’s already a strip there';
    const yaw = Math.atan2(nq.tx, -nq.tz);
    const s = { id: `${w}${++R.seq}`, x: sx, z: sz, yaw, len: Math.max(4, road.width - 0.8), y: geo.ground(sx, sz), at: clock() + RULES.spikeDeploy, by: w, gone: false };
    p.spikesLeft--;
    addSpike(s);
    if (live) link.urgent('spike', s);
    audio.spikeDrop();
    return true;
  }
  function addSpike(s) { if (!S.R || S.R.spikes.find((x) => x.id === s.id)) return; S.R.spikes.push({ ...s, gone: !!s.gone }); }
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
    if (d.kind === 'pit') { P2[w].stats.pits++; H0().view(w).stamp('PIT!', w); audio.pit(); slowMo(); }
  });
  function slowMo() { if (reduced) return; S.slowT = RULES.pitSlowMo; }

  // ── the cars ──
  const carOf = (w) => P2[w].car;

  /** Fixed-step physics for every car this device simulates. */
  const remoteSnap = { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, r: 0 };
  const ct = { pen: 0, nx: 0, nz: 0, px: 0, pz: 0, ia: 0, ib: 0 };
  const ct2 = { pen: 0, nx: 0, nz: 0, px: 0, pz: 0, ia: 0, ib: 0 };
  const snapA = { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, r: 0 }; const snapB = { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, r: 0 };
  const copy = (o, c) => { o.x = c.x; o.z = c.z; o.y = c.y; o.yaw = c.yaw; o.vx = c.vx; o.vz = c.vz; o.r = c.r; return o; };
  function simStep(dt, now) {
    const rules0 = rules();
    for (const w of AB) {
      if (!local(w)) continue;
      const p = P2[w]; const c = p.car; const role = roleOf(w);
      readPad(p.pad, p.inp, dt);
      const prevX = c.x; const prevZ = c.z;
      stepCar(c, p.inp, dt, geo, role === 'cop' ? CAR.cop : CAR.runner, role === 'cop' ? NITRO.cop : NITRO[rules0.nitro]);
      if (c.speed > p.stats.top) p.stats.top = c.speed;
      // world collision events
      for (const ev of c.ev) {
        if (ev.t === 'wall') { if (ev.dmg > 0) damage(w, ev.dmg * rules0.damage, 'wall'); if (ev.v > 4) { crashFx(ev.x, c.y + 0.6, ev.z, ev.v, w); } }
        else if (ev.t === 'break') { world.breakSolid(ev.solid, ev.vx, ev.vz); if (viewers().includes(w) || !live) audio.knock(); breakFx(ev.x, c.y, ev.z); damage(w, 2 * rules0.damage, 'break'); }
      }
      c.ev.length = 0;
      // spikes (the runner's device decides; the cop is immune to its own strips)
      if (role === 'runner' && S.R) {
        for (const s of S.R.spikes) {
          if (s.gone || p.spikeHit.has(s.id) || now < s.at) continue;
          if (Math.abs(s.x - c.x) > 30 || Math.abs(s.z - c.z) > 30) continue;
          if (sweptStrip(s, prevX, prevZ, c.x, c.z)) {
            p.spikeHit.add(s.id); s.gone = true;
            if (c.flat > 0) damage(w, DAMAGE.spikeExtra * rules0.damage, 'spike');
            c.flat = 1; p.stats.spikes++;
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
          if (Math.hypot(o.x - c.x, o.z - c.z) < o.r) { p.oilHit.add(o.id); c.oilT = 1.5; c.r += (Math.random() < 0.5 ? -1 : 1) * 0.9; if (viewers().includes(w)) { H0().view(w).stamp('OIL!', 'bad'); audio.oil(); } }
        }
      }
    }
    // car vs car
    if (live) {
      const w = me; const o = other(me); const c = P2[w].car; const rp = P2[o].shown;
      if (rp.init) {
        copy(remoteSnap, P2[o].remote); remoteSnap.x = rp.x; remoteSnap.z = rp.z; remoteSnap.yaw = rp.yaw; remoteSnap.y = rp.y;
        if (carContact(c, remoteSnap, ct) > 0) {
          const pre = copy(snapA, c);
          const vrel = resolveCar(c, remoteSnap, ct, 1, 1);
          if (vrel > 0) carHit(w, o, pre, remoteSnap, ct, vrel);
        }
      }
    } else {
      const a = P2.a.car; const b = P2.b.car;
      if (carContact(a, b, ct) > 0) {
        copy(snapA, a); copy(snapB, b);
        ct2.pen = ct.pen; ct2.nx = -ct.nx; ct2.nz = -ct.nz; ct2.px = ct.px; ct2.pz = ct.pz; ct2.ia = ct.ib; ct2.ib = ct.ia;
        const va = resolveCar(a, snapB, ct, 1, 1);
        const vb = resolveCar(b, snapA, ct2, 1, 1);
        if (va > 0) carHit('a', 'b', snapA, snapB, ct, va);
        if (vb > 0) carHit('b', 'a', snapB, snapA, ct2, vb);
      }
    }
  }
  /** My car `w` (pre = its pose before the impulse) was hit by `o` (pose op). The victim decides
   *  damage; the runner's device also judges PITs. */
  function carHit(w, o, pre, op, c0, vrel) {
    const p = P2[w]; const c = p.car; const role = roleOf(w);
    const rules0 = rules();
    if (p.lastHit > performance.now() - 220) return;
    p.lastHit = performance.now();
    let pit = 0;
    if (role === 'runner' && S.phase === 'chase') pit = judgePit(pre, op, c0);
    if (pit) {
      c.spinT = 1.15; c.cutT = 0.75;
      c.r += pit * (2.6 + Math.min(2.2, pre.vf ? Math.abs(pre.vf) * 0.05 : Math.hypot(pre.vx, pre.vz) * 0.05));
      damage(w, DAMAGE.pit * rules0.damage, 'pit');
      p.stats.pits++;
      if (live) link.urgent('hit', { kind: 'pit', at: clock() });
      else P2[o].stats.pits++;
      for (const v of viewers()) H0().view(v).stamp('PIT!', o);
      audio.pit(); slowMo();
    } else {
      const dmg = Math.max(0, vrel - DAMAGE.ramMin) * DAMAGE.ramK * rules0.damage;
      if (dmg > 0) damage(w, role === 'cop' ? dmg * 0.6 : dmg, 'ram');
    }
    crashFx(c0.px, c.y + 0.7, c0.pz, vrel, w);
  }
  function damage(w, d, why) {
    const p = P2[w]; const c = p.car;
    if (!S.R || S.R.over || S.phase !== 'chase' || d <= 0) return;
    const role = roleOf(w);
    c.hp = role === 'cop' ? Math.max(DAMAGE.copMinHp, c.hp - d) : Math.max(0, c.hp - d);
    if (d > 3) { p.hurtT = 0.35; cams[w].shake = Math.min(1, cams[w].shake + d / 25); }
    void why;
  }
  function crashFx(x, y, z, v, w) {
    const n = Math.min(18, 4 + v * 0.6);
    for (let k = 0; k < n; k++) fx.spark(x, y, z, (Math.random() - 0.5) * 12, 2 + Math.random() * 5, (Math.random() - 0.5) * 12, 0.35 + Math.random() * 0.3);
    if (v > 9) fx.puff(x, y, z, 0, 1, 0, 0.8, 2.4, 0.7, 0.85, 0.83, 0.8);
    if (viewers().includes(w) || dist2(x, z) < 3600) audio.crash(v);
  }
  function breakFx(x, y, z) { for (let k = 0; k < 5; k++) fx.puff(x + (Math.random() - 0.5) * 2, y + 1 + Math.random() * 2, z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, 1.5, (Math.random() - 0.5) * 3, 0.6, 1.4, 0.6, 0.55, 0.62, 0.42); }
  function dist2(x, z) { const c = P2[human()].car; return (c.x - x) ** 2 + (c.z - z) ** 2; }
  /** Did a wheel axle sweep across strip s between two car positions? */
  function sweptStrip(s, x0, z0, x1, z1) {
    const c = Math.cos(Math.PI - s.yaw); const sn = Math.sin(Math.PI - s.yaw);
    // strip local: x across (half len/2), z along the road (half 0.45); world→local: lx = dx c − dz s, lz = dx s + dz c
    const hx = s.len / 2; const hz = 0.45 + 1.4; // the car's axles are ±1.4 m from its centre
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
  const tPose = { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, r: 0, vf: 0 };
  function trafficStep(dt, tT) {
    if (!traffic || !traffic.total) return;
    for (const w of AB) {
      if (!local(w)) continue;
      const p = P2[w]; const c = p.car;
      traffic.each(c.x, c.z, 9, tT, (id, pose, wreck) => {
        tPose.x = pose.x; tPose.z = pose.z; tPose.y = pose.y; tPose.yaw = pose.yaw; tPose.vx = pose.vx; tPose.vz = pose.vz; tPose.r = 0;
        if (carContact(c, tPose, ct) > 0) {
          const v = resolveCar(c, tPose, ct, 1, 0.8);
          if (v > 0) {
            const push = 1.15;
            traffic.knock(id, pose, -ct.nx * v * push, -ct.nz * v * push, (Math.random() - 0.5) * v * 0.15);
            if (v > 5) { damage(w, Math.max(0, v - 7) * 0.8 * rules().damage, 'traffic'); crashFx(ct.px, c.y + 0.7, ct.pz, v, w); }
          }
        } else if (!wreck && c.speed > 14 && roleOf(w) === 'runner') {
          const d = Math.hypot(pose.x - c.x, pose.z - c.z);
          const rel = Math.hypot(c.vx - pose.vx, c.vz - pose.vz);
          const last = p.nearIds.get(id) || 0;
          if (d < 3.6 && d > 2.25 && rel > 12 && performance.now() - last > 2500) {
            p.nearIds.set(id, performance.now());
            p.stats.near++;
            c.nitro = Math.min(1, c.nitro + NITRO.nearMiss);
            if (viewers().includes(w)) { H0().view(w).hint('Near miss! +nitro', 900); audio.nearMiss(); }
          }
        }
      });
    }
  }

  // ── runner authority: bust / escape ──
  function runnerChecks(dt, now) {
    const R = S.R; const rw = R.runner;
    if (!local(rw) || R.over || S.ending) return;
    const p = P2[rw]; const c = p.car; const cop = live ? P2[other(rw)].shown : P2[other(rw)].car;
    const d = Math.hypot(cop.x - c.x, cop.z - c.z);
    if (c.hp <= 0) return endRound('busted', 'hp');
    if (c.water) return endRound('busted', 'water');
    if (c.speed < RULES.bustStop && d < RULES.bustNear) { p.stopT += dt; if (p.stopT >= RULES.bustT) return endRound('busted', 'boxed'); } else p.stopT = 0;
    // losing the heat
    const heat = rules().heat;
    if (d > heat && !p.los) p.esc = Math.min(1, p.esc + dt / (TUNE.heatT || RULES.heatT));
    else p.esc = Math.max(0, p.esc - (dt * RULES.heatDecay) / RULES.heatT);
    if (p.esc >= 1) return endRound('escaped', 'heat');
    if (now >= R.endAt) return endRound('escaped', 'time');
  }
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
      p.los = los;
    }
  }
  const posOf = (w) => (local(w) ? P2[w].car : P2[w].shown);

  // ── remote car ──
  const pred = { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, r: 0, st: 0, hp: 100, fl: 0, es: 0, nt: 0, lv: -1, rpm: 0, ph: 0, rd: -1, pz: 0, ry: 0, sv: 0, tp: 0, sl: 0 };
  function updateRemote(dt) {
    if (!live) return;
    const o = other(me); const p = P2[o];
    if (!link.predict(pred)) return;
    for (const k in pred) p.remote[k] = pred[k];
    const sh = p.shown;
    if (!sh.init || Math.hypot(pred.x - sh.x, pred.z - sh.z) > 12) { sh.x = pred.x; sh.z = pred.z; sh.y = pred.y; sh.yaw = pred.yaw; sh.init = true; }
    else {
      // converge on the prediction (hides 20 Hz steps and correction jumps)
      const k = Math.min(1, dt * 14);
      sh.x += (pred.x - sh.x) * k; sh.z += (pred.z - sh.z) * k; sh.y += (pred.y - sh.y) * k; sh.yaw += wrapA(pred.yaw - sh.yaw) * k;
    }
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
  const pubS = { x: 0, z: 0, y: 0, yaw: 0, vx: 0, vz: 0, r: 0, st: 0, hp: 100, fl: 0, es: 0, nt: 0, lv: -1, rpm: 0, ph: 0, rd: -1, pz: 0, ry: 0, sv: 0, tp: 0, sl: 0 };
  function publish() {
    if (!live) return;
    const p = P2[me]; const c = p.car;
    pubS.x = Math.round(c.x * 100) / 100; pubS.z = Math.round(c.z * 100) / 100; pubS.y = Math.round(c.y * 100) / 100;
    pubS.yaw = Math.round(c.yaw * 1000) / 1000; pubS.vx = Math.round(c.vx * 100) / 100; pubS.vz = Math.round(c.vz * 100) / 100; pubS.r = Math.round(c.r * 1000) / 1000;
    pubS.st = Math.round(c.steer * 100) / 100; pubS.hp = Math.round(c.hp * 10) / 10;
    pubS.fl = (c.boost ? F_BOOST : 0) | (c.braking ? F_BRAKE : 0) | (c.hand ? F_HAND : 0) | (c.spinT > 0 ? F_SPIN : 0) | (c.flat > 0 ? F_FLAT : 0) | (S.phase === 'chase' && roleOf(me) === 'cop' ? F_SIREN : 0) | (c.skid ? F_SKID : 0) | (c.water ? F_WATER : 0);
    pubS.es = Math.round(p.esc * 100) / 100; pubS.nt = Math.round(c.nitro * 100) / 100; pubS.lv = c.level; pubS.rpm = Math.round(c.rpm * 100) / 100;
    pubS.ph = PH[S.phase] ?? 0; pubS.rd = S.R ? S.R.idx : -1; pubS.pz = S.reasons; pubS.ry = S.meReady ? 1 : 0; pubS.sv = S.loading ? 0 : S.mapIdx + 1; pubS.tp = Math.round(p.stats.top * 10) / 10; pubS.sl = Math.round(c.slip * 10) / 10;
    link.publish(pubS);
  }

  // ── phase from the shared clock ──
  function updatePhase(now) {
    const R = S.R;
    if (!R || S.phase === 'final' || S.phase === 'lobby' || S.phase === 'loading') return;
    if (R.over) { S.phase = 'result'; return; }
    const intro = TUNE.intro ?? RULES.intro;
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
      if (ph === 'count') hud.card(null);
      if (ph === 'chase') {
        hud.card(null);
        for (const w of viewers()) { const v = H0().view(w); v.count('GO'); later(() => v.count(''), 700); v.hint(roleOf(w) === 'cop' ? (rules().spikes ? 'Bust them! Tap the map to drop spike strips.' : 'Bust them! Get alongside and PIT their back corner.') : 'Go! Lose the cop or survive the clock.', 3200); }
        audio.beep(true);
      }
      void prev;
    }
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
      const a = now / 1000 * 0.06; const r = 150;
      cam.fov = 55; cam.position.set(cx + Math.sin(a) * r, geo.ground(cx, cz) + 75, cz + Math.cos(a) * r); cam.lookAt(cx, geo.ground(cx, cz) + 10, cz);
      cam.updateProjectionMatrix(); cr.init = false;
      return;
    }
    const intro = S.phase === 'intro' || S.phase === 'wait';
    if (intro) {
      const R = S.R; const rc = P2[R.runner].car;
      const a = ((now - R.at) / 1000) * 0.32 + 0.6; const r = 26;
      cam.fov = 58; cam.position.set(rc.x + Math.sin(a) * r, rc.y + 9, rc.z + Math.cos(a) * r); cam.lookAt(rc.x, rc.y + 1.2, rc.z);
      cam.updateProjectionMatrix(); cr.init = false;
      return;
    }
    const mode = CAM[cr.mode || rules().camera] || CAM.near;
    // follow the velocity a little when sliding, so drifts read from behind
    let hy = c.yaw;
    if (c.speed > 4) { const vy = Math.atan2(c.vx, -c.vz); const d = wrapA(vy - c.yaw); if (Math.abs(d) < 2) hy = c.yaw + d * 0.45; }
    if (cr.look) hy += Math.PI;
    if (!cr.init) { cr.yaw = hy; cr.x = c.x - Math.sin(hy) * mode.dist; cr.z = c.z + Math.cos(hy) * mode.dist; cr.y = c.y + mode.height; cr.fov = CAM.fov; cr.init = true; }
    cr.yaw += wrapA(hy - cr.yaw) * Math.min(1, dt * (cr.look ? 20 : 5.5));
    const fx0 = Math.sin(cr.yaw); const fz0 = -Math.cos(cr.yaw);
    const portraitK = cr.aspect < 1 ? 1.3 : 1;
    let dist = (mode.dist + Math.min(2.2, c.speed * 0.03)) * portraitK;
    // pull in when a building is in the way
    const tx = c.x - fx0 * dist; const tz = c.z - fz0 * dist;
    const t = geo.segBlocked(c.x, c.z, tx, tz, 3);
    if (t < 1) dist = Math.max(3.2, dist * t - 0.8);
    const gx = c.x - fx0 * dist; const gz = c.z - fz0 * dist;
    const gy = Math.max(c.y + mode.height * portraitK + (t < 1 ? 1.2 : 0), geo.ground(gx, gz) + 1.4);
    const k = Math.min(1, dt * 9);
    cr.x += (gx - cr.x) * k; cr.z += (gz - cr.z) * k; cr.y += (gy - cr.y) * Math.min(1, dt * 6);
    // keep the camera from lagging too far at high speed
    const dx = cr.x - c.x; const dz = cr.z - c.z; const dd = Math.hypot(dx, dz); const maxD = dist * 1.35;
    if (dd > maxD) { cr.x = c.x + (dx / dd) * maxD; cr.z = c.z + (dz / dd) * maxD; }
    let sx = 0; let sy = 0;
    if (cr.shake > 0.01 && !reduced) { sx = (Math.random() - 0.5) * cr.shake * 0.5; sy = (Math.random() - 0.5) * cr.shake * 0.35; cr.shake *= Math.max(0, 1 - dt * 5); }
    cam.position.set(cr.x + sx, cr.y + sy, cr.z);
    tmpV.x = c.x + fx0 * mode.ahead; tmpV.y = c.y + mode.look; tmpV.z = c.z + fz0 * mode.ahead;
    cam.lookAt(tmpV.x, tmpV.y, tmpV.z);
    const portrait = cams[w].aspect < 1;
    const base = portrait ? CAM.portraitFov : CAM.fov;
    const fT = base + CAM.fovSpeed * Math.pow(Math.min(1, c.speed / 46), 1.5) + (c.boost ? CAM.fovNitro : 0);
    cr.fov += (fT - cr.fov) * Math.min(1, dt * 3);
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
      if (!inGame) { for (let k = 0; k < 4; k++) wheels.set(slot, k, 0, -100, 0, 0, 0, 0, 0, false); slot++; continue; }
      v.pose(c.x, c.y, c.z, c.yaw, local(w) ? c.pitch : 0, local(w) ? c.roll : 0, c.flat);
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
        if (Math.random() < dt * 14) fx.puff(rrx, c.y + 0.3, rrz, -c.vx * 0.1, 0.6, -c.vz * 0.1, 0.35, 1.6, 0.8, 0.92, 0.92, 0.92);
      }
      p.prevRL[0] = rlx; p.prevRL[2] = rlz; p.prevRR[0] = rrx; p.prevRR[2] = rrz;
      // dust off-road
      if ((c.surf === 'grass' || c.surf === 'dirt' || c.surf === 'sand') && c.speed > 6) {
        p.dustT -= dt;
        if (p.dustT <= 0) { p.dustT = 0.05; const col = c.surf === 'grass' ? [0.62, 0.6, 0.46] : c.surf === 'sand' ? [0.92, 0.84, 0.64] : [0.72, 0.6, 0.44]; fx.puff(rrx, c.y + 0.4, rrz, -c.vx * 0.15 + (Math.random() - 0.5) * 2, 1, -c.vz * 0.15, 0.6, 2.4, 1.1, col[0], col[1], col[2]); }
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
    let n = 0;
    const mats = trafficMeshes;
    if (traffic.total && S.mapEntry) {
      const vs = viewers();
      const c0 = cams[vs[0]].cam.position;
      traffic.each(c0.x, c0.z, TRAFFIC.near, tT, (id, pose) => {
        if (n >= TRAFFIC.max) return;
        dm.position.set(pose.x, pose.y, pose.z); dm.rotation.set(0, Math.PI - pose.yaw, 0);
        const v = (id * 2654435761) >>> 0;
        const sl = 0.92 + ((v >>> 8) % 100) / 400;
        dm.scale.set(pose.sc, pose.sc * (0.95 + ((v >>> 16) % 20) / 100), pose.sc * sl); dm.updateMatrix();
        mats.paint.setMatrixAt(n, dm.matrix); mats.trim.setMatrixAt(n, dm.matrix);
        const col = P.traffic[v % P.traffic.length]; tc.setRGB(col[0], col[1], col[2]); mats.paint.setColorAt(n, tc);
        n++;
      });
    }
    mats.paint.count = n; mats.trim.count = n;
    mats.paint.instanceMatrix.needsUpdate = true; mats.trim.instanceMatrix.needsUpdate = true; if (mats.paint.instanceColor) mats.paint.instanceColor.needsUpdate = true;
  }
  let dm = null; let tc = null;
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
    return Math.hypot(s.x - c.x, s.z - c.z) < RULES.spikeReveal;
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
      if (myRole === 'runner' && !split() && !(rules().spikeSee === 'always' ? now >= s.at : Math.hypot(s.x - P2[w].car.x, s.z - P2[w].car.z) < RULES.spikeReveal)) continue;
      const [x, y] = toPx(s.x, s.z); hud.drawSpike(g, x, y, s.yaw, dpr * (full ? 1.1 : 0.9), now < s.at);
    }
    if (full && myRole === 'cop' && S.phase === 'chase') {
      const c = P2[w].car; const [cx, cy] = toPx(c.x, c.z);
      g.beginPath(); g.arc(cx, cy, RULES.spikeRange * k, 0, Math.PI * 2); g.setLineDash([6 * dpr, 6 * dpr]); g.lineWidth = 2 * dpr; g.strokeStyle = '#e2333f'; g.stroke(); g.setLineDash([]);
      if (otherVisible(w)) { const rc = posOf(o); const [rx, ry] = toPx(rc.x, rc.z); g.beginPath(); g.arc(rx, ry, Math.max(4 * dpr, RULES.spikeNoRunner * k), 0, Math.PI * 2); g.fillStyle = 'rgba(226,51,63,.18)'; g.fill(); }
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
    const vs = viewers(); const R = S.R;
    for (const w of vs) {
      const v = H0().view(w); const p = P2[w]; const c = p.car; const role = roleOf(w);
      const inGame = !!R && S.phase !== 'lobby';
      v.showPlay(inGame && S.phase !== 'final' && S.phase !== 'intro' && S.phase !== 'wait', inGame && S.phase !== 'final');
      if (!inGame) continue;
      if (hudT <= 0) {
        v.scores(S.match.scores.a, S.match.scores.b);
        const pips = []; for (let i = 0; i < S.match.rounds; i++) { const h = S.match.hist[i]; pips.push(h ? (h.outcome === 'busted' ? other(h.runner) : h.runner) : i === R.idx ? 'now' : ''); }
        v.pips(pips);
        v.role(role, w);
        v.health(c.hp, role);
      }
      const left = S.phase === 'chase' ? R.endAt - now : R.endAt - R.t0;
      v.clock(S.paused && S.pausedAt > R.t0 ? R.endAt - S.pausedAt : left, `Round ${R.idx + 1}/${S.match.rounds}`, S.phase === 'chase' && left < 15000);
      // heat meter
      const rp = P2[R.runner];
      const d = Math.hypot(posOf('a').x - posOf('b').x, posOf('a').z - posOf('b').z);
      if (role === 'runner') v.heat(rp.esc, p.los ? 'Spotted' : d > rules().heat ? 'Losing them' : 'Get further away', `${Math.round(d)} m`, p.los, S.phase === 'chase');
      else v.heat(rp.esc, rp.esc > 0.02 ? 'Slipping away' : 'On their tail', `${Math.round(d)} m`, rp.esc > 0.3, S.phase === 'chase');
      v.speed(c.speed * 3.6);
      v.nitro(c.nitro, c.boost, role === 'cop' || rules().nitro !== 'off');
      if (hudT <= 0) v.tools(role === 'cop' ? `<span class="${p.spikesLeft ? '' : 'off'}">SPIKES ${p.spikesLeft}</span>` : `<span class="${p.oilLeft ? '' : 'off'}">OIL ${p.oilLeft}</span>`);
      // vignette: siren behind the runner, red when hurt
      p.hurtT -= dt;
      const copClose = role === 'runner' && S.phase === 'chase' && d < 45;
      v.vignette(p.hurtT > 0 ? 'hurt' : copClose ? 'siren' : '');
      // partner tag
      if (live && w === me) tagFor(w, v);
      if (miniT <= 0 && mapImg) v.mini(mapImg, c.x, c.z, (g, toPx, dpr, k) => drawMarks(g, toPx, dpr, k, w, false));
      if (!split() && w === human()) hud.setAct(role, role === 'cop' ? p.spikesLeft > 0 && S.phase === 'chase' : p.oilLeft > 0 && S.phase === 'chase', role === 'cop' ? p.spikesLeft : p.oilLeft);
    }
    if (hudT <= 0) hudT = 0.2;
    if (miniT <= 0) miniT = 1 / 15;
    if (H0().mapOpen && (S.mapT = (S.mapT || 0) - dt) <= 0) { S.mapT = 0.2; H0().redrawMap(); }
    // pause card
    if (S.paused && S.R && !S.R.over) {
      const sec = S.resumeAt ? Math.max(0, Math.ceil((S.resumeAt - now) / 1000)) : 0;
      const t = S.resumeAt ? `Back in ${sec}…` : glLost ? 'Graphics paused' : live && (!partnerHere || link.silence > 2000) ? `Waiting for ${api.name(other(me))}` : 'Paused';
      const sub = S.resumeAt ? 'Get ready' : live && !partnerHere ? 'The chase carries on when they’re back.' : (S.reasons & PZ.hidden) ? '' : live && P2[other(me)].remote.pz ? `${api.name(other(me))} stepped away for a moment.` : '';
      hud.card(pauseCard(t, sub, glLost ? ['resume', 'Tap to resume'] : null), 'dim');
      S.pauseCard = true;
    } else if (S.pauseCard) { S.pauseCard = false; hud.card(null); }
  }
  const proj = { x: 0, y: 0, z: 0 };
  function tagFor(w, v) {
    const o = other(w); const oc = P2[o].car; const cam = cams[w].cam;
    if (!S.R || S.phase === 'intro' || S.phase === 'wait') { v.tag(0, 0, false); v.edgeArrow(0, 0, 0, false); return; }
    vec.set(oc.x, oc.y + 2.4, oc.z).project(cam);
    const d = Math.hypot(oc.x - P2[w].car.x, oc.z - P2[w].car.z);
    const vw = W; const vh = H;
    const on = vec.z < 1 && Math.abs(vec.x) < 1 && Math.abs(vec.y) < 1 && d < 300;
    v.tag((vec.x * 0.5 + 0.5) * vw, (-vec.y * 0.5 + 0.5) * vh, on, `${api.name(o)} · ${Math.round(d)} m`, roleOf(o) === 'cop' ? 'cop' : '');
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
  let acc = 0; let lastTs = 0; let lastWall = 0;
  function frame(ts) {
    if (dead) return;
    raf = requestAnimationFrame(frame);
    const dtReal = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0.016; lastTs = ts;
    if (!ready3D || !world || S.loading && !world) return;
    const w0 = performance.now();
    const now = clock();
    if (!vec) { vec = new THREE.Vector3(); dm = new THREE.Object3D(); tc = new THREE.Color(); }
    // pause bookkeeping
    if (isHost || !live) hostPauseCheck(now); else guestPauseCheck(now);
    if (!live && S.paused === false && (S.reasons || softReasons.size)) { /* handled by hostPauseCheck */ }
    updatePhase(now);
    updateRemote(dtReal);
    // slow motion after a PIT
    let tsK = 1;
    if (S.slowT > 0) { S.slowT -= dtReal; tsK = RULES.slowMoScale; }
    const chase = S.phase === 'chase' && !S.paused && S.R && !S.R.over;
    if (chase) {
      acc += dtReal * tsK;
      let n = 0;
      while (acc >= DT && n < MAX_STEPS) { simStep(DT, now); acc -= DT; n++; }
      if (n >= MAX_STEPS) acc = 0;
      // AI + bots
      for (const w of AB) { const p = P2[w]; if (p.driver && local(w)) { const o = posOf(other(w)); p.driver.update(dtReal, p.car, o, { los: p.los }); if (p.driver.out.spike && roleOf(w) === 'cop') aiSpike(w); } }
      const tT = (now - S.R.t0) / 1000 + 600;
      trafficStep(dtReal, tT);
      traffic.stepWrecks(dtReal, viewers().map((v) => P2[v].car));
      updateLos(dtReal);
      runnerChecks(dtReal * tsK, now);
      copFallback(now);
    } else {
      acc = 0;
      if (S.R && !S.R.over && S.phase !== 'chase') {
        // countdown: hold the cars (but let them rev)
        for (const w of AB) { const p = P2[w]; readPad(p.pad, p.inp, dtReal); p.car.rpm += ((p.inp.gas ? 0.9 : 0.2) - p.car.rpm) * Math.min(1, dtReal * 6); }
      }
      if (S.R && S.R.over) for (const w of AB) if (local(w)) { const c = P2[w].car; c.vx *= Math.max(0, 1 - dtReal * 1.5); c.vz *= Math.max(0, 1 - dtReal * 1.5); c.r *= Math.max(0, 1 - dtReal * 2); c.x += c.vx * dtReal; c.z += c.vz * dtReal; c.yaw += c.r * dtReal; c.speed = Math.hypot(c.vx, c.vz); }
    }
    S.tSec += dtReal;
    // visuals
    const tT = S.R ? (now - S.R.t0) / 1000 + 600 : now / 1000;
    drawCars(dtReal);
    drawTraffic(S.paused && S.R ? (S.pausedAt - S.R.t0) / 1000 + 600 : tT);
    drawStrips(now);
    if (!S.paused) carFx(dtReal);
    fx.update(dtReal, cams[human()].cam);
    if (S.mapEntry && typeof S.mapEntry.animate === 'function') { try { S.mapEntry.animate(S.tSec, animCars); animCars[0].x = P2.a.car.x; animCars[0].z = P2.a.car.z; animCars[1].x = P2.b.car.x; animCars[1].z = P2.b.car.z; } catch (e) { if (!S.animErr) { S.animErr = true; console.warn('getaway: map.animate failed', e); } } }
    // audio
    const mc = P2[human()].car; const oc = P2[other(human())].car;
    if (S.R && (S.phase === 'chase' || S.phase === 'count' || S.phase === 'result')) {
      meA.rpm = mc.rpm; meA.gas = P2[human()].inp.gas; meA.slip = mc.slip; meA.speed = mc.speed; meA.flat = mc.flat; meA.boost = mc.boost; meA.offroad = mc.surf === 'grass' || mc.surf === 'dirt' || mc.surf === 'sand';
      themA.rpm = oc.rpm; themA.dist = Math.hypot(oc.x - mc.x, oc.z - mc.z);
      const cop = P2[copW()].car; sirenA.on = S.phase === 'chase' && !S.paused; sirenA.dist = roleOf(human()) === 'cop' ? 30 : Math.hypot(cop.x - mc.x, cop.z - mc.z);
      audio.engine(S.paused ? null : meA, S.paused ? null : themA, sirenA, dtReal);
      if (mc.boost && !S.wasBoost) audio.nitro();
      S.wasBoost = mc.boost;
    } else audio.engine(null, null, null, dtReal);
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
      renderer.setViewport(vx, 0, vw, H); renderer.setScissor(vx, 0, vw, H);
      farCam.position.copy(cr.cam.position); farCam.quaternion.copy(cr.cam.quaternion); farCam.fov = cr.cam.fov; farCam.aspect = cr.cam.aspect; farCam.updateProjectionMatrix();
      const c = P2[w].car;
      const sl = S.phase === 'chase' && !reduced ? clamp((c.speed - 24) / 20, 0, 1) * 0.85 + (c.boost ? 0.35 : 0) : 0;
      fx.setSpeedLines(sl, cr.aspect);
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
  const meA = { rpm: 0, gas: 0, slip: 0, speed: 0, flat: 0, boost: false, offroad: false }; const themA = { rpm: 0, dist: 999 }; const sirenA = { on: false, dist: 999 };
  const animCars = [{ x: 0, z: 0 }, { x: 0, z: 0 }];
  function dynRes(dt) {
    if (TUNE.maxDpr) return;
    perf.ewma = perf.ewma * 0.94 + dt * 1000 * 0.06;
    perf.checkT += dt;
    if (perf.checkT < 0.25) return; perf.checkT = 0;
    if (perf.ewma > 18.4 && scale > 0.55) { scale = Math.max(0.55, scale - (perf.ewma > 26 ? 0.15 : 0.08)); perf.scaleDowns++; perf.lowFor = 0; resize(); }
    else if (perf.ewma < 15.4) { perf.lowFor += 0.25; if (perf.lowFor > 4 && scale < 1) { scale = Math.min(1, scale + 0.05); perf.scaleUps++; perf.lowFor = 0; resize(); } }
    else perf.lowFor = 0;
  }
  function aiSpike(w) {
    const rc = posOf(runnerW()); const sp = Math.hypot(rc.vx || 0, rc.vz || 0) || 1;
    const ahead = 90 + Math.random() * 40;
    const x = rc.x + ((rc.vx || 0) / sp) * ahead; const z = rc.z + ((rc.vz || 0) / sp) * ahead;
    placeSpike(w, x, z);
  }

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
  const legendTimer = setInterval(() => { if (!dead) hud.setLegend(S.R && !S.R.over && S.phase === 'chase' ? legendHTML() : ''); }, 500);
  timers.push(legendTimer);

  load();

  // ── test hook ──
  if (typeof window !== 'undefined' && window.__gtwTest) {
    window.__getaway = {
      get ready() { return ready3D && !S.loading; },
      state() {
        const R = S.R;
        const car = (w) => { const c = P2[w].car; return { x: c.x, z: c.z, y: c.y, yaw: c.yaw, speed: c.speed, vf: c.vf, hp: c.hp, flat: c.flat, spinT: c.spinT, nitro: c.nitro, level: c.level, surf: c.surf, water: c.water, top: c.topSpeed, role: roleOf(w), esc: P2[w].esc, los: P2[w].los, spikesLeft: P2[w].spikesLeft, oilLeft: P2[w].oilLeft, stats: { ...P2[w].stats } }; };
        return {
          phase: S.phase, paused: S.paused, resumeAt: S.resumeAt, reasons: S.reasons, setup: S.setup, setupVer: S.setupVer, mapId: S.mapId, loading: S.loading,
          match: S.match && { scores: { ...S.match.scores }, hist: S.match.hist.slice(), rounds: S.match.rounds, map: S.match.map, rules: S.match.rules },
          R: R && { idx: R.idx, runner: R.runner, at: R.at, t0: R.t0, endAt: R.endAt, over: R.over, result: R.result, spikes: R.spikes.map((s) => ({ id: s.id, x: s.x, z: s.z, yaw: s.yaw, gone: s.gone, at: s.at })), oils: R.oils.length },
          a: car('a'), b: car('b'), now: clock(), rtt: link.rtt, linked: link.ready, result: S.result || null, localMode: S.localMode, me: human(),
          partnerSeen: live ? { ...P2[other(me)].remote, shown: { ...P2[other(me)].shown } } : null, sent: link.sent,
        };
      },
      perf() {
        const n = Math.min(perf.n, 600); const d = Array.from(perf.dts.slice(0, n)).sort((x, y) => x - y); const wk = Array.from(perf.work.slice(0, n)).sort((x, y) => x - y);
        const q = (a, k) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * k))] : 0);
        return { p50: q(d, 0.5), p95: q(d, 0.95), work50: q(wk, 0.5), work95: q(wk, 0.95), calls: perf.calls, tris: perf.tris, maxCalls: perf.maxCalls, maxTris: perf.maxTris, scale, scaleDowns: perf.scaleDowns, scaleUps: perf.scaleUps, programs0: perf.programs0, programs: renderer.info.programs.length, load: S.loadMs, build: S.buildStats, geoms: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
      },
      resetPerf() { perf.n = 0; perf.maxCalls = 0; perf.maxTris = 0; },
      start() { hostStart(); },
      /** Rebuild the world (even for the same map): map-switch regression tests. */
      async reloadMap(id) { S.mapId = null; await loadMap(id || S.setup.map); return S.mapId; },
      setRules(r) { if (!isHost) return null; setSetup({ ...S.setup, rules: { ...S.setup.rules, ...r } }); return S.setup; },
      setSetup(s) { if (!isHost) return null; setSetup({ ...S.setup, ...s }); return S.setup; },
      setLocalMode(m, role) { S.localMode = m; if (role) S.practiceRole = role; renderLobby(true); },
      /** Drive my car with the AI (bots for tests). */
      auto(w, on) { const p = P2[w || human()]; p.auto = !!on; if (on && S.R) { p.driver = createDriver(geo, roleOf(w || human()), { seed: 99 }); p.pad.auto = p.driver.out; } else if (!on && !(ai() && (w || human()) === aiW)) { p.driver = null; p.pad.auto = null; } },
      /** Fixed inputs for car w: { steer, gas, brake, hand, nitro } (null = release). */
      hold(w, inp) { const p = P2[w || human()]; p.driver = null; p.pad.auto = inp ? { steer: 0, gas: 0, brake: 0, hand: false, nitro: false, ...inp } : null; },
      teleport(w, x, z, yaw, v = 0) { const c = P2[w].car; placeCar(c, x, z, yaw, geo); c.vx = Math.sin(yaw) * v; c.vz = -Math.cos(yaw) * v; c.speed = v; },
      setCar(w, o) { Object.assign(P2[w].car, o); },
      placeSpike(w, x, z) { return placeSpike(w, x, z); },
      endNow(outcome, reason) { endRound(outcome, reason); },
      shortenRound(ms) { if (isHost && S.R) { S.R.endAt = clock() + ms; if (live) link.urgent('resume', { idx: S.R.idx, at: 0, t0: S.R.t0, endAt: S.R.endAt }); } },
      trafficHash(t) { return traffic ? traffic.hash(t) : 0; },
      trafficCount() { return traffic ? traffic.total : 0; },
      trafficNear(x, z, r, t) { const out = []; if (traffic) traffic.each(x, z, r, t, (id, p) => out.push({ id, x: p.x, z: p.z, yaw: p.yaw, vx: p.vx, vz: p.vz })); return out; },
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
      loseContext() { const ext = renderer.getContext().getExtension('WEBGL_lose_context'); if (ext) { ext.loseContext(); setTimeout(() => ext.restoreContext(), 400); return true; } return false; },
      worldStats() { return world ? { ...world.stats, chunks: world.chunks.length, visible: world.chunks.filter((c) => c.group.visible).length, broken: world.brokenCount() } : null; },
      inputStats: () => ({ ...inputStats }),
      internals: { P2, S, get geo() { return geo; }, get world() { return world; }, get renderer() { return renderer; }, link },
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
      if (trafficMeshes) { trafficMeshes.paint.geometry.dispose(); trafficMeshes.trim.geometry.dispose(); }
      if (renderer) { renderer.dispose(); try { renderer.forceContextLoss(); } catch { /* ignore */ } }
      hud.destroy(); if (hud2) hud2.destroy();
      root.remove();
      if (typeof window !== 'undefined' && window.__getaway) delete window.__getaway;
    },
  };
}
