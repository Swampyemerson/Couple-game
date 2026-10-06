// Blend & Seek — game controller: boot, phases (host director), network handlers, input,
// painting, cameras, per-frame update and the test hook.
import { createLink, FIELDS, Q_ID } from './link.js';
import { createSound } from './sound.js';
import { createStage } from './stage.js';
import { createHud } from './hud.js';
import { createControls } from './controls.js';
import { POSES, REGION_OF_PART, REGION_NAMES } from './avatar.js';
import { loadingCard, errorCard, lobbyCard, titleCard, blindCard, curtainCard, recapCard, pauseCard, ctxCard, tipsHtml } from './cards.js';
import { clamp, dampAngle, wrapAngle, hexToRgb, cssColor, luminance, listeners, fmtTime, mixHex, esc, seeded, packQuat, unpackQuat } from './util.js';
import { MAPS, mapArea } from './maps.js';
import { sanitizeSetup, sanitizeRules, applyPreset, stepRule, setRule, loadSaved, saveSetup, sizeScale, SPEED_MUL, tipsSeen, markTipsSeen, PRESETS } from './rules.js';
import { mkBody, sizeBody, resetBody, headingYaw, attachBody, detachBody, freeStep, crawlStep, inputOnSurface, bodyQuat, quatUpY, spotKind, surfaceKind } from './move.js';
import { SQUEEZE_R } from './world.js';

const DUR0 = { title: 1800, hide: 60000, lockMax: 7000, seekLead: 1600, seek: 90000, found: 3400, recap: 9000, resume: 3000, lead: 380, foundLead: 260 };
const GLINT_MS = 400;
const BONUS = 30;
const SPEED = { hide: 3.0, seek: 3.3, db: 1.1, scurry: 6.2, crawl: 0.78, squeeze: 0.35, sprint: 1.55 };
const BRUSH = [0.035, 0.065, 0.11];
const EYE_H = { stand: 0.46, crouch: 0.36, ball: 0.3, flat: 0.2, wall: 0.4, hang: 0.3, perch: 0.46, squeeze: 0.12, corner: 0.3 };
const TAG_TOL = 0.75;
const ZIP = { range: 4.6, dur: 0.42, cdHide: 1100, cdSeek: 4000 };
const MAP_IDS = MAPS.map((m) => m.id);
const TAG_WINDOW = 250;
const other = (w) => (w === 'a' ? 'b' : 'a');

export function createGame(el, api) {
  const local = api.mode !== 'live';
  const isHost = local || !!api.isHost;
  const me = local ? null : api.me;
  const L = listeners();
  const testing = typeof window !== 'undefined' && window.__chamTest === true;
  const TUNE = testing && window.__chamTune ? window.__chamTune : {};
  const DUR = { ...DUR0, ...TUNE };

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
    setup: sanitizeSetup({ ...(loadSaved() || {}), first: Math.random() < 0.5 ? 'a' : 'b' }, MAP_IDS),
    sheet: false, // settings sheet open (local view state)
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
      round, pellets: { a: 0, b: 0 }, maxPellets: 0, scanReady: { a: 0, b: 0 }, scansLeft: { a: 0, b: 0 }, scurried: { a: false, b: false }, escapes: { a: 0, b: 0 }, zipReady: { a: 0, b: 0 }, ready: new Set(), acks: new Set(),
      paintSum: { a: 0, b: 0 }, paintOk: { a: false, b: false }, glintAt: { a: -1e9, b: -1e9 }, trailUntil: { a: 0, b: 0 }, trailNext: 0,
      pendingTag: 0, foundSent: false, out: { a: false, b: false }, outSent: false, tagWindow: null,
      path: [], pathNext: 0, closest: Infinity, passes: 0, near: false, seekStart: 0, used: { a: 0, b: 0 }, lockSent: false, rec: null,
      scurry: null, endingHide: false, lockDone: false, toRecap: false, nexting: false, jumpReq: false, lastTick: 0, lastTrailT: 0, spawn: null, sprint: false,
    };
  }

  // physics bodies for locally controlled players (see move.js)
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

  // ── roles + rules ──
  const mode = () => (S.match ? S.match.mode : S.setup.mode);
  /** The rules in force: the match's (both devices agree via the phase protocol), else the lobby's. */
  const rules = () => (S.match && S.match.rules ? S.match.rules : S.setup.rules);
  const sizeS = () => sizeScale(rules().size);
  const hideMs = () => TUNE.hide || rules().hide * 1000;
  const seekMs = () => TUNE.seek || rules().seek * 1000;
  const scanCdMs = () => rules().scanCd * 1000;
  const pelletsFor = (md) => (md === 'db' ? Math.max(2, rules().pellets - 1) : rules().pellets);
  let appliedSize = -1;
  /** Apply the size setting to both bodies and avatars (collider, step, head, jump, visual). */
  function applySize() {
    const sz = sizeS();
    if (sz === appliedSize || !stage) return;
    appliedSize = sz;
    for (const w of ['a', 'b']) { sizeBody(body[w], sz); stage.av[w].setSize(sz); }
  }
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
      loadMap(S.setup.map);
      applySize();
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

  /** Load a map and everything that depends on it (minimap plan, size). */
  function loadMap(id) {
    const before = stage.map;
    const m = stage.loadMap(id);
    if (m !== before) {
      const big = m.big;
      hud.miniSetup(big ? { minX: m.bounds.minX, maxX: m.bounds.maxX, minZ: m.bounds.minZ, maxZ: m.bounds.maxZ, rooms: m.rooms.filter((r) => !r.floor), boxes: m.colliders.filter((c) => c.maxY - c.minY > 0.5 && c.minY < 1.2 && c.name !== 'back' && c.name !== 'front' && c.name !== 'left' && c.name !== 'right') } : null);
    }
    return m;
  }
  function placeLobby() {
    const s = stage.map.spots.lobby || { x: 0, z: 0.9 };
    const sz = sizeS();
    for (const w of ['a', 'b']) {
      const b = body[w]; b.x = s.x + (w === 'a' ? -0.55 : 0.55) * sz; b.z = s.z; b.yaw = w === 'a' ? 1.2 : -1.2; b.pose = 'stand'; b.vis = 1;
      resetBody(b);
      b.y = stage.world.groundAt(b.x, b.z, 0.2, (s.y || 0) + 2);
      stage.world.pushOut(b);
      stage.av[w].setPose('stand', true);
    }
  }

  // ── host director ─────────────────────────────────────────────────
  function matchInfo() { const m = S.match; return m ? { id: m.id, mode: m.mode, map: m.map, first: m.first, rounds: m.rounds, hist: m.hist, rules: m.rules } : null; }
  function enter(name, { round, dur = 0, data = null, at = null } = {}, lead = DUR.lead) {
    if (!isHost) return;
    if (!local && lead > 0) lead = Math.max(lead, leadFor());
    const p = { seq: ++S.hostSeq, name, round: round ?? S.phase.round, at: at != null ? Math.max(at, now() + 40) : now() + lead, dur, data, sc: S.match ? { ...S.match.scores } : { a: 0, b: 0 }, m: matchInfo() };
    if (!local) { link.send('ph', p); link.blast('ph', p); }
    queuePhase(p);
  }
  function hostStart() {
    if (!isHost || S.match) return;
    const st = S.setup = sanitizeSetup(S.setup, MAP_IDS, S.setup.first);
    if (local && st.mode === 'db') st.mode = 'hs';
    saveSetup(st);
    S.sheet = false;
    S.match = { id: Math.random().toString(36).slice(2, 9), mode: st.mode, map: st.map, first: st.first, rounds: st.mode === 'db' ? 3 : st.rules.rounds, scores: { a: 0, b: 0 }, hist: [], rules: { ...st.rules } };
    applySize();
    startRound(1);
  }
  /** How far ahead to schedule a shared moment so the message is there in time. */
  function leadFor() { return Math.max(DUR.lead, Math.min(1200, link.rtt * 1.3 + 160)); }
  /** Two devices: after the seek clock hits zero, how long a shot fired just before it may take
   *  to be confirmed by the victim (shooter → victim → host) before time is called. */
  function tagGrace() { return local ? 0 : Math.min(1600, link.rtt * 1.2 + 250); }
  /** Random but fair spawns from the map's lists, seeded by match + round (same on both devices). */
  function pickSpawns(r) {
    const sp = stage.map.spots; const rnd = seeded(`${S.match.id}:${r}`);
    const H = sp.hiderSpawns; const K = sp.seekerSpawns;
    const hs = rnd.int(H.length);
    // Double Blind: the two hiders start as far apart as the lists allow
    let a = hs; let b = 0; let best = -1;
    const all = H.concat(K);
    for (let i = 0; i < all.length; i++) { const d = Math.hypot(all[i].x - H[a].x, all[i].z - H[a].z); if (d > best) { best = d; b = i; } }
    return { hs, ss: rnd.int(K.length), da: a, db: b };
  }
  function startRound(r, at = null) {
    const spawn = pickSpawns(r);
    if (local) enter('curtain', { round: r, data: { kind: 'hide', who: hiderOfRound(r), spawn }, at }, 0);
    else enter('hide', { round: r, dur: hideMs(), at: at != null ? at + DUR.title : null, data: { spawn } }, DUR.title);
  }
  /** Seeker spawn for the hunt: random among the ones ≥ 6 m from where the hider ended up. */
  function pickSeekSpawn() {
    const K = stage.map.spots.seekerSpawns;
    if (K.length < 2 || mode() !== 'hs') return null;
    const h = hiderOf(S.phase.round);
    let hx; let hz;
    if (controlsOf(h)) { hx = body[h].x; hz = body[h].z; } else if (remHint.set) { hx = remHint.x; hz = remHint.z; } else return null;
    const far = []; let fallback = 0; let bestD = -1;
    K.forEach((p, i) => { const d = Math.hypot(p.x - hx, p.z - hz); if (d >= 6) far.push(i); if (d > bestD) { bestD = d; fallback = i; } });
    const rnd = seeded(`${S.match.id}:${S.phase.round}:seek`);
    return far.length ? far[rnd.int(far.length)] : fallback;
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
    enter('seek', { dur: seekMs(), data: { ss: pickSeekSpawn() } }, DUR.seekLead);
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
      rec = { round: r, hider: h, seeker: other(h), found: !!res.found, ms: Math.round(ms), points, outOfPellets: !!res.out, p: res.p || null, surf: spotOf(h) };
    } else {
      const wnr = res.found ? res.by : null;
      if (wnr) m.scores[wnr] += 1;
      rec = { round: r, winner: wnr, victim: res.found ? res.victim : null, found: !!res.found, ms: Math.round(elapsed), p: res.p || null, hider: res.found ? res.victim : null, seeker: wnr, surf: res.found ? spotOf(res.victim) : null };
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
    if (!S.match || S.match.id !== p.m.id) S.match = { ...p.m, scores: { ...(p.sc || { a: 0, b: 0 }) }, rules: sanitizeRules(p.m.rules) };
    else { S.match.hist = p.m.hist; S.match.scores = { ...(p.sc || S.match.scores) }; S.match.rounds = p.m.rounds; if (p.m.rules) S.match.rules = sanitizeRules(p.m.rules); }
    if (stage && stage.map && stage.map.id !== S.match.map) { loadMap(S.match.map); stage.compile(); }
    applySize();
    api.setScore(S.match.scores);
  }

  function prepareRound(p) {
    adoptMatch(p);
    if (R.round !== p.round) resetRound(p.round, p.data);
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

  /** Put a body at a spawn spot (feet on whatever floor is there). */
  function placeAt(w, sp) {
    const b = body[w];
    b.x = sp.x; b.z = sp.z; b.yaw = sp.yaw || 0; b.pose = 'stand'; b.lookYaw = 0; b.lookPitch = 0; b.speed = 0; b.vis = 1;
    resetBody(b);
    b.y = stage.world.groundAt(b.x, b.z, 0.2, (sp.y || 0) + 0.5);
    stage.world.pushOut(b);
    b.onGround = true;
    stage.av[w].setPose('stand', true);
    stage.av[w].st.wallN = null;
    snapOrient[w] = true;
  }
  function resetRound(round, data = null) {
    const keep = R.round === round;
    if (keep) return;
    Object.assign(R, freshRound(round));
    if (!stage) return;
    applySize();
    stage.fx.clearRound();
    const m = stage.map; const md = mode(); const ru = rules();
    R.maxPellets = pelletsFor(md);
    for (const w of ['a', 'b']) { R.pellets[w] = R.maxPellets; R.scansLeft[w] = ru.scans || Infinity; R.escapes[w] = ru.escapes; }
    const h = md === 'hs' ? hiderOfRound(round) : null;
    const sp = (data && data.spawn) || { hs: 0, ss: 0, da: 0, db: 0 };
    R.spawn = sp;
    const H = m.spots.hiderSpawns; const K = m.spots.seekerSpawns; const all = H.concat(K);
    for (const w of ['a', 'b']) {
      let spot;
      if (md === 'db') spot = w === 'a' ? (all[sp.da] || m.spots.spawnA) : (all[sp.db] || m.spots.spawnB);
      else spot = w === h ? (H[sp.hs] || H[0]) : (K[sp.ss] || K[0]);
      placeAt(w, spot);
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
        resetRound(p.round, p.data);
        S.actor = null; S.curtainUp = true;
        controls && controls.setMode('none');
        if (p.data && p.data.kind === 'seek') exitPaint(true);
        break;
      case 'hide': {
        resetRound(p.round, p.data);
        if (local) S.actor = hiderOf(p.round);
        S.curtainUp = false;
        const vv = viewer();
        snd.play('go');
        if (vv && (roleOf(vv) === 'hider' || roleOf(vv) === 'both')) {
          C.yaw = body[vv].yaw + Math.PI;
          hint(mode() === 'db' ? 'Find a spot, pose, paint. Then hit “Hidden”.' : rules().climb ? 'Find a spot — walls and ceilings count — then paint yourself to match.' : 'Find a spot, pick a pose, then paint yourself to match.', 3600);
          if (rules().climb && !tipsSeen() && !TUNE.noTips) U.tips = true;
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
        U.tips = false;
        const vv = viewer();
        // the seeker starts from a fair spawn away from where the hider ended up
        const ss = p.data && p.data.ss;
        if (ss != null && stage && mode() === 'hs') { const sk = other(hiderOf(p.round)); const K = stage.map.spots.seekerSpawns; if (controlsOf(sk) && K[ss]) placeAt(sk, K[ss]); }
        R.sprint = false;
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
        if (stage) {
          // the highlight ring lies on whatever surface the hider was on (floor, wall, ceiling)
          const tw = recapTarget(); const rt = stage.av[tw].root; const q = rt.quaternion;
          const ux = 2 * (q.x * q.y - q.w * q.z); const uy = 1 - 2 * (q.x * q.x + q.z * q.z); const uz = 2 * (q.y * q.z + q.w * q.x);
          const ring = stage.fx.ring;
          ring.position.set(rt.position.x + ux * 0.02, rt.position.y + uy * 0.02, rt.position.z + uz * 0.02);
          tvA.set(ux, uy, uz); ring.quaternion.setFromUnitVectors(Z_AXIS, tvA);
          ring.userData.size = stage.av[tw].st.size;
          ring.visible = true; stage.fx.hlMat.color.set(theme.hl);
        }
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
      link.sendBlob('paint', enc.b64, { w, sum: enc.sum, round: R.round, pos: posArr(b) });
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
      if (meta.pos) setRemHint(meta.pos);
      if (isHost) hostAck(w); else link.send('gotpaint', { w, sum });
    } else link.send('paintreq', { w, round: meta.round });
  });
  const remHint = { set: false, x: 0, y: 0, z: 0, yaw: 0, po: 0, wa: 0, q: Q_ID, at: 0 };
  function setRemHint(a) { const [x, y, z, yaw, po, wa, q, at] = a; remHint.x = x; remHint.y = y; remHint.z = z; remHint.yaw = yaw; remHint.po = po; remHint.wa = wa; remHint.q = q == null ? packQuat(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)) : q; remHint.at = at || 0; remHint.set = true; }
  const qTmp = [0, 0, 0, 1];
  /** Compact pose of a body for blobs / snapshots: [x, y, z, yaw, pose, wa, q, attached, nx, ny, nz, fx, fy, fz]. */
  function posArr(b) { bodyQuat(b, qTmp); return [b.x, b.y, b.z, b.yaw, POSES.indexOf(b.pose), b.wa, packQuat(qTmp[0], qTmp[1], qTmp[2], qTmp[3]), b.at ? 1 : 0, b.nx, b.ny, b.nz, b.fx, b.fy, b.fz, b.sq ? 1 : 0]; }
  function restorePos(w, a) {
    const [x, y, z, yaw, po, wa, , at, nx, ny, nz, fx, fy, fz, sq] = a; const b = body[w];
    b.x = x; b.y = y; b.z = z; b.yaw = yaw; b.pose = POSES[po] || 'stand'; b.wa = wa || 0;
    resetBody(b);
    if (at && Number.isFinite(nx)) { attachBody(stage.world, b, x, y, z, nx, ny, nz, null, fx, fy, fz); b.lockY = !rules().climb; }
    else if (at && a[6] != null) {
      // only the packed orientation survived (a relayed position): rebuild the face from it
      unpackQuat(a[6], qTmp); const [qx, qy, qz, qw] = qTmp;
      const ux = 2 * (qx * qy - qw * qz); const uy = 1 - 2 * (qx * qx + qz * qz); const uz = 2 * (qy * qz + qw * qx);
      const ax = Math.abs(ux) >= Math.abs(uy) && Math.abs(ux) >= Math.abs(uz) ? 0 : Math.abs(uy) >= Math.abs(uz) ? 1 : 2;
      const n = [0, 0, 0]; n[ax] = Math.sign([ux, uy, uz][ax]) || 1;
      const hx = 2 * (qx * qz + qw * qy); const hy = 2 * (qy * qz - qw * qx); const hz = 1 - 2 * (qx * qx + qy * qy);
      attachBody(stage.world, b, x, y, z, n[0], n[1], n[2], null, hx, hy, hz); b.lockY = !rules().climb;
    }
    b.sq = !!sq;
    stage.av[w].setPose(b.pose, true);
  }
  link.on('gotpaint', (d) => { if (isHost && d && S.phase.name === 'lock') hostAck(d.w); });
  link.on('paintreq', (d) => { if (d && d.w === me) { R.lockSent = false; lockPaint(me); } });
  link.on('ph', (p) => { if (!isHost) queuePhase(p); });
  link.on('setup', (d) => { if (!isHost && d) { S.setup = sanitizeSetup({ ...S.setup, ...d }, MAP_IDS, S.setup.first); S.setupVer++; if (stage && !S.match) { loadMap(S.setup.map); applySize(); placeLobby(); stage.compile(); } } });
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
  link.on('scan', (d) => { if (d) { glint(other(d.by), d.at, d.by); if (typeof d.left === 'number') R.scansLeft[d.by] = d.left < 0 ? Infinity : d.left; R.scanReady[d.by] = d.at - 140 + scanCdMs(); } });
  link.on('scurry', (d) => { if (d) { R.trailUntil[d.w] = d.at + 650; R.scurried[d.w] = true; if (typeof d.left === 'number') R.escapes[d.w] = d.left; if (stage) stage.fx.trailMat.color.set(d.w === 'a' ? theme.a : theme.b); } });
  // tongue-zip while being hunted: the partner sees the tongue lash out and a short trail (the tell)
  link.on('zip', (d) => {
    if (!d || !stage) return;
    R.trailUntil[d.w] = d.at + 550; if (typeof d.left === 'number') R.escapes[d.w] = d.left;
    stage.fx.trailMat.color.set(d.w === 'a' ? theme.a : theme.b);
    const a = stage.av[d.w];
    if (a.root.visible && Array.isArray(d.to) && tvZ) { a.mouthWorld(tvZ); stage.fx.shootTongue(tvZ, { x: d.to[0], y: d.to[1], z: d.to[2] }, tSec, ZIP.dur + 0.1, (out) => a.mouthWorld(out)); snd.play('zip'); }
  });

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
      if (b) pos[w] = posArr(b);
      else if (S.partnerKeep) pos[w] = S.partnerKeep;
      else if (rem.v > 0.5) pos[w] = [rem.x, rem.y, rem.z, rem.yaw, Math.round(rem.po), rem.wa, rem.q, rem.at];
    }
    const remaining = S.paused ? S.paused.remaining : Math.max(0, S.phase.end - t);
    return {
      v: 1, setup: S.setup, match: S.match, hostSeq: Math.max(S.hostSeq, S.phase.seq),
      phase: { name: S.phase.name, seq: S.phase.seq, round: S.phase.round, dur: S.phase.dur, remaining, data: S.phase.data },
      tex, pos, pellets: R.pellets, scurried: R.scurried, escapes: R.escapes, scansLeft: { a: Number.isFinite(R.scansLeft.a) ? R.scansLeft.a : -1, b: Number.isFinite(R.scansLeft.b) ? R.scansLeft.b : -1 }, scanIn: { a: Math.max(0, R.scanReady.a - t), b: Math.max(0, R.scanReady.b - t) }, seekElapsed: S.phase.name === 'seek' ? t - R.seekStart : 0,
    };
  }
  function sendSnap() { link.sendBlob('snap', JSON.stringify(snapshot())); S.partnerKeep = null; }
  function adoptSnap(s) {
    if (!s || s.v !== 1 || !stage) return;
    S.setup = sanitizeSetup(s.setup || S.setup, MAP_IDS, S.setup.first); S.setupVer++;
    S.match = s.match;
    if (S.match) S.match.rules = sanitizeRules(S.match.rules);
    if (S.match && stage.map.id !== S.match.map) { loadMap(S.match.map); stage.compile(); }
    applySize();
    const ph = s.phase;
    if (R.round !== ph.round) resetRound(ph.round);
    const t = now();
    S.phase = { name: ph.name, seq: ph.seq, round: ph.round, at: t, end: t + ph.remaining, dur: ph.dur, data: ph.data };
    S.queue.length = 0;
    if (isHost) S.hostSeq = Math.max(S.hostSeq, s.hostSeq || ph.seq);
    for (const w of ['a', 'b']) if (s.tex && s.tex[w]) { stage.paints[w].decode(s.tex[w]); stage.paints[w].flush(); R.paintOk[w] = true; }
    for (const w of ['a', 'b']) if (s.pos && s.pos[w] && controlsOf(w)) restorePos(w, s.pos[w]);
    if (s.pellets) R.pellets = { ...s.pellets };
    if (s.scurried) R.scurried = { ...s.scurried };
    if (s.escapes) R.escapes = { ...s.escapes };
    if (s.scansLeft) for (const w of ['a', 'b']) R.scansLeft[w] = s.scansLeft[w] < 0 ? Infinity : s.scansLeft[w];
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
      S.partnerKeep = [rem.x, rem.y, rem.z, rem.yaw, Math.round(rem.po), rem.wa, rem.q, rem.at];
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
    stats.lastShot = { tag: isTag, hit: !!hit, obj: hit ? (stage.isMap(hit.object) ? 'map' : 'other') : null, p: msg.p, o: [o.x, o.y, o.z], d: [dir.x, dir.y, dir.z], tgtVisible: stage.av[tgt].root.visible, seen };
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
    const tol = TAG_TOL * Math.max(1, sizeS()); // hit radius grows with the body
    let any = false;
    for (let k = 0; k < hist.n; k++) {
      const t = hist.t[k];
      if (t < t0 || t > t1) continue;
      any = true;
      if (Math.hypot(hist.x[k] - seen[0], hist.y[k] - seen[1], hist.z[k] - seen[2]) <= tol) return true;
    }
    if (!any) { const b = body[me]; return Math.hypot(b.x - seen[0], b.y - seen[1], b.z - seen[2]) <= tol; }
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
    if (R.scansLeft[w] <= 0) { hint('No scans left this hunt', 1200); snd.play('warn'); return; }
    if (t < R.scanReady[w]) { hint(`Scan ready in ${Math.ceil((R.scanReady[w] - t) / 1000)} s`, 1200); return; }
    R.scanReady[w] = t + scanCdMs();
    R.scansLeft[w]--;
    const at = t + 140;
    snd.play('chirp'); hud.ripple();
    glint(targetOf(w), at, w);
    if (!local) link.send('scan', { by: w, at, left: Number.isFinite(R.scansLeft[w]) ? R.scansLeft[w] : -1 });
  }
  function glint(target, at, by) {
    R.glintAt[target] = at;
    const t = now();
    if (!local && target === me) later(() => { snd.play('glint'); hud.vignette(true); hint('Chirp! Your eyes just glinted.', 1600); later(() => hud.vignette(false), 700); }, Math.max(0, at - t));
    void by;
  }
  function scurry() {
    const w = viewer();
    if (!w || local || S.phase.name !== 'seek' || roleOf(w) !== 'hider' || frozen()) return;
    if (R.escapes[w] <= 0) { hint(rules().escapes ? 'No escapes left' : 'Escapes are off in these rules', 1400); snd.play('warn'); return; }
    const b = body[w];
    const yaw = fpBaseYaw(w) + b.lookYaw;
    R.scurried[w] = true; R.escapes[w]--;
    const sp = SPEED.scurry * (0.8 + 0.2 * b.s);
    // along the look direction, flattened onto whatever surface we're on
    R.scurry = { until: tSec + 0.5, vx: Math.sin(yaw) * Math.cos(b.lookPitch) * sp, vy: Math.sin(b.lookPitch) * sp, vz: Math.cos(yaw) * Math.cos(b.lookPitch) * sp };
    if (!b.at) R.scurry.vy = 0;
    if (b.pose !== 'squeeze') { b.pose = 'stand'; stage.av[w].setPose('stand'); }
    R.trailUntil[w] = now() + 650;
    stage.fx.trailMat.color.set(w === 'a' ? theme.a : theme.b);
    link.send('scurry', { w, at: now(), left: R.escapes[w] });
    snd.play('scurry');
  }

  // ── sticky feet: stick / let go, tongue-zip ──────────────────────
  function canMoveSelf(w) {
    const ph = S.phase.name; const role = roleOf(w);
    return !!w && !frozen() && ph === 'hide' && (role === 'hider' || role === 'both');
  }
  function popFx(w, b, color) {
    stage.av[w].squash(0.85);
    const s = b.s;
    stage.fx.pop(b.x, b.y, b.z, b.nx, b.ny, b.nz, color || '#ffffff', 0.32 * s, tSec);
  }
  /** Stick to the nearest wall / overhead surface (or let go). */
  function stick(w = viewer()) {
    if (!w || !stage) return;
    const b = body[w];
    if (b.at) { unstick(w); return; }
    if (!canMoveSelf(w)) return;
    if (!rules().climb) { hint('Climbing is off in these rules', 1400); snd.play('warn'); return; }
    if (b.sq) { hint('Squeeze out first', 1200); return; }
    const s = stage.world.nearestSurface(b, 0.35 * b.s + 0.1);
    if (s) attachTo(w, s.x, s.y, s.z, s.nx, s.ny, s.nz, s.box);
    else attachTo(w, b.x, b.y, b.z, 0, 1, 0, stage.world.groundRes.box);
    return b.at;
  }
  function attachTo(w, x, y, z, nx, ny, nz, box, hx, hy, hz) {
    const b = body[w];
    const wasPose = b.pose;
    attachBody(stage.world, b, x, y, z, nx, ny, nz, box, hx, hy, hz);
    b.lockY = !rules().climb;
    if (wasPose !== 'wall' && wasPose !== 'stand') { b.pose = 'stand'; stage.av[w].setPose('stand'); }
    popFx(w, b, theme.hl);
    snd.play('stick'); api.haptic(12);
    P.texelDirtyAt = tSec + 0.3;
    if (ny < -0.7) { C.autoPitch = -0.12; C.autoUntil = tSec + 0.9; hintOnce('ceil', 'Upside down! Pick Hang to dangle, or crawl along.', 2400); }
    else if (Math.abs(ny) < 0.7) hintOnce('wall', 'Sticky feet! Crawl anywhere — Jump leaps off, Stick lets go.', 2600);
    else hintOnce('floor-stick', 'Sticky feet on: walk off an edge to crawl down its side.', 2400);
  }
  function unstick(w, { jump = false } = {}) {
    const b = body[w];
    if (!b.at) return;
    const nx = b.nx; const ny = b.ny; const nz = b.nz;
    popFx(w, b, '#ffffff');
    if (b.pose === 'hang' || b.pose === 'corner' || b.pose === 'perch') { b.pose = 'stand'; stage.av[w].setPose('stand'); }
    if (b.pose === 'wall') { b.pose = 'stand'; stage.av[w].setPose('stand'); }
    if (jump && ny < 0.7) detachBody(stage.world, b, 2.6 * Math.sqrt(b.s), ny < -0.7 ? 0 : b.jumpV * 0.82);
    else detachBody(stage.world, b, jump ? 0.4 : 0.5, jump ? b.jumpV : 0);
    snd.play(jump ? 'jump' : 'unstick'); api.haptic(8);
    stage.av[w].squash(0.6);
    P.texelDirtyAt = tSec + 0.3;
    void nx; void nz;
  }
  /** Tongue-zip: shoot the tongue at the surface in the middle of the view and reel in. */
  let tvZ = null;
  function zip(w = viewer()) {
    if (!w || !stage || frozen()) return false;
    const ph = S.phase.name; const role = roleOf(w); const b = body[w];
    const seeking = ph === 'seek' && role === 'hider' && !local;
    if (!(canMoveSelf(w) || seeking)) return false;
    if (!rules().climb) { hint('Climbing is off in these rules', 1400); snd.play('warn'); return false; }
    if (b.zip) return false;
    const t = now();
    if (t < R.zipReady[w]) { hint(`Tongue ready in ${Math.ceil((R.zipReady[w] - t) / 1000)} s`, 900); return false; }
    if (seeking && R.escapes[w] <= 0) { hint(rules().escapes ? 'No escapes left' : 'Escapes are off in these rules', 1400); snd.play('warn'); return false; }
    // aim: the centre of the screen (third person) or the eyes' look direction (first person)
    let ox; let oy; let oz; let dx; let dy; let dz;
    const cam = stage.camera;
    if (seeking) {
      const yaw = fpBaseYaw(w) + b.lookYaw;
      ox = cam.position.x; oy = cam.position.y; oz = cam.position.z;
      dx = Math.sin(yaw) * Math.cos(b.lookPitch); dy = Math.sin(b.lookPitch); dz = Math.cos(yaw) * Math.cos(b.lookPitch);
    } else {
      cam.getWorldDirection(tvA);
      ox = cam.position.x; oy = cam.position.y; oz = cam.position.z; dx = tvA.x; dy = tvA.y; dz = tvA.z;
    }
    const range = ZIP.range * Math.sqrt(b.s);
    const cx = b.x + b.nx * 0.2 * b.s; const cy = b.y + b.ny * 0.2 * b.s + (b.at ? 0 : 0.15 * b.s); const cz = b.z + b.nz * 0.2 * b.s;
    // skip the part of the ray between the camera and the chameleon
    const along = Math.max(0, (cx - ox) * dx + (cy - oy) * dy + (cz - oz) * dz);
    const H = stage.world.raycast(ox + dx * along, oy + dy * along, oz + dz * along, dx, dy, dz, range + 1, (bx) => bx.climb !== false, true);
    if (!H || Math.hypot(H.x - cx, H.y - cy, H.z - cz) > range || !stage.world.inside(H.x, H.z)) { hint('Nothing in tongue range there — aim at a nearby surface', 1500); snd.play('warn'); return false; }
    if (Math.hypot(H.x - cx, H.y - cy, H.z - cz) < 0.35 * b.s) { hint('Too close — just crawl there', 1000); return false; }
    b.zip = { t0: tSec, dur: ZIP.dur, sx: b.x, sy: b.y, sz: b.z, tx: H.x, ty: H.y, tz: H.z, nx: H.nx, ny: H.ny, nz: H.nz, box: H.box, hx: dx, hy: dy, hz: dz, from: b.at ? 1 : 0 };
    if (!b.at) { b.zip.sy = b.y + b.r; }
    R.zipReady[w] = t + (seeking ? ZIP.cdSeek : ZIP.cdHide);
    stage.av[w].mouthWorld(tvZ);
    stage.fx.shootTongue(tvZ, { x: H.x, y: H.y, z: H.z }, tSec, ZIP.dur + 0.1, (out) => stage.av[w].mouthWorld(out));
    snd.play('zip'); api.haptic(14);
    if (b.pose !== 'stand' && b.pose !== 'wall') { b.pose = 'stand'; stage.av[w].setPose('stand'); }
    b.sq = false;
    if (seeking) {
      R.escapes[w]--;
      R.trailUntil[w] = t + 550;
      stage.fx.trailMat.color.set(w === 'a' ? theme.a : theme.b);
      link.send('zip', { w, at: t, to: [H.x, H.y, H.z], left: R.escapes[w] });
    }
    return true;
  }
  /** Advance a zip in flight; lands stuck to the target surface (or on its feet on a floor). */
  function zipStep(w, b) {
    const z = b.zip;
    const k = clamp((tSec - z.t0) / z.dur, 0, 1);
    const e = k < 0.25 ? 0 : (k - 0.25) / 0.75; // tongue flies first, then the body
    const ee = e * e * (3 - 2 * e);
    const arc = Math.sin(ee * Math.PI) * 0.25 * b.s;
    b.x = z.sx + (z.tx - z.sx) * ee; b.y = z.sy + (z.ty - z.sy) * ee + arc; b.z = z.sz + (z.tz - z.sz) * ee;
    if (k < 1) return;
    b.zip = null;
    if (z.ny > 0.7) {
      // landed on a floor / top: stand there
      resetBody(b); b.x = z.tx; b.y = z.ty; b.z = z.tz; b.onGround = true; stage.world.pushOut(b);
      b.yaw = Math.atan2(z.hx, z.hz); b.fx = Math.sin(b.yaw); b.fz = Math.cos(b.yaw);
      popFx(w, b, theme.hl); snd.play('land');
    } else attachTo(w, z.tx, z.ty, z.tz, z.nx, z.ny, z.nz, z.box, z.hx, z.hy, z.hz);
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
      const r = BRUSH[P.size] * body[viewer()].s;
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
    const r = (P.tool === 'fill' ? 0.03 : BRUSH[P.size]) * body[viewer()].s;
    stage.fx.setCursor(true, hit.point.x, hit.point.y, hit.point.z, curN.x, curN.y, curN.z, r, P.hard ? theme.outline : '#ffffff');
  }
  function dabAt(hit) { dab3(hit.point.x, hit.point.y, hit.point.z); }
  function dab3(x, y, z) {
    const v = viewer();
    const cam = stage.camera.position;
    let vx = x - cam.x; let vy = y - cam.y; let vz = z - cam.z;
    const l = Math.hypot(vx, vy, vz) || 1; vx /= l; vy /= l; vz /= l;
    stage.paints[v].dab(x, y, z, vx, vy, vz, BRUSH[P.size] * body[v].s, P.rgb, P.hard, 0.45);
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
    if (!rules().stamp) { hint('The stamp is off in these rules — paint by hand', 1600); snd.play('warn'); return; }
    refreshTexels();
    let hit = null;
    if (b.at) {
      // the surface we're stuck to (wall, ceiling, underside, top)
      stage.ray.set(tv3.set(b.x + b.nx * 0.5, b.y + b.ny * 0.5, b.z + b.nz * 0.5), tv3b.set(-b.nx, -b.ny, -b.nz));
      hit = stage.pickMap(1.0);
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
    const kind = surfaceKind(b);
    hint(kind === 'wall' ? 'Stamped the wall onto your back' : kind === 'ceiling' ? 'Stamped the ceiling onto your back' : 'Stamped the surface under you onto your skin', 1600);
  }
  let tv3 = null; let tv3b = null;

  // ── poses ─────────────────────────────────────────────────────────
  /** Which poses make sense right now (drives the pose bar too). */
  function poseOk(w, name) {
    const b = body[w]; const climb = rules().climb;
    switch (name) {
      case 'stand': case 'ball': return true;
      case 'crouch': case 'flat': case 'squeeze': return !b.at;
      case 'wall': return b.at ? Math.abs(b.ny) < 0.7 || climb : !!stage.world.nearestWall(b.x, b.y, b.z, 0.5 + b.r);
      case 'hang': return climb && b.at && b.ny < -0.7;
      case 'perch': return b.at ? !!(b.box && b.box.perch) : !!(stage.world.groundAt(b.x, b.z, b.r * 0.6, b.y + 0.05) >= 0 && stage.world.groundRes.box && stage.world.groundRes.box.perch);
      case 'corner': return b.at && Math.abs(b.ny) < 0.7 && !!stage.world.cornerAt(b.x, b.y, b.z, b.nx, b.nz, 0.45 + b.r);
      default: return false;
    }
  }
  function setPose(name) {
    const v = viewer();
    if (!v || !POSES.includes(name) || frozen()) return;
    const ph = S.phase.name; const role = roleOf(v);
    const allowed = (ph === 'hide' && (role === 'hider' || role === 'both')) || (ph === 'seek' && (role === 'hider' || role === 'both'));
    if (!allowed) return;
    const b = body[v];
    if (b.zip) return;
    // leaving the squeeze needs room to stand
    if (b.sq && name !== 'squeeze') {
      if (!stage.world.roomFor(b)) { hint('No room to stand up here — squeeze out first', 1600); snd.play('warn'); return; }
      b.sq = false;
    }
    if (name === 'wall') {
      if (!b.at) {
        const wall = stage.world.nearestWall(b.x, b.y, b.z, 0.5 + b.r);
        if (!wall) { hint('Get right up against a wall or the side of something first', 2200); snd.play('warn'); return; }
        // press flat against it: stick to the face, head up
        const cy = b.y + 0.25 * b.s;
        attachBody(stage.world, b, wall.nx ? wall.px : b.x, cy, wall.nz ? wall.pz : b.z, wall.nx, 0, wall.nz, wall.box, 0, 1, 0);
        b.lockY = !rules().climb;
        stage.av[v].squash(0.7); snd.play('stick');
      }
    } else if (name === 'hang') {
      if (!b.at || b.ny > -0.7) { hint(rules().climb ? 'Hang from a ceiling or the underside of something — Stick to it first' : 'Climbing is off in these rules', 2200); snd.play('warn'); return; }
    } else if (name === 'corner') {
      const c = b.at && Math.abs(b.ny) < 0.7 ? stage.world.cornerAt(b.x, b.y, b.z, b.nx, b.nz, 0.45 + b.r) : null;
      if (!c) { hint('Flatten against a wall next to a corner first', 2000); snd.play('warn'); return; }
      // slide into the corner and turn into the diagonal
      const tx = -b.nz; const tz = b.nx; const dir = (c.x - b.x) * tx + (c.z - b.z) * tz;
      const into = Math.sign(dir) * Math.max(0, Math.abs(dir) - b.r * 0.55);
      b.x += tx * into; b.z += tz * into;
      b.cnx = c.nx; b.cnz = c.nz;
    } else if (name === 'perch') {
      if (!poseOk(v, 'perch')) { hint('Perch on something thin: a rail, a pole, a stem', 2000); snd.play('warn'); return; }
    } else if (name === 'squeeze') {
      if (b.at) { hint('Let go first, then squeeze in at floor level', 1600); return; }
      b.sq = true;
      hintOnce('sq', 'Squeezed flat: slide into gaps behind and under things. Slowly.', 2400);
    } else if (b.at && (name === 'crouch' || name === 'flat')) {
      name = 'wall';
    }
    if (name !== 'corner') { b.cnx = 0; b.cnz = 0; }
    b.pose = name;
    stage.av[v].setPose(name);
    stage.av[v].st.wallN = null;
    P.texelDirtyAt = tSec + 0.4;
    snd.play('pose');
    if (name === 'wall') hint(rules().climb ? 'Flat on the wall. Move to crawl — up, sideways, onto the ceiling.' : 'Flat on the wall. Move to slide along it — Stamp copies the wall onto you.', 2600);
  }

  // ── actions (buttons + keys) ──────────────────────────────────────
  function action(a) {
    if (S.destroyed || S.boot !== 'ready') return;
    snd.unlock();
    const v = viewer();
    if (a.startsWith('pose:')) { setPose(a.slice(5)); return; }
    switch (a) {
      case 'fire': if (S.phase.name === 'seek') fire(); break;
      case 'stick': if (v) { if (body[v].at || canMoveSelf(v)) stick(v); } break;
      case 'zip': if (v) zip(v); break;
      case 'stickOrPick': if (P.on) action('pick'); else action('stick'); break;
      case 'zipOrUndo': if (P.on) action('undo'); else action('zip'); break;
      case 'sprint': if (v && S.phase.name === 'seek' && roleOf(v) !== 'hider') { R.sprint = !R.sprint; snd.play('sprint'); } break;
      case 'settings': S.sheet = !S.sheet; snd.play('ui'); break;
      case 'tips-ok': U.tips = false; markTipsSeen(); snd.play('ui'); break;
      case 'scan': scan(); break;
      case 'scurry': scurry(); break;
      case 'jump': if (v && controlsOf(v)) R.jumpReq = true; break;
      case 'crouch': if (v) setPose(body[v].at ? (body[v].pose === 'wall' ? 'stand' : 'wall') : body[v].pose === 'crouch' ? 'stand' : 'crouch'); break;
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
      if (!isHost || S.match || t.disabled) return;
      const k = t.dataset.lobby; const val = t.dataset.v;
      if (k === 'mode' && local && val === 'db') return;
      if (k === 'custom') return;
      let next = S.setup;
      if (k === 'preset') next = { ...S.setup, rules: applyPreset(val) };
      else if (k === 'rule') next = { ...S.setup, rules: t.dataset.step ? stepRule(S.setup.rules, t.dataset.k, +t.dataset.step) : setRule(S.setup.rules, t.dataset.k, val) };
      else next = { ...S.setup, [k]: val };
      next = sanitizeSetup(next, MAP_IDS, S.setup.first);
      const mapChanged = next.map !== S.setup.map;
      S.setup = next;
      S.setupVer++;
      snd.play('ui');
      saveSetup(S.setup);
      if (mapChanged) { loadMap(S.setup.map); stage.compile(); }
      applySize();
      if (mapChanged || k === 'rule' || k === 'preset') placeLobby();
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
  function fpBaseYaw(w) { return headingYaw(body[w]); }
  /** Recap: where the hider was (from my own body, or the partner's published state). */
  function spotOf(w) {
    if (controlsOf(w)) { const b = body[w]; bodyQuat(b, qTmp); return spotKind(b.pose, quatUpY(qTmp[0], qTmp[1], qTmp[2], qTmp[3]), b.y); }
    if (remHint.set || rem.v > 0.5) {
      const useRem = rem.v > 0.5;
      const po = POSES[Math.round(useRem ? rem.po : remHint.po)] || 'stand';
      let up = 1;
      if (useRem && rem.qw != null) up = quatUpY(rem.qx, rem.qy, rem.qz, rem.qw);
      else { unpackQuat(remHint.q, qTmp); up = quatUpY(qTmp[0], qTmp[1], qTmp[2], qTmp[3]); }
      return spotKind(po, up, useRem ? rem.y : remHint.y);
    }
    return null;
  }
  function hint(text, ms) { hud.hint(text, ms); }
  function hintOnce(key, text, ms) { if (shownHints.has(key)) return; shownHints.add(key); hint(text, ms); }

  // ── per-frame ─────────────────────────────────────────────────────
  const mv = [0, 0]; const lk = [0, 0];
  let camPos = null; let camLook = null; let camWant = null; let lookWant = null; let tvA = null; let qOwn = null; let prj = null; let camR = null; let camF = null;
  const pubSt = {}; for (const f of FIELDS) pubSt[f] = 0;
  let lastScaleCheck = 0;
  function initVecs() {
    camPos = new THREE.Vector3(0, 6, 9); camLook = new THREE.Vector3(0, 0.5, 0); camWant = new THREE.Vector3(); lookWant = new THREE.Vector3(); tvA = new THREE.Vector3(); tvZ = new THREE.Vector3(); Y_AXIS = new THREE.Vector3(0, 1, 0); Z_AXIS = new THREE.Vector3(0, 0, 1);
    qOwn = new THREE.Quaternion(); prj = new THREE.Vector3(); camR = [0, 0, 0]; camF = [0, 0, 0];
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

  const projOut = (x, y, z, out) => {
    prj.set(x, y, z).applyMatrix4(stage.camera.matrixWorldInverse);
    if (prj.z > -0.02) return false;
    prj.applyMatrix4(stage.camera.projectionMatrix);
    out[0] = prj.x * stage.camera.aspect; out[1] = prj.y;
    return true;
  };
  const surfV = [0, 0, 0];
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
    const ru = rules();
    for (const w of ['a', 'b']) {
      if (!controlsOf(w)) continue;
      const b = body[w];
      let vx = 0; let vy = 0; let vz = 0; let jump = false; let mvMag = 0;
      const role = roleOf(w);
      const fp = ph === 'seek';
      if (w === v && !fz && (mode2 === 'move' || mode2 === 'look')) {
        controls.move(mv);
        mvMag = Math.min(1, Math.hypot(mv[0], mv[1]));
        if (fp) {
          // free look: the seeker can look almost straight up and down (ceiling hiders!)
          b.lookYaw -= lk[0] * sens; b.lookPitch = clamp(b.lookPitch - lk[1] * sens, -1.45, 1.45);
          if (role === 'hider') { b.lookYaw = clamp(wrapAngle(b.lookYaw), -1.9, 1.9); b.lookPitch = clamp(b.lookPitch, -1.2, 1.2); }
        } else {
          C.yaw -= lk[0] * sens; C.pitch = clamp(C.pitch + lk[1] * sens * 0.8, -1.05, 1.2);
          if (lk[0] || lk[1]) C.autoUntil = 0;
        }
        if (mode2 === 'move') {
          const sizeMul = 0.85 + 0.15 * b.s;
          let sp = ph === 'seek' ? (mode() === 'db' ? SPEED.db : SPEED.seek * SPEED_MUL[ru.seekSpeed] * ((R.sprint || controls.st.sprintHeld) && role === 'seeker' ? SPEED.sprint : 1)) : SPEED.hide * sizeMul;
          if (b.sq) sp *= SPEED.squeeze;
          if (b.at && !fp) {
            // sticky feet: screen-relative input mapped onto the surface
            stage.camera.updateMatrixWorld();
            stage.camera.getWorldDirection(tvA); camF[0] = tvA.x; camF[1] = tvA.y; camF[2] = tvA.z;
            camR[0] = Math.cos(C.yaw); camR[1] = 0; camR[2] = -Math.sin(C.yaw);
            inputOnSurface(b, mv[0], mv[1], projOut, camF, camR, surfV);
            const csp = sp * SPEED.crawl;
            vx = surfV[0] * csp; vy = surfV[1] * csp; vz = surfV[2] * csp;
          } else {
            let fx; let fzv; let rx; let rz;
            if (fp) { const yaw = b.yaw + b.lookYaw; fx = Math.sin(yaw); fzv = Math.cos(yaw); rx = -Math.cos(yaw); rz = Math.sin(yaw); }
            else { fx = -Math.sin(C.yaw); fzv = -Math.cos(C.yaw); rx = Math.cos(C.yaw); rz = -Math.sin(C.yaw); }
            vx = (fx * mv[1] + rx * mv[0]) * sp; vz = (fzv * mv[1] + rz * mv[0]) * sp;
          }
          jump = (R.jumpReq || controls.st.jumpHeld) && !(ph === 'seek' && mode() === 'db');
          if (fp) {
            // first person: body yaw follows the view; keep lookYaw small
            b.yaw = wrapAngle(b.yaw + b.lookYaw); b.lookYaw = 0;
          }
        }
      }
      const jumpPressed = R.jumpReq;
      R.jumpReq = false;
      // tongue-zip in flight
      if (b.zip) { zipStep(w, b); b.speed = 4; recordHist(w, b, t); continue; }
      // scurry dash overrides
      if (R.scurry && w === v) {
        if (tSec < R.scurry.until) { vx = R.scurry.vx; vy = R.scurry.vy; vz = R.scurry.vz; }
        else R.scurry = null;
      }
      const moving = vx * vx + vy * vy + vz * vz > 0.01;
      if (b.at) {
        if (fp && moving && !R.scurry) {
          // hunting in first person (Double Blind) while stuck somewhere: drop off first
          unstick(w);
        } else {
          if (jump && (jumpPressed || controls.st.jumpHeld) && !b.lockY) {
            unstick(w, { jump: true });
            b.speed = 0; recordHist(w, b, t);
            continue;
          }
          if (moving) {
            if (b.pose !== 'stand' && b.pose !== 'wall') { b.pose = b.pose === 'corner' ? 'wall' : 'stand'; stage.av[w].setPose(b.pose); }
            b.cnx = 0; b.cnz = 0;
            const res = crawlStep(world, b, vx, vy, vz, dt);
            if (res === 1 || res === 2) { stage.av[w].squash(0.25); if (b.ny < -0.7 && w === v) { C.autoPitch = -0.12; C.autoUntil = tSec + 0.9; } }
            if (res === 4) { stage.av[w].squash(0.4); snd.play('land'); }
            P.texelDirtyAt = tSec + 0.2;
          }
          b.speed = moving ? Math.hypot(vx, vy, vz) : 0;
          recordHist(w, b, t);
          continue;
        }
      }
      if (moving && b.pose !== 'stand' && b.pose !== 'crouch' && b.pose !== 'squeeze') { setPoseFor(w, 'stand'); }
      const sp2 = b.pose === 'crouch' ? 0.55 : 1;
      let landed = false;
      const px = b.x; const pz = b.z;
      const nSub = Math.max(1, Math.ceil(dt / 0.025));
      for (let k = 0; k < nSub; k++) landed = freeStep(world, b, vx * sp2, vz * sp2, dt / nSub, jump && !b.sq && k === 0) || landed;
      if (jump && b.vy > 3 && !b.at) snd.play('jump');
      if (landed) { snd.play('land'); stage.av[w].squash(0.3); }
      // walk into a wall holding forward → the feet stick (hider, hide phase, climbing allowed)
      if (moving && ru.climb && !b.sq && w === v && ph === 'hide' && (role === 'hider' || role === 'both') && mvMag > 0.6) {
        const want = Math.hypot(vx, vz) * dt; const got = Math.hypot(b.x - px, b.z - pz);
        if (got < want * 0.35) {
          const sp = Math.hypot(vx, vz) || 1; const dx = vx / sp; const dz = vz / sp;
          const H = world.raycast(b.x, b.y + Math.min(b.head * 0.5, 0.2), b.z, dx, 0, dz, b.r + 0.12, (bx) => bx.climb !== false && bx.maxY - bx.minY > 0.25, false);
          if (H && H.nx * dx + H.nz * dz < -0.7 && world.inside(H.x, H.z)) {
            b.pushT += dt;
            if (b.pushT > 0.22) { b.pushT = 0; attachTo(w, H.x, H.y, H.z, H.nx, 0, H.nz, H.box, 0, 1, 0); }
          } else b.pushT = 0;
        } else b.pushT = 0;
      } else b.pushT = 0;
      if (moving) {
        const want = Math.atan2(vx, vz);
        if (!(ph === 'seek' && w === v)) b.yaw = dampAngle(b.yaw, want, 12, dt);
        P.texelDirtyAt = tSec + 0.2;
        b.stillT = 0;
      } else if (b.onGround) {
        // standing still on something thin: perch on it, tail curled round
        b.stillT += dt;
        if (b.stillT > 0.35 && b.pose === 'stand' && ru.climb && world.groundRes && stage.world.groundAt(b.x, b.z, b.r * 0.6, b.y + 0.02) === b.y && stage.world.groundRes.box && stage.world.groundRes.box.perch && w === v && ph === 'hide') {
          setPoseFor(w, 'perch'); hintOnce('perch', 'Perched! Tail curled round the rail.', 2000);
        }
      }
      b.fx = Math.sin(b.yaw); b.fy = 0; b.fz = Math.cos(b.yaw);
      b.speed = Math.hypot(vx, vz) * sp2;
      recordHist(w, b, t);
    }
    if (P.on && P.texelDirtyAt && tSec > P.texelDirtyAt) refreshTexels();
  }
  /** History for tag confirmation (the victim checks the shooter's view against its true path). */
  function recordHist(w, b, t) {
    if (!(w === me || local)) return;
    hist.t[hist.i] = t; hist.x[hist.i] = b.x; hist.y[hist.i] = b.y; hist.z[hist.i] = b.z;
    hist.i = (hist.i + 1) % hist.t.length; if (hist.n < hist.t.length) hist.n++;
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
    if (hiding) { pubSt.q = Q_ID; pubSt.at = 0; }
    else {
      bodyQuat(b, qTmp);
      // quantise, and only re-pack when it changed (keeps publish allocation-free and stable)
      const qq = packQuat(qTmp[0], qTmp[1], qTmp[2], qTmp[3]);
      pubSt.q = qq; pubSt.at = b.at ? 1 : 0;
    }
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
        // surface orientation: slerp toward it so edges and corners turn smoothly
        bodyQuat(b, qTmp); qOwn.set(qTmp[0], qTmp[1], qTmp[2], qTmp[3]);
        if (snapOrient[w]) { rt.quaternion.copy(qOwn); snapOrient[w] = false; } else rt.quaternion.slerp(qOwn, 1 - Math.exp(-16 * dt));
        if (a.pose !== b.pose) a.setPose(b.pose);
        a.st.wallN = null;
        a.st.speed = b.speed;
        a.st.lookYaw = b.lookYaw; a.st.lookPitch = b.lookPitch;
        if (ph === 'seek' && w === v && (roleOf(w) === 'seeker' || roleOf(w) === 'both') && !frozenView()) vis = false; // my own body in first person
      } else {
        let ok = link.sample(rem, t);
        if (!ok && remHint.set) { useHint(); rem.ly = 0; rem.lp = 0; rem.sp = 0; ok = true; }
        if (ok && remHint.set && rem.v === 0 && (ph === 'seek' || ph === 'lock')) useHint();
        vis = ok && rem.v > 0.5;
        if (ok) {
          rt.position.set(rem.x, rem.y, rem.z);
          // published orientation, already slerped between samples by the link buffer
          if (rem.qw != null && rem.q) { qOwn.set(rem.qx, rem.qy, rem.qz, rem.qw); rt.quaternion.slerp(qOwn, 1 - Math.exp(-30 * dt)); }
          else { rt.quaternion.setFromAxisAngle(Y_AXIS, rem.yaw); }
          const pose = POSES[Math.round(rem.po)] || 'stand';
          if (a.pose !== pose) a.setPose(pose);
          a.st.wallN = null;
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
      // blob shadow under the avatar. Stuck to a wall: none. Upside down: a faint soft blob on
      // the floor below — a fair tell for the seeker who remembers to look down AND up.
      const bl = a.blob;
      const pose = a.pose;
      const sz = a.st.size;
      upTmp[0] = 0; upTmp[1] = 1; upTmp[2] = 0;
      upTmp[1] = 1 - 2 * (rt.quaternion.x * rt.quaternion.x + rt.quaternion.z * rt.quaternion.z);
      const gy = stage.world.groundAt(rt.position.x, rt.position.z, 0.15, rt.position.y + (upTmp[1] < 0.5 ? -0.3 * sz : 0.05));
      const hgt = Math.max(0, rt.position.y - gy);
      bl.position.set(rt.position.x, gy + 0.006, rt.position.z);
      let s = (pose === 'flat' ? 0.8 : pose === 'ball' ? 0.75 : 1) * Math.max(0.5, 1 - hgt) * sz;
      let op;
      if (upTmp[1] < -0.5) { op = 0.16 * Math.max(0, 1 - hgt / 3.2); s = sz * (0.9 + hgt * 0.25); }
      else if (upTmp[1] < 0.5) op = 0;
      else op = (pose === 'flat' || pose === 'squeeze' ? 0.12 : 0.28) * Math.max(0, 1 - hgt * 1.4 / sz);
      bl.scale.set(0.62 * s, 1, 0.72 * s);
      bl.rotation.y = headingTmpYaw(rt);
      bl.material.opacity = op;
      bl.visible = vis && op > 0.01;
    }
    // glint sprites: the scan makes the eyes glint; a hider stuck to a wall or ceiling also
    // flashes its sticky toe pads (four extra sparkles), so ceilings aren't a blind spot
    const G = stage.fx.glints;
    for (let i = 0; i < G.length; i++) G[i].visible = false;
    let gi = 0;
    for (const w of ['a', 'b']) {
      const a = stage.av[w];
      if (!a.root.visible || !(t >= R.glintAt[w] && t < R.glintAt[w] + GLINT_MS)) continue;
      const k = (t - R.glintAt[w]) / GLINT_MS;
      const sz = a.st.size;
      for (let e = 0; e < 2 && gi < G.length; e++) {
        const sp = G[gi++];
        a.eyeWorld(e, sp.position);
        sp.visible = true;
        sp.scale.setScalar((0.18 + Math.sin(k * Math.PI) * 0.22) * Math.max(1, sz * 0.9));
        sp.material.rotation = k * 2;
      }
      const upY = 1 - 2 * (a.root.quaternion.x * a.root.quaternion.x + a.root.quaternion.z * a.root.quaternion.z);
      if (upY < 0.5) {
        for (let f = 0; f < 4 && gi < G.length; f++) {
          const sp = G[gi++];
          tvA.set(f < 2 ? 0.13 : -0.13, 0.02, f % 2 ? 0.14 : -0.17); a.root.localToWorld(tvA);
          sp.position.copy(tvA); sp.visible = true;
          sp.scale.setScalar((0.12 + Math.sin(k * Math.PI) * 0.16) * sz);
        }
      }
    }
    // eye-blink glints (rules): a tiny sparkle when the hider blinks, seen by the seeker only
    const bm = rules().blink;
    if (bm !== 'off' && S.match && (ph === 'seek') && gi < G.length - 1) {
      for (const w of ['a', 'b']) {
        const a = stage.av[w];
        const hiderW = mode() === 'hs' ? hiderOf(S.phase.round) : (v ? other(v) : null);
        if (w !== hiderW || w === v || !a.root.visible) continue;
        if (bm === 'strong' && a.st.blinkT > 1.6) a.st.blinkT = 1.6; // blink more often
        if (a.st.blink > 0) {
          const k = 1 - a.st.blink / 0.14;
          for (let e = 0; e < 2 && gi < G.length; e++) {
            const sp = G[gi++];
            a.eyeWorld(e, sp.position); sp.visible = true;
            sp.scale.setScalar((bm === 'strong' ? 0.2 : 0.11) * Math.sin(Math.max(0, Math.min(1, k)) * Math.PI) * Math.max(1, a.st.size));
          }
        }
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
      if (rules().heartbeat && d < 3 && tSec > (C.beatAt || 0)) { C.beatAt = tSec + 0.45 + d * 0.28; snd.play('beat'); root.classList.remove('beat'); void root.offsetWidth; root.classList.add('beat'); }
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
  const upTmp = [0, 1, 0];
  const snapOrient = { a: true, b: true };
  let Y_AXIS = null; let Z_AXIS = null;
  function useHint() { rem.x = remHint.x; rem.y = remHint.y; rem.z = remHint.z; rem.yaw = remHint.yaw; rem.po = remHint.po; rem.wa = remHint.wa; rem.v = 1; rem.q = remHint.q; rem.at = remHint.at; unpackQuat(remHint.q, qTmp); rem.qx = qTmp[0]; rem.qy = qTmp[1]; rem.qz = qTmp[2]; rem.qw = qTmp[3]; }
  /** Yaw of a root's forward vector projected on the floor. */
  function headingTmpYaw(rt) { const q = rt.quaternion; const fx = 2 * (q.x * q.z + q.w * q.y); const fz = 1 - 2 * (q.x * q.x + q.y * q.y); return Math.hypot(fx, fz) > 0.2 ? Math.atan2(fx, fz) : 0; }

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
      const sz = sizeS();
      const cx = (body.a.x + body.b.x) / 2; const cz = (body.a.z + body.b.z) / 2; const cy = (body.a.y + body.b.y) / 2 + 0.25 * sz;
      const dist = (stage.size[0] < stage.size[1] ? 2.25 : 2.0) * (0.45 + 0.55 * sz);
      camWant.set(cx + Math.sin(sw) * dist, cy + 0.75, cz + Math.cos(sw) * dist);
      revC.x = cx; revC.y = cy; revC.z = cz;
      aimFramed(revC, true);
      rate = 3;
    } else if ((S.pendingTitle && ph !== 'hide') || (ph === 'final' && !R.rec)) {
      C.orbit += dt * 0.12;
      const ov = stage.map.overview; const rad = ov.radius;
      camWant.set(Math.sin(C.orbit) * rad, ov.y, Math.cos(C.orbit) * rad);
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
      const sz = stage.av[tw].st.size;
      const k2 = 0.5 + 0.5 * sz;
      const dist = (ph === 'recap' || ph === 'final' ? 2.2 : 1.55) * k2;
      // a ceiling hider is framed from below
      const upY = 1 - 2 * (stage.av[tw].root.quaternion.x ** 2 + stage.av[tw].root.quaternion.z ** 2);
      const dy = upY < -0.5 ? -Math.min(cen.y - 0.25, 0.9 * k2) : (ph === 'recap' ? 0.95 : 0.55) * k2;
      camWant.set(cen.x + Math.sin(ang) * dist, cen.y + dy, cen.z + Math.cos(ang) * dist);
      clampCam(cen, camWant);
      aimFramed(cen, ph === 'recap' || ph === 'final');
      rate = tSec < C.freezeUntil ? 0 : (ph === 'found' || ph === 'time') ? 8 : 3;
    } else if (P.on && v) {
      const b = body[v];
      bodyCentre(v, lookWant);
      const cp = Math.cos(C.paintPitch); const pd = C.paintDist * (0.5 + 0.5 * b.s);
      camWant.set(lookWant.x + Math.sin(C.paintYaw) * cp * pd, lookWant.y + Math.sin(C.paintPitch) * pd, lookWant.z + Math.cos(C.paintYaw) * cp * pd);
      floorCam(camWant);
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
        const eh = (EYE_H[b.pose] || 0.46) * b.s;
        const yaw = b.yaw + b.lookYaw;
        camWant.set(b.x + Math.sin(yaw) * 0.12 * b.s, b.y + eh, b.z + Math.cos(yaw) * 0.12 * b.s);
        lookWant.set(camWant.x + Math.sin(yaw) * Math.cos(b.lookPitch), camWant.y + Math.sin(b.lookPitch), camWant.z + Math.cos(yaw) * Math.cos(b.lookPitch));
        // the paint popper only fits on landscape screens (portrait has the Fire button there)
        stage.vm.visible = stage.size[0] > stage.size[1] * 1.1;
        stage.vm.position.set(0.2, -0.16 + Math.sin(tSec * 8) * 0.004 * Math.min(1, b.speed), -0.42 + C.shake * 0.3);
      }
      snap = true;
    } else if (v && (ph === 'hide' || ph === 'lock')) {
      const b = body[v];
      bodyCentre(v, lookWant);
      lookWant.y += (b.at ? 0.05 : 0.14) * b.s;
      // under a ceiling the camera eases below the body (world-up always: no rolling horizon)
      if (C.autoUntil > tSec) C.pitch += (C.autoPitch - C.pitch) * (1 - Math.exp(-5 * dt));
      else if (!b.at && C.pitch < 0.05) C.pitch += (0.32 - C.pitch) * (1 - Math.exp(-2.5 * dt));
      const dist = C.dist * (0.55 + 0.45 * b.s);
      const cp = Math.cos(C.pitch);
      camWant.set(lookWant.x + Math.sin(C.yaw) * cp * dist, lookWant.y + Math.sin(C.pitch) * dist, lookWant.z + Math.cos(C.yaw) * cp * dist);
      clampCam(lookWant, camWant);
      floorCam(camWant);
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
  /** Centre of a body (what cameras look at): contact point + half a body along the normal. */
  function bodyCentre(w, out) {
    const b = body[w]; const s2 = b.s;
    if (b.at) { const off = b.pose === 'hang' ? 0.45 : 0.18; out.set(b.x + b.nx * off * s2, b.y + b.ny * off * s2, b.z + b.nz * off * s2); }
    else out.set(b.x, b.y + (b.sq ? 0.08 : 0.28) * s2, b.z);
    return out;
  }
  /** Never put the camera under the floor it's above. */
  function floorCam(want) {
    const g = stage.world.groundAt(want.x, want.z, 0.05, want.y + 0.05, 0.05);
    if (want.y < g + 0.1) want.y = g + 0.1;
  }
  /** Pull the camera in front of walls between the target and it. */
  function clampCam(target, want) {
    const dx = want.x - target.x; const dy = want.y - target.y; const dz = want.z - target.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const h = stage.world.raycast(target.x, target.y, target.z, dx / d, dy / d, dz / d, d, (b) => b.maxY - b.minY > 0.5 || b.minY > 0.6);
    if (h && h.t < d) { const k = Math.max(0.25, h.t - 0.18) / d; want.x = target.x + dx * k; want.y = target.y + dy * k; want.z = target.z + dz * k; }
  }

  // ── HUD per frame (allocation-free: stable descriptors, precomputed labels) ──
  const showParts = { top: false, sub: false, gear: false, cross: false, poses: false, tools: false, acts: false, joyhint: false, legend: false, mini: false };
  const FIRE_L = Array.from({ length: 11 }, (_, i) => `Fire ${i}`);
  const SCURRY_L = ['Scurry', 'Scurry', 'Scurry 2', 'Scurry 3'];
  const SCAN_L = Array.from({ length: 31 }, (_, i) => (i ? `${i}s` : 'Scan'));
  const PHASE_L = { hide: 'Hide', lock: 'Get ready', seek: 'Seek', found: 'Found', time: 'Time', recap: 'Recap', curtain: 'Pass', final: '', lobby: '' };
  const ROLE_L = { youHide: 'You hide', youSeek: 'You seek', hunt: 'Hunt!', hideBoth: 'Hide!', hides: { a: `${api.name('a')} hides`, b: `${api.name('b')} hides` }, seeks: { a: `${api.name('a')} seeks`, b: `${api.name('b')} seeks` } };
  const LEGEND = {
    hide: ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Mouse</kbd> look', '<kbd>E</kbd> stick · <kbd>Z</kbd> tongue-zip · <kbd>Space</kbd> jump', '<kbd>1</kbd>–<kbd>9</kbd> pose · <kbd>P</kbd> paint · <kbd>R</kbd> hidden'],
    hideFloor: ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Mouse</kbd> look', '<kbd>Space</kbd> jump · <kbd>1</kbd>–<kbd>5</kbd> pose', '<kbd>P</kbd> paint · <kbd>R</kbd> hidden'],
    seek: ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Mouse</kbd> look', '<kbd>Click</kbd> fire · <kbd>Q</kbd> scan · <kbd>Shift</kbd> sprint', '<kbd>Esc</kbd> free the mouse · look up!'],
    peek: ['<kbd>Mouse</kbd> look around', '<kbd>F</kbd> scurry · <kbd>Z</kbd> zip · <kbd>1</kbd>–<kbd>9</kbd> pose'],
    paint: ['<kbd>B</kbd> brush · <kbd>G</kbd> fill · <kbd>E</kbd> pick', '<kbd>T</kbd> stamp · <kbd>Z</kbd> undo · <kbd>P</kbd> done'],
  };
  function mkActs(mouse) {
    const k = (x) => (mouse ? x : '');
    const poses = { act: 'poses', icon: 'pose', label: 'Pose', key: k('1-9') };
    const ready2 = { act: 'ready', icon: 'ready', label: 'Hidden', hl: true, key: k('R') };
    const jump = { act: 'jump', icon: 'jump', label: 'Jump', key: k('␣') };
    const paint = { act: 'paint', icon: 'paint', label: 'Paint', big: true, prime: true, key: k('P') };
    const stick2 = { act: 'stick', icon: 'stick', label: 'Stick', on: false, key: k('E') };
    const zip2 = { act: 'zip', icon: 'zip', label: 'Zip', cdRing: true, cd: 0, disabled: false, key: k('Z') };
    const scan2 = { act: 'scan', icon: 'scan', label: 'Scan', cdRing: true, cd: 0, disabled: false, key: k('Q') };
    const fire2 = { act: 'fire', icon: 'fire', label: 'Fire', big: true, prime: true, disabled: false, key: k('Click') };
    const sprint2 = { act: 'sprint', icon: 'sprint', label: 'Sprint', on: false, key: k('⇧') };
    const scurry2 = { act: 'scurry', icon: 'scurry', label: 'Scurry', hl: true, big: true, disabled: false, key: k('F') };
    const pzip = { act: 'zip', icon: 'zip', label: 'Zip', cdRing: true, cd: 0, disabled: false, key: k('Z') };
    return {
      scan: scan2, fire: fire2, scurry: scurry2, stick: stick2, zip: zip2, pzip, sprint: sprint2,
      hide: [stick2, zip2, poses, ready2, jump, paint], hideFloor: [poses, ready2, jump, paint],
      seek: [scan2, sprint2, jump, fire2], both: [poses, scan2, fire2], peek: [poses, pzip, scurry2], peekFloor: [poses, scurry2], none: [],
    };
  }
  const ACTS = { m: mkActs(true), t: mkActs(false) };
  // pose bars per situation (stable arrays: the HUD rebuilds only when the situation changes)
  const PZ = (p, label, icon) => ({ p, label, icon: icon || p });
  const PB = {
    free: [PZ('stand', 'Stand'), PZ('crouch', 'Crouch'), PZ('ball', 'Ball'), PZ('flat', 'Low'), PZ('squeeze', 'Squeeze')],
    freeWall: [PZ('stand', 'Stand'), PZ('crouch', 'Crouch'), PZ('ball', 'Ball'), PZ('squeeze', 'Squeeze'), PZ('wall', 'Wall')],
    freePerch: [PZ('stand', 'Stand'), PZ('crouch', 'Crouch'), PZ('ball', 'Ball'), PZ('squeeze', 'Squeeze'), PZ('perch', 'Perch')],
    wall: [PZ('stand', 'Crawl', 'crawl'), PZ('wall', 'Flat'), PZ('ball', 'Ball')],
    wallCorner: [PZ('stand', 'Crawl', 'crawl'), PZ('wall', 'Flat'), PZ('corner', 'Corner'), PZ('ball', 'Ball')],
    ceil: [PZ('stand', 'Crawl', 'crawl'), PZ('wall', 'Flat'), PZ('hang', 'Hang'), PZ('ball', 'Ball')],
    perchAt: [PZ('stand', 'Crawl', 'crawl'), PZ('wall', 'Flat'), PZ('perch', 'Perch'), PZ('ball', 'Ball')],
    top: [PZ('stand', 'Crawl', 'crawl'), PZ('wall', 'Flat'), PZ('ball', 'Ball')],
  };
  const PB_FLOOR = { free: [PZ('stand', 'Stand'), PZ('crouch', 'Crouch'), PZ('wall', 'Wall'), PZ('ball', 'Ball'), PZ('flat', 'Low')] };
  let pbNext = 0; let pbCur = PB.free;
  function poseBar(v) {
    if (!rules().climb) { const b = body[v]; return b.at ? PB.wall : PB_FLOOR.free; }
    if (tSec < pbNext) return pbCur;
    pbNext = tSec + 0.2;
    const b = body[v];
    if (b.at) {
      if (b.ny < -0.7) pbCur = PB.ceil;
      else if (b.box && b.box.perch) pbCur = PB.perchAt;
      else if (b.ny > 0.7) pbCur = PB.top;
      else pbCur = poseOk(v, 'corner') ? PB.wallCorner : PB.wall;
    } else if (poseOk(v, 'perch')) pbCur = PB.freePerch;
    else pbCur = stage.world.nearestWall(b.x, b.y, b.z, 0.5 + b.r) ? PB.freeWall : PB.free;
    return pbCur;
  }
  const U = { meB: null, mouse: null, tick: -1, blind: null, tips: false };
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
    showParts.mini = inGame && ph === 'seek' && (role === 'seeker' || role === 'both') && rules().minimap && !!stage.map.big;
    // action buttons
    const AS = mouse ? ACTS.m : ACTS.t;
    let list = AS.none;
    if (inGame && !fz && !P.on) {
      const climb = rules().climb;
      if (ph === 'hide' && (role === 'hider' || role === 'both')) {
        list = climb ? AS.hide : AS.hideFloor;
        const b = body[v];
        AS.stick.on = b.at; AS.stick.label = b.at ? 'Let go' : 'Stick'; AS.stick.icon = b.at ? 'unstick' : 'stick';
        const zl = Math.max(0, R.zipReady[v] - t);
        AS.zip.cd = clamp(zl / ZIP.cdHide, 0, 1); AS.zip.disabled = zl > 0 || !!b.zip;
      } else if (ph === 'seek' && (role === 'seeker' || role === 'both')) {
        list = role === 'both' ? AS.both : AS.seek;
        const left = Math.max(0, R.scanReady[v] - t);
        const none = R.scansLeft[v] <= 0;
        AS.scan.cd = none ? 1 : clamp(left / scanCdMs(), 0, 1); AS.scan.disabled = left > 0 || none; AS.scan.label = none ? 'No scans' : SCAN_L[Math.min(30, Math.ceil(left / 1000))];
        AS.fire.label = FIRE_L[Math.min(10, R.pellets[v])]; AS.fire.disabled = R.pellets[v] <= 0;
        AS.sprint.on = R.sprint || controls.st.sprintHeld;
      } else if (ph === 'seek' && role === 'hider' && !local) {
        list = climb ? AS.peek : AS.peekFloor;
        const out = R.escapes[v] <= 0;
        AS.scurry.label = out ? (R.scurried[v] ? 'Used' : 'None') : (R.escapes[v] > 1 ? SCURRY_L[Math.min(3, R.escapes[v])] : 'Scurry'); AS.scurry.hl = !out; AS.scurry.disabled = out;
        const zl = Math.max(0, R.zipReady[v] - t);
        AS.pzip.disabled = out || zl > 0 || !!body[v].zip; AS.pzip.cd = out ? 1 : clamp(zl / ZIP.cdSeek, 0, 1);
      }
    }
    showParts.acts = list.length > 0;
    const a3 = list.length > 4;
    if (U.acts3 !== a3) { U.acts3 = a3; root.classList.toggle('acts3', a3); }
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
    if (showParts.poses && v) { hud.poseList(poseBar(v)); hud.poseOn(body[v].pose); }
    if (showParts.mini && v) { const b = body[v]; hud.miniDraw(b.x, b.z, b.yaw + b.lookYaw, v === 'a' ? theme.a : theme.b); }
    hud.tips(U.tips && inGame && ph === 'hide' && !P.on ? (U.tipsHtml || (U.tipsHtml = tipsHtml(mouse))) : null);
    if (showParts.tools && v) { hud.tool(P.tool, P.size, P.hard, P.rgb); hud.undoEnabled(stage.paints[v].canUndo); hud.stampEnabled(rules().stamp); }
    if (showParts.legend) hud.legend(P.on ? LEGEND.paint : ph === 'hide' ? (rules().climb ? LEGEND.hide : LEGEND.hideFloor) : ph === 'seek' && role !== 'hider' ? LEGEND.seek : LEGEND.peek);
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
    else if (ph === 'lobby') { kind = 'lobby'; a = S.setupVer; b = `${isHost}${S.sheet}`; }
    else if (S.pendingTitle && t < S.pendingTitle.at) { kind = 'title'; a = S.pendingTitle.seq; }
    else if (ph === 'curtain') { kind = seekCountdown(t) >= 0 ? 'count' : 'curtain'; a = S.phase.seq; }
    else if (!local && isBlind()) { kind = ph === 'lock' ? 'lock' : 'blind'; a = S.phase.seq; }
    else if (ph === 'seek' && t < S.phase.at + 900 && t >= S.phase.at - 50) { kind = 'go'; a = S.phase.seq; }
    else if (ph === 'found' || ph === 'time') { kind = 'stamp'; a = S.phase.seq; }
    else if (ph === 'recap' && R.rec) { kind = 'recap'; a = S.phase.seq; }
    else if (ph === 'lock' && v && roleOf(v) !== 'seeker') { kind = 'locking'; a = S.phase.seq; }
    if (kind === LY.kind && a === LY.a && b === LY.b) return;
    // keep the settings sheet's scroll position across live rebuilds
    const sc = root.querySelector('.chm-sheet'); const keep = sc ? sc.scrollTop : 0;
    LY.kind = kind; LY.a = a; LY.b = b;
    hud.layer(`${kind}-${++LY.n}`, buildLayer(kind, t, v, role));
    if (keep) { const sc2 = root.querySelector('.chm-sheet'); if (sc2) sc2.scrollTop = keep; }
    live.blind = root.querySelector('[data-live="blind-time"]'); live.blindS = -1;
    live.resume = root.querySelector('[data-live="resume-count"]'); live.resumeS = -1;
    live.seek = root.querySelector('[data-live="seek-count"]'); live.seekS = -1;
  }
  function buildLayer(kind, t, v, role) {
    const m = S.match;
    switch (kind) {
      case 'ctx': return ctxCard();
      case 'pause': return pauseCard(api, { reason: S.paused ? S.paused.reason : 'resume', countdown: !S.paused });
      case 'lobby': return lobbyCard(api, { canEdit: isHost, local, setup: S.setup, waitingFor: 'a', sheet: S.sheet });
      case 'title': {
        const p = S.pendingTitle; const hd = m && m.mode === 'hs' ? hiderOfRound(p.round) : null;
        return titleCard(api, { round: p.round, rounds: m ? m.rounds : 4, mode: m ? m.mode : 'hs', hider: hd, youHide: !local && hd === me, youSeek: !local && hd && hd !== me, map: m ? m.map : S.setup.map });
      }
      case 'count': { const d = S.phase.data || {}; return `<div class="chm-over solid"><div class="chm-card chm-sticker"><div class="chm-kicker">${esc(api.name(d.who))}, get ready</div><div class="chm-big" data-live="seek-count">3</div><p>Find them before the timer runs out.</p></div></div>`; }
      case 'curtain': { const d = S.phase.data || {}; return curtainCard(api, { kind: d.kind, who: d.who }); }
      case 'lock': return blindLock();
      case 'blind': return blindCard(api, { hider: hiderOf(S.phase.round), ms: Math.max(0, S.phase.end - t), pellets: R.maxPellets, mode: mode(), scanCd: rules().scanCd, scans: rules().scans });
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
  function drawnOf(w) {
    const r = stage.av[w].root; const q = r.quaternion;
    return { p: [r.position.x, r.position.y, r.position.z], up: [2 * (q.x * q.y - q.w * q.z), 1 - 2 * (q.x * q.x + q.z * q.z), 2 * (q.y * q.z + q.w * q.x)], fwd: [2 * (q.x * q.z + q.w * q.y), 2 * (q.y * q.z - q.w * q.x), 1 - 2 * (q.x * q.x + q.y * q.y)], scale: r.scale.x, pose: stage.av[w].pose, visible: r.visible };
  }
  if (testing) {
    const hook = {
      get ready() { return S.boot === 'ready'; },
      state() {
        const v = viewer();
        return {
          boot: S.boot, local, isHost, me, viewer: v, actor: S.actor,
          phase: { ...S.phase, data: S.phase.data }, match: S.match, setup: S.setup, paused: S.paused, resumeAt: S.resumeAt, now: now(),
          round: { pellets: R.pellets, used: R.used, scurried: R.scurried, escapes: R.escapes, scansLeft: { a: Number.isFinite(R.scansLeft.a) ? R.scansLeft.a : -1, b: Number.isFinite(R.scansLeft.b) ? R.scansLeft.b : -1 }, paintOk: R.paintOk, paintSum: R.paintSum, closest: R.closest, passes: R.passes, rec: R.rec, spawn: R.spawn },
          bodies: { a: { ...body.a, box: null, zip: !!body.a.zip }, b: { ...body.b, box: null, zip: !!body.b.zip } },
          rules: rules(), sheet: S.sheet, tips: !!U.tips,
          /** what each avatar looks like on THIS device: position, up vector, forward, scale */
          drawn: stage ? { a: drawnOf('a'), b: drawnOf('b') } : null,
          rem: { x: rem.x, y: rem.y, z: rem.z, q: rem.q, at: rem.at, po: rem.po },
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
      teleport(x, z, yaw, y) { const v = viewer(); const b = body[v]; b.x = x; b.z = z; if (yaw != null) b.yaw = yaw; resetBody(b); b.sq = false; b.y = y != null ? y : stage.world.groundAt(x, z, 0.2, 3); b.vy = 0; if (b.pose !== 'stand' && b.pose !== 'crouch') setPoseFor(v, 'stand'); snapOrient[v] = true; return { ...b, box: null }; },
      /** Sticky feet through the same code paths as the buttons. */
      stick() { action('stick'); const b = body[viewer()]; return { at: b.at, n: [b.nx, b.ny, b.nz], f: [b.fx, b.fy, b.fz], p: [b.x, b.y, b.z] }; },
      zip() { return zip(); },
      body(w) { const b = body[w || viewer()]; return { ...b, box: b.box ? { minX: b.box.minX, maxX: b.box.maxX, minY: b.box.minY, maxY: b.box.maxY, minZ: b.box.minZ, maxZ: b.box.maxZ, name: b.box.name } : null, zip: !!b.zip }; },
      /** Crawl with a world velocity for n steps of dt (deterministic; no camera mapping). */
      crawl(vx, vy, vz, n = 30, dt = 1 / 30) { const v = viewer(); const b = body[v]; const out = []; for (let i = 0; i < n && b.at; i++) out.push(crawlStep(stage.world, b, vx, vy, vz, dt)); return { res: out, at: b.at, n: [b.nx, b.ny, b.nz], p: [b.x, b.y, b.z] }; },
      surfaceAt(x, y, z, dx, dy, dz, far = 6) { const H = stage.world.raycast(x, y, z, dx, dy, dz, far, null, true); return H ? { p: [H.x, H.y, H.z], n: [H.nx, H.ny, H.nz], t: H.t, box: H.box ? { minX: H.box.minX, maxX: H.box.maxX, minY: H.box.minY, maxY: H.box.maxY, minZ: H.box.minZ, maxZ: H.box.maxZ, ceil: !!H.box.ceil, perch: !!H.box.perch } : null } : null; },
      /** Attach at an exact face (tests). */
      attachAt(x, y, z, nx, ny, nz, hx = 0, hy = 1, hz = 0) { const v = viewer(); attachTo(v, x, y, z, nx, ny, nz, null, hx, hy, hz); snapOrient[v] = true; return true; },
      setRules(o) { if (!isHost || S.match) return false; S.setup = sanitizeSetup({ ...S.setup, ...o, rules: { ...S.setup.rules, ...(o.rules || {}) } }, MAP_IDS, S.setup.first); S.setupVer++; loadMap(S.setup.map); applySize(); placeLobby(); stage.compile(); if (!local) link.send('setup', S.setup); return S.setup; },
      sizes() { return { a: { r: body.a.r, step: body.a.step, head: body.a.head, s: body.a.s, scale: stage.av.a.root.scale.x }, b: { r: body.b.r, step: body.b.step, head: body.b.head, s: body.b.s, scale: stage.av.b.root.scale.x }, tagTol: TAG_TOL * Math.max(1, sizeS()) }; },
      worldStats() { return { ...stage.world.stats, boxes: stage.world.boxes.length, chunks: stage.map.chunks.length, tris: stage.map.triCount, verts: stage.map.vertexCount, big: !!stage.map.big, area: stage.map.area, atlasUsed: stage.map.atlas.used, atlasH: stage.map.atlas.height }; },
      lookAtPitch(p) { const b = body[viewer()]; b.lookPitch = p; },
      mapIds() { return MAP_IDS.slice(); },
      /** Tests: change the size mid-round on this device only. */
      forceSize(id) { const tgt = S.match ? S.match : S.setup; tgt.rules = sanitizeRules({ ...tgt.rules, size: id }); applySize(); return sizeS(); },
      /** Free-walk with a world velocity for n steps (deterministic; same physics as the stick). */
      walk(vx, vz, n = 30, dt = 1 / 30) { const b = body[viewer()]; const sp = b.sq ? SPEED.squeeze : 1; for (let i = 0; i < n; i++) freeStep(stage.world, b, vx * sp, vz * sp, dt, false); return { x: b.x, y: b.y, z: b.z, sq: b.sq, r: b.r }; },
      mapsInfo() { return MAPS.map((m) => ({ id: m.id, name: m.name, area: mapArea(m), size: m.size, rooms: m.rooms, climbs: m.climbs })); },
      setPose(p) { setPose(p); return body[viewer()].pose; },
      /** Point the first-person view at a world point (seeker aim). */
      aimAt(x, y, z) {
        const v = viewer(); const b = body[v];
        const eh = (EYE_H[b.pose] || 0.46) * b.s;
        let ex = b.x; let ey = b.y + eh; let ez = b.z;
        for (let i = 0; i < 3; i++) {
          const yaw = Math.atan2(x - ex, z - ez);
          b.yaw = yaw; b.lookYaw = 0;
          ex = b.x + Math.sin(yaw) * 0.12 * b.s; ez = b.z + Math.cos(yaw) * 0.12 * b.s;
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
      setCam(yaw, pitch, dist) { if (yaw != null) C.yaw = yaw; if (pitch != null) C.pitch = pitch; if (dist != null) C.dist = dist; C.autoUntil = 0; },
      /** Map sanity: spawns clear of props, a wall at the camo spot, probe albedos. */
      checkMap(id) {
        stage.loadMap(id);
        const w = stage.world; const out = { id, spawns: {}, spawnsHuge: {}, camoWall: null, probes: [] };
        const spots = stage.map.spots;
        const list = [['lobby', spots.lobby], ['spawnA', spots.spawnA], ['spawnB', spots.spawnB]];
        spots.hiderSpawns.forEach((p, i) => list.push([`hider${i}`, p])); spots.seekerSpawns.forEach((p, i) => list.push([`seeker${i}`, p]));
        for (const [k, sp] of list) {
          for (const [key, s2] of [['spawns', 1], ['spawnsHuge', 1.8]]) {
            const b = { x: sp.x, y: 0, z: sp.z, r: 0.24 * s2, step: Math.max(0.2, 0.24 * s2), head: 0.34 * s2 };
            b.y = w.groundAt(b.x, b.z, 0.2, (sp.y || 0) + 0.5); w.pushOut(b);
            out[key][k] = Math.hypot(b.x - sp.x, b.z - sp.z);
          }
        }
        const c = stage.map.spots.camo; const wall = c ? w.nearestWall(c.x, c.y, c.z - 0.1, 0.75) : null;
        out.camoWall = wall ? [wall.nx, wall.nz] : null;
        for (const p of stage.map.probes) {
          const [x, y, z] = p.point; const [nx, ny, nz] = p.normal;
          stage.ray.set(new THREE.Vector3(x + nx * 0.3, y + ny * 0.3, z + nz * 0.3), new THREE.Vector3(-nx, -ny, -nz));
          const hit = stage.pickMap(1); const rgb = [0, 0, 0]; if (hit) stage.albedoAtHit(hit, rgb);
          out.probes.push({ name: p.name, want: p.hex.toLowerCase(), got: '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('') });
        }
        out.drawCalls = stage.renderer.info.render.calls; out.verts = stage.map.vertexCount; out.colliders = stage.map.colliders.length; out.chunks = stage.map.chunks.length; out.tris = stage.map.triCount; out.atlasUsed = stage.map.atlas.used; out.atlasH = stage.map.atlas.height;
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
        if (o.hideMap != null) for (const m of stage.mapMeshes) m.visible = !o.hideMap;
        if (o.fog != null) stage.scene.fog.far = o.fog ? 30 : 1e6;
        if (o.hull != null) for (const ch of stage.map.chunks) ch.geometry.setDrawRange(0, o.hull ? Infinity : ch.mainIndexCount);
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
