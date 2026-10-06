// Getaway car models: bodies lofted from cross-sections (chamfered lower body with wheel arches,
// tapered greenhouse), framed glass, separate lights (head / tail-brake / reverse lenses that the
// shader lights from per-material state), trim, and optional wheels. Five shapes share one
// generator: the runner's muscle fastback, the police sedan, and traffic sedan / SUV / pickup / van.
// Everything is written into a Builder (one draw call per mesh); smooth normals are computed with
// an angle threshold so panels stay crisp at the creases.
import { Builder, hullDirs, FX_PAINT, FX_GLASS, FX_CHROME, FX_TRIM, FX_GLOW, FX_TAIL, FX_REVERSE, FX_SIREN_R, FX_SIREN_B } from './gfx.js';

const TRIM = [0.09, 0.09, 0.1]; const RUBBER = [0.07, 0.07, 0.075]; const CHROME = [0.78, 0.79, 0.82];
const HEAD = [1, 0.97, 0.86]; const TAIL = [0.9, 0.08, 0.1]; const REV = [0.95, 0.95, 0.95]; const AMBER = [1, 0.6, 0.12];

/** Triangle soup with a colour and fx per triangle; emitted with auto-smoothed normals. */
class Soup {
  constructor() { this.p = []; this.col = []; this.fx = []; }
  tri(a, b, c, col, fx) { this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); this.col.push(col); this.fx.push(fx); }
  quad(a, b, c, d, col, fx) { this.tri(a, b, c, col, fx); this.tri(a, c, d, col, fx); }
  get n() { return this.p.length / 3; }
  /** Normals: average the face normals of coincident vertices whose faces are within `deg`. */
  normals(deg = 38) {
    const n = this.n; const P = this.p; const fn = new Float32Array(this.fx.length * 3);
    for (let t = 0; t < this.fx.length; t++) {
      const o = t * 9;
      const ux = P[o + 3] - P[o]; const uy = P[o + 4] - P[o + 1]; const uz = P[o + 5] - P[o + 2];
      const vx = P[o + 6] - P[o]; const vy = P[o + 7] - P[o + 1]; const vz = P[o + 8] - P[o + 2];
      let x = uy * vz - uz * vy; let y = uz * vx - ux * vz; let z = ux * vy - uy * vx; const l = Math.hypot(x, y, z) || 1;
      fn[t * 3] = x / l; fn[t * 3 + 1] = y / l; fn[t * 3 + 2] = z / l;
    }
    const key = (i) => `${Math.round(P[i * 3] * 500)},${Math.round(P[i * 3 + 1] * 500)},${Math.round(P[i * 3 + 2] * 500)}`;
    const groups = new Map();
    for (let i = 0; i < n; i++) { const k = key(i); let g = groups.get(k); if (!g) { g = []; groups.set(k, g); } g.push(i); }
    const out = new Float32Array(n * 3); const ct = Math.cos((deg * Math.PI) / 180);
    for (const g of groups.values()) {
      for (const i of g) {
        const ti = Math.floor(i / 3); let x = 0; let y = 0; let z = 0;
        for (const j of g) { const tj = Math.floor(j / 3); const d = fn[ti * 3] * fn[tj * 3] + fn[ti * 3 + 1] * fn[tj * 3 + 1] + fn[ti * 3 + 2] * fn[tj * 3 + 2]; if (d >= ct) { x += fn[tj * 3]; y += fn[tj * 3 + 1]; z += fn[tj * 3 + 2]; } }
        const l = Math.hypot(x, y, z) || 1; out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
      }
    }
    return out;
  }
  /** Write into Builder b; ol > 0 also writes one ink hull around the whole soup. */
  emit(b, ol = 0) {
    if (!this.n) return;
    const N = this.normals();
    // group triangles by colour + fx into templates
    const groups = new Map();
    for (let t = 0; t < this.fx.length; t++) { const k = this.col[t].join(',') + '|' + this.fx[t]; let g = groups.get(k); if (!g) { g = { col: this.col[t], fx: this.fx[t], tris: [] }; groups.set(k, g); } g.tris.push(t); }
    for (const g of groups.values()) {
      const n = g.tris.length * 3; const pos = new Float32Array(n * 3); const nrm = new Float32Array(n * 3); const idx = new Uint32Array(n);
      g.tris.forEach((t, k) => { for (let v = 0; v < 3; v++) { const s = (t * 3 + v) * 3; const d = (k * 3 + v) * 3; pos[d] = this.p[s]; pos[d + 1] = this.p[s + 1]; pos[d + 2] = this.p[s + 2]; nrm[d] = N[s]; nrm[d + 1] = N[s + 1]; nrm[d + 2] = N[s + 2]; idx[k * 3 + v] = k * 3 + v; } });
      b.add({ n, pos, nrm, idx, hull: null, box: false }, 0, 0, 0, 1, 1, 1, 0, g.col, 0, g.fx);
    }
    if (ol > 0) {
      const n = this.n; const pos = Float32Array.from(this.p); const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i;
      b.hull({ n, pos, nrm: N, idx, hull: hullDirs(pos, N, n, false), box: false }, ol);
    }
  }
}

const lerp = (a, b, t) => a + (b - a) * t;
/** Interpolate a station table (rows sorted by z, column 0 = z) at z. */
function rowAt(rows, z) {
  if (z <= rows[0][0]) return rows[0].slice();
  for (let i = 1; i < rows.length; i++) {
    if (z <= rows[i][0]) { const a = rows[i - 1]; const b = rows[i]; const t = (z - a[0]) / (b[0] - a[0] || 1); return a.map((v, k) => (k === 0 ? z : lerp(v, b[k], t))); }
  }
  return rows[rows.length - 1].slice();
}
/** Half cross-section of the lower body, bottom centre → top centre (x ≥ 0). */
function lowerHalf(w, yb, yt) {
  const h = Math.max(0.05, yt - yb);
  return [[0, yb], [w - 0.15, yb], [w - 0.025, yb + Math.min(0.1, h * 0.25)], [w, yb + h * 0.45], [w - 0.02, yt - Math.min(0.12, h * 0.25)], [w - 0.13, yt - 0.015], [0, yt + 0.025]];
}
function fullRing(half) { return half.concat(half.slice(1, -1).reverse().map(([x, y]) => [-x, y])); }

/**
 * Build a car into Builder b. spec: { body: [[z, w, yb, yt]…], cabin: [[z, wb, yb, wr, yr]…],
 * gaps: ['rear'|'side'|'pillar'|'ws'…], wheels: { x, r, w, z: [front, rear] }, lod: 0|1 }.
 * paint = body colour; o.wheels = draw wheels; o.ol = outline; o.extra(b, S) for trim.
 */
export function buildCar(b, spec, paint, o = {}) {
  const lod = spec.lod || 0; const ol = o.ol == null ? 0.035 : o.ol;
  const glassC = o.glass || [0.16, 0.2, 0.27];
  const W = spec.wheels; const archR = W.r + 0.08;
  // stations: the base table + arch stations around each axle + any extra cut points
  const zs = new Set(spec.body.map((r) => r[0]));
  const archD = lod ? [-1, -0.62, 0, 0.62, 1] : [-1, -0.88, -0.6, -0.3, 0, 0.3, 0.6, 0.88, 1];
  for (const wz of W.z) for (const k of archD) zs.add(+(wz + k * archR * 1.05).toFixed(4));
  for (const z of spec.cuts || []) zs.add(z);
  const zl = [...zs].sort((a, c) => a - c).filter((z) => z >= spec.body[0][0] - 1e-6 && z <= spec.body[spec.body.length - 1][0] + 1e-6);
  const rings = zl.map((z) => {
    const r = rowAt(spec.body, z); let yb = r[2];
    for (const wz of W.z) { const d = Math.abs(z - wz); if (d < archR) yb = Math.max(yb, W.r + Math.sqrt(archR * archR - d * d) * 0.93); }
    return { z, pts: fullRing(lowerHalf(r[1], yb, r[3])) };
  });
  const S = new Soup(); const O = new Soup();
  const P3 = (ring, i) => [ring.pts[i][0], ring.pts[i][1], ring.z];
  const nr = rings[0].pts.length;
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i]; const B = rings[i + 1];
    for (let e = 0; e < nr; e++) { const e1 = (e + 1) % nr; S.quad(P3(A, e), P3(A, e1), P3(B, e1), P3(B, e), paint, FX_PAINT); }
  }
  // caps
  const cap = (R, front) => { let cx = 0; let cy = 0; R.pts.forEach((p) => { cx += p[0]; cy += p[1]; }); const c = [cx / nr, cy / nr, R.z]; for (let e = 0; e < nr; e++) { const a = P3(R, e); const d = P3(R, (e + 1) % nr); if (front) S.tri(c, a, d, paint, FX_PAINT); else S.tri(c, d, a, paint, FX_PAINT); } };
  cap(rings[rings.length - 1], true); cap(rings[0], false);
  // overlay helper over lower-body edges (cop doors, two-tone): ring edge list, z range, colour
  const overlay = (edges, z0, z1, col, fx = FX_PAINT, off = 0.008) => {
    for (let i = 0; i < rings.length - 1; i++) {
      const A = rings[i]; const B = rings[i + 1]; if (A.z < z0 - 1e-6 || B.z > z1 + 1e-6) continue;
      for (const e of edges) {
        const e1 = (e + 1) % nr; const a = P3(A, e); const bb = P3(A, e1); const c = P3(B, e1); const d = P3(B, e);
        const ux = bb[0] - a[0]; const uy = bb[1] - a[1]; const nx = uy; const ny = -ux; const l = Math.hypot(nx, ny) || 1; // outward in the section plane
        const ox = (nx / l) * off; const oy = (ny / l) * off;
        O.quad([a[0] + ox, a[1] + oy, a[2]], [bb[0] + ox, bb[1] + oy, bb[2]], [c[0] + ox, c[1] + oy, c[2]], [d[0] + ox, d[1] + oy, d[2]], col, fx);
      }
    }
  };
  // greenhouse
  const C = spec.cabin; const G = spec.gaps;
  if (C && C.length > 1) {
    const ring = (r) => { const [z, wb, yb, wr, yr] = r; const h = yr - yb; const half = [[wb, yb], [wr + 0.02, yb + h * 0.82], [wr - 0.1, yb + h], [0, yb + h + 0.02]]; return { z, pts: half.concat(half.slice(0, -1).reverse().map(([x, y]) => [-x, y])) }; };
    const R = C.map(ring); const ng = R[0].pts.length; // 7: edges 0..5
    for (let i = 0; i < R.length - 1; i++) {
      const A = R[i]; const B = R[i + 1]; const kind = G[i] || 'pillar';
      for (let e = 0; e < ng - 1; e++) S.quad(P3(A, e), P3(A, e + 1), P3(B, e + 1), P3(B, e), paint, FX_PAINT);
      // framed glass: inset copies offset outwards
      const pane = (e0, e1) => {
        const inZ = kind === 'side' ? 0.07 : 0.05; const inE = 0.07;
        const pts = [];
        for (let e = e0; e <= e1 + 1; e++) {
          let t = 0; let ee = e;
          if (e === e0) t = inE; if (e === e1 + 1) { ee = e1; t = 1 - inE; }
          const pa = e === e1 + 1 ? [lerp(A.pts[ee][0], A.pts[ee + 1][0], t), lerp(A.pts[ee][1], A.pts[ee + 1][1], t)] : e === e0 ? [lerp(A.pts[e][0], A.pts[e + 1][0], t), lerp(A.pts[e][1], A.pts[e + 1][1], t)] : A.pts[e];
          const pb = e === e1 + 1 ? [lerp(B.pts[ee][0], B.pts[ee + 1][0], t), lerp(B.pts[ee][1], B.pts[ee + 1][1], t)] : e === e0 ? [lerp(B.pts[e][0], B.pts[e + 1][0], t), lerp(B.pts[e][1], B.pts[e + 1][1], t)] : B.pts[e];
          const a3 = [lerp(pa[0], pb[0], inZ), lerp(pa[1], pb[1], inZ), lerp(A.z, B.z, inZ)];
          const b3 = [lerp(pa[0], pb[0], 1 - inZ), lerp(pa[1], pb[1], 1 - inZ), lerp(A.z, B.z, 1 - inZ)];
          pts.push([a3, b3]);
        }
        for (let k = 0; k < pts.length - 1; k++) {
          const a = pts[k][0]; const bq = pts[k + 1][0]; const c = pts[k + 1][1]; const d = pts[k][1];
          // offset along the face normal
          const ux = bq[0] - a[0]; const uy = bq[1] - a[1]; const uz = bq[2] - a[2]; const vx = d[0] - a[0]; const vy = d[1] - a[1]; const vz = d[2] - a[2];
          let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx = (nx / l) * 0.012; ny = (ny / l) * 0.012; nz = (nz / l) * 0.012;
          const f = (p) => [p[0] + nx, p[1] + ny, p[2] + nz];
          O.quad(f(a), f(bq), f(c), f(d), glassC, FX_GLASS);
        }
      };
      if (kind === 'ws' || kind === 'rear') pane(1, 4);
      else if (kind === 'side') { pane(0, 0); pane(5, 5); }
    }
  }
  // chassis (fills the arches from the inside) and wheels
  const zMin = rings[0].z; const zMax = rings[rings.length - 1].z;
  b.box(0, 0.5, (zMin + zMax) / 2, 1.5, 0.5, zMax - zMin - 0.5, 0, TRIM, 0, FX_TRIM);
  if (o.wheels) for (const wz of W.z) for (const sx of [-1, 1]) addWheel(b, sx * W.x, W.r, wz, W.r, W.w, lod, sx);
  if (o.extra) o.extra(b, { rings, zMin, zMax, overlay });
  S.emit(b, ol); O.emit(b, 0);
  return { zMin, zMax, rings };
}

/** A wheel at (x, y, z) facing ±x: tyre, rim with spokes, hub. */
export function addWheel(b, x, y, z, r, w, lod = 0, side = 1) {
  const T = b.T;
  b.add(lod ? T.wheel : T.wheel16, x, y, z, w, r * 2, r * 2, 0, RUBBER, 0, FX_TRIM);
  b.add(lod ? T.wheel : T.wheel16, x + side * 0.012, y, z, w * 0.98, r * 1.3, r * 1.3, 0, CHROME, 0, FX_CHROME);
  if (!lod) {
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; b.add(T.box, x + side * (w * 0.5 + 0.004), y + Math.sin(a) * r * 0.33, z + Math.cos(a) * r * 0.33, 0.03, 0.07, r * 0.62, 0, [0.32, 0.33, 0.36], 0, FX_CHROME, null, -a); }
    b.add(T.wheel, x + side * (w * 0.5 + 0.01), y, z, 0.05, 0.14, 0.14, 0, [0.2, 0.2, 0.22], 0, FX_CHROME);
  }
}

// ── shapes (model space: +z forward, y up, origin on the ground at the centre) ──
export const SHAPES = {
  runner: {
    body: [[-2.3, 0.88, 0.36, 0.9], [-2.22, 0.96, 0.31, 0.98], [-1.95, 1.0, 0.28, 1.0], [-1.0, 1.0, 0.28, 0.99], [0, 1.0, 0.28, 0.98], [0.8, 0.99, 0.28, 0.98], [1.5, 0.98, 0.29, 0.95], [2.0, 0.95, 0.31, 0.89], [2.22, 0.9, 0.34, 0.83], [2.32, 0.83, 0.38, 0.75]],
    cabin: [[-1.95, 0.92, 0.99, 0.9, 1.0], [-1.12, 0.9, 0.98, 0.72, 1.36], [-0.45, 0.9, 0.98, 0.72, 1.4], [-0.33, 0.9, 0.98, 0.72, 1.4], [0.06, 0.92, 0.98, 0.74, 1.39], [0.86, 0.94, 0.975, 0.92, 0.975]],
    gaps: ['rear', 'side', 'pillar', 'side', 'ws'],
    wheels: { x: 0.885, r: 0.37, w: 0.28, z: [1.4, -1.36] },
    len: 4.62,
  },
  cop: {
    body: [[-2.3, 0.9, 0.38, 0.9], [-2.22, 0.97, 0.33, 0.98], [-1.92, 0.99, 0.3, 1.0], [-1.25, 1.0, 0.3, 0.99], [0, 1.0, 0.3, 0.98], [0.9, 0.99, 0.3, 0.97], [1.65, 0.98, 0.31, 0.93], [2.12, 0.95, 0.33, 0.87], [2.27, 0.9, 0.36, 0.8], [2.33, 0.84, 0.4, 0.72]],
    cabin: [[-1.66, 0.92, 0.99, 0.9, 1.0], [-1.1, 0.9, 0.98, 0.74, 1.47], [-0.3, 0.9, 0.98, 0.75, 1.5], [-0.17, 0.9, 0.98, 0.75, 1.5], [0.45, 0.92, 0.98, 0.76, 1.48], [1.14, 0.94, 0.97, 0.92, 0.97]],
    gaps: ['rear', 'side', 'pillar', 'side', 'ws'],
    wheels: { x: 0.885, r: 0.37, w: 0.27, z: [1.42, -1.4] },
    cuts: [-1.25, 0.95],
    len: 4.63,
  },
  sedan: {
    body: [[-2.2, 0.86, 0.38, 0.88], [-2.1, 0.93, 0.33, 0.96], [-1.8, 0.95, 0.31, 0.98], [0, 0.96, 0.31, 0.95], [1.4, 0.94, 0.32, 0.9], [2.0, 0.9, 0.35, 0.82], [2.18, 0.82, 0.4, 0.72]],
    cabin: [[-1.6, 0.88, 0.96, 0.86, 0.97], [-1.0, 0.86, 0.95, 0.7, 1.44], [-0.22, 0.86, 0.95, 0.71, 1.46], [-0.1, 0.86, 0.95, 0.71, 1.46], [0.42, 0.88, 0.95, 0.72, 1.44], [1.12, 0.9, 0.94, 0.88, 0.94]],
    gaps: ['rear', 'side', 'pillar', 'side', 'ws'],
    wheels: { x: 0.84, r: 0.34, w: 0.24, z: [1.36, -1.32] },
  },
  suv: {
    body: [[-2.3, 0.92, 0.46, 1.05], [-2.24, 0.97, 0.42, 1.1], [0, 0.98, 0.42, 1.1], [1.5, 0.97, 0.43, 1.08], [2.1, 0.93, 0.46, 1.0], [2.3, 0.86, 0.5, 0.9]],
    cabin: [[-2.26, 0.92, 1.1, 0.86, 1.1], [-2.24, 0.92, 1.1, 0.86, 1.86], [-1.2, 0.92, 1.1, 0.84, 1.9], [-1.06, 0.92, 1.1, 0.84, 1.9], [-0.1, 0.92, 1.1, 0.84, 1.9], [0.04, 0.92, 1.1, 0.84, 1.9], [0.6, 0.93, 1.1, 0.84, 1.86], [1.3, 0.95, 1.09, 0.93, 1.09]],
    gaps: ['rear', 'side', 'pillar', 'side', 'pillar', 'side', 'ws'],
    wheels: { x: 0.88, r: 0.4, w: 0.27, z: [1.45, -1.45] },
  },
  pickup: {
    body: [[-2.28, 0.92, 0.48, 1.05], [-2.23, 0.97, 0.44, 1.08], [0, 0.98, 0.44, 1.08], [1.55, 0.97, 0.45, 1.06], [2.12, 0.92, 0.48, 0.98], [2.3, 0.86, 0.52, 0.86]],
    cabin: [[-0.42, 0.93, 1.08, 0.86, 1.08], [-0.4, 0.93, 1.08, 0.86, 1.84], [0.08, 0.93, 1.08, 0.85, 1.88], [0.2, 0.93, 1.08, 0.85, 1.88], [0.72, 0.94, 1.08, 0.86, 1.84], [1.38, 0.95, 1.07, 0.93, 1.07]],
    gaps: ['rear', 'side', 'pillar', 'side', 'ws'],
    wheels: { x: 0.9, r: 0.41, w: 0.29, z: [1.5, -1.45] },
  },
  van: {
    body: [[-2.28, 0.95, 0.42, 1.0], [-2.23, 0.99, 0.38, 1.02], [0, 1.0, 0.38, 1.02], [1.6, 0.99, 0.39, 1.0], [2.12, 0.94, 0.42, 0.95], [2.3, 0.86, 0.46, 0.84]],
    cabin: [[-2.25, 0.97, 1.02, 0.92, 1.02], [-2.23, 0.97, 1.02, 0.92, 2.1], [-0.3, 0.97, 1.02, 0.92, 2.15], [0.62, 0.97, 1.02, 0.92, 2.13], [0.78, 0.97, 1.02, 0.92, 2.1], [1.5, 0.98, 1.01, 0.96, 1.01]],
    gaps: ['rear', 'pillar', 'side', 'pillar', 'ws'],
    wheels: { x: 0.9, r: 0.38, w: 0.27, z: [1.5, -1.45] },
  },
};

/** Lights + trim shared by the shapes: grille, bumpers, lenses, mirrors, plate, exhaust. */
function dress(b, S, shape, o) {
  const front = S.rings[S.rings.length - 1]; const rear = S.rings[0];
  const fy = (front.pts[3][1] + front.pts[4][1]) / 2; const ry = (rear.pts[3][1] + rear.pts[4][1]) / 2;
  const fz = S.zMax; const rz = S.zMin; const fw = front.pts[3][0]; const rw = rear.pts[3][0];
  const bump = o.chrome ? CHROME : TRIM; const bfx = o.chrome ? FX_CHROME : FX_TRIM;
  // bumpers
  b.box(0, front.pts[1][1] + 0.12, fz + 0.03, fw * 2 + 0.04, 0.2, 0.16, 0, bump, 0.02, bfx);
  b.box(0, rear.pts[1][1] + 0.12, rz - 0.03, rw * 2 + 0.04, 0.2, 0.16, 0, bump, 0.02, bfx);
  // grille + headlights
  b.box(0, fy - 0.02, fz + 0.005, fw * 0.95, Math.max(0.12, (front.pts[4][1] - front.pts[2][1]) * 0.6), 0.04, 0, TRIM, 0, FX_TRIM);
  for (const sx of [-1, 1]) {
    b.box(sx * (fw - 0.2), fy + 0.02, fz + 0.02, 0.32, 0.13, 0.05, 0, HEAD, 0, FX_GLOW);
    b.box(sx * (fw - 0.06), fy + 0.02, fz - 0.04, 0.05, 0.1, 0.1, 0, AMBER, 0, FX_GLOW);
    // tail / brake and reverse
    b.box(sx * (rw - 0.22), ry + 0.02, rz - 0.02, 0.36, 0.13, 0.05, 0, TAIL, 0, FX_TAIL);
    b.box(sx * (rw - 0.5), ry + 0.02, rz - 0.02, 0.14, 0.09, 0.04, 0, REV, 0, FX_REVERSE);
    // mirrors
    if (o.mirrors !== false) b.box(sx * (o.mirrorX || 1.02), o.mirrorY || 1.08, o.mirrorZ || 0.7, 0.14, 0.11, 0.1, 0, TRIM, 0.015, FX_TRIM);
  }
  // number plates
  b.box(0, rear.pts[1][1] + 0.3, rz - 0.035, 0.42, 0.12, 0.02, 0, [0.92, 0.92, 0.86], 0, FX_TRIM);
}

/** Player car geometry (no wheels: those are instanced). kind: 'runner' | 'cop'. */
export function buildPlayerCar(THREE, P, kind, ink) {
  const b = new Builder(THREE, P.outline);
  if (kind === 'runner') {
    const body = ink; const stripe = [0.96, 0.95, 0.92];
    buildCar(b, SHAPES.runner, body, {
      ol: 0.03,
      extra: (bb, S) => {
        dress(bb, S, 'runner', { chrome: true, mirrorZ: 0.62, mirrorY: 1.06 });
        // racing stripes over hood, roof and deck (follow the top surfaces)
        const strip = (z0, z1, top) => { for (const sx of [-1, 1]) { const x0 = sx * 0.13; const x1 = sx * 0.37; const n = 6; for (let k = 0; k < n; k++) { const za = lerp(z0, z1, k / n); const zb = lerp(z0, z1, (k + 1) / n); const ya = top(za) + 0.012; const yb = top(zb) + 0.012; const q = sx > 0 ? [[x0, ya, za], [x1, ya, za], [x1, yb, zb], [x0, yb, zb]] : [[x1, ya, za], [x0, ya, za], [x0, yb, zb], [x1, yb, zb]]; bb.poly(q.map((p) => p), stripe, FX_PAINT); } } };
        const topBody = (z) => { const r = rowAt(SHAPES.runner.body, z); return r[3] + 0.025 - 0.01; };
        const topCab = (z) => { const r = rowAt(SHAPES.runner.cabin, z); return r[4] + 0.02; };
        strip(0.9, 2.2, topBody); strip(-0.4, 0.0, topCab); strip(-2.2, -1.98, topBody);
        bb.box(0, 1.03, 1.15, 0.5, 0.12, 0.8, 0, body, 0.02, FX_PAINT);                 // hood scoop
        bb.box(0, 1.02, 1.5, 0.42, 0.06, 0.04, 0, TRIM, 0, FX_TRIM);
        bb.box(0, 1.2, -2.12, 1.86, 0.06, 0.32, 0, TRIM, 0.02, FX_TRIM);                // spoiler
        for (const sx of [-1, 1]) { bb.box(sx * 0.72, 1.08, -2.1, 0.06, 0.18, 0.12, 0, TRIM, 0, FX_TRIM); bb.add(bb.T.cyl, sx * 0.5, 0.3, -2.36, 0.12, 0.2, 0.12, 0, CHROME, 0, FX_CHROME, null, Math.PI / 2); }
      },
    });
  } else {
    const black = P.copBody; const white = P.copDoor;
    buildCar(b, SHAPES.cop, black, {
      ol: 0.03,
      extra: (bb, S) => {
        dress(bb, S, 'cop', { mirrorZ: 0.85, mirrorY: 1.1 });
        // white doors + roof (two-tone), gold star badges
        S.overlay([2, 3, 8, 9], -1.25, 0.95, white);
        bb.box(0, 1.515, -0.36, 1.22, 0.02, 1.4, 0, white, 0, FX_PAINT); // white roof panel
        for (const sx of [-1, 1]) bb.box(sx * 1.005, 0.7, -0.2, 0.02, 0.2, 0.22, 0, [0.88, 0.7, 0.2], 0, FX_CHROME);
        // lightbar: housing, red (driver side) and blue lenses, takedown light
        bb.box(0, 1.56, -0.3, 1.36, 0.08, 0.34, 0, TRIM, 0.02, FX_TRIM);
        bb.box(-0.36, 1.66, -0.3, 0.6, 0.13, 0.28, 0, [1, 0.18, 0.2], 0.015, FX_SIREN_R);
        bb.box(0.36, 1.66, -0.3, 0.6, 0.13, 0.28, 0, [0.2, 0.42, 1], 0.015, FX_SIREN_B);
        bb.box(0, 1.65, -0.3, 0.1, 0.1, 0.26, 0, [0.95, 0.95, 0.9], 0, FX_GLOW);
        // push bar + spotlight + antenna
        bb.box(0, 0.62, 2.44, 1.2, 0.1, 0.08, 0, TRIM, 0.02, FX_TRIM); bb.box(0, 0.42, 2.44, 1.2, 0.1, 0.08, 0, TRIM, 0, FX_TRIM);
        for (const sx of [-0.5, 0.5]) bb.box(sx, 0.55, 2.4, 0.08, 0.5, 0.12, 0, TRIM, 0, FX_TRIM);
        bb.add(bb.T.cyl, -0.98, 1.12, 0.62, 0.12, 0.16, 0.12, 0, CHROME, 0, FX_CHROME, null, Math.PI / 2);
        bb.box(0.3, 1.75, -1.55, 0.02, 0.5, 0.02, 0, TRIM, 0, FX_TRIM);
      },
    });
  }
  return b.geometryOut();
}

/** Player wheel geometry (one instance per wheel): tyre, rim, 5 spokes, hub. Facing +x. */
export function buildPlayerWheel(THREE, P) {
  const b = new Builder(THREE, P.outline);
  const r = 0.37; const w = 0.28; const T = b.T;
  b.add(T.wheel16, 0, 0, 0, w, r * 2, r * 2, 0, RUBBER, 0.02, FX_TRIM);
  b.add(T.wheel16, 0, 0, 0, w * 0.8, r * 1.95, r * 1.95, 0, [0.12, 0.12, 0.13], 0, FX_TRIM); // tread lip
  for (const sx of [-1, 1]) {
    b.add(T.wheel16, sx * 0.012, 0, 0, w * 0.98, r * 1.32, r * 1.32, 0, [0.64, 0.65, 0.68], 0, FX_CHROME);
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; b.add(T.box, sx * (w * 0.5 + 0.004), Math.sin(a) * r * 0.32, Math.cos(a) * r * 0.32, 0.03, 0.08, r * 0.6, 0, [0.82, 0.83, 0.86], 0, FX_CHROME, null, -a); }
    b.add(T.wheel, sx * (w * 0.5 + 0.012), 0, 0, 0.05, 0.15, 0.15, 0, [0.25, 0.25, 0.27], 0, FX_CHROME);
  }
  return b.geometryOut();
}

/** Traffic / parked car geometry for shape name (paint white → tinted per instance). */
export function buildTrafficCar(THREE, P, shape, lod = 0) {
  const b = new Builder(THREE, P.outline);
  const spec = { ...SHAPES[shape], lod };
  const white = [1, 1, 1];
  buildCar(b, spec, white, {
    ol: lod ? 0 : 0.03, wheels: true,
    extra: (bb, S) => {
      dress(bb, S, shape, { mirrors: !lod, mirrorZ: shape === 'van' ? 1.1 : shape === 'pickup' || shape === 'suv' ? 0.85 : 0.75, mirrorY: shape === 'van' ? 1.25 : shape === 'sedan' ? 1.02 : 1.18, mirrorX: 0.98 });
      if (shape === 'pickup') { bb.box(0, 0.99, -1.55, 1.7, 0.1, 1.85, 0, TRIM, 0, FX_TRIM); bb.box(0, 1.1, -2.52, 1.8, 0.04, 0.04, 0, TRIM, 0, FX_TRIM); }
      if (shape === 'suv') for (const sx of [-1, 1]) bb.box(sx * 0.7, 1.95, -0.7, 0.05, 0.05, 2.4, 0, TRIM, 0, FX_TRIM);
    },
  });
  return b.geometryOut();
}

/** Far-away traffic: a two-box silhouette with wheels hinted (≈ 100 triangles). */
export function buildTrafficFar(THREE, P) {
  const b = new Builder(THREE, P.outline);
  b.box(0, 0.68, 0, 1.92, 0.62, 4.4, 0, [1, 1, 1], 0, FX_PAINT);
  b.box(0, 1.2, -0.25, 1.66, 0.48, 2.1, 0, [0.16, 0.2, 0.27], 0, FX_GLASS);
  b.box(0, 1.46, -0.25, 1.6, 0.05, 1.9, 0, [1, 1, 1], 0, FX_PAINT);
  for (const z of [1.35, -1.35]) b.box(0, 0.34, z, 1.9, 0.62, 0.66, 0, RUBBER, 0, FX_TRIM);
  for (const sx of [-1, 1]) { b.box(sx * 0.62, 0.72, 2.21, 0.32, 0.12, 0.04, 0, HEAD, 0, FX_GLOW); b.box(sx * 0.62, 0.74, -2.21, 0.34, 0.12, 0.04, 0, TAIL, 0, FX_TAIL); }
  return b.geometryOut();
}
