// Tower Together: a co-op stacking game. Take turns dropping the sliding block onto a shared
// tower; whatever hangs over the edge is sliced off and tumbles away. A total miss ends it.
// The height is the team score.
//
// Rules are pure: move = { o }, the drop offset along this level's axis relative to the block
// below (3 decimals). The sliding, slicing and tumbling are view-only.
import { registerGame, rand, randInt, gameDataApi } from './core.js';

// ── rules ─────────────────────────────────────────────────────────────
const BASE = 3;       // footprint of the base (world units)
const TOL = 0.1;      // a drop this close to dead centre snaps to a perfect fit
const GROW = 0.2;     // a perfect streak grows the block back by this much (each axis)
const STREAK = 3;     // perfects in a row that grow the block
const MAX_O = 50;
const GIFT_GROW = 0.3; // a gift block grows by this much when it lands
const LAND_GROW = 0.2; // a perfect on a landmark level grows the block by this much (on top)

// Modes are picked with a setup move { m: 'duet' } before the very first drop. A match without
// one (every match recorded before modes existed) is classic and replays exactly as it always did.
const MODES = {
  classic: { name: 'Classic', hint: 'The original game.', base: BASE, tol: TOL, streak: STREAK, gifts: false, landmarks: false },
  duet: { name: 'Duet', hint: 'Both perfect: it grows.', base: BASE, tol: TOL, streak: 2, gifts: true, landmarks: true },
  windy: { name: 'Windy', hint: 'Gusts and gift blocks.', base: BASE, tol: TOL, streak: STREAK, gifts: true, landmarks: true },
  hard: { name: 'Hard Hat', hint: 'Small base, tight aim.', base: 2.4, tol: 0.07, streak: STREAK, gifts: false, landmarks: true },
};
const MODE_IDS = ['classic', 'duet', 'windy', 'hard'];
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const modeOf = (s) => (s && typeof s.mode === 'string' && has(MODES, s.mode) ? s.mode : 'classic');
const specOf = (s) => MODES[modeOf(s)];

const other = (w) => (w === 'a' ? 'b' : 'a');
const r3 = (v) => Math.round(v * 1000) / 1000 + 0; // "+ 0" turns -0 into 0
const r4 = (v) => Math.round(v * 10000) / 10000 + 0;
/** Level n (the n-th dropped block; the base is level 0) slides along x on odd levels, z on even. */
const axisOf = (level) => (level % 2 ? 'x' : 'z');
const perfectTol = (size, tol = TOL) => Math.min(tol, size * 0.2);
/** Gift levels (duet, windy): from level 5 on, about one level in six. Seeded, so both phones agree. */
const isGift = (seed, level, sp) => !!sp.gifts && level >= 5 && randInt(6, seed === undefined ? 0 : seed, 'gift', level) === 0;
/** Landmark levels (every mode but classic): every 10th level is golden. */
const isLandmark = (level, sp) => !!sp.landmarks && level % 10 === 0;
/** The longest run of consecutive perfect drops. */
function longestRun(blocks) {
  let best = 0; let cur = 0;
  for (let i = 1; i < blocks.length; i++) { cur = blocks[i].p ? cur + 1 : 0; if (cur > best) best = cur; }
  return best;
}

function init({ first }) {
  return {
    turn: first === 'b' ? 'b' : 'a',
    blocks: [{ x: 0, z: 0, w: BASE, d: BASE, who: null }],
    streak: 0,
    perfects: { a: 0, b: 0 },
    over: false,
    drop: null, // the newest drop, for the view: { who, o, axis, level, miss, perfect, grew, streak, cut }
  };
}

function next(s) { return s.over ? [] : [s.turn]; }

/** The setup move: the starting player may pick a mode as the very first move. It doesn't pass the turn. */
function setup(s, m) {
  if (typeof m !== 'string' || !has(MODES, m)) throw new Error('That mode isn’t on the menu.');
  if (s.mode !== undefined || s.blocks.length !== 1 || s.drop) throw new Error('Modes are picked before the first drop.');
  s.mode = m;
  const b = s.blocks[0];
  b.w = MODES[m].base; b.d = MODES[m].base;
  return s;
}

function apply(s, who, mv) {
  if (s.over) throw new Error('The tower already toppled.');
  if (who !== s.turn) throw new Error('Hold on, it’s not your turn.');
  if (mv && typeof mv === 'object' && mv.m !== undefined) return setup(s, mv.m);
  const sp = specOf(s);
  const classic = modeOf(s) === 'classic';
  const raw = mv ? mv.o : undefined;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || Math.abs(raw) > MAX_O) throw new Error('That drop didn’t register. Try again.');
  const o = r3(raw);
  const level = s.blocks.length;
  const axis = axisOf(level);
  const prev = s.blocks[level - 1];
  const size = axis === 'x' ? prev.w : prev.d;
  const at = axis === 'x' ? prev.x : prev.z;
  const drop = { who, o, axis, level, miss: false, perfect: false, grew: false, streak: 0, cut: null };
  s.drop = drop;
  s.turn = other(who);
  if (Math.abs(o) >= size) { // nothing overlaps: the block falls and the game is over
    drop.miss = true;
    s.streak = 0;
    s.over = true;
    return s;
  }
  const nb = { x: prev.x, z: prev.z, w: prev.w, d: prev.d, who };
  if (Math.abs(o) <= perfectTol(size, sp.tol)) {
    drop.perfect = true;
    nb.p = 1;
    s.streak += 1;
    s.perfects[who] += 1;
    // classic: three in a row. duet: every second one, which is always the other partner's.
    const due = classic ? s.streak % STREAK === 0 : s.streak % sp.streak === 0 && (sp.streak !== 2 || (prev.p === 1 && prev.who !== who));
    if (due && (nb.w < sp.base || nb.d < sp.base)) {
      nb.w = r4(Math.min(sp.base, nb.w + GROW));
      nb.d = r4(Math.min(sp.base, nb.d + GROW));
      drop.grew = true;
    }
  } else {
    s.streak = 0;
    const keep = r4(size - Math.abs(o));
    const mid = r4(at + o / 2);
    const cut = r4(Math.abs(o));
    const cutMid = r4(at + Math.sign(o) * (size / 2) + o / 2);
    if (axis === 'x') { nb.x = mid; nb.w = keep; drop.cut = { x: cutMid, z: prev.z, w: cut, d: prev.d }; }
    else { nb.z = mid; nb.d = keep; drop.cut = { x: prev.x, z: cutMid, w: prev.w, d: cut }; }
  }
  if (!classic) { // gifts and landmarks: bonus growth once the block has landed
    const bump = (amt) => {
      if (nb.w >= sp.base && nb.d >= sp.base) return false;
      nb.w = r4(Math.min(sp.base, nb.w + amt));
      nb.d = r4(Math.min(sp.base, nb.d + amt));
      return true;
    };
    if (isGift(s.seed, level, sp)) {
      nb.gift = 1;
      drop.gift = true;
      if (bump(GIFT_GROW)) drop.grew = true;
    }
    if (isLandmark(level, sp)) {
      nb.lm = 1;
      drop.landmark = true;
      if (drop.perfect) { drop.bonus = true; if (bump(LAND_GROW)) drop.grew = true; }
    }
  }
  drop.streak = s.streak;
  s.blocks.push(nb);
  return s;
}

const LINES = [
  [0, 'Timber, straight away. Shake it off and go again.'],
  [1, 'A humble little stack.'],
  [4, 'Cute. A tiny lighthouse.'],
  [8, 'Now that’s a proper tower.'],
  [13, 'Skyline material. Very steady hands.'],
  [20, 'Taller than the fridge. Seriously impressive.'],
  [30, 'Architects of love, honestly.'],
  [45, 'You’ll need planning permission. Legendary.'],
];
function result(s) {
  const h = s.blocks.length - 1;
  const p = s.perfects.a + s.perfects.b;
  let line = LINES[0][1];
  for (const [min, t] of LINES) if (h >= min) line = t;
  const run = longestRun(s.blocks);
  const facts = p ? ` ${p} perfect drop${p > 1 ? 's' : ''}${run > 1 ? `, longest streak ${run}` : ''}.` : '';
  return {
    winner: null, team: true, score: h,
    text: h === 1 ? '1 block high' : `${h} blocks high`,
    sub: `${line}${facts}`,
  };
}
function score(s) {
  const c = { a: 0, b: 0 };
  for (const b of s.blocks) if (b.who) c[b.who]++;
  return c;
}

// ── view constants (UI only) ──────────────────────────────────────────
const BH = 0.6;            // block height
const PED = 2.6;           // the base is a tall pedestal; its top is y = 0
const K = 1.05;            // camera looks along -(1, K, 1): a printed, isometric-ish view
const VIEW_W = 8.8;        // world units across a narrow canvas (the slide's far ends may clip a little)
const MIN_VIEW_H = 13;     // wide screens still show this much height
const CAM_LEAD = -0.5;     // the camera looks this far above the tower top (negative: below)
const OUTLINE_PX = 2.2;    // ink outline width (CSS px)
const speedOf = (level, mode) => (mode === 'hard' ? Math.min(2.6 + 0.08 * (level + 13), 6.4) : Math.min(2.6 + 0.08 * (level - 1), 5.6)); // units per second (hard hat starts at the level-15 speed)
const ampOf = (size) => size + 0.45;                                 // slide half-range
const sideOf = (level, mode, seed) => (mode === 'windy' ? (rand(seed, 'wside', level) < 0.5 ? -1 : 1) : level % 4 < 2 ? -1 : 1); // which side it starts on
const ARM_MS = 250;        // a fresh slider ignores taps for this long
const WIND_MIN_LEVEL = 3;  // gusts begin here
const yOf = (level) => (level === 0 ? -PED / 2 : (level - 0.5) * BH);
const hOf = (level) => (level === 0 ? PED : BH);
const camYFor = (top) => top * BH + CAM_LEAD;

const NV = Math.hypot(1, K, 1);
const VIEW = [1 / NV, K / NV, 1 / NV];          // unit vector toward the camera
const SINP = K / NV;                             // camera elevation
const COSP = Math.SQRT2 / NV;
const LN = Math.hypot(0.511, 0.803, 0.307);
const LIGHT = [0.511 / LN, 0.803 / LN, 0.307 / LN];
const AMB = 0.45;
const SUN = 0.685;                               // top face = 1.0, sides ≈ 0.8 and 0.66

// ── colours: resolve any CSS colour (hex, rgb, oklch, color-mix…) to linear-ish [0..1] rgb ──
let probe = null;
function rgbOf(css, fb) {
  const s = String(css || '').trim() || fb;
  try {
    if (!probe) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      probe = c.getContext('2d', { willReadFrequently: true });
    }
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = fb;
    probe.fillStyle = s;
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255];
  } catch { return [0.5, 0.5, 0.5]; }
}
const mix = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
function readPalette(api) {
  const t = api.tokens();
  const bg = rgbOf(t.bg, '#f4f2ee');
  const ink = rgbOf(t.ink, '#1d1b22');
  return {
    a: rgbOf(t.a, '#2f5bea'), b: rgbOf(t.b, '#f0428b'), base: rgbOf(t.card, '#ffffff'),
    bg, ink, hl: rgbOf(t.hl, '#ffd23f'),
    shadow: t.dark ? mix(bg, [0, 0, 0], 0.5) : mix(bg, ink, 0.16),
  };
}
const TMP = [0, 0, 0];
function colorOf(pal, e) { // a flash is a hard highlighter blink, like a second ink pass
  const c = (e.flash || 0) >= 0.5 || e.tint === 'hl' ? pal.hl : e.tint === 'ink' ? pal.ink : e.tint === 'bg' ? pal.bg : e.who === 'a' ? pal.a : e.who === 'b' ? pal.b : pal.base;
  TMP[0] = c[0]; TMP[1] = c[1]; TMP[2] = c[2];
  return TMP;
}

const NONE = [];

// ── gift ribbons: three thin boxes wrapped round a gift block (drawn in the same batches) ──
function makeRibbons() {
  return [0, 1, 2].map(() => ({ x: 0, y: 0, z: 0, w: 1, h: 1, d: 1, who: null, tint: 'hl', lift: 0, rx: 0, rz: 0, flash: 0 }));
}
function syncRibbons(e) {
  const r = e.rib; const t = e.tint === 'hl' ? 'base' : 'hl';
  for (let k = 0; k < 3; k++) { const q = r[k]; q.x = e.x; q.y = e.y; q.z = e.z; q.lift = e.lift || 0; q.tint = t; }
  r[0].w = e.w + 0.07; r[0].h = e.h + 0.05; r[0].d = 0.2;
  r[1].w = 0.2; r[1].h = e.h + 0.05; r[1].d = e.d + 0.07;
  r[2].w = 0.38; r[2].h = 0.16; r[2].d = 0.38; r[2].y = e.y + e.h / 2 + 0.08;
}

// ── three.js renderer: two merged box batches (settled tower + moving pieces) ──
// Each batch is 3 draw calls: vertex-coloured Lambert faces, an inverted-hull ink outline,
// and ink crease lines. Buffers are preallocated and rewritten in place.
function makeUnit(THREE) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const edges = new THREE.EdgesGeometry(box);
  const u = {
    pos: Float32Array.from(box.attributes.position.array),
    nrm: Float32Array.from(box.attributes.normal.array),
    idx: Array.from(box.index.array),
    edge: Float32Array.from(edges.attributes.position.array),
  };
  box.dispose();
  edges.dispose();
  return u;
}

function makeBatch(THREE, U, mats) {
  const gF = new THREE.BufferGeometry();
  const gH = new THREE.BufferGeometry();
  const gL = new THREE.BufferGeometry();
  const B = {
    faces: new THREE.Mesh(gF, mats.face), hull: new THREE.Mesh(gH, mats.hull), lines: new THREE.LineSegments(gL, mats.line),
    cap: 0, P: null, N: null, C: null, H: null, E: null, attrs: [],
  };
  for (const o of [B.faces, B.hull, B.lines]) o.frustumCulled = false;
  const dyn = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
  B.ensure = (n) => {
    if (n <= B.cap) return;
    const cap = Math.max(16, 2 ** Math.ceil(Math.log2(n)));
    const big = cap * 24 > 65535;
    const I = big ? new Uint32Array(cap * 36) : new Uint16Array(cap * 36);
    for (let k = 0; k < cap; k++) for (let j = 0; j < 36; j++) I[k * 36 + j] = U.idx[j] + k * 24;
    B.P = new Float32Array(cap * 72); B.N = new Float32Array(cap * 72); B.C = new Float32Array(cap * 72);
    B.H = new Float32Array(cap * 72); B.E = new Float32Array(cap * 72);
    gF.dispose(); gH.dispose(); gL.dispose();
    const aP = dyn(B.P, 3); const aN = dyn(B.N, 3); const aC = dyn(B.C, 3); const aH = dyn(B.H, 3); const aE = dyn(B.E, 3);
    gF.setAttribute('position', aP); gF.setAttribute('normal', aN); gF.setAttribute('color', aC);
    gF.setIndex(new THREE.BufferAttribute(I, 1));
    gH.setAttribute('position', aH); gH.setIndex(new THREE.BufferAttribute(I, 1));
    gL.setAttribute('position', aE);
    B.attrs = [aP, aN, aC, aH, aE];
    B.cap = cap;
  };
  B.commit = (n) => {
    gF.setDrawRange(0, n * 36); gH.setDrawRange(0, n * 36); gL.setDrawRange(0, n * 24);
    for (const a of B.attrs) { a.updateRange.offset = 0; a.updateRange.count = Math.max(1, n * 72); a.needsUpdate = true; }
    B.faces.visible = B.hull.visible = n > 0;
    B.lines.visible = n > 0 && B.lineOn !== false;
  };
  B.dispose = () => { gF.dispose(); gH.dispose(); gL.dispose(); };
  return B;
}

function writeBox(B, U, i, e, rgb, out) {
  const P = B.P; const N = B.N; const C = B.C; const H = B.H; const E = B.E;
  const sx = e.w; const sy = e.h; const sz = e.d;
  const cx = e.x; const cy = e.y + (e.lift || 0); const cz = e.z;
  const hx = sx + 2 * out; const hy = sy + 2 * out; const hz = sz + 2 * out;
  const rx = e.rx || 0; const rz = e.rz || 0;
  let m00 = 1; let m01 = 0; let m02 = 0; let m10 = 0; let m11 = 1; let m12 = 0; let m20 = 0; let m21 = 0; let m22 = 1;
  if (rx || rz) { // Euler XYZ with ry = 0: Rx * Rz
    const a = Math.cos(rx); const b = Math.sin(rx); const c = Math.cos(rz); const d = Math.sin(rz);
    m00 = c; m01 = -d; m02 = 0; m10 = a * d; m11 = a * c; m12 = -b; m20 = b * d; m21 = b * c; m22 = a;
  }
  const up = U.pos; const un = U.nrm; const ue = U.edge;
  const base = i * 72;
  for (let j = 0; j < 72; j += 3) {
    const o = base + j;
    let x = up[j] * sx; let y = up[j + 1] * sy; let z = up[j + 2] * sz;
    P[o] = m00 * x + m01 * y + m02 * z + cx; P[o + 1] = m10 * x + m11 * y + m12 * z + cy; P[o + 2] = m20 * x + m21 * y + m22 * z + cz;
    x = up[j] * hx; y = up[j + 1] * hy; z = up[j + 2] * hz;
    H[o] = m00 * x + m01 * y + m02 * z + cx; H[o + 1] = m10 * x + m11 * y + m12 * z + cy; H[o + 2] = m20 * x + m21 * y + m22 * z + cz;
    x = un[j]; y = un[j + 1]; z = un[j + 2];
    N[o] = m00 * x + m01 * y + m02 * z; N[o + 1] = m10 * x + m11 * y + m12 * z; N[o + 2] = m20 * x + m21 * y + m22 * z;
    C[o] = rgb[0]; C[o + 1] = rgb[1]; C[o + 2] = rgb[2];
    x = ue[j] * sx; y = ue[j + 1] * sy; z = ue[j + 2] * sz;
    E[o] = m00 * x + m01 * y + m02 * z + cx; E[o + 1] = m10 * x + m11 * y + m12 * z + cy; E[o + 2] = m20 * x + m21 * y + m22 * z + cz;
  }
}

function view3D(THREE, canvas, pal0) {
  let pal = pal0;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  let ratio = Math.min(2, window.devicePixelRatio || 1);
  let W = 1; let Hh = 1;
  renderer.setPixelRatio(ratio);
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  const amb = new THREE.AmbientLight(0xffffff, AMB);
  const sun = new THREE.DirectionalLight(0xffffff, SUN);
  sun.position.set(LIGHT[0], LIGHT[1], LIGHT[2]);
  scene.add(amb, sun, sun.target);
  const U = makeUnit(THREE);
  const mats = {
    face: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    hull: new THREE.MeshBasicMaterial({ side: THREE.BackSide }),
    line: new THREE.LineBasicMaterial(),
  };
  const ringMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const shadowMat = new THREE.MeshBasicMaterial();
  const ringGeo = new THREE.RingGeometry(Math.SQRT1_2, Math.SQRT1_2 * 1.2, 4, 1, Math.PI / 4);
  ringGeo.rotateX(-Math.PI / 2);
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  planeGeo.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.renderOrder = 2;
  const shadow = new THREE.Mesh(planeGeo, shadowMat);
  shadow.scale.set(BASE + 0.1, 1, BASE + 0.1);
  shadow.position.set(0.42, -PED + 0.002, 0.42);
  const stat = makeBatch(THREE, U, mats);
  const dyn = makeBatch(THREE, U, mats);
  stat.ensure(32); dyn.ensure(16);
  scene.add(shadow, stat.hull, stat.faces, stat.lines, dyn.hull, dyn.faces, dyn.lines, ring);
  let statOut = 0;
  let statN = -1;
  let statLine = true;
  let emitOut = 0;
  const emit = (B, i, e) => { // a box, plus its ribbons when it is a gift
    writeBox(B, U, i++, e, colorOf(pal, e), emitOut);
    if (e.rib) { syncRibbons(e); for (let k = 0; k < 3; k++) writeBox(B, U, i++, e.rib[k], colorOf(pal, e.rib[k]), emitOut); }
    return i;
  };

  function setPalette(p) {
    pal = p;
    const c = (rgb) => new THREE.Color(rgb[0], rgb[1], rgb[2]);
    renderer.setClearColor(c(p.bg), 1);
    mats.hull.color.copy(c(p.ink));
    mats.line.color.copy(c(p.ink));
    ringMat.color.copy(c(p.hl));
    shadowMat.color.copy(c(p.shadow));
    statN = -1;
  }
  setPalette(pal);

  const api = {
    kind: '3d',
    resize(w, h) { W = Math.max(1, w); Hh = Math.max(1, h); renderer.setSize(W, Hh, false); },
    get ratio() { return ratio; },
    setRatio(r) { ratio = r; renderer.setPixelRatio(r); renderer.setSize(W, Hh, false); },
    setPalette,
    setBase(w) { shadow.scale.set(w + 0.1, 1, w + 0.1); },
    compile() { // warm the shaders up before the first animation
      scene.traverse((o) => { o.visible = true; });
      renderer.compile(scene, cam);
      ring.visible = false;
      statN = -1;
    },
    restore() { setPalette(pal); renderer.setPixelRatio(ratio); renderer.setSize(W, Hh, false); statN = -1; api.compile(); },
    render(m) {
      const vh = m.cam.viewH; const vw = vh * (W / Hh);
      cam.left = -vw / 2; cam.right = vw / 2; cam.top = vh / 2; cam.bottom = -vh / 2;
      cam.updateProjectionMatrix();
      const sx = (m.cam.sx || 0) + (m.cam.ox || 0);
      const tx = sx * Math.SQRT1_2; const tz = -sx * Math.SQRT1_2; const ty = m.cam.y;
      cam.position.set(tx + VIEW[0] * 60, ty + VIEW[1] * 60, tz + VIEW[2] * 60);
      cam.lookAt(tx, ty, tz);
      // thin blocks on a tall tower: ease the ink outline off (and drop the crease lines) so they don't shimmer
      const bpx = BH * (Hh / vh) * COSP;
      const out = OUTLINE_PX * Math.min(1, Math.max(0.35, bpx / 9)) * vh / Hh;
      const lineOn = bpx >= 5;
      m.outPx = out * Hh / vh; m.lineOn = lineOn; // (read by the tests)
      const blocks = m.blocks; const deco = m.deco || NONE; const extras = m.extras || NONE;
      emitOut = out;
      if (m.staticDirty || statN < 0 || Math.abs(out - statOut) > statOut * 0.08 || lineOn !== statLine) {
        let n = 0;
        for (let i = 0; i < blocks.length; i++) if (!blocks[i].live) n += blocks[i].rib ? 4 : 1;
        n += deco.length;
        stat.ensure(n);
        n = 0;
        for (let i = 0; i < blocks.length; i++) { const e = blocks[i]; if (!e.live) n = emit(stat, n, e); }
        for (let i = 0; i < deco.length; i++) if (!deco[i].off) n = emit(stat, n, deco[i]);
        stat.lineOn = lineOn;
        stat.commit(n);
        statN = n; statOut = out; statLine = lineOn; m.staticDirty = false;
      }
      let n = 0;
      for (let i = 0; i < blocks.length; i++) if (blocks[i].live) n += blocks[i].rib ? 4 : 1;
      n += m.pieces.length + extras.length + (m.slider ? (m.slider.rib ? 4 : 1) : 0);
      dyn.ensure(n);
      n = 0;
      for (let i = 0; i < blocks.length; i++) { const e = blocks[i]; if (e.live) n = emit(dyn, n, e); }
      for (let i = 0; i < m.pieces.length; i++) n = emit(dyn, n, m.pieces[i]);
      for (let i = 0; i < extras.length; i++) n = emit(dyn, n, extras[i]);
      if (m.slider) n = emit(dyn, n, m.slider);
      dyn.lineOn = lineOn;
      dyn.commit(n);
      const r = m.ring;
      ring.visible = !!r;
      if (r) {
        const s = 1 + r.k * 0.55;
        ring.position.set(r.x, r.y + 0.004, r.z);
        ring.scale.set(r.w * s, 1, r.d * s);
        ringMat.opacity = 1 - r.k * r.k;
      }
      renderer.render(scene, cam);
      return renderer.info.render.calls;
    },
    dispose() {
      try { renderer.forceContextLoss(); } catch { /* ignore */ }
      stat.dispose(); dyn.dispose(); ringGeo.dispose(); planeGeo.dispose();
      mats.face.dispose(); mats.hull.dispose(); mats.line.dispose(); ringMat.dispose(); shadowMat.dispose();
      renderer.dispose();
    },
  };
  return api;
}

// ── 2D fallback: the same model drawn as flat isometric boxes on a canvas ──
const FACES = [ // [axis, sign]
  [0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1],
];
function view2D(canvas, pal0) {
  let pal = pal0;
  const g = canvas.getContext('2d');
  let W = 1; let Hh = 1; let ratio = Math.min(2, window.devicePixelRatio || 1);
  const css = (c, k = 1) => `rgb(${Math.round(Math.min(1, c[0] * k) * 255)},${Math.round(Math.min(1, c[1] * k) * 255)},${Math.round(Math.min(1, c[2] * k) * 255)})`;
  let sc = 1; let camS = 0; let sxo = 0; let baseW = BASE;
  const px = (x, z) => W / 2 + ((x - z) * Math.SQRT1_2 - sxo) * sc;
  const py = (x, y, z) => Hh / 2 - ((-(x + z) * Math.SQRT1_2 * SINP + y * COSP) - camS) * sc;
  const corner = [0, 0, 0];
  function drawBox(e) {
    const rx = e.rx || 0; const rz = e.rz || 0;
    const a = Math.cos(rx); const b = Math.sin(rx); const c = Math.cos(rz); const d = Math.sin(rz);
    const M = [c, -d, 0, a * d, a * c, -b, b * d, b * c, a];
    const rot = (x, y, z, out) => { out[0] = M[0] * x + M[1] * y + M[2] * z; out[1] = M[3] * x + M[4] * y + M[5] * z; out[2] = M[6] * x + M[7] * y + M[8] * z; return out; };
    const col = colorOf(pal, e).slice();
    const n = [0, 0, 0];
    for (const [ax, sg] of FACES) {
      const nl = [0, 0, 0]; nl[ax] = sg;
      rot(nl[0], nl[1], nl[2], n);
      const vis = n[0] * VIEW[0] + n[1] * VIEW[1] + n[2] * VIEW[2];
      if (vis <= 0.001) continue;
      const shade = AMB + SUN * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      const u = (ax + 1) % 3; const v = (ax + 2) % 3;
      g.beginPath();
      for (let k = 0; k < 4; k++) {
        const l = [0, 0, 0];
        l[ax] = sg * 0.5; l[u] = (k === 0 || k === 3) ? -0.5 : 0.5; l[v] = k < 2 ? -0.5 : 0.5;
        rot(l[0] * e.w, l[1] * e.h, l[2] * e.d, corner);
        const X = corner[0] + e.x; const Y = corner[1] + e.y + (e.lift || 0); const Z = corner[2] + e.z;
        if (k) g.lineTo(px(X, Z), py(X, Y, Z)); else g.moveTo(px(X, Z), py(X, Y, Z));
      }
      g.closePath();
      g.fillStyle = css(col, shade);
      g.fill();
      g.stroke();
    }
  }
  return {
    kind: '2d',
    resize(w, h) { W = Math.max(1, w); Hh = Math.max(1, h); canvas.width = Math.round(W * ratio); canvas.height = Math.round(Hh * ratio); },
    get ratio() { return ratio; },
    setRatio(r) { ratio = r; canvas.width = Math.round(W * ratio); canvas.height = Math.round(Hh * ratio); },
    setPalette(p) { pal = p; },
    setBase(w) { baseW = w; },
    compile() {},
    restore() {},
    render(m) {
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.fillStyle = css(pal.bg);
      g.fillRect(0, 0, W, Hh);
      sc = Hh / m.cam.viewH; camS = m.cam.y * COSP; sxo = (m.cam.sx || 0) + (m.cam.ox || 0);
      g.lineJoin = 'round';
      g.lineWidth = 1.6 * Math.min(1, Math.max(0.35, BH * sc * COSP / 9));
      g.strokeStyle = css(pal.ink);
      // hard offset shadow under the pedestal
      const sy0 = -PED; const h0 = (baseW + 0.1) / 2;
      g.beginPath();
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([i, j], k) => {
        const X = 0.42 + i * h0; const Z = 0.42 + j * h0;
        if (k) g.lineTo(px(X, Z), py(X, sy0, Z)); else g.moveTo(px(X, Z), py(X, sy0, Z));
      });
      g.fillStyle = css(pal.shadow);
      g.fill();
      const draw = (e) => { drawBox(e); if (e.rib) { syncRibbons(e); for (let k = 0; k < 3; k++) drawBox(e.rib[k]); } };
      for (const e of m.deco || NONE) if (!e.off) draw(e);
      for (const e of m.blocks) draw(e);
      for (const e of m.pieces) draw(e);
      for (const e of m.extras || NONE) draw(e);
      if (m.slider) draw(m.slider);
      const r = m.ring;
      if (r) {
        const s = 1 + r.k * 0.55;
        g.beginPath();
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([i, j], k) => {
          const X = r.x + i * r.w * s / 2; const Z = r.z + j * r.d * s / 2;
          if (k) g.lineTo(px(X, Z), py(X, r.y, Z)); else g.moveTo(px(X, Z), py(X, r.y, Z));
        });
        g.closePath();
        g.globalAlpha = 1 - r.k * r.k;
        g.lineWidth = 4;
        g.strokeStyle = css(pal.hl);
        g.stroke();
        g.globalAlpha = 1;
      }
    },
    dispose() {},
  };
}

// ── easing ────────────────────────────────────────────────────────────
const lin = (k) => k;
const easeIO = (k) => (k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2);
const easeOut = (k) => 1 - (1 - k) ** 3;
const backOut = (k) => 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2;
const noop = () => {};

// ── the game ──────────────────────────────────────────────────────────
const MILESTONES = {
  10: ['Ten high', 'Cute. Keep those hands steady.'],
  25: ['25 up', 'Above the treeline, you two.'],
  50: ['Fifty!', 'Is this even legal?'],
  75: ['75 high', 'Hold hands. Don’t look down.'],
  100: ['One hundred', 'Frame this one.'],
};
const LS_LAST = 'ju.tower.lastmode';
const EMPTY = [];
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

registerGame({
  id: 'tower',
  title: 'Tower Together',
  blurb: 'Take turns stacking. How high can you two go?',
  kind: 'turns',
  team: true,
  immersive: true,
  tags: ['silly', '3d'],
  platforms: ['phone', 'computer'],
  minutes: 4,
  endDelay: 'manual',
  endLookLabel: 'See the tower',
  howTo: [
    'On your turn, tap (or press Space) to drop the sliding block.',
    'Whatever hangs over the edge gets sliced off. Miss completely and it’s over.',
    'Land it dead on for a perfect. Perfects in a row grow it back.',
    'Whoever goes first can pick a twist (Duet, Windy, Hard Hat): gifts and landmark levels.',
  ],
  init, next, apply, result, score,

  css: `
    .g-tower { flex: 1; display: flex; flex-direction: column; min-height: 0; padding: 2px 0 6px; }
    .g-tower .gt-view { position: relative; flex: 1; min-height: 340px; max-height: 980px; border: 2px solid var(--g-ink); border-radius: var(--g-radius, 14px); box-shadow: var(--g-shadow-lg, 4px 4px 0 var(--g-ink)); background: var(--g-bg); overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; cursor: pointer; outline: none; }
    .g-tower .gt-view:focus-visible { outline: 3px solid var(--g-hl); outline-offset: -5px; }
    .g-tower .gt-view[data-phase="wait"], .g-tower .gt-view[data-phase="over"], .g-tower .gt-view[data-phase="load"], .g-tower .gt-view[data-phase="beat"] { cursor: default; }
    .gm.is-immersive .g-tower { padding: 0; }
    .gm.is-immersive .g-tower .gt-view { border: 0; border-radius: 0; box-shadow: none; max-height: none; }
    .g-tower .gt-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
    .g-tower .gt-hud { position: absolute; top: 10px; left: 56px; right: 56px; display: flex; flex-direction: column; align-items: center; gap: 5px; pointer-events: none; color: var(--g-ink); }
    .g-tower .gt-height { display: flex; align-items: baseline; gap: 6px; font-family: var(--g-font-display); }
    .g-tower .gt-height b { font-size: 2.7rem; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; text-shadow: 2px 2px 0 var(--g-hl); }
    .g-tower .gt-height span { font-size: 0.75rem; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; color: var(--g-muted); }
    .g-tower .gt-row { display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; }
    .g-tower .gt-t { display: inline-flex; align-items: center; gap: 5px; font-size: 0.8rem; font-weight: 800; white-space: nowrap; }
    .g-tower .gt-t i { width: 11px; height: 11px; border: 2px solid var(--g-ink); border-radius: 3px; }
    .g-tower .gt-t-a i { background: var(--p-a); } .g-tower .gt-t-b i { background: var(--p-b); }
    .g-tower .gt-t b { font-variant-numeric: tabular-nums; }
    .g-tower .gt-streak { display: inline-flex; align-items: center; gap: 4px; font-size: 0.68rem; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; color: var(--g-muted); }
    .g-tower .gt-streak i { width: 9px; height: 9px; border: 2px solid var(--g-ink); background: var(--g-bg); transform: rotate(45deg); margin: 0 1px; }
    .g-tower .gt-streak i.on { background: var(--g-hl); }
    .g-tower .gt-streak i.on[data-w="a"] { background: var(--p-a); }
    .g-tower .gt-streak i.on[data-w="b"] { background: var(--p-b); }
    .g-tower .gt-meta { gap: 8px; min-height: 18px; }
    .g-tower .gt-badge { padding: 1px 9px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-hl); color: var(--g-on-ink); font-size: 0.66rem; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; }
    .g-tower .gt-bestline { font-size: 0.7rem; font-weight: 800; letter-spacing: 0.04em; color: var(--g-muted); }
    .g-tower .gt-ghost { position: absolute; left: 0; top: 0; padding: 1px 8px; border: 2px dashed var(--g-ink); border-radius: 999px; background: var(--g-card); color: var(--g-ink); font-size: 0.68rem; font-weight: 900; letter-spacing: 0.04em; white-space: nowrap; pointer-events: none; will-change: transform; }
    .g-tower .gt-calls { position: absolute; top: 110px; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: 22px; pointer-events: none; }
    .g-tower .gt-stamp { display: none; padding: 7px 16px; border: 2px solid var(--g-ink); border-radius: 8px; background: var(--g-hl); color: var(--g-on-ink); box-shadow: var(--g-shadow); font: 900 1.3rem/1.1 var(--g-font-display); letter-spacing: 0.05em; text-transform: uppercase; white-space: nowrap; pointer-events: none; opacity: 0; transform: rotate(-5deg); }
    .g-tower .gt-stamp.show { display: block; }
    .g-tower .gt-stamp.is-near { background: var(--g-card); color: var(--g-ink); }
    .g-tower .gt-stamp.show { animation: gt-stamp 1150ms cubic-bezier(.2, .9, .3, 1.25) both; }
    @keyframes gt-stamp {
      0% { opacity: 0; transform: translateY(10px) rotate(-5deg) scale(.55); }
      14% { opacity: 1; transform: rotate(-5deg) scale(1.1); }
      24%, 78% { opacity: 1; transform: rotate(-5deg) scale(1); }
      100% { opacity: 0; transform: translateY(-12px) rotate(-5deg) scale(.96); }
    }
    .g-tower .gt-banner { display: none; flex-direction: column; align-items: center; gap: 2px; max-width: 86%; padding: 8px 18px; border: 2px solid var(--g-ink); border-radius: 8px; background: var(--g-card); color: var(--g-ink); box-shadow: var(--g-shadow); text-align: center; pointer-events: none; opacity: 0; transform: rotate(3deg); }
    .g-tower .gt-banner.show { display: flex; }
    .g-tower .gt-banner b { font: 900 1.15rem/1.1 var(--g-font-display); letter-spacing: 0.04em; text-transform: uppercase; }
    .g-tower .gt-banner span { font-size: 0.8rem; font-weight: 800; color: var(--g-muted); }
    .g-tower .gt-banner span:empty { display: none; }
    .g-tower .gt-banner.is-best { background: var(--g-hl); color: var(--g-on-ink); }
    .g-tower .gt-banner.is-best span { color: var(--g-on-ink); }
    .g-tower .gt-banner.show { animation: gt-banner 1900ms cubic-bezier(.2, .9, .3, 1.2) both; }
    @keyframes gt-banner {
      0% { opacity: 0; transform: translateY(14px) rotate(3deg) scale(.6); }
      12% { opacity: 1; transform: rotate(3deg) scale(1.08); }
      20%, 82% { opacity: 1; transform: rotate(3deg) scale(1); }
      100% { opacity: 0; transform: translateY(-12px) rotate(3deg) scale(.96); }
    }
    .g-tower .gt-turn { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); padding: 11px 18px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-card); color: var(--g-ink); box-shadow: var(--g-shadow); font-weight: 900; font-size: 0.95rem; white-space: nowrap; pointer-events: none; }
    .g-tower .gt-turn.p-a { background: var(--p-a); color: var(--g-on-ink); }
    .g-tower .gt-turn.p-b { background: var(--p-b); color: var(--g-on-ink); }
    .g-tower .gt-turn.is-go { animation: gt-bob 1.5s ease-in-out infinite; }
    @keyframes gt-bob { 0%, 100% { transform: translate(-50%, 0); } 50% { transform: translate(-50%, -3px); } }
    .g-tower .gt-beat { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%); padding: 10px 22px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-hl); color: var(--g-on-ink); box-shadow: var(--g-shadow); font: 900 1.35rem/1.1 var(--g-font-display); letter-spacing: 0.03em; white-space: nowrap; pointer-events: none; animation: gt-beat 260ms cubic-bezier(.2, .9, .3, 1.3) both; }
    .g-tower .gt-beat.p-a { background: var(--p-a); } .g-tower .gt-beat.p-b { background: var(--p-b); }
    /* the hand-off beat sits where the turn pill does (bottom), so it never covers a stamp or a banner */
    .g-tower .gt-beat.is-hand { top: auto; left: 50%; bottom: 16px; padding: 11px 22px; font-size: 1.15rem; transform: translateX(-50%); animation: gt-beat-h 220ms ease-out both; }
    .gm.is-immersive .g-tower .gt-beat.is-hand { bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
    .g-tower .gt-view[data-phase="beat"] .gt-turn { visibility: hidden; }
    @keyframes gt-beat-h { 0% { opacity: 0; scale: .85; } 100% { opacity: 1; scale: 1; } }
    .g-tower .gt-beat.is-count { min-width: 84px; text-align: center; padding: 4px 24px; border-radius: 20px; font-size: 3rem; }
    @keyframes gt-beat { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.6); } 100% { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
    .g-tower .gt-pick { position: absolute; left: 12px; right: 12px; bottom: 70px; max-width: 520px; margin: 0 auto; display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 2px solid var(--g-ink); border-radius: var(--g-radius, 10px); background: var(--g-card); box-shadow: var(--g-shadow); color: var(--g-ink); }
    .g-tower .gt-pick[hidden] { display: none; }
    .g-tower .gt-pick-h { margin: 0; font-size: 0.66rem; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; color: var(--g-muted); }
    .g-tower .gt-pick-f { margin: 0; font-size: 0.66rem; font-weight: 700; color: var(--g-muted); }
    .g-tower .gt-pick-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .g-tower .gt-chip { min-height: 48px; min-width: 0; padding: 5px 10px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 1px; text-align: left; border: 2px solid var(--g-ink); border-radius: var(--g-radius-sm, 6px); background: var(--g-bg); color: var(--g-ink); font: inherit; cursor: pointer; touch-action: manipulation; box-shadow: var(--g-shadow-sm, 2px 2px 0 var(--g-ink)); }
    .g-tower .gt-chip b { font-family: var(--g-font-display); font-weight: 900; font-size: 0.8rem; letter-spacing: 0.02em; }
    .g-tower .gt-chip span { max-width: 100%; font-size: 0.68rem; font-weight: 700; color: var(--g-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .g-tower .gt-chip.is-last { background: var(--g-hl-soft, var(--g-hl)); }
    .g-tower .gt-chip:active { transform: translate(2px, 2px); box-shadow: none; }
    .g-tower .gt-chip:focus-visible { outline: 3px solid var(--g-hl); outline-offset: 2px; }
    .g-tower .gt-panel { position: absolute; left: 50%; bottom: 14px; width: min(460px, calc(100% - 24px)); transform: translate(-50%, 26px); opacity: 0; visibility: hidden; display: flex; flex-direction: column; gap: 7px; padding: 11px 14px 12px; border: 2px solid var(--g-ink); border-radius: var(--g-radius, 10px); background: var(--g-card); box-shadow: var(--g-shadow-lg, 4px 4px 0 var(--g-ink)); color: var(--g-ink); transition: transform 380ms cubic-bezier(.2, .9, .3, 1.15), opacity 220ms linear; }
    .g-tower .gt-panel.show { transform: translate(-50%, 0); opacity: 1; visibility: visible; }
    .g-tower .gt-pn-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .g-tower .gt-pn-kick { font-size: 0.66rem; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; color: var(--g-muted); }
    .g-tower .gt-pn-flag { padding: 2px 10px; border: 2px solid var(--g-ink); border-radius: 6px; background: var(--g-hl); color: var(--g-on-ink); font: 900 0.8rem/1.2 var(--g-font-display); letter-spacing: 0.06em; text-transform: uppercase; transform: rotate(-4deg); }
    .g-tower .gt-pn-flag[hidden] { display: none; }
    .g-tower .gt-pn-big { display: flex; align-items: baseline; gap: 8px; font-family: var(--g-font-display); }
    .g-tower .gt-pn-big b { font-size: 2.3rem; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; text-shadow: 2px 2px 0 var(--g-hl); }
    .g-tower .gt-pn-big span { font-size: 0.78rem; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; color: var(--g-muted); }
    .g-tower .gt-pn-best { margin: 0; font-size: 0.82rem; font-weight: 800; }
    .g-tower .gt-pn-who { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 0.8rem; font-weight: 800; }
    .g-tower .gt-pn-who span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
    .g-tower .gt-pn-who i { width: 11px; height: 11px; border: 2px solid var(--g-ink); border-radius: 3px; }
    .g-tower .gt-pn-who .a i { background: var(--p-a); } .g-tower .gt-pn-who .b i { background: var(--p-b); }
    .g-tower .gt-pn-btns { display: flex; gap: 8px; margin-top: 2px; }
    .g-tower .gt-pn-btns .gm-btn { flex: 1; min-height: 46px; }
    .g-tower .gt-load { position: absolute; inset: 0; display: grid; place-items: center; background: var(--g-bg); color: var(--g-muted); font-weight: 800; letter-spacing: 0.02em; }
    .g-tower .gt-view:not([data-phase="load"]) .gt-load { display: none; }
    .g-tower .gt-note { position: absolute; left: 12px; right: 12px; bottom: 70px; margin: 0; text-align: center; font-size: 0.8rem; font-weight: 700; color: var(--g-muted); pointer-events: none; }
    .g-tower .gt-view.has-pick .gt-note { bottom: auto; top: var(--gt-hud-b, 112px); } /* measureHud() sets --gt-hud-b: just under the HUD, whatever its height */
    /* full screen: keep the HUD clear of the notch and the home bar */
    .gm.is-immersive .g-tower .gt-hud { top: calc(10px + env(safe-area-inset-top, 0px)); left: calc(56px + env(safe-area-inset-left, 0px)); right: calc(56px + env(safe-area-inset-right, 0px)); }
    .gm.is-immersive .g-tower .gt-turn { bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
    .gm.is-immersive .g-tower .gt-note { bottom: calc(70px + env(safe-area-inset-bottom, 0px)); }
    .gm.is-immersive .g-tower .gt-pick { bottom: calc(70px + env(safe-area-inset-bottom, 0px)); }
    .gm.is-immersive .g-tower .gt-panel { bottom: calc(14px + env(safe-area-inset-bottom, 0px)); }
    /* a phone on its side: the turn pill, picker and panel move to the right, off the tower */
    @media (orientation: landscape) and (max-height: 520px) {
      .g-tower .gt-turn { left: auto; right: calc(14px + env(safe-area-inset-right, 0px)); transform: none; }
      .g-tower .gt-turn.is-go { animation-name: gt-bob-r; }
      .g-tower .gt-beat.is-hand, .gm.is-immersive .g-tower .gt-beat.is-hand { left: auto; right: calc(14px + env(safe-area-inset-right, 0px)); transform: none; }
      .g-tower .gt-calls { right: calc(50% + 40px); left: max(12px, env(safe-area-inset-left, 0px)); align-items: flex-start; gap: 32px; }
      .g-tower .gt-banner { max-width: 100%; padding: 6px 12px; transform-origin: left center; } /* pops from the left edge, so it can't overshoot it */
      .g-tower .gt-banner b { font-size: 0.95rem; }
      .g-tower .gt-banner span { font-size: 0.7rem; }
      .g-tower .gt-stamp { transform-origin: left center; font-size: 1.05rem; padding: 5px 12px; }
      .g-tower .gt-note { left: auto; right: calc(14px + env(safe-area-inset-right, 0px)); max-width: 40%; text-align: right; }
      .g-tower .gt-pick, .gm.is-immersive .g-tower .gt-pick { left: auto; right: calc(12px + env(safe-area-inset-right, 0px)); bottom: calc(66px + env(safe-area-inset-bottom, 0px)); width: min(330px, 44%); }
      .g-tower .gt-panel, .gm.is-immersive .g-tower .gt-panel { left: auto; right: calc(12px + env(safe-area-inset-right, 0px)); bottom: calc(12px + env(safe-area-inset-bottom, 0px)); width: min(330px, 42%); transform: translate(0, 26px); padding: 8px 12px 10px; gap: 5px; }
      .g-tower .gt-panel.show, .gm.is-immersive .g-tower .gt-panel.show { transform: none; }
      .g-tower .gt-pn-btns .gm-btn { white-space: nowrap; min-height: 44px; padding-inline: 8px; }
      .g-tower .gt-pn-big b { font-size: 1.8rem; }
    }
    @keyframes gt-bob-r { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(0, -3px); } }
    @media (prefers-reduced-motion: reduce) {
      .g-tower .gt-stamp.show { animation: gt-fade 1100ms linear both; }
      .g-tower .gt-banner.show { animation: gt-fade 1500ms linear both; }
      .g-tower .gt-beat, .g-tower .gt-beat.is-hand { animation: none; }
      .g-tower .gt-panel { transition: none; }
      .g-tower .gt-turn.is-go { animation: none; }
      @keyframes gt-fade { 0%, 100% { opacity: 0; } 8%, 80% { opacity: 1; } }
    }
  `,

  mount(el, api) {
    const threeP = api.three(); // start loading right away
    threeP.catch(noop);
    el.innerHTML = `<div class="g-tower">
      <div class="gt-view" data-phase="load" data-gl="" data-armed="0" data-mode="classic" tabindex="0" role="application" aria-label="Tower Together. Tap or press Space to drop the block on your turn.">
        <canvas class="gt-canvas" aria-hidden="true"></canvas>
        <div class="gt-hud" aria-hidden="true">
          <div class="gt-height"><b>0</b><span>high</span></div>
          <div class="gt-row">
            <span class="gt-t gt-t-a"><i></i><span class="gt-n"></span><b>0</b></span>
            <span class="gt-t gt-t-b"><i></i><span class="gt-n"></span><b>0</b></span>
            <span class="gt-streak">Perfects <i></i><i></i><i></i></span>
          </div>
          <div class="gt-row gt-meta"><span class="gt-badge" hidden></span><span class="gt-bestline" hidden></span></div>
        </div>
        <div class="gt-ghost" hidden aria-hidden="true"></div>
        <div class="gt-calls" aria-hidden="true">
          <div class="gt-banner"><b></b><span></span></div>
          <div class="gt-stamp"></div>
        </div>
        <div class="gt-beat" aria-live="polite" hidden></div>
        <div class="gt-pick" hidden>
          <p class="gt-pick-h">Pick a twist, or just drop to play classic</p>
          <div class="gt-pick-row">${MODE_IDS.map((m) => `<button type="button" class="gt-chip" data-mode="${m}"><b>${MODES[m].name}</b><span>${MODES[m].hint}</span></button>`).join('')}</div>
          <p class="gt-pick-f">Twists add gifts &amp; golden landmark levels.</p>
        </div>
        <div class="gt-turn" aria-live="polite" hidden></div>
        <p class="gt-note" hidden></p>
        <div class="gt-panel" hidden>
          <div class="gt-pn-top"><span class="gt-pn-kick"></span><span class="gt-pn-flag" hidden>New best</span></div>
          <div class="gt-pn-big"><b>0</b><span>high</span></div>
          <p class="gt-pn-best"></p>
          <div class="gt-pn-who"></div>
          <div class="gt-pn-btns"><button type="button" class="gm-btn" data-g="rematch">Rematch</button><button type="button" class="gm-btn gm-btn-ghost" data-g="close">Back</button></div>
        </div>
        <div class="gt-load"><span>Stacking the blocks…</span></div>
      </div>
    </div>`;
    const $ = (s) => el.querySelector(s);
    const wrap = $('.gt-view');
    const canvas = $('.gt-canvas');
    const hudEl = $('.gt-hud');
    const turnEl = $('.gt-turn');
    const beatEl = $('.gt-beat');
    const pickEl = $('.gt-pick');
    const ghostEl = $('.gt-ghost');
    const bannerEl = $('.gt-banner');
    const stampEl = $('.gt-stamp');
    const callsEl = $('.gt-calls');
    const panelEl = $('.gt-panel');
    const badgeEl = $('.gt-badge');
    const bestEl = $('.gt-bestline');
    const diamonds = Array.from(el.querySelectorAll('.gt-streak i'));
    $('.gt-t-a .gt-n').textContent = api.name('a');
    $('.gt-t-b .gt-n').textContent = api.name('b');
    const T = () => (typeof window !== 'undefined' && window.__towerTest) || null; // test hook only
    const log = (ev) => { const t = T(); if (t) (t.log || (t.log = [])).push(ev); };
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = () => matchMedia('(pointer: coarse)').matches;
    // Turn games don't get api.data() from the engine (live games do), so use the same store directly.
    const store = typeof api.data === 'function' && typeof api.setData === 'function' ? api : gameDataApi('tower');
    const dataOK = !!store && typeof store.data === 'function' && typeof store.setData === 'function';

    let dead = false;
    let view = null;
    let pal = readPalette(api);
    let ctxNow = null;
    let shownMoves = -1;
    let finaleDone = false;
    let slider = null;
    let pending = null;
    let raf = 0;
    let lastT = 0;
    let paused = typeof document !== 'undefined' && document.hidden;
    let glLost = false;
    let cssW = 1;
    let cssH = 1;
    let ema = 16;
    let perfN = 0;
    let readyRes;
    let openedOver = null;
    let bestRef = 0;        // the best height in this mode before this run (frozen once the run is over)
    let bestFrozen = false;
    let bestHit = false;
    let runInfo = null;
    let lastActor = null;
    let resuming = false;
    let beatMoves = -1;
    let pickBusy = false;
    let hudBottom = 100;
    let ghostY = 0; let ghostHalf = 2; let ghostW = 64; let ghostOn = false; let ghostX = -1; let ghostYpx = -1;
    let bTimer = 0;
    let unData = null;
    let bq = null;          // the one banner waiting for a record to be read (older ones are stale)
    let bShown = null;
    let bBusy = false;
    const ready = new Promise((r) => { readyRes = r; });
    const model = { blocks: [], pieces: [], slider: null, ring: null, deco: [], extras: EMPTY, cam: { y: CAM_LEAD, zoom: 1, viewH: 12, sx: 0, ox: 0 }, staticDirty: true, mode: 'classic', modeSet: false };
    const goal = { y: CAM_LEAD, zoom: 1, ox: 0 };
    const anims = new Set();
    const flagE = [{ tint: 'ink' }, { tint: 'hl' }, { tint: 'hl' }, { tint: 'hl' }].map((p) => ({ x: 0, y: 0, z: 0, w: 0.1, h: 0.1, d: 0.1, who: null, live: true, lift: 0, rx: 0, rz: 0, flash: 0, ...p }));

    const baseViewH = () => Math.max(VIEW_W * cssH / cssW, MIN_VIEW_H);
    const phase = (p) => { wrap.dataset.phase = p; };
    const seedOf = () => (ctxNow && ctxNow.state && ctxNow.state.seed !== undefined ? ctxNow.state.seed : 0);
    const spec = () => MODES[model.mode] || MODES.classic;
    const setArmed = (on) => { const v = on ? '1' : '0'; if (wrap.dataset.armed !== v) wrap.dataset.armed = v; if (slider) slider.armed = on; };

    // screen position (css px) of a world point, from the current camera
    const proj = [0, 0];
    function project(x, y, z) {
      const c = model.cam; const sc = cssH / c.viewH;
      proj[0] = cssW / 2 + ((x - z) * Math.SQRT1_2 - (c.sx || 0) - (c.ox || 0)) * sc;
      proj[1] = cssH / 2 - ((-(x + z) * Math.SQRT1_2 * SINP + y * COSP) - c.y * COSP) * sc;
      return proj;
    }
    /** Top and bottom of the whole tower on screen (css px), for the fit check. */
    function towerExtent() {
      const n = model.blocks.length - 1; const top = Math.max(0, n) * BH;
      let lo = Infinity; let hi = -Infinity; let l = Infinity; let r = -Infinity;
      for (const y of [-PED, top]) for (const x of [-BASE / 2, BASE / 2]) for (const z of [-BASE / 2, BASE / 2]) { const p = project(x, y, z); lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); l = Math.min(l, p[0]); r = Math.max(r, p[0]); }
      return { top: lo, bottom: hi, left: l, right: r, hud: hudBottom, h: cssH };
    }

    // ── loop ──
    function frame(now) {
      raf = 0;
      if (dead || paused || glLost) return;
      const dt = lastT ? Math.min(0.05, Math.max(0, (now - lastT) / 1000)) : 1 / 60;
      lastT = now;
      for (const a of anims) {
        a.t += dt * 1000;
        const k = Math.min(1, a.t / a.dur);
        a.step(a.ease(k));
        if (k >= 1) { anims.delete(a); a.res(); }
      }
      stepSlider(dt);
      stepPieces(dt);
      const c = model.cam;
      const f = 1 - Math.exp(-dt * 4.5);
      c.y += (goal.y - c.y) * f;
      c.zoom += (goal.zoom - c.zoom) * f;
      c.ox += (goal.ox - c.ox) * f;
      const camBusy = Math.abs(goal.y - c.y) > 0.002 || Math.abs(goal.zoom - c.zoom) > 0.0005 || Math.abs(goal.ox - c.ox) > 0.002;
      if (!camBusy) { c.y = goal.y; c.zoom = goal.zoom; c.ox = goal.ox; }
      c.viewH = baseViewH() * c.zoom;
      let calls = 0;
      if (view) {
        cullDeco();
        calls = view.render(model);
        placeGhost();
        tunePerf(dt);
      }
      const t = T();
      if (t) { t.frames = (t.frames || 0) + 1; t.calls = calls; t.ratio = view && view.ratio; }
      if (anims.size || slider || model.pieces.length || model.ring || camBusy) raf = requestAnimationFrame(frame);
      else lastT = 0;
    }
    function kick() { if (!raf && !dead && !paused && !glLost && view) raf = requestAnimationFrame(frame); }
    // Dynamic resolution: step the pixel ratio down while frames run slow.
    function tunePerf(dt) {
      if (!lastT) return;
      ema = ema * 0.92 + dt * 1000 * 0.08;
      if (++perfN > 50 && ema > 24 && view.ratio > 1) {
        view.setRatio(Math.max(1, view.ratio - 0.25));
        perfN = 0;
        ema = 16;
      }
    }
    function tween(ms, step, ease = easeIO) {
      return new Promise((res) => {
        if (dead) return;
        if (!(ms > 0)) { step(1); res(); return; }
        anims.add({ t: 0, dur: ms, step, ease, res });
        kick();
      });
    }
    const wait = (ms) => tween(ms, noop, lin);
    const hold = (e) => { e.holds = (e.holds || 0) + 1; e.live = true; };
    const release = (e) => { e.holds = Math.max(0, (e.holds || 0) - 1); if (!e.holds) { e.live = false; model.staticDirty = true; } };

    function placeAt(e, prev, axis, o) {
      e.x = prev.x + (axis === 'x' ? o : 0);
      e.z = prev.z + (axis === 'z' ? o : 0);
    }
    /** Tag an entry as a gift (ribbons) and/or a landmark (golden). */
    function mark(e, gift, lm) {
      if (gift && !e.rib) e.rib = makeRibbons();
      if (lm) e.tint = 'hl';
    }
    function newEntry(level, who, prev) {
      const e = { x: prev.x, y: yOf(level), z: prev.z, w: prev.w, h: BH, d: prev.d, who, live: true, holds: 0, flash: 0, lift: 0, rx: 0, rz: 0 };
      const sp = spec();
      mark(e, isGift(seedOf(), level, sp), isLandmark(level, sp));
      return e;
    }
    function windFor(level) {
      if (model.mode !== 'windy' || level < WIND_MIN_LEVEL) return null;
      const sd = seedOf();
      return { dir: rand(sd, 'wdir', level) < 0.5 ? -1 : 1, w: 2.2 + rand(sd, 'ww', level) * 2.2, ph: rand(sd, 'wph', level) * 6.283, amp: Math.min(0.5, 0.16 + level * 0.008) };
    }
    function stepSlider(dt) {
      const s = slider;
      if (!s || s.frozen || s.hold) return;
      s.age += dt;
      let v = s.v;
      const w = s.wind;
      if (w) v *= 1 + w.amp * (0.65 * Math.sin(s.age * w.w + w.ph) + 0.35 * w.dir * (s.u < 2 * s.A ? 1 : -1) * s.dir);
      s.u = (s.u + v * dt) % (4 * s.A);
      const tri = s.u < 2 * s.A ? s.u : 4 * s.A - s.u;
      s.p = s.start + s.dir * tri;
      if (!s.entered && Math.abs(s.p) < s.A - 0.46) s.entered = true;
      const armed = s.entered && s.age >= ARM_MS / 1000;
      if (armed !== s.armed) setArmed(armed);
      placeAt(s.e, s.prev, s.axis, s.p);
      if (w) updateFlag(s);
    }
    function updateFlag(s) { // the wind streamer on the back corner of the tower: lies flat in a gust, droops in a lull
      const pv = s.prev; const top = pv.y + pv.h / 2;
      const px = pv.x - pv.w / 2 - 0.22; const pz = pv.z - pv.d / 2 - 0.22;
      const w = s.wind; const gust = 0.5 + 0.5 * Math.sin(s.age * w.w + w.ph);
      const pole = flagE[0];
      pole.x = px; pole.z = pz; pole.y = top + 0.8; pole.w = 0.1; pole.d = 0.1; pole.h = 1.6;
      const L = 0.3 + 0.2 * gust; const alongX = s.axis === 'x';
      for (let k = 0; k < 3; k++) {
        const q = flagE[1 + k]; const off = w.dir * (0.1 + L * (k + 0.5) + 0.03 * k);
        q.x = px + (alongX ? off : 0); q.z = pz + (alongX ? 0 : off);
        q.y = top + 1.36 - (1 - gust) * 0.2 * (k + 1) + Math.sin(s.age * 7 + k * 1.1) * 0.05 * gust;
        q.w = alongX ? L : 0.08; q.d = alongX ? 0.08 : L; q.h = 0.24 - 0.05 * k;
      }
    }
    function stepPieces(dt) {
      const ps = model.pieces;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.vy -= 15 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.rx += p.wx * dt; p.rz += p.wz * dt;
        p.t += dt;
        if (p.t > 2.4) ps.splice(i, 1);
      }
    }
    function addPiece(src, axis, dir) {
      const calm = reduced();
      model.pieces.push({
        x: src.x, y: src.y, z: src.z, w: src.w, h: src.h, d: src.d, who: src.who, tint: src.tint, flash: 0, lift: 0, live: true,
        rx: 0, rz: 0, t: 0,
        vx: calm ? 0 : axis === 'x' ? dir * 1.5 : 0, vz: calm ? 0 : axis === 'z' ? dir * 1.5 : 0, vy: calm ? -1 : 1.1,
        wx: calm ? 0 : axis === 'z' ? dir * 3.2 : 0, wz: calm ? 0 : axis === 'x' ? -dir * 3.2 : 0,
      });
      kick();
    }
    function blink(e, ms) {
      hold(e);
      e.flash = 1;
      tween(ms, (k) => { e.flash = k < 1 ? 1 : 0; }, lin).then(() => { e.flash = 0; release(e); });
    }
    function settle(e) { // the kept block lands with a tiny bump
      if (reduced()) return;
      hold(e);
      tween(150, (k) => { e.lift = 0.07 * (1 - k); }, easeOut).then(() => { e.lift = 0; release(e); });
    }
    function ringAt(e) {
      const r = { x: e.x, y: e.y + e.h / 2, z: e.z, w: e.w, d: e.d, k: 0 };
      model.ring = r;
      tween(reduced() ? 200 : 560, (k) => { r.k = k; }, easeOut).then(() => { if (model.ring === r) model.ring = null; });
    }
    function shake() {
      if (reduced()) return;
      tween(420, (k) => { model.cam.sx = Math.sin(k * 34) * (1 - k) * 0.14; }, lin).then(() => { model.cam.sx = 0; });
    }
    function stamp(text, cls = '') {
      const st = stampEl;
      st.textContent = text;
      st.className = `gt-stamp ${cls}`;
      void st.offsetWidth;
      st.classList.add('show');
    }
    // the callouts take no room once their animation has finished
    stampEl.addEventListener('animationend', () => stampEl.classList.remove('show'));
    bannerEl.addEventListener('animationend', () => bannerEl.classList.remove('show'));
    /** A longer callout: milestones, records, gifts (a drop's callouts arrive merged into one). A newer banner replaces the
     *  one on screen at once, except that a record (prio) is left alone for 1.2 s so it can be read. */
    const KEEP_MS = 1200;
    function banner(title, sub, cls, prio) {
      const it = { t: title, s: sub || '', c: cls || '', at: Date.now(), prio: !!prio };
      const age = bShown ? Date.now() - bShown.at : Infinity;
      if (bBusy && bShown && bShown.prio && !prio && age < KEEP_MS) { // wait out the record, then show only the newest
        bq = it; clearTimeout(bTimer); bTimer = setTimeout(nextBanner, KEEP_MS - age);
        return;
      }
      clearTimeout(bTimer); bq = null;
      showBanner(it);
    }
    function showBanner(it) {
      if (dead) { bBusy = false; return; }
      bBusy = true; bShown = it;
      bannerEl.querySelector('b').textContent = it.t;
      bannerEl.querySelector('span').textContent = it.s;
      bannerEl.className = `gt-banner ${it.c}`;
      void bannerEl.offsetWidth;
      bannerEl.classList.add('show');
      bTimer = setTimeout(nextBanner, reduced() ? 1500 : 1900);
    }
    function nextBanner() {
      const it = bq; bq = null;
      if (!it || dead || Date.now() - it.at > 2600) { bBusy = false; bShown = null; return; }
      showBanner(it);
    }
    /** The perfect chime climbs a semitone for every perfect in a row (up to an octave). */
    function ding(streak) {
      if (api.muted && api.muted()) return;
      const ac = api.audio && api.audio();
      if (!ac) { api.sfx('good'); return; }
      try {
        const f = 523.25 * 2 ** ((Math.min(Math.max(streak, 1), 13) - 1) / 12);
        let t = ac.currentTime + 0.005;
        for (const [m, d] of [[1, 0.07], [1.26, 0.07], [1.5, 0.14]]) {
          const o = ac.createOscillator(); const g = ac.createGain();
          o.type = 'triangle'; o.frequency.setValueAtTime(f * m, t);
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
          o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d + 0.02);
          t += d * 0.85;
        }
      } catch { api.sfx('good'); }
    }
    function setHeight(n) { $('.gt-height b').textContent = String(Math.max(0, n)); }
    /** The perfect-streak diamonds: yellow for three (classic, windy, hard); player-coloured pairs in duet. */
    function paintStreak(s) {
      const duet = modeOf(s) === 'duet';
      const per = duet ? 2 : STREAK;
      const d = s.drop;
      const grew = !!(d && d.grew && d.perfect && s.streak > 0 && s.streak % per === 0);
      const on = grew ? per : s.streak % per;
      diamonds[2].style.display = duet ? 'none' : '';
      const nb = s.blocks.length;
      diamonds.forEach((i, k) => {
        const lit = k < on;
        i.classList.toggle('on', lit);
        const b = duet && lit ? s.blocks[nb - on + k] : null;
        if (b && b.who) i.dataset.w = b.who; else delete i.dataset.w;
      });
    }

    // ── records (api.data) ──
    const bestKey = (m) => `h_${m}_best`;
    /** True when the stored records already include this very match (the other phone recorded it first). */
    function ownRecord(c) { if (!dataOK || !c || c.matchId === undefined) return false; try { return (store.data() || {}).last_id === String(c.matchId); } catch { return false; } }
    function readBest(mode) { if (!dataOK) return 0; try { return num((store.data() || {})[bestKey(mode)]); } catch { return 0; } }
    function refreshBest(mode = model.mode) {
      if (bestFrozen) return;
      if (ctxNow && ownRecord(ctxNow)) return; // the other phone already counted this run: it is not the "best before"
      const b = readBest(mode);
      if (b !== bestRef) { bestRef = b; rebuildDeco(); kick(); }
    }
    /** The ghost of the best tower so far in this mode: a dashed ring at its height, plus a "Best N" tag. */
    function rebuildDeco() {
      const d = model.deco;
      d.length = 0;
      ghostOn = bestRef >= 1;
      if (ghostOn) {
        ghostHalf = MODES[model.mode].base / 2 + 0.45;
        ghostY = bestRef * BH + 0.05;
        const mk = (x, z, w, dd) => ({ x, y: ghostY, z, w, h: 0.08, d: dd, who: null, tint: 'hl', live: false, lift: 0, rx: 0, rz: 0, flash: 0 });
        for (const sg of [-1, 1]) for (const f of [-0.75, -0.25, 0.25, 0.75]) {
          d.push(mk(f * ghostHalf, sg * ghostHalf, 0.55, 0.08));
          d.push(mk(sg * ghostHalf, f * ghostHalf, 0.08, 0.55));
        }
        ghostEl.textContent = `Best ${bestRef}`;
        ghostW = 0;
        bestEl.textContent = `Best ${bestRef}`;
      }
      ghostEl.hidden = !ghostOn;
      bestEl.hidden = !ghostOn;
      ghostX = ghostYpx = -1;
      model.staticDirty = true;
      measureHud();
    }
    function placeGhost() {
      if (!ghostOn || !ghostEl) return;
      if (!ghostW) ghostW = ghostEl.offsetWidth || 64;
      const p = project(ghostHalf, ghostY, -ghostHalf);
      const x = Math.round(Math.min(p[0] + 8, cssW - ghostW - 8));
      const y = Math.round(p[1] - 11);
      const vis = y > hudBottom && y < cssH - 76;
      if (vis !== !ghostEl.hidden) ghostEl.hidden = !vis;
      if (vis && (x !== ghostX || y !== ghostYpx)) { ghostX = x; ghostYpx = y; ghostEl.style.transform = `translate(${x}px, ${y}px)`; }
    }
    function measureHud() { hudBottom = hudEl.offsetTop + hudEl.offsetHeight + 4; callsEl.style.top = `${Math.round(hudBottom + 10)}px`; wrap.style.setProperty('--gt-hud-b', `${Math.round(hudBottom + 8)}px`); }
    /** Hide the ghost ring's dashes that sit above the bottom of the HUD (they would print over the numbers). */
    function cullDeco() {
      const d = model.deco;
      let changed = false;
      for (let i = 0; i < d.length; i++) {
        const e = d[i];
        const off = project(e.x, e.y, e.z)[1] < hudBottom;
        if (off !== !!e.off) { e.off = off; changed = true; }
      }
      if (changed) model.staticDirty = true;
    }
    /** Tally the run once, at the finale of a match that was still being played when this phone opened it. */
    function recordRun(c) {
      const s = c.state; const mode = modeOf(s); const h = s.blocks.length - 1;
      const info = { mode, h, run: longestRun(s.blocks), pa: s.perfects.a, pb: s.perfects.b, prev: bestRef, best: Math.max(bestRef, h), newBest: !openedOver && h >= 3 && h > bestRef };
      if (!dataOK || openedOver) return info;
      try {
        const d = store.data() || {};
        if (d.last_id === c.matchId) return info; // the other phone already counted this one
        store.setData({
          [bestKey(mode)]: Math.max(num(d[bestKey(mode)]), h),
          streak_best: Math.max(num(d.streak_best), info.run),
          towers_n: num(d.towers_n) + 1,
          blocks_n: num(d.blocks_n) + h,
          perf_a_n: num(d.perf_a_n) + info.pa,
          perf_b_n: num(d.perf_b_n) + info.pb,
          last_id: String(c.matchId),
        });
      } catch (err) { console.warn('[tower] records', err); }
      return info;
    }

    // ── model building ──
    /** Switch the view to the match's mode (set by the setup move). Returns true if it changed. */
    function applyMode(s) {
      const m = modeOf(s);
      if (model.modeSet && m === model.mode) return false;
      const was = model.modeSet;
      model.mode = m; model.modeSet = true;
      wrap.dataset.mode = m;
      model.blocks.length = 0; // the base may have a different size
      if (view) view.setBase(MODES[m].base);
      const named = m !== 'classic';
      badgeEl.hidden = !named;
      badgeEl.textContent = MODES[m].name;
      refreshBest();
      rebuildDeco();
      if (was && ctxNow) {
        // the starter's own pick needs no toast (the badge and the vanishing picker say it); the partner is told, briefly
        if (ctxNow.mode === 'online' && ctxNow.first !== ctxNow.me) {
          const msg = `${api.name(ctxNow.first)} picked ${MODES[m].name}`;
          api.toast(msg);
          setTimeout(() => { if (!dead) document.querySelectorAll('.toast').forEach((t) => { if (t.textContent === msg) t.classList.remove('show'); }); }, 1500);
        }
        log(`mode:${m}`);
      }
      return true;
    }
    function build(s, count) {
      if (slider && !pending) stopSlider();
      applyMode(s);
      const bl = model.blocks;
      if (bl.length > count) bl.length = count;
      for (let i = bl.length; i < count; i++) {
        const b = s.blocks[i];
        const e = { x: b.x, y: yOf(i), z: b.z, w: b.w, h: hOf(i), d: b.d, who: b.who, live: false, holds: 0, flash: 0, lift: 0, rx: 0, rz: 0 };
        mark(e, b.gift, b.lm);
        bl.push(e);
      }
      model.staticDirty = true;
      setHeight(count - 1);
      goal.y = camYFor(count - 1);
    }
    function stopSlider() { slider = null; model.slider = null; model.extras = EMPTY; setArmed(false); }
    function startSlider(level, who) {
      const prev = model.blocks[level - 1];
      if (!prev) return;
      const axis = axisOf(level);
      const size = axis === 'x' ? prev.w : prev.d;
      const A = ampOf(size);
      const start = sideOf(level, model.mode, seedOf()) * A;
      const e = newEntry(level, who, prev);
      model.slider = e;
      slider = { level, axis, A, v: speedOf(level, model.mode), u: 0, start, dir: -Math.sign(start), prev, e, p: start, frozen: false, hold: false, age: 0, entered: false, armed: false, wind: windFor(level) };
      model.extras = slider.wind ? flagE : EMPTY;
      if (slider.wind) updateFlag(slider);
      setArmed(false);
      placeAt(e, prev, axis, start);
      goal.y = camYFor(level - 1);
      lastActor = who;
      kick();
    }

    // ── animations for one drop ──
    async function intro() {
      const top = model.blocks.length - 1;
      const y1 = camYFor(top);
      if (top < 2 || reduced()) { model.cam.y = goal.y = y1; kick(); return; }
      const y0 = camYFor(0);
      model.cam.y = goal.y = y0;
      phase('intro');
      log('intro');
      await tween(Math.min(1800, 550 + top * 55), (k) => { model.cam.y = goal.y = y0 + (y1 - y0) * k; }, easeIO);
    }
    async function slideIn(drop) {
      phase('replay');
      log('replay');
      const lv = drop.level;
      const prev = model.blocks[lv - 1];
      const A = ampOf(drop.axis === 'x' ? prev.w : prev.d);
      const start = sideOf(lv, model.mode, seedOf()) * A;
      const e = newEntry(lv, drop.who, prev);
      model.slider = e;
      placeAt(e, prev, drop.axis, start);
      goal.y = camYFor(lv - 1);
      if (reduced()) { placeAt(e, prev, drop.axis, drop.o); return; }
      await wait(220);
      const ms = Math.max(300, Math.min(900, Math.abs(drop.o - start) / speedOf(lv, model.mode) * 1000));
      await tween(ms, (k) => placeAt(e, prev, drop.axis, start + (drop.o - start) * k), lin);
      await wait(70);
    }
    async function resolveDrop(drop, s) {
      phase('busy');
      const rm = reduced();
      const lv = drop.level;
      const prev = model.blocks[lv - 1];
      const e = model.slider || newEntry(lv, drop.who, prev);
      stopSlider();
      placeAt(e, prev, drop.axis, drop.o);
      log(drop.miss ? 'miss' : drop.perfect ? 'perfect' : 'drop');
      if (drop.miss) {
        api.sfx('bad');
        api.haptic(40);
        addPiece(e, drop.axis, Math.sign(drop.o) || 1);
        shake();
        await wait(rm ? 150 : 750);
        return;
      }
      const sp = spec();
      const nb = s.blocks[lv];
      const size = drop.axis === 'x' ? prev.w : prev.d;
      e.live = false;
      hold(e);
      model.blocks.push(e);
      if (drop.perfect) {
        const fx = e.x; const fz = e.z;
        await tween(rm ? 0 : 90, (k) => { e.x = fx + (nb.x - fx) * k; e.z = fz + (nb.z - fz) * k; }, easeOut);
        ding(drop.streak);
        api.haptic(15);
        blink(e, 260);
        ringAt(e);
        stamp(drop.grew && modeOf(s) === 'duet' && drop.streak % 2 === 0 ? 'Duet · it grew' : drop.grew ? 'Perfect · it grew' : drop.streak > 1 ? `Perfect ×${drop.streak}` : 'Perfect');
        paintStreak(s);
      } else {
        const keep = size - Math.abs(drop.o);
        const sw = drop.axis === 'x' ? keep : prev.w; const sd = drop.axis === 'z' ? keep : prev.d;
        e.x = nb.x; e.z = nb.z;
        e.w = drop.gift ? sw : nb.w; e.d = drop.gift ? sd : nb.d;
        const c = drop.cut;
        addPiece({ x: c.x, y: e.y, z: c.z, w: c.w, h: BH, d: c.d, who: drop.who, tint: e.tint }, drop.axis, Math.sign(drop.o));
        api.sfx('place');
        api.haptic(10);
        settle(e);
        paintStreak(s);
        if (keep < 0.25) stamp('By a whisker!', 'is-near');
        else if (Math.abs(drop.o) <= 1.6 * perfectTol(size, sp.tol)) stamp('So close!', 'is-near');
      }
      { // everything that happened on this drop goes into ONE banner (records first), so nothing queues up behind anything
        const parts = []; // [title, sub, is-best]
        const newBest = bestRef >= 1 && lv >= 3 && lv > bestRef && !bestHit; // same rule as the panel flag (recordRun): the first level past the old best, from level 3 up
        if (newBest) { bestHit = true; parts.push(['New best!', `${api.name(drop.who)} set the record`, true]); }
        if (drop.bonus) parts.push(['Landmark!', drop.grew ? `Level ${lv} bonus: it grew` : `Level ${lv} · already full size`, true]);
        if (drop.gift) parts.push(['Gift!', drop.grew ? 'It grew a little' : 'Already full size', false]);
        if (MILESTONES[lv]) parts.push([MILESTONES[lv][0], MILESTONES[lv][1], false]);
        if (parts.length) {
          const sub = (parts.find((q) => q[1]) || [])[1];
          const cls = parts.some((q) => q[2]) ? 'is-best' : '';
          banner(parts.slice(0, 2).map((q) => q[0]).join(' · '), sub, cls, newBest); // at most two titles, so it fits a narrow phone
          if (newBest) api.sfx('win'); else if (drop.gift || drop.bonus) api.sfx('pop');
        }
      }
      if (e.w !== nb.w || e.d !== nb.d) { // growth: a streak, a gift or a landmark
        const w0 = e.w; const d0 = e.d;
        await tween(rm ? 0 : 280, (k) => { e.w = w0 + (nb.w - w0) * k; e.d = d0 + (nb.d - d0) * k; }, backOut);
      }
      e.x = nb.x; e.z = nb.z; e.w = nb.w; e.d = nb.d;
      release(e);
      goal.y = camYFor(lv);
      setHeight(lv);
      await wait(rm ? 40 : 170);
    }

    /** Zoom and pan so the whole tower sits between the HUD and the panel. */
    function fitTower(n, panelPx) {
      const top = n * BH;
      const need = (top + PED) * COSP + 6 * SINP * Math.SQRT1_2 + 0.5;
      const topM = hudBottom + 6; const botM = panelPx;
      const avail = Math.max(120, cssH - topM - botM);
      goal.zoom = Math.max(1, need * cssH / avail / baseViewH());
      const sc = cssH / (baseViewH() * goal.zoom);
      goal.y = (top - PED) / 2 + (topM - botM) / 2 / (sc * COSP);
    }
    /** Fit the finished tower between the HUD and the panel (again whenever the window changes). */
    function refit() {
      const landscape = matchMedia('(orientation: landscape) and (max-height: 520px)').matches;
      const sa = parseFloat(getComputedStyle(panelEl).bottom) || 14;
      fitTower(model.blocks.length - 1, landscape ? 20 : panelEl.offsetHeight + sa + 12);
      // a phone on its side (maybe with a notch): slide the tower left until the panel at the right clears it
      goal.ox = 0;
      if (landscape) {
        const sc = cssH / (baseViewH() * goal.zoom);
        const half = (BASE / 2 + 0.25) * Math.SQRT2 * sc;
        const room = panelEl.getBoundingClientRect().left - wrap.getBoundingClientRect().left - 8;
        const shift = cssW / 2 + half - room;
        if (shift > 0) goal.ox = Math.min(shift, Math.max(0, cssW / 2 - half - 8)) / sc;
      }
      kick();
    }
    function paintPanel(info) {
      $('.gt-pn-kick').textContent = `Hall of Heights${info.mode !== 'classic' ? ` · ${MODES[info.mode].name}` : ''}`;
      $('.gt-pn-flag').hidden = !info.newBest;
      $('.gt-pn-big b').textContent = String(info.h);
      $('.gt-pn-big span').textContent = info.h === 1 ? 'block high' : 'blocks high';
      $('.gt-pn-best').textContent = info.newBest ? (info.prev ? `Old best ${info.prev}. You two beat it.` : 'First one on the board.')
        : info.best < 1 ? 'Timber, straight away. Shake it off and go again.'
        : `Best ${MODES[info.mode].name}: ${info.best}`;
      const who = $('.gt-pn-who');
      who.innerHTML = '';
      const add = (cls, txt) => { const sp = document.createElement('span'); if (cls) { sp.className = cls; sp.appendChild(document.createElement('i')); } sp.appendChild(document.createTextNode(txt)); who.appendChild(sp); };
      add('a', `${api.name('a')} ${info.pa} perfect${info.pa === 1 ? '' : 's'}`);
      add('b', `${api.name('b')} ${info.pb} perfect${info.pb === 1 ? '' : 's'}`);
      add('', `Longest streak ${info.run}`);
    }
    async function finale(c) {
      stopSlider();
      log('finale');
      phase('over');
      pickEl.hidden = true; wrap.classList.remove('has-pick');
      beatEl.hidden = true;
      const info = runInfo || (runInfo = recordRun(c));
      const n = model.blocks.length - 1;
      paintPanel(info);
      panelEl.hidden = false;
      refit();
      const t = T();
      if (t) t.extent = towerExtent;
      kick();
      const showPanel = () => { panelEl.classList.add('show'); if (info.newBest) api.sfx('win'); };
      if (openedOver) { showPanel(); return; }
      if (reduced() || n < 1) { await wait(reduced() ? 150 : 500); showPanel(); await wait(1500); api.showEnd(); return; }
      await wait(650);
      const gap = Math.min(80, 1100 / n);
      const total = gap * n + 320;
      const bl = model.blocks.slice(1, n + 1);
      bl.forEach(hold);
      api.sfx('pop');
      await tween(total, (k) => {
        const tt = k * total;
        for (let i = 0; i < bl.length; i++) {
          const u = (tt - i * gap) / 320;
          const b = u > 0 && u < 1 ? Math.sin(u * Math.PI) : 0;
          bl[i].lift = b * 0.28;
          bl[i].flash = b > 0.7 ? 1 : 0;
        }
      }, lin);
      bl.forEach((e) => { e.lift = 0; e.flash = 0; release(e); });
      showPanel();
      await wait(2300);
      api.showEnd();
    }

    // ── the pauses: a handoff beat on one phone, a countdown after coming back ──
    async function showBeat(text, ms, cls = '') {
      beatEl.textContent = text;
      beatEl.className = `gt-beat ${cls}`;
      beatEl.hidden = false;
      // restart the pop animation
      void beatEl.offsetWidth;
      await wait(ms);
      if (!dead) beatEl.hidden = true;
    }
    async function resumeCount() {
      const s = slider;
      if (!s || s.frozen || resuming) return;
      resuming = true;
      s.hold = true;
      setArmed(false);
      s.u = 0; s.age = 0; s.entered = false; s.p = s.start;
      placeAt(s.e, s.prev, s.axis, s.start);
      log('resume');
      const ms = reduced() ? 220 : 340;
      for (let k = 3; k >= 1; k--) {
        await showBeat(String(k), ms, 'is-count');
        if (dead || slider !== s) break;
      }
      resuming = false;
      if (slider === s) s.hold = false;
    }

    // ── syncing the view to the rules state ──
    let chain = Promise.resolve();
    function enqueue(fn) { chain = chain.then(() => (dead ? null : fn())).catch((e) => console.error('[tower]', e)); }

    async function sync() {
      await ready;
      for (;;) {
        const c = ctxNow;
        if (dead || !c || !c.state) return;
        if (c.moves === shownMoves) break;
        const s = c.state;
        const drop = s.drop;
        const first = shownMoves < 0;
        if (!drop || c.moves < shownMoves) {
          build(s, s.blocks.length);
          if (first) { model.cam.y = goal.y; await intro(); }
          shownMoves = c.moves;
          continue;
        }
        const mine = !!pending && pending.n === c.moves && pending.who === drop.who && !!model.slider;
        pending = null;
        if (!mine && slider) stopSlider();
        const replay = !mine && (!first || c.mode === 'local' || drop.who !== c.me);
        const animate = mine || replay;
        const before = s.blocks.length - (drop.miss ? 0 : 1);
        if (!mine) build(s, animate ? before : s.blocks.length);
        if (first) await intro();
        if (animate) {
          if (!mine) await slideIn(drop);
          await resolveDrop(drop, s);
        }
        shownMoves = c.moves;
      }
      await afterSync();
    }
    async function afterSync() {
      const c = ctxNow;
      if (!c || !c.state) return;
      const s = c.state;
      paintStreak(s);
      setHeight(s.blocks.length - 1);
      if (c.over) {
        hud();
        if (!finaleDone) { finaleDone = true; finale(c).catch((e) => console.error('[tower]', e)); }
        phase('over');
        return;
      }
      if (c.canMove) {
        if (!slider) {
          if (c.mode === 'local' && lastActor && lastActor !== c.actor && beatMoves !== c.moves) { // hand the phone over (a still pill under reduced motion)
            beatMoves = c.moves;
            hud();
            phase('beat');
            updatePick();
            await showBeat(`${api.name(c.actor)}’s turn`, reduced() ? 400 : 600, `is-hand p-${c.actor}`);
            if (dead || ctxNow !== c) return; // something newer is queued
          }
          startSlider(s.blocks.length, c.actor);
        }
        phase('slide');
      } else {
        if (slider) stopSlider();
        goal.y = camYFor(s.blocks.length - 1);
        phase('wait');
      }
      hud();
      updatePick();
      kick();
    }

    function hud() {
      const c = ctxNow;
      if (!c || !c.state) return;
      const s = c.state;
      const sc = score(s);
      $('.gt-t-a b').textContent = sc.a;
      $('.gt-t-b b').textContent = sc.b;
      if (c.over) {
        turnEl.hidden = true;
        api.setStatus(null);
        return;
      }
      const who = s.turn;
      const how = coarse() ? 'tap to drop' : 'click or Space';
      const choosing = s.blocks.length === 1 && s.mode === undefined && !s.drop;
      let txt;
      if (c.mode === 'local') txt = `${api.name(who)} · ${how}`;
      else if (c.canMove) txt = `Your turn · ${how}`;
      else if (choosing) txt = `${api.name(who)} is choosing a twist…`;
      else txt = `${api.name(who)}’s turn`;
      turnEl.textContent = txt;
      turnEl.className = `gt-turn p-${who}${c.canMove && slider ? ' is-go' : ''}`;
      turnEl.hidden = false;
      api.setStatus(c.mode === 'local' ? `${api.name(who)}’s turn` : c.canMove ? 'Your turn' : choosing ? `${api.name(who)} is choosing a twist…` : `${api.name(who)}’s turn`);
    }
    /** The mode chips: only the starting player, before the first move. */
    function updatePick() {
      const c = ctxNow;
      const show = !!(c && c.state && c.canMove && !c.over && slider && c.state.blocks.length === 1 && c.state.mode === undefined && !c.state.drop);
      if (show === !pickEl.hidden) return;
      pickEl.hidden = !show;
      wrap.classList.toggle('has-pick', show);
      if (show) {
        const last = lsGet(LS_LAST);
        pickEl.querySelectorAll('.gt-chip').forEach((b) => b.classList.toggle('is-last', b.dataset.mode === last));
      }
      measureHud();
    }
    function hidePick() { if (!pickEl.hidden) { pickEl.hidden = true; wrap.classList.remove('has-pick'); } }
    function pickMode(m) {
      const c = ctxNow;
      if (pickBusy || pending || (slider && slider.frozen) || !c || !c.canMove || c.over || pickEl.hidden) return; // a drop is already on its way: ignore quietly
      pickBusy = true;
      api.sfx('tap');
      const r = api.move({ m });
      pickBusy = false;
      if (!r.ok) { api.toast(r.error); return; }
      hidePick();
      lsSet(LS_LAST, m);
      log(`pick:${m}`);
    }

    // ── input ──
    function tryDrop() {
      const c = ctxNow;
      const s = slider;
      const t = T();
      if (!s || s.frozen || !c || !c.canMove || c.over || !view || paused || glLost || (typeof document !== 'undefined' && document.hidden) || wrap.dataset.phase !== 'slide') return false;
      if (s.hold || !s.entered || s.age < ARM_MS / 1000) { // still sliding in, or just appeared: a stray tap, not a drop
        if (t) t.ignored = (t.ignored || 0) + 1;
        log('ignored');
        return false;
      }
      let o = r3(s.p);
      if (t && typeof t.next === 'number') { o = t.next; t.next = null; }
      s.frozen = true;
      setArmed(false);
      placeAt(s.e, s.prev, s.axis, o);
      pending = { n: c.moves + 1, who: c.actor };
      if (t) t.tapped = o;
      api.sfx('tap');
      hidePick(); // the first drop settles the mode (classic): the picker goes at once
      const r = api.move({ o });
      if (!r.ok) {
        pending = null;
        if (slider) { slider.frozen = false; setArmed(true); }
        updatePick();
        api.toast(r.error);
        return false;
      }
      turnEl.classList.remove('is-go');
      return true;
    }
    const inUi = (e) => !!(e.target && e.target.closest && e.target.closest('button, .gt-pick, .gt-panel'));
    function onPointer(e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (inUi(e)) return;
      if (e.pointerType === 'touch' && e.clientX < 20) return; // leave the iOS back-swipe alone
      try { wrap.focus({ preventScroll: true }); } catch { /* ignore */ }
      if (tryDrop()) e.preventDefault();
    }
    function onTouch(e) { if (!inUi(e)) e.preventDefault(); } // no page scroll or sheet dismiss from the play surface
    let unlocked = false;
    function onTouchEnd() { if (!unlocked) { unlocked = true; api.sfx('tick'); } } // iOS: unlock audio in a gesture
    function onKey(e) {
      if (e.repeat || !(e.code === 'Space' || e.key === ' ' || e.key === 'Enter')) return;
      if (!wrap.isConnected) return;
      const tgt = e.target;
      if (tgt && tgt !== wrap && tgt.closest && tgt.closest('button, input, textarea, select, a, [contenteditable]')) return;
      const gm = wrap.closest('.gm');
      if (gm && gm.querySelector('.gm-sheet:not([hidden]), .gm-end:not([hidden]), .gm-curtain:not([hidden])')) return;
      if (tryDrop() || (slider && e.code === 'Space')) e.preventDefault();
    }
    function onPickClick(e) {
      const b = e.target.closest && e.target.closest('.gt-chip');
      if (b) pickMode(b.dataset.mode);
    }
    wrap.addEventListener('pointerdown', onPointer);
    wrap.addEventListener('touchstart', onTouch, { passive: false });
    wrap.addEventListener('touchmove', onTouch, { passive: false });
    wrap.addEventListener('touchend', onTouchEnd);
    pickEl.addEventListener('click', onPickClick);
    document.addEventListener('keydown', onKey);

    // ── environment ──
    const ro = new ResizeObserver((ents) => {
      const r = ents[0].contentRect;
      if (r.width < 2 || r.height < 2) return;
      cssW = r.width; cssH = r.height;
      measureHud();
      ghostW = 0;
      if (runInfo && !panelEl.hidden) refit();
      if (view) { view.resize(cssW, cssH); model.staticDirty = true; model.cam.viewH = baseViewH() * model.cam.zoom; cullDeco(); view.render(model); placeGhost(); }
    });
    ro.observe(wrap);
    const rect = wrap.getBoundingClientRect();
    if (rect.width > 2) { cssW = rect.width; cssH = rect.height; }

    function onTheme() {
      pal = readPalette(api);
      if (view) { view.setPalette(pal); model.staticDirty = true; if (!raf && !paused && !glLost) view.render(model); }
    }
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', onTheme);
    const mo = new MutationObserver(onTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });

    function onVis() {
      paused = document.hidden;
      if (paused) { if (raf) cancelAnimationFrame(raf); raf = 0; setArmed(false); }
      else { lastT = 0; kick(); if (view && !glLost) view.render(model); resumeCount(); } // a short 3-2-1 instead of resuming mid-sweep
    }
    document.addEventListener('visibilitychange', onVis);

    function onLost(e) {
      e.preventDefault();
      glLost = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      setArmed(false);
      wrap.dataset.gl = 'lost';
    }
    function onRestored() {
      // three.js re-creates its GL state in its own listener first; then rebuild ours from the model.
      setTimeout(() => {
        if (dead || !view) return;
        try { view.restore(); } catch (err) { console.warn('[tower] restore', err); }
        glLost = false;
        model.staticDirty = true;
        wrap.dataset.gl = 'ok';
        log('restored');
        lastT = 0;
        if (!paused) view.render(model);
        kick();
        resumeCount();
      }, 0);
    }

    function useView(v, note) {
      view = v;
      view.resize(cssW, cssH);
      view.setBase(spec().base);
      if (note) { const n = $('.gt-note'); n.textContent = note; n.hidden = false; }
      try { view.compile(); } catch (err) { console.warn('[tower] warm-up', err); }
      model.cam.viewH = baseViewH();
      const hold = T() && T().hold; // test hook only: keep the view "not ready" until this promise settles
      Promise.resolve(hold).then(() => { if (dead) return; readyRes(); kick(); });
    }
    function fallback(msg) {
      try { useView(view2D(canvas, pal), msg); wrap.dataset.gl = '2d'; } catch (err) {
        $('.gt-load span').textContent = 'This phone can’t draw the tower right now.';
        console.warn('[tower] no canvas', err);
      }
    }
    threeP.then((THREE) => {
      if (dead) return;
      let v = null;
      try { v = view3D(THREE, canvas, pal); } catch (err) {
        console.warn('[tower] WebGL unavailable', err);
        fallback('3D isn’t available here, so this is the flat version.');
        return;
      }
      canvas.addEventListener('webglcontextlost', onLost, false);
      canvas.addEventListener('webglcontextrestored', onRestored, false);
      wrap.dataset.gl = 'ok';
      useView(v, '');
    }, () => {
      if (dead) return;
      fallback('Couldn’t load the 3D engine, so this is the flat version.');
    });
    if (dataOK && typeof store.onData === 'function') {
      try { unData = store.onData(() => { if (!dead) refreshBest(); }); } catch { /* records are optional */ }
    }
    measureHud();

    return {
      update(c) {
        ctxNow = c;
        if (!c || !c.state) return;
        if (openedOver === null) openedOver = !!c.over;
        const t = T();
        if (t && t.model !== model) { t.model = model; t.project = (x, y, z) => project(x, y, z).slice(); t.hudBottom = () => hudBottom; } // test hook only
        refreshBest(modeOf(c.state));
        if (c.over) { bestFrozen = true; if (!runInfo) runInfo = recordRun(c); } // counted the moment the run is known over, even if you leave before the finale
        enqueue(sync);
      },
      onEndClosed() { if (runInfo) panelEl.classList.add('show'); },
      destroy() {
        dead = true;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        clearTimeout(bTimer);
        anims.clear();
        ro.disconnect();
        mo.disconnect();
        mq.removeEventListener('change', onTheme);
        document.removeEventListener('visibilitychange', onVis);
        document.removeEventListener('keydown', onKey);
        wrap.removeEventListener('pointerdown', onPointer);
        wrap.removeEventListener('touchstart', onTouch);
        wrap.removeEventListener('touchmove', onTouch);
        wrap.removeEventListener('touchend', onTouchEnd);
        pickEl.removeEventListener('click', onPickClick);
        canvas.removeEventListener('webglcontextlost', onLost, false);
        canvas.removeEventListener('webglcontextrestored', onRestored, false);
        if (typeof unData === 'function') { try { unData(); } catch { /* ignore */ } }
        if (view) { try { view.dispose(); } catch (err) { console.warn('[tower] dispose', err); } }
        view = null;
        model.blocks.length = 0;
        model.pieces.length = 0;
        model.deco.length = 0;
      },
    };
  },
});
