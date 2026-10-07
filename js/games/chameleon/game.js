// Blend & Seek — game controller: boot, phases (host director), network handlers, input,
// painting, cameras, per-frame update and the test hook.
import { createLink, FIELDS, Q_ID } from './link.js';
import { createSound } from './sound.js';
import { createStage } from './stage.js';
import { createHud } from './hud.js';
import { createControls } from './controls.js';
import { POSES, REGION_OF_PART, REGION_NAMES, REGIONS } from './avatar.js';
import { loadingCard, errorCard, lobbyCard, titleCard, blindCard, headCard, curtainCard, recapCard, pauseCard, ctxCard, tipsHtml, finalCard, EMOTES, CALLS } from './cards.js';
import { recordRound, recordMatch, bestsStrip, recapLines, matchStory } from './records.js';
import { loadWear, saveWear, resolveWear, newUnlocks, packWear, unpackWear, wardrobeSheet, EYE_RGB, SLOT_LABEL } from './wardrobe.js';
import { clamp, dampAngle, wrapAngle, hexToRgb, cssColor, luminance, listeners, fmtTime, mixHex, esc, seeded, packQuat, unpackQuat } from './util.js';
import { MAPS, mapArea } from './maps.js';
import { sanitizeSetup, sanitizeRules, applyPreset, stepRule, setRule, loadSaved, saveSetup, sizeScale, SPEED_MUL, CLIMB_MUL, tipsSeen, markTipsSeen, PRESETS, timeScale, hideScale, effSeconds, sprintMul, dbSpeed, OPTIONS, fmtRule } from './rules.js';
import { REVEAL } from './paint.js';
import { createBlendJob, startBlend, stepBlend, scoreBlend, createMeter } from './camo.js';
import { mkBody, sizeBody, resetBody, headingYaw, attachBody, detachBody, freeStep, crawlStep, inputOnSurface, bodyQuat, quatUpY, spotKind, surfaceKind, accelStep, coyoteJump, shortHop, JUMP } from './move.js';
import { SQUEEZE_R } from './world.js';

const DUR0 = { title: 1800, title2: 900, final: 12000, hide: 60000, lockMax: 7000, seekLead: 1600, seek: 90000, found: 3400, recap: 6500, resume: 3000, lead: 380, foundLead: 260 };
const GLINT_MS = 400;
const BONUS = 30;
const SPEED = { hide: 3.0, seek: 3.3, scurry: 6.2, crawl: 0.78, squeeze: 0.35, sprint: 1.55 };
const PLAYERS = ['a', 'b'];
const BRUSH = [0.035, 0.065, 0.11];
const DAB_CAP = [12, 9, 6]; // dabs per pointer move by brush size (an L dab already covers ~3 S dabs)
const EYE_H = { stand: 0.46, crouch: 0.36, ball: 0.3, flat: 0.2, wall: 0.4, hang: 0.3, perch: 0.46, squeeze: 0.12, corner: 0.3 };
const TAG_TOL = 0.75;
const ZIP = { range: 4.6, dur: 0.42, cdHide: 1100, cdSeek: 4000, cdSeeker: 2500 };
// fresh paint while hunted ('Shows'): glints for a seeker within this range (× size) with a clear line of sight
const TELL = { range: 6, secs: 1.1, minGap: 1000 };
const FREECAM = { speed: 4.2, fast: 2.2 };
const MAP_IDS = MAPS.map((m) => m.id);
const TAG_WINDOW = 250;
// a hider mid-scurry / mid-zip is confirmed against a much shorter window (see confirmTag)
const TAG_WINDOW_ESCAPE = 120;
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
    // who hides first alternates with the hub's rematch counter (the same person used to hide first match after match)
    setup: sanitizeSetup({ ...(loadSaved() || {}), first: (api.gen | 0) % 2 ? 'b' : 'a' }, MAP_IDS),
    sheet: false, // settings sheet open (local view state)
    wardrobe: false, // wardrobe sheet open (local view state)
    wardW: null, // whose wardrobe (hotseat: a toggle)
    dataVer: 0, // bumps when the shared data (records, unlocks), a wardrobe pick or the music setting changes
    callVer: 0, // bumps when a wager chip is picked (the blind / curtain card re-renders)
    matchRecords: [], matchUnlocks: [], // what this match earned, for the final card
    finalRec: false,
    vote: { a: null, b: null }, voteVer: 0, crowned: 0, finalHold: 0, // the final card's 'Best hide tonight?' vote
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
      paintSum: { a: 0, b: 0 }, paintOk: { a: false, b: false }, blend: { a: -1, b: -1 }, glintAt: { a: -1e9, b: -1e9 }, trailUntil: { a: 0, b: 0 }, trailNext: 0,
      pendingTag: 0, foundSent: false, out: { a: false, b: false }, outSent: false, tagWindow: null,
      path: [], pathNext: 0, closest: Infinity, passes: 0, near: false, seekStart: 0, used: { a: 0, b: 0 }, lockSent: false, rec: null,
      scurry: null, escapeAt: 0, endingHide: false, lockDone: false, toRecap: false, nexting: false, jumpReq: false, jumpAt: -1e9, lastTick: 0, lastTrailT: 0, spawn: null, sprint: false,
      // v3: hunt start seen, live paint while hunted (sender: version + time sent; receiver: tells)
      huntSeen: false, lpVer: -1, lpAt: 0, lpSent: 0, lpSame: 0, lpIn: 0, tell: null, tells: 0, tellSkip: 0, tellAt: -1e9,
      // polish: brush strokes per hider, 'in their sights' stares, the seeker's wager, the hide-phase ticker, emotes, stamps, 3-D nearness
      strokes: { a: 0, b: 0 }, stared: 0, stareAt: -1e9, call: { a: null, b: null }, under: false, losNext: 0, nearD: 99,
      actQ: null, actAt: 0, actMoveAt: 0, actStill: false, ticker: '', emoteAt: 0, emoteN: 0, halfShown: false,
    };
  }

  // ── shared records + wardrobe (records.js / wardrobe.js) + this phone's music setting ──
  const data = () => (typeof api.data === 'function' ? api.data() : {});
  const setData = (patch) => { if (patch && Object.keys(patch).length && typeof api.setData === 'function') api.setData(patch); };
  const wearPicks = loadWear(); // this device's picks per person { a: {…}, b: {…} }
  if (!wearPicks.a || !wearPicks.b) { const flat = { eye: wearPicks.eye | 0, shape: wearPicks.shape | 0, charm: wearPicks.charm | 0, twitch: wearPicks.twitch | 0 }; wearPicks.a = wearPicks.a || flat; wearPicks.b = wearPicks.b || { ...flat }; }
  const wornRemote = { a: null, b: null }; // the partner's worn set as sent (packed int)
  const MUSIC_KEY = 'chm.music.v1';
  let music = 'on';
  try { const mv = localStorage.getItem(MUSIC_KEY); if (mv === 'on' || mv === 'hunt' || mv === 'off') music = mv; } catch { /* ignore */ }
  const offData = typeof api.onData === 'function' ? api.onData(() => { S.dataVer++; applyWear(); }) : null;
  const wardrobeFor = () => S.wardW || me || 'a';
  /** Dress both chameleons: my picks (kept only where earned), the partner's as sent (guarded the same way). */
  function applyWear() {
    if (!stage) return;
    const d = data();
    for (const w of ['a', 'b']) {
      const picks = controlsOf(w) ? wearPicks[w] : (wornRemote[w] != null ? unpackWear(wornRemote[w]) : null);
      if (!picks) continue;
      const wr = resolveWear(d, w, picks);
      stage.av[w].setWardrobe(wr, EYE_RGB[wr.eye] || null);
    }
  }
  function sendWear() { if (local || !link.ready || !me) return; link.send('wear', { w: me, wr: packWear(resolveWear(data(), me, wearPicks[me])) }); }

  // physics bodies for locally controlled players (see move.js)
  const body = { a: mkBody(), b: mkBody() };
  const rem = {}; for (const f of FIELDS) rem[f] = 0;
  const remT = {}; for (const f of FIELDS) remT[f] = 0;
  const hist = { t: new Float64Array(96), x: new Float32Array(96), y: new Float32Array(96), z: new Float32Array(96), n: 0, i: 0 };

  // view/camera state
  const C = { cardCheck: 0, frameY: 0, frameCard: false, oy: 0, orbitBase: 0, orbitT: 0, yaw: Math.PI, pitch: 0.32, dist: 2.3, paintYaw: 0, paintPitch: 0.3, paintDist: 1.25, fpYaw: 0, fpPitch: 0, orbit: 0, whip: 0, freezeUntil: 0, shake: 0, vsAt: -10, vsPend: false, vsStep: 0, vsOx: 0, vsOy: 0, vsOz: 0, vsLx: 0, vsLy: 0, vsLz: 0,
    // v3: the hider's view while hunted ('eyes' | 'watch' | 'free') + the free cam; the seeker's climb view (absolute view yaw)
    spect: 'eyes', fcX: 0, fcY: 0, fcZ: 0, fcYaw: 0, fcPitch: 0, fcTop: 3, fcBottom: 0.12, climbV: false, climbNear: false, vYaw: 0,
    // the third-person look target eases for 0.4 s after a stick / let-go (no 0.3 m dip at the attach)
    lkX: 0, lkY: 0, lkZ: 0, lkAt: false, lkUntil: 0 };
  // the free cam flies through furniture but never into a wall or ceiling slab (the map's are listed at load)
  const FC_WALL = (b) => b.wall === true && (b.ceil || b.maxY - b.minY > 1.2);
  const fcBoxes = [];
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
  const curMapEntry = () => MAPS.find((m) => m.id === (S.match ? S.match.map : S.setup.map)) || MAPS[0];
  const mapTime = () => timeScale(curMapEntry());
  const mapHideTime = () => hideScale(curMapEntry());
  /** Hide clock (0 = untimed: the hunt starts when the hider taps Ready). */
  const hideMs = () => (rules().hideEnd === 'ready' ? 0 : TUNE.hide || effSeconds(rules().hide, mapHideTime()) * 1000);
  const seekMs = () => TUNE.seek || effSeconds(rules().seek, mapTime()) * 1000;
  /** The hider's head start (seeker blindfolded, hider still free to move): Hide & Seek only, scales with the map. */
  const headStartMs = () => (mode() === 'hs' ? effSeconds(rules().headStart, mapHideTime()) * 1000 : 0);
  /** 3-2-1 before the hunt (tests shorten it with __chamTune.seekLead unless they ask for the real one). */
  const countdownMs = () => (TUNE.seekLead != null && !TUNE.realCountdown ? TUNE.seekLead : rules().countdown * 1000);
  const graceMs = () => rules().grace * 1000;
  /** Seek phase data: the hunt itself is the last `hunt` ms of the phase; any head start comes first. */
  const seekArgs = (ss) => { const blind = headStartMs(); const hunt = seekMs(); return { dur: blind + hunt, data: { ss, blind, hunt } }; };
  /** The seeker climbs too (sticky feet, zip, poses): Hide & Seek with climbing on. */
  const seekerClimbs = () => mode() === 'hs' && rules().climb && rules().seekClimb;
  /** When the hunt proper starts (after the head start). Follows pauses because it hangs off phase.end. */
  function huntAt() { const d = S.phase.data; return S.phase.name === 'seek' && d && d.hunt != null ? S.phase.end - d.hunt : S.phase.at; }
  const hunting = (t = now()) => S.phase.name === 'seek' && t >= huntAt();
  const headStartOn = (t = now()) => S.phase.name === 'seek' && t < huntAt();
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
      applyWear();
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
      const outer = (c) => c.name === 'back' || c.name === 'front' || c.name === 'left' || c.name === 'right';
      const fls = (m.info && Array.isArray(m.info.floors) && m.info.floors.length ? m.info.floors : [{ y: 0 }]).map((fl, i, all) => {
        const y0 = (fl.y || 0) - 0.1; const y1 = i + 1 < all.length ? all[i + 1].y - 0.1 : Infinity;
        return { y: fl.y || 0, name: fl.name, rooms: m.rooms.filter((r) => (r.floor || 0) === i), boxes: m.colliders.filter((c) => c.maxY - c.minY > 0.5 && c.minY >= y0 && c.minY < Math.min(y1, y0 + 1.3) && !outer(c) && c.climb !== false) };
      });
      // free cam limits: the map's footprint (world bounds) and from the floor to just over the top
      let top = 2.4; let bottom = 0;
      for (const c of m.colliders) { if (c.maxY < 30) top = Math.max(top, c.maxY); if (c.maxY - c.minY < 1 && c.maxY > -6) bottom = Math.min(bottom, c.maxY); }
      // …but under the board ceiling where there is one (0.5 m over the tallest collider used to
      // park the camera above the ceiling slab: a blank screen), and never inside walls (clampFree)
      let ceilLo = Infinity; let ceilHi = -Infinity;
      fcBoxes.length = 0;
      for (const c of m.colliders) {
        if (c.ceil && c.maxY < 30) { ceilLo = Math.min(ceilLo, c.minY); ceilHi = Math.max(ceilHi, c.minY); }
        if (FC_WALL(c)) fcBoxes.push(c);
      }
      C.fcTop = Number.isFinite(ceilHi) ? Math.max(ceilHi - 0.25, 1.2) : top; C.fcBottom = bottom + 0.12;
      void ceilLo;
      hud.miniSetup(big ? { minX: m.bounds.minX, maxX: m.bounds.maxX, minZ: m.bounds.minZ, maxZ: m.bounds.maxZ, rooms: fls[0].rooms, boxes: fls[0].boxes, floors: fls } : null);
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
    else {
      // round 1 gets the full title + map orbit; later rounds a short one (the recap already said who hides next)
      const lead = r > 1 ? Math.min(DUR.title, DUR.title2) : DUR.title;
      enter('hide', { round: r, dur: hideMs(), at: at != null ? at + lead : null, data: { spawn } }, lead);
    }
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
    // the countdown (0/3/5/10 s, setting) runs on both screens while the seek is queued
    enter('seek', seekArgs(pickSeekSpawn()), Math.max(countdownMs(), DUR.lead));
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
    // (only the hunt counts: a head start before it scores nothing)
    const pd = S.phase.data || {}; const huntDur = pd.hunt != null ? pd.hunt : S.phase.dur;
    // found, or the seeker ran dry: the hider is paid for the time actually survived (+ the bonus
    // when not found); six early misses used to pay the whole clock, the same as a full survival
    const elapsed = res.T != null ? clamp(huntDur - (S.phase.end - res.T), 0, huntDur) : huntDur;
    let rec;
    if (m.mode === 'hs') {
      const h = hiderOf(r); const sk = other(h);
      const ms = Math.round(elapsed);
      // + the blend bonus (rules.blendBonus) for a paint job that matched its surface at the lock
      const blend = Number.isFinite(R.blend[h]) ? R.blend[h] : -1;
      const blendPts = blendPointsFor(blend, m.rules);
      const points = Math.floor(ms / 1000) + (res.found ? 0 : BONUS) + blendPts;
      m.scores[h] += points;
      // the seeker banks points too (rules.seekScore): ½ pt per second left on the clock when
      // they tag, plus 10 per unused pellet with 'full'. A 12 s find on a 90 s clock reads +39.
      const ss = m.rules && m.rules.seekScore ? m.rules.seekScore : 'off';
      let seekPoints = 0; let spare = 0;
      if (res.found && ss !== 'off') {
        seekPoints = Math.max(0, Math.round(((huntDur - ms) / 1000) * 0.5));
        if (ss === 'full') { spare = clamp(R.pellets[sk], 0, R.maxPellets); seekPoints += 10 * spare; }
        m.scores[sk] += seekPoints;
      }
      rec = { round: r, hider: h, seeker: sk, found: !!res.found, ms, points, seekPoints, spare, blend, blendPts, outOfPellets: !!res.out, p: res.p || null, surf: spotOf(h) };
      // the seeker's wager (rules.wager): a right call on where they hid pays the stake ('CALLED IT')
      const wg = (m.rules && m.rules.wager) | 0; const call = R.call[sk];
      if (wg && call) { const zone = hideZone(h, rec.surf); rec.call = call; rec.zone = zone; if (call === zone) { rec.called = true; rec.wagerPts = wg; m.scores[sk] += wg; } }
      rec.passes = R.passes; rec.closest = Number.isFinite(R.closest) ? Math.round(R.closest * 10) / 10 : null; rec.stared = R.stared; rec.under = R.under;
    } else {
      const wnr = res.found ? res.by : null;
      if (wnr) m.scores[wnr] += 1;
      rec = { round: r, winner: wnr, victim: res.found ? res.victim : null, found: !!res.found, ms: Math.round(elapsed), p: res.p || null, hider: res.found ? res.victim : null, seeker: wnr, surf: res.found ? spotOf(res.victim) : null };
    }
    m.hist = [...m.hist, rec];
    enter(res.found ? 'found' : 'time', { dur: DUR.found, data: rec, at: res.at ?? null }, local ? 0 : DUR.foundLead);
  }
  /** Where a hider ended up, for the seeker's wager: floor | furniture | wall | ceiling | hang. */
  function hideZone(w, surf) {
    if (surf === 'hang' || surf === 'hangHigh') return 'hang';
    if (surf === 'ceiling' || surf === 'under') return 'ceiling';
    if (surf === 'wall' || surf === 'flat' || surf === 'corner') return 'wall';
    if (surf === 'perch' || surf === 'squeeze') return 'furniture';
    const pp = controlsOf(w) ? body[w] : (rem.v > 0.5 ? rem : remHint);
    const H = stage.world.raycast(pp.x, pp.y + 0.05, pp.z, 0, -1, 0, 3, null, true);
    if (H && H.box) {
      const bx = H.box; const wide = bx.maxX - bx.minX > 2.5 && bx.maxZ - bx.minZ > 2.5; const thin = bx.maxY - bx.minY < 0.35;
      if (!(wide && thin) && !/floor|ground|lawn|deck|stair|land|step|path|rug/i.test(bx.name || '')) return 'furniture';
    }
    return 'floor';
  }
  /** Host, once per round: fold the round into the shared records; returns what to celebrate. */
  function recordNow(rec) {
    const d = { ...data() }; const m = S.match;
    const extra = { mode: m.mode, map: m.map, names: { a: api.name('a'), b: api.name('b') }, closest: R.closest, passes: R.passes, strokes: R.strokes, stared: R.stared, called: !!rec.called };
    const r1 = recordRound(d, rec, extra);
    Object.assign(d, r1.patch);
    const patch = { ...r1.patch }; const unlocks = [];
    for (const w of ['a', 'b']) { const u = newUnlocks(d, w); Object.assign(patch, u.patch); Object.assign(d, u.patch); for (const q of u.pops) unlocks.push({ w, key: q.st.key, k: q.st.k, name: q.st.name }); }
    setData(patch);
    return { records: r1.records, unlocks };
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
    else if ((ph.name === 'found' || ph.name === 'time') && pre && !R.toRecap) { R.toRecap = true; enter('recap', { dur: DUR.recap, data: { ...ph.data, rx: recordNow(ph.data || {}) }, at: ph.end }); }
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
    if (name !== 'lobby') S.sheet = false; // a guest's open settings sheet never outlives the lobby
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
          hint(mode() === 'db' ? 'Find a spot, pose, paint. Then hit “Ready”.' : rules().climb ? 'Find a spot — walls and ceilings count — then paint yourself to match.' : 'Find a spot, pick a pose, then paint yourself to match.', 3600);
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
        C.spect = 'eyes'; C.climbV = false; R.huntSeen = false;
        if (stage && mode() === 'hs') { const h = hiderOf(p.round); R.lpVer = stage.paints[h].version; }
        // with a head start the hunt (go sound, hints, the Freeze/Seek stamp) starts later: onHuntStart()
        if (vv && roleOf(vv) === 'hider' && p.data && p.data.blind > 0 && !local) {
          snd.play('go');
          hint(`Head start! ${Math.round(p.data.blind / 1000)} s to move while they’re blindfolded.`, 3200);
        }
        break;
      }
      case 'found': case 'time': {
        const rec = p.data || {};
        R.rec = rec;
        C.freezeUntil = tSec + 0.5;
        C.whip = 0;
        snd.ambience('off');
        exitPaint(true);
        const victim = rec.hider || rec.victim || hiderOf(p.round);
        const winInk = name === 'found' ? (rec.seeker || rec.winner || other(victim)) : victim;
        if (stage) {
          const vb = posOf(victim);
          stage.fx.burst(vb.x, vb.y + 0.4, vb.z, confettiColors(winInk), name === 'found' && rec.ms < 20000 ? 160 : 110, name === 'found' && rec.ms < 20000 ? 1.2 : 1);
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
        // records, unlocks and a right wager call: stickers 900 ms after the card lands, 1.1 s apart
        R.emoteN = 0;
        const rx = (p.data && p.data.rx) || null;
        if (rx) {
          let i = 0;
          for (const r of rx.records || []) { const k = i++; S.matchRecords.push(r); later(() => { hud.pop('NEW RECORD', 'hl', r.text); snd.play('survive'); }, 900 + k * 1100); }
          for (const u of rx.unlocks || []) { const k = i++; S.matchUnlocks.push(`${api.name(u.w)}: ${u.name}`); later(() => { hud.pop('UNLOCKED', 'ink', `${api.name(u.w)}: ${u.name} ${(SLOT_LABEL[u.key] || '').toLowerCase()}`); snd.play('unlock'); }, 900 + k * 1100); }
          const rc = R.rec; // captured: the round may have moved on by the time the sticker fires
          if (rc && rc.called) { const k = i++; later(() => { hud.pop('CALLED IT', rc.seeker || 'hl', `+${rc.wagerPts} for ${api.name(rc.seeker)}`); snd.play('good'); }, 900 + k * 1100); }
        }
        break;
      }
      case 'final': {
        const d = p.data || {};
        snd.ambience('off');
        // the match's own final card first (round timeline, best hide, fastest find, records); 'See the
        // board' on either phone, or 12 s, hands over to the hub's end card (which carries Rematch)
        if (isHost && !S.finalRec) { S.finalRec = true; setData(recordMatch(data(), d.winner)); }
        S.vote = { a: null, b: null }; S.crowned = 0; S.voteVer++;
        later(autoFinish, DUR.final);
        break;
      }
      default: break;
    }
    void prev; void t;
  }

  /** The final card's timer: a vote in progress holds the hand-over a little longer. */
  function autoFinish() {
    const wait = S.finalHold - performance.now();
    if (wait > 50 && S.phase.name === 'final') { later(autoFinish, wait); return; }
    finishMatch();
  }
  /** 'Best hide tonight?': each phone picks a round (hotseat: one tap is the pair's pick); a matching pick crowns it. */
  function castVote(w, r) {
    const m = S.match; if (!m || S.phase.name !== 'final' || S.crowned || m.mode !== 'hs') return;
    const rr = (m.hist || []).find((h) => h && h.round === r); if (!rr || !rr.hider) return;
    if (local) { S.vote.a = r; S.vote.b = r; } else S.vote[w] = r;
    S.voteVer++; S.finalHold = performance.now() + 8000;
    if (S.vote.a && S.vote.a === S.vote.b) {
      S.crowned = r;
      hud.pop('CREATIVE HIDE', rr.hider, `${api.name(rr.hider)} · round ${r}`); snd.play('unlock');
      if (isHost) { const k = `${rr.hider}_creative`; setData({ [k]: (data()[k] | 0) + 1 }); }
    } else snd.play('pose');
  }
  /** Hand the finished match to the hub (either phone may; the host records, a guest's is forwarded). */
  function finishMatch() {
    if (S.finished || S.phase.name !== 'final') return;
    S.finished = true;
    const d = S.phase.data || {};
    const sc = `${d.a}–${d.b}`;
    const text = d.winner ? `${api.name(d.winner)} blends best` : 'Perfectly matched';
    const sub = mode() === 'db' ? `Rounds won ${sc}` : `Points ${sc} · ${api.name('a')} vs ${api.name('b')}`;
    api.finish({ winner: d.winner, text, sub });
  }
  /** A confirmed tag on my screen: a 90 ms hit-stop, a hard shake, a white flash, the pitched-up splat; the ambience cuts for 0.4 s. */
  function tagJuice() { C.freezeUntil = Math.max(C.freezeUntil, tSec + 0.09); C.shake = 0.25; hud.flash(); snd.play('tag'); snd.duck(400); }
  /** The seeker's wager chip (blind card, or the hotseat's hand-over curtain). */
  function setCall(k) {
    if (!rules().wager || mode() !== 'hs' || !CALLS.some((c) => c[0] === k)) return;
    const ph = S.phase.name;
    let sk = null;
    if (local) { if (ph === 'curtain' && S.phase.data && S.phase.data.kind === 'seek') sk = S.phase.data.who; }
    else if ((ph === 'hide' || ph === 'lock') && roleOf(me) === 'seeker') sk = me;
    if (!sk) return;
    R.call[sk] = R.call[sk] === k ? null : k;
    S.callVer++;
    snd.play('ui');
    if (!local) link.send('call', { w: sk, k: R.call[sk] });
  }
  /** The hider's activity for the seeker's ticker (no coordinates: kind + a count), ≤ 1 per 2.5 s. */
  function act(k, n = 0) {
    if (local || S.phase.name !== 'hide' || roleOf(me) !== 'hider') return;
    R.actQ = { k, n };
  }
  const TICK_L = {
    paint: (n, c) => `${n} is painting… (${c} stroke${c === 1 ? '' : 's'})`, stamp: (n) => `${n} used the stamp`, fill: (n) => `${n} filled a whole region`,
    pick: (n) => `${n} drank a colour from the room`, ready: (n) => `${n} is locking in…`, still: (n) => `${n} went still…`, move: (n) => `${n} is on the move`,
  };
  function tickerIn(d) {
    if (!d || !TICK_L[d.k]) return;
    const h = hiderOf(S.phase.round); if (!h) return;
    if (d.k === 'paint' && (d.n | 0) > R.strokes[h]) R.strokes[h] = d.n | 0; // the host keeps the hider's stroke count for the records
    R.ticker = TICK_L[d.k](api.name(h), d.n | 0);
    if (live.ticker) live.ticker.textContent = R.ticker;
  }
  /** React: a sticker on both screens (rate-limited 1 per 700 ms, 8 per recap). */
  function sendEmote(k, btn) {
    const e = EMOTES.find((x) => x[0] === k); if (!e) return;
    const t = performance.now();
    if (t - R.emoteAt < 700 || R.emoteN >= 8) return;
    R.emoteAt = t; R.emoteN++;
    if (btn) { btn.classList.remove('sent'); void btn.offsetWidth; btn.classList.add('sent'); }
    hud.emote(e[1], e[2], true); snd.play('pose');
    if (!local) link.send('emote', { k, w: me });
  }
  /** The hider's palette (≤ 32 colours after the lock's quantisation): the three most used, for the blind card's drops. */
  function paletteOf(w) {
    const d = stage.paints[w].data; const counts = new Map();
    for (let i = 0; i < d.length; i += 28) { const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; counts.set(key, (counts.get(key) || 0) + 1); }
    return [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k]) => `rgb(${(k >> 16) & 255},${(k >> 8) & 255},${k & 255})`);
  }

  /** The hunt proper begins (at the seek phase start, or when the head start runs out). */
  function onHuntStart() {
    R.huntSeen = true;
    const vv = viewer();
    if (!vv) return;
    const role = roleOf(vv);
    if (role === 'hider' && !local) {
      if (P.on && !canPaint()) exitPaint(true);
      posesOpen = false;
      const b = body[vv]; b.lookYaw = 0; b.lookPitch = 0;
    }
    snd.play('go');
    hud.flash();
    if (role === 'seeker') hint(graceMs() ? `Hold fire for ${rules().grace} s — then find them!` : seekerClimbs() ? 'Find them — Stick to climb walls and ceilings. Fire when the crosshair is on them.' : 'Find them. Tap Fire when the crosshair is on them.', 3400);
    else if (role === 'hider') hint(local ? 'Stay still.' : 'Stay still. Drag to look — tap View to watch them.', 3200);
    else hint('Hunt them — and don’t get spotted.', 3000);
  }

  function confettiColors(w) { const c = w === 'a' ? theme.a : theme.b; return [c, mixHex(c, '#ffffff', 0.45), mixHex(c, '#000000', 0.25), theme.hl, '#ffffff']; }

  // ── paint lock + sync ─────────────────────────────────────────────
  /**
   * Blend score (camo %): at the lock, every body texel that faces away from the surface the
   * hider is on (the wall behind a stuck body, else the floor below) is projected onto that surface,
   * the surface's albedo there is sampled exactly as the stamp samples it (blob shadows included),
   * and the mean per-channel difference is turned into a percentage: a perfect stamp seen from the
   * front is ~100, a plain white chameleon on sage wallpaper ~30. No per-frame cost.
   */
  /** The surface a hider is scored against: the face a stuck body is on, else the floor below. */
  function blendSurf(w) {
    const b = body[w];
    let hit = null;
    if (b.at) { stage.ray.set(tv3.set(b.x + b.nx * 0.5, b.y + b.ny * 0.5, b.z + b.nz * 0.5), tv3b.set(-b.nx, -b.ny, -b.nz)); hit = stage.pickMap(1.0); }
    if (!hit) { stage.ray.set(tv3.set(b.x, b.y + 0.7, b.z), tv3b.set(0, -1, 0)); hit = stage.pickMap(2.5); }
    return hit ? stage.surfaceOf(hit) : null;
  }
  /** The score, all at once (the math lives in camo.js, shared with the live meter). */
  function blendOf(w) {
    if (!stage) return -1;
    const p = stage.paints[w];
    p.updateWorld(stage.av[w].meshes);
    const surf = blendSurf(w);
    return surf ? scoreBlend(p, surf) : -1;
  }

  // ── live camo meter (paint mode) ──────────────────────────────────
  // After every settled change (stroke end, wipe / flood finished, the body moved or posed) the
  // score is recomputed a slice per frame (CAMO_SLICE samples ≈ 0.3–1 ms on a phone), so the meter
  // never hitches the brush. The lock reuses the meter's score when nothing changed since: the
  // number the hider saw is the number that scores (the lock's quantise to 32 colours moves it by
  // ±1 at most, and it would be unfair to lose a bonus to that).
  const CAMO_SLICE = 1800;
  const CAMO = { job: createBlendJob(), meter: null, w: null, round: -1, ver: -1, score: -1, jobVer: -1, sig: new Float64Array(9).fill(NaN), jobSig: new Float64Array(9), cur: new Float64Array(9), surf: null, surfSig: new Float64Array(9).fill(NaN), runs: 0, slices: 0 };
  function bodySig(w, out) { const b = body[w]; out[0] = b.x; out[1] = b.y; out[2] = b.z; out[3] = b.at ? 1 : 0; out[4] = b.nx || 0; out[5] = b.ny || 0; out[6] = b.nz || 0; out[7] = POSES.indexOf(b.pose); out[8] = b.wa || 0; return out; }
  function sameSig(a, b) { for (let i = 0; i < 9; i++) if (!(Math.abs(a[i] - b[i]) < 1e-4)) return false; return true; }
  function camoTick() {
    if (!stage) return;
    const v = viewer();
    const on = P.on && !!v && (S.phase.name === 'hide' || S.phase.name === 'seek');
    if (!CAMO.meter) { if (!on) return; CAMO.meter = createMeter(root.querySelector('.chm-hud') || root, { play: (n) => snd.play(n) }); }
    const m = CAMO.meter;
    m.show(on);
    if (!on) { CAMO.job.on = false; return; } // a half-done score is dropped; reopening rescores if anything changed
    const round = S.phase.round | 0;
    if (CAMO.w !== v || CAMO.round !== round) { CAMO.w = v; CAMO.round = round; CAMO.ver = -1; CAMO.sig.fill(NaN); CAMO.surfSig.fill(NaN); CAMO.job.on = false; m.reset(); }
    m.tick(tSec);
    const p = stage.paints[v];
    if (CAMO.job.on) {
      CAMO.slices++;
      if (!stepBlend(CAMO.job, m.value < 0 ? 1e9 : CAMO_SLICE)) return; // the first score of a round at once (a number on screen right away), then sliced
      if (p.version !== CAMO.jobVer) return; // painted while scoring: rescore below next frame
      CAMO.score = CAMO.job.score; CAMO.ver = CAMO.jobVer; CAMO.sig.set(CAMO.jobSig);
      const bb = mode() === 'hs' ? rules().blendBonus | 0 : 0;
      m.set(CAMO.score, bb ? (bb === 20 ? 90 : 80) : -1, bb);
      return;
    }
    // wait for the change to settle: a stroke in progress, a wipe / flood, a fill swell, the pose easing in
    if (P.last || p.revealing || PFX.fillParts || (P.texelDirtyAt && tSec < P.texelDirtyAt)) return;
    bodySig(v, CAMO.cur);
    if (p.version === CAMO.ver && sameSig(CAMO.cur, CAMO.sig)) return;
    refreshTexels(); // the tail sways and the eye turrets wander: score (and brush) the body as it is now
    if (!sameSig(CAMO.cur, CAMO.surfSig)) { CAMO.surf = blendSurf(v); CAMO.surfSig.set(CAMO.cur); }
    CAMO.jobVer = p.version; CAMO.jobSig.set(CAMO.cur);
    if (!CAMO.surf) { CAMO.ver = p.version; CAMO.sig.set(CAMO.cur); CAMO.score = -1; m.set(-1); return; }
    startBlend(CAMO.job, p, CAMO.surf); CAMO.runs++;
  }
  /** The meter's score for w if neither the paint nor the spot changed since it was taken, else null. */
  function camoCached(w) {
    if (CAMO.w !== w || CAMO.ver < 0 || CAMO.job.on || CAMO.round !== (S.phase.round | 0)) return null;
    if (stage.paints[w].version !== CAMO.ver || !sameSig(bodySig(w, CAMO.cur), CAMO.sig)) return null;
    return CAMO.score;
  }
  function blendPointsFor(blend, rulesObj) {
    const bb = rulesObj && rulesObj.blendBonus ? rulesObj.blendBonus : 0;
    if (!bb || blend == null || blend < 0) return 0;
    return blend >= (bb === 20 ? 90 : 80) ? bb : 0;
  }
  function lockPaint(w) {
    if (R.lockSent && !local) return;
    const p = stage.paints[w];
    const t0 = performance.now();
    const enc = p.encode();
    p.flush();
    const t1 = performance.now();
    R.paintSum[w] = enc.sum; R.paintOk[w] = true;
    if (controlsOf(w)) { try { const c = camoCached(w); R.blend[w] = c != null ? c : blendOf(w); stats.blendCached = c != null; } catch (e) { R.blend[w] = -1; console.warn('blend', e); } }
    stats.lastPaint = { w, bytes: enc.bytes, b64: enc.b64.length, chunks: Math.ceil(enc.b64.length / 3200), encMs: t1 - t0, blendMs: performance.now() - t1 };
    if (!local) {
      R.lockSent = true;
      const b = body[w];
      link.sendBlob('paint', enc.b64, { w, sum: enc.sum, round: R.round, pos: posArr(b), blend: R.blend[w] });
    }
  }
  /** Paint while hunted (or during the head start): the same quantised blob as the lock, at most
   *  one a second, sent when a stroke / fill / stamp / undo has settled. */
  function livePaint(t) {
    if (local || S.phase.name !== 'seek' || mode() !== 'hs' || roleOf(me) !== 'hider' || !R.paintOk[me]) return;
    const p = stage.paints[me];
    if (p.version === R.lpVer || P.last || p.revealing || t - R.lpAt < 1000) return; // (a stamp wipe / fill flood sends once it has settled)
    const enc = p.encode();
    p.flush();
    R.lpVer = p.version;
    if (enc.sum === R.paintSum[me]) { R.lpSame = (R.lpSame | 0) + 1; return; } // undo back / repaint the same: nothing to send
    R.lpAt = t; R.lpSent++;
    R.paintSum[me] = enc.sum;
    stats.lastPaint = { w: me, bytes: enc.bytes, b64: enc.b64.length, chunks: Math.ceil(enc.b64.length / 3200), live: true };
    link.sendBlob('paint', enc.b64, { w: me, sum: enc.sum, round: R.round, live: 1 });
  }
  let prevPaint = null; const tellPts = [];
  /** A live paint update arrived (seeker's device): apply it, then the "Shows" tell. */
  function livePaintIn(w, b64, meta) {
    if (meta.round !== R.round || S.phase.name !== 'seek') return;
    const p = stage.paints[w];
    if (!prevPaint) prevPaint = new Uint8Array(p.data.length);
    prevPaint.set(p.data);
    const sum = p.decode(b64);
    p.flush();
    if (sum !== meta.sum) { link.send('paintreq', { w, round: meta.round }); return; }
    R.paintSum[w] = sum; R.paintOk[w] = true; R.lpIn++;
    paintTell(w);
  }
  /** Fresh paint glints for the seeker: in range, in the line of sight, at most once a second. */
  function paintTell(w) {
    const v = viewer();
    if (rules().huntPaint !== 'tell' || !hunting() || !v || roleOf(v) !== 'seeker') return;
    const a = stage.av[w]; const p = stage.paints[w];
    if (!a.root.visible || now() - R.tellAt < TELL.minGap) return;
    p.updateWorld(a.meshes);
    const n = p.changedPoints(prevPaint, tellPts, 3);
    if (!n) return;
    const c = stage.camera.position; const range = TELL.range * Math.max(1, a.st.size);
    let seen = 0;
    for (let i = 0; i < tellPts.length; i += 3) {
      const dx = tellPts[i] - c.x; const dy = tellPts[i + 1] - c.y; const dz = tellPts[i + 2] - c.z; const d = Math.hypot(dx, dy, dz);
      if (d > range || d < 1e-3) continue;
      const H = stage.world.raycast(c.x, c.y, c.z, dx / d, dy / d, dz / d, Math.max(0, d - 0.14), null, true);
      if (!H) seen++;
    }
    if (!seen) { R.tellSkip++; return; }
    R.tellAt = now(); R.tells++;
    R.tell = { until: tSec + TELL.secs, pts: tellPts.slice() };
  }
  link.onBlob('paint', (b64, meta) => {
    if (!meta || !stage) return;
    const w = meta.w;
    if (w === me) return;
    if (meta.live) { livePaintIn(w, b64, meta); return; }
    const sum = stage.paints[w].decode(b64);
    stage.paints[w].flush();
    if (sum === meta.sum) {
      R.paintOk[w] = true; R.paintSum[w] = sum;
      if (Number.isFinite(meta.blend)) R.blend[w] = meta.blend;
      if (meta.pos) setRemHint(meta.pos);
      hud.drops(paletteOf(w)); // the blind card's drops take their actual colours (a tease)
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
  link.on('ready', (d) => { if (isHost && d) { if (d.strokes > (R.strokes[d.w] | 0)) R.strokes[d.w] = d.strokes | 0; R.ready.add(d.w); if (S.phase.name === 'hide' && (mode() === 'hs' ? R.ready.has(hiderOf(S.phase.round)) : R.ready.size >= 2)) endHide(); } });
  link.on('next', () => { if (isHost) hostNext(); });
  link.on('wear', (d) => { if (d && (d.w === 'a' || d.w === 'b') && d.w !== me) { wornRemote[d.w] = d.wr | 0; applyWear(); } });
  link.on('call', (d) => { if (d && (d.w === 'a' || d.w === 'b')) { R.call[d.w] = d.k || null; } });
  link.on('act', (d) => tickerIn(d));
  link.on('vote', (d) => { if (d && (d.w === 'a' || d.w === 'b') && d.w !== me) castVote(d.w, d.r | 0); });
  link.on('emote', (d) => { const e = d && EMOTES.find((x) => x[0] === d.k); if (e) { hud.emote(e[1], e[2], false); snd.play('pose'); } });
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
    if (!d.sk) {
      R.trailUntil[d.w] = d.at + 550; if (typeof d.left === 'number') R.escapes[d.w] = d.left;
      stage.fx.trailMat.color.set(d.w === 'a' ? theme.a : theme.b);
    }
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
    sendWear();
  }
  function onHello(d) {
    if (!d) return;
    S.helloEpoch = link.epoch;
    sendWear();
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
    if (!hunting()) return; // blindfolded during the hider's head start
    if (now() < huntAt() + graceMs()) { hint(`Grace period — fire in ${Math.ceil((huntAt() + graceMs() - now()) / 1000)} s`, 900); snd.play('warn'); return; }
    if (R.pellets[w] <= 0) { hint('Out of pellets!'); snd.play('warn'); return; }
    R.pellets[w]--; R.used[w]++;
    if (R.pellets[w] === 1) later(() => { if (S.phase.name === 'seek' && R.pellets[w] === 1) { hud.pop('LAST PELLET', w, 'Make it count'); snd.play('warn'); } }, 450);
    const T = now();
    const tgt = targetOf(w);
    const ray = stage.setRayFromScreen(stage.size[0] / 2, stage.size[1] / 2, stage.size[0], stage.size[1]);
    const objs = [stage.mapMesh];
    if (stage.av[tgt].root.visible) for (const m of stage.av[tgt].meshes) objs.push(m);
    // a pellet can't tag what the fog hides: range = the play fog's far edge (26 m big maps, 30 small)
    const range = Math.min(40, stage.scene.fog ? stage.scene.fog.far : 40);
    const hit = stage.pick(objs, range);
    const o = ray.ray.origin; const dir = ray.ray.direction;
    const muzzle = { x: o.x + dir.x * 0.3 - 0, y: o.y - 0.08, z: o.z + dir.z * 0.3 };
    const fly = Math.min(30, range);
    const p = hit ? hit.point : { x: o.x + dir.x * fly, y: o.y + dir.y * fly, z: o.z + dir.z * fly };
    let n = [0, 1, 0];
    if (hit && hit.face) { const nn = hit.face.normal.clone().transformDirection(hit.object.matrixWorld); n = [nn.x, nn.y, nn.z]; }
    let isTag = !!hit && stage.av[tgt].meshes.includes(hit.object);
    // pellet assist: a near miss that passes within a sliver (0.06 × size) of the body's parts still
    // tags, when nothing blocks it first (a Medium body at 5 m is ~45 × 22 px on a phone)
    if (!isTag && stage.av[tgt].root.visible) {
      const slack = 0.06 * sizeS(); let bestT = Infinity;
      for (const m of stage.av[tgt].meshes) {
        if (!m.visible) continue;
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        tvA.copy(m.geometry.boundingSphere.center); m.localToWorld(tvA);
        const sc = m.getWorldScale(tv3b).x; const rad = m.geometry.boundingSphere.radius * sc;
        const along = (tvA.x - o.x) * dir.x + (tvA.y - o.y) * dir.y + (tvA.z - o.z) * dir.z;
        if (along < 0.2 || along > range) continue;
        const dd = Math.hypot(tvA.x - (o.x + dir.x * along), tvA.y - (o.y + dir.y * along), tvA.z - (o.z + dir.z * along));
        if (dd <= rad * 0.72 + slack && along < bestT) bestT = along; // the parts are fat ellipsoids: 0.72 of the sphere
      }
      if (bestT < Infinity && !(hit && hit.distance < bestT - 0.05)) {
        isTag = true; stats.assisted = (stats.assisted || 0) + 1;
        p.x = o.x + dir.x * bestT; p.y = o.y + dir.y * bestT; p.z = o.z + dir.z * bestT;
      }
    }
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
    // dl: the interpolation delay this screen drew the target with (adaptive, see link.js): the
    // victim judges the shot against its own path around T − dl
    const msg = { id, T, by: w, o: [muzzle.x, muzzle.y, muzzle.z], p: [p.x, p.y, p.z], n, hit: !!hit, tag: isTag, seen, left: R.pellets[w], dl: Math.round(link.delay) };
    stats.lastShot = { range, tag: isTag, hit: !!hit, obj: hit ? (stage.isMap(hit.object) ? 'map' : 'other') : null, p: msg.p, o: [o.x, o.y, o.z], d: [dir.x, dir.y, dir.z], tgtVisible: stage.av[tgt].root.visible, seen };
    if (isTag) {
      R.pendingTag = id;
      if (local) { tagJuice(); hostFound(w, tgt, T, msg.p); return; }
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
    if (mode() === 'hs') roundOver({ found: false, out: true, T: now() });
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
    const dl = Number.isFinite(d.dl) ? clamp(d.dl, 0, 400) : link.delay; // the shooter's interpolation delay
    const ok = confirmTag(d.T, d.seen, dl);
    stats.lastTagCheck = { ok, T: d.T, seen: d.seen, me: [body[me].x, body[me].y, body[me].z], n: hist.n, escAt: R.escapeAt, delay: dl, rtt: link.rtt };
    if (ok) {
      if (isHost) hostFound(d.by, me, d.T, d.p);
      else link.send('tagres', { id: d.id, ok: true, T: d.T, by: d.by, victim: me, p: d.p });
    } else {
      link.send('tagres', { id: d.id, ok: false, by: d.by });
      stage.fx.splat(to.x, to.y, to.z, d.n[0], d.n[1], d.n[2], ink, 0.24, tSec);
    }
  }
  function confirmTag(T, seen, delay = link.delay) {
    // Shooter-favoured: any true position in the last 250 ms (+ one-way delay) within tolerance
    // confirms. But a scurry (6.6 m/s) or zip covers ~3 m in that window, so when my escape
    // started before the shooter's view could have shown it, the window shrinks to 120 ms: the
    // one counterplay a hider has is not nullified by lag compensation.
    const esc = R.escapeAt;
    const oneWay = link.rtt * 0.5;
    const escaping = esc > 0 && esc < T - delay - oneWay - TAG_WINDOW_ESCAPE && T - esc < 1500;
    const t0 = T - delay - (escaping ? oneWay + TAG_WINDOW_ESCAPE : TAG_WINDOW); const t1 = T + 60;
    stats.lastWindow = escaping ? 'escape' : 'full';
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
    if (d.ok) { if (d.by === me) tagJuice(); if (isHost) hostFound(d.by, d.victim, d.T, d.p); return; }
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
    if (!hunting()) return;
    const t = now();
    // the grace period holds the scan too (Hard's 5 s used to be a free glint before Fire unlocked)
    if (t < huntAt() + graceMs()) { hint(`Grace period — scan in ${Math.ceil((huntAt() + graceMs() - t) / 1000)} s`, 900); snd.play('warn'); return; }
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
    if (!w || local || S.phase.name !== 'seek' || roleOf(w) !== 'hider' || frozen() || !hunting() || C.spect !== 'eyes') return;
    if (R.escapes[w] <= 0) { hint(rules().escapes ? 'No escapes left' : 'Escapes are off in these rules', 1400); snd.play('warn'); return; }
    const b = body[w];
    const yaw = fpBaseYaw(w) + b.lookYaw;
    R.scurried[w] = true; R.escapes[w]--;
    const sp = SPEED.scurry * (0.8 + 0.2 * b.s);
    // Stuck to a wall or ceiling: "drop and dash". The old dash went along the heading, which for a
    // stuck body points straight out of the wall; the crawl's tangent projection zeroed it, the
    // escape was spent, the trail appeared, and the hider never moved.
    if (b.at) unstick(w);
    // along the look direction, flat on the floor
    R.scurry = { until: tSec + 0.5, vx: Math.sin(yaw) * Math.cos(b.lookPitch) * sp, vy: 0, vz: Math.cos(yaw) * Math.cos(b.lookPitch) * sp, x0: b.x, z0: b.z, t0: tSec, w };
    R.escapeAt = now();
    if (b.pose !== 'squeeze') { b.pose = 'stand'; stage.av[w].setPose('stand'); }
    R.trailUntil[w] = now() + 650;
    stage.fx.trailMat.color.set(w === 'a' ? theme.a : theme.b);
    link.send('scurry', { w, at: now(), left: R.escapes[w] });
    snd.play('scurry');
  }

  // ── the hider's views while hunted: own eyes · watch the seeker · free cam ──
  // Purely local: nothing is sent, the body doesn't move and its published look stays as it was.
  const VIEWS = ['eyes', 'watch', 'free'];
  const VIEW_L = { eyes: 'View', watch: 'Watching', free: 'Free cam' };
  function viewAllowed() { const v = viewer(); return !!v && !local && mode() === 'hs' && roleOf(v) === 'hider' && hunting() && !frozen(); }
  /** px/py/pz: where the camera was last frame (the move is raycast and stops 0.15 m short of a wall). */
  function clampFree(px, py, pz) {
    const B = stage.world.bounds;
    C.fcX = clamp(C.fcX, B.minX + 0.15, B.maxX - 0.15); C.fcZ = clamp(C.fcZ, B.minZ + 0.15, B.maxZ - 0.15);
    C.fcY = clamp(C.fcY, C.fcBottom, C.fcTop);
    // furniture can be flown through; walls and ceilings can't (inside one the screen went blank)
    if (px !== undefined) {
      const dx = C.fcX - px; const dy = C.fcY - py; const dz = C.fcZ - pz; const L = Math.hypot(dx, dy, dz);
      if (L > 1e-5) {
        const h = stage.world.raycast(px, py, pz, dx / L, dy / L, dz / L, L + 0.15, FC_WALL);
        if (h) { const k = Math.max(0, h.t - 0.15) / L; C.fcX = px + dx * k; C.fcY = py + dy * k; C.fcZ = pz + dz * k; }
      }
    }
    // still inside (or within 0.15 m of) a wall / ceiling slab: leave by the nearest face
    for (let i = 0; i < fcBoxes.length; i++) {
      const b = fcBoxes[i]; const e = 0.15;
      if (C.fcX <= b.minX - e || C.fcX >= b.maxX + e || C.fcY <= b.minY - e || C.fcY >= b.maxY + e || C.fcZ <= b.minZ - e || C.fcZ >= b.maxZ + e) continue;
      const l = C.fcX - (b.minX - e); const r = b.maxX + e - C.fcX; const d = C.fcY - (b.minY - e); const u = b.maxY + e - C.fcY; const n = C.fcZ - (b.minZ - e); const f = b.maxZ + e - C.fcZ;
      const mn = Math.min(l, r, d, u, n, f);
      if (mn === l) C.fcX = b.minX - e; else if (mn === r) C.fcX = b.maxX + e; else if (mn === d) C.fcY = b.minY - e; else if (mn === u) C.fcY = b.maxY + e; else if (mn === n) C.fcZ = b.minZ - e; else C.fcZ = b.maxZ + e;
    }
    C.fcY = clamp(C.fcY, C.fcBottom, C.fcTop);
  }
  function setView(m, silent = false) {
    if (m === C.spect) return;
    if (m !== 'eyes' && !viewAllowed()) return;
    if (m !== 'eyes' && P.on) exitPaint(true);
    if (m === 'free' && stage) {
      // start where the camera is now, looking the same way
      const c = stage.camera; c.getWorldDirection(tvA);
      C.fcX = c.position.x; C.fcY = c.position.y; C.fcZ = c.position.z;
      C.fcYaw = Math.atan2(tvA.x, tvA.z); C.fcPitch = Math.asin(clamp(tvA.y, -1, 1));
      clampFree();
    }
    C.spect = m; U.spect = m; posesOpen = false;
    // whip the camera to the new view instead of cutting (cameras() eases the offset out)
    C.vsAt = tSec; C.vsPend = true;
    if (silent) return;
    snd.play('whoosh');
    const mouse = controls && controls.st.usingMouse;
    if (m === 'watch') hint(`Watching ${api.name(other(viewer()))}. You stay right where you are.`, 2600);
    else if (m === 'free') hint(mouse ? 'Free cam: W A S D fly · Space / E up · Q / C down · drag to look' : 'Free cam: left thumb flies where you look · drag to look', 3200);
    else hint('Back in your own eyes.', 1400);
  }
  function cycleView() {
    if (!viewAllowed()) { if (S.phase.name === 'seek' && roleOf(viewer()) === 'hider' && !local && !hunting()) hint('Views open when the hunt starts', 1400); return; }
    setView(VIEWS[(VIEWS.indexOf(C.spect) + 1) % VIEWS.length]);
  }

  // ── sticky feet: stick / let go, tongue-zip ──────────────────────
  /** May this player use the sticky-feet moves (stick, zip, poses, walk-into-a-wall) right now?
   *  Hiders while hiding (and during a head start); the seeker while hunting, when it may climb. */
  function canMoveSelf(w) {
    if (!w || frozen()) return false;
    const ph = S.phase.name; const role = roleOf(w);
    if (ph === 'hide') return role === 'hider' || role === 'both';
    if (ph !== 'seek') return false;
    if (role === 'hider') return headStartOn();
    if (role === 'seeker') return seekerClimbs() && hunting();
    return false;
  }
  /** The hider is looking through a spectator camera (watch the seeker / free cam). */
  const spectating = (w) => w === viewer() && C.spect !== 'eyes' && U.spect !== 'eyes';
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
    // sticky floor only with feet on something (mid-jump it used to glue the body to thin air)
    else if (b.onGround && stage.world.inside(b.x, b.z)) { const gy = stage.world.groundAt(b.x, b.z, 0.05, b.y + 0.03, 0); attachTo(w, b.x, Math.abs(gy - b.y) < 0.06 ? gy : b.y, b.z, 0, 1, 0, stage.world.groundRes.box); }
    else { hint('Nothing in reach to stick to', 1100); snd.play('warn'); }
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
    const seeking = ph === 'seek' && role === 'hider' && !local && hunting(); // costs an escape
    const seekerZip = ph === 'seek' && role === 'seeker'; // free, 2.5 s cooldown, the hider sees the tongue
    if (spectating(w)) return false;
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
    const H = stage.world.raycast(ox + dx * along, oy + dy * along, oz + dz * along, dx, dy, dz, range + 1, null, true);
    if (H && H.box && H.box.climb === false) { hint('Too slippery to stick there', 1300); snd.play('warn'); return false; }
    if (!H || Math.hypot(H.x - cx, H.y - cy, H.z - cz) > range || !stage.world.inside(H.x, H.z)) { hint('Nothing in tongue range there — aim at a nearby surface', 1500); snd.play('warn'); return false; }
    if (stage.world.guarded(H.x, H.y, H.z, H.nx, H.ny, H.nz, Math.min(0.35, b.head * 0.8))) { hint('No hiding up there', 1300); snd.play('warn'); return false; }
    if (Math.hypot(H.x - cx, H.y - cy, H.z - cz) < 0.35 * b.s) { hint('Too close — just crawl there', 1000); return false; }
    b.zip = { t0: tSec, dur: ZIP.dur, sx: b.x, sy: b.y, sz: b.z, tx: H.x, ty: H.y, tz: H.z, nx: H.nx, ny: H.ny, nz: H.nz, box: H.box, hx: dx, hy: dy, hz: dz, from: b.at ? 1 : 0 };
    if (!b.at) { b.zip.sy = b.y + b.r; }
    R.zipReady[w] = t + (seeking ? ZIP.cdSeek : seekerZip ? ZIP.cdSeeker : ZIP.cdHide);
    stage.av[w].mouthWorld(tvZ);
    stage.fx.shootTongue(tvZ, { x: H.x, y: H.y, z: H.z }, tSec, ZIP.dur + 0.1, (out) => stage.av[w].mouthWorld(out));
    snd.play('zip'); api.haptic(14);
    if (b.pose !== 'stand' && b.pose !== 'wall') { b.pose = 'stand'; stage.av[w].setPose('stand'); }
    b.sq = false;
    if (seeking) {
      R.escapes[w]--; R.escapeAt = t;
      R.trailUntil[w] = t + 550;
      stage.fx.trailMat.color.set(w === 'a' ? theme.a : theme.b);
      link.send('zip', { w, at: t, to: [H.x, H.y, H.z], left: R.escapes[w] });
    } else if (seekerZip && !local) link.send('zip', { w, at: t, to: [H.x, H.y, H.z], sk: 1 });
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
  /** Hiding, or (two devices) hunted with "Paint while hunted" on, or during the head start. */
  function canPaint() {
    const v = viewer();
    if (!v || frozen()) return false;
    const role = roleOf(v); const ph = S.phase.name;
    if (ph === 'hide') return role === 'hider' || role === 'both';
    if (ph === 'seek' && role === 'hider' && !local) return headStartOn() || rules().huntPaint !== 'off';
    return false;
  }
  function enterPaint() {
    if (P.on) return;
    if (!canPaint()) {
      if (S.phase.name === 'seek' && roleOf(viewer()) === 'hider' && !local) { hint('Paint is locked while you’re hunted (settings)', 1600); snd.play('warn'); }
      return;
    }
    const v = viewer();
    if (C.spect !== 'eyes') setView('eyes', true); // painting orbits your own body
    P.on = true; P.tool = 'brush';
    controls.setMode('paint');
    stage.av[v].st.breathe = false;
    C.paintYaw = body[v].yaw + 0.9; C.paintPitch = 0.32; C.paintDist = 1.3;
    P.texelDirtyAt = tSec + 0.35;
    snd.play('ui');
    root.classList.add('painting');
    if (hunting() && rules().huntPaint === 'tell' && !shownHints.has('tell')) { shownHints.add('tell'); hint('Careful: fresh paint glints if the seeker is close and can see you.', 3400); }
    else hint(controls.st.usingMouse ? 'Drag on your body to paint · drag elsewhere to turn · wheel to zoom' : 'Paint with one finger · two fingers turn and zoom', 3400);
  }
  function exitPaint(silent = false) {
    if (!P.on) return;
    P.on = false; P.last = null;
    root.classList.remove('painting');
    if (stage) { stage.fx.setCursor(false); const v = viewer(); if (v) stage.av[v].st.breathe = true; }
    if (controls) controls.setMode('none');
    if (!silent) snd.play('ui');
    // pre-encode while they walk off, so Ready (or the next live update) reuses the blob instead of
    // quantising at the tap; the skin settles to the ≤ 32 colours the partner will see
    const pv = viewer();
    if (stage && pv && S.phase.name === 'hide') later(() => { if (!P.on && stage) { stage.paints[pv].encode(); stage.paints[pv].flush(); } }, 120);
  }
  function myMeshes() { const v = viewer(); return v ? stage.av[v].meshes : []; }
  function refreshTexels() {
    if (PFX.fillParts) { for (const pi of PFX.fillParts) stage.av[PFX.fillW].meshes[pi].scale.setScalar(1); PFX.fillParts = null; } // texels from the rest pose, not mid-swell
    const v = viewer(); if (!v) return; stage.paints[v].updateWorld(stage.av[v].meshes); P.texelDirtyAt = 0; }
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
      P.lastAt = now();
      dabAt(hit);
      showCursor(hit);
      stage.fx.pulseCursor(0.12);
      snd.brush(P.size, 0.35, P.hard);
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
      const n = Math.min(DAB_CAP[P.size], Math.floor(d / step));
      for (let i = 1; i <= n; i++) {
        const k = i / n;
        dab3(P.last[0] + dx * k, P.last[1] + dy * k, P.last[2] + dz * k);
      }
      P.last[0] = hit.point.x; P.last[1] = hit.point.y; P.last[2] = hit.point.z;
      showCursor(hit);
      // stroke speed in body-sizes per second → scrub loudness
      const tn = now(); const sdt = Math.max(16, tn - (P.lastAt || tn - 16)); P.lastAt = tn;
      snd.brush(P.size, (d / body[viewer()].s) / (sdt / 1000) / 1.6, P.hard);
    },
    end() { if (P.last) { P.strokes++; P.last = null; const vv = viewer(); if (vv) { R.strokes[vv]++; act('paint', R.strokes[vv]); } } if (!controls.st.usingMouse) stage.fx.setCursor(false); },
    cancel() { if (P.last) { stage.paints[viewer()].undo(); P.last = null; } },
    tap(x, y) {
      if (!P.on) return;
      if (P.tool === 'fill') {
        if (P.texelDirtyAt) refreshTexels();
        const hit = pickOwn(x, y);
        if (!hit) { hint('Tap a part of your body to fill it'); return; }
        const region = REGION_NAMES[REGION_OF_PART[hit.object.userData.part]];
        const p = stage.paints[viewer()];
        p.snapshot(); p.fill(region, P.rgb, [hit.point.x, hit.point.y, hit.point.z]); // floods out from the finger
        PFX.fillAt = now(); PFX.fillW = viewer(); PFX.fillParts = REGIONS[region]; PFX.fills++;
        snd.play('fill'); api.haptic(10); act('fill');
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
    // metres per CSS pixel at the hit, so the ring stays ~2.5 px wide at any zoom
    const cam = stage.camera; const dist = cam.position.distanceTo(hit.point);
    const mpp = (2 * dist * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, SH);
    stage.fx.setCursor(true, hit.point.x, hit.point.y, hit.point.z, curN.x, curN.y, curN.z, r, theme.outline, P.rgb, mpp, P.tool === 'brush' && !P.hard);
  }
  /** Size / hardness changed: show the new brush on the body for a moment (phones have no hover). */
  function brushPreview() {
    if (!P.on || !stage) return;
    const v = viewer(); if (!v) return;
    snd.brush(P.size, 0.9, P.hard);
    if (P.last) return;
    if (P.texelDirtyAt) refreshTexels();
    const cam = stage.camera.position;
    stage.av[v].meshes[0].getWorldPosition(tv3);
    tv3b.copy(tv3).sub(cam).normalize();
    stage.ray.set(cam, tv3b); stage.ray.far = 10;
    hitsTmp.length = 0;
    stage.ray.intersectObjects(myMeshes(), false, hitsTmp);
    if (!hitsTmp.length) return;
    showCursor(hitsTmp[0]);
    stage.fx.pulseCursor(0.3);
    PFX.previewUntil = now() + 1100; PFX.previewFrames = stats.renders + 10; // long enough to be seen, even on a slow frame
  }
  /** Paint juice: the filled part swells 1.08 → 1 (0.18 s); a stamp flashes the outline white → off (0.25 s). */
  const PFX = { fillAt: -1e9, fillW: null, fillParts: null, stampAt: -1e9, stampW: null, previewUntil: 0, previewFrames: 0, fills: 0, stamps: 0 };
  function paintFx() {
    const t = now();
    if (PFX.fillParts) {
      const k = (t - PFX.fillAt) / 180; const ms = stage.av[PFX.fillW].meshes;
      const sc = k >= 1 ? 1 : 1 + 0.08 * (1 - k) * (1 - k);
      for (const pi of PFX.fillParts) ms[pi].scale.setScalar(sc);
      if (k >= 1) PFX.fillParts = null;
    }
    if (PFX.stampW) {
      const k = (t - PFX.stampAt) / (REVEAL.stamp.dur * 1000); const av = stage.av[PFX.stampW]; // the outline flash lasts as long as the wipe
      if (av.revealOn) PFX.stampW = null; // the real reveal owns the outline
      else if (k >= 1) { av.setReveal(null); PFX.stampW = null; } else av.setReveal('#ffffff', 0.004 + 0.016 * (1 - k));
    }
    if (PFX.previewUntil && t > PFX.previewUntil && stats.renders >= PFX.previewFrames) { PFX.previewUntil = 0; if (!P.last && !controls.st.usingMouse) stage.fx.setCursor(false); }
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
    snd.play('gulp'); api.haptic(12); act('pick');
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
    // the print wipes up the screen (camera up) like a sheet being pulled off the wall
    const cu = stage.camera.matrixWorld.elements;
    p.stamp(surf, [cu[4], cu[5], cu[6]]);
    PFX.stampAt = now(); PFX.stampW = v; PFX.stamps++;
    snd.play('stamp'); snd.play('whoosh'); api.haptic(20); act('stamp'); // no full-screen flash: it hid the wipe
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
      case 'hang': return climb && b.at && b.ny < -0.7 && hangRoom(b);
      case 'perch': return b.at ? !!(b.box && b.box.perch) : !!(stage.world.groundAt(b.x, b.z, b.r * 0.6, b.y + 0.05) >= 0 && stage.world.groundRes.box && stage.world.groundRes.box.perch);
      case 'corner': return b.at && Math.abs(b.ny) < 0.7 && !!stage.world.cornerAt(b.x, b.y, b.z, b.nx, b.nz, 0.45 + b.r);
      default: return false;
    }
  }
  /** Room to dangle under an overhead face: the hanging body reaches ~0.9 × size below it (a
   *  low underside used to let it sink through the floor, out of reach of every pellet). */
  function hangRoom(b) {
    const g = stage.world.groundAt(b.x, b.z, b.r * 0.4, b.y - 0.02, 0);
    return b.y - g >= 0.9 * b.s;
  }
  function setPose(name) {
    const v = viewer();
    if (!v || !POSES.includes(name) || frozen()) return;
    const ph = S.phase.name; const role = roleOf(v);
    const allowed = (ph === 'hide' && (role === 'hider' || role === 'both')) || (ph === 'seek' && (role === 'hider' || role === 'both')) || (ph === 'seek' && role === 'seeker' && seekerClimbs() && hunting());
    if (!allowed || spectating(v)) return;
    const b = body[v];
    if (b.zip) return;
    // leaving the squeeze needs room to stand
    if (b.sq && name !== 'squeeze') {
      if (!stage.world.roomFor(b)) { hint('No room to stand up here — squeeze out first', 1600); snd.play('warn'); return; }
      b.sq = false;
    }
    if (name === 'wall') {
      if (!b.at) {
        const wall = stage.world.nearestWall(b.x, b.y, b.z, 0.5 + b.r, (bx) => bx.climb !== false);
        if (!wall) { hint('Get right up against a wall or the side of something first', 2200); snd.play('warn'); return; }
        // press flat against it: stick to the face, head up
        const cy = b.y + 0.25 * b.s;
        attachBody(stage.world, b, wall.nx ? wall.px : b.x, cy, wall.nz ? wall.pz : b.z, wall.nx, 0, wall.nz, wall.box, 0, 1, 0);
        b.lockY = !rules().climb;
        stage.av[v].squash(0.7); snd.play('stick');
      }
    } else if (name === 'hang') {
      if (!b.at || b.ny > -0.7) { hint(rules().climb ? 'Hang from a ceiling or the underside of something — Stick to it first' : 'Climbing is off in these rules', 2200); snd.play('warn'); return; }
      if (!hangRoom(b)) { hint('Too low to hang here — try Flat', 1600); snd.play('warn'); return; }
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
      case 'stick': if (v && !spectating(v)) { if (body[v].at || canMoveSelf(v)) stick(v); } break;
      case 'stickOrView': if (v && S.phase.name === 'seek' && roleOf(v) === 'hider' && hunting() && !local) action('view'); else action('stick'); break;
      case 'view': cycleView(); break;
      case 'zip': if (v) zip(v); break;
      case 'stickOrPick': if (P.on) action('pick'); else action('stick'); break;
      case 'zipOrUndo': if (P.on) action('undo'); else action('zip'); break;
      case 'sprint': if (v && S.phase.name === 'seek' && roleOf(v) !== 'hider' && hunting()) { R.sprint = !R.sprint; snd.play('sprint'); } break;
      case 'settings': S.sheet = !S.sheet; S.wardrobe = false; snd.play('ui'); break;
      case 'wardrobe': S.wardrobe = !S.wardrobe; S.sheet = false; snd.play('ui'); break;
      case 'finish': if (S.phase.name === 'final') { snd.play('ui'); finishMatch(); } break;
      case 'tips-ok': U.tips = false; markTipsSeen(); snd.play('ui'); break;
      case 'scan': scan(); break;
      case 'scurry': scurry(); break;
      case 'jump': if (v && controlsOf(v)) R.jumpReq = true; break;
      case 'crouch': if (v) setPose(body[v].at ? (body[v].pose === 'wall' ? 'stand' : 'wall') : body[v].pose === 'crouch' ? 'stand' : 'crouch'); break;
      case 'paint': if (P.on) exitPaint(); else enterPaint(); break;
      case 'poses': posesOpen = !posesOpen; snd.play('ui'); break;
      case 'brush': if (P.on) { const was = P.tool === 'brush'; if (was) P.size = (P.size + 1) % 3; P.tool = 'brush'; snd.play('ui'); if (was) brushPreview(); } break;
      case 'size': if (P.on) { P.size = (P.size + 1) % 3; snd.play('ui'); brushPreview(); } break;
      case 'hardness': if (P.on) { P.hard = !P.hard; snd.play('ui'); brushPreview(); } break;
      case 'fill': if (P.on) { P.tool = 'fill'; snd.play('ui'); hint('Tap a body part to fill it', 1500); } break;
      case 'pick': if (P.on) { P.tool = 'pick'; snd.play('ui'); hint('Tap anything to drink its colour', 1500); } break;
      case 'stamp': doStamp(); break;
      case 'undo': if (P.on && v && stage.paints[v].undo(true)) snd.play('undo'); break; // dissolves back (paint.js REVEAL.undo)
      case 'ready': ready(); break;
      case 'next': if (S.phase.name === 'recap') { if (isHost) hostNext(); else link.send('next', {}); snd.play('ui'); } break;
      case 'confirm': if (S.phase.name === 'recap') action('next'); else if (S.phase.name === 'curtain') action('curtain'); else if (S.phase.name === 'lobby') action('start'); break;
      case 'start': if (isHost && S.phase.name === 'lobby') { snd.play('go'); hostStart(); } break;
      // hotseat: the same clocks as two devices (hide time / untimed, countdown, head start, seek time)
      case 'curtain': if (local && S.phase.name === 'curtain') { snd.play('ui'); const d = S.phase.data || {}; if (d.kind === 'hide') enter('hide', { dur: hideMs() }, 0); else enter('seek', seekArgs(pickSeekSpawn()), countdownMs()); } break;
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
    snd.play('good'); act('ready');
    if (isHost) { R.ready.add(v); if (mode() === 'hs' || R.ready.size >= 2) endHide(); else hint('Waiting for the other hider…', 3000); }
    else { R.ready.add(v); link.send('ready', { w: v, strokes: R.strokes[v] }); hint(mode() === 'db' ? 'Waiting for the other hider…' : 'Locking in…', 3000); }
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
      commitSetup(next, k);
      return;
    }
    if (t.dataset.tool) { const tool = t.dataset.tool; if (tool === 'stamp') action('stamp'); else if (tool === 'brush') action('brush'); else action(tool); return; }
    if (t.dataset.size) { P.size = +t.dataset.size; snd.play('ui'); brushPreview(); return; }
    if (t.dataset.hard) { P.hard = t.dataset.hard === '1'; snd.play('ui'); brushPreview(); return; }
    if (t.dataset.pose) { setPose(t.dataset.pose); return; }
    if (t.dataset.wear) {
      if (t.classList.contains('locked')) { hud.pop('LOCKED', 'ink', t.dataset.hint || ''); snd.play('warn'); return; }
      const w = wardrobeFor(); wearPicks[w][t.dataset.wear] = +t.dataset.k; saveWear(wearPicks); S.dataVer++; applyWear(); sendWear(); snd.play('pose'); return;
    }
    if (t.dataset.wfor) { S.wardW = t.dataset.wfor; S.dataVer++; snd.play('ui'); return; }
    if (t.dataset.music) { music = t.dataset.music; try { localStorage.setItem(MUSIC_KEY, music); } catch { /* ignore */ } S.dataVer++; snd.play('ui'); return; }
    if (t.dataset.call) { setCall(t.dataset.call); return; }
    if (t.dataset.emote) { sendEmote(t.dataset.emote, t); return; }
    if (t.dataset.vote) { const r = +t.dataset.vote; if (!local && me) link.send('vote', { w: me, r }); castVote(me || 'a', r); return; }
    if (t.dataset.act) action(t.dataset.act);
  });
  L.on(root, 'pointerdown', () => snd.unlock(), { passive: true });
  /** Host: validate, apply, remember and share a lobby change. */
  function commitSetup(next, k) {
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
  }
  // time sliders (hide / seek): preview the value while dragging, commit on release
  const rangeVal = (r) => { const k = r.dataset.range; const opts = OPTIONS[k]; return opts ? opts[clamp(Math.round(+r.value), 0, opts.length - 1)] : undefined; };
  L.on(root, 'input', (e) => {
    const r = e.target; if (!r || !r.dataset || !r.dataset.range) return;
    const v = rangeVal(r); const out = r.parentElement && r.parentElement.querySelector(`[data-rule="${r.dataset.range}"]`);
    if (out && v !== undefined) out.textContent = fmtRule(r.dataset.range, v);
  });
  L.on(root, 'change', (e) => {
    const r = e.target; if (!r || !r.dataset || !r.dataset.range) return;
    if (!isHost || S.match || r.disabled) return;
    const v = rangeVal(r); if (v === undefined) return;
    commitSetup({ ...S.setup, rules: setRule(S.setup.rules, r.dataset.range, v) }, 'rule');
  });

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
  let lookDir = null; let climbPiv = null; let herePrj = null; let ccAlt = null;
  let camPos = null; let camLook = null; let camWant = null; let lookWant = null; let tvA = null; let qOwn = null; let prj = null; let camR = null; let camF = null;
  const pubSt = {}; for (const f of FIELDS) pubSt[f] = 0;
  const sentSt = {}; for (const f of FIELDS) sentSt[f] = NaN; // what the last publish carried
  /** Presence: full rate (one publish per ≥ 49 ms: net.js's 20/s) while anything changes and for
   *  PUB_HOLD_MS after, so the partner's buffer ends on a still pair (no extrapolated overshoot);
   *  then a keepalive every PUB_KEEPALIVE_MS (it still feeds the partner's 4.5 s stall detection). */
  const PUB_KEEPALIVE_MS = 400; let PUB_HOLD_MS = 250; const PUB_MIN_MS = 49;
  /** A hider's position goes public this long before a head start ends: the seeker's buffer then holds
   *  real samples when the blindfold lifts (covers the adaptive delay's 250 ms cap + a slow trip). */
  const PUB_HUNT_LEAD_MS = 750;
  let pubAt = -1e9; let pubMoveAt = -1e9; let pubEpoch = -1;
  const NETST = { pubs: 0, idle: 0 }; // presence publishes from network() (each one is sent), and keepalives among them
  let lastScaleCheck = 0;
  function initVecs() {
    camPos = new THREE.Vector3(0, 6, 9); camLook = new THREE.Vector3(0, 0.5, 0); camWant = new THREE.Vector3(); lookWant = new THREE.Vector3(); tvA = new THREE.Vector3(); tvZ = new THREE.Vector3(); Y_AXIS = new THREE.Vector3(0, 1, 0); Z_AXIS = new THREE.Vector3(0, 0, 1);
    qOwn = new THREE.Quaternion(); prj = new THREE.Vector3(); camR = [0, 0, 0]; camF = [0, 0, 0];
    lookDir = new THREE.Vector3(); climbPiv = new THREE.Vector3(); herePrj = new THREE.Vector3(); ccAlt = new THREE.Vector3();
    tv3 = new THREE.Vector3(); tv3b = new THREE.Vector3();
  }

  let SW = 1; let SH = 1; // the stage size this frame
  function frame(tms) {
    raf = requestAnimationFrame(frame);
    if (!stage || S.hidden) return;
    if (!camPos) initVecs();
    { const sz0 = stage.size; SW = sz0[0]; SH = sz0[1]; } // one read per frame (the getter allocates)
    const frameMs = tms - lastT;
    let dt = frameMs / 1000; lastT = tms;
    if (!(dt > 0)) dt = 0.016; if (dt > 0.1) dt = 0.1;
    const realDt = dt;
    if (tSec < C.freezeUntil) dt = 0; // freeze-frame
    tSec += realDt;
    const t = now();
    try {
      if (S.queue.length && t >= S.queue[0].at) setPhase(S.queue.shift());
      if (S.phase.name === 'seek' && !R.huntSeen && !S.paused && hunting(t)) onHuntStart();
      // the hider's view (falls back to their eyes as soon as it's not allowed: hunt over, painting)
      if (C.spect !== 'eyes' && (P.on || S.phase.name !== 'seek' || !hunting(t) || local)) C.spect = 'eyes';
      U.spect = C.spect;
      hostTick();
      if (R.tagWindow && S.phase.name !== 'seek') R.tagWindow = null;
      simulate(dt, t);
      network(t);
      animate(dt, t);
      cameras(realDt, t);
      stage.fx.update(dt, tSec);
      if (PFX.fillParts || PFX.stampW || PFX.previewUntil) paintFx();
      camoTick();
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
    // the seeker keeps the blindfold on through the hider's head start (one device too)
    if (ph === 'seek' && mode() === 'hs' && headStartOn() && roleOf(viewer()) === 'seeker') return true;
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
    const hunt = hunting(t);
    const spect = U.spect;
    if (S.boot === 'ready' && v && !fz) {
      const role = roleOf(v);
      if (P.on) mode2 = 'paint';
      else if (ph === 'hide' && (role === 'hider' || role === 'both')) mode2 = 'move';
      else if (ph === 'seek' && role === 'hider' && !hunt) mode2 = 'move'; // head start: still free to move
      else if (ph === 'seek' && (role === 'seeker' || role === 'both')) mode2 = hunt ? 'move' : 'none'; // blindfolded until then
      else if (ph === 'seek' && role === 'hider') mode2 = spect === 'free' ? 'move' : 'look';
    }
    controls.setMode(mode2);
    controls.st.fp = ph === 'seek' && (hunt || roleOf(v) !== 'hider') && spect === 'eyes';
    const ru = rules();
    // the hider's free cam: flies where you look, collides with nothing, clamped to the map
    if (spect === 'free' && v && !fz) {
      controls.move(mv);
      C.fcYaw -= lk[0] * sens; C.fcPitch = clamp(C.fcPitch - lk[1] * sens, -1.45, 1.45);
      const cp = Math.cos(C.fcPitch); const sy = Math.sin(C.fcYaw); const cy = Math.cos(C.fcYaw);
      const sp = FREECAM.speed * (controls.st.sprintHeld ? FREECAM.fast : 1) * dt;
      const rise = controls.rise();
      const px = C.fcX; const py = C.fcY; const pz = C.fcZ;
      C.fcX += (sy * cp * mv[1] - cy * mv[0]) * sp; C.fcY += (Math.sin(C.fcPitch) * mv[1] + rise) * sp; C.fcZ += (cy * cp * mv[1] + sy * mv[0]) * sp;
      clampFree(px, py, pz);
      lk[0] = 0; lk[1] = 0;
    }
    // Jump is read ONCE per frame: it used to be consumed inside the loop, so in hotseat play
    // (both bodies simulated) player a's pass cleared the tap before player b's pass read it and
    // Sydney's Jump button was dead whenever she held the phone. A tap is also buffered for 120 ms.
    const jumpPressed = R.jumpReq; R.jumpReq = false;
    if (jumpPressed) R.jumpAt = tSec;
    const jumpBuffered = tSec - R.jumpAt < JUMP.buffer;
    for (let wi = 0; wi < 2; wi++) {
      const w = PLAYERS[wi];
      if (!controlsOf(w)) continue;
      const b = body[w];
      let vx = 0; let vy = 0; let vz = 0; let jump = false; let mvMag = 0;
      const role = roleOf(w);
      const fp = ph === 'seek' && !(role === 'hider' && !hunt); // a hider's head start is third person
      // the seeker crawling (or zipping): a close over-the-shoulder view with its own absolute yaw
      const climbV = fp && role === 'seeker' && w === v && (b.at || !!b.zip);
      if (w === v) syncClimbView(b, climbV);
      if (w === v && !fz && spect === 'eyes' && (mode2 === 'move' || mode2 === 'look')) {
        controls.move(mv);
        mvMag = Math.min(1, Math.hypot(mv[0], mv[1]));
        if (climbV) {
          C.vYaw = wrapAngle(C.vYaw - lk[0] * sens); b.lookPitch = clamp(b.lookPitch - lk[1] * sens, -1.45, 1.45);
        } else if (fp) {
          // free look: the seeker can look almost straight up and down (ceiling hiders!)
          b.lookYaw -= lk[0] * sens; b.lookPitch = clamp(b.lookPitch - lk[1] * sens, -1.45, 1.45);
          if (role === 'hider') { b.lookYaw = clamp(wrapAngle(b.lookYaw), -1.9, 1.9); b.lookPitch = clamp(b.lookPitch, -1.2, 1.2); }
        } else {
          C.yaw -= lk[0] * sens; C.pitch = clamp(C.pitch + lk[1] * sens * 0.8, -1.05, 1.2);
          if (lk[0] || lk[1]) C.autoUntil = 0;
        }
        if (mode2 === 'move') {
          const sizeMul = 0.85 + 0.15 * b.s;
          let sp = !fp ? SPEED.hide * sizeMul : mode() === 'db' ? dbSpeed(mapTime()) : SPEED.seek * SPEED_MUL[ru.seekSpeed] * ((R.sprint || controls.st.sprintHeld) && role === 'seeker' && !b.at ? sprintMul(mapTime()) : 1);
          if (b.at && fp) sp *= CLIMB_MUL[ru.climbSpeed]; // the seeker on a wall or ceiling
          if (b.sq) sp *= SPEED.squeeze;
          if (b.at && (!fp || climbV)) {
            // sticky feet: screen-relative input mapped onto the surface
            stage.camera.updateMatrixWorld();
            stage.camera.getWorldDirection(tvA); camF[0] = tvA.x; camF[1] = tvA.y; camF[2] = tvA.z;
            if (climbV) { camR[0] = -Math.cos(C.vYaw); camR[1] = 0; camR[2] = Math.sin(C.vYaw); } else { camR[0] = Math.cos(C.yaw); camR[1] = 0; camR[2] = -Math.sin(C.yaw); }
            inputOnSurface(b, mv[0], mv[1], projOut, camF, camR, surfV);
            const csp = sp * SPEED.crawl;
            vx = surfV[0] * csp; vy = surfV[1] * csp; vz = surfV[2] * csp;
          } else {
            let fx; let fzv; let rx; let rz;
            if (fp) { const yaw = b.yaw + b.lookYaw; fx = Math.sin(yaw); fzv = Math.cos(yaw); rx = -Math.cos(yaw); rz = Math.sin(yaw); }
            else { fx = -Math.sin(C.yaw); fzv = -Math.cos(C.yaw); rx = Math.cos(C.yaw); rz = -Math.sin(C.yaw); }
            vx = (fx * mv[1] + rx * mv[0]) * sp; vz = (fzv * mv[1] + rz * mv[0]) * sp;
          }
          jump = (jumpBuffered || controls.st.jumpHeld) && !(ph === 'seek' && mode() === 'db');
          if (fp && !climbV) {
            // first person: body yaw follows the view; keep lookYaw small
            b.yaw = wrapAngle(b.yaw + b.lookYaw); b.lookYaw = 0;
          }
        }
      }
      // tongue-zip in flight
      if (b.zip) { zipStep(w, b); b.speed = 4; b.svx = 0; b.svz = 0; recordHist(w, b, t); continue; }
      // scurry dash overrides
      let dashing = false;
      if (R.scurry && w === v) {
        const sc = R.scurry;
        if (tSec < sc.until) {
          vx = sc.vx; vy = sc.vy; vz = sc.vz; dashing = true;
          // jammed against something: refund the escape, no trail, no tell
          if (tSec - sc.t0 > 0.2 && Math.hypot(b.x - sc.x0, b.z - sc.z0) < 0.15) {
            R.scurry = null; dashing = false; vx = 0; vz = 0;
            R.escapes[w]++; R.trailUntil[w] = 0; R.escapeAt = 0;
            hint('Boxed in — escape refunded', 1400); snd.play('warn');
          }
        } else R.scurry = null;
      }
      const moving = vx * vx + vy * vy + vz * vz > 0.01;
      if (b.at) {
        if (fp && !climbV && role !== 'seeker' && moving && !R.scurry) {
          // hunting in first person (Double Blind) while stuck somewhere: drop off first
          unstick(w);
        } else {
          if (jump && (jumpBuffered || controls.st.jumpHeld) && !b.lockY) {
            R.jumpAt = -1e9;
            unstick(w, { jump: true });
            b.speed = 0; b.svx = 0; b.svz = 0; recordHist(w, b, t);
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
          b.svx = 0; b.svz = 0;
          recordHist(w, b, t);
          continue;
        }
      }
      if (moving && b.pose !== 'stand' && b.pose !== 'crouch' && b.pose !== 'squeeze') { setPoseFor(w, 'stand'); }
      const sp2 = b.pose === 'crouch' ? 0.55 : 1;
      // acceleration: the stick is a target velocity; the body eases toward it (a dash is instant)
      const ev = accelStep(b, vx * sp2, vz * sp2, moving, dt, dashing);
      if (ev === 1) stage.av[w].squash(0.22); // a tiny settle on stop
      else if (ev === 2) stage.fx.pop(b.x, b.y + 0.01, b.z, 0, 1, 0, '#ffffff', 0.08 * b.s + 0.06, tSec); // a puff of dust on a hard reversal
      const tx = b.svx; const tz = b.svz;
      // coyote time: a tap just after walking off a ledge still jumps (not after a jump)
      if (b.onGround) b.groundT = tSec;
      const coyote = coyoteJump(b, jump, tSec);
      let landed = false;
      const px = b.x; const pz = b.z;
      const nSub = Math.max(1, Math.ceil(dt / 0.025));
      const vy0 = b.vy;
      for (let k = 0; k < nSub; k++) landed = freeStep(world, b, tx, tz, dt / nSub, jump && !b.sq && !coyote && k === 0) || landed;
      if ((jump && b.vy > 3 && vy0 <= 0.5 && !b.at) || coyote) { snd.play('jump'); b.jumpT = tSec; b.jumpHeld = controls.st.jumpHeld; R.jumpAt = -1e9; }
      // variable height: a held key released early makes a short hop (touch taps always jump full)
      else shortHop(b, controls.st.jumpHeld);
      if (landed) { snd.play('land'); stage.av[w].squash(0.3); }
      // walk into a wall holding forward → the feet stick (hider hiding, or a climbing seeker, who
      // has to lean on it a little longer so brushing past walls while hunting doesn't grab them)
      if (moving && ru.climb && !b.sq && w === v && canMoveSelf(w) && mvMag > 0.6) {
        const want = Math.hypot(tx, tz) * dt; const got = Math.hypot(b.x - px, b.z - pz);
        if (got < want * 0.35 && want > 0.001) {
          const sp = Math.hypot(vx, vz) || 1; const dx = vx / sp; const dz = vz / sp;
          const H = world.raycast(b.x, b.y + Math.min(b.head * 0.5, 0.2), b.z, dx, 0, dz, b.r + 0.12, (bx) => bx.maxY - bx.minY > 0.25, false);
          if (H && H.box && H.box.climb !== false && H.nx * dx + H.nz * dz < -0.7 && world.inside(H.x, H.z)) {
            b.pushT += dt;
            if (b.pushT > (role === 'seeker' ? 0.45 : 0.22)) { b.pushT = 0; attachTo(w, H.x, H.y, H.z, H.nx, 0, H.nz, H.box, 0, 1, 0); }
          } else b.pushT = 0;
        } else b.pushT = 0;
      } else b.pushT = 0;
      if (moving) {
        const want = Math.atan2(vx, vz);
        if (!(fp && w === v)) b.yaw = dampAngle(b.yaw, want, 12, dt);
        P.texelDirtyAt = tSec + 0.2;
        b.stillT = 0;
      } else if (b.onGround) {
        // standing still on something thin: perch on it, tail curled round
        b.stillT += dt;
        if (b.stillT > 0.35 && b.pose === 'stand' && ru.climb && world.groundRes && stage.world.groundAt(b.x, b.z, b.r * 0.6, b.y + 0.02) === b.y && stage.world.groundRes.box && stage.world.groundRes.box.perch && w === v && canMoveSelf(w)) {
          setPoseFor(w, 'perch'); hintOnce('perch', 'Perched! Tail curled round the rail.', 2000);
        }
      }
      b.fx = Math.sin(b.yaw); b.fy = 0; b.fz = Math.cos(b.yaw);
      b.speed = Math.hypot(tx, tz);
      if (b.speed > 0.05) P.texelDirtyAt = tSec + 0.2;
      recordHist(w, b, t);
    }
    if (P.on && P.texelDirtyAt && tSec > P.texelDirtyAt) refreshTexels();
  }
  /** The seeker's view switches between first person (free) and a close over-the-shoulder view
   *  (stuck to a surface or zipping): carry the view direction across so it never jumps. */
  function syncClimbView(b, on) {
    if (on === C.climbV) return;
    if (on) { C.vYaw = wrapAngle(b.yaw + b.lookYaw); b.lookYaw = 0; }
    else { b.yaw = C.vYaw; b.lookYaw = 0; b.fx = Math.sin(b.yaw); b.fy = 0; b.fz = Math.cos(b.yaw); }
    C.climbV = on;
  }
  /** History for tag confirmation (the victim checks the shooter's view against its true path). */
  function recordHist(w, b, t) {
    if (!(w === me || local)) return;
    hist.t[hist.i] = t; hist.x[hist.i] = b.x; hist.y[hist.i] = b.y; hist.z[hist.i] = b.z;
    hist.i = (hist.i + 1) % hist.t.length; if (hist.n < hist.t.length) hist.n++;
  }
  function setPoseFor(w, name) { const b = body[w]; b.pose = name; b.wallN = null; stage.av[w].setPose(name); stage.av[w].st.wallN = null; }

  /** Has the presence state moved off what was last sent? (1 mm, ~0.2°, 0.02 m/s; q / pose / flags exact) */
  function pubDiffers() {
    const a = pubSt; const o = sentSt;
    return !(Math.abs(a.x - o.x) < 0.001 && Math.abs(a.y - o.y) < 0.001 && Math.abs(a.z - o.z) < 0.001 &&
      Math.abs(a.yaw - o.yaw) < 0.004 && Math.abs(a.ly - o.ly) < 0.004 && Math.abs(a.lp - o.lp) < 0.004 && Math.abs(a.wa - o.wa) < 0.004 &&
      Math.abs(a.sp - o.sp) < 0.02 && a.q === o.q && a.po === o.po && a.v === o.v && a.at === o.at);
  }
  function network(t) {
    if (local) return;
    const b = body[me];
    const ph = S.phase.name; const role = roleOf(me);
    // where a hider is stays private while hiding, and during a head start until just before the
    // blindfold comes off (so the seeker's buffer holds real positions when the hunt starts)
    const hiding = (ph === 'hide' && (role === 'hider' || role === 'both')) || (ph === 'seek' && role === 'hider' && t < huntAt() - PUB_HUNT_LEAD_MS);
    pubSt.x = hiding ? 0 : b.x; pubSt.y = hiding ? 0 : b.y; pubSt.z = hiding ? 0 : b.z;
    pubSt.yaw = hiding ? 0 : b.yaw; pubSt.po = hiding ? 0 : POSES.indexOf(b.pose);
    // a climbing seeker looks with its own view yaw: publish it relative to the body (yaw + ly = view)
    pubSt.ly = C.climbV && role === 'seeker' ? wrapAngle(C.vYaw - b.yaw) : b.lookYaw; pubSt.lp = b.lookPitch; pubSt.v = hiding ? 0 : 1; pubSt.wa = b.wa; pubSt.sp = b.speed;
    if (hiding) { pubSt.q = Q_ID; pubSt.at = 0; pubSt.ly = 0; pubSt.lp = 0; pubSt.wa = 0; pubSt.sp = 0; }
    else {
      bodyQuat(b, qTmp);
      // quantise, and only re-pack when it changed (keeps publish allocation-free and stable)
      const qq = packQuat(qTmp[0], qTmp[1], qTmp[2], qTmp[3]);
      pubSt.q = qq; pubSt.at = b.at ? 1 : 0;
    }
    // a state that doesn't change goes out as a ~2.5/s keepalive instead of 20/s: the hider's
    // private "nobody here" (v: 0, zeros) all through the hide phase, a still hider all hunt, a
    // blindfolded seeker, both players in the lobby. Moving, looking round, a pose: full rate at once
    // (the first changed sample leaves the same frame), plus PUB_HOLD_MS after the last change
    if (S.boot === 'ready' && link.ready) {
      const tp = performance.now();
      if (tp - pubAt >= PUB_MIN_MS || tp < pubAt) {
        if (pubEpoch !== link.epoch || pubDiffers()) { pubMoveAt = tp; pubEpoch = link.epoch; } // a fresh link starts at full rate
        const idle = tp - pubMoveAt > PUB_HOLD_MS;
        if (!idle || tp - pubAt >= PUB_KEEPALIVE_MS || tp < pubAt) {
          link.publish(pubSt);
          for (let i = 0; i < FIELDS.length; i++) sentSt[FIELDS[i]] = pubSt[FIELDS[i]];
          pubAt = tp; NETST.pubs++; if (idle) NETST.idle++;
        }
      }
    }
    livePaint(t);
    if (R.actQ && t - R.actAt > 2500 && link.ready) { link.send('act', R.actQ); R.actAt = t; R.actQ = null; }
    // silence detection (host pauses on a stalled link)
    if (isHost && S.match && api.partnerHere) {
      if (link.silence > 4500) addPause('stall');
      else if (S.pauseReasons.has('stall') && link.silence < 800) removePause('stall');
    }
  }

  function animate(dt, t) {
    const ph = S.phase.name;
    const v = viewer();
    for (let wi = 0; wi < 2; wi++) {
      const w = PLAYERS[wi];
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
        if (ph === 'seek' && w === v && (roleOf(w) === 'seeker' || roleOf(w) === 'both') && !frozenView() && (!C.climbV || C.climbNear)) vis = false; // my own body in first person (shown while climbing: over the shoulder, unless the camera is jammed against it)
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
      // first-person hider: hide my own head (not while painting, spectating or in a head start)
      a.setHeadVisible(!(ph === 'seek' && w === v && roleOf(w) !== 'seeker' && !P.on && U.spect === 'eyes' && (roleOf(w) !== 'hider' || hunting(t))));
      // the reveal: outline the hider during found / time / recap
      const revealed = (ph === 'found' || ph === 'time' || ph === 'recap' || ph === 'final') && R.rec && w === recapTarget() && tSec >= C.freezeUntil;
      if (revealed !== !!a.revealOn) { a.revealOn = revealed; a.setReveal(revealed ? theme.hl : null, 0.016); }
      // glint
      a.st.glintUntil = (t >= R.glintAt[w] && t < R.glintAt[w] + GLINT_MS) ? tSec + 0.05 : 0;
      a.update(dt, tSec);
      // footsteps on the walk cycle's zero crossings: my own are quiet, the partner's are shaped by
      // distance (a hider hears the seeker coming from 9 m, not just the 3 m heartbeat)
      if (S.match && (ph === 'hide' || ph === 'seek') && a.st.walk > 0.3 && (vis || w === v)) {
        const k = Math.floor(a.st.walkPhase / Math.PI);
        if (k !== a.stepK) {
          a.stepK = k;
          let vol = 0.08;
          if (w !== v) { const o = stage.av[v || 'a'].root.position; const d = Math.hypot(rt.position.x - o.x, rt.position.y - o.y, rt.position.z - o.z); vol = 0.14 * clamp(1 - d / 9, 0, 1); }
          const at = controlsOf(w) ? body[w].at : rem.at > 0.5;
          snd.step(vol, a.st.speed > 4.2 ? 0.8 : 1, !!at);
        }
      } else a.stepK = Math.floor(a.st.walkPhase / Math.PI);
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
      if (upTmp[1] < -0.5) { op = 0.2 * Math.max(0, 1 - hgt / 4.5); s = sz * (0.9 + hgt * 0.25); }
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
    for (let wi = 0; wi < 2; wi++) {
      const w = PLAYERS[wi];
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
      for (let wi = 0; wi < 2; wi++) {
        const w = PLAYERS[wi];
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
    // "Paint while hunted: Shows": fresh paint twinkles for the seeker (range + line of sight checked on arrival)
    if (R.tell && tSec < R.tell.until && ph === 'seek') {
      const k = 1 - (R.tell.until - tSec) / TELL.secs; const pts = R.tell.pts; const sz = Math.max(1, stage.av[mode() === 'hs' ? hiderOf(S.phase.round) : 'a'].st.size) * 1.25;
      for (let i = 0; i < pts.length && gi < G.length; i += 3) {
        const sp = G[gi++];
        sp.position.set(pts[i], pts[i + 1], pts[i + 2]); sp.visible = true;
        const tw = Math.sin((k * 3 + i * 0.37) * Math.PI); sp.scale.setScalar((0.07 + 0.16 * tw * tw) * (1 - k * 0.5) * sz);
        sp.material.rotation = k * 4;
      }
    } else if (R.tell) R.tell = null;
    // trails (scurry)
    for (let wi = 0; wi < 2; wi++) {
      const w = PLAYERS[wi];
      if (t < R.trailUntil[w] && tSec > R.trailNext) {
        R.trailNext = tSec + 0.06;
        const p = stage.av[w].root.position;
        if (stage.av[w].root.visible || w === me) stage.fx.trailDot(p.x, p.y, p.z, tSec, 2);
      }
    }
    // the hider peeks through their own eyes; a heartbeat when the seeker gets close
    const hunted = ph === 'seek' && v && roleOf(v) === 'hider' && !local && hunting(t);
    const peeking = hunted && U.spect === 'eyes' && !P.on;
    if (peeking !== !!C.peek) { C.peek = peeking; root.classList.toggle('peek', peeking); }
    if (hunted && !frozen()) {
      const sk = other(v); const ps = stage.av[sk].root.position; const pm = stage.av[v].root.position;
      const d = Math.hypot(ps.x - pm.x, ps.y - pm.y, ps.z - pm.z); // 3-D: a seeker in the hall below the landing is not 'close'
      if (rules().heartbeat && d < 3 && tSec > (C.beatAt || 0)) { C.beatAt = tSec + 0.45 + d * 0.28; snd.play('beat'); root.classList.remove('beat'); void root.offsetWidth; root.classList.add('beat'); }
    }
    // seek stats: closest call, walk-pasts, seeker path (the hunt only, not a head start)
    if (ph === 'seek' && S.match && hunting(t)) {
      const hd = mode() === 'hs' ? hiderOf(S.phase.round) : other(v || 'a');
      const sk = other(hd);
      const ps = stage.av[sk].root.position; const phd = stage.av[hd].root.position;
      const sz = stage.av[hd].st.size;
      const d = Math.hypot(ps.x - phd.x, ps.y - phd.y, ps.z - phd.z); // 3-D (a ceiling hider 2.2 m up is not a 0.1 m closest call)
      R.nearD = d;
      if (d < R.closest) R.closest = d;
      // a walk-past needs line of sight within 1.5 m (one collider ray, ≤ 7/s while that close)
      if (!R.near && d < 1.5 && tSec > R.losNext) {
        R.losNext = tSec + 0.15;
        const ex = ps.x; const ey = ps.y + 0.4; const ez = ps.z; const ddx = phd.x - ex; const ddy = phd.y + 0.2 * sz - ey; const ddz = phd.z - ez; const L = Math.hypot(ddx, ddy, ddz) || 1;
        if (!stage.world.raycast(ex, ey, ez, ddx / L, ddy / L, ddz / L, Math.max(0, L - 0.15), null, true)) { R.near = true; R.passes++; if (phd.y - ps.y > 1.2) R.under = true; }
      }
      if (R.near && d > 2.0) R.near = false;
      // "in their sights": the seeker's view ray passes within 0.45 × size of the hider's body centre with a
      // clear line of sight (both phones know both positions; the cue plays only for the hunted hider)
      if (rules().sights && mode() === 'hs' && tSec > R.stareAt + 1) {
        const skB = controlsOf(sk) ? body[sk] : null;
        const yaw = skB ? (C.climbV && v === sk ? C.vYaw : skB.yaw + skB.lookYaw) : rem.yaw + rem.ly; const pit = skB ? skB.lookPitch : rem.lp;
        const cp = Math.cos(pit); const dx = Math.sin(yaw) * cp; const dy = Math.sin(pit); const dz = Math.cos(yaw) * cp;
        const ex = ps.x; const ey = ps.y + 0.42 * stage.av[sk].st.size; const ez = ps.z;
        const hx = phd.x - ex; const hy = phd.y + 0.25 * sz - ey; const hz = phd.z - ez;
        const along = hx * dx + hy * dy + hz * dz;
        if (along > 0.3 && along < 9) {
          const off = Math.sqrt(Math.max(0, hx * hx + hy * hy + hz * hz - along * along));
          if (off < 0.45 * sz) {
            const L = Math.hypot(hx, hy, hz) || 1;
            if (!stage.world.raycast(ex, ey, ez, hx / L, hy / L, hz / L, Math.max(0, L - 0.2), null, true)) {
              R.stared++; R.stareAt = tSec;
              if (v === hd && !local && U.spect === 'eyes' && !P.on) { root.classList.remove('sights'); void root.offsetWidth; root.classList.add('sights'); snd.play('warn'); }
            }
          }
        }
      }
      if (tSec > R.pathNext && R.path.length < 260) { R.pathNext = tSec + 0.3; R.path.push([ps.x, Math.max(0, ps.y), ps.z]); }
    }
    void wallTmp;
  }
  const wallArr = { a: [0, 0, 0], b: [0, 0, 0] };
  function wallTmp(w, wa) { const a = wallArr[w]; a[0] = Math.sin(wa); a[1] = 0; a[2] = Math.cos(wa); return a; }
  const upTmp = [0, 1, 0];
  const snapOrient = { a: true, b: true };
  /** Seconds a view switch (eyes / watch / free) takes to whip the camera across. */
  const VIEW_WHIP_S = 0.35;
  let Y_AXIS = null; let Z_AXIS = null;
  function useHint() { rem.x = remHint.x; rem.y = remHint.y; rem.z = remHint.z; rem.yaw = remHint.yaw; rem.po = remHint.po; rem.wa = remHint.wa; rem.v = 1; rem.q = remHint.q; rem.at = remHint.at; unpackQuat(remHint.q, qTmp); rem.qx = qTmp[0]; rem.qy = qTmp[1]; rem.qz = qTmp[2]; rem.qw = qTmp[3]; }
  /** Yaw of a root's forward vector projected on the floor. */
  function headingTmpYaw(rt) { const q = rt.quaternion; const fx = 2 * (q.x * q.z + q.w * q.y); const fz = 1 - 2 * (q.x * q.x + q.y * q.y); return Math.hypot(fx, fz) > 0.2 ? Math.atan2(fx, fz) : 0; }

  function cameras(dt, t) {
    const cam = stage.camera;
    const ph = S.phase.name; const v = viewer();
    const role = v ? roleOf(v) : null;
    let snap = false; let overview = false; let climbCam = false;
    let rate = 10;
    C.frameCard = false;
    stage.vm.visible = false;
    if (S.boot !== 'ready') return;
    if ((!S.match || ph === 'lobby') && !S.pendingTitle) {
      // frame both chameleons in the part of the screen the lobby card leaves free
      C.orbit += dt;
      const sw = Math.sin(C.orbit * 0.16) * 0.55;
      const sz = sizeS();
      const cx = (body.a.x + body.b.x) / 2; const cz = (body.a.z + body.b.z) / 2; const cy = (body.a.y + body.b.y) / 2 + 0.25 * sz;
      const dist = (SW < SH ? 2.25 : 2.0) * (0.45 + 0.55 * sz);
      camWant.set(cx + Math.sin(sw) * dist, cy + 0.75, cz + Math.cos(sw) * dist);
      revC.x = cx; revC.y = cy; revC.z = cz;
      aimFramed(revC, true);
      rate = 3;
    } else if ((S.pendingTitle && ph !== 'hide') || (ph === 'final' && !R.rec)) {
      C.orbit += dt * 0.12; overview = true;
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
    } else if (ph === 'seek' && v && U.spect === 'free') {
      // the hider's free cam (simulate() flies it)
      const cp = Math.cos(C.fcPitch);
      camWant.set(C.fcX, C.fcY, C.fcZ);
      lookWant.set(C.fcX + Math.sin(C.fcYaw) * cp, C.fcY + Math.sin(C.fcPitch), C.fcZ + Math.cos(C.fcYaw) * cp);
      snap = true;
    } else if (ph === 'seek' && v && U.spect === 'watch') {
      // watch the seeker: over their shoulder, looking where they look (from their presence)
      const sk = other(v); const ra = stage.av[sk].root; const q = ra.quaternion; const s2 = stage.av[sk].st.size;
      const yaw = rem.yaw + rem.ly; const cp = Math.cos(rem.lp);
      tvA.set(Math.sin(yaw) * cp, Math.sin(rem.lp), Math.cos(yaw) * cp);
      const ux = 2 * (q.x * q.y - q.w * q.z); const uy = 1 - 2 * (q.x * q.x + q.z * q.z); const uz = 2 * (q.y * q.z + q.w * q.x);
      revC.x = ra.position.x + ux * 0.4 * s2; revC.y = ra.position.y + uy * 0.4 * s2 + 0.12 * s2; revC.z = ra.position.z + uz * 0.4 * s2;
      const tall = SW < SH;
      const dist = (tall ? 2.3 : 1.8) * (0.6 + 0.4 * s2); const side = (tall ? 0.1 : 0.3) * s2;
      camWant.set(revC.x - tvA.x * dist - Math.cos(yaw) * side, revC.y - tvA.y * dist + 0.38 * s2, revC.z - tvA.z * dist + Math.sin(yaw) * side);
      clampCam(revC, camWant);
      floorCam(camWant);
      lookWant.set(revC.x + tvA.x * 2.5, revC.y + tvA.y * 2.5, revC.z + tvA.z * 2.5);
      rate = 9;
    } else if (ph === 'seek' && v && role === 'seeker' && C.climbV) {
      // the seeker on a wall / ceiling (or zipping): close over-the-shoulder, aim = screen centre
      climbCamWant(body[v], C.vYaw, body[v].lookPitch, camWant, lookDir);
      lookWant.copy(camWant).add(lookDir);
      climbCam = true; rate = 14;
    } else if (ph === 'seek' && v && (role === 'seeker' || role === 'both' || (role === 'hider' && !local && hunting(t)))) {
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
        stage.vm.visible = SW > SH * 1.1;
        stage.vm.position.set(0.2, -0.16 + Math.sin(tSec * 8) * 0.004 * Math.min(1, b.speed), -0.42 + C.shake * 0.3);
      }
      snap = true;
    } else if (v && (ph === 'hide' || ph === 'lock' || (ph === 'seek' && role === 'hider'))) {
      // hiding (and a hider's head start): third-person orbit
      const b = body[v];
      bodyCentre(v, lookWant);
      lookWant.y += (b.at ? 0.05 : 0.14) * b.s;
      // a stick / let-go jumps the body centre (feet → contact) by ~0.3 m: ease the look target at rate 6
      // for 0.4 s instead of following it (the player's chosen pitch is left alone)
      if (!!b.at !== C.lkAt) { C.lkAt = !!b.at; C.lkUntil = tSec + 0.4; }
      if (tSec < C.lkUntil && Math.abs(lookWant.x - C.lkX) + Math.abs(lookWant.y - C.lkY) + Math.abs(lookWant.z - C.lkZ) < 1.2) {
        const k = 1 - Math.exp(-6 * dt);
        C.lkX += (lookWant.x - C.lkX) * k; C.lkY += (lookWant.y - C.lkY) * k; C.lkZ += (lookWant.z - C.lkZ) * k;
        lookWant.set(C.lkX, C.lkY, C.lkZ);
      } else { C.lkX = lookWant.x; C.lkY = lookWant.y; C.lkZ = lookWant.z; }
      // under a ceiling the camera eases below the body (world-up always: no rolling horizon)
      if (C.autoUntil > tSec) C.pitch += (C.autoPitch - C.pitch) * (1 - Math.exp(-5 * dt));
      else if (!b.at && C.pitch < 0.05) C.pitch += (0.32 - C.pitch) * (1 - Math.exp(-2.5 * dt));
      const dist = C.dist * (0.55 + 0.45 * b.s);
      const cp = Math.cos(C.pitch);
      camWant.set(lookWant.x + Math.sin(C.yaw) * cp * dist, lookWant.y + Math.sin(C.pitch) * dist, lookWant.z + Math.cos(C.yaw) * cp * dist);
      // stuck to a wall or ceiling: keep the camera in front of that surface (orbiting "behind
      // the wall" used to jam it into the body, which then vanished from view)
      if (b.at) {
        let ux = camWant.x - lookWant.x; let uy = camWant.y - lookWant.y; let uz = camWant.z - lookWant.z;
        const k = ux * b.nx + uy * b.ny + uz * b.nz; const lim = 0.3 * dist;
        if (k < lim) {
          ux += b.nx * (lim - k); uy += b.ny * (lim - k); uz += b.nz * (lim - k);
          const l = Math.hypot(ux, uy, uz) || 1;
          camWant.set(lookWant.x + ux / l * dist, lookWant.y + uy / l * dist, lookWant.z + uz / l * dist);
        }
      }
      clampCam(lookWant, camWant);
      floorCam(camWant);
      rate = 12;
    } else {
      // seeker waiting in local mode, or anything else: gentle overview
      C.orbit += dt * 0.1; overview = true;
      const ov = stage.map.overview;
      camWant.set(Math.sin(C.orbit) * ov.radius * 0.92, ov.y * 0.96, Math.cos(C.orbit) * ov.radius * 0.92);
      lookWant.set(0, 0.2, 0);
      rate = 3;
    }
    stage.setView(overview ? 'overview' : 'play');
    C.shake = Math.max(0, C.shake - dt);
    if (C.override) { camWant.fromArray(C.override, 0); lookWant.fromArray(C.override, 3); snap = true; C.frameCard = false; }
    // a view switch (eyes / watch / free): start from wherever the camera was and ease the
    // difference out over VIEW_WHIP_S (smoothstep), riding on the new view's own motion. The aim
    // turns by angle (yaw / pitch from the old view direction), not by sliding the look point:
    // eyes → watch often faces the opposite way, and a lerped look point passes right by the
    // camera there (the view flipped in one frame near the end of the whip)
    if (C.vsPend) {
      C.vsPend = false;
      C.vsOx = camPos.x - camWant.x; C.vsOy = camPos.y - camWant.y; C.vsOz = camPos.z - camWant.z;
      C.vsStep = Math.hypot(C.vsOx, C.vsOy, C.vsOz);
      const dx = camLook.x - camPos.x; const dy = camLook.y - camPos.y; const dz = camLook.z - camPos.z;
      C.vsLx = Math.atan2(dx, dz); C.vsLy = Math.atan2(dy, Math.hypot(dx, dz)); // the old aim: yaw, pitch
      const nx = lookWant.x - camWant.x; const ny = lookWant.y - camWant.y; const nz = lookWant.z - camWant.z;
      C.vsLz = Math.abs(wrapAngle(Math.atan2(nx, nz) - C.vsLx)) + Math.abs(Math.atan2(ny, Math.hypot(nx, nz)) - C.vsLy); // how far the aim turns
    }
    const vu = C.override ? 1 : (tSec - C.vsAt) / VIEW_WHIP_S;
    if (vu < 1 && (C.vsStep > 0.02 || C.vsLz > 0.05) && C.vsStep < 12) {
      const e = 1 - vu * vu * (3 - 2 * vu);
      camPos.set(camWant.x + C.vsOx * e, camWant.y + C.vsOy * e, camWant.z + C.vsOz * e);
      const nx = lookWant.x - camWant.x; const ny = lookWant.y - camWant.y; const nz = lookWant.z - camWant.z;
      const yaw1 = Math.atan2(nx, nz); const h1 = Math.hypot(nx, nz); const pit1 = Math.atan2(ny, h1);
      const yaw = yaw1 + wrapAngle(C.vsLx - yaw1) * e; const pit = pit1 + (C.vsLy - pit1) * e; const cp = Math.cos(pit);
      camLook.set(camPos.x + Math.sin(yaw) * cp, camPos.y + Math.sin(pit), camPos.z + Math.cos(yaw) * cp);
    } else if (snap) { camPos.copy(camWant); camLook.copy(lookWant); }
    else if (rate > 0) {
      const k = 1 - Math.exp(-rate * dt);
      camPos.lerp(camWant, k); camLook.lerp(lookWant, k);
    }
    // the climb view eases its position but aims exactly where the stick says (no aim lag)
    if (climbCam) camLook.copy(camPos).add(lookDir);
    cam.position.copy(camPos);
    cam.lookAt(camLook);
    applyFraming();
    if (C.shake > 0) { cam.rotation.x += (Math.random() - 0.5) * C.shake * 0.05; }
    void t;
  }
  const revC = { x: 0, y: 0, z: 0 };
  /** Where the seeker's climb camera wants to be for view (yaw, pitch): behind and over the right
   *  shoulder of the body, kept in front of the surface it's on and out of walls. dir = view dir. */
  function climbCamWant(b, yaw, pitch, out, dir) {
    const cp = Math.cos(pitch); const s2 = b.s;
    dir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
    bodyCentre(viewer(), climbPiv); climbPiv.y += 0.1 * s2;
    // a phone held upright sees a narrow slice sideways: sit further back, less to the side, a little higher
    const tall = SW < SH;
    const dist = (tall ? 2.0 : 1.55) * (0.55 + 0.45 * s2); const side = (tall ? 0.12 : 0.32) * s2; const lift = (tall ? 0.3 : 0.18) * s2;
    let ux = -dir.x * dist - Math.cos(yaw) * side; let uy = -dir.y * dist + lift; let uz = -dir.z * dist + Math.sin(yaw) * side;
    const L = Math.hypot(ux, uy, uz) || dist;
    if (b.at) {
      // keep well out of the wall plane (0.3 × dist let the camera sit almost in it, looking along the wall)
      const k = ux * b.nx + uy * b.ny + uz * b.nz; const lim = 0.55 * dist;
      if (k < lim) {
        ux += b.nx * (lim - k); uy += b.ny * (lim - k); uz += b.nz * (lim - k);
        const l = Math.hypot(ux, uy, uz) || 1;
        ux = ux / l * L; uy = uy / l * L; uz = uz / l * L;
      }
    }
    out.set(climbPiv.x + ux, climbPiv.y + uy, climbPiv.z + uz);
    clampCam(climbPiv, out);
    // pulled in hard (a corner, low furniture): slide round the wall's tangent to whichever side is clearer
    if (b.at && out.distanceTo(climbPiv) < 0.6 * L) {
      let tx = -b.nz; let ty = 0; let tz = b.nx; // horizontal tangent on a wall
      if (Math.abs(b.ny) > 0.7) { tx = -Math.cos(yaw); ty = 0; tz = Math.sin(yaw); } // on a ceiling / top: the view's right
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      let best = out.distanceTo(climbPiv); let bx = out.x; let by = out.y; let bz = out.z;
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const ax = b.nx * 0.62 + tx * sgn * 0.7; const ay = b.ny * 0.62 + 0.3 * (1 - Math.abs(b.ny)) + ty; const az = b.nz * 0.62 + tz * sgn * 0.7;
        const al = Math.hypot(ax, ay, az) || 1;
        ccAlt.set(climbPiv.x + ax / al * L, climbPiv.y + ay / al * L, climbPiv.z + az / al * L);
        clampCam(climbPiv, ccAlt);
        const dd = ccAlt.distanceTo(climbPiv);
        if (dd > best + 0.05) { best = dd; bx = ccAlt.x; by = ccAlt.y; bz = ccAlt.z; }
      }
      out.set(bx, by, bz);
    }
    floorCam(out);
    // squeezed in, or the body sits on the line of fire: hide it so the crosshair always sees past it
    const cx = climbPiv.x - out.x; const cy = climbPiv.y - out.y; const cz = climbPiv.z - out.z;
    const along = cx * dir.x + cy * dir.y + cz * dir.z;
    const off = Math.sqrt(Math.max(0, cx * cx + cy * cy + cz * cz - along * along));
    C.climbNear = Math.hypot(cx, cy, cz) < 0.8 * s2 || (along > 0 && off < 0.42 * s2);
    return out;
  }
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
      const H = SH;
      oy = Math.round(H / 2 - (C.frameY || H / 2));
    }
    C.oy = C.oy == null ? oy : C.oy + (oy - C.oy) * 0.2;
    if (Math.abs(C.oy) < 0.5) { if (cam.view && cam.view.enabled) cam.clearViewOffset(); }
    else cam.setViewOffset(SW, SH, 0, C.oy, SW, SH);
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
  // invisible guards (climb:false) never push the camera; thin low props are looked over
  const CAM_FILTER = (b) => b.climb !== false && (b.maxY - b.minY > 0.5 || b.minY > 0.6);
  function clampCam(target, want) {
    const dx = want.x - target.x; const dy = want.y - target.y; const dz = want.z - target.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const h = stage.world.raycast(target.x, target.y, target.z, dx / d, dy / d, dz / d, d, CAM_FILTER);
    if (h && h.t < d) { const k = Math.max(0.25, h.t - 0.18) / d; want.x = target.x + dx * k; want.y = target.y + dy * k; want.z = target.z + dz * k; }
  }

  // ── HUD per frame (allocation-free: stable descriptors, precomputed labels) ──
  const showParts = { top: false, sub: false, gear: false, cross: false, poses: false, tools: false, acts: false, joyhint: false, legend: false, mini: false };
  const FIRE_L = Array.from({ length: 11 }, (_, i) => `Fire ${i}`);
  const SCURRY_L = ['Scurry', 'Scurry', 'Scurry 2', 'Scurry 3'];
  const SCAN_L = Array.from({ length: 31 }, (_, i) => (i ? `${i}s` : 'Scan'));
  const PHASE_L = { hide: 'Hide', lock: 'Get ready', seek: 'Seek', found: 'Found', time: 'Time', recap: 'Recap', curtain: 'Pass', final: '', lobby: '', head: 'Head start', untimed: 'No limit' };
  const GRACE_L = Array.from({ length: 16 }, (_, i) => `Wait ${i}`);
  const BADGE = { watch: `Watching ${api.name('a')}`, free: 'Free cam', watchB: `Watching ${api.name('b')}` };
  const ROLE_L = { youHide: 'You hide', youSeek: 'You seek', hunt: 'Hunt!', hideBoth: 'Hide!', hides: { a: `${api.name('a')} hides`, b: `${api.name('b')} hides` }, seeks: { a: `${api.name('a')} seeks`, b: `${api.name('b')} seeks` } };
  const LEGEND = {
    hide: ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Mouse</kbd> look', '<kbd>E</kbd> stick · <kbd>Z</kbd> tongue-zip · <kbd>Space</kbd> jump', '<kbd>1</kbd>–<kbd>9</kbd> pose · <kbd>P</kbd> paint · <kbd>R</kbd> ready'],
    hideFloor: ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Mouse</kbd> look', '<kbd>Space</kbd> jump · <kbd>1</kbd>–<kbd>5</kbd> pose', '<kbd>P</kbd> paint · <kbd>R</kbd> ready'],
    seek: ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Mouse</kbd> look', '<kbd>Click</kbd> fire · <kbd>Q</kbd> scan · <kbd>Shift</kbd> sprint', '<kbd>Esc</kbd> free the mouse · look up!'],
    peek: ['<kbd>Mouse</kbd> look around · <kbd>V</kbd> view', '<kbd>F</kbd> scurry · <kbd>Z</kbd> zip · <kbd>1</kbd>–<kbd>9</kbd> pose'],
    peekP: ['<kbd>Mouse</kbd> look around · <kbd>V</kbd> view', '<kbd>F</kbd> scurry · <kbd>Z</kbd> zip · <kbd>1</kbd>–<kbd>9</kbd> pose', '<kbd>P</kbd> paint (they can see it change!)'],
    head: ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Mouse</kbd> look', '<kbd>E</kbd> stick · <kbd>Z</kbd> zip · <kbd>Space</kbd> jump', '<kbd>1</kbd>–<kbd>9</kbd> pose · <kbd>P</kbd> paint · head start!'],
    seekClimb: ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Mouse</kbd> look', '<kbd>Click</kbd> fire · <kbd>Q</kbd> scan · <kbd>Shift</kbd> sprint', '<kbd>E</kbd> stick · <kbd>Z</kbd> zip · <kbd>Space</kbd> jump · <kbd>1</kbd>–<kbd>9</kbd> pose'],
    watch: ['Watching the seeker · you stay put', '<kbd>V</kbd> next view'],
    free: ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> fly · <kbd>Mouse</kbd> look · <kbd>Shift</kbd> fast', '<kbd>Space</kbd>/<kbd>E</kbd> up · <kbd>Q</kbd>/<kbd>C</kbd> down · <kbd>V</kbd> next view'],
    paint: ['<kbd>B</kbd> brush · <kbd>G</kbd> fill · <kbd>E</kbd> pick', '<kbd>T</kbd> stamp · <kbd>Z</kbd> undo · <kbd>P</kbd> done'],
  };
  function legendRows(ph, role, hunt, hiderHead, sp) {
    if (P.on) return LEGEND.paint;
    if (ph === 'hide') return rules().climb ? LEGEND.hide : LEGEND.hideFloor;
    if (hiderHead) return rules().climb ? LEGEND.head : LEGEND.hideFloor;
    if (ph === 'seek' && role !== 'hider') return seekerClimbs() && role === 'seeker' ? LEGEND.seekClimb : LEGEND.seek;
    if (sp === 'watch') return LEGEND.watch;
    if (sp === 'free') return LEGEND.free;
    return rules().huntPaint !== 'off' ? LEGEND.peekP : LEGEND.peek;
  }
  /** Stick / Zip button state (shared descriptors) for whoever is moving. */
  function stickZipState(v, t, cd) {
    const b = body[v];
    ACTS.m.stick.on = ACTS.t.stick.on = b.at;
    const AS = controls.st.usingMouse ? ACTS.m : ACTS.t;
    AS.stick.label = b.at ? 'Let go' : 'Stick'; AS.stick.icon = b.at ? 'unstick' : 'stick';
    const zl = Math.max(0, R.zipReady[v] - t);
    AS.zip.cd = clamp(zl / cd, 0, 1); AS.zip.disabled = zl > 0 || !!b.zip;
  }
  /** "You're here": a small sticker over my own body in the spectator views (edge-clamped). */
  function hereMarker(v) {
    const a = stage.av[v]; const q = a.root.quaternion; const s2 = a.st.size;
    const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
    herePrj.copy(a.root.position); herePrj.y += (uy > -0.5 ? 0.62 : 0.15) * s2;
    herePrj.project(stage.camera);
    const W = SW; const H = SH;
    let nx = herePrj.x; let ny = herePrj.y; let edge = false;
    if (herePrj.z > 1) { nx = -nx; ny = -ny; edge = true; } // behind the camera: point the other way
    const m = Math.max(Math.abs(nx), Math.abs(ny));
    if (m > 0.86) { nx = (nx / m) * 0.86; ny = (ny / m) * 0.86; edge = true; }
    let x = (nx + 1) / 2 * W; let y = (1 - ny) / 2 * H;
    y = clamp(y, 96, H - 40); x = clamp(x, 34, W - 34);
    hud.here(true, x, y, edge);
  }
  function mkActs(mouse) {
    const k = (x) => (mouse ? x : '');
    const poses = { act: 'poses', icon: 'pose', label: 'Pose', key: k('1-9') };
    const ready2 = { act: 'ready', icon: 'ready', label: 'I’m hidden', hl: true, wide: true, key: k('R') };
    const jump = { act: 'jump', icon: 'jump', label: 'Jump', key: k('␣') };
    const paint = { act: 'paint', icon: 'paint', label: 'Paint', big: true, prime: true, key: k('P') };
    const stick2 = { act: 'stick', icon: 'stick', label: 'Stick', on: false, key: k('E') };
    const zip2 = { act: 'zip', icon: 'zip', label: 'Zip', cdRing: true, cd: 0, disabled: false, key: k('Z') };
    const scan2 = { act: 'scan', icon: 'scan', label: 'Scan', cdRing: true, cd: 0, disabled: false, key: k('Q') };
    const fire2 = { act: 'fire', icon: 'fire', label: 'Fire', big: true, prime: true, disabled: false, key: k('Click') };
    const sprint2 = { act: 'sprint', icon: 'sprint', label: 'Sprint', on: false, key: k('⇧') };
    const scurry2 = { act: 'scurry', icon: 'scurry', label: 'Scurry', hl: true, big: true, disabled: false, key: k('F') };
    const pzip = { act: 'zip', icon: 'zip', label: 'Zip', cdRing: true, cd: 0, disabled: false, key: k('Z') };
    const view = { act: 'view', icon: 'eye', label: 'View', key: k('V') };
    const ppaint = { act: 'paint', icon: 'paint', label: 'Paint', key: k('P') };
    return {
      scan: scan2, fire: fire2, scurry: scurry2, stick: stick2, zip: zip2, pzip, sprint: sprint2, view,
      // Ready is a wide pill at the top of the cluster (it ends the hide phase for good: out of the thumb's path to Paint / Pose)
      hide: [ready2, stick2, zip2, poses, jump, paint], hideFloor: [ready2, poses, jump, paint],
      // a hider's head start: hiding moves without Ready
      head: [stick2, zip2, poses, jump, paint], headFloor: [poses, jump, paint],
      seek: [scan2, sprint2, jump, fire2], both: [poses, scan2, fire2],
      // the climbing seeker: sticky feet on the top rows, the hunt below (Fire bottom-right)
      seekClimb: [stick2, zip2, poses, scan2, sprint2, jump, fire2],
      // hunted: views + (paint) + poses + escapes; spectating: just the view switch
      peek: [view, poses, pzip, scurry2], peekFloor: [view, poses, scurry2],
      peekP: [view, ppaint, poses, pzip, scurry2], peekFloorP: [view, ppaint, poses, scurry2],
      spect: [view], none: [],
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
  const U = { meB: null, mouse: null, tick: -1, blind: null, tips: false, spect: 'eyes' };
  const live = { blind: null, resume: null, seek: null, recap: null, head: null, ticker: null, blindS: -1, resumeS: -1, seekS: -1, headS: -1 };
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
    const hunt = hunting(t);
    const sp = U.spect;
    const hiderHead = ph === 'seek' && role === 'hider' && !hunt && !local;
    const seekerMoves = ph === 'seek' && role === 'seeker' && hunt && seekerClimbs();
    showParts.top = !!m && ph !== 'lobby' && ph !== 'final';
    showParts.sub = showParts.top && ph !== 'curtain';
    showParts.cross = inGame && ph === 'seek' && (role === 'seeker' || role === 'both') && !fz && hunt;
    showParts.gear = inGame && ph === 'seek';
    showParts.tools = inGame && P.on;
    showParts.poses = inGame && (P.on || posesOpen) && sp === 'eyes' && ((ph === 'hide' || ph === 'seek') && (role === 'hider' || role === 'both') || seekerMoves);
    const moving = (ph === 'hide' && (role === 'hider' || role === 'both')) || (ph === 'seek' && role !== 'hider' && hunt) || hiderHead || sp === 'free';
    showParts.joyhint = inGame && !P.on && moving && !fz;
    showParts.legend = inGame && mouse && (ph === 'hide' || ph === 'seek');
    showParts.mini = inGame && ph === 'seek' && hunt && (role === 'seeker' || role === 'both') && rules().minimap && !!stage.map.big;
    // action buttons
    const AS = mouse ? ACTS.m : ACTS.t;
    let list = AS.none;
    if (inGame && !fz && !P.on) {
      const climb = rules().climb;
      if ((ph === 'hide' && (role === 'hider' || role === 'both')) || hiderHead) {
        list = hiderHead ? (climb ? AS.head : AS.headFloor) : climb ? AS.hide : AS.hideFloor;
        stickZipState(v, t, ZIP.cdHide);
      } else if (ph === 'seek' && (role === 'seeker' || role === 'both')) {
        list = role === 'both' ? AS.both : seekerMoves ? AS.seekClimb : AS.seek;
        const left = Math.max(0, R.scanReady[v] - t);
        const none = R.scansLeft[v] <= 0;
        AS.scan.cd = none ? 1 : clamp(left / scanCdMs(), 0, 1); AS.scan.disabled = left > 0 || none; AS.scan.label = none ? 'No scans' : SCAN_L[Math.min(30, Math.ceil(left / 1000))];
        const gl = huntAt() + graceMs() - t;
        if (gl > 0) { AS.fire.label = GRACE_L[Math.min(15, Math.ceil(gl / 1000))]; AS.fire.disabled = true; }
        else { AS.fire.label = FIRE_L[Math.min(10, R.pellets[v])]; AS.fire.disabled = R.pellets[v] <= 0; }
        AS.sprint.on = R.sprint || controls.st.sprintHeld;
        if (seekerMoves) stickZipState(v, t, ZIP.cdSeeker);
      } else if (ph === 'seek' && role === 'hider' && !local) {
        const pt = rules().huntPaint !== 'off';
        list = sp !== 'eyes' ? AS.spect : climb ? (pt ? AS.peekP : AS.peek) : (pt ? AS.peekFloorP : AS.peekFloor);
        AS.view.label = VIEW_L[sp]; AS.view.icon = sp === 'eyes' ? 'eye' : sp === 'watch' ? 'watch' : 'cam'; AS.view.on = sp !== 'eyes';
        const out = R.escapes[v] <= 0;
        AS.scurry.label = out ? (R.scurried[v] ? 'Used' : 'None') : (R.escapes[v] > 1 ? SCURRY_L[Math.min(3, R.escapes[v])] : 'Scurry'); AS.scurry.hl = !out; AS.scurry.disabled = out;
        const zl = Math.max(0, R.zipReady[v] - t);
        AS.pzip.disabled = out || zl > 0 || !!body[v].zip; AS.pzip.cd = out ? 1 : clamp(zl / ZIP.cdSeek, 0, 1);
      }
    }
    showParts.acts = list.length > 0;
    const a3 = list.length > 4;
    if (U.acts3 !== a3) { U.acts3 = a3; root.classList.toggle('acts3', a3); }
    const a7 = list.length > 6;
    if (U.acts7 !== a7) { U.acts7 = a7; root.classList.toggle('acts7', a7); }
    if (U.minion !== showParts.mini) { U.minion = showParts.mini; root.classList.toggle('minion', showParts.mini); }
    if (U.posesup !== showParts.poses) { U.posesup = showParts.poses; root.classList.toggle('posesup', showParts.poses); }
    hud.show(showParts);
    if (list.length) hud.actions(list);
    if (showParts.top) {
      const untimed = ph === 'hide' && !S.phase.dur;
      const timed = (ph === 'hide' && !untimed) || ph === 'seek';
      let rem2 = S.paused ? S.paused.remaining : Math.max(0, S.phase.end - Math.max(t, S.resumeAt));
      let label = PHASE_L[ph] || '';
      // during a head start the clock counts the blindfold down, then the hunt
      if (ph === 'seek' && !hunt) { rem2 = Math.max(0, rem2 - ((S.phase.data && S.phase.data.hunt) || 0)); label = PHASE_L.head; }
      if (untimed) label = PHASE_L.untimed;
      const hot = timed && rem2 < 10500 && !S.paused;
      hud.clock(label, timed ? rem2 : null, hot);
      if (hot && rem2 > 0) { const sN = Math.ceil(rem2 / 1000); if (sN !== U.tick) { U.tick = sN; snd.play('beep'); } }
      hud.scores(m.scores.a, m.scores.b);
      hud.pips(m.rounds, Math.max(0, S.phase.round - 1));
      let rtext = '';
      if (role === 'hider') rtext = local ? ROLE_L.hides[v] : ROLE_L.youHide;
      else if (role === 'seeker') rtext = local ? ROLE_L.seeks[v] : ROLE_L.youSeek;
      else if (role === 'both') rtext = ph === 'seek' ? ROLE_L.hunt : ROLE_L.hideBoth;
      else if (m.mode === 'hs' && S.phase.round) rtext = ROLE_L.hides[hiderOf(S.phase.round)];
      // spectating: the role pill says which view you're in (highlighted)
      if (inGame && U.spect !== 'eyes' && v) rtext = U.spect === 'watch' ? (other(v) === 'a' ? BADGE.watch : BADGE.watchB) : BADGE.free;
      hud.role(rtext, !!role);
    }
    if (showParts.gear && v) {
      const shooter = role === 'hider' ? other(v) : v;
      hud.pellets(R.pellets[shooter], R.maxPellets, shooter !== v);
    }
    if (showParts.poses && v) { hud.poseList(poseBar(v)); hud.poseOn(body[v].pose); }
    if (showParts.mini && v) { const b = body[v]; hud.miniDraw(b.x, b.z, C.climbV ? C.vYaw : b.yaw + b.lookYaw, v === 'a' ? theme.a : theme.b, b.y); }
    hud.tips(U.tips && inGame && ph === 'hide' && !P.on ? (U.tipsHtml || (U.tipsHtml = tipsHtml(mouse))) : null);
    if (showParts.tools && v) { hud.tool(P.tool, P.size, P.hard, P.rgb); hud.undoEnabled(stage.paints[v].canUndo); hud.stampEnabled(rules().stamp); }
    if (showParts.legend) hud.legend(legendRows(ph, role, hunt, hiderHead, sp));
    // the hider's spectator views: a badge and a "you're here" marker over their own body
    if (inGame && sp !== 'eyes' && v) {
      hud.badge(sp === 'watch' ? (other(v) === 'a' ? BADGE.watch : BADGE.watchB) : BADGE.free);
      hereMarker(v);
    } else { hud.badge(null); hud.here(false); }
    // live numbers inside cards
    if (live.blind) {
      // counts down the hide clock, or (untimed hide) up from the start
      const ms = !S.phase.dur && S.phase.name === 'hide' ? Math.max(0, t - S.phase.at) : S.paused ? S.paused.remaining : Math.max(0, S.phase.end - t);
      const n = Math.ceil(ms / 1000); if (n !== live.blindS) { live.blindS = n; live.blind.textContent = fmtTime(n * 1000); }
    }
    if (live.head) { const n = Math.max(1, Math.ceil((huntAt() - t) / 1000)); if (n !== live.headS) { live.headS = n; live.head.textContent = String(n); snd.play('beep'); } }
    if (live.resume) { const n = Math.max(1, Math.ceil((S.resumeAt - t) / 1000)); if (n !== live.resumeS) { live.resumeS = n; live.resume.textContent = String(n); } }
    if (live.seek) {
      const left = seekCountdown(t);
      const n = left < 0 ? 0 : Math.max(1, Math.ceil(left / 1000));
      if (n !== live.seekS) { live.seekS = n; live.seek.textContent = n ? String(n) : '…'; if (n) snd.play('beep'); }
    }
    if (live.recap && S.phase.dur) { const left = Math.max(0, S.phase.end - t); hud.ring(live.recap, left / S.phase.dur, Math.ceil(left / 1000)); }
    if (S.boot === 'ready' && v && ph === 'seek' && role === 'seeker' && hunting(t)) hintOnce(mouse ? 'look-m' : 'look-t', mouse ? 'Click to grab the mouse · click to fire · Esc frees it' : 'Left thumb moves · drag on the right to look', 3000);
    // ambience (this phone's Music setting): a paper-room pad while hiding, a pulse that quickens through
    // the hunt, +20 bpm while the seeker is within 6 m of the hider (both phones hear the same thing)
    if (music !== 'off' && m && !S.paused && !fz && (ph === 'hide' || ph === 'seek')) {
      if (ph === 'hide') snd.ambience(music === 'on' ? 'hide' : 'off');
      else if (hunt) {
        snd.ambience('hunt');
        const d0 = S.phase.data; const hm = d0 && d0.hunt ? d0.hunt : S.phase.dur || 1;
        snd.tempo(70 + 70 * clamp(1 - Math.max(0, S.phase.end - t) / hm, 0, 1) + (R.nearD < 6 ? 20 : 0));
        // the seeker's half-time stamp (hunts of 40 s and more)
        if (role === 'seeker' && !R.halfShown && hm >= 40000 && t >= S.phase.end - hm / 2) { R.halfShown = true; hud.pop('HALF TIME', 'ink', `${Math.round((S.phase.end - t) / 1000)} s left`); snd.play('beep'); }
      } else snd.ambience(music === 'on' ? 'hide' : 'off');
    } else snd.ambience('off');
    // the hide-phase ticker: went still after 20 s without moving
    if (ph === 'hide' && v && roleOf(v) === 'hider' && !local) { const b = body[v]; if (b.speed > 0.3) { R.actMoveAt = t; if (R.actStill) { R.actStill = false; act('move'); } } else if (!R.actStill && R.actMoveAt && t - R.actMoveAt > 20000) { R.actStill = true; act('still'); } }
  }

  const LY = { kind: null, a: null, b: null, n: 0 };
  function layer(t, ph, v, role) {
    if (S.boot !== 'ready') return;
    let kind = ''; let a = 0; let b = 0;
    if (S.ctxLost || S.ctxShown) kind = 'ctx';
    else if (S.paused || t < S.resumeAt) { kind = 'pause'; a = S.paused ? S.paused.reason : 'resume'; b = !S.paused; }
    // the round's title card wins over the lobby: round 1 used to show a dead lobby (Start still
    // there) for the whole title lead instead of "Round 1 · … hides" over the map overview
    else if (S.pendingTitle && t < S.pendingTitle.at) { kind = 'title'; a = S.pendingTitle.seq; }
    else if (ph === 'lobby') { kind = 'lobby'; a = S.setupVer; b = `${isHost}${S.sheet}${S.wardrobe}${S.wardW}${S.dataVer}${music}`; }
    else if (ph === 'curtain') { kind = seekCountdown(t) >= 0 ? 'count' : 'curtain'; a = S.phase.seq; b = S.callVer; }
    else if ((!local || ph === 'seek') && isBlind()) { kind = ph === 'seek' ? 'head' : ph === 'lock' ? 'lock' : 'blind'; a = S.phase.seq; b = S.callVer; }
    else if (ph === 'seek' && t < huntAt() + 900 && t >= huntAt() - 50) { kind = 'go'; a = S.phase.seq; }
    else if (ph === 'seek' && headStartOn(t) && t < S.phase.at + 1500 && v && roleOf(v) === 'hider') { kind = 'headgo'; a = S.phase.seq; }
    else if (ph === 'found' || ph === 'time') { kind = 'stamp'; a = S.phase.seq; }
    else if (ph === 'recap' && R.rec) { kind = 'recap'; a = S.phase.seq; }
    else if (ph === 'final' && S.match) { kind = 'final'; a = S.phase.seq; b = `${S.finished}${S.voteVer}`; }
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
    live.head = root.querySelector('[data-live="head-time"]'); live.headS = -1;
    live.ticker = root.querySelector('[data-live="ticker"]');
    live.recap = root.querySelector('.chm-ring');
    if (kind === 'lock' && S.match) hud.drops(paletteOf(hiderOf(S.phase.round) || 'a'));
  }
  function buildLayer(kind, t, v, role) {
    const m = S.match;
    switch (kind) {
      case 'ctx': return ctxCard();
      case 'pause': return pauseCard(api, { reason: S.paused ? S.paused.reason : 'resume', countdown: !S.paused });
      case 'lobby': return lobbyCard(api, { canEdit: isHost, local, setup: S.setup, waitingFor: 'a', sheet: S.sheet, music, bests: bestsStrip(api, data()), wardrobe: S.wardrobe ? wardrobeSheet(api, { w: wardrobeFor(), d: data(), picks: wearPicks[wardrobeFor()], local }) : '' });
      case 'title': {
        const p = S.pendingTitle; const hd = m && m.mode === 'hs' ? hiderOfRound(p.round) : null;
        return titleCard(api, { round: p.round, rounds: m ? m.rounds : 4, mode: m ? m.mode : 'hs', hider: hd, youHide: !local && hd === me, youSeek: !local && hd && hd !== me, map: m ? m.map : S.setup.map });
      }
      case 'count': { const d = S.phase.data || {}; return `<div class="chm-over solid"><div class="chm-card chm-sticker"><div class="chm-kicker">${esc(api.name(d.who))}, get ready</div><div class="chm-big" data-live="seek-count">3</div><p>Find them before the timer runs out.</p></div></div>`; }
      case 'curtain': { const d = S.phase.data || {}; return curtainCard(api, { kind: d.kind, who: d.who, wager: mode() === 'hs' ? rules().wager : 0, call: d.who ? R.call[d.who] : null, climbs: curMapEntry().climbs || 1 }); }
      case 'lock': return blindLock();
      case 'blind': return blindCard(api, { hider: hiderOf(S.phase.round), ms: S.phase.dur ? Math.max(0, S.phase.end - t) : Math.max(0, t - S.phase.at), pellets: R.maxPellets, mode: mode(), scanCd: rules().scanCd, scans: rules().scans, untimed: !S.phase.dur, climb: seekerClimbs(), wager: mode() === 'hs' ? rules().wager : 0, call: v ? R.call[v] : null, climbs: curMapEntry().climbs || 1, ticker: R.ticker });
      case 'head': return headCard(api, { hider: hiderOf(S.phase.round), ms: Math.max(0, huntAt() - t) });
      case 'headgo': return '<div class="chm-stamp ink">Head start!<small>They can’t see you yet — move!</small></div>';
      case 'go': return `<div class="chm-stamp ${role === 'seeker' || role === 'both' ? '' : 'ink'}">${role === 'hider' ? 'Freeze!' : 'Seek!'}</div>`;
      case 'stamp': {
        const ph = S.phase.name; const rec = R.rec || {}; const victim = rec.hider || rec.victim;
        const cls = ph === 'found' ? (rec.seeker || rec.winner || 'ink') : (victim || 'ink');
        const title = ph === 'found' ? 'FOUND!' : mode() === 'db' ? 'TIME!' : 'SURVIVED!';
        const small = ph === 'found' ? `${api.name(rec.seeker || rec.winner)} tagged ${api.name(victim)}${rec.ms != null && mode() === 'hs' ? ' in ' + fmtTime(rec.ms) : ''}` : mode() === 'db' ? 'Nobody got tagged' : `${api.name(victim)} stayed hidden`;
        const pts = ph === 'found' && rec.seekPoints ? `+${rec.seekPoints}${rec.spare ? ` · ${rec.spare} pellet${rec.spare === 1 ? '' : 's'} spare` : ''}` : ph !== 'found' && rec.outOfPellets && mode() === 'hs' ? `ran dry at ${fmtTime(rec.ms)} · +${rec.points}` : '';
        return `<div class="chm-stamp ${cls}">${title}<small>${esc(small)}</small>${pts ? `<small class="chm-pts">${esc(pts)}</small>` : ''}</div>`;
      }
      case 'recap': {
        const shooter = R.rec.seeker || (mode() === 'hs' ? other(R.rec.hider) : (v || 'a'));
        const st = { closest: Number.isFinite(R.closest) ? R.closest : null, passes: R.passes, used: R.used[shooter] || 0, max: R.maxPellets };
        const isLast = S.phase.round >= m.rounds || (m.mode === 'db' && (m.scores.a >= 2 || m.scores.b >= 2));
        const rx = R.rec.rx || {};
        const lines = recapLines(api, data(), R.rec, { mode: m.mode, passes: R.passes, under: R.under, stared: R.stared, called: !!R.rec.called, calledWhat: R.rec.called ? (CALLS.find((c) => c[0] === R.rec.call) || [])[1] : '' }, rx.records || []);
        const next = !isLast && m.mode === 'hs' ? { hider: hiderOfRound(S.phase.round + 1), map: curMapEntry().name } : null;
        return recapCard(api, { rec: R.rec, mode: m.mode, scores: m.scores, round: S.phase.round, rounds: m.rounds, isLast, canNext: true, stats: st, lines, next, autoMs: Math.max(0, S.phase.end - t) });
      }
      case 'final': {
        const d = S.phase.data || {};
        const story = matchStory(api, m.hist || [], curMapEntry().name);
        const vote = m.mode === 'hs' ? { rounds: (m.hist || []).filter((h) => h && h.hider), votes: S.vote, crowned: S.crowned, local } : null;
        return finalCard(api, { winner: d.winner, a: d.a, b: d.b, mode: m.mode, story, records: S.matchRecords, unlocks: S.matchUnlocks, firstNext: m.mode === 'hs' ? other(m.first) : null, vote });
      }
      case 'locking': return '<div class="chm-stamp ink">Locked in<small>Sealing your paint… <b data-live="seek-count"></b></small></div>';
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
          rem: { x: rem.x, y: rem.y, z: rem.z, q: rem.q, at: rem.at, po: rem.po, v: rem.v },
          visible: stage ? { a: stage.av.a.root.visible, b: stage.av.b.root.visible } : null,
          paint: P.on ? { tool: P.tool, size: P.size, hard: P.hard, rgb: P.rgb } : null,
          splats: stage ? stage.fx.splatCount : 0,
          violations: stats.violations, linkReady: link.ready, epoch: link.epoch, rtt: link.rtt, sent: link.sent, pubs: NETST.pubs, viewWhip: { at: C.vsAt, step: C.vsStep },
          blind: isBlind(), layer: hud.layerKey, trails: stage ? stage.fx.trailCount : 0, mapId: stage && stage.map ? stage.map.id : null,
          // v3
          spect: U.spect, fc: [C.fcX, C.fcY, C.fcZ, C.fcYaw, C.fcPitch], climbV: C.climbV, vYaw: C.vYaw, hunting: hunting(), huntAt: huntAt(), graceUntil: huntAt() + graceMs(),
          live: { sent: R.lpSent, same: R.lpSame, got: R.lpIn, tells: R.tells, tellSkip: R.tellSkip, tellOn: !!R.tell }, cam: stage ? stage.camera.position.toArray() : null,
          here: { on: !hud.el.here.hidden, x: hud.el.here.style.transform }, badge: hud.el.badge.textContent || null, role: hud.el.role.textContent,
          glint: { a: R.glintAt.a, b: R.glintAt.b }, lastPick: stats.lastPick || null, lastPaint: stats.lastPaint || null, lastShot: stats.lastShot || null, lastTagCheck: stats.lastTagCheck || null, lastWindow: stats.lastWindow || null,
        };
      },
      paintHash(w) { return stage.paints[w].hash(); },
      /** Blend score (camo %) of a body against the surface it's on, right now; and the round's locked scores. */
      blend(w) { return { now: blendOf(w || viewer()), locked: { a: R.blend.a, b: R.blend.b }, assisted: stats.assisted || 0 }; },
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
      guards() { return stage.world.boxes.filter((bx) => bx.climb === false).map((bx) => ({ name: bx.name, minX: bx.minX, maxX: bx.maxX, minY: bx.minY, maxY: bx.maxY, minZ: bx.minZ, maxZ: bx.maxZ })); },
      camDist() { return camPos && camLook ? camPos.distanceTo(camLook) : 0; },
      effTimes() { return { hide: hideMs(), seek: seekMs(), scale: mapTime(), hideScale: mapHideTime(), sprint: sprintMul(mapTime()) }; },
      fog() { return { near: stage.scene.fog.near, far: stage.scene.fog.far, camFar: stage.camera.far }; },
      /** Tests: change the size mid-round on this device only. */
      /** Tests: change one match rule on this device only (both devices are told separately). */
      forceRule(k, v) { const tgt = S.match ? S.match : S.setup; tgt.rules = sanitizeRules({ ...tgt.rules, [k]: v }); return tgt.rules[k]; },
      forceSize(id) { const tgt = S.match ? S.match : S.setup; tgt.rules = sanitizeRules({ ...tgt.rules, size: id }); applySize(); return sizeS(); },
      /** Free-walk with a world velocity for n steps (deterministic; same physics as the stick). */
      walk(vx, vz, n = 30, dt = 1 / 30) { const b = body[viewer()]; const sp = b.sq ? SPEED.squeeze : 1; for (let i = 0; i < n; i++) freeStep(stage.world, b, vx * sp, vz * sp, dt, false); return { x: b.x, y: b.y, z: b.z, sq: b.sq, r: b.r }; },
      mapsInfo() { return MAPS.map((m) => ({ id: m.id, name: m.name, area: mapArea(m), size: m.size, rooms: m.rooms, climbs: m.climbs })); },
      setPose(p) { setPose(p); return body[viewer()].pose; },
      /** Point the first-person view at a world point (seeker aim). */
      aimAt(x, y, z) {
        const v = viewer(); const b = body[v];
        if (C.climbV) {
          // the seeker's over-the-shoulder climb view: aim from where that camera will be
          for (let i = 0; i < 6; i++) {
            const c = climbCamWant(b, C.vYaw, b.lookPitch, new THREE.Vector3(), new THREE.Vector3());
            C.vYaw = Math.atan2(x - c.x, z - c.z); b.lookPitch = Math.atan2(y - c.y, Math.hypot(x - c.x, z - c.z));
          }
          return { yaw: C.vYaw, pitch: b.lookPitch, climb: true };
        }
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
      /** Net probe (cheap, per frame): shared clock, my body, the partner as drawn, the camera, presence calls. */
      /** Net A/B: { maxDelay } caps the adaptive delay (100 = the old fixed delay); { keepalive: false } publishes every tick. */
      netTune(o) { if (o.maxDelay != null) link.setDelayMax(o.maxDelay); if (o.keepalive != null) PUB_HOLD_MS = o.keepalive ? 250 : Infinity; return { maxDelay: o.maxDelay, hold: PUB_HOLD_MS }; },
      netStats() { return { interp: { ...link.interpStats }, pubs: NETST.pubs, idle: NETST.idle, delay: link.delay, target: link.delayTarget, rtt: link.rtt }; },
      netProbe() { const v = viewer() || me; const o = other(v); const b = body[v]; const r = stage.av[o].root.position; const c = stage.camera.position; return [now(), b.x, b.y, b.z, r.x, r.y, r.z, c.x, c.y, c.z, NETST.pubs, stage.av[o].root.visible ? 1 : 0, S.phase.name === 'seek' && hunting() ? 1 : 0, link.delay]; },
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
      camera() { const c = stage.camera; return { p: c.position.toArray(), fov: c.fov, dir: c.getWorldDirection(new THREE.Vector3()).toArray() }; },
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
      /** Paint perf probe: texels tested by dabs so far, the last blob, the codec timings of one lock. */
      paintPerf(w) {
        const p = stage.paints[w || viewer()];
        const dist = new Set(); for (let i = 0; i < p.data.length; i += 4) dist.add((p.data[i] << 16) | (p.data[i + 1] << 8) | p.data[i + 2]);
        return { dabTexels: p.dabTexels, dabs: p.dabs, texels: p.texels, version: p.version, lastPaint: stats.lastPaint, colours: dist.size, pfx: { fill: !!PFX.fillParts, stamp: !!PFX.stampW, preview: !!PFX.previewUntil, fills: PFX.fills, stamps: PFX.stamps }, size: P.size, hard: P.hard };
      },
      brushPreviewNow() { brushPreview(); return PFX.previewUntil > 0; },
      /** The live camo meter: its score, the paint version it was taken at, whether it shows, jobs run. */
      camo() { return { score: CAMO.score, ver: CAMO.ver, shown: !!(CAMO.meter && CAMO.meter.shown), busy: CAMO.job.on, runs: CAMO.runs, slices: CAMO.slices, meter: CAMO.meter ? CAMO.meter.stats : null, cached: !!stats.blendCached }; },
      /** Slow the stamp wipe / fill flood down (screenshots) or read the current reveal. */
      reveal(o, w) { if (o) { if (o.stamp) Object.assign(REVEAL.stamp, o.stamp); if (o.fill) Object.assign(REVEAL.fill, o.fill); } return stage.paints[w || viewer() || 'a'].reveal; },
      lookFrom(arr) { C.override = arr; },
      setLook(yaw, pitch) { const b = body[viewer()]; b.lookYaw = yaw; b.lookPitch = pitch; },
      openPoses() { posesOpen = true; },
      /** v3: the hider's view while hunted ('eyes' | 'watch' | 'free'); returns what's in force. */
      view(m) { if (m) setView(m); else action('view'); return C.spect; },
      /** Fly the free cam to a spot (tests; still clamped to the map). */
      freeCamTo(x, y, z, yaw, pitch) { C.fcX = x; C.fcY = y; C.fcZ = z; if (yaw != null) C.fcYaw = yaw; if (pitch != null) C.fcPitch = pitch; clampFree(); return [C.fcX, C.fcY, C.fcZ]; },
      freeBounds() { const B = stage.world.bounds; return { minX: B.minX, maxX: B.maxX, minZ: B.minZ, maxZ: B.maxZ, bottom: C.fcBottom, top: C.fcTop }; },
      timing() { return { hide: hideMs(), seek: seekMs(), head: headStartMs(), countdown: countdownMs(), grace: graceMs(), scale: mapTime(), hideScale: mapHideTime() }; },
      // polish: records / wardrobe / wager / ticker / emotes
      data() { return { ...data() }; },
      polish() { return { stared: R.stared, call: { ...R.call }, ticker: R.ticker, strokes: { ...R.strokes }, passes: R.passes, under: R.under, closest: R.closest, nearD: R.nearD, music, wear: { a: { ...stage.av.a.wear }, b: { ...stage.av.b.wear } }, picks: wearPicks, records: S.matchRecords.slice(), unlocks: S.matchUnlocks.slice(), finished: S.finished }; },
      setCall(k) { setCall(k); return { ...R.call }; },
      emote(k) { sendEmote(k, null); },
      finish() { finishMatch(); },
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
      if (offData) { try { offData(); } catch { /* ignore */ } }
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
