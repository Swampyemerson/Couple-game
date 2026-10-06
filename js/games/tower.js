// Tower Together: a co-op stacking game. Take turns dropping the sliding block onto a shared
// tower; whatever hangs over the edge is sliced off and tumbles away. A total miss ends it.
// The height is the team score.
//
// Rules are pure: move = { o }, the drop offset along this level's axis relative to the block
// below (3 decimals). The sliding, slicing and tumbling are view-only.
import { registerGame } from './core.js';

// ── rules ─────────────────────────────────────────────────────────────
const BASE = 3;       // footprint of the base (world units)
const TOL = 0.1;      // a drop this close to dead centre snaps to a perfect fit
const GROW = 0.2;     // a perfect streak grows the block back by this much (each axis)
const STREAK = 3;     // perfects in a row that grow the block
const MAX_O = 50;

const other = (w) => (w === 'a' ? 'b' : 'a');
const r3 = (v) => Math.round(v * 1000) / 1000 + 0; // "+ 0" turns -0 into 0
const r4 = (v) => Math.round(v * 10000) / 10000 + 0;
/** Level n (the n-th dropped block; the base is level 0) slides along x on odd levels, z on even. */
const axisOf = (level) => (level % 2 ? 'x' : 'z');
const perfectTol = (size) => Math.min(TOL, size * 0.2);

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

function apply(s, who, mv) {
  if (s.over) throw new Error('The tower already toppled.');
  if (who !== s.turn) throw new Error('Hold on, it’s not your turn.');
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
  if (Math.abs(o) <= perfectTol(size)) {
    drop.perfect = true;
    nb.p = 1;
    s.streak += 1;
    s.perfects[who] += 1;
    if (s.streak % STREAK === 0 && (nb.w < BASE || nb.d < BASE)) {
      nb.w = r4(Math.min(BASE, nb.w + GROW));
      nb.d = r4(Math.min(BASE, nb.d + GROW));
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
  return {
    winner: null, team: true, score: h,
    text: h === 1 ? '1 block high' : `${h} blocks high`,
    sub: p ? `${line} ${p} perfect drop${p > 1 ? 's' : ''}.` : line,
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
const speedOf = (level) => Math.min(2.6 + 0.08 * (level - 1), 5.6); // units per second
const ampOf = (size) => size + 0.45;                                 // slide half-range
const sideOf = (level) => (level % 4 < 2 ? -1 : 1);                  // which side it starts on
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
  const c = (e.flash || 0) >= 0.5 ? pal.hl : e.who === 'a' ? pal.a : e.who === 'b' ? pal.b : pal.base;
  TMP[0] = c[0]; TMP[1] = c[1]; TMP[2] = c[2];
  return TMP;
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
    B.faces.visible = B.hull.visible = B.lines.visible = n > 0;
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
      const sx = m.cam.sx || 0;
      const tx = sx * Math.SQRT1_2; const tz = -sx * Math.SQRT1_2; const ty = m.cam.y;
      cam.position.set(tx + VIEW[0] * 60, ty + VIEW[1] * 60, tz + VIEW[2] * 60);
      cam.lookAt(tx, ty, tz);
      const out = OUTLINE_PX * vh / Hh;
      const blocks = m.blocks;
      if (m.staticDirty || statN < 0 || Math.abs(out - statOut) > statOut * 0.08) {
        let n = 0;
        for (let i = 0; i < blocks.length; i++) if (!blocks[i].live) n++;
        stat.ensure(n);
        n = 0;
        for (let i = 0; i < blocks.length; i++) { const e = blocks[i]; if (!e.live) writeBox(stat, U, n++, e, colorOf(pal, e), out); }
        stat.commit(n);
        statN = n; statOut = out; m.staticDirty = false;
      }
      let n = 0;
      for (let i = 0; i < blocks.length; i++) if (blocks[i].live) n++;
      n += m.pieces.length + (m.slider ? 1 : 0);
      dyn.ensure(n);
      n = 0;
      for (let i = 0; i < blocks.length; i++) { const e = blocks[i]; if (e.live) writeBox(dyn, U, n++, e, colorOf(pal, e), out); }
      for (let i = 0; i < m.pieces.length; i++) writeBox(dyn, U, n++, m.pieces[i], colorOf(pal, m.pieces[i]), out);
      if (m.slider) writeBox(dyn, U, n++, m.slider, colorOf(pal, m.slider), out);
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
  let sc = 1; let camS = 0; let sxo = 0;
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
    compile() {},
    restore() {},
    render(m) {
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.fillStyle = css(pal.bg);
      g.fillRect(0, 0, W, Hh);
      sc = Hh / m.cam.viewH; camS = m.cam.y * COSP; sxo = m.cam.sx || 0;
      g.lineJoin = 'round';
      g.lineWidth = 1.6;
      g.strokeStyle = css(pal.ink);
      // hard offset shadow under the pedestal
      const sy0 = -PED; const h0 = (BASE + 0.1) / 2;
      g.beginPath();
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([i, j], k) => {
        const X = 0.42 + i * h0; const Z = 0.42 + j * h0;
        if (k) g.lineTo(px(X, Z), py(X, sy0, Z)); else g.moveTo(px(X, Z), py(X, sy0, Z));
      });
      g.fillStyle = css(pal.shadow);
      g.fill();
      for (const e of m.blocks) drawBox(e);
      for (const e of m.pieces) drawBox(e);
      if (m.slider) drawBox(m.slider);
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
  endDelay: 2600,
  howTo: [
    'On your turn, tap (or press Space) to drop the sliding block.',
    'Whatever hangs over the edge gets sliced off.',
    'Land it dead on for a perfect. Three in a row grows it back.',
    'Miss the tower completely and it’s over. Build it high together.',
  ],
  init, next, apply, result, score,

  css: `
    .g-tower { flex: 1; display: flex; flex-direction: column; min-height: 0; padding: 2px 0 6px; }
    .g-tower .gt-view { position: relative; flex: 1; min-height: 340px; max-height: 980px; border: 2px solid var(--g-ink); border-radius: var(--g-radius, 14px); box-shadow: var(--g-shadow-lg, 4px 4px 0 var(--g-ink)); background: var(--g-bg); overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; cursor: pointer; outline: none; }
    .g-tower .gt-view:focus-visible { outline: 3px solid var(--g-hl); outline-offset: -5px; }
    .g-tower .gt-view[data-phase="wait"], .g-tower .gt-view[data-phase="over"], .g-tower .gt-view[data-phase="load"] { cursor: default; }
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
    .g-tower .gt-stamp { position: absolute; top: 27%; left: 50%; padding: 7px 16px; border: 2px solid var(--g-ink); border-radius: 8px; background: var(--g-hl); color: var(--g-on-ink); box-shadow: var(--g-shadow); font: 900 1.3rem/1.1 var(--g-font-display); letter-spacing: 0.05em; text-transform: uppercase; white-space: nowrap; pointer-events: none; opacity: 0; transform: translate(-50%, 0) rotate(-5deg); }
    .g-tower .gt-stamp.show { animation: gt-stamp 1150ms cubic-bezier(.2, .9, .3, 1.25) both; }
    @keyframes gt-stamp {
      0% { opacity: 0; transform: translate(-50%, 10px) rotate(-5deg) scale(.55); }
      14% { opacity: 1; transform: translate(-50%, 0) rotate(-5deg) scale(1.1); }
      24%, 78% { opacity: 1; transform: translate(-50%, 0) rotate(-5deg) scale(1); }
      100% { opacity: 0; transform: translate(-50%, -12px) rotate(-5deg) scale(.96); }
    }
    .g-tower .gt-turn { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); padding: 11px 18px; border: 2px solid var(--g-ink); border-radius: 999px; background: var(--g-card); color: var(--g-ink); box-shadow: var(--g-shadow); font-weight: 900; font-size: 0.95rem; white-space: nowrap; pointer-events: none; }
    .g-tower .gt-turn.p-a { background: var(--p-a); color: var(--g-on-ink); }
    .g-tower .gt-turn.p-b { background: var(--p-b); color: var(--g-on-ink); }
    .g-tower .gt-turn.is-go { animation: gt-bob 1.5s ease-in-out infinite; }
    @keyframes gt-bob { 0%, 100% { transform: translate(-50%, 0); } 50% { transform: translate(-50%, -3px); } }
    .g-tower .gt-load { position: absolute; inset: 0; display: grid; place-items: center; background: var(--g-bg); color: var(--g-muted); font-weight: 800; letter-spacing: 0.02em; }
    .g-tower .gt-view:not([data-phase="load"]) .gt-load { display: none; }
    .g-tower .gt-note { position: absolute; left: 12px; right: 12px; bottom: 70px; margin: 0; text-align: center; font-size: 0.8rem; font-weight: 700; color: var(--g-muted); pointer-events: none; }
    /* full screen: keep the HUD clear of the notch and the home bar */
    .gm.is-immersive .g-tower .gt-hud { top: calc(10px + env(safe-area-inset-top, 0px)); }
    .gm.is-immersive .g-tower .gt-turn { bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
    .gm.is-immersive .g-tower .gt-note { bottom: calc(70px + env(safe-area-inset-bottom, 0px)); }
    /* a phone on its side: the turn pill moves to the bottom-right corner, off the tower */
    @media (orientation: landscape) and (max-height: 520px) {
      .g-tower .gt-turn { left: auto; right: calc(14px + env(safe-area-inset-right, 0px)); transform: none; }
      .g-tower .gt-turn.is-go { animation-name: gt-bob-r; }
      .g-tower .gt-note { left: auto; right: calc(14px + env(safe-area-inset-right, 0px)); max-width: 40%; text-align: right; }
    }
    @keyframes gt-bob-r { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(0, -3px); } }
    @media (prefers-reduced-motion: reduce) {
      .g-tower .gt-stamp.show { animation: gt-fade 1100ms linear both; }
      .g-tower .gt-turn.is-go { animation: none; }
      @keyframes gt-fade { 0%, 100% { opacity: 0; } 8%, 80% { opacity: 1; } }
    }
  `,

  mount(el, api) {
    const threeP = api.three(); // start loading right away
    threeP.catch(noop);
    el.innerHTML = `<div class="g-tower">
      <div class="gt-view" data-phase="load" data-gl="" tabindex="0" role="application" aria-label="Tower Together. Tap or press Space to drop the block on your turn.">
        <canvas class="gt-canvas" aria-hidden="true"></canvas>
        <div class="gt-hud" aria-hidden="true">
          <div class="gt-height"><b>0</b><span>high</span></div>
          <div class="gt-row">
            <span class="gt-t gt-t-a"><i></i><span class="gt-n"></span><b>0</b></span>
            <span class="gt-t gt-t-b"><i></i><span class="gt-n"></span><b>0</b></span>
            <span class="gt-streak">Perfects <i></i><i></i><i></i></span>
          </div>
        </div>
        <div class="gt-stamp" aria-hidden="true"></div>
        <div class="gt-turn" aria-live="polite" hidden></div>
        <p class="gt-note" hidden></p>
        <div class="gt-load"><span>Stacking the blocks…</span></div>
      </div>
    </div>`;
    const $ = (s) => el.querySelector(s);
    const wrap = $('.gt-view');
    const canvas = $('.gt-canvas');
    $('.gt-t-a .gt-n').textContent = api.name('a');
    $('.gt-t-b .gt-n').textContent = api.name('b');
    const T = () => (typeof window !== 'undefined' && window.__towerTest) || null; // test hook only
    const log = (ev) => { const t = T(); if (t) (t.log || (t.log = [])).push(ev); };
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = () => matchMedia('(pointer: coarse)').matches;

    let dead = false;
    let view = null;
    let THREEref = null;
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
    const ready = new Promise((r) => { readyRes = r; });
    const model = { blocks: [], pieces: [], slider: null, ring: null, cam: { y: CAM_LEAD, zoom: 1, viewH: 12, sx: 0 }, staticDirty: true };
    const goal = { y: CAM_LEAD, zoom: 1 };
    const anims = new Set();

    const baseViewH = () => Math.max(VIEW_W * cssH / cssW, MIN_VIEW_H);
    const phase = (p) => { wrap.dataset.phase = p; };

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
      const camBusy = Math.abs(goal.y - c.y) > 0.002 || Math.abs(goal.zoom - c.zoom) > 0.0005;
      if (!camBusy) { c.y = goal.y; c.zoom = goal.zoom; }
      c.viewH = baseViewH() * c.zoom;
      let calls = 0;
      if (view) {
        calls = view.render(model);
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
    function newEntry(level, who, prev) {
      return { x: prev.x, y: yOf(level), z: prev.z, w: prev.w, h: BH, d: prev.d, who, live: true, holds: 0, flash: 0, lift: 0, rx: 0, rz: 0 };
    }
    function stepSlider(dt) {
      const s = slider;
      if (!s || s.frozen) return;
      s.u = (s.u + s.v * dt) % (4 * s.A);
      const tri = s.u < 2 * s.A ? s.u : 4 * s.A - s.u;
      s.p = s.start + s.dir * tri;
      placeAt(s.e, s.prev, s.axis, s.p);
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
        x: src.x, y: src.y, z: src.z, w: src.w, h: src.h, d: src.d, who: src.who, flash: 0, lift: 0, live: true,
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
    function stamp(drop) {
      const st = $('.gt-stamp');
      st.textContent = drop.grew ? 'Perfect · it grew' : drop.streak > 1 ? `Perfect ×${drop.streak}` : 'Perfect';
      st.classList.remove('show');
      void st.offsetWidth;
      st.classList.add('show');
    }
    function setHeight(n) { $('.gt-height b').textContent = String(Math.max(0, n)); }
    function setStreak(n, grew) {
      const on = grew ? STREAK : n % STREAK;
      el.querySelectorAll('.gt-streak i').forEach((i, k) => i.classList.toggle('on', k < on));
    }

    // ── model building ──
    function build(s, count) {
      if (slider && !pending) stopSlider();
      const bl = model.blocks;
      if (bl.length > count) bl.length = count;
      for (let i = bl.length; i < count; i++) {
        const b = s.blocks[i];
        bl.push({ x: b.x, y: yOf(i), z: b.z, w: b.w, h: hOf(i), d: b.d, who: b.who, live: false, holds: 0, flash: 0, lift: 0, rx: 0, rz: 0 });
      }
      model.staticDirty = true;
      setHeight(count - 1);
      goal.y = camYFor(count - 1);
    }
    function stopSlider() { slider = null; model.slider = null; }
    function startSlider(level, who) {
      const prev = model.blocks[level - 1];
      if (!prev) return;
      const axis = axisOf(level);
      const A = ampOf(axis === 'x' ? prev.w : prev.d);
      const start = sideOf(level) * A;
      const e = newEntry(level, who, prev);
      model.slider = e;
      slider = { level, axis, A, v: speedOf(level), u: 0, start, dir: -Math.sign(start), prev, e, p: start, frozen: false };
      placeAt(e, prev, axis, start);
      goal.y = camYFor(level - 1);
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
      const start = sideOf(lv) * A;
      const e = newEntry(lv, drop.who, prev);
      model.slider = e;
      placeAt(e, prev, drop.axis, start);
      goal.y = camYFor(lv - 1);
      if (reduced()) { placeAt(e, prev, drop.axis, drop.o); return; }
      await wait(220);
      const ms = Math.max(300, Math.min(900, Math.abs(drop.o - start) / speedOf(lv) * 1000));
      await tween(ms, (k) => placeAt(e, prev, drop.axis, start + (drop.o - start) * k), lin);
      await wait(70);
    }
    async function resolveDrop(drop, s) {
      phase('busy');
      const rm = reduced();
      const lv = drop.level;
      const prev = model.blocks[lv - 1];
      const e = model.slider || newEntry(lv, drop.who, prev);
      model.slider = null;
      slider = null;
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
      const nb = s.blocks[lv];
      e.live = false;
      hold(e);
      model.blocks.push(e);
      if (drop.perfect) {
        const fx = e.x; const fz = e.z;
        await tween(rm ? 0 : 90, (k) => { e.x = fx + (nb.x - fx) * k; e.z = fz + (nb.z - fz) * k; }, easeOut);
        api.sfx('good');
        api.haptic(15);
        blink(e, 260);
        ringAt(e);
        stamp(drop);
        setStreak(drop.streak, drop.grew);
        if (drop.grew) {
          const w0 = e.w; const d0 = e.d;
          await tween(rm ? 0 : 280, (k) => { e.w = w0 + (nb.w - w0) * k; e.d = d0 + (nb.d - d0) * k; }, backOut);
        }
      } else {
        e.x = nb.x; e.z = nb.z; e.w = nb.w; e.d = nb.d;
        const c = drop.cut;
        addPiece({ x: c.x, y: e.y, z: c.z, w: c.w, h: BH, d: c.d, who: drop.who }, drop.axis, Math.sign(drop.o));
        api.sfx('place');
        api.haptic(10);
        settle(e);
        setStreak(0, false);
      }
      e.x = nb.x; e.z = nb.z; e.w = nb.w; e.d = nb.d;
      release(e);
      goal.y = camYFor(lv);
      setHeight(lv);
      await wait(rm ? 40 : 170);
    }
    async function finale() {
      stopSlider();
      log('finale');
      phase('over');
      const n = model.blocks.length - 1;
      const top = n * BH;
      const needH = (top + PED) * COSP + 2 * BASE * SINP * Math.SQRT1_2 + 4.2;
      goal.zoom = Math.max(1, needH / baseViewH());
      goal.y = (top - PED) / 2 + 0.7;
      kick();
      if (reduced() || n < 1) return;
      await wait(650);
      const gap = Math.min(80, 1100 / n);
      const total = gap * n + 320;
      const bl = model.blocks.slice(1, n + 1);
      bl.forEach(hold);
      api.sfx('pop');
      await tween(total, (k) => {
        const t = k * total;
        for (let i = 0; i < bl.length; i++) {
          const u = (t - i * gap) / 320;
          const b = u > 0 && u < 1 ? Math.sin(u * Math.PI) : 0;
          bl[i].lift = b * 0.28;
          bl[i].flash = b > 0.7 ? 1 : 0;
        }
      }, lin);
      bl.forEach((e) => { e.lift = 0; e.flash = 0; release(e); });
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
      afterSync();
    }
    function afterSync() {
      const c = ctxNow;
      if (!c || !c.state) return;
      hud();
      const s = c.state;
      setStreak(s.streak, s.drop && s.drop.grew);
      setHeight(s.blocks.length - 1);
      if (c.over) {
        if (!finaleDone) { finaleDone = true; finale(); }
        phase('over');
        return;
      }
      if (c.canMove) {
        if (!slider) startSlider(s.blocks.length, c.actor);
        phase('slide');
      } else {
        if (slider) stopSlider();
        goal.y = camYFor(s.blocks.length - 1);
        phase('wait');
      }
      kick();
    }

    function hud() {
      const c = ctxNow;
      if (!c || !c.state) return;
      const s = c.state;
      const sc = score(s);
      $('.gt-t-a b').textContent = sc.a;
      $('.gt-t-b b').textContent = sc.b;
      const turn = $('.gt-turn');
      if (c.over) {
        turn.hidden = true;
        api.setStatus(null);
        return;
      }
      const who = s.turn;
      const how = coarse() ? 'tap to drop' : 'click or Space';
      let txt;
      if (c.mode === 'local') txt = `${api.name(who)} · ${how}`;
      else if (c.canMove) txt = `Your turn · ${how}`;
      else txt = `${api.name(who)}’s turn`;
      turn.textContent = txt;
      turn.className = `gt-turn p-${who}${c.canMove ? ' is-go' : ''}`;
      turn.hidden = false;
      api.setStatus(c.mode === 'local' ? `${api.name(who)}’s turn` : c.canMove ? 'Your turn' : `${api.name(who)}’s turn`);
    }

    // ── input ──
    function tryDrop() {
      const c = ctxNow;
      if (!slider || slider.frozen || !c || !c.canMove || c.over || !view) return false;
      let o = r3(slider.p);
      const t = T();
      if (t && typeof t.next === 'number') { o = t.next; t.next = null; }
      slider.frozen = true;
      placeAt(slider.e, slider.prev, slider.axis, o);
      pending = { n: c.moves + 1, who: c.actor };
      if (t) t.tapped = o;
      api.sfx('tap');
      const r = api.move({ o });
      if (!r.ok) {
        pending = null;
        if (slider) slider.frozen = false;
        api.toast(r.error);
        return false;
      }
      return true;
    }
    function onPointer(e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.pointerType === 'touch' && e.clientX < 20) return; // leave the iOS back-swipe alone
      try { wrap.focus({ preventScroll: true }); } catch { /* ignore */ }
      if (tryDrop()) e.preventDefault();
    }
    function onTouch(e) { e.preventDefault(); } // no page scroll or sheet dismiss from the play surface
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
    wrap.addEventListener('pointerdown', onPointer);
    wrap.addEventListener('touchstart', onTouch, { passive: false });
    wrap.addEventListener('touchmove', onTouch, { passive: false });
    wrap.addEventListener('touchend', onTouchEnd);
    document.addEventListener('keydown', onKey);

    // ── environment ──
    const ro = new ResizeObserver((ents) => {
      const r = ents[0].contentRect;
      if (r.width < 2 || r.height < 2) return;
      cssW = r.width; cssH = r.height;
      if (view) { view.resize(cssW, cssH); model.staticDirty = true; model.cam.viewH = baseViewH() * model.cam.zoom; view.render(model); }
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
      if (paused) { if (raf) cancelAnimationFrame(raf); raf = 0; }
      else { lastT = 0; kick(); if (view && !glLost) view.render(model); }
    }
    document.addEventListener('visibilitychange', onVis);

    function onLost(e) {
      e.preventDefault();
      glLost = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
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
      }, 0);
    }

    function useView(v, note) {
      view = v;
      view.resize(cssW, cssH);
      if (note) { const n = $('.gt-note'); n.textContent = note; n.hidden = false; }
      try { view.compile(); } catch (err) { console.warn('[tower] warm-up', err); }
      model.cam.viewH = baseViewH();
      readyRes();
      kick();
    }
    function fallback(msg) {
      try { useView(view2D(canvas, pal), msg); wrap.dataset.gl = '2d'; } catch (err) {
        $('.gt-load span').textContent = 'This phone can’t draw the tower right now.';
        console.warn('[tower] no canvas', err);
      }
    }
    threeP.then((THREE) => {
      if (dead) return;
      THREEref = THREE;
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

    return {
      update(c) {
        ctxNow = c;
        if (!c || !c.state) return;
        hud();
        enqueue(sync);
      },
      destroy() {
        dead = true;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
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
        canvas.removeEventListener('webglcontextlost', onLost, false);
        canvas.removeEventListener('webglcontextrestored', onRestored, false);
        if (view) { try { view.dispose(); } catch (err) { console.warn('[tower] dispose', err); } }
        view = null;
        THREEref = null;
        model.blocks.length = 0;
        model.pieces.length = 0;
      },
    };
  },
});
