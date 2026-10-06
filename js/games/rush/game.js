// Rail Rush game orchestrator: loading, renderer + dynamic resolution, lobby, synchronized start,
// the fixed-step loop, pause / resume protocol, partner re-mounts, finale, HUD, test hook.
import {
  DT, LANE_W, SLIDE_TIME, STUMBLE_T, START_DELAY, RESUME_DELAY, RACE_LEN, BRAWL_CAP, MT_LEAD, CHUNK,
  HEARTS, TEAM_HEARTS_MAX,
} from './tune.js';
import { createTrack, trackHash, O_MTRAIN } from './track.js';
import {
  newRunner, step, act, createBot, botRun, crash, C_FORCED, A_LEFT, A_RIGHT, A_UP, A_DOWN,
  E_JUMP, E_LAND, E_ROLL, E_LANE, E_COIN, E_PICK, E_STUMBLE, E_CRASH, E_RESPAWN, E_SHIELD,
  E_CLOSE, E_COMBO, E_FINISH, E_SMASH, E_TOKEN, E_BLOCK, E_BUMP,
} from './sim.js';
import { makePalette } from './gfx.js';
import { createWorld } from './world.js';
import { createAvatar, disposeAvatarGeometry } from './avatar.js';
import { createFx, createRig } from './fx.js';
import { createAudio } from './audio.js';
import { createInput, A_USE } from './input.js';
import { createHud } from './hud.js';
import { createLink, emptyState } from './link.js';
import { createRules, MODES, MODE_LABEL } from './modes.js';

const PH = { loading: 0, lobby: 1, countdown: 2, run: 3, finale: 4, over: 5 };
const F_AIR = 1; const F_ROLL = 2; const F_DOWN = 4; const F_INV = 8; const F_SHIELD = 16; const F_DONE = 32;
const F_RUN = 64; const F_OUT = 128; const F_BOOST = 256; const F_MAGNET = 512; const F_SNEAK = 1024;
const WEAPON_IDX = [null, 'ink', 'block', 'zap', 'rocket', 'shield'];
const PZ = { menu: 1, hidden: 2, gl: 3, gone: 4, stale: 5, sync: 6, tap: 7 };
const RULE_MSGS = ['atk', 'res', 'shove', 'fin', 'out', 'down', 'revive', 'missed'];
const SKEY = 'rush.settings.v1';
const TKEY = 'rush.tutorial.v1';
const MKEY = 'rush.mode.v1';
const MUTE = 'ju.games.mute';
const HN = 150; // lag-compensation history (frames)
const COMBO_WORDS = ['', '', 'Nice', 'Great', 'Slick', 'Wild', 'Unreal', 'Legend'];

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
  const split = !live;
  const other = (w) => (w === 'a' ? 'b' : 'a');
  let dead = false;
  liveGames++;

  // ── DOM ──
  const root = document.createElement('div');
  root.className = 'g-rush' + (split ? ' rr-split' : '');
  root.innerHTML = `<div class="rr-gl"></div><div class="rr-touch"></div><div class="rr-speed"></div><div class="rr-grain"></div>${split ? '<div class="rr-divider"></div>' : ''}`;
  el.appendChild(root);
  const glWrap = root.querySelector('.rr-gl');
  const touch = root.querySelector('.rr-touch');
  const speedEl = root.querySelector('.rr-speed');

  const settings = Object.assign({ scheme: 'swipe', music: 'on' }, lsGet(SKEY, {}));
  const audio = createAudio({ musicOn: () => settings.music === 'on' });
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
    hud.settings({ scheme: settings.scheme, music: settings.music, sound: snd });
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
      lastHorn: -1, outT: -1, lastGround: false, tut: 0,
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
      if (isHost) { if (M.phase === 'countdown' || M.phase === 'run' || M.phase === 'finale') sendRejoin(); }
      else if (M.phase !== 'lobby' && M.phase !== 'loading') { link.resetNet(); toLobby(); hudToast('Restarted: ' + api.name(other(meW)) + ' reloaded'); }
      else link.resetNet();
    }));
    offs.push(link.on('start', (d) => { if (!isHost) beginMatch(d.mode, d.seed, d.at, d.len, d.cap); }));
    offs.push(link.on('end', (d) => { if (!isHost && M.phase !== 'over') startFinale(d.res, d.at); }));
    offs.push(link.on('resume', (d) => { if (d && d.at > M.resumeAt && (M.phase === 'run' || M.phase === 'countdown')) M.resumeAt = d.at; }));
    offs.push(link.on('rejoin', (d) => { if (!isHost) applyRejoin(d); }));
    for (const t of RULE_MSGS) offs.push(link.on(t, (d, at) => { if (rules) rules.msg(t, d || {}, at, other(meW)); }));
  }

  // ── 3D ──
  let THREE = null; let renderer = null; let world = null; let fx = null; let P = null; let input = null;
  let ready3D = false; let glLost = false; let raf = 0; let lastTs = 0;
  let W = 0; let H = 0; const baseDpr = Math.min(window.devicePixelRatio || 1, 2); let scale = 1;
  let ewma = 16.7; let lowFor = 0; let checkT = 0;
  const perf = { dts: new Float32Array(600), work: new Float32Array(600), n: 0, calls: 0, tris: 0, maxCalls: 0 };
  let rules = null;
  const lobbyTrack = createTrack(1);
  const tmpV = { x: 0, y: 0, z: 0 };
  let vec3 = null;
  const shadowList = [[0, 0, 0, 1, 1], [0, 0, 0, 1, 1]];

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
    toLobby();
    setTimeout(() => { if (!dead) hud.hideLoading(); }, 120);
    lastTs = 0;
    raf = requestAnimationFrame(frame);
  }

  function init3D() {
    P = makePalette(api.tokens());
    P.a2 = P.a; P.b2 = P.b;
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false, depth: true });
    renderer.info.autoReset = false;
    renderer.setPixelRatio(baseDpr * scale);
    renderer.setClearColor(new THREE.Color().fromArray(P.bg), 1);
    glWrap.appendChild(renderer.domElement);
    const cv = renderer.domElement;
    cv.addEventListener('webglcontextlost', onLost, false);
    cv.addEventListener('webglcontextrestored', onRestored, false);
    world = createWorld(THREE, P);
    fx = createFx(THREE, world);
    vec3 = new THREE.Vector3();
    for (const w of ['a', 'b']) {
      const p = players[w];
      p.av = createAvatar(THREE, world, P, w);
    }
    for (const w of viewers) players[w].rig = createRig(THREE);
    if (split) { players.a.view = hud.makeView('l', 'a'); players.b.view = hud.makeView('r', 'b'); }
    else players[meW].view = hud.makeView('full', meW);
    world.setGates([2]);
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
    // Build the start chunks and compile every material variant behind the loading screen.
    world.ensure(lobbyTrack, [0], 9);
    const list = world.warmList();
    const saved = list.map((m) => (m && m.isInstancedMesh ? m.count : -1));
    list.forEach((m) => { if (m && m.isInstancedMesh) m.count = 1; if (m) m.visible = true; });
    for (const w of viewers) { const rg = players[w].rig; rg.update(0.016, 'lobby', players[w].rs, 0); }
    const cam = players[viewers[0]].rig.cam;
    try { renderer.compile(world.scene, cam); } catch (e) { console.warn(e); }
    renderer.setViewport(0, 0, W, H);
    try { renderer.render(world.scene, cam); } catch (e) { console.warn(e); }
    list.forEach((m, i) => { if (m && m.isInstancedMesh) m.count = saved[i]; });
    world.syncView({ track: lobbyTrack, z: 0, r: null, time: 0 });
  }

  function resize() {
    if (!renderer) return;
    const r = root.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    renderer.setPixelRatio(baseDpr * scale);
    renderer.setSize(W, H, false);
    const vw = split ? W / 2 : W;
    for (const w of viewers) players[w].rig.resize(vw, H);
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
    M.track = null; M.result = null; M.ready = false; M.reasons.clear(); M.paused = false; M.resumeAt = 0;
    for (const w of ['a', 'b']) {
      const p = players[w];
      p.r = null; p.bot = null; p.weapon = null; p.revive = null;
      p.rs.z = 0; p.rs.x = p.rs.laneX = (w === 'a' ? -1 : 1) * LANE_W; p.rs.y = 0; p.rs.idle = true; p.rs.down = false; p.rs.win = false; p.rs.visible = true;
      if (p.rig) p.rig.snap();
    }
    if (world) { world.reset(); world.setGates([2]); }
    hud.finale(null); hud.count(''); hud.pause(null);
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
    const seed = (dbg && dbg.seed) || ((Math.random() * 2147483646) | 0) + 1;
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
    M.startedWall = 0; M.firstRunWall = 0; M.partnerFin = -1; M.partnerOut = -1;
    for (const w of ['a', 'b']) {
      const p = players[w];
      p.outT = -1; p.lastHorn = -1; p.histN = 0; p.weapon = null; p.tut = 0;
      for (const f of p.fly) f.on = false;
      if (p.local) {
        p.r = newRunner(w === 'a' ? -1 : 1);
        p.bot = createBot(M.track);
        if (dbg && dbg.auto) p.auto = true;
      } else p.r = null;
      if (p.rig) p.rig.snap();
    }
    rules = createRules(G);
    rules.init();
    world.reset();
    world.setGates(M.mode === 'race' ? [2, M.len] : [2]);
    fx.clear();
    hud.hideLobby(); hud.settings(null);
    for (const w of viewers) {
      const v = players[w].view;
      v.weapon(null, M.mode === 'race');
      v.banner(null);
    }
    api.setStatus(`${MODE_LABEL[M.mode]} · ${M.mode === 'race' ? `first to ${(M.len / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} km` : M.mode === 'brawl' ? 'shove to win' : 'shared hearts'}`);
    audio.startMusic();
    audio.setIntensity(0);
    tutorial.start();
  }

  function sendRejoin() {
    const s = link.latest();
    link.send('rejoin', {
      mode: M.mode, seed: M.seed, startAt: M.startAt, len: M.len, cap: M.cap, th: M.th, goal: M.goal, goalIdx: M.goalIdx,
      you: s && s.ep === M.epoch ? { z: s.z, l: s.l, h: s.h, c: s.c, rt: s.rt, fn: s.fn } : null,
    });
  }
  function applyRejoin(d) {
    if (!d || !ready3D) return;
    beginMatch(d.mode, d.seed, d.startAt, d.len, d.cap);
    M.th = d.th; M.goal = d.goal; M.goalIdx = d.goalIdx || 0;
    const y = d.you;
    const r = players[meW].r;
    if (y && r) {
      r.z = r.zPrev = y.z; r.lane = r.laneFrom = Math.max(-1, Math.min(1, y.l | 0)); r.x = r.xFrom = r.lane * LANE_W;
      r.hearts = y.h; r.coins = y.c; r.t = y.rt; r.fin = y.fn; if (y.fn >= 0) { r.done = 1; r.invulnT = 1e9; }
      r.invulnT = Math.max(r.invulnT, 2);
      M.runMs = y.rt * 1000; M.steps = Math.floor(y.rt / DT);
    }
    M.phase = 'run';
    M.resumeAt = clock() + RESUME_DELAY;
    link.send('resume', { at: M.resumeAt });
  }

  function endMatch(res) {
    if (M.phase !== 'run') return;
    const at = clock() + 2300;
    if (live) link.send('end', { res, at });
    startFinale(res, at);
  }
  function startFinale(res, at) {
    M.result = res; M.endAt = at; M.phase = 'finale';
    const w = res.winner;
    const v = viewers.map((x) => players[x].view);
    const cls = res.team ? 'team' : w ? 'p' + w : '';
    hud.finale(res.team ? res.text : w ? `${api.name(w)} wins!` : 'Photo finish!', cls, res.team ? res.sub : (live ? (w === meW ? 'You did it' : 'So close') : ''));
    audio.play('finish');
    audio.stopMusic();
    const tz = w ? players[w].rs : players[viewers[0]].rs;
    fx.confetti(tz.x, tz.ground, tz.z, w ? [P[w], P.hl, P.card] : [P.a, P.b, P.hl], 60);
    v.forEach((x) => x && x.banner(null));
  }
  function toOver() {
    M.phase = 'over';
    try { api.finish(M.result); } catch (e) { console.error(e); }
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
    get pal() { return { a: P.a, b: P.b, hl: P.hl }; },
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

  function shake(w, a) { const rg = players[w] && players[w].rig; if (rg) rg.shake(a); }

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
    for (const s of shots) {
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
  const tutorial = {
    on: false, step: 0, t: 0,
    start() {
      this.on = !split && !lsGet(TKEY, false) && !(dbg && dbg.noTutorial);
      this.step = 0; this.t = 0;
    },
    did(p, a) {
      if (!this.on || p.w !== (meW || 'a')) return;
      if ((this.step === 0 && (a === A_LEFT || a === A_RIGHT)) || (this.step === 1 && a === A_UP) || (this.step === 2 && a === A_DOWN)) this.next();
    },
    next() { this.step++; this.t = 0; if (this.step > 2) { this.on = false; lsSet(TKEY, true); hud.tutorial(-1); } },
    update(dt) {
      if (!this.on) return;
      if (M.phase !== 'run' && M.phase !== 'countdown') { hud.tutorial(-1); return; }
      this.t += dt;
      if (M.phase === 'run' && this.t > 2.8) this.next();
      if (!this.on) return;
      const btn = settings.scheme === 'buttons';
      const keys = !coarse;
      const caps = keys
        ? ['← → or A D to switch lanes', '↑ W or Space to jump', '↓ or S to roll']
        : btn ? ['Tap left or right to switch lanes', 'Tap JUMP to jump', 'Tap ROLL to roll under bars']
          : ['Swipe left or right to switch lanes', 'Swipe up to jump', 'Swipe down to roll'];
      const dirs = keys || btn ? ['', '', ''] : [Math.floor(this.t / 1.2) % 2 ? 'r' : 'l', 'u', 'd'];
      hud.tutorial(this.step, 3, dirs[this.step], caps[this.step]);
    },
  };

  // ── pause / resume ──
  function isPaused(now) { return M.paused || now < M.resumeAt; }
  function pauseCode() {
    for (const k of ['gl', 'tap', 'menu', 'hidden', 'sync', 'gone', 'stale']) if (M.reasons.has(k)) return PZ[k];
    return 0;
  }
  function netLogic(now) {
    if (!live) return;
    const inMatch = M.phase === 'countdown' || M.phase === 'run';
    const ps = link.latest();
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
      M.resumeAt = Math.max(M.resumeAt, now + RESUME_DELAY);
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
      lastTs = 0;
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
    for (const w of locals) {
      const p = players[w];
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
        case E_STUMBLE: if (mine) { audio.play('stumble'); if (Math.random() < 0.4) v.pop('Oof', 'bad'); } shake(p.w, 0.28); fx.dust(r.x, r.y, r.z, 5, 1); break;
        case E_CRASH:
          if (mine) { audio.play('crash'); audio.duck(1400); v.flash(); v.pop(val === 2 ? 'FELL!' : val === 3 ? 'SLAMMED!' : 'CRASH!', 'bad'); }
          shake(p.w, 0.7);
          fx.crash(r.x, r.y, r.z);
          fx.stars(r.x, r.y + 2.0, r.z, 3, 1.5);
          if (r.out && p.outT < 0) p.outT = r.t;
          break;
        case E_RESPAWN: fx.dust(r.x, 0, r.z, 8, 1.2); if (mine) audio.play('pickup'); break;
        case E_SHIELD: fx.burst(r.x, r.y + 1.1, r.z, P.hl, 16, 6); if (mine) { audio.play('shield'); v.pop('Shield saved you', 'hl'); } shake(p.w, 0.3); break;
        case E_CLOSE: if (mine) { audio.play('close'); v.pop('Close call!', 'hl', '+2'); } break;
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
    } else {
      pub.z = 0; pub.x = (meW === 'a' ? -1 : 1) * LANE_W; pub.y = 0; pub.g = 0; pub.vy = 0; pub.sp = 0; pub.st = 0; pub.dt = 0; pub.rt = 0; pub.rp = 0;
      pub.l = meW === 'a' ? -1 : 1; pub.f = 0; pub.h = HEARTS; pub.c = 0; pub.fn = -1; pub.w = 0; pub.sv = 0; pub.cb = 0;
    }
    link.publish(pub);
  }

  // ── frame ──
  let hudT = 0;
  let scoreT = 0;
  let tAnim = 0;
  function frame(ts) {
    if (dead) return;
    raf = requestAnimationFrame(frame);
    const dtMs = lastTs ? Math.min(250, ts - lastTs) : 16.7;
    lastTs = ts;
    const dt = dtMs / 1000;
    const w0 = performance.now();
    const now = clock();
    tAnim += dt;
    if (M.phase === 'over' && (perf.n % 6) !== 0) { perf.n++; return; } // idle behind the end card
    logic(now, dt);
    if (!glLost) render(dt, now);
    track(dtMs, performance.now() - w0);
  }

  function logic(now, dt) {
    if (live) netLogic(now);
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
      rules.tick(now, dt);
      deliver();
      const res = rules.verdict();
      if (res) endMatch(res);
    } else if (M.phase === 'countdown') M.lastNow = now;
    else if (M.phase === 'finale') { if (rules) rules.tick(now, dt); if (now >= M.endAt) toOver(); }
    // render states
    for (const w of ['a', 'b']) {
      const p = players[w];
      if (p.local && p.r) updateLocalRS(p, now, dt);
      else if (!p.local && live && M.phase !== 'lobby') updateRemoteRS(p, now);
      else updateIdleRS(p);
    }
    // magnet flyers
    for (const w of locals) {
      const p = players[w];
      for (const f of p.fly) {
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
    tutorial.update(dt);
    hudT += dt;
    updateHud(now, dt);
    if (live && ready3D) publish();
    if (M.phase === 'run') {
      scoreT += dt;
      if (scoreT > 0.5) {
        scoreT = 0;
        const z = (w) => Math.round(players[w].rs.z);
        api.setScore({ a: z('a') + ' m', b: z('b') + ' m' });
      }
    }
  }

  // ── HUD ──
  function updateHud(now, dt) {
    const paused = isPaused(now);
    // countdowns
    if (M.phase === 'countdown' && !M.paused) {
      const s = Math.ceil((Math.max(M.startAt, M.resumeAt) - now) / 1000);
      hud.count(s > 0 ? String(Math.min(3, s)) : '', M.mode ? MODE_LABEL[M.mode] : '');
      const k = `c${s}`;
      if (hudBeep !== k && s > 0 && s <= 3) { hudBeep = k; audio.play('tick'); }
    } else if (M.phase === 'run' && !M.paused && now < M.resumeAt) {
      const s = Math.ceil((M.resumeAt - now) / 1000);
      hud.count(String(Math.min(3, Math.max(1, s))), 'Get ready');
      const k = `r${s}`;
      if (hudBeep !== k) { hudBeep = k; audio.play('tick'); }
    } else if (M.phase === 'run' && !paused && M.steps < 70 && M.runMs < 700) {
      hud.count('RUN!');
      if (hudBeep !== 'go') { hudBeep = 'go'; audio.play('go'); }
    } else hud.count('');
    // pause card
    if ((M.phase === 'run' || M.phase === 'countdown') && M.paused) {
      const pn = live ? api.name(other(meW)) : '';
      let info;
      if (M.reasons.has('gl')) info = { title: 'Graphics hiccup', text: 'Your phone reset the 3D view. One moment…' };
      else if (M.reasons.has('tap')) info = { title: 'Back in a sec', text: 'Tap to pick up where you left off.', resume: true, resumeLabel: 'Tap to resume' };
      else if (M.reasons.has('menu')) info = { title: 'Paused', text: live ? `${pn} is paused too.` : '', resume: true };
      else if (M.reasons.has('gone') || M.reasons.has('stale')) info = { title: `Waiting for ${pn}`, text: 'Their connection dropped. The run picks up where you left off when they’re back.' };
      else if (M.reasons.has('sync')) info = { title: `Getting ${pn} back in`, text: 'Syncing the run…' };
      else if (M.partnerPz) info = { title: `${pn} paused`, text: M.partnerPz === PZ.hidden ? `${pn} switched apps. Hang tight.` : M.partnerPz === PZ.menu ? 'They’ll be right back.' : M.partnerPz >= PZ.gone ? 'Reconnecting…' : 'One moment…' };
      else info = { title: 'Paused', text: '' };
      hud.pause(info);
    } else hud.pause(null);
    if (M.phase === 'lobby' || M.phase === 'loading') return;

    // per view
    const sp = viewers.reduce((m, w) => Math.max(m, players[w].rs.speed), 0);
    const boost = viewers.some((w) => players[w].rs.boost);
    const sl = M.phase === 'run' && !paused ? clamp((sp - 17) / 13, 0, 1) * 0.55 + (boost ? 0.35 : 0) : 0;
    if (Math.abs(sl - (speedEl._v || 0)) > 0.01) { speedEl._v = sl; speedEl.style.opacity = sl.toFixed(2); }
    if (sl > 0.02) speedEl.style.transform = `rotate(${(Math.random() * 6).toFixed(1)}deg) scale(${(1 + Math.random() * 0.04).toFixed(3)})`;
    audio.setIntensity(clamp((sp - 12) / 16, 0, 1));
    for (const w of viewers) {
      const p = players[w]; const v = p.view; const r = p.r;
      if (!v || !r) continue;
      const q = players[other(w)];
      const qs = q.rs;
      const qh = q.local ? (q.r ? q.r.hearts : 0) : q.net.h;
      if (M.mode === 'tandem') {
        const th = live && !isHost ? (q.net.th || M.th) : M.th;
        v.hearts(Math.max(0, th), TEAM_HEARTS_MAX, 'var(--g-bad)');
        const tc = r.coins + (q.local ? (q.r ? q.r.coins : 0) : q.net.c);
        v.coins(tc);
        const goal = live && !isHost ? (q.net.tg || M.goal) : M.goal;
        v.bar(true, Math.min(1, tc / goal), 0, 'var(--g-hl)', '', '', '');
        v.gap(`${tc} / ${goal} coins together`);
        if (!isHost && live && q.net.th > (p._th || 0) && p._th) { v.pop('+1 heart', 'good', 'coin goal reached'); audio.play('heart'); }
        if (live) p._th = q.net.th;
      } else {
        v.hearts(r.hearts, HEARTS, `var(--p-${w})`);
        v.coins(r.coins);
      }
      v.dist(Math.max(0, Math.floor(p.rs.z)));
      const gapM = Math.round(qs.z - p.rs.z);
      if (M.mode === 'race') {
        v.bar(true, clamp(p.rs.z / M.len, 0, 1), clamp(qs.z / M.len, 0, 1), `var(--p-${w})`, `var(--p-${q.w})`, p.name[0], q.name[0]);
        v.gap(Math.abs(gapM) < 1 ? `${q.name} level with you` : `${q.name} ${gapM > 0 ? '+' : '−'}${Math.abs(gapM)} m`);
        v.weapon(p.weaponRoll > 0 ? WEAPON_IDX[1 + (Math.floor(tAnim * 12) % 5)] : p.weapon, true);
      } else if (M.mode === 'brawl') {
        v.bar(false);
        v.gap(Math.abs(gapM) <= 2 ? `Side by side with ${q.name}!` : `${q.name} ${gapM > 0 ? '+' : '−'}${Math.abs(gapM)} m`);
      }
      v.partner(M.mode === 'brawl' ? `${q.name} · ${'♥'.repeat(Math.max(0, qh))}` : `${q.name} · ${Math.max(0, Math.floor(qs.z)).toLocaleString('en-US')} m`, `var(--p-${q.w})`);
      v.powers(r.magnetT / 10, r.sneakersT / 10, r.shield, r.boostT / 2.2);
      // oncoming train warning + horn
      let warn = false; let warnLane = 0;
      const ci = Math.floor(r.z / CHUNK);
      for (let c = ci; c <= ci + 1; c++) {
        for (const o of M.track.chunk(c).obs) {
          if (o.t !== O_MTRAIN) continue;
          if (r.z >= o.zm - MT_LEAD && r.z < o.zm + 1) {
            warn = true; warnLane = o.lane;
            if (p.lastHorn !== o.id) { p.lastHorn = o.id; audio.play('horn'); }
          }
        }
      }
      v.warn(warn && M.phase === 'run', warnLane * 2.3);
      // tandem banners
      if (M.mode === 'tandem' && M.phase === 'run') {
        if (r.down && p.downId) {
          const left = Math.max(0, Math.ceil((p.downAt + 10000 - now) / 1000));
          v.banner(`You’re down! ${q.name} can revive you<b>${left}</b>`); v.bannerNum(left);
        } else if (p.revive) {
          const left = Math.max(0, Math.ceil((p.revive.until - now) / 1000));
          v.banner(`${q.name} is down! Grab the glowing heart<b>${left}</b>`); v.bannerNum(left);
        } else v.banner(null);
      } else if (M.mode !== 'tandem') v.banner(null);
    }
    // partner name tag (live)
    if (live && players[meW].rig && vec3 && M.phase !== 'lobby') {
      const q = players[other(meW)];
      const me = players[meW].rs;
      const dz = q.rs.z - me.z;
      if (dz > -6 && dz < 150 && q.rs.visible && !(Math.abs(dz) < 3 && Math.abs(q.rs.x - me.x) < 1)) {
        vec3.set(q.rs.x, q.rs.y + 2.75, -q.rs.z);
        vec3.project(players[meW].rig.cam);
        const on = vec3.z < 1 && Math.abs(vec3.x) < 1.1 && Math.abs(vec3.y) < 1.1;
        hud.tag(on, (vec3.x * 0.5 + 0.5) * W, (-vec3.y * 0.5 + 0.5) * H, q.name, `var(--p-${q.w})`);
      } else hud.tag(false);
    } else hud.tag(false);
    void dt;
  }
  let hudBeep = '';

  function lobbyUI() {
    if (!ready3D) return;
    const keys = split ? `<div><b>${esc(api.name('a'))}</b><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> · weapon <kbd>E</kbd></div><div><b>${esc(api.name('b'))}</b><kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd> · weapon <kbd>Enter</kbd></div>` : '';
    if (!live) { hud.lobby({ mode: M.lobbyMode, canPick: true, canStart: true, startLabel: 'Start', status: '', keys }); return; }
    const pn = api.name(other(meW));
    const ps = link.latest();
    const fresh = ps && link.age() < 2000;
    if (isHost) {
      const pin = partnerHere && fresh && ps.ph === PH.lobby && ps.sy;
      const status = !partnerHere ? `Waiting for ${esc(pn)}…` : !pin ? `${esc(pn)} is getting ready…` : ps.rd ? `<span class="rr-ok">${esc(pn)} is ready</span>` : `${esc(pn)} is here · you pick the mode`;
      hud.lobby({ mode: M.lobbyMode, canPick: true, canStart: !!pin, startLabel: 'Start', status, keys });
    } else {
      const hm = fresh && ps.ph === PH.lobby ? MODES[ps.md] : null;
      if (hm) M.lobbyMode = hm;
      const status = `${esc(pn)} picks the mode${link.synced ? '' : ' · syncing clocks…'}`;
      hud.lobby({ mode: M.lobbyMode, canPick: false, canStart: link.synced, startLabel: M.ready ? 'Ready!' : 'I’m ready', status, keys });
    }
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function hudToast(m) { try { api.toast(m); } catch { /* ignore */ } }

  // ── render ──
  function render(dt, now) {
    for (const w of ['a', 'b']) {
      const p = players[w];
      p.rs.t = tAnim;
      p.av.update(dt, p.rs);
    }
    fx.update(dt, tAnim);
    const tr = M.track || lobbyTrack;
    const zs = viewers.map((w) => players[w].rs.z);
    world.ensure(tr, zs, M.phase === 'run' ? 1 : 9);
    // blob shadows
    let ns = 0;
    for (const w of ['a', 'b']) {
      const s = players[w].rs;
      if (!s.visible || s.y < -1) continue;
      const hgt = Math.max(0, s.y - s.ground);
      const L = shadowList[ns++];
      L[0] = s.x; L[1] = s.ground; L[2] = s.z; L[3] = Math.max(0.5, 1.3 - hgt * 0.18);
    }
    world.setShadows(shadowList, ns);
    renderer.info.reset();
    const vw = split ? W / 2 : W;
    if (split) renderer.setScissorTest(true);
    for (let i = 0; i < viewers.length; i++) {
      const p = players[viewers[i]];
      const rg = p.rig;
      let mode = 'run';
      let tg = p.rs;
      if (M.phase === 'lobby' || M.phase === 'loading') mode = 'lobby';
      else if (M.phase === 'finale' || M.phase === 'over') { mode = 'finale'; const w = M.result && M.result.winner; tg = w ? players[w].rs : p.rs; }
      else if (M.mode === 'tandem' && p.rs.down && p.r && p.r.hold && p.rs.downT > 0.9) { mode = 'spectate'; tg = players[other(p.w)].rs; }
      rg.update(dt, mode, tg, tAnim);
      world.syncView({ track: tr, z: p.rs.z, r: p.r, time: tAnim, boxes: M.mode === 'race' && M.phase !== 'lobby', fly: p.fly });
      world.follow(rg.cam);
      if (split) { renderer.setViewport(i * vw, 0, vw, H); renderer.setScissor(i * vw, 0, vw, H); }
      else renderer.setViewport(0, 0, W, H);
      renderer.render(world.scene, rg.cam);
    }
    if (split) renderer.setScissorTest(false);
    perf.calls = renderer.info.render.calls; perf.tris = renderer.info.render.triangles;
    if (M.phase === 'run') perf.maxCalls = Math.max(perf.maxCalls, perf.calls);
    void now;
  }

  // ── perf + dynamic resolution ──
  function track(dtMs, workMs) {
    const i = perf.n % 600;
    perf.dts[i] = dtMs; perf.work[i] = workMs; perf.n++;
    ewma = ewma * 0.9 + dtMs * 0.1;
    checkT += dtMs;
    if (checkT < 500 || !renderer) return;
    checkT = 0;
    if (dbg && dbg.fixedScale) return;
    if (ewma > 18.8 && scale > 0.6) { scale = Math.max(0.6, +(scale - 0.1).toFixed(2)); lowFor = 0; resize(); }
    else if (ewma < 15.6) { lowFor += 500; if (lowFor >= 3000 && scale < 1) { scale = Math.min(1, +(scale + 0.05).toFixed(2)); lowFor = 0; resize(); } }
    else lowFor = 0;
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
            crashes: r ? r.crashes : 0, stumbles: r ? r.stumbles : 0, shield: s.shield, weapon: p.weapon, stats: p.stats, auto: p.auto, tokens: r ? r.tokens.filter((t) => t.alive).length : 0,
            splat: p.view ? p.view.splatted : false, extra: r ? r.extra.length : 0, revive: !!p.revive, zap: r ? r.zapT : 0, stumbleT: r ? r.stumbleT : 0,
          };
        };
        return {
          phase: M.phase, mode: M.mode, lobbyMode: M.lobbyMode, live, me: meW, host: isHost, seed: M.seed, len: M.len, now: clock(), startAt: M.startAt,
          startedWall: M.startedWall, firstRunWall: M.firstRunWall, runMs: M.runMs, steps: M.steps, paused: M.paused, resumeAt: M.resumeAt, reasons: [...M.reasons], partnerPz: M.partnerPz,
          th: M.th, goal: M.goal, result: M.result, synced: live ? link.synced : true, rtt: live ? link.rtt : 0, partnerHere,
          scale, dpr: renderer ? renderer.getPixelRatio() : 0, glLost, chunks: world ? world.chunkCount() : 0, ready3D,
          a: one('a'), b: one('b'), pending: live ? link.pending() : 0, tutorial: tutorial.on,
        };
      },
      perf() {
        return {
          frames: perf.n, p50: pct(perf.dts, perf.n, 0.5), p95: pct(perf.dts, perf.n, 0.95), work50: pct(perf.work, perf.n, 0.5), work95: pct(perf.work, perf.n, 0.95),
          calls: perf.calls, maxCalls: perf.maxCalls, tris: perf.tris, scale, dpr: renderer ? renderer.getPixelRatio() : 0,
          geometries: renderer ? renderer.info.memory.geometries : 0, textures: renderer ? renderer.info.memory.textures : 0, programs: renderer && renderer.info.programs ? renderer.info.programs.length : 0,
        };
      },
      resetPerf() { perf.n = 0; perf.maxCalls = 0; },
      input(w, a) { onAction(w || meW || 'a', { left: A_LEFT, right: A_RIGHT, up: A_UP, down: A_DOWN, use: A_USE }[a] || a); },
      auto(w, on) { const p = players[w || meW]; if (p) p.auto = on !== false; },
      give(w, kind) { const p = players[w || meW]; if (!p || !p.r) return false; if (kind === 'shield') { p.r.shield = 1; return true; } if (kind === 'magnet') { p.r.magnetT = 10; return true; } p.weapon = kind; p.weaponRoll = 0; return true; },
      crash(w) { const p = players[w || meW]; if (p && p.r && !p.r.down) { p.r.invulnT = 0; p.r.shield = 0; crash(p.r, C_FORCED, false); drain(p); } },
      setHearts(w, n) { const p = players[w || meW]; if (p && p.r) p.r.hearts = n; },
      teamHearts(n) { M.th = n; },
      mode(m) { if (isHost && M.phase === 'lobby') { M.lobbyMode = m; } },
      start() { hostStart(); },
      trackHash: (seed, n) => trackHash(seed, n),
      botRun: (seed, n) => botRun(seed, n),
      inputStats: () => (input ? input.stats : null),
      get canvas() { return renderer ? renderer.domElement : null; },
      instances: () => liveGames,
      get internals() { return { renderer, world, fx, players, THREE, M }; },
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
