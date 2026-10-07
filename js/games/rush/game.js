// Rail Rush game orchestrator: loading, renderer + dynamic resolution, lobby, synchronized start,
// the fixed-step loop, pause / resume protocol, partner re-mounts, finale, HUD, test hook.
import {
  DT, LANE_W, SLIDE_TIME, STUMBLE_T, START_DELAY, RESUME_DELAY, RACE_LEN, BRAWL_CAP, MT_LEAD, CHUNK,
  HEARTS, TEAM_HEARTS_MAX, HIT_STOP, FINALE_MS, baseSpeed,
} from './tune.js';
import { hash } from '../core.js';
import { createTrack, trackHash, difficulty, O_MTRAIN, TUT_JUMP, TUT_ROLL } from './track.js';
import {
  newRunner, step, act, createBot, botRun, crash, C_FORCED, A_LEFT, A_RIGHT, A_UP, A_DOWN,
  E_JUMP, E_LAND, E_ROLL, E_LANE, E_COIN, E_PICK, E_STUMBLE, E_CRASH, E_RESPAWN, E_SHIELD,
  E_CLOSE, E_COMBO, E_FINISH, E_SMASH, E_TOKEN, E_BLOCK, E_BUMP, E_BONUS, E_CLIP,
} from './sim.js';
import { makePalette } from './gfx.js';
import { createWorld } from './world.js';
import { createAvatar, disposeAvatarGeometry } from './avatar.js';
import { createFx, createRig, createOverlay } from './fx.js';
import { createAudio } from './audio.js';
import { createInput, A_USE } from './input.js';
import { createHud } from './hud.js';
import { createLink, emptyState } from './link.js';
import { createRules, MODES, MODE_LABEL, fmtM } from './modes.js';

const PH = { loading: 0, lobby: 1, countdown: 2, run: 3, finale: 4, over: 5 };
const F_AIR = 1; const F_ROLL = 2; const F_DOWN = 4; const F_INV = 8; const F_SHIELD = 16; const F_DONE = 32;
const F_RUN = 64; const F_OUT = 128; const F_BOOST = 256; const F_MAGNET = 512; const F_SNEAK = 1024;
const WEAPON_IDX = [null, 'ink', 'block', 'zap', 'rocket', 'shield'];
const PZ = { menu: 1, hidden: 2, gl: 3, gone: 4, stale: 5, sync: 6, tap: 7 };
const PZ_ORDER = ['gl', 'tap', 'menu', 'hidden', 'sync', 'gone', 'stale'];
const RULE_MSGS = ['atk', 'res', 'shove', 'fin', 'out', 'down', 'revive', 'missed'];
const SKEY = 'rush.settings.v1';
const TKEY = 'rush.tutorial.v1';
const MKEY = 'rush.mode.v1';
const MUTE = 'ju.games.mute';
const HN = 150; // lag-compensation history (frames)
const COMBO_WORDS = ['', '', 'Nice', 'Great', 'Slick', 'Wild', 'Unreal', 'Legend'];
const DIGITS = ['', '1', '2', '3'];
const TUT_KEYS = ['← → or A D to switch lanes', '↑ W or Space to jump', '↓ or S to roll under'];
const TUT_BTNS = ['Tap left or right to switch lanes', 'Tap JUMP to jump', 'Tap ROLL to roll under'];
const TUT_SWIPE = ['Swipe left or right to switch lanes', 'Swipe up to jump', 'Swipe down to roll under'];
// Unlockable style: earned by milestones, kept in the shared game data (per person), worn per device.
const STYLES = [
  { key: 'trail', k: 0, name: 'None' },
  { key: 'trail', k: 1, name: 'Sparkle', how: 'Run 1 km in one go', test: (S) => S.dist >= 1000 },
  { key: 'trail', k: 2, name: 'Ink puffs', how: '10 close calls in one run', test: (S) => S.closeCalls >= 10 },
  { key: 'trail', k: 3, name: 'Confetti', how: 'Win 3 matches', test: (S) => S.wins >= 3 },
  { key: 'trail', k: 4, name: 'Embers', how: 'A x10 combo', test: (S) => S.maxCombo >= 10 },
  { key: 'hat', k: 0, name: 'None' },
  { key: 'hat', k: 1, name: 'Crown', how: 'Beat your partner’s best Daily run', test: (S) => S.beatDaily },
  { key: 'hat', k: 2, name: 'Halo', how: 'Revive your partner 3 times', test: (S) => S.revives >= 3 },
  { key: 'hat', k: 3, name: 'Party cone', how: '150 coins in one run', test: (S) => S.coins >= 150 },
];
const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const dayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** The Daily seed: one track for both of you, all day (local calendar day). */
export function dailySeed(day = dayKey()) { return (hash('rush-daily', day) % 2147483646) + 1; }

const AB = ['a', 'b'];
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

let liveGames = 0; // instances alive (test hook)

export function createGame(el, api) {
  const live = api.mode === 'live';
  const meW = live ? api.me : null;
  const isHost = live ? !!api.isHost : true;
  const dbg = (typeof window !== 'undefined' && window.__RUSH_DEBUG) || null;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const phoneish = coarse && Math.min(screen.width, screen.height) < 600;
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const split = !live;
  const other = (w) => (w === 'a' ? 'b' : 'a');
  let dead = false;
  const mountT = performance.now();
  let loadMs = 0;
  liveGames++;

  // ── DOM ──
  const root = document.createElement('div');
  root.className = 'g-rush' + (split ? ' rr-split' : '');
  root.innerHTML = `<div class="rr-gl"></div><div class="rr-touch"></div>${split ? '<div class="rr-divider"></div>' : ''}`;
  el.appendChild(root);
  const glWrap = root.querySelector('.rr-gl');
  const touch = root.querySelector('.rr-touch');

  const settings = Object.assign({ scheme: 'swipe', music: 'on', trail: 0, hat: 0 }, lsGet(SKEY, {}));
  // shared bests + unlocks (the engine mirrors them locally and syncs the shared doc)
  const data = () => (typeof api.data === 'function' ? api.data() : {});
  const setData = (patch) => { if (typeof api.setData === 'function') api.setData(patch); };
  const unlocked = (w, st) => st.k === 0 || !!data()[`unlock_${w}_${st.key}${st.k}`];
  const wear = { a: { tr: 0, ht: 0 }, b: { tr: 0, ht: 0 } };
  /** What each local runner wears: the device's pick, if that person has earned it. */
  function resolveWear() {
    for (const w of AB) {
      const tr = STYLES.find((x) => x.key === 'trail' && x.k === (settings.trail | 0));
      const ht = STYLES.find((x) => x.key === 'hat' && x.k === (settings.hat | 0));
      wear[w].tr = tr && unlocked(w, tr) ? tr.k : 0;
      wear[w].ht = ht && unlocked(w, ht) ? ht.k : 0;
    }
  }
  const audio = createAudio({
    musicOn: () => settings.music === 'on',
    getCtx: typeof api.audio === 'function' ? () => api.audio() : null,
    mutedFn: typeof api.muted === 'function' ? () => api.muted() : null,
  });
  const timers = [];
  const offs = [];

  const M = {
    phase: 'loading', mode: lsGet(MKEY, 'race'), lobbyMode: lsGet(MKEY, 'race'), ready: false,
    seed: 0, startAt: 0, len: RACE_LEN, cap: BRAWL_CAP, track: null,
    runMs: 0, steps: 0, lastNow: 0, alpha: 0,
    paused: false, reasons: new Set(), partnerPz: 0, resumeAt: 0, pauseShownAt: 0,
    result: null, endAt: 0, th: 4, goal: 100, goalIdx: 0, revives: 0, partnerFin: -1, partnerOut: -1,
    startedWall: 0, firstRunWall: 0, epoch: 0, lastScore: 0,
  };
  if (!MODES.includes(M.lobbyMode)) M.lobbyMode = 'race';

  const hud = createHud(root, {
    onUse: (w) => useWeapon(w),
    onBtn: (w, a) => onAction(w, a),
    onPause: () => { if (M.phase === 'run' || M.phase === 'countdown') { M.reasons.add('menu'); audio.play('tick'); } },
    onResume: () => { M.reasons.delete('menu'); if (M.reasons.has('tap') && !glLost) M.reasons.delete('tap'); },
    onMode: (m) => { if (!isHost || M.phase !== 'lobby') return; M.lobbyMode = m; lsSet(MKEY, m); audio.unlock(); audio.play('tick'); },
    onGo: () => { audio.unlock(); if (isHost) hostStart(); else { M.ready = !M.ready; audio.play('tick'); } },
    onSettings: () => openSettings(),
    onSet: (k, v) => {
      if (k === 'sound') lsSet(MUTE, v === 'off');
      else if (k === 'trail' || k === 'hat') { settings[k] = v | 0; lsSet(SKEY, settings); resolveWear(); audio.play('tick'); }
      else { settings[k] = v; lsSet(SKEY, settings); }
      root.classList.toggle('rr-buttons', settings.scheme === 'buttons' && !split);
      openSettings();
    },
    onSettingsDone: () => hud.settings(null),
    keyHint: split ? (w) => (w === 'a' ? 'E' : 'Enter') : (coarse ? null : () => 'E'),
  });
  root.classList.toggle('rr-buttons', settings.scheme === 'buttons' && !split);
  function openSettings() {
    let snd = 'on';
    try { snd = JSON.parse(localStorage.getItem(MUTE) || 'false') ? 'off' : 'on'; } catch { /* ignore */ }
    const w = meW || 'a';
    const styles = STYLES.map((st) => ({ key: st.key, k: st.k, name: st.name, how: st.how || '', locked: !unlocked(w, st) }));
    if (!unlocked(w, STYLES.find((x) => x.key === 'trail' && x.k === settings.trail) || STYLES[0])) settings.trail = 0;
    if (!unlocked(w, STYLES.find((x) => x.key === 'hat' && x.k === settings.hat) || STYLES[0])) settings.hat = 0;
    hud.settings({ scheme: settings.scheme, music: settings.music, sound: snd, trail: settings.trail, hat: settings.hat, styles });
  }

  if (!live && phoneish) {
    hud.phoneCard();
    return { destroy() { dead = true; liveGames--; root.remove(); audio.destroy(); } };
  }

  // ── players ──
  function mkPlayer(w) {
    const fly = [];
    for (let i = 0; i < 24; i++) fly.push({ on: false, x: 0, y: 0, z: 0, s: 1, t: 0, fx: 0, fy: 0, fz: 0 });
    return {
      w, name: api.name(w), local: !live || w === meW, r: null, bot: null, auto: false, av: null, rig: null, view: null,
      rs: { x: (w === 'a' ? -1 : 1) * LANE_W, y: 0, z: 0, ground: 0, speed: 0, air: false, vy: 0, roll: false, rollT: 0, stumble: 0, down: false, downT: 0, win: false, idle: true, invuln: false, shield: false, t: 0, visible: true, laneX: (w === 'a' ? -1 : 1) * LANE_W, bump: 0, boost: false },
      prev: { z: 0, x: 0, y: 0 }, net: emptyState(), weapon: null, weaponRoll: 0, shoveCD: 0, revive: null, downId: 0, downAt: 0, pushOff: 0,
      stats: { shoves: 0, slams: 0, inks: 0, hits: 0, revives: 0, dodges: 0 }, fly, hist: new Float64Array(HN * 7), histN: 0, histHead: 0,
      lastHorn: -1, outT: -1, lastGround: false, tut: 0, css: `var(--p-${w})`, hk: { gap: null, ban: 0 },
      // the partner's last in-match state, kept so a reloaded host can be handed its run back
      snap: { ok: 0, ep: 0, z: 0, l: 0, h: 0, c: 0, rt: 0, fn: -1, th: 0, tg: 0 },
    };
  }
  const players = { a: mkPlayer('a'), b: mkPlayer('b') };
  const locals = live ? [meW] : ['a', 'b'];
  const viewers = live ? [meW] : ['a', 'b'];

  // ── net ──
  const link = live ? createLink(api, { delay: 100 }) : null;
  const clock = live ? () => link.now() : () => performance.now();
  const pub = emptyState();
  const queue = []; // local message delivery (one device)
  let partnerHere = live ? !!api.partnerHere : true;
  if (live) {
    offs.push(api.onPartnerHere((h) => { partnerHere = !!h; }));
    offs.push(link.onPartnerNew((pid, was) => {
      if (!was) return;
      if (isHost) { if (M.phase === 'countdown' || M.phase === 'run' || M.phase === 'finale') sendRejoin(); return; }
      // The host re-mounted (reload, app restart): its clock starts over, so re-sync to it, but
      // keep this run. Once the new host is in its lobby, hand it the match and its own last
      // state (M.rejoin); both then resume with a 3-2-1. Run time is accumulated, not wall
      // clock, so only the timeline anchors need re-basing.
      link.resetNet();
      if (M.phase === 'countdown' || M.phase === 'run') {
        M.startAt = -Infinity; M.resumeAt = 0; M.lastNow = clock();
        if (!M.rejoin) M.rejoin = { sentAt: -1e9 };
      } else if (M.phase === 'finale') M.endAt = clock() + 600;
    }));
    offs.push(link.on('start', (d) => { if (!isHost) beginMatch(d.mode, d.seed, d.at, d.len, d.cap); }));
    offs.push(link.on('end', (d) => { if (!isHost && M.phase !== 'over') startFinale(d.res, d.at); }));
    offs.push(link.on('resume', (d) => { if (d && d.at > M.resumeAt && (M.phase === 'run' || M.phase === 'countdown')) M.resumeAt = d.at; }));
    offs.push(link.on('rejoin', (d) => { if (!d) return; if (!isHost && !d.fromGuest) applyRejoin(d); else if (isHost && d.fromGuest && (M.phase === 'lobby' || M.phase === 'loading')) applyRejoin(d); }));
    for (const t of RULE_MSGS) offs.push(link.on(t, (d, at) => { if (rules) rules.msg(t, d || {}, at, other(meW)); }));
  }

  // ── 3D ──
  let THREE = null; let renderer = null; let world = null; let fx = null; let P = null; let input = null; let overlay = null;
  let ready3D = false; let glLost = false; let raf = 0;
  // Dynamic resolution: start a notch under full (min(dpr, 2) × 0.85), step down quickly when
  // frames run long, recover slowly. Scale range 0.55–1.
  let W = 0; let H = 0; const baseDpr = Math.min(window.devicePixelRatio || 1, 2); let scale = 0.85;
  // Doubles written every frame live on one object: V8 boxes a fresh HeapNumber for every double
  // stored in a closure variable, while object fields are updated in place (JSC boxes neither).
  const K = { tAnim: 0.5, lastTs: 0.5, ewma: 16.7, lowFor: 0.5, checkT: 0.5, coolT: 0.5, hudT: 0.5, scoreT: 0.5, lastPub: -1e9, hitStop: 0.5, hitPend: 0.5, wind: 0.5, mile: 0.5 };
  K.tAnim = 0; K.lastTs = 0; K.lowFor = 0; K.checkT = 0; K.coolT = 0; K.hudT = 0; K.scoreT = 0; K.hitStop = 0; K.hitPend = 0; K.wind = 0;
  let frameN = 0;
  const perf = { dts: new Float32Array(600), work: new Float32Array(600), n: 0, calls: 0, tris: 0, maxCalls: 0, maxTris: 0, programs0: 0, scaleDowns: 0, scaleUps: 0 };
  let rules = null;
  const pal = { a: null, b: null, hl: null };
  const lobbyTrack = createTrack(1);
  const tmpV = { x: 0, y: 0, z: 0 };
  let vec3 = null;
  const shadowList = [[0, 0, 0, 1, 1], [0, 0, 0, 1, 1]];
  const zsBuf = new Float64Array(3); // view positions handed to world.ensure (no array regrowth per frame)
  const viewArg = { track: null, z: 0, r: null, time: 0, boxes: false, fly: null, front: false };

  async function load() {
    hud.loading(0.12, 'Loading the 3D engine…');
    try { THREE = await api.three(); } catch (e) {
      if (dead) return;
      hud.error('Check your connection, then try again. (' + ((e && e.message) || 'network error') + ')', () => { hud.ov.msg.classList.remove('on'); hud.ov.load.classList.add('on'); load(); });
      return;
    }
    if (dead) return;
    hud.loading(0.4, 'Building the city…');
    await new Promise((r) => setTimeout(r, 16));
    if (dead) return;
    try { init3D(); } catch (e) {
      console.error(e);
      hud.error('This device couldn’t start WebGL graphics. Try another browser, or restart the app.', null);
      return;
    }
    hud.loading(0.75, 'Warming up…');
    await new Promise((r) => setTimeout(r, 16));
    if (dead) return;
    warmUp();
    hud.loading(1, 'Ready');
    ready3D = true;
    loadMs = Math.round(performance.now() - mountT);
    toLobby();
    if (pendingRejoin) { const d = pendingRejoin; pendingRejoin = null; applyRejoin(d); }
    setTimeout(() => { if (!dead) hud.hideLoading(); }, 120);
    K.lastTs = 0;
    raf = requestAnimationFrame(frame);
  }

  function init3D() {
    P = makePalette(api.tokens());
    pal.a = P.a; pal.b = P.b; pal.hl = P.hl;
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false, depth: true });
    renderer.info.autoReset = false;
    renderer.autoClear = false; // the scene clears itself (it has a background); the overlay draws on top
    renderer.setPixelRatio(baseDpr * scale);
    renderer.setClearColor(new THREE.Color().fromArray(P.bg), 1);
    glWrap.appendChild(renderer.domElement);
    const cv = renderer.domElement;
    cv.addEventListener('webglcontextlost', onLost, false);
    cv.addEventListener('webglcontextrestored', onRestored, false);
    world = createWorld(THREE, P);
    fx = createFx(THREE, world);
    overlay = createOverlay(THREE, P);
    vec3 = new THREE.Vector3();
    for (const w of AB) {
      const p = players[w];
      p.av = createAvatar(THREE, world, P, w);
    }
    for (const w of viewers) players[w].rig = createRig(THREE);
    if (split) { players.a.view = hud.makeView('l', 'a'); players.b.view = hud.makeView('r', 'b'); }
    else players[meW].view = hud.makeView('full', meW);
    world.setGates([7]);
    resize();
    const ro = new ResizeObserver(() => resize());
    ro.observe(root);
    offs.push(() => ro.disconnect());
    input = createInput(touch, {
      who: meW || 'a', split,
      scheme: () => settings.scheme,
      enabled: () => !dead && !hud.ov.set.classList.contains('on'),
      onAction: (w, a) => onAction(w, a),
      onAny: () => audio.unlock(),
    });
  }

  function warmUp() {
    // Build the start chunks and compile + draw every material variant behind the loading screen,
    // so nothing compiles mid-run: world, instanced (plain / coloured), skinned runners with the
    // fade, the shield bubble, particles, blob shadows, gate banners, sky dome and the overlay.
    world.ensure(lobbyTrack, [0], 1, 9);
    const list = world.warmList().concat(fx.warm, players.a.av.warmList(), players.b.av.warmList());
    const saved = list.map((m) => (m && m.isInstancedMesh ? m.count : -1));
    const vis = list.map((m) => (m ? m.visible : false));
    list.forEach((m) => { if (m && m.isInstancedMesh) m.count = 1; if (m) m.visible = true; });
    world.fade.a.value = 0.5; world.fade.b.value = 0.5;
    for (const w of viewers) { const rg = players[w].rig; rg.update(0.016, 'lobby', players[w].rs, 0); }
    const cam = players[viewers[0]].rig.cam;
    try { renderer.compile(world.scene, cam); } catch (e) { console.warn(e); }
    renderer.setViewport(0, 0, W, H);
    try { renderer.render(world.scene, cam); overlay.warm(renderer); } catch (e) { console.warn(e); }
    list.forEach((m, i) => { if (m && m.isInstancedMesh) m.count = saved[i]; if (m) m.visible = vis[i]; });
    world.fade.a.value = 0; world.fade.b.value = 0;
    world.syncView({ track: lobbyTrack, z: 0, r: null, time: 0, front: true });
    perf.programs0 = renderer.info.programs ? renderer.info.programs.length : 0;
  }

  function resize() {
    if (!renderer) return;
    const r = root.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    renderer.setPixelRatio(baseDpr * scale);
    renderer.setSize(W, H, false);
    const vw = split ? W / 2 : W;
    const short = H < 560 && W > H;
    for (const w of viewers) { players[w].rig.resize(vw, H, short); if (players[w].view) players[w].view.resized(); }
    if (overlay) overlay.resize(vw, H);
    root.classList.toggle('rr-short', H < 560 && W > H);
    root.classList.toggle('rr-narrow', vw < 370);
  }

  function onLost(e) { e.preventDefault(); glLost = true; M.reasons.add('gl'); }
  function onRestored() {
    glLost = false;
    // three re-creates its GL state and re-uploads geometry/textures from the retained arrays.
    world.scene.traverse((o) => { const m = o.material; if (m && m.map) m.map.needsUpdate = true; if (m && m.gradientMap) m.gradientMap.needsUpdate = true; });
    world.reset();
    resize();
    M.reasons.delete('gl');
    if (M.phase === 'run' || M.phase === 'countdown') M.reasons.add('tap');
  }

  // ── lobby / match lifecycle ──
  function toLobby() {
    M.phase = 'lobby';
    resolveWear();
    root.classList.add('rr-in-lobby');
    M.track = null; M.result = null; M.ready = false; M.reasons.clear(); M.paused = false; M.resumeAt = 0; M.rejoin = null;
    players.a.snap.ok = 0; players.b.snap.ok = 0;
    for (const w of AB) {
      const p = players[w];
      p.r = null; p.bot = null; p.weapon = null; p.revive = null;
      p.rs.z = 0; p.rs.x = p.rs.laneX = (w === 'a' ? -1 : 1) * LANE_W; p.rs.y = 0; p.rs.idle = true; p.rs.down = false; p.rs.win = false; p.rs.visible = true;
      if (p.rig) p.rig.snap();
    }
    if (world) { world.reset(); world.setGates([7]); }
    hud.finale(null); hud.count(''); hud.pause(null); countK = -1; pauseK = -1;
    for (const w of viewers) players[w].view && players[w].view.banner(null);
    audio.stopMusic();
    api.setStatus(null);
  }

  function hostStart() {
    if (M.phase !== 'lobby' || !ready3D) return;
    if (live) {
      const ps = link.latest();
      if (!partnerHere || !ps || ps.ph !== PH.lobby || !ps.sy) { hudToast(`Waiting for ${api.name(other(meW))}…`); return; }
    }
    const mode = M.lobbyMode;
    const seed = mode === 'daily' ? dailySeed() : (dbg && dbg.seed) || ((Math.random() * 2147483646) | 0) + 1;
    const len = (dbg && dbg.raceLen) || RACE_LEN;
    const cap = (dbg && dbg.brawlCap) || BRAWL_CAP;
    const at = clock() + (live ? START_DELAY : 3000);
    if (live) link.send('start', { mode, seed, at, len, cap });
    beginMatch(mode, seed, at, len, cap);
  }

  function beginMatch(mode, seed, at, len, cap) {
    if (!ready3D) return;
    M.mode = MODES.includes(mode) ? mode : 'race';
    M.seed = seed; M.startAt = at; M.len = len || RACE_LEN; M.cap = cap || BRAWL_CAP;
    M.epoch = seed % 100000;
    M.track = createTrack(seed);
    M.phase = 'countdown';
    M.runMs = 0; M.steps = 0; M.lastNow = clock(); M.alpha = 0;
    M.paused = false; M.reasons.clear(); M.resumeAt = 0; M.result = null; M.endAt = 0;
    M.startedWall = 0; M.firstRunWall = 0; M.partnerFin = -1; M.partnerOut = -1; M.rejoin = null;
    for (const w of AB) {
      const p = players[w];
      p.outT = -1; p.lastHorn = -1; p.histN = 0; p.weapon = null; p.tut = 0; p.hk.gap = null; p.hk.ban = 0;
      for (const f of p.fly) f.on = false;
      if (p.local) {
        p.r = newRunner(w === 'a' ? -1 : 1);
        if (dbg && dbg.startZ) { p.r.z = p.r.zPrev = dbg.startZ; p.r.t = dbg.startT || 60; p.r.speed = 24; }
        p.bot = createBot(M.track);
        if (dbg && dbg.auto) p.auto = true;
      } else p.r = null;
      if (p.rig) p.rig.snap();
    }
    rules = createRules(G);
    rules.init();
    countK = -1; pauseK = -1;
    world.reset();
    world.setGates(M.mode === 'race' ? [7, M.len] : [7]);
    world.setMarks(bestMarks());
    fx.clear();
    for (const w of AB) { players[w].lastMile = 0; players[w].pb = { dist: 0, time: 0, theirs: 0 }; }
    resolveWear();
    hud.hideLobby(); hud.settings(null);
    root.classList.remove('rr-in-lobby');
    for (const w of viewers) {
      const v = players[w].view;
      v.weapon(null, M.mode === 'race');
      v.banner(null);
    }
    api.setStatus(`${MODE_LABEL[M.mode]} · ${M.mode === 'race' ? `first to ${(M.len / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} km` : M.mode === 'brawl' ? 'shove to win' : M.mode === 'daily' ? 'one track all day' : 'shared hearts'}`);
    audio.startMusic();
    audio.setIntensity(0);
    tutorial.start();
  }

  function sendRejoin() {
    // (link.latest() is already the re-mounted partner's lobby state here: use the last in-match snapshot)
    const s = players[other(meW)].snap;
    link.send('rejoin', {
      mode: M.mode, seed: M.seed, startAt: M.startAt, len: M.len, cap: M.cap, th: M.th, goal: M.goal, goalIdx: M.goalIdx,
      you: s.ok && s.ep === M.epoch ? { z: s.z, l: s.l, h: s.h, c: s.c, rt: s.rt, fn: s.fn } : null,
    });
  }
  let pendingRejoin = null;
  function applyRejoin(d) {
    if (!d) return;
    if (!ready3D) { pendingRejoin = d; return; }
    // fromGuest: I'm a reloaded host; my old timeline is gone, so the match has no start anchor
    beginMatch(d.mode, d.seed, d.fromGuest ? -Infinity : d.startAt, d.len, d.cap);
    if (d.th > 0) M.th = d.th;
    if (d.goal > 0) M.goal = d.goal;
    M.goalIdx = d.goalIdx || 0;
    const y = d.you;
    const r = players[meW].r;
    if (y && r) {
      r.z = r.zPrev = y.z; r.lane = r.laneFrom = Math.max(-1, Math.min(1, y.l | 0)); r.x = r.xFrom = r.lane * LANE_W;
      r.hearts = y.h; r.coins = y.c; r.t = y.rt; r.fin = y.fn; if (y.fn >= 0) { r.done = 1; r.invulnT = 1e9; }
      r.invulnT = Math.max(r.invulnT, 2);
      r.zPrev = r.z; r.speed = baseSpeed(r.t);
      const pp = players[meW].prev; pp.z = r.z; pp.x = r.x; pp.y = r.y; // draw it there from the first frame
      M.runMs = y.rt * 1000; M.steps = Math.floor(y.rt / DT);
    }
    M.phase = 'run';
    M.resumeAt = resumeSlot(clock());
    link.send('resume', { at: M.resumeAt });
  }

  function endMatch(res) {
    if (M.phase !== 'run') return;
    const at = clock() + FINALE_MS;
    if (live) link.send('end', { res, at });
    startFinale(res, at);
  }
  function startFinale(res, at) {
    M.result = res; M.endAt = at; M.phase = 'finale';
    const w = res.winner;
    const v = viewers.map((x) => players[x].view);
    const cls = res.team ? 'team' : w ? 'p' + w : '';
    const pbLine = recordBests(res);
    hud.finale(res.team ? res.text : w ? `${api.name(w)} wins!` : (res.daily ? 'Dead heat!' : 'Photo finish!'), cls, pbLine || (res.team ? res.sub : (live ? (w === meW ? 'You did it' : 'So close') : '')));
    audio.play('finish');
    audio.stopMusic();
    const tz = w ? players[w].rs : players[viewers[0]].rs;
    fx.confetti(tz.x, tz.ground, tz.z, w ? [P[w], P.hl, P.card] : [P.a, P.b, P.hl], 60);
    v.forEach((x) => x && x.banner(null));
  }
  function toOver() {
    M.phase = 'over';
    // the card gets this device's own bests line (the recorded result keeps the shared text)
    const res = Object.assign({}, M.result);
    if (M.pbText) res.sub = res.sub ? `${res.sub} · ${M.pbText}` : M.pbText;
    try { api.finish(res); } catch (e) { console.error(e); }
  }

  // ── bests, daily board, unlocks ──
  const day = () => dayKey();
  /** Lines on the track worth chasing: my best and my partner's best for this mode. */
  function bestMarks() {
    const d = data(); const out = [];
    if (M.mode !== 'race' && M.mode !== 'daily') return out;
    const keyOf = (w) => (M.mode === 'daily' ? `${w}_daily_m` : `${w}_race_m`);
    const me = meW || 'a'; const q = other(me);
    const mine = d[keyOf(me)] | 0; const theirs = d[keyOf(q)] | 0;
    if (theirs > 60) out.push({ z: theirs, text: `${api.name(q).toUpperCase()}’S BEST`, col: P[q] });
    if (mine > 60 && Math.abs(mine - theirs) > 3) out.push({ z: mine, text: split ? 'BEST' : 'YOUR BEST', col: P.hl });
    return out;
  }
  function recordBests(res) {
    const lines = [];
    const d = data(); const patch = {}; const pops = [];
    for (const w of locals) {
      const p = players[w]; const r = p.r;
      if (!r) continue;
      const dist = Math.round(r.z);
      const anyM = `${w}_any_m`; const modeM = `${w}_${M.mode}_m`;
      const newAny = dist > (d[anyM] | 0); const newMode = dist > (d[modeM] | 0);
      if (newAny) patch[anyM] = dist;
      if (newMode) patch[modeM] = dist;
      if (M.mode === 'daily') { const k = `${w}_daily_${day()}`; if (dist > (d[k] | 0)) patch[k] = dist; }
      if (M.mode === 'race' && r.fin >= 0) { const k = `${w}_race_t`; if (!d[k] || r.fin < d[k]) patch[k] = Math.round(r.fin * 100) / 100; }
      if (r.closeCalls > (d[`${w}_cc`] | 0)) patch[`${w}_cc`] = r.closeCalls;
      if (r.maxCombo > (d[`${w}_combo`] | 0)) patch[`${w}_combo`] = r.maxCombo;
      const won = res.winner === w;
      const wins = (d[`${w}_wins`] | 0) + (won ? 1 : 0);
      if (won) patch[`${w}_wins`] = wins;
      const revives = (d[`${w}_rev`] | 0) + (p.stats.revives | 0);
      if (p.stats.revives) patch[`${w}_rev`] = revives;
      patch[`${w}_runs`] = (d[`${w}_runs`] | 0) + 1;
      // unlocks
      const q = other(w);
      const S = { dist, closeCalls: r.closeCalls, maxCombo: r.maxCombo, coins: r.coins, wins, revives, beatDaily: M.mode === 'daily' && dist > (d[`${q}_daily_m`] | 0) && (d[`${q}_daily_m`] | 0) > 0 };
      for (const st of STYLES) {
        if (!st.test || unlocked(w, st) || patch[`unlock_${w}_${st.key}${st.k}`]) continue;
        if (st.test(S)) { patch[`unlock_${w}_${st.key}${st.k}`] = 1; pops.push([w, st]); }
      }
      if (p.view) {
        const prevMode = d[modeM] | 0;
        const theirs = d[`${q}_${M.mode}_m`] | 0;
        const bits = [];
        const who = split ? api.name(w) : 'You';
        if (M.mode === 'race' && r.fin >= 0) {
          const prevT = d[`${w}_race_t`];
          if (prevT && r.fin < prevT) { bits.push(`${who}: fastest yet (was ${fmtT(prevT)})`); p.view.pop('NEW BEST!', 'hl', fmtT(r.fin)); audio.play('good'); }
          else if (prevT) bits.push(`${who}: best ${fmtT(prevT)}`);
        } else if (M.mode === 'race' || M.mode === 'daily') {
          if (newMode && prevMode > 0) { bits.push(`${who}: new best ${fmtM(dist)} m`); p.view.pop('NEW BEST!', 'hl', `${fmtM(dist)} m`); audio.play('good'); }
          else if (M.mode === 'race') bits.push(`${who}: ${fmtM(dist)} m${prevMode ? ` · best ${fmtM(prevMode)} m` : ''}`);
          else if (prevMode) bits.push(`${who}: best ${fmtM(prevMode)} m`);
          if (theirs && (M.mode !== 'daily' || theirs !== Math.round(res.winner === q ? (q === 'a' ? res.za : res.zb) : -1))) bits.push(`${api.name(q)}’s best ${fmtM(theirs)} m`);
        }
        if (bits.length) lines.push(bits.join(' · '));
      }
    }
    if (Object.keys(patch).length) setData(patch);
    const text = lines.join(' · ');
    M.pbText = text;
    pops.forEach(([w, st], i) => { const t = setTimeout(() => { if (dead) return; const v = players[w].view; if (v) v.pop('UNLOCKED', 'hl', `${st.name} ${st.key}`); audio.play('unlock'); }, 900 + i * 1100); timers.push(t); });
    return text;
  }
  /** Today's Daily board for the lobby row. */
  function dailyText() {
    const d = data(); const k = day();
    const za = d[`a_daily_${k}`] | 0; const zb = d[`b_daily_${k}`] | 0;
    if (!za && !zb) return '';
    const cell = (w, z) => `<span class="p-${w}">${esc(api.name(w))} ${z ? fmtM(z) + ' m' : '—'}</span>`;
    return `Today: ${cell('a', za)} · ${cell('b', zb)}${za && zb ? (za === zb ? ' · tied' : ` · ${esc(api.name(za > zb ? 'a' : 'b'))} leads`) : ''}`;
  }

  // ── input ──
  function onAction(w, a) {
    audio.unlock();
    if (M.phase !== 'run' && M.phase !== 'countdown') return;
    const p = players[w];
    if (!p || !p.local || !p.r) return;
    if (a === A_USE) { useWeapon(w); return; }
    if (M.phase !== 'run' || isPaused(clock())) return;
    if (a === A_LEFT || a === A_RIGHT) rules.onLane(p, a === A_LEFT ? -1 : 1);
    act(p.r, a);
    tutorial.did(p, a);
  }
  function useWeapon(w) {
    const p = players[w];
    if (!p || !p.local || !rules || M.phase !== 'run' || isPaused(clock())) return;
    if (rules.use(p)) players[w].view && players[w].view.weapon(null, true);
  }

  // ── G: what the rules see ──
  const histOut = { z: 0, x: 0, lane: 0, y: 0, g: 0 };
  const jv = { a: { z: 0, rt: 0, fin: -1, out: -1, h: 0, c: 0, shoves: 0 }, b: { z: 0, rt: 0, fin: -1, out: -1, h: 0, c: 0, shoves: 0 } };
  const G = {
    M, players,
    get track() { return M.track; },
    now: () => clock(),
    rs: (p) => p.rs,
    view: (w) => players[w].view,
    name: (w) => api.name(w),
    get pal() { return pal; },
    get fx() { return fx; },
    audio,
    send(to, type, data) {
      if (players[to].local) queue.push([type, data, clock(), other(to)]);
      else link.send(type, data);
    },
    isJudge: () => !live || isHost,
    splat(victim, from) {
      const v = players[victim].view;
      if (v) v.splat(`var(--p-${from})`, 2000);
      const r = players[victim].r;
      if (r) fx.ink(r.x, r.y + 1.5, r.z + 1, P[from], 10);
      audio.play('splat');
      shake(victim, 0.35);
    },
    projectile(from, to, kind) { launch(from, to, kind); },
    shake: (w, a) => shake(w, a),
    kick: (w, a) => { const rg = players[w].rig; if (rg) rg.kick(a); },
    history(w, at) {
      const p = players[w];
      const r = p.r;
      histOut.z = r.z; histOut.x = r.x; histOut.lane = r.lane; histOut.y = r.y; histOut.g = Math.max(0, r.sup);
      if (!live) return histOut;
      let best = -1;
      for (let k = 0; k < p.histN; k++) {
        const i = (p.histHead - 1 - k + HN) % HN;
        if (p.hist[i * 7] <= at) { best = i; break; }
      }
      if (best >= 0) { const o = best * 7; histOut.z = p.hist[o + 1]; histOut.x = p.hist[o + 2]; histOut.lane = p.hist[o + 3]; histOut.y = p.hist[o + 4]; histOut.g = p.hist[o + 5]; }
      return histOut;
    },
    remoteAt(w, at) { if (!live || players[w].local) return null; try { return link.remoteAtTime(at); } catch { return null; } },
    coins(w) { const p = players[w]; return p.local ? (p.r ? p.r.coins : 0) : p.net.c; },
    judgeView(w) {
      const p = players[w]; const o = jv[w];
      if (p.local) {
        const r = p.r; if (!r) return null;
        o.z = r.z; o.rt = r.t; o.fin = r.fin; o.out = p.outT; o.h = r.hearts; o.c = r.coins; o.shoves = p.stats.shoves;
        return o;
      }
      const s = link.latest();
      if (!s || s.ep !== M.epoch || (s.ph !== PH.run && s.ph !== PH.countdown)) return null;
      o.z = s.z; o.rt = s.rt; o.fin = s.fn >= 0 ? s.fn : M.partnerFin; o.h = s.h; o.c = s.c; o.shoves = s.sv;
      o.out = M.partnerOut >= 0 ? M.partnerOut : (s.f & F_OUT ? s.rt : -1);
      return o;
    },
    teamGoalReached() {
      for (const w of viewers) players[w].view && players[w].view.pop('+1 heart', 'good', 'coin goal reached');
      audio.play('heart');
    },
  };

  function shake(w, a) { const rg = players[w] && players[w].rig; if (rg) rg.shake(reducedMotion ? a * 0.25 : a); }

  // projectiles (ink / zap visuals)
  const shots = [];
  for (let i = 0; i < 6; i++) shots.push({ on: false, t: 0, from: 'a', to: null, kind: 'ink', x: 0, y: 0, z: 0 });
  function launch(from, to, kind) {
    const s = shots.find((x) => !x.on) || shots[0];
    s.on = true; s.t = 0; s.from = from; s.to = to; s.kind = kind;
    const fr = players[from].rs;
    s.x = fr.x; s.y = fr.y + 1.6; s.z = fr.z;
  }
  function updateShots(dt) {
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      if (!s.on) continue;
      s.t += dt;
      const dur = s.kind === 'zap' ? 0.25 : 0.55;
      const u = Math.min(1, s.t / dur);
      let tx; let ty; let tz;
      if (s.to) { const t = players[s.to].rs; tx = t.x; ty = t.y + 1.5; tz = t.z; } else { tx = s.x; ty = 0.3; tz = s.z + 20; }
      const x = s.x + (tx - s.x) * u; const z = s.z + (tz - s.z) * u; const y = s.y + (ty - s.y) * u + Math.sin(u * Math.PI) * (s.kind === 'zap' ? 0 : 4);
      if (s.kind === 'ink') fx.ink(x, y, z, P[s.from], 1);
      else fx.burst(x, y, z, P.hl, 2, 1.5);
      if (u >= 1) { s.on = false; if (s.kind === 'ink') fx.ink(tx, ty, tz, P[s.from], 8); else fx.burst(tx, ty + 0.5, tz, P.hl, 12, 5); }
    }
  }

  // ── tutorial (first run, once) ──
  // Contextual: "switch lanes" from the countdown until you do (the coins pull you to the middle),
  // then "jump" as the warm-up barrier row comes up and "roll" before the bar row, each turning
  // hot when it's time to act. The warm-up rows are soft, so a miss is a stumble, not a crash.
  const tutorial = {
    on: false, did0: false,
    start() {
      this.on = !split && !lsGet(TKEY, false) && !(dbg && dbg.noTutorial);
      this.did0 = false;
      hud.tutorial(-1);
    },
    did(p, a) {
      if (!this.on || p.w !== (meW || 'a')) return;
      if (a === A_LEFT || a === A_RIGHT) this.did0 = true;
    },
    update() {
      if (!this.on) return;
      if (M.phase !== 'run' && M.phase !== 'countdown') { hud.tutorial(-1); return; }
      const r = players[meW || 'a'].r;
      if (!r) return;
      const z = r.z;
      if (z >= TUT_ROLL + 1) { this.on = false; lsSet(TKEY, true); hud.tutorial(-1); return; }
      let step = -1; let hot = false;
      if (z >= TUT_ROLL - 24) { step = 2; hot = z >= TUT_ROLL - 9; }
      else if (z >= TUT_JUMP + 1) step = -1;
      else if (z >= TUT_JUMP - 24) { step = 1; hot = z >= TUT_JUMP - 12; }
      else if (!this.did0) step = 0;
      if (step < 0) { hud.tutorial(-1); return; }
      const caps = !coarse ? TUT_KEYS : settings.scheme === 'buttons' ? TUT_BTNS : TUT_SWIPE;
      const dir = !coarse || settings.scheme === 'buttons' ? '' : step === 0 ? (Math.floor(K.tAnim / 1.2) % 2 ? 'r' : 'l') : step === 1 ? 'u' : 'd';
      hud.tutorial(step, 3, dir, caps[step], hot);
    },
  };

  // ── pause / resume ──
  function isPaused(now) { return M.paused || now < M.resumeAt; }
  // Resume moments snap to a 400 ms grid on the shared clock: two phones whose pauses clear a
  // moment apart pick the very same instant without waiting for each other's message (which
  // still settles the rare case of straddling a grid line: both take the later one).
  const resumeSlot = (now) => Math.ceil((now + RESUME_DELAY) / 400) * 400;
  function pauseCode() {
    for (let i = 0; i < PZ_ORDER.length; i++) if (M.reasons.has(PZ_ORDER[i])) return PZ[PZ_ORDER[i]];
    return 0;
  }
  function netLogic(now) {
    if (!live) return;
    const inMatch = M.phase === 'countdown' || M.phase === 'run';
    const ps = link.latest();
    if (ps && inMatch && ps.ep === M.epoch && ps.ph === PH.run) {
      // remember the partner's last in-match state (used if they re-mount as host)
      const sn = players[other(meW)].snap;
      sn.ok = 1; sn.ep = ps.ep; sn.z = ps.z; sn.l = ps.l; sn.h = ps.h; sn.c = ps.c; sn.rt = ps.rt; sn.fn = ps.fn; sn.th = ps.th; sn.tg = ps.tg;
      if (M.rejoin) M.rejoin = null; // the host has the match back
    }
    if (M.rejoin && inMatch && link.synced && ps && link.age() < 1600 && ps.ph === PH.lobby && ps.sy && now - M.rejoin.sentAt > 2500) {
      M.rejoin.sentAt = now;
      const sn = players[other(meW)].snap;
      link.send('rejoin', {
        fromGuest: 1, mode: M.mode, seed: M.seed, len: M.len, cap: M.cap, th: sn.th, goal: sn.tg, goalIdx: M.goalIdx,
        you: sn.ok && sn.ep === M.epoch ? { z: sn.z, l: sn.l, h: sn.h, c: sn.c, rt: sn.rt, fn: sn.fn } : null,
      });
    }
    // observed reasons
    if (inMatch) {
      if (!partnerHere) M.reasons.add('gone'); else M.reasons.delete('gone');
      if (partnerHere && link.age() > 1600) M.reasons.add('stale'); else M.reasons.delete('stale');
      const pin = ps && (ps.ph === PH.countdown || ps.ph === PH.run || ps.ph === PH.finale) && ps.ep === M.epoch;
      if (now > M.startAt + 1500 && partnerHere && link.age() < 1600 && !pin) M.reasons.add('sync'); else M.reasons.delete('sync');
    }
    M.partnerPz = ps && partnerHere && link.age() < 1600 && ps.ep === M.epoch ? ps.pz : 0;
  }
  function pauseLogic(now) {
    if (M.phase !== 'run' && M.phase !== 'countdown') { M.paused = false; return; }
    if (document.hidden) M.reasons.add('hidden'); else M.reasons.delete('hidden');
    const was = M.paused;
    M.paused = M.reasons.size > 0 || (live && M.partnerPz > 0);
    if (M.paused) M.resumeAt = 0;
    else if (was) {
      // If the partner already scheduled the resume (their pause ended first, which is usually
      // why mine just did), join their countdown rather than proposing a later one.
      const ps = live ? link.latest() : null;
      const theirs = ps && ps.ep === M.epoch && ps.pz === 0 && ps.ra > now + 1200 && ps.ra < now + RESUME_DELAY + 1500 ? ps.ra : 0;
      M.resumeAt = Math.max(M.resumeAt, theirs || resumeSlot(now));
      if (live) link.send('resume', { at: M.resumeAt });
    }
    if (live && !M.paused) {
      const ps = link.latest();
      if (ps && ps.ra > M.resumeAt && ps.ra > now && ps.ra < now + RESUME_DELAY + 1500 && ps.ep === M.epoch) M.resumeAt = ps.ra;
    }
  }
  function onVis() {
    if (document.hidden) {
      M.reasons.add('hidden');
      if (M.phase === 'run' || M.phase === 'countdown') { M.paused = true; M.resumeAt = 0; }
      audio.suspend();
      if (live && ready3D) { pub.pz = PZ.hidden; try { link.publish(pub); } catch { /* ignore */ } }
    } else {
      M.reasons.delete('hidden');
      audio.resume();
      K.lastTs = 0;
    }
  }
  document.addEventListener('visibilitychange', onVis);
  offs.push(() => document.removeEventListener('visibilitychange', onVis));

  // ── simulation ──
  function advance(now) {
    const running = M.phase === 'run' && !isPaused(now);
    if (running) {
      const from = Math.max(M.lastNow, M.startAt, M.resumeAt);
      if (now > from) M.runMs += Math.min(now - from, 250);
    }
    M.lastNow = now;
    const target = Math.floor(M.runMs / (DT * 1000));
    let n = 0;
    while (M.steps < target && n < 40) { stepAll(); M.steps++; n++; }
    if (M.steps < target) M.runMs = M.steps * DT * 1000;
    M.alpha = clamp((M.runMs - M.steps * DT * 1000) / (DT * 1000), 0, 1);
  }
  function stepAll() {
    for (let li = 0; li < locals.length; li++) {
      const p = players[locals[li]];
      const r = p.r;
      if (!r) continue;
      p.prev.z = r.z; p.prev.x = r.x; p.prev.y = r.y;
      if (p.auto && M.steps % p.bot.every === 0 && !r.down) {
        let goal = null;
        for (const tk of r.tokens) if (tk.alive && tk.z > r.z && tk.z - r.z < 70) goal = Math.round(tk.x / LANE_W);
        const a = p.bot.decide(r, goal);
        if (a) { if (a === A_LEFT || a === A_RIGHT) rules.onLane(p, a === A_LEFT ? -1 : 1); act(r, a); }
      }
      step(r, M.track, false);
      drain(p);
    }
  }

  function coinAt(key) {
    const c = M.track.chunk(Math.floor(key / 1000));
    const i = key % 1000;
    return i >= 500 ? c.items[i - 500] : c.coins[i];
  }
  function drain(p) {
    const r = p.r;
    const v = p.view;
    const mine = !!v;
    for (let i = 0; i < r.evN; i++) {
      const t = r.evT[i]; const val = r.evV[i];
      switch (t) {
        case E_JUMP: if (mine) audio.play('jump', val); fx.dust(r.x, r.y, r.z, 3, 0.6); break;
        case E_LAND: if (val > 4) { fx.dust(r.x, r.y, r.z, val > 12 ? 8 : 4, Math.min(1.4, val / 12)); if (mine) audio.play('land', val / 14); if (val > 16) shake(p.w, 0.12); } break;
        case E_ROLL: if (mine) audio.play('roll'); fx.dust(r.x, r.y, r.z, 5, 0.8); break;
        case E_LANE: if (mine) audio.play('whoosh', val); break;
        case E_BUMP: if (mine) audio.play('bump'); shake(p.w, 0.08); break;
        case E_COIN: {
          const cn = coinAt(val);
          if (cn) {
            if (r.magnetT > 0 && Math.abs(cn.z - r.z) > 1.2) {
              const f = p.fly.find((x) => !x.on);
              if (f) { f.on = true; f.t = 0; f.fx = cn.x; f.fy = cn.y; f.fz = cn.z; f.x = cn.x; f.y = cn.y; f.z = cn.z; f.s = 1; }
            } else fx.coin(cn.x, cn.y, cn.z);
          }
          if (mine) audio.play('coin');
          break;
        }
        case E_PICK: {
          const k = Math.floor(val / 100000);
          const it = coinAt(val % 100000);
          if (it) fx.burst(it.x, it.y, it.z, P.hl, 12, 5);
          if (mine && k !== 4) { audio.play('pickup'); v.pop(k === 1 ? 'MAGNET' : k === 2 ? 'SUPER SNEAKERS' : 'SHIELD', 'hl'); }
          break;
        }
        case E_STUMBLE: if (mine) { api.haptic(15); audio.play('stumble'); if (Math.random() < 0.4) v.pop('Oof', 'bad'); } shake(p.w, 0.28); fx.dust(r.x, r.y, r.z, 5, 1); break;
        case E_CLIP: if (mine) { api.haptic(20); audio.play('clip'); v.pop('Clipped it!', 'bad', 'swipe a touch earlier'); } shake(p.w, 0.35); fx.dust(r.x, r.y, r.z, 6, 1.1); fx.burst(r.x, r.y + 1, r.z, P.hl, 5, 3); break;
        case E_BONUS: if (mine) { audio.play('bonus', val); v.pop(`+${val}`, 'hl', 'combo bonus'); } fx.burst(r.x, r.y + 1.4, r.z, P.hl, 10, 4); break;
        case E_CRASH:
          if (mine) { api.haptic(45); audio.play('crash'); audio.duck(1400); v.flash(); v.pop(val === 2 ? 'FELL!' : val === 3 ? 'SLAMMED!' : 'CRASH!', 'bad'); }
          shake(p.w, 0.7);
          if (mine && !reducedMotion) { K.hitPend = HIT_STOP; const rg = p.rig; if (rg) rg.punch(0.7); }
          fx.crash(r.x, r.y, r.z);
          fx.stars(r.x, r.y + 2.0, r.z, 3, 1.5);
          if (r.out && p.outT < 0) p.outT = r.t;
          break;
        case E_RESPAWN: fx.dust(r.x, 0, r.z, 8, 1.2); fx.burst(r.x, r.y + 1, r.z, P.hl, 8, 3); if (mine) { audio.play('respawn'); const rg = p.rig; if (rg) rg.kick(0.5); } break;
        case E_SHIELD: fx.burst(r.x, r.y + 1.1, r.z, P.hl, 16, 6); if (mine) { audio.play('shield'); v.pop('Shield saved you', 'hl'); } shake(p.w, 0.3); break;
        case E_CLOSE: fx.sparkle(r.x, r.y, r.z, val * LANE_W > r.x ? 1 : -1); if (mine) { audio.play('close'); v.pop('Close call!', 'hl', '+2'); api.haptic(8); const rg = p.rig; if (rg) rg.kick(0.25); } break;
        case E_COMBO: if (mine) { audio.play('combo', val); v.combo(val, COMBO_WORDS[Math.min(val, COMBO_WORDS.length - 1)]); } break;
        case E_SMASH: fx.burst(r.x, r.y + 0.6, r.z + 0.6, P.hl, 14, 7); if (mine) audio.play('smash'); shake(p.w, 0.15); break;
        default: break;
      }
      if (t === E_PICK || t === E_CRASH || t === E_FINISH || t === E_TOKEN || t === E_BLOCK) rules.onEvent(p, t, val);
    }
    r.evN = 0;
  }

  function deliver() {
    while (queue.length) {
      const [type, data, at, from] = queue.shift();
      rules.msg(type, data || {}, at, from);
    }
  }

  // ── render states ──
  function updateLocalRS(p, now, dt) {
    const r = p.r; const s = p.rs;
    const a = M.alpha;
    s.z = p.prev.z + (r.z - p.prev.z) * a;
    s.x = p.prev.x + (r.x - p.prev.x) * a;
    s.y = p.prev.y + (r.y - p.prev.y) * a;
    if (M.steps === 0) { s.z = r.z; s.x = r.x; s.y = r.y; }
    s.ground = r.sup > -50 ? r.sup : Math.min(0, s.y);
    s.speed = M.phase === 'run' ? r.speed : 0;
    s.air = !r.grounded && !r.down;
    s.vy = r.vy;
    s.roll = r.slideT > 0;
    s.rollT = 1 - r.slideT / SLIDE_TIME;
    s.stumble = r.stumbleT / STUMBLE_T;
    s.down = !!r.down; s.downT = r.downT;
    s.invuln = r.invulnT > 0 && r.invulnT < 100;
    s.shield = !!r.shield;
    s.laneX = r.lane * LANE_W;
    s.bump = r.bumpT;
    s.boost = r.boostT > 0;
    s.idle = M.phase === 'countdown' || (M.phase === 'run' && M.steps === 0);
    s.win = M.phase === 'finale' || M.phase === 'over' ? (M.result && (M.result.winner === p.w || M.result.team)) : false;
    if (s.win) s.idle = false;
    s.visible = true;
    // lag-compensation history
    if (live && M.phase === 'run') {
      const o = p.histHead * 7;
      p.hist[o] = now; p.hist[o + 1] = r.z; p.hist[o + 2] = r.x; p.hist[o + 3] = r.lane; p.hist[o + 4] = r.y; p.hist[o + 5] = Math.max(0, r.sup); p.hist[o + 6] = r.invulnT;
      p.histHead = (p.histHead + 1) % HN; p.histN = Math.min(HN, p.histN + 1);
    }
    void dt;
  }
  function updateRemoteRS(p, now) {
    const n = p.net; const s = p.rs;
    const have = link.sample(n, now - link.delay);
    const inMatch = have && n.ep === M.epoch && (n.ph === PH.run || n.ph === PH.countdown || n.ph === PH.finale || n.ph === PH.over) && (M.phase !== 'lobby');
    if (!inMatch) {
      s.z = 0; s.x = s.laneX = (p.w === 'a' ? -1 : 1) * LANE_W; s.y = 0; s.ground = 0; s.idle = true; s.down = false; s.air = false; s.roll = false; s.stumble = 0; s.speed = 0; s.win = false; s.shield = false; s.invuln = false;
      return;
    }
    const f = n.f;
    s.z = n.z + ((f & F_RUN) ? n.sp * link.delay / 1000 : 0);
    s.x = n.x + p.pushOff; s.y = n.y; s.ground = n.g > -50 ? n.g : 0; s.speed = n.sp; s.vy = n.vy;
    s.air = !!(f & F_AIR); s.roll = !!(f & F_ROLL); s.rollT = n.rp; s.stumble = n.st; s.down = !!(f & F_DOWN); s.downT = n.dt;
    s.invuln = !!(f & F_INV); s.shield = !!(f & F_SHIELD); s.laneX = n.l * LANE_W; s.bump = 0; s.boost = !!(f & F_BOOST);
    s.idle = n.ph === PH.countdown || (!(f & F_RUN) && n.ph === PH.run && n.rt === 0);
    s.win = (M.phase === 'finale' || M.phase === 'over') && M.result && (M.result.winner === p.w || M.result.team);
    if (s.win) s.idle = false;
    s.visible = true;
  }
  function updateIdleRS(p) {
    const s = p.rs;
    s.z = 0; s.x = s.laneX = (p.w === 'a' ? -1 : 1) * LANE_W; s.y = 0; s.ground = 0; s.idle = true; s.down = false; s.air = false; s.roll = false; s.stumble = 0; s.speed = 0; s.win = false; s.shield = false; s.invuln = false; s.visible = true;
  }

  function flagsOf(r) {
    let f = 0;
    if (!r.grounded && !r.down) f |= F_AIR;
    if (r.slideT > 0) f |= F_ROLL;
    if (r.down) f |= F_DOWN;
    if (r.invulnT > 0 && r.invulnT < 100) f |= F_INV;
    if (r.shield) f |= F_SHIELD;
    if (r.done) f |= F_DONE;
    if (M.phase === 'run' && !isPaused(clock()) && !r.down) f |= F_RUN;
    if (r.out) f |= F_OUT;
    if (r.boostT > 0) f |= F_BOOST;
    if (r.magnetT > 0) f |= F_MAGNET;
    if (r.sneakersT > 0) f |= F_SNEAK;
    return f;
  }
  function publish() {
    const p = players[meW]; const r = p.r;
    pub.ph = PH[M.phase]; pub.md = MODES.indexOf(M.lobbyMode); pub.sy = link.synced ? 1 : 0; pub.rd = M.ready ? 1 : 0;
    pub.pz = pauseCode(); pub.ra = M.resumeAt; pub.th = M.th; pub.tg = M.goal; pub.ep = M.epoch;
    if (r && M.phase !== 'lobby') {
      pub.z = r.z; pub.x = r.x; pub.y = r.y; pub.g = r.sup > -50 ? r.sup : -3; pub.vy = r.vy; pub.sp = r.speed;
      pub.st = r.stumbleT / STUMBLE_T; pub.dt = r.down ? r.downT : 0; pub.rt = r.t; pub.rp = r.slideT > 0 ? 1 - r.slideT / SLIDE_TIME : 0;
      pub.l = r.lane; pub.f = flagsOf(r); pub.h = r.hearts; pub.c = r.coins; pub.fn = r.fin; pub.w = WEAPON_IDX.indexOf(p.weapon); pub.sv = p.stats.shoves; pub.cb = r.combo;
      pub.tr = wear[meW].tr; pub.ht = wear[meW].ht;
    } else {
      pub.z = 0; pub.x = (meW === 'a' ? -1 : 1) * LANE_W; pub.y = 0; pub.g = 0; pub.vy = 0; pub.sp = 0; pub.st = 0; pub.dt = 0; pub.rt = 0; pub.rp = 0;
      pub.l = meW === 'a' ? -1 : 1; pub.f = 0; pub.h = HEARTS; pub.c = 0; pub.fn = -1; pub.w = 0; pub.sv = 0; pub.cb = 0;
      pub.tr = wear[meW].tr; pub.ht = wear[meW].ht;
    }
    link.publish(pub);
  }

  // ── frame ──
  let trimN = 0;
  function frame(ts) {
    if (dead) return;
    raf = requestAnimationFrame(frame);
    const dtMs = K.lastTs ? Math.min(250, ts - K.lastTs) : 16.7;
    K.lastTs = ts;
    const dt = dtMs / 1000;
    const w0 = performance.now();
    const now = clock();
    // hit-stop: the picture holds on the impact frame (the sim keeps its clock; only the drawing freezes)
    const frozen = K.hitStop > 0;
    if (frozen) K.hitStop -= dt;
    if (!frozen) K.tAnim += dt;
    frameN++;
    if (M.phase === 'over' && (perf.n % 6) !== 0) { perf.n++; return; } // idle behind the end card
    logic(now, dt, frozen);
    if (!glLost) { render(frozen ? 0 : dt, now); if (!frozen) updateTag(); }
    if (K.hitPend > 0) { K.hitStop = K.hitPend; K.hitPend = 0; }
    track(dtMs, performance.now() - w0);
  }

  function logic(now, dt, frozen) {
    if (live) { netLogic(now); link.setFastSync(M.phase === 'countdown' || ((M.phase === 'run') && (M.paused || now < M.resumeAt + 500)) || M.rejoin ? 2 : M.phase === 'run' ? 0 : 1); }
    pauseLogic(now);
    if (M.phase === 'lobby') lobbyUI();
    else if (M.phase === 'countdown') {
      if (now >= M.startAt && !isPaused(now)) {
        M.phase = 'run';
        M.startedWall = Date.now() - (now - M.startAt);
        M.firstRunWall = Date.now();
      }
    }
    if (M.phase === 'run') {
      advance(now);
      if (++trimN % 90 === 0 && M.track) { // keep the chunk cache small on long runs
        let zmin = Infinity;
        for (let i = 0; i < AB.length; i++) { const z = players[AB[i]].rs.z; if (z < zmin) zmin = z; }
        if (zmin < Infinity) M.track.keepFrom(Math.floor((zmin - 40) / CHUNK) - 1);
      }
      rules.tick(now, dt);
      deliver();
      const res = rules.verdict();
      if (res) endMatch(res);
    } else if (M.phase === 'countdown') M.lastNow = now;
    else if (M.phase === 'finale') { if (rules) rules.tick(now, dt); if (now >= M.endAt) toOver(); }
    if (frozen) { if (live && ready3D) publish(); return; }
    // render states
    for (let i = 0; i < 2; i++) {
      const p = players[AB[i]];
      if (p.local && p.r) updateLocalRS(p, now, dt);
      else if (!p.local && live && M.phase !== 'lobby') updateRemoteRS(p, now);
      else updateIdleRS(p);
    }
    // magnet flyers
    for (let li = 0; li < locals.length; li++) {
      const p = players[locals[li]];
      for (let fi = 0; fi < p.fly.length; fi++) {
        const f = p.fly[fi];
        if (!f.on) continue;
        f.t += dt / 0.22;
        const u = Math.min(1, f.t);
        const tgt = p.rs;
        f.x = f.fx + (tgt.x - f.fx) * u; f.y = f.fy + (tgt.y + 1.1 - f.fy) * u + Math.sin(u * Math.PI) * 0.6; f.z = f.fz + (tgt.z + 0.4 - f.fz) * u;
        f.s = 1 - u * 0.5;
        fx.trail(f.x, f.y, f.z);
        if (u >= 1) { f.on = false; fx.coin(f.x, f.y, f.z); }
      }
    }
    updateShots(dt);
    // worn style: trails behind running runners, hats on heads (the partner's come over the wire)
    for (let i = 0; i < 2; i++) {
      const p = players[AB[i]];
      const tr = p.local ? wear[AB[i]].tr : p.net.tr;
      const ht = p.local ? wear[AB[i]].ht : p.net.ht;
      if (p.av) p.av.setHat(ht);
      if (tr && M.phase === 'run' && p.rs.speed > 6 && !p.rs.down && p.rs.visible) fx.trailFx(tr, p.rs.x, p.rs.y, p.rs.z, P[AB[i]], frameN);
      // distance milestones every 500 m
      if (p.local && p.view && p.r && M.phase === 'run') {
        const mile = Math.floor(p.r.z / 500);
        if (mile > p.lastMile) { p.lastMile = mile; if (mile >= 1) { p.view.pop(`${fmtM(mile * 500)} m`, 'hl', mile * 500 === 1000 ? '1 km!' : ''); audio.play('good'); } }
      }
    }
    tutorial.update();
    K.hudT += dt;
    updateHud(now, dt);
    // presence: 20/s in a match (net.js throttles), 10/s in the lobby where nothing moves
    if (live && ready3D && (M.phase !== 'lobby' || now - K.lastPub >= 95)) { K.lastPub = now; publish(); }
    if (M.phase === 'run') {
      K.scoreT += dt;
      if (K.scoreT > 0.5) {
        K.scoreT = 0;
        const z = (w) => Math.round(players[w].rs.z);
        api.setScore({ a: z('a') + ' m', b: z('b') + ' m' });
      }
    }
  }

  // ── HUD ──
  function updateHud(now, dt) {
    const paused = isPaused(now);
    // countdowns: a numeric code per state, so the DOM (and the beep) only changes on a change
    let ck = 0;
    if (M.phase === 'countdown' && !M.paused) {
      const sec = Math.ceil((Math.max(M.startAt, M.resumeAt) - now) / 1000);
      ck = sec > 0 ? 10 + Math.min(4, sec) : 19;
    } else if (M.phase === 'run' && !M.paused && now < M.resumeAt) ck = 20 + clamp(Math.ceil((M.resumeAt - now) / 1000), 1, 3);
    else if (M.phase === 'run' && !paused && M.steps < 70 && M.runMs < 700) ck = 30;
    if (ck !== countK) {
      countK = ck;
      if (ck >= 11 && ck <= 14) { hud.count(DIGITS[Math.min(3, ck - 10)], M.mode ? MODE_LABEL[M.mode] : ''); if (ck <= 13) audio.play('tick'); }
      else if (ck >= 21 && ck <= 23) { hud.count(DIGITS[ck - 20], 'Get ready'); audio.play('tick'); }
      else if (ck === 30) { hud.count('RUN!'); audio.play('go'); }
      else hud.count('');
    }
    // pause card (built only when what it says changes)
    let pk = 0;
    if ((M.phase === 'run' || M.phase === 'countdown') && M.paused) {
      const R = M.reasons;
      pk = R.has('gl') ? 1 : R.has('tap') ? 2 : R.has('menu') ? 3 : R.has('gone') ? 4 : R.has('stale') ? 5 : R.has('sync') ? 6 : M.partnerPz ? 10 + M.partnerPz : 9;
    }
    audio.setPaused(pk > 0);
    if (pk !== pauseK) {
      pauseK = pk;
      const pn = live ? api.name(other(meW)) : '';
      let info = null;
      if (pk === 1) info = { title: 'Graphics hiccup', text: 'Your phone reset the 3D view. One moment…' };
      else if (pk === 2) info = { title: 'Back in a sec', text: 'Tap to pick up where you left off.', resume: true, resumeLabel: 'Tap to resume' };
      else if (pk === 3) info = { title: 'Paused', text: live ? `${pn} is paused too.` : '', resume: true };
      else if (pk === 4) info = { title: `Waiting for ${pn}`, text: `${pn} left the game. The run picks up where you left off when they’re back.`, invite: true };
      else if (pk === 5) info = { title: `Waiting for ${pn}`, text: 'Their connection dropped. The run picks up where you left off when they’re back.' };
      else if (pk === 6) info = { title: `Getting ${pn} back in`, text: 'Syncing the run…' };
      else if (pk > 10) { const z = pk - 10; info = { title: `${pn} paused`, text: z === PZ.hidden ? `${pn} switched apps. Hang tight.` : z === PZ.menu ? 'They’ll be right back.' : z >= PZ.gone ? 'Reconnecting…' : 'One moment…' }; }
      else if (pk === 9) info = { title: 'Paused', text: '' };
      hud.pause(info);
    }
    if (M.phase === 'lobby' || M.phase === 'loading') return;

    // per view
    let sp = 0;
    for (let i = 0; i < viewers.length; i++) { const rs = players[viewers[i]].rs; if (rs.speed > sp) sp = rs.speed; }
    audio.setIntensity(clamp((sp - 12) / 16, 0, 1));
    audio.setWind(M.phase === 'run' && !paused ? clamp((sp - 8) / 22, 0, 1) : 0);
    for (let vi = 0; vi < viewers.length; vi++) {
      const w = viewers[vi];
      const p = players[w]; const v = p.view; const r = p.r;
      if (!v || !r) continue;
      const q = players[other(w)];
      const qs = q.rs;
      const hk = p.hk;
      const qh = q.local ? (q.r ? q.r.hearts : 0) : q.net.h;
      const gapM = Math.round(qs.z - p.rs.z);
      if (M.mode === 'tandem') {
        const th = live && !isHost ? (q.net.th || M.th) : M.th;
        v.hearts(Math.max(0, th), TEAM_HEARTS_MAX, 'var(--g-bad)');
        const tc = r.coins + (q.local ? (q.r ? q.r.coins : 0) : q.net.c);
        v.coins(tc);
        const goal = live && !isHost ? (q.net.tg || M.goal) : M.goal;
        v.bar(true, Math.min(1, tc / goal), 0, 'var(--g-hl)', '', '', '');
        const k = tc * 100000 + goal;
        if (hk.gap !== k) { hk.gap = k; v.gap(`${tc} / ${goal} coins together`); }
        if (!isHost && live && q.net.th > (p._th || 0) && p._th) { v.pop('+1 heart', 'good', 'coin goal reached'); audio.play('heart'); }
        if (live) p._th = q.net.th;
      } else {
        v.hearts(r.hearts, HEARTS, p.css);
        v.coins(r.coins);
      }
      v.dist(Math.max(0, Math.floor(p.rs.z)));
      if (M.mode === 'race') {
        v.bar(true, clamp(p.rs.z / M.len, 0, 1), clamp(qs.z / M.len, 0, 1), p.css, q.css, p.name[0], q.name[0]);
        if (hk.gap !== gapM) { hk.gap = gapM; v.gap(Math.abs(gapM) < 1 ? `${q.name} level with you` : `${q.name} ${gapM > 0 ? '+' : '−'}${Math.abs(gapM)} m`); }
        v.weapon(p.weaponRoll > 0 ? WEAPON_IDX[1 + (Math.floor(K.tAnim * 12) % 5)] : p.weapon, true);
      } else if (M.mode === 'daily') {
        v.bar(false);
        const k = (Math.abs(gapM) <= 2 ? 99999 : gapM) * 10 + qh;
        if (hk.gap !== k) { hk.gap = k; v.gap(Math.abs(gapM) <= 2 ? `${q.name} level with you` : `${q.name} ${gapM > 0 ? '+' : '−'}${Math.abs(gapM)} m`); }
      } else if (M.mode === 'brawl') {
        v.bar(false);
        const k = (Math.abs(gapM) <= 2 ? 99999 : gapM) * 10 + qh;
        if (hk.gap !== k) {
          hk.gap = k;
          const hs = `${'♥'.repeat(Math.max(0, qh))}${'♡'.repeat(Math.max(0, HEARTS - qh))}`;
          v.gap(Math.abs(gapM) <= 2 ? `${q.name} ${hs} · side by side!` : `${q.name} ${hs} · ${gapM > 0 ? '+' : '−'}${Math.abs(gapM)} m`);
        }
      }
      v.partner('', q.css);
      v.powers(r.magnetT / 10, r.sneakersT / 10, r.shield, r.boostT / 2.2);
      // oncoming train warning + horn
      let warn = false; let warnLane = 0;
      const ci = Math.floor(r.z / CHUNK);
      for (let c = ci; c <= ci + 1; c++) {
        const obs = M.track.chunk(c).obs;
        for (let oi = 0; oi < obs.length; oi++) {
          const o = obs[oi];
          if (o.t !== O_MTRAIN) continue;
          if (r.z >= o.zm - MT_LEAD && r.z < o.zm + 1) {
            warn = true; warnLane = o.lane;
            if (p.lastHorn !== o.id) { p.lastHorn = o.id; audio.play('horn'); }
          }
        }
      }
      v.warn(warn && M.phase === 'run', warnLane * 230);
      // tandem banners
      if (M.mode === 'tandem' && M.phase === 'run') {
        if (r.down && p.downId) {
          const left = Math.max(0, Math.ceil((p.downAt + 10000 - now) / 1000));
          if (hk.ban !== 1) { hk.ban = 1; v.banner(`You’re down! ${esc(q.name)} can revive you<b>${left}</b>`); }
          v.bannerNum(left);
        } else if (p.revive) {
          const left = Math.max(0, Math.ceil((p.revive.until - now) / 1000));
          if (hk.ban !== 2) { hk.ban = 2; v.banner(`${esc(q.name)} is down! Grab the glowing heart<b>${left}</b>`); }
          v.bannerNum(left);
        } else if (hk.ban) { hk.ban = 0; v.banner(null); }
      } else if (M.mode === 'daily' && M.phase === 'run' && r.out) {
        const qz = Math.round(qs.z / 5) * 5;
        if (hk.ban !== 3) { hk.ban = 3; v.banner(`Out of hearts at ${fmtM(r.z)} m · ${esc(q.name)} is still running<b>${qz}</b><small>metres so far</small>`); }
        v.bannerNum(qz);
      } else if (M.mode !== 'tandem') { if (hk.ban) { hk.ban = 0; } v.banner(null); }
    }
    void dt;
  }
  // partner name tag (live): after render, so the camera matrices are this frame's
  function updateTag() {
    if (live && players[meW].rig && vec3 && M.phase !== 'lobby') {
      const q = players[other(meW)];
      const me = players[meW].rs;
      const dz = q.rs.z - me.z;
      if (dz > -6 && dz < 120 && q.rs.visible && !(Math.abs(dz) < 3 && Math.abs(q.rs.x - me.x) < 1)) {
        const cam = players[meW].rig.cam;
        vec3.set(q.rs.x, q.rs.y + 2.75, -q.rs.z);
        vec3.project(cam);
        if (vec3.z < 1 && Math.abs(vec3.x) < 1.1 && vec3.y < 1 && vec3.y > -1) {
          hud.tag(true, clamp((vec3.x * 0.5 + 0.5) * W, 44, W - 44), clamp((-vec3.y * 0.5 + 0.5) * H, 120, H - 40), q.name, q.css, 0);
        } else if (vec3.z < 1 && Math.abs(dz) < 12) {
          // right beside me but outside a narrow portrait view: pin the tag to that edge, pointing at them
          const side = vec3.x > 0 ? 1 : -1;
          vec3.set(q.rs.x, q.rs.y + 1.1, -q.rs.z);
          vec3.project(cam);
          hud.tag(true, side > 0 ? W - 10 : 10, clamp((-vec3.y * 0.5 + 0.5) * H, 150, H - 170), q.name, q.css, side);
        } else hud.tag(false);
      } else if (M.phase === 'run' && q.rs.visible && (dz >= 120 || dz <= -6) && Math.abs(dz) < 100000) {
        // ghost marker: they're out of sight, so pin a chip where they'd be (their lane, up at the
        // horizon when ahead, down by my feet when behind) with the live gap
        const cam = players[meW].rig.cam;
        const g = Math.round(Math.abs(dz) / 5) * 5;
        if (ghostG !== g || ghostDir !== (dz > 0)) { ghostG = g; ghostDir = dz > 0; ghostText = `${q.name} ${dz > 0 ? '↑' : '↓'} ${g} m`; }
        if (dz > 0) {
          vec3.set(q.rs.x, 1.2, -(me.z + 140));
          vec3.project(cam);
          hud.tag(true, clamp((vec3.x * 0.5 + 0.5) * W, 60, W - 60), clamp((-vec3.y * 0.5 + 0.5) * H, H * 0.3, H * 0.5), ghostText, q.css, 0, true);
        } else hud.tag(true, clamp(W / 2 + (q.rs.x - me.x) * 34, 70, W - 70), H - 120, ghostText, q.css, 0, true);
      } else hud.tag(false);
    } else hud.tag(false);
  }
  let ghostG = -1; let ghostDir = false; let ghostText = '';
  let countK = -1; let pauseK = -1;

  // The lobby re-renders only when one of its inputs changes (a numeric key), not every frame.
  let lobbyK = -1;
  function lobbyUI() {
    if (!ready3D) return;
    // mode in bits 8+, the live flags below it, today's Daily board (so a new best redraws the row) above
    let k = (MODES.indexOf(M.lobbyMode) + 1) << 8;
    { const d = data(); const dk = day(); k += (((d[`a_daily_${dk}`] | 0) * 31 + (d[`b_daily_${dk}`] | 0)) % 100003) * 4096; }
    let ps = null; let fresh = false;
    if (live) {
      ps = link.latest();
      fresh = !!ps && link.age() < 2000;
      if (!isHost) { const hm = fresh && ps.ph === PH.lobby ? MODES[ps.md] : null; if (hm) M.lobbyMode = hm; k = (k & ~0xff00) | ((MODES.indexOf(M.lobbyMode) + 1) << 8); }
      k |= (partnerHere ? 4 : 0) | (fresh && ps.ph === PH.lobby ? 8 : 0) | (fresh && ps.sy ? 16 : 0) | (fresh && ps.rd ? 32 : 0) | (link.synced ? 64 : 0) | (M.ready ? 128 : 0);
    }
    if (k === lobbyK && ov_lobbyOn()) return;
    lobbyK = k;
    const keys = split ? `<div><b>${esc(api.name('a'))}</b><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> · weapon <kbd>E</kbd></div><div><b>${esc(api.name('b'))}</b><kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd> · weapon <kbd>Enter</kbd></div>` : '';
    const daily = dailyText();
    if (!live) { hud.lobby({ mode: M.lobbyMode, canPick: true, canStart: true, startLabel: 'Start', status: '', keys, daily }); return; }
    const pn = api.name(other(meW));
    if (isHost) {
      const pin = partnerHere && fresh && ps.ph === PH.lobby && ps.sy;
      const status = !partnerHere ? `Waiting for ${esc(pn)}…` : !pin ? `${esc(pn)} is getting ready…` : ps.rd ? `<span class="rr-ok">${esc(pn)} is ready</span>` : `${esc(pn)} is here · you pick the mode`;
      hud.lobby({ mode: M.lobbyMode, canPick: true, canStart: !!pin, startLabel: 'Start', status, keys, daily });
    } else {
      const status = `${esc(pn)} picks the mode${link.synced ? '' : ' · syncing clocks…'}`;
      hud.lobby({ mode: M.lobbyMode, canPick: false, canStart: link.synced, startLabel: M.ready ? 'Ready!' : 'I’m ready', status, keys, daily });
    }
  }
  const ov_lobbyOn = () => hud.ov.lobby.classList.contains('on');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function hudToast(m) { try { api.toast(m); } catch { /* ignore */ } }

  // ── render ──
  function render(dt, now, draw = true) {
    for (let i = 0; i < 2; i++) {
      const p = players[AB[i]];
      p.rs.t = K.tAnim;
      p.av.update(dt, p.rs);
    }
    fx.update(dt, K.tAnim);
    const tr = M.track || lobbyTrack;
    let nz = 0;
    for (let i = 0; i < viewers.length; i++) zsBuf[nz++] = players[viewers[i]].rs.z;
    if (M.phase === 'lobby') zsBuf[nz++] = -90;
    world.ensure(tr, zsBuf, nz, M.phase === 'run' ? 1 : 9);
    // blob shadows
    let ns = 0;
    for (let i = 0; i < 2; i++) {
      const s = players[AB[i]].rs;
      if (!s.visible || s.y < -1) continue;
      const hgt = Math.max(0, s.y - s.ground);
      const L = shadowList[ns++];
      L[0] = s.x; L[1] = s.ground; L[2] = s.z; L[3] = Math.max(0.5, 1.3 - hgt * 0.18);
    }
    world.setShadows(shadowList, ns);
    renderer.info.reset();
    const lobbyish = M.phase === 'lobby' || M.phase === 'loading';
    const nv = lobbyish ? 1 : viewers.length;
    const vw = split && !lobbyish ? W / 2 : W;
    // colour script: the sky warms with the fastest viewer's speed (a rocket pushes it further)
    let mood = 0;
    if (M.phase === 'run' || M.phase === 'finale' || M.phase === 'over') {
      for (let i = 0; i < viewers.length; i++) { const rs = players[viewers[i]].rs; const k = Math.min(1, Math.max(0, (rs.speed - 13) / 15)) + (rs.boost ? 0.3 : 0); if (k > mood) mood = k; }
    }
    world.setMood(mood);
    overlay.resize(vw, H);
    if (split) renderer.setScissorTest(true);
    for (let i = 0; i < nv; i++) {
      const p = players[viewers[i]];
      const rg = p.rig;
      let mode = 'run';
      let tg = p.rs;
      if (M.phase === 'lobby' || M.phase === 'loading') mode = 'lobby';
      else if (M.phase === 'finale' || M.phase === 'over') { mode = 'finale'; const w = M.result && M.result.winner; tg = w ? players[w].rs : p.rs; }
      else if (M.mode === 'tandem' && p.rs.down && p.r && p.r.hold && p.rs.downT > 0.9) { mode = 'spectate'; tg = players[other(p.w)].rs; }
      else if (M.mode === 'daily' && p.r && p.r.out && p.rs.downT > 1.2 && !players[other(p.w)].rs.idle) { mode = 'spectate'; tg = players[other(p.w)].rs; }
      if (lobbyish && split) rg.resize(W, H, H < 560 && W > H);
      else if (split && rg.cam.aspect !== vw / H) rg.resize(vw, H, H < 560 && vw > H);
      rg.update(dt, mode, tg, K.tAnim);
      viewArg.track = tr; viewArg.z = p.rs.z; viewArg.r = p.r; viewArg.time = K.tAnim; viewArg.boxes = M.mode === 'race' && M.phase !== 'lobby'; viewArg.fly = p.fly; viewArg.front = mode === 'lobby' || mode === 'finale';
      world.syncView(viewArg);
      world.follow(rg.cam);
      // A runner between this camera and its own runner dissolves through a halftone screen
      // (the partner close behind you would otherwise fill a third of a phone screen).
      for (let k = 0; k < 2; k++) {
        const w = AB[k]; const s = players[w].rs;
        let f = 0;
        if (w !== p.w && mode !== 'lobby' && mode !== 'finale' && s.visible) {
          const cp = rg.cam.position;
          const dx = s.x - cp.x; const dy = s.y + 1 - cp.y; const dz = -s.z - cp.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          f = Math.min(1.25, Math.max(0, (7.6 - d) / 3.2));
        }
        world.fade[w].value = f;
      }
      if (split) { renderer.setViewport(i * vw, 0, vw, H); renderer.setScissor(i * vw, 0, vw, H); }
      else renderer.setViewport(0, 0, W, H);
      if (draw) renderer.render(world.scene, rg.cam);
      const sk = mode === 'run' && !isPaused(now) ? Math.min(1, Math.max(0, (p.rs.speed - 18) / 12)) * 0.8 + (p.rs.boost ? 0.5 : 0) : 0;
      overlay.update(reducedMotion ? 0 : sk); // no speed lines with reduced motion (vignette stays)
      if (draw) overlay.render(renderer);
    }
    if (split) renderer.setScissorTest(false);
    perf.calls = renderer.info.render.calls; perf.tris = renderer.info.render.triangles;
    if (M.phase === 'run') { if (perf.calls > perf.maxCalls) perf.maxCalls = perf.calls; if (perf.tris > perf.maxTris) perf.maxTris = perf.tris; }
  }

  // ── perf + dynamic resolution ──
  function track(dtMs, workMs) {
    const i = perf.n % 600;
    perf.dts[i] = dtMs; perf.work[i] = workMs; perf.n++;
    K.ewma = K.ewma * 0.9 + dtMs * 0.1;
    K.checkT += dtMs;
    if (K.checkT < 250 || !renderer) return;
    K.checkT = 0;
    if (dbg && dbg.fixedScale) return;
    // Quick down (every 250 ms while frames run long; bigger steps when far off), slow up (after
    // 4 s of comfortable frames, then a 2 s cool-down), so it settles instead of oscillating.
    if (K.coolT > 0) K.coolT -= 250;
    if (K.ewma > 18.4 && scale > 0.55) {
      scale = Math.max(0.55, Math.round((scale - (K.ewma > 26 ? 0.15 : 0.08)) * 100) / 100);
      K.lowFor = 0; K.coolT = 4000; perf.scaleDowns++; resize();
    } else if (K.ewma < 15.4) {
      K.lowFor += 250;
      if (K.lowFor >= 4000 && K.coolT <= 0 && scale < 1) { scale = Math.min(1, Math.round((scale + 0.05) * 100) / 100); K.lowFor = 0; K.coolT = 2000; perf.scaleUps++; resize(); }
    } else K.lowFor = 0;
  }
  function pct(arr, n, q) {
    const m = Math.min(n, arr.length);
    if (!m) return 0;
    const a = Array.from(arr.slice(0, m)).sort((x, y) => x - y);
    return a[Math.min(m - 1, Math.floor(q * m))];
  }

  // ── test hook (only with window.__RUSH_DEBUG set before mount) ──
  if (dbg) {
    window.__rush = {
      get phase() { return M.phase; },
      state() {
        const one = (w) => {
          const p = players[w]; const r = p.r; const s = p.rs;
          return {
            local: p.local, z: s.z, x: s.x, y: s.y, lane: r ? r.lane : Math.round(s.laneX / LANE_W), down: s.down, air: s.air, roll: s.roll, invuln: s.invuln,
            hearts: r ? r.hearts : p.net.h, coins: r ? r.coins : p.net.c, t: r ? r.t : p.net.rt, fin: r ? r.fin : p.net.fn, out: r ? !!r.out : !!(p.net.f & F_OUT),
            crashes: r ? r.crashes : 0, stumbles: r ? r.stumbles : 0, jumps: r ? r.jumps : 0, rolls: r ? r.rolls : 0, shield: s.shield, weapon: p.weapon, stats: p.stats, auto: p.auto, tokens: r ? r.tokens.filter((t) => t.alive).length : 0,
            splat: p.view ? p.view.splatted : false, extra: r ? r.extra.length : 0, revive: !!p.revive, zap: r ? r.zapT : 0, stumbleT: r ? r.stumbleT : 0,
          };
        };
        return {
          phase: M.phase, mode: M.mode, lobbyMode: M.lobbyMode, live, me: meW, host: isHost, seed: M.seed, len: M.len, now: clock(), startAt: M.startAt,
          startedWall: M.startedWall, firstRunWall: M.firstRunWall, runMs: M.runMs, steps: M.steps, paused: M.paused, resumeAt: M.resumeAt, reasons: [...M.reasons], partnerPz: M.partnerPz,
          th: M.th, goal: M.goal, result: M.result, synced: live ? link.synced : true, rtt: live ? link.rtt : 0, partnerHere,
          scale, dpr: renderer ? renderer.getPixelRatio() : 0, glLost, chunks: world ? world.chunkCount() : 0, ready3D, loadMs,
          a: one('a'), b: one('b'), pending: live ? link.pending() : 0, tutorial: tutorial.on,
        };
      },
      perf() {
        return {
          frames: perf.n, p50: pct(perf.dts, perf.n, 0.5), p95: pct(perf.dts, perf.n, 0.95), work50: pct(perf.work, perf.n, 0.5), work95: pct(perf.work, perf.n, 0.95),
          calls: perf.calls, maxCalls: perf.maxCalls, tris: perf.tris, maxTris: perf.maxTris, scale, scaleDowns: perf.scaleDowns, scaleUps: perf.scaleUps, programs0: perf.programs0, chunkVerts: world ? world.stats.maxV : 0, chunkIdx: world ? world.stats.maxI : 0, chunkOver: world ? world.stats.over : 0, chunksBuilt: world ? world.stats.built : 0, dpr: renderer ? renderer.getPixelRatio() : 0,
          geometries: renderer ? renderer.info.memory.geometries : 0, textures: renderer ? renderer.info.memory.textures : 0, programs: renderer && renderer.info.programs ? renderer.info.programs.length : 0,
        };
      },
      resetPerf() { perf.n = 0; perf.maxCalls = 0; perf.maxTris = 0; },
      /**
       * Run n frames of the per-frame JS path (sim, logic, avatars, particles, world sync, rig,
       * HUD, overlay) on the live state with a fake 60 Hz clock, skipping only the GL draw.
       * For steady-state timing / allocation tests (SwiftShader frame times say nothing).
       */
      bench(n = 600) {
        if (!ready3D) return null;
        let now = clock();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) {
          now += 1000 / 60;
          K.tAnim += 1 / 60;
          logic(now, 1 / 60);
          render(1 / 60, now, false);
          updateTag();
        }
        const ms = performance.now() - t0;
        M.lastNow = clock();
        return { frames: n, msPerFrame: ms / n };
      },
      /** Feel numbers measured on a fresh runner with the real sim. */
      probe() {
        // the first 20 m of chunk 0 are empty on every seed
        const r = newRunner(0); const tr = createTrack(5);
        r.z = r.zPrev = 2; r.t = 0; r.invulnT = 1e9;
        act(r, A_RIGHT); let n = 0; while (r.laneT < 1 && n < 200) { step(r, tr, true); n++; }
        const laneMs = n * DT * 1000;
        const r2 = newRunner(0); r2.z = r2.zPrev = 2; r2.invulnT = 1e9;
        act(r2, A_UP); let apex = 0; let air = 0; for (let k = 0; k < 240; k++) { step(r2, tr, true); if (r2.y > apex) apex = r2.y; if (!r2.grounded) air++; }
        // a soft warm-up barrier trips you instead of knocking you down
        const r3 = newRunner(0); const tr0 = createTrack(9); r3.z = r3.zPrev = TUT_JUMP - 3; r3.speed = 13;
        for (let k = 0; k < 120; k++) step(r3, tr0, false);
        return { laneMs, jumpApex: apex, airMs: air * DT * 1000, softCrashes: r3.crashes, softStumbles: r3.stumbles, diff30s: difficulty(430), diff200: difficulty(200), diff2k: difficulty(2000) };
      },
      input(w, a) { onAction(w || meW || 'a', { left: A_LEFT, right: A_RIGHT, up: A_UP, down: A_DOWN, use: A_USE }[a] || a); },
      auto(w, on) { const p = players[w || meW]; if (p) p.auto = on !== false; },
      give(w, kind) { const p = players[w || meW]; if (!p || !p.r) return false; if (kind === 'shield') { p.r.shield = 1; return true; } if (kind === 'magnet') { p.r.magnetT = 10; return true; } p.weapon = kind; p.weaponRoll = 0; return true; },
      crash(w) { const p = players[w || meW]; if (p && p.r && !p.r.down) { p.r.invulnT = 0; p.r.shield = 0; crash(p.r, C_FORCED, false); drain(p); } },
      setHearts(w, n) { const p = players[w || meW]; if (p && p.r) p.r.hearts = n; },
      ghost(w, sec) { const p = players[w || meW]; if (p && p.r && !p.r.done) p.r.invulnT = sec; },
      teamHearts(n) { M.th = n; },
      mode(m) { if (isHost && M.phase === 'lobby') { M.lobbyMode = m; } },
      start() { hostStart(); },
      trackHash: (seed, n) => trackHash(seed, n),
      dailySeed: (d) => dailySeed(d),
      data: () => data(),
      setData: (patch) => setData(patch),
      settings,
      /** Fairness probes: a late lane change before a barrier is a clip (stumble), a square hit is a crash; combo tiers pay. */
      probe2() {
        const tr = createTrack(5);
        // find the first low barrier past the warm-up with a clear lane next to it
        let o = null;
        for (let ci = 1; ci < 20 && !o; ci++) {
          const c = tr.chunk(ci);
          for (const x of c.obs) {
            if (x.t !== 1 || x.soft) continue;
            const nl = x.lane === 1 ? 0 : x.lane + 1; // the lane the swipe goes to
            const busy = c.obs.some((y) => y !== x && ((y.lane === nl && y.z1 > x.z0 - 12 && y.z0 < x.z1 + 12) || (y.lane === x.lane && y.z1 > x.z0 - 32 && y.z0 < x.z0)));
            if (!busy && !c.gaps.length && x.z0 - 30 > c.z0) { o = x; break; }
          }
        }
        const run = (swipeBefore) => {
          const r = newRunner(o.lane); r.z = r.zPrev = o.z0 - 30; r.t = 20; r.speed = baseSpeed(20);
          const dir = o.lane === 1 ? A_LEFT : A_RIGHT;
          let swiped = false;
          for (let k = 0; k < 400 && !r.down; k++) {
            if (!swiped && o.z0 - (r.z + 0.35) < swipeBefore) { swiped = true; act(r, dir); }
            step(r, tr, false);
            if (r.z > o.z1 + 5) break;
          }
          return { crashes: r.crashes, stumbles: r.stumbles, clips: r.clips, z: r.z };
        };
        const late = run(0.06 + 1.5 * baseSpeed(20) * DT); // the swipe lands a step before the hull touches: a clip
        const none = run(-1);    // never swipes: a crash
        const early = run(3);    // ~0.1 s before: clean
        // combo tiers: a perfect run through 1.2 km strings clean passes together and gets paid
        const rc = newRunner(0); rc.hearts = 1e6; const bot = createBot(tr); let n = 0;
        while (rc.z < 1200 && n < 120 * 90) { if (n % bot.every === 0) { const a = bot.decide(rc); if (a) act(rc, a); } step(rc, tr, false); rc.evN = 0; n++; if (rc.down) break; }
        return { late, none, early, combo: { max: rc.maxCombo, bonus: rc.bonus, coins: rc.coins, closeCalls: rc.closeCalls } };
      },
      botRun: (seed, n) => botRun(seed, n),
      inputStats: () => (input ? input.stats : null),
      get canvas() { return renderer ? renderer.domElement : null; },
      instances: () => liveGames,
      get internals() { return { renderer, world, fx, overlay, players, THREE, M, audio }; },
    };
  }

  load();

  return {
    destroy() {
      dead = true;
      liveGames--;
      cancelAnimationFrame(raf);
      timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
      offs.forEach((f) => { try { f(); } catch { /* ignore */ } });
      if (input) input.destroy();
      if (link) link.destroy();
      audio.destroy();
      try {
        for (const w of ['a', 'b']) if (players[w].av) players[w].av.dispose();
        if (fx) fx.dispose();
        if (world) world.dispose();
        disposeAvatarGeometry();
        if (renderer) {
          const cv = renderer.domElement;
          cv.removeEventListener('webglcontextlost', onLost);
          cv.removeEventListener('webglcontextrestored', onRestored);
          renderer.renderLists.dispose();
          renderer.dispose();
          renderer.forceContextLoss();
          cv.remove();
        }
      } catch (e) { console.warn(e); }
      if (dbg && window.__rush) delete window.__rush;
      root.remove();
    },
  };
}

export function rushInstances() { return liveGames; }
