// Blend & Seek — game controller: boot, phases (host director), network handlers, input,
// painting, cameras, per-frame update and the test hook.
import { createLink, FIELDS } from './link.js';
import { createSound } from './sound.js';
import { createStage } from './stage.js';
import { createHud } from './hud.js';
import { createControls } from './controls.js';
import { POSES, REGION_OF_PART, REGION_NAMES } from './avatar.js';
import { loadingCard, errorCard, lobbyCard, titleCard, blindCard, curtainCard, recapCard, pauseCard, ctxCard } from './cards.js';
import { clamp, dampAngle, wrapAngle, hexToRgb, cssColor, luminance, listeners, fmtTime, mixHex, esc } from './util.js';

const DUR0 = { title: 1800, hide: 60000, lockMax: 7000, seekLead: 1600, seek: 90000, found: 3400, recap: 9000, resume: 3000, lead: 380, foundLead: 260 };
const ROUNDS = { hs: 4, db: 3 };
const PELLETS = { hs: 6, db: 5 };
const SCAN_CD = 30000;
const GLINT_MS = 400;
const BONUS = 30;
const SPEED = { hide: 3.0, seek: 3.3, db: 1.1, scurry: 6.2 };
const BRUSH = [0.035, 0.065, 0.11];
const EYE_H = { stand: 0.46, crouch: 0.36, ball: 0.3, flat: 0.2, wall: 0.4 };
const TAG_TOL = 0.75;
const TAG_WINDOW = 250;
const other = (w) => (w === 'a' ? 'b' : 'a');

export function createGame(el, api) {
  const local = api.mode !== 'live';
  const isHost = local || !!api.isHost;
  const me = local ? null : api.me;
  const L = listeners();
  const testing = typeof window !== 'undefined' && window.__chamTest === true;
  const DUR = { ...DUR0, ...(testing && window.__chamTune ? window.__chamTune : {}) };

  // ── DOM ──
  el.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'chm';
  root.innerHTML = '<div class="chm-view"></div><div class="chm-surface"></div>';
  el.appendChild(root);
  const view = root.querySelector('.chm-view');
  view.style.cssText = 'position:absolute;inset:0';
  const surface = root.querySelector('.chm-surface');
  const hud = createHud(root, api);
  hud.layer('loading', loadingCard('Mixing paints…', 0.1));
  const snd = createSound();

  // theme
  function readTheme() {
    const t = api.tokens();
    const bg = cssColor(root, t.bg || '#f4f2ee', '#f4f2ee');
    const ink = cssColor(root, t.ink || '#1d1b22', '#1d1b22');
    const card = cssColor(root, t.card || '#ffffff', '#ffffff');
    const outline = luminance(ink) < luminance(bg) ? ink : bg; // ink outlines stay dark in dark mode
    return { bg, ink, card, outline: luminance(outline) > 0.35 ? '#1d1b22' : outline, a: cssColor(root, 'var(--p-a)', '#2f5bea'), b: cssColor(root, 'var(--p-b)', '#f0428b'), hl: cssColor(root, 'var(--g-hl)', '#ffd23f'), dark: !!t.dark };
  }
  let theme = readTheme();

  // ── state ──
  const S = {
    boot: 'loading', // loading | ready | error
    setup: { mode: 'hs', map: 'living', first: Math.random() < 0.5 ? 'a' : 'b' },
    match: null, // { id, mode, map, first, rounds, scores, hist }
    phase: { name: 'lobby', seq: 0, round: 0, at: 0, end: 0, dur: 0, data: null },
    queue: [],
    hostSeq: 0,
    paused: null, // { reason, remaining }
    resumeAt: 0,
    pauseReasons: new Set(),
    partnerHidden: false,
    helloEpoch: -1,
    setupVer: 0,
    partnerKeep: null,
    actor: null, // local mode: who is holding the device
    curtainUp: false,
    ctxLost: false,
    hidden: false,
    destroyed: false,
    finished: false,
  };
  const R = freshRound(0);
  function freshRound(round) {
    return {
      round, pellets: { a: 0, b: 0 }, maxPellets: 0, scanReady: { a: 0, b: 0 }, scurried: { a: false, b: false }, ready: new Set(), acks: new Set(),
      paintSum: { a: 0, b: 0 }, paintOk: { a: false, b: false }, glintAt: { a: -1e9, b: -1e9 }, trailUntil: { a: 0, b: 0 }, trailNext: 0,
      pendingTag: 0, foundSent: false, out: { a: false, b: false }, outSent: false, tagWindow: null,
      path: [], pathNext: 0, closest: Infinity, passes: 0, near: false, seekStart: 0, used: { a: 0, b: 0 }, lockSent: false, rec: null,
      scurry: null, endingHide: false, lockDone: false, toRecap: false, nexting: false, jumpReq: false, lastTick: 0, lastTrailT: 0,
    };
  }

  // physics bodies for locally controlled players
  const mkBody = () => ({ x: 0, y: 0, z: 0, vy: 0, r: 0.24, onGround: true, yaw: 0, pose: 'stand', wallN: null, wa: 0, lookYaw: 0, lookPitch: 0, speed: 0, vis: 1 });
  const body = { a: mkBody(), b: mkBody() };
  const rem = {}; for (const f of FIELDS) rem[f] = 0;
  const remT = {}; for (const f of FIELDS) remT[f] = 0;
  const hist = { t: new Float64Array(96), x: new Float32Array(96), y: new Float32Array(96), z: new Float32Array(96), n: 0, i: 0 };

  // view/camera state
  const C = { cardCheck: 0, frameY: 0, frameCard: false, oy: 0, orbitBase: 0, orbitT: 0, yaw: Math.PI, pitch: 0.32, dist: 2.3, paintYaw: 0, paintPitch: 0.3, paintDist: 1.25, fpYaw: 0, fpPitch: 0, orbit: 0, whip: 0, freezeUntil: 0, shake: 0 };
  const P = { on: false, tool: 'brush', size: 1, hard: true, rgb: [74, 132, 116], last: null, lastHit: [0, 0, 0], strokes: 0, texelDirtyAt: 0 };
  let posesOpen = false;
  const shownHints = new Set();
  const stats = { frames: new Float32Array(240), fi: 0, fn: 0, calls: 0, tris: 0, ewma: 16, lastScale: 0, phaseLog: [], violations: 0, renders: 0 };
  let stage = null; let THREE = null; let controls = null;
  let raf = 0; let lastT = 0; let tSec = 0;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!S.destroyed) fn(); }, ms); timers.add(t); return t; };

  // ── link ──
  const link = createLink(api, {
    delay: 100,
    onLink: () => onLinked(),
    onUnlink: () => { addPause('away'); },
  });
  const now = () => link.now();

  // ── roles ──
  const mode = () => (S.match ? S.match.mode : S.setup.mode);
  function hiderOf(round) { const m = S.match; if (!m || m.mode !== 'hs') return null; return round % 2 === 1 ? m.first : other(m.first); }
  function roleOf(w) {
    if (!S.match || !S.phase.round) return null;
    if (S.match.mode === 'db') return 'both';
    return hiderOf(S.phase.round) === w ? 'hider' : 'seeker';
  }
  /** Whose eyes the screen shows. */
  function viewer() {
    if (!local) return me;
    return S.actor;
  }
  /** Players this device simulates. */
  const controlsOf = (w) => local || w === me;

  // ── boot ──
  api.three().then((T) => {
    if (S.destroyed) return;
    THREE = T;
    hud.layer('loading2', loadingCard('Building the diorama…', 0.45));
    later(() => boot(), 30);
  }).catch((e) => {
    if (S.destroyed) return;
    S.boot = 'error';
    hud.layer('error', errorCard(e && e.message ? e.message : 'Couldn’t load the 3D engine.'));
  });

  function boot() {
    try {
      stage = createStage(THREE, view, { theme, maxDpr: DUR.maxDpr || 2 });
      if (testing) window.__chamGL = (window.__chamGL || 0) + 1;
      stage.resize();
      stage.loadMap(S.setup.map);
      setLivery('a', 'lobby'); setLivery('b', 'lobby');
      placeLobby();
      controls = createControls({ surface, root, joyBase: hud.el.joy, joyKnob: hud.el.knob, onAction: action, paint: paintGestures, isActive: () => !S.destroyed && S.boot === 'ready' });
      hud.layer('loading3', loadingCard('Warming up the paint…', 0.8));
      stage.compile();
      stage.render();
    } catch (e) {
      console.error('chameleon boot', e);
      S.boot = 'error';
      hud.layer('error', errorCard('Your device couldn’t start the 3D view.'));
      return;
    }
    S.boot = 'ready';
    root.classList.toggle('mouse', !!controls.st.usingMouse);
    root.classList.toggle('touch', !controls.st.usingMouse);
    L.on(stage.canvas, 'webglcontextlost', (e) => { e.preventDefault(); S.ctxLost = true; addPause('ctx'); });
    L.on(stage.canvas, 'webglcontextrestored', () => { onContextRestored(); });
    if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(() => { if (stage) stage.resize(); fullCheck(); }); ro.observe(root); cleanup.push(() => ro.disconnect()); }
    else L.on(window, 'resize', () => stage && stage.resize());
    fullCheck();
    const retheme = () => { if (!stage) return; theme = readTheme(); stage.setTheme(theme); };
    try { L.on(matchMedia('(prefers-color-scheme: dark)'), 'change', retheme); } catch { /* old Safari */ }
    if (typeof MutationObserver !== 'undefined') { const mo = new MutationObserver(retheme); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] }); cleanup.push(() => mo.disconnect()); }
    if (local) setPhase({ seq: 0, name: 'lobby', round: 0, at: now(), dur: 0, data: null });
    lastT = performance.now();
    raf = requestAnimationFrame(frame);
    hostTimer = setInterval(() => { if (!S.hidden) hostTick(); }, 200);
    if (link.ready && !local) onLinked();
  }
  const cleanup = [];
  let hostTimer = 0;
  function fullCheck() { const r = root.getBoundingClientRect(); root.classList.toggle('is-full', r.top < 4); }

  // ── liveries ──
  // A face for every chameleon: a long smile and cheek blush, painted into the skin texture
  // (so a hider can paint over it — only the eyes can't be hidden).
  const smile = (x, y, z) => {
    if (z < 0.12) return 0;
    const yM = -0.006 + (0.29 - z) * 0.2;
    const d = Math.abs(y - yM);
    return d < 0.0075 ? 1 : d < 0.011 ? 0.4 : 0;
  };
  const blush = (x, y, z) => {
    const d = Math.hypot(Math.abs(x) - 0.092, y - 0.018, z - 0.19);
    return d < 0.022 ? 0.7 : d < 0.03 ? 0.3 : 0;
  };
  function face(p, base) {
    const mouth = hexToRgb(mixHex(base, '#1d1b22', 0.62));
    const cheek = hexToRgb(mixHex(base, '#ff6b8f', 0.38));
    p.paintLocal(1, blush, cheek);
    p.paintLocal(1, smile, mouth);
  }
  function setLivery(w, kind) {
    const p = stage.paints[w];
    if (kind === 'white') { p.reset([250, 250, 246]); face(p, '#faf9f5'); p.clearUndo(); return; }
    const inkHex = w === 'a' ? theme.a : theme.b;
    p.reset(hexToRgb(inkHex));
    p.tintFacing(0, -1, 0, 0.45, hexToRgb(mixHex(inkHex, '#ffffff', 0.72)), 'body');
    p.tintFacing(0, 1, 0, 0.75, hexToRgb(mixHex(inkHex, '#000000', 0.18)), 'body');
    face(p, inkHex);
    p.clearUndo();
  }

  function placeLobby() {
    const s = stage.map.spots.lobby || { x: 0, z: 0.9 };
    for (const w of ['a', 'b']) {
      const b = body[w]; b.x = s.x + (w === 'a' ? -0.55 : 0.55); b.z = s.z; b.yaw = w === 'a' ? 1.2 : -1.2; b.pose = 'stand'; b.wallN = null; b.vis = 1; b.vy = 0;
      b.y = stage.world.groundAt(b.x, b.z, 0.2, 2);
      stage.av[w].setPose('stand', true);
    }
  }

  // ── host director ─────────────────────────────────────────────────
  function matchInfo() { const m = S.match; return m ? { id: m.id, mode: m.mode, map: m.map, first: m.first, rounds: m.rounds, hist: m.hist } : null; }
  function enter(name, { round, dur = 0, data = null, at = null } = {}, lead = DUR.lead) {
    if (!isHost) return;
    if (!local && lead > 0) lead = Math.max(lead, leadFor());
    const p = { seq: ++S.hostSeq, name, round: round ?? S.phase.round, at: at != null ? Math.max(at, now() + 40) : now() + lead, dur, data, sc: S.match ? { ...S.match.scores } : { a: 0, b: 0 }, m: matchInfo() };
    if (!local) { link.send('ph', p); link.blast('ph', p); }
    queuePhase(p);
  }
  function hostStart() {
    if (!isHost || S.match) return;
    const st = S.setup;
    if (local && st.mode === 'db') st.mode = 'hs';
    S.match = { id: Math.random().toString(36).slice(2, 9), mode: st.mode, map: st.map, first: st.first, rounds: ROUNDS[st.mode], scores: { a: 0, b: 0 }, hist: [] };
    startRound(1);
  }
  /** How far ahead to schedule a shared moment so the message is there in time. */
  function leadFor() { return Math.max(DUR.lead, Math.min(1200, link.rtt * 1.3 + 160)); }
  /** Two devices: after the seek clock hits zero, how long a shot fired just before it may take
   *  to be confirmed by the victim (shooter → victim → host) before time is called. */
  function tagGrace() { return local ? 0 : Math.min(1600, link.rtt * 1.2 + 250); }
  function startRound(r, at = null) {
    if (local) enter('curtain', { round: r, data: { kind: 'hide', who: hiderOfRound(r) }, at }, 0);
    else enter('hide', { round: r, dur: DUR.hide, at: at != null ? at + DUR.title : null }, DUR.title);
  }
  function hiderOfRound(r) { const m = S.match; return r % 2 === 1 ? m.first : other(m.first); }
  function endHide(at = null) {
    if (!isHost || S.phase.name !== 'hide' || R.endingHide) return;
    R.endingHide = true;
    if (local) {
      const h = hiderOf(S.phase.round);
      later(() => lockPaint(h), Math.max(0, (at ?? now()) - now()));
      enter('curtain', { data: { kind: 'seek', who: other(h) }, at }, 0);
    } else enter('lock', { dur: DUR.lockMax, at });
  }
  function lockDone() {
    if (!isHost || S.phase.name !== 'lock' || R.lockDone) return;
    R.lockDone = true;
    enter('seek', { dur: DUR.seek }, DUR.seekLead);
  }
  function needAcks() { return mode() === 'db' ? ['a', 'b'] : [hiderOf(S.phase.round)]; }
  function hostAck(w) {
    R.acks.add(w);
    if (needAcks().every((x) => R.acks.has(x))) lockDone();
  }
  function roundOver(res) {
    if (!isHost || R.foundSent || S.phase.name !== 'seek') return;
    R.foundSent = true;
    const m = S.match; const r = S.phase.round;
    // time into the hunt, excluding pauses (phase.end moves when the game pauses)
    const elapsed = res.found ? clamp(S.phase.dur - (S.phase.end - res.T), 0, S.phase.dur) : S.phase.dur;
    let rec;
    if (m.mode === 'hs') {
      const h = hiderOf(r);
      const ms = elapsed;
      const points = Math.floor(ms / 1000) + (res.found ? 0 : BONUS);
      m.scores[h] += points;
      rec = { round: r, hider: h, seeker: other(h), found: !!res.found, ms: Math.round(ms), points, outOfPellets: !!res.out, p: res.p || null };
    } else {
      const wnr = res.found ? res.by : null;
      if (wnr) m.scores[wnr] += 1;
      rec = { round: r, winner: wnr, victim: res.found ? res.victim : null, found: !!res.found, ms: Math.round(elapsed), p: res.p || null, hider: res.found ? res.victim : null, seeker: wnr };
    }
    m.hist = [...m.hist, rec];
    enter(res.found ? 'found' : 'time', { dur: DUR.found, data: rec, at: res.at ?? null }, local ? 0 : DUR.foundLead);
  }
  function hostFound(by, victim, T, p) {
    if (!isHost || S.phase.name !== 'seek' || R.foundSent) return;
    if (!local && T > S.phase.end + 80) return; // fired after the buzzer (clocks agree to a few ms)
    if (mode() === 'hs') { roundOver({ found: true, by, victim, T, p }); return; }
    // Double Blind: earliest confirmed tag within a short window wins
    if (!R.tagWindow) { R.tagWindow = { by, victim, T, p }; later(() => { const t = R.tagWindow; if (t) roundOver({ found: true, ...t }); }, TAG_WINDOW); }
    else if (T < R.tagWindow.T) R.tagWindow = { by, victim, T, p };
  }
  function hostNext(at = null) {
    if (!isHost || S.phase.name !== 'recap' || R.nexting) return;
    R.nexting = true;
    const m = S.match; const r = S.phase.round;
    const decided = m.mode === 'db' && (m.scores.a >= 2 || m.scores.b >= 2);
    if (r < m.rounds && !decided) startRound(r + 1, at);
    else {
      const a = m.scores.a; const b = m.scores.b;
      const winner = a > b ? 'a' : b > a ? 'b' : null;
      enter('final', { data: { winner, a, b }, at });
    }
  }
  /** Called every frame and on a 200 ms timer: advances timed phases. */
  function hostTick() {
    if (!isHost || !S.match || S.paused || S.boot !== 'ready') return;
    const t = now();
    const ph = S.phase;
    if (t < S.resumeAt) return;
    const pre = t >= ph.end - (local ? DUR.lead : leadFor()); // announce ahead so both devices flip at ph.end
    if (S.queue.length) return;
    if (ph.name === 'hide' && ph.dur && pre) endHide(ph.end);
    else if (ph.name === 'lock' && t >= ph.end) lockDone();
    else if (ph.name === 'seek' && local && pre) roundOver({ found: false, at: ph.end });
    // live: a tag fired before the buzzer is still being confirmed for a moment after it
    else if (ph.name === 'seek' && !local && t >= ph.end + tagGrace()) roundOver({ found: false });
    else if ((ph.name === 'found' || ph.name === 'time') && pre && !R.toRecap) { R.toRecap = true; enter('recap', { dur: DUR.recap, data: ph.data, at: ph.end }); }
    else if (ph.name === 'recap' && pre) hostNext(ph.end);
  }

  // ── phases (both devices) ─────────────────────────────────────────
  function queuePhase(p) {
    if (!p || p.seq <= S.phase.seq || S.queue.some((q) => q.seq === p.seq)) return;
    S.queue.push(p);
    S.queue.sort((x, y) => x.seq - y.seq);
    // anything older than the newest must happen now
    while (S.queue.length > 1) setPhase(S.queue.shift());
    const wait = Math.max(0, p.at - now());
    if (wait <= 1) { setPhase(S.queue.shift()); return; }
    later(() => { const i = S.queue.indexOf(p); if (i >= 0) { S.queue.splice(i, 1); setPhase(p); } }, wait);
    // title card while a new round is coming up
    if (p.name === 'hide' && p.round !== S.phase.round) prepareRound(p);
  }

  function adoptMatch(p) {
    if (!p.m) return;
    if (!S.match || S.match.id !== p.m.id) S.match = { ...p.m, scores: { ...(p.sc || { a: 0, b: 0 }) } };
    else { S.match.hist = p.m.hist; S.match.scores = { ...(p.sc || S.match.scores) }; S.match.rounds = p.m.rounds; }
    if (stage && stage.map && stage.map.id !== S.match.map) { stage.loadMap(S.match.map); stage.compile(); }
    api.setScore(S.match.scores);
  }

  function prepareRound(p) {
    adoptMatch(p);
    if (R.round !== p.round) resetRound(p.round);
    S.pendingTitle = p;
  }

  function setPhase(p) {
    if (!p || p.seq <= S.phase.seq) return;
    adoptMatch(p);
    const prev = S.phase.name;
    S.phase = { name: p.name, seq: p.seq, round: p.round, at: p.at, end: p.at + (p.dur || 0), dur: p.dur || 0, data: p.data };
    if (isHost) S.hostSeq = Math.max(S.hostSeq, p.seq);
    S.pendingTitle = null;
    const nw = now();
    stats.phaseLog.push({ name: p.name, seq: p.seq, wall: performance.timeOrigin + performance.now(), at: p.at, now: nw, late: nw - p.at, clock: nw - (performance.timeOrigin + performance.now()) });
    if (stats.phaseLog.length > 80) stats.phaseLog.shift();
    try { onEnter(p, prev); } catch (e) { console.error('chameleon phase', p.name, e); }
  }

  function resetRound(round) {
    const keep = R.round === round;
    if (keep) return;
    Object.assign(R, freshRound(round));
    if (!stage) return;
    stage.fx.clearRound();
    const m = stage.map; const md = mode();
    R.maxPellets = PELLETS[md];
    for (const w of ['a', 'b']) R.pellets[w] = R.maxPellets;
    const h = md === 'hs' ? hiderOfRound(round) : null;
    for (const w of ['a', 'b']) {
      const b = body[w];
      const sp = md === 'db' ? (w === 'a' ? m.spots.spawnA : m.spots.spawnB) : (w === h ? m.spots.hiderSpawn : m.spots.seekerSpawn);
      b.x = sp.x; b.z = sp.z; b.yaw = sp.yaw; b.vy = 0; b.pose = 'stand'; b.wallN = null; b.wa = 0; b.lookYaw = 0; b.lookPitch = 0; b.speed = 0; b.vis = 1;
      b.y = stage.world.groundAt(b.x, b.z, 0.2, 3);
      stage.av[w].setPose('stand', true);
      stage.av[w].st.wallN = null;
      if (md === 'db' || w === h) setLivery(w, 'white'); else setLivery(w, 'ink');
    }
    exitPaint(true);
    posesOpen = false;
    C.yaw = body[h || viewer() || 'a'].yaw + Math.PI; C.pitch = 0.32; C.dist = 2.3;
    P.rgb = [74, 132, 116];
  }

  function onEnter(p, prev) {
    const name = p.name; const t = now();
    const v = viewer();
    switch (name) {
      case 'lobby':
        S.match = null; S.actor = null;
        if (stage) { setLivery('a', 'lobby'); setLivery('b', 'lobby'); placeLobby(); stage.fx.clearRound(); }
        break;
      case 'curtain':
        resetRound(p.round);
        S.actor = null; S.curtainUp = true;
        controls && controls.setMode('none');
        if (p.data && p.data.kind === 'seek') exitPaint(true);
        break;
      case 'hide': {
        resetRound(p.round);
        if (local) S.actor = hiderOf(p.round);
        S.curtainUp = false;
        const vv = viewer();
        snd.play('go');
        if (vv && (roleOf(vv) === 'hider' || roleOf(vv) === 'both')) {
          C.yaw = body[vv].yaw + Math.PI;
          hint(mode() === 'db' ? 'Find a spot, pose, paint. Then hit “Hidden”.' : 'Find a spot, pick a pose, then paint yourself to match.', 3600);
        }
        break;
      }
      case 'lock':
        exitPaint(true);
        posesOpen = false;
        for (const w of ['a', 'b']) if (controlsOf(w) && (roleOf(w) === 'hider' || roleOf(w) === 'both')) lockPaint(w);
        if (v && roleOf(v) === 'seeker') snd.play('beep');
        break;
      case 'seek': {
        exitPaint(true);
        posesOpen = false;
        if (local) S.actor = mode() === 'hs' ? other(hiderOf(p.round)) : S.actor;
        S.curtainUp = false;
        R.seekStart = p.at;
        const vv = viewer();
        if (vv && stage) stage.vm.children[0].material.color.set(vv === 'a' ? theme.a : theme.b);
        if (vv) { C.fpYaw = 0; C.fpPitch = 0; body[vv].lookYaw = 0; body[vv].lookPitch = 0; }
        snd.play('go');
        hud.flash();
        if (vv && roleOf(vv) === 'seeker') hint('Find them. Tap Fire when the crosshair is on them.', 3200);
        else if (vv && roleOf(vv) === 'hider') hint('Stay still. Drag to look. One scurry if they get close.', 3200);
        else if (vv) hint('Hunt them — and don’t get spotted.', 3000);
        break;
      }
      case 'found': case 'time': {
        const rec = p.data || {};
        R.rec = rec;
        C.freezeUntil = tSec + 0.38;
        C.whip = 0;
        exitPaint(true);
        const victim = rec.hider || rec.victim || hiderOf(p.round);
        const winInk = name === 'found' ? (rec.seeker || rec.winner || other(victim)) : victim;
        if (stage) {
          const vb = posOf(victim);
          stage.fx.burst(vb.x, vb.y + 0.4, vb.z, confettiColors(winInk), 110, 1);
          if (name === 'found' && rec.p) stage.fx.splat(rec.p[0], rec.p[1], rec.p[2], 0, 1, 0, winInk === 'a' ? theme.a : theme.b, 0.32, tSec);
        }
        hud.flash();
        const vv = v || winInk;
        const iWon = local ? true : (mode() === 'db' ? rec.winner === me : (name === 'found' ? roleOf(me) === 'seeker' : roleOf(me) === 'hider'));
        snd.play(name === 'found' ? (iWon ? 'found' : 'sad') : (iWon ? 'survive' : 'sad'));
        later(() => snd.play('confetti'), 120);
        api.haptic(60);
        void vv;
        break;
      }
      case 'recap': {
        R.rec = p.data || R.rec;
        C.orbitT = 0;
        const seekerW = R.rec && (R.rec.seeker || (R.rec.winner || null));
        if (stage && R.path.length && seekerW) stage.fx.setPath(R.path, seekerW === 'a' ? theme.a : theme.b);
        if (stage) { const tp = posOf(recapTarget()); stage.fx.ring.position.set(tp.x, tp.y + 0.02, tp.z); stage.fx.ring.visible = true; stage.fx.hlMat.color.set(theme.hl); }
        break;
      }
      case 'final': {
        const d = p.data || {};
        if (isHost && !S.finished) {
          S.finished = true;
          const sc = `${d.a}–${d.b}`;
          const text = d.winner ? `${api.name(d.winner)} blends best` : 'Perfectly matched';
          const sub = mode() === 'db' ? `Rounds won ${sc}` : `Points ${sc} · ${api.name('a')} vs ${api.name('b')}`;
          later(() => api.finish({ winner: d.winner, text, sub }), local ? 300 : 500);
        }
        break;
      }
      default: break;
    }
    void prev; void t;
  }

  function confettiColors(w) { const c = w === 'a' ? theme.a : theme.b; return [c, mixHex(c, '#ffffff', 0.45), mixHex(c, '#000000', 0.25), theme.hl, '#ffffff']; }

  // ── paint lock + sync ─────────────────────────────────────────────
  function lockPaint(w) {
    if (R.lockSent && !local) return;
    const p = stage.paints[w];
    const enc = p.encode();
    p.flush();
    R.paintSum[w] = enc.sum; R.paintOk[w] = true;
    stats.lastPaint = { w, bytes: enc.bytes, b64: enc.b64.length, chunks: Math.ceil(enc.b64.length / 3200) };
    if (!local) {
      R.lockSent = true;
      const b = body[w];
      link.sendBlob('paint', enc.b64, { w, sum: enc.sum, round: R.round, pos: [b.x, b.y, b.z, b.yaw, POSES.indexOf(b.pose), b.wa] });
    }
  }
  link.onBlob('paint', (b64, meta) => {
    if (!meta || !stage) return;
    const w = meta.w;
    if (w === me) return;
    const sum = stage.paints[w].decode(b64);
    stage.paints[w].flush();
    if (sum === meta.sum) {
      R.paintOk[w] = true; R.paintSum[w] = sum;
      if (meta.pos) { const [x, y, z, yaw, po, wa] = meta.pos; remHint.x = x; remHint.y = y; remHint.z = z; remHint.yaw = yaw; remHint.po = po; remHint.wa = wa; remHint.set = true; }
      if (isHost) hostAck(w); else link.send('gotpaint', { w, sum });
    } else link.send('paintreq', { w, round: meta.round });
  });
  const remHint = { set: false, x: 0, y: 0, z: 0, yaw: 0, po: 0, wa: 0 };
  link.on('gotpaint', (d) => { if (isHost && d && S.phase.name === 'lock') hostAck(d.w); });
  link.on('paintreq', (d) => { if (d && d.w === me) { R.lockSent = false; lockPaint(me); } });
  link.on('ph', (p) => { if (!isHost) queuePhase(p); });
  link.on('setup', (d) => { if (!isHost && d) { S.setup = { ...S.setup, ...d }; S.setupVer++; if (stage && !S.match) { stage.loadMap(S.setup.map); placeLobby(); stage.compile(); } } });
  link.on('ready', (d) => { if (isHost && d) { R.ready.add(d.w); if (S.phase.name === 'hide' && (mode() === 'hs' ? R.ready.has(hiderOf(S.phase.round)) : R.ready.size >= 2)) endHide(); } });
  link.on('next', () => { if (isHost) hostNext(); });
  link.on('start', () => { /* guests can't start; ignored */ });
  link.on('out', (d) => { if (isHost && d) hostOut(d.w); });
  link.on('vis', (d) => { if (!isHost || !d) return; S.partnerHidden = !!d.hidden; if (d.hidden) addPause('hidden'); else removePause('hidden'); });
  link.on('pause', (d) => { if (isHost || !d) return; S.paused = { reason: d.reason, remaining: d.remaining }; S.resumeAt = 0; S.phase.end = now() + d.remaining; });
  link.on('resume', (d) => { if (isHost || !d) return; S.paused = null; S.resumeAt = d.at; S.phase.end = d.at + d.remaining; });

  // shots, scans, scurries
  link.on('shot', (d) => onShot(d));
  link.on('tagres', (d) => onTagRes(d));
  link.on('scan', (d) => { if (d) glint(other(d.by), d.at, d.by); });
  link.on('scurry', (d) => { if (d) { R.trailUntil[d.w] = d.at + 650; R.scurried[d.w] = true; if (stage) stage.fx.trailMat.color.set(d.w === 'a' ? theme.a : theme.b); } });

  // snapshot / resync
  link.on('hello', (d) => onHello(d));
  link.on('snapreq', () => { if (S.match) sendSnap(); });
  link.onBlob('snap', (str) => { try { adoptSnap(JSON.parse(str)); } catch (e) { console.error('chameleon snap', e); } });

  function onLinked() {
    if (local || S.destroyed) return;
    if (S.boot !== 'ready') return; // boot() calls us again
    link.send('hello', { started: !!S.match, mid: S.match ? S.match.id : null, seq: S.phase.seq, host: isHost });
    if (isHost && !S.match) link.send('setup', S.setup);
  }
  function onHello(d) {
    if (!d) return;
    S.helloEpoch = link.epoch;
    if (isHost) {
      if (S.match) { sendSnap(); removePause('away'); }
      else if (d.started) link.send('snapreq', {});
      else { link.send('setup', S.setup); removePause('away'); }
    } else if (S.match && !d.started) {
      // host was reloaded: it will ask for our snapshot
    }
  }
  function snapshot() {
    const t = now();
    const tex = {};
    for (const w of ['a', 'b']) if (R.paintOk[w]) { const e = stage.paints[w].encode(); tex[w] = e.b64; }
    const pos = {};
    for (const w of ['a', 'b']) {
      const b = controlsOf(w) ? body[w] : null;
      if (b) pos[w] = [b.x, b.y, b.z, b.yaw, POSES.indexOf(b.pose), b.wa];
      else if (S.partnerKeep) pos[w] = S.partnerKeep;
      else if (rem.v > 0.5) pos[w] = [rem.x, rem.y, rem.z, rem.yaw, Math.round(rem.po), rem.wa];
    }
    const remaining = S.paused ? S.paused.remaining : Math.max(0, S.phase.end - t);
    return {
      v: 1, setup: S.setup, match: S.match, hostSeq: Math.max(S.hostSeq, S.phase.seq),
      phase: { name: S.phase.name, seq: S.phase.seq, round: S.phase.round, dur: S.phase.dur, remaining, data: S.phase.data },
      tex, pos, pellets: R.pellets, scurried: R.scurried, scanIn: { a: Math.max(0, R.scanReady.a - t), b: Math.max(0, R.scanReady.b - t) }, seekElapsed: S.phase.name === 'seek' ? t - R.seekStart : 0,
    };
  }
  function sendSnap() { link.sendBlob('snap', JSON.stringify(snapshot())); S.partnerKeep = null; }
  function adoptSnap(s) {
    if (!s || s.v !== 1 || !stage) return;
    S.setup = s.setup || S.setup; S.setupVer++;
    S.match = s.match;
    if (S.match && stage.map.id !== S.match.map) { stage.loadMap(S.match.map); stage.compile(); }
    const ph = s.phase;
    if (R.round !== ph.round) resetRound(ph.round);
    const t = now();
    S.phase = { name: ph.name, seq: ph.seq, round: ph.round, at: t, end: t + ph.remaining, dur: ph.dur, data: ph.data };
    S.queue.length = 0;
    if (isHost) S.hostSeq = Math.max(S.hostSeq, s.hostSeq || ph.seq);
    for (const w of ['a', 'b']) if (s.tex && s.tex[w]) { stage.paints[w].decode(s.tex[w]); stage.paints[w].flush(); R.paintOk[w] = true; }
    for (const w of ['a', 'b']) if (s.pos && s.pos[w] && controlsOf(w)) { const [x, y, z, yaw, po, wa] = s.pos[w]; const b = body[w]; b.x = x; b.y = y; b.z = z; b.yaw = yaw; b.pose = POSES[po] || 'stand'; b.wa = wa; b.wallN = b.pose === 'wall' ? [Math.sin(wa), 0, Math.cos(wa)] : null; stage.av[w].setPose(b.pose, true); }
    if (s.pellets) R.pellets = { ...s.pellets };
    if (s.scurried) R.scurried = { ...s.scurried };
    if (s.scanIn) { R.scanReady.a = t + s.scanIn.a; R.scanReady.b = t + s.scanIn.b; }
    if (ph.name === 'seek') R.seekStart = t - (s.seekElapsed || 0);
    if (S.match) api.setScore(S.match.scores);
    S.paused = { reason: 'away', remaining: ph.remaining };
    if (isHost) { S.pauseReasons.delete('away'); maybeResume(); }
  }

  // ── pause / resume ────────────────────────────────────────────────
  function addPause(reason) {
    S.pauseReasons.add(reason);
    if (reason === 'away' && !local && S.match && !S.partnerKeep && rem.v > 0.5) {
      S.partnerKeep = [rem.x, rem.y, rem.z, rem.yaw, Math.round(rem.po), rem.wa];
    }
    if (!isHost) { if ((reason === 'hidden' || reason === 'ctx') && !local) link.send('vis', { hidden: true }); return; }
    if (S.paused) return;
    const rem2 = Math.max(0, S.phase.end - Math.max(now(), S.resumeAt));
    S.resumeAt = 0;
    S.paused = { reason, remaining: rem2 };
    if (!local) link.send('pause', { reason, remaining: rem2 });
  }
  function removePause(reason) {
    S.pauseReasons.delete(reason);
    if (!isHost) { if ((reason === 'hidden' || reason === 'ctx') && !local && !S.pauseReasons.has('hidden') && !S.pauseReasons.has('ctx')) link.send('vis', { hidden: false }); return; }
    maybeResume();
  }
  function maybeResume() {
    if (!isHost || !S.paused || S.pauseReasons.size) return;
    if (!local && (!api.partnerHere || !link.ready || S.helloEpoch !== link.epoch)) return;
    const at = now() + DUR.resume;
    const remaining = S.paused.remaining;
    S.paused = null; S.resumeAt = at; S.phase.end = at + remaining;
    if (!local) link.send('resume', { at, remaining });
  }
  const offHere = api.onPartnerHere ? api.onPartnerHere((here) => {
    if (here) { if (link.ready && S.boot === 'ready') link.send('hello', { started: !!S.match, mid: S.match ? S.match.id : null, seq: S.phase.seq, host: isHost }); removePause('away'); }
    else addPause('away');
  }) : null;

  // ── shots ─────────────────────────────────────────────────────────
  let shotSeq = 0;
  function targetOf(w) { return mode() === 'hs' ? hiderOf(S.phase.round) : other(w); }
  function fire() {
    const w = viewer();
    if (!w || !stage || S.phase.name !== 'seek' || frozen()) return;
    if (now() >= S.phase.end) { hint('Time!', 900); return; } // the buzzer went; shots already flying still count
    const role = roleOf(w);
    if (role !== 'seeker' && role !== 'both') return;
    if (R.pellets[w] <= 0) { hint('Out of pellets!'); snd.play('warn'); return; }
    R.pellets[w]--; R.used[w]++;
    const T = now();
    const tgt = targetOf(w);
    const ray = stage.setRayFromScreen(stage.size[0] / 2, stage.size[1] / 2, stage.size[0], stage.size[1]);
    const objs = [stage.mapMesh];
    if (stage.av[tgt].root.visible) for (const m of stage.av[tgt].meshes) objs.push(m);
    const hit = stage.pick(objs, 40);
    const o = ray.ray.origin; const dir = ray.ray.direction;
    const muzzle = { x: o.x + dir.x * 0.3 - 0, y: o.y - 0.08, z: o.z + dir.z * 0.3 };
    const p = hit ? hit.point : { x: o.x + dir.x * 30, y: o.y + dir.y * 30, z: o.z + dir.z * 30 };
    let n = [0, 1, 0];
    if (hit && hit.face) { const nn = hit.face.normal.clone().transformDirection(hit.object.matrixWorld); n = [nn.x, nn.y, nn.z]; }
    const isTag = !!hit && stage.av[tgt].meshes.includes(hit.object);
    const seen = [0, 0, 0];
    if (local) { const b = body[tgt]; seen[0] = b.x; seen[1] = b.y; seen[2] = b.z; }
    else if (link.remoteAt(T, remT)) { seen[0] = remT.x; seen[1] = remT.y; seen[2] = remT.z; }
    const id = ++shotSeq;
    const ink = w === 'a' ? theme.a : theme.b;
    const pp = { x: p.x, y: p.y, z: p.z };
    snd.play('fire'); api.haptic(15); hud.kick(); C.shake = 0.12;
    stage.fx.pellet(muzzle, pp, ink, tSec, () => {
      if (!hit) return;
      snd.play('splat');
      if (!isTag) stage.fx.splat(pp.x, pp.y, pp.z, n[0], n[1], n[2], ink, 0.22 + Math.random() * 0.1, tSec);
    });
    const msg = { id, T, by: w, o: [muzzle.x, muzzle.y, muzzle.z], p: [p.x, p.y, p.z], n, hit: !!hit, tag: isTag, seen, left: R.pellets[w] };
    stats.lastShot = { tag: isTag, hit: !!hit, obj: hit ? (hit.object === stage.mapMesh ? 'map' : 'other') : null, p: msg.p, o: [o.x, o.y, o.z], d: [dir.x, dir.y, dir.z], tgtVisible: stage.av[tgt].root.visible, seen };
    if (isTag) {
      R.pendingTag = id;
      if (local) { hostFound(w, tgt, T, msg.p); return; }
      link.send('shot', msg);
      hint('Hit! Checking…', 900);
    } else {
      if (!local) link.send('shot', msg);
      if (R.pellets[w] === 0) later(() => sendOut(w), 600);
    }
  }
  function sendOut(w) {
    if (R.outSent || R.pellets[w] > 0 || R.pendingTag) return;
    R.outSent = true;
    hint('Out of pellets.', 2000);
    if (isHost) hostOut(w); else link.send('out', { w });
  }
  function hostOut(w) {
    if (!isHost || S.phase.name !== 'seek') return;
    R.out[w] = true;
    if (mode() === 'hs') roundOver({ found: false, out: true });
    else if (R.out.a && R.out.b) roundOver({ found: false, out: true });
  }
  function onShot(d) {
    if (!d || !stage || S.phase.name !== 'seek') return;
    const ink = d.by === 'a' ? theme.a : theme.b;
    R.pellets[d.by] = d.left; R.used[d.by] = R.maxPellets - d.left;
    const from = { x: d.o[0], y: d.o[1], z: d.o[2] }; const to = { x: d.p[0], y: d.p[1], z: d.p[2] };
    if (!d.tag) {
      stage.fx.pellet(from, to, ink, tSec, () => { if (d.hit) { stage.fx.splat(to.x, to.y, to.z, d.n[0], d.n[1], d.n[2], ink, 0.26, tSec); snd.play('splat'); } });
      return;
    }
    stage.fx.pellet(from, to, ink, tSec, null);
    // I am the victim: confirm with my true position history (shooter-favoured, 250 ms)
    const ok = confirmTag(d.T, d.seen);
    stats.lastTagCheck = { ok, T: d.T, seen: d.seen, me: [body[me].x, body[me].y, body[me].z], n: hist.n };
    if (ok) {
      if (isHost) hostFound(d.by, me, d.T, d.p);
      else link.send('tagres', { id: d.id, ok: true, T: d.T, by: d.by, victim: me, p: d.p });
    } else {
      link.send('tagres', { id: d.id, ok: false, by: d.by });
      stage.fx.splat(to.x, to.y, to.z, d.n[0], d.n[1], d.n[2], ink, 0.24, tSec);
    }
  }
  function confirmTag(T, seen) {
    const t0 = T - link.delay - TAG_WINDOW; const t1 = T + 60;
    let any = false;
    for (let k = 0; k < hist.n; k++) {
      const t = hist.t[k];
      if (t < t0 || t > t1) continue;
      any = true;
      if (Math.hypot(hist.x[k] - seen[0], hist.y[k] - seen[1], hist.z[k] - seen[2]) <= TAG_TOL) return true;
    }
    if (!any) { const b = body[me]; return Math.hypot(b.x - seen[0], b.y - seen[1], b.z - seen[2]) <= TAG_TOL; }
    return false;
  }
  function onTagRes(d) {
    if (!d) return;
    if (d.ok) { if (isHost) hostFound(d.by, d.victim, d.T, d.p); return; }
    if (d.by === me) {
      R.pendingTag = 0;
      hint('They slipped away!', 1600); snd.play('warn');
      if (R.pellets[me] === 0) later(() => sendOut(me), 300);
    }
  }

  // ── scan + scurry ─────────────────────────────────────────────────
  function scan() {
    const w = viewer();
    if (!w || S.phase.name !== 'seek' || frozen()) return;
    const role = roleOf(w);
    if (role !== 'seeker' && role !== 'both') return;
    const t = now();
    if (t < R.scanReady[w]) { hint(`Scan ready in ${Math.ceil((R.scanReady[w] - t) / 1000)} s`, 1200); return; }
    R.scanReady[w] = t + SCAN_CD;
    const at = t + 140;
    snd.play('chirp'); hud.ripple();
    glint(targetOf(w), at, w);
    if (!local) link.send('scan', { by: w, at });
  }
  function glint(target, at, by) {
    R.glintAt[target] = at;
    const t = now();
    if (!local && target === me) later(() => { snd.play('glint'); hud.vignette(true); hint('Chirp! Your eyes just glinted.', 1600); later(() => hud.vignette(false), 700); }, Math.max(0, at - t));
    void by;
  }
  function scurry() {
    const w = viewer();
    if (!w || local || S.phase.name !== 'seek' || roleOf(w) !== 'hider' || R.scurried[w] || frozen()) return;
    const b = body[w];
    const yaw = fpBaseYaw(w) + b.lookYaw;
    R.scurried[w] = true;
    R.scurry = { until: tSec + 0.5, vx: Math.sin(yaw) * SPEED.scurry, vz: Math.cos(yaw) * SPEED.scurry };
    b.pose = 'stand'; b.wallN = null; stage.av[w].setPose('stand');
    R.trailUntil[w] = now() + 650;
    stage.fx.trailMat.color.set(w === 'a' ? theme.a : theme.b);
    link.send('scurry', { w, at: now() });
    snd.play('scurry');
  }

  // ── paint mode ────────────────────────────────────────────────────
  function canPaint() {
    const v = viewer();
    return !!v && S.phase.name === 'hide' && (roleOf(v) === 'hider' || roleOf(v) === 'both') && !frozen();
  }
  function enterPaint() {
    if (!canPaint() || P.on) return;
    const v = viewer();
    P.on = true; P.tool = 'brush';
    controls.setMode('paint');
    stage.av[v].st.breathe = false;
    C.paintYaw = body[v].yaw + 0.9; C.paintPitch = 0.32; C.paintDist = 1.3;
    P.texelDirtyAt = tSec + 0.35;
    snd.play('ui');
    root.classList.add('painting');
    hint(controls.st.usingMouse ? 'Drag on your body to paint · drag elsewhere to turn · wheel to zoom' : 'Paint with one finger · two fingers turn and zoom', 3400);
  }
  function exitPaint(silent = false) {
    if (!P.on) return;
    P.on = false; P.last = null;
    root.classList.remove('painting');
    if (stage) { stage.fx.setCursor(false); const v = viewer(); if (v) stage.av[v].st.breathe = true; }
    if (controls) controls.setMode('none');
    if (!silent) snd.play('ui');
  }
  function myMeshes() { const v = viewer(); return v ? stage.av[v].meshes : []; }
  function refreshTexels() { const v = viewer(); if (!v) return; stage.paints[v].updateWorld(stage.av[v].meshes); P.texelDirtyAt = 0; }
  const rgbTmp = [0, 0, 0];
  const paintGestures = {
    begin(x, y) {
      if (!P.on || P.tool !== 'brush') return false;
      if (P.texelDirtyAt) refreshTexels();
      const hit = pickOwn(x, y);
      if (!hit) return false;
      const v = viewer();
      stage.paints[v].snapshot();
      P.last = [hit.point.x, hit.point.y, hit.point.z];
      dabAt(hit);
      showCursor(hit);
      return true;
    },
    hover(x, y) {
      if (!P.on) return;
      const hit = P.tool === 'brush' || P.tool === 'fill' ? pickOwn(x, y) : null;
      if (hit) showCursor(hit); else stage.fx.setCursor(false);
    },
    move(x, y) {
      if (!P.on || !P.last) return;
      const hit = pickOwn(x, y);
      if (!hit) return;
      const r = BRUSH[P.size];
      const dx = hit.point.x - P.last[0]; const dy = hit.point.y - P.last[1]; const dz = hit.point.z - P.last[2];
      const d = Math.hypot(dx, dy, dz);
      const step = r * 0.35;
      if (d < step) return;
      const n = Math.min(12, Math.floor(d / step));
      for (let i = 1; i <= n; i++) {
        const k = i / n;
        dab3(P.last[0] + dx * k, P.last[1] + dy * k, P.last[2] + dz * k);
      }
      P.last[0] = hit.point.x; P.last[1] = hit.point.y; P.last[2] = hit.point.z;
      showCursor(hit);
      snd.play('tick');
    },
    end() { if (P.last) { P.strokes++; P.last = null; } if (!controls.st.usingMouse) stage.fx.setCursor(false); },
    cancel() { if (P.last) { stage.paints[viewer()].undo(); P.last = null; } },
    tap(x, y) {
      if (!P.on) return;
      if (P.tool === 'fill') {
        if (P.texelDirtyAt) refreshTexels();
        const hit = pickOwn(x, y);
        if (!hit) { hint('Tap a part of your body to fill it'); return; }
        const region = REGION_NAMES[REGION_OF_PART[hit.object.userData.part]];
        const p = stage.paints[viewer()];
        p.snapshot(); p.fill(region, P.rgb);
        snd.play('fill'); api.haptic(10);
        hint(`Filled your ${region}`, 1000);
      } else if (P.tool === 'pick') {
        pickColorAt(x, y);
      }
    },
    orbit(dx, dy) { C.paintYaw -= dx * 0.009; C.paintPitch = clamp(C.paintPitch + dy * 0.006, -0.35, 1.25); },
    zoom(f) { C.paintDist = clamp(C.paintDist * f, 0.6, 2.8); },
  };
  function pickOwn(x, y) {
    const [W, H] = stage.size;
    stage.setRayFromScreen(x, y, W, H);
    stage.ray.far = 10;
    hitsTmp.length = 0;
    stage.ray.intersectObjects(myMeshes(), false, hitsTmp);
    return hitsTmp.length ? hitsTmp[0] : null;
  }
  const hitsTmp = [];
  const curN = { x: 0, y: 1, z: 0 };
  function showCursor(hit) {
    if (hit.face) { tv3.copy(hit.face.normal).transformDirection(hit.object.matrixWorld); curN.x = tv3.x; curN.y = tv3.y; curN.z = tv3.z; }
    const r = P.tool === 'fill' ? 0.03 : BRUSH[P.size];
    stage.fx.setCursor(true, hit.point.x, hit.point.y, hit.point.z, curN.x, curN.y, curN.z, r, P.hard ? theme.outline : '#ffffff');
  }
  function dabAt(hit) { dab3(hit.point.x, hit.point.y, hit.point.z); }
  function dab3(x, y, z) {
    const v = viewer();
    const cam = stage.camera.position;
    let vx = x - cam.x; let vy = y - cam.y; let vz = z - cam.z;
    const l = Math.hypot(vx, vy, vz) || 1; vx /= l; vy /= l; vz /= l;
    stage.paints[v].dab(x, y, z, vx, vy, vz, BRUSH[P.size], P.rgb, P.hard, 0.45);
  }
  function pickColorAt(x, y) {
    const [W, H] = stage.size;
    stage.setRayFromScreen(x, y, W, H);
    const objs = [stage.mapMesh];
    for (const w of ['a', 'b']) if (stage.av[w].root.visible) for (const m of stage.av[w].meshes) objs.push(m);
    const hit = stage.pick(objs, 40);
    if (!hit) { hint('Nothing there to sample'); return null; }
    stage.albedoAtHit(hit, rgbTmp);
    P.rgb = [rgbTmp[0], rgbTmp[1], rgbTmp[2]];
    snd.play('gulp'); api.haptic(12);
    hud.gulp(); hud.fly(x, y, P.rgb);
    P.tool = 'brush';
    stats.lastPick = { rgb: P.rgb.slice(), point: [hit.point.x, hit.point.y, hit.point.z] };
    return P.rgb;
  }
  function doStamp() {
    const v = viewer();
    if (!canPaint() || !v) return;
    const b = body[v];
    refreshTexels();
    let hit = null;
    if (b.pose === 'wall' && b.wallN) {
      const n = b.wallN;
      stage.ray.set(tv3.set(b.x + n[0] * 0.5, b.y + 0.25, b.z + n[2] * 0.5), tv3b.set(-n[0], 0, -n[2]));
      hit = stage.pickMap(1.4);
    }
    if (!hit) {
      stage.ray.set(tv3.set(b.x, b.y + 0.7, b.z), tv3b.set(0, -1, 0));
      hit = stage.pickMap(2);
    }
    const surf = stage.surfaceOf(hit);
    if (!surf) { hint('Nothing to stamp here'); return; }
    const p = stage.paints[v];
    p.snapshot();
    p.stamp(surf);
    snd.play('stamp'); api.haptic(20); hud.flash();
    hint(b.pose === 'wall' ? 'Stamped the wall onto your back' : 'Stamped the floor under you onto your skin', 1600);
  }
  let tv3 = null; let tv3b = null;

  // ── poses ─────────────────────────────────────────────────────────
  function setPose(name) {
    const v = viewer();
    if (!v || !POSES.includes(name) || frozen()) return;
    const ph = S.phase.name; const role = roleOf(v);
    const allowed = (ph === 'hide' && (role === 'hider' || role === 'both')) || (ph === 'seek' && (role === 'hider' || role === 'both'));
    if (!allowed) return;
    const b = body[v];
    if (name === 'wall') {
      const wall = stage.world.nearestWall(b.x, b.y, b.z, 0.75);
      if (!wall) { hint('Get right up against a wall or the side of something first', 2200); snd.play('warn'); return; }
      b.wallN = [wall.nx, 0, wall.nz];
      b.wa = Math.atan2(wall.nx, wall.nz);
      // press against it
      if (wall.nx) b.x = wall.px + wall.nx * 0.02; else b.z = wall.pz + wall.nz * 0.02;
      b.yaw = b.wa;
      if (b.y < 0.05) b.y = Math.max(b.y, 0.06);
    } else { b.wallN = null; }
    b.pose = name;
    stage.av[v].setPose(name);
    stage.av[v].st.wallN = b.wallN;
    P.texelDirtyAt = tSec + 0.4;
    snd.play('pose');
    if (name === 'wall') hint('Flat on the wall. Move to slide around on it — Stamp copies the wall onto you.', 2600);
  }

  // ── actions (buttons + keys) ──────────────────────────────────────
  function action(a) {
    if (S.destroyed || S.boot !== 'ready') return;
    snd.unlock();
    const v = viewer();
    if (a.startsWith('pose:')) { setPose(a.slice(5)); return; }
    switch (a) {
      case 'fire': if (S.phase.name === 'seek') fire(); break;
      case 'scan': scan(); break;
      case 'scurry': scurry(); break;
      case 'jump': if (v && controlsOf(v)) R.jumpReq = true; break;
      case 'crouch': if (v) setPose(body[v].pose === 'crouch' ? 'stand' : 'crouch'); break;
      case 'paint': if (P.on) exitPaint(); else enterPaint(); break;
      case 'poses': posesOpen = !posesOpen; snd.play('ui'); break;
      case 'brush': if (P.on) { if (P.tool === 'brush') P.size = (P.size + 1) % 3; P.tool = 'brush'; snd.play('ui'); } break;
      case 'size': if (P.on) { P.size = (P.size + 1) % 3; snd.play('ui'); } break;
      case 'hardness': if (P.on) { P.hard = !P.hard; snd.play('ui'); } break;
      case 'fill': if (P.on) { P.tool = 'fill'; snd.play('ui'); hint('Tap a body part to fill it', 1500); } break;
      case 'pick': if (P.on) { P.tool = 'pick'; snd.play('ui'); hint('Tap anything to drink its colour', 1500); } break;
      case 'stamp': doStamp(); break;
      case 'undo': if (P.on && v && stage.paints[v].undo()) snd.play('undo'); break;
      case 'ready': ready(); break;
      case 'next': if (S.phase.name === 'recap') { if (isHost) hostNext(); else link.send('next', {}); snd.play('ui'); } break;
      case 'confirm': if (S.phase.name === 'recap') action('next'); else if (S.phase.name === 'curtain') action('curtain'); else if (S.phase.name === 'lobby') action('start'); break;
      case 'start': if (isHost && S.phase.name === 'lobby') { snd.play('go'); hostStart(); } break;
      case 'curtain': if (local && S.phase.name === 'curtain') { snd.play('ui'); const d = S.phase.data || {}; if (d.kind === 'hide') enter('hide', { dur: DUR.hide }, 0); else enter('seek', { dur: DUR.seek }, DUR.seekLead); } break;
      case 'ctxresume': if (!S.ctxLost) { S.ctxShown = false; removePause('ctx'); } break;
      default: break;
    }
  }
  function ready() {
    const v = viewer();
    if (!v || S.phase.name !== 'hide') return;
    const role = roleOf(v);
    if (role !== 'hider' && role !== 'both') return;
    exitPaint(true);
    snd.play('good');
    if (isHost) { R.ready.add(v); if (mode() === 'hs' || R.ready.size >= 2) endHide(); else hint('Waiting for the other hider…', 3000); }
    else { R.ready.add(v); link.send('ready', { w: v }); hint(mode() === 'db' ? 'Waiting for the other hider…' : 'Locking in…', 3000); }
  }

  // lobby + HUD clicks (delegated)
  L.on(root, 'click', (e) => {
    const t = e.target.closest('button');
    if (!t || !root.contains(t)) return;
    snd.unlock();
    if (t.dataset.lobby) {
      if (!isHost || S.match) return;
      const k = t.dataset.lobby; const val = t.dataset.v;
      if (k === 'mode' && local && val === 'db') return;
      S.setup = { ...S.setup, [k]: val };
      S.setupVer++;
      snd.play('ui');
      if (k === 'map') { stage.loadMap(val); placeLobby(); stage.compile(); }
      if (!local) link.send('setup', S.setup);
      return;
    }
    if (t.dataset.tool) { const tool = t.dataset.tool; if (tool === 'stamp') action('stamp'); else if (tool === 'brush') action('brush'); else action(tool); return; }
    if (t.dataset.size) { P.size = +t.dataset.size; snd.play('ui'); return; }
    if (t.dataset.hard) { P.hard = t.dataset.hard === '1'; snd.play('ui'); return; }
    if (t.dataset.pose) { setPose(t.dataset.pose); return; }
    if (t.dataset.act) action(t.dataset.act);
  });
  L.on(root, 'pointerdown', () => snd.unlock(), { passive: true });

  // ── visibility + context ──────────────────────────────────────────
  L.on(document, 'visibilitychange', () => {
    const hidden = document.hidden;
    if (hidden === S.hidden) return;
    S.hidden = hidden;
    if (hidden) { cancelAnimationFrame(raf); raf = 0; addPause('hidden'); controls && controls.releaseLock(); }
    else { removePause('hidden'); if (!raf && stage) { lastT = performance.now(); raf = requestAnimationFrame(frame); } }
  });
  function onContextRestored() {
    S.ctxLost = false;
    if (!stage) return;
    for (const w of ['a', 'b']) stage.paints[w].texture.needsUpdate = true; // re-upload from the CPU buffers
    try { stage.compile(); } catch (e) { console.error(e); }
    S.ctxShown = true; // "Tap to resume" stays until tapped
  }

  // ── helpers ───────────────────────────────────────────────────────
  function frozen() { return !!S.paused || now() < S.resumeAt || tSec < C.freezeUntil; }
  function frozenView() { return false; }
  const posTmp = { x: 0, y: 0, z: 0 };
  function posOf(w) {
    const r = stage.av[w].root.position;
    posTmp.x = r.x; posTmp.y = r.y; posTmp.z = r.z;
    return posTmp;
  }
  function recapTarget() { const rec = R.rec || {}; return rec.hider || rec.victim || hiderOf(S.phase.round) || 'a'; }
  function fpBaseYaw(w) { const b = body[w]; return b.pose === 'wall' && b.wallN ? Math.atan2(b.wallN[0], b.wallN[2]) : b.yaw; }
  function hint(text, ms) { hud.hint(text, ms); }
  function hintOnce(key, text, ms) { if (shownHints.has(key)) return; shownHints.add(key); hint(text, ms); }

  // ── per-frame ─────────────────────────────────────────────────────
  const mv = [0, 0]; const lk = [0, 0];
  let camPos = null; let camLook = null; let camWant = null; let lookWant = null; let tvA = null;
  const pubSt = {}; for (const f of FIELDS) pubSt[f] = 0;
  let lastScaleCheck = 0;
  function initVecs() {
    camPos = new THREE.Vector3(0, 6, 9); camLook = new THREE.Vector3(0, 0.5, 0); camWant = new THREE.Vector3(); lookWant = new THREE.Vector3(); tvA = new THREE.Vector3();
    tv3 = new THREE.Vector3(); tv3b = new THREE.Vector3();
  }

  function frame(tms) {
    raf = requestAnimationFrame(frame);
    if (!stage || S.hidden) return;
    if (!camPos) initVecs();
    const frameMs = tms - lastT;
    let dt = frameMs / 1000; lastT = tms;
    if (!(dt > 0)) dt = 0.016; if (dt > 0.1) dt = 0.1;
    const realDt = dt;
    if (tSec < C.freezeUntil) dt = 0; // freeze-frame
    tSec += realDt;
    const t = now();
    try {
      if (S.queue.length && t >= S.queue[0].at) setPhase(S.queue.shift());
      hostTick();
      if (R.tagWindow && S.phase.name !== 'seek') R.tagWindow = null;
      simulate(dt, t);
      network(t);
      animate(dt, t);
      cameras(realDt, t);
      stage.fx.update(dt, tSec);
      ui(t);
      const blind = isBlind();
      if (blind !== U.blind) { U.blind = blind; stage.canvas.style.visibility = blind ? 'hidden' : 'visible'; }
      if (!blind && !S.ctxLost) {
        checkVisibility();
        stage.render();
        stats.renders++;
        const inf = stage.renderer.info.render;
        stats.calls = inf.calls; stats.tris = inf.triangles;
      }
      perf(frameMs > 0 && frameMs < 1000 ? frameMs : 16, tms);
    } catch (e) {
      console.error('chameleon frame', e);
    }
  }

  function perf(ms, tms) {
    stats.ewma = stats.ewma * 0.92 + ms * 0.08;
    stats.frames[stats.fi] = ms; stats.fi = (stats.fi + 1) % stats.frames.length; if (stats.fn < stats.frames.length) stats.fn++;
    if (!DUR.fixedScale && tms - lastScaleCheck > 1000) {
      lastScaleCheck = tms;
      if (stats.ewma > 21) stage.setScale(stage.scale - 0.1);
      else if (stats.ewma < 13.5 && stage.scale < 1) stage.setScale(stage.scale + 0.05);
    }
  }

  function isBlind() {
    if (S.boot !== 'ready') return true;
    const ph = S.phase.name;
    if (ph === 'curtain') return true;
    if (local) return false;
    const r = roleOf(me);
    return r === 'seeker' && (ph === 'hide' || ph === 'lock');
  }

  /** The anti-peek invariant: a hider is never drawn on the seeker's screen before seeking. */
  function checkVisibility() {
    const v = viewer();
    if (!S.match || mode() !== 'hs') return;
    const ph = S.phase.name;
    const h = hiderOf(S.phase.round);
    const seekerView = local ? v === other(h) || v == null : me === other(h);
    if (seekerView && stage.av[h].root.visible && (ph === 'hide' || ph === 'lock' || ph === 'curtain')) stats.violations++;
  }

  function simulate(dt, t) {
    const v = viewer();
    const ph = S.phase.name;
    const fz = frozen();
    const world = stage.world;
    // look input
    controls.takeLook(lk);
    const sens = controls.st.locked ? 0.0026 : 0.0058;
    let mode2 = 'none';
    if (S.boot === 'ready' && v && !fz) {
      const role = roleOf(v);
      if (P.on) mode2 = 'paint';
      else if (ph === 'hide' && (role === 'hider' || role === 'both')) mode2 = 'move';
      else if (ph === 'seek' && (role === 'seeker' || role === 'both')) mode2 = 'move';
      else if (ph === 'seek' && role === 'hider') mode2 = 'look';
    }
    controls.setMode(mode2);
    controls.st.fp = ph === 'seek';
    for (const w of ['a', 'b']) {
      if (!controlsOf(w)) continue;
      const b = body[w];
      let vx = 0; let vz = 0; let jump = false;
      if (w === v && !fz && (mode2 === 'move' || mode2 === 'look')) {
        controls.move(mv);
        const role = roleOf(w);
        const fp = ph === 'seek';
        if (fp) {
          b.lookYaw -= lk[0] * sens; b.lookPitch = clamp(b.lookPitch - lk[1] * sens, -1.1, 1.1);
          if (role === 'hider') { b.lookYaw = clamp(wrapAngle(b.lookYaw), -1.9, 1.9); b.lookPitch = clamp(b.lookPitch, -0.9, 0.9); }
        } else {
          C.yaw -= lk[0] * sens; C.pitch = clamp(C.pitch + lk[1] * sens * 0.8, -0.15, 1.15);
        }
        if (mode2 === 'move') {
          const sp = ph === 'seek' ? (mode() === 'db' ? SPEED.db : SPEED.seek) : SPEED.hide;
          let fx; let fzv; let rx; let rz;
          if (fp) { const yaw = b.yaw + b.lookYaw; fx = Math.sin(yaw); fzv = Math.cos(yaw); rx = -Math.cos(yaw); rz = Math.sin(yaw); }
          else { fx = -Math.sin(C.yaw); fzv = -Math.cos(C.yaw); rx = Math.cos(C.yaw); rz = -Math.sin(C.yaw); }
          vx = (fx * mv[1] + rx * mv[0]) * sp; vz = (fzv * mv[1] + rz * mv[0]) * sp;
          jump = (R.jumpReq || controls.st.jumpHeld) && !(ph === 'seek' && mode() === 'db');
          if (fp) {
            // first person: body yaw follows the view; keep lookYaw small
            b.yaw = wrapAngle(b.yaw + b.lookYaw); b.lookYaw = 0;
          }
        }
      }
      R.jumpReq = false;
      // scurry dash overrides
      if (R.scurry && w === v) {
        if (tSec < R.scurry.until) { vx = R.scurry.vx; vz = R.scurry.vz; if (tSec - (R.lastTrailT || 0) > 0.07) { R.lastTrailT = tSec; } }
        else R.scurry = null;
      }
      const moving = vx * vx + vz * vz > 0.01;
      if (b.pose === 'wall' && b.wallN) {
        // slide along the wall: horizontal along the face, vertical up/down
        if (moving || mv[1]) {
          const n = b.wallN; const tx = -n[2]; const tz = n[0];
          const along = (vx * tx + vz * tz) * 0.5;
          b.x += tx * along * dt; b.z += tz * along * dt;
          b.y = clamp(b.y + mv[1] * 0.9 * dt * (w === v && mode2 === 'move' && ph === 'hide' ? 1 : 0), 0.06, 1.9);
          const wall = world.nearestWall(b.x - n[0] * 0.05, Math.max(0, b.y - 0.3), b.z - n[2] * 0.05, 0.4);
          if (!wall || wall.nx !== n[0] || wall.nz !== n[2]) { b.x -= tx * along * dt; b.z -= tz * along * dt; }
          P.texelDirtyAt = tSec + 0.2;
        }
        if (jump) { setPoseFor(w, 'stand'); }
        b.speed = 0;
        continue;
      }
      if (moving && b.pose !== 'stand' && b.pose !== 'crouch') { setPoseFor(w, 'stand'); }
      const sp2 = b.pose === 'crouch' ? 0.55 : 1;
      let landed = false;
      const nSub = Math.max(1, Math.ceil(dt / 0.025));
      for (let k = 0; k < nSub; k++) landed = world.step(b, vx * sp2, vz * sp2, dt / nSub, jump && k === 0) || landed;
      if (jump && b.vy > 3) snd.play('jump');
      if (landed) snd.play('land');
      if (moving) {
        const want = Math.atan2(vx, vz);
        if (!(ph === 'seek' && w === v)) b.yaw = dampAngle(b.yaw, want, 12, dt);
        P.texelDirtyAt = tSec + 0.2;
      }
      b.speed = Math.hypot(vx, vz) * sp2;
      // history for tag confirmation
      if (w === me || local) {
        hist.t[hist.i] = t; hist.x[hist.i] = b.x; hist.y[hist.i] = b.y; hist.z[hist.i] = b.z;
        hist.i = (hist.i + 1) % hist.t.length; if (hist.n < hist.t.length) hist.n++;
      }
    }
    if (P.on && P.texelDirtyAt && tSec > P.texelDirtyAt) refreshTexels();
  }
  function setPoseFor(w, name) { const b = body[w]; b.pose = name; b.wallN = null; stage.av[w].setPose(name); stage.av[w].st.wallN = null; }

  function network(t) {
    if (local) return;
    const b = body[me];
    const ph = S.phase.name; const role = roleOf(me);
    const hiding = (ph === 'hide') && (role === 'hider' || role === 'both');
    pubSt.x = hiding ? 0 : b.x; pubSt.y = hiding ? 0 : b.y; pubSt.z = hiding ? 0 : b.z;
    pubSt.yaw = hiding ? 0 : b.yaw; pubSt.po = hiding ? 0 : POSES.indexOf(b.pose);
    pubSt.ly = b.lookYaw; pubSt.lp = b.lookPitch; pubSt.v = hiding ? 0 : 1; pubSt.wa = b.wa; pubSt.sp = b.speed;
    if (S.boot === 'ready' && link.ready) link.publish(pubSt);
    // silence detection (host pauses on a stalled link)
    if (isHost && S.match && api.partnerHere) {
      if (link.silence > 4500) addPause('stall');
      else if (S.pauseReasons.has('stall') && link.silence < 800) removePause('stall');
    }
  }

  function animate(dt, t) {
    const ph = S.phase.name;
    const v = viewer();
    for (const w of ['a', 'b']) {
      const a = stage.av[w];
      const rt = a.root;
      let vis = true;
      if (controlsOf(w)) {
        const b = body[w];
        rt.position.set(b.x, b.y, b.z);
        rt.rotation.y = b.yaw;
        if (a.pose !== b.pose) a.setPose(b.pose);
        a.st.wallN = b.wallN;
        a.st.speed = b.speed;
        a.st.lookYaw = b.lookYaw; a.st.lookPitch = b.lookPitch;
        if (ph === 'seek' && w === v && (roleOf(w) === 'seeker' || roleOf(w) === 'both') && !frozenView()) vis = false; // my own body in first person
      } else {
        let ok = link.sample(rem, t);
        if (!ok && remHint.set) { rem.x = remHint.x; rem.y = remHint.y; rem.z = remHint.z; rem.yaw = remHint.yaw; rem.po = remHint.po; rem.wa = remHint.wa; rem.v = 1; rem.ly = 0; rem.lp = 0; rem.sp = 0; ok = true; }
        if (ok && remHint.set && rem.v === 0 && (ph === 'seek' || ph === 'lock')) { rem.x = remHint.x; rem.y = remHint.y; rem.z = remHint.z; rem.yaw = remHint.yaw; rem.po = remHint.po; rem.wa = remHint.wa; rem.v = 1; }
        vis = ok && rem.v > 0.5;
        if (ok) {
          rt.position.set(rem.x, rem.y, rem.z);
          rt.rotation.y = rem.yaw;
          const pose = POSES[Math.round(rem.po)] || 'stand';
          if (a.pose !== pose) a.setPose(pose);
          a.st.wallN = pose === 'wall' ? wallTmp(w, rem.wa) : null;
          a.st.speed = rem.sp; a.st.lookYaw = rem.ly; a.st.lookPitch = rem.lp;
        }
      }
      // visibility rules
      const role = roleOf(w);
      if (S.match) {
        if (ph === 'hide' || ph === 'lock' || ph === 'curtain') {
          if (mode() === 'db') vis = vis && (w === v);
          else if (role === 'hider') vis = vis && (local ? v === w : me === w);
        }
        if ((ph === 'lock' || ph === 'seek') && role !== 'seeker' && !local && w !== me && !R.paintOk[w]) vis = false;
      }
      if (P.on && w === v) vis = true;
      a.setVisible(vis);
      // first-person hider: hide my own head
      a.setHeadVisible(!(ph === 'seek' && w === v && roleOf(w) !== 'seeker'));
      // the reveal: outline the hider during found / time / recap
      const revealed = (ph === 'found' || ph === 'time' || ph === 'recap' || ph === 'final') && R.rec && w === recapTarget() && tSec >= C.freezeUntil;
      if (revealed !== !!a.revealOn) { a.revealOn = revealed; a.setReveal(revealed ? theme.hl : null, 0.016); }
      // glint
      a.st.glintUntil = (t >= R.glintAt[w] && t < R.glintAt[w] + GLINT_MS) ? tSec + 0.05 : 0;
      a.update(dt, tSec);
      stage.paints[w].flush();
      // blob shadow under the avatar
      const bl = a.blob;
      const pose = a.pose;
      const gy = stage.world.groundAt(rt.position.x, rt.position.z, 0.15, rt.position.y + 0.05);
      const hgt = Math.max(0, rt.position.y - gy);
      bl.position.set(rt.position.x, gy + 0.006, rt.position.z);
      const s = (pose === 'flat' ? 0.8 : pose === 'ball' ? 0.75 : 1) * Math.max(0.5, 1 - hgt);
      bl.scale.set(0.62 * s, 1, 0.72 * s);
      bl.rotation.y = rt.rotation.y;
      bl.material.opacity = pose === 'wall' ? 0 : (pose === 'flat' ? 0.12 : 0.28) * Math.max(0, 1 - hgt * 1.4);
      bl.visible = vis && bl.material.opacity > 0.01;
    }
    // glint sprites
    for (let i = 0; i < 4; i++) stage.fx.glints[i].visible = false;
    let gi = 0;
    for (const w of ['a', 'b']) {
      const a = stage.av[w];
      if (!a.root.visible || !(t >= R.glintAt[w] && t < R.glintAt[w] + GLINT_MS)) continue;
      const k = (t - R.glintAt[w]) / GLINT_MS;
      for (let e = 0; e < 2 && gi < 4; e++) {
        const sp = stage.fx.glints[gi++];
        a.eyeWorld(e, sp.position);
        sp.visible = true;
        sp.scale.setScalar(0.18 + Math.sin(k * Math.PI) * 0.22);
        sp.material.rotation = k * 2;
      }
    }
    // trails (scurry)
    for (const w of ['a', 'b']) {
      if (t < R.trailUntil[w] && tSec > R.trailNext) {
        R.trailNext = tSec + 0.06;
        const p = stage.av[w].root.position;
        if (stage.av[w].root.visible || w === me) stage.fx.trailDot(p.x, p.y, p.z, tSec, 2);
      }
    }
    // the hider peeks through their own eyes; a heartbeat when the seeker gets close
    const peeking = ph === 'seek' && v && roleOf(v) === 'hider' && !local;
    if (peeking !== !!C.peek) { C.peek = peeking; root.classList.toggle('peek', peeking); }
    if (peeking && !frozen()) {
      const sk = other(v); const ps = stage.av[sk].root.position; const pm = stage.av[v].root.position;
      const d = Math.hypot(ps.x - pm.x, ps.z - pm.z);
      if (d < 3 && tSec > (C.beatAt || 0)) { C.beatAt = tSec + 0.45 + d * 0.28; snd.play('beat'); root.classList.remove('beat'); void root.offsetWidth; root.classList.add('beat'); }
    }
    // seek stats: closest call, walk-pasts, seeker path
    if (ph === 'seek' && S.match) {
      const hd = mode() === 'hs' ? hiderOf(S.phase.round) : other(v || 'a');
      const sk = other(hd);
      const ps = stage.av[sk].root.position; const phd = stage.av[hd].root.position;
      const d = Math.hypot(ps.x - phd.x, ps.z - phd.z);
      if (d < R.closest) R.closest = d;
      if (!R.near && d < 1.2) { R.near = true; R.passes++; }
      if (R.near && d > 1.7) R.near = false;
      if (tSec > R.pathNext && R.path.length < 260) { R.pathNext = tSec + 0.3; R.path.push([ps.x, Math.max(0, ps.y), ps.z]); }
    }
    void wallTmp;
  }
  const wallArr = { a: [0, 0, 0], b: [0, 0, 0] };
  function wallTmp(w, wa) { const a = wallArr[w]; a[0] = Math.sin(wa); a[1] = 0; a[2] = Math.cos(wa); return a; }

  function cameras(dt, t) {
    const cam = stage.camera;
    const ph = S.phase.name; const v = viewer();
    const role = v ? roleOf(v) : null;
    let snap = false;
    let rate = 10;
    C.frameCard = false;
    stage.vm.visible = false;
    if (S.boot !== 'ready') return;
    if (!S.match || ph === 'lobby') {
      // frame both chameleons in the part of the screen the lobby card leaves free
      C.orbit += dt;
      const sw = Math.sin(C.orbit * 0.16) * 0.55;
      const cx = (body.a.x + body.b.x) / 2; const cz = (body.a.z + body.b.z) / 2; const cy = (body.a.y + body.b.y) / 2 + 0.25;
      const dist = stage.size[0] < stage.size[1] ? 2.25 : 2.0;
      camWant.set(cx + Math.sin(sw) * dist, cy + 0.75, cz + Math.cos(sw) * dist);
      revC.x = cx; revC.y = cy; revC.z = cz;
      aimFramed(revC, true);
      rate = 3;
    } else if ((S.pendingTitle && ph !== 'hide') || (ph === 'final' && !R.rec)) {
      C.orbit += dt * 0.12;
      const m = stage.map; const rad = m.id === 'garden' ? 10.5 : 9.2;
      camWant.set(Math.sin(C.orbit) * rad, 5.4, Math.cos(C.orbit) * rad);
      lookWant.set(0, 0.2, 0);
      rate = 3;
    } else if (ph === 'found' || ph === 'time' || ph === 'recap' || ph === 'final') {
      // whip to the hider, then a slow half-orbit in front of the spot; keep them above the card
      const tw = recapTarget(); const cen = revealCenter(tw);
      if (ph === 'found' || ph === 'time') {
        const sk = other(tw); const ps = stage.av[sk].root.position;
        let dx = ps.x - cen.x; let dz = ps.z - cen.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        C.orbitBase = Math.atan2(dx, dz); C.orbitT = 0;
      }
      C.orbitT = (C.orbitT || 0) + dt;
      const ang = (C.orbitBase || 0) + (ph === 'recap' || ph === 'final' ? Math.sin(C.orbitT * 0.35) * 0.75 : 0);
      const dist = ph === 'recap' || ph === 'final' ? 2.2 : 1.55;
      camWant.set(cen.x + Math.sin(ang) * dist, cen.y + (ph === 'recap' ? 0.95 : 0.55), cen.z + Math.cos(ang) * dist);
      clampCam(cen, camWant);
      aimFramed(cen, ph === 'recap' || ph === 'final');
      rate = tSec < C.freezeUntil ? 0 : (ph === 'found' || ph === 'time') ? 8 : 3;
    } else if (P.on && v) {
      const b = body[v]; const a = stage.av[v];
      const cy = b.pose === 'wall' ? 0.25 : b.pose === 'flat' ? 0.12 : 0.28;
      lookWant.set(a.root.position.x, a.root.position.y + cy, a.root.position.z);
      if (b.pose === 'wall' && b.wallN) { lookWant.x += b.wallN[0] * 0.12; lookWant.z += b.wallN[2] * 0.12; }
      const cp = Math.cos(C.paintPitch);
      camWant.set(lookWant.x + Math.sin(C.paintYaw) * cp * C.paintDist, lookWant.y + Math.sin(C.paintPitch) * C.paintDist, lookWant.z + Math.cos(C.paintYaw) * cp * C.paintDist);
      rate = 14;
    } else if (ph === 'seek' && v && (role === 'seeker' || role === 'both' || (role === 'hider' && !local))) {
      const b = body[v];
      if (role === 'hider') {
        const a = stage.av[v];
        a.eyeWorld(0, tvA); camWant.copy(tvA); a.eyeWorld(1, tvA); camWant.add(tvA).multiplyScalar(0.5);
        const yaw = fpBaseYaw(v) + b.lookYaw;
        camWant.x += Math.sin(yaw) * 0.06; camWant.z += Math.cos(yaw) * 0.06; camWant.y += 0.02;
        lookWant.set(camWant.x + Math.sin(yaw) * Math.cos(b.lookPitch), camWant.y + Math.sin(b.lookPitch), camWant.z + Math.cos(yaw) * Math.cos(b.lookPitch));
      } else {
        const eh = EYE_H[b.pose] || 0.46;
        const yaw = b.yaw + b.lookYaw;
        camWant.set(b.x + Math.sin(yaw) * 0.12, b.y + eh, b.z + Math.cos(yaw) * 0.12);
        lookWant.set(camWant.x + Math.sin(yaw) * Math.cos(b.lookPitch), camWant.y + Math.sin(b.lookPitch), camWant.z + Math.cos(yaw) * Math.cos(b.lookPitch));
        // the paint popper only fits on landscape screens (portrait has the Fire button there)
        stage.vm.visible = stage.size[0] > stage.size[1] * 1.1;
        stage.vm.position.set(0.2, -0.16 + Math.sin(tSec * 8) * 0.004 * Math.min(1, b.speed), -0.42 + C.shake * 0.3);
      }
      snap = true;
    } else if (v && (ph === 'hide' || ph === 'lock')) {
      const b = body[v];
      lookWant.set(b.x, b.y + (b.pose === 'wall' ? 0.5 : 0.42), b.z);
      const cp = Math.cos(C.pitch);
      camWant.set(lookWant.x + Math.sin(C.yaw) * cp * C.dist, lookWant.y + Math.sin(C.pitch) * C.dist, lookWant.z + Math.cos(C.yaw) * cp * C.dist);
      clampCam(lookWant, camWant);
      rate = 12;
    } else {
      // seeker waiting in local mode, or anything else: gentle overview
      C.orbit += dt * 0.1;
      camWant.set(Math.sin(C.orbit) * 8.5, 5.2, Math.cos(C.orbit) * 8.5);
      lookWant.set(0, 0.2, 0);
      rate = 3;
    }
    C.shake = Math.max(0, C.shake - dt);
    if (C.override) { camWant.fromArray(C.override, 0); lookWant.fromArray(C.override, 3); snap = true; C.frameCard = false; }
    if (snap) { camPos.copy(camWant); camLook.copy(lookWant); }
    else if (rate > 0) {
      const k = 1 - Math.exp(-rate * dt);
      camPos.lerp(camWant, k); camLook.lerp(lookWant, k);
    }
    cam.position.copy(camPos);
    cam.lookAt(camLook);
    applyFraming();
    if (C.shake > 0) { cam.rotation.x += (Math.random() - 0.5) * C.shake * 0.05; }
    void t;
  }
  const revC = { x: 0, y: 0, z: 0 };
  function revealCenter(w) {
    const m = stage.av[w].meshes[0];
    m.updateWorldMatrix(true, false);
    const e = m.matrixWorld.elements;
    revC.x = e[12]; revC.y = e[13]; revC.z = e[14];
    return revC;
  }
  /** Look at `cen`; with a card on screen, shift the projection so `cen` sits mid-way in the free area. */
  function aimFramed(cen, withCard) {
    lookWant.set(cen.x, cen.y, cen.z);
    C.frameCard = withCard;
  }
  function applyFraming() {
    const cam = stage.camera;
    let oy = 0;
    if (C.frameCard) {
      if (tSec > C.cardCheck) {
        C.cardCheck = tSec + 0.4;
        const card = hud.el.layer.querySelector('.chm-card'); const rr = root.getBoundingClientRect();
        const r = card ? card.getBoundingClientRect() : null;
        const topUi = 96;
        const bottom = r && r.top > rr.top + 120 ? r.top - rr.top : rr.height;
        C.frameY = (topUi + bottom) / 2;
      }
      const H = stage.size[1];
      oy = Math.round(H / 2 - (C.frameY || H / 2));
    }
    C.oy = C.oy == null ? oy : C.oy + (oy - C.oy) * 0.2;
    if (Math.abs(C.oy) < 0.5) { if (cam.view && cam.view.enabled) cam.clearViewOffset(); }
    else { const [W, H] = stage.size; cam.setViewOffset(W, H, 0, C.oy, W, H); }
  }
  /** Pull the camera in front of walls between the target and it. */
  function clampCam(target, want) {
    const dx = want.x - target.x; const dy = want.y - target.y; const dz = want.z - target.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const h = stage.world.raycast(target.x, target.y, target.z, dx / d, dy / d, dz / d, d, (b) => b.maxY - b.minY > 0.5 || b.minY > 0.6);
    if (h && h.t < d) { const k = Math.max(0.25, h.t - 0.18) / d; want.x = target.x + dx * k; want.y = target.y + dy * k; want.z = target.z + dz * k; }
  }

  // ── HUD per frame (allocation-free: stable descriptors, precomputed labels) ──
  const showParts = { top: false, sub: false, gear: false, cross: false, poses: false, tools: false, acts: false, joyhint: false, legend: false };
  const FIRE_L = Array.from({ length: 10 }, (_, i) => `Fire ${i}`);
  const SCAN_L = Array.from({ length: 31 }, (_, i) => (i ? `${i}s` : 'Scan'));
  const PHASE_L = { hide: 'Hide', lock: 'Get ready', seek: 'Seek', found: 'Found', time: 'Time', recap: 'Recap', curtain: 'Pass', final: '', lobby: '' };
  const ROLE_L = { youHide: 'You hide', youSeek: 'You seek', hunt: 'Hunt!', hideBoth: 'Hide!', hides: { a: `${api.name('a')} hides`, b: `${api.name('b')} hides` }, seeks: { a: `${api.name('a')} seeks`, b: `${api.name('b')} seeks` } };
  const LEGEND = {
    hide: ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Mouse</kbd> look', '<kbd>Space</kbd> jump · <kbd>1</kbd>–<kbd>5</kbd> pose', '<kbd>P</kbd> paint · <kbd>R</kbd> hidden'],
    seek: ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Mouse</kbd> look', '<kbd>Click</kbd> fire · <kbd>Q</kbd> scan', '<kbd>Esc</kbd> free the mouse'],
    peek: ['<kbd>Mouse</kbd> look around', '<kbd>F</kbd> scurry · <kbd>1</kbd>–<kbd>5</kbd> pose'],
    paint: ['<kbd>B</kbd> brush · <kbd>G</kbd> fill · <kbd>E</kbd> pick', '<kbd>T</kbd> stamp · <kbd>Z</kbd> undo · <kbd>P</kbd> done'],
  };
  function mkActs(mouse) {
    const k = (x) => (mouse ? x : '');
    const poses = { act: 'poses', icon: 'pose', label: 'Pose', key: k('1-5') };
    const ready2 = { act: 'ready', icon: 'ready', label: 'Hidden', hl: true, key: k('R') };
    const jump = { act: 'jump', icon: 'jump', label: 'Jump', key: k('␣') };
    const paint = { act: 'paint', icon: 'paint', label: 'Paint', big: true, prime: true, key: k('P') };
    const scan2 = { act: 'scan', icon: 'scan', label: 'Scan', cdRing: true, cd: 0, disabled: false, key: k('Q') };
    const fire2 = { act: 'fire', icon: 'fire', label: 'Fire', big: true, prime: true, disabled: false, key: k('Click') };
    const scurry2 = { act: 'scurry', icon: 'scurry', label: 'Scurry', hl: true, big: true, disabled: false, key: k('F') };
    return { scan: scan2, fire: fire2, scurry: scurry2, hide: [poses, ready2, jump, paint], seek: [scan2, jump, fire2], both: [poses, scan2, fire2], peek: [poses, scurry2], none: [] };
  }
  const ACTS = { m: mkActs(true), t: mkActs(false) };
  const U = { meB: null, mouse: null, tick: -1, blind: null };
  const live = { blind: null, resume: null, seek: null, recap: null, blindS: -1, resumeS: -1, seekS: -1 };
  function ui(t) {
    const ph = S.phase.name; const v = viewer();
    const role = v ? roleOf(v) : null;
    const m = S.match;
    const meB = v === 'b';
    if (U.meB !== meB) { U.meB = meB; root.classList.toggle('me-b', meB); }
    const mouse = !!controls.st.usingMouse;
    if (U.mouse !== mouse) { U.mouse = mouse; root.classList.toggle('mouse', mouse); root.classList.toggle('touch', !mouse); }
    layer(t, ph, v, role);
    const fz = frozen();
    const inGame = !!m && S.boot === 'ready' && ph !== 'lobby' && ph !== 'curtain' && !isBlind();
    showParts.top = !!m && ph !== 'lobby' && ph !== 'final';
    showParts.sub = showParts.top && ph !== 'curtain';
    showParts.cross = inGame && ph === 'seek' && (role === 'seeker' || role === 'both') && !fz;
    showParts.gear = inGame && ph === 'seek';
    showParts.tools = inGame && P.on;
    showParts.poses = inGame && (P.on || posesOpen) && (ph === 'hide' || ph === 'seek') && (role === 'hider' || role === 'both');
    showParts.joyhint = inGame && !P.on && ((ph === 'hide' && (role === 'hider' || role === 'both')) || (ph === 'seek' && role !== 'hider')) && !fz;
    showParts.legend = inGame && mouse && (ph === 'hide' || ph === 'seek');
    // action buttons
    const AS = mouse ? ACTS.m : ACTS.t;
    let list = AS.none;
    if (inGame && !fz && !P.on) {
      if (ph === 'hide' && (role === 'hider' || role === 'both')) list = AS.hide;
      else if (ph === 'seek' && (role === 'seeker' || role === 'both')) {
        list = role === 'both' ? AS.both : AS.seek;
        const left = Math.max(0, R.scanReady[v] - t);
        AS.scan.cd = clamp(left / SCAN_CD, 0, 1); AS.scan.disabled = left > 0; AS.scan.label = SCAN_L[Math.min(30, Math.ceil(left / 1000))];
        AS.fire.label = FIRE_L[Math.min(9, R.pellets[v])]; AS.fire.disabled = R.pellets[v] <= 0;
      } else if (ph === 'seek' && role === 'hider' && !local) {
        list = AS.peek;
        AS.scurry.label = R.scurried[v] ? 'Used' : 'Scurry'; AS.scurry.hl = !R.scurried[v]; AS.scurry.disabled = R.scurried[v];
      }
    }
    showParts.acts = list.length > 0;
    hud.show(showParts);
    if (list.length) hud.actions(list);
    if (showParts.top) {
      const timed = ph === 'hide' || ph === 'seek';
      const rem2 = S.paused ? S.paused.remaining : Math.max(0, S.phase.end - Math.max(t, S.resumeAt));
      const hot = timed && rem2 < 10500 && !S.paused;
      hud.clock(PHASE_L[ph] || '', timed ? rem2 : null, hot);
      if (hot && rem2 > 0) { const sN = Math.ceil(rem2 / 1000); if (sN !== U.tick) { U.tick = sN; snd.play('beep'); } }
      hud.scores(m.scores.a, m.scores.b);
      hud.pips(m.rounds, Math.max(0, S.phase.round - 1));
      let rtext = '';
      if (role === 'hider') rtext = local ? ROLE_L.hides[v] : ROLE_L.youHide;
      else if (role === 'seeker') rtext = local ? ROLE_L.seeks[v] : ROLE_L.youSeek;
      else if (role === 'both') rtext = ph === 'seek' ? ROLE_L.hunt : ROLE_L.hideBoth;
      else if (m.mode === 'hs' && S.phase.round) rtext = ROLE_L.hides[hiderOf(S.phase.round)];
      hud.role(rtext, !!role);
    }
    if (showParts.gear && v) {
      const shooter = role === 'hider' ? other(v) : v;
      hud.pellets(R.pellets[shooter], R.maxPellets, shooter !== v);
    }
    if (showParts.poses && v) hud.poseOn(body[v].pose);
    if (showParts.tools && v) { hud.tool(P.tool, P.size, P.hard, P.rgb); hud.undoEnabled(stage.paints[v].canUndo); }
    if (showParts.legend) hud.legend(P.on ? LEGEND.paint : ph === 'hide' ? LEGEND.hide : ph === 'seek' && role !== 'hider' ? LEGEND.seek : LEGEND.peek);
    // live numbers inside cards
    if (live.blind) { const n = Math.ceil((S.paused ? S.paused.remaining : Math.max(0, S.phase.end - t)) / 1000); if (n !== live.blindS) { live.blindS = n; live.blind.textContent = fmtTime(n * 1000); } }
    if (live.resume) { const n = Math.max(1, Math.ceil((S.resumeAt - t) / 1000)); if (n !== live.resumeS) { live.resumeS = n; live.resume.textContent = String(n); } }
    if (live.seek) {
      const left = seekCountdown(t);
      const n = left < 0 ? 0 : Math.max(1, Math.ceil(left / 1000));
      if (n !== live.seekS) { live.seekS = n; live.seek.textContent = n ? String(n) : '…'; if (n) snd.play('beep'); }
    }
    if (S.boot === 'ready' && v && ph === 'seek' && role === 'seeker') hintOnce(mouse ? 'look-m' : 'look-t', mouse ? 'Click to grab the mouse, then click to fire.' : 'Left thumb moves · drag on the right to look', 3000);
  }

  const LY = { kind: null, a: null, b: null, n: 0 };
  function layer(t, ph, v, role) {
    if (S.boot !== 'ready') return;
    let kind = ''; let a = 0; let b = 0;
    if (S.ctxLost || S.ctxShown) kind = 'ctx';
    else if (S.paused || t < S.resumeAt) { kind = 'pause'; a = S.paused ? S.paused.reason : 'resume'; b = !S.paused; }
    else if (ph === 'lobby') { kind = 'lobby'; a = S.setupVer; b = isHost; }
    else if (S.pendingTitle && t < S.pendingTitle.at) { kind = 'title'; a = S.pendingTitle.seq; }
    else if (ph === 'curtain') { kind = seekCountdown(t) >= 0 ? 'count' : 'curtain'; a = S.phase.seq; }
    else if (!local && isBlind()) { kind = ph === 'lock' ? 'lock' : 'blind'; a = S.phase.seq; }
    else if (ph === 'seek' && t < S.phase.at + 900 && t >= S.phase.at - 50) { kind = 'go'; a = S.phase.seq; }
    else if (ph === 'found' || ph === 'time') { kind = 'stamp'; a = S.phase.seq; }
    else if (ph === 'recap' && R.rec) { kind = 'recap'; a = S.phase.seq; }
    else if (ph === 'lock' && v && roleOf(v) !== 'seeker') { kind = 'locking'; a = S.phase.seq; }
    if (kind === LY.kind && a === LY.a && b === LY.b) return;
    LY.kind = kind; LY.a = a; LY.b = b;
    hud.layer(`${kind}-${++LY.n}`, buildLayer(kind, t, v, role));
    live.blind = root.querySelector('[data-live="blind-time"]'); live.blindS = -1;
    live.resume = root.querySelector('[data-live="resume-count"]'); live.resumeS = -1;
    live.seek = root.querySelector('[data-live="seek-count"]'); live.seekS = -1;
  }
  function buildLayer(kind, t, v, role) {
    const m = S.match;
    switch (kind) {
      case 'ctx': return ctxCard();
      case 'pause': return pauseCard(api, { reason: S.paused ? S.paused.reason : 'resume', countdown: !S.paused });
      case 'lobby': return lobbyCard(api, { canEdit: isHost, local, setup: S.setup, waitingFor: 'a' });
      case 'title': {
        const p = S.pendingTitle; const hd = m && m.mode === 'hs' ? hiderOfRound(p.round) : null;
        return titleCard(api, { round: p.round, rounds: m ? m.rounds : 4, mode: m ? m.mode : 'hs', hider: hd, youHide: !local && hd === me, youSeek: !local && hd && hd !== me, map: m ? m.map : S.setup.map });
      }
      case 'count': { const d = S.phase.data || {}; return `<div class="chm-over solid"><div class="chm-card chm-sticker"><div class="chm-kicker">${esc(api.name(d.who))}, get ready</div><div class="chm-big" data-live="seek-count">3</div><p>Find them before the timer runs out.</p></div></div>`; }
      case 'curtain': { const d = S.phase.data || {}; return curtainCard(api, { kind: d.kind, who: d.who }); }
      case 'lock': return blindLock();
      case 'blind': return blindCard(api, { hider: hiderOf(S.phase.round), ms: Math.max(0, S.phase.end - t), pellets: R.maxPellets, mode: mode() });
      case 'go': return `<div class="chm-stamp ${role === 'seeker' || role === 'both' ? '' : 'ink'}">${role === 'hider' ? 'Freeze!' : 'Seek!'}</div>`;
      case 'stamp': {
        const ph = S.phase.name; const rec = R.rec || {}; const victim = rec.hider || rec.victim;
        const cls = ph === 'found' ? (rec.seeker || rec.winner || 'ink') : (victim || 'ink');
        const title = ph === 'found' ? 'FOUND!' : mode() === 'db' ? 'TIME!' : 'SURVIVED!';
        const small = ph === 'found' ? `${api.name(rec.seeker || rec.winner)} tagged ${api.name(victim)}${rec.ms != null && mode() === 'hs' ? ' in ' + fmtTime(rec.ms) : ''}` : mode() === 'db' ? 'Nobody got tagged' : `${api.name(victim)} stayed hidden`;
        return `<div class="chm-stamp ${cls}">${title}<small>${esc(small)}</small></div>`;
      }
      case 'recap': {
        const shooter = R.rec.seeker || (mode() === 'hs' ? other(R.rec.hider) : (v || 'a'));
        const st = { closest: Number.isFinite(R.closest) ? R.closest : null, passes: R.passes, used: R.used[shooter] || 0, max: R.maxPellets };
        return recapCard(api, { rec: R.rec, mode: m.mode, scores: m.scores, round: S.phase.round, rounds: m.rounds, isLast: S.phase.round >= m.rounds || (m.mode === 'db' && (m.scores.a >= 2 || m.scores.b >= 2)), canNext: true, stats: st });
      }
      case 'locking': return '<div class="chm-stamp ink">Locked in<small>Sealing your paint…</small></div>';
      default: return '';
    }
  }
  function blindLock() {
    return `<div class="chm-over chm-blind solid"><div class="chm-card chm-sticker"><div class="chm-kicker">Get ready</div><div class="chm-big" data-live="seek-count">…</div><div class="chm-drops" aria-hidden="true"><i></i><i></i><i></i></div><p>They’ve picked their spot. Eyes open in a moment.</p></div></div>`;
  }
  /** Milliseconds until a queued 'seek' starts, or -1. */
  function seekCountdown(t) {
    for (let i = 0; i < S.queue.length; i++) if (S.queue[i].name === 'seek') return Math.max(0, S.queue[i].at - t);
    return -1;
  }

  // ── test hook ─────────────────────────────────────────────────────
  if (testing) {
    const hook = {
      get ready() { return S.boot === 'ready'; },
      state() {
        const v = viewer();
        return {
          boot: S.boot, local, isHost, me, viewer: v, actor: S.actor,
          phase: { ...S.phase, data: S.phase.data }, match: S.match, setup: S.setup, paused: S.paused, resumeAt: S.resumeAt, now: now(),
          round: { pellets: R.pellets, used: R.used, scurried: R.scurried, paintOk: R.paintOk, paintSum: R.paintSum, closest: R.closest, passes: R.passes, rec: R.rec },
          bodies: { a: { ...body.a }, b: { ...body.b } },
          visible: stage ? { a: stage.av.a.root.visible, b: stage.av.b.root.visible } : null,
          paint: P.on ? { tool: P.tool, size: P.size, hard: P.hard, rgb: P.rgb } : null,
          splats: stage ? stage.fx.splatCount : 0,
          violations: stats.violations, linkReady: link.ready, epoch: link.epoch, rtt: link.rtt, sent: link.sent,
          blind: isBlind(), layer: hud.layerKey, trails: stage ? stage.fx.trailCount : 0, mapId: stage && stage.map ? stage.map.id : null,
          glint: { a: R.glintAt.a, b: R.glintAt.b }, lastPick: stats.lastPick || null, lastPaint: stats.lastPaint || null, lastShot: stats.lastShot || null, lastTagCheck: stats.lastTagCheck || null,
        };
      },
      paintHash(w) { return stage.paints[w].hash(); },
      phaseLog() { return stats.phaseLog.slice(); },
      perf() {
        const f = Array.from(stats.frames.subarray(0, stats.fn)).sort((x, y) => x - y);
        const q = (p) => f.length ? f[Math.min(f.length - 1, Math.floor(f.length * p))] : 0;
        return { p50: q(0.5), p95: q(0.95), n: f.length, calls: stats.calls, tris: stats.tris, scale: stage.scale, dpr: stage.dpr, renders: stats.renders, geometries: stage.renderer.info.memory.geometries, textures: stage.renderer.info.memory.textures, programs: (stage.renderer.info.programs || []).length };
      },
      resetPerf() { stats.fn = 0; stats.fi = 0; },
      teleport(x, z, yaw, y) { const v = viewer(); const b = body[v]; b.x = x; b.z = z; if (yaw != null) b.yaw = yaw; b.y = y != null ? y : stage.world.groundAt(x, z, 0.2, 3); b.vy = 0; if (b.pose === 'wall') setPoseFor(v, 'stand'); return { ...b }; },
      setPose(p) { setPose(p); return body[viewer()].pose; },
      /** Point the first-person view at a world point (seeker aim). */
      aimAt(x, y, z) {
        const v = viewer(); const b = body[v];
        const eh = EYE_H[b.pose] || 0.46;
        let ex = b.x; let ey = b.y + eh; let ez = b.z;
        for (let i = 0; i < 3; i++) {
          const yaw = Math.atan2(x - ex, z - ez);
          b.yaw = yaw; b.lookYaw = 0;
          ex = b.x + Math.sin(yaw) * 0.12; ez = b.z + Math.cos(yaw) * 0.12;
          b.lookPitch = Math.atan2(y - ey, Math.hypot(x - ex, z - ez));
        }
        return { yaw: b.yaw, pitch: b.lookPitch };
      },
      partnerPos(w) { const r = stage.av[w].root.position; return [r.x, r.y, r.z]; },
      /** World centre of a player's body mesh (what to aim at). */
      bodyCenter(w) { const m = stage.av[w].meshes[0]; m.updateWorldMatrix(true, false); const c = new THREE.Vector3(); m.geometry.computeBoundingBox(); m.geometry.boundingBox.getCenter(c); m.localToWorld(c); return [c.x, c.y, c.z]; },
      /** Screen position (CSS px, page coords) of a world point with the current camera. */
      screenOf(x, y, z) {
        const v3 = new THREE.Vector3(x, y, z).project(stage.camera);
        const r = stage.canvas.getBoundingClientRect();
        return [r.left + (v3.x + 1) / 2 * r.width, r.top + (1 - v3.y) / 2 * r.height, v3.z];
      },
      /** A screen point on my own body (for painting through the UI). */
      bodyPoint(part = 0) {
        const v = viewer(); const m = stage.av[v].meshes[part];
        m.geometry.computeBoundingBox();
        const c = new THREE.Vector3(); m.geometry.boundingBox.getCenter(c); m.localToWorld(c);
        const toCam = stage.camera.position.clone().sub(c).normalize();
        c.addScaledVector(toCam, 0.12);
        const v3 = c.clone().project(stage.camera); const r = stage.canvas.getBoundingClientRect();
        return [r.left + (v3.x + 1) / 2 * r.width, r.top + (1 - v3.y) / 2 * r.height];
      },
      /** Orbit the paint camera so it looks at a world point from `dist` along `normal`. */
      paintCamAt(x, y, z, nx, ny, nz, dist = 1.2) {
        const v = viewer(); const b = body[v];
        const tx = b.x; const ty = b.y + 0.28; const tz = b.z;
        const cx = x + nx * dist; const cy = y + ny * dist; const cz = z + nz * dist;
        const dx = cx - tx; const dy = cy - ty; const dz = cz - tz; const d = Math.hypot(dx, dy, dz);
        C.paintDist = clamp(d, 0.6, 2.8); C.paintYaw = Math.atan2(dx, dz); C.paintPitch = clamp(Math.asin(dy / d), -0.35, 1.25);
        return [C.paintYaw, C.paintPitch, C.paintDist];
      },
      probes() { return stage.map.probes; },
      /** Map sanity: spawns clear of props, a wall at the camo spot, probe albedos. */
      checkMap(id) {
        stage.loadMap(id);
        const w = stage.world; const out = { id, spawns: {}, camoWall: null, probes: [] };
        for (const k of ['hiderSpawn', 'seekerSpawn', 'spawnA', 'spawnB', 'lobby']) {
          const sp = stage.map.spots[k]; const b = { x: sp.x, y: 0, z: sp.z, r: 0.24 };
          b.y = w.groundAt(b.x, b.z, 0.2, 3); w.pushOut(b);
          out.spawns[k] = Math.hypot(b.x - sp.x, b.z - sp.z);
        }
        const c = stage.map.spots.camo; const wall = w.nearestWall(c.x, c.y, c.z - 0.1, 0.75);
        out.camoWall = wall ? [wall.nx, wall.nz] : null;
        for (const p of stage.map.probes) {
          const [x, y, z] = p.point; const [nx, ny, nz] = p.normal;
          stage.ray.set(new THREE.Vector3(x + nx * 0.3, y + ny * 0.3, z + nz * 0.3), new THREE.Vector3(-nx, -ny, -nz));
          const hit = stage.pickMap(1); const rgb = [0, 0, 0]; if (hit) stage.albedoAtHit(hit, rgb);
          out.probes.push({ name: p.name, want: p.hex.toLowerCase(), got: '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('') });
        }
        out.drawCalls = stage.renderer.info.render.calls; out.verts = stage.map.vertexCount; out.colliders = stage.map.colliders.length;
        return out;
      },
      spots() { return stage.map.spots; },
      surfaceAlbedo(x, y, z, nx, ny, nz) {
        stage.ray.set(new THREE.Vector3(x + nx * 0.3, y + ny * 0.3, z + nz * 0.3), new THREE.Vector3(-nx, -ny, -nz));
        const hit = stage.pickMap(1); if (!hit) return null; const out = [0, 0, 0]; stage.albedoAtHit(hit, out); return out;
      },
      camera() { const c = stage.camera; return { p: c.position.toArray(), fov: c.fov }; },
      tweak(o) {
        if (o.aniso != null) { stage.mapMesh.material.map.anisotropy = o.aniso; stage.mapMesh.material.map.needsUpdate = true; }
        if (o.hideMap != null) stage.mapMesh.visible = !o.hideMap;
        if (o.fog != null) stage.scene.fog.far = o.fog ? 30 : 1e6;
        if (o.hull != null) stage.mapMesh.geometry.setDrawRange(0, o.hull ? Infinity : stage.map.mainIndexCount);
        return true;
      },
      bench(n = 10) {
        const out = {};
        const time = (k, fn) => { const t0 = performance.now(); for (let i = 0; i < n; i++) fn(); out[k] = (performance.now() - t0) / n; };
        const t = now();
        time('simulate', () => simulate(0.016, t));
        time('animate', () => animate(0.016, t));
        time('cameras', () => cameras(0.016, t));
        time('fx', () => stage.fx.update(0.016, tSec));
        time('ui', () => ui(t));
        time('render', () => stage.render());
        time('renderFinish', () => { stage.render(); stage.renderer.getContext().finish(); });
        return out;
      },
      gl() { return stage.renderer.getContext(); },
      ctxLost() { return S.ctxLost; },
      listenerCount() { return L.count + (controls ? controls.listenerCount : 0); },
      action,
      setPaint(o) { Object.assign(P, o); },
      stampNow() { doStamp(); },
      lockPaintNow(w) { lockPaint(w); return stage.paints[w].hash(); },
      lookFrom(arr) { C.override = arr; },
      setLook(yaw, pitch) { const b = body[viewer()]; b.lookYaw = yaw; b.lookPitch = pitch; },
      openPoses() { posesOpen = true; },
      dur: DUR,
    };
    window.__cham = hook;
    window.__chamCount = (window.__chamCount || 0) + 1;
  }

  // ── destroy ───────────────────────────────────────────────────────
  return {
    destroy() {
      S.destroyed = true;
      cancelAnimationFrame(raf); raf = 0;
      clearInterval(hostTimer);
      timers.forEach((t) => clearTimeout(t)); timers.clear();
      if (offHere) { try { offHere(); } catch { /* ignore */ } }
      L.clear();
      cleanup.forEach((f) => { try { f(); } catch { /* ignore */ } });
      if (controls) controls.destroy();
      hud.destroy();
      link.destroy();
      snd.destroy();
      if (stage) { stage.dispose(); if (testing) window.__chamGL = (window.__chamGL || 1) - 1; }
      stage = null;
      el.innerHTML = '';
      if (testing) { window.__chamCount = (window.__chamCount || 1) - 1; if (window.__cham) delete window.__cham; }
    },
  };
}
